# 선불 요금제 이용 기간 (자동 연장 · 1개월 연장) 설계서

> 작성 2026-10-04 · 브레인스토밍 회의(기획·프론트엔드·디자이너·백엔드·회의론자) 수렴안 + 회의론자 최종 검증 반영
> 상태: **운영 적용(2026-10-04)** · 코드 `c8da552e`(1차) + `c9063096`(Codex 4R 정정) · 배포 = pull 14:56:32 → 백엔드 재시작 14:56:43 → 프론트 빌드 14:58 · DDL(§2) = Harold 실행 완료
> 첫 관리 회사 = (주)이에스페이먼트 · 스타터(월 150,000원) · 10/4 기간 시작(결제 없음 · 10/4~11/1) · 자동 연장 켬 · **첫 자동 결제 = 2026-11-02 165,000원(11/2~12/1)** · 시작 시점 잔액 356,022원
> 남은 것 = 실측 §9(11/2 첫 자동 결제 또는 고객 관리자 1개월 연장 1회) · 대표 확인 §10(잠긴 동안 CDP 수집)

---

## 0. 요구와 확정 결정

**요구 원문(Harold 2026-10-04)**
후불은 정산서에 요금제가 같이 나가니 관계없다. 선불로 요금제를 쓰는 업체는 차감일 기준 정확한 한 달로 선불 잔액에서 자동 차감하거나, 직접 추가를 누르는 방식이다. 자동 결제는 잔액이 적으면 결제 실패로 요금제가 바로 차단된다. 직접 방식은 누를 때마다 "추가 결제를 하시겠습니까?" 확인 창을 띄우고 로그를 남긴다. 30일 중 6일을 쓰고 24일 남았을 때 추가하면 남은 기간 뒤에 누적으로 연장한다.

**확정 결정**
| # | 결정 |
|---|---|
| D1 | 한 달 = 달력 기준(10/4 시작 → 11/3 만료, 1/31 → 2/28 말일 보정). 버튼 = "1개월 연장" |
| D2 | 차단 = 미가입(FREE)처럼 잠금. 직접발송·수신거부·발송결과는 계속. 충전 후 연장하면 원래 요금제로 즉시 복구 |
| D3 | 기간 중 올림 = 남은 기간 일할 차액 즉시 차감, 만료일 유지 / 내림 = 지금 기간이 끝난 뒤부터, 환불 없음 |
| D4 | 현재 선불 유료 회사 = 이에스페이먼트 1곳. 기본 = 자동 연장 켬. 고객사가 스위치를 직접 켜고 끈다(고객사 요청) |
| D5 | 연장 버튼·스위치는 고객사 관리자만. 자동을 켜 둬도 직접 연장 가능, 미리 연장하면 자동 결제일도 밀린다 |
| D6 | 1개월 금액 = 요금제 월정액(`plans.monthly_price`, 부가세 별도) + 부가세. 선불 잔액은 부가세 포함가로 깎는다 |

**범위 밖(넣지 않음)**: 만료 전 잔액 부족 사전 알림 · 환불 · 잠긴 뒤 자동 재시도 · 슈퍼관리자 대리 유료 연장 · 누적 연장 상한 · 슈퍼관리자 내림 예약 취소 버튼 · "선불·유료·기간 미설정" 전체 경고 목록(회사 상자의 한 줄로 대신).

---

## 1. 회의 경과

