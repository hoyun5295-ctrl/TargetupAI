# 여정 엔진 Phase 9 구현 계획

> **실행:** 인라인 단일 세션 TDD(executing-plans). 에이전트 병렬 금지(Harold no_parallel_tasks). 한 태스크씩 세심하게.
> **커밋·배포:** 비토는 코드만. git add/commit/push·배포는 Harold. 각 태스크 끝 "커밋 지점"은 Harold가 수행.
> 스펙: `docs/superpowers/specs/2026-06-04-journey-phase9-design.md`.

**목표:** 여정 미리보기·시뮬레이션·실발송이 같은 추출 함수를 쓰게 통일하고, 예측은 실데이터에서만, step 시점은 "N일 후 + 시각" 일 단위로, 여정별 옵션을 편집 가능하게 한다.

**아키텍처:** 추출 단일 진입점(`journey-target-extractor`)에서 trigger별 SQL을 순수 빌더로 분리해 ID 추출과 전체 count가 공유. 시뮬레이터는 그 count + 실데이터 예측. 시점 계산에 `relative_at_hour` 모드 추가. 프론트는 일 단위 시점·액션 중심 편집 + 타임라인 + 여정 옵션 패널.

**기술:** Node/Express + PostgreSQL, React/TS. 순수 코어 TDD = `npx ts-node packages/backend/src/utils/__tests__/<name>.verify.ts`.

**원칙 게이트(매 태스크):** tsc 0 · 순수 테스트 green · grep 0(박-단어·모델명·native dialog) · 손대는 구간 자연 한국어. 종결 직전 Codex 검토.

---

## Task 0: information_schema 순수 덤프 게이트 (Harold 실행)

**목적:** 코드 FROM절 테이블의 실 컬럼을 추측 0으로 확정. DB 컬럼·제약을 만지는 Task 4~7의 선행.

- [ ] **Step 1: Harold께 아래 순수 덤프 SQL 제공 (컬럼명 단정 0 · 스키마 필터 0)**

```sql
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_name IN
  ('customers','cdp_customer_predictions','journeys','journey_steps','journey_executions')
ORDER BY table_name, ordinal_position;
```

- [ ] **Step 2: delay_mode 제약 확인 SQL 제공**

```sql
SELECT con.conname, pg_get_constraintdef(con.oid)
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
WHERE rel.relname = 'journey_steps' AND con.contype = 'c';
```

- [ ] **Step 3: 결과 수령 후 — 코드가 읽는 컬럼과 대조**
  - customers: 구매액(누적/최근)·구매횟수·grade·points·recent_purchase_date·birth_* 실명/타입.
  - cdp_customer_predictions: click_score·purchase_likelihood·churn_risk·model_version.
  - journeys: 임계·비용 한도·위험도·월 예산·재진입 허용·cooldown·회신번호/모드·auto_reentry 실명.
  - delay_mode가 text인지 / CHECK·enum 제약이 있는지(있으면 새 값 `relative_at_hour` 위해 제약 갱신).
- [ ] **Step 4: 채널 단가 실 출처 grep** — `grep -rn "lms.*30\|CHANNEL.*COST\|UNIT_COST\|단가" packages/backend/src` 로 기존 단가 정의 확인(있으면 재사용).

> Task 1~3은 DB 컬럼과 무관(순수). Task 0 결과를 기다리는 동안 Task 1부터 진행.

---

## Task 1: send-time-util `relative_at_hour` 모드 (순수 TDD)

**Files:**
- Modify: `packages/backend/src/utils/send-time-util.ts`
- Test: `packages/backend/src/utils/__tests__/journey-send-time.verify.ts` (기존 파일에 추가)

- [ ] **Step 1: 실패 테스트 추가** (journey-send-time.verify.ts, `next_business_day` 블록 뒤·`console.log(passed)` 앞)

```ts
console.log('[journey-send-time] relative_at_hour');
// noonKst = 2026-06-04 02:00Z = 11:00 KST
ok('3일(72h) 후 09시 → 6/7 09시 KST(6/7 00:00Z)', () =>
  assert.strictEqual(calculateNextRunAt('relative_at_hour', 72, 9, noonKst).toISOString(), '2026-06-07T00:00:00.000Z'));
ok('0일 후 09시(오늘 09시 이미 지남, 현재 11시) → 내일 09시(6/5 00:00Z)', () =>
  assert.strictEqual(calculateNextRunAt('relative_at_hour', 0, 9, noonKst).toISOString(), '2026-06-05T00:00:00.000Z'));
ok('1일(24h) 후 15시 → 6/5 15시 KST(6/5 06:00Z)', () =>
  assert.strictEqual(calculateNextRunAt('relative_at_hour', 24, 15, noonKst).toISOString(), '2026-06-05T06:00:00.000Z'));
ok('target null이면 relative로 폴백(+2h)', () =>
  assert.strictEqual(calculateNextRunAt('relative_at_hour', 2, null, noonKst).toISOString(), '2026-06-04T04:00:00.000Z'));
```

