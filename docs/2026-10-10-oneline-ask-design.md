# 한 줄 묻기 · 추천 설계 · 2026-10-10

> 소유 = 이 문서. 관제 포인터 = STATUS C26 · SOT-INDEX §1.
> 경위: Harold님 「여정 한 줄에 '지금 가장 효율 좋을 여정이 뭐야?'라고 물으면 추천해 주듯이, 다른 한 줄 입력창에도 추천하거나 AI 가 필요한 정보를 묻는 기능을 입히고 싶다 · 브레인스토밍해서 완벽한 방법을 보고」 → 5역할 회의(1차 · 교차 1회 · 회의론자 최종 조건부 9개) → 「추천대로 승인, 설계서 쓰고 구현까지 · 코덱스 닫힐 때까지」.

## 0. 한 줄 요약

한 줄 입력창이 **명령이면 지금처럼 만들고, 질문이면 우리 회사 데이터로 답하고(0크레딧 · 아무것도 만들지 않음), 고르면 1클릭으로 만든다.** 질문/명령 판정은 코드 규칙(AI 0 · DB 0), 답의 숫자 · 근거는 이미 있는 DB 집계만, 모자란 정보는 기존 되묻기 장치가 묻는다.

## 1. 결정 (Harold 승인 1010)

| # | 결정 | 근거 |
|---|------|------|
| D1 | 판정 = 서버 순수 함수 `oneLineIntent`(AI 0 · DB 0) · 애매 · 실패 = 만들기(오늘과 같음) | 기존 흐름 무변 · 비용 0 |
| D2 | 「추천해서 만들어 줘」 같은 섞인 문장 = **답(카드)** — 사람이 고른다 | 바로 만들면 생성 AI 가 문장만 보고 시작 사건을 고른다(「데이터가 정한다」 위반) |
| D3 | 휴면 기회 규모 단위 정정 승인 — 영향 = 여정 기회 카드 순서 · 지도 빈 곳 찾기 · 자동 마케팅 오늘의 추천 입력 | 지금은 휴면만 평생 누적이라 늘 1위(틀린 추천) |
| D4 | 판정은 **각 화면의 입구에서만** · 생성 함수 · 생성 서버 경로 0변경 | 생성 함수를 부르는 곳이 여럿(여정 8곳) — 안에 두면 다시 만들기 등이 깨진다 |
| D5 | 답 처리기 = **메뉴별 서버 경로 안**(그 메뉴의 권한 문을 그대로) · 조립 = CT 한 곳 | 메뉴마다 문이 다르다(여정 · 자동 = AI Operator · DM = 모바일 DM 요금제 · 이메일 · 인앱 = CDP · SNS = SNS 요금제 + 회사 스위치) |
| D6 | 화면 = 입력창 부품(ZoneCommand · ZoneFrame) 0변경 · 답은 기존 강조 카드 자리 1장 | 0930 「입력 한 줄만」 결정 유지 |
| D7 | 「효율」을 예측하지 않는다 → 「지금 데이터로 본 가장 큰 빈 구간」 + 「효과는 켠 뒤 성과리포트에서 재요」 | 전환율 추정 상수 금지 |
| D8 | 회사 스위치 `ONE_LINE_ASK_COMPANY_IDS`(비면 꺼짐 · `*` = 전 회사) · 한 줄 보강 스위치와 분리 | 단계 개방 |

## 2. 판정 규칙 (`utils/one-line-facts.ts` `oneLineIntent`)

판정 대상 = 사용자가 친 글자만(사진에서 읽은 조각은 뺀다 · `applyLineReads` 와 같은 경계).

