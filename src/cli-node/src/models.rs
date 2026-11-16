//! Keeps the model the gateway assigned to this node's pool on disk: downloads it from the control plane in signed ranges
//! (resumable: a restart continues from what is stored), verifies the SHA-256, replaces the previous model (its file is
//! deleted first to free the space) and loads it into the engine. Never talks to Hugging Face or to object storage, and
//! never through the gateway. Port of `src/desktop-node/src/models/manager.ts`.

use crate::engine::compute::ComputeEngine;
use crate::handshake::node_authorization;
use crate::storage::{Dirs, file_size, list_models, remove_model, sha256_of};
use anyhow::{Result, anyhow, bail};
use ed25519_dalek::SigningKey;
use futures_util::StreamExt;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::io::{AsyncSeekExt, AsyncWriteExt};
use tokio::sync::{Mutex as AsyncMutex, mpsc};
use tokio_util::sync::CancellationToken;
use tracing::{error, info};

// Each range request is signed on its own (the control plane allows 60 s of clock skew per signature, so a long download
// never expires) and its body is written to disk piece by piece, never held whole.
const CHUNK: u64 = 8 * 1024 * 1024;

#[derive(Clone, Debug)]
pub struct Assignment {
    pub model_id: String,
    pub name: String,
    pub size_bytes: u64,
    pub sha256: String,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Phase {
    None,
    Downloading,
    Loading,
    Ready,
    Failed,
}

#[derive(Clone, Debug)]
pub struct Status {
    pub phase: Phase,
    pub model_id: String,
    pub progress_bytes: u64,
    pub error: Option<String>,
}

impl Status {
    pub fn none() -> Status {
        Status {
            phase: Phase::None,
            model_id: String::new(),
            progress_bytes: 0,
            error: None,
        }
    }
}

fn data_file(id: &str) -> String {
    format!("{id}.litertlm")
}
/// Written last, once the file is complete and verified: a data file without it is a partial download.
fn done_marker(id: &str) -> String {
    format!("{id}.ok")
}

pub struct ModelManager {
    dirs: Dirs,
    engine: Arc<ComputeEngine>,
    http: reqwest::Client,
    /// Control plane base URL the device enrolled against (includes `/api`).
    base_url: String,
    node_id: String,
    key: SigningKey,
    status: Mutex<Status>,
    updates: mpsc::UnboundedSender<Status>,
    current: Mutex<Option<CancellationToken>>,
    chain: AsyncMutex<()>,
}

impl ModelManager {
    pub fn new(
        dirs: Dirs,
        engine: Arc<ComputeEngine>,
        http: reqwest::Client,
        base_url: String,
        node_id: String,
        key: SigningKey,
        updates: mpsc::UnboundedSender<Status>,
    ) -> Arc<Self> {
        Arc::new(ModelManager {
            dirs,
            engine,
            http,
            base_url,
            node_id,
            key,
            status: Mutex::new(Status::none()),
            updates,
            current: Mutex::new(None),
            chain: AsyncMutex::new(()),
        })
    }

    /// Applies an assignment; a newer one cancels the one in progress.
    pub fn apply(self: &Arc<Self>, a: Assignment) {
        let token = CancellationToken::new();
        if let Some(prev) = self
            .current
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .replace(token.clone())
        {
            prev.cancel();
        }
        let me = self.clone();
        tokio::spawn(async move {
            let _turn = me.chain.lock().await;
            me.run(a, token).await;
        });
    }

    pub fn stop(&self) {
        if let Some(t) = self
            .current
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take()
        {
            t.cancel();
        }
    }

    fn publish(&self, s: Status) {
        *self.status.lock().unwrap_or_else(|e| e.into_inner()) = s.clone();
        let _ = self.updates.send(s);
    }

    fn set(&self, phase: Phase, a: &Assignment, progress: u64) {
        self.publish(Status {
            phase,
            model_id: a.model_id.clone(),
            progress_bytes: progress,
            error: None,
        });
    }

