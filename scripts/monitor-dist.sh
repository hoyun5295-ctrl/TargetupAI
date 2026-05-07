#!/bin/bash
# ============================================================
# D145 (2026-05-07) — frontend dist 모니터링 cron (2차 안전망)
# ============================================================
# 목적: 어떤 이유로든 dist/index.html이 사라진 경우 즉시 자동 복구 + Harold님 SMS 알림.
#       atomic deploy(safe-build.sh)가 1차 안전망이지만, 만약을 대비한 2차 안전망.
#
# 알림: 자동 복구 시도 결과를 010-5295-8517로 SMS (LMS) 발송.
#       backend localhost:3000/api/internal/dist-alert 호출 (사전테스트 라인 사용).
#
# 설치 (서버 administrator 계정):
#   crontab -e
#   * * * * * /home/administrator/targetup-app/scripts/monitor-dist.sh >> /home/administrator/dist-monitor.log 2>&1
# ============================================================

set -uo pipefail

REPO_DIR="/home/administrator/targetup-app"
TS="$(date '+%Y-%m-%d %H:%M:%S')"
ALERT_URL="http://127.0.0.1:3000/api/internal/dist-alert"

# === 알림 발송 함수 (backend localhost SMS API 호출) ===
send_admin_alert() {
  local msg="$1"
  # JSON escape (개행 → \\n, " → \\")
  local escaped=$(printf '%s' "$msg" | sed 's/\\/\\\\/g; s/"/\\"/g; s/$/\\n/' | tr -d '\n' | sed 's/\\n$//')
  local response
  response=$(curl -X POST "$ALERT_URL" \
    -H "Content-Type: application/json" \
    -d "{\"message\":\"${escaped}\"}" \
    --max-time 10 \
    --silent --output /dev/null --write-out "%{http_code}" 2>/dev/null) || response="000"
  if [ "$response" = "200" ]; then
    echo "[$TS] 📱 SMS 알림 발송 완료 (HTTP 200)"
  else
    echo "[$TS] ⚠️  SMS 알림 발송 실패 (HTTP $response — backend down?)"
  fi
}

# === 빌드 + 알림 + 자동 복구 ===
check_and_recover() {
  local pkg_name="$1"
  local pkg_dir="$REPO_DIR/packages/$pkg_name"
  local dist="$pkg_dir/dist"
  local index="$dist/index.html"

  if [ ! -d "$pkg_dir" ]; then
    return 0  # 패키지 없으면 스킵
  fi

  # 1. dist/index.html 존재 + 사이즈 검증
  if [ -f "$index" ]; then
    local size=$(stat -c %s "$index" 2>/dev/null || echo 0)
    if [ "$size" -ge 100 ]; then
      return 0  # 정상 — 알림 없음
    fi
    echo "[$TS] ⚠️  $pkg_name dist/index.html 사이즈 비정상 ($size bytes) — 자동 재빌드 시도"
  else
    echo "[$TS] 🚨 $pkg_name dist/index.html 부재! — 자동 재빌드 시도"
  fi

  # 2. 자동 재빌드 — build:safe 우선, 없으면 build
  cd "$pkg_dir"
  local build_log
  if grep -q '"build:safe"' package.json 2>/dev/null; then
    build_log=$(npm run build:safe 2>&1 | tail -5)
  else
    build_log=$(npm run build 2>&1 | tail -5)
  fi

  # 3. 결과 검증 + 알림
  if [ -f "$index" ]; then
    local new_size=$(stat -c %s "$index" 2>/dev/null || echo 0)
    if [ "$new_size" -ge 100 ]; then
      echo "[$TS] ✅ $pkg_name 자동 복구 성공 ($new_size bytes)"
      send_admin_alert "${pkg_name} dist/index.html 부재 감지됨 → 자동 복구 성공 (${new_size} bytes). 사이트 정상 작동."
      return 0
    fi
  fi

  echo "[$TS] ❌ $pkg_name 자동 복구 실패 — 수동 개입 필요!"
  echo "[$TS]    빌드 로그: $build_log"
  send_admin_alert "🚨 ${pkg_name} dist/index.html 부재 + 자동 복구 실패. 즉시 SSH 확인 필요! 빌드 로그: ${build_log}"
}

check_and_recover "frontend"
check_and_recover "company-frontend"
check_and_recover "flyer-frontend"

exit 0
