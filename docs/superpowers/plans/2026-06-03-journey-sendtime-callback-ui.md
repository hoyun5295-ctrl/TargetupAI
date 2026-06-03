# 여정 발송시간·회신번호·문안편집 UI 개편 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). CLAUDE.md `no_parallel_tasks` 때문에 subagent 병렬은 금지 — 한 번에 하나씩 진행. Steps use checkbox (`- [ ]`).

**Goal:** 여정 발송에 야간(21~08시) 가드 + 발송 시각 선택을 넣고, 고객 매장번호(store_phone)를 회신번호로 쓸 수 있게 하며, step 편집 UI를 가로 3분할 카드(제목바 + 문안·치환토글 + 하단 기능버튼)로 개편한다.

**Architecture:** backend 먼저(발송시간 가드 = 법규, 회신번호 폴백) → frontend UI. 기존 컨트롤타워 재사용 — `send-time-util`(SEND_HOURS 이월), `callback-filter`(store_phone 폴백/`resolveCustomerCallback`), `config/defaults` SEND_HOURS. 인라인 중복 금지.

**Tech Stack:** Node/Express + PostgreSQL, React + TypeScript.

**검증된 사실(점검 결과):**
- `calcSplitSendTime`(send-time-util)은 `kstHour >= endHour`(21시 이후)만 익일 이월하고 **새벽 0~7시는 미처리** → 여정용 가드 함수 신규 필요.
- 여정은 발송 시간 가드가 전무: 진입 `journey-trigger-watcher.ts:144` = `now + delay_hours`, 다음 step `calculateNextRunAt`(journey-executor) relative = `now + delay`.
- 회신번호: `journey-executor.ts:369` = `journey.callback_number → customer.callback`만, `store_phone` 폴백 없음. 캠페인은 `callback-filter`로 이미 store_phone 폴백 사용.
- `customers.store_phone`은 표준 필드(standard-field-map.ts:89) + 운영 컬럼(campaigns.ts:633 SELECT 중) = 존재 입증.

---

## Phase 1 — 발송시간 야간 가드 + 발송 시각 (backend 우선, 법규)

### Task 1.1: `shiftToSendableHour` 가드 함수 (send-time-util CT 확장)

**Files:**
- Modify: `packages/backend/src/utils/send-time-util.ts`
- Test: `packages/backend/src/utils/__tests__/send-time-util.shift.test.ts` (ts-node 단독 실행 형식, 기존 테스트 관례 따름)

- [ ] **Step 1: 실패 테스트 작성** — KST 기준 새벽/야간/주간 케이스

```ts
import { shiftToSendableHour } from '../send-time-util';
// KST h시를 UTC Date로: Date.UTC(y,m,d,h-9)
const kst = (h: number) => new Date(Date.UTC(2026, 5, 3, h - 9, 0, 0));
const kstHourOf = (d: Date) => parseInt(d.toLocaleString('en-US', { timeZone: 'Asia/Seoul', hour: '2-digit', hour12: false }));

console.assert(kstHourOf(shiftToSendableHour(kst(3))) === 8, '새벽3시 → 당일 08시');
console.assert(kstHourOf(shiftToSendableHour(kst(22))) === 8, '22시 → 익일 08시');
console.assert(shiftToSendableHour(kst(10)).getTime() === kst(10).getTime(), '10시 → 그대로');
console.assert(shiftToSendableHour(kst(20)).getTime() === kst(20).getTime(), '20시 → 그대로(<21)');
console.assert(kstHourOf(shiftToSendableHour(kst(21))) === 8, '21시 정각 → 익일 08시');
// 익일 이월은 날짜가 +1
console.assert(shiftToSendableHour(kst(22)).getUTCDate() === kst(22).getUTCDate(), '22시 KST는 UTC 13시(같은 날) → 익일 08시 KST = UTC 23시 같은 날'); // 경계 주석
console.log('shiftToSendableHour OK');
```

- [ ] **Step 2: 실패 확인** — Run: `npx ts-node packages/backend/src/utils/__tests__/send-time-util.shift.test.ts` → Expected: `shiftToSendableHour is not a function`

- [ ] **Step 3: 함수 구현** — `calculateNextRunAt`(journey-executor)와 동일한 KST=UTC+9 / `Date.UTC(.., hour-9)` 패턴으로 통일.

