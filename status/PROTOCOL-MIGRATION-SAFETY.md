# 상용화 전 교통정리 안전 프로토콜 (Migration Safety Protocol)

**작성일:** 2026-03-05
**대상:** TargetUp 모노레포 (Node.js/Express + React/TypeScript + PostgreSQL + MySQL + Redis)
**목적:** 로컬 테스트 없이 상용 배포하는 환경에서, 기간계(발송/DB/인증) 무접촉 원칙을 지키면서 체계적으로 교통정리 진행
**원칙:** "과잉 안전 = 정상" → 한 번에 하나만, 무조건 백업, 검증 후 배포, 롤백 경로 반드시 확보

---

## 1. 작업 분류 체계 & 안전장치

기간계 영향도에 따라 3단계로 분류하고, 각각 다른 안전장치 적용.

### 1-1. 분류 기준

| 분류 | 정의 | 영향 범위 | 롤백 난이도 |
|------|------|---------|----------|
| **무접촉** | 문서 수정, 설정값 변경만 | SoT 문서/설정 변경 | 매우 쉬움 |
| **근접** | DB 스키마 변경 (ALTER TABLE) | 테이블 구조 변경, 데이터는 유지 | 중간 (백업 복원) |
| **접촉** | 코드 변경 (campaigns.ts, auth.ts 등) | 실행 로직, 발송 경로 | 어려움 (테스트 필수) |

### 1-2. 무접촉 작업 안전장치

**대상:** OPS.md 수정, SCHEMA.md 갱신, STATUS.md 체크표시 정정, .env 설정값 추가

```
1. 수정 전: 현재 파일 스크린샷 캡처 (git status 확인용)
2. 수정: 문서만 변경 (코드 접촉 금지)
3. 수정 후:
   - git diff 확인 (의도하지 않은 변경 없는지)
   - git add -u (기존 파일만 스테이징)
   - git commit -m "docs: [분류/항목번호] 설명"
4. 배포: git push (즉시 적용 가능)
```

**안전장치:**
- 문서는 git으로 자동 백업됨
- revert 한 줄로 복구 가능
- 서버 접촉 전 검토 가능

### 1-3. 근접 작업 안전장치

**대상:** ALTER TABLE (plans 컬럼, spam_filter_tests 컬럼), 메시지 파티션 생성

```
1. 사전 점검:
   - SSH 접속 확인
   - PostgreSQL/MySQL 모두 응답 확인
   - 현재 부하 확인 (peak hour 아닌지)

2. 백업:
   pg_dump -h localhost -U targetup targetup > /tmp/pg_backup_$(date +%s).sql
   mysqldump -h localhost -u smsuser -p smsdb > /tmp/mysql_backup_$(date +%s).sql

3. DDL 실행:
   - 수정 쿼리 파일로 준비
   - 한 번에 하나의 ALTER TABLE만 실행
   - 각 실행 후 대상 테이블 SELECT로 검증

4. 결과 확인:
   \d+ 테이블명          (PostgreSQL)
   DESC 테이블명;        (MySQL)

5. 검증:
   - 기존 데이터 건수 불변
   - NOT NULL 컬럼은 기본값 설정됨
   - 인덱스 정상 작동

6. 백업 보관:
   - 로컬에 다운로드
   - 클라우드 스토리지 업로드 (장기 보관)
```

**안전장치:**
- DDL 전후 덤프로 완전한 롤백 가능
- 한 번에 하나만 변경 → 실패 원인 명확
- 각 스텝 후 즉시 검증 → 누적 에러 방지

### 1-4. 접촉 작업 안전장치

**대상:** campaigns.ts 변경, auth.ts 수정, database.ts 변경, new endpoint 추가

```
1. 설계 & 컨펌:
   - Harold님 현황 파악 브리핑
   - 변경 범위 최소화 설계안 제시
   - Harold님 동의 후 시작

2. 개발 (로컬):
   - TypeScript 컴파일 0 에러 확인
   - 기존 기능 회귀 테스트
   - 변경 범위 최소화 (관련 경로만)

3. 커밋:
   git add [수정파일]
   git commit -m "[CRITICAL] 제목 - 설명"

4. 배포 전:
   - 로컬에서 npm run build 성공 확인
   - 타입 에러 없음 확인
   - git log --oneline로 변경 내용 재확인

5. 배포:
   ssh administrator@58.227.193.62
   cd /home/administrator/targetup-app
   git pull
   npm install (필요시)
   npm run build (프론트 변경 시)

6. 검증 (배포 직후):
   pm2 status
   pm2 logs (에러 로그 확인)
   curl http://localhost:3000/health (백엔드 응답 확인)

7. 롤백 대기:
   - git revert [커밋해시] (로컬에서 미리 준비)
   - pm2 restart all (환경변수 없으면 롤백)
```

