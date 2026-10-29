# 목소리 꼴 칸 질문 · 매핑 설계 (1029 · 구조체크 → 설계)

> 접수 = Harold 1029 「학습된 보이스에서 필요한 게 빠져 있는지 그걸 질문을 하는지 · 빈 곳들이 제대로 매핑되어 들어가는지」 · 생성 실물(AI 한줄로 LMS) = 본문 끝 `[링크를 입력해주세요]` · 「매장으로 문의 바랍니다」(매장 · 번호 없음) · 「%고객명% 고객님, / %고객등급% 고객님께」 호칭 반복.
> 원칙 = 메모리 `feedback_every_feature_one_line_ai_fills_gaps`(부족한 것은 AI 가 질문으로 채움) · 뿌리 대장 R1 · R24.

## 0. 축 대조표 (접수 → 이 축이 없으면 닫히는가)

| # | Harold 원문의 모양 | 축 | 없으면 |
|---|---|---|---|
| A | 한 줄 질문 창이 학습된 목소리에 필요한 값을 묻는가 | ② 질문 단계가 꼴 칸을 안다 | 안 닫힘 |
| B | AI 오퍼레이터 · 여정 · 자동마케팅도 같은가 | ① 판정 한 곳 + ② 생산자마다 배선 | 안 닫힘 |
| C | 빈칸이 제대로 매핑되어 들어가는가 | ① 회사가 가진 값 자동 채움 + ③ 답 → 생성 사실 | 안 닫힘 |
| D | 생성 문안 「고객님」 반복 | ④ 지시문 호칭 규칙 | 안 닫힘 |

## 1. 구조체크 사실 (코드)

1. 목소리 뼈대 칸 8종 = `brand-voice-skeleton.ts` `SKELETON_SLOT`(상품명 · 행사명 · 매장 · 기간 · 혜택 · 링크 · 연락처 · 숫자). 학습 때 대표 문안의 사실 조각 · 링크 · 연락처가 칸으로 바뀐다.
2. 지시문(`brand-voice-prompt.ts` voiceSectionFor) = 「대괄호 칸은 이번 요청의 사실로 채우고, 요청에 없는 사실의 칸은 그 칸이 든 문장을 쓰지 않는다」. 묻지 않고 조용히 뺀다.
3. 질문 단계
   - AI 한줄로 = `services/ai-line.ts` 416 `mergeLineAsks(line, sanitizeAiAsks(AI 질문))` · 규칙 안전망 = 혜택 · 기간 둘 · 답 = `[{q, a}]` → `lineAnswersContext` 로 생성 참고 글.
   - 한 줄 단계 창(DM · 이메일 · 인앱 `/one-line/gaps`) = 혜택 하나 · 이 생산자들은 목소리 `scope: 'tone'`(뼈대 예시 0) → 꼴 칸 없음.
   - 여정 = `journey-interview.ts` `buildInterviewQuestions`(코드가 만든 질문표 · `LineQuestion`) · 혜택 칸 → `benefitText`.
   - 자동마케팅 = `automarketing-interview.ts` `buildOperatorQuestions` · 혜택 칸 → `patch.benefit` → `automarketing-preview` `benefitContent`.
   - 어느 질문 단계도 목소리 뼈대를 읽지 않는다.
4. 값의 자리
   - 링크 = 브랜드 링크(`getBrandLinks`) · AI 는 `{{LINK:라벨}}` 토큰만 쓰고 생성 뒤 치환 · 미등록 = `[링크를 입력해주세요]` → 발송 직전 차단(`send-placeholder-gate`). 사람에게는 발송 단계에서야 보인다.
   - 연락처 = `companies.brand_kit.contact.cs_phone · phone`(브랜드 학습 ②) · 생성 지시문에 실리지 않는다.
   - 매장 = 회사 정보에 칸 없음.
5. 예시 고르기(`pickVoiceExamples`) = 종류(contentType) 먼저 · 성격(kind) · 나머지. 종류는 생성 때 AI 가 정할 수 있어(generateMessages 1250) 질문 단계에서 어느 뼈대가 쓰일지 확정할 수 없다.

## 2. 뿌리

「이 회사 문자 꼴에 늘 들어가는 칸(링크 · 매장 · 연락처)」의 판정이 없다. 그래서 (a) 회사가 이미 가진 값(연락처)도 안 싣고 (b) 질문 단계는 묻지 않고 (c) 지시문은 조용히 줄을 뺀다(또는 견본처럼 빈 칸을 남긴다). 판정을 한 곳에 두고 질문 · 생성이 같은 판정을 읽는다.

## 3. 설계

