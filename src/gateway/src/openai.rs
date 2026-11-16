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
use crate::proto::envelope::Body;
use crate::proto::{self, Envelope};
use crate::registry::{NodeConn, NodeEvent, Outbound};
use crate::state::AppState;

const FIRST_EVENT_TIMEOUT: Duration = Duration::from_secs(120);
const EVENT_TIMEOUT: Duration = Duration::from_secs(120);

pub struct ApiError {
    status: StatusCode,
    kind: &'static str,
    code: &'static str,
    message: String,
    retry_after: Option<u32>,
}

impl ApiError {
    fn new(status: StatusCode, kind: &'static str, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status,
            kind,
            code,
            message: message.into(),
            retry_after: None,
        }
    }
    fn unavailable(message: &str) -> Self {
        let mut e = Self::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "server_error",
            "service_unavailable",
            message,
        );
        e.retry_after = Some(5);
        e
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let body = json!({ "error": { "message": self.message, "type": self.kind, "param": null, "code": self.code } });
        let mut res = (self.status, Json(body)).into_response();
        if let Some(s) = self.retry_after {
            res.headers_mut().insert(header::RETRY_AFTER, HeaderValue::from(s));
        }
        res
    }
}

fn unauthorized() -> ApiError {
    ApiError::new(
        StatusCode::UNAUTHORIZED,
        "invalid_request_error",
        "invalid_api_key",
        "Incorrect API key provided.",
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
                Err(_) => return Err(ApiError::unavailable("Temporarily unavailable.")),
            }
        }
    };
    if key.revoked || key.expires_at.is_some_and(|e| e <= chrono::Utc::now()) {
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
    let mut names: Vec<String> = key_pools(&app, &key)
        .into_iter()
        .filter_map(|p| p.model.map(|m| m.name))
        .collect();
    names.sort();
    names.dedup();
    let data: Vec<Value> = names
        .into_iter()
        .map(|n| json!({ "id": n, "object": "model", "created": 0, "owned_by": key.org_id }))
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

/// A message's text: a string, or an array of `{type: "text", text}` parts. Other part types are ignored.
fn text_of(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(|p| p.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
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
}

impl Drop for Run {
    fn drop(&mut self) {
        self.app.registry.finish_request(&self.request_id);
        self.node.in_flight.fetch_sub(1, std::sync::atomic::Ordering::AcqRel);
        if !self.finished {
            let cancel = Envelope {
                body: Some(Body::Cancel(proto::Cancel {
                    request_id: self.request_id.clone(),
                })),
            };
            let _ = self.node.tx.try_send(Outbound::Send(cancel));
        }
        if self.record {
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
    headers: HeaderMap,
    body: Bytes,
) -> Result<Response, ApiError> {
    let key = authenticate(&app, &headers).await?;
    let req: ChatReq = serde_json::from_slice(&body).map_err(|e| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            "invalid_request_error",
            "invalid_request",
            format!("Invalid request body: {e}"),
        )
    })?;
    if req.messages.is_empty() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "invalid_request_error",
            "invalid_request",
            "messages must not be empty",
        ));
    }
    if !app.usage.healthy() {
        return Err(ApiError::unavailable("Usage metering is behind; try again shortly."));
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
            format!(
                "The model `{}` does not exist or you do not have access to it.",
                req.model
            ),
        ));
    }

    let messages: Vec<proto::ChatMessage> = req
        .messages
        .iter()
        .map(|m| proto::ChatMessage {
            role: m.role.clone(),
            content: text_of(&m.content),
        })
        .collect();
    let tokens_in = (messages.iter().map(|m| m.content.chars().count()).sum::<usize>() as u32).div_ceil(4);

    let mut tried: Vec<Uuid> = Vec::new();
    let mut last = ApiError::unavailable("No node is available for this model right now.");
    for _ in 0..2 {
        // The pool with the lowest load per eligible node.
        let target = holders
            .iter()
            .filter_map(|(p, m)| {
                let (n, load) = app.registry.pool_load(p.org_id, p.id, m.id);
                (n > 0).then(|| (p, m, load as f64 / n as f64))
            })
            .min_by(|a, b| a.2.total_cmp(&b.2));
        let Some((pool, model, _)) = target else { break };
        let Some(node) = app
            .registry
            .pick(pool.org_id, pool.id, model.id, &pool.balancing, &tried)
        else {
            break;
        };

        let request_id = Uuid::new_v4().to_string();
        let mut rx = app.registry.track_request(&request_id, node.node_id);
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
        };
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
                    "The node failed to answer.",
                );
                continue;
            }
            Some(first) => {
                let id = format!("chatcmpl-{}", Uuid::new_v4().simple());
                let created = chrono::Utc::now().timestamp();
                return Ok(if req.stream {
                    stream_response(run, rx, first, id, created, req.model).into_response()
                } else {
                    collect_response(run, rx, first, id, created, req.model).await?
                });
            }
        }
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
                    send(json!({ "error": { "message": message, "type": "server_error", "code": code } }).to_string())
                        .await;
                    return;
                }
                NodeEvent::Disconnected => {
                    send(json!({ "error": { "message": "The node disconnected.", "type": "server_error", "code": "node_disconnected" } }).to_string()).await;
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
                    message,
                ))
            }
            NodeEvent::Disconnected => {
                return Err(ApiError::new(
                    StatusCode::BAD_GATEWAY,
                    "server_error",
                    "node_disconnected",
                    "The node disconnected.",
                ))
            }
        }
    }
}
