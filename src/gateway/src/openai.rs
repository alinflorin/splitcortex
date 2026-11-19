//! The client leg: the OpenAI wire format (`/v1/chat/completions` with SSE, `/v1/models`), translated to the node
//! protocol. Every request is authenticated by API key hash, resolved to a pool from the `model`, routed to a ready
//! node of that pool and metered (tokens counted by the gateway itself).

use std::convert::Infallible;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::body::Bytes;
use axum::extract::State;
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::sse::{Event, Sse};
use axum::response::{IntoResponse, Response};
use axum::Json;
use futures_util::stream::{self, Stream};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::cache::{fetch_key, KeyRec, ModelRec, PoolRec};
use crate::cluster;
use crate::i18n::{Lang, Tr};
use crate::limits::Subject;
use crate::proto::envelope::Body;
use crate::proto::{self, Envelope};
use crate::registry::{self, NodeConn, NodeEvent, Outbound};
use crate::state::AppState;

const FIRST_EVENT_TIMEOUT: Duration = Duration::from_secs(120);
const EVENT_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Clone, Debug)]
pub struct ApiError {
    status: StatusCode,
    kind: &'static str,
    code: &'static str,
    message: Tr,
    retry_after: Option<u32>,
}

impl ApiError {
    fn new(status: StatusCode, kind: &'static str, code: &'static str, message: Tr) -> Self {
        Self {
            status,
            kind,
            code,
            message,
            retry_after: None,
        }
    }
    pub fn status(status: StatusCode, code: &'static str, message: Tr) -> Self {
        Self::new(status, "invalid_request_error", code, message)
    }
    fn too_many(what: &str, retry_after: u32) -> Self {
        let what = match what {
            "requests per minute" => "limit.requests_per_minute",
            "tokens per minute" => "limit.tokens_per_minute",
            _ => "limit.tokens_per_day",
        };
        let mut e = Self::new(
            StatusCode::TOO_MANY_REQUESTS,
            "rate_limit_error",
            "rate_limit_exceeded",
            Tr::new("rate_limited").word("what", what).arg("secs", retry_after),
        );
        e.retry_after = Some(retry_after);
        e
    }
    fn unavailable(message: Tr) -> Self {
        let mut e = Self::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "server_error",
            "service_unavailable",
            message,
        );
        e.retry_after = Some(5);
        e
    }

    /// The OpenAI-format error response in `lang`.
    pub fn respond(&self, lang: Lang) -> Response {
        let body = json!({ "error": { "message": self.message.render(lang), "type": self.kind, "param": null, "code": self.code } });
        let mut res = (self.status, Json(body)).into_response();
        if let Some(s) = self.retry_after {
            res.headers_mut().insert(header::RETRY_AFTER, HeaderValue::from(s));
        }
        res.headers_mut()
            .insert(header::CONTENT_LANGUAGE, HeaderValue::from_static(lang.tag()));
        res
    }
}

/// Rendered in English here; the `localize` layer re-renders it in the request's language (the error rides along in the
/// response extensions).
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let mut res = self.respond(Lang::En);
        res.extensions_mut().insert(self);
        res
    }
}

/// Middleware: answers an `ApiError` in the language of the request's `Accept-Language`.
pub async fn localize(request: axum::extract::Request, next: axum::middleware::Next) -> Response {
    let lang = Lang::from_headers(request.headers());
    let res = next.run(request).await;
    match res.extensions().get::<ApiError>() {
        Some(e) if lang != Lang::En => e.respond(lang),
        _ => res,
    }
}

/// Audit event about an API key (one row per key and minute at most, see `audit.rs`; never per request).
fn key_event(app: &AppState, key: &KeyRec, action: &'static str, metadata: serde_json::Value) {
    app.audit.record(crate::audit::Event {
        org: key.org_id,
        actor_type: "api_key",
        actor_id: Some(key.id.to_string()),
        action,
        entity_type: "api_key",
        entity_id: Some(key.id.to_string()),
        outcome: "denied",
        metadata,
    });
}

fn unauthorized() -> ApiError {
    ApiError::new(
        StatusCode::UNAUTHORIZED,
        "invalid_request_error",
        "invalid_api_key",
        Tr::new("invalid_api_key"),
    )
}