1. 빈 줄 · 2자 미만 → make
2. 구체 혜택 값(`hasConcreteBenefit`) 또는 주소(http · www) → make
3. 만들기 동사 요청(만들 · 보내 · 써 · 작성 · 생성 · 띄워 · 짜 · 불러와 · 돌려 + 줘 · 주세요 · 줄래 · 주실래요 · 줄 수 있 · 주시겠) → make — **단 추천 동사(추천해 · 추천하 · 골라)가 같은 문장에 있으면 ask**(D2 · 「추천 상품」 같은 이름말은 동사가 아니다)
4. 추천 요청(추천 · 골라 · 알려 + 해/줘/주세요/줄래 끝) → ask
5. 질문 끝맺음(줄 끝 12자 안: ? · 뭐야 · 뭘까 · 좋을까 · 할까 · 해야 해 · 될까 · 돼? · 어때 · 있을까 · 낫나 · 나을까) **과** 질문 단서(뭐 · 뭘 · 뭔 · 무엇 · 무슨 · 어떤 · 어느 · 어떻게 · 왜 · 언제 · 얼마나 · 몇 · 가장 · 제일 · 추천 · 골라)가 함께 → ask
6. 그 밖 → make

`askTopic`: ask 이고 「어떻게 · 방법 · 설정 · 연동 · 어디서」가 있으면 `how`(도움말 답) · 그 밖 `what`.

**표 테스트(고정)**: 7메뉴 placeholder · 여정 기회 골격(suggestedObjective) · 이어달리기 골격 · 진단 계획 objective = 전부 make / Harold 원문 · 「이번 주에 뭐 보내면 좋을까」 · 「여정 추천해 줘」 · 「어떻게 하면 휴면 고객 부를 수 있을까」(how) · 「추천해서 만들어 줘」 = ask / 「추천 상품 넣어서 DM 만들어 줄래?」 = make(「추천」이 이름말) / 「어떤 니트가 좋을까? 가을 신상 3종 첫 구매 10%」 = make(혜택 값).

## 3. 계약

### 3-1. 판정 전달 — 기존 `POST /api/ai/one-line/gaps`(AI 0 · DB 0) 응답에 칸 추가

`ask_enabled: boolean` · `intent: 'ask' | 'make'`(스위치 밖 = 늘 make) · `ask_topic: 'what' | 'how' | null`. 기존 칸 무변.

### 3-2. 답 — 메뉴별 경로(ask 일 때만 화면이 부른다 · 0크레딧 · AI 0)

| 메뉴 | 경로 | 문 |
|------|------|----|
| 여정 | `POST /api/ai/operator/journeys-ask` | isAiOperatorAllowed |
| 자동 마케팅 | `POST /api/ai/operator/continuous-ask` | isAiOperatorAllowed |
| 인앱 | `POST /api/cdp/inapp/ask` | ensureInAppAccess(관리자 · CDP) |
| 모바일 DM | `POST /api/dm/one-line/ask` | dmRouter(모바일 DM 요금제) |
| 이메일 | `POST /api/email/one-line/ask` | ensureEmailAccess |
| SNS | `POST /api/sns/one-line/ask` | SNS 라우터 문 |

요청 `{ line }` · 스위치 밖 = 404 `FEATURE_DISABLED`. 응답:

```
{ success, answer: {
    head: string,                       // 코드 틀 문장(AI 0)
    basis: { scope: 'mine' | 'company', at: ISO, note?: string },
    cards: [{ key, title, count: number|null, countNote?: string, why: string, notices?: string[],
              action: { kind: 'journey'|'auto'|'inapp'|'fill'|'open', objective?, preferTriggerEvent?, line?, path?, brief? } }],
    blocked: [{ title, reason }],      // 못 하는 것 · 무엇을 주면 되는지(서버 사유 그대로)
    failed: string[],                   // 읽지 못한 출처(「없음」과 구분)
} }
```

비용 표시는 화면이 그 화면의 단가표(`AI_GENERATE_COSTS` · `line.credit`)에서 읽는다(숫자를 서버 · 화면 두 곳에 적지 않는다).

### 3-3. 메뉴별 답 조립(`utils/one-line-ask.ts` · CT 한 곳)

