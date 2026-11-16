# 여정 단계 캠페인은 여정만 닫는다 — B-1114-1 처방 설계서 (C134)

> 접수 = `status/BUGS.md` B-1114-1 · 흐름 표 = [이음매 원장](2026-11-14-journey-step-campaign-seam-ledger.md)(빈칸 0 = 1114 밤 · §6) · 닫는 방식 = 같은 문서 §7(1114 Harold 「네, 진행」 · 「구현까지 완벽하게 전부 다」).
> 기준 판 = 서버 배포본 a7426275(백엔드 dist = 38c3671f) · 로컬 작업 트리에는 다른 세션의 미커밋(C133 C + D)이 있다 → 이 설계가 고치는 운영 파일은 그 미커밋과 겹치지 않게 골랐다(§6 · 1114 18:53 작업 트리 상태 실측 = 아래 일곱 파일 수정 없음).
> 뿌리 = **R96 신설**(`docs/ROOT-LEDGER.md`) 「공용 표의 행을 그 행의 주인이 아닌 코드가 종결시킨다」.
> 설계 Codex 1R = needs-attention 7건 → 전부 반영(§9). 이 판은 그 뒤의 설계다.

## 1 결함과 범위

| # | 결함 | 사슬 | 고객이 겪는 일 |
|---|---|---|---|
| D1 | 열린 날의 여정 단계 캠페인을 목록 조회(W1 `routes/campaigns.ts` 목록 GET · W2 `routes/admin.ts` 관리자 목록)가 완료로 바꾼다 | 완료 뒤 확정 문장(`confirmLoadUnit` · 대상 수 + n)이 트리거 `campaigns_protect_completed_target_count` 에 막힘 → 그 실행 12번 오류 뒤 실패 · 표식 정리 5분마다 실패 · 그날 그 칸의 뒤 실행도 같은 자리에서 막힘 | 하루에 두 번 이상 나가는 칸이 첫 발송 뒤 멈춘다(그날) |
| D2 | 여정 단계 캠페인을 완료로 닫는 주인이 없다 | 닫는 자리 = W1 · W2 뿐 | 성과 · 분석 숫자(`status = 'completed'` 로 읽는 11곳)에 여정 발송이 드는 시점 = 누가 목록을 연 때 |
| D3 | 재대조(W4 `campaign-sync-worker.ts reconcileFinalizedCampaigns`)가 여정 행의 발송 수를 큐 행 수(알림톡 대체 행 포함)로 올린다 | 선불 정산은 여정의 발송 수를 적재 수로 읽는다(`mysql-refund-sweeper.ts:400` 이 같은 이유로 여정 행을 안 올림) | 여정 알림톡 칸의 적재 실패분 환불이 줄 수 있다(지금 선불 회사의 여정 알림톡 칸 0 = 1112 실측) |

범위 = 이음매 원장 전체(W1 ~ W5 · 여정 자신 11문장 · 트리거 2 · 읽는 쪽) + 닫힘을 재는 장치(§5).

## 2 규칙 하나

**여정의 단계 캠페인(`send_type = 'journey'`)의 일생 칸(상태 · 굳힘 · 대상 수 · 발송 수)은 여정이 정한다.** 여정 밖 코드는 「그날이 닫힌 것」만 건드리고, 닫는 일(상태 = completed)은 여정이 한다.

판정 한 곳 = `utils/journey-step-campaign.ts`

| 이름 | 뜻 | 쓰는 곳 |
|---|---|---|
| `JOURNEY_STEP_SEND_TYPE` | `'journey'` | 아래 전부 |
| `NOT_JOURNEY_STEP_SQL` | `send_type IS DISTINCT FROM 'journey'` | 목록 자동 완료 문장 · 목록의 `exclude_journey` |
| `isStepCampaignDayClosed(sendBase, now)` | 그날이 닫혔나(이미 있음) | 스위퍼 |
| `isOpenJourneyStepCampaign(sendType, sendBase, now)` | 여정 행이고 그날이 안 닫힘 · 기준 시각을 모르면 열린 것(건드리지 않는 쪽) | 굳힘 · 재대조 |
| `stepCampaignSentWritten(sendType, pgSent, aggTotal)` | 재대조가 쓸 발송 수 = 여정은 지금 값 · 그 밖은 올리기만 | 재대조 |
| `stepCampaignCloseBefore(now)` | 닫을 수 있는 날의 끝 = (지금 − 유예 10분)의 KST 날짜 | 닫기 · 자동 판정 |

## 3 처방

| # | 무엇 | 어디 | 내용 |
|---|---|---|---|
| P1 | 목록 자동 완료를 CT 한 곳으로 | 신설 `utils/campaign-list-autocomplete.ts` · `routes/campaigns.ts` · `routes/admin.ts` · `LiveAutomationStrip.tsx` | (순수) `listEffectiveStatus(status, counts, sendType)` = 여정 행은 **저장된 상태 그대로** · 그 밖은 종전 판정(보내는 중 + 대기 0 + 성공 · 실패 > 0 → 완료로 보임). (순수) `autoCompleteTargetIds(rows, countsOf)` = 완료로 보이는 보내는 중 캠페인(여정 행은 완료로 안 보이므로 빠진다). `LIST_AUTO_COMPLETE_SQL` = `UPDATE … WHERE id = ANY AND status = 'sending' AND send_type IS DISTINCT FROM 'journey'`(대상 고르기가 틀려도 문장이 막는다). 두 라우트의 인라인 두 벌을 이 CT 호출로 바꾼다. **여정 줄의 보이는 값이 바뀐다**: 종전 = 결과가 다 오면 그날 바로 완료 · 뒤 = 그날은 보내는 중 · 여정이 닫은 다음 날부터 완료. 이유 = 목록은 저장된 상태로 거르고(상태 필터 · 건수 · 쪽) 그 뒤에 보이는 상태를 계산한다 → 여정 행만 「보이는 완료 · 저장은 보내는 중」이면 완료 필터에서 빠지고 보내는 중 필터에 완료 줄이 남는다. 보이는 값 = 저장값이면 필터 · 건수 · 쪽이 전부 맞는다. 대시보드 자동화 띠(`status=sending&limit=1`)는 하루 종일 보내는 중인 여정 줄이 다른 발송을 가리지 않게 `exclude_journey=1` 을 싣는다(사용자 목록 GET 의 새 선택 값 · 안 실으면 종전 그대로) |
| P2 | 여정이 닫는다 | `journey-step-campaign.ts closeFinishedStepCampaigns(now)` · 부르는 곳 = `campaign-sync-worker.ts` 주기(5분) 맨 앞 | `UPDATE campaigns SET status = 'completed' WHERE send_type = 'journey' AND status = 'sending' AND (그날의 KST 날짜 < stepCampaignCloseBefore) AND 단위 기록(loadUnit) 없음 AND 미확정 표식(`journey_step_logs.status = 'sending'`) 0`. 날짜 기준 칸 = `COALESCE(scheduled_at, sent_at, created_at)`(스위퍼의 send_base 와 같음). 유예 = 자정을 걸친 실행이 캠페인을 고른 뒤 표식을 쓰기 전에 닫히는 길을 줄임(남는 길은 P3 이 닫음). **빈 캠페인은 닫으면서 굳힌다**: 발송 수 0 이고 보낸 표식 · 증명 못 한 표식이 하나도 없으면 `result_final = true` 를 같은 문장에서 쓴다 = 여정이 「아무것도 안 나갔다」를 증명한 행. 안 그러면 굳힘은 발송 수 0 이라 건너뛰고 재대조는 72시간 뒤부터 매일 0건 보류만 반복해 공용 배치(50건)에 쌓인다 |
| P3 | 여정이 자기 행을 지킨다 | `journey-step-campaign.ts pickStepCampaignForUnits` · `journey-send-claim.ts confirmLoadUnit` | (가) 오늘 행을 이어 쓰는 두 갈래에 `status = 'sending'` 조건 — 아니면 봉인과 같은 길(순번 + 1 이어 붙임 · 이어 붙임이 닫혀 있으면 종전처럼 blocked). (나) 확정 문장 앞에 `reopenStepCampaignForConfirm(campaignId, claimIds)` = `UPDATE campaigns SET status = 'sending', result_final = false WHERE id = $1 AND send_type = 'journey' AND status = 'completed' AND EXISTS(그 표식 중 아직 sending 인 것)` → 열었으면 시스템 경보 한 번(캠페인마다 24시간 · 주인이 아닌 누가 닫았다는 신호). 트리거는 옛 상태가 completed 인 행의 대상 수 변경만 막으므로 먼저 열고 나면 확정 문장이 종전 그대로 통과한다. 다시 열기와 확정 사이에 끊기면 = 보내는 중 + 미확정 표식 → 표식 정리가 다시 확정(같은 길) |
| P4 | 굳힘 · 재대조는 닫힌 날만 · 읽은 뒤 바뀐 행을 덮지 않는다 | `campaign-sync-worker.ts markFinalizedCampaigns` · `reconcileFinalizedCampaigns` | 후보 SELECT 에 `send_type` · 기준 시각 추가 → `isOpenJourneyStepCampaign` 이면 건너뜀(재대조는 재대조 시각만 찍음 = 배치 점유 방지). 쓰는 문장에 상태 조건: 굳힘 `MARK_FINAL_SQL` = `… AND result_final = false AND status IN ('completed', 'failed')`(후보를 읽은 뒤 여정이 다시 연 행을 굳히지 않는다) · 재대조 `RECONCILE_WRITE_SQL` = `… WHERE id = $1 AND status = $7`(읽은 상태와 같을 때만 · 0행 = 다음 주기에 다시). 재대조는 여정 행의 상태를 쓰지 않는다(`status = CASE WHEN send_type = 'journey' THEN status ELSE $2 END`) |
| P5 | 재대조가 여정 발송 수를 안 올린다(D3) · 늦게 오는 대체 결과는 계속 잡는다 | `reconcileFinalizedCampaigns` | 발송 수 = `stepCampaignSentWritten`(여정은 지금 값) · 문장도 `sent_count = CASE WHEN send_type = 'journey' THEN sent_count ELSE GREATEST(…) END`. 대신 여정 행에는 재대조가 본 큐 행 수를 `send_config.reconRows` 에 큰 값으로 남긴다. 굳은 행을 다시 고르는 기준 = `(성공 + 실패) < GREATEST(sent_count, reconRows)`(`RECONCILE_BENCHMARK_SQL`) → 수신자 100 · 큐 행 110(대체 10) · 결과 109 인 채 굳은 후불 여정 행이 종전처럼 다시 잡힌다. 정산이 읽는 발송 수와 결과 완결을 재는 기준을 가른 것이다 |
| P6 | 이미 걸린 행 | 코드 없음(P3 나 가 처리) | 운영의 998900e1(완료 + 미확정 표식 1) = 배포 뒤 표식 정리 주기가 `judgeLoadUnit` → 들어감 증명 → `confirmLoadUnit`(다시 열기 → 확정) → 다음 주기에 P2 가 닫음. 수동 SQL 0 · 「적재 중 표식 정리 실패」 로그가 멎는 것이 배포 뒤 확인 항목 |