```ts
/**
 * 발송 가능 시간(SEND_HOURS) 밖이면 다음 발송 가능 시각(startHour)으로 이동.
 * - 새벽(0~startHour 미만) → 당일 startHour
 * - endHour 이후(21시~) → 익일 startHour
 * - startHour~endHour-1 = 그대로 (발송 가능)
 * KST(UTC+9) 기준. calculateNextRunAt와 동일 패턴.
 */
export function shiftToSendableHour(
  date: Date,
  startHour: number = SEND_HOURS.start,
  endHour: number = SEND_HOURS.end,
): Date {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const kstHour = kst.getUTCHours();
  if (kstHour >= startHour && kstHour < endHour) return date; // 발송 가능 시간 — 그대로
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth();
  const d = kst.getUTCDate();
  const addDay = kstHour >= endHour ? 1 : 0; // 21시 이후 = 익일 / 새벽 = 당일
  return new Date(Date.UTC(y, m, d + addDay, startHour - 9, 0, 0)); // KST startHour = UTC (startHour-9)
}
```

- [ ] **Step 4: 통과 확인** — Run 동일 → Expected: `shiftToSendableHour OK`
- [ ] **Step 5: 커밋** — `git add packages/backend/src/utils/send-time-util.ts packages/backend/src/utils/__tests__/ && git commit -m "feat(journey): 발송 가능 시간 가드 함수 shiftToSendableHour 추가"`

### Task 1.2: `calculateNextRunAt` 결과에 야간 가드 적용

**Files:** Modify `packages/backend/src/utils/journey-executor.ts:878-935`

- [ ] **Step 1:** `import { shiftToSendableHour } from './send-time-util';` 추가(상단 import 블록).
- [ ] **Step 2:** `relative` 분기(887)와 fallback(934) 반환을 `shiftToSendableHour(...)`로 감싼다. `specific_hour`(909)·`next_business_day`(930)는 사용자가 시각을 정한 것이므로 `targetHour`를 08~20으로 clamp만 하고(아래 1.4 UI에서 제한), 결과도 `shiftToSendableHour`로 안전 통과(09시·지정 주간 시각은 그대로 반환됨).

```ts
// 887 relative:
if (delayMode === 'relative' || !delayMode) {
  return shiftToSendableHour(new Date(now.getTime() + delayHours * 60 * 60 * 1000));
}
// 934 fallback 동일:
return shiftToSendableHour(new Date(now.getTime() + delayHours * 60 * 60 * 1000));
// specific_hour(909)·next_business_day(930) 반환도 shiftToSendableHour(new Date(utcTargetMs)) 로 감싼다.
```

- [ ] **Step 3:** tsc 0 확인 — Run: `cd packages/backend && npx tsc --noEmit` → Expected: 0 errors
- [ ] **Step 4:** 커밋 — `git commit -am "feat(journey): calculateNextRunAt 야간 가드 적용"`

### Task 1.3: 여정 진입(trigger-watcher) nextRunAt 야간 가드

**Files:** Modify `packages/backend/src/utils/journey-trigger-watcher.ts:144`

- [ ] **Step 1:** `import { shiftToSendableHour } from './send-time-util';` 추가.
- [ ] **Step 2:** 144행 교체.

```ts
// before: const nextRunAt = new Date(Date.now() + Number(firstStep.delay_hours || 0) * 60 * 60 * 1000);
const nextRunAt = shiftToSendableHour(new Date(Date.now() + Number(firstStep.delay_hours || 0) * 60 * 60 * 1000));
```

- [ ] **Step 3:** tsc 0 확인 → **Step 4:** 커밋 `feat(journey): 여정 진입 발송시각 야간 가드`

### Task 1.4: message step에도 발송 시각 선택 UI (frontend)

**Files:** Modify `packages/frontend/src/pages/JourneysPage.tsx:1906-1910`(빌더 message step 시간 영역)

- [ ] **Step 1:** message step 시간 영역에 wait step과 동일한 `delayMode`(relative/specific_hour) + `targetHourKst` select 노출. `specific_hour` 선택지의 시각 옵션은 **08~20시만**(야간 차단). 기존 `s.delayMode`·`s.targetHourKst` 필드(이미 AIGeneratedStep에 존재) 재사용 — backend 컬럼 추가 0.
- [ ] **Step 2:** `targetHourKst` 드롭다운은 `Array.from({length: 13}, (_, i) => i + 8)` (8~20)로 생성.
- [ ] **Step 3:** 빌드 검증 `cd packages/frontend && npx tsc --noEmit` → 0 errors. 커밋.

---

## Phase 2 — 회신번호 매장번호(store_phone)

### Task 2.1: 회신번호 모드 저장 컬럼 확인/추가

- [ ] **Step 1 (검증 먼저, db_column_verify):** Harold님께 제공할 확인 SQL — `journeys`에 회신번호 모드 컬럼이 있는지부터 확인(추측 금지):
  `SELECT column_name FROM information_schema.columns WHERE table_name='journeys' AND column_name IN ('callback_mode','use_individual_callback');`