**안전장치:**
- 로컬 테스트 (dev 환경에서 실행 검증)
- TypeScript 타입 체크 (컴파일 에러 방지)
- 커밋 단위 단순화 (한 번에 하나의 기능)
- 롤백 자동화 (git revert + pm2 restart)

---

## 2. 롤백 전략 — 작업 유형별

### 2-1. 문서 수정 롤백

```bash
# 1. 상태 확인
git status

# 2. 특정 파일만 복구
git restore status/OPS.md

# 또는 특정 커밋 이전으로
git revert <commit-hash>
```

**소요시간:** 1분
**위험도:** 극저

---

### 2-2. DB 스키마 롤백

```bash
# 1. 로컬에서 백업 확인
ls -lh /tmp/*backup*.sql | tail -5

# 2. 서버에서 문제 상황 스크린샷 (증거)
ssh administrator@58.227.193.62
SELECT * FROM information_schema.columns WHERE table_name='plans';

# 3. 로컬에서 백업 복원
mysql -h 58.227.193.62 -u smsuser -p smsdb < /tmp/mysql_backup_1234567890.sql
psql -h 58.227.193.62 -U targetup targetup < /tmp/pg_backup_1234567890.sql

# 4. 검증
# 원본과 동일한 스키마 복원됨
```

**소요시간:** 5-10분
**위험도:** 중간 (백업 확인 필수)
**주의:** 복원 후 백엔드 재시작 필요 (상관없는 쿼리는 캐시된 커넥션 영향 없음)

---

### 2-3. 코드 변경 롤백

#### 옵션 A: git revert (권장)

```bash
# 1. 로컬에서 이전 커밋 해시 확인
git log --oneline -5

# 2. 되돌릴 커밋 선택
git revert <commit-hash>

# 3. 커밋 메시지 자동 생성됨 (Revert "원본 메시지")
# vim에서 :wq 저장

# 4. 푸시
git push

# 5. 서버에서 풀
ssh administrator@58.227.193.62
cd /home/administrator/targetup-app
git pull
pm2 restart all

# 6. 검증
pm2 status
pm2 logs
curl http://localhost:3000/health
```

**소요시간:** 3-5분
**위험도:** 저 (코드는 정확한 이전 버전으로 돌아감)

#### 옵션 B: git reset (주의)

```bash
# ⚠️ 공유 저장소에서는 위험 — 절대 --hard 사용 금지
git reset --soft HEAD~1    # 커밋 취소, 변경사항 유지
git reset --hard origin/main  # 모든 변경 버림 (=배포 기록 손실)
```

**주의:** reset은 다른 사람 커밋을 지우므로, 혼자 개발한 경우에만 사용.

---

### 2-4. 환경변수 롤백

```bash
# 1. SSH 접속
ssh administrator@58.227.193.62

# 2. .env 파일 백업
cp /home/administrator/targetup-app/packages/backend/.env \
   /tmp/env_backup_$(date +%s)

# 3. 이전 값으로 복원
nano .env

# 4. PM2 재시작
pm2 restart all

# 5. 환경변수 적용 확인
pm2 logs | head -20
```

**소요시간:** 2분
**위험도:** 저

---

## 3. 배포 검증 순서 & 체크리스트

매 배포 후 기간계 정상 확인 체크리스트. **모두 통과할 때까지 릴리스 금지.**

### 3-1. 단계별 검증 (5단계)

#### 단계 1: PM2 상태 확인 (즉시 — 1분)

```bash
ssh administrator@58.227.193.62

# 모든 프로세스 실행 중?
pm2 status

# 예상 결과:
# │ Node  │ 0         │ backend                      │ fork   │ exited │
# │ App   │ 1         │ frontend                     │ fork   │ exited │
#
# ⚠️ "exited" 뜨면 → pm2 logs 확인, 즉시 롤백

pm2 logs | head -50

# CPU/메모리 비정상인지 확인
pm2 monit  # (Ctrl+C 종료)
```

**패스 조건:** 모든 프로세스 "online", 에러 로그 없음

---

#### 단계 2: QTmsg 11개 Agent 동작 확인 (1분)

```bash
# Agent 프로세스 확인
ps aux | grep qtmsg | grep -v grep | wc -l

# 예상: 11개

# 각 Agent 상태 확인
grep "bind ack" /home/administrator/agent*/logs/*mtdeliver.txt | tail -11

# 예상 결과:
# agent1/logs/mtdeliver.txt:2026-03-05 10:15:33 bind ack [OK]
# agent2/logs/mtdeliver.txt:2026-03-05 10:15:34 bind ack [OK]
# ... (11개 모두)

# ⚠️ "bind fail" 또는 프로세스 < 11 → 롤백 고려
```

**패스 조건:** 11개 모두 실행 중, bind ack [OK]

