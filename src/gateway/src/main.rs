mod benchmark;
mod cache;
mod cluster;
mod config;
mod limits;
mod node_ws;
mod openai;
mod proto;
mod registry;
mod state;
mod usage;

use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex, RwLock};

use anyhow::Result;
use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::Router;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD as B64, Engine};
use ed25519_dalek::SigningKey;
use sqlx::postgres::PgPoolOptions;
use tokio::sync::{watch, Notify};
use tracing::info;

use crate::state::AppState;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::try_from_env("LOG_LEVEL").unwrap_or_else(|_| "info".into()))
        .init();

    // `gateway keygen [--out FILE]` creates a new identity key pair. Without `--out` it prints both lines; with it,
    // they are written to the file (mode 0600) and nothing is printed, so the private key never reaches a log. The chart's
    // one-off identity Job uses `--out` and turns the file into two Secrets (see docs/gateway.md).
    let mut args = std::env::args().skip(1);
    if args.next().as_deref() == Some("keygen") {
        let key = SigningKey::generate(&mut rand::rngs::OsRng);
        let text = format!(
            "GATEWAY_PRIVATE_KEY={}\nGATEWAY_PUBLIC_KEY={}\n",
            B64.encode(key.to_bytes()),
            B64.encode(key.verifying_key().to_bytes())
        );
        match (args.next().as_deref(), args.next()) {
            (Some("--out"), Some(path)) => {
                use std::io::Write;
                use std::os::unix::fs::OpenOptionsExt;
                let mut f = std::fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .mode(0o600)
                    .open(path)?;
                f.write_all(text.as_bytes())?;
            }
            _ => print!("{text}"),
        }
        return Ok(());
    }

    if args_first_is("rotation-status") {
        return rotation_status().await;
    }

    let cfg = config::Config::from_env()?;
    let db = PgPoolOptions::new()
        .max_connections(10)
        .connect(&cfg.database_url)
        .await?;

    let cache: cache::SharedCache = Arc::new(RwLock::new(cache::Cache::default()));
    let changed = Arc::new(Notify::new());
    let (ready_tx, ready_rx) = watch::channel(false);
    let usage = Arc::new(usage::Usage::new(cfg.usage_max_buckets, cfg.usage_max_age_secs));

    // Nodes this instance held in a previous run (same pod name after a restart) are not connected any more. Rows of
    // other instances are theirs; rows of instances that died go stale on their own (the control plane ignores rows
    // that were not refreshed for a minute).
    sqlx::query("update node_status set connected = false, in_flight = 0 where connected and gateway_id = $1")
        .bind(&cfg.instance_id)
        .execute(&db)
        .await?;

    let app = Arc::new(AppState {
        db: db.clone(),
        cache: cache.clone(),
        registry: Default::default(),
        usage: usage.clone(),
        signing_key: cfg.signing_key,
        next_key: cfg.next_key,
        limiter: Default::default(),
        instance_id: cfg.instance_id.clone(),
        advertise: cfg.advertise.clone(),
        internal_token: cfg.internal_token.clone(),
        http: cluster::http_client(),
        changed: changed.clone(),
        cache_ready: ready_rx,
        draining: Default::default(),
        unknown_keys: Mutex::new(HashMap::new()),
        key_touched: Mutex::new(HashMap::new()),
    });

    tokio::spawn(cache::run(db.clone(), cache, changed, Arc::new(ready_tx)));
    tokio::spawn(usage::flush_loop(usage.clone(), db.clone()));
    tokio::spawn(node_ws::reconcile_loop(app.clone()));
    tokio::spawn(node_ws::heartbeat_loop(app.clone()));
    tokio::spawn(cluster::instance_loop(app.clone()));
    tokio::spawn(benchmark::run_loop(app.clone()));
    {
        let app = app.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(std::time::Duration::from_secs(300)).await;
                app.limiter.prune(chrono::Utc::now().timestamp());
            }
        });
    }

    // Gateway-to-gateway forwarding (own port, only reachable inside the cluster, bearer token required).
    if cfg.advertise.is_some() {
        let app_for_internal = app.clone();
        let internal = tokio::net::TcpListener::bind(("0.0.0.0", cfg.internal_port)).await?;
        info!(port = cfg.internal_port, instance = %cfg.instance_id, "internal listener");
        tokio::spawn(async move {
            let _ = axum::serve(internal, cluster::internal_router(app_for_internal)).await;
        });
    }

    let router = Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/readyz", get(readyz))
        .route("/node", get(node_ws::upgrade))
        .route("/v1/models", get(openai::models))
        .route("/v1/chat/completions", post(openai::chat_completions))
        .with_state(app.clone());

    let (drain_delay, drain_timeout) = (cfg.drain_delay_secs, cfg.drain_timeout_secs);
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", cfg.port)).await?;
    info!(port = cfg.port, "gateway listening");
    axum::serve(listener, router)
        .with_graceful_shutdown(drain(app.clone(), drain_delay, drain_timeout))
        .await?;

    // Flush the usage counters and leave the directory before exiting.
    usage.flush(&db).await;
    cluster::leave(&app).await;
    Ok(())
}

