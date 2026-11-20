//! The official LiteRT-LM C API (`litert_lm_c_api`, headers in the release zip), loaded at run time with
//! `libloading`: no bindgen, no link-time dependency, and a build for a target Google ships no library for still
//! compiles (the engine then reports that it is unavailable). Only the functions the node uses are declared here.
//! Signatures follow `engine.h` / `conversation.h` of LiteRT-LM v0.19.1 (C API 1.0.0); handles are opaque pointers.

use libloading::Library;
use std::ffi::{CStr, c_char, c_int, c_void};
use std::path::Path;

pub type Status = c_int; // LiteRtLmStatusCode, 0 = ok
pub type Handle = *mut c_void;

pub const SAMPLER_TOP_P: c_int = 2;
pub const SPECULATIVE_ON: c_int = 1;
pub const LOG_SILENT: c_int = 1000;
/// `kLiteRtLmInputDataTypeText`.
pub const INPUT_TEXT: c_int = 0;
/// `kLiteRtLmInputOverflowStrategyError`: an input longer than the model's longest signature is an error.
pub const OVERFLOW_ERROR: c_int = 2;
pub const STATUS_INVALID_ARGUMENT: Status = 3;
pub const STATUS_OUT_OF_RANGE: Status = 11;

pub type StreamCallback = unsafe extern "C" fn(data: *mut c_void, chunk: *const c_void);

macro_rules! api {
    ($( $field:ident : $sym:literal = fn($($arg:ty),*) -> $ret:ty ;)*) => {
        /// Resolved C API entry points. The library stays loaded for as long as this value lives.
        pub struct Api {
            $( pub $field: unsafe extern "C" fn($($arg),*) -> $ret, )*
            // Never unloaded: the library's static destructors crash on dlclose, and it lives for the whole process.
            _lib: std::mem::ManuallyDrop<Library>,
        }
        impl Api {
            /// # Safety
            /// Loading a shared library runs its initialisers; the path must be the library the app ships.
            pub unsafe fn load(path: &Path) -> Result<Api, String> {
                let lib = unsafe { Library::new(path) }
                    .map_err(|e| format!("cannot load {}: {e}", path.display()))?;
                Ok(Api {
                    $( $field: *unsafe { lib.get::<unsafe extern "C" fn($($arg),*) -> $ret>(concat!($sym, "\0").as_bytes()) }
                        .map_err(|e| format!("{} missing in the engine library: {e}", $sym))?, )*
                    _lib: std::mem::ManuallyDrop::new(lib),
                })
            }
        }
    };
}