### ① 판정 CT `utils/voice-form-slots.ts` (서버 · 한 곳)
- 꼴 칸 = `link` · `store` · `phone` 셋(사실 칸 상품 · 행사 · 기간 · 혜택 · 숫자는 요청 · 기존 질문이 맡는다).
- `voiceFormSlotsOf(companyId, kind)` → 그 성격(marketing · notice)의 **확인된 뼈대 전부**(`liveSkeletons` · 고르기와 같은 자료)에 칸 글자가 1번 이상 나오는 꼴 칸. 뼈대 종류 고르기와 무관하게 성격 단위(§1-5 · 질문 시점에 확정 가능한 단위).
- `voiceFormValuesOf(companyId)` → 회사가 가진 값: `link` = 브랜드 링크 1개 이상 · `phone` = brand_kit `contact.cs_phone || contact.phone`(번호 꼴 검사) · `store` = 없음.
- `voiceFormAsks(slots, values)` = 꼴 칸 중 회사 값이 없는 것 → 질문(고정 글 · 서버 상수): 링크 「문자에 넣을 링크 주소를 알려 주세요」 · 매장 「안내할 매장 이름을 알려 주세요」 · 연락처 「문의 받을 번호를 알려 주세요」 · 셋 다 선택(비우면 그 줄 없이).
- 목소리 미학습 · 뼈대 0 = 빈 목록(지금 동작).

### ② 질문 단계 배선 (묻는 생산자 셋)
- AI 한줄로: `mergeLineAsks(line, aiAsks, voiceAsks)` 규칙 안전망에 더함(kind `text` · id `voice_link` · `voice_store` · `voice_phone` · source `rule`). 답 식별 = 서버 상수 질문 글과 같은 `q`.
- 여정: `buildInterviewQuestions` 끝에 `voice:link` · `voice:store` · `voice:phone`(`LineQuestion` text · `noneLabel` 「이 줄 없이」) · 결정값에 `voiceForm` 저장 → 패키지 생성 입력.
- 자동마케팅: `buildOperatorQuestions` 에 같은 셋 · `decideOperatorAnswers` patch.voiceForm → 운영 입력에 저장(매 회차 생성이 읽는다).
- 답 검증 = 링크 `http(s)` 공개 주소 · 200자 · 매장 40자 · 번호 = 숫자 · 하이픈 9~13자리.

### ③ 답 · 회사 값 → 생성 (모든 생산자 · 한 곳)
- `composeVoicePrompt` 입력에 `formValues?: { link?: string; store?: string; phone?: string; omit?: Slot[] }`. 회사 값(연락처)은 입력이 없어도 CT 가 읽어 싣는다(질문 단계 없는 생산자도 연락처는 채워진다 · C 축).
- 지시문 절 「이 회사 문자 꼴 칸 값」: 매장 = X · 문의 번호 = Y · 링크 = `{{LINK:이번 문자 링크}}` 토큰으로 쓴다 · 값 없는 칸 = 그 줄을 쓰지 않는다(질문을 거친 뒤의 결정).
- 링크 답 = 그 생성의 토큰 치환에 1회용 링크 `{ label: '이번 문자 링크', url }` 를 더한다(`generateMessages` extraContext.extraLinks · AI 는 URL 을 직접 쓰지 않는다는 규칙 유지).
- 매장 · 번호는 사람이 적은 글이므로 혜택 근거(licenseText)에 넣지 않는다(사실 칸 · 혜택 아님).

### ④ 호칭 반복 (D)
- 지시문 공통 규칙 한 줄: 「고객 호칭(%고객명% 고객님 · 등급 호칭)은 문안에서 한 번만 부른다 · 이어지는 줄에서 다시 「고객님」으로 부르지 않는다」.

## 4. 영향표

| 자리 | 바뀜 |
|---|---|
| brand-voice-prompt `composeVoicePrompt` · voiceSectionFor | 꼴 칸 값 절 · 호칭 규칙(19 생산자 공통) |
| services/ai `generateMessages` | extraLinks · formValues 전달 |
| services/ai-line(AI 한줄로) | 질문 안전망 · 답 → formValues |
| journey-interview · journey 생성 | 질문 · 결정값 · 생성 입력 |
| automarketing-interview · preview · 운영 생성 | 질문 · 저장 · 생성 입력 |
| brand-voice-sample(견본) | 회사 값 실음 · 값 없는 칸 = 줄 생략(빈 칸 남김 0) |
| 화면 | AI 한줄로 질문 창 = 서버 질문 그대로(변경 0) · 여정 · 자동마케팅 질문표 = 공용 `LineQuestion` 렌더(변경 0 예상 · 확인) |

## 5. 시험

