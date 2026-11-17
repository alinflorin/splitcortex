//! The engine plus the policy that picks its settings. Per field, the admin's override (web app, through the gateway)
//! wins, then this node's own setting, then automatic: the backend is measured once per model on this machine (CPU
//! against GPU, GPU only if clearly faster, never without a GPU driver) and remembered; the context window follows the
//! machine's RAM. A failed load steps back (GPU to CPU, then the default window) instead of failing.
//! Port of `src/desktop-node/src/engine/compute.ts`.

use super::{Engine, GenerateReq};
use crate::storage::Dirs;
use std::collections::BTreeMap;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::sync::Mutex as AsyncMutex;
use tracing::info;

/// Context window when none is asked for.
pub const DEFAULT_CONTEXT: i32 = 4096;
/// GPU must beat the CPU by this factor to be picked: below it, the CPU is steadier (less heat and power).
pub const GPU_MARGIN: f64 = 1.1;
const BENCH_FILE: &str = "backend-bench.json";
const BENCH_PROMPT: &str = "Count from one to one hundred in words.";
const BENCH_TOKENS: i32 = 40;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Backend {
    Cpu,
    Gpu,
}
impl Backend {
    pub fn as_str(self) -> &'static str {
        match self {
            Backend::Cpu => "cpu",
            Backend::Gpu => "gpu",
        }
    }
    pub fn parse(s: &str) -> Option<Backend> {
        match s {
            "cpu" => Some(Backend::Cpu),
            "gpu" => Some(Backend::Gpu),
            _ => None,
        }
    }
}

/// Engine settings; a missing field means "decide for me".
#[derive(Clone, Default, Debug, PartialEq)]
pub struct Prefs {
    pub backend: Option<Backend>,
    pub max_context_tokens: Option<i32>,
    /// Multi-token prediction: speculative decoding with the model bundle's drafter (ignored when it has none).
    pub enable_mtp: Option<bool>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Source {
    Local,
    Admin,
}

/// Automatic context window from the machine's RAM (the KV cache lives in it). Unknown RAM gets the default.
pub fn auto_context(total_memory_mb: u64) -> i32 {
    match total_memory_mb {
        0 => DEFAULT_CONTEXT,
        m if m < 4096 => 2048,
        m if m < 10240 => 4096,
        _ => 8192,
    }
}

/// Piece count and the times of the first and the latest piece.
type Pieces = (u32, Option<Instant>, Option<Instant>);

#[derive(Default)]
struct Inner {
    local: Prefs,
    admin: Prefs,
    path: Option<String>,
    applied: Option<Prefs>,
}

pub struct ComputeEngine {
    engine: Arc<Engine>,
    dirs: Dirs,
    inner: AsyncMutex<Inner>,
    /// Held for a whole load, unload and generation: they never overlap.
    gate: AsyncMutex<()>,
    active: Mutex<Option<(Backend, i32)>>,
}

impl ComputeEngine {
    pub fn new(engine: Arc<Engine>, dirs: Dirs) -> Arc<Self> {
        Arc::new(ComputeEngine {
            engine,
            dirs,
            inner: AsyncMutex::default(),
            gate: AsyncMutex::default(),
            active: Mutex::default(),
        })
    }

    pub fn backend(&self) -> Option<Backend> {
        self.active
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .map(|a| a.0)
    }
    /// The inputs besides text the loaded model accepts (`image`, `audio`).
    pub fn modalities(&self) -> Vec<&'static str> {
        self.engine.modalities()
    }
    pub fn max_context_tokens(&self) -> i32 {
        self.active
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .map(|a| a.1)
            .unwrap_or(0)
    }
    fn set_active(&self, a: Option<(Backend, i32)>) {
        *self.active.lock().unwrap_or_else(|e| e.into_inner()) = a;
    }

    /// Loads the model stored under this file name, deciding backend and context window.
    pub async fn load(&self, name: &str) -> Result<(), String> {
        self.inner.lock().await.path = Some(name.to_string());
        let _g = self.gate.lock().await;
        self.apply(name).await
    }