### 3-1 값 범위(판정 자리 = P2 닫기 · P3 이어 쓰기 · P4 쓰기)

| 들어오는 값 | P2 닫기 | P3 이어 쓰기 | P4 굳힘 · 재대조 |
|---|---|---|---|
| 오늘 만든 행(열린 날) | 안 닫음 | sending 이면 이어 씀 | 건너뜀 |
| 어제 행 · 표식 0 · 단위 기록 없음 · 발송 수 > 0 | 닫음(굳힘은 그대로) | 날짜가 달라 고르지 않음 | 닫힌 뒤 종전 규칙대로 |
| 어제 행 · 발송 수 0 · 보낸 표식 0 · 증명 못 한 표식 0 | 닫으면서 굳힘 | — | 후보 아님(굳음 · 0 < 0 거짓) |
| 어제 행 · 발송 수 0 · 증명 못 한 표식 있음 | 닫음 · 굳히지 않음(들어갔을 수 있다) | — | 종전 규칙(0건 보류) |
| 어제 행 · 미확정 표식 있음(자정 걸침 · 증명 대기) | 안 닫음(표식이 풀린 뒤) | — | 닫힌 날이면 대상 · 쓰는 문장의 상태 조건이 지킴 |
| 자정 직후 10분 | 안 닫음(유예) | — | — |
| 주인 아닌 코드가 완료로 바꾼 오늘 행(배포 전에 바뀐 것) | 해당 없음 | 이어 쓰지 않고 순번 + 1 · 걸려 있던 표식은 P3 나 가 열어 확정 | 열린 날이라 건너뜀 |
| 재대조가 읽은 뒤 여정이 다시 연 행 | — | — | 0행(상태가 달라 안 씀) |
| 매핑 행 없는 옛 여정 캠페인(고객 1명당 1건 시절 · sending 으로 남은 것) | 날짜가 지났고 표식 0 이면 닫음(닫히지 않는 상태 R6 해소) | — | 닫힌 뒤 종전 규칙 |
| 굳은(`result_final`) 여정 행에 표식이 남음 | — | 다시 열 때 굳힘도 푼다(발송결과 화면이 큐 실측을 읽게) | — |
| 봉인 · 원장 꼴 다름 · 옛 규약 | 상태와 무관(닫는 조건 = 날짜 · 표식뿐) | 종전 그대로 | — |
| 여정이 아닌 행(직접 · AI · 자동 · 대행) | 대상 아님 | — | 종전과 같은 값을 쓴다(상태 조건만 더해짐) |

### 3-2 화면 축

| 화면 | 종전 | 뒤 |
|---|---|---|
| 캠페인 목록 · 캘린더 · 관리자 목록의 여정 줄 | 결과가 다 오면 그날 「완료」 | 그날은 「보내는 중」 · 다음 날 00:10 뒤 첫 5분 주기부터 「완료」(상태 필터 · 건수 · 쪽과 같은 값) |
| 대시보드 자동화 띠(지금 보내는 중 1건) | 보내는 중 캠페인 맨 위 | 여정 줄을 뺀 보내는 중 캠페인 맨 위(`exclude_journey=1`) |
| 성과 · 분석 숫자 | 누가 목록을 연 뒤에 여정 발송이 듦 | 그날이 지나고 10분 + 다음 5분 주기 안에 듦(D2) |
| 여정 통계 · 상세의 「실패」 카드 | B-1114-1 로 실패한 실행이 건수로 보임(사유 문구 없음) | 그 실패가 안 생김 · 화면 코드 변경 0 |
| 운영 경보 | 「여정 실행이 12번 연속 처리 오류」 | 안 생김 · 새 경보 = 「여정 단계 캠페인이 닫혀 있어 다시 열었습니다」(P3 나) · 「여정 자동 판정 위반」(§5) |

## 4 계약 시험(뿌리 R96 · 대상은 소스에서 기계로 뽑는다)

시험 파일 = `utils/__tests__/step-campaign-owner-1114.test.ts`(root-ledger.test.ts 는 다른 세션 미커밋이 있어 따로 둔다 · 대장 R96 줄이 이 파일을 가리킨다).

1. **추출** = 운영 코드 전 파일에서 `UPDATE|INSERT INTO|DELETE FROM campaigns` 문장(이음매 원장 §1 과 같은 패턴 · 지금 90).
2. **지문 표** — 여정 소유 파일(`journey-step-campaign.ts` · `journey-send-claim.ts`) 밖에서 일생 칸(`status` · `result_final` · `target_count` · `sent_count`)을 쓰는 UPDATE 와 모든 DELETE 는 **전부** 표(`파일#문장 지문` → 문장 수 · 여정 단계 캠페인에 닿지 않는 이유)에 있어야 한다. 지문 = 공백을 접은 문장 글의 해시. 표에 없는 문장 · 표에만 있는 줄 · 같은 글의 문장 수가 다름 = 빨간불(다시 판정). 글자 조건이 있는지로 통과시키는 규칙은 두지 않는다(`send_type = 'journey'` 처럼 여정을 고르는 조건 · OR 로 넓힌 조건도 「조건이 있다」를 만족한다). 이유의 근거 = 이음매 원장 §2-3 의 묶음.
3. **고정** — 닿는 네 문장(목록 CT · 굳힘 · 재대조 · 스위퍼)의 보호 조건을 문장 글 통째로 견준다 · 두 목록 라우트가 CT 를 부르고 인라인 완료 문장 0 · 굳힘 · 재대조가 판정 함수를 문장 앞에서 부름 · 재대조의 쓰는 호출이 읽은 상태를 싣는다 · 닫기가 주기 맨 앞 · `confirmLoadUnit` 이 다시 열기를 확정 문장 앞에서 한 번 부름 · 고르기의 이어 쓰는 두 갈래가 상태를 본다 · 자동 판정 tick 이 워커에서 불린다.
4. **변이** = 조건을 하나씩 뺀 판에서 빨간불 확인(문장의 여정 조건 · 보이는 상태 · 유예 · 표식 조건 · 단위 기록 조건 · 다시 열기 · 굳힘 풀기 · 굳힘 · 재대조의 건너뜀과 상태 조건 · 발송 수 · 새 문장 추가 · 있던 문장의 조건 넓히기 · 판정 여섯 항목 · 기록의 큰 값 남기기).

실 PG 시험(`step-campaign-owner-1114.pg.test.ts` · 운영 덤프 그릇 · 트리거 포함 · C134-DDL-1 적용): 닫기 문장의 값 범위 표 전부 · 다시 열기 뒤 확정이 트리거를 지남 · 목록 자동 완료가 여정 행을 안 바꿈 · 고르기가 완료 행을 이어 쓰지 않음 · 굳힘 · 재대조 문장이 읽은 뒤 바뀐 행을 안 덮음 · reconRows · 판정 여섯 항목 · 기록이 나빠지는 쪽으로만 남음 · 기록 없는 날에서 연속 일수가 끊김 · 흉내.

## 5 닫힘을 재는 장치(이음매 원장 §7 ② · ③)

| # | 무엇 | 어디 | 내용 | 이번 구현 |
|---|---|---|---|---|
| S1 | 밤 자동 판정 | 신설 `utils/journey-selfcheck.ts` · 부르는 곳 = `demo-data.ts` 워커 tick(합성 회사 키가 있을 때만 도는 그 워커) | 합성 회사(`syntheticDataCompanyIds` ∧ `isRealismCompany`)마다 하루 한 번(00:40 KST 뒤 첫 tick) DB 로 판정: ① 그날 실패로 끝난 실행 ② 그날 처리 오류가 난 실행(실행의 오류 기록 `error_log` 의 **오류 항목** 날짜로 센다 · 적재 시도 기록 `load_attempt` 는 오류가 아니라 뺀다 · 마지막 오류 시각은 다음 오류가 덮으므로 자정을 걸치면 앞 날이 빠진다 · 기록이 없는 옛 행만 마지막 오류 시각) ③ 그날 표식 가운데 1시간 10분 넘게 미확정이거나 증명 못 해 닫은 것(`load_unprovable` = 보냈는지 모른 채 포기) ④ 그날 시스템 탓으로 못 보낸 칸 기록(적재 실패 · 조건 판정 DB 오류 · 모르는 칸 종류 · 갈 칸 없음) ⑤ 닫힌 날인데 sending 인 단계 캠페인 ⑥ 대상 수 ≠ 발송 수인 단계 캠페인. 고객 · 설정 탓 사유(잔액 부족 · 조건 불충족 · 주문 취소 · 기다림)는 위반이 아니다. **관측과 재계산을 가른다**: 관측 = 어제 하루를 판정해 기록 표 `journey_selfcheck_daily`(C134-DDL-1)에 행을 만든다(행은 이것만 만든다) · 재계산 = 그보다 앞선 6일은 이미 행이 있는 날만 다시 판정해 **항목마다 큰 값만 남긴다**(표식이 뒤에 풀려 0 으로 읽혀도 처음 본 위반이 지워지지 않고, 늦게 드러난 위반은 더해진다 · 행을 만들지 않는다). 「연속 0 일수」 = 어제부터 거슬러 「기록이 있고 위반 0」인 날 수 · **기록이 없는 날(워커가 멈춘 날 · 처음 켜기 전)에서 끊긴다** → 처음 켠 날 1 · 연속 7 은 실제로 일곱 밤을 본 뒤에만 나온다. 위반 > 0 = 시스템 경보(회사 없이). 정보 줄 = 켜진 여정의 (시작 종류 · 채널) 가운데 7일 동안 한 번도 안 나간 것. 기록 표가 없으면(DDL 전) 판정 · 경보는 하되 연속 일수는 「기록 표 없음」으로 찍는다 | 구현 |
| S2 | 목록 여는 동작 흉내 | `journey-selfcheck.ts runListOpenMimic` | 합성 회사의 최근 캠페인 한 쪽(20건)을 목록 라우트와 같은 함수(`getCampaignResultCounts` → P1 CT)로 tick 마다 처리 = 오늘 결함의 방아쇠를 사람 없이 당긴다 | 구현 |
| S3 | 여정 세트를 서버가 만들고 켠다 | 합성 데이터 워커 | 켜기 관문에 「발송 전 문안 검증 통과 표식」이 있고(`journey-activation.ts:84`), 검증 본문은 이미 CT(`validateJourneyForActivation`)이고 표식을 찍는 자리는 라우트와 `journey-reshape.ts` 둘이다(★1115 정정 — 옛 문장 「라우트 본문뿐」은 틀렸다 · §12-0) → 서버 함수로 켤 수 있다 · **설계안 = §12 · Harold 동의 대기** | 설계안(§12) |

