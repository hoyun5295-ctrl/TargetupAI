# 한줄전단(전단AI) 현재 기능 정의

> **작성일:** 2026-05-12
> **기준:** main 브랜치 코드 정독 (packages/backend + packages/flyer-frontend + packages/pos-agent + packages/frontend FlyerAdminDashboard)
> **목적:** 한줄전단 보강 기획안 작성을 위한 「현재 현실」 정확 파악
> **상태:** 정식 운영 중 (D112 시작, D118 도메인 분리, D129 인쇄전단 V2)

---

## 1. 한 줄 정의

매장(마트·정육·과일·축산·식자재 등) 대표가 **POS 데이터를 자동 수집**하여 **AI 전단지·POP·인쇄 전단**을 만들고 **SMS·LMS·MMS·카카오로 발송**하며 **QR 쿠폰**으로 재방문을 유도하는 통합 매장 마케팅 자동화 SaaS.

---

## 2. 패키지 구조 (5 패키지)

| 패키지 | 역할 | 비고 |
|--------|------|------|
| `backend` | 통합 백엔드 (한줄로 + 전단AI 공존) | flyer 도메인 = `routes/flyer/*` + `utils/flyer/*` |
| `flyer-frontend` | 매장 사장님 사용 SPA | React 19 + Vite 8 + Tailwind 4 |
| `frontend` | 한줄로 메인 + **전단AI 슈퍼관리자**(FlyerAdminDashboard.tsx) | 같은 패키지 안에 슈퍼관리자만 존재 |
| `pos-agent` | 매장 POS DB 자동 수집 에이전트 | Windows .exe (pkg 빌드), MSSQL/MySQL/Firebird 지원 |
| `company-frontend` | 고객사 별도 프론트 | 전단AI 무관 (한줄로 도메인) |

### 2-1. 빌드·배포 아키텍처

- **공통 백엔드 단일 빌드** — `packages/backend` 하나에 한줄로 + 전단AI 도메인이 함께 빌드되어 단일 Node 프로세스로 실행
- **프론트엔드 3개 분리 빌드** — `frontend`(한줄로 + 슈퍼관리자), `flyer-frontend`(매장), `company-frontend`(고객사)
- **POS Agent 별도** — Windows .exe 단독 배포 (매장에 설치, 서버 API와 HTTP 통신)
- **atomic safe-build** 무중단 배포 체계 공통 적용

---

## 3. 사용자 유형 · 권한

| 사용자 유형 | 진입 경로 | 권한 | 인증 |
|------------|---------|------|------|
| **슈퍼관리자** | sys.hanjullo.com (frontend 패키지) | 전단AI 회사·매장·통계 전체 관리 | `/api/admin/flyer/*` (관리자 토큰) |
| **총판**(distributor) | flyer-frontend 로그인 | 매장 여러 개 통합 관리 (있다면) | `flyer_token` + `flyerAuthenticate` |
| **매장**(store) | flyer-frontend 로그인 | 자기 매장만 사용 (company_id 단위 격리) | `flyer_token` + `flyerAuthenticate` (세션 30분) |
| **고객(쇼퍼)** | hanjul-flyer.kr/{code} | 단축 URL로 전단지 열람, QR 쿠폰 받기 | 비로그인 공개 |

### 3-1. 인증·세션 분리

- **토큰 키**: 전단AI = `flyer_token` (한줄로 메인 = `token`) → localStorage 분리
- **세션 만료**: 30분 자동 로그아웃 (`useSessionTimeout` 훅)
- **회사 단위 격리**: D112부터 `store_code` 제거 → `company_id`만으로 격리 (전단AI는 회사 = 1매장 또는 1총판 구조)

---

## 4. 핵심 화면 (flyer-frontend SPA — 12개 페이지)

### 4-1. 메인 메뉴 (7개)

| # | 페이지 | 파일 | 핵심 기능 |
|---|--------|------|----------|
| 1 | **전단제작** | `FlyerPage.tsx` | AI 전단지 생성, 21종 템플릿, 카테고리/상품 입력, 이미지 자동 매칭 |
| 2 | **POP제작** | `PopPage.tsx` | 가격 POP, 멀티 POP, 프로모 POP 3종 렌더링 |
| 3 | **인쇄전단** | `PrintFlyerPage.tsx` | D129 V2 — 2절(A3) PDF 렌더, 페이징, 인쇄 전용 레이아웃 |
| 4 | **발송** | `SendPage.tsx` | SMS/LMS/MMS/카카오 발송, 고객 필터링, 중복제거 |
| 5 | **쿠폰** | `CouponPage.tsx` | QR 쿠폰 발급, 사용 추적, 휴대폰 조회 |
| 6 | **주문** | `OrdersPage.tsx` | 장바구니 → 주문 (전단지에서 쇼퍼가 담은 주문) |
| 7 | **결과** | `ResultsPage.tsx` | 발송 결과 (성공/실패/대기), 단축 URL 클릭 추적 |

