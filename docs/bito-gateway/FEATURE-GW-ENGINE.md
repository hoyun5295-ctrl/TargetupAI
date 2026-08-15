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
2. [ ] 본문 충돌 신호의 회귀 테스트 유무 확인(§3-2) — 없으면 1건 추가 제안
3. [ ] 빈 ACK 코드 = 성공 계약 명문화(§3-3) — 커넥터 신규 작성 가이드에
