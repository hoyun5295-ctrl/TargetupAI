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

### 🔧 D43 — 기능 정상화 및 DB 동적 기준 정립 (2026-02-27~)

> **배경:** D39 표준 필드 아키텍처 확립 후 아직 반영되지 않은 부분들이 존재. 기존 발송 파이프라인의 발송 흐름/차감/환불 로직은 절대 건드리지 않음 (D43-7에서 결과값 해석 로직만 sms-result-map.ts 중앙화 전환).
> **목표:** DB 기준에 맞게 기능을 정상화하고, 동적 데이터 흐름을 확립한다.
> **원칙:** 스키마 벗어나는 하드코딩 금지. 의논 → 검증 → 실행.

#### 안건 목록

| # | 안건 | 성격 | 난이도 | 상태 |
|---|------|------|--------|------|
| 1 | 대시보드 회사명 — 슈퍼관리자 수정이 반영 안 됨 | 버그 | 낮음 | ✅ 완료 |
| 2 | AI 매핑 화면 개편 — 표준 17개 명확 나열 + 커스텀 필드 라벨 지정 | 기능개편 | 중간 | ✅ 완료 |
| 3 | 직접 타겟 설정 — enabled-fields 기반 동적 필터 조건 | 기능개발 | 중간 | ✅ 완료 |
| 4 | 수신거부 양방향 동기화 (독립 관리 vs DB 연동) | 설계+구현 | 높음 | ⏸️ 나래 콜백 미수신 |
| 5 | AI 한줄로 입력 포맷 강제화 + 샘플 고객 미리보기 + 이모지 제거 | 기능개선 | 중간 | ✅ 완료 |
| 6 | 🚨 긴급: 스팸필터 테스트 안됨 (원인: MySQL 랜섬웨어) | 인프라/보안 | 높음 | ✅ 완료 |
| 7 | 결과값 매핑 중앙화 — sms-result-map.ts 컨트롤타워 | 구조개선 | 높음 | 🔧 백엔드 완료 · 프론트 잔여 |

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

#### 안건 #4: 수신거부 양방향 동기화 — ⏸️ 나래 콜백 미수신 (D43-4, 2026-02-27)

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
- **미해결 — 나래인터넷 콜백 미수신:**
  - curl 로컬 테스트: ✅ 정상 (`1` 반환)
  - Nginx 화이트리스트: ✅ 정상 (나래 IP 6개 등록)
  - 나래에서 콜백 요청 자체가 서버에 안 옴 (Nginx access.log 무기록)
  - **월요일 확인 필요:** 나래 담당자에게 콜백 URL 등록 완료 여부 + 현재 등록된 URL 확인
  - 등록 요청 URL: `https://hanjul.ai/api/unsubscribes/080callback` + 파라미터 cid/fr/token
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

#### 안건 #7: 결과값 매핑 중앙화 — sms-result-map.ts 컨트롤타워 — 🔧 백엔드 완료 (D43-7, 2026-02-28)

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
- **잔여 작업 (다음 세션):**
  - ResultsModal.tsx L8-24 `STATUS_CODE_MAP` 하드코딩 잔존 → 백엔드 API에서 해석된 값 전달로 전환 또는 import 정리
  - ResultsModal.tsx L26-30 `CARRIER_MAP` 하드코딩 잔존 → 동일
  - campaigns.ts 8곳 실제 코드 확인 (가이드 기반 Harold님 수정분)
- **수정 파일 5개:** sms-result-map.ts(신규), campaigns.ts, results.ts, spam-filter.ts, ResultsModal.tsx
- **기간계 수정:** campaigns.ts, results.ts, spam-filter.ts는 결과값 해석 로직만 변경 (발송 흐름/차감/환불 로직 미접촉)

#### 진행 순서 (Harold님 확정)

1. ~~**#1** 대시보드 회사명 (빠른 해결)~~ ✅ 완료
2. ~~**#2** AI 매핑 화면 개편 (컴포넌트 분리 + 태그 클릭 UI)~~ ✅ 완료
3. ~~**#5** AI 한줄로 포맷 강제화 + 미리보기 + 이모지 제거~~ ✅ 완료
4. ~~**#3** 직접 타겟 설정~~ ✅ 완료 (백엔드 버그 수정 + 발송창 하드코딩 전면 제거)
5. ~~**#4** 수신거부 동기화~~ ⏸️ 코드 완료, 나래 콜백 미수신 → 월요일 나래 확인
6. ~~**🚨 #6 긴급: 스팸필터 테스트 안됨**~~ ✅ 완료 — 원인: MySQL 랜섬웨어 공격 (D49 보안 대응)
7. **#7** 결과값 매핑 중앙화 — 백엔드 완료 · **프론트 잔여 2곳 + campaigns.ts 실코드 확인** ← 다음 세션

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
| D43 안건#4 수신거부 동기화 | ⏸️ 코드 완료 · 나래 콜백 미수신 → 월요일 확인 |
| D43 안건#5 AI 포맷+미리보기+이모지 | ✅ 완료 |
| D43 안건#7 결과값 매핑 중앙화 | 🔧 백엔드 완료 · 프론트 잔여 2곳 |
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
| results.ts | 발송 결과 조회 + MySQL LIVE/LOG 통합 | D43-7: statusCodeMap/carrierMap 6곳 → sms-result-map.ts import |
| billing.ts | 정산·거래내역서 PDF | 미수정 |
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

