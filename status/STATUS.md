# 한줄로 (Target-UP) — 프로젝트 운영 문서

> 관련 문서: DB 스키마 → SCHEMA.md | 운영/인프라 → OPS.md | 버그 추적 → BUGS.md | 확장 로드맵 → SCALING.md
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
- **Docker 컨테이너 재생성 시 포트 바인딩 반드시 `127.0.0.1` 확인.** `0.0.0.0` 바인딩 절대 금지. (2026-02-28 MySQL 랜섬웨어 교훈)

### 2-4. ⚠️ 배포 전 TypeScript 타입 체크 필수
- 상용 서버 배포 코드는 반드시 TypeScript 타입 에러 없이 컴파일 가능해야 함.
- 특히 mysqlQuery 등 외부 라이브러리 반환값 타입 캐스팅 주의.
- **타입 에러 있는 코드 배포 = 서버 크래시 = 서비스 장애** (2026-02-19 장애 교훈)

### 2-5. ⚠️ SCHEMA.md / OPS.md 절대 준수
- **코드는 반드시 SCHEMA.md와 OPS.md에 정의된 구조를 벗어나지 않는다.**
- 새 코드 작성 시 반드시 SCHEMA.md를 먼저 읽고, 컬럼명·타입·관계를 확인한 후 코딩한다.
- **SCHEMA.md에 없는 컬럼명/타입을 코드에서 임의 생성 절대 금지.**
- 하드코딩 매핑(CATEGORY_MAP, CAT_LABELS 등)을 만들지 않는다. standard_fields 테이블과 `standard-field-map.ts` 매핑 레이어가 유일한 기준이다.
- standard_fields.field_key ↔ customers 컬럼 간 매핑은 `standard-field-map.ts` 한 곳에서만 정의한다.
- customers.ts, upload.ts, Dashboard.tsx, normalize.ts, sync.ts 등 모든 파일은 이 매핑 레이어를 import해서 사용한다.
- **"기준은 하나, 입구는 여럿"** — standard_fields = 유일한 기준, normalize.ts = 값 변환, upload/sync = 입구, customers/Dashboard = 출구. 전부 standard-field-map.ts 참조.

### 2-6. 추측성 땜질 금지 / 에러 대응 프로토콜
- 에러가 발생하면 임의로 코드를 덧붙이지 않는다.
- 1단계: 에러 로그 / 재현 절차 / 기대 결과 / 실제 결과를 확인한다.
- 2단계: 원인을 3줄 이내로 요약한다.
- 3단계: 2가지 이상 해결 옵션(장단점/리스크) 제시 후 Harold님 선택을 기다린다.
- 4단계: 선택된 옵션으로 최소 수정 → 회귀 테스트까지 수행한다.

### 2-7. 수정 파일 제공 방식
- 코드 수정 시 **"기존코드 → 새코드"** 형식으로, 파일 내 형태 그대로 복사해서 커서에서 바로 검색 가능하게 제공.
- Harold님이 명시 요청 시에만 완성된 단일 파일 전체로 제공.
- **모든 수정사항(코드, .md 문서 포함)은 수정파일로 제공한다.** 프로젝트 문서(.md)도 수정 시 파일로 제공하여 Harold님이 다운로드 후 교체할 수 있게 한다.

### 2-8. 데이터 정확성
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

### 🔧 D69 — 자동발송 기능 (2026-03-12) — Phase 1 배포 완료 + 모달 개선 진행 중

> **배경:** 메트로시티 요청 — 생일자 자동발송 등 반복 스케줄 설정 기능
> **적용:** 프로 요금제(100만원) 이상
> **설계 문서:** `status/AUTO-SCHEDULE-DESIGN.md`

#### Phase 1 구현 완료 항목
- **DB:** auto_campaigns + auto_campaign_runs 테이블 생성 완료, plans.auto_campaign_enabled + plans.max_auto_campaigns 컬럼 추가 완료
- **백엔드:** routes/auto-campaigns.ts(CRUD 9개 엔드포인트) + utils/auto-campaign-worker.ts(매 1시간 체크 워커) + app.ts 마운트/워커 시작 연결
- **프론트:** DashboardHeader 메뉴 추가('AI 분석'↔'직접발송' 사이) + AutoSendPage.tsx(프로 미만 블러+CTA / 프로 이상 실제 기능) + AutoSendFormModal.tsx(5단계 모달)
- **UX:** AnalysisModal 블러 패턴 적용 — 누구나 메뉴 클릭→페이지 진입→상단 설명+하단 블러+CTA
- **권한:** company_admin + company_user(브랜드담당자) 모두 생성/수정/삭제 가능 (store_code 범위 내)
- **스케줄:** 매월(1~28일)/매주/매일 + 발송 시각 설정. 매월 28일 max (2월 고려)
- **게이팅:** 요금제별 동시 활성 수 제한 — PRO: 5개, BUSINESS: 10개, ENTERPRISE: 무제한
- **실패 정책:** 스킵 + failed 기록 → next_run_at 다음 스케줄로 갱신 (중복 발송 방지)
- **기존 파이프라인 100% 재활용:** customer-filter, sms-queue, messageUtils, unsubscribe-helper, prepaid, campaign-lifecycle, store-scope

#### AutoSendFormModal 개선 (2026-03-12, 배포 대기)
- **버그 수정:** 발신번호 로딩 — `data.callbackNumbers` → `data.numbers` (API 응답 키 불일치 수정)
- **5단계 재구성:** 1.기본정보 → 2.활용필드선택(신규) → 3.스케줄 → 4.메시지 → 5.확인
- **2단계 활용필드선택:** AiCustomSendFlow 패턴 — `/api/customers/enabled-fields` 기반 카테고리별 동적 필드 체크박스. 선택한 필드가 4단계 변수 드롭다운과 AI 문구생성 personalFields에 연동
- **4단계 메시지 보강:** SMS/LMS/MMS 수동 탭 토글, 바이트 동적표시(90/2000), 광고문구 실시간 미리보기((광고)+무료거부), 이모지 경고, MMS 이미지 업로드, LMS/MMS 제목 필수 체크
- **AI 문구추천:** AiMessageSuggestModal 연동 + selectedFields 기반 개인화. 프로 이상 접근이므로 잠금 제거
- **스팸필터테스트:** SpamFilterTestModal 연동. 프로 이상 접근이므로 잠금 제거
- **자동입력 변수:** 하드코딩 5개 버튼 → enabled-fields 기반 동적 드롭다운 (TargetSendModal 패턴)
- **⚠️ 미완료:** 타겟 필터 UI (Phase 2), 실행 이력 상세 조회 (Phase 2)

#### Phase 2 (미구현, 향후)
- D-1 사전 알림 (auto-campaign-notify.ts)
- 타겟 필터 UI (AutoSendFormModal에 필터 단계 추가)
- 실행 이력 상세 조회
- 캘린더 연동 (CalendarPage에 자동발송 이벤트 표시)
- 슈퍼관리자 모니터링 (admin 대시보드)

#### Phase 3 (미구현, 향후)
- AI 메시지 자동 생성 연동 (매 실행마다 시즌별 메시지 자동 생성)
- 실행 결과 리포트 (월간 자동발송 성과 대시보드)
- 카카오톡 채널 자동발송 지원

---

### 🔧 D70 — 직원 QA 버그 일괄수정 (2026-03-12) — 🔶 진행 중 (일부 배포 완료, 나머지 배포 대기)

> **배경:** 직원 2명이 실동작 검증 후 PPT(8슬라이드) + 체크리스트(30항목) 버그 리포트 제출. 서버 검증 후 순차 수정.
> **원칙:** 직원 리포트 그대로 믿지 않고, 서버 실데이터/코드로 교차검증 후 수정.

#### ✅ 수정 완료 (배포 완료)
1. **Redis 캐시키 브랜드 격리 (Slide 1):** `stats:${companyId}` → `stats:${companyId}:${userId}` — 다른 브랜드 담당자 간 캐시 충돌 방지 (`customers.ts`)
2. **고객DB 날짜 표시 (Slide 3):** `T15:00:00.000Z` → `formatDate()` 적용. birth_date, recent_purchase_date, created_at, wedding_anniversary, DATE 타입 필드 (`CustomerDBModal.tsx`)
3. **커스텀 필드 정의 저장 (Slide 4 일부):** field_type `'text'` → `'VARCHAR'` — customer_field_definitions CHECK 제약조건 위반 수정 (`upload.ts`)
4. **MMS 보관함 이미지 (Slide 7):** sms_templates.mms_image_paths 컬럼 추가 (ALTER TABLE 실행 완료) + 저장/불러오기 코드 (`sms-templates.ts`, `Dashboard.tsx`)
5. **주소록 파일업로드 401 (Slide 8a):** Authorization 헤더 누락 → `Bearer ${token}` 추가 (`AddressBookModal.tsx`)
6. **주소록 브랜드 격리 (Slide 8b):** address_books.user_id 컬럼 추가 (ALTER TABLE 실행 완료) + 4개 라우트에 user_id 필터 적용 (`address-books.ts`)

#### ✅ 수정 완료 (배포 대기 — tp-push → tp-deploy-full 필요)
7. **대시보드 성공건수 (신규 발견):** `monthly_sent: totalSent`(큐 INSERT 건수) → `totalSuccess`(실제 성공건수)로 변경 + 담당자테스트/스팸필터 성공건수도 합산 (`customers.ts`)
8. **직접발송 머지변수 NULL (Slide 5):** replaceVariables 컨트롤타워에 `addressBookFields` 4번째 파라미터 추가 — %기타1/2/3%, %회신번호% 주소록 변수를 fieldMappings 순회 전에 치환하여 안전망에 잡히지 않도록 처리 (`messageUtils.ts`, `campaigns.ts` SMS+카카오 양쪽)
9. **upload.ts customer_schema 미갱신:** 엑셀 업로드 후 companies.customer_schema 자동 갱신 로직 추가 — customers.ts 일괄추가와 동일 쿼리 (`upload.ts`)

#### ❌ 미해결 (다음 세션 CURRENT_TASK)
- **Slide 2 — 타 브랜드 고객데이터 노출:** D67 store_code 격리 코드 서버 배포 상태 검증 필요
- **Slide 4 일부 — 매장 필드 매핑:** store_code, recent_purchase_store 빈값. registered_store는 값 존재. 업로드 매핑 로직 확인 필요
- **Slide 6 — MMS 발송 후 이미지/수신자 미초기화:** 간헐적 프론트엔드 이슈. Dashboard.tsx 발송 후 state 초기화 로직 점검 필요
- **B8-03 — AI맞춤한줄 개인화 불일치:** 미리보기 vs 실제 발송 시 개인화 변수 적용 차이
- **D39 — 필터 UI 보유필드 미표시:** enabled-fields API에서 매장번호/지역 등 반환 안 됨

---

### 🔧 D68 — 대시보드 UI 수정 + AI 생일 타겟팅 + 테스트 비용 합산 + 커스텀 필드 라벨 (2026-03-12) — ✅ 완료 (배포 대기)

> **배경:** 메트로시티 첫 시연 준비 중 발견된 4건. 대시보드 UI 이슈 + AI 필터 누락 + 비용 집계 누락.
> **원칙:** 기간계 무접촉. 프론트+백엔드 수정만.

#### ✅ 대시보드 총 구매금액 아이콘/포맷 수정

**파일:** `dashboard-card-pool.ts`, `Dashboard.tsx`
**원인:** 총 구매금액 카드에 DollarSign($) 아이콘 + 천 단위 콤마 없음
**수정:** DollarSign → CreditCard 아이콘, `.toFixed(0)` → `Math.round().toLocaleString()` 천 단위 콤마 추가

#### ✅ 커스텀 필드 라벨 미표시 버그 수정

**파일:** `customers.ts`, `upload.ts`
**원인:** upload.ts에서 customer_field_definitions INSERT 시 `is_hidden` 미설정 → NULL로 저장 → enabled-fields 쿼리 `is_hidden = false` 조건에 NULL 미매칭 → FIELD_MAP 기본값 "커스텀1/2/3"으로 폴백
**수정:** 조회 조건 `(is_hidden = false OR is_hidden IS NULL)` + INSERT 시 `is_hidden = false` 명시

#### ✅ AI 생일 타겟팅 전체 고객 선택 버그 수정

**파일:** `customer-filter.ts`, `services/ai.ts`, `routes/ai.ts`, `AiCustomSendFlow.tsx`
**원인:** (1) AI 프롬프트에 birth_date 필터 필드 누락 → AI가 생일 필터 생성 불가 (2) customer-filter.ts mixed 형식에 birth_date 핸들러 없음 → 필터 생성해도 무시
**수정:**
- customer-filter.ts: mixed 형식에 birth_date 핸들러 추가 (birth_month/gte/lte/between)
- services/ai.ts: recommend-target + parseBriefing 프롬프트에 birth_date 필터 + birth_month 연산자 추가
- routes/ai.ts: recount-target에 birthMonth→birth_date 변환 추가
- AiCustomSendFlow.tsx: TargetCondition 인터페이스 + EMPTY_TARGET_CONDITION에 birthMonth 추가
- **3개 경로 전부 적용:** AI 한줄로(recommend-target) + AI 맞춤한줄(parse-briefing) + 타겟 수정 재조회(recount-target) + 실제 발송(campaigns.ts)

#### ✅ 대시보드 발송현황 총 사용금액에 테스트 비용 합산

**파일:** `customers.ts`
**원인:** 발송현황 통계가 campaign_runs + 직접발송만 집계, 담당자 테스트 + 스팸필터 테스트 비용 미포함
**수정:** 성공건수/성공률은 실발송만 유지, 총 사용금액에 MySQL 담당자 테스트(getTestSmsTables) + PostgreSQL 스팸필터(spam_filter_test_results) 비용 합산. try-catch 안전 처리.

#### 메트로시티 가상 고객 DB 2만건 생성

**출력:** `메트로시티_가상고객DB_20000건.xlsx`
**내용:** 전화번호 010-0001-0001~010-0002-0000, 메트로시티 매장 15개, 등급 6단계(VVIP~NORMAL), 수신동의 변형 포함, 스키마 필수 17필드 + 커스텀 3필드(선호스타일/최근방문일/구매횟수)

**⚠️ 배포 필요:** tp-push + tp-deploy-full

---

### 🔧 D67 — 080 콜백 진단 + 수신동의 변형 인식 + 사용자별 고객DB 삭제 (2026-03-12~) — ✅ 완료 (배포 완료)

> **배경:** 직원 080 수신거부 테스트 미동작 + DB 업로드 시 수신거부 자동등록 미작동 신고 + 슈퍼관리자 사용자별 고객DB 삭제 기능 요청.
> **원칙:** 하나씩 원인 파악 → 수정. 기간계 무접촉.

#### ✅ 080 나래인터넷 콜백 미동작 진단 완료

**현상:** sh_cpb 계정 080-540-5648로 전화 → 서버 콜백 미수신
**진단:**
- curl 직접 테스트 → 응답 `1` (서버 코드 정상, 080번호 매칭 성공)
- pm2 로그에 10:39 나래 콜백 기록 **0건** → 나래인터넷이 080-540-5648에 대해 콜백을 보내지 않음
- **원인:** 나래인터넷에 080-540-5648 번호의 콜백 URL 미등록. 080-719-6700(Harold님)은 등록되어 있어 정상 작동.
- **조치:** 나래인터넷에 080-540-5648 콜백 URL 등록 요청 필요 (`https://app.hanjul.ai/api/unsubscribes/080callback`)

#### ✅ 연동 테스트 버튼 stale state 버그 수정

**파일:** `packages/frontend/src/pages/Unsubscribes.tsx`
**원인:** `loadUnsubscribes()` 후 React state(비동기)를 바로 참조 → 항상 이전 값으로 체크
**수정:** `loadUnsubscribes()`가 최신 데이터를 return하도록 변경, `handleSyncTest()`에서 반환값으로 직접 체크

#### ✅ SMS_OPT_IN 변형 값 인식 확대

**파일:** `packages/backend/src/utils/normalize.ts`
**원인:** "비동의", "불동의", "미동의" 등이 인식 목록에 없어 null → 기본값 true(동의)로 저장됨
**수정:** SMS_OPT_IN_FALSE에 비동의/불동의/미동의/동의안함/거절/수신거절/해지/탈퇴/철회 추가, SMS_OPT_IN_TRUE에 수신 동의/동의함/수신동의함 추가

#### ✅ 슈퍼관리자 사용자별 고객 DB 삭제 기능

**파일:** `packages/backend/src/routes/admin.ts`, `packages/frontend/src/pages/AdminDashboard.tsx`
**기존:** customers 테이블에 `uploaded_by` 컬럼이 이미 존재하고 사용자 ID 저장 중
**추가:**
- 백엔드: 사용자 목록 조회에 `uploaded_customer_count` 추가 + `DELETE /api/admin/users/:id/customers` API (연관 purchases/consents 삭제 + 감사로그)
- 프론트: 사용자 수정 모달에 "업로드 고객 DB: N건 + 삭제 버튼" UI

**⚠️ 배포 필요:** tp-push + tp-deploy-full

#### 🟡 수정 완료-배포 대기: store_code/created_by 전수 격리

**배경:** Harold님이 사용자 ID(hoyun123, store_code=ONLINE)로 로그인 시 고객사관리자(hoyun)의 발송현황이 그대로 보이는 문제 발견.

**격리 원칙 (Harold님 확정):**
- **고객사관리자(company_admin):** company_id 전체 데이터 조회
- **사용자(company_user):** 고객 데이터는 store_code 기준, 발송 데이터는 created_by(본인 발송만)
- store_code 미배정 사용자: company_id 전체 (no_filter)

**수정 완료 파일 (TypeScript 0 에러):**
1. `routes/customers.ts` — 발송현황 카드에 created_by 격리 추가 (campaignStats, directStats)
2. `routes/companies.ts` — dashboard-cards 전체에 store_code + created_by 격리 (aggregateDashboardCards에 userId/userType 전달)
3. `routes/results.ts` — campaigns/:id 상세에 created_by 격리 추가

**⚠️ 배포 필요:** tp-push + tp-deploy-full 실행 대기 중

#### tp-deploy-full 백엔드 빌드 누락 해결

**문제:** tp-deploy-full이 프론트엔드만 빌드하고 백엔드 TypeScript 빌드(tsc)를 하지 않음 → 서버 dist/ 폴더에 이전 JS가 남아 코드 수정이 반영 안 됨 (080 버튼 미표시 원인)
**수정:** Harold님 PowerShell 프로필에 백엔드 빌드 단계 추가 — `cd packages/backend && npm run build`
**결과:** tp-deploy-full 실행 시 자동으로 백엔드도 빌드됨

#### D66 17차 실동작 검증 대기 (B17-01~B17-16)
- 16건 전건 수정+배포 완료 (2026-03-12)
- 15건 🟡수정완료-검증대기 (B17-08 배포 후 재확인, B17-13 코드이상없음 제외)
- 직원 재검증 결과 대기 중

---

### 🔧 D62 — 13차~15차 실동작 검증 버그 수정 (2026-03-09~03-10) — ✅ 15차 빌드+배포 완료 (2026-03-10 22:17), 실동작 검증 대기

