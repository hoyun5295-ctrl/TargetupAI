# 여정 엔진 전면 재설계 설계서 (2026-06-04)

> 작성: 비토(CTO) · 승인 대기: Harold
> 최우선 목표 — **조건 맞는 타겟을 정확하고 실수 없이 추출해 보낸다. 자유여정 포함, 오발송·누락 0.**
> 원칙 — 추측 금지(첫 SQL은 순수 덤프) · DB 컬럼은 information_schema 선검증 · 테스트는 BEGIN/ROLLBACK 발송 0 · 코드 수정만(배포는 Harold).

---

## 0. 한 줄 진단 — 모든 결함의 공통 뿌리

지금 엔진은 타겟을 **"시간 창(최근 N시간 / 직전 5분)"** 으로 잡는다. 이 한 가지가 두 방향으로 동시에 터진다.

- **누락** — 5분 cron 워처가 한 번이라도 5분 넘게 밀리거나 멈추면, 그 사이 발생한 진짜 이벤트(구매·예약·장바구니)는 창을 벗어나 **영원히 안 잡힌다**.
- **오발송** — 대량 업로드·재업로드처럼 짧은 시간에 데이터가 한꺼번에 들어오면 전부 창에 걸려 **한꺼번에 발송**된다(실측: 2만 건 2초 적재 → 전원 신규 오인 → LIMIT 500 발송).

그래서 재설계의 척추는 **"시간 창"을 버리고, ① 진입 원장(이미 본 고객) ② 상태 전환(edge) 감지 ③ 전 trigger 공통 안전필터** 로 바꾸는 것이다. 발송은 직접발송처럼 묶고, 조건 평가는 실패 시 발송이 아니라 멈춤으로 받는다.

---

## 1. 현 구조 (코드 사실)

### 1.1 워커 3종 + 알림 워커 1종

| 워커 | 주기 | 역할 | 파일 |
|---|---|---|---|
| trigger-watcher | 5분 | 활성 여정 trigger 매칭 → `journey_executions` enqueue | `journey-trigger-watcher.ts` |
| executor | 5분 | due execution 처리 → step 발송 + advance | `journey-executor.ts` |
| reentry-worker | 6시간 | completed + cooldown 경과 → 자동 재진입 | `journey-reentry-worker.ts` |
| pretest-notifier-worker | 5분 | 발송 2h 전 담당자 알림 발송 | `journey-pretest-notifier(-worker).ts` |

### 1.2 테이블 (확인된 것)

- `journeys` — template_code(onboarding/repeat/dormant/cart/birthday/reservation/custom), trigger_event, trigger_filters(jsonb), status, allow_reentry, reentry_cooldown_days, auto_reentry_enabled, callback_number/mode, 임계값·예산, stats, archived_at.
- `journey_steps` — step_order, step_type(message/wait/condition), delay_hours, **delay_mode(relative/specific_hour/next_business_day)**, target_hour_kst, channel, message_template, subject, is_ad, condition_jsonb, alimtalk_*(7), mms_image_paths, notify_manager_on_pretest.
- `journey_executions` — journey_id, customer_id, current_step_order(0=진입만), status(active/completed/paused/failed/ended), entered_at, next_run_at, completed_at, error_count.
- `journey_step_logs` / `journey_step_snapshots`(활성화 본문 보존) / `journey_step_variants`(밴딧) / `journey_pretest_schedules` / `journey_step_pause_logs`.

### 1.3 trigger 7종 (extractor + builder)

| template | trigger_event | 현 추출 기준 |
|---|---|---|
| onboarding | customer.created | `customers.created_at >= NOW()-N시간` |
| repeat | cdp.purchase | `cdp_events.purchase 직전 5분` |
| reservation | cdp.reservation_created | `cdp_events 직전 5분` |
| dormant | customer.dormant | `recent_purchase_date` N~N+7일 밴드 |
| cart | cdp.cart_abandon | `cart_add` 후 checkout/purchase 없음 |
| birthday | customer.birthday_approaching | `birth_month_day` = NOW+D MM-DD |
| custom | custom | **추출 없음(default 빈 배열) + 워처 제외** |

