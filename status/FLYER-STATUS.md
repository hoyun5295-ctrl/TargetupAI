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

> **최종 업데이트:** 2026-04-15 (D122)

---

## 1) CURRENT_TASK (현재 집중 작업)

### 🎯 D129 — 인쇄전단 V2 재설계 (2026-04-17) — 🔨 진행중

**배경:** Harold님 "인쇄전단 울트라 허접" 피드백. 첨부 샘플 `TEST THE MARKET 봄세일의특가전` 수준 타겟 (이마트급 주간지 불필요, 동네마트 상업용 퀄리티).

**★ 결정사항 (2026-04-17 컨펌 완료):**
- 디자인 제작: **AI 활용 스피드 제작 (외주 X)**
- MVP: **A3 세로 1종(mart_spring_v1) 완벽 재현부터** — 추가는 그 다음
- 엔진: **Paged.js + Puppeteer** (기존 flyer-print-renderer.ts는 `legacy/`로 격리 예정)
- 이미지 AI: rembg 자체호스팅(기존) → 외부 API 폴백 (Phase 2)
- 엑셀: AI 자동분류 + 수동 보정 UI
- 테스트 매장: **가상 매장** (Harold님과 직접 생성)
- 폰트: **무료 상업용** — Pretendard / 지마켓산스 / 배민한나·주아체 / 야놀자야체 / 나눔스퀘어
- 규격: **1절/2절/4절/A3/B4/A4/8절/16절/타블로이드 전부 커버** (★ 2절 최우선 추가 — 현재 누락, 8절 272×394로 수정)

**★ 파일 구조 (신규 — `packages/backend/src/utils/flyer/product/print/`):**
```
print/
├── templates/
│   ├── mart_spring_v1/        ← 샘플1(봄세일) 1:1 재현
│   │   ├── manifest.json      ← 슬롯 정의
│   │   ├── template.html      ← Figma → HTML 이식
│   │   ├── template.css       ← @page CSS + 컴포넌트
│   │   └── preview.png
├── renderer/
│   ├── slot-filler.ts         ← 슬롯에 데이터 주입
│   ├── paged-pdf.ts           ← Paged.js + Puppeteer 통합
│   ├── asset-resolver.ts      ← SVG/이미지/폰트 경로 해석
│   └── template-registry.ts   ← 템플릿 로딩/캐시
├── pipeline/
│   ├── product-classifier.ts  ← flyer-category-classifier.ts 확장
│   ├── image-processor.ts     ← 배경제거+크롭+통일
│   └── layout-optimizer.ts    ← 상품수→슬롯 자동선택
├── assets/
│   ├── fonts/                 ← 무료 상업용 폰트 목록
│   ├── svg/                   ← 섹션 배너/배지/프레임
│   └── illustrations/         ← AI 생성 히어로 타이포
├── PAPER-SIZES.ts             ← 용지 9종 상수 (2절 포함)
├── design-tokens.json         ← 컬러/타이포/간격 토큰
└── SLOT-MANIFEST-SPEC.md      ← 슬롯 스펙 v1 문서
```

**★ Phase 로드맵:**
- **Phase 1 (진행중, 2~3주):** mart_spring_v1 재현 + 슬롯엔진 + Paged.js + 엑셀→슬롯 자동배치
- Phase 2 (3~4주): 템플릿 10~15종 + 이미지 AI + 브랜드킷(로고+컬러+폰트) + 프리뷰 갤러리
- Phase 3 (4~6주): AI 카피/레이아웃 자동선택 + 다중 페이지 분할 + 배치 렌더 큐
- Phase 4 (8주+): 모션 전단(MP4) + AI 레이아웃 생성 + A/B 테스트

**★ Step 1 체크리스트 (2026-04-17 본 세션):**
- [x] FLYER-STATUS.md D129 추가
- [ ] print/ 폴더 스켈레톤 (templates/renderer/pipeline/assets)
- [ ] PAPER-SIZES.ts (용지 9종, 2절 545×788 신규, 8절 272×394 수정)
- [ ] design-tokens.json v1 (샘플1에서 컬러/폰트/간격 추출)
- [ ] SLOT-MANIFEST-SPEC.md v1 (JSON 스키마 + 슬롯 타입 정의)
- [ ] mart_spring_v1/manifest.json 초안