- [ ] **Step 2: 실패 확인** — `npx ts-node packages/backend/src/utils/__tests__/journey-send-time.verify.ts` → relative_at_hour가 fallback relative로 빠져 6/7 09시 단언 FAIL.

- [ ] **Step 3: 모드 구현** (send-time-util.ts, `next_business_day` 블록 뒤·fallback 앞에 삽입. 주석 블록의 모드 설명도 갱신)

```ts
  // 'relative_at_hour' = (now + delayHours)가 속한 KST 날짜의 targetHourKst시. 그 시각이 과거면 +1일.
  //   "N일 후 그 날 HH시" 표현용(N = delayHours/24). targetHourKst null이면 relative로 폴백.
  if (delayMode === 'relative_at_hour' && targetHourKst !== null) {
    const targetHour = Math.max(0, Math.min(23, targetHourKst));
    const landed = new Date(now.getTime() + delayHours * 60 * 60 * 1000);
    const kstLanded = new Date(landed.getTime() + 9 * 60 * 60 * 1000);
    const y = kstLanded.getUTCFullYear();
    const m = kstLanded.getUTCMonth();
    const d = kstLanded.getUTCDate();
    let utcTargetMs = Date.UTC(y, m, d, targetHour - 9, 0, 0); // KST targetHour = UTC(targetHour-9)
    if (utcTargetMs < now.getTime()) utcTargetMs = Date.UTC(y, m, d + 1, targetHour - 9, 0, 0);
    return shiftToSendableHour(new Date(utcTargetMs));
  }
```

- [ ] **Step 4: 통과 확인** — 같은 ts-node 실행 → 전부 ok, assertions passed 증가.
- [ ] **Step 5: tsc** — `cd packages/backend && npx tsc --noEmit`.
- [ ] **커밋 지점(Harold):** send-time-util.ts + journey-send-time.verify.ts.

---

## Task 2: 시점·조건 칩 순수 포맷터 (프론트 순수 TDD)

시뮬레이터·executor는 구조화 필드(delayMode/delayHours/targetHourKst, condition_jsonb)만 내보내고, 문구 변환은 프론트 단일 포맷터에 둔다(중복 0).

**Files:**
- Create: `packages/frontend/src/utils/journeyStepFormat.ts`
- Test: `packages/frontend/src/utils/__tests__/journeyStepFormat.verify.ts`

- [ ] **Step 1: 실패 테스트**

```ts
import assert from 'node:assert';
import { formatStepTiming, formatConditionChip } from '../journeyStepFormat';
let passed = 0; const ok = (n: string, f: () => void) => { f(); passed++; console.log(`  ok - ${n}`); };

// 발송 시점
ok('relative_at_hour 3일+9시 step1', () =>
  assert.strictEqual(formatStepTiming({ delayMode: 'relative_at_hour', delayHours: 72, targetHourKst: 9 }, true), '트리거 후 3일 뒤 · 09시'));
ok('relative 일 단위 step2', () =>
  assert.strictEqual(formatStepTiming({ delayMode: 'relative', delayHours: 48, targetHourKst: null }, false), '직전 단계 후 2일 뒤'));
ok('relative 시간 단위(24h 미만)', () =>
  assert.strictEqual(formatStepTiming({ delayMode: 'relative', delayHours: 2, targetHourKst: null }, false), '직전 단계 후 2시간 뒤'));
ok('specific_hour', () =>
  assert.strictEqual(formatStepTiming({ delayMode: 'specific_hour', delayHours: 0, targetHourKst: 10 }, false), '다음 10시에 발송'));
ok('next_business_day', () =>
  assert.strictEqual(formatStepTiming({ delayMode: 'next_business_day', delayHours: 0, targetHourKst: null }, false), '다음 평일 09시'));

// 조건 칩
ok('customer_field', () =>
  assert.strictEqual(formatConditionChip({ type: 'customer_field', field: 'recent_purchase_amount', operator: '>=', value: 100000 }), '최근구매금액 ≥ 100,000'));
ok('cdp_event_exists not_exists', () =>
  assert.strictEqual(formatConditionChip({ type: 'cdp_event_exists', event_name: 'purchase', within_days: 7, presence: 'not_exists' }), '7일 내 구매 없음'));
ok('journey_step_clicked false', () =>
  assert.strictEqual(formatConditionChip({ type: 'journey_step_clicked', step_order: 1, within_days: 5, clicked: false }), 'Step 1 미클릭'));

console.log(`\n${passed} assertions passed`); process.exit(0);
```

