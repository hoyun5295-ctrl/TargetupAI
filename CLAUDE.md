# TargetUp (한줄로) 프로젝트 — AI 에이전트 온보딩

> 이 문서는 새 세션이 프로젝트를 즉시 이해하고 작업할 수 있도록 핵심 컨텍스트를 담고 있다.
> 작업 전 반드시 이 문서를 읽고, 필요에 따라 아래 참조 문서를 추가로 읽는다.

---

## 1. 프로젝트 개요

- **서비스명:** 한줄로 (TargetUp) — SMS/LMS/MMS 마케팅 자동화 SaaS
- **도메인:** hanjul.ai (서비스), app.hanjul.ai (고객사 관리자), sys.hanjullo.com (슈퍼관리자)
- **스택:** Node.js/Express + React + TypeScript, PostgreSQL(메인DB) + MySQL(QTmsg SMS 발송)
- **상태:** 상용화 직전. 기간계 안정성 최우선.

---

## 2. 경로 정보

| 구분 | 경로 |
|------|------|
| **로컬** | `C:\Users\ceo\projects\targetup` |
| **서버** | `ssh administrator@58.227.193.62` → `/home/administrator/targetup-app/` |
| **배포** | Harold님 로컬 PowerShell에서 `tp-push` → `tp-deploy-full` 실행 (AI가 직접 실행 불가). ⚠️ tp-deploy-full = git pull → **백엔드 빌드(tsc)** → 프론트 빌드 → pm2 restart |

---

## 3. 필수 참조 문서 (status/ 폴더)

| 문서 | 용도 | 언제 읽나 |
|------|------|-----------|
| **STATUS.md** | 전체 프로젝트 현황 + CURRENT_TASK + 아키텍처 상세 | **매 세션 시작 시 반드시** |
| **BUGS.md** | 버그 트래커 (발견→분석→수정→검증 전 이력) | 버그 수정 작업 시 |
| **OPS.md** | 서버/배포/인프라/파일구조/Nginx/SSL | 서버 관련 작업 시 |
| **SCHEMA.md** | PostgreSQL/MySQL 전체 DB 스키마 | 쿼리 작성/DB 작업 시 |
| **FIELD-INTEGRATION.md** | 필드 매핑 통합 기준 문서 | 필드/매핑 관련 작업 시 |

---

## 4. 절대 운영 원칙

### 4-1. Harold님 컨펌 필수
- 코드 작성 전 반드시 **현황 파악 → 설계안 제시 → Harold님 동의 → 구현** 순서.
- 뭐든 실행하기 전에 주인님과 논의하고 결정된 사항만 작업한다.
- Harold님께 항상 **존댓말(경어)** 사용. 호칭은 "Harold님".

### 4-2. 하드코딩 절대 금지
- 경로, 값, 설정 등 모든 곳에서 환경변수나 설정파일을 통해 관리한다.
- 필드 매핑은 `standard-field-map.ts` 한 곳에서만 정의. 나머지는 import.
- SCHEMA.md에 없는 컬럼명/타입을 코드에서 임의 생성 절대 금지.

### 4-3. 기간계 무접촉
- 발송 INSERT, 포인트 차감/환불, 인증 등 핵심 시스템은 최우선 안정성 보장.
- 기간계 수정이 필요하면 반드시 Harold님과 사전 협의.

### 4-4. 땜질 코딩 금지
- 상용화 서비스를 곧 진행할 중요한 프로젝트. 체계적이고 검증된 코드만 반영.
- 에러 발생 시 임의로 코드를 덧붙이지 않는다. 근본 원인부터 파악.

### 4-5. worktree 절대 사용 금지
- 과거 worktree 사용으로 수정이 메인코드에 미반영되는 사고 발생.
- **반드시 `packages/` 메인코드에 직접 수정**한다.
- `.claude/worktrees/` 폴더는 사용하지 않는다.

### 4-6. 타입 에러 없는 코드만 배포
- TypeScript 타입 에러 있는 코드 배포 = 서버 크래시 = 서비스 장애 (실제 장애 교훈).

