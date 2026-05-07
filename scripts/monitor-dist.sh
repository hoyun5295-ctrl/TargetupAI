#!/bin/bash
# ============================================================
# D145 (2026-05-07) — frontend dist 모니터링 cron (2단 안전망)
# ============================================================
# 목적: 어떤 이유로든 dist/index.html이 사라진 경우 즉시 자동 복구.
#       atomic deploy(safe-build.sh)가 1차 안전망이지만, 만약을 대비한 2차 안전망.
#
# 설치 (서버 administrator 계정):
#   crontab -e
#   * * * * * /home/administrator/targetup-app/scripts/monitor-dist.sh >> /home/administrator/dist-monitor.log 2>&1
#
# = 1분마다 실행. 비어있으면 빌드 시도 + 로그 기록.
# ============================================================

set -uo pipefail

REPO_DIR="/home/administrator/targetup-app"
TS="$(date '+%Y-%m-%d %H:%M:%S')"

check_and_recover() {
  local pkg_name="$1"
  local pkg_dir="$REPO_DIR/packages/$1"
  local dist="$pkg_dir/dist"
  local index="$dist/index.html"

  if [ ! -d "$pkg_dir" ]; then
    return 0  # 패키지 자체 없으면 스킵
  fi

  # dist/index.html 존재 + 사이즈 > 100 검증
  if [ -f "$index" ]; then
    local size=$(stat -c %s "$index" 2>/dev/null || echo 0)
    if [ "$size" -ge 100 ]; then
      return 0  # 정상
    fi
    echo "[$TS] ⚠️  $pkg_name dist/index.html 사이즈 비정상 ($size bytes) — 자동 재빌드 시도"
  else
    echo "[$TS] 🚨 $pkg_name dist/index.html 부재! — 자동 재빌드 시도"
  fi

  # 자동 재빌드 — build:safe 우선, 없으면 build
  cd "$pkg_dir"
  if grep -q '"build:safe"' package.json 2>/dev/null; then
    npm run build:safe 2>&1 | tail -10
  else
    npm run build 2>&1 | tail -10
  fi

  if [ -f "$index" ]; then
    local new_size=$(stat -c %s "$index" 2>/dev/null || echo 0)
    echo "[$TS] ✅ $pkg_name 자동 복구 성공 ($new_size bytes)"
  else
    echo "[$TS] ❌ $pkg_name 자동 복구 실패 — 수동 개입 필요!"
    # 알림 (메일/Slack 등 연동 가능)
  fi
}

check_and_recover "frontend"
check_and_recover "company-frontend"
check_and_recover "flyer-frontend"

exit 0
