# AI 한줄로 · AI 오퍼레이터 분리 · 메인 대시보드 개편 (2026-10-18 · 한줄로 V2 마지막)

> 근거 = 브레인스토밍 2회(흐름 9항목 · 메뉴/대시보드) + 회의론자 최종 검증 + 브리핑(scratchpad `hanjul-v2-final-briefing.html`).
> Harold 승인(10-18 밤): 「디자인 맘에 든다 · 제대로 적용 · 설계서 쓰고 구현까지 · Codex 닫힐 때까지 · 배포 명령만」.
> 3안 전부 = 8크레딧 수용 · 「체크 모달만 띄우면 된다(얼마 차감되는지)」 → 확인 판 아래 금액 줄 + 버튼에 금액.

## 0. 확정 결정 (Harold)

| 항목 | 결정 |
|------|------|
| 대시보드 | 헤더(상단 메뉴) 변경 없음 · 오른쪽 40% 버튼 열 삭제 → 버튼을 맨 위 같은 폭 그리드로 · 지금 3색 그라데이션 · 이동만(입력창 · 추천 칩 없음) · 아래 카드 전체 폭 |
| 메뉴 | AI 한줄로(`/ai-line` · 한 줄 발송) · AI 오퍼레이터(`/ai-operator` · 기능 12개) 분리 · 두 화면 남색 머리에 탭 2칸 |
| 크레딧 | 대상 찾기 2 + 문안 1종당 2(3종 = 8) · 꾸미기 1(고른 문안 1개) · 확인 판에 차감 금액 · 잔액 전후 |
| 스팸 자동 검사 | 비용 = 고객사(수동 검사와 같은 선불 경로 · 요금제 무료 문자 먼저) |
| 직접 타겟 발송 | 별도 창 불필요 · 새 흐름으로 접는다 · 예외 = AI 숨김 사용자(이에스페이먼츠 1명) 영구 유지 |
| 0크레딧 조건 추출 | 새 흐름 켠 회사는 화면에서 내린다(코드는 남김) |
| 미가입 | AI 한줄로 → 안내 창(영상 자리) · AI 오퍼레이터 → 지금처럼 들어가 기능을 누르면 기능 안내 창 |
| 영상 | 지난 12편처럼 Harold님이 만든 파일을 원장 `video` 줄에 붙인다(그 전에는 한 단 창) |

## 1. 접수 축 대조표 (scope_discipline)

| 접수 | 닫는 축 | 이 설계에서 |
|------|---------|-------------|
| 대시보드 버튼 3개 → 맨 위 3열 · 아래 전체 폭 | 대시보드 배치 | §3 |
| AI 한줄로 / AI 오퍼레이터 메뉴 분리 · 오퍼레이터 = 기능 12개 바로 | 화면 분리 | §4 |
| 한 줄 → 대상 추출 · 빠진 것만 묻기 · 이미 말한 것 안 묻기 | read · intake | §5-1 · §5-2 |
| 칼럼 다시 확인 · 1위 고객 · 고른 칼럼만 | intake · compose(exactVars) | §5-2 · §5-4 |
| 직접입력 · 감성형 · 혜택강조형 · MZ 감성형 · AI 추천 표시만 · 선택 자유 | 종류 타일 | §5-3 |
| 2 + 2N 크레딧 · 확인 창에 차감 금액 | 크레딧 | §6 |
| 꾸미기 = 고른 문안 1개 · 1크레딧 | decorate | §5-5 |
| 직접입력 · 문안 생성 뒤 스팸 자동 검사 · 결과 표시 | 자동 스팸 | §7 |
| 알림톡이라 적으면 템플릿 고르기로 | 알림톡 갈래 | §8 |
| 타겟이 명확하면 질문 건너뜀 | read · 확인 판 1장 | §5-1 |
| 직접 타겟 발송 메뉴 접기 | 접기 | §9 |
| 지금 운영 결함 4건 | 0단계 | §2 |
| 미가입 안내 창(영상) | 안내 원장 | §4-3 |

빠진 축 0.

## 2. 0단계 · 지금 운영 결함 4건 (스위치와 무관 · 전 회사)

| # | 결함(코드 확인) | 처방 | 영향 |
|---|----------------|------|------|
| 0-1 | 허브 제안이 대상 0명이어도 문안이 나오면 5 차감 · `routes/ai.ts` `/operator/propose` 가 `chargeOnlyWithTarget` 미전달 · `orchestrateWithAI` 에는 옵션 자체 없음 | 두 함수 모두 옵션을 받고 propose 가 `true` 로 넘긴다 | 허브 propose 1곳 · 자동마케팅 미리보기는 이미 넘김(무변) · 회차 생성은 옵션 미지정(무변) |
| 0-2 | 허브 대상 수 실측에 매장 범위 없음 · `ai-orchestrator.ts` 허브 갈래 `countFilteredCustomers(…, userId)` 가 storeFilter 미전달(발송 `preview-recipients` 는 범위 적용) | 발송과 같은 범위 CT `resolveHubStoreScope(companyId, user)`(preview-recipients 인라인 원형 이동) 를 세기 · 1위 고객 · 명단 · 발송 4곳이 함께 쓴다 · ctx 에 `userType` 추가 | 허브 propose 세기 · orchestrateWithAI 세기 도구 · preview-recipients · sample-customer · target-recipients(동작 무변 = 원형 이동) |
| 0-3 | 허브 조건 해석기가 브랜드(store_code) 조건을 건너뜀 · `customer-filter.ts` `buildFilterWhereClauseCompat` = `storeCodeMode:'skip'` | `'subquery'` + `companyIdParamRef:'$1'`(직접 타겟 · `buildDynamicFilterCompat` 와 같은 소속 표 조건) | 소비처 9곳 전부 `$1 = companyId` 확인(§10 영향표) · 판정 전용 2곳(전체 고객 신호 · 칸 조건)은 브랜드 단독 조건을 이제 「조건 있음」으로 본다 = 원래 의도 |
| 0-4 | 「이번달 사용금액」 카드에 크레딧 충전이 섞임 · `companies.ts` `monthly_spend` 가 `balance_transactions deduct` 합(충전 = `reference_type='credit_recharge'` deduct) · 후불 0원 · 월초 = DB 시간대 | 발송 현황과 같은 CT `computeMonthlyUsage(companyId,{userId,userType}).monthlyCost` 반올림 | 카드 1곳 · 발송 현황과 같은 값(사용자 = 본인 발송만 · 관리자 = 전체 · 같은 규칙) |

## 3. 메인 대시보드 (`pages/Dashboard.tsx`)

