# AI 한줄로 되묻기 답의 링크가 문안에서 빠짐 · 구조체크 · 설계

> 2026-10-31 · 카드 C86 · 뿌리 R32(새) · 상태: Harold 동의(1031 「진행해(LMS 승격)」) · Codex 설계 4R approve · 구조체크 5회차 결함 0 · 구현 · Codex 구현 4R approve · 구조체크 6회차 결함 0 · 배포 대기 · 미커밋(원장 C86)
> 접수 = Harold 1031 「AI 오퍼레이터에서 한 줄 입력 → AI 가 부족한 정보를 되묻는다 → 거기에 URL 을 넣어도 실제 문안에 URL 이 안 들어가는 경우가 있다 · 구조체크하고 부족한 부분 전부 닫기」

## 0. 입구 · 길

AI 오퍼레이터 화면 `AiOperatorPage` → `AiHubBand` → `LineIntakeModal`(AI 한줄로) → `POST /api/ai-line/compose` → `runLineCompose`(services/ai-line.ts:543) → `generateMessages`(services/ai.ts:1099) → 출구 `applyCopyExitGuards`(utils/copy-exit-guards.ts:149).

사람이 링크를 주는 자리는 셋이다.

| 자리 | 어디로 가나(지금) | 생성기가 듣는 말 |
|---|---|---|
| ① 목소리 링크 질문 답(`voice_link` · 학습한 문자 꼴에 링크 줄 + 등록 링크 0 일 때만 묻는다) | `splitVoiceLineAnswers` → `decideVoiceForm` → `resolveFormLink` = once(토큰 `{{LINK:이번 문자 링크}}` → 치환) | 꼴 칸 절 「링크 칸: 토큰으로 쓴다」 + 링크 절(토큰 목록 · 「어울리지 않으면 넣지 않아도」) |
| ② AI 가 판단해 물은 질문의 답(`q1…` · 대상 찾기 지시문이 「링크 등」을 물으라고 한다 · services/ai.ts:2066) | `split.others` → 근거 글 「[확인한 사실] - 주소」 + 참고 글 | 링크 결정에 안 들어감. 링크 절은 이 주소를 모른다 |
| ③ 한 줄 안의 주소 | `buildLineEventText` → 근거 글 | ②와 같음 |

링크 절(`buildBrandLinkPromptSection` · brand-link-core.ts:116)은 회사 상태에 따라 셋 중 하나다: 등록 링크 있음 = 「URL 직접 작성 절대 금지 · 토큰만 · 어울리지 않으면 넣지 않아도」 / 링크 습관만 = 「URL 직접 금지 · [링크를 입력해주세요]」 / 목소리 링크 생략 결정 = 「이번 문자에는 링크를 넣지 않는다」(brand-voice-prompt.ts:600) + 출구가 링크 줄을 지움(copy-exit-guards.ts:254).

## 1. 결함(코드로 확인한 것 · 줄 근거)

| # | 결함 | 근거 |
|---|---|---|
| L0 | **출구의 템플릿 문법 거름이 링크 토큰을 지운다.** 검출 꼴 `/\{\{\|\{%/` 이 `{{LINK:…}}` 에 걸리고, 이 단계가 링크 치환보다 앞이다. 그래서 사람이 정한 1회용 링크(①)도, 등록 브랜드 링크도 문안에서 사라진다. 또 liquid 플래그가 서서 재생성 힌트(템플릿 문법 금지)까지 붙는다. 실측(1031 · 출구 함수 직접 호출): 입력 「…자세히 보기\n{{LINK:이번 문자 링크}}」 → 출력 「…자세히 보기」 · liquid=true / 입력 「가을 신상\n{{LINK:공식몰}}」 → 출력 「가을 신상」 · liquid=true. 언제부터 이 순서였는지는 미검증 | copy-exit-guards.ts:179-182(거름) · 256(치환) · liquid-templating.ts:58 · 123-132 |
| L1 | ② · ③ 의 주소가 링크 결정에 안 들어간다. 등록 링크 회사는 「URL 직접 금지 · 토큰만」에 막혀 등록 링크로 바뀌거나 빠지고, 링크 습관 회사는 자리 표시로 바뀐다 | services/ai-line.ts:577-583 · brand-link-core.ts:126-136 |
| L2 | ① 을 비우고(= 「이 줄 없이」) ② 에 주소를 적으면 생략 결정이 이긴다. 지시문 「링크를 넣지 않는다」 + 출구가 링크 줄을 지운다 | LineIntakeModal.tsx:104-106(빈 답도 보냄) · voice-form-slots.ts:122 · brand-voice-prompt.ts:600 · copy-exit-guards.ts:254 |
| L3 | 링크가 정해져도(once) 「꼭 넣어라」가 없고(「어울리지 않으면 넣지 않아도」) 결과에 들어갔는지 보는 자리가 없다. AI 가 빼면 그대로 나간다 | brand-link-core.ts:131 · copy-exit-guards.ts:254-263(치환만) |
| L4 | SMS 는 광고 본문 예산이 64바이트 안팎이고 지시문이 「초과 시 발송 불가」라 한다. 주소(30~60바이트)를 넣으면 넘으니 AI 가 주소를 뺀다. 칼럼은 LMS 로 올리는데 링크는 안 올린다 | services/ai.ts:1235-1239 · services/ai-line.ts:553 |
| L5 | 한 줄에 주소가 있어도 ① 을 또 묻는다(다시 입력) | services/ai-line.ts:418 · voiceFormAsksOf 가 한 줄을 안 본다(voice-form-slots.ts:96) |
| L6 | 200자 넘는 주소: 화면 입력 200자 + 서버 200자 자름 → 잘린 주소가 근거로 간다. ① 은 200자 넘으면 「https:// 로 시작하는 주소로 적어 주세요」(틀린 안내) | LineIntakeModal.tsx:105 · 506 · utils/ai-line.ts:164 · voice-form-slots.ts:24 · 76 · 125 |
| L7 | `https://` 없이 적은 주소(`www.shop.com/event` · `shop.com/event`): ① 은 거절(다시 입력), ② 는 사실 글로만 간다 | voice-form-slots.ts:78 · one-line-steps.ts:58 |
| L8 | 칼럼 넣기(꾸미기) 다시 쓰기가 링크를 뺀 안도 받아들인다. 보는 것 = 새 숫자 · 혜택 · 효능뿐 | operator-message-decorator.ts:106 · copy-benefit-detector.ts:897 |
| L10 | 다듬기(AI 한줄로 화면 AiRefineModal → `/api/ai/refine-message`) 후보 거름도 링크를 뺀 후보를 받는다. 지시문은 「URL 100% 보존」이라 하는데 판정이 없다 | services/ai.ts:2682 · 2902 · frontend pages/AiLinePage.tsx:36 |
| L9 | 같은 뿌리 다른 기능: 여정은 ① 의 답을 「링크 칸: 주소」로만 알리고(지시문 예시는 「[URL 입력]」 자리 표시를 가르친다) 출구 확인이 없다. 자동마케팅은 `generateMessages` 출구라 L3 과 같다 | journey-ai-generator.ts:674 · 733-767(voiceForm 을 읽는 곳 2곳뿐) · 404 · 517 · ai-orchestrator.ts:572 · 905 |

