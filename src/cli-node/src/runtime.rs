//! The node's service: owns the gateway connection, the model on disk and the engine, and serves inference requests one
//! at a time. Port of `src/desktop-node/src/runtime/NodeRuntime.ts`. Requests and answers are never logged, only counts.

use crate::connection::{ConnState, Connection, Event, Options, TrustedKeys};
use crate::crypto::{b64, unb64};
use crate::engine::compute::{Backend, ComputeEngine, Prefs, Source};
use crate::engine::{Engine, GenerateReq, Message, Part};
use crate::enroll::{
    StoredEnrollment, get_or_create_identity, http_client, load_enrollment, refresh_enrollment,
    save_enrollment,
};
use crate::models::{Assignment, Kind, ModelManager, Phase, Status};
use crate::proto::{self, envelope::Body};
use crate::restart::{Action, Restarter};
use crate::settings::{self, Settings};
use crate::storage::Dirs;
use crate::system::{APP_VERSION, Awake, Sampler};
use anyhow::{Result, anyhow, bail};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use tracing::{error, info, warn};

/// More than this many frames per request are not retained (a resume of such a request cannot be completed).
const OUTBOX_FRAMES: usize = 20_000;
/// A finished request stays resumable this long.
const OUTBOX_KEEP: Duration = Duration::from_secs(60);
/// If the gateway has been unreachable this long, running requests are given up (the gateway fails them after 20 s).
const OFFLINE_ABORT: Duration = Duration::from_secs(40);
const APPROVAL_POLL: Duration = Duration::from_secs(10);

/// A request the gateway may need to hear again after a dropped connection: everything sent for it carries a sequence
/// number and is kept until the request is long finished, so a reconnect can resend what the gateway missed.
#[derive(Default)]
struct Outbox {
    seq: u32,
    frames: Vec<(u32, Body)>,
}

#[derive(Default)]
struct Stats {
    requests: u64,
    tokens: u64,
    tokens_per_sec: f64,
}

struct Shared {
    conn: Connection,
    engine: Arc<ComputeEngine>,
    outbox: Mutex<HashMap<String, Outbox>>,
    active: Mutex<HashMap<String, Arc<AtomicBool>>>,
    stats: Mutex<Stats>,
    /// Embedding requests being answered (they cannot be cancelled half way, only waited for).
    embeds: AtomicUsize,
    sampler: Sampler,
    awake: Awake,
    /// The node's own "keep awake" setting and the admin override (which wins).
    screen: Mutex<(bool, Option<bool>)>,
    done: mpsc::UnboundedSender<()>,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl Shared {
    /// Sends a numbered frame for a request and keeps it so a reconnect can resend it.
    fn emit(&self, id: &str, make: impl FnOnce(u32) -> Body) {
        let body = {
            let mut boxes = lock(&self.outbox);
            let Some(b) = boxes.get_mut(id) else { return }; // cancelled or given up
            b.seq += 1;
            let body = make(b.seq);
            if b.frames.len() < OUTBOX_FRAMES {
                b.frames.push((b.seq, body.clone()));
            }
            body
        };
        self.conn.send(body); // false while disconnected: it is resent on resume
    }

    fn apply_screen(&self) {
        let (local, admin) = *lock(&self.screen);
        if let Err(e) = self.awake.set(admin.unwrap_or(local)) {
            warn!("Cannot change sleep prevention: {e}");
        }
    }

    fn send_telemetry(&self) {
        let t = self.sampler.sample();
        self.conn.send(Body::Telemetry(proto::Telemetry {
            cpu_percent: t.cpu_percent,
            memory_used_mb: t.memory_used_mb,
            battery_percent: t.battery_percent,
            charging: t.charging,
            temperature_c: t.temperature_c,
            tokens_per_sec: lock(&self.stats).tokens_per_sec,
            backend: self
                .engine
                .backend()
                .map(|b| b.as_str())
                .unwrap_or("")
                .to_string(),
            max_context_tokens: self.engine.max_context_tokens().max(0) as u32,
        }));
    }

    /// The request is over: keep its frames a little while (a reconnect may still need them), then forget them.
    fn finish_box(self: &Arc<Self>, id: String) {
        let me = self.clone();
        tokio::spawn(async move {
            tokio::time::sleep(OUTBOX_KEEP).await;
            lock(&me.outbox).remove(&id);
        });
    }
}

fn phase(p: Phase) -> proto::ModelPhase {
    match p {
        Phase::None => proto::ModelPhase::None,
        Phase::Downloading => proto::ModelPhase::Downloading,
        Phase::Loading => proto::ModelPhase::Loading,
        Phase::Ready => proto::ModelPhase::Ready,
        Phase::Failed => proto::ModelPhase::Failed,
    }
}

/// How a run of the node ended.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum End {
    /// Shut down (signal): exit.
    Stopped,
    /// The gateway asked for a restart (`Restart`): the caller starts the process again.
    Restart,
}