### 1-1. 갈린 지점과 택한 쪽
| # | 쟁점 | 택한 쪽 | 근거 |
|---|---|---|---|
| G1 | 상태 저장 위치 | `companies` 컬럼 5개(기획·회의론자) | `plan_id`와 복구 요금제가 한 행 한 UPDATE(LESSONS_DB 33). 잠금이 회사 한 행이라 교착이 없다 |
| G2 | 내림 예약 | 날짜 없는 "다음 구매 요금제"(회의론자). 날짜별 요금제는 원장이 정한다 | 적용일 칸 하나로는 "미리 연장 뒤 두 번째 내림"이 첫 예약을 덮는다 |
| G3 | 직접 연장 멱등 | 회차(version) CAS + requestId 재생 | 돈 안전은 CAS, 응답 유실 뒤 재시도는 재생으로 "완료"를 돌려준다 |
| G4 | 슈퍼관리자 회사 수정 | 관리 중 회사의 요금제 변경은 409 | 요금제 변경은 고객 신청 승인 한 길. 종료는 상자의 [관리 종료] |
| G5 | 스위치 확인 | 켜기 = 확인 없음(토스트) / 끄기 = 확인 한 단계 | 사전 알림이 범위 밖이라 끄는 순간이 "만료되면 잠긴다"를 알릴 유일한 지점(CLAUDE.md `marketing_user_ux_priority` 허용 단계) |
| G6 | 잠긴 동안 CDP 수집 | D2 그대로(FREE와 같이 막힘) | D132(요금제 판정 = plan_code 하나). 데이터 유실 가능성은 §10 대표 확인 사항 |
| — | 새 거래 type `plan_fee` | 쓰지 않는다. `type='deduct'` + `reference_type='plan_term'` | 새 type이면 잔액 요약(balance.ts:166)·관리자 필터(admin.ts:4907)에서 조용히 빠진다(CHECK 없음) |
| — | 직접 연장 잔액 부족 기록 | 원장에 남기지 않는다(402만) | 돈이 안 움직였고 화면이 먼저 막는다. 자동 결제 실패는 `block` 행에 {잔액, 필요액} |
| — | 복구 시 무료 메시징 | 특별 지급 없음 | 기존 규칙 "월 중 요금제 변경 = 당월 지급분 불변"(free-messaging.ts:531) 그대로 |

### 1-2. 회의론자 최종 검증 반영표
| # | 등급 | 지적 | 반영 |
|---|---|---|---|
| 1 | high | 다음 구매 요금제가 FREE(0원)면 0원 연장이 반복된다 | 만료 처리 1순위 = 0원 요금제면 `expire_free`(plan_id←FREE, 관리 종료). 직접 연장도 409 `NEXT_PLAN_FREE`. 0원인 내림 목표는 FREE만 허용 |
| 2 | high | DDL 전 "컬럼 없음"과 "미관리"를 구별 못 해 선불 승인이 실패 | 잠금 SELECT 한 번에 `to_jsonb(c) ? 'plan_term_version'` + `to_regclass(이벤트 표)`를 읽어 준비 안 됨이면 미처리(기존 경로) |
| 3 | high | 재생·CAS 순서 미정 → 이중 결제 | 잠금 → requestId 조회(있으면 그 행을 그대로 재생) → version·금액 CAS → 차감. requestId는 연장·복구 둘 다 |
| 4 | medium | 관리자 만료일 조정·종료에 CAS 없음 | 둘 다 `version` 필수. 만료일은 구매 구간 끝보다 앞당길 수 없다(409 `PAID_THROUGH`) |
| 5 | medium | 만료~워커 사이 창에서 승인한 올림이 0원 처리 | 모든 진입(승인·견적·연장·관리자 조작)이 잠금 직후 만료 정산(settle)을 먼저 돈다 |
| 6 | medium | 정렬 가드가 놓친 경계를 다시 못 잡는다 | 가드 = "plan_id = 마지막으로 plan_id를 정한 이벤트의 요금제". 오늘이 덮이지 않으면 정렬 안 함. 구매 직후 정렬은 오늘 기준만 |
| 7 | medium | revoke-basic-trial이 관리 회사를 FREE로 | 그 WHERE에 관리 제외 조건. CT가 유료 요금제를 쓸 때 `subscription_status='paid'`, `trial_expires_at=NULL` |
| 8 | medium | 잠긴 회사에 마케팅 진단 체험이 열린다 | 진단 자격 판정에 관리 중 제외. 체험 코어는 타입 오류(409)로 던진다 |
| 9 | medium | 매월 1일 무료 메시징 지급이 정산보다 먼저 돌 수 있다 | 지급 SQL 두 곳에 "만료일 < 오늘(정산 전)인 관리 회사 제외" |
| 10 | medium | 종료로 우회한 선불→후불 전환이 구독료를 두 번 받는다 | 전환 게이트 = 관리 중 활성이면 409 / 잠김이면 종료 후 통과 / 미관리라도 구매 구간 끝 ≥ 오늘이면 409 `PAID_TERM_REMAINS` |
| 11 | medium | DATE 하루 밀림·UTC 오늘 | date 칸은 전부 `to_char(...,'YYYY-MM-DD')`로 읽고 쓰기는 `$n::date`. 오늘 = `todayKst()` 하나. CT에 `CURRENT_DATE` 0건(계약 테스트) |
| 12 | medium | DDL 전 읽기 확장이 42703 | my-plan·plan-request/status는 별도 try 블록 + 준비 판정. 관리자 화면은 전용 GET 하나로만 읽는다 |
| 13 | low | 미리 산 싼 달을 중간 요금제로 못 올린다 | 수용하지 않음(기록만). 내림은 다음 구매에만 적용된다는 규칙이 단순하고, 올리려면 지금 요금제 이상을 신청한다 |
| 14 | low | 같은 요금제 재신청이 가격 인상분을 받는다 | 차액은 "그날 요금제 ≠ 목표"인 날만 센다. 같은 요금제인 날은 0원 |
| 15 | low | 회계 표시 기준 갈림 | 제외 조건 = `reference_type IS DISTINCT FROM 'plan_term'`. 관리자 라벨 두 곳 모두 |
| 16 | low | start covers 역전 · end 잔여 칸 | start covers는 만료일 ≥ 오늘일 때만. end는 세 칸을 한 UPDATE로 비운다. CHECK 추가 |
| 17 | low | AI 크레딧 보충 조건 오탐 | 조건 = `source='monthly-reset'` 리셋 행이 잠긴 시각 뒤에 있는가 |

