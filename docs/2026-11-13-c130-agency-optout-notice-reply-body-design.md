# C130 대행발송 = 수신거부 줄 겹침 안내(계도) + 메일 반려 회신 본문 보기 — 설계서

> 접수 2건(2026-11-12 14:07 · INVITO GROUPWARE 오류접수)
> - ① `cmwd36hnr1corjnscq7xlnim1` 「(이메일대행) 080수신거부 처리 관련 건」 · 서수란 · P2
> - ② `cmwd365ga1co9jnscho414cx1` 「대행 발송 메일 접수 - 반려/오류 내역 상세 보기」 · 남지현 · P0
> Harold 결정(1113 03:2x) = 「둘 다 진행」(설계 → Codex 설계 닫힘 → 구현 → Codex 구현 닫힘 → 보고). 배포 = .62 → .57 전환(1113 밤) 뒤.

## §0 판정 (실측 · 1113 03:1x Harold 운영 SQL)

### ① 결함 아님 · 법정 표기 규칙대로 동작 · 고객 문안이 원인 → 개선 = 접수 때 알림(계도)
- 광고 문자의 (광고) 머리 · 무료수신거부 꼬리 = CT `messageUtils.ts buildAdMessage`(416 ~ 458) 한 곳. 꼬리를 붙이지 않는 판정 = `AD_REJECT_FOOTER_RE = /무료\s*수신\s*거부|무료\s*거부/`(414) · 「무료」 없는 「수신거부」는 법정 문구로 인정하지 않는다(2026-09-19 남지현 접수 처방 · 407 ~ 411 주석 · 의도된 규칙).
- 금강제화 11-12 접수 28건 실측: 「※ 수신거부 : 080-644-9247」(무료 없음) 6건(11:03 ~ 13:36) = 꼬리 「무료수신거부 080-644-9247」 한 줄 더 → 직원 안내로 전부 취소 → 13:48 ~ 13:50 「※ 무료수신거부 : 080-644-9247」로 다시 접수 7건 = 한 줄 · 발송. 「무료 수신거부:080-…」(띄어쓰기) 건들은 이미 한 줄로 알아봄. 그 계정 080 = 080-644-9247(사용자 칸 → 회사 칸 순 · `getOpt080Number`).
- 최근 30일 대행 접수 87건 = 전부 광고(is_ad t) · 「무료」 없는 「수신거부」 줄이 든 광고 접수 = 7건(금강제화 6 · 인비토 시험 1).
- 기대 동작 「이메일 대행 (광고) · 무료수신거부 자동 처리 제거」 = **불가**(광고 문자의 법정 표기 · 전송자격인증 주체 책임). 「비광고 안내도 광고 처리」 = 요청서 「광고 여부」 빈칸 = 예(Harold 지시 기본값 · `agency-send-form.ts` 202 ~ 206) · 「아니오」면 표기 없음.
- 직원 처리(고객에게 고쳐 다시 보내게 안내) = 맞음. 「시스템이 중복 처리」라는 이해만 사실과 다름.
- **개선(이 설계)** = 고객 문안을 우리가 고치지 않는다(memory `feedback_never_alter_customer_copy_silently` · 「몰래 고치지 않는다 · 알리고 고치게 한다」). 대신 그 줄이 겹친다는 사실을 **접수 · 승인 전 모든 확인 자리**에서 알린다.

### ② 결함 아님 · 기능 없음 → 개선 = 회신 본문 저장 · 표시
- 메일 접수 원장 `agency_send_email_intake` 칸 19개(1113 information_schema 실측)에 회신 제목 · 본문 칸이 없다. 회신은 `sendReplyAndRecord`(`agency-send-mail-worker.ts` 576 ~ 606)가 만들어 보내고 `reply_status` 만 남긴다 → 관리자 화면(`AgencyMailIntakePanel.tsx`)은 짧은 사유 코드 라벨만 보일 수 있다(지금 「사유」 창 = 같은 짧은 문구).

## §1 미가입 · 직접발송 변화 0 (memory `feedback_free_direct_send_zero_change` · 맨 앞 기준)