> **배경:** 직원 전수 실동작 검증(30개 항목) + 한줄로 PPT 버그리포트(7슬라이드) 결과, 기존 버그 재발(Reopened) + 신규 버그(13차) 총 21건 확인.
> **범위:** 백엔드 8파일 + 프론트엔드 6파일. 기간계(발송 INSERT/차감/환불) 무접촉.
> **원칙:** 파일 1개씩 순차 수정 (병렬 에이전트 금지 — 파일 손상 교훈 반영)
> **결과:** FIX-GUIDE-D62.md 기반 11파일 수정 + 추가 수정(B8-13 성능최적화, B10-03 AI 매장맵핑, B13-03/04 AiPreviewModal 누락분, B13-06 특수문자 비호환 제거). TypeScript 0 에러. 전건 🟡수정완료-검증대기.
> **⚠️ 교훈:** B13-03/B13-04는 최초 수정 시 엉뚱한 파일(AiCampaignResultPopup.tsx)만 수정 — 실제 화면은 AiPreviewModal.tsx. Harold님 현장 확인으로 발견하여 재수정. **다음 세션에서 전건 전수점검 재실시 필수.**

#### 검증 결과 요약 (2026-03-09)
- **검증 항목:** 30개 (실동작검증-체크리스트_0309.xlsx)
- **통과(O):** 17개 → 해당 버그 ✅ Closed
- **실패(X):** 10개 → 코드 재수정 완료 → 🟡 수정완료-검증대기
- **미검증:** 3개
- **신규(PPT):** 9건 → B13-01 ~ B13-09 코드 수정 완료 → 🟡 수정완료-검증대기
- **추가 발견:** B8-13 대량 발송결과 성능 → 코드 수정 완료 → 🟡 수정완료-검증대기
- **현장 확인 재수정:** B13-03(개인화 미리보기), B13-04(스팸필터 "준비중"), B13-06(특수문자 비호환) — AiPreviewModal.tsx 누락 + 특수문자 팝업 비호환 문자 제거

#### ✅ 전수점검 결과 (2026-03-09)
- **22건 🟡수정완료-검증대기 전수점검**: 코드 직접 읽기 검증 (에이전트 위임 없이 직접 수행)
- **18건 코드 정상 확인** — 수정 코드가 관련 경로 전부에 일관 적용
- **3건 실제 미수정 발견 + 수정 완료:**
  - B14-01: 직접발송 수신거부 company_id→user_id 통일 (campaigns.ts L2088-2093)
  - B14-02: generateCustomMessages byte_count/byte_warning 누락 (ai.ts L1516-1528)
  - B14-04: sync-results 주석 60분→30분 수정 (campaigns.ts L1795)
- **1건 신규 발견 + 수정 완료:**
  - B14-03: 예약취소 시 campaign_runs 상태+fail_count 미변경 (campaigns.ts L2531-2552)
- **B12-02/B13-09 보완:** AI캠페인 타임아웃 60→30분 통일 (campaigns.ts L1791)

#### 🔧 15차 재수정 (2026-03-10) — 실동작검증 체크리스트 X 10건 메인코드 직접 반영
- **문제:** 기존 수정이 worktree에만 반영되고 메인코드에 미적용된 건들 발견
- **조치:** 10건 전부 메인코드(`packages/`)에 직접 반영 완료
  - B8-04: campaigns.ts — callback/useIndividualCallback INSERT 추가
  - B8-08: campaigns.ts — target_count 수신거부 NOT EXISTS + send u.user_id→u.company_id 4곳
  - B8-09: ai.ts — SMS 바이트 경고 (이미 메인코드 반영됨 확인)
  - B8-10: upload.ts/normalize.ts — 셀타입 처리 (이미 메인코드 반영됨 확인)
  - B8-13: campaigns.ts — sync-results company_id + 7일 제한, Dashboard.tsx fire-and-forget
  - B10-01: customers.ts/unsubscribes.ts — store_code 격리 (이미 메인코드 반영됨 확인)
  - B10-02: customers.ts — enabled-fields customer_schema 라벨 복구 + 자동보정 INSERT, upload.ts labels merge
  - B10-03: customers.ts — GET / SELECT에 registered_store, recent_purchase_store 등 누락 컬럼 추가
  - B10-04: normalize.ts — Integer 제약 제거 + Math.floor (이미 메인코드 반영됨 확인)
  - B10-06: ai.ts — generateMessages 프롬프트에 타겟 필터조건 주입 + ai route targetFilters 전달

#### ✅ 배포 완료 (2026-03-10 22:17)
- **tp-deploy-full 실행:** campaigns.ts (61줄 변경) + Dashboard.tsx (12줄 변경) 서버 반영 확인
- **서버 grep 검증:** useIndividualCallback 12곳, u.company_id 4곳, INTERVAL '7 days' 2곳, sync-results fire-and-forget — 전부 정상
- **PM2 재시작:** targetup-backend online 확인
- **프론트엔드 빌드:** vite 정상 빌드 (1837 modules, 15.4s)

#### ⚠️ 다음 단계 TODO
- **실동작 검증** — 30개 항목 전체 재검증 (특히 X 10건 집중 확인)
- 점검 시 **실제 화면에서 동작 확인** (코드 수정 파일이 아닌 사용자가 보는 화면 기준)

---

### 🔧 D63 — 16차 버그리포트 수정 + 메시징 컨트롤타워 리팩토링 (2026-03-10~) — 🟡 진행 중

> **배경:** 직원 PPT 버그리포트(한줄로_20260310.pptx, 7슬라이드) + Harold님 추가 리포팅. 15차 배포(22:17) 이전 오후 5시에 수신된 리포트이므로, 15차에서 수정한 건은 재검증 필요 (실패 단정 불가).
> **핵심 원칙:** 땜질식 수정 절대 금지. 컨트롤타워 기반으로 근본 원인 해결. 하나씩 원인 파악 → 수정안 브리핑 → Harold님 컨펌 → 작업.
> **에이전트 병렬 금지** — 하나씩 천천히 직접 읽고 정확하게.

#### ✅ 완료된 작업

**B16-01: 고객 DB 통합 문제 (브랜드 격리 체계)** — ✅ 수정 완료, 배포 대기
- **근본 원인:** store_code 기반 브랜드 격리가 산재되어 있고, 브랜드 없는 단일 본사 고객사 케이스 미고려
- **수정:** `utils/store-scope.ts` 컨트롤타워 신규 생성
  - 3단계 판단: no_filter(브랜드 없음) / filtered(할당됨) / blocked(미할당)
  - customers.ts 7곳, campaigns.ts 3곳, ai.ts 3곳 총 13곳 일관 적용
  - buildDynamicFilter store_code 서브쿼리에 company_id 조건 추가
- **파일:** NEW utils/store-scope.ts, MOD customers.ts, campaigns.ts, ai.ts

**B16-02: 예약취소 불가 + 취소해도 실제 발송됨** — ✅ 수정 완료, 배포 대기
- **근본 원인:** manage-scheduled.ts의 cancel이 PostgreSQL만 업데이트하고 **MySQL 큐를 전혀 건드리지 않음** → QTmsg Agent가 예약시간에 그대로 발송
- **수정:** 메시징 컨트롤타워 3개 모듈 생성 + 대규모 리팩토링
  - `utils/sms-queue.ts` — MySQL 큐 조작의 유일한 진입점 (campaigns.ts에서 20+ 함수 이동)
  - `utils/prepaid.ts` — 선불 차감/환불의 유일한 진입점
  - `utils/campaign-lifecycle.ts` — 캠페인 취소 + 결과 동기화 통합
  - campaigns.ts 3030줄 → 2340줄 (발송 인프라 유틸 분리)
  - manage-scheduled.ts → cancelCampaign() 컨트롤타워 호출로 교체 (MySQL 삭제 + 환불 + PG 상태 변경 전부 처리)
  - spam-filter.ts, results.ts, admin.ts → import 경로 utils/로 변경
- **파일:** NEW utils/sms-queue.ts, utils/prepaid.ts, utils/campaign-lifecycle.ts, MOD campaigns.ts, manage-scheduled.ts, spam-filter.ts, results.ts, admin.ts
- **기간계 영향:** 로직 변경 없음. 함수 위치만 이동 (동일 코드). manage-scheduled의 cancel만 MySQL 처리 추가 (버그 수정).
- **TypeScript:** 0 에러 확인

**추가 리포팅: 발송 완료인데 성공/실패 0/0** — ✅ 동일 수정으로 해결
- **원인:** sync-results 로직이 campaigns.ts 로컬 함수로 갇혀 있어 다른 곳에서 접근 불가
- **수정:** campaign-lifecycle.ts의 `syncCampaignResults()` 함수로 추출, campaigns.ts sync-results 라우트에서 호출

**CT-01: `utils/customer-filter.ts` — 고객 필터/쿼리 빌더 컨트롤타워** — ✅ 생성 완료, 배포 대기
- campaigns.ts, customers.ts, ai.ts 3곳의 필터 빌딩 로직을 통합
- `buildCustomerFilter()` 단일 함수: mixed(ai.ts 방식) + structured(customers.ts 방식) 2가지 입력 포맷 지원
- 호환 래퍼: `buildFilterWhereClauseCompat()` (ai.ts용), `buildDynamicFilterCompat()` (customers.ts용)
- campaigns.ts의 `buildFilterQuery()`도 래퍼로 교체
- 내부에서 normalize.ts의 buildGenderFilter, buildGradeFilter, getRegionVariants 재사용
- **파일:** NEW utils/customer-filter.ts, MOD ai.ts, customers.ts, campaigns.ts

**B16-03: AI 맞춤한줄에 스팸필터/담당자테스트 추가** — ✅ 수정 완료, 배포 대기
- AiCustomSendFlow.tsx Step 4에 담당자테스트 + 스팸필터 버튼 추가
- AI한줄로(AiCampaignResultPopup)의 기존 패턴 재사용: sampleCustomer로 변수 치환 후 테스트
- Dashboard.tsx에서 9개 props 전달 (setShowSpamFilter, handleTestSend, sampleCustomer 등)
- **파일:** MOD AiCustomSendFlow.tsx, Dashboard.tsx

**B16-04: EUC-KR 비호환 특수문자 제거** — ✅ 수정 완료, 배포 대기
- Python EUC-KR 인코딩 테스트로 52개 특수문자 전수 확인
- 비호환 4개(♢, ♦, ✉, ☀) 제거 → 48개로 축소
- **파일:** MOD Dashboard.tsx

**B16-05: SMS 전환 후 MMS 이미지 잔존** — ✅ 수정 완료, 배포 대기
- MMS 이미지 미리보기 조건: `directMsgType === 'MMS' || mmsUploadedImages.length > 0` → `directMsgType === 'MMS'`
- LmsConvert/SmsConvert 콜백에 `setMmsUploadedImages([])` 추가
- **파일:** MOD Dashboard.tsx, TargetSendModal.tsx

**B16-06: AI 타겟추출 age 필터 오류 (0명 반환)** — ✅ 수정 완료, 배포 대기
- **근본 원인:** AI 경로(mixed 모드)는 `(currentYear - birth_year)` 계산, 직접타겟 경로(structured 모드)는 `age` 컬럼 직접 사용 → birth_year NULL이면 AI 경로 0명
- **수정:** CT-01 customer-filter.ts mixed 모드의 age 처리를 `age` 컬럼 직접 사용으로 통일 (BETWEEN, >=, <=)
- minAge/maxAge 기존 호환도 동일하게 변경
- **파일:** MOD utils/customer-filter.ts

**B16-07: 직접타겟 회신번호 선택 + 미등록 회신번호 제외** — ✅ 수정 완료, 배포 대기
- **프론트엔드:** DirectTargetFilterModal에 회신번호 선택 드롭다운 추가 (기본/개별/특정번호)
  - 선택된 회신번호를 onExtracted 콜백으로 Dashboard에 전달
  - Dashboard에서 TargetSendModal의 selectedCallback/useIndividualCallback에 자동 반영
- **백엔드:** 미등록 회신번호 처리 변경 — 전체 발송 차단 → 해당 고객만 제외
  - `/:id/send` (AI 캠페인 발송): 미등록 회신번호 고객 제외 + callbackUnregisteredCount 응답 포함
  - `/direct-send` (직접발송): 동일 로직 적용 + validRecipients 별도 변수로 처리
  - 응답에 callbackMissingCount/callbackUnregisteredCount 구분 건수 포함
- **파일:** MOD DirectTargetFilterModal.tsx, Dashboard.tsx, campaigns.ts

#### 🔧 1순위: 추가 컨트롤타워 생성 (Harold님 컨펌 완료)

> **배경:** D63에서 sms-queue.ts, prepaid.ts, campaign-lifecycle.ts 3개 컨트롤타워를 만들어 campaigns.ts 3030줄→2340줄로 리팩토링한 결과, 예약취소 버그(B16-02)가 근본 해결됨. Harold님 피드백: "유틸파일을 기준으로 잡고 통일하는게 문제점 잡기엔 좋더라고". 동적치환 때 standard-field-map.ts로 통일한 것과 같은 패턴.
> **원칙:** 하나씩 생성 → Harold님 컨펌 → 적용. 기존 로직 변경 없이 위치만 이동(함수 추출). 기간계 무접촉.

**CT-01: `utils/customer-filter.ts` — 고객 필터/쿼리 빌더 컨트롤타워** — ✅ 완료 (위 완료 목록 참조)

**CT-02: `utils/permission-helper.ts` — 권한/스코프 헬퍼 컨트롤타워** — ⏳ 대기
- **문제:** `getCompanyScope()` 함수가 manage-scheduled.ts, manage-stats.ts, manage-callbacks.ts 등 **6개 이상 파일에 복붙**으로 존재. 슈퍼관리자/고객사관리자/일반사용자 분기 + 사용자 필터 + 매장 스코프 적용 로직이 8개 이상 라우트에서 각각 구현.
- **중복 패턴 3가지:**
  - (A) `getCompanyScope(req)` — super_admin이면 query에서, 아니면 토큰에서 companyId 추출. manage-stats.ts, manage-callbacks.ts, analysis.ts 등 6곳 동일 복붙
  - (B) 사용자 필터 — `company_user`면 `created_by = userId` 조건 추가, `company_admin`이면 `filter_user_id` 지원. campaigns.ts, results.ts, manage-stats.ts 등 8곳 유사 구현
  - (C) 매장 스코프 — `store-scope.ts`의 `getStoreScope()` 호출 후 WHERE 절 추가. campaigns.ts, customers.ts, ai.ts 등 5곳 유사 패턴
- **합치면:** 약 150줄 이상 중복 제거, 보안 일관성 확보
- **효과:** 권한 체크 누락 버그 방지 (하나 고치면 8곳 자동 반영). 특히 사용자 필터/매장 스코프 적용이 누락되는 보안 리스크 제거
- **설계:**
  ```typescript
  // utils/permission-helper.ts
  interface CompanyScope { companyId: string; isAdmin: boolean; isSuperAdmin: boolean; userId: string; }
  interface UserFilter { where: string; params: any[]; nextIndex: number; }
  function getCompanyScope(req: Request): CompanyScope
  function buildUserFilter(req: Request, startParamIndex: number): UserFilter
  function buildStoreFilter(req: Request, companyId: string, startParamIndex: number): Promise<FilterResult>
  ```
- **적용 파일:** manage-stats.ts, manage-callbacks.ts, analysis.ts, campaigns.ts, results.ts, customers.ts, ai.ts, unsubscribes.ts (8개)

**CT-03: `utils/unsubscribe-helper.ts` — 수신거부 관리 컨트롤타워** — ✅ 완료 (D64, 2026-03-11)
- **문제:** 수신거부 필터 SQL 패턴이 4곳에 산재 + 080 콜백이 companies 레벨에서만 매칭되어 사용자별 080번호 지원 불가
- **해결:** 기존 SQL 빌더 + 080 자동연동 + 슈퍼관리자 수신거부 관리 기능 통합
- **함수:**
  ```typescript
  // 기존 (CT-03 초기)
  buildUnsubscribeFilter(), buildUnsubscribeExistsFilter(), buildUnsubscribeCase()
  syncCustomerOptIn(), isUnsubscribed(), getUnsubscribedPhones()
  // 신규 (D64 080 확장)
  findUserBy080Number()    — users 우선 → companies fallback 매칭
  process080Callback()     — 080 콜백 처리 통합 (INSERT + sms_opt_in 동기화)
  getUserUnsubscribes()    — 슈퍼관리자용 사용자별 수신거부 조회
  deleteUserUnsubscribes() — 슈퍼관리자용 일괄삭제 + sms_opt_in 복구
  exportUserUnsubscribes() — CSV 다운로드용 전체 조회
  ```
- **적용 파일:** unsubscribes.ts(080콜백→컨트롤타워 위임), admin.ts(API 3개 신규), AdminDashboard.tsx(UI)

**CT-04: `utils/stats-aggregation.ts` — 통계 집계 컨트롤타워** — ⏳ 대기
- **문제:** manage-stats.ts와 results.ts에서 날짜 범위 필터링(KST 타임존 처리), 캠페인 성공/실패 집계 쿼리, 월별/일별 그루핑 로직이 거의 동일하게 중복
- **효과:** 통계 쿼리 변경 시 한 곳만 수정, KST 타임존 처리 일관성 확보
- **설계:**
  ```typescript
  // utils/stats-aggregation.ts
  interface DateRangeFilter { sql: string; params: any[]; nextIndex: number; }
  function buildDateRangeFilter(startDate?: string, endDate?: string, startParamIndex?: number): DateRangeFilter
  async function getCampaignSummary(companyId: string, options: StatsOptions): Promise<CampaignStats>
  ```
- **적용 파일:** manage-stats.ts, results.ts, analysis.ts

---

#### 🔧 2순위: 16차 버그리포트 수정 (Harold님 컨펌 완료, 하나씩 진행)

**B16-03 ~ B16-07:** ✅ 전부 수정 완료 (위 완료 목록 참조)

**개인화 미리보기 통일** — ✅ 완료 (D64, 2026-03-11)
- **수정:** AiCampaignResultPopup.tsx에서 sampleCustomer 치환 로직 제거
  - 추천 카드: `%고객명%` 변수 원본 그대로 표시
  - 미리보기(AiPreviewModal.tsx): 기존대로 샘플 데이터 치환 표시
- **수정 파일:** `components/AiCampaignResultPopup.tsx`

**080번호 사용자별 관리 + 수신거부 관리** — ✅ 완료 (D64, 2026-03-11)
- **수정:** 080 관리를 회사 단위 → 사용자 단위로 이전, CT-03 컨트롤타워에 통합
  - users 테이블에 `opt_out_080_number`, `opt_out_auto_sync` 컬럼 추가
  - 슈퍼관리자 사용자 편집 모달에 080 연동 설정/수신거부 관리 UI 추가
  - 나래인터넷 080 콜백: users 우선 → companies fallback 매칭
- **수정 파일:** `utils/unsubscribe-helper.ts`, `routes/unsubscribes.ts`, `routes/admin.ts`, `pages/AdminDashboard.tsx`

#### 추가 사항 (Harold님 언급)
- **DB삭제 사용자별** — 고객 DB 삭제를 사용자별로 권한 관리

#### 수정 파일 목록 (D63 전체)

**신규 생성 (유틸 컨트롤타워):**
- `utils/store-scope.ts` — 브랜드 격리 컨트롤타워 (B16-01)
- `utils/sms-queue.ts` — MySQL 큐 조작 컨트롤타워 (B16-02)
- `utils/prepaid.ts` — 선불 차감/환불 컨트롤타워 (B16-02)
- `utils/campaign-lifecycle.ts` — 캠페인 취소/결과동기화 컨트롤타워 (B16-02)
- `utils/customer-filter.ts` — 고객 필터/쿼리 빌더 컨트롤타워 (CT-01)

