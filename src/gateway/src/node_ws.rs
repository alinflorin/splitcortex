//! The node leg: `GET /node` upgrades to a WebSocket carrying protobuf `Envelope`s (one per binary frame).

use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::Response;
use ed25519_dalek::{Signature, Signer, Verifier};
use futures_util::{SinkExt, StreamExt};
use prost::Message as _;
use rand::RngCore;
use tokio::sync::mpsc;
use tracing::{debug, info};
use uuid::Uuid;

use crate::proto::envelope::Body;
use crate::proto::{self, Envelope, ModelPhase};
use crate::registry::{NodeConn, NodeEvent, Outbound};
use crate::state::AppState;

const GATEWAY_HELLO: &[u8] = b"splitcortex-gateway-hello-v1";
const NODE_HELLO: &[u8] = b"splitcortex-node-hello-v1";
const NEXT_KEY: &[u8] = b"splitcortex-gateway-next-key-v1";
/// How long the requests of a dropped connection wait for the node to come back and resume them.
pub const RESUME_GRACE: Duration = Duration::from_secs(20);
const PROTOCOL_VERSION: u32 = 1;
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
const PING_EVERY: Duration = Duration::from_secs(20);
const IDLE_LIMIT: Duration = Duration::from_secs(60);
/// A phone runs one generation at a time.
const NODE_CAPACITY: u32 = 1;

fn signed(label: &[u8], parts: &[&[u8]]) -> Vec<u8> {
    let mut m = label.to_vec();
    for p in parts {
        m.push(b'\n');
        m.extend_from_slice(p);
    }
    m
}

fn env(body: Body) -> Envelope {
    Envelope { body: Some(body) }
}

pub async fn upgrade(ws: WebSocketUpgrade, State(app): State<Arc<AppState>>) -> Response {
    if app.draining.load(Ordering::Relaxed) {
        // Shutting down: the node reconnects (with backoff) and lands on another instance.
        return axum::response::IntoResponse::into_response(axum::http::StatusCode::SERVICE_UNAVAILABLE);
    }
    ws.max_message_size(1 << 20).on_upgrade(move |socket| async move {
        if let Err(reason) = serve(app, socket).await {
            // Never says why to the node; the log carries no key material.
            debug!("node connection ended: {reason}");
        }
    })
}

async fn recv_env(socket: &mut WebSocket) -> Result<Envelope, &'static str> {
    loop {
        match tokio::time::timeout(HANDSHAKE_TIMEOUT, socket.recv()).await {
            Err(_) => return Err("handshake timeout"),
            Ok(None) | Ok(Some(Err(_))) => return Err("closed"),
            Ok(Some(Ok(Message::Binary(b)))) => return Envelope::decode(b).map_err(|_| "bad frame"),
            Ok(Some(Ok(Message::Close(_)))) => return Err("closed"),
            Ok(Some(Ok(_))) => continue, // ping/pong/text frames are ignored
        }
    }
}