    pub async fn unload(&self) {
        let _g = self.gate.lock().await;
        {
            let mut i = self.inner.lock().await;
            i.path = None;
            i.applied = None;
        }
        self.set_active(None);
        let e = self.engine.clone();
        let _ = tokio::task::spawn_blocking(move || e.unload()).await;
    }

    /// Sets one source of preferences and reloads when a model is loaded and the effective settings differ.
    pub async fn set_prefs(&self, source: Source, prefs: Prefs) -> Result<(), String> {
        let path = {
            let mut i = self.inner.lock().await;
            match source {
                Source::Local => i.local = prefs,
                Source::Admin => i.admin = prefs,
            }
            if i.applied.as_ref() == Some(&wanted(&i)) {
                return Ok(());
            }
            i.path.clone()
        };
        let Some(path) = path else { return Ok(()) };
        let _g = self.gate.lock().await;
        // Still the same model, and still different from what runs?
        let again = {
            let i = self.inner.lock().await;
            i.path.as_deref() == Some(path.as_str()) && i.applied.as_ref() != Some(&wanted(&i))
        };
        if again {
            self.apply(&path).await
        } else {
            Ok(())
        }
    }

    /// Streams text pieces through `on_text`; setting `cancel` stops generation. Waits for a reload in progress.
    pub async fn generate(
        &self,
        req: GenerateReq,
        cancel: Arc<AtomicBool>,
        on_text: Box<dyn Fn(String) + Send>,
    ) -> Result<(), String> {
        let _g = self.gate.lock().await;
        let e = self.engine.clone();
        tokio::task::spawn_blocking(move || e.generate(&req, cancel, on_text))
            .await
            .map_err(|e| e.to_string())?
    }

    async fn caps(&self) -> super::Caps {
        tokio::task::spawn_blocking(super::caps)
            .await
            .unwrap_or(super::Caps {
                gpu_available: false,
                total_memory_mb: 0,
            })
    }

    async fn load_blocking(
        &self,
        path: &str,
        b: Backend,
        ctx: i32,
        mtp: bool,
    ) -> Result<(), String> {
        let e = self.engine.clone();
        let file = self.dirs.model_path(path).map_err(|e| e.to_string())?;
        let cache = self.dirs.cache.join("litert");
        tokio::task::spawn_blocking(move || e.load(&file, b.as_str(), ctx, mtp, &cache))
            .await
            .map_err(|e| e.to_string())?
    }

    async fn apply(&self, path: &str) -> Result<(), String> {
        let want = {
            let i = self.inner.lock().await;
            wanted(&i)
        };
        let caps = self.caps().await;
        let ctx = want
            .max_context_tokens
            .unwrap_or_else(|| auto_context(caps.total_memory_mb));
        let mut backend = want.backend;
        if backend == Some(Backend::Gpu) && !caps.gpu_available {
            info!("GPU requested but this machine has no usable GPU driver: using the CPU");
            backend = Some(Backend::Cpu);
        }
        let backend = match backend {
            Some(b) => b,
            None => self.fastest(path, ctx, caps.gpu_available).await,
        };
        // Fallbacks, in order: as asked, the CPU, the CPU with the default window.
        let mtp = want.enable_mtp == Some(true);
        let attempts = [
            (backend, ctx, mtp),
            (backend, ctx, false), // a bundle without a drafter, or a backend that cannot run it
            (Backend::Cpu, ctx, false),
            (Backend::Cpu, DEFAULT_CONTEXT, false),
        ];
        let mut last = None;
        for (i, &(b, c, m)) in attempts.iter().enumerate() {
            if i > 0 && attempts[i - 1] == (b, c, m) {
                continue;
            }
            match self.load_blocking(path, b, c, m).await {
                Ok(()) => {
                    self.inner.lock().await.applied = Some(want);
                    self.set_active(Some((b, c)));
                    info!(
                        "Engine loaded on {}, context {c} tokens{}",
                        b.as_str().to_uppercase(),
                        if m { ", MTP on" } else { "" }
                    );
                    return Ok(());
                }
                Err(e) => {
                    info!(
                        "Loading on {} with context {c}{} failed: {e}",
                        b.as_str().to_uppercase(),
                        if m { " and MTP" } else { "" }
                    );
                    last = Some(e);
                }
            }
        }
        self.set_active(None);
        Err(last.unwrap_or_else(|| "The model could not be loaded".into()))
    }

