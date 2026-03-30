# 전단AI (한줄전단) — 프로젝트 운영 문서

> **설계 문서:** FLYER-AI-DESIGN.md (컨셉, 결정사항, 로드맵)
> **이 문서:** 현재 작업 상태, 구현 현황, 버그, 아키텍처 변경 추적
> **최종 업데이트:** 2026-03-30

---

## 1) CURRENT_TASK (현재 집중 작업)

### 🟡 FL-02 — 상품 이미지 기본 매핑 (Pixabay 무료 이미지) — 대기중

> **배경:** DALL-E=AI느낌, Unsplash=외국느낌, 유료 스톡=비쌈 → Pixabay 무료 실사 이미지 50개 수집 결정
> **상태:** 직원들이 Pixabay에서 50개 이미지 다운로드 진행 중. 이미지 도착 후 서버 업로드 + PRODUCT_MAP 매핑 예정.

#### 이미지 도착 후 작업
1. 서버에 `uploads/product-images/` 폴더에 50개 이미지 업로드
2. `product-images.ts` PRODUCT_MAP에 로컬 이미지 경로 매핑
3. `resolveProductImageUrl()` 활성화 (현재 null 반환 → 로컬 이미지 반환)
4. 배포 후 공개 페이지에서 기본 이미지 표시 검증

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

### Phase 2 — 상품 이미지 + 템플릿 개선 🟡 (2026-03-30 진행중)
| 항목 | 상태 |
|------|------|
| 상품 이미지 직접 업로드 (상품별 📷 버튼) | ✅ 배포 완료 |
| 이미지 서빙 공개 엔드포인트 (인증 불필요) | ✅ 배포 완료 |
| 이미지 삭제 API | ✅ 배포 완료 |
| 3종 템플릿 디자인 전면 개선 | ✅ 배포 완료 |
| Nginx 프록시 /api/flyer/ 추가 (hanjul-flyer.kr) | ✅ 적용 완료 |
| FL-B01~B04 버그 전부 수정 | ✅ 배포 완료 |
| Pixabay 무료 기본 이미지 50개 수집 | 🟡 직원 작업중 |
| PRODUCT_MAP 로컬 이미지 매핑 | ⏳ 이미지 도착 후 |
| 업종별 템플릿 (카페/미용실/정육점/꽃집) | 미착수 |
| 매장 로고 + 테마 컬러 커스터마이징 | 미착수 |

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

2순위: PRODUCT_MAP 기본 이미지 (Pixabay 무료 수집)
   └─ uploads/product-images/딸기.jpg 등 50개
   └─ product-images.ts에서 상품명 키워드 매칭
   └─ ⏳ 이미지 수집 후 활성화 예정

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
