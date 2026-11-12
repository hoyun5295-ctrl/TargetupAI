# C131 비토 라인 표 전체 훑기 · 결과 반영 속도 — 설계서

> 접수 = 1112 오전 톤28 장문 425,646건(분할 1분 4,500건) 발송 중 「결과가 너무 안 내려간다」 · 1113 02:5x 「한 대가 분당 그거면 사고 · 원래보다 느리다」.
> 승인 = 1113 03:xx Harold 「그 처방 설계안으로 만들고 Codex 리뷰 닫힐 때까지 · 구현까지 마무리하고 Codex 리뷰 닫힐 때까지」(세 층 처방 · 채팅에 올린 흐름 표 확인 뒤).
> 조건 = Harold 「정합성에서 벗어나는 일이 단 하나도 없게, 하지만 리포트는 빨리」.
> 저장소 두 곳 = 한줄로(이 문서 · 백엔드 계약 시험) · bito-gateway(에이전트 코드 · 그 저장소 CODEX.md 규칙 · git 은 Harold).

---

## §0 실측 (Harold 실행 · 출력 원문은 이 세션 대화)

| 무엇 | 값 | 출처 |
|---|---|---|
| 에이전트 네 대 설정 | `batch_size 100` · `send_concurrency 4` · `report_concurrency 1` · `final_result_only` · `order_by seqno ASC` · `send_time_column sendreq_time` · 파일 수정 11-06 18:53:15 | .62 grep · ls |
| 톤28 캠페인 | 6edba15b · 425,646건 · `splitEnabled true · 4500건 · 1분` | .62 PG |
| hanjul03 1분(1112 10:04 → 10:05) | 보냄 5,397 · 결과 반영 2,567 · 결과 대기 73,282 → 76,112 | .62 journald 「Poller 상태」 |
| 한 대 1분 최대 결과 반영(하루별 · 10-01 ~ 11-13) | 10-01 ~ 11-09 천장 약 8,000(hanjul02 거의 매일 7,700 ~ 8,100) · 11-10 부터 밀려 있는데도 hanjul03 3,978(11-10) · 3,570(11-12) · hanjul02 5,909 · 4,847 · 5,846 | .62 journald |
| 한 대 1분 최대 보냄 | hanjul02 27,600(10-18) · 23,700(11-09) · hanjul03 23,083(10-30) | .62 journald |
| 큐 조회 횟수(1113 02:44 → 02:46) | hanjul03 1분 6회(한 번 약 10초 = `poll_timeout`) · hanjul02 275회 · hanjul01 100회 | .62 journald |
| MySQL | `innodb_buffer_pool_size` 8GB · 적중 99.84% · 페이지 조회 평균 초당 약 25.6만(492억 / 192,523초) · 0.5초 넘는 쿼리 126,937(53시간) · 기동 11-10 21:33 KST · 재시작 9 · `max_connections` 151 · 최대 사용 82 | .62 MySQL root |
| 엔진(.65) 1113 02:5x | report_queue 미전달 = hanjul 0(callbiseo-3 옛 2) · DELIVERED(통신사 결과 대기) hanjul03 16,339 · hanjul02 10,240 · hanjul01 335 · 최근 report_queue 300만 행 중 같은 요청에 결과 2건 이상 = 0 | .65 엔진 PG |
| 디스크(1112 09:5x) | sda 읽기 초당 205 ~ 213MB · %util 87 ~ 91 · w_await 3.7 → 10.8ms · mysqld 읽기 176MB/s · MySQL CPU 140% | 서버이관 세션 실측 |

### §0-1 슬로 로그 끝 20MB(1113 03:xx · 기계 추출)

추출 명령(쿼리 앞 70자 · 3자리 이상 숫자 = N):
`tail -c 20000000 …/c7e7721f1518-slow.log | awk '/^# Query_time:/{qt=$3; rx=$NF; getline; while($0 ~ /^(SET timestamp|use )/) getline; k=$0; gsub(/[0-9][0-9][0-9]+/,"N",k); k=substr(k,1,70); n[k]++; t[k]+=qt; if(qt>m[k])m[k]=qt; r[k]+=rx} END{…}'`

| 건수 | 평균 / 최대 | 평균 훑은 행 | 쿼리 앞부분 | 누가 |
|---|---|---|---|---|
| 2,569 | 1.47초 / 2.26초 | 5,837,553 | `SELECT seqno FROM SMSQ_SEND_14 WHERE status_code = 'N' AND sendreq_tim…` | 에이전트 hanjul02 큐 조회 |
| 608 | 44.76초 / 91.53초 | 2,679,887 | `SELECT seqno FROM SMSQ_SEND_15 WHERE …` | 에이전트 hanjul03 큐 조회 |
| 528 | 7.76초 / 64.98초 | 75,136 | `SELECT app_etc1 AS _grp, …` | 백엔드 통계 집계(캠페인 단위) |
| 105 | 53.75초 / 114.78초 | (하위 쿼리) | `SELECT _grp, COUNT(*) AS cnt FROM (SELECT CONCAT(COALESCE(app_etc1, ''…` | 백엔드 만료 대기 정리 워커(1분) |
| 60 | 0.66초 | 13 | `SELECT SUM(cnt) AS total FROM (SELECT COUNT(*) …` | 백엔드 대기 수 합계 |
| 22 + 22 | 52.65초(15) · 1.59초(14) | 3,330,026 · 6,270,940 | `SELECT COUNT(*) AS cnt, MIN(sendreq_time) AS oldest FROM SMSQ_SEND_1x` | 백엔드 시스템 감시 워커(5분) |
| 1 · 1 · 1 · 7 | 56.6 · 30.5 · 3.3 · 0.9초 | 표 전체 | `SELECT /*!N SQL_NO_CACHE */ * FROM …` | 새벽 백업 덤프 |

표 크기(덤프 · 감시 쿼리가 훑은 행) = SMSQ_SEND_13 721,447 · 14 6,270,940 · 15 3,330,026.

---

## §1 흐름 표

### §1-1 발송 → 결과 이음매(한줄로 비토 라인)