- 순서 = **맨 위 버튼 줄 → 지금 돌고 있는 자동화 띠 → 진단 히어로 · 브랜드 보이스 → [요금제 40 | 발송 현황 60] → DB 현황(전체 폭)**.
- 버튼 줄(같은 폭 · 가로 배치 · 높이 약 84px · 지금 3색 그라데이션 · 글래스 칩 · 원형 화살표):
  - 기본 = **[AI 한줄로 · AI 오퍼레이터 · 고객 DB 업로드]**.
  - 새 흐름 스위치 **꺼진** 회사 = [AI 한줄로 · AI 오퍼레이터 · 직접 타겟 발송 · 고객 DB 업로드] 4열(직접 타겟은 새 흐름이 켜질 때 접는다 · §9).
  - AI 숨김 = [직접 타겟 발송 · 고객 DB 업로드] 2열(지금 버튼 그대로) · 업로드까지 숨김이면 1장.
  - 모바일(390) = 한 줄 작은 타일(아이콘 + 이름).
- AI 한줄로 = `/ai-line` · 미가입(요금제 판정 `fetchAiOperatorAccess` false) = 안내 창 `ai-line` · AI 오퍼레이터 = `/ai-operator`(지금 openLive('hub')) · 「자동화 n개 작동 중」 배지 그대로.
- 자동화 띠 빈 상태 = 한 줄(`LiveAutomationStrip` 빈 칸 86px 상자 → 한 줄 문장 + 기준 시각 + [자동화 시작하기]).
- DB 현황 = 전체 폭 · 한 쪽 카드 수만큼 열(최대 6 · 지금 4개면 4열 · 빈 칸 없음) · 쪽 넘김 그대로.

## 4. AI 오퍼레이터 · AI 한줄로 화면 분리

### 4-1. 공용 머리 `components/ai-line/AiHubBand.tsx`
지금 허브 남색 띠(뒤로 · 로고 · 크레딧 칩)를 원형 이동하고, 제목 줄 오른쪽에 탭 2칸(누르는 타일 · 고른 것 = 흰 판): `AI 한줄로 · 한 줄로 발송` / `AI 오퍼레이터 · 기능 12개`.

### 4-2. `/ai-operator` (`AiOperatorPage.tsx`)
- 머리 + 기능 카드 4줄 × 3(지금 `HUB_CARD_ROWS` 그대로) · 기능 안내 창 · `?intro=` 처리 · 첫 진입 안내 그대로.
- 한 줄 입력 · 추천 띠 · 제안 결과는 `/ai-line` 으로 옮긴다(원형 이동).
- 옛 넘기기(`ai_operator_prefill_objective`)가 남아 있으면 `/ai-line` 으로 넘긴다(옛 링크 · 다른 탭 호환).

### 4-3. `/ai-line` (`AiLinePage.tsx` 신설 · 지금 허브의 입력 · 결과 원형 이동)
- 스위치(`AI_LINE_V2_COMPANY_IDS`) **꺼짐** = 지금 propose 흐름 그대로(5크레딧 · 3안).
- **켜짐** = §5 새 흐름. 추천 띠(오늘 분석 1순위 → 입력창 채우기)는 두 경우 모두 이 화면 위.
- 넘기는 곳: `CardDetailModal`(카드 상세 → 한 줄) = `/ai-line`.
- 미가입 = 화면은 열리고 [보내기]가 안내 창 `ai-line` 을 연다(서버 원장 `plan-feature-intros.ts` 에 항목 추가 · `video` 줄은 파일이 올 때).

## 5. 새 흐름 (스위치 켠 회사)

화면 = 한 줄 → (빠진 것이 있을 때만) 1장 → 확인 판 1장 → 결과 카드(창을 닫은 뒤 페이지) → 발송 확인 창(지금 것).
서버 = `routes/ai-line.ts`(신설 · `/api/ai-line`) · 순수 판정 `utils/ai-line.ts` · 생성 `services/ai-line.ts`.

### 5-1. `POST /read` — AI 0 · DB 0 · 무과금
- 입력 `{ line }`. 출력 `{ enabled, branch, gaps:{benefit, period}, adConflict }`.
- `gaps.benefit` = `oneLineGaps`(지금 판정) · `gaps.period` = 행사 의도 + 기간 언급 없음(`linePeriodMentioned` · 1017 과 같은 판정).
- `branch` = 「알림톡」 낱말 → `alimtalk` · 「카톡 · 카카오」만 → `ask_kakao`(한 번 묻기: 알림톡 / 문자) · 그 밖 `sms`. 광고 의도 + 알림톡 = `adConflict:true`(「알림톡은 광고를 보낼 수 없어요 · 문자로 만들까요」).

### 5-2. `POST /intake` — 대상 AI 1회 · 기본 2크레딧(대상 1명 이상일 때)
- 입력 `{ line, facts:{benefit, periodEnd} }`.
- 대상 AI = `recommendTarget(…, { model:'opus', lineIntake:true })` — 출력에 조건마다 **원문 조각**(`filter_quotes`) · 추천 종류(`recommended_style`) · 이유 한 줄. 옛 호출처 무변경(옵션일 때만 출력 형식 확장).
- 조건 출처 = 서버가 조각이 한 줄(정규화)에 실제로 있는지 확인 · 없거나 모르면 「AI 가 보탬」(끌 수 있는 쪽).
- 세기 = 발송과 같은 몸통 `buildAudienceCountSql` + `resolveHubStoreScope` + 수신동의 CT + 안전 필터. 빈 조건 = `all_customers` 선언일 때만 전체 · 아니면 「옮기지 못함」(0명 + 사유).
- 1위 고객 = 같은 WHERE · `ltv_score DESC, total_purchase_amount DESC` 1명 · 화면에는 id + 가린 값만.
- 칼럼 = 회사 프로필 대상 필드(FIELD_MAP 컬럼) · **채움 % = 이 대상 안에서**(같은 WHERE 한 번) · 30% 미만 잠금.
- 차감 = 대상 ≥ 1 이면 기본 키로 2(§6). 0명이면 0 · 사유 셋 구분(조건 0명 · 옮기지 못함 · 매장 미배정).
- 출력 = 조건 목록(키 · 라벨 · 값 글 · 출처) · 대상 수 · 1위 고객 · 칼럼 · 추천 종류 · 채널 · 광고 여부 · 추천 시각 · 캠페인 이름 · `baseCharged`.

