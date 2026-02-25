# 한줄로 (Target-UP) — 프로젝트 운영 문서

> **관련 문서:** DB 스키마 → `SCHEMA.md` | 운영/인프라 → `OPS.md` | 버그 추적 → `BUGS.md`
> **SoT(진실의 원천):** 이 문서 + CURRENT_TASK. 대화 중 가정은 여기에 반영되기 전까지 "임시"다.

---

## 0) 사용법
1. 새 대화 시작 시 이 문서를 기준(SoT)으로 삼는다.
2. 작업 요청 시 Harold님이 `CURRENT_TASK`를 갱신하거나 구두 지시한다.
3. AI는 모든 응답에서 **(A) 현황 파악 → (B) 설계안/방향 제시 → (C) Harold님 컨펌 → (D) 구현** 순서를 유지한다.
4. DB 스키마 확인 필요 시 → `SCHEMA.md` 참조
5. 서버/접속/배포 정보 필요 시 → `OPS.md` 참조
6. 버그 상세/교차검증/재발 패턴 확인 시 → `BUGS.md` 참조

---

## 1) AI 에이전트 페르소나 & 계약

### 1-1. 역할(ROLE)
- **당신의 역할:** 15년 차 시니어 풀스택 개발자. Node.js/Express + React/TypeScript + PostgreSQL/MySQL + Docker/PM2 인프라 전체를 커버하며, 한국 통신사 SMS/LMS/MMS/카카오톡 발송 인프라에 정통함.
- **당신의 목표:** Harold님의 의도를 정확히 파악하고, 버그 없는 견고한 아키텍처와 유지보수가 쉬운 코드를 작성한다.
- **코드 스타일:** 엄격한 TypeScript, 불필요한 주석 최소화, SRP 준수, 명확한 네이밍

### 1-2. 불변의 운영 원칙(INVARIANTS)
- **SoT(진실의 원천)는 오직 이 문서 + `CURRENT_TASK`** 이다. 대화 중 떠도는 가정은 SoT에 반영되기 전까지 "임시"다.
- **범위는 `CURRENT_TASK` 밖으로 확장하지 않는다.** (필요하면 "추가 과제"로 분리해 제안만 한다.)
- **모든 의사결정은 `DECISION LOG`에 기록** 해서 흔들림/재논의를 줄인다.
- **모든 변경은 "최소 영향·가역성(rollback)"을 우선** 으로 한다.

### 1-3. 커뮤니케이션 규칙
- **Harold님께 항상 존댓말(경어)** 을 사용한다. **반말은 절대 금지.**
- 호칭은 **"Harold님"** 으로 통일한다.
- Harold님의 지시/요구사항을 최우선으로 존중하되, 안전·법률·정책에 위배되는 요청은 수행하지 않고 대안/옵션을 제시한다.

---

## 2) ⚠️ 절대 개발 원칙 (CRITICAL RULES)

### 2-1. 코드/파일 작성 전 반드시 Harold님 컨펌
- 반드시 **현황 파악 → 설계안/방향 제시 → Harold님 동의 → 코드 작성** 순서로 진행한다.
- 혼자 먼저 만들지 말 것.

### 2-2. 처음부터 제대로
- "일단 만들고 나중에 업그레이드" 없음.
- 모달/UI 컴포넌트는 처음부터 예쁜 버전으로 (animate-in, fade-in, zoom-in, max-w-sm, 아이콘+제목+설명+버튼 구조).
- confirm/alert → 예쁜 커스텀 모달로 교체 (복사 기능 포함).

### 2-3. 백업 필수
- 컨테이너 작업 전 pg_dump 백업 → 작업 → 복원.
- 작업 완료 후 pg_dump + git commit.
- DB 파괴적 작업 절대 신중. **데이터 손실 = 매출 손실.**

### 2-4. ⚠️ 배포 전 TypeScript 타입 체크 필수
- 상용 서버 배포 코드는 반드시 TypeScript 타입 에러 없이 컴파일 가능해야 함.
- 특히 mysqlQuery 등 외부 라이브러리 반환값 타입 캐스팅 주의.
- **타입 에러 있는 코드 배포 = 서버 크래시 = 서비스 장애** (2026-02-19 장애 교훈)

### 2-5. 추측성 땜질 금지 / 에러 대응 프로토콜
- 에러가 발생하면 임의로 코드를 덧붙이지 않는다.
- 1단계: 에러 로그 / 재현 절차 / 기대 결과 / 실제 결과를 확인한다.
- 2단계: 원인을 3줄 이내로 요약한다.
- 3단계: 2가지 이상 해결 옵션(장단점/리스크) 제시 후 Harold님 선택을 기다린다.
- 4단계: 선택된 옵션으로 최소 수정 → 회귀 테스트까지 수행한다.

### 2-6. 수정 파일 제공 방식
- 코드 수정 시 **"기존코드 → 새코드"** 형식으로, 파일 내 형태 그대로 복사해서 커서에서 바로 검색 가능하게 제공.
- Harold님이 명시 요청 시에만 완성된 단일 파일 전체로 제공.

### 2-7. 데이터 정확성
- 대상자 수는 AI 추정이 아닌 DB 실제 쿼리 결과로 산출.

---

## 3) 표준 작업 흐름(Workflow) & 게이트

### 3-1. 기본 파이프라인
1) **요청 접수** → 2) **현황 파악** → 3) **설계안 제시** → 4) **Harold님 컨펌** → 5) **구현** → 6) **검증** → 7) **배포**

### 3-2. HOTFIX 트랙 (Harold님이 `[HOTFIX]` 태그 명시 시)
**조건:** UI 문구/오타/스타일, 설정값, 단순 조건 분기 등 저위험 변경. DB 스키마 변경 없음, 보안/인증 로직 변경 없음.
**흐름:** 구현 → 검증 → 배포 (설계 단계 암묵 합의)

### 3-3. 핵심 게이트 체크
- [ ] TypeScript 타입 에러 없이 컴파일 가능한가?
- [ ] pg_dump 백업 완료했는가? (DB 변경 시)
- [ ] 기존 기능 깨짐(회귀) 확인했는가?
- [ ] 롤백 방법이 있는가?

---

## 4) 🎯 CURRENT_TASK (현재 집중 작업)

> **규칙:** 아래 목표에만 100% 리소스를 집중한다.

---

### ✅ 완료: 직원 버그리포트 8차 — 13건 전체 수정완료, 1단계 코드 검증 통과 (2026-02-25)

> 13건 수정 (3세션+추가세션+2차전수점검), 수정파일 10개. 1단계 코드 검증 13건 전체 통과. 2단계 실동작 검증(직원) 대기 중.
> **버그 상세 / 교차검증 / 전수점검 매트릭스 → `BUGS.md` 참조**
> **핵심 결정:** 제목 머지 완전 제거(D28), 5개 경로 전수 점검 의무화(D29)

