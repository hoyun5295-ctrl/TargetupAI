#!/bin/bash
# ============================================================
# D145 (2026-05-07) — frontend dist 모니터링 cron (2차 안전망)
# ============================================================
# 목적: 어떤 이유로든 dist/index.html이 사라진 경우 즉시 자동 복구 + Harold님 SMS 알림.
#       atomic deploy(safe-build.sh)가 1차 안전망이지만, 만약을 대비한 2차 안전망.
#
# 알림: 자동 복구 시도 결과를 공용 경보 ops-alert(문자 + 메일)로 보낸다(★2026-10-25 R14).
#
# 설치 (서버 administrator 계정 · git 이 실행 비트를 안 실어 bash 로 부른다):
#   crontab -e
#   * * * * * /bin/bash /home/administrator/targetup-app/scripts/monitor-dist.sh >> /home/administrator/dist-monitor.log 2>&1
# ============================================================

set -uo pipefail

REPO_DIR="/home/administrator/targetup-app"
TS="$(date '+%Y-%m-%d %H:%M:%S')"
# 경보 = 공용 입구 ops-alert(문자 + 메일 · ROOT-LEDGER R14). 예전 localhost:3000 한 길은 백엔드가 죽으면 같이 죽었다.
OPS_ALERT="${OPS_ALERT:-/usr/local/bin/ops-alert}"

# === 알림 발송 함수 ===
send_admin_alert() {
  local msg="$1"
  if [ -x "$OPS_ALERT" ]; then
    "$OPS_ALERT" "한줄로 화면 배포 감시" "$msg" && echo "[$TS] 알림 발송 완료" || echo "[$TS] 알림 발송 실패(문자 · 메일 둘 다)"
  else
    echo "[$TS] 공용 경보($OPS_ALERT) 없음 — 알림을 못 보냄"
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
# 2026-07-18 company-frontend 폐기(관리자 화면 차단·패키지 제거) — 감시 대상에서 제외
# 2026-10-25 flyer-frontend 폐기(전단AI = hanjulDM 별도 프로젝트) — 감시 대상에서 제외

exit 0
