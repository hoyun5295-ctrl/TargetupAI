#!/bin/bash
# ============================================================================
# 한줄로 암호화 백업 (PG + MySQL)
#   dump → gzip → GPG 공개키 암호화 → 로컬(62) + 오프사이트(59)
#   복호화는 Harold 개인키(오프라인)로만 가능. 서버엔 공개키만 존재.
#   → 서버/59/클라우드가 털려도 암호문뿐이라 아무도 못 엶.
#
# repo 버전관리 대상. 서버 배포:
#   cp scripts/backup.sh /home/administrator/backups/backup.sh && chmod +x
# cron (SHELL=/bin/bash 전제, source 없이 직접 호출):
#   0 3 * * * /home/administrator/backups/backup.sh >> /home/administrator/backups/cron.log 2>&1
# ============================================================================
set -euo pipefail

### ── 설정 ────────────────────────────────────────────────────────────────
GPG_RECIPIENT="EFF068D19AE32B3D305C7CE145C04B07D3CFBFA1"   # Hanjul Backup 공개키 지문
BACKUP_DIR="/home/administrator/backups"

PG_CONTAINER="targetup-postgres"; PG_USER="targetup"; PG_DB="targetup"
MYSQL_CONTAINER="targetup-mysql"; MYSQL_USER="smsuser"; MYSQL_DB="smsdb"
# MYSQL_BACKUP_PASS, ALERT_CMD 는 ${BACKUP_DIR}/.env 에서 로드 (chmod 600)

# 오프사이트 (59, backup 키). 암호문이라 59 접근자가 봐도 평문 노출 0.
REMOTE_HOST="58.227.193.59"; REMOTE_PORT="27616"; REMOTE_USER="backup"
REMOTE_PATH="/home/backup/targetup"; SSH_KEY="/home/administrator/.ssh/id_rsa_backup"

LOCAL_RETENTION_DAYS=7
MIN_PG_BYTES=1000000       # 1MB 미만 = 빈/실패 덤프로 간주 (20바이트 사고 재발 차단)
MIN_MYSQL_BYTES=10000      # 10KB 미만 = 빈/실패 덤프로 간주
### ───────────────────────────────────────────────────────────────────────

[[ -f "${BACKUP_DIR}/.env" ]] && { set -a; source "${BACKUP_DIR}/.env"; set +a; }
: "${MYSQL_BACKUP_PASS:?MYSQL_BACKUP_PASS 미설정 (.env 확인)}"

TS=$(date +%Y%m%d_%H%M%S)
log(){ echo "[$(date '+%F %T')] $*"; }
alert(){
  log "!! 백업 실패: $1"
  echo "$(date '+%F %T') FAILED: $1" > "${BACKUP_DIR}/LAST_FAILED"
  [[ -n "${ALERT_CMD:-}" ]] && ALERT_MSG="한줄로 백업 실패: $1" bash -c "${ALERT_CMD}" || true
}
trap 'alert "라인 ${LINENO} 중단(직전 명령 실패)"' ERR

log "===== 백업 시작 (${TS}) ====="

# 1) PostgreSQL: dump → gzip → gpg 암호화
PG_OUT="${BACKUP_DIR}/pg_${PG_DB}_${TS}.sql.gz.gpg"
log "PostgreSQL 덤프+암호화..."
docker exec "${PG_CONTAINER}" pg_dump -U "${PG_USER}" "${PG_DB}" \
  | gzip \
  | gpg --batch --yes --trust-model always --encrypt --recipient "${GPG_RECIPIENT}" -o "${PG_OUT}"
PG_SZ=$(stat -c%s "${PG_OUT}")
(( PG_SZ >= MIN_PG_BYTES )) || { alert "PG 산출물 과소 ${PG_SZ}B (<${MIN_PG_BYTES})"; exit 1; }
log "PostgreSQL 완료: $(numfmt --to=iec "${PG_SZ}" 2>/dev/null || echo "${PG_SZ}B")"

# 2) MySQL: dump → gzip → gpg 암호화
MY_OUT="${BACKUP_DIR}/mysql_${MYSQL_DB}_${TS}.sql.gz.gpg"
log "MySQL 덤프+암호화..."
docker exec "${MYSQL_CONTAINER}" mysqldump -u"${MYSQL_USER}" -p"${MYSQL_BACKUP_PASS}" \
  --single-transaction --no-tablespaces --skip-lock-tables \
  --ignore-table="${MYSQL_DB}.SMSQ_SEND" "${MYSQL_DB}" \
  | gzip \
  | gpg --batch --yes --trust-model always --encrypt --recipient "${GPG_RECIPIENT}" -o "${MY_OUT}"
MY_SZ=$(stat -c%s "${MY_OUT}")
(( MY_SZ >= MIN_MYSQL_BYTES )) || { alert "MySQL 산출물 과소 ${MY_SZ}B (<${MIN_MYSQL_BYTES})"; exit 1; }
log "MySQL 완료: $(numfmt --to=iec "${MY_SZ}" 2>/dev/null || echo "${MY_SZ}B")"

# 3) 형식 검증 — 서버엔 개인키가 없어 복호화 불가. PGP 암호문 구조만 확인
#    (완전 무결성 = 복원 테스트에서 개인키로 복호+gunzip -t 검증)
file -b "${PG_OUT}" | grep -qi "PGP.*encrypted" || { alert "PG 산출물이 PGP 암호문 아님(암호화 실패 의심)"; exit 1; }
file -b "${MY_OUT}" | grep -qi "PGP.*encrypted" || { alert "MySQL 산출물이 PGP 암호문 아님(암호화 실패 의심)"; exit 1; }

# 4) 오프사이트 전송 (암호문 → 59 안전)
log "59 오프사이트 전송..."
scp -P "${REMOTE_PORT}" -i "${SSH_KEY}" -o StrictHostKeyChecking=accept-new \
  "${PG_OUT}" "${MY_OUT}" "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_PATH}/"
log "전송 완료"

# 5) 로컬 보관정책 (암호문만 대상)
find "${BACKUP_DIR}" -maxdepth 1 -name "*.sql.gz.gpg" -mtime +${LOCAL_RETENTION_DAYS} -delete
log "로컬 정리 완료 (${LOCAL_RETENTION_DAYS}일 초과 삭제)"

# 6) 성공 마킹 (backup-monitor.sh 가 이 시각으로 신선도 판단)
date '+%F %T' > "${BACKUP_DIR}/LAST_SUCCESS"
rm -f "${BACKUP_DIR}/LAST_FAILED"
log "===== 백업 성공 완료 ====="
