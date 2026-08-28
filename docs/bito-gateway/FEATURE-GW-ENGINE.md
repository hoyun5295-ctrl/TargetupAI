# 비토 게이트웨이 — 발송·결과 엔진 축 (GW-ENGINE)

> 허브 = [FEATURE-BITO-GATEWAY.md](../FEATURE-BITO-GATEWAY.md) (§9 등재). 수정 시 허브 §2-1 작업 규율 적용.
> 이 문서가 게이트웨이 코어(수락→큐→발송→결과→ACK) 축을 소유한다. 최초 작성 = 2026-08-15 전수점검. **허브 §7-1 총평 "Go 코어 상급"의 근거가 이 축이다.**

## 1. 정체성

모든 메시지가 지나는 중심. `InboundPort → Validator → Writer(PG 큐) → Dispatcher → Router → Sender → Connector → ReportCorrelator → OutboundPort(Agent)`. Engine이 전 컴포넌트 라이프사이클을 소유(ADR-19).

## 2. 구조와 계약 (소스 실독 — 세부는 코드가 진실)

**수락** (`accept.go`·`inbound.go`) — 검증→식별코드→정책 게이트→저장뿐. **과금 없음**(과금 축 §2). agent 소스는 micro-batch(기본 500/1ms linger) 일괄 INSERT. 응답은 DB commit 후에만(유실 0 원칙)

**멱등 저장** (`queue/writer.go`) — `(agent_id, source_seq)` ON CONFLICT. **같은 키에 다른 발송 본문이 오면 무시가 아니라 `SOURCE_SEQ_PAYLOAD_CONFLICT` 오류**(updated_at NOT NULL 위반을 신호로 쓰는 단일 왕복 기법 — 영리하나 updated_at 제약 변경 시 조용히 무력화되는 결합. §3-2)

**디스패치** (`queue/dispatcher.go`) — LISTEN/NOTIFY + 30초 폴백, wake 병합(폭주 억제), 카테고리 lane 3개(sms/lms_mms/kakao), `FOR UPDATE SKIP LOCKED` 클레임. **미해소 attempt(sent_at 있고 ack_at 없음)가 있는 행은 재클레임 제외** — 격리의 실행 지점

**발송** (`sender.go` 1,553줄) — 이 축의 핵심 계약:
- **write 경계 3분류**: NotWritten/Rejected(확인된 미기록·거절)만 bind를 비우고 재라우팅(`handleSafeRetry`), WriteUnknown/영속 실패는 **quarantine**(QUEUED로 두되 미해소 attempt가 재클레임을 막음 — REPORT나 운영자만 해소)
- **내구 ACK 복구**: provider 성공 후 상태 저장이 실패해도 durable attempt ACK가 있으면 재발송 없이 상태만 복구
- 발신자 식별코드 3모드 검증 + **FOR SHARE 잠금으로 검증-발송 사이 정책 변경 차단**(TOCTOU)
- 3-tier TPS·일한도 전부 fail-closed / 미등록 발신번호 발송 전 차단(reseller 정책 `exempt_special_vasp` 예외)
- attempt 기록이 성공해야만 provider write 시작(`recordAttemptStart` — affected 0이면 중단)

**결과** (`report.go` 34KB) — REPORT 정규화(rune 절단·시각 보정)→상태 갱신→`report_queue` 내구 적재(원자 upsert)→Agent 전달. **DONE은 Agent ReportAck 후에만**(API 소스는 즉시 종결 — CODEX.md 계약과 일치 확인). 재연결 시 `delivered=false` 기반 replay. 카카오 실패 시 Gateway 관리 fallback 생성(부모-자식 연결·성공 코드 7830/7831 합성)

**정체 복구** — 시작 시 stale SENDING 재큐(5분 임계) + GapDetector 상시 + MMS media 보존기간 청소

## 3. 확정 사실·위험 (2026-08-15)

| # | 내용 | 위치 |
|---|---|---|
| 1 | 발신번호 허용 캐시가 **전역 뮤텍스를 DB 조회 동안 유지** — 캐시 히트도 같은 잠금을 지난다. outbound 64워커가 이 지점에서 직렬화될 수 있음. **영향 미측정 — 처방 금지, EXPLAIN·부하 실측 후** | `sender.go:1177-1182` |
| 2 | 본문 충돌 신호가 updated_at NOT NULL 제약에 결합(§2) — 스키마 변경이 이 오류 신호를 조용히 없앨 수 있음. 회귀 테스트 존재 여부 확인 필요 | `queue/writer.go:468-474` |
| 3 | 성공 ACK 판정에 빈 문자열 포함(`"" == 성공`) — 커넥터가 코드를 빠뜨리면 성공 처리. 현 커넥터들은 항상 코드를 채우나 계약으로 명문화 안 됨 | `sender.go:1549-1552` |
| 4 | opsai·redis 패키지 테스트 0개 | `gateway/opsai`·`gateway/redis` |

