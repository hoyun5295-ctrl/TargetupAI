# C105 · 1105 범위 밖 다섯 처방 설계서

> 카드 C105 · 2026-11-05 · Harold 지시 「범위밖 전부 설계서작성하고 구조체크-코덱스리뷰-구현-코덱스리뷰 진행」
> 출처 = C104 설계서 `docs/2026-11-05-c104-same-fact-same-input-design.md` §11 범위 밖 다섯 줄.
> 결함 플레이북 순서 그대로(흐름 표 → 결함 장부 → 처방 → 계약 시험 → 구조체크 → Codex → 구현 → Codex → 배포 → 직원 시트).

## §0 진행 표

| 단계 | 상태 |
|---|---|
| 현황 파악(코드 · 접수 원문) | 끝(1105) |
| 흐름 표 · 결함 장부 · 설계 | 이 문서 §2 ~ §7 |
| 설계 구조체크 | 1차 끝(1105 · SC-H1-1 ~ SC-H5-2 · 정정 3 = H1 화면 글 · H2 숫자 판정 자리 · H4 새 상한 0) |
| Codex 설계 | 1R 3 · 2R 2 · 3R 2 · 4R 1 · 5R 1 · 6R 1 · 7R 2 · 8R 1(같은 부류 · 뿌리 = 구조 정정) 수용 · 9R approve(1105) |
| 구현 · 시험 | 끝(1105 · H1 ~ H5 · tsc 0 · 0 · vitest 761 / 11,599 · 실 PG 58 / 414(c105-out-of-scope-1105.pg 7) · 계약 c105-contract-1105 23 · 변이 8 / 8 · 옛 시험 5 파일 · 소비처 1(ai-segment-generator) 정정) |
| 문서 | 뿌리 대장 R59 · 배포 원장 C105 · C105-S0 · C105-S1 · 직원 시트 33 ~ 37 |
| Codex 구현 | 1R 지적 3 수용 · 2R approve(1105 · §9-2) |
| 배포 | 미커밋 · C104 · C106 · 브랜드메세지 세션과 한 배포(Harold 1105) · 배포 전 C105-S0 · 배포 뒤 C105-S1 |

## §1 다섯 건 · 접수 · 결정

| ID | 건 | 출처 | 성격 | 결정 |
|---|---|---|---|---|
| H1 | AI한줄로 혜택 기간을 「11/1 ~ 30」처럼 기간으로 못 적음 | 1105 접수(서수란) · 화면 「문안에 넣을 내용을 확인할게요」 | 새 기능 | 시작일(선택) + 마감일 · 두 입력 화면 공용 |
| H2 | 여정에서도 「개별회신번호」로 보내기 | 1105 재오픈(임은지) · Harold 댓글 | 같은 사실 두 벌(R1) | **B안 = 직접발송 개별회신번호와 같은 규칙 CT 하나**(1105 질의 추천 B · Harold 「범위밖 전부 진행」) |
| H3 | 재진입 허용 · 쿨다운 0 = 대상 뽑기가 진행 중 고객을 포함 · 넣기는 뺌 | Codex C104 구현 1R [범위 밖] | 결함(R58 같은 사실 다른 입력) | 뽑기 = 넣기와 같은 판정 |
| H4 | 고객 목록 주소 정수 자리 NaN → 500 | 운영 로그 1105 13:58 · 13:59 | 결함 · 새 뿌리 R59 | 주소 숫자 값 = CT 한 곳 · 전 주소 |
| H5 | A/B 칸 「지금 스팸 검사」 = 첫 판만 | C103 기록 | 결함(R5 본 것 ≠ 나가는 것) | 판마다 검사 단추 |

## §2 흐름 표(소스에서 뽑은 이음매 · 값 범위 · 그리는 화면)

### 2-1 H1 혜택 기간

| 이음매 | 자리 | 지금 값 범위 | 그리는 화면 |
|---|---|---|---|
| 입력 A (AI한줄로 문자) | `frontend/src/components/ai-line/LineIntakeModal.tsx:503-527` 칩 · `<input type="date">` 하나 · `periodPick` | 마감일 하나(오늘 이상) | 같은 창 아래 줄 `periodLabel` · 요약 755 「기간 …」 |
| 입력 B (DM · 이메일 · 인앱 한줄 단계) | `frontend/src/components/zone/LineStepsModal.tsx:996-1027` 칩 · date 하나 · `answers.period` | 마감일 하나(오늘 ~ 399일) | 같은 창 · 요약 1177 · 1249 |
| 칩 · 글 CT | `LineIntakeModal.tsx:32-46` · `LineStepsModal.tsx:67-80` `periodChips` · `periodLabel` **두 벌** | 같은 글 | — |
| 몸통 A | `LineIntakeModal.tsx:114` `facts.period_end` | 'YYYY-MM-DD' · null | — |
| 몸통 B | `frontend/src/utils/one-line.ts:537 · 802` `facts.period_end` | 'YYYY-MM-DD' | — |
| 서버 읽기 A | `backend/src/routes/ai-line.ts:59-73` `readFacts` · `isValidLinePeriodEnd` | 오늘−1 ~ +400일 | — |
| 서버 읽기 B | `backend/src/utils/one-line-steps.ts:468-471` | 같은 검사 | — |
| 문자 생성 원문 | `backend/src/services/ai-line.ts:578` `[기간] ~까지` · 원장 키 `aiLineCopyKey(facts)` 561 | 마감일 | AI 문안 |
| DM · 이메일 원문 | `one-line-steps.ts:658-668` `buildLineStepsEventText` ← `routes/dm.ts:1004` · `routes/email.ts:1193` | 마감일 | 생성 글 |
| 템플릿 재료 글 | `utils/line-template-run.ts:64` · `utils/one-line-ct/index.ts:256` `periodLabel` ← `routes/cdp.ts:1627` · `dm.ts:1054` · `email.ts:1225` · `one-line-ct/preview.ts:82` | 「…까지」 | 표지 · 본문 블록(`line-compositions.ts:282 · 288 · 553` · `line-template-compose.ts:154 · 165 · 170 · 180`) |
| 마감 장치 | `line-compositions.ts:389` · `line-template-compose.ts:263` countdown · `dm-ai.ts:778-782` 쿠폰 만료 | 마감일 23:59:59 | 남은 시간 띠 · 쿠폰 |
| 예시 · 영업 · 목록 | `line-template-example.ts:33` · `line-template-outreach.ts:104` · `one-line-ct/catalog.ts:55` | 마감일(사용자 답 아님) | 예시 화면 |

### 2-2 H2 고객별 회신번호

| 이음매 | 자리 | 지금 규칙 | 그리는 화면 |
|---|---|---|---|
| 직접발송 · 자동발송 | `backend/src/utils/callback-filter.ts:56-140` `filterByIndividualCallback` | (고른 칸) → 「회신번호」(callback) → 「매장 전화번호」(store_phone) · 숫자 없는 값 = 없음 · 없으면 제외 · 미등록 = 제외(번호별 수) | 직접발송 확인 창 |
| 여정 실행 | `backend/src/utils/journey-executor.ts:768-771 · 810-813` 인라인 | `callback_mode='store'` 면 store_phone → 여정 보내는 번호 → callback · store_phone 미등록 = 그 고객 실패 | — |
| 여정 켜기 확인 | `utils/journey-target-extractor.ts` `storeCallbackExposure` · `utils/journey-activation.ts:72-90` | store_phone 묶음마다 `isCallbackRegistered` | `JourneyActivationConfirmModal.tsx:520-540` 「미등록 매장번호」 · `JourneyWorkspace.tsx:718-719` · `map/BatchActivateModal.tsx` |
| 여정 스위치 | `frontend/src/components/journey/workspace/JourneyStartCard.tsx:215` 「고객 매장번호로 보내기」 · `pages/JourneysPage.tsx:1869` 옛 검토 화면 | callback_mode store · fixed | 시작 카드 |
| 등록 판정 | `callback-filter.ts:157 · 216` `getRegisteredCallbackSet` · `isCallbackRegistered`(배정 사용자) | 같은 등록 집합 | — |

### 2-3 H3 재진입 쿨다운 0

| 이음매 | 자리 | 판정 |
|---|---|---|
| 대상 뽑기 · 세기 | `backend/src/utils/journey-safety-filter.ts:61-90` `buildReentryAntiJoin`(허용 · 쿨다운 0) | 계보가 없으면 조건 0 · 있으면 **다른 판**의 진행 중만 뺌(지금 여정 진행 중 = 포함) |
| 진입 넣기 | `backend/src/utils/journey-trigger-watcher.ts:851 · 909-912` `reentryGuard` | 허용이면 계보(지금 여정 포함) 진행 중을 뺌 |
| 영향 | 같은 회차 `entryCapExceeded(cap, backfill, ids.length)`(watcher 389-) · 시작 카드 · 미리 보기 · 대상 목록 수 | 진행 중 고객까지 세어 「한 번에 최대」를 넘었다고 여정이 멈출 수 있음 · 인원이 넘침 |

