# 여정 이어달리기(다음 수 추천) 설계서 — 2026-08-08

> **호출어: "여정 이어달리기"** · 기원 = Harold 제안 2026-08-08 ("여정의 다단계화").
> 상태 = **구현 완료(2026-08-08) · 배포 대기.** 착수 1~5 전량 — 구현 결과·실측 지점 = **§9-A**.
> 여정의 구조·불변 원칙은 [FEATURE-JOURNEY.md](FEATURE-JOURNEY.md)가 소유한다 — 이 문서는 이 트랙의 설계만 갖는다.

---

## 0) 한 줄 정의

여정 하나를 점이 아니라 **고객 생애의 이어달리기 구간**으로 보고, 다음 구간을 시스템이 먼저 내민다.
추천이 뜨는 시점은 둘 — ①**생성 직후**("신규가입 여정을 만드셨네요 — 첫 구매 여정을 만들어보시겠어요?")
②**운영 중 전환이 실제로 일어났을 때**("휴면 여정에서 3명이 복귀했는데, 받아줄 여정이 없어요").

**고객을 다음 여정에 자동으로 태우지 않는다.** 추천은 담당자에게, 진입은 기존 워커가 —
후속 여정이 활성화되면 진입 워커가 정상 경로로 잡아간다. 특수 진입로를 만들면 겹침·동의 축이 통째로 열린다.

---

## 1) 확정 사실 — 이 설계의 전제 (2026-08-08 소스 실측)

| # | 사실 | 근거 |
|---|---|---|
| 1 | **후속 관계는 트리거 계약에 이미 내재돼 있다.** `TriggerContract.exit`가 여정의 목표 사건을 선언한다 — signup→`purchase` · first_purchase→`second_purchase` · dormant→`purchase` · cdp.purchase→`next_purchase` | `journey-trigger-capability.ts:153·158-181` |
| 2 | **전환 관측이 이미 원장에 기록된다.** `goal_exit_enabled`(2026-07-10, 기본 false)가 켜진 여정은 진입 후 목표 달성 시 `journey_executions.status='goal_met'`로 종료된다. 판정은 `goal_kind`(purchase 기본·click·visit·points_used)별, 구매는 문 둘(cdp+원장) 다 본다 | `journey-executor.ts:270-281·1259-1347` |
| 3 | **goal_met 수는 이미 목록 응답에 실려 화면에 그려진다** (`goal_met_count` — 카드 "목표 달성 N" 뱃지) | `journey-builder.ts:1683` · `JourneysPage.tsx:102·1866` |
| 4 | **추천 카드 축이 이미 있다.** CT `journey-opportunities.ts`(2026-06-29)가 "오늘의 여정 기회"를 실데이터로 산출 — 활성 여정 dedup(`template_code`) · 실측 count·valueAtStake 우선순위 · `suggestedObjective` 1클릭 생성. 라우트 `GET /api/ai/operator/journeys-opportunities`(`ai.ts:3351`), 화면은 페이징 카드 | `journey-opportunities.ts:50-168` · `JourneysPage.tsx:1652-1720` |
| 5 | **1클릭 생성 경로** = `POST /api/ai/operator/journeys-ai-generate` body `{ objective?, templateHint? }`. 기회 카드는 `handleAIGenerate(undefined, op.suggestedObjective)` — **트리거 프리셋은 오늘 없다**(AI가 고른다) | `JourneysPage.tsx:1025-1042·1704` |
| 6 | 프론트 카탈로그(`TRIGGER_EVENTS`)에 첫 구매·휴면 복귀가 라벨·기본 filters와 함께 있고(`templateCode:'repeat'`), parity 테스트가 카탈로그↔백엔드↔AI 집합을 고정한다 | `journey-trigger-catalog.ts:69-79` · `journey-trigger-catalog-parity.test.ts` |
| 7 | capability 판정의 서버 사실 원천 = `getCompanyJourneyFacts(companyId)` → `resolveTriggerAvailability(facts)` | `company-data-profile.ts:244` · `ai.ts:4243` |
| 8 | 저장 성공 지점(생성 직후 카드의 훅) = `POST /api/ai/operator/journeys` 성공 분기 — `setView('main')` 직전 | `JourneysPage.tsx:1496-1501` |
| 9 | 여정 상세의 "AI 다음 단계 추천"(D211+)은 **같은 여정 안 스텝 추천**이다 — 이 트랙과 축이 다르고 겹치지 않는다 | `JourneysPage.tsx:2357-2384` |
| 10 | 기회 엔진의 dedup 축은 `journeys.template_code`인데, **후속 트리거 3종이 전부 `repeat` 코드를 공유**한다 — 이어달리기 dedup을 template_code로 하면 서로를 오차단한다 | 사실 4·6의 교차 |