**★ Harold님 지원 대기 (Phase 2 진입 시):**
- [ ] **Ideogram API 키** (한글 일러스트 타이포 양산)
- [ ] **remove.bg 또는 Removal.AI API 키** (rembg 품질 폴백)
- [ ] **Unsplash/Pexels 무료 키** (배경 이미지)
- [ ] rembg Docker **GPU/CPU 여부 확인**
- [ ] (선택) 친한 인쇄소 1곳 — Phase 3 실제 인쇄 검증용

**⚠️ 다음 세션 이어받기 가이드:**
1. 본 D129 섹션 먼저 읽기 → 결정사항/파일구조/체크리스트 확인
2. `SLOT-MANIFEST-SPEC.md` 읽고 슬롯 타입 이해
3. `design-tokens.json` + `PAPER-SIZES.ts`가 Lock 되어 있는지 확인
4. mart_spring_v1 템플릿이 manifest.json + template.html/css까지 있는지 확인
5. 없으면 Step 1 체크리스트 이어서 진행

---

### 🎯 D122 — 전단AI 대규모 업데이트 (2026-04-15) — ✅ 배포완료

**★ 이번 세션 완료 항목:**

**A. 인쇄전단 시스템 (신규)**
- [x] flyer-print-renderer.ts — HTML→PDF 렌더러. 한국 마트 규격(A3/B4/A4/8절/타블로이드) 5종 + 9가지 테마(봄/여름/가을/겨울/추석/설+기본3색)
- [x] PrintFlyerPage.tsx — 인쇄전단 에디터. 제목/기간/용지크기/템플릿 선택 → 카테고리별 상품 그리드 에디터 → 네이버 이미지 자동검색+직접업로드 → 300dpi PDF 생성
- [x] flyers.ts — 인쇄전단 CRUD 라우트 (생성/조회/수정/PDF다운로드)
- [x] 백엔드 컬럼 정리: created_by→user_id, store_address→business_address
- [x] PDF 다운로드 토큰 인증 수정
- [x] App.tsx 인쇄전단 메뉴 이동/개선

**B. 장바구니/주문 시스템 (신규)**
- [x] flyer-carts.ts (CT-F19) — phone 기반 장바구니 UPSERT, flyer_id+phone당 1개 유지
- [x] flyer-orders.ts (CT-F20) — 주문 생명주기 (pending→confirmed→ready→completed/cancelled), 공개API+인증API 분리, 일일 통계
- [x] carts.ts / orders.ts — 라우트 마운트
- [x] OrdersPage.tsx — 주문관리 대시보드 (요약카드 4개 + 상태탭 + 상태진행 버튼)

**C. POS 자동전단 생성 (신규)**
- [x] flyer-pos-auto.ts (CT-F22) — 5분 간격 미처리 할인건 감지 → 카탈로그 이미지 매칭 → 할인율 분류(메인30%↑/서브10%↑/일반) → auto_draft 자동 생성

**D. 수신자별 단축URL 추적 (신규)**
- [x] flyer-short-code.ts (CT-F18) — base62 5자리 코드(9억 조합), 배치 INSERT 5000단위, 90일 만료, 클릭통계(유니크phone/첫클릭/총클릭)

**E. 감사로그 (신규)**
- [x] flyer-audit-log.ts (CT-F23) — 13가지 액션 기록 (로그인/전단생성/발송/주문상태/설정 등), 비동기 처리
- [x] flyer-admin.ts — 슈퍼관리자 감사로그 조회/필터링 API
- [x] auth.ts — 로그인 시 감사로그 기록
- [x] FlyerAdminDashboard.tsx — 슈퍼관리자 UI에 감사로그 탭 추가

**F. 엑셀 AI 자동매핑 (신규)**
- [x] flyer-excel-mapper.ts (CT-F24) — 엑셀 헤더→상품필드 AI 매핑 (Claude주/GPT폴백). 할인율 기반 promoType 자동분류
- [x] ExcelUploadModal.tsx — 공용 3단계 모달 (업로드→매핑확인→미리보기). 매핑필드 select 변경 가능

**G. 배경제거 (신규)**
- [x] flyer-rembg.ts — rembg Docker 서비스 호출 (15초 타임아웃, 실패 시 원본 폴백)

**H. 전단 오류 수정 (3건)**
- [x] 전단생성 실패 오류 수정
- [x] 인쇄전단 렌더링/이벤트 핸들링 오류 수정
- [x] 인쇄전단 업데이트 로직 안정화