**참조 파일:** campaigns.ts, results.ts, spam-filter.ts (백엔드 전환 완료), ResultsModal.tsx (프론트 잔여 2곳)

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

### 080 수신거부 (⏸️ 나래인터넷 콜백 미수신 — 월요일 확인)
- [x] 콜백 엔드포인트 구현 (토큰 인증, 고객사별 080번호 자동 매칭)
- [x] 서버 .env OPT_OUT_080_TOKEN 설정 + PM2 재시작
- [x] Nginx 080callback 경로 나래 IP 화이트리스트 적용
- [x] D43-4 양방향 동기화: opt_out_auto_sync DDL + syncCustomerOptIn 헬퍼 + 4곳 적용
- [x] D43-4 프론트: 080번호 동적 표시 + 연동테스트 버튼 (auto_sync=true 조건부)
- [x] curl 로컬 테스트 정상 확인 (서버 `1` 반환)
- [ ] **나래 담당자에게 콜백 URL 등록 완료 여부 확인** (월요일)
- [ ] 실제 080 ARS 수신거부 테스트 (080-719-6700)
- [ ] 기존 누적 수신거부 목록 초기 동기화 (벌크 API 또는 엑셀)

### 선불 요금제 Phase 1-B~2
- [ ] Phase 1-B: KCP PG 연동 (카드결제만, 가상계좌 제외)
- [ ] Phase 2: 입금감지 API 자동화

### Sync Agent
- [x] Sync Agent 코어 완성 (비토 v1.3.0 개발 완료)
- [ ] sync_releases에 v1.3.0 릴리스 레코드 등록 (비토 최종 빌드 후)

### 보안
- [x] 소스 보호: 우클릭/F12/개발자도구/드래그 차단 (3개 도메인 전체 적용)
- [x] 🔴 MySQL 랜섬웨어 대응 (2026-02-28, D49): 외부 차단+비밀번호 강화+권한분리+fail2ban+포트차단 — 상세 내용 D43 안건#6 참조
- [ ] 프론트엔드 난독화 (vite-plugin-obfuscator, 런칭 직전 적용)
- [ ] 슈퍼관리자 IP 화이트리스트 설정
- [ ] 외부 자동 백업 구축 (3-2-1 법칙: 3복사본, 2매체, 1오프라인)
- [ ] 웹 애플리케이션 SQL Injection 점검 (SSRF 포함)
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
| R17 | 선불 차감 후 발송 실패 → 정산 이슈 | 1 | 5 | 5 | ✅ 해결: 3경로 prepaidRefund |
| R21 | standard_fields ↔ 코드 하드코딩 불일치 | 1 | 5 | 5 | ✅ 해결: D39 3세션 완료 — FIELD_MAP 단일 기준 |
| R22 | MySQL 외부 노출 → 랜섬웨어/데이터 삭제 | 1 | 5 | 5 | ✅ 해결: D49 — 127.0.0.1 바인딩+smsuser DROP 제거+비밀번호 강화+fail2ban+UFW |
| R23 | Docker 컨테이너 재생성 시 포트 바인딩 0.0.0.0 실수 | 2 | 5 | 10 | ⚠️ 운영: 컨테이너 작업 시 반드시 `docker ps --format` 포트 확인. OPS.md에 안전 명령어 기록 |
| R24 | SQL Injection → 내부 DB 공격 (127.0.0.1 우회) | 2 | 5 | 10 | ⬜ 미조치: 웹 애플리케이션 SQLi 점검 필요 |
| R25 | 백업 부재 → 랜섬웨어 시 복구 불가 | 3 | 5 | 15 | ⬜ 미조치: 외부 자동 백업(3-2-1 법칙) 구축 필요 |

---

## 12) ✅ DONE LOG (완료 기록)
> 항목이 10개를 초과하면 오래된 항목은 아카이브로 이동하고 1줄 요약만 남긴다.
> 상세 변경 이력은 Git 커밋 히스토리 참고.

| 날짜 | 완료 항목 |
|------|----------|
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
