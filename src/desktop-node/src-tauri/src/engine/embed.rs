//! The embedding engine (`embedding_engine.h` of the LiteRT-LM C API): a separate engine and model file from the chat
//! engine, behind the same `Api`. The node holds either a chat model or an embedding model, never both (the web side
//! unloads one before it loads the other; `embedder_load` also drops the chat model). Inputs arrive already prefixed
//! for the task and vectors leave full length: prefixes and dimension truncation are done on the web side
//! (`src/engine/embedding.ts`). Text only. Not run against a real model yet.

use super::ffi::{self, Api, Handle};
use super::{Engine, api, cstr};
use serde::Serialize;
use std::ffi::c_void;
use std::ptr;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};

/// A loaded embedding model. Raw handles are only touched while the `Mutex` in `Engine` is held.
pub struct LoadedEmbedder {
    api: Arc<Api>,
    engine: Handle,
}
unsafe impl Send for LoadedEmbedder {}
impl Drop for LoadedEmbedder {
    fn drop(&mut self) {
        unsafe { (self.api.emb_engine_delete)(self.engine) };
    }
}

#[derive(Serialize)]
pub struct EmbedderInfo {
    dimension: usize,
}

fn create_embedder(api: &Arc<Api>, path: &str, cache_dir: &str) -> Result<LoadedEmbedder, String> {
    let (path, backend, cache) = (cstr(path)?, cstr("cpu")?, cstr(cache_dir)?);
    unsafe {
        let mut settings: Handle = ptr::null_mut();
        // No vision or audio backend: embedding models are used as text only.
        let st = (api.emb_settings_create)(
            path.as_ptr(),
            backend.as_ptr(),
            ptr::null(),
            ptr::null(),
            &mut settings,
        );
        if st != 0 {
            return Err(api.error("embedding settings", st));
        }
        let _ = (api.emb_settings_cache_dir)(settings, cache.as_ptr());
        let mut engine: Handle = ptr::null_mut();
        let st = (api.emb_engine_create)(settings, &mut engine);
        (api.emb_settings_delete)(settings);
        if st != 0 {
            return Err(api.error("embedding model load", st));
        }
        Ok(LoadedEmbedder {
            api: api.clone(),
            engine,
        })
    }
}

/// The vector length from the model file's metadata; `None` when the file does not say (then it is measured).
fn metadata_dimension(api: &Arc<Api>, path: &str) -> Option<usize> {
    let path = cstr(path).ok()?;
    unsafe {
        let mut file: Handle = ptr::null_mut();
        if (api.loaded_file_create)(path.as_ptr(), &mut file) != 0 {
            return None;
        }
        let mut dim: i32 = 0;
        let st = (api.loaded_file_embedding_dimension)(file, &mut dim);
        (api.loaded_file_delete)(file);
        (st == 0 && dim > 0).then_some(dim as usize)
    }
}

