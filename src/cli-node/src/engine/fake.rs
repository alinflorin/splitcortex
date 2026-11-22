//! A fake engine for tests: answers with synthetic tokens at a fixed pace, and embeds into deterministic unit vectors,
//! so the gateway, the control plane and the protocol can be exercised (and measured) without a model, its download or
//! the machine's speed. Switched on by `run --fake` (hidden; see docs/cli-node.md). Everything else in the node is real:
//! enrollment, handshake, assignments, `ModelState`, credits, resume. Never use it in a pool that serves customers.

use super::{EmbedError, GenerateReq};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

/// Used when the request sets no limit.
const DEFAULT_TOKENS: i32 = 32;
/// Cancellation is checked at least this often while waiting.
const SLICE: Duration = Duration::from_millis(10);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FakeConfig {
    /// Delay before the first token.
    pub first_token_ms: u64,
    /// Pace after the first token; 0 = no delay at all.
    pub tokens_per_sec: u32,
    /// Length of the embedding vectors.
    pub dimension: u32,
}

impl Default for FakeConfig {
    fn default() -> Self {
        FakeConfig {
            first_token_ms: 20,
            tokens_per_sec: 200,
            dimension: 768,
        }
    }
}

/// What a fake engine has loaded.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Loaded {
    Chat,
    Embedding(u32),
}

/// Sleeps until `deadline`, waking early when `cancel` is set. Returns false when cancelled.
fn wait_until(deadline: Instant, cancel: &AtomicBool) -> bool {
    loop {
        if cancel.load(Ordering::SeqCst) {
            return false;
        }
        let now = Instant::now();
        if now >= deadline {
            return true;
        }
        std::thread::sleep((deadline - now).min(SLICE));
    }
}

/// Streams `tok0 tok1 …` (one piece per token, `max_tokens` of them) at the configured pace. Setting `cancel` ends it
/// early, normally, like the real engine.
pub fn generate(
    cfg: &FakeConfig,
    req: &GenerateReq,
    cancel: Arc<AtomicBool>,
    on_text: Box<dyn Fn(String) + Send>,
) -> Result<(), String> {
    let count = if req.max_tokens > 0 {
        req.max_tokens
    } else {
        DEFAULT_TOKENS
    };
    let start = Instant::now();
    let first = Duration::from_millis(cfg.first_token_ms);
    let gap = if cfg.tokens_per_sec == 0 {
        Duration::ZERO
    } else {
        Duration::from_secs_f64(1.0 / cfg.tokens_per_sec as f64)
    };
    for i in 0..count {
        // A schedule from the start, not a sleep per token: a slow wake-up does not slow the whole answer down.
        if !wait_until(start + first + gap * i as u32, &cancel) {
            return Ok(());
        }
        on_text(format!("tok{i} "));
    }
    Ok(())
}

/// A unit vector derived from the text (the same text always gives the same vector).
fn vector(text: &str, dimension: usize) -> Vec<f32> {
    let mut v = Vec::with_capacity(dimension);
    let mut counter = 0u32;
    while v.len() < dimension {
        let mut h = Sha256::new();
        h.update(text.as_bytes());
        h.update(counter.to_le_bytes());
        for b in h.finalize().as_chunks::<4>().0 {
            if v.len() == dimension {
                break;
            }
            let n = u32::from_le_bytes(*b);
            v.push(n as f32 / u32::MAX as f32 * 2.0 - 1.0);
        }
        counter += 1;
    }
    let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm > 0.0 {
        v.iter_mut().for_each(|x| *x /= norm);
    }
    v
}

pub fn embed(dimension: u32, texts: &[String]) -> Result<Vec<Vec<f32>>, EmbedError> {
    Ok(texts
        .iter()
        .map(|t| vector(t, dimension as usize))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    fn req(max_tokens: i32) -> GenerateReq {
        GenerateReq {
            messages: Vec::new(),
            max_tokens,
            temperature: 0.0,
            top_p: 0.0,
        }
    }

    fn run(cfg: FakeConfig, max_tokens: i32, cancel: Arc<AtomicBool>) -> Vec<String> {
        let out = Arc::new(Mutex::new(Vec::new()));
        let o = out.clone();
        generate(
            &cfg,
            &req(max_tokens),
            cancel,
            Box::new(move |t| o.lock().unwrap().push(t)),
        )
        .unwrap();
        out.lock().unwrap().clone()
    }

    #[test]
    fn it_streams_max_tokens_pieces() {
        let cfg = FakeConfig {
            first_token_ms: 0,
            tokens_per_sec: 0,
            dimension: 4,
        };
        assert_eq!(run(cfg, 3, Arc::default()), ["tok0 ", "tok1 ", "tok2 "]);
        assert_eq!(run(cfg, 0, Arc::default()).len(), DEFAULT_TOKENS as usize);
    }

    #[test]
    fn it_keeps_the_pace() {
        let cfg = FakeConfig {
            first_token_ms: 30,
            tokens_per_sec: 100,
            dimension: 4,
        };
        let t = Instant::now();
        assert_eq!(run(cfg, 11, Arc::default()).len(), 11);
        // 30 ms to the first token, then 10 gaps of 10 ms.
        assert!(t.elapsed() >= Duration::from_millis(125));
    }

    #[test]
    fn cancelling_ends_it_early_and_normally() {
        let cfg = FakeConfig {
            first_token_ms: 0,
            tokens_per_sec: 50,
            dimension: 4,
        };
        let cancel = Arc::new(AtomicBool::new(false));
        let c = cancel.clone();
        let stopper = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(60));
            c.store(true, Ordering::SeqCst);
        });
        let got = run(cfg, 1000, cancel);
        stopper.join().unwrap();
        assert!(!got.is_empty() && got.len() < 20);
    }

    #[test]
    fn vectors_are_unit_length_and_repeatable() {
        let v = embed(16, &["a".into(), "b".into(), "a".into()]).unwrap();
        assert_eq!(v[0].len(), 16);
        assert_eq!(v[0], v[2]);
        assert_ne!(v[0], v[1]);
        let norm: f32 = v[0].iter().map(|x| x * x).sum::<f32>().sqrt();
        assert!((norm - 1.0).abs() < 1e-5);
        assert_eq!(embed(1000, &["x".into()]).unwrap()[0].len(), 1000);
    }
}