api! {
    set_min_log_level: "litert_lm_set_min_log_level" = fn(c_int) -> Status;
    last_error: "litert_lm_get_last_error_message" = fn() -> *const c_char;

    settings_create: "litert_lm_engine_settings_create" = fn(*const c_char, *const c_char, *const c_char, *const c_char, *mut Handle) -> Status;
    settings_delete: "litert_lm_engine_settings_delete" = fn(Handle) -> ();
    settings_max_tokens: "litert_lm_engine_settings_set_max_num_tokens" = fn(Handle, c_int) -> Status;
    settings_cache_dir: "litert_lm_engine_settings_set_cache_dir" = fn(Handle, *const c_char) -> Status;
    settings_speculative: "litert_lm_engine_settings_set_speculative_decoding_config" = fn(Handle, Handle) -> Status;
    spec_create: "litert_lm_speculative_decoding_config_create" = fn(*mut Handle) -> Status;
    spec_delete: "litert_lm_speculative_decoding_config_delete" = fn(Handle) -> ();
    spec_mode: "litert_lm_speculative_decoding_config_set_mode" = fn(Handle, c_int) -> Status;
    engine_create: "litert_lm_engine_create" = fn(Handle, *mut Handle) -> Status;
    engine_delete: "litert_lm_engine_delete" = fn(Handle) -> ();

    sampler_create: "litert_lm_sampler_params_create" = fn(c_int, *mut Handle) -> Status;
    sampler_delete: "litert_lm_sampler_params_delete" = fn(Handle) -> ();
    sampler_top_p: "litert_lm_sampler_params_set_top_p" = fn(Handle, f32) -> Status;
    sampler_temperature: "litert_lm_sampler_params_set_temperature" = fn(Handle, f32) -> Status;
    session_create: "litert_lm_session_config_create" = fn(*mut Handle) -> Status;
    session_delete: "litert_lm_session_config_delete" = fn(Handle) -> ();
    session_max_output: "litert_lm_session_config_set_max_output_tokens" = fn(Handle, c_int) -> Status;
    session_sampler: "litert_lm_session_config_set_sampler_params" = fn(Handle, Handle) -> Status;

    conv_config_create: "litert_lm_conversation_config_create" = fn(*mut Handle) -> Status;
    conv_config_delete: "litert_lm_conversation_config_delete" = fn(Handle) -> ();
    conv_config_session: "litert_lm_conversation_config_set_session_config" = fn(Handle, Handle) -> Status;
    conv_config_messages: "litert_lm_conversation_config_set_messages" = fn(Handle, *const c_char) -> Status;
    conv_create: "litert_lm_conversation_create" = fn(Handle, Handle, *mut Handle) -> Status;
    conv_delete: "litert_lm_conversation_delete" = fn(Handle) -> ();
    conv_send_stream: "litert_lm_conversation_send_message_stream" = fn(Handle, *const c_char, *const c_char, Handle, StreamCallback, *mut c_void) -> Status;
    conv_cancel: "litert_lm_conversation_cancel_process" = fn(Handle) -> Status;
    conv_wait: "litert_lm_conversation_wait_until_done" = fn(Handle) -> Status;

    chunk_text: "litert_lm_stream_chunk_get_text" = fn(*const c_void, *mut *const c_char) -> Status;
    chunk_final: "litert_lm_stream_chunk_is_final" = fn(*const c_void, *mut bool) -> Status;
    chunk_error: "litert_lm_stream_chunk_get_error" = fn(*const c_void, *mut *const c_char) -> Status;

    // Embedding engine (embedding_engine.h, model_info.h): a different engine and model file than the chat engine.
    input_create: "litert_lm_input_data_create" = fn(c_int, *const c_void, usize, *mut Handle) -> Status;
    input_delete: "litert_lm_input_data_delete" = fn(Handle) -> ();
    emb_settings_create: "litert_lm_embedding_engine_settings_create" = fn(*const c_char, *const c_char, *const c_char, *const c_char, *mut Handle) -> Status;
    emb_settings_delete: "litert_lm_embedding_engine_settings_delete" = fn(Handle) -> ();
    emb_settings_cache_dir: "litert_lm_embedding_engine_settings_set_cache_dir" = fn(Handle, *const c_char) -> Status;
    emb_engine_create: "litert_lm_embedding_engine_create" = fn(Handle, *mut Handle) -> Status;
    emb_engine_delete: "litert_lm_embedding_engine_delete" = fn(Handle) -> ();
    emb_options_create: "litert_lm_embedding_options_create" = fn(*mut Handle) -> Status;
    emb_options_delete: "litert_lm_embedding_options_delete" = fn(Handle) -> ();
    emb_options_normalize: "litert_lm_embedding_options_set_normalize" = fn(Handle, bool) -> Status;
    emb_options_overflow: "litert_lm_embedding_options_set_input_overflow_strategy" = fn(Handle, c_int) -> Status;
    emb_compute_batch: "litert_lm_embedding_engine_compute_embedding_batch" = fn(Handle, *const *const *const c_void, *const usize, usize, Handle, *mut Handle) -> Status;
    emb_responses_delete: "litert_lm_embedding_responses_delete" = fn(Handle) -> ();
    emb_responses_size: "litert_lm_embedding_responses_get_size" = fn(Handle, *mut usize) -> Status;
    emb_responses_at: "litert_lm_embedding_responses_get_at" = fn(Handle, usize, *mut Handle) -> Status;
    emb_response_size: "litert_lm_embedding_response_get_size" = fn(Handle, *mut usize) -> Status;
    emb_response_values: "litert_lm_embedding_response_get_values" = fn(Handle, *mut *const f32) -> Status;
    loaded_file_create: "litert_lm_loaded_file_create" = fn(*const c_char, *mut Handle) -> Status;
    loaded_file_delete: "litert_lm_loaded_file_delete" = fn(Handle) -> ();
    loaded_file_embedding_dimension: "litert_lm_loaded_file_embedding_dimension" = fn(Handle, *mut i32) -> Status;
}

impl Api {
    /// The library's message for the last failed call on this thread, or `fallback`.
    pub fn error(&self, fallback: &str, status: Status) -> String {
        let p = unsafe { (self.last_error)() };
        if p.is_null() {
            return format!("{fallback} (status {status})");
        }
        let msg = unsafe { CStr::from_ptr(p) }.to_string_lossy().into_owned();
        if msg.is_empty() {
            format!("{fallback} (status {status})")
        } else {
            format!("{fallback}: {msg}")
        }
    }
}
