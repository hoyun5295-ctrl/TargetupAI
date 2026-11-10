# 적재 끊김 = 이어 싣기(직접발송 워커 묶음 = MySQL 트랜잭션 하나) · 1110

> 접수 = 그룹웨어 SOOBIN02 「29,906건 붙여 넣었는데 2만 건만 나감」(1110) · Harold 「이 병신같은 솔루션 좀 고칠래 · 지 좆대로 종료시키는 것도」.
> 같은 날 함께 고친 것(별도 변경) = 운영 = dist 실행(메모리 · `ecosystem.config.js` · Codex 2R approve) · 직접입력 9,999건 상한 · 여정 문안 %변수% 한 가지.

## 0 실측(Harold 실행 출력 · 로그)

- 캠페인 `1539df95` 11:31:53 접수 29,906 · 11:32:19 PM2 `exceeds --max-memory-restart`(1,828MB > 1,700MB) · `still alive after 1600ms, sending it SIGKILL` · 11:42:16 `끊긴 적재 정리 — 실측 적재 20000/29906` → 9,906 미발송 · processed_count 10,000 · sent_count 20,000.
- 9-13 이후 같은 꼴 3건(10-19 0/19,920 취소 · 10-28 톤28 `445f5b47` 100,000/107,790 · 11-10 위 건) · 메모리 재시작 = 7 ~ 9월 5회 → 10월 ~ 11-10 34회.
- 뿌리(코드): 묶음(1만) 안 INSERT 가 5천 건 배치마다 따로 커밋(`sms-queue.ts` bulkInsertSmsQueue 1824 ~ 1840 · insertBrandQueue · insertAlimtalkQueue 「배치는 각각 독립 커밋」) → 묶음 중간에 죽으면 몇 건 들어갔는지 모름 → 복구가 이어 싣기를 포기(`direct-send-worker.ts` classifyStaleLoad 612 ~ 621 in_chunk · 실측 ≠ 진행 기록 = recover = 종결).

## 1 미가입 직접발송 변화 0 증명 표(메모리 `feedback_free_direct_send_zero_change`)

| 길 | 바뀌는 것 | 성공 흐름에서 왜 같은가 | 증명 시험 |
|---|---|---|---|
| 직접발송 워커 묶음 적재 | 묶음의 INSERT 들이 연결 하나 · BEGIN … COMMIT 안에서 돈다 | 같은 행 · 같은 순서 · 같은 테이블 · 같은 SQL 문장 · 같은 건수 반환 · 커밋 뒤 탐지 · 학습 적재 시각만 커밋 뒤로(지금도 「적재 성공 뒤」) | 가짜 연결 시험 = 문장 목록 · 값 = 옛 길과 같은 리터럴 |
| 배치 실패 | 옛: 앞 배치는 나가고 실패 배치만 빠짐(부분) → 새: 묶음 전체 되돌림 = 그 묶음 0 | 실패 갈래만 바뀜(성공 흐름 아님) · 지금 예외 종결 블록이 그대로 받는다 | 가짜 연결 N번째 배치 실패 → ROLLBACK · 반환 0 · 던짐 |
| 끊김 복구 | 트랜잭션 묶음이면 MySQL 커밋 기록(아래 §3 HANJUL_LOAD_CHUNK)으로 「커밋됨 / 안 됨」을 가려 이어 싣는다(건수 차이 Δ 를 쓰지 않는다) | 끊김이 없으면 복구가 돌지 않는다 | 복구 판정 시험(기록 있음 · 없음 · 조회 실패) |
| 요청 안 적재(AI 캠페인 · 동기 직접발송 · 브랜드) · 여정 | 이번 변경 0 | 그 파일을 고치지 않는다 | 소스 계약(옵션 없이 부르는 꼴 그대로) |

