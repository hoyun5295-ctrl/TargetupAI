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
> **배경:** 직원 버그리포트 6차 (2026-02-23) — 총 11건, 2세션 분할 수정

---

### 현재 목표: 직원 버그리포트 6차 수정 (11건)

---

### ✅ 세션 1 완료: AI 맞춤한줄 고도화 + 회신번호 UI (6건)

> **수정 파일 4개:**
> - `packages/frontend/src/components/AiCustomSendFlow.tsx` — 완성 파일 교체
> - `packages/frontend/src/components/AiCampaignSendModal.tsx` — 완성 파일 교체
> - `packages/backend/src/services/ai.ts` — 완성 파일 교체
> - `packages/backend/src/routes/ai.ts` — 완성 파일 교체

#### ✅ 버그 #1 — AI 맞춤한줄 개인화 변수 오류 (수정 완료)
- **증상:** 선택한 필드 중 이름만 적용, 매장명/회신번호 누락. 요청 안 한 %성별% 포함
- **원인:** AI 프롬프트 변수 제한 지시 불충분 + 미선택 변수 strip 불완전
- **수정:**
  - `services/ai.ts`: AI 프롬프트에 "허용된 변수 목록만 사용, 목록 외 변수 사용 시 사고 발생" 엄격 지시 추가
  - `services/ai.ts`: validatePersonalizationVars 후 미허용 변수 제거 시 주변 공백/쉼표 정리 강화
  - `AiCustomSendFlow.tsx`: Step 4 미리보기 변수 검증 로직 개선

#### ✅ 버그 #4 — SMS AI 문구 90바이트 초과 (수정 완료)
- **증상:** SMS 채널 선택 시 90바이트 넘는 문안 생성 → 그대로 SMS 예약됨
- **수정:**
  - `services/ai.ts`: calculateKoreanBytes() 함수 추가 + SMS 바이트 초과 시 서버 경고 로그
  - `AiCustomSendFlow.tsx`: Step 4에서 SMS 90바이트 초과 시 빨간 경고 배너 표시 + 발송 확정 시 차단

#### ✅ 버그 #8 — AI 맞춤한줄 광고표기 고정 + MMS 누락 (수정 완료)
- **증상:** 광고 여부 ON/OFF 선택 불가 (고정 "예"). MMS 채널 선택지 없음
- **수정:**
  - `AiCustomSendFlow.tsx`: Step 2에 isAd 토글 추가 + 발송 채널에 MMS 옵션 추가
  - `services/ai.ts`: smsByteInstruction에 MMS 분기 추가 + LMS 프롬프트 조건에 MMS 포함

#### ✅ 버그 #9 — AI 맞춤한줄 타겟 추출 0명 + 수정 미반영 (수정 완료)
- **증상:** 브리핑에서 "실버 여성 고객" 파싱 → DB에 실버 있는데 0명
- **원인:** `routes/ai.ts` buildFilterWhereClause에서 gender 필터가 **중복 적용** (getGenderVariants + buildGenderFilter 둘 다 실행 → SQL 파라미터 인덱스 어긋남)
- **수정:**
  - `routes/ai.ts`: gender 중복 필터 제거 → buildGenderFilter만 유지
  - `routes/ai.ts`: parse-briefing, generate-custom에 누락된 authenticate 미들웨어 추가
  - `AiCustomSendFlow.tsx`: Step 3 "수정완료" 버튼 클릭 시 `/api/ai/recount-target` 재조회 trigger + 로딩 스피너

#### ✅ 버그 #10 — 회신번호 드롭다운 매장명만 표시 (수정 완료)
- **증상:** 발신번호 선택 시 전화번호 안 보이고 매장명만 나옴
- **수정:** `AiCampaignSendModal.tsx` 드롭다운 label → `전화번호 (매장명)` 형식으로 변경

#### ✅ 버그 #11 — 개별회신번호 1건인데 선택 허용 (수정 완료)
- **증상:** 등록 회신번호 1건인데 "개별회신번호" 옵션 선택 가능 → 의미 없음
- **수정:** `AiCampaignSendModal.tsx` 회신번호 2건 이상일 때만 "개별회신번호" 옵션 노출

---

### 📦 세션 2: 예약대기 + 수신거부 + 발송/캘린더 (5건) — 다음 세션 진행