---

## 2. 결함 9개 → 재설계 대응 (전수)

| # | 결함 | 코드 근거 | 재설계 대응 | 절 |
|---|---|---|---|---|
| 1 | 자유여정 진입 부재 | watcher:71 custom 제외 · extractor default `[]` | 자유여정 진입 워커 신설(세그먼트 1회 진입) | 4.3 |
| 2 | 신규가입 created_at 재업로드 취약 | extractor:41 | 진입 원장 + 활성화 baseline + 전화번호 키 | 3 |
| 3 | cdp opt-out/is_active 필터 누락 | extractor:97·152(cond 있을 때만 JOIN, 그나마 is_active 미적용) | 공통 안전필터 전 trigger 무조건 적용 | 5 |
| 4 | 조건평가 default pass | executor:1014/1029/1039/1043/1078 | DB오류·미지원 → 발송 안 함(안전 분기) | 8 |
| 5 | 고객당 개별 campaign | executor:630 (1명=campaign 1) | 묶음 발송(staging+청크+%고객명%) | 7 |
| 6 | LIMIT 500 | watcher:113 | LIMIT 제거(묶음 동반) | 6 |
| 7 | step 시점 = now+delay | watcher:145 | 진입에도 절대/상대 시점 적용 | 9 |
| 8 | is_invalid 미필터 | extractor 전역 | 공통 안전필터에 포함 | 5 |
| 9 | 미리보기≠실발송 | simulator는 cdp 30일 EXISTS·custom 전체 추정 | 추출 단일 진입점으로 통일 | 10 |

---

## 3. 척추 ① — 진입 원장 + "기존에 없던 식별자" (Harold 정의)

> **Harold 정의:** "기존에 없던 식별자가 새로 나타나면 그게 신규가입 고객이다." 고객사마다 다른 연동·이벤트·컬럼을 안 따지는 단 하나의 보편 규칙.

### 3.1 진입 원장 테이블 신설 — `journey_entry_ledger`

```
(journey_id, company_id, phone_normalized, kind, created_at)
UNIQUE (journey_id, phone_normalized)
kind: 'baseline'(활성화 시점 기존 고객) | 'entered'(실제 진입)
```

- **키 = 정규화 전화번호**(`utils/normalize-phone.ts`). 이유 — `customers.id`는 재업로드(전체 삭제 후 재적재) 시 새로 발급될 수 있어 흔들린다. 전화번호는 마케팅에서 고객의 안정 식별자다. id가 바뀌어도 같은 번호면 "이미 본 고객"으로 본다.
- 신규가입 판정 = **원장에 없는 전화번호가 customers에 나타남**. `created_at`은 더 쓰지 않는다.

### 3.2 활성화 baseline

신규가입(`customer.created`) 여정을 켜는 순간, 그 시점 회사의 **기존 고객 전화번호 전부를 `kind='baseline'`로 일괄 적재**한다. → 초기 온보딩 백필(이미 있던 고객 통째 업로드)이 신규로 안 잡힌다. 재업로드도 baseline에 있으니 제외.

### 3.3 진입 흐름 (신규가입)

1. 공통 안전필터 통과 + 원장에 없는 전화번호 = 후보.
2. 대량 안전 차단기(3.5) 통과 시 진입.
3. 진입 = `journey_entry_ledger`(entered) + `journey_executions` 동시 INSERT(같은 트랜잭션).

### 3.4 trigger별 edge·중복 방지 (전 종류 한 틀)

| trigger | edge(전환) | 중복 방지 |
|---|---|---|
| 신규가입 | 원장에 없는 전화번호 출현 | 원장 UNIQUE |
| 구매/예약/장바구니(cdp) | **이벤트 커서 이후** 새 이벤트(아래 4.2) | 이벤트 id 커서 + 재진입 cooldown |
| 휴면 | recent_purchase_date가 N일 밴드 진입 | N~N+7 밴드 + cooldown 90d |
| 생일 | D-N 날짜 일치 | cooldown 365d(연 1회) |
| 자유여정(custom) | 세그먼트 매칭(1회) | 원장 UNIQUE |

