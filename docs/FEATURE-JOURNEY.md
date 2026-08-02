# 여정(Journey) — 기능 상설 SoT

> **호출어: "여정"** — Harold님이 여정을 언급하면 이 문서를 먼저 연다.
> 이 문서는 **여정 기능의 현재 모습과 이력 색인**을 소유한다. 시점별 설계 근거·경위는 각 설계서가 소유하고 여기엔 링크만 둔다(doc_ownership).
> 상태·잔여는 STATUS §2 카드가 소유한다. 여기엔 **구조와 원칙**만 남긴다.

---

## 1) 여정이란 — 제품 정의

트리거가 발생한 **그 고객에게** 정해진 순서로 메시지를 보내는 자동화. 캠페인(한 번에 다수)과 다르다.
사용자는 마케팅 담당자다 — 직관 + 압도적 쉬움 + 완성 품질을 동시에 만족해야 한다.

---

## 2) 불변 원칙 (어길 수 없는 것)

| 원칙 | 뜻 | 어겼을 때 |
|---|---|---|
| **정답표를 갖지 않는다** | 무엇이 가능한지는 고객사가 준 데이터가 런타임에 정한다. 조건 하드코딩 금지, 없으면 정직하게 잠근다 | "켜 뒀는데 영원히 0건" — 이 재설계가 없애려는 병 자체 |
| **진실을 복사하지 않는다** | 같은 사실을 두 번째 테이블에 미러링하지 않는다. 원본을 읽는다 | 멱등키·대조워커·지표오염이 자동으로 따라온다 |
| **문은 회사마다 하나** | 같은 사실이 두 문(자사몰·싱크)으로 들어오면 한 문만 진실로 삼는다 | 같은 구매가 두 번 진입 = 중복 발송·중복 과금 |
| **커서를 DB 정밀도 밖으로 내보내지 않는다** | 커서 시각은 `::text` 원문으로 읽고 쓰고 비교한다 | µs 절사로 마지막 밀리초 묶음이 매 회차 재발송 |
| **게이트는 실제로 시작되는 길목에** | 발송이 시작되는 유일한 길목은 **활성화**다. 화면 잠금은 우회된다 | 자연어 생성·조회 실패로 게이트가 새고, 이미 활성인 여정은 아예 대상 밖 |
| **과거분 소급 금지** | 이관·전량 재적재가 과거 사실을 오늘 올려도 트리거로 인정하지 않는다(발생 시각 기준) | 3년 전 구매에 "구매 감사합니다"가 나간다 |
| **상한 없이 켜지지 않는다** | 전 트리거 수신자 상한 필수 | 대량 적재 한 번에 코호트 전체 발화 |
| **새 트리거 = 레지스트리 + DB CHECK 동시** | `TRIGGER_CONTRACTS`와 `journeys_trigger_event_registered`는 같은 집합 | 저장은 되는데 DB가 거부하거나 그 반대 |

---

## 3) 현재 구조 — 파일별 소유

| 층 | 파일 | 소유하는 것 |
|---|---|---|
| **계약** | `utils/journey-trigger-capability.ts` | 트리거 레지스트리(15종+상시) · 화면 개방 판정 · 상한 필수 판정 |
| **커서 규약** | `utils/journey-cdp-cursor.ts` | 도착 축 배치 계획 · 커서 전진 · 이벤트/원장 문 판정 |
| **추출** | `utils/journey-target-extractor.ts` | 트리거별 후보 SQL 단일 진입점(발송·미리보기 공용) |
| **진입** | `utils/journey-trigger-watcher.ts` | 5분 워커 · 두 문 순회 · 자격 필터 · 대량 차단 · 진입 트랜잭션 |
| **원장** | `utils/journey-entry-ledger.ts` | 진입 기억(baseline·entered) + 상태 기억(state) |
| **문 판정** | `utils/journey-purchase-ledger.ts` | 구매 원장 문 개방 · 실행 시간대 · 창 |
| **실행** | `utils/journey-executor.ts` | 스텝 발송 · 종료 신호 판정 · send-time |
| **생성·활성화** | `utils/journey-builder.ts` | 템플릿 · 저장 화이트리스트 · 활성화 게이트 · 기준선 |
| **안전** | `utils/journey-safety-filter.ts` · `journey-intake-grace.ts` | 발송 자격 필터 · 이관 유예 |
| **화면 카탈로그** | `frontend/utils/journey-trigger-catalog.ts` | 트리거 카드 · 이벤트 변수 호환 판정 |

