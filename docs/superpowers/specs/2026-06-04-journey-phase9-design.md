# 여정 엔진 Phase 9 설계서 — 미리보기·실발송 일치 + step 시점·조건 UI (2026-06-04)

> 작성: 비토(CTO) · 승인: Harold (2026-06-04)
> 상위 설계서 `2026-06-04-journey-engine-redesign-design.md` §10·§13의 구현 상세.
> 원칙 — 추측 금지(첫 SQL은 순수 덤프) · DB 컬럼 information_schema 선검증 · 순수 코어 TDD · 코드만(배포 Harold) · 임의 상수 금지(실데이터 또는 정직 표기) · 자연 한국어.

---

## 0. 한 줄 목표

여정을 켜기 전에 "몇 명한테 / 언제 / 어떤 조건으로 갈지"를 정확하고 한눈에 보이게 한다. 미리보기·시뮬레이션·실발송이 같은 고객 추출을 쓰고, 예측 숫자는 그 회사 실데이터에서만 낸다.

---

## 1. 현 상태 (코드 사실)

- **추출 단일 진입점** `selectJourneyTargetCustomerIds(companyId, triggerEvent, triggerFilters, limit, journeyId?)` → `string[]`. trigger-watcher(발송)와 preview-samples(미리보기)가 사용. trigger 8종(신규·재구매·예약·휴면·장바구니·생일·포인트소멸·custom) 분기. 공통 안전필터·`applyCustomerConditions`·진입 원장 anti-join·포인트 config 사용.
- **미리보기 샘플** `buildJourneyPreviewSamples(...)` → 샘플 카드 N개. preview-samples(저장 후 journeyId)·preview-target-samples(저장 전 trigger 직접) 사용. **전체 count는 반환하지 않음**.
- **시뮬레이터** `simulateJourney(journeyId, companyId)` → 자체 SQL `matchTriggerCustomers`(cdp 30일 EXISTS / custom 전체 활성) + 임의 상수(`STEP_RETENTION_RATE=0.85`, `AVG_PURCHASE_AMOUNT=50000`, fallback 0.15/0.05, `CHANNEL_UNIT_COST` 표). GET `/operator/journeys/:id/simulate` 사용. → 추출 단일 진입점과 분기 → **미리보기 ≠ 실발송**.
- `applyCustomerConditions`는 `journey-simulator.ts`가 export하고 `journey-target-extractor.ts`가 import(의존 역전).
- **빌더 페이지** `JourneysPage.tsx`:
  - 시뮬레이션 카드(matchedCustomers·totalEstimatedSends·totalEstimatedCost·estimatedRevenue·segments·clickRate·conversionRate·reasoning·warnings 표시) — draft/paused만.
  - 트리거 조건 카드 — **표시 전용, 1422행 "편집 UI 신설" 명시**.
  - 저장된 여정 step 리스트 — **읽기 전용, `delay_hours`h·channel만**(시점 배지·조건 칩 없음).
  - 편집 캔버스 — delay_mode(relative/specific_hour/next_business_day)·target_hour_kst·조건 type 3종(customer_field/cdp_event_exists/journey_step_clicked).
  - 다중 미리보기 샘플 카드(buildJourneyPreviewSamples).

---

## 2. 9-1 추출 단일화 (백엔드)

### 2.1 순수 SQL 빌더 분리

`journey-target-extractor.ts`에 trigger별 "FROM + WHERE + ORDER + params"를 만드는 순수 헬퍼를 둔다(SELECT/LIMIT 제외).

- `selectJourneyTargetCustomerIds` = 헬퍼 + `SELECT id ... LIMIT $n` — **현 동작 1:1 보존**.
- 신규 `countJourneyTargetCustomers(companyId, triggerEvent, triggerFilters, journeyId?)` = 헬퍼 + `SELECT COUNT(*)::int AS total, COALESCE(c.grade,'일반') AS segment ... GROUP BY` → `{ total: number, segments: {segment,count,pct}[] }`. **LIMIT 없음(전체)**.
- cdp(purchase/reservation) 미리보기 추정은 `selectCdpEvent` 7일 분기를 재사용, count도 같은 추정 기준.
- **안전성** — 발송 경로(`selectJourneyTargetCustomerIds`)는 파라미터 인덱스·ORDER·LIMIT를 바꾸지 않는다. 현재 생성 SQL·params를 특성화 테스트로 먼저 고정 → 헬퍼 추출 리팩터 → 테스트 green 유지. 이 경로는 운영 발송이라 가장 조심해서 다룬다.