---

## 2) 구조 결정 — 새로 만들지 않는 것부터

| 만들지 않는 것 | 대신 쓰는 것 |
|---|---|
| 후속 관계 테이블·DDL | `TRIGGER_CONTRACTS` 필드 하나 (§3) |
| 전환 귀속 엔진·대조 워커 | `goal_met` 원장 (사실 2 — 이미 기록된다) |
| 새 추천 배너·새 카드 UI | 기회 엔진 + "오늘의 여정 기회" 카드 (사실 4) |
| 새 생성 화면 | `journeys-ai-generate` + 프리셋 파라미터 (§6) |
| 별도 라벨 표 | 카탈로그 `TRIGGER_EVENTS` 라벨 (사실 6) |
| 고객 자동 태우기(진입로) | 기존 진입 워커 — 후속 여정이 활성화되면 정상 경로로 잡는다 |

**DDL 0 · 발송 경로 무변경 · 돈 무관.** 사고 반경은 "추천이 안 뜬다"까지다.

---

## 3) 후속 관계의 소유자 — `TriggerContract.nextEvents`

백엔드 계약(단일 출처)에 필드 하나:

```ts
// journey-trigger-capability.ts — TriggerContract에 추가
/** ★ 2026-08-08 이어달리기 — 이 여정의 목표(exit)가 이뤄진 고객을 받는 다음 트리거. */
nextEvents?: string[];
```

**v1 간선 3개** (Harold 예시 그대로 — exit 신호와 의미가 일치하는 것만):

| from | exit(근거) | next |
|---|---|---|
| `customer.created` (신규가입) | `purchase` — 신규 고객의 구매 = 생애 첫 구매 | `purchase.first` |
| `purchase.first` (첫 구매) | `second_purchase` — 두 번째 구매 = 재구매 | `cdp.purchase` |
| `customer.dormant` (휴면) | `purchase` — 휴면 중 구매 = 복귀 | `customer.dormant_return` |

프론트 카탈로그(`TriggerDef`)에 같은 간선을 `nextKeys?: string[]`(key 축)로 미러하고,
**parity 테스트가 셋을 고정한다**: ①`nextEvents` 값 전부가 등록된 event ②프론트 `nextKeys` ↔ 백엔드 `nextEvents` 1:1
③간선의 from 트리거 `exit`가 `steps_done`이 아닐 것(전환 사건이 없는 여정에 "전환 추천"을 걸 수 없다).

간선 확장(v2 후보 — cart→? · grade→? · cycle_lapsed→?)은 이 표에 줄을 더하는 것뿐이다. 지금은 셋만.

---

## 4) 추천 시점 1 — 생성 직후 "다음 수" 카드

**훅** = 저장 성공 분기(사실 8). 저장한 여정의 `trigger_event`에 `nextEvents`가 있으면
`successionHint` state(`{ fromLabel, nextKey }`)를 세팅하고, 메인 뷰 상단("오늘의 여정 기회" 위)에 **닫을 수 있는 카드 1장**을 그린다.

- 문구 골격: "방금 만든 [신규 가입 환영] 여정의 목표가 이뤄진 고객은 **[첫 구매]** 트리거로 받을 수 있어요 — 이어서 만들어보시겠어요?"
- 버튼 = 1클릭 생성(§6 프리셋으로 후속 트리거 고정). 라벨·아이콘은 카탈로그에서.
- **노출 게이트 둘**(둘 다 이미 페이지에 있는 데이터): ①availability map에서 후속 key가 `available` ②후속 `trigger_event`의 활성 여정이 없음(목록 state).
- **영속화 없음** — 세션 한정 state, 닫으면 끝. DDL·localStorage 불요(운영 중 축은 §5가 상시 담당한다).

---

## 5) 추천 시점 2 — 기회 엔진의 `succession` 신호

