//! SplitCortex command line node: enrolls and serves like a phone node, headless. See docs/cli-node.md.

mod connection;
mod crypto;
mod engine;
mod enroll;
mod handshake;
mod models;
mod proto;
mod restart;
mod runtime;
mod service;
mod settings;
mod storage;
mod system;
mod update;

use anyhow::{Context, Result, bail};
use clap::{Parser, Subcommand};
use std::io::Write;
use storage::Dirs;
use tokio_util::sync::CancellationToken;

#[derive(Parser)]
#[command(
    name = "splitcortex-node",
    version,
    about = "SplitCortex command line node"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

const DEFAULT_URL: &str = "https://splitcortex.com";

#[derive(Subcommand)]
enum Command {
    /// Enroll this computer with a code from "Add device" in the web app
    Join {
        /// The web app's address (default: the one saved by the installer or `config --url`, else https://splitcortex.com)
        #[arg(long, env = "SPLITCORTEX_URL")]
        url: Option<String>,
        /// The enrollment code XXXX-XXXXXX (asked for when missing)
        #[arg(long)]
        code: Option<String>,
    },
    /// Connect to the gateway and serve requests (stop with Ctrl+C)
    Run {
        /// Tests only: answer with synthetic tokens and download no model (see docs/cli-node.md). Never in a real pool.
        #[arg(long, hide = true, env = "SPLITCORTEX_FAKE_ENGINE")]
        fake: bool,
        /// Fake engine: milliseconds before the first token
        #[arg(
            long,
            hide = true,
            default_value_t = 20,
            env = "SPLITCORTEX_FAKE_FIRST_TOKEN_MS"
        )]
        fake_first_token_ms: u64,
        /// Fake engine: tokens per second after the first (0 = no delay)
        #[arg(
            long,
            hide = true,
            default_value_t = 200,
            env = "SPLITCORTEX_FAKE_TOKENS_PER_SEC"
        )]
        fake_tokens_per_sec: u32,
        /// Fake engine: length of the embedding vectors
        #[arg(
            long,
            hide = true,
            default_value_t = 768,
            env = "SPLITCORTEX_FAKE_DIMENSION"
        )]
        fake_dimension: u32,
    },
    /// Show whether this computer is enrolled and approved
    Status,
    /// Forget the enrollment and the device key (the device must be enrolled again)
    Leave,
    /// Show or change the node's own settings
    Config {
        /// auto (measure CPU against GPU), cpu or gpu
        #[arg(long, value_parser = ["auto", "cpu", "gpu"])]
        compute: Option<String>,
        /// Context window in tokens, 0 = automatic
        #[arg(long)]
        context: Option<u32>,
        /// Keep the computer awake while serving
        #[arg(long)]
        keep_awake: Option<bool>,
        /// The web app's address `join` enrolls against (saved)
        #[arg(long)]
        url: Option<String>,
        /// Folder for the model files (absolute path, saved; empty = the default inside the data folder).
        /// `SPLITCORTEX_MODELS_DIR` overrides it. Models already downloaded stay where they are.
        #[arg(long)]
        models_dir: Option<String>,
    },
    /// Install the newest release (`--check` only looks)
    Update {
        #[arg(long)]
        check: bool,
    },
    /// Run in the background and at login
    Service {
        #[command(subcommand)]
        action: ServiceAction,
    },
}

#[derive(Subcommand)]
enum ServiceAction {
    Install,
    Uninstall,
    Status,
}

fn ask(prompt: &str) -> Result<String> {
    print!("{prompt}");
    std::io::stdout().flush()?;
    let mut s = String::new();
    std::io::stdin().read_line(&mut s)?;
    Ok(s.trim().to_string())
}

/// `https://app.example.com` and `https://app.example.com/api` both mean the control plane's `/api`.
fn normalize_url(input: &str) -> Result<String> {
    let u = reqwest::Url::parse(input.trim())
        .map_err(|_| anyhow::anyhow!("not a valid address: {input}"))?;
    if u.scheme() != "https" && u.scheme() != "http" {
        bail!("the address must start with https://");
    }
    let path = u.path().trim_end_matches('/');
    let base = format!("{}{}", u.origin().ascii_serialization(), path);
    Ok(if path.ends_with("/api") {
        base
    } else {
        format!("{base}/api")
    })
}

fn init_logging() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .with_target(false)
        .init();
}

async fn wait_for_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{SignalKind, signal};
        if let Ok(mut term) = signal(SignalKind::terminate()) {
            tokio::select! {
                _ = tokio::signal::ctrl_c() => {}
                _ = term.recv() => {}
            }
            return;
        }
    }
    let _ = tokio::signal::ctrl_c().await;
}

