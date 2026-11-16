//! Self-update: finds the newest `cli-node-v*` release on GitHub, downloads the archive for this platform, checks its
//! SHA-256 and replaces the installed files (the binary and the engine library next to it). The CLI node has its own tag
//! stream, so this never looks at the server's `v*` releases.

use anyhow::{Context, Result, anyhow, bail};
use semver::Version;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Path, PathBuf};

const RELEASES: &str = "https://api.github.com/repos/alinflorin/splitcortex/releases?per_page=50";
const TAG_PREFIX: &str = "cli-node-v";

/// The Rust target this binary was built for (the name used in release archives).
pub fn target() -> Option<&'static str> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("linux", "x86_64") => Some("x86_64-unknown-linux-gnu"),
        ("linux", "aarch64") => Some("aarch64-unknown-linux-gnu"),
        ("macos", "aarch64") => Some("aarch64-apple-darwin"),
        ("windows", "x86_64") => Some("x86_64-pc-windows-msvc"),
        _ => None,
    }
}

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    assets: Vec<Asset>,
}
#[derive(Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
}

/// The newest published `cli-node-vX.Y.Z` among the releases (`None` when there is none).
fn newest(releases: Vec<Release>) -> Option<(Version, Release)> {
    releases
        .into_iter()
        .filter(|r| !r.draft && !r.prerelease)
        .filter_map(|r| {
            let v = Version::parse(r.tag_name.strip_prefix(TAG_PREFIX)?).ok()?;
            Some((v, r))
        })
        .max_by(|a, b| a.0.cmp(&b.0))
}

async fn get_bytes(http: &reqwest::Client, url: &str) -> Result<Vec<u8>> {
    let res = http.get(url).send().await?;
    if !res.status().is_success() {
        bail!("{url}: HTTP {}", res.status().as_u16());
    }
    Ok(res.bytes().await?.to_vec())
}

pub async fn update(check_only: bool) -> Result<()> {
    let current = Version::parse(env!("CARGO_PKG_VERSION"))?;
    let target = target().ok_or_else(|| anyhow!("no release is built for this platform"))?;
    let http = crate::enroll::http_client()?;
    let releases: Vec<Release> = http
        .get(RELEASES)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await?
        .error_for_status()
        .context("cannot list the releases")?
        .json()
        .await?;
    let Some((latest, release)) = newest(releases) else {
        println!("No release of the command line node has been published yet.");
        return Ok(());
    };
    if latest <= current {
        println!("Up to date ({current}).");
        return Ok(());
    }
    println!("A newer version is available: {latest} (installed: {current}).");
    if check_only {
        return Ok(());
    }
    let ext = if cfg!(windows) { "zip" } else { "tar.gz" };
    let wanted = format!("splitcortex-node-{target}.{ext}");
    let find = |name: &str| {
        release
            .assets
            .iter()
            .find(|a| a.name == name)
            .ok_or_else(|| anyhow!("the release has no {name}"))
    };
    let archive = get_bytes(&http, &find(&wanted)?.browser_download_url).await?;
    let sum = String::from_utf8(
        get_bytes(
            &http,
            &find(&format!("{wanted}.sha256"))?.browser_download_url,
        )
        .await?,
    )?;
    let expected = sum.split_whitespace().next().unwrap_or("").to_lowercase();
    let got: String = Sha256::digest(&archive)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    if got != expected {
        bail!("the downloaded archive does not match its checksum");
    }
    let dir = std::env::current_exe()?
        .canonicalize()?
        .parent()
        .ok_or_else(|| anyhow!("cannot find the install folder"))?
        .to_path_buf();
    extract(&archive, &dir)?;
    println!("Updated to {latest}. Restart the node (and the service, if installed) to use it.");
    Ok(())
}

