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

### 🔧 D43 — 기능 정상화 및 DB 동적 기준 정립 (2026-02-27~)

> **배경:** D39 표준 필드 아키텍처 확립 후 아직 반영되지 않은 부분들이 존재. 기존 발송 파이프라인(campaigns.ts, spam-filter.ts, messageUtils.ts, results.ts, billing.ts)은 절대 건드리지 않음.
> **목표:** DB 기준에 맞게 기능을 정상화하고, 동적 데이터 흐름을 확립한다.
> **원칙:** 스키마 벗어나는 하드코딩 금지. 의논 → 검증 → 실행.

#### 안건 목록

| # | 안건 | 성격 | 난이도 | 상태 |
|---|------|------|--------|------|
| 1 | 대시보드 회사명 — 슈퍼관리자 수정이 반영 안 됨 | 버그 | 낮음 | 대기 |
| 2 | AI 매핑 화면 개편 — 표준 17개 명확 나열 + 커스텀 필드 라벨 지정 | 기능개편 | 중간 | 대기 |
| 3 | 직접 타겟 설정 — enabled-fields 기반 동적 필터 조건 | 기능개발 | 중간 | 대기 |
| 4 | 수신거부 양방향 동기화 (독립 관리 vs DB 연동) | 설계토의 | 높음 | 대기 |
| 5 | AI 한줄로 입력 포맷 강제화 — "개인화 필수: 필드1, 필드2" | 기능개선 | 낮~중간 | 대기 |

#### 안건 #1: 대시보드 회사명 미반영

- **증상:** 슈퍼관리자에서 회사명 → "테스트계정" 수정 완료했으나, 대시보드 좌측 상단에 "디버깅테스트" 표시
- **원인 추정:** Dashboard.tsx가 companies 테이블 실시간 조회가 아닌 로그인 시점 세션/토큰 저장값 사용
- **수정 방향:** companies 테이블에서 실시간 조회 또는 세션 갱신 로직 추가

#### 안건 #2: AI 매핑 결과 화면 개편

- **현재 문제:** 칸이 크고 공간 활용 부족, 표준 17개 기준 불명확, 커스텀 필드 배정 불가
- **수정 방향:**
  - 상단: 표준 필수 17개 필드 기준 나열 → 엑셀 컬럼 매핑
  - 하단: 17개에 안 맞는 나머지 → custom_1~15 슬롯 배정 + **라벨명 직접 입력** (예: "마일리지")
  - 레이아웃 컴팩트하게 재설계
- **저장:** customers.custom_fields JSONB + `customer_field_definitions` 테이블에 라벨 저장

#### 안건 #3: 직접 타겟 설정 동적 필터

- **현재 문제:** 필터 조건이 "수신동의 고객만 포함" 체크박스 하나뿐, 실제 DB 필터링 안 먹음
- **수정 방향:**
  - enabled-fields API로 해당 고객사의 실제 업로드 필드 목록 조회
  - 필드별 필터 조건 설정 (예: 성별=여성, 등급=GOLD, 지역=서울)
  - 조건 조합 → 대상 인원 조회 (실제 DB 쿼리)
  - 수신동의 체크 기본 유지

#### 안건 #4: 수신거부 양방향 동기화 (설계 토의 필요)

- **시나리오 A (DB 미저장 업체):** 수신거부자를 독립 등록/관리, 직접발송 시 자동 제외
- **시나리오 B (DB 업로드 업체):**
  - 업로드 시 sms_opt_in=false → opt_outs에 자동 등록
  - opt_outs에서 제거 → customers.sms_opt_in=true 양방향 동기화
- **핵심 과제:** 두 시나리오가 공존해야 함. 고객 DB 삭제 시 수신거부 데이터 처리 기준 필요
- **관련 테이블:** opt_outs, customers.sms_opt_in, unsubscribes

#### 안건 #5: AI 한줄로 입력 포맷 강제화

