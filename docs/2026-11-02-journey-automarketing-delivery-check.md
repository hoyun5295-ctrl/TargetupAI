# 여정 · 자동마케팅 납품 전 구조체크 원장 (2026-11-02)

> 접수 = Harold 1102 「여정 · 자동마케팅을 많이 쓸 고객사 납품 · 업데이트 내역 전수 점검 · 모든 경우의 수 · 결함이 남았는지」 · 「10/31~11/02 수정분은 더 꼼꼼하게」 · 「나눠서 보면 결함이 나오냐 · 우린 흐름인데」 · 「니가 코드를 제대로 꼼꼼히 봐야지」.
> 방법 = 주재자 직접 읽기 · 흐름 순서(한 고객 · 한 회차를 처음부터 끝까지) · 이음매마다 쓰는 쪽 · 읽는 쪽 두 코드를 다 연다. 에이전트 0(1102 워크플로는 띄웠다가 멈춤).
> 이 문서 = 사실 장부(코드 근거). 처방은 Harold 동의 뒤 설계서로.

## §1 진행

| 흐름 | 상태 · 읽은 자리 |
|---|---|
| 여정 하루 묶음 발송(C96) | 읽음 — `journey-executor.ts` 200-1960 전부(회차 고르기 · 묶음 판정 · 전이 표 · `sendUnits` 적재 단위 · 재시도 상한 · 전진 · 완료 · 목표 · 조건 · 이상치 관문) · `send-time-util.ts` 225-378 · 진입 INSERT(`journey-trigger-watcher.ts` 83 · 600-660) |
| 진입 → 다음 칸 | 읽음 — 첫 칸 시각 = `firstRunAtFor` 세 자리(감시 631 · 860 · 재진입 184) · 진입 시각 = 같은 트랜잭션 NOW() · 다음 칸 = `calculateNextRunAt` |
| 스팸 관문 · 칸 보류 · 회복 | 읽음 — `journey-pretest-notifier.ts` 66-75 · 140-440(스캔 고르기 · 판정 · 보류 · 재작성 · 장애) · 실행기 관문 680-712 · 단위마다 보류 1058-1065 |
| 자동마케팅 회차 | 읽음 — `continuous-operator.ts` 1232-1651(생성 · 자격 · INSERT) · 2487-2866(생성 워커 · 발송 패스 · 보류 회복) · 3083-3670(되돌림 · 고착 복구 · 예약 발송 · 발송 직전 검사) · 대상 관문 `operator-audience.ts` 40-110 |
| 돈 | 읽음 — 여정 차감(단위마다 `prepaidDeduct` 1121) · 정산 스위퍼 여정 갈래(`mysql-refund-sweeper.ts` 380-480 · 미적재 판정 5분 `JOURNEY_LOAD_SETTLE_MS`) |
| 화면 · 링크 | 읽음 — 발송 갈래 문구 = 서버 `sendTimingLine` 한 곳 · 켜기 주인 확인(`journey-route.ts` 61-73) · 상황판 토큰(`manager-board.ts` 20-105 · `journey-pause-handler.ts` 67-83) · 충전 승인 되묻기(`ChargeApprovePage.tsx` 198 · 217) |
| 자동마케팅 등록 · 승인 · 기간 | 읽음 — `registerOperator` 392-619 · 생성 끝(검사 · 안내 · 다음 시각) 1651-1899 · `updateOperatorAfterRun` 1945-1979 · `approveProposal` 2075-2185 · `approveOperatorWindow` 4113-4201 · `runApprovalRenewalNotices` 4204-4250 · `sendAutoSendPrepNotice` 4673-4714 · `computeNextGenerationRun` · 등록 라우트 `ai.ts` 1796-1900 · 지금 실행 2389-2402 |
| 진입 감시 · 날짜축 · 재진입 | 읽음 — `journey-trigger-watcher.ts` 171-600 · 823-992(회차 · 상품 · 첫 구매 보호 · 커서 문 · 대량 차단 · 일괄 넣기 · 쿨다운) · `journey-anchor-scheduler.ts` 60-300 · `journey-reentry-worker.ts` 40-225 |
| 커서 문 · 한 번 보내기 | 읽음 — `processPurchaseLedgerJourney` 669-746(창 끝 = 오늘 KST 0시 · 09~12시 · 나이 = 도착 기준 = B-1101-7 ③④ C93 닫음) · `processCdpCursorJourney` 748-817 · `journey-anchor-scheduler.ts` 306-650(정산 → 넣기 → 회복 · 잠금 안 다시 판정 · 표식과 넣기 한 트랜잭션) |
| 싱크 적재 · 문안 확정 · 렌더 · 크레딧 · 화면 | 읽음 — `routes/sync.ts` 312-384 · 606-1309(고객 · 구매 · 수신거부) · 스냅샷 쓰는 자리 둘(`journey-builder.ts` 1234-1276 · 1734-1756) · 칸 고치기 `updateJourneyStep` 1307 · `applyStepPatchInLock` · 변이 쓰기(`bandit-optimizer.ts` 530-610 · 켜진 여정 막음) · `journey-message-render.ts` 전부 · `enrichCustomersWithPredictions`(순서 보존) · 자리 판정 CT · 보내기 전 검사 함수 · 자동마케팅 발송 뒤 절반(`continuous-operator.ts` 3670-3938) · `deductCreditOutcome` · `deductCreditSafe` · `reserveJourneyOperationCredit` · 화면 = `OperatorsManageList.tsx` 전부 · `ContinuousOperatorPage.tsx` 승인 · 실행 · 확인 창 · `OperatorPreviewModal.tsx` 시각 · 상한 칸 · 여정 화면이 부르는 서버 주소 전수(켜기 확인 · 점검 판 · 일괄 켜기 = 서버 응답 그대로) · 화면 쪽 시각 계산 grep |
| 1102 밤 최종 점검 전수 읽기 | 줄 단위 전부 = `journey-builder` · `journey-executor` · `journey-trigger-watcher` · `journey-target-extractor` · `journey-anchor-scheduler` · `journey-reentry-worker` · `journey-resume` · `journey-lineage` · `journey-activation` · `journey-pause-handler` · `journey-pretest-notifier` · `journey-pretest-validator` · `journey-send-claim` · `journey-message-render` · `journey-step-campaign` · `journey-step-edit-policy` · `journey-step-versions` · `journey-cdp-cursor` · `journey-purchase-ledger` · `journey-result-notice` · `journey-notice-once` · `journey-operation-release` · `journey-reshape` · `journey-check` · `journey-entry-ledger` · `journey-identity-signals` · `journey-safety-filter` · `journey-step-limits` · `journey-ad-policy` · `journey-start-kind` · `journey-intake-grace` · `journey-condition` · `journey-options-validator` · `journey-points-trigger` · `journey-after-config` · `journey-entry-replace` · `journey-access` · `journey-route` · `journey-product` · `journey-draft-save` · `manager-board` · `manager-weekly-digest` · `owner-contact` · `continuous-operator` 1-3190 · 4316-4600 · `operator-final-copy` · `operator-prep-reminder` · `operator-recipients` · `operator-audience` · 공개 멈춤 라우트 둘 · 자동마케팅 · 여정 수정 라우트 / 출구만 = `journey-ai-generator` 560-886(생성 뒤 거름) · `autosend-policy`(회차 · 승인 기간) · `automarketing-segment`(대상 축) · `automarketing-preview`(시작) · 화면 문구 grep |
| 1102 밤 최종 점검 전수 읽기(이어서) | 줄 단위 전부 = `continuous-operator` 3185-4848(발송 본체 · 승인 창 · 갱신 안내 · 0건 안내 · 예고 안내 · 행 읽기) · `operator-lag` · `operator-daily-recap` · `autosend-stop-link` · `ai-operator-trial-expire-worker` · `operator-check` · `operator-message-decorator` · `operator-cycle-snapshot` · `continuous-operator-policy` · `operator-conversion-attribution` · `operator-audience` 전부 · `autosend-policy` 전부 · `automarketing-segment` 195-460(상태 축 · 변화 축 · 짝 검사) · `spam-test-queue` 전부(등록 · 이어 보기 · 줄 고르기 · 실행 · 판정 · 재생성) · `journey-pretest-scan` · `journey-pretest-candidate` · `journey-attach` 1-333 · `send-time-util` 225-378 · `journey-trigger-capability` 계약 표 · `journey-step-diagnosis` 다음 단계 추천 · `journey-stats` 클릭 · 전환 SQL · 단축 링크 클릭 기록(`routes/short-url.ts` 60-110) · 변이 저장 · 삭제(`routes/ai.ts` 3769-3820 · `bandit-optimizer.ts` 520-612) · `cdp-events.ts` 305-342 · `send-placeholder-gate` · 화면 = `useJourneyActions` 전부 · 여정 · 자동마케팅 화면이 부르는 서버 주소 74개 기계 대조(스크립트 = 세션 scratchpad `api_match.py` · 없는 주소 0) · 상황판 링크 → 화면 주소 읽기 · 화면 native dialog 0 · 모델명 0(주석만) · 시각 숫자 grep / 켜는 길 전수 = `INSERT INTO journeys` 둘(`journey-builder.ts:421` · 판 복제 `journey-lineage.ts:287`) → AI 생산자는 모두 초안 → 켜기 관문 |
| 줄 단위로 안 읽은 것 | AI 문안 생산자 안쪽(`journey-ai-generator.ts` · `journey-ai-editor.ts` · `journey-step-diagnosis.ts` · 빌더 생성부 = 11/01 구조체크 · C89 · C91 의 대상 · 이번에는 출구 → 저장 → 관문 이음매만 봄) · 크레딧 CT 원장 내부(`ai-credit-tx.ts` 등 · 여정 · 자동마케팅이 기대는 함수 계약만 봄) · `JourneysPage.tsx` · `JourneyWorkspace.tsx` 줄 전부(서버 응답을 그리는 화면 · 데이터 출처만 확인) |