> **필요 파일 (Harold님 업로드):**
> - `packages/frontend/src/pages/DashboardPage.tsx` (또는 분리된 ScheduledCampaignModal.tsx, CalendarModal.tsx)
> - `packages/backend/src/routes/campaigns.ts`
> - `packages/backend/src/routes/customers.ts`
> - `packages/frontend/src/components/` — 관련 모달 파일들

#### 버그 #2 — 예약대기 LMS 제목/회신번호 미표시 + 문안수정 제목 삭제 무시
- **증상:** 예약대기 모달에서 LMS 제목, 회신번호 안 보임. 제목 삭제 후 저장 → 성공 뜨지만 미반영
- **수정 파일:** 예약대기 모달 (DashboardPage 또는 ScheduledCampaignModal)
- **수정 내용:**
  1. 예약 캠페인 상세 영역에 subject(제목), callback_number 표시 추가
  2. 회신번호 개별화 건: 수신자별 회신번호 확인 UI
  3. 제목 머지변수 사용 시: 수신자 클릭 → 치환된 제목 미리보기
- **수정 파일:** 문안수정 핸들러 (프론트 + 백엔드)
- **수정 내용:**
  4. LMS/MMS인데 제목 빈칸으로 수정 시도 → "LMS는 제목이 필수입니다" 경고 모달, 저장 차단
  5. 백엔드에서도 subject 빈 문자열 reject (message_type이 LMS/MMS인 경우)

#### 버그 #3 — 예약 시간변경 과거 시간 허용 → 유령 예약
- **증상:** 현재 오후 2시인데 오후 1시로 변경 가능. 변경 후 예약 상태지만 발송 안 되고 취소도 안 됨
- **수정 파일:** 예약시간 변경 UI (프론트)
- **수정 내용:**
  1. datetime input의 min값: 현재 시간 + 15분 이후만 선택 가능
  2. 과거 시간 선택 시 즉시 경고 ("현재 시간 이후로만 변경 가능합니다")
- **수정 파일:** `routes/campaigns.ts` — 시간변경 API
- **수정 내용:**
  3. `scheduled_at < NOW() + interval '15 minutes'` 이면 400 reject
  4. 이미 과거 시간인 유령 예약 건: 캘린더에서 취소 가능하도록 예외 처리 (강제 취소)

#### 버그 #5 — 캘린더 상태 표기 기준
- **증상:** 즉시발송 완료인데 "실패"로 표시. 부분 성공 시 상태 불명확
- **결정 (Harold님 확정):**
  - 발송 처리 완료 → **"완료"** (문자는 실패 건 항상 존재하는 게 정상, 상세에서 성공/실패 건수 확인)
  - **"실패"** = 시스템 에러로 발송 자체가 진행 안 된 경우만
  - **"취소"** = 명확하게 취소 표시
- **수정 파일:** `routes/campaigns.ts` — 결과 sync 후 상태 판정 로직
- **수정 내용:**
  1. 상태 판정: sent_count > 0 이면 → "completed" (완료)
  2. sent_count = 0 이고 fail_count > 0 → "failed" (실패)
  3. cancelled_at 있으면 → "cancelled" (취소)
- **수정 파일:** 캘린더 모달 (CalendarModal 또는 DashboardPage)
- **수정 내용:**
  4. 상태 뱃지 색상: 완료=초록, 실패=빨강, 취소=회색, 예약=파랑, 진행=주황
  5. 상세 패널에 성공/실패 건수 함께 표시 (예: "완료 · 성공 1,500 / 실패 300")

#### 버그 #6 — 대시보드 수신거부 건수 미표시
- **증상:** 고객 현황에서 수신거부 `-`로 표시 (실제 데이터 있음)
- **수정 파일:** `routes/customers.ts` 또는 stats API
- **수정 내용:**
  1. stats 쿼리에 수신거부 건수 추가: `unsubscribes` 테이블 COUNT 또는 `customers WHERE is_opt_out = true`
- **수정 파일:** `DashboardPage.tsx`
- **수정 내용:**
  2. 수신거부 `-` → 실제 건수 바인딩

#### 버그 #7 — 고객 DB 조회 수신거부 필터 미작동
- **증상:** "거부" 필터 선택 → 전체 리스트 표시 (필터 안 먹힘)
- **수정 파일:** `routes/customers.ts` — 목록 조회 API
- **수정 내용:**
  1. 수신거부 필터 파라미터(opt_out=true 등) 전달 확인
  2. WHERE 조건에 `unsubscribes` 조인 또는 `is_opt_out = true` 조건 추가
