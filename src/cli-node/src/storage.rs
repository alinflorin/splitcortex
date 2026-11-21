//! Where the node keeps its state: model files, the device key and small JSON files, under one data directory
//! (`SPLITCORTEX_HOME` overrides it). Names are validated: only `[A-Za-z0-9._-]`, never a path. The device key is a file
//! only the current user can read (mode 0600 on Unix; on Windows the user profile's ACL applies).

use anyhow::{Context, Result, anyhow};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

#[derive(Clone, Debug)]
pub struct Dirs {
    pub data: PathBuf,
    pub cache: PathBuf,
    /// Where the model files live when it is not `<data>/models` (`SPLITCORTEX_MODELS_DIR`, else the `modelsDir`
    /// setting). Only the models move: the device key and the state stay in `data`.
    pub models_dir: Option<PathBuf>,
}

impl Dirs {
    pub fn discover() -> Result<Dirs> {
        if let Some(home) = std::env::var_os("SPLITCORTEX_HOME") {
            let home = PathBuf::from(home);
            return Ok(Dirs {
                data: home.join("data"),
                cache: home.join("cache"),
                models_dir: None,
            }
            .with_models_dir());
        }
        let d = directories::ProjectDirs::from("com", "splitcortex", "splitcortex-node")
            .ok_or_else(|| anyhow!("cannot find a home directory"))?;
        Ok(Dirs {
            data: d.data_dir().to_path_buf(),
            cache: d.cache_dir().to_path_buf(),
            models_dir: None,
        }
        .with_models_dir())
    }

    /// Applies the models folder choice: `SPLITCORTEX_MODELS_DIR` wins over the `modelsDir` setting; neither = default.
    fn with_models_dir(mut self) -> Dirs {
        let from_env = std::env::var_os("SPLITCORTEX_MODELS_DIR")
            .map(PathBuf::from)
            .filter(|p| !p.as_os_str().is_empty());
        self.models_dir = from_env.or_else(|| {
            let s: crate::settings::Settings = self.read_json(crate::settings::FILE)?;
            Some(PathBuf::from(s.models_dir)).filter(|p| !p.as_os_str().is_empty())
        });
        self
    }

    pub fn models(&self) -> Result<PathBuf> {
        let dir = self
            .models_dir
            .clone()
            .unwrap_or_else(|| self.data.join("models"));
        fs::create_dir_all(&dir).with_context(|| format!("cannot create {}", dir.display()))?;
        Ok(dir)
    }

    pub fn model_path(&self, name: &str) -> Result<PathBuf> {
        if !valid_name(name) {
            return Err(anyhow!("invalid file name"));
        }
        Ok(self.models()?.join(name))
    }

    fn secrets(&self) -> Result<PathBuf> {
        let dir = self.data.join("secrets");
        fs::create_dir_all(&dir)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&dir, fs::Permissions::from_mode(0o700))?;
        }
        Ok(dir)
    }

    pub fn secret_get(&self, name: &str) -> Result<Option<String>> {
        if !valid_name(name) {
            return Err(anyhow!("invalid secret name"));
        }
        match fs::read_to_string(self.secrets()?.join(name)) {
            Ok(s) => Ok(Some(s)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    pub fn secret_set(&self, name: &str, value: &str) -> Result<()> {
        if !valid_name(name) {
            return Err(anyhow!("invalid secret name"));
        }
        let mut opts = OpenOptions::new();
        opts.create(true).write(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let mut f = opts.open(self.secrets()?.join(name))?;
        f.write_all(value.as_bytes())?;
        Ok(())
    }

    pub fn secret_delete(&self, name: &str) -> Result<()> {
        match fs::remove_file(self.secrets()?.join(name)) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.into()),
        }
    }

    /// Reads a JSON state file; a missing or unreadable file is `None`.
    pub fn read_json<T: serde::de::DeserializeOwned>(&self, name: &str) -> Option<T> {
        serde_json::from_slice(&fs::read(self.data.join(name)).ok()?).ok()
    }

    /// Writes a JSON state file atomically (a crash never leaves half a file).
    pub fn write_json<T: serde::Serialize>(&self, name: &str, value: &T) -> Result<()> {
        fs::create_dir_all(&self.data)?;
        let tmp = self.data.join(format!("{name}.tmp"));
        fs::write(&tmp, serde_json::to_vec_pretty(value)?)?;
        fs::rename(&tmp, self.data.join(name))?;
        Ok(())
    }

    pub fn remove_file(&self, name: &str) -> Result<()> {
        match fs::remove_file(self.data.join(name)) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.into()),
        }
    }
}

pub fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && !name.starts_with('.')
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'_' || b == b'-')
}

/// Size of a stored model file, or -1 when it does not exist.
pub fn file_size(path: &Path) -> i64 {
    fs::metadata(path).map(|m| m.len() as i64).unwrap_or(-1)
}