### 1-3. Codex 적대 리뷰 (gpt-6-astra · 기본 모델은 ChatGPT 계정 거절)
| 라운드 | 지적 | 처리 |
|---|---|---|
| 1R | [high] 올림이 이미 산 더 비싼 미래 구간까지 덮어씀 | 바꾸는 날 = 차액을 세는 날(그날 요금제 ≠ 목표 · 가격 ≤ 목표)의 연속 구간마다 upgrade 행(`upgradeRuns`). 비싼 구간 보존 |
| 1R | [high] 관리 종료 뒤 재시작이 지난 기간 원장의 요금제로 결제 | 원장 = 마지막 end·expire_free 이후만(`currentTermEvents`). 결제방식 전환의 이미 낸 기간 판정만 전 기간 |
| 1R | [medium] 월초 미리 산 내림 구간이 정렬 전 이전 요금제 수량으로 지급 | 지급 워커가 이용 기간 패스를 먼저 기다린다 |
| 2R | [high] 미래 구간만 올린 행이 정렬 가드를 막아 결제한 구간 미적용 | upgrade 행 `detail.sets_plan` · 가드는 오늘 plan_id를 실제로 바꾼 행만 |
| 2R | [medium] 정산 실패 뒤에도 이전 요금제 수량 지급 | 패스가 실패 회사(`failed`)를 돌려주고 지급에서 제외 · 패스 실패면 관리 회사 전부 제외 |
| 2R | [medium] 전날 진행 패스를 오늘 정산으로 취급 | 진행 패스의 기준일 저장 · 다른 날 요청은 끝난 뒤 그 날로 다시 |

---

## 2. 데이터 (DDL · Harold 실행 · 배포 뒤)

> 코드는 컬럼·표가 없을 때 기존 동작 그대로다(§8). 실행 순서: 배포 → 아래 DDL → 검증 SQL.

