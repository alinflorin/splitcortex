//! Several gateway instances behind one Service (see docs/gateway.md). No extra software: the shared Postgres is the
//! directory, and instances talk to each other over plain HTTP on an internal port.
//!
//! - Each instance heartbeats a row in `gateway_instances` (its id and internal address) and writes its id on the
//!   `node_status` rows of the nodes it holds.
//! - A client request is authenticated and limit-checked by whichever instance receives it. If that instance holds no
//!   suitable node, it asks the instances that do (found through `node_status`) to run the request and streams their
//!   answer back unchanged. The instance that holds the node meters the usage.
//! - Forwarded requests carry a bearer token derived from the identity key, so only gateways can call the internal
//!   endpoint. It is on its own port, never behind the Service or the Ingress.

use std::sync::Arc;
use std::time::Duration;

use axum::body::{Body, Bytes};
use axum::extract::State;
use axum::http::{header, Request, StatusCode};
use axum::response::Response;
use axum::routing::{get, post};
use axum::Router;
use http_body_util::Full;
use hyper_util::client::legacy::connect::HttpConnector;
use hyper_util::client::legacy::Client;
use hyper_util::rt::TokioExecutor;
use subtle::ConstantTimeEq;
use tracing::{debug, warn};
use uuid::Uuid;

use crate::i18n::{Lang, Tr};
use crate::openai::{self, ApiError};
use crate::state::AppState;

pub type HttpClient = Client<HttpConnector, Full<Bytes>>;

pub fn http_client() -> HttpClient {
    let mut connector = HttpConnector::new();
    connector.set_connect_timeout(Some(Duration::from_secs(3)));
    Client::builder(TokioExecutor::new()).build(connector)
}

#[derive(Clone, Debug)]
pub struct Peer {
    pub id: String,
    pub address: String,
}

const HEARTBEAT: Duration = Duration::from_secs(5);
/// An instance that has not heartbeated for this long is gone.
const ALIVE_SECS: i32 = 20;
/// How long a forwarded request may take to produce its first byte (the peer waits up to two minutes for its node).
const FORWARD_TIMEOUT: Duration = Duration::from_secs(130);

/// Publishes this instance and keeps the directory clean. Does nothing when the instance has no address (single
/// instance, e.g. outside Kubernetes).
pub async fn instance_loop(app: Arc<AppState>) {
    let Some(addr) = app.advertise.clone() else { return };
    loop {
        if app.draining.load(std::sync::atomic::Ordering::Relaxed) {
            tokio::time::sleep(HEARTBEAT).await;
            continue;
        }
        let _ = sqlx::query(
            "insert into gateway_instances (id, address, updated_at) values ($1, $2, now()) \
             on conflict (id) do update set address = $2, updated_at = now()",
        )
        .bind(&app.instance_id)
        .bind(&addr)
        .execute(&app.db)
        .await;
        let _ = sqlx::query("delete from gateway_instances where updated_at < now() - interval '2 minutes'")
            .execute(&app.db)
            .await;
        tokio::time::sleep(HEARTBEAT).await;
    }
}

/// Removes this instance from the directory so peers stop forwarding requests to it.
pub async fn leave_directory(app: &AppState) {
    let _ = sqlx::query("delete from gateway_instances where id = $1")
        .bind(&app.instance_id)
        .execute(&app.db)
        .await;
}

/// Removes this instance from the directory (graceful shutdown) and marks its nodes as not connected.
pub async fn leave(app: &AppState) {
    let _ = sqlx::query("update node_status set connected = false, in_flight = 0 where gateway_id = $1 and connected")
        .bind(&app.instance_id)
        .execute(&app.db)
        .await;
    let _ = sqlx::query("delete from gateway_instances where id = $1")
        .bind(&app.instance_id)
        .execute(&app.db)
        .await;
}

/// Whether other instances may exist (this one is in the directory).
pub fn clustered(app: &AppState) -> bool {
    app.advertise.is_some()
}

/// The other live instances that hold at least one connected node of one of `pools` (accepting every input in `mods`,
/// e.g. `["image"]`), most nodes first.
pub async fn peers_with_pools(app: &AppState, pools: &[Uuid], mods: &[&str]) -> Vec<Peer> {
    if !clustered(app) || pools.is_empty() {
        return Vec::new();
    }
    let rows: Result<Vec<(String, String, i64)>, _> = sqlx::query_as(
        "select gi.id, gi.address, count(*) from node_status ns \
         join nodes n on n.id = ns.node_id \
         join gateway_instances gi on gi.id = ns.gateway_id \
         where n.pool_id = any($1) and ns.connected and ns.updated_at > now() - interval '60 seconds' \
         and gi.id <> $2 and gi.updated_at > now() - make_interval(secs => $3) \
         and string_to_array(coalesce(ns.modalities, ''), ',') @> $4::text[] \
         group by gi.id, gi.address order by count(*) desc",
    )
    .bind(pools)
    .bind(&app.instance_id)
    .bind(ALIVE_SECS)
    .bind(mods)
    .fetch_all(&app.db)
    .await;
    match rows {
        Ok(r) => r.into_iter().map(|(id, address, _)| Peer { id, address }).collect(),
        Err(e) => {
            warn!("peer lookup failed: {e}");
            Vec::new()
        }
    }
}

