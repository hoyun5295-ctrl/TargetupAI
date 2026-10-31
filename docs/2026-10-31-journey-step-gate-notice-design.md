# 여정 칸 관문 · 담당자 안내 = 그 칸 발송에 묶는다 (설계 · 2026-10-31)

> 접수 = Harold 1031 「즉시 발송 칸과 날짜 기준 여정에도 담당자 안내가 가도록 설계안」 → 「설계안 만들고 Codex 리뷰 닫힐 때까지 → 구조체크 결함 없을 때까지 → 구현까지 마무리」 + 같은 날 오류접수 `cmvujpa3w03mljnscr5l28f0t`(1030 임은지 「여정 - 담당자 알림」 · Harold 「이것도 같은 맥락인가?」 → 같은 뿌리 = 이번 설계에 넣음).
> 상태 = Codex 설계 9R approve(§10) · 구조체크 4회차 결함 0(§9) · 구현 · Codex 구현 3R approve(§11-3) · 배포 대기(원장 C84).

## 0. 축 대조표

| 접수 항목(원문의 모양) | 이 축이 없으면 닫히는가 |
|---|---|
| Harold: 바로 보내는 칸에도 담당자 안내 | 안 닫힘. 안내 · 재검사는 「지금보다 뒤에 나갈 발송」만 보는 스캔에 있다(§1-1) |
| Harold: 날짜 기준 여정에도 담당자 안내 | 안 닫힘. 날짜 기준 여정은 보내는 순간에 실행 행을 만든다(§1-2) |
| 임은지: 「보내기 2시간 전」 알림을 늘 켬 · 기본(켬)으로 둬도 안 오고 문자가 바로 나감 · 「2시간 전 알림 → 2시간 뒤 발송」이 맞지 않나 | 안 닫힘(위 두 줄과 같은 뿌리). 「2시간 뒤 발송」은 택하지 않는다(§7 K1) · 화면 문구가 실제 시점을 말해야 닫힌다(§2-7) |
| 임은지: 「보낸 결과」 알림도 안 옴 · 언제 오나 · 결과는 전부 실패 | 안 닫힘. 결과 안내는 고객이 여정을 다 마친(`completed`) 실행만 본다(§1-3) |

빠진 축 0. 결과가 전부 실패인 원인(받는 번호)은 이 설계 밖이다(§6).

## 1. 현재 사실 (근거 = 코드 · Harold 실행 출력)

### 1-1 보내기 전 검사 · 안내 = 앞날 스캔 하나

- 담당자 안내와 2시간 전 스팸 재검사는 `utils/journey-pretest-notifier.ts` `scanAndPretest` 하나가 만든다(5분 주기 · `journey-pretest-notifier-worker.ts`). 후보 = 진행 중 실행 중 `next_run_at > NOW() AND next_run_at <= NOW() + 2시간` · 다음 칸이 문자(sms · lms · mms)(46~78줄). 묶음 = (여정 · 칸 · 발송일 KST) · 처리 기록 = `journey_pretest_schedules`(상태 무관 존재 = 그날 처리함 · 70~72줄).
- 실행 행이 `next_run_at = 지금`으로 생기면 스캔 후보가 되지 못한다. 생기는 곳:
  - 시작 사건 진입: 첫 칸 `calculateNextRunAt(relative, 0)` = 지금(`send-time-util.ts:277` · `journey-trigger-watcher.ts:574` · `:778`).
  - 앞 칸 뒤 대기 0인 칸으로 넘어갈 때(실행기 `advanceOrComplete`).
  - 날짜 기준 · 한 번 보내기 즉시(§1-2).
- 실행기는 문자 칸을 보내기 직전 「재검사 전 문안」(스냅숏 `confidence_score < 100`)만 10분 미룬다(`journey-executor.ts:704~734`). 미룬 실행은 앞날이 되어 스캔이 검사한다. 이 관문은 문안 수정만 본다. 「그날 검사가 있었나」는 보지 않는다.
- 발송 시간 검사(08~21시)는 그 관문 뒤다(`journey-executor.ts:755`).
- 실측(Harold 1031): sgbaek 이 10-30 13:49 · 14:19 에 만든 두 여정 = 1번 칸 `relative 0h` · 알림 true · 1번 칸이 10-30 13:59 · 14:30 에 나감(다음 발송 11-06 = +168시간) · 그때 안내 0. 다음 날 10-31 07:04 안내 2건 = 4956(sgbaek) · 결과 1000.

### 1-2 날짜 기준 여정

- `journey-anchor-scheduler.ts` 30분 주기. 칸마다 `runAt = computeAnchorStepRunAt(기준일, 오프셋, 시)` · **오늘이고 `now >= runAt` 일 때만** 대상을 뽑아 단발 실행을 만든다(128~129줄) · `next_run_at = shiftToSendableHour(now)`(195줄) = 지금. 그래서 2시간 전 스캔에 한 번도 안 걸린다(안내 0 · 재검사 0). 30분 주기라 발송도 최대 30분 늦다.
- 정지 링크 [이 발송 정지]는 그 여정 · 칸 · 날짜의 진행 중 실행을 멈춘다(`journey-pause-handler.ts:136` `DUE_EXECUTIONS_SQL`). 날짜 기준 여정은 보내기 전에 실행이 없어서 이 링크로 멈출 것이 없다.
- 다시 켜기 보정(`journey-resume.ts`)은 날짜 기준 · 한 번 보내기 실행을 밀지 않는다(`isSingleShotStartKind` · 82줄).
- 한 번 보내기 = 켤 때 실행을 만든다(`dispatchOneShotJourney` · 292줄): 예약이면 그 시각(앞날 = 스캔 후보) · 즉시면 지금.

### 1-3 보낸 결과 안내

- `campaign-sync-worker.ts` `notifyJourneyResultsToManagers`(137줄~) · 후보 = `journey_executions.status = 'completed'` · `result_notified_at IS NULL` · 완료 3시간 안 · 칸 = 실행이 끝난 칸(`s.step_order = e.current_step_order`).
- 그래서 1번 칸을 보낸 고객이 2번 칸(+168시간)을 기다리는 동안은 1번 칸 결과 안내가 없다. 실측 = 10-30 두 여정 진행 중 18 · 157(다음 발송 11-06) → 「보낸 결과」 안 옴과 같다.
- 번호 오류 · 조건 미충족으로 `ended` 된 실행 · 정지된 실행도 결과 안내가 없다.
- 본문은 칸 단위(「step N / M · 다음 step 자동 진행 예정」)인데 후보는 실행 완료 단위다.
- 여정 발송은 (여정 · 칸 · 발송일 KST)당 캠페인 하나를 같이 쓴다(`journey-step-campaign.ts` · `journey_step_campaigns` PK(journey_id, step_id, send_date) · created_at). 결과 집계는 그 캠페인으로 낸다(`smsCampaignCountsSafe` · 옛 결과 안내도 같은 함수).

### 1-4 알림 기본값(첫 · 마지막 칸) 세 벌

| 자리 | 판정 |
|---|---|
| 2시간 전 안내 `journey-pretest-scan.ts:43` `resolveNotify` | `step_order === 1 \|\| step_order === 모든 칸 수`(기다림 · 조건 칸 포함) |
| 결과 안내 `campaign-sync-worker.ts:207~211` | `step_order === 1 \|\| step_order === 메시지 칸 수` |
| 화면 `JourneyStepNotifyToggle.tsx:50` · `JourneyWorkspace.tsx:997` | `stepOrder === 1 \|\| stepOrder === 메시지 칸 수` |

기다림 칸이 앞에 있으면(1 기다림 · 2 문자 · 3 문자) 2시간 전 안내는 3만 켜고(모든 칸 수 3), 결과 안내 · 화면은 2만 켠다(메시지 칸 수 2 · 「1번」이 기다림이라 첫 메시지 칸 2 를 「마지막」으로 읽음). 같은 칸 토글 하나가 두 안내에서 다르게 움직이고, 화면 「기본(켬)」 표시가 2시간 전 안내와 다르다.

### 1-5 화면 · 서버 약속 문장

- `JourneyStepNotifyToggle.tsx:87` 「담당자 알림(보내기 2시간 전 · 보낸 결과)」 · 알림톡 칸에도 같은 글(알림톡은 스캔 대상이 아니다 · 2시간 전 안내 0).
- `JourneyActivationConfirmModal.tsx:422` 「보내기 2시간 전에는 담당자에게 확인 문자를 보내요.」
- `JourneyMessageEditModal.tsx:187` 「단 2시간 이내로 예정된 발송에는 재검사 전에 적용될 수 있으니」(1019 B-1009-6 뒤로 틀린 말 · 실행기가 재검사 전 문안을 미룬다).
- `content/plan-feature-intros.ts:130` 「단계마다 보내기 2시간 전에 검사합니다」.
- 멈춤 사유 원문 「발송 2시간 전 스팸필터 …」(`journey-pretest-notifier.ts:156 · 173 · 209 · 220 · 234`) · 화면 문장은 `journey-pause-reason.ts` 가 `/검사 장애/` · `/스팸필터/` 로 가른다(원문 글자 「2시간」은 판정에 안 쓴다).

### 1-6 돈

- 여정 스팸 검사 = 선불 차감(`runStepSpamTest` · `skipPrepaid: false` → `spam-test-queue.ts:445` `prepaidDeduct`). AI 다시 쓰기(걸렸을 때만 1크레딧)는 별개.
- 지금 늦게 나가는 칸은 보내는 날마다 검사 1회가 차감된다. 바로 보내는 칸 · 날짜 기준 여정은 켤 때 검사 뒤로 차감이 없었다(검사도 없었다).

## 2. 설계

### 2-1 그날 검사 판정 = 한 조각 (`journey-pretest-notifier.ts`)

- `PRETEST_DONE_STATUSES = ['notified', 'cancelled']` · 「그 여정 · 그 칸 · 그 날 검사를 마쳤다」 SQL 조각을 만드는 함수 하나 `pretestDoneSql(journeyExpr, stepExpr, dayExpr)`.
  - `notified` = 통과하고 안내까지 끝(안내가 필요 없는 묶음 포함) · `cancelled` = 보낼 글이 없음 또는 검사 장애 상한 뒤 「켤 때 통과한 글 그대로」(지금 스캐너의 뜻 그대로).
  - `pending` = 검사는 통과 · 안내 전(2-8). 마친 것이 아니다(관문이 기다린다 · 스캔이 다시 집어 안내만 한다).
  - `paused` 는 마친 것이 아니다 → 멈췄던 여정을 같은 날 다시 켜면 다시 검사한다(지금은 상태 무관 존재라 A/B 차단으로 멈춘 날 다시 켜면 검사 없이 나갔다 · 같은 뿌리).
  - 상태 칸 = `varchar(20) DEFAULT 'pending'`(`migrations/D218-journey-pretest-tables.sql:35` · 주석 = pending / notified / cancelled · 운영은 `paused` 도 쓴다) · `pending` 을 읽는 코드 0(1031 grep) → 새 상태 값 0(시도 수 칸은 DDL-2 · 2-8).