---

#### 단계 3: 테스트 발송 1건 (5분)

```bash
# 백엔드 전용 테스트 라인(SMSQ_SEND_10) 사용

# 1. 타겟 고객사 선택
#    - 권장: 테스트용 고객사(TEST_SYNC) 또는 Harold님 테스트 계정
#    - 권장 번호: 010-xxxx-xxxx (Harold님 핸드폰)

# 2. 프론트에서 수동 발송
#    - app.hanjul.ai 접속
#    - 고객사 선택
#    - 테스트 캠페인 생성
#    - 1명 선택 후 발송
#
#    또는 API 직접 호출:
curl -X POST http://localhost:3000/api/campaigns/direct-send \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "companyId": "테스트고객사UUID",
    "phones": ["010-xxxx-xxxx"],
    "message": "테스트발송_20260305",
    "messageType": "SMS"
  }'

# 3. 발송 확인
#    - QTmsg 로그 확인
grep "INSERT" /home/administrator/agent10/logs/*mtinsert.txt | tail -1

# 예상 결과:
# 2026-03-05 10:20:15 INSERT seqno=12345 phone=010xxxx status=100 [OK]

# 4. 실제 핸드폰 수신 확인
#    - Harold님 핸드폰에서 문자 수신 여부 확인
#    - 발송 버튼 클릭 후 10초 이내 도착

# 5. 발송 결과 DB 확인
mysql -u smsuser -p smsdb
SELECT COUNT(*) FROM SMSQ_SEND_10 WHERE status_code = 6;

# ⚠️ COUNT = 0 → 발송 실패 → 롤백
```

**패스 조건:** 핸드폰 수신 + DB에 status_code=6(성공) 기록

---

#### 단계 4: API 응답 확인 (1분)

```bash
# 1. 기본 헬스 체크
curl -s http://localhost:3000/health | jq .

# 예상 결과:
# {
#   "status": "ok",
#   "timestamp": "2026-03-05T10:20:30Z"
# }

# 2. 고객 목록 조회 (인증 필요)
curl -s -H "Authorization: Bearer <JWT>" \
  http://localhost:3000/api/customers?limit=1 | jq '.data | length'

# 예상: 1 (최소 1명)

# 3. 캠페인 목록 조회
curl -s -H "Authorization: Bearer <JWT>" \
  http://localhost:3000/api/campaigns?limit=1 | jq '.data | length'

# 예상: 1 (최소 1개)

# ⚠️ 500 또는 timeout → 에러 로그 확인 후 롤백
```

**패스 조건:** 모든 GET 요청 200 OK, 데이터 반환

---

#### 단계 5: 발송량 통계 확인 (2분)

```bash
# 1. 일일 발송량 조회
mysql -u smsuser -p smsdb -e "
SELECT
  DATE(create_at) as send_date,
  COUNT(*) as total,
  SUM(CASE WHEN status_code = 6 THEN 1 ELSE 0 END) as success,
  SUM(CASE WHEN status_code >= 7 THEN 1 ELSE 0 END) as failed
FROM SMSQ_SEND_1
WHERE DATE(create_at) = CURDATE()
GROUP BY DATE(create_at);
"

# 예상 결과:
# send_date | total | success | failed
# 2026-03-05 | 1250 | 1200 | 50

# 2. 11개 라인 모두 확인
for i in 1 2 3 4 5 6 7 8 9 10 11; do
  echo "=== SMSQ_SEND_$i ==="
  mysql -u smsuser -p smsdb -e "
    SELECT COUNT(*) as total FROM SMSQ_SEND_$i
    WHERE DATE(create_at) = CURDATE();
  "
done

# ⚠️ 특정 라인이 0이거나, success = 0 → 라인그룹 설정 확인 후 롤백
```

**패스 조건:** 발송량 정상 범위, 11개 라인 모두 발송 기록 있음

---

### 3-2. 배포 후 검증 체크리스트 (인쇄용)

```
배포일: ____________
배포 내용: ____________________________

□ 단계 1: PM2 상태 확인
  □ pm2 status에서 모두 "online"
  □ pm2 logs 에러 없음

□ 단계 2: QTmsg Agent 확인
  □ ps aux | grep qtmsg = 11개
  □ grep "bind ack" = 11개 [OK]

□ 단계 3: 테스트 발송
  □ 백엔드: API 호출 200 OK
  □ MySQL: INSERT 로그 확인
  □ 핸드폰: 10초 이내 수신

□ 단계 4: API 응답
  □ /health → 200 OK
  □ /api/customers → 200 OK
  □ /api/campaigns → 200 OK

□ 단계 5: 발송량 통계
  □ 일일 발송량 > 0
  □ 11개 라인 모두 발송 기록

결과: □ 통과 (배포 확정) □ 실패 (즉시 롤백)
```