`buildJourneyOpportunities`에 신호 유형 하나를 더한다 (`type: 'succession'`):

**성립 조건 (전부 실측·전부 fail-closed):**
1. 회사의 여정 j 중 `trigger_event`에 `nextEvents`가 있고 **`goal_met` 수 ≥ 1** (`journey_executions` COUNT — 사실 2의 원장).
2. 후속 `trigger_event`의 **활성 여정이 없다** — dedup 축은 `trigger_event`다(⛔ 사실 10 — template_code로 하면 repeat 3종이 서로를 오차단).
3. 후속 트리거의 **capability 통과** — `resolveTriggerAvailability(await getCompanyJourneyFacts(companyId))` (사실 7). 정답표 금지 원칙을 추천도 그대로 지난다: 구매 데이터 없는 회사에 구매 여정을 권하는 일이 구조적으로 없다.

**카드 내용:**
- `count` = goal_met 수(실측). `valueAtStake` = goal_met 고객의 `COALESCE(avg_order_value, 0)` 합(실측 — 임의 상수 금지 규약 유지).
- title/description 예: "휴면 회수 여정에서 **3명이 복귀**했어요 — 받아줄 여정이 없습니다."
- `suggestedObjective`(간선별 정적 골격, 구체 혜택 없음): dormant_return = "휴면에서 복귀한 고객 정착 — 복귀 감사 + 재구매 유도" / first_purchase = "첫 구매 고객 정착 — 감사 + 두 번째 구매 유도" / cdp.purchase = "재구매 고객 관리 — 구매 감사 + 다음 구매 제안".
- `templateCode`는 후속 트리거의 카탈로그 값(v1 셋 다 `repeat`) — 아이콘·그라데이션 재사용.
- **§6의 프리셋 필드를 카드 payload에 함께 싣는다**(`preferTriggerEvent`) — 추천이 약속한 트리거로 생성됨을 보장.

**한계 명시(정직):** goal_exit이 꺼진 여정은 goal_met이 안 쌓여 이 추천이 안 뜬다. 근거 없는 추천을 지어내지 않는다 —
"자동 종료 기본화"(STATUS 여정 카드에 등재된 상품 결정)가 내려지면 커버리지가 전체로 넓어진다. §10.

---

## 6) 생성 프리셋 — 추천의 약속을 지키는 장치

오늘 기회 카드는 `suggestedObjective`만 넘기고 **트리거는 AI가 고른다**(사실 5). 이어달리기에서 그대로 두면
"휴면 복귀 여정을 권했는데 AI가 재구매 여정을 만드는" 어긋남이 생긴다.

- `journeys-ai-generate` body에 `preferTriggerEvent?: string` 추가.
- 서버 처리 = **결정적 고정**: 값이 오면 ①등록·구현된 트리거인지 검증(fail-closed 400) ②AI에는 "이 트리거 전제로 스텝·문안을 설계하라"로 전달 ③**응답 패키지의 `triggerEvent`·`templateCode`·기본 `triggerFilters`를 카탈로그 계약값으로 강제 덮어쓴다** — AI는 문안·스텝 설계만 하고 트리거는 계약이 정한다(AI 출력에 약속을 걸지 않는다).
- 소비처 = §4 카드·§5 카드 둘 다. 기존 호출(프리셋 없음)은 무변경 — 하위호환.

---

## 7) 불변 원칙이 정하는 화면 문구 (완화 금지)

1. **소급 금지 고지** — §5 카드에 반드시: "지금 만들면 **앞으로** 복귀하는 고객부터 받습니다." 이미 전환한 N명은 이 여정을 받지 않는다(트리거는 활성화 이후 발생분 — FEATURE-JOURNEY §2). 이 문구가 빠지면 "켜 뒀는데 0건" 병이 추천 경로로 재발한다.
2. **겹침 안내** — `customer.dormant_return`을 추천하는 시점에 `cdp.purchase` 활성 여정이 있으면 한 줄 추가: "재구매 여정과 같은 구매 한 번에 둘 다 발송될 수 있어요"(FEATURE-JOURNEY §4의 기존 의무를 추천 카드가 승계).
3. 사유·라벨 전부 고객 언어 — 내부 용어(trigger_event 값·goal_met 등) 화면 노출 금지.