고객사에 여정을 여는 기준 = S1 의 연속 0 일수 7(제안값). 지금 인비토에 손으로 켜 둔 여정이 S1 · S2 의 표본이다. S3 이 없으면 「한 번도 안 탄 시작 종류」 줄이 길게 남는다(그 줄이 S3 의 필요를 매일 보여 준다).

## 6 영향표 · 미가입 동작 변화 0

| 고치는 파일 | 다른 세션 미커밋과 겹침 | 누가 그 동작에 기대나 | 바뀌는 것 |
|---|---|---|---|
| `routes/campaigns.ts`(보호 파일 · 목록 GET 만) | 없음 | 대시보드 · 캘린더 · 자동화 띠(`GET /api/campaigns`) | 여정 줄의 보이는 상태 = 저장값 · DB 쓰기에서 여정 행 빠짐 · 선택 값 `exclude_journey=1`(안 실으면 종전) |
| `routes/admin.ts`(관리자 목록) | 없음 | 슈퍼관리자 캠페인 목록 | 여정 줄의 보이는 상태 = 저장값 · DB 쓰기에서 여정 행 빠짐 |
| `utils/campaign-sync-worker.ts` | 없음 | 발송결과 캐시(result_final) · 후불 청구(completed 선정) | 여정 행은 닫힌 날부터 굳힘 · 재대조 · 여정 발송 수 안 올림 · 쓰는 두 문장에 상태 조건 · 주기 앞에 닫기 한 문장 |
| `utils/journey-step-campaign.ts` · `utils/journey-send-claim.ts` | 없음 | 여정 실행기(묶음 발송) · 표식 정리 | 완료 행을 이어 쓰지 않음 · 확정 앞 다시 열기 · 닫기 |
| `utils/demo-data.ts`(tick 에 한 덩이) | 없음 | 합성 데이터 워커 | 합성 회사에만 판정 · 흉내 |
| `frontend LiveAutomationStrip.tsx`(주소 한 줄) | 없음 | 대시보드 자동화 띠 | 여정 줄을 뺀 보내는 중 캠페인 |
| 신설 `utils/campaign-list-autocomplete.ts` · `utils/journey-selfcheck.ts` · 시험 둘 | — | — | — |

미가입 · 직접발송만 쓰는 회사: 여정 행(`send_type = 'journey'`)이 없다 → P1 의 여정 갈래에 걸리는 행 0 · `exclude_journey` 로 빠지는 행 0 · P2 · P3 의 대상 0 · S1 · S2 는 합성 회사만. 직접 · AI · 자동 · 대행 캠페인: 자동 완료 = 종전과 같은 id 를 고르고 같은 값으로 바꾼다(시험 = 종전 인라인 판정과 견줘 빠진 것이 여정 행뿐). 굳힘 = 후보가 이미 `status IN ('completed','failed')` 로 골라지므로 쓰는 문장의 같은 조건은 읽은 뒤 상태가 바뀐 행만 뺀다. 재대조 = 쓰는 값은 종전과 같고(`CASE` 의 여정 아닌 갈래 = 종전 식) 읽은 뒤 상태가 바뀐 행만 다음 주기로 미룬다. 굳은 행을 다시 고르는 기준은 `reconRows` 가 없는 행에서 `GREATEST(sent_count, 0)` = 종전 `sent_count` 와 같다.

DDL 1(C134-DDL-1 · 새 표 하나 · 배포 앞 · 없어도 서버는 뜬다) · ENV 0 · 재시작 1(백엔드) · 프론트 빌드 1.

## 7 배포 · 확인

1. 배포 = 런북 그대로: C134-DDL-1 → pull → 백엔드 build:safe → 프론트 build:safe → 적재 0 확인 → 재시작.
2. 배포 뒤 확인(서버 · 원장 C134-H1): dist grep(`closeFinishedStepCampaigns` · `applyListAutoComplete` · `reopenStepCampaignForConfirm` · `runJourneySelfcheck`) · 에러 로그에서 「적재 중 표식 정리 실패 campaign=998900e1」 이 멎음 · `SELECT status, result_final, target_count, sent_count FROM campaigns WHERE id = '998900e1-…'` = 다시 열렸다 닫힘 · 그 표식이 sent.
3. 다음 날 아침(원장 C134-S1): `[journey-selfcheck]` 로그 줄(위반 0 · 연속 일수 1/7) · `journey_selfcheck_daily` 행.

## 8 Harold 결정(구현 밖)

- **S3 여정 세트 자동 켜기**: 설계안 = §12(★1115 · 세트 표 11개 · 스위치 ENV · 순서 추천 = C134 와 같은 커밋). Harold 동의 대기.
- 닫힘 기준 7일(제안값).

## 9 설계 Codex 1R(needs-attention 7건) 반영

| # | 지적 | 반영 |
|---|---|---|
| 1 | 재대조가 읽은 뒤 여정이 다시 연 행을 옛 상태로 덮는다 · 굳힘도 읽은 뒤 재검증 없이 굳힌다 | P4 쓰는 두 문장에 상태 조건 · 재대조는 여정 행의 상태를 안 씀 · 실 PG 시험에 「읽음 → 다시 열기 → 쓰기」 순서 |
| 2 | 증명 못 하고 포기한 발송이 판정 다섯 항목에서 전부 0 | S1 ③ 에 `load_unprovable` · ④ 시스템 탓 못 보낸 칸 기록 신설(여섯 항목) |
| 3 | 여정 발송 수를 안 올리면 늦게 오는 대체 결과가 재대조 대상에서 영구히 빠진다 | P5 `reconRows` · 다시 고르는 기준 `GREATEST(sent_count, reconRows)` |
| 4 | 지금 DB 를 다시 계산하는 방식으로는 과거의 위반이 사라진다 · 못 본 날을 가를 기록이 없다 | S1 기록 표(C134-DDL-1) · 큰 값만 남김 · 기록 없는 날에서 끊김 |
| 5 | P1 이 상태 필터 · 쪽 · 자동화 띠의 응답을 바꾼다(「응답 불변」이 거짓) | 여정 줄의 보이는 값 = 저장값으로 정하고 §3-2 에 바뀌는 화면을 적음 · `exclude_journey` |
| 6 | 글자 조건 분류는 여정 배제를 증명하지 않는다 | §4 지문 표(일생 칸을 쓰는 여정 밖 문장 전부) · 부정 사례(여정을 고르는 조건 · OR 확장 · 새 삭제 문장) |
| 7 | 닫힌 빈 캠페인이 끝없는 재대조 후보가 된다 | P2 빈 캠페인은 닫으면서 굳힘(증명 못 한 표식이 있으면 굳히지 않음) |

## 10 구현 Codex 반영

| 라운드 | 지적 | 같은 뿌리인가 | 반영 |
|---|---|---|---|
| 1R | 매번 지난 7일을 전부 넣어, 처음 켠 날 · 며칠 멈춘 뒤에도 흔적만 없으면 바로 7/7 이 된다 | 설계 1R 4번과 같은 부류(지난 날을 지금 다시 계산해 정상으로 만든다) → 낱개 수정이 아니라 「관측 = 어제 하루만 행을 만든다 · 재계산 = 있는 행만」으로 구조를 가름 | `persistVerdict(…, observe)` 한 문장 안의 조건 · 실 PG 시험 = 처음 1 · 일곱 밤 뒤 7 · 하루 못 보면 그날에서 끊김 |
| 1R | 오류 실행을 마지막 오류 시각으로만 세어 자정을 걸친 오류의 앞 날이 0 | 새 지적(날짜 기준 칸) | 오류 기록 `error_log` 항목의 날짜로 센다(`ERRORED_ON_DAY_SQL`) · 실 PG 시험 = 23:58 과 00:03 오류 · 배열이 아닌 옛 값 · 시각 꼴이 아닌 항목 |
| 2R | 오류 기록에는 오류가 아닌 항목(적재 시도 기록 `load_attempt` · 정상 발송 앞에도 남고 마지막 칸에서는 안 지워진다)이 있어 정상 발송일이 오류일로 세어진다 | 1R 2번 수정이 만든 것(새 자료의 항목 종류를 안 가렸다) | `ERRORED_ON_DAY_SQL` 에 `reason IS DISTINCT FROM 'load_attempt'`(실행기 `loadAttemptsSql` 이 가르는 값과 같다) · 계약 시험 = 실행기가 오류 기록에 넣는 항목 종류 전수(처리 예외 · 적재 실패 · 적재 응답 모름 · 조건 판정 DB 오류 + 적재 시도)를 소스에서 뽑아 고정 · 실 PG 시험 = 지난 오류 뒤 다른 날 정상 발송하고 끝난 실행(정상 발송일 0 · 오류일 1) |
| 3R | 지적 0 | — | approve(1115 00:02) |

## 11 커밋 경로 · 커밋 문안 · 커밋 전 남은 것(★1115 S3 를 같은 커밋에 실음)

**커밋 전 남은 것 하나** = C133 C + D 커밋(Harold) 뒤, `packages/backend/src/routes/ai.ts` 의 켜기 전 점검 라우트(4531 ~ 4561행)에 인라인으로 남은 「검사 시작 판 잡기 → 검증 → 같은 판일 때만 통과 표식」 세 줄을 CT `pretestAndMark`(`utils/journey-pretest-mark.ts`) 호출로 바꾼다(같은 뜻 · 응답 꼴 · 시연 회사 비용 0 처리 그대로 · Codex 증분 1회). 그 파일은 다른 세션(C133 C + D)의 미커밋 변경이 있고, 바꾼 줄은 이 카드의 새 파일을 들이므로 그 커밋보다 먼저 넣으면 그 커밋이 혼자 서지 못한다 → 뒤에 한다. 그때까지 계약 시험 `journey-selfcheck-set-1115.test.ts` 의 한 건(「통과 표식을 찍는 문장은 CT 한 곳」)이 빨간불이다 = 의도한 커밋 조건(면제 목록에 올리지 않는다).

**★1115 16:0x 위 한 걸음을 앞당겨 했다(커밋 전 남은 것 0)** — 위 빨간불 1건이 pre-push 관문(작업 트리에서 backend 단위 전체)에서 C135 커밋 03e5d935 의 push 를 막았다(`--no-verify` 금지) → Harold 「처방을 하고 배포명령어를」. 바꾼 것 = `routes/ai.ts` 의 import 두 줄과 켜기 전 점검 라우트(4521 ~ 4559행): 시연 회사 읽기를 표식 앞으로 → CT `pretestAndMark` → 표식 뒤에 `trigger_event` · `start_kind` 를 읽어 발송 갈래 한 줄(검증 앞에서 따로 읽으면 그 읽기와 CT 의 판 잡기 사이에 시작 조건이 바뀐 여정이 옛 갈래 문장을 단 채 통과로 답한다) → 통과인데 표식이 안 찍혔으면 종전과 같은 stale 응답. 응답 꼴 · 문장 그대로 · CT 무수정(실 PG 통과 기록 그대로). 확인 = tsc 0 · 단위 전체 821파일 13,237 전부 통과(1115 16:07) · Codex 증분 1R approve(지적 0). **커밋 순서가 바뀐다** = `routes/ai.ts` 가 이 카드의 새 파일 `utils/journey-pretest-mark.ts`(이 카드가 고친 `utils/journey-pretest-validator.ts` 에 기댄다)를 들인다 → `routes/ai.ts` 를 싣는 커밋(C133 C + D)은 이 카드 커밋보다 뒤이거나 한 커밋이어야 혼자 선다(커밋 자족 실측으로 확인한 뒤 올린다).