---

## 4. 위험 신호 감지 & 즉시 대응

작업 중/후 "이건 잘못됐다" 싶을 때의 대응 플로우.

### 4-1. 신호 탐지표

| 신호 | 심각도 | 원인 추정 | 즉시 조치 |
|------|--------|---------|---------|
| PM2 프로세스 "exited" | 🔴🔴 | 코드 크래시 또는 환경변수 누락 | `pm2 restart all` 후 logs 확인 |
| 발송 API 500 에러 | 🔴🔴 | 데이터베이스 연결 실패 또는 쿼리 에러 | `curl http://localhost:3000/health`, logs 확인 |
| 테스트 발송 실패 (SMS 미수신) | 🔴 | QTmsg Agent 다운 또는 테이블 미삽입 | `ps aux \| grep qtmsg`, MySQL SMSQ_SEND_10 COUNT 확인 |
| Agent bind fail | 🔴 | 라인 접속 실패 또는 MySQL 문제 | `mysql -usmsuser -p smsdb`, agent logs 확인 |
| 특정 라인만 0 건 발송 | 🔴 | 라인그룹 설정 오류 또는 회사 할당 누락 | 고객사 라인그룹 확인, OPS.md Line 188 참조 |
| CPU 사용률 > 80% | 🟠 | 쿼리 성능 악화 또는 메모리 누수 | `pm2 monit` 확인, 느린 쿼리 로그 검토 |
| 프론트 화면 깨짐 | 🟠 | 빌드 실패 또는 번들 오류 | nginx 에러 로그 확인, `npm run build` 재실행 |
| 타입스크립트 컴파일 에러 | 🔴 | 배포 전 타입 검사 누락 | 즉시 롤백, `git revert`, npm run build 재확인 |

### 4-2. 대응 플로우

```
신호 감지
  ↓
심각도 판정 (🔴🔴 / 🔴 / 🟠)
  ↓
┌─────────────────────────────────────┐
│ 심각도 🔴🔴 (Blocker)                │
├─────────────────────────────────────┤
│ 1. 즉시 서비스 중단 공지             │
│    "현재 발송이 일시 중단됨"         │
│                                     │
│ 2. 롤백 실행:                       │
│    git revert <commit>              │
│    git push                         │
│    pm2 restart all                  │
│                                     │
│ 3. 롤백 검증:                       │
│    pm2 status                       │
│    테스트 발송 1건                   │
│                                     │
│ 4. Harold님 보고 + 원인 분석        │
│    (1단계 코드 검증 프로토콜 실행)   │
└─────────────────────────────────────┘
  ↓
┌─────────────────────────────────────┐
│ 심각도 🔴 (Critical)                │
├─────────────────────────────────────┤
│ 1. 원인 파악 (5분)                   │
│    - logs 확인                      │
│    - DB 상태 확인                   │
│    - 최근 배포 내용 확인             │
│                                     │
│ 2. Harold님 상황 보고               │
│    (원인 3줄 요약)                  │
│                                     │
│ 3. 옵션 제시:                       │
│    A. 롤백 (추천, 5분)              │
│    B. 긴급 수정 (위험, 30분+)      │
│       → Harold님 선택               │
│                                     │
│ 4. 선택된 옵션 실행 + 검증          │
└─────────────────────────────────────┘
  ↓
┌─────────────────────────────────────┐
│ 심각도 🟠 (Major)                   │
├─────────────────────────────────────┤
│ 1. 원인 파악 (10분)                  │
│ 2. 영향 범위 평가                    │
│ 3. Harold님 상황 보고               │
│ 4. 수정 또는 롤백 선택               │
│ 5. 실행                             │
└─────────────────────────────────────┘
```

### 4-3. 긴급 상황 대응 연락 체인

```
1. Harold님 직접 연락 (전화/톡)
   - "발송 시스템 에러 발생, 롤백 진행 중"

2. 에러 로그 스크린샷 + 조치 내용 송부

3. 테스트 발송 재확인 후 재개 보고
```

---

## 5. 작업 전 필수 점검 체크리스트

매 작업 시작 전 반드시 확인해야 할 사항. **하나라도 미충족하면 작업 진행 금지.**

### 5-1. 작업 전 (모든 작업)

```
□ CLAUDE.md 규칙 재확인
  □ "하드코딩 금지" → 환경변수/설정파일 확인
  □ "기간계 무접촉" → 변경 범위 확인
  □ "최우선 안정성" → 롤백 경로 확인

□ SoT 문서 최신 확인
  □ STATUS.md 최신본 읽음
  □ SCHEMA.md 변경 내용 확인
  □ OPS.md 서버 설정 최신 확인

□ 현황 파악
  □ 이전 배포 언제였는가? (최근 24시간 이내?)
  □ 현재 서버 정상 상태인가? (pm2 status 양호?)
  □ 진행 중인 다른 작업 있는가?

□ Harold님 컨펌 (코드 변경 시만)
  □ 현황 브리핑 완료
  □ 설계안 제시 + 동의 획득
  □ CURRENT_TASK에 기록됨

□ 변경 범위 최소화
  □ 관련 파일 5개 이하?
  □ 한 번에 하나의 기능?
  □ 불필요한 리팩토링 없음?
```

