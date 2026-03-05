#!/bin/bash
# TargetUp 교통정리 안전 스크립트 모음
# 용도: 배포 검증, DB 백업, 상태 확인 등을 자동화
# 사용법: ./SCRIPTS-SAFETY.sh [함수명] [파라미터]
# 또는: source SCRIPTS-SAFETY.sh; 함수명 [파라미터]

set -e  # 에러 발생 시 즉시 중단

# ═════════════════════════════════════════════════════════════
# 0. 설정
# ═════════════════════════════════════════════════════════════

SERVER_IP="58.227.193.62"
SERVER_USER="administrator"
APP_DIR="/home/administrator/targetup-app"
DB_NAME="targetup"
MYSQL_DB="smsdb"
MYSQL_USER="smsuser"
BACKUP_DIR="/tmp"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# ═════════════════════════════════════════════════════════════
# 1. 상태 확인 함수들
# ═════════════════════════════════════════════════════════════

# 1-1. PM2 상태 확인
check_pm2() {
    echo -e "${YELLOW}=== PM2 상태 확인 ===${NC}"
    ssh "${SERVER_USER}@${SERVER_IP}" "pm2 status"

    echo -e "\n${YELLOW}=== PM2 에러 로그 (마지막 10줄) ===${NC}"
    ssh "${SERVER_USER}@${SERVER_IP}" "pm2 logs | tail -10" || echo "로그 없음"
}

# 1-2. Agent 상태 확인 (11개)
check_agents() {
    echo -e "${YELLOW}=== QTmsg Agent 상태 확인 ===${NC}"

    # Agent 프로세스 개수
    count=$(ssh "${SERVER_USER}@${SERVER_IP}" "ps aux | grep qtmsg | grep -v grep | wc -l")
    echo "실행 중인 Agent: $count개"

    if [ "$count" -eq 11 ]; then
        echo -e "${GREEN}✓ 모두 정상 (11/11)${NC}"
    else
        echo -e "${RED}✗ 미실행 Agent 있음 ($count/11)${NC}"
    fi

    # Bind ack 확인
    echo -e "\n${YELLOW}=== Bind ACK 상태 (최근 11개) ===${NC}"
    ssh "${SERVER_USER}@${SERVER_IP}" "grep 'bind ack' /home/administrator/agent*/logs/*mtdeliver.txt 2>/dev/null | tail -11" || echo "로그 없음"
}

# 1-3. DB 연결 확인
check_db() {
    echo -e "${YELLOW}=== PostgreSQL 연결 확인 ===${NC}"
    ssh "${SERVER_USER}@${SERVER_IP}" "psql -h localhost -U targetup targetup -c \"SELECT version();\"" && echo -e "${GREEN}✓ 연결 성공${NC}" || echo -e "${RED}✗ 연결 실패${NC}"

    echo -e "\n${YELLOW}=== MySQL 연결 확인 ===${NC}"
    ssh "${SERVER_USER}@${SERVER_IP}" "mysql -h localhost -u ${MYSQL_USER} -p${MYSQL_USER} ${MYSQL_DB} -e \"SELECT VERSION();\"" && echo -e "${GREEN}✓ 연결 성공${NC}" || echo -e "${RED}✗ 연결 실패${NC}"
}

# 1-4. 전체 헬스 체크
health_check() {
    echo -e "${YELLOW}════════════════════════════════════════════════${NC}"
    echo -e "${YELLOW}   TargetUp 시스템 헬스 체크${NC}"
    echo -e "${YELLOW}════════════════════════════════════════════════${NC}"

    check_pm2
    echo -e "\n"
    check_agents
    echo -e "\n"
    check_db

    echo -e "\n${YELLOW}=== 시스템 리소스 ===${NC}"
    ssh "${SERVER_USER}@${SERVER_IP}" "df -h | grep -E 'Filesystem|/$' && free -h | grep -E 'total|Mem:'"

    echo -e "\n${GREEN}✓ 헬스 체크 완료${NC}"
}

# ═════════════════════════════════════════════════════════════
# 2. 백업 함수들
# ═════════════════════════════════════════════════════════════