실 PG 전체 통과 기록(스탬프)은 1115 09:16 에 찍혔다(실 PG 전체 82파일 756 통과(1115 09:16 · 통과 기록 찍힘)). 그 뒤 실 PG 시험이 들이는 CT 를 고치면 다시 찍는다(라우트 한 파일만 바꾸면 그대로다).

**★1116 커밋 순서 바꿈 = C134 먼저 홀로**(1116 14:45 같은 결함이 운영에서 다시 남 · 캠페인 b3753555 · 합성 회사 · BUGS B-1114-1 ★1116 줄 · Harold 「진짜 결함이란말 따위 다시 안나오게 꼼꼼히 수정해라」). C133 C + D 는 배포 앞 DDL · ENV 가 남아 있어 이 처방을 기다리게 할 수 없다. 겹치는 세 파일은 이 카드 절만 담은 패치(`scratch/c134/partial.patch` = `routes/ai.ts` 절 2(import · 켜기 전 점검 라우트) · `journey-builder.ts` 절 2(draftOnly 다섯 줄) · `root-ledger.test.ts` 절 3(R6_CLOSERS `campaigns|sending` · NULL_OK 세 줄 · R37 재대조 글))를 index 에만 얹는다(`journey-builder.ts` 의 `journeyCopyContext` 넷째 인자 두 절 · `routes/ai.ts` 의 미리보기 `recoIndex` 두 절 · `root-ledger.test.ts` 의 C133 · C136 절 다섯은 작업 트리에 남는다). 아래 경로 가운데 `status/SCHEMA.md` 는 이미 커밋돼 있어 빠지고, `utils/journey-pretest-validator.ts` 의 작업 트리 변경은 전부 C133(추천 자리)이라 싣지 않는다(`journey-pretest-mark.ts` 가 쓰는 `validateJourneyForActivation` · `ValidationResult` · `StepSpamParams` · `StepSpamTestResult` 는 HEAD 에 있다). 커밋 자족 = 커밋 판 사본(작업 트리 diff 를 거꾸로 적용해 HEAD 를 되살리고 blob 해시 대조 · 이 카드 파일만 얹음 · 다른 카드 새 파일 70 뺌)에서 backend tsc 0 · frontend tsc 0 · 단위 전체 820파일 통과 · 실 PG 전체 83파일 664 통과(1116).

**커밋 순서(1115 판 · 위 ★1116 으로 바뀜)** = C133 C + D 커밋 뒤. 같은 파일이 둘이다.

- `packages/backend/src/utils/__tests__/root-ledger.test.ts` — C133 C + D 의 미커밋과 이 카드의 세 자리(R6_CLOSERS `campaigns|sending` · NULL_OK 세 줄 · R37 재대조 글 고정)가 함께 있다.
- `packages/backend/src/utils/journey-builder.ts` — C133 C + D 의 미커밋과 이 카드의 다섯 줄(`activateJourney` 의 다섯째 인자 `draftOnly` · 기본값 거짓 · 초안 판정 한 번)이 함께 있다. 이 다섯 줄은 더하기만이고 이 카드의 다른 파일에 기대지 않는다 = C133 커밋에 함께 실려도 빌드 · 동작이 같다(안 주면 종전 그대로 · 주는 곳은 이 카드의 `journey-activation.ts` 뿐).

경로(이 카드 · S3 포함):

```text
packages/backend/src/utils/journey-step-campaign.ts
packages/backend/src/utils/journey-send-claim.ts
packages/backend/src/utils/campaign-list-autocomplete.ts
packages/backend/src/utils/campaign-sync-worker.ts
packages/backend/src/utils/journey-selfcheck.ts
packages/backend/src/utils/journey-selfcheck-set.ts
packages/backend/src/utils/journey-pretest-mark.ts
packages/backend/src/utils/journey-reshape.ts
packages/backend/src/utils/journey-activation.ts
packages/backend/src/utils/demo-data.ts
packages/backend/src/routes/campaigns.ts
packages/backend/src/routes/admin.ts
packages/backend/src/routes/ai.ts
packages/frontend/src/components/dashboard/LiveAutomationStrip.tsx
packages/backend/src/utils/__tests__/step-campaign-owner-1114.test.ts
packages/backend/src/utils/__tests__/step-campaign-owner-1114.pg.test.ts
packages/backend/src/utils/__tests__/journey-selfcheck-set-1115.test.ts
packages/backend/src/utils/__tests__/journey-selfcheck-set-1115.pg.test.ts
packages/backend/src/utils/__tests__/journey-send-claim-resolve-0926.test.ts
packages/backend/src/utils/__tests__/journey-remaining-1111.test.ts
packages/backend/src/utils/__tests__/line-reassignment-resilience.test.ts
packages/backend/src/utils/__tests__/root-ledger.test.ts
docs/2026-11-14-journey-step-campaign-owner-design.md
docs/2026-11-14-journey-step-campaign-seam-ledger.md
docs/ROOT-LEDGER.md
status/SCHEMA.md
status/BUGS.md
status/STATUS-FEED.md
status/DEPLOY-LEDGER.md
```

(`routes/ai.ts` = 위 「커밋 전 남은 것」의 세 줄을 바꾼 뒤 · `journey-builder.ts` 는 C133 C + D 커밋이 이 카드의 다섯 줄 없이 이미 끝났을 때만 이 목록에 더한다.)

커밋 문안(한 줄 · 뒤에 원장 해시 채우기는 종전 절차):

```text
1115 C134 여정 단계 캠페인은 여정만 닫는다(접수 B-1114-1 · 뿌리 R96 신설 · Harold 「구현까지 완벽하게 전부 다 마무리하고 코덱스리뷰 닫힐때까지」 · 설계서 docs/2026-11-14-journey-step-campaign-owner-design.md · 흐름 표 docs/2026-11-14-journey-step-campaign-seam-ledger.md) = 결함 = 캠페인 목록 조회 두 곳(사용자 · 관리자)이 결과가 다 왔다며 열린 날의 여정 단계 캠페인(send_type journey · 칸 하나가 하루 동안 이어 쓰는 행)을 completed 로 바꿈 → 여정의 확정 문장(대상 수 + n)이 완료 행 보호 트리거에 막혀 그날 그 칸 발송 멈춤(1114 운영 998900e1 · 합성 회사 · 실행 12번 오류 뒤 실패) / 처방 = 목록 자동 완료를 CT utils/campaign-list-autocomplete.ts 한 곳으로(여정 행 = 보이는 상태 저장값 · 닫는 문장에서 제외 · 대시보드 자동화 띠 exclude_journey=1) · 여정이 닫는다 closeFinishedStepCampaigns(날 지남 + 유예 10분 + 미확정 표식 0 + 단위 기록 없음 · 아무것도 안 나간 빈 캠페인은 닫으면서 굳힘 · campaign-sync-worker 5분 주기 맨 앞) · 이어 쓸 때 상태 sending 확인 + 확정 앞 다시 열기 reopenStepCampaignForConfirm(굳힘도 품 · 열면 경보) · 굳힘 · 재대조 = 닫힌 날의 여정 행만 · 쓰는 두 문장에 읽은 상태 조건(읽은 뒤 바뀐 행 0행) · 재대조가 여정 발송 수를 큐 행 수로 올리지 않음(선불 정산이 적재 수로 읽는 값 · 큐 행 수 = send_config.reconRows 로 따로 · 굳은 행을 다시 고르는 기준) · 운영의 걸린 행 = 배포 뒤 표식 정리 주기가 스스로 다시 열어 확정(수동 SQL 0) / 닫힘을 재는 장치 = utils/journey-selfcheck.ts(합성 회사만 · 목록 여는 동작 흉내 tick 마다 · 밤 자동 판정 여섯 항목 = 실패 실행 · 오류 실행(오류 기록의 오류 항목 날짜 · 적재 시도 기록 제외) · 안 풀린 표식 · 시스템 탓 못 보냄 · 안 닫힌 단계 캠페인 · 대상 수 ≠ 발송 수 · 관측 = 어제 하루만 행을 만들고 재계산 = 있는 행만 큰 값으로 · 기록 없는 날에서 연속 0 일수가 끊김 · 기록 표 journey_selfcheck_daily C134-DDL-1) / S3 합성 회사 여정 세트(Harold 「네, 설계해」 → 「설계서 코덱스리뷰 닫힐때까지 돌리고 닫히고나면 구현까지」 · 설계서 §12) = utils/journey-selfcheck-set.ts · 스위치 ENV JOURNEY_SELFCHECK_SET_COMPANY_IDS 에 적힌 합성 회사에만(비면 아무것도 안 함) 시작 종류 11개(신규 가입 · 첫 구매 · 주문 완료 · 상품 구매 · 휴면 전환 · 휴면 복귀 · 구매 주기 이탈 · 생일 · 포인트 소멸 · 장바구니 · 조회 후 미구매 · 문자 칸 14 = LMS 11 + SMS 3 · 글은 코드에 고정 · 혜택 · 링크 0)의 여정을 사람이 화면에서 하는 순서 그대로 운영 함수로(만들기 → 칸 알림 끔 → 발송 전 검증 + 통과 표식 → 켜기 관문 · 최대 인원 200) · 낮 09 ~ 18시 · 한 tick 에 행 하나 · 워커가 직접 쓰는 표 = 자기 원장 journey_selfcheck_set(C134-DDL-2 · 회사 · 세트 키 PK) 하나 · 신원 = 원장 행이 가리키는 여정(이름과 무관) · 다 만들고 알림까지 끈 뒤에만 잇고 이어진 여정만 검증 · 켠다 · 만들기 · 검증은 시도를 시작하는 UPDATE 가 다음 시도 시각(하루 뒤) · 횟수(판마다 5)를 먼저 쓴다(재기동해도 이어짐 · 검사 중 = 30분 뒤 · 글 문제 = 판 번호를 올려야 다시) · 판 올림 = 원장 한 문장(여정을 지우지 않는다 · 옛 초안은 안 이어진 채 남는다) · 켜기 = 원장 행을 잠근 채 이어진 여정 · 판을 다시 확인 + 초안일 때만(activateJourney 다섯째 인자 draftOnly = 켜는 트랜잭션이 잠근 여정 행의 상태로 판정 · 안 주면 종전 그대로) · 워커는 지우지 · 멈추지 · 끝내지 · 다시 켜지 않는다 · 검증 + 통과 표식 세 줄을 CT utils/journey-pretest-mark.ts 로 모음(reshape · 켜기 전 점검 라우트 · 워커) / 미가입 · 직접발송만 쓰는 회사 = 변화 0(여정 행 없음 · 여정 아닌 캠페인의 자동 완료 · 굳힘 · 재대조 · 발송 수는 종전과 같은 값 · 세트 워커는 스위치 ENV 가 빈 채 배포) / 시험 = 계약 step-campaign-owner-1114 22건(campaigns 를 쓰는 문장 90 기계 추출 · 여정 소유 파일 밖에서 일생 칸을 쓰는 문장 전부 = 지문 표 27줄 32문장) · 실 PG 26건(트리거 포함) · 변이 45 전부 빨간불 · S3 계약 journey-selfcheck-set-1115 23건(세트 표 ↔ 시작 종류 등록부 기계 대조 · 글 규칙 · 정의 지문 ↔ 판 번호 · 워커 소스에 지우는 호출 0 · 통과 표식 문장의 자리) · 실 PG 33건(진짜 세트 11개가 만들기 · 보낼 글 판정 · 켜기 관문을 전부 지남 · 경쟁 상황 넷) · 변이 61 중 60 빨간불 + 동등 1 · 옛 글자 고정 시험 9건을 같은 뜻으로 옮김 · tsc 0 · 0 · 단위 전체 820파일 13,193 중 13,192 통과(남은 1 = 라우트의 통과 표식 계약 = 커밋 조건) · 실 PG 전체 82파일 756 통과(1115 09:16 · 통과 기록 찍힘) · Codex 설계 1R(7건 반영) + 구현 3R approve · S3 설계 4R approve(8건 반영) · S3 구현 4R approve(2건 반영) / DDL 2(C134-DDL-1 · C134-DDL-2 · 배포 앞 · 없어도 서버는 뜬다) · ENV 0(배포 뒤 C134-S1 을 본 다음 C134-ENV-1 = 인비토 회사에 여정 세트 켜기) · 백엔드 재시작 1 + 프론트 빌드
```