### 5-3. 확인 판(화면)
- 왼쪽: 읽은 대상 칩(출처 「한 줄」) · 「AI 가 보탬」 칩(기본 켬 · 끄면 재집계) · 받는 사람 수 · 혜택 · 기간 · 채널 · 종류 타일 4개(직접입력 +0 · 나머지 +2 · 추천 배지 + 이유 · 미리 켜기 0).
- 오른쪽: 1위 고객 칼럼 체크(기본 0개) · 채움 % · 금액 줄(대상 찾기 이미 냄 / 문안 N × 2 / 스팸 검사 건수는 문자 요금) · 잔액 전 → 후.
- 버튼 = `만들기 · {2N(+2)}크레딧` · 직접입력만 = `이 대상으로 진행`(기본 미납이면 2) · 종류 0개 = 잠김 「종류를 골라 주세요」 · 0명 = 잠김 · 1만 명 초과 = 잠김.
- 조건을 전부 끄면: 서버 재집계 `empty:true` → 「조건 없이 전체 고객 n명」 체크를 직접 켜야 진행.

### 5-4. `POST /recount` (0크레딧) · `POST /compose`
- `/recount` 입력 `{ filters, allCustomers }` → 같은 몸통으로 센 수 · `empty`.
- `/compose` 입력 `{ line, facts, filters, allCustomers, types[], vars[], channel, isAd, attemptToken }`:
  1. 다시 센다(0명 = 400 `TARGET_ZERO` · 1만 초과 = 400 `TARGET_TOO_MANY` · 둘 다 차감 전).
  2. 잔액 = 기본 미납분 + 2N 을 `hasCreditForStrict` 로 먼저 본다.
  3. `runInCreditBundle` 안에서 문안 생성 1회(`generateMessages` · `exactVars` · 혜택 근거 = 한 줄 + 답) → 고른 종류만 꺼낸다.
  4. 기본 미납이면 기본 키로 2 → 문안 키로 `2 × 실제로 나온 종류 수`(한 행).
- `exactVars`(새 옵션): 주면 그 칼럼만 · 빈 배열 = 개인화 끔 + 본문의 %변수% 전부 제거 · 프로필 자동 개인화 · 프로필 안내문 끔. 옛 호출처 무변경.
- 칼럼 1개 이상 + SMS = LMS 로 올린다(지금 허브 규칙과 같음).

### 5-5. `POST /decorate` — 1크레딧
- 입력 `{ body, vars[], channel, isAd, attemptToken }`. 문안 1개만. `decorateOperatorMessages`(지금 꾸미기)에 단가 원천 인자를 더해 `'ai-line-decorate'` 1로 걷는다(옛 3 키 무변경).

### 5-6. 상태(화면)
- run 객체 하나(`utils/ai-line.ts` 화면판) · runId 일치 응답만 반영 · sessionStorage 보관(창을 닫아도 · 페이지를 떠나도 이어서) · 다듬은 문안 읽기·쓰기 = `bodyOf` · `setBody` 한 곳.
- 발송 = 지금 허브 승인 발송(`preview-recipients` → `/direct-send` · `sendType:'operator'`)을 함수로 묶어 두 흐름이 같이 쓴다.

## 6. 크레딧

| 원천(source) | 값 | 키 | 언제 |
|---|---|---|---|
| `ai-line-intake` | 2 | `aio-base:{회사}:{KST날짜}:{한 줄 지문12}` | intake 대상 ≥1 · 또는 compose · 진행에서 미납일 때 |
| `ai-line-compose` | 2 × 나온 종류 수 | `aio-copy:{회사}:{시도 토큰}:{입력 지문16}` | compose 성공 뒤 |
| `ai-line-decorate` | 1 | `aio-deco:{회사}:{시도 토큰}:{입력 지문16}` | 꾸미기 성공 뒤 |

- 기본 납부 판정 = 원장에 오늘 키 **또는 어제 키**(자정 경계)가 있는가(`isChargedByKey` · 조회 실패 = 503).
- 같은 날 같은 한 줄 = 기본 0. 같은 시도 재요청 = 같은 키 = 0(응답 유실 대비).
- 안쪽 AI 호출은 `runInCreditBundle` 로 0 · 원장 행 = 진입점에서만.
- `propose` 5 · 옛 꾸미기 3 은 손대지 않는다. 프론트 `constants/credit.ts` 단가표 · 이름표 세 키 함께.
- 성공 뒤 확정 = `settleCreditAfterSuccess`(잔액 부족은 402 · 결과를 내주지 않음).

## 7. 스팸 자동 검사

- `POST /api/ai-line/spam-test` `{ body, subject, channel, isAd, callback, sampleCustomerId }` → 등록 · `GET /api/ai-line/spam-test/:id` → 칩 상태.
- 입구 순서: 시연 회사 = 줄에 넣지 않음(칩 「시연 계정은 검사하지 않아요」) · 요금제에 스팸 검사 없음 = 넣지 않음(체험 횟수를 쓰지 않는다) · 등록 발신번호만(개별 회신이면 기본 번호) · MMS = 글만 검사 표기.
- 검사 글 = 발송과 같은 순서(`(광고)` + 본문 + 무료거부 080 · LMS 제목 `(광고)`) · 1위 고객 = 서버가 매장 범위 안 원본 행으로 치환.
- 재사용 = 같은 회사 · 발신번호 · 유형 · 치환 뒤 글 해시로 24시간 안 끝난 검사(통과 · 막힘)가 있으면 그 결과(새 차감 0).
- 사용자당 줄에 선 자동 검사 1건(있으면 `busy` · 화면이 끝난 뒤 다음 카드를 보낸다) · 카드당 자동 2번(첫 + 고친 뒤 1).
- 비용 = `enqueueSpamTest`(source `auto_ai` · 선불 차감 · 잔액 부족 = 칩 「잔액이 부족해 검사하지 못했어요」).
- 칩 = 줄 대기(앞 n건) → 확인 중(남은 초 = 대기열 워커가 시작한 시각 · 재시작이면 등록 시각) → 통과 / 막힘(통신사) / 결과 없음. 칩은 실제로 나가는 글 해시에 묶임(글이 바뀌면 「다시 검사」).
- 수동 검사 창의 「진행 중 409」 에서 자동 출처를 뺀다(자동 검사가 수동 검사를 막지 않게).
- **DDL 0**: 운영은 단일 프로세스(PM2 `instances:1`)라 시작 시각을 워커 메모리에서 읽는다(브리핑의 `started_at` 칸 대신).
- 발송은 막지 않는다: 발송 확인 창에 「스팸 검사 막힘(통신사)」 · 「검사 전」 한 줄을 더한다.

## 8. 알림톡 갈래

