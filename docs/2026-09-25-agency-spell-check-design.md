# 대행발송 맞춤법 검사 설계서 (2026-09-25)

> **발동** = Harold 0925 「맞춤법 검사 너무 좋은 것 같은데 대행발송 시에 이거 검사해서 테스트 보내주는 거 어떻게 생각해?」 → 조건 3개(자동 교정 0 · 문자 보호 구간 · 바이트) 제시 → 「오케이 좋아 진행하자」.
> **상설 SoT** = [FEATURE-AGENCY-SEND.md](FEATURE-AGENCY-SEND.md)(불변 26개 · 파일별 소유). 검사기 원본 = [SNS 채널 설계서 B-7](2026-09-24-sns-channel-design.md). 문서와 코드가 다르면 현재 코드가 진실이다.

---

## 0. 한 줄

**1차 검사를 통과한 문안을 맞춤법 검사기로 한 번 더 보고, 고칠 곳을 담당자 안내 문자·승인 화면에 알린다. 고치는 것은 담당자가 누를 때만이고, 고치면 지금 있는 문안 수정 흐름(재검사 → 테스트 문자 → 재승인)을 그대로 탄다.** 새 상태·새 승인 규칙 0.

## 1. 지금 흐름 (코드 확인)

| 자리 | 코드 | 이번에 닿는 것 |
|---|---|---|
| 1차 검사 | `agency-send-worker.ts runFirstTest` · 스팸 검사(`runSpamRound` · 막히면 AI 다듬기) → `saveTestResult` → `awaiting_approval` → **테스트 문자**(`sendManagerTest` · 실물 그대로) → 승인 가능 시각 판정 → **승인 안내 문자**(`buildPassedNotify` · 담당자별 승인 주소) | 테스트 문자 뒤·승인 안내 앞에 검사 1회 |
| 승인 안내 문구 | `agency-send-notify.ts buildPassedNotify`(분기 2개 · 소비처 = 워커 한 곳) | 고칠 곳 N곳 한 줄 |
| 문안 수정 | `routes/agency-send.ts POST /:id/content` · 원문·현재 문안 교체 · `content_version+1` · `status='received'` · 승인·`final_test_at`·시도 키 지움 · 관찰 `revision` CAS | **그대로 쓴다**(고치기 = 이 경로) |
| 로그인 상세 | `components/agency/AgencySendDetail.tsx` · 고치기 칸 · ★0910 '문자로 보낼 수 없는 글자' = 누르면 대체한 문안을 고치기 칸에 넣고 **저장해야 재검사** | 같은 방식으로 목록 추가 |
| 승인 링크 화면 | `pages/AgencyApprovePage.tsx` + `routes/agency-approve.ts GET /info` · ⛔ 이 화면은 승인 하나뿐(수정은 로그인 화면 소유) | 읽기 전용 목록 |
| 문자 종류 | 접수 때 정해진 `message_type`(SMS·LMS·MMS)이 끝까지 간다(원스텝 = 45자 초과·제목이면 LMS) · 바이트 CT = `utils/message-byte.ts eucKrByteLength` | 단문 90바이트 규칙 |
| 이벤트 표 | `components/agency/AgencyEventLog.tsx EVENT_LABEL` · 새 kind 는 같은 커밋 등재(FEATURE §3) | `spell_checked` 1줄 |

## 2. 불변 (이번에 새로 지킬 것)

