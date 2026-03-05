#!/bin/bash
# =============================================================
# TargetUp DB 자동 백업 스크립트
# 작성일: 2026-03-05
# 대상: 상용서버 (58.227.193.62)
# 기간계 영향: 없음 (읽기 전용 pg_dump/mysqldump)
# =============================================================

set -euo pipefail

# ─── 설정 (환경변수 또는 기본값) ──────────────────────────────
BACKUP_DIR="${BACKUP_DIR:-/home/administrator/backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"
LOG_FILE="${BACKUP_DIR}/backup.log"

# PostgreSQL (Docker 컨테이너)
PG_CONTAINER="${PG_CONTAINER:-targetup-postgres}"
PG_USER="${PG_USER:-targetup}"
PG_DB="${PG_DB:-targetup}"

# MySQL (Docker 컨테이너)
MYSQL_CONTAINER="${MYSQL_CONTAINER:-targetup-mysql}"
MYSQL_USER="${MYSQL_USER:-smsuser}"
MYSQL_DB="${MYSQL_DB:-smsdb}"
# MySQL 비밀번호는 환경변수 필수 (하드코딩 금지)
MYSQL_PASS="${MYSQL_PASS:?'MYSQL_PASS 환경변수를 설정해주세요'}"

# 외부 전송 (S3, 비활성 시 로컬만 보관)
ENABLE_S3="${ENABLE_S3:-false}"
S3_BUCKET="${S3_BUCKET:-}"
S3_PREFIX="${S3_PREFIX:-targetup-backups}"

# ─── 타임스탬프 ───────────────────────────────────────────────
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DATE_DIR=$(date +%Y%m%d)

# ─── 함수 ─────────────────────────────────────────────────────
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

check_disk_space() {
    local available_mb
    available_mb=$(df -m "$BACKUP_DIR" | awk 'NR==2 {print $4}')
    if [ "$available_mb" -lt 1024 ]; then
        log "⚠️ 경고: 디스크 여유 공간 ${available_mb}MB — 최소 1GB 필요"
        exit 1
    fi
    log "디스크 여유 공간: ${available_mb}MB"
}

backup_postgres() {
    local dump_file="${BACKUP_DIR}/${DATE_DIR}/pg_${PG_DB}_${TIMESTAMP}.sql.gz"
    log "PostgreSQL 백업 시작: ${PG_DB}"

    docker exec "$PG_CONTAINER" pg_dump -U "$PG_USER" "$PG_DB" \
        --no-owner --no-acl \
        | gzip > "$dump_file"

    local size
    size=$(du -h "$dump_file" | cut -f1)
    log "✅ PostgreSQL 백업 완료: ${dump_file} (${size})"
    echo "$dump_file"
}

backup_mysql() {
    local dump_file="${BACKUP_DIR}/${DATE_DIR}/mysql_${MYSQL_DB}_${TIMESTAMP}.sql.gz"
    log "MySQL 백업 시작: ${MYSQL_DB}"

    docker exec "$MYSQL_CONTAINER" mysqldump \
        -u"$MYSQL_USER" -p"$MYSQL_PASS" \
        --single-transaction --routines --triggers --events \
        "$MYSQL_DB" \
        | gzip > "$dump_file"

    local size
    size=$(du -h "$dump_file" | cut -f1)
    log "✅ MySQL 백업 완료: ${dump_file} (${size})"
    echo "$dump_file"
}

upload_to_s3() {
    local file="$1"
    if [ "$ENABLE_S3" = "true" ] && [ -n "$S3_BUCKET" ]; then
        local s3_path="s3://${S3_BUCKET}/${S3_PREFIX}/${DATE_DIR}/$(basename "$file")"
        log "S3 업로드: ${s3_path}"
        aws s3 cp "$file" "$s3_path" --quiet
        log "✅ S3 업로드 완료"
    fi
}

cleanup_old_backups() {
    log "오래된 백업 정리 (${BACKUP_RETENTION_DAYS}일 이전)"
    find "$BACKUP_DIR" -name "*.sql.gz" -mtime +"$BACKUP_RETENTION_DAYS" -delete 2>/dev/null || true
    # 빈 날짜 디렉토리 정리
    find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -empty -delete 2>/dev/null || true
    log "✅ 정리 완료"
}

verify_backup() {
    local file="$1"
    local db_type="$2"
    # 파일 크기가 1KB 미만이면 실패로 판정
    local size_bytes
    size_bytes=$(stat -c%s "$file" 2>/dev/null || echo "0")
    if [ "$size_bytes" -lt 1024 ]; then
        log "🔴 검증 실패: ${db_type} 백업 파일이 비정상적으로 작음 (${size_bytes} bytes)"
        return 1
    fi
    # gzip 무결성 체크
    if ! gzip -t "$file" 2>/dev/null; then
        log "🔴 검증 실패: ${db_type} 백업 파일 gzip 손상"
        return 1
    fi
    log "✅ 검증 통과: ${db_type} (${size_bytes} bytes)"
    return 0
}

# ─── 메인 실행 ────────────────────────────────────────────────
main() {
    log "========== 백업 시작 =========="

    # 디렉토리 생성
    mkdir -p "${BACKUP_DIR}/${DATE_DIR}"

    # 디스크 공간 확인
    check_disk_space

    # PostgreSQL 백업
    local pg_file
    pg_file=$(backup_postgres)
    verify_backup "$pg_file" "PostgreSQL"
    upload_to_s3 "$pg_file"

    # MySQL 백업
    local mysql_file
    mysql_file=$(backup_mysql)
    verify_backup "$mysql_file" "MySQL"
    upload_to_s3 "$mysql_file"

    # 오래된 백업 정리
    cleanup_old_backups

    log "========== 백업 완료 =========="
    log ""
}

main "$@"
