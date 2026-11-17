# C142 그룹웨어 오류접수 4건 설계서 (등급 순서 · 매일 주기 · 대행 SMS 바이트 · 대행 조회)

> 2026-11-17 · 접수 = 임은지 2건(cmwkb327l1u14jnsc1naj9ehj 등급 · cmwkdnnjn1uxsjnscn0ok1ueg 매일) · 남지현 2건(cmwkd78zy1uwhjnsc05am7me2 SMS 바이트 P0 · cmwkemwkc1v03jnsc9diad67m 조회)
> Harold 지시 = 「디버깅 4개 한번에 끝까지 · 뿌리까지 뽑을 방법」 → 「완벽한 설계안 · 설계 Codex 닫힐 때까지 · 구현 · 구현 Codex 닫힐 때까지 · 보고」 · 매일 주기 = Harold 1117 「추천하는 방식(Q9 를 풀되 명시 선택 + 경고)으로 문제없도록 완벽하게」
> 순서 소유 = `status/DEFECT-PLAYBOOK.md` · 뿌리 = `docs/ROOT-LEDGER.md`

## §0 판정 표(접수 시각의 서버 판 = e3ecc4b9 · 대상 파일의 e3ecc4b9..HEAD 변경 0 · 미커밋 0)

| 접수 | 판정 | 근거(코드 · 실측) | 서버 지금 | 배포 뒤 |
|---|---|---|---|---|
| A 등급 순서 「어디서 정하나」 | **결함** | 잠금 사유 「등급 순서를 확인하면 열립니다」의 할 일을 하는 자리가 화면에 0. 등급 순서 창(GradeOrderModal)을 여는 `setGradeOrderOpen(true)` = `pages/CustomersTab.tsx:214` 하나뿐인데 그 파일은 어디서도 import 되지 않음(app.hanjul.ai 관리 화면 0718 폐기 뒤 남은 죽은 파일) · 여정 쪽 여는 자리(추천 창 잠금 단추)는 1024 커밋 416a71ea8 이 지움(`git log -S`) · `JourneysPage.tsx:544` 상태와 2831 창은 남았지만 여는 줄 0 · `journey-selfcheck-set.ts:120` 이 「등록할 화면이 없어」라고 이미 적어 둠 | 상위 등급 · 등급이 오른 고객 · 여정 등급 상승 = 정한 적 없는 회사는 영영 잠김 | 잠금이 그려지는 자리마다 [등급 순서 정하기] · 대상 고르기 카드에 [등급 순서 바꾸기] |
| B 매일 주기 「아예 불가」 | **개선 요청(Q9 해제 · Harold 1117 결정) + 결함 1 + 실측 차이 1** | Q9(1005 신뢰 설계 · 매일 · 매주 + 상태 조건 = 막음) = `automarketing-segment.ts:453` `checkSchedulePairing` · 막는 자리 다섯(아래 B 흐름 표) · 결함 = 막힘 안내 · 제안이 잠긴 「등급이 오른 고객」을 가리킴(`automarketing-interview.ts:110` · `audience-translate.ts:262` 제안이 그 축의 잠금 여부를 안 봄) · 실측 차이 = 변화 축(발길이 끊긴 · 생일 · 처음 구매 등)으로는 지금도 매일이 됨(짝 판정 통과 · 단 한 줄 질문 창 ③ 은 그 축을 고르는 보기를 안 줌) | 전체 · 상태 조건 + 매일 = 등록 0 | 경고를 보고 「지금 대상에게 매일 보내기」를 직접 누르면 등록 · 그 선택을 승인 기록에 남겨 매주 승인 · 수정에서도 같은 판정 |
| C 대행 SMS 91바이트 실패 | **결함 P0** | SMS 90바이트 판정이 접수 입구(`agency-send-intake.ts:478` · 메일 분석 975)에만 있다. 접수 뒤 글을 바꾸는 길(문안 고치기 `editAgencyContentTx` · 맞춤법 여러 곳 함께 적용 · 스팸 다듬기 `runSpamRound` refine) · 재검사(첫 · 최종) · 승인 · 발송 직전(`dispatchAttempt`)이 다시 재지 않는다 → 91바이트 SMS 가 검사 통과 · 승인 · 예약 → 통신사 바이트 초과로 전량 실패. 맞춤법 [고치기] 하나는 막혀 있었지만(`sms-spell-check.ts:81`) 같은 판정이 손 고치기에 없었다 | 고친 글 · 다듬은 글이 90바이트를 넘어도 예약됨 | 넘는 글은 저장 · 검사 · 발송 전에 막고 위치 · 바이트를 알림 · 고치기 칸 아래 바이트 표시 |
| D 대행 조회 검색 | **개선 요청 + 결함 1** | 요청 = 메일 접수 반려 · 오류 목록에 날짜 · 회사 검색 · 대행발송 내역에 접수일 · 발송일 검색. 결함 = 대행발송 내역 검색이 서버가 준 최근 200건(`admin.ts:6673 LIMIT 200`) 안에서만 화면이 걸러(`AgencySendLedgerPanel.tsx:181`) 그보다 오래된 접수는 검색해도 안 나오고 잘렸다는 안내도 없다(뿌리 R73) | 최근 200건 밖 = 검색 0 | 서버가 조건으로 찾고 200건을 넘으면 「기간을 좁혀 주세요」 |

## §1 흐름 표(소스에서 뽑음 · 뽑은 명령 = 각 표 아래)

### A 등급 순서 — 잠금이 생기는 자리 · 그리는 화면 · 푸는 자리

