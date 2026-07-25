# 정산 재구성 핸드오프 (2026-07-25 → 다음 세션)

> **이 문서 하나로 재개 가능하도록 작성.** 대화 맥락 없이 여기부터 읽으면 된다.
> SoT = 이 문서. 스키마 실측은 `status/SCHEMA.md`(billings·billing_items·sales.RSRM_SalesStts 등재 완료).

---

## 0. 지금 상태 — 배포 여부부터

| 구분 | 커밋 | 배포 |
|---|---|---|
| 정산 결함 9건 | `11bdfebf` | 완료 |
| xlsx 전환 + 정합성 5건 | `d19f48fd` | 완료 |
| 화면 웹탭 청구축 통일 + 가짜 트랜잭션 2곳 | `3d0fca42` | 완료 |
| 통계DB 트립와이어 | `80afb2df` | 완료(`[pay-ingest-monitor] 감시 시작` 로그 확인) |
| **요금제 이력 배선 (7파일)** | **미커밋** | **미배포** |

**미커밋 파일**: `utils/plan-change-log.ts`(신규) · `plan-change-log.test.ts`(신규) · `routes/admin.ts` · `routes/companies.ts` · `utils/basic-trial.ts` · `utils/company-create.ts` · `utils/trial-downgrade-worker.ts` · `status/SCHEMA.md` · `status/lessons/LESSONS_DB.md`

검증 상태: tsc 0(백엔드·프론트) · 1,077 테스트 통과(97파일) · Codex 적대검증 6건 전부 수용 정정 완료.
**→ 재개 시 첫 할 일 = 이 7파일 커밋·배포.**

---

## 1. Harold가 정의한 청구서 구조 (원문 기준)

> "인비토=한줄로=QTmsg. 자비스와 비토게이트웨이도 내가 만들었고 외주로 쓰는 것조차 전부 우리 서비스를 이용하게 했다.
> 그래서 **청구는 한줄로 한 곳에서** 이루어져야 한다."

청구서에 들어가야 할 항목:

| # | 항목 | 분해 축 |
|---|---|---|
| 1 | **요금제(구독) 이용요금** | 플랜 × 적용기간. **변경 시 일할 계산** |
| 2 | **한줄로 서비스 이용요금**(웹) | 일자 × **계정** × 유형 |
| 3 | **에이전트 사용요금**(게이트웨이) | 일자 × **발송ID** × 대상ID × 유형 |
| 4 | **테스트 요금** | 일자 × **계정** × 유형 (담당자 테스트 / 스팸필터 구분) |
| 5 | AI 크레딧 | 충전 + 초과사용 (수량 × 단가) — 발송이 아니라 일자 분해 불가, 별도 항목 |

- 웹 계정은 **로그인ID + 이름 병기**(`kumkang2 / 금강제화_상설점`). 에이전트가 `D0110 / 금강제화`로 병기하는 것과 대칭.
- 금강제화 실측: 한줄로 계정 5개 중 7월 발송은 3개(`kumkang` 29건/315,562 · `kumkang4_이비즈` 21건/129,338 · `kumkang2_상설점` 19건/122,448). `created_by` 빈 발송 0건 → 계정 분해 100% 가능.

---

## 2. 근본 문제 — 에이전트가 청구 집계에 아예 없다

`send-usage-aggregation.ts`와 `billing.ts` 어디에도 `pay-stats`·`RSRM_SalesStts` 참조가 **0건**이다.
청구 집계가 보는 것은 SMSQ(웹)·테스트·스팸필터·IMC 넷뿐.

→ **`usage_type='both'` 회사(금강제화 등)는 게이트웨이 발송분이 청구서에 한 건도 안 들어간다.**
→ 금강제화 정산서에 "웹/에이전트 구분이 없고 일자별로만 나온다"는 Harold 지적의 원인이 이것.
→ MMS 308,043건 0원 청구와 같은 계열인데 이번엔 **채널 하나가 통째로** 빠진 것.

---

## 3. 완료된 준비물