- **수정 파일:** 프론트 — 고객 DB 조회 모달
- **수정 내용:**
  3. "거부" 버튼 클릭 시 API 파라미터 정확히 전달되는지 확인

---

### 완료 기준 (DoD)
- [x] 세션 1: 버그 #1, #4, #8, #9, #10, #11 수정 완료 — 배포 진행 중
- [ ] 세션 2: 버그 #2, #3, #5, #6, #7 수정 + 배포 + 직원 재테스트
- [x] TypeScript 타입 에러 없이 컴파일 (세션 1)
- [ ] 기존 기능 회귀 없음 (직원 재테스트 대기)

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
(현재 없음)

### 대시보드 리팩토링 Phase 3 (추후)
- [ ] 직접 타겟 설정 모달 분리 (578줄, state 30+개 직접 참조)
- [ ] 직접 타겟 발송 모달 분리 (1,888줄, handler 10+개 깊은 결합, 전용 세션 필요)

### 대시보드 고객활동현황 백엔드 연동
- [ ] stats API 확장: 이번 달 신규가입, 30일 내 구매, 90일+ 미구매, 이번 달 수신거부, 이번 달 재구매
- [ ] 수신거부 수 stats에 포함
- [ ] 프론트엔드 `-` → 실제 데이터 연결

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

### 080 수신거부
- [ ] 나래인터넷에 콜백 URL + 토큰 키값 전달
- [ ] 나래에 확인: 콜백 실패 재시도 정책, 수신거부 목록 조회 API 여부
- [ ] Nginx 080callback 경로 나래 IP 화이트리스트 (121.156.104.161~165, 183.98.207.13)
- [ ] 실제 080 ARS 수신거부 테스트 (080-719-6700)

### 선불 요금제 Phase 1-B~2
- [ ] Phase 1-B: 토스페이먼츠 PG 연동 (카드결제/가상계좌 충전)
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
- [ ] 추천 템플릿 8개 → 실용적 활용 예시로 개선 (직원 의견 수렴 후)

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
| D1 | 02-22 | AI 발송 2분기: "AI 한줄로" (기존) + "AI 맞춤한줄" (신규 개인화) | 대시보드 3메뉴 유지, AI추천발송 클릭 시 모달에서 분기. 메뉴 4개 확장보다 진입 후 선택이 UX상 자연스러움 |
| D2 | 02-22 | 프로모션 입력 = "브리핑 방식" (자연어 → AI 파싱 → 카드 확인) | 폼은 번거롭고 자유텍스트는 부정확. 말하듯이 쓰면 AI가 구조화해서 보여주는 중간 방식이 최적 |
| D3 | 02-22 | 개인화 필드 = DB 필드 체크박스 선택 방식 | AI에게 명확한 지시 가능, 마케터가 어떤 데이터를 활용하는지 가시적 |
| D4 | 02-22 | 대시보드 textarea 제거 → 분기 모달 내에서 각각 입력 | 각 플로우가 독립적으로 자기 맥락에 맞는 입력창을 가짐 |
| D5 | 02-22 | 신규 코드는 별도 컴포넌트로 분리 (대시보드 최소 수정) | 대시보드 7,800줄, 회귀 리스크 최소화. AiCustomSendFlow.tsx 독립 |
| D6 | 02-22 | 대시보드 좌60%/우40% flex 레이아웃 + 고객활동현황(B+C 융합) | grid-cols-4로는 75:25밖에 안됨. 활동현황=마케터 행동으로 이어지는 핵심 지표 |
| D7 | 02-23 | 대시보드 헤더: 버튼형 → 텍스트 탭 스타일 (아이콘 제거, 녹/금/회 색상) | 홈페이지 탭 스타일 참고, SaaS 고급감 확보 |
| D8 | 02-23 | AI 발송 분기 뱃지: 기존/NEW → AUTO/PRO | 오픈 시 동시 출시이므로 "기존"은 부적절. 간편/정교 성격 구분 |
| D9 | 02-23 | 캘린더 상태 기준: 완료(발송처리됨)/실패(시스템에러)/취소(명시취소) 3단계 | 문자는 실패 건 항상 존재하는 게 정상. 부분성공도 "완료"로 표시, 상세에서 건수 확인 |
| D10 | 02-23 | 직원 버그리포트 6차 수정 2세션 분할: 세션1=맞춤한줄+회신번호(6건), 세션2=예약+수신거부+캘린더(5건) | 파일 의존성 기준 그룹핑. 맞춤한줄이 가장 크고 긴급 |