| 단계 | 쓰는 쪽(생산) | 읽는 쪽(그림) | 지금 | 판정 |
|---|---|---|---|---|
| A1 등급 값 있음 · 순서 없음 판정 | `automarketing-segment.ts:281 · 347`(vip · grade_up resolve) · `journey-trigger-capability.ts:138-140`(no('grade')) | 아래 A2 ~ A9 | 사유 두 벌(자동마케팅 「확인하면 열립니다」 · 여정 「한 번 정해 주시면」) | 결함(R1 두 벌 · R56 할 일 자리 0) |
| A2 자동마케팅 세부설정 대상 카드 | GET `/operator/segments`(`ai.ts:1281`) | `SegmentPicker.tsx:190-204` 잠금 카드(사유 글만) | 단추 0 | 결함 |
| A3 한 줄 · 빠른 시작(VIP 데이) → 승인 창 「이대로는 시작할 수 없어요」 | `audience-translate.ts:256` asAxis blocked DATA_MISSING | `OperatorPreviewModal.tsx:383-397` 막힘 창(080 · 발신번호만 단추) | 단추 0 | 결함(직원 캡처 1) |
| A4 한 줄 질문 창 ② 누구에게 | `automarketing-interview.ts:58` axisOption(잠긴 축 = disabled + reason) | `ZoneQuestion.tsx` 보기 사유 | 단추 0 | 결함 |
| A5 짝 막힘의 제안 「등급이 오른 고객으로 바꾸기」 · ③ 「「등급이 오른 고객」에게만」 | `automarketing-segment.ts:453`(CHANGE_COUNTERPART vip→grade_up) · `audience-translate.ts:262` · `automarketing-interview.ts:110` | `OperatorPreviewModal.tsx:389` · 질문 창 | 잠긴 축을 제안 → 누르면 또 잠김 | 결함 |
| A6 여정 빠른 시작 칩(등급 상승) | GET `/operator/journeys-data-capability`(`ai.ts:4191`) | `JourneysPage.tsx:1026` → `InterviewModal.tsx:312`(lockedAction 자리 있음 · 채우는 쪽 0) | 단추 0 | 결함 |
| A7 여정 흐름 계획 잠긴 칸 | `journey-opportunities.ts:550` status locked + reason | `JourneyDiagnosisPanel.tsx:203` | 단추 0 | 결함 |
| A8 켜진 여정 「시작 사건이 안 들어옴」 | `journey-lifecycle-map.ts:715` capOf | `GapFinderModal.tsx:190` | 단추 0 | 결함 |
| A9 여정 만들기 거절 · 한 줄 물어보기 · 데이터 범위 안내 | `journey-builder.ts:871`(오류 글) · `one-line-ask.ts:204` · `JourneysPage.tsx:1021` lockedHints | 오류 알림 · `JourneyDataScopeNote` 글 | 글만 | 정상(같은 창 A6 칩에 단추가 생김 · 글은 단추 이름을 말함) |
| A10 푸는 자리 | — | `GradeOrderModal`(GET · PUT `/operator/grade-ranks` · journeyGate = AI 존 요금제) | 여는 자리 0(죽은 파일 하나) | 결함 |

뽑은 명령: `grep -rn "등급 순서" packages --glob '!**/__tests__/**'` · `grep -rn "GradeOrderModal\|setGradeOrderOpen(true)"` · `grep -n "toAvailabilityMap(" routes utils` · `grep -rn "lockedReason\|capability?.reason\|status === 'locked'" frontend/src`.

### B 매일 주기 — 짝 판정이 막는 자리(전부)

| 단계 | 판정 자리 | 지금 | 배포 뒤 |
|---|---|---|---|
| B1 한 줄 질문 ③(번역이 처음부터 짝 막힘) | `automarketing-interview.ts:105-121` | 「지금 대상에게 매일 보내기」 잠김 · 매월 · 제안(잠긴 축 포함) | 「지금 대상에게 매일 보내기」 열림(경고 글) → 답 = 직접 고른 것(ack) · 제안은 열린 축만 |
| B2 한 줄 질문 ② 대상 보기 | `automarketing-interview.ts:58` axisOption | 짝 막힌 축 = 「· 매월로 보내요」(고르면 주기가 매월로 바뀜) | 축 그대로 + 경고 설명 · 고른 뒤 승인 창에서 매일 · 매월을 직접 고름(B3) |
| B3 승인 창(새 등록 · 다음 승인) 대상 번역 | `audience-translate.ts` → `automarketing-preview.ts:refreshEntry` | 새 등록 창 = 늘 「매월」로 번역(§9-12 · 짝은 ③ 이 봄) · 다음 승인 창 = 지금 주기로 번역해 반복 짝이면 막힘 창뿐(고를 길 0) | **(구현 정정)** 다음 승인 창도 「매월」 번역 + ③(지금 주기 · 승인 기록의 동의를 이어받음)으로 맞춤 = 결정 자리는 질문 ③ 하나 · 막힘 창의 매일 단추는 두지 않음 · 동의한 짝이면 누구에게 칸에 경고 줄 |
| B4 승인 창 주기 바꾸기(매일 · 매주 · 매월) | `updateOperatorPreview` → 질문표 다시 | 매일 고르면 ③ 이 잠긴 「지금 대상에게」를 보임 | ③ 의 「지금 대상에게 매일 보내기」 열림(B1) |
| B5 등록(새 등록 저장) | `continuous-operator.ts:488` createOperator | 짝 막힘 = 400 | ack 가 지금 짝과 같을 때만 통과 · 승인 기록(approval_meta.repeatAck)에 남김 |
| B6 다음 승인 저장 | `continuous-operator.ts:4283` lockAndCheckPairing('always') | 짝 막힘 = 400 | 창의 ack(= 저장된 ack 이어받음 또는 창에서 누름) 일 때만 · 승인 기록에 다시 씀 |
| B7 세부설정 수정 저장(PUT) | `continuous-operator.ts:884` lockAndCheckPairing('changed') | 짝 막힘 = 400 · 화면 = 오류 알림 | 저장된 ack 가 새 짝과 같거나 요청에 repeat_ack 가 있을 때만 · 화면 = 400 AUDIENCE_PAIRING 이면 확인 창(ConfirmModal) 「지금 대상에게 매일 보내기」 → 다시 저장 · 저장 결과에 따라 승인 기록의 ack 를 고침 |
| B8 캘린더 등록(POST `/operator/continuous`) | `ai.ts:1860` translateAudience | yearly 만(화면) → 짝 무관 | 그대로(ack 받지 않음 = 직접 부른 매일 + 전체는 지금처럼 400) |

