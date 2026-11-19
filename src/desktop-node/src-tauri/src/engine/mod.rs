//! The inference engine: Google's LiteRT-LM through its official C API (`ffi.rs`), behind the same interface the web
//! side calls (`src/engine/native.ts`). One model at a time, one generation at a time. Prompts and completions pass
//! through here only to be generated and streamed back: nothing is logged or stored.
//!
//! **Not run against a real model yet.** Written from the C headers (v0.19.1); the points to verify on a machine are
//! listed in docs/desktop-node.md (the chunk format of the conversation stream, GPU backends, the MTP drafter).

mod ffi;

use ffi::{Api, Handle};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::ffi::{CString, c_void};
use std::path::PathBuf;
use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use tauri::{AppHandle, Manager, State, ipc::Channel};

#[cfg(target_os = "windows")]
const LIB_NAME: &str = "litert-lm.dll";
#[cfg(target_os = "macos")]
const LIB_NAME: &str = "liblitert-lm.dylib";
#[cfg(all(unix, not(target_os = "macos")))]
const LIB_NAME: &str = "liblitert-lm.so";

/// A loaded model. Raw handles are only touched while the `Mutex` in `Engine` is held.
struct Loaded {
    api: Arc<Api>,
    engine: Handle,
}
unsafe impl Send for Loaded {}
impl Drop for Loaded {
    fn drop(&mut self) {
        unsafe { (self.api.engine_delete)(self.engine) };
    }
}

#[derive(Default)]
pub struct Engine {
    api: Mutex<Option<Arc<Api>>>,
    loaded: Mutex<Option<Loaded>>,
    cancel: Arc<AtomicBool>,
}

fn library_path(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(p) = std::env::var("SPLITCORTEX_LITERT_LIB") {
        return Ok(PathBuf::from(p));
    }
    let dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let p = dir.join("litert").join(LIB_NAME);
    if p.exists() {
        Ok(p)
    } else {
        Err(format!(
            "The inference engine is not available in this build (no LiteRT-LM library for this platform: {}).",
            p.display()
        ))
    }
}

fn api(app: &AppHandle, e: &Engine) -> Result<Arc<Api>, String> {
    let mut g = e.api.lock().unwrap_or_else(|x| x.into_inner());
    if let Some(a) = g.as_ref() {
        return Ok(a.clone());
    }
    let a = Arc::new(unsafe { Api::load(&library_path(app)?)? });
    unsafe { (a.set_min_log_level)(ffi::LOG_SILENT) };
    *g = Some(a.clone());
    Ok(a)
}