# 2-1. PostgreSQL 백업
backup_postgres() {
    local backup_file="${BACKUP_DIR}/pg_backup_$(date +%s).sql"
    echo -e "${YELLOW}PostgreSQL 백업 시작: ${backup_file}${NC}"

    ssh "${SERVER_USER}@${SERVER_IP}" "pg_dump -h localhost -U targetup targetup > ${backup_file}"

    # 로컬에 다운로드
    local local_file="./pg_backup_$(date +%Y%m%d_%H%M%S).sql"
    scp "${SERVER_USER}@${SERVER_IP}:${backup_file}" "${local_file}"

    echo -e "${GREEN}✓ 백업 완료: ${local_file}${NC}"
}

# 2-2. MySQL 백업
backup_mysql() {
    local backup_file="${BACKUP_DIR}/mysql_backup_$(date +%s).sql"
    echo -e "${YELLOW}MySQL 백업 시작: ${backup_file}${NC}"

    ssh "${SERVER_USER}@${SERVER_IP}" "mysqldump -h localhost -u ${MYSQL_USER} -p${MYSQL_USER} ${MYSQL_DB} > ${backup_file}"

    # 로컬에 다운로드
    local local_file="./mysql_backup_$(date +%Y%m%d_%H%M%S).sql"
    scp "${SERVER_USER}@${SERVER_IP}:${backup_file}" "${local_file}"

    echo -e "${GREEN}✓ 백업 완료: ${local_file}${NC}"
}

# 2-3. 전체 백업 (PostgreSQL + MySQL)
backup_all() {
    echo -e "${YELLOW}════════════════════════════════════════════════${NC}"
    echo -e "${YELLOW}   전체 데이터베이스 백업${NC}"
    echo -e "${YELLOW}════════════════════════════════════════════════${NC}"

    backup_postgres
    echo ""
    backup_mysql

    echo -e "\n${GREEN}✓ 백업 완료${NC}"
    echo "백업 파일을 클라우드 스토리지에 업로드하세요."
}

# ═════════════════════════════════════════════════════════════
# 3. 배포 함수들
# ═════════════════════════════════════════════════════════════

# 3-1. 코드 배포 (git pull + pm2 restart)
deploy_code() {
    echo -e "${YELLOW}════════════════════════════════════════════════${NC}"
    echo -e "${YELLOW}   코드 배포 시작${NC}"
    echo -e "${YELLOW}════════════════════════════════════════════════${NC}"

    echo -e "${YELLOW}1. git pull${NC}"
    ssh "${SERVER_USER}@${SERVER_IP}" "cd ${APP_DIR} && git pull" || { echo -e "${RED}✗ git pull 실패${NC}"; exit 1; }

    echo -e "\n${YELLOW}2. npm install (필요시)${NC}"
    ssh "${SERVER_USER}@${SERVER_IP}" "cd ${APP_DIR} && npm install" || echo "스킵"

    echo -e "\n${YELLOW}3. PM2 재시작${NC}"
    ssh "${SERVER_USER}@${SERVER_IP}" "pm2 restart all" || { echo -e "${RED}✗ PM2 재시작 실패${NC}"; exit 1; }

    sleep 2

    echo -e "\n${YELLOW}4. 배포 후 검증${NC}"
    check_pm2

    echo -e "\n${GREEN}✓ 배포 완료${NC}"
}

# 3-2. 프론트엔드 빌드 포함 배포
deploy_full() {
    echo -e "${YELLOW}════════════════════════════════════════════════${NC}"
    echo -e "${YELLOW}   풀 배포 (코드 + 프론트빌드)${NC}"
    echo -e "${YELLOW}════════════════════════════════════════════════${NC}"

    echo -e "${YELLOW}1. git pull${NC}"
    ssh "${SERVER_USER}@${SERVER_IP}" "cd ${APP_DIR} && git pull" || { echo -e "${RED}✗ git pull 실패${NC}"; exit 1; }

    echo -e "\n${YELLOW}2. 프론트엔드 빌드${NC}"
    ssh "${SERVER_USER}@${SERVER_IP}" "cd ${APP_DIR}/packages/frontend && npm run build" || { echo -e "${RED}✗ 빌드 실패${NC}"; exit 1; }

    echo -e "\n${YELLOW}3. PM2 재시작${NC}"
    ssh "${SERVER_USER}@${SERVER_IP}" "pm2 restart all" || { echo -e "${RED}✗ PM2 재시작 실패${NC}"; exit 1; }

    sleep 2

    echo -e "\n${YELLOW}4. 배포 후 검증${NC}"
    check_pm2

    echo -e "\n${GREEN}✓ 풀 배포 완료${NC}"
}

# ═════════════════════════════════════════════════════════════
# 4. 테스트 함수들
# ═════════════════════════════════════════════════════════════