/// Why a request cannot be taken now, as an `InferenceError` code and message; `None` = take it. `busy` only matters
/// for chat (one generation at a time; embeddings queue on the engine). Order: restarting, wrong kind of model, busy,
/// no such model loaded.
fn refusal(
    want: Kind,
    restarting: bool,
    busy: bool,
    model_id: &str,
    model: &Status,
) -> Option<(&'static str, &'static str)> {
    if restarting {
        Some(("restarting", "The node is restarting"))
    } else if model.phase != Phase::None && model.kind != want {
        Some((
            "wrong_model_kind",
            "This node serves a different kind of model",
        ))
    } else if busy {
        Some(("busy", "The node is already generating"))
    } else if model_id != model.model_id || model.phase != Phase::Ready {
        Some(("model_not_ready", "The requested model is not loaded"))
    } else {
        None
    }
}

/// Waits until the admin approves this device (device routes reject unapproved ones).
async fn wait_for_approval(dirs: &Dirs, shutdown: &CancellationToken) -> Result<StoredEnrollment> {
    let mut announced = false;
    loop {
        let Some(e) = load_enrollment(dirs) else {
            bail!("Not enrolled: run `splitcortex-node join` first");
        };
        if e.approved {
            return Ok(e);
        }
        if let Some(e) = refresh_enrollment(dirs).await
            && e.approved
        {
            return Ok(e);
        }
        if !announced {
            warn!("Waiting for an admin to approve this device");
            announced = true;
        }
        tokio::select! {
            _ = shutdown.cancelled() => bail!("Stopped while waiting for approval"),
            _ = tokio::time::sleep(APPROVAL_POLL) => {}
        }
    }
}

