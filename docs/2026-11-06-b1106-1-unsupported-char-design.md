# C109 · B-1106-1 「문자로 보낼 수 없는 글자」 판정 자리 전체 · 설계서 (2026-11-06)

> 카드 C109 · 흐름 표 = [docs/2026-11-06-b1106-1-unsupported-char-flow-ledger.md](2026-11-06-b1106-1-unsupported-char-flow-ledger.md)(입구 15 · 결함 D1 ~ D7) · 결함 플레이북 3단계 산출물.
> Harold 결정(1106): 「추천안으로 설계서 → 구조체크(결함 닫힐 때까지) → Codex 설계(approve 까지) → 구현 → Codex 구현(approve 까지) → 보고」.
> 추천안 = ①대행 접수 (다) ②AI 글 = 만든 즉시 같은 표로 정리 · 사람 글 저장 = 막고 어느 글자인지 ③명단 값 = 접수 때 명단 전체를 같은 규칙으로 ④범위 = 전 기능.
> ③은 브리핑에서 추천을 따로 적지 않았다 → ①과 같은 규칙으로 정했다(명단 값도 그 고객에게 나가는 글 · 다른 규칙이면 같은 글자가 문안에선 빠지고 이름 칸에선 반려된다).

## §0 진행 표

| 단계 | 상태 |
|---|---|
| 흐름 표(1단계) | 1106 작성 · Harold 「추천안으로」 |
| 설계서(3단계) | 이 문서 |
| 설계 구조체크 | §10 · 3회차 새 결함 0 = 닫힘(결함 11 반영) |
| Codex 설계 | §11 · 5R approve(1R 8 · 2R 5 · 3R 2 · 4R 1 반영) |
| 구현 · 계약 시험 · Codex 구현 | §12 · Codex 구현 2R approve(1R 4 반영 · §11-2) · tsc 0 · 0 · 실 PG 60 / 424 · 변이 12 빨간불 |
| 배포 · 직원 확인 | 원장 C109-S1 · §14 |

## §1 원칙

- **P1 글자 다루기는 한 곳** — 「문자로 보낼 수 없는 글자」를 어떻게 다루는가 = `utils/message-sanitizer.ts` 의 분류 CT `smsCharAction` 하나(R1 넓힘). 보낼 수 있는 글자(`sms-charset.isSmsEncodableChar` · 게이트웨이 표) = 그대로 · 보낼 수 없는 글자 = **뺌**(이모지 범위 `EMOJI_RANGES` · 결합 글자 `COMBINING_CHARS`) · **바꿈**(바꿈 표 `SPECIAL_CHAR_MAP` · 빈 글자로 바꾸는 보이지 않는 글자 포함) · **막음**(그 밖 = 뺄 수도 바꿀 수도 없는 글자). 이 분류 = 지금 여정 발송 정리 `sanitizeUnsendableForSms`(`message-sanitizer.ts:222-259`)가 쓰는 규칙 그대로(새 규칙 0 · 막음 = 그 함수가 그대로 남겨 게이트웨이 9401 로 실패하던 글자). 지금 이 판단을 따로 하는 자리 = 넷(검사 입구 표 · `stripIncompatibleEmojis` 범위 목록 · `copy-exit-guards.stripEmojis` 정규식 · `sanitizeForSms` 의 막음 글자 남김) → 전부 이 CT 로(§2-2 · 구조체크 S1 · S2).
- **P2 글을 쓰는 자리에서 판정한다**(새 뿌리 R68) — 받아 놓고 뒤에서 멈추지 않는다.
  - 사람 글 · 대행(접수 셋 · 문안 수정 · 명단 값) = **(다)**: 뺌 · 바꿈은 적용하고 「어느 줄 어디서 무엇을」 알린다 · 막음은 위치를 적어 반려.
  - 사람 글 · 화면 저장(자동발송 본문 · 제목 · 대체 문안 · 자동 마케팅 직접 쓴 문안 · 리마인드 · 플래너 편집) = **막고 위치 안내**(Harold ② · 뺌 · 바꿈 글자도 막는다 · 화면에서 바로 고칠 수 있다).
  - 사람 글 · 여정 칸 = 지금처럼 발송 정리가 뺌 · 바꿈(이미 그렇게 나간다 · 바꾸지 않는다) + **막음 글자만** 보낼 글 판정 CT-J10 에 새 코드(칸 저장 · 켜기 · 발송 직전 · 보류 안내가 같은 문장 · 구조체크 S4).
  - AI 글(문안 출구 CT · 대행 다듬기 · 자동 마케팅 나가는 글 · 여정 AI 글) = 뺌 · 바꿈 · 막음 **전부 정리**(고객 문안이 아니다 · 알림 0).
