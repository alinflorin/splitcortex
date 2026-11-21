//! The node's own settings (`settings.json`). An admin override from the web app wins over them, field by field.

use crate::engine::compute::{Backend, Prefs};
use serde::{Deserialize, Serialize};

pub const FILE: &str = "settings.json";
/// Bounds of a context window the user may set (tokens), the same the control plane accepts for the admin override.
pub const MIN_CONTEXT: u32 = 512;
pub const MAX_CONTEXT: u32 = 131_072;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// `auto` measures CPU against GPU once per model and takes the faster; or `cpu` / `gpu`.
    pub compute: String,
    /// Context window in tokens, 0 = automatic.
    pub max_context_tokens: u32,
    /// Keep the computer awake while serving (the screen may still turn off).
    pub keep_awake: bool,
    /// The web app address `join` enrolls against, empty = the default. Set by the installer or `config --url`.
    pub app_url: String,
    /// Folder for the model files, empty = `<data dir>/models`. `SPLITCORTEX_MODELS_DIR` wins. Absolute path.
    pub models_dir: String,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            compute: "auto".into(),
            max_context_tokens: 0,
            keep_awake: true,
            app_url: String::new(),
            models_dir: String::new(),
        }
    }
}

impl Settings {
    /// The engine preferences these settings stand for (`None` = automatic).
    pub fn prefs(&self) -> Prefs {
        Prefs {
            backend: Backend::parse(&self.compute),
            max_context_tokens: (self.max_context_tokens > 0)
                .then_some(self.max_context_tokens as i32),
            enable_mtp: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_automatic() {
        let p = Settings::default().prefs();
        assert_eq!(p, Prefs::default());
        let s = Settings {
            compute: "gpu".into(),
            max_context_tokens: 8192,
            keep_awake: false,
            app_url: String::new(),
            models_dir: String::new(),
        };
        assert_eq!(s.prefs().backend, Some(Backend::Gpu));
        assert_eq!(s.prefs().max_context_tokens, Some(8192));
    }
}