async fn authenticate(app: &Arc<AppState>, headers: &HeaderMap) -> Result<KeyRec, ApiError> {
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(str::trim)
        .filter(|t| t.starts_with("sc_") && t.len() < 256)
        .ok_or_else(unauthorized)?;
    let hash: String = Sha256::digest(token.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();

    let cached = app.cache.read().unwrap().keys.get(&hash).cloned();
    let key = match cached {
        Some(k) => k,
        None => {
            {
                let mut neg = app.unknown_keys.lock().unwrap();
                neg.retain(|_, t| t.elapsed() < Duration::from_secs(10));
                if neg.contains_key(&hash) {
                    return Err(unauthorized());
                }
            }
            match fetch_key(&app.db, &hash).await {
                Ok(Some(k)) => {
                    app.cache.write().unwrap().keys.insert(hash.clone(), k.clone());
                    k
                }
                Ok(None) => {
                    app.unknown_keys.lock().unwrap().insert(hash, Instant::now());
                    return Err(unauthorized());
                }
                Err(_) => return Err(ApiError::unavailable(Tr::new("temporarily_unavailable"))),
            }
        }
    };
    let expired = key.expires_at.is_some_and(|e| e <= chrono::Utc::now());
    if key.revoked || expired {
        // The key is known, so the organisation is too (unknown keys have none and are not audited).
        key_event(
            app,
            &key,
            "api_key.rejected",
            json!({ "reason": if key.revoked { "revoked" } else { "expired" } }),
        );
        return Err(unauthorized());
    }
    touch(app, key.id);
    Ok(key)
}

/// `last_used_at`, written at most once a minute per key.
fn touch(app: &Arc<AppState>, key: Uuid) {
    {
        let mut t = app.key_touched.lock().unwrap();
        if t.get(&key).is_some_and(|i| i.elapsed() < Duration::from_secs(60)) {
            return;
        }
        t.insert(key, Instant::now());
    }
    let db = app.db.clone();
    tokio::spawn(async move {
        let _ = sqlx::query("update api_keys set last_used_at = now() where id = $1")
            .bind(key)
            .execute(&db)
            .await;
    });
}

/// Pools the key may use (org-wide keys cover every pool of the org, including later ones).
fn key_pools(app: &AppState, key: &KeyRec) -> Vec<PoolRec> {
    let c = app.cache.read().unwrap();
    c.pools
        .values()
        .filter(|p| p.org_id == key.org_id && (key.all_pools || key.pools.contains(&p.id)))
        .cloned()
        .collect()
}

pub async fn models(State(app): State<Arc<AppState>>, headers: HeaderMap) -> Result<Json<Value>, ApiError> {
    let key = authenticate(&app, &headers).await?;
    // name -> (the smallest context window among its ready nodes (the size every request is safe to use), if any
    // reports one; the inputs besides text that its nodes accept).
    let mut models: std::collections::BTreeMap<String, (Option<u32>, u32)> = Default::default();
    for p in key_pools(&app, &key) {
        let Some(m) = p.model else { continue };
        let ctx = app.registry.context_range(p.org_id, p.id, m.id).map(|(lo, _)| lo);
        let mut mods = app.registry.modalities_of(p.org_id, p.id, m.id);
        if cluster::clustered(&app) {
            mods |= cluster::modalities(&app, &[p.id]).await.unwrap_or(0);
        }
        let e = models.entry(m.name).or_insert((ctx, 0));
        e.0 = match (e.0, ctx) {
            (Some(a), Some(b)) => Some(a.min(b)),
            (a, b) => a.or(b),
        };
        e.1 |= mods;
    }
    let data: Vec<Value> = models
        .into_iter()
        .map(|(n, (ctx, mods))| {
            let mut v = json!({ "id": n, "object": "model", "created": 0, "owned_by": key.org_id });
            if let Some(c) = ctx {
                v["context_length"] = json!(c);
            }
            // Not part of the OpenAI format: lets clients offer image/audio input only where it works.
            let mut input = vec!["text"];
            input.extend(registry::modality_names(mods));
            v["input_modalities"] = json!(input);
            v["max_media_bytes"] = json!(app.max_media_bytes);
            v
        })
        .collect();
    Ok(Json(json!({ "object": "list", "data": data })))
}

#[derive(Deserialize)]
struct ChatReq {
    model: String,
    messages: Vec<Msg>,
    #[serde(default)]
    stream: bool,
    max_tokens: Option<u32>,
    max_completion_tokens: Option<u32>,
    temperature: Option<f32>,
    top_p: Option<f32>,
}

#[derive(Deserialize)]
struct Msg {
    role: String,
    #[serde(default)]
    content: Value,
}

/// Test value for the largest total size of the media (decoded) in one request; the real limit is
/// `Config::max_media_bytes` (`GATEWAY_MAX_MEDIA_MB`, default 256).
#[cfg(test)]
const MAX_MEDIA_BYTES: usize = 20 << 20;
/// Most media parts (images + audio clips) in one request.
const MAX_MEDIA_PARTS: usize = 64;
/// What one image costs the context window (the vision encoder's fixed number of soft tokens).
const IMAGE_TOKENS: u32 = 256;
/// Audio is encoded at 6.25 tokens per second of sound (one per 160 ms).
const AUDIO_TOKENS_PER_SEC: f64 = 6.25;

fn bad_request(code: &'static str, message: Tr) -> ApiError {
    ApiError::new(StatusCode::BAD_REQUEST, "invalid_request_error", code, message)
}

/// The messages in node-protocol form plus what the media in them needs.
#[derive(Default)]
struct Converted {
    messages: Vec<proto::ChatMessage>,
    /// `registry::IMAGE | AUDIO` bits the request needs from a node.
    mods: u32,
    /// Estimated context tokens of the media.
    media_tokens: u32,
    media_bytes: usize,
    media_parts: usize,
    /// Most media bytes the request may carry.
    limit: usize,
}

fn decode_b64(data: &str, what: &'static str) -> Result<Vec<u8>, ApiError> {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD
        .decode(data.trim())
        .map_err(|_| bad_request("invalid_base64", Tr::new("invalid_base64").word("what", what)))
}

/// `data:<mime>;base64,<data>` -> (mime, bytes). Remote URLs are refused: the gateway never fetches anything for a client.
fn decode_data_url(url: &str, what: &'static str) -> Result<(String, Vec<u8>), ApiError> {
    let Some(rest) = url.strip_prefix("data:") else {
        return Err(bad_request(
            "unsupported_media_url",
            Tr::new("unsupported_media_url").word("what", what),
        ));
    };
    let Some((meta, data)) = rest.split_once(',') else {
        return Err(bad_request(
            "invalid_data_url",
            Tr::new("invalid_data_url").word("what", what),
        ));
    };
    let Some(mime) = meta.strip_suffix(";base64") else {
        return Err(bad_request(
            "invalid_data_url",
            Tr::new("data_url_not_base64").word("what", what),
        ));
    };
    Ok((mime.trim().to_ascii_lowercase(), decode_b64(data, what)?))
}

fn image_mime(mime: &str) -> Option<&'static str> {
    match mime {
        "image/jpeg" | "image/jpg" => Some("image/jpeg"),
        "image/png" => Some("image/png"),
        "image/bmp" => Some("image/bmp"),
        "image/gif" => Some("image/gif"),
        _ => None,
    }
}