**아카이브:** D-대시보드 모달 분리(02-23): 8,039줄→4,964줄, 직접타겟 모달은 결합도 높아 추후 전용 세션

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

---

## 12) ✅ DONE LOG (완료 기록)
> 항목이 10개를 초과하면 오래된 항목은 아카이브로 이동하고 1줄 요약만 남긴다.
> 상세 변경 이력은 Git 커밋 히스토리 참고.

| 날짜 | 완료 항목 |
|------|----------|
| 02-23 | 직원 버그리포트 6차 세션1 완료 (6건): AI 맞춤한줄 변수강화(#1), SMS 바이트체크(#4), 광고토글+MMS지원(#8), gender중복필터수정→타겟0명해결(#9), 회신번호 전화번호표시(#10), 개별회신번호 조건부노출(#11). 수정 파일: AiCustomSendFlow.tsx, AiCampaignSendModal.tsx, services/ai.ts, routes/ai.ts. 핵심 발견: routes/ai.ts gender 필터 중복적용이 타겟 0명의 근본 원인 |
| 02-23 | 대시보드 모달 분리 Session 2: 11개 컴포넌트 추출. Dashboard.tsx 7,056줄→4,964줄. TypeScript 타입체크 통과, 서버 배포 완료 |
| 02-23 | 대시보드 헤더 탭스타일 리뉴얼 (DashboardHeader 컴포넌트 분리, 아이콘 제거, 녹색/금색 번갈아 텍스트+밑줄 애니메이션, 로그아웃 회색) + AI 발송 뱃지 기존/NEW → AUTO/PRO 변경 |
| 02-22 | 대시보드 레이아웃 전면 개편: 좌60%/우40% 구조, 고객현황 보강(수신거부+활동현황5지표), 요금제 카드 개선, 하단4카드, 녹색/노란색 테두리, 우측버튼 폰트확대 |
| 02-22 | AI 맞춤한줄 Phase 1 시작: AiSendTypeModal 분기 모달 + DashboardPage textarea 제거/연결 + AI-CUSTOM-SEND.md 작업문서 |
| 02-21 | 수신거부 미반영 버그 수정 (대시보드/DB조회/상세/필터/직접타겟 전체 unsubscribes 통합) + AI 080번호 COALESCE 적용 |
| 02-20 | 스팸필터 테스트 시스템 완성 (3대 SMS/LMS 수신, 15초 폴링, 로그 테이블 양쪽 조회) |
| 02-19 | 업로드 안정화 (BATCH 500, 백그라운드, 11,228건 전량 성공) + customers UNIQUE 키 변경 |
| 02-19 | 수신거부 user_id 전환 + 브랜드/매장 필터 전체 통합 + 직원 버그리포트 5차 |
| 02-19 | AI 학습 데이터 수집 시스템 (ai_training_logs + training-logger.ts + campaigns 연결) |

**아카이브 (02-19 이전 요약):**
- ~02-19: 스팸필터 판정 고도화 + 스팸한줄 앱 LMS + 080치환 제거 + 타겟직접발송 버그 수정
- ~02-13: AI 캠페인확정 모달 분리 + AI 메시지 선택 인덱스 수정 + 스팸필터 테스트 시스템 (DB + 백엔드 + Android 앱)
- ~02-12: 발송 라인그룹 시스템 (Agent 총 11개) + MMS 이미지 첨부 + 충전 관리 통합 뷰 + 직원 버그리포트 2~4차
- ~02-11: Sync Agent Phase 2 + 보안 강화 + 직원 버그리포트 1차 + 로고 적용 + SMS 바이트 처리
- ~02-10: 서버 인프라 전체 배포, 도메인 3분리, 법률/규정, 핵심 기능 완성, 슈퍼관리자·고객사관리자 대시보드, 정산 시스템, QTmsg Agent 5개, Sync Agent Phase 1, 선불/후불 요금제 Phase 1-A