- 스캔 후보의 「그날 처리함」(70~72줄)과 실행기 관문(2-2)이 이 함수만 쓴다.
- 앞보기 창 `PRETEST_LEAD_HOURS = 2` 를 내보낸다. 스캔 SQL(63줄) · 날짜 기준 선생성(2-3)이 같은 상수.

### 2-2 실행기 관문 = 보내는 날 검사 기록 (`journey-executor.ts` 재검사 전 관문 자리)

- 지금 관문 조회(704줄)에 `checked_today` 를 더한다 = `pretestDoneSql(여정, 칸, 오늘 KST)`.
- 문자 칸이고 발송 시간 안이고 `checked_today` 가 거짓이면 미룬다 → `'waited'`.
  - 미룰 시각 = 지금 + 10분(`PRETEST_PENDING_RECHECK_MINUTES` 그대로) · 그 시각이 발송 시간 밖이면 **다음 발송 창 시작**(실행기 `computeNextSendWindow` · 발송 시간 검사가 옮기는 자리와 같은 함수). 20:54 에 미루면 21:04(밖) → 다음 날 08시 → 그날 검사비 0 · 다음 날 06시 스캔이 그 날짜로 검사(Codex 1R ④).
  - 지금이 발송 시간 밖이면 이 관문은 미루지 않는다 → 뒤의 발송 시간 검사(755줄)가 다음 창으로 옮긴다 → 06시부터 스캔 창.
  - 미룬 실행은 앞날이 되어 다음 스캔(5분)이 검사 · 안내 · 기록한다(2-8) → 마침 기록이 생기면 다음 실행기 회차가 보낸다.
- 결과: 바로 보내는 칸은 **보내는 날 첫 발송만** 검사 시간만큼(10~20분) 늦게 나가고, 그 전에 담당자 안내가 간다. 그날 그 칸 두 번째 고객부터는 기록이 있어 바로 나간다. 그날 첫 발송이 20:50 뒤면 다음 날 08시 뒤로 간다(검사 없이 보내지 않는다).
- 늦게 나가는 칸은 2시간 전 스캔이 이미 기록을 남겨 바뀜 0. 스캔이 놓친 발송(앞보기 창 300묶음 넘침 · 워커 정지)도 이제 검사 없이 나가지 않는다.
- 묶음이 오래 막힌 것을 사람이 알게: 실행기가 묶음(여정 · 칸 · 날)마다 처음 미룬 시각을 프로세스 메모리에 두고(통과하면 지움 · 지난 날 키 버림), 같은 묶음을 30분 넘게 미루면 운영 경보(`sendSystemAlert` · 회사 = 그 실행의 회사 · 중복 키 = 여정마다 · 재검사 전 경보와 같은 꼴). 스캐너가 멈췄을 때 · 그 묶음 처리만 계속 실패할 때를 둘 다 잡는다(Codex 1R ①).

### 2-3 날짜 기준 여정 = 2시간 앞서 실행 행 (`journey-anchor-scheduler.ts`)

- 칸 발송 판정을 `now >= runAt` → `now >= runAt - PRETEST_LEAD_HOURS` 로(같은 날 · 날짜 판정 128줄 그대로). `nextRunAt` 은 지금 식 그대로(`now >= runAt ? shiftToSendableHour(now) : runAt` → 앞서 만들면 `runAt`).
- 「그날 그 칸 처리함」 = **결과에서 끌어낸다**(Codex 1R ② · 2R):
  - 뽑아 넣음 = `journey_anchor_dispatch` 에 (여정 · 칸 · 발송일) 행이 하나라도 있음(DB · PK 앞부분 = journey_id · step_id) → 다시 뽑지 않는다.
  - 대상 0 = 메모리에만 그날 기억(행이 없으므로 · 30분마다 무거운 추출을 되풀이하지 않게 · 재시작하면 한 번 더 뽑는다 = 지금과 같다 · 그때 생긴 대상은 정한 시각 · 검사 · 안내를 그대로 받는다).
  - 상한 초과로 여정을 멈춤 · 넣기 관문에서 꺼짐(`lockEntryIfActive` 실패) = **아무것도 기억하지 않는다** → 같은 날 다시 켜면 그 프로세스에서 바로 다시 뽑는다.
  - `dispatchAnchorStep` 이 결과 종류를 돌려준다(`dispatched` · `no_target` · `capped` · `not_active`) · 메모리 기억은 `no_target` 만.
  - 옛: 메모리 표식을 결과와 상관없이 찍어 ① 재시작 뒤 다시 뽑아 그사이 새로 맞은 고객을 더하고 더한 합이 상한을 넘으면 여정을 멈춰 이미 잡아 둔 발송까지 막았고(2시간 앞당기면 창이 길어진다) ② 상한 초과로 멈춘 날 같은 날 다시 켜도 뽑지 않았다.
- 그러면 스캔이 2시간 전 검사 · 안내를 그대로 하고, [이 발송 정지]가 멈출 실행이 생기고, 정한 시각에 나간다(30분 늦음도 없어진다).
- 대상 확정 = 보내기 2시간 전. 그 뒤 조건에 새로 맞는 고객은 그날 빠진다. 수신거부 · 동의 · 휴면은 실행기가 보내기 직전 다시 막는다(`journey-executor.ts` 3 · 4단계 · 지금 그대로).
- 켠 시각이 `runAt - 2시간` 뒤이고 `runAt` 전이면 그 회차에 만든다(앞날 = 스캔). `runAt` 뒤에 켜면 지금과 같이 즉시 = 2-2 관문.
- 다시 켜기(`journey-resume.ts`): 날짜 기준 여정은 지난 날(KST)의 진행 중 실행을 끝낸다(`RESUME_STALE_ANCHOR_SQL` · status `ended` · completed_at). 앞서 만든 실행이 멈춘 사이 날이 지나 다시 켠 순간 늦게 나가는 것을 막는다(날짜가 뜻 · 지금 주석의 원칙). 같은 날 다시 켜면 그대로.
- 한 번 보내기는 바꾸지 않는다(예약 = 이미 앞날 실행 · 즉시 = 2-2 관문).

### 2-4 안내 문장 (`journey-pretest-notifier.ts`)

- 제목 = 「[발송 전 안내]」(통과) · 「[발송 전 자동 보정 안내]」 · 「[발송 정지 안내]」. 본문 머리도 같다. 「발송 예정: 시각」 줄 그대로.
- 바로 보내는 칸이면 한 줄을 더한다: 「바로 보내는 칸이라 오늘 이 칸에 닿는 고객에게 이어서 나갑니다. 오늘 남은 발송까지 멈추려면 링크에서 여정 전체 일시정지를 눌러 주세요.」 판정 = 시작 종류가 단발(날짜 기준 · 한 번 보내기)이 아니고, 칸 대기가 `relative` · 0시간.
- 멈춤 사유 원문의 「발송 2시간 전 스팸필터」 → 「발송 전 스팸필터」(판정 정규식 `/검사 장애/` · `/스팸필터/` 그대로 맞음) · 운영 경보 문장(165줄 「여정 발송 2시간 전 스팸 검사를」) → 「여정 발송 전 스팸 검사를」.

### 2-5 알림 기본값 = 한 함수 (`utils/journey-step-notify.ts` 새 CT)

- `isStepNotifyOn(flag, stepOrder, firstMessageOrder, lastMessageOrder)`: true = 켬 · false = 끔 · null = 첫 메시지 칸이거나 마지막 메시지 칸이면 켬(메시지 칸 = `step_type` 비었거나 `message` · 채널 무관).
- 메시지 칸 첫 · 끝 번호 SQL 조각 하나(`messageStepBoundsSql(journeyExpr)` = MIN · MAX step_order).
- 스캔(`journey-pretest-scan.ts` `resolveNotify` 삭제) · 결과 안내(2-6) · 화면(`frontend/src/utils/journey-step-notify.ts` 같은 함수 · 대조 시험)이 이것만 쓴다.

### 2-6 보낸 결과 안내 = 칸 · 날짜 단위 (`utils/journey-result-notice.ts` 새 CT · `campaign-sync-worker.ts` 는 부르기만)

- 단위 = `journey_step_campaigns` 한 행(여정 · 칸 · 발송일). 기록 칸 셋을 더한다(DDL-1): `result_notice_sent integer`(안내에 담은 보낸 수) · `result_notice_at timestamptz` · `result_notice_attempts smallint`(아래 보내기).
- 후보 = 발송일이 오늘 · 어제 · 그제(KST)이고 보낸 수(캠페인 `sent_count`) > `COALESCE(result_notice_sent, 0)` 인 행.
- 판정(순수 함수 `decideResultNotice`):
  - 알림 꺼짐(2-5) = 보내지 않고 기록만(`result_notice_sent = sent_count` · 후보에서 빠진다 · 매 회차 같은 행이 앞자리를 차지하지 않게 · R8). 켜면 그 뒤 보낸 몫부터(다음 날 하루 합계).
  - **첫 안내**(`result_notice_at IS NULL`): 발송일 = 오늘이면 그날 그 칸 진행 중 실행 0(`dueExecutionsSql` · 정지 화면과 같은 조각 = 예정분이 다 나감) + 결과를 셀 수 있고 대기 0 · 발송일 < 오늘이면 지금 KST 가 발송 시간 시작(08시) 뒤(대기 · 셀 수 없음은 그대로 밝힘).
  - **하루 합계**(`result_notice_at IS NOT NULL`): 발송일 < 오늘 · 08시 뒤 · 보낸 수 > `result_notice_sent`.
  - 둘 다 아니면 다음 회차. 「마지막 발송 시각」으로 기다림을 자르지 않는다(그 시각을 담은 칸이 없다 · 캠페인 `updated_at` 은 결과 동기화 여러 곳이 바꾼다 · `journey_step_logs` 는 캠페인 기준 색인이 없다) → 결과가 끝내 안 오면 다음 날 아침 대기 수를 밝혀 보낸다.
