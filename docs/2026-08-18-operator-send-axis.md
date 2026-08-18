# 오퍼레이터 발송 축 정정 — 출처(send_type) · 타겟(filters) (2026-08-18)

> **호출어 = 오퍼레이터 발송 축**
> AI 오퍼레이터가 만든 발송이 **누구 것으로 기록되고 누구에게 나가는가** 두 축을 함께 고친 트랙.
> 기능 상설(AI Operator 전반)은 [`AI_OPERATOR_기능정의서.md`](AI_OPERATOR_기능정의서.md) §13이 소유 — 여기는 **근거와 함정**만.
> 값 집합의 코드 소유 = `backend/src/utils/send-type-axis.ts` · `backend/src/utils/billing-send-phase.ts`

---

## §1 확정 사실 — 재검증 불요

| 사실 | 근거 |
|---|---|
| 오퍼레이터 승인 발송은 `POST /api/campaigns/direct-send` 배관을 탄다 | `AiOperatorPage.performDirectSend` |
| 그 INSERT가 `send_type`을 **리터럴 `'direct'`**, 캠페인명을 **`직접발송 {일시}`**로 박고 있었다 | `routes/campaigns.ts` /direct-send INSERT · 접수 행 덤프의 `staging_id`·`send_phase`·`send_config` NULL 패턴이 이 INSERT와 일치 |
| `campaigns.send_type`에는 **CHECK 제약이 없다** | `pg_constraint` 실측(2026-07-31) — campaigns의 CHECK는 `message_type`·`status` 2건뿐. 값을 늘려도 DDL 0 |
| 필터 엔진은 **진작부터 이름을 처리할 수 있었다** | `standard-field-map.ts:66` name = string 컬럼 · `buildCustomerFilter`가 `getColumnFields()`를 제너릭 루프로 돈다(`SPECIAL_FIELDS`에 name 없음) |
| 빈 필터는 코드에서 **전체 대상**으로 읽혔다 | `routes/ai.ts:431` 주석 `// 빈 필터({})도 정상 카운트 (AI가 전체 대상을 의도한 경우 포함)` |
| 같은 부류가 이미 한 번 잡힌 적 있다 | `crm-agency-proposal.ts:125` — "빈 필터({}) = 변환 실패 취급"이 Codex 적대 리뷰로 들어가 있다. 오퍼레이터 경로만 그 규칙이 없었다 |

---

## §2 불변 원칙 (⛔)

1. **`'ai'`를 오퍼레이터 발송에 재사용하지 마라.** 그 값은 `campaign_runs`를 갖는 타겟 조건 캠페인의 값이고, 결과 동기화·환불이 그 runs를 순회하는 분기가 처리한다. 오퍼레이터 발송은 runs가 없어 그 분기에 안 걸리고, 2번 분기를 `'ai'`까지 넓히면 기존 AI 캠페인이 **양쪽에서 처리돼 이중 환불**이 된다.
2. **출처 축을 늘리면 그 축을 읽는 곳을 같이 늘려라.** `send_type='direct'`를 **동작 조건**으로 쓰던 3곳(결과 동기화+실패 환불 1 · 청구 집계 2)을 같이 안 고치면 그 발송은 **결과도 환불도 청구도 안 되는 유령**이 된다. 집합은 `DIRECT_PIPELINE_SEND_TYPES` 하나가 소유한다.
3. **"화면 필터가 아는 값"과 "이 배관이 만들어도 되는 값"은 다른 물음이다.** 같은 함수로 답하지 마라 — `isSendTypeFilter`(필터) ≠ `isDirectPipelineSendType`(출처 게이트).
4. **빈 조건은 전원이 아니라 거절이다.** "못 만들었다"와 "전체를 의도했다"는 같은 신호로 표현될 수 없다. 전체 발송이 정말 필요하면 `dm.ts`처럼 **명시 플래그**를 받아라.
5. **빈 조건 판정은 키 개수가 아니라 만들어진 WHERE로 한다.** `{grade: null}`처럼 키는 있고 조건은 없는 형태가 키 개수 판정을 통과한다.
6. **자유 입력 필드의 값 목록을 AI 프롬프트에 싣지 마라.** `FREE_TEXT_FIELDS`(name·address·email) — 값 수집과 값 출력이 **같은 목록을 본다**. 한쪽만 늘면 그 필드 값이 조용히 프롬프트로 샌다.
7. **청구 축의 `send_phase` 두 조건은 서로의 여집합이어야 한다.** 어디에도 안 걸리는 phase가 생기면 그 발송은 청구에서 사라진다. `<> 'sent'`는 NULL을 빠뜨린다 — 반드시 `IS DISTINCT FROM`.

