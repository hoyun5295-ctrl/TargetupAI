# 대행발송 — 스팸 검사에 막힌 문안을 담당자 선택으로 그대로 보내기 설계서 (2026-11-24 · 초안)

> 접수 = 그룹웨어 오류접수 서수란 `cmwu6xwl22id9jnscc1qh2d38` 「(대행) 문안 스팸처리 무시 발송 필요」(폴라초이스 11-23 ~ 24 · KT 막힘 · 이틀 수정 · 끝내 직접발송으로 지원팀이 대신 보냄).
> 판정 = 개선 요청(지금 코드는 설계대로 동작 = 막히면 문안 고치기 · 취소뿐). 1안 = 접수 원문 그대로 「스팸에 걸린 경우 담당자에게 안내 시 스팸 무시 발송에 대한 선택을 주고 진행」. Harold 1124 「디버깅 승인하도록한다 제대로 하자」.
> 상태 = 구현 끝(1125 · 설계 Codex 4R approve · 구현 Codex 13R approve · 미커밋 · 원장 C161) · DDL 0 · 구현 기록 = §7.

## §1 흐름 표 — 막힌 접수가 담당자 선택으로 나가기까지

| 단계 | 지금(쓰는 쪽 · 읽는 쪽) | 이 기능이 걸리는 자리 |
|---|---|---|
| 1 접수(화면 · 원스텝 · 메일) | `agency-send-intake.ts` createRequestCore → received | 없음 |
| 2 1차 검사(최대 3회 · AI 다듬기) | `agency-send-worker.ts:993` runFirstTest → runSpamRound(`:394`) · 막힘 반환 = `finalContent: content`(마지막으로 다듬은 글 · `:539`) | 검사를 시작한 글(담당자가 넣은 글 = runSpamRound 의 `original`)을 막힘 결과에 함께 적는다 |
| 3a 통신사 막힘 확정 | `worker.ts:1056-1067` saveTestResult(지금 문안 = 다듬은 글 · 버전 +1) → test_failed · 사건 test_failed · 문자 buildTestFailedNotify(`agency-send-notify.ts:196`) | 결과 칸에 「그대로 보낼 수 있음」 표식(버전 · 보낼 글 · 막힌 시각) · 막힘 문자에 「그대로 보내기를 고를 수 있어요」 줄(링크 0) |
| 3b 주소 원인 막힘(4a) | `agency-spam-diag.ts:193-202` 한 트랜잭션 test_failed · 사건 test_failed(reason spam_address) · 다듬기 전이라 지금 문안 = 담당자 글 | 같은 표식(보낼 글 = 지금 문안) |
| 3c 2시간 전 재검사 막힘 | `worker.ts:1309-1323` test_failed · 사건 final_test_failed · 「예약취소」 문자 + 문안 확인 문자 | 같은 표식(보낼 글 = 승인했던 글 = 재검사를 시작한 글) |
| 3d 막힘 아닌 test_failed | 검사 장애(`:579`) · SMS 90바이트(`:644`) · 보낼 수 없는 글자 · 발송 거절(`:660`) · 접수 거절(settleSpamRejected `:653`) · 적재 단계(`:1653` · `:1661` · `:1887`) | 표식 없음 = 그대로 보내기 불가(보내도 실패하거나 검사 결과가 없다) |
| 4 담당자가 할 수 있는 일 | 화면 `AgencySendDetail.tsx:285` 「아래에서 문안을 고치면 검사를 다시」 · 고치기 · 취소 / 링크 화면 = test_failed 링크 없음(링크는 통과 때만 `buildApproveTexts`) / 전이표 `agency-send-state.ts:54` test_failed → received · cancelling | 「그대로 보내기」 조작(로그인 화면) · 전이 test_failed → awaiting_approval 추가 |
| 5 그대로 보내기를 고름 | (없음) | 보낼 글 = 표식의 글 · 문안 버전 +1 · 당일 막힘이면 「당일 검사 끝」 = 막힌 시각 · 승인 대기 → 담당자 테스트 문자(실물) + 승인 요청(새 버전 링크) · 사건 spam_override |
| 6 승인 | `routes/agency-send.ts:686` · `routes/agency-approve.ts:117` 지금 그대로(승인 없는 발송 0 유지) | 없음 |
| 7 발송일이 다르면 2시간 전 재검사 | `worker.ts:1205` finalTestRow · 막히면 3c | 그대로 보내기 버전 = 다듬기 없이 한 번 검사 · 막힘이면 진행(적재) · 접수 거절 · 길이 · 글자 · 장애는 지금 그대로 |
| 8 적재 직전 금지 표현 관문 | `worker.ts:1880` SPAM_BLOCKED · `direct-send-core.ts:319` | 무시 대상 아님(그대로) |
| 9 문안 고침 · 시각 변경 · 재접수 | `agency-send-change.ts` | 고치면 버전이 바뀌어 표식 · 선택이 저절로 무효 · 시각 변경 = 같은 버전이라 유지 · 재접수 = 새 접수 |