async fn serve(app: Arc<AppState>, mut socket: WebSocket) -> Result<(), &'static str> {
    // 1. ClientHello.
    let Some(Body::ClientHello(hello)) = recv_env(&mut socket).await?.body else {
        return Err("expected hello");
    };
    if hello.protocol_version != PROTOCOL_VERSION || hello.nonce.len() != 32 {
        return Err("bad hello");
    }
    // 2. ServerHello: the gateway proves its key first (the node pinned it at enrollment). Sent for any node id so an
    //    unknown id is indistinguishable from a bad signature.
    let mut server_nonce = vec![0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut server_nonce);
    let sig = app
        .signing_key
        .sign(&signed(GATEWAY_HELLO, &[&hello.nonce, hello.node_id.as_bytes()]));
    let sh = env(Body::ServerHello(proto::ServerHello {
        nonce: server_nonce.clone(),
        signature: sig.to_bytes().to_vec(),
    }));
    socket
        .send(Message::Binary(sh.encode_to_vec().into()))
        .await
        .map_err(|_| "closed")?;

    // 3. ClientAuth: proof of possession of the registered device key.
    let Some(Body::ClientAuth(auth)) = recv_env(&mut socket).await?.body else {
        return Err("expected auth");
    };
    let node_id: Uuid = hello.node_id.parse().map_err(|_| "auth failed")?;
    let rec = app
        .cache
        .read()
        .unwrap()
        .nodes
        .get(&node_id)
        .cloned()
        .ok_or("auth failed")?;
    if !rec.approved {
        return Err("auth failed");
    }
    let sig = Signature::from_slice(&auth.signature).map_err(|_| "auth failed")?;
    let msg = signed(NODE_HELLO, &[&server_nonce, &hello.nonce, hello.node_id.as_bytes()]);
    rec.public_key.verify(&msg, &sig).map_err(|_| "auth failed")?;

    // Authenticated. Identity (org, pool) comes from the registered record.
    let (out_tx, mut out_rx) = mpsc::channel::<Outbound>(64);
    let conn = Arc::new(NodeConn {
        conn_id: Uuid::new_v4(),
        node_id,
        org_id: rec.org_id,
        pool_id: rec.pool_id,
        tx: out_tx,
        in_flight: Default::default(),
        capacity: NODE_CAPACITY,
        ready_model: Mutex::new(None),
        assigned: Mutex::new(None),
        tps_bits: Default::default(),
        assignment_sent: Default::default(),
        ctx_tokens: Default::default(),
        modalities: Default::default(),
        config_sent: Default::default(),
        resuming: Default::default(),
        since: std::time::Instant::now(),
    });
    let waiting = app.registry.register(conn.clone());
    if waiting > 0 {
        // Requests of the previous connection wait for this node to list them (it does so right after Ready).
        conn.resuming.store(true, Ordering::Relaxed);
        schedule_expiry(&app, node_id);
        let c = conn.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(5)).await;
            c.resuming.store(false, Ordering::Relaxed);
        });
    }
    set_connected(&app, node_id, true).await;
    info!(node = %node_id, "node connected");

    let (mut sink, mut stream) = socket.split();
    let mut writer = tokio::spawn(async move {
        while let Some(o) = out_rx.recv().await {
            match o {
                Outbound::Send(e) => {
                    if sink.send(Message::Binary(e.encode_to_vec().into())).await.is_err() {
                        break;
                    }
                }
                Outbound::Close => {
                    let _ = sink.send(Message::Close(None)).await;
                    break;
                }
            }
        }
    });

    // Key rotation: while a next key is configured, announce it signed by the current one (the node pinned that).
    let (next_gateway_key, next_gateway_key_signature) = match &app.next_key {
        Some(next) => {
            let key = next.verifying_key().to_bytes().to_vec();
            let sig = app.signing_key.sign(&signed(NEXT_KEY, &[&hello.nonce, &key]));
            (key, sig.to_bytes().to_vec())
        }
        None => (Vec::new(), Vec::new()),
    };
    let _ = conn
        .tx
        .send(Outbound::Send(env(Body::Ready(proto::Ready {
            max_in_flight: NODE_CAPACITY,
            ping_interval_seconds: PING_EVERY.as_secs() as u32,
            next_gateway_key,
            next_gateway_key_signature,
        }))))
        .await;
    sync_assignment(&app, &conn);
    sync_config(&app, &conn);

    let mut ping = tokio::time::interval(PING_EVERY);
    let mut last_seen = tokio::time::Instant::now();
    let result = loop {
        tokio::select! {
            _ = ping.tick() => {
                if last_seen.elapsed() > IDLE_LIMIT { break Err("idle"); }
                let _ = conn.tx.try_send(Outbound::Send(env(Body::Ping(proto::Ping { timestamp_ms: now_ms() }))));
            }
            msg = stream.next() => {
                let Some(Ok(msg)) = msg else { break Ok(()) };
                last_seen = tokio::time::Instant::now();
                match msg {
                    Message::Binary(b) => match Envelope::decode(b) {
                        Ok(e) => handle(&app, &conn, e).await,
                        Err(_) => break Err("bad frame"),
                    },
                    Message::Close(_) => break Ok(()),
                    _ => {}
                }
            }
            _ = &mut writer => {
                break Ok(()); // the writer ended (replaced or closed by reconcile)
            }
        }
    };

    writer.abort();
    let (removed, waiting) = app.registry.unregister(node_id, conn.conn_id);
    if waiting > 0 {
        schedule_expiry(&app, node_id);
    }
    if removed {
        set_connected(&app, node_id, false).await;
    }
    info!(node = %node_id, "node disconnected");
    result
}