### 4-7. 버그 수정은 하나씩 세심하게
- **에이전트 병렬 사용 금지** — 여러 버그를 동시에 병렬로 분석/수정하지 않는다.
- **하나씩 천천히 뜯어보고 제대로 체크** — 한 건씩 코드를 직접 읽고, 근본 원인을 정확히 파악한 후 수정한다.
- 병렬로 대충 보다가 빠뜨리는 게 반복되어 온 패턴. 느려도 정확하게.

---

## 5. 핵심 아키텍처 (이것만 알면 코드 수정 가능)

### 5-1. SMS 발송 5개 경로 (campaigns.ts)

campaigns.ts에 5개 발송 경로가 **한 파일에** 존재한다:

1. `POST /` — AI 캠페인 생성
2. `POST /:id/send` — AI 캠페인 발송
3. `POST /direct-send` — 직접발송 (즉시)
4. `POST /test-send` — 테스트발송
5. `POST /:id/schedule` — 예약발송

**⚠️ 과거 재발 패턴:** "5개 경로 중 1개만 패치하고 나머지 4개를 점검하지 않음" → 동일 버그 재발.
**해결:** messageUtils.ts의 `replaceVariables()` 공통 치환 함수로 5경로 통합 (D32~D33).
**원칙:** 발송 관련 수정 시 반드시 5개 경로 전부 확인.

### 5-2. 동적 필드 매핑 체계 ("기준은 하나, 입구는 여럿")

```
standard-field-map.ts (FIELD_MAP) ← 유일한 기준
    ↓ import
├── upload.ts     — 엑셀 업로드 (입구)
├── sync.ts       — SyncAgent 동기화 (입구)
├── normalize.ts  — 값 변환 (정규화)
├── customers.ts  — 고객 조회/관리 (출구)
├── campaigns.ts  — 발송 시 고객 조회 (출구)
├── ai.ts         — AI 메시지 생성 (출구)
└── Dashboard.tsx — UI 표시 (출구)
```

- **필수 직접 컬럼 17개:** name, phone, gender, age, birth_date, email, address, recent_purchase_store, store_code, registration_type, registered_store, store_phone, recent_purchase_amount, total_purchase_amount, grade, points, sms_opt_in
- **커스텀 슬롯 15개:** custom_1 ~ custom_15 (custom_fields JSONB)
- **customer_field_definitions 테이블:** 고객사별 커스텀 필드 라벨 정의
- **customer_schema (companies 테이블 JSONB):** 업로드 시 매핑/라벨 메타데이터

### 5-3. 발송 결과값 매핑 (sms-result-map.ts)

QTmsg status_code, 통신사 코드, 스팸필터 판정 결과를 한 곳에서 정의:
- STATUS_CODE_MAP — 성공(6/1000/1800), 대기(100/104), 실패(7/8/16/55/2008 등)
- CARRIER_MAP — 통신사명
- SPAM_RESULT — 스팸필터 판정 상수
- 헬퍼: isSuccess(), isFail(), isPending(), getStatusLabel() 등

### 5-4. 변수 치환 시스템 (messageUtils.ts)

`replaceVariables(message, customer, companyInfo)` — 메시지 내 `%고객명%`, `%매장명%` 등의 변수를 실제 고객 데이터로 치환.
- 5개 발송 경로 전부 이 함수 사용.
- 새 변수 추가 시 이 함수만 수정하면 전 경로 자동 반영.

### 5-5. 멀티테넌트 격리

- **company_id:** 회사 단위 데이터 격리 (모든 테이블)
- **store_code:** 매장 단위 추가 격리 (다매장 고객사)
- **user_id:** 사용자 단위 (브랜드별 수신거부 등)
- 쿼리 작성 시 반드시 company_id 조건 포함.

### 5-6. 컨트롤타워 체계 (utils/ 폴더)

> **원칙:** 각 도메인의 핵심 로직은 컨트롤타워 유틸 1곳에만 존재. 라우트는 import해서 사용.

