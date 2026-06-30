# 문안 퀄리티 강화 + 브랜드보이스 점검 — 설계서

> 2026-06-30 작성. **이번 세션 = 코드 감사 + 설계 확정. 구현은 다음 세션(문안 전용)에서.** Harold 명시.
> 제약 0번: AI는 구체 혜택(%·원·쿠폰·무료)을 지어내지 않는다([[feedback_ai_no_arbitrary_benefit]]). "강화"는 혜택 날조가 아니라 후크·앵글·톤·브랜드보이스·구조·개인화·검증된 패턴에서 나온다. **단, 회사가 넣은 실제 혜택은 강하게 강조한다.**

## 0. 목표
- 핵심 문안 생성을 꾸미기·다듬기 격상(꾸미기 3크레딧)에 맞는 수준으로 끌어올린다.
- "최근 브랜드보이스가 고장났다" 신고를 코드/데이터로 진단하고 수정 설계를 확정한다.
- AI Operator 메인 제안도 같은 강화 파이프라인을 타게 한다.

## 0.5 확정 결정 요약 (2026-06-30 대화 — 다음 세션 이대로, 토씨 변경 금지)

**입력 두 갈래 (풍성도 핵심)**
- 혜택 자연어 입력 O → 그 혜택을 후크·CTA 주인공으로 강조 극대화. SMS/LMS = 텍스트 강조(【】·▶·줄바꿈, 이모지 금지), DM·이메일·인앱 = 시각 강조(크게·굵게·색·배지).
- 혜택 입력 X → 혜택 날조 0(`[직접 작성]`). 계절감·해당 월 특성·시의성·앵글로 문안 자체를 풍성하게.

**회사 격리 게이트 (게이트 = 브랜드보이스 등록 여부)**
- 등록 회사 → 철저히 자기 것만(자기 대표문안 10건 + 자기 과거 문안 RAG). 타사 0.
- 미등록 회사 → 같은 업종(industry_code) 보강. 단 원문 X, `message_features`(구조·통계)만 → 타사 시그니처 절대 누출 0.
- 대표문안 5건 → 10건 (등록 화면·LIMIT·저장 상한 모두).

**꾸미기 컬럼 체크 정합**
- 생성된 문안에 쓰인 `%변수%` = 칩 자동 체크.
- 추가 체크/해제 → 꾸미기 시 체크된 건 무조건 반영, 해제된 건 본문에서 제거.
- 3개 문안 변형 전부 동일 적용. 꾸미기 1회(3개 처리) = 3크레딧.

**브랜드보이스 고장 수정**
- 원인 확정(데이터): 가이드라인 2사·대표문안 2사·가이드라인만 1사 → AND 조건 무증상 OFF 실재. 코드 fix(데이터 문제 아님).
- `brand-voice-prompt.ts:174` AND 완화(가이드라인만 있어도 작동) + OFF 상태 사용자 가시화.

**생성 품질**
- 멀티패스 자가비평(추가 차감 0) · 앵글 다양화 · 채널 분리(SMS 밀도 / LMS·DM·이메일·인앱 풍성) · AI Operator propose도 동일 파이프라인.

**불변(절대 깨지 말 것)**
- 혜택 날조 금지 · 크레딧(문안 5·꾸미기 3·다듬기 1) 그대로 · 모델명 UI 0 · EUC-KR sanitize · 회사 격리(company_id).

## 1. 현황 감사 (코드 기준 사실)

### 1-1. 학습 (전체 문안 학습 — 가동 중)
- `training-logger.ts logCampaignTraining` → `logTrainingData` : 모든 발송(직접·자동·여정, `createDirectSendCampaign`·`journey-executor` 공통 길목)을 `ai_training_logs`에 **비식별 적재**. 마스킹: 브랜드명 `{brand}`, 전화 `{phone}`, 금액·% `{amount}`, URL `{url}`, 이메일 `{email}`. source_ref = HMAC(campaignId) 멱등.
- `updateTrainingMetrics` : 결과 동기화 시 sent/success/fail 갱신 = **성과 라벨**.
- `copy-rag-retriever.ts retrieveCopyExamples` : 생성 직전 그 회사(tenant_ref) 문안 **성과순** 검색, 5건 미만이면 같은 업종 패턴 보강, 합계 3건 미만이면 빈 결과(가짜 0).
- **관찰**: 코퍼스가 마스킹돼 RAG 예시엔 `{amount}`만 — RAG는 **구조·톤·후크 패턴**을 가르치지 실제 혜택 문구는 주지 않는다. ⇒ 혜택 강조는 RAG가 아니라 **현재 입력의 실혜택**을 잡는 별도 로직이어야 함.