/// Runs the node until `shutdown` is cancelled.
pub async fn run(dirs: Dirs, shutdown: CancellationToken) -> Result<End> {
    let enrollment = wait_for_approval(&dirs, &shutdown).await?;
    let Some(mut pinned) = enrollment.gateway.clone() else {
        bail!("The platform has not given this device a gateway yet");
    };
    let key = get_or_create_identity(&dirs)?;
    let settings: Settings = dirs.read_json(settings::FILE).unwrap_or_default();

    let engine = ComputeEngine::new(Arc::new(Engine::default()), dirs.clone());
    engine
        .set_prefs(Source::Local, settings.prefs())
        .await
        .map_err(|e| anyhow!(e))?;

    let (conn_tx, mut conn_rx) = mpsc::unbounded_channel();
    let (model_tx, mut model_rx) = mpsc::unbounded_channel::<Status>();
    let (done_tx, mut done_rx) = mpsc::unbounded_channel::<()>();
    let decode = |s: &str| unb64(s).ok_or_else(|| anyhow!("the stored gateway key is not valid"));
    let conn = Connection::start(
        Options {
            url: pinned.url.clone(),
            node_id: enrollment.node_id.clone(),
            key: key.clone(),
            keys: TrustedKeys {
                current: decode(&pinned.public_key)?,
                next: pinned
                    .next_keys
                    .iter()
                    .map(|k| decode(k))
                    .collect::<Result<_>>()?,
            },
            app_version: APP_VERSION.into(),
        },
        conn_tx,
    );
    let shared = Arc::new(Shared {
        conn,
        engine: engine.clone(),
        outbox: Mutex::default(),
        active: Mutex::default(),
        stats: Mutex::default(),
        embeds: AtomicUsize::new(0),
        sampler: Sampler::default(),
        awake: Awake::default(),
        screen: Mutex::new((settings.keep_awake, None)),
        done: done_tx,
    });
    shared.apply_screen();
    let models = ModelManager::new(
        dirs.clone(),
        engine.clone(),
        http_client()?,
        enrollment.enrollment_url.clone(),
        enrollment.node_id.clone(),
        key,
        model_tx,
    );

    info!(
        "Starting node {} ({}{})",
        enrollment
            .device_name
            .as_deref()
            .unwrap_or(&enrollment.node_id),
        enrollment.pool_name.as_deref().unwrap_or("?"),
        enrollment
            .org_name
            .as_deref()
            .map(|o| format!(", {o}"))
            .unwrap_or_default()
    );

    let mut model = Status::none();
    let mut busy = false;
    let mut offline_since: Option<Instant> = None;
    let mut telemetry = tokio::time::interval(Duration::from_secs(10));
    let mut watch = tokio::time::interval(Duration::from_secs(5));
    let mut state = ConnState::Idle;
    let mut restarter = Restarter::default();
    let mut restart = false;
    let mut drain = tokio::time::interval(Duration::from_millis(250));

    loop {
        tokio::select! {
            _ = shutdown.cancelled() => break,
            Some(ev) = conn_rx.recv() => match ev {
                Event::State(s) => {
                    if s != state {
                        info!("Connection: {}", s.as_str());
                    }
                    state = s;
                    if s == ConnState::Connected {
                        offline_since = None;
                    } else if offline_since.is_none() {
                        offline_since = Some(Instant::now());
                    }
                }
                Event::Keys(k) => {
                    // Gateway key rotation: remember what the gateway proved (the old key is retired once replaced).
                    pinned.public_key = b64(&k.current);
                    pinned.next_keys = k.next.iter().map(|n| b64(n)).collect();
                    let mut e = enrollment.clone();
                    e.gateway = Some(pinned.clone());
                    if let Some(latest) = load_enrollment(&dirs) {
                        e = StoredEnrollment { gateway: e.gateway, ..latest };
                    }
                    if let Err(err) = save_enrollment(&dirs, &e) {
                        warn!("Cannot save the rotated gateway key: {err}");
                    }
                }
                Event::Body(b) => match b {
                    Body::Ready(_) => {
                        info!("Connected to the gateway");
                        // List the requests this node still holds: the gateway tells which it still tracks and what it missed.
                        let ids = lock(&shared.outbox).keys().cloned().collect();
                        shared.conn.send(Body::Resume(proto::Resume { request_ids: ids }));
                    }
                    Body::ResumeAck(ack) => resend(&shared, ack),
                    Body::ModelAssignment(a) => models.apply(Assignment {
                        model_id: a.model_id,
                        name: a.name,
                        size_bytes: a.size_bytes,
                        sha256: a.sha256,
                        kind: Kind::parse(&a.kind),
                    }),
                    Body::NodeConfig(c) => {
                        let shared = shared.clone();
                        tokio::spawn(async move { apply_admin_config(&shared, c).await });
                    }
                    Body::InferenceRequest(req) => {
                        let id = req.request_id.clone();
                        lock(&shared.outbox).insert(id.clone(), Outbox::default());
                        let refuse = refusal(Kind::Chat, restarter.restarting(), busy, &req.model_id, &model);
                        if let Some((code, message)) = refuse {
                            fail(&shared, &id, code, message);
                            shared.finish_box(id);
                        } else {
                            busy = true;
                            let shared = shared.clone();
                            tokio::spawn(serve(shared, req));
                        }
                    }
                    Body::EmbeddingRequest(req) => {
                        let id = req.request_id.clone();
                        lock(&shared.outbox).insert(id.clone(), Outbox::default());
                        if let Some((code, message)) =
                            refusal(Kind::Embedding, restarter.restarting(), false, &req.model_id, &model)
                        {
                            fail(&shared, &id, code, message);
                            shared.finish_box(id);
                        } else {
                            shared.embeds.fetch_add(1, Ordering::SeqCst);
                            tokio::spawn(serve_embedding(shared.clone(), req));
                        }
                    }
                    Body::Restart(r) => {
                        if !restarter.restarting() {
                            info!(
                                "The platform asked for a restart: finishing running requests (up to {} s)",
                                r.grace_seconds
                            );
                        }
                        restarter.begin(Instant::now(), Duration::from_secs(r.grace_seconds as u64));
                    }
                    Body::Cancel(c) => {
                        if let Some(flag) = lock(&shared.active).get(&c.request_id) {
                            flag.store(true, Ordering::SeqCst);
                        }
                        lock(&shared.outbox).remove(&c.request_id);
                    }
                    _ => {}
                },
            },
            Some(s) = model_rx.recv() => {
                shared.conn.send(Body::ModelState(proto::ModelState {
                    model_id: s.model_id.clone(),
                    phase: phase(s.phase) as i32,
                    progress_bytes: s.progress_bytes,
                    error: s.error.clone().unwrap_or_default(),
                    // What the loaded model accepts besides text; the gateway routes media only to nodes that list it.
                    modalities: if s.phase == Phase::Ready && s.kind == Kind::Chat {
                        shared.engine.modalities().into_iter().map(String::from).collect()
                    } else {
                        Vec::new()
                    },
                    embedding_dimension: if s.phase == Phase::Ready { s.embedding_dimension } else { 0 },
                }));
                if s.phase == Phase::Ready {
                    shared.send_telemetry(); // the gateway routes by context size
                }
                model = s;
            },
            Some(()) = done_rx.recv() => busy = false,
            _ = drain.tick(), if restarter.restarting() => {
                let in_flight = lock(&shared.active).len() + shared.embeds.load(Ordering::SeqCst);
                match restarter.poll(Instant::now(), in_flight) {
                    Action::Wait => {}
                    Action::Cancel => {
                        warn!("Restart: the grace period is over, cancelling {in_flight} running request(s)");
                        lock(&shared.active).values().for_each(|f| f.store(true, Ordering::SeqCst));
                    }
                    Action::Restart => {
                        restart = true;
                        break;
                    }
                }
            },
            _ = telemetry.tick() => shared.send_telemetry(),
            _ = watch.tick() => {
                // No connection for too long while generating: the gateway gave the requests up, so stop wasting power.
                if let Some(t) = offline_since
                    && t.elapsed() > OFFLINE_ABORT
                    && !lock(&shared.active).is_empty()
                {
                    warn!("The gateway stayed unreachable: giving up the running request");
                    lock(&shared.active).values().for_each(|f| f.store(true, Ordering::SeqCst));
                    lock(&shared.outbox).clear();
                    offline_since = None;
                }
            },
        }
    }

    info!("{}", if restart { "Restarting" } else { "Stopping" });
    lock(&shared.active)
        .values()
        .for_each(|f| f.store(true, Ordering::SeqCst));
    models.stop();
    if restart {
        // let the last frames of the finished requests leave before the socket is closed
        tokio::time::sleep(Duration::from_millis(300)).await;
    }
    shared.conn.stop().await;
    engine.unload().await;
    let _ = shared.awake.set(false);
    info!("Stopped");
    Ok(if restart { End::Restart } else { End::Stopped })
}

