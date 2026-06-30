# 여정 일반화 설계 — 시작 모델(start_kind) 1급화 + 알림톡 템플릿 우선 + 날짜축 D-N

> 2026-06-30 작성. **이번 세션 = 설계 확정. 구현은 다음 세션.** Harold 명시.
> 승인된 방향(2026-06-30 대화): ① start_kind 1급 분리, ② date_anchor = 기존 여정 엔진/자산 재사용(A안), ③ 알림톡 = 템플릿 우선. ALTER는 Harold 직접 실행. 모든 컬럼/함수 실측은 플랜 1단계에서 information_schema·코드로 확정.

---

## 0. 목표·범위

여정 진입을 "trigger_event 문자열에 모든 게 섞인" 구조에서 **"시작 방식(start_kind)"을 1급 축으로 분리**한 열린 구조로 일반화한다. 그 위에 두 신규 능력을 얹는다.

- **SP-A — 알림톡 정보알림 재설계**: 문안 생성이 아니라 카카오 승인 템플릿이 본체. 트리거 카드(주문/예약/장바구니/배송)를 앞세우던 흐름을 **템플릿 우선 → 시작 방식 → 대상 지정**으로 뒤집는다.
- **SP-B — 날짜축 여정(date_anchor)**: 회사가 기준 날짜(예: 포인트 소멸일)를 지정하면 그 날짜 기준 **D-N 멀티스텝(7·3·1·0)**으로 보낸다. D-0 후 자동 정지 → 재지정(수동) 또는 반복 규칙(자동)으로 재가동.

두 SP는 같은 뼈대("**시작 방식 × 대상 × 콘텐츠 × 타이밍/반복**"을 직교로)의 다른 조합이다.

### 불변 제약 (절대 깨지 말 것)
- 회사 격리(모든 SQL `company_id`) · 공통 안전필터(`buildJourneySafetyFilter`: opt_in·is_active·is_invalid·수신거부) 항상.
- 발송 6원칙(전수 grep·효과검증·이중진실 안전망·라우팅축 영향표·실측 1건·수정 전 승인).
- 정보통신망법: 알림톡 = 정보성만(광고 X). 광고 여정과 진입 분기 유지. 광고는 (광고)+080 자동 합성.
- `no_target_auto_relax`: 0건이면 발송 차단·침묵. 자동완화 0.
- 기존 9트리거·발송·통계 회귀 0. 기존 컬럼 보존(ALTER는 추가만).
- 묶음 발송: (journey, step, KST날짜)당 campaign 1건 공유(`journey_step_campaigns`).
- 멱등 차감(발송 성공 시점 1회).

---

## 1. 현황 (코드 사실 — 2026-06-30 확인)

### 1-1. 데이터 모델
- **journeys**: `id·company_id·name·template_code·trigger_event·trigger_filters(jsonb)·status(draft/active/paused/ended)·budget_monthly·allow_reentry·reentry_cooldown_days·threshold_*·approved_*·paused_at·pause_reason·stats_*` + 실측 추가분 `callback_number·callback_mode·auto_reentry_enabled·archived_at·pretest_notify_step_defaults·entry_baseline_at·last_event_cursor·last_pretest_passed_at`.
- **journey_steps**: `id·journey_id·step_order·step_type(message/wait/condition)·delay_hours·channel·message_template·subject·is_ad·condition_jsonb` + ALTER 추가분 `alimtalk_profile_id·alimtalk_template_code·alimtalk_variable_map·mms_image_paths·delay_mode·target_hour_kst`.
- **journey_executions**: `id·journey_id·customer_id·current_step_order·status(active/completed/paused/failed)·entered_at·next_run_at·completed_at·total_cost·entry_event_properties(jsonb)` + 실측 `error_log·last_error_at·error_count·result_notified_at`.
- **journey_step_campaigns** PK(journey_id, step_id, send_date) — 묶음 발송 멱등 키. **journey_entry_ledger** — 신규가입 anti-join 진입 원장.