| 단계 | 쓰는 쪽 | 읽는 쪽 | 판정 자리 |
|---|---|---|---|
| 적재 | 백엔드 `utils/sms-queue.ts` INSERT(192 · 201 · 1320 · 1352)(status_code 100 · sendreq_time = 분할 시각) | 에이전트 큐 조회 | — |
| 큐 조회(번호만) | — | bito-gateway `internal/agent/poller/poller.go` `fetchPendingSkippingInFlight` 2011-2077 · 조건 `pendingWhere` 1256-1274(`status_code = ? AND seqno > ? AND sendreq_time <= NOW()`) · `ORDER BY seqno ASC LIMIT batch×10` 1277-1295 | 진행 중(메모리 점유 · 저널) 번호를 빼고 묶음만큼 고름 2035-2045 |
| 커서 | `advancePendingScanCursor` 2119-2140 | 다음 조회 | **0건이면 커서를 표 맨 앞으로**(2137) |
| 큐 조회(전 칸) | — | `buildFetchRowsBySeqQuery` 1299-1314(`… AND seqno IN (…)`) | 후보 조건 재확인 |
| 게이트웨이 전송 | `processRowWithClaim` 573-708 · 행마다 SendAck 대기(`client/grpc_client.go` 666 · 10초) · 동시 `send_concurrency` | 엔진 message_request | — |
| 결과 상태 유지 | `final_result_only` = 결과 전까지 고객 행 status_code 100 그대로(저널만 기록) | 큐 조회가 그 행을 다시 읽고 메모리에서 버림 | — |
| 엔진 결과 적재 | `internal/gateway/engine/report.go` `enqueueReportOnce` 1437(같은 요청에 내용이 다른 결과 여러 행 허용 · 같은 내용만 한 행 · 색인 036) | 에이전트 수신 | — |
| 결과 수신 | `recvLoopForGeneration` 1123-1191(1174 = 결과를 통에 넣음) | 결과 일꾼 | — |
| 결과 일꾼 | `startReportWorkersForGeneration` 1197-1227 = 통 **하나** · 일꾼 `report_concurrency` 개가 아무 결과나 꺼냄(1238) | `Poller.HandleReport` 901-974 | **같은 행 결과의 처리 순서 = 일꾼 1개일 때만 받은 순서** |
| 고객 DB 결과 쓰기 | `buildReportUpdate` 1036 = `UPDATE 표 SET status_code … WHERE seqno = ?`(행 하나 · PK) · 영향 행 = `clientFoundRows=true`(db/source.go 515) | 백엔드 결과 집계 | 영향 행 0 = 실패 · 재연결 · 재전송 |
| 저널 닫기 · 확인 | `clearInFlight` → `sendReportAck`(1370 · `sendMu` 직렬) → `markResultAckedForGeneration` 1425(받은 순서로만 커서 전진) | 엔진 report_queue delivered · DONE | 앞 결과 실패 = 뒤 결과 확인이 커서를 넘기지 못함 |
| 백엔드 감시 · 정리 | `utils/expired-pending-sweeper.ts` 1분(ABNORMAL_WHERE 41 · 묶음 71 · 전 표) · `utils/system-monitor-worker.ts` 5분(68-71 · 전 표) | 큐 표 전체 | 조건 첫 칸 `status_code >= 100000` |

### §1-2 큐 표(SMSQ_SEND_13 ~ 16)를 훑는 자리

§0-1 슬로 로그가 기계 추출 목록이다(0.5초 넘는 쿼리 전부). 판정은 §2.

---

## §2 결함 장부

| # | 자리 | 판정 | 사슬 | 고객이 겪는 일 |
|---|---|---|---|---|
| D1 | 에이전트 큐 조회(13 ~ 16) | **결함** | 비토 라인 표는 이력 표로 옮기지 않아 끝없이 커진다 → 조회 첫 조건 `status_code` 로 시작하는 색인이 없다(SCHEMA.md SMSQ_SEND 절 · PK · app_etc1 둘 · dest_no) → PK 순으로 표를 처음부터 훑는다 → 결과 대기 행이 남아 있으면 0건 조회 뒤 커서가 맨 앞으로 돌아가 매번 이력 전체(584만 · 268만 행) | 15번은 조회 한 번 평균 44.8초(한도 10초 넘김) · DB 읽기 · CPU 를 차지해 결과 반영 UPDATE 까지 느려짐(천장 8,000 → 3,570) |
| D2 | 만료 대기 정리 워커 1분(전 표) | **결함** | `status_code >= 100000 AND mobsend_time IS NULL AND …` · 첫 조건 칸 색인 없음 → 1분마다 전 표를 끝까지 훑는다(UNION ALL 한 문장) | 평균 53.8초 쿼리가 1분마다 · D1 과 같은 DB 부담 |
| D3 | 시스템 감시 워커 5분(전 표) | **결함** | D2 와 같은 조건 · 표마다 COUNT · MIN | 15번 한 번 52.7초 |
| D4 | 에이전트 결과 일꾼 | **결함(용량)** | 통 하나를 일꾼이 나눠 꺼내는 구조라 2 이상이면 같은 행 결과 순서가 깨질 수 있다 → 발급값 1 로 묶임 → 한 대 결과 반영 천장(건강할 때 분당 약 8,000)이 보내는 최대치(분당 2만 ~ 2만 7천)를 못 따라감 | 대량 발송 때 결과 화면 · 실패 환불이 몇 시간 늦음 |
| N1 | 백엔드 통계 집계(`app_etc1 IN …`) | 정상 | `idx_app_etc1_status` 를 탐 · 훑은 행 = 그 캠페인 행 수(7.5만) · 느린 이유 = D1 ~ D3 과 같은 DB 부담 | §8 에서 다시 잼 |
| N2 | 새벽 백업 덤프 | 정상 | 전체 읽기가 목적 · 03:00 | — |
| N3 | 결과 반영 UPDATE | 정상 | `WHERE seqno = ?`(PK 한 행) · 분당 2,567건 × 16KB = 초당 1MB 미만 | — |
| N4 | QTmsg 라인 표(1 ~ 11)를 D2 · D3 가 훑는 것 | 정상(조건부) | QTmsg 에이전트가 결과 난 행을 월별 로그로 옮겨 라이브 표는 작다 · 슬로 로그에 1 ~ 11 큐 조회 0 | §7 사전 점검 ③ 행 수로 확인 · 크면 이 판정을 결함으로 바꾼다 |

---

## §3 뿌리

- **R94(신설)** 끝없이 커지는 표(비토 라인 표 · 이력 이동 없음)를 색인 앞 칸으로 좁히지 않는 조건으로 처음부터 훑는다 — 판정 기준 = 백엔드가 큐 표에 거는 모든 조건(조회 · 집계 · 갱신 · 삭제)의 최상위 AND 에 **좁히는 색인 조건**이 하나 이상 있다: `app_etc1` · `dest_no` · `seqno` · `status_code` 의 `=` 또는 `IN (…)`, 또는 `status_code >= N`(N ≥ 100000 = 결과 코드 밖 이상값 구역). 범위 조건(`seqno > 0` · `status_code > 0` 처럼 표 전체를 덮을 수 있는 것) · 최상위 OR · 못 편 조건은 실패. 비토 라인 표는 `status_code` 앞 색인(C131-DDL-1)을 가진다. 에이전트(Go)의 큐 조회는 `status_code = 상수` 가 첫 조건이다(§4-1 색인이 받는다).
- **R95(신설)** 순서가 의미를 가진 처리(같은 행에 오는 결과)를 병렬로 돌리면서 순서 단위(행)로 묶지 않는다 · 순서를 지키려고 용량을 나눠 다른 일(SendAck · Pong)을 먼저 막는다 — 판정 기준 = 결과 일꾼이 몇 개든 같은 행(source_seq)의 결과는 받은 순서대로 하나씩 처리되고, 한 행의 뒤 결과가 먼저 준비된 다른 행을 앞지르지 않으며, 수신 루프가 멈추는 때는 꺼내지 않은 결과가 B 개일 때뿐이다(지금과 같은 문턱).

