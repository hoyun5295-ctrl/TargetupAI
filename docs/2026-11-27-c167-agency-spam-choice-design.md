# C167-C 대행 스팸 막힘 = 「스팸 통과 문안으로 승인 / 처음 접수한 문안 그대로 승인」 고르는 자리 한 곳 (설계서)

> 카드 = STATUS-FEED C167 · 뿌리 = ROOT-LEDGER R113 · 접수 = 그룹웨어 오류접수 cmwu6xwl22id9jnscc1qh2d38(서수란 · 1124 13:24 · **재오픈 1125 16:01**) · BUGS B-1126-4(1126 Harold 「스팸 걸리는 부분 찾아주는 건 아직 해결할 게 남았다고 디버깅이 올라와서」 = 이 재오픈 접수로 본다 · 접수 문장 「스팸을 찾아주는 건 좋은 기능 … 기존 문안과 스팸 통과 문안 중 … 선택」)
> 앞 설계 = docs/2026-11-24-agency-spam-override-design.md(C161 그대로 보내기 · 로그인 화면 · test_failed 만) · docs/2026-11-25-spam-diag-rewrite-design.md(C164 찾은 글 · 바꾼 곳 줄)
> 순서 = status/DEFECT-PLAYBOOK.md · Harold 1127 「추천대로」 = 두 단추 · 처음 접수한 문안 그대로 보내기를 로그인 없는 승인 링크에서도 연다

## §0 요약

- 접수 재오픈 원문(1125) 다섯 줄:
  1. 「대행발송 화면접수의 경우 스팸처리 확인 문자 없음(상세내역을 눌러야 스팸처리된 것을 확인) → 대기 후 승인 문자와 테스트 문자만 옴(이 때 온 문자는 접수한 문자가 아니라 한줄로 제안 스팸 통과한 문안으로 자동 처리) · "이 문안 그대로 보내기 없음"」
  2. 「발송시간이 촉박한 경우 스팸 처리 → 시간 변경하라고 안내 → 시간을 변경하면 한줄로 제안 스팸통과한 문안으로 자동 승인요청이 오고 접수한 문안 그대로 보내기가 없습니다」
  3. 「이메일로 함께 날라온 문안이 접수한 문안과 다릅니다 … "위 내용은 한줄로가 기록하고 다시 보낸 결과로 좁힌 것입니다." … 보내 주신 글이라고 기입되어 있어 혼동 … 스팸 통과 문안 추천으로 변경」
  4. 「컨펌 URL 문자는 로그인 없이 처리되는데 스팸문자 URL hanjul.ai/agency-send 접속 시 한줄로에 로그인하도록 변경되어 있는데 맞을까요?」
  5. 「기존 문안과 스팸 통과 문안 중 고객사가 선택을 명확하게 … 기존 문안 승인 / 스팸 통과 문안 승인과 같이 승인 버튼을 2개」
- 판정 = 결함(1 · 2 · 3) + 개선 요청 원문 1안(4 · 5 = Harold 1127 추천대로).
- 뿌리(R113) = 처음 글이 막혀 한줄로가 고친 글로 승인을 묻는 모든 갈래에서, **고를 자리가 「끝내 막힘(test_failed) · 로그인 화면」 한 곳뿐**이고 알리는 글(승인 문자 · 결과 메일)이 두 글을 구분해 부르지 않는다.
- 처방 = (가) 고친 글로 승인을 묻는 두 자리(첫 검사 통과 · 당일 재검사 재승인)도 「처음 글이 막혔다」 표식을 남긴다 (나) 고르는 판정 한 함수(`spamOverrideOf`)가 test_failed · 승인 대기 · 재승인 셋을 보고, 로그인 화면 · 승인 링크 둘에 같은 단추 (다) 「처음 접수한 문안 그대로 승인」 = 그대로 보내기 + 승인 한 번(한 단추) (라) 승인 문자 · 막힘 문자 · 결과 메일 문장이 두 글을 이름으로 가른다 (마) 막힘 문자에도 승인 링크.
- DDL 0 · ENV 0 · 표식은 이미 있는 결과 칸(`last_test_result.spamOverridable`).

## §1 접수 대조표

