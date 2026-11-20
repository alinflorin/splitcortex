//! In-memory config cache fed by `config_changes` + Postgres LISTEN/NOTIFY (see docs/gateway.md). Rows are re-fetched
//! on every change (never diffs); a missing row means delete; a gap or a pruned log triggers a full resync.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, RwLock};
use std::time::Duration;

use anyhow::Result;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD as B64, Engine};
use chrono::{DateTime, Utc};
use ed25519_dalek::VerifyingKey;
use sqlx::postgres::PgListener;
use sqlx::{PgPool, Row};
use tokio::sync::Notify;
use tracing::{info, warn};
use uuid::Uuid;

use crate::limits::Limits;

#[derive(Clone)]
pub struct NodeRec {
    pub id: Uuid,
    pub org_id: Uuid,
    pub pool_id: Uuid,
    pub public_key: VerifyingKey,
    pub approved: bool,
    /// Admin overrides for the device (`cpu` | `gpu`, context window in tokens); None = the device decides.
    pub compute_backend: Option<String>,
    pub max_context_tokens: Option<u32>,
    /// Admin override: keep the device's display on (None = the device decides).
    pub keep_screen_on: Option<bool>,
    /// Admin override: multi-token prediction (None = the device decides).
    pub enable_mtp: Option<bool>,
}

#[derive(Clone, PartialEq)]
pub struct ModelRec {
    pub id: Uuid,
    pub name: String,
    /// `chat` or `embedding`.
    pub kind: String,
    pub file_name: String,
    pub size_bytes: i64,
    pub sha256: Option<String>,
}

#[derive(Clone)]
pub struct PoolRec {
    pub id: Uuid,
    pub org_id: Uuid,
    pub balancing: String,
    /// The single model of the pool, only while it is ready.
    pub model: Option<ModelRec>,
}

#[derive(Clone)]
pub struct KeyRec {
    pub id: Uuid,
    pub org_id: Uuid,
    pub hash: String,
    pub all_pools: bool,
    pub pools: HashSet<Uuid>,
    pub expires_at: Option<DateTime<Utc>>,
    pub revoked: bool,
    pub limits: Limits,
}

#[derive(Default)]
pub struct Cache {
    pub nodes: HashMap<Uuid, NodeRec>,
    pub pools: HashMap<Uuid, PoolRec>,
    pub keys: HashMap<String, KeyRec>, // by sha256 hex of the token
    /// Organisation-wide rate limits.
    pub org_limits: HashMap<Uuid, Limits>,
}

pub type SharedCache = Arc<RwLock<Cache>>;

const NODE_SQL: &str =
    "select id, org_id, pool_id, public_key, approved, compute_backend, max_context_tokens, keep_screen_on, enable_mtp from nodes";
const POOL_SQL: &str =
    "select p.id, p.org_id, p.balancing_type::text as balancing, m.id as model_id, m.name, m.kind::text as kind, \
     m.file_name, m.size_bytes, m.sha256 from pools p \
     left join pool_models pm on pm.pool_id = p.id \
     left join models m on m.id = pm.model_id and m.status = 'ready'";
const KEY_SQL: &str = "select k.id, k.org_id, k.hash, k.all_pools, k.expires_at, k.revoked_at, \
     k.limit_requests_per_minute, k.limit_tokens_per_minute, k.limit_tokens_per_day, \
     coalesce((select array_agg(pool_id) from api_key_pools where key_id = k.id), '{}') as pools from api_keys k";

const ORG_SQL: &str =
    "select id, limit_requests_per_minute, limit_tokens_per_minute, limit_tokens_per_day from organisations";

fn limits_from(r: &sqlx::postgres::PgRow) -> Limits {
    Limits {
        requests_per_minute: r
            .get::<Option<i32>, _>("limit_requests_per_minute")
            .and_then(|v| u32::try_from(v).ok()),
        tokens_per_minute: r
            .get::<Option<i32>, _>("limit_tokens_per_minute")
            .and_then(|v| u32::try_from(v).ok()),
        tokens_per_day: r
            .get::<Option<i64>, _>("limit_tokens_per_day")
            .and_then(|v| u64::try_from(v).ok()),
    }
}