**견고 확인** — 종료 순서(인바운드 flush→Dispatcher 합류→Sender 종료→컨텍스트 취소→커넥터 정지, 경합 근거 주석) / TPS 콜백 단일 writer / 배처(dispatch·ack·report) 전부 bounded+CloseAndWait.

## 4. 테스트 증거 (2026-08-15 로컬)

`internal/gateway/...` 전 패키지 PASS(engine 3.3s·session 7.7s·queue 2.9s 포함). sender_test 32KB·report_test 27KB 등 경계 테스트 밀도 높음. PG 통합 테스트는 로컬 DB 없이 스킵.

## 5. 착수 원장

1. [ ] 발신번호 캐시 잠금 실측(§3-1) — 이관 트래픽 개시 후 관측으로만 판단. 처방 선행 금지
2. [x] ~~본문 충돌 신호의 회귀 테스트 유무 확인(§3-2)~~ — **있다**(0828 확인). `queue/writer_postgres_test.go:160·182`가 변경 payload에 `SOURCE_SEQ_PAYLOAD_CONFLICT`를 요구한다. 단 PG 통합 테스트라 로컬 DB 없이는 스킵된다 — updated_at 제약을 신호로 쓰는 결합(§3-2)은 그 환경에서만 지켜진다
3. [x] ~~빈 ACK 코드 = 성공 계약 명문화(§3-3)~~ — **닫혔다**(0815(2) `139a6c9`). `internal/common/resultcode/resultcode.go` 패키지 doc이 "빈 코드는 성공이 아니다"를 근거까지 소유한다
4. [ ] **웹훅 이벤트 정체성**(§6-5) — 보정 전후 이벤트의 순서와 최신 판정. 0828 축에서 분리한 남은 것

## 6. 고객 웹훅 종결 계약 (★2026-08-28 신설·배포완료 `140052d`)

### 6-1. 무엇이 잘못돼 있었나 (운영 실측)

`webhook_queue`의 생산자는 PG 트리거 `trg_webhook_report` 하나다(Go·Node에 직접 INSERT 0건 실측). 그 발화 조건이 `DELIVERED`·`DONE`·`FAILED`였고 운영 `pg_get_triggerdef`로 같은 정의를 확인했다.

**`DELIVERED`는 종결이 아니다.** `internal/common/model/message.go:15`가 `DELIVER_ACK 성공`이라 정의한다. 중계사가 접수했다는 뜻이다. 그런데 트리거가 넣는 payload는 `report_code`·`report_message`·`report_time`을 담은 결과 형식이라, 고객 서버는 아직 결과가 없는 건을 결과로 읽는다. `status/domains/MESSAGE_PIPELINE.md`의 "종결 결과만 공개한다" 계약과 어긋나 있었다.

둘째로 `WHEN`이 OLD와 NEW를 비교하지 않았다. `AFTER UPDATE OF`는 값이 안 바뀌어도 SET 목록에 컬럼이 있으면 발화한다. 같은 값 재기록 경로가 둘이다 — `queue/updater.go` `MarkDelivered`(늦은 ACK가 이미 종결된 행을 다시 쓴다)와 `engine/report_batcher.go` `updated_request`(같은 REPORT가 다시 오면 DONE을 DONE으로 쓴다).

**유출 이력은 없다.** 웹훅 주소를 가진 계정 0건, `webhook_queue` 0건을 적용 직전 실측했다. 소비자가 0이라 고치기 가장 안전한 시점이었다.

### 6-2. 무엇을 바꿨나

| 경계 | 변경 | 파일 |
|---|---|---|
| 큐에 넣는 쪽 | 발화를 `DONE`·`FAILED`로 좁히고, 결과가 실제로 달라졌을 때만 발화 | `migrations/052_webhook_terminal_only.sql` |
| 내보내는 쪽 | 전송 직전 종결이 아니면 보내지 않고 `SUPERSEDED`로 종료 | `web/api/workers/webhook-worker.js` `_send` |
| 판정 소유 | `CUSTOMER_TERMINAL_STATUSES = ['DONE','FAILED']` 신설 | `web/api/services/result-code.js` |
| 회귀 가드 | 전송 경계 계약 8종 고정 | `web/api/test/webhook-terminal-gate-test.js` |

**큐에 넣는 경계만 잠그면 통제가 작동하지 않는다.** `_enrichPayload`가 전송 직전 live row로 `status`를 덮어쓰므로, `DONE`으로 적재된 뒤 늦은 REPORT가 상태를 `REPORTED`로 되돌리면 고객은 미종결을 결과로 받는다. 두 경계를 같이 잠갔다.

### 6-3. 중복 판정 기준 — 상태가 아니라 결과 동등성