- 소급 막기 = DDL-1 기준선(§8 · 있던 행 = 이미 알림) · 이틀 창.
- 보내기 = 2-8 과 같은 꼴 `sendNoticeOnce`: ① 시도 잡기 `SET result_notice_attempts = result_notice_attempts + 1 WHERE (pk) AND result_notice_sent IS NOT DISTINCT FROM $읽은값 AND result_notice_attempts < 3` → ② 적재(`bulkInsertSmsQueue` · 대표번호 · 상한 있는 연결) → ③ 성공이면 `SET result_notice_sent = $새값, result_notice_at = NOW(), result_notice_attempts = 0 WHERE (pk) AND result_notice_sent IS NOT DISTINCT FROM $읽은값`. 시도를 다 쓴 단계 = 보내지 않고 ③ 과 같이 기록 + 경보(그 단계 포기 · 다음 단계는 시도 0 부터). 옛 결과 경로의 「표시 먼저 · 되돌림」은 이 꼴로 바뀐다(안내 쓰기 한 꼴 · R1).
- 시도 칸 = DDL-1 에 `result_notice_attempts smallint NOT NULL DEFAULT 0` 를 함께 더한다.
- 본문: 「[여정 발송 결과]」 · 여정 · `step N / M`(M = 메시지 칸 수) · 날짜 · 보낸 수 · 성공 / 실패 / 대기 · (하루 합계면) 「어제 하루 합계입니다.」 · 마지막 칸이면 「여정 마지막 칸입니다.」 아니면 「다음 칸은 정한 때에 이어서 나갑니다.」
- 받는 사람 = `pickOwnerContact`(지금 그대로).
- 칸 기록이 없으면(배포 뒤 DDL-1 전) 결과 안내 회차를 건너뛰고 5분마다 한 줄 경고(옛 경로로 돌아가지 않음 · 소급 · 중복 0). 칸 확인 = `lineageColumnsReady` 와 같은 꼴(참 기억 · 거짓 5분 · 조회 오류는 던짐).
- 옛 경로 삭제: `notifyJourneyResultsToManagers` · `journey_executions.result_notified_at` 쓰기(칸은 남김 · 읽는 곳 0).
- 횟수: 칸 · 날짜당 최대 2통(첫 안내 · 하루 합계). 지금은 마지막 칸이 끝나는 회차마다 1통(하루 종일 들어오는 여정은 5분마다).

### 2-7 화면 · 서버 문구

- `JourneyStepNotifyToggle.tsx`: 채널 · 메시지 칸 첫 · 끝 번호를 받는다(`JourneyWorkspace.tsx` 가 넘김).
  - 문자 칸 머리 = 「담당자 알림(보내기 전 · 보낸 결과)」 · 알림톡 칸 = 「담당자 알림(보낸 결과)」.
  - 아래 줄(문자 칸) = 「보내기 2시간 전에 안내해요. 바로 보내는 칸은 그날 첫 발송 전에 스팸 검사를 하느라 그날 첫 발송이 10~20분 늦어지고, 안내는 그 검사 뒤에 와요.」 · 공통 = 「보낸 결과는 그날 이 칸 발송이 끝나고 결과가 다 나오면 와요. 하루 내내 이어서 나가는 칸은 다음 날 아침에 하루 합계가 한 번 더 와요.」 · 기본 줄 = 「기본은 첫 메시지 칸과 마지막 메시지 칸만 켜요.」
  - 「기본(켬/끔)」 = 2-5 화면 함수.
- `JourneyActivationConfirmModal.tsx:422` → 「문자 칸은 보내기 전에 스팸 검사를 다시 하고 담당자에게 확인 문자를 보내요(보통 2시간 전 · 바로 보내는 칸은 그날 첫 발송 10~20분 전).」
- `JourneyMessageEditModal.tsx:187` → 「운영 중 여정입니다. 저장하면 새 문안이 바로 적용되고, 문자 칸은 스팸 검사를 다시 통과한 뒤에 나가요. 검사하는 동안 발송이 잠시 미뤄질 수 있어요.」
- `content/plan-feature-intros.ts:130` → 제목 「보내기 전 스팸 검사」 · 「단계마다 보내기 전에 검사합니다(보통 2시간 전 · 바로 보내는 단계는 그날 첫 발송 전).」 뒤 문장 그대로 · 「(기본은 첫 단계와 마지막 단계)」 = 메시지 단계.

### 2-8 스캔 묶음 처리 = 검사 · 기록 · 안내를 단계로 나눈다 (`journey-pretest-notifier.ts` · Codex 1R ① ③)

- 지금: 통과 → (알림이면) 안내 → `notified` 기록이 한 덩어리다. 안내 적재가 0건이어도 `notified`(135~139줄)라 관문이 「안내 뒤 발송」을 믿을 수 없고, 기록 INSERT 가 실패하면 묶음 예외 로그만(237~239줄) 남아 다음 회차가 같은 묶음을 다시 유료로 검사한다(상한은 검사 장애만 센다).
- 새 구조 = **묶음 상태표**. 회차마다 그날 그 묶음의 기록(가장 최근 행)과 스냅숏 검사 표식을 읽고, 그 상태에서 할 일 하나를 정한다(서술형 「몇 번으로 건너뜀」 없음 · Codex 2R):

| 상태 | 이번 회차 할 일 |
|---|---|
| 기록 없음 · 또는 스냅숏 검사 전(100 아님) | 검사 → 통과 = **판 확인 쓰기**(아래)로 스냅숏 100 · `pending` INSERT → 같은 회차에 아래 `pending` 줄을 이어서 한다 / 장애 · 차단 = 지금 갈래 그대로(그 기록도 판 확인 쓰기) |
| `pending` · 스냅숏 100 | **안내 필요를 매번 다시 판단**(알림 설정 · 시연 회사 · 받을 담당자 · 번호 형식) → 불필요 = `pending`→`notified` · 필요 = `sendNoticeOnce`(아래) → 적재 성공 = `pending`→`notified` · 실패 = `pending` 그대로(다음 회차) · 시도 3회를 다 쓴 `pending` = `notified` 로 올리고 운영 경보(검사 통과 · 담당자 안내 못 보냄 · 발송 진행 · K7) |
| `notified` · `cancelled` | 후보 아님(2-1) |
| `paused` | 여정이 멈춰 후보 아님 · 다시 켜면 「기록 없음」처럼 검사 |

  - **안내 쓰기 = 한 꼴 `sendNoticeOnce`(새 CT · 잠금 없음 · Codex 5R)**: ① 시도 잡기 = 조건부 UPDATE 하나 `SET notice_attempts = notice_attempts + 1 WHERE id = $1 AND status = 'pending' AND notice_attempts < 3 RETURNING` (DB 에 남는 시도 수 · 0행 = 상태가 바뀌었거나 시도를 다 씀 → 보내지 않음) → ② 인증 라인 적재(상한 있는 MySQL 연결 · 아래) → ③ 성공이면 `SET status = 'notified' WHERE id = $1 AND status = 'pending'`. 관문(2-2)은 ③ 뒤에야 열린다 → 고객 문자가 안내보다 먼저 나가는 갈래 0(3R). 시도 수는 적재 **전에** DB 에 남으므로 재시작 · ③ 실패 · 늦게 들어간 적재가 있어도 같은 묶음 안내는 **많아야 3통**(5R ②).
  - 시도를 다 쓴 `pending`(③ 이 끝내 안 됨 · 적재 실패 3회) = 다음 회차가 `notified` 로 올리고 운영 경보(K7).
  - 잠금을 쥐지 않으므로 칸 수정의 기록 DELETE 는 기다리지 않는다(DELETE 가 먼저면 ① · ③ 이 0행 = 보내지 않거나 기록만 빠짐 · 다음 회차가 새로 본다).
  - 3통 상한의 단위 = **그 기록 행 = 그 문안 판**. 기록 행을 지우는 곳은 사람이 켜진 여정의 칸 문안을 고치거나(`journey-builder.ts:1428` · 켜짐 + 문안 키가 있을 때만 · 1394줄) 칸을 지울 때(`:1930`)뿐이고, 고치면 새 문안이 다시 검사되고 그 안내는 새 문안의 첫 안내다(시도 0부터 · 사람이 고친 횟수만큼만 늘어난다). 옛 판의 ③ 은 `id` 조건이라 새 판 행을 완료로 만들지 못한다(세대 조건 = 행 id · Codex 6R).
  - **판 확인 쓰기 `recordIfCurrent`**(Codex 8R): 스캔이 남기는 기록 쓰기 전부(통과 `pending` · 자동 보정 `notified` · 멈춤 `paused` · 접음 `cancelled` · 스냅숏 검사 표식 100 · 자동 보정 본문)를 이 함수 하나로. 짧은 `withTransaction` 안에서 ① 문안 수정 경로와 같은 `journeys` 행을 `FOR UPDATE`(수정 경로 `withJourneyValidationReset` 이 먼저 잡는 행 · 잠그는 순서가 같아 서로 막혀 꼬이지 않는다) ② 그 칸의 최신 스냅숏 id 가 이번에 검사한 스냅숏 id 와 같은지(스냅숏 없이 검사한 묶음 = 둘 다 없음) ③ 같을 때만 표식 · 본문 · 기록을 함께 쓰고 커밋 · 다르면 아무것도 안 쓰고(옛 판 결과 버림 · 로그 한 줄) 다음 회차가 최신 판을 본다. 스팸 검사 · AI 다시 쓰기 · MySQL 안내 적재는 이 잠금 밖. 여정 멈춤(`pauseJourney`)은 지금처럼 판과 상관없이 한다(덜 보내는 쪽).
    - 그래서 수정 커밋 뒤에 생기는 기록은 언제나 최신 판을 검사한 것이다 → 「기록 행 = 문안 판」이 지우기(아래)와 쓰기 양쪽에서 성립(옛 판의 `notified` · `cancelled` 가 새 판의 관문을 여는 갈래 0).
  - **문안 수정의 기록 지우기 = 새 스냅숏과 같은 트랜잭션**(Codex 7R): 지금 1428줄 DELETE 는 문안 · 스냅숏 트랜잭션(`withJourneyValidationReset` · 1406~1416줄)이 커밋된 **뒤** 따로 돌고 실패는 로그만 남긴다(1427~1430). 그 틈에 스캐너가 새 판을 검사 · 기록 · 안내하면 뒤늦은 DELETE 가 새 판 기록을 지워 같은 판을 다시 유료 검사하고 다시 안내한다(지금 코드에도 있는 경합). → DELETE 를 그 콜백 안 `createStepSnapshot` 바로 뒤로 옮긴다(`run` · 실패 = 문안 저장도 되돌림 · 새 문안 공개와 옛 기록 무효화가 한 번에 보인다). 칸 삭제(1930)는 칸이 사라져 새 판이 없으므로 그대로 둔다.
  - **MySQL 적재 상한**(MySQL 풀은 질의 시간 상한이 없고 `waitForConnections: true` = `config/database.ts:88~97` · mysql2 3.24.6 의 질의 시간 상한은 오류만 내고 연결을 끊지 않는다 = `node_modules/mysql2/lib/commands/query.js:354~368`): 새 CT `withBoundedMysql(timeoutMs, work)`(`config/database.ts`) = 풀에서 연결 하나를 상한 안에 받고(늦게 오면 받자마자 끊음) · 그 연결로만 실행 · 상한(20초 `NOTICE_ENQUEUE_TIMEOUT_MS`)을 넘기면 그 연결을 `destroy()`(풀에서 빠짐 · 풀은 새로 연다) → 멈춘 적재가 공용 발송 풀 10개를 쌓아 막지 않는다(5R ①). `bulkInsertSmsQueue` 에 실행기 선택 인자(`opts.run`)를 더해 여정 담당자 안내(스캐너 안내 전부 · 결과 안내)만 이 연결을 넘긴다(금칙어 탐지 · 시연 회사 막기 · 라인 나누기 = 그 함수 그대로 지난다 · 기본값 = 지금처럼 `mysqlQuery` · 다른 소비처 바뀜 0).
  - 남는 갈래 = 상한 뒤 서버 쪽 INSERT 가 늦게 끝남 · ③ 실패 → 다음 회차가 시도를 하나 더 써서 한 번 더(많아야 3통 · 중복 쪽 · 발송을 막지 않음). 진실이 두 곳(PG 관문 · MySQL 큐)이라 한 번에 묶을 수 없다 → 지킬 불변식(고객 문자보다 안내가 먼저 · 안내 3통 상한)을 고르고 나머지(드문 한 통 더)를 받아들인다.
  - 시도 칸 = DDL-2 `journey_pretest_schedules.notice_attempts smallint NOT NULL DEFAULT 0`(§8 · 배포 전 · 옛 코드 INSERT 는 칸을 적어 넣으므로 기본값 0 · 의미 바꿈 0). 칸이 없으면(DDL-2 를 빠뜨림) 안내 시도 없이 `notified` 로 올리고 6시간에 한 번 운영 경보(발송을 막지 않고 중복도 없다 · 칸 확인 = `lineageColumnsReady` 꼴).
  - 같은 날 `pending` 행은 하나: INSERT 는 「기록 없음」 상태에서만(한 프로세스 · 스캔 워커 달리는 중 가드).
  - 동시 실행: 시도 잡기는 순서와 상한만 지키고 동시에 두 손이 같은 행을 잡는 것은 막지 않는다. 스캔 · 결과 안내 워커는 둘 다 한 프로세스(PM2 fork 하나) 안의 「달리는 중」 가드로 한 번에 하나만 돈다 → 동시 두 손 0. 프로세스가 둘이 되면 같은 안내가 상한(3) 안에서 두 통 갈 수 있다(받아들임 · 운영 배치가 바뀌면 다시 본다). 상태를 읽는 「가장 최근 행」 = 그 여정 · 칸 · 날짜(`scheduled_send_at` 의 KST 날짜) 행을 `notify_at DESC, id DESC`(운영 INSERT 가 `notify_at = NOW()` 를 넣는다 · `created_at` 은 운영 INSERT 가 쓰지 않아 기대지 않는다).
  - 옛 판 결과를 버리면 그 검사비 · AI 다시 쓰기(차단 때 1크레딧)도 버려진다(검사 도중 사람이 문안을 고친 드문 경우 · 고친 문안을 다시 검사하는 것이 맞다 · 받아들임).
  - **스캐너 안의 기다림 상한**(구조체크 2회차): 이제 스캐너가 모든 여정 문자 발송의 관문이라 스캐너가 멈추면 문자 발송이 묶인다. 그래서 스캐너의 안내 적재는 갈래 없이 전부(통과 안내 `sendNoticeOnce` · 정지 안내 · 자동 보정 안내 = `notifyManagerForStep` 한 곳) `withBoundedMysql` 를 지난다(옛: 정지 · 자동 보정 안내는 상한 없는 공용 풀 경로 = MySQL 이 멈추면 회차가 멈췄다). 스팸 검사 결과 기다림 = 30초 상한(`pollSpamResult` · 지금 그대로) · AI 다시 쓰기 = SDK 기본 요청 상한 10분(`@anthropic-ai/sdk/client.js:518` · `openai/client.js:543` · 차단된 글에서만).
  - **스캐너 회차 길이 = 바로 칸의 첫 발송 늦음**: 묶음을 차례로 처리하므로 한 회차가 길면(검사 하나 = 많아야 30초) 그사이 미룬 바로 칸은 다음 회차를 기다린다. 후보 순서는 `next_run_at` 이른 순(지금 그대로)이라 미룬 바로 칸(지금 + 10분)이 2시간 앞 묶음보다 먼저 선다. 측정 = 회차가 끝날 때 로그 한 줄에 걸린 시간 · 묶음 수를 더한다(측정 뒤 처방 · 병렬 검사는 지금 하지 않는다). 안전망 = 실행기 묶음 30분 경보(2-2).