## 2 흐름 표(적재 = MySQL 큐에 싣는 길 · 뽑은 패턴 = `bulkInsertSmsQueue(|insertBrandQueue(|insertAlimtalkQueue(` 부르는 곳 + `createDirectSendCampaign(` 부르는 곳)

| # | 길 | 쓰는 쪽 | 재시작 때 지금 | 판정 | 이번 |
|---|---|---|---|---|---|
| 1 | 직접발송 워커(직접 · 직접 타겟 · 알림톡/브랜드 직접 · 모바일 DM · 대행 · 운영자 · 플래너) | `direct-send-worker.ts:844-946` → `direct-send-processor.ts:161·227·345` | 경계 = 10분 뒤 이어 실음 · 묶음 중간 = 종결(남은 분량 미발송) | 결함(실례 2) | **D1 고침** |
| 1-b | 같은 워커 종료 대기 | `direct-send-worker.ts:41` 8초 · `ecosystem.config.js` kill_timeout 12000 | 운영은 1,600ms SIGKILL(파일 미반영) | 결함 | 배포 1(pm2 다시 읽기) |
| 2 | AI 캠페인 발송 | `campaigns.ts:719` → `:1343` · `:1352` | 복구 코드 0 · 실행 행 'sending' 잠김 | 결함 | 2차(§5) |
| 3 | 동기 직접발송 | `campaigns.ts:2309` → `:3136·3142·3339` | 복구 코드 0 | 결함 | 2차 |
| 4 | 브랜드 발송 | `campaigns.ts:4413` → `brand-message.ts:2007·2149` | 예외일 때만 수습(`brand-message.ts:2187`) | 결함 | 2차 |
| 5 | 여정 | `journey-send-claim.ts:166` | 증명 못 한 단위 = 1시간 뒤 닫음 | 결함(같은 부류) | 2차 |
| 6 | 자동발송 | `auto-campaign-worker.ts:1637` RETIRED | 꺼짐 | 정상 | - |
| 7 | 시스템 안내 · 경보 1건 INSERT | `sms-notice.ts:33` 등 | 한 문장 = 원자 | 정상 | - |

## 3 처방 D1(직접발송 워커) — ★ Codex 설계 1R 반영(커밋 결과 불명 · Δ 부정확 → 같은 트랜잭션 안의 고유 커밋 기록)

0. **MySQL 표 하나(새 · DDL = Harold root)** — `smsdb.HANJUL_LOAD_CHUNK`(campaign_id varchar(50) · first_staging_id bigint · rows_read int · sms_loaded int · brand_loaded int · committed_at datetime DEFAULT CURRENT_TIMESTAMP · **PRIMARY KEY (campaign_id, first_staging_id)** · InnoDB). smsuser 권한은 `smsdb.*` 스키마 단위라 따로 줄 것 없음(SCHEMA.md MySQL 절). 표가 없으면(DDL 전) 코드는 옛 방식 그대로 = 배포 순서 자유.
1. **관문** — 그 캠페인이 싣는 테이블(회사 라인 테이블 전부) + HANJUL_LOAD_CHUNK 가 모두 InnoDB 로 있을 때만 트랜잭션 묶음(information_schema.TABLES 캐시 · 조회 실패 = 옛 방식 · 로그 경고 1).
2. **묶음 = 트랜잭션 하나** — 워커가 묶음마다 MySQL 연결 하나 · BEGIN · **첫 문장 = 커밋 기록 INSERT(campaign_id · first_staging_id · rows_read · 0 · 0)** · 그 묶음의 모든 큐 INSERT(문자 · 브랜드 · 알림톡) · 커밋 기록 UPDATE(sms_loaded · brand_loaded = 이번 묶음 적재 수) · COMMIT · 연결 닫음(풀에 돌려주지 않는다 · 잠금 대기 상한 세션 값이 다른 경로로 새지 않게 · Codex 구현 1R).
   - 같은 묶음을 두 번 싣는 길은 PK 가 막는다: 이미 커밋된 묶음을 다시 시작하면 첫 INSERT 가 중복 키로 실패 → 큐 행 0 · ROLLBACK → 「이미 커밋됨」으로 처리(기록의 수로 진행 기록 이동). 동시에 같은 묶음을 시작하면 InnoDB 가 뒤 트랜잭션을 앞 트랜잭션 끝까지 기다리게 한다(직렬화).
   - 세 CT 에 선택 인자 `tx` — 있으면 INSERT 를 그 연결로 · 배치 실패 = `QueueTxAbort`(MySQL 은 실패 문장만 되돌리고 트랜잭션은 살아 있어 삼키면 부분 커밋) · 탐지 · 학습 적재 = 커밋 뒤. 없으면 지금 그대로.
   - 처리기 `processSendChunk` 의 채널별 부분 수습 catch 는 `QueueTxAbort` 를 그대로 던진다 · 피로도 기록 = 커밋 뒤.