---

## 8) 영향표 — 수정 대상과 전 소비처

| 파일 | 수정 | 소비처 영향 |
|---|---|---|
| `utils/journey-trigger-capability.ts` | `TriggerContract.nextEvents` 필드+간선 3 | 기존 소비처(저장·활성화·executor·worker)는 이 필드를 안 읽음 — 무영향. 신규 소비 = 기회 엔진·parity |
| `frontend/utils/journey-trigger-catalog.ts` | `TriggerDef.nextKeys` 미러 | 기존 소비처(카드·모달) 무영향 — 신규 소비 = §4 카드 |
| `utils/journey-opportunities.ts` | `succession` 신호 + facts 게이트 | 소비처 = `ai.ts:3351` 라우트 하나(가산 항목 — 화면은 배열 그대로 그림). `JourneyOpportunityType`·`templateCode` union 확장 시 프론트 인터페이스(`JourneysPage.tsx:232`)도 함께 |
| `routes/ai.ts` `journeys-ai-generate` | `preferTriggerEvent` 수용+강제 덮어쓰기 | 기존 호출 2경로(자연어·templateHint) 무변경. 생성기 프롬프트 함수의 시그니처 확인 필요 |
| `pages/JourneysPage.tsx` | §4 카드 + 기회 카드 클릭에 프리셋 전달 | 저장 성공 분기·기회 카드 렌더 — 기존 흐름 가산 |
| `journey-trigger-catalog-parity.test.ts` | §3 불변식 3종 추가 | — |

DDL 0 · `journey_executions`·`journeys` 읽기만 추가(쓰기 무변경).

---

## 9) 구현 순서 (다음 세션 착수 원장) + 검증

1. **계약** — `nextEvents` 3간선 + 카탈로그 `nextKeys` 미러 + parity 3종. *검증: parity 실패 주입(미등록 event 간선) 후 원복.*
2. **기회 엔진** — `succession` 신호(goal_met 관측·trigger_event dedup·facts 게이트·실측 valueAtStake). *검증: 행동 테스트(query mock — goal_met 0이면 미노출 / 후속 활성 여정 있으면 미노출 / capability 잠기면 미노출 3종 + 노출 1종). 회귀 주입 = dedup을 template_code로 되돌려 실패 확인.*
3. **생성 프리셋** — `preferTriggerEvent`(검증→프롬프트 전달→계약값 강제). *검증: 행동 테스트 — 프리셋 시 응답 트리거가 AI 출력과 무관하게 고정되는가(AI mock이 다른 트리거를 내도 덮이는가).*
4. **화면** — §4 카드 · §5 카드 프리셋 배선 · §7 문구 3종. *frontend tsc + 모델명·native dialog grep.*
5. **문서** — FEATURE-JOURNEY §6 이력 행 + STATUS 카드 갱신.
6. **실측 1건 시나리오(배포 후)** — hoyun 테스트 계정: 휴면 여정 생성(goal_exit ON) → 테스트 고객 진입 → 구매 1건 적재 → goal_met 확인 → 기회 카드에 succession 노출 → 1클릭 생성 → 휴면 복귀 트리거로 초안이 만들어지는지.

Codex 판정: 돈·국세청·DDL 무관 — **대상 제외**(0804 확정 범위). 자체 적대 검토 + 회귀 주입으로 닫는다.

---

## 9-A) 구현 결과 (2026-08-08 · 배포 전)

착수 1~5 전부 구현 + Codex 적대검증 2라운드 반영. **DDL 0 · 신규 컬럼 0 · 발송 경로 무변경.**
backend tsc 0 / frontend tsc 0 / vitest 146파일 2149건(신규 2파일 39건).