```sql
BEGIN;
SET LOCAL lock_timeout = '3s';

ALTER TABLE companies
  ADD COLUMN plan_term_expires_on      date    NULL,
  ADD COLUMN plan_term_auto_renew      boolean NOT NULL DEFAULT true,
  ADD COLUMN plan_term_restore_plan_id uuid    NULL REFERENCES plans(id),
  ADD COLUMN plan_term_next_plan_id    uuid    NULL REFERENCES plans(id),
  ADD COLUMN plan_term_version         integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT companies_plan_term_restore_needs_term
    CHECK (plan_term_restore_plan_id IS NULL OR plan_term_expires_on IS NOT NULL),
  ADD CONSTRAINT companies_plan_term_next_needs_term
    CHECK (plan_term_next_plan_id IS NULL OR plan_term_expires_on IS NOT NULL);

CREATE TABLE company_plan_term_events (
  id               uuid PRIMARY KEY,
  company_id       uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  term_version     integer NOT NULL,
  event_type       varchar(20) NOT NULL CHECK (event_type IN (
                     'start','first_charge','renew','extend','restore','upgrade',
                     'reserve','reserve_cancel','align','block','expire_free',
                     'auto_on','auto_off','admin_adjust','end')),
  plan_id          uuid NULL REFERENCES plans(id),
  plan_code        varchar(20) NULL,
  monthly_price    numeric(12,2) NULL,
  covers_from      date NULL,
  covers_to        date NULL,
  supply_amount    numeric(15,2) NOT NULL DEFAULT 0,
  vat_amount       numeric(15,2) NOT NULL DEFAULT 0,
  total_amount     numeric(15,2) NOT NULL DEFAULT 0,
  balance_before   numeric(15,2) NULL,
  balance_after    numeric(15,2) NULL,
  balance_tx_id    uuid NULL,
  expires_before   date NULL,
  expires_after    date NULL,
  actor_type       varchar(20) NOT NULL CHECK (actor_type IN ('company_user','super_admin','system')),
  actor_id         uuid NULL,
  actor_label      varchar(100) NULL,
  request_id       uuid NULL,
  ip               varchar(64) NULL,
  user_agent       text NULL,
  reason           text NULL,
  detail           jsonb NULL,
  created_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT company_plan_term_events_version_uq UNIQUE (company_id, term_version),
  CONSTRAINT company_plan_term_events_covers_ck CHECK (covers_from IS NULL OR covers_to >= covers_from)
);
CREATE UNIQUE INDEX company_plan_term_events_request_uq
  ON company_plan_term_events (company_id, request_id) WHERE request_id IS NOT NULL;
CREATE INDEX company_plan_term_events_company_created
  ON company_plan_term_events (company_id, created_at DESC);

COMMIT;
```

**검증 SQL**
```sql
SELECT column_name, data_type, column_default, is_nullable
  FROM information_schema.columns
 WHERE table_name = 'companies' AND column_name LIKE 'plan_term_%' ORDER BY column_name;
SELECT count(*) AS cols FROM information_schema.columns WHERE table_name = 'company_plan_term_events';
```
기대: companies 5행 · 이벤트 표 27열.

**되돌리기**: `DROP TABLE company_plan_term_events; ALTER TABLE companies DROP COLUMN plan_term_expires_on, DROP COLUMN plan_term_auto_renew, DROP COLUMN plan_term_restore_plan_id, DROP COLUMN plan_term_next_plan_id, DROP COLUMN plan_term_version;` (코드는 부재에서 기존 동작으로 돌아간다)

**칸의 뜻**
| 칸 | 뜻 |
|---|---|
| `plan_term_expires_on` | 만료일(KST 날짜, 그날 포함). NULL = 관리 대상 아님 |
| `plan_term_auto_renew` | 자동 연장 스위치(기본 켬, D4) |
| `plan_term_restore_plan_id` | 값이 있으면 **잠김**. 연장하면 이 요금제로 복구 |
| `plan_term_next_plan_id` | 다음 구매에 쓸 요금제(내림 예약). 구매가 일어나면 비운다 |
| `plan_term_version` | 회차. 모든 변경마다 +1. 관리 종료해도 되돌리지 않는다(이벤트 UNIQUE와 충돌 방지) |

---

## 3. 원장 규칙 (순수 함수 · `utils/plan-term-calc.ts`)

| 함수 | 규칙 |
|---|---|
| `periodEnd(S)` | 다음 달에 S와 같은 날이 있으면 그날 −1일, 없으면 다음 달 말일. 다음 시작 = 만료 + 1일 |
| `monthlyCharge(price)` | supply = floorWon(price) · vat = vatOfSupply(supply) · total = supply + vat |
| `planOfDay(events, d)` | d를 덮는 이벤트(covers 있는 것) 중 회차 최대 행의 요금제·가격 |
| `denomOfDay(events, d)` | d를 덮는 **구매** 이벤트(first_charge·renew·extend·restore) 중 회차 최대 행의 covers 일수. 없으면 그 달 실제 일수 |
| `upgradeCharge(events, today, expires, target)` | 공급가 = floorWon(Σ_{d=오늘..만료일, 그날 요금제 ≠ 목표} max(0, 목표가 − 그날 가격) ÷ 분모), 절사는 합계에서 1회, 총액 = + vatOfSupply |

