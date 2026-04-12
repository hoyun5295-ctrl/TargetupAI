# 전단AI (한줄전단) — 프로젝트 운영 문서

> **목적:** 마트/정육점 등 소상공인 대상 전단지 SMS 마케팅 SaaS.
> **핵심:** (1) 진실의 원천(SoT) = 이 문서 (2) 컨트롤타워 우선 (3) 한줄로 기간계 무접촉

---

## 0) 문서 인덱스

> **전단AI 작업 시 이것만 참조 — 한줄로 STATUS.md/BUGS.md/SCHEMA.md 건드리지 않음.**

| 문서 | 용도 |
|------|------|
| **FLYER-STATUS.md** | 현재 작업 상태 + 구현 현황 (이 문서) |
| **FLYER-SCHEMA.md** | flyer_* 테이블 스키마 |
| **FLYER-BUGS.md** | 버그 트래커 |
| **FLYER-AI-DESIGN.md** | 초기 설계 + 컨셉 |
| **FLYER-MART-ROADMAP.md** | 마트 18개 기능 마스터 로드맵 (D112~) |
| **FLYER-MIGRATION-PLAN.md** | 계정/데이터 완전 분리 이관 계획 (방식 B) |
| **FLYER-POS-AGENT.md** | POS Agent (SyncAgent 확장) 설계 |
| **FLYER-SUPERADMIN.md** | 슈퍼관리자 통합 + 서비스 스위처 설계 |
| **FLYER-QR-COUPON-DESIGN.md** | ★ D114 QR 체크인 쿠폰 구현 설계서 (즉시 개발용) |
| **FLYER-POS-AGENT-DEV.md** | ★ D114 POS Agent 개발 설계서 (투게더스 우선, 즉시 개발용) |

> **최종 업데이트:** 2026-04-12 (D114)

---

## 1) CURRENT_TASK (현재 집중 작업)

### 🎯 D115 — QR 쿠폰 + AI POS Agent 구현 (2026-04-12)

**★ 이번 세션 완료 항목:**

**A. QR 체크인 쿠폰 (코드 완료, DDL 미적용)**
- [x] CT-F15 flyer-coupons.ts — 쿠폰 컨트롤타워 (캠페인 CRUD + QR 생성 + claim + redeem + 통계)
- [x] routes/flyer/coupons.ts — 인증 라우트 + 공개 라우트 (/q/:qrCode)
- [x] app.ts 마운트 (/api/flyer/coupons + /api/flyer/q)
- [x] CouponPage.tsx — 프론트 페이지 (목록/생성/사용처리/조회)
- [x] App.tsx — '쿠폰' 메뉴 추가
- [ ] **Harold님 실행 필요:** DDL (flyer_coupon_campaigns + flyer_coupons 2개 테이블)
- [ ] flyer_coupon_campaigns에 qr_data_url TEXT 컬럼 추가 필요

**B. AI POS Agent (서버 + 클라이언트 코드 완료)**
- [x] CT-F16 flyer-pos-ai.ts — AI 스키마 자동 분석 (Claude API)
- [x] CT-F12 flyer-pos-ingest.ts — 스켈레톤 → 실제 구현 (sales/members/inventory UPSERT)
- [x] routes/flyer/pos.ts — register + analyze-schema + config + push + heartbeat
- [x] packages/pos-agent/ — 신규 패키지 (7개 모듈: config/logger/server-client/db-connector/schema-reader/data-extractor/scheduler)
- [ ] **Harold님 실행 필요:** flyer_pos_agents에 `schema_mapping JSONB` 컬럼 ALTER
- [ ] **Harold님 실행 필요:** pos-agent npm install (tedious/better-sqlite3/node-cron/node-fetch)
- [ ] 실매장 테스트 (투게더스 POS 원격 접속 후)

**C. 이전 세션(D114) 완료 확인된 항목:**
- [x] 슈퍼관리자 UI 개선 (총판 생성/수정 모달, 매장 등록, 중복방지 등)