fn audio_mime(mime: &str) -> Option<&'static str> {
    match mime {
        "audio/wav" | "audio/x-wav" | "audio/wave" | "wav" => Some("audio/wav"),
        "audio/mpeg" | "audio/mp3" | "mp3" => Some("audio/mpeg"),
        "audio/flac" | "audio/x-flac" | "flac" => Some("audio/flac"),
        _ => None,
    }
}

/// Estimated length of an audio clip in seconds: exact for PCM WAV (byte rate in the header), a typical bit rate for
/// the compressed formats. Only used to estimate context use and to meter.
fn audio_seconds(mime: &str, data: &[u8]) -> f64 {
    let rate = match mime {
        "audio/wav" if data.len() > 44 && &data[0..4] == b"RIFF" => {
            u32::from_le_bytes([data[28], data[29], data[30], data[31]]) as f64
        }
        "audio/flac" => 64_000.0,
        _ => 16_000.0,
    };
    data.len() as f64 / if rate >= 1000.0 { rate } else { 16_000.0 }
}

/// One message's content: a string, or an array of OpenAI content parts (`text`, `image_url`, `input_audio`). Anything
/// else is refused with a clear error rather than silently dropped, and media is only accepted in user messages.
fn convert_message(m: &Msg, acc: &mut Converted) -> Result<(), ApiError> {
    let parts = match &m.content {
        Value::String(s) => {
            acc.messages.push(proto::ChatMessage {
                role: m.role.clone(),
                content: s.clone(),
                parts: Vec::new(),
            });
            return Ok(());
        }
        Value::Array(p) => p,
        Value::Null => {
            acc.messages.push(proto::ChatMessage {
                role: m.role.clone(),
                content: String::new(),
                parts: Vec::new(),
            });
            return Ok(());
        }
        _ => return Err(bad_request("invalid_request", Tr::new("content_shape"))),
    };
    let mut text: Vec<&str> = Vec::new();
    let mut out: Vec<proto::ContentPart> = Vec::new();
    let mut has_media = false;
    for part in parts {
        let kind = part.get("type").and_then(Value::as_str).unwrap_or("");
        match kind {
            "text" => {
                let t = part.get("text").and_then(Value::as_str).unwrap_or("");
                text.push(t);
                out.push(proto::ContentPart {
                    part: Some(proto::content_part::Part::Text(t.to_string())),
                });
            }
            "image_url" | "input_audio" => {
                if m.role != "user" {
                    return Err(bad_request("invalid_media_role", Tr::new("invalid_media_role")));
                }
                let (mime, data, is_image) = if kind == "image_url" {
                    let url = part
                        .get("image_url")
                        .and_then(|v| v.get("url").unwrap_or(v).as_str())
                        .ok_or_else(|| bad_request("invalid_request", Tr::new("image_needs_url")))?;
                    let (mime, data) = decode_data_url(url, "image")?;
                    let mime = image_mime(&mime).ok_or_else(|| {
                        bad_request(
                            "unsupported_media_type",
                            Tr::new("unsupported_image_type").arg("mime", &mime),
                        )
                    })?;
                    (mime, data, true)
                } else {
                    let a = part
                        .get("input_audio")
                        .ok_or_else(|| bad_request("invalid_request", Tr::new("audio_needs_data")))?;
                    let format = a
                        .get("format")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_ascii_lowercase();
                    let mime = audio_mime(&format).ok_or_else(|| {
                        bad_request(
                            "unsupported_media_type",
                            Tr::new("unsupported_audio_format").arg("format", &format),
                        )
                    })?;
                    let data = decode_b64(a.get("data").and_then(Value::as_str).unwrap_or(""), "audio")?;
                    (mime, data, false)
                };
                if data.is_empty() {
                    return Err(bad_request("invalid_request", Tr::new("media_empty")));
                }
                acc.media_bytes += data.len();
                acc.media_parts += 1;
                if acc.media_bytes > acc.limit || acc.media_parts > MAX_MEDIA_PARTS {
                    return Err(ApiError::new(
                        StatusCode::PAYLOAD_TOO_LARGE,
                        "invalid_request_error",
                        "media_too_large",
                        Tr::new("media_too_large")
                            .arg("parts", MAX_MEDIA_PARTS)
                            .arg("mib", acc.limit >> 20),
                    ));
                }
                has_media = true;
                let media = proto::Media {
                    mime_type: mime.to_string(),
                    data,
                };
                if is_image {
                    acc.mods |= registry::IMAGE;
                    acc.media_tokens += IMAGE_TOKENS;
                    out.push(proto::ContentPart {
                        part: Some(proto::content_part::Part::Image(media)),
                    });
                } else {
                    acc.mods |= registry::AUDIO;
                    acc.media_tokens += (audio_seconds(mime, &media.data) * AUDIO_TOKENS_PER_SEC)
                        .ceil()
                        .max(1.0) as u32;
                    out.push(proto::ContentPart {
                        part: Some(proto::content_part::Part::Audio(media)),
                    });
                }
            }
            other => {
                return Err(bad_request(
                    "unsupported_content_type",
                    Tr::new("unsupported_part_type").arg("kind", other),
                ))
            }
        }
    }
    acc.messages.push(proto::ChatMessage {
        role: m.role.clone(),
        content: text.join("\n"),
        parts: if has_media { out } else { Vec::new() },
    });
    Ok(())
}