### 2-4 H4 주소 숫자 값(기계 추출 · `scratchpad/c105_query_num_sites.py`)

- 추출 v4(키 이름 목록 없음 · 값 흐름 두 층 · Codex 설계 2R · 3R · `scratchpad/c105_query_num_sites4.py` · 부록 A):
  - 층 1 처리기(`router.<동사>(` ~ 다음 머리): 주소 값에서 온 이름(`req.query.X` · `req.query?.X` · `req.query['X']` · 구조 분해 · 별칭)이 ① `Number(` · `parseInt(` · `parseFloat(` · `Number.parseInt(` 로 숫자가 되는 줄 ② 곱 · 나눔 · 나머지 · 숫자 빼기 · 날짜 글 조립(`${x}-`)에 쓰이는 줄 = 131 줄(`ai.ts:4519` `req.query?.limit` · `campaigns.ts:158` 날짜 조립 포함).
  - 층 2 도우미: routes 에서 인자에 주소 값(통째 · 속성)을 넘기는 호출의 함수(backend/src 정의)마다 그 함수 매개변수를 주소 값 이름으로 보고 같은 ① ② = 2 줄(`utils/intro-leads.ts:71` `parseIntroLeadsQuery` · `utils/precheck-usage.ts:42` `parsePrecheckUsageQuery` = page 상한 없음 · 1e20 → OFFSET bigint 초과). 도우미 8개 중 나머지 6 = 숫자 바꿈 0(`parseFeatureInterestQuery` · `parsePrecheckDetailQuery` · `parseSplitSetting`(파생 값을 자기 범위로 검사) · `parseFitOption` · `parsePlanMonth` · `readInicisCallbackToken`).
- 이미 CT 를 쓰는 자리(`balance.ts` · `manage-scheduled.ts` · `results.ts` 두 곳 · `campaigns.ts:3336`)는 값을 바로 CT 에 넘겨 ①②에 안 잡힌다(맞는 동작). 다른 검사 함수로 넘기는 자리 = `campaigns.ts:1465` `parseSplitSetting`(그 함수가 검사 · 허용 목록). 추출 v1 · v2 는 꼴 · 키 목록에 묶여 `companies.ts:1487`(Codex 1R) · `campaigns.ts:158-166`(Codex 2R)을 놓쳤다.
- 이미 CT(`utils/normalize.ts:973` `parsePageParams` · 984 `parseOffsetParam`)를 쓰는 곳 = `balance.ts` · `manage-scheduled.ts` · `results.ts` 두 곳 · `campaigns.ts:3336`(5 자리 · 손으로 올린 것만 보호).
- 값 범위별 결과(실측 = 운영 로그 13:58 · 13:59 · 코드 읽기):
  - `Number('abc')` = NaN → `LIMIT NaN` · `OFFSET NaN` = SQL 오류 500(`customers.ts:71-72 · 192` · `campaigns.ts:124-125` · `companies.ts:1725-1726` · `admin.ts:5194-5195 · 5818-5819` · `unsubscribes.ts:203` · `admin/login-blocks.ts:44-45` 등 구조 분해 · `|| 기본` 없는 자리).
  - `parseInt('-5') || 1` = −5 → `OFFSET` 음수 = SQL 오류 500(`|| 기본` 만 있는 자리 전부).
  - 상한 없는 `limit` = 큰 값 그대로(한 번에 다 읽기).

### 2-5 H5 A/B 칸 지금 스팸 검사

| 이음매 | 자리 | 지금 |
|---|---|---|
| 서버 | `routes/ai.ts:4430-4460` · `journey-pretest-validator.ts:373-396` `journeyStepSpamParams(…, variantId)` | 판 id 를 받으면 그 판 · 없으면 첫 판 |
| 창 | `frontend/src/components/SpamFilterTestModal.tsx:88-89` `journeyStep.variantId` | 판 id 를 넘길 수 있음 |
| 작업 화면 | `JourneyWorkspace.tsx:224` `spamFor { stepId, channel }` · 1377 `journeyStep={{ journeyId, stepId }}` | 판 id 를 안 넘김 = 늘 첫 판 |
| 점검 판 단추 | `workspace/JourneyCheckPanel.tsx:62-68` 「지금 스팸 검사」 하나 | 판 고르기 0 |
| 단추 막기 | `JourneyWorkspace.tsx:1253` `!selStudio.messageTemplate.trim()` | 칸 글로 판정(R58 · A/B 칸은 판 글이 나간다) |
| 판 이름 | 상세 `ab_variants` = `{ variant_id, message_template, subject }`(행 id 없음 · `journey-builder.ts` getJourneyDetail) · 점검 항목 `variantId` = 행 id | 점검 줄 「(A/B 판)」 = 어느 판인지 모름 |

## §3 결함 장부

| ID | 결함 | 뿌리 |
|---|---|---|
| H1-1 | 기간 입력이 마감일 하나뿐 · 「11/1 ~ 30」을 못 담음 | 기능 없음 |
| H1-2 | 칩 · 기간 글 함수가 두 창에 두 벌 | R1 |
| H1-3 | 「…까지」 글 조립이 7 자리(`formatLinePeriodEnd(…)까지`) | R1 |
| H2-1 | 고객별 회신번호 규칙 두 벌(직접발송 = 회신번호 → 매장 · 여정 = 매장 → 여정 번호 → 회신번호) | R1 |
| H2-2 | 여정 화면 이름 「고객 매장번호」 ≠ 직원이 아는 「개별회신번호」 | R56 |
| H3-1 | 뽑기 · 세기와 넣기가 진행 중 고객을 다르게 판정 | R58 |
| H4-1 | 주소 숫자 값 104 자리가 CT 를 안 지남 · NaN · 음수 · 상한 없음 | **새 R59** |
| H5-1 | A/B 칸 검사 = 첫 판만 · 점검 줄에 판 이름 없음 | R5 |
| H5-2 | 검사 단추 막기가 칸 글로 판정 | R58 |

## §4 처방

### H1 혜택 기간 = 시작일(선택) + 마감일
- 값: `facts.period_start`(선택 · 'YYYY-MM-DD') · `facts.period_end`(그대로). 시작일은 마감일이 있을 때만 · 시작일 ≤ 마감일 · 시작일은 오늘 −365일 ~ 마감일(이미 시작한 행사 = 11/1 시작 · 오늘 11/5 허용).
- 서버 검사 CT `one-line-steps.ts` `readLinePeriod(startRaw, endRaw, nowMs)` = `{ start, end } | 'invalid'`(마감 검사 = 지금 `isValidLinePeriodEnd` 그대로 · 시작 검사 추가) · `routes/ai-line.ts` `readFacts` · `readLineStepsBody` 둘 다 부른다.
- 글 CT `one-line-steps.ts` `linePeriodLabel(start, end)` = 시작일 있으면 「2026년 11월 1일(일) ~ 11월 30일(월)」(같은 해면 둘째 해 생략 · 다른 해면 둘 다) · 없으면 지금 그대로 「…까지」. 7 자리(`services/ai-line.ts:578` · `buildLineStepsEventText` · `line-template-run.ts:64` · `one-line-ct/index.ts:256` · 예시 · 영업 · 목록)가 이 함수만 부른다(예시 · 영업 · 목록 = 시작 null).
- 원문 줄: 시작일 있으면 `[기간] 2026년 11월 1일(일) ~ 11월 30일(월)` · 없으면 그대로(지금 원장 키 · 지문 무변 = `period_start` 는 값이 있을 때만 facts 에 싣는다).
- 재료 입력(`LineCookInput` · `LineTemplateRunInput`)에 `periodStart` · 주소 넷(cdp · dm · email · 미리보기)이 facts 의 시작일을 넘긴다. 마감 장치(남은 시간 · 쿠폰 만료) = 마감일 그대로.
- 화면 CT `frontend/src/utils/line-period.ts`: `periodChips` · `periodLabel(end, start?)` = 두 창의 옛 두 벌을 한 벌로(올해가 아니면 연도 · 시작일 있으면 「11월 1일(일) ~ 11월 30일(월)」 · 없으면 「11월 30일(월)까지」 · 화면 짧은 꼴 = 서버 문안 글(연도 포함 긴 꼴)과 일부러 다름 · SC-H1-3) · 공용 입력 `components/ai-line/LinePeriodPick.tsx`(칩 = 마감 · 「기간으로 고르기」 = 시작일 · 마감일 두 칸 · 「기간 없이」) — 두 창이 같은 부품. 칩은 지금 그대로 마감만(시작 없음). 시작일 칸 = 오늘 −365일부터 · 마감일 칸 = max(오늘, 시작일)부터 오늘 +399일까지(서버 마감 검사 = 오늘 −1일부터라 화면이 그보다 좁다 · Codex 설계 1R) · 공용 입력의 「다음」 판정도 같은 범위(마감 < max(오늘, 시작일) = 다음 막힘 · 시작 > 마감 = 막힘).
- 몸통: 두 창 · `one-line.ts` 두 몸통이 시작일이 있을 때만 `period_start` 를 싣는다. 다시 열기(`LineIntakeModal.tsx:330`)는 `period_start` 도 되살린다.

