# Hover Translate

A Zed extension that translates between English and Chinese in the native hover
popup, powered by any OpenAI-compatible LLM, with a local translation memory and
offline vocabulary books.

## Features

| Feature | How it works |
|---|---|
| EN ↔ ZH translation | Direction is auto-detected: CJK text at the cursor → ZH → EN, otherwise EN → ZH |
| Hover bubble | Native LSP hover popup in the editor |
| LLM | OpenAI-compatible `/chat/completions` (DeepSeek by default), key configured in `settings.json` |
| Translation memory | Every lookup is appended to `memory.jsonl`; `stats.md` summarizes totals, the last 7 days and frequent terms |
| Vocabulary books (optional) | Gaokao 3743 / CET-4 4544 / Computing 260 / Ogden 850 entries, shown as tags in the bubble and as coverage in the stats file |

Lookup order: **memory hit → instant reply** (no network request); **without an
API key the vocabulary books still translate offline**; otherwise the LLM is
called.

## Installation

From the registry: open the Extensions view in Zed, search for `Hover Translate`
and click Install.

For development: run `zed: install dev extension` from the command palette and
select this directory. Building requires [rustup](https://rustup.rs); Zed
installs the `wasm32-wasip2` target automatically. The language server itself is
downloaded from this repository's GitHub releases on first use and cached in the
extension's working directory.

## Configuration

Add the following to `~/.config/zed/settings.json` (or use the Settings UI):

```json
{
  "lsp": {
    "hover-translate-lsp": {
      "settings": {
        "api_key": "sk-your-api-key",
        "api_base": "https://api.deepseek.com",
        "model": "deepseek-chat",
        "books": ["gaokao", "cet4", "computing"]
      }
    }
  }
}
```

- `api_base` / `model` — any OpenAI-compatible endpoint works, e.g. Zhipu
  `https://open.bigmodel.cn/api/paas/v4` with `glm-4-flash`.
- `books` — any of `gaokao`, `cet4`, `computing`, `ogden`; all four are enabled
  by default.
- `data_dir` — optional absolute path for the translation memory. By default the
  memory lives in the extension's working directory, which may be replaced when
  the extension is updated; set this to keep it, and to know where `stats.md`
  is written.
- `binary` — optional, lets you point the extension at your own server copy
  instead of the downloaded one.

Restart the server after changing settings: `editor: restart language servers`.

## Usage

Hover a word or phrase (no selection required in stock Zed) and the bubble shows:

```
### abandon　*`EN → ZH`*
/əˈbændən/
**v. 放弃**　**n. 放任；狂热**
`Gaokao` `CET-4`
> The plan was abandoned.  计划被放弃了。
```

The translation itself is naturally in the target language; all UI text is
English.

Default books: `gaokao`, `cet4`, `computing`, `ogden` (Ogden 850 basic English,
sourced from ogden.munch.love).

The stats file contains the total number of translations, unique terms, a 7-day
trend, the top 20 terms and per-book coverage (translated words ÷ total words).

## Supported languages

The `languages = [...]` list in `extension.toml` controls where hover
translation is active (44 languages, including Markdown, Python, Rust, Go,
TypeScript, JSON, YAML and TOML). After changing it, reinstall the extension.

## How the language server is packaged

Zed's extension registry does not allow bundling a language server inside the
extension binary, so `src/lib.rs` downloads
`hover-translate-lsp.zip` from the release tagged `v<version>` into the
extension work directory (`lsp/`) and then starts it with Zed's bundled Node.
Releases are produced by `.github/workflows/release.yml`; to build the archive
locally run `./scripts/package-lsp.sh`.

## Project layout

```
extension.toml                  # extension manifest (language server registration)
src/lib.rs                      # WASM extension: downloads the server, reads settings, returns the node command
server/hover-translate-lsp.js   # LSP server (no dependencies, runs on Zed's bundled Node)
vocab/*.json                    # vocabulary data
scripts/gen_vocab.py            # regenerate the vocabulary books
scripts/e2e.js                  # end-to-end test (mock LLM driving the LSP server)
scripts/package-lsp.sh          # build dist/hover-translate-lsp.zip for a release
```

## Development

```sh
node scripts/e2e.js                               # mock LLM, full hover → translate → memory → stats flow
cargo build --target wasm32-wasip2 --release      # optional, Zed builds the extension itself
./scripts/package-lsp.sh                          # produce the release asset
```

## Limitations

- **Stock Zed**: the LSP hover request carries no selection information, so the
  bubble appears on any hover and translates the word or phrase under the
  cursor.
- **ZedG fork**: if the host sends the `zedg/selectionChanged` notification
  (see `fork/`), hovering inside a non-empty selection translates the whole
  selected text and hovering elsewhere shows nothing. Hosts that never send the
  notification automatically fall back to the regular hover behavior.
- The first translation of a term waits for the LLM (about 1–3 s); later
  lookups come from the memory instantly.
- The stats file is written with a 500 ms debounce after each translation.

## Privacy

Only the term or phrase under the cursor (or the selected text) and the
translation direction are sent to the `api_base` you configure. The translation
memory, vocabulary data and statistics stay on your machine. The extension has
no telemetry.

## License

MIT