### 4-2. 더보기 메뉴 (5개)

| # | 페이지 | 파일 | 핵심 기능 |
|---|--------|------|----------|
| 8 | **고객DB** | `CustomerPage.tsx` | 고객 등록·관리, 엑셀 업로드, 그룹(주소록), 수신동의 |
| 9 | **상품관리** | `CatalogPage.tsx` | 상품 카탈로그 (재사용 이미지·가격), 네이버 쇼핑 이미지 검색·자동 매칭 |
| 10 | **충전관리** | `BalancePage.tsx` | 선불 잔액 충전, 차감 이력, PG 결제·무통장입금 |
| 11 | **수신거부** | `UnsubscribesPage.tsx` | 080 수신거부 자동 등록·관리 |
| 12 | **설정** | `SettingsPage.tsx` | 매장 정보, 발신번호 등록, 업종 선택 |

---

## 5. 백엔드 라우트 (17개 + admin 1개)

### 5-1. 일반 라우트 (`/api/flyer/*`)

| # | 라우트 | 파일 | 마운트 경로 | 기능 요약 |
|---|--------|------|------------|----------|
| 1 | auth | `auth.ts` | `/api/flyer/auth` | 로그인·로그아웃·토큰 발급 |
| 2 | companies | `companies.ts` | `/api/flyer/companies` | 매장(회사) 정보 CRUD |
| 3 | customers | `customers.ts` | `/api/flyer/customers` | 고객 DB CRUD, 엑셀 업로드 |
| 4 | campaigns | `campaigns.ts` | `/api/flyer/campaigns` | 발송 캠페인 CRUD, 예약 발송 |
| 5 | unsubscribes | `unsubscribes.ts` | `/api/flyer/unsubscribes` | 수신거부 등록·해제 |
| 6 | balance | `balance.ts` | `/api/flyer/balance` | 선불 잔액 조회·충전·차감 이력 |
| 7 | stats | `stats.ts` | `/api/flyer/stats` | 대시보드 통계·캠페인 결과 |
| 8 | catalog | `catalog.ts` | `/api/flyer/catalog` | 상품 카탈로그 CRUD |
| 9 | address-books | `address-books.ts` | `/api/flyer/address-books` | 고객 그룹 (주소록) |
| 10 | sender-registration | `sender-registration.ts` | `/api/flyer/companies/sender-registration` | 발신번호 등록 절차 |
| 11 | pos | `pos.ts` | `/api/flyer/pos` | POS Agent 데이터 수신, 스키마 분석, 매핑 저장 |
| 12 | business-types | `business-types.ts` | `/api/flyer/business-types` | 업종 목록, 템플릿 메타 |
| 13 | coupons | `coupons.ts` | `/api/flyer/coupons` | QR 쿠폰 캠페인 CRUD, 발급, 회수 |
| 14 | (coupons public) | `coupons.ts publicRouter` | `/api/flyer/q` | 쿠폰 페이지 공개 조회 (인증 불필요) |
| 15 | carts | `carts.ts` | `/api/flyer/cart` | 장바구니 (공개 — 쇼퍼 사용) |
| 16 | orders | `orders.ts` | `/api/flyer/orders` | 주문 CRUD |
| 17 | flyers | `flyers.ts` | `/api/flyer/flyers` | 전단지 CRUD, PDF 생성, POP 렌더, 카테고리 분류 AI |
| 18 | short-urls (public) | `short-urls.ts` | `/api/flyer/p` | 단축 URL 리졸버, 전단지 렌더 (helmet 전 마운트) |

### 5-2. 관리자 라우트

| 라우트 | 파일 | 마운트 경로 | 기능 |
|--------|------|------------|------|
| flyer-admin | `routes/admin/flyer-admin.ts` | `/api/admin/flyer` | 슈퍼관리자용 — 총판·매장 통합 관리, 전체 통계 |

---

## 6. 컨트롤타워(CT-F) 17개 — 도메인 분리 구조 (D118 정립)

