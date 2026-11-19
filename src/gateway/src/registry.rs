//! The live registry of connected nodes, keyed by node id and filtered by `(org, pool)`. It is per process: nodes hold
//! their socket here, so the OpenAI handler and the node sockets must live in the same process. Org and pool come from
//! the registered record (loaded after proof of key possession), never from messages on the stream.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, RwLock};

use rand::RngExt;
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::proto::Envelope;

/// What the registry asks a node's writer task to do.
pub enum Outbound {
    Send(Envelope),
    Close,
}

/// Events a node sends back for one request.
#[derive(Debug)]
pub enum NodeEvent {
    Chunk(String),
    Done {
        finish_reason: String,
    },
    Error {
        code: String,
        message: String,
    },
    /// The node dropped before finishing.
    Disconnected,
}

/// Input modalities beyond text, as bits (what a node lists in `ModelState.modalities`).
pub const IMAGE: u32 = 1;
pub const AUDIO: u32 = 2;

/// The bits of the names a node reported; unknown names are ignored.
pub fn modalities_from(names: &[String]) -> u32 {
    names.iter().fold(0, |m, n| match n.as_str() {
        "image" => m | IMAGE,
        "audio" => m | AUDIO,
        _ => m,
    })
}

/// The names of the bits, in a fixed order (for `/v1/models` and the status table).
pub fn modality_names(mods: u32) -> Vec<&'static str> {
    let mut v = Vec::new();
    if mods & IMAGE != 0 {
        v.push("image");
    }
    if mods & AUDIO != 0 {
        v.push("audio");
    }
    v
}

pub struct NodeConn {
    pub conn_id: Uuid,
    pub node_id: Uuid,
    pub org_id: Uuid,
    pub pool_id: Uuid,
    pub tx: mpsc::Sender<Outbound>,
    pub in_flight: AtomicU32,
    pub capacity: u32,
    /// The model the node reports as ready (id), if any.
    pub ready_model: Mutex<Option<Uuid>>,
    /// The model id last sent in a `ModelAssignment` (empty when none).
    pub assigned: Mutex<Option<Uuid>>,
    /// Measured tokens/sec as f64 bits (0 = unknown).
    pub tps_bits: AtomicU64,
    /// Whether a `ModelAssignment` was sent on this connection yet (the first one is always sent, even when empty).
    pub assignment_sent: std::sync::atomic::AtomicBool,
    /// The engine's context window in tokens as reported by the node (0 = unknown).
    pub ctx_tokens: AtomicU32,
    /// What the ready model accepts besides text (`IMAGE` | `AUDIO` bits), as reported with `ModelState`.
    pub modalities: AtomicU32,
    /// The `NodeConfig` last sent on this connection (backend override, context override); None = not sent yet.
    pub config_sent: Mutex<Option<(String, u32, String, String)>>,
    /// The node reconnected while requests of its previous connection wait to be resumed: no new request is sent to it
    /// until it lists what it still holds (or a few seconds pass).
    pub resuming: std::sync::atomic::AtomicBool,
    /// When this connection was accepted.
    pub since: std::time::Instant,
}

impl NodeConn {
    pub fn tps(&self) -> f64 {
        f64::from_bits(self.tps_bits.load(Ordering::Relaxed))
    }
    pub fn assigned_sent(&self) -> bool {
        self.assignment_sent.load(Ordering::Relaxed)
    }
    pub fn mark_assigned_sent(&self) {
        self.assignment_sent.store(true, Ordering::Relaxed)
    }
    pub fn load(&self) -> u32 {
        self.in_flight.load(Ordering::Relaxed)
    }
}

struct Pending {
    node_id: Uuid,
    tx: mpsc::Sender<NodeEvent>,
    /// The connection whose in-flight counter holds this request (it moves to the new connection on resume).
    slot: Arc<NodeConn>,
    /// Highest node sequence number seen (0 = none); lower or equal numbers are duplicates.
    last_seq: u32,
    /// The node has delivered at least one event, so it is generating this request.
    started: bool,
    /// The node's connection dropped at this instant; the request waits for the node to resume it.
    detached: Option<std::time::Instant>,
    /// The request ended with `Disconnected`; nothing more is delivered.
    dead: bool,
}

#[derive(Default)]
pub struct Registry {
    nodes: RwLock<HashMap<Uuid, Arc<NodeConn>>>,
    requests: Mutex<HashMap<String, Pending>>,
    rr: AtomicUsize,
}