- **현재 문제:** AI 한줄로(일반)가 고객사 DB 전체 필드를 통으로 바라봄 → 오류 확률 높음
- **Harold님 방향 확정:**
  - 입력 포맷: `[프로모션 내용] + 개인화 필수: 필드1, 필드2, ...`
  - 예시: `전체고객 30%할인행사 2월27일~3월1일 개인화 필수: 고객명, 등급`
  - "개인화 필수:" 뒤 쉼표 구분 필드만 파싱 → AI 프롬프트에 허용 변수로 전달
  - AI는 해당 변수만 사용하여 문안 생성 + 치환
- **효과:** 맞춤한줄과 동일 수준의 변수 제한, "한 줄로 쓰기" UX 유지

#### 진행 순서 (Harold님 확정)

1. **#1** 대시보드 회사명 (빠른 해결)
2. **#5** AI 한줄로 포맷 강제화 (백엔드 프롬프트 수정 위주)
3. **#2** AI 매핑 화면 개편 (프론트 UI 핵심)
4. **#3** 직접 타겟 설정 (enabled-fields + 동적 쿼리)
5. **#4** 수신거부 동기화 (설계 깊이 논의 후 구현)

→ 각 안건을 별도 채팅 세션에서 설계→컨펌→구현→테스트→정립 후 다음으로 진행

#### ⛔ 진행 규칙
- 기존 발송 파이프라인 절대 건드리지 않음
- 코드 작성 전 Harold님 컨펌 필수
- SCHEMA.md에 없는 컬럼 임의 생성 금지
- standard-field-map.ts가 유일한 매핑 기준
- 의논 → 검증 → 실행 순서 엄수

---

### ✅ 이전 완료 요약

> - 2026-02-27 (7차) D41+D42 완료 — 대시보드 동적 카드 시스템 전체 개편 + 발송현황 하드코딩 제거
> - 2026-02-27 (6차) D41 세션2 완료 + D42 발송현황 하드코딩 제거 — AdminDashboard.tsx 대시보드탭 추가, Dashboard.tsx 고객현황 하드코딩 제거→동적카드+블러, 발송현황 VIP/30일매출→성공건수/평균성공률/총사용금액
> - 2026-02-27 (5차) 중진공 실사 대비 데모 고객DB 10,000명 엑셀 생성
> - 2026-02-27 (4차) D41 세션1 백엔드 API 완료 — dashboard-card-pool.ts 신규 + companies.ts dashboard-cards API + admin.ts 카드 설정 API + UNIQUE 인덱스 + plans 테이블 오염 수정
> - 2026-02-27 (3차) DashboardHeader.tsx AI 분석 메뉴 스타일 변경 — 맨 앞 이동, Sparkles 제거, gold+emphasized 유지
> - 2026-02-27 (2차) AI 맞춤한줄 동적 필드 + Step 2 UX 개선 — customers.ts enabled-fields API 단일 경로 전환, AiCustomSendFlow.tsx 톤 제거+필드명 태그, ai.ts tone optional
> - 2026-02-27 (1차) D39 세션2 조회+AI 정상화 — customers.ts/ai.ts/Dashboard.tsx/AiCustomSendFlow.tsx 하드코딩 전수 제거
> - 2026-02-26 (5차) D39 세션1 입구 정상화 — upload.ts+normalize.ts FIELD_MAP 기반 동적 전환
> - 2026-02-26 (4차) D39 세션0 DDL+standard-field-map.ts 재정의
> - 2026-02-26 (1~3차) 코드 실물 검증 + S9-04/S9-08/GP-04 수정 + S9-07 모달 교체 + upload.ts 보안
> - 8차 버그 13건 + 9차 8건 + GPT P0 5건 — 코드 수정 전체 완료, 2단계 실동작 검증 대기
> - AI 분석 4세션 완료 (DDL+API+프론트+프롬프트+캐싱+PDF+데모데이터)
> - 요금제 기능 제한 + 구독 실시간 반영 완료
> - D39 표준 필드 아키텍처 통합 3세션 전체 완료

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
- **Phase 1 (현재):** SMS/LMS/MMS 실발송 안정화 + 슈퍼관리자 + 서비스 사용자 대시보드
- **Phase 2:** 카카오톡 알림톡/친구톡 통합, 결제 시스템(KCP), 요금제 구독 플로우
- **Phase 3:** Sync Agent 연동, RCS, 이메일, 푸시알림 멀티채널 확장, AI 고도화

