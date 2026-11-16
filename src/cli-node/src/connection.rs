//! The node's outbound, persistent connection to the gateway: wss + protobuf, mutual proof of possession (see
//! `src/gateway/proto/.../node.proto`), reconnect with backoff, idle watchdog. It never accepts inbound connections.

use crate::handshake::{
    gateway_key_id, sign_node_hello, verify_gateway_hello, verify_next_gateway_key,
};
use crate::proto::{self, envelope::Body};
use ed25519_dalek::SigningKey;
use futures_util::{SinkExt, StreamExt};
use prost::Message as _;
use rand::RngCore;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::{Notify, mpsc};
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::Message;
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

pub const PROTOCOL_VERSION: u32 = 1;
const IDLE_LIMIT: Duration = Duration::from_secs(60);
const STEP_LIMIT: Duration = Duration::from_secs(20);
const BACKOFF_MAX_MS: f64 = 30_000.0;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ConnState {
    Idle,
    Connecting,
    Reconnecting,
    Connected,
}

impl ConnState {
    pub fn as_str(self) -> &'static str {
        match self {
            ConnState::Idle => "idle",
            ConnState::Connecting => "connecting",
            ConnState::Reconnecting => "reconnecting",
            ConnState::Connected => "connected",
        }
    }
}

/// The gateway keys this device trusts: the pinned one and the ones announced for a rotation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TrustedKeys {
    pub current: Vec<u8>,
    pub next: Vec<Vec<u8>>,
}

#[derive(Debug)]
pub enum Event {
    State(ConnState),
    Body(Body),
    /// The trusted keys changed (a rotation): persist them so a restart keeps trusting them.
    Keys(TrustedKeys),
}

pub struct Options {
    pub url: String,
    pub node_id: String,
    pub key: SigningKey,
    /// The gateway key pinned at enrollment. The gateway must prove it before the node reveals anything.
    pub keys: TrustedKeys,
    pub app_version: String,
}

type Out = Arc<Mutex<Option<mpsc::UnboundedSender<Vec<u8>>>>>;

pub struct Connection {
    out: Out,
    wake: Arc<Notify>,
    stop: CancellationToken,
    task: Mutex<Option<JoinHandle<()>>>,
}

struct Failure {
    reason: String,
    /// Not the gateway this device pinned: back off hard, it will not fix itself quickly.
    hard: bool,
}
impl Failure {
    fn new(reason: impl Into<String>) -> Self {
        Failure {
            reason: reason.into(),
            hard: false,
        }
    }
}

fn encode(body: Body) -> Vec<u8> {
    proto::Envelope { body: Some(body) }.encode_to_vec()
}

impl Connection {
    pub fn start(o: Options, events: mpsc::UnboundedSender<Event>) -> Connection {
        let out: Out = Arc::default();
        let wake = Arc::new(Notify::new());
        let stop = CancellationToken::new();
        let task = tokio::spawn(run(o, events, out.clone(), wake.clone(), stop.clone()));
        Connection {
            out,
            wake,
            stop,
            task: Mutex::new(Some(task)),
        }
    }

    /// Queues a message; false while the connection is not open (the caller keeps what it must resend).
    pub fn send(&self, body: Body) -> bool {
        match &*self.out.lock().unwrap_or_else(|e| e.into_inner()) {
            Some(tx) => tx.send(encode(body)).is_ok(),
            None => false,
        }
    }

    /// Reconnect now instead of waiting for the backoff.
    #[allow(dead_code)]
    pub fn reconnect_now(&self) {
        self.wake.notify_one();
    }

    pub async fn stop(&self) {
        self.stop.cancel();
        let task = self.task.lock().unwrap_or_else(|e| e.into_inner()).take();
        if let Some(t) = task {
            let _ = t.await;
        }
    }
}

