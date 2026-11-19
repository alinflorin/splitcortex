//! Audit events of the gateway, written to `audit_logs` (the control plane writes the rest, see
//! `src/control-plane/src/plugins/audit.ts`). Only security and lifecycle events that belong to an organisation are
//! recorded: a node connecting, disconnecting or being refused, a revoked or expired key being used, a limit being hit.
//! **Never one row per request**, and never prompts, completions or key material.
//!
//! Events are buffered in memory and flushed in batches. Unlike usage metering this is *not* fail-closed: audit never
//! blocks serving. A full buffer drops the oldest events and says so in the log. Repeats of the same event (same
//! organisation, action and entity) inside `THROTTLE` are folded into one row that carries a `repeats` count, so a
//! flooding client or a flapping phone cannot fill the table.

use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use sqlx::PgPool;
use tracing::warn;
use uuid::Uuid;

const THROTTLE: Duration = Duration::from_secs(60);
const MAX_BUFFERED: usize = 5000;
const MAX_THROTTLE_KEYS: usize = 20_000;

pub struct Event {
    pub org: Uuid,
    pub actor_type: &'static str,
    pub actor_id: Option<String>,
    pub action: &'static str,
    pub entity_type: &'static str,
    pub entity_id: Option<String>,
    pub outcome: &'static str,
    pub metadata: Value,
}

struct Row {
    at: DateTime<Utc>,
    ev: Event,
}

#[derive(Default)]
struct Inner {
    buf: VecDeque<Row>,
    /// Last emission per (org, action, entity) and the repeats folded since.
    seen: HashMap<(Uuid, &'static str, Option<String>), (Instant, u32)>,
    dropped: u64,
}

#[derive(Default)]
pub struct Audit {
    inner: Mutex<Inner>,
}

impl Audit {
    /// Queues an event unless the same one was recorded less than a minute ago (then it only counts as a repeat).
    pub fn record(&self, mut ev: Event) {
        let mut inner = self.inner.lock().unwrap();
        let key = (ev.org, ev.action, ev.entity_id.clone());
        let now = Instant::now();
        if inner.seen.len() >= MAX_THROTTLE_KEYS {
            inner.seen.retain(|_, (t, _)| now.duration_since(*t) < THROTTLE);
        }
        match inner.seen.get_mut(&key) {
            Some((t, repeats)) if now.duration_since(*t) < THROTTLE => {
                *repeats += 1;
                return;
            }
            Some((t, repeats)) => {
                if *repeats > 0 {
                    if let Some(m) = ev.metadata.as_object_mut() {
                        m.insert("repeats".into(), json!(*repeats));
                    }
                }
                *t = now;
                *repeats = 0;
            }
            None => {
                inner.seen.insert(key, (now, 0));
            }
        }
        if inner.buf.len() >= MAX_BUFFERED {
            inner.buf.pop_front();
            inner.dropped += 1;
        }
        inner.buf.push_back(Row { at: Utc::now(), ev });
    }

    fn take(&self) -> Vec<Row> {
        let mut inner = self.inner.lock().unwrap();
        if inner.dropped > 0 {
            warn!(
                dropped = inner.dropped,
                "audit buffer overflowed, oldest events dropped"
            );
            inner.dropped = 0;
        }
        inner.buf.drain(..).collect()
    }

    fn put_back(&self, rows: Vec<Row>) {
        let mut inner = self.inner.lock().unwrap();
        for r in rows.into_iter().rev() {
            if inner.buf.len() >= MAX_BUFFERED {
                inner.dropped += 1;
                continue;
            }
            inner.buf.push_front(r);
        }
    }

    #[cfg(test)]
    fn buffered(&self) -> usize {
        self.inner.lock().unwrap().buf.len()
    }

    /// One flush attempt (one transaction). On failure the rows go back to the front of the buffer.
    pub async fn flush(&self, db: &PgPool) -> bool {
        let rows = self.take();
        if rows.is_empty() {
            return true;
        }
        match write(db, &rows).await {
            Ok(()) => true,
            Err(e) => {
                warn!(rows = rows.len(), "audit flush failed: {e}");
                self.put_back(rows);
                false
            }
        }
    }
}

async fn write(db: &PgPool, rows: &[Row]) -> Result<(), sqlx::Error> {
    let mut tx = db.begin().await?;
    for r in rows {
        // An organisation deleted meanwhile would violate the foreign key; that row is dropped, not the batch.
        sqlx::query(
            "insert into audit_logs (org_id, occurred_at, source, actor_type, actor_id, action, entity_type, entity_id, outcome, metadata) \
             select $1, $2, 'gateway', $3, $4, $5, $6, $7, $8, $9 where exists (select 1 from organisations where id = $1)",
        )
        .bind(r.ev.org)
        .bind(r.at)
        .bind(r.ev.actor_type)
        .bind(&r.ev.actor_id)
        .bind(r.ev.action)
        .bind(r.ev.entity_type)
        .bind(&r.ev.entity_id)
        .bind(r.ev.outcome)
        .bind(&r.ev.metadata)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await
}

/// Flushes every few seconds, with backoff after failures.
pub async fn flush_loop(audit: std::sync::Arc<Audit>, db: PgPool) {
    let mut delay = 5u64;
    loop {
        tokio::time::sleep(Duration::from_secs(delay)).await;
        delay = if audit.flush(&db).await { 5 } else { (delay * 2).min(60) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(org: Uuid, entity: &str) -> Event {
        Event {
            org,
            actor_type: "node",
            actor_id: Some(entity.into()),
            action: "node.connect_rejected",
            entity_type: "node",
            entity_id: Some(entity.into()),
            outcome: "denied",
            metadata: json!({}),
        }
    }

    #[test]
    fn folds_repeats_inside_the_throttle_window() {
        let a = Audit::default();
        let org = Uuid::new_v4();
        for _ in 0..50 {
            a.record(ev(org, "n1"));
        }
        assert_eq!(a.buffered(), 1, "one row for a flood from one entity");
        a.record(ev(org, "n2"));
        a.record(ev(Uuid::new_v4(), "n1"));
        assert_eq!(a.buffered(), 3, "other entities and other organisations are separate");
    }

    #[test]
    fn the_next_row_after_the_window_carries_the_repeat_count() {
        let a = Audit::default();
        let org = Uuid::new_v4();
        for _ in 0..4 {
            a.record(ev(org, "n1"));
        }
        // Age the throttle entry.
        for (t, _) in a.inner.lock().unwrap().seen.values_mut() {
            *t = Instant::now() - THROTTLE - Duration::from_secs(1);
        }
        a.record(ev(org, "n1"));
        let rows = a.take();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[1].ev.metadata["repeats"], 3);
    }

    #[test]
    fn overflow_drops_the_oldest() {
        let a = Audit::default();
        for i in 0..(MAX_BUFFERED + 10) {
            a.record(ev(Uuid::new_v4(), &i.to_string()));
        }
        assert_eq!(a.buffered(), MAX_BUFFERED);
        assert_eq!(a.take()[0].ev.entity_id.as_deref(), Some("10"));
    }
}