3. **커밋 결과와 판정 = 같은 PK 로 다시 시도 하나**(★ Codex 설계 2R · 따로 SELECT 로 「없음」을 보면 아직 처리 중인 COMMIT 을 롤백으로 오판한다)
   - 커밋 확인 = 커밋 뒤 함수 · 진행 기록 UPDATE(지금 문장).
   - 되돌림 확정(커밋 전 문장 오류 · ROLLBACK 성공 · 그 트랜잭션이 연결을 쥔 채 끝남) = 지금 예외 종결(메모리 sent = 이 묶음 제외 = 실제와 같음).
   - **보류**(아래 셋) = 종결 · 정산 · staging 정리 · 내려놓음 표식 **전부 하지 않고** 이 프로세스의 줄만 반납(캠페인 processing · loadChunk 표식 그대로 · 10분 뒤 끊김 복구가 받는다). 기존 catch 갈래를 타지 않는 별도 결과(`LoadHold`).
     - COMMIT 결과 불명(COMMIT 호출 오류 · 연결 끊김)
     - 커밋 확인 뒤 진행 기록 UPDATE 실패
     - 다시 시도의 PK 잠금 대기 만료(아래)
4. **묶음 표식** — loadChunk 에 `tx: true` · firstId · rows.
5. **끊김 복구 · 다시 시도**(classifyStaleLoad in_chunk · tx 표식) = 판정하지 않고 「같은 자리에서 이어 넣기」(내려놓음 표식 · 횟수 + 1). 이어 넣기가 같은 묶음(같은 firstId)을 새 트랜잭션으로 다시 시작하면 첫 문장 커밋 기록 INSERT 가 판정한다:
   - 중복 키 = 앞 트랜잭션이 커밋됐다 → 같은 트랜잭션에서 그 기록을 읽어 수를 얻고 ROLLBACK → 진행 기록을 기록 수로 이동(processed_count += rows_read · sent += sms_loaded · brandSent += brand_loaded · chunkSkipped += rows_read − 적재 축 수) → 다음 묶음.
   - INSERT 성공 = 앞 트랜잭션은 끝났고 되돌려졌다(InnoDB 는 같은 PK 를 쥔 트랜잭션이 끝날 때까지 기다리게 한다) → 그 묶음을 지금 싣는다.
   - 잠금 대기 만료(세션 innodb_lock_wait_timeout = 30초) = 보류(앞 트랜잭션이 아직 안 끝남).
   - 횟수 상한(LOAD_RESUME_MAX)에 닿아도 tx 표식이면 종결하지 않는다(종결하면 남은 분량이 또 버려진다). 대신 **사람 확인 표식**(send_config.loadHoldManual = { at, reason })을 남기고, 끊김 복구 고아 조회 · 줄 채우기 후보에서 그 캠페인을 뺀다(★ Codex 설계 3R · 안 빼면 오래된 5건이 ORDER BY updated_at LIMIT 5 자리를 영영 차지해 뒤 캠페인이 복구를 못 받는다). 경보 = 정리 회차마다 사람 확인 표식 개수로(공용 쿨다운 · 남아 있는 한 다시 간다 · 준비분 잔존 감시와 같은 꼴). 사람이 표식을 지우면 다음 회차에 다시 이어 넣기. tx 표식 없는 옛 표식 = 지금 규칙 그대로.