### 1-2. 생성 (copy-prompt-composer + brand-voice-prompt — 단발)
- `copy-prompt-composer.ts composeCopyBrain` : RAG 예시(회사 참고 / 업종 복제금지) + 시의성(`copy-context`) + 브랜드 킷(signature_locked·slogans·required/banned words)을 **프롬프트 suffix**로 합성.
- `brand-voice-prompt.ts buildSystemPromptWithBrandVoice` : `ai_company_memory`의 `brand_guideline`(톤 시그니처·평균 길이·빈출 표현·CTA·시그니처·이모지 화이트리스트) + `representative_message` 5건 few-shot을 시스템 프롬프트에 prefix. 호출부 = `services/ai.ts` generateMessages(1171)·generateCustomMessages(2156)·refineDirectMessage(3031) + `email-ai.ts`(4곳) + `journey-ai-generator.ts`(3곳).
- **약점 3**:
  1. **혜택 강조 로직 0** — 사용자가 넣은 실혜택을 후크/CTA에 띄우라는 지시가 어디에도 없음. (가장 큰 구멍)
  2. **단발 생성** — 초안 한 번이 끝. 자가 비평·정정 루프 없음.
  3. **브랜드보이스 = 가이드라인/단어 수준** — 톤 형용사·문장 리듬·do/don't 깊이는 얕음.

### 1-3. 브랜드보이스 "고장" 진단 (핵심)
- **고장 모드 1 — 무증상 OFF**: `brand-voice-prompt.ts:174` `if (!data.guideline || data.messages.length === 0) return basePrompt;`. **가이드라인 AND 대표문안 5건이 둘 다 있어야** 작동. 하나라도 없으면 brand voice가 **에러 없이 조용히 빠짐**. 대표문안을 안 채웠거나 지운 회사 = 무증상 OFF. "작동 안 함" 신고 1순위.
- **고장 모드 2 — 전 경로 silent degrade**: DB 조회 실패·JSON 파싱 실패(96–99)·데이터 누락 어디서 끊겨도 사용자에게 **아무 신호 없이** basePrompt로 떨어짐. 시스템은 OFF 상태를 모르고 사용자는 "왜 안 되지"만 남음.
- **저장↔읽기 일치 확인됨**: 저장(`ai-memory.ts` 489·674·784, memory_key='main') ↔ 읽기(`brand-voice-prompt.ts` 79·85) = 같은 테이블·타입. **스키마 mismatch는 아님** → 고장은 코드 분기(AND) 또는 데이터 누락 둘 중 하나.
- **두 시스템 공존**: composeCopyBrain(킷)과 buildSystemPromptWithBrandVoice(가이드라인+few-shot)가 둘 다 `ai_company_memory`/`getBrandGuideline`을 읽음 — 중복·역할 경계 정리 필요.

## 2. 강화 설계 A — 문안

### A1. 입력에 따른 두 갈래 (Harold 명시 2026-06-30 — 풍성도 핵심 엔진)

**갈래 1 — 혜택을 자연어로 입력한 경우 → 강조 극대화**
- 구체 혜택 토큰 감지(`\d+%`·`\d+원`·`N+N`(1+1)·반값·무료배송·사은품·쿠폰·적립 등).
- 후크·CTA에 **주인공으로 배치**, 메시지를 혜택 중심으로 구성.
- SMS/LMS = 텍스트 강조(첫 줄 후크·【】·▶·줄바꿈, 이모지/특수문자는 EUC-KR 제거되니 금지).
- 모바일 DM·이메일·인앱 = 시각 강조(혜택 숫자 크게·굵게·색·배지/하이라이트 블록).

