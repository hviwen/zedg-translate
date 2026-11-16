use std::{env, fs};
use zed_extension_api::settings::LspSettings;
use zed_extension_api::{self as zed, LanguageServerId, Worktree};

const SERVER_ID: &str = "zedg-translate";
const SERVER_SCRIPT: &str = "zedg-translate-lsp.js";

/// Files written into the extension's working directory on startup.
/// The JS server reads vocab files relative to its own path.
const ASSETS: &[(&str, &str)] = &[
    (
        SERVER_SCRIPT,
        include_str!("../server/zedg-translate-lsp.js"),
    ),
    ("vocab/gaokao.json", include_str!("../vocab/gaokao.json")),
    ("vocab/cet4.json", include_str!("../vocab/cet4.json")),
    (
        "vocab/computing.json",
        include_str!("../vocab/computing.json"),
    ),
    ("vocab/ogden.json", include_str!("../vocab/ogden.json")),
];

struct ZedgTranslateExtension;

/// Write embedded assets when missing or stale.
fn ensure_assets() -> zed::Result<()> {
    let cwd = env::current_dir().expect("extension working directory");
    for (rel, content) in ASSETS {
        let path = cwd.join(rel);
        let stale = match fs::read_to_string(&path) {
            Ok(existing) => existing != *content,
            Err(_) => true,
        };
        if stale {
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("create dir {}: {e}", parent.display()))?;
            }
            fs::write(&path, content).map_err(|e| format!("write {}: {e}", path.display()))?;
        }
    }
    Ok(())
}

/// Pull a string setting out of `lsp.<server>.settings` in settings.json.
fn setting_str(settings: &Option<zed::serde_json::Value>, key: &str) -> Option<String> {
    settings.as_ref()?.get(key)?.as_str().map(str::to_owned)
}

/// Pull a string array setting (e.g. `books = ["gaokao", "cet4"]`).
fn setting_list(settings: &Option<zed::serde_json::Value>, key: &str) -> Option<Vec<String>> {
    let v = settings.as_ref()?.get(key)?;
    Some(
        v.as_array()?
            .iter()
            .filter_map(|x| x.as_str().map(str::to_owned))
            .collect(),
    )
}

impl zed::Extension for ZedgTranslateExtension {
    fn new() -> Self {
        Self
    }

    fn language_server_command(
        &mut self,
        _language_server_id: &LanguageServerId,
        worktree: &Worktree,
    ) -> zed::Result<zed::Command> {
        ensure_assets()?;

        let lsp = LspSettings::for_worktree(SERVER_ID, worktree)?;

        // Allow users to override the binary entirely via
        // `"lsp": { "zedg-translate": { "binary": { "path": ..., "arguments": [...] } } }`.
        if let Some(binary) = lsp.binary {
            if let Some(path) = binary.path {
                return Ok(zed::Command {
                    command: path,
                    args: binary.arguments.unwrap_or_default(),
                    env: Default::default(),
                });
            }
        }

        let script = env::current_dir()
            .unwrap()
            .join(SERVER_SCRIPT)
            .to_string_lossy()
            .to_string();

        // Configuration comes from settings.json:
        // "lsp": { "zedg-translate": { "settings": { "api_key": "...", ... } } }
        // It is passed to the server through the environment so the server
        // needs no configuration-protocol support.
        let mut env = Vec::new();
        let settings = lsp.settings;
        let pairs: &[(&str, &str)] = &[
            ("ZEDG_TRANSLATE_API_KEY", "api_key"),
            ("ZEDG_TRANSLATE_API_BASE", "api_base"),
            ("ZEDG_TRANSLATE_MODEL", "model"),
        ];
        for (env_key, setting_key) in pairs {
            if let Some(value) = setting_str(&settings, setting_key) {
                env.push((env_key.to_string(), value));
            }
        }
        if let Some(books) = setting_list(&settings, "books") {
            env.push(("ZEDG_TRANSLATE_BOOKS".to_string(), books.join(",")));
        }
        // Data directory for the translation memory; defaults are resolved
        // inside the server script, but an explicit override wins.
        if let Some(dir) = setting_str(&settings, "data_dir") {
            env.push(("ZEDG_TRANSLATE_DATA_DIR".to_string(), dir));
        }

        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args: vec![script],
            env,
        })
    }
}

zed::register_extension!(ZedgTranslateExtension);