#### CT-01: customer-filter.ts — 고객 필터/쿼리 빌더
- **역할:** campaigns.ts, customers.ts, ai.ts 3곳의 중복 WHERE 절 생성을 한 곳으로 통합
- **설계:** tableAlias 옵션으로 접두사 제어, store_code는 호출부 위임(skipStoreCode), KST 기준 나이 계산, 커스텀 필드 8개 연산자 지원
- **주요 함수:** `buildCustomerFilter()`, `buildFilterQueryCompat()`, `buildDynamicFilterCompat()`, `buildFilterWhereClauseCompat()`
- **지원 필드:** gender, age, grade, region, points, total_purchase_amount, recent_purchase_date, birth_date(birth_month 연산자), store_code, store_name, custom_fields.*
- **⚠️ D68 교훈:** mixed 형식(AI/campaigns용)과 structured 형식(customers용) 양쪽에 새 필드 핸들러를 추가해야 함. 한쪽만 추가하면 AI 필터가 무시됨.
- **적용 파일:** campaigns.ts, customers.ts, ai.ts

#### CT-02: store-scope.ts — 브랜드(store_code) 격리
- **역할:** 사용자별 매장 접근 범위를 결정하는 유일한 진입점
- **판정 로직:**
  - 브랜드 체계 없는 회사(단일 본사) → `no_filter` (company_id 전체)
  - 브랜드 체계 있음 + store_codes 할당된 사용자 → `filtered` (해당 store만)
  - 브랜드 체계 있는데 미할당 → `blocked` (차단)
- **주요 함수:** `getStoreScope(companyId, userId)` → `StoreScopeResult`
- **적용 파일:** campaigns.ts, customers.ts, ai.ts (company_user일 때 호출)

#### CT-03: unsubscribe-helper.ts — 수신거부 관리 + 080 자동연동
- **역할:** 수신거부 필터링, 080 콜백 처리, 수신거부 목록 관리의 유일한 진입점

**필터링 패턴** — 발송 시 반드시 적용:
```sql
AND NOT EXISTS (
  SELECT 1 FROM unsubscribes u
  WHERE u.user_id = [발송자user_id] AND u.phone = c.phone
)
```
- 5개 발송 경로 전부 동일 패턴 적용되어 있는지 확인.
- **⚠️ user_id 기준 (B17-01):** 수신거부는 company_id가 아닌 user_id 기준으로 격리 (브랜드별 수신거부 분리).

**080 수신거부 자동연동 (나래인터넷):**
```
나래인터넷 콜백 → GET /api/unsubscribes/080callback?cid=수신거부번호&fr=080번호
    → unsubscribe-helper.ts의 process080Callback() 처리
    → 매칭 순서: ① users.opt_out_080_number (사용자 단위, auto_sync=true만)
                  ② companies.opt_out_080_number (하위호환 fallback)
    → 매칭된 모든 user에게 unsubscribes INSERT
    → ★ 같은 회사의 admin user(user_type='admin')에게도 자동 INSERT (source='080_ars_sync')
    → customers.sms_opt_in 동기화
    → 응답: '1'(성공) / '0'(실패)
```
- **사용자 단위 관리:** 슈퍼관리자 → 사용자 수정 모달에서 080번호/자동연동ON·OFF 설정
- **admin 자동동기화:** 브랜드 담당자에게 080 수신거부 등록 시 → 같은 회사의 고객사관리자(admin)에게도 자동 INSERT (관리 가시성 + 발송 필터 적용)
- **080 설정 조회 패턴:** users 테이블 우선 → companies fallback (unsubscribes.ts, campaigns.ts, ai.ts, companies.ts 전부 동일 패턴)
- **080 함수:** `findUserBy080Number()`, `process080Callback()`, `getUserUnsubscribes()`, `deleteUserUnsubscribes()`, `exportUserUnsubscribes()`
- **필터 함수:** `buildUnsubscribeFilter()`, `buildUnsubscribeExistsFilter()`, `syncCustomerOptIn()`, `isUnsubscribed()`, `getUnsubscribedPhones()`

