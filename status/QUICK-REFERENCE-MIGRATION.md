# 교통정리 빠른 참고서 (Quick Reference)

**용도:** 실제 작업할 때 곁에 두고 참조할 간단한 체크리스트
**대상 문서:** PROTOCOL-MIGRATION-SAFETY.md의 축약본
**인쇄 권장:** A4 1-2장

---

## 1. 작업 유형별 심사 체크리스트

### 문서 수정 (무접촉 — 1분)

```
□ 파일 선택: OPS.md / STATUS.md / SCHEMA.md / BUGS.md
□ 변경 범위: 3줄 이내?
□ 코드 접촉: 없음?

실행:
  git status
  nano [파일.md]
  git add -u
  git commit -m "docs: [분류] 설명"
  git push

검증:
  ✅ git push 성공
```

### DB 스키마 변경 (근접 — 20분)

```
□ 사전 확인:
  - SSH 접속: ssh administrator@58.227.193.62 ✅
  - PostgreSQL: psql -U targetup targetup -c "SELECT 1" ✅
  - MySQL: mysql -usmsuser -p smsdb -e "SELECT 1" ✅
  - 부하 확인: 발송 진행 중? (mysql: SELECT COUNT(*) FROM SMSQ_SEND_1 WHERE status_code IN (1,2)) → 0?
  - Peak hour 아닌가? (보통 19:00 이후)

□ 백업:
  pg_dump -h localhost -U targetup targetup > /tmp/pg_backup_$(date +%s).sql
  mysqldump -h localhost -u smsuser -p smsdb > /tmp/mysql_backup_$(date +%s).sql

□ DDL 실행:
  psql -U targetup targetup  (또는 mysql)
  [쿼리 붙여넣기]

□ 검증:
  \d+ 테이블명  (PostgreSQL)
  DESC 테이블명;  (MySQL)
  SELECT COUNT(*) FROM 테이블;  (레코드 불변?)

□ 백업 보관:
  scp administrator@..:/tmp/pg_backup_*.sql ./
  클라우드에 업로드

검증:
  ✅ 레코드 건수 변화 없음
  ✅ 새 컬럼 생성됨
  ✅ 기본값 적용됨
```

### 코드 변경 (접촉 — 30분+)

```
□ Harold님 컨펌:
  - 현황 파악 브리핑
  - 설계안 제시 + 동의 획득

□ 로컬 개발:
  git status  (깨끗한가?)
  npm install
  [코드 수정]
  npm run build  (에러 0?)
  로컬 테스트

□ 커밋 & 푸시:
  git add [파일]
  git commit -m "[CRITICAL] 파일명 — 설명"
  git push

□ 배포:
  ssh administrator@...
  cd /home/administrator/targetup-app
  git pull
  npm install (필요시)
  npm run build  (프론트 변경 시)
  pm2 restart all

□ 검증 (배포 후 즉시):
  ✅ 단계 1: pm2 status → all online
  ✅ 단계 2: ps aux | grep qtmsg = 11
  ✅ 단계 3: 테스트 발송 1건 성공
  ✅ 단계 4: curl http://localhost:3000/health → 200
  ✅ 단계 5: mysql: SELECT COUNT(*) FROM SMSQ_SEND_10 → > 0
```

---

## 2. 위험 신호 & 대응 (5분 안에)

```
신호: PM2 "exited"
→ pm2 logs | head -50  (에러 로그 확인)
→ git log --oneline -1  (최근 변경)
→ git revert <hash> && git push && pm2 restart all

신호: 발송 API 500 에러
→ pm2 logs | grep -i error
→ psql -U targetup targetup -c "SELECT 1"  (DB 응답?)
→ mysql -u root -p -e "SELECT 1"  (MySQL 응답?)
→ 롤백 또는 DB 재시작

신호: 테스트 발송 미수신
→ ps aux | grep qtmsg | wc -l  (11개?)
→ grep "bind ack" /home/administrator/agent*/logs/*mtdeliver.txt  (bind OK?)
→ mysql: SELECT COUNT(*) FROM SMSQ_SEND_10 WHERE status_code = 6;  (성공 기록?)

신호: Agent bind fail
→ agent 로그 확인
→ MySQL 연결 확인
→ ./fkill.sh && ./startup.sh  (Agent 재시작)

신호: TypeScript 컴파일 에러
→ 즉시 원인 분석 또는 롤백
→ git revert + npm run build 재확인
```

---

## 3. 매 배포 후 검증 (5분 checklist)

```
배포 직후 즉시 실행:

□ PM2 상태
  pm2 status
  pm2 logs | head -30 | grep -i error

□ Agent 확인
  ps aux | grep qtmsg | grep -v grep | wc -l
  → 11개 맞는가?

□ 테스트 발송 (내 핸드폰)
  발송 버튼 클릭
  10초 이내 수신 확인
  MySQL 확인: mysql -u smsuser -p smsdb
  → SELECT COUNT(*) FROM SMSQ_SEND_10 WHERE status_code = 6;
  → 1 이상?

□ API 응답
  curl http://localhost:3000/health
  curl -H "Authorization: Bearer <JWT>" http://localhost:3000/api/customers?limit=1

□ 발송량 통계
  mysql -u smsuser -p smsdb -e "SELECT SUM(CASE WHEN status_code = 6 THEN 1 ELSE 0 END) FROM SMSQ_SEND_1 WHERE DATE(create_at) = CURDATE();"
  → 0 아닌가?

결과: □ 모두 통과 → 배포 확정
      □ 하나라도 실패 → 즉시 롤백
```