**D. 추가 완료 (이번 세션 후반):**
- [x] 전단 템플릿 QR 슬롯 — flyer-templates.ts `FlyerRenderData.qrCodeDataUrl` + 모든 템플릿 `</body>` 앞 QR 자동 삽입
- [x] FlyerPage 쿠폰 토글 — 발행 버튼 → 모달(쿠폰 ON/OFF) → 할인유형/금액/만료일 설정 → 발행+쿠폰 동시 생성
- [x] short-urls.ts — 전단에 연결된 쿠폰 자동 감지 → 공개 페이지 하단에 QR 이미지 삽입
- [x] 헤더 정리 — 메인 4개(전단제작/발송/쿠폰/결과) + 더보기 드롭다운(고객DB/상품관리/충전관리/수신거부/설정)
- [x] 좌측 상단 총판명 → 매장명(user.storeName) 변경
- [x] FLYER-SCHEMA.md — flyer_coupon_campaigns + flyer_coupons + schema_mapping 문서화
- [x] 과금 흐름 검증 — 3중 차단 확인 (미들웨어+canFlyerStoreSend+deductFlyerPrepaid)

**E. 카탈로그 + 네이버 이미지 자동 매칭 (이번 세션 추가):**
- [x] CT-F17 flyer-naver-search.ts — 네이버 이미지 검색 API 연동 (쇼핑→이미지 전환: 주류/담배도 검색 가능)
- [x] catalog.ts — search-image / select-image / auto-match / batch-match / find-image 5개 API 추가
- [x] CatalogPage.tsx — CSV 일괄등록 + 개별 이미지 검색(후보 5개) + 이미지 선택 저장
- [x] FlyerPage — 상품명 입력→blur 시 서버 우선 매칭→없으면 네이버 이미지 후보 5개 팝업→사장님 선택
- [x] FlyerPage — "카탈로그에서" 버튼 (카탈로그 상품 클릭→전단에 자동 추가)
- [x] app.ts — catalog-images express.static 공개 서빙
- [x] 이미지 서빙 경로: `/api/flyer/catalog-images/{companyId}/{filename}`

---

### 🎯 다음 세션 CURRENT_TASK (D116~)

> **아래 4개 영역을 다음 세션에서 순서대로 착수한다.**