| 메뉴 | 카드 근거 | 접는 것 | 막힘 줄 |
|------|-----------|---------|---------|
| 여정 | 여정 기회(인원 · 관련 매출 규모 · 담당자 범위) | 켜진 · 초안 · 멈춤이 있는 시작 사건 · 시작 사건 없는 카드(찜) | 진단 계획 locked 사유 · 담당 매장 미배정 · 고객 0명 |
| 자동 마케팅 | 최신 오늘의 추천(저장분 · 날짜 표시) — 담당자에겐 숫자 없이 제목 · 목표만 | — | 추천 없음 · 하루 지남 = 사유(유료 요금제 · 매일 아침 · 크레딧) |
| 인앱 | 장바구니 · 둘러보기 사건 가능 여부(availability) + 장바구니 인원 | — | 사건 수집 전 = 사유 |
| DM · 이메일 · SNS | 같은 기회 엔진의 일회성 후보(장바구니 · 휴면 · 생일 · 재구매 · 가입) → 한 줄 뼈대(혜택 없음) | — | 근거 없음 = 정직한 빈 답 |

카드 1클릭 = **그 화면의 기존 함수**(여정 `handleAIGenerate(undefined, objective, preferTriggerEvent)` · 자동 `handleBriefStart` · 인앱 한 줄 생성 · DM · 이메일 · SNS = 한 줄에 뼈대를 채워 기존 만들기 → 혜택은 기존 확인 창이 묻는다). DM · 이메일 카드 인원 문구 = 「지금 이런 고객이 N명 · 문안을 만들고 대상은 보낼 때 골라요」(받는 사람 수가 아님).

### 3-4. 되묻기(모자람) — 새 엔진 0

DM · 이메일 = 혜택 · 몰 상품 확인 창(C24) · 자동 마케팅 = 대상 번역 고르기 · 여정 = 혜택 자리표시 + 발송 관문. 답 → 한 줄 채우기 → 기존 되묻기.

## 4. 0단계 — 답을 내기 전에 고칠 것

1. **기회 규모 단위**(`journey-opportunities.ts`): 휴면 · 장바구니 · 재구매 규모 = 1인 1회 구매액 합(`SUM(COALESCE(avg_order_value, recent_purchase_amount, $4::numeric))` · `$4` = 회사 중앙 구매단가 · 찜 · 가입 · 생일과 같은 축) · 휴면 설명 문장 「누적」 = 새 칸 `dorm_total`(평생 누적 `SUM(total_purchase_amount)`).
2. **담당자 범위**: `buildJourneyOpportunities(companyId, ownerUserId?)` — 첫 줄에서 `getOwnerCustomerScopeSql(companyId, ownerUserId, 'c')` 를 구해 집계(`FROM customers c` · 이어달리기 전환 `WHERE TRUE${scopeSql}`)에만 붙인다(관리자 · 분류 없는 회사 = 빈 조각 = SQL 바이트 동일). 리듬 · flowPlan · recoPlanFor 는 회사 전체 그대로(캐시 키 · 결정적 요청 키). 라우트는 `req.user?.userId` 를 넘기고 일일 브리핑 워커는 인자 없이(회사 전체).
3. **오늘의 추천 보여 주기 CT**(`daily-brief-policy.ts` `briefForViewer`): 저장분을 내보내는 세 곳(GET daily-brief · self-diagnosis · 한 줄 답 자동 마케팅)이 같이 쓴다. 담당자 = 7칸을 골라 담는다(펼쳐 담지 않음) · 머리 문장 · 이유 · 숫자 숨김 · 제목 · 목표에 숫자가 있으면 같은 행 신호의 코드 뼈대(제목 · 권장 목표)로 바꾸고 뼈대가 없으면 그 추천을 뺀다(Codex R1). 관리자 = 이유 · 머리 문장의 숫자를 같은 행 signals 와 `findNewNumbers` 로 대조해 지어낸 숫자가 있으면 비운다.
4. **리듬 null 캐시 금지**: 구매 데이터가 없을 때(null)는 24시간 캐시에 넣지 않는다(연동 직후 하루 동안 「연동하세요」가 남지 않게).

## 5. 화면

