# C167-A 받는 분 화면 = 나가는 글 그대로 · 광고 표기 · 수신거부 줄 합성 CT 한 곳 (설계서)

> 카드 = STATUS-FEED C167 · 뿌리 = ROOT-LEDGER R111 · 접수 = 그룹웨어 오류접수 cmwvoybem2neqjnsc8xsmpd66(임은지 · 1125 14:36 · 한줄로 묻기)
> 순서 = status/DEFECT-PLAYBOOK.md · Harold 1127 「추천대로」 = (1) 받는 분 화면이 나가는 글 그대로 (2) 한줄로 묻기는 광고 고정 유지 + 그 사실을 화면에 한 줄

## §0 요약

- 접수 원문: 「미리보기 화면에 '보낼때 (광고)와 수신거부 번호가 붙어요.' 라고 기재되어 있긴 하지만 실질적으로 붙은 문안이 보여지면 좋을것 같습니다 … 업체들 보면 문안과 수신거부번호를 한줄 띄고 보내는 곳이 은근 많아서 직관적으로 보여야 조절해서 보낼거 같습니다. + 해당 기능은 (광고)성 문안에 대해서만 발송되는 게 맞을까요?」
- 판정 = 결함 셋(한줄로 묻기) + 같은 뿌리 화면 열(R111):
  1. 한줄로 묻기 3단계 편집칸 · 4단계 「받는 분 화면」 = 본문만 그린다(`AiAskPage.tsx:1219-1227` · `1326-1331`). 제목도 `(광고)` 없이.
  2. 080 번호를 화면이 받지 않아 바이트를 가짜 번호 `0800000000` 으로 잰다(`AiAskPage.tsx:57`).
  3. 보낼 본문 = `pickedBody.trim()`(`AiAskPage.tsx:641`) → 본문 끝 줄바꿈이 지워져 수신거부 줄 앞 간격을 고객이 조절할 수 없다. 스팸 검사 지문은 다듬지 않은 본문(`:693` · `:1320` spamFp(pickedBody …))이라 검사한 글 ≠ 보낸 글(끝 줄바꿈).
  4. 같은 뿌리 = 화면 12곳이 (광고) · 수신거부 줄을 공용 합성 함수(`buildAdMessageFront` = 서버 `buildAdMessage` 거울) 밖에서 따로 만든다. 그중 AI 한줄로(`AiLinePage.tsx:1581`) · 문안 고치기 창(`MessageEditorModal.tsx:114`) = 나가는 글과 다른 꼴, 직접발송 · 타겟발송 · 자동발송 편집칸 꼬리 = 번호에 하이픈을 넣어 그림(나가는 글 = 저장값 그대로).
- 질문 답: 한줄로 묻기는 지금 **늘 광고로 나간다**(`routes/ai-line.ts:457` adEnabled: true · 다듬기 isAd: true). Harold 결정 = 광고 고정 유지(묻기가 만드는 글 = 혜택 · 방문 유도 = 광고 · 정보성으로 끄면 표기 없는 광고가 나갈 길이 생긴다) · 화면에 한 줄로 알린다.

## §1 접수 대조표

| 접수 문장 | 맡는 축 | 없으면 |
|---|---|---|
| 「실질적으로 붙은 문안이 보여지면」 | §4-2 편집칸 위 · 아래 잠긴 글 · 4단계 = 나가는 글 그대로 | 고객이 실제 글을 모른 채 보냄 |
| 「한줄 띄고 보내는 곳이 은근 많아서 … 조절해서」 | §4-2 보낼 본문 = 끝 줄바꿈 보존(askSendBody 한 함수 · 미리보기 · 바이트 · 발송 · 검사 지문이 같은 글) | 끝 줄바꿈이 지워져 간격 조절 불가 |
| 「(광고)성 문안에 대해서만 발송되는 게 맞을까요」 | §4-2 안내 한 줄 「한줄로 묻기는 혜택과 방문을 알리는 문자라 늘 광고로 보내요」 | 사용자가 정보성 선택을 찾음 |
| (같은 뿌리) 다른 화면의 미리보기 ≠ 나가는 글 | §4-1 CT · §4-3 열두 곳 · §6 계약 시험 | AI 한줄로 등에서 같은 접수 재발 |

