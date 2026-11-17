use std::{env, fs};
use zed_extension_api::settings::LspSettings;
use zed_extension_api::{self as zed, LanguageServerId, Worktree};

/// Language server ID; also the key used in `lsp.<id>.settings`.
const SERVER_ID: &str = "hover-translate-lsp";
/// Directory (inside the extension work dir) that holds the downloaded server.
const SERVER_DIR: &str = "lsp";
const SERVER_SCRIPT: &str = "hover-translate-lsp.js";
/// Must match the version in `extension.toml`/`Cargo.toml`; the release asset
/// is uploaded under the `v<version>` tag.
const SERVER_VERSION: &str = env!("CARGO_PKG_VERSION");
const RELEASE_BASE: &str = "https://github.com/hviwen/zedg-translate/releases/download";

struct HoverTranslateExtension;

/// Download the language server release zip into the extension work directory.
///
/// The registry does not allow bundling a language server inside the extension
/// binary, so the JS server and its vocabulary books are fetched from GitHub
/// releases on first use and cached by version.
fn ensure_server() -> zed::Result<()> {
    let cwd = env::current_dir().map_err(|e| format!("extension working directory: {e}"))?;
    let dir = cwd.join(SERVER_DIR);
    let marker = dir.join(".version");

    let up_to_date = fs::read_to_string(&marker)
        .map(|v| v.trim() == SERVER_VERSION)
        .unwrap_or(false);
    if up_to_date {
        return Ok(());
    }

    // Remove a previous download so the archive cannot leave stale files behind.
    if dir.exists() {
        fs::remove_dir_all(&dir)
            .map_err(|e| format!("remove {}: {e}", dir.display()))?;
    }
    fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;

    let url = format!("{RELEASE_BASE}/v{SERVER_VERSION}/hover-translate-lsp.zip");
    zed::download_file(&url, SERVER_DIR, zed::DownloadedFileType::Zip).map_err(|e| {
        format!(
            "failed to download the language server from {url}: {e}. \
             Check your network connection and restart the language server."
        )
    })?;

    let script = dir.join(SERVER_SCRIPT);
    if !script.exists() {
        return Err(format!(
            "the downloaded archive did not contain {}",
            script.display()
        ));
    }

    fs::write(&marker, SERVER_VERSION).map_err(|e| format!("write {}: {e}", marker.display()))?;
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

impl zed::Extension for HoverTranslateExtension {
    fn new() -> Self {
        Self
    }

    fn language_server_command(
        &mut self,
        _language_server_id: &LanguageServerId,
        worktree: &Worktree,
    ) -> zed::Result<zed::Command> {
        ensure_server()?;

        let lsp = LspSettings::for_worktree(SERVER_ID, worktree)?;

        // Allow users to override the server entirely via
        // `"lsp": { "hover-translate-lsp": { "binary": { "path": ..., "arguments": [...] } } }`.
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
            .map_err(|e| format!("extension working directory: {e}"))?
            .join(SERVER_DIR)
            .join(SERVER_SCRIPT)
            .to_string_lossy()
            .to_string();

        // Configuration comes from settings.json:
        // "lsp": { "hover-translate-lsp": { "settings": { "api_key": "...", ... } } }
        // It is passed to the server through the environment so the server
        // needs no configuration-protocol support.
        let mut env = Vec::new();
        let settings = lsp.settings;
        let pairs: &[(&str, &str)] = &[
            ("HOVER_TRANSLATE_API_KEY", "api_key"),
            ("HOVER_TRANSLATE_API_BASE", "api_base"),
            ("HOVER_TRANSLATE_MODEL", "model"),
        ];
        for (env_key, setting_key) in pairs {
            if let Some(value) = setting_str(&settings, setting_key) {
                env.push((env_key.to_string(), value));
            }
        }
        if let Some(books) = setting_list(&settings, "books") {
            env.push(("HOVER_TRANSLATE_BOOKS".to_string(), books.join(",")));
        }
        // Data directory for the translation memory. Defaults to the extension
        // work dir inside the server; an explicit override wins.
        if let Some(dir) = setting_str(&settings, "data_dir") {
            env.push(("HOVER_TRANSLATE_DATA_DIR".to_string(), dir));
        }

        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args: vec![script],
            env,
        })
    }
}

zed::register_extension!(HoverTranslateExtension);