**값 범위 축**

| 들어오는 값 | 판정 |
|---|---|
| 통신사 막힘(3a · 3b · 3c) · 지금 버전 = 표식 버전 | 그대로 보내기 가능 |
| 표식 버전 ≠ 지금 버전(그 뒤 고침) | 불가(문안을 고쳤으니 다시 검사) |
| 표식 없는 옛 test_failed(배포 전) | 불가 · 고치면 다음 막힘부터 가능 |
| 3d 사유 | 불가(사유 문구 그대로) |
| 보낼 시각 15분 전 잠금 | 불가(승인 · 수정과 같은 잠금 `isAgencySendLocked`) |
| 같은 접수에 두 담당자가 동시에 누름 | revision CAS 하나만 통과 |

**그리는 화면 축** = 고객 대행발송 상세(`AgencySendDetail.tsx:285` 막힘 상자) · 링크 화면(`AgencyApprovePage.tsx` · 이번 무변경 · 승인 요청 링크는 지금 그대로) · 진행 기록 문장(`AgencyEventLog.tsx:17` EVENT_LABEL · 새 사건 2) · 진행 막대(`agency-send-api.ts:565`) · 관리자 대행발송 내역(사건 문장 공용) · 막힘 문자(`notify.ts:196`) · 2시간 전 막힘 문자(`notify.ts:117`) · 메일 접수 결과 회신(`mail-worker.ts:1385` · 문구 그대로 · 담당자 문자에 링크가 있다).

## §2 정한 것(1안 = 원문 그대로 · 근거)