## 2. 뿌리(R32 · 새 줄)

**사람이 준 링크가 두 길로 간다(사실 글 · 링크 결정) · 정해진 링크가 결과에 들어갔는지 판정하는 자리가 없다.**
판정 기준:
- 문자에 넣을 링크는 **링크 질문 한 자리**의 답으로만 정한다(사람이 그 칸에 적거나 미리 채워진 값을 남긴 것 = 발송용이라는 뜻의 확인).
- 그 밖의 답 · 한 줄 속 주소는 참고 사실이다. 한 줄 속 주소는 링크 질문을 미리 채울 뿐 스스로 링크가 되지 않는다.
- 정해진 링크(once)는 생성 출구에서 결과에 있는지 확인한다. 없으면 붙인다(AI 재호출 0).

## 3. 처방(정답 하나 · P3 = Harold 1031 결정 LMS 승격)

### P0 템플릿 문법 거름이 링크 토큰을 지나가게 한다(L0)
- copy-exit-guards 에서 링크 토큰을 **출구 함수 맨 앞(광고 · 080 제거 앞)에서 감추고, 생략 줄 지움 · 링크 치환 직전에 되돌린다**(구조체크 4회차 · 구분선 지움 `[━─═＿_~\-]{3,}` · 이모지 단계도 라벨에 닿지 않게)(Codex 설계 2R ① · 그 사이의 금지어 · 혜택 · 효능 · 날짜 · 변수 단계가 라벨을 깎지 않게). 감추기는 `protectLinkTokens`(brand-link-core.ts) → `{ text, restore }` 이고, 토큰 꼴은 그 파일의 `LINK_TOKEN_RE` 한 곳이다.
- 감춘 자리 = 토큰마다 사설 영역 글자 하나(U+E100 + 순번 · 숫자 · 혜택 낱말 0 · 이모지 지움 `stripEmojis` 범위에 사설 영역(U+E000~F8FF)이 없다 · copy-exit-guards.ts:53-111 확인). 효능 문장 빼기가 그 글자가 든 문장을 빼면 토큰도 함께 빠진다(그 문장이 빠진 것이 맞다 · once 는 P2 출구가 다시 붙인다).
- 치환 자리는 지금처럼 혜택 · 날짜 판정 뒤에 둔다. 앞으로 옮기면 주소 숫자(`/2026/10/31`)가 지어낸 날짜 · 숫자로 걸려 주소가 깨진다.
- `LIQUID_DETECT_PATTERN`(liquid-templating.ts · DM · 이메일 Liquid 세계 공용)은 바꾸지 않는다.
- 토큰이 살아나면 등록 링크 회사에서 **라벨이 틀린 토큰**이 `[링크를 입력해주세요]` 로 바뀐다. 이 자리 표시는 발송 길목(send-placeholder-gate.ts:30)이 막는다. 그런데 자동 발송(자동마케팅 · 자동 캠페인 · 플래너)에는 사람이 고칠 자리가 없다(지금은 토큰이 지워져 링크 없이 나간다).
  → 출구 링크 단계에서 `applyBrandLinkTokens` 의 `unresolvedCount > 0` 을 기억하고, 마지막 `placeholderLeft` 판정(copy-exit-guards.ts:267)에 OR 로 합친다(Codex 설계 2R ② · 그 줄이 앞의 참을 덮어쓰지 않게). 이것은 K12-3 재생성 조건(직접 채울 칸 잔존)과 같은 길이다. 습관 회사 지시문이 시켜 쓴 자리 표시(토큰 아님)는 세지 않는다(지금 동작 그대로 · 매번 재생성하는 길을 만들지 않는다).

