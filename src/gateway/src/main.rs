mod cache;
mod config;
mod node_ws;
mod openai;
mod proto;
mod registry;
mod state;
mod usage;

use std::collections::HashMap;
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

    let cfg = config::Config::from_env()?;
    let db = PgPoolOptions::new()
        .max_connections(10)
        .connect(&cfg.database_url)
        .await?;

    let cache: cache::SharedCache = Arc::new(RwLock::new(cache::Cache::default()));
    let changed = Arc::new(Notify::new());
    let (ready_tx, ready_rx) = watch::channel(false);
    let usage = Arc::new(usage::Usage::new(cfg.usage_max_buckets, cfg.usage_max_age_secs));

    // Nothing is connected yet (single gateway instance): clear stale "connected" flags from a previous run.
    sqlx::query("update node_status set connected = false where connected")
        .execute(&db)
        .await?;

    let app = Arc::new(AppState {
        db: db.clone(),
        cache: cache.clone(),
        registry: Default::default(),
        usage: usage.clone(),
        signing_key: cfg.signing_key,
        changed: changed.clone(),
        cache_ready: ready_rx,
        unknown_keys: Mutex::new(HashMap::new()),
        key_touched: Mutex::new(HashMap::new()),
    });

    tokio::spawn(cache::run(db.clone(), cache, changed, Arc::new(ready_tx)));
    tokio::spawn(usage::flush_loop(usage.clone(), db.clone()));
    tokio::spawn(node_ws::reconcile_loop(app.clone()));
    tokio::spawn(node_ws::heartbeat_loop(app.clone()));

    let router = Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/readyz", get(readyz))
        .route("/node", get(node_ws::upgrade))
        .route("/v1/models", get(openai::models))
        .route("/v1/chat/completions", post(openai::chat_completions))
        .with_state(app.clone());

    let listener = tokio::net::TcpListener::bind(("0.0.0.0", cfg.port)).await?;
    info!(port = cfg.port, "gateway listening");
    axum::serve(listener, router)
        .with_graceful_shutdown(async {
            let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).unwrap();
            tokio::select! { _ = term.recv() => {}, _ = tokio::signal::ctrl_c() => {} }
        })
        .await?;

    // Flush the usage counters before exiting.
    usage.flush(&db).await;
    Ok(())
}

async fn readyz(State(app): State<Arc<AppState>>) -> StatusCode {
    if *app.cache_ready.borrow() {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    }
}