fn node_from(r: &sqlx::postgres::PgRow) -> Option<NodeRec> {
    let raw = B64.decode(r.get::<String, _>("public_key")).ok()?;
    let key = VerifyingKey::from_bytes(&raw.try_into().ok()?).ok()?;
    Some(NodeRec {
        id: r.get("id"),
        org_id: r.get("org_id"),
        pool_id: r.get("pool_id"),
        public_key: key,
        approved: r.get("approved"),
        compute_backend: r
            .get::<Option<String>, _>("compute_backend")
            .filter(|b| b == "cpu" || b == "gpu"),
        max_context_tokens: r
            .get::<Option<i32>, _>("max_context_tokens")
            .and_then(|v| u32::try_from(v).ok())
            .filter(|v| *v > 0),
        keep_screen_on: r.get("keep_screen_on"),
        enable_mtp: r.get("enable_mtp"),
    })
}

fn pool_from(r: &sqlx::postgres::PgRow) -> PoolRec {
    let model = r.get::<Option<Uuid>, _>("model_id").map(|id| ModelRec {
        id,
        name: r.get("name"),
        kind: r.get("kind"),
        file_name: r.get("file_name"),
        size_bytes: r.get::<Option<i64>, _>("size_bytes").unwrap_or(0),
        sha256: r.get("sha256"),
    });
    PoolRec {
        id: r.get("id"),
        org_id: r.get("org_id"),
        balancing: r.get("balancing"),
        model,
    }
}

pub fn key_from(r: &sqlx::postgres::PgRow) -> KeyRec {
    KeyRec {
        id: r.get("id"),
        org_id: r.get("org_id"),
        hash: r.get("hash"),
        all_pools: r.get("all_pools"),
        pools: r.get::<Vec<Uuid>, _>("pools").into_iter().collect(),
        expires_at: r.get("expires_at"),
        revoked: r.get::<Option<DateTime<Utc>>, _>("revoked_at").is_some(),
        limits: limits_from(r),
    }
}

/// Looks one key up by hash (cache miss path, so a new key works before its change event arrives).
pub async fn fetch_key(db: &PgPool, hash: &str) -> Result<Option<KeyRec>> {
    let row = sqlx::query(&format!("{KEY_SQL} where k.hash = $1"))
        .bind(hash)
        .fetch_optional(db)
        .await?;
    Ok(row.as_ref().map(key_from))
}

async fn full_load(db: &PgPool) -> Result<(Cache, i64)> {
    // The cursor is read first so changes made while loading are simply applied again.
    let seq: i64 = sqlx::query_scalar("select coalesce(max(seq), 0) from config_changes")
        .fetch_one(db)
        .await?;
    let mut c = Cache::default();
    for r in sqlx::query(NODE_SQL).fetch_all(db).await? {
        if let Some(n) = node_from(&r) {
            c.nodes.insert(n.id, n);
        }
    }
    for r in sqlx::query(POOL_SQL).fetch_all(db).await? {
        let p = pool_from(&r);
        c.pools.insert(p.id, p);
    }
    for r in sqlx::query(KEY_SQL).fetch_all(db).await? {
        let k = key_from(&r);
        c.keys.insert(k.hash.clone(), k);
    }
    for r in sqlx::query(ORG_SQL).fetch_all(db).await? {
        c.org_limits.insert(r.get("id"), limits_from(&r));
    }
    Ok((c, seq))
}

/// Re-fetches the current row of one changed entity and swaps it in (or removes it).
async fn apply(db: &PgPool, cache: &SharedCache, kind: &str, id: Uuid) -> Result<()> {
    match kind {
        "node" => {
            let row = sqlx::query(&format!("{NODE_SQL} where id = $1"))
                .bind(id)
                .fetch_optional(db)
                .await?;
            let node = row.as_ref().and_then(node_from);
            let mut c = cache.write().unwrap();
            match node {
                Some(n) => c.nodes.insert(id, n),
                None => c.nodes.remove(&id),
            };
        }
        "pool" => reload_pools(db, cache, "p.id = $1", id).await?,
        // A model change affects every pool that serves (or served) it.
        "model" => reload_pools(db, cache, "pm.model_id = $1", id).await?,
        "api_key" => {
            let row = sqlx::query(&format!("{KEY_SQL} where k.id = $1"))
                .bind(id)
                .fetch_optional(db)
                .await?;
            let mut c = cache.write().unwrap();
            c.keys.retain(|_, k| k.id != id);
            if let Some(r) = row {
                let k = key_from(&r);
                c.keys.insert(k.hash.clone(), k);
            }
        }
        // An organisation is only recorded when it changes or is deleted; its children record their own changes,
        // but dropping everything of a deleted org here keeps the cache honest.
        "organisation" => {
            let row = sqlx::query(&format!("{ORG_SQL} where id = $1"))
                .bind(id)
                .fetch_optional(db)
                .await?;
            if let Some(r) = row {
                cache.write().unwrap().org_limits.insert(id, limits_from(&r));
            } else {
                let mut c = cache.write().unwrap();
                c.org_limits.remove(&id);
                c.nodes.retain(|_, n| n.org_id != id);
                c.pools.retain(|_, p| p.org_id != id);
                c.keys.retain(|_, k| k.org_id != id);
            }
        }
        _ => {}
    }
    Ok(())
}