- [ ] **Step 2: 실패 확인** — `npx ts-node packages/frontend/src/utils/__tests__/journeyStepFormat.verify.ts` → 모듈 없음 FAIL. (ts-node가 프론트 tsconfig path로 막히면 `npx ts-node --compiler-options '{"module":"commonjs"}' ...`로 실행.)
- [ ] **Step 3: 구현** — `journeyStepFormat.ts`에 두 순수 함수.
  - `formatStepTiming({delayMode,delayHours,targetHourKst}, isFirst)`:
    - 접두 = isFirst ? '트리거 후' : '직전 단계 후'.
    - specific_hour → `다음 {targetHourKst}시에 발송`. next_business_day → `다음 평일 09시`.
    - relative/relative_at_hour → delayHours%24===0 && delayHours>0 ? `${delayHours/24}일` : `${delayHours}시간`; 합쳐 `${접두} ${N}{단위} 뒤`; relative_at_hour면 ` · ${pad2(targetHourKst)}시` 덧붙임.
  - `formatConditionChip(c)`: 필드 한글맵(recent_purchase_amount→최근구매금액 등)·연산자맵(>=→≥)·`value.toLocaleString()`; cdp_event_exists는 이벤트 한글맵 + presence(exists→있음/not_exists→없음); journey_step_clicked는 `Step {n} {clicked?'클릭':'미클릭'}`.
- [ ] **Step 4: 통과 확인.**
- [ ] **Step 5: 박-단어/모델명 grep 0** — `grep -rnE "옛|박[음힘는을힌지혀힙히혔힐았혀]|Opus|Sonnet|GPT|Claude" packages/frontend/src/utils/journeyStepFormat.ts`.
- [ ] **커밋 지점(Harold).**

---

## Task 3: 여정 옵션 순수 validator (순수 TDD)

trigger_filters + 옵션 입력을 안전 범위로 정규화·검증. `resolvePointsExpiringConfig`(기존) 재사용 + 타이밍·한도 클램프.

**Files:**
- Create: `packages/backend/src/utils/journey-options-validator.ts`
- Test: `packages/backend/src/utils/__tests__/journey-options-validator.verify.ts`

- [ ] **Step 1: 실패 테스트** — `normalizeJourneyOptions(input)` 단언:
  - recent_hours/dormant_days/days_before/abandon_hours 범위 클램프(예: days_before 0~90).
  - points_min/inactive_days/expiry_mode/expiry_month_day는 resolvePointsExpiringConfig 위임 결과 일치.
  - thresholdRecipients/thresholdCost/budgetMonthly 음수→null, 정수화.
  - reentryCooldownDays 0~365, thresholdRiskLevel ∈ {low,medium,high} 아니면 'low'.
  - callbackMode ∈ {fixed,store}.
- [ ] **Step 2: 실패 확인** (ts-node).
- [ ] **Step 3: 구현** — `clampInt`(points-trigger와 동일 falsy 안전 패턴) 재사용/공유, 화이트리스트.
- [ ] **Step 4: 통과 확인 + tsc.**
- [ ] **커밋 지점(Harold).**

---

## Task 4: 추출기 SQL 빌더 분리 + countJourneyTargetCustomers (TDD, Task 0 후)

**Files:**
- Modify: `packages/backend/src/utils/journey-target-extractor.ts`
- Modify: `packages/backend/src/utils/journey-simulator.ts` (applyCustomerConditions를 extractor로 이동, 시뮬레이터는 재export 또는 import 정리)
- Test: `packages/backend/src/utils/__tests__/journey-target-extractor.verify.ts`