**0. 전단 템플릿 대폭 리뉴얼 — 템플리 수준 이상 (최우선)**
- [ ] 템플리 스타일 **1열 리스트형 레이아웃** 신규 추가 — 좌측(가격+텍스트) + 우측(큰 이미지)
- [ ] 가격 **압도적 대형화** (21,900 수준, 화면의 주인공)
- [ ] 상품 상세 필드 추가: **규격**(6kg/통, 500ml), **원산지**(국내산), **카드할인**(농협/삼성)
- [ ] FlyerRenderData에 `unit`(규격), `origin`(원산지), `cardDiscount`(카드할인) 필드 추가
- [ ] FlyerRenderItem 확장 → FlyerPage 상품 입력 UI에 규격/원산지 입력란 추가
- [ ] 히어로 배너 디자인 고도화 — 꽃잎/별/패턴 장식 + "봄이 한 가득!" 같은 시즌 감성
- [ ] 전단 프론트 미리보기(FlyerPreviewRenderer)도 동기화 업데이트
- [ ] 상품 이미지 DB 구축 시작 — 마트 주요 상품 500개 누끼 이미지 수집 (Pixabay+직접촬영)
- [ ] 참고: 템플리 스크린샷 `C:\Users\ceo\Downloads\` 에 있음

**1. 카탈로그DB 관리 페이지 + 전단 연동 (Phase A 핵심)**
- [ ] flyer-frontend CatalogPage.tsx 고도화 — 상품 추가/편집/삭제 + 이미지 업로드
- [ ] FlyerPage.tsx에 "내 상품" 사이드바 → 카탈로그에서 상품 선택 → 전단 카테고리에 자동 추가
- [ ] 이전 전단에서 사용한 상품 → flyer_catalog 자동 등록 (발행 시점에 upsertCatalogItem 호출)
- [ ] 상품 이미지 Pixabay 추가 수집 or DALL-E 생성 옵션 연동
- [ ] 카탈로그 카테고리별 필터/검색 UI 개선

**2. POS Agent exe 빌드 + 시스템 트레이 + 설치 마법사**
- [ ] packages/pos-agent/ npm install (tedious/better-sqlite3/node-cron/node-fetch)
- [ ] `tray.ts` — Windows 시스템 트레이 UI (systray2). 아이콘+상태표시+설정열기
- [ ] `setup/wizard.ts` — CLI 초기 설정 마법사 (agent_key 입력 → DB 감지 → 연결 테스트 → 저장)
- [ ] `setup/db-detector.ts` — POS 설치 폴더 스캔 + 프로세스 확인 + 포트 스캔
- [ ] `pkg` 빌드 → `hanjul-pos-agent.exe` 단일 실행파일 생성
- [ ] Windows 자동 시작 등록 (레지스트리 HKCU\Run)
- [ ] 슈퍼관리자 FlyerAdminDashboard에 POS Agent 모니터링 탭 추가 (상태/마지막싱크/대기건수)
- [ ] **Harold님 선행:** 투게더스 POS 매장 1곳 원격 접속(팀뷰어) → DB 엔진/테이블 구조/전화번호 마스킹 확인

**3. 인쇄 PDF 내보내기**
- [ ] 전단지 HTML → PDF 변환 (puppeteer 또는 html-pdf-node)
- [ ] A4/전단지 사이즈 옵션 (210x297mm, 190x260mm)
- [ ] FlyerPage에 "PDF 다운로드" 버튼 추가
- [ ] 인쇄용 고해상도 이미지 처리 (300dpi)
- [ ] QR 쿠폰이 있는 전단은 PDF에도 QR 포함

**4. 카카오 브랜드메시지 연동**
- [ ] 한줄로 CT-12 brand-message.ts 패턴 참조 → 전단AI 전용 래퍼 구현
- [ ] flyer_campaigns.send_channel에 'kakao_brand' 옵션 추가
- [ ] SendPage.tsx에 발송 채널 선택 (SMS/카카오) UI
- [ ] 카카오 사업자 인증 + 템플릿 등록 (Harold님 사업자 연동 필요)
- [ ] 발송 비용: 카카오 브랜드메시지 단가 CT-F03에 추가

---

## 1-1) Harold님 장기 비전 (D115 메모)

> **최종 목표: 동네 상권 통합 마켓플레이스 (마트판 쿠팡이츠)**
>
> 배민X토마토POS = 소비자가 A마트 1곳에서만 주문 → 배달.
> Harold님 구상 = 소비자가 A마트 삼겹살 + B마트 대파 + C정육점 한우 → **통합 장바구니 → 한번에 배달**.
> 각 매장의 강점 상품만 골라 담을 수 있어 소비자 압도적 유리. 토마토POS는 자기 가맹점끼리만 가능 → 우리는 POS 무관하게 크로스 매장 주문.
>
> **3단계 플라이휠:**
> 1. **전단AI SaaS (지금)** — 매장 확보 + 신뢰 구축 + 월 15만원 구독
> 2. **POS Agent (구현 중)** — 상품/가격/재고 실시간 수집 → 데이터 자산 확보
> 3. **소비자 앱 (미래)** — 동네 마트 통합 장바구니 + 배달 → 플랫폼 수수료 모델
>
> POS 연동이 되어 있으니 재고/가격이 실시간. 지금 하는 POS Agent + 카탈로그 + QR 쿠폰 = 전부 3단계를 위한 인프라.
>
> **토마토POS 참고:** 4,000개 매장, 클라우드(AWS), 배민 장보기 연동 완료. 자체 문자 발송하므로 제휴 가능성 낮음. 전단 서비스는 안 하는 것으로 보임.

---

## 2) 핵심 정책 (D113 확정)

### 2-1. 과금
- **매장당 월 15만원 + 문자 100% 선불. 후불 없음.**
- 총판 수수료(5만원)는 우리 관여 X — 총판이 알아서 정산
- 슈퍼관리자가 입금 확인 → payment_status='active' + plan_expires_at 설정
- 잔액 충전도 슈퍼관리자가 수동 처리

### 2-2. 권한
- **슈퍼관리자만** 총판/매장 생성·관리. 총판은 사용량 모니터링만.
- 매장 로그인 → 업종에 맞는 템플릿/카테고리만 노출

### 2-3. 업종
- **마트/정육** 2개로 시작. DB(flyer_business_types) 기반 확장 가능.
- 매장(flyer_users) 생성 시 업종 선택 필수

### 2-4. 구조 원칙
- **한줄로와 같은 구조, 성격만 다름.** companies=총판, users=매장(사장님)
- 한줄로 기간계 무접촉. flyer_* 테이블만 사용.
- 컨트롤타워(utils/flyer/) 먼저 → 라우트 → 프론트 순서

---

## 3) DECISION LOG

- **ADR-20260409-01:** 업종 마트/정육 2개로 시작, DB 기반 확장 → 채택
- **ADR-20260409-02:** flyer_users 확장 방식 (flyer_companies=총판, flyer_users=매장 유지) → 채택
- **ADR-20260409-03:** 100% 선불제 (월정액+문자 모두), 후불 없음 → 채택
- **ADR-20260409-04:** 슈퍼관리자만 계정 생성, 총판은 모니터링만 → 채택
- **ADR-20260409-05:** flyers/short_urls FK를 flyer_companies/flyer_users로 변경 → 적용 완료

---

## 4) 기술 스택

| 영역 | 기술 | 비고 |
|------|------|------|
| Frontend | React + TypeScript + Tailwind | packages/flyer-frontend/ |
| Backend | Node.js + Express + TypeScript | packages/backend/src/routes/flyer/ |
| DB (메인) | PostgreSQL 15 (Docker) | flyer_* 테이블 완전 분리 |
| DB (발송) | MySQL (QTmsg) | 한줄로와 공유 (라인그룹 기반 테이블 분리) |
| 인증 | JWT (service='flyer' 강제) | 한줄로 토큰 교차 사용 차단 |
| 도메인 | hanjul-flyer.kr (서비스), hanjul-flyer.com | |
| 배포 | PM2 + Nginx | tp-deploy-full + flyer-frontend 별도 빌드 |

---

## 5) 파일 구조 + 컨트롤타워

```
packages/backend/src/
├── middlewares/flyer-auth.ts, super-service-guard.ts
├── routes/flyer/ (auth, companies, customers, campaigns, unsubscribes, balance,
│                   stats, catalog, pos, address-books, sender-registration,
│                   flyers, short-urls, business-types)
├── routes/admin/ (switch-service, flyer-admin)
└── utils/flyer/ (CT-F01~F14 + index.ts)
    ├── flyer-sms-queue.ts         (CT-F01) SMS 큐
    ├── flyer-unsubscribe-helper.ts(CT-F02) 수신거부
    ├── flyer-billing.ts           (CT-F03) 과금 — canFlyerStoreSend + deductFlyerPrepaid + refundFlyerPrepaid
    ├── flyer-customer-filter.ts   (CT-F04) 고객 필터
    ├── flyer-message.ts           (CT-F05) 메시지 치환 + 광고
    ├── flyer-callback-filter.ts   (CT-F06) 회신번호
    ├── flyer-deduplicate.ts       (CT-F07) 중복제거
    ├── flyer-send.ts              (CT-F08) ★ 발송 오케스트레이터 (유일한 진입점)
    ├── flyer-stats.ts             (CT-F09) 통계
    ├── flyer-rfm.ts               (CT-F10) RFM (Phase B 스켈레톤)
    ├── flyer-catalog.ts           (CT-F11) 카탈로그
    ├── flyer-pos-ingest.ts        (CT-F12) POS Agent (Phase B 스켈레톤)
    ├── flyer-business-types.ts    (CT-F13) ★ D113 업종 레지스트리 + TEMPLATE_REGISTRY
    ├── flyer-templates.ts         (CT-F14) ★ D113 템플릿 렌더링 엔진 (10종)
    ├── flyer-coupons.ts           (CT-F15) ★ D115 QR 쿠폰 (캠페인 CRUD + claim + redeem + QR 생성)
    ├── flyer-pos-ai.ts            (CT-F16) ★ D115 POS AI 스키마 분석 (Claude API 자동 매핑)
    └── index.ts

