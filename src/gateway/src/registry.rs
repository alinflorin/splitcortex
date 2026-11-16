//! The live registry of connected nodes, keyed by node id and filtered by `(org, pool)`. It is per process: nodes hold
//! their socket here, so the OpenAI handler and the node sockets must live in the same process. Org and pool come from
//! the registered record (loaded after proof of key possession), never from messages on the stream.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, RwLock};

use rand::Rng;
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
}

#[derive(Default)]
pub struct Registry {
    nodes: RwLock<HashMap<Uuid, Arc<NodeConn>>>,
    requests: Mutex<HashMap<String, Pending>>,
    rr: AtomicUsize,
}

impl Registry {
    /// Registers a connection; a newer connection of the same node replaces (and closes) the older one.
    pub fn register(&self, conn: Arc<NodeConn>) {
        let old = self.nodes.write().unwrap().insert(conn.node_id, conn);
        if let Some(old) = old {
            let _ = old.tx.try_send(Outbound::Close);
            self.fail_requests(old.node_id);
        }
    }

    /// Removes the connection only if it is still the registered one (a replaced one must not evict its successor).
    pub fn unregister(&self, node_id: Uuid, conn_id: Uuid) -> bool {
        let mut nodes = self.nodes.write().unwrap();
        if nodes.get(&node_id).map(|c| c.conn_id) == Some(conn_id) {
            nodes.remove(&node_id);
            drop(nodes);
            self.fail_requests(node_id);
            true
        } else {
            false
        }
    }

    pub fn all(&self) -> Vec<Arc<NodeConn>> {
        self.nodes.read().unwrap().values().cloned().collect()
    }

    /// (eligible node count, in-flight sum) of a pool for `model`; used to choose between pools.
    pub fn pool_load(&self, org: Uuid, pool: Uuid, model: Uuid) -> (usize, u32) {
        let nodes = self.nodes.read().unwrap();
        let mut n = 0;
        let mut load = 0;
        for c in nodes.values().filter(|c| eligible(c, org, pool, model)) {
            n += 1;
            load += c.load();
        }
        (n, load)
    }

    /// Picks an eligible node and reserves one in-flight slot on it.
    pub fn pick(&self, org: Uuid, pool: Uuid, model: Uuid, balancing: &str, exclude: &[Uuid]) -> Option<Arc<NodeConn>> {
        let nodes = self.nodes.read().unwrap();
        let cands: Vec<&Arc<NodeConn>> = nodes
            .values()
            .filter(|c| eligible(c, org, pool, model) && !exclude.contains(&c.node_id))
            .collect();
        if cands.is_empty() {
            return None;
        }
        let mut rng = rand::thread_rng();
        let chosen = match balancing {
            "round_robin" => {
                let mut sorted = cands.clone();
                sorted.sort_by_key(|c| c.node_id);
                sorted[self.rr.fetch_add(1, Ordering::Relaxed) % sorted.len()]
            }
            "random" => cands[rng.gen_range(0..cands.len())],
            "least_in_flight" => *cands.iter().min_by_key(|c| c.load()).unwrap(),
            // weighted_p2c: two random choices, keep the one with the lower load per unit of speed.
            _ => {
                let a = cands[rng.gen_range(0..cands.len())];
                let b = cands[rng.gen_range(0..cands.len())];
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

    pub fn track_request(&self, request_id: &str, node_id: Uuid) -> mpsc::Receiver<NodeEvent> {
        let (tx, rx) = mpsc::channel(256);
        self.requests
            .lock()
            .unwrap()
            .insert(request_id.to_string(), Pending { node_id, tx });
        rx
    }

    pub fn finish_request(&self, request_id: &str) {
        self.requests.lock().unwrap().remove(request_id);
    }

    /// Routes a node's event to its request. Events for requests of another node are ignored (no spoofing).
    pub async fn deliver(&self, node_id: Uuid, request_id: &str, ev: NodeEvent) {
        let tx = {
            let reqs = self.requests.lock().unwrap();
            match reqs.get(request_id) {
                Some(p) if p.node_id == node_id => Some(p.tx.clone()),
                _ => None,
            }
        };
        if let Some(tx) = tx {
            let _ = tx.send(ev).await;
        }
    }

    fn fail_requests(&self, node_id: Uuid) {
        let mut reqs = self.requests.lock().unwrap();
        reqs.retain(|_, p| {
            if p.node_id == node_id {
                let _ = p.tx.try_send(NodeEvent::Disconnected);
                false
            } else {
                true
            }
        });
    }
}

fn eligible(c: &NodeConn, org: Uuid, pool: Uuid, model: Uuid) -> bool {
    c.org_id == org && c.pool_id == pool && c.load() < c.capacity && *c.ready_model.lock().unwrap() == Some(model)
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

        let got = reg.pick(org, pool, model, "weighted_p2c", &[]).expect("a node");
        assert_eq!(got.node_id, ready.node_id);
        // capacity 1: the slot is taken now
        assert!(reg.pick(org, pool, model, "weighted_p2c", &[]).is_none());
        got.in_flight.fetch_sub(1, Ordering::AcqRel);
        // an excluded node is never picked (retry on another node)
        assert!(reg
            .pick(org, pool, model, "least_in_flight", &[ready.node_id])
            .is_none());
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
        assert!(!reg.unregister(old.node_id, old.conn_id));
        assert_eq!(reg.all().len(), 1);
        assert!(reg.unregister(newer.node_id, newer.conn_id));
    }

    #[tokio::test]
    async fn events_of_another_node_are_ignored() {
        let reg = Registry::default();
        let (a, b) = (Uuid::new_v4(), Uuid::new_v4());
        let mut rx = reg.track_request("r1", a);
        reg.deliver(b, "r1", NodeEvent::Chunk("spoof".into())).await;
        reg.deliver(a, "r1", NodeEvent::Chunk("ok".into())).await;
        match rx.recv().await {
            Some(NodeEvent::Chunk(t)) => assert_eq!(t, "ok"),
            other => panic!("unexpected {other:?}"),
        }
    }
}