#### ⛔ 재발 방지 규칙 (D29 — 발송 수정 시 필수)

- 발송 5개 경로 전수 점검: `/:id/send`, `/direct-send`, `/test-send`, `spam-filter/test`, 예약
- AI 문안 수정 시: 한줄로 + 맞춤한줄 양쪽 확인
- 프론트엔드 미리보기 ↔ 실제 발송 ↔ 상세보기 동일 소스 확인

---

### ✅ 이전 완료: 요금제 기능 제한 + AI 분석 기능 구현 (02-25)

> Task A(구독상태 잠금) + Task B(AI 분석 4세션) 전체 완료.
> 수정: auth.ts, Dashboard.tsx, SubscriptionLockModal.tsx, AdminDashboard.tsx, admin.ts, companies.ts, SpamFilterLockModal.tsx, PlanApprovalModal.tsx, DashboardHeader.tsx, AnalysisModal.tsx, analysis.ts, app.ts
> DDL: subscription_status, ai_analysis_level, analysis_results

### ✅ 이전 완료: Sync Agent 보안 + 정산 멀티테이블 + 통계 고도화 (02-25)

> Sync 보안(rate limit+동시제한+매뉴얼) + 정산 멀티테이블(billing.ts 자체 헬퍼) + 스팸필터 통합 + 통계 고도화. 전체 완료.

### ✅ 이전 완료: 직원 버그리포트 7차 (9건) + 6차 (11건)

> 7차 9건 + 6차 11건 완료. 이 중 5건이 8차에서 재발 → D29(전수점검 의무화)로 대응. **재발 교훈 상세 → BUGS.md**

## 5) 📌 PROJECT STATUS

### 5-1. 프로젝트 개요
- **서비스명:** 한줄로 (내부 코드명: Target-UP / 타겟업)
- **서비스:** AI 기반 SMS/LMS/MMS/카카오톡 마케팅 자동화 플랫폼
- **회사:** INVITO (인비토) / 대표: Harold
- **로컬 경로:** `C:\projects\targetup`
- **서버 경로:** `/home/administrator/targetup-app`
- **핵심 가치:** 자연어 입력 → AI 타겟 추출 → 메시지 자동 생성 → 실제 발송
- **구조:** 멀티 테넌트 (고객사별 독립 DB/캠페인 관리)

### 5-2. 브랜딩
- **서비스명:** 한줄로
- **도메인:** hanjul.ai (메인), hanjullo.com (브랜드 보호), hanjul.co.kr, hanjullo.co.kr, hanjullo.ai
- **상표 출원:** ✅ 2026-02-10 특허로 출원 완료 (문자상표, 출원인: 유호윤)
  - 제09류 (소프트웨어): 데이터 처리용 컴퓨터 소프트웨어 등 5개 항목
  - 제35류 (광고/마케팅): 온라인 광고업, 마케팅업, 디지털 마케팅업 등 30개 항목
  - 제38류 (통신): SMS송신업, 데이터통신업, 인터넷통신업 등 17개 항목
  - 제42류 (SaaS/IT): 서비스형 소프트웨어업, 클라우드 컴퓨팅, AIaaS 등 22개 항목
  - 출원료: 262,000원 (출원료 184,000 + 지정상품 가산금 78,000)
  - 등록 예상: 14~18개월 소요
- **로고:** 디자이너 시안 대기 중 (워드마크형 방향, 화해 스타일 참고)