### 3.5 대량 안전 차단기 (오발송 0 보장의 마지막 빗장)

한 번의 진입 처리에서 후보 수가 비정상으로 튀면 **진입·발송 대신 여정 정지 + 담당자 안내**.

- 판정 = ① 회사가 정한 1회 진입 상한(명시 설정) ② 직전 진입 이력 대비 급증(이동 중앙값 대비 배수). **임의 상수 하드코딩 금지** — 상한은 회사 설정, 급증은 그 여정 실제 진입 이력에서 도출. 이력 없으면(콜드 스타트) 상한만 적용.
- 시연·온보딩 대량 업로드 → 발송이 아니라 멈춤으로 받음.

---

## 4. 척추 ② — "시간 창" 폐기, 상태 전환 감지

### 4.1 cdp 이벤트 커서 (누락 0 + 중복 0)

- 현: `occurred_at >= NOW() - 5분`. 워처가 밀리면 그 사이 이벤트 누락.
- 신: 여정별 **마지막 처리 커서**(`journeys.last_event_cursor` 또는 별도 cursor 테이블 — 신설 컬럼은 information_schema 선검증)를 두고, **커서 이후 발생한 이벤트 전수**를 처리한 뒤 커서를 전진. 워처가 멈췄다 살아나도 그 사이 이벤트를 빠짐없이 잡는다.
- 같은 이벤트 두 번 처리 방지 = 커서(이벤트 id/occurred_at 단조 증가) + 진입 원장.

### 4.2 휴면·생일 = 상태/날짜 + cooldown

- 휴면: 밴드(N~N+7) + cooldown 90d로 매일 재발화 방지(현 구조 유지, 공통 안전필터만 추가).
- 생일: D-N 날짜 + cooldown 365d(현 구조 유지 + 안전필터).

### 4.3 자유여정(custom) 진입 워커 신설 — 결함 #1

- 자유여정 = 회사가 자연어로 만든 step 묶음을 **특정 세그먼트(audience)** 에게 보내는 것.
- audience = `trigger_filters.customer_conditions`(이미 있는 복합 조건 빌더 재사용).
- 진입 = 활성화 시(또는 회사가 정한 주기) 그 세그먼트에 **공통 안전필터 적용 후 매칭 고객을 1회 진입**(원장 UNIQUE로 재활성화 중복 차단, 대량 차단기 적용).
- 워처의 `template_code != 'custom'` 제외(71행)를 풀고, custom 전용 진입 경로를 추가.

---

## 5. 척추 ③ — 공통 안전필터 (전 trigger 무조건) — 결함 #3·#8

현재는 신규가입·휴면·생일만 is_active·sms_opt_in을 인라인으로 걸고, cdp(구매·예약·장바구니)는 customer_conditions가 있을 때만 customers를 JOIN하며 그나마 is_active/sms_opt_in을 안 건다. is_invalid는 어디에도 없다.

- **단일 컨트롤타워 함수** `buildJourneySafetyFilter(alias, createdBy)` 신설 → 모든 trigger 추출 SQL이 **무조건** 사용:
  - `is_active = true`
  - `sms_opt_in = true`
  - `NOT is_invalid`(무효번호)
  - `unsubscribes` 안티조인(created_by + phone)
- cond(customer_conditions) 유무와 **독립**. JOIN 조건부 금지.
- 단가/치환과 무관한 순수 필터 → 추출·미리보기·시뮬레이터가 같은 함수 공유.

---

## 6. LIMIT 제거 — 결함 #6

- watcher:113 `selectJourneyTargetCustomerIds(..., 500)`의 500 제거. 조건 맞는 전체 진입.
- 단, **묶음 발송(7절)이 반드시 동반**되어야 폭주 안 남. LIMIT 제거 = 7절과 한 묶음으로만 배포.
- 콜드 스타트/초기 대량은 5절 안전필터 + 3.5 차단기가 잡는다.

---

## 7. 발송 묶음 — 직접발송 staging 구조 차용 — 결함 #5

### 7.1 현 문제

executor가 due execution을 1명씩 처리하며 `campaigns`(target_count=1) + queue 1행 + 차감 1을 만든다. 500명 = campaign 500 + 결과 500행 → 조회 폭주.