- [ ] **Step 2:** 없으면 ALTER 안내(Harold 실행) — `ALTER TABLE journeys ADD COLUMN callback_mode text DEFAULT 'fixed';` ('fixed'=고정번호 / 'store'=고객 store_phone). catch에 `db_alter_safety_net`(column does not exist → 503) 적용.

### Task 2.2: executor store_phone 폴백 (callback-filter CT 재사용)

**Files:** Modify `packages/backend/src/utils/journey-executor.ts:369`, SELECT(customers에 store_phone 추가)

- [ ] **Step 1:** executor가 customer 조회 시 `store_phone` 컬럼 포함(현재 SELECT 확인 후 누락 시 추가).
- [ ] **Step 2:** `resolveCustomerCallback`(callback-filter) 재사용 또는 폴백 추가:

```ts
// 369 before: const callbackNumber = String(exec.journey_callback_number || customer.callback || '').trim();
const useStore = exec.callback_mode === 'store';
const callbackNumber = String(
  useStore ? (customer.store_phone || exec.journey_callback_number || customer.callback || '')
           : (exec.journey_callback_number || customer.callback || '')
).trim();
```

- [ ] **Step 3:** journey_executions 조회 쿼리에 `j.callback_mode` 포함(140행대 SELECT). tsc 0. 커밋.

### Task 2.3: 회신번호 UI에 "고객 매장번호" 옵션 (frontend)

**Files:** Modify `packages/frontend/src/pages/JourneysPage.tsx:1840-1846`(회신번호 select)

- [ ] **Step 1:** callbackOptions 위에 고정 옵션 `<option value="__store__">고객 매장번호(store_phone)로 발송</option>` 추가. 선택 시 `callback_mode='store'` 저장(여정 설정 PATCH).
- [ ] **Step 2:** tsc 0. 커밋.

---

## Phase 3 — step 편집 UI 가로 3분할 (frontend)

### Task 3.1: 빌더 step 편집 카드 재배치 (JourneysPage)

**Files:** Modify `packages/frontend/src/pages/JourneysPage.tsx:1880-1941`(step 카드 헤더/본문)

- [ ] **Step 1:** step 목록 컨테이너를 세로(`space-y-3`)에서 가로 3분할 그리드로 — `grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3`(4개+는 자동 줄바꿈). 색/톤은 현재 클래스 유지(`bg-white/5 border-white/10`).
- [ ] **Step 2:** 카드 내부 3단 구조로 재배치:
  - 상단 **제목 바**: `s.stepIntent`(예 "가입즉시 환영인사")를 카드 최상단 강조 바로(현재 1884 truncate 텍스트를 제목 바로 승격).
  - 가운데 **문안 영역**: 본문 textarea + 우상단에 **치환/원본 토글**(현재 "실제 발송 미리보기" 토글 2413을 카드 내부 우상단 아이콘 토글로 이동, `Eye`/`Pencil`).
  - 하단 **기능버튼 분할**: 현재 헤더(1882~1941)에 몰린 [유형][시간/발송시각][채널][광고][다듬기][삭제]를 카드 하단 영역으로 이동, 라벨 텍스트 동반(아이콘만 X).
- [ ] **Step 3:** native dialog 0 / 모델명 0 자가 grep. tsc 0. 커밋.

### Task 3.2: 문안수정 모달 동일 배치 (JourneyMessageEditModal)

**Files:** Modify `packages/frontend/src/components/journey/JourneyMessageEditModal.tsx`

- [ ] **Step 1:** 이미 가로 컬럼 + viewMode 토글 존재 — 카드별 제목바(stepOrder/intent) 상단 강조 + 치환/원본 토글을 카드 우상단으로 이동해 빌더와 동일 룩으로 통일. 색 유지.
- [ ] **Step 2:** native dialog 0 자가 grep. tsc 0. 커밋.

---

## Self-Review 체크
- Phase 1 발송시간: 진입(1.3)·다음step(1.2)·UI 시각제한(1.4) 모두 커버. 새벽/야간/주간 테스트(1.1) 포함.
- Phase 2 회신번호: 컬럼 검증 먼저(2.1, db_column_verify) → executor 폴백(2.2) → UI(2.3). callback-filter CT 재사용(인라인 0).
- Phase 3 UI: 빌더(3.1)·모달(3.2) 둘 다. 색 유지·배치만.
- 타입 일관: `callback_mode`('fixed'|'store'), `shiftToSendableHour`, `targetHourKst`(8~20) 전 task 동일.
- 미해결 의존: 2.1 ALTER는 Harold 실행 필요(배포 순서 = ALTER 먼저).