**I. 미완료 (다음 세션)**
- [ ] flyer_customers, flyer_catalog 테이블에 user_id 컬럼 추가 (ALTER TABLE)
- [ ] customers.ts, catalog.ts, address-books.ts, coupons.ts, stats.ts user_id 격리
- [ ] 투게더스 POS 데이터 샘플 수령 (Harold님 액션)
- [ ] 짧은 도메인 구매 hjl.kr (Harold님 액션)

---

### 🎯 D120 — user_id 격리 + 사업 확장 설계 (2026-04-14) — ✅ 배포완료

**★ 이번 세션 완료 항목:**

**A. user_id 기반 데이터 격리 (긴급)**
- [x] flyers.ts GET / — company_id만 필터 → user_id 추가 (같은 총판 내 매장별 전단 분리)
- [ ] **미완료 — 다음 세션:** customers.ts, catalog.ts, address-books.ts, coupons.ts, stats.ts 전체 user_id 격리 필요
- [ ] **미완료 — 다음 세션:** flyer_customers, flyer_catalog 테이블에 user_id 컬럼 추가 (ALTER TABLE)

**B. 사업 확장 회의 + 설계**
- [x] 회의록: `status/전단AI_회의록_20260414.docx`
- [x] 설계서: `status/FLYER-EXPANSION-DESIGN.md`
- 4단계 로드맵: 수신자별 단축URL → 인쇄용 전단 → 장바구니/주문 → POS 자동 생성
- 목표: 마트 2,000개+, 월 순수익 1.4억원

**C. 선결 과제 (Harold님 액션)**
- [ ] 투게더스 POS 데이터 샘플 3~4건 수령
- [ ] 투게더스 테스트 아이디 확보
- [ ] 짧은 도메인 구매 (hjl.kr 등)

---

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

### 🎯 D117 — 전단AI 대규모 업그레이드 + POS Agent 완성 (2026-04-13) ✅ 배포완료

**A. 전단AI 기능 보강 6건 (전부 완료, 배포됨)**
- [x] PDF 내보내기 — `flyer-pdf.ts` puppeteer 싱글톤, `flyers.ts` POST /:id/pdf
- [x] AI 마케팅 문구 — `flyer-ai-copy.ts` 4종(조리팁/효능/보관법/매력포인트), `catalog.ts` POST /generate-copy
- [x] 상품별 가격POP PDF — `flyer-pop-templates.ts` A4 1장 가격표 5색상, 매장명+이미지+뱃지+주소
- [x] 8엔진 21테마 — 신규 4엔진(Compact3열/HeroBanner/Swipe/Mosaic) + 시즌6/행사5/업종확장
- [x] 자동 카테고리 분류 — `flyer-category-classifier.ts` 키워드→카탈로그→AI 3단계
- [x] 다이나믹 전단 — 외부링크/공지사항/GIF배너 (extra_data JSONB)

**B. POS Agent 전면 개선 + exe 빌드 (완료)**
- [x] db-connector.ts — MSSQL+MySQL+SQLite 3종 + exponential backoff 재연결
- [x] schema-reader.ts — 3종 DB별 스키마 쿼리 + SQL Injection 제거
- [x] data-extractor.ts — 파라미터 바인딩으로 SQL Injection 제거
- [x] scheduler.ts — 재고 하드코딩 제거 + KST 자정 리셋 + 하트비트 연속실패 경고
- [x] setup-wizard.ts — CLI 인터랙티브 설치 마법사 (ANSI 색상 박스 UI, 5단계)
- [x] exe 빌드 완료 — `build/hanjul-pos-agent.exe` (97.7MB) + better_sqlite3.node

**C. 기타**
- [x] flyer-naver-search.ts — 검색어 정제 (단위/수량 제거)
- [x] ai.ts — callAIWithFallback export
- [x] BUGS.md B97-03 Closed

**서버 DDL (적용 완료):**
- `ALTER TABLE flyers ADD COLUMN extra_data JSONB DEFAULT '{}'`
- `ALTER TABLE spam_filter_tests ALTER COLUMN variant_id TYPE varchar(10)`
- 시스템 패키지: fonts-noto-cjk + puppeteer 의존 라이브러리

---

### 🎯 D118 — 전단AI 고도화 + 컨트롤타워 도메인 분리 + POP 독립 메뉴 (2026-04-13) ✅ 배포완료