| 접수 줄 | 맡는 축 | 없으면 |
|---|---|---|
| 1 「스팸처리 확인 문자 없음」 | §5-4 승인 문자 첫 줄 = 「처음 접수한 문안이 스팸 검사에 걸려 한줄로가 고친 문안으로 통과했습니다」 | 고친 줄 모르고 승인 |
| 1 「이 문안 그대로 보내기 없음」 | §5-2 승인 대기에도 고르는 판정 · §5-3 두 단추 | 고친 글만 승인 가능 |
| 2 「시간 변경 → 스팸 통과 문안으로 자동 승인요청 · 그대로 보내기 없음」 | §5-1 다시 검사해 고친 글로 통과해도 표식 · §5-2 | 시각을 바꾸면 고를 길이 사라짐 |
| 3 「메일 문안 ≠ 접수 문안 · "보내 주신 글" 혼동」 | §5-5 메일 = 「보내 주신 문안」(처음 글) · 「한줄로가 고쳐 본 문안」(다르면 따로) · 끝 문장 정리 | 한줄로 글을 고객 글로 안내 |
| 4 「스팸 문자 URL 은 로그인」 | §5-4 막힘 문자에 승인 링크(로그인 없이 처음 문안 그대로 승인 · 시각 바꾸기 · 취소) · 로그인 주소는 「문안 고치기」만 | 메일 접수 고객이 고를 길 없음 |
| 5 「승인 버튼 2개」 | §5-3 링크 · 로그인 화면 두 단추 | 한 단추 + 숨은 길 |

빠진 축 0.

## §2 흐름 표 (접수 → 첫 검사 → 승인 → 당일 재검사 → 적재 · 고르는 자리가 걸린 이음매 · 소스 grep 1127)

뽑은 패턴 = `grep -n "setStatus(.*'\(awaiting_approval\|reapproval\|test_failed\)'\|spamOverrideMarker\|spamOverrideOf\|buildPassedNotify\|buildReapprovalNotify\|buildTestFailedNotify\|buildSpamResultMail\|overrideSpamBlockTx" packages/backend/src -r`

| # | 갈래 · 이음매 | 쓰는 쪽 | 읽는 쪽 · 그리는 곳 | 값 범위 | 판정 |
|---|---|---|---|---|---|
| G1 | 첫 검사 · 처음 글 통과 | `agency-send-worker.ts:1123` saveTestResult(같은 글) · `:1145` setStatus awaiting_approval(표식 지움) | 승인 문자 「스팸 검사를 통과했습니다」 · 링크 승인 | finalContent = original_content | 정상 |
| G2 | 첫 검사 · 처음 글 막힘 → 다듬은 글 · 찾은 글 통과 | `:1123` saveTestResult(current = 고친 글 · 버전 +1) · `:1145` setStatus awaiting_approval(**표식 지움**) | 테스트 문자 = 고친 글 · 승인 문자 첫 줄 「스팸 검사를 통과했습니다」(`agency-send-notify.ts:59-63`) · 바꾼 곳 줄 = 찾은 글만(`:1203` viaFix) · 링크 화면 = 고친 글 승인 하나(`AgencyApprovePage.tsx:340-345`) · 로그인 상세 = 「처음 접수한 문안」 보임 · 고를 단추 0(`AgencySendDetail.tsx:461-471`) | finalContent ≠ original_content | **결함**(접수 1 · 5) |
| G3 | 첫 검사 · 끝내 막힘 | `:1112-1116` 표식(submitted = original_content) · test_failed | 막힘 문자 = 로그인 주소만(`notify.ts:218-234`) · 로그인 상세 「그대로 보내기」(C161 · 두 단계 = 승인 대기 → 승인) · 링크 = 없음 | — | **결함**(접수 4 · 5) |
| G4 | 막힘 + 보낼 시각 2시간 안 | `agency-send-actions.ts:129` 「시각 먼저 바꿔」 | 시각 바꿈(`agency-send-change.ts:288` test_failed → received) → G1 · G2 · G3 다시 | — | G2 로 가면 고를 길 사라짐 = **결함**(접수 2) |
| G5 | 시각 바꿈(승인 대기에서) | `agency-send-change.ts:288-` awaiting_approval 유지 · 결과 칸 무변경 | `routes/agency-send.ts:826` sendAgencyApprovalRequest(`worker:2660-`) | 표식이 있으면 그대로 남음 | §5 에서 승인 문자도 같은 판정으로 |
| G6 | 당일 재검사 · 승인한 글 막힘 → 다듬은 글 통과 | `worker:1335-1343` setStatus reapproval(표식 지움) | 재승인 문자 「수정한 문안이 스팸 검사를 통과했습니다」 · 링크 = 고친 글 승인 하나 | finalContent ≠ 승인한 글 | **결함**(같은 뿌리) |
| G7 | 당일 재검사 · 끝내 막힘 | `worker:1390-1393` 표식(submitted = 승인한 글) · test_failed | 「예약취소」 문자(`notify.ts:139-145` 「로그인 하시어 승인」) + 막힘 문자(로그인 주소만) | — | **결함**(G3 과 같음 · 「로그인 하시어 승인」 = 링크 승인과 다른 말) |
| G8 | 적재 직전 승인 버전 대조 실패 | `worker:1690` setStatus reapproval(표식 지움) | 재승인 문자 | 글 무변경 | 표식이 이 버전 것이면 지우지 않는다(§5-1) |
| G9 | 그대로 보내기 실행 | `agency-send-change.ts:361-441` overrideSpamBlockTx(status = test_failed 만 · 발신 인증 · 로그인 사용자만) | `routes/agency-send.ts:790-810` → 테스트 문자 + 승인 요청 | — | §5-3 에서 세 상태 · 링크 주체 · 승인까지 한 단추 |
| G10 | 고르는 판정 | `agency-send-actions.ts:118-131` spamOverrideOf(test_failed 만) · `:80-81` 링크 = no | 로그인 상세 응답 `routes/agency-send.ts:169` · 링크 actions `routes/agency-approve.ts:87` | — | §5-2 |
| G11 | 결과 메일(이메일 접수) | `agency-spam-diag.ts:302-346` buildSpamResultMail | `agency-send-mail-worker.ts:1619` | 「보내 주신 글」 = current_content(워커가 고친 글을 저장 `worker:983`) | **결함**(접수 3) |
| G12 | 진행 기록 | `AgencyEventLog.tsx:97` spam_override 문구 | 상세 | — | 정상(문구 그대로) |