---

## §4 처방

### §4-1 C131-DDL-1 · 비토 라인 표 색인(D1 · D2 · D3)

```sql
SET SESSION lock_wait_timeout = 2;
ALTER TABLE SMSQ_SEND_13 ADD INDEX idx_status_seq_sendreq (status_code, seqno, sendreq_time), ALGORITHM=INPLACE, LOCK=NONE;
ALTER TABLE SMSQ_SEND_14 ADD INDEX idx_status_seq_sendreq (status_code, seqno, sendreq_time), ALGORITHM=INPLACE, LOCK=NONE;
ALTER TABLE SMSQ_SEND_15 ADD INDEX idx_status_seq_sendreq (status_code, seqno, sendreq_time), ALGORITHM=INPLACE, LOCK=NONE;
ALTER TABLE SMSQ_SEND_16 ADD INDEX idx_status_seq_sendreq (status_code, seqno, sendreq_time), ALGORITHM=INPLACE, LOCK=NONE;
```

- 칸 순서의 이유: 에이전트 조회 = `status_code = 상수 AND seqno > 커서 … ORDER BY seqno LIMIT` → 앞 두 칸이 거르기와 정렬을 함께 하고, 셋째 칸 `sendreq_time` 이 남은 조건을 색인 안에서 걸러 행을 읽지 않는다(덮는 색인). 감시 · 정리 워커 = `status_code >= 100000` 범위.
- 조회가 훑는 양 = 대기(status 100) 색인 항목뿐(지금 3만 수준 · 한 항목 약 20바이트). 커서가 맨 앞으로 돌아가도 이력 행은 읽지 않는다.
- 범위 = 13 ~ 16(이력 이동 없는 비토 라인 · 앞으로 `LIKE SMSQ_SEND_13` 으로 만드는 표는 물려받는다). QTmsg 1 ~ 11 은 넣지 않는다(N4 · 월별 로그가 `LIKE <live>` 라 넣으면 로그에도 퍼진다).
- 실행 시점 = **.62 에서 전환 전, 발송이 없는 시간(새벽 · 03:00 백업 덤프가 끝난 뒤 · 08:00 전)** · 표 하나씩(16 → 13 → 14 → 15 · 작은 표부터).
  - 이유(Codex 설계 1R) = 전환 밤에 넣으면 색인 생성 시간이 그대로 서비스 중단 시간에 더해진다. .62 에서 미리 넣으면 마지막 복사(K4 · 도커 볼륨)가 결과를 .57 로 옮기고, 전환 밤에는 .57 에 색인이 있는지 확인만 한다(§7-2). 전환 전 낮 발송도 바로 가벼워진다.
  - 메타 잠금: `LOCK=NONE` 도 시작 · 끝에 짧은 배타 메타 잠금이 필요하다. 지금 15번 큐 조회가 한 번 45초까지 가므로, 그 끝을 기다리는 동안 그 표의 새 쿼리가 뒤에 줄 선다. → `lock_wait_timeout = 60`(표 하나 최대 60초 줄 섬 · 발송 없는 시간이라 결과 반영 UPDATE 몇 건이 그만큼 늦을 뿐 · 넘으면 그 문장만 실패하고 표는 그대로 = 다시 실행).
  - 실행 전 점검 = `SHOW PROCESSLIST` 에 그 표의 덤프 · 60초 넘는 쿼리가 없는지(§7-1 ②).
  - 시간 예산 = **07:30 까지 끝나는 표만 시작**한다. 다음 표를 시작하기 전 = 앞 표 걸린 시간 × (다음 표 행 수 ÷ 앞 표 행 수)로 끝 시각을 어림하고 07:30 을 넘으면 그 표부터 다음 새벽으로 미룬다(첫 표 16 은 작아서 기준을 잰다).
  - 잠금 실패 분기 = 60초 안에 메타 잠금을 못 잡아 `Lock wait timeout` 으로 실패하면 표는 그대로다 → 같은 문장을 한 번 더 · 또 실패하면 그 표는 다음 새벽.
  - DDL 연결 Id 기록 = ALTER 를 보내는 같은 한 번의 접속에서 먼저 `SELECT CONNECTION_ID();` 를 찍고(한 줄 명령 안 · 출력의 첫 값) 그 Id 를 적어 둔 뒤 `SET SESSION lock_wait_timeout = 60;` · ALTER 를 이어 보낸다(Codex 설계 5R · 실행 중에 Info 로 찾다가 그 사이 끝나면 Id 를 못 잡는다).
  - 시간 초과 분기 = 07:30 에 그 ALTER 의 명령 출력이 아직 안 돌아왔으면: 다른 MySQL root 세션에서 `SHOW PROCESSLIST` 로 **적어 둔 Id** 의 줄을 본다 → 그 줄이 있으면 무엇을 하고 있든(ALTER 전 · ALTER 중 · 끝나고 Sleep) `KILL <Id>`(연결째 끊음 · 끊긴 연결은 뒤늦게 ALTER 를 시작할 수 없다 = Codex 설계 6R · `KILL QUERY` 는 연결이 남아 Id 가 Sleep 으로 남는다 = 3R · 되감김 동안 `Killed` 로 보인다) · 줄이 없으면(이미 끝나 연결도 닫힘) KILL 하지 않는다 → 어느 쪽이든 **적어 둔 Id 의 줄이 없음**과 `Waiting for table metadata lock` 상태 줄 0 을 확인 → `information_schema.statistics` 로 그 표의 `idx_status_seq_sendreq` 를 보고 갈래를 가른다: (가) 없음 = 되감김 끝 → 그 표는 다음 새벽 (나) 있고 칸이 `status_code, seqno, sendreq_time` 순서 = 생성이 끝나 커밋된 것(KILL 전후 경쟁 포함 · Codex 설계 4R) → 생성 완료로 기록 · §7-1 ⑤ 확인으로 · 다시 하지 않음 (다) 있는데 칸이 다름 = 멈추고 보고. Id 줄 없음 · 잠금 대기 0 이 확인되면 (가)(나) 어느 쪽이든 그날 발송을 시작한다(그 전에는 시작하지 않는다 · 발송은 대기열 적재라 몇 분 늦게 나갈 뿐).
  - 전환 밤(.57)에는 DDL 을 하지 않는다(§7-2) — 못 넣은 표는 전환 뒤 첫 새벽에 .57 에서 이 절 그대로.
- 사전 점검 · 확인 = §7. 되돌리기 = `ALTER TABLE SMSQ_SEND_1x DROP INDEX idx_status_seq_sendreq, ALGORITHM=INPLACE, LOCK=NONE;`(표마다).
- 실행 = MySQL root(Harold · SCHEMA.md 의 `read -rsp` 꼴 · smsuser 는 ALTER 권한 없음).
- 다른 쿼리의 계획: 새 색인이 생겨도 `app_etc1` 로 시작하는 결과 · 취소 쿼리는 `idx_app_etc1_status` 가 더 좁다 → §7-1 ⑤ 로 대표 하나 확인 · 나머지는 §8 슬로 로그 대조.