| 조각 | 무엇을 넣었나 | 파일 |
|---|---|---|
| 계약 | `TriggerContract`에 `nextEvents`(간선 3) · `overlapEvents`(재구매↔휴면 복귀 대칭) · `templateCode`(카탈로그 미러) + 조회 3함수 | `utils/journey-trigger-capability.ts` |
| 카탈로그 미러 | `TriggerDef.nextKeys`·`overlapKeys` | `frontend/utils/journey-trigger-catalog.ts` |
| parity | 6종 — 등록 event · 구현 여부 · from의 exit ≠ `steps_done` · nextKeys↔nextEvents · overlapKeys↔overlapEvents(대칭 포함) · templateCode 1:1. **문자열 대조가 아니라 두 모듈을 import해 값 비교** | `journey-trigger-catalog-parity.test.ts` |
| 기회 엔진 | `succession` 신호 — goal_met 관측 · dedup 축 `trigger_event` · capability fail-closed · 실측 valueAtStake · 후속 중복 제거 · 카드 문구·고지 | `utils/journey-opportunities.ts` |
| 생성 프리셋 | `preferTriggerEvent` — 등록·구현 검증(라우트 400 + 생성기 throw) → 프롬프트에 시작 신호 → **응답의 트리거·templateCode 강제 덮어쓰기, 조건은 비움** + 패키지에 `presetTriggerEvent` 표식. 대화형 수정도 같은 고정을 다시 건다 | `utils/journey-ai-generator.ts` · `utils/journey-ai-editor.ts` · `routes/ai.ts` |
| 화면 | 다음 수 카드(생성 직후) · 기회 카드 프리셋 배선·고지 렌더·키 유일화 · 저장 시 프리셋 트리거 전송 | `frontend/pages/JourneysPage.tsx` |

### 설계가 예상하지 못한 것 3 (소스 실측에서 나왔고 전부 닫음)

1. **저장 경로가 트리거를 버린다.** `handleSaveDraft`는 `startKind`가 있을 때만 `triggerEvent`를 보내고, 마케팅 여정은 미전송이라 백엔드가 templateCode의 템플릿 기본값(`repeat`→`cdp.purchase`)을 쓴다. 서버가 패키지를 계약값으로 덮어써도 저장에서 사라지므로 §6의 보장이 성립하지 않았다. → 패키지에 `presetTriggerEvent` 표식을 싣고 **그 값이 있을 때만** 저장에 트리거·조건을 실어 보낸다(비프리셋 경로 무변경 = 하위호환).
2. **다음 수 카드의 근거는 패키지가 아니라 저장 응답이다.** 1의 이유로 `aiPkg.triggerEvent`는 저장된 값과 다를 수 있다. → `POST /operator/journeys` 응답 `detail.journey.trigger_event`(실제 저장값)로만 판단하고, 상세가 없으면 카드를 띄우지 않는다.
3. **겹침 규칙의 단일 출처가 없었다.** 여정 문서 §4에 글로만 있고 코드에 없었다(프론트 grep 0건). 카드 둘이 각자 조건을 적으면 복사 2벌이라, 간선과 같은 방식으로 계약+카탈로그 미러 + parity로 고정했다.

### 자체 적대 검토에서 고친 것

- **다음 수 카드가 "없다"를 증명할 수 없는 화면이 있다** — 목록은 상태 필터로 걸러져 오므로 보관함·종료 탭에서는 활성 여정이 안 실린다. 그 상태로 게이트 ②를 재면 이미 도는 여정을 또 만들라고 권한다. → `statusFilter`가 `all`·`active`일 때만 카드를 띄운다(증명 못 하면 권하지 않는다).
- **기회 카드 key 충돌** — `key={op.type}`인데 이어달리기는 후속 트리거마다 한 장이라 같은 type이 여럿 나온다. → `type:trigger`로 유일화.
- **화면이 목표 문장을 지어내는 문제** — "이어서 만들기"가 자체 문구를 만들면 같은 추천이 경로마다 다른 여정을 만든다. → 목표 골격은 `successionObjectiveFor` 한 곳에서 파생(프리셋만 오면 서버가 채운다 = 클릭 1회).
- **간선만 늘리고 문구를 빠뜨리면 조용히 미노출** → "모든 후속 트리거에 목표 골격이 있다" 불변식 추가.
- **고정한 트리거가 두 경로에서 풀렸다 — 같은 뿌리 하나**(패키지를 다시 만드는 자리마다 프리셋을 안 실었다). ①추천 모달의 [다시 만들기]가 프리셋 없이 재호출해 AI가 고른 다른 여정이 나왔다 ②대화형 수정(`editJourneyPackage`)이 표식을 안 돌려주고 AI의 `triggerEvent`·`templateCode`를 채택해, **문안 한 번 고치면 발송 대상이 바뀌었다**. → 두 자리 모두 계약값 고정을 적용(편집기는 표식이 있으면 트리거·templateCode를 계약값으로 다시 덮고 조건을 비운다). 저장·재생성·편집 셋이 같은 규칙을 지난다.