## §2 결함 (확정 = 코드 근거 · 주재자가 직접 연 줄)

| # | 결함 | 근거 | 그 고객사가 겪는 것 |
|---|---|---|---|
| D1 | 여정이 스스로 멈춰도 고객사 담당자에게 바로 가는 안내가 없다 | 멈춤 자리 = `journey-executor.ts` 경계 멈춤(`applyBoundaryPause` 978 · 갈래 = 요금제 805 · 라인 806 · 운영 크레딧 809 · 회신번호 815 · 알림톡 818 · 제목 902 · 비용 임계 905 · 월 예산 906 · 잔액 908 · 발송 표 910) · 차감 실패 1125 · 적재 재시도 소진 1088 · 1255 · 1302 · 하루 인원 이상치 1872 · 조건 판정 오류 1946. 멈춤은 진입 감시 멈춤 `pauseJourneyForCompany`(`journey-trigger-watcher.ts:106` · 대량 진입 383 · 573 · 신규 판정 불가 322 · 상품 설정 284 · 288) · 날짜축 대량 진입(`journey-anchor-scheduler.ts:237`) · 재진입 대량(`journey-reentry-worker.ts:173`). `pauseJourney`(1886) = 여정 전체 `status='paused'` · `autoPauseExecution`(`journey-pause-handler.ts:337`) = 실행 상태 · 기록만. 담당자 문자 길(`pickOwnerContact`)을 쓰는 곳 = `journey-result-notice` · `manager-weekly-digest` · `continuous-operator` · `planner-recheck` 뿐 · 여정 멈춤을 읽어 담당자에게 보내는 코드 0(grep). 운영 경보(`sendSystemAlert` = `SYSTEM_ALERT_PHONES` · 우리 쪽)는 이상치 · 미증명 단위 등 일부 갈래만. 엔진 설계 E4-1 「즉시 문자」 목록에도 여정 멈춤이 없다. 회사에 잔액 부족을 알리는 문자도 자동마케팅 파일 밖에는 없다(grep) | 잔액 · 회신번호 · 템플릿 하나 때문에 여정 전체(모든 고객 · 모든 칸)가 멈추는데 담당자는 화면 · 상황판을 열거나 월요일 주간 요약(「확인할 일 N건」)을 볼 때까지 모른다 → 그동안 진입 고객은 쌓이기만 하고 안 나간다. **그리고 다시 켜면 사건 커서를 다시 켠 시각으로 잡아(`journey-resume.ts:65-71` `RESUME_CURSOR_SQL` · 설계 = 「멈춘 동안 생긴 사건은 받지 않음」) 멈춰 있던 동안의 구매 · 배송 · 예약 사건 고객은 영영 진입하지 않는다** = 사람이 고른 멈춤이면 맞는 설계지만, 아무도 모르는 자동 멈춤과 겹치면 며칠 치 고객이 조용히 빠진다(P1 · P7) |
| D2 | 하루 묶음 이상치 관문에 최소 인원 바닥이 없다 | `journey-executor.ts:1867` 통과 조건 = `days < 7 \|\| today <= maxPrev × 3` · `days` = 지난 30일 중 진입이 1명이라도 있던 날 수(1859) · `maxPrev` = 그 날들의 하루 최대(1858) · 걸리면 `pauseJourney`(1872) = 여정 전체 멈춤 + 운영 경보(우리 쪽) · 담당자 안내 0(D1) | 평소 하루 0~1명 들어오는 여정(등급 상승 · 휴면 · 구매 주기 이탈 · 작은 매장의 장바구니)에 어느 날 4명이 들어오면 4 > 1 × 3 으로 여정 전체가 멈춘다. 설계 3-2 ⑤ 는 「값은 운영 분포 SQL 로 확인 뒤」였는데 추천값 그대로 들어갔다 |
| D3 | 같은 발송 시각의 자동마케팅 회차가 두 번 만들어진다(1102 임은지 접수 cmvyvqvhe0b8kjnsci44e1l28 「2시간 전 승인 대기 · 추천 문안이 또 옴」의 원인) | 회차를 만든 뒤 `updateOperatorAfterRun`(`continuous-operator.ts:1893` → 1968)이 다음 생성 시각을 **지금** 기준 `computeNextGenerationRun`(`autosend-policy.ts:300-317`)으로 다시 잰다 → 등록 · 미리보기 시작(`automarketing-preview.ts:865-870`) · 지금 실행(`routes/ai.ts:2394`)으로 발송 희망 시각 T 의 회차를 T − 준비 시간보다 먼저 만들면 다음 생성 시각이 다시 「오늘 T − 준비 시간」 → 워커가 같은 T 의 회차를 새 AI 문안으로 또 만든다(`generateProposalForOperatorRound` 1356-1358 · 같은 `computeNextOccurrence`). 막는 자리(1293-1305 `shouldSkipProposalGeneration`)는 「예약(scheduled) 회차」만 본다 · 보냄(sent) · 승인 뒤 보내는 중은 안 본다 · 승인 대기 회차는 새 회차가 만료시킨다(1619). 실측 = 접수 화면 10:57 · 12:01 두 통 · Harold 1102 DB = 제안 `923e0d4b`(10:57 · 12:00 만료) · `5f09e6d5`(12:00) | 담당자가 같은 회차에 승인 대기 · 다른 추천 문안을 두 번 받는다. 첫 회차를 승인해 이미 보냈어도(B-1102-1 ③ 즉시 발송) 두 번째 회차가 생긴다 → 두 번째가 자동 자격(회사 자율 또는 승인 기간 · 상한 안 · 검사 통과)이면 정한 시각에 **같은 고객에게 한 번 더 나간다** · 자격이 없어도 담당자가 다시 승인하면 두 번 나간다 · 예산 합계도 두 번 |
| D4 | 큰 회사에서 진입이 몇 시간 ~ 며칠에 걸쳐 나뉜다(버림은 아님 · 밀림) | 상태 트리거(휴면 · 생일 · 포인트 소멸) = 한 번에 10만(`JOURNEY_COUNT_CAP` · `journey-trigger-watcher.ts:335` · 374) 뒤 1시간 쉼(161 · 224 · 잘린 회차도 같은 1시간 · 사건 문은 이어 읽기 `drainCursorDoor` 430 이 있는데 상태 트리거는 없다) · 자동 재진입 = 여정당 6시간마다 1,000명(`journey-reentry-worker.ts:45-46` · 181 = 하루 4,000명) | 포인트 소멸 대상 30만이면 3시간에 걸쳐 들어오고, 자정을 넘기면 하루 묶음(C96)이 이틀로 갈려 일부가 하루 늦게 나간다. 재진입 대상 10만이면 25일 |
| D5 | 자동 재진입으로 다시 들어온 고객은 진입 정보를 싣지 않는다 | 재진입 넣기(`journey-reentry-worker.ts:186-191`) = `entry_event_properties` 없음 · 진입 감시는 포인트 소멸 여정에 `points_at_entry` 를 싣는다(`journey-trigger-watcher.ts:399-406`) · 목표 「포인트 사용」 판정 = `points_at_entry` 가 숫자일 때만(`journey-executor.ts:1699-1708`) | 포인트 소멸 여정에 자동 재진입을 켜면 다시 들어온 고객은 포인트를 써도 여정이 끝나지 않고 남은 칸을 계속 받는다(장바구니 여정은 상품 정보 없이 다시 들어온다) |
| D6 | 켜진 여정의 칸 문안을 고치면 채울 자리(「[혜택 안내: 직접 수정해주세요]」 등)가 남아도 막는 자리가 없다 | 자리 판정 `hasUneditedJourneyPlaceholder`(`send-placeholder-gate.ts:43-48`)를 부르는 막는 자리 = 켜기 검증 `validateJourneyForActivation`(`journey-pretest-validator.ts:65` · 117) · 켜기 관문(`journey-builder.ts:988`)뿐 · 켜진 여정 칸 고치기(`routes/ai.ts` 3532 PATCH → `updateJourneyStep` 1307 → `applyStepPatchInLock`) = 판정 0 · 확인 전 스냅샷(신뢰도 0 · `createStepSnapshot` 1734) → 보내기 전 검사 `processBundle`(`journey-pretest-notifier.ts:280-428`)은 `runStepSpamTest`(스팸만 · 자리 판정 0)로 통과하면 100 → 실행기(`journey-executor.ts` 613-936) 자리 판정 0. 화면 점검 판 · AI 출구 표식(`copy-finish.ts:57` `quickCheckOf`)은 「채울 자리가 남았어요」를 보여 줄 뿐 저장 · 발송을 막지 않는다(호출처 grep) | 운영 중인 여정에서 칸 문구를 손보거나 AI 다듬기를 받아 저장하면, 채울 자리가 남은 글이 스팸 검사만 지나 실제 고객에게 그대로 나간다 |
| D7 | 결제 뒤 취소 · 환불된 주문의 고객도 구매 여정에 들어가고 남은 칸을 계속 받는다 | 몰 주문 취소 · 환불 = 같은 purchase 사건에 `revenue_reversed` · `cancel_seen_at`(`cdp-orders.ts:207-330`) · 여정 사건 커서 = `event_name` 만(`journey-target-extractor.ts:756-765`) · 목표 판정(`journey-goal-purchase.ts:19-36`) · 실행기 = 취소 표식 읽기 0(grep) · 결제 판정 조각 `netPurchaseSql`(`cdp-order-revenue.ts:74-80`)은 플래너 · 자동마케팅 성과만 씀(R1 두 벌) | 주문을 취소한 고객에게 「구매 감사 · 리뷰 남겨 주세요 · 재구매 권유」가 나간다 |
| (알려진 건) | B-1102-1 승인 기간 회차를 회사 자율 상한(미설정 1,000명 · 5만원)이 덮어씀 · 회차 승인이 설정 시각을 무시 · 「다음 실행」 = 준비 시각 | 이 세션에서 다시 연 줄 = `continuous-operator.ts:1547-1555`(회차 자격) · `3641-3667`(발송 직전 상한) · 처방 원장 = `FEATURE-AUTOMARKETING.md` §12 8번 · 미착수 | 많이 쓰는 고객사는 회차마다 1,000명을 넘으므로 승인 기간을 줘도 매 회차가 승인 대기로 떨어지고, 승인하면 정한 시각이 아니라 누른 순간 나간다 |