- read 가 `alimtalk` 이면 intake 뒤 확인 판의 종류 칸 대신 **승인 템플릿 고르기**(`/api/ai-line/alimtalk-match` = 지금 `matchAlimtalkTemplate` · 템플릿 매칭 AI 는 묶음 안 = 추가 차감 0) · 칼럼 칸 대신 `#{변수}` ↔ 칼럼(1위 고객 값).
- [알림톡으로 진행] = 기본 2만 · 대상 조건 + 고른 템플릿을 대시보드 알림톡 발송 창(`AlimtalkSendModal` · 지금 알림톡 경로 · 대체 문자 · 예약 · 분할)에 넘긴다(`sessionStorage` 넘기기 → `/dashboard` 가 명단을 받아 창을 연다).
- 맞는 승인 템플릿 0 = 「승인된 알림톡 템플릿이 없어요」 + [문자로 만들기] · 광고 의도 = [문자로 만들기] 권함.
- 알림톡 본문은 문자 스팸 검사 대상이 아니다(가짜 통과 금지 · 회색 안내).

## 9. 직접 타겟 발송 접기 (새 흐름 켠 회사 · AI 숨김 사용자 제외)

- 대시보드 버튼 → 없음(맨 위 3열) · 도움말 `?open=target-send` → `/ai-line` · 카드 상세 「직접 타겟 발송」 → 그 카드 주제로 `/ai-line` 한 줄.
- 코드 · 서버 경로(`/customers/extract`)는 남긴다(AI 숨김 사용자 · 스위치 꺼진 회사).

## 10. 0-3 영향표 (`buildFilterWhereClauseCompat` 소비처)

| 소비처 | `$1` | 결과 |
|---|---|---|
| `routes/ai.ts` recommend-target 표본 · recount-target · target-recipients · parse-briefing · sample-customer · preview-recipients | baseParams 첫 값 = companyId | 브랜드 조건이 SQL 에 들어간다 |
| `services/ai.ts` countFilteredCustomers | `[companyId]` 또는 넘긴 baseParams(첫 값 companyId) | 같음 |
| `utils/operator-audience.ts` 옛 조건 컴파일 | baseParams = `[companyId,…]` | 같음 |
| `utils/operator-performance-estimator.ts` | `$1 = companyId`(filters `$2`부터) | 같음 |
| `utils/all-customers-signal.ts` · `utils/audience-translate.ts` | 판정만(SQL 실행 없음) | 브랜드 단독 조건 = 조건 있음 |
(구현 때 각 SQL 의 별칭 · `id` 모호성까지 실측 · 결과를 §13 에 적는다.)

## 11. 스위치 · DB

- `AI_LINE_V2_COMPANY_IDS`(비면 꺼짐 · `*` = 전 회사 · `companyListAllows`). 0단계 · 대시보드 · 화면 분리는 스위치와 무관.
- DB 변경 0 · 새 표 0.

## 12. 시험

- 순수: read 판정(갈래 · 빠진 것) · 조각 출처 판정 · 키 형식 · 기본 납부 어제 키 · exactVars(빈 배열 = 변수 제거) · 종류 매핑 · 금액 계산.
- 소스 계약: 대시보드 버튼 줄 3/4/2 분기 · 헤더 무변 · `/ai-line` 라우트 · 넘기기 경로 · 단가표 3키 백 · 프론트 일치 · 모델명 0 · native dialog 0 · 줄표 0.
- 0단계: propose 가 `chargeOnlyWithTarget` · orchestrateWithAI 0명 미차감 · 허브 세기에 매장 범위 · store_code 소속 표 조건 · 사용금액 카드 = computeMonthlyUsage.
- 전체 실행 = 백엔드 vitest 전체 + tsc(백 · 프론트) + 프론트 빌드.

## 13. 실측 시나리오(배포 뒤 · 발송 · 돈)

① 사내 회사 하나를 스위치에 넣고 「기초제품 30% 할인할거야 서울사는 30대 여성에게만」 → 빠진 것(기간) 1장 → 확인 판 · 대상 수 = 직접 타겟 같은 조건 수 · 원장 `ai-line-intake` 2 한 행.
② 감성형 + 혜택강조형 · 칼럼 고객명 → 만들기 4 · 원장 `ai-line-compose` 4 한 행 · 같은 날 같은 한 줄 다시 = 기본 0.
③ 스팸 칩 → 통과/막힘 · 선불 차감 = 3사 × 1건(수동 검사와 같은 금액) · 24시간 안 같은 글 = 재사용(차감 0).
④ 1명에게 예약 발송 → 발송결과 유형 = AI 오퍼레이터.
⑤ 「…알림톡으로」 → 템플릿 고르기 → 대시보드 알림톡 창에 명단 · 템플릿.
⑥ 대시보드 이번달 사용금액 카드 = 발송 현황 금액.

## 14. 범위 밖(기록만)

- 영상 파일(Harold 제작) · 「오늘 분석 1순위」 문구 개선 · 자동 검사 결과로 AI 가 고쳐 쓰기(하지 않음 · 직접입력 보호).

## 15. 구현 기록 (10-18 밤 ~ 10-19)

### 15-1. 파일
- 백엔드 신설 = `utils/ai-line.ts`(순수 · 판정 · 키 · 금액) · `services/ai-line.ts`(read · intake · recount · proceed · compose · decorate) · `services/ai-line-spam.ts`(자동 검사 등록 · 칩 조회) · `routes/ai-line.ts`(`/api/ai-line` · 입구 = 로그인 + 오퍼레이터 허용 + 스위치).
- 백엔드 원형 이동 = `utils/sample-customer.ts`(1위 고객 행) · `utils/hub-company-context.ts`(회사 통계 묶음) · `resolveHubStoreScope`(`utils/store-scope.ts` · preview-recipients 인라인).
- 화면 신설 = `components/ai-line/AiHubBand.tsx`(남색 머리 · 탭 2칸 · 크레딧 칩) · `LineIntakeModal.tsx`(빠진 것 · 확인 판 · 금액 줄) · `LineResultCards.tsx`(카드 · 스팸 칩 · 칼럼 더 넣기 1) · `components/dashboard/DashboardActionRow.tsx` · `pages/AiLinePage.tsx`(옛 허브 입력 · 결과 원형 이동) · `utils/ai-line.ts`.
- `pages/AiOperatorPage.tsx` = 기능 12개 허브로 다시 씀(요금제 문 · `?intro` · 카드 원형 이동). 옛 넘기기 키가 있으면 `/ai-line` 으로 보낸다.
- 결과는 옛 `ProposalResponse` 모양으로 맞춰 지금 발송 경로(`preview-recipients` → `/direct-send` sendType operator)를 그대로 쓴다.