**백엔드 수정:**
- `routes/campaigns.ts` — B16-01(store-scope), B16-02(함수→import 교체), B16-07(미등록 회신번호 개별 제외)
- `routes/customers.ts` — B16-01(store-scope 7곳), CT-01(buildDynamicFilter 래퍼)
- `routes/ai.ts` — B16-01(store-scope 3곳), CT-01(buildFilterWhereClause 래퍼)
- `routes/manage-scheduled.ts` — B16-02(cancelCampaign 컨트롤타워 적용)
- `routes/spam-filter.ts` — B16-02(import 경로 변경)
- `routes/results.ts` — B16-02(import 경로 변경)
- `routes/admin.ts` — B16-02(import 경로 변경)

**프론트엔드 수정:**
- `components/AiCustomSendFlow.tsx` — B16-03(스팸필터/담당자테스트 추가)
- `components/DirectTargetFilterModal.tsx` — B16-07(회신번호 선택 드롭다운)
- `components/TargetSendModal.tsx` — B16-05(MMS 이미지 조건 수정)
- `pages/Dashboard.tsx` — B16-03(props 전달), B16-04(특수문자), B16-05(MMS 초기화), B16-07(회신번호 연동)

---

#### 수정 대상 버그 목록 (21건)

| 우선순위 | 버그ID | 제목 | 수정 파일 |
|:--------:|--------|------|-----------|
| 🔴🔴 | B13-07 | 수신거부 제외 오류 — 직접발송 시 수신거부자 포함 발송됨 | campaigns.ts, unsubscribes.ts |
| 🔴 | B13-05 | 금액필터 — 직접타겟 금액 조건 미작동 | campaigns.ts, DirectTargetFilterModal.tsx |
| 🔴 | B8-04 | AI 회신번호 — AI 발송 시 회신번호 '1234' 차단 안됨 | campaigns.ts |
| 🔴 | B10-01 | store_code 격리 — 다매장 고객 데이터 혼재 | customers.ts, unsubscribes.ts |
| 🔴 | B12-01 | 예약취소 — 예약 캠페인 취소 안됨 | campaigns.ts |
| 🔴 | B12-02 | 발송중 고착 — 결과 수신 후에도 '발송중' 유지 | campaigns.ts |
| 🔴 | B13-09 | 발송중 유지 — 직접발송 즉시도 '발송중' 고착 | campaigns.ts |
| 🟠 | B8-08 | 수신거부 건수 — 발송 성공 모달에 수신거부 건수 미표시 | campaigns.ts, Dashboard.tsx |
| 🟠 | B8-09 | SMS 바이트 경고 — AI 결과 SMS 90바이트 초과 시 경고 없음 | ai.ts, AiCampaignResultPopup.tsx |
| 🟠 | B8-10 | 엑셀 셀타입 — 숫자/날짜 셀 파싱 오류 | upload.ts, normalize.ts |
| 🟠 | B10-02 | 커스텀 필드 라벨 — 고객 상세 모달에서 커스텀 필드 라벨 누락 | CustomerDBModal.tsx |
| 🟠 | B10-03 | 매장필드 NULL — 엑셀 업로드 시 매장 필드 null 저장 | upload.ts |
| 🟠 | B10-04 | 날짜 시리얼 — 엑셀 날짜 셀이 숫자로 저장됨 | upload.ts, normalize.ts |
| 🟠 | B10-06 | 등급 프롬프트 — AI 프롬프트에 등급명 하드코딩 | ai.ts |
| 🟠 | B13-01 | 생일/나이 라벨 — 고객 상세 모달 나이 필드 라벨 미표시 | CustomerDBModal.tsx |
| 🟠 | B13-02 | 날짜 포맷 — 엑셀 날짜 YYYY-MM-DD 미변환 | upload.ts, normalize.ts |
| 🟠 | B13-03 | 미리보기 개인화 — AI 결과 미리보기에 %고객명% 치환 안됨 (**재수정**) | AiPreviewModal.tsx, AiCampaignResultPopup.tsx, Dashboard.tsx |
| 🟠 | B13-06 | 이모지 경고 + 특수문자 비호환 (**재수정**) | Dashboard.tsx, TargetSendModal.tsx |
| 🟠 | B13-08 | MMS→SMS 이미지 — MMS에서 SMS 전환 시 이미지 잔존 | TargetSendModal.tsx |
| 🟡 | B10-02 | 커스텀 필드 라벨 — fieldColumns 빈 배열 시 미표시 | CustomerDBModal.tsx |
| 🟡 | B13-04 | 스팸필터 "준비중" — 미리보기에서 스팸필터 미작동 (**재수정**) | AiPreviewModal.tsx, Dashboard.tsx |
| 🔴 | B8-13 | 대량 발송결과 성능 — 70~400만건 조회 시 로딩 불가 (**추가**) | ResultsModal.tsx, results.ts, defaults.ts |

#### 수정 대상 파일 (13개) — 전체 수정 완료 ✅

**백엔드 (8파일):**
1. `routes/campaigns.ts` — B13-07, B13-05, B8-04, B12-01, B12-02, B13-09, B8-08 ✅
2. `routes/customers.ts` — B10-01 (store_code 격리, 이미 적용 확인) ✅
3. `routes/unsubscribes.ts` — B10-01, B13-07 ✅
4. `routes/upload.ts` — B8-10, B10-03, B10-04, B13-02 ✅
5. `services/ai.ts` — B8-09, B10-06, B10-03(매장맵핑 분리) ✅
6. `utils/normalize.ts` — B8-10, B10-04, B13-02 ✅
7. `routes/results.ts` — B8-13 (Redis 캐시 + COUNT 최적화) ✅ **추가**
8. `config/defaults.ts` — B8-13 (CACHE_TTL 추가) ✅ **추가**

**프론트엔드 (6파일):**
9. `pages/Dashboard.tsx` — B8-08, B13-06(이모지+특수문자팝업), B13-03/B13-04(props전달) ✅ **재수정**
10. `components/AiCampaignResultPopup.tsx` — B8-09, B13-03(별칭매핑추가) ✅ **재수정**
11. `components/AiPreviewModal.tsx` — B13-03(개인화치환), B13-04(스팸필터연동) ✅ **신규 추가**
12. `components/TargetSendModal.tsx` — B13-08, B13-06 ✅
13. `components/CustomerDBModal.tsx` — B13-01, B10-02 ✅
14. `components/DirectTargetFilterModal.tsx` — B13-05 ✅
15. `components/ResultsModal.tsx` — B8-13 (sync-results fire-and-forget) ✅

**기간계 무접촉:** 발송 INSERT/차감/환불/인증 로직 일절 미수정.

---

### 🔧 D66 — 17차 실동작 검증 + PPT 버그리포트 수정 (2026-03-11~03-12) — ✅ 수정+배포 완료, 실동작 검증 대기

> **배경:** 직원 전수 실동작 검증(체크리스트 30개 항목, 0311) + PPT 버그리포트(9슬라이드) 결과 종합 분석.
> **검증 결과:** O(통과) 15건, X(실패) 8건, ▲(부분통과) 4건, 미검증 3건. PPT 신규 포함 총 16건 수정 대상.
> **원칙:** 하나씩 코드 직접 읽고 근본 원인 파악 → Harold님 컨펌 → 수정. 병렬 에이전트 금지.
> **기간계 무접촉:** 발송 INSERT/차감/환불 로직 직접 수정 금지.
> **결과:** B17-01~B17-07(이전 세션), B17-09~B17-16(이번 세션) 수정 완료 + 080 admin 자동동기화 추가. TypeScript 0 에러. 배포 완료(2026-03-12).

#### 체크리스트 결과 요약 (2026-03-11)

| 결과 | 건수 | 항목 |
|------|------|------|
| O (통과) | 15건 | B8-01,02,05,06,11,13, S9-04,08, B10-01,05,06,07, B11-01,03,04 |
| X (실패) | 8건 | B8-04,08,09,10,12, B10-02, B10-04, D39 |
| ▲ (부분) | 4건 | B8-03,07, B10-03, B11-02 |
| 미검증 | 3건 | B11-05, Phase2, B8-13b |

#### 수정 대상 버그 목록 (16건 — 우선순위순)

| # | 버그ID | 심각도 | 제목 | 상태 |
|---|--------|--------|------|------|
| 1 | B17-01 | 🔴🔴 | 직접발송 수신거부 제외가 발송에 미반영 (추출은 정상, 전송 시 전체 발송) | 🟡 수정완료-검증대기 |
| 2 | B17-02 | 🔴🔴 | 예약취소 완전 불가 — 캘린더/예약대기/발송결과 3곳 취소 안 됨 + 취소해도 발송됨 | 🟡 수정완료-검증대기 |
| 3 | B17-03 | 🔴 | AI한줄로/맞춤한줄 발송 시 "서버 오류" — AI 경로 전체 발송 불가 | 🟡 수정완료-검증대기 |
| 4 | B17-04 | 🔴 | AI 선택 문안 ≠ 실제 발송 — 두번째 발송 시 첫번째 문안 중복 | 🟡 수정완료-검증대기 |
| 5 | B17-05 | 🟠 | AI 맞춤한줄 스팸테스트 개인화 공백 (간헐적) | 🟡 수정완료-검증대기 |
| 6 | B17-06 | 🟠 | 직접타겟 누적금액/포인트 필터 미작동 — 전체 고객 추출됨 | 🟡 수정완료-검증대기 |
| 7 | B17-07 | 🟠 | MMS 비용절감 모달 후 LMS유지/SMS전환 눌러도 발송 불가 | 🟡 수정완료-검증대기 |
| 8 | B17-08 | 🟠 | 직접타겟 회신번호 리스트 로딩 안 됨 + 자동입력 변수 "고객명"만 표시 | 🟡 배포 후 재확인 |
| 9 | B17-09 | 🟠 | 엑셀 날짜 ISO/영문 표시 (B8-10/B10-04 재발) | 🟡 수정완료-검증대기 |
| 10 | B17-10 | 🟠 | AI한줄로 SMS 바이트 초과 시 LMS 전환 안내 없이 발송 가능 | 🟡 수정완료-검증대기 |
| 11 | B17-11 | 🟠 | 080 수신거부 자동연동 미동작 (슈퍼관리자 설정 후 0건) | 🟡 수정완료-검증대기 |
| 12 | B17-12 | 🟠 | AI맞춤한줄 담당자테스트 버튼 불안정 (실행됐다 안 됐다) | 🟡 수정완료-검증대기 |
| 13 | B17-13 | 🟡 | 커스텀 필드 라벨 여전히 "커스텀1,2" 표시 (B10-02 재발) | 🟡 코드 이상 없음-재업로드 시 해결 |
| 14 | B17-14 | 🟡 | 필터 UI — 대량 값 시 선택창 무한 + 매장번호/지역 미노출 (D39) | 🟡 수정완료-검증대기 |
| 15 | B17-15 | 🟡 | Toast 알림 리셋 안 됨 — 새로고침 전까지 남아있음 (B11-02) | 🟡 수정완료-검증대기 |
| 16 | B17-16 | 🟡 | DB 현황에서 AI 매핑 필드(등록매장 등) 미표시 (B10-03) | 🟡 수정완료-검증대기 |

#### 관련 이전 버그 매핑

| 17차 | 관련 이전 버그 | 비고 |
|------|--------------|------|
| B17-01 | B13-07, B14-01 | 수신거부 필터가 추출만 반영, 발송 INSERT에 미반영 |
| B17-02 | B12-01 | campaign-lifecycle.ts 배포 안 됐거나 manage-scheduled 미적용 |
| B17-03 | B8-04, B8-08 | AI 경로 공통 서버 오류 — 근본 원인 별도 분석 필요 |
| B17-04 | B8-12 | AI 캠페인 선택 문안 state 관리 문제 |
| B17-05 | B8-03 | 간헐적 = 비동기/타이밍 문제 가능성 |
| B17-06 | B13-05 | CT-01 customer-filter 배포 여부 확인 필요 |
| B17-07 | B16-05, B13-08 | MMS 전환 모달 콜백 문제 |
| B17-09 | B8-10, B10-04 | normalize.ts 날짜 처리 재발 |
| B17-11 | 신규 | CT-03 unsubscribe-helper 080 연동 배포 여부 확인 |
| B17-13 | B10-02 | customer_schema 라벨 복구 로직 미동작 |

#### 수정 내역 상세 (2026-03-11~03-12, 2세션)

**세션1 (D66 전반 — B17-01~B17-07):**
- B17-01: unsubscribes 10파일 user_id 통일 (campaigns.ts, customers.ts, ai.ts 등)
- B17-04: AI 캠페인 state 초기화 (Dashboard.tsx aiResult/selectedAiMsgIdx 리셋)
- B17-06: customer-filter.ts 숫자 필드 연산자 처리 수정
- B17-07: MMS 비용절감 모달 콜백 루프 수정 (SendConfirmModal.tsx)

**세션2 (D66 후반 — B17-09~B17-16 + 080 admin 동기화):**
- B17-09: upload.ts, sync.ts — XLSX Date 객체 normalizeDateValue() 처리
- B17-10: AiCampaignResultPopup.tsx — 캠페인확정 시 SMS 바이트 체크 + LMS 전환 confirm
- B17-11: 080 수신거부 — 7개 파일 users 우선→companies fallback 패턴 적용 (unsubscribes.ts, campaigns.ts×3, ai.ts×3, companies.ts)
- B17-12: AiCustomSendFlow.tsx — 자체 handleCustomTestSend 함수 생성 (variants 기반)
- B17-13: 코드 이상 없음 — customer_field_definitions 정상, 데이터 재업로드 시 해결
- B17-14: DirectTargetFilterModal.tsx — 15개 초과 시 검색+스크롤 영역
- B17-15: Dashboard.tsx — useEffect 4초 자동 해제 + 닫기 버튼
- B17-16: companies.ts — store_name(미존재)→COALESCE(registered_store, recent_purchase_store), opt_outs→unsubscribes

**추가 개선 (080 admin 자동동기화):**
- unsubscribe-helper.ts process080Callback() — 080 콜백 시 같은 회사의 admin user에게도 자동 INSERT (source='080_ars_sync')
- 매칭된 user INSERT 후 → 같은 company의 user_type='admin' 조회 → 미포함 admin에게 INSERT

#### 수정 파일 전체 목록 (D66 세션2)
- `utils/unsubscribe-helper.ts` — 080 admin 자동동기화
- `routes/unsubscribes.ts` — B17-11 users 우선 조회
- `routes/campaigns.ts` — B17-11 AI발송/직접발송/예약발송 3곳
- `routes/ai.ts` — B17-11 generate-message/recommend/generate-custom 3곳
- `routes/companies.ts` — B17-11 settings reject_number override + B17-16 store_name/opt_outs 수정
- `routes/upload.ts` — B17-09 Date 객체 처리
- `routes/sync.ts` — B17-09 Date 객체 처리
- `components/AiCampaignResultPopup.tsx` — B17-10 SMS 바이트 체크
- `components/AiCustomSendFlow.tsx` — B17-12 자체 테스트 핸들러
- `components/DirectTargetFilterModal.tsx` — B17-14 검색+스크롤
- `pages/Dashboard.tsx` — B17-15 Toast 자동해제

#### 배포 후 재확인 필요
- B17-08: 콜백 목록 (이전 세션 배포 분)
- B17-11: 080 실제 콜백 동작 (나래인터넷 → sh_cpb/sh_sh 테스트)
- B17-13: 커스텀 필드 라벨 (데이터 재업로드 후)

---

### ✅ D65 — sync-results 결과동기화 Blocker 수정 (2026-03-11) — 완료, 배포 완료

> **배경:** 발송 완료된 캠페인이 영구적으로 "발송중" + 성공/실패 0/0으로 고착. 결과 화면이 전혀 업데이트되지 않는 Blocker 버그.
> **진단 방법:** 서버 로그(pm2 logs) 기반 근본 원인 추적.

#### 발견된 근본 원인 3가지

1. **kakaoAgg() 미존재 테이블 throw** — MySQL에 `IMC_BM_FREE_BIZ_MSG` 테이블이 없는 상태에서 `kakaoAgg()`를 호출하면 에러 throw → `syncCampaignResults()` 함수 전체 중단 → SMS 결과 집계가 정상이어도 DB 업데이트까지 도달하지 못함
2. **PostgreSQL $3 타입 추론 실패** — UPDATE 쿼리에서 `status = $3`과 `CASE WHEN $3 = 'completed'`에 동일 파라미터 사용 → PostgreSQL이 `inconsistent types deduced for parameter $3` 에러
3. **캠페인별 에러 격리 없음** — for 루프에 try/catch가 없어 1건의 에러가 나머지 전체 캠페인 동기화를 중단

#### 수정 내용 (campaign-lifecycle.ts)

- `kakaoAgg()` 호출을 try/catch로 감싸 테이블 미존재 시 `{total:0, success:0, fail:0, pending:0}` 반환 (AI + 직접발송 2곳)
- UPDATE 쿼리 `$3` → `$3::text` 명시 캐스팅 (campaign_runs AI, campaigns AI, campaigns 직접발송, campaign_runs 직접발송 — 4곳)
- AI캠페인 / 직접발송 for 루프에 캠페인별 try/catch 추가 (2곳)
- 디버그 로그 추가: tables, created_by, success/fail/pending 카운트

#### 수정 파일 (sync-results)
- `utils/campaign-lifecycle.ts` — syncCampaignResults 함수

#### 추가 수정: 발송 내역 0건 표시 (B15-01)

**근본 원인:** mysql2의 `conn.execute()`(prepared statement)가 UNION ALL + 다수 `?` 파라미터 바인딩에서 `Incorrect arguments to mysqld_stmt_execute` 에러 발생 (mysql2 known issue). LIVE 테이블 fallback도 동일 실패.

**수정:**
- `config/database.ts` — `mysqlQuery` 함수의 `conn.execute()` → `conn.query()` 변경. `query()`는 문자열 이스케이프 방식이라 UNION ALL 문제 없음. `?` 파라미터 바인딩 동일 지원.
- `routes/results.ts` — SMS 서브쿼리의 `NULL AS kakao_*` → `'' AS kakao_*` 변경 (메인+fallback 2곳)

#### 추가 수정: 캠페인 상세 메시지 미리보기 overflow (B15-02)

**수정:** `ResultsModal.tsx` — 메시지 말풍선에 `break-all overflow-hidden` 추가. 긴 특수문자가 폰 프레임 밖으로 넘치던 문제 해결.

#### 추가 수정: 발송시간 UTC→KST 변환

**근본 원인:** QTmsg Agent가 `mobsend_time`, `repmsg_recvtm`을 UTC로 기록. `sendreq_time`은 앱에서 MySQL NOW()(KST)로 INSERT하므로 정상이나, QTmsg가 기록하는 발송시간/결과수신시간은 9시간 느리게 표시.

**수정:** `routes/results.ts` — messages/fallback/export 3곳에 `DATE_ADD(mobsend_time, INTERVAL 9 HOUR)`, `DATE_ADD(repmsg_recvtm, INTERVAL 9 HOUR)` 적용.

#### 추가 수정: 캠페인 상세 엉뚱한 메시지 표시 + 회신번호 공란 (B15-03)

**근본 원인:**
1. `ResultsModal.tsx` — "상세" 클릭 시 이전 캠페인의 `messages` state가 초기화되지 않아 `messages[0]?.msg_contents`가 이전 캠페인 내용을 표시
2. `results.ts` — 캠페인 목록 SELECT에 `callback_number` 컬럼 누락 → 프론트에서 항상 `-` 표시

