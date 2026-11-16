//! Model files and the device secret, on disk under the app's data directory.
//!
//! Models: a multi-GB file is never held in memory. The web side downloads it in signed ranges and hands each piece
//! to `model_write` as the raw request body, written in place at an offset, so an interrupted download resumes. The
//! SHA-256 is computed here, streaming. Names are validated: only `[A-Za-z0-9._-]`, never a path.
//! Secrets: one small file per name in `secrets/`, mode 0600 on Unix (on Windows the user profile's ACL applies).

use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, ipc::Request};

fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && !name.starts_with('.')
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'_' || b == b'-')
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

pub fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = data_dir(app)?.join("models");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// The path of a stored model file (the engine loads it by this path).
pub fn model_path(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    if !valid_name(name) {
        return Err("invalid file name".into());
    }
    Ok(models_dir(app)?.join(name))
}

#[tauri::command]
pub fn model_size(app: AppHandle, name: String) -> Result<i64, String> {
    match fs::metadata(model_path(&app, &name)?) {
        Ok(m) => Ok(m.len() as i64),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(-1),
        Err(e) => Err(e.to_string()),
    }
}

/// The body is the bytes; `x-name` and `x-at` (offset) travel as headers.
#[tauri::command]
pub fn model_write(app: AppHandle, request: Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw bytes".into());
    };
    let header = |k: &str| {
        request
            .headers()
            .get(k)
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| format!("missing {k}"))
    };
    let name = header("x-name")?;
    let at: u64 = header("x-at")?
        .parse()
        .map_err(|_| "bad offset".to_string())?;
    let mut f = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(false)
        .open(model_path(&app, name)?)
        .map_err(|e| e.to_string())?;
    f.seek(SeekFrom::Start(at)).map_err(|e| e.to_string())?;
    f.write_all(bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn model_truncate(app: AppHandle, name: String, length: u64) -> Result<(), String> {
    let f = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(false)
        .open(model_path(&app, &name)?)
        .map_err(|e| e.to_string())?;
    f.set_len(length).map_err(|e| e.to_string())
}

fn sha256_of(path: &Path) -> std::io::Result<String> {
    let mut f = File::open(path)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

#[tauri::command]
pub async fn model_sha256(app: AppHandle, name: String) -> Result<String, String> {
    let path = model_path(&app, &name)?;
    tauri::async_runtime::spawn_blocking(move || sha256_of(&path).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn model_remove(app: AppHandle, name: String) -> Result<(), String> {
    match fs::remove_file(model_path(&app, &name)?) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn model_list(app: AppHandle) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    for e in fs::read_dir(models_dir(&app)?).map_err(|e| e.to_string())? {
        let e = e.map_err(|e| e.to_string())?;
        if let Some(n) = e.file_name().to_str()
            && valid_name(n)
        {
            out.push(n.to_string());
        }
    }
    Ok(out)
}

fn secret_path(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    if !valid_name(name) {
        return Err("invalid secret name".into());
    }
    let dir = data_dir(app)?.join("secrets");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    }
    Ok(dir.join(name))
}

#[tauri::command]
pub fn secret_get(app: AppHandle, name: String) -> Result<Option<String>, String> {
    match fs::read_to_string(secret_path(&app, &name)?) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn secret_set(app: AppHandle, name: String, value: String) -> Result<(), String> {
    let path = secret_path(&app, &name)?;
    let mut opts = OpenOptions::new();
    opts.create(true).write(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut f = opts.open(&path).map_err(|e| e.to_string())?;
    f.write_all(value.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secret_delete(app: AppHandle, name: String) -> Result<(), String> {
    match fs::remove_file(secret_path(&app, &name)?) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_plain_file_names() {
        assert!(valid_name("a1b2.litertlm"));
        assert!(valid_name("a1b2.litertlm.part"));
        assert!(!valid_name(""));
        assert!(!valid_name("../x"));
        assert!(!valid_name("a/b"));
        assert!(!valid_name("a\\b"));
        assert!(!valid_name(".hidden"));
    }

    #[test]
    fn sha256_streams_a_file() {
        let dir = std::env::temp_dir().join(format!("sc-sha-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let p = dir.join("f");
        fs::write(&p, b"abc").unwrap();
        assert_eq!(
            sha256_of(&p).unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        fs::remove_dir_all(dir).unwrap();
    }
}