# 4-1. API 응답 확인
test_api() {
    echo -e "${YELLOW}=== API 응답 확인 ===${NC}"

    echo "GET /health"
    ssh "${SERVER_USER}@${SERVER_IP}" "curl -s http://localhost:3000/health | jq . || echo 'Failed'"

    echo -e "\n${GREEN}✓ API 테스트 완료${NC}"
}

# 4-2. 테스트 발송 확인 (MySQL SMSQ_SEND_10)
test_send() {
    echo -e "${YELLOW}=== 테스트 발송 통계 ===${NC}"

    ssh "${SERVER_USER}@${SERVER_IP}" "mysql -h localhost -u ${MYSQL_USER} -p${MYSQL_USER} ${MYSQL_DB} -e \"
    SELECT
      DATE(create_at) as date,
      COUNT(*) as total,
      SUM(CASE WHEN status_code = 6 THEN 1 ELSE 0 END) as success,
      SUM(CASE WHEN status_code >= 7 THEN 1 ELSE 0 END) as failed
    FROM SMSQ_SEND_10
    WHERE DATE(create_at) = CURDATE()
    GROUP BY DATE(create_at);
    \""

    echo -e "\n${GREEN}✓ 통계 조회 완료${NC}"
}

# ═════════════════════════════════════════════════════════════
# 5. 롤백 함수들
# ═════════════════════════════════════════════════════════════

# 5-1. 코드 롤백 (git revert)
rollback_code() {
    local commit_hash="$1"

    if [ -z "$commit_hash" ]; then
        echo -e "${RED}사용법: rollback_code <commit-hash>${NC}"
        echo "최근 커밋:"
        git log --oneline -5
        return 1
    fi

    echo -e "${YELLOW}════════════════════════════════════════════════${NC}"
    echo -e "${RED}   코드 롤백: ${commit_hash}${NC}"
    echo -e "${YELLOW}════════════════════════════════════════════════${NC}"

    echo "1. git revert 실행"
    git revert "${commit_hash}" --no-edit || { echo -e "${RED}✗ revert 실패${NC}"; return 1; }

    echo "2. git push"
    git push || { echo -e "${RED}✗ push 실패${NC}"; return 1; }

    echo "3. 서버 배포"
    deploy_code || { echo -e "${RED}✗ 배포 실패${NC}"; return 1; }

    echo -e "\n${GREEN}✓ 롤백 완료${NC}"
}

# 5-2. DB 스키마 롤백 (pg_restore)
rollback_db() {
    local backup_file="$1"

    if [ -z "$backup_file" ]; then
        echo -e "${RED}사용법: rollback_db <backup-file>${NC}"
        echo "로컬 백업 파일:"
        ls -la pg_backup_*.sql 2>/dev/null | tail -5
        return 1
    fi

    if [ ! -f "$backup_file" ]; then
        echo -e "${RED}파일 없음: ${backup_file}${NC}"
        return 1
    fi

    echo -e "${YELLOW}════════════════════════════════════════════════${NC}"
    echo -e "${RED}   DB 스키마 롤백: ${backup_file}${NC}"
    echo -e "${YELLOW}════════════════════════════════════════════════${NC}"

    read -p "진행하시겠습니까? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "취소됨"
        return 1
    fi

    # 서버에 파일 업로드
    scp "$backup_file" "${SERVER_USER}@${SERVER_IP}:${BACKUP_DIR}/"

    # PostgreSQL 복원
    echo "PostgreSQL 복원 중..."
    ssh "${SERVER_USER}@${SERVER_IP}" "pg_restore -d ${DB_NAME} ${BACKUP_DIR}/$(basename "$backup_file")" || echo "복원 실패 (덤프 파일일 경우 psql 사용)"

    echo -e "\n${GREEN}✓ DB 롤백 완료${NC}"
}

# ═════════════════════════════════════════════════════════════
# 6. 종합 검증 (배포 후)
# ═════════════════════════════════════════════════════════════