/// Holds one in-flight slot on a node for one request; on drop it frees the slot, cancels the node's work if the
/// request did not finish, and records usage once.
struct Run {
    app: Arc<AppState>,
    node: Arc<NodeConn>,
    request_id: String,
    key: Uuid,
    org: Uuid,
    pool: Uuid,
    model: String,
    tokens_in: u32,
    tokens_out: u32,
    error: bool,
    finished: bool,
    record: bool,
    /// Count the generated tokens against the key's and organisation's limits (not for forwarded requests: the instance
    /// that received the request counts those).
    limited: bool,
    started: Instant,
    /// Time from sending the request to the node's first event.
    ttft: Option<Duration>,
}

impl Drop for Run {
    fn drop(&mut self) {
        self.app.registry.finish_request(&self.request_id, &self.node);
        if self.limited && self.tokens_out > 0 {
            let now = chrono::Utc::now().timestamp();
            self.app
                .limiter
                .add_tokens(Subject::Key(self.key), self.tokens_out as u64, now);
            self.app
                .limiter
                .add_tokens(Subject::Org(self.org), self.tokens_out as u64, now);
        }
        if !self.finished {
            let cancel = Envelope {
                body: Some(Body::Cancel(proto::Cancel {
                    request_id: self.request_id.clone(),
                })),
            };
            // After a resume the request lives on the node's newer connection.
            let node = self
                .app
                .registry
                .get(self.node.node_id)
                .unwrap_or_else(|| self.node.clone());
            let _ = node.tx.try_send(Outbound::Send(cancel));
        }
        if self.record {
            self.app
                .metrics
                .request(self.org, self.pool, self.started.elapsed(), self.ttft);
            self.app.usage.record(
                self.org,
                self.pool,
                self.key,
                &self.model,
                self.tokens_in,
                self.tokens_out,
                self.error,
            );
        }
    }
}

pub async fn chat_completions(
    State(app): State<Arc<AppState>>,
    request: axum::extract::Request,
) -> Result<Response, ApiError> {
    let (parts, body) = request.into_parts();
    // Authenticate before reading the body: it may carry megabytes of media.
    let key = authenticate(&app, &parts.headers).await?;
    let body = axum::body::to_bytes(body, app.max_body_bytes()).await.map_err(|_| {
        ApiError::new(
            StatusCode::PAYLOAD_TOO_LARGE,
            "invalid_request_error",
            "request_too_large",
            Tr::new("request_too_large"),
        )
    })?;
    chat_core(&app, key, body, false, Lang::from_headers(&parts.headers)).await
}