## 12 S3 설계안 — 여정 세트를 서버가 만들고 켠다(1115 Harold 「네, 설계해」 → 「설계서 코덱스리뷰 닫힐때까지 돌리고 닫히고나면 구현까지」)

### 12-0 앞 절 정정(1115 소스 다시 읽음)

§5 S3 · §8 에 적었던 「표식을 찍는 길은 `routes/ai.ts:4545` 라우트 본문뿐 → 검증 본문을 CT 로 빼야 한다」는 틀렸다.

- 검증 본문은 이미 CT 다 = `validateJourneyForActivation`(`utils/journey-pretest-validator.ts:76`).
- 표식(`last_pretest_passed_at = NOW()`)을 찍는 자리는 둘이다 = 라우트(`routes/ai.ts:4531 ~ 4561`) · `utils/journey-reshape.ts:141 ~ 157`. 뒤쪽은 서버 함수 안에서 「판 잡기 → 검증 → 같은 판일 때만 표식 → 켜기 관문(`activateJourneyGuarded`)」을 요청 토큰 없이 이미 한다.

→ S3 는 `routes/ai.ts` 를 고치지 않고 만들 수 있다. 같은 세 줄이 세 번째로 생기므로 CT 로 모은다(12-3).

### 12-1 무엇을 · 범위

합성 회사(스위치 ENV 에 적힌 회사 ∧ `isRealismCompany`)에 12-4 세트 표의 여정이 켜져 있게 한다. 사람이 화면에서 하는 순서 그대로(만들기 → 발송 전 검증 → 켜기 관문) · 같은 함수로 지난다. 여정 표에 직접 쓰기 0(합성 회사 설계서 불변식 3 「진짜 경로만」과 같다). 워커가 직접 쓰는 표는 자기 원장 하나(12-2 `journey_selfcheck_set`)뿐이다.

S1 이 재는 길 = 진입 · 기다림 · 적재 · 확정 · 닫기 · 정산까지. 합성 번호는 통신사에서 실패로 끝나므로 도달 뒤 길(클릭 · 구매 귀속)은 S3 로도 돌지 않는다 = 합성 회사 설계서(`docs/2026-11-10-synthetic-company-realism-design.md`) §8 의 2층 · 3층 몫. 그 문서의 「여정 켜기는 2층 뒤」 순서를 이 설계가 앞당긴다(손으로 켠 여정이 이미 돌고 있고 B-1114-1 을 그 여정이 찾았다).

### 12-2 원장 표 · 흐름 표(판정 자리 · 값 범위 · 그리는 화면)

**원장 표(C134-DDL-2 · 새 표 하나 · 배포 앞 · 없으면 S3 만 쉰다)**

```sql
CREATE TABLE IF NOT EXISTS journey_selfcheck_set (
  company_id       uuid        NOT NULL,
  set_key          text        NOT NULL,
  journey_id       uuid,
  def_rev          integer     NOT NULL,
  validations      integer     NOT NULL DEFAULT 0,
  next_validate_at timestamptz,
  last_reason      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, set_key)
);
```

- 세트 여정의 신원 = 이 표의 한 행(회사 · 세트 키 = PK)이 가리키는 `journey_id` 하나. 여정 이름과 무관하다(이름은 화면 표시일 뿐 · 사람이 고쳐도 워커는 같은 여정을 본다).
- `def_rev` = 그 여정을 만든 세트 정의의 판 번호(코드의 세트 표 행마다 정수 · 글이나 칸 구성을 고치면 올린다).
- `validations` · `next_validate_at` = 유료일 수 있는 검증 시도의 횟수 · 다음 시도 가능 시각. **시도를 시작하는 문장이 함께 쓴다**(T9 · `LESSONS_BACKEND` 1102 「재시도 상한의 근거는 사전 · 원자」).
- `journey_id` 에 외래 키를 두지 않는다(사람이 여정을 지우면 행이 남아 「사람이 지움」으로 읽힌다 = 다시 만들지 않는다).

| # | 단계 | 판정 자리 | 값 범위 | 화면 |
|---|---|---|---|---|
| T1 | 대상 회사 | 새 ENV `JOURNEY_SELFCHECK_SET_COMPANY_IDS` ∩ `isRealismCompany`(`demo-data.ts:527`) | 빈 값 = 꺼짐(배포해도 변화 0) · 합성 회사가 아닌 id = 버림 | — |
| T2 | 때 | `demo-data.ts` tick(10분) · 09:00 ~ 18:00 KST · **한 tick 에 세트 행 하나**(일이 남은 첫 행 · 일 = 만들기 · 검증 시도 · 켜기 성공 · 한 행은 갈 수 있는 데까지 한 번에 간다 · 기다림 · 읽기뿐인 켜기 거절은 일로 치지 않아 뒤 행이 굶지 않는다) | 창 밖 = 아무것도 안 함 | — |
| T3 | 만든 계정 | 담당자 알림을 받는 계정과 같은 판정 = `pickOwnerContact(회사, null)`(`owner-contact.ts` · 활성 · 시스템 아닌 관리자 중 휴대폰 번호가 유효한 첫 계정) | 없음 = 만들지 않음(하루 한 번 로그) | 여정 목록 「만든 사람」 |
| T4 | 보내는 번호 | `defaultCallbackOf(listJourneyCallbackNumbers)`(`journey-draft-save.ts:26` · 문장으로 만들기와 같은 규칙) | null(기본 번호 없음 · 여럿) = 만들지 않음(로그) | 여정 [시작] 카드 |
| T5 | 원장 행 | `INSERT … ON CONFLICT (company_id, set_key) DO NOTHING` 뒤 읽기 | 표 없음(42P01 · DDL 전) = S3 전체를 쉰다(하루 한 번 로그) | — |
| T6 | 판 올림 | **한 문장** = `UPDATE journey_selfcheck_set s SET journey_id = NULL, def_rev = $새 판, validations = 0, next_validate_at = NULL WHERE … AND s.def_rev < $새 판 AND (s.journey_id IS NULL OR EXISTS (SELECT 1 FROM journeys j WHERE j.id = s.journey_id AND j.status = 'draft'))` | 여정 없음 · 이어진 여정이 초안 = 원장만 새 판으로 비운다(옛 초안은 **지우지 않고** 안 이어진 초안으로 남긴다) → 다음 tick 에 새 글로 새 여정을 만든다 · 이어진 여정이 켜짐 · 멈춤 · 끝 · 보관 · 사람이 지움 = 0행 = 원장도 여정도 그대로(켠 적 있는 여정의 글은 워커가 바꾸지 않는다) | 여정 목록 |
| T7 | 만들기(원장에 여정 없음 · **원장 판 = 이 코드의 정의 판일 때만**) | **만들기 시도 잡기 한 문장**(`UPDATE … SET next_validate_at = NOW() + 1일 WHERE journey_id IS NULL AND def_rev = $정의 판 AND 때가 됨 RETURNING` = 만든 뒤 실패가 되풀이돼도 그 행은 하루에 한 번만 만든다 · 구현하며 더함) → `createJourneyFromTemplate({ steps: 12-5 고정 글 })`(`journey-builder.ts:310`) → 문자 칸마다 담당자 알림 끔(`updateJourneyStep` `notifyManagerOnPretest: false` · 하나라도 거짓 · 던짐 = 잇지 않는다) → **다 끝난 뒤** 원장에 잇는다(`UPDATE … SET journey_id = $id WHERE journey_id IS NULL AND def_rev = $정의 판`) · `$정의 판` = 그 여정의 칸 · 글을 만든 **같은 코드 정의 행의 판 번호**(원장에서 읽은 값이 아니다) | 원장 판 > 정의 판(옛 코드가 돈다 = 되돌린 배포 · 새 판 워커가 먼저 지나감) = 그 행 전체를 쉰다(만들기 · 검증 · 켜기 0 · 하루 한 번 로그) · 거절(`JourneyInputError`) = 사유 기록 · 그 행은 그날 그만 · 만들다 죽음(여정 행만 · 칸 일부 · 알림 끄기 전) = 원장에 안 이어진 초안이 남는다 → **워커는 이어진 여정만 검증 · 켠다** · 다음 tick 이 새로 만든다 · 잇는 문장이 0행(그사이 판이 올랐다) = 방금 만든 초안도 안 이어진 채 둔다 · 안 이어진 초안 수 = 하루 줄 | 여정 목록(초안) |
| T8 | 이어진 여정의 상태 | 원장의 `journey_id` 로 여정 행 읽기 | 행 없음(사람이 지움) · 켜짐 · 멈춤 · 끝 · 보관 = 아무것도 안 함(다시 켜지 않는다 · 다시 만들지 않는다) · 초안 + 표식 없음 → T9 · 초안 + 표식 있음 → T10 | 여정 목록 |
| T9 | 검증(표식이 없을 때만) | **시도 잡기 한 문장** = `UPDATE journey_selfcheck_set SET validations = validations + 1, next_validate_at = NOW() + INTERVAL '1 day' WHERE … AND journey_id = $id AND validations < 5 AND (next_validate_at IS NULL OR next_validate_at <= NOW()) RETURNING` → 잡혔을 때만 새 CT `pretestAndMark`(12-3 · 검사 시작 판을 잡아 같은 판일 때만 표식) | 통과 + 표식 → T10 · 검사 중 · 확인 중 · 검증하는 사이 판 바뀜 = 다음 시도를 30분 뒤로 당긴다(같은 날 같은 글 = 같은 검사 이어 보기 · `spam-test-queue.ts:613 ~ 630` · 당기는 쓰기가 실패하면 하루 뒤 = 덜 쓰는 쪽) · 검사 장애 = 하루 뒤 그대로(장애 결과는 재사용되지 않아 다시 걸면 새 검사다) · 차단 · 글 문제 = 다음 시도 없음(`infinity`) + 경보 한 번 → 판 올림(T6)으로만 풀린다 · 다섯 번을 다 씀 = 경보 한 번 · 그 뒤 시도 0 | 켜기 전 점검 |
| T10 | 켜기(표식이 있을 때) | **원장 행을 잠근 트랜잭션 안에서**(`SELECT … FOR UPDATE` · 켜기가 끝날 때까지 쥔다 · 구현 Codex 1R) 이어진 여정 id · 판을 다시 확인한 뒤 `activateJourneysInOrder`(`journey-activation.ts` = [모두 켜기]와 같은 함수 · 겹침 확인 · 크레딧 합계 · 관문 전부) · **초안일 때만**(`draftOnly` = 켜는 함수 `activateJourney` 가 자기 트랜잭션에서 잠근 여정 행의 상태로 판정) · 겹침 쌍 = `unresolvedOverlapPairs` 가 준 쌍을 「같이 받기」로 싣는다 · 최대 인원 = 200(`caps`) · 판 올림(T6)도 같은 원장 행 잠금을 얻은 뒤에 문장을 낸다(켜기와 직렬 · 켜기가 커밋한 여정 상태를 본다) | 크레딧 부족 · 시작 종류 잠김(데이터 없음) · 정의 검사 거절 = 사유 기록 · 다음 tick 에 다시(읽기뿐 = 유료 검사 0 · 표식이 남아 T9 를 다시 지나지 않는다) | 여정 목록(켜짐) · 지도 |
| T11 | 하루 한 줄 | `[journey-set]` 로그 = 세트 11 중 켜짐 · 초안 · 멈춤 · 끝 · 사람이 지움 · 검증 횟수 다 씀 · 안 이어진 초안 수 · 못 켠 사유 | — | — |