### 15-2. 설계에서 바뀐 것
- 0-3 에 **브랜드 조건 동의**를 더했다(Codex 1R): 허브 조건 해석기가 직접 타겟과 같은 `brandConsentOption` 값을 받는다. SQL 을 실행하는 소비처는 보는 사람 기준(`viewerBrandConsent` · 화면 · 승인 발송 · AI 한줄로) 또는 주인 기준(`ownerBrandConsent` · 대상 수 · 자동 마케팅)으로 넘긴다.
- 같은 원장 키의 재요청 = 프로세스 안 키 잠금(`withKeyLock` · 운영 PM2 단일 프로세스) 안에서 생성 · 정산 · 결과 확정. 정산 뒤 원장 금액을 다시 읽어 금액 ÷ 2 종류까지만 돌려주고 기억한다(24시간 · 500개). 이미 낸 시도는 잔액 확인 · 차감 0.
- AI 실패 대체 골격(`fallback:true`) = 차감 전에 502 `AI_UNAVAILABLE`.
- 자동 검사 회사 잠금 = `pg_try_advisory_lock`(못 잡으면 연결을 붙들지 않고 `busy` · 화면이 5초 뒤 다시). 재사용 = 같은 해시 · 발신번호 · 그 유형 결과 행 · 제목까지 같을 때. 1위 고객이 없으면 등록 함수와 같은 기본 고객(`loadDefaultSpamFirstRecipient`).
- **DDL 0 확정**(§7 · 시작 시각 = 워커 메모리).
- 직접 타겟 접기 = 대시보드 버튼 · `?open=target-send` · 카드 상세 「직접 타겟 발송」(스위치 켠 회사 = 그 카드 주제로 `/ai-line`).

### 15-3. Codex 적대(gpt-6-astra · 백엔드 · 화면은 범위 제외 규칙)
| 라운드 | 지적 | 처리 |
|---|---|---|
| 1R | 5건(브랜드 조건 동의 · 이미 낸 시도 재차감 · AI 실패 골격 차감 · 자동 검사 경쟁 · 재사용 유형 · 제목) | 전부 수용 |
| 2R | high 2(같은 키 재요청이 원장과 어긋남 · 세션 잠금 대기) + 범위 밖 1(기본 첫 고객) | 둘이 같은 뿌리 → 키 잠금 구조로 · try lock · 범위 밖 1 수용 · 성과 추정 브랜드 동의 = 기록만(B-1018-5) |
| 3R | 지적 0 | approve |

### 15-4. 검증
- BE tsc 0 · FE tsc 0 · backend vitest 630파일 9,198건 전부 통과(새 시험 `ai-line-1018` 35 · `ai-line-stage0-1018` 14 · 화면 분리로 옮긴 소스 계약 16개 갱신).
- 프론트 `npm run build:safe` 로컬 통과(lazy 청크 54건 실존 · 비literal 동적 import 0).
- 새 · 바뀐 화면 파일 = 모델명 0 · native dialog 0 · 사용자 문구 줄표 0.
- 미검증 = 실제 화면(1440 · 390 폭) · §13 실측 ①~⑥.

### 15-5. 배포 순서
1. 로컬 푸시(`tp-push`).
2. 서버 `git pull`.
3. 백엔드 `npm run build:safe`.
4. `packages/backend/.env` 에 `AI_LINE_V2_COMPANY_IDS` = `PLANNER_LINE_COMPANY_IDS` 와 같은 사내 4곳(값을 화면에 찍지 않고 복사).
5. `pm2 restart targetup-backend --update-env`.
6. 프론트 `npm run build:safe`.
7. §13 실측.
- 0단계 4건 · 대시보드 버튼 줄 · 화면 분리 · 카탈로그 이름(「AI 오퍼레이터」)은 스위치와 무관하게 전 회사에 바로 적용된다. 새 한 줄 흐름 · 자동 스팸 검사 · 알림톡 갈래 · 직접 타겟 접기만 스위치 켠 회사.

## 16. 1019 개편 (Harold 실화면 지적 · 스위치 삭제 · 직접 타겟 발송 삭제 · 「누구에게」)

### 16-1. 접수(Harold 1019 · 시연 회사 실화면 3장)
- 「알림톡을 활용해서 30% 할인쿠폰 만료안내」 · 「최근 30일 미구매 VIP에게 재구매 쿠폰」 → 질문 없이 분석 화면 · 문안 3개 · 알림톡인데 문구 생성 · 대상 0명인데 생성 · 스팸 검사 없음.
- 원인 = 시연 회사가 새 흐름 스위치 밖이라 옛 제안 흐름(propose)이 그대로 돌았다(`AiLinePage` 옛 갈래). 스위치에 숨긴 것은 설계(§3 · §9 · §11) 판단 잘못.
- 새 흐름도 어긋남 2: 알림톡 갈래는 묻지 않음(`readAiLine` 「알림톡 갈래는 묻지 않는다」) · 받는 사람이 없는 한 줄에 「누구에게」를 묻지 않음(확인 판 체크만).
- 대시보드 「AI 오퍼레이터」 타일 = 배지가 제목 줄에 함께 들어가 좁은 폭에서 제목이 두 줄로 깨짐.

### 16-2. Harold 결정(1019)
- 「스위치고 뭐고」 = `AI_LINE_V2_COMPANY_IDS` 삭제 · 새 흐름 = 전 회사 · AI 한줄로 화면의 유일한 흐름.
- 「직접 타겟 발송 없애라 · 이에스페이먼츠도 필요 없다」 = 대시보드 버튼 · 옛 링크 `?open=target-send`(→ `/ai-line`) · 카드 상세 버튼 전부 삭제(AI 숨김 사용자 포함). 옛 창 코드(`TargetSendModal`)는 입구 없이 남는다(정리 = 별도).
- 「중간에 타겟 추출된 내용 체크할 때 직접 타겟 선택 메뉴」 = 확인 창(누구에게 · 확인 판)에 「직접 타겟 선택」 · 지금 조건 고르기 창(`DirectTargetFilterModal`)을 고르기 모드로 재사용.
- 요금제 영향 0: AI 한줄로 = 유료 전 요금제 + 체험(`isAiOperatorAllowed`) ⊇ 직접 타겟(STARTER 이상) — 조건 발송을 잃는 회사 없음.