### 2.2 시뮬레이터 통일

- `matchTriggerCustomers` 폐기. `simulateJourney`가 `countJourneyTargetCustomers`로 매칭 수·등급 분포를 받는다.
- preview-samples·preview-target-samples 응답에 `total`(countJourneyTargetCustomers) 추가 → "전체 N명 중 샘플 10명"으로 일치.
- `applyCustomerConditions`를 `journey-target-extractor.ts`(또는 공용 파일)로 이동, 의존 방향 정리.
- cdp 트리거는 라이브가 이벤트 커서로 도착분을 처리하므로 미리보기는 본질상 추정(최근 7일, 같은 함수). 같은 함수·같은 안전필터를 쓴다는 뜻으로 통일하고, 화면에 "추정" 표기.

### 2.3 예측 = 실데이터 또는 정직 표기 (임의 상수 제거)

`0.85`·`50000`·`0.15`·`0.05` 하드코딩을 전부 제거한다.

- **매칭 수·등급 분포** = 실값(통일 count).
- **발송 비용** = 실 단가 × 발송 수. 단가는 실 출처 확인 후 통일(기존 단가 정의가 있으면 재사용, 없으면 현재 표를 실 단가로 확정).
- **객단가** = 매칭 고객의 실 구매 데이터(누적/최근 구매액·횟수)에서 도출, 가능하면 등급별. 구매 데이터 없으면 매출 추정 생략.
- **클릭률·전환율** = `cdp_customer_predictions` 평균(매칭 고객 한정). 예측 행이 없으면 "예측 데이터 부족" 표기.
- **매출·ROI** = 실 객단가와 실 전환이 둘 다 있을 때만. 아니면 표기 생략.
- **step별 예상 발송** = step1은 매칭 수 그대로. 조건 step 하류는 "조건 통과분(실행 후 확정)"으로 정직 표기(가짜 잔존율 안 씀).
- 데이터 부족 항목은 숫자를 지어내지 않고 `insufficient_data` 의미의 한국어 안내로 표기.

### 2.4 step 발송 시점 모델 — "N일 후 + 몇시" (Harold 명시 2026-06-04)

현 `calculateNextRunAt`(send-time-util.ts)는 relative(시간 단위)·specific_hour(오늘/내일 HH시)·next_business_day만 있다. **"N일 후 + 지정 시각" 조합이 없어** 마케팅팀이 168시간 = 7일을 직접 나눠 입력해야 한다.

- 신규 모드 `relative_at_hour` 추가(순수 함수, TDD): `now`에서 `delay_hours`만큼 지난 날짜(KST)의 `target_hour_kst`시로 맞춘다. 그 시각이 이미 과거면 +1일. 야간가드(`shiftToSendableHour`) 적용.
- 기존 3모드(relative·specific_hour·next_business_day)는 **건드리지 않는다**(추가형 — 기존 데이터 영향 0).
- UI는 "N일 후"를 `delay_hours = N×24`로 저장. 발송 시각을 지정하면 `relative_at_hour`, 미지정이면 `relative`(도착 후 발송 가능 시간대).
- 사브데이(장바구니 2시간 후 등)는 시간 단위 입력 유지(보조).

---

## 3. 9-2 step 시점·조건 UI + 트리거 설정 (프론트, AI 여정 빌더 동급)

### 3.1 step 타임라인 뷰 (읽기 전용 리스트 대체)

한 줄: 순번 + 유형색(message=fuchsia / wait=sky / condition=emerald) + 발송 시점 배지 + 조건 칩 + 채널·광고 + 예상 발송.

- **발송 시점 배지** — delay_mode 기준: relative → "트리거 후 N시간"(step1) / "직전 단계 후 N시간"(step2+), specific_hour → "다음 N시 KST"(절대), next_business_day → "다음 평일 09시".
- **조건 칩** — condition_jsonb를 사람이 읽는 문구로: customer_field "최근구매금액 ≥ 100,000" / cdp_event_exists "7일 내 구매 없음" / journey_step_clicked "Step 1 미클릭".
- 시점·조건 → 문구 변환은 순수 포맷터로 분리(TDD).

### 3.2 미리보기 카드

전체 count + 샘플. "전체 1,200명 중 10명 미리보기" 식. 자동 로드(추가 클릭 없음 — 마케팅 담당자 UX). cdp는 "추정" 배지.

### 3.3 트리거 설정 편집