/// Serves a chat request of an authenticated key. `forwarded`: another gateway instance already checked the limits and
/// sent the request here because this instance holds the node; it is only served from local nodes and not forwarded on.
pub async fn chat_core(
    app: &Arc<AppState>,
    key: KeyRec,
    body: Bytes,
    forwarded: bool,
    lang: Lang,
) -> Result<Response, ApiError> {
    let app = app.clone();
    let req: ChatReq = serde_json::from_slice(&body).map_err(|e| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            "invalid_request_error",
            "invalid_request",
            Tr::new("invalid_body").arg("detail", e),
        )
    })?;
    if req.messages.is_empty() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "invalid_request_error",
            "invalid_request",
            Tr::new("messages_empty"),
        ));
    }
    if app.draining.load(std::sync::atomic::Ordering::Relaxed) {
        // Shutting down: peers and clients try another instance (503), requests already running finish.
        return Err(ApiError::unavailable(Tr::new("shutting_down")));
    }
    if !app.usage.healthy() {
        return Err(ApiError::unavailable(Tr::new("metering_behind")));
    }

    // Resolve the pool from the model among the key's pools.
    let holders: Vec<(PoolRec, ModelRec)> = key_pools(&app, &key)
        .into_iter()
        .filter_map(|p| p.model.clone().filter(|m| m.name == req.model).map(|m| (p, m)))
        .collect();
    if holders.is_empty() {
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            "invalid_request_error",
            "model_not_found",
            Tr::new("model_not_found").arg("model", &req.model),
        ));
    }

    let mut conv = Converted {
        limit: app.max_media_bytes,
        ..Default::default()
    };
    for m in &req.messages {
        convert_message(m, &mut conv)?;
    }
    let mods = conv.mods;
    let messages = conv.messages;
    let tokens_in = (messages.iter().map(|m| m.content.chars().count()).sum::<usize>() as u32)
        .div_ceil(4)
        .saturating_add(conv.media_tokens);

    // Media needs a node whose model takes it. If nodes are ready but none does, say so (400) instead of queueing.
    if mods != 0 {
        let (mut any, mut have) = (false, 0u32);
        for (p, m) in &holders {
            if app.registry.has_ready(p.org_id, p.id, m.id) {
                any = true;
                have |= app.registry.modalities_of(p.org_id, p.id, m.id);
            }
        }
        if (!any || have & mods != mods) && !forwarded && cluster::clustered(&app) {
            let ids: Vec<Uuid> = holders.iter().map(|(p, _)| p.id).collect();
            if let Some(r) = cluster::modalities(&app, &ids).await {
                any = true;
                have |= r;
            }
        }
        if any && have & mods != mods {
            let missing = registry::modality_names(mods & !have)
                .into_iter()
                .map(|n| if n == "image" { "word.image" } else { "word.audio" })
                .collect();
            return Err(bad_request(
                "unsupported_modality",
                Tr::new("unsupported_modality").words("missing", missing),
            ));
        }
    }

    // Rate limits: the organisation's and the key's, both must allow it. (A forwarded request was checked already.)
    if !forwarded {
        let now = chrono::Utc::now().timestamp();
        let org_limits = app
            .cache
            .read()
            .unwrap()
            .org_limits
            .get(&key.org_id)
            .copied()
            .unwrap_or_default();
        for (subject, limits) in [
            (Subject::Org(key.org_id), org_limits),
            (Subject::Key(key.id), key.limits),
        ] {
            app.limiter.refresh_day(&app.db, subject, &limits).await;
            if let Err(r) = app.limiter.check(subject, &limits, now) {
                key_event(&app, &key, "limit.exceeded", json!({ "what": r.what }));
                app.metrics.rate_limited(key.org_id, holders[0].0.id);
                return Err(ApiError::too_many(r.what, r.retry_after_secs));
            }
        }
    }

    // Prompt + output must fit a node's context window. Output is unknown without `max_tokens`, so one token is assumed.
    let need = tokens_in.saturating_add(req.max_completion_tokens.or(req.max_tokens).unwrap_or(1));
    let largest = holders
        .iter()
        .filter_map(|(p, m)| app.registry.context_range(p.org_id, p.id, m.id))
        .map(|(_, hi)| hi)
        .max();
    let mut largest = largest;
    if !forwarded && largest.is_some_and(|hi| need > hi) && cluster::clustered(&app) {
        // Nodes on other instances may have a larger window.
        let ids: Vec<Uuid> = holders.iter().map(|(p, _)| p.id).collect();
        largest = largest.max(cluster::max_context(&app, &ids).await);
    }
    if largest.is_some_and(|hi| need > hi) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "invalid_request_error",
            "context_length_exceeded",
            Tr::new("context_exceeded")
                .arg("max", largest.unwrap_or(0))
                .arg("need", need),
        ));
    }

    if !forwarded {
        let now = chrono::Utc::now().timestamp();
        app.limiter.admit(Subject::Org(key.org_id), tokens_in as u64, now);
        app.limiter.admit(Subject::Key(key.id), tokens_in as u64, now);
    }

    let mut tried: Vec<Uuid> = Vec::new();
    let mut last = ApiError::unavailable(Tr::new("no_node"));
    for _ in 0..2 {
        // The pool with the lowest load per eligible node.
        let target = holders
            .iter()
            .filter_map(|(p, m)| {
                let (n, load) = app.registry.pool_load(p.org_id, p.id, m.id, need, mods);
                (n > 0).then(|| (p, m, load as f64 / n as f64))
            })
            .min_by(|a, b| a.2.total_cmp(&b.2));
        let Some((pool, model, _)) = target else { break };
        let Some(node) = app
            .registry
            .pick(pool.org_id, pool.id, model.id, need, mods, &pool.balancing, &tried)
        else {
            break;
        };

        let request_id = Uuid::new_v4().to_string();
        let mut rx = app.registry.track_request(&request_id, &node);
        let mut run = Run {
            app: app.clone(),
            node: node.clone(),
            request_id: request_id.clone(),
            key: key.id,
            org: key.org_id,
            pool: pool.id,
            model: req.model.clone(),
            tokens_in,
            tokens_out: 0,
            error: false,
            finished: false,
            record: true,
            limited: !forwarded,
            started: Instant::now(),
            ttft: None,
        };
        let (_, pool_running) = app.registry.pool_load(pool.org_id, pool.id, model.id, 0, 0);
        app.metrics.in_flight(pool.org_id, pool.id, pool_running);
        let msg = Envelope {
            body: Some(Body::InferenceRequest(proto::InferenceRequest {
                request_id,
                model_id: model.id.to_string(),
                messages: messages.clone(),
                max_tokens: req.max_completion_tokens.or(req.max_tokens).unwrap_or(0),
                temperature: req.temperature.unwrap_or(0.0),
                top_p: req.top_p.unwrap_or(0.0),
            })),
        };
        let sent = Instant::now();
        let first = if node.tx.send(Outbound::Send(msg)).await.is_err() {
            Some(NodeEvent::Disconnected)
        } else {
            tokio::time::timeout(FIRST_EVENT_TIMEOUT, rx.recv())
                .await
                .ok()
                .flatten()
        };
        match first {
            // The node dropped or failed before the first token: retry once on another node.
            None | Some(NodeEvent::Disconnected) | Some(NodeEvent::Error { .. }) => {
                run.record = false;
                tried.push(node.node_id);
                last = ApiError::new(
                    StatusCode::BAD_GATEWAY,
                    "server_error",
                    "node_failed",
                    Tr::new("node_failed"),
                );
                continue;
            }
            Some(first) => {
                run.ttft = Some(sent.elapsed());
                let id = format!("chatcmpl-{}", Uuid::new_v4().simple());
                let created = chrono::Utc::now().timestamp();
                return Ok(if req.stream {
                    stream_response(run, rx, first, id, created, req.model, lang).into_response()
                } else {
                    collect_response(run, rx, first, id, created, req.model).await?
                });
            }
        }
    }
    // No suitable node here: ask the other instances that hold nodes of these pools.
    if !forwarded {
        let ids: Vec<Uuid> = holders.iter().map(|(p, _)| p.id).collect();
        for peer in cluster::peers_with_pools(&app, &ids, &registry::modality_names(mods)).await {
            match cluster::forward_chat(&app, &peer, &key.hash, body.clone(), lang).await {
                // 502/503 mean "that instance has no node for it right now": try the next one.
                Ok(res) if !matches!(res.status().as_u16(), 502 | 503) => return Ok(res),
                _ => continue,
            }
        }
    }
    if !forwarded {
        app.metrics.unavailable(key.org_id, holders[0].0.id);
    }
    Err(last)
}