### §4-2 에이전트 결과 일꾼 = 행별 차례(공용 용량 · D4 · bito-gateway)

- 바꾸는 곳 = `internal/agent/client/grpc_client.go` 한 파일(+ 시험).
- ⛔ 첫 안(일꾼마다 통 하나 · `fnv(source_seq) % N`)은 버렸다(Codex 설계 1R high) — 느린 행 하나가 자기 통(B/N)을 채우면 전체 용량이 남아도 수신 루프가 멈추고, 그 루프가 SendAck · Pong 도 받으므로 발송 확인 · 연결 유지까지 멈춘다.
- 새 안 = **용량은 지금처럼 하나(B = `resultBufferSize`)를 함께 쓰고, 순서만 행별로 지킨다.**
  - 수신 루프(한 줄로 순서대로 받는 유일한 자리)가 결과를 넣을 때: 자리 하나를 잡는다(대기 중인 결과가 B 개면 기다림 = 지금 통이 가득 찬 것과 같은 되밀림) → 잠금 안에서 그 행(source_seq)이 지금 처리 중(「차례 중」)이면 그 행의 대기 줄 끝에 붙이고, 아니면 「차례 중」으로 표시하고 공용 준비 통에 넣는다.
  - 일꾼: 준비 통에서 하나를 꺼내 처리 → 끝나면 잠금 안에서 그 행 대기 줄의 맨 앞을 꺼내 **「차례 중」을 그대로 둔 채 준비 통 끝에 다시 넣는다**(다른 행이 먼저 준비돼 있으면 그쪽이 먼저 · Codex 설계 2R) → 줄이 비면 「차례 중」을 지운다. 그 뒤 준비 통에서 다음 것을 꺼낸다.
  - 자리는 준비 통에서 꺼낼 때 돌려준다 → 자리 수 = 「꺼내지 않은 결과 수(준비 통 + 대기 줄)」 = 지금 통에 쌓인 수와 같은 뜻.
  - 준비 통 크기 = B(준비 통에 든 수 ≤ 꺼내지 않은 결과 수 ≤ B 라 수신 루프 · 일꾼 어느 쪽이 넣어도 막히지 않는다).
  - 한 행의 결과는 준비 통에 많아야 하나다(그 행이 「차례 중」인 동안 다음 것은 대기 줄) → 준비 통 순서 = 행들 사이의 공정한 차례(지금 공용 통과 같은 「먼저 온 행 먼저」).
  - 일꾼 1개 = 행별 차례를 쓰지 않고 모두 준비 통 한 줄(지금과 같은 순서 · 같은 되밀림 · 변화 0).
- 순서 증명: 같은 행의 결과는 수신 루프가 받은 순서대로 「준비 통 1건 → 대기 줄」에 놓이고, 대기 줄의 맨 앞은 그 행의 앞 결과가 처리를 마친 뒤에만 준비 통으로 옮겨진다. 「차례 중」 확인 · 붙이기 · 옮기기 · 지우기가 한 잠금 안이라 사이에 끼는 결과가 없다. → **한 행 안의 처리 순서 = 일꾼 1개일 때와 같다.**
- 확인 전송 순서: 같은 행의 다음 결과는 앞 결과의 고객 DB 쓰기 · 저널 닫기 · ReportAck 전송이 끝난 뒤에야 준비 통에 들어간다. 스트림은 순서를 지키므로 엔진은 같은 행의 ACK 를 받은 순서대로 받는다. 앞 결과가 실패하면 그 세대가 끊겨(`disconnectGeneration` · ctx 취소) 일꾼은 다음 것을 옮기지 않고 끝난다(지금과 같음) → 엔진 재전달(미전달 행 · 생성 순서)이 둘 다 다시 보낸다.
- 다른 행 지연: 행 X 의 뒤 결과는 앞 결과가 끝난 시점에 준비 통 끝으로 가므로, 그보다 먼저 준비된 다른 행 Y 를 앞지르지 않는다(일꾼이 남으면 바로 · 모자라면 준비된 순서).
- 바꾸지 않는 것 = 결과 처리 함수(`HandleReport`) · 저널 · 확인 전송(`sendMu`) · 받은 순서 커서(`markResultAckedForGeneration`) · 재연결 · 재전송 · 게이트 · 대기 수 계수(`reportsQueued` 를 넣을 때 올리고 꺼낼 때 내림 · `reportsInFlight`). 세대(재연결)마다 새로 만드는 지금 구조 그대로(옛 세대에 남은 결과는 지금처럼 버려지고 엔진이 다시 보냄).
- 다른 고객사: 발급값 1 = 변화 0. 키를 뺀 설정(기본 32)은 지금 순서 보장이 없던 것이 행 단위 순서 보장으로 바뀐다(더 엄격해질 뿐).
- 한줄로 네 대 설정 `report_concurrency: 8` = **새 판이 올라간 뒤에만**. 근거 = 건강할 때 일꾼 1개 천장 약 8,000/분 · 보낸 최대 27,600/분 → 4개면 따라가고 8개 = 밀린 것을 줄이는 몫 2배.
- DB 연결: 네 대 설정에 `max_open_conns` · `max_idle_conns` 줄 없음(1113 Harold grep 출력 0줄) → 자동 = send + report + 2(MySQL 상한 128 · config.go 511-541) = 대당 7 → 14 · 네 대 합 28 → 56. MySQL 최대 사용 82(백엔드 풀 포함) + 28 = 110 < `max_connections` 151.
- 출고 = bito-gateway `status/DEPLOY-RUNBOOK.md`(에이전트 서명 릴리즈 · 원격 배포) · 지금 돌고 있는 판은 배포 단계에서 확인.

### §4-3 백엔드(D2 · D3 · R94 지킴이)

