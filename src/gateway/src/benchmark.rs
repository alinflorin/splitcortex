//! Benchmarks: the control plane writes one `benchmark_results` row per online node; the instance that holds the node
//! runs a fixed, platform-supplied prompt on it and records time to first token and generation speed. Prompts and
//! answers of customers are never involved, and nothing here is metered.

use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use sqlx::Row;
use tracing::{debug, warn};
use uuid::Uuid;

use crate::proto::envelope::Body;
use crate::proto::{self, Envelope};
use crate::registry::{NodeEvent, Outbound};
use crate::state::AppState;

const PROMPT: &str =
    "Write a short story about a lighthouse keeper who finds a message in a bottle. Keep going until you are stopped.";
const MAX_TOKENS: u32 = 96;
/// A result nobody ran within this time failed (the node went away, or was busy for too long).
const OVERDUE_SECS: i32 = 180;
const WAIT_FOR_NODE: Duration = Duration::from_secs(90);
const RUN_TIMEOUT: Duration = Duration::from_secs(120);

pub async fn run_loop(app: Arc<AppState>) {
    let busy: Arc<Mutex<HashSet<Uuid>>> = Default::default();
    loop {
        tokio::time::sleep(Duration::from_secs(4)).await;
        if app.draining.load(std::sync::atomic::Ordering::Relaxed) {
            continue;
        }
        let _ = sqlx::query(
            "update benchmark_results set status = 'failed', error = 'The node was not available in time', \
             finished_at = now() where status in ('pending', 'running') \
             and created_at < now() - make_interval(secs => $1)",
        )
        .bind(OVERDUE_SECS)
        .execute(&app.db)
        .await;

        let local: Vec<Uuid> = {
            let busy = busy.lock().unwrap();
            app.registry
                .all()
                .iter()
                .map(|c| c.node_id)
                .filter(|id| !busy.contains(id))
                .collect()
        };
        if local.is_empty() {
            continue;
        }
        let claimed = sqlx::query(
            "update benchmark_results set status = 'running', started_at = now() where id in ( \
               select id from benchmark_results where status = 'pending' and node_id = any($1) \
               order by created_at for update skip locked) returning id, node_id",
        )
        .bind(&local)
        .fetch_all(&app.db)
        .await;
        let Ok(rows) = claimed else { continue };
        for r in rows {
            let (id, node): (Uuid, Uuid) = (r.get("id"), r.get("node_id"));
            if !busy.lock().unwrap().insert(node) {
                // Two results of one node (cannot happen with one benchmark at a time): put it back.
                let _ = sqlx::query("update benchmark_results set status = 'pending' where id = $1")
                    .bind(id)
                    .execute(&app.db)
                    .await;
                continue;
            }
            let (app, busy) = (app.clone(), busy.clone());
            tokio::spawn(async move {
                let outcome = run_one(&app, node).await;
                busy.lock().unwrap().remove(&node);
                let _ = match outcome {
                    Ok(m) => {
                        sqlx::query(
                            "update benchmark_results set status = 'done', ttft_ms = $2, total_ms = $3, tokens = $4, \
                             tokens_per_sec = $5, finished_at = now() where id = $1",
                        )
                        .bind(id)
                        .bind(m.ttft_ms)
                        .bind(m.total_ms)
                        .bind(m.tokens)
                        .bind(m.tokens_per_sec)
                        .execute(&app.db)
                        .await
                    }
                    Err(e) => {
                        debug!(%node, "benchmark failed: {e}");
                        sqlx::query(
                            "update benchmark_results set status = 'failed', error = $2, finished_at = now() where id = $1",
                        )
                        .bind(id)
                        .bind(e)
                        .execute(&app.db)
                        .await
                    }
                };
            });
        }
    }
}

struct Measured {
    ttft_ms: i32,
    total_ms: i32,
    tokens: i32,
    tokens_per_sec: Option<f64>,
}

async fn run_one(app: &Arc<AppState>, node_id: Uuid) -> Result<Measured, String> {
    let model = {
        let c = app.cache.read().unwrap();
        let conn = app.registry.get(node_id).ok_or("The node is not connected")?;
        c.pools
            .get(&conn.pool_id)
            .and_then(|p| p.model.clone())
            .ok_or("The pool serves no model")?
    };
    // Wait for the node to be idle and to have the model ready (it may be serving a customer request).
    let started = Instant::now();
    let conn = loop {
        let conn = app.registry.get(node_id).ok_or("The node disconnected")?;
        if *conn.ready_model.lock().unwrap() == Some(model.id) && app.registry.reserve(&conn) {
            break conn;
        }
        if started.elapsed() > WAIT_FOR_NODE {
            return Err("The node stayed busy or had no model ready".into());
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    };

    let request_id = Uuid::new_v4().to_string();
    let mut rx = app.registry.track_request(&request_id, &conn);
    let result = async {
        let msg = Envelope {
            body: Some(Body::InferenceRequest(proto::InferenceRequest {
                request_id: request_id.clone(),
                model_id: model.id.to_string(),
                messages: vec![proto::ChatMessage {
                    role: "user".into(),
                    content: PROMPT.into(),
                }],
                max_tokens: MAX_TOKENS,
                temperature: 0.0,
                top_p: 0.0,
            })),
        };
        conn.tx
            .send(Outbound::Send(msg))
            .await
            .map_err(|_| "The node disconnected".to_string())?;
        let t0 = Instant::now();
        let mut first: Option<Instant> = None;
        let mut tokens = 0i32;
        loop {
            match tokio::time::timeout(RUN_TIMEOUT, rx.recv()).await {
                Ok(Some(NodeEvent::Chunk(t))) => {
                    if !t.is_empty() {
                        tokens += 1;
                        first.get_or_insert_with(Instant::now);
                    }
                }
                Ok(Some(NodeEvent::Done { .. })) => {
                    let end = Instant::now();
                    let first = first.ok_or("The node produced no tokens")?;
                    let decode = end.duration_since(first).as_secs_f64();
                    return Ok(Measured {
                        ttft_ms: first.duration_since(t0).as_millis() as i32,
                        total_ms: end.duration_since(t0).as_millis() as i32,
                        tokens,
                        tokens_per_sec: (tokens > 1 && decode > 0.0).then(|| (tokens - 1) as f64 / decode),
                    });
                }
                Ok(Some(NodeEvent::Error { message, .. })) => return Err(message),
                Ok(Some(NodeEvent::Disconnected)) | Ok(None) => return Err("The node disconnected".into()),
                Err(_) => return Err("The node took too long".into()),
            }
        }
    }
    .await;
    if result.is_err() {
        let cancel = Envelope {
            body: Some(Body::Cancel(proto::Cancel {
                request_id: request_id.clone(),
            })),
        };
        let _ = conn.tx.try_send(Outbound::Send(cancel));
    }
    app.registry.finish_request(&request_id, &conn);
    if result.is_err() {
        warn!(node = %node_id, "benchmark run did not finish");
    }
    result
}
