#!/usr/bin/env bash
# pack.sh — bundle Lumeo into a zip ready for Web Store upload or beta sideload.
# Reads the version from manifest.json so the output filename auto-tracks bumps.
set -euo pipefail

cd "$(dirname "$0")"
VERSION=$(node -p "require('./manifest.json').version")
OUT="$HOME/lumeo-v${VERSION}.zip"

rm -f "$OUT"
zip -rq "$OUT" . \
  -x "*.DS_Store" "node_modules/*" ".git/*" "*.swp" "Thumbs.db" "pack.sh" \
     "release.sh" "echoly-main.zip" "_echoly_extracted/*" "*.zip"

SIZE=$(du -h "$OUT" | cut -f1)
COUNT=$(unzip -l "$OUT" | tail -1 | awk '{print $2}')
echo "✓ Packed $OUT ($SIZE, $COUNT files)"