/// Embeds each text as its own request in one batch call. Vectors are L2-normalised by the library (its default).
fn run_embedding(
    api: &Arc<Api>,
    engine: Handle,
    texts: &[String],
) -> Result<Vec<Vec<f32>>, String> {
    if texts.is_empty() {
        return Ok(Vec::new());
    }
    let c_texts: Vec<_> = texts.iter().map(|t| cstr(t)).collect::<Result<_, _>>()?;
    let mut inputs: Vec<Handle> = Vec::new();
    let mut options: Handle = ptr::null_mut();
    let mut responses: Handle = ptr::null_mut();
    let result = (|| unsafe {
        for t in &c_texts {
            let mut h: Handle = ptr::null_mut();
            let st = (api.input_create)(
                ffi::INPUT_TEXT,
                t.as_ptr() as *const c_void,
                t.as_bytes().len(),
                &mut h,
            );
            if st != 0 {
                return Err(api.error("embedding input", st));
            }
            inputs.push(h);
        }
        let st = (api.emb_options_create)(&mut options);
        if st != 0 {
            return Err(api.error("embedding options", st));
        }
        (api.emb_options_normalize)(options, true);
        // Longer than the model's longest signature = an error, not a silent cut.
        (api.emb_options_overflow)(options, ffi::OVERFLOW_ERROR);
        // Request i has one input: inputs[i].
        let per_request: Vec<*const c_void> = inputs.iter().map(|h| *h as *const c_void).collect();
        let arrays: Vec<*const *const c_void> = (0..per_request.len())
            .map(|i| per_request.as_ptr().add(i))
            .collect();
        let counts = vec![1usize; per_request.len()];
        let st = (api.emb_compute_batch)(
            engine,
            arrays.as_ptr(),
            counts.as_ptr(),
            per_request.len(),
            options,
            &mut responses,
        );
        if st != 0 {
            // Over-long or invalid input is the client's mistake (the CLI node maps these two statuses the same way).
            let message = api.error("embedding", st);
            return Err(
                if st == ffi::STATUS_INVALID_ARGUMENT || st == ffi::STATUS_OUT_OF_RANGE {
                    format!("bad_input: {message}")
                } else {
                    message
                },
            );
        }
        let mut n = 0usize;
        let st = (api.emb_responses_size)(responses, &mut n);
        if st != 0 {
            return Err(api.error("embedding result", st));
        }
        let mut out = Vec::with_capacity(n);
        for i in 0..n {
            let mut r: Handle = ptr::null_mut();
            let st = (api.emb_responses_at)(responses, i, &mut r);
            if st != 0 {
                return Err(api.error("embedding result", st));
            }
            let (mut len, mut values): (usize, *const f32) = (0, ptr::null());
            let st = (api.emb_response_size)(r, &mut len);
            if st != 0 {
                return Err(api.error("embedding result", st));
            }
            let st = (api.emb_response_values)(r, &mut values);
            if st != 0 || values.is_null() || len == 0 {
                return Err(api.error("embedding result", st));
            }
            out.push(std::slice::from_raw_parts(values, len).to_vec());
        }
        Ok(out)
    })();
    unsafe {
        if !responses.is_null() {
            (api.emb_responses_delete)(responses);
        }
        if !options.is_null() {
            (api.emb_options_delete)(options);
        }
        for h in inputs {
            (api.input_delete)(h);
        }
    }
    result
}

#[tauri::command]
pub async fn embedder_load(
    app: AppHandle,
    state: State<'_, Arc<Engine>>,
    name: String,
) -> Result<EmbedderInfo, String> {
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
    // Memory: the chat model (if any) and a previous embedding model go before this one comes in.
    super::engine_unload(state.clone());
    *state.embedder.lock().unwrap_or_else(|x| x.into_inner()) = None;
    let loaded = tauri::async_runtime::spawn_blocking(move || {
        let loaded = create_embedder(&api, &path, &cache)?;
        let dimension = match metadata_dimension(&api, &path) {
            Some(d) => d,
            // The file does not say: embed one short text and take the vector's length.
            None => run_embedding(&api, loaded.engine, &["dimension probe".to_string()])?
                .first()
                .map(Vec::len)
                .filter(|d| *d > 0)
                .ok_or("the embedding model returned an empty vector")?,
        };
        Ok::<_, String>((loaded, dimension))
    })
    .await
    .map_err(|e| e.to_string())??;
    let (loaded, dimension) = loaded;
    *state.embedder.lock().unwrap_or_else(|x| x.into_inner()) = Some(loaded);
    Ok(EmbedderInfo { dimension })
}

#[tauri::command]
pub fn embedder_unload(state: State<'_, Arc<Engine>>) {
    // Waits for a running embedding to end (it holds the lock), then deletes the engine.
    *state.embedder.lock().unwrap_or_else(|x| x.into_inner()) = None;
}

#[tauri::command]
pub async fn embedder_embed(
    state: State<'_, Arc<Engine>>,
    inputs: Vec<String>,
) -> Result<Vec<Vec<f32>>, String> {
    let engine = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let guard = engine.embedder.lock().unwrap_or_else(|x| x.into_inner());
        let loaded = guard.as_ref().ok_or("no embedding model is loaded")?;
        run_embedding(&loaded.api, loaded.engine, &inputs)
    })
    .await
    .map_err(|e| e.to_string())?
}
