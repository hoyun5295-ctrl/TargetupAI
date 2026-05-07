#!/bin/bash
# D145 (2026-05-07) — Atomic deploy 패턴 (flyer-frontend)
set -euo pipefail
cd "$(dirname "$0")/.."

DIST_DIR="$(pwd)/dist"
DIST_NEW="$(pwd)/dist-new"
DIST_OLD="$(pwd)/dist-old"

echo "[atomic-build:flyer] $(date '+%Y-%m-%d %H:%M:%S')"

if [ -d "$DIST_NEW" ]; then rm -rf "$DIST_NEW"; fi

npx tsc -b
npx vite build --outDir dist-new

if [ ! -f "$DIST_NEW/index.html" ]; then
  echo "❌ [flyer] index.html 없음 / 옛 dist 유지"
  rm -rf "$DIST_NEW"; exit 1
fi

INDEX_SIZE=$(stat -c %s "$DIST_NEW/index.html" 2>/dev/null || stat -f %z "$DIST_NEW/index.html")
if [ "$INDEX_SIZE" -lt 100 ]; then
  echo "❌ [flyer] index.html 비정상 사이즈 / 옛 dist 유지"
  rm -rf "$DIST_NEW"; exit 1
fi

if [ ! -d "$DIST_NEW/assets" ]; then
  echo "❌ [flyer] assets 없음 / 옛 dist 유지"
  rm -rf "$DIST_NEW"; exit 1
fi

if [ -d "$DIST_OLD" ]; then rm -rf "$DIST_OLD"; fi
if [ -d "$DIST_DIR" ]; then mv "$DIST_DIR" "$DIST_OLD"; fi
mv "$DIST_NEW" "$DIST_DIR"

echo "✅ [flyer] swap 완료 ($INDEX_SIZE bytes)"
exit 0
