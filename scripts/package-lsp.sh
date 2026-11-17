#!/usr/bin/env bash
# Package the language server + vocabulary books into the release asset that
# the extension downloads at runtime.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="$root/dist"
tmp="$out/tmp"

rm -rf "$out"
mkdir -p "$tmp/vocab"

cp "$root/server/hover-translate-lsp.js" "$tmp/"
cp "$root"/vocab/*.json "$tmp/vocab/"

(cd "$tmp" && zip -qr "$out/hover-translate-lsp.zip" .)
rm -rf "$tmp"

echo "wrote $out/hover-translate-lsp.zip"