---

## 4. 롤백 명령어 (원라이너)

```
코드 롤백:
  git revert <commit-hash> && git push && pm2 restart all

문서 롤백:
  git restore status/[파일.md]

DB 스키마 롤백 (PostgreSQL):
  pg_restore -d targetup < /tmp/pg_backup_XXXXXX.sql

DB 스키마 롤백 (MySQL):
  mysql -u smsuser -p smsdb < /tmp/mysql_backup_XXXXXX.sql
```

---

## 5. 자주 쓰는 명령어 (Copy-Paste)

### SSH 접속
```bash
ssh administrator@58.227.193.62
```

### PM2 확인
```bash
pm2 status
pm2 logs | tail -100
pm2 monit  # Ctrl+C 종료
```

### DB 확인
```bash
# PostgreSQL
psql -h localhost -U targetup targetup -c "SELECT NOW();"

# MySQL
mysql -h localhost -u smsuser -p smsdb -e "SELECT NOW();"

# Redis
redis-cli ping
```

### Agent 확인
```bash
ps aux | grep qtmsg | grep -v grep | wc -l
grep "bind ack" /home/administrator/agent*/logs/*mtdeliver.txt | tail -11
```

### 테스트 발송 확인
```bash
mysql -h localhost -u smsuser -p smsdb -e "
SELECT DATE(create_at) as date, COUNT(*) as total,
  SUM(CASE WHEN status_code = 6 THEN 1 ELSE 0 END) as success
FROM SMSQ_SEND_10
WHERE DATE(create_at) = CURDATE()
GROUP BY DATE(create_at);
"
```

### 백업
```bash
pg_dump -h localhost -U targetup targetup > /tmp/pg_backup_$(date +%s).sql
mysqldump -h localhost -u smsuser -p smsdb > /tmp/mysql_backup_$(date +%s).sql
```

### 배포
```bash
git pull
npm run build
pm2 restart all
pm2 status
```

---

## 6. 연락 체인 (문제 발생 시)

1. **즉시 조치** (5분 안에)
   - 롤백 실행
   - PM2 logs 확인
   - 서비스 상태 점검

2. **Harold님 보고** (15분 이내)
   - "발송 시스템 에러 발생"
   - "원인: [3줄 요약]"
   - "조치: 롤백 완료, 테스트 발송 성공"

3. **근본 원인 분석** (30분 이내)
   - 커밋 로그 확인
   - 코드 리뷰
   - 배포 전 수정

---

## 7. 🔴 Critical — 즉시 중단 신호

다음 중 하나 발생하면 **즉시 모든 배포 중단:**

```
□ PM2 프로세스 모두 "exited" → git revert + pm2 restart
□ 발송 API 500 에러 + 에러 로그 불명확 → 롤백
□ 11개 Agent 중 3개 이상 offline → Agent 재시작 또는 롤백
□ 테스트 발송 완전 실패 (0건) → 롤백
□ DB 연결 실패 → 롤백 (이전 스키마 버전으로)
□ 타입스크립트 컴파일 에러 → 즉시 수정 또는 롤백
```

---

## 8. 작업 기록 템플릿

매 작업마다 아래 내용 기록 (슬랙 / 문서에):

```
【작업 기록】

날짜: 2026-03-05
시작: 10:00
분류: [문서/근접/접촉]
항목: OPS.md MySQL 비밀번호 마스킹

변경 파일:
- status/OPS.md (Line 14)

커밋:
- docs: OPS.md — MySQL 비밀번호 마스킹

배포:
- git push ✅
- 서버 git pull ✅
- pm2 restart (필요시) ✅

검증:
- 단계 1: PM2 status ✅
- 단계 2: Agent ping ✅
- 단계 3: 테스트 발송 ✅
- 단계 4: API 응답 ✅
- 단계 5: 발송량 ✅

결과: ✅ 통과
종료: 10:05

문제: 없음
```

---

## 9. 용어 정리

| 용어 | 의미 |
|------|------|
| **기간계** | 발송/DB/인증 = 절대 흔들리면 안 되는 핵심 시스템 |
| **무접촉** | 문서/설정만 (SoT 수정) |
| **근접** | DB 스키마 변경 (데이터 무변화) |
| **접촉** | 코드 변경 (실행 로직 변경) |
| **SoT** | Source of Truth = STATUS.md/OPS.md/SCHEMA.md |
| **롤백** | 이전 버전으로 돌아가기 |
| **pg_dump** | PostgreSQL 백업 |
| **mysqldump** | MySQL 백업 |
| **pm2** | Node.js 프로세스 관리 |
| **Agent** | QTmsg 발송 엔진 (11개) |

---

**인쇄**: 이 페이지를 A4 2장으로 인쇄해서 작업할 때 곁에 두세요.
**마지막 갱신**: 2026-03-05