### §2-0 결함별 배포 상태(직원 접수 = 서버 코드 기준 · ★ Harold 1102 「배포 안 된 코드로 결함을 올렸을 것을 명심」)

- 서버 = `deployed_head 8372eb16`(C94 · C95 포함 · 1102 11:47:50 재시작 · `status/DEPLOY-LEDGER.md` 머리) · 그 전 = bec5d5d5(C93). **C96(33f049c2) 서버에 없음.** 10:57 문자 = C93 코드 · 12:01 문자 · 두 접수 = 8372eb16 코드.
- 판정 근거 = `git log 8372eb16..HEAD -- <파일>` · `bec5d5d5..8372eb16` · C96 diff 의 지운 줄(옛 코드).

| 결함 | 서버(지금) | C96 배포 뒤 | 근거 |
|---|---|---|---|
| B-1102-1 | 있음 | 있음 | `continuous-operator.ts` · 화면 두 파일 = 8372eb16 뒤 변경 0 |
| D1 멈춤 안내 0 | 있음 | 있음(갈래 늘어남 · 이상치 관문) | 옛 실행기 `pauseJourney` 자리 15(C96 diff 지운 줄) · 진입 감시 · 날짜축 · 재진입 = 변경 0 또는 첫 칸 시각만 |
| D2 이상치 관문 바닥 0 | 없음 | 생김 | `dailyVolumeGate` = C96 새 코드(diff 더한 줄만) |
| D3 같은 회차 두 번 | 있음 | 있음 | `updateOperatorAfterRun` · `shouldSkipProposalGeneration` · `computeNextGenerationRun` · 등록 · 미리보기 시작 = C93 ~ C96 diff 변경 0 · Harold DB 실측(10:57 · 12:00 제안 둘) |
| D4 큰 회사 진입 밀림 | 있음 | 있음(자정 넘으면 하루 묶음이 이틀로 갈리는 면은 C96 뒤) | 상태 트리거 10만 · 1시간 · 재진입 1,000 · 6시간 = 변경 0 |
| D5 재진입 진입 정보 누락 | 있음 | 있음 | C96 = 재진입 첫 칸 시각만 바꿈(넣는 문장 그대로) |
| D6 켜진 여정 고친 글 자리 판정 0 | 있음 | 있음 | `applyStepPatchInLock`(C89) · 스캐너(C93) · 실행기 = 모두 판정 0 |
| D7 취소 · 환불 주문 구매 여정 진입 | 있음 | 있음 | `journey-target-extractor.ts` · `journey-goal-purchase.ts` = 8372eb16 뒤 변경 0 |