### 6-1. send/ (발송 도메인)

| CT | 함수 | 역할 |
|----|------|------|
| **CT-F01** | `flyer-sms-queue` | QTmsg SMS 큐 INSERT, 11개 라인그룹 분배, msg_type 매핑 |
| **CT-F02** | `flyer-unsubscribe-helper` | 080 수신거부 필터링·등록 |
| **CT-F04** | `flyer-customer-filter` | 고객 동적 필터 (성별·연령·구매빈도 등) |
| **CT-F05** | `flyer-message` | 메시지 변수 치환 + 광고 메시지 build |
| **CT-F06** | `flyer-callback-filter` | 회신번호(발신번호) 결정 |
| **CT-F07** | `flyer-deduplicate` | 수신자 중복제거 |
| **CT-F08** | `flyer-send` | **발송 오케스트레이터** (외부 진입점, F01~F07 호출) |

### 6-2. billing/ (과금 도메인)

| CT | 함수 | 역할 |
|----|------|------|
| **CT-F03** | `flyer-billing` | 월별 사용량 집계, 선불 차감·환불, 발송 가능 여부 체크 |

### 6-3. product/ (상품·전단 도메인)

| CT | 함수 | 역할 |
|----|------|------|
| **CT-F11** | `flyer-catalog` | 카탈로그 CRUD, 사용 빈도(usage_count) 추적 |
| **CT-F14** | `flyer-templates` | 21종 템플릿 렌더링 엔진 (HTML/CSS 출력) |
| **CT-F17** | `flyer-naver-search` | 네이버 쇼핑 API 이미지 검색, 자동 다운로드·매칭 |

추가 product 보조 (CT 번호 미부여):
- `flyer-ai-copy` — AI 마케팅 문구 4종 자동 생성 (조리법·효능·보관법·구매포인트)
- `flyer-category-classifier` — 상품명 → 카테고리 AI 자동 분류
- `flyer-pdf` — HTML → PDF 변환
- `flyer-print-renderer` — 인쇄용 전단 렌더링 (V1)
- `flyer-pop-templates` — POP 3종 렌더링
- `flyer-rembg` — 배경 제거 (이미지 처리)
- `flyer-excel-mapper` — 엑셀 헤더 자동 매핑

D129 신규: `utils/flyer/product/print/renderer/paged-pdf` + `template-registry` + `pipeline/image-pipeline`

### 6-4. pos/ (POS 도메인)

| CT | 함수 | 역할 |
|----|------|------|
| **CT-F12** | `flyer-pos-ingest` | POS Agent 데이터 수신 (회원·판매·재고·프로모션), Top 판매 상품 |
| **CT-F16** | `flyer-pos-ai` | **POS DB 스키마 → Claude 자동 분석 → 테이블·컬럼 매핑 자동 생성** |

추가: `flyer-pos-auto` — 자동 동기화 워커 (`startAutoFlyerWorker`, app 시작 시 기동)

### 6-5. coupon/ (쿠폰 도메인)

| CT | 함수 | 역할 |
|----|------|------|
| **CT-F15** | `flyer-coupons` | QR 쿠폰 캠페인 CRUD, 발급(claim), 사용(redeem), 휴대폰 조회, QR 생성 |

### 6-6. analytics/ (분석 도메인)

| CT | 함수 | 역할 |
|----|------|------|
| **CT-F09** | `flyer-stats` | 대시보드 통계, 캠페인 결과 집계 |
| **CT-F10** | `flyer-rfm` | **RFM 자동 세분화 (champion/loyal/new/at_risk/lost/whale)** — **★ Phase B 스켈레톤** |

### 6-7. config/ (설정 도메인)

| CT | 함수 | 역할 |
|----|------|------|
| **CT-F13** | `flyer-business-types` | 업종 레지스트리 (DB INSERT만으로 업종 확장), TEMPLATE_REGISTRY 21종 |

### 6-8. order/ + audit/ (보조)

- `flyer-carts` — 장바구니
- `flyer-orders` — 주문
- `flyer-audit-log` — 감사 로그
- `flyer-short-code` — 단축 URL 코드 생성
- `flyer-settings` — 설정

---

## 7. 템플릿 21종 (TEMPLATE_REGISTRY)

### 7-1. 기본 (5종)
- **grid** — 가격 강조형 (2열 카드)
- **magazine** — 매거진형 (1열 좌우교대, 대형 이미지)
- **editorial** — 에디토리얼 (첫상품 풀블리드 + 2열)
- **showcase** — 쇼케이스 (대형 싱글 카드, 절약액)
- **highlight** — 특가 하이라이트 (다크+옐로)