**수정:**
- `ResultsModal.tsx` — 상세 클릭 시 `setMessages([])`, `setShowSendDetail(false)` 호출 추가
- `results.ts` — 캠페인 목록 SELECT에 `c.callback_number` 추가

#### 수정 파일 전체 목록 (D65)
- `utils/campaign-lifecycle.ts` — syncCampaignResults: kakao try/catch, $3::text 캐스팅, 캠페인별 try/catch
- `config/database.ts` — mysqlQuery: conn.execute() → conn.query()
- `routes/results.ts` — NULL→'' 변경, callback_number 추가, mobsend_time KST 변환
- `components/ResultsModal.tsx` — messages 초기화, 미리보기 overflow 수정

#### 관련 버그 Closed
- **B12-02** (발송결과 "발송중" 영구 고착) → ✅ Closed
- **B13-09** (결과 수신 후에도 미변경) → ✅ Closed
- **B15-01** (발송 내역 0건 표시) → ✅ Closed (신규)
- **B15-02** (미리보기 overflow + 발송시간 UTC) → ✅ Closed (신규)
- **B15-03** (상세 엉뚱한 메시지 + 회신번호 공란) → ✅ Closed (신규)

#### 기간계 영향: 없음
발송 INSERT/차감/환불 무접촉. 결과 동기화 + 조회 로직만 수정.

---

### ✅ D61 — 프론트엔드 난독화 적용 (2026-03-08) — 완료

> **배경:** 상용화 전 소스 코드 보호. STATUS.md 런칭 체크리스트 항목.
> **범위:** frontend + company-frontend 양쪽 vite.config.ts
> **결과:** `vite-plugin-javascript-obfuscator` 적용. production 빌드 시에만 활성화. stringArray+base64 인코딩, disableConsoleOutput, identifierNamesGenerator 등. 개발 환경 무영향.
> **배포:** 서버에서 `npm install` → `npm run build` 시 자동 적용

### ✅ D60 — SyncAgent API Key 관리 + 사용자별 라인그룹 배정 (2026-03-08) — 완료

> **배경:** (1) 상용화 시 고객사 온보딩마다 DB 직접 접근 불가 → 슈퍼관리자 UI 필요 (2) 동일 회사 내 사용자간 발송 라인 공유 → 대량발송 시 다른 사용자 홀딩 문제
> **범위:** 백엔드(admin.ts, campaigns.ts) + 프론트엔드(AdminDashboard.tsx) + DB DDL(users.line_group_id)
> **결과:**
> - SyncAgent: 고객사 편집 모달 9번째 탭 추가 — API Key/Secret 조회·재발급·비활성화, use_db_sync 토글. 3개 엔드포인트 신규.
> - 라인그룹: users 테이블에 line_group_id 추가(nullable). 발송 시 사용자 개별 라인그룹 우선, 없으면 회사 fallback. 슈퍼관리자 사용자 편집 모달에 라인그룹 드롭다운 추가. 고객사 관리자 접근 불가.
> - 고객사 편집 모달 너비/탭 UI 개선 (max-w-lg → max-w-2xl, 탭 라벨 줄바꿈 방지)
> **기간계 영향:** campaigns.ts getCompanySmsTables에 userId optional 파라미터 추가 (기존 호출 100% 호환)
> **DDL:** `ALTER TABLE users ADD COLUMN IF NOT EXISTS line_group_id uuid REFERENCES sms_line_groups(id) ON DELETE SET NULL` — 실행 완료 (2026-03-08)
> **tsc:** backend + frontend 모두 통과

### ✅ D59 — 2차 코드 전수점검 (2026-03-07) — 완료

> **배경:** 상용화 전 전체 코드 레벨 정밀 감사. 1차 점검(03-05 교통정리) 이후 코드 실물 기반 전수점검.
> **범위:** 전체 백엔드(routes, services, config, utils) + 전체 프론트엔드(pages, components) + company-frontend
> **결과:** P1~P6 총 28건 수정 완료, P7 장기 8건 백로그 기록. 기간계 무접촉. tsc 3패키지 통과.
> **상세:** `status/교통정리-전수점검-20260305.md` 섹션 11~14 참조 + `status/CODE-REVIEW-P7-BACKLOG.md`

---

### 🔧 D53 — 요금제별 기능 게이팅 구현 (2026-03-04~)

> **배경:** 상용화 직전, 레거시 웹 업체를 무료요금제로 강제이관 후 유료 전환 유도 전략. 기존 plans 테이블에 5단계 요금제 존재하나, 기능별 잠금이 AI 분석(`ai_analysis_level`)과 고객DB 한도(`max_customers`)에만 적용됨. 스팸필터·AI메시징·고객DB/타겟팅 등 핵심 기능에 요금제별 게이팅이 필요.
> **목표:** 요금제별로 기능 접근을 제어하여 무료→스타터→베이직 단계별 업셀 구조 완성.
> **원칙:** 기간계(발송/DB/인증) 무접촉. plans 테이블 컬럼 추가 + 백엔드 미들웨어 + 프론트 UI 잠금.

#### 요금제별 기능 매트릭스 (Harold님 확정 2026-03-04)

| 기능 | 무료(체험후) | 스타터(15만) | 베이직(35만) | 프로 | 비즈니스 |
|------|:-----------:|:-----------:|:-----------:|:----:|:--------:|
| 직접발송 (상단메뉴) | O | O | O | O | O |
| 발송결과 (상단메뉴) | O | O | O | O | O |
| 수신거부 (상단메뉴) | O | O | O | O | O |
| 설정 (상단메뉴) | O | O | O | O | O |
| 고객 DB 업로드 | X | O | O | O | O |
| 직접 타겟 발송 | X | O | O | O | O |
| 스팸필터 테스트 | X | O | O | O | O |
| 캘린더 | X | O | O | O | O |
| AI 추천 발송 (한줄로/맞춤한줄) | X | X | O | O | O |
| AI 분석 | X | X | X | basic | advanced |

#### 안건 목록

| # | 안건 | 성격 | 난이도 | 상태 |
|---|------|------|--------|------|
| 1 | plans 테이블 컬럼 추가 — `spam_filter_enabled`, `ai_messaging_enabled`, `customer_db_enabled` | DB/DDL | 낮음 | ✅ 완료 (DB 실행 완료 2026-03-05) |
| 2 | plans 테이블 데이터 업데이트 — 5개 요금제별 플래그값 설정 | DB/DML | 낮음 | ✅ 완료 (DB 실행 완료 2026-03-05) |
| 3 | 백엔드: /api/companies/my-plan 응답에 새 플래그 포함 | 백엔드 | 낮음 | ✅ 완료 |
| 4 | 백엔드: 스팸필터 API 게이팅 — spam-filter.ts에서 `spam_filter_enabled` 체크 | 백엔드 | 낮음 | ✅ 완료 |
| 5 | 백엔드: AI 발송 API 게이팅 — ai.ts에서 `ai_messaging_enabled` 체크 (recommend-target, parse-briefing, generate-custom) | 백엔드 | 낮음 | ✅ 완료 |
| 6 | 백엔드: 고객DB/타겟팅 API 게이팅 — upload.ts(parse/save)/customers.ts(extract)에서 `customer_db_enabled` 체크 | 백엔드 | 낮음 | ✅ 완료 |
| 7 | 프론트: Dashboard.tsx — PlanInfo 인터페이스 확장 + 3개 카드 잠금 UI (🔒 + opacity) | 프론트 | 중간 | ✅ 완료 |
| 8 | 프론트: 상단메뉴 게이팅 — 캘린더 메뉴 customer_db_enabled 체크 + 🔒 표시 | 프론트 | 낮음 | ✅ 완료 |
| 9 | 프론트: 업그레이드 유도 모달 — PlanUpgradeModal 범용화 (featureName/requiredPlan props) + SpamFilterLockModal 텍스트 수정 | 프론트 | 중간 | ✅ 완료 |
| 10 | 검증: DB 실행 완료 + 실서버 테스트 대기 | 검증 | 중간 | ✅ DB실행완료 (2026-03-05 plans 3컬럼 ALTER+UPDATE 6건 정상) |

#### 상세 구현 계획

**안건 #1-2: DB 변경**
```sql
-- plans 테이블 컬럼 추가
ALTER TABLE plans ADD COLUMN customer_db_enabled boolean DEFAULT false;
ALTER TABLE plans ADD COLUMN spam_filter_enabled boolean DEFAULT false;
ALTER TABLE plans ADD COLUMN ai_messaging_enabled boolean DEFAULT false;

-- 요금제별 플래그 설정
UPDATE plans SET customer_db_enabled = false, spam_filter_enabled = false, ai_messaging_enabled = false WHERE plan_code = 'FREE';
UPDATE plans SET customer_db_enabled = true,  spam_filter_enabled = true,  ai_messaging_enabled = false WHERE plan_code = 'STARTER';
UPDATE plans SET customer_db_enabled = true,  spam_filter_enabled = true,  ai_messaging_enabled = true  WHERE plan_code = 'BASIC';
UPDATE plans SET customer_db_enabled = true,  spam_filter_enabled = true,  ai_messaging_enabled = true  WHERE plan_code = 'PRO';
UPDATE plans SET customer_db_enabled = true,  spam_filter_enabled = true,  ai_messaging_enabled = true  WHERE plan_code = 'BUSINESS';
```

**안건 #3: 백엔드 my-plan 응답 확장**
- 파일: `companies.ts` GET `/my-plan`
- 기존 `ai_analysis_level` 외에 `customer_db_enabled`, `spam_filter_enabled`, `ai_messaging_enabled` 추가
- PlanInfo 인터페이스에 3개 boolean 필드 추가

**안건 #4: 스팸필터 게이팅**
- 파일: `spam-filter.ts` POST `/test`
- 발송 전 company의 plan → `spam_filter_enabled` 체크
- false면 403 + `{ error: '스팸필터 테스트는 스타터 이상 요금제에서 이용 가능합니다', code: 'PLAN_FEATURE_LOCKED' }`
- 기존 SpamFilterLockModal.tsx가 이미 존재 (monthly_price >= 150,000 체크) → plan 필드 기반으로 전환

**안건 #5: AI 발송 게이팅**
- 파일: `routes/ai.ts` POST `/recommend-target` (AI 한줄로), POST `/custom-send` (AI 맞춤한줄)
- 파일: `campaigns.ts` POST `/ai-send`
- company의 plan → `ai_messaging_enabled` 체크
- false면 403 + `{ error: 'AI 추천 발송은 베이직 이상 요금제에서 이용 가능합니다', code: 'PLAN_FEATURE_LOCKED' }`

**안건 #6: 고객DB/타겟팅 게이팅**
- 파일: `upload.ts` POST `/validate`, POST `/save`
- 파일: `customers.ts` POST `/extract` (타겟 추출)
- company의 plan → `customer_db_enabled` 체크
- false면 403 + `{ error: '고객 DB 관리는 스타터 이상 요금제에서 이용 가능합니다', code: 'PLAN_FEATURE_LOCKED' }`

**안건 #7: 대시보드 카드 잠금**
- 파일: `Dashboard.tsx`
- PlanInfo 인터페이스에 새 필드 추가
- 3개 메인 카드(AI 추천 발송, 직접 타겟 발송, 고객 DB 업로드)에 잠금 오버레이:
  - `ai_messaging_enabled = false` → AI 추천 발송 카드에 🔒 + "베이직 이상"
  - `customer_db_enabled = false` → 직접 타겟 발송 카드, 고객 DB 업로드 카드에 🔒 + "스타터 이상"
- 클릭 시 업그레이드 유도 모달 표시 (기존 PlanUpgradeModal 활용/확장)

**안건 #8: 상단메뉴 게이팅**
- 파일: `DashboardHeader.tsx`
- AI 분석 메뉴: `ai_analysis_level === 'none'`이면 클릭 시 업그레이드 모달 (기존 로직 유지)
- 캘린더 메뉴: `customer_db_enabled = false`면 클릭 시 업그레이드 모달

**안건 #9: 업그레이드 유도 모달**
- 기존 PlanUpgradeModal.tsx 확장 또는 범용화
- props: `requiredPlan` ('STARTER' | 'BASIC' | 'PRO') + `featureName` (잠긴 기능명)
- "이 기능은 {requiredPlan} 이상 요금제에서 이용 가능합니다" + [요금제 안내] 버튼 → /pricing

#### 수정 대상 파일 목록

**백엔드 (5파일):**
1. `routes/companies.ts` — my-plan 응답 확장
2. `routes/spam-filter.ts` — spam_filter_enabled 게이팅
3. `routes/ai.ts` — ai_messaging_enabled 게이팅
4. `routes/campaigns.ts` — ai-send ai_messaging_enabled 게이팅
5. `routes/upload.ts` — customer_db_enabled 게이팅
6. `routes/customers.ts` — extract customer_db_enabled 게이팅

**프론트엔드 (4~5파일):**
1. `pages/Dashboard.tsx` — PlanInfo 인터페이스 + 카드 잠금 UI
2. `components/DashboardHeader.tsx` — 메뉴 게이팅
3. `components/PlanUpgradeModal.tsx` — 범용 업그레이드 모달 확장
4. `components/SpamFilterLockModal.tsx` — plan 필드 기반 전환 (기존 price 기반→boolean 기반)
5. `components/DirectTargetFilterModal.tsx` — customer_db_enabled 체크 (선택적)

**기간계 무접촉:** 발송 파이프라인(campaigns.ts send/direct-send), 차감/환불(billing.ts), 인증(auth.ts), DB(database.ts) 전부 미수정.

---

### 🔧 D43 — 기능 정상화 및 DB 동적 기준 정립 (2026-02-27~) — ✅ 전체 완료

> **배경:** D39 표준 필드 아키텍처 확립 후 아직 반영되지 않은 부분들이 존재. 기존 발송 파이프라인의 발송 흐름/차감/환불 로직은 절대 건드리지 않음 (D43-7에서 결과값 해석 로직만 sms-result-map.ts 중앙화 전환).
> **목표:** DB 기준에 맞게 기능을 정상화하고, 동적 데이터 흐름을 확립한다.
> **원칙:** 스키마 벗어나는 하드코딩 금지. 의논 → 검증 → 실행.

#### 안건 목록

| # | 안건 | 성격 | 난이도 | 상태 |
|---|------|------|--------|------|
| 1 | 대시보드 회사명 — 슈퍼관리자 수정이 반영 안 됨 | 버그 | 낮음 | ✅ 완료 |
| 2 | AI 매핑 화면 개편 — 표준 17개 명확 나열 + 커스텀 필드 라벨 지정 | 기능개편 | 중간 | ✅ 완료 |
| 3 | 직접 타겟 설정 — enabled-fields 기반 동적 필터 조건 | 기능개발 | 중간 | ✅ 완료 |
| 4 | 수신거부 양방향 동기화 (독립 관리 vs DB 연동) | 설계+구현 | 높음 | ✅ 완료 (나래 080 콜백 연동 완료 2026-03-05) |
| 5 | AI 한줄로 입력 포맷 강제화 + 샘플 고객 미리보기 + 이모지 제거 | 기능개선 | 중간 | ✅ 완료 |
| 6 | 🚨 긴급: 스팸필터 테스트 안됨 (원인: MySQL 랜섬웨어) | 인프라/보안 | 높음 | ✅ 완료 |
| 7 | 결과값 매핑 중앙화 — sms-result-map.ts 컨트롤타워 | 구조개선 | 높음 | ✅ 완료 (3-Tier 전수 점검) |

#### 안건 #1: 대시보드 회사명 미반영 — ✅ 완료

- **증상:** 슈퍼관리자에서 회사명 → "테스트계정" 수정 완료했으나, 대시보드 좌측 상단에 "디버깅테스트" 표시
- **원인:** 이중 문제 — ① auth.ts가 `c.name`(구 컬럼) 조회, 슈퍼관리자는 `company_name` 수정 → 컬럼 불일치 ② authStore가 로그인 시점 localStorage 캐시 사용
- **해결 (D43-1, 2026-02-27):**
  - auth.ts: 로그인 쿼리 `c.name` → `c.company_name` 통일
  - companies.ts: GET /settings에 `company_name` 추가, PUT /:id에서 `name`도 동기 수정
  - Dashboard.tsx: `companyNameFromDB` state 추가 → loadCompanySettings에서 DB 실시간 조회값 우선 표시
- **수정 파일 3개:** auth.ts, companies.ts, Dashboard.tsx

#### 안건 #2: AI 매핑 결과 화면 개편 — ✅ 완료

- **증상:** 드롭다운 16개 하드코딩(레거시 컬럼 포함), 표준 17개 기준 불명확, 커스텀 필드 배정 불가, 공간 낭비
- **해결 (D43-2, 2026-02-27):**
  - **컴포넌트 분리:** Dashboard.tsx에서 파일 업로드+매핑 모달 310줄 분리 → FileUploadMappingModal.tsx 신규 (5,239줄→4,948줄)
  - **매핑 UI 개편:** 하드코딩 드롭다운 → FIELD_MAP 기반 동적 표준 20개(필수17+파생3), 카테고리별 그룹, 2열 컴팩트 그리드, 태그 클릭 방식(미배정 컬럼 팝업), 중복 배정 자동 방지
  - **커스텀 필드:** +/- 방식으로 슬롯 추가(최대 15개), 라벨명 직접 입력, AI 배정분 자동 초기 표시
  - **백엔드:** upload.ts `/mapping` 응답에 standardFields+categoryLabels 추가, `/save`에 customLabels 지원 → customer_field_definitions 라벨 저장
  - **팝업 overflow 수정:** absolute→fixed 포지션, 클릭 위치 기반 좌표 계산, 하단 공간 부족 시 위로 자동 조정
- **수정 파일 3개:** upload.ts, Dashboard.tsx, FileUploadMappingModal.tsx(신규)

#### 안건 #3: 직접 타겟 설정 동적 필터 — ✅ 완료

- **작업 완료 (D43-3, 2026-02-27):**
  - **컴포넌트 분리:** Dashboard.tsx에서 직접타겟 모달 265줄 분리 → DirectTargetFilterModal.tsx 신규 (4,952줄→4,547줄)
  - **모달 전면 리팩토링:**
    - SKIP_FIELDS 제거 → **전체 필드 노출** (Harold님 확정: 사용자가 선택하게)
    - 2열 컴팩트 그리드 (체크+조건 인라인)
    - 연령: 다중 체크(20대+30대) + 직접 범위 입력(25~35세) 전환
    - 문자열 필드: 단일 드롭다운 → **다중 태그 선택** (☑VIP ☑GOLD → OR 조건)
    - 금액/포인트/날짜: 드롭다운 → **프리셋 태그 토글**
    - sms_opt_in: 별도 체크박스 → 마케팅 카테고리 통합 (기본 ON)
  - **백엔드 개선 (customers.ts):**
    - enabled-fields 옵션: 4개 하드코딩 → **모든 string 필드 DISTINCT 동적 조회** (커스텀 포함)
    - buildDynamicFilter: `name`, `email`, `address` 등 직접 컬럼 → contains 검색 지원
    - numericFields: `recent_purchase_amount` 추가
    - extract SELECT: 6개 → 표준 필드 전체 반환
  - **Dashboard.tsx 연결:**
    - 기존 직접타겟 state 10개 + 함수 5개 제거
    - `handleTargetExtracted` 콜백으로 기존 발송 흐름 연결
- **수정 파일 3개:** DirectTargetFilterModal.tsx(신규), Dashboard.tsx, customers.ts

