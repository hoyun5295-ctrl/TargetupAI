# 전단AI (한줄전단) — 프로젝트 운영 문서

> **문서 인덱스 (전단AI 작업 시 이것만 참조 — 한줄로 문서 건드리지 않음):**
> - `FLYER-STATUS.md` — 현재 작업 상태 + 구현 현황 (이 문서)
> - `FLYER-AI-DESIGN.md` — 초기 설계 + 컨셉
> - `FLYER-BUGS.md` — 버그 트래커
> - `FLYER-SCHEMA.md` — flyer_* 테이블 스키마
> - `FLYER-MART-ROADMAP.md` — 마트 18개 기능 마스터 로드맵 (D112~)
> - `FLYER-MIGRATION-PLAN.md` — 계정/데이터 완전 분리 이관 계획 (방식 B)
> - `FLYER-POS-AGENT.md` — POS Agent (SyncAgent 확장) 설계
> - `FLYER-SUPERADMIN.md` — 슈퍼관리자 통합 + 서비스 스위처 설계
>
> **최종 업데이트:** 2026-04-09 (D112)

---

## 1) CURRENT_TASK (현재 집중 작업)

### ✅ D112 — 마트 대확장 Phase 0 완료 (2026-04-09)

> **Phase 0 — 인프라/격리/설계 전체 완료.**
>
> **완료 항목:**
> - [x] 설계 문서 6종 (FLYER-SCHEMA/MART-ROADMAP/MIGRATION-PLAN/POS-AGENT/SUPERADMIN/BUGS)
> - [x] flyer_* 12개 테이블 서버 DDL 실행 + 인덱스 + 슈퍼관리자 컬럼
> - [x] 마트테스트 회사 이관 완료 (flyer_companies 1건)
> - [x] CT-F01~F12 전단AI 전용 컨트롤타워 12개 + index.ts
> - [x] middlewares/flyer-auth.ts + super-service-guard.ts
> - [x] routes/flyer/ 11개 라우트 (auth/companies/customers/campaigns/unsubscribes/balance/stats/catalog/pos/address-books/sender-registration)
> - [x] routes/admin/ 2개 (switch-service/flyer-admin)
> - [x] routes/flyer/flyers.ts 수정 (flyerAuthenticate 전환 + store-scope 제거)
> - [x] app.ts 마운트 전체 완료
> - [x] flyer-frontend 8개 페이지 API 엔드포인트 /api/flyer/* 교체 (한줄로 API 잔존 0건)
> - [x] 슈퍼관리자 ServiceSwitcher + FlyerAdminDashboard (한줄로 레이아웃 통일 + 주황 강조)
> - [x] FLYER-SCHEMA.md 실서버 동기화 (login_id/gender/total_purchase_amount/callback phone ALTER 반영)
> - [x] TypeScript 백엔드+프론트엔드 에러 0건 확인
> - [x] 스키마 대조 전수 점검 + 코드 수정 완료
>
> **핵심 의사결정:**
> 1. ✅ 방식 B (flyer_* 완전 분리) — 한줄로 기간계 무접촉
> 2. ✅ 슈퍼관리자 통합 (한줄로와 동일 레이아웃, 강조색만 주황)
> 3. ✅ 용어: flyer_companies = **총판**, flyer_users = **매장** (사장님)
> 4. ✅ 과금: 매장당 월 15만원, 총판 수수료 5만원
> 5. ✅ 로그인: login_id 기반 (한줄로 users와 동일 패턴)
> 6. ✅ 배포 완료 (서버 DDL + 1차 배포). 슈퍼관리자에서 전단AI 모드 전환 동작 확인

---

### 🔧 D113 — Phase A-1 업종체계 + 매장별 과금 + 템플릿 다양화 (코드 완료, DDL 미적용)

> **목표:** POS 없이 즉시 효과 나는 기능 8개 순차 개발.
> 로컬에서 전부 개발 완료 후 한 번에 배포.
>
> **⚠️ 주의사항:**
> - 한줄로 기간계 무접촉. flyer_* 테이블만 사용.
> - 컨트롤타워(utils/flyer/) 먼저 → 라우트 → 프론트 순서.
> - FLYER-SCHEMA.md 참조해서 컬럼명 정확히 확인 후 코드 작성.
> - 새 테이블 필요 시 DDL은 코드에 넣지 말고, 완료 후 Harold님 서버 실행 명령어로 안내.
>
> **개발 순서 (FLYER-MART-ROADMAP.md Phase A):**
>
> **1. 카탈로그DB (기능 15) — CT-F11 이미 있음**
> - [ ] flyer-frontend에 카탈로그 관리 페이지 신설 (상품 추가/편집/삭제)
> - [ ] 전단 생성 화면에 "내 상품" 사이드바 → 드래그로 전단에 추가
> - [ ] 이전 전단에서 사용한 상품 자동 카탈로그 등록
>
> **2. 전단 템플릿 다양화 (기능 7)**
> - [ ] 기존 3종(grid/list/highlight) → 업종별 확장 (마트/정육/수산/농산/베이커리)
> - [ ] 시즌 템플릿 (명절/개업/창고대방출/신상입고)
> - [ ] flyers 테이블에 template_category 컬럼 추가 필요
>
> **3. 인쇄 PDF 내보내기 (기능 17)**
> - [ ] 공개 페이지 → A4/A3 PDF 변환 (puppeteer 서버사이드)
> - [ ] flyer-frontend에 "PDF 다운로드" 버튼
> - [ ] 레이아웃 옵션: A4/A3/반페이지
>
> **4. QR 체크인 쿠폰 (기능 8)**
> - [ ] flyer_coupons / flyer_coupon_redemptions 테이블 신설
> - [ ] 전단 하단 QR 자동 생성 → /q/:code 공개 페이지
> - [ ] 쿠폰 사용 API (매장에서 스캔)
> - [ ] 오프라인 방문율 측정 리포트
>
> **5. 카카오 브랜드메시지 배포 (기능 13)**
> - [ ] 전단AI 전용 카카오 래퍼 (utils/flyer/flyer-brand-message.ts)
> - [ ] SendPage에 "카카오 배포" 옵션 추가
>
> **6. 주간/월간 정기 자동발행 (기능 4)**
> - [ ] flyer_auto_campaigns 테이블 신설
> - [ ] flyer-auto-worker.ts (한줄로 auto-campaign-worker 패턴 복제)
> - [ ] 프론트 자동발행 설정 UI
>
> **7. A/B 테스트 (기능 14)**
> - [ ] 전단 2종 생성 → 수신자 랜덤 분할 → 클릭률 비교
>
> **8. 매장 직원 간편 모드 (기능 16)**
> - [ ] 모바일 우선 UI: 사진→가격→전송 3단계
> - [ ] flyer_staff 권한 전용 간편 화면
>
> **슈퍼관리자 기능 확장 (기능 개발과 병행):**
> - [ ] 총판 상세 보기 (하위 매장 목록 + 매출 통계)
> - [ ] 매장 생성/수정/삭제 (총판 하위)
> - [ ] 정산 관리 (매장당 15만원 + 총판 수수료 5만원 계산)
> - [ ] 캠페인 내역 조회
> - [ ] 발송 통계 차트
>
> **현재 파일 구조:**
> ```
> packages/backend/src/
> ├── middlewares/flyer-auth.ts, super-service-guard.ts
> ├── routes/flyer/ (auth, companies, customers, campaigns, unsubscribes, balance, stats, catalog, pos, address-books, sender-registration, flyers, short-urls)
> ├── routes/admin/ (switch-service, flyer-admin)
> └── utils/flyer/ (CT-F01~F12 + index.ts)
>     ├── flyer-sms-queue.ts (CT-F01)
>     ├── flyer-unsubscribe-helper.ts (CT-F02)
>     ├── flyer-billing.ts (CT-F03)
>     ├── flyer-customer-filter.ts (CT-F04)
>     ├── flyer-message.ts (CT-F05)
>     ├── flyer-callback-filter.ts (CT-F06)
>     ├── flyer-deduplicate.ts (CT-F07)
>     ├── flyer-send.ts (CT-F08 — 발송 오케스트레이터)
>     ├── flyer-stats.ts (CT-F09)
>     ├── flyer-rfm.ts (CT-F10 — Phase B 스켈레톤)
>     ├── flyer-catalog.ts (CT-F11)
>     ├── flyer-pos-ingest.ts (CT-F12 — Phase B 스켈레톤)
>     └── index.ts
> ```

---

### ✅ D101 — 전단AI 6건 기능 개선 + 버그 수정 (2026-04-01 완료)

> 1. 좌측상단 회사명 표시 (로그인한 company_name)
> 2. 세션 30분 자동 로그아웃 (전단AI 전용 파일 3개, 한줄로와 완전 분리)
> 3. MMS 이미지 첨부 (전단AI 전용 업로드 엔드포인트 + uploads/flyer-mms/ 별도 저장)
> 4. 중복제거 + 수신거부제거 체크마크 + 실제 동작
> 5. 080 수신거부번호 직접 설정 (SettingsPage 읽기전용→편집 가능)
> 6. 전단지 기간 만료 시 자동 만료 처리 (공개 페이지 "행사 종료" 안내)
> 7. 브랜드 상품 이미지 매핑 추가 (비비고 왕교자, 카스 500ML)
> 8. DATE 타입 UTC 밀림 버그 수정 (TO_CHAR로 YYYY-MM-DD 문자열 반환)

---

## 2) 구현 현황 총괄

### Phase 1 — MVP 인프라 ✅ (2026-03-29)
| 항목 | 상태 |
|------|------|
| DB 마이그레이션 (flyers, short_urls, url_clicks) | ✅ |
| 백엔드 API (전단지 CRUD + 발행 + 클릭통계) | ✅ |
| 공개페이지 (3종 템플릿 SSR + 클릭 로그) | ✅ |
| 도메인 연결 (DNS + SSL + Nginx) | ✅ |

### Phase 1.5 — 프론트엔드 ✅ (2026-03-29)
| 항목 | 상태 |
|------|------|
| LoginPage (좌측 브랜드 패널 + 우측 폼) | ✅ |
| FlyerPage (CRUD + 템플릿 3종 + 폰 미리보기) | ✅ |
| SendPage (SMS/LMS/MMS + 수신자 3탭 + URL 자동삽입) | ✅ |
| ResultsPage (발송결과 + 클릭 추적 + 일별 추이) | ✅ |
| BalancePage (잔액 + 거래내역) | ✅ |
| UnsubscribesPage (수동 등록 + 목록) | ✅ |
| SettingsPage (회사정보/회신번호/080/요금단가) | ✅ |
| CustomerPage (엑셀 업로드/조회/검색/삭제) | ✅ |

### Phase 2 — 상품 이미지 + 템플릿 개선 ✅ (2026-03-30 ~ 2026-04-01)
| 항목 | 상태 |
|------|------|
| 상품 이미지 직접 업로드 (상품별 📷 버튼) | ✅ 배포 완료 |
| 이미지 서빙 공개 엔드포인트 (인증 불필요) | ✅ 배포 완료 |
| 이미지 삭제 API | ✅ 배포 완료 |
| 3종 템플릿 디자인 전면 개선 | ✅ 배포 완료 |
| Nginx 프록시 /api/flyer/ 추가 (hanjul-flyer.kr) | ✅ 적용 완료 |
| FL-B01~B04 버그 전부 수정 | ✅ 배포 완료 |
| Pixabay 무료 기본 이미지 47개 수집 | ✅ 완료 |
| PRODUCT_MAP 로컬 이미지 매핑 + 서빙 | ✅ 배포 완료 (D100) |
| 브랜드 상품 이미지 추가 (비비고 왕교자, 카스 500ML) | ✅ 배포 완료 (D101) |
| 업종별 템플릿 (카페/미용실/정육점/꽃집) | 미착수 |
| 매장 로고 + 테마 컬러 커스터마이징 | 미착수 |

### Phase 2.5 — 발송 강화 + UX 개선 ✅ (2026-04-01)
| 항목 | 상태 |
|------|------|
| 좌측상단 로그인 회사명 표시 | ✅ 배포 완료 (D101) |
| 세션 30분 자동 로그아웃 + 타이머 (전단AI 전용) | ✅ 배포 완료 (D101) |
| MMS 이미지 첨부 (전단AI 전용 저장 경로 분리) | ✅ 배포 완료 (D101) |
| 중복제거 + 수신거부제거 체크마크 | ✅ 배포 완료 (D101) |
| 080 수신거부번호 직접 설정 | ✅ 배포 완료 (D101) |
| 전단지 기간 만료 시 자동 만료 처리 | ✅ 배포 완료 (D101) |
| DATE UTC 밀림 수정 (TO_CHAR) | ✅ 배포 완료 (D101) |

### Phase 3 — AI + 분석 (미착수)
| 항목 | 상태 |
|------|------|
| 상품별 클릭 영역 히트맵 | 미착수 |
| 전단지 히스토리 + 재사용 | 미착수 |
| 카카오 친구톡 연동 | 미착수 |
| 발송 최적 시간 추천 | 미착수 |

---

## 3) 아키텍처

### 3-1. 이미지 시스템 (FL-01~02)

```
상품 이미지 우선순위:

1순위: 직접 업로드 이미지 (마트 사장님이 올린 사진)
   └─ uploads/flyer-products/{companyId}/{uuid}.jpg
   └─ 상품 입력 행의 📷 버튼으로 업로드
   └─ categories JSONB → item.imageUrl에 저장

2순위: PRODUCT_MAP 기본 이미지 (Pixabay 무료 수집 + 브랜드 공식 이미지)
   └─ uploads/product-images/딸기.jpg 등 49개
   └─ product-images.ts에서 상품명 키워드 매칭 (toLowerCase 비교)
   └─ ✅ 활성화 완료

MMS 이미지 (전단AI 전용 — 한줄로 uploads/mms/와 완전 분리):
   └─ uploads/flyer-mms/{companyId}/{uuid}.jpg
   └─ API: /api/flyer/flyers/mms-upload (업로드), /api/flyer/flyers/mms-image (삭제)
   └─ 서빙: /api/flyer/flyers/flyer-mms/:companyId/:filename (공개)

3순위: 이모지 (최종 폴백)
   └─ 상품명 키워드 → 이모지 자동 매핑
```

**이미지 결정 경과:**
- DALL-E 생성: AI 느낌 강함 → **부적합**
- Unsplash 큐레이션: 외국 식재료 느낌 → **부적합**
- 유료 스톡 (클립아트코리아): 50개에 41만원 → **비쌈**
- **Pixabay 무료 실사**: 상업적 사용 가능, 비용 0원 → **최종 결정**

### 3-2. 컨트롤타워

| 파일 | 역할 |
|------|------|
| `utils/product-images.ts` (백엔드) | PRODUCT_MAP, getProductDisplay, renderProductImage, resolveProductImageUrl, DALL-E 함수들 (현재 미사용) |
| `flyer-frontend/src/utils/product-images.ts` (프론트) | PRODUCT_MAP (동일), getProductDisplay |

### 3-3. API 엔드포인트 (전단AI 전용)

| 메서드 | 경로 | 인증 | 설명 |
|--------|------|------|------|
| POST | /api/flyer/flyers | ✅ | 전단지 생성 |
| GET | /api/flyer/flyers | ✅ | 전단지 목록 |
| GET | /api/flyer/flyers/:id | ✅ | 전단지 상세 |
| PUT | /api/flyer/flyers/:id | ✅ | 전단지 수정 |
| DELETE | /api/flyer/flyers/:id | ✅ | 전단지 삭제 |
| POST | /api/flyer/flyers/:id/publish | ✅ | 전단지 발행 (단축URL) |
| GET | /api/flyer/flyers/:id/stats | ✅ | 클릭 통계 |
| POST | /api/flyer/flyers/product-image | ✅ | 상품 이미지 업로드 (1장, 1MB) |
| DELETE | /api/flyer/flyers/product-image | ✅ | 상품 이미지 삭제 |
| GET | /api/flyer/flyers/flyer-products/:companyId/:filename | ❌ | 업로드 이미지 서빙 (공개) |
| GET | /api/flyer/flyers/product-images/:filename | ❌ | 기본 이미지 서빙 (공개) |
| POST | /api/flyer/flyers/mms-upload | ✅ | 전단AI 전용 MMS 이미지 업로드 (uploads/flyer-mms/) |
| DELETE | /api/flyer/flyers/mms-image | ✅ | 전단AI 전용 MMS 이미지 삭제 |
| GET | /api/flyer/flyers/flyer-mms/:companyId/:filename | ❌ | 전단AI MMS 이미지 서빙 (공개) |
| GET | /api/flyer/p/:code | ❌ | 공개 페이지 렌더링 |

### 3-4. DB 테이블

| 테이블 | 용도 |
|--------|------|
| flyers | 전단지 (행사명, 카테고리, 상품, 템플릿). categories JSONB 내 item.imageUrl로 직접 업로드 이미지 참조 |
| short_urls | 단축URL (code, flyer_id, 90일 만료) |
| url_clicks | 클릭 로그 (IP, UA, 시간) |

### 3-5. 3종 템플릿 디자인 (2026-03-30 전면 개선)

| 템플릿 | 컨셉 | 배경 | 강조색 | 이미지 크기 |
|--------|------|------|--------|------------|
| **그리드형** | 마트 전단지 | 밝은(#f2f2f2) | 빨간(#dc2626) | 카드 120px, 미리보기 60px |
| **리스트형** | 깔끔 모던 | 밝은(#f8f9fa) | 딥블루(#2563eb) | 72px 정사각, 미리보기 42px |
| **하이라이트형** | 프리미엄 다크 | 다크(#0f0f0f) | 골드(#d4a844) | TOP PICK 140px, 컴팩트 80px |

### 3-6. 배포

```bash
# 백엔드: tp-deploy-full로 자동 빌드
# 전단AI 프론트엔드 빌드 (tp-deploy-full에 미포함)
ssh administrator@58.227.193.62
cd /home/administrator/targetup-app/packages/flyer-frontend && npm run build
```

### 3-7. Nginx 설정 (2026-03-30 추가)

hanjul-flyer.kr에 `/api/flyer/` 프록시 추가 완료:
```
location /api/flyer/ → proxy_pass http://127.0.0.1:3000/api/flyer/
```
공개 페이지에서 상품 이미지 API 접근 가능.

---

## 4) 버그 트래커

| ID | 심각도 | 상태 | 내용 |
|----|--------|------|------|
| FL-B01 | 🔴 | ✅ 수정+배포 | 이미지 서빙 경로 불일치 → getGeneratedImageUrl 경로 수정 |
| FL-B02 | 🔴 | ✅ 수정+배포 | 공개 페이지 이미지 상대경로 → toAbsoluteImageUrl 헬퍼 + Nginx 프록시 추가 |
| FL-B03 | 🟠 | ✅ 해소 | Unsplash 서버 로드 실패 → 이모지 폴백으로 자연 대응 (Unsplash 미사용 결정) |
| FL-B04 | 🟠 | ✅ 수정+배포 | onerror 폴백 미작동 → nextElementSibling 방식으로 개선 |
| FL-B05 | 🔴 | ✅ 수정+배포 | authenticate 미들웨어가 이미지 서빙도 차단 (401) → 공개 엔드포인트를 authenticate 위로 이동 |
| FL-B06 | 🟠 | ✅ 수정+배포 | Express URL 자동 디코딩 vs 디스크 인코딩 파일명 불일치 → re-encode 처리 |
| FL-B07 | 🔴 | ✅ 수정+배포 | 전단지 저장 후 목록 403 — applyStoreScope에서 company_admin 미체크 (D100) |
| FL-B08 | 🟠 | ✅ 수정+배포 | 로그인 시 기존 세션 전부 무효화 → 전단AI+메인 동시 사용 불가 → 동시 세션 5개 허용 (D100) |
| FL-B09 | 🔴 | ✅ 수정+배포 | DATE 타입 UTC 밀림 — node-postgres가 DATE→Date 객체→JSON 직렬화 시 UTC 변환으로 하루 밀림 → TO_CHAR로 YYYY-MM-DD 문자열 반환 (D101) |
| FL-B10 | 🟠 | ✅ 수정+배포 | SettingsPage 080 키 불일치 — `opt_out_080_number`로 접근했으나 API는 `reject_number` 반환 → 키 수정 + 직접 편집 가능으로 변경 (D101) |
| FL-B11 | 🟠 | ✅ 수정+배포 | product-images 서빙 webp/jpeg Content-Type 미지원 + PRODUCT_MAP 키워드 대소문자 비교 누락 (D101) |

---

## 5) 교훈 (전단AI 전용)

| 교훈 | 내용 | 대책 |
|------|------|------|
| **Express 라우트 순서** | /generate-images가 /:id 뒤에 있어서 Express가 "generate-images"를 :id로 매칭 | 고정 경로 라우트를 /:id 앞에 배치 |
| **이미지 서빙 경로** | flyers.ts가 /api/flyer/flyers에 마운트 → product-images도 /api/flyer/flyers/product-images/ | getGeneratedImageUrl 반환 경로를 실제 마운트 경로와 일치 |
| **authenticate 범위** | router.use(authenticate) 한 줄이 전체 라우터에 적용 → 공개 엔드포인트도 차단 | 공개 엔드포인트는 반드시 authenticate 위에 배치 |
| **Express URL 디코딩** | Express가 req.params를 자동 디코딩하지만 디스크 파일명은 인코딩 상태 | 서빙 시 encodeURIComponent로 re-encode |
| **DALL-E 이미지 품질** | 한국 마트 상품에 AI 생성 이미지는 인공적으로 보임 | 실사 사진 사용 (직접 업로드 또는 무료 스톡) |
| **Unsplash 한계** | 외국 식재료 사진은 한국 마트 느낌과 맞지 않음 | Pixabay 무료 이미지 또는 직접 촬영 |
| **유료 스톡 비용** | 클립아트코리아 50개=41만원 — SaaS 초기에 부담 | Pixabay 무료 이미지로 대체 (상업적 사용 가능) |
| **프론트 미리보기 동기화** | short-urls.ts(공개 페이지)만 수정하고 FlyerPreviewRenderer(프론트)는 수정 안 함 → 미리보기 변화 없음 | **공개 페이지와 프론트 미리보기 양쪽 동시 수정** |
| **TS 미사용 변수** | isLight 선언 후 미사용 → 프론트 빌드 실패 | 수정 후 반드시 프론트+백엔드 양쪽 tsc 확인 |
| **company_admin 권한 체크 누락** | applyStoreScope에서 'admin'만 체크 → company_admin이 403 → 전단지 목록 미표시 | **userType 체크 시 company_admin도 포함** |
| **세션 전부 무효화** | 로그인 시 같은 userId 세션 전부 is_active=false → 다른 앱 세션 사망 | **동시 세션 허용 (최대 5개, 초과 시 오래된 것만 정리)** |
| **이미지 경로 불일치** | PM2가 packages/backend/에서 실행 → ./uploads/ = packages/backend/uploads/ ≠ 루트 uploads/ | **심볼릭 링크 또는 절대경로 사용** |
| **DATE UTC 밀림** | PostgreSQL DATE → node-postgres Date 객체 → JSON.stringify UTC 변환 → 하루 전 날짜 | **SELECT에서 TO_CHAR(column, 'YYYY-MM-DD')로 문자열 반환. Date 객체 직렬화 금지** |
| **한줄로 데이터 격리** | MMS 이미지를 같은 /api/mms-images/ 사용하면 한줄로 MMS 보관함에 전단AI 이미지 섞임 | **전단AI 전용 엔드포인트 + 별도 저장경로(uploads/flyer-mms/) 완전 분리** |
| **브랜드 상품 키워드** | "맥주"로 매핑하면 모든 맥주가 카스 이미지, "비비고"면 모든 비비고 제품이 왕교자 이미지 | **브랜드 상품은 정확한 상품명으로 매핑. 범용 키워드 금지** |
| **API 응답 키 불일치** | SettingsPage가 opt_out_080_number로 접근하지만 API는 reject_number 반환 → 항상 미설정 | **API 반환 키와 프론트 접근 키를 양쪽 확인** |