### 7-2. 시즌 (5종)
- season_newyear, season_chuseok, season_summer, season_winter, season_christmas

### 7-3. 행사 (4종)
- event_bogo (1+1/2+1), event_timesale, event_membership, event_grand_open

### 7-4. 마트 확장 (4종)
- mart_fresh (신선식품), mart_clearance (창고대방출), mart_general (공산품), mart_seafood (수산)

### 7-5. 정육 확장 (3종)
- butcher_premium, butcher_hanwoo, butcher_giftset

---

## 8. 데이터 모델 (PostgreSQL — `flyer_*` 테이블)

### 8-1. 확인된 테이블 (SCHEMA.md + 코드 grep)

| 테이블 | 용도 |
|--------|------|
| `flyers` | 전단지 메인 (title, period, categories jsonb, template) |
| `short_urls` | 단축 URL (code, flyer_id, expires_at 기본 90일, 도메인 `hanjul-flyer.kr/{code}`) |
| `url_clicks` | 단축 URL 클릭 로그 (ip, user_agent, clicked_at) |
| `flyer_catalog` | 상품 카탈로그 (product_name, image_url, usage_count 사용 빈도) |
| `flyer_business_types` | 업종 레지스트리 (type_code, category_presets, default_template) |
| `flyer_customers` | 고객 DB (rfm_segment 컬럼 존재) |
| `flyer_pos_sales` | POS 판매 데이터 (POS Agent로 수집) |
| `flyer_pos_members` | POS 회원 데이터 |
| `flyer_companies` | 회사(매장) |
| `flyer_users` | 매장 사용자 (사장님 계정) |
| `flyer_campaigns` | 발송 캠페인 |
| `flyer_unsubscribes` | 수신거부 080 |
| `flyer_coupons` | 쿠폰 발급·사용 이력 |
| `flyer_carts` | 장바구니 (쇼퍼 익명) |
| `flyer_orders` | 주문 |

### 8-2. 공유 자원 (한줄로 메인과 동일 인스턴스)

- PostgreSQL: 같은 DB 인스턴스, 테이블만 분리 (`flyer_*` prefix)
- MySQL (QTmsg): `SMSQ_SEND_1~11` 라인그룹 분배 → 한줄로와 동일 인프라 공유
- `balance_transactions`, `billing_invoices`, `payments` 등 정산·결제는 한줄로 메인 테이블 재활용 (company_id 단위)

---

## 9. 외부 연동

| 연동 대상 | 용도 | 위치 |
|---------|------|------|
| **POS Agent** (자체 .exe) | 매장 POS DB → 서버 자동 수집 | `pos-agent/` + `flyer-pos-ingest.ts` |
| **Claude API** | POS 스키마 자동 분석, AI 카피 4종, 카테고리 분류 | `services/ai.ts` 재활용 |
| **OpenAI GPT** | Claude fallback | `callAIWithFallback` |
| **네이버 쇼핑 API** | 상품 이미지 자동 검색·매칭 | `flyer-naver-search.ts` |
| **Pixabay** | 기본 상품 이미지 (이름 매핑) | `product-images PRODUCT_MAP` |
| **QTmsg** (MySQL) | SMS/LMS/MMS 발송 | `SMSQ_SEND_1~11` |
| **카카오 IMC** | 알림톡·브랜드메시지 발송 | 한줄로 인프라 재활용 |
| **MSSQL / MySQL / Firebird** | POS DB 연결 | pos-agent에서 `tedious`, `mysql2`, sqlite |
| **TossPayments** | PG 결제 | `payments` 테이블 |

---

## 10. 한줄로 메인과의 분리·공유 영역

### 10-1. 완전 분리

| 영역 | 한줄로 메인 | 전단AI |
|------|------------|--------|
| 도메인 | hanjul.ai | (별도 도메인 필요 — 추정) + hanjul-flyer.kr (단축 URL) |
| 토큰 키 | `token` | `flyer_token` |
| 인증 미들웨어 | `authenticate` | `flyerAuthenticate` |
| 라우트 prefix | `/api/*` | `/api/flyer/*` |
| DB 테이블 prefix | 없음 (`campaigns` 등) | `flyer_*` |
| MMS 이미지 경로 | `uploads/mms/` | `uploads/flyer-mms/` |
| 상품 이미지 경로 | `uploads/product-images/` | `uploads/flyer-products/` |
| 세션 만료 | (메인 정책) | 30분 자동 로그아웃 |
| 프론트 패키지 | `frontend` | `flyer-frontend` (별도) |
| 슈퍼관리자 UI | `AdminDashboard` | `FlyerAdminDashboard` (frontend 패키지 안) |
| 컨트롤타워 | CT-01~CT-18 (`utils/`) | CT-F01~CT-F17 (`utils/flyer/`) |