fn cstr(s: &str) -> Result<CString, String> {
    CString::new(s).map_err(|_| "text contains a NUL byte".to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedInfo {
    backend: String,
    max_context_tokens: i32,
    /// `image` / `audio` when the model takes that input besides text.
    modalities: Vec<&'static str>,
}

fn create_engine(
    api: &Arc<Api>,
    path: &str,
    backend: &str,
    ctx: i32,
    mtp: bool,
    media: bool,
    cache_dir: &str,
) -> Result<Handle, String> {
    let (path, backend, cache) = (cstr(path)?, cstr(backend)?, cstr(cache_dir)?);
    // The vision and audio encoders run on the same backend as the model (null = that input is off).
    let encoder = if media { backend.as_ptr() } else { ptr::null() };
    unsafe {
        let mut settings: Handle = ptr::null_mut();
        let st = (api.settings_create)(
            path.as_ptr(),
            backend.as_ptr(),
            encoder,
            encoder,
            &mut settings,
        );
        if st != 0 {
            return Err(api.error("engine settings", st));
        }
        let mut spec: Handle = ptr::null_mut();
        let result = (|| {
            let st = (api.settings_max_tokens)(settings, ctx);
            if st != 0 {
                return Err(api.error("context window", st));
            }
            let _ = (api.settings_cache_dir)(settings, cache.as_ptr());
            if mtp {
                let st = (api.spec_create)(&mut spec);
                if st != 0 {
                    return Err(api.error("speculative decoding", st));
                }
                (api.spec_mode)(spec, ffi::SPECULATIVE_ON);
                let st = (api.settings_speculative)(settings, spec);
                if st != 0 {
                    return Err(api.error("speculative decoding", st));
                }
            }
            let mut engine: Handle = ptr::null_mut();
            let st = (api.engine_create)(settings, &mut engine);
            if st != 0 {
                return Err(api.error("model load", st));
            }
            Ok(engine)
        })();
        if !spec.is_null() {
            (api.spec_delete)(spec);
        }
        (api.settings_delete)(settings);
        result
    }
}

/// The library accepts an engine with the encoders on even for a model that has none, and only fails when the first
/// conversation is created ("tf_lite_audio_encoder_hw not found in the model"). Creating and dropping one conversation
/// here makes that case fall back to text only instead of failing every request.
fn probe_conversation(api: &Arc<Api>, engine: Handle) -> Result<(), String> {
    unsafe {
        let mut cfg: Handle = ptr::null_mut();
        let st = (api.conv_config_create)(&mut cfg);
        if st != 0 {
            return Err(api.error("conversation config", st));
        }
        let mut conv: Handle = ptr::null_mut();
        let st = (api.conv_create)(engine, cfg, &mut conv);
        let result = if st != 0 {
            Err(api.error("conversation", st))
        } else {
            (api.conv_delete)(conv);
            Ok(())
        };
        (api.conv_config_delete)(cfg);
        result
    }
}

/// Loads a model with the best settings the library accepts: image and audio input first (a model without the
/// encoders, or a device without the memory for them, is rejected), then text only; with MTP first, then without.
/// Returns the engine and whether media input is on.
fn create_best(
    api: &Arc<Api>,
    path: &str,
    backend: &str,
    ctx: i32,
    mtp: bool,
    cache_dir: &str,
) -> Result<(Handle, bool), String> {
    let mut last = String::new();
    for media in [true, false] {
        for mtp in if mtp { vec![true, false] } else { vec![false] } {
            match create_engine(api, path, backend, ctx, mtp, media, cache_dir) {
                Ok(e) => match if media {
                    probe_conversation(api, e)
                } else {
                    Ok(())
                } {
                    Ok(()) => return Ok((e, media)),
                    Err(why) => {
                        unsafe { (api.engine_delete)(e) };
                        last = why;
                    }
                },
                Err(e) => last = e,
            }
        }
    }
    Err(last)
}

/// The input modalities beyond text of a loaded model.
fn modalities(media: bool) -> Vec<&'static str> {
    if media {
        vec!["image", "audio"]
    } else {
        Vec::new()
    }
}

#[tauri::command]
pub async fn engine_load(
    app: AppHandle,
    state: State<'_, Arc<Engine>>,
    name: String,
    backend: String,
    max_context_tokens: i32,
    mtp: bool,
) -> Result<LoadedInfo, String> {
    if backend != "cpu" && backend != "gpu" {
        return Err("backend must be cpu or gpu".into());
    }
    let path = crate::storage::model_path(&app, &name)?;
    if !path.exists() {
        return Err("the model file does not exist".into());
    }
    let api = api(&app, &state)?;
    let cache = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("litert");
    std::fs::create_dir_all(&cache).map_err(|e| e.to_string())?;
    let (path, cache) = (
        path.to_string_lossy().into_owned(),
        cache.to_string_lossy().into_owned(),
    );
    let api2 = api.clone();
    let backend2 = backend.clone();
    let loaded = tauri::async_runtime::spawn_blocking(move || {
        // A model without a drafter ignores MTP; one the library rejects loads again without it.
        let (engine, media) =
            create_best(&api2, &path, &backend2, max_context_tokens, mtp, &cache)?;
        Ok::<(Loaded, bool), String>((Loaded { api: api2, engine }, media))
    })
    .await
    .map_err(|e| e.to_string())??;
    let (loaded, media) = loaded;
    *state.loaded.lock().unwrap_or_else(|x| x.into_inner()) = Some(loaded);
    Ok(LoadedInfo {
        backend,
        max_context_tokens,
        modalities: modalities(media),
    })
}

#[tauri::command]
pub fn engine_unload(state: State<'_, Arc<Engine>>) {
    state.cancel.store(true, Ordering::SeqCst);
    // Waits for a running generation to end (it holds the lock), then drops (deletes) the engine.
    *state.loaded.lock().unwrap_or_else(|x| x.into_inner()) = None;
}

#[tauri::command]
pub fn engine_cancel(state: State<'_, Arc<Engine>>) {
    state.cancel.store(true, Ordering::SeqCst);
}

/// One piece of a message with media (the bytes are base64, as the engine's JSON message format takes them).
#[derive(Deserialize, Clone)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Part {
    Text { text: String },
    Image { data: String },
    Audio { data: String },
}

