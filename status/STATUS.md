# 한줄로 (Target-UP) — 프로젝트 운영 문서

> **관련 문서:** DB 스키마 → `SCHEMA.md` | 운영/인프라 → `OPS.md`
> **SoT(진실의 원천):** 이 문서 + CURRENT_TASK. 대화 중 가정은 여기에 반영되기 전까지 "임시"다.

---

## 0) 사용법
1. 새 대화 시작 시 이 문서를 기준(SoT)으로 삼는다.
2. 작업 요청 시 Harold님이 `CURRENT_TASK`를 갱신하거나 구두 지시한다.
3. AI는 모든 응답에서 **(A) 현황 파악 → (B) 설계안/방향 제시 → (C) Harold님 컨펌 → (D) 구현** 순서를 유지한다.
4. DB 스키마 확인 필요 시 → `SCHEMA.md` 참조
5. 서버/접속/배포 정보 필요 시 → `OPS.md` 참조

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
> **배경:** 어드민/고객사 통계 발송수량 조회 미작동

---

### 현재 목표: (완료 — 다음 작업 대기)

이전 작업: 어드민 통계 + 고객사 통계 발송수량 조회 수정 → ✅ 완료

---

### ✅ 완료: 직원 버그리포트 6차 수정 (전체 11건)

#### 세션 1 완료: AI 맞춤한줄 고도화 + 회신번호 UI (6건)

> **수정 파일 4개:**
> - `packages/frontend/src/components/AiCustomSendFlow.tsx` — 완성 파일 교체
> - `packages/frontend/src/components/AiCampaignSendModal.tsx` — 완성 파일 교체
> - `packages/backend/src/services/ai.ts` — 완성 파일 교체
> - `packages/backend/src/routes/ai.ts` — 완성 파일 교체

- ✅ 버그 #1 — AI 맞춤한줄 개인화 변수 오류 (AI 프롬프트 변수 제한 강화 + 미허용 변수 strip)
- ✅ 버그 #4 — SMS AI 문구 90바이트 초과 (calculateKoreanBytes + 프론트 경고/차단)
- ✅ 버그 #8 — AI 맞춤한줄 광고표기 고정 + MMS 누락 (isAd 토글 + MMS 옵션 추가)
- ✅ 버그 #9 — AI 맞춤한줄 타겟 추출 0명 (gender 중복 필터 제거 + recount-target)
- ✅ 버그 #10 — 회신번호 드롭다운 매장명만 표시 (전화번호(매장명) 형식)
- ✅ 버그 #11 — 개별회신번호 1건인데 선택 허용 (2건 이상일 때만 노출)

#### 세션 2 완료: 예약대기 + 수신거부 + 발송/캘린더 (5건)

> **수정 파일 6개:**
> - `packages/frontend/src/components/ScheduledCampaignModal.tsx`
> - `packages/frontend/src/components/CalendarModal.tsx`
> - `packages/frontend/src/components/Dashboard.tsx`
> - `packages/frontend/src/components/CustomerDBModal.tsx`
> - `packages/backend/src/routes/campaigns.ts`
> - `packages/backend/src/routes/customers.ts`

- ✅ 버그 #2 — 예약대기 LMS 제목/회신번호 미표시 + 문안수정 제목 삭제 무시
  - 프론트: 상세 영역에 📋제목, 📞회신번호 표시. 문안수정 시 LMS/MMS 제목 빈칸 차단
  - 백엔드: PUT /:id/message에서 LMS/MMS subject 빈 문자열 400 reject
- ✅ 버그 #3 — 예약 시간변경 과거 시간 허용 → 유령 예약
  - 프론트: datetime-local min 속성(현재+15분), 프론트 검증 추가
  - 백엔드: reschedule API 새 시간 < 현재+15분 reject. cancel API 유령 예약(과거시간) 강제 취소 허용
- ✅ 버그 #5 — 캘린더 상태 표기 기준
  - 백엔드: sync-results 상태 판정 → (successCount+failCount)>0이면 'completed'
  - 프론트: 상태 가이드에 '실패' 추가, 완료 캠페인 상세에 성공/실패 건수 인라인 표시