### P5 주소 읽기 한 곳 · `readLinkText(text)` → `{ raw, url } | null`(voice-form-slots.ts · 순수)
- 공백 없는 한 덩어리는 그 자체로 읽는다. `http(s)://` 가 없고 도메인 꼴(`^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(/\S*)?$`)이면 `https://` 를 붙인다.
- 아니면 글 속 `http(s)://` 주소를 `lineUrls`(one-line-steps.ts:61 · 한 줄 단계 창과 같은 읽기)로 읽는다.
- 후보마다 `cleanFormLink`(사설 · 숫자 · localhost 거절 그대로 · 길이 ≤ `LINK_MAX` = 사람이 적은 글자)를 지나는 첫 후보를 돌려준다.
  - `raw` = 사람이 적은 글자(사실 글 자리 바꿈에 쓴다) · `url` = `https://` 를 붙인 그 글자 = **결정 값**(저장 · 지문 · 비교의 원본).
  - 지금 받던 입력(`http(s)://…` · 500자 이하)은 결정 값이 지금과 글자 그대로다. 그래서 결정 지문(`decideSentVoiceForm` print · 여정 · 한 줄 단계 창 시도 키)이 배포 전후 같다(Codex 설계 1R ① 경계 · 따로 가르는 장치 0).
- **ASCII 직렬화는 쓰는 자리에서만**: `asciiLink(url)`(voice-form-slots.ts) = 출력 가능 ASCII 글자만이면 그대로, 아니면 `new URL(url).href`(한글 경로 = 퍼센트 부호 · 한글 도메인 = punycode). 쓰는 자리 셋 = `resolveFormLink` once 링크(토큰 치환 값) · `voiceFormPromptSection` 의 비토큰 링크 줄(여정 지시문 「링크 칸: 주소」) · `ensureOnceLink` 입력.
  - 이모지 같은 비 ASCII 가 URL 에 남아 정제(sanitizeForSms)가 깎는 길을 닫는다(Codex 설계 1R ③).
  - 저장값은 사람이 적은 글자(≤ 500)라 다시 읽을 때 길이로 거절되지 않는다(Codex 설계 3R 범위 밖 지적 · 직렬화 값을 저장하면 한글 79자 = 559자로 상한을 넘었다).