fn chunk_json(id: &str, created: i64, model: &str, delta: Value, finish: Option<&str>) -> String {
    json!({
        "id": id, "object": "chat.completion.chunk", "created": created, "model": model,
        "choices": [{ "index": 0, "delta": delta, "finish_reason": finish }]
    })
    .to_string()
}

/// Feeds `first` and then the rest of the node's events through `on`, until the request ends. Returns the finish reason
/// or an error. Counting tokens happens here so every path meters the same way.
async fn next_event(run: &mut Run, rx: &mut mpsc::Receiver<NodeEvent>, first: &mut Option<NodeEvent>) -> NodeEvent {
    let ev = match first.take() {
        Some(e) => e,
        None => match tokio::time::timeout(EVENT_TIMEOUT, rx.recv()).await {
            Ok(Some(e)) => e,
            _ => NodeEvent::Disconnected,
        },
    };
    match &ev {
        NodeEvent::Chunk(t) if !t.is_empty() => run.tokens_out += 1,
        NodeEvent::Done { .. } => run.finished = true,
        NodeEvent::Error { .. } | NodeEvent::Disconnected => run.error = true,
        _ => {}
    }
    ev
}

fn stream_response(
    mut run: Run,
    mut rx: mpsc::Receiver<NodeEvent>,
    first: NodeEvent,
    id: String,
    created: i64,
    model: String,
    lang: Lang,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let (tx, out) = mpsc::channel::<Result<Event, Infallible>>(64);
    tokio::spawn(async move {
        let send = |data: String| {
            let tx = tx.clone();
            async move { tx.send(Ok(Event::default().data(data))).await.is_ok() }
        };
        if !send(chunk_json(
            &id,
            created,
            &model,
            json!({ "role": "assistant", "content": "" }),
            None,
        ))
        .await
        {
            return;
        }
        let mut first = Some(first);
        loop {
            match next_event(&mut run, &mut rx, &mut first).await {
                NodeEvent::Chunk(t) => {
                    if !send(chunk_json(&id, created, &model, json!({ "content": t }), None)).await {
                        return; // the client went away; dropping `run` cancels the node's work
                    }
                }
                NodeEvent::Done { finish_reason } => {
                    let reason = if finish_reason.is_empty() {
                        "stop"
                    } else {
                        finish_reason.as_str()
                    };
                    send(chunk_json(&id, created, &model, json!({}), Some(reason))).await;
                    send("[DONE]".to_string()).await;
                    return;
                }
                NodeEvent::Error { code, message } => {
                    let message = Tr::new("node_error").arg("message", message).render(lang);
                    send(json!({ "error": { "message": message, "type": "server_error", "code": code } }).to_string())
                        .await;
                    return;
                }
                NodeEvent::Disconnected => {
                    let message = Tr::new("node_disconnected").render(lang);
                    send(
                        json!({ "error": { "message": message, "type": "server_error", "code": "node_disconnected" } })
                            .to_string(),
                    )
                    .await;
                    return;
                }
            }
        }
    });
    let events = stream::unfold(out, |mut out| async move { out.recv().await.map(|e| (e, out)) });
    Sse::new(events)
}