### 1-2. 트리거(진입) 9종 — 전부 trigger_event 문자열
`customer.created`(가입·entry_baseline 원장) · `cdp.purchase`(커서) · `customer.dormant`(휴면) · `cdp.cart_abandon`(장바구니) · `customer.birthday_approaching`(생일) · `cdp.reservation_created`(커서) · `custom`(상시 세그먼트 anti-join) · `customer.points_expiring`(포인트 — `inactivity`/`annual_date` MM-DD **단일 daysBefore offset**) · `custom_order_shipped`(배송 커서).
- 진입 워커 `journey-trigger-watcher.ts`(5분 cron): cursor 경로(구매·예약·배송, 정확히 1회·properties 동봉) / 추출 경로(`selectJourneyTargetCustomerIds` + anti-join dedup). 대량 차단(threshold 초과 시 자동 정지).

### 1-3. 스텝 타이밍 — 전부 진입(now) 기준 상대
`send-time-util.calculateNextRunAt(delay_mode, delay_hours, target_hour_kst)` 4모드: `relative`(now+H) · `relative_at_hour`(N일 후 그 날 HH시) · `specific_hour`(오늘/내일 HH시) · `next_business_day`(다음 평일 09시). 전부 `shiftToSendableHour`로 야간 발송 차단. **"앵커 절대 날짜 −N일 HH시" 모드 없음.**

### 1-4. 알림톡 빌더(InfoAlertJourneyBuilder.tsx)
지금: ① "언제 보낼까요" 거래 이벤트 카드(주문/예약/장바구니/배송) 선택 → ② AlimtalkChannelPanel로 승인 템플릿 선택 → onBuild → 부모(JourneysPage)가 kakao step으로 조립 → 검토. = **트리거 우선**. 변수 #{주문번호}는 `journey_executions.entry_event_properties`(이벤트 진입분)로 치환.

### 1-5. 생성·활성·정지
- 생성 `createJourneyFromTemplate`(journeys + steps INSERT). 활성 `activateJourney`(step 검증·status active). 정지/재가동 골격(`status` active/paused·`paused_at`·`pause_reason`·pause-handler·reentry-worker·대량 자동정지) 존재.

---

## 2. 시작 모델 (start_kind) — 뼈대

`journeys`에 **`start_kind`**를 1급 컬럼으로 추가. 기존 `trigger_event`는 그 하위 식별자로 유지(회귀 0).

| start_kind | 의미 | 진입 | 타이밍 | 라이프사이클 | 현재 |
|---|---|---|---|---|---|
| `event` | 고객 행동 발생 시 진입 | cdp/customer 트리거 | 진입 상대(now+delay) | 켜두면 계속 | 있음(9트리거 중 8) |
| `standing` | 조건 충족 고객 상시 진입 | custom anti-join | 진입 상대 | 켜두면 계속 | 있음(custom) |
| `date_anchor` | 회사 지정일 기준 D-N | 날짜축 스케줄러 | 절대(anchor−Nd HH시) | D-0 후 자동 정지 → 재지정/반복 재가동 | **신규** |
| `one_shot` | 지정 고객군 1회 | 즉시/예약 | 즉시 또는 지정 시각 | 1회 발송 후 완료 | **신규** |

**매핑 원칙**: 기존 여정은 마이그레이션으로 `start_kind` 채움 — `trigger_event='custom'` → `standing`, `customer.points_expiring`(annual_date) → `date_anchor`로 흡수(2-1), 그 외 → `event`. trigger_event 값·소비 경로 무변경 → 회귀 0.

### 2-1. points_expiring 통합 (중복 제거)
기존 `customer.points_expiring`의 `annual_date`(MM-DD 단일 offset)는 date_anchor의 특수 사례. date_anchor 멀티스텝으로 일반화하면서, points 임계(points≥N)는 date_anchor의 **대상 조건(audience)**으로 흡수한다. `inactivity` 모드(소멸일 없는 미사용 기준)는 별개 — `event/standing` 조건으로 유지. (플랜 1단계: 운영 중 points_expiring 여정 존재 여부 확인 후 마이그레이션 범위 확정.)

---

## 3. SP-A — 알림톡 정보알림 = 템플릿 우선

