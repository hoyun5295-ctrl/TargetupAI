#!/bin/bash
# 감시 회차 실패 경보(systemd OnFailure) — 계속 실패해도 30분에 한 통만
set -uo pipefail
MARK=/run/bito-watchdog-failure-alert
now=$(date +%s)
last=$(cat "${MARK}" 2>/dev/null || echo 0)
[[ "${last}" =~ ^[0-9]+$ ]] || last=0
(( now - last >= 1800 )) || exit 0
echo "${now}" > "${MARK}" 2>/dev/null || true
exec /usr/local/bin/ops-alert "[비토 감시] 감시 실행 실패" "bito-agent-watchdog.service 회차가 실패했습니다(30분에 한 번만 알림). 확인: journalctl -u bito-agent-watchdog -n 50"