- CT: 뼈대 칸 판정 · 회사 값 · 질문 목록(미학습 0 · 링크 등록 = 링크 질문 0 · 연락처 있음 = 연락처 질문 0).
- 각 질문 단계에 꼴 질문이 실린다 · 답이 생성 입력에 닿는다(여정 · 자동마케팅 저장 왕복).
- 지시문: 꼴 값 절 · 호칭 규칙 · 링크 토큰 1회용 치환.
- 계약(R24 넓힘): `composeVoicePrompt` 를 부르는 생산자 = 꼴 값 절을 거친다(CT 안이라 자동).

## 6. 범위 밖(기록)

- DM · 이메일 · 인앱(scope tone · 뼈대 예시 0) = 꼴 칸 없음 · 해당 없음.
- 대표 문안 「매장」이 여러 매장인 회사의 매장 목록 저장 칸(회사 정보 신설) = 별도 과제.

## 7. 설계 1R 정정 (Codex 설계 1R · 5건 전부 수용)

### 7-1 답 · 생략 = 완료 (high)
- 꼴 칸 결정 = `VoiceFormDecision = { link?: { value: string } | { omit: true }; store?: …; phone?: … }`(칸마다 「값」 · 「명시 생략」 · 미결정).
- 질문 = 꼴 칸 − 회사 값 − **결정된 칸(값 · 생략 모두)**. 여정 · 자동마케팅은 결정을 저장하고 질문표를 다시 만들 때 그 결정을 읽는다(답하거나 생략한 칸은 다시 묻지 않는다 · automarketing-preview 525 의 「질문이 남으면 생성 막음」에 갇히지 않는다).
- AI 한줄로는 한 번의 실행 안 질문 → 답 왕복(비운 칸 = 명시 생략 · 화면이 「다음」으로 넘긴 순간 결정).
- 질문 글의 「없이」 = 생략 단추(LineQuestion noneLabel · AI 한줄로 = 빈 답).

### 7-2 지문 · 과금 키 (high)
- 자동마케팅 `copyPrint` 에 정규화한 결정(`vf`)을 더한다 → 값 · 생략이 바뀌면 새 문안(혜택이 바뀔 때와 같은 계약: 같은 결정 재전송 = 차감 0 · 결정 정정 = 새 문안 · 새 차감).
- 여정 패키지 · AI 한줄로 멱등 키(입력 지문)도 결정을 포함한다(AI 한줄로 `aiLineInputFp` 의 payload 에 결정이 들어가는지 확인 · 없으면 더함).

### 7-3 링크 결정 한 곳 (medium)
- `resolveFormLink({ brandLinks, decision })` → `registered`(등록 링크 = 지금 토큰 지시 그대로) · `once`(1회용 `{ label: '이번 문자 링크', url }` = 지시문은 그 라벨 하나만 · 치환기에 같은 목록) · `omit`(지시문의 링크 · placeholder 지시를 지우고 「링크 줄을 쓰지 않는다」 · 그래도 토큰이 나오면 치환기가 placeholder = 발송 차단 = 안전).
- 프롬프트(`buildBrandLinkPromptSection`)와 치환(`applyBrandLinkTokens`)이 **같은 결과 목록**을 받는다(generateMessages 한 자리에서 한 번 정해 둘 다에 넘김).
- 등록 링크가 있으면 링크는 묻지 않는다(지금 등록 링크 동작 유지).

### 7-4 예시 후보 = 생성과 같은 집합 (medium)
- 꼴 칸 판정 후보 = 그 성격의 가능한 실제 고르기 결과 합집합: `pickVoiceExamples(live, kind, c)` 를 모든 종류 c(`COPY_CONTENT_TYPES`) + `null` 로 돌린 결과의 합(다른 성격 보충 포함 · 같은 함수 · 손 규칙 0).

### 7-5 문구 칸도 판정 (medium)
- 판정 = 예시 뼈대 + 그 성격 가이드라인의 확인된 문구(서명 · 인사 · 행동 유도 · 자주 쓰는 표현 · 어미 예시 = voiceSectionFor 가 싣는 칸과 같은 목록 · scope tone 에도 실림).
- 그래서 scope tone 생산자(DM · 이메일 · 인앱 · 한 줄 머리글 · SNS)도 서명의 연락처 칸 등을 가진다 → 이들도 ③ 회사 값 · 지시문 「값 없는 칸 줄 없이」를 받는다(빈 칸 남김 0). 질문 단계 배선은 이 묶음 = AI 한줄로 · 여정 · 자동마케팅 · 한 줄 단계 창(DM · 이메일 · 인앱)은 질문 화면이 따로라 §6 범위 밖으로 기록(빈 칸은 남지 않고 줄이 빠짐 · 다음 묶음에서 질문 화면 배선).