### 5-2. 작업 전 (DB 변경 시)

```
□ 백업 경로 준비
  □ /tmp/pg_backup_*.sql 디렉토리 확인
  □ 외부 스토리지 접근 가능한가?

□ 서버 상태 확인
  SSH 접속:
  $ ssh administrator@58.227.193.62

  □ 디스크 여유 > 20GB? (df -h)
  □ 메모리 여유 > 10GB? (free -h)
  □ PostgreSQL 응답하는가? (psql -U targetup targetup -c "SELECT 1")
  □ MySQL 응답하는가? (mysql -usmsuser -p smsdb -e "SELECT 1")

□ Peak hour 아닌가?
  □ 업무시간 외인가? (보통 19:00 이후)
  □ 주말/휴일인가?
  □ 현재 발송 진행 중 아닌가? (mysql: SELECT COUNT(*) FROM SMSQ_SEND_1 WHERE status_code IN (1,2))

□ 변경 쿼리 검토 (2명)
  □ AI 작성 쿼리
  □ Harold님 수동 검토
  □ 테스트 DB에서 사전 실행 (선택사항, 로컬 MySQL)
```

### 5-3. 작업 전 (코드 변경 시)

```
□ 로컬 개발 환경 준비
  □ git status 깨끗한가? (untracked files 없는가?)
  □ npm install 완료?
  □ 로컬 Docker 실행 중? (postgres/redis/mysql 모두)

□ 테스트 계획 수립
  □ 변경이 영향을 주는 경로 목록화
  □ 각 경로 회귀 테스트 방법 기록
  □ 예상 테스트 소요시간 (5분 이상? 30분 이상?)

□ 변경 범위 명확화
  □ 수정할 파일 목록화
  □ 각 파일당 최대 10줄 변경?
  □ campaigns.ts 변경이면 5경로 전수점검 매트릭스 준비

□ 타입 체크 준비
  □ 변경 전: npm run build (베이스라인)
  □ 변경 후: npm run build (비교)
  □ 모두 성공?
```

### 5-4. 작업 중 체크포인트

```
매 30분마다:

□ 진행도 기록
  □ 완료한 작업 (코드 수정 / 테스트 / 검증)
  □ 예상 남은 시간
  □ 문제 발생 여부

□ 변경 사항 백업
  □ 로컬: git add [변경파일] / git stash (임시 저장)
  □ 클라우드: 주요 파일 구글드라이브 업로드

□ 롤백 경로 항상 준비
  □ 커밋하지 않은 변경은 git stash로 보관
  □ 롤백할 이전 커밋 확인 (git log --oneline)
```

---

## 6. 코드 변경 시 안전 규칙 (campaigns.ts 등)

기간계 파일을 건드릴 때 반드시 따라야 할 구체적 규칙.

### 6-1. 변경 전 필수 확인

```
campaigns.ts (112KB, 5개 발송 경로):

1. 5개 경로 목록 확인 (campaigns.ts 상단):
   - /:id/send               (AI 발송, Line 400~500)
   - /direct-send            (직접 발송, Line 600~700)
   - /test-send              (테스트 발송, Line 900~1000)
   - /update/:id             (예약 수정, Line 1100~1200)
   - /preview/:id            (분할 조회, Line 1300~1400)

2. 변경 대상 경로 명확화
   예: "messageUtils.ts의 replaceVariables() 함수 수정"
       → /test-send 경로만 영향 (O) vs 5경로 모두 영향 (X)

3. 영향 범위 확인
   - 공통 함수? (getNextSmsTable, smsCountAll 등)
       → 5경로 전수점검 매트릭스 필수
   - 단일 경로? (/:id/send의 AI 발송 로직만)
       → 해당 경로만 테스트
```

### 6-2. 변경 범위 최소화 규칙

#### Rule 1: 한 번에 하나의 기능만

```typescript
// ❌ BAD: 한 번에 여러 변경
- if (status === 'pending') {
-   messages.push(data);
- }
+ if (status === 'pending' && isValid) {
+   messages.push(data);
+   console.log('Debug: added', data);
+ }
// → 기능 2개 + 디버그 로그 포함 = 복잡함

// ✅ GOOD: 한 번에 한 가지
- if (status === 'pending') {
-   messages.push(data);
- }
+ if (status === 'pending' && isValid) {
+   messages.push(data);
+ }
// → 유효성 검사 추가만
```

