# 🚨 D-Day 선불 잔액 이관 런북 (2026-05-05 → 5-06)

> **작성일**: 2026-04-22 (D135 준비)
> **실행일**: 2026-05-05 새벽 (레거시 Agent 중지 직후)
> **실행 주체**: Harold님 (AI는 SSH/psql 접속 금지, 명령어만 안내)
> **작업 디렉토리**: `C:\Users\ceo\projects\targetup\migrate-legacy\`

## ⚠️ 핵심 원칙

1. **레거시 Agent 중지가 선행되어야 잔액이 고정**됨 (Agent가 발송하면 TOTALAMTUSED 증가)
2. **4/22 스냅샷 값은 그대로 못 씀** — D-Day 당일 재조회 필수
3. **기간계 금액 UPDATE** → psql -1 단일 트랜잭션 + 사전/사후 검증 필수

## 📊 4/22 기준 참고치 (검증 베이스라인)
- 선불 회사: **34개** (단독 29 / 다중 5)
- 총 잔액: **20,398,110원**
- 스냅샷 CSV 백업: `migrate-legacy/data/prepaid_snapshot_20260422.csv`
- 4/22 기준 UPDATE SQL 샘플: `migrate-legacy/data/migration-prepaid-update.sql` (**재생성 필요, 금액만 다름**)

> 5/5 실측 총액이 4/22 수치 대비 **감소** 방향이면 정상 (업체들이 4/22~5/5 사이에 추가 발송해서 소진된 만큼). 증가는 불가능 (충전 API도 함께 중단됨을 가정).

---

## ▶ D-Day 실행 순서 (7단계)

### Step 1. 레거시 Agent 중지 (선행 필수)
```bash
ssh -p 27153 root@27.102.203.143
# Harold님 QTmsg Agent 6대 중지 절차에 따라 진행
# (이 부분은 예약발송 이관 런북과 별개가 아닌 동일 흐름)
```

### Step 2. Oracle 선불 잔액 재조회 (CSV 덤프)
```bash
# 쿼리 SQL 업로드 (아직 서버에 없으면)
# 로컬 PowerShell:
scp -P 27153 migrate-legacy\data\query-prepaid-dump.sql root@27.102.203.143:/tmp/

# 레거시 SSH → oracle 유저 → sqlplus
su - oracle   # 비번 한 번에 정확히
LANG=C NLS_LANG=AMERICAN_AMERICA.UTF8 sqlplus usom_user@orcl
```

sqlplus 프롬프트에서:
```sql
@/tmp/query-prepaid-dump.sql
EXIT
```

출력 맨 끝 `DUMPED_PREPAID_COUNT` · `TOTAL_BALANCE` 숫자 **기록**. 파일: `/tmp/prepaid_balance.csv`

### Step 3. CSV 로컬로 다운로드
```powershell
# 로컬 PowerShell
cd C:\Users\ceo\projects\targetup
scp -P 27153 root@27.102.203.143:/tmp/prepaid_balance.csv migrate-legacy\data\prepaid_balance.csv
```

### Step 4. 로컬 분석 (회사별 합산)
```bash
# Git Bash 또는 PowerShell
node migrate-legacy/scripts/analyze-prepaid.js
```

**확인 포인트:**
- 출력 맨 끝 `CSV SUM` 이 Step 2의 `TOTAL_BALANCE`와 일치
- 회사 수, 단독/다중 분포가 타당 (4/22엔 34/29/5)
- `data/prepaid-company-rollup.json` 갱신됨

### Step 5. UPDATE SQL 재생성
```bash
node migrate-legacy/scripts/build-prepaid-update-sql.js
```

**생성물**: `migrate-legacy/data/migration-prepaid-update.sql`
- UPDATE 문 개수 = 회사 수 (34 근처 기대)
- 총 잔액 주석이 Step 4 결과와 일치

### Step 6. 서버 업로드 + psql 실행
```powershell
# 로컬 PowerShell
scp migrate-legacy\data\migration-prepaid-update.sql administrator@58.227.193.62:/tmp/
```

```bash
# 한줄로 서버 SSH
ssh administrator@58.227.193.62
docker cp /tmp/migration-prepaid-update.sql targetup-postgres:/tmp/
docker exec -i targetup-postgres psql -U targetup targetup -1 -f /tmp/migration-prepaid-update.sql
```

**출력 예상 시퀀스:**
```
BEGIN
 phase         | billing_type | cnt | sum_balance
 BEFORE UPDATE | postpaid     |  34 |           0     ← 사전 검증 (34사 전부 postpaid/0)