fn args_first_is(name: &str) -> bool {
    std::env::args().nth(1).as_deref() == Some(name)
}

/// `gateway rotation-status`: how many devices already trust the next gateway key (run it in a gateway pod, which has
/// the database URL and the next key; prints counts only, never key material).
async fn rotation_status() -> Result<()> {
    use sqlx::Row;
    let database_url = std::env::var("DATABASE_URL")?;
    let current = config::parse_private_key(&std::env::var("GATEWAY_PRIVATE_KEY")?)?;
    let next = match std::env::var("GATEWAY_NEXT_PRIVATE_KEY") {
        Ok(v) if !v.trim().is_empty() => Some(config::parse_private_key(&v)?),
        _ => None,
    };
    let db = PgPoolOptions::new().max_connections(1).connect(&database_url).await?;
    let total: i64 = sqlx::query_scalar("select count(*) from nodes where approved")
        .fetch_one(&db)
        .await?;
    println!("devices (approved): {total}");
    println!("current key id:     {}", config::key_id(&current.verifying_key()));
    let Some(next) = next else {
        println!("no rotation under way (GATEWAY_NEXT_PRIVATE_KEY is not set)");
        return Ok(());
    };
    let id = config::key_id(&next.verifying_key());
    println!("next key id:        {id}");
    let row = sqlx::query(
        "select count(*) filter (where ns.gateway_keys like '%' || $1 || '%') as trust, \
         count(*) filter (where ns.gateway_keys is null) as unknown \
         from nodes n left join node_status ns on ns.node_id = n.id where n.approved",
    )
    .bind(&id)
    .fetch_one(&db)
    .await?;
    let (trust, unknown): (i64, i64) = (row.get("trust"), row.get("unknown"));
    println!("trust the next key: {trust}");
    println!("never reported:     {unknown}");
    println!(
        "{}",
        if trust == total {
            "every device trusts the next key: it is safe to promote it"
        } else {
            "not yet: devices learn the next key when they connect; promoting now would strand the others"
        }
    );
    Ok(())
}

/// Graceful shutdown. On SIGTERM: stop being ready and leave the directory (peers stop forwarding here), keep serving
/// for `delay` seconds while the load balancer drops the pod, then refuse new requests and node connections, release
/// idle nodes (they reconnect to other instances) and wait until every running request has finished, at most
/// `timeout` seconds. Only then does the server stop; busy nodes keep their connection until their request is done.
async fn drain(app: Arc<AppState>, delay: u64, timeout: u64) {
    let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).unwrap();
    tokio::select! { _ = term.recv() => {}, _ = tokio::signal::ctrl_c() => {} }
    info!(delay, timeout, "shutting down: draining");
    app.draining.store(true, Ordering::Relaxed);
    cluster::leave_directory(&app).await;
    tokio::time::sleep(std::time::Duration::from_secs(delay)).await;
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(timeout);
    loop {
        for conn in app.registry.all() {
            if conn.load() == 0 && app.registry.waiting(conn.node_id) == 0 {
                let _ = conn.tx.try_send(registry::Outbound::Close);
            }
        }
        let active = app.registry.active_requests();
        if active == 0 {
            break;
        }
        if tokio::time::Instant::now() >= deadline {
            tracing::warn!(active, "drain deadline reached, exiting with requests still running");
            break;
        }
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }
    info!("drained");
}

async fn readyz(State(app): State<Arc<AppState>>) -> StatusCode {
    if app.draining.load(Ordering::Relaxed) {
        return StatusCode::SERVICE_UNAVAILABLE;
    }
    if *app.cache_ready.borrow() {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    }
}