### 7.2 신 구조 — 상태기계(per-customer)와 발송(batch) 분리

- **상태 전진**(execution별): 조건 평가·current_step_order 전진·next_run_at 계산은 고객별 유지(여정 의미상 각 고객이 다른 step에 있으므로 옳다).
- **묶음 발송**(per step-batch): 같은 `(journey_id, step_id, 발송창)` 으로 due가 된 message step들을 **한 번에 묶어**:
  1. `campaigns` 1건(source='journey', target_count=N, status='sending') — 직접발송과 동일 패턴.
  2. 직접발송이 쓰는 **staging 테이블 + 청크 워커 재사용**(`campaign_send_staging` 등 — 스키마 information_schema 선확인). 고객별 **렌더된 본문**을 staging 행으로 적재.
  3. 청크 단위로 SMS 큐 적재(메모리에 안 올림 = 톤28 504 fix와 같은 원리).
- **개인화 보존** — %고객명%/Liquid/예측점수/외부데이터/장바구니/variant는 staging 행을 만들 때 고객별로 렌더(현 `prepareSendMessage` + enrich 재사용). 묶어도 1인 1메시지 개인화는 그대로.
- 결과/캘린더는 campaign 1건(target=N)으로 깔끔하게 집계.

### 7.3 차감·결과

- 차감은 묶음 단위(N건) 한 번 — 현 1명 1차감을 batch로. 멱등키 = `journey:journeyId:stepId:발송창`.
- step_log는 고객별로 남기되 같은 campaign_id를 가리킨다.

---

## 8. 조건 평가 안전 분기 — 결함 #4

`evaluateCondition`의 다음 분기를 **default true(발송) → 안전 분기(발송 안 함)** 로:

- `condJsonb` null/형식오류(1014) → 활성화 형식검증이 이미 막지만, 런타임에서도 **미충족 취급**.
- cdp_event_exists DB오류(1029) / journey_step_clicked DB오류(1039) → **미충족 취급 + 재시도 예약 또는 사유 기록**(발송 X).
- 미지원 type(1043)/operator(1078) → **미충족 취급**.

> 핵심: 조건을 "확인 못 했다"는 "보내도 된다"가 아니다. DB가 흔들릴 때 무조건 발송이 가장 위험. 활성화 시 형식검증(화이트리스트)은 유지하되, 런타임 실패는 보류로 받는다.

---

## 9. step 시점 — 절대/상대 — 결함 #7

- step2~ 는 이미 `calculateNextRunAt(delay_mode, ...)`로 relative/specific_hour/next_business_day를 지원한다.
- **진입(step1)도 같은 헬퍼를 쓰게** 한다. watcher:145의 `shiftToSendableHour(now + delay_hours)`를 `calculateNextRunAt`로 교체.
- Harold 명세: "전일 대상 묶어 다음날 지정 시각" = step1 `delay_mode='specific_hour'`(예: 다음날 09시). 묶음 발송(7절)이 같은 발송창을 한 campaign으로 묶으므로 자연히 "전일 대상 다음날 9시 일괄"이 된다.
- step1 = 조건 충족 후 N일 + 지정 시각 / step2~ = 직전 step + N시간(또는 지정 시각).

---

## 10. 미리보기 = 실발송 일치 — 결함 #9

- `journey-simulator.ts`의 `matchTriggerCustomers`(cdp 30일 EXISTS 추정·custom 전체)를 폐기하고, **추출 단일 진입점**(`selectJourneyTargetCustomerIds` 계열 + 공통 안전필터)을 미리보기·시뮬레이터·실발송이 함께 쓴다.
- 미리보기는 LIMIT 없이 **전체 count + 샘플 N명**을 보여준다(현재 30 vs 500 불일치 해소).
- 시뮬레이터의 임의 상수(잔존율 0.85·객단가 5만·클릭 0.15 등)는 실데이터 도출로 교체하거나 "추정치" 명시(임의 상수 룰).

---

## 11. 스팸필터 2h 전 — 묶음 발송창에 연결