- **P3 검사 반려는 장비 장애가 아니다**(R7 넓힘) — 검사 입구가 글자로 거절한 것 = 판정 `rejected` · **다시 검사 0** · 사람 안내 = 「어느 글자 · 어디」. 판정 값 여섯째 = tsc 가 받는 쪽 빠짐을 잡는다(`satisfies` · Record).
- **P4 글자 이름 · 위치는 한 함수가 말한다** — `describeSmsCharFindings` 하나(검사 반려 · 대행 회신 · 화면 저장 반려 · 담당자 문자 · CT-J10). 문자로 가는 안내에는 그 글자를 넣지 않는다(안내 문자도 못 나간다) → `3번째 줄 '여름 세일' 뒤 이모지(U+1F60A)` 꼴.
- **P5 검사는 문안을 본다** — 검사 입력에 치환해 넣는 값(표본 고객 · 여정은 회사 · 외부 값까지)의 보낼 수 없는 글자는 검사 전에 정리한다(값 하나 때문에 문안 판정이 막히지 않게 · 구조체크 S5 · Codex 1R #7). 대행 명단 값은 접수 때 이미 정리된다(P2).
- **P6 막음 판정 · 정리는 최종 글에서** — 입력 칸 목록만 보면 칸 하나(혜택 · 이름 · 파일 이름)가 빠진다(Codex 1R #2 · #4). 나가는 글을 **치환 · 조립이 끝난 뒤** 판정하는 자리 = 자동 마케팅 나가는 글 CT(승인 · 발송 관문) · 안내 문자 적재(효과 자리) · 대행 = 요청서를 읽은 직후(모든 분석 앞 · Codex 1R #1 · #3 · #5). 입력 관문은 그 위에 얹는 사람 안내다.

## §2 CT 설계

### 2-1 `utils/message-sanitizer.ts`

```ts
export type SmsCharAction = { action: 'keep' } | { action: 'remove' } | { action: 'replace'; to: string } | { action: 'block' };
export function smsCharAction(ch: string): SmsCharAction       // 순서 = 보낼 수 있음 → keep · EMOJI_RANGES → remove · COMBINING_CHARS → remove · SPECIAL_CHAR_MAP → replace(to) · 그 밖 → block
export interface SmsCharFinding { char: string; code: string; action: 'remove' | 'replace' | 'block'; to?: string; line: number; before: string }
export function scanSmsText(text: string): { cleaned: string; findings: SmsCharFinding[] }   // cleaned = remove 만 빠지고 replace 적용 · block 은 남는다(= sanitizeUnsendableForSms 와 같은 글)
export function cleanSmsTextAll(text: string): string           // AI 글 · 표본 값 정리 = cleaned 에서 block 글자도 뺀다
export function describeSmsCharFindings(findings: SmsCharFinding[], opts?: { max?: number; where?: string }): string[]
export function smsTextBlockReason(fields: Array<{ label: string; text: string | null | undefined }>): string | null   // 사람 글 화면 저장 관문(보낼 수 없는 글자 하나라도 = 문장)
export function assertSmsTextSendable(fields: ...): void        // smsTextBlockReason 이 있으면 UserFacingError(400, 'UNSUPPORTED_CHARS', 문장)
```

- `sanitizeUnsendableForSms` = `scanSmsText` 위에 다시 짠다 · **반환 모양 · 값 그대로**(sanitized · warnings · hadChanges · removedEmojis · replacedChars) — 계약 시험 K1 = 옛 본문 대조본과 표본 묶음에서 출력이 같다(공용 함수 동작 캡처).
- `sanitizeForSms`(AI 여정 글 · `message-sanitizer.ts:154` · 부르는 곳 = 여정 AI 생성 · 편집 · 자동 마케팅 꾸미기 · A/B 변형 = 전부 AI 글): 보낼 수 없는 글자의 갈래 = `smsCharAction` · 막음 글자도 뺀다(옛: 남김 · 구조체크 S2) · 보낼 수 있는 글자에 대한 옛 정규화(★ → * 등)는 그대로(이번 축 밖 · B-0910-5 기록).
- `before` = 그 글자 앞 같은 줄의 보낼 수 있는 글자 최대 8자(줄 맨 앞이면 '' → `n번째 줄 맨 앞`). 줄 = `\n` 기준 1부터.
- 글자 이름 = 이모지(EMOJI_RANGES) · 보이지 않는 글자(빈 글자로 바꾸는 바꿈 표 항목 · 결합 글자) · 특수 기호(그 밖 바꿈 표 항목) · 보낼 수 없는 글자(막음) — 이름 + `(U+XXXX)`.
- `describeSmsCharFindings` 꼴 = `3번째 줄 '여름 세일' 뒤 이모지(U+1F60A)` · 같은 글자 · 같은 줄 · 같은 앞 글자는 한 번 · `max`(기본 5) 넘으면 `외 n곳` · `where`(예: `명단 3행 이름 칸` · `제목`)가 있으면 줄 앞에 그 말.

### 2-2 보낼 수 없는 글자를 지우는 자리 넷 → CT

| 자리 | 지금 | 새 | 바뀌는 글자(보낼 수 없는 글자뿐 · 보낼 수 있는 글자 = 그대로) |
|---|---|---|---|
| `services/ai.ts stripIncompatibleEmojis`(`:2456-2480`) | 범위 목록 블랙리스트 | 글자 부분 = `cleanSmsTextAll` · 공백 정리 그대로 | U+2300~23FF · U+2B00~2BFF(별 이모지 U+2B50) · U+E0020~E007F · U+20E3 = 지움 · 바꿈 표 글자(U+00A0 → 공백 · U+200B → 빈 글자 · 줄표 변형 → `-`) · 막음 글자 = 지움(옛: 남겨 검사 반려 · 9401) · 안전 목록 49자 = 전부 보낼 수 있는 글자라 그대로(실행 확인 1106) |
| `utils/copy-exit-guards.ts stripEmojis`(`:50-` · 쓰는 곳 `applyCopyExitGuards` `:176-179` = AI 문안 출구 CT · 생성 `services/ai.ts:1424` · 목소리 견본 `brand-voice-sample.ts:86`) | 정규식 범위 목록 · **본문만** | 본문 · 제목 둘 다 `cleanSmsTextAll`(카카오 제외 그대로 · 구조체크 S1) | 위와 같은 갈래 · 제목도 정리(옛: 제목 0) |
| `message-sanitizer.ts sanitizeForSms` | 막음 글자 남김 | 막음 글자도 뺌(2-1) | 막음 글자 |
| `utils/auto-notify-message.ts:145-160`(담당자 알림 미리보기 글 · 문자로 나간다) | 꾸밈 기호 제거 + 이모지 범위 정규식 | 지금 꾸밈 제거 그대로 + 끝에 `cleanSmsTextAll`(구조체크 S3) | 범위 밖 보낼 수 없는 글자(옛: 남아 알림 문자 9401) |

- 예외(이유를 시험에 적는다 · 기계 추출 K2 가 이 셋만 남는가 본다): `utils/one-line-ct/ai.ts:38`(AI 한줄로 칸 값 = 문자 · DM · 이메일 공용 · 문자로 나가는 글은 문안 출구 CT 와 검사 입구가 본다) · `utils/brand-voice-validator.ts:36`(목소리 판정만 · 글을 바꾸지 않는다) · `utils/sns-caption-rules.ts:43`(SNS · 문자 아님).

### 2-3 대행 글 준비 CT `utils/agency-send-chars.ts`(새 · 대행 입구 공용)

```ts
export type AgencyCharPrep<R> =
  | { ok: true; content: string; subject: string; recipients: R[]; notice: string[] }   // notice = 뺌 · 바꿈 알림 줄(없으면 [])
  | { ok: false; status: 400; code: 'UNSUPPORTED_CHARS'; error: string };              // 막음 · 위치(문안 줄 · 제목 · 명단 행 · 칸)
export function prepareAgencyText<R extends { vars?: Record<string, any> | null }>(input: { content: string; subject?: string | null; recipients?: R[] }): AgencyCharPrep<R>
```

- 문안 · 제목 = `scanSmsText` → block 하나라도 = 반려 `문안에 문자로 보낼 수 없는 글자가 있어 접수하지 못했습니다: 3번째 줄 'caf' 뒤 보낼 수 없는 글자(U+00E9). 그 글자를 빼거나 바꿔 다시 보내 주세요.` · 없으면 cleaned + notice `문자로 보낼 수 없는 글자를 빼고 접수했습니다: 3번째 줄 '여름 세일' 뒤 이모지(U+1F60A)`.
- 명단 값 = 각 행 vars 의 문자열 값 전부(③ · 행 번호 = 명단 순서 1부터) · 같은 규칙 · 반려 위치 = `명단 n행 ○○ 칸`(최대 20 · `외 n곳`) · 알림 = `명단 m곳에서 보낼 수 없는 글자를 뺐습니다(예: 명단 3행 이름 칸 이모지(U+1F60A))`(예 최대 3).
- **자리 = 요청서를 읽은 직후 · 모든 분석 앞**(Codex 1R #1 · #3 · #5): 원스텝 · 메일 = `analyzeOneStep`(`agency-send-intake.ts:619` · 부르는 곳 = 원스텝 미리보기 `routes/agency-send.ts:334` · 확정 `:366` · 메일 `agency-send-mail-worker.ts:1033`) 이 양식 · 명단을 읽은 바로 뒤(유형 · 바이트 `:857-861` · 변수 이름 `:734-735` · 수신자 vars `:798-804` 보다 앞) · 화면 = `createRequestCore` 맨 앞(화면 접수는 분석이 core 안). `createRequestCore` 는 같은 CT 를 다시 부른다(이미 정리된 글 = 찾는 것 0 · 막음 = 반려 · 마지막 문). 그 뒤 모든 판단(메일 중복 조회 `agency-send-mail-worker.ts:1058-1080` · 같은 메일 안 첨부 중복 · 유형 · 바이트 · 빈 값 · 길이 · 변수)은 정리된 글로.
- **변수 토큰 안**(`%이름%` 사이)의 보낼 수 없는 글자 = 뺌 · 바꿈 글자여도 **막음으로 반려**(`변수 %고객😊% 이름에 …` 꼴 · 토큰 · 매핑 · 수신자 키를 함께 바꾸지 않는다 · Codex 1R #3).
- **정리 후 빈 값** = 반려(`문안에 보낼 수 있는 글자가 없습니다` · Codex 1R #5).

## §3 처방(결함마다 · 흐름 표 D1 ~ D7)

### D1 대행 문안을 쓰는 자리 셋 + 명단 값에 판정 0

- 접수 공용 `createRequestCore`(`agency-send-intake.ts:249` · 입구 셋 = 화면 `routes/agency-send.ts:241` · 원스텝 `:396` · 메일 `agency-send-mail-worker.ts:1150`): 빈 값 검사(`:298-299`) 바로 뒤 `prepareAgencyText(content · subject · recipients)` → 반려 = `{ ok:false, status:400, error, code }`(입구 셋이 그대로 내보낸다: 화면 400 JSON · 메일 `reject` → `buildRejectedReply` 사유 줄) · 통과 = 정리된 글 · 명단으로 이어 가고 결과에 `notice`.
- 알림 배선
  - 화면 = 201 응답 `notice` → 접수 성공 자리(구현 때 `AgencySendComposer` · 원스텝 확인 화면의 성공 분기를 grep 으로 찾아 둘 다)에 한 줄씩.
  - 메일 = `buildAcceptedReply`(`agency-send-mail-worker.ts:186`) 입력 `charNotes?: string[]` · 블록 「보낼 수 없는 글자를 빼고 접수했습니다」(이미지 규격 알림 `imageFitNotes` 와 같은 꼴) · 회신의 문안 = 정리된 글.
  - 이력은 **접수 · 문안 수정과 같은 트랜잭션**에서 쓴다(Codex 2R #3 · 지금 `logEvent` `agency-send-intake.ts:230-235` 는 실패를 삼키고 수정 이력은 COMMIT 뒤 `agency-send-change.ts:170 · 178` → 이 두 이력만 트랜잭션 쓰기 `logEventTx(run, …)` · 실패 = 접수 · 수정째 롤백). 분석 단계(analyzeOneStep)의 알림은 결과에 실려 core 까지 가고 core 의 다시 보기(정리된 글 = 빈 결과)가 덮지 않는다(합친다 · 메일 다건 = 요청서마다 · Codex 2R 다음 단계 ③).
  - 이력 = 문안 · 제목 = `content_cleaned` · 명단 = `recipients_cleaned` **두 종류**(Codex 1R #8 · 유효기간이 다르다: 문안 수정은 문안 이력만 바꾸고 명단 이력은 그대로) · 접수 이력과 같은 자리(메일은 커밋 뒤 이력 고리 `:1203` 근처) · 화면 이력 `AgencyEventLog.tsx` = 각각 「보낼 수 없는 글자를 빼고 접수했습니다」 · 「명단에서 보낼 수 없는 글자를 뺐습니다」 + 줄.
  - 승인 요청 문자(`buildPassedNotify` `agency-send-notify.ts:58`) = 가장 최근 `content_cleaned` · 가장 최근 `recipients_cleaned` 의 줄이 있으면 각 한 줄 `보낼 수 없는 글자를 빼고 보냅니다: (첫 줄 · 외 n곳)` · 읽기 = 워커가 통과 알림을 만들 때 이력 한 줄 SELECT(새 SQL · §6 · 실 PG P1). 버전으로 읽지 않는다(다듬기가 버전을 올린다 · `saveTestResult` `:513-523` · 구조체크 S7). **사람이 문안을 고치면 줄이 없어도 `content_cleaned`(lines = [])를 남긴다**(옛 접수 때 이력이 고친 글에 붙지 않게 · 구조체크 S10) · 접수는 줄이 있을 때만 남긴다.
- 문안 수정 `agency-send-change.ts:156`(글 고치기 · 맞춤법 고침): 같은 `prepareAgencyText`(문안 · 제목만) · 반려 = `fail(400, …)` · 통과 = 정리된 글 저장 + `content_cleaned` 이력(줄이 없어도 · S10 · 기존 `content_edited` 이력 `:178` 과 같은 자리) + 응답 `notice`.
- 다듬은 문안(AI) = `runSpamRound`(`agency-send-worker.ts:420-432` 다듬기 직후 `content = refined.content` 자리) `cleanSmsTextAll`(P2 AI 글 · 알림 0).

### D2 판정이 글자 목록을 버림 + D3 반려 = 장애

- `enqueueSpamTest` 글자 판정(`spam-test-queue.ts:590-602`): 반환에 `unsupportedChars`(코드 목록) · `error` = `문자로 보낼 수 없는 글자가 있어 검사하지 않았어요: ` + `describeSmsCharFindings(scanSmsText(나갈 글) · 뺌 · 바꿈 · 막음 전부 · 제목은 where '제목')`.
- `runOneTest`(`:1491-1494`): `errorCode === 'SMS_UNSUPPORTED_CHARS'` 면 `{ enqueued:false, spamResult:'rejected', rejection: error }` · 그 밖 실패 = 'failed'. 기본 모드 고리(`:1554-1558`)는 one.spamResult · rejection 을 결과에 싣는다 · 차례 모드(`sequenceSpamVariants`)는 'rejected' 를 재생성하지 않는다(재생성 = 차단에만 · 지금 규칙).
- 결과 모양 = **반려면 사유가 필수인 갈래 타입**(Codex 1R #6): `AutoSpamVariantResult = { …; spamResult: Exclude<AutoSpamVerdict, 'rejected'> } | { …; spamResult: 'rejected'; rejection: string }` · 차례 검사 어댑터(`spam-test-queue.ts:1527-1534` · `sequenceSpamVariants` 결과 조립 `:1385-1389` · `:1409-1411`) · 플래너 반환(`planner-copy.ts:263-267` = `{ verdict:'rejected'; rejection } | {…}`) · 자동 마케팅 목록 응답 `copyCheck`(`continuous-operator.ts:2062-2070` 에 `'rejected'` · 옛: rechecking 으로 접힘) · 판정 문자열을 읽는 자리(`recheck.result` · `.spamResult` · `copyCheck`)를 소스에서 뽑아 전수 확인(K4).
- 판정: `SpamVerdict` 에 `'rejected'` · `spamVerdictOf` = `spamResult === 'rejected'` → `'rejected'`(장애 판정 앞) · `SPAM_VERDICT_WORD.rejected = '보낼 수 없는 글자'` · `spamVerdictWithRetry` = 장애만 다시(지금 고리 그대로 = 'rejected' 첫 회 반환 · 계약 시험) · `mergeAlternativeVerdicts` = 통과 > 확인 중 > 검사 중 > 차단 > **보낼 수 없는 글자** > 장애 · `mergeSpamVerdicts`(`journey-pretest-validator.ts:261`) = 차단 > **보낼 수 없는 글자** > 장애 > 확인 중 > 검사 중 > 통과.
- 읽기 CT `spamRejectionOf(variant)`(spam-test-queue.ts) = 반려 문장 하나(없으면 기본 문장 · 호출부가 같은 말을 쓴다 · P4).
- **저장 · 복원 = 한 값 `SpamCheckRecord`**(Codex 2R #5 · 1R #6 과 같은 부류 둘째 → 왜: 사유를 판정 옆 옵션 칸으로 덧붙여, 판정을 JSON 으로 저장 · 복원하는 자리마다 손으로 옮겨야 했다 · 한 자리만 빠져도 사라진다): `type SpamCheckRecord = { result: Exclude<AutoSpamVerdict, 'rejected'> } | { result: 'rejected'; rejection: string }` · 쓰기 CT `toSpamCheckRecord(variant)` · 읽기 CT `readSpamCheckRecord(json)`(옛 문자열 · 옛 객체도 읽는다 · 'rejected' 인데 사유 없음 = 기본 문장). 저장 자리 = 자동 마케팅 안별 결과(`continuous-operator.ts:1790-1797`) · 시스템 재검사(`:2277-2281`) · 화면 재검사 결과(`:2422-2430`) · 직접 쓴 문안 기록(`recordFixedCopySpam` `:4040`) · 플래너 문안 기록(`planner-copy.ts` copy · copy_error) · 자동발송 회차 결과(`auto-campaign-worker.ts:1535`) · 대행 결과 칸(`saveTestResult` detail) — 기계 추출(K4: 판정 결과를 JSON 에 넣는 자리 = `jsonb_set(… '{spamCheck}'`·`'{systemRecheck,result}'`·`spamRetest` · `spam_test_result` · `copy_error`)이 CT 를 지난다).
- 플래너 사전 준비(`planner-copy.ts:391-395` · `:415-425`): 'rejected' = 실패 수에 센다(상한에서 멈춘다 · 다시 만들어도 사람 글인 혜택은 안 바뀐다) · 사유 = `PLANNER_REASON.unsupportedChars` + 위치(옛: 만들기 실패 일반 문장) · AI 글은 출구 CT 가 이미 정리 → 반려 출처 = 혜택 문구(`:204-205` 재삽입) → 혜택 입력 관문(D6).

### D4 장애 갈래가 바뀌지 않는 글을 다시 검사 + 「문안 문제 아님」

호출부마다 'rejected' 갈래(다시 검사 0 · 사람 안내 = 반려 문장):

| 입구 | 처방 | 사람이 보는 말 |
|---|---|---|
| E1 · E2 대행(`agency-send-worker.ts:409-414` → 첫 검사 `:571` · 발송 전 `:761`) | 새 `settleSpamRejected(row, token, phase, rejection)` = 이력 `spam_rejected_chars`(lines) · `test_failed`(사건 reason `unsupported_chars`) · 담당자 문자 새 `buildUnsupportedCharsNotify` · 장애 셈 0 · 다시 검사 0 | 화면 이력 「문자로 보낼 수 없는 글자가 있어 검사하지 못했습니다」 + 줄 · 문자 제목 첫 검사 「[대행발송] 문안 확인 필요」 / 발송 전 「[대행발송] 예약 취소 안내」 · 본문 「문안 또는 명단에 문자로 보낼 수 없는 글자가 있어 검사하지 못하고 멈췄습니다. (위치) 그 글자를 빼고 다시 진행해 주세요.」 |
| E4 자동발송 D-1(`auto-campaign-worker.ts:1515-1558` · 발송 직전 `:733-736`) | 판정 기록 `verdict:'rejected'` · `rejection` · 발송 직전 관문 = `rejected` 면 `markFailed(반려 문장 + ' 문안을 고친 뒤 다시 켜 주세요.')`(옛 「다음 회차에 다시 검사」 = 장애에만) | 담당자 문자 결과 말 「보낼 수 없는 글자」 · 회차 사유 = 반려 문장 |
| E5 자동 마케팅 제안(`continuous-operator.ts:1762-1765` · 정책 `continuous-operator-policy.ts:54-80`) | `finalResult` 에 'rejected' · `decideSpamOutcome(finalResult, regenCount, rejection?)` 'rejected' 갈래(admin_review · autoExecuteBlocked · 사유 = 반려 문장) · `SPAM_VERDICT_LABEL.rejected` · **나가는 글 CT `operatorFinalCopy`(`operator-final-copy.ts:64-95`)가 혜택 · 광고 머리까지 조립한 최종 본문 · 제목의 보낼 수 없는 글자 = `charIssue`**(P6) → 승인(`approveProposal` `:2107-2158` · 고친 글이든 아니든 승인 지문을 남기기 전) · 발송 관문 = 지문 대조 함수 `finalCopyCleared`(`operator-final-copy.ts:92-` · 한 곳) 안에서 `charIssue` 면 지문과 관계없이 `{ ok:false, reason: 반려 문장 }`(Codex 1R #2) | 제안 사유 「문자로 보낼 수 없는 글자가 있어 검사하지 못했어요: (위치). 문안에서 그 글자를 빼 주세요」 · 칩 「보낼 수 없는 글자」 · 승인 = 400 같은 문장 |
| E6 시스템 재검사(`:2257-2281`) | 결과 = `SpamCheckRecord`(아래 D2) · 목록 응답 `copyCheck`(`:2067-2070`) = **나가는 글 `charIssue` 가 있으면 지문(통과 · 승인)보다 먼저 'rejected' + `copyCheckReason`**(Codex 2R #2 · 옛 승인 예약의 혜택에 막음 글자가 있어도 「통과」로 보이지 않게) · 그다음 지문 · 재검사 기록 | 칩 「보낼 수 없는 글자가 있어요 · 문안에서 빼 주세요」 + 사유 |
| E7 화면 「스팸 검사」(`:2403-2418`) | result 'rejected' + `rejection` 기록 | 칩 「보낼 수 없는 글자」 · 사유 줄 |
| E8 리마인드(`:4499-4545`) | 'rejected' = 미통과 갈래(spamUnchecked false) · 사유 · 통지 = 반려 문장(「검사 장비 문제」 문구는 장애에만) | 「리마인드 문안에 문자로 보낼 수 없는 글자가 있어 자동 예약을 보류했습니다: (위치). 문안을 고친 뒤 승인해 주세요」 |
| E9 플래너(`planner-copy.ts:262-268` → `planner-executor.ts:432` · `planner-review.ts:425`) | 실행부 = 'rejected' 새 갈래(칸 잠금 · 사유 · 통지 = `PLANNER_REASON.unsupportedChars` + 위치) · 검토부 = 'rejected' 도 'skip' 이 아니라 실행부와 같은 잠금(재검사로 안 풀린다) | 「문자로 보낼 수 없는 글자가 있어 오늘 발송을 보류했습니다: (위치). 문안에서 그 글자를 빼 주세요.」 |
| E11 여정 사전 검사(`journey-pretest-validator.ts:461-464` → notifier `:346-365` · `:572-594` · `:896-904`) | 검사 입력 = 렌더가 끝난 글(고객 · 회사 · 외부 값 치환 뒤)을 `cleanSmsTextAll`(P5 · Codex 1R #7) → 치환 값 때문의 반려 0 · 칸 글(템플릿)의 막음 글자 = CT-J10 이 저장 · 켜기 · 발송 직전에 막는다(D6) → 사전 검사의 'rejected' = **구조로 도달 불가**: ⓐ 검사 입력 = `cleanSmsTextAll` 을 지난 글이고, `cleanSmsTextAll` 은 `smsCharAction` → `isSmsEncodableChar` 를 맨 먼저 쓰므로 정리된 글에 검사 입구(`unsupportedSmsCharCodes` = 같은 `isSmsEncodableChar`)가 막을 글자가 남을 수 없다 · ⓑ **렌더가 끝난 글은 다시 치환하지 않는다**(Codex 4R #1 · 반례 = 고객 값 `{{ 'Å' | downcase }}` 가 첫 렌더에선 글자로 남고 검사 입구 · 워커의 두 번째 치환(`spam-test-queue.ts:525 · 592 · 993`)이 Liquid 로 풀어 U+00E5 를 새로 만든다): `enqueueSpamTest` · `autoSpamTestWithRegenerate` 새 인자 `rendered: true` = 지문 · 입구 판정 · 워커 발송이 받은 글을 그대로 쓴다(치환 0) · 워커가 알 수 있게 표본 칸 `first_recipient`(jsonb · 지금 칸)에 표식 한 키(`RENDERED_SAMPLE_MARK` · 쓰기 · 읽기 = spam-test-queue 한 파일) · 렌더 완료 글을 넘기는 곳 = 여정 `stepSpamInput` · 대행 표본(`agency-send-preview.ts buildRenderedSample` → `agency-send-worker.ts:394`) 둘(같은 뿌리 = 렌더된 글을 다시 렌더) · 나머지(자동발송 · 자동 마케팅 · 플래너 · AI 한줄로 · 수동)는 변수가 남은 글을 넘겨 지금처럼 치환(계약 시험 K8 = 코드 포인트 전 범위 성질 + 반례 고객 값을 실제 검사 입구 · 워커 발송 글까지 따라가 반려 0 · 재치환 0 + 변이). 그래도 오면 = 코드 회귀 → 장애 기록(`onCheckError` · 하루 상한) + 운영 경보 한 통(반려 문장 · 여정 · 칸 · 판) · **결정 기록 'held' 는 쓰지 않는다**(Codex 3R #1 · held = 주간 묶음 검사가 원문 검사를 건너뛰고 유료 재작성을 돌리는 결정 · `journey-pretest-notifier.ts:893 · 915-931` · held 를 읽는 자리 12 곳에 새 상태를 더하지 않는다 · 2R #4 의 「통과 무효」는 도달 불가 증명으로 대신한다 = 불수용 근거) | 운영 경보(도달 시) |
| E12 여정 칸 「지금 스팸 검사」(`routes/ai.ts:4438-4443`) | 응답 그대로(반려 문장에 위치) | 반려 문장 |
| E13 AI 한줄로(`services/ai-line-spam.ts:131`) | `state:'charset'` + message = 반려 문장 · 칩이 message 를 보인다(`LineResultCards.tsx:60` · 비면 지금 글) | 「보낼 수 없는 글자가 있어요: (위치)」 |
| E14 수동 검사(`routes/spam-filter.ts:191-198`) | 반려 문장에 위치(`chars` 그대로) | 반려 문장 |

- 대행 `buildTestErrorNotify`(「장비 문제 · 문안 문제 아님」) · 플래너 `spamCheckDown` · 「검사 장비 문제」 문구 = 장애 갈래에만(계약 시험).

### D5 검사는 명단 첫 행만 · 나머지 행은 발송 때 9401

- 대행 = D1 명단 값 판정(접수 때 전 행 · 뺌 · 바꿈 적용 · 막음 반려).
- 검사 입력 치환 값(P5): `enqueueSpamTest` 가 변수를 채울 표본 고객(`spamHashInputsOf` 의 `firstCustomer`) · 주소록 칸 값(`spamAddressBookFields`)의 문자열 값을 `cleanSmsTextAll` 한 사본으로 채운다(문안 · 제목의 글자는 그대로 = 문안 문제는 반려로 보인다) · 여정 = 렌더가 끝난 검사 글 전체를 정리(회사 · 외부 값 치환이 렌더 안이라 · 칸 글 막음 글자는 CT-J10 이 먼저 막는다 · 위 E11).
- 표본 밖 고객 값(여정 · 자동발송 · 자동 마케팅 발송 배관) = §13 범위 밖.

### D6 판정 네 벌 + 사람 글 저장

- 지우는 자리 넷 = §2-2.
- 여정 보낼 글 판정 CT-J10 `journeyCopyIssue`(`send-placeholder-gate.ts:63`): 문자 칸 글(판마다 본문 · 제목)에 **막음 글자**가 있으면 새 코드 `UNSUPPORTED_CHARS` · 문장 = `문자로 보낼 수 없는 글자가 있어요: (위치). 그 글자를 빼거나 바꿔 주세요.`(A/B 판이면 판 이름은 부르는 쪽 머리 그대로). 받는 쪽 = 칸 저장 · 켜기(`journey-builder.ts:1044` · `:1489`) · 켜기 검증(`journey-pretest-validator.ts:128`) · 발송 직전(`journey-executor.ts:745` = 그 칸 보류 + 담당자 안내 원장) · 보류 안내(`journey-message-render.ts:82` → notifier `:532`) · 사전 검사(`journey-pretest-notifier.ts:308` · `:880`). 뺌 · 바꿈 글자는 판정하지 않는다(발송 정리가 지금처럼 고친다 · P2).
- **안내 문자 적재 = 안내 전용 CT `insertNoticeSms(rows, opts)`(`sms-queue.ts` 새 · P6 · Codex 1R #4 · 2R #1)**: 표를 CT 안에서 고른다(`getAuthSmsTable` · 부르는 쪽이 미리 고른 표를 들고 있다가 설정이 바뀌는 틈 0) → 행의 본문(`row[2]`) · 제목(`row[4]`) `cleanSmsTextAll`(안내에 실린 원문 미리보기 · 파일 이름 · 자동 마케팅 이름 · 행사 제목 · 여정 이름 전부) → `bulkInsertSmsQueue([그 표], 정리된 행, useNow, ctx, { run })`(그 안의 시연 막기 · 금칙어 스냅숏 · 라인 분배는 정리된 행을 본다). 옮길 곳 = 인증 라인 표에 적재하는 9 파일(대행 `agency-send-worker.ts:237` · 자동발송 `auto-campaign-worker.ts:423/492` · `:575/650` · `:1544/1577` · 자동 마케팅 `continuous-operator.ts:4628` · 여정 사전 검사 `journey-pretest-notifier.ts:747` · 여정 결과 `journey-result-notice.ts:235` · 주간 요약 `manager-weekly-digest.ts:127` · 알림톡 작업 `alimtalk-jobs.ts:688` · 충전 승인 `charge-approve-link.ts:175` · `:234` · 운영 경보 `system-alert.ts:491`) · 예외 = `account-action.ts:119`(인증번호 = 숫자 · 고정 글 · 직접 INSERT). 고객 발송 표(회사 · 사용자 라인)는 이 CT 를 타지 않는다(고객 글 불변).
- 사람 글 화면 저장(`assertSmsTextSendable` · `smsTextBlockReason`):
  - 자동발송 만들기 · 고치기(`routes/auto-campaigns.ts:355-410` · `:519-545`) 본문 · 제목 · 대체 문안 = `smsTextBlockReason` → `res.status(400).json({ error, code:'UNSUPPORTED_CHARS' })`(그 라우트의 검사 꼴 그대로).
  - 자동 마케팅 리마인드(`registerOperator` `continuous-operator.ts:446` · `updateOperator` `:846`) · 직접 쓴 문안(`normalizeFixedCopyInput` `:4051` · 부르는 곳 `:470` · `automarketing-preview.ts:699` · `:811`) · 제안 승인 때 고친 본문 · 제목(`approveProposal` `:2107` · `selection.body`) · 화면 「스팸 검사」에 보낸 고친 글(`startProposalSpamRetest` `:2319`) = 저장 · 검사 전 `assertSmsTextSendable`(옛 = 나가는 글 정리가 조용히 지움 → 막고 위치 안내 · 구조체크 S9 · S11) · 응답 = `operatorError` → `respondUserError`(`operator-route.ts:67-68`) 400 문장 그대로.
  - 자동 마케팅 혜택(`registerOperator` · `updateOperator` 의 `benefitContent` · `continuous-operator.ts:838` · Codex 1R #2) = 같은 관문(입력 안내 · 최종 판정은 E5 의 나가는 글 CT).
  - 플래너 혜택 문구 = 같은 관문 · **저장 뒤 그 행사에 문자 · DM 접점이 있을 때만**(Codex 3R #2 · 이메일만 보내는 행사는 문자 글자 제약이 없다 · `marketing-planner.ts:126-159` · 문자 검사 대상 = SMS · DM `planner-copy.ts:154-161`) · 이메일 행사에 문자 · DM 을 더하는 변경도 그때의 혜택을 본다 · 자리 = 혜택 저장(`planner-event.ts:515-520 · 534-537`) · 접점 채널을 바꾸는 저장(구현 때 grep 으로 전부) · 최종 판정은 검사 'rejected' + 위치.
  - 플래너 편집(`planner-copy.ts:475-477`) = 반려 문장 = `smsTextBlockReason` 문장(위치).

### D7 바르게 막는 입구도 위치 0

- E10 · E12 · E13 · E14 = 위 반려 문장(P4 위치).

## §4 영향표(CT · 판정 값을 읽는 · 쓰는 전 소비처 · 흐름 표 §1 grep + 구조체크 grep)

| 바뀌는 것 | 소비처 | 영향 |
|---|---|---|
| `sanitizeUnsendableForSms` 내부 | `journey-message-render.ts:129-130` | 출력 같음(K1) |
| `sanitizeForSms` 막음 글자 | 여정 AI 생성(`journey-ai-generator.ts:751 · 752 · 1057 · 1168-1169 · 1327`) · 여정 AI 편집(`journey-ai-editor.ts:105-106`) · 자동 마케팅 꾸미기(`operator-message-decorator.ts:110 · 111 · 122`) · A/B 변형(`variant-generator.ts:166`) | 막음 글자만 더 빠진다(전부 AI 글) · 옛 정규화 그대로 |
| `stripIncompatibleEmojis` | `operator-final-copy.ts:71-72` · `continuous-operator.ts:446 · 846 · 4052-4054 · 4422` · `services/ai.ts:2647`(직접발송 다듬기 후보) | 보낼 수 없는 글자만 더 빠진다 · 리마인드 · 직접 쓴 문안 저장은 D6 관문이 먼저 막아 저장 글 = 보낼 수 있는 글자뿐 |
| `stripEmojis` → CT(본문 · 제목) | `applyCopyExitGuards` 받는 쪽 = 문안 생성(`services/ai.ts:1424` → 자동발송 `auto-campaign-worker.ts:293 · 338 · 1464` · 플래너 `planner-copy.ts:237` · 오케스트레이터 `services/ai-orchestrator.ts:560 · 896` · AI 한줄로 `services/ai-line.ts:601` · 직접발송 AI 추천 `routes/ai.ts:352`) · 목소리 견본(`brand-voice-sample.ts:86`) | 카카오 그대로 · 문자 갈래 = 보낼 수 없는 글자 0 · 바이트 셈(`services/ai.ts:1440`)은 출구 뒤라 정리된 글 기준 |
| `auto-notify-message` 끝 정리 | 담당자 알림 미리보기 | 범위 밖 보낼 수 없는 글자만 더 빠진다 |
| CT-J10 새 코드 | §3 D6 받는 쪽 7 | 막음 글자가 든 여정 칸 = 저장 · 켜기 막힘 · 이미 켜진 여정 = 그 칸 보류 + 안내(옛: 그대로 나가 9401 실패) |
| `SpamVerdict` 여섯째 값 | `agency-send-worker.ts` · `auto-campaign-worker.ts` · `continuous-operator.ts` · `journey-pretest-validator.ts` · `journey-pretest-notifier.ts` · `planner-copy.ts` · `planner-executor.ts` · `planner-review.ts` | D4 표 · tsc `satisfies` · Record |
| `AutoSpamVerdict` · 결과 `rejection` | `continuous-operator.ts:1765 · 1794 · 2417` · `ProposalDecisionCard.tsx`(칩 표 `:51-64`) · `automarketing/types.ts` | 'rejected' 칩 · 결과 칸 |
| 표본 고객 값 정리(P5) | `enqueueSpamTest` 의 표본 · 같은 날 이어 보기 지문(`spamHashInputsOf`) | 표본 값에 보낼 수 없는 글자가 있던 고객이 표본이면 지문이 한 번 바뀐다(이어 보기 대신 새 검사 1회) |
| `createRequestCore` 반려 · `notice` | 화면 · 원스텝 · 메일 | 반려 = 지금 배관 · 알림 = 새 줄 |
| `analyzeOneStep` 맨 앞 정리 | 원스텝 미리보기 · 확정 · 메일(`:334` · `:366` · `:1033`) · 메일 중복 조회(`:1058-1080`) · 첨부 중복 | 모든 판단이 정리된 글 기준 · 미리보기도 정리된 글 + 알림 |
| `bulkInsertSmsQueue` 안내 라인 정리 | 안내 · 인증 라인 표 적재 9곳 | 보낼 수 없는 글자만 빠진다 · 고객 발송 표 0 |
| `operatorFinalCopy` `charIssue` | 승인 · 발송 관문 · 목록 응답 · 화면 | 혜택 · 조립 뒤 막음 = 승인 · 발송 막음 |
| 대행 이력 kind 둘(`content_cleaned` · `spam_rejected_chars`) | `AgencyEventLog.tsx` · 워커 통과 알림 · 장애 셈 SQL(`kind = 'spam_check_error'` · `agency-send-worker.ts:453-457`) | 새 글 · 장애 셈과 겹치지 않는다 |
| `spam-trial.ts SpamVerdict`(수동 체험 판정 · 이름만 같음) | 무관 | 영향 없음 |

## §5 뿌리(`docs/ROOT-LEDGER.md`)

- **R7 넓힘** — 검사 입구의 반려(보낼 수 없는 글자)는 `rejected` · 다시 검사 0 · 「장비」 안내 0. 시험 K4 = 검사 공용 함수를 부르는 파일을 소스에서 뽑아 'rejected' 갈래를 받는가.
- **R1 넓힘** — 「보낼 수 없는 글자」 다루기 = `smsCharAction` 한 곳. 시험 K2 = 글자 범위 정규식 · 코드 포인트 범위로 글자를 지우는 자리를 소스에서 뽑아 CT 를 지나거나 이유 붙은 예외 셋(§2-2)만 남는가.
- **R68 새** — 고객에게 나가는 글을 **쓰는 자리**에 「나갈 수 있는가」 판정이 있다(받아 놓고 뒤에서 멈추지 않는다). 시험 K5 = 대행 문안 쓰기(`current_content =` 쓰는 자리 · `createRequestCore`) · 사람 글 저장 자리(위 D6 목록) · CT-J10 이 판정을 부르는가.

## §6 DB

- DDL 0 · 새 칸 0. 이력 = 지금 표 `agency_send_events`(request_id · kind · payload jsonb · created_at) · 새 kind 둘. 새 SQL = 통과 알림의 `content_cleaned` 한 줄 읽기(`SELECT payload FROM agency_send_events WHERE request_id = $1::uuid AND kind = 'content_cleaned' ORDER BY created_at DESC LIMIT 1`) → 칸 확인 = 시험 DB information_schema 출력 첨부(구현 때) · 실 PG 시험 P1.

## §7 화면(디자인 하한 · LESSONS_FRONTEND 디자인 최소 기준)

- 대행 접수 성공 자리 · 이력 · 자동 마케팅 칩 · AI 한줄로 칩 = 기존 틀 안 문구 · 줄만(새 창 0 · native dialog 0 · 모델명 0).

## §8 배포

- DDL 0 · 백엔드 + 프론트 build:safe · pm2 reload. 순서 = OPS §2-2. C109-S1 = 직원 시트(§14).

## §9 시험

- **K1** `sanitizeUnsendableForSms` 옛 · 새 출력 같음(표본: 이모지 · 결합 · 바꿈 표 전 항목(빈 글자 = `∅` 표기) · 막음 글자 · 보낼 수 있는 글자 · 빈 값 · 섞인 글 · warnings 문장 · removedEmojis · replacedChars 배열) — 옛 본문 = 시험 파일 대조본.
- **K2(R1)** `smsCharAction` 표(U+1F60A = remove · U+2B50 = remove · U+200B = replace('') · U+00A0 = replace(' ') · U+00E9 = block · U+2605 = keep) · `stripIncompatibleEmojis` · `stripEmojis` · `sanitizeForSms` · `sanitizeUnsendableForSms` · `cleanSmsTextAll` · `auto-notify-message` 정리가 CT 를 지난다(동작) · 기계 추출 = backend src 에서 `\u{1F` · `0x1F000` · `0x2600` 꼴 글자 범위를 쓰는 파일 = `message-sanitizer.ts` + 예외 셋(이유)뿐.
- **K3** `describeSmsCharFindings` 문장(줄 · 앞 글자 · 이름 · 코드 · 외 n곳 · where) · 문장 안에 보낼 수 없는 글자 0.
- **K4(R7)** `spamVerdictOf` · merge 두 함수 순서 · `spamVerdictWithRetry` 가 'rejected' 에서 run 1번 · `runOneTest` 반려 코드 매핑(순수 함수로 뺀다 `enqueueFailureVerdict`) · 기계 추출 = `autoSpamTestWithRegenerate(` · `runStepSpamTest(` · `spamCheckPlannerVerdict(` 를 부르는 파일(시험 제외)이 `'rejected'` 를 다룬다 · 'rejected' 갈래가 `buildTestErrorNotify` · `spamCheckDown` · 「검사 장비 문제」를 부르지 않는다.
- **K5(R68)** `prepareAgencyText`(뺌 알림 · 막음 반려 위치 · 명단 n행 칸 · 제목) · `createRequestCore` · `agency-send-change.ts` 가 부른다 · 워커 다듬기 뒤 `cleanSmsTextAll` · 사람 글 저장 자리가 관문을 부른다 · CT-J10 `UNSUPPORTED_CHARS`(막음만 · 뺌 글자는 0) · 표본 값 정리(P5).
- **K6(P6)** `insertNoticeSms` 동작(실행 함수 주입 · 정리 뒤 적재 · 표 = CT 안에서) · `getAuthSmsTable(` 을 부르는 곳 = `sms-queue.ts` + 예외 한 곳(인증번호)뿐(기계 추출) · 자동 마케팅: 혜택에 막음 글자 → 승인 400 · `finalCopyCleared` 막음 · 옛 승인 지문이 같은 예약 건의 목록 `copyCheck` = 'rejected'(지문보다 먼저).
- **K8(P5 · 도달 불가 증명)** 성질 시험 = U+0000 ~ U+2FFFF 전 코드 포인트(그리고 U+E0000 ~ U+E007F)에서 `cleanSmsTextAll(ch)` 결과의 글자가 모두 `isSmsEncodableChar` · 여정 검사 입력(`stepSpamInput`)이 렌더 뒤 `cleanSmsTextAll` 을 지나고 `rendered: true` 로 넘긴다(소스) · 반례 추적(Codex 4R #1): 고객 이름 = `{{ 'Å' | downcase }}` · 템플릿 `%이름%님` → 검사 입구 판정 글 · 지문 글 · 워커 발송 글이 받은 글과 글자 그대로 같다(재치환 0 · 반려 0) · 대행 표본도 같은 `rendered: true` · 사전 검사 'rejected' 갈래 = 장애 기록 + 운영 경보 · held 0 · 변이(정리 · 표식 각각 빼면 빨간불).
- **K4 보강(2R #5)** 판정 결과를 JSON 에 저장하는 자리(위 목록 · 기계 추출)가 `toSpamCheckRecord` 를 지난다 · `toSpamCheckRecord` → JSON → `readSpamCheckRecord` 왕복에서 사유 보존 · 호출 지점마다 'rejected' 처리(파일 단위가 아니라 호출 자리 단위 · 차례 어댑터 · 결과 조립 · 플래너 사전 준비 · 실행부 · 검토부).
- **K7(대행 순서)** 정리 후 같아지는 재메일 · 같은 메일 두 첨부 = 중복으로 잡힌다 · 변수 토큰 안 글자 = 반려 · 정리 후 빈 값 = 반려 · 정리로 바이트가 줄면 SMS 판정(제목 요구 0).
- **P1(실 PG)** `content_cleaned` · `recipients_cleaned` 이력 쓰기 → 통과 알림 읽기 SQL(종류마다 가장 최근 한 줄 · 다른 접수 0 · 문안 수정이 명단 이력을 지우지 않는다 · 연속 수정 = 마지막 수정 줄 · 이력 쓰기 실패 = 수정째 롤백(문안 그대로)).
- 변이 = 장치마다 하나씩 꺼서 빨간불(§12).

## §10 설계 구조체크(구현 전 · 이음매 = 흐름 표 전체)

1회차(1106) — 설계 초안을 이음매마다 소스로 따라가 찾은 결함 9 · 전부 반영:

| # | 찾은 것(근거) | 반영 |
|---|---|---|
| S1 | AI 문안 출구 CT `applyCopyExitGuards` 에 넷째 지우는 자리 `stripEmojis`(정규식 범위 · `copy-exit-guards.ts:50-` · `:176-179`) · 본문만 정리 · 초안의 「생성 함수 출구에 정리 추가」는 다섯째 벌 | 출구 CT 의 `stripEmojis` 를 CT 로 · 제목도(§2-2) · 생성 함수에 새 자리 0 |
| S2 | `sanitizeForSms`(여정 · 자동 마케팅 AI 글)가 막음 글자를 남긴다(`message-sanitizer.ts:154-` 마지막 `result += char`) | 막음 글자도 뺀다(§2-1) |
| S3 | 담당자 알림 미리보기 글(`auto-notify-message.ts:145-160`)이 범위 밖 보낼 수 없는 글자를 남긴다 = 알림 문자 9401 | 끝에 CT(§2-2) |
| S4 | 초안이 여정 칸을 범위 밖으로 뺐다 · 그런데 발송 정리 `sanitizeUnsendableForSms` 는 막음 글자를 남긴다(흐름 표 §4 「여정 칸 = 정상」은 막음 글자를 못 봤다) · 사전 검사가 'rejected' 로 판 보류를 하면 보류 안내 문구(`journey-pretest-notifier.ts:532` = CT-J10 또는 「스팸필터」)가 사실과 다르다 | CT-J10 에 막음 글자 코드 → 저장 · 켜기 · 발송 직전 · 보류 안내가 같은 문장(§3 D6) |
| S5 | 표본 고객 한 명의 값(이름 등)에 보낼 수 없는 글자가 있으면 문안이 멀쩡해도 자동발송 · 자동 마케팅 · 플래너 · 여정 검사가 'rejected' 로 회차 전체가 멈춘다 | 검사 표본 값 정리(P5 · §3 D5) |
| S6 | 문자 아닌 채널 · 판정만인 글자 범위 자리 셋(AI 한줄로 칸 값 · 목소리 판정 · SNS) | 이유 붙은 예외(§2-2 · K2 기계 추출) |
| S7 | 승인 요청 문자의 「빼고 보냅니다」 줄을 문안 버전으로 읽으면 다듬기가 버전을 올린 뒤 줄이 사라진다(`saveTestResult` `content_version + changed`) | 접수 이후 가장 최근 `content_cleaned` 를 읽는다(§3 D1) |
| S8 | 플래너 검토부(`planner-review.ts:425`)는 장애를 'skip'(다음 주기 재검사)으로 둔다 · 'rejected' 를 같은 갈래에 두면 바뀌지 않는 글을 주기마다 다시 검사한다 | 'rejected' = 실행부와 같은 잠금(§3 D4 E9) |
| S9 | 자동 마케팅 리마인드 · 직접 쓴 문안 저장이 지금 조용히 지운다(고객 문안을 몰래 바꿈) | Harold ② 대로 막고 위치 안내 · 응답 배관 `operatorError` → `respondUserError` 확인(`operator-route.ts:12` · `:67-68`)(§3 D6) |

2회차(1106) — 고친 설계를 다시 이음매마다 따라가 찾은 결함 2 · 반영:

| # | 찾은 것(근거) | 반영 |
|---|---|---|
| S10 | 승인 요청 문자가 「가장 최근 content_cleaned」를 읽는데, 담당자가 그 뒤 글자 문제 없는 글로 고치면(`agency-send-change.ts:156` · 이력 `content_edited` `:178`) 옛 접수 이력이 남아 「빼고 보냅니다」가 거짓 | 사람이 고칠 때마다 `content_cleaned`(줄 없으면 []) · 접수는 줄이 있을 때만(§3 D1) |
| S11 | 자동 마케팅 제안 승인 때 고친 본문(`approveProposal` `continuous-operator.ts:2107` · `userSelection.body` → `operatorFinalCopyAt` 이 조용히 지움) · 화면 「스팸 검사」(`startProposalSpamRetest` `:2319`)도 사람 글 저장 자리 | 둘 다 사람 글 관문(§3 D6) |

3회차(1106) — 바뀐 이음매(§2-2 넷 · CT-J10 · P5 · S10 · S11)만 다시 따라감 · 새 결함 0. 확인한 것: CT-J10 받는 쪽 7 이 같은 문장을 쓴다(`journey-executor.ts:745` 보류 · `journey-pretest-validator.ts:128` 켜기 실패 줄 · `journey-builder.ts:1044` 켜기 · 보류 안내 `journey-pretest-notifier.ts:532`) · P5 정리는 문안 글자를 건드리지 않는다(표본 고객 사본만) · 예외 셋 = 문자 출구가 아니거나 판정만 · 자동 마케팅 저장 응답 배관(`operator-route.ts:67-68`) · 자동발송 라우트 400 꼴(`routes/auto-campaigns.ts:401-410`).

설계 구조체크 = **닫힘**(결함 11 반영 · 3회차 새 결함 0) → Codex 설계(§11).

## §11 Codex 설계

1R(1106) = needs-attention · high 4 · medium 4 · 전부 수용 · 같은 뿌리 셋으로 묶어 구조로 고침:

| # | 지적 | 판정 · 뿌리 | 반영 |
|---|---|---|---|
| 1 high | 정리 후 저장값과 메일 중복 판정 기준이 다름 | 수용 · 뿌리 A(정리가 분석 뒤) | 정리 자리 = 요청서를 읽은 직후 · 모든 분석 앞(§2-3) |
| 2 high | 자동 마케팅 혜택이 관문을 우회 · 편집 없는 승인이 승인 지문을 남겨 발송 | 수용 · 뿌리 B(입력 목록만 봄) | P6 · 나가는 글 CT `charIssue` → 승인 · 발송 관문 + 혜택 입력 관문(§3 E5 · D6) |
| 3 high | 변수 이름을 정리하면 명단 값 연결이 끊김 | 수용 · 뿌리 A | 변수 토큰 안 글자 = 반려(§2-3) |
| 4 high | 안내 문자의 원문 미리보기 때문에 안내 자체가 9401 | 수용 · 뿌리 B | 안내 라인 적재 효과 자리 정리(§3 D6 · K6) |
| 5 medium | 정리 전 분석값(유형 · 바이트) · 정리 후 빈 값 | 수용 · 뿌리 A | §2-3 순서 · 정리 후 빈 값 반려 |
| 6 medium | 중간 변환이 rejected · 사유를 버림(차례 어댑터 · 플래너 반환 · copyCheck) | 수용 · 뿌리 C(값을 넓히며 중간 자리를 손으로 찾음) | 사유 필수 갈래 타입 · 판정 문자열 읽는 자리 기계 추출(§3 D2 · K4) |
| 7 medium | 여정 회사 · 외부 값 치환 뒤 반려는 CT-J10 으로 사유 복원 불가 | 수용 · 뿌리 B | 검사 입력 = 렌더 뒤 전체 정리 · 칸 글 막음 = CT-J10 · 사전 검사 rejected = 도달 불가 + 운영 경보(§3 E11 · D5) |
| 8 medium | 문안 수정이 명단 정리 알림까지 지움 | 수용 | 이력 두 종류(§3 D1) |
| 다음 단계 ① | K1 에 ∅ · 결합 · 경고 · 배열 | 수용 | §9 K1 |
| 다음 단계 ⑦ | 자동발송 신규 등록 = 410 · 여정 저장 판정 = 켜진 여정만(`assertStepCopySendable` `journey-builder.ts:1484-1491`) | 수용 | §14 시트 54 = 기존 건 고치기 · 57 = 켜기 |

2R(1106) = needs-attention · medium 5 · 전부 수용:

| # | 지적 | 판정 · 뿌리 | 반영 |
|---|---|---|---|
| 1 | 적재 순간 인증 표 비교는 표를 먼저 고른 뒤 설정이 바뀌면 빠진다 | 수용 · 1R #4 처방의 꼴 결함 | 안내 전용 CT `insertNoticeSms`(표를 CT 안에서 고름 · 9 파일이 이것만 · §3 D6 · K6) |
| 2 | 목록 `copyCheck` 가 승인 지문을 먼저 봐 막음 글자가 있어도 「통과」 | 수용 · 뿌리 B(최종 글 판정을 표시가 안 봄) | `charIssue` 가 지문보다 먼저(§3 E6 · K6) |
| 3 | 정리 이력이 문안 커밋 뒤 · 실패를 삼켜 옛 이력이 남음 | 수용 | 두 이력 = 같은 트랜잭션(§3 D1 · P1) |
| 4 | 여정 예상 밖 rejected 가 기존 통과를 무효로 못 함 | 수용 · 1R #7 뒤처리 | 결정 'held' + noticeDone + 운영 경보 · 도달 불가 계약(§3 E11 · K8) |
| 5 | 갈래 타입이 저장 · 복원 경계(자동 마케팅 결과 JSON · 시스템 재검사 · 플래너 사전 준비)에서 사유를 버림 | 수용 · **1R #6 과 같은 부류 둘째** → 왜 = 사유를 옵션 칸으로 덧붙여 저장 자리마다 손으로 옮김 | 판정 + 사유 한 값 `SpamCheckRecord` · 쓰기 · 읽기 CT · 저장 자리 기계 추출 · 왕복 시험(§3 D2 · K4) · 플래너 사전 준비 = 실패 수 + 위치 사유 · 플래너 혜택 입력 관문 |
| 다음 단계 ③ | 분석 단계 알림을 core 다시 보기가 덮지 않게 | 수용 | 합친다 · 요청서마다(§3 D1) |

3R(1106) = needs-attention · medium 2 · 전부 수용:

| # | 지적 | 판정 | 반영 |
|---|---|---|---|
| 1 | 여정 반려를 held 로 적으면 주간 묶음 검사가 유료 재작성을 돌린다 | 수용 · 2R #4 처방의 결과 | held 를 쓰지 않는다 · 도달 불가를 성질 시험으로 증명(K8) · 도달 시 장애 기록 + 운영 경보 · 2R #4 「통과 무효」= 증명으로 대신(불수용 근거 = held 의미를 읽는 12 곳에 새 상태 0 · 정리된 입력은 원리상 반려될 수 없다) |
| 2 | 플래너 혜택 관문이 이메일만 보내는 행사까지 막는다 | 수용 | 문자 · DM 접점이 있을 때만 · 채널을 더하는 변경도(§3 D6) |
| 다음 단계 | 안내 CT 가 opts.run · 적재 건수 반환을 그대로 · 옛 문자열 · 객체 판정 · 칩 왕복 고정 | 수용 | §9 K4 · K6 |

4R(1106) = needs-attention · medium 1 · 수용:

| # | 지적 | 판정 | 반영 |
|---|---|---|---|
| 1 | 정리 뒤 큐의 두 번째 치환(Liquid)이 보낼 수 없는 글자를 다시 만든다(고객 값 `{{ 'Å' \| downcase }}`) · 성질 시험만으로 입구까지 불변식 증명 안 됨 | 수용 · 같은 뿌리 = 렌더된 글을 다시 렌더(여정 · 대행 표본) | `rendered: true` = 지문 · 입구 · 워커 발송 재치환 0 · 표식 = `first_recipient` 한 키 · K8 반례 추적(§3 E11 · §9 K8) |

5R(1106) = **approve**(지적 0 · 표식을 고객 값으로 읽는 곳 0 · 이어 보기 지문 한 번 끊김 외 영향 0 · 대행 표본 = 첫 행 그대로 · 렌더 완료 글 호출처 누락 0). 다음 = 구현 리뷰에서 K8 의 입구 · 지문 · 표식 · 워커 발송 글 일치 확인.

### 11-2 Codex 구현(1106)

1R = needs-attention · high 1 · medium 3 · 전부 수용(한 조각 불수용) · 2R(고친 줄 + 직접 호출부) = approve:

| # | 지적 | 판정 · 같은 뿌리 | 반영 |
|---|---|---|---|
| 1 high | 정리 뒤 앞뒤 공백이 남아 분석 반환 글(메일 중복 지문 · SQL 비교) ≠ 저장 글(trim) | 수용 · **설계 1R #1 과 같은 부류 둘째**(저장값 ≠ 중복 판정 기준) → 왜 되풀이 = 「최종 글」을 자리마다 각자 만듦(분석 = 정리만 · 코어 = trim) → 구조로: 글 준비 CT 가 저장될 최종 글(정리 + trim)을 한 번 확정해 돌려준다 | `prepareAgencyCopy` content = `cleanSmsTextAll(raw).trim()` · 시험 K5 |
| 2 medium | 정리가 새 변수 토큰을 만든다(`%`(보이지 않는 글자)`이름%` → `%이름%` · 매핑 · 값 없이 빈칸) | 수용 · 설계 1R #3 의 넓힘(토큰 안 → 토큰 둘레) | 정리 전후 토큰 이름 목록이 다르면 반려 · 시험 K5 |
| 3 medium | 표본 고객의 custom_fields(JSONB) 안 문자열은 정리되지 않아 정상 문안도 입구 반려 | 수용 | `cleanSpamSampleValues` 안쪽까지(배열 · 일반 객체 · 원본 불변) · 시험 = 진짜 `replaceVariables` |
| 4 medium | 인증 라인 표 조회가 상한 연결 안(연결을 쥔 채 PG 대기) | 수용 · 한 조각 불수용 = 「만료된 run 은 SQL 전에 거절」(공용 `withBoundedMysql` 의 옛 성질 · 이번 변경이 만든 대기가 사라져 새 노출 0 · 공용 함수 변경은 축 밖 → BUGS 기록) | `insertNoticeSms(…, { boundedMs })` = 표 조회 · 정리 뒤 CT 안에서 상한 연결 · 여정 안내 셋 · 시험 = 순서 |

변이(1R 처방) 넷 = 문안 trim 확정 끔 · 토큰 대조 끔 · 표본 안쪽 정리 끔 · 표 조회를 상한 안으로 → 전부 빨간불.

## §12 구현 기록

### 12-1 만든 것 · 옮긴 것(1106)

- 글자 CT(`message-sanitizer.ts`): `smsCharAction` · `scanSmsText` · `cleanSmsTextAll` · `describeSmsCharFindings` · `smsTextPlaces` · `smsTextBlockReason` · `assertSmsTextSendable` · `sanitizeUnsendableForSms` = 같은 분류 위(옛 출력 그대로 = K1 대조본) · `sanitizeForSms` 막음 글자도 뺌.
- 지우던 자리 넷 = CT(`stripIncompatibleEmojis` · `stripEmojis` 본문 · 제목 · `sanitizeForSms` · `auto-notify-message`).
- 검사 입구(`spam-test-queue.ts`): 판정 여섯째 `rejected` · 반려 문장 = `SPAM_REJECTED_PREFIX` + 위치 · `spamRejectionOf` · `spamRejectionPlaces` · 사유 필수 갈래 `AutoSpamVariantResult` · 저장 한 값 `SpamCheckRecord`(`toSpamCheckRecord` · `readSpamCheckRecord`) · `rendered`(표식 `__c109_rendered`) · `cleanSpamSampleValues`.
- 받는 쪽: 대행 `settleSpamRejected` · `buildUnsupportedCharsNotify` · 여정 `stepSpamInput`(렌더 뒤 정리 + rendered) · 사전 검사 `alertPretestRejected`(장애 기록 + 경보 · held 0) · 플래너 실행 · 검토(쌍 잠금) · 사전 준비 · 재확인(`plannerCharsReason`) · 자동 마케팅(`decideSpamOutcome` rejected · `operatorCharsReason` · 목록 `copyCheck`/`copyCheckReason` · 시스템 재검사 · 화면 검사 · 리마인드) · 자동발송(발송 직전 markFailed).
- 대행 글 준비 CT(새 `agency-send-chars.ts`): `prepareAgencyCopy` · `createAgencyRecipientCleaner` · `prepareAgencyText` · `mergeAgencyCharNotes` · `agencyCharNotice` · `agencyCharPassedLines` · 이력 쓰기 `logEventTx` · `logCharCleanedTx`(트랜잭션 안 · 실패를 삼키지 않는다) · 승인 요청 줄 읽기 `readAgencyCharLines`(새 SQL).
- 나가는 글(`operator-final-copy.ts`): `charIssue` · `finalCopyCleared` 가 글자 문제면 지문과 관계없이 멈춤.
- CT-J10 `journeyCopyIssue`: `UNSUPPORTED_CHARS`(막음 글자만).
- 사람 글 저장 관문: 자동 마케팅 등록 · 수정(리마인드 · 혜택) · 직접 쓴 문안 · 승인 때 고친 글 · 화면 검사의 고친 글 · 자동발송 고치기 · 생성 문안 고치기 · 플래너 혜택(문자 · DM 접점일 때만) · 플래너 편집 문장(위치).
- 안내 적재 CT `insertNoticeSms` → 아홉 파일 옮김.
- 화면: 대행 이력 새 kind 셋 · 접수 · 원스텝 · 문안 고치기 알림 줄 · 자동 마케팅 칩(안별 · 나갈 글) + 사유 줄 · AI 한줄로 칩 위치.

### 12-2 설계와 달라진 것(이유)

| # | 설계 | 구현 | 이유 |
|---|---|---|---|
| 1 | `insertNoticeSms` = `sms-queue.ts` 새 | 새 파일 `sms-notice.ts`(sms-queue.ts 는 원본 그대로) | 적재 배관(sms-queue)을 흉내 내는 기존 시험 8 파일이 CT 를 진짜로 돌리고 그 안의 적재 호출을 그대로 관찰한다(흉내 목록을 고치지 않고 같은 관찰 자리 유지) |
| 2 | 출구 CT 본문 정리 = `cleanSmsTextAll` | 감춘 링크 자리(사용자 영역 글자 U+E100 ~ U+E1FF) 밖만 정리(`brand-link-core.mapOutsideLinkMasks` · `stripEmojis(…, { keepLinkMasks: true })`) | 새 CT 가 감춤 글자를 막음으로 지워 링크가 사라졌다(`bug-1031-link` 계약 4건이 잡음 · 같은 부류 다른 자리 = 영업 예문 마스킹 U+E000 · E001 은 새 CT 를 지나지 않음) |
| 3 | 대행 화면 = 성공 자리에 알림 | 대행 접수 화면 · 대행 문안 고치기의 화면 사전 차단(`hasUnsupportedSmsChars`) 제거 · 옛 화면 배선 계약(`sms-charset-contract` P2)에서 대행 접수 화면만 이유를 적어 뺌 | 0910 결정 D2(작성 화면에서 막는다)가 남아 있으면 접수 코어의 「뺌 · 바꿈 적용 + 알림」이 화면 접수에서 일어날 수 없다(Harold 추천안 ① 이 나중 결정) · 문안 아래 안내 · 승인 버튼 쪽 확인은 그대로 |
| 4 | 분석 알림 = 코어로 실어 보냄 | 서버 사전값 `pre.charNotes` 로만(화면 요청 본문의 값은 받지 않는다) | 승인 요청 문자 줄에 실리는 이력이라 바깥 글이 들어오면 안 된다(내 적대 검토) |
| 5 | 사람 글 저장 = `routes/auto-campaigns.ts:355-410 · 519-545` | 살아 있는 고치기(`PUT /:id`) · 생성 문안 고치기(`PUT /:id/generated-message`) | 만들기(`POST /`)는 410 폐기 · 그 줄 번호는 남겨 둔 옛 함수 |
| 6 | K8 반례 `Å` | U+212B(옹스트롬 기호 · 보낼 수 있음) → downcase = U+00E5(보낼 수 없음) | 실측 1106 · U+00C5 는 처음부터 보낼 수 없는 글자라 정리가 먼저 지운다 · 기계로 찾은 반례 6 중 하나 |
| 7 | 여정 사전 검사 rejected 받는 쪽 = 장애 기록 | 켜기 검증(`validateJourneyActivation`)의 rejected = 고칠 글 `copy_issue`(위치 문장) | 켜기 검증은 사람에게 보이는 실패 사유라 장애 문장(「잠시 뒤 다시」)을 쓰면 거짓 · 새 사유 값 0 |
| 8 | 알림 미리보기 정리 = 끝에 CT | CT 를 공백 정리 앞에 | 계약 시험이 잡음 · 지운 자리에 공백 두 칸이 남았다 |
| 9 | 대행 반려 문장 하나 | 접수된 건의 문안 고치기 = 「저장하지 못했습니다 · 다시 저장해 주세요」(`prepareAgencyCopy(…, 'save')`) | 직원 시트 문장을 뽑다가 발견 · 고치기인데 「접수하지 못했습니다」로 말했다 |
| 10 | 직원 시트 50 ~ 59 | 55 ~ 64 | C108 이 50 ~ 54 를 씀(겹침) |

### 12-3 시험 · 변이

- 새 계약: `c109-chars-contract-1106`(K1 · K2 기계 추출 · K3 · K5 · K6 · K7 · K4 자리 · K8 성질) · `c109-gate-contract-1106`(K8 반례를 실제 검사 입구까지 · K4 판정 값 · 합치기 · 다시 검사 고리 · 저장 왕복) · `c109-notice-ct-1106`(K6 · `getAuthSmsTable(` 부르는 곳 기계 추출) · 실 PG `c109-agency-char-events-1106.pg`(P1 · 칸 존재 information_schema · 종류마다 가장 최근 · 다른 접수 0 · 문안 수정이 명단 이력 유지 · 연속 수정 · 이력 실패 = 수정째 롤백).
- 기대 문자열만 맞춘 기존 시험(계약 같음 · 이름 · 칸만 바뀜): `agency-lows-closure` · `planner-approval-flow-1004` · `precheck-0925` · `codex-1r-fixes-1018` · `tier4-worker-0928` · `spam-verdict-4value-1101` · `sms-charset-contract`(위 12-2 #3).
- 변이 8(파일 복사 · 1106): 입구 렌더 표식 무시 · 반려를 장애로 접음 · 발송 관문 글자 무시 · 대행 막음 반려 끔 · 안내 적재 정리 끔 · 출구가 감춘 링크 지움 · 여정 검사 입력 정리 끔 · CT-J10 막음 판정 끔 → 전부 빨간불.

## §13 범위 밖(기록만 · 착수 0)

- 여정 · 자동발송 · 자동 마케팅 **발송 배관**의 고객 DB 값 정리(표본 밖 고객 값의 보낼 수 없는 글자 = 그 번호 9401) — 검사는 P5 로 막히지 않는다 · 값 품질은 별도 축.
- `sanitizeForSms` 가 보낼 수 있는 글자(★ · ※ · ▶ 등)까지 바꾸는 옛 정규화(B-0910-5 기록 · AI 글 한정).
- **R68 다른 기능(Harold 판단)**: 직접발송 · AI 캠페인 발송 라우트(`routes/campaigns.ts` · 발송 절대 보호 영역)에 서버 글자 관문 0 — 화면 안내(`frontend utils/smsSafeChars.ts`)만 있고 서버는 받아 보내 그 번호마다 9401. 스팸 검사 판정 자리가 아니라 이번 축 밖이지만 같은 뿌리(R68)라 기록한다.

## §14 직원 지시문(C109-S1 · 엑셀 = docs/2026-11-06-c109-staff-sheet.xlsx · 시트 55 ~ 64)

- 번호 = C108 시트 50 ~ 54 다음(설계 때 적은 50 ~ 59 는 C108 과 겹쳐 옮김 · 1106).
- 기대 문장 = 진짜 함수(글 준비 CT · 관문 CT · CT-J10 · 안내 문장)를 돌려 뽑은 그대로(1106 · 시트에 적은 입력 글 기준 · 앞 글자 = 보낼 수 있는 글자 최대 8자).
- 59(자동발송 고치기) = 화면이 먼저 막는다(0910 결정 D2 · 서버 관문은 뒷받침) → 화면 문장.
- 계정 = 테스트계정 psy5868 · 받는 번호 = 박성용 휴대폰 + 도달 불가 번호 둘 · 대행은 승인하지 않고 취소.

| 시트 | 볼 것(요지 · 문장 원문 = 엑셀) |
|---|---|
| 55 메일 접수 이모지 | 회신 메일 정리 알림 줄 · 테스트 문자에 이모지 0 · 승인 요청 문자 「보낼 수 없는 글자를 빼고 보냅니다:」 줄 · 진행 기록 정리 줄 · 「검사 장비 문제」 0 |
| 56 메일 접수 보낼 수 없는 글자 | 반려 회신 사유 「문안에 문자로 보낼 수 없는 글자가 있어 접수하지 못했습니다: 2번째 줄 '카페 caf' 뒤 보낼 수 없는 글자(U+00E9). …」 · 새 건 0 |
| 57 메일 접수 명단 값 | 회신 「명단 1곳에서 보낼 수 없는 글자를 뺐습니다(예: 명단 2행 이름 칸 '다라' 뒤 이모지(U+1F60A))」 · 승인 요청 문자 명단 줄 |
| 58 화면 접수 | 접수 완료 아래 정리 알림 · 문안 단계 막힘 0 · 문안 고치기의 막음 글자 = 「저장하지 못했습니다 … 다시 저장해 주세요」 |
| 59 자동발송 고치기 | 화면 문장 「문자로 보낼 수 없는 글자가 있습니다. …」 · 저장 0 |
| 60 자동 마케팅 리마인드 · 혜택 | 「리마인드 문안 '가을 신상 입고' 뒤 이모지(U+1F60A)」 · 「혜택 '카페 caf' 뒤 보낼 수 없는 글자(U+00E9)」 · 저장 0 |
| 61 플래너 문자 문안 · 혜택 | 「본문 '가을 신상 입고' 뒤 이모지(U+1F60A)」 · 「혜택 '카페 caf' 뒤 …」 · 저장 0 |
| 62 여정 칸 | 막음 글자 = 「본문 '상 카페 caf' 뒤 보낼 수 없는 글자(U+00E9)」 · 켜기 0 · 이모지만 = 그 문장 0 |
| 63 직접발송 스팸 검사 | 「문자로 보낼 수 없는 글자가 있어 검사하지 않았어요: 본문 '가을 신상 입고' 뒤 이모지(U+1F60A). …」 |
| 64 AI 한줄로 칩 | 칩 「보낼 수 없는 글자가 있어요: N번째 줄 '…' 뒤 이모지(U+1F60A)」 · 「검사 장비」 0 |