5-1. **다시 시작할 때 맨 먼저 = 보류 묶음 확정**(★ Codex 설계 3R) — 이어 넣기(processCampaign 재개)는 고리의 어떤 중단 검사(적재 중 취소 · 야간 광고 정지 · 고정 회신번호 막힘)보다 **먼저** loadChunk tx 표식이 있으면 그 묶음을 같은 PK 로 확정한다: 새 트랜잭션 · 커밋 기록 INSERT → 중복 키 = 기록 수를 진행 기록에 반영(이동) · ROLLBACK / 성공 = 앞 트랜잭션 되돌림 확정 → **적재 없이** ROLLBACK · 표식만 지움 / 잠금 만료 = 보류. 그 다음에 지금 고리(중단 검사 → 묶음)를 돈다. 그래서 중단 갈래 · 종결 블록이 쓰는 sent 는 늘 커밋된 묶음을 포함한다(과다 미적재 처리 0).
6. **기록 정리** — 기간으로 지우지 않는다. 그 캠페인의 종결 블록이 끝날 때(더는 적재가 없는 때) 그 캠페인의 기록만 지운다(실패해도 발송 영향 0 · 남은 줄은 다음 종결 때 · 크기 = 1만 건당 1줄).
7. **알리기** — 보류가 횟수 상한에 닿거나, 옛 표식 복구가 종결로 끝나면 시스템 경보(캠페인 id · 진행 · 접수 수).

### 3-1 구현 모양(파일 · 함수)

- `sms-queue.ts`(큐 CT): `openQueueTransaction()` = 풀 연결 하나 · beginTransaction · `{ run, afterCommit(fn), commit() → 'committed' | 'unknown', rollback() }`(commit 오류 = 'unknown' · 반납 · 연결 오류면 destroy) · `queueTxReady(tables)` = 큐 테이블 + HANJUL_LOAD_CHUNK 엔진 캐시 · `claimLoadChunk(tx, campaignId, firstId, rowsRead)`(첫 INSERT · 중복 키 = `LoadChunkAlreadyCommitted`) · `sealLoadChunk(tx, …, smsLoaded, brandLoaded)` · `readClaimedChunk(tx, campaignId, firstId)`(중복 키 뒤 같은 트랜잭션에서 수 읽기) · `deleteLoadChunks(campaignId)`(종결 때) · `QueueTxAbort` · `LoadChunkLockTimeout`.
- 세 CT 마지막 선택 인자 `tx?` · 처리기 `processSendChunk({ …, tx })`.
- `direct-send-worker.ts`: 캠페인당 `queueTxReady` 한 번 · 묶음마다 위 2 · 3 · 결과 분류 = 순수 함수 `classifyChunkOutcome(단계 · 오류)` → `'committed' | 'rolledBack' | 'alreadyCommitted' | 'hold'`(시험 대상) · 보류 = `LoadHold` 로 고리 밖 종결 블록을 건너뛴다.
- 셈의 한계: 복구로 넘긴 묶음의 개별 회신번호 제외 수는 chunkSkipped 에 합쳐진다(같은 「미적재」 · 사유 칸만 다름).

## 4 계약 시험(뿌리 R-새 「묶음 중간 끊김 = 몇 건 들어갔는지 모름」)