### §2-2 1102 밤 최종 점검 전수 읽기에서 더 나온 결함(Harold 「여정 · 자동마케팅 최종 점검 · 전체 구조체크」)

| # | 결함 | 근거(파일:행) | 고객사가 겪는 것 |
|---|---|---|---|
| D8 | 다시 켜면 앞으로 보낼 실행까지 전부 최소 하루 밀린다 | `journey-resume.ts:45-50` `RESUME_SHIFT_SQL` = 멈춘 시각 뒤 `next_run_at` 인 **모든** 진행 중 실행을 `GREATEST(1, ceil(멈춘 일수))` 일 민다(멈춤과 무관한 미래 칸 포함) · 다시 켜기 = `activateJourney` 안 `applyResumeAdjustments`(`journey-builder.ts:1136-1143`) | 5분 멈췄다 켜도 그 여정의 모든 예정 문자(예약 안내 · 구매 뒤 7일 후기 · 다음 칸)가 하루 늦게 나간다 |
| D9 | AI 맞춤 여정이 없는 변수를 쓰라고 지시하고, 그 변수는 발송 때 빈칸으로 지워진다 | 지시 = `journey-builder.ts:588`(「%고객명%, %상품명%, %혜택% 등 변수 활용」) · 입구 = `routes/ai.ts:3318` · `JourneysPage.tsx:1272` · 없는 `%변수%` 지움 = `messageUtils.ts:324` · 켜기 · 검사 · 실행기에 「없는 변수」 판정 0(grep) | 「고객님께 를 드려요」처럼 문장이 깨진 채 고객에게 나간다(검사도 깨진 글로 통과) |
| D10 | 통과한 글의 주간 재검사가 바로 보내는 첫 칸에서는 돌지 않는다 | 검사 스캔 = `next_run_at` 이 (지금, 지금+2시간] 인 실행만(`journey-pretest-notifier.ts:217-219`) · 바로 보내는 갈래 첫 칸 = 진입 시각(`send-time-util.ts:368-377` → `calculateNextRunAt` 지연 0) · 실행기는 5분 안에 집는다 | 구매 감사 · 배송 · 예약 첫 칸 문안은 처음 한 번 검사 뒤 통신사 판정이 바뀌어도 다시 보지 않는다 → Harold 주간 묶음 검사(설계서 §0-1)로 닫는다 |
| D11 | 알림톡 칸에 템플릿이 없거나 미승인이어도 켜지고, 첫 발송에서 여정 전체가 멈춘다 | 켜기 검사 = 대체 문안만(`journey-builder.ts:1004-1013`) · 실행기 = 템플릿 코드 없음 · 없음 · 미승인 · 비활성이면 경계 멈춤(`journey-executor.ts:761-786` · 818) · 멈춤 안내 0(D1) | 켜고 나서 첫 고객이 들어오는 순간 여정이 조용히 멈춘다 |
| D12 | 옛 「앞 칸 클릭」 조건이 그 칸 링크가 아니라 아무 문자 링크 클릭이나 센다 · AI 맞춤 여정이 이 옛 조건을 만든다 | 판정 = `journey-executor.ts:1775-1795`(그 칸 발송 뒤 아무 `message_click`) · 지시 = `journey-builder.ts:597` · 켜기 = 허용(`journey-builder.ts:907`) · 화면은 이 조건 저장을 막음(`JourneysPage.tsx:2156`) | 다른 캠페인 링크를 누른 고객이 「눌렀음」 갈래로 간다(갈림이 틀린다) |
| D13 | 목표 「클릭」이 여정 문자 링크가 아니라 아무 문자 링크 클릭이나 센다 | `journey-executor.ts:1674-1686` | 다른 문자 링크를 누른 고객의 여정이 일찍 끝나 남은 칸을 못 받는다 · 성과 숫자가 부푼다 |
| D14 | A/B 문안이 있는 켜진 칸의 문안을 고치면 저장은 되지만 나가는 글은 그대로다 | 실행기 = 변이 본문(라이브)이 스냅샷 · 칸 본문을 덮음(`journey-executor.ts:845-847` · `journey-step-versions.ts:44-58`) · 켜진 여정 칸 고치기 = 칸 본문 + 변이 없는 스냅샷만(`journey-builder.ts:1415-1474`) · 화면 확인 = 미검증 | 담당자는 고쳤다고 아는데 고객에게는 옛 A/B 문안이 계속 나간다 |
| D15 | 밤에 들어온 알림톡(정보성 · 배송 · 예약)도 아침까지 붙잡힌다 · 밤 트리거 문자는 8시가 아니라 9시에 나간다 | 실행기 발송 창 = 채널 구분 없음(`journey-executor.ts:714-720` `sendWindowState`) · 첫 칸 시각 = `shiftToSendableHour` → `NIGHT_ARRIVE_HOUR = 9`(`send-time-util.ts:233` · 257 · 주석 「Harold 명시 9시」) · 발송 창 시작 = 8시(`config/defaults.ts:323-327`) · Harold 1102 밤 「카카오 템플릿형을 제외하곤 다음날 8시」 | 밤 배송 안내가 다음날 아침 9시에 간다 · 밤 가입 문자는 8시가 아니라 9시 |
| D16 | 알림톡(정보성) 칸을 광고로 다룬다 · 피로도 상한에 걸리면 배송 · 예약 알림톡이 안 나간다 | 광고 판정 = 알림톡은 `is_ad` 를 그대로(`journey-ad-policy.ts:1-4` · 칸 저장 기본값 true `journey-builder.ts:1677`) · 피로도 = 광고 칸만(`journey-executor.ts:750-752` · 817 「fatigue_capped」 건너뜀) · 수신 동의 · 080 거부 거름 = 채널 구분 없음(`journey-safety-filter.ts:1-20` · 실행기 798-799) | 그 주에 광고를 여러 번 받은 고객은 배송 시작 알림톡을 못 받는다 · 광고 수신 동의를 안 한 고객은 예약 확인 알림톡도 못 받는다(정보성 문자의 동의 기준 = Harold 확인 필요) |
| D18 | 같은 번호의 고객 행이 둘이면(매장 둘) 같은 여정 문자를 두 번 받는다 | 고객 유일 키 = (회사 · 매장 코드 · 번호)(`SCHEMA.md:602`) · 번호로 한 사람만 남기는 거름 = 가입(`journey-target-extractor.ts:138-150`) · 등급(340-345)뿐 · 휴면 · 생일 · 포인트 · 고른 고객 · 구매 주기 · 장바구니 · 둘러봄 · 사건 커서 = 고객 행 단위 · 실행기 묶음 안 중복 거름 = 고객 id(`journey-executor.ts:800-803`) · 자동마케팅은 직접발송이 번호 중복을 지운다(`direct-send-core.ts:37-72`) | 두 매장에 가입한 단골이 생일 · 휴면 · 포인트 문자를 두 통 받고 요금도 두 번 나간다 |
| D19 | 가입 축하 포인트를 받았거나 가입과 첫 구매가 같이 들어온 진짜 신규 고객이 「기존 고객」으로 빠져 환영 문자를 못 받는다 | 신규 판정 = 원장에 없음 AND NOT 기존 근거(`journey-target-extractor.ts:128` · 145) · 기존 근거 = 구매 횟수 > 0 · 최근 구매일 있음 · 마지막 구매일 있음 · 총 구매액 > 0 · **포인트 > 0** · 기본 등급 아님(`journey-identity-signals.ts:97-116`) · 언제 생긴 근거인지(가입 전인가) 보지 않음 · 진입 감시 = 5분마다(`journey-trigger-watcher.ts:251-252`) | 가입 포인트를 주는 몰 = 신규 가입 여정 진입 거의 0 · 매장(싱크)은 첫 구매 때 고객이 생겨 구매 횟수가 이미 1 = 진입 0 |
| (확인) | 두 문 회사(자사몰 + 매장 싱크) = 자사몰 문이 30일 안에 살아 있으면 매장 구매 원장 문을 전부 닫는다 | `journey-purchase-ledger.ts:185-189` · 설계 선택(같은 구매 두 번 진입 막기) | 매장에서 산 고객은 구매 여정에 안 들어간다 · 그 고객사가 두 문을 다 쓰는지 확인 필요 |
| D20 | 자동마케팅 「새로 등록된 고객」이 가입한 사람이 아니라 한줄로에 고객 행이 생긴 사람이다 | 대상 조건 = `c.created_at >= 기준`(`automarketing-segment.ts:326-329`) · 쓸 수 있는가 = 늘 가능(320-325 「등록 시각은 모든 고객 행에 남는다」) · AI 대상 축 지시도 「등록일 기준」(`autosend-policy.ts` `TARGET_HINTS` new_customers) · D19 와 같은 뿌리(R53) | 한줄로를 처음 쓰는 날 기존 고객 명단을 올리면 그 회사 기존 고객 전원이 「새로 가입한 고객」 축으로 잡혀 환영 문자를 받는다(자율 상한 1,000명 안이면 사람 확인 없이) |
| D20 넓힘 | 여정 추천(빈자리 찾기)의 「지난 7일 신규 가입」 수가 가입한 사람이 아니라 행이 생긴 사람이다 | `journey-opportunities.ts:139` `COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') AS onb_cnt` · D19 · D20 과 같은 뿌리(R53) · 1102 밤 CT 편입 추출에서 나옴(설계서 3-0 CT-J6) | 기존 고객 명단을 올린 주에 「신규 가입 환영 여정을 켜면 N명」이 기존 고객 수로 부풀어 보인다 |
| D21 | 알림톡 칸 변수 연결 검사가 실제로 보내는 템플릿 글이 아니라 칸에 적힌 글을 본다 | 켜기 검증 = 칸 본문(`journey_steps.message_template`)의 `#{…}` 만 연결 확인(`journey-pretest-validator.ts:140-141` · 229-236) · 실행기 = 승인 템플릿 본문(`kakao_templates.content`)을 연결 표로 채운다(`journey-executor.ts:766-770` · 852) · 둘이 같다는 보장 = 코드에 없음 | 템플릿을 다시 승인받아 변수가 바뀌었거나 칸 글이 템플릿과 다르면, 검사를 지난 알림톡이 빈 자리로 나가거나 카카오가 반려해 대체 문자로 간다 |
| (닫음) C1 변이 판 켜기 검사 | 켜기 검증이 변이 판마다 채울 자리 · 제목 · 스팸을 본다 | `journey-pretest-validator.ts:111-136`(`stepSendVersions` 로 판 전부) · 켜진 여정 변이 만들기 · 지우기 = 막힘(`routes/ai.ts:3778-3780` · 3811-3814 · `bandit-optimizer.ts:539` · 603) | 결함 아님 |
| D7 넓힘 | 취소 · 환불 구매를 읽는 자리 = 진입 커서 외에도 목표 · 조건(`cdp_event_exists` purchase · `purchase_since_entry`) · 기다리기(사건 purchase) · 첫 구매 · 휴면 복귀 판정(`selectLastPriorPurchase` `journey-target-extractor.ts:860-889`) · 구매 주기(291-317) · 상품 구매자(620-628) | 위 파일:행 | 취소한 주문이 「이전 구매」 · 「목표 달성」 · 「구매함」으로 읽힌다 |