impl Registry {
    /// Registers a connection; a newer connection of the same node replaces (and closes) the older one. Requests that
    /// were already streaming stay open for the node to resume; returns how many (the caller schedules their expiry).
    pub fn register(&self, conn: Arc<NodeConn>) -> usize {
        let node_id = conn.node_id;
        let old = self.nodes.write().unwrap().insert(conn.node_id, conn);
        if let Some(old) = old {
            let _ = old.tx.try_send(Outbound::Close);
            self.detach_requests(old.node_id);
        }
        self.waiting(node_id)
    }

    /// Requests of `node_id` that wait for the node to resume them.
    pub fn waiting(&self, node_id: Uuid) -> usize {
        self.requests
            .lock()
            .unwrap()
            .values()
            .filter(|p| p.node_id == node_id && p.detached.is_some() && !p.dead)
            .count()
    }

    /// Removes the connection only if it is still the registered one (a replaced one must not evict its successor).
    /// The second value is the number of requests left waiting for the node to resume them.
    pub fn unregister(&self, node_id: Uuid, conn_id: Uuid) -> (bool, usize) {
        let mut nodes = self.nodes.write().unwrap();
        if nodes.get(&node_id).map(|c| c.conn_id) == Some(conn_id) {
            nodes.remove(&node_id);
            drop(nodes);
            (true, self.detach_requests(node_id))
        } else {
            (false, 0)
        }
    }

    pub fn get(&self, node_id: Uuid) -> Option<Arc<NodeConn>> {
        self.nodes.read().unwrap().get(&node_id).cloned()
    }

    /// Takes the in-flight slot of one specific node if it has a free one.
    pub fn reserve(&self, node: &Arc<NodeConn>) -> bool {
        let prev = node.in_flight.fetch_add(1, Ordering::AcqRel);
        if prev >= node.capacity || node.resuming.load(Ordering::Relaxed) {
            node.in_flight.fetch_sub(1, Ordering::AcqRel);
            return false;
        }
        true
    }

    /// Requests that are still running (including ones that wait for their node to resume them).
    pub fn active_requests(&self) -> usize {
        self.requests.lock().unwrap().len()
    }

    pub fn all(&self) -> Vec<Arc<NodeConn>> {
        self.nodes.read().unwrap().values().cloned().collect()
    }

    /// (eligible node count, in-flight sum) of a pool for `model`; used to choose between pools.
    pub fn pool_load(&self, org: Uuid, pool: Uuid, model: Uuid, need: u32, mods: u32) -> (usize, u32) {
        let nodes = self.nodes.read().unwrap();
        let mut n = 0;
        let mut load = 0;
        for c in nodes.values().filter(|c| eligible(c, org, pool, model, need, mods)) {
            n += 1;
            load += c.load();
        }
        (n, load)
    }

    /// (smallest, largest) known context window among the nodes that have `model` ready, busy or not; None when no
    /// ready node reports one. A node that reports nothing is not counted.
    pub fn context_range(&self, org: Uuid, pool: Uuid, model: Uuid) -> Option<(u32, u32)> {
        let nodes = self.nodes.read().unwrap();
        let mut range: Option<(u32, u32)> = None;
        for c in nodes.values() {
            let ctx = c.ctx_tokens.load(Ordering::Relaxed);
            if c.org_id != org || c.pool_id != pool || ctx == 0 || *c.ready_model.lock().unwrap() != Some(model) {
                continue;
            }
            range = Some(range.map_or((ctx, ctx), |(lo, hi)| (lo.min(ctx), hi.max(ctx))));
        }
        range
    }

    /// Whether any node of the pool has `model` ready (busy or not).
    pub fn has_ready(&self, org: Uuid, pool: Uuid, model: Uuid) -> bool {
        let nodes = self.nodes.read().unwrap();
        nodes
            .values()
            .any(|c| c.org_id == org && c.pool_id == pool && *c.ready_model.lock().unwrap() == Some(model))
    }

    /// The modalities (bits) the nodes that have `model` ready accept together, busy or not.
    pub fn modalities_of(&self, org: Uuid, pool: Uuid, model: Uuid) -> u32 {
        let nodes = self.nodes.read().unwrap();
        nodes
            .values()
            .filter(|c| c.org_id == org && c.pool_id == pool && *c.ready_model.lock().unwrap() == Some(model))
            .fold(0, |m, c| m | c.modalities.load(Ordering::Relaxed))
    }