---

## §3 구조

| 것 | 소유 |
|---|---|
| `send_type` 값 집합·라벨·직접배관 집합 | `utils/send-type-axis.ts` (`SEND_TYPES` · `DIRECT_PIPELINE_SEND_TYPES` · `isDirectPipelineSendType`) |
| 청구 축 `send_phase` 진리표 | `utils/billing-send-phase.ts` (+ `billing-send-phase.test.ts`가 성질 고정) |
| 화면 라벨·필터 목록 | `frontend/src/utils/campaign-axis.ts` — 백엔드 `SEND_TYPES`와 **값 집합이 같아야 한다**(`brand-axis-invariants.test.ts`가 강제) |
| AI에게 주는 필터 필드 목록 | `services/ai.ts` `detectActiveFields` + `buildFilterFieldsPrompt` (+ `FREE_TEXT_FIELDS`) |

**`send_type` 읽는 곳(동작 조건)** — `campaign-lifecycle.ts`(결과 동기화 + 실패 환불) · `send-usage-aggregation.ts` 2곳(청구 집계). 세 곳 모두 CT 집합을 부른다.

⛔ **`mysql-refund-sweeper.ts`의 `send_phase == null || === 'sent'`는 같은 모양이지만 의도가 반대다** — 적재 중 캠페인을 일부러 빼는 안전장치다(넓히면 아직 나갈 건을 환불한다). 청구는 빠뜨리면 손해라 넓히고, 환불은 넓히면 손해라 좁힌다.

---

## §4 이력

### 4-1. 출처 축 — `send_type = 'operator'` 신설

**접수** — "AI 오퍼레이터로 보낸건데 왜 직접발송으로 되어있을까?"

**진단** — Harold 실행 SQL로 `send_type='direct'` 실적재 확인. 화면은 저장값을 정직하게 보여준 것이고 잘못은 적재. 행에 `ai_mode=f`·`user_prompt` 없음 → 오퍼레이터 흔적 0.

**조치** — 리터럴을 파라미터로(`campaigns.ts` `$22`, `direct-send-spec.ts` `$19` — **번호는 뒤에 덧붙였다**. 중간에 끼우면 뒤 파라미터가 전부 밀려 컬럼이 어긋난다). 화면이 `sendType`·`campaignName`을 싣는다. 안 밝히면 `'direct'`라 기존 동작 무변경.

**같은 뿌리 3곳** — `createDirectSendCampaign`이 쓰는 INSERT도 같은 리터럴이라 **자동마케팅·마케팅 플래너·모바일 DM 발송도 전부 `'direct'`로 적재**되고 있었다. 구조(파라미터화)는 열었고 **값은 그대로 뒀다** — 각각 환불·청구 집합에 넣을지 판단이 필요해 별건이다.

**소급 없음** — 이미 `'direct'`로 쌓인 것 중 무엇이 오퍼레이터발이었는지 가릴 근거가 행에 없다. 값을 바꾸면 과거분 환불·청구 집합이 함께 움직인다.

### 4-2. Codex 적대 검토 2라운드

