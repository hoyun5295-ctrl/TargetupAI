#!/bin/bash
# ============================================================
# D145 (2026-05-07) — Atomic deploy 패턴 (company-frontend)
# ============================================================
# packages/frontend/scripts/safe-build.sh와 동일 로직.
# 자세한 설명은 frontend 측 스크립트 헤더 참조.
# ============================================================

set -euo pipefail

cd "$(dirname "$0")/.."

FRONTEND_DIR="$(pwd)"
DIST_DIR="$FRONTEND_DIR/dist"
DIST_NEW="$FRONTEND_DIR/dist-new"
DIST_OLD="$FRONTEND_DIR/dist-old"

echo "════════════════════════════════════════════════════════════"
echo "[atomic-build:company] safe build 시작 — $(date '+%Y-%m-%d %H:%M:%S')"
echo "[atomic-build:company] 작업 폴더: $FRONTEND_DIR"
echo "════════════════════════════════════════════════════════════"

if [ -d "$DIST_NEW" ]; then
  rm -rf "$DIST_NEW"
fi

npx tsc
npx vite build --outDir dist-new

if [ ! -f "$DIST_NEW/index.html" ]; then
  echo "❌ [atomic-build:company] 빌드 실패 — dist-new/index.html 없음 / 옛 dist 유지"
  rm -rf "$DIST_NEW"
  exit 1
fi

INDEX_SIZE=$(stat -c %s "$DIST_NEW/index.html" 2>/dev/null || stat -f %z "$DIST_NEW/index.html")
if [ "$INDEX_SIZE" -lt 100 ]; then
  echo "❌ [atomic-build:company] 빌드 실패 — index.html 사이즈 비정상 ($INDEX_SIZE bytes)"
  rm -rf "$DIST_NEW"
  exit 1
fi

if [ ! -d "$DIST_NEW/assets" ]; then
  echo "❌ [atomic-build:company] assets 폴더 없음 / 옛 dist 유지"
  rm -rf "$DIST_NEW"
  exit 1
fi

if [ -d "$DIST_OLD" ]; then rm -rf "$DIST_OLD"; fi
if [ -d "$DIST_DIR" ]; then mv "$DIST_DIR" "$DIST_OLD"; fi
mv "$DIST_NEW" "$DIST_DIR"

echo "✅ [atomic-build:company] swap 완료 ($INDEX_SIZE bytes)"
exit 0