- 묶음 처리 예외(기록 INSERT · UPDATE 실패 등)도 묶음마다 센다 → 3회째면 그날 그 묶음을 더 처리하지 않고 운영 경보(유료 재검사 반복 0 · 관문은 계속 미루고 실행기 묶음 경보도 뜬다 · R8).
- 셈 두 가지: 안내 시도 = DB(`notice_attempts` · 재시작에도 남음 · 고객 · 담당자에게 보이는 중복을 막는 셈) · 검사 장애 · 묶음 예외 = 지금 `_checkErrors` 와 같은 프로세스 메모리 지도(키 = 갈래 · 묶음 · 지난 날 키 버림 · 재시작하면 0부터 = 검사를 몇 번 더 볼 뿐 · 지금 규약 그대로).
- 자동 보정 · 정지 갈래 = 흐름은 지금 그대로(자동 보정은 안내 성공 뒤에만 본문을 바꾸고 `notified` · 안내 실패면 여정 정지 · 정지 갈래 = `paused`) · 기록 · 본문 쓰기 = 판 확인 쓰기 · 안내 적재 = 상한 있는 연결(위 두 줄).
- 스캔 후보 SQL 은 `pending` 기록만 있는 묶음을 다시 집는다(2-1 조각이 `pending` 을 마침으로 안 본다).

## 3. 영향표 (읽기 · 쓰기 · 화면)

| 자리 | 읽기/쓰기 | 바뀜 |
|---|---|---|
| `journey-pretest-notifier.ts` 스캔 후보 SQL | 읽기(`journey_pretest_schedules`) | 「그날 처리함」 = 2-1 조각(`paused` 는 처리 아님) · 앞보기 창 상수 · 칸 대기 · 시작 종류 · 메시지 칸 첫 · 끝 번호를 더 읽음 |
| 같은 파일 `recordSchedule` · `markSnapshotChecked` · 자동 보정 본문 UPDATE · 통과 갈래 | 쓰기 | 전부 판 확인 쓰기 `recordIfCurrent` 하나로(journeys 행 잠금 · 최신 스냅숏 확인 · 2-8) · 통과 = `pending` INSERT → 안내 뒤 `notified` UPDATE · 그 밖 갈래 상태 값 그대로 · 새 상태 값 0 |
| 같은 파일 안내 제목 · 본문 · 멈춤 사유 원문 | 쓰기(문자 · journeys.pause_reason) | 2-4 |
| `journey-pretest-scan.ts` `groupPretestBundles` | 순수 | 알림 판정 = 2-5 · 행 모양에 첫 · 끝 번호 · 바로 칸 표식 |
| 알림 기본값(null) 동작 | 안내 · 결과 | 「첫 · 마지막 **메시지** 칸」으로 하나 → 기다림 · 조건 칸이 앞이나 뒤에 있는 여정은 기본값으로 안내 · 결과를 받는 칸이 바뀐다(예: 1 기다림 · 2 문자 · 3 문자 = 옛 2시간 전 안내 3만 · 옛 결과 안내 2만 → 둘 다 2 · 3). 화면 「기본(켬/끔)」 표시도 같은 답 |
| `journey-executor.ts` 관문(704줄 자리) | 읽기 · 쓰기(next_run_at) | 2-2 |
| `journey-anchor-scheduler.ts` 칸 발송 판정 | 쓰기(실행 · dispatch · stats) | 2-3 시각 · 「그날 처리함」 = 결과에서(`journey_anchor_dispatch` 행 존재 읽기 추가 · `dispatchAnchorStep` 결과 종류 · 메모리 = 대상 0 만) · 추출 · 상한 · 넣기 문장 그대로 |
| `journey-resume.ts` `applyResumeAdjustments` | 쓰기(실행 status) | 날짜 기준이면 지난 날 실행 끝냄(되살리기 · 커서 문장 그대로) |
| `journey-pause-handler.ts` `DUE_EXECUTIONS_SQL` · 정지 화면 | 읽기 | 상수 → 조각 함수 `dueExecutionsSql(여정, 칸, 날)`(정지 화면 조회 · 잠금은 `$1 · $2 · $3` 으로 같은 글 · 결과 안내가 같은 함수) · 앞서 만든 날짜 기준 실행 · 미룬 바로 칸 실행이 이 조회에 잡힘(바라던 바) |
| `campaign-sync-worker.ts` 결과 안내 | 읽기 · 쓰기 | 옛 함수 삭제 → 2-6 CT 부르기 |
| 새 `utils/journey-notice-once.ts` `sendNoticeOnce` | 쓰기(시도 칸 · 기록 · 인증 라인 적재) | 2-6 · 2-8 이 같이 쓴다(잠금 없음 · `bulkInsertSmsQueue` 재사용 · 새 적재 함수 0) |
| `utils/sms-queue.ts` `bulkInsertSmsQueue` | 쓰기(큐) | 선택 인자 `opts.run`(그 배치 INSERT 를 실행할 함수) · 없으면 지금처럼 `mysqlQuery` · 소비처 17곳 = 인자를 안 넘김 → 바뀜 0 · 금칙어 탐지 · 시연 막기 · 라인 나누기 · 실패 배치 미집계 그대로 |
| `config/database.ts` 새 `withBoundedMysql` | MySQL 연결 | 여정 담당자 안내(스캐너의 통과 · 정지 · 자동 보정 안내 · 결과 안내)만 씀 · 공용 풀 설정 그대로 |
| `journey_pretest_schedules` | 쓰기(새 칸) | DDL-2 `notice_attempts`(배포 전 · 기본값 0) · 옛 INSERT(`recordSchedule`)는 칸 이름을 적어 넣어 바뀜 0 |
| `journey_step_campaigns` | 쓰기(새 칸 셋) | DDL-1 · 기존 쓰기(`getOrCreateStepCampaign` INSERT)는 칸 이름을 적은 INSERT 라 바뀜 0 · 읽는 곳 = `journey-step-campaign.ts`(campaign_id 조회 둘) · `copy-label-sweeper.ts:60`(조인 · 칸 지정) = 새 칸을 안 읽음 · `SELECT *` 0 |
| `journey_executions.result_notified_at` | 쓰기 | 쓰는 곳 0 이 됨(칸은 남김) |
| `journey-builder.ts` 1428 칸 문안 수정 때 처리 기록 지움 | 쓰기 | 커밋 뒤 따로 → 스냅숏 트랜잭션 안(2-8 · 실패 = 문안 저장도 되돌림 · 옛: 로그만) · 지우면 2-2 관문이 다시 검사를 기다린다 = 바라던 바 |
| `journey-builder.ts` 1930 칸 삭제 때 처리 기록 지움 | 쓰기 | 0 |
| 정지 화면 `JourneyPausePage.tsx` | 화면 | 0 |
| `JourneyStepNotifyToggle.tsx` · `JourneyWorkspace.tsx` · `JourneyActivationConfirmModal.tsx` · `JourneyMessageEditModal.tsx` · `content/plan-feature-intros.ts` | 화면 · 소개 글 | 2-7 |
| 기존 시험(구현 때 판정 그대로 새 자리로) | 시험 | `journey-pause-link-1018`(본문 제목) · `bug-1028-tickets`(받는 사람 함수 · 결과 안내 자리) · `tier3-e-rest-0927`(옛 `result_notified_at` 되돌림 문장) · `journey-v3-resume-1020`(보정 문장 순서 · 날짜 기준 줄) · `journey-pretest-scan.verify`(기본값) · `journey-structure-check-1025` · `journey-zero-defect-1023` · `bug-sweep-1019` · `codex-1r-fixes-1018` · `tier4-worker-0928` · `root-ledger`(R1 · R25 경보 회사 · R30) |
| 선불 | 돈 | 바로 보내는 문자 칸 · 날짜 기준 문자 칸 = 보내는 날마다 검사 1회 차감(늦은 칸과 같다 · §1-6 · §7 K5) |