fn fail(shared: &Shared, id: &str, code: &str, message: &str) {
    shared.emit(id, |seq| {
        Body::InferenceError(proto::InferenceError {
            request_id: id.into(),
            code: code.into(),
            message: message.into(),
            seq,
        })
    });
}

/// Answers an `EmbeddingRequest` with one `EmbeddingResult` (or an `InferenceError`).
async fn serve_embedding(shared: Arc<Shared>, req: proto::EmbeddingRequest) {
    let id = req.request_id.clone();
    let count = req.inputs.len();
    let started = Instant::now();
    let result = shared
        .engine
        .embed(req.inputs, req.task, req.dimensions)
        .await;
    match result {
        Ok(vectors) => {
            shared.emit(&id, |seq| {
                Body::EmbeddingResult(proto::EmbeddingResult {
                    request_id: id.clone(),
                    embeddings: vectors
                        .into_iter()
                        .map(|values| proto::Embedding { values })
                        .collect(),
                    prompt_tokens: 0, // the library does not report it: the gateway estimates
                    seq,
                })
            });
            lock(&shared.stats).requests += 1;
            info!(
                "Embedding request served: {count} input(s) in {:.1} s",
                started.elapsed().as_secs_f64()
            );
        }
        Err(e) => {
            error!("Embedding request failed ({}): {}", e.code, e.message);
            fail(&shared, &id, e.code, &e.message);
        }
    }
    shared.embeds.fetch_sub(1, Ordering::SeqCst);
    shared.finish_box(id);
}