### 3-1. 빌더 흐름 재설계 (InfoAlertJourneyBuilder.tsx 재작성)
트리거 카드(TX_EVENTS) 제거. 새 흐름 3단:

1. **어떤 알림톡** (콘텐츠 먼저) — 승인 발신프로필 + 카카오 승인 템플릿 선택(`AlimtalkChannelPanel` 재사용). 템플릿 본문·변수 그대로.
2. **언제 보낼까** (시작 방식) — `event` / `one_shot`(즉시·예약) / `standing`(조건 충족 상시) 중 선택.
   - `event` 선택 시에만 거래 이벤트(구매/예약/장바구니/배송)를 **여기서** 고른다(템플릿 변수에 #{주문번호} 등 이벤트 데이터가 필요할 때). 이벤트 변수 가용.
   - `one_shot`/`standing` 선택 시 = 이벤트 데이터 없음 → 템플릿 변수는 **고객 필드(이름·등급 등)만** 매핑 가능. 화면이 가용 변수 범위를 명시(이벤트 전용 변수는 비활성).
3. **누구에게** (대상 좁히기) — 세그먼트/조건(등급·지역 등) + 안전필터. event면 "이벤트 발생 고객에 조건 덧씌우기", one_shot/standing이면 "조건으로 대상 지정".

검토(review) 흐름은 기존 재사용. onBuild 결과에 `startKind` + (event일 때만) `triggerEvent` 포함.

### 3-2. 데이터·경로
- journey_steps 알림톡 컬럼(`alimtalk_profile_id·alimtalk_template_code·alimtalk_variable_map` 등) 그대로 재사용.
- journeys: `start_kind` + (event) `trigger_event` / (one_shot) anchor·즉시·예약 시각 / (standing) custom 조건.
- 변수 치환: event = `entry_event_properties`(기존), one_shot/standing = 고객 필드(executor가 발송 시 customer 데이터로 치환 — 기존 `replaceVariables` 경로).
- 정보성 고정: is_ad=false, (광고)/080 미합성(알림톡은 정보성). 기존 정책 유지.

### 3-3. JourneysPage 진입 변경
"정보 알림 만들기" 모달이 위 3단을 호출. 트리거 카드 군더더기 제거. 마케팅(광고) 여정 진입과 분리 유지.

---

## 4. SP-B — 날짜축 여정 (date_anchor)

### 4-1. 데이터 모델 추가
- **journeys**: `start_kind`(2장 공통) · `anchor_date`(date, 회사 지정 기준일) · `anchor_recurrence`(varchar enum: `none`/`monthly_day`/`monthly_last`/`yearly`) · `anchor_recurrence_day`(int — monthly_day일 때 N일, 그 외 null) · `anchor_hour_kst`(int, 기본 발송 시각, step별 override 가능).
- **journey_steps**: `anchor_offset_days`(int — 양수 = 앵커 N일 전, 0 = 당일). step별 `target_hour_kst`로 시각 override.
- 전부 ALTER 추가(기존 컬럼 보존). 플랜 1단계 information_schema 검증 후 Harold 실행.

### 4-2. 실행 모델 — 기존 여정 자산 재사용 + 날짜 키 스케줄러
date_anchor는 "고객별 execution 스레딩"이 아니라 **스텝별 날짜 스케줄 발송**이 자연스럽다(타임라인 축이 고객 진입이 아니라 회사 앵커 날짜). 단, 여정의 자산(스텝 정의·`journey_step_campaigns` 멱등·안전필터·통계·정지)을 그대로 재사용한다.

신규 워커 `journey-anchor-scheduler`(일 1회, KST 새벽 또는 매시 점검):
1. 활성 `start_kind='date_anchor'` 여정 전수.
2. 각 step에 대해 발송 예정일 = `anchor_date − anchor_offset_days`. 오늘(KST)과 일치하고 `target_hour_kst` 도래 시:
   - 대상 추출 = 여정 audience 조건(예: points≥N) + 공통 안전필터. `selectJourneyTargetCustomerIds` 또는 동급 추출 재사용.
   - 0건이면 침묵(no_target_auto_relax).
   - 발송 = 기존 step 발송 경로 재사용(`prepareSendMessage`+`createDirectSendCampaign` 묶음, `journey_step_campaigns` PK(journey,step,send_date)로 **멱등** — 하루 1회). 멱등 차감.
3. 라이프사이클(4-3).

대량 차단(threshold) 동일 적용.

### 4-3. 라이프사이클 — 자동 정지 / 재가동
- 마지막 step(D-0, 최소 offset) 발송 완료 후:
  - `anchor_recurrence='none'` → **자동 정지**(status='paused', pause_reason='지정일 D-0 발송 완료 — 다음 날짜 지정 시 재가동'). 회사가 새 `anchor_date` 지정 시 status='active' 재가동(기존 재가동 경로 + anchor_date UPDATE).
  - `anchor_recurrence≠none` → **다음 앵커로 자동 갱신**(anchor_date = computeNextAnchor(recurrence, 현재 anchor) — 예: monthly_last = 다음 달 말일), status active 유지. 정지 없이 다음 사이클 진입.
- `computeNextAnchor`·`isAnchorCycleComplete`는 순수 함수(TDD).

### 4-4. 엣지케이스
- 앵커 과거/오늘이 이미 D-0 지남 → 이번 사이클 발송 0(침묵) + recurrence면 다음 앵커로, none이면 정지.
- offset이 앵커보다 큼(예: 앵커가 5일 뒤인데 D-7 step) → 그 step 발송일이 과거 → skip(멱등이 이미 보냄/건너뜀 기록).
- 같은 날 두 step(offset 충돌) → step_order로 순서 보존, 같은 send_date 멱등은 step_id 포함이라 충돌 없음.
- 사이클 중 anchor_date 재지정 → 진행 중 사이클 정의 갱신(이미 보낸 날짜는 멱등 보존, 남은 step은 새 앵커 기준).
- 반복 갱신 시 직전 사이클 미완 step → 다음 사이클로 끌고 가지 않음(사이클 경계 명확).

---

## 5. 대상(audience) 일반화

시작 방식과 독립. 두 방식:
- **이벤트+조건**: 이벤트 발생 고객에 조건(등급·지역·custom_fields) 덧씌우기. 기존 `trigger_filters` + `buildFilterWhereClauseCompat`.
- **세그먼트 직접**: 조건만으로 대상 집합(one_shot/standing/date_anchor). 기존 `customer_conditions`/`saved_segments` 재사용.
- 공통 안전필터(opt_in·is_active·is_invalid·수신거부) **항상** 적용(JOIN 조건부 누락 금지 — D232 교훈).

---

## 6. 엔진 변경 요약

| 파일 | 변경 |
|---|---|
| `send-time-util.ts` | 신규 순수 `computeAnchorStepRunAt(anchorDate, offsetDays, hourKst, now)` (절대 날짜−offset HH시 + shiftToSendableHour) + `computeNextAnchor`·`isAnchorCycleComplete`. TDD. |
| `journey-anchor-scheduler.ts`(신규) | date_anchor 일 스케줄러 — step별 발송일 도래 판정 → 대상 추출 → 묶음 발송(멱등) → 라이프사이클. |
| `journey-trigger-watcher.ts` | start_kind='event'/'standing'만 처리(date_anchor·one_shot 제외 분기). 회귀 0. |
| `journey-builder.ts` | `createJourneyFromTemplate`/`activateJourney`가 start_kind·anchor_* 필드 처리·검증(date_anchor면 anchor_date 필수, step마다 anchor_offset_days). |
| `journey-points-trigger.ts` | annual_date를 date_anchor로 흡수(2-1). |
| `journey-executor.ts` | date_anchor는 execution 스레딩 안 씀(스케줄러가 직접 발송) — executor 무영향. one_shot은 단발 발송. |
| `InfoAlertJourneyBuilder.tsx` + `JourneysPage.tsx` | 알림톡 템플릿 우선 흐름 + start_kind 선택 UI + date_anchor 빌더(앵커 날짜·반복·D-N step). |

---

## 7. 화면 흐름 (UX)

### 7-1. JourneysPage 진입
여정 만들기 진입에서 **시작 방식**을 먼저 고른다(또는 시나리오 카드가 start_kind를 내포). 마케팅(광고) / 정보 알림(알림톡) 분리는 유지.

### 7-2. date_anchor 빌더
① 기준 날짜(anchor_date) 지정 + 반복(없음/매달 말일/매달 N일/매년) → ② D-N 멀티스텝 구성(스텝마다 offset 7·3·1·0 + 채널/문안 또는 알림톡 템플릿 + 시각) → ③ 대상 조건 → ④ 검토. "정지 상태 → 새 날짜 지정 → 재가동" 상태가 화면에 보이게.

### 7-3. 알림톡 빌더
3장(SP-A) 3단 흐름. 다크 톤·ConfirmModal/useToast·모바일 반응형(LESSONS_FRONTEND), native dialog 0, 모델명 0.

---

## 8. 발송·돈·안전 정합
- 발송 6원칙 전 항목. 발송·돈 닿는 부분(스케줄러 발송·차감)은 실측 1건 시나리오 보고.
- 멱등: `journey_step_campaigns` PK(journey,step,send_date) — 하루 1회 상한. 차감은 발송 성공 시점 1회.
- 안전필터 항상. 0건 침묵. 알림톡 정보성 고정.
- 대량 차단(threshold) date_anchor에도 적용.

---

## 9. 테스트 전략
- **순수 TDD**: `computeAnchorStepRunAt`(앵커−offset HH시·야간가드·과거 skip) · `computeNextAnchor`(monthly_last/monthly_day/yearly 다음 날짜) · `isAnchorCycleComplete` · start_kind 분류 · audience where 빌더.
- **통합(실측 1건)**: date_anchor 생성 → 활성 → D-7/D-3/D-1/D-0 발송(멱등 재실행 중복 0) → D-0 후 자동 정지(none) / 다음 앵커 자동 갱신(recurrence) → 재가동. 알림톡 템플릿 우선 생성 → event/segment 각 1건.
- 회귀: 기존 9트리거 여정 발송·통계 무변경(start_kind 마이그레이션 후).

---

## 10. 미확정 → 플랜 1단계 확인 (information_schema·코드)
1. `journey_steps` 전체 컬럼 실측(alimtalk_next_*·delay_mode·target_hour_kst 등 정확 목록) — db_column_verify.
2. 운영 중 `customer.points_expiring` 여정 존재·건수 → 마이그레이션/흡수 범위.
3. `anchor_recurrence` 지원 규칙 최종 집합 확정(monthly_day/monthly_last/yearly 외 추가 필요 여부 — 위 4가지로 잠금).
4. one_shot을 신규 start_kind로 둘지, 기존 직접발송/예약과 경계(여정 안 1회 vs 직접발송) — 중복 회피.
5. date_anchor 대상 추출을 `selectJourneyTargetCustomerIds` 재사용 가능 범위(points 조건 등).
6. 알림톡 one_shot/standing 변수 치환이 기존 `replaceVariables`/executor 경로로 충분한지.
7. JourneysPage 진입 IA(시작 방식 선택 위치) — 기존 좌우 히어로와 정합.

---

## 11. 결정 요약 (다음 세션 이대로)
- start_kind = event·standing·date_anchor·one_shot 1급 분리. 기존 trigger_event 흡수(회귀 0).
- date_anchor = 여정 자산 재사용 + 날짜 키 스케줄러(스텝별 anchor−offset 발송, 멱등). 고객별 execution 스레딩 안 씀.
- 라이프사이클 = D-0 후 자동 정지(none, 재지정 재가동) / 다음 앵커 자동 갱신(recurrence). 순수 함수 TDD.
- 알림톡 = 템플릿 우선 → 시작 방식 → 대상. 트리거 카드 제거. 변수 가용 범위(event=이벤트변수 / segment=고객필드) 화면 명시.
- ALTER 추가만(기존 보존), Harold 실행. 발송·돈·안전 6원칙·정보통신망법·격리 전부 유지.
