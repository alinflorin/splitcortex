use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD as B64, Engine};
use ed25519_dalek::SigningKey;

pub struct Config {
    pub port: u16,
    pub database_url: String,
    /// The gateway's long-lived identity key. Nodes pin its public half at enrollment and verify it on every connect.
    pub signing_key: SigningKey,
    /// Maximum number of unflushed usage buckets before new requests fail closed.
    pub usage_max_buckets: usize,
    /// Maximum age of the oldest unflushed usage bucket before new requests fail closed.
    pub usage_max_age_secs: i64,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let seed = std::env::var("GATEWAY_PRIVATE_KEY").context("GATEWAY_PRIVATE_KEY is required")?;
        Ok(Self {
            port: std::env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(8080),
            database_url: std::env::var("DATABASE_URL").context("DATABASE_URL is required")?,
            signing_key: parse_private_key(&seed)?,
            usage_max_buckets: env_or("USAGE_MAX_BUCKETS", 20_000),
            usage_max_age_secs: env_or("USAGE_MAX_AGE_SECONDS", 600),
        })
    }
}

fn env_or<T: std::str::FromStr>(name: &str, default: T) -> T {
    std::env::var(name).ok().and_then(|v| v.parse().ok()).unwrap_or(default)
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