- `LINK_MAX = 500`(한 줄 단계 창 `URL_MAX` 와 같은 값) → `cleanFormLink` 상한 · `VOICE_FORM_ASK.link.maxLength`.
- 목소리 링크 칸 결정(`decideVoiceForm`)도 이 함수의 `url` 을 쓴다. `www.` · 도메인 꼴을 받고, 거절 문구 = 「링크는 주소(https://… 또는 www.…)로 적어 주세요」.
- 저장값 읽기(`readVoiceFormDecision`)는 `cleanFormLink` 그대로다(상한만 넓어진다).

### P1 링크 질문 한 자리(Codex 설계 1R ② · 「주소 발견 ≠ 발송 링크 확정」)
- 대상 찾기(services/ai-line.ts:418 · `mergeLineAsks`)가 질문 목록에서 링크 질문을 하나로 만든다.
  - **링크 질문 판정**(utils/ai-line.ts 한 곳) = 목소리 링크 질문(`voice_link`) · AI 가 kind `link` 로 낸 질문뿐이다. 대상 찾기 지시문 copy_questions 의 kind 에 「link = 문자에 넣을 링크 주소를 받는 질문(주소를 묻는 질문은 반드시 link)」을 더한다. kind text 질문은 글을 보고 다시 분류하지 않는다(Codex 설계 2R ③ · 3R 같은 부류 둘째 → 구조 수정: 자연어 질문 글을 정규식으로 읽어 의도를 맞히는 구조가 반례를 끝없이 낳는다 · 판정을 질문을 만드는 쪽의 스키마 칸으로 옮긴다 · `LINK_ASK_RE` 폐기).
  - 목소리 링크 질문이 있으면 그것이 그 자리다. AI 링크 질문은 뺀다(같은 것을 두 번 묻지 않는다 · L2 의 두 칸이 생기지 않는다).
  - 목소리 링크 질문이 없는데 AI 가 kind link 로 물었거나 한 줄에 주소가 있으면 → AI 링크 질문들을 서버 상수 질문 **`LINE_LINK_ASK`**(id `link` · 글 「문자에 넣을 링크 주소가 있으면 알려 주세요」 · 도움말 「적으면 문자마다 이 주소를 넣어요. 비우면 지금처럼 써요」) 하나로 바꾼다.
  - 한 줄에 주소가 있으면(`readLinkText(line)`) 그 자리 질문의 **`prefill`** = 그 주소의 `url`. 다시 입력이 없다. 사람이 지우면 그 뜻이 이긴다.
- 화면: `AiLineAsk.prefill?: string`. 진행(runId)마다 비운 뒤, 질문이 오면 비어 있는 칸만 prefill 로 채운다(LineIntakeModal.tsx:180-183 리셋 다음).
- 만들기(runLineCompose): `splitVoiceLineAnswers` 가 `LINE_LINK_ASK` 글의 답을 따로 가른다(`{ voice, lineLink, others }`).
  - 목소리 링크 답이 있으면(보냄) = 지금 결정 그대로다(값 = once · 비움 = 생략).
  - 없으면 `LINE_LINK_ASK` 답이 값일 때 `readLinkText` → once. 꼴이 틀리면 거절(`VOICE_FORM_INVALID` 같은 400 · 차감 전)이고, 비움은 결정 없음(등록 · 없음 그대로)이다.
  - `LINE_LINK_ASK` 답은 근거 글 · 참고 글(`others`)에 싣지 않는다.
  - 그 밖 답 · 한 줄의 주소는 참고 사실로 남는다. 링크 결정에 안 쓴다.
- 정해진 링크가 있으면, 근거 글 · 참고 글로 가는 그 밖 답 · 한 줄에서 글 속 `http(s)://` 주소 구간(`lineUrlSegments`)이 통째로 그 주소(`raw` · `url`)와 글자 그대로 같은 자리만 `{{LINK:이번 문자 링크}}` 로 바꿔 싣는다(`withLinkToken`). `https://` 없이 적은 주소 꼴은 바꾸지 않는다(Codex 구현 1R ③ · 2R · 3R 같은 부류 셋 · 구분자 없는 꼴 맞추기 = 열린 문제 · 결과 링크는 출구 ensureOnceLink 가 보장). AI 가 주소를 옮겨 쓰다 틀리거나 두 번 쓰는 길을 닫는다. 혜택 · 날짜 판정은 토큰 치환 앞이라 주소 숫자를 보지 않는다.
- 옛 화면(배포 전 캐시)은 AI 질문 글 그대로 답을 보내므로 지금처럼 참고 사실이 된다(무해).

### P2 정해진 링크는 꼭 들어간다
- 지시문: `composeVoicePrompt` 링크 절 한 곳(brand-voice-prompt.ts:599)에 once 갈래를 더한다. 함수는 `onceLinkPromptSection(habit)`(voice-form-slots.ts)이다.
  - 글 = 「담당자가 이번 문자 링크를 정했다 · 문안마다 {{LINK:이번 문자 링크}} 토큰을 꼭 한 번 그대로 쓴다 · 다른 링크 토큰 · URL 직접 작성 · 링크 자리 표시는 쓰지 않는다 · 위치 = 링크 습관(body_end 면 CTA 다음 줄)」.
  - 등록 링크 · 습관 · 생략 갈래는 글자 무변이다.
- 출구: `ensureOnceLink(text, url)`(voice-form-slots.ts · 순수) → `{ text, appended }`.
  - 함수 안에서 `asciiLink(url)` 을 지난 값으로 비교 · 치환 · 붙임을 한다(옛 저장값 포함 · 결정 값은 사람이 적은 글자).
  - 모든 링크 토큰(라벨 무관) · `[링크를 입력해주세요]` · 여정 자리 표시 `[URL 입력]` · `[URL: 회사 admin 수정]` 을 그 주소로 바꾼다.
  - 그래도 본문에 없으면 마지막 줄에 붙인다.
- 거는 자리 둘:
  - `applyCopyExitGuards` 링크 단계(copy-exit-guards.ts:254 · 생략 줄 지움 다음 · 토큰 치환 앞 · 전송자 명칭 · 바이트 계산 앞)다. `exitCtx.onceLink` = generateMessages 의 `formLink.mode === 'once'` 주소다. 플래그 `linkAppended` 는 로그만 남긴다.
  - 여정 출구(journey-ai-generator.ts:756)는 단계 본문마다 건다. 순서는 sanitizeForSms · 혜택 · 효능 · 계절 거름 뒤, 전송자 명칭 앞이다. 붙이는 값은 ASCII 주소라 EUC-KR 불변식이 깨지지 않는다(Codex 설계 1R ③). `input.voiceForm.link.value` 가 있으면 건다. 여정 꼴 칸은 이 회사 문자에 늘 들어가는 칸이라 단계마다다.

### P3 AI 한줄로 · SMS + 정해진 링크 = LMS(Harold 결정)
- services/ai-line.ts:553 `input.vars.length > 0 || 링크 once` 이면 SMS → LMS 다. 칼럼과 같은 한 줄이다.
- **원장 키 채널 = 옛 규칙(칼럼만)으로 계산한 값**(Codex 설계 1R ① · 배포 전 낸 시도를 배포 뒤 같은 attemptToken 으로 다시 불러도 같은 키 · 다시 걷지 않음). 출력 채널과 키 채널을 가른다.
  - 출력 채널은 키 입력(facts · line · vars · channel)만으로 정해진다. 그래서 키가 같으면 출력 채널도 같다.
  - 배포 전 결과를 기억에서 돌려주는 경우는 그때의 채널(SMS) 그대로다. 낸 것 = 돌려준 것.
- 화면: 칼럼 단계 안내(LineIntakeModal.tsx:876)를 SMS 일 때 「칼럼이나 링크가 들어가면 장문(LMS)으로 보내요」로 바꾼다. 화면은 링크를 판정하지 않는다(서버 한 곳).
- 결과 카드 채널은 지금도 compose 응답 channel 이다(LineIntakeModal.tsx:323).

### P6 다시 쓰기 링크 보존 · `rewriteDropsLinks(after, before)`(brand-link-core.ts · 순수 · 링크 CT 한 곳 · 주소 읽기 = `lineUrls`)
- 판정 = 원문(before) 글 속 `http(s)://` 주소(`lineUrls`) 중 다시 쓴 글(after)에 글자 그대로 없는 것이 있는가.
- **최종 반환 글로 판정한다**(Codex 설계 1R ④ · 자르기 · 정제 뒤).
- 거는 자리 = AI 한줄로 결과가 닿는 같은 칸 다시 쓰기 둘.
  - 꾸미기 `decorateOperatorMessages`(operator-message-decorator.ts:104-112): `out` 을 만든 뒤 `rewriteDropsLinks(out, origOut)` 이면 원문(`origOut`)을 돌려준다. 이것은 kept 이고 차감 0 이다. 쓰는 곳 = AI 한줄로 만들기(빠진 칼럼) · 꾸미기 버튼 · routes/ai.ts 꾸미기.
  - 다듬기 `validateAndNormalizeRefinedCandidates`(services/ai.ts:2682 · `/api/ai/refine-message` · AI 한줄로 화면 AiLinePage 의 AiRefineModal): 마지막 다듬은 글(수신거부 복원 · trim 뒤)로 판정하고, 빠진 후보는 뺀다(fabricated 갈래와 같은 처리).
- `rewriteAddsFacts` 에 넣지 않는 이유: 그 판정은 「근거 ⊇ 다시 쓴 글」이라, 여러 생산자가 근거로 같은 칸이 아닌 글을 준다(요청 칸 전체 JSON · 지시문 · 한 줄 + 사실 · dm-ai.ts:644 · email-ai.ts:420 · 482 · line-template-copy.ts:43). 「원문 ⊆ 다시 쓴 글」을 거기 섞으면 다른 칸의 주소 때문에 오거절한다.

### 답 길이(L6)
- 서버 `readLineAnswers` 답 상한 200 → 500(`LINK_MAX` 와 같은 값 · utils/ai-line.ts:164).
- 화면 `submitAsks` 자르기 · 답 칸 `maxLength` 200 → 500(LineIntakeModal.tsx:105 · 506).
- 배포 전 화면은 200 에서 잘라 보내므로, 같은 입력의 키 지문은 배포 전후 같다.

## 4. 영향표(소비처 전수)

| 바뀌는 것 | 소비처 | 영향 |
|---|---|---|
| 템플릿 문법 단계 토큰 감춤(P0) | applyCopyExitGuards(generateMessages 전 호출자 = AI 한줄로 · 자동마케팅(ai-orchestrator) · 자동 캠페인(auto-campaign-worker) · 운영자 재생성(continuous-operator) · 플래너(planner-copy) · 문안 생성(routes/ai.ts:343) · brand-voice-sample 견본) | **운영에서 보이는 변화**: 등록 브랜드 링크 회사의 생성 문안(자동 발송 포함)에 등록 링크가 다시 들어간다(07-02 설계 의도 · 지금은 지워짐). 라벨이 틀린 토큰 = 재생성 조건. 토큰 아닌 `{{ }}` 는 지금처럼 평문화 |
| `readLinkText` · `LINK_MAX` · ASCII 직렬화 | decideVoiceForm(AI 한줄로 · 여정 `decideJourneyVoiceForm` · 자동마케팅 · 한 줄 단계 창 `decideSentVoiceForm`) · voiceFormQuestions maxLength(여정 · 자동마케팅 · 한 줄 단계 창 질문표) · cleanFormLink(readVoiceFormDecision 저장값 = jsonb) | 받는 꼴이 넓어진다(`www.` · 200~500자). 결정 값 = 사람이 적은 글자(https:// 만 붙임 · 지금 받던 입력은 글자 그대로 = 지문 · 저장값 배포 전후 같음) · ASCII 직렬화(`asciiLink`)는 쓰는 자리 셋(once 치환 값 · 여정 지시문 링크 줄 · ensureOnceLink) |
| 링크 질문 한 자리 · `LINE_LINK_ASK` · `prefill` | mergeLineAsks(대상 찾기 한 곳) · splitVoiceLineAnswers(만들기 한 곳) · LineIntakeModal(질문 그리기 · 답 보내기) | AI 링크 질문 글이 서버 상수로 바뀐다. 목소리 링크 질문과 겹치면 하나만 |
| `withLinkToken` | runLineCompose 한 곳 | AI 한줄로만 |
| 링크 절 once 갈래 | composeVoicePrompt 링크 절 = `brandLinks: true` 생산자 = generateMessages 한 곳(grep 1) | once 가 아니면 글자 무변 |
| `ensureOnceLink` 출구 | applyCopyExitGuards(generateMessages · brand-voice-sample) · 여정 출구 | once 결정이 없으면 무변. generateMessages 에 voiceForm 을 주는 호출자 = ai-line · ai-orchestrator(자동마케팅 저장 결정) 둘. 나머지(routes/ai.ts:343 · auto-campaign-worker · continuous-operator 재생성 · planner-copy) = once 0 |
| 채널 승격 · 키 채널 분리 | runLineCompose → compose 응답 channel → 결과 카드 · 발송 창 | 칼럼 승격과 같은 길 · 키는 옛 규칙 |
| 꾸미기 받아들이기 | services/ai-line.ts:650 · 711 · routes/ai.ts:4236 | 링크 뺀(잘린) 안 = 원문 유지 · 차감 0 |
| 다듬기 후보 거름 | services/ai.ts:2975 · 3013(refine-message 두 갈래) | 링크 뺀 후보 = 뺌 |
| 답 상한 500 | readLineAnswers → 원장 키 지문 · 근거 글 · 참고 글 | 지시문 길이 최대 8 × 500자 |

DB 변경 0 · ENV 0.

## 5. 시험(seam)

- 순수(backend vitest):
  - `readLinkText`: 글 속 · 한 덩어리 · `www.` · 도메인 꼴 · 사설 거절 · 500(사람이 적은 글자).
  - `asciiLink`: ASCII 그대로 · 한글 경로 · 이모지 경로 · 한글 도메인 → ASCII. 쓰는 자리 셋이 이 함수를 지난다.
  - 링크 질문 한 자리: 목소리 질문 있음 = AI 링크 질문 빠짐 · 없음 + AI 링크 질문 = `LINE_LINK_ASK` · 한 줄 주소 = prefill · 링크 질문 아닌 AI 질문은 그대로. · kind text 질문은 글에 「링크」 · 「URL」이 있어도 그대로(「링크로 접속해야만 참여할 수 있나요?」 반례 고정)
  - `splitVoiceLineAnswers` 세 갈래 · `withLinkToken`.
  - `ensureOnceLink`: 토큰 · 자리 표시 바꿈 · 없으면 붙임 · 있으면 그대로 · url 없음 = 무변.
  - `onceLinkPromptSection` · `protectLinkTokens`.
  - `applyCopyExitGuards`: 링크 토큰이 템플릿 거름을 지나 치환된다(L0 재현 입력 그대로 · 등록 · once 둘) · onceLink 인데 모델이 링크를 뺀 출력 → 결과에 주소 · 혜택 판정이 주소 숫자를 안 본다.
  - 꾸미기: 링크 뺀 안 · 잘려서 링크가 깨진 안 = 원문 · 다듬기 후보 링크 뺌 = 뺌.
- 계약(소스):
  - runLineCompose: 키 채널 = 칼럼 규칙 · 출력 채널 = 칼럼 ∨ 링크 · 근거 글이 withLinkToken 을 지난다 · LINE_LINK_ASK 답이 others 에 없다.
  - 화면 maxLength 500 · prefill 채움 · 안내 문구.
  - 여정 출구가 ensureOnceLink 를 지난다.
- 뿌리 대장 R32 계약 시험(기계 추출): 사람 링크 결정을 받는 생성 생산자는 출구에서 `ensureOnceLink` 를 지나거나 그 출구 CT(applyCopyExitGuards)를 지난다. 생산자 = `voiceForm` 을 생성기에 넘기는 파일 · `formDecision` 을 composeVoicePrompt 에 주는 파일 · `runWithVoiceForm` 을 부르는 파일.
  면제 = 한 줄 단계 창(아래 §6 이유 줄).

## 6. 범위 밖(기록만)

- 한 줄 단계 창(DM · 이메일 · 인앱): 링크의 진실이 구조 칸이다(사람 확인 단계 `link` · `event_page` · `link_default` · 버튼 url). 꼴 칸 링크 답은 말투(tone) 문구 지시로만 간다. 링크 질문이 두 벌(꼴 칸 ① · 단계 `link`)인 것은 별도 과제로 기록한다.
- 여정 자리 표시 `[URL 입력]` 은 `AI_FILL_PLACEHOLDERS`(발송 길목 직접 채울 칸 판정)에 없다. 링크가 정해지지 않은 여정은 그대로 나갈 수 있다(이 접수 밖 · 기록).
- 자동마케팅 · 여정 SMS 칸 + 링크 결정에서 붙인 링크로 90바이트를 넘으면, 지금 바이트 경고 길(byte_warning · 여정 단계 검사) 그대로 간다. 채널 승격은 AI 한줄로만이다(Harold 결정 범위).
- 링크 질문이 아닌 AI 질문의 답에 적은 주소는 참고 사실이다. 문자에 넣으려면 링크 질문 칸에 적는다(도움말이 안내).
- DM · 이메일 · 인앱 · 한 줄 단계 문구 · 여정 다듬기 · 여정 변형의 다시 쓰기는 링크 보존 판정을 안 건다. DM · 이메일 · 인앱은 링크가 구조 칸(버튼 · href)이고 근거 단위가 같은 칸이 아니다. 여정 다듬기 · 변형은 이 접수 길(AI 한줄로) 밖이라 기록만 한다.

## 7. 구조체크 진행표

| 회차 | 결과 |
|---|---|
| 1 | L1~L9 (이 문서 §1) |
| 2 | L0(템플릿 문법 거름이 링크 토큰 삭제 · 실측 재현) · L10(다듬기 후보 거름 링크 빠짐) · P6 를 꾸미기 · 다듬기 두 자리 판정 하나로 · `rewriteAddsFacts` 에 섞지 않는 이유 기록 |
| 3 | P0 이 토큰을 살리면 라벨이 틀린 토큰이 자리 표시가 되어 자동 발송 길목에서 막힌다 → 미등록 라벨 토큰 = K12-3 재생성 조건(P0 마지막 줄) · 운영에서 보이는 변화(등록 링크가 자동 발송 문안에 들어감)를 영향표에 명시 |
| 4 | 감춤 시작을 템플릿 문법 단계 직전에서 출구 함수 맨 앞으로(그 앞의 구분선 지움 · 이모지 단계도 등록 라벨을 깎을 수 있다) |
| 5 | **결함 0** · 설계(P0~P6 · 답 길이) 대 현재 코드 줄 전수 대조(출구 단계 순서 · 사설 영역 글자 · 주제 칸 · 질문 상한 8 · 옛 화면 진행 · 수입 순환 0 = one-line-steps 의 수입 줄이 voice-form-slots · brand-link-core 를 안 부름) · P6 함수 자리만 링크 CT(brand-link-core)로(동작 무변) |
| 6 | **결함 0** · 구현 뒤 설계(P0 · P1 · P2 · P3 · P5 · P6 · 답 길이) 대 코드 줄 전수 대조 · 옛 이름(humanLinkOf · LINK_ASK_RE · mapLineUrls) 코드 잔존 0(grep) · 설계서 본문 = 마지막 처방(맨 주소 꼴 토큰화 없음)으로 맞춤 |

## 8. Codex 진행표

| 라운드 | 결과 | 처리 |
|---|---|---|
| 설계 1R | needs-attention · high 3 · medium 1 | 전부 수용. ① LMS 승격이 원장 키를 바꿔 배포 전후 같은 시도를 다시 걷음 → 키 채널 = 옛 규칙(P3). ② 참고 주소가 명시 생략을 뒤집고 발송 링크가 됨 → 「주소 발견 ≠ 발송 링크 확정」 · 링크 질문 한 자리 + 한 줄 주소 = prefill(P1 다시 씀 · humanLinkOf 폐기 · 구조가 단순해짐). ③ 이모지 URL 이 여정 정제 뒤 다시 붙음 → readLinkText ASCII 직렬화 · 출구 직렬화 한 번 더(P5 · P2). ④ 꾸미기 수락 뒤 자르기가 링크를 깸 → 최종 반환 글로 판정(P6) |
| 설계 2R | needs-attention · high 1 · medium 3 | 전부 수용 · 같은 부류 반복 0(①② = 2R 에서 처음 본 P0 의 경계 · ③ = P1 판정 폭 · ④ = P5 호환). ① 되돌림이 liquid 직후라 금지어 · 혜택 · 날짜가 라벨을 깎음 → 링크 치환 직전까지 감춤. ② 마지막 placeholderLeft 대입이 앞의 참을 덮음 → OR. ③ LINK_ASK_RE 가 「홈페이지에서만 진행하나요」를 링크 질문으로 → 주소 · 링크 · URL 을 받는 질문만 + AI kind link. ④ 직렬화 길이로 거절하면 배포 전 통과한 한글 주소 요청이 400 → 길이 = 사람이 적은 글자 |
| 설계 3R | needs-attention · medium 1 · 범위 밖 1 | 같은 부류 둘째(2R ③ · 링크 질문 판정 폭) → 개별 수정 멈춤. 왜 반복되나 = 자연어 질문 글을 정규식으로 읽어 의도를 맞히는 구조. 구조 수정 = 판정을 AI 스키마 칸(kind link)으로 옮기고 `LINK_ASK_RE` 폐기(코드 줄어듦). 범위 밖 지적(직렬화 값을 저장하면 다시 읽을 때 500 상한에 걸림)은 이 설계가 만든 것이라 수용 = 결정에는 사람이 적은 주소(https:// 만 붙임) · ASCII 직렬화는 쓰는 자리 셋에서만 → print 를 따로 가르던 장치도 사라짐 |
| 설계 4R | **approve** · 지적 0 | ASCII 사용처 값 일치 · 저장값 · 지문 호환 · kind link 처리에 충돌 근거 없음 |
| 구현 1R | needs-attention · medium 4 | 전부 수용. ① 회사가 「이번 문자 링크」 라벨을 등록하면 라벨로 거꾸로 찾은 once 가 등록 주소 → resolveFormLink 가 once 필드로 결정 값을 바로 돌려줌. ②③ 같은 뿌리(주소 같음 = 부분 문자열) → 주소 단위로 꺼낸 값이 글자 그대로 같은가 한 판정(rewriteDropsLinks · ensureOnceLink 있음 · withLinkToken). ④ 치환 문자열 $ 문법 → 콜백 |
| 구현 2R | needs-attention · medium 1 | 1R ③ 과 같은 부류 둘째(토큰화가 다른 주소 안쪽을 바꿈 · 괄호 경로) → 개별 수정 멈춤. 왜 반복 = 글 전체 위에 두 비교를 덮어씌움. 구조 = lineUrlSegments 로 주소 구간 · 일반 글 구간을 한 번 나누고 주소 구간은 통째 비교 · 맨 주소 꼴은 일반 글에만(mapLineUrls 폐기) |
| 구현 3R | needs-attention · medium 1 | 같은 부류 셋째(구간 끝에 다른 주소가 이어진 맨 주소 꼴을 바꿈). 2R 구조 수정으로도 안 닫혀 필요부터 다시 봄: 맨 주소 꼴이 사실 글에 남는 경우 = 같은 주소를 다른 답에 https:// 없이 또 적은 드문 경우뿐 · 결과 링크는 출구가 보장 → 맨 주소 꼴 토큰화를 없앰(http 주소 구간 통째 비교만 · 코드 줄어듦 · 결함 자리 소멸) |
| 구현 4R | **approve** · 지적 0 | 주소 구간 전체 일치만 치환 · 원문 보존 · 맨 주소와 정식 URL 겹침 가능성 = 받아들인 절충(막을 추가 근거 없음) |

## 9. 뒤로가기(1031 Harold 접수 · 같은 창 · 같은 배포)

- 접수 = 「질문을 하고 뒤로가기가 없어 · 단계에서 잘못된 게 있으면 뒤로 가서 그 부분으로 가야 되는데 그런 것도 없어」.
- 지금(코드): 앞 단계로 가는 길 = 칼럼 → 확인 판 하나(LineIntakeModal 「‹ 확인 판」). 빠진 정보 질문 바닥 = 나중에 · 다음 · 누구에게 바닥 = 나중에 · 확인 판 바닥 = 닫기 · 다음/만들기. 확인 판의 혜택 · 기간 · 확인한 사실은 읽기만.
- 처방: 돌아갈 곳 한 자리 `backTo` = 빠진 정보 질문 → 채널(카톡을 되물은 한 줄만 · `read.branch === 'ask_kakao'`) · 확인 판 · 누구에게 → 빠진 정보(문자 갈래 · 물은 것이 있을 때) · 아니면 채널. 바닥 왼쪽 「‹ 빠진 정보 / 채널」(칼럼 단계 버튼과 같은 꼴).
  돌아가면 run.facts 의 혜택 · 기간 · 질문 답(질문 글로 짝)을 비어 있는 칸만 다시 채운다(다시 입력 0 · 적고 있는 칸은 덮지 않는다). 다시 「다음」= 확인 판(누구에게 · 대상 · 칼럼 그대로 · 대상 찾기 다시 안 걷음 = 부모 onRun 은 상태만 바꾼다).
- 시험 = `bug-1031-back-studio.test.ts` ①.

## 10. 링크 = 적은 그대로(1031 Harold 결정)

- 질문: 「https:// 를 꼭 붙일 필요가 있나 · 의미 없다」. 확인(코드): AI 한줄로 발송 = 주소 단축 · 클릭 집계 장치 0(그 자리에서 https:// 가 하는 일 0) · 여정 · 자동마케팅 = 단축 · 클릭 집계(short-url.ts URL_REGEX)가 http(s) 주소만 알아본다 · 서버 검사(new URL)는 https:// 가 있어야 읽는다. → Harold 「적은 그대로 넣기」.
- 처방: `readLinkText` 의 값(결정 · 저장 · 지문 · 문자에 넣는 값) = 사람이 적은 글자 그대로 · https:// 는 검사(`isWholeLink` · `httpLinkOk`)할 때만 붙여 본다 · `asciiLink` 는 https:// 없는 꼴도 적은 그대로(비 ASCII 만 붙였다 떼어 직렬화) · 저장값 읽기도 `readLinkText`.
- 판정 한 곳: 「링크가 결과에 있는가」(`ensureOnceLink`) · 「다시 쓰기가 링크를 뺐는가」(`rewriteDropsLinks` · 링크 CT voice-form-slots 로 옮김)가 `textLinks`(http 주소 + 공백으로 갈린 덩어리(괄호 · 끝 문장부호 뺀 몸)가 그대로 링크인 것) 하나로 같은 링크를 본다.
- 남김: 여정 · 자동마케팅에서 www 꼴로 적은 링크 = 단축 · 클릭 집계 밖(Harold 확인 · 받아들임).
- 링크 구간 읽기 한 곳(Codex 두 갈래 2R ② · 주소 경계 부류의 넷째 → 구조): `linkSpans` = 공백으로 갈린 덩어리마다 덩어리 몸(앞 괄호 · 끝 괄호 · 문장부호 뺀 것) 전체가 링크 꼴이면 그것 하나 · 아니면 그 안의 http(s) 주소. 링크 있음 · 다시 쓰기 · 사실 글 토큰화(`withLinkToken` · 덩어리 몸 통째 같음만 · 부분 문자열 0) · 한 줄 미리 채움(http 첫 개)이 이 구간을 함께 쓴다. 길이 상한은 사람이 적은 글자 검사에만(꺼낼 때 = 꼴만).
- 이미지 스튜디오: 누끼 ID 는 미리보기 받기 앞에 남긴다(미리보기 실패해도 상품 없는 유료 생성 0 · Codex 두 갈래 2R ①).
- 주소 끝 떼기 한 곳(Codex 두 갈래 3R · 경로 안 괄호 item(v2) 를 끝 괄호로 떼던 것): `trimLinkTail`(one-line-steps) = 끝 문장부호 · 닫는 따옴표 · 괄호는 떼고 `)` 는 짝이 모자랄 때만. `lineUrls` · `lineUrlSegments` · `linkSpans` 가 같은 규칙(전에는 두 정규식이 따로 · 둘 다 `)` 를 늘 뗌). 한 줄 단계 창 주소 읽기(lineUrls 소비처 line-mall-candidates · line-steps-context · one-line-ct/listen)도 경로 안 괄호를 지키게 된다.