/// Fails the requests still waiting for `node_id` once the grace period is over.
fn schedule_expiry(app: &Arc<AppState>, node_id: Uuid) {
    let app = app.clone();
    tokio::spawn(async move {
        tokio::time::sleep(RESUME_GRACE).await;
        app.registry.expire_detached(node_id, RESUME_GRACE);
    });
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

async fn handle(app: &Arc<AppState>, conn: &Arc<NodeConn>, e: Envelope) {
    let node = conn.node_id;
    match e.body {
        Some(Body::Ping(p)) => {
            let _ = conn.tx.try_send(Outbound::Send(env(Body::Pong(proto::Pong {
                timestamp_ms: p.timestamp_ms,
            }))));
        }
        Some(Body::Pong(_)) => {}
        Some(Body::ModelState(s)) => {
            let ready = ModelPhase::try_from(s.phase).ok() == Some(ModelPhase::Ready);
            let id = s.model_id.parse::<Uuid>().ok();
            // Only the model the gateway assigned counts as ready.
            let assigned = *conn.assigned.lock().unwrap();
            *conn.ready_model.lock().unwrap() = if ready && id.is_some() && id == assigned {
                id
            } else {
                None
            };
            // What the model accepts besides text counts only while it is the ready, assigned one.
            let mods = if conn.ready_model.lock().unwrap().is_some() {
                crate::registry::modalities_from(&s.modalities)
            } else {
                0
            };
            conn.modalities.store(mods, Ordering::Relaxed);
            update_model_status(app, node, &s).await;
        }
        Some(Body::Telemetry(t)) => {
            conn.tps_bits.store(t.tokens_per_sec.to_bits(), Ordering::Relaxed);
            conn.ctx_tokens.store(t.max_context_tokens, Ordering::Relaxed);
            let backend = (t.backend == "cpu" || t.backend == "gpu").then_some(t.backend.clone());
            let _ = sqlx::query(
                "insert into node_status (node_id, connected, cpu_percent, memory_used_mb, battery_percent, charging, \
                 temperature_c, in_flight, tokens_per_sec, backend, max_context_tokens, gateway_id, modalities, updated_at) \
                 values ($1, true, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now()) \
                 on conflict (node_id) do update set cpu_percent = $2, memory_used_mb = $3, battery_percent = $4, \
                 charging = $5, temperature_c = $6, in_flight = $7, tokens_per_sec = $8, backend = $9, \
                 max_context_tokens = $10, gateway_id = $11, modalities = $12, updated_at = now()",
            )
            .bind(node)
            .bind((t.cpu_percent >= 0.0).then_some(t.cpu_percent))
            .bind((t.memory_used_mb > 0).then_some(t.memory_used_mb as i32))
            .bind((t.battery_percent >= 0).then_some(t.battery_percent))
            .bind((t.battery_percent >= 0).then_some(t.charging))
            .bind((t.temperature_c > -100.0).then_some(t.temperature_c))
            .bind(conn.load() as i32)
            .bind(t.tokens_per_sec)
            .bind(backend)
            .bind((t.max_context_tokens > 0).then_some(t.max_context_tokens as i32))
            .bind(&app.instance_id)
            .bind(crate::registry::modality_names(conn.modalities.load(Ordering::Relaxed)).join(","))
            .execute(&app.db)
            .await;
        }
        Some(Body::InferenceChunk(c)) => {
            app.registry
                .deliver(node, &c.request_id, c.seq, NodeEvent::Chunk(c.text))
                .await
        }
        Some(Body::InferenceDone(d)) => {
            app.registry
                .deliver(
                    node,
                    &d.request_id,
                    d.seq,
                    NodeEvent::Done {
                        finish_reason: d.finish_reason,
                    },
                )
                .await
        }
        Some(Body::InferenceError(x)) => {
            app.registry
                .deliver(
                    node,
                    &x.request_id,
                    x.seq,
                    NodeEvent::Error {
                        code: x.code,
                        message: x.message,
                    },
                )
                .await
        }
        Some(Body::Resume(r)) => {
            let (resumed, unknown) = app.registry.resume(conn, &r.request_ids);
            conn.resuming.store(false, Ordering::Relaxed);
            if !r.request_ids.is_empty() {
                let entries = resumed
                    .into_iter()
                    .map(|(request_id, received_seq)| proto::ResumeEntry {
                        request_id,
                        received_seq,
                    })
                    .collect();
                let _ = conn
                    .tx
                    .try_send(Outbound::Send(env(Body::ResumeAck(proto::ResumeAck { entries }))));
                for request_id in unknown {
                    let _ = conn
                        .tx
                        .try_send(Outbound::Send(env(Body::Cancel(proto::Cancel { request_id }))));
                }
            }
        }
        Some(Body::GatewayKeys(k)) => {
            let ids: Vec<String> = k.key_ids.iter().take(8).map(|b| hex(b)).collect();
            let _ = sqlx::query("update node_status set gateway_keys = $2 where node_id = $1")
                .bind(node)
                .bind(ids.join(","))
                .execute(&app.db)
                .await;
        }
        _ => {} // handshake messages after the handshake, or gateway-only messages: ignored
    }
}

/// Tells the node which model its pool serves, if that changed since the last assignment.
pub fn sync_assignment(app: &AppState, conn: &NodeConn) {
    let model = app
        .cache
        .read()
        .unwrap()
        .pools
        .get(&conn.pool_id)
        .and_then(|p| p.model.clone());
    let want = model.as_ref().map(|m| m.id);
    let mut assigned = conn.assigned.lock().unwrap();
    if *assigned == want && conn.assigned_sent() {
        return;
    }
    *assigned = want;
    // A different (or no) model invalidates readiness until the node reports it.
    let mut ready = conn.ready_model.lock().unwrap();
    if *ready != want {
        *ready = None;
    }
    drop(ready);
    let msg = match model {
        Some(m) => proto::ModelAssignment {
            model_id: m.id.to_string(),
            name: m.name,
            file_name: m.file_name,
            size_bytes: m.size_bytes as u64,
            sha256: m.sha256.unwrap_or_default(),
        },
        None => proto::ModelAssignment::default(),
    };
    conn.mark_assigned_sent();
    let _ = conn.tx.try_send(Outbound::Send(env(Body::ModelAssignment(msg))));
}

/// Tells the node its admin overrides (compute backend, context window) on connect and whenever they change.
pub fn sync_config(app: &AppState, conn: &NodeConn) {
    let want = app
        .cache
        .read()
        .unwrap()
        .nodes
        .get(&conn.node_id)
        .map(|n| {
            (
                n.compute_backend.clone().unwrap_or_default(),
                n.max_context_tokens.unwrap_or(0),
                match n.keep_screen_on {
                    Some(true) => "on",
                    Some(false) => "off",
                    None => "",
                }
                .to_string(),
                match n.enable_mtp {
                    Some(true) => "on",
                    Some(false) => "off",
                    None => "",
                }
                .to_string(),
            )
        })
        .unwrap_or_default();
    let mut sent = conn.config_sent.lock().unwrap();
    if sent.as_ref() == Some(&want) {
        return;
    }
    let msg = proto::NodeConfig {
        backend: want.0.clone(),
        max_context_tokens: want.1,
        keep_screen_on: want.2.clone(),
        enable_mtp: want.3.clone(),
    };
    *sent = Some(want);
    let _ = conn.tx.try_send(Outbound::Send(env(Body::NodeConfig(msg))));
}

/// Applies config changes to live connections: revoked, unapproved or moved nodes are closed at once, and pool model
/// changes are pushed to the nodes.
pub async fn reconcile_loop(app: Arc<AppState>) {
    loop {
        let wake = app.changed.notified();
        let _ = tokio::time::timeout(Duration::from_secs(10), wake).await;
        for conn in app.registry.all() {
            let rec = app.cache.read().unwrap().nodes.get(&conn.node_id).cloned();
            match rec {
                Some(r) if r.approved && r.pool_id == conn.pool_id && r.org_id == conn.org_id => {
                    sync_assignment(&app, &conn);
                    sync_config(&app, &conn);
                }
                _ => {
                    let _ = conn.tx.try_send(Outbound::Close);
                }
            }
        }
    }
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// Records where the node is connected. A disconnect only counts when this gateway still holds the node (it may have
/// reconnected to another instance meanwhile).
async fn set_connected(app: &AppState, node: Uuid, connected: bool) {
    let _ = sqlx::query(
        "insert into node_status (node_id, connected, connected_since, gateway_id, updated_at) \
         values ($1, $2, case when $2 then now() end, case when $2 then $3 end, now()) \
         on conflict (node_id) do update set connected = $2, \
         connected_since = case when $2 then now() else node_status.connected_since end, \
         gateway_id = case when $2 then $3 else node_status.gateway_id end, \
         in_flight = 0, updated_at = now() \
         where $2 or node_status.gateway_id is not distinct from $3",
    )
    .bind(node)
    .bind(connected)
    .bind(&app.instance_id)
    .execute(&app.db)
    .await;
}

async fn update_model_status(_app: &AppState, node: Uuid, s: &proto::ModelState) {
    // Model download/load progress is only logged for now (no column for it yet); never logs file contents.
    debug!(%node, model = %s.model_id, phase = s.phase, progress = s.progress_bytes, "model state");
}

/// Keeps `node_status.updated_at` fresh for connected nodes (the control plane treats rows older than 60 s as offline)
/// and closes connections of nodes that have since connected to another gateway instance (a newer connection of a node
/// replaces the older one, wherever it is).
pub async fn heartbeat_loop(app: Arc<AppState>) {
    loop {
        tokio::time::sleep(Duration::from_secs(15)).await;
        let conns = app.registry.all();
        if conns.is_empty() {
            continue;
        }
        let ids: Vec<Uuid> = conns.iter().map(|c| c.node_id).collect();
        if let Ok(moved) = sqlx::query_scalar::<_, Uuid>(
            "select node_id from node_status where node_id = any($1) and connected \
             and gateway_id is not null and gateway_id <> $2",
        )
        .bind(&ids)
        .bind(&app.instance_id)
        .fetch_all(&app.db)
        .await
        {
            for c in conns
                .iter()
                .filter(|c| moved.contains(&c.node_id) && c.since.elapsed() > Duration::from_secs(10))
            {
                let _ = c.tx.try_send(Outbound::Close);
            }
        }
        let _ = sqlx::query("update node_status set updated_at = now() where node_id = any($1) and gateway_id = $2")
            .bind(&ids)
            .bind(&app.instance_id)
            .execute(&app.db)
            .await;
    }
}