/// The gateway's answer to `Resume`: resend what it missed. Requests it did not list are no longer wanted.
fn resend(shared: &Shared, ack: proto::ResumeAck) {
    let wanted: HashMap<String, u32> = ack
        .entries
        .into_iter()
        .map(|e| (e.request_id, e.received_seq))
        .collect();
    let mut boxes = lock(&shared.outbox);
    let ids: Vec<String> = boxes.keys().cloned().collect();
    for id in ids {
        let Some(received) = wanted.get(&id) else {
            if let Some(flag) = lock(&shared.active).get(&id) {
                flag.store(true, Ordering::SeqCst);
            }
            boxes.remove(&id);
            continue;
        };
        let missed: Vec<Body> = boxes[&id]
            .frames
            .iter()
            .filter(|(seq, _)| seq > received)
            .map(|(_, b)| b.clone())
            .collect();
        info!("Resumed a request: resending {} message(s)", missed.len());
        for b in missed {
            shared.conn.send(b);
        }
    }
}

/// Overrides from the web app (through the gateway): empty fields mean "no override".
async fn apply_admin_config(shared: &Shared, c: proto::NodeConfig) {
    let on_off = |s: &str| match s {
        "on" => Some(true),
        "off" => Some(false),
        _ => None,
    };
    lock(&shared.screen).1 = on_off(&c.keep_screen_on);
    shared.apply_screen();
    let prefs = Prefs {
        backend: Backend::parse(&c.backend),
        max_context_tokens: (c.max_context_tokens > 0).then_some(c.max_context_tokens as i32),
        enable_mtp: on_off(&c.enable_mtp),
    };
    info!(
        "Admin settings: backend {}, context {}, sleep prevention {}, MTP {}",
        if c.backend.is_empty() {
            "not set"
        } else {
            &c.backend
        },
        if c.max_context_tokens > 0 {
            c.max_context_tokens.to_string()
        } else {
            "not set".into()
        },
        if c.keep_screen_on.is_empty() {
            "not set"
        } else {
            &c.keep_screen_on
        },
        if c.enable_mtp.is_empty() {
            "not set"
        } else {
            &c.enable_mtp
        },
    );
    if let Err(e) = shared.engine.set_prefs(Source::Admin, prefs).await {
        error!("Engine reload failed: {e}");
    }
    shared.send_telemetry(); // the gateway routes by context size
}

/// The engine's form of a protocol message: plain text, or the typed parts when it carries media.
fn to_message(m: &proto::ChatMessage) -> Message {
    use base64::Engine as _;
    use proto::content_part::Part as P;
    let b64 = |d: &[u8]| base64::engine::general_purpose::STANDARD.encode(d);
    let parts = m
        .parts
        .iter()
        .filter_map(|p| match p.part.as_ref()? {
            P::Text(t) => Some(Part::Text { text: t.clone() }),
            P::Image(i) => Some(Part::Image { data: b64(&i.data) }),
            P::Audio(a) => Some(Part::Audio { data: b64(&a.data) }),
        })
        .collect();
    Message {
        role: m.role.clone(),
        content: m.content.clone(),
        parts,
    }
}