### 5-4. 핵심 경쟁력 (특허 + 인프라)
- **통신사 인프라:** 11개 QTmsg Agent + 3대 통신사 직접 연동
- **AI 타겟팅:** 자연어 → DB 쿼리 → 자동 발송 파이프라인 (특허 출원)
- **스팸필터 검증:** Android 앱 기반 3사 자동 스팸 판정 시스템 (특허 출원)
- **9년 도메인 전문성:** 209B+ 누적 매출, 150+ 기업 고객

---

## 6) 🏗️ 시스템 아키텍처

### 6-1. 도메인 구조

| 도메인 | 용도 | 기술 |
|--------|------|------|
| hanjul.ai | 서비스 사용자 (메인) | React SPA |
| app.hanjul.ai | 고객사 관리자 | React SPA |
| sys.hanjullo.com | 슈퍼관리자 | React SPA |

### 6-2. 기술 스택

| 구분 | 기술 |
|------|------|
| 프론트엔드 | React 18 + TypeScript + Vite + Tailwind CSS |
| 백엔드 | Node.js + Express + TypeScript |
| DB (앱) | PostgreSQL 15 (Docker) |
| DB (발송) | MySQL 5.7 (QTmsg Agent별) |
| 캐시 | Redis |
| AI | Claude API (claude-sonnet-4-20250514) |
| 결제 | TossPayments + KCP |
| SMS | QTmsg (11개 Agent) |
| 카카오 | Humuson API v2.1.1 |
| 프로세스 | PM2 |
| 컨테이너 | Docker (PostgreSQL/Redis) |

### 6-3. 발송 파이프라인 (5개 경로)

> ⚠️ **D43 진행 중에도 아래 5개 경로는 절대 건드리지 않음**

| 경로 | 엔드포인트 | 용도 |
|------|-----------|------|
| AI 발송 | POST /:id/send | AI 캠페인 발송 |
| 직접발송 | POST /direct-send | 직접 타겟 발송 |
| 테스트 | POST /test-send | 테스트 발송 |
| 스팸필터 | spam-filter/test | 스팸 판정 |
| 예약 | scheduled | 예약 발송 수정 |

공통 치환: `messageUtils.ts` — extractVarCatalog() + replaceVariables()

---

## 7) 핵심 비즈니스 로직

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
- [ ] 직접 타겟 설정 모달 분리 (578줄, state 30+개 직접 참조)
- [ ] 직접 타겟 발송 모달 분리 (1,888줄, handler 10+개 깊은 결합, 전용 세션 필요)

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
- [x] Nginx 080callback 경로 나래 IP 화이트리스트 적용
- [ ] 나래 응답 후: 실제 080 ARS 수신거부 테스트 (080-719-6700)
- [ ] 기존 누적 수신거부 목록 초기 동기화 (벌크 API 또는 엑셀)

### 선불 요금제 Phase 1-B~2
- [ ] Phase 1-B: KCP PG 연동 (카드결제만, 가상계좌 제외)
- [ ] Phase 2: 입금감지 API 자동화

### Sync Agent
- [x] Sync Agent 코어 완성 (비토 v1.3.0 개발 완료)
- [ ] sync_releases에 v1.3.0 릴리스 레코드 등록 (비토 최종 빌드 후)

### 보안
- [x] 소스 보호: 우클릭/F12/개발자도구/드래그 차단 (3개 도메인 전체 적용)
- [ ] 프론트엔드 난독화 (vite-plugin-obfuscator, 런칭 직전 적용)
- [ ] 슈퍼관리자 IP 화이트리스트 설정

### 인비토AI (메시징 특화 모델)
- [x] ai_training_logs 테이블 + training-logger.ts + campaigns.ts 연결
- [ ] 이용약관에 비식별 데이터 활용 조항 추가
- [ ] 데이터 충분히 축적 후 모델 학습 파이프라인 설계

