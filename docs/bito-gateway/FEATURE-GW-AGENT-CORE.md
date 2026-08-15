# 비토 게이트웨이 — 에이전트 코어 축 (GW-AGENT-CORE)

> 허브 = [FEATURE-BITO-GATEWAY.md](../FEATURE-BITO-GATEWAY.md) (§9 등재). 수정 시 허브 §2-1 작업 규율 적용.
> 이 문서가 Agent 런타임(폴러·저널·커서·결과 반영) 축을 소유한다. 최초 작성 = 2026-08-15 점검. **우리 MySQL SMSQ_SEND_13/14/15를 직접 읽고 쓰는 경계층이다.**

## 1. 정체성

고객사 DB(우리는 MySQL smsdb)의 pending 행을 점유(claim)해 게이트웨이로 보내고, REPORT를 받아 고객사 DB에 결과를 되쓰는 층. "발송됐는데 영원히 대기" 위험(허브 §8-10)의 현장.

## 2. 구조 (소스 실독)

**폴링·점유** (`poller/poller.go` 1,616줄)
- 상태 정책 2모드: ①기본 = 고객 DB status 컬럼으로 pending→claimed→sent 전이(원자 UPDATE로 점유 경합 차단) ②`final_result_only`/`external_journal` = 고객 DB를 중간 상태로 오염시키지 않고 **로컬 저널로만 점유 추적**(우리 SMSQ가 이 모드 계열)
- keyset 커서(`pendingScanCursor`)로 pending 유지 행이 신규 수집을 막지 않게 함 — 0803 커서 재설계 반영 확인
- claimed 고아 복구: `claimed_max_age` 초과 시 pending 롤백(recovery ticker, GW 연결과 무관하게 동작)
- GW 영구 거부(`PermanentSendAckError`)는 고객 DB 실패 처리, 그 외 전송 실패는 claimed 유지→복구 주기가 회수

**내구 저널** (`state_journal.go`)
- append-only + `file.Sync()`(fsync) + group commit 창 + 주기 compaction. 프로세스 재시작 시 active claim 복원으로 중복 pickup 차단
- **저널 경로가 상대면 child 강등 후 즉사** — 허브 §4-1의 뿌리. 경로는 반드시 절대

**결과 반영** (`HandleReport`, poller.go:524)
- UPDATE 성공(affected>0) → (필요시 카카오 failover) → 저널 clear → **그다음에야 ReportAck**. 실패 시 ACK 보류 → 커서 미전진 → 재연결 replay
- 결과 반영 실패는 `recordReportDBFailure`가 계수·로그(`reportDBFailures`) — 7월 hanjul01에서 2,502회 누적됐던 그 카운터

**gRPC 클라이언트** (`client/grpc_client.go` 1,767줄)
- 결과 커서는 **ReportAck 전송 성공 후에만 전진**(수신 순서 기반, 비연속 ID 지원 — 테스트로 보증). ACK 실패 = 세대(generation) 단위 재연결
- quiesce 스냅샷(진행 중 send/ack/report 계수)으로 종료 시 유실 없는 합류

## 3. 확정 사실·위험 (2026-08-15)

| # | 내용 | 위치 |
|---|---|---|
| 1 | **poison 결과 dead-letter 부재** — 고객 DB에서 영구 반영 불가한 결과(행 삭제·seq 불일치)는 ACK가 영원히 안 나가 재연결마다 무한 재전달. 다른 결과 처리는 안 막는다(워커 병렬·개별 ACK). 운영 증상 = reportDBFailures 누적 | `poller.go:555-559` | 
| 2 | 결과 반영 UPDATE의 테이블·컬럼명은 config 유래 문자열 조립(값은 바인딩) — config는 신뢰 경계 안이라 수용, 단 **config 검증이 방어선**(마법사·사전 질의서가 그 역할) | `poller.go:637` |
| 3 | `HandleReport`의 고객 DB 타임아웃 5초 고정(하드코딩) — 고객 DB가 느리면 일괄 실패→재전달 반복 가능. 실측 전 처방 금지 항목 | `poller.go:525` |
| 4 | 통계 스냅샷·상태 로그(`Poller 상태`)가 유일한 관측 창 — 허브 §8-2-1의 journalctl 확인 절차가 이것 | `poller.go:977` |

**견고 확인** — 점유 원자성(두 모드 모두) / 저널 fsync+복원 / ACK-커서-replay 계약(테스트 다수) / 종료 시 배처·저널 잔량 flush(`Close`) / 카카오 failover는 저널 clear·ACK **앞**에 배치(내구 처리의 일부).

## 4. 테스트 증거 (2026-08-15 로컬)

poller(14.2s)·client·config·db·dbutil·fieldmap·validator·quiesce·testpoll·doctor·onboarding 전부 PASS. 커서 전진·ACK 실패 미전진·비연속 ID 테스트 확인.

## 5. 착수 원장

1. [ ] **poison 결과 처리 설계**(§3-1) — 후보 축: 반영 불가 N회 초과 시 별도 원장(dead-letter 테이블 또는 저널 격리)+운영 알림, ACK는 사람 판정 후. **자동 성공 처리 금지**(결과 유실이 되므로). 허브 §8-10과 동일 항목, 설계는 Harold 승인 후
2. [ ] `reportDBFailures` 관측을 시스템 모니터에 편입 — 한줄로 측 싱크 실패 임계 알림(0814)과 같은 사상. 임계·창은 실데이터로
3. [ ] 고객 DB 타임아웃 config화(§3-3) — 실측 근거 확보 후