### H2 여정 개별회신번호 = 직접발송과 같은 규칙 CT
- CT `callback-filter.ts` `individualCallbackOf(row, callbackColumn?)`(순수) = `filterByIndividualCallback` 1단계를 글자 그대로 옮긴 것(고른 칸 · custom_ 칸 → 비면 매장 전화번호 · 고른 칸 없음 → 회신번호 → 비면(공백뿐 포함) 매장 전화번호). 「숫자 없는 값 = 없음」 판정은 1단계가 아니라 부르는 쪽(직접발송 = 2단계 제외 · 여정 = 여정 번호로)이 `normalizePhone` 으로 한다(지금 직접발송 순서 그대로 · 예: 회신번호 「없음」 = 매장 전화번호로 넘어가지 않음). `filterByIndividualCallback` 이 이 함수를 부른다(직접발송 동작 불변 · 동작 캡처 시험).
- 여정 실행기: `callback_mode='store'` 의 고객 번호 = `individualCallbackOf(customer)` 에서 숫자가 있는 값(`normalizePhone` 비지 않음) · 그 번호 등록 판정 = 지금 `isCallbackRegistered(회사, 번호, 여정 만든 계정)` · 미등록 = 그 고객 실패(지금 그대로) · 개별 번호가 없으면 여정 보내는 번호 → 그것도 없으면 멈춤(지금 그대로 · 옛 마지막 「고객 회신번호」 단계는 개별 번호가 이미 회신번호를 먼저 보므로 store 모드에서 사라진다). 고정 모드 = 지금 그대로(여정 번호 → 고객 회신번호).
- 켜기 확인 `storeCallbackExposure`: 대상 전원의 (회신번호 · 매장 전화번호) 묶음을 세고 같은 CT 로 개별 번호를 정해 미등록 수를 센다(SQL 식 복제 0).
- 이름: 시작 카드 스위치 「개별회신번호로 보내기」 · 설명 「고객마다 고객 DB의 회신번호로 보내요. 회신번호가 없으면 매장 전화번호, 둘 다 없으면 위 번호로 보내요. 발신번호로 등록되지 않은 번호의 고객은 보내지 않아요.」 · 켜기 확인 창 · 작업 화면 알림 · 서버 문구 「미등록 개별회신번호」 · 옛 검토 화면(`JourneysPage.tsx:1869`) 같은 이름. DB 값 `callback_mode='store'` 는 그대로(DDL 0).
- 고른 칸(직접발송 드롭다운)은 여정에 두지 않는다 = 기본 규칙(고른 칸 없음)과 같다. 칸 고르기가 필요한 회사는 C105 밖 기록.
- **동작 변화**(Codex 설계 1R 수용 · 옛 규칙 ↔ 새 규칙 결과 표): 옛 = 매장 전화번호(공백 아님) → 여정 번호 → 고객 회신번호 · 매장 번호 미등록 = 실패. 새 = 개별 번호(회신번호 → 비면 매장) 숫자 있음 → 등록이면 그 번호 · 미등록이면 실패 · 숫자 없음 → 여정 번호 → 없으면 멈춤.

| 고객 칸 | 옛 결과 | 새 결과 |
|---|---|---|
| 매장만(등록) | 매장 번호 발송 | 같음 |
| 매장만(미등록) | 실패 | 같음 |
| 회신번호만(등록) | 여정 번호 발송 | **회신번호로 발송**(번호 바뀜) |
| 회신번호만(미등록) | 여정 번호 발송 | **실패**(발송 → 실패) |
| 둘 다 · 다름 | 매장 번호 기준 | **회신번호 기준**(번호 · 결과 바뀔 수 있음) |
| 매장 = 숫자 없는 값(예 「없음」) · 회신번호 없음 | 실패 | **여정 번호 발송**(실패 → 발송) |
| 회신번호 = 숫자 없는 값 · 매장 있음 | 매장 번호 기준 | **여정 번호 발송**(직접발송 1단계 그대로 = 매장으로 안 넘어감) |
| 둘 다 없음 | 여정 번호 → 회신번호 → 멈춤 | 여정 번호 → 멈춤 |

- 배포 전 실측 C105-S0 = 읽기 전용 스크립트 `packages/backend/scripts/c105-s0-individual-callback-diff.ts`(`npx ts-node` · 선례 = `purge-rendered-training-rows.ts`): store 모드 켜진 · 멈춘 여정마다 **그 회사 고객 전원**(`customers.company_id` 일치만 · 범위 · 동의 · 상태 조건 0 = 실행기가 회사 · 고객 id 로만 고객을 읽으므로 이것이 참 상한 · 담당 범위가 바뀐 진행 중 고객 · 날짜축 · 사건형 어느 경로든 이 집합 안 · Codex 설계 2R · 3R) + 그중 그 여정 진행 중 실행 고객(부분 수)을 읽어 옛 규칙(스크립트 안 옛 식 사본 · 세 줄 · 이유 = 지운 코드의 사진) · 새 규칙(`individualCallbackOf` CT)의 최종 번호와 결과(발송 · 실패 · 멈춤)를 같은 등록 판정(`getRegisteredCallbackSet(회사, 여정 만든 계정)` = 실행기 `isCallbackRegistered` 와 같은 집합)으로 비교해 여정마다 「바뀜 없음 · 번호만 바뀜 · 발송 → 실패 · 실패 → 발송 · 멈춤 바뀜」 수만 낸다(번호 · 개인정보 출력 0). 순서 = pull 뒤 · build 전 · 결과를 Harold 확인 뒤 build · reload.

### H3 재진입 쿨다운 0 = 넣기와 같은 판정
- `buildReentryAntiJoin` 허용 · 쿨다운 0 갈래 = 계보(없으면 지금 여정 하나 · 지금 여정 포함)의 진행 중(`status='active'`)을 뺀다 = 넣기 `reentryGuard` 와 같은 집합. 옛 「계보 없으면 조건 0 · 다른 판만」 삭제.
- 시험: 옛 기대(`buildReentryAntiJoin('c', [], 'J', true, 0, ['J']) === ''`)를 새 판정으로 고친다(이유 = 넣기와 같은 집합).