- 훅 `useLineAsk`(utils) — 입구 제출을 감싼다: 스위치 켜짐 → `fetchOneLineGaps` 로 판정(판정 중 busy) → make = 원래 제출 · ask = 메뉴 답 경로 → 답 상태. 답 조립 실패는 자동 만들기 금지(「읽지 못했어요」 + 탈출구).
  - 판정을 시작할 때 옛 답을 닫는다 · 판정을 기다리는 동안 같은 화면에서 바로 생성하는 버튼(여정 기회 · 다음 수 · 오늘의 추천 · 인앱 빠른 시작)은 `judging` 으로 잠근다(Codex R1 · 판정 뒤 두 번 생성 방지). DM · 이메일은 판정 응답을 받은 뒤 부르고 그 대기는 기존 `lineCheckingRef` 가 막는다.
  - 사진에서 읽은 글 조각은 훅이 기억했다가(`noteRead`) 판정 요청에 실어 판정에서 뺀다(인앱 · DM · 이메일은 자기 조각을 gaps 로).
- 부품 `LineAnswer`(components/zone) — `ZoneEmphasis kind="ai"` 껍데기: 제목 = 물으신 문장 · meta = 「0크레딧 · 아무것도 만들지 않았어요 · 내 담당 고객 기준 / 회사 전체 · 기준 시각」 · 머리 문장 · 카드 ≤3(이름 · N명 · 근거 · 고지 · [이걸로 만들기 · N크레딧]) · 막힘 줄 · 바닥 「질문이 아니었나요?」 [이 문장 그대로 만들기 · N크레딧] · [닫기].
- 답이 열린 동안 그 화면의 강조 자리를 대체한다(시작 카드는 답 카드가 1장 이상일 때만 숨김).
- 입구: 여정 = 한 줄 제출 · 지도 `?objective=` 자동 경로 · 자동 마케팅 = 한 줄 제출 · 인앱 = 시작 화면 · 채널 화면 한 줄 · DM · 이메일 = 한 줄 제출(startOneLine) · SNS = 한 줄 제출(ask 면 줄을 비우지 않는다).

## 6. 하지 않은 것 (보류 · 범위 밖)

- 보류: AI 판정기 · AI 가 고르는 추천 · 5크레딧 근거 분석 · 대화형 후속 질문 · 입력창 질문 예시 표시(판정 로그가 쌓인 뒤).
- 만들기(재료 읽기)는 판정하지 않는다.
- 범위 밖 기록(BUGS B-1010-12~15): 진단 창 DRAFT_ALREADY_MADE 막다른 길 · 지도 · 규칙 기반 진단 숫자가 담당자에게도 회사 전체 · 찜 카드가 켜진 여정과 대조되지 않음 · 여정 출처 문구 내부 표 이름.

## 7. 영향표 · 구현 기록 · Codex

### 7-1. 영향표 (바꾼 공용 함수 → 소비처 전수 grep · 1010)

| 바꾼 것 | 소비처 | 영향 |
|---|---|---|
| `buildJourneyOpportunities(companyId, ownerUserId?)` 단위 · 범위 | `routes/ai.ts` `/operator/journeys-opportunities`(userId 넘김) · `company-daily-brief.ts` 워커(인자 없음 = 회사 전체) · `one-line-ask.ts` 3곳 · 테스트 `journey-succession-opportunity.test.ts` | 관리자 · 분류 없는 회사 = scopeSql 빈 조각 = SQL 바이트 동일 · 규모 숫자만 1회 구매액 축으로 바뀜(순위 정정 = D3 승인) |
| `briefForViewer` (신규 CT) | `/operator/daily-brief` · `/operator/self-diagnosis` · `buildAutoAsk` | 담당자 = 7칸 골라 담기 · 관리자 = 지어낸 숫자 문장만 비움 · 화면 타입(`DailyBriefRecommendation`)과 칸 같음 |
| `/one-line/gaps` 응답 칸 추가 | `fetchOneLineGaps` 호출 4곳(훅 · DM · 이메일 · `one-line.ts` 스위치 읽기) | 칸 추가만 · 기존 칸 무변 · 스위치 밖 = `intent: 'make'` |
| `applyLineReads` → `lineReadSpans` 분리 | `ai.ts` gaps · `dm.ts` · `email.ts` 생성 | 구간 계산을 함수로 뺀 것뿐(동작 동일 · 기존 시그니처 계약 테스트 통과) |
| `loadDiagnosisFacts` null 캐시 금지 | `journey-opportunities.ts` 내부 2곳 | 리듬 있을 때만 24시간 캐시 |
| 화면 6곳 입구 | 여정 2(한 줄 · `?objective=`) · 자동 1 · 인앱 2 · DM · 이메일 · SNS 각 1 | 생성 함수 본문 0변경(잠금 테스트) · 판정 대기 동안 바로 생성 버튼 잠금 |