**periodEnd 고정 벡터**: 10/4→11/3 · 1/31→2/28 · 2028-01-31→2028-02-29 · 1/30→2/28 · 1/29→2/28 · 2028-01-29→2/28 · 1/28→2/27 · 3/31→4/30 · 12/31→1/30 · 2/28→3/27 · 4/30→5/29
**차액 성질**: 구매 구간 첫날 올림 = 정확히 한 달치 차액 · 두 번 연속 올림은 이중으로 받지 않는다 · 같은 요금제인 날은 0원 · 구매 아닌 구간(start·admin_adjust)은 그 달 일수로 나눈다

**다음 구매 요금제** = `next_plan_id ?? planOfDay(만료일) ?? 현재 plan_id`. 가격은 그 요금제의 **현재** `plans.monthly_price`(구매 시점 정가).

---

## 4. CT 동작 (`utils/plan-term.ts` · 이 파일만 `plan_term_*`와 이벤트 표를 쓴다)

공통
- 잠금 = `companies` 행 `FOR UPDATE` 하나(prepaidDeduct·AI 충전과 같은 축). 같은 SELECT에서 준비 여부(§8)를 읽는다.
- 모든 변경 = `UPDATE companies SET plan_term_version = version + 1 ... WHERE id AND plan_term_version = $v` 로 회차를 차지하고 이벤트 1행.
- 잔액 차감 = `balance >= total` 조건부 UPDATE + `balance_transactions(type 'deduct', reference_type 'plan_term', reference_id = 이벤트 id, payment_method 'system', balance_before, balance_after, created_by = 고객 사용자면 그 id)`.
- 유료 요금제로 plan_id를 쓸 때 `subscription_status='paid'`, `trial_expires_at=NULL`을 함께 쓴다(체험 경로가 관리 회사를 건드리지 못하게).
- plan_id가 바뀌면 같은 트랜잭션에서 `recordPlanChange(changeType 'auto', effectiveDate 오늘)`.
- 오늘 = `todayKst()` 하나를 인자로 넘긴다.

| 동작 | 내용 |
|---|---|
| settle(만료 정산) | 관리 중·잠김 아님·만료일 < 오늘일 때. ① 다음 구매 요금제가 0원 → FREE면 `expire_free`(plan_id←FREE, 세 칸 비움), 아니면 알림만 ② 자동 켬 + 잔액 충분 → `renew`(covers = 만료+1 ~ periodEnd) 후 정렬 ③ 그 밖 → `block`. 한 번에 1회차 |
| block | plan_id←FREE, restore←(next ?? planOfDay(만료일) ?? plan_id), next 비움, detail {reason: insufficient·auto_off, balance, required} |
| extend(직접) | settle 먼저. 잠김이면 restore로. 아니면 covers = 만료+1 ~ periodEnd, 다음 구매 요금제 가격, next 비움 |
| restore | covers = 오늘 ~ periodEnd(오늘), plan_id←복구 요금제(또는 승인 목표), restore 비움, AI 크레딧 보충(아래) |
| 정렬(align) | 오늘이 덮여 있고 planOfDay(오늘) ≠ plan_id 이며 plan_id = 마지막으로 요금제를 정한 이벤트(start·first_charge·restore·upgrade·align)의 요금제일 때만 교체. 그 밖의 불일치는 손대지 않고 `sendSystemAlert` |
| AI 크레딧 보충 | restore 때 `ai_credit_transactions`에 `source='monthly-reset'` 행이 잠긴 시각 이후에 있으면(잠긴 동안 FREE 기준으로 월 리셋이 돌았으면) base = 복구 요금제 월 크레딧 + min(0, base), 'reset' 행 1개(키 `plan-term-restore:{회사}:{회차}`, source `plan-term-restore`) |
| 워커 | 기동 즉시 + 10분. 후보 = 관리 중·잠김 아님 AND (만료일 < 오늘 OR 오늘 요금제 불일치 가능). 회사별 트랜잭션에서 재판정. `companies.status='terminated'`나 선불 아님이면 알림만 |

