//! Commands for connected devices (today: restart). The control plane inserts a row into `node_commands` and sends
//! `NOTIFY node_commands`; every gateway instance wakes up, and the one that holds the node's connection claims the row
//! with a delete and sends the command. A row nobody claims (the node is offline or on a dead instance) is dropped after
//! `STALE_SECS`: a restart that arrives late would only surprise the admin. Notifications may be lost, so the table is
//! also polled.

use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

use sqlx::postgres::PgListener;
use sqlx::Row;
use tracing::{info, warn};
use uuid::Uuid;

use crate::proto::envelope::Body;
use crate::proto::{self, Envelope};
use crate::registry::Outbound;
use crate::state::AppState;

const STALE_SECS: i64 = 120;
const POLL: Duration = Duration::from_secs(5);
/// How long a node may finish what it is serving before it restarts.
pub const RESTART_GRACE_SECS: u32 = 60;

pub async fn run_loop(app: Arc<AppState>) {
    loop {
        let mut listener = match PgListener::connect_with(&app.db).await {
            Ok(mut l) => match l.listen("node_commands").await {
                Ok(()) => Some(l),
                Err(e) => {
                    warn!("node command listen failed: {e}");
                    None
                }
            },
            Err(e) => {
                warn!("node command listener connect failed: {e}");
                None
            }
        };
        // Poll on a timer and wake early on a notification; a broken listener is rebuilt by the outer loop.
        for _ in 0..360 {
            claim(&app).await;
            match listener.as_mut() {
                Some(l) => {
                    if let Ok(Err(e)) = tokio::time::timeout(POLL, l.recv()).await {
                        warn!("node command listener error (it reconnects): {e}");
                        break;
                    }
                }
                None => tokio::time::sleep(POLL).await,
            }
        }
    }
}

/// Claims the pending commands of the nodes this instance holds and delivers them.
async fn claim(app: &Arc<AppState>) {
    let _ = sqlx::query("delete from node_commands where created_at < now() - make_interval(secs => $1)")
        .bind(STALE_SECS as f64)
        .execute(&app.db)
        .await;
    let held: Vec<Uuid> = app.registry.all().iter().map(|c| c.node_id).collect();
    if held.is_empty() {
        return;
    }
    let rows = match sqlx::query("delete from node_commands where node_id = any($1) returning node_id, command")
        .bind(&held)
        .fetch_all(&app.db)
        .await
    {
        Ok(r) => r,
        Err(e) => {
            warn!("node command claim failed: {e}");
            return;
        }
    };
    for r in rows {
        let node: Uuid = r.get("node_id");
        let command: String = r.get("command");
        if let ("restart", Some(conn)) = (command.as_str(), app.registry.get(node)) {
            info!(%node, "restarting node on request");
            restart(&conn);
        }
    }
}

/// Stops routing to the node and tells it to restart. The flag is lifted after the grace period plus a margin, so a node
/// that predates this command (and ignores it) is not shut out forever; a node that does restart comes back as a new
/// connection anyway.
pub fn restart(conn: &Arc<crate::registry::NodeConn>) {
    conn.restarting.store(true, Ordering::Relaxed);
    let _ = conn.tx.try_send(Outbound::Send(Envelope {
        body: Some(Body::Restart(proto::Restart {
            grace_seconds: RESTART_GRACE_SECS,
        })),
    }));
    let c = conn.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(RESTART_GRACE_SECS as u64 + 30)).await;
        c.restarting.store(false, Ordering::Relaxed);
    });
}
