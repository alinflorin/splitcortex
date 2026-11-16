//! Enrollment with the control plane (never the gateway): two PAKE rounds over HTTPS. The typed code authenticates both
//! sides, so a wrong or fake server cannot complete the exchange; the device then registers its own public key
//! (proving it holds the private key) and learns the gateway identity to pin. Also the device's identity and the
//! stored enrollment.

use crate::crypto::{
    b64, fingerprint, open, parse_code, proof_of_possession, seal, start_pake, unb64,
};
use crate::handshake::node_authorization;
use crate::storage::Dirs;
use anyhow::{Context, Result};
use ed25519_dalek::SigningKey;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

const KEY: &str = "device-key";
const STORE: &str = "enrollment.json";

#[derive(Debug, thiserror::Error)]
pub enum EnrollError {
    #[error("invalid, expired or used up code")]
    InvalidCode,
    #[error("too many attempts, wait a moment")]
    RateLimited,
    #[error("this device key is already registered")]
    Conflict,
    #[error(
        "the server could not prove it knows the code: not the server you meant, or a wrong code"
    )]
    UntrustedServer,
    #[error("cannot reach the server")]
    Network,
    #[error("unexpected server response ({0})")]
    Server(String),
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Gateway {
    pub public_key: String,
    pub url: String,
    /// Keys the gateway announced for a key rotation (signed by the current one); trusted alongside it.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub next_keys: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StoredEnrollment {
    pub node_id: String,
    pub fingerprint: String,
    pub approved: bool,
    /// Control plane URL it enrolled against (the web app's `/api`).
    pub enrollment_url: String,
    pub gateway: Option<Gateway>,
    pub org_name: Option<String>,
    pub pool_name: Option<String>,
    pub device_name: Option<String>,
    /// Unix seconds.
    pub enrolled_at: u64,
}

pub fn load_enrollment(dirs: &Dirs) -> Option<StoredEnrollment> {
    dirs.read_json(STORE)
}
pub fn save_enrollment(dirs: &Dirs, e: &StoredEnrollment) -> Result<()> {
    dirs.write_json(STORE, e)
}
pub fn clear_enrollment(dirs: &Dirs) -> Result<()> {
    dirs.remove_file(STORE)
}

/// This device's own Ed25519 key pair, generated on first use. The private key never leaves the device (a file only the
/// current user can read, not a hardware key). Deleting the data directory forgets it and the device must be enrolled
/// again (the old node then stays in the pool until an admin removes it).
pub fn get_or_create_identity(dirs: &Dirs) -> Result<SigningKey> {
    if let Some(s) = dirs.secret_get(KEY)?
        && let Some(bytes) = hex_decode(s.trim())
        && let Ok(seed) = <[u8; 32]>::try_from(bytes)
    {
        return Ok(SigningKey::from_bytes(&seed));
    }
    let mut seed = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut seed);
    dirs.secret_set(KEY, &hex_encode(&seed))?;
    Ok(SigningKey::from_bytes(&seed))
}

pub fn reset_identity(dirs: &Dirs) -> Result<()> {
    dirs.secret_delete(KEY)
}

fn hex_encode(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}
fn hex_decode(s: &str) -> Option<Vec<u8>> {
    if !s.len().is_multiple_of(2) || !s.is_ascii() {
        return None;
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok())
        .collect()
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub name: String,
    pub platform: String,
    pub device_model: Option<String>,
    pub os_version: Option<String>,
    pub app_version: String,
    pub cpu_cores: Option<u32>,
    pub memory_total_mb: Option<u64>,
}

async fn post(
    http: &reqwest::Client,
    base: &str,
    path: &str,
    body: Value,
) -> Result<Value, EnrollError> {
    let res = http
        .post(format!("{}{path}", base.trim_end_matches('/')))
        .json(&body)
        .send()
        .await
        .map_err(|_| EnrollError::Network)?;
    match res.status().as_u16() {
        404 => return Err(EnrollError::InvalidCode),
        429 => return Err(EnrollError::RateLimited),
        409 => return Err(EnrollError::Conflict),
        s if !res.status().is_success() => return Err(EnrollError::Server(format!("HTTP {s}"))),
        _ => {}
    }
    res.json::<Value>()
        .await
        .map_err(|_| EnrollError::Server("bad response".into()))
}