값 범위(고르는 판정의 입력): 상태(test_failed · awaiting_approval · reapproval · 그 밖) × 표식(없음 · 옛 버전 · 이 버전) × 표식 글 = 지금 글 여부 × 보낼 시각(15분 잠금 · 2시간 안 · 당일 · 다른 날) × 예약 시작(campaign_id) × 주체(로그인 · 링크 · 운영).

그리는 화면 = 링크 화면(`AgencyApprovePage.tsx`) · 로그인 상세(`AgencySendDetail.tsx`) · 승인 문자 · 재승인 문자 · 막힘 문자 · 예약취소 문자 · 결과 메일 · 진행 기록.

## §3 뿌리 (ROOT-LEDGER R113)

**R113 사람이 낸 글을 시스템이 바꿔 승인을 받을 때, 「바꾸기 전 글로 보내기」를 고를 자리가 바꾼 갈래마다 따로 있지 않고 한 갈래(끝내 막힘 · 로그인)에만 있다 · 알리는 글이 두 글을 같은 이름(「보내 주신 글」 · 「통과했습니다」)으로 부른다.**
- 전 기능 grep = 대행발송에서 사람이 낸 글을 바꾸는 자리 = 워커 다듬기 · 찾은 글(첫 검사 · 당일 재검사) 두 곳 · 고르는 판정 = spamOverrideOf 한 곳. 다른 기능(자동 마케팅 · AI 한줄로)은 사람이 화면에서 직접 받기를 누르는 구조라 해당 없음(C164 직접발송 = 「이 글로 바꾸고 다시 검사」 클릭).

## §4 결정 (Harold 1127 「추천대로」)