표시 전용을 편집 가능하게(저장은 §3.6 여정 옵션 PATCH로 일원화 — draft·paused만, active면 거부, trigger_filters jsonb 갱신).

- **포인트 소멸** — points_min, expiry_mode(inactivity/annual_date), inactive_days, days_before, expiry_month_day(MM-DD). annual_date인데 소멸일 미설정 → "발송 0" 경고.
- **기본 타이밍** — 신규 recent_hours / 휴면 dormant_days / 생일 days_before / 장바구니 abandon_hours.
- 검증은 순수 validator(`resolvePointsExpiringConfig` 재사용 + 범위 클램프)로 분리(TDD).
- customer_conditions 복합 편집기 = 범위 밖.

### 3.4 디자인·정리

다크 톤 + violet 액센트, ConfirmModal/useToast(네이티브 다이얼로그 0), 모바일 반응형(flex-wrap + md:/lg:), 데이터 카드 출처 캡션. 손대는 구간 문구·주석을 자연 한국어로 정리(현재 "영역" 단어 남용 제거).

### 3.5 step 편집 캔버스 시점·액션 UX (REVIEW view — Harold 명시 2026-06-04)

여정에서 step별 액션 지정이 핵심이다. 현 편집 캔버스(`xl:grid-cols-3` 3분할, 4스텝부터 다음 줄)의 발송 시점이 시간 단위(0~720h)라 마케팅팀이 일수를 암산한다. 이를 직관적으로 바꾼다.

- **발송 시점 = 일 단위 우선** — "[트리거 / 직전 단계] 후 **[N]일** 뒤" + "발송 시각 **[HH시 / 지정 안 함]**". step1은 "트리거 후", step2+는 "직전 단계 후" 라벨.
  - 시각 지정 → `relative_at_hour`(§2.4), 미지정 → `relative`. 둘 다 `delay_hours = N×24` 저장.
  - 사브데이용 "시간 단위로" 토글(보조), "다음 평일 09시"(next_business_day) 빠른 옵션 유지.
  - 야간가드 안내("밤이면 아침 발송 자동") 유지.
- **카드 내부 정리 — 액션 중심** — ① 무엇을(액션: 채널 + 본문/조건) ② 언제(발송 시점) ③ 보조(A/B·담당자 알림)로 그룹. 3열 그리드(4스텝+ 자동 줄바꿈)는 유지하되, wait step의 중복 시점 UI(블록 + 하단 행)를 단일 발송 시점 컨트롤로 통합.
- 저장된 여정 상세의 타임라인 뷰(§3.1)도 같은 "N일 후 + HH시" 문구로 표시(편집 캔버스와 일관).

### 3.6 여정별 옵션 설정 (per-journey, 편집 가능 — Harold 명시 2026-06-04)

여정마다 다른 값을 쓰는 운영 옵션을 한 패널에서 편집 가능하게 한다(지금은 생성 시 정해지고 이후 일부만 수정 가능). 같은 저장 경로로 통합, **draft·paused만 편집**(active는 안전 제약 — 운영 중 핵심 옵션 변경 차단).

- **트리거 조건** (§3.3) — 이벤트별 타이밍 파라미터 + 포인트 소멸 설정.
- **발송 시점** (§3.5) — step별 N일·시각.
- **안전 한도·예산** — 1회 진입 상한, step당 비용 한도, 위험도, 월 예산.
- **재진입** — 재진입 허용·cooldown 일수·자동 재진입(기존 토글 통합).
- **회신번호** — 회신번호·매장번호 모드(기존 PATCH callback 통합).
- 옵션 변경은 시뮬레이션·미리보기 count에 즉시 반영(통일 함수라 자동).
- **범위 경계** — 신규 옵션 타입은 만들지 않는다. 기존 journeys 필드를 여정별로 편집 가능하게 여는 데까지. customer_conditions 복합 편집기는 범위 밖.

---

## 4. 변경 목록 (요약)

**백엔드**
- `journey-target-extractor.ts` — trigger별 순수 SQL 빌더 분리 + `countJourneyTargetCustomers` 신규 + `applyCustomerConditions` 이동.
- `journey-simulator.ts` — 재작성(통일 count 사용 + 실데이터 예측 + 자연 한국어).
- `send-time-util.ts` — `relative_at_hour` 모드 추가(§2.4, 기존 3모드 불변).
- `routes/ai.ts` — preview-samples·preview-target-samples에 total, simulate 새 shape, 여정 옵션 PATCH(trigger 타이밍·포인트 + 임계·예산·재진입·회신 통합/확장, draft·paused만).