### §2-1 1102 오류접수 두 건 ↔ 결함

| 접수 | 접수 내용 | 원인(코드) | 원장 |
|---|---|---|---|
| cmvytc7b70b42jnschh4yawah 「자동마케팅 - 승인」(임은지 14:23) | ① 「이 문안으로 승인」 = 설정 시각(매월 2일 14시) 무시하고 즉시 발송 · 확인 창 「승인 즉시 대상 고객에게 발송됩니다」 ② 카드 「다음 실행 12. 2. 오후 12:00」 ≠ 매월 14:00 | ① `approveProposal` 야간이 아니면 바로 `dispatchProposalSend`(`continuous-operator.ts:2184`) ② 카드가 다음 생성 시각(발송 − 준비 시간)을 그린다 | B-1102-1 ③ ④ = `FEATURE-AUTOMARKETING.md` §12 8번 B · C(그대로) |
| cmvyvqvhe0b8kjnsci44e1l28 「자동마케팅 - 승인대기와 추천문안 문자」(임은지 15:30) | 등록 즉시 승인 대기 + 추천 문안 → 발송 2시간 전 승인 대기 + **새로 짠** 추천 문안이 또 옴(승인 안 한 경우 · 승인해서 이미 보낸 경우 둘 다) · 기대 = 안 했으면 「승인하지 않으면 발송되지 않습니다」 · 승인했으면 여정과 같은 「발송 전 안내(취소 링크)」 · 보냈으면 발송 알림 · 결과 | 같은 발송 시각 회차 두 번 생성 = D3 · 승인한 회차의 발송 전 안내는 지금 자동 예약 회차에만 있다(`sendAutoSendPrepNotice` 1842 · 조건 1841 = 자동 자격 + 예약) | D3(새 결함) + B-1102-1 B(승인 = 그 시각 예약)를 고칠 때 발송 전 안내 · 미승인 안내를 같은 설계로 |