packages/pos-agent/src/              ← ★ D115 신규 패키지
├── index.ts                         — 메인 엔트리 (등록→DB연결→AI분석→스케줄러)
├── config.ts                        — 설정 관리 (agent-config.json)
├── logger.ts                        — 파일 로깅
├── server-client.ts                 — 서버 통신 (register/analyze/push/heartbeat)
├── db-connector.ts                  — MS-SQL 접속 (tedious)
├── schema-reader.ts                 — INFORMATION_SCHEMA 읽기 + 샘플 수집
├── data-extractor.ts                — AI 매핑 기반 데이터 추출
└── scheduler.ts                     — 주기적 작업 (node-cron)

packages/flyer-frontend/src/pages/
├── LoginPage.tsx, FlyerPage.tsx, SendPage.tsx, ResultsPage.tsx
├── BalancePage.tsx, UnsubscribesPage.tsx, SettingsPage.tsx, CustomerPage.tsx

packages/frontend/src/pages/
└── FlyerAdminDashboard.tsx (슈퍼관리자 — 총판/매장 관리)
```

---

## 6) 구현 현황 총괄

### Phase 0 — 인프라/격리 ✅ (D112, 2026-04-09)
- [x] flyer_* 12개 테이블 + 인덱스 + 슈퍼관리자 컬럼
- [x] CT-F01~F12 컨트롤타워 12개
- [x] routes/flyer/ 11개 라우트 + routes/admin/ 2개
- [x] flyer-frontend 8개 페이지 API /api/flyer/* 교체
- [x] 슈퍼관리자 ServiceSwitcher + FlyerAdminDashboard

### Phase A-1 — 업종+과금+템플릿 ✅ (D113, 2026-04-09)
- [x] CT-F13 업종 레지스트리 (마트/정육 + DB 기반 확장)
- [x] CT-F14 템플릿 렌더링 엔진 (기존 3종 + 신규 7종 = 10종)
- [x] CT-F03 매장별 100% 선불 과금 (canFlyerStoreSend + deductFlyerPrepaid)
- [x] JWT businessType + 매장별 과금 미들웨어
- [x] FlyerPage 업종별 동적 템플릿/카테고리
- [x] 프론트 미리보기 10종 구현
- [x] 슈퍼관리자 매장 CRUD + 입금확인/충전 (커스텀 모달)
- [x] DB FK 정리 (flyers, short_urls → flyer_companies 참조)
- [x] flyer_business_types 테이블 + flyer_users ~20컬럼 ALTER 완료

### 프론트엔드 페이지 현황 (D115)
```
packages/flyer-frontend/src/pages/
├── LoginPage.tsx, FlyerPage.tsx, SendPage.tsx, ResultsPage.tsx
├── BalancePage.tsx, UnsubscribesPage.tsx, SettingsPage.tsx
├── CustomerPage.tsx, CatalogPage.tsx
└── CouponPage.tsx          ← ★ D115 신규 (QR 쿠폰)
```

### 이전 Phase (MVP~2.5) ✅
- Phase 1 (2026-03-29): DB + 백엔드 API + 공개페이지 3종 + 도메인
- Phase 1.5 (2026-03-29): 프론트 8페이지
- Phase 2 (2026-03-30~04-01): 상품 이미지 + 템플릿 개선 + Pixabay
- Phase 2.5 (2026-04-01): 세션관리 + MMS + 중복제거 + 080 + 만료처리

### Phase A-2 — QR 쿠폰 + AI POS Agent (D115, 2026-04-12)
- [x] CT-F15 QR 쿠폰 컨트롤타워 (생성/수령/사용/통계/공개페이지)
- [x] CT-F16 AI 스키마 분석 (Claude API → POS DB 자동 매핑)
- [x] CT-F12 실제 구현 (sales/members/inventory UPSERT + 카탈로그 자동등록)
- [x] routes/flyer/coupons.ts + routes/flyer/pos.ts 확장
- [x] CouponPage.tsx + App.tsx 메뉴 (flyer-frontend)
- [x] packages/pos-agent/ 신규 패키지 (MS-SQL 접속 + AI 분석 + 주기적 동기화)
- [ ] DDL 미적용 (배포 전 Harold님 실행 필요)
- [ ] 전단 템플릿 QR 슬롯
- [ ] FlyerPage.tsx 쿠폰 토글 연동
- [ ] POS Agent exe 빌드 + tray UI

### 미착수 (Phase A 나머지)
- 카탈로그DB 관리 페이지 + 전단 연동
- 인쇄 PDF 내보내기
- 카카오 브랜드메시지 배포
- 주간/월간 정기 자동발행
- A/B 테스트
- 매장 직원 간편 모드

---

## 7) 템플릿 10종 (D113)

| 코드 | 이름 | 컨셉 | 업종 | 색상 |
|------|------|------|------|------|
| grid | 가격 강조형 | 빨간 테마, 2열 카드 | 공통 | #dc2626 |
| list | 리스트형 | 딥블루, 깔끔 모던 | 공통 | #2563eb |
| highlight | 특가 하이라이트 | 다크+골드, TOP PICK | 공통 | #d4a844 |
| mart_fresh | 신선식품 특화 | 녹색 테마, 농산물 강조 | 마트 | #16a34a |
| mart_weekend | 주말특가 | 보라+핑크, BEST DEAL 배너 | 마트 | #9333ea |
| mart_seasonal | 시즌 행사 | 파랑+시안, 명절/절기 | 마트 | #2563eb |
| mart_clearance | 창고대방출 | 노랑+빨강, 가격 최우선 | 마트 | #eab308 |
| butcher_premium | 프리미엄 정육 | 다크+골드, 한우 특화 | 정육 | #c9a84c |
| butcher_daily | 오늘의 고기 | 빨강, 일일특가 | 정육 | #dc2626 |
| butcher_bulk | 대용량 팩 | 네이비, 중량/절약액 강조 | 정육 | #1e3a8a |

---

## 8) 배포

```bash
# 로컬에서 push
tp-push "커밋 메시지"