- **🚨 버그: 타겟 추출 후 발송 모달 미표시 — ✅ 수정 완료 (D43-3b, 2026-02-27)**
  - **증상:** 대상 인원 10,000명 조회 성공 → "타겟 추출" 클릭 → 아무 반응 없음 (발송 모달 안 뜸)
  - **확정 원인 3가지:**
    1. **extract SELECT 하드코딩 + customers_unified 뷰 불일치** — SELECT 컬럼 17개 하드코딩으로 나열 + `FROM customers_unified` 사용 → DDL 이후 뷰 미갱신으로 `store_phone`, `registration_type` 등 컬럼 참조 시 SQL 에러 → 500 반환 → `data.success` undefined → `onExtracted` 미호출
    2. **age 필터 birth_date 역산** — `buildDynamicFilter`에서 age 조건을 `EXTRACT(YEAR FROM AGE(birth_date))`로 처리 → `birth_date` NULL인 고객 전부 탈락 → 연령대 필터 시 0명
    3. **에러 핸들링 부재** — extract API 500 에러 시 DirectTargetFilterModal에서 `!res.ok` 체크 없이 `res.json()` 시도 → 파싱 실패하거나 success 없어서 조용히 실패
  - **수정 내용 (customers.ts + DirectTargetFilterModal.tsx):**
    - **extract SELECT 동적화:** 하드코딩 17개 컬럼 → `getColumnFields()` (FIELD_MAP 기반) + region/custom_fields/callback 추가. 필드 변경 시 FIELD_MAP만 수정하면 자동 반영
    - **customers_unified → customers 테이블 직접 조회:** extract + filter-count 모두 뷰 의존 제거
    - **age 필터 수정:** `EXTRACT(YEAR FROM AGE(birth_date))` → `age` 컬럼 직접 사용 (birth_date NULL인 고객도 필터 가능)
    - **에러 핸들링 추가:** `!res.ok` 체크 + `!data.success` 체크 + catch 네트워크 에러 → 모두 커스텀 알림 모달 표시 (animate-in zoom-in-95, error/warning/info 아이콘 분기)
    - **loadTargetCount에도 동일 에러 핸들링 적용**
  - **수정 파일 2개:** customers.ts, DirectTargetFilterModal.tsx
  - **기간계 미접촉:** campaigns.ts, spam-filter.ts, messageUtils.ts, results.ts, billing.ts, Dashboard.tsx 전부 미수정

- **발송창 하드코딩 전면 제거 + 컴포넌트 분리 — ✅ 완료 (D43-3c, 2026-02-27)**
  - **TargetSendModal.tsx 신규 (901줄):** Dashboard.tsx에서 직접타겟발송 모달 703줄 분리
  - **하드코딩 8곳 동적화 (fieldsMeta 기반):**
    1. SMS 자동입력 변수 (5개 고정 → fieldsMeta 동적)
    2. 카카오 자동입력 변수 (4개 고정 → fieldsMeta 동적)
    3. 수신자 테이블 헤더/데이터 (5컬럼 고정 → fieldsMeta 동적)
    4. handleTargetExtracted 매핑 (5개 하드코딩 → 원본 저장)
    5. executeTargetSend 치환 (5개 replace → fieldsMeta.forEach 동적)
    6. 스팸필터 replaceVars (8개 하드코딩 → fieldsMeta.forEach 동적)
    7. targetVarMap 바이트 체크 (5개 고정 → fieldsMeta 동적)
    8. DirectPreviewModal 미리보기 치환 (하드코딩 → replaceVarsWithMeta 동적)
  - **커서 위치 삽입 버그 수정:** `setTargetMessage(prev => prev + value)` → `textarea.selectionStart` 기반 정확한 위치 삽입
  - **데이터 흐름:** DirectTargetFilterModal → onExtracted(recipients, count, **fieldsMeta**) → Dashboard → TargetSendModal/DirectPreviewModal
  - **FieldMeta 인터페이스:** `{ field_key, display_name, variable, data_type, category }` — DirectTargetFilterModal에서 export
  - **Dashboard.tsx:** 4,548줄 → 3,910줄 (638줄 감소)
  - **수정 파일 4개:** TargetSendModal.tsx(신규), DirectTargetFilterModal.tsx, Dashboard.tsx, DirectPreviewModal.tsx
  - **기간계 미접촉:** campaigns.ts, spam-filter.ts, messageUtils.ts, results.ts, billing.ts 전부 미수정

- **직접타겟발송 발송창 하드코딩 전면 제거 + 컴포넌트 분리 — ✅ 완료 (D43-3c)**

#### 안건 #4: 수신거부 양방향 동기화 — ✅ 완료 (D43-4 + 2026-03-05 나래 080 콜백 연동)

- **설계 확정 내용:**
  - opt_outs 테이블 미사용 확인 (레거시) → **unsubscribes 테이블이 SoT**
  - 발송 파이프라인 이중 체크 유지: `sms_opt_in = true AND NOT EXISTS (SELECT 1 FROM unsubscribes ...)`
  - plan_id 기준 단순화: 플랜 있는 업체만 customers.sms_opt_in 동시 UPDATE, 없으면 unsubscribes만
  - `syncCustomerOptIn()` / `syncCustomerOptInBulk()` 공통 헬퍼 도입 (중복 제거)
- **DDL 완료:**
  - `ALTER TABLE companies ADD COLUMN opt_out_auto_sync boolean DEFAULT false;`
  - 테스트계정 opt_out_auto_sync = true 설정 완료
- **코드 배포 완료 (수정 2파일):**
  - **unsubscribes.ts:** 080콜백 opt_out_auto_sync 체크 추가, 직접추가/업로드/삭제 4곳 syncCustomerOptIn 적용, GET / 응답에 opt080Number+optOutAutoSync 추가
  - **Unsubscribes.tsx:** 080번호 하드코딩 제거→API 동적 표시, 연동테스트 버튼 optOutAutoSync=true일 때만 노출, 080 안내 모달
- **✅ 나래 080 콜백 연동 완료 (2026-03-05):**
  - 나래 담당자 콜백 URL 등록 확인 완료
  - 실제 080 ARS 수신거부 테스트 — 나래 IP(183.98.207.13) 콜백 수신 + 수신거부 DB 등록 정상 확인
  - OPT_OUT_080_TOKEN 검증 제거 — Nginx IP 화이트리스트(나래 6개 IP)로 보안 대체
  - 기존 누적 수신거부 목록: 한줄로 이관 시 수동 처리 예정 (별도 벌크 동기화 불필요)
- **기간계 미접촉:** campaigns.ts 발송 파이프라인 전체 미수정

#### 안건 #6: 🚨 긴급 — 스팸필터 테스트 안됨 → ✅ 완료 (원인: MySQL 랜섬웨어 공격)

- **증상 (2026-02-27 오전~):** 스팸필터 테스트 버튼 클릭 시 500 에러. PM2 로그: `Table 'smsdb.SMSQ_SEND_10' doesn't exist`
- **원인 — MySQL 랜섬웨어 공격:**
  - MySQL 컨테이너가 `0.0.0.0:3306`으로 외부에 노출된 상태 + 취약한 비밀번호(`sms123`/`root123`)
  - 2026-02-25~26 MySQL 타임존 설정 작업 중 컨테이너 3회 재생성하면서 포트가 `0.0.0.0`으로 바인딩됨
  - 자동화 봇이 3306 포트 스캔 → 딕셔너리 공격으로 비밀번호 탈취 → SMSQ_SEND_1~11 테이블 전체 삭제 → `RECOVER_YOUR_DATA_info` 랜섬 메시지 테이블 삽입
  - root 비밀번호 변경됨 (smsuser는 권한 제한으로 무사)
  - **PostgreSQL 무사** (처음부터 127.0.0.1 바인딩) — 핵심 데이터(고객/캠페인/정산) 전부 안전
- **복구 조치 (2026-02-28, D49):**
  1. ✅ MySQL 포트 `0.0.0.0:3306` → `127.0.0.1:3306` (외부 접근 원천 차단)
  2. ✅ root 비밀번호 강화 (취약 비밀번호 → 강화 비밀번호)
  3. ✅ smsuser 비밀번호 강화 + QTmsg Agent 11개 `encrypt_pass` 동기 변경 (DES 암호화 도구 자체 제작: EncryptPass.java)
  4. ✅ smsuser 권한 최소화: `ALL PRIVILEGES` → `SELECT, INSERT, UPDATE, DELETE` (DROP TABLE 불가)
  5. ✅ SMSQ_SEND_1~11 테이블 재생성 (SMSQ_SEND 뷰 기반 스키마 복원)
  6. ✅ 로그 테이블 SMSQ_SEND_*_202602 / 202603 재생성
  7. ✅ 이벤트 스케줄러 `auto_create_sms_log_tables` 정상 확인
  8. ✅ `RECOVER_YOUR_DATA_info` 랜섬 테이블 삭제
  9. ✅ QTmsg Agent 11개 재시작 + 통신사 바인딩 확인 (bind ack 성공)
  10. ✅ 스팸필터 테스트 정상화 확인 (LG U+ 수신 완료)
- **보안 강화 조치:**
  1. ✅ UFW 불필요 포트 차단: 3000(Node.js), 9001~9011(QTmsg Agent 관리) DENY
  2. ✅ SSH root 로그인 비활성화 (`PermitRootLogin no`)
  3. ✅ fail2ban 강화: 10분 내 3회 실패 → 1시간 자동 밴 (설정 직후 5개 IP 차단)
  4. ✅ MySQL smsuser DROP 권한 제거 (설령 뚫려도 테이블 삭제 불가)
- **피해 범위:** MySQL SMSQ 발송 큐 테이블 삭제 (임시 데이터). **고객 개인정보 유출 없음** (PostgreSQL 무사)
- **교훈:** Docker 컨테이너 재생성 시 포트 바인딩 반드시 127.0.0.1 확인. 외부 노출 DB는 강력한 비밀번호 + 권한 분리 필수

#### 안건 #5: AI 한줄로 입력 포맷 강제화 + 샘플 고객 미리보기 + 이모지 제거 — ✅ 완료

- **문제 3가지:**
  1. AI 한줄로(일반)가 고객사 DB 전체 필드를 통으로 바라봄 → 오류 확률 높음
  2. AI 결과 메시지에 `%고객명%` 등 변수가 그대로 표시됨 → 실제 모습 확인 불가
  3. AI가 프롬프트 무시하고 이모지(🔥📅⏰🎉) 삽입 → SMS/LMS에서 깨짐
- **해결 (D43-5, 2026-02-27):**
  - **개인화 필수 파싱 (services/ai.ts):** `parsePersonalizationDirective()` 신규 — "개인화 필수:" 키워드 감지 → 지정 변수만 AI에 전달, 없으면 기존 로직 유지 (하위호환 100%)
  - **샘플 고객 미리보기 (routes/ai.ts → Dashboard.tsx → AiCampaignResultPopup.tsx):** `/recommend-target` 응답에 `sample_customer` 추가 (필터 맞는 실제 고객 1명, FIELD_MAP displayName 키 기반) → AI 결과 메시지 미리보기에서 `%변수%` → 실제 데이터 치환 표시 + 스팸필터 점검에도 치환 적용
  - **이모지 강제 제거 (services/ai.ts):** `stripEmojis()` 후처리 안전장치 — SMS/LMS/MMS 발송 시 유니코드 이모지 자동 제거, KS X 1001 특수문자(★☆●○▶◀■□△▲【】「」 등) 유지. 카카오 채널은 이모지 허용으로 미적용
  - **하드코딩 제거:** AiCampaignResultPopup.tsx의 하드코딩 sampleData 9개 + replaceVars 8개 제거 → 동적 sampleCustomer 기반으로 전환
- **수정 파일 4개:** services/ai.ts, routes/ai.ts, Dashboard.tsx, AiCampaignResultPopup.tsx
- **UI 힌트 추가:** AiSendTypeModal.tsx placeholder + 개인화 안내 힌트

#### 안건 #7: 결과값 매핑 중앙화 — sms-result-map.ts 컨트롤타워 — ✅ 완료 (3-Tier 전수 점검 · Phase 4) (D43-7, 2026-02-28)

- **문제:** QTmsg status_code 해석, 통신사 코드, 스팸필터 판정 결과가 12곳에서 각자 하드코딩 → standard-field-map.ts 이전의 필드 매핑 문제와 동일 패턴
  - 스팸필터 테스트 결과 전부 "대기" 고착 (근본 원인: 백엔드 `'received'` 저장 → 프론트 `'pass'`만 정상 처리)
  - 스팸필터 테스트 이력에 수신번호 노출 (테스트 방식 유추 가능)
  - 발송결과 AI분석 탭 중복 (메인메뉴에 이미 존재)
- **해결 Phase 1 — 전수 파악 + 설계:**
  - 12곳 하드코딩 위치 전체 식별 (campaigns.ts 5곳, results.ts 5곳, ResultsModal.tsx 2곳 + spam-filter.ts 판정 로직)
  - sms-result-map.ts 컨트롤타워 설계 확정 (STATUS_CODE_MAP + CARRIER_MAP + SPAM_RESULT 3파트)
- **해결 Phase 2 — 백엔드 전환 + 프론트 1차 수정 (배포 완료):**
  - **sms-result-map.ts 신규 (148줄):** `backend/utils/` — STATUS_CODE_MAP, CARRIER_MAP, SPAM_RESULT 상수 + 헬퍼 함수 (isSuccess/isFail/isPending/getStatusLabel/getCarrierLabel/getSpamResultLabel)
  - **campaigns.ts 8곳 전환:** 가이드 기반 Harold님 수정 — SUCCESS_CODES/PENDING_CODES/isSuccess/isFail/SPAM_RESULT 사용
  - **results.ts 6곳 전환:** statusCodeMap/carrierMap 로컬 정의 제거 → import 사용, SQL WHERE도 상수 참조
  - **spam-filter.ts 6곳 전환:** 판정 로직 `sc === 6 || sc === 1000` → `SUCCESS_CODES.includes(sc)`, 문자열 `'received'`/`'timeout'`/`'failed'` → SPAM_RESULT 상수, SQL 파라미터화
  - **ResultsModal.tsx 3건 수정:** ① AI분석 탭 제거 (2탭 구조) ② 스팸필터 수신번호 컬럼 완전 제거 ③ 스팸판정 표시 확장 (pass/received→정상, blocked→차단, failed→실패, timeout→시간초과)
  - **DB 마이그레이션:** `UPDATE spam_filter_test_results SET result = 'pass' WHERE result = 'received'` — 384건 변환 완료
- **해결 Phase 3 — 프론트 하드코딩 제거 + 실코드 검증 (2026-02-28):**
  - **campaigns.ts 실코드 검증 완료:** 8곳 모두 sms-result-map.ts import 정상 사용 확인. `status_code = 100` (14곳)은 큐 관리용 초기 상태 특정이므로 정확 (PENDING_CODES로 바꾸면 104 처리중 건까지 삭제 위험)
  - **results.ts 3곳 추가 수정:** ① import에 `getStatusType`, `isSuccess` 추가 ② `/campaigns/:id/messages` 응답에 `status_label`/`status_type`/`carrier_label` 해석값 3개 필드 추가 (원본 유지+해석값 추가 → 하위호환 100%) ③ CSV export 카카오 분기 `m.status_code === 1800` → `isSuccess(m.status_code)` 헬퍼 사용
  - **ResultsModal.tsx 3곳 수정:** ① `STATUS_CODE_MAP` 14개 하드코딩 전체 삭제 (백엔드 22개와 8개 누락 불일치 해소) ② `CARRIER_MAP` 9개 하드코딩 전체 삭제 ③ 메시지 렌더링에서 백엔드 응답 `m.status_label`/`m.status_type`/`m.carrier_label` 직접 사용
- **해결 Phase 4 — 3-Tier 전수 점검 + admin.ts/billing.ts 전환 (2026-02-28):**
  - **서비스 프론트 (hanjul.ai) 7파일 점검 완료:** Dashboard.tsx, CampaignSuccessModal.tsx, AiCampaignResultPopup.tsx, AnalysisModal.tsx, TargetSendModal.tsx, DashboardHeader.tsx — 하드코딩 0건. ResultsModal.tsx getPreviewText sampleData 9개 레거시 삭제 → messages[0].msg_contents 동적 치환으로 전환
  - **슈퍼관리자 프론트 (sys.hanjullo.com) 1파일:** AdminDashboard.tsx 4562번 `[6,1000,1800].includes(r.statusCode)` → `r.statusType === 'success'` 동적 분기로 전환
  - **관리자 프론트 (app.hanjul.ai) 4파일 점검 완료:** CompanyDashboard.tsx, StatsTab.tsx, ScheduledTab.tsx, (UsersTab/CallbacksTab/CustomersTab 무관) — 하드코딩 0건
  - **admin.ts 5곳 전환:** ① import 추가 ② 테스트 통계 SQL `IN (6,1000,1800)` → `SUCCESS_CODES_SQL`/`PENDING_CODES_SQL` ③ 테스트 상세 `[6,1000,1800].includes()` → `isSuccess()`/`isPending()` ④ sms-detail 필터 SQL → 상수 참조 ⑤ statusMap 7개 + carrierMap 3개 로컬 하드코딩 삭제 → `getStatusLabel()`(22개)/`getCarrierLabel()`(9개) + statusType 필드 추가
  - **billing.ts 5곳 전환 + 버그 수정:** ① import 추가 ② smsAggByDateType 성공/실패/대기 3곳 → 상수 참조 ③ smsAggByRunAndType 성공 1곳 ④ smsAggTestByType 성공 1곳. **🐛 `>= 200` 버그 발견·수정:** 실패 판정에 `status_code >= 200` 조건이 있어 비가입자(7)/Power-off(8)/스팸차단(16)/기타실패(55) 등 200 미만 실패 코드가 정산 실패 건수에서 누락. 다른 파일과 통일하여 `NOT IN (성공, 대기) = 실패`로 수정
- **수정 파일 (전체):** sms-result-map.ts(신규), campaigns.ts, results.ts, spam-filter.ts, admin.ts, billing.ts, ResultsModal.tsx, AdminDashboard.tsx
- **기간계 미접촉:** 발송 흐름/차감/환불 로직 전부 미수정. 결과값 해석 로직만 sms-result-map.ts 중앙화 전환
- **3-Tier 전수 점검 결과:** 백엔드 6파일 + 프론트 12파일 = **18파일 점검, 하드코딩 잔존 0건**

#### 진행 순서 (Harold님 확정)

1. ~~**#1** 대시보드 회사명 (빠른 해결)~~ ✅ 완료
2. ~~**#2** AI 매핑 화면 개편 (컴포넌트 분리 + 태그 클릭 UI)~~ ✅ 완료
3. ~~**#5** AI 한줄로 포맷 강제화 + 미리보기 + 이모지 제거~~ ✅ 완료
4. ~~**#3** 직접 타겟 설정~~ ✅ 완료 (백엔드 버그 수정 + 발송창 하드코딩 전면 제거)
5. ~~**#4** 수신거부 동기화~~ ✅ 완료 — 나래 080 콜백 연동 완료 (2026-03-05), 토큰 검증 제거→Nginx IP 화이트리스트
6. ~~**🚨 #6 긴급: 스팸필터 테스트 안됨**~~ ✅ 완료 — 원인: MySQL 랜섬웨어 공격 (D49 보안 대응)
7. ~~**#7** 결과값 매핑 중앙화~~ ✅ 완료 — Phase 4: 3-Tier 전수 점검 + admin.ts/billing.ts 전환 + `>= 200` 버그 수정

→ 각 안건을 별도 채팅 세션에서 설계→컨펌→구현→테스트→정립 후 다음으로 진행

