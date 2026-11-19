use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use ed25519_dalek::SigningKey;
use sqlx::PgPool;
use tokio::sync::{watch, Notify};
use uuid::Uuid;

use crate::cache::SharedCache;
use crate::limits::Limiter;
use crate::registry::Registry;
use crate::usage::Usage;

pub struct AppState {
    pub db: PgPool,
    pub cache: SharedCache,
    pub registry: Registry,
    pub usage: Arc<Usage>,
    /// Audit events (security and lifecycle, never per request), flushed to `audit_logs`.
    pub audit: Arc<crate::audit::Audit>,
    pub signing_key: SigningKey,
    /// The key announced to devices during a rotation (see docs/gateway.md).
    pub next_key: Option<SigningKey>,
    pub limiter: Limiter,
    pub instance_id: String,
    /// `host:port` other gateways forward requests to (None = running alone).
    pub advertise: Option<String>,
    pub internal_token: String,
    /// Most media bytes (decoded) one chat request may carry.
    pub max_media_bytes: usize,
    pub http: crate::cluster::HttpClient,
    pub changed: Arc<Notify>,
    pub cache_ready: watch::Receiver<bool>,
    /// Set on SIGTERM: no new requests or node connections are accepted, running requests finish (see `main::drain`).
    pub draining: std::sync::atomic::AtomicBool,
    /// Short negative cache for unknown API key hashes (blunts invalid-key floods).
    pub unknown_keys: Mutex<HashMap<String, Instant>>,
    /// Last time `last_used_at` was written per key (throttle).
    pub key_touched: Mutex<HashMap<Uuid, Instant>>,
}

impl AppState {
    /// What a chat request body may be: the media as base64 plus the JSON around it.
    pub fn max_body_bytes(&self) -> usize {
        self.max_media_bytes / 3 * 4 + (1 << 20)
    }
}
