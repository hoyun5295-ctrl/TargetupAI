# 발송 대상 리스트 3시점 확인 (여정·자동마케팅) — 상세 설계서

> 작성 2026-07-10 · 상태 **설계 확정(Harold 승인 대기 없음 — "설계서 만들어 다음 세션 구현" 지시) / 구현 미착수**
> 다음 세션은 이 문서만 읽고 바로 구현한다. 본문의 모든 계약(파일·함수·컬럼·응답 형태)은 2026-07-10 코드 실측이며, 실측 근거를 각 항목에 주석으로 달았다. 코드와 불일치 시 코드가 진실 — 단 구현 전 §9 재확인 체크리스트로 드리프트를 잡는다.

---

## 0. 기원 — 왜 이 설계가 나왔나

1. **직원 신고(박성용, 2026-07-10)**: "여정이나 자동마케팅에서 발송 스케줄링 하면 고객 리스트 보이게 업데이트해 주셨었는데 안 보입니다."
2. **사실 확정(실측)**: git 전 이력 `-S "TargetRecipientsModal"` / `-S "리스트 보기"` 검색 결과, **여정(JourneysPage)·자동마케팅(ContinuousOperatorPage)과 그 하위 컴포넌트에는 이 기능이 존재한 적이 없다(커밋 0건)**. 2026-07-09 커밋 90823d71이 넣은 곳은 발송툴 6곳(대시보드 직접/예약 발송·AI Operator·타겟 추출·AI 캠페인 결과·카카오)뿐. Harold 확인: "없었던 게 맞아."
3. **진짜 니즈(고객사)**: AI가 추출한 발송 리스트를 처음부터 신뢰하지 못함 — **발송 전에 "누구에게 나가는지" 눈으로 확인**하고 싶어 함.
4. **문제의 어려움(Harold 제기)**: 여정은 하나 시작되면 고객별로 여러 스텝을 시차로 밟고, 자동마케팅은 당일 2시간 전에야 문안 생성+리스트화가 일어난다 — "고정된 사전 리스트 한 장"이 성립하지 않는 동적 시스템이다.
5. **★직원 회의 결론(2026-07-10, Harold 반영 확정 — 본 설계의 최종 범위)**:
   - **여정 = 보류** — 실시간성 때문에 타겟 리스트 표시가 힘들다는 회의 결론. §4 전체를 이번 범위에서 제외(문서는 보존 — 재개 시 같은 패턴)
   - **자동마케팅 = 오늘의 추천 카드에 [타겟확인] 버튼** — "승인하고 발송/거부" 버튼을 옆으로 밀고 그 왼쪽에 배치(직원 캡처 기준)
   - **리스트 컬럼 = 이름·연락처 + 추출 조건에 쓰인 필드 동적 동봉** — 예: "VVIP+포인트 5000" 조건이면 등급·포인트 컬럼이 리스트에 나온다("왜 뽑혔는지"를 행 단위 증명)
   - **표시 상한 100명(Harold 확정)** — 20만명급 업체 다수 운영 시 부하 우려. 전체 수는 카드의 "대상 N명"이 이미 담당

## 1. 설계 원칙 (왜 이렇게 하는가)

**원칙 1 — 리스트는 하나가 아니라 시점 셋이다.**
동적 시스템에서 단일 사전 리스트를 보여주면 실제 발송 명단과 달라져 거짓 표시가 된다(영구 룰: 미리보기 상수 목업 = 거짓 표시 금지 / 대상자 수 = DB 실측만). 그래서:
- **시점 1(설계·활성화)**: "지금 기준 예상 대상" — 정직 라벨("발송 시점에 재추출됩니다") 동반
- **시점 2(발송 확정)**: 자동마케팅 = 추천 카드의 확정 명단(2시간 전 리스트화 후) / 여정 = 스텝별 "다음 발송 예정" 그룹
- **시점 3(발송 후)**: 기존 발송결과 수신자 상세 — 이미 존재, 본 설계 무변경