### 7-2. 구현 파일

- 백엔드: `utils/one-line-facts.ts`(판정 · 스위치 · 조각 빼기) · `utils/one-line-ask.ts`(신규 CT · 답 조립) · `utils/journey-opportunities.ts`(0단계 ① ② ④) · `utils/daily-brief-policy.ts`(`briefForViewer`) · `routes/ai.ts`(gaps 칸 · journeys-ask · continuous-ask · daily-brief · self-diagnosis · journeys-opportunities) · `routes/cdp.ts` · `routes/dm.ts` · `routes/email.ts` · `routes/sns.ts`(각 `/…/ask`)
- 프론트: `utils/one-line.ts`(타입 · 경로 · `fetchLineAnswer`) · `hooks/useLineAsk.ts`(신규) · `components/zone/LineAnswer.tsx`(신규) · `constants/credit.ts`(여정 · 인앱 단가 키) · 6개 화면 연결
- 테스트: `utils/__tests__/oneline-ask-1010.test.ts` 22건(판정 표 · 답 조립 · 보여 주기 CT · 문 · 입구 · 0단계 SQL 문자열) · `hanjul-signature-ui-1005.test.ts` 1줄 갱신(DM gaps 호출에 메뉴)
- DDL 0 · 새 ENV `ONE_LINE_ASK_COMPANY_IDS`(비면 꺼짐 · `*` = 전 회사 · 쉼표 명단)

### 7-3. Codex 적대 리뷰 (gpt-6-astra)

- R1 needs-attention 5건(high 3 · medium 2) 전부 수용: ① 자동 마케팅 카드 비용 = 늘 AI 비용(카드는 `handleBriefStart` = AI 고정) ② 담당자 제목 · 목표 숫자 = 칸 골라 담기 + 코드 뼈대 대체(차단 목록 → 허용 목록) ③ 판정 대기 중 다른 생성 입구 = 판정 시작에 옛 답 닫기 + 바로 생성 버튼 `judging` 잠금 ④ 초안 확인 실패 = 여정 카드 0 + 「만든 여정 초안」 읽지 못함 ⑤ 인앱 사진 조각 = 훅 `noteRead` 로 판정에서 뺌.
- R2(고친 줄 + 직접 호출부만) approve · 지적 0 → 종결.

### 7-4. 실측 (빌드 CSS + 헤드리스 브라우저 · 1010)

- `build:safe` 통과(lazy 청크 51 실존 · 동적 import 게이트 0).
- `LineAnswer` 7상태(여정 3카드 · 긴 질문 · 내용 2카드 · 빈 답 · 읽는 중 · 오류 · 사용법) × 6폭(390 · 820 · 1100 · 1280 · 1440 · 1920) = 42건 전부 가로 넘침 0 · 버튼 높이 36 고정(줄바꿈 0) · 820 이상 카드 높이 · 버튼 바닥선 일치 · 390 = 1열. 한국어 문장 단어 중간 끊김 → `break-keep` 반영 후 재측정.
- 남은 실측(배포 뒤 · Harold): 스위치 켠 회사에서 6메뉴 질문 1건씩 · 명령 문장이 지금처럼 만들어지는지 1건씩.