### 10-2. 공유

- **백엔드 단일 빌드** — packages/backend 하나의 Node 프로세스
- **PostgreSQL 인스턴스** — 같은 DB, 다른 테이블
- **QTmsg MySQL** — 같은 SMS 발송 인프라 (SMSQ_SEND_1~11)
- **카카오 IMC** — 같은 계정·인증
- **AI 서비스** — `services/ai.ts callAIWithFallback` 동일 함수 사용
- **결제·정산** — `billing_invoices`, `payments`, `balance_transactions` 메인 테이블 재활용
- **atomic safe-build** — 동일 배포 안전망

### 10-3. 분리 원칙 (코드 코멘트 기반)

- `★ 전단AI 라우트는 이 CT를 통해야 한다. 인라인 로직 금지.` (utils/flyer/index.ts)
- `★ 한줄로 코드(utils/ 루트) 절대 건드리지 않음.` (utils/flyer/index.ts)
- `★ D112: store-scope 제거(전단AI는 회사 단위).` (flyers.ts)

---

## 11. 미구현·Phase B 영역 (★ 핵심 갭)

### 11-1. 확인된 미구현/스켈레톤

| 영역 | 상태 | 위치 |
|------|------|------|
| **CT-F10 RFM 자동 세분화** | 스켈레톤만, Phase B 미구현 | `analytics/flyer-rfm.ts` (인터페이스만 존재) |
| **POS 판매 기반 ROI 집계** | Phase B 미구현 | `analytics/flyer-stats.ts` |
| **쿠폰 스캔 카운트 (url_clicks 연동)** | TODO | `coupon/flyer-coupons.ts:364` |
| **POS Agent → 사장님 알림 SMS/카카오** | Phase 4 확장 | `pos/flyer-pos-auto.ts:184` |
| **flyer-catalog** | 스켈레톤, Phase A 구현 시 채움 | `product/flyer-catalog.ts:7` |
| **개별 회신번호** | Phase B 이후 (현재 단일 기본값 사용) | `send/flyer-callback-filter.ts:7` |

### 11-2. 추정 갭 (코드에서 발견 못 한 영역)

- **자동 세분화 마케팅** — RFM 미구현이므로 「휴면 고객 자동 발송」 등 자동화 마케팅 시나리오 미적용
- **POS 매출 데이터 기반 자동 전단지 제안** — flyer_pos_sales는 수집되지만 이를 활용한 전단지 자동 추천은 미확인
- **모바일 앱** — flyer-frontend는 웹 SPA만, 네이티브 앱 없음
- **POS Agent 양방향 통신** — 서버 → POS 명령 전송 (예: 가격표 자동 변경) 미확인
- **다국어** — 한국어 전용 (i18n 미적용)

---

## 12. D-시리즈 진화 히스토리

| D 시점 | 변경 |
|--------|------|
| **D112** | 전단AI 슈퍼관리자 대시보드(FlyerAdminDashboard) 신설, flyerAuthenticate 도입, store-scope 제거 |
| **D114** | 커스텀 토스트 적용, 템플릿 color hex 변환 (Tailwind purge 우회) |
| **D118** | CT-F 도메인별 분리 구조 정립 (send/product/pos/coupon/billing/analytics/config) |
| **D129** | 인쇄전단 V2 신설 (2절 A3, Line B 신규 렌더러, 템플릿 레지스트리, 이미지 파이프라인) |
| **D145** | nginx SPA cache 정책 영구 박음 (frontend 공통, hanjul-flyer도 적용 가능 권고) |
| **D146~D152** | **전단AI 직접 작업 0건 — 5~6일 방치 기간 확인** |

---

## 13. 알려진 한계·페인포인트 (코드 기반 추정)