- [ ] **Step 1: 특성화 테스트(현 동작 고정)** — 각 trigger에 대해 `buildTargetMatchSql(triggerEvent, filters, {companyId, journeyId, forCount})`가 내는 `{text, values}`를 현재 selectJourneyTargetCustomerIds가 만들던 SQL·params와 1:1 일치하는지 단언(문자열 정규화 비교). 신규가입(ledger/추정 분기)·휴면·생일·장바구니·cdp·포인트·custom 전수.
- [ ] **Step 2: 실패 확인** (ts-node) — 함수 없음 FAIL.
- [ ] **Step 3: 빌더 추출** — 각 case의 FROM+WHERE+ORDER+params 생성을 `buildTargetMatchSql`로 옮김. `selectJourneyTargetCustomerIds` = 빌더 + `SELECT id ... LIMIT $n`(파라미터 순서·ORDER·LIMIT 불변). `applyCustomerConditions`를 extractor로 이동.
- [ ] **Step 4: 통과 확인** — 특성화 단언 green(= 발송 동작 불변 입증).
- [ ] **Step 5: countJourneyTargetCustomers 추가** — `forCount` 빌더로 `SELECT COUNT(*)::int total, COALESCE(c.grade,'일반') segment ... GROUP BY` → `{ total, segments }`. grade는 Task 0에서 확인된 실 컬럼. cdp는 selectCdpEvent 7일 추정 기준 count. 테스트 = 생성 SQL 단언.
- [ ] **Step 6: tsc + 박-단어 grep 0.**
- [ ] **커밋 지점(Harold).**

---

## Task 5: 시뮬레이터 재작성 + 실데이터 예측 (Task 0 후)

**Files:**
- Modify: `packages/backend/src/utils/journey-simulator.ts`
- Test: `packages/backend/src/utils/__tests__/journey-simulator-projection.verify.ts`

- [ ] **Step 1: 예측 계산 순수 함수 + 실패 테스트** — `buildProjection({ matched, segments, steps, avgOrderValue|null, avgClick|null, avgPurchase|null, channelCost })`:
  - 객단가/전환 둘 다 null → estimatedRevenue=null, ROI=null, `dataNote='데이터 부족'`.
  - step별 expectedSends: 첫 message=matched, 조건 step 하류 message=null('조건 통과분(실행 후 확정)').
  - 비용 = 실 단가 × expectedSends(null이면 비용도 변동 표기).
  - 임의 상수 0.85·50000·0.15·0.05 부재(코드에 없음을 grep으로 확인).
- [ ] **Step 2: 실패 확인 (ts-node).**
- [ ] **Step 3: 구현** — `matchTriggerCustomers` 폐기, `countJourneyTargetCustomers` 사용. 객단가/클릭/구매는 매칭 고객 한정 실 쿼리(Task 0 확인 컬럼: 누적·최근 구매액·횟수, cdp_customer_predictions). 행 없으면 null → 정직 표기. `buildProjection` 호출. reasoning/warnings 자연 한국어 재작성("영역" 남용 제거).
- [ ] **Step 4: 통과 확인 + tsc.**
- [ ] **Step 5: 임의 상수 grep 0** — `grep -nE "0\.85|50_?000|0\.15|0\.05" packages/backend/src/utils/journey-simulator.ts` → 0건.
- [ ] **커밋 지점(Harold).**

---

## Task 6: 라우트 total/simulate + 소비처 전수 grep

**Files:**
- Modify: `packages/backend/src/routes/ai.ts` (preview-samples ~2760, preview-target-samples ~2794, simulate ~3485)
- Modify: `packages/frontend/src/pages/JourneysPage.tsx` (미리보기 카드 total 표시)

- [ ] **Step 1: 소비처 grep** — `grep -rn "simulateJourney\|matchTriggerCustomers\|buildJourneyPreviewSamples\|countJourneyTargetCustomers\|estimatedRevenue\|customerSegments" packages` 전수 리스트업. 새 응답 shape 깨지는 곳 식별.
- [ ] **Step 2: preview 응답에 total** — 두 endpoint에서 `countJourneyTargetCustomers` 호출 → `{ success, samples, total }`. cdp는 estimated 플래그.
- [ ] **Step 3: simulate 응답** — 새 simulation shape(dataNote·null 허용) 반영.
- [ ] **Step 4: 프론트 미리보기 카드** — "전체 N명 중 10명" + cdp "추정" 배지. (시뮬 카드 항목은 Task 8에서 정리.)
- [ ] **Step 5: tsc(backend+frontend) + 박-단어 grep 0.**
- [ ] **커밋 지점(Harold).**

---

## Task 7: 여정 옵션 PATCH endpoint (Task 0 후)