빠진 축 0.

## §2 흐름 표

### 2-1 한줄로 묻기 (3단계 편집 → 4단계 확인 → 적재 → 확정)

| # | 이음매 | 쓰는 쪽(화면) | 읽는 쪽(서버) | 값 범위 | 판정 |
|---|---|---|---|---|---|
| A1 | 080 번호 | 없음(`AskSegments` 에 칸 0 · `utils/ai-ask.ts:31`) | 확정 = `campaigns.ts:2959` getOpt080Number(보낸 계정 → 회사) | 계정 번호 · 회사 번호 · 둘 다 없음(빈 글) | **결함** — 화면이 모름 |
| A2 | 바이트 | `AiAskPage.tsx:57` sendBytes = buildAdMessageFront(body, ch, true, '0800000000') | 확정 = buildAdMessage(본문, 종류, 광고, 실제 080) | 실제 번호 길이 · 하이픈 유무 | **결함** — 가짜 번호 |
| A3 | 편집칸 | `:1219-1227` 제목 칸 · 본문 칸 · 「붙어요」 문구 | — | SMS · LMS · MMS | **결함** — 붙는 글 안 보임 |
| A4 | 4단계 받는 분 화면 | `:1326-1331` pickedSubject · pickedBody 그대로 | — | 같음 | **결함** |
| A5 | 보낼 본문 | `:641` body = pickedBody.trim() → `/ask/stage` message · `/direct-send/commit` message | `campaigns.ts` 확정 = 받은 글 그대로(`sanitizedMessage = message || ''` · D143 사용자 입력 보존) → buildAdMessage | 끝 줄바꿈 0 ~ n | **결함** — 끝 줄바꿈 삭제 |
| A6 | 스팸 검사 지문 | `:693` · `:1320` spamFp(pickedBody …) | 검사 = 카드 본문 | — | A5 와 다른 글(끝 줄바꿈) → askSendBody 한 함수로 |
| A7 | 광고 여부 | 화면 고르기 0 · 다듬기 isAd true(`:297`) | `/ask/stage` adEnabled: true(`ai-line.ts:457`) · 확정 adEnabled: true(`:683`) | 늘 광고 | 정상(유지) · 안내 한 줄 추가 |
| A8 | 제목 | `:1219` 제목 칸 · 4단계 pickedSubject | buildAdSubject(제목, 종류, true) = 「(광고) 제목」 | LMS · MMS 만 | **결함** — (광고) 안 보임 |

### 2-2 같은 뿌리 화면 열 (기계 추출 · 패턴 = §6 계약 시험의 세 식 · formatDate.ts · messageUtils.ts 밖 · 1127 실행 결과 23줄 중 화면 17줄)

| # | 자리 | 지금 그리는 글 | 나가는 글(서버 CT) | 판정 |
|---|---|---|---|---|
| S1 | `AiLinePage.tsx:1580-1582` AI 한줄로 문안 카드 | `(광고)⏎본문⏎무료거부 080-…`(종류 무관 · 번호 하이픈) | LMS `(광고) 본문⏎무료수신거부 {저장값}` · SMS `(광고)본문⏎무료거부{숫자}` | **다름** |
| S2 | `MessageEditorModal.tsx:113-115` 문안 고치기 창 미리보기(AI 한줄로) | S1 과 같은 꼴 | 같음 | **다름** |
| S3 | `DmSendAndTrackModal.tsx:339-341` DM 문자 미리보기 | `(광고) 본문⏎무료수신거부 {080 · 없으면 「(080 미등록 …)」}` | LMS 꼴(DM 문자 = LMS · `:344` · `:1009`) · 080 없으면 「무료수신거부」만 | 번호 없을 때 **다름**(안내 글이 본문에 섞임) |
| S4 | `make/MakeSendModal.tsx:315` · `:347` 만들기 문자 말풍선 | 꼬리 `무료수신거부 {080 · 없으면 「080 번호 필요」}` · 머리 `(광고)` | 같음(LMS) | 번호 없을 때 **다름** |
| S5 | `DirectSendPanel.tsx:394-398` 직접발송 편집칸 꼬리 | LMS `무료수신거부 {하이픈 넣은 번호}` | `무료수신거부 {저장값}` | 저장값에 하이픈이 없으면 **다름**(같은 화면 폰 미리보기 = 저장값) |
| S6 | `TargetSendModal.tsx:599-601` 타겟발송 편집칸 꼬리 | S5 와 같음 | 같음 | 같음 |
| S7 | `AutoSendFormModal.tsx:362-367` 자동발송 꼬리 | S5 와 같음 | 같음 | 같음 |
| S8 | `ChannelConvertModals.tsx:44-46` 넘침 판정 글 | 저장값 그대로 | 같음 | 같은 식 복사(공용 함수로) |
| S9 | `JourneysPage.tsx:436-443` adPrefixFor · adRejectFor | 저장값 그대로 | 같음 | 같은 식 복사 |
| S10 | `journey/PhoneComposer.tsx:75` 머리 | `(광고)` / `(광고) ` | 같음 | 같은 식 복사 |
| S11 | `kakao-send/FallbackPhoneModal.tsx:93` 머리 | 같음 | 같음 | 같은 식 복사 |
| S12 | `DirectPreviewModal.tsx:54-56` 제목 머리 | 빈 제목 = 빈 글 · 그 밖 `(광고) 제목` | buildAdSubject: 빈 제목 = `(광고)` | 빈 제목일 때 **다름** |