#### ⛔ 진행 규칙
- 기존 발송 파이프라인의 발송 흐름/차감/환불 로직 절대 건드리지 않음
- 코드 작성 전 Harold님 컨펌 필수
- SCHEMA.md에 없는 컬럼 임의 생성 금지
- standard-field-map.ts가 유일한 필드 매핑 기준
- sms-result-map.ts가 유일한 결과값 매핑 기준
- 의논 → 검증 → 실행 순서 엄수

---

### ✅ 이전 완료 요약

| 항목 | 상태 |
|------|------|
| D39 표준 필드 아키텍처 (세션0~2 전체) | ✅ 코드 수정 완료 · 실동작 검증 대기 |
| D40 AI 맞춤한줄 동적 필드 + UX | ✅ 완료 |
| D41 대시보드 동적 카드 시스템 (세션1~2) | ✅ 완료 |
| D42 발송현황 하드코딩 제거 | ✅ 완료 |
| D43 안건#1 회사명 | ✅ 완료 |
| D43 안건#2 매핑 UI 개편 | ✅ 완료 |
| D43 안건#3 직접타겟 리팩토링 | ✅ 완료 (백엔드 버그 + 발송창 하드코딩 전면 제거) |
| D43 안건#4 수신거부 동기화 | ✅ 완료 — 나래 080 콜백 연동 + 토큰 검증 제거 (2026-03-05) |
| D43 안건#5 AI 포맷+미리보기+이모지 | ✅ 완료 |
| D43 안건#7 결과값 매핑 중앙화 | ✅ 완료 — Phase 4: 3-Tier 18파일 전수 점검, 백엔드 6파일+프론트 12파일 하드코딩 0건, billing.ts `>=200` 버그 수정 |
| AI 맞춤한줄 Phase 1 (AI-CUSTOM-SEND.md) | ✅ 8단계 전체 완료 |
| 선불 요금제 Phase 1-A | ✅ 완료 |
| 8차 버그 13건 수정 | ✅ 코드 수정 완료 · 실동작 검증 대기 |
| AI 분석 모달 전체 | ✅ 완료 |
| 스팸필터 전체 (Android 앱 포함) | ✅ 완료 |

---

## 5) ⚠️ 발송 파이프라인 절대 보호 영역

> **아래 파일들은 발송·정산·결과조회의 핵심.** 2026-02-26 D32~D33에서 공통 치환 함수 통합 + 5개 경로 전수 점검 완료. 2026-02-28 D43-7에서 결과값 해석 로직을 sms-result-map.ts 중앙화로 전환 (발송 흐름/차감/환불 로직 미접촉).

| 파일 | 역할 | 비고 |
|------|------|------|
| campaigns.ts | AI 캠페인 발송 (예약+즉시) + 선불 차감/환불 | D43-7: 결과값 해석 8곳 → sms-result-map.ts 참조로 전환 |
| spam-filter.ts | 스팸필터 테스트 (Android 앱 연동) | D43-7: 판정 로직 6곳 → SPAM_RESULT 상수 전환, 'received'→'pass' |
| messageUtils.ts | 공통 변수 치환 (`replaceVariables`) | 미수정 |
| results.ts | 발송 결과 조회 + MySQL LIVE/LOG 통합 | D43-7: statusCodeMap/carrierMap 6곳 → sms-result-map.ts import + messages API에 해석값 3필드(status_label/status_type/carrier_label) 추가 |
| billing.ts | 정산·거래내역서 PDF | D43-7: 3개 집계함수 5곳 → SUCCESS_CODES_SQL/PENDING_CODES_SQL 참조. `>=200` 버그 수정(비가입자/Power-off/스팸차단 등 200 미만 실패코드 정산 누락 해소) |
| direct-send (campaigns.ts 내) | 직접 타겟 발송 | D43-7: 결과값 해석 동일 전환 |

---

## 6) 🏗️ 시스템 아키텍처

### 6-1. 3-Tier 도메인 구조
| 도메인 | 역할 | 사용자 |
|--------|------|--------|
| hanjul.ai | 서비스 사용자 대시보드 | 마케터/직원 |
| app.hanjul.ai | 회사 관리자 대시보드 | 고객사 관리자 |
| sys.hanjullo.com | 슈퍼관리자 시스템 | INVITO 내부 |

### 6-2. 핵심 인프라
- **발송 엔진:** QTmsg Agent 11개 (SKT 6 / KT 4 / LGU+ 1) → MySQL 큐 관리
- **DB:** PostgreSQL (메타데이터) + MySQL (SMS 큐)
- **배포:** Docker + PM2 + Nginx
- **AI:** Claude API (primary) + GPT API (fallback)

---

## 7) 💡 핵심 아키텍처 참조

### 7-1. 데이터 정규화 (utils/normalize.ts + utils/standard-field-map.ts)

고객사별 DB 형식 차이를 흡수하는 핵심 레이어.

**아키텍처 (D39 확정 — 필수17 + 커스텀15):**
1. **standard-field-map.ts** — 유일한 매핑 정의 (field_key ↔ customers 컬럼/custom_fields 위치 ↔ 카테고리 ↔ normalize 함수)
2. **normalize.ts** — 값 변환 함수 (다양한 입력 → 표준값)
3. **customer_field_definitions** — 고객사별 커스텀 필드 라벨 정의

**필수 직접 컬럼 17개:** name, phone, gender, age, birth_date, email, address, recent_purchase_store, store_code, registration_type, registered_store, store_phone(DDL신규), recent_purchase_amount, total_purchase_amount, grade, points, sms_opt_in
**커스텀 슬롯 15개:** custom_1 ~ custom_15 (custom_fields JSONB)

**절대 원칙:** SCHEMA.md에 정의된 컬럼명/타입만 사용. 하드코딩 매핑 금지. FIELD-INTEGRATION.md가 기준 문서.

참조 파일: ai.ts, customers.ts, campaigns.ts, upload.ts, sync.ts

### 7-1b. 발송 결과값 매핑 (utils/sms-result-map.ts) — D43-7 신규

QTmsg status_code, 통신사 코드, 스팸필터 판정 결과를 한 곳에서 정의하는 컨트롤타워.

**구조 (3파트):**
1. **STATUS_CODE_MAP** — QTmsg status_code → 라벨/타입 (성공: 6/1000/1800, 대기: 100/104, 실패: 7/8/16/55/2008 등)
2. **CARRIER_MAP** — mob_company → 통신사명 (11→SKT, 16→KT, 19→LG U+ 등)
3. **SPAM_RESULT** — 스팸필터 판정 상수 (PASS/BLOCKED/FAILED/TIMEOUT)

**헬퍼 함수:** isSuccess(), isFail(), isPending(), getStatusLabel(), getCarrierLabel(), getSpamResultLabel(), getSpamResultType()
**SQL용 상수:** SUCCESS_CODES_SQL, PENDING_CODES_SQL (IN 절 문자열)

**참조 파일 (전환 완료):** campaigns.ts, results.ts, spam-filter.ts, admin.ts, billing.ts (백엔드 6파일) / ResultsModal.tsx, AdminDashboard.tsx (프론트 2파일)

**절대 원칙:** 새로운 status_code 추가/변경 시 sms-result-map.ts만 수정. 개별 파일에 하드코딩 금지.

**역할 3가지:**
1. **값 정규화** — 어떤 형태로 들어오든 표준값으로 통일
   - 성별: 남/남자/male/man/1 → 'M' | 등급: vip/VIP고객/V → 'VIP'
   - 전화번호: +82-10-1234-5678 → '01012345678'
   - 금액: ₩1,000원 → 1000 | 날짜: 20240101, 2024.01.01 → '2024-01-01'
2. **필드명 매핑** — `normalizeCustomerRecord()`에서 다양한 컬럼명을 표준 필드로 통일
   - raw.mobile / raw.phone_number / raw.tel → phone
   - raw.sex / raw.성별 → gender | raw.등급 / raw.membership → grade
3. **AI 동적 구성** — 고객사가 올린 데이터 기반으로 사용 가능한 변수 목록 생성 → AI 프롬프트에 주입

> **주의:** opt_in_sms(field_key) ↔ sms_opt_in(customers 컬럼) 등 이름 불일치는 standard-field-map.ts에서 처리. 컬럼명 변경 금지.

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

### 🟡 잔여 — 직원 버그리포트 실동작 검증 (코드 수정 전체 완료)
- [ ] **8차 B8-01~B8-13: 직원 실서비스 테스트** (app.hanjul.ai)
- [ ] **9차 S9-04/S9-08: 발송결과 조회 성능 + sent_at 정확성 확인**
- [ ] **D39 세션2 실동작 검증: 필터 UI + AI 보유필드 확인**

### ✅ 완료 — 표준 필드 아키텍처 통합 (D39)
- [x] 세션 0: DDL + standard-field-map.ts 재정의 (필수17+커스텀15)
- [x] 세션 1: upload.ts + normalize.ts 입구 정상화
- [x] 세션 2: customers.ts + Dashboard.tsx + ai.ts + AiCustomSendFlow.tsx 조회+AI 정상화

### 대시보드 리팩토링 Phase 3 (추후)
- [x] 직접 타겟 설정 모달 분리 — ✅ D43-3a DirectTargetFilterModal.tsx (729줄)
- [x] 직접 타겟 발송 모달 분리 — ✅ D43-3c TargetSendModal.tsx (901줄)
- Dashboard.tsx 누적 감소: 8,039줄 → 3,910줄 (총 4,129줄 감소)

### AI 맞춤한줄 Phase 2 (발송 연결) — ✅ 구현 완료 (문서 미갱신이었음, 2026-03-05 코드 검증)
- [x] 발송 확정 → AiCustomSendFlow.tsx Step 4 onConfirmSend 콜백으로 variant+targetFilters 전달
- [x] AiCampaignSendModal 연결 → Dashboard.tsx handleAiCustomSend에서 campaignsApi.create+send 호출
- [x] 전체 플로우 코드 구현 완료 (Step4 → 모달 → 캠페인생성 → targetFilter기반 고객조회 → 개인화치환 → MySQL INSERT)
- [ ] 실서비스 통합 테스트 (실제 발송 확인) — Harold님 검증 대기