#### Rule 2: 기존 동작 보존 확인

```typescript
// 변경 전: 기존 코드 복사
const originalCode = `
  const table = getNextSmsTable(tables);
  const count = smsCountAll(tables, 'status_code = 100', []);
`;

// 변경 후: 새 코드 작성
const newCode = `
  const table = getNextSmsTable(tables);
  const count = smsCountAll(tables, 'status_code IN (100, 200)', []);
`;

// 검증: 기존 동작 보존인가?
// 기존: status_code = 100만 카운트
// 신규: status_code = 100 또는 200 카운트
// → "처리 범위 확대"이므로, 기존 데이터에서 100 레코드는 여전히 포함됨 (보존)
```

#### Rule 3: 타입 체크 필수

```bash
# 변경 전
npm run build 2>&1 | grep -i error
# 결과: 0 에러

# 변경 후
npm run build 2>&1 | grep -i error
# 결과: 0 에러 (동일)

# ⚠️ 에러 발생 시:
# - 캐스팅 (as any) 금지 (임시방편)
# - 타입 정의 추가 (올바른 방법)
// 예:
+ interface SmsCampaign {
+   id: string;
+   tables: string[];
+ }
- const campaign: any = { ... };  // ❌
+ const campaign: SmsCampaign = { ... };  // ✅
```

#### Rule 4: 한 번에 하나의 파일만

```
좋은 커밋:
- campaigns.ts Line 650: smsCountAll 파라미터 추가
  (한 파일, 한 기능, 10줄 이내)

나쁜 커밋:
- campaigns.ts + messageUtils.ts + normalize.ts 모두 변경
  (3개 파일 = 역추적 어려움)

방법:
1. campaigns.ts만 수정 + 테스트 + 커밋
2. messageUtils.ts 수정 필요하면 별도 커밋
3. normalize.ts 수정 필요하면 또 다른 커밋
```

### 6-3. 5경로 전수점검 매트릭스

공통 함수를 수정했을 때, 5개 발송 경로 모두 정상인지 검증 매트릭스.

```
변경 함수: replaceVariables() (messageUtils.ts)
영향 범위: 5경로 모두 호출 가능성

확인 항목:
┌─────────────────┬──────────────┬──────────────┬──────────────┬──────────────┬──────────────┐
│ 경로             │ AI발송       │ 직접발송     │ 테스트발송   │ 예약수정     │ 분할발송     │
├─────────────────┼──────────────┼──────────────┼──────────────┼──────────────┼──────────────┤
│ 변수 치환 호출?   │ ✅ Line 450  │ ✅ Line 650  │ ✅ Line 950  │ ❓ 미사용    │ ❓ 미사용    │
├─────────────────┼──────────────┼──────────────┼──────────────┼──────────────┼──────────────┤
│ 매개변수 일치?    │ ✅           │ ✅           │ ✅           │ -            │ -            │
├─────────────────┼──────────────┼──────────────┼──────────────┼──────────────┼──────────────┤
│ 반환값 처리?      │ ✅ 메시지    │ ✅ 메시지    │ ✅ 메시지    │ -            │ -            │
├─────────────────┼──────────────┼──────────────┼──────────────┼──────────────┼──────────────┤
│ 타입 에러?        │ ✅ 없음      │ ✅ 없음      │ ✅ 없음      │ -            │ -            │
└─────────────────┴──────────────┴──────────────┴──────────────┴──────────────┴──────────────┘

결론: 3경로에서 호출, 모두 타입 일치 ✅
```

### 6-4. 커밋 메시지 규칙

```bash
# 일반 변경
git commit -m "feat: campaigns.ts — replaceVariables 호출 추가 (직접발송 경로)"

# Critical 변경 (기간계 접촉)
git commit -m "[CRITICAL] campaigns.ts — 테이블명 화이트리스트 검증 추가 (SQLi 방지)"

# Hotfix (문서/설정만)
git commit -m "[HOTFIX] OPS.md — MySQL 비밀번호 마스킹"

# 규칙:
# - prefix: feat/fix/refactor/docs/[CRITICAL]/[HOTFIX]
# - 파일명 명시
# - 변경 이유 한 문장
# - 예상 영향 범위 (경로명)
```

### 6-5. 배포 전 최종 체크

```bash
# 1. 로컬 완전 빌드 (프론트엔드 포함)
npm run build

# 결과: "build complete" or "dist/ created"
# ⚠️ 에러 → 수정 후 재빌드

# 2. git diff로 변경 내용 재확인
git diff HEAD~1

# 최대 100줄? → OK
# 500줄 이상? → 분할 필요 (한 번에 하나)

# 3. 타입 에러 최종 확인
npm run build 2>&1 | grep "error TS"

# 결과: (none) → OK
# 1개 이상 → 수정 필수

# 4. 커밋 로그 확인
git log --oneline -3

# 메시지 명확한가? Harold님이 이해할 수 있는가?

# 5. 배포 준비 완료
git push
```