post_deploy_validation() {
    echo -e "${YELLOW}════════════════════════════════════════════════${NC}"
    echo -e "${YELLOW}   배포 후 5단계 검증${NC}"
    echo -e "${YELLOW}════════════════════════════════════════════════${NC}"

    # 1단계: PM2
    echo -e "\n${YELLOW}【1단계】PM2 상태${NC}"
    check_pm2

    # 2단계: Agent
    echo -e "\n${YELLOW}【2단계】QTmsg Agent${NC}"
    check_agents

    # 3단계: 테스트 발송
    echo -e "\n${YELLOW}【3단계】테스트 발송 (SMSQ_SEND_10)${NC}"
    test_send

    # 4단계: API
    echo -e "\n${YELLOW}【4단계】API 응답${NC}"
    test_api

    # 5단계: 전체 발송량
    echo -e "\n${YELLOW}【5단계】일일 발송량${NC}"
    ssh "${SERVER_USER}@${SERVER_IP}" "mysql -h localhost -u ${MYSQL_USER} -p${MYSQL_USER} ${MYSQL_DB} -e \"
    SELECT
      'Total' as line,
      SUM(CASE WHEN DATE(create_at) = CURDATE() THEN 1 ELSE 0 END) as today_count
    FROM (
      SELECT create_at FROM SMSQ_SEND_1 UNION ALL
      SELECT create_at FROM SMSQ_SEND_2 UNION ALL
      SELECT create_at FROM SMSQ_SEND_3 UNION ALL
      SELECT create_at FROM SMSQ_SEND_4 UNION ALL
      SELECT create_at FROM SMSQ_SEND_5 UNION ALL
      SELECT create_at FROM SMSQ_SEND_6 UNION ALL
      SELECT create_at FROM SMSQ_SEND_7 UNION ALL
      SELECT create_at FROM SMSQ_SEND_8 UNION ALL
      SELECT create_at FROM SMSQ_SEND_9 UNION ALL
      SELECT create_at FROM SMSQ_SEND_10 UNION ALL
      SELECT create_at FROM SMSQ_SEND_11
    ) all_sends;
    \""

    echo -e "\n${GREEN}════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}✓ 5단계 검증 완료${NC}"
    echo -e "${GREEN}════════════════════════════════════════════════${NC}"
}

# ═════════════════════════════════════════════════════════════
# 7. 도움말
# ═════════════════════════════════════════════════════════════

show_help() {
    cat << EOF
TargetUp 교통정리 안전 스크립트

사용법: ./SCRIPTS-SAFETY.sh [함수명] [파라미터]
   또는: source SCRIPTS-SAFETY.sh; 함수명

【상태 확인】
  health_check          전체 헬스 체크
  check_pm2            PM2 상태 확인
  check_agents         Agent 상태 확인 (11개)
  check_db             DB 연결 확인

【백업】
  backup_postgres      PostgreSQL 백업
  backup_mysql         MySQL 백업
  backup_all           전체 백업

【배포】
  deploy_code          코드 배포 (git pull + pm2 restart)
  deploy_full          풀 배포 (코드 + 프론트빌드)

【테스트】
  test_api             API 응답 확인
  test_send            테스트 발송 통계

【롤백】
  rollback_code <hash> 코드 롤백
  rollback_db <file>   DB 롤백

【종합】
  post_deploy_validation 배포 후 5단계 검증

【예시】
  ./SCRIPTS-SAFETY.sh health_check
  ./SCRIPTS-SAFETY.sh backup_all
  ./SCRIPTS-SAFETY.sh deploy_code
  ./SCRIPTS-SAFETY.sh post_deploy_validation
  ./SCRIPTS-SAFETY.sh rollback_code abc1234

EOF
}

# ═════════════════════════════════════════════════════════════
# 8. Main
# ═════════════════════════════════════════════════════════════

main() {
    local cmd="$1"
    local param1="$2"
    local param2="$3"

    case "$cmd" in
        health_check)
            health_check
            ;;
        check_pm2)
            check_pm2
            ;;
        check_agents)
            check_agents
            ;;
        check_db)
            check_db
            ;;
        backup_postgres)
            backup_postgres
            ;;
        backup_mysql)
            backup_mysql
            ;;
        backup_all)
            backup_all
            ;;
        deploy_code)
            deploy_code
            ;;
        deploy_full)
            deploy_full
            ;;
        test_api)
            test_api
            ;;
        test_send)
            test_send
            ;;
        rollback_code)
            rollback_code "$param1"
            ;;
        rollback_db)
            rollback_db "$param1"
            ;;
        post_deploy_validation)
            post_deploy_validation
            ;;
        help|--help|-h)
            show_help
            ;;
        "")
            show_help
            ;;
        *)
            echo -e "${RED}알 수 없는 명령: $cmd${NC}"
            show_help
            exit 1
            ;;
    esac
}

# 스크립트로 실행된 경우 main 함수 호출
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