/// Replaces one installed file: written next to it first, then renamed over it. A running executable cannot be
/// overwritten on Windows but can be renamed, so the old one moves aside (`.old`, removed on the next start).
fn put(dest: &Path, bytes: &[u8], executable: bool) -> Result<()> {
    if let Some(p) = dest.parent() {
        std::fs::create_dir_all(p)?;
    }
    let new = dest.with_extension("new");
    std::fs::write(&new, bytes)?;
    #[cfg(unix)]
    if executable {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&new, std::fs::Permissions::from_mode(0o755))?;
    }
    let _ = executable;
    if cfg!(windows) && dest.exists() {
        let old = dest.with_extension("old");
        let _ = std::fs::remove_file(&old);
        std::fs::rename(dest, &old)?;
    }
    std::fs::rename(&new, dest)?;
    Ok(())
}

/// Entries are relative paths inside the archive; anything that would leave the folder is refused.
fn safe(path: &Path) -> Option<PathBuf> {
    let mut out = PathBuf::new();
    for c in path.components() {
        match c {
            std::path::Component::Normal(p) => out.push(p),
            std::path::Component::CurDir => {}
            _ => return None,
        }
    }
    (!out.as_os_str().is_empty()).then_some(out)
}

fn extract(archive: &[u8], dir: &Path) -> Result<()> {
    if cfg!(windows) {
        let mut z = zip::ZipArchive::new(std::io::Cursor::new(archive))?;
        for i in 0..z.len() {
            let mut f = z.by_index(i)?;
            if f.is_dir() {
                continue;
            }
            let Some(rel) = f.enclosed_name().and_then(|p| safe(&p)) else {
                continue;
            };
            let mut buf = Vec::new();
            f.read_to_end(&mut buf)?;
            put(
                &dir.join(&rel),
                &buf,
                rel.extension().is_some_and(|e| e == "exe"),
            )?;
        }
    } else {
        let mut t = tar::Archive::new(flate2::read::GzDecoder::new(archive));
        for entry in t.entries()? {
            let mut e = entry?;
            if !e.header().entry_type().is_file() {
                continue;
            }
            let Some(rel) = safe(&e.path()?) else {
                continue;
            };
            let mut buf = Vec::new();
            e.read_to_end(&mut buf)?;
            put(
                &dir.join(&rel),
                &buf,
                rel.parent().is_none_or(|p| p.as_os_str().is_empty()),
            )?;
        }
    }
    Ok(())
}

/// Removes what a previous update left behind (Windows moves the running executable aside).
pub fn cleanup_old() {
    if let Ok(exe) = std::env::current_exe() {
        let _ = std::fs::remove_file(exe.with_extension("old"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rel(tag: &str, draft: bool, pre: bool) -> Release {
        Release {
            tag_name: tag.into(),
            draft,
            prerelease: pre,
            assets: vec![],
        }
    }

    #[test]
    fn only_published_cli_node_releases_count() {
        let (v, r) = newest(vec![
            rel("v9.9.9", false, false),
            rel("desktop-node-v8.0.0", false, false),
            rel("cli-node-v1.2.0", false, false),
            rel("cli-node-v1.10.0", false, false),
            rel("cli-node-v2.0.0", true, false),
            rel("cli-node-v3.0.0", false, true),
            rel("cli-node-vnope", false, false),
        ])
        .unwrap();
        assert_eq!(v, Version::new(1, 10, 0));
        assert_eq!(r.tag_name, "cli-node-v1.10.0");
        assert!(newest(vec![rel("v1.0.0", false, false)]).is_none());
    }

    #[test]
    fn archive_paths_cannot_escape() {
        assert_eq!(
            safe(Path::new("litert/lib.so")),
            Some(PathBuf::from("litert/lib.so"))
        );
        assert_eq!(
            safe(Path::new("./splitcortex-node")),
            Some(PathBuf::from("splitcortex-node"))
        );
        assert_eq!(safe(Path::new("../x")), None);
        assert_eq!(safe(Path::new("/etc/passwd")), None);
    }
}