**A. 신규 기능 12건 (전부 구현, 배포됨)**
- [x] 다분할 POP — renderMultiPop (2/4/8/16/21/35분할 동적 레이아웃)
- [x] 전단→POP 일괄 생성 — POST /:id/pop-all (8개 이하 다분할, 초과 시 페이지 분리)
- [x] 홍보POP (코너 안내판) — renderPromoPop 카테고리별 헤더+상품 리스트형
- [x] 전단→SMS 원클릭 — 발행 후 "SMS발송" 버튼 (SendPage 연결)
- [x] 드래그로 상품 순서 변경 — HTML5 DnD + 카테고리 간 이동
- [x] 상품 복사 (기존→새 전단) — POST /:id/copy + FlyerPage "복사" 버튼
- [x] 발송 후 데이터 자동 파기 — config/flyer-settings.ts (캠페인별+회사별)
- [x] AI 문구 배치 생성 — POST /generate-batch-copy + "AI 일괄문구" 버튼
- [x] POS 연동 대시보드 — FlyerAdminDashboard POS Agent 탭 (상태/싱크/하트비트)
- [x] POS→전단 자동 추천 — getTopSellingProducts + "POS추천" 버튼
- [x] QR 쿠폰 통계 대시보드 — getCouponDashboard + 7일 추이 바차트
- [x] 네이버 이미지 품질 개선 — 쇼핑API 병행검색 + noimage 필터

**B. 컨트롤타워 도메인 분리 (21개 파일 → 7개 도메인)**
- [x] send/ — 발송 도메인 (CT-F01~F08, 7파일)
- [x] product/ — 상품/전단 도메인 (CT-F11,F14,F17 + 보조, 7파일)
- [x] pos/ — POS 도메인 (CT-F12,F16, 2파일)
- [x] coupon/ — 쿠폰 도메인 (CT-F15, 1파일)
- [x] billing/ — 과금 도메인 (CT-F03, 1파일)
- [x] analytics/ — 분석 도메인 (CT-F09,F10, 2파일)
- [x] config/ — 설정 도메인 (CT-F13 + flyer-settings.ts, 2파일)
- [x] 라우트 인라인 query → CT 추출 (campaigns purge → config/, coupons dashboard → coupon/)

**C. POP 독립 메뉴 + 5종 템플릿 + 다양한 옵션**
- [x] PopPage.tsx — 독립 POP 제작 페이지 (전단제작 수준 UX)
- [x] POP 5종 디자인: HOT프라이스 / 클래식마트 / 심플화이트 / 다크프리미엄 / 대형가격
- [x] 용지 6종: A4 / A3 / A2 / A1 / A0 / 프라이스카드(90×55mm)
- [x] 분할 7종: 1장 / 2 / 4 / 8 / 16(4×4) / 21(7×3) / 35(7×5)
- [x] 가로/세로 방향 선택
- [x] 전단에서 상품 불러오기 (좌측 사이드바)
- [x] 직접 입력 + CSV 업로드
- [x] 이미지 업로드 / 네이버 검색 / 카탈로그 자동 매칭
- [x] 스타일 복사 / 일괄 변경 (뱃지/원산지/할인율)

**D. PDF 이미지 렌더링 수정**
- [x] puppeteer base64 인라인 변환 — 로컬 이미지를 data URL로 직접 삽입
- [x] 카탈로그/Pixabay 이미지 자동 매칭 (fillMissingImages + resolveProductImageUrl)
- [x] catalog-images / flyer-products / product-images 3개 경로 전부 지원

**E. 템플릿 버그 수정**
- [x] 미리보기 템플릿 변경 안 바뀌는 버그 — iframe → 실시간 렌더러로 교체
- [x] Magazine 엔진 이미지 높이 불안정 — min-height + align-self:stretch
- [x] Editorial 오버레이 z-index 누락 — z-index:2 추가

**F. POP 고도화 (세션 후반)**
- [x] POP 5종 디자인 시스템 — HOT프라이스/클래식마트/심플화이트/다크프리미엄/대형가격
- [x] 용지 사이즈 동적 CSS — A0~A4 + 프라이스카드(90×55mm), mm 단위 정확 계산
- [x] 분할 7종 (1/2/4/8/16/21/35) — SPLIT_LAYOUTS 동적 레이아웃 + 셀 mm 고정
- [x] 가로/세로 방향 — getPaperSize()에서 landscape swap + puppeteer+HTML 양쪽 반영
- [x] POP 이미지 크게 (A4 60%+) — 여백 최소화, 이미지 중심 레이아웃
- [x] 스타일 복사/일괄 변경 — 뱃지/원산지/할인율 일괄 적용

---

### 🎯 다음 세션 CURRENT_TASK (D119~)

**미완료 (이전 세션):**
- [ ] 상품 이미지 DB 구축 — 마트 주요 상품 500개 누끼 이미지 수집
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

