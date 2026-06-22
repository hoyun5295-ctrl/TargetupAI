# 알림톡 정보알림 여정 분기 + 변수 매핑 품질 설계

- 작성일: 2026-06-22
- 작성: 비토 (CTO)
- 상태: Harold 승인 대기 (스펙 리뷰 단계)

## 1. 배경과 목적

한줄로 여정·자동마케팅에는 사용자가 알림톡을 넣을 진입점이 없다. 발송 토대(데이터 모델·발송 큐·공용 패널)는 D188/D189에 일부 깔려 있으나, 빠른시작·AI생성·자연어생성이 전부 `lms`만 만들어 `kakao` 스텝이 생기지 않는다.

알림톡은 광고성 발송이 불가하고 정보성(주문·배송·예약·결제·접수 통지)만 가능하다. 문자(광고성)와 출발점·메시지 작성·타이밍·법적 표기가 모두 달라, 한 빌더에 섞으면 사용자가 혼란스럽다. 따라서 **진입에서 목적을 분기**한다.

동시에 여정 전반의 **변수 매핑 품질**(소스 완전성·토글 미리보기·빈 값 안전)을 끌어올린다.

## 2. 현황 (코드 확인 결과)

### 2-1. 이미 동작하는 것
- 여정 트리거 8종 — `customer.created` / `cdp.purchase` / `cdp.cart_abandon` / `cdp.reservation_created` / `customer.dormant` / `customer.birthday_approaching` / `customer.points_expiring` / `custom` (journey-builder.ts). journey-trigger-watcher.ts 5분 cron polling.
- 알림톡 채널 모델 — `ChannelType='kakao'` + `alimtalkProfileId` / `alimtalkTemplateCode` / `alimtalkVariableMap` / `alimtalkNextType` / `alimtalkNextContents` / `alimtalkNextSubject` (D188 Phase 2-B-2).
- 알림톡 발송 — journey-executor.ts `channel='kakao'` 분기: 승인템플릿 조회 → `replaceAlimtalkVars` → `insertAlimtalkQueue` → 부달(L/B 대체).
- 공용 패널 — `AlimtalkChannelPanel`(발신프로필+승인템플릿+변수매핑+미리보기)을 직접발송 모달(AlimtalkSendModal, 풀스크린 D162-4)과 여정 검토화면이 공유.
- CDP 표준 이벤트 — `STANDARD_EVENT_NAMES` 12종(page_view / cart_add / cart_remove / cart_view / checkout_start / checkout_complete / purchase / wishlist_add / wishlist_remove / product_view / search / message_click) + `custom_*` (cdp-events.ts). `properties` JSONB 최대 10KB.
- `cdp_orders.status` — completed / paid / cancelled / refunded / pending / shipping (cdp-orders.ts).

### 2-2. 빠졌거나 한계
- 진입 UX — 사용자가 알림톡 스텝/여정을 만드는 흐름 없음. `kakao` 스텝이 이미 있을 때만 패널이 뜸.
- 알림톡 변수 = 고객 필드만 — `replaceAlimtalkVars(content, customer, variableMap)`가 `customer` 컬럼만 참조. 이벤트 데이터(주문번호·상품명) 못 채움.
- 빈 값 줄 삭제 — Liquid `{{ }}` 변수에 `default` 필터 없으면 값 누락 시 줄이 빔 (JourneyMessageEditModal 주석에서 인정).
- 토글 미리보기 — JourneyMessageEditModal에 `edit/preview` 토글 있으나 정적 `SAMPLE_CUSTOMERS` 1명 기준. 실제 매핑/실데이터 미반영.
- 변수 소스 불완전 — 변수 후보가 기본 필드(이름·등급·지역·포인트) 위주. CDP 이벤트·싱크에이전트 커스텀 필드 누락.
- 배송 트리거 없음 — 표준 이벤트에 shipping/delivered 없음. `cdp_orders.status`에 shipping 있으나 여정 트리거 미연결.

## 3. 설계 — 3대 축

### A. 진입 분기 (메뉴 추가 없음)

여정/자동화 만들기 진입에서 목적 1단계 선택:

| 갈래 | 성격 | 채널 | 출발 | 메시지 | 타이밍 |
|---|---|---|---|---|---|
| 마케팅 여정 | 광고성 | 문자/LMS/MMS | 고객 세그먼트 | AI 카피 + 혜택 | 전략적 지연 |
| 정보 알림 | 정보성 | 알림톡 | 거래 이벤트 | 카카오 승인 템플릿 | 사건 직후 |

- 빌더 화면만 분기. 여정 엔진·스텝 실행·통계·재진입·일시정지는 공유.
- "자유롭게 만들기"(마케팅 여정)는 기존 흐름 유지.