- 현: 활성화 시 1회 스팸테스트(`journey-pretest-validator`) + 활성화 시 2h 전 담당자 알림 예약(`journey-pretest-notifier`). 단 notifier가 `journey_executions.scheduled_at`·`step_id`(기본 스키마에 없는 컬럼)를 참조 → 활성화 catch가 삼켜 조용히 깨졌을 가능성(구현 전 information_schema 확인).
- 신: **묶음 발송창 2h 전** = 그 step 본문으로 스팸테스트 1회 → 통과 시 발송 / 걸리면 **그 발송창 정지 + 담당자 안내**(기존 pause token·pause URL 재사용). 활성화 시 1회 + 발송 직전 2h 전 1회 = 본문 변경/검수 변동까지 커버.

---

## 12. trigger 확장 — 포인트 소멸 등

- 포인트 소멸 임박/소멸(`customers.points` + 소멸일 컬럼 — information_schema 확인) = D-N 날짜 또는 임계 하향 edge. 4절 이벤트 커서/상태 밴드 틀에 그대로 추가.
- 새 trigger 추가 = extractor에 case 1개 + 공통 안전필터(자동) + edge 정의. 한 틀이라 확장 비용이 작다.

---

## 13. UI — step 시점·조건 한눈에 (AI 여정 빌더 동급)

- step 타임라인 뷰: step별 **발송 시점(절대/상대 배지)** + **조건 칩** + 채널 + 예상 묶음 수를 한 줄에.
- 미리보기 카드 = 실제 추출과 같은 함수의 전체 count + 샘플.
- 다크 톤 + violet 액센트, ConfirmModal/useToast(네이티브 다이얼로그 0).

---

## 14. 구현 순서 (위험 감소 우선 · 단계별 배포)

1. **공통 안전필터 CT + 전 trigger 적용**(5절) — 오발송(수신거부·무효번호) 즉시 차단. 가장 먼저.
2. **진입 원장 + 신규가입 anti-join + 활성화 baseline**(3절) — created_at 폐기.
3. **cdp 이벤트 커서**(4.1) — 누락 차단.
4. **자유여정 진입 워커**(4.3) — 가장 많이 쓰는 타입 살림.
5. **묶음 발송(staging)**(7절) + **LIMIT 제거**(6절) — 한 묶음 배포.
6. **step 시점 진입 적용**(9절) + **스팸 2h 전**(11절).
7. **조건 안전 분기**(8절).
8. **trigger 확장(포인트)**(12절).
9. **미리보기 통일**(10절) + **UI**(13절).

각 단계 = BEGIN/ROLLBACK 발송 0 검증 + tsc 0 + 자가 grep + 코드만(배포 Harold).

---

## 15. 구현 전 검증 의무 (information_schema 선검증 — 추측 0)

코드 쓰기 전, 아래를 **순수 덤프**로 확인(컬럼명 단정 금지). Harold 실행 후 결과로 확정.

1. `customers` 실제 컬럼 — phone / is_invalid / is_active / sms_opt_in / points / 포인트 소멸일 / recent_purchase_date / birth_month_day / birth_date 존재·타입.
2. `cdp_events` — id / occurred_at / event_name / source / customer_id.
3. `journey_executions` — `scheduled_at`·`step_id`·`error_count` 실제 존재 여부(notifier 깨진 쿼리 확인).
4. 직접발송 staging 테이블(`campaign_send_staging` 등) 실제 이름·컬럼(묶음 발송 재사용용).
5. 신설 테이블 DDL — `journey_entry_ledger`(+ 이벤트 커서 저장 위치).
6. **업로드/싱크 writer가 전화번호 upsert인지 전체 삭제 후 재적재인지** — `routes/`·싱크 코드 grep(Harold 승인 후). 원장 키를 전화번호로 잡으면 이 결과와 무관하게 안전하지만, baseline 적재 시점·중복 처리에 영향.

---

## 16. 비목표 (YAGNI)

- 멀티 채널 분기(이메일·푸시)·여정 A/B 고도화·실시간 대시보드는 이번 범위 밖. 이번은 **정확·실수 없는 추출/발송**에 집중.