1. **RFM 세분화 미가동** — 고객 자동 분류·맞춤 마케팅 부재 (Phase B 미구현)
2. **POS 매출 데이터 활용도 낮음** — 수집은 하지만 인사이트·자동 추천 부족
3. **모바일 앱 부재** — 매장 사장님이 데스크탑·태블릿 브라우저만 사용
4. **자동 마케팅 시나리오 부재** — 휴면 고객 자동 발송, 생일 쿠폰 자동 발송 등 미구현
5. **AI 카피 4종은 단발 호출** — 캠페인 단위 일괄 생성·관리 UI 미확인
6. **다국어·다업종 확장 한계** — 현재 마트·정육 중심, 카페·음식점·미용실 등 확장 미확인
7. **D146~D152 방치** — 약 5~6일간 메인 D-시리즈에서 전단AI 작업 0건 (한줄로 메인·알림톡 후속에 집중)

---

## 14. 잠재 강점 (보강 기획 시 활용)

1. **POS AI 스키마 분석(CT-F16)** — 코드 수정 없이 모든 POS 대응 가능한 매우 혁신적 기능 (경쟁사 차별점 가능)
2. **21종 템플릿 + 업종 레지스트리(CT-F13)** — DB INSERT만으로 업종·템플릿 확장
3. **단축 URL + 클릭 추적** — 전단지 → 쇼퍼 클릭 → 장바구니 → 주문까지 폐회로 추적 가능
4. **QR 쿠폰 폐회로** — 발급·사용·휴대폰 조회까지 일관 처리
5. **한줄로AI 메인 인프라 재활용** — QTmsg SMS, 카카오 IMC, atomic safe-build 등 검증된 인프라
6. **컨트롤타워 17개 표준화** — 「인라인 로직 금지」 원칙으로 코드 품질·확장성 확보

---

## 15. 보강 기획 핵심 질문 (다음 단계 — 03_planning_questions.md로 발전)

1. **타깃 세그먼트** — 마트 / 정육 / 식자재 / 과일·수산 중 우선 공략 업종은?
2. **차별화 영역** — Phase B 미구현 영역(RFM·자동 마케팅) 우선 구현인가, 신규 기능(모바일 앱·AI 추천) 우선인가?
3. **템플리 벤치마크** — 01_market_research_master_prompt.md 결과 받은 후 어느 영역을 따라잡고 어느 영역을 추월할지?
4. **모바일 앱 필요성** — 매장 사장님이 책상에서 작업하는 시간 vs 모바일 사용 시간 데이터 확보 후 결정
5. **POS 매출 → 자동 전단지 추천** — Top 판매 상품·재고 임박 상품 자동 추천 UI 추가 가치
6. **고객 자동 마케팅** — RFM 구현 + 휴면 자동 발송 + 생일 자동 쿠폰 시나리오

---

## 부록 A. 백엔드 라우트 → 프론트엔드 화면 매핑

| 라우트 | 화면 (flyer-frontend) |
|--------|---------------------|
| `auth` | LoginPage |
| `flyers` | FlyerPage |
| (flyer-pop-templates 호출) | PopPage |
| (flyer-print-renderer 호출) | PrintFlyerPage |
| `campaigns` + `customers` + `unsubscribes` + `sender-registration` | SendPage |
| `coupons` | CouponPage |
| `orders` + `carts` | OrdersPage |
| `stats` | ResultsPage |
| `customers` + `address-books` | CustomerPage |
| `catalog` | CatalogPage |
| `balance` + `payments` (메인 재활용) | BalancePage |
| `unsubscribes` | UnsubscribesPage |
| `companies` + `business-types` | SettingsPage |
| `pos` | (SettingsPage 일부 + 슈퍼관리자) |

---

## 부록 B. 파일 통계

- **백엔드 flyer 파일**: 라우트 18개 + util 30+개 = **48개+**
- **flyer-frontend 페이지**: 12개
- **flyer-frontend 컴포넌트**: 7개 (AlertModal, ScheduleModal, DragDropUpload, SessionTimer, SessionTimeoutModal, ExcelUploadModal, ui)
- **pos-agent 모듈**: 9개 (config, db-connector, schema-reader, data-extractor, setup-wizard, server-client, scheduler, logger, index)
- **컨트롤타워(CT-F)**: 17개 (그중 1개 미구현: CT-F10)

---

> **이 문서는 코드 정독 기반 사실 정리이며, 보강 기획안 작성 시 「현재 현실」의 단일 진실 원천(Single Source of Truth)으로 사용한다.**
> **업데이트 필요 시점:** flyer 도메인 코드 변경 시 / Phase B 구현 시 / 신규 기능 추가 시