async fn run(
    o: Options,
    events: mpsc::UnboundedSender<Event>,
    out: Out,
    wake: Arc<Notify>,
    stop: CancellationToken,
) {
    let mut keys = o.keys.clone();
    let mut attempt: u32 = 0;
    loop {
        let _ = events.send(Event::State(if attempt == 0 {
            ConnState::Connecting
        } else {
            ConnState::Reconnecting
        }));
        let result = tokio::select! {
            _ = stop.cancelled() => break,
            r = session(&o, &mut keys, &events, &out, &mut attempt) => r,
        };
        *out.lock().unwrap_or_else(|e| e.into_inner()) = None;
        match result {
            Err(f) => {
                warn!("{}", f.reason);
                if f.hard {
                    attempt = attempt.max(5);
                }
            }
            Ok(()) => info!("Disconnected"),
        }
        let _ = events.send(Event::State(ConnState::Reconnecting));
        let jitter = 0.7 + (rand::random::<u32>() as f64 / u32::MAX as f64) * 0.6;
        let delay = (1000.0 * 2f64.powi(attempt.min(10) as i32)).min(BACKOFF_MAX_MS) * jitter;
        attempt += 1;
        info!("Retrying in {} s", (delay / 1000.0).round());
        tokio::select! {
            _ = stop.cancelled() => break,
            _ = wake.notified() => attempt = 0,
            _ = tokio::time::sleep(Duration::from_millis(delay as u64)) => {}
        }
    }
    let _ = events.send(Event::State(ConnState::Idle));
}

async fn recv<S>(stream: &mut S, what: &str) -> Result<Body, Failure>
where
    S: futures_util::Stream<Item = Result<Message, tokio_tungstenite::tungstenite::Error>> + Unpin,
{
    loop {
        let next = tokio::time::timeout(STEP_LIMIT, stream.next())
            .await
            .map_err(|_| Failure::new(format!("The gateway did not answer ({what})")))?;
        match next {
            Some(Ok(Message::Binary(b))) => {
                let env = proto::Envelope::decode(&b[..])
                    .map_err(|_| Failure::new("The gateway sent an invalid frame"))?;
                return env
                    .body
                    .ok_or_else(|| Failure::new("The gateway sent an empty frame"));
            }
            Some(Ok(Message::Close(_))) | None => {
                return Err(Failure::new(format!(
                    "The gateway closed the connection ({what})"
                )));
            }
            Some(Ok(_)) => continue, // ws-level ping/pong are answered by the library
            Some(Err(e)) => return Err(Failure::new(format!("Connection error ({what}): {e}"))),
        }
    }
}

