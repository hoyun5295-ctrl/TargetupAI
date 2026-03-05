# 🚀 TargetUp 상용화 전 교통정리 안전 가이드

**읽어야 할 순서:**

1. **이 파일** (README) — 전체 개요
2. **PROTOCOL-MIGRATION-SAFETY.md** — 상세 프로토콜
3. **QUICK-REFERENCE-MIGRATION.md** — 실행할 때 곁에 두고 쓸 체크리스트
4. **SCRIPTS-SAFETY.sh** — 자동화 스크립트

---

## 📋 목차

1. [프로젝트 배경](#프로젝트-배경)
2. [3단계 작업 분류](#3단계-작업-분류)
3. [배포 전 체크리스트](#배포-전-체크리스트)
4. [배포 후 검증 프로토콜](#배포-후-검증-프로토콜)
5. [위험 신호 & 대응](#위험-신호--대응)
6. [일상적 명령어](#일상적-명령어)
7. [시나리오별 가이드](#시나리오별-가이드)

---

## 🎯 프로젝트 배경

**핵심 제약:**

```
✓ 로컬 테스트 환경 없음 → 상용 서버에서 직접 배포/테스트
✓ 기간계(발송/DB/인증) 무접촉 원칙 = "실패하면 사업이 멈춘다"
✓ QTmsg 11개 Agent 라인 = 고객 발송의 "심장"
✓ PostgreSQL + MySQL 이중 DB = 한쪽 장애도 전체 영향
```

**따라서:**

```
과잉 안전 = 정상
한 번에 하나만
백업은 필수
롤백 경로는 항상 확보
```

---

## 3️⃣ 3단계 작업 분류

### 무접촉 (무지 안전 — 1분)

**대상:** OPS.md, STATUS.md, SCHEMA.md, BUGS.md 문서 수정

```
위험도: 극저
롤백: git restore [파일]
예: OPS.md MySQL 비밀번호 마스킹
```

### 근접 (조심 필요 — 20분)

**대상:** ALTER TABLE (DB 스키마 변경)

```
위험도: 중간
선행: pg_dump + mysqldump 백업
롤백: pg_restore < backup.sql
예: plans 테이블에 3개 컬럼 추가
```

### 접촉 (매우 주의 — 30분+)

**대상:** campaigns.ts, auth.ts, database.ts 코드 변경

```
위험도: 높음
선행: Harold님 컨펌, 타입체크, 로컬 테스트
롤백: git revert + pm2 restart
예: 테이블명 화이트리스트 검증 추가
```

---

## ✅ 배포 전 체크리스트

**모든 작업 공통:**

```
□ CLAUDE.md 규칙 재확인
□ STATUS.md 최신 확인
□ Harold님 컨펌 완료 (코드 변경 시)
□ 변경 범위 최소화
  - 파일 5개 이하?
  - 한 번에 하나의 기능?
```

**코드 변경 시 추가:**

```
□ 로컬 npm run build → 타입 에러 0
□ 로컬 테스트 완료 (회귀테스트)
□ 5경로 전수점검 매트릭스 (campaigns.ts 수정 시)
□ git diff로 변경사항 재확인
```

**DB 스키마 변경 시 추가:**

```
□ pg_dump + mysqldump 백업 완료
□ DDL 쿼리 2명 검토 완료
□ Peak hour 아닌지 확인
□ 롤백 스크립트 준비
```

---

## 🔍 배포 후 검증 프로토콜

**배포 직후 즉시 5단계 검증 (5분):**

```
【1단계】PM2 상태 (1분)
  pm2 status
  → all 'online'? → ✅ PASS

【2단계】QTmsg Agent (1분)
  ps aux | grep qtmsg | wc -l
  → 11개? → ✅ PASS

【3단계】테스트 발송 (2분)
  앱에서 1건 발송 → 핸드폰 수신?
  mysql: SELECT COUNT(*) FROM SMSQ_SEND_10 WHERE status_code = 6;
  → 1 이상? → ✅ PASS

【4단계】API 응답 (1분)
  curl http://localhost:3000/health
  → 200 OK? → ✅ PASS

【5단계】발송량 통계 (1분)
  mysql: SELECT COUNT(*) FROM SMSQ_SEND_* WHERE DATE = TODAY
  → 0 아닌가? → ✅ PASS
```

**결과:**
```
✅ 5/5 통과 → 배포 확정
❌ 1개라도 실패 → 즉시 롤백
```

---

## 🚨 위험 신호 & 대응

### 🔴 즉시 중단 신호 (5분 안에 롤백)

```
신호: PM2 "exited"
→ git revert + pm2 restart

신호: 발송 API 500
→ pm2 logs 확인 → git revert

신호: 테스트 발송 0건
→ Agent/MySQL 확인 → git revert

신호: TypeScript 컴파일 에러
→ 수정 불가능 → 즉시 git revert
```

### 🟠 모니터링 신호

```
신호: CPU > 80% or 메모리 > 90%
→ pm2 monit 확인 → 느린 쿼리 로그 검토

신호: 특정 Agent bind fail
→ Agent 재시작 또는 MySQL 확인

신호: 프론트 화면 깨짐
→ nginx 에러 로그 확인 → npm run build 재실행
```

---

## 🔧 일상적 명령어

### 상태 확인

```bash
# 전체 헬스 체크 (자동화)
./SCRIPTS-SAFETY.sh health_check

# 또는 수동:
ssh administrator@58.227.193.62

# PM2
pm2 status
pm2 logs | tail -50

# Agent
ps aux | grep qtmsg | grep -v grep | wc -l
grep "bind ack" /home/administrator/agent*/logs/*mtdeliver.txt | tail -11

# DB
psql -U targetup targetup -c "SELECT 1"
mysql -u smsuser -p smsdb -e "SELECT 1"
```

### 배포

```bash
# 코드 배포
./SCRIPTS-SAFETY.sh deploy_code
# 또는 수동:
git pull
npm install (필요시)
npm run build (프론트 변경 시)
pm2 restart all

# 검증
./SCRIPTS-SAFETY.sh post_deploy_validation
```

### 백업

```bash
# 백업 (자동화)
./SCRIPTS-SAFETY.sh backup_all

# 또는 수동:
pg_dump -U targetup targetup > backup_pg_$(date +%s).sql
mysqldump -u smsuser -p smsdb > backup_mysql_$(date +%s).sql
```

### 롤백

```bash
# 코드 롤백
./SCRIPTS-SAFETY.sh rollback_code <commit-hash>

# DB 롤백
./SCRIPTS-SAFETY.sh rollback_db <backup-file>
```

---

## 📖 시나리오별 가이드

### 시나리오 1: OPS.md 비밀번호 마스킹

**분류:** 무접촉 (1분)

```bash
nano status/OPS.md
# Line 14: smsuser / sms123 → (서버 .env 참조)

git add -u
git commit -m "docs: OPS.md — MySQL 비밀번호 마스킹"
git push

# 배포 불필요 (문서만 변경)
```

### 시나리오 2: D53 plans 테이블 컬럼 추가

**분류:** 근접 (20분)

```bash
# 1. 백업
./SCRIPTS-SAFETY.sh backup_postgres

# 2. DDL 준비
cat > /tmp/alter_plans.sql << 'EOF'
ALTER TABLE plans ADD COLUMN customer_db_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE plans ADD COLUMN spam_filter_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE plans ADD COLUMN ai_messaging_enabled BOOLEAN DEFAULT FALSE;
EOF

# 3. 실행 (서버)
ssh administrator@58.227.193.62
psql -U targetup targetup -f /tmp/alter_plans.sql

# 4. 검증
\d+ plans
SELECT COUNT(*) FROM plans;

# 5. 백엔드 배포
./SCRIPTS-SAFETY.sh deploy_code

# 6. 검증
./SCRIPTS-SAFETY.sh post_deploy_validation
```

### 시나리오 3: campaigns.ts 테이블명 화이트리스트 추가

**분류:** 접촉 (30분+)

```bash
# 1. Harold님 브리핑
# "campaigns.ts SQL Injection 방지를 위해 테이블명 검증 추가"

# 2. 로컬 개발
npm run build  # 베이스라인
[코드 수정]
npm run build  # 타입 에러 0?
npm run dev && [테스트]

# 3. 커밋 & 푸시
git add packages/backend/src/routes/campaigns.ts
git commit -m "[CRITICAL] campaigns.ts — 테이블명 화이트리스트 검증"
git push

# 4. 배포
./SCRIPTS-SAFETY.sh deploy_code

# 5. 검증
./SCRIPTS-SAFETY.sh post_deploy_validation
```

### 시나리오 4: 배포 후 PM2 에러 발생

**대응:**

```bash
# 1. 즉시 상황 파악
ssh administrator@58.227.193.62
pm2 status  # "exited"?
pm2 logs | tail -50  # 에러 메시지?

# 2. Harold님 보고
# "발송 시스템 PM2 프로세스 크래시"
# "원인: [에러 로그 3줄]"

# 3. 롤백 실행
./SCRIPTS-SAFETY.sh rollback_code <이전-커밋-해시>

# 4. 재검증
./SCRIPTS-SAFETY.sh post_deploy_validation

# 5. 근본 원인 분석
git log --oneline -5
git show <문제-커밋>
```

---

## 📂 문서 구조

```
status/
├── README-MIGRATION-SAFETY.md           ← 이 파일 (개요)
├── PROTOCOL-MIGRATION-SAFETY.md         ← 상세 프로토콜
├── QUICK-REFERENCE-MIGRATION.md         ← 빠른 참고 (A4 2장 인쇄용)
├── SCRIPTS-SAFETY.sh                    ← 자동화 스크립트
├── 교통정리-전수점검-20260305.md        ← Harold님 리포트
├── STATUS.md                            ← 진행 현황 (SoT)
├── OPS.md                               ← 운영 정보
├── SCHEMA.md                            ← DB 스키마
└── BUGS.md                              ← 버그 추적
```

---

## 🚀 시작하기

### 첫 배포 전 (필수)

```bash
# 1. 모든 문서 읽기
cat PROTOCOL-MIGRATION-SAFETY.md
cat QUICK-REFERENCE-MIGRATION.md

# 2. 스크립트 권한 확인
chmod +x SCRIPTS-SAFETY.sh

# 3. 테스트 (권한 확인)
./SCRIPTS-SAFETY.sh help

# 4. 헬스 체크
./SCRIPTS-SAFETY.sh health_check
```

### 배포할 때마다

```bash
# 1. 배포 전 체크리스트
# → QUICK-REFERENCE-MIGRATION.md 참조

# 2. 배포
./SCRIPTS-SAFETY.sh deploy_code

# 3. 검증
./SCRIPTS-SAFETY.sh post_deploy_validation

# 4. 문제 발생 시
# → QUICK-REFERENCE-MIGRATION.md 위험 신호 참조
```

### 문제 발생 시

```bash
# 1. 로그 확인
./SCRIPTS-SAFETY.sh check_pm2

# 2. 원인 파악 (5분)
pm2 logs | grep -i error

# 3. 롤백 실행
./SCRIPTS-SAFETY.sh rollback_code <commit-hash>

# 4. Harold님 보고
# "문제: [증상] / 원인: [3줄] / 조치: [롤백 완료, 재검증 중]"
```

---

## ⚠️ 절대 금지 사항

```
❌ git push --force (공유 저장소에서는 절대 금지)
❌ docker-compose up 재실행 (포트 바인딩 0.0.0.0 위험)
❌ 하드코딩 비밀번호/토큰 (OPS.md "(서버 .env 참조)" 사용)
❌ 로컬 테스트 스킵 (타입 에러 체크는 필수)
❌ 커밋 메시지 없는 푸시 (SoT 추적 불가)
❌ 한 커밋에 5개 이상 파일 (역추적 어려움)
❌ campaigns.ts 수정 후 5경로 점검 생략
❌ 문서 갱신 없이 코드 변경 (STATUS.md 동기화 필수)
```

---

## 📞 연락 체인 (문제 시)

**긴급:** Harold님 직접 연락 (전화/톡)
```
"발송 시스템 에러 발생, 즉시 롤백 진행 중입니다.
 원인: [3줄]
 예상 복구: 5분"
```

**스크린샷 첨부:**
- pm2 status (에러 상태)
- pm2 logs (에러 메시지)
- git log (최근 배포 커밋)

---

## 📊 진행 현황

**교통정리 우선순위 (STATUS.md 기준):**

| # | 항목 | 분류 | 상태 | 담당 |
|---|------|------|------|------|
| 1 | OPS.md 비밀번호 마스킹 | 무접촉 | ✅ 완료 | - |
| 2 | STATUS.md 체크표시 정정 | 무접촉 | ✅ 완료 | - |
| 3 | D53 plans ALTER TABLE | 근접 | ⬜ 대기 | 서버 |
| 4 | OPT_OUT_080_TOKEN 추가 | 무접촉 | ⬜ 대기 | 서버 |
| 5 | campaigns.ts 화이트리스트 | 접촉 | ⬜ 대기 | 로컬 → 서버 |
| 6 | JWT_SECRET fail-fast | 접촉 | ⬜ 대기 | 로컬 → 서버 |
| 7 | 8차 버그 실동작 검증 | - | ⬜ 대기 | 직원 |

---

## 📝 체크리스트 (인쇄용)

```
【작업 기록】

날짜: ____________
시작: ____________
분류: □ 무접촉 □ 근접 □ 접촉
항목: ____________________________

【작업 전】
□ 문서 읽음
□ Harold님 컨펌 (코드 시만)
□ 백업 완료 (근접/접촉만)

【개발 (코드만)】
□ 로컬 npm run build → 0 에러
□ 로컬 테스트 완료
□ 5경로 점검 (campaigns 수정 시)

【배포】
□ git commit + push
□ 서버 배포
□ pm2 status

【검증】
□ 단계 1: PM2 online ✅
□ 단계 2: Agent 11개 ✅
□ 단계 3: 테스트 발송 ✅
□ 단계 4: API 200 ✅
□ 단계 5: 발송량 > 0 ✅

【결과】
□ ✅ 통과 (배포 확정)
□ ❌ 실패 (즉시 롤백)

종료: ____________
```

---

**최종 원칙:**

```
과잉 안전 = 정상
의심스러우면 물어보고
테스트는 필수
롤백은 항상 준비
문서는 최신 유지
```

**작성:** Claude AI Agent
**승인 대기:** Harold님
**마지막 갱신:** 2026-03-05
**버전:** 1.0