### 3-1. `company_plan_changes` 테이블 (운영 DB 생성 완료)
```
id uuid PK / company_id uuid FK NOT NULL / from_plan_id uuid / to_plan_id uuid NOT NULL
from_plan_code varchar(20) / to_plan_code varchar(20) NOT NULL
from_monthly_price numeric(12,2) / to_monthly_price numeric(12,2) NOT NULL
effective_date date NOT NULL / change_type varchar(20) NOT NULL
changed_by uuid FK users ON DELETE SET NULL / reason text / changed_at timestamptz NOT NULL DEFAULT NOW()
INDEX (company_id, effective_date) · (effective_date)
```
- **기준선 141행 INSERT 완료** (`change_type='initial'`, `effective_date=companies.created_at::date`, reason에 "이력 도입 전 기준선 — 실제 변경 이력 없음" 명시).
- 분포: FREE 129 / BASIC 6 / ENTERPRISE 3 / TRIAL 2 / BUSINESS 1. **유료 10곳은 전부 자사 테스트·체험**(Harold 확인) — 실청구 대상 아직 없음.
- 플랜 단가: STARTER 150,000 / BASIC 350,000 / PRO 1,000,000 / BUSINESS 3,000,000 / ENTERPRISE 5,500,000. FREE·TRIAL 0.

### 3-2. `utils/plan-change-log.ts` (미커밋)
- `recordPlanChange({ client, companyId, toPlanId, changeType, ... })` — **`client`(PoolClient) 필수**. 트랜잭션 밖 호출은 타입에서 막힘.
- 직전 플랜은 `companies`가 아니라 **이력 최신 행**에서 도출(체인 구조).
- 회사별 `pg_advisory_xact_lock`으로 직렬화. `changeType: 'auto'`면 INSERT에 쓰는 그 prev 값으로 승강등 판정.
- `alertPlanChangeFailure()` — 롤백 후 알림. `[plan-change][MISS]` / `[ALERT_FAIL]` 로그.
- **`plan_id` 쓰기 9곳 전수 배선 완료** (UPDATE 8 + INSERT 1). 쓰기 9 : 기록 9 대조 확인.

### 3-3. `billing_items` 축 확장 ALTER (운영 적용 완료)
`channel varchar(20) NOT NULL DEFAULT 'web'` + `store_id varchar(100)` 추가, `agent_id` → `company_agent_ids(id)` FK 신설, `INDEX (billing_id, channel)`.
`channel` 값 = `web` / `agent` / `test` / `spam`.

---

## 4. 남은 작업 — 이 순서로

### ① 청구용 통합 집계 신설
기존 `buildCompanyUsageByDay`는 **건드리지 않는다**(발송통계 화면·엑셀이 쓰고 있고 0725에 정합을 맞춰놨다).
새 함수가 청구 축을 그대로 낸다:
```
채널 × 일자 × 유형 × (web/test/spam = 계정 | agent = 발송ID·대상ID)
```
축 출처(전부 실측 확인됨):
| 채널 | 축 | 출처 |
|---|---|---|
| web | 계정 | `campaigns.created_by` (발송ID 집합 → 계정 되매핑) |
| test | 계정 | `SMSQ.bill_id` (= userId. `insertTestSmsQueue` extra.billId) |
| spam | 계정 | `spam_filter_tests.user_id` |
| agent | 발송ID·대상ID | `sales.RSRM_SalesStts` CustId/StoreId, **성공 = `OkCnt`** |

### ② `/generate` 재작성
4채널을 `billing_items`에 `channel`·`user_id`·`agent_id`·`store_id`와 함께 저장.
기존 트랜잭션·advisory lock·`billed` 처리 구조는 유지(0725 완료분).

### ③ PDF 재구성
1페이지 = 항목 5개 소계 + 합계. 2페이지 이후 = 항목별 상세.
현재 PDF는 `billing_items`를 일자×유형으로만 출력(`billing.ts` `GET /:id/pdf`).

### ④ 요금제 일할계산
`company_plan_changes`를 읽어 구간별 금액 산출. **순수 함수로 분리해 테스트로 고정할 것** —
월 경계 / 변경일 당일 귀속(새 플랜 vs 옛 플랜) / 같은 날 두 번 변경 / 월 걸침이 전부 금액에 직결된다.

### ⑤ 성능 — 금강제화 정산서 생성 1분+
원인 = 라인 12개 × (라이브 + 앞뒤 1개월 포함 LOG 3개월) = **48개 테이블**을 각각 `GROUP BY`.
0725에 월 경계 385건 누락을 고치며 24 → 48로 늘었다(의도된 트레이드오프).
처방 방향 = 청구 대상 발송ID 집합이 이미 기간을 한정하므로, **실제 그 발송이 존재하는 테이블만** 훑도록 좁힌다.