**원칙 2 — 명단 조회 SQL은 발송 추출 SQL과 같은 조각을 공유한다.**
근거 = 2026-07-09 실사고 교훈("조회 664 vs 추출 660" — 조회와 발송이 다른 기준을 쓰면 불일치 신고가 된다) + D230("검증 경로 본문 ≠ 실발송 본문 = 사고"의 타겟판. 안전필터(buildJourneySafetyFilter)·피로도(fatigue)·미반응자 제외(excludeClickedSince)를 발송과 동일 인자로 합성해야 "보여준 명단 = 나가는 명단"이 된다.

**원칙 3 — 명단만 보여주지 말고 "선정 기준 + 실측 인원 + 기준 시각"을 함께 보여준다.**
고객 불신의 뿌리는 "왜 이 사람이 뽑혔는지 모른다"이다. 공용 모달이 이미 objective/criteria/totalCount/sourceLabel을 지원하므로 전 시점에 채워 넣는다.

**원칙 4 — 전부 SELECT 전용·무과금·기존 데이터 축 재사용. DDL 0건.**
자동마케팅 필터는 proposal_json.target.filters에 이미 저장돼 있고(continuous-operator.ts:1380 실증), 여정은 트리거 추출 CT와 실행 원장(journey_executions)이 이미 있다. 새 테이블/컬럼 불요 — information_schema 검증 대상 없음.

## 2. 공용 자산 — 실측 계약 (그대로 재사용, 수정 금지)

### 2-1. TargetRecipientsModal (frontend/src/components/TargetRecipientsModal.tsx — 2026-07-10 실측)
```ts
// props (원문): show, onClose, title?, objective?, criteria?, channelLabel?,
//   totalCount?, fetchPage?: TargetPageLoader, sourceLabel?, pageSize?(기본 15)
export type TargetPageLoader = (page: number, pageSize: number) => Promise<{ recipients: TargetRecipient[]; total: number }>;
export function arrayPager(recipients: TargetRecipient[]): TargetPageLoader;  // 메모리 배열 → 클라 페이징
// TargetRecipient = { phone?, name?, grade?, gender?, region?, age?, [k]: any }
```
- 전화번호 마스킹(010-****-1234)은 모달 내부 maskPhone이 자동 처리 — 호출부는 원본 전달
- z-[2000] + createPortal — 다른 모달 안에서 열어도 안전(활성화 모달 안에서 열 때 이 성질을 쓴다)

### 2-2. 발송과 동일한 수신자 WHERE 합성 (backend 실측)
- `utils/operator-recipients.ts` — `buildSendableRecipientsSql(filterWhere, filterParams, baseParams, storeFilter, excludeClickedSince?)`
  = 안전필터(buildJourneySafetyFilter: is_active·sms_opt_in·is_opt_out·is_invalid·수신거부 회사+전화 안티조인) + 미반응자 제외. **주의: 이 함수는 미리보기용 LIMIT이 있는 단일 SELECT — §3-1에서 상한 100 전용 순수 헬퍼(buildSendableRecipientsTopSql)를 신설**한다(WHERE 조각은 동일 구성).
- `buildFilterWhereClauseCompat(filters, startIdx)` — CT-01 호환 필터 → WHERE 조각(leading AND · unqualified 컬럼 · $1=companyId 전제)
- `buildFatigueGuardClause` / `getFatigueCap(companyId)` — 발송 피로도(회사 opt-in)
- 브랜드 격리: company_user는 `getStoreScope(companyId, userId)` → filtered면 `AND id IN (SELECT customer_id FROM customer_stores ...)` (routes/ai.ts preview-recipients 1380행대 원문 미러 의무 — 빠뜨리면 매장 사용자에게 타 매장 고객 노출)

### 2-3. 기존 유사 endpoint (참조용 — 무변경)
- `POST /api/ai/operator/preview-recipients` {filters} → 전체 recipients(페이징 없음) — AI Operator 카드용
- `POST /api/targets/recipients` {channel, filter, page, pageSize} → 비문자 채널 페이징 — 이메일/인앱/DM용
- 이 둘은 그대로 두고, §3·§4의 신규 endpoint는 이 파일들의 패턴(게이트·503 안전망·응답 형태)을 미러한다.

## 3. 자동마케팅 (ContinuousOperatorPage + components/automarketing)

### 3-1. backend — 확정/예상 명단 endpoint 신설

**① 순수 헬퍼 신설**: `utils/operator-recipients.ts`에 추가 (기존 함수 무변경 — CT 7-1 준수)
```ts
// buildSendableRecipientsTopSql(filterWhere, filterParams, baseParams, storeFilter,
//   excludeClickedSince, fatigueCap, extraColumns, limit=100)
//   → { listSql, listParams }
// (★회의 결론: 페이징판 폐기 — LIMIT 100 단일 쿼리. COUNT 없음)
// WHERE 조각 = buildSendableRecipientsSql과 동일 합성(안전필터+클릭제외+피로도) — 원칙 2.
// SELECT = c.phone, c.name + extraColumns(조건 필드 — 검증된 실컬럼/custom_fields 접근만 화이트리스트로 합성, SQL 주입 차단)
// ORDER BY = 발송 추출과 동일(없으면 c.id ASC 결정적) · LIMIT 100
// 순수 함수(DB import 0) — vitest 대상 (기존 operator-recipients 순수성 유지: fatigue-guard-core 패턴)
```
왜 신설인가: 기존 buildSendableRecipientsSql은 발송 staging·미리보기 표본용이라 동적 조건 컬럼·상한 100 계약이 다르다. 같은 파일에 두고 WHERE 조각을 공유하면 발송↔조회 불일치가 구조적으로 차단된다.

**② endpoint 신설**: `routes/ai.ts` (★회의 결론 반영판)
```
POST /api/ai/operator/proposals/:id/recipients   {}   (페이징 파라미터 없음)
→ { success, recipients[≤100], displayTotal, criteria, segmentName, basisLabel,
    conditionColumns: [{ key, label }] }
```
- **서버 쿼리 1방 고정**: 발송 추출과 동일 WHERE + **동일 정렬 기준으로 앞 100명 LIMIT 100** — COUNT·OFFSET 없음(부하 상수화, Harold 상한 확정). displayTotal = proposal의 recipient_count(카드 "대상 N명"과 동일 값 재사용 — 별도 COUNT 금지)
- **conditionColumns(동적 조건 컬럼)**: `proposal_json.target.filters`의 사용 필드 키를 FIELD_MAP displayName으로 라벨링해 반환(예: grade→등급, points→포인트). recipients 각 행에 그 필드 값 동봉(SELECT 컬럼에 필터 사용 필드 추가 — customers 실컬럼만, custom_fields 필터면 custom_fields에서 추출). 라벨 단일 소스 = FIELD_MAP displayName(0709 개인화 라벨 통일 교훈 — 별도 라벨 테이블 금지)
- 정렬 = 발송 추출과 동일 기준(임의 "상위" 산정 금지 — 추출 SQL의 ORDER를 그대로, 없으면 c.id ASC 결정적 정렬로 통일하고 그 사실을 캡션에 표기)
- 게이트: `isAiOperatorAllowed(planCtx, req.user)` (같은 파일 proposals 라우트들과 동일)
- **소유자 scope 의무**: proposal 로드 시 `operator_proposals p JOIN continuous_operators o` 후, 비관리자(`userType !== 'company_admin'`)는 `o.created_by = userId`만 허용 — 2026-07-09(5)에서 확정한 listProposals 노출범위 규칙과 동일해야 한다(빠뜨리면 타 담당자 고객 명단 노출).
- 필터 원천: `p.proposal_json->'target'->'filters'` (continuous-operator.ts:1380 `pj.target?.filters || {}` 실증과 동일 경로). 없으면 `{}`(전체) — dispatch와 같은 해석.
- excludeClickedSince·fatigueCap: **dispatchProposalSend의 산출 로직과 동일하게 구성**. 구현 시 continuous-operator.ts의 dispatch 준비부(1435행 부근 "발송 시점 타겟 재추출" 블록)에서 두 값이 어떻게 계산되는지 읽고, 가능하면 그 계산을 함수로 추출해 공유한다(복붙 금지 — 값이 갈리면 원칙 2 위반).
- storeScope: company_user면 §2-2 브랜드 격리 미러.
- 응답 basisLabel(시점 정직 라벨 — 원칙 1):
  - proposal.status가 승인 대기/예약(2시간 전 리스트화 이후) → `"발송 확정 기준 명단 (지금 기준 실측 · 발송 시점 안전필터 재반영)"`
  - 그 외(사전 열람) → `"예상 대상 (지금 기준 실측 · 발송 시점 재추출)"`
  - 왜 "확정"에도 "재반영" 문구가 붙나: 발송 직전 수신거부·피로도는 발송 시점에 또 걸러진다(발송 코드가 그렇게 동작 — 1435 주석 실증). 100% 동일 보장은 불가능하므로 문구로 정직하게.
- catch: `column ... does not exist` → 503 DB_MIGRATION_PENDING (파일 내 기존 패턴), 그 외 500. SELECT 전용 — 크레딧 차감 없음.

**③ (선택 아님, 동일 커밋) 오퍼레이터 예상 대상**: 기존 오퍼레이터 편집 화면(OperatorSetupModal)에서 쓸 수 있게 `POST /api/ai/operator/operators/:id/expected-recipients` {page,pageSize} — 필터 원천만 다름: `continuous_operators`의 타겟 필터(구현 시 실컬럼 확인 — proposal이 아니라 operator 본체에 저장된 타겟 정의. **grep으로 operator 타겟 필터 저장 컬럼/키를 실측한 후 작성**. 못 찾으면 이 endpoint는 보류하고 ①②만 — 무리한 추측 금지). 나머지 규칙은 ②와 동일.

### 3-2. frontend — 연결 2곳

**① ProposalDecisionCard (components/automarketing/ProposalDecisionCard.tsx)** (★회의 결론 반영판)
- 버튼명 = **[타겟확인]** — 위치는 "승인하고 발송"·"거부" 버튼을 옆으로 밀고 그 **왼쪽**에 배치(직원 캡처 기준 — 하단 액션 행: [타겟확인] [승인하고 발송] [거부])
- 클릭 → 1회 로드(POST /proposals/:id/recipients) → **arrayPager(recipients)** 로 TargetRecipientsModal에 전달(클라 페이징 15명 — 서버 재호출 0)
  - `criteria` = 응답 criteria, `totalCount` = displayTotal, `sourceLabel` = basisLabel
  - 캡션: `전체 {displayTotal}명 중 최대 100명 표시 (발송 추출과 동일 기준·순서)` — 100명 캡 정직 표기
  - **동적 조건 컬럼**: 모달에 `extraColumns: [{key,label}]` prop 신설(§2-1 모달 확장 — 기본 미전달=기존 6곳 렌더 byte 불변). 전달 시 기본 컬럼(이름·연락처) 뒤에 조건 필드 컬럼 추가 렌더
- 노출 조건: proposal에 target 정보가 있는 전 상태(pending/approved/scheduled). 발송 완료(sent)면 버튼 대신 기존 발송결과 상세로 안내(신규 개발 없음 — 문구만)

**② ContinuousOperatorPage의 오퍼레이터 관리 목록(OperatorsManageList) 또는 설정 모달(OperatorSetupModal)**
- `[예상 대상 보기]` — ③ endpoint 연결. ③이 보류되면 이 버튼도 보류(반쪽 UI 금지)

### 3-3. 자동마케팅에서 이 설계가 니즈를 닫는 이유(주석)
Harold 실측 발언: "자동마케팅은 당일 2시간 전에 문안 생성 및 리스트화" — 즉 승인 대기/예약 상태의 추천 카드가 뜬 시점에는 **확정에 준하는 명단이 조회 가능**하다. 승인형 운영이면 "명단 보고 승인"이 되어 고객 신뢰 문제가 정면으로 풀린다. 자동실행이어도 2시간 창에서 같은 카드로 확인 가능.

## 4. 여정 (JourneysPage + components/journey) — ★전체 보류(2026-07-10 직원 회의 결론: 실시간성으로 이번 범위 제외. 재개 시 아래 그대로 사용)

### 4-1. 시점 1 — 활성화 확인 모달에 "예상 대상 리스트"

**backend 신설**: `routes/ai.ts`
```
GET /api/ai/operator/journeys/:id/expected-recipients?page=&pageSize=
→ { success, recipients[...5종], total, capped: boolean, criteria, basisLabel }
```
- 게이트: isAiOperatorAllowed + 여정 회사 격리(journeys WHERE id AND company_id — journey-stats verifyJourneyOwnership 패턴)
- 대상 산출 = **`selectJourneyTargetCustomerIds(companyId, triggerEvent, triggerFilters, LIMIT)`** (utils/journey-target-extractor — 발송 진입과 동일 CT. routes/ai.ts의 여정 sampleCustomer 경로가 이미 이렇게 쓰고 있음 — 그 코드 미러)
  - LIMIT 상한 = 3,000 (이유: 이 함수는 id 배열 반환형이라 정확 전체 COUNT가 없다. 3,000 초과면 `capped: true`로 응답하고 프론트가 "3,000명까지 표시(상한)" 캡션 — 없는 정확치를 지어내지 않는다. 상한값은 구현 시 상수로 두고 주석에 이 문단 링크)
  - 페이징 = ids 배열 슬라이스 → `customers WHERE id = ANY($slice)` + `array_position` 정렬(기존 sampleCustomer SQL 미러) + company_user storeScope 미러
- basisLabel: `"지금 조건 충족 예상 대상 (활성화 후에는 트리거 발생 시점마다 진입)"`
- **이벤트 트리거 정직 처리(왜 중요한가)**: 신규가입·구매 등 이벤트 트리거는 "지금 충족자 0명"이 정상일 수 있다(앞으로 발생할 고객이 진입). total=0이어도 오류가 아니라 안내 문구를 보여준다 — `"지금 기준 대상 0명 — 이 여정은 [트리거명] 발생 시점에 고객이 진입합니다."` (0건 발송차단 룰과 무관 — 이것은 발송이 아니라 조회)

**frontend**: JourneyActivationConfirmModal(components/journey/JourneyActivationConfirmModal.tsx)
- 검증 결과 화면(비용·인원 표시부)에 `[예상 대상 리스트 보기]` 버튼 → TargetRecipientsModal(z-2000이라 이 모달 위에 안전하게 뜸 — §2-1)
- 모달 props: criteria = 여정 트리거/조건 요약(기존 활성화 응답에 있으면 재사용, 없으면 trigger_event 라벨), sourceLabel = "journey-target-extractor (발송 진입과 동일 추출)"

### 4-2. 시점 2 — 여정 상세 "다음 발송 예정" (스텝별 그룹)

여정의 발송 리스트는 "한 장"이 아니라 **스텝별 흐름**이다. 이미 있는 두 축을 조합한다:
- 실측 축 A: JourneysPage 실시간 진행 위치(livePositionsMap) — journey-stats에 스텝별 인원 + `MIN(next_run_at) FILTER (WHERE status='active')`(journey-stats.ts:656 실증)가 이미 있다
- 실측 축 B: 실행 원장 `journey_executions(status='active', current_step_order, next_run_at, customer_id)`

**backend 신설**: `routes/ai.ts`
```
GET /api/ai/operator/journeys/:id/upcoming-recipients?stepOrder=&page=&pageSize=
→ { success, recipients[...5종 + nextRunAt], total, stepOrder, earliestRunAt }
```
- **stepOrder 의미(오차 주의)**: "다음에 실행될 스텝" = `current_step_order + 1 = stepOrder`. 즉 SQL은 `WHERE e.journey_id=$1 AND e.status='active' AND e.current_step_order = $stepOrder - 1`. (executor가 next step = current+1을 조회하는 것과 동일 축 — journey-executor processExecution의 nextStepOrder 계산 실증. 여기서 어긋나면 한 스텝 밀린 명단을 보여주는 버그가 된다)
- JOIN customers(이름·전화·등급·성별·지역) + 회사 격리 + ORDER BY e.next_run_at ASC, e.id ASC(동시각 tie-breaker — LIMIT/OFFSET 페이징의 unique tie-breaker 의무: D150-4 교훈) + LIMIT/OFFSET
- 발송 예정 시각은 개인별 `e.next_run_at`을 그대로 노출(여정은 고객별 시차가 있다 — 그룹 대표 시각만 보여주면 거짓)

**frontend**: JourneysPage 확장 상세의 실시간 진행 위치 카드(livePositionsMap 렌더부)
- 각 스텝 행의 "인원 N명"을 클릭 가능하게 → TargetRecipientsModal(fetchPage = upcoming-recipients, title = "스텝 {n} 발송 예정 대상", criteria = "이 스텝을 다음에 받을 active 진행 고객 · 가장 이른 예정 {earliestRunAt}")
- 왜 이 자리인가: 이미 스텝별 인원·예정 시각이 보이는 유일한 곳이라 신규 화면 없이 "숫자 → 명단" 열람이 된다(1클릭 원칙)

### 4-3. 시점 3 — 발송 후 (무변경)
여정 스텝 발송은 (journey,step,KST날짜)당 campaign 1건(journey_step_campaigns)으로 이미 발송결과 상세와 연결돼 있다. 본 설계는 손대지 않는다.

## 5. 안전·영구 룰 준수 (전 endpoint 공통)

| 항목 | 규칙 | 근거 |
|---|---|---|
| 회사 격리 | 모든 SQL 첫 조건 `company_id = $1::uuid` + 여정은 소유 검증 선행 | journey-stats verifyJourneyOwnership 패턴 |
| 소유자 scope | 자동마케팅 비관리자 = operator.created_by 본인 것만 | 2026-07-09(5) 노출범위 확정 규칙 |
| 브랜드 격리 | company_user = getStoreScope 미러(§2-2) | B16-01 · preview-recipients 실코드 |
| 개인정보 | 전화 마스킹은 모달 내부 처리 — API는 원본 반환하되 위 세 격리로 접근 통제 | 기존 6곳과 동일 수준 |
| 과금 | 전부 SELECT 전용 — 크레딧 0, callAIWithFallback 호출 없음 | 무과금 원칙 |
| 0건 | 조회 0건 = 오류 아님(정직 안내) — 자동완화·조건 재추천 절대 금지 | D171 |
| 페이징 | 기본 15 · 상한 100 · ORDER BY 고유 tie-breaker | targets/recipients 실코드 + D150-4 |
| 503 안전망 | column/relation does not exist → 503 DB_MIGRATION_PENDING | db_alter_safety_net (DDL 0이지만 습관 유지) |
| 모델명·native dialog·박-단어 | UI 노출 0 — 작성 후 grep 의무 | 영구 룰 |

## 6. 구현 파일 목록 (예상 규모)

**backend**
| 파일 | 작업 |
|---|---|
| utils/operator-recipients.ts | buildSendableRecipientsPageSql 신설(순수) — 기존 함수 무변경 |
| routes/ai.ts | POST /operator/proposals/:id/recipients (+§3-1③ operator 필터 실측 성공 시 expected-recipients). ~~여정 2 endpoint~~ 보류 |
| utils/__tests__/operator-recipients.test.ts(또는 verify) | 페이지 SQL 순수 테스트(WHERE 조각 = 기존 함수와 동일성 비교 포함) |

**frontend** (전부 "연결"만 — 신규 화면 0)
| 파일 | 작업 |
|---|---|
| components/automarketing/ProposalDecisionCard.tsx | [발송 대상 N명 리스트 보기] + 모달 연결 |
| components/automarketing/OperatorSetupModal.tsx 또는 OperatorsManageList.tsx | [예상 대상 보기] (③ 성립 시) |
| components/journey/JourneyActivationConfirmModal.tsx | ~~[예상 대상 리스트 보기]~~ **보류(회의 결론)** |
| pages/JourneysPage.tsx | ~~스텝 행 인원 클릭 upcoming 모달~~ **보류(회의 결론)** |

## 7. 검증 계획 (구현 세션 의무)

1. backend tsc 0 · frontend tsc 0 · vitest 전건(+신규 순수 테스트)
2. **동일성 grep 증거**: 신규 페이지 SQL의 WHERE 구성 요소(안전필터·피로도·클릭제외·storeScope)가 dispatch/preview와 동일 CT 호출인지 — grep 결과를 보고에 첨부
3. 금지 패턴 grep 0(모델명·native dialog·박-단어) — 수정 frontend 4파일
4. 운영 실측 1건: hoyun 계정 — ①자동마케팅 추천 카드 리스트 보기(명단=이후 실제 발송 수신자와 대조) ②여정 draft 활성화 모달 예상 리스트 ③active 여정 스텝 인원 클릭 → 명단·예정시각 표시 확인
5. 소비처 확인: TargetRecipientsModal 기존 6곳 diff 0(무변경 증명)

## 8. 비범위 — 하지 말 것 (범위 팽창 금지)

- 기존 발송툴 6곳의 리스트 기능 무변경 (박 과장 신고 대응은 이미 종결 — 그쪽은 정상)
- 발송·차감·staging 로직 무변경 (조회 endpoint만 신설)
- DDL 없음 · 여정 goal_exit(2026-07-10 별건)와 무관 — 섞지 말 것
- 사전알림 문자에 명단 링크 삽입, 고객 화면 CSV 다운로드 등은 이번 범위 밖(필요 시 별도 과제)

## 9. 다음 세션 시작 체크리스트 (이 순서대로)

1. CLAUDE.md·STATUS.md 정독(상시 룰) + LESSONS_BACKEND·LESSONS_FRONTEND 정독
2. 본 문서 전체 정독
3. 실측 재확인(드리프트 방지 — 각 5분): ① continuous-operator.ts dispatch 준비부에서 excludeClickedSince·fatigueCap 산출 방식 ② §3-1③ operator 본체 타겟 필터 저장 위치 grep(`target` continuous_operators 컬럼/JSON 키 — 없으면 ③ 보류) ③ ProposalDecisionCard·JourneyActivationConfirmModal·JourneysPage livePositions 렌더부의 현재 구조
4. 구현 순서: backend 순수 헬퍼+테스트 → endpoint 3~4개 → frontend 연결 4곳 → §7 검증 → Codex 리뷰(codex_review_after_code_change 의무) → 표준 종료 멘트
5. Harold 보고 시: §7-2 동일성 grep 증거와 §7-4 실측 시나리오 결과 첨부