**워커는 여정을 지우지 않는다**(설계 Codex 2R #1): 판을 올릴 때 옛 초안을 지우던 단계를 뺐다. 지우기(`deleteJourney`)는 켜진 여정만 거절하고 지우는 문장에 상태 조건이 없어, 초안이라고 읽은 뒤 사람이 켰다 멈춘 여정을 실행 · 발송 기록째 지울 수 있었다. 판 올림 = 원장 한 문장뿐이고 옛 초안은 안 이어진 초안으로 남는다(하루 줄에 수가 찍힌다 · 화면에서 사람이 지운다 · 새 판 여정은 이름 끝에 「(판 N)」이 붙어 가려진다). 원장을 비운 뒤 사람이 옛 초안을 켜면 = 같은 시작 종류 두 여정(아래 문단과 같은 상태).

**이어진 뒤 사람이 고친 것은 그 사람이 정한 값이다**(옛 「모양 대조 → 사람이 고친 초안은 켜지 않는다」 삭제 · 설계 Codex 2R #2): 부분 초안을 막는 장치는 T7 의 「다 만든 뒤 잇기」 하나로 충분하다(안 이어진 초안은 워커가 켜지 않는다). 이어진 초안을 사람이 화면에서 고치면 — 글 · 구조 수정은 표식을 지우므로 T9 가 그 글로 다시 검증하고(판이 바뀐 사이의 검증은 표식을 못 찍는다 = `pretestAndMark` 의 판 조건), 간격 · 담당자 알림만 고치면 표식이 남아 그 값대로 켜진다(제품이 검증 없이 켜도 된다고 정한 수정 · `keepsPretestMarkerForStep`). 워커가 켜는 문장에 「대조한 판」 조건을 실으려면 `journey-builder.ts activateJourney` 의 켜는 UPDATE 를 고쳐야 하는데 그 파일은 다른 세션 미커밋이고, 지킬 근거도 약하다(사람이 직접 정한 값을 워커가 막을 이유가 없다) → 약속하지 않는다.

**유료 검사 상한**: 세트 행 하나 · 판 하나에 검증 시도 ≤ 5 → 유료 검사 등록 ≤ 5 × 그 행의 문자 칸 수(1 ~ 2). 세트 전체 = 14칸 × 5 = 70건이 위쪽 끝(정상 = 14건). 재기동해도 횟수는 원장에 남는다.

**손으로 켠 같은 시작 종류와 함께 켜질 수 있다**(옛 T6 「덮였나 → 안 만듦」 삭제 · 설계 Codex 1R #3): 같은 시작 종류의 두 여정은 제품이 허용하는 상태다(겹침 판정 `computeOverlapPairs` 는 서로 다른 사건끼리만 본다 · `journey-lifecycle-map.ts:565`). 워커가 사람의 켜기와 한 잠금을 나눌 길이 없어 「하나만 켠다」를 약속할 수 없다 → 약속하지 않는다. 결과 = 그 시작 종류의 합성 고객이 두 통을 받는다(합성 번호 = 도달 0 · 발송 수만 는다) → 원하면 손으로 켠 쪽을 끝낸다.

**담당자 알림을 끄는 이유(T7)**: 칸 알림 기본값(`notify_manager_on_pretest` NULL = 첫 · 마지막 문자 칸 켬 · `journey-step-notify.ts`)이면 보내기 전 안내 · 보낸 결과 안내(칸 · 날짜당 많아야 두 통 · `journey-result-notice.ts`)가 **만든 계정의 실제 휴대폰**으로 간다(`owner-contact.ts pickOwnerContact`). 세트 14칸이면 하루 최대 28통이 사내 사람에게 간다 → 끄고 만든다(다 끈 뒤에만 원장에 잇는다 = 워커가 켜는 여정은 알림이 꺼진 채 이어진 것 · 그 뒤 사람이 화면에서 켜면 그 사람이 정한 값). 시스템 멈춤 안내(`journey-pause-notice.ts` · 멈춤마다 한 통)는 칸 설정과 무관해 그대로 간다(드물고 사람이 알아야 하는 신호).

**다시 켜지 않는 이유(T8)**: 시스템 멈춤(잔액 · 스팸 재검사 · 대량 진입)은 제품이 의도한 동작이고 사유가 남는다. 워커가 매일 다시 켜면 그 신호를 덮고 검사 · 크레딧을 되풀이해 쓴다. 멈춘 세트 여정은 T11 줄에 보이고 사람이 정한다.

### 12-3 CT 하나

`pretestAndMark(companyId, journeyId, userId)` → `{ result: ValidationResult, marked: boolean }` — 옮기는 것 = `journey-reshape.ts:141 ~ 157` 원문(검사 시작 판 `updated_at::text` 잡기 → `validateJourneyForActivation` → 같은 판일 때만 표식). 자리 = 신설 `utils/journey-pretest-mark.ts`(reshape 의 옛 시험 `journey-v3-reshape-1020.test.ts` 가 `journey-activation` · `journey-pretest-validator` 를 모듈째 흉내 낸다 → 새 모듈이면 그 시험이 한 글자도 안 바뀌고 같은 순서(검증 → 표식 → 켜기)를 그대로 본다).

| 소비처 | 지금 | 바꾸는 때 |
|---|---|---|
| `utils/journey-reshape.ts` reshape | 인라인(141 ~ 157) | S3 구현 때(같은 뜻 · 결과 코드 · 문장 그대로) |
| S3 워커 | — | S3 구현 때 |
| `routes/ai.ts` pretest-validate | 인라인(4531 ~ 4561) | **C133 C + D 커밋으로 그 파일이 풀린 뒤**(응답 꼴 · 시연 회사 비용 0 처리 그대로) |

계약 시험 = `last_pretest_passed_at = NOW()` 를 쓰는 문장을 소스에서 기계로 뽑아 CT 한 곳인지. 라우트는 면제로 올리지 않고 「라우트를 바꾼 뒤 커밋」을 조건으로 둔다.

### 12-4 세트 표(11개 · Harold 확인 1115)

| # | 세트 키 | 여정 이름 | 시작 종류 | 합성 데이터가 넣는 길 | 칸 |
|---|---|---|---|---|---|
| 1 | signup | 자동 점검 · 신규 가입 | `customer.created` | 매장 싱크 새 고객(하루 20 ~ 52명 = `dailyNewCount`) | LMS 바로 + SMS 하루 뒤 |
| 2 | first_purchase | 자동 점검 · 첫 구매 | `purchase.first` | 매장 · 몰 구매 | LMS 바로 |
| 3 | purchase | 자동 점검 · 주문 완료 | `cdp.purchase` | 매장 · 몰 구매 | LMS 바로 |
| 4 | product | 자동 점검 · 상품 구매 | `purchase.product`(SK-101 수분 진정 토너 · 매장 문) | 매장 구매 | LMS 바로 |
| 5 | dormant | 자동 점검 · 휴면 전환 | `customer.dormant` | 최근 구매일 | LMS 바로 |
| 6 | dormant_return | 자동 점검 · 휴면 복귀 | `customer.dormant_return` | 구매 | LMS 바로 |
| 7 | cycle_lapsed | 자동 점검 · 구매 주기 이탈 | `customer.cycle_lapsed` | 구매 | LMS 바로 |
| 8 | birthday | 자동 점검 · 생일 | `customer.birthday_approaching` | 생년월일(전 고객) | LMS 바로 + SMS 7일 뒤 |
| 9 | points | 자동 점검 · 포인트 소멸 | `customer.points_expiring` | 포인트(매장 결제 3% 적립) | LMS 바로 |
| 10 | cart | 자동 점검 · 장바구니 | `cdp.cart_abandon` | 몰 담기 사건 | LMS 바로 + SMS 하루 뒤 |
| 11 | browse | 자동 점검 · 조회 후 미구매 | `cdp.browse_no_purchase` | 몰 조회 사건 | LMS 바로 |

문자 칸 합 = LMS 11 + SMS 3 = 14. 시작 조건 값(휴면 일수 · 생일 며칠 전 · 장바구니 시간 · 포인트 기준)은 계약 기본값 · 포인트 기준은 1 이상이어야 켜진다(`validateJourneyEntryConfig`) → 1,000. 판 번호는 행마다 1 에서 시작한다 · 2 이상이면 여정 이름 끝에 「(판 N)」을 붙인다(옛 판의 안 이어진 초안과 화면에서 가려지게).

뺀 것(1차):

| 시작 종류 · 기능 | 뺀 이유 |
|---|---|
| 등급 상승 | 등급 순서를 등록할 화면이 없어 켜기 관문이 막는다(합성 회사 설계서 §9 추가 과제 그대로) |
| 배송 시작 | 합성 데이터가 배송 사건을 보내지 않는다(`onlineScheduleOn` = page_view · product_view · cart_add · checkout_start · 주문) |
| 예약 확인 | 예약 연동이 없어 모든 회사에서 잠김(`RESERVATION_REASON`) |
| 고른 고객에게 · 날짜 예약 · 한 번 보내기 | 한 번 · 달마다만 돌거나 대상 조건을 따로 정해야 한다 |
| 앞 여정을 마치면 | 붙이기 전용(지도에서만 생긴다) |
| 알림톡 · 사진 문자 · 갈림 칸 · A/B 문안 · 추천 자리 | 승인 템플릿 · 사진이 필요하거나 칸 구성이 늘어난다 → 추가 과제 |

### 12-5 글(코드에 고정 · AI 호출 0)

규칙 = 혜택 · 링크 · 지어낸 사실 0 · 변수는 `%고객명%` 하나 · 광고(나갈 때 (광고) · 무료수신거부가 붙는다 = 실제 마케팅 문자와 같은 길) · LMS 는 제목 · SMS 는 광고 표기가 붙어도 한 통(90바이트)에 들게 짧게(구현하며 줄였다 · 계약 시험 = 이름 다섯 글자를 넣어 50바이트 안).

| # | 칸 | 제목 | 본문 |
|---|---|---|---|
| 1 | LMS | 가입 감사 인사 | %고객명%님, 회원으로 가입해 주셔서 감사합니다. 매장과 온라인 몰에서 편하게 둘러보세요. |
| 1 | SMS(하루 뒤) | — | %고객명%님, 가입을 환영합니다. |
| 2 | LMS | 첫 구매 감사 인사 | %고객명%님, 첫 구매를 해 주셔서 감사합니다. 사용하시다 궁금한 점은 매장으로 문의해 주세요. |
| 3 | LMS | 구매 감사 인사 | %고객명%님, 구매해 주셔서 감사합니다. 다음에도 좋은 제품으로 찾아뵙겠습니다. |
| 4 | LMS | 구매 감사 인사 | %고객명%님, 수분 진정 토너를 구매해 주셔서 감사합니다. 사용하시다 궁금한 점은 매장으로 문의해 주세요. |
| 5 | LMS | 오랜만에 인사드립니다 | %고객명%님, 오랜만에 인사드립니다. 매장과 온라인 몰에서 다시 뵙기를 기다리겠습니다. |
| 6 | LMS | 다시 찾아 주셔서 감사합니다 | %고객명%님, 다시 찾아 주셔서 감사합니다. 앞으로도 자주 뵙겠습니다. |
| 7 | LMS | 안부 인사 | %고객명%님, 잘 지내고 계신가요. 쓰시던 제품이 떨어질 때가 되어 안부 인사드립니다. |
| 8 | LMS | 생일 축하 인사 | %고객명%님, 곧 다가오는 생일을 미리 축하드립니다. |
| 8 | SMS(7일 뒤) | — | %고객명%님, 생일을 축하드립니다. |
| 9 | LMS | 포인트 안내 | %고객명%님, 보유하신 포인트가 있습니다. 매장과 온라인 몰에서 사용하실 수 있습니다. |
| 10 | LMS | 장바구니 안내 | %고객명%님, 장바구니에 담아 두신 상품이 있습니다. 온라인 몰에서 확인해 보세요. |
| 10 | SMS(하루 뒤) | — | %고객명%님, 장바구니를 확인해 보세요. |
| 11 | LMS | 상품 안내 | %고객명%님, 보고 가신 상품이 마음에 드셨다면 온라인 몰에서 다시 확인해 보세요. |

**글이 스팸 검사에 걸렸을 때 푸는 길**: T9 가 그 행의 다음 시도를 없애고 경보를 낸다 → 코드에서 그 행의 글을 고치고 **판 번호를 올려** 배포한다 → T6 이 원장을 새 판으로 비우고(검증 횟수 0) T7 이 새 글로 새 여정을 만든다(자동 재작성 0 · 옛 초안은 안 이어진 채 남는다). 옛 초안은 켠 적이 없어 처음 켜기 크레딧 이력이 없다(크레딧은 켤 때 그 여정 id 로 한 번 받는다). 판 번호를 안 올리고 글만 고치면 계약 시험이 빨간불이 된다(12-8).

### 12-6 돈 · 양

| 항목 | 값 | 근거 |
|---|---|---|
| 처음 켜기 크레딧 | 200 × 11 = 2,200(한 번 · 크레딧제 적용 회사일 때) · 여정 id 마다 멱등 | `ai-credit-calc.ts:107` · `chargesFirstActivation` · 멱등키 `journey-activate:여정id` |
| 스팸 검사(켜기 전) | 정상 14건 · 위쪽 끝 70건(행 · 판마다 검증 시도 5번) · 회사 단가표로 차감 | T9 · `runOneStepSpamTest`(`skipPrepaid: false`) |
| 스팸 검사(켠 뒤) | 매주 일요일 21:00 주간 재검사 14건(켜진 여정이면 받는 기존 동작) | `journey-weekly-check.ts` |
| 발송 | 어림 하루 200 ~ 400건(**미검증** · 첫날 S1 로그로 실측) · 합성 번호라 전부 실패로 끝남 · 손으로 켠 같은 시작 종류가 있으면 그만큼 더 | 새 고객 하루 20 ~ 52(`dailyNewCount`) · 매장 구매 하루 34 ~ 75행(1110 실측) · 몰 방문 하루 약 75(합성 회사 설계서 가정) |
| 최대 인원 | 여정마다 200 = 한 회차 진입이 200 을 넘으면 그 여정이 스스로 멈춘다(하루 상한 기능은 없다 · 있는 장치는 이것) | `journey-builder.ts:764 ~ 768` |

### 12-7 영향표 · 미가입 동작 변화 0

| 파일 | 다른 세션 미커밋과 겹침(1115 git status) | 기대는 곳 | 바뀌는 것 |
|---|---|---|---|
| 신설 `utils/journey-selfcheck-set.ts` + 시험 둘 | — | `demo-data.ts` tick | — |
| 신설 `utils/journey-pretest-mark.ts`(CT 하나) | — | reshape · S3 · (뒤에) 라우트 | — |
| `utils/journey-reshape.ts`(141 ~ 157 → CT 호출) | 없음 | 켜진 여정 모양 바꾸기 | 같은 뜻(옛 시험 `journey-v3-reshape-1020.test.ts` 무수정 통과) |
| `utils/journey-activation.ts`(관문 함수 둘에 선택 인자 `draftOnly`) | 없음 | 켜기 라우트 · 묶음 켜기 · reshape | 더하기만 · 안 주면 종전 호출 글자 그대로 |
| `utils/journey-builder.ts`(`activateJourney` 다섯째 인자 `draftOnly` · 기본값 거짓 · 잠근 여정 행을 읽은 뒤 한 번 판정) | **있음**(C133 C + D 미커밋) | 켜는 길 전부(`journey-activation.ts` 한 곳이 부른다) | 더하기만 · 안 주면 동작 변화 0 · 새 파일에 기대지 않는다 = 이 파일만 C133 커밋에 먼저 실려도 빌드 · 동작이 같다(1101 메모 「저장 상태 = 배포 가능」) · 다른 세션의 글자 고정 시험 둘(`c133-deploy-a` · `journey-v3-codex-r1-1020`)은 무수정 통과 |
| `utils/demo-data.ts`(tick 에 한 덩이) | C134 와 같은 파일 | 합성 데이터 워커 | 스위치 회사 ∩ 합성 회사만 |
| `__tests__/root-ledger.test.ts`(null 회사 경보 등재) | C133 C + D · C134 와 같은 파일 | R25 계약 | 등재 줄 |
| `status/DEPLOY-LEDGER.md` · `status/SCHEMA.md`(C134-DDL-2 · 새 표) | C134 와 같은 파일 | 배포 · 실 PG 시험 그릇 | 표 하나 |
| `routes/ai.ts`(4531 ~ 4561 → CT 호출) | **있음**(C133 C + D) → 그 커밋 뒤 | 켜기 전 점검 창 | 같은 뜻(응답 꼴 그대로) |

미가입 · 직접발송만 쓰는 회사: 스위치 ENV 가 비면 함수 진입 0 · 값이 있어도 대상 = 합성 회사만 · reshape · 라우트는 여정을 쓰는 회사만 지나는 길이고 뜻이 같다. 발송 · 과금 파일 무접촉. DDL 1(C134-DDL-2 · 새 표 · 다른 표 무접촉 · 없어도 서버는 뜨고 S3 만 쉰다) · ENV 1(비운 채 배포).

### 12-8 시험

- 세트 표 ↔ 시작 종류 등록부(`journey-trigger-capability.ts`): 만들 수 있는 시작 종류 전부가 「넣음」 또는 「뺌(사유)」에 있다(등록부에서 기계 추출 · 새 종류가 생기면 빨간불).
- 세트 글 14개 전부가 보낼 글 판정(`journeyCopyIssue`) · 채울 자리 · LMS 제목 검사를 지난다(표에서 기계로).
- 세트 정의 지문 ↔ 판 번호: 행마다 (시작 종류 · 칸 · 글 · 제목 · 기다림 · 조건 값)의 지문을 시험에 고정한다. 글을 고치고 판 번호를 안 올리면 빨간불(판을 안 올리면 차단된 초안이 옛 글로 남는다).
- 실 PG(C134-DDL-2 를 얹은 그릇 · 스팸 결과는 `validateJourneyForActivation` 에 이미 있는 `opts.spam` 자리로 넣는다):
  - 만들기 → 알림 끔 → 원장 연결 → 검증 → 표식 → 켜기 = 켜짐 + 최대 인원 200 · 다음 tick = 새 여정 0.
  - 이름을 바꾼 초안 · 멈춤 · 끝 · 보관 = 새 여정 0(신원 = 원장). 사람이 지운 여정 = 다시 안 만듦.
  - 안 이어진 초안(만들다 죽은 것을 흉내 = 여정 행만 · 칸 일부 · 알림 끄기 전) = 검증 · 켜기 0 · 새로 하나 만든다.
  - 검증 시도 = 다섯 번 뒤 0 · 다음 시도 시각 전 0 · 검사 중 = 30분 뒤로 · 장애 = 하루 뒤 · 차단 = 시도 없음 + 경보 · 재기동을 흉내 내도(모듈 상태 초기화) 횟수가 이어진다.
  - 검증하는 사이 사람이 글을 고침(검증 흉내 안에서 칸을 고친다) = 표식 0 · 켜기 0 · 다음 시도가 고친 글로 검증한다.
  - 표식이 있는 초안의 켜기 거절(크레딧 부족) = 검증을 다시 걸지 않는다 · 크레딧이 생기면 다음 tick 에 켜진다.
  - 판 올림 = 초안이면 원장만 비운다(옛 초안 행 · 칸 · 상태 그대로 남는다 = **지워지는 여정 0**) → 새 글 · 이름 끝 「(판 2)」로 새 여정 · 횟수 0 / 켜짐 · 멈춤 · 끝 · 보관 · 사람이 지움이면 원장 그대로.
  - 판 올림과 사람의 켜기 · 멈춤이 겹침(초안으로 읽힌 뒤 켰다 멈춘 여정을 흉내) = 그 여정의 행 · 실행 · 발송 기록이 그대로 있다(워커 코드에 여정을 지우는 호출이 없다 = 소스 계약: 워커 모듈이 `deleteJourney` · `DELETE FROM journeys` 를 들이거나 쓰지 않는다).
  - 잇는 문장 0행(만드는 사이 판이 오름) = 방금 만든 초안은 안 이어진 채 · 켜지 않는다.
  - 원장 판 > 정의 판(새 판 워커가 원장을 판 2 로 비운 뒤 옛 판 정의로 돈다) = 여정 0 · 원장 그대로(옛 판 글로 만든 초안이 새 판 원장에 이어지지 않는다).
  - 원장 표 없음 = 여정 0 · 스위치 밖 회사 · 시연 회사 = 쿼리 0.
  - 켜는 마지막 순간(구현 Codex 1R): 초안일 때만 켜는 조건을 켜는 트랜잭션이 본다(멈춘 여정 = 그대로 · 조건을 안 주면 종전대로 다시 켠다) · 워커가 초안이라고 읽은 뒤 켰다 멈춘 여정(묶음 조회 앞 · 켜는 함수가 여정 행을 잠그기 직전 두 자리) = 다시 켜지 않는다 · 옛 판 검증을 기다리는 사이 새 판이 연결을 바꿈 = 옛 여정을 켜지 않는다 · 켜는 동안 판 올림은 원장 행 잠금을 기다리고(`pg_stat_activity` 로 확인) 풀린 뒤에는 켜진 여정이라 0행.
- 표식 문장 추출 계약(12-3) · reshape 옛 시험이 같은 뜻으로 통과.
- 변이 = 위 조건마다 하나씩 빼서 빨간불.

### 12-9 순서(Harold 1115 = 추천안대로 · C134 와 같은 커밋 · 같은 배포)

이유: ① 연결 줄이 드는 `demo-data.ts` · `root-ledger.test.ts` · 원장 문서가 C134 경로와 한 파일이라 경로로 가를 수 없다 ② 실 PG 전체 통과 기록(스탬프)을 한 번만 찍는다(실 PG 시험이 들이는 CT 를 고치면 다시 찍어야 한다) ③ 배포 한 번 · ENV 를 비운 채라 배포해도 변화 0.

- C134 구현분은 닫힌 채 둔다 · Codex = S3 변경분만(1라운드 = S3 diff 전체).
- `demo-data.ts` 연결 줄 · `root-ledger.test.ts` 등재 줄은 S3 가 Codex 로 닫힌 뒤 마지막에 넣는다.
- 라우트 세 줄 바꿈 = C133 C + D 커밋 뒤 · C134 커밋 앞.
- 켜기 = C134-DDL-1 · 2 → 배포 → C134-S1 첫 판정 줄 확인 → ENV 한 줄(백엔드 재시작 1) → 그날 낮 2시간 안에 세트가 켜진다 → 다음 날 `[journey-set]` · `[journey-selfcheck]` 줄.

### 12-10 미검증(설계가 그 값에 기대지 않는다 · 켤 때 로그 · SQL 로 확인)

- 인비토 회사가 크레딧제 적용인지 · 잔액(부족하면 T10 이 사유를 찍고 안 켠다 · 채우면 다음 tick 에 켜진다).
- 선불 · 후불 · 실패 건 환불이 여정 정산에서 도는지(C129 「돈 경로 실측」과 같은 항목).
- 합성 번호 실패 건을 상위 사업자가 과금하는지(지금도 손으로 켠 여정 · 시험 발송이 같은 길).
- 검사 장애로 끝난 스팸 검사가 환불되는지(`enqueueSpamTest` 안의 차감 · 환불은 읽지 않았다 → 상한은 「등록 횟수」로 건다).
- 휴면 · 주기 이탈 · 휴면 복귀가 합성 일정에서 실제로 생기는지(안 생기면 S1 의 「7일 동안 안 나간 길」 줄에 남는다).
- 세트 글이 통신사 스팸 검사를 지나는지(지나지 않으면 T9 경보 → 글 수정 + 판 올림).

### 12-11 설계 Codex 반영

| 라운드 | 지적 | 뿌리 판정 | 처방 |
|---|---|---|---|
| 1R #1 | 검사 장애 재시도가 10분마다 새 유료 검사가 될 수 있다 · 「그날 그만」을 기억하는 자리가 없다 · 3일은 횟수 상한이 아니다 | 워커가 자기 상태를 남기는 자리가 없다(#1 · #2 · #4 · #5 한 뿌리) | 원장 표 + 시도 잡기 한 문장(T9 · 횟수와 다음 시도 시각을 시도 시작이 함께 쓴다) · 3일 상한 삭제 |
| 1R #2 | 이름으로 찾으면 이름을 바꾼 초안 · 멈춤 · 끝 · 보관에서 하나 더 만들고 크레딧도 다시 받는다 | 같은 뿌리 | 신원 = 원장 행(회사 · 세트 키 PK)의 `journey_id` |
| 1R #3 | 있던 초안은 「덮였나」를 건너뛴다 · 확인과 켜기 사이 틈 | 지킬 수 없는 약속(사람의 켜기와 나눌 잠금이 없다) | 약속을 뺀다(같은 시작 종류 두 여정 = 제품이 허용 · 결과와 푸는 길을 12-2 에 적음) |
| 1R #4 | 만들다 죽은 부분 초안 · 알림을 끄기 전에 죽은 초안이 켜질 수 있다 | 같은 뿌리 | 다 만든 뒤에만 원장에 잇는다(T7) · 이어진 여정만 켠다 |
| 1R #5 | 글을 고쳐 배포해도 있던 초안은 옛 글 · 3일이 지나 재시도도 없다 | 같은 뿌리 | 판 번호(T6) = 원장을 새 판으로 비우고 새 글로 새 여정 · 횟수 0 · 지문 ↔ 판 계약 시험 |
| 2R #1 | 판 올림이 초안을 지우는 단계 = 초안이라고 읽은 뒤 사람이 켰다 멈춘 여정을 기록째 지울 수 있다(`deleteJourney` 는 켜진 것만 거절) · 원장을 먼저 비우는 순서가 못 막는다 | 1R #5 처방에 덧붙인 파괴 동작(지우기) | 지우기를 뺀다 = 워커는 여정을 지우지 않는다(판 올림 = 원장 한 문장 · 옛 초안은 안 이어진 채 남는다 · 소스 계약 = 워커 모듈에 지우는 호출 0) |
| 설계 4R | 지적 0 | — | approve(1115) |
| 구현 1R #1 | 옛 판 워커가 검증을 기다리는 사이 새 판 워커가 연결을 끊으면, 옛 판 워커가 끊긴 옛 여정을 켠다(새 판 여정과 둘 다 켜짐) | 워커가 읽어서 내린 판정(원장에 이어진 초안)과 켜는 문장 사이가 비어 있었다(#1 · #2 한 뿌리 · 설계 2R #2 에서 불수용으로 남긴 자리가 더 날카로운 꼴로 다시 나왔다) | 켜기 직전 원장 행을 잠근 트랜잭션에서 이어진 여정 · 판을 다시 확인하고 켜기가 끝날 때까지 잠금을 쥔다 · 판 올림도 같은 잠금을 얻은 뒤 문장을 낸다(잠금 없이 한 문장이면 기다리다 풀린 UPDATE 가 「초안인가」를 기다리기 전 값으로 읽는다 = 변이로 실 PG 확인) |
| 구현 1R #2 | 워커가 초안이라고 읽은 뒤 사람이 켰다 멈추면 워커가 그 멈춤을 풀고 다시 켠다(켜는 함수는 멈춘 여정도 켠다) | 같은 뿌리 | 켜는 함수 `activateJourney` 에 `draftOnly`(잠근 여정 행의 상태가 초안일 때만 · 켜는 UPDATE 와 같은 트랜잭션) · 관문 함수 둘이 넘긴다 = 설계 2R #2 의 불수용(「켜는 문장은 다른 세션 파일이라 안 고친다」)을 거둔다(더하기만인 인자 · 안 주면 종전 그대로) |
| 구현 2R | 지적 0(선택 보강 둘 = 켜는 잠금 직전의 상태 변경 순서 · 잠금 대기 원인 확인 → 시험에 반영) | — | approve(1115) |
| 구현 3R | 지적 0(보강한 시험 두 군데) | — | approve(1115) |
| 구현 4R | 단위 전체에서 발견 = `draftOnly` 를 opts 객체에 넣자 다른 세션의 글자 고정 시험 2건이 깨짐 → 그 시험은 두고 인자 모양만 바꿈(다섯째 인자 · 관문 함수는 받았을 때만 싣는 두 갈래 호출) | 다른 세션 계약과의 충돌(뜻은 2R 과 같다) | approve(1115) |
| 3R #1 | T7 잇는 문장의 판이 「원장에서 읽은 판」이면 옛 판 워커(되돌린 배포)가 새 판으로 비워진 원장을 읽어 옛 글 초안을 새 판 원장에 잇는다 | 판의 출처를 안 적었다(같은 값이라고 가정) | 판 = 그 글을 만든 코드 정의 행의 판 · 원장 판 > 정의 판이면 그 행 전체를 쉰다 · 잇는 문장은 정의 판과 비교 |
| 2R #2 | 모양 대조 뒤 사람이 고치면 고친 글이 검증 · 표식을 받아 켜진다 · 알림만 고치면 표식이 남아 켜진다 | 1R #4 에 덧댄 장치(모양 대조)가 지킬 수 없는 약속을 만들었다 | 모양 대조 삭제(부분 초안 = 「다 만든 뒤 잇기」가 구조로 막는다) · 「사람이 고친 초안은 켜지 않는다」 약속 삭제 = 이어진 뒤 사람이 고친 것은 그 사람이 정한 값(12-2 문단) · 불수용분 = 켜는 문장의 판 조건(그 문장은 다른 세션 미커밋 파일 `journey-builder.ts` 안 · 지킬 근거가 약하다) |
