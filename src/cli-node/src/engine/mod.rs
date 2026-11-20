//! The inference engine: Google's LiteRT-LM through its official C API (`ffi.rs`). One model at a time, one generation
//! at a time. Prompts and completions pass through here only to be generated and streamed back: nothing is logged or
//! stored. Blocking calls (run them on a blocking thread).
//!
//! The binding is this crate's own (the desktop app it came from was removed). **Not run against a real model yet.**

pub mod compute;
pub mod embed;
mod ffi;

use embed::{EmbedError, Embedder};
use ffi::{Api, Handle};
use serde::Deserialize;
use serde_json::{Value, json};
use std::ffi::{CString, c_void};
use std::path::{Path, PathBuf};
use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, mpsc};

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

/// A loaded embedding model (the library's embedding engine, never the chat engine) and the length of its vectors.
struct LoadedEmbed {
    api: Arc<Api>,
    engine: Handle,
    options: Handle,
    dimension: u32,
}
unsafe impl Send for LoadedEmbed {}
impl Drop for LoadedEmbed {
    fn drop(&mut self) {
        unsafe {
            (self.api.emb_options_delete)(self.options);
            (self.api.emb_engine_delete)(self.engine);
        }
    }
}

#[derive(Default)]
pub struct Engine {
    api: Mutex<Option<Arc<Api>>>,
    loaded: Mutex<Option<Loaded>>,
    /// At most one of `loaded` and `embedder` is set: a pool serves one kind of model.
    embedder: Mutex<Option<LoadedEmbed>>,
    /// The loaded model takes image and audio input.
    media: AtomicBool,
}

/// Where the library is: `SPLITCORTEX_LITERT_LIB`, else `litert/` next to the executable (what the release archive
/// and the install script lay out).
fn library_path() -> Result<PathBuf, String> {
    if let Ok(p) = std::env::var("SPLITCORTEX_LITERT_LIB") {
        return Ok(PathBuf::from(p));
    }
    let exe = std::env::current_exe()
        .and_then(|p| p.canonicalize())
        .map_err(|e| e.to_string())?;
    let p = exe
        .parent()
        .ok_or("cannot find the executable's folder")?
        .join("litert")
        .join(LIB_NAME);
    if p.exists() {
        Ok(p)
    } else {
        Err(format!(
            "The inference engine is not available in this build (no LiteRT-LM library for this platform: {}).",
            p.display()
        ))
    }
}