서버 6줄(범위 밖 · 미리보기가 아니라 그 자체가 나가는 글 · 매체가 다름): `services/ai.ts:2563` · `:2627`(AI 생성 후처리) · `utils/email-channel.ts:140` · `:659`(이메일) · `utils/planner-confirm.ts:428`(플래너 확인 제목 · buildAdSubject 와 같은 식) · `utils/sales-outreach-jobs.ts:1674`(영업 DM).

## §3 뿌리 (ROOT-LEDGER R111)

**R111 받는 분 화면이 나가는 글을 만드는 공용 합성(buildAdMessageFront · buildAdSubjectFront = 서버 buildAdMessage · buildAdSubject 거울)을 거치지 않고 화면마다 따로 그린다 — 안 그리거나(한줄로 묻기) · 다른 꼴로(AI 한줄로 · 고치기 창) · 다른 번호 표기로(편집칸 꼬리) · 화면이 쓰는 본문 · 080 이 발송과 다르게(가짜 번호 · trim).**
- 공용 합성 안에도 머리 · 꼬리 글 식이 있는데 그 조각을 밖으로 내주지 않아, 「잠긴 머리 · 꼬리를 따로 그리는」 화면들이 식을 복사했다(S5 ~ S11).

## §4 처방

### 4-1 화면 CT (`utils/formatDate.ts` · buildAdMessageFront 옆)

- `adPrefixFront(msgType)` = SMS `(광고)` · LMS · MMS `(광고) ` (서버 buildAdMessage 의 adPrefix 거울).
- `adFooterFront(msgType, optOutNumber)` = 서버 `adRejectFooterText` 거울(LMS · MMS `무료수신거부 {저장값}` · SMS `무료거부{숫자}` · 번호 없음 = 낱말만).
- `buildAdMessageFront` 는 이 둘을 쓴다(결과 글자 무변경).

### 4-2 한줄로 묻기