**갈래 2 — 혜택 입력이 없는 경우 → 시의성으로 풍성**
- 혜택 날조 0(`[직접 작성]` 골격). 대신 **계절감·해당 월 특성·시즌 이벤트·요일/시간 맥락·앵글 다양화**로 문안 자체를 풍성하게.
- `copy-context`의 temporal/industry-events를 **혜택 없을 때 한정으로 적극 활용 격상**. 현재의 "억지로 끼워넣지 마세요"(소프트 참고)는 혜택 있을 때만 유지.
- 위치: `copy-prompt-composer.ts buildCopyBrainPrompt`에 입력 분기(혜택 有/無) 추가 + 채널 분기.

### A2. 멀티패스 자가 비평
- 단발 → **초안 생성 → 자가 비평 → 정정 1회**. 비평 기준: 후크 강도 / 혜택 노출(있으면 주인공인가) / 브랜드보이스 일치 / 채널 한도(SMS 90byte 밀도). 비용 = 문안 5크레딧 그대로(멀티패스가 5를 정당화 — 추가 차감 X, 한 번의 생성 안에서).
- 위치: generateMessages·generateCustomMessages 흐름 안에서 2-pass(같은 호출, creditCost 변동 0).

### A3. 앵글 다양화
- variant 생성 시 각 안을 **다른 각도**로: 감성 / 긴급(마감·한정) / 스토리 / 혜택강조 / 실용. 사용자가 톤 고르게.

### A4. 채널 분리
- SMS = **밀도**(90byte 안에 후크+혜택+CTA 압축, 길이 아님). LMS·모바일DM·이메일·인앱 = **풍성**(섹션·구조·시각 강조). composer가 channel별로 분기.

### A5. AI Operator 메인 통합
- propose(`ai-operator-propose`)의 메시지 생성이 generateMessages(brand voice·copy-brain 적용)를 타는지 **구현 1단계 확인**. 별도 경로면 동일 강화 파이프라인(A1–A4 + brand voice)으로 통합.

### A6. 회사 격리 게이트 (대화 확정 2026-06-30)
- **게이트 = 브랜드보이스 등록 여부**(대표문안/가이드라인 존재).
- **등록 회사** → 철저히 자기 것만: 자기 대표문안 **10건**(5→10) + 자기 과거 문안 RAG. 타사 0. (`ai_company_memory`는 이미 company_id·캐시키 격리 — 구조적으로 안전.)
- **미등록 회사** → 같은 업종(industry_code) 집단 패턴으로 풍성. 단 **원문 문장이 아니라 `message_features`(평균 길이·CTA 유형·후크 길이·문장 수) 구조·통계만** 전달 → 타사 시그니처 누출 0(Harold "절대 금지"). 같은-업종 원문은 프롬프트에 넣지 않는다(현재 raw 문장 주입 → 구조·통계로 교체).
- 업종 커버리지 확인(2026-06-30 운영 PG): 76사 중 66 설정(미설정 10 = 미사용사). fashion 22·beauty 17·edu 7·sports 6 등 같은-업종 표본 충분.
- 대표문안 5→10: `brand-voice-prompt.ts` LIMIT 5→10 + 등록 화면(AiMemoryPage) 10건 허용 + 저장 경로 상한.
- `copy-similarity-guard` 출력 복제 차단이 실제 생성 출력에 걸려 있는지 **구현 1단계 확인**(시그니처 2차 안전망).

### A7. 꾸미기 — 컬럼 체크 정합 (대화 확정 2026-06-30 · 풍성화 일부)
꾸미기도 풍성화 대상. "활용 가능 컬럼" 칩의 체크 상태 = 문안에 넣을 변수의 **정확한 집합**.
1. **자동 체크** — 생성 직후 메시지(들)에 이미 쓰인 `%변수%`를 감지해 해당 칩을 자동 체크 표시.
2. **토글 = 정확한 타겟** — 사용자가 추가 체크/해제 → 꾸미기 시 **체크된 변수는 전부 반영(없으면 자연스럽게 추가), 해제된 변수는 본문에서 제거.** (현재 decorator의 "모든 변수를 억지로 넣지 말고 자연스러운 곳에만 선택적으로"를 **"체크 집합 정확 반영"**으로 교체 — 체크=무조건 포함, 해제=삭제.)
3. **3개 문안 전부 적용** — 꾸미기는 단일 메시지가 아니라 생성된 3개 변형 전부에 동일 컬럼 집합 적용.
- 크레딧: 꾸미기 1회(3개 변형 처리) = 3크레딧(액션 단위, 변형당 차감 X).
- 위치: `operator-message-decorator.ts` — 단일 message → 3개 배열 처리 + `selectedVars`를 add/remove 정확 집합으로(프롬프트 규칙 교체). 프론트(AiOperatorPage·JourneysPage) — 칩 체크 상태 = 사용 변수 자동 반영 + 토글 + 꾸미기 호출 시 체크 집합 전달.