#[derive(Deserialize, Clone)]
pub struct Message {
    pub role: String,
    pub content: String,
    /// Set when the message has media: every part in order, text included (then it replaces `content`).
    #[serde(default)]
    pub parts: Vec<Part>,
}

impl Message {
    /// The engine's JSON message: `content` is the text, or the list of typed parts when there is media.
    fn to_json(&self) -> Value {
        if self.parts.is_empty() {
            return json!({"role": self.role, "content": self.content});
        }
        let parts: Vec<Value> = self
            .parts
            .iter()
            .map(|p| match p {
                Part::Text { text } => json!({"type": "text", "text": text}),
                Part::Image { data } => json!({"type": "image", "blob": data}),
                Part::Audio { data } => json!({"type": "audio", "blob": data}),
            })
            .collect();
        json!({"role": self.role, "content": parts})
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateReq {
    messages: Vec<Message>,
    max_tokens: i32,
    temperature: f32,
    top_p: f32,
}

/// The text of a streamed chunk. The conversation API streams JSON messages (`content` is a string or a list of
/// typed parts); a chunk that is not a JSON object is taken as plain text.
fn chunk_text(raw: &str) -> String {
    match serde_json::from_str::<Value>(raw) {
        Ok(Value::Object(o)) => match o.get("content") {
            Some(Value::String(s)) => s.clone(),
            Some(Value::Array(parts)) => parts
                .iter()
                .filter(|p| p.get("type").and_then(Value::as_str) == Some("text"))
                .filter_map(|p| p.get("text").and_then(Value::as_str))
                .collect(),
            _ => String::new(),
        },
        _ => raw.to_string(),
    }
}

struct StreamCtx {
    api: Arc<Api>,
    conv: Handle,
    cancel: Arc<AtomicBool>,
    cancelled: bool,
    done: bool,
    on_text: Box<dyn Fn(String) + Send>,
    tx: mpsc::Sender<Result<(), String>>,
}

unsafe extern "C" fn on_chunk(data: *mut c_void, chunk: *const c_void) {
    let _ = std::panic::catch_unwind(|| {
        let ctx = unsafe { &mut *(data as *mut StreamCtx) };
        if ctx.done {
            return;
        }
        let api = ctx.api.clone();
        let (mut text, mut err): (*const std::ffi::c_char, *const std::ffi::c_char) =
            (ptr::null(), ptr::null());
        let mut fin = false;
        unsafe {
            (api.chunk_text)(chunk, &mut text);
            (api.chunk_final)(chunk, &mut fin);
            (api.chunk_error)(chunk, &mut err);
        }
        if !err.is_null() {
            let msg = unsafe { std::ffi::CStr::from_ptr(err) }
                .to_string_lossy()
                .into_owned();
            if !msg.is_empty() {
                ctx.done = true;
                let _ = ctx.tx.send(Err(msg));
                return;
            }
        }
        if !text.is_null() {
            let raw = unsafe { std::ffi::CStr::from_ptr(text) }.to_string_lossy();
            let piece = chunk_text(&raw);
            if !piece.is_empty() && !ctx.cancelled {
                (ctx.on_text)(piece);
            }
        }
        if fin {
            ctx.done = true;
            let _ = ctx.tx.send(Ok(()));
        } else if ctx.cancel.load(Ordering::SeqCst) && !ctx.cancelled {
            // Allowed from inside a callback while the chunk is not final; the conversation is only deleted after.
            ctx.cancelled = true;
            unsafe { (api.conv_cancel)(ctx.conv) };
        }
    });
}

fn run_generation(
    api: &Arc<Api>,
    engine: Handle,
    req: &GenerateReq,
    cancel: Arc<AtomicBool>,
    on_text: Box<dyn Fn(String) + Send>,
) -> Result<(), String> {
    let (last, history) = req
        .messages
        .split_last()
        .ok_or("the request has no messages")?;
    let history_json =
        cstr(&Value::Array(history.iter().map(Message::to_json).collect()).to_string())?;
    let last_json = cstr(&last.to_json().to_string())?;

    let mut handles: Vec<(Handle, unsafe extern "C" fn(Handle))> = Vec::new();
    let cleanup = |hs: &mut Vec<(Handle, unsafe extern "C" fn(Handle))>| {
        while let Some((h, del)) = hs.pop() {
            unsafe { del(h) };
        }
    };
    let result = (|| unsafe {
        let mut session: Handle = ptr::null_mut();
        let st = (api.session_create)(&mut session);
        if st != 0 {
            return Err(api.error("session config", st));
        }
        handles.push((session, api.session_delete));
        if req.max_tokens > 0 {
            (api.session_max_output)(session, req.max_tokens);
        }
        if req.temperature > 0.0 || req.top_p > 0.0 {
            let mut sampler: Handle = ptr::null_mut();
            if (api.sampler_create)(ffi::SAMPLER_TOP_P, &mut sampler) == 0 {
                handles.push((sampler, api.sampler_delete));
                if req.temperature > 0.0 {
                    (api.sampler_temperature)(sampler, req.temperature);
                }
                if req.top_p > 0.0 {
                    (api.sampler_top_p)(sampler, req.top_p);
                }
                (api.session_sampler)(session, sampler);
            }
        }
        let mut cfg: Handle = ptr::null_mut();
        let st = (api.conv_config_create)(&mut cfg);
        if st != 0 {
            return Err(api.error("conversation config", st));
        }
        handles.push((cfg, api.conv_config_delete));
        (api.conv_config_session)(cfg, session);
        if !history.is_empty() {
            let st = (api.conv_config_messages)(cfg, history_json.as_ptr());
            if st != 0 {
                return Err(api.error("conversation history", st));
            }
        }
        let mut conv: Handle = ptr::null_mut();
        let st = (api.conv_create)(engine, cfg, &mut conv);
        if st != 0 {
            return Err(api.error("conversation", st));
        }
        handles.push((conv, api.conv_delete));

        let (tx, rx) = mpsc::channel();
        let mut ctx = Box::new(StreamCtx {
            api: api.clone(),
            conv,
            cancel,
            cancelled: false,
            done: false,
            on_text,
            tx,
        });
        let st = (api.conv_send_stream)(
            conv,
            last_json.as_ptr(),
            ptr::null(),
            ptr::null_mut(),
            on_chunk,
            &mut *ctx as *mut StreamCtx as *mut c_void,
        );
        if st != 0 {
            return Err(api.error("generation", st));
        }
        let outcome = rx
            .recv()
            .map_err(|_| "the engine stopped without finishing".to_string())?;
        (api.conv_wait)(conv);
        outcome
    })();
    cleanup(&mut handles);
    result
}

/// Streams the answer as text pieces through `on_text`. A cancelled generation ends normally (the caller knows).
#[tauri::command]
pub async fn engine_generate(
    state: State<'_, Arc<Engine>>,
    req: GenerateReq,
    on_text: Channel<String>,
) -> Result<(), String> {
    let engine = state.inner().clone();
    let cancel = engine.cancel.clone();
    cancel.store(false, Ordering::SeqCst);
    // The generation holds the lock for its whole run: unload waits for it.
    tauri::async_runtime::spawn_blocking(move || {
        let guard = engine.loaded.lock().unwrap_or_else(|x| x.into_inner());
        let loaded = guard.as_ref().ok_or("no model is loaded")?;
        run_generation(
            &loaded.api,
            loaded.engine,
            &req,
            cancel,
            Box::new(move |t| {
                let _ = on_text.send(t);
            }),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Caps {
    gpu_available: bool,
    emulator: bool,
    total_memory_mb: u64,
}

/// A GPU is assumed usable where the platform's GPU API is part of the OS (Metal, Direct3D 12) or its loader is
/// installed (Vulkan on Linux). This only gates the automatic CPU-against-GPU measurement; an admin or the user can
/// still force a backend, and a failed load steps back to the CPU.
fn gpu_present() -> bool {
    if cfg!(any(target_os = "macos", target_os = "windows")) {
        return true;
    }
    unsafe { libloading::Library::new("libvulkan.so.1") }.is_ok()
}

#[tauri::command]
pub fn engine_caps() -> Caps {
    let total = sysinfo::System::new()
        .map(|mut sys| {
            sys.refresh_memory();
            sys.total_memory()
        })
        .unwrap_or(0);
    Caps {
        gpu_available: gpu_present(),
        emulator: false,
        total_memory_mb: total / (1024 * 1024),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every function the node uses must exist in the library the build ships (skipped when it was not fetched).
    #[test]
    fn the_shipped_library_has_every_function() {
        let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("resources/litert")
            .join(LIB_NAME);
        if !p.exists() {
            eprintln!("skipped: {} not fetched", p.display());
            return;
        }
        let api = unsafe { Api::load(&p) }.expect("library loads and exports every function");
        assert!(unsafe { (api.set_min_log_level)(ffi::LOG_SILENT) } == 0);
    }

    #[test]
    fn chunk_text_reads_json_messages_and_plain_text() {
        assert_eq!(chunk_text(r#"{"role":"assistant","content":"Hi"}"#), "Hi");
        assert_eq!(
            chunk_text(
                r#"{"role":"assistant","content":[{"type":"text","text":"a"},{"type":"image"},{"type":"text","text":"b"}]}"#
            ),
            "ab"
        );
        assert_eq!(chunk_text(r#"{"role":"assistant"}"#), "");
        assert_eq!(chunk_text("plain"), "plain");
        assert_eq!(chunk_text("42"), "42");
    }

    #[test]
    fn plain_messages_keep_a_string_and_media_becomes_typed_parts() {
        let plain = Message {
            role: "user".into(),
            content: "hi".into(),
            parts: Vec::new(),
        };
        assert_eq!(plain.to_json(), json!({"role": "user", "content": "hi"}));
        let media = Message {
            role: "user".into(),
            content: "look".into(),
            parts: vec![
                Part::Text {
                    text: "look".into(),
                },
                Part::Image {
                    data: "AQI=".into(),
                },
                Part::Audio {
                    data: "Aw==".into(),
                },
            ],
        };
        assert_eq!(
            media.to_json(),
            json!({"role": "user", "content": [
                {"type": "text", "text": "look"},
                {"type": "image", "blob": "AQI="},
                {"type": "audio", "blob": "Aw=="},
            ]})
        );
        // the web side sends `parts` with a `type` tag and base64 `data`
        let m: Message = serde_json::from_str(
            r#"{"role":"user","content":"x","parts":[{"type":"image","data":"AQI="}]}"#,
        )
        .unwrap();
        assert!(matches!(m.parts[0], Part::Image { .. }));
        let old: Message = serde_json::from_str(r#"{"role":"user","content":"x"}"#).unwrap();
        assert!(old.parts.is_empty());
    }

    #[test]
    fn modalities_follow_the_encoders() {
        assert_eq!(modalities(true), vec!["image", "audio"]);
        assert!(modalities(false).is_empty());
    }
}