/// The input modalities (`registry::IMAGE | AUDIO` bits) the connected nodes of `pools` accept together on any instance;
/// None when no node of them is connected (or the lookup failed).
pub async fn modalities(app: &AppState, pools: &[Uuid]) -> Option<u32> {
    let rows: Vec<Option<String>> = sqlx::query_scalar(
        "select ns.modalities from node_status ns join nodes n on n.id = ns.node_id \
         where n.pool_id = any($1) and ns.connected and ns.updated_at > now() - interval '60 seconds'",
    )
    .bind(pools)
    .fetch_all(&app.db)
    .await
    .ok()?;
    (!rows.is_empty()).then(|| {
        rows.iter().fold(0, |m, r| {
            m | crate::registry::modalities_from(
                &r.as_deref()
                    .unwrap_or("")
                    .split(',')
                    .map(str::to_string)
                    .collect::<Vec<_>>(),
            )
        })
    })
}

/// The largest context window any connected node of `pools` reports, on any instance.
pub async fn max_context(app: &AppState, pools: &[Uuid]) -> Option<u32> {
    sqlx::query_scalar::<_, Option<i32>>(
        "select max(ns.max_context_tokens) from node_status ns join nodes n on n.id = ns.node_id \
         where n.pool_id = any($1) and ns.connected and ns.updated_at > now() - interval '60 seconds'",
    )
    .bind(pools)
    .fetch_one(&app.db)
    .await
    .ok()
    .flatten()
    .and_then(|v| u32::try_from(v).ok())
}

/// Asks `peer` to serve a chat request for `key_hash` (already authenticated and limit-checked here). `Err` means the
/// peer could not be reached; any HTTP answer, including an error, is returned as it is.
pub async fn forward_chat(
    app: &AppState,
    peer: &Peer,
    path: &str,
    key_hash: &str,
    body: Bytes,
    lang: Lang,
) -> Result<Response, ()> {
    let req = Request::builder()
        .method("POST")
        .uri(format!("http://{}{}", peer.address, path))
        .header(header::AUTHORIZATION, format!("Bearer {}", app.internal_token))
        .header("x-sc-key", key_hash)
        .header(header::ACCEPT_LANGUAGE, lang.tag())
        .header(header::CONTENT_TYPE, "application/json")
        .body(Full::new(body))
        .map_err(|_| ())?;
    match tokio::time::timeout(FORWARD_TIMEOUT, app.http.request(req)).await {
        Ok(Ok(res)) => Ok(res.map(Body::new)),
        Ok(Err(e)) => {
            debug!(peer = %peer.id, "forward failed: {e}");
            Err(())
        }
        Err(_) => Err(()),
    }
}

/// Internal listener: only other gateways may call it.
pub fn internal_router(app: Arc<AppState>) -> Router {
    Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/internal/v1/chat/completions", post(internal_chat))
        .route("/internal/v1/embeddings", post(internal_embeddings))
        .layer(axum::middleware::from_fn(openai::localize))
        .with_state(app)
}

async fn internal_chat(
    State(app): State<Arc<AppState>>,
    request: axum::extract::Request,
) -> Result<Response, ApiError> {
    internal(app, request, false).await
}

async fn internal_embeddings(
    State(app): State<Arc<AppState>>,
    request: axum::extract::Request,
) -> Result<Response, ApiError> {
    internal(app, request, true).await
}

async fn internal(app: Arc<AppState>, request: axum::extract::Request, embeddings: bool) -> Result<Response, ApiError> {
    let (parts, body) = request.into_parts();
    let headers = parts.headers;
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or("");
    if !bool::from(token.as_bytes().ct_eq(app.internal_token.as_bytes())) {
        return Err(ApiError::status(
            StatusCode::UNAUTHORIZED,
            "unauthorized",
            Tr::new("unauthorized"),
        ));
    }
    let hash = headers.get("x-sc-key").and_then(|v| v.to_str().ok()).unwrap_or("");
    let key = app.cache.read().unwrap().keys.get(hash).cloned();
    let key = match key {
        Some(k) => k,
        None => match crate::cache::fetch_key(&app.db, hash).await {
            Ok(Some(k)) => k,
            _ => {
                return Err(ApiError::status(
                    StatusCode::UNAUTHORIZED,
                    "unauthorized",
                    Tr::new("unknown_key"),
                ))
            }
        },
    };
    let body = axum::body::to_bytes(body, app.max_body_bytes()).await.map_err(|_| {
        ApiError::status(
            StatusCode::PAYLOAD_TOO_LARGE,
            "request_too_large",
            Tr::new("request_too_large"),
        )
    })?;
    let lang = Lang::from_headers(&headers);
    if embeddings {
        openai::embeddings_core(&app, key, body, true, lang).await
    } else {
        openai::chat_core(&app, key, body, true, lang).await
    }
}
