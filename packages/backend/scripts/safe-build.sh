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
# ★ 2026-11-11 (뿌리 R88) 두 번째 빌드 — 한 번만 깨진 산출물을 가르는 대조용. 끼우지 않고 검증 뒤 지운다.
DIST_NEW2="$BACKEND_DIR/dist-new2"

# ★ 2026-11-11 (R88 · Codex 1R · 2R) 판 잠금 — 빌드와 자동 복구 감시(backend-watchdog)가 판 폴더를 같은 때에 읽고 옮기지 않게 한다.
#   둘이 따로 보면 감시기가 읽은 뒤 빌드가 판을 끼워, 감시기가 방금 끼운 수리 판을 실패한 판으로 옮길 수 있다. 두 빌드가 겹치는 것도 막는다.
#   커널 잠금(flock)이다 — 쥔 프로세스가 끝나면 저절로 풀려 묵은 잠금이 남지 않는다
#   (폴더 잠금 + 묵은 것 걷기는 둘이 동시에 걷을 때 한쪽이 상대의 새 잠금을 지워 둘 다 들어간다 · Codex 2R).
#   감시기 한 회차(1분 안쪽)는 기다린다. 서버(Linux)에 flock 이 없으면 빌드하지 않는다. 개발 PC(Windows)에는 감시기가 없어 잠금 없이 간다.
DIST_LOCK="$BACKEND_DIR/.dist.lock"
if command -v flock >/dev/null 2>&1; then
  exec 9>"$DIST_LOCK"
  if ! flock -w "${DIST_LOCK_WAIT_S:-90}" 9; then
    echo "❌ [atomic-build] 다른 빌드 또는 자동 복구가 판 잠금을 쥐고 있습니다 — 끝난 뒤 다시 실행"
    exit 1
  fi
elif [ "$(uname -s)" = "Linux" ]; then
  echo "❌ [atomic-build] flock 이 없습니다 — 판 잠금 없이 빌드하지 않습니다(util-linux 확인)"
  exit 1
fi

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
if [ -d "$DIST_NEW2" ]; then
  echo "[atomic-build] 잔존 dist-new2 청소"
  rm -rf "$DIST_NEW2"
fi

# 1. tsc 빌드 → dist-new 폴더로
echo "[atomic-build] tsc 빌드 시작 → dist-new"
# ★ 2026-11-11 실패하면 dist-new 를 남기지 않는다 — 남은 dist-new 는 자동 복구 감시(backend-watchdog)가 「빌드 중」으로 읽는다.
if ! npx tsc --outDir dist-new; then
  echo "❌ [atomic-build] 빌드 실패(tsc) — 옛 dist 그대로 유지"
  rm -rf "$DIST_NEW"
  exit 1
fi

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

# 3-1. ★ 2026-11-11 판 검증 (뿌리 R88) — 운영이 dist 를 직접 실행하므로 끼우기 전에 판 자체를 본다.
#   경위: 11-10 22:46 빌드가 routes/billing.js 에 소스 원문 120줄이 끼어든 판을 냈고(같은 커밋 재빌드는 정상),
#   위 2 · 3 은 app.js · 폴더만 봐서 그대로 끼워졌다 → 재시작에서 부팅 실패 · 22:47 ~ 08:38 정지.
#   같은 소스를 한 번 더 빌드해 두 판이 파일 하나까지 같고, .js 전부가 node 문법 검사를 통과할 때만 끼운다.
echo "[atomic-build] 두 번째 빌드(대조용) → dist-new2"
if ! npx tsc --outDir dist-new2; then
  echo "❌ [atomic-build] 두 번째 빌드 실패 — 옛 dist 그대로 유지"
  rm -rf "$DIST_NEW" "$DIST_NEW2"
  exit 1
fi
if ! node scripts/verify-dist.js "$DIST_NEW" "$DIST_NEW2"; then
  echo "❌ [atomic-build] 판 검증 실패 — 문법 오류 또는 두 빌드가 서로 다름"
  echo "   옛 dist 그대로 유지 (끼우지 않음). 위 [verify-dist] 줄을 확인하고 다시 빌드"
  rm -rf "$DIST_NEW" "$DIST_NEW2"
  exit 1
fi
rm -rf "$DIST_NEW2"

# 4. atomic swap — 옛 dist 백업 + dist-new를 dist로 mv
if [ -d "$DIST_OLD" ]; then
  rm -rf "$DIST_OLD"
fi

if [ -d "$DIST_DIR" ]; then
  mv "$DIST_DIR" "$DIST_OLD"
fi

mv "$DIST_NEW" "$DIST_DIR"
# ★ 2026-11-11 끼운 시각 표식 — 감시기가 「이 프로세스가 이 판으로 시작했는가」를 (표식 시각 <= 기동 시각)으로 가른다.
#   끼운 뒤에 찍는다: 끼우기 전에 시작한 프로세스(옛 판을 읽음)가 새 판을 읽은 것으로 판정되지 않는다. 잠금 안이라 그 사이 감시기는 돌지 않는다.
touch "$DIST_DIR/.installed"

echo "════════════════════════════════════════════════════════════"
echo "✅ [atomic-build] 빌드 성공 + atomic swap 완료"
echo "   app.js: $DIST_DIR/app.js ($APP_SIZE bytes)"
echo "   옛 dist 백업: $DIST_OLD (다음 빌드 시 자동 정리)"
echo "════════════════════════════════════════════════════════════"
echo "[atomic-build] pm2 restart로 새 dist 적용:"
echo "   pm2 restart all"
exit 0