- D1 두 단추 = 「스팸 통과 문안으로 승인」(지금 승인) · 「처음 접수한 문안 그대로 승인」(그대로 보내기 + 승인 · 한 단추). 재승인 · 당일 막힘에서 바꾸기 전 글이 승인했던 글이면 이름 = 「승인하셨던 문안」(표식 글 ≠ original_content).
- D2 처음 문안 그대로 승인을 **로그인 없는 승인 링크에서도** 연다(승인 링크가 이미 담당자 휴대폰 1클릭으로 발송을 확정하는 자리 · 메일 접수 고객).
- D3 한 단추 = 테스트 문자를 다시 보내지 않는다(고객이 낸 글 · 단추가 곧 승인 · 확인 창에 글 전문과 「걸린 통신사를 쓰시는 분께는 닿지 않을 수 있어요」). 글 교체와 승인은 **한 트랜잭션**(Codex 설계 1R #2) · C161 두 단계(그대로 보내기 → 테스트 문자 → 승인 요청 → 승인)는 없앤다(빈 자리 확인 없음 = 409 · 발신 인증 = 403 · 둘 다 상태 변경 0 → 화면이 확인 · 인증 뒤 같은 단추를 다시 보낸다).

## §5 처방

### 5-1 표식(워커 · `agency-send-worker.ts`)

- `runSpamRound` = 통과에도 `firstTest`(첫 회차 글 · 검사 행 시각)를 돌려준다(지금은 막힘만).
- 순수 CT `rewriteChoiceMarker(version, submitted, finalContent, firstTest)`(`agency-spam-diag.ts` · spamOverrideMarker 옆) = finalContent ≠ submitted 이면 spamOverrideMarker(version, submitted, firstTest) · 같으면 null.
- G2: setStatus(awaiting_approval, …, { spamOverridable: rewriteChoiceMarker(savedVersion, original_content, finalContent, firstTest) }).
- G6: setStatus(reapproval, …, { spamOverridable: rewriteChoiceMarker(version, 승인한 글 = target.current_content, finalContent, firstTest) }).
- G8: setStatus(reapproval, …, { spamOverridable: 지금 버전 표식 그대로(spamOverrideMarkerOf(row) 의 version = content_version 일 때) · 아니면 null }).
- setStatus 계약: 승인 대기 · 재승인으로 바꾸는 모든 부름은 `spamOverridable` 키를 반드시 넘긴다(값 = 표식 또는 null · null = 지움 = 지금 기본 동작) → 계약 시험이 소스에서 센다.

### 5-2 고르는 판정(`agency-send-actions.ts` spamOverrideOf · 한 곳)

- 허용 상태 = test_failed(지금 그대로 · 표식 version = content_version · 표식 글과 지금 글이 같아도 = 다듬은 글을 버리고 처음 글이 막힌 경우) + **awaiting_approval · reapproval 은 표식 version = content_version 이고 표식 글 ≠ current_content 일 때만**(글 불일치 조건은 이 둘에만 · Codex 설계 2R #2).
- 나머지 조건 그대로(campaign_id 없음 · 15분 잠금 · 그대로 보낸 뒤 승인 판정 통과 · 시각이 가까우면 retime).
- 승인 판정의 「승인 요청 시각」(Codex 설계 1R #1): test_failed = 지금(지금처럼 · 이 단추가 곧 승인 요청이자 승인) · **awaiting_approval · reapproval = 행의 approval_requested_at 그대로**(24시간 마감을 다시 시작하지 않는다 = 일반 승인과 같은 마감 · 지나면 닫힘 · 만료 뒤에는 지금처럼 시각 변경 · 다시 진행으로만 새 승인 요청).
- 반환에 표시 재료 `shown = { label, submitted, blanks } | null` 추가 — 표식이 이 버전 것이고 허용 상태(test_failed · awaiting_approval · reapproval · 위 글 조건)이면 **고를 수 있는지(ok)와 따로 늘** 준다(Codex 설계 1R #3 앞 절반 · 3R #1). label = 표식 글이 original_content 면 「처음 접수한 문안」 · 아니면 「승인하셨던 문안」 · submitted = 표식 글 · blanks = 표식 글의 채우지 않은 자리 이름(findAgencyBlanks). ok · reason · retime · text(= ok 일 때 표식 글 · 옛 응답 꼴 그대로)는 지금 그대로.
- 왜 화면 표시 지적이 1R #4 · 2R #2 · 3R #1 세 번 나왔나 = 표시 재료를 서버가 「고를 수 있을 때만」 내려주고 화면이 나머지(이름 · 글 · 두 칸 여부)를 짐작했다 → 구조 = 표시 재료의 주인은 spamOverrideOf 하나(shown) · 화면 함수 agencyChoiceView 는 (상태, shown, ok, 지금 글)만 받아 그린다(짐작 0).
- agencyActions: spamOverride 주체 = 로그인 · 링크(운영 = 「운영 화면에서는 고르지 않아요.」).

### 5-3 한 단추 = 글 교체 + 승인 **한 트랜잭션**(`agency-send-change.ts` overrideSpamBlockTx 를 바꿔 씀 · 로그인 · 링크 공용 · Codex 설계 1R #2)

- 잠금 앞(외부 호출 · 지금 순서 그대로): 사전 읽기 → 수정 번호 대조 → spamOverrideOf → 예약 시작 확인 → SMS 길이(표식 글) → **빈 자리(표식 글 · 확인 값 없으면 409 BLANK_ACK_REQUIRED · 상태 변경 0)** → 로그인이면 발신 인증(403 · 상태 변경 0) · 링크면 「번호가 지금도 담당자 · 토큰 버전 = 지금 버전」.
- 한 트랜잭션: 행 잠금 → 수정 번호 · (링크) 번호 · 토큰 버전 다시 → spamOverrideOf(잠근 행) 다시 → 시도 키 → UPDATE `current_content = 표식 글 · content_version + 1 · status = 'approved' · approved_at = NOW() · approved_by = 로그인 사용자 | NULL · approval_version = content_version + 1 · final_test_at = 판정값 · 표식 · 맞춤법 지움 · approval_requested_at = test_failed 면 NOW() 아니면 그대로` 조건 = `status IN ('test_failed','awaiting_approval','reapproval')` · revision · 예약 없음 · 시도 키 · 15분 잠금 → 사건 spam_override(새 버전 · fromVersion · via · 사용자 | 번호 · sameDay) + approved(via · 사용자 | 번호 · ip · ua) 같은 트랜잭션 → COMMIT → triggerAgencySendDispatch.
- 실패는 전부 상태 변경 0(되돌이 길 0 · 테스트 문자 · 승인 요청 재발송 0). C161 두 단계(승인 대기로 돌림 → 테스트 문자 → 승인 요청)는 없앤다.
- 로그인 `POST /api/agency-send/:id/spam-override`(몸통 revision · blankAck · **approve: true 필수** · 없으면 = 배포 때 열려 있던 옛 화면의 두 단계 요청 → 409 `REFRESH_REQUIRED` 「화면을 새로 고친 뒤 다시 골라 주세요」 · 상태 변경 0 · Codex 설계 2R #1) · 링크 새 `POST /api/agency-approve/spam-override`(새 주소라 옛 요청 없음 · 같은 approve: true 필수)(가드 = agencyActions('link').spamOverride · 뒤처리 = 링크 승인과 같은 담당자 전원 통보 · 감사 원장 `agency_link_spam_override` · 이력은 트랜잭션 안 사건).

### 5-4 알리는 글(`agency-send-notify.ts` · 순수)

- 컨텍스트 새 칸 `rewrite = { label, choosable, retime }`(spamOverrideOf 의 label · ok · retime · 표식이 이 버전 것이면 고를 수 있는지와 따로 싣는다 · Codex 설계 1R #3).
- 승인 문자(buildPassedNotify · 두 꼴 모두): 첫 줄 = 「[대행발송] {처음 접수한 문안}이 스팸 검사에 걸려, 한줄로가 고친 문안으로 통과했습니다.」 · 고를 수 있으면 승인 줄 = 「방금 보내 드린 문자는 고친 문안입니다. 아래 주소에서 고친 문안으로 승인하거나 {처음 접수한 문안} 그대로 승인할 수 있습니다.」(주소 없으면 「로그인하여 …」) · 시각 때문에 못 고르면 「{처음 접수한 문안} 그대로 보내려면 시각을 먼저 바꿔 주세요.」 · 워커 G2 · sendAgencyApprovalRequest(G5) 둘 다 같은 판정으로 값을 넘긴다.
- 재승인 문자(buildReapprovalNotify): 첫 줄 「[대행발송] {승인하셨던 문안}이 발송 전 스팸 검사에 걸려, 한줄로가 고친 문안으로 통과했습니다.」 · 승인 줄 같은 꼴.
- 막힘 문자(buildTestFailedNotify): 링크를 싣는다(G3 · G7 · 담당자별 · 그 버전으로 서명). 고를 수 있으면 「검사 결과와 관계없이 {처음 접수한 문안} 그대로 보내려면 아래 주소에서 승인할 수 있어요.」 · 시각이 가까우면 「보낼 시각이 가까워 그대로 보내려면 아래 주소에서 시각을 먼저 바꿔 주세요.」 · 끝 줄 「문안을 고치려면 로그인해 주세요: hanjul.ai/agency-send」.
- 예약취소 문자(buildFinalBlockedNotify): 「곧, 다시 문안 안내 드릴테니 로그인 하시어 승인 바랍니다.」 → 「곧 다시 안내해 드립니다. 받으신 문자의 주소에서 고를 수 있어요.」(링크와 같은 말).

### 5-5 결과 메일(`agency-spam-diag.ts` buildSpamResultMail)

- 「보내 주신 문안」 = original_content(▶ 표시는 검사 근거 글이 같을 때만).
- current_content ≠ original_content 이면 「한줄로가 고쳐 본 문안(이 문안도 걸렸습니다)」 = current_content(▶ 표시는 근거가 이 글일 때).
- 끝 문장: 「통신사는 막은 이유를 알려 주지 않습니다. 「확인한 내용」은 한줄로가 다시 보내 본 결과로 좁힌 것입니다.」 · 「담당자 휴대폰으로 보낸 문자의 주소에서 로그인 없이 보내 주신 문안 그대로 승인할 수 있습니다.」(고를 수 있을 때) · 「로그인하여 고치기: …」 그대로.

### 5-6 화면

- 응답 = 로그인 상세 `spamOverride` = `{ ok, reason, text, retime, shown }`(text = 지금 계약 그대로 = ok 일 때 표식 글 · 아니면 null · 배포 중 옛 화면이 그 값으로 단추를 그린다 · Codex 설계 4R #2) · 링크 `choice` = `{ ok, reason, retime, shown }`(shown 은 ok 와 따로).
- 글 칸 이름 · 단추를 정하는 순수 함수 하나 = 프론트 `components/agency/agency-send-api.ts` `agencyChoiceView(status, spamOverride, currentContent)`(링크 · 로그인 두 화면이 같이 쓴다 · Codex 설계 1R #4 · 3R #1 · shown 이 없으면 지금 화면 그대로 · 두 글 비교 = shown.submitted vs 지금 글). **spamOverride.ok 는 「{label} 그대로 승인」 단추에만** 쓴다 · 「스팸 통과 문안으로 승인」 주 단추는 지금 일반 승인 조건 그대로(링크 = approvable · 로그인 = isApprovable · 15분 잠금 · 둘이 따로 열리고 닫힌다 · Codex 설계 4R #1):
  - awaiting_approval · reapproval + label = 지금 글 칸 이름 「스팸 통과 문안」 · 표식 글 칸 「{label}(스팸 검사에 걸렸어요)」 · 단추 = 주 「스팸 통과 문안으로 승인」 + 보조 「{label} 그대로 승인」(ok 일 때) 또는 사유(retime).
  - test_failed + label = 표식 글 칸 「{label}(스팸 검사에 걸렸어요)」 하나 · **지금 글이 표식 글과 다를 때만** 「한줄로가 고쳐 본 문안(이 문안도 걸렸어요)」 칸을 더한다(같으면 = 다듬은 글을 버리고 처음 글이 막힌 경우 · Codex 설계 2R #2) · 단추 = 「{label} 그대로 승인」(ok) 또는 사유 · 「스팸 통과」 낱말 0.
  - 그 밖 = 지금 화면 그대로.
- 링크(`AgencyApprovePage.tsx`): 위 함수대로 두 글 칸 · 단추(+ 시각 바꾸기 · 취소 지금 그대로). 확인 창 = 글 전문 · 닿지 않을 수 있음 · 빈 자리(표식 글 기준 · 있으면 단추 = 확인) · 한 단추 = 승인 · 끝나면 승인 완료 카드.
- 로그인 상세(`AgencySendDetail.tsx`): 위 함수대로 · 「처음 접수한 문안」 칸 아래 보조 단추 · 바닥 주 단추 이름 「스팸 통과 문안으로 승인」 · test_failed 단추 「검사 결과와 관계없이 이 글 그대로 보내기」 → 「{label} 그대로 승인」(한 단추 · 확인 창 문장 바꿈).
- 링크 머리 「받으신 테스트 문자 그대로 나갑니다」는 지금 그대로(고친 문안 승인 기준) · 처음 문안 승인 확인 창에 「처음 접수한 문안은 테스트 문자를 따로 보내지 않았어요」 한 줄.

## §6 영향표

| 바뀌는 것 | 소비처(grep) | 영향 |
|---|---|---|
| setStatus 승인 대기 · 재승인 부름 셋(`worker:1145` · `:1336` · `:1690`) | 결과 칸 표식 | 고친 글 통과 때만 표식이 남음 · 그 밖 지금처럼 지움 |
| runSpamRound 반환 firstTest(통과) | 부르는 곳 둘(첫 · 당일) | 추가만 |
| spamOverrideOf 허용 상태 | 로그인 상세 응답 · agencyActions(로그인 · 링크) · overrideSpamBlockTx 사전 · 잠금 판정 | 승인 대기 · 재승인 + 표식일 때만 새로 열림 |
| overrideSpamBlockTx 상태 조건 · 주체 | 로그인 라우트 · 새 링크 라우트 · approveSubmittedAgencyTx | 로그인 발신 인증 그대로 · 링크 = 토큰 확인 |
| 로그인 그대로 보내기 = 한 단추 승인(한 트랜잭션) | `routes/agency-send.ts:790` · 화면 doSpamOverride · 시험 agency-spam-override-1124(두 단계 기대 = 한 단추로 바꿈) | C161 두 단계 없앰 · 실패 = 상태 변경 0 |
| 알리는 글 넷 · 결과 메일 | 워커 · sendAgencyApprovalRequest · 메일 워커 | 문장 |
| 링크 화면 · 로그인 상세 | — | 고를 단추 |
| 당일 재검사의 그대로 보내기 버전 판정 | `isSpamOverriddenVersion` · acceptOverriddenFinalBlock | 무변경(한 단추 승인도 사건 spam_override 를 그 버전으로 남김) |

미가입 · 직접발송만 쓰는 회사 = 대행발송을 쓰지 않으면 닿지 않음 → 변화 0. 대행발송 통과 · 처음 글 통과(G1) = 문장 · 화면 무변경.

## §7 계약 시험 · 변이

- R113 뿌리 시험(`root-ledger.test.ts`):
  - 소스: `agency-send-worker.ts` 의 `setStatus(…, 'awaiting_approval' | 'reapproval', …)` 부름마다 옵션에 `spamOverridable` 키(기계 추출 · 부름 수 ≥ 3).
  - 순수: spamOverrideOf = test_failed(표식 이 버전 · 글 같아도) · awaiting_approval · reapproval(표식 이 버전 · 글 다름) 열림 / 표식 옛 버전 · 승인 대기 · 재승인에서 표식 글 = 지금 글 · approved · 운영 = 닫힘 · 15분 잠금 = ok 닫힘이어도 shown 있음 · agencyActions('link').spamOverride 열림.
  - 순수: rewriteChoiceMarker = 다르면 표식 · 같으면 null.
  - 문장: buildPassedNotify · buildReapprovalNotify(choiceLabel 있음) = 「고친 문안」 · 「그대로 승인」 · 「스팸 검사를 통과했습니다」 단독 문장 없음 · buildTestFailedNotify(approveUrl) = 주소 · 「로그인」은 고치기 줄에만.
  - 메일: buildSpamResultMail(original ≠ current) = 「보내 주신 문안」 아래 original · 「한줄로가 고쳐 본 문안」 아래 current.
- 실 PG(`agency-spam-choice-1127.pg.test.ts`): 승인 대기 + 표식 행 → overrideSpamBlockTx(로그인 · 링크) = 한 트랜잭션으로 글 = 표식 글 · 버전 +1 · approved · approval_version = 새 버전 · approval_requested_at 그대로 · 사건 spam_override + approved · 링크 토큰 옛 버전 · 담당자에서 빠진 번호 = 거절(상태 변경 0) · 빈 자리 확인 없음 = 409(상태 변경 0) · 24시간 지난 승인 대기 = 거절 · test_failed 행 = 승인 + approval_requested_at 갱신 · 표식 글 = 지금 글인 test_failed = 승인 · approve 값 없는 로그인 요청(옛 화면) = 409 REFRESH_REQUIRED 상태 변경 0.
- 변이(사본) = G2 표식 빼기 · spamOverrideOf 를 test_failed 만으로 · 링크 주체 막기 · 메일 「보내 주신 문안」을 current 로 → 빨간불.

## §8 직원 지시문 (C167-S1-C · 테스트계정 · 직원 휴대폰 · 구현 전 확정)

| 순 | 하세요 | 보이면 맞음 |
|---|---|---|
| 1 | 테스트계정으로 대행발송 화면 접수를 연다 · 스팸 검사에 걸리는 시험 문구(지난 C161 지시문의 문구)를 넣고 받는 사람은 본인 휴대폰 1명 · 보낼 시각은 내일 오전으로 접수한다 | 「접수했습니다」 |
| 2 | 검사가 끝날 때까지 기다린다(최대 10분) | 휴대폰에 테스트 문자 + 승인 문자. 승인 문자 첫 줄이 「처음 접수한 문안이 스팸 검사에 걸려, 한줄로가 고친 문안으로 통과했습니다」 |
| 3 | 승인 문자의 주소를 연다(로그인하지 않는다) | 「스팸 통과 문안」 · 「처음 접수한 문안」 두 글과 단추 둘 「스팸 통과 문안으로 승인」 「처음 접수한 문안 그대로 승인」 |
| 4 | 「처음 접수한 문안 그대로 승인」 → 확인 창의 단추 | 화면이 「승인되었습니다」 · 휴대폰에 승인 완료 문자 |
| 5 | 한줄로에 로그인해 그 건의 대행발송 상세를 연다 | 상태 「승인 완료」 · 「승인할 문안」이 1번에 넣은 처음 문안 · 진행 기록에 「그대로 보내기로 했습니다」 |
| 6 | 같은 방식으로 하나 더 접수하고, 2번 승인 문자 주소에서 「스팸 통과 문안으로 승인」 | 상태 「승인 완료」 · 승인할 문안 = 테스트 문자로 받은 글 |
| 7 | 같은 방식으로 하나 더 접수하고, 로그인 상세에서 「처음 접수한 문안 그대로 승인」 | 4 · 5 와 같은 결과 |
| 8 | 끝나면 세 건을 모두 취소한다 | 목록에서 「취소」 |

(끝내 막힘 갈래 · 메일 접수 결과 메일 문장은 계약 시험으로 닫고, 실측은 다음 실제 막힘 접수 때 진행 기록 · 메일로 대조 · 미검증으로 남김)

## §9 배포

백엔드(워커 · actions · change · notify · spam-diag · 라우트 둘) + 프론트(링크 화면 · 상세). DDL 0 · ENV 0. 재시작 = 적재 0 일 때. 원장 = C167-H1.

## §10 범위 밖 (기록만)

- 통과 회신 메일(이메일 접수에 통과 · 승인 요청 메일 없음 · C164 §17 그대로).
- 표식의 당일 근거(submittedTested)는 그 주기 첫 회차 글로만 잡는다(C161 규칙 그대로) — 보류 후보 · 찾은 글부터 이어 본 주기에서는 바꾸기 전 글의 당일 막힘이 근거로 안 실려, 보낼 시각 2시간 안이면 「시각을 먼저 바꿔 주세요」가 된다(잘못 나가는 글 0 · 링크 · 화면에 시각 바꾸기 있음 · 근거를 보류 · 진단 상태로 나르는 것은 별도 과제 · Codex 설계 1R #3 뒤 절반 불수용).
- 링크 화면 머리 문장 「받으신 테스트 문자 그대로 나갑니다」를 갈래별로.

## §11 Codex 리뷰 기록

### 설계 (gpt-6.2-sol · high · 하위 0)

| R | 지적 | 판정 |
|---|---|---|
| 1 | 24시간 마감 다시 시작 · 두 트랜잭션 사이 실패 · 이어 본 주기의 당일 근거 · test_failed 화면이 막힌 글을 「통과 문안」으로 | 수용 3 · #3 은 문자 설명만 수용(근거 운반 = §10 · C161 같은 규칙) |
| 2 | 옛 화면 요청이 최종 승인으로 · 글이 같은 test_failed 에서 고를 길이 사라짐 | 수용 2(approve: true 필수 · 글 불일치 조건은 승인 대기 · 재승인에만) |
| 3 | 고를 수 없을 때 화면이 표식 글을 받지 못함 | 수용 · 1R #4 · 2R #2 · 3R #1 = 같은 부류(표시 재료를 「고를 수 있을 때만」 줌) → 구조 = shown 을 ok 와 따로 늘 줌 · 화면 함수는 그 값만 그림 · Harold 「닫힐 때까지」 지시로 계속(보고에 적음) |
| 4 | 처음 문안 승인 불가가 주 단추까지 막음 · 상세 응답 text 칸 누락 | 수용 2(설계서 문장) |
| 5 | — | approve |

### 구현에서 정한 것

- 그대로 승인한 건 = 곧 승인 완료라 시각 변경은 일반 승인과 같이 막힌다(옛 C161 두 단계에서는 승인 대기라 바꿀 수 있었다) · 시각을 바꾸려면 고르기 전(승인 대기 · test_failed)에 바꾼다. 실 PG 시험 = 고친 글 승인 대기에서 다른 날로 옮기면 표식이 남고 그 뒤 그대로 승인 = 당일 검사 끝 없음.

### 구현 (gpt-6.2-sol · high · 하위 0)

| R | 지적 | 판정 |
|---|---|---|
| 1 | 링크 그대로 승인 뒤 버전이 올라 옛 주소가 닫혀 취소 길이 사라짐 · 15분 잠금 중 시각 안내 · 확인 창에 글 전문 없음 · 로그인 상세가 승인하셨던 문안 대신 처음 글 | 수용 4(승인 완료 문자에 새 버전 주소 · retime = 링크 시각 변경이 열릴 때만 · 확인 창 전문 · 상세 = shown 글) |
| 2 | 로그인 상세에서 견줄 글 = 지금 글이면 같은 글 두 번 · 「다듬었습니다」 | 수용(두 글이 다를 때만 칸 · 안내) |
| 3 | — | approve |

- 변이(사본 · 원복 바이트 대조) C1 ~ C7 일곱 모두 빨간불(1127).
