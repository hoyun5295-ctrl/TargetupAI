#!/bin/bash
# ============================================================
# D145+ (2026-05-07) — Atomic deploy 패턴 (backend)
# ============================================================
# frontend safe-build.sh 미러 (D145 사고 재발 방지 인프라 backend 확장)
#
# 목적: tsc 빌드 실패 시에도 옛 dist 그대로 유지 → pm2 restart 시점 안전.
#
# 동작:
#   1. tsc 빌드를 별도 폴더(dist-new)로 수행
#   2. dist-new/app.js 존재 + 사이즈 > 100 + routes/utils 폴더 검증
#   3. 검증 통과 → 옛 dist를 dist-old로 백업 + dist-new를 dist로 atomic mv
#   4. 검증 실패 → dist-new 청소 + 옛 dist 그대로 유지
# ============================================================

set -euo pipefail

cd "$(dirname "$0")/.."

BACKEND_DIR="$(pwd)"
DIST_DIR="$BACKEND_DIR/dist"
DIST_NEW="$BACKEND_DIR/dist-new"
DIST_OLD="$BACKEND_DIR/dist-old"

echo "════════════════════════════════════════════════════════════"
echo "[atomic-build] backend safe build 시작 — $(date '+%Y-%m-%d %H:%M:%S')"
echo "[atomic-build] 작업 폴더: $BACKEND_DIR"
echo "════════════════════════════════════════════════════════════"

# ★ D151-6 (2026-05-11): devDependencies 누락 자동 차단 안전망
#   운영 서버 NODE_ENV=production 이면 npm install이 devDependencies skip → tsc 빌드 차단
#   사고: D151-2 backend 1310 tsc 에러 / D151-4 frontend 21,328 tsc 에러 동일 패턴 반복 발생
#   대책: typescript 누락 시 자동으로 npm install --include=dev 선행 → 운영 사이클 안전망
if [ ! -d "node_modules/typescript" ]; then
  echo "[atomic-build] ⚠️  devDependencies 누락 감지 (node_modules/typescript 없음)"
  echo "[atomic-build] 자동 복구: npm install --include=dev 실행"
  npm install --include=dev
fi

# 0. 잔존 dist-new 청소 (이전 빌드 실패 잔존물)
if [ -d "$DIST_NEW" ]; then
  echo "[atomic-build] 잔존 dist-new 청소"
  rm -rf "$DIST_NEW"
fi

# 1. tsc 빌드 → dist-new 폴더로
echo "[atomic-build] tsc 빌드 시작 → dist-new"
npx tsc --outDir dist-new

# 2. 빌드 성공 검증 — dist-new/app.js 존재 + 사이즈 > 100
if [ ! -f "$DIST_NEW/app.js" ]; then
  echo "❌ [atomic-build] 빌드 실패 — dist-new/app.js 없음"
  echo "   옛 dist 그대로 유지 (pm2 restart 시점 안전)"
  rm -rf "$DIST_NEW"
  exit 1
fi

APP_SIZE=$(stat -c %s "$DIST_NEW/app.js" 2>/dev/null || stat -f %z "$DIST_NEW/app.js")
if [ "$APP_SIZE" -lt 100 ]; then
  echo "❌ [atomic-build] 빌드 실패 — dist-new/app.js 사이즈 비정상 ($APP_SIZE bytes)"
  echo "   옛 dist 그대로 유지"
  rm -rf "$DIST_NEW"
  exit 1
fi

# 3. routes/utils 폴더 검증 (tsc chunk 누락 방지)
if [ ! -d "$DIST_NEW/routes" ] || [ ! -d "$DIST_NEW/utils" ]; then
  echo "⚠️  [atomic-build] dist-new/routes 또는 utils 폴더 없음 — 빌드 누락 의심"
  echo "   안전을 위해 빌드 실패 처리 + 옛 dist 유지"
  rm -rf "$DIST_NEW"
  exit 1
fi

# 4. atomic swap — 옛 dist 백업 + dist-new를 dist로 mv
if [ -d "$DIST_OLD" ]; then
  rm -rf "$DIST_OLD"
fi

if [ -d "$DIST_DIR" ]; then
  mv "$DIST_DIR" "$DIST_OLD"
fi

mv "$DIST_NEW" "$DIST_DIR"

echo "════════════════════════════════════════════════════════════"
echo "✅ [atomic-build] 빌드 성공 + atomic swap 완료"
echo "   app.js: $DIST_DIR/app.js ($APP_SIZE bytes)"
echo "   옛 dist 백업: $DIST_OLD (다음 빌드 시 자동 정리)"
echo "════════════════════════════════════════════════════════════"
echo "[atomic-build] pm2 restart로 새 dist 적용:"
echo "   pm2 restart all"
exit 0