#[tokio::main]
async fn main() -> Result<()> {
    // Two TLS stacks (the HTTP client and the WebSocket client) are linked in: pick the provider once.
    let _ = rustls::crypto::ring::default_provider().install_default();
    update::cleanup_old();
    let dirs = Dirs::discover()?;
    match Cli::parse().command {
        Command::Join { url, code } => {
            if let Some(e) = enroll::load_enrollment(&dirs) {
                bail!(
                    "Already enrolled as {} ({}). Run `splitcortex-node leave` first to enroll again.",
                    e.device_name.as_deref().unwrap_or("this device"),
                    e.node_id
                );
            }
            let code = match code {
                Some(c) => c,
                None => ask("Enrollment code (XXXX-XXXXXX): ")?,
            };
            let saved: settings::Settings = dirs.read_json(settings::FILE).unwrap_or_default();
            let url = url
                .filter(|u| !u.trim().is_empty())
                .or_else(|| Some(saved.app_url).filter(|u| !u.is_empty()))
                .unwrap_or_else(|| DEFAULT_URL.to_string());
            let url = normalize_url(&url)?;
            let device = system::device_info();
            let e = enroll::enroll(&dirs, &url, &code, &device)
                .await
                .map_err(|e| anyhow::anyhow!(e.to_string()))?;
            println!("Enrolled as {} ({})", device.name, e.node_id);
            println!(
                "Fingerprint: {} (compare it with the one in the web app)",
                e.fingerprint
            );
            if let (Some(pool), Some(org)) = (&e.pool_name, &e.org_name) {
                println!("Pool: {pool} ({org})");
            }
            if e.approved {
                println!(
                    "Start serving with: splitcortex-node run   (or: splitcortex-node service install)"
                );
            } else {
                println!(
                    "Waiting for an admin to approve this device; `run` starts serving once it is approved."
                );
            }
        }
        Command::Run {
            fake,
            fake_first_token_ms,
            fake_tokens_per_sec,
            fake_dimension,
        } => {
            init_logging();
            let fake = fake.then_some(engine::fake::FakeConfig {
                first_token_ms: fake_first_token_ms,
                tokens_per_sec: fake_tokens_per_sec,
                dimension: fake_dimension,
            });
            let shutdown = CancellationToken::new();
            let s = shutdown.clone();
            tokio::spawn(async move {
                wait_for_signal().await;
                s.cancel();
            });
            if runtime::run(dirs, shutdown, fake).await? == runtime::End::Restart {
                // Everything is closed: start this program again (see restart.rs). It returns only on failure.
                let e = restart::relaunch();
                tracing::error!("Cannot restart: {e}");
                // Exit non-zero so a service manager that restarts on failure still brings the node back.
                std::process::exit(75);
            }
        }
        Command::Status => match enroll::refresh_enrollment(&dirs).await {
            None => println!("Not enrolled. Run: splitcortex-node join"),
            Some(e) => {
                println!("Device:      {}", e.device_name.as_deref().unwrap_or("-"));
                println!("Node id:     {}", e.node_id);
                println!("Fingerprint: {}", e.fingerprint);
                println!("Organisation: {}", e.org_name.as_deref().unwrap_or("-"));
                println!("Pool:        {}", e.pool_name.as_deref().unwrap_or("-"));
                println!(
                    "Approved:    {}",
                    if e.approved {
                        "yes"
                    } else {
                        "no, waiting for an admin"
                    }
                );
                println!(
                    "Gateway:     {}",
                    e.gateway
                        .as_ref()
                        .map(|g| g.url.as_str())
                        .unwrap_or("not given yet")
                );
                println!("Version:     {}", system::APP_VERSION);
            }
        },
        Command::Leave => {
            enroll::clear_enrollment(&dirs)?;
            enroll::reset_identity(&dirs)?;
            println!(
                "Forgot the enrollment and the device key. Remove the device in the web app too."
            );
        }
        Command::Config {
            compute,
            context,
            keep_awake,
            url,
            models_dir,
        } => {
            let mut s: settings::Settings = dirs.read_json(settings::FILE).unwrap_or_default();
            if let Some(c) = compute {
                s.compute = c;
            }
            if let Some(n) = context {
                if n != 0 && !(settings::MIN_CONTEXT..=settings::MAX_CONTEXT).contains(&n) {
                    bail!(
                        "the context window must be 0 (automatic) or {}..{}",
                        settings::MIN_CONTEXT,
                        settings::MAX_CONTEXT
                    );
                }
                s.max_context_tokens = n;
            }
            if let Some(k) = keep_awake {
                s.keep_awake = k;
            }
            if let Some(u) = url {
                // Validated now, stored as typed (empty resets to the default).
                if !u.trim().is_empty() {
                    normalize_url(&u)?;
                }
                s.app_url = u.trim().to_string();
            }
            if let Some(d) = models_dir {
                let d = d.trim();
                if !d.is_empty() {
                    let path = std::path::Path::new(d);
                    // A relative path would mean something else for a service than for this shell.
                    if !path.is_absolute() {
                        bail!("the models folder must be an absolute path");
                    }
                    std::fs::create_dir_all(path)
                        .with_context(|| format!("cannot create {}", path.display()))?;
                }
                s.models_dir = d.to_string();
            }
            dirs.write_json(settings::FILE, &s)?;
            println!("compute:     {}", s.compute);
            println!(
                "context:     {}",
                if s.max_context_tokens == 0 {
                    "automatic".into()
                } else {
                    s.max_context_tokens.to_string()
                }
            );
            println!("keep awake:  {}", s.keep_awake);
            println!(
                "models in:   {}",
                if s.models_dir.is_empty() {
                    "default (inside the data folder)"
                } else {
                    &s.models_dir
                }
            );
            println!(
                "web app:     {}",
                if s.app_url.is_empty() {
                    DEFAULT_URL
                } else {
                    &s.app_url
                }
            );
            println!("(an admin override in the web app wins; restart the node to apply changes)");
        }
        Command::Update { check } => update::update(check).await?,
        Command::Service { action } => match action {
            ServiceAction::Install => service::install(&dirs)?,
            ServiceAction::Uninstall => service::uninstall()?,
            ServiceAction::Status => service::status()?,
        },
    }
    Ok(())
}