### 16-3. 흐름(한 줄을 읽고 모자란 것만 묻는다 · 다 모인 뒤 만들기)
1. (카톡 모호) 채널 → 2. (빠졌으면) 혜택 · 기간 → 3. (받는 사람을 못 읽었으면) **누구에게** → 4. 확인 판(알림톡 = 「어느 알림톡 템플릿으로 보낼까요?」 · 문자 = 종류 · 칼럼 · 금액) → 만들기.
- 누구에게 = `intake.needAudience`(한 줄 원문에서 온 조건 0 · 한 줄이 「전체 고객」을 말하지 않음 · `lineMentionsAllCustomers`). 답 = AI 추천 대상 · 전체 고객 · 직접 타겟 선택 · 한 줄로 더 적기(새 한 줄로 처음부터). **묻는 동안 기본 0** · 답한 뒤 만들기 · 진행에서 미납이면 같은 기본 키로 걷는다.
- 직접 타겟 선택 = 고른 조건(structured) → `toLineAudienceFilters`(나이 이상/이하/일치 → minAge/maxAge/범위 · 커스텀 칸 → `custom_fields.키` · 성별 여러 개 = 막음) → `POST /api/ai-line/retarget`(0크레딧 · 칸마다 SQL 이 실제로 나오는지 다시 봄 · 안 나오면 untranslated = 화면 잠금) → 수 · 칩 · 1위 고객 · 칼럼. 이후 만들기 · 진행 · 승인 발송 명단 = 같은 조건(`activeFilters`).
- 대상이 바뀌면 고른 칼럼 중 새 대상에서 잠긴 것은 뺀다.

### 16-4. 검증
- BE · FE tsc 0 · backend vitest 630파일 9,206건(ai-line-1018 43 · 새 8 = 전체 고객 말 · 조건 변환 · 누구에게 차감 0 · 전체 고객 말 = 차감 · 대상 바꾸기 2 · 입구 삭제 계약 · 차감 조건 계약) · 차감 조건 변이 = 시험 2건 검출.
- 프론트 build:safe 통과 · 버튼 줄 렌더 실측(빌드 CSS · 1440 · 1280 · 1024 · 768 · 640 · 390) = 제목 한 줄 · 잘림 0 · 배지 겹침 0(640 폭은 글자 15px · 화살표 숨김으로 맞춤).
- Codex = §16-5.

### 16-5. Codex 적대(gpt-6-astra · 1019)
| 라운드 | 지적 | 처리 |
|---|---|---|
| 1R | high 2(다시 세기 실패 뒤 미검증 조건 진행 · 「한 줄 대상으로」가 전체 확인 건너뜀) · medium 2(알림톡 매칭 기본 미납 409 · 옛 링크 이동 덮임) | high 2 = 같은 뿌리(화면 상태가 사람 확정 · 서버 확인 없이 「보낼 수 있음」) → 대상은 /retarget 성공 때만 확정 · 전체 = 사람이 고를 때만 · 만들기 · 진행 · 알림톡 기본에서 서버가 칸마다 SQL 확인(TARGET_FILTER_UNTRANSLATED) · 매칭이 미납이면 확정 대상 확인 뒤 기본 · 이동 뒤 return |
| 2R | high 3(매칭 실패에도 기본 · 자정 경계 이중 기본 · 늦은 응답이 최신 선택 덮음) · medium 3(진행 표시 멈춤 · 다시 열어도 재시도 안 함 · 복원 뒤 기본 표시 어긋남) | 서버 = 기본 정산 한 자리(settleBaseOnce · 한 줄 키 잠금 안에서 정산 순간 오늘 · 어제 재확인 · 네 입구 공통) · 매칭 usable 일 때만 · 화면 = 선택 버전 하나 + 진행 상태 하나 + 최신 진행에 대상 칸만 합침 · 다시 열면 오류 지움 · paid 저장 |
| 3R | medium 2(되돌린 대상에 못 쓰는 칼럼 남음 · 매칭 중 닫으면 잔액 갱신 버림) | 칼럼 = 읽는 자리 하나(usableVars)로 · 앞 라운드의 전환마다 정리 코드 삭제 · paid · 잔액은 alive 앞 |
| 4R | 지적 0 | approve |
- 검증(최종) = BE · FE tsc 0 · backend vitest 630파일 9,212건(ai-line-1018 49) · 변이 2(누구에게 차감 · 정산 재확인) 검출 · 프론트 build:safe 통과.

### 16-6. 배포 순서(1019)
1. 로컬 `tp-push`. 2. 서버 `git pull`. 3. 백엔드 `npm run build:safe`. 4. `pm2 reload targetup-backend`(ENV 변경 없음 · `AI_LINE_V2_COMPANY_IDS` 는 이제 읽지 않는다 · 넣어 두었어도 무해). 5. 프론트 `npm run build:safe`. 6. 실측: 시연 회사 「알림톡을 활용해서 30% 할인쿠폰 만료안내를 보낼거야」 → 누구에게 → 템플릿 고르기 · 「최근 30일 미구매 VIP에게 재구매 쿠폰」 → 혜택 · 기간 → 확인 판 · 직접 타겟 선택 → 받는 사람 수 바뀜 · 대시보드 버튼 3개(직접 타겟 없음) · 사내 실제 회사에서 스팸 칩.

### 16-7. 1019 실화면 2차(Harold · 계정 전환 · 문안 이중)
- 「hoyun 으로 만들고 hanjulai 로 바꿔 로그인했는데 남아 있다」 = 진행 저장 키가 하나(`ai_line_run_v1`)였고 로그아웃 때 지우지 않았다. → 키 = 회사 · 사용자(`aiLineOwner` · SNS 쓰던 글과 같은 방식) · 진행에 owner 를 적어 다르면 읽지도 저장하지도 않음 · 로그아웃 · 401 에서 `clearAiLineRuns`(진행 · 알림톡 넘기기) · 알림톡 넘기기는 같은 계정만 연다.
- 「문안이 위에도 밑에도 이중」 = 결과 카드가 본문을 그렸다. → 카드 = 종류 · 추천 · 스팸 칩 · 칼럼 더 넣기 · 직접 고치기 · 「이 문안 보기 · 보내기」만 · 본문은 아래 편집기 한 곳.
- 검증 = FE · BE tsc 0 · backend vitest 630파일 9,214건(새 2 · 주인 확인 변이 검출) · build:safe 통과. Codex = 화면 저장 · 표시만 바뀜(돈 · 발송 대상 경로 무변) → 범위 규칙상 면제.

## 17. 1020 개편 (Harold 실화면 지적 · 질문 · 칼럼 · 문자 성격별 브랜드 보이스)