상태만 비교하면 정당한 보정을 잃는다. `engine/report.go` `markParentFallbackFinal`은 API 소스 부모를 `FAILED`로 갱신하는데 WHERE에 `FAILED`가 있어, **이미 FAILED인 부모의 결과 필드만 바뀌고 상태는 그대로인 경로**가 있다. 늦은 실제 REPORT가 합성 실패를 덮는 계약이 그것이다.

**`report_time`은 비교에서 뺀다.** payload에 담기지만 결과가 달라졌다는 신호가 아니다. `queue/updater.go` `normalizeEventTime`이 provider 시각이 없으면 수신 시각을 채우고, GemTek은 SENDTIME 파싱이 TODO라(`connector/gemtek/conngroup.go:577`) 그 경로의 `report_time`은 언제나 수신 시각이다. 넣으면 REPORT ACK 유실로 같은 REPORT가 재수신될 때마다 고객 콜백이 중복된다. 게이트웨이가 이미 같은 판단을 한다 — `report_batcher.go:70-74`와 `updater.go:148-153`의 동일 REPORT 판정 둘 다 `report_time`을 제외한다.

### 6-4. 배포 (2026-08-28 13:12~13:15 KST)

순서 = api 2회 → DDL. 런북의 "DDL 선적용"은 새 컬럼을 쓰는 코드가 컬럼보다 먼저 뜨는 것을 막는 규칙인데 워커 게이트는 트리거와 독립으로 동작하므로 해당하지 않는다. 잠금을 거는 유일한 작업을 마지막에 뒀다.

⛔ **api 파일 순서는 `services/result-code.js` → `workers/webhook-worker.js`.** 워커가 그 상수를 import하므로 역순이면 재시작된 워커가 없는 값을 참조한다.

**DDL 잠금 = `SET LOCAL lock_timeout = '250ms'`.** PG 잠금 대기는 줄서기라 이 문장이 기다리는 동안 뒤에 온 발송 트랜잭션도 함께 밀린다. 즉 **대기 상한이 곧 발송이 멈출 수 있는 최대 시간**이다. 고객 REST 접수는 가장 붐비는 10시대에 21.6초 간격이므로 250ms 안에 못 잡는 것은 긴 트랜잭션이 도는 중이라는 뜻이고, 그때는 물러나는 편이 낫다. 실패하면 트랜잭션째 롤백돼 아무것도 바뀌지 않는다.

**무중단 실측** — 배포 전후 nginx 13시대 누적에 5xx 0건. 그 사이 `200` +184, `201` +8로 접수가 계속 들어왔다. api 재시작 2회와 DDL 잠금 모두 발송에 닿지 않았다. 백업 = `deploy-backups/20260828-131239`·`20260828-131320`.

### 6-5. 남은 축 — 웹훅 이벤트 정체성 (착수 원장 4)

Codex 2R이 올린 것이고 **이번 축에서 분리했다.** 052 이전부터 있던 구조이며 이번 축(미종결 차단)은 이것 없이 닫힌다.

내용 = 보정 이벤트 B가 적재돼도 미전송 이벤트 A가 `PENDING`으로 남고, 게이트는 revision이 아니라 현재 live status만 보므로 둘 다 통과한다. `_processBatch`가 `Promise.all`로 병렬 전송해 순서 보장이 없고, `_enrichPayload`가 top-level `report_message`·`report_time`은 덮지 않아 새 코드와 옛 메시지가 섞인 콜백이 나올 수 있다.

처방 방향 = 요청별 result revision 또는 공개 payload fingerprint를 큐에 저장하고, 새 revision 적재 시 이전 미전송 이벤트를 원자적으로 `SUPERSEDED` 처리하며, 워커가 최신만 전송한다. **DDL·트리거·워커·순서 보장이 한 묶음이라 별도 축이다.** 지금은 소비자 0이라 발현하지 않는다.

### 6-6. ⛔ 이 축의 불변

- **두 경계를 같이 잠근다.** 트리거만 고치면 워커가 live로 덮어써 새고, 워커만 고치면 미종결이 큐에 쌓인다
- **종결 집합은 `services/result-code.js`가 소유한다.** 워커·라우트에 다시 적지 않는다. `FAILED_STATUSES`는 `SEND_FAILED`를 포함하는 표시 축이라 재사용 금지
- **`SEND_FAILED`는 종결이 아니다.** Agent 소스에서 결과를 기다리는 보류다(`queue/updater.go` `MarkSendFailed`)
- **`report_time`을 결과 동등성에 넣지 않는다**(§6-3)
- **트리거 발화 조건과 `CUSTOMER_TERMINAL_STATUSES`는 같은 값이어야 한다.** 한쪽만 넓히면 두 경계가 어긋난다. `webhook-terminal-gate-test.js`가 그것을 고정한다
