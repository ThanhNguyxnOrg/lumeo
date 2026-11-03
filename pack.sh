#!/usr/bin/env bash
# pack.sh — build the Chrome package through the shared target builder.
# The builder uses a tracked-file allowlist, so .env, tests, docs, and local
# artefacts can never end up in the upload ZIP.
set -euo pipefail

cd "$(dirname "$0")"
VERSION="${1:-${VERSION:-$(node -p "require('./manifest.json').version")}}"
VERSION="${VERSION#v}"
OUT="$HOME/lumeo-v${VERSION}.zip"

node scripts/build-targets.mjs --targets chrome --out dist --version "$VERSION"

rm -f "$OUT"
cp "dist/lumeo-v${VERSION}-chrome.zip" "$OUT"

SIZE=$(du -h "$OUT" | cut -f1)
COUNT=$(unzip -l "$OUT" | tail -1 | awk '{print $2}')
echo "✓ Packed $OUT ($SIZE, $COUNT files)"