## 3. 브랜드보이스 점검·수정 B

### B1. 데이터 확인 (코드 전에 — Harold 실행 SQL)
운영 PG에서 "guideline은 있는데 대표문안이 없어 무증상 OFF"인 회사 수를 먼저 본다(코드 버그 vs 데이터 누락 가름):
```sql
SELECT
  (SELECT COUNT(DISTINCT company_id) FROM ai_company_memory WHERE memory_type='brand_guideline')                       AS guideline_회사,
  (SELECT COUNT(DISTINCT company_id) FROM ai_company_memory WHERE memory_type='representative_message')                AS 대표문안_회사,
  (SELECT COUNT(*) FROM (
     SELECT company_id FROM ai_company_memory WHERE memory_type='brand_guideline'
     EXCEPT
     SELECT company_id FROM ai_company_memory WHERE memory_type='representative_message'
   ) t)                                                                                                                AS 가이드라인만_대표문안없음;
```
`가이드라인만_대표문안없음` > 0 이면 그 회사들이 바로 무증상 OFF 피해자.

**실행 결과(2026-06-30 운영 PG):** 가이드라인 2사 · 대표문안 2사 · **가이드라인만 1사**. 브랜드보이스 데이터 있는 3사 중 **실제 작동은 1사뿐**(나머지 2사 무증상 OFF). 고장 = 데이터가 아니라 **코드 AND 조건** 확정 → B2-1 AND 완화로 fix. 업종 커버리지도 확인: 76사 중 66 설정(미설정 10=미사용사).

### B2. 수정 설계
1. **AND 조건 완화** — 가이드라인만 있어도(대표문안 0이어도) brand voice 작동: few-shot 없이 가이드라인+RAG로 톤 적용. (line 174를 `if (!data.guideline) return basePrompt;`로 — 대표문안은 있으면 보강, 없으면 생략.)
2. **OFF 상태 가시화** — brand voice가 적용 안 되면(가이드라인 없음 등) 생성 응답 메타에 `brandVoiceApplied: false` + 사유. 프론트는 "브랜드보이스 미설정 — 설정하면 문안이 우리 톤으로" 안내(silent degrade 종결).
3. **두 시스템 경계 정리** — buildSystemPromptWithBrandVoice(가이드라인·few-shot·톤) = "보이스", composeCopyBrain(RAG·시의성·킷) = "두뇌". 한 생성에서 둘 다 붙되 역할 중복(시그니처 2번 등) 제거.
4. **깊이 강화(A3 후속)** — 가이드라인에 톤 형용사·문장 리듬·do/don't 추가 추출(추출기 강화는 별도 항목).

## 4. 크레딧·안전 정합
- 문안 5 / 꾸미기 3 / 다듬기 1 그대로. 멀티패스는 한 생성 안 2-pass(추가 차감 0).
- 혜택 날조 금지 유지. 멀티패스·혜택강조 모두 fail-safe(실패 시 기존 단발로 degrade, 발송 영향 0).
- 모델명 UI 0 / EUC-KR sanitize 정합 / 회사 격리(company_id) 유지.

## 5. 미확정 → 구현 1단계 확인
- **AI Operator propose의 메시지 생성 경로**(generateMessages 통과 여부) — A5의 핵심.
- B1 SQL 결과(무증상 OFF 회사 수) — 코드 vs 데이터 가름.
- 혜택 감지 정규식 오탐/누락 범위(예: "반값", "1만원대").
- 멀티패스 2-pass의 모델·토큰 비용(5크레딧 마진 내 확인).
- composeCopyBrain ↔ buildSystemPromptWithBrandVoice 중복 항목 정확 목록.
- 브랜드보이스 추출기(가이드라인 9항목 생성) 위치·강화 범위.
