# ZedG fork patch: selection-gated translation bubbles

`zedg-selection-hover.patch` applies cleanly to the ZedG v1.28.1 source tree
(`zedg-zh-cn-source-v1.28.1.tar.gz`, which already includes the Chinese
localization patch).

## What it changes

| File | Change |
|---|---|
| `crates/editor/src/hover_popover.rs` | On `show_hover`, check whether the hover position lies inside a non-empty selection and send the selected text (or nothing) to the `hover-translate-lsp` server via `zedg/selectionChanged`, before the hover request |
| `crates/project/src/project.rs` | Adds `Project::notify_zedg_selection` |
| `crates/project/src/lsp_store.rs` | Adds `LspStore::notify_zedg_selection`, which locates the buffer's `hover-translate-lsp` server and sends a FIFO notification |
| `crates/project/src/lsp_command.rs` | Defines the `zedg/selectionChanged` notification (uri + text) |

## Behavior

- Text selected (drag or double-click) and the pointer hovers inside the
  selection → the bubble translates the whole selected text.
- No selection, or hovering outside it → the server receives an empty
  notification and shows nothing.
- Hosts without this patch never send the notification, so the extension falls
  back to per-word hover automatically.

## Applying and building

```sh
# 1. Unpack the source tarball and apply the patch
tar -xzf zedg-zh-cn-source-v1.28.1.tar.gz zed-src && cd zed-src
git apply /path/to/zedg-selection-hover.patch

# 2. Build (rust-toolchain.toml pins 1.98.1; rustup installs it)
RELEASE_CHANNEL=stable cargo build --release --package zed --package cli \
  --target aarch64-apple-darwin

# 3. Assemble the .app (reuse the packaging section of ZedG's 98-macos-release.yml;
#    Info.plist = dev.zed.ZedG)
```

Verified with `cargo check -p project -p editor` (1.98.1).

> The server name in the patch is `hover-translate-lsp`, matching the language
> server ID in `extension.toml`. If you build ZedG against an older revision of
> this patch that matched `zedg-translate`, re-apply this patch and rebuild.