### ⑥ 미측정 1건
금강제화 대상ID 분포 — 에이전트 항목을 발송ID 한 줄로 낼지 대상ID까지 내릴지가 여기서 정해진다.
```bash
docker exec -it pay-ingest-db mysql -uroot -p -e "SELECT StoreId, COUNT(*) rows_all, SUM(OkCnt) ok FROM sales.RSRM_SalesStts WHERE CustId='D0110' AND DestDt BETWEEN '20260701' AND '20260731' GROUP BY StoreId ORDER BY ok DESC LIMIT 20;"
```
※ `paystats`는 `172.%`에서만 붙는다. 컨테이너 안에서는 출처가 `localhost`라 **`-uroot`를 써야 한다.**

---

## 5. 첫 청구서 발행 조건

- `billings` 실행 이력 = 금강제화 시험 발행 1건(15 items). **구조 변경 후 삭제·재발행 필요.**
  0725에 `DELETE /:id`가 `ai_credit_requests.billed`를 되돌리도록 고쳤으므로 안전하게 지워진다.
- 대기가 다 떨어지는 데 3일 걸린다(Harold) → **8/4 이후**에 뽑아야 확정값.
- 검증 1건 = 거래내역서에 **MMS 308,043건**이 잡히는지.
- 선불 회사는 `/generate`가 400으로 차단한다(발송 시 잔액 차감 완료 = 이중 청구 방지). 후불 103 / 선불 38.

---

## 6. 별건 (정산과 분리)

- **`pay-ingest-db` 23388 외부 노출** — 외부 `nc` succeeded 실측. 계정은 전부 호스트 제한(`%` 0건, 원격 root 없음)이라 인증은 차단되고, `Aborted_connects` 23건/18.4일 + 외부 시도 로그 0건이라 공격 흔적은 없다. **방화벽 명세** = `DOCKER-USER` 체인에서 `139.150.81.213`·`58.227.193.54`·`.57`·`.58`(= `sales` 계정 허용 IP)만 23388 허용. 적용 후 외부 `nc` 실패 + 적재 정체 알림 없음이면 성공. 트립와이어는 이미 가동 중.
- **브랜드메시지 발송 비가동** — `IMC%` 테이블 전 스키마 0개 + `campaigns.ts:2842` INSERT가 없는 컬럼 `name`에 씀(실제 `campaign_name`). 기능 폐기/복구 판단 필요. spawn_task 등록됨.
- **서버 레포 위생** — `packages/backend/uploads/` xlsx 47개가 git 추적 상태로 디스크에서 삭제됨 / 루트 잔재(`ALTER`, `^C`, `.env.backup-20260520`) / `packages/backend/data/` 권한 오류 / `.env`에 `PAY_STATS_DB_USER` 중복 2줄.
- **피케이포유 대상ID 인코딩 손상** — UTF-8 502,944 vs EUC-KR 이중인코딩 192,097(hex 실측). 게이트웨이 ingest 손상.

---

## 7. 이번 세션에서 얻은 교훈 (반복 금지)

- **배포 로그의 초록불 ≠ 반영** — `git pull`이 `Aborting`으로 죽었는데 그 뒤 `npm install`·`build:safe`·`pm2 reload`가 전부 성공 완주했다. 배포 첫 단계는 pull **결과 확인**이고, 신규 의존성은 `added N packages`를 봐야 한다. 락파일 충돌은 그 파일만 되돌린다(`git stash` 금지 — uploads 삭제분이 되살아난다). → `LESSONS_DEPLOY.md` 등재.
- **전수 grep은 패턴이 아니라 전 출현 분류로** — 하루에 세 번 놓쳤다. 화면 축 폴백 / 서버 보정 page / `plan_id` 쓰기 2곳. `SET plan_id` 리터럴 grep이 `plan_id = COALESCE($6, plan_id)`를 못 잡았다.
- **컬럼은 SCHEMA.md grep → 코드 실사용 확인 → 덤프 요청 후 즉시 등재** — 확인 없이 `campaigns.name`·`RSRM_SalesStts.SuccCnt`를 써서 두 번 에러를 냈다. → `LESSONS_DB.md` 핵심 원칙 최상단 + `feedback_schema_record_then_reuse` 등재.
- **Codex 지적은 실측으로 취사** — 0725 1차에서 브랜드메시지 3건은 DB 실측으로 기각(코드만 보면 맞아 보였다). 2차·3차에서는 6건 전부 수용(내가 만든 결함이었다).