    /// Picks an eligible node and reserves one in-flight slot on it.
    #[allow(clippy::too_many_arguments)]
    pub fn pick(
        &self,
        org: Uuid,
        pool: Uuid,
        model: Uuid,
        need: u32,
        mods: u32,
        balancing: &str,
        exclude: &[Uuid],
    ) -> Option<Arc<NodeConn>> {
        let nodes = self.nodes.read().unwrap();
        let cands: Vec<&Arc<NodeConn>> = nodes
            .values()
            .filter(|c| eligible(c, org, pool, model, need, mods) && !exclude.contains(&c.node_id))
            .collect();
        if cands.is_empty() {
            return None;
        }
        let mut rng = rand::rng();
        let chosen = match balancing {
            "round_robin" => {
                let mut sorted = cands.clone();
                sorted.sort_by_key(|c| c.node_id);
                sorted[self.rr.fetch_add(1, Ordering::Relaxed) % sorted.len()]
            }
            "random" => cands[rng.random_range(0..cands.len())],
            "least_in_flight" => *cands.iter().min_by_key(|c| c.load()).unwrap(),
            // weighted_p2c: two random choices, keep the one with the lower load per unit of speed.
            _ => {
                let a = cands[rng.random_range(0..cands.len())];
                let b = cands[rng.random_range(0..cands.len())];
                if score(a) <= score(b) {
                    a
                } else {
                    b
                }
            }
        };
        // Reserve a slot; another request may have taken the last one meanwhile.
        let prev = chosen.in_flight.fetch_add(1, Ordering::AcqRel);
        if prev >= chosen.capacity {
            chosen.in_flight.fetch_sub(1, Ordering::AcqRel);
            return None;
        }
        Some(chosen.clone())
    }

    /// Tracks a request on `node` (whose in-flight slot the caller already reserved).
    pub fn track_request(&self, request_id: &str, node: &Arc<NodeConn>) -> mpsc::Receiver<NodeEvent> {
        let (tx, rx) = mpsc::channel(256);
        self.requests.lock().unwrap().insert(
            request_id.to_string(),
            Pending {
                node_id: node.node_id,
                tx,
                slot: node.clone(),
                last_seq: 0,
                started: false,
                detached: None,
                dead: false,
            },
        );
        rx
    }

    /// Ends a request and frees its in-flight slot (on the connection that holds it now, which is not the original
    /// one after a resume). `fallback` is used when the request is already gone.
    pub fn finish_request(&self, request_id: &str, fallback: &NodeConn) {
        let slot = self.requests.lock().unwrap().remove(request_id).map(|p| p.slot);
        let conn: &NodeConn = slot.as_deref().unwrap_or(fallback);
        let _ = conn
            .in_flight
            .try_update(Ordering::AcqRel, Ordering::Acquire, |v| Some(v.saturating_sub(1)));
    }

    /// Routes a node's event to its request. Events for requests of another node are ignored (no spoofing). `seq` is the
    /// node's per-request sequence number (0 from nodes that do not number them); repeats are dropped.
    pub async fn deliver(&self, node_id: Uuid, request_id: &str, seq: u32, ev: NodeEvent) {
        let tx = {
            let mut reqs = self.requests.lock().unwrap();
            match reqs.get_mut(request_id) {
                Some(p) if p.node_id == node_id && !p.dead => {
                    if seq != 0 {
                        if seq <= p.last_seq {
                            return;
                        }
                        p.last_seq = seq;
                    }
                    p.started = true;
                    Some(p.tx.clone())
                }
                _ => None,
            }
        };
        if let Some(tx) = tx {
            let _ = tx.send(ev).await;
        }
    }

    /// The node's connection is gone. Requests that are streaming wait for the node to resume them; the others fail at
    /// once (they are retried elsewhere). Returns the number waiting.
    fn detach_requests(&self, node_id: Uuid) -> usize {
        let mut waiting = 0;
        for p in self.requests.lock().unwrap().values_mut() {
            if p.node_id != node_id || p.dead {
                continue;
            }
            if p.started {
                p.detached.get_or_insert_with(std::time::Instant::now);
                waiting += 1;
            } else {
                p.dead = true;
                let _ = p.tx.try_send(NodeEvent::Disconnected);
            }
        }
        waiting
    }

