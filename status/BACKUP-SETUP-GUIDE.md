# 백업 자동화 설치 가이드

**작성일:** 2026-03-05
**대상:** 상용서버 (58.227.193.62)
**기간계 영향:** 없음 (읽기 전용 pg_dump/mysqldump, 발송/인증 무접촉)

---

## 1단계: 서버에 스크립트 배치

```bash
ssh administrator@58.227.193.62

# 백업 디렉토리 생성
mkdir -p /home/administrator/backups

# 스크립트 복사 (로컬에서 전송 또는 직접 생성)
# 옵션 A: git pull 후 복사
cd /home/administrator/targetup-app
git pull
cp status/backup-automate.sh /home/administrator/backups/
chmod +x /home/administrator/backups/backup-automate.sh
```

## 2단계: 환경변수 설정

```bash
# /home/administrator/backups/.env 파일 생성
cat > /home/administrator/backups/.env << 'EOF'
BACKUP_DIR=/home/administrator/backups
BACKUP_RETENTION_DAYS=7
PG_CONTAINER=targetup-postgres
PG_USER=targetup
PG_DB=targetup
MYSQL_CONTAINER=targetup-mysql
MYSQL_USER=smsuser
MYSQL_PASS=여기에_실제_MySQL_비밀번호
MYSQL_DB=smsdb
ENABLE_S3=false
EOF

# 권한 보호 (.env에 비밀번호 포함)
chmod 600 /home/administrator/backups/.env
```

## 3단계: 수동 테스트 실행

```bash
# 환경변수 로드 + 실행
source /home/administrator/backups/.env && /home/administrator/backups/backup-automate.sh

# 결과 확인
ls -la /home/administrator/backups/$(date +%Y%m%d)/
cat /home/administrator/backups/backup.log
```

## 4단계: 크론탭 등록 (매일 새벽 3시)

```bash
# 크론탭 편집
crontab -e

# 아래 줄 추가 (매일 03:00 KST)
0 3 * * * source /home/administrator/backups/.env && /home/administrator/backups/backup-automate.sh >> /home/administrator/backups/cron.log 2>&1
```

## 5단계: 검증

```bash
# 다음날 확인
ls -la /home/administrator/backups/$(date +%Y%m%d)/
tail -20 /home/administrator/backups/backup.log

# gzip 무결성 체크
gzip -t /home/administrator/backups/$(date +%Y%m%d)/*.sql.gz && echo "OK"
```

---

## 향후 개선 (S3 외부 전송)

S3 연동 시 `.env`에 아래 추가:
```
ENABLE_S3=true
S3_BUCKET=your-bucket-name
S3_PREFIX=targetup-backups
```
AWS CLI 설치 필요: `apt install awscli && aws configure`

---

## 복원 방법 (비상 시)

```bash
# PostgreSQL 복원
gunzip -c /home/administrator/backups/YYYYMMDD/pg_targetup_XXXXXXXX.sql.gz \
  | docker exec -i targetup-postgres psql -U targetup targetup

# MySQL 복원
gunzip -c /home/administrator/backups/YYYYMMDD/mysql_smsdb_XXXXXXXX.sql.gz \
  | docker exec -i targetup-mysql mysql -usmsuser -p smsdb
```