## 4. 뿌리

- **R30 신설 「칸 관문 · 안내가 그 칸 발송이 아닌 사건에 걸림」**: 여정 문자 칸의 보내기 전 검사 · 담당자 안내는 「앞으로 나갈 발송을 내다보는 스캔」에, 보낸 결과 안내는 「고객이 여정을 다 마침」에 걸려 있었다. 그래서 내다보기 창 밖에서 생기는 발송(바로 · 날짜 기준)은 검사 · 안내 없이 나가고, 중간 칸 결과는 오지 않았다. 판정 기준:
  1. 여정 문자 칸 발송은 보내는 날 그 칸 검사 기록(2-1 조각)이 있을 때만 나간다 · 그 판정은 발송 자리(실행기)가 한다.
  2. `journey_pretest_schedules` 를 읽는 SQL 은 2-1 함수만 쓴다(상태 목록을 SQL 에 직접 적지 않는다 · R1).
  3. 칸 결과 안내 후보 = 칸 · 날짜 단계 캠페인(실행 완료 상태로 고르지 않는다).
  4. 알림 기본값 계산 = 2-5 함수 하나(서버) · 화면 같은 함수(대조 시험).
- 계약 시험(기계로 뽑음 · `root-ledger.test.ts` R30):
  - 여정 문자 발송 자리 = `packages/backend/src` 비시험 `.ts` 중 `INSERT INTO journey_step_logs` 로 `'sending'` 표식을 쓰는 파일 전수(지금 = `journey-executor.ts:1176` 하나 · 표식 확정 · 지우기 CT `journey-send-claim.ts` 는 INSERT 0) → 그 파일이 2-1 함수를 부르고, 관문 판정이 표식 INSERT 보다 앞(같은 함수 안 순서) · 표식을 쓰는 새 파일이 생기면 그 파일도 같은 판정을 받는다.
  - `journey_pretest_schedules` 글자를 담은 SELECT · EXISTS 가 있는 파일 = notifier 한 곳 + 2-1 함수를 import 하는 파일만 · 다른 파일에 `ps.status` · `'notified'` 직접 비교 0.
  - `campaign-sync-worker.ts` · `journey-result-notice.ts` 에 `status = 'completed'` 후보 0 · `result_notified_at` 쓰기 0(backend 전체 · 플래너 `planner_monthly_approvals` 줄은 면제 · 이유 줄).
  - `step_order === 1` · `stepOrder === 1` 꼴 알림 판정 = 2-5 두 파일 밖 0(backend · frontend).
- 같은 뿌리 다른 기능(구조체크 3회차 확인): 대행발송 = 승인 · 만료 판정이 상태가 정하는 리드타임(`agency-send-state.ts:375` `requiredLeadMinutes`)에 걸려 발송 자리에 관문이 있다 = 같은 뿌리 아님. 자동마케팅 · 플래너의 2시간 전 안내 = 각자 예약 원장에서 도는 것까지만 봤고 「예측 창 밖 발송」 갈래 유무는 이번에 코드로 확인하지 않았다 → **미확인 · 추가 과제**(0번 원칙 · 착수 판단 = Harold) · 대장 이력에 그대로 적는다.

## 5. 시험 (빨강 먼저 · 기대값 = 손으로 정한 값)

1. 순수
   - `isStepNotifyOn`: 칸 [1 기다림 · 2 문자 · 3 문자] = 2 켬 · 3 켬 / [1 문자] = 켬 / [1 · 2 · 3 문자] 중간 = 끔 · true · false 우선 / 화면 함수 같은 표(같은 입력 같은 답).
   - `decideResultNotice`: 오늘 · 진행 중 0 · 대기 0 = 첫 안내 / 오늘 · 진행 중 남음 = 기다림 / 오늘 · 대기 남음 = 기다림 / 오늘 · 셀 수 없음 = 기다림 / 어제 · 기록 없음 · 09시 = 첫 안내(대기 · 셀 수 없음 밝힘) / 어제 · 기록 없음 · 07시 = 기다림 / 어제 · 기록 있음 · 더 보냄 · 09시 = 하루 합계 / 하루 합계 07시 = 기다림 / 더 안 보냄 = 후보 아님 / 알림 꺼짐 = 없음.
   - 안내 본문: 제목 「[발송 전 안내]」 · 바로 칸 줄 있음 · 날짜 기준 · 늦은 칸 = 줄 없음 · 링크 없음 줄 그대로.
   - 날짜 기준 발송 판정: runAt 10:00 · now 07:59 = 아님 · 08:00 = 만듦 · next_run_at = 10:00 / now 10:30 = 만듦 · next_run_at = now / 다른 날 = 아님.
   - 미룰 시각: 13:00 → 13:10 · 20:54 → 다음 날 08:00 · 20:49 → 20:59.
   - 스캔 상태표(모의 · 검사 · 적재 함수 셈): 기록 없음 · 통과 · 알림 켬 · 적재 성공 = `pending` INSERT → 적재 → `notified` · 검사 1회 / 적재 0건 = `pending` 그대로 · 다음 회차 검사 0회 · 안내만 / 3회째 실패 = `notified` + 경보 / `pending` 인데 그사이 알림 꺼짐 = 적재 0 · `notified` / 시도 잡기 0행(상태가 다름 · 행 없음 · 시도를 다 씀) = 적재 0 / 기록 INSERT 예외 3회 = 그날 그 묶음 처리 멈춤 + 경보 · 검사 호출 3회 넘지 않음.
   - 날짜 기준 결과 종류: 상한 초과 = 기억 0 → 같은 프로세스에서 같은 날 다시 켜면(여정 active) 다시 뽑음 / 꺼짐 = 기억 0 / 대상 0 = 그날 기억 → 다음 회차 추출 0회 / 뽑아 넣음 = DB 행 → 메모리를 비워도 다시 안 뽑음.
   - 실행기 묶음 경보: 같은 묶음 29분 = 경보 0 · 31분 = 1회 · 통과하면 기억 지움.
2. 실 PG(`journey-step-gate-1031.pg.test.ts`)
   - 2-1 조각: 오늘 `notified` = 참 · `cancelled` = 참 · `paused` = 거짓 · `pending` = 거짓 · 어제 = 거짓 · 다른 칸 = 거짓 · 다른 여정 = 거짓.
   - 날짜 기준 처리함: (여정 · 칸 · 오늘) dispatch 행 있음 = 다시 안 뽑음 · 다른 날만 있음 = 뽑음.
   - 스캔 후보: 오늘 `paused` 기록 + 미룬 실행 = 후보 · `notified` 기록 = 후보 아님(재검사 전 판 예외 그대로).
   - `sendNoticeOnce`(실 PG · 적재 함수와 ③ 실행을 시험이 쥔다): 적재를 붙잡아 둔 동안 2-1 조각 = 거짓(관문 닫힘 · 시도 수는 이미 1) · 적재 성공 뒤 = 참 / 적재 실패 = `pending` · 관문 닫힘 · 시도 1 / 적재 성공 · ③ 이 던지게 주입 → 다음 호출이 시도 2 로 한 번 더 / 「재시작」(메모리 지도 비움)을 끼워 적재 성공 · ③ 실패를 되풀이 = 적재 총 3회 · 넷째 호출 = 적재 0 / 시도를 다 쓴 `pending` = 다음 회차 `notified` + 경보 / 적재 중 칸 수정 경로(`journey-builder` 의 그 DELETE 문장)로 행을 지움 = 기다리지 않고 끝남 · 옛 ③ 0행 · 다음 회차가 새 행(시도 0)으로 새 문안 검사 · 안내 · 옛 ③ 을 다시 불러도 새 행 그대로 `pending` / 결과 안내 행도 같은 표(기록 칸 그대로 · 적재 ≤ 3).
   - 옛 판 결과 버림(실 PG · Codex 8R 순서 그대로): 스캐너가 옛 스냅숏을 읽고 검사(통과)하는 동안 실제 `updateJourneyStep` 으로 문안 수정 커밋 → 옛 결과의 `recordIfCurrent` = 쓰기 0(기록 · 표식 · 본문) → 다음 회차 새 판 검사 통과 · `pending` → 새 안내 첫 적재 실패 → 2-1 조각 거짓(관문 닫힘) · 다음 회차가 안내만 다시(시도 2) / `cancelled` · `paused` · 자동 보정 갈래도 옛 판이면 쓰기 0.
   - 문안 수정 원자성(실 PG): 켜진 여정 칸의 문안을 실제 `updateJourneyStep` 으로 고치되 트랜잭션 안(새 스냅숏 직후)에서 붙잡아 둔다 → 다른 연결에서 스캐너 쪽 기록 INSERT 를 끼움 → 수정 커밋 뒤 그 기록이 남는가(커밋 전에 넣은 옛 판 기록은 지워지고, 커밋 뒤 새 판에 넣은 기록은 남는다) / 기록 DELETE 를 실패시키면 문안 · 스냅숏도 저장 안 됨.
   - `withBoundedMysql`(가짜 풀 · 연결): 끝나지 않는 실행 = 상한 뒤 던짐 · 그 연결 `destroy` 1회 · `release` 0 / 늦게 온 연결 = 받자마자 `destroy` / 연결 10개짜리 가짜 풀에서 멈춘 안내 12번 뒤에도 다른 요청이 연결을 받음 / 정상 = `release` 1회.
   - DDL-2 칸 없음 = 안내 시도 0 · `notified` · 경보 1회.
   - 결과 안내 칸 없음 = 건너뜀.
   - 다시 켜기: 날짜 기준 여정 · 어제 실행 = ended · 오늘 실행 = active · 이벤트 여정 = 0 건드림.
   - DDL-1 · 기준선 DML: 기존 행 = 기록 채움 · 새 행 = 비어 있음.