---

## 7. 실전 시나리오 & 대응

실제 작업할 때 마주칠 만한 상황별 구체적 대응 방법.

### 시나리오 1: campaigns.ts에서 DB 쿼리 변경

**상황:** campaigns.ts Line 676에서 MySQL 테이블명 참조를 동적으로 변경하려고 함

**위험도:** 🔴🔴 Critical (SQL Injection 가능성)

**대응:**

```
1. Harold님 브리핑
   "campaigns.ts Line 676 SQL 쿼리 안전성 개선을 위해
    테이블명 화이트리스트 검증을 추가하고 싶습니다"

2. 설계안 제시
   Option A: 테이블명을 WHITELIST 배열로 검증
   Option B: 쿼리 빌더(knex) 도입
   → Harold님: "Option A로 진행"

3. 코드 작성 (로컬)
   - Line 676 수정: template literal → 화이트리스트 검증
   - 다른 SQL 주입 가능 지점 5곳 검색 (grep)
   - 5곳 모두 동일 패턴 적용

4. 테스트 (로컬)
   npm run build (타입 에러 0)
   로컬 직접발송 1건 테스트 (성공)

5. 커밋 & 푸시
   git commit -m "[CRITICAL] campaigns.ts — 테이블명 화이트리스트 검증"
   git push

6. 배포 (서버)
   ssh administrator@...
   cd /home/administrator/targetup-app
   git pull
   npm install (필요시)
   pm2 restart all

7. 검증 (배포 후)
   pm2 status (online)
   테스트 발송 1건 (성공)
   mysql: SELECT COUNT(*) FROM SMSQ_SEND_10 WHERE status_code = 6;
```

---

### 시나리오 2: DB 스키마 변경 (ALTER TABLE plans)

**상황:** D53에서 plans 테이블에 3개 컬럼 추가 필요

**위험도:** 🔴 Critical (기존 데이터 영향)

**대응:**

```
1. Harold님 컨펌
   "3개 컬럼 추가 + 기존 데이터 기본값 설정"

2. 변경 쿼리 작성
   ALTER TABLE plans ADD COLUMN customer_db_enabled BOOLEAN DEFAULT FALSE;
   ALTER TABLE plans ADD COLUMN spam_filter_enabled BOOLEAN DEFAULT FALSE;
   ALTER TABLE plans ADD COLUMN ai_messaging_enabled BOOLEAN DEFAULT FALSE;

3. 백업 (서버)
   ssh administrator@...
   pg_dump -h localhost -U targetup targetup > /tmp/pg_backup_$(date +%s).sql

4. DDL 실행 (서버)
   psql -U targetup targetup
   \c targetup
   \i /tmp/alter_plans.sql  (또는 복사-붙여넣기)

5. 검증 (즉시)
   \d+ plans  (컬럼 확인)
   SELECT COUNT(*) FROM plans;  (레코드 건수 변화 없는가?)
   SELECT COUNT(*) FROM plans WHERE customer_db_enabled = FALSE;  (기본값 적용됨?)

6. 백업 보관
   로컬에 다운로드: scp administrator@...:pg_backup_*.sql ./
   클라우드 업로드: 구글드라이브에 업로드

7. 백엔드 배포
   git pull (이미 코드에 NEW 컬럼 참조 있다고 가정)
   pm2 restart all

8. 롤백 경로 확인
   git log --oneline (이전 커밋)
   git revert <hash>  (필요시 코드 롤백 준비)
   pg_restore < pg_backup_*.sql  (필요시 DB 롤백 준비)
```

---

### 시나리오 3: 환경변수 추가 (OPT_OUT_080_TOKEN)

**상황:** STATUS.md에서 .env 환경변수 추가 필요

**위험도:** 🟠 Major (미설정 시 기능 실패)

**대응:**

```
1. OPS.md 문서 먼저 갱신
   - 환경변수 목적, 값, 용도 기록
   - 로컬/서버 모두 작성

2. 로컬 .env 확인
   cat packages/backend/.env
   OPT_OUT_080_TOKEN=test-token-dev  (추가)

3. 로컬 테스트
   npm run dev
   curl http://localhost:3000/health  (정상 응답?)

4. 서버 .env에 추가
   ssh administrator@...
   nano /home/administrator/targetup-app/packages/backend/.env
   OPT_OUT_080_TOKEN=<실제값>  (추가)

   # 값 출처: (상용 서버에서만 알려줌)

5. PM2 재시작
   pm2 restart all

6. 환경변수 적용 확인
   pm2 logs | head -10  (에러 없는가?)
   curl http://localhost:3000/health  (응답하는가?)

7. 기능 테스트
   080 수신거부 테스트 발송 1건
   결과 콜백 수신 확인

8. 문서 갱신
   STATUS.md Line 604: [x] 완료 표시
   git add status/OPS.md status/STATUS.md
   git commit -m "ops: OPT_OUT_080_TOKEN 환경변수 추가"
   git push
```

