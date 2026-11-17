use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD as B64, Engine};
use ed25519_dalek::{SigningKey, VerifyingKey};
use sha2::{Digest, Sha256};

pub struct Config {
    pub port: u16,
    pub database_url: String,
    /// The gateway's long-lived identity key. Nodes pin its public half at enrollment and verify it on every connect.
    pub signing_key: SigningKey,
    /// Maximum number of unflushed usage buckets before new requests fail closed.
    pub usage_max_buckets: usize,
    /// Maximum age of the oldest unflushed usage bucket before new requests fail closed.
    pub usage_max_age_secs: i64,
    /// During a key rotation: the key the gateway is about to switch to (see docs/gateway.md).
    pub next_key: Option<SigningKey>,
    /// Name of this instance (the pod name), unique among running gateways.
    pub instance_id: String,
    /// Where other gateways reach this one (`host:port`), or None when running alone.
    pub advertise: Option<String>,
    /// Port of the internal listener (gateway to gateway forwarding), never exposed through a Service or Ingress.
    pub internal_port: u16,
    /// Shared by all instances (derived from the identity key): authenticates forwarded requests.
    pub internal_token: String,
    /// After SIGTERM: how long the instance keeps serving normally so the load balancer can drop it (readiness is already failing).
    pub drain_delay_secs: u64,
    /// After SIGTERM: the longest the instance waits for running requests before it exits anyway.
    pub drain_timeout_secs: u64,
    /// Most media (decoded images and audio) one chat request may carry, in bytes (`GATEWAY_MAX_MEDIA_MB`, default 256).
    pub max_media_bytes: usize,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let seed = std::env::var("GATEWAY_PRIVATE_KEY").context("GATEWAY_PRIVATE_KEY is required")?;
        let signing_key = parse_private_key(&seed)?;
        let next_key = match std::env::var("GATEWAY_NEXT_PRIVATE_KEY") {
            Ok(v) if !v.trim().is_empty() => Some(parse_private_key(&v)?),
            _ => None,
        };
        let internal_port: u16 = env_or("GATEWAY_INTERNAL_PORT", 8081);
        let advertise = std::env::var("GATEWAY_ADVERTISE_ADDR")
            .ok()
            .filter(|v| !v.is_empty())
            .or_else(|| {
                std::env::var("POD_IP")
                    .ok()
                    .filter(|v| !v.is_empty())
                    .map(|ip| format!("{ip}:{internal_port}"))
            });
        let instance_id = std::env::var("GATEWAY_INSTANCE_ID")
            .ok()
            .filter(|v| !v.is_empty())
            .or_else(|| std::env::var("HOSTNAME").ok().filter(|v| !v.is_empty()))
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let internal_token = internal_token(&signing_key);
        Ok(Self {
            port: std::env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(8080),
            database_url: std::env::var("DATABASE_URL").context("DATABASE_URL is required")?,
            signing_key,
            usage_max_buckets: env_or("USAGE_MAX_BUCKETS", 20_000),
            usage_max_age_secs: env_or("USAGE_MAX_AGE_SECONDS", 600),
            next_key,
            instance_id,
            advertise,
            internal_port,
            internal_token,
            drain_delay_secs: env_or("DRAIN_DELAY_SECONDS", 5),
            drain_timeout_secs: env_or("DRAIN_TIMEOUT_SECONDS", 3600),
            max_media_bytes: env_or::<usize>("GATEWAY_MAX_MEDIA_MB", 256).max(1) << 20,
        })
    }
}

fn env_or<T: std::str::FromStr>(name: &str, default: T) -> T {
    std::env::var(name).ok().and_then(|v| v.parse().ok()).unwrap_or(default)
}

/// Identifies a gateway public key (first 8 bytes of its SHA-256, hex); devices report the ids they trust.
pub fn key_id(key: &VerifyingKey) -> String {
    Sha256::digest(key.to_bytes())[..8]
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// A bearer secret every instance derives from the identity key (they all hold it), so forwarded requests need no
/// extra secret to distribute. It is never logged.
pub fn internal_token(key: &SigningKey) -> String {
    let mut h = Sha256::new();
    h.update(b"splitcortex-internal-v1");
    h.update(key.to_bytes());
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// The private key is the base64 (url-safe or standard, padded or not) encoding of the 32-byte Ed25519 seed. The chart
/// generates it with Helm's `randBytes 32 | b64enc` (standard base64).
pub fn parse_private_key(s: &str) -> Result<SigningKey> {
    let normalised: String = s.trim().trim_end_matches('=').replace('+', "-").replace('/', "_");
    let bytes = B64
        .decode(normalised)
        .map_err(|_| anyhow!("GATEWAY_PRIVATE_KEY is not base64"))?;
    let seed: [u8; 32] = bytes
        .try_into()
        .map_err(|_| anyhow!("GATEWAY_PRIVATE_KEY must be 32 bytes"))?;
    Ok(SigningKey::from_bytes(&seed))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_url_safe_and_standard_base64_seeds() {
        // Helm's `randBytes 32 | b64enc` is standard base64 with padding; `gateway keygen` prints url-safe without it.
        let seed = [251u8; 32]; // encodes with both '+' and '/' in standard base64
        let std = base64::engine::general_purpose::STANDARD.encode(seed);
        assert!(std.contains('+') || std.contains('/') || std.ends_with('='));
        let a = parse_private_key(&std).unwrap();
        let b = parse_private_key(&B64.encode(seed)).unwrap();
        assert_eq!(a.to_bytes(), b.to_bytes());
        assert!(parse_private_key("short").is_err());
    }
}
