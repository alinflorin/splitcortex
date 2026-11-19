//! Per-organisation operational metrics, written to `pool_metrics` (gateway numbers per pool and minute) and
//! `node_metrics` (telemetry history per node and minute); read by the control plane (`GET /organisations/:id/metrics`).
//! Requests, errors and tokens are not here: `usage_records` has them.
//!
//! Counters live in memory and flush in additive batches. Like audit and unlike usage metering this is **not
//! fail-closed**: metrics never block serving; a full buffer drops the oldest minute and says so in the log. Never one
//! row per request, never prompts, completions or key material, and nothing about the gateway itself (instance ids,
//! cluster state): rows are keyed by organisation and pool only. Pruned by the control plane's
//! `control-plane-metrics-prune` CronJob (default 7 days).

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use chrono::{DateTime, TimeZone, Utc};
use sqlx::PgPool;
use tracing::warn;
use uuid::Uuid;

/// Upper bounds (ms) of the latency histogram buckets; bucket i counts samples <= BOUNDS_MS[i], the last everything
/// above. **Shared with the control plane (`src/control-plane/src/dto/metrics.ts`): change both or neither.**
pub const BOUNDS_MS: [u64; 9] = [100, 250, 500, 1000, 2500, 5000, 10_000, 30_000, 60_000];
pub const BUCKETS: usize = BOUNDS_MS.len() + 1;
const MAX_POOL_ROWS: usize = 20_000;
const MAX_NODE_ROWS: usize = 50_000;

fn bucket_of(ms: u64) -> usize {
    BOUNDS_MS.iter().position(|b| ms <= *b).unwrap_or(BOUNDS_MS.len())
}

fn minute() -> i64 {
    Utc::now().timestamp() / 60 * 60
}

#[derive(Clone, Default, Debug, PartialEq)]
pub struct PoolRow {
    pub rate_limited: i64,
    pub unavailable: i64,
    pub peak_in_flight: i32,
    pub latency: [i32; BUCKETS],
    pub ttft: [i32; BUCKETS],
}