    /// Fails the requests of `node_id` that have waited for a resume for at least `grace`.
    pub fn expire_detached(&self, node_id: Uuid, grace: std::time::Duration) {
        for p in self.requests.lock().unwrap().values_mut() {
            if p.node_id == node_id && !p.dead && p.detached.is_some_and(|t| t.elapsed() >= grace) {
                p.dead = true;
                let _ = p.tx.try_send(NodeEvent::Disconnected);
            }
        }
    }

    /// The node reconnected and lists the requests it still holds. Detached requests it lists continue on `conn`
    /// (returns their ids with the last sequence number received); detached requests it does not list are lost; listed
    /// ids the gateway does not know are returned as the second value (the node is told to drop them).
    pub fn resume(&self, conn: &Arc<NodeConn>, ids: &[String]) -> (Vec<(String, u32)>, Vec<String>) {
        let mut reqs = self.requests.lock().unwrap();
        let mut resumed = Vec::new();
        for (id, p) in reqs.iter_mut() {
            if p.node_id != conn.node_id || p.dead {
                continue;
            }
            if p.detached.is_some() && ids.contains(id) {
                if !Arc::ptr_eq(&p.slot, conn) {
                    let _ = p
                        .slot
                        .in_flight
                        .try_update(Ordering::AcqRel, Ordering::Acquire, |v| Some(v.saturating_sub(1)));
                    conn.in_flight.fetch_add(1, Ordering::AcqRel);
                    p.slot = conn.clone();
                }
                p.detached = None;
                resumed.push((id.clone(), p.last_seq));
            } else if p.detached.is_some() {
                p.dead = true;
                let _ = p.tx.try_send(NodeEvent::Disconnected);
            }
        }
        let unknown = ids
            .iter()
            .filter(|id| !reqs.get(*id).is_some_and(|p| p.node_id == conn.node_id && !p.dead))
            .cloned()
            .collect();
        (resumed, unknown)
    }
}

/// Whether `ctx` tokens of context fit the node (an unknown window, 0, is assumed to fit).
fn fits(c: &NodeConn, need: u32) -> bool {
    let ctx = c.ctx_tokens.load(Ordering::Relaxed);
    ctx == 0 || ctx >= need
}

fn eligible(c: &NodeConn, org: Uuid, pool: Uuid, model: Uuid, need: u32, mods: u32) -> bool {
    c.org_id == org
        && c.pool_id == pool
        && c.load() < c.capacity
        && !c.resuming.load(Ordering::Relaxed)
        && *c.ready_model.lock().unwrap() == Some(model)
        && fits(c, need)
        && c.modalities.load(Ordering::Relaxed) & mods == mods
}