pub fn http_client() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent(concat!("splitcortex-node/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(std::time::Duration::from_secs(15))
        .build()
        .context("cannot create the HTTP client")
}

/// Enrolls this device and stores the result.
pub async fn enroll(
    dirs: &Dirs,
    base_url: &str,
    code: &str,
    device: &DeviceInfo,
) -> Result<StoredEnrollment, EnrollError> {
    let (lookup_id, secret) = parse_code(code).ok_or(EnrollError::InvalidCode)?;
    let key = get_or_create_identity(dirs).map_err(|e| EnrollError::Server(e.to_string()))?;
    let public = key.verifying_key().to_bytes();
    let http = http_client().map_err(|e| EnrollError::Server(e.to_string()))?;

    let mut sid = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut sid);
    let pake = start_pake(&secret, &sid);

    let started = post(
        &http,
        base_url,
        "/enroll/start",
        json!({"lookupId": lookup_id, "sid": b64(&sid), "share": b64(&pake.share)}),
    )
    .await?;
    let share = started
        .get("share")
        .and_then(Value::as_str)
        .and_then(unb64)
        .ok_or_else(|| EnrollError::Server("bad response".into()))?;
    let isk = pake.finish(&share).ok_or(EnrollError::UntrustedServer)?;

    let mut request =
        serde_json::to_value(device).map_err(|e| EnrollError::Server(e.to_string()))?;
    request["publicKey"] = json!(b64(&public));
    request["signature"] = json!(b64(&proof_of_possession(&key, &sid)));
    let completed = post(
        &http,
        base_url,
        "/enroll/complete",
        json!({
            "lookupId": lookup_id,
            "sealed": b64(&seal(&isk, &sid, "request", request.to_string().as_bytes())),
        }),
    )
    .await?;
    let sealed = completed
        .get("sealed")
        .and_then(Value::as_str)
        .and_then(unb64)
        .ok_or_else(|| EnrollError::Server("bad response".into()))?;
    // Only a server that derived the same key (so knows the code) can produce a message that opens.
    let plain = open(&isk, &sid, "response", &sealed).ok_or(EnrollError::UntrustedServer)?;
    let r: Value =
        serde_json::from_slice(&plain).map_err(|_| EnrollError::Server("bad response".into()))?;
    let (Some(node_id), Some(approved)) = (
        r.get("nodeId").and_then(Value::as_str),
        r.get("approved").and_then(Value::as_bool),
    ) else {
        return Err(EnrollError::Server("bad response".into()));
    };
    let text = |k: &str| r.get(k).and_then(Value::as_str).map(str::to_string);
    let gateway = r.get("gateway").and_then(|g| {
        Some(Gateway {
            public_key: g.get("publicKey")?.as_str()?.to_string(),
            url: g.get("url")?.as_str()?.to_string(),
            next_keys: Vec::new(),
        })
    });
    let stored = StoredEnrollment {
        node_id: node_id.to_string(),
        // The server computes the fingerprint too; trust our own calculation when they disagree.
        fingerprint: fingerprint(&public),
        approved,
        enrollment_url: base_url.trim_end_matches('/').to_string(),
        gateway,
        org_name: text("orgName"),
        pool_name: text("poolName"),
        device_name: Some(device.name.clone()),
        enrolled_at: unix_time(),
    };
    save_enrollment(dirs, &stored).map_err(|e| EnrollError::Server(e.to_string()))?;
    Ok(stored)
}

fn unix_time() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Asks the control plane who this device is (organisation, pool, name) and stores it. Works once the device is
/// approved (device routes reject unapproved ones); a success also proves it is approved. Best effort: offline or
/// rejected, the stored values stay.
pub async fn refresh_enrollment(dirs: &Dirs) -> Option<StoredEnrollment> {
    let e = load_enrollment(dirs)?;
    let key = get_or_create_identity(dirs).ok()?;
    let url = format!("{}/node/me", e.enrollment_url.trim_end_matches('/'));
    let path = reqwest::Url::parse(&url).ok()?.path().to_string();
    let res = http_client()
        .ok()?
        .get(&url)
        .header(
            "Authorization",
            node_authorization(&e.node_id, &key, "GET", &path),
        )
        .send()
        .await
        .ok()?;
    if !res.status().is_success() {
        return Some(e);
    }
    let me: Value = res.json().await.ok()?;
    let text = |k: &str| me.get(k).and_then(Value::as_str).map(str::to_string);
    let next = StoredEnrollment {
        org_name: text("orgName").or(e.org_name.clone()),
        pool_name: text("poolName").or(e.pool_name.clone()),
        device_name: text("name").or(e.device_name.clone()),
        approved: me
            .get("approved")
            .and_then(Value::as_bool)
            .unwrap_or(e.approved),
        ..e
    };
    save_enrollment(dirs, &next).ok()?;
    Some(next)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_round_trips() {
        assert_eq!(
            hex_decode(&hex_encode(&[0, 15, 255])),
            Some(vec![0, 15, 255])
        );
        assert_eq!(hex_decode("abc"), None);
        assert_eq!(hex_decode("zz"), None);
    }

    #[test]
    fn the_identity_is_created_once_and_kept() {
        let home = std::env::temp_dir().join(format!("sc-cli-id-{}", std::process::id()));
        let dirs = Dirs {
            data: home.join("data"),
            cache: home.join("cache"),
        };
        let a = get_or_create_identity(&dirs).unwrap();
        let b = get_or_create_identity(&dirs).unwrap();
        assert_eq!(a.to_bytes(), b.to_bytes());
        reset_identity(&dirs).unwrap();
        assert_ne!(
            get_or_create_identity(&dirs).unwrap().to_bytes(),
            a.to_bytes()
        );
        std::fs::remove_dir_all(home).unwrap();
    }
}