fn cstr(s: &str) -> Result<CString, String> {
    CString::new(s).map_err(|_| "text contains a NUL byte".to_string())
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
#[derive(Deserialize, Clone)]
pub struct GenerateReq {
    pub messages: Vec<Message>,
    pub max_tokens: i32,
    pub temperature: f32,
    pub top_p: f32,
}

impl Engine {
    fn api(&self) -> Result<Arc<Api>, String> {
        let mut g = self.api.lock().unwrap_or_else(|x| x.into_inner());
        if let Some(a) = g.as_ref() {
            return Ok(a.clone());
        }
        let a = Arc::new(unsafe { Api::load(&library_path()?) }?);
        unsafe { (a.set_min_log_level)(ffi::LOG_SILENT) };
        *g = Some(a.clone());
        Ok(a)
    }

    /// Loads the model file (replacing any loaded one). `backend` is `cpu` or `gpu`.
    pub fn load(
        &self,
        path: &Path,
        backend: &str,
        max_context_tokens: i32,
        mtp: bool,
        cache_dir: &Path,
    ) -> Result<(), String> {
        if backend != "cpu" && backend != "gpu" {
            return Err("backend must be cpu or gpu".into());
        }
        if !path.exists() {
            return Err("the model file does not exist".into());
        }
        let api = self.api()?;
        std::fs::create_dir_all(cache_dir).map_err(|e| e.to_string())?;
        self.unload();
        let (path, cache) = (
            path.to_string_lossy().into_owned(),
            cache_dir.to_string_lossy().into_owned(),
        );
        // A model without a drafter ignores MTP; one the library rejects loads again without it.
        let (engine, media) = create_best(&api, &path, backend, max_context_tokens, mtp, &cache)?;
        self.media.store(media, Ordering::SeqCst);
        *self.loaded.lock().unwrap_or_else(|x| x.into_inner()) = Some(Loaded { api, engine });
        Ok(())
    }

    /// Waits for a running generation to end (it holds the lock), then deletes the engine.
    pub fn unload(&self) {
        *self.loaded.lock().unwrap_or_else(|x| x.into_inner()) = None;
        *self.embedder.lock().unwrap_or_else(|x| x.into_inner()) = None;
        self.media.store(false, Ordering::SeqCst);
    }

    /// Loads an embedding model into the embedding engine (unloading whatever is loaded first, for the memory) and
    /// returns the length of its vectors. `backend` is `cpu` or `gpu`.
    pub fn load_embedding(
        &self,
        path: &Path,
        backend: &str,
        cache_dir: &Path,
    ) -> Result<u32, String> {
        if backend != "cpu" && backend != "gpu" {
            return Err("backend must be cpu or gpu".into());
        }
        if !path.exists() {
            return Err("the model file does not exist".into());
        }
        let api = self.api()?;
        std::fs::create_dir_all(cache_dir).map_err(|e| e.to_string())?;
        self.unload();
        let (path, backend, cache) = (
            cstr(&path.to_string_lossy())?,
            cstr(backend)?,
            cstr(&cache_dir.to_string_lossy())?,
        );
        unsafe {
            let mut settings: Handle = ptr::null_mut();
            let st = (api.emb_settings_create)(
                path.as_ptr(),
                backend.as_ptr(),
                ptr::null(),
                ptr::null(),
                &mut settings,
            );
            if st != 0 {
                return Err(api.error("embedding engine settings", st));
            }
            let _ = (api.emb_settings_cache_dir)(settings, cache.as_ptr());
            let mut engine: Handle = ptr::null_mut();
            let st = (api.emb_engine_create)(settings, &mut engine);
            (api.emb_settings_delete)(settings);
            if st != 0 {
                return Err(api.error("embedding model load", st));
            }
            let mut options: Handle = ptr::null_mut();
            let st = (api.emb_options_create)(&mut options);
            if st != 0 {
                (api.emb_engine_delete)(engine);
                return Err(api.error("embedding options", st));
            }
            // Unit-length vectors (the default, stated), and a text longer than the model takes is an error, not a
            // silently shortened or averaged one.
            (api.emb_options_normalize)(options, true);
            (api.emb_options_overflow)(options, ffi::OVERFLOW_ERROR);
            let mut loaded = LoadedEmbed {
                api: api.clone(),
                engine,
                options,
                dimension: 0,
            };
            loaded.dimension = match embedding_dimension(&api, &path) {
                Some(d) => d,
                // The file's metadata does not say: embed one text and count.
                None => probe_dimension(&loaded)?,
            };
            let dimension = loaded.dimension;
            *self.embedder.lock().unwrap_or_else(|x| x.into_inner()) = Some(loaded);
            Ok(dimension)
        }
    }

    /// The inputs besides text the loaded model accepts (`image`, `audio`; none when text only or nothing is loaded).
    pub fn modalities(&self) -> Vec<&'static str> {
        modalities(self.media.load(Ordering::SeqCst))
    }

    /// Streams the answer as text pieces through `on_text`. Setting `cancel` ends it early, normally.
    pub fn generate(
        &self,
        req: &GenerateReq,
        cancel: Arc<AtomicBool>,
        on_text: Box<dyn Fn(String) + Send>,
    ) -> Result<(), String> {
        // The generation holds the lock for its whole run: unload waits for it.
        let guard = self.loaded.lock().unwrap_or_else(|x| x.into_inner());
        let loaded = guard.as_ref().ok_or("no model is loaded")?;
        run_generation(&loaded.api, loaded.engine, req, cancel, on_text)
    }
}

/// The vector length the model file declares (`None` when it does not say).
fn embedding_dimension(api: &Arc<Api>, path: &CString) -> Option<u32> {
    unsafe {
        let mut file: Handle = ptr::null_mut();
        if (api.loaded_file_create)(path.as_ptr(), &mut file) != 0 {
            return None;
        }
        let mut dim: i32 = 0;
        let st = (api.loaded_file_embedding_dimension)(file, &mut dim);
        (api.loaded_file_delete)(file);
        (st == 0 && dim > 0).then_some(dim as u32)
    }
}