3. 소스 계약: 실행기 관문이 변이 고르기 · 발송 시간 검사보다 앞 · `isWithinSendHours` 조건 · 경보 / 날짜 기준 판정이 상수 / `campaign-sync-worker.ts` 가 CT 만 부름 / 화면 문구(「보내기 2시간 전에는」 · 「2시간 이내로 예정된 발송에는」 0 · 채널별 머리) / 모델명 · native dialog · 줄표 0.
4. R30 계약 + 반례(관문 없는 발송 표식 파일 · 상태 목록 직접 비교 · `completed` 후보 · 기본값 꼴) 각 실패.
5. 변이(파일 복사): 관문 제거 · 발송 시간 조건 제거 · 미룰 시각 보정 제거 · `paused` 또는 `pending` 을 마침으로 · 안내 실패에도 `notified` · `notified` 를 적재 앞으로 · 시도 잡기를 적재 뒤로 · 시도 상한 제거 · 상한 넘김에 `destroy` 대신 `release` · `pending` 줄의 안내 필요 다시 판단 제거 · 안내 실패 상한 제거 · 묶음 예외 상한 제거 · 날짜 기준 앞당김 제거 · 처리함 DB 판정 제거 · 상한 초과도 기억 · 다시 켜기 끝냄 제거 · 결과 CAS 제거 · 오늘 첫 안내의 진행 중 0 조건 제거 · 08시 조건 제거 · 이틀 창 제거 · 알림 꺼짐 기록 제거 · 화면 기본값 옛 식 → 각각 실패.
6. backend tsc 0 · frontend tsc 0 · vitest 전체 · test:pg 전체.

## 6. 하지 않는 것 (기록만)

- 10-30 두 여정 결과가 전부 실패인 원인(인비토 합성 고객 번호 등 · 받는 번호 확인은 발송 결과 화면 · 따로).
- 알림톡 칸의 보내기 전 안내(검수된 문안 · 스팸 검사 대상 아님 · 화면 문구만 맞춤).
- 한 번 보내기의 지난 날 실행(다시 켜기 · 지금 그대로).
- 안내 본문 미리보기의 변수 자리 · 100자 글자 중간 자름(B-1028-1 남김 그대로) · 「step N」 영문 표기.
- 자동마케팅 · 대행발송 · 플래너의 2시간 전 안내(§4 · 각자 예약 원장).

## 7. 결정 (추천 · Harold 1031 「구현까지 마무리」 = 추천 채택으로 진행 · 보고에 밝힘)

- **K1 바로 보내는 칸**: 추천 = 그날 첫 발송만 검사 · 안내 뒤(10~20분 늦음). 대안 = 접수자 기대대로 2시간 늦춰 보내기 → 「바로」(가입 환영 · 구매 감사)가 뜻을 잃고 모든 고객이 2시간 늦게 받음 → 택하지 않음. 대안 = 보낸 뒤 안내 → 첫 발송을 못 멈추고 검사도 없음 → 택하지 않음.
- **K2 검사 기록 판정**: `notified` · `cancelled` 만 마침(2-1).
- **K3 날짜 기준 대상 확정 = 보내기 2시간 전**(2-3).
- **K4 결과 안내 = 칸 · 날짜당 최대 2통**(2-6).
- **K5 돈**: 바로 보내는 문자 칸 · 날짜 기준 문자 칸도 보내는 날마다 검사 1회 선불 차감(늦은 칸과 같은 규칙).
- **K6 기록 칸 = DDL**(DDL-1 `journey_step_campaigns` 세 칸 · DDL-2 `journey_pretest_schedules` 한 칸 · 캠페인 설정 jsonb 는 읽는 곳 159 · 실행 행 `result_notified_at` 은 칸 하나라 여러 칸을 못 담음).
- **K7 안내 적재 실패**: 추천 = 3회 다시 시도(검사 재사용) 뒤 경보 · 발송 진행. 대안 = 안내 성공까지 발송을 막음 → 우리 안내 줄(인증 라인) 장애 하나가 모든 여정 문자 발송을 멈춤 → 택하지 않음.
- **K8 그날 첫 발송이 20:50 뒤인 바로 칸** = 다음 날 08시 뒤(검사 없이 보내지 않는다 · 2-2).
- **K9 전환 순서** = DDL-2(배포 전) → 배포 → DDL-1 · 기준선(§8). 배포와 DDL-1 사이 결과 안내 0(중복보다 누락 쪽).
- **K10 안내 중복 상한 = 묶음 · 단계마다 3통**(시도 수를 적재 전에 DB 에 남김 · 2-6 · 2-8).

## 8. DDL · DML (DDL-2 = 배포 전 · DDL-1 = 배포 뒤 · Harold 실행 · 원장에 옮김)

- DDL-2(**배포 전**): `journey_pretest_schedules` 에 `notice_attempts smallint NOT NULL DEFAULT 0`(PG 15 = 기본값 칸 추가는 카탈로그만 바뀜 · 옛 코드 INSERT 는 칸 이름을 적어 넣어 기본값 0 · 의미 바꿈 0). `lock_timeout` 3초. 확인 = `information_schema.columns`(칸 · smallint · NO · 0).
- DDL-1 + 기준선(**배포 뒤** · 한 트랜잭션): `journey_step_campaigns` 에 `result_notice_sent integer` · `result_notice_at timestamptz`(NULL 허용 · 기본값 없음) · `result_notice_attempts smallint NOT NULL DEFAULT 0` · 기존 행 전부 = `result_notice_sent = 그 캠페인 sent_count` · `result_notice_at = NOW()`(옛 경로가 다뤘거나 다룰 수 없던 날 = 이미 다룬 것으로 · 소급 안내 0). `lock_timeout` 3초.
- 순서 = **배포 → DDL-1 · 기준선**(Codex 1R ⑤). 배포 순간 옛 결과 경로(실행 완료 · `result_notified_at`)가 사라지고, 새 경로는 칸이 생길 때까지 건너뛴다 → 그사이 결과 안내 0 → DDL-1 의 기준선이 그사이 생긴 행까지 「다룸」으로 덮는다 → 옛 경로와 새 경로가 같은 날을 두 번 알리는 일이 없다. 잃는 것 = 배포 직전 · 사이에 아직 안 간 결과 안내(그날 더 보낸 몫은 다음 날 하루 합계로 온다).
- 확인 = `information_schema.columns`(세 칸) · 기준선 뒤 캠페인과 이어진 행(`JOIN campaigns`) 중 `result_notice_at IS NULL` 0(캠페인이 지워진 행은 후보 SQL 이 조인으로 빼므로 비어 있어도 된다).
- 코드 전 칸 확인(규칙 `db_column_verify_before_code` · 운영 정의 해시가 같은 시험 DB `t_tpl_closed` 의 `information_schema` 출력으로 · 원장 §2 덤프 확인 규칙): `journey_pretest_schedules`(id · company_id · journey_id · step_id · execution_id · scheduled_send_at · notify_at · status) · `journey_anchor_dispatch`(journey_id · step_id · customer_id · send_date) · `journey_step_campaigns`(journey_id · step_id · send_date · campaign_id · created_at) · `campaigns`(sent_count · sent_at) · `journey_steps`(delay_mode · delay_hours · step_type · notify_manager_on_pretest) · `journeys`(start_kind). 새 칸(DDL-1 · DDL-2)은 `t_tpl_after`(원장 §1 대기 블록을 얹은 시험 DB)로.

## 9. 구조체크 진행표

(회차마다 = 설계서를 코드 경로에 대고 결함을 적는다 · 결함 0 회차가 나올 때까지 · Codex 설계 9R approve 뒤 시작)