pub fn sha256_of(path: &Path) -> std::io::Result<String> {
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

/// A file this node made: `<model id>.litertlm` (data, or a partial download) or `<model id>.ok` (finished marker),
/// the id being a UUID. The models folder can be one the user chose, so nothing else in it is ever listed or deleted.
pub fn is_model_file(name: &str) -> bool {
    let Some(id) = name
        .strip_suffix(".litertlm")
        .or_else(|| name.strip_suffix(".ok"))
    else {
        return false;
    };
    let groups: Vec<&str> = id.split('-').collect();
    groups.len() == 5
        && groups
            .iter()
            .zip([8, 4, 4, 4, 12])
            .all(|(g, n)| g.len() == n && g.bytes().all(|b| b.is_ascii_hexdigit()))
}

/// Every model file this node stored (and partial download).
pub fn list_models(dirs: &Dirs) -> Result<Vec<String>> {
    let mut out = Vec::new();
    for e in fs::read_dir(dirs.models()?)? {
        let e = e?;
        if let Some(n) = e.file_name().to_str()
            && valid_name(n)
            && is_model_file(n)
        {
            out.push(n.to_string());
        }
    }
    Ok(out)
}

pub fn remove_model(dirs: &Dirs, name: &str) -> Result<()> {
    match fs::remove_file(dirs.model_path(name)?) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_plain_file_names() {
        assert!(valid_name("a1b2.litertlm"));
        assert!(!valid_name(""));
        assert!(!valid_name("../x"));
        assert!(!valid_name("a/b"));
        assert!(!valid_name("a\\b"));
        assert!(!valid_name(".hidden"));
    }

    #[test]
    fn only_files_the_node_made_count_as_models() {
        let id = "0b9d2f4e-6c1a-4f3b-9a7e-1d2c3b4a5f60";
        assert!(is_model_file(&format!("{id}.litertlm")));
        assert!(is_model_file(&format!("{id}.ok")));
        for other in [
            "notes.txt",
            "model.litertlm",
            "gemma-3n.litertlm",
            ".ok",
            "0b9d2f4e-6c1a-4f3b-9a7e-1d2c3b4a5f6.litertlm",
            "0b9d2f4e-6c1a-4f3b-9a7e-1d2c3b4a5f60.part",
            "0b9d2f4e-6c1a-4f3b-9a7e-1d2c3b4a5f6g.ok",
        ] {
            assert!(!is_model_file(other), "{other}");
        }
    }

    #[test]
    fn a_chosen_models_folder_is_used_and_foreign_files_in_it_are_left_alone() {
        let home = std::env::temp_dir().join(format!("sc-cli-models-{}", std::process::id()));
        let elsewhere = home.join("big-disk").join("models");
        let dirs = Dirs {
            data: home.join("data"),
            cache: home.join("cache"),
            models_dir: Some(elsewhere.clone()),
        };
        assert_eq!(dirs.models().unwrap(), elsewhere);
        let id = "0b9d2f4e-6c1a-4f3b-9a7e-1d2c3b4a5f60";
        fs::write(elsewhere.join(format!("{id}.litertlm")), b"x").unwrap();
        fs::write(elsewhere.join("holiday.litertlm"), b"mine").unwrap();
        fs::write(elsewhere.join("notes.txt"), b"mine").unwrap();
        assert_eq!(list_models(&dirs).unwrap(), vec![format!("{id}.litertlm")]);
        // The state did not move.
        assert!(!home.join("data").join("models").exists());
        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn sha256_streams_a_file() {
        let dir = std::env::temp_dir().join(format!("sc-cli-sha-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let p = dir.join("f");
        fs::write(&p, b"abc").unwrap();
        assert_eq!(
            sha256_of(&p).unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn state_files_round_trip_and_the_secret_is_private() {
        let home = std::env::temp_dir().join(format!("sc-cli-home-{}", std::process::id()));
        let dirs = Dirs {
            data: home.join("data"),
            cache: home.join("cache"),
            models_dir: None,
        };
        dirs.write_json("x.json", &vec![1, 2, 3]).unwrap();
        assert_eq!(dirs.read_json::<Vec<i32>>("x.json"), Some(vec![1, 2, 3]));
        assert_eq!(dirs.read_json::<Vec<i32>>("missing.json"), None);
        assert_eq!(dirs.secret_get("k").unwrap(), None);
        dirs.secret_set("k", "v").unwrap();
        assert_eq!(dirs.secret_get("k").unwrap().as_deref(), Some("v"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(dirs.data.join("secrets/k"))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o077, 0);
        }
        dirs.secret_delete("k").unwrap();
        assert_eq!(dirs.secret_get("k").unwrap(), None);
        fs::remove_dir_all(home).unwrap();
    }
}