---

## 8. 빠른 참고: 일상적 명령어 모음

자주 쓰는 커맨드를 한 곳에.

### 8-1. 서버 상태 확인

```bash
# SSH 접속
ssh administrator@58.227.193.62

# PM2 상태
pm2 status
pm2 monit         # Ctrl+C 종료

# 로그 확인
pm2 logs app      # frontend
pm2 logs          # all

# PostgreSQL 연결 테스트
psql -h localhost -U targetup targetup -c "SELECT version();"

# MySQL 연결 테스트
mysql -h localhost -u smsuser -p -e "SELECT @@version;"

# Redis 상태
redis-cli ping

# 디스크 여유
df -h

# 메모리 여유
free -h

# CPU 사용률
top -bn1 | head -20
```

### 8-2. 배포 명령어

```bash
# 로컬에서
git add [파일]
git commit -m "메시지"
git push

# 서버에서
ssh administrator@58.227.193.62
cd /home/administrator/targetup-app
git pull
npm run build  (프론트 변경 시)
pm2 restart all
pm2 status

# 롤백
git revert <commit>
git push
pm2 restart all
```

### 8-3. DB 작업

```bash
# PostgreSQL 덤프
pg_dump -h localhost -U targetup targetup > backup.sql

# MySQL 덤프
mysqldump -h localhost -u smsuser -p smsdb > backup.sql

# PostgreSQL 복원
psql -U targetup targetup < backup.sql

# MySQL 복원
mysql -u smsuser -p smsdb < backup.sql

# 테이블 스키마 확인
\d 테이블명        (PostgreSQL)
DESC 테이블명;     (MySQL)
```

### 8-4. 로그 분석

```bash
# 에러만 필터
pm2 logs | grep -i error

# 마지막 100줄
pm2 logs | tail -100

# 특정 시간 이후 로그
pm2 logs | grep "10:30"

# 발송 로그 확인 (QTmsg)
grep "INSERT" /home/administrator/agent1/logs/*mtinsert.txt

# Agent 상태
grep "bind ack" /home/administrator/agent*/logs/*mtdeliver.txt
```

---

## 9. 체크리스트 인쇄 템플릿

아래를 인쇄해서 매 작업마다 체크하면서 진행.

```
=== TargetUp 교통정리 안전 프로토콜 ===

작업일: ____________
작업자: ____________
작업 항목: ____________________________

【작업 전】
□ CLAUDE.md 규칙 확인
□ STATUS.md 읽음
□ Harold님 컨펌 완료 (코드 변경 시)
□ 변경 범위 최소화 확인

【개발 단계】(코드 변경 시만)
□ 로컬 Docker 실행
□ npm install 완료
□ 코드 수정
□ npm run build (0 에러)
□ 로컬 테스트 완료
□ git diff 재확인

【DB 작업】(스키마 변경 시만)
□ 백업: pg_dump + mysqldump
□ DDL 작성 검토
□ 실행 후 검증
□ 백업 보관 (로컬 + 클라우드)

【배포】
□ git commit + push
□ 서버 git pull
□ pm2 restart all

【검증】
□ 단계 1: PM2 상태 확인 ✅
□ 단계 2: QTmsg Agent 확인 ✅
□ 단계 3: 테스트 발송 ✅
□ 단계 4: API 응답 확인 ✅
□ 단계 5: 발송량 통계 확인 ✅

【최종】
□ 결과: ✅ 통과 / ❌ 실패
□ 문제 발생 시: 즉시 롤백 + Harold님 보고
□ 모든 로그 스크린샷 저장
```

---

## 10. 문서 링크 & 참조

이 프로토콜에서 자주 참조하는 문서들.

| 문서 | 용도 | 경로 |
|------|------|------|
| CLAUDE.md | 개발 원칙 | /sessions/.../CLAUDE.md |
| STATUS.md | 작업 현황 (SoT) | status/STATUS.md |
| OPS.md | 서버/인프라 정보 | status/OPS.md |
| SCHEMA.md | DB 스키마 | status/SCHEMA.md |
| BUGS.md | 버그 추적 | status/BUGS.md |
| 이 문서 | 배포 안전 프로토콜 | status/PROTOCOL-MIGRATION-SAFETY.md |

---

**작성:** Claude AI Agent
**승인 대기:** Harold님
**마지막 갱신:** 2026-03-05
**버전:** 1.0