### 카카오 알림톡 템플릿 관리 (Humuson API v2.1.1)
- [ ] 고객사 관리자(app.hanjul.ai) 템플릿 CRUD + 검수 프로세스 + 발신프로필 조회 + 관리 UI
- [ ] 슈퍼관리자(sys.hanjullo.com) 고객사별 Humuson 연동 설정 (humuson_user_id, uuid)
- [ ] 서비스 사용자(hanjul.ai) 캠페인 발송 시 APR 상태 템플릿만 선택
- [ ] 기술: 백엔드 프록시 /api/kakao-templates/*, DB kakao_templates 확장, 상태 전이 규칙
- [ ] Phase 2: 이미지 업로드, 알림 수신자 관리, 발신프로필 그룹

### 080 수신거부 (✅ 나래인터넷 콜백 연동 완료 — 2026-03-05)
- [x] 콜백 엔드포인트 구현 (고객사별 080번호 자동 매칭)
- [x] 토큰 검증 제거 — Nginx IP 화이트리스트(나래 6개 IP)로 보안 대체
- [x] Nginx 080callback 경로 나래 IP 화이트리스트 적용
- [x] D43-4 양방향 동기화: opt_out_auto_sync DDL + syncCustomerOptIn 헬퍼 + 4곳 적용
- [x] D43-4 프론트: 080번호 동적 표시 + 연동테스트 버튼 (auto_sync=true 조건부)
- [x] curl 로컬 테스트 정상 확인 (서버 `1` 반환)
- [x] 나래 담당자 콜백 URL 등록 확인 완료 (2026-03-05)
- [x] 실제 080 ARS 수신거부 테스트 — 나래 IP(183.98.207.13) 콜백 수신 + 수신거부 DB 등록 정상 확인
- [x] 기존 누적 수신거부 목록 — 한줄로 이관 시 수동 처리 예정 (벌크 동기화 불필요)

### 선불 요금제 Phase 1-B~2
- [ ] Phase 1-B: KCP PG 연동 (카드결제만, 가상계좌 제외)
- [ ] Phase 2: 입금감지 API 자동화

### Sync Agent
- [x] Sync Agent 코어 완성 (비토 v1.3.0 개발 완료)
- [x] 슈퍼관리자 SyncAgent API Key 관리 UI — ✅ D60 (2026-03-08): 고객사 편집 모달 9번째 탭. API Key/Secret 조회·재발급·비활성화, use_db_sync 토글. 백엔드 3개 엔드포인트 신규.
- [ ] sync_releases에 v1.3.0 릴리스 레코드 등록 (비토 최종 빌드 후)

### 보안
- [x] 소스 보호: 우클릭/F12/개발자도구/드래그 차단 (3개 도메인 전체 적용)
- [x] 🔴 MySQL 랜섬웨어 대응 (2026-02-28, D49): 외부 차단+비밀번호 강화+권한분리+fail2ban+포트차단 — 상세 내용 D43 안건#6 참조
- [x] 프론트엔드 난독화 — ✅ D61 (2026-03-08): vite-plugin-javascript-obfuscator 적용, production 빌드 시 stringArray+base64+disableConsoleOutput. frontend+company-frontend 양쪽 적용.
- [ ] 슈퍼관리자 IP 화이트리스트 설정
- [x] 외부 자동 백업 구축 — ✅ 2026-03-05 완료: pg_dump+mysqldump → 59번 서버(58.227.193.59) SCP 전송, SSH 키 인증, crontab 매일 03:00 KST, 7일 로컬 보관. 스크립트: /home/administrator/backups/backup.sh
- [x] 웹 애플리케이션 SQL Injection 점검 — ✅ D56 테이블명 화이트리스트 + D57-C4 sendTime 파라미터화 + D59 custom_fields JSONB 키 화이트리스트(3파일) + dateFilter 파라미터화 완료 (SSRF 별도)
- [ ] SSH 키 인증 전용 전환 (비밀번호 로그인 비활성화) — 선택

### 인비토AI (메시징 특화 모델)
- [x] ai_training_logs 테이블 + training-logger.ts + campaigns.ts 연결
- [ ] 이용약관에 비식별 데이터 활용 조항 추가
- [ ] 데이터 충분히 축적 후 모델 학습 파이프라인 설계

---

## 9) DECISION LOG (ADR Index)
> 항목이 10개를 초과하면 오래된 항목은 아카이브로 이동하고 1줄 요약만 남긴다.

| ID | 날짜 | 결정 | 근거 |
|----|------|------|------|
| D36 | 02-26 | MySQL 타임존 KST — 풀 레벨 보강 | 커넥션 풀 10개 중 1개만 TZ 설정되는 구조적 문제 |
| D37 | 02-26 | GPT 의견 수용 원칙 — 코드 근거 기반 판단 | GPT "미수정" 지적에 코드 확인 없이 동의→문서 오염 |
| D38 | 02-26 | 표준 필드 아키텍처 복구 — standard-field-map.ts 매핑 레이어 도입 | 4곳 하드코딩 불일치→필터 전멸+데이터 손실 |
| D39 | 02-26 | 표준 필드 아키텍처 재정의 — 필수 17개 + 커스텀 15개 확정 | 기존 41개→32개 정리. FIELD-INTEGRATION.md 기준 |
| D40 | 02-27 | AI 맞춤한줄 동적 필드 + UX 개선 — 커스텀 실데이터만 노출 + 톤 제거 + 필드명 표시 | enabled-fields 단일 경로+JSONB 실데이터만 반환 |
| D41 | 02-27 | 대시보드 동적 카드 시스템 — 슈퍼관리자 체크 설정 + FIELD_MAP 17개 기반 카드 풀 | 고객사마다 보유 데이터 다름. 하드코딩 고정→동적 전환. company_settings 활용, 4칸/8칸 모드 |
| D42 | 02-27 | 발송현황 하드코딩 제거 — VIP/30일매출 → 성공건수/평균성공률/총사용금액 | 발송현황 영역에 VIP·매출은 맥락 불일치. 발송 관련 지표로 통일 |
| D43 | 02-27 | 기능 정상화 및 DB 동적 기준 정립 — 5개 안건 (회사명/매핑UI/타겟필터/수신거부동기화/AI포맷) | D39 이후 미반영 기능 정상화. 발송 파이프라인 미접촉 |
| D44 | 02-27 | AI 매핑 화면 개편 — 컴포넌트 분리 + 태그 클릭 2열 그리드 + 커스텀 +/- | 하드코딩 드롭다운 16개→FIELD_MAP 동적 20개, Dashboard.tsx 310줄 분리 경량화 |
| D45 | 02-27 | AI 한줄로 3종 개선 — 개인화 필수 파싱 + 샘플 고객 미리보기 + 이모지 강제 제거 | 변수 오류 방지+미리보기 실감+SMS 깨짐 방지. 발송 파이프라인 무접촉 |
| D46 | 02-27 | 직접 타겟 설정 전면 리팩토링 — 컴포넌트 분리 + 전체 필드 노출 + 2열 컴팩트 + 다중선택 + 연령범위 | SKIP_FIELDS 제거(Harold님 확정), 사용자에게 필드 선택 위임. Dashboard 405줄 감소 |
| D47 | 02-27 | 직접 타겟 발송 모달 분리 + 하드코딩 8곳 동적화 + 커서위치 버그 수정 — TargetSendModal.tsx 신규 | fieldsMeta 기반 동적(자동입력/테이블/치환/바이트체크/미리보기). Dashboard 638줄 감소 |
| D48 | 02-27 | 수신거부 양방향 동기화 — plan_id 기준 customers.sms_opt_in 동시 UPDATE + opt_out_auto_sync 플래그 | unsubscribes=SoT, opt_outs 레거시 확인, 나래인터넷 전용 auto_sync 분기. 080번호 하드코딩 제거→동적 |
| D49 | 02-28 | 🔴 MySQL 랜섬웨어 긴급 대응 — 외부 차단+비밀번호 강화+권한 분리+보안 강화 | 3306 외부 노출→봇 공격→SMSQ 테이블 삭제. 127.0.0.1 바인딩+smsuser DROP 권한 제거+fail2ban+UFW 포트 차단. PostgreSQL 무사, 고객 데이터 유출 없음 |
| D50 | 02-28 | 결과코드 매핑 Phase 3 — 프론트 하드코딩 제거 + 백엔드 해석값 전달 | ResultsModal.tsx STATUS_CODE_MAP(14개)/CARRIER_MAP(9개) 하드코딩 삭제→백엔드 API가 sms-result-map.ts 기반 해석값 직접 전달. 프론트에 결과코드 매핑 로직 없음=불일치 불가 |
| D51 | 02-28 | 결과코드 매핑 Phase 4 — 3-Tier 전수 점검 완료 + admin.ts/billing.ts 전환 | admin.ts 5곳(statusMap7개+carrierMap3개 로컬 삭제→헬퍼 사용+statusType 추가) + billing.ts 5곳(3개 집계함수→상수참조) + `>=200` 버그 수정(실패 건수 누락). AdminDashboard.tsx statusType 동적 분기. ResultsModal.tsx sampleData 동적 치환. **18파일 점검, 하드코딩 잔존 0건** |
| D52 | 03-04 | 하드코딩 전수조사 + 동적 전환 + 설정 중앙집중화 (B11-01~05) | (1) campaigns.ts `'18008125'` 폴백→DB 필수화 (2) alert()→setToast 전면교체(40+곳) (3) ai.ts `'0807196700'`→DB 동적조회 (4) 단가 5파일→defaults.ts (5) AI모델명 4파일→AI_MODELS (6) Redis 4곳→공유인스턴스 (7) 타임아웃/배치/캐시TTL/RateLimit 12파일→중앙상수. **총 21건 전체 해소, 12파일 수정, 기간계 무접촉** |
| D53 | 03-04 | 요금제별 기능 게이팅 — 무료/스타터/베이직/프로/비즈니스 5단계 기능 잠금 | plans 테이블 3컬럼 추가(customer_db_enabled/spam_filter_enabled/ai_messaging_enabled). 백엔드 6파일 API 게이팅 + 프론트 5파일 UI 잠금. 무료=직접발송만, 스타터=+스팸필터+고객DB+타겟팅, 베이직=+AI발송, 프로=+AI분석basic, 비즈니스=+AI분석advanced. **기간계 무접촉** |
| D54 | 03-05 | 스팸필터 폴링 로직 개선 — QTmsg 성공 후 10초 대기→BLOCKED 판정 | 기존 3분 무조건 대기→QTmsg 성공 시점 추적(qtmsgSuccessTime Map)+10초 grace period. 타임아웃 180→60초. 이력 탭 추가. **기간계 무접촉** |
| D55 | 03-05 | 보안 긴급점검 + 슈퍼관리자 세션 관리 + 세션 타이머 UI | JWT_SECRET/MYSQL_PASSWORD fail-fast(폴백값 제거, 미설정 시 서버 기동 차단). mms-images.ts 자체 JWT→공용 authenticate. Math.random()→crypto.randomInt(). 슈퍼관리자 3중 구멍 수정(세션 미생성/세션체크 건너뛰기/프론트 감시 스킵→전부 해소, 30분 타임아웃). user_sessions.user_id FK 제거(DDL-D55, super_admins ID 허용). expires_at 서버측 만료 강제(브라우저 닫기→재오픈 시 서버 차단). dotenv.config() app.ts 최상단 이동. 은행 스타일 세션 타이머 UI 전체 사용자 적용. **코드+DDL+배포 완료. 기간계 무접촉** |
| D56 | 03-05 | P0-Q1 SQL Injection 방지 + 스팸필터 선불차감 누락 수정 | sms-table-validator.ts 신규(화이트리스트 정규식). admin.ts 라인그룹 생성/수정 API 입구 검증. campaigns.ts 환경변수 경고+DB 조회 필터링+prepaidDeduct/prepaidRefund export. spam-filter.ts 선불차감 추가(테스트폰×메시지타입 건수). 수정 3파일+신규 1파일. **기간계 무접촉. 배포+실서버 검증 완료** |
| D57 | 03-05 | P0-C1~C5 발송 파이프라인 안정화 5건 전체 구현 | **(C1)** AI발송+직접발송 per-customer/per-batch try/catch→sentCount 추적→부분실패 시 실패분만 선별적 환불(기존 all-or-nothing 제거). **(C2)** normalize-phone.ts 신규(normalizePhone 단일함수, `/\D/g` 비숫자 전체 제거)→campaigns.ts 27곳 `replace(/-/g,'')` 통일 교체+**directCustomerMap 키 불일치 핵심버그 수정**(L1962 raw phone→normalizePhone). **(C3)** calcSplitSendTime() 헬퍼 신규—SEND_HOURS.end 초과 시 다음날 start로 이월. defaults.ts SEND_HOURS 설정 추가(환경변수 SEND_START_HOUR/SEND_END_HOUR). 직접발송 SMS+카카오 2경로 적용. **(C4)** AI발송 sendTime `'${sendTime}'` 템플릿 리터럴→`?` 파라미터화(SQL Injection 차단). **(C5)** 테스트발송 bill_id `userId\|\|''`→`randomUUID()` 고유 추적ID+requestUid 통일+실패건 DB 기록+응답에 testRequestUid 반환. 수정 2파일(campaigns.ts, defaults.ts)+신규 1파일(normalize-phone.ts). TypeScript 0에러. **기간계 발송 흐름 자체는 변경 없음 — 에러 처리/환불/정규화 보강만** |
| D58 | 03-06 | 12차 버그리포트 4건 수정 + 기능개선 3건 — 예약취소 Agent 대응, 발송결과 타임아웃, 필터 UI 전면개선, 담당자테스트 | **(B12-01)** 예약취소 DELETE+UPDATE 이중처리(Agent 픽업건 9999 코드) **(B12-02)** sync-results 60분 타임아웃+환불 **(B12-03)** 스팸필터 subject 전달 **(B12-04)** 특수문자/보관함/저장 모달 공용화 **(F12-01)** AI 머지태그 원본 표시 **(F12-02)** 필터 UI: 성별 자동감지 패턴매칭(gender/sex/성별)+DB값 자동매핑(M/F/male/남/여/1/0→한글), 생일 월별 프리셋, 금액 최소~최대 범위입력(콤마포맷+원 단위+빠른선택+col-span-2), 수신자 테이블 성별 한글 표시 **(F12-03)** 타겟발송 담당자테스트 버튼(3열 그리드+10초 쿨다운). 수정 7파일. **기간계 무접촉** |
| D59 | 03-07 | 2차 코드 전수점검 P1~P6 총 28건 수정 — 정산정확성+SQL Injection+입력검증+하드코딩+인프라+프론트엔드 | **(P1)** ai.ts `\|\|10`→`??10`, analysis.ts 채널별 정확비용, manage-stats.ts dead code 삭제. **(P2)** safe-field-name.ts 신규+campaigns/customers/ai 3파일 custom_fields 화이트리스트+dateFilter 파라미터화. **(P3)** mms-images UUID검증, upload.ts path.basename, manage-users 비밀번호8~72자. **(P4)** SYSTEM_SMS_CALLBACK 환경변수화, INVITO_INFO 상수+billing 4곳교체, ©연도 동적화5곳, constants/company.ts 신규+15곳교체. **(P5)** Redis error handler, AI API 키 warn, process 에러핸들러(PM2 연계), PG Pool 환경변수설정. **(P6)** Dashboard setInterval cleanup, optOutNumber 안전장치, 교차중복발송방지, console.log삭제. 수정20파일+신규4파일. **기간계 무접촉. tsc 3패키지 전체 통과** |
| D60 | 03-08 | SyncAgent API Key 관리 UI + 사용자별 라인그룹 배정 | 상용화 온보딩 시 DB 직접 접근 불가→슈퍼관리자 UI 필요. 동일 회사 내 사용자간 발송 라인 공유→홀딩 문제. users.line_group_id 추가, getCompanySmsTables userId optional 확장. 기간계 기존 호출 100% 호환. |
| D61 | 03-08 | 프론트엔드 난독화 적용 | 상용화 전 소스 보호. vite-plugin-javascript-obfuscator production only. stringArray+base64+disableConsoleOutput. frontend+company-frontend 양쪽. |
| D67 | 03-12 | 080 콜백 진단 + 수신동의 변형 + 사용자별 고객DB 삭제 | 080 콜백 서버코드 정상 확인(나래측 URL 미등록 원인). 연동테스트 stale state 버그 수정. SMS_OPT_IN_FALSE 13개 변형 추가(비동의/불동의/거절/해지 등). admin.ts 사용자별 uploaded_by 기준 고객 삭제 API+UI. 기간계 무접촉 |
| D68 | 03-12 | 대시보드 UI 4건 + AI 생일 타겟팅 + 테스트 비용 합산 | (1) 총구매금액 $→CreditCard+천단위콤마 (2) 커스텀필드 라벨 is_hidden NULL 미매칭 수정 (3) AI 생일타겟팅: 프롬프트+customer-filter mixed+3경로 전부 birth_date 추가 (4) 발송현황 총사용금액에 담당자테스트+스팸필터 비용 합산. 메트로시티 가상DB 2만건 생성. 기간계 무접촉 |
| D69 | 03-12 | 자동발송 기능 기초 설계 | 메트로시티 요청. auto_campaigns+auto_campaign_runs 테이블 설계, PM2 워커+D-1 사전알림 아키텍처, 프론트 AutoSendPage(블러 프리뷰 게이팅)+DashboardHeader 메뉴 추가. 프로 이상 전용. company_user(브랜드담당자) 생성/수정/삭제 가능. 매월 28일 max. 기존 파이프라인(customer-filter, sms-queue, messageUtils) 100% 재활용. 설계문서: AUTO-SCHEDULE-DESIGN.md |

**아카이브:** D1-AI발송2분기(02-22) | D2-브리핑방식(02-22) | D3-개인화필드체크박스(02-22) | D4-textarea제거(02-22) | D5-별도컴포넌트분리(02-22) | D6-대시보드레이아웃(02-22) | D7-헤더탭스타일(02-23) | D8-AUTO/PRO뱃지(02-23) | D9-캘린더상태기준(02-23) | D10-6차세션분할(02-23) | D11-KCP전환(02-23) | D12-이용약관(02-23) | D13-수신거부SoT(02-23) | D14-7차3세션분할(02-24) | D15-제목머지→D28번복(02-25) | D16-스팸테스트과금(02-25) | D17-테스트통계확장(02-25) | D18-정산자체헬퍼(02-25) | D19-구독상태필드(02-25) | D20-AI분석차별화(02-25) | D21-planInfo실시간(02-25) | D22-스팸잠금직접발송만(02-25) | D23-preview보안(02-25) | D24-run세션1완전구현(02-25) | D25-pdfkit선택(02-25) | D26-분석캐싱24h(02-25) | D27-비즈니스3회최적화(02-25) | D28-제목머지제거(02-25) | D29-5경로전수점검(02-25) | D30-즉시sending전환(02-25) | D31-GPT fallback(02-25) | D32-발송파이프라인복구(02-26) | D33-messageUtils통합(02-26) | D34-스팸필터DB직접조회(02-26) | D35-선불환불보장(02-26) | D-대시보드모달분리(02-23): 8,039줄→4,964줄

---

## 10) ASSUMPTION LEDGER (가정 목록)

(아직 없음)

---

## 11) RISK REGISTER (리스크 목록)
| ID | 리스크 | 확률(1-5) | 영향(1-5) | 점수 | 대응 |
|----|--------|-----------|-----------|------|------|
| R1 | TypeScript 타입 에러 배포 → 서버 크래시 | 2 | 5 | 10 | 배포 전 tsc --noEmit 필수 체크 |
| R2 | DB 파괴적 작업 시 데이터 유실 | 2 | 5 | 10 | pg_dump 백업 후 작업, 트랜잭션 활용 |
| R3 | QTmsg sendreq_time UTC/KST 혼동 | 1 | 4 | 4 | ✅ 해결: database.ts 풀 레벨 KST 보장 |
| R4 | 라인그룹 미설정 고객사 → 전체 라인 폴백 오발송 | 1 | 5 | 5 | ✅ 해결: 이중 방어 적용 |
| R5 | QTmsg LIVE→LOG 이동 후 결과 조회 불가 | 1 | 4 | 4 | ✅ 해결: LIVE+LOG 통합 조회 |
| R6 | 스팸필터 동시 테스트 시 결과 충돌 | 1 | 4 | 4 | ✅ 해결: SHA-256 세션 격리 + 디바이스 fallback |
| R15 | 발송 5개 경로 치환 로직 분산 → 재발 | 1 | 5 | 5 | ✅ 해결: messageUtils.ts 통합 |
| R16 | results.ts 대량 캠페인 OOM | 1 | 4 | 4 | ✅ 해결: UNION ALL 서버측 페이지네이션 |
| R17 | 선불 차감 후 발송 실패 → 정산 이슈 | 1 | 5 | 5 | ✅ 해결: 3경로 prepaidRefund + D57 C1 선별적 환불(부분실패 정확 환불) |
| R21 | standard_fields ↔ 코드 하드코딩 불일치 | 1 | 5 | 5 | ✅ 해결: D39 3세션 완료 — FIELD_MAP 단일 기준 |
| R22 | MySQL 외부 노출 → 랜섬웨어/데이터 삭제 | 1 | 5 | 5 | ✅ 해결: D49 — 127.0.0.1 바인딩+smsuser DROP 제거+비밀번호 강화+fail2ban+UFW |
| R23 | Docker 컨테이너 재생성 시 포트 바인딩 0.0.0.0 실수 | 2 | 5 | 10 | ⚠️ 운영: 컨테이너 작업 시 반드시 `docker ps --format` 포트 확인. OPS.md에 안전 명령어 기록 |
| R24 | SQL Injection → 내부 DB 공격 (127.0.0.1 우회) | 1 | 5 | 5 | ✅ 해결: D56 테이블명 화이트리스트 + D57-C4 sendTime 파라미터화 + **D59 custom_fields JSONB 키 화이트리스트(safe-field-name.ts 신규, campaigns/customers/ai 3파일 적용) + dateFilter MySQL 파라미터화 + mms-images UUID 검증 + upload.ts path.basename 경로탐색 방어** |
| R29 | 스팸필터 테스트 선불 차감 누락 → 무과금 발송 | 1 | 3 | 3 | ✅ 해결: D56 — spam-filter.ts에 prepaidDeduct 적용, 테스트폰×메시지타입 건수 차감 |
| R26 | JWT_SECRET/MYSQL_PASSWORD 환경변수 누락 → 서버 기동 실패 | 1 | 5 | 5 | ✅ 해결: D55 — fail-fast 적용, 폴백값 완전 제거. dotenv.config() app.ts 최상단 이동으로 로딩 순서 보장 |
| R27 | 슈퍼관리자 세션 무제한 → 토큰 탈취 시 24시간 악용 | 1 | 5 | 5 | ✅ 해결: D55 — 세션 레코드 생성+30분 타임아웃+서버측 세션 체크 적용 |
| R28 | Math.random() 임시비밀번호 → 예측 가능 | 1 | 3 | 3 | ✅ 해결: D55 — crypto.randomInt() CSPRNG 교체 |
| R25 | 백업 부재 → 랜섬웨어 시 복구 불가 | 1 | 3 | 3 | ✅ 해결: 2026-03-05 — pg_dump+mysqldump 자동화, 59번 서버(58.227.193.59) SCP 전송, SSH 키 인증, crontab 매일 03:00, 7일 보관 |
| R30 | 전화번호 정규화 불일치 → 개인화 메시지 치환 실패 | 1 | 4 | 4 | ✅ 해결: D57 C2 — normalizePhone() 단일함수 통일, directCustomerMap 키 불일치 수정 |
| R31 | 분할발송 시간 오버플로우 → 심야/새벽 발송 | 1 | 4 | 4 | ✅ 해결: D57 C3 — calcSplitSendTime() SEND_HOURS 경계 체크, 환경변수 기반 |
| R32 | AI발송 sendTime SQL Injection | 1 | 5 | 5 | ✅ 해결: D57 C4 — 템플릿 리터럴 삽입 제거, ? 파라미터화 |
| R33 | 테스트발송 bill_id 빈문자열 → 결과 추적 불가 | 1 | 3 | 3 | ✅ 해결: D57 C5 — randomUUID() 고유 추적ID 생성 |
| R34 | Redis 연결 에러 → 서버 크래시 | 1 | 5 | 5 | ✅ 해결: D59 — redis.on('error') 에러 핸들러 추가 |
| R35 | unhandledRejection/uncaughtException → 로깅 없이 서버 크래시 | 1 | 5 | 5 | ✅ 해결: D59 — process.on 핸들러 추가, PM2 자동 재시작 연계 |
| R36 | PostgreSQL Pool 커넥션 부족/누수 | 1 | 4 | 4 | ✅ 해결: D59 — max/idleTimeout/connectionTimeout 환경변수 기반 설정 |
| R37 | 수신거부번호 미로딩 상태 발송 → 법적 문제 | 1 | 5 | 5 | ✅ 해결: D59 — optOutNumber 초기값 '' + 3개 발송함수 가드 |
| R38 | 발송 상태 플래그 교차 미체크 → 동시 발송 | 1 | 3 | 3 | ✅ 해결: D59 — isSending/directSending 교차체크 3곳 |

---

## 12) ✅ DONE LOG (완료 기록)
> 항목이 10개를 초과하면 오래된 항목은 아카이브로 이동하고 1줄 요약만 남긴다.
> 상세 변경 이력은 Git 커밋 히스토리 참고.

| 날짜 | 완료 항목 |
|------|----------|
| 03-08 | **D61 프론트엔드 난독화 적용:** vite-plugin-javascript-obfuscator — frontend+company-frontend 양쪽 vite.config.ts. production 빌드 시에만 활성화(mode === 'production'). stringArray+base64 인코딩, disableConsoleOutput, identifierNamesGenerator('hexadecimal'), splitStrings. 개발 환경(npm run dev) 무영향. 서버 배포 시 npm install 필요. |
| 03-08 | **D60 SyncAgent API Key 관리 + 사용자별 라인그룹 배정:** (1) SyncAgent: 고객사 편집 모달 9번째 탭 'Sync' 추가. 백엔드 3개 엔드포인트(GET sync-keys, POST regenerate, PUT use_db_sync 토글). 프론트 마스킹+보기/숨김+복사+2단계 재발급 확인 UI. (2) 사용자별 라인그룹: DDL users.line_group_id uuid FK nullable 추가(실행 완료). campaigns.ts getCompanySmsTables(companyId, userId?) 확장—사용자 개별 라인그룹 우선→회사 fallback. admin.ts 사용자 수정 API lineGroupId 추가+사용자 목록에 line_group_name 포함. 프론트 사용자 편집 모달에 라인그룹 드롭다운(슈퍼관리자 전용). 고객사 편집 모달 너비 max-w-lg→max-w-2xl+탭 UI 개선. 수정 3파일(admin.ts, campaigns.ts, AdminDashboard.tsx)+DDL 1건+신규 1파일(DDL-user-line-group.sql). **기간계: getCompanySmsTables userId optional 추가만, 기존 호출 100% 호환.** tsc 통과. |
| 03-07 | **D59 2차 코드 전수점검 P1~P6 총 28건 수정 완료:** **(P1 정산/데이터 3건)** ai.ts `\|\|10`→`??10` AI추정 0%치환 버그 수정. analysis.ts 하드코딩 `totalSent*15` 제거→채널별(SMS/LMS/MMS/KAKAO) getCompanyCosts() 정확 비용 계산. manage-stats.ts dead code 4줄 삭제. **(P2 SQL Injection 4건)** safe-field-name.ts 신규(custom_1~15 화이트리스트)→campaigns.ts buildFilterQuery, customers.ts buildDynamicFilter, ai.ts buildFilterWhereClause 3곳 적용. campaigns.ts dateFilter MySQL `?` 파라미터화+DATE_FORMAT 정규식 검증. **(P3 입력검증 3건)** mms-images.ts companyId UUID 정규식 검증. upload.ts `path.basename(fileId)` 디렉토리 탐색 방어. manage-users.ts 비밀번호 8~72자 bcrypt 안전 범위 검증. **(P4 하드코딩 5건)** admin.ts+manage-users.ts SMS 회신번호→`SYSTEM_SMS_CALLBACK` 환경변수(미설정 시 throw). defaults.ts `INVITO_INFO` 상수 신규+billing.ts PDF 2곳+이메일 2곳 import 교체. 프론트엔드 5곳 `©2026`→`©{new Date().getFullYear()}`. `constants/company.ts` 신규(frontend+company-frontend)+8파일 15곳 회사정보 상수 교체. **(P5 인프라 4건)** defaults.ts Redis error handler. ai.ts AI API 키 미설정 console.warn. app.ts unhandledRejection+uncaughtException PM2 연계. database.ts PG Pool max/idle/connection 환경변수 기반. **(P6 프론트 4건)** Dashboard.tsx setInterval→useRef+useEffect cleanup. optOutNumber 초기값''→미로딩 시 발송차단 가드 3곳. isSending/directSending 교차 중복 발송 방지 3곳. console.log 4줄 삭제. **(P7 장기 8건)** CODE-REVIEW-P7-BACKLOG.md 기록. 수정 20파일+신규 4파일. **기간계 무접촉. tsc backend+frontend+company-frontend 3패키지 전체 통과.** |
| 03-06 | **D58 12차 버그리포트 4건+기능개선 3건 전체 완료:** (B12-01) 예약취소 DELETE(pending)+UPDATE(Agent 픽업건→9999) 이중처리 (B12-02) sync-results 60분 타임아웃 강제완료+환불 (B12-03) 스팸필터 subject/firstRecipient 전달 (B12-04) 특수문자/보관함/저장 모달 showDirectSend 바깥 이동→공용화 (F12-01) AI 결과팝업 머지태그 원본 표시 (F12-02) 필터 UI 전면개선: 성별 자동감지(`isGenderField` 패턴매칭)+다양한 DB값 한글 매핑, 생일 월별 프리셋+`birth_month` 오퍼레이터, 금액 최소~최대 범위 입력(콤마포맷+'원' 단위+빠른선택 버튼+`col-span-2`+백엔드 `between` 대응), 수신자 테이블 `formatCellValue` 성별 한글 표시 (F12-03) 타겟발송 담당자테스트 버튼(3열 그리드+`handleTargetTestSend`+10초 쿨다운). 수정 7파일(campaigns.ts, Dashboard.tsx, TargetSendModal.tsx, DirectTargetFilterModal.tsx, AiCampaignResultPopup.tsx, CalendarModal.tsx, customers.ts). **기간계 무접촉.** |
| 03-05 | **나래 080 수신거부 콜백 연동 완료:** (1) 나래 담당자 콜백 URL 등록 확인 (2) 실제 080 ARS 테스트 — 나래 IP(183.98.207.13) 콜백 수신+수신거부 DB 등록 정상 (3) OPT_OUT_080_TOKEN 검증 제거→Nginx IP 화이트리스트(나래 6개 IP)로 보안 대체 (4) 기존 누적 수신거부: 한줄로 이관 시 수동 처리 예정. 수정 1파일(unsubscribes.ts). **기간계 무접촉.** |
| 03-05 | **D57 P0-C1~C5 발송 파이프라인 안정화 5건:** (C1) AI발송+직접발송 per-customer/per-batch try/catch→sentCount 추적→부분실패 선별적 환불. (C2) normalize-phone.ts 신규→campaigns.ts 27곳 통일+directCustomerMap 키 불일치 핵심버그 수정. (C3) calcSplitSendTime() SEND_HOURS 경계→오버플로우 방지, defaults.ts SEND_HOURS 추가. (C4) AI발송 sendTime `?` 파라미터화. (C5) 테스트발송 bill_id→randomUUID()+실패건 DB 기록+응답 testRequestUid. 수정 2파일(campaigns.ts, defaults.ts)+신규 1파일(normalize-phone.ts). TypeScript 0에러. **기간계 발송 흐름 자체 변경 없음** |
| 03-05 | **D56 P0-Q1 SQL Injection 방지 + 스팸필터 선불차감:** (1) sms-table-validator.ts 신규 — `/^SMSQ_SEND(_\d{1,3})?(_\d{4,8})?$/` 화이트리스트 정규식, validateSmsTable/validateSmsTables/isValidSmsTable 3함수 export. (2) admin.ts — POST/PUT `/api/admin/line-groups` 라인그룹 생성·수정 API에서 smsTables 검증, 잘못된 테이블명 400 거부. (3) campaigns.ts — 서버 기동 시 ALL_SMS_TABLES 검증(경고 로그, 기동 미차단) + getCompanySmsTables DB 조회 결과 필터링(잘못된 값 스킵→BULK_ONLY_TABLES 폴백) + prepaidDeduct/prepaidRefund export 추가. (4) spam-filter.ts — POST `/test`에 선불 잔액 차감 추가: testId 생성 후 prepaidDeduct(companyId, spamSendCount, spamDeductType, testId) 호출, 잔액 부족 시 402+테스트 cancelled, 응답에 deducted 금액 포함. 수정 3파일(admin.ts, campaigns.ts, spam-filter.ts)+신규 1파일(sms-table-validator.ts). TypeScript 타입 에러 0건. **기간계 무접촉. 배포+실서버 선불차감 로그 확인 완료.** |
| 03-05 | **D55 보안 긴급점검 + 슈퍼관리자 세션 관리 + 세션 타이머 UI (코드+DDL+배포 완료):** (1) JWT_SECRET fail-fast — auth.ts 미들웨어에서 환경변수 미설정 시 `process.exit(1)` 서버 기동 차단, 폴백값 `'dev-only-secret'` 제거. (2) mms-images.ts 자체 JWT 인증(`'your-secret-key'`) 완전 제거 → 공용 `authenticate` 미들웨어로 교체. (3) MYSQL_PASSWORD fail-fast — database.ts에서 미설정 시 `process.exit(1)`, 폴백값 `'sms123'` 제거. (4) dotenv.config() 로딩 순서 수정 — app.ts 최상단(1행)으로 이동, 모듈 import 전에 환경변수 로딩 보장. (5) Math.random()→crypto.randomInt() — admin.ts/manage-users.ts 임시비밀번호 생성을 암호학적 안전 난수로 교체. (6) 슈퍼관리자 세션 관리 — DDL-D55로 user_sessions.user_id FK 제거(super_admins ID INSERT 허용, 보안영향 없음=서버코드만 INSERT) + 로그인 시 user_sessions 레코드 생성+sessionId JWT 포함+기존 세션 무효화, auth.ts 미들웨어 `super_admin` 세션체크 건너뛰기 제거 + expires_at 서버측 만료 강제(브라우저 닫았다 열어도 서버가 차단), extend-session 슈퍼관리자 지원, defaults.ts `superAdminSessionMinutes: 30` (환경변수 변경 가능). (7) 프론트엔드 useSessionGuard 슈퍼관리자 스킵 제거 → 30초마다 서버 세션 체크. (8) 은행 스타일 세션 타이머 UI — SessionTimer.tsx 신규 컴포넌트(초록/주황/빨강 색상전환+5분미만 깜빡임+클릭 세션연장), SessionTimerContext Provider(App.tsx), DashboardHeader+AdminDashboard 양쪽 헤더에 삽입. 수정 12파일(app.ts, auth.ts미들웨어, auth.ts라우트, mms-images.ts, database.ts, defaults.ts, admin.ts, manage-users.ts, useSessionGuard.ts, useSessionTimeout.ts, App.tsx, DashboardHeader.tsx, AdminDashboard.tsx)+신규1파일(SessionTimer.tsx)+DDL 1건 실행 완료(`docker exec -it targetup-postgres psql -U targetup targetup`). **기간계 무접촉.** |
| 03-05 | **D54 스팸필터 폴링 로직 개선 + 이력 탭 추가:** (1) QTmsg 성공 후 3분 대기→10초 대기 후 BLOCKED 판정으로 변경 (qtmsgSuccessTime Map 기반 시점 추적, BLOCKED_GRACE_MS=10초). 실서버 테스트로 앱 ACK 즉시 수신 확인 후 Harold님과 합의. (2) 타임아웃 180초→60초(안전장치), 안전 강제종료 240초→90초 (defaults.ts). (3) 프론트 SpamFilterTestModal.tsx 카운트다운 180→60초 동기화. (4) SpamFilterTestModal에 **내 테스트 이력 탭** 추가 — `/api/spam-filter/tests?mine=true` 본인 필터 + 메시지 내용 반환 + 통신사별 판정결과 펼침 UI. 수정 3파일(spam-filter.ts, defaults.ts, SpamFilterTestModal.tsx). **기간계(발송파이프라인) 무접촉.** |
| 03-05 | **D53 DB 실행 완료 + 백업 자동화 구축 + AI 맞춤한줄 Phase 2 문서 정정:** (1) plans 테이블 3컬럼 ALTER TABLE + 6개 요금제 UPDATE 실서버 실행 완료 (2) 외부 백업 자동화 — pg_dump+mysqldump → 59번 서버(58.227.193.59:27616) SCP 전송, SSH 키 인증, crontab 매일 03:00, 7일 보관. R25 리스크 해소 (3) AI 맞춤한줄 Phase 2 코드 검증 — 실제로 발송 연결 전체 구현 완료 확인(AiCustomSendFlow→Dashboard→campaignsApi.create+send), STATUS.md Phase 2 항목 [x] 갱신 |
| 03-04 | **D53 요금제별 기능 게이팅 구현 + 배포 완료:** plans 테이블 3컬럼 추가(customer_db_enabled/spam_filter_enabled/ai_messaging_enabled)+5개 요금제+ENTERPRISE 플래그 설정. 백엔드 5파일 게이팅(companies.ts my-plan 확장, spam-filter.ts/ai.ts 3엔드포인트/upload.ts parse·save/customers.ts extract). 프론트 4파일(Dashboard.tsx PlanInfo 확장+하드코딩 가격체크 제거+3카드 잠금UI, DashboardHeader.tsx 캘린더 게이팅, PlanUpgradeModal.tsx 범용화 featureName/requiredPlan, SpamFilterLockModal.tsx 프로→스타터 텍스트 수정). tsc 에러 2건 수정(auth.ts jwt.sign 타입/campaigns.ts useIndividualCallback 선언순서). SCHEMA.md plans 테이블 반영. **기간계 무접촉.** |
| 03-04 | **프로젝트 루트 정리 (~1.51GB 확보):** 오래된 DB 백업 8개 삭제(backup_docker/for_server/utf8/before_sync/before_billing/before_maxusers/sync_phase4/20260214_kakao_enabled.sql, 총 1.46GB) + 일회성 SQL 패치 8개 삭제(fix_admin/fix_password/add_columns/update_schema/seed_customers/migration-phase1a/migration_plan_requests/sync_ddl.sql) + qtmsg_5agents.tgz(48MB) 삭제 + 빈 폴더 2개 삭제(files/, targetup-app/). git 히스토리 정리는 추후 결정 예정 |
| 03-04 | **10차 버그리포트 7건 전체 수정 (B10-01~07):** 직원 PDF 버그리포팅 기반. ①B10-01 🔴 customers.ts store_code 격리 누락 — GET `/`, POST `/filter`, GET `/filter-options`, GET `/enabled-fields` 4개 엔드포인트 `uploaded_by`→`store_codes` JOIN 패턴 통일 ②B10-07 🔴 campaigns.ts 회신번호 검증 UNION 누락 — `/:id/send`+`/direct-send` 2곳에 `sender_numbers UNION callback_numbers` 적용 ③B10-06 ai.ts 등급 하드코딩(`VIP,GOLD,SILVER,BRONZE`)→`SELECT DISTINCT` 실시간 조회+키워드맵 정리 ④B10-04 normalize.ts `normalizeDate()` 엑셀 시리얼넘버 변환 추가 ⑤B10-05 normalize.ts `isValidKoreanPhone()` 050x 안심번호 허용 ⑥B10-03 upload.ts AI 매핑 프롬프트 매장4필드 구분규칙 추가 ⑦B10-02 CustomerDBModal.tsx 커스텀필드 라벨 `fieldColumns` 조회 표시. **기간계 무접촉 확인.** 수정 6파일(campaigns.ts, normalize.ts, ai.ts, customers.ts, upload.ts, CustomerDBModal.tsx) |
| 03-04 | 스팸필터 테스트 LMS 제목 누락 수정: 전 구간(프론트→백엔드→MySQL)에서 subject가 빠져있던 문제. ①Dashboard.tsx spamFilterData 타입에 subject 추가+직접발송 스팸필터 호출에 directSubject 전달 ②SpamFilterTestModal.tsx subject prop 추가+API body에 subject 전달+LMS 미리보기에 제목 표시 ③spam-filter.ts req.body에서 subject 추출+insertSmsQueue에 title_str 컬럼 추가. ⚠️ PG spam_filter_tests에 subject/message_type 컬럼 미존재 확인(SCHEMA.md와 실제 DB 불일치) — PG INSERT는 기존 유지, MySQL title_str만 추가. 수정 3파일(spam-filter.ts, SpamFilterTestModal.tsx, Dashboard.tsx) |
| 02-28 | D43-7 Phase 4 결과코드 매핑 3-Tier 전수 점검 완료: **18파일 점검, 하드코딩 잔존 0건.** admin.ts 5곳 전환(statusMap7개+carrierMap3개 로컬삭제→getStatusLabel(22개)/getCarrierLabel(9개)+statusType 추가) + billing.ts 5곳 전환(3개 집계함수→SUCCESS_CODES_SQL/PENDING_CODES_SQL) + **billing.ts `>=200` 버그 수정**(비가입자7/Power-off8/스팸차단16 등 200미만 실패코드 정산 누락 해소). AdminDashboard.tsx statusType 동적분기. ResultsModal.tsx sampleData9개 삭제→messages[0].msg_contents 동적치환. 서비스/관리자/슈퍼관리자 프론트 12파일 점검 깨끗. 수정 4파일(admin.ts, billing.ts, AdminDashboard.tsx, ResultsModal.tsx) |
| 02-28 | 🔴 D49 MySQL 랜섬웨어 긴급 대응: 원인(3306 외부 노출+취약 비밀번호→봇 공격→SMSQ_SEND_1~11 삭제). 복구(127.0.0.1 바인딩+테이블 재생성+로그 테이블 복구+Agent 재시작+이벤트 스케줄러 확인). 보안 강화(root/smsuser 비밀번호 강화+Agent encrypt_pass DES 암호화 동기 변경+smsuser DROP 권한 제거+UFW 3000/9001~9011 차단+SSH root 로그인 차단+fail2ban 3회→1h밴). 피해: SMSQ 큐만 삭제(복구 완료), PostgreSQL/고객 데이터 무사. 스팸필터 테스트 LG U+ 수신 확인 |
| 02-27 | D43-4 수신거부 양방향 동기화: unsubscribes=SoT 확정, opt_outs 레거시 확인. syncCustomerOptIn 헬퍼+4곳(080콜백/직접추가/업로드/삭제) 적용. DDL opt_out_auto_sync 추가. 프론트 080번호 동적+연동테스트 조건부. curl 테스트 정상. **나래 콜백 미수신→월요일 확인.** 수정 2파일(unsubscribes.ts, Unsubscribes.tsx)+DDL 1건 |
| 02-27 | D43-3c 직접타겟 발송창 하드코딩 전면 제거 + 컴포넌트 분리: TargetSendModal.tsx 신규(901줄)+DirectTargetFilterModal.tsx FieldMeta export+onExtracted fieldsMeta 추가+Dashboard.tsx 638줄 감소(4548→3910)+DirectPreviewModal.tsx 동적치환. 하드코딩 8곳→fieldsMeta 동적. 커서위치 삽입 버그 수정(selectionStart). 발송파이프라인 미접촉 |
| 02-27 | D43-3b 직접타겟 백엔드 버그 3건 수정: ①extract SELECT 하드코딩→getColumnFields() FIELD_MAP 동적+customers_unified→customers 직접조회 ②filter-count도 customers_unified→customers 전환 ③buildDynamicFilter age 필터 EXTRACT(birth_date)→age 컬럼 직접사용 ④DirectTargetFilterModal 에러핸들링+커스텀알림모달 추가. 수정 2파일(customers.ts, DirectTargetFilterModal.tsx) |
| 02-27 | D43 안건#3 직접타겟 리팩토링: DirectTargetFilterModal.tsx 신규(646줄)+Dashboard.tsx 405줄 감소+customers.ts 옵션 동적화+extract SELECT 확장+buildDynamicFilter contains 지원. **🚨 타겟추출→발송모달 연결 버그 미해결 (다음 세션)** |
| 02-27 | D43 안건#5 AI 한줄로 3종 개선: ①개인화필수 파싱(services/ai.ts parsePersonalizationDirective) ②샘플고객 미리보기(routes/ai.ts sample_customer+Dashboard+AiCampaignResultPopup 동적 치환) ③이모지 강제제거(services/ai.ts stripEmojis, SMS/LMS/MMS 후처리). 수정 5파일 |
| 02-27 | D43 안건#2 AI 매핑 화면 개편: 컴포넌트 분리(FileUploadMappingModal.tsx 신규)+태그클릭 2열 그리드+커스텀 +/- 슬롯+upload.ts 백엔드 지원. 수정 3파일 |
| 02-27 | D43 안건#1 회사명 미반영 해결: auth.ts c.name→c.company_name 통일, companies.ts name동기수정+settings company_name추가, Dashboard.tsx DB실시간조회 우선표시. 수정 3파일 |
| 02-27 | D41 세션2 대시보드 대개편 완료 + D42 발송현황 수정: AdminDashboard.tsx 대시보드탭(4/8모드+17종체크)+Dashboard.tsx 고객현황 하드코딩 제거→동적카드+블러+발송현황 3칸(성공건수/성공률/사용금액). 수정 2파일 |
| 02-27 | D41 세션1 백엔드 API: dashboard-card-pool.ts(카드풀17종)+companies.ts(dashboard-cards 집계API)+admin.ts(카드설정 GET/PUT)+idx_company_settings_unique+plans 오염 수정. 신규1+수정2파일 |
| 02-27 | DashboardHeader.tsx AI 분석 메뉴 스타일 변경: 맨 앞 이동, Sparkles 아이콘 제거, gold+emphasized 유지 |
| 02-27 | AI 맞춤한줄 동적 필드 + Step 2 UX 개선 (D40): customers.ts enabled-fields 단일 경로, AiCustomSendFlow.tsx 톤 제거+필드명 태그, ai.ts tone optional. 수정 3파일 |
| 02-27 | D39 세션2 조회+AI 정상화 완료: customers.ts/ai.ts/Dashboard.tsx/AiCustomSendFlow.tsx 하드코딩 4곳 전수 제거→FIELD_MAP 동적. 수정 4파일 |
| 02-26 | D39 세션0+세션1 완료: DDL(store_phone)+standard_fields 32개+standard-field-map.ts 재작성+upload.ts+normalize.ts FIELD_MAP 기반 동적 전환 |
| 02-26 | 코드 실물 검증 5건 + S9-04/S9-08/GP-04 수정 + S9-07 모달 6곳 교체 + upload.ts sanitize/cleanup/인증 |

**아카이브 (02-26 이전):**
- 02-26: 구조적 결함 7건 발견 + D32 공통 치환 함수 통합(messageUtils.ts) + 5개 경로 연결
- 02-25: AI 분석 4세션 완료 + 요금제 기능 제한 + 구독 실시간 반영 + 스팸필터 잠금 + 8차 버그 13건 + GPT fallback + 대시보드 반응속도 개선
- 02-25: 발송통계 고도화 + 7차 3세션 완료 + 6차 11건 완료
- 02-24: 직원 버그리포트 7차 세션1(동적필드전환) + 요금제 게이지바 + 소스보호 + 어드민통계 수정 + 080연동
- 02-23: 대시보드 모달 분리(8039→4964줄) + 헤더 탭스타일 + 배포자동화 + 수신거부통합 + 6차 세션1
- 02-22: 대시보드 레이아웃 전면 개편 + AI 맞춤한줄 Phase 1 시작
- ~02-21: 수신거부 미반영 수정 + 스팸필터 완성 + 업로드 안정화 + 라인그룹 시스템
- ~02-10: 서버 인프라 전체 배포, 핵심 기능 완성, 슈퍼관리자·고객사관리자 대시보드, 정산 시스템, QTmsg Agent 5→11개