- 서버 `GET /ask/segments` 응답에 `opt080` = getOpt080Number(보는 사람 = 보내는 사람, 회사)(확정 `campaigns.ts:2959` 와 같은 함수 · 같은 인자) · 없으면 빈 글 `''`.
- 화면 CT `utils/ai-ask.ts`:
  - `askSendBody(raw)` = 앞 공백 · 끝의 줄바꿈 아닌 공백만 걷고 **끝 줄바꿈은 둔다**. 쓰는 곳 = 바이트 · 4단계 · 적재 · 확정 전부(따로 trim 0 · 검사 지문 spamFp 는 카드 칩과 같은 글 = pickedBody 그대로 · §10 구현에서 정한 것). 빈 문안 · 최소 길이(5자) 판정 = `askSendBody(raw).trim()` 길이(끝 줄바꿈으로 4자 문안이 통과하지 않게 · Codex 설계 1R #3).
  - `askSendSubject(channel, raw)` = SMS 면 `''` · 아니면 trim 뒤 LMS_SUBJECT_MAX_CHARS 자르기(지금 확정 `:642` 식을 옮김) · 확정 · 4단계 · 편집칸 미리보기가 같이 쓴다(Codex 설계 1R #2 앞 절반).
  - `askOpt080Of(seg)` = 응답에 칸이 있으면 그 값(빈 글 = 미등록) · **칸이 없으면(옛 서버 · 배포 창) 「모름」** → 꼬리 표시 = 「무료수신거부 (번호 확인 중)」 · 미등록 안내 0(Codex 설계 1R #4) · 바이트(표시 · 막기) = 지금 화면과 같은 10자리 `0800000000` 으로 셈(옛 화면과 같은 판정 = 회귀 0 · Codex 설계 2R #3). 배포 순서 = 백엔드 재시작 → 프론트(원장 줄에 적음).
- 3단계 편집칸: 제목 칸 앞 잠긴 `(광고)`(LMS · MMS) · 본문 칸 위 잠긴 머리 · 아래 잠긴 꼬리(adFooterFront · 회색 · 고칠 수 없음 표시) · 안내 줄 = 「한줄로 묻기는 혜택과 방문을 알리는 문자라 늘 광고로 보내요. 회색 글은 보낼 때 붙어요. 수신거부 줄과 한 줄 띄우려면 문안 끝에서 줄을 두 번 바꿔 주세요.」(서버 buildAdMessage = 끝 줄바꿈 수와 1 중 큰 수만큼 줄을 바꾼다 · 한 번 = 빈 줄 0 · 두 번 = 빈 줄 1) · 080 이 미등록이면 꼬리 아래 「수신거부 번호(080)가 없어요. 회사 설정에서 등록해 주세요.」
- 4단계 받는 분 화면 = buildAdSubjectFront(askSendSubject(종류, 제목), 종류, true) · buildAdMessageFront(askSendBody(본문), 종류, true, opt080) 그대로 · 안내 = 「이 모습 그대로 나가요. 칼럼 자리는 받는 분마다 바뀌어요. 고치려면 「이전」으로 돌아가 주세요.」
- 바이트 = calculateSmsBytes(buildAdMessageFront(askSendBody(본문), 종류, true, 번호)) · 가짜 번호 상수 삭제.

### 4-3 같은 뿌리 열두 곳

| # | 고침 |
|---|---|
| S1 | activeBody = buildAdMessageFront(rawActiveBody, 지금 종류, isAd, rejectNumber) (하이픈 넣기 · 인라인 바이트 셈 그대로 = 합성 글로) |
| S2 | previewBody = buildAdMessageFront(draft, 창의 종류, isAd, rejectNumber) · 안내 문구의 「(광고)·무료거부」 = 낱말 유지 |
| S3 | 서버 `routes/dm.ts:1515-1530` 과 같은 차례 = 광고면 문안을 trim · 광고 표기 걷기(새 화면 거울 `stripAdPartsDeepFront` = 서버 stripAdPartsDeep 거울 · 거울 시험) → 견본 치환 · 링크 넣기 → 광고 · 본문 있으면 buildAdMessageFront(…, 'LMS', true, opt080) · 아니면 그대로(지금 광고 여부 · 빈 본문 갈래 · 꼴 = LMS 그대로 · Codex 설계 1R #1 · 2R #2 = 붙여 넣은 옛 수신거부 줄 대신 설정 번호) · 080 없음 안내는 미리보기 아래 따로 한 줄 |
| S4 | tail = adFooterFront('LMS', opt080) · 머리 = adPrefixFront('LMS') · 080 없음 안내 따로 |
| S5 · S6 · S7 | 꼬리 = adFooterFront(종류, optOutNumber)(저장값 그대로 = 같은 화면 폰 미리보기와 같은 글) |
| S8 | optOutText = adFooterFront(종류, optOutNumber) |
| S9 | buildPreview 전체 = buildAdMessageFront(원문, 대문자 종류, isAd, opt080)(빈 원문 · 광고 아님 = 원문 그대로 · 인라인 머리 · 꼬리 함수 둘 삭제 · 끝 줄바꿈 · 이미 있는 수신거부 줄 처리가 서버와 같아진다 · Codex 설계 1R #5) |
| S10 · S11 | 머리 = adPrefixFront(종류) |
| S12 | subjectWithAd = buildAdSubjectFront(directSubject, directMsgType, adTextEnabled) |

## §5 영향표

| 바뀌는 것 | 소비처 | 영향 |
|---|---|---|
| formatDate 새 함수 둘 · buildAdMessageFront 내부 | buildAdMessageFront 호출 40여 곳 | 결과 글자 무변경(시험 = 서버 거울 표) |
| `/ask/segments` 응답 칸 `opt080` | AiAskPage 한 곳 | 추가만 |
| 한줄로 묻기 보낼 본문 끝 줄바꿈 보존 | 적재 · 확정 · 검사 지문 | 끝 줄바꿈을 넣은 사람만 수신거부 앞 빈 줄(서버 buildAdMessage 가 그 수만큼 띄움 · 이미 직접발송이 같은 규칙) |
| S1 ~ S12 | 그 화면 미리보기 · 꼬리 표시 · 바이트 표시 | 표시만 · 발송 0 |

미가입 · 직접발송만 쓰는 회사 = 직접발송 편집칸 꼬리 번호 표기(S5)가 저장값 그대로로 바뀜(폰 미리보기 · 실제 발송과 같은 글) · 발송 · 판정 · 과금 0.

## §6 계약 시험 · 변이

- R111 뿌리 시험(`root-ledger.test.ts`): `packages/frontend/src` 시험 밖 소스에서 세 식(꼬리 `무료\s*(수신)?\s*거부\s*(\$\{|['"`]\s*\+)` · 머리 끼움 `\(광고\)\s?(\\n)?\$\{` · 머리 두 꼴 한 줄 `'(광고)'` + `'(광고) '`) = 0줄(주인 = `utils/formatDate.ts`) · `AiAskPage.tsx` 에 `0800000000` · `pickedBody.trim()` 0 · 4단계 · 바이트가 `askSendBody(` 를 지남.
- 거울 시험: adPrefixFront · adFooterFront = 서버 buildAdMessage 의 머리 · adRejectFooterText(SMS · LMS · MMS × 번호 있음 · 하이픈 있음 · 없음).
- askSendBody 단위: 끝 줄바꿈 둘 보존 · 앞 공백 · 끝 공백 걷음 · buildAdMessageFront(askSendBody(x)) 가 서버 buildAdMessage(같은 글)와 같다.
- `/ask/segments` 응답 opt080 = getOpt080Number 결과(라우트 소스 계약).
- 변이(사본) = S1 인라인 되살림 · AiAskPage 가짜 번호 되살림 · askSendBody 를 trim 으로 → 빨간불.

## §7 직원 지시문 (C167-S1-A · 테스트계정 · 직원 휴대폰)

| 순 | 하세요 | 보이면 맞음 |
|---|---|---|
| 1 | AI 한줄로 → 「한 줄로 묻기」에서 3단계까지 가서 문안을 만든다 | 본문 칸 위에 회색 「(광고)」, 아래에 회색 「무료수신거부 080…」(회사 설정의 번호 그대로)이 보인다 |
| 2 | 본문 칸 맨 끝(마지막 글자 바로 뒤)에서 엔터를 두 번 누른다 | 4단계 「받는 분 화면」에서 본문과 「무료수신거부」 사이에 빈 줄이 하나 있다 |
| 3 | 4단계 받는 분 화면의 제목을 본다(LMS) | 제목 앞에 「(광고)」가 붙어 있다 |
| 4 | 본인 휴대폰 한 명만 받게 해서 보낸다 | 받은 문자가 4단계 받는 분 화면과 글자 · 빈 줄까지 같다 |
| 5 | AI 한줄로에서 문안 카드를 본다(LMS) | 맨 앞 「(광고) 」 뒤에 본문이 같은 줄로 이어지고, 끝 줄이 「무료수신거부 080…」 |
| 6 | 직접발송에서 광고를 켜고 LMS 로 바꾼다 | 편집칸 아래 꼬리와 오른쪽 폰 미리보기의 번호 표기가 같다 |

## §8 배포

백엔드(`routes/ai-line.ts`) + 프론트. DDL 0 · ENV 0. 원장 = C167-H1.

## §9 범위 밖 (기록만)

- 서버 6줄(§2-2 끝) · 한줄로 묻기 080 없음일 때 발송을 막을지(지금 직접발송 · 묻기 모두 막지 않음 · 분할만 막음 `campaign-split.ts:465`).
- DM 「짧게」 고른 건이 서버 치환 뒤 90바이트 안이면 SMS 로 나가는데 미리보기는 늘 LMS 꼴(이전부터 같음 · 받는 사람 치환 견본을 서버에서 받아야 갈래를 정할 수 있음 · Codex 설계 1R #1 뒤 절반).
- 확정 단계에서 서버가 최신 080 으로 바이트를 다시 재는 것(080 미등록으로 연 화면에서 그 사이 11자리 번호를 처음 등록 + 정확히 90바이트 경계 = 옛 화면과 같은 판정 · Codex 구현 2R #1 불수용 · 적재 · 확정 계약을 바꾸는 별도 과제).
- 도착 확인(`routes/ai-line.ts` /spam-test · AI 한줄로와 공용)은 본문을 trim 해 검사한다 — 끝 빈 줄만 다른 글은 스팸 검사 장치 전체가 같은 글로 묶는 규칙(computeMessageHash · normalizeContent)과 같은 부류라 손대지 않는다(Codex 설계 2R #1 불수용).
- 한줄로 묻기 4단계 · 바이트가 칼럼 자리(치환 전)로 그려 · 센다(이전부터 같음 · 칼럼이 든 SMS 는 서버가 LMS 로 보냄 · 받는 사람별 견본은 별도 과제 · Codex 설계 1R #2 뒤 절반).

## §10 Codex 리뷰 기록

### 설계 (gpt-6.2-sol · high · 하위 0)

| R | 지적 | 판정 |
|---|---|---|
| 1 | DM 광고 고정 · 4단계 제목 · 엔터 두 번 · 최소 5자 · 옛 응답 080 · 여정 buildPreview 전체 | 수용 5(DM 짧게 SMS 꼴 · 개인화 견본 = 이전부터 같음 → §9) |
| 2 | 도착 확인 trim · DM 붙여 넣은 옛 수신거부 줄 · 080 모를 때 넉넉한 추정이 정상 SMS 막음 | 수용 2 · 불수용 1(검사 장치 공백 정규화 = 같은 부류 · §9) |
| 3 | — | approve |

### 구현에서 정한 것

- 검사 지문(spamFp)은 다듬지 않은 본문(pickedBody) 그대로 둔다 — 카드 칩(LineResultCards)이 같은 글로 지문을 찍어 두 쪽이 같은 글이어야 「검사한 글 = 지금 글」 대조가 맞는다(askSendBody 는 앞 공백 · 끝 공백만 다르고 끝 줄바꿈은 같다).
- 편집칸 잠긴 머리 · 꼬리 = 새 공용 함수 `adLockedPartsFront`(옛 PhoneComposer 의 같은 계산을 올림 · 여정 편집칸 · 카카오 대체 문자 창 · 한줄로 묻기가 같이 씀).
- 여정 카드 미리보기의 카카오 단계 = 옛 꼴(SMS 머리 · 꼬리) 그대로(범위 밖).

### 구현 (gpt-6.2-sol · high · 하위 0)

| R | 지적 | 판정 |
|---|---|---|
| 1 | 080 미등록으로 연 화면에서 그 사이 번호를 등록하면 화면 바이트 통과 · 발송 넘침 · 만들기 DM 이 붙여 넣은 옛 표기를 걷지 않음 | 수용 2(미등록 = 옛 10자리로 넉넉히 · stripAdPartsDeepFront) |
| 2 | 그 사이 11자리 080 을 처음 등록 + 90바이트 경계 | 불수용(옛 화면과 같은 판정 = 이전부터 같음 · 11자리로 넉넉히 세면 미등록 회사 경계 SMS 회귀 · §9 별도 과제) · 「080 모를 때 바이트」 = 설계 2R · 구현 1R · 2R 같은 부류 세 번(보고) |
| 3 | — | approve |

- 변이(사본 · 원복 바이트 대조) A1 ~ A5 다섯 모두 빨간불(1127).