    async fn run(&self, a: Assignment, cancel: CancellationToken) {
        if cancel.is_cancelled() {
            return;
        }
        // Already serving exactly this model (a reconnect re-sends the assignment): just report it again.
        let cur = self
            .status
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        if !a.model_id.is_empty()
            && cur.model_id == a.model_id
            && cur.phase == Phase::Ready
            && self.engine.backend().is_some()
        {
            self.publish(cur);
            return;
        }
        let outcome: Result<()> = async {
            if a.model_id.is_empty() {
                self.engine.unload().await;
                self.remove_others("")?;
                self.publish(Status::none());
                info!("The pool serves no model");
                return Ok(());
            }
            let name = data_file(&a.model_id);
            let complete = file_size(&self.dirs.model_path(&done_marker(&a.model_id))?) >= 0
                && file_size(&self.dirs.model_path(&name)?) == a.size_bytes as i64;
            if !complete {
                self.engine.unload().await;
                self.remove_others(&a.model_id)?; // replace: the old model goes first, there may not be room for two
                remove_model(&self.dirs, &done_marker(&a.model_id))?;
                self.download(&a, &cancel).await?;
                if cancel.is_cancelled() {
                    return Ok(());
                }
            }
            self.set(Phase::Loading, &a, a.size_bytes);
            info!("Loading model {}", a.name);
            self.engine.load(&name).await.map_err(|e| anyhow!(e))?;
            if cancel.is_cancelled() {
                return Ok(());
            }
            self.set(Phase::Ready, &a, a.size_bytes);
            info!("Model {} is ready", a.name);
            Ok(())
        }
        .await;
        if let Err(e) = outcome
            && !cancel.is_cancelled()
        {
            error!(
                "Model {} failed: {e}",
                if a.name.is_empty() {
                    &a.model_id
                } else {
                    &a.name
                }
            );
            self.publish(Status {
                phase: Phase::Failed,
                model_id: a.model_id.clone(),
                progress_bytes: 0,
                error: Some(e.to_string()),
            });
        }
    }

    /// Deletes every stored file (and partial download) that does not belong to the model with this id.
    fn remove_others(&self, keep_id: &str) -> Result<()> {
        for f in list_models(&self.dirs)? {
            if keep_id.is_empty() || !f.starts_with(&format!("{keep_id}.")) {
                remove_model(&self.dirs, &f)?;
            }
        }
        Ok(())
    }

    async fn download(&self, a: &Assignment, cancel: &CancellationToken) -> Result<()> {
        let name = data_file(&a.model_id);
        let path = self.dirs.model_path(&name)?;
        let url = format!(
            "{}/node/models/{}/file",
            self.base_url.trim_end_matches('/'),
            a.model_id
        );
        let url_path = reqwest::Url::parse(&url)?.path().to_string();
        let mut offset = file_size(&path).max(0) as u64;
        if offset > a.size_bytes {
            tokio::fs::File::options()
                .write(true)
                .open(&path)
                .await?
                .set_len(0)
                .await?;
            offset = 0;
        }
        info!(
            "Downloading {} ({}{} bytes)",
            a.name,
            if offset > 0 {
                format!("resuming at {offset} of ")
            } else {
                String::new()
            },
            a.size_bytes
        );
        self.set(Phase::Downloading, a, offset);
        let mut file = tokio::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(false)
            .open(&path)
            .await?;
        file.seek(std::io::SeekFrom::Start(offset)).await?;
        let mut last_report = Instant::now();
        while offset < a.size_bytes {
            if cancel.is_cancelled() {
                return Ok(());
            }
            let end = (offset + CHUNK).min(a.size_bytes) - 1;
            let res = self
                .http
                .get(&url)
                .header(
                    "Authorization",
                    node_authorization(&self.node_id, &self.key, "GET", &url_path),
                )
                .header("Range", format!("bytes={offset}-{end}"))
                .send()
                .await?;
            if res.status().as_u16() != 206 {
                bail!("Download failed (HTTP {})", res.status().as_u16());
            }
            let mut body = res.bytes_stream();
            let mut got = 0u64;
            while let Some(piece) = body.next().await {
                if cancel.is_cancelled() {
                    return Ok(());
                }
                let piece = piece?;
                file.write_all(&piece).await?;
                offset += piece.len() as u64;
                got += piece.len() as u64;
                if last_report.elapsed() > Duration::from_secs(1) {
                    last_report = Instant::now();
                    self.set(Phase::Downloading, a, offset);
                }
            }
            if got == 0 {
                bail!("Download returned no data");
            }
        }
        file.flush().await?;
        drop(file); // the engine reads the file next: no write handle may stay open
        if !a.sha256.is_empty() {
            self.set(Phase::Loading, a, offset);
            let p = path.clone();
            let digest = tokio::task::spawn_blocking(move || sha256_of(&p)).await??;
            if !digest.eq_ignore_ascii_case(&a.sha256) {
                remove_model(&self.dirs, &name)?;
                bail!("The downloaded file does not match its checksum");
            }
        }
        std::fs::write(self.dirs.model_path(&done_marker(&a.model_id))?, [1u8])?;
        info!("Downloaded {}", a.name);
        Ok(())
    }
}