fn probe_dimension(l: &LoadedEmbed) -> Result<u32, String> {
    let v = compute_embeddings(l, &["probe".to_string()]).map_err(|e| e.message)?;
    match v.first() {
        Some(v) if !v.is_empty() => Ok(v.len() as u32),
        _ => Err("the embedding model returned an empty vector".into()),
    }
}

/// Embeds every text in one batch call. Texts go in as they are (the caller has written the task prefix).
fn compute_embeddings(l: &LoadedEmbed, texts: &[String]) -> Result<Vec<Vec<f32>>, EmbedError> {
    let api = &l.api;
    let fail = |what: &str, st: ffi::Status| {
        let message = api.error(what, st);
        if st == ffi::STATUS_INVALID_ARGUMENT || st == ffi::STATUS_OUT_OF_RANGE {
            EmbedError::bad_input(message)
        } else {
            EmbedError::engine(message)
        }
    };
    // One input per batch item. The input data owns a copy of the text.
    let mut data: Vec<Handle> = Vec::with_capacity(texts.len());
    let free = |data: &mut Vec<Handle>| {
        for h in data.drain(..) {
            unsafe { (api.input_delete)(h) };
        }
    };
    for t in texts {
        let mut h: Handle = ptr::null_mut();
        let st = unsafe {
            (api.input_create)(
                ffi::INPUT_TEXT,
                t.as_ptr() as *const c_void,
                t.len(),
                &mut h,
            )
        };
        if st != 0 {
            free(&mut data);
            return Err(fail("embedding input", st));
        }
        data.push(h);
    }
    let items: Vec<*const c_void> = data.iter().map(|h| *h as *const c_void).collect();
    let batch: Vec<*const *const c_void> = (0..items.len())
        .map(|i| unsafe { items.as_ptr().add(i) })
        .collect();
    let counts = vec![1usize; texts.len()];
    let mut responses: Handle = ptr::null_mut();
    let st = unsafe {
        (api.emb_compute_batch)(
            l.engine,
            batch.as_ptr(),
            counts.as_ptr(),
            texts.len(),
            l.options,
            &mut responses,
        )
    };
    free(&mut data);
    if st != 0 {
        return Err(fail("embedding", st));
    }
    let result = (|| unsafe {
        let mut n = 0usize;
        let st = (api.emb_responses_size)(responses, &mut n);
        if st != 0 {
            return Err(fail("embedding result", st));
        }
        let mut out = Vec::with_capacity(n);
        for i in 0..n {
            let mut r: Handle = ptr::null_mut();
            let st = (api.emb_responses_at)(responses, i, &mut r);
            if st != 0 {
                return Err(fail("embedding result", st));
            }
            let (mut len, mut vals) = (0usize, ptr::null::<f32>());
            let st = (api.emb_response_size)(r, &mut len);
            if st != 0 {
                return Err(fail("embedding result", st));
            }
            let st = (api.emb_response_values)(r, &mut vals);
            if st != 0 || (vals.is_null() && len > 0) {
                return Err(fail("embedding result", st));
            }
            // The response owns the floats and dies with the collection: copy them out.
            out.push(if len == 0 {
                Vec::new()
            } else {
                std::slice::from_raw_parts(vals, len).to_vec()
            });
        }
        Ok(out)
    })();
    unsafe { (api.emb_responses_delete)(responses) };
    result
}

impl Embedder for Engine {
    fn embed_batch(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, EmbedError> {
        // The embedding holds the lock for its whole run: unload waits for it.
        let guard = self.embedder.lock().unwrap_or_else(|x| x.into_inner());
        let loaded = guard
            .as_ref()
            .ok_or_else(|| EmbedError::engine("no embedding model is loaded"))?;
        compute_embeddings(loaded, texts)
    }
}

/// What the machine can do.
pub struct Caps {
    pub gpu_available: bool,
    pub total_memory_mb: u64,
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

pub fn caps() -> Caps {
    let total = sysinfo::System::new()
        .map(|mut sys| {
            sys.refresh_memory();
            sys.total_memory()
        })
        .unwrap_or(0);
    Caps {
        gpu_available: gpu_present(),
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
            .join("litert")
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