- D2 · D3 = 코드 수정 0 — 두 워커의 첫 조건 `status_code >= 100000` 이 §4-1 색인 범위를 탄다(§7-1 ⑤).
- **R94 지킴이 = 실행 순간의 SQL 판정(1113 Harold 「네, 바꿔」)** — 정적 해석 계약 시험(구현 Codex 1R ~ 5R 같은 부류 반복 · 임의의 TS 를 정적으로 증명하는 일은 끝이 없음)을 걷고, 판정 자리를 실제로 나가는 SQL 글로 옮긴다.
  - 판정 CT = `utils/queue-scan-guard.ts`(새 파일 · 앱 모듈 가져오기 0 = 순환 0 · 순수 함수):
    - `queueScanVerdict(sql)` = SQL 글을 **토큰 배열**로 읽고 그 위에서만 판정한다(Codex 구현 1R · 2R = 이어 붙인 글 위 정규식 낱말 경계가 SQL 낱말 규칙과 달라 같은 부류가 두 번 → 구조 수정): 토큰 = 키워드 · 이름 · 값 · 숫자 · 기호 · 키워드는 이름 자리(역따옴표 · 점 뒤)가 아닌 낱말 중 판정 목록만(`q$END` · `t.limit` · `` `or` `` = 이름) · 문자열 · `@변수` · `?` = 값 · 숫자(`0.` · `1.5` · `1e3` · `0x1F`) = 한 토큰 · 숫자로 시작하는 이름(`1abc`) = 이름 · 주석 걷음 · 실행 주석 `/*!` · 닫히지 않은 따옴표 = 판정 불가(위반). 큐 표 이름 토큰(스키마 · 역따옴표 포함)마다 그 블록(같은 괄호 깊이 · UNION 갈래 · 하위 쿼리)의 WHERE 최상위 AND(깊이 = 괄호 + `CASE…END` · 음수 · 끝 깊이 어긋남 = 판정 불가)에 좁히는 색인 조건(§3 R94 · 칸 = 값 · 칸 IN (값…) · `status_code >= 경계`)이 있는가. 표가 있는지만 보는 `SELECT … FROM 큐표 LIMIT 0`(정확히 그 꼴 · `SQL_CALC_FOUND_ROWS` 없음) · 넣는 표(INSERT · REPLACE · INTO) · 본뜨는 표(LIKE) · 만드는 표 = 대상 아님.
    - **기본값 = 모르는 꼴은 위반(판정 불가)**(Codex 구현 3R · 판정 거짓 통과가 세 번째 같은 부류 = 「아는 규칙만 보고 나머지는 통과」가 뿌리 → 뒤집음 · 위반은 경보만이라 모르는 꼴을 알리는 쪽이 안전): 따옴표 · 주석 밖 ASCII 아닌 글자 · 모르는 기호 · 판정하는 문장 종류(SELECT · WITH · UPDATE · DELETE · INSERT · REPLACE · SET · EXPLAIN/DESCRIBE ANALYZE) 밖의 문장(행을 읽지 않는 SHOW · ALTER · 거래 등 · 정확히 `CREATE TABLE … LIKE 표` 는 건너뜀 · 큐 표 이름이 글 안에만 있어도) · 큐 표 블록 안(같은 깊이)의 다른 문장 머리(SELECT · TABLE · WITH = 모르는 집합 연산 · MINUS 등) = 판정 불가. 집합 연산 경계 = UNION · EXCEPT · INTERSECT. 넣는 표는 INSERT · REPLACE 의 그 대상 하나만 건너뜀.
    - `noteQueueSql(via, sql, params)` = 실행 함수가 실행 직전에 부른다 · **던지지 않는다 · 기다리지 않는다**(판정 중 예외도 삼키고 「판정 불가」로 보고) · 판정 글 = mysql2 가 실제로 보낼 글(같은 `format` 으로 `?` 값 · `??` 이름을 채움 · 이름 자리표시자로 표 이름을 넘겨도 판정) · 빠른 길 = 글에 `SMSQ_SEND` 도 `??` 도 없음 · SELECT · TABLE 없는 INSERT → 바로 돌아감.
    - 어기면 = 모양(문자열 = ? · 숫자 = N · 표 번호 = n · 공백 하나 · 160자 · 고객 값 0) 하나당 6시간에 한 번: 로그 한 줄(`console.warn('[queue-scan-guard] …')` · 동기 = 프로세스가 곧 끝나도 남는 기록) + 경보 보고(기다리지 않음). 모양 상한 200(6시간 지난 것부터 비움).
  - 부르는 자리(실행 직전 · 동작 · 반환 · 예외 변화 0): `config/database.ts` 의 `mysqlQuery` · `mysqlBillingQuery`(세션 상한 `SET` 글도 이름 있는 글로 만들어 같이 부름) · `withBoundedMysql` 의 run · 풀 연결을 직접 쓰는 두 자리 `utils/queue-load-tx.ts` `openQueueTransaction`(잠금 상한 `SET` 글 · run) · `utils/sms-queue.ts` `loadQueueUnit`(INSERT 라 빠른 길로 돌아감).
  - 경보(Codex 지킴이 설계 1R · 5분 패스에 묶으면 재기동 · 막힌 패스 때 잃음) = 위반을 처음 본 그 순간 `alertPassFailures`(pass `queue-scan-guard` · 사건 모드 · 항목 키 = 실행 함수 + 사유 + 모양) — **원장(`system_alert_pending`)에 먼저 쓰고** 문자를 보낸다 · 못 보냈거나 재기동되면 원장 줄을 10분 타이머 · 부팅 때 다시 보낸다(기존 `startPassAlertFlusher`). PG 가 막혔으면 메모리 대기 → 돌아오면 원장. 감시 워커 · 다른 패스와 무관 · 모든 프로세스에서 같다.
    - 순환 피하기 = 보고 함수가 `system-alert` 를 **처음 위반 때 늦게 가져온다**(`system-alert → config/database → 지킴이` 순환을 기동 때 만들지 않음).
    - 보장 범위(Codex 지킴이 설계 2R) = **다시 보내기 보장은 원장 쓰기가 된 뒤부터**. 원장 쓰기가 실패하면(PG 장애) 그 항목은 메모리 대기 → 10분 타이머 · 다음 보내기 때 원장으로 옮김 · 그 전에 재기동하면 **그 경보는 잃는다**(기존 `system-alert` 의 모든 패스 경보와 같은 한계 · 원장 밖 보조 대기열은 두지 않음 = 범위 밖 · 기록).
    - 잃어도 남는 것 = ① 로그 줄(위반 순간 동기 · pm2 로그) ② 같은 쿼리가 다시 나가면 재기동 뒤 첫 번에 다시 보고(지킴이 기록은 프로세스 메모리 · 운영 회귀는 주기 워커 · 반복 화면 쿼리라 다시 나간다). 한 번뿐인 위반 + PG 장애 + 재기동이 겹친 경우만 로그로만 남는다.
  - 미가입 · 직접발송만 쓰는 회사 = 동작 변화 0(판정 · 로그 · 경보뿐 · 쿼리 · 결과 · 예외 그대로).

---

## §5 영향표

### §5-1 C131-DDL-1(색인 하나 = 그 칸을 바꾸는 쓰기마다 색인 항목 하나 더)