    /// Decode speed (tokens/sec) of a short fixed generation on the loaded model (the time to the first token is not
    /// counted), 0 when it cannot be measured.
    async fn benchmark(&self) -> f64 {
        let times: Arc<Mutex<Pieces>> = Arc::default();
        let t = times.clone();
        let e = self.engine.clone();
        let req = GenerateReq {
            messages: vec![super::Message {
                role: "user".into(),
                content: BENCH_PROMPT.into(),
                parts: Vec::new(),
            }],
            max_tokens: BENCH_TOKENS,
            temperature: 0.0,
            top_p: 0.0,
        };
        let r = tokio::task::spawn_blocking(move || {
            e.generate(
                &req,
                Arc::default(),
                Box::new(move |text| {
                    if text.is_empty() {
                        return;
                    }
                    let mut g = t.lock().unwrap_or_else(|e| e.into_inner());
                    g.0 += 1;
                    let now = Instant::now();
                    g.1.get_or_insert(now);
                    g.2 = Some(now);
                }),
            )
        })
        .await;
        if !matches!(r, Ok(Ok(()))) {
            return 0.0;
        }
        let (n, first, last) = *times.lock().unwrap_or_else(|e| e.into_inner());
        match (first, last) {
            (Some(f), Some(l)) if n > 1 && l > f => (n - 1) as f64 / (l - f).as_secs_f64(),
            _ => 0.0,
        }
    }

    /// Measures CPU against GPU once per model file on this machine.
    async fn fastest(&self, path: &str, ctx: i32, gpu_available: bool) -> Backend {
        if !gpu_available {
            return Backend::Cpu;
        }
        let mut cache: BTreeMap<String, String> =
            self.dirs.read_json(BENCH_FILE).unwrap_or_default();
        if let Some(b) = cache.get(path).and_then(|v| Backend::parse(v)) {
            return b;
        }
        info!("Measuring CPU and GPU speed (once for this model)");
        let mut speeds = [0.0f64; 2];
        for (i, b) in [Backend::Cpu, Backend::Gpu].into_iter().enumerate() {
            // a backend that cannot load or run loses
            if self.load_blocking(path, b, ctx, false).await.is_ok() {
                speeds[i] = self.benchmark().await;
            }
        }
        let pick = if speeds[1] > speeds[0] * GPU_MARGIN {
            Backend::Gpu
        } else {
            Backend::Cpu
        };
        info!(
            "CPU {:.1} tok/s, GPU {:.1} tok/s: using {}",
            speeds[0],
            speeds[1],
            pick.as_str().to_uppercase()
        );
        cache.insert(path.to_string(), pick.as_str().to_string());
        let _ = self.dirs.write_json(BENCH_FILE, &cache);
        pick
    }
}

/// The effective settings: admin override, else the node's own, per field.
fn wanted(i: &Inner) -> Prefs {
    Prefs {
        backend: i.admin.backend.or(i.local.backend),
        max_context_tokens: i.admin.max_context_tokens.or(i.local.max_context_tokens),
        enable_mtp: i.admin.enable_mtp.or(i.local.enable_mtp),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_context_follows_the_ram() {
        assert_eq!(auto_context(0), DEFAULT_CONTEXT);
        assert_eq!(auto_context(2048), 2048);
        assert_eq!(auto_context(8192), 4096);
        assert_eq!(auto_context(32768), 8192);
    }

    #[test]
    fn the_admin_override_wins_field_by_field() {
        let i = Inner {
            local: Prefs {
                backend: Some(Backend::Cpu),
                max_context_tokens: Some(2048),
                enable_mtp: None,
            },
            admin: Prefs {
                backend: Some(Backend::Gpu),
                max_context_tokens: None,
                enable_mtp: Some(true),
            },
            ..Inner::default()
        };
        assert_eq!(
            wanted(&i),
            Prefs {
                backend: Some(Backend::Gpu),
                max_context_tokens: Some(2048),
                enable_mtp: Some(true),
            }
        );
    }
}
