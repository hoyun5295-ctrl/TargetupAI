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

> **최종 업데이트:** 2026-04-09 (D113)

---

## 1) CURRENT_TASK (현재 집중 작업)

### 🎯 D114 — 다음 세션 즉시 착수 항목

> **D113에서 코드+배포 완료. 아래 미완료/개선 항목을 다음 세션에서 이어간다.**

**1. 슈퍼관리자 UI 개선 (긴급)**
- [ ] 총판 생성 모달에 사업자등록증 전체 필드 추가 (업태/종목/주소/세금계산서/담당자 — 현재 일부만)
- [ ] 총판 수정 모달 신설 (현재 없음)
- [ ] 총판 상세 보기 (하위 매장 목록 + 매출 통계)
- [ ] 매장 등록 모달 alert() 잔존 → 전부 커스텀 모달로 교체
- [ ] 중복 총판 방지 (company_name UNIQUE 또는 UI 경고)
- [ ] 전체 총판 카드 숫자가 삭제 후 갱신 안 됨 → loadStats 호출 확인

**2. FLYER-SCHEMA.md 업데이트 (필수)**
- [ ] flyer_business_types 테이블 문서화
- [ ] flyer_users 확장 컬럼 (~20개) 문서화
- [ ] flyers/short_urls FK 변경 사항 반영 (companies → flyer_companies)

**3. 템플릿 디자인 고도화**
- [ ] 10종 템플릿 실제 전단지 발행 후 공개 페이지 품질 확인 (미리보기 ↔ 공개 페이지 디자인 일치 검증)
- [ ] 이미지 문제 근본 해결 (상품 이미지 부족 — Pixabay 추가 수집 또는 다른 방안)
- [ ] 템플릿 선택 카드에 색상 바 렌더링 확인

**4. 카탈로그DB 연동 (Phase A 다음 기능)**
- [ ] flyer-frontend에 카탈로그 관리 페이지 신설 (상품 추가/편집/삭제)
- [ ] 전단 생성 화면에 "내 상품" 사이드바 → 드래그로 전단에 추가
- [ ] 이전 전단에서 사용한 상품 자동 카탈로그 등록

**5. 과금 흐름 검증**
- [ ] 입금확인 → 매장 활성화 → 잔액 충전 → 전단 발행 → 발송 → 잔액 차감 전체 흐름 테스트
- [ ] payment_status='pending' 매장의 발송 차단 확인

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
    └── index.ts

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

### 이전 Phase (MVP~2.5) ✅
- Phase 1 (2026-03-29): DB + 백엔드 API + 공개페이지 3종 + 도메인
- Phase 1.5 (2026-03-29): 프론트 8페이지
- Phase 2 (2026-03-30~04-01): 상품 이미지 + 템플릿 개선 + Pixabay
- Phase 2.5 (2026-04-01): 세션관리 + MMS + 중복제거 + 080 + 만료처리

### 미착수 (Phase A 나머지)
- 카탈로그DB 관리 페이지 + 전단 연동
- 인쇄 PDF 내보내기
- QR 체크인 쿠폰
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