---

## 5. 경로 연결 · 영향표

### 5-1. `plan_id`를 쓰는 곳 전수(grep `plan_id\s*=`)
| 위치 | 경로 | 처리 |
|---|---|---|
| routes/admin.ts:1719 | 슈퍼관리자 회사 수정 | 관리 중 + 요금제 실제 변경 → 409 `PLAN_TERM_MANAGED` |
| routes/admin.ts:2942 | 요금제 신청 승인 | CT `applyPlanRequestWithClient` 먼저. 처리되면 기존 UPDATE·이력 건너뜀(§5-2) |
| routes/companies.ts:1849 | grant-trial | UPDATE WHERE에 관리 제외 + 0행이면 409 |
| routes/companies.ts:1915 | revoke-trial | 변경 없음(TRIAL 요금제 회사만 · 관리 회사는 TRIAL이 될 수 없다) |
| routes/companies.ts:2113 | revoke-basic-trial | WHERE에 관리 제외 |
| routes/companies.ts:2202 | 고객사 수정 PUT /:id | 관리 중 + 요금제 실제 변경 → 409 |
| utils/basic-trial.ts:110 | 체험 지급 코어(승인 체험 · 슈퍼관리자 · 진단 자동) | 잠금 SELECT에서 관리 중이면 `PlanTermManagedError`(409) |
| utils/trial-downgrade-worker.ts:123 | 체험 만료 강등 | 변경 없음(CT가 `trial_expires_at=NULL`이라 대상이 안 된다) |
| utils/company-create.ts · account-issue.ts | 회사 생성 INSERT | 변경 없음(신규 = 미관리) |
| **utils/plan-term.ts** | 정산·연장·복구·올림·정렬·잠금 | 신규 CT |

### 5-2. 신청 승인 판정(`applyPlanRequestWithClient`)
| 상태 | 목표 | 결과 |
|---|---|---|
| 준비 안 됨(DDL 전) · 선불 아님 | 모두 | 미처리(기존 경로) |
| 관리 중 | 체험·TRIAL | 409 |
| 관리 중 + 잠김 | 유료 | 그 요금제로 restore(오늘부터 1개월) |
| 관리 중 + 잠김 | FREE | 관리 종료(요금제 FREE 유지) |
| 관리 중 + 활성 | 목표가 ≥ 오늘 가격 | 차액(§3) 즉시 → `upgrade`(covers 오늘~만료일), plan_id 교체, next 비움. 같은 요금제이고 차액 0이면 next만 비움(`reserve_cancel`) 또는 무변화 |
| 관리 중 + 활성 | 목표가 < 오늘 가격 | `reserve`(next ← 목표). 0원 목표는 FREE만 |
| 미관리 선불 | 유료 | 오늘부터 1개월 구매 `first_charge`로 관리 시작 |
| 미관리 선불 | FREE | 미처리 |
| 잔액 부족 | — | 402, 신청은 pending 유지 |

### 5-3. 그 밖의 연결
| 위치 | 처리 |
|---|---|
| utils/billing-type-history.ts `switchCompanyBillingType` | 선불→후불: 관리 중 활성 409 `PLAN_TERM_ACTIVE` / 잠김이면 같은 트랜잭션에서 관리 종료 후 통과 / 미관리라도 구매 구간 끝 ≥ 오늘이면 409 `PAID_TERM_REMAINS`. 후불→선불: 자동 생성 없음 |
| utils/marketing-diagnosis-grant.ts `judgeGrantEligibility` + `/state` | 관리 중이면 대상 아님 |
| utils/free-messaging.ts 지급 SQL 두 곳 | 관리 중 + 만료일 < 오늘(정산 전) 회사 제외 |
| utils/company-merge.ts `COMPANY_MERGE_AXES` | `company_plan_term_events` keep |
| routes/companies.ts monthly_spend · routes/admin.ts balance-overview | `reference_type IS DISTINCT FROM 'plan_term'` (카드 설명 = "이번 달 발송 사용 금액", dashboard-card-pool.ts:51) |
| AdminDashboard 잔액 이력 라벨 두 곳 | `reference_type='plan_term'` = "요금제 이용료" |
| 변경 없음(확인) | prepaidRefund·loadDeductLedger·sweeper·회수는 (reference_type, reference_id) 짝으로 읽어 이 행을 안 집는다(prepaid.ts:49·398·422·578, mysql-refund-sweeper.ts:127) · 정산서(선불 발행 차단) · balance.ts summary(차감 합계에 포함 = 잔액 항등식 유지) |