| 쓰는 자리 | 바꾸는 칸 | 영향 |
|---|---|---|
| 적재 INSERT(`sms-queue.ts` 192 · 201 · 1320 · 1352) | 행 추가 | 항목 1 추가(표 끝 · 대기 구역 끝에 붙음) |
| 에이전트 결과 UPDATE(`poller.go` 1036) | status_code | 항목 1 지우고 1 넣음(대기 구역 → 결과 구역 · 둘 다 최근 번호 끝) |
| 취소 DELETE · 9999 · 4000 마킹(`campaign-lifecycle.ts` · `cancelled-queue-sweeper.ts` · `expired-pending-sweeper.ts`) | 행 삭제 · status_code | 항목 지움 · 바꿈 |
| 예약 시각 변경(`routes/campaigns.ts` `UPDATE SMSQ_SEND SET sendreq_time = DATE_ADD(…) WHERE app_etc1 = ? AND status_code = 100`) | sendreq_time | 대기 행마다 항목 바꿈(드묾 · 캠페인 크기 비례) |
| 읽는 자리 | — | 옛 색인은 그대로 · 옵티마이저가 고르는 자리가 바뀔 수 있는 쿼리 = 조건에 status_code 가 있는 큐 표 쿼리 → §7 EXPLAIN ④ ⑤ 로 대표 둘 확인 · 나머지는 §8 슬로 로그 대조 |

### §5-2 에이전트 행별 차례

| 소비처 | 영향 |
|---|---|
| `recvLoopForGeneration`(1174) · `startConnectedSessionLocked`(555) | 결과 큐(`reportCh` 자리)를 넘김 · 형만 바뀜 |
| `enqueueReport`(1258-1284) | 게이트 · 계수 · 커서 추적은 그대로 · 자리 잡기(ctx 취소면 계수 되돌림 = 지금 갈래 그대로) → 행별 차례 판정 → 준비 통 |
| `reportLoopForGeneration`(1233-1256) | 준비 통에서 꺼냄(자리 돌려줌 · `reportsQueued--` · `reportsInFlight++`) → 처리 → `reportsInFlight--` → 세대가 살아 있으면 그 행 대기 줄 맨 앞을 준비 통 끝으로 · 비면 차례 지움 |
| `processReportForGeneration`(1295-) · `HandleReport` · 저널 · 커서 | 변화 0 |
| 시험 `grpc_client_test.go`(`client.reportCh` 를 넘기는 7곳) | 같은 이름으로 결과 큐를 넘김(형만) |
| 다른 패키지 | `reportCh` 참조 0(grep `\.reportCh\b` = client 패키지만) |

### §5-3 R94 지킴이(실행 직전 판정 · 1113 grep)

| 자리 | 지나는 SQL | 바뀌는 것 |
|---|---|---|
| `config/database.ts` `mysqlQuery`(149) | 백엔드 MySQL 조회 거의 전부(sms-queue 공용 함수 · results · 감시 · 정리 워커) | 실행 직전 `noteQueueSql` 한 줄 · 반환 · 예외 · 연결 반납 그대로 |
| `withBoundedMysql` run(204) | 상한 걸린 MySQL 조회 | 같음 |
| `mysqlBillingQuery`(255) | 정산 MySQL 조회 | 같음(`SET SESSION` 글은 빠른 길) |
| `utils/queue-load-tx.ts` `openQueueTransaction` run(65) | 적재 트랜잭션 안 글(INSERT · 묶음 표) | 같음(대부분 빠른 길) |
| `utils/sms-queue.ts` `loadQueueUnit`(1538) | 적재 INSERT | 같음(빠른 길) |
| 기동 확인(121 · `SELECT NOW()`) · `CONNECTION_ID()` · `SET SESSION` | 글자 그대로 · 큐 표 0 | 수정 0 |
| `utils/pay-stats.ts` 자체 풀(`insertAgentCharges` 의 `getConnection` 포함) | 결제 DB(`RSRM_*` · `SMSQ` 글자 0) | 수정 0 · 계약 (나)1 · 2 의 예외(그 파일 = `SMSQ` 글자 0 · 자기 풀만) |
| `mysqlBillingQuery` 세션 상한(260) · `openQueueTransaction` 잠금 상한(57) | `SET SESSION …` | 같은 글을 이름(`limitSql` · `lockSql`)에 담아 `noteQueueSql` 뒤 실행(글 · 순서 · 예외 처리 그대로 · 빠른 길) |
| `utils/system-alert.ts` | — | 수정 0(지킴이가 위반 때 `alertPassFailures` 를 부름 · 원장 · 다시 보내기 = 기존) |
| 시험이 `mysqlQuery` 를 가짜로 바꾼 곳 | — | 가짜는 지킴이를 안 지남 · 영향 0 |

- 비용 = 큐 글자 없는 SQL 은 `includes` 한 번 · 큐 SQL 은 글 길이에 비례한 한 바퀴(묶음 INSERT 는 빠른 길).

---

## §6 시험

### §6-1 bito-gateway(Go · `go test ./...` · `go vet ./...` · gofmt)

1. **같은 행 순서**: 일꾼 8 · 행 X 의 첫 결과가 처리 함수 안에서 막혀 있는 동안 X 의 둘째 · 셋째 결과는 처리 함수에 들어가지 않고, 막힘을 풀면 첫째 → 둘째 → 셋째 순서로 들어간다.
2. **다른 행 병렬**: 같은 상황에서 행 Y 의 결과는 X 가 막혀 있는 동안 처리 함수에 들어간다.
2-1. **다른 행 공정(Codex 설계 2R 반례)**: 일꾼 2 · X · Z 첫 결과가 처리 중일 때 Y 첫 결과 → X 둘째 → Z 둘째 순으로 받고 X · Z 첫 결과를 풀면, Y 가 X 둘째 · Z 둘째보다 먼저 처리 함수에 들어간다.
3. **수신 루프 안 막힘(R95 둘째 줄)**: B 를 작게(예 8) 두고 X 첫 결과를 막은 채 X 결과 B−1 건을 더 받은 뒤 SendAck 프레임 → SendAck 가 풀린다(꺼내지 않은 결과 < B). B 개째에서만 수신이 기다린다.
4. **일꾼 1 = 지금과 같음**: X#1 · Y#1 · X#2 를 받은 순서 그대로 처리.
5. **계수**: 처리 중 · 대기 줄 · 준비 통에 걸친 결과 수가 `QuiesceSnapshot` 의 대기 · 처리 중 합과 맞고, 다 끝나면 0 · `DrainBeforeGate` 가 대기 줄까지 기다린다.
6. **세대 끊김**: X 첫 결과 처리 중 처리 함수가 실패 → 세대 끊김 → X 둘째는 처리 함수에 들어가지 않는다(ACK 0 · 엔진 재전달 몫).
- 변이(파일 복사 · git 0) = ① 행별 차례를 끄면(모두 준비 통) 1 이 빨간불 ② 일꾼 수를 1 로 묶으면 2 가 빨간불 ③ 통을 일꾼마다 B/N 으로 나누면 3 이 빨간불 ④ 뒤 결과를 준비 통 끝이 아니라 같은 일꾼이 바로 처리하면 2-1 이 빨간불.

### §6-2 한줄로 백엔드(R94 지킴이 · 1113 Harold 「네, 바꿔」로 정적 추출 계약을 걷고 바꿈)