impl PoolRow {
    fn merge(&mut self, o: &PoolRow) {
        self.rate_limited += o.rate_limited;
        self.unavailable += o.unavailable;
        self.peak_in_flight = self.peak_in_flight.max(o.peak_in_flight);
        for i in 0..BUCKETS {
            self.latency[i] += o.latency[i];
            self.ttft[i] += o.ttft[i];
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct NodeSample {
    pub cpu_percent: Option<f64>,
    pub memory_used_mb: Option<i32>,
    pub battery_percent: Option<i32>,
    pub charging: Option<bool>,
    pub temperature_c: Option<f64>,
    pub in_flight: i32,
    pub tokens_per_sec: Option<f64>,
}

#[derive(Default)]
struct Inner {
    pools: HashMap<(i64, Uuid, Uuid), PoolRow>,
    /// The last report of the minute per node, with its organisation and pool.
    nodes: HashMap<(i64, Uuid), (Uuid, Uuid, NodeSample)>,
    dropped: u64,
}

#[derive(Default)]
pub struct Metrics {
    inner: Mutex<Inner>,
}

impl Metrics {
    fn with_pool(&self, org: Uuid, pool: Uuid, f: impl FnOnce(&mut PoolRow)) {
        let m = minute();
        let mut inner = self.inner.lock().unwrap();
        if inner.pools.len() >= MAX_POOL_ROWS && !inner.pools.contains_key(&(m, org, pool)) {
            // Drop the oldest minute rather than grow without bound.
            if let Some(oldest) = inner.pools.keys().map(|k| k.0).min() {
                let before = inner.pools.len();
                inner.pools.retain(|k, _| k.0 != oldest);
                inner.dropped += (before - inner.pools.len()) as u64;
            }
        }
        f(inner.pools.entry((m, org, pool)).or_default());
    }

    /// A finished request: total duration and time to the first node event (None when it never got one).
    pub fn request(&self, org: Uuid, pool: Uuid, total: Duration, ttft: Option<Duration>) {
        self.with_pool(org, pool, |r| {
            r.latency[bucket_of(total.as_millis() as u64)] += 1;
            if let Some(t) = ttft {
                r.ttft[bucket_of(t.as_millis() as u64)] += 1;
            }
        });
    }

    /// Refused by a rate limit (429).
    pub fn rate_limited(&self, org: Uuid, pool: Uuid) {
        self.with_pool(org, pool, |r| r.rate_limited += 1);
    }

    /// No node could serve the request (502/503).
    pub fn unavailable(&self, org: Uuid, pool: Uuid) {
        self.with_pool(org, pool, |r| r.unavailable += 1);
    }

    /// The pool's running requests right now (on this instance); the minute keeps the peak.
    pub fn in_flight(&self, org: Uuid, pool: Uuid, n: u32) {
        self.with_pool(org, pool, |r| r.peak_in_flight = r.peak_in_flight.max(n as i32));
    }

    /// A node's telemetry; the last report of a minute wins.
    pub fn node(&self, org: Uuid, pool: Uuid, node: Uuid, s: NodeSample) {
        let m = minute();
        let mut inner = self.inner.lock().unwrap();
        if inner.nodes.len() >= MAX_NODE_ROWS && !inner.nodes.contains_key(&(m, node)) {
            if let Some(oldest) = inner.nodes.keys().map(|k| k.0).min() {
                let before = inner.nodes.len();
                inner.nodes.retain(|k, _| k.0 != oldest);
                inner.dropped += (before - inner.nodes.len()) as u64;
            }
        }
        inner.nodes.insert((m, node), (org, pool, s));
    }

    #[allow(clippy::type_complexity)]
    fn take(
        &self,
    ) -> (
        HashMap<(i64, Uuid, Uuid), PoolRow>,
        HashMap<(i64, Uuid), (Uuid, Uuid, NodeSample)>,
    ) {
        let mut inner = self.inner.lock().unwrap();
        if inner.dropped > 0 {
            warn!(
                dropped = inner.dropped,
                "metrics buffer overflowed, oldest minutes dropped"
            );
            inner.dropped = 0;
        }
        (std::mem::take(&mut inner.pools), std::mem::take(&mut inner.nodes))
    }

    /// Puts a failed batch back; newer values of the same row win for nodes, counters add up for pools.
    #[allow(clippy::type_complexity)]
    fn put_back(
        &self,
        pools: HashMap<(i64, Uuid, Uuid), PoolRow>,
        nodes: HashMap<(i64, Uuid), (Uuid, Uuid, NodeSample)>,
    ) {
        let mut inner = self.inner.lock().unwrap();
        for (k, v) in pools {
            if inner.pools.len() >= MAX_POOL_ROWS && !inner.pools.contains_key(&k) {
                inner.dropped += 1;
                continue;
            }
            inner.pools.entry(k).or_default().merge(&v);
        }
        for (k, v) in nodes {
            if inner.nodes.len() >= MAX_NODE_ROWS && !inner.nodes.contains_key(&k) {
                inner.dropped += 1;
                continue;
            }
            inner.nodes.entry(k).or_insert(v);
        }
    }

    /// One flush attempt (one transaction). On failure the rows go back into the buffer.
    pub async fn flush(&self, db: &PgPool) -> bool {
        let (pools, nodes) = self.take();
        if pools.is_empty() && nodes.is_empty() {
            return true;
        }
        match write(db, &pools, &nodes).await {
            Ok(()) => true,
            Err(e) => {
                warn!(rows = pools.len() + nodes.len(), "metrics flush failed: {e}");
                self.put_back(pools, nodes);
                false
            }
        }
    }
}

fn at(secs: i64) -> DateTime<Utc> {
    Utc.timestamp_opt(secs, 0).single().unwrap_or_else(Utc::now)
}

async fn write(
    db: &PgPool,
    pools: &HashMap<(i64, Uuid, Uuid), PoolRow>,
    nodes: &HashMap<(i64, Uuid), (Uuid, Uuid, NodeSample)>,
) -> Result<(), sqlx::Error> {
    let mut tx = db.begin().await?;
    for ((m, org, pool), r) in pools {
        // Several instances (and a retry) add to the same row; histograms add bucket by bucket. An organisation
        // deleted meanwhile would violate the foreign key: that row is dropped, not the batch.
        sqlx::query(
            "insert into pool_metrics (bucket, org_id, pool_id, rate_limited, unavailable, peak_in_flight, latency_hist, ttft_hist) \
             select $1, $2, $3, $4, $5, $6, $7, $8 where exists (select 1 from organisations where id = $2) \
             on conflict (bucket, org_id, pool_id) do update set \
             rate_limited = pool_metrics.rate_limited + excluded.rate_limited, \
             unavailable = pool_metrics.unavailable + excluded.unavailable, \
             peak_in_flight = greatest(pool_metrics.peak_in_flight, excluded.peak_in_flight), \
             latency_hist = (select array_agg(a + b order by i) from unnest(pool_metrics.latency_hist, excluded.latency_hist) with ordinality as t(a, b, i)), \
             ttft_hist = (select array_agg(a + b order by i) from unnest(pool_metrics.ttft_hist, excluded.ttft_hist) with ordinality as t(a, b, i))",
        )
        .bind(at(*m))
        .bind(org)
        .bind(pool)
        .bind(r.rate_limited)
        .bind(r.unavailable)
        .bind(r.peak_in_flight)
        .bind(r.latency.to_vec())
        .bind(r.ttft.to_vec())
        .execute(&mut *tx)
        .await?;
    }
    for ((m, node), (org, pool, s)) in nodes {
        sqlx::query(
            "insert into node_metrics (bucket, node_id, org_id, pool_id, cpu_percent, memory_used_mb, battery_percent, charging, \
             temperature_c, in_flight, tokens_per_sec) \
             select $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11 where exists (select 1 from organisations where id = $3) \
             on conflict (bucket, node_id) do update set org_id = excluded.org_id, pool_id = excluded.pool_id, \
             cpu_percent = excluded.cpu_percent, memory_used_mb = excluded.memory_used_mb, \
             battery_percent = excluded.battery_percent, charging = excluded.charging, \
             temperature_c = excluded.temperature_c, in_flight = excluded.in_flight, tokens_per_sec = excluded.tokens_per_sec",
        )
        .bind(at(*m))
        .bind(node)
        .bind(org)
        .bind(pool)
        .bind(s.cpu_percent)
        .bind(s.memory_used_mb)
        .bind(s.battery_percent)
        .bind(s.charging)
        .bind(s.temperature_c)
        .bind(s.in_flight)
        .bind(s.tokens_per_sec)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await
}

/// Flushes every 20 seconds, with backoff after failures.
pub async fn flush_loop(metrics: std::sync::Arc<Metrics>, db: PgPool) {
    let mut delay = 20u64;
    loop {
        tokio::time::sleep(Duration::from_secs(delay)).await;
        delay = if metrics.flush(&db).await {
            20
        } else {
            (delay * 2).min(120)
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn samples_land_in_the_right_bucket() {
        assert_eq!(bucket_of(0), 0);
        assert_eq!(bucket_of(100), 0);
        assert_eq!(bucket_of(101), 1);
        assert_eq!(bucket_of(60_000), 8);
        assert_eq!(bucket_of(60_001), 9);
        assert_eq!(BUCKETS, 10);
    }

    #[test]
    fn counters_add_up_per_org_and_pool() {
        let m = Metrics::default();
        let (o1, o2, p) = (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4());
        m.request(o1, p, Duration::from_millis(80), Some(Duration::from_millis(20)));
        m.request(o1, p, Duration::from_millis(3000), None);
        m.rate_limited(o1, p);
        m.unavailable(o2, p);
        m.in_flight(o1, p, 3);
        m.in_flight(o1, p, 1);
        let (pools, _) = m.take();
        assert_eq!(pools.len(), 2, "organisations are separate rows");
        let a = pools.iter().find(|(k, _)| k.1 == o1).unwrap().1;
        assert_eq!((a.latency[0], a.latency[5], a.ttft[0]), (1, 1, 1));
        assert_eq!((a.rate_limited, a.peak_in_flight), (1, 3));
        assert_eq!(pools.iter().find(|(k, _)| k.1 == o2).unwrap().1.unavailable, 1);
    }

    #[test]
    fn a_failed_flush_is_added_back() {
        let m = Metrics::default();
        let (o, p) = (Uuid::new_v4(), Uuid::new_v4());
        m.request(o, p, Duration::from_millis(10), None);
        let (pools, nodes) = m.take();
        m.request(o, p, Duration::from_millis(10), None);
        m.put_back(pools, nodes);
        let (pools, _) = m.take();
        assert_eq!(pools.values().next().unwrap().latency[0], 2);
    }

    #[test]
    fn only_the_last_node_report_of_a_minute_is_kept() {
        let m = Metrics::default();
        let (o, p, n) = (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4());
        m.node(
            o,
            p,
            n,
            NodeSample {
                in_flight: 1,
                ..Default::default()
            },
        );
        m.node(
            o,
            p,
            n,
            NodeSample {
                in_flight: 2,
                ..Default::default()
            },
        );
        let (_, nodes) = m.take();
        assert_eq!(nodes.len(), 1);
        assert_eq!(nodes.values().next().unwrap().2.in_flight, 2);
    }
}