---

## 9) DECISION LOG (ADR Index)
> 항목이 10개를 초과하면 오래된 항목은 아카이브로 이동하고 1줄 요약만 남긴다.

| ID | 날짜 | 결정 | 근거 |
|----|------|------|------|
| D34 | 02-26 | 스팸필터/테스트 서버 DB 직접 조회 전환 | 프론트 하드코딩 치환이 근본 원인 |
| D35 | 02-26 | 선불 차감 후 발송 실패 시 자동 환불 보장 | 차감→MySQL INSERT 사이 실패 시 정산 이슈 |
| D36 | 02-26 | MySQL 타임존 KST — 풀 레벨 보강 | 커넥션 풀 10개 중 1개만 TZ 설정되는 구조적 문제 |
| D37 | 02-26 | GPT 의견 수용 원칙 — 코드 근거 기반 판단 | GPT "미수정" 지적에 코드 확인 없이 동의→문서 오염 |
| D38 | 02-26 | 표준 필드 아키텍처 복구 — standard-field-map.ts 매핑 레이어 도입 | 4곳 하드코딩 불일치→필터 전멸+데이터 손실 |
| D39 | 02-26 | 표준 필드 아키텍처 재정의 — 필수 17개 + 커스텀 15개 확정 | 기존 41개→32개 정리. FIELD-INTEGRATION.md 기준 |
| D40 | 02-27 | AI 맞춤한줄 동적 필드 + UX 개선 — 커스텀 실데이터만 노출 + 톤 제거 + 필드명 표시 | enabled-fields 단일 경로+JSONB 실데이터만 반환 |
| D41 | 02-27 | 대시보드 동적 카드 시스템 — 슈퍼관리자 체크 설정 + FIELD_MAP 17개 기반 카드 풀 | 고객사마다 보유 데이터 다름. 하드코딩 고정→동적 전환. company_settings 활용, 4칸/8칸 모드 |
| D42 | 02-27 | 발송현황 하드코딩 제거 — VIP/30일매출 → 성공건수/평균성공률/총사용금액 | 발송현황 영역에 VIP·매출은 맥락 불일치. 발송 관련 지표로 통일 |
| D43 | 02-27 | 기능 정상화 및 DB 동적 기준 정립 — 5개 안건 (회사명/매핑UI/타겟필터/수신거부동기화/AI포맷) | D39 이후 미반영 기능 정상화. 발송 파이프라인 미접촉 |

**아카이브:** D1-AI발송2분기(02-22) | D2-브리핑방식(02-22) | D3-개인화필드체크박스(02-22) | D4-textarea제거(02-22) | D5-별도컴포넌트분리(02-22) | D6-대시보드레이아웃(02-22) | D7-헤더탭스타일(02-23) | D8-AUTO/PRO뱃지(02-23) | D9-캘린더상태기준(02-23) | D10-6차세션분할(02-23) | D11-KCP전환(02-23) | D12-이용약관(02-23) | D13-수신거부SoT(02-23) | D14-7차3세션분할(02-24) | D15-제목머지→D28번복(02-25) | D16-스팸테스트과금(02-25) | D17-테스트통계확장(02-25) | D18-정산자체헬퍼(02-25) | D19-구독상태필드(02-25) | D20-AI분석차별화(02-25) | D21-planInfo실시간(02-25) | D22-스팸잠금직접발송만(02-25) | D23-preview보안(02-25) | D24-run세션1완전구현(02-25) | D25-pdfkit선택(02-25) | D26-분석캐싱24h(02-25) | D27-비즈니스3회최적화(02-25) | D28-제목머지제거(02-25) | D29-5경로전수점검(02-25) | D30-즉시sending전환(02-25) | D31-GPT fallback(02-25) | D32-발송파이프라인복구(02-26) | D33-messageUtils통합(02-26) | D-대시보드모달분리(02-23): 8,039줄→4,964줄

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
| R17 | 선불 차감 후 발송 실패 → 정산 이슈 | 1 | 5 | 5 | ✅ 해결: 3경로 prepaidRefund |
| R21 | standard_fields ↔ 코드 하드코딩 불일치 | 1 | 5 | 5 | ✅ 해결: D39 3세션 완료 — FIELD_MAP 단일 기준 |