async fn collect_response(
    mut run: Run,
    mut rx: mpsc::Receiver<NodeEvent>,
    first: NodeEvent,
    id: String,
    created: i64,
    model: String,
) -> Result<Response, ApiError> {
    let mut first = Some(first);
    let mut text = String::new();
    loop {
        match next_event(&mut run, &mut rx, &mut first).await {
            NodeEvent::Chunk(t) => text.push_str(&t),
            NodeEvent::Done { finish_reason } => {
                let reason = if finish_reason.is_empty() {
                    "stop".to_string()
                } else {
                    finish_reason
                };
                let body = json!({
                    "id": id, "object": "chat.completion", "created": created, "model": model,
                    "choices": [{ "index": 0, "message": { "role": "assistant", "content": text }, "finish_reason": reason }],
                    "usage": {
                        "prompt_tokens": run.tokens_in, "completion_tokens": run.tokens_out,
                        "total_tokens": run.tokens_in + run.tokens_out
                    }
                });
                return Ok(Json(body).into_response());
            }
            NodeEvent::Error { message, .. } => {
                return Err(ApiError::new(
                    StatusCode::BAD_GATEWAY,
                    "server_error",
                    "node_error",
                    Tr::new("node_error").arg("message", message),
                ))
            }
            NodeEvent::Disconnected => {
                return Err(ApiError::new(
                    StatusCode::BAD_GATEWAY,
                    "server_error",
                    "node_disconnected",
                    Tr::new("node_disconnected"),
                ))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(role: &str, content: Value) -> Msg {
        Msg {
            role: role.into(),
            content,
        }
    }
    fn convert(m: Msg) -> Result<Converted, ApiError> {
        let mut c = Converted {
            limit: MAX_MEDIA_BYTES,
            ..Default::default()
        };
        convert_message(&m, &mut c).map(|_| c)
    }
    fn code(e: ApiError) -> &'static str {
        e.code
    }
    fn b64(bytes: &[u8]) -> String {
        use base64::Engine as _;
        base64::engine::general_purpose::STANDARD.encode(bytes)
    }

    #[test]
    fn text_messages_keep_the_plain_shape() {
        let c = convert(msg("user", json!("hello"))).unwrap();
        assert_eq!(c.messages[0].content, "hello");
        assert!(c.messages[0].parts.is_empty());
        assert_eq!(c.mods, 0);
        let c = convert(msg(
            "user",
            json!([{"type":"text","text":"a"},{"type":"text","text":"b"}]),
        ))
        .unwrap();
        assert_eq!(c.messages[0].content, "a\nb");
        assert!(c.messages[0].parts.is_empty(), "parts only when media is present");
    }

    #[test]
    fn images_and_audio_become_ordered_parts() {
        let png = format!("data:image/png;base64,{}", b64(&[1, 2, 3]));
        let wav = b64(&[9; 100]);
        let c = convert(msg(
            "user",
            json!([
                {"type":"text","text":"what is this"},
                {"type":"image_url","image_url":{"url": png}},
                {"type":"input_audio","input_audio":{"data": wav, "format":"wav"}}
            ]),
        ))
        .unwrap();
        let m = &c.messages[0];
        assert_eq!(m.content, "what is this");
        assert_eq!(m.parts.len(), 3);
        assert!(
            matches!(m.parts[1].part, Some(proto::content_part::Part::Image(ref i)) if i.mime_type == "image/png" && i.data == [1, 2, 3])
        );
        assert!(matches!(m.parts[2].part, Some(proto::content_part::Part::Audio(ref a)) if a.mime_type == "audio/wav"));
        assert_eq!(c.mods, registry::IMAGE | registry::AUDIO);
        assert!(c.media_tokens > IMAGE_TOKENS);
    }

    #[test]
    fn a_plain_string_image_url_works_too() {
        let url = format!("data:image/jpeg;base64,{}", b64(&[7]));
        let c = convert(msg("user", json!([{"type":"image_url","image_url": url}]))).unwrap();
        assert_eq!(c.mods, registry::IMAGE);
    }

    #[test]
    fn refuses_what_it_cannot_serve_instead_of_dropping_it() {
        let remote = convert(msg(
            "user",
            json!([{"type":"image_url","image_url":{"url":"https://x/y.png"}}]),
        ));
        assert_eq!(code(remote.err().unwrap()), "unsupported_media_url");
        let webp = format!("data:image/webp;base64,{}", b64(&[1]));
        let e = convert(msg("user", json!([{"type":"image_url","image_url":{"url": webp}}])));
        assert_eq!(code(e.err().unwrap()), "unsupported_media_type");
        let e = convert(msg(
            "user",
            json!([{"type":"input_audio","input_audio":{"data": b64(&[1]), "format":"ogg"}}]),
        ));
        assert_eq!(code(e.err().unwrap()), "unsupported_media_type");
        let e = convert(msg("user", json!([{"type":"video_url","video_url":{"url":"x"}}])));
        assert_eq!(code(e.err().unwrap()), "unsupported_content_type");
        let e = convert(msg(
            "user",
            json!([{"type":"input_audio","input_audio":{"data":"!!!","format":"wav"}}]),
        ));
        assert_eq!(code(e.err().unwrap()), "invalid_base64");
        let img = format!("data:image/png;base64,{}", b64(&[1]));
        let e = convert(msg("assistant", json!([{"type":"image_url","image_url":{"url": img}}])));
        assert_eq!(code(e.err().unwrap()), "invalid_media_role");
    }

    #[test]
    fn media_size_is_capped() {
        let big = b64(&vec![0u8; MAX_MEDIA_BYTES + 1]);
        let e = convert(msg(
            "user",
            json!([{"type":"input_audio","input_audio":{"data": big, "format":"mp3"}}]),
        ));
        assert_eq!(code(e.err().unwrap()), "media_too_large");
    }

    #[test]
    fn wav_length_comes_from_the_header() {
        let mut wav = vec![0u8; 44 + 32_000];
        wav[0..4].copy_from_slice(b"RIFF");
        wav[28..32].copy_from_slice(&32_000u32.to_le_bytes()); // 16 kHz, mono, 16 bit
        let s = audio_seconds("audio/wav", &wav);
        assert!((s - 1.0).abs() < 0.01, "{s}");
    }

    #[tokio::test]
    async fn errors_are_answered_in_the_requested_language() {
        use http_body_util::BodyExt;
        let err = ApiError::too_many("requests per minute", 7);
        for (lang, text) in [
            (
                Lang::En,
                "Rate limit reached: too many requests per minute. Try again in 7 s.",
            ),
            (
                Lang::Ro,
                "Limita de cereri pe minut a fost atinsă. Încearcă din nou în 7 s.",
            ),
        ] {
            let res = err.respond(lang);
            assert_eq!(res.status(), StatusCode::TOO_MANY_REQUESTS);
            assert_eq!(res.headers()[header::CONTENT_LANGUAGE], lang.tag());
            let body = res.into_body().collect().await.unwrap().to_bytes();
            let v: Value = serde_json::from_slice(&body).unwrap();
            assert_eq!(v["error"]["message"], text);
            assert_eq!(
                v["error"]["code"], "rate_limit_exceeded",
                "the code is never translated"
            );
        }
    }
}