**Files:**
- Modify: `packages/backend/src/routes/ai.ts` (신규 라우트 + 기존 callback/auto-reentry 통합 검토)

- [ ] **Step 1: 라우트** — `PATCH /operator/journeys/:id/options` — 회사 격리 + isAiOperatorAllowed + status draft/paused만(active 403 또는 안전 항목 잠금). body를 `normalizeJourneyOptions`(Task 3) 통과 → trigger_filters jsonb + journeys 옵션 컬럼(Task 0 실명) UPDATE. DB ALTER 새 컬럼 없음(기존 컬럼만). catch에 `column does not exist` 503 분기(db_alter_safety_net).
- [ ] **Step 2: 검증** — 잘못된 expiry_month_day·범위 밖 값은 validator가 정규화(거부 아닌 클램프). active 여정 거부 메시지.
- [ ] **Step 3: tsc + 박-단어 grep 0.**
- [ ] **커밋 지점(Harold).**

---

## Task 8: 프론트 — 편집 캔버스 시점·액션 + 타임라인 + 옵션 패널 + 미리보기 (Task 1~7 후)

**Files:**
- Modify: `packages/frontend/src/pages/JourneysPage.tsx`

- [ ] **Step 1: 편집 캔버스 발송 시점 일 단위** (~2366 발송 시점 컨트롤) — "트리거/직전 단계 후 [N]일 뒤" + "발송 시각 [HH시/지정 안 함]". N→delayHours=N×24, 시각 지정 시 delayMode='relative_at_hour'. "시간 단위로" 보조 토글(사브데이) + "다음 평일" 유지. wait step 중복 시점 UI(~1896 + ~2368) 단일 컨트롤로 통합. isFirst 라벨.
- [ ] **Step 2: 카드 레이아웃 액션 중심** — 액션(채널+본문/조건) → 발송 시점 → 보조(A/B·알림) 순 그룹. 3열 그리드 유지.
- [ ] **Step 3: 저장 상세 타임라인 뷰** (~1648 읽기 전용 리스트 대체) — 한 줄: 순번·유형색 + `formatStepTiming` 배지 + `formatConditionChip` 칩(조건 step) + 채널·광고 + 예상 발송. 다크톤·모바일 flex-wrap.
- [ ] **Step 4: 여정 옵션 편집 패널** (~1383 트리거 표시 전용 대체) — 트리거 타이밍·포인트·한도·예산·재진입·회신 입력 → `PATCH .../options`. ConfirmModal 저장 확인 + useToast 결과(native dialog 0). draft/paused만 편집, active는 잠금 표시.
- [ ] **Step 5: 미리보기 total** — Task 6 응답의 total 표시.
- [ ] **Step 6: 자가 grep 0** — `grep -rnE "옛|박[음힘는을힌지혀힙히혔힐았혀]|confirm\(|prompt\(|alert\(|Opus|Sonnet|GPT|Claude" packages/frontend/src/pages/JourneysPage.tsx` (손댄 구간 기준 0건).
- [ ] **Step 7: tsc(frontend).**
- [ ] **커밋 지점(Harold).**

---

## Task 9: 종결 검증 + Codex

- [ ] backend·frontend tsc 0.
- [ ] 순수 테스트 전체 green(send-time·formatter·validator·extractor·projection).
- [ ] 박-단어·모델명·native dialog grep 0.
- [ ] `/codex:review`(코드) + DB 만진 Task 4·5·7은 `/codex:adversarial-review`.
- [ ] verification-before-completion으로 evidence 출력 후 표준 종료 멘트. 배포는 Harold.

---

## 자가 검토 (스펙 대조)

- 9-1 추출 단일화 → Task 4(빌더+count)·Task 6(소비처). ✓
- 9-1 실데이터 예측 → Task 5. ✓
- 9-1 N일+시각 모드 → Task 1. ✓
- 9-2 타임라인·조건 칩 → Task 2(포맷터)·Task 8 Step 3. ✓
- 9-2 편집 캔버스 시점·액션 → Task 8 Step 1·2. ✓
- 9-2 여정 옵션 → Task 3(validator)·Task 7(PATCH)·Task 8 Step 4. ✓
- 9-2 미리보기 total → Task 6·Task 8 Step 5. ✓
- 검증 게이트 → Task 0. ✓
- 함수명 일관: `buildTargetMatchSql`·`countJourneyTargetCustomers`·`formatStepTiming`·`formatConditionChip`·`normalizeJourneyOptions`·`buildProjection`·`relative_at_hour`.