---

## 6. API

**고객** (`routes/plan-term.ts` → `/api/companies/plan-term`, 로그인 필수)
| 메서드 | 경로 | 권한 | 내용 |
|---|---|---|---|
| GET | `/api/companies/my-plan` 의 `prepaid_term` | 로그인 | {state active·blocked, plan_name, plan_code, expires_on, days_left, auto_renew, next_charge_date, next_charge_total, price_supply, price_vat, price_total, next_plan_name, next_plan_from, block_reason, block_snapshot, can_manage} · 미관리·준비 안 됨 = null |
| GET | `/events?offset&limit` | 로그인 | 이력(label·actor_label은 서버 문장) |
| GET | `/quote` | 회사 관리자 | {version, plan_name, restoring, expires_before, starts_on, new_expires, supply, vat, total, balance, balance_after, enough, auto_renew} |
| POST | `/extend` {requestId, version, total} | 회사 관리자 | 200 / 200 replayed / 409 `QUOTE_CHANGED`{quote} / 409 `NEXT_PLAN_FREE` / 402 |
| PATCH | `/auto-renew` {enabled} | 회사 관리자 | 같은 값이면 무변화 |
| GET | `/api/companies/plan-request/status` | — | 승인된 신청이 내림 예약이면 `scheduled_from` |

**슈퍼관리자** (`/api/admin/companies/:id/plan-term`)
| 메서드 | 경로 | 내용 |
|---|---|---|
| GET | `/` | 상태 + 최근 이벤트 30 + 시작 가능 여부 |
| POST | `/start` {expiresOn, reason} | 결제 없음. 조건 = 선불·유료·비TRIAL·미관리, 만료일 ≥ 어제. 만료일 = 어제면 다음 틱에 첫 결제 |
| PATCH | `/expires` {expiresOn, reason, version} | 돈 이동 없음. 잠김이면 409. 구매 구간 끝보다 앞당기면 409 |
| PATCH | `/auto-renew` {enabled} | 대리 변경(처리자 기록) |
| POST | `/end` {reason, version} | 관리만 종료. 요금제 그대로, 환불 없음 |

---

## 7. 화면

| 위치 | 내용 |
|---|---|
| /pricing 맨 위 `PrepaidTermCard` | ZoneStatStrip 4칸(끝나는 날 · 남은 날 · 1개월 요금 · 다음 자동 결제). footnote = [자동 연장 스위치 + 결과 한 줄] [1개월 연장], 관리자 아니면 읽기 전용 한 줄. 내림 예약 한 줄. 최근 기록 5줄 + 더 보기 |
| 잠김 | rose 블록: "{요금제} 요금제가 잠겼습니다" · 사유(그때 잔액·필요액) · "문자 직접 발송, 수신거부, 발송결과는 그대로 쓸 수 있습니다" · [잔액 충전] [1개월 연장하고 다시 열기] · "충전만으로는 자동으로 열리지 않습니다". '미가입' 배지 숨김 |
| 연장 확인 창 | ConfirmDialogShell(emerald). 제목 "추가 결제를 하시겠습니까?" · 결제 금액(부가세 포함) 크게 + "월 요금 X원 + 부가세 Y원" · 지금 이용 기간 → 연장 후 · "남은 N일은 그대로 두고 그 뒤에 1개월을 이어 붙입니다" · 충전 잔액 A → B · 조건 줄. 부족이면 주 버튼 = [잔액 충전하기](창 닫고 BalanceModals 충전) |
| 끄기 확인 | ConfirmDialogShell(amber) "자동 연장을 끌까요?" · "{만료일}이 지나면 {요금제} 요금제가 잠깁니다. 그 전에는 언제든 직접 1개월 연장할 수 있습니다." 켜기는 토스트 |
| PricingPage | 신청 창 규칙 한 줄(관리 회사만) · 결과 창 `scheduled_from`이면 "M/D부터 변경 예정" |
| Dashboard | PlanChangeModal: 잠김이면 잠김 문구 · 요금제 현황 카드: 잠김/남은 날 배지 |
| AdminDashboard | 단가/요금 탭 선불 잔액 아래 `PlanTermBox`(상태 · 스위치 · 기간 시작/만료일 조정 · 관리 종료 · 최근 기록) · 기본정보 요금제 선택칸: 관리 중이면 비활성 + 이유 한 줄 · 승인 완료 = 서버 message · 잔액 이력 라벨 |
| BalanceModals | 충전 창 `w-full max-w-[460px]`(375 폭 넘침) |

