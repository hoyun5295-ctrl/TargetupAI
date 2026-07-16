#!/bin/bash
# ============================================================================
# 한줄로 백업 신선도 감시
#   LAST_SUCCESS 가 MAX_AGE_HOURS 이상 오래됐거나 없으면 알림.
#   → backup.sh 자체가 "아예 안 돈" 경우까지 잡는 안전망
#     (2026-04 크론 source/dash 실패로 3개월 조용히 죽었던 사고 재발 차단).
# cron (별도):  30 8 * * * /home/administrator/backups/backup-monitor.sh >> /home/administrator/backups/monitor.log 2>&1
# ============================================================================
set -euo pipefail
BACKUP_DIR="/home/administrator/backups"
MAX_AGE_HOURS=26          # 매일 03:00 백업 기준, 26h 넘으면 이상
MARK="${BACKUP_DIR}/LAST_SUCCESS"
[[ -f "${BACKUP_DIR}/.env" ]] && { set -a; source "${BACKUP_DIR}/.env"; set +a; }

msg=""
if [[ ! -f "${MARK}" ]]; then
  msg="백업 성공 기록(LAST_SUCCESS) 없음 — 한 번도 성공 못함"
else
  age_h=$(( ( $(date +%s) - $(stat -c%Y "${MARK}") ) / 3600 ))
  (( age_h > MAX_AGE_HOURS )) && msg="마지막 성공 백업이 ${age_h}시간 전 (기준 ${MAX_AGE_HOURS}h 초과)"
fi

if [[ -n "${msg}" ]]; then
  echo "[$(date '+%F %T')] ALERT: ${msg}"
  [[ -n "${ALERT_CMD:-}" ]] && ALERT_MSG="한줄로 백업 이상: ${msg}" bash -c "${ALERT_CMD}" || true
  exit 1
fi
echo "[$(date '+%F %T')] OK: 백업 신선도 정상"