| 회차 | 결함 | 처방(설계서 반영 자리) |
|---|---|---|
| 1 | SC1 알림 기본값을 메시지 칸 기준으로 하나로 하면 기다림 칸이 앞 · 뒤에 있는 여정의 안내 받는 칸이 바뀌는데 영향표에 동작 변화가 없음 | §3 줄 |
| 1 | SC2 「그날 묶음의 가장 최근 기록」 정렬 칸이 없음 · 운영 INSERT 는 `created_at` 을 안 씀 · 쓰는 칸들의 운영 존재 확인 전 | 2-8 = `notify_at DESC, id DESC` · §8 코드 전 칸 확인 목록 |
| 1 | SC3 기준선 확인 기대값이 캠페인 없는 행에서 틀림 | §8 「캠페인과 이어진 행 중 0」 |
| 1 | SC4 운영 경보 문장(스캐너 165줄 「2시간 전」)이 문구 정리 목록에 없음 | 2-4 |
| 1 | SC7 옛 판 결과를 버릴 때 버려지는 검사비 · AI 1크레딧을 안 적음 | 2-8 한 줄(받아들임) |
| 1 | 확인한 것 = 실행기 관문(704)과 발송 표식 INSERT(1176)가 같은 함수 `processExecution`(413~1388) · 알림 기본값 계산 자리 = 3곳(`journey-pretest-scan.ts:46` · `campaign-sync-worker.ts:211` · `JourneyStepNotifyToggle.tsx:50`) 밖 0(`JourneysPage.tsx:480` 은 끝 칸 검사 · 다른 판정) |: |
| 2 | SC8 스캐너의 정지 · 자동 보정 안내는 상한 없는 공용 풀 = MySQL 이 멈추면 회차가 멈추고, 이제 그 스캐너가 모든 여정 문자 관문 | 2-8 = 스캐너 안내 적재 전부 `withBoundedMysql` · §3 |
| 2 | SC9 스캐너는 묶음을 차례로 처리 = 회차 길이가 바로 칸 첫 발송 늦음이 됨 · 측정 · 안전망을 안 적음 | 2-8 = 순서(next_run_at 이른 순 · 지금 그대로) · 회차 시간 로그 · 30분 경보 · 병렬은 측정 뒤 |
| 2 | 확인한 것 = 스팸 결과 기다림 30초 상한(`journey-pretest-validator.ts:228`) · AI SDK 요청 상한 10분(두 SDK) · AI 다시 쓰기는 차단 글에서만 | 없음 |
| 3 | SC10 2-6 · §3 · K6 이 DDL-1 「칸 둘」 · 아래 줄은 시도 칸까지 셋 | 셋으로 맞춤 · K6 에 DDL-2 |
| 3 | SC11 2-8 MySQL 상한 줄 「안내 두 종류만」 ↔ 2회차 「스캐너 안내 적재 전부」 | 「여정 담당자 안내(스캐너 전부 · 결과)」 |
| 3 | SC12 2-8 「자동 보정 · 정지 갈래 = 지금 그대로」 ↔ 판 확인 쓰기 · 상한 연결 | 「흐름은 그대로 · 쓰기 · 적재는 새 꼴」 |
| 3 | SC13 §5 「잠근 행 상태가 다름」 = 5R 에서 잠금을 걷어낸 뒤의 잔재 | 「시도 잡기 0행」 |
| 3 | SC14 §8 제목 「배포 전」 ↔ DDL-1 배포 뒤 | 제목에 둘 다 |
| 3 | SC15 1-4 「세 판정이 다 다르다」 = 손으로 따져 보니 결과 안내 · 화면은 같고 2시간 전 안내만 다름 | 사실대로 고침 |
| 3 | 같은 뿌리 다른 기능 = 대행발송은 상태 리드타임(`agency-send-state.ts:375`)으로 발송 자리 관문 = 아님 · 자동마케팅 · 플래너 = 미확인 · 추가 과제 · 문서 줄표 11 → 쌍점 | §4 |
| 3 | 확인한 것 = 알림톡 적재도 같은 QTmsg 큐 표(`insertAlimtalkQueue` · 1316줄) → 결과 집계 함수가 센다 · 한 번 보내기 화면 = 알림톡 정보 알림(`JourneysPage.tsx:1102`) = 「바로 나감」 문자 약속 문구 0 | 없음 |
| 4 | 0: 0절 ~ 8절을 처음부터 다시 읽고 코드 줄(notifier 46~78 · 88~260 · 274~358 · executor 413~760 · 1389~1405 · anchor 60~250 · resume 전부 · pause-handler 136~146 · campaign-sync-worker 110~320 · step-campaign 85~146 · builder 1380~1432 · 1485~1530 · 1641 · sms-queue 1583~1670 · database.ts 55~100)에 다시 대 봄 · 남은 낱말(칸 둘 · 두 종류 · 잠근 · 세 판정) 0 · 실패 경로(검사 장애 · 기록 실패 · 안내 실패 · MySQL 멈춤 · 재시작 · 칸 수정 경합 · DDL 빠뜨림 · 밤 경계 · 상한 초과 · 다시 켜기) 전부 처방 있음 | 없음 |

## 10. Codex 진행표

| 라운드 | 지적 | 판정 · 처방 |
|---|---|---|
| 설계 8R | medium 1: 스캐너가 옛 판을 검사하는 동안 수정이 커밋되면 옛 결과가 수정 뒤에 기록(`notified`)으로 남아, 새 판 안내가 실패해도 관문이 열리고 안내 재시도도 멈춤 | 수용. **같은 부류 세 번째(6R · 7R · 8R = 기록이 어느 판을 증명하나) = 왜 반복**: 기록과 그 기록이 검사한 판을 잇는 장치 없이 「지우는 시점」에만 기댔다(지우기만 원자적으로 고쳐도 쓰기 쪽 틈이 남는다) → 구조 처방 = 스캔의 기록 쓰기 전부를 판 확인 쓰기 하나로(수정 경로와 같은 journeys 행 잠금 · 최신 스냅숏 id = 검사한 id 일 때만 씀 · 외부 검사 · 적재는 잠금 밖)(2-8 · §3 · §5) · 7R 처방(지우기 = 같은 트랜잭션)과 짝으로 「기록 행 = 문안 판」이 양쪽에서 성립 · 새 칸 0 |
| 설계 7R | medium 1: 문안 수정의 기록 DELETE 가 스냅숏 커밋 **뒤** 따로 돌아, 그 틈에 스캐너가 새 판에 만든 기록까지 지움 = 같은 판 유료 재검사 · 안내가 상한을 넘음(6R 불수용 근거 「기록 행 = 문안 판」이 원자적으로 안 지켜짐) | 수용(지금 코드에도 있는 경합). DELETE 를 문안 · 스냅숏 트랜잭션 안으로(실패 = 문안 저장도 되돌림) → 「기록 행 = 문안 판」이 한 번에 성립 · 6R 불수용 근거는 이 처방 위에서 유지(2-8 · §3 · §5 경합 시험) |
| 설계 6R | medium 1: 칸 수정이 기록 행을 지우면 시도 수가 0 으로 돌아가 네 번째 안내 · 시험의 「DELETE 뒤 재삽입 → 시도 2」 기대는 실제 넣기 경로와 맞지 않음 | 부분 수용. 상한 초기화 = 불수용(이유: 행을 지우는 곳은 사람이 칸을 고치거나 지울 때뿐 · 고친 칸은 새 문안이라 그 안내는 새 문안의 첫 안내 · 상한은 같은 판의 되풀이를 막는 것 · 단위 = 기록 행 = 문안 판 · 옛 판 ③ 은 id 조건이라 새 판을 완료하지 못함 = 요구한 세대 조건이 이미 있음) → 2-8 에 단위를 적음. 시험 서술 = 수용(③ 실패는 주입 · 칸 수정 경로는 실제 DELETE 문장으로 따로)(§5) |
| 설계 5R | high 1 · medium 1: ① 20초 상한은 PG 잠금만 풀고 MySQL 작업은 남김 = 되풀이되면 공용 발송 풀 10개 고갈 ② 실패 수가 메모리라 재시작하면 「많아야 3통」이 깨짐 | 수용. **같은 부류(3R · 4R · 5R = MySQL 동안 PG 잠금) = 왜 반복**: 순서를 지키려고 잠금을 MySQL 작업 위에 걸쳤고, 그 위에 상한을 덧대며 새 구멍을 만들었다 → 구조 처방 = 잠금을 없앤다. 시도 수를 적재 **전에** DB 에 남기고(조건부 UPDATE · 3회) 적재 성공 뒤에만 `notified`(관문은 그 뒤 열림) → 순서 · 상한이 잠금 없이 성립 · 재시작에도 남음. MySQL 은 상한 넘긴 연결을 끊는 `withBoundedMysql` + `bulkInsertSmsQueue` 실행기 선택 인자(소비처 바뀜 0)(2-8 · 2-6). **걷어낸 덧댄 장치** = FOR UPDATE · lock_timeout · idle_in_transaction_session_timeout · 롤백 기반 실패 판정 · 메모리 안내 실패 수. 대가 = DDL-2(배포 전 · 칸 하나) · DDL-1 에 시도 칸 하나 |
| 설계 4R | medium 1: MySQL 적재가 멈추면 PG 행 잠금이 끝없이 유지 · 그 기록을 지우는 칸 수정까지 기다림 · 실패 수 상한도 안 돈다 | 수용(3R 처방이 새로 만든 위험 · 같은 부류 반복 아님). 잠그기 대기 5초 · PG 쪽 유휴 트랜잭션 30초(Node 가 멈춰도 풀림) · 적재 20초 상한 → 롤백 · 실패 1회(2-8) · 시험 = 끝나지 않는 적재 · 동시 DELETE(§5) |
| 설계 3R | medium 1: 표시 먼저(`notified`)가 안내 적재 전에 관문을 연다 = 안내 준비 중 예정 시각이 된 고객 문자가 안내보다 먼저 · 적재 실패면 이미 나간 문자는 못 거둠 | 수용. **같은 단계 처리 세 번째 = 왜 반복**: 진실이 두 곳(PG 관문 · MySQL 큐)인데 「관문 열림」과 「안내 보냄」을 같은 값 하나로 다루고, 둘의 순서를 정하는 장치가 없었다 → 처방 = 지킬 불변식을 고름(고객 문자보다 안내가 먼저) · 그 행을 잠근 트랜잭션 안에서 적재 → 기록 → 커밋(관문은 커밋된 값만 읽음) · 대가 = 커밋 실패 때 안내 한 번 더(2-8) · 결과 안내도 같은 꼴 `sendNoticeOnce` 하나(2-6 · 2R 의 「표시 먼저 꼴 하나」 서술을 걷어냄) |
| 설계 2R | medium 3: ① 적재 성공 뒤 `notified` UPDATE 실패 = 다음 회차가 같은 안내를 또 적재 ② `pending` 재시도 중 알림을 끄면 완료 갈래(3번)를 건너뛰어 영구 대기 ③ 상한 초과 날도 메모리에 「처리함」 = 같은 날 다시 켜도 안 뽑음 | 다 수용. **같은 부류 두 번 = 왜 반복**: ①② = 1R ①③ 부류 · 단계를 서술형 건너뛰기로 짜서 상태마다 할 일이 빠졌고, 바깥 부작용(적재)을 이미 있는 「표시 먼저 · 적재 · 실패면 되돌림」 꼴로 다루지 않았다 → 묶음 상태표(회차마다 기록 상태에서 할 일 하나 · `pending` 줄이 안내 필요를 매번 판단) + 표시 먼저 꼴 하나(결과 안내와 같음)(2-8). ③ = 1R ② 부류 · 「처리함」 표식을 결과와 상관없이 찍었다 → 결과에서 끌어냄(뽑아 넣음 = DB 행 · 대상 0 = 메모리 · 상한 · 꺼짐 = 기억 0)(2-3). 덧댄 장치 = 0(옛 메모리 무조건 표식 · 3번 · 4번 서술이 사라짐) |
| 설계 1R | high 2 · medium 3: ① 검사 기록 저장 실패 = 유료 재검사 무제한 · 관문 무기한 미룸 · 스캔 생존 경보로는 안 잡힘 ② 날짜 기준 「그날 처리함」이 메모리 = 재시작 뒤 다시 뽑아 상한 정지가 잡아 둔 발송까지 막음 ③ 안내 적재 실패도 `notified` = 「안내 뒤 발송」 보장 안 됨 ④ 20:54 에 미루면 그날 검사비 + 다음 날 검사비 ⑤ DDL 과 배포 사이 옛 경로가 알린 날을 새 경로가 또 알림 | 다 수용. ①③ 같은 뿌리(검사 · 기록 · 안내가 한 덩어리) → 단계 분리(`pending` = 통과 · 안내 전 · 새 상태 값 0) · 안내 재시도는 검사 재사용 · 안내 3회 실패 = 경보 뒤 진행(K7 · 무기한 막음은 거절 · 이유 = 안내 줄 장애 하나가 모든 여정 문자를 멈춤) · 묶음 예외 상한 · 실행기 묶음별 30분 경보(2-2 · 2-8) ② DB 행 존재 판정(2-3) ④ 미룰 시각을 발송 창으로 보정(2-2 · K8) ⑤ 순서 = 배포 → DDL · 기준선(§8 · K9) · 제 검토 4건 함께(결과 안내 알림 꺼짐 = 기록만 · 문안 고치기 창 문구 = 문자 칸 · 스캔 생존 경보 → 묶음 경보로 바꿈 · 「첫 발송 3시간」 잔재 삭제) |