#### CT-04: sms-queue.ts — MySQL 큐 조작
- **역할:** QTmsg MySQL 큐(발송 테이블) 접근의 유일한 진입점. 라인그룹 기반 테이블 라우팅 + 캐시
- **환경변수:** `SMS_TABLES` — 쉼표 구분 테이블 목록 (예: `SMSQ_SEND,SMSQ_SEND_02,...`)
- **라인그룹 캐시:** 회사/사용자별 전용 테이블 매핑을 메모리 캐시 (TTL 기반)
- **주요 함수:**
  - 테이블 조회: `getCompanySmsTables()`, `getTestSmsTables()`, `getAuthSmsTable()`, `getCompanySmsTablesWithLogs()`
  - 큐 조작: `getNextSmsTable()` (라운드로빈), `smsCountAll()`, `smsAggAll()`, `smsSelectAll()`, `smsMinAll()`, `smsExecAll()`
  - 카카오: `insertKakaoQueue()`, `kakaoAgg()`, `kakaoCountPending()`, `kakaoCancelPending()`
  - 캐시: `invalidateLineGroupCache()`
- **적용 파일:** campaigns.ts, manage-scheduled.ts, results.ts, campaign-lifecycle.ts

#### CT-05: prepaid.ts — 선불 잔액 관리
- **역할:** 포인트 차감/환불의 유일한 진입점. DB 기반 단가 조회 (하드코딩 금지)
- **차감 로직:** `billing_type === 'prepaid'`일 때만 작동, 후불은 자동 패스
- **Atomic 처리:** `balance >= totalAmount` 조건부 UPDATE로 잔액 부족 시 실패 반환
- **주요 함수:**
  - `prepaidDeduct(companyId, count, messageType, referenceId)` — 발송 시 차감
  - `prepaidRefund(companyId, amount, referenceId)` — 취소 시 환불
- **적용 파일:** campaigns.ts(발송 시 차감), campaign-lifecycle.ts(취소 시 환불)

#### CT-06: campaign-lifecycle.ts — 캠페인 생명주기 (취소 + 결과동기화)
- **역할:** 캠페인 상태 변경의 유일한 진입점. sms-queue.ts + prepaid.ts를 조합
- **주요 함수:**
  - `cancelCampaign(campaignId, companyId, options)` — MySQL 큐 삭제 + PG 상태 변경 + 선불 환불
  - `syncCampaignResults(companyId)` — MySQL 발송 결과 → PostgreSQL campaign_runs 업데이트
- **취소 옵션:** reason, cancelledBy, cancelledByType, skipTimeCheck(관리자용 15분 체크 스킵)
- **적용 파일:** campaigns.ts, manage-scheduled.ts, admin.ts

### 5-7. 자동발송 기능 (D69 — ✅ Phase 1 구현 완료)

> **설계 문서:** `status/AUTO-SCHEDULE-DESIGN.md`
> **상태:** ✅ Phase 1 (MVP) 구현 완료, 배포 완료 (2026-03-12)

**개요:** 한 번 설정하면 매월/매주/매일 반복 자동 발송. 프로 요금제(100만원) 이상.

**DB 테이블 (생성 완료):**
- `auto_campaigns` — 스케줄 설정 + 타겟 필터 + 메시지 + 상태
- `auto_campaign_runs` — 매 실행 이력 (회차별 발송 결과)
- `plans.auto_campaign_enabled` — 요금제별 기능 게이팅 (BOOLEAN)
- `plans.max_auto_campaigns` — 동시 활성 자동캠페인 수 제한 (PRO:5, BUSINESS:10, ENTERPRISE:NULL=무제한)

**백엔드 파일 (구현 완료):**
- `routes/auto-campaigns.ts` — CRUD API 9개 엔드포인트 (GET/, GET/:id, POST/, PUT/:id, POST/:id/pause, POST/:id/resume, DELETE/:id, POST/:id/preview, POST/:id/cancel-next)
- `utils/auto-campaign-worker.ts` — PM2 워커 (매 1시간 체크 → 도래 건 실행). app.ts listen 콜백에서 `startAutoCampaignScheduler()` 호출
- `utils/auto-campaign-notify.ts` — D-1 사전 알림 (Phase 2 예정)

