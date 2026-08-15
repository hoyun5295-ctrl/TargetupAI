# 비토 게이트웨이 — 커넥터·라우팅 축 (GW-CONNECTOR-ROUTING)

> 허브 = [FEATURE-BITO-GATEWAY.md](../FEATURE-BITO-GATEWAY.md) (§9 등재). 수정 시 허브 §2-1 작업 규율 적용.
> 이 문서가 커넥터(중계사 연결)·라우팅·TPS·회선 건강 축을 소유한다. 최초 작성 = 2026-08-15 점검(비토 직접 실행).

## 1. 정체성

메시지가 어느 회선(bind_account)으로 나갈지 정하고(라우터), 그 회선과 실제 통신하는(커넥터) 층. 브랜드메시지 트랙에서 확정한 "중계 3대 중 .57만 F 지원" 문제의 게이트웨이 측 절반이 여기다.

## 2. 구조 (소스 실독)

**커넥터 계약** (`internal/gateway/connector/`)
- `Connector` 인터페이스 + **`SendWriteState` 4상태**(Unknown/NotWritten/Accepted/Rejected) — 커넥터가 provider write 경계를 반드시 선언해야 하고, 엔진의 재시도·격리 판단(엔진 축 문서 §3)이 전적으로 이 선언에 의존한다
- `ParseMsgTypeName`은 미지 타입 fail-fast(SMS 폴백 금지 — 과금 축 §4-7의 SQL 폴백과 대조적으로 여기는 올바름)
- `ReportDispatcher` — provider 읽기 루프와 DB 콜백을 분리하는 bounded·ordered 큐. **durable 콜백 성공 후에만 provider ACK** 전송
- 구현 3종: `humuson_imc`(카카오 계열 전용, 요청-응답 직렬화 뮤텍스) · `gemtek`(SMS 계열, EUC-KR, 규격 타이밍 전부 config — "ADR-18 하드코딩 금지" 준수 확인) · `gemtek_rcs`(테스트 0개 — 유일)

**라우터** (`engine/router.go`)
- 우선순위 4단: `agent_route_map` → `sender_route_map` → `customer_route_map` → legacy 1:1(`agent_account→route_config`)
- route_bind_group 내 priority tier — **같은 tier 전원 시도 후에만 다음 tier(대기라인)**. tier 안은 TPS 여유 기반 least-load
- 캐시 TTL 5초(관리 화면 변경 전파 상한 명시). 발송 직전 `AcquireCandidate`가 live 자격(`bindEligibleForNewTraffic` = 커넥터 ACTIVE + circuit 상태) + TPS 토큰을 원자 확보

**TPS** (`tps/`) — 3계층: Bind(중계사 한도, BIND_ACK 동적 갱신 콜백 — TOCTOU 방지 주석 실재) / Agent(고객사 초당) / Daily(일 한도, request 단위 1회 차감). 전부 Redis, **장애 시 fail-closed 재큐잉**

**회선 서킷브레이커** (`engine/bind_health.go`) — bind별 연속 실패 3회 → OPEN 30초 → HALF_OPEN probe(동시 1개) → 성공 2회 복귀. 명시 거절(`SendRejected`/`SendNotWritten`)은 `OpenNow`로 즉시 차단 후 안전 재라우팅

## 3. 확정 사실·위험 (2026-08-15)

| # | 내용 | 위치 | 비고 |
|---|---|---|---|
| 1 | **능력(capability) 축이 라우팅에 없다** — 후보 자격 = 카테고리 일치·활성·TPS·circuit뿐. "이 bind가 브랜드F를 나를 수 있는가"는 판단 안 함. provider 수준 정적 검사(`ProviderSupportsMsgType`)는 sender가 하지만 그때는 이미 bind가 선택된 뒤라 BAD_PROV 종결됨(재라우팅 아님) | `router.go:82-91` · `sender.go:471` | 허브 §8-13 능력 기반 라우팅의 소스 근거. 한줄로 측 `brand-message.ts:618·743`과 짝 |
| 2 | humuson 커넥터는 **한 세션 직렬 전송**(sendMu) — IMC 프로토콜 특성. TPS 상한과 별개로 커넥터 자체가 왕복 1건씩 | `humuson_imc/connector.go:280` | 구조 관찰, 처방 아님 |
| 3 | `gemtek_rcs` 패키지만 테스트 0개 | `connector/gemtek_rcs/` | 위생 |
| 4 | 발신번호 허용 캐시 전역 뮤텍스(엔진 축과 공유 관찰) — 허브 §7-1 관찰 ① | `sender.go:1177` | 미측정 |

**견고 확인** — write 경계 계약이 커넥터→엔진→DB(message_attempt)까지 일관 / 서킷 HALF_OPEN probe 반환 누수 방지(`defer ReleaseProbe`) / gemtek 규격 타이밍 전부 config / 동적 TPS는 콜백 단일 writer 원칙.

## 4. 테스트 증거 (2026-08-15 로컬)

`connector`·`gemtek`(+crypto·packet)·`humuson_imc`·`mock`·`tps`·`engine`(router_test·bind_health_test 포함) 전부 PASS. `gemtek_rcs`는 테스트 없음.

## 5. 착수 원장

1. [ ] **능력 기반 라우팅**(§3-1) — bind에 능력(msg_type 지원 집합)을 선언하고 라우터 후보 필터에 편입. 브랜드메시지 F 운영의 전제. 착수 전 자비스 협의 + 한줄로 측 결함과 한 축으로
2. [ ] gemtek_rcs 테스트 신설(§3-3) — RCS 실사용 전 필수
3. [ ] 능력 선언 스키마 결정 시 §4-2(버전 핀)의 교훈 적용 — 버전 문자열이 아니라 능력 축으로