fn score(c: &NodeConn) -> f64 {
    let speed = if c.tps() > 0.0 { c.tps() } else { 1.0 };
    (c.load() as f64 + 1.0) / speed
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn(org: Uuid, pool: Uuid, model: Option<Uuid>) -> Arc<NodeConn> {
        let (tx, _rx) = mpsc::channel(8);
        Arc::new(NodeConn {
            conn_id: Uuid::new_v4(),
            node_id: Uuid::new_v4(),
            org_id: org,
            pool_id: pool,
            tx,
            in_flight: Default::default(),
            capacity: 1,
            ready_model: Mutex::new(model),
            assigned: Mutex::new(model),
            tps_bits: Default::default(),
            assignment_sent: Default::default(),
            ctx_tokens: Default::default(),
            modalities: Default::default(),
            config_sent: Default::default(),
            resuming: Default::default(),
            since: std::time::Instant::now(),
        })
    }

    #[test]
    fn picks_only_ready_nodes_of_the_same_org_and_pool_within_capacity() {
        let (org, pool, model) = (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4());
        let reg = Registry::default();
        let ready = conn(org, pool, Some(model));
        reg.register(ready.clone());
        reg.register(conn(org, pool, None)); // no model ready
        reg.register(conn(Uuid::new_v4(), pool, Some(model))); // another org (tenant isolation)
        reg.register(conn(org, Uuid::new_v4(), Some(model))); // another pool

        let got = reg.pick(org, pool, model, 0, 0, "weighted_p2c", &[]).expect("a node");
        assert_eq!(got.node_id, ready.node_id);
        // capacity 1: the slot is taken now
        assert!(reg.pick(org, pool, model, 0, 0, "weighted_p2c", &[]).is_none());
        got.in_flight.fetch_sub(1, Ordering::AcqRel);
        // an excluded node is never picked (retry on another node)
        assert!(reg
            .pick(org, pool, model, 0, 0, "least_in_flight", &[ready.node_id])
            .is_none());
    }

    #[test]
    fn skips_nodes_whose_context_is_too_small() {
        let (org, pool, model) = (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4());
        let reg = Registry::default();
        let small = conn(org, pool, Some(model));
        small.ctx_tokens.store(2048, Ordering::Relaxed);
        reg.register(small.clone());
        assert_eq!(reg.context_range(org, pool, model), Some((2048, 2048)));
        assert!(reg.pick(org, pool, model, 4000, 0, "weighted_p2c", &[]).is_none());
        assert_eq!(reg.pool_load(org, pool, model, 4000, 0).0, 0);
        let big = conn(org, pool, Some(model));
        big.ctx_tokens.store(8192, Ordering::Relaxed);
        reg.register(big.clone());
        assert_eq!(reg.context_range(org, pool, model), Some((2048, 8192)));
        let got = reg
            .pick(org, pool, model, 4000, 0, "random", &[])
            .expect("the big node");
        assert_eq!(got.node_id, big.node_id);
        // a node that has not reported a window is assumed to fit
        let unknown = conn(org, pool, Some(model));
        assert_eq!(reg.context_range(Uuid::new_v4(), pool, model), None);
        reg.register(unknown.clone());
        assert!(reg.pool_load(org, pool, model, 1_000_000, 0).0 >= 1);
    }

    #[test]
    fn media_only_goes_to_nodes_that_accept_it() {
        let (org, pool, model) = (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4());
        let reg = Registry::default();
        let text = conn(org, pool, Some(model));
        reg.register(text.clone());
        assert_eq!(reg.modalities_of(org, pool, model), 0);
        assert!(reg.pick(org, pool, model, 0, IMAGE, "random", &[]).is_none());
        assert_eq!(reg.pool_load(org, pool, model, 0, IMAGE).0, 0);
        let vision = conn(org, pool, Some(model));
        vision
            .modalities
            .store(modalities_from(&["image".into(), "bogus".into()]), Ordering::Relaxed);
        reg.register(vision.clone());
        assert_eq!(modality_names(reg.modalities_of(org, pool, model)), vec!["image"]);
        let got = reg
            .pick(org, pool, model, 0, IMAGE, "random", &[])
            .expect("the vision node");
        assert_eq!(got.node_id, vision.node_id);
        got.in_flight.fetch_sub(1, Ordering::AcqRel);
        // audio as well: this node has none
        assert!(reg.pick(org, pool, model, 0, IMAGE | AUDIO, "random", &[]).is_none());
        // text requests still go anywhere
        assert!(reg.pick(org, pool, model, 0, 0, "random", &[]).is_some());
    }

    #[test]
    fn a_replaced_connection_does_not_evict_its_successor() {
        let (org, pool) = (Uuid::new_v4(), Uuid::new_v4());
        let reg = Registry::default();
        let old = conn(org, pool, None);
        reg.register(old.clone());
        let mut newer = conn(org, pool, None);
        Arc::get_mut(&mut newer).unwrap().node_id = old.node_id;
        reg.register(newer.clone());
        assert!(!reg.unregister(old.node_id, old.conn_id).0);
        assert_eq!(reg.all().len(), 1);
        assert!(reg.unregister(newer.node_id, newer.conn_id).0);
    }

    #[tokio::test]
    async fn events_of_another_node_are_ignored() {
        let reg = Registry::default();
        let (a, b) = (Uuid::new_v4(), Uuid::new_v4());
        let mut node = conn(Uuid::new_v4(), Uuid::new_v4(), None);
        Arc::get_mut(&mut node).unwrap().node_id = a;
        let mut rx = reg.track_request("r1", &node);
        reg.deliver(b, "r1", 1, NodeEvent::Chunk("spoof".into())).await;
        reg.deliver(a, "r1", 1, NodeEvent::Chunk("ok".into())).await;
        match rx.recv().await {
            Some(NodeEvent::Chunk(t)) => assert_eq!(t, "ok"),
            other => panic!("unexpected {other:?}"),
        }
    }

    fn reserve(reg: &Registry, c: &Arc<NodeConn>, id: &str) -> mpsc::Receiver<NodeEvent> {
        c.in_flight.fetch_add(1, Ordering::AcqRel);
        reg.track_request(id, c)
    }

    #[tokio::test]
    async fn duplicate_sequence_numbers_are_dropped() {
        let reg = Registry::default();
        let c = conn(Uuid::new_v4(), Uuid::new_v4(), None);
        let mut rx = reserve(&reg, &c, "r");
        for (seq, t) in [(1, "a"), (2, "b"), (2, "b"), (1, "a"), (3, "c")] {
            reg.deliver(c.node_id, "r", seq, NodeEvent::Chunk(t.into())).await;
        }
        let mut got = String::new();
        while let Ok(NodeEvent::Chunk(t)) = rx.try_recv() {
            got.push_str(&t);
        }
        assert_eq!(got, "abc");
    }

    #[tokio::test]
    async fn a_streaming_request_survives_a_reconnect_and_moves_its_slot() {
        let reg = Registry::default();
        let (org, pool) = (Uuid::new_v4(), Uuid::new_v4());
        let old = conn(org, pool, None);
        reg.register(old.clone());
        let mut rx = reserve(&reg, &old, "r");
        reg.deliver(old.node_id, "r", 1, NodeEvent::Chunk("a".into())).await;

        // the socket drops: the request waits instead of failing
        assert_eq!(reg.unregister(old.node_id, old.conn_id), (true, 1));
        assert!(matches!(rx.recv().await, Some(NodeEvent::Chunk(_))));
        assert!(rx.try_recv().is_err());

        // the node comes back (a new connection of the same node) and resumes it
        let mut newer = conn(org, pool, None);
        Arc::get_mut(&mut newer).unwrap().node_id = old.node_id;
        reg.register(newer.clone());
        let (resumed, unknown) = reg.resume(&newer, &["r".to_string(), "ghost".to_string()]);
        assert_eq!(resumed, vec![("r".to_string(), 1)]);
        assert_eq!(unknown, vec!["ghost".to_string()]);
        assert_eq!(old.load(), 0);
        assert_eq!(newer.load(), 1);
        // resent chunk 1 is a duplicate, chunk 2 is new
        reg.deliver(newer.node_id, "r", 1, NodeEvent::Chunk("a".into())).await;
        reg.deliver(newer.node_id, "r", 2, NodeEvent::Chunk("b".into())).await;
        assert!(matches!(rx.recv().await, Some(NodeEvent::Chunk(t)) if t == "b"));
        // finishing frees the slot of the connection that holds it now
        reg.finish_request("r", &old);
        assert_eq!(newer.load(), 0);
    }

    #[tokio::test]
    async fn unresumed_and_unstarted_requests_fail() {
        let reg = Registry::default();
        let (org, pool) = (Uuid::new_v4(), Uuid::new_v4());
        let c = conn(org, pool, None);
        reg.register(c.clone());
        let mut started = reserve(&reg, &c, "s");
        let mut fresh = reserve(&reg, &c, "f");
        reg.deliver(c.node_id, "s", 1, NodeEvent::Chunk("x".into())).await;
        let _ = started.recv().await;
        reg.unregister(c.node_id, c.conn_id);
        // never started: fails at once so the gateway retries elsewhere
        assert!(matches!(fresh.recv().await, Some(NodeEvent::Disconnected)));
        // started: waits, then expires
        assert!(started.try_recv().is_err());
        reg.expire_detached(c.node_id, std::time::Duration::from_secs(0));
        assert!(matches!(started.recv().await, Some(NodeEvent::Disconnected)));
        // a node that resumes without listing the request loses it
        let c2 = conn(org, pool, None);
        reg.register(c2.clone());
        let mut lost = reserve(&reg, &c2, "l");
        reg.deliver(c2.node_id, "l", 1, NodeEvent::Chunk("x".into())).await;
        let _ = lost.recv().await;
        reg.unregister(c2.node_id, c2.conn_id);
        let mut c3 = conn(org, pool, None);
        Arc::get_mut(&mut c3).unwrap().node_id = c2.node_id;
        reg.register(c3.clone());
        let (resumed, _) = reg.resume(&c3, &[]);
        assert!(resumed.is_empty());
        assert!(matches!(lost.recv().await, Some(NodeEvent::Disconnected)));
    }
}