async fn reload_pools(db: &PgPool, cache: &SharedCache, filter: &str, id: Uuid) -> Result<()> {
    // Pools that lost a model are no longer matched by `pm.model_id`, so also refresh pools already holding it.
    let held: Vec<Uuid> = {
        let c = cache.read().unwrap();
        c.pools
            .values()
            .filter(|p| p.model.as_ref().map(|m| m.id) == Some(id))
            .map(|p| p.id)
            .collect()
    };
    let rows = sqlx::query(&format!("{POOL_SQL} where {filter} or p.id = any($2)"))
        .bind(id)
        .bind(&held)
        .fetch_all(db)
        .await?;
    let mut c = cache.write().unwrap();
    let mut seen = HashSet::new();
    for r in &rows {
        let p = pool_from(r);
        seen.insert(p.id);
        c.pools.insert(p.id, p);
    }
    // A pool that vanished (deleted) while we held it.
    if filter.starts_with("p.id") && !seen.contains(&id) {
        c.pools.remove(&id);
    }
    for pid in held {
        if !seen.contains(&pid) {
            c.pools.remove(&pid);
        }
    }
    Ok(())
}

/// Runs forever: LISTEN first, then snapshot, then catch up on every wake-up (NOTIFY, reconnect, 30 s backstop).
/// `changed` is signalled after each applied batch so live state (sockets, assignments) can be reconciled.
pub async fn run(db: PgPool, cache: SharedCache, changed: Arc<Notify>, ready: Arc<tokio::sync::watch::Sender<bool>>) {
    let mut cursor: i64;
    let mut listener: Option<PgListener> = None;
    loop {
        // (Re)connect the listener, then take a snapshot.
        match PgListener::connect_with(&db).await {
            Ok(mut l) => match l.listen("config_changes").await {
                Ok(()) => listener = Some(l),
                Err(e) => warn!("config listen failed: {e}"),
            },
            Err(e) => warn!("config listener connect failed: {e}"),
        }
        match full_load(&db).await {
            Ok((c, seq)) => {
                *cache.write().unwrap() = c;
                cursor = seq;
                info!(seq, "config cache loaded");
                changed.notify_waiters();
                let _ = ready.send(true);
                break;
            }
            Err(e) => {
                warn!("config load failed: {e}");
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
        }
    }
    let mut listener = listener;
    loop {
        // Wait for a wake-up.
        match listener.as_mut() {
            Some(l) => {
                if let Ok(Err(e)) = tokio::time::timeout(Duration::from_secs(30), l.recv()).await {
                    warn!("config listener error (it reconnects): {e}");
                }
            }
            None => tokio::time::sleep(Duration::from_secs(30)).await,
        }
        if let Err(e) = catch_up(&db, &cache, &mut cursor).await {
            warn!("config catch-up failed: {e}");
            let _ = ready.send(false);
            continue;
        }
        let _ = ready.send(true);
        changed.notify_waiters();
    }
}

async fn catch_up(db: &PgPool, cache: &SharedCache, cursor: &mut i64) -> Result<()> {
    // Sequence values can commit out of order, so re-read a small overlap; applying is idempotent.
    let from = (*cursor - 200).max(0);
    let rows = sqlx::query("select seq, entity_type, entity_id from config_changes where seq > $1 order by seq")
        .bind(from)
        .fetch_all(db)
        .await?;
    let min: Option<i64> = sqlx::query_scalar("select min(seq) from config_changes")
        .fetch_one(db)
        .await?;
    if let Some(min) = min {
        if *cursor > 0 && min > *cursor + 1 {
            warn!("config log gap, full resync");
            let (c, seq) = full_load(db).await?;
            *cache.write().unwrap() = c;
            *cursor = seq;
            return Ok(());
        }
    }
    let mut seen = HashSet::new();
    let mut max = *cursor;
    for r in &rows {
        let seq: i64 = r.get("seq");
        max = max.max(seq);
        let kind: String = r.get("entity_type");
        let id: Uuid = r.get("entity_id");
        if seen.insert((kind.clone(), id)) {
            apply(db, cache, &kind, id).await?;
        }
    }
    *cursor = max;
    Ok(())
}