1. **⛔ 자동 교정 0.** 검사 결과로 문안을 바꾸는 코드는 없다. 바뀌는 것은 담당자가 [고치기]를 누르고 **저장**했을 때뿐이다([고객 문안은 우리가 바꾸지 않는다] · 0910 시세이도 줄표).
2. **⛔ 테스트 문자 본문은 손대지 않는다.** 실제로 나갈 글 그대로여야 담당자 확인이 의미가 있다. 검사 결과는 **승인 안내 문자**와 화면에만 싣는다.
3. **⛔ 결과는 문안 버전에 묶인다.** 저장값에 `version`을 두고, 화면·안내는 `version = content_version`일 때만 쓴다. 문안 수정은 결과를 지운다.
4. **⛔ 검사는 흐름을 막지 않는다.** 권고일 뿐이라 AI 실패·시간 초과(20초)·한도 초과·컬럼 없음이면 결과 없이 원래 흐름 그대로 간다(안내 줄도 없다). 기록만 남긴다.
   ★0925 Codex 1R·2R 정밀화: 20초 상한은 **바깥 AI 호출(보호 낱말 조회 포함)**에 건다. DB 읽기·쓰기는 워커 A의 이웃 단계(`saveTestResult`·`setStatus`·`freshLinkFields`)와 같은 취급이다 — 이웃이 기한 없이 기다리므로 이 단계만 묶어도 최악 시간은 같고, 앱 쪽 타이머로는 DB의 늦은 COMMIT을 막지 못한다(덧대기를 거두고 이 문장으로 정한다). 승인 안내의 건수는 안내 직전 최신 행의 저장값(`readAgencySpellCount`)에서 센다.