- **1R `needs-attention` high 2건** — ①`/direct-send`가 다른 파이프라인 값(`ai`·`auto`·`journey`)까지 신뢰 → 청구에서 사라질 수 있음 ②`completed` + `send_phase` `preparing`/`queued`가 청구 대상에서 누락
- **조치** — ①은 게이트 함수 분리(§2-3) ②는 `billing-send-phase.ts` CT 신설 + `IS DISTINCT FROM`. Codex 권고 중 "거절하라"는 **불수용** — 400은 옛 클라이언트의 발송을 멎게 한다. 강등 + `console.warn`으로 갔다.
- **2R `approve` · no material findings** — 4개 질문 전량 통과. 라운드 상한 2회 종결.

### 4-3. 타겟 축 — 고객명 필터 개방 + 빈 조건 차단

**접수** — "유호윤 고객에게만 30% 할인안내 문자 보낼거야" → AI가 *"사용 가능한 필터 필드에 고객명 항목이 없어 이름 기반 필터링이 불가능합니다"*라고 정확히 답해 놓고 **전체 6명이 대상으로 잡혔다.** 할인 문자가 나머지 5명에게 나갈 뻔했다.

**왜 이름이 막혀 있었나** — `detectActiveFields`가 문자열 필드마다 `SELECT DISTINCT ... LIMIT 200`을 돌려 **실제 값을 프롬프트에 박는다.** `name`을 그냥 풀면 고객 이름 200개가 프롬프트로 나간다. 그래서 뺀 것이지 빠뜨린 게 아니었다(주석이 없어 실수처럼 보였다).

**조치** — 필드는 열고 값은 안 싣는다(`FREE_TEXT_FIELDS`). 프롬프트 생성기엔 그 분기가 이미 있었으나 필드가 도달을 못 해 죽어 있었다. `phone`·`sms_opt_in`은 계속 차단 — 번호 타겟팅은 직접발송 몫이고, 수신동의는 타겟 축이 아니라 안전필터가 강제하는 값이다.

**빈 조건 차단** — `preview-recipients`(발송)·`target-recipients`(목록) 두 곳에서 WHERE가 비면 400 `TARGET_FILTER_EMPTY`. **화면과 발송을 같은 판정으로 묶었다** — 목록엔 6명이 보이는데 발송만 막히면 그게 더 나쁘다. 계약 축(segment)은 자기 SQL이 조건을 소유하므로 제외.

---

## §5 남은 것

- **나머지 3개 호출부의 출처 값** — 자동마케팅(`continuous-operator`) · 마케팅 플래너(2곳) · 모바일 DM. 구조는 열려 있고 값만 `'direct'`다. 값을 정하려면 각각 환불·청구 집합에 넣을지 판단이 필요하다.
- **`getValue` fail-open** — `{operator:'eq'}`처럼 **value 키가 빠진** 엔트리를 만나면 객체 자체를 값으로 돌려줘 `col = $1`에 객체가 실린다(`customer-filter.ts:60`). 안 고친 이유 = 이 CT를 여러 경로가 공유하고, 조건을 그냥 빼면 남은 필터만으로 **대상이 넓어진다**. 고친다면 무효 날짜와 같은 fail-closed(`AND FALSE`)여야 한다. 좌표는 `customer-filter.name-axis.test.ts` 주석이 보존.
- **실측** — 배포 후 같은 문장으로 1명이 잡히는지, 조건 불가 문장에서 거절이 뜨는지.

---

## §6 뒤집힌 판단

| 처음 생각 | 실제 | 왜 |
|---|---|---|
| 화면 라벨만 고치면 된다 | 적재 축을 고쳤다 | 라벨만 고치면 데이터는 계속 거짓말한다. 정산·분석·관리자 통계도 같이 틀린다 |
| `send_type='ai'`로 적재한다 | `'operator'` 신설 | `'ai'`는 runs 보유 캠페인의 값 — 겹치면 이중 환불(§2-1) |
| 이름 필터가 빠진 건 실수다 | PII 가드였다 | 값 목록을 프롬프트에 박는 구조라 이름 200개가 나갈 자리였다. 필드만 열고 값은 막는 게 답 |
| 빈 필터를 거절하면 끝 | 판정을 WHERE로 바꿨다 | 키 개수로 세면 `{grade: null}`이 통과한다 |
