# 전단AI (한줄전단) — 프로젝트 운영 문서

> **설계 문서:** FLYER-AI-DESIGN.md (컨셉, 결정사항, 로드맵)
> **이 문서:** 현재 작업 상태, 구현 현황, 버그, 아키텍처 변경 추적
> **최종 업데이트:** 2026-03-30

---

## 1) CURRENT_TASK (현재 집중 작업)

### 🔧 FL-01 — 상품 이미지 자동 매핑 시스템 (2026-03-30) — 🟡 진행중

> **배경:** 전단지 상품 표시가 이모지만 있어서 시각적 임팩트 부족. 중진공 실사(3/31) 대비 상품 이미지 자동 표시 필요.

#### 구현 완료
- [x] 백엔드 컨트롤타워 `utils/product-images.ts` 생성 — PRODUCT_MAP 80개+ 상품 매핑
- [x] 프론트 컨트롤타워 `flyer-frontend/src/utils/product-images.ts` 생성
- [x] short-urls.ts 3종 템플릿 이모지→이미지 교체 (Unsplash 큐레이션)
- [x] FlyerPage.tsx 미리보기에 이미지 표시
- [x] DALL-E 3 이미지 생성 함수 추가 (generateProductImage, generateFlyerImages)
- [x] flyers.ts에 이미지 생성 API 4개 엔드포인트 추가
- [x] 전단지 저장 시 백그라운드 DALL-E 이미지 생성 트리거
- [x] 상품 등록 UI 개선: 엑셀 CSV 업로드 + 카테고리 탭 방식

#### 🔴 남은 버그
- **FL-B01:** 이미지 서빙 경로 불일치 — `getGeneratedImageUrl()`이 `/api/flyer/product-images/`를 반환하지만 실제 엔드포인트는 `/api/flyer/flyers/product-images/`. 수정 코드 작성 완료, 미배포.
- **FL-B02:** 공개 페이지(hanjul-flyer.kr)에서 이미지 URL이 상대경로로 해석됨 — 절대 URL 또는 Nginx 프록시 설정 필요
- **FL-B03:** Unsplash 이미지 서버 환경에서 로드 실패 — IDC 방화벽 또는 DNS 문제. DALL-E 생성 이미지로 대체하면 해결됨 (로컬 파일이므로)
- **FL-B04:** onerror 폴백 미작동 — 이미지 로드 실패 시 이모지로 대체되어야 하는데 깨진 아이콘 표시

#### 다음 세션 작업
1. FL-B01~B04 버그 수정 후 배포
2. DALL-E 생성 이미지가 공개 페이지에서 정상 표시되는지 검증
3. PM2 로그에서 DALL-E 생성 성공 확인 (`이미지 일괄 생성 완료: 10개 상품` — 확인됨)
4. 서버에 uploads/product-images/ 폴더에 실제 파일 생성 확인

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

### Phase 2 — 상품 이미지 + UX 개선 🟡 (2026-03-30 진행중)
| 항목 | 상태 |
|------|------|
| 상품 이미지 자동 매핑 (Unsplash 큐레이션 80개+) | ✅ 코드 완료, 🔴 서버 이미지 로드 실패 |
| DALL-E 3 이미지 자동 생성 (백그라운드) | ✅ 코드 완료, 🔴 경로 버그 수정 중 |
| 3단계 이미지 폴백 (DALL-E > Unsplash > 이모지) | ✅ 구조 완료 |
| 엑셀 CSV 일괄 업로드 | ✅ |
| 카테고리 탭 방식 UI | ✅ |
| 예시 CSV 파일 다운로드 | ✅ |
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

### 3-1. 이미지 시스템 (FL-01 신규)

```
상품명 입력 → 3단계 이미지 소싱:

1단계: DALL-E 3 생성 이미지 (서버 로컬, 최우선)
   └─ uploads/product-images/{상품명}.png
   └─ 전단지 저장 시 백그라운드 생성 (10~15초/개)
   └─ 한번 생성 → 영구 캐시 (메모리 + 파일)

2단계: Unsplash 큐레이션 이미지 (폴백)
   └─ product-images.ts PRODUCT_MAP에 80개+ URL 내장
   └─ API 키 불필요 (핫링크)

3단계: 이모지 (최종 폴백)
   └─ 상품명 키워드 → 이모지 자동 매핑
```