## 5) 파일 구조 + 컨트롤타워 (D118 도메인 분리)

```
packages/backend/src/
├── middlewares/flyer-auth.ts, super-service-guard.ts
├── routes/flyer/ (auth, companies, customers, campaigns, unsubscribes, balance,
│                   stats, catalog, pos, address-books, sender-registration,
│                   flyers, short-urls, business-types, coupons)
├── routes/admin/ (switch-service, flyer-admin)
└── utils/flyer/
    ├── index.ts                    ← 도메인별 re-export (외부 import 경로 변경 없음)
    ├── send/                       ★ 발송 도메인
    │   ├── flyer-send.ts           (CT-F08) 오케스트레이터 (유일한 진입점)
    │   ├── flyer-sms-queue.ts      (CT-F01) SMS 큐
    │   ├── flyer-message.ts        (CT-F05) 메시지 치환 + 광고
    │   ├── flyer-customer-filter.ts(CT-F04) 고객 필터
    │   ├── flyer-callback-filter.ts(CT-F06) 회신번호
    │   ├── flyer-deduplicate.ts    (CT-F07) 중복제거
    │   └── flyer-unsubscribe-helper.ts (CT-F02) 수신거부
    ├── product/                    ★ 상품/전단 도메인
    │   ├── flyer-catalog.ts        (CT-F11) 카탈로그
    │   ├── flyer-templates.ts      (CT-F14) 템플릿 렌더링 (8엔진 21테마)
    │   ├── flyer-pop-templates.ts  POP 5종 (hot/classic/simple/dark/jumbo) + 분할 + 홍보
    │   ├── flyer-pdf.ts            PDF 생성 (A0~A4 + 프라이스카드 + base64 이미지 인라인)
    │   ├── flyer-ai-copy.ts        AI 문구 (단건+배치)
    │   ├── flyer-naver-search.ts   (CT-F17) 네이버 쇼핑+이미지 병행 검색
    │   └── flyer-category-classifier.ts 카테고리 자동 분류
    ├── pos/                        ★ POS 도메인
    │   ├── flyer-pos-ingest.ts     (CT-F12) 데이터 수신 + 인기상품 추천
    │   └── flyer-pos-ai.ts         (CT-F16) AI 스키마 분석
    ├── coupon/                     ★ 쿠폰 도메인
    │   └── flyer-coupons.ts        (CT-F15) QR 쿠폰 + 대시보드 통계
    ├── billing/                    ★ 과금 도메인
    │   └── flyer-billing.ts        (CT-F03) 차감/환불/잔액
    ├── analytics/                  ★ 분석 도메인
    │   ├── flyer-stats.ts          (CT-F09) 발송 통계
    │   └── flyer-rfm.ts            (CT-F10) RFM (Phase B)
    └── config/                     ★ 설정 도메인
        ├── flyer-business-types.ts (CT-F13) 업종 레지스트리
        └── flyer-settings.ts       자동 파기 설정

packages/flyer-frontend/src/pages/
├── LoginPage.tsx, FlyerPage.tsx, PopPage.tsx, SendPage.tsx, ResultsPage.tsx
├── BalancePage.tsx, UnsubscribesPage.tsx, SettingsPage.tsx
├── CustomerPage.tsx, CatalogPage.tsx, CouponPage.tsx

packages/frontend/src/pages/
└── FlyerAdminDashboard.tsx (슈퍼관리자 — 총판/매장 관리 + POS Agent 모니터링)
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
| ★ helmet() CSP가 인라인 스크립트 차단 | 공개 페이지처럼 인라인 `<script>` 필요한 라우트는 **helmet() 전에 마운트**. `app.use(helmet())` 아래에 두면 CSP `script-src 'self'`가 인라인 JS 차단 |
| ★ JS 안 될 때 콘솔 에러 먼저 확인 | 추측 수정 절대 금지. F12 콘솔 에러 또는 디버그 div 화면 표시로 JS 실행 여부부터 확인. D116에서 13번 배포한 교훈 |
| ★ body overflow-x:hidden이 sticky 깨뜨림 | overflow-x:hidden → CSS spec에 의해 body가 scroll container → position:sticky 무력화 + scroll 이벤트 미전파. **overflow-x:clip** 사용 |
| ★ 마지막 카테고리 탭 활성화 | 마지막 카테고리는 페이지 끝이라 threshold 미도달. `(innerHeight+pageYOffset)>=scrollHeight-50`이면 마지막 탭 활성화 |