async fn serve(shared: Arc<Shared>, req: proto::InferenceRequest) {
    let id = req.request_id.clone();
    let cancel = Arc::new(AtomicBool::new(false));
    lock(&shared.active).insert(id.clone(), cancel.clone());
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    let started = Instant::now();
    let gen_req = GenerateReq {
        messages: req.messages.iter().map(to_message).collect(),
        max_tokens: req.max_tokens.min(i32::MAX as u32) as i32,
        temperature: req.temperature,
        top_p: req.top_p,
    };
    let engine = shared.engine.clone();
    let flag = cancel.clone();
    let mut run = tokio::spawn(async move {
        engine
            .generate(
                gen_req,
                flag,
                Box::new(move |t| {
                    let _ = tx.send(t);
                }),
            )
            .await
    });

    let mut pieces: u32 = 0;
    let send_chunk = |text: String, pieces: &mut u32| {
        if cancel.load(Ordering::SeqCst) {
            return;
        }
        *pieces += 1;
        shared.emit(&id, |seq| {
            Body::InferenceChunk(proto::InferenceChunk {
                request_id: id.clone(),
                text,
                seq,
            })
        });
    };
    let result = loop {
        tokio::select! {
            Some(text) = rx.recv() => send_chunk(text, &mut pieces),
            r = &mut run => break r,
        }
    };
    while let Ok(text) = rx.try_recv() {
        send_chunk(text, &mut pieces);
    }
    let cancelled = cancel.load(Ordering::SeqCst);
    match result {
        Ok(Ok(())) => {
            if !cancelled {
                let finish = if req.max_tokens > 0 && pieces >= req.max_tokens {
                    "length"
                } else {
                    "stop"
                };
                shared.emit(&id, |seq| {
                    Body::InferenceDone(proto::InferenceDone {
                        request_id: id.clone(),
                        prompt_tokens: 0,
                        completion_tokens: pieces,
                        finish_reason: finish.into(),
                        seq,
                    })
                });
            }
            let secs = started.elapsed().as_secs_f64().max(0.001);
            {
                let mut s = lock(&shared.stats);
                s.requests += 1;
                s.tokens += pieces as u64;
                if pieces > 0 {
                    s.tokens_per_sec = pieces as f64 / secs;
                }
            }
            info!(
                "Request served: {pieces} tokens in {secs:.1} s{}",
                if cancelled { " (cancelled)" } else { "" }
            );
        }
        other => {
            let why = match other {
                Ok(Err(e)) => e,
                Err(e) => e.to_string(),
                Ok(Ok(())) => unreachable!(),
            };
            error!("Request failed: {why}");
            fail(&shared, &id, "engine_error", "The engine failed to answer");
        }
    }
    lock(&shared.active).remove(&id);
    shared.finish_box(id);
    let _ = shared.done.send(());
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ready(kind: Kind) -> Status {
        Status {
            phase: Phase::Ready,
            model_id: "m1".into(),
            progress_bytes: 0,
            error: None,
            kind,
            embedding_dimension: if kind == Kind::Embedding { 768 } else { 0 },
        }
    }

    #[test]
    fn a_matching_model_is_taken() {
        assert_eq!(
            refusal(Kind::Chat, false, false, "m1", &ready(Kind::Chat)),
            None
        );
        assert_eq!(
            refusal(Kind::Embedding, false, false, "m1", &ready(Kind::Embedding)),
            None
        );
    }

    #[test]
    fn the_wrong_kind_of_request_is_rejected() {
        let code = |want, m: &Status| refusal(want, false, false, "m1", m).map(|r| r.0);
        assert_eq!(
            code(Kind::Embedding, &ready(Kind::Chat)),
            Some("wrong_model_kind")
        );
        assert_eq!(
            code(Kind::Chat, &ready(Kind::Embedding)),
            Some("wrong_model_kind")
        );
    }

    #[test]
    fn a_node_without_the_model_is_not_ready() {
        let none = Status::none();
        assert_eq!(
            refusal(Kind::Embedding, false, false, "m1", &none).map(|r| r.0),
            Some("model_not_ready")
        );
        assert_eq!(
            refusal(Kind::Chat, false, false, "other", &ready(Kind::Chat)).map(|r| r.0),
            Some("model_not_ready")
        );
        let mut loading = ready(Kind::Embedding);
        loading.phase = Phase::Loading;
        assert_eq!(
            refusal(Kind::Embedding, false, false, "m1", &loading).map(|r| r.0),
            Some("model_not_ready")
        );
    }

    #[test]
    fn restarting_comes_first_and_busy_only_stops_chat() {
        assert_eq!(
            refusal(Kind::Chat, true, true, "m1", &ready(Kind::Embedding)).map(|r| r.0),
            Some("restarting")
        );
        assert_eq!(
            refusal(Kind::Chat, false, true, "m1", &ready(Kind::Chat)).map(|r| r.0),
            Some("busy")
        );
    }

    #[test]
    fn the_kind_of_an_assignment_is_read_from_the_wire_string() {
        assert_eq!(Kind::parse("embedding"), Kind::Embedding);
        assert_eq!(Kind::parse("chat"), Kind::Chat);
        assert_eq!(Kind::parse(""), Kind::Chat);
        assert_eq!(Kind::parse("future"), Kind::Chat);
    }
}
