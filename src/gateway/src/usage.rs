//! Usage metering: counters in memory, flushed to `usage_records` in additive batches (see docs/gateway.md). Fails
//! closed: when the buffer is full or its oldest bucket is stale, new inference requests get 503 instead of being
//! served unmetered. The gateway counts tokens itself; node-reported counts are never trusted.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use chrono::{DateTime, TimeZone, Utc};
use sqlx::PgPool;
use tracing::{info, warn};
use uuid::Uuid;

#[derive(Hash, PartialEq, Eq, Clone)]
struct Bucket {
    minute: i64, // unix seconds, floored to the minute
    org: Uuid,
    pool: Uuid,
    key: Uuid,
    model: String,
}

#[derive(Default, Clone)]
struct Counters {
    tokens_in: i64,
    tokens_out: i64,
    requests: i64,
    errors: i64,
}

pub struct Usage {
    buf: Mutex<HashMap<Bucket, Counters>>,
    max_buckets: usize,
    max_age_secs: i64,
}

impl Usage {
    pub fn new(max_buckets: usize, max_age_secs: i64) -> Self {
        Self {
            buf: Mutex::new(HashMap::new()),
            max_buckets,
            max_age_secs,
        }
    }

    #[allow(clippy::too_many_arguments)] // one flat call per finished request keeps the hot path simple
    pub fn record(&self, org: Uuid, pool: Uuid, key: Uuid, model: &str, tokens_in: u32, tokens_out: u32, error: bool) {
        let minute = Utc::now().timestamp() / 60 * 60;
        let mut buf = self.buf.lock().unwrap();
        let c = buf
            .entry(Bucket {
                minute,
                org,
                pool,
                key,
                model: model.to_string(),
            })
            .or_default();
        c.tokens_in += tokens_in as i64;
        c.tokens_out += tokens_out as i64;
        c.requests += 1;
        c.errors += error as i64;
    }

    /// False when new requests must be refused (buffer full or oldest unflushed bucket too old).
    pub fn healthy(&self) -> bool {
        let buf = self.buf.lock().unwrap();
        if buf.len() >= self.max_buckets {
            return false;
        }
        match buf.keys().map(|b| b.minute).min() {
            Some(oldest) => Utc::now().timestamp() - oldest <= self.max_age_secs,
            None => true,
        }
    }

    pub fn buffered(&self) -> usize {
        self.buf.lock().unwrap().len()
    }

    /// One flush attempt. Each batch is one transaction carrying a unique batch id, so a retry after an ambiguous
    /// commit hits the primary key and is a no-op. On failure the counters are merged back into the buffer.
    pub async fn flush(&self, db: &PgPool) -> bool {
        let batch = std::mem::take(&mut *self.buf.lock().unwrap());
        if batch.is_empty() {
            return true;
        }
        match write_batch(db, &batch).await {
            Ok(()) => true,
            Err(e) => {
                warn!(buckets = batch.len(), "usage flush failed: {e}");
                let mut buf = self.buf.lock().unwrap();
                for (k, v) in batch {
                    let c = buf.entry(k).or_default();
                    c.tokens_in += v.tokens_in;
                    c.tokens_out += v.tokens_out;
                    c.requests += v.requests;
                    c.errors += v.errors;
                }
                false
            }
        }
    }
}

async fn write_batch(db: &PgPool, batch: &HashMap<Bucket, Counters>) -> Result<(), sqlx::Error> {
    let mut tx = db.begin().await?;
    let batch_id = Uuid::new_v4();
    sqlx::query("insert into usage_flushes (batch_id) values ($1)")
        .bind(batch_id)
        .execute(&mut *tx)
        .await?;
    for (b, c) in batch {
        let bucket: DateTime<Utc> = Utc.timestamp_opt(b.minute, 0).single().unwrap_or_else(Utc::now);
        // An organisation deleted meanwhile violates the foreign key; that row is dropped rather than failing the batch.
        sqlx::query(
            "insert into usage_records (bucket, org_id, pool_id, key_id, model, tokens_in, tokens_out, requests, errors) \
             select $1, $2, $3, $4, $5, $6, $7, $8, $9 where exists (select 1 from organisations where id = $2) \
             on conflict (bucket, org_id, pool_id, key_id, model) do update set \
             tokens_in = usage_records.tokens_in + excluded.tokens_in, \
             tokens_out = usage_records.tokens_out + excluded.tokens_out, \
             requests = usage_records.requests + excluded.requests, \
             errors = usage_records.errors + excluded.errors",
        )
        .bind(bucket)
        .bind(b.org)
        .bind(b.pool)
        .bind(b.key)
        .bind(&b.model)
        .bind(c.tokens_in)
        .bind(c.tokens_out)
        .bind(c.requests)
        .bind(c.errors)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await
}

/// Flushes every few seconds with backoff after failures; one last flush on shutdown is done by the caller.
pub async fn flush_loop(usage: std::sync::Arc<Usage>, db: PgPool) {
    let mut delay = 5u64;
    loop {
        tokio::time::sleep(Duration::from_secs(delay)).await;
        if usage.flush(&db).await {
            delay = 5;
        } else {
            delay = (delay * 2).min(60);
        }
        if usage.buffered() > 0 {
            info!(buckets = usage.buffered(), "usage buffered");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fails_closed_when_the_buffer_is_full_or_stale() {
        let u = Usage::new(2, 600);
        assert!(u.healthy());
        let (org, pool) = (Uuid::new_v4(), Uuid::new_v4());
        u.record(org, pool, Uuid::new_v4(), "m", 1, 2, false);
        assert!(u.healthy());
        u.record(org, pool, Uuid::new_v4(), "m", 1, 2, false);
        assert!(!u.healthy(), "full buffer refuses new requests");

        let stale = Usage::new(100, 60);
        stale.buf.lock().unwrap().insert(
            Bucket {
                minute: Utc::now().timestamp() - 3600,
                org,
                pool,
                key: Uuid::new_v4(),
                model: "m".into(),
            },
            Counters::default(),
        );
        assert!(!stale.healthy(), "an old unflushed bucket refuses new requests");
    }

    #[test]
    fn records_add_up_per_bucket() {
        let u = Usage::new(10, 600);
        let (org, pool, key) = (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4());
        u.record(org, pool, key, "m", 3, 4, false);
        u.record(org, pool, key, "m", 1, 1, true);
        let buf = u.buf.lock().unwrap();
        assert_eq!(buf.len(), 1);
        let c = buf.values().next().unwrap();
        assert_eq!((c.tokens_in, c.tokens_out, c.requests, c.errors), (4, 5, 2, 1));
    }
}