| 바뀌는 코드 | 누가 거치나 | 미가입 직접발송에서 왜 0 인가 | 증명 시험 |
|---|---|---|---|
| `messageUtils.ts` 새 순수 함수 `findNonLegalOptOutLines` 추가(기존 `buildAdMessage` · `AD_REJECT_FOOTER_RE` 글자 그대로) | 대행발송 알림만 부른다 | 발송 · 적재 · 미리보기 경로는 이 함수를 부르지 않는다 · `buildAdMessage` 무변경 | 계약 시험 T1-3(`buildAdMessage` 결과 스냅숏 · 부르는 곳 목록 = 대행 파일만) |
| 대행발송 파일(`agency-send-*.ts` · `routes/agency-send.ts`) · 대행 화면 | 대행발송 개통 회사만(`canUseAgencySend`) | 대행발송은 회사 스위치로만 열린다 · 직접발송 경로 무관 | 기존 대행 시험 + 새 시험 |
| 메일 워커 `sendReplyAndRecord` · 관리자 `GET /api/admin/agency-send` · `AgencyMailIntakePanel` | 메일 접수 · 슈퍼관리자 | 고객 발송 경로 아님 | T2 시험 |
| DDL C130-DDL-1(메일 원장 칸 2 추가) | 메일 원장만 | 다른 표 무변경 | 실 PG 시험 |

## §2 흐름 표 ① — 수신거부 줄 겹침이 고객 · 직원 눈에 닿는 자리

뽑은 방법 = `grep -n "charNotes\|charNotice\|agencyCharNotice\|charLines" backend/src` (C109 「보낼 수 없는 글자」 알림이 이미 지나는 확인 자리 전부 = 같은 길에 얹는다) + `grep -n "sendReplyAndRecord(\|buildPassedNotify(\|buildReapprovalNotify(\|router.get('/:id'"`.

| # | 확인 자리(누가 보나) | 쓰는 쪽(파일:행) | 지금 | 새로 |
|---|---|---|---|---|
| A1 | 화면 원스텝 확인 창(고객 · 접수 전) | `routes/agency-send.ts` 317 ~ 330 `toAnalysisView` · 미리보기 332 | 글자 정리 알림 `charNotice` | + `optOutNotice: string[]` |
| A2 | 접수 성공 직후 알림(화면 접수 · 원스텝 · 메일 접수 회신의 블록) | 코어 `agency-send-intake.ts` 566 `notice: agencyCharNotice(charNotes)` → 라우트 247 · 444 토스트 · 메일 워커 1182 → 1233 회신 | 글자 정리 알림 | 코어 `notice` 에 수신거부 안내 줄을 덧붙인다(한 곳 · 세 입구가 같이 받는다) |
| A3 | 메일 회신 재시도(첫 회신 미도달) | `agency-send-mail-worker.ts` 1243 ~ 1312 `retryPendingReplies` | 알림 없음(원장에 notice 없음) | 행의 current_content · is_ad · message_type · 080 으로 다시 계산해 블록에 싣는다 |
| A4 | 문안 고치기 저장 직후(화면) | `agency-send-change.ts` 193 → 라우트 694 토스트 | 글자 정리 알림 | + 수신거부 안내 줄 |
| A5 | 접수 상세(고객 화면 · 승인 전 문안 확인) | `routes/agency-send.ts` 557 `GET /:id` → `AgencySendDetail.tsx` 270 「승인할 문안」 | 없음 | 응답 `optOutNotice` · 문안 칸 위 안내 상자(사라지지 않는다) |
| A6 | 슈퍼관리자 대행 원장 상세(직원) | `routes/admin.ts` 대행 상세 GET(6730 부근) → `AgencySendLedgerPanel.tsx` 342 ~ 상세 창 | 없음 | 같은 `optOutNotice` · 상세 창 안 안내 상자 |
| A7 | 담당자 승인 요청 문자(1차 통과 · 승인 요청 다시 보내기) | `agency-send-worker.ts` 873 ~ 879 · 2310 ~ 2316 `buildPassedNotify` | `charLines` | + `optOutLine`(짧은 한 줄) |
| A8 | 담당자 재승인 문자(다듬은 문안 통과) | `agency-send-worker.ts` 1035 · 1037 · 1369 · 1371 `buildReapprovalNotify` | 없음 | + `optOutLine` |

판정 자리(값 범위 축)는 하나 = `findNonLegalOptOutLines(text)`:

| 입력 | 결과 | 까닭 |
|---|---|---|
판정은 **변수 조각을 뺀 글**(`findVarTokens` 로 찾은 `%이름%` 조각을 **공백이 아닌 경계 글자 `\u0001`** 로 바꾼 것 · `var-tokens.ts` CT 재사용 · 빈 글로 지우면 `무료%고객명%수신거부` 의 양옆이 붙어 없던 「무료수신거부」가 생긴다 = Codex 설계 2R)에서 한다. 변수 이름은 발송 글이 아니기 때문이다(Codex 설계 1R #3 · 이름 안 「무료수신거부」가 겹침 안내를 숨기던 길).

| 입력(조각 뺀 글 기준) | 결과 | 까닭 |
|---|---|---|
| is_ad = false | 알림 0(부르는 쪽이 거름) | 꼬리를 안 붙인다 = 겹침 0 |
| `AD_REJECT_FOOTER_RE` 일치(무료수신거부 · 무료 수신거부 · 무료거부 어디든) | [] | `buildAdMessage` 가 꼬리를 안 붙인다 = 겹침 0 |
| 「수신\s*거부」 가 든 줄이 있고 위 일치 없음 | 그 줄들(표시는 **원문 줄** · 앞뒤 공백 정리 · 줄마다 80자 넘으면 앞 80자 + …) | 꼬리가 붙어 수신거부 줄이 둘이 된다 |
| 「수신거부」가 없음 | [] | 꼬리 한 줄뿐 = 겹침 0 |
| 법정 문구가 변수 이름 안에만(`%무료수신거부번호%`) + 다른 줄에 「수신거부:080…」 | 그 「수신거부」 줄(알림 있음) | 이름은 발송 글이 아니다 · 치환 뒤 값이 번호뿐이면 꼬리가 붙는다 |
| 「수신거부」가 변수 이름 안에만(`%수신거부번호%`) | [] | 조각을 빼면 「수신거부」 낱말이 없다 · 치환 값에 낱말이 있는지는 접수 때 모른다 |
| 조각이 법정 문구 낱말 사이(`무료%고객명%수신거부:080…`) | 그 줄(알림 있음) | 경계 글자가 「무료」와 「수신거부」를 떼어 놓는다 · 실제 글 「무료홍길동수신거부」도 법정 문구가 아니다 |
| 조각이 「수신 · 거부」 사이(`수신%고객명%거부`) | [] | 실제 글에도 「수신거부」 낱말이 없다 |
| 여러 줄 | 줄마다 하나씩(최대 3줄 · 넘으면 「외 N줄」) | |
| SMS(꼬리 = 무료거부) · 080 없음 | 판정 같음 · 꼬리 글만 다름(문구 2번) | |
| 빈 본문 · null | [] | |

한계(기록): 판정은 문안 원본(치환 전) 기준이다. 법정 문구가 **변수 값**(명단 칸)에서만 들어오면 받는 사람마다 꼬리가 붙거나 안 붙는데, 접수 때는 값을 모르므로 그 경우 안내가 실제와 다를 수 있다(안내일 뿐 발송 · 판정에는 쓰지 않는다).

문구(그리는 화면 축 · 바깥 문장 = 줄표 · 가운뎃점 0 · 모델명 0):

- 확인 자리 공통(A1 ~ A6) = `agencyOptOutNotice({ content, isAd, messageType, opt080, how })` → 줄 2 ~ 3개:
  1. `수신거부 줄 안내: 문안의 「{줄}」에는 '무료'가 없어 법에서 정한 수신거부 문구로 보지 않습니다.` (줄이 여럿이면 「a」, 「b」)
  2. `그래서 보낼 때 맨 끝에 「{꼬리}」 줄이 자동으로 한 번 더 붙어, 받는 분께 수신거부 줄이 두 번 보입니다.` (꼬리 = LMS · MMS `무료수신거부 {080}` · SMS `무료거부{080 숫자만}` · 080 없으면 `무료수신거부` · `무료거부` = `buildAdMessage` 450 ~ 452 와 같은 식 · 꼬리 글을 만드는 식은 `buildAdMessage` 와 한 함수로 뽑는다(T1-2))
  3. how 별 고치는 길 한 줄: `mail` = `한 번만 나가게 하려면 진행 상황 주소에서 그 줄을 '무료수신거부'로 고치거나 지워 주세요.` · `upload` = `한 번만 나가게 하려면 요청서의 그 줄을 '무료수신거부'로 고친 뒤 다시 올려 주세요.` · `edit` = `한 번만 나가게 하려면 문안 고치기에서 그 줄을 '무료수신거부'로 고치거나 지워 주세요.` · `staff` = `고객에게 그 줄을 '무료수신거부'로 고치거나 지우도록 안내해 주세요.`
- 담당자 문자(A7 · A8) = `agencyOptOutSmsLine(...)` → 한 줄 `문안의 수신거부 줄에 '무료'가 없어 끝에 무료수신거부 줄이 한 번 더 붙습니다. 한 줄로 하려면 문안을 고쳐 주세요.`(70자 이하) (문자 = 회사 비용 · 짧게 · `sanitizeSmsText` 를 지나는 compose 그대로)

080 번호 = 확인 자리마다 `getOpt080Number(created_by 또는 auth.userId, company_id)`(발송 · 미리보기와 같은 함수 · `agency-send-preview.ts` 42 · `agency-send-worker.ts` 396). 실패하면(조회 오류) 번호 없는 꼬리 문구로 알린다(알림이 접수 · 승인을 막지 않는다).

## §3 흐름 표 ② — 회신 본문이 만들어지고 · 저장되고 · 보이는 자리

| # | 이음매 | 쓰는 쪽 | 읽는 쪽 | 새로 |
|---|---|---|---|---|
| B1 | 반려 회신 만들기 | 반려 회신 호출 6곳(구현 판 줄 = 792 owner_inactive · 820 daily_sender_limit · 860 회사 게이트 · 870 too_large · 903 `reject()` = 첨부 · 요청서 · 코어 반려 전부 · 1172 duplicate_request) | — | 이 6곳 = **반려 회신** → `sendRejectReply`(본문 저장 켬) · ★1113 구현 정정 = 옛 「7곳」은 `reject()` 를 두 번 센 것 |
| B2 | 접수 완료 회신 | 1235 · 재시도 1308 | — | 저장 안 함(접수 원장 `agency_send_requests` 에 문안 · 담당자 번호가 이미 있다 · 화면은 반려 · 오류 행만 그린다 · 개인정보 최소) |
| B3 | 저장 | `sendReplyAndRecord` 안 UPDATE 셋(590 상한 안내 · 597 skipped · 602 정상) | — | 같은 UPDATE 에 `reply_subject` · `reply_text` 를 싣는다(저장 켬일 때만 · 칸이 있을 때만) |
| B4 | 칸 확인 | — | `hasAgencyColumn(pool, 'reply_text', 'agency_send_email_intake')`(기존 CT · 표 이름 축 넓힘) | 칸 없음(DDL 전) = 종전 UPDATE 그대로 · **확인 조회가 실패(던짐)하면 그 호출만 「저장 안 함」으로 종전 UPDATE**(실패는 캐시하지 않는다 · 기존 CT 규칙 그대로) · 회신 전송 · 상태 기록은 어느 경우도 막히지 않는다(Codex 설계 1R #1) |
| B5 | 관리자 조회 | — | `routes/admin.ts` 6682 recentRejected | 칸이 있으면 `i.reply_subject, i.reply_text` 를 싣고 응답에 `replyBodyReady: true` · 없음 · 확인 실패 = 종전 SELECT + `replyBodyReady: false` · **새 SELECT 가 42703 이면 칸 캐시를 지우고(`forgetAgencyColumn`) 종전 SELECT 한 번 + false**(관제 전체가 null 로 사라지지 않게 · Codex 설계 1R #2) |
| B6 | 화면 | — | `AgencyMailIntakePanel.tsx` 표 | 행 클릭(키보드 Enter · Space) = 상세 창(`AdminDetailModal` · `AdminDetailItem`) = 받은 시각 · 보낸 주소 · 회사 · 사유 · 회신 상태 · 보낸 안내 메일(제목 · 본문 줄바꿈 그대로) · 저장 전 행 = 「이 건은 안내 메일 본문을 남기기 전에 처리되어 짧은 사유만 있습니다.」 · 칸 없음 = 「DB 마이그레이션 필요: 메일 원장 회신 본문 칸(C130-DDL-1)」 |

저장 규칙(B3) = 「이 메일에 대해 고객이 받은(또는 받을 뻔한) 메일 한 통」:

| 갈래 | reply_status | 저장하는 제목 · 본문 |
|---|---|---|
| 정상 전송 | sent · rejected · unknown | 우리가 보낸 반려 회신 그대로 |
| 상한 정확히 닿은 회차(`gate.capNotice`) | 안내의 결과 | 실제로 나간 상한 안내(REPLY_CAP_NOTICE) 그대로 |
| 같은 사유 24시간 안 · 상한 침묵(skipped) | skipped | 만들었지만 보내지 않은 반려 회신(화면 = 「보내지 않음: 같은 안내를 24시간 안에 이미 보냈거나 시간당 상한에 걸렸습니다」) |

값 범위: 본문 길이 상한 20,000자(넘으면 자르고 끝에 `…(이하 생략)`) · NUL(\u0000) 제거(PG text 거부 글자) · 제목 200자. 회신 본문에 들어가는 것 = 우리 문장 + 요청서 칸 값 일부(보낼 시각 원문 · 발송 ID 표시명 등) · 명단 열 이름 · 행 번호 · 개수 · 보낼 수 없는 글자와 **그 앞 최대 8자**(`agency-send-chars.ts` 103 「명단 N행 X 칸 '앞 글자' 뒤 …」 · `message-sanitizer.ts` `BEFORE_MAX = 8` · C109 사유 그대로 · 최대 20곳) · 회신번호 열 방식의 **미등록 회신번호**(명단 회신번호 칸 값 = 업체 발신번호). ★1113 구현 정정(T2-4 행동 시험이 찾은 사실) = 8자 이하 칸 값(짧은 이름 등)은 앞 글자로 통째 실릴 수 있다 · 저장의 목적이 「업체가 받은 메일 그대로」라 저장 본만 가리지 않는다(가리면 직원이 본 글과 업체가 받은 글이 달라진다). **받는 번호 칸 값 · 8자 넘는 칸 값 통째 · 첨부 바이트 = 0**(§18 불변 「첨부 · 명단 행 저장 금지」 = 행 통째 저장 0 유지 · T2-4 = 행동 시험으로 고정).

보관: 원장 설계(`docs/2026-08-22-agency-send-design.md` §18 · 883행)의 「보존 90일」을 따른다. **1113 grep 결과 이 원장을 지우는 코드가 없다(90일 정리 미구현)** → 이번 범위 밖 · 추가 과제로 기록(§9).

## §4 처방 (정답 하나씩)

### ① 수신거부 줄 겹침 안내
1. `messageUtils.ts`
   - `export function adRejectFooterText(msgType, opt080): string` = `buildAdMessage` 450 ~ 452 의 꼬리 글 식을 뽑은 것 · `buildAdMessage` 가 이 함수를 부른다(결과 글자 그대로 · T1-3 스냅숏).
   - `export function findNonLegalOptOutLines(text): string[]` = §2 판정 표.
2. 새 파일 `utils/agency-send-optout.ts`
   - `agencyOptOutNotice({ content, isAd, messageType, opt080, how }): string[]`
   - `agencyOptOutSmsLine({ content, isAd }): string` (빈 문자열 = 없음)
   - `loadAgencyOpt080(userId, companyId): Promise<string>` = `getOpt080Number` 를 감싸 실패 = '' (알림이 접수를 막지 않게)
3. 배선(§2 표 A1 ~ A8 그대로):
   - A1 미리보기 라우트 = `toAnalysisView(a, optOutNotice)` · 확정 라우트는 코어 notice 로 받는다(A2)
   - A2 코어 `createRequestCore` 끝(566) = `notice: [...agencyCharNotice(charNotes), ...agencyOptOutNotice({ content: 저장한 current_content, isAd, messageType, opt080, how: input.source === 'email' ? 'mail' : 'edit' })]` (opt080 = 트랜잭션 밖에서 읽는다 · 원스텝 · 메일은 바깥 트랜잭션을 열기 전 `pre` 를 만드는 자리(라우트 405 · 워커 1134)에서 `loadAgencyOpt080` 한 번 → `pre.opt080` · 화면 접수(라우트 241 = pre 없음 · 코어 자체 트랜잭션)는 코어가 자체 트랜잭션을 열기 전에 읽는다 = `maxSmsBytes` 와 같은 꼴 · 바깥 트랜잭션 안에서 풀을 다시 기다리지 않는다)
   - A3 재시도 회신 = SELECT 에 `is_ad, message_type, created_by, company_id` 추가(기존 칸만 · DDL 무관) · 블록마다 `charNotes: agencyOptOutNotice({... how: 'mail' })`
   - A4 문안 고치기 = `notice: [...agencyCharNotice(...), ...agencyOptOutNotice({ content: body, isAd: row.is_ad, ..., how: 'edit' })]`
   - A5 · A6 상세 = 응답에 `optOutNotice`(how = 고객 'edit' · 관리자 'staff') · 화면 = 문안 칸 위 호박색 안내 상자(사라지지 않음 · 버튼 없음)
   - A7 · A8 = `AgencyNotifyContext.optOutLine?: string` · `buildPassedNotify` 두 갈래 · `buildReapprovalNotify` 에 `charLines` 다음 자리 · **판정 글 = 그 자리에서 담당자 테스트 문자(`buildSample`)를 만든 바로 그 글**(Codex 설계 1R #4): 873 · 879 = finalContent · 1035 · 1037 = finalContent(1020 `{...target, current_content: finalContent}`) · 1369 · 1371 = 행의 current_content(1350 `buildSample(row)`) · 2314 · 2316 = 행의 current_content(테스트 문자 없음 · 지금 승인 대상 글) · is_ad · message_type · 080 = 그 행 값
4. 프론트
   - `AgencyOneStepModal.tsx` 292 의 `charNotice` 상자 옆(같은 모양 · 호박색) = `a.optOutNotice`
   - `AgencySendDetail.tsx` 「승인할 문안 / 지금 문안」(270) 위 = 안내 상자
   - `AgencySendLedgerPanel.tsx` 상세 창 = 같은 안내 상자
   - 접수 · 수정 직후 토스트 = 서버 notice 를 그대로 띄우는 기존 줄(207 · 469 · 161)이 받는다(새 코드 0)

### ② 회신 본문 저장 · 보기
1. DDL C130-DDL-1(배포 앞 · 칸 추가 · 옛 코드 무관):
   ```sql
   SET lock_timeout = '3s';
   ALTER TABLE agency_send_email_intake
     ADD COLUMN IF NOT EXISTS reply_subject varchar(200) NULL,
     ADD COLUMN IF NOT EXISTS reply_text text NULL;
   ```
2. `agency-send-intake.ts hasAgencyColumn` 표 이름 축에 `'agency_send_email_intake'` 추가 · `forgetAgencyColumn(column, table)`(캐시 한 칸 지우기) 추가.
3. `sendReplyAndRecord(..., opts?: { storeBody?: boolean })` — 상태를 적는 UPDATE 셋을 한 함수 `recordReply(intakeId, status, bump, body | null)` 로 모으고, 그 함수가 저장 조각을 싣는다 · 저장 값 = §3 저장 규칙. 반려 호출 6곳(B1) = `sendRejectReply`(= `storeBody: true`) · 접수 완료 둘(B2) = `sendReplyAndRecord` 그대로(생략).
   - 칸 확인 = `recordReply` 안에서 · 확인이 던지면 그 호출만 저장 안 함(종전 문장) · 칸 있음이면 저장 문장 → **42703 이면 `forgetAgencyColumn` 후 종전 문장 한 번 더** · 그 밖 오류는 종전처럼 던진다.
   - ⛔ SMTP 는 그대로 한 번(`sendAgencyReplyMail` 호출 위치 · 횟수 무변경) · 기록이 종전 문장으로 내려가도 reply_status · reply_attempts 는 종전과 같은 값이 남는다(재시도 패스가 같은 메일을 또 보내는 일 0).
4. 관제 recentRejected = CT `readRecentRejectedIntakes()`(agency-send-intake.ts · ★1113 구현 = 라우트 인라인에서 CT 로 · T2-5 동작 시험용) = 칸 확인(실패 = 없음 취급) 뒤 SELECT 를 고른다 · 새 SELECT 42703 = 캐시 지우고 종전 SELECT 한 번 · `routes/admin.ts` 응답 `mailIntake.replyBodyReady`.
5. `AgencyMailIntakePanel.tsx` = 행 = `adminRowOpen` + `ADMIN_TR_OPEN` · 사유 칸의 `AdminLongText` 를 일반 글(말줄임)로(행이 창을 연다 · 칸 클릭이 두 창을 열지 않게 `rowOpens`) · 상세 창 = §3 B6.

## §5 계약 시험 (뿌리마다 기계로 뽑는 대상 · 변이 빨간불)

| 번호 | 시험 | 변이(꺼 봄) → 빨간불 |
|---|---|---|
| T1-1 | `findNonLegalOptOutLines` 값 범위 표 전부(§2) | 판정 식에서 `AD_REJECT_FOOTER_RE` 확인을 빼면 「무료수신거부」 줄도 걸림 → 빨강 |
| T1-2 | 꼬리 글 = `adRejectFooterText` · `buildAdMessage` 결과의 꼬리와 같은 글(SMS · LMS · MMS × 080 있음 · 없음) | 꼬리 식 하나만 바꾸면 빨강 |
| T1-3 | `buildAdMessage` 스냅숏(기존 대표 입력 12종 결과 글자 그대로) · `findNonLegalOptOutLines` 를 부르는 곳 = `agency-send-optout.ts` 하나(소스 grep) | 발송 경로가 부르기 시작하면 빨강 |
| T1-4 | 확인 자리 배선 = §2 A1 ~ A8 의 각 자리에 `agencyOptOutNotice` 또는 `agencyOptOutSmsLine` 가 있다(소스 계약 · 구문 트리 · `charNotice`/`charLines` 가 있는 자리 집합 ⊆ 수신거부 알림이 있는 자리 집합) | 한 자리 빼면 빨강 |
| T1-5 | 문구 = 줄표 · 가운뎃점 · 모델명 0 · 담당자 문자 줄 70자 이하 | |
| T1-6 | 코어 · 문안 고치기 · 재시도 회신 · 승인 문자 = 「무료 없는 수신거부」 문안이면 알림 줄이 실리고 · 「무료수신거부」 문안이면 0 · 비광고면 0(단위 · 가짜 query) | |
| T2-1 | `sendReplyAndRecord` = 반려 저장 켬이면 세 갈래(정상 · 상한 안내 · skipped) 모두 reply_subject · reply_text 를 싣는다 · 접수 완료는 안 싣는다 · 칸 없음 = 종전 문장 · **칸 확인이 던짐 = 종전 문장 · 메일 한 번 · 상태 기록 됨** · **42703 = 캐시 지움 + 종전 문장 한 번 더 · 메일 한 번** | 저장 조각을 빼면 · 확인 실패를 위로 던지면 빨강 |
| T2-2 | 호출 8곳 분류 = 반려 6곳 `sendRejectReply` · 접수 완료 2곳 `sendReplyAndRecord`(저장 인자 없음)(소스 계약 · 구문 트리) | 반려 한 곳을 저장 없는 길로 바꾸면 빨강 |
| T2-3 | 실 PG = C130-DDL-1 얹은 사본에서 운영 UPDATE 문장 그대로 = 저장 · 20,000자 자름 · NUL 제거 · 칸 없는 사본에서 종전 문장 | |
| T2-4 | **행동 시험**: 명단 칸마다 표식 값(`MKR-행-칸`)을 넣은 요청서 · 명단으로 반려를 만드는 갈래(형식 오류 행 · 회신번호 열 오류 · 수신자 열 판별 실패 · 보낼 수 없는 글자 · 코어 반려 · 무헤더 + 문안 항목)를 반려 사유를 만드는 `analyzeOneStep` 에 태워(메일 워커는 그 errors · headers 를 그대로 회신에 싣는다), 사유와 열 이름에 표식 값(8자 넘게)이 **통째로** 나오지 않는다(보낼 수 없는 글자와 앞 최대 8자 · 열 이름 · 행 번호 · 미등록 회신번호는 허용 · 받는 번호 칸 값 0) | 반려 사유에 칸 값을 끼우면 빨강 |
| T2-5 | 관리자 응답 = 칸 있음 · 없음 · 확인 실패 · 새 SELECT 42703 네 갈래 · `replyBodyReady` · mailIntake 가 null 로 사라지지 않는다 | |
| T1-7 | 판정 = 변수 조각 뺀 글 기준(§2 표의 변수 행 둘) · 재승인 · 승인 요청 문자의 판정 글 = 테스트 문자를 만든 글(수정 전 글이 「수신거부」 · 수정 뒤 「무료수신거부」면 알림 0 · 그 반대면 1) | 행의 옛 current_content 로 판정하면 빨강 |

## §6 직원 지시문 초안 (DEFECT-PLAYBOOK §3 · 구현 전 · 배포 뒤 실행)

시트 1 「수신거부 줄 안내」 (테스트계정 = 대행발송 열린 인비토 시험 계정 · 받는 번호 = 직원 본인 휴대폰 1개)

| 순 | 하세요 | 보이면 맞음 |
|---|---|---|
| 1 | 요청서 양식에서 광고 여부 「예」 · 문안 마지막 줄을 `※ 수신거부 : 080-644-9247` 로 적고, 명단에 본인 번호 1개 · 보낼 시각 내일 10시로 대행 메일 주소에 보낸다 | 접수 완료 메일에 「수신거부 줄 안내:」로 시작하는 줄이 보인다 |
| 2 | 한줄로 로그인 → 대행발송 → 그 접수를 연다 | 문안 위 노란 상자에 같은 안내가 보인다 |
| 3 | 담당자 휴대폰에 온 승인 요청 문자를 연다 | 「문안의 수신거부 줄에 '무료'가 없어」 줄이 보인다 |
| 4 | 문안 고치기에서 그 줄을 `※ 무료수신거부 : 080-644-9247` 로 바꿔 저장 | 노란 상자가 사라진다 |
| 5 | 1번을 문안 마지막 줄 `※ 무료수신거부 : 080-644-9247` 로 다시 보낸다 | 접수 완료 메일에 「수신거부 줄 안내」 줄이 없다 |
| 6 | 1번을 광고 여부 「아니오」로 다시 보낸다 | 「수신거부 줄 안내」 줄이 없다 |
| 7 | 1 · 5 · 6 의 접수를 모두 취소한다 | 목록에 「취소」로 보인다 |

시트 2 「반려 메일 내용 보기」 (슈퍼관리자 계정)

| 순 | 하세요 | 보이면 맞음 |
|---|---|---|
| 1 | 대행 메일 주소에 첨부 없이 빈 메일을 보낸다 | 「[한줄로] 대행발송 접수 불가」 메일을 받는다 |
| 2 | 슈퍼관리자 → 대행 발송 → 대행발송 메일 접수 → 반려·오류 목록의 맨 위 줄을 누른다 | 창이 열리고 「보낸 안내 메일」에 1번에서 받은 메일과 같은 글이 줄바꿈까지 그대로 보인다 |
| 3 | 오늘 전에 반려된 줄(11월 12일 이전)을 누른다 | 「안내 메일 본문을 남기기 전에 처리되어 짧은 사유만 있습니다」가 보인다 |

## §7 배포 순서
1. DDL C130-DDL-1(배포 앞 · 서버 psql · 확인 = information_schema 두 줄).
2. 백엔드 build:safe → 프론트 build:safe → pm2 reload(적재 0건 한 줄 조건 · 런북).
3. 배포 뒤 확인 = dist grep `findNonLegalOptOutLines` · `reply_text` · 직원 시트 1 · 2.
4. 시점 = .62 → .57 전환(1113 밤) 이후(전환 밤 순서에 배포를 섞지 않는다).

## §8 기록만 (이번 범위 밖)
- 메일 원장 90일 정리 미구현(§3 · 설계 §18 883행 「보존 90일」인데 지우는 코드 0 · 1113 grep).
- 화면 접수 작성 칸에서 실시간 안내(작성 중 경고)는 넣지 않는다 · 접수 직후 토스트 + 상세 상자로 닫는다(프론트에 판정 식을 한 벌 더 두지 않기 위해 · 필요하면 별도 과제).