UPDATE 1
UPDATE 1
... (34회)
 phase        | billing_type | cnt | sum_balance
 AFTER UPDATE | prepaid      |  34 |   20,398,110    ← 사후 검증 (전부 prepaid로 전환 + 합계)
 company_code | company_name | billing_type | balance
 efolium      | 이폴리움      | prepaid      | 9,585,927    ← TOP 15
 ...
 metric                           | cnt | total_balance
 TOTAL PREPAID BALANCE (migrated) |  34 |  20,398,110
COMMIT
```

❌ AFTER sum 이 Step 5 생성치와 불일치하면 즉시 보고 (자동 롤백됐을 가능성).

### Step 7. 검증 쿼리 (선택 — 의심 시)
```bash
docker exec -i targetup-postgres psql -U targetup targetup -c "
SELECT COUNT(*) AS prepaid_count, SUM(balance) AS total
FROM companies
WHERE billing_type='prepaid' AND balance > 0;
"
```

---

## 🛡 실패 시 롤백

`psql -1` 트랜잭션이라 에러 시 **자동 ROLLBACK**. 수동 개입 불필요.

그래도 **이미 COMMIT된 후 잘못 발견** 시:
```sql
-- 이관 전 상태 복원 (34개 회사 billing_type → postpaid, balance → 0)
UPDATE companies
SET billing_type='postpaid', balance=0, updated_at=NOW()
WHERE id IN (<34개 UUID — prepaid-company-rollup.json에서 추출>);
```

---

## 📦 재사용 자산 목록

| 파일 | 역할 | 수정 여부 |
|---|---|---|
| `scripts/gen-prepaid-query.js` | 보기용 조회 SQL 생성 (1회) | 수정 불필요 |
| `scripts/gen-prepaid-dump-sql.js` | CSV 덤프 SQL 생성 (1회) | 수정 불필요 |
| `data/query-prepaid-dump.sql` | **D-Day 서버 업로드용** | 수정 불필요 |
| `scripts/analyze-prepaid.js` | CSV → rollup.json (D-Day 재실행) | 수정 불필요 |
| `scripts/build-prepaid-update-sql.js` | rollup.json → UPDATE SQL (D-Day 재생성) | 수정 불필요 |
| `data/prepaid_snapshot_20260422.csv` | 4/22 스냅샷 (참조/복원용) | 보존 |
| `data/prepaid_balance.csv` | **D-Day 당일 CSV 실측** (Step 3에서 덮어씀) | 덮어쓰기 |
| `data/prepaid-company-rollup.json` | **D-Day 재산출** (Step 4에서 덮어씀) | 덮어쓰기 |
| `data/migration-prepaid-update.sql` | **D-Day 재생성** (Step 5에서 덮어씀) | 덮어쓰기 |
| `data/레거시_선불_이관_대상.xlsx` | 서수란님 공유용 (4/22 기준, D-Day 재생성 선택) | — |

---

## 📝 체크리스트 (D-Day에 지우면서 확인)

- [ ] 레거시 QTmsg Agent 6대 중지 확인
- [ ] Step 2 sqlplus 덤프 성공 (`DUMPED_PREPAID_COUNT` 기록)
- [ ] Step 3 CSV 로컬 다운 (파일 크기 > 0)
- [ ] Step 4 `analyze-prepaid.js` 실행 → CSV SUM 일치 확인
- [ ] Step 5 `build-prepaid-update-sql.js` 실행 → UPDATE 문 수 일치
- [ ] Step 6 psql 실행 → AFTER sum_balance = Step 4 총액
- [ ] Step 7 선택 검증 쿼리 OK
- [ ] 최종 Harold님 실화면 확인 (슈퍼관리자 UI 또는 psql)