**(가) 판정 단위 시험 `utils/__tests__/queue-scan-guard.test.ts`** — `queueScanVerdict` 에 SQL 글을 넣어 본다.
- 통과해야 하는 글 = 지금 코드가 실제로 내는 꼴: 에이전트 · 감시 워커 · 만료 정리 · 취소 정리 · 캠페인 결과 조회(`app_etc1 = ?` · `app_etc1 IN (?, ?)`) · 묶음 집계 · UNION ALL 묶음 · `status_code >= 100000` · `LIMIT 0` 존재 확인 · INSERT.
- 위반이어야 하는 글 = 판정 반례(조건 없음 · OR 섞임 · `seqno > 0` 만 · `mobsend_time IS NULL` 만 · `status_code >= 100` 처럼 경계 밑 · 하위 쿼리 · UNION 한 갈래만 좁힘 · JOIN 쪽 큐 표 · 역따옴표 · 스키마 붙은 표 이름 · `/*!` 실행 주석 · 주석으로 조건을 가린 글 · 문자열 안의 `WHERE app_etc1 = 1` · 겹따옴표 · `'` 이스케이프) + 정적 계약 시절 Codex 구현 1R ~ 5R 반례를 **나가는 SQL 글로 옮긴 것**(따옴표 뒤 연산자 조각 · 문자열 안 FROM · 역빗금 뒤 조각 등 · 글이 되면 같은 판정을 받는다).
- `noteQueueSql` = 던지지 않음(보고 함수가 던지거나 거절해도) · 빠른 길 · `??` 이름 자리표시자 · `?` 값 채움 뒤 판정 · 모양에 고객 값 0 · 같은 모양 6시간 한 번 · 상한 · 기본 보고 = `alertPassFailures`(가짜 보고로 바꿔 부름 횟수 · 항목 키 확인).

**(나) 실행 길 계약(소스 · 작은 닫힌 목록) `utils/__tests__/queue-scan-guard-route.test.ts`** — 「MySQL 로 나가는 SQL 은 지킴이를 지난다」:
1. `mysql` 로 시작하는 모듈을 가져오는 자리(import · require · 동적 import) = `config/database.ts` · `utils/queue-scan-guard.ts`(`format` 하나만 · 실행 0) · `utils/pay-stats.ts`(결제 DB 전용 풀 · 그 파일의 `SMSQ` 글자 0)뿐.
2. `mysqlPool` · `mysqlBillingPool` 이름 · `config/database` 의 이름공간 · require 가져오기 = 닫힌 목록(`config/database.ts` · `utils/queue-load-tx.ts` · `utils/sms-queue.ts`) 밖 0 · 목록 파일 안에서도 연결을 쓰는 함수 목록(`mysqlQuery` · `mysqlBillingQuery` · `withBoundedMysql` · 기동 확인 · `openQueueTransaction` · `loadQueueUnit`) 밖 0 · 백엔드 어디든 `getConnection(` 을 부르는 함수 = 같은 목록 + `utils/pay-stats.ts`(1 의 예외와 같은 이유).
3. 그 함수들 안의 `.query(` · `.execute(` 첫 인자 = 끼워 넣기 없는 글(`SMSQ` 글자 0) 이거나, 같은 함수(가장 안쪽 함수)에서 `noteQueueSql(` 에 넘긴 같은 이름.
4. 받은 연결은 그 함수 밖으로 나가지 않는다 — 연결을 담은 이름은 `연결.메서드` 꼴로만 쓰인다(돌려주기 · 인자로 넘기기 · 객체 · 배열에 담기 0 · `withBoundedMysql` 의 상한 기다리기 `raceBounded` 만 예외).
- 변이(1113 실행 · 파일 복사 · git 0) = (가) 토큰 판정 열하나 = 경계 100 · 최상위 OR 무시 · CASE 묶음 없음 · 음수 깊이 허용 · 점 뒤 키워드 · 숫자 끝 소수점 · SQL_CALC_FOUND_ROWS 허용 · 값 안 채움 · UNION 경계 없음 · 실행 주석 통과 · 큐 표 전부 건너뜀 → 전부 빨간불(음수 깊이는 첫 판에서 살아남아 「중간에 음수였다 0 으로 돌아오는 꼴」 반례를 더함 · 글 판정 때 살아남은 OR 무시 · 값 안 채움도 반례 셋으로 고정). (나) 경로 계약 = 시험 안 반례(지킴이 줄 지움 4자리 · 연결 내보내기 2 · 새 파일 풀 · mysql2 · 이름공간 · 글자 아닌 require · 다시 내보내기 · 동적 가져오기 넷 · 같은 파일 다른 함수 · 결제 파일 큐 글자) 전부 위반 · PG 만 쓰는 동적 가져오기 꼴은 통과.
- 옛 정적 추출 계약 `bito-queue-scan-1113.test.ts` = 지움(같은 부류 거짓 통과가 5 라운드 반복 · 임의의 TS 를 정적으로 증명하는 일은 끝이 없음 · 판정 자리를 나가는 글로 옮긴 것이 구조 수정).
- 시험이 못 덮는 것(기록) = 실제로 어떤 SQL 이 나가는지는 운영에서 지킴이가 본다 · 위반은 막지 않고 경보(쿼리를 막으면 발송 · 결과 반영이 멈추는 쪽이 더 위험).

### §6-3 실 DB

- §7-1 ⑤ EXPLAIN · EXPLAIN ANALYZE(네 표 · 실제 문장 꼴) = 이 색인의 실 DB 시험.

---

## §7 실행 순서

### §7-1 .62 · 전환 전 발송 없는 시간(C131-DDL-1)

① 발송 없음 확인 = 네 대 「Poller 상태」 `lastFetchCount` 0 · 03:00 백업 덤프 끝(`SHOW PROCESSLIST` 에 `SQL_NO_CACHE` 0).
② `SHOW PROCESSLIST` 에 그 표를 60초 넘게 붙든 쿼리가 없는지(있으면 끝날 때까지 기다림).
③ 사전 점검(읽기만):
   `SELECT table_name, index_name, GROUP_CONCAT(column_name ORDER BY seq_in_index) FROM information_schema.statistics WHERE table_schema = 'smsdb' AND table_name IN ('SMSQ_SEND_13','SMSQ_SEND_14','SMSQ_SEND_15','SMSQ_SEND_16') GROUP BY table_name, index_name;` → 같은 이름 색인 0.
   `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'smsdb' AND table_name IN ('SMSQ_SEND_13','SMSQ_SEND_14','SMSQ_SEND_15','SMSQ_SEND_16') AND column_name IN ('status_code','seqno','sendreq_time','mobsend_time','app_etc1');` → 4 표 × 5 칸 = 20 행.
   `SELECT table_name, table_rows FROM information_schema.tables WHERE table_schema = 'smsdb' AND table_name REGEXP '^SMSQ_SEND_[0-9]+$';` → N4(QTmsg 라이브 표 크기) 판정.