### 범위 밖에서 함께 닫은 것 1

`journey-step-format.ts`의 `TRIGGER_KO` 라벨 표에 §11-5(08-02) 신규 트리거 5종(첫 구매·휴면 복귀·구매 주기·등급 상승·조회 후 미구매)이 없어, 여정 타겟확인 모달과 AI 프롬프트에 `트리거: purchase.first` 같은 저장값이 그대로 나가고 있었다. 라벨 표는 하나뿐이라 여기 채웠다(소비처 = `routes/ai.ts:4061` 표시 1곳, 로직 의존 없음).

### Codex 적대검증 2라운드 (Harold 지시로 실행 — 룰상 대상 외이나 중요 기능이라 예외)

**1R = high 4 · medium 2.** 수용 5 · 불수용 1.

| 판정 | 지적 | 처리 |
|---|---|---|
| 수용 | **검토 화면 [다시 생성]이 프리셋을 해제**(`JourneysPage.tsx:1138`) — 휴면 복귀로 만든 초안을 다시 생성하면 기본 재구매 여정으로 저장된다 | **같은 뿌리 세 번째라 구조를 고쳤다** — 재생성 요청 조립을 `regenerateFromPackage` 한 곳으로 모으고 두 버튼이 그것만 부른다 |
| 수용 | **편집이 대상과 문안을 가른다** — 트리거만 되돌리고 문안은 다른 대상 기준으로 재작성된 채 남는다 | AI 호출 **전에** 시작 신호 전제를 프롬프트에 주고, 결과는 계약값으로 다시 고정 |
| 수용 | **생성 문안에 임의 혜택 기계 차단이 없다** — `stripUnauthorizedBenefits`가 다듬기에만 걸려 있었다(0802부터 생성 경로 부재) | 생성 steps 정규화에 적용. 근거는 사용자 목표 문장 하나. ⚠ **기존 동작 변경** — 빠른 시작(목표 문장 없음) 경로의 AI 혜택이 전부 placeholder가 된다 |
| 수용 | **실행 행 단위 중복 집계**(medium) — 재진입 고객이 여러 명으로 세어진다 | 고객 단위 `DISTINCT` CTE로 재작성 |
| 부분 수용 | 후속 부재 게이트가 오래된 목록으로 열린다(medium) | `loading`·`error`에서 카드를 닫는다. **draft·paused 후속에도 권하는 것은 설계 유지**(중복 판정 축은 활성 여정 하나 — §5-2) |
| **불수용** | `journey_executions`에 `e.company_id = $1` 추가 | **그 컬럼이 없다**(SCHEMA 실측). 넣으면 tsc는 통과하고 운영에서 질의가 깨진다(D227 형태). 이 테이블의 테넌트는 소속 여정이고 `j.company_id = $1 AND j.id = e.journey_id`가 이미 그 사슬을 강제한다. **불변식으로 못 박음**("넣으면 런타임에 깨진다") |

**2R = high 1 · medium 2.** 1R 처방 확인도 함께 왔다 — `handleAIGenerate` 호출 5곳에 프리셋 손실 없음, `converted` CTE가 기존 6개 카드의 수치·정렬 불변.

| 판정 | 지적 | 처리 |
|---|---|---|
| 수용 | **거짓 고지**(high) — 이탈 판정이 `triggerEvent` 차이만 봐서, AI가 같은 트리거에 VIP 조건만 붙이고 "VIP만 보내도록 바꿨습니다"라고 답하면 조건은 비워지는데 그 문장이 그대로 나간다(좁혀진 줄 알고 넓은 대상으로 활성화) | 이탈 판정을 **되돌리는 축 3개 전부**(트리거·templateCode·조건)로 넓히고, 이탈이면 **AI 사유를 서버 문장으로 교체**한다(대상을 옮긴 전제로 쓰인 설명은 문안 부분도 믿을 수 없다) |
| 부분 수용 | 게이트가 어느 필터의 응답인지 모른다(medium) | 성공 응답에 `loadedStatus`를 함께 적고 지금 필터와 같을 때만 카드를 연다. **AbortController·요청 시퀀스 전면 도입은 목록 조회 구조 변경이라 이 트랙 밖**(별건) |
| **불수용** | 재생성 실패 시 추천 모달 복귀 불가(medium) | **기존 동작이고 이 라운드가 만든 것이 아니다**(`onRegenerate`는 원래도 모달을 먼저 닫았다). medium이라 등재만 — 별건 |