### 17-1. 접수(Harold 1020 · 시연 회사)
- 「한 줄을 입력하면 부족한 정보를 묻고, 문안 생성 전에 어떤 칼럼을 개인화할지 묻는 단계를 넣으라 했는데 빠져 있다」 · 「동적으로 한 줄을 보고 부족한 것을 체크해서 물어야 한다」 · 「필요한 칼럼을 선택하게 해서 활용하게」 · 「고른 칼럼을 활용해서 문안을 만들어야 한다」.
- 「AI 메모리에 보냈던 문자를 올리면 알림성인지 마케팅성인지 체크하고, AI 한줄로에서도 이 문자가 안부인지 마케팅인지 보고, 그 성격의 브랜드 보이스(형태 · 특문)를 그대로 입혀 생성」.

### 17-2. 확인한 사실(코드 · 실측)
- 판정 시험(scratchpad 7줄): 화면 예시 4개 중 3개가 묻는 것 0 · 「최근 30일」 · 「24시간」을 행사 기간으로 읽음(`one-line-steps.ts:62`) · 「첫 구매 혜택」을 행사로 안 봄(`one-line-facts.ts:48`). 질문 = 규칙 2개(혜택 · 기간)뿐.
- 칼럼 = 확인 판 옆 칸 · 기본 0개 · 단계 아님 · 추천은 「개인화」 낱말이 있을 때만 · 후보 = 표준 칼럼만(회사 칼럼은 목록에도 없고 서버가 거절) · 고른 칼럼이 문안에 들어갔는지 검사 없음.
- 생성기 변수 안내의 「금지 예시」에 지금 표준 칼럼 이름 %고객명% · %매장명%이 들어 있음(`services/ai.ts` buildVarCatalogPrompt) = 고른 칼럼을 넣으라는 말과 금지가 함께 간다.
- 대표 문안 = 성격 판정 없음 · 가이드라인 회사당 1개(마케팅 기준) · 생성 때 한 줄 성격과 무관하게 같은 말투.
- 실측(Harold 1020): 시연 회사(한줄 뷰티(시연) · is_demo) 가이드라인 · 대표 문안 0행 = 지금 시연 회사 문안에는 브랜드 말투가 전혀 붙지 않는다.

### 17-3. Harold 결정(1020 「오케이 동의」)
1. 모자란 사실은 **AI가 그 한 줄을 읽고 판단해 묻는다**(개수 고정 없음 · 다 갖추면 0개) · 규칙은 AI가 놓친 것만 보태는 안전망 · 대상 찾기 AI 호출 한 번에 같이(추가 AI · 크레딧 0).
2. 개인화 칼럼 = **만들기 직전 단계** · 표준 + 회사 칼럼 · 1위 고객 실제 값 · AI 추천 미리 체크 · 만든 뒤 고른 칼럼이 문안마다 있는지 서버가 보고 빠지면 같은 묶음 안 꾸미기(추가 차감 0) · 그래도 빠지면 카드에 표시.
3. 문자 성격(마케팅 · 안부/알림)별 브랜드 보이스 = 올릴 때 성격 판정(가이드라인 추출 호출 한 번 · 사람이 바꿀 수 있음) · 가이드라인 성격별 2행(`main` = 마케팅 · `notice` = 안부/알림 · 유일 조건 안 · DDL 0) · AI 한줄로는 광고 여부(대상 찾기 판정 · 확인 판에서 바꿈)로 성격을 정해 그 성격 말투 · 예시만 붙인다 · 학습본이 없으면 확인 판에 한 줄.

### 17-4. 구조(묻는 목록 한 자리)
- 지금 「무엇을 묻나」가 서버 규칙(`/read` gaps) · 대상 찾기(`needAudience`) · 화면 단계 코드 세 곳에 흩어져 있었다. → 대상 찾기 응답 `asks`(AI 판단 질문 + 규칙 안전망) 한 자리 · 순수 함수 `mergeLineAsks` · 화면은 그리기만.
- 화면 단계 = `kakao`(있을 때만) → `asks`(있을 때만) → 누구에게(있을 때만) → `board`(대상 · 종류 · 성격 · 금액) → `vars`(문안 종류를 고르면 · 만들기 버튼은 여기 한 곳).

### 17-5. 영향표
| 바뀌는 것 | 소비처(grep) | 영향 |
|---|---|---|
| `recommendTarget` 한 줄 접수 옵션 프롬프트 · 출력(`copy_questions` · `copy_vars`) · 출력 한도 | 옵션 넘기는 곳 = `services/ai-line.ts` 1곳 · 옵션 없는 호출 4곳(`routes/ai.ts:480` · `ai-orchestrator.ts:408 · 811` · `crm-agency-proposal.ts:120`) | 4곳 무변(옵션일 때만 덧붙임) |
| `buildVarCatalogPrompt` 금지 예시 = 실제 변수 이름 제외 | 이 함수를 쓰는 생성 경로 전부 | 실제 있는 변수를 「금지」라 부르던 모순만 없어짐 · 없는 변수 금지 예시는 그대로 |
| `generateMessages` 새 옵션 `voiceKind` | AI 한줄로 만들기 1곳만 넘김 | 안 넘기면 지금 그대로 |
| `buildSystemPromptWithBrandVoice` 새 옵션 `kind` · 가이드라인 읽기 = `memory_key` 지정 | 호출 14곳 · 성격을 넘기는 곳 = 생성기(voiceKind 있을 때) | 안 넘기면 글자 그대로(`main` + 전체 예시) |
| 가이드라인 `LIMIT 1` 읽기 3곳 → `memory_key='main'` | `brand-voice-prompt.ts` · `brand-tone-evolution.ts` · `routes/ai-memory.ts` GET | `notice` 행이 생겨도 옛 소비처는 `main` 만 |
| 대표 문안 값에 `kind` · `kind_source` | 저장 · 읽기 · 추출 · 생성 예시 | 없는 옛 행 = 마케팅으로 읽음(지금 가정과 같음) |
| 추출 = 성격 판정 + 성격별 가이드라인 한 호출 | `routes/ai-memory.ts` extract | 차감 1 그대로 · `main` = 마케팅 문안 기준(마케팅 0건이면 안부) · `notice` 행 = 안부 문안이 있을 때만 |
| 칼럼 후보 = 표준 + 회사 칼럼(`enrichWithCustomFields` = 발송 치환과 같은 출처) · 채움 % · 1위 값 | `audienceDetail`(대상 찾기 · 대상 바꾸기) | AI 한줄로만 |
| 서버 칼럼 허용 목록 = 표준 + 이 회사 회사 칼럼 | `routes/ai-line.ts` 만들기 · 꾸미기 | 다른 회사 칼럼 이름은 거절 |
| 만들기 입력 `facts.answers` · 근거 글 「확인한 사실」 · 만든 뒤 칼럼 검사 | `runLineCompose` | 답이 있을 때만 원장 키 지문에 넣음 · 단가 · 정산 순서 무변 |