- 가짜 MySQL 연결: 묶음 성공 = BEGIN · 잠금 대기 30초 · 커밋 기록 INSERT · 큐 INSERT n · 기록 UPDATE · COMMIT 순서 · 반환 건수 = 옛 길과 같은 리터럴 · 커밋 뒤 함수가 COMMIT 뒤.
- N번째 배치 실패 = ROLLBACK · 던짐 · 탐지 0 · 학습 0 · 예외 종결.
- 같은 묶음 다시 시도 + 기록 중복 키 = 큐 INSERT 0 · 기록 수 읽기 · ROLLBACK · 진행 기록 이동 · 다음 묶음.
- COMMIT 오류(결과 불명) · 진행 기록 UPDATE 실패 · 잠금 대기 만료 = 보류 = 종결 0 · 정산 0 · staging 정리 0 · 내려놓음 표식 0 · processing · loadChunk 유지.
- 끊김 복구: tx 표식 = 이어 넣기 · 횟수 상한 = 사람 확인 표식 + 경보(종결 0) · 그 캠페인은 고아 조회 · 줄 채우기에서 빠짐 · 상한 보류 5건이 있어도 여섯째 정상 복구 대상이 처리됨 · 옛 표식 = 옛 판정.
- 다시 시작 맨 먼저 확정: 「커밋 → 진행 기록 실패(보류) → 재개 시 야간 정지」 = 중단 전에 기록 수가 sent 에 들어감 · 「되돌림 확정 → 재개 시 취소」 = 적재 0 · 표식 지움 · 종결.
- 종결 블록 끝 = 그 캠페인 기록 지움 · 기간 정리 0.
- 옵션 없이 부른 세 CT = 지금 문장 · 지금 실패 규칙 그대로(옛 시험 전부 통과).
- 소스 계약: tx 를 넘기는 곳 = 직접발송 처리기 하나.
- 변이: 관문 끔 · QueueTxAbort 삼킴 · 기록 INSERT 를 큐 INSERT 뒤로 · 보류를 예외 종결로 · 커밋 뒤 함수를 커밋 앞으로 · 상한에서 종결 = 빨간불.

## 5 2차(같은 설계 원칙 · 이번 배포 밖 · 착수 = Harold)

- 요청 안 적재(2 · 3 · 4): 적재 전체 = 트랜잭션 하나 + 'sending' 에 굳은 캠페인 정리 워커(MySQL 0 = 실패 · 담당자 경보 / > 0 = 완료). 수십만 건 한 트랜잭션의 잠금 · 되돌림 부담 실측이 먼저.
- 여정(5): 단위 적재를 트랜잭션으로 묶으면 「증명 못 한 단위 = 0건 증명」이 되어 다시 보낼 수 있다.

## 6 직원 지시문(배포 뒤 · Harold 가 재시작을 맡는다)

| 순 | 하세요 | 보이면 맞음 | 맞음 / 다름 |
|---|---|---|---|
| 1 | 인비토 테스트 회사(받을 수 없는 번호 회사)로 로그인해 직접발송 → 파일등록으로 3만 줄 파일을 올리고 예약(내일 아침 9시)으로 보낸다 | 「예약됐어요」 | |
| 2 | (Harold) 보낸 직후 30초 안에 백엔드를 한 번 재시작한다 | - | |
| 3 | 15분 기다린 뒤 발송결과에서 그 캠페인을 연다 | 대상 30,000 · 적재 30,000 | |
| 4 | 그 캠페인 예약을 취소한다 | 취소됐어요 · 대기 0 | |

## 7 미검증

- ~~운영 SMSQ_SEND 테이블 엔진~~ → **실측 1110 16:58(Harold 실행 · information_schema.TABLES) = SMSQ_SEND% BASE TABLE 137개 전부 InnoDB**. 관문(§3-1)은 실행 중에도 그대로 본다(새 라인 테이블이 다른 엔진으로 생겨도 그 캠페인만 옛 방식).
- 트랜잭션 중 QTmsg 에이전트의 읽기 · 잠금 지연(1만 행 · 수 초 · 같은 테이블 다른 행).