**프론트**
- `JourneysPage.tsx` — REVIEW 편집 캔버스 발송 시점 일 단위(+시각)·액션 중심 레이아웃(§3.5), 저장 상세 step 타임라인 뷰, 트리거/포인트 편집기, 미리보기 total.
- 순수 포맷터 유틸(시점·조건 문구) + 필요 시 작은 컴포넌트.

**신규 마이그레이션** — 없음(trigger_filters jsonb·기존 컬럼만, delay_mode는 text라 새 값 추가 무해 — §6에서 제약 확인).

---

## 5. 구현 순서 (단계별 배포)

1. **9-1a** 추출기 통일 + count (특성화 TDD, 발송 동작 불변).
2. **9-1b** 시뮬레이터 재작성 + 실데이터 (순수 계산 TDD).
3. **9-1c** 라우트 total/simulate + 소비처 전수 grep.
4. **9-2a** 여정 옵션 PATCH(trigger·임계·예산·재진입·회신) + 검증 (순수 validator TDD).
5. **9-2b** send-time-util `relative_at_hour` 모드 + 시점·조건 칩 순수 포맷터 (TDD).
6. **9-2c** 편집 캔버스 발송 시점 일 단위·액션 중심 레이아웃(§3.5) + 저장 상세 타임라인 뷰 + 여정 옵션 편집 패널(§3.6) + 미리보기 total + 한국어 정리.

각 단계: tsc 0 + 순수 테스트 green + grep 0(박-단어·모델명·native dialog). 종결 직전 Codex 검토. 배포는 Harold님.

---

## 6. 구현 전 검증 게이트 (추측 0)

코드 쓰기 전, information_schema **순수 덤프**(컬럼명 단정 0·스키마 필터 0)로 실 컬럼을 먼저 확정한다. 코드 FROM절에서 읽은 테이블명만 나열:

- `customers`, `cdp_customer_predictions`, `journeys`, `journey_steps`, `journey_executions`.
- 덤프 결과 ↔ 코드가 읽는 컬럼 대조(직접): 구매액·횟수·grade·points 계열, click_score·purchase_likelihood·churn_risk·model_version 존재·타입.
- `journey_steps.delay_mode` 컬럼 타입 + CHECK/enum 제약 확인 — 새 값 `relative_at_hour`가 들어갈 수 있는지(text면 무해, 제약 있으면 제약도 함께 갱신).
- `journeys` 옵션 컬럼 실명 확정(임계·비용 한도·위험도·월 예산·재진입 허용·cooldown·회신번호/모드·auto_reentry) — 덤프로 정확한 컬럼명 대조 후 PATCH 작성.
- 채널 단가 실 출처 grep(있으면 재사용, 없으면 현재 표를 실 단가로 확정).

---

## 7. 테스트 계획 (순수 코어 TDD)

- **추출기 SQL 빌더** — trigger별 생성 SQL·params 단언(DB 없이). 발송 경로는 특성화 테스트로 현 동작 고정.
- **예측 계산** — 객단가·전환·매출·insufficient_data 분기 순수 단언.
- **시점/조건 포맷터** — delay_mode·condition_jsonb → 문구 단언.
- **트리거 validator** — 포인트·타이밍 범위/모드 단언.

DB 의존(query 호출)은 순수 테스트 불가 → tsc + 검증된 패턴 재사용으로 커버.

---

## 8. 원칙 적용

- no_arbitrary_constants — 실데이터 또는 insufficient_data 정직 표기.
- db_column_verify_before_code / no_guess_strict — information_schema 선검증, 첫 SQL 순수 덤프.
- no_inline_duplication — count는 추출기 CT 안. 라우트 인라인 금지.
- full_pattern_grep_required — simulator/extractor 소비처 전수 grep.
- design_quality_minimum_journey_level — 빌더 동급 디자인.
- marketing_user_ux_priority — 자동 로드, 추가 입력 0.
- no_native_browser_dialog — ConfirmModal/useToast.
- 자연 한국어 / TDD / Codex 검토 / 코드만(배포 Harold).

---

## 9. 비목표 (YAGNI)

- customer_conditions 복합 편집기, 멀티 채널 분기, A/B 고도화.
- 과거 퍼널 기반 잔존율 추정(콜드 스타트가 대부분이라 실익 적음 — 정직 표기로 대체).