### 17-6. 시험
- 예시 문장 시험: 화면 예시 4개 + 오늘 분석 1순위 + 1018 예시 = AI 응답 고정본 → `asks` 1개 이상 · 규칙 안전망(AI가 혜택 · 기간을 놓치면 보탬) · 칩의 혜택 값 · 숫자 제거 · 줄표 제거 · 다 갖춘 한 줄 0개.
- 칼럼: 회사 칼럼 후보 · 허용 목록 · 빠진 칼럼 → 묶음 안 꾸미기 · 그래도 빠지면 표시 · 금지 예시에 실제 변수 없음.
- 브랜드 보이스: 성격 없음 = 옛 글자 그대로 · 안부 = `notice` 가이드라인 + 안부 예시 · 안부 학습본 없음 = `main` · 가이드라인 읽기 3곳 `memory_key` 지정 · 추출 응답 성격별 분리 · 옛 모양 응답 = 전부 마케팅.
- 화면 소스 계약: `vars` 단계 · 만들기 호출 1곳 · 확인 판 칼럼 목록 0 · 성격 칩 · 학습본 안내 · 모델명 0 · native dialog 0 · 줄표 0.
- 전체: backend vitest 전체 · tsc(백 · 프론트) · 프론트 build:safe · Codex 적대 approve.

### 17-7. 실측(배포 뒤 · 시연 회사)
① 「최근 30일 미구매 VIP에게 재구매 쿠폰 보내줘」 → 질문(쿠폰 내용 · 기한 포함) → 확인 판 → 칼럼 단계(고객명 + 회사 칼럼 1) → 감성형 1개 → 원장 `ai-line-compose` 2 한 행 · 본문에 고른 두 칼럼 · 미리보기 1위 고객 값.
② AI 메모리에 보냈던 문자(마케팅 · 안부 섞어서) 올리기 → 가이드라인 추출 → 문안마다 성격 칩 · 안부 가이드라인 행(`memory_key='notice'`).
③ AI 한줄로 마케팅 한 줄 · 안부 한 줄 각각 → 성격별 말투 · 특문.

### 17-8. 구현 기록(1020)
- 백엔드 = `utils/ai-line.ts`(lineRuleGaps · sanitizeAiAsks · mergeLineAsks · readLineAnswers · lineAnswersBlock · missingLineVars · lineVoiceKind) · `services/ai-line.ts`(회사 칼럼 · 허용 목록 · asks · voice · 답 · voiceKind · 묶음 안 꾸미기) · `routes/ai-line.ts`(facts.answers · 회사별 칼럼 검사) · `services/ai.ts`(대상 AI 한 줄 접수 출력 · 금지 예시 · voiceKind) · `utils/brand-voice-prompt.ts`(성격별 가이드라인 · 예시 · getBrandVoiceFit · splitBrandVoiceExtraction) · `utils/brand-tone-evolution.ts` · `routes/ai-memory.ts`(성격 저장 · 성격별 추출 한 호출 · main/notice 한 트랜잭션).
- 화면 = `utils/ai-line.ts`(asks · isAd · isAdOf · asksOf · missingVarsIn) · `LineIntakeModal.tsx`(asks · vars 단계 · 문자 성격 칩 · 말투 안내) · `LineResultCards.tsx`(빠진 칼럼 알림 · 지금 본문 기준) · `AiLinePage.tsx`(결과 화면 광고 여부 = 확인 판 성격) · `AiMemory/BrandVoiceCard.tsx`(성격 표시 · 고르기 · 안부 말투).
- 설계에서 바뀐 것: 카드의 빠진 칼럼 표시는 서버 표시 대신 화면이 지금 본문으로 계산(직접 고친 뒤에도 맞게). 그 밖 질문은 비워 두면 빼고 쓴다(혜택 · 기간만 「없이 보내기」를 고르게 함).
- 시험 = `utils/__tests__/ai-line-asks-1020.test.ts` 25건 · 전체 backend vitest 656파일 9,568건 · BE · FE tsc 0.

### 17-9. Codex 적대(gpt-6-astra · 1020)
| 라운드 | 지적 | 처리 |
|---|---|---|
| 1R | high 1(AI 질문 글이 혜택 근거로 = 질문 속 지어낸 혜택이 「확인한 사실」) · medium 3(앞 진행 답이 새 질문에 남음 · 한 성격 묶음만 와도 저장해 안부 학습 삭제 · 안부만 회사의 main · notice 복제 행을 정정이 한쪽만 고침) | 근거 = 사람이 적은 답만 · 질문은 참고 글 · 한 줄에 없는 혜택 값이 든 질문 버림 / 빠진 정보 칸 진행별 초기화 / 진실 하나(안부만 = main 하나 · 복제 행 없음) · 묶음이 빠지면 쓰기 0(`planBrandVoiceRows`) |
| 2R | medium 1(빠진 성격 판정을 「마케팅」으로 메워 저장 검사 우회) | 같은 부류 두 번째 → 판정 모르면 null · null 하나라도 있으면 거절 |
| 3R | medium 1(옛 모양 호환 분기를 AI 판정으로 충족) | 같은 부류 세 번째 → 호환 분기 삭제(묶음 = 성격 키 객체만) |
| 4R | 지적 0 | approve |
- 변이 검출 = 판정 기본값 메우기 · 질문 글 근거 포함(각 시험 빨간불 → 원본 복원 확인).
- 최종 검증 = BE · FE tsc 0 · frontend build:safe 통과(lazy 청크 54) · backend vitest 전체 · 새 시험 29건.

### 17-10. 배포 순서(1020 · Harold 「다른 세션 작업이 다 마무리되면 tp-push 로 한 번에」)
1. 로컬 `tp-push`(다른 세션 작업이 다 닫힌 뒤 · 그 시점 backend vitest 전체 통과 확인).
2. 서버 DB 확인 1건(정보 스키마 · 1행 jsonb 이어야 함): `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'custom_fields';` (회사 칼럼 채움 · 1위 고객 값 SQL 이 쓴다 · 기존 발송 · 필터 코드도 쓰는 칼럼이지만 규칙대로 확인).
3. 서버 `git pull` → 4. 백엔드 `npm run build:safe` → 5. `pm2 reload targetup-backend` → 6. 프론트 `npm run build:safe`.
7. 실측 = §17-7 ①~③(시연 회사 · 브랜드 보이스는 AI 메모리에 보냈던 문자 올리기부터).