**프론트엔드 파일 (구현 완료):**
- `pages/AutoSendPage.tsx` — 프로 미만: 블러 프리뷰+CTA (AnalysisModal 패턴), 프로 이상: 실제 기능
- `components/AutoSendFormModal.tsx` — 자동발송 생성/수정 4단계 위저드 모달
- `DashboardHeader.tsx` — "자동발송" 메뉴 (AI 분석과 직접발송 사이, 잠금 없이 누구나 클릭)
- `App.tsx` — `/auto-send` 라우트 (company_admin + company_user 접근)

**기존 파이프라인 100% 재활용:** customer-filter, sms-queue, messageUtils, unsubscribe-helper, prepaid, campaign-lifecycle, store-scope

**실패 정책:** skip + failed 기록 + next_run_at 전진 (재시도 없음 → 중복 발송 방지)

**권한:** company_admin + company_user(브랜드담당자) 모두 생성/수정/삭제 가능 (store_code 범위 내)

**Phase 2 예정:** D-1 사전 알림, 타겟 필터 UI(AutoSendFormModal에 필터 단계 추가), 실행 이력 상세 조회
**Phase 3 예정:** A/B 테스트, AI 메시지 자동 생성 연동, 발송 최적 시간 추천

### 5-8. AI 메시지 생성 흐름

```
프론트엔드 → POST /api/ai/generate-messages
    → routes/ai.ts (req.body에서 filters 추출, targetInfo 구성)
    → services/ai.ts (generateMessages — Anthropic Claude 우선, OpenAI 폴백)
    → 프롬프트에 타겟 필터조건(등급/성별/연령/지역) + 샘플 고객 포함
```

### 5-8. SMS 발송 흐름

```
PostgreSQL campaigns/campaign_runs 생성
    → MySQL msg_queue_YYYYMM 테이블에 INSERT (QTmsg Agent가 실제 발송)
    → 결과: MySQL msg_result_YYYYMM에 기록
    → sync-results: MySQL 결과 → PostgreSQL campaign_runs 업데이트
```

---

## 6. 과거 교훈 (이것 때문에 사고 났다)

| 교훈 | 내용 | 대책 |
|------|------|------|
| **worktree 미반영** | worktree에만 수정하고 메인코드에 미반영 → 배포해도 변경 없음 | worktree 금지, packages/ 직접 수정 |
| **5경로 중 1개만 패치** | 발송 버그 수정 시 1개 경로만 고치고 나머지 4개 방치 → 재발 | messageUtils.ts 통합 + 5경로 전수점검 |
| **타입 에러 배포** | TS 에러 무시하고 배포 → 서버 크래시 | 빌드 통과 필수 |
| **OneDrive 동기화** | .git이 클라우드 동기화되어 lock/충돌 | 프로젝트를 OneDrive 밖으로 이전 완료 |
| **엉뚱한 파일 수정** | B13-03/04를 AiCampaignResultPopup.tsx에서 수정 — 실제 화면은 AiPreviewModal.tsx | 수정 전 실제 화면 확인 필수 |
| **tp-deploy-full 백엔드 빌드 누락** | tp-deploy-full이 프론트엔드만 빌드 → 백엔드 dist/ 미갱신 → 서버에 코드 수정 미반영 | PowerShell 프로필에 백엔드 빌드 추가 완료 (D67) |
| **customer-filter mixed/structured 양쪽 누락** | AI 프롬프트에 birth_date 추가했지만 customer-filter.ts mixed 형식에 핸들러 없어서 필터 무시됨 → 전체 고객 선택 | 새 필드 추가 시 mixed + structured 양쪽 확인 필수 (D68) |

---

## 7. 작업 시작 체크리스트

새 세션에서 코드 작업을 시작할 때:

1. ✅ 이 문서(CLAUDE.md) 읽기
2. ✅ `status/STATUS.md`의 CURRENT_TASK 확인
3. ✅ 관련 버그가 있으면 `status/BUGS.md`에서 해당 버그 상세 확인
4. ✅ DB 관련이면 `status/SCHEMA.md` 확인
5. ✅ 수정 대상 파일의 현재 코드를 **반드시 먼저 읽기**
6. ✅ Harold님께 수정 방향 보고 → 컨펌 → 구현
7. ✅ 수정 후 관련 경로(5개 발송 경로 등) 교차 확인
8. ✅ `packages/` 메인코드에 직접 수정 (worktree 금지)