정보 알림 빌더 구성:
- 트리거 선택 — 거래 이벤트(주문완료 `cdp.purchase` / 예약 `cdp.reservation_created` / 장바구니 `cdp.cart_abandon` / 배송 `custom_order_shipped` [게이팅, §5]).
- 스텝 = 알림톡 — 승인 템플릿 선택(`AlimtalkChannelPanel` 재사용) + 변수 매핑 + 대기.
- 광고 표기/080 수신거부 비노출 (정보성이므로).

### B. 변수 매핑 품질 (전 채널 공통 — 문자·LMS·알림톡 모두)

1. **소스 완전화** — 변수 후보를 한 목록으로 모음: 고객 직접컬럼(standard-field-map) + 커스텀필드(`custom_1~15`) + CDP 이벤트 `properties` 키 + 싱크에이전트 필드. `enabled-fields` 확장.
2. **빈 값 안전** — 변수 매핑마다 대체값 입력란. 치환 시 자동 `default` 적용 → 값 누락 시 줄 유지 + 대체값. `default` 없는 `{{ }}` 변수는 저장 전 경고. 마케터가 `| default:`를 손으로 안 넣어도 됨.
3. **토글 미리보기** — 정적 샘플 1명 → 실제 매핑 기준 치환 결과. 채널별(문자/알림톡) 미리보기 일관.

### C. 스텝 가시성

세로 타임라인:
- 트리거 노드(상단) → 스텝 노드 → 사이 '○시간/일 대기' 커넥터.
- 각 노드: 번호 + 채널 배지 + 템플릿/요약. 선택 스텝 강조.
- 첫스텝-다음스텝 붙음 해소(간격·커넥터 명시).
- 기존 검토화면의 카드 나열을 타임라인으로 교체(마케팅 여정도 동일 적용).

## 4. 백엔드 변경점

- **이벤트 데이터 변수** — 이벤트 트리거로 진입한 execution에 트리거 이벤트 `properties` 보존. 알림톡 치환(`replaceAlimtalkVars`)과 Liquid 컨텍스트가 `customer` + `event` 병합 참조. 커서 경로(`processCdpCursorJourney`)에서 이벤트 row의 properties를 실행단계까지 전달.
- **빈 값 default** — 변수 매핑 대체값을 치환 함수에 전달. 알림톡/문자/Liquid 공통 적용.
- **변수 후보 API** — 회사별 활성 필드(고객+커스텀+이벤트+싱크) 통합 목록 endpoint.
- **미리보기** — 실제 매핑 기준 치환(backend 또는 frontend 미러).

신규 컬럼/테이블/JOIN이 필요하면 작성 직전 `information_schema` 검증(db_column_verify_before_code 룰). SCHEMA.md 추측 신뢰 금지.

## 5. 배송 트리거 게이팅 (Harold 명시 2026-06-22)

- 배송 등 자사몰 이벤트 의존 트리거는 **자사몰(CDP) 연동 활성 시에만 선택 가능**.
- 연동 미존재 → 선택지 비활성(disabled) + "자사몰 연동 시 사용 가능" 안내. (plan-guard 게이팅 패턴)
- 연동 판단 소스(provider 연결 테이블/플래그)는 구현 시 코드·information_schema로 확정(추측 금지).
- 전체 설계엔 배송 트리거를 포함하되, 1차 발동은 주문완료·예약·장바구니 기존 트리거로 시작.

## 6. 라우팅 축 영향 (전 경로 점검 — 개발 6원칙 #4)

채널/트리거/변수소스 축 변경이 닿는 경로:
- 생성(journey-builder) / AI생성(journey-ai-generator) / 실행(journey-executor) / 트리거(journey-trigger-watcher) / 스텝→캠페인(journey-step-campaign) / 통계(journey-stats) / 검토·편집 UI(JourneysPage, JourneyMessageEditModal) / 미리보기(liquid-templating, highlightVars).
- 각 경로의 변수 치환·채널 분기 일관성 점검 + grep 증거 첨부.

## 7. 범위 / 비범위

- 범위: 진입 분기, 정보알림 빌더, 변수 매핑 품질(전 채널), 스텝 타임라인, 이벤트 데이터 변수, 배송 트리거 게이팅(UI), 자동마케팅 정보알림 반영.
- 비범위(후속): 배송 `custom` 이벤트의 자사몰별 실제 연동 구현, 친구톡(광고성 카톡).

## 8. 검증 시나리오 (실측 1건 — 개발 6원칙 #5)

- 주문완료 → 알림톡 주문확인: `cdp.purchase` 발생 → execution 진입 → properties(order_no/product) 변수 치환 → 알림톡 큐 1건 → 부달 확인.
- 빈 값: 매핑 대체값 지정 후 값 누락 고객 → 줄 유지 + 대체값 치환.
- 게이팅: 자사몰 미연동 회사 → 배송 트리거 disabled + 안내.
- 변수 소스: 싱크에이전트 커스텀 필드가 변수 후보에 노출 + 치환.