ack(직접 고른 것) = **짝 지문** `${주기 단위}:${hash16}` · hash = sha256(정규화한 대상) 앞 16자 · 정규화한 대상 = 축이면 `['axis', 키, normalizeSegmentParams(키, 기준 숫자) 키 순 정렬]` · 칸 조건이면 `['conditions', (field · operator · value) 를 정렬한 목록]`(말 term · 출처 source 는 빼고 판정에 쓰는 값만). CT `repeatAckKey(schedule, target)` = 짝 막힘일 때만 값 · 판정 = `checkSchedulePairing(schedule, target, ack)`(ack 가 지금 짝의 지문과 같으면 통과 + 경고 글 · 아니면 막힘 + `ackKey` = 지금 짝의 지문). 주기 단위 · 축 · 기준 숫자 · 칸 조건 중 하나라도 바뀌면 지문이 달라 다시 묻는다(★ Codex 설계 1R #1).

**ack 는 화면이 본 지문 그대로 오간다(★ Codex 설계 1R #2)** — 서버가 막을 때 내준 `ackKey` 를 화면이 「지금 대상에게 매일 보내기」로 되돌려 보내고(질문 ③ 보기 값 = `keep:<지문>` · 막힘 창 = `repeat_ack: <지문>` · 세부설정 수정 = 400 의 `ackKey` → 다시 저장의 `repeat_ack: <지문>`), 서버는 저장 직전(수정 · 승인 = 행 잠금 FOR UPDATE 뒤 · 새 등록 = 보관본 판 확인 뒤) 지금 짝으로 지문을 다시 계산해 **같을 때만** 통과한다. 그 사이 다른 창이 주기 · 대상 · 기준을 바꿨으면 지문이 달라 다시 400 + 새 지문 = 사람이 다시 본다. 화면은 지문을 만들지 않는다.
**저장된 ack** = `continuous_operators.approval_meta.repeatAck`(지문 문자열) · 저장 셋이 같은 트랜잭션에서 쓴다(반복 짝 = 그 짝의 지문 · 반복 아님 = 키를 지움). 판정 차례(행 잠금 뒤 · ★ Codex 설계 2R) = ① **요청에 ack 가 있으면** 「바뀜」 판정보다 먼저 최종 짝(요청 값 + 잠근 행으로 채운 값)의 지문과 비교 · 다르면 저장된 ack 와 무관하게 400 + 지금 지문(요청 ack 는 그 요청을 낸 사람이 본 짝에만 쓴다) · 같으면 통과 ② 요청 ack 가 없을 때만 저장된 ack 가 지금 짝 지문과 같으면 통과 ③ 둘 다 아니면 짝 막힘 = 400. 수정 저장의 「바뀜」 판정('changed') = 주기 · 축만이 아니라 **짝 지문의 앞뒤 비교**(기준 숫자 바뀜도 바뀜 · 옛 자유 해석 행 · 이름만 고치는 저장은 그대로 판정 밖 · 단 ①은 바뀜과 무관하게 먼저 본다).

뽑은 명령: `grep -rn "checkSchedulePairing\|OperatorPairingError\|PAIRING\|suggestKey\||monthly" backend/src frontend/src`.

### C 대행 SMS — 글이 확정 · 변경되는 모든 자리와 나가는 문

| 단계 | 자리 | 90바이트 판정 지금 | 배포 뒤 |
|---|---|---|---|
| C1 화면 접수 · 원스텝 · 메일 접수 | `agency-send-intake.ts:478-497` · 975 | 있음(measureAgencyMaxSmsBytes) | 그대로 |
| C2 문안 고치기(화면 · 글 그대로) | `agency-send-change.ts` editAgencyContentTx kind text | **없음** | SMS 면 저장 전 측정 · 넘으면 400 SMS_BYTES_OVER(가장 긴 문장 바이트) |
| C3 맞춤법 적용(화면 · 담당자 링크 · 여러 곳 함께) | 같은 함수 kind spell | 한 곳씩만(`sms-spell-check.ts:81`) · 여러 곳 합은 없음 | C2 와 같은 측정(적용 뒤 글) |
| C4 스팸 다듬기(AI 글) | `agency-send-worker.ts` runSpamRound refine | **없음** | SMS 면 다듬은 글을 재고 넘으면 그 글을 버림(다듬기 실패와 같은 갈래) · 이어 볼 다듬은 글(heldCandidate)도 넘으면 버림 |
| C5 첫 검사 · 최종 검사(2시간 전) | runFirstTest · finalTestRow ② | **없음** | 검사 앞에서 지금 글을 재고 넘으면 검사 실패(test_failed) + 담당자 문자(넘은 바이트 · 줄이거나 LMS 로 새로 접수) |
| C6 승인(화면 · 링크) | approve 라우트 | 없음(글을 바꾸지 않음) | 그대로(C2 ~ C5 가 막아 승인 대기 글은 이미 90 안) |
| C7 발송 직전(당일 검사 통과 건 포함) | `dispatchAttempt`(항목 수 초과와 같은 자리) | **없음** | 재고 넘으면 test_failed + 담당자 문자(배포 전에 저장된 옛 글 · 놓친 길의 마지막 문) |
| C8 고치기 칸 바이트 표시 | `AgencySendDetail.tsx` 고치기 칸 | 없음 | SMS 접수면 칸 아래 「가장 긴 문장 N / 90바이트」(서버 측정 · 새 주소 POST `/api/agency-send/:id/sms-bytes`) · 넘으면 빨간 글 + [저장하고 다시 검사] 잠금 |

측정 = **전수 조립(★ Codex 설계 1R #3)** — 조립(`prepareSendMessage` → `replaceVariables`)은 값에 앞뒤 공백 정리(이름) · Liquid · 남은 변수 지우기를 거쳐 「원래 값 길이 점수」 순서가 실제 문장 길이 순서와 같다는 보장이 없다(옛 상위 5명 조립 = 그 밖의 최장 문장을 놓칠 수 있다). 그래서 표본을 버리고 **명단 전원을 실제 발송과 같은 조립으로 재는 함수 하나**로:
- 핵심 `maxAgencySmsBytesOf(ctx, rows)`(agency-send-preview.ts · 순수 · 조립 = renderOne 과 같은 인자 · msgType 'SMS') = 넘겨받은 줄 전부의 최댓값.
- 입구용 `measureAgencyMaxSmsBytes(input)`(기존 이름 · 접수 코어 · 원스텝 · 메일 분석 · 화면 /sms-bytes) = 메모리의 줄 전부를 위 핵심으로(옛 상위 5명 고르기 삭제 · 판정 한 벌).
- 저장된 접수용 `measureAgencyRequestSmsBytes(row, content)` = 명단을 `row_no` 순 2,000줄씩(색인 `(request_id, row_no)` · keyset `row_no > 마지막`) 읽어 같은 핵심으로 · 앱 메모리 = 한 쪽 분량(0912 「명단 크기 = 프로세스 메모리」 원칙 지킴) · 변수 없는 문안 = 명단을 읽지 않고 한 번 조립.
- 판정 = `agencySmsBytesOver(row, content)` → SMS 이고 최댓값 > 90 이면 그 값 · 아니면 null.
비용(미측정 · 구현 뒤 측정해 보고) = 줄당 정규식 치환 몇 번 · 105,384명 = 53쪽. 고치기 저장 · 검사 회차 · 발송 직전 · 화면 표시(입력이 멈춘 뒤 한 번)에서만 부른다.

뽑은 명령: `grep -rn "current_content\s*=" utils/agency-send-*.ts`(글을 쓰는 UPDATE 전수) · `grep -n "runSpamRound(\|dispatchToPipeline(" utils/agency-send-worker.ts` · `grep -rn "SMS_MAX_BYTES\|eucKrByteLength" backend/src`.

### D 대행 조회

| 단계 | 자리 | 지금 | 배포 뒤 |
|---|---|---|---|
| D1 대행발송 내역 목록 | GET `/api/admin/agency-send`(`admin.ts:6652`) · 상태만 서버 · 최근 200 | 검색어 · 접수구분 = 화면이 200건 안에서 거름 · 잘림 안내 0 | 서버 조건 = 상태 · 접수구분 · 검색어(고객사 · 신청자 이름 · 아이디 · 파일명 · **문안**(옛 화면이 찾던 문안 앞 80자를 포함하는 문안 전체 · ★ Codex 설계 1R #4)) · 날짜 기준(접수일 · 발송일) · 시작일 · 끝일(서울 날짜 · `buildDateRangeFilter`) · 정렬 = 고른 날짜 기준 최근 · 201건 읽어 넘으면 truncated |
| D2 메일 접수 반려 · 오류 | 같은 응답 mailIntake.recentRejected(최근 20) | 거르기 0 | 새 주소 GET `/api/admin/agency-send/mail-rejected`(검색어 = 회사명 · 보낸 주소 · 받은 날짜 범위 · 최대 200 · truncated) · 거르지 않으면 지금 응답(최근 20) 그대로 |
| D3 요약 숫자 · 메일 상태 칸 | 같은 응답 | 그대로 | 그대로(조건과 무관 = 전체 현황) |

## §2 처방(결함 · 요청마다 하나)

### A 등급 순서
1. **사유 한 벌(CT)** — `automarketing-segment.ts` 에 `GRADE_ORDER_UNLOCK = 'grade_order'` · `GRADE_ORDER_LOCK_REASON = '고객등급 순서를 아직 정하지 않으셨어요. [등급 순서 정하기]에서 어느 등급이 위인지 정하면 열립니다.'` 두 상수 · 여정(`journey-trigger-capability.ts`)도 이 상수를 import(사유 두 벌 → 한 벌).
2. **잠금에 푸는 표시를 싣는다** — `SegmentAvailability.unlock?` · `TriggerAvailability.unlock?` · `toAvailabilityMap` 이 그대로 실음 · 막힘 번역(blocked DATA_MISSING)도 그 축의 unlock 을 실음 → 승인 창 응답 `blockUnlock` · 질문 보기(`LineQuestionOption.unlock`) · 여정 지도 capOf · 흐름 계획 locked 칸.
3. **화면** — 여는 부품 하나 `GradeOrderUnlockButton`(components/journey · 글자 「등급 순서 정하기」) + 창은 그 화면의 쪽(page)에 하나: 자동마케팅 쪽(`ContinuousOperatorPage`) · 여정 쪽(`JourneysPage` 의 기존 2831 창 · 지도 패널들은 그 쪽 안). 단추를 그리는 자리 = A2 · A3 · A4 · A6 · A7 · A8. 저장되면 그 자리를 다시 판정(대상 목록 · 승인 창 재번역 · 여정 데이터 범위 다시 읽기).
4. **고쳐 쓸 자리(영구 입구)** — `SegmentPicker` 의 상위 등급 · 등급이 오른 고객 카드가 열려 있으면 [등급 순서 바꾸기](같은 창).
5. **제안은 열린 축만**(A5 · B 와 공유) — 짝 막힘 제안(suggestKey) · ③ 「「…」에게만」 보기는 그 축이 지금 열려 있을 때만.
6. **죽은 파일 지움** — `pages/CustomersTab.tsx`(import 0 · 단추가 있는 줄 알게 만든 파일) · `journey-selfcheck-set.ts:120` 이유 글을 사실대로(「합성 회사는 등급 순서를 정하지 않아 켜기 관문이 막는다」).

### B 매일 주기(Q9 해제 · 명시 선택 + 경고)
1. CT `automarketing-segment.ts` — `repeatAckKey(schedule, target)` · `checkSchedulePairing(schedule, target, ack?)` = 짝 막힘이어도 ack === 키면 `{ ok: true, repeatNotice }` · 아니면 `{ ok: false, reason, suggestKey, ackKey }`. 사유 글에 세 길을 다 적는다: 「매일 보내면 같은 고객이 매일 다시 받게 돼요. 새로 해당된 고객만 고르거나, 주기를 매월로 바꾸거나, 그래도 지금 대상에게 보내려면 「지금 대상에게 매일 보내기」를 눌러 주세요.」 · 경고 글 `repeatNotice` = 「같은 고객이 매일 다시 받아요. 직접 고르신 대로 매일 보냅니다.」(매주면 매주).
2. 번역(`audience-translate.ts`) — 입력 `repeatAck` · 세 자리 모두 위 판정 · 통과면 axis/filters 에 `repeatNotice` · 막힘이면 `ackKey` · 제안 = 열린 축만.
3. 승인 창 보관본 — `CreateOperatorInput.repeatAck`(지문 문자열) · 질문 ③ 보기 값 `keep:<지문>`(질문표는 서버 보관 · 답 검증 = 그 표) → 답 = 그 지문 · 막힘 창 [지금 대상에게 매일 보내기] = `preview/update` 에 `repeat_ack: <응답의 ackKey>`(서버는 받은 지문을 넣고 재번역 · 지금 짝 지문과 다르면 다시 막힘 + 새 지문) · 다음 승인 창 = 운영자 행 `approval_meta.repeatAck` 를 이어받음 · 응답 = `repeatNotice`(경고 줄) · `ackKey`(막힘일 때). 지문 모양 검사 = `^(day|week):[0-9a-f]{16}$` 밖은 버림.
4. 저장 셋(B5 · B6 · B7) = 같은 판정 함수 · 저장한 짝이 반복이면 `approval_meta.repeatAck = 키` · 아니면 그 키를 지움(같은 트랜잭션).
5. 화면 — 경고 줄(누구에게 칸) · ③ 보기 열림 · ② 보기는 「· 매월로 보내요」 대신 그 축 그대로 + 경고 설명(고른 뒤 ③ 이 묻는다) · 세부설정 수정 = 400 AUDIENCE_PAIRING 이면 ConfirmModal(사유 + [지금 대상에게 매일 보내기] · [그만두기]) → 400 이 준 `ackKey` 를 `repeat_ack` 로 실어 다시 저장(그 사이 대상이 바뀌었으면 서버가 다시 400 = 다시 확인 창). **(구현 정정)** 승인 창 안의 번역은 새 등록 · 다음 승인 모두 「매월」로 하고 짝은 질문 ③ 한 곳이 지금 주기로 묻는다(§9-12 규칙을 다음 승인 창에도) → 막힘 창의 매일 단추 셋은 두지 않는다(결정 자리 하나).
7. **(구현 더함)** 등급 순서 창은 여는 창보다 위에 뜬다(뿌리 R27) — 자동마케팅 승인 창 z-[1200] 위 = `GradeOrderModal zIndexClassName="z-[1300]"` · 여정 · 지도 · 세부설정 창 위 = 기본 z-[75]. 막힘 창에서 정한 뒤 다시 셀 축 = 응답 `blockAxis`(막힌 축 키).
6. 그대로 두는 안전장치 = 7회차 묶음 승인 · 회사 자율 발송 상한 · 자동마케팅 예산 · 피로도(회사가 상한을 정해 둔 경우 · `continuous-operator.ts:3683`) · 회차마다 담당자 알림.

### C 대행 SMS 바이트(뿌리 R68 「나갈 수 있는가」의 길이 축)
1. CT `agency-send-preview.ts` — `measureAgencyRequestSmsBytes(row, content)` · `agencySmsBytesOver(row, content)` · 고객 글 `agencySmsBytesOverText(bytes)` = 「SMS는 90바이트까지 보낼 수 있어요. 이 문안은 실제로 나가는 문장 가운데 가장 긴 문장이 N바이트예요. 90바이트 안으로 줄이거나 LMS로 새로 접수해 주세요.」 · 담당자 문자 `buildSmsBytesNotify`(agency-send-notify.ts).
2. 판정 자리 = C2 · C3(같은 함수 · 트랜잭션 앞) · C4(다듬은 글 · 이어 볼 글) · C5(검사 앞) · C7(발송 직전) · 고객 화면 C8.
3. 검사 · 발송 직전 막힘 = 상태 test_failed(사람 판단 · 다시 검사 0 · 문안을 고치면 접수 수정 배관이 다시 검사를 연다 = 기존 글자 반려와 같은 갈래) · 이력 `sms_bytes_over`(바이트 · 단계) · 담당자 문자 한 통.

### D 대행 조회
1. GET `/api/admin/agency-send` 조건 서버로(D1) · 응답에 `truncated` · 기존 상태 · 요약 · 메일 응답 그대로.
2. GET `/api/admin/agency-send/mail-rejected`(D2) · CT `readRecentRejectedIntakes` 를 조건 받는 `readRejectedIntakes({ q, from, to })` 로(인자 없으면 지금과 같은 최근 20).
3. 화면 — 대행발송 내역 머리에 [접수일 · 발송일] 고르기 + 시작일 · 끝일(`input type=date`) · 검색어는 입력이 멈춘 뒤 서버로 · 잘림 안내 줄 · 메일 접수 반려 목록 위에 검색어 + 받은 날짜 범위 · 제목 「반려 · 오류 최근 20건」 ↔ 「반려 · 오류 N건」.

## §3 뿌리(ROOT-LEDGER)

| 접수 | 뿌리 | 등재 |
|---|---|---|
| A | R56 넓힘 = 잠금 사유가 사람의 할 일(정하기 · 확인하기)을 말하면 그 사유를 그리는 화면마다 그 일을 하는 단추가 있다 · 사유는 한 벌 | R56 줄에 1117 C142 사례 · 시험 이름 |
| B(결함 부분) | R56 넓힘 = 막힘 창의 제안이 잠긴 자리를 가리키지 않는다 | 같은 줄 |
| C | R68 넓힘 = 「나갈 수 있는가」의 길이 축(SMS 90바이트) · 글이 바뀌는 모든 자리와 나가는 문 · R47(효과 자리) | R68 줄 |
| D | R73 넓힘(한줄로 관리자 목록) = 고정 상한 목록을 화면이 다시 걸러 「없음」처럼 보이게 하지 않는다 · 잘리면 알린다 | R73 줄 |

**같은 뿌리 다른 기능(전수 grep · 이번 범위 밖 = 추가 과제 · 전역 0번 원칙)**: R68 길이 축 = 여정 SMS 칸 저장 · 실행기(`journey-executor.ts:816` 서버 길이 판정 0 · 변수 치환 뒤 90 초과 가능 · 미검증) · 직접발송 · AI 캠페인 발송 라우트(화면만 판정 · R68 등재 때 이미 「범위 밖 · Harold 판단」). R73 = 한줄로 관리자 화면의 다른 고정 상한 목록(미전수).

## §4 계약 시험(뿌리마다 대상을 소스에서 기계로 뽑음)

새 파일 `packages/backend/src/utils/__tests__/c142-staff-tickets.test.ts`.
- **K-A1** 서버: `등급 순서` 가 든 잠금 사유 문자열 = `GRADE_ORDER_LOCK_REASON` 상수 한 곳(백엔드 소스 전수 grep · 상수 정의 말고 0) · 그 상수를 쓰는 잠금은 `unlock: GRADE_ORDER_UNLOCK` 과 짝(구문 확인).
- **K-A2** 서버 값: 등급 값 있음 · 순서 없음 = vip · grade_up · 여정 grade 모두 available false + unlock grade_order · 순서 있음 = 열림 · 등급 값 없음 = unlock 없음.
- **K-A3** 화면: `GradeOrderModal` 을 그리는 파일 = 라우트 트리(App.tsx 에서 import 를 따라간 집합) 안 · 라우트 밖 파일에 GradeOrderModal · 등급 순서 단추 0 · 잠금 사유를 그리는 자리(뽑기 = `unlock` 을 읽는 화면 파일)마다 `GradeOrderUnlockButton` 사용.
- **K-A4** 제안: 짝 막힘 suggestKey · ③ 「에게만」 보기 = 잠긴 축이면 나오지 않음(값 시험).
- **K-B1** 판정 값 범위: (매일 · 매주 · 매월 · 매년) × (all · dormant · recent_buyers · vip · new_customers · 변화 축 · 칸 조건) × (ack 없음 · 같은 키 · 다른 주기 키 · 다른 대상 키) = 통과 · 막힘 · 경고 글.
- **K-B2** 소스: `checkSchedulePairing(` 를 부르는 모든 자리(기계 추출)가 ack 인자를 넘긴다(질문 보기 판정 제외 목록 = 이유 적은 줄만).
- **K-B3** 저장 셋이 approval_meta.repeatAck 를 같은 트랜잭션에서 쓰거나 지운다(구문).
- **K-C1** 소스: 대행 표의 `current_content` 를 쓰는 UPDATE 전수(기계 추출) = 그 함수 안에서 `agencySmsBytesOver` 를 부른다(검사 결과 저장 = 같은 글 · 이유 줄 예외만) · 워커의 `runSpamRound(` · `dispatchToPipeline(` 경로 = 판정 호출 있음.
- **K-C2** 값: 91바이트 SMS 고치기 = 400 SMS_BYTES_OVER · 90 = 통과 · LMS = 측정 안 함 · **표본 밖 최장 반례**(원래 값 점수가 높은 공백 이름 여섯 줄 + 점수는 낮지만 실제로 가장 긴 문장 한 줄 = 옛 상위 5명이 놓치던 모양)를 잡는다 · 입구용 · 저장 접수용이 같은 값.
- 실 PG `c142-agency-sms-bytes.pg.test.ts` — 쪽 경계(2,000줄 넘는 명단 · 최장이 마지막 쪽) · 고치기 막힘 · 검사 앞 막힘 · 발송 직전 막힘(test_failed · 이력 · 담당자 문자 한 통).
- 실 PG `c142-repeat-ack.pg.test.ts` — 새 등록 · 다음 승인 · 수정 저장에서 approval_meta.repeatAck 쓰기 · 지우기 · 기준 숫자 · 칸 조건 · 주기만 바꿔도 지문이 달라 400 · 400 의 지문으로 다시 저장 = 통과 · 그 사이 다른 저장이 대상을 바꾸면 옛 지문 = 400 · **다른 저장이 대상을 바꾸고 그 대상에 동의까지 저장한 경우(저장된 ack = 새 짝)에도 옛 지문을 실은 재요청 = 400**(2R 반례 · 주기까지 같아져 바뀜 판정이 건너뛰는 모양 포함).
- **K-D1** 조회: 날짜 범위가 `buildDateRangeFilter` 를 지난다 · 검색어 LIKE 는 `%` `_` `\` 를 escape · 상한 + truncated · 검색 칸 = 옛 화면 검색 칸(고객사 · 신청자 · 아이디 · 파일명 · 문안) 전부 포함(문안으로만 맞는 접수가 찾아짐).
- 변이: 판정 자리마다 끄면 빨간불(구현 보고에 수).

## §5 직원 지시문(구현 전 · 엑셀 한 장의 시트 넷)

계정 = 인비토 테스트 회사(합성 고객 = 도달 불가 번호) · 받는 번호 = 직원 본인 휴대폰.

**시트 1 등급 순서(임은지)**
| 순 | 하세요 | 보이면 맞음 |
|---|---|---|
| 1 | 자동 마케팅 → 빠른 시작 「VIP 데이 (매월)」을 누른다 | 「이대로는 시작할 수 없어요」 아래 [등급 순서 정하기] 단추 |
| 2 | [등급 순서 정하기]를 누른다 | 「등급 순서 정하기」 창 · 회사 등급 이름과 인원 |
| 3 | 맨 위 등급이 VIP 가 되게 순서를 맞추고 [저장]을 누른다 | 창이 닫히고 「이대로는 시작할 수 없어요」가 사라지고 대상 수가 보임 |
| 4 | 자동 마케팅 → 세부설정 → 발송 대상을 본다 | 「상위 등급 고객」 · 「등급이 오른 고객」 카드에 자물쇠 없음 · [등급 순서 바꾸기] |
| 5 | 여정 → 마케팅 여정 만들기 창의 빠른 시작을 본다 | 「등급 상승」 칩에 자물쇠 없음 |

**시트 2 매일 주기(임은지)**
| 순 | 하세요 | 보이면 맞음 |
|---|---|---|
| 1 | 자동 마케팅 한 줄에 「당일 행사 내용 안내 문자를 매일 보낼거야」를 적고 만든다 | 「매일 보내면 같은 고객이 매일 다시 받게 돼요」 질문 · 「지금 대상에게 매일 보내기」를 누를 수 있음 |
| 2 | 「지금 대상에게 매일 보내기」를 누르고 답한다 | 승인 창 첫 줄 「매일 오전 9시」 · 누구에게 칸에 「같은 고객이 매일 다시 받아요」 |
| 3 | [이번 주 승인하고 시작]을 누른다 | 자동 마케팅 목록에 「매일」로 생김 |
| 4 | 다른 자동 마케팅 승인 창에서 주기를 「매일」로 바꾸고 [적용하고 다시 세기] | 「이대로는 시작할 수 없어요」 아래 [지금 대상에게 매일 보내기] · [매월로 바꾸기] |
| 5 | [매월로 바꾸기]를 누른다 | 첫 줄이 매월로 바뀌고 경고 없음 |

**시트 3 대행 SMS(남지현)**
| 순 | 하세요 | 보이면 맞음 |
|---|---|---|
| 1 | 테스트 회사로 SMS 대행 접수(문안 80바이트 안팎) 후 상세를 연다 | 승인 대기 · [고치기] |
| 2 | [고치기]를 누르고 글을 늘린다 | 칸 아래 「가장 긴 문장 N / 90바이트」 · 90을 넘으면 빨간 글 · [저장하고 다시 검사] 누를 수 없음 |
| 3 | 90 안으로 줄이고 저장한다 | 「문안을 고쳤습니다」 · 진행 기록에 다시 검사 |
| 4 | 맞춤법 확인에서 고치면 90을 넘는 줄을 본다 | 그 줄 [고치기] 누를 수 없음 · 「고치면 SMS 길이(90바이트)를 넘어요」 |

**시트 4 대행 조회(남지현)**
| 순 | 하세요 | 보이면 맞음 |
|---|---|---|
| 1 | 슈퍼관리자 → 대행발송 내역 → 기준 「발송일」 · 시작일 · 끝일을 오늘로 | 오늘 발송 예정 · 발송된 접수만 |
| 2 | 검색칸에 고객사 이름 일부를 적는다 | 그 고객사 접수만 · 200건 넘으면 「기간을 좁혀 주세요」 |
| 3 | 대행발송 메일 접수 → 반려 · 오류 위 검색칸에 회사 이름 · 받은 날짜를 고른다 | 그 회사 · 그 날짜 반려만 · 제목 「반려 · 오류 N건」 |

## §6 미가입 · 직접발송만 쓰는 회사 = 동작 변화 0 증명

| 바뀌는 것 | 그 회사에 닿는가 |
|---|---|
| A · B | AI 존(자동 마케팅 · 여정) 화면 · 주소 = 요금제 문(`aiZonePlanBlocked`) 안 · 미가입 회사는 그 화면에 못 들어옴 = 0 |
| C | 대행발송 = 회사 스위치(`agency_send_enabled`) 켠 회사만 · 직접발송 코어(`direct-send-core.ts`) 무수정 · 변화는 SMS 대행 글이 90을 넘을 때만(지금도 통신사에서 전량 실패하는 글) |
| D | 슈퍼관리자 화면 · 읽기만 |

발송 핵심 다섯 파일(routes/campaigns · spam-filter · results · billing · utils/messageUtils) 무수정 · DDL 0(approval_meta 는 있는 jsonb · 새 칸 0) · ENV 0.

## §7 배포
서버 pull → 백엔드 build:safe → 프론트 build:safe → 적재 0건 → 재시작 → 실측(시트 넷 · C 는 배포 직후 SELECT 로 대기 중 SMS 대행 건 중 90 초과 수 확인 = 원장 C142-S1).

## §8 구현 기록(1117)
- 설계 Codex = 1R 4건(지문 정밀 · 재확인 경쟁 · 최댓값 보장 · 문안 검색 회귀) · 2R 1건(요청 ack 가 저장된 동의보다 먼저) 전부 수용 · 3R approve.
- 구현 정정 = §1 B3 · B4 · §2 B 5 · 7(승인 창 안 번역은 매월 · 결정 자리는 질문 ③ 하나 · 막힘 창 매일 단추 0 · 등급 순서 창 z-[1300] · 막힌 축 blockAxis) · 대상 카드 단추 = 카드 묶음 아래 한 줄(카드마다 붙이면 같은 줄 카드 높이가 어긋남).
- 구현 Codex = 1R 4건(대상 수 다시 세기 · 지도 잠금 목록 unlock · 메일 검색 새로고침 · 발송일 정렬) 전부 수용 · #2 는 A 와 같은 뿌리라 낱개로 막지 않고 서버의 잠금 사유 옮겨 싣기 줄 전수(지도 빈 자리 둘 · 잠금 목록 · 이어붙이기 점검 앞 여정 · 한 줄 물어보기 둘)에 unlock + 그리는 화면(지도 캔버스 · 지도 진단 · 이어붙이기 점검 · 한 줄 답)에 단추 + 계약 K-A5(줄 단위 · 주석 글자로 통과 0) · K-A3 넓힘 · 2R approve.
- 시험 = 새 계약 `c142-staff-tickets`(15) · 새 실 PG `c142-agency-sms-bytes.pg`(3) · `c142-repeat-ack.pg`(4) · `c142-agency-search.pg`(3) · 기대값을 새 계약으로 옮긴 옛 시험 넷(automarketing-oneline-1024 · automarketing-preview-1005 · automarketing-trust-1005 = Q9 해제 · 잠긴 축 제안 0 / agency-reply-body-c130 = 반환 칸 truncated · 부르는 자리 둘) · 옛 계약 글자를 지키려고 코드 쪽을 맞춘 것 셋(agency-send-preview 워커 import 줄 · c109 반려 줄 · c132 표기 판정 줄 = 새 판정은 따로 둠).
- 변이 = 19곳(A 4 · B 7 · C 5 · D 3) + K-A5 1곳 전부 빨간불.
- 화면 = 개발 서버에 버리는 확인 페이지(실제 부품 + 가짜 서버 답 · 확인 뒤 지움) · 막힘 창 단추 → 창(승인 창 위) → 저장 → 막힌 축으로 다시 셈 · 질문 ② 잠긴 축 단추 · ③ 열림 · 답 = keep:지문 · 경고 줄 · 대상 카드 잠금 풀림 → [등급 순서 바꾸기] · 대행 88 / 90(회색 · 저장 가능) → 91 / 90(빨강 · 안내 · 저장 잠금) · 관리자 내역 조건 · 잘림 안내 · 메일 반려 검색 · 여정 칩 · 흐름 계획 단추 · 폭 320 · 375 · 768 · 1024 · 1280 · 1920 페이지 넘침 0. Codex 1R 뒤 고친 화면 넷(지도 캔버스 · 지도 진단 잠금 목록 · 이어붙이기 점검 · 한 줄 답)과 대상 수 다시 세기 · 정렬 · 새로고침은 화면으로 띄워 보지 않음(코드 · 계약 시험 · tsc).
- 미검증 = 운영 데이터에서의 실제 측정 시간(105,384명 SMS 대행 명단 전원 측정 · 쪽 53) · 실제 담당자 문자 도착 · 직원 시트(§5).