1. **고르는 사람 = 고객사 담당자**(원문 「담당자에게 … 선택」) · 로그인 화면 한 곳(막힘 문자는 그 선택을 안내만 · 링크 0 = 설계 2R #2) · 슈퍼관리자 대행 0.
2. **고른 뒤 = 승인 대기**(테스트 문자 · 승인 그대로 · 불변 1 「승인 없는 발송 0」 유지). 고르는 즉시 승인으로 합치지 않는다.
3. **보내는 글 = 담당자가 넣은 글**. 지금은 막히면 지금 문안 자리에 AI 가 마지막으로 다듬은 글(그것도 막힌 글)이 남는다(`worker.ts:539`) → 그대로 보내기를 고르면 담당자 글이 다시 지금 문안이 되고 테스트 문자로 실물을 본다.
4. **2시간 전 재검사** = 그대로 보내기를 다른 날 고른 건만 다듬기 없이 한 번 · 통신사 막힘이면 진행 · 그 밖 사유는 지금 그대로(접수 거절 URL 이 새로 생긴 경우를 잡는다 · 「당일 검사 없는 발송 0」의 검사는 돈다).
5. **DDL 0** = 「그대로 보낼 수 있음」 표식은 행의 결과 칸(`last_test_result` jsonb)에 상태를 바꾸는 UPDATE 와 함께 · 고른 기록은 사건 `spam_override`(kind CHECK 없음) · 둘 다 문안 버전에 묶여 문안을 고치면 저절로 무효.

## §3 처방

**표식 = 행의 결과 칸 `last_test_result.spamOverridable = { version, submitted, checkedAt }`**(설계 1R #2 · 상태를 바꾸는 바로 그 UPDATE · lock_token 조건)
- 쓰는 곳 셋(막힘 갈래만): 1차 통신사 막힘 `setStatus(test_failed)`(`worker.ts:1057`) · 2시간 전 막힘 `setStatus(test_failed)`(`worker.ts:1310`) · 4a 한 트랜잭션 UPDATE(`agency-spam-diag.ts:194` 결과 칸 값에 더함).
- `submitted` = 1차 · 4a = `original_content`(담당자가 마지막으로 넣은 글 · 문안 수정 `agency-send-change.ts:189` 가 original · current 를 함께 바꾸고 검사 다듬기는 current 만 바꾼다) · 2시간 전 = 재검사를 시작한 글(승인했던 글). `version` = 그 UPDATE 시점 content_version. `checkedAt` = 막힘 확정 시각(1차 · 2시간 전 = 그 setStatus 시각 · 4a = 진단 트랜잭션 시각 · 설계 2R #1 = 4a 는 `last_test_at` 을 쓰지 않는다).
- 지우는 곳 = `setStatus` 가 기본으로 — 한 UPDATE 안에서: 표식을 넘기면 `jsonb_set(COALESCE(last_test_result, '{}'), '{spamOverridable}', 표식)` · 부르는 쪽이 결과 칸 값을 넘기면 `(그 값)::jsonb - 'spamOverridable'` · 둘 다 아니면 `last_test_result - 'spamOverridable'`(SQL NULL 그대로 · 나머지 키 그대로 = 보류 heldResultJson · 진단 diagHold · 잠금 복구 값 보존). 그래서 적재 직전 금지 표현(`worker.ts:1880-1889`) · 접수 거절 · 길이 · 글자 · 장애 · 발송 거절 등 다른 test_failed 는 표식 없음. 문안 수정은 결과 칸을 통째로 지운다. 취소 되돌림(cancelling → test_failed)은 같은 상태 복원이라 표식 유지가 맞다.

**판정 · 실행 = 접수 수정 배관 `utils/agency-send-change.ts`**(문안 수정 · 시각 변경과 같은 잠금 · 시도 키 · 15분 잠금 술어)
- `spamOverrideOf(row, now)`(순수) = 상태 test_failed · 표식 있음 · 표식 version = 지금 content_version · 그리고 **그대로 보낸 뒤 승인이 통하는가**: 표식 `checkedAt` 이 보낼 날(KST)과 같으면 「당일 검사 끝」 = checkedAt, 아니면 없음 → `checkApproval({ status: 'awaiting_approval', finalTestedAt: 그 값, approvalRequestedAt: now })` 통과 때만 허용 · 아니면 「보낼 시각이 가까워 그대로 보내려면 시각을 먼저 바꿔 주세요」(설계 1R #1 · 시각 변경 → 다시 검사 → 다시 막히면 다시 고를 수 있다).
- `agencyActions`(순수) 에 `spamOverride` = user 만(링크 · staff 불가) · `spamOverrideOf` 결과.
- `overrideSpamBlockTx({ requestId, companyId, revision, actor })` = 한 트랜잭션: 행 잠금(FOR UPDATE) → revision CAS → `spamOverrideOf` 를 잠근 행 · 지금 시각으로 다시 → `current_content = submitted` · **content_version + 1(글이 같아도 = 옛 승인 링크가 전부 죽고 테스트 문자 뒤 새 승인 링크만 산다 · 설계 1R #3)** · spell_check NULL · `final_test_at` = 「당일 검사 끝」 값 · `status = 'awaiting_approval'` · 승인 칸 · dispatch_key · campaign_id · expired_at · 잠금 칸 NULL · approval_requested_at = 지금(칸 있으면) · 결과 칸 표식 삭제 · 조건 = 문안 수정과 같은 `campaign_id IS NULL` · 시도 키 유휴 · 15분 잠금 밖 → 사건 `spam_override`(version = 새 버전 · fromVersion · userId) → COMMIT. 전이표(`agency-send-state.ts:54`)에 test_failed → awaiting_approval 추가.
- 커밋 뒤(던지지 않음): 담당자 테스트 문자(실물 · `sendManagerTest`) + 승인 요청(새 버전 링크) = `sendAgencyApprovalRequest(id, { withTest: true })`.
- **불변 6 넓힘(기록)**: `final_test_at` = 「발송일 당일 검사를 통과했거나, 당일 검사 결과(통신사 막힘)를 담당자가 받아들인 시각」. 막힌 글이 검사 없이 예약되는 길은 없다(검사는 했고 · 담당자 선택 사건이 같은 트랜잭션에 남는다).

**입구 = 로그인 화면 하나**(설계 2R #2 · 3R #1)
- 화면 `POST /api/agency-send/:id/spam-override`(요금제 문 · 일반 사용자는 본인 접수만 = 승인 라우트와 같은 술어 · 승인 라우트처럼 발신 인증).
- 막힘 문자(3a · 3b · 3c) = 지금처럼 `buildTestFailedNotify` 한 문장(담당자별 토큰 · `buildApproveTexts` 0) · 끝 줄만 「로그인하면 문안을 고치거나 검사 결과와 관계없이 그대로 보내기를 고를 수 있어요: hanjul.ai/agency-send」로.
- 링크 화면(`AgencyApprovePage`) · 링크 라우트(`routes/agency-approve.ts`) 무변경.

**2시간 전 재검사**(`finalTestRow`)
- 당일 막힘을 고른 건 = 「당일 검사 끝」이 있어 재검사 없이 적재(지금 `isQueueDue` 갈래 그대로).
- 다른 날 고른 건 = 지금 버전에 `spam_override` 사건이 있으면 `runSpamRound(target, MAX_TEST_ROUNDS - 1)`(한 차례 · 다듬기 0). 통신사 막힘이면 **한 트랜잭션**으로 소유권 토큰 조건 `final_test_at = NOW()` + 사건 `spam_override_final`(「발송 직전 검사에 걸렸지만 담당자 선택대로 진행합니다」 · 성공을 말하지 않는다 · 설계 2R #4) → 갱신 0행 · 사건 실패 = 롤백 · 적재하지 않음(설계 3R #2) → 커밋 뒤 지금 글 그대로 적재. 적재가 일시 실패해 approved 로 돌아가도 다음 주기는 `isQueueDue` 로 적재만 다시(설계 1R #4 · 재검사 반복 0). 통과 = 지금처럼 · 장애 · 길이 · 접수 거절 · 보류 = 지금 갈래 그대로.

**화면 · 문구**
- 고객 상세 막힘 상자 = 「검사 결과와 관계없이 이 글 그대로 보내기」 단추(허용일 때) · 불가 사유가 시각이면 그 문장 → 확인 창(보낼 글 · 막힌 통신사 · 「막힌 통신사를 쓰는 분께는 닿지 않을 수 있어요」 · 「테스트 문자와 승인 요청을 다시 보내 드려요」) → 실행. native dialog 0.
- 사건 문장(`AgencyEventLog.tsx` EVENT_LABEL) = `spam_override` 「스팸 검사 결과와 관계없이 그대로 보내기로 했습니다」 · `spam_override_final` 「발송 직전 검사에 걸렸지만 담당자 선택대로 진행합니다」.
- 메일 접수 결과 회신(`mail-worker.ts:1385`) = 무변경(담당자 문자가 고를 수 있다고 안내).

## §4 계약 시험(뿌리 = 새 뿌리 없음 · 기능 추가)

1. 표식: 막힘 갈래 셋만 표식을 쓴다(소스 · 동작) · `setStatus` 는 표식을 넘기지 않으면 지운다(부르는 쪽 결과 칸 값에서도 뺀다) · 4a UPDATE 는 표식을 넣는다.
2. 판정 `spamOverrideOf`: 상태 · 표식 유무 · 버전 · 당일 막힘(2시간 안쪽 · 15분 밖 = 허용 · 「당일 검사 끝」 = 표식 checkedAt) · 2시간 안쪽에 확정된 첫 4a(last_test_at 없음) = 허용(2R #1) · 다른 날 막힘 + 2시간 안쪽 = 불가(시각 변경 안내) · 15분 잠금 = 불가.
3. 실행(실 PG): CAS 불일치 = 409 · 판정 불가 = 400 · 성공 = 글 · 버전 +1(같은 글도) · 상태 · final_test_at · 표식 삭제 · 사건 한 트랜잭션 · 두 번째 실행 = 거절 · 옛 버전 승인 토큰으로 승인 = 거절 · 막힘 문자 셋에 승인 토큰 발급 0(소스 · `buildApproveTexts` 를 부르지 않는다).
4. 재검사: 당일 막힘을 고른 건 = 재검사 0 · 적재 · 다른 날 고른 건 = 한 차례 · 막힘이면 final_test_at(토큰 조건) + spam_override_final 한 트랜잭션 · 갱신 0행 · 사건 실패면 적재 0 · 적재 실패 뒤 다음 주기 = 재검사 0 · 적재 직전 SPAM_BLOCKED 거절 = 성공 사건 0 · setStatus 표식 삭제가 다른 키 · SQL NULL 을 보존 · 시각 변경 keepFinalTest = 같은 KST 날짜면 유지 · 날짜가 바뀌면 지움(2R 다음 단계).
5. 같은 버전의 적재 직전 금지 표현(dispatch_spam_blocked) 뒤 = 표식 없음 = 불가(Codex 설계 1R #2 시나리오).
6. 입구 = 화면 라우트 하나 · 소유자 술어 · 링크 라우트에 spam-override 0.

## §5 직원 지시문(구현 전)

| 순 | 하세요 | 보이면 맞음 | 맞음 / 다름 |
|---|---|---|---|
| 1 | 테스트계정으로 대행발송 화면 접수를 연다. 문안에 스팸 검사에 걸리는 글(지원팀이 정한 시험 문구)을 넣고 받는 사람 = 직원 본인 휴대폰 1명으로 접수한다 | 「접수했습니다」가 뜬다 | |
| 2 | 검사가 끝날 때까지 기다린다(최대 10분) | 휴대폰에 「문안이 스팸 검사에 걸렸습니다」 문자가 오고 「그대로 보내기를 고를 수 있어요」 줄과 hanjul.ai/agency-send 주소가 있다 | |
| 3 | 한줄로 대행발송 상세를 연다 | 막힘 상자 아래 「검사 결과와 관계없이 이 글 그대로 보내기」 단추가 보인다 | |
| 4 | 단추를 누른다 | 확인 창에 1번에 넣은 글 그대로와 「막힌 통신사를 쓰는 분께는 닿지 않을 수 있어요」가 보인다 | |
| 5 | 확인 창에서 「그대로 보내기」를 누른다 | 상태가 「승인 대기」로 바뀌고 휴대폰에 테스트 문자(1번 글)와 승인 요청 문자가 온다 | |
| 6 | 승인 요청 문자의 주소로 승인한다 | 상태가 「예약 완료」로 바뀐다 | |
| 7 | 예약 시각까지 기다린다 | 진행 기록에 「스팸 검사 결과와 관계없이 그대로 보내기로 했습니다」가 있고 발송 결과에 1건이 보인다 | |
| 8 | 같은 방식으로 하나 더 접수해 막히게 한 뒤, 상세에서 문안을 한 글자 고친다 | 「그대로 보내기」 단추가 사라지고 검사를 다시 한다 | |

## §6 불수용 · 범위 밖(기록)

- Codex 설계 2R #3(발송 20분 안쪽 적재 일시 실패 = 10분 재시도 대기와 후보 조건이 겹쳐 재시도 없이 만료) = 대행발송 적재 재시도의 기존 경로(`agency-send-worker.ts:1170-1176` · `:1903-1904`) · 이 기능이 만든 경로 아님 → `status/BUGS.md` 범위 밖 한 줄 · 불수용.

## §7 구현 기록(1125)

**구현 자리** — 판정 `agency-send-actions.ts` spamOverrideOf · 실행 `agency-send-change.ts` overrideSpamBlockTx · 표식 `agency-spam-diag.ts` spamOverrideMarker(순수) · 워커 `agency-send-worker.ts`(1차 · 2시간 전 막힘 표식 · 고른 버전 한 차례 · 받아들이기 트랜잭션 · 승인 요청 문자) · 라우트 `routes/agency-send.ts` POST /:id/spam-override · 링크 `routes/agency-approve.ts` loadLinkExtras · 화면 `AgencySendDetail.tsx` · `AgencyApprovePage.tsx` · `agency-send-api.ts` · 문자 `agency-send-notify.ts`.

**Codex 구현 13라운드 · 설계에서 바뀐 것**

| 라운드 | 지적 | 처리 |
|---|---|---|
| 1R #1 | 발신 인증 없이 테스트 문자 | 받음 = 설계 §3 대로 승인과 같은 관문(공용 함수 agencySenderAuthGate · 막히면 403 · 상태 · 문자 0) |
| 1R #2 · 2R #2 · 3R #1 · 4R #1 · 5R ~ 9R | 「보낼 글을 그날 검사했다」 근거 | 같은 뿌리 아홉 라운드 → 구조 답: 근거 = 첫 회차가 실제로 본 검사 행의 시각 하나(완료 대기가 이미 읽는 행에서 받음 · spamTestCreatedAt 같은 따로 읽기 · 큐 reused 칸 · 회차 시작 시각 · 전용 연결은 모두 걷어 냄). 4a = 판정(decide)이 같은 트랜잭션에서 이미 읽은 T 행 시각. 큐가 같은 날 같은 키를 이어 본 검사 = 그날의 검사(★2026-08-23(2) 규칙 그대로) |
| 1R #3 | 테스트 문자와 승인 링크 버전 경합 | 받음 = 커밋한 버전만 · 링크 직전 버전 · 시각 · 상태 대조(다르면 approval_request_skipped) |
| 1R #4 · 2R #4 · 2R #5 · 3R #2 · 4R #2 | 막힌 글을 「통과」라고 안내 | 받음 = 판정 한 곳 isSpamOverriddenVersion 을 문자 · 상세 · 링크가 같이 씀 · 확인 못 함 = 중립 문장 · 링크 카드 = 실제 검사 중일 때만 검사 문장 |
| 2R #1 | 낡은 수정 번호로 인증 문자 | 받음 = 인증 앞 409 |
| 2R #3 | 옛 문자 링크로 다른 시각 승인 | 불수용 = 링크 화면이 지금 시각 · 수정 번호로 승인(AgencyApprovePage summaryRows) |
| 5R ~ 8R | 검사 시각 읽기 실패 · 지연 | 따로 읽기를 없애 닫음(위 구조 답) |
| 10R ~ 12R | 4a 계약 시험 빈틈 | 10R · 11R 받음(변이 빨강 확인) · 12R 불수용(일부러 같은 이름으로 가려야 생기는 우회 · 13R 이 근거 수용) |
| (다른 세션 push 관문) | C142 SMS 길이 = 문안을 쓰는 모든 자리 | 받음 = overrideSpamBlockTx 에 agencySmsBytesOver · c142-staff-tickets K-C1 등록 |

**검증** — backend · frontend tsc 0 · 대행 · 진단 · 큐 · C142 단위 시험 651건 중 650(남은 1 = agency-cancel-invariants.test.ts:96 · 이번 변경 무관 · 커밋된 코드에서 이미) · 실 PG agency-spam-override-1124 10건 · 실 PG 전체 117파일 1,059건(1125 · 4a 마지막 수정 전 판 · 배포 앞 전체 다시) · 변이 21건 중 20 red(1 = 동치).

**범위 밖(기록만)** — 발송 20분 안쪽 적재 일시 실패 재시도 만료(설계 2R #3 · 위 §6) · agency-cancel-invariants.test.ts:96 의 700자 창(커밋된 코드에서 이미 696자 · 그 구간 이번 변경 0).