고객 문구: "잠김 / 다시 열림" 하나로. 줄표 금지. 내부 용어 금지.

---

## 8. DDL 전 배포 안전

| 경로 | 컬럼·표 없을 때 |
|---|---|
| 준비 판정 | 잠금 SELECT 안 `to_jsonb(c) ? 'plan_term_version' AND to_regclass('public.company_plan_term_events') IS NOT NULL` |
| 승인 · 회사 수정 · 체험 · 결제방식 전환 · 진단 · 무료 메시징 게이트 | `to_jsonb(...)->>'plan_term_expires_on'`로 읽는다 → NULL = 미관리 = 기존 동작 |
| 워커 | 준비 안 됨이면 1회 경고 후 건너뜀 |
| my-plan · plan-request/status | 별도 try 블록 → `prepaid_term` null |
| 고객·관리자 plan-term 라우트 | 503 `DB_MIGRATION_PENDING`(LESSONS_DB DB ALTER 안전망) |

---

## 9. 검증

**테스트(`utils/__tests__/plan-term-*.test.ts`)**: periodEnd 벡터 · monthlyCharge · upgradeCharge 성질 4종 · decide(승인 판정표) · 소스 스캔 계약 3종(① `plan_term_` 쓰기·이벤트 표 INSERT는 CT 파일만 ② CT 파일에 `CURRENT_DATE` 0건 ③ plan_id 쓰기 파일 허용 목록).

**실측 1건 시나리오(6원칙 ⑤ · 배포·DDL 뒤 Harold)**
1. 슈퍼관리자 → 이에스페이먼트 단가/요금 탭 → [이용 기간 시작] 만료일 = 대표가 정한 날짜.
2. 고객 관리자로 /pricing → 카드 확인 → [1개월 연장] → 확인 창 금액 = 월정액 × 1.1 → 결제.
3. SQL: `SELECT event_type, total_amount, expires_before, expires_after, balance_before, balance_after FROM company_plan_term_events WHERE company_id = '<ESP>' ORDER BY created_at DESC LIMIT 3;` 와 `SELECT type, reference_type, amount, balance_after FROM balance_transactions WHERE company_id = '<ESP>' AND reference_type = 'plan_term' ORDER BY created_at DESC LIMIT 1;` → 금액·잔액 일치.

---

## 10. 대표 확인 사항 · 추가 과제(착수 안 함)

- **잠긴 동안 자사몰 연동(CDP) 수집이 막힌다**(FREE와 같음 · cdp-auth.ts:396). 이에스페이먼트가 그 수집을 쓰면 잠긴 기간 데이터는 되살릴 수 없다. 열려면 cdp-auth 수집 세 곳에 "잠김이면 통과" 한 조건(별건).
- 잠긴 동안 기존 자동발송·여정은 계속 돈다(요금제 재확인 없음 · 기존 체험 만료와 같은 성질) → BUGS 등재 대상.
- 슈퍼관리자 구독 상태 선택칸에서 expired·suspended를 고르면 발송까지 막힌다(D2와 충돌하는 수동 경로 · 기존).
- AdminDashboard 잔액 이력에서 `credit_recharge`(AI 크레딧 선불 충전)도 "발송 차감"으로 보인다(기존).
- 미리 산 싼 달을 중간 요금제로 올리는 길이 없다(§1-2 #13).