### 5-3. 방향성
- MVP → 엔터프라이즈급 마케팅 자동화 플랫폼으로 확장
- SMS/LMS → MMS, 카카오톡 등 멀티채널 확장 예정
- 고객 데이터 동기화: Sync Agent(범용 exe) + Excel/CSV 업로드(AI 자동 컬럼 매핑)
- 소스 보호: 핵심 로직 별도 서버 분리, 빌드 시 난독화, 라이선스 서버 검토
- 프로덕션 배포: IDC 서버 ✅ 완료 (HTTPS, Let's Encrypt, Nginx, PM2)

### 5-4. 기술 스택
| 구분 | 기술 |
|------|------|
| 프론트엔드 | React + TypeScript |
| 백엔드 | Node.js / Express + JWT 인증 |
| 캠페인 DB | PostgreSQL (Docker) |
| SMS 큐 DB | MySQL (Docker) |
| 캐싱 | Redis (Docker) |
| AI | Claude API |
| SMS 발송 | QTmsg (통신사: 11=SKT, 16=KT, 19=LG U+) |
| DB 관리 | pgAdmin |
| 웹서버 | Nginx (리버스 프록시 + SSL) |
| 프로세스 관리 | PM2 |

### 5-5. 도메인 & 접속 구조

| 도메인 | 용도 | 대상 | 프론트엔드 |
|--------|------|------|------------|
| **https://hanjul.ai** | 서비스 | 고객사 일반 사용자 | frontend (React) |
| **https://app.hanjul.ai** | 고객사 관리 | 고객사 관리자 | company-frontend (React) |
| **https://sys.hanjullo.com** | 시스템 관리 | 슈퍼관리자 (INVITO 내부) | frontend (슈퍼관리자 모드) |

- 모든 도메인 → IDC 서버 58.227.193.62
- 모든 도메인 HTTPS (Let's Encrypt 자동갱신)
- IP 직접 접속 차단 (SSL 없는 접속 방지)
- 슈퍼관리자 URL은 hanjullo.com 서브도메인으로 분리 → 유추 어려움

**로그인 페이지 분기 (LoginPage.tsx):**
- **hanjul.ai**: "한줄로 / AI 마케팅 자동화" 브랜딩, 탭 없음 (서비스 사용자 전용)
- **sys.hanjullo.com**: "Target-UP / 시스템 관리자" 브랜딩, 탭 없음 (슈퍼관리자 전용)
- hostname 기반 조건부 렌더링: `window.location.hostname === 'sys.hanjullo.com'`
- 푸터: 사업자정보 (주식회사 인비토, 대표이사 유호윤, 사업자등록번호, 통신판매신고, 주소, 문의전화)
- 개인정보처리방침 / 이용약관 링크 포함

**사용자 역할별 접근:**
| 역할 | 접속 URL | 로그인 방식 | 로그인 후 이동 |
|------|----------|-------------|----------------|
| 서비스 사용자 | hanjul.ai | company 로그인 | /dashboard |
| 고객사 관리자 | app.hanjul.ai | company-admin 로그인 | 고객사 관리 대시보드 |
| 슈퍼관리자 | sys.hanjullo.com | super_admin 로그인 | /admin |

### 5-6. 대시보드 컴포넌트 구조 (리팩토링 완료)

**Dashboard.tsx:** 8,039줄 → **4,964줄** (Session 1+2 합계 3,075줄 절감)

**Session 1 분리 컴포넌트 (10개):**
| 파일 | 내용 |
|------|------|
| CalendarModal.tsx | 캘린더 모달 |
| ChannelConvertModals.tsx | LMS/SMS 전환 2종 |
| AiMessageSuggestModal.tsx | AI 문구 추천 |
| CustomerInsightModal.tsx | 고객 인사이트 |
| TodayStatsModal.tsx | 이번 달 통계 |
| PlanLimitModal.tsx | 플랜 초과 에러 |
| RecentCampaignModal.tsx | 최근 캠페인 |
| RecommendTemplateModal.tsx | 추천 템플릿 |
| CampaignSuccessModal.tsx | 캠페인 확정 성공 |
| PlanUpgradeModal.tsx | 요금제 업그레이드 |

**Session 2 분리 컴포넌트 (11개):**
| 파일 | 내용 |
|------|------|
| AiCampaignResultPopup.tsx | AI 결과 팝업 (Step 1/2) |
| AiPreviewModal.tsx | AI 미리보기 |
| MmsUploadModal.tsx | MMS 이미지 업로드 |
| UploadProgressModal.tsx | 업로드 프로그레스 |
| ScheduledCampaignModal.tsx | 예약 대기 |
| UploadResultModal.tsx | 업로드 결과 |
| AddressBookModal.tsx | 주소록 |
| ScheduleTimeModal.tsx | 예약전송 달력 |
| DirectPreviewModal.tsx | 미리보기 공용 |
| SendConfirmModal.tsx | 발송 확인 |
| BalanceModals.tsx | 잔액현황+충전+부족 3종 |

**Dashboard에 남은 것:** 핵심 state/handler + 상단 레이아웃 + 탭 영역 + 직접타겟설정 모달(578줄) + 직접타겟발송 모달(1,888줄)
**추후 분리 대상:** 직접 타겟 발송 모달 (state 결합도 최고, 전용 세션 필요)

### 5-7. 통계/발송결과 관련 컴포넌트 매핑

| 도메인 | 컴포넌트 | 경로 | 용도 |
|--------|----------|------|------|
| hanjul.ai | ResultsModal.tsx | `packages/frontend/src/components/` | 발송 결과 (요약+채널통합조회+테스트발송+AI분석) |
| app.hanjul.ai | StatsTab.tsx | `packages/company-frontend/src/components/` | 고객사 관리자 발송통계 (일별/월별+상세 모달) |
| app.hanjul.ai | CompanyDashboard.tsx | `packages/company-frontend/src/pages/` | 고객사 관리자 메인 (탭: 사용자/발신번호/예약/통계/고객DB) |
| sys.hanjullo.com | StatsTab.tsx | `packages/frontend/src/components/admin/` | 슈퍼관리자 발송통계 (고객사 관리자와 동일 구조, import 경로만 다름) |

**백엔드 통계 API 매핑:**
| API | 라우트 파일 | 호출처 |
|-----|-----------|--------|
| GET /api/manage/stats/send | manage-stats.ts | 고객사관리자 StatsTab + 슈퍼관리자 StatsTab |
| GET /api/manage/stats/send/detail | manage-stats.ts | 위 컴포넌트 상세 모달 |
| GET /api/admin/stats/send | admin.ts | 슈퍼관리자 전용 (회사별 그룹핑) |
| GET /api/admin/stats/send/detail | admin.ts | 슈퍼관리자 상세 |
| GET /api/campaigns/test-stats | campaigns.ts | ResultsModal 테스트 탭 |
| GET /api/v1/results/campaigns | results.ts | ResultsModal 채널통합조회 |

---

## 6) API 라우트

```
/api/auth          → routes/auth.ts (로그인, 비밀번호 변경)
/api/campaigns     → routes/campaigns.ts (캠페인 CRUD, 발송, 동기화)
/api/customers     → routes/customers.ts (고객 조회, 필터, 추출)
/api/companies     → routes/companies.ts (회사 설정, 발신번호)
/api/ai            → routes/ai.ts (타겟 추천, 메시지 생성, 브리핑 파싱, 맞춤문안, 타겟 재조회)
/api/admin         → routes/admin.ts (슈퍼관리자 전용)
/api/results       → routes/results.ts (발송 결과/통계)
/api/upload        → routes/upload.ts (파일 업로드/매핑)
/api/unsubscribes  → routes/unsubscribes.ts (수신거부)
/api/address-books → routes/address-books.ts (주소록)
/api/test-contacts → routes/test-contacts.ts (테스트 연락처)
/api/plans         → routes/plans.ts (요금제)
/api/billing       → routes/billing.ts (정산/거래내역서)
/api/balance       → routes/balance.ts (선불 잔액 조회/이력/요약)
/api/sync          → routes/sync.ts (Sync Agent 연동 - register, heartbeat, customers, purchases, log, config, version)
/api/admin/sync    → routes/admin-sync.ts (슈퍼관리자 Sync Agent 관리)
/api/spam-filter   → routes/spam-filter.ts (스팸필터 테스트 - 발송요청, 수신리포트, 이력, 디바이스)
```

★ 슈퍼관리자(sys.hanjullo.com) / 고객사관리자(app.hanjul.ai) / 서비스사용자(hanjul.ai) 접속주소 완전 분리 완료

---

## 7) 핵심 비즈니스 로직

### 7-1. 데이터 정규화 (utils/normalize.ts)

고객사별 DB 형식 차이를 흡수하는 핵심 레이어. 참조 파일: ai.ts, customers.ts, campaigns.ts, upload.ts

**역할 3가지:**
1. **값 정규화** — 어떤 형태로 들어오든 표준값으로 통일
   - 성별: 남/남자/male/man/1 → 'M' | 등급: vip/VIP고객/V → 'VIP'
   - 지역: 서울시/서울특별시/Seoul → '서울' | 전화번호: +82-10-1234-5678 → '01012345678'
   - 금액: ₩1,000원 → 1000 | 날짜: 20240101, 2024.01.01 → '2024-01-01'
2. **필드명 매핑** — `normalizeCustomerRecord()`에서 다양한 컬럼명을 표준 필드로 통일
   - raw.mobile / raw.phone_number / raw.tel → phone
   - raw.sex / raw.성별 → gender | raw.등급 / raw.membership → grade
3. **필터 빌더** — DB에 어떤 형식으로 저장돼 있든 잡아내는 SQL 조건 생성
   - `buildGenderFilter('M')` → WHERE gender = ANY(['M','m','남','남자','male'...])

> standard_fields(49개) + normalize.ts + upload AI매핑 조합으로 field_mappings 별도 UI 불필요.

### 7-2. 선불/후불 요금제 시스템

**개요:**
- **후불(postpaid)**: 기본값. 제한 없이 발송, 월말 정산 (기존 방식)
- **선불(prepaid)**: 잔액 충전 후 사용, 발송 시 atomic 차감, 실패 시 환불

**단가 체계:**
- companies.cost_per_sms/lms/mms/kakao → **VAT 포함 금액** 저장
- 프론트엔드: 단가 × 건수로 표시
- PDF 거래내역서만: 총액 ÷ 1.1로 공급가액/부가세 분리

**발송 시 차감 흐름 (campaigns.ts):**
1. `prepaidDeduct()` → billing_type 확인 → postpaid면 즉시 pass
2. 필요금액 = 건수 × VAT포함단가
3. Atomic 차감: `UPDATE companies SET balance = balance - $1 WHERE balance >= $1`
4. 성공 → balance_transactions 기록 / 실패 → 402 응답 (insufficientBalance)
5. 발송 결과 sync 시 실패 건수 → `prepaidRefund()` 환불 (중복 방지 내장)

**통합 포인트 (8곳):**
- POST /test-send: 테스트 발송 전 잔액 체크
- POST /:id/send: AI 캠페인 발송 전 차감
- POST /direct-send: 직접발송 전 차감
- POST /sync-results: 결과 동기화 시 실패분 환불 (campaign_runs/direct 모두)
- POST /:id/cancel: 예약 취소 시 대기 건수 전액 환불
- GET /: 목록 조회 시 완료 캠페인 자동 환불 체크

**슈퍼관리자 API:**
- PATCH /api/admin/companies/:id/billing-type → 후불↔선불 전환
- POST /api/admin/companies/:id/balance-adjust → 수동 충전/차감 (사유 필수)
- GET /api/admin/companies/:id/balance-transactions → 회사별 이력
- GET /api/admin/balance-overview → 전체 선불 고객사 잔액 현황

**서비스 사용자 API:**
- GET /api/balance → 잔액 + billing_type + 단가 조회
- GET /api/balance/transactions → 변동 이력 (페이지네이션, 타입/날짜 필터)
- GET /api/balance/summary → 월별 충전/차감/환불 요약

---

## 8) 📲 진행 예정 작업 (TODO)

### 🔴 미해결 — 즉시 처리 필요
- [ ] **8차 버그 2단계 실동작 검증** — 13건 1단계 통과 완료. 직원 실서비스 테스트 후 Closed 처리 (→ `BUGS.md` 참조)

### 대시보드 리팩토링 Phase 3 (추후)
- [ ] 직접 타겟 설정 모달 분리 (578줄, state 30+개 직접 참조)
- [ ] 직접 타겟 발송 모달 분리 (1,888줄, handler 10+개 깊은 결합, 전용 세션 필요)

### 대시보드 고객활동현황 백엔드 연동
- [x] 수신거부 수 stats에 포함 (unsubscribe_count 추가 완료)
- [x] 프론트엔드 수신거부 `-` → 실제 데이터 연결 완료
- [ ] stats API 확장: 이번 달 신규가입, 30일 내 구매, 90일+ 미구매, 이번 달 수신거부, 이번 달 재구매

### AI 맞춤한줄 Phase 2 (발송 연결)
- [ ] 발송 확정 → 타겟 선택 방식 결정 (옵션 A/B/C 중 선택)
- [ ] AiCampaignSendModal 연결
- [ ] 전체 통합 테스트 (실제 발송)

### 카카오 알림톡 템플릿 관리 (Humuson API v2.1.1)
- [ ] 고객사 관리자(app.hanjul.ai) 템플릿 CRUD + 검수 프로세스 + 발신프로필 조회 + 관리 UI
- [ ] 슈퍼관리자(sys.hanjullo.com) 고객사별 Humuson 연동 설정 (humuson_user_id, uuid)
- [ ] 서비스 사용자(hanjul.ai) 캠페인 발송 시 APR 상태 템플릿만 선택
- [ ] 기술: 백엔드 프록시 /api/kakao-templates/*, DB kakao_templates 확장, 상태 전이 규칙
- [ ] Phase 2: 이미지 업로드, 알림 수신자 관리, 발신프로필 그룹

### 080 수신거부 (⏸️ 나래인터넷 응답 대기)
- [x] 콜백 엔드포인트 구현 (토큰 인증, 고객사별 080번호 자동 매칭)
- [x] 서버 .env OPT_OUT_080_TOKEN 설정 + PM2 재시작
- [x] Nginx 080callback 경로 나래 IP 화이트리스트 적용 (121.156.104.161~165, 183.98.207.13)
- [x] 나래인터넷에 콜백 URL + 토큰 키값 전달 (직원 경유)
- [ ] 나래 응답 후: 실제 080 ARS 수신거부 테스트 (080-719-6700)
- [ ] 기존 누적 수신거부 목록 초기 동기화 (벌크 API 또는 엑셀)
- [ ] 수신거부 관리 프론트엔드 고도화 (검색 UX, 일괄삭제, 통계 등)

### 선불 요금제 Phase 1-B~2
- [ ] Phase 1-B: KCP PG 연동 (카드결제만, 가상계좌 제외)
- [x] 이용약관 개정: 가상계좌 제거, 선불충전 제9조 신설, 환불정책 제12조 강화 (KCP 심사 요건)
- [ ] Phase 2: 입금감지 API 자동화

### Sync Agent
- [x] Sync Agent 코어 완성 (비토 v1.3.0 개발 완료 — 설정 편집 + 테이블별 timestamp 분리)
- [x] 서버 DDL 수정: sync_logs 컬럼 추가 + sync_releases 테이블 생성 + sync_agents config 컬럼 (2026-02-25)
- [x] sync.ts version API checksum 필드 포함 확인 (2026-02-25)
- [x] `/api/sync/*` rate limit — IP 브루트포스 차단 + 회사별 요청 제한 (2026-02-25)
- [x] 고객사별 동시 full sync 제한 — activeSyncs + 429 + 30분 자동 정리 (2026-02-25)
- [x] 매뉴얼 최종 점검 — 내부 URL/코드명/API경로 노출 제거 확인 (2026-02-25)
- [ ] sync_releases에 v1.3.0 릴리스 레코드 등록 (비토 최종 빌드 후)

### 보안
- [x] 소스 보호: 우클릭/F12/개발자도구/드래그 차단 (3개 도메인 전체 적용)
- [ ] 프론트엔드 난독화 (vite-plugin-obfuscator, 런칭 직전 적용)
- [ ] 슈퍼관리자 IP 화이트리스트 설정
- [ ] www.hanjul.ai SSL 인증서 추가 (DNS 전파 후)
- [ ] VPN 접근 제한 검토

### 브랜딩
- [ ] 파비콘/OG 이미지 적용

### 기능 확장
- [ ] 카카오톡 브랜드메시지/알림톡 연동 (단가 세분화: 브랜드메시지/알림톡 별도)
- [ ] PDF 승인 기능 (이메일 링크)
- [ ] 고객사 관리자 기능 세분화 (슈퍼관리자 기능 축소 버전)
- [x] 추천 템플릿 → 빠른 발송 예시 4개로 전환 (클릭 시 AI 한줄로 자동 실행)

### 인비토AI (메시징 특화 모델)
- [x] ai_training_logs 테이블 설계 (Claude+GPT+Gemini 3자 토론 확정)
- [x] training-logger.ts 유틸 (마스킹, 메타계산, 적재, 성과 업데이트)
- [x] campaigns.ts 연결 (AI발송/직접발송/결과동기화)
- [ ] 이용약관에 비식별 데이터 활용 조항 추가
- [ ] 데이터 충분히 축적 후 모델 학습 파이프라인 설계

---

## 9) DECISION LOG (ADR Index)
> 항목이 10개를 초과하면 오래된 항목은 아카이브로 이동하고 1줄 요약만 남긴다.

| ID | 날짜 | 결정 | 근거 |
|----|------|------|------|
| D14 | 02-24 | 직원 버그리포트 7차 3세션 분할 + 동적 필드 시스템 전환 결정 | 근본 원인: 하드코딩 필드 화이트리스트 |
| D15 | 02-25 | ~~LMS 제목 머지 치환 구현~~ → D28로 번복 | 8차에서 다경로 불일치 유발 확인 |
| D16 | 02-25 | 스팸필터 테스트 과금=일반 단가 동일 적용 | cost_per_sms/lms 단가 그대로 사용 |
| D17 | 02-25 | 테스트 통계 응답 구조 확장 (하위호환) | 기존 stats/list 유지 + managerStats/spamFilterStats 추가 |
| D18 | 02-25 | 정산 billing.ts 자체 헬퍼 함수 구현 (순환참조 방지) | campaigns.ts import 시 순환참조 |
| D19 | 02-25 | 요금제 미사용 시 기능 제한: subscription_status 필드 추가 | plan_id+trial_expires_at보다 확장성 우수 |
| D20 | 02-25 | AI 분석 요금제별 차별화: 프로=기본, 비즈니스=고급 | API 토큰 소모량으로 원가 차별화 |
| D21 | 02-25 | isSubscriptionLocked를 planInfo 기반 실시간 판별로 전환 | 재로그인 전까지 잠금 안 풀리는 문제 |
| D22 | 02-25 | 스팸필터 잠금은 직접발송 영역만 적용 | 상위 잠금 있으면 하위 중복 불필요 |
| D23 | 02-25 | preview API none일 때 백엔드에서 상세 필드 제거 반환 | DevTools 노출 방지 |
| D24 | 02-25 | run API 세션1에서 데이터수집까지 완전 구현 | 세션 분리 효율 |
| D25 | 02-25 | PDF 라이브러리 pdfkit 선택 | billing.ts와 동일 패턴 |
| D26 | 02-25 | 분석 결과 DB 캐싱 (24시간 유효) | Claude API 비용 절약 |
| D27 | 02-25 | 비즈니스 멀티턴 5~8회→3회 최적화 | 토큰 효율+응답 속도 |
| D28 | 02-25 | 제목 머지 완전 제거 — 본문만 개인화, 제목은 고정 텍스트 | 8차: 5개 경로 불일치로 3회 반복 재발. 안정성 우선 |
| D29 | 02-25 | 8차부터 "5개 경로 전수 점검 매트릭스" 의무화 | 6~8차 재발 근본 원인=1경로만 패치 |
| D30 | 02-25 | 직접발송 즉시 completed→sending 전환 | #5: MySQL INSERT 직후 completed 설정 → Agent 미처리 상태에서 "완료" 표시. sync-results가 Agent 완료 후 전환 |

**아카이브:** D1-AI발송2분기(02-22) | D2-브리핑방식(02-22) | D3-개인화필드체크박스(02-22) | D4-textarea제거(02-22) | D5-별도컴포넌트분리(02-22) | D6-대시보드레이아웃(02-22) | D7-헤더탭스타일(02-23) | D8-AUTO/PRO뱃지(02-23) | D9-캘린더상태기준(02-23) | D10-6차세션분할(02-23) | D11-KCP전환(02-23) | D12-이용약관(02-23) | D13-수신거부SoT(02-23) | D-대시보드모달분리(02-23): 8,039줄→4,964줄

---

## 10) ASSUMPTION LEDGER (가정 목록)

(아직 없음)

---

## 11) RISK REGISTER (리스크 목록)
| ID | 리스크 | 확률(1-5) | 영향(1-5) | 점수 | 대응 |
|----|--------|-----------|-----------|------|------|
| R1 | TypeScript 타입 에러 배포 → 서버 크래시 | 2 | 5 | 10 | 배포 전 tsc --noEmit 필수 체크 |
| R2 | DB 파괴적 작업 시 데이터 유실 | 2 | 5 | 10 | pg_dump 백업 후 작업, 트랜잭션 활용 |
| R3 | QTmsg sendreq_time UTC/KST 혼동 | 3 | 4 | 12 | 반드시 MySQL NOW() 사용 |
| R4 | 라인그룹 미설정 고객사 → 전체 라인 폴백 오발송 | 1 | 5 | 5 | ✅ 해결: 이중 방어 적용 — 1차 발송 차단(LINE_GROUP_NOT_SET) + 2차 BULK_ONLY_TABLES 폴백(10,11 제외) |
| R5 | QTmsg LIVE→LOG 이동 후 결과 조회 불가 | 1 | 4 | 4 | ✅ 해결: getCompanySmsTablesWithLogs()로 LIVE+LOG 통합 조회 |
| R6 | 스팸필터 동시 테스트 시 결과 충돌 (테스트폰 3대 공유) | 1 | 4 | 4 | ✅ 해결: SHA-256 해시 세션 격리 + fallback 제거 + user_id 기준 active 체크 (7차 세션2) |
| R7 | 하드코딩 필드로 인한 반복 버그 재발 | 5 | 3 | 15 | ✅ 해결: 동적 필드 시스템 전환 완료 (7차 세션1) |
| R8 | recount-target companyId undefined → 타겟 0명 | 3 | 4 | 12 | ✅ 해결: snake_case→camelCase 수정 + WHERE 조건 통일 (7차 세션3) |
| R9 | 정산 SMSQ_SEND 단일테이블 조회 → 멀티Agent 환경에서 0건 집계 | 3 | 4 | 12 | ✅ 해결: 회사별 라인그룹 멀티테이블 + LOG 테이블 통합 조회 (billing.ts 자체 헬퍼) |
| R10 | 로그인 캐시 기반 상태 판별 → DB 변경 후 재로그인 전까지 미반영 | 3 | 4 | 12 | ✅ 해결: isSubscriptionLocked를 planInfo(my-plan API) 실시간 판별로 전환 |
| R11 | 발송 5개 경로 수정 불일치 → 동일 버그 반복 재발 | 2 | 4 | 8 | ✅ 해결: 8차 3세션 전수 점검 매트릭스 완료. campaigns.ts+spam-filter.ts+services/ai.ts 전체 정비 (D29) |
| R12 | AI 프롬프트 무시 → 미허용 변수/바이트 초과 생성 | 3 | 3 | 9 | 대응: validatePersonalizationVars() strip + calculateKoreanBytes 이중 방어. AI 미리보기에도 적용 |
| R13 | AI 문안 선택 인덱스 불일치 → 다른 문안 발송 | 3 | 5 | 15 | ✅ 해결: #12 근본 원인=defaultChecked 비제어 컴포넌트. checked 제어 컴포넌트 전환 + 재생성 시 setSelectedAiMsgIdx(0) + message_template 저장 |
---

## 12) ✅ DONE LOG (완료 기록)
> 항목이 10개를 초과하면 오래된 항목은 아카이브로 이동하고 1줄 요약만 남긴다.
> 상세 변경 이력은 Git 커밋 히스토리 참고.

| 날짜 | 완료 항목 |
|------|----------|
| 02-25 | **8차 버그리포트 13건 전체 수정완료 + 1단계 코드 검증 통과 (3세션+추가세션+2차전수점검).** Blocker 2건 + Critical 3건 + Major 5건 + Minor 2건. 수정파일 10개. CampaignSuccessModal 완료 + B8-12 인덱스 초기화 보완. 2단계 실동작 검증 대기. **상세 → BUGS.md** |
| 02-25 | AI 분석 세션3+4 완료 (프롬프트+캐싱+PDF+데모데이터): ① analysis_results 캐싱 테이블 DDL(UNIQUE+인덱스), ② 프로용 프롬프트(집계값, 1회 호출, 인사이트 6개), 비즈니스용 멀티턴(3회, 인사이트 11개), ③ Claude 호출 로직(재시도 2회, temperature 0.3), ④ 캐시 UPSERT(24시간 유효, forceRefresh), ⑤ PDF(pdfkit, 인디고 커버+목차+인사이트 카테고리8색+자동페이지넘김+푸터), ⑥ 데모데이터: 유호윤 고객사에 고객30만+캠페인500+구매5만+수신거부3천 INSERT, 요금제 ai_analysis_level='basic'. 수정: analysis.ts(524→1,121줄). 신규DDL: analysis_results |
| 02-25 | AI 분석 세션2 완료 (프론트엔드 AnalysisModal+연결): ① DashboardHeader.tsx — Sparkles 아이콘+AI 분석 메뉴 추가(발송결과↔수신거부 사이, gold+emphasized), onAnalysis prop, 버튼에 icon 지원(flex+gap), ② Dashboard.tsx — PlanInfo에 ai_analysis_level 추가, showAnalysis state, AnalysisModal import+렌더링(planInfo?.ai_analysis_level 전달), ③ AnalysisModal.tsx 신규 생성(530줄) — 베이직 프리뷰(실제 데이터 4카드+프로 블러+AI 텍스트 그라데이션 페이드아웃+비즈니스 강한 블러+업그레이드 CTA), 프로 분석(기간 선택 30d/90d/custom+분석 실행+4단계 로딩 애니메이션+인사이트 카드 아코디언+비즈니스 카드 블러 업셀+PDF 다운로드), 비즈니스 분석(전체 카드 언락). 모달 디자인: animate-in+fade-up, dark 헤더, 카테고리별 색상 10종. 수정: DashboardHeader.tsx, Dashboard.tsx. 신규: AnalysisModal.tsx |
| 02-25 | AI 분석 세션1 완료 (DDL+백엔드API): ① plans.ai_analysis_level 컬럼 추가(none/basic/advanced, plan_code 대문자 주의), ② companies.ts my-plan API에 p.ai_analysis_level 반환 추가, ③ analysis.ts 신규 생성 — GET /preview(none:기본4개만 반환+상세필드 제거 보안, basic/advanced:전체11개), POST /run(기간별 데이터수집 — basic:집계7종, advanced:+로우4종 총11종, Claude 호출은 세션3), GET /pdf(요금제체크+501 뼈대, PDF 생성은 세션3), ④ app.ts 라우트 등록(/api/analysis). 수정: companies.ts, app.ts. 신규: analysis.ts |
| 02-25 | Task A 요금제 기능 제한 구현 완료: ① DDL subscription_status varchar(20) DEFAULT 'trial' + 마이그레이션 SQL, ② auth.ts 로그인 쿼리+응답에 subscriptionStatus 포함, ③ Dashboard.tsx isSubscriptionLocked 헬퍼+10군데 잠금(AI추천발송/직접타겟/DB업로드/최근캠페인/발송예시/고객인사이트/예약대기/고객DB조회)+opacity+🔒아이콘, ④ SubscriptionLockModal.tsx 신규(예쁜 커스텀 모달, Lock+Crown 아이콘, 요금제안내 링크), ⑤ AdminDashboard.tsx 구독상태 드롭다운(trial/active/expired/suspended)+안내문구, ⑥ admin.ts PUT API $31 subscription_status 추가. 수정 5파일+신규 1파일 |
| 02-25 | Task A 스팸필터 잠금 + 구독 실시간 반영 완료: ① companies.ts my-plan API에 monthly_price+subscription_status 반환 추가, ② Dashboard.tsx isSpamFilterLocked(15만원 미만)+직접발송 스팸필터 버튼 잠금, ③ SpamFilterLockModal.tsx 신규(indigo, ShieldOff), ④ isSubscriptionLocked를 planInfo 기반 실시간 판별로 전환(로그인 캐시→DB 실시간), ⑤ 요금제 승인 시 subscription_status 자동 'active'(admin.ts), ⑥ PlanApprovalModal.tsx 신규+plan-request/status API 연동(승인 알림+confirm). 수정: companies.ts, Dashboard.tsx, admin.ts. 신규: SpamFilterLockModal.tsx, PlanApprovalModal.tsx. Task A 전체 완료 |
| 02-25 | 요금제 기능 제한 + AI 분석 기능 설계 의논: ① subscription_status 필드 추가 결정(trial/active/expired/suspended), 무료 종료 후 대시보드 잠금+직접발송/탑메뉴/충전 허용, ② AI 분석 요금제별 차별화 설계 — 프로(기본, 집계값, 1~2회 호출, 기본PDF 1~2p) / 비즈니스(고급, 로우데이터, 5~8회 호출, 상세PDF 5~10p, 세그먼트+이탈예측+ROI+액션제안). CURRENT_TASK 반영 완료 |
| 02-25 | Sync Agent 서버 보안 구현:: ① rate limit — ipRateLimit(인증 실패 IP 10회/분 차단)+companyRateLimit(회사 60회/분) 인메모리 Map+5분 정리, ② 동시 full sync 제한 — activeSyncs Map+429+finally 해제+30분 stuck 자동 정리, ③ version API checksum 포함 확인. 매뉴얼 최종 점검: sys.hanjullo.com 삭제+Target-UP 삭제+API 경로 삭제 확인 완료. 수정: sync.ts |
| 02-25 | 정산 멀티테이블+스팸필터 통합: ① billing.ts SMSQ_SEND 단일→회사별 라인그룹 멀티테이블 전환(getBillingCompanyTables+smsAggByDateType 자체 헬퍼, campaigns.ts 순환참조 방지), ② LOG 테이블(SMSQ_SEND_X_YYYYMM) 정산기간별 자동탐색+통합조회(getTablesForBillingPeriod), ③ 스팸필터 테스트 PostgreSQL 집계 추가(spam_filter_tests+results JOIN), ④ DDL: billing_invoices에 spam_filter_sms/lms_count+unit_price 4컬럼 추가, ⑤ preview API spam 섹션 추가, ⑥ PDF 스팸필터행 배경색(#fef3c7)+일별상세 SPAM_SMS/SPAM_LMS 라벨, ⑦ 메일 HTML 스팸필터 비용 표시. 수정 파일: billing.ts (1450→1616줄) |
| 02-25 | 발송 통계 고도화 + 스팸필터 테스트 통합: ① 채널통합조회 타입컬럼 제거(채널뱃지 중복), ② 테스트 통계 스팸필터 합산(담당자 MySQL+스팸필터 PostgreSQL, 3곳: campaigns.ts/manage-stats.ts/admin.ts), ③ 고객사관리자 발송통계에 비용 표시(요약카드+상세 사용자별), ④ 슈퍼관리자 통계에 testSummary+testDetail 추가, ⑤ ResultsModal 테스트탭 3카드(전체/담당자/스팸필터)+스팸필터 이력 리스트("준비중" 제거), ⑥ 테스트 이력 페이징 10건(ResultsModal+StatsTab 양쪽). 수정 파일: campaigns.ts, manage-stats.ts, admin.ts, ResultsModal.tsx, StatsTab.tsx(company-frontend), StatsTab.tsx(frontend/admin) |
| 02-25 | 직원 버그리포트 7차 세션3 완료 (2건) + 7차 전체 완료: ① LMS 제목 머지 치환 — AI발송(personalizedSubject+fieldMappings 동시치환+잔여변수 제거), 직접발송(finalSubject+replace 체인). 제목에도 %이름% 등 개인화 변수 정상 치환(#9). ② recount-target 근본 수정 — user.company_id→req.user?.companyId(undefined 해결), WHERE 조건 recommend-target과 통일(is_active+sms_opt_in+NOT EXISTS unsubscribes), storeFilter 추가(#6). 수정 파일: campaigns.ts, ai.ts |
| 02-25 | 직원 버그리포트 7차 세션2 완료 (2건): 스팸필터 동시성 해결. ① 60초 쿨다운 완전 제거→완료 즉시 재테스트 버튼(#3), ② SHA-256 해시 세션 격리+fallback 제거+user_id 기준 active 체크(#4). DB: spam_filter_tests.message_hash varchar(32) 컬럼+인덱스 2개 추가. 수정 파일: spam-filter.ts, SpamFilterTestModal.tsx |
| 02-25 | 8차 버그리포트 분석+세션설계 완료. 제목 머지 완전 제거(D28), 전수 점검 매트릭스 의무화(D29). **상세 → BUGS.md** |
| 02-24 | 직원 버그리포트 7차 세션1 완료 (6건): 동적 필드 시스템 전환. ① enabled-fields API 전면 개편(customer_field_definitions+custom_fields JSONB+실제 고객 샘플 반환), ② PERSONALIZATION_FIELDS 화이트리스트 삭제→전체 필드 노출(#5), ③ normalizeGrade() 제거→원본값 저장(#7), ④ SAMPLE_DATA→실제 DB 샘플(#8), ⑤ 수신번호 phone 고정(#2), ⑥ 채널 message_type 기반 표시(#1), ⑦ 고객DB 동적 컬럼+가로 스크롤. 수정 파일: normalize.ts, customers.ts, services/ai.ts, routes/ai.ts, AiCustomSendFlow.tsx, CustomerDBModal.tsx, ResultsModal.tsx, Dashboard.tsx |
| 02-24 | 요금제 현황 게이지바 적용: "정상 이용 중" 텍스트→고객 수 프로그레스바(9,999/100,000명 10%) 전환. 80%미만 녹색, 80~95% 주황, 95%+ 빨강. max_customers 없는 요금제는 "정상 이용 중" 폴백. PlanInfo 인터페이스 확장(max_customers, current_customers). 수정: Dashboard.tsx |
| 02-24 | 소스 보호 적용: 우클릭/F12/Ctrl+Shift+I,J,C/Ctrl+U 차단 + 텍스트 드래그 선택 차단 (input/textarea 제외). hanjul.ai, app.hanjul.ai, sys.hanjullo.com 전체 적용. 프론트엔드 난독화(vite-plugin-obfuscator)는 런칭 직전 적용 예정. 수정: packages/frontend/index.html, packages/company-frontend/index.html |
| 02-24 | 어드민/고객사 통계 발송수량 전면 수정: ① campaign_runs→campaigns 직접 조회로 전환(직접발송 누락 해결), ② KST 날짜 필터 적용(AT TIME ZONE), ③ 상태 필터 화이트→블랙리스트 통일(NOT IN cancelled/draft), ④ 월별 조회 날짜 자동 확장(startDate→월1일, endDate→월말일). Agent 대량발송(1) 라인그룹 정상 발송 확인(1,001건→LOG 이동 완료). 수정: routes/manage-stats.ts, routes/admin.ts |
| 02-24 | 080 수신거부 운영 연동: 서버 .env OPT_OUT_080_TOKEN 설정, Nginx 080callback 나래 IP 화이트리스트(121.156.104.161~165, 183.98.207.13) 적용, 나래에 콜백 URL+토큰 전달 완료(직원 경유). 나래 응답 대기 중. 수정: Nginx sites-available/targetup, .env |
| 02-24 | 대시보드 빠른 발송 예시 전환: 추천 템플릿(8개 모달)→빠른 발송 예시(4개) 전환. 클릭 시 AiSendTypeModal 자동 오픈+AI 한줄로에 프롬프트 자동 입력. AiSendTypeModal에 initialPrompt prop 추가. 수정: RecommendTemplateModal.tsx, AiSendTypeModal.tsx, Dashboard.tsx. 서울형 R&D AI+X 산학협력 과제 제안서(워드) 작성 — 융복합산업R&D 인공지능 AI+X(2억/1년), 대학 7곳 제안 발송 |
| 02-24 | QTmsg 결과 조회 LOG 테이블 통합: Agent 처리 완료(rsv1=5) 시 LIVE→LOG(SMSQ_SEND_X_YYYYMM) 이동하여 결과 조회 불가 버그 수정. getCompanySmsTablesWithLogs() 헬퍼 추가(LIVE+현재월+전월 LOG 통합, 5분 캐시). 적용: sync-results, 캠페인 인라인싱크, results.ts(상세/메시지/CSV). 유령 예약 1건(42f596ba) + 취소 캠페인 MySQL 잔여 3,032건 수동 정리. 수정: campaigns.ts, results.ts |
| 02-23 | 라인그룹 미설정 발송 차단 (이중 방어): 1차 — send/direct-send API 진입 시 hasCompanyLineGroup() 체크→400 차단, 2차 — BULK_ONLY_TABLES 폴백(10,11 제외), 테스트→SMSQ_SEND_10 고정, 인증→SMSQ_SEND_11 고정. LineGroupErrorModal 예쁜 모달 추가. 수정: campaigns.ts, Dashboard.tsx, LineGroupErrorModal.tsx(신규) |
| 02-23 | 이용약관 개정 배포: 가상계좌 제거(제8조), 선불충전 제9조 신설(3개월 유효+소멸), 환불정책 제12조 전면개정(3개월 환불제한+PG수수료+회사귀책 전액환불). KCP 심사용. 버그리포트 양식 엑셀 제작 (직원 배포용) |
| 02-23 | 직원 버그리포트 6차 세션2 완료 (5건): 예약대기 LMS제목/회신번호+문안수정 제목필수(#2), 시간변경 과거허용차단+유령예약 강제취소(#3), 캘린더 상태판정 completed/failed 정리(#5), 수신거부 건수 stats+대시보드 연결(#6), 고객DB조회 거부필터 smsOptIn=false 누락수정(#7). 수정 파일: ScheduledCampaignModal.tsx, CalendarModal.tsx, Dashboard.tsx, CustomerDBModal.tsx, campaigns.ts, customers.ts |
| 02-23 | 배포 자동화 스크립트: PowerShell 프로필에 tp-push(타입체크→커밋→푸시), tp-deploy(서버 풀→리스타트), tp-deploy-full(서버 풀→프론트빌드→리스타트) 함수 등록. 메시지 미입력 시 자동 타임스탬프 커밋 |
| 02-23 | 수신거부 시스템 통합 정비: ① stats 수신거부 카운트 sms_opt_in=false OR unsubscribes 이중판정, ② 업로드/Sync 시 sms_opt_in=false→unsubscribes 자동등록(source: db_upload/sync), ③ 수신거부 조회 user_id→company_id 기준 전환(DISTINCT ON phone), ④ 삭제 시 customers.sms_opt_in=true 복원, ⑤ 프론트 삭제모달 커스텀+source 뱃지 6종, ⑥ idx_unsubscribes_company_phone 인덱스 추가, ⑦ 기존 sms_opt_in=false 4,172건 마이그레이션. 수정: customers.ts, upload.ts, sync.ts, unsubscribes.ts, Unsubscribes.tsx |
| 02-23 | 직원 버그리포트 6차 세션1 완료 (6건): AI 맞춤한줄 변수강화(#1), SMS 바이트체크(#4), 광고토글+MMS지원(#8), gender중복필터수정→타겟0명해결(#9), 회신번호 전화번호표시(#10), 개별회신번호 조건부노출(#11). 수정 파일: AiCustomSendFlow.tsx, AiCampaignSendModal.tsx, services/ai.ts, routes/ai.ts. 핵심 발견: routes/ai.ts gender 필터 중복적용이 타겟 0명의 근본 원인 |
| 02-23 | 대시보드 모달 분리 Session 2: 11개 컴포넌트 추출. Dashboard.tsx 7,056줄→4,964줄. TypeScript 타입체크 통과, 서버 배포 완료 |
| 02-23 | 대시보드 헤더 탭스타일 리뉴얼 (DashboardHeader 컴포넌트 분리, 아이콘 제거, 녹색/금색 번갈아 텍스트+밑줄 애니메이션, 로그아웃 회색) + AI 발송 뱃지 기존/NEW → AUTO/PRO 변경 |
| 02-22 | 대시보드 레이아웃 전면 개편: 좌60%/우40% 구조, 고객현황 보강(수신거부+활동현황5지표), 요금제 카드 개선, 하단4카드, 녹색/노란색 테두리, 우측버튼 폰트확대 |
| 02-22 | AI 맞춤한줄 Phase 1 시작: AiSendTypeModal 분기 모달 + DashboardPage textarea 제거/연결 + AI-CUSTOM-SEND.md 작업문서 |
| 02-21 | 수신거부 미반영 버그 수정 (대시보드/DB조회/상세/필터/직접타겟 전체 unsubscribes 통합) + AI 080번호 COALESCE 적용 |
| 02-20 | 스팸필터 테스트 시스템 완성 (3대 SMS/LMS 수신, 15초 폴링, 로그 테이블 양쪽 조회) |
| 02-19 | 업로드 안정화 (BATCH 500, 백그라운드, 11,228건 전량 성공) + customers UNIQUE 키 변경 |
| 02-19 | 수신거부 user_id 전환 + 브랜드/매장 필터 전체 통합 + 직원 버그리포트 5차 |

**아카이브 (02-19 이전 요약):**
- ~02-19: 스팸필터 판정 고도화 + 스팸한줄 앱 LMS + 080치환 제거 + 타겟직접발송 버그 수정 + AI 학습 데이터 수집 시스템
- ~02-13: AI 캠페인확정 모달 분리 + AI 메시지 선택 인덱스 수정 + 스팸필터 테스트 시스템 (DB + 백엔드 + Android 앱)
- ~02-12: 발송 라인그룹 시스템 (Agent 총 11개) + MMS 이미지 첨부 + 충전 관리 통합 뷰 + 직원 버그리포트 2~4차
- ~02-11: Sync Agent Phase 2 + 보안 강화 + 직원 버그리포트 1차 + 로고 적용 + SMS 바이트 처리
- ~02-10: 서버 인프라 전체 배포, 도메인 3분리, 법률/규정, 핵심 기능 완성, 슈퍼관리자·고객사관리자 대시보드, 정산 시스템, QTmsg Agent 5개, Sync Agent Phase 1, 선불/후불 요금제 Phase 1-A