## §3 이음매 확인 결과(결함 아님 · 근거)

- 진입 시각 ↔ 하루 묶음 날짜 = 같은 트랜잭션 NOW()(`journey-trigger-watcher.ts:610` · `dailyBatchDay`) · 화면 갈래 문구 = 서버 `sendTimingLine` 한 곳.
- 묶음 판정 ↔ 적재: 표식 문장이 여정 · 실행 active 를 그 순간 다시 본다(1098-1112) · 차감 = 표식 수(1121) · 들어감 = 같은 문장 확정 + 비용(1182) · 안 들어감 = 표식 지움 + 재시도 규칙 · 결과 불명 = 표식 보존 + 단위 판정.
- 결과 불명 단위의 돈 = 5분 뒤 미적재로 환불 → 들어감이 증명되면 회수(정산 스위퍼 · C96 이전부터의 설계).
- 칸 보류 = 담당자 안내 있음(`pretest_held` · `deliverPendingNotices`) · 검사 장애 = 통과한 글은 계속 · 새 글은 기다림.
- 피로도 = 여정 · 자동마케팅(직접발송 경로 `direct-send-processor.ts:355`) · 직접발송이 같은 기록 · 같은 판정.
- 자동마케팅 「여정 진행 중 고객 제외」 = 회사 설정 하나가 대상 SQL 관문에 들어간다.
- 한 개 켜기도 주인 확인(`journeyGate` → `canAccessJourney`) · 상황판 토큰 = HMAC · 만료 · kind · 활성 사용자 · 단축 코드 8자 base62 · 충전 승인 = 확인 창 뒤.
- 싱크 고객 · 구매 = 번호 정규화(`normalizePhone`) 뒤 적재 · 수신거부 표는 그 번호를 옮긴다(실행기 수신거부 대조와 같은 꼴) · 구매 = 요청 한 트랜잭션 · 계통 오류 = 되돌림 + 503.
- 켜진 여정의 A/B 변이 = 만들기 · 지우기 막힘(`bandit-optimizer.ts` 539 · 603) · 칸 문안 고침 = 확인 전 스냅샷(신뢰도 0) → 검사 통과 전 실행기가 기다림.
- 묶음 렌더의 예측 값 = 입력 순서 그대로(`predictive-suite.ts:409-438`) · 다른 사람 값이 섞이지 않는다.
- 자동마케팅 발송 돈 = 발송 크레딧 엄격 차감 → 캠페인 → 마커 → 보냄 · 캠페인을 못 만든 시도 = 30분 뒤 되돌림 · 크레딧 부족 = 보내지 않음 + 운영자 크레딧 정지 + 담당자 안내.
- 보내기 전 자동 재작성 = 원본에 없던 혜택 · 숫자 · 효능 · 계절 낱말 · 링크 빠짐 · 꼴 무너짐이면 버림(`journey-ai-generator.ts:1333-1361`) · 자리표시는 보존(D6 와 같은 뿌리).
- 화면 하한 = 여정 · 자동마케팅 화면 native dialog 0 · 모델명 0(주석 밖 grep 0).

## §4 판정(1102 밤 · 주재자 직접 읽음)

- **이대로 납품 불가.** 그 고객사가 실제로 겪는 결함 = 서버 지금 B-1102-1 · D1 · D3 · D6(+ 큰 회사 D4 · 포인트 재진입 D5) · C96 배포하면 D2 가 더해진다.
- 막아야 할 순서(돈 · 고객에게 잘못 나감 먼저): D3(같은 고객 두 번) · D6(자리 남은 글이 고객에게) · B-1102-1(승인 기간 무력 · 승인 = 즉시 발송) · D1(자동 멈춤 무안내 + 다시 켜면 그동안 사건 빠짐) · D2(C96 배포 전에) · D4 · D5.
- 처방 = 아직 0 · CLAUDE.md 순서(설계안 → 구조체크 → Codex 설계 → Harold 동의 → 구현 → Codex → 배포) · B-1102-1 처방 원장 = `FEATURE-AUTOMARKETING.md` §12 8번(둘째 접수의 발송 전 안내 · 미승인 안내를 같은 설계에).