5. **⛔ 크레딧 0.** 대행발송 AI 다듬기 0 크레딧(Harold 0822 확정)과 같게. source = `agency-send-spell`(단가표에 없음 = 0 · SNS 검사도 0).
6. **⛔ 문자 보호 구간을 건드리는 교정은 버린다**: `%항목%` 변수 · `(광고)` · 수신거부 줄(`무료수신거부`·`무료거부`·`080`) · 전화번호 · 링크 · 문자용 기호(한글·영문·숫자·공백·기본 문장부호 밖의 글자 전부 · 목록을 따로 두지 않는 규칙) · 회사명·브랜드명 · 금액·혜택(기존 규칙). SNS 보호 구간(링크·금액·#태그·@계정·회사명·자주 쓰는 태그)에 **문자 전용**을 더한다.
7. **⛔ 단문(SMS) 접수는 고친 뒤 90바이트(EUC-KR · `eucKrByteLength`)를 넘는 교정을 막는다.** 목록에 "고치면 단문 길이를 넘어요"로 보이고 [고치기]가 잠긴다. 변수 칸은 명단 값에 따라 달라지므로 판정은 **문안 원문(변수 표기 그대로)** 기준이다. ⚠ 배관이 단문 90바이트 초과를 어떻게 다루는지는 미검증 — 이 설계는 그 상태를 새로 만들지 않는 쪽을 택한다.
8. **⛔ 문자로 보낼 수 없는 글자는 새 판정을 만들지 않는다.** 글자표(`frontend/src/utils/smsSafeChars.ts` · 게이트웨이 CP949 표)는 화면에만 있고, 상세 화면이 저장 전에 이미 막는다(`SmsCharsetNotice` · `hasUnsupportedSmsChars` · 0910 결정 D2). [고치기]는 고치기 칸에 넣을 뿐이라 그 검사를 그대로 지난다.

## 3. 설계

### 3-1 검사기 공용화 — `utils/spell-check.ts`(신설)

- SNS `sns-spell-check.ts`의 **판정(`judgeSnsSpellCandidates`)과 AI 호출(`checkSnsSpelling`)을 채널 중립 CT로 옮긴다.** 채널이 넘기는 것 = 보호 구간 찾기 함수 · 보호 낱말 · source · 추가 판정(바이트 등).
- `sns-spell-check.ts`는 SNS 보호 구간만 얹는 얇은 층으로 남긴다(**SNS 동작·응답 불변** · 기존 계약 테스트 그대로 통과가 기준).
- 코드 이동은 원본 복사(메모리 `feedback_move_code_copy_original_never_retype`).

### 3-2 대행 층 — `utils/agency-send-spell.ts`(신설)

- `agencySpellProtectedSpans(content)` = 2-6의 문자 전용 구간 + 공용 구간.
- `checkAgencySpelling({ companyId, userId, content, messageType, protectedWords })` → `{ issues[{…, blocked?: 'sms_bytes'}], failed }`. 20초 상한(`Promise.race`).
- `readAgencySpell(row)` = 저장값이 현재 버전이면 issues, 아니면 null(화면·링크·안내 공용).

### 3-3 저장 — `agency_send_requests.spell_check jsonb NULL`(DDL 1 · 비어 있어도 되는 칸)

- 값 = `{ version, checkedAt, issues, failed }`. 쓰는 곳 = 워커 A(버전 조건 UPDATE · `WHERE id AND content_version = $v`) · 문안 수정 라우트(`spell_check = NULL`).
- **컬럼이 없으면**(배포 뒤 DDL 전) 저장·표시를 건너뛴다 — 판정은 기존 `hasAgencyColumn`. 안내 문자의 "N곳"은 저장이 된 때만 싣는다(화면에 없는 숫자를 문자에 보내지 않는다).
- 저장하는 이유: AI 답은 매번 조금씩 달라, 그때그때 돌리면 문자의 "2곳"과 화면 목록이 어긋난다.

### 3-4 실행 시점 — 워커 A 통과 분기

순서 = 테스트 문자(지금 그대로) → **맞춤법 검사 → 저장 → 이벤트 `spell_checked {count}`** → 승인 가능 시각 판정(지금 그대로) → 승인 안내(N곳 줄). 막힌 문안(`test_failed`)은 검사하지 않는다. 당일 재검사(워커 B)는 검사하지 않는다. 검사는 다듬기 뒤의 **최종 문안**에 한다.

### 3-5 승인 안내 문자

`buildPassedNotify` 두 분기에 `spellCount > 0`일 때만 한 줄: **"맞춤법을 확인할 곳이 N곳 있습니다. 승인 전에 확인해 주세요."** 줄표·이모지 0(FEATURE 불변 10). 안내 문자는 회사 비용이라 한 줄로 끝낸다.

### 3-6 로그인 상세 — `AgencySendDetail.tsx`

- 고칠 수 있는 상태 + 현재 버전 결과가 있으면 "맞춤법 확인" 칸: 줄마다 `고칠 말 → 바른 말 · 사유` + **[고치기]** · 칸 위 **[모두 고치기]** · **[그대로 두기]**(화면에서만 접는다).
- [고치기] = 고치기 칸을 열고 그 자리를 바꿔 넣는다(여러 개 누적 · 원문 자리가 이미 바뀌었으면 건너뛴다). **저장해야** 기존 문안 수정 경로로 재검사가 시작된다 — ★0910 '보낼 수 없는 글자' 대체와 같은 방식이다(자매 화면 규칙).
- 저장 전 안내는 지금 문구 그대로("고치면 승인이 지워지고 검사를 처음부터 다시 합니다").

### 3-7 승인 링크 화면 — 읽기 전용

`GET /api/agency-approve/info` 응답에 현재 버전 결과만 싣고, 화면은 목록 + "고치려면 한줄로 화면의 대행발송 메뉴에서 문안을 고쳐 주세요. 이대로 승인해도 됩니다."(이 화면은 승인만 · 기존 원칙). 노출은 문안에서 나온 것뿐이라 노출 규칙(문안·시각·건수·발신번호) 안이다.

### 3-8 접수 화면 사전 검사 — 함께 넣기를 추천

화면 접수(3단계 Composer)에 **[맞춤법 검사]** 버튼. `POST /api/agency-send/spell-check {content, messageType}` → 같은 판정(저장 0). 접수 전에 고치면 재검사·재테스트 왕복이 0이다. 원스텝·이메일 입구는 문안이 파일 안이라 사후 검사(3-4)만 받는다.

### 3-9 정정 — 이메일 접수 회신 메일

앞선 답변에서 "회신 메일에 목록"이라고 했으나, **회신 메일은 접수 때 나가고 검사는 그 뒤 워커 A에서 돈다.** 순서상 회신에 실을 수 없다. 이메일 입구도 안내 문자·승인 링크 화면·로그인 상세로 본다(회신에 싣으려면 접수 코어에서 AI 를 불러야 하고, 그러면 메일 워커가 AI 대기만큼 붙잡힌다 · 채택 안 함).

## 4. 영향표

| 대상 | 읽기·쓰기 | 처리 |
|---|---|---|
| `agency_send_requests.spell_check`(신규) | 쓰기 = 워커 A · 문안 수정 라우트 / 읽기 = 상세 `GET /:id` · 링크 `GET /info` · 워커 A(안내 N곳) | 컬럼 없음 폴백 · 버전 조건 |
| 문안 수정 라우트 | UPDATE 에 `spell_check = NULL` 한 칸 | 컬럼 없으면 그 칸을 뺀다(같은 탐지) |
| `buildPassedNotify` | 선택 필드 `spellCount` | 소비처 = 워커 1곳 · 없으면 지금과 같은 문자 |
| 워커 A | 통과 분기에 검사 1회(20초 상한 · 실패 무시) | 상태·전이·소유권 무변경 · 승인 시각 판정 앞 |
| SNS 검사기 | 공용 CT 로 이동 | SNS 응답·동작 불변(기존 계약 테스트 기준) |
| `EVENT_LABEL` | `spell_checked` 등재 | 같은 커밋 |
| 승인 효과·당일 재검사·적재·대조·취소 | 없음 | 문안이 바뀌는 길은 기존 수정 라우트 하나 |

## 5. 계약 테스트(추가)

1. 문자 보호 구간: `%이름%`·`(광고)`·`무료수신거부 080-…`·전화번호·링크·【】를 건드리는 후보는 버린다.
2. 단문 90바이트: 교정 뒤 91바이트면 `blocked='sms_bytes'` · LMS 는 막지 않는다.
3. 결과는 버전에 묶인다: 버전이 다르면 `readAgencySpell` = null · 문안 수정 UPDATE 에 `spell_check = NULL`(정적).
4. 워커 A 순서(정적): 테스트 문자 → 검사 → 승인 안내 · 검사 예외가 흐름을 멈추지 않는다.
5. 안내 문구: N=0 이면 줄 없음 · 줄표·이모지 0.
6. 자동 교정 0(정적): 워커·라우트에 검사 결과로 `current_content`를 쓰는 곳 0.
7. SNS 기존 계약 전량 그대로 통과.

## 6. DDL · 확인 SQL(배포 뒤 · Harold)

- 코드 전 확인: `SELECT column_name FROM information_schema.columns WHERE table_name='agency_send_requests' AND column_name='spell_check';` → 0행이어야 한다.
- DDL(배포 뒤 · 한 줄 · 비어 있어도 되는 칸이라 행 재작성 없음): `SET lock_timeout = '3s'; ALTER TABLE agency_send_requests ADD COLUMN IF NOT EXISTS spell_check jsonb;`
- 코드는 컬럼이 없어도 돈다(검사만 저장·표시되지 않는다).

## 7. 순서 · 미검증

1. 공용 CT 이동(SNS 계약 통과 확인) → 2. 대행 층 + 저장 + 워커 A + 안내 문구 → 3. 로그인 상세 · 링크 화면 → 4. 접수 화면 버튼 → 5. 테스트 · tsc · 전체 vitest · build:safe.
- 미검증: 배관의 단문 90바이트 초과 처리 · 실제 문자 문안에서 AI 교정 품질(오탐률) · 검사 20초 상한이 승인 안내를 얼마나 늦추는지.
- Codex: 워커 A(발송 경로 쓰기) 변경이라 대상. 진행은 §8 이력.

## 8. 이력

| 날짜 | 무엇 |
|---|---|
| 0925 | Harold 제안 · 조건 3 · 설계서 |
| 0925 | 구현: 공용 엔진 `spell-check.ts` · 문자 층 `sms-spell-check.ts`(링크 앞뒤 한 칸 · 단문 90바이트) · 대행 층 `agency-send-spell.ts` · 워커 A 훅 · 안내 줄 · 상세·링크·접수 화면 · `spell_checked` · 계약 `precheck-0925.test.ts`. 문안 수정 라우트의 컬럼 탐지는 차단 판정 **앞**(판정과 UPDATE 사이 대기 1개 불변식 · 대행 ⓔ) |
| 0925 | Codex 1R(high 1 · medium 3 전부 수용: 문안 끝 링크 삽입 → 링크 불변 두 번째 그물 `dropLinkChangingIssues` · 안내 건수 = 안내 직전 최신 행 · 최근 검사 = 보낸 종류 결과 있는 검사만 · 이력 기다리지 않음). 2R(high 2 = DB 단계 기한 덧대기의 같은 뿌리) → 덧대기 전량 제거 · 불변 4 정밀화(상한 = AI 호출만) |