async fn session(
    o: &Options,
    keys: &mut TrustedKeys,
    events: &mpsc::UnboundedSender<Event>,
    out: &Out,
    attempt: &mut u32,
) -> Result<(), Failure> {
    let (ws, _) =
        tokio::time::timeout(STEP_LIMIT, tokio_tungstenite::connect_async(o.url.as_str()))
            .await
            .map_err(|_| Failure::new("Connecting to the gateway timed out"))?
            .map_err(|e| Failure::new(format!("Cannot connect to the gateway: {e}")))?;
    let (mut sink, mut stream) = ws.split();
    let send_raw = |body: Body| Message::Binary(encode(body).into());

    let mut nonce = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut nonce);
    sink.send(send_raw(Body::ClientHello(proto::ClientHello {
        protocol_version: PROTOCOL_VERSION,
        node_id: o.node_id.clone(),
        nonce: nonce.to_vec(),
        app_version: o.app_version.clone(),
    })))
    .await
    .map_err(|e| Failure::new(format!("Connection error: {e}")))?;

    let Body::ServerHello(hello) = recv(&mut stream, "hello").await? else {
        return Err(Failure::new("Unexpected handshake message"));
    };
    let trusted: Vec<&Vec<u8>> = std::iter::once(&keys.current)
        .chain(keys.next.iter())
        .collect();
    let Some(verified) = trusted
        .into_iter()
        .find(|k| verify_gateway_hello(k, &nonce, &o.node_id, &hello.signature))
        .cloned()
    else {
        // Not the gateway this device pinned at enrollment: never authenticate to it.
        return Err(Failure {
            reason: "The server does not match the key pinned at enrollment; refusing to connect"
                .into(),
            hard: true,
        });
    };
    sink.send(send_raw(Body::ClientAuth(proto::ClientAuth {
        signature: sign_node_hello(&o.key, &hello.nonce, &nonce, &o.node_id),
    })))
    .await
    .map_err(|e| Failure::new(format!("Connection error: {e}")))?;

    let Body::Ready(ready) = recv(&mut stream, "auth").await? else {
        return Err(Failure::new("The gateway did not accept this device"));
    };
    *attempt = 0;
    accept_keys(keys, &verified, &nonce, &ready, events);

    let (tx, mut rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let _ = tx.send(encode(Body::GatewayKeys(proto::GatewayKeys {
        key_ids: std::iter::once(&keys.current)
            .chain(keys.next.iter())
            .map(|k| gateway_key_id(k))
            .collect(),
    })));
    *out.lock().unwrap_or_else(|e| e.into_inner()) = Some(tx.clone());
    let _ = events.send(Event::State(ConnState::Connected));
    let _ = events.send(Event::Body(Body::Ready(ready)));

    loop {
        tokio::select! {
            frame = rx.recv() => {
                let Some(bytes) = frame else { return Ok(()) };
                sink.send(Message::Binary(bytes.into()))
                    .await
                    .map_err(|e| Failure::new(format!("Connection error: {e}")))?;
            }
            next = tokio::time::timeout(IDLE_LIMIT, stream.next()) => {
                let next = next.map_err(|_| Failure::new("The gateway went silent"))?;
                match next {
                    Some(Ok(Message::Binary(b))) => {
                        let env = proto::Envelope::decode(&b[..])
                            .map_err(|_| Failure::new("The gateway sent an invalid frame"))?;
                        match env.body {
                            Some(Body::Ping(p)) => {
                                let _ = tx.send(encode(Body::Pong(proto::Pong { timestamp_ms: p.timestamp_ms })));
                            }
                            Some(body) => {
                                let _ = events.send(Event::Body(body));
                            }
                            None => {}
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => return Ok(()),
                    Some(Ok(_)) => {}
                    Some(Err(e)) => return Err(Failure::new(format!("Connection error: {e}"))),
                }
            }
        }
    }
}

/// Key rotation: switch to the key the gateway just proved, and learn the next one it announces.
fn accept_keys(
    keys: &mut TrustedKeys,
    proven: &[u8],
    node_nonce: &[u8],
    ready: &proto::Ready,
    events: &mpsc::UnboundedSender<Event>,
) {
    let mut changed = false;
    if proven != keys.current.as_slice() {
        // The gateway now signs with what it announced earlier: that is the current key from here on, the old one is
        // retired.
        keys.current = proven.to_vec();
        keys.next.clear();
        changed = true;
    }
    let announced = &ready.next_gateway_key;
    if announced.len() == 32
        && announced != &keys.current
        && !keys.next.contains(announced)
        && verify_next_gateway_key(
            proven,
            node_nonce,
            announced,
            &ready.next_gateway_key_signature,
        )
    {
        keys.next = vec![announced.clone()];
        changed = true;
    }
    if changed {
        info!("Gateway key rotation: trusted keys updated");
        let _ = events.send(Event::Keys(keys.clone()));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::handshake::{GATEWAY_HELLO, NODE_HELLO, signed_message};
    use ed25519_dalek::{Signature, Signer, Verifier};
    use tokio::net::TcpListener;

    async fn next_body<S>(ws: &mut S) -> Body
    where
        S: futures_util::Stream<Item = Result<Message, tokio_tungstenite::tungstenite::Error>>
            + Unpin,
    {
        loop {
            if let Some(Ok(Message::Binary(b))) = ws.next().await {
                return proto::Envelope::decode(&b[..]).unwrap().body.unwrap();
            }
        }
    }

    /// A gateway for one connection: the handshake as src/gateway/src/node_ws.rs does it, then a ping.
    async fn gateway(listener: TcpListener, gw_key: SigningKey, device_pub: [u8; 32]) -> bool {
        let (tcp, _) = listener.accept().await.unwrap();
        let ws = tokio_tungstenite::accept_async(tcp).await.unwrap();
        let (mut sink, mut stream) = ws.split();
        let Body::ClientHello(hello) = next_body(&mut stream).await else {
            panic!("expected a hello")
        };
        let server_nonce = [7u8; 32];
        let sig = gw_key
            .sign(&signed_message(
                GATEWAY_HELLO,
                &[&hello.nonce, hello.node_id.as_bytes()],
            ))
            .to_bytes()
            .to_vec();
        sink.send(Message::Binary(
            encode(Body::ServerHello(proto::ServerHello {
                nonce: server_nonce.to_vec(),
                signature: sig,
            }))
            .into(),
        ))
        .await
        .unwrap();
        // A node that does not trust this key closes without authenticating.
        let Ok(Some(Ok(Message::Binary(b)))) =
            tokio::time::timeout(Duration::from_secs(5), stream.next()).await
        else {
            return false;
        };
        let Some(Body::ClientAuth(auth)) = proto::Envelope::decode(&b[..]).unwrap().body else {
            return false;
        };
        let msg = signed_message(
            NODE_HELLO,
            &[&server_nonce, &hello.nonce, hello.node_id.as_bytes()],
        );
        VerifyingKeyExt::check(&device_pub, &msg, &auth.signature);
        sink.send(Message::Binary(
            encode(Body::Ready(proto::Ready {
                max_in_flight: 1,
                ping_interval_seconds: 15,
                ..Default::default()
            }))
            .into(),
        ))
        .await
        .unwrap();
        let Body::GatewayKeys(k) = next_body(&mut stream).await else {
            panic!("expected the key ids")
        };
        assert_eq!(
            k.key_ids,
            vec![gateway_key_id(gw_key.verifying_key().as_bytes())]
        );
        sink.send(Message::Binary(
            encode(Body::Ping(proto::Ping { timestamp_ms: 42 })).into(),
        ))
        .await
        .unwrap();
        let Body::Pong(p) = next_body(&mut stream).await else {
            panic!("expected a pong")
        };
        assert_eq!(p.timestamp_ms, 42);
        true
    }

    struct VerifyingKeyExt;
    impl VerifyingKeyExt {
        fn check(public: &[u8; 32], msg: &[u8], sig: &[u8]) {
            let key = ed25519_dalek::VerifyingKey::from_bytes(public).unwrap();
            key.verify(msg, &Signature::from_slice(sig).unwrap())
                .expect("the node proves possession of its device key");
        }
    }

    fn options(url: String, pinned: &SigningKey, device: &SigningKey) -> Options {
        Options {
            url,
            node_id: "node-1".into(),
            key: device.clone(),
            keys: TrustedKeys {
                current: pinned.verifying_key().as_bytes().to_vec(),
                next: vec![],
            },
            app_version: "test".into(),
        }
    }

    #[tokio::test]
    async fn connects_to_the_pinned_gateway_and_answers_pings() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("ws://{}", listener.local_addr().unwrap());
        let (gw, device) = (
            SigningKey::from_bytes(&[1; 32]),
            SigningKey::from_bytes(&[2; 32]),
        );
        let server = tokio::spawn(gateway(
            listener,
            gw.clone(),
            device.verifying_key().to_bytes(),
        ));
        let (tx, mut rx) = mpsc::unbounded_channel();
        let conn = Connection::start(options(url, &gw, &device), tx);
        let mut connected = false;
        while let Some(ev) = rx.recv().await {
            if matches!(ev, Event::State(ConnState::Connected)) {
                connected = true;
                break;
            }
        }
        assert!(connected);
        assert!(
            tokio::time::timeout(Duration::from_secs(5), server)
                .await
                .unwrap()
                .unwrap()
        );
        conn.stop().await;
    }

    #[tokio::test]
    async fn refuses_a_gateway_that_is_not_the_pinned_one() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("ws://{}", listener.local_addr().unwrap());
        let (fake, pinned, device) = (
            SigningKey::from_bytes(&[9; 32]),
            SigningKey::from_bytes(&[1; 32]),
            SigningKey::from_bytes(&[2; 32]),
        );
        let server = tokio::spawn(gateway(listener, fake, device.verifying_key().to_bytes()));
        let (tx, mut rx) = mpsc::unbounded_channel();
        let conn = Connection::start(options(url, &pinned, &device), tx);
        // The fake gateway never gets a ClientAuth, and the node never reports a connection.
        assert!(
            !tokio::time::timeout(Duration::from_secs(10), server)
                .await
                .unwrap()
                .unwrap()
        );
        conn.stop().await;
        while let Ok(ev) = rx.try_recv() {
            assert!(!matches!(ev, Event::State(ConnState::Connected)));
        }
    }
}