### H4 외부 숫자 값 → SQL = 양쪽 CT(R59 신설)
- **구조(Codex 설계 4R · 같은 부류 네 번째 · 왜 = 입력이 흐르는 길을 소스 쪽에서 한 층씩 쫓으면 JSON · 객체 · 도우미 재전달 길이 끝없이 새로 나온다)**: 두 쪽에서 닫는다.
  - (A) 받는 경계: 주소 숫자 값(추출 v4 · 133 줄 + 날짜 조립) = 처음 숫자로 바뀌는 자리에서 CT(아래).
  - (B) SQL 직전: SQL 매개변수 배열(`params` · `*Params` 로 끝나는 이름)에 `Number(` · `parseInt(` · `parseFloat(` 로 바로 넣는 자리 = 새 CT `sqlNumberParam(v, label)` 하나(`utils/normalize.ts`). **원칙 = 넘기는 값은 자리마다 옛 값 그대로 · 거절은 그 자리 옛 값이 「대상을 넓히거나 PG 가 못 읽는」 경우만 더한다 · 거절 기준은 그 자리 진실(옛 `Number()` 자리 = JS 숫자 · 옛 원값 자리 = PG 판독)**(Codex 설계 6R · 7R · 8R · 같은 뿌리 세 번 = 넘기는 값 · 거절 기준을 자리의 옛 진실과 다른 잣대로 새로 정했다). CT 두 함수(`utils/normalize.ts`):
    - `sqlNumberParam(v, label)` = 옛 `Number(v)` 자리용 · `Number(v)` 가 유한수가 아니면 `UserFacingError(400, 'INVALID_NUMBER_INPUT', '숫자로 넣어야 하는 값이 숫자가 아니에요.')` · 넘기는 값 = `Number(v)`(옛 값 그대로 · 정수 나이 비교 `'30.0'` → 30 · 빈 값 0 · null 0 · 참거짓 그대로).
    - `sqlNumericRawParam(v, label)` = 옛 원값 자리용(`customer-filter.ts:630-631 · 639-640` mixed 사용자 칸 numeric 비교) · 넘기는 값 = **v 그대로** · **거절 = PG numeric 이 유한수가 아닌 값으로 읽는 특수 글자만**(앞뒤 공백 · 대소문자 무관 `NaN` · `Infinity` · `inf` · 부호 붙은 꼴 = 정규식 `^\s*[+-]?(nan|inf|infinity)\s*$` · 대상이 넓어지는 유일한 꼴 · Codex 설계 5R) · 그 밖 판독은 옛날처럼 PG(`'1e 3'` · `'…e0'` · `'1e-400'` · 2^53 넘는 값 = 옛 결과 그대로 · `'abc'` = 옛날처럼 PG 오류 · 대상 넓어짐 0 · Codex 설계 8R). 기계 추출 = 백엔드 9 파일 · SQL 매개변수 자리 28 줄(`utils/customer-filter.ts` 19 · `routes/customers.ts` 5 · `admin.ts:5865` · `campaigns.ts:180` · `companies.ts:1749` · 그 밖 `ids.push` · `exitSlots.push` · 글 `lines.push` · `out.push` 4 줄 = SQL 아님). 고객 필터 JSON(`customers.ts:71 · 127-130` → `buildDynamicFilterCompat` → `buildCustomerFilter` `customer-filter.ts:284-298` 등)처럼 어디서 온 값이든 SQL 앞에서 걸린다 = 조건을 빼서 대상을 넓히지 않는다(멈춤 · Codex 4R 권고).
  - (B') 고객 필터 CT 안 숫자 비교 = 꼴이 아니라 뜻으로(Codex 설계 5R · 같은 부류 다섯 번째 · 왜 = (B)를 「Number( 호출」 꼴로 정해 원값을 그대로 넣는 숫자 비교 `customer-filter.ts:630-631 · 639-640` 을 놓쳤다): `customer-filter.ts` 의 숫자식(`ageExpr` · `ageExprMixed` · `customNumberExpr(…)` · FIELD_MAP 숫자 칸 갈래의 열 = 새 이름 `numberRef`)에 붙는 비교(`=` · `>=` · `<=` · `BETWEEN`)의 값은 모두 내부 함수 둘 중 하나로 넣는다 = 옛 `Number(` 자리 `bindNumber(params, v)`(= `sqlNumberParam`) · 옛 원값 자리 `bindNumericRaw(params, v)`(= `sqlNumericRawParam`) · 숫자식 비교 뒤 맨 원값 push · `Number(` push 0.
  - 같은 뿌리의 라우트 쪽 변수 꼴 = `routes/customers.ts:971-976 · 1062-1067`(ageRange 를 parseInt 한 변수로 push · Codex 5R [범위 밖] 표시) = 같은 배포에 `sqlNumberParam` 으로(같은 파일 · 같은 뿌리 · root_ledger).
  - **성공 → 멈춤 전이(일부러)**: 지금 `between [0, 'abc']` 같은 숫자 아닌 상한은 `numeric` 비교에서 NaN 으로 바뀌어 0 이상 전부와 맞는다(대상이 넓어진 채 성공 · PG numeric 은 NaN 을 가장 큰 값으로 본다). 새 CT = 멈춤(400 · 자동발송은 `auto-campaign-worker.ts:1206-1272` 대로 실패 기록 → 다음 일정 → 7일 실패 5건이면 일시중지). 넓어진 대상으로 보내는 것보다 멈추는 것이 맞다(발송 · 돈). 여정 고객 조건(`journey-target-extractor` `applyCustomerConditions`)은 이 파일이 아니라 바뀌지 않는다.
  - `Number('')` = 0 · `Number(null)` = 0 은 지금 그대로(필터 빈 값의 옛 뜻 · 바꾸면 대상이 달라짐 · 범위 밖 §10).
  - 400 으로 돌려주는 자리 = `userErrorResponse` 를 쓰는 라우트(기존) + 이번 `customers.ts` 목록 · 내보내기 처리기 catch. 그 밖 라우트의 catch 는 지금처럼 500 이지만 NaN 이 PG 에 닿지 않고(오류 종류 = 사용자 조건) 원문 로그에 `INVALID_NUMBER_INPUT` 이 남는다.
- CT `utils/normalize.ts`: `parsePageParams` + 선택 `pageBase: 0 | 1`(기본 1 · 0 기반 주소 = page ≥ 0 · offset = page × limit · 응답 page = 받은 기준 그대로 · Codex 설계 1R) · `parseOffsetParam`(그대로) · 새 `parseQueryInt(v, { fallback, min, max })`(숫자 아님 · 범위 밖 = fallback · 소수 = 내림 · fallback 에 null 허용 = 「없으면 안 넘김」 자리).
- 0 기반 자리(기계 추출 · `page * limit` · `Math.max(0, … page …)`) = `routes/companies.ts:1487 · 1651`(대시보드 카드 상세) · `routes/alimtalk.ts:618`(IMC 조회 · 외부 API 0 기반) → `pageBase: 0`.
- 추출 v4 의 133 줄 전부(부록 A · 도우미 두 곳 포함): page · limit = `parsePageParams(…, { defaultLimit: 그 자리 옛 기본, maxLimit: 그 자리 옛 상한 · 상한 없던 자리 = `QUERY_LIMIT_NO_CAP`(100,000 · 옛 동작 그대로 · 터무니없는 값만 막음) })` · offset = `parseOffsetParam` · 그 밖 숫자 값(days · months · hours · count · size · total · year · month · minAge · maxAge) = `parseQueryInt(그 자리 옛 기본 · 옛 범위)` · 날짜 글 조립(`campaigns.ts:158`)은 CT 를 지난 값으로만 조립(year 1970 ~ 2100 · month 1 ~ 12 · 아니면 그 조건을 걸지 않는 옛 「값 없음」 갈래). 응답 `pagination` 칸도 CT 값.
- CT 보강: `parsePageParams` 의 page 상한 1,000,000(offset = (page − 1) × limit 이 PG bigint 를 넘지 않게 · 지금 쓰는 5 자리 정상 입력 불변).
- 옛 동작 보존: 정상 입력의 기본 · 상한은 자리마다 옛 값 그대로(새 상한을 걸지 않는다 = 쓰는 화면이 큰 limit 을 보내도 그대로 · 상한 설계는 범위 밖 §10). 숫자 아님 · 음수 · 0 · 소수 = 옛 기본(옛: 500 또는 음수 OFFSET 500).

### H5 A/B 칸 검사 = 판마다
- 상세 `ab_variants` 에 행 `id` 를 싣는다(`getJourneyDetail`).
- 점검 판: 고른 칸이 A/B 칸이면 「지금 스팸 검사」 대신 판마다 「A안 검사」 · 「B안 검사」(그 판 id 로 창) · 아니면 지금 그대로. 점검 줄 「(A/B 판)」 → 「(A안)」(행 id → variant_id).
- 막기 판정 = `abSendCopies`(C104 화면 나갈 글) 로 그 판 글이 비었는지.

## §5 계약 · 시험

| ID | 계약(소스에서 기계로 뽑음) |
|---|---|
| K1 H1 | 백엔드에서 `formatLinePeriodEnd(` 뒤 「까지」 조립 = `linePeriodLabel` 안에만 · 화면 `periodLabel` · `periodChips` 정의 = `utils/line-period.ts` 한 곳 · 두 창이 `LinePeriodPick` 을 쓴다 · 화면 글 · 서버 글 각각 손으로 쓴 기대 글 |
| K2 H1 | facts 를 읽는 두 서버 자리가 `readLinePeriod` 를 부른다 · 재료를 만드는 네 주소가 `periodStart` 를 넘긴다 |
| K3 H2 | 고객별 회신번호를 정하는 자리(store_phone · callback 을 회신번호로 고르는 식) = `individualCallbackOf` 밖 0(`callback-filter.ts` · `journey-executor.ts` · `journey-target-extractor.ts` 추출) · 화면 「매장번호」 문구 0(여정 화면 · 서버 켜기 문구) |
| K4 H3 | 허용 · 쿨다운 0 뽑기 조각의 여정 집합 = 넣기 가드와 같은 집합(지금 여정 포함) |
| K5d H4 R59 | 옛 값 그대로(손으로 쓴 기대값): `sqlNumberParam` = `'30.0'` → 30 · `'+30'` → 30 · `''` → 0 · null → 0 · `true` → 1 · `'abc'` · `'NaN'` · `'Infinity'` · undefined → 400 · `sqlNumericRawParam` = `'9007199254740993'` · `'9007199254740993e0'` · `'1e-400'` · `'1e 3'` · `'abc'` → 같은 글자(PG 가 판단) · `'NaN'` · `' nan '` · `'Infinity'` · `'-inf'` · `'+Infinity'` → 400 · 실 PG = ① mixed 사용자 칸 `gte '9007199254740993'` · `gte '9007199254740993e0'` · `gte '1e-400'` · `gte '1e 3'` 대상 집합 = 옛 원값 바인딩과 같음(저장값 `'9007199254740992'` · `'0'` · `'999'` 고객 제외 · `'1000'` 포함) · `lte 'NaN'` = 400(옛 = 전부 맞음) ② 나이 eq · gte · lte · between 에 `'30.0'` · `'30'` · 30 = 옛 `Number()` 와 같은 집합 |
| K5c H4 R59 | `customer-filter.ts` 에서 숫자식(`ageExpr` · `ageExprMixed` · `customNumberExpr(` · `numberRef`)에 붙는 비교 SQL 줄마다 그 자리 값 넣기 = `bindNumber(` 또는 `bindNumericRaw(`(옛 원값 자리 = mixed 사용자 칸 두 자리만 · 자리 목록 고정) · 이 파일에 `params.push(value)` 가 숫자식 비교 뒤에 오는 자리 0 · 반례 시험(숫자식 비교 뒤 원값 push 를 일부러 넣으면 빨간불) · 실 PG = `between [0,'abc']` 400 · `lte 'NaN'` 400 · 정상 `gte '30'` = 같은 결과 |
| K5b H4 R59 | SQL 매개변수 배열(이름이 params 로 끝남 · 대소문자 무관)의 `.push(` 인자 안 `Number(` · `parseInt(` · `parseFloat(` = 0(백엔드 전 파일 · 기계 추출) · 그 자리 = `sqlNumberParam(` · 반례 시험(일부러 `params.push(Number(x))` 를 넣으면 빨간불) · `sqlNumberParam('abc')` = 400 오류 · `sqlNumberParam('12')` = 12 |
| K5 H4 R59 | 추출 v4 와 같은 규칙(키 이름 목록 없음 · 층 1 처리기 · 층 2 주소 값을 받는 도우미 · 숫자 바꿈 · 산술 · 날짜 조립 · `?.` · 대괄호)으로 뽑은 줄마다 같은 줄이 CT(`parsePageParams` · `parseOffsetParam` · `parseQueryInt`) 안 · 0 기반 두 자리 = `pageBase: 0` · 반례 시험(구조 분해 · 별칭 · `?.` · 날짜 조립 · 도우미로 넘긴 꼴을 일부러 넣으면 빨간불) |
| K6 H5 | 점검 판 검사 단추가 판 id 를 넘긴다 · 막기 판정 = `abSendCopies` · 상세 `ab_variants` 에 id |
| 실 PG | H1(시작 · 마감 facts → 원문 줄 · 재료 글) · H2(회신번호 · 매장 둘 다 있는 고객 = 회신번호 · 미등록 수 = 실행기 판정과 같음) · H3(허용 · 쿨다운 0 · 진행 중 고객 = 세기 0 · 넣기 0 · 수 일치) · H4(customers 목록 page='abc' · limit=-5 = 200 + 기본) · H5(판 id 로 검사 글 = 그 판) |

## §6 배포
- DDL 0 · ENV 0 · npm install 0 · 백엔드 · 프론트 둘 다.
- **C105-S0(배포 전 · Harold 실행)** = H2 동작 변화 실측: 켜진 · 멈춘 store 모드 여정 수와 그 여정 대상 회사 고객 중 회신번호 · 매장 전화번호가 둘 다 있고 다른 고객 수(SQL 원문 = 배포 원장 C105-S0).
- C105-S1(배포 뒤) = 직원 시트 33 ~ 37.

## §7 직원 시트(C105-S1 · `docs/2026-11-05-c105-staff-sheet.xlsx` · 시트 33 ~ 37)
- 33 기간: AI한줄로 「문안에 넣을 내용을 확인할게요」에서 「기간으로 고르기」 → 시작 11/1 · 마감 11/30 → 문안에 「11월 1일 ~ 11월 30일」 · DM · 이메일 한줄 단계도 같은 입력.
- 34 개별회신번호: 여정 [시작] 카드 「개별회신번호로 보내기」 켜기 → 켜기 확인 창 「미등록 개별회신번호」.
- 35 재진입: 재진입 허용 · 쿨다운 0 여정 인원 = 진행 중 고객을 뺀 수.
- 36 고객 목록: 주소창에 page=abc 를 넣어도 목록이 뜬다.
- 37 A/B 검사: A/B 칸 점검 판 「A안 검사」 · 「B안 검사」 · 창의 글 = 그 판 글.

## §8 설계 구조체크(1차 · 1105)

| ID | 물음 | 코드 대조 | 결과 |
|---|---|---|---|
| SC-H1-1 | 시작일을 싣으면 옛 요청의 원장 키 · 지문이 바뀌나 | `services/ai-line.ts:560` `aiLineCopyKey(facts)` = facts 객체째 · `period_start` 는 값이 있을 때만 싣는다 | 옛 요청 키 불변 |
| SC-H1-2 | 다시 열기 · 이어 하기가 시작일을 잃나 | `LineIntakeModal.tsx:330` = `f.period_end` 만 되살림 · `LineStepsModal.tsx:8` = 답 객체째 sessionStorage | 330 에 `period_start` 되살리기 추가 · 단계 창은 답 객체에 `periodStart` 칸을 더하면 같이 남음 |
| SC-H1-3 | 화면 기간 글 = 서버 글? | 화면 두 벌(`LineIntakeModal.tsx:41` = 연도 없음 · `LineStepsModal.tsx:76` = 올해 아니면 연도) · 서버 `formatLinePeriodEnd` = 늘 연도 | **정정** = 화면 한 벌(단계 창 꼴) · 서버와 「같은 글」 짝 시험 삭제 · 각자 손으로 쓴 기대 글 |
| SC-H1-4 | 남은 시간 띠 · 쿠폰 만료가 시작일을 써야 하나 | `line-compositions.ts:389` · `line-template-compose.ts:263` · `dm-ai.ts:778-782` = 끝 시각만 | 마감일 그대로 |
| SC-H1-5 | 재료 글을 쓰는 화면 블록이 글 길이에 묶였나 | `line-compositions.ts:282 · 288 · 553` · `line-template-compose.ts:154 · 165 · 170 · 180` = 글을 줄로 붙임(자르기 0) | 기간 글이 길어져도 줄 하나 · 렌더 실측 = 직원 시트 33 |
| SC-H2-1 | 개별 번호의 「숫자 없는 값」 처리 | `callback-filter.ts:69-90` 1단계는 공백만 비교 · 숫자 판정 = 2단계 | **정정** = CT 는 1단계 글자 그대로 · 숫자 판정은 부르는 쪽 |
| SC-H2-2 | 여정 실행기 고객 행에 callback · store_phone 이 있나 | `journey-executor.ts:756` `SELECT * FROM customers` | 있음 |
| SC-H2-3 | 켜기 확인 수 = 실행기 실패 수 | 둘 다 같은 CT · 같은 등록 판정(`isCallbackRegistered` · 여정 만든 계정) | 같음(실 PG) |
| SC-H2-4 | 「매장번호」 문구를 쓰는 화면 | `JourneyStartCard.tsx:215` · `JourneyActivationConfirmModal.tsx:520-540` · `JourneyWorkspace.tsx:718-719` · `JourneysPage.tsx:1869` · `journey-activation.ts:84` · `map/BatchActivateModal.tsx`(주석) | 다섯 화면 글 · 서버 글 바꿈 · 주석 그대로 |
| SC-H3-1 | 조각을 부르는 모든 뽑기 갈래가 같은 넣기 가드를 거치나 | `journey-target-extractor.ts` 189 · 211 · 255 · 293 · 335 · 381 · 411 · 522 → 넣기 = `enqueueCandidates`(watcher 851 `reentryGuard`) | 같은 가드 |
| SC-H3-2 | 옛 「다른 판만」이 일부러였나 | 주석 「다른 판에서 진행 중이면 그 판에서 마무리」 = 이중 진입 막기 · 지금 여정 진행 중은 넣기가 뺌 | 뽑기도 빼야 같은 수 |
| SC-H4-1 | 새 상한이 쓰는 화면을 깨나 | 상한 없던 자리에 상한을 걸면 큰 limit 을 보내는 화면이 잘림(영향표 없음) | **정정** = 새 상한 0 · `QUERY_LIMIT_NO_CAP` 100,000(터무니없는 값만 · 화면이 보내는 가장 큰 limit = 2000 `ResultsModal.tsx:189 · 204` · 1000 `AdminDashboard.tsx:2202` · `AlimtalkSendersSection.tsx:121` = 모두 아래) |
| SC-H4-2 | page × limit 이 bigint 를 넘나 | `parsePageParams` page 상한 없음 | page 상한 1,000,000 |
| SC-H5-1 | 상세 `ab_variants` 에 id 를 더하면 깨지는 소비처 | 화면 `AbVariantCopy`(variant_id · 글 · 제목) · 계약 `journey-automarketing-core-1102` 상세 줄 = 앞부분 문자열 | 칸 더하기 = 무해 |
| SC-H5-2 | 창이 판 id 를 받나 | `SpamFilterTestModal.tsx:88` `journeyStep.variantId` · 서버 `routes/ai.ts:4435 · 4454` | 받음 |


## §9 Codex 설계 판정

| 라운드 | 지적 | 판정 | 반영 |
|---|---|---|---|
| 1R | H2 S0 가 번호 다른 고객만 셈 · 회신번호만 · 숫자 없는 값 · 미등록 결과 변화 누락 | 수용 | 옛 ↔ 새 결과 표 · S0 = 같은 등록 판정으로 결과 전이 수를 내는 읽기 스크립트 |
| 1R | H4 0 기반 페이지(companies.ts:1487 · 1651) 를 1 기반 CT 로 옮기면 앞 페이지 반복 · 첫 페이지 누락 | 수용 | CT `pageBase` · 0 기반 두 자리 · 추출 v2(124) |
| 1R | H1 마감 하한 = 시작일이면 서버가 거절할 과거 마감을 화면이 허용 | 수용 | 마감 하한 = max(오늘, 시작일) · 「다음」 판정 같은 범위 |
| 2R | H2 S0 가 날짜축 여정의 다음 발송 고객(완료 · 다음 날 대기)을 빠뜨림 | 수용 · 1R 과 같은 부류(덮는 집합을 손으로 정함) → 구조 = 작성자 범위 회사 고객 전원(상한) | S0 대상 = 경로 무관 상한 + 진행 중 부분 수 |
| 2R | H4 추출 · K5 가 키 이름 목록에 묶여 year · month 날짜 조립을 놓침 | 수용 · 1R 과 같은 부류(꼴 · 키 목록) → 구조 = 키 무관 · 값 흐름(숫자 바꿈 · 산술 · 날짜 조립) | 추출 v3 · K5 같은 규칙 · 반례 시험 · campaigns 날짜 조립 = CT 값만 |
| 3R | H2 S0 가 담당 범위가 바뀐 진행 중 고객을 빠뜨림(실행기는 회사 · 고객 id 로만 읽음) | 수용 · **같은 부류 세 번째** · 왜 = 「다음 발송을 받을 고객」을 경로 · 범위로 좁혀 정의했다 · 실행기가 읽는 조건(회사)만이 참 상한 | S0 대상 = 그 회사 고객 전원(조건 0) + 진행 중 부분 수 |
| 3R | H4 추출이 도우미로 넘긴 주소 값(precheck-usage · intro-leads) · `req.query?.limit` 을 놓침 | 수용 · 같은 부류 세 번째 · 왜 = 값 흐름을 처리기 안에서만 봤다 | 추출 v4 = 처리기 + 주소 값을 받는 도우미 두 층 · `?.` · 133 줄 · K5 같은 규칙 |
| 4R | S0 = 반례 없음 · H4 고객 필터 JSON → 중첩 도우미 `Number(value)` → SQL 을 놓침 | 수용 · **같은 부류 네 번째** · 왜 = 소스 쪽 길 쫓기는 끝이 없다 | 양쪽 닫기 = 받는 경계 CT + SQL 직전 CT `sqlNumberParam`(어디서 온 값이든) · K5b |
| 5R | 400 화면 회귀 = 없음 · (B) 가 원값을 넣는 숫자 비교(`customer-filter.ts:630-631 · 639-640`)를 놓침 · 성공 → 실패 전이 명시 | 수용 · 같은 부류 다섯 번째 · 왜 = SQL 직전 범위를 「변환 함수 꼴」로 정했다 | (B') 숫자식 비교 = 뜻으로(`bindNumber` 하나) · K5c · 전이 표 · `customers.ts` ageRange 변수 꼴 같은 배포 |
| 6R | `sqlNumberParam` 이 `Number()` 값을 넘기면 2^53 넘는 숫자 문자열 · 긴 소수가 깎여 정상 조건의 대상이 넓어짐 | 수용 · 새 부류(판정과 넘기는 값을 한 값으로 묶음) | (7R 에서 다시 정정) |
| 7R | 지수 표기(`'…e0'` · `'1e-400'`)가 넓어짐 · 정수 나이에 `'30.0'` 글자 = 실패 | 수용 · **6R 과 같은 뿌리 두 번째** · 왜 = 넘기는 값을 새로 정했다 | 구조 = 넘기는 값은 자리마다 옛 값 그대로 · 거절만 더함 · CT 두 함수(옛 `Number()` 자리 · 옛 원값 자리) · K5d 기대값 표 · 실 PG 두 묶음 |
| 8R | 함수 배정 = 맞음 · 원값 자리 거절을 JS `Number()` 로 정해 PG 정상 판독(`'1e 3'`)까지 막음 · [범위 밖] K5c 글이 bindNumber 만 말함 | 수용 · 같은 뿌리 세 번째 · 왜 = 거절 기준을 자리의 옛 진실(PG 판독)과 다른 잣대로 정했다 | 원값 자리 거절 = PG 가 비유한으로 읽는 특수 글자만 · 그 밖 PG 판단 그대로 · K5c 두 함수 · K5d `'1e 3'` |
| 9R | 지적 0 · approve(PG15 numeric.c 대조 · 비유한 표기 차단 누락 · 성공 → 실패 회귀 없음) | | | |

## §9-2 Codex 구현 판정

| 라운드 | 지적 | 같은 뿌리? | 판정 | 반영 |
|---|---|---|---|---|
| 1R | 새 진행(runId)에 앞 진행 시작일이 남음 | 새(진행 묶기) | 수용 | 초기화 효과에 setPeriodStart(null) · 계약 K1b |
| 1R | 되살린 시작일이 기간 부품에서 숨고 마감 고침이 지움(range = 마운트 때 시작일만) | 새(부품 상태 = 프로프) | 수용 | range = rangePicked \|\| !!start · 계약 K1b |
| 1R | 고객 목록 · 다운로드가 숫자 거절(400)을 500 으로 돌려줌(설계 §4 H4 약속) | 새 | 수용 · 같은 뿌리 같은 파일 셋 더(필터 미리보기 · 카운트 · 추출) | catch 첫 줄 respondUserError · 계약 K5e(소스 추출) |
| 2R | 지적 0 · approve | | | |

## §10 범위 밖(기록만)
- 목록 주소 limit 상한 설계(상한 없던 자리) = 쓰는 화면 영향표 뒤.
- 고객 필터 빈 값(`''` · null) = 0 으로 비교하는 옛 뜻(나이 0 · 금액 0) = 대상 정의 문제 · 따로.
- 몸통(req.body) 숫자 값이 변수로 계산돼 SQL 에 들어가는 길 = (B) SQL 직전 CT 가 `Number(` 를 그 자리에서 쓰는 꼴만 막는다 · 변수로 미리 바꾼 꼴은 각 라우트 검사 · 다음 점검.
- 1105 13:58 NaN 을 보낸 화면(생산자) = 미검증(`CustomerDBModal.tsx:156` · `AdminDashboard.tsx:2026` page · limit 조립) · 서버 거름이 먼저 · 배포 뒤 로그 `INVALID_NUMBER_INPUT` · 주소로 확인.
- 여정 개별회신번호의 「고른 칸」(직접발송 드롭다운) = 필요한 회사가 확인되면.
- 사건형 진입(`INSERT_EXECUTION_SQL` · 커서 경로)의 재진입 판정 = H3 은 공유 추출 경로만.

## 부록 A · H4 주소 숫자 값 133 줄(추출 v4 · 구현 = 자리마다 옛 식의 기본 · 상한 · 시작 기준을 CT 인자로)

| 층 | 파일:줄 | 값 | 쓰임 | 지금 |
|---|---|---|---|---|
| handler | `routes/address-books.ts:72` | limit | num | const previewLimit = req.query.limit !== undefined ? Math.min(Math.max(parseInt(String(req.query.limit), 10) \|\| 10, 1), 100) : null; |
| handler | `routes/admin-ops-records.ts:50` | limit | num | limit: Number(req.query.limit) \|\| 100, |
| handler | `routes/admin.ts:372` | page | num | const page = parseInt(req.query.page as string) \|\| 1; |
| handler | `routes/admin.ts:373` | limit | num | const limit = parseInt(req.query.limit as string) \|\| 50; |
| handler | `routes/admin.ts:1054` | page | num | const page = Math.max(1, Math.floor(Number(req.query.page) \|\| 1)); |
| handler | `routes/admin.ts:1454` | limit | num | const limit = Math.min(Number(req.query.limit) \|\| 100, 300); |
| handler | `routes/admin.ts:1482` | page | num | const page = Math.max(1, Math.floor(Number(req.query.page) \|\| 1)); |
| handler | `routes/admin.ts:2398` | page | num | const page = parseInt(req.query.page as string) \|\| 1; |
| handler | `routes/admin.ts:2399` | limit | num | const limit = parseInt(req.query.limit as string) \|\| 20; |
| handler | `routes/admin.ts:3103` | page | num | const page = parseInt(req.query.page as string) \|\| 1; |
| handler | `routes/admin.ts:3104` | limit | num | const limit = parseInt(req.query.limit as string) \|\| 10; |
| handler | `routes/admin.ts:3435` | page | num | const page = parseInt(req.query.page as string) \|\| 1; |
| handler | `routes/admin.ts:3436` | limit | num | const limit = parseInt(req.query.limit as string) \|\| 10; |
| handler | `routes/admin.ts:3557` | page | num | const page = parseInt(req.query.page as string) \|\| 1; |
| handler | `routes/admin.ts:3558` | limit | num | const limit = parseInt(req.query.limit as string) \|\| 50; |
| handler | `routes/admin.ts:3976` | page | num | const page = parseInt(req.query.page as string) \|\| 1; |
| handler | `routes/admin.ts:3977` | limit | num | const limit = parseInt(req.query.limit as string) \|\| 20; |
| handler | `routes/admin.ts:4080` | page | num | const page = parseInt(req.query.page as string) \|\| 1; |
| handler | `routes/admin.ts:4118` | page | num | const page = parseInt(req.query.page as string) \|\| 1; |
| handler | `routes/admin.ts:4167` | page | num | const page = Number(req.query.page) \|\| 1; |
| handler | `routes/admin.ts:4209` | page | num | const page = parseInt(req.query.page as string) \|\| 1; |
| handler | `routes/admin.ts:4210` | limit | num | const limit = parseInt(req.query.limit as string) \|\| 10; |
| handler | `routes/admin.ts:4763` | limit | num | const limit = Math.min(Math.max(Number(req.query.limit) \|\| 10, 1), 200); |
| handler | `routes/admin.ts:4764` | page | num | const page = Math.max(Number(req.query.page) \|\| 1, 1); |
| handler | `routes/admin.ts:4810` | limit | num | const limit = Math.min(Math.max(Number(req.query.limit) \|\| 20, 1), 200); |
| handler | `routes/admin.ts:4811` | page | num | const page = Math.max(Number(req.query.page) \|\| 1, 1); |
| handler | `routes/admin.ts:4908` | page | num | const page = parseInt(req.query.page as string) \|\| 1; |
| handler | `routes/admin.ts:4909` | limit | num | const limit = parseInt(req.query.limit as string) \|\| 15; |
| handler | `routes/admin.ts:5043` | page | num | const data = await loadWatchIps(Number(req.query.page) \|\| 1); |
| handler | `routes/admin.ts:5195` | page | num | const offset = (Number(page) - 1) * Number(limit); |
| handler | `routes/admin.ts:5230` | limit | num | [...params, Number(limit), offset], |
| handler | `routes/admin.ts:5237` | limit | num | totalPages: Math.max(1, Math.ceil(total / Number(limit))), |
| handler | `routes/admin.ts:5238` | page | num | page: Number(page), |
| handler | `routes/admin.ts:5555` | limit | num | const limit = Math.max(1, Math.min(50, Number(req.query.limit) \|\| 50)); |
| handler | `routes/admin.ts:5819` | page | num | const offset = (Number(page) - 1) * Number(limit); |
| handler | `routes/admin.ts:5865` | limit | num | params.push(Number(limit), offset); |
| handler | `routes/admin.ts:5896` | page | num | page: Number(page), |
| handler | `routes/admin.ts:5897` | limit | num | totalPages: Math.ceil(total / Number(limit)), |
| handler | `routes/agency-send.ts:195` | limit | num | const limit = Math.min(100, Math.max(1, Math.floor(Number(req.query.limit)) \|\| 100)); |
| handler | `routes/agency-send.ts:196` | offset | num | const offset = Math.max(0, Math.floor(Number(req.query.offset)) \|\| 0); |
| handler | `routes/agent-charge-orders.ts:122` | page | num | const page = Math.max(1, parseInt(String(req.query.page \|\| '1'), 10) \|\| 1); |
| handler | `routes/agent-charge-orders.ts:123` | limit | num | const limit = Math.min(PAGE_SIZE_MAX, Math.max(1, parseInt(String(req.query.limit \|\| '10'), 10) \|\| 10)); |
| handler | `routes/agent-charge-orders.ts:175` | page | num | const page = Math.max(1, parseInt(String(req.query.page \|\| '1'), 10) \|\| 1); |
| handler | `routes/agent-charge-orders.ts:176` | limit | num | const limit = Math.min(PAGE_SIZE_MAX, Math.max(1, parseInt(String(req.query.limit \|\| '10'), 10) \|\| 10)); |
| handler | `routes/ai-memory.ts:279` | limit | num | const limit = Math.min(parseInt(String(req.query.limit \|\| '10')) \|\| 10, 50); |
| handler | `routes/ai.ts:1596` | page | num | const page = Math.max(1, parseInt(String(req.query.page \|\| '1'), 10) \|\| 1); |
| handler | `routes/ai.ts:1597` | limit | num | const limit = Math.max(1, Math.min(50, parseInt(String(req.query.limit \|\| '10'), 10) \|\| 10)); |
| handler | `routes/ai.ts:1701` | months | num | const months = Math.max(1, Math.min(24, parseInt(String(req.query.months \|\| '12'), 10) \|\| 12)); |
| handler | `routes/ai.ts:1720` | days | num | const days = Math.max(7, Math.min(90, parseInt(String(req.query.days \|\| '30'), 10) \|\| 30)); |
| handler | `routes/ai.ts:1740` | days | num | const days = Math.max(7, Math.min(90, parseInt(String(req.query.days \|\| '30'), 10) \|\| 30)); |
| handler | `routes/ai.ts:1761` | days | num | const days = Math.max(7, Math.min(90, parseInt(String(req.query.days \|\| '30'), 10) \|\| 30)); |
| handler | `routes/ai.ts:2417` | limit | num | parseInt(String(req.query.limit \|\| '50')) \|\| 50, |
| handler | `routes/ai.ts:2768` | limit | num | const limit = Math.min(parseInt(String(req.query.limit \|\| '100')) \|\| 100, 500); |
| handler | `routes/ai.ts:2875` | limit | num | const limit = Math.min(parseInt(String(req.query.limit \|\| '50')) \|\| 50, 200); |
| handler | `routes/ai.ts:4519` | limit | num | const limit = Number(req.query?.limit) \|\| 50; |
| handler | `routes/ai.ts:4600` | page | num | const page = Math.max(1, parseInt(String(req.query.page \|\| '1'), 10) \|\| 1); |
| handler | `routes/ai.ts:4601` | limit | num | const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit \|\| '10'), 10) \|\| 10)); |
| handler | `routes/ai.ts:4763` | page | num | const page = Math.max(1, parseInt(String(req.query.page \|\| '1'), 10) \|\| 1); |
| handler | `routes/ai.ts:4764` | limit | num | const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit \|\| '10'), 10) \|\| 10)); |
| handler | `routes/alimtalk.ts:412` | page | num | const pageNum = Number(req.query.page); |
| handler | `routes/alimtalk.ts:413` | size | num | const sizeNum = Number(req.query.size); |
| handler | `routes/alimtalk.ts:618` | page | num | const page = Math.max(0, parseInt(String(req.query.page ?? '0'), 10) \|\| 0); |
| handler | `routes/alimtalk.ts:619` | count | num | const count = Math.min(100, Math.max(1, parseInt(String(req.query.count ?? '5'), 10) \|\| 5)); |
| handler | `routes/alimtalk.ts:2985` | limit | num | const limit = Math.max(1, Math.min(200, Number(req.query.limit) \|\| 50)); |
| handler | `routes/balance.ts:162` | months | num | const months = parseInt(req.query.months as string) \|\| 6; |
| handler | `routes/billing.ts:192` | month | num | const monthNum = Number(month); |
| handler | `routes/campaigns.ts:125` | page | num | const offset = (Number(page) - 1) * Number(limit); |
| handler | `routes/campaigns.ts:158` | year | arith | const monthStart = '${year}-${month}-01'; |
| handler | `routes/campaigns.ts:159` | year | num | const monthEnd = '${year}-${month}-${new Date(Number(year), Number(month), 0).getDate()}'; |
| handler | `routes/campaigns.ts:180` | limit | num | params.push(Number(limit), offset); |
| handler | `routes/campaigns.ts:276` | page | num | page: Number(page), |
| handler | `routes/campaigns.ts:277` | limit | num | limit: Number(limit), |
| handler | `routes/campaigns.ts:278` | limit | num | totalPages: Math.ceil(total / Number(limit)), |
| handler | `routes/campaigns.ts:1467` | total | num | const total = Number(req.query.total); |
| handler | `routes/campaigns.ts:3334` | limit | num | const limit = Math.min(parseInt(req.query.limit as string) \|\| 50, 200); |
| handler | `routes/cdp.ts:2092` | limit | num | const limit = Math.min(Math.max(parseInt(String(req.query.limit \|\| '10'), 10) \|\| 10, 1), 50); |
| handler | `routes/cdp.ts:2191` | limit | num | const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit \|\| '20'), 10) \|\| 20)); |
| handler | `routes/cdp.ts:2287` | days | num | const days = Math.max(7, Math.min(90, parseInt(String(req.query.days \|\| '30'), 10) \|\| 30)); |
| handler | `routes/cdp.ts:2333` | limit | num | const limit = Math.max(1, Math.min(50, parseInt(String(req.query.limit \|\| '10'), 10) \|\| 10)); |
| handler | `routes/companies.ts:379` | page | num | const page = parseInt(req.query.page as string) \|\| 1; |
| handler | `routes/companies.ts:451` | page | num | const page = parseInt(req.query.page as string) \|\| 1; |
| handler | `routes/companies.ts:1487` | page | num | const page = Math.max(0, parseInt((req.query.page as string) \|\| '0')); |
| handler | `routes/companies.ts:1488` | limit | num | const limit = Math.min(100, parseInt((req.query.limit as string) \|\| '20')); |
| handler | `routes/companies.ts:1726` | page | num | const offset = (Number(page) - 1) * Number(limit); |
| handler | `routes/companies.ts:1749` | limit | num | params.push(Number(limit), offset); |
| handler | `routes/companies.ts:1772` | page | num | page: Number(page), |
| handler | `routes/companies.ts:1773` | limit | num | limit: Number(limit), |
| handler | `routes/companies.ts:1774` | limit | num | totalPages: Math.ceil(total / Number(limit)), |
| handler | `routes/customers.ts:72` | page | num | const offset = (Number(page) - 1) * Number(limit); |
| handler | `routes/customers.ts:87` | page | num | pagination: { total: 0, page: Number(req.query.page \|\| 1), limit: Number(req.query.limit \|\| 50), totalPages: 0 }, |
| handler | `routes/customers.ts:142` | minAge | num | params.push(Number(minAge)); |
| handler | `routes/customers.ts:146` | maxAge | num | params.push(Number(maxAge)); |
| handler | `routes/customers.ts:192` | limit | num | params.push(Number(limit), offset); |
| handler | `routes/customers.ts:211` | page | num | if (result.rows.length === 0 && Number(page) > 1) { |
| handler | `routes/customers.ts:226` | page | num | page: Number(page), |
| handler | `routes/customers.ts:227` | limit | num | limit: Number(limit), |
| handler | `routes/customers.ts:228` | limit | num | totalPages: Math.ceil(total / Number(limit)), |
| handler | `routes/customers.ts:1633` | page | num | const pageRaw = Number(req.query.page); |
| handler | `routes/customers.ts:1635` | limit | num | const limitRaw = Number(req.query.limit); |
| handler | `routes/customers.ts:1808` | page | num | const pageRaw = Number(req.query.page); |
| handler | `routes/customers.ts:1810` | limit | num | const limitRaw = Number(req.query.limit); |
| handler | `routes/customers.ts:1913` | limit | num | limit: req.query.limit ? Number(req.query.limit) : 50, |
| handler | `routes/customers.ts:1914` | months | num | months: req.query.months ? Number(req.query.months) : undefined, |
| handler | `routes/dm.ts:2755` | page | num | const page = parseInt(req.query.page as string, 10) \|\| 1; |
| handler | `routes/dm.ts:2756` | limit | num | const limit = parseInt(req.query.limit as string, 10) \|\| 50; |
| handler | `routes/email.ts:468` | limit | num | const limit = Math.min(parseInt(String(req.query.limit \|\| '50')) \|\| 50, 200); |
| handler | `routes/email.ts:970` | limit | num | const limit = Math.min(parseInt(String(req.query.limit \|\| '100')) \|\| 100, 500); |
| handler | `routes/email.ts:971` | offset | num | const offset = Math.max(parseInt(String(req.query.offset \|\| '0')) \|\| 0, 0); |
| handler | `routes/email.ts:1384` | days | num | const daysRaw = parseInt(String(req.query.days \|\| '30'), 10); |
| handler | `routes/gateway-templates.ts:904` | limit | num | const limit = Math.min(500, Math.max(1, parseInt(String(req.query.limit ?? '100'), 10) \|\| 100)); |
| handler | `routes/gateway-templates.ts:905` | offset | num | const offset = Math.max(0, parseInt(String(req.query.offset ?? '0'), 10) \|\| 0); |
| handler | `routes/makeshop.ts:104` | days | num | const days = Number(req.query.days) \|\| 30; |
| handler | `routes/mall-products.ts:74` | limit | num | const limit = Math.min(Math.max(parseInt(String(req.query.limit \|\| '50'), 10) \|\| 50, 1), 100); |
| handler | `routes/manage-stats.ts:47` | page | num | const page = parseInt(req.query.page as string) \|\| 1; |
| handler | `routes/manage-stats.ts:48` | limit | num | const limit = parseInt(req.query.limit as string) \|\| 10; |
| handler | `routes/marketing-diagnosis-admin.ts:64` | limit | num | const limit = Math.max(1, Math.min(Number(req.query.limit) \|\| 50, 200)); |
| handler | `routes/marketing-diagnosis-admin.ts:65` | offset | num | const offset = Math.max(0, Number(req.query.offset) \|\| 0); |
| handler | `routes/naver-commerce.ts:140` | hours | num | const hours = Number(req.query.hours) \|\| 24; |
| handler | `routes/payments.ts:464` | page | num | const page = parseInt(req.query.page as string) \|\| 1; |
| handler | `routes/payments.ts:465` | limit | num | const limit = Math.min(parseInt(req.query.limit as string) \|\| 20, 100); |
| handler | `routes/plan-term.ts:66` | offset | num | const r = await listPlanTermEvents(companyId, { offset: Number(req.query.offset) \|\| 0, limit: Number(req.query.limit) \|\| 5, audience: 'customer' }); |
| handler | `routes/sales-outreach.ts:219` | limit | num | limit: req.query.limit ? Number(req.query.limit) : null, |
| handler | `routes/sns.ts:829` | page | num | const page = Number.parseInt(String(req.query.page ?? '1'), 10); |
| handler | `routes/spam-filter.ts:758` | page | num | const page = parseInt(req.query.page as string) \|\| 1; |
| handler | `routes/unsubscribes.ts:207` | page | num | page: Number(page), |
| handler | `routes/unsubscribes.ts:208` | limit | num | limit: Number(limit), |
| handler | `routes/unsubscribes.ts:247` | page | num | page: Number(page), |
| handler | `routes/unsubscribes.ts:248` | limit | num | limit: Number(limit), |
| handler | `routes/unsubscribes.ts:249` | limit | num | totalPages: Math.ceil(total / Number(limit)), |
| handler | `routes/admin/login-blocks.ts:44` | page | num | const page = Number(req.query.page \|\| 1); |
| handler | `routes/admin/login-blocks.ts:45` | limit | num | const limit = Number(req.query.limit \|\| 50); |
| helper:parseIntroLeadsQuery | `utils/intro-leads.ts:71` | q | num | const page = Math.max(1, Math.min(10000, Math.floor(Number(q?.page)) \|\| 1)); |
| helper:parsePrecheckUsageQuery | `utils/precheck-usage.ts:42` | q | num | const n = Math.floor(Number(q?.page)); |