**정합 가드** — `journey-trigger-catalog-parity.test.ts`가 카탈로그↔백엔드↔AI 추천 집합 일치를 고정한다. 어긋나면 화면엔 보이는데 0건이 된다.

---

## 4) 트리거 현황 (2026-08-02)

**가동 13종** — 신규가입 · 구매(재구매) · **첫 구매** · **휴면 복귀** · 휴면 · **구매 주기 이탈** · **등급 변동** · 생일 · 포인트 소멸 · 장바구니 이탈 · 배송 · **조회 후 미구매** · 상시(자유 세그먼트)
**잠금 3종(예약)** — 접수 · 방문 D-N · 방문 완료 후 N일 → 예약 원장(§12) + Harold 확인 2건 선행

정의 전문 = [여정 재설계 설계서 §3](2026-08-01-journey-redesign-design.md).

**구매는 문이 둘이다** — 자사몰(`cdp_events`) / 싱크에이전트(`purchases` 원장). 어느 문이든 같은 트리거가 물린다.
매장 구매는 **하루 모아 다음 날 오전(KST 09~12시)** 정책 — 고객사 동기화 주기가 우리 권한이 아니기 때문.
고객 공표 문구: "구매 여정을 쓰려면 그날 구매가 **밤 11시까지 한 번은 동기화**되어야 합니다."

---

## 5) DB 축 (실행완료)

| 대상 | 컬럼·제약 | 무엇을 위한 것 |
|---|---|---|
| `journeys` | `last_event_cursor`(+`_id`) | 자사몰 이벤트 도착 축 커서 |
| `journeys` | `last_purchase_cursor`(+`_id`) | 구매 원장 도착 축 커서 |
| `journeys` | CHECK `journeys_trigger_event_registered` | 트리거 16값 화이트리스트(레지스트리와 1:1) |
| `journey_entry_ledger` | `state_value` | 이전 상태 기억(등급 변동 판정) |
| `journey_anchor_dispatch` | PK(journey, step, customer, send_date) | 고객별 발송일 멱등 — §12 날짜축의 기반 |
| `cdp_events` | `(company_id, event_name, created_at, id)` | 도착 축 커서 조회 |
| `purchases` | `(company_id, created_at, id)` | 원장 커서 조회 |

상세 = [SCHEMA.md](../status/SCHEMA.md) 해당 절.

---

## 6) 이력 색인

| 시점 | 무엇 | 문서 |
|---|---|---|
| 2026-08-01~02 | **재설계** — 트리거 15종·데이터 게이트·커서 축 전환·연동 배선·트리거 재정의 | [설계서](2026-08-01-journey-redesign-design.md) — 착수 순서 §11 / 구현 결과 §11-A~§11-D-7 |
| 2026-07-28 | 트리거 8종 개방(정보 알림 빌더) | `memory/project_2026_0728_tickets_journey_triggers.md` |
| 2026-07-27 | 알림톡 대체문안 CT | `memory/project_2026_0727_journey_alimtalk_and_agent_tls.md` |
| 2026-06-30 | 여정 일반화(date_anchor·one_shot) | SCHEMA 여정 절 |

**남은 로드맵** — 착수 6번(예약 3종+고객별 날짜축+중단·재계산) = [설계서 §12](2026-08-01-journey-redesign-design.md) · 착수 7번(화면 흐름) = [설계서 §13](2026-08-01-journey-redesign-design.md) · 상품 결정 2(등급 방향 필터 · 자동 종료 기본화).

---

## 7) 착수 전 필독

1. 이 문서 §2(불변 원칙) — 여덟 줄이 전부 사고 기원이다.
2. [설계서](2026-08-01-journey-redesign-design.md)에서 그 조각의 §.
3. `status/lessons/LESSONS_BACKEND.md` 상단 — 커서·복사·게이트 3항.
4. 화면 작업이면 `status/lessons/LESSONS_FRONTEND.md` "디자인 최소 기준".