## 11. 구현 기록

### 11-1 바뀐 곳

- 새 CT: `utils/journey-step-notify.ts`(알림 기본값 · 메시지 칸 첫 · 끝 SQL) · `utils/journey-notice-once.ts`(안내 쓰기 한 꼴 · 시도 3 · 적재 20초) · `utils/journey-result-notice.ts`(결과 안내 = 칸 · 날짜 · 판정 순수 함수 · 본문 · 칸 확인) · `config/database.ts` `withBoundedMysql`(상한 · destroy) · 화면 `frontend/src/utils/journey-step-notify.ts`.
- `journey-pretest-notifier.ts`: `PRETEST_LEAD_HOURS` · `PRETEST_DONE_STATUSES` · `pretestDoneSql` · 묶음 상태표(`processBundle` · `latestRecord` · `finishPending`) · 판 확인 쓰기(`recordIfCurrent`) · 안내 만들기 · 적재 분리(`buildManagerNotice` · `enqueueManagerNotice` · 상한 있는 연결) · 묶음 예외 상한 · 멈춘 묶음 SQL 거름 · 회차 시간 로그 · 제목 · 바로 칸 줄 · 멈춤 사유 · 경보 문장.
- `journey-pretest-scan.ts`: 알림 = `isStepNotifyOn` · `isImmediateStep`.
- `journey-executor.ts`: 관문 조회 `checked_today` · 미룸(`pretestHoldUntil`) · 묶음 경보(`trackGateHold` · `clearGateHold`).
- `journey-anchor-scheduler.ts`: `anchorDispatchDue`(2시간 앞) · `anchorStepDispatched`(DB) · 결과 종류 · 메모리 = 대상 0 만.
- `journey-resume.ts`: `RESUME_STALE_ANCHOR_SQL`(날짜 기준 지난 날 끝냄) · 반환 `staleEnded`.
- `journey-builder.ts`: 문안 수정 기록 DELETE = 스냅숏 트랜잭션 안 · 다시 켜기 로그.
- `journey-pause-handler.ts`: `dueExecutionsSql` 조각 함수.
- `sms-queue.ts`: `bulkInsertSmsQueue` 선택 인자 `opts.run`.
- `campaign-sync-worker.ts`: 옛 결과 경로 삭제 · `notifyJourneyStepResults` 부르기.
- 화면 · 소개 문구: 토글(채널별 머리 · 시점 줄 · 기본값 함수) · `JourneyWorkspace`(메시지 칸 첫 · 끝) · 켜기 확인 창 · 문안 고치기 창 · `content/plan-feature-intros.ts`.
- 시험: 새 `journey-step-gate-1031.test.ts`(순수 · 소스 계약 38) · 새 실 PG `journey-step-gate-1031.pg.test.ts`(13 · 원장 C84 블록을 사본에 실행) · `root-ledger.test.ts` R30 · 옛 꼴을 보던 계약 시험 9파일 = 같은 뜻을 새 자리로(bug-1028-tickets · codex-1r-fixes-1018 · bug-sweep-1019 · journey-structure-check-1025 · journey-v3-resume-1020 · plan-feature-modal-contract · tier3-e-rest-0927 · tier4-worker-0928 · root-ledger R8 · R10 낡은 면제 · R6 이유 줄 · R12) · `pg/global-setup.ts` `ledgerBlockSql`.
- 문서: 원장 C84(DDL-2 · DDL-1 · S1) · BUGS B-1031-1 · B-1028-1 실측 · ROOT-LEDGER R30 · STATUS 한 줄.

### 11-2 검증

- backend tsc 0 · frontend tsc 0 · backend vitest 723파일 10,705건 · 실 PG 16파일 88건(덤프 해시 = 운영과 같은 t_tpl_closed · 쓴 칸 실재 확인 겸함) · pg 스탬프 29.
- 코드 전 칸 확인(1031 · t_tpl_closed `information_schema`) = 설계 §8 목록 전부 있음 · `journey_pretest_schedules.status` = varchar NOT NULL DEFAULT 'pending' · CHECK 0 · 이 표는 journey_id FK 0(여정 영구 삭제 뒤 기록이 남는다).
- 변이(파일 복사 · 되돌림 바이트 대조) 22개 전부 잡힘(§5-5 목록 · 관문 제거는 R30 계약이 잡음).
- Codex 구현 1R 수정 뒤: backend tsc 0 · frontend tsc 0 · vitest 723파일 10,705건(스탬프 1건 = test:pg 전체 뒤 다시 29 통과) · 실 PG 16파일 92건 · 변이 5개(1R 지적별) 전부 잡힘.
- Codex 구현 2R 수정 뒤: backend tsc 0 · vitest 723파일 10,707건 · 실 PG 16파일 91건(굶김 시험 둘 → 커서 시험 하나) · 변이 2개 잡힘.
- 화면 자가 검사 = 모델명 · native dialog · 줄표(새 문구) 0.

### 11-3 Codex 구현 진행표

| 라운드 | 지적 | 판정 · 처방 |
|---|---|---|
| 1R needs-attention | ① 높음 · 실행기: 관문이 `isWithinSendHours()` 거짓(07:59:59)이면 건너뛰고 변이 조회 사이 08:00 을 넘기면 뒤 발송 시간 검사는 통과 = 검사 기록 없이 발송 | 수용(새 뿌리 · 같은 판정을 두 자리에서 따로 읽음). 발송 시간 판정을 관문 앞 한 자리로 옮기고(창 밖 = 다음 창 · 바로 끝) 관문은 조건 없이. 계약 시험 = 판정 한 번 · 순서(재검사 전 관문 → 시간 → 관문 → 변이 → 표식). 변이 = 관문에 시간 조건 되살림 → 잡힘 |
| | ② 높음 · 스캐너: 적재 성공 · ③ 실패가 세 번이면 묶음 예외 셈 3 = 그날 SQL 에서 빠져 pending 이 포기 갈래에 닿지 못함(DB 가 돌아와도 그날 발송 막힘) · 기존 시험은 메모리를 비워 못 봄 | 수용(새 뿌리 · 유료 재검사 상한이 무료 갈래까지 셈). 셈 = 그 호출에서 유료 검사를 한 뒤의 예외만(`summary.tested` 전후). pending 안내 갈래 · 검사 전 읽기 실패는 다음 회차가 다시(안내 시도 상한은 DB notice_attempts). 실 PG = 재시작 없이 네 회차 → 복구 = notified · 멈춤 0 · 적재 3 / 유료 검사 예외는 3 회차 뒤 멈춤 · 경보. 변이 = 검사 전 예외도 셈 → 잡힘 |
| | ③ 중간 · 동기화 워커: 대상 회사 0 조기 종료가 결과 안내를 건너뜀 → 하루 합계 · 재시도 멈춤 | 수용. 결과 안내를 `finally`(`_running` 해제 앞)로 = 사이클마다. 계약 시험 = 위치. 변이 = try 안으로 되돌림 → 잡힘 |
| | ④ 중간 · 결과 안내: LIMIT 500 을 기다리는 행(첫 안내 뒤 오늘 더 보낸 행 등)이 차지해 뒤의 준비된 행이 굶음 | 수용(R12 · 거름이 LIMIT 앞에 다 있지 않았다). DB 로 정해지는 기다림(지난 날 = 발송 시간 시작 전 · 오늘 = 첫 안내 뒤 또는 진행 중 실행)을 SQL 안에서 뺌 + 집계 대기처럼 DB 밖 기다림은 「지난 회차에 안 본 행 먼저」 순번. 실 PG = 첫 안내 뒤 500 + 준비 1 = 첫 회차 1통 / 집계 대기 500 + 준비 1 = 둘째 회차 1통. 변이 둘(거름 제거 · 순번 제거) → 잡힘 |
| 2R needs-attention | ① 중간 · 결과 안내 순번: 직전 500행만 뒤로 보내 집계 대기 1,000행 + 준비 1행이면 앞 500 · 다음 500 을 번갈아 준비 행이 그날 내내 밀림 | 수용. ② 와 함께 1R ④ 와 같은 뿌리로 판정(같은 자리 두 번 = 땜질했다): 1R 수정이 판정(decideResultNotice)을 SQL 에 한 벌 더 베꼈고(R1 · 판정 두 자리) 순번은 반쪽 순환이었다. 구조 수정 = SQL 거름 · `_seenLast` 를 걷어내고 PK 순 커서(send_date · journey_id · step_id)로 후보 전체를 회차를 이어 끝까지 돈다(다 못 채운 회차 다음 = 처음부터). 판정은 함수 한 곳. 실 PG = 집계 대기 1,000 + 준비 1(PK 맨 뒤) = 첫 회차 0 · 셋째 회차까지 1통 · 그 뒤 0. 변이 = 커서 무력화 → 잡힘 |
| | ② 중간 · 1R 의 SQL 거름이 알림 꺼짐 「기록만」을 날짜 판정 뒤로 미뤄, 07시 꺼짐 → 07:30 켬이면 기록 0통이던 것이 08시 안내 1통으로 바뀜 | 수용(① 과 같은 뿌리 · 위 구조 수정으로 함께 닫힘). 순수 표에 「알림 꺼짐 · 어제 · 07시 = 기록만」 · 「알림 꺼짐 · 진행 중 남음 = 기록만」 추가 · 계약 시험 = 후보 SQL 에 판정 조각 0(진행 중 실행 조각은 SELECT 칸 하나 · 시각 거름 · `result_notice_at IS NULL` 0). 변이 = 판정 SQL 되살림 → 잡힘 |
| 3R approve | 지적 0(커서 상한 ceil(N/500)+1 · NULL 바인드 · 빈 결과 · 알림 꺼짐 기록만 · R1 · R8 · R12 부합) | 닫음 |