# 서버 접속
ssh administrator@58.227.193.62

# 배포 (백엔드 + 한줄로 프론트)
tp-deploy-full

# 전단AI 프론트엔드 빌드 (tp-deploy-full에 미포함)
cd /home/administrator/targetup-app/packages/flyer-frontend && npm run build

# DB 접속
docker exec -it targetup-postgres psql -U targetup targetup
```

---

## 9) 버그 트래커

| ID | 심각도 | 상태 | 내용 |
|----|--------|------|------|
| FL-B01~B06 | - | ✅ 전부 수정 | 이미지 서빙/인증/URL 디코딩 등 (D100 이전) |
| FL-B07 | 🔴 | ✅ | company_admin 403 (D100) |
| FL-B08 | 🟠 | ✅ | 세션 전부 무효화 → 동시 세션 5개 허용 (D100) |
| FL-B09 | 🔴 | ✅ | DATE UTC 밀림 → TO_CHAR (D101) |
| FL-B10 | 🟠 | ✅ | 080 키 불일치 (D101) |
| FL-B11 | 🟠 | ✅ | product-images Content-Type (D101) |
| FL-B12 | 🔴 | ✅ | flyers/short_urls FK가 한줄로 companies 참조 → flyer_companies로 교체 (D113) |
| FL-B13 | 🟠 | ✅ | flyer_users.email NOT NULL + stores INSERT에 email 누락 (D113) |

---

## 10) 교훈 (전단AI 전용)

| 교훈 | 대책 |
|------|------|
| Express 라우트 순서 | 고정 경로를 /:id 앞에 배치 |
| authenticate 범위 | 공개 엔드포인트는 authenticate 위에 배치 |
| DATE UTC 밀림 | TO_CHAR로 YYYY-MM-DD 문자열 반환 |
| 한줄로 데이터 격리 | 전단AI 전용 엔드포인트 + 별도 저장경로 완전 분리 |
| 프론트 미리보기 동기화 | 공개 페이지와 프론트 미리보기 양쪽 동시 수정 |
| API 응답 키 불일치 | API 반환 키와 프론트 접근 키를 양쪽 확인 |
| flyer_users.email NOT NULL | INSERT 시 email 컬럼 빈 문자열('') 필수 |
| FK가 한줄로 테이블 참조 | D112 이관 시 flyers/short_urls FK 교체 누락 → D113에서 발견. 이관 시 **모든 FK 대상 테이블** 전수 확인 필수 |
| tsc --noEmit ≠ tsc -b | 프론트 빌드는 `tsc -b` 사용. `--noEmit`으로만 체크하면 빌드 에러 놓침 |
| window.prompt/confirm 사용 금지 | 모든 확인/입력 대화상자는 커스텀 모달 컴포넌트 사용 |