- ✅ 버그 #6 — 대시보드 수신거부 건수 미표시
  - 백엔드: stats 쿼리에 unsubscribe_count 추가 (unsubscribes 테이블 EXISTS)
  - 프론트: Stats 인터페이스 + `-` → 실제 건수 바인딩
- ✅ 버그 #7 — 고객 DB 조회 수신거부 필터 미작동
  - 프론트: CustomerDBModal fetchCustomers에서 smsOptIn='false' 파라미터 전달 누락 수정

---

### 완료 기준 (DoD)
- [x] 통계 쿼리 전면 수정 + 배포 완료
- [x] 월별 조회 날짜 자동 확장 적용
- [x] Agent 발송 정상 동작 확인

---

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
(없음)

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
- [ ] Sync Agent 코어 완성 (로컬 큐, 스케줄러, Heartbeat 남음)

### 보안
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
| D2 | 02-22 | 프로모션 입력 = "브리핑 방식" (자연어 → AI 파싱 → 카드 확인) | 폼은 번거롭고 자유텍스트는 부정확. 말하듯이 쓰면 AI가 구조화해서 보여주는 중간 방식이 최적 |
| D3 | 02-22 | 개인화 필드 = DB 필드 체크박스 선택 방식 | AI에게 명확한 지시 가능, 마케터가 어떤 데이터를 활용하는지 가시적 |
| D4 | 02-22 | 대시보드 textarea 제거 → 분기 모달 내에서 각각 입력 | 각 플로우가 독립적으로 자기 맥락에 맞는 입력창을 가짐 |
| D5 | 02-22 | 신규 코드는 별도 컴포넌트로 분리 (대시보드 최소 수정) | 대시보드 7,800줄, 회귀 리스크 최소화. AiCustomSendFlow.tsx 독립 |
| D6 | 02-22 | 대시보드 좌60%/우40% flex 레이아웃 + 고객활동현황(B+C 융합) | grid-cols-4로는 75:25밖에 안됨. 활동현황=마케터 행동으로 이어지는 핵심 지표 |
| D7 | 02-23 | 대시보드 헤더: 버튼형 → 텍스트 탭 스타일 (아이콘 제거, 녹/금/회 색상) | 홈페이지 탭 스타일 참고, SaaS 고급감 확보 |
| D8 | 02-23 | AI 발송 분기 뱃지: 기존/NEW → AUTO/PRO | 오픈 시 동시 출시이므로 "기존"은 부적절. 간편/정교 성격 구분 |
| D9 | 02-23 | 캘린더 상태 기준: 완료(발송처리됨)/실패(시스템에러)/취소(명시취소) 3단계 | 문자는 실패 건 항상 존재하는 게 정상. 부분성공도 "완료"로 표시, 상세에서 건수 확인 |
| D10 | 02-23 | 직원 버그리포트 6차 수정 2세션 분할: 세션1=맞춤한줄+회신번호(6건), 세션2=예약+수신거부+캘린더(5건) | 파일 의존성 기준 그룹핑. 맞춤한줄이 가장 크고 긴급 |
| D11 | 02-23 | PG사 토스페이먼츠 → KCP 전환, 가상계좌 제외 (카드결제만) | 토스페이먼츠 SMS/LMS/MMS 별도충전 요구 (사업모델 불일치). KCP는 통합잔액 가능. 자체서버 배포 시 가상계좌 불가 |
| D12 | 02-23 | 이용약관 선불충전 3개월 유효+소멸, 환불 3개월 제한 | KCP 심사 요건. 제9조 신설(선불충전), 제12조 전면개정(환불정책) |
| D13 | 02-23 | 수신거부 SoT를 unsubscribes 테이블로 통일 | customers.sms_opt_in=false 분산 → 업로드/Sync 시 unsubscribes 자동등록. 조회도 company_id 기준 전환. 삭제 시 sms_opt_in 복원 |

**아카이브:** D1-AI발송2분기(02-22) | D-대시보드 모달 분리(02-23): 8,039줄→4,964줄, 직접타겟 모달은 결합도 높아 추후 전용 세션

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

---

## 12) ✅ DONE LOG (완료 기록)
> 항목이 10개를 초과하면 오래된 항목은 아카이브로 이동하고 1줄 요약만 남긴다.
> 상세 변경 이력은 Git 커밋 히스토리 참고.

| 날짜 | 완료 항목 |
|------|----------|
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