### 3-2. 컨트롤타워

| 파일 | 역할 |
|------|------|
| `utils/product-images.ts` (백엔드) | PRODUCT_MAP, getProductDisplay, renderProductImage, generateProductImage, generateFlyerImages, resolveProductImageUrl |
| `flyer-frontend/src/utils/product-images.ts` (프론트) | PRODUCT_MAP (동일), getProductDisplay |

### 3-3. API 엔드포인트 (전단AI 전용)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | /api/flyer/flyers | 전단지 생성 |
| GET | /api/flyer/flyers | 전단지 목록 |
| GET | /api/flyer/flyers/:id | 전단지 상세 |
| PUT | /api/flyer/flyers/:id | 전단지 수정 |
| DELETE | /api/flyer/flyers/:id | 전단지 삭제 |
| POST | /api/flyer/flyers/:id/publish | 전단지 발행 (단축URL) |
| GET | /api/flyer/flyers/:id/stats | 클릭 통계 |
| POST | /api/flyer/flyers/generate-images | 이미지 일괄 생성 (DALL-E) |
| POST | /api/flyer/flyers/generate-image | 단일 이미지 생성 (DALL-E) |
| GET | /api/flyer/flyers/product-images/:filename | 생성 이미지 서빙 |
| GET | /api/flyer/flyers/product-image-status | 이미지 생성 상태 조회 |
| GET | /api/flyer/p/:code | 공개 페이지 렌더링 (인증 불필요) |

### 3-4. DB 테이블

| 테이블 | 용도 |
|--------|------|
| flyers | 전단지 (행사명, 카테고리, 상품, 템플릿) |
| short_urls | 단축URL (code, flyer_id, 90일 만료) |
| url_clicks | 클릭 로그 (IP, UA, 시간) |

### 3-5. 배포

```bash
# 전단AI 프론트엔드 빌드 (tp-deploy-full에 미포함)
ssh administrator@58.227.193.62
cd /home/administrator/targetup-app/packages/flyer-frontend && npm run build
```

- 백엔드: tp-deploy-full로 자동 빌드
- 프론트: 별도 빌드 필요 (위 명령어)

---

## 4) 버그 트래커

| ID | 심각도 | 상태 | 내용 |
|----|--------|------|------|
| FL-B01 | 🔴 | 🟡 수정완료-미배포 | 이미지 서빙 경로 불일치 (/api/flyer/product-images → /api/flyer/flyers/product-images) |
| FL-B02 | 🔴 | 🔵 Open | 공개 페이지 이미지 상대경로 → 절대 URL 필요 |
| FL-B03 | 🟠 | 🔵 Open | Unsplash 이미지 서버 환경 로드 실패 (DALL-E로 대체 시 해소) |
| FL-B04 | 🟠 | 🟡 수정완료-미배포 | onerror 폴백 미작동 (alt="" + emoji-fb 클래스로 수정) |

---

## 5) 교훈 (전단AI 전용)

| 교훈 | 내용 | 대책 |
|------|------|------|
| **Express 라우트 순서** | /generate-images가 /:id 뒤에 있어서 Express가 "generate-images"를 :id로 매칭 | 고정 경로 라우트를 /:id 앞에 배치 |
| **이미지 서빙 경로** | flyers.ts가 /api/flyer/flyers에 마운트 → product-images도 /api/flyer/flyers/product-images/ | getGeneratedImageUrl 반환 경로를 실제 마운트 경로와 일치 |
| **Unsplash 서버 환경** | IDC 서버에서 외부 이미지 핫링크 실패 가능 | DALL-E 생성 이미지(로컬) 우선, Unsplash는 폴백 |
| **공개 페이지 이미지 경로** | SSR HTML 내 이미지 URL이 상대경로로 해석될 수 있음 | 절대 URL 사용 필수 |