**라운드 상한 2회 도달로 종결.** 남은 medium 2건은 위 표에 등재된 그대로다.

### 회귀 주입 (검출력 확인 — 전부 확인 후 원복)

| 주입 | 결과 |
|---|---|
| 미등록 event 간선(`purchase.zzz`) 추가 | parity 3건 실패 |
| dedup 축을 `template_code`로 되돌림 | 행동 테스트 2건 실패(`repeat` 3종 오차단·겹침 안내) |
| 프리셋 강제 덮어쓰기 무력화 | 행동 테스트 3건 실패(트리거·templateCode·조건) |

### 남은 것

- ⚠ **배포 전 Harold 확인 1건** — 생성 경로 혜택 차단이 이 트랙 밖 흐름(자연어·빠른 시작)에도 적용된다. 빠른 시작은 목표 문장이 없어 AI가 쓴 할인율·쿠폰이 전부 `[혜택 안내 — 직접 수정해주세요]`로 바뀐다. `ai_no_arbitrary_benefit` 방향이지만 **기존 동작 변경**이다. → **같은 날 후속 접수(혜택 입력 — [여정 문서 §6-1 08-08(2)](FEATURE-JOURNEY.md))가 보완**: 진입 모달의 혜택 입력이 허용 근거가 되고, placeholder가 나와도 스튜디오 카드가 입력 한 번으로 채운다.
- 별건 2(2R 등재) — 목록 조회 요청 시퀀스·AbortController · 재생성 실패 시 추천 모달 복귀.
- 실측 = §9-6 시나리오(배포 후).
- 관찰: 추천 정렬은 기존 축(`valueAtStake` 내림차순) 그대로다. 이어달리기의 매출 규모는 전환한 소수 인원 기준이라 다른 카드보다 작게 잡혀 뒤 페이지로 밀릴 수 있다. **임의 가중치를 넣지 않았다**(상수 금지). 화면 실측에서 실제로 묻히면 그때 축을 다시 본다.

---

## 10) Harold 결정 대기 · v2 후보

- **자동 종료(goal_exit) 기본화** — 이미 STATUS 여정 카드에 등재된 상품 결정. 이 트랙은 그 결정 없이도 정직하게 동작하지만(근거 없으면 §5 미노출), 기본화되면 운영 중 추천의 커버리지가 전체 여정으로 넓어진다. **이 트랙 착수 시 같이 결정하면 좋은 것이지 선행 조건은 아니다.**
- v2 후보: 간선 확장(cart·grade·cycle_lapsed의 다음 수) · **생애주기 지도**(간선들이 쌓이면 "우리 여정이 생애 어느 구간을 덮고 어디가 비었나" 한 화면 — 제품의 말이 "여정 도구"에서 "생애주기 관리 시스템"으로 바뀌는 지점).

---

## 11) 함정 — 이 설계가 미리 밟아 둔 것

1. **template_code로 dedup하면 안 된다**(사실 10) — repeat 3종이 서로를 오차단. dedup 축은 `trigger_event`.
2. **AI 출력에 약속을 걸지 않는다**(§6) — 프리셋은 서버가 계약값으로 강제 덮어쓴다. 프롬프트 지시만으로는 보장이 아니다.
3. **exit=`steps_done` 트리거에 간선을 달지 않는다**(§3 parity ③) — 전환 사건이 없는데 "전환했어요" 추천은 성립하지 않는다.
4. **goal_met 없는 여정에 근거를 지어내지 않는다**(§5) — 기회 엔진의 기존 원칙(의미 있는 신호만)과 같다.
5. **간선·라벨·필터를 세 번째 자리에 복사하지 않는다** — 간선은 계약+카탈로그 미러(parity 고정), 라벨·필터는 카탈로그 하나.
6. 기회 카드의 Source caption 규약(실데이터 집계 표기)·구체 혜택 미포함(`suggestedObjective` 골격만) — 기존 카드와 동일 유지.
