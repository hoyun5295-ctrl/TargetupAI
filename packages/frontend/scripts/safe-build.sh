#!/bin/bash
# ============================================================
# D145 (2026-05-07) — Atomic deploy 패턴
# ============================================================
# 목적: vite build 실패 시에도 옛 dist 그대로 유지하여 사이트 차단 0초 보장.
#
# D145 사고 (2026-05-06 18:54 ~ 5/7 04:00 = 9시간 거래처 차단):
#   - tp-deploy-full → npm run build → vite는 emptyOutDir: true(기본)로 dist 비움
#   - 어떤 이유로 빌드 도중 비정상 종료 → dist 비어있는 상태로 끝
#   - nginx 403 "directory index of dist/ is forbidden" 9시간
#
# 해결:
#   1. 빌드를 별도 폴더(dist-new)에 수행 → vite emptyOutDir이 dist-new만 비움
#   2. 빌드 성공(index.html 생성) 검증 후에만 dist로 atomic mv (swap)
#   3. 빌드 실패 시 dist-new 청소 + 옛 dist 그대로 유지 → 사이트 정상 작동 지속
# ============================================================

set -euo pipefail

# 스크립트 위치 → frontend 폴더로 이동
cd "$(dirname "$0")/.."

FRONTEND_DIR="$(pwd)"
DIST_DIR="$FRONTEND_DIR/dist"
DIST_NEW="$FRONTEND_DIR/dist-new"
DIST_OLD="$FRONTEND_DIR/dist-old"
TS="$(date +%Y%m%d-%H%M%S)"

echo "════════════════════════════════════════════════════════════"
echo "[atomic-build] frontend safe build 시작 — $(date '+%Y-%m-%d %H:%M:%S')"
echo "[atomic-build] 작업 폴더: $FRONTEND_DIR"
echo "════════════════════════════════════════════════════════════"

# ★ D151-6 (2026-05-11): devDependencies 누락 자동 차단 안전망
#   운영 서버 NODE_ENV=production 이면 npm install이 devDependencies skip → tsc/vite 빌드 차단
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

# 1. TypeScript 체크 + Vite 빌드 → dist-new 폴더로
echo "[atomic-build] TypeScript 체크 시작..."
npx tsc

echo "[atomic-build] Vite 빌드 시작 → dist-new"
npx vite build --outDir dist-new

# 2. 빌드 성공 검증 — dist-new/index.html 존재 + 사이즈 > 0
if [ ! -f "$DIST_NEW/index.html" ]; then
  echo "❌ [atomic-build] 빌드 실패 — dist-new/index.html 없음"
  echo "   옛 dist 그대로 유지 (사이트 차단 0초)"
  rm -rf "$DIST_NEW"
  exit 1
fi

INDEX_SIZE=$(stat -c %s "$DIST_NEW/index.html" 2>/dev/null || stat -f %z "$DIST_NEW/index.html")
if [ "$INDEX_SIZE" -lt 100 ]; then
  echo "❌ [atomic-build] 빌드 실패 — dist-new/index.html 사이즈 비정상 ($INDEX_SIZE bytes)"
  echo "   옛 dist 그대로 유지"
  rm -rf "$DIST_NEW"
  exit 1
fi

# 3. assets 폴더 검증 (vite chunk 누락 방지)
if [ ! -d "$DIST_NEW/assets" ]; then
  echo "⚠️  [atomic-build] dist-new/assets 폴더 없음 — chunk 누락 의심"
  echo "   안전을 위해 빌드 실패 처리 + 옛 dist 유지"
  rm -rf "$DIST_NEW"
  exit 1
fi

# 4. atomic swap — 옛 dist 백업 + dist-new를 dist로 rename
if [ -d "$DIST_OLD" ]; then
  rm -rf "$DIST_OLD"
fi

if [ -d "$DIST_DIR" ]; then
  mv "$DIST_DIR" "$DIST_OLD"
fi

mv "$DIST_NEW" "$DIST_DIR"

echo "════════════════════════════════════════════════════════════"
echo "✅ [atomic-build] 빌드 성공 + atomic swap 완료"
echo "   index.html: $DIST_DIR/index.html ($INDEX_SIZE bytes)"
echo "   옛 dist 백업: $DIST_OLD (다음 빌드 시 자동 정리)"
echo "════════════════════════════════════════════════════════════"
exit 0