④ DDL = `SET SESSION lock_wait_timeout = 60;` 뒤 §4-1 문장을 16 → 13 → 14 → 15 순서로 하나씩(표마다 걸린 시간 기록 · 실패 분기 = §4-1).
⑤ 표 넷 각각(아래 15 자리를 13 · 14 · 16 으로 바꿔 같은 문장):
   (가) 에이전트 첫 조회 · 커서 되감긴 꼴 `EXPLAIN ANALYZE SELECT seqno FROM SMSQ_SEND_15 WHERE status_code = '100' AND sendreq_time <= NOW() ORDER BY seqno ASC LIMIT 1000;`
   (나) 커서 꼴 `EXPLAIN SELECT seqno FROM SMSQ_SEND_15 WHERE status_code = '100' AND seqno > 0 AND sendreq_time <= NOW() ORDER BY seqno ASC LIMIT 1000;`
   (다) 감시 워커 그대로 `EXPLAIN ANALYZE SELECT COUNT(*) AS cnt, MIN(sendreq_time) AS oldest FROM SMSQ_SEND_15 WHERE status_code >= 100000 AND mobsend_time IS NULL;`
   (라) 대기 행 수 `SELECT COUNT(*) FROM SMSQ_SEND_15 WHERE status_code = 100;`(색인만 읽음)
   그리고 정리 워커 그대로(비토 넷 묶음 한 번):
   (마) `EXPLAIN ANALYZE SELECT _grp, COUNT(*) AS cnt FROM (SELECT CONCAT(COALESCE(app_etc1, ''), '|', status_code) AS _grp FROM SMSQ_SEND_13 WHERE status_code >= 100000 AND mobsend_time IS NULL AND sendreq_time < NOW() - INTERVAL 48 HOUR UNION ALL …14 · 15 · 16 같은 꼴…) AS _u GROUP BY _grp;`
   (바) 결과 쿼리 계획 유지 `EXPLAIN SELECT COUNT(*) FROM SMSQ_SEND_15 WHERE app_etc1 = '6edba15b-30b0-4624-ac69-b386806ce62f' AND status_code = 100;` → `idx_app_etc1_status`.
   합격 = (가)(나)(다)(마) `idx_status_seq_sendreq` · range · (가)(나) `Using index` · filesort 없음 · (가) 실제 읽은 행 ≤ (라) + 1000 · 시간 < 1초 · (다) < 1초 · (마) < 2초 · (바) 옛 색인.
   **하나라도 다르면 멈추고 보고**(옵티마이저가 PK 정렬 경로를 고른 경우 = 처방 재설계 · 색인은 두어도 해가 없으나 효과 0).
⑥ 그날 첫 대량 발송 전 · 뒤 §8 슬로 로그 대조.

### §7-2 전환 밤 · .57(서버이관 런북 §8-5 에 한 줄로 끼움)

- MySQL 기동 · 행 수 대조 뒤 §7-1 ③ 첫 문장으로 네 표의 `idx_status_seq_sendreq (status_code, seqno, sendreq_time)` 가 있는지 **확인만** 하고 기록한다(DDL 0 · 몇 초 · 서비스 기동을 막지 않는다).
- 없는 표가 있으면 전환을 그대로 마치고, 그 표는 전환 뒤 첫 새벽에 .57 에서 §7-1 절차(시간 예산 · 잠금 실패 · 시간 초과 분기 포함) 그대로.

---

## §8 실측 시나리오(같은 대량 발송 조건 · 합격선)

| 볼 것 | 합격 |
|---|---|
| 슬로 로그(전환 뒤 첫 대량 발송 날 끝 20MB · §0-1 명령) | `SELECT seqno FROM SMSQ_SEND_1x` · `COUNT(*) … oldest` · `CONCAT(COALESCE(app_etc1` 줄 0 |
| 에이전트 큐 조회 횟수(조용한 시간 1분) | 네 대 모두 100회 이상(`poll_timeout` 걸림 0) |
| 일꾼 1개 결과 반영 천장(새 판 전 · 결과 밀린 날) | 분당 8,000 안팎으로 복귀(D1 ~ D3 효과) |
| 새 판 + 8 뒤 | 1분 차이에서 결과 반영 ≥ 보냄 · `claimedInMemory` 안 늘어남 · 엔진 report_queue 미전달 안 늘어남 · `reportDBFailures` 0 |
| MySQL | `Threads_connected` < 151 · 페이지 조회 초당 평균(전환 전 25.6만) 대폭 감소 |
| 정합성 | 같은 요청에 결과 2건 이상인 행(엔진 조회)의 고객 DB 최종값 = 마지막 결과 |
| R94 지킴이(백엔드 배포 뒤 하루) | 백엔드 로그 `[queue-scan-guard]` 줄 0 · 시스템 경보 원장 `pass = 'queue-scan-guard'` 0 — 있으면 그 모양이 운영 코드의 실제 훑기(또는 판정 거짓 위반) = 그 줄로 바로 대조 |
| 지킴이 비용 | 배포 전후 같은 시간대 백엔드 CPU · 결과 조회 응답 시간 차이 없음(큐 글자 없는 SQL = 글자 찾기 한 번) |

---

## §9 직원 지시문

화면 동작 변화 0(문구 · 단추 · 숫자 계산 그대로)이라 직원 시트를 만들지 않는다. 닫힘 = §8 실측(Harold) — 결함 플레이북 §2 직원 칸의 예외로 Harold 확인을 받는다.

---

## §10 기록만(이번 범위 밖)

- 에이전트 결과 대기 31,101 과 엔진 DELIVERED 26,914 의 약 4,200 차이(1113 02:5x) — 미검증.
- 엔진 QUEUED 로 11-10 11:2x 부터 멈춘 3건(hanjul03 2 · hanjul-04 1).
- 에이전트 설치 점검(doctor · test-poll)이 큐 조회의 실행 계획(전체 훑기)을 보지 않는다 — 다른 고객사 표에 같은 결함이 있어도 모른다.
- 보내는 동시성(`send_concurrency`) — 중계사 212 거절 실측(AGENT_MANUAL §4) 때문에 이번에 손대지 않음.
- 11-10 부터 천장이 반으로 떨어진 시점 자체의 원인(같은 날 MySQL 재기동 · 표 크기 문턱) — §8 에서 복귀 여부로만 판정.
- 엔진 재전달은 미전달 행만(`report_queue delivered = FALSE` · 생성 순서 · bito-gateway `internal/gateway/session/grpc_server.go` 754-) 다시 보낸다. 같은 요청의 앞 결과 ACK 반영(묶음 20ms)이 DB 오류로 빠지고 뒤 결과 ACK 만 반영되면 앞 결과가 다시 와 최종값을 덮을 수 있다 · 연결 중 주기 재전달이 에이전트가 아직 처리 중인 결과를 다시 보내는 경우도 같은 꼴 — 이번 변경 전에도 있던 엔진 쪽 가능성(일꾼 수와 무관 · 미검증 · 최근 300만 행에서 같은 요청 결과 2건 이상 = 0). 이번 변경은 같은 행 처리 순서를 지금과 같게 유지해 새 위반을 더하지 않는다.