---

## 12) ✅ DONE LOG (완료 기록)
> 항목이 10개를 초과하면 오래된 항목은 아카이브로 이동하고 1줄 요약만 남긴다.
> 상세 변경 이력은 Git 커밋 히스토리 참고.

| 날짜 | 완료 항목 |
|------|----------|
| 02-27 | D41 세션2 대시보드 대개편 완료 + D42 발송현황 수정: AdminDashboard.tsx 대시보드탭(4/8모드+17종체크)+Dashboard.tsx 고객현황 하드코딩 제거→동적카드+블러+발송현황 3칸(성공건수/성공률/사용금액). 수정 2파일 |
| 02-27 | D41 세션1 백엔드 API: dashboard-card-pool.ts(카드풀17종)+companies.ts(dashboard-cards 집계API)+admin.ts(카드설정 GET/PUT)+idx_company_settings_unique+plans 오염 수정. 신규1+수정2파일 |
| 02-27 | DashboardHeader.tsx AI 분석 메뉴 스타일 변경: 맨 앞 이동, Sparkles 아이콘 제거, gold+emphasized 유지 |
| 02-27 | AI 맞춤한줄 동적 필드 + Step 2 UX 개선 (D40): customers.ts enabled-fields 단일 경로, AiCustomSendFlow.tsx 톤 제거+필드명 태그, ai.ts tone optional. 수정 3파일 |
| 02-27 | D39 세션2 조회+AI 정상화 완료: customers.ts/ai.ts/Dashboard.tsx/AiCustomSendFlow.tsx 하드코딩 4곳 전수 제거→FIELD_MAP 동적. 수정 4파일 |
| 02-26 | D39 세션0+세션1 완료: DDL(store_phone)+standard_fields 32개+standard-field-map.ts 재작성+upload.ts+normalize.ts FIELD_MAP 기반 동적 전환 |
| 02-26 | 코드 실물 검증 5건 + S9-04/S9-08/GP-04 수정 + S9-07 모달 6곳 교체 + upload.ts sanitize/cleanup/인증 |
| 02-26 | 구조적 결함 7건 발견 + D32 공통 치환 함수 통합(messageUtils.ts) + 5개 경로 연결 |
| 02-25 | AI 분석 4세션 완료 (DDL+API+프론트AnalysisModal+프롬프트+캐싱+PDF+데모데이터) |
| 02-25 | 요금제 기능 제한 + 구독 실시간 반영 + 스팸필터 잠금 완료 |
| 02-25 | 8차 버그 13건 전체 수정 + 1단계 코드 검증 통과 (2단계 실동작 검증 대기) |
| 02-25 | GPT fallback 구현 + 대시보드 반응속도 개선(gzip+Redis캐싱) + Sync Agent 보안 + 정산 멀티테이블 |

**아카이브 (02-25 이전):**
- 02-25: 발송통계 고도화 + 7차 3세션 완료 + 6차 11건 완료
- 02-24: 직원 버그리포트 7차 세션1(동적필드전환) + 요금제 게이지바 + 소스보호 + 어드민통계 수정 + 080연동
- 02-23: 대시보드 모달 분리(8039→4964줄) + 헤더 탭스타일 + 배포자동화 + 수신거부통합 + 6차 세션1
- 02-22: 대시보드 레이아웃 전면 개편 + AI 맞춤한줄 Phase 1 시작
- ~02-21: 수신거부 미반영 수정 + 스팸필터 완성 + 업로드 안정화 + 라인그룹 시스템
- ~02-10: 서버 인프라 전체 배포, 핵심 기능 완성, 슈퍼관리자·고객사관리자 대시보드, 정산 시스템, QTmsg Agent 5→11개