## 8. 설계 2R 정정 (Codex 설계 2R · 2건 수용)

### 8-1 링크 생략 = 출구에서 결정적으로 지운다
- `omit` 결정은 지시문뿐 아니라 **토큰 치환(출구)**에도 넘긴다: 생략 결정이면 `{{LINK:…}}` 토큰이 든 **줄 전체**를 지운다(AI 재호출 0 · 차감 0 · 결정적). 줄을 지운 뒤 연속 빈 줄은 하나로.
- 생략이 아닌데 남은 토큰 = 지금처럼 placeholder → 발송 가드 차단(가드 유지).
- AI 한줄로 `readLineAnswers` 는 빈 답을 버리기 전에 꼴 질문의 빈 답을 「생략」으로 보존한다(§7-1).

### 8-2 DM · 이메일 · 인앱 한 줄 단계 창도 묻는다
- 한 줄 단계 판(`buildLineStepsPlan` · `/one-line/gaps` 응답 plan)에 꼴 칸 단계(`voice`)를 더한다: 칸 = 같은 CT 의 질문(링크 · 매장 · 연락처 · 회사 값 · 결정 제외) · 각 칸 「이 줄 없이」.
- 화면(LineStepsModal 계열)은 판의 단계를 그리는 공용 렌더 → 단계 하나 추가 · 답 = 요청 본문 `voice_form`(buildLineStepsBody).
- 서버(`one-line-ct/order` · 각 어댑터)는 서버가 다시 계산한 질문으로 답을 검증(화면이 보낸 질문을 믿지 않는다) → 결정 → 그 생산자의 `composeVoicePrompt` formValues · 링크 결정.
- 완료 조건: 회사 값이 없고 미결정인 꼴 칸 = 질문이 뜬다(조용한 생략 0) · 명시 생략만 줄을 뺀다. 질문 단계가 없는 생산자(variant · 다시 쓰기 · 회차 워커)는 저장된 결정 · 회사 값만 쓰고 결정이 없으면 줄 생략(사람 입력 경로가 아니라 질문할 자리가 없음 · 그 입구의 질문 단계에서 이미 결정이 저장된다).

## 9. 설계 3R 정정 (Codex 설계 3R · 1건 수용)
- 구성 경로도 같은 단계 · 같은 계약: 서버 `buildCompositionPlan(s)`(one-line-ct/index.ts · 구성 5종 판) 각 판에 같은 `voice` 단계(CT 하나가 만든 질문 · 기존 단계 순서 맨 뒤 · 확인 바로 앞) · 화면 `buildLineTemplateBody`(구성 요청 본문)도 `voice_form` 을 싣는다. 기본 plan(`buildLineStepsPlan`) · 구성 plans 둘 다 같은 함수 `voiceStepOf(asks)` 로 단계를 만든다(두 벌 손 규칙 0).

## 10. 구현 기록 (1029)
- 판정 CT = `utils/voice-form-slots.ts` · 성격별 판정 = `brand-voice-prompt.ts` `voiceFormSlotsForData` · 질문 단계 입구 = `voiceFormAsksFor`.
- 질문 = AI 한줄로(`mergeLineAsks` 규칙 질문) · 여정(계획마다 `voice:*`) · 자동마케팅(필수 · 저장값 미리 채움 · 창마다 한 번) · 한 줄 단계 창(DM · 이메일 · 인앱 = 판 `plan.voice` · **만들기 단계 안 꼴 칸 묶음**).
  설계 §8-2 · §9 의 「voice 단계」를 만들기 단계 묶음으로 한 까닭 = 닫힌 단계 목록 · 단계 상한 4 · 화면 짝 시험을 건드리지 않고 같은 계약(서버 질문 · 답 voice_form · 서버 재계산 검증)을 지킨다. 결정은 요리 문맥(AsyncLocalStorage `runWithVoiceForm`)으로 그 요리의 모든 목소리 호출에 닿는다.
- 결정 저장 = 자동마케팅 `continuous_operators.voice_form` jsonb(원장 C79-DDL-1 · DDL 전 = 결정이 있는 등록 · 승인만 「마이그레이션 필요」).
- 지문 = 요청이 보낸 칸만(`decideSentVoiceForm` · 회사 값이 바뀌어도 같은 요청 = 같은 지문) · 꼴 틀린 답 = 캐시 · 멱등 조회 전에 거절.
- Codex 설계 1R 5 → 2R 2 → 3R 1 → 4R approve · 구현 1R 7 → 2R 1 → 3R 1 → 4R approve.
