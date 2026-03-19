# TargetUp (한줄로) 프로젝트 — AI 에이전트 온보딩

> 이 문서는 새 세션이 프로젝트를 즉시 이해하고 작업할 수 있도록 핵심 컨텍스트를 담고 있다.
> 작업 전 반드시 이 문서를 읽고, 필요에 따라 아래 참조 문서를 추가로 읽는다.

---

## ⛔ 0. 최우선 원칙 — 컨트롤타워 우선 확인 (절대 위반 금지)

> **코드를 수정하기 전에 반드시 컨트롤타워(utils/)에 해당 기능이 이미 존재하는지 먼저 확인한다.**
> 인라인으로 직접 DB 쿼리를 작성하거나 로직을 구현하지 않는다.
> 컨트롤타워에 없으면 새로 만들어서 컨트롤타워를 통해 제어한다.

### 확인 순서 (매 작업 시 반드시):
1. `packages/backend/src/utils/` 폴더의 컨트롤타워 파일 목록 확인
2. 수정하려는 기능이 이미 컨트롤타워에 존재하는지 grep/검색
3. **존재하면:** 해당 컨트롤타워 함수를 import해서 사용
4. **존재하지 않으면:** 컨트롤타워에 함수를 먼저 만들고, 라우트에서 import

### 현재 컨트롤타워 목록:
| 번호 | 파일 | 역할 |
|------|------|------|
| CT-01 | customer-filter.ts | 고객 필터/쿼리 빌더 |
| CT-02 | store-scope.ts | 브랜드(store_code) 격리 |
| CT-03 | unsubscribe-helper.ts | 수신거부 관리 + 080 연동 |
| CT-04 | sms-queue.ts | MySQL 큐 조작 |
| CT-05 | prepaid.ts | 선불 잔액 관리 |
| CT-06 | campaign-lifecycle.ts | 캠페인 생명주기 |
| CT-07 | standard-field-map.ts | 필드 매핑 + customer_field_definitions UPSERT |
| CT-08 | callback-filter.ts | 개별회신번호 필터링 (store_phone 폴백 + 미등록 제외) |
| CT-09 | spam-test-queue.ts | 스팸테스트 큐 관리 + 자동 스팸검사/재생성 |
| CT-10 | sender-registration.ts | 발신번호 등록 신청/승인/반려 워크플로우 |
| — | messageUtils.ts | 변수 치환 (5개 발송 경로 통합) |
| — | normalize.ts | 값 정규화 |
| — | stats-aggregation.ts | 대시보드 통계 집계 + AI 캠페인 성과 집계 |

**⚠️ 이 원칙을 어기고 인라인 코드를 작성하면 버그가 재발한다. 실제 사고 사례:**
- **사례 1:** upload.ts에서 customer_field_definitions를 인라인으로 INSERT하면서 "최초 등록 우선" 정책 적용 → 잘못된 라벨이 영원히 고착되는 버그 발생.
- **사례 2 (D79):** upload.ts에 `normalizeDateValue()` 인라인 함수를 만들어 YYMMDD 6자리 수정 → 실제 FIELD_MAP 경로는 normalize.ts의 `normalizeDate()`를 호출 → 인라인 수정이 적용 안 됨 → 업로드 에러 재발. **컨트롤타워(normalize.ts)만 수정했으면 한 번에 해결됐을 버그.**

### 🚫 인라인 중복 함수 절대 금지 (D79 교훈 — 극히 중요)
> **라우트 파일(routes/)에 컨트롤타워(utils/)와 동일·유사한 함수를 인라인으로 만들지 않는다.**
> 이미 인라인 함수가 존재하면 **즉시 삭제하고 컨트롤타워 import로 교체**한다.
> 인라인 함수를 수정하면 컨트롤타워와 분기되어 한쪽만 패치되는 버그가 반드시 재발한다.
>
> **체크 방법:** 수정하려는 함수명을 grep으로 검색 → utils/에 동일 기능 함수가 있으면 → 반드시 utils/ 것을 수정하고, routes/의 인라인은 삭제.
> **절대 "일단 인라인에 빠르게 수정"하지 않는다.** 느려도 컨트롤타워를 찾아서 거기서 수정한다.

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

### 4-8. ⚠️ 두 번 세 번 꼼꼼히 살펴보기 (D70 교훈 — 극히 중요)
- **수정한 코드가 실제로 "그 값"을 쓰는지 끝까지 추적한다.**
  - 예: 대시보드에 "성공건수"로 표시하는데 실제 변수가 `totalSent`(발송건수)인지 `totalSuccess`(성공건수)인지 — 변수명만 보지 말고 **값의 출처(DB 컬럼, 쿼리)까지** 추적.
  - 예: 함수의 "안전망" 로직(regex strip 등)이 유효한 값을 의도치 않게 제거하는지 확인.
- **"코드가 맞아 보인다"로 끝내지 말고, 실제 데이터 흐름을 따라가며 검증한다.**
  - 입력(프론트 → API body) → 처리(백엔드 로직) → 저장(DB) → 조회(SELECT) → 표시(프론트) 전체 경로를 한 번 더 확인.
- **서버 실데이터로 교차검증한다.**
  - 직원/사용자 리포트를 맹신하지 않되, 무시하지도 않는다.
  - 서버 DB 조회, PM2 로그, 실제 코드(dist/) grep으로 팩트를 확인한 후 판단.
- **컨트롤타워 함수 수정 시 모든 호출부의 동작을 확인한다.**
  - replaceVariables, buildCustomerFilter, getStoreScope 등 컨트롤타워 함수는 여러 곳에서 호출됨.
  - 파라미터 추가/시그니처 변경 시 기존 호출부가 깨지지 않는지 (하위호환) 반드시 확인.
- **이 원칙은 "시간이 걸려도 반드시 지킨다." 빠르게 대충 하면 또 사고난다.**

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

- **직접 컬럼 필드 (FIELD_MAP storageType=column):** name, phone, gender, age, birth_date, email, address, region, recent_purchase_store, recent_purchase_amount, total_purchase_amount, purchase_count, recent_purchase_date, store_code, registration_type, registered_store, store_phone, store_name, grade, points, sms_opt_in
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

`replaceVariables(template, customer, fieldMappings, addressBookFields?)` — 메시지 내 `%이름%`, `%등급%` 등의 변수를 실제 고객 데이터로 치환.
- 5개 발송 경로 전부 이 함수 사용.
- 새 변수 추가 시 이 함수만 수정하면 전 경로 자동 반영.
- **4번째 파라미터 `addressBookFields` (D70):** 직접발송 시 주소록 %기타1/2/3%, %회신번호% 치환. fieldMappings 순회 전에 먼저 치환하여 안전망 regex에 잡히지 않도록 처리.
- **⚠️ D70 교훈:** 주소록 변수는 fieldMappings에 없으므로, replaceVariables의 잔여 %...% 안전망이 빈값으로 제거함. 반드시 안전망 전에 치환해야 함.

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
  - **벌크 INSERT:** `bulkInsertSmsQueue(tables, rows, useNow)` — 라운드로빈 테이블 분배 + BATCH_SIZES.smsSend(5000건) 단위 bulk INSERT. AI캠페인/직접발송/자동발송 3경로 적용 (D72)
  - 카카오: `insertKakaoQueue()`, `kakaoAgg()`, `kakaoCountPending()`, `kakaoCancelPending()`
  - 캐시: `invalidateLineGroupCache()`
- **적용 파일:** campaigns.ts, manage-scheduled.ts, results.ts, campaign-lifecycle.ts, auto-campaign-worker.ts

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

#### CT-07: standard-field-map.ts — 필드 매핑 + customer_field_definitions UPSERT
- **역할:** FIELD_MAP 정의 (유일한 기준) + 커스텀 필드 라벨 저장의 유일한 쓰기 진입점
- **주요 함수:**
  - `getFieldByKey()`, `getColumnFields()`, `getCustomFields()` — FIELD_MAP 조회
  - `fieldKeyToColumn()`, `fieldKeyToCustomKey()`, `fieldKeyToSqlRef()` — SQL 생성 헬퍼
  - `upsertCustomFieldDefinitions(companyId, definitions)` — customer_field_definitions UPSERT (ON CONFLICT DO UPDATE)
- **⚠️ 과거 교훈:** upload.ts에서 인라인으로 "최초 등록 우선" INSERT 정책 사용 → 잘못된 라벨 영구 고착. CT-07 도입으로 항상 최신 라벨로 갱신.
- **적용 파일:** upload.ts, sync.ts (쓰기) / messageUtils.ts, customers.ts, ai.ts (읽기)

#### CT-08: callback-filter.ts — 개별회신번호 필터링
- **역할:** 개별회신번호 사용 시 store_phone 폴백 + callback 미보유 제외 + 미등록 회신번호 제외의 유일한 진입점
- **처리 흐름:**
  1. store_phone → callback 폴백: callback이 없으면 store_phone 사용
  2. callback 미보유 고객 제외: callback + store_phone 둘 다 없는 수신자 제외
  3. 미등록 회신번호 제외: sender_numbers + callback_numbers에 등록되지 않은 회신번호의 수신자 제외
- **주요 함수:**
  - `filterByIndividualCallback(customers, companyId)` → `CallbackFilterResult` (filtered, callbackMissingCount, callbackUnregisteredCount, callbackSkippedCount)
  - `buildCallbackErrorResponse(missing, unregistered)` → 제외 사유 구체적 안내 에러 응답 객체
- **⚠️ D75 교훈:** AI send와 direct-send에 동일 로직이 인라인으로 중복 → 동작 불일치 발생. CT-08로 통합하여 단일 진입점 보장.
- **적용 파일:** campaigns.ts (AI send + direct-send 2곳)

#### CT-09: spam-test-queue.ts — 스팸테스트 큐 관리 + 자동 스팸검사/재생성
- **역할:** 스팸테스트 큐 기반 순차 처리 + 프로 요금제 자동 스팸검사/재생성의 유일한 진입점
- **설계:** 글로벌 큐(1개만 active) → 테스트폰 충돌 방지. batch_id로 3개 variant 그룹핑. 차단 시 자동 재생성(최대 2회)
- **Grace Period:** 수동=10초, 자동=20초 (자동은 false positive 최소화)
- **주요 함수:**
  - `enqueueSpamTest(params)` — 큐 등록 (status='queued')
  - `processSpamTestQueue()` — 큐 워커: 다음 queued 건 실행 (3초 간격)
  - `getSpamTestBatchResults(batchId)` — 배치 결과 조회
  - `autoSpamTestWithRegenerate(params)` — 전체 흐름: 3 variant 큐잉 → 테스트 → 차단 시 재생성
  - `startSpamTestQueueWorker()` — 3초 간격 워커 시작 (app.ts listen 콜백)
- **적용 파일:** ai.ts (자동 스팸검사 연동), spam-filter.ts (프로 무료 적용), app.ts (워커 시작)

### 5-7. 자동발송 기능 (D69 — ✅ Phase 1 구현 완료)

> **설계 문서:** `status/AUTO-SCHEDULE-DESIGN.md`
> **상태:** ✅ Phase 1 (MVP) 구현 완료, 배포 완료 (2026-03-12)

**개요:** 한 번 설정하면 매월/매주/매일 반복 자동 발송. 프로 요금제(100만원) 이상.

**DB 테이블 (생성 완료):**
- `auto_campaigns` — 스케줄 설정 + 타겟 필터 + 메시지 + 상태
- `auto_campaign_runs` — 매 실행 이력 (회차별 발송 결과)
- `plans.auto_campaign_enabled` — 요금제별 기능 게이팅 (BOOLEAN)
- `plans.max_auto_campaigns` — 동시 활성 자동캠페인 수 제한 (PRO:5, BUSINESS:10, ENTERPRISE:NULL=무제한)
- `companies.auto_campaign_override` — 회사별 오버라이드 (NULL=플랜따름, 0=비활성, 1+=허용건수). 특정 업체에 서비스로 자동발송 제공 시 사용

**회사별 자동발송 오버라이드 (D76):**
- 플랜 자체를 변경하지 않고 특정 회사에만 자동발송을 열어줄 때 사용
- `checkPlanGating()` 함수에서 `auto_campaign_override`가 NULL이 아니면 플랜 설정보다 우선 적용
- 서비스 제공: `UPDATE companies SET auto_campaign_override = N WHERE id = '업체ID';`
- 서비스 회수: `UPDATE companies SET auto_campaign_override = NULL WHERE id = '업체ID';`

**백엔드 파일 (구현 완료):**
- `routes/auto-campaigns.ts` — CRUD API 9개 엔드포인트 (GET/, GET/:id, POST/, PUT/:id, POST/:id/pause, POST/:id/resume, DELETE/:id, POST/:id/preview, POST/:id/cancel-next)
- `utils/auto-campaign-worker.ts` — PM2 워커 (매 1시간 체크 → 도래 건 실행). app.ts listen 콜백에서 `startAutoCampaignScheduler()` 호출
- `utils/auto-campaign-notify.ts` — D-1 사전 알림 (Phase 2 예정)

**프론트엔드 파일 (구현 완료):**
- `pages/AutoSendPage.tsx` — 프로 미만: 블러 프리뷰+CTA (AnalysisModal 패턴), 프로 이상: 실제 기능
- `components/AutoSendFormModal.tsx` — 자동발송 생성/수정 **5단계** 위저드 모달:
  - 1단계: 기본정보 (캠페인명, 설명)
  - 2단계: 활용필드선택 (AiCustomSendFlow 패턴 — enabled-fields API 기반 카테고리별 동적 필드 체크박스)
  - 3단계: 스케줄 (매월/매주/매일 + 발송일/요일 + 시각)
  - 4단계: 메시지 (SMS/LMS/MMS 탭, AI문구추천(AiMessageSuggestModal+personalFields), 스팸필터(SpamFilterTestModal), 동적 변수 드롭다운, 광고문구 미리보기, MMS 이미지 업로드)
  - 5단계: 확인 (요약 + 미리보기)
  - ★ 프로 이상 접근이므로 AI/스팸필터 잠금 체크 없음 (불필요한 요금제 체크 제거)
- `DashboardHeader.tsx` — "자동발송" 메뉴 (AI 분석과 직접발송 사이, 잠금 없이 누구나 클릭)
- `App.tsx` — `/auto-send` 라우트 (company_admin + company_user 접근)

**기존 파이프라인 100% 재활용:** customer-filter, sms-queue, messageUtils, unsubscribe-helper, prepaid, campaign-lifecycle, store-scope

**실패 정책:** skip + failed 기록 + next_run_at 전진 (재시도 없음 → 중복 발송 방지)

**권한:** company_admin + company_user(브랜드담당자) 모두 생성/수정/삭제 가능 (store_code 범위 내)

**Phase 2 (D80 구현 완료):**
- AI 문안 자동생성 연동 (D-2 생성 + 스팸테스트 → D-1 담당자 알림 → D-day 발송)
- DB: ai_generate_enabled, ai_prompt, ai_tone, fallback_message_content, generated_message_content 등 컬럼 추가
- 프론트: AutoSendFormModal Step 4에 AI 모드 토글 (plans.ai_premium_enabled 게이팅)
- auto-campaign-worker.ts: runMessageGeneration() + runPreNotification() + executeAutoCampaign() 3단계 분리
- AI 폴백 체인: generated_message_content → fallback_message_content → message_content

**Phase 2 남은 작업:** 타겟 필터 UI(AutoSendFormModal에 필터 단계 추가), 실행 이력 상세 조회
**Phase 3 예정:** A/B 테스트, 발송 최적 시간 추천

### 5-8. AI 프리미엄 기능 (D80 — plans.ai_premium_enabled 게이팅)

**1. 자동조건완화 (auto-relax):**
- `services/ai.ts` — `relaxFilters()`: AI가 매칭 0건 시 조건 완화 (최대 2회 시도)
- `routes/ai.ts` — recommend-target에 `auto_relax` 파라미터 (기본 true, 프론트에서 ON/OFF 제어)
- `AiSendTypeModal.tsx` — "AI 한줄로" 프롬프트 영역에 토글 UI (프로 이상만 표시)
- `Dashboard.tsx` — `handleAiCampaignGenerate(prompt, autoRelax)` → `recommendTarget({ objective, auto_relax })` 전달

**2. 캠페인 성과 → AI 다음 캠페인 추천:**
- `stats-aggregation.ts` — `aggregateCampaignPerformance()`: 최근 N개월 성과 다각도 집계
- `services/ai.ts` — `recommendNextCampaign()`: AI 분석 → 추천
- `routes/ai.ts` — `POST /api/ai/recommend-next-campaign`
- `AiCustomSendFlow.tsx` — Step 2 헤더에 "AI 추천" 버튼 + 호버 툴팁

**3. 자동발송 AI 문안생성:** → 5-7 자동발송 기능 Phase 2 참조

### 5-9. AI 메시지 생성 흐름

```
프론트엔드 → POST /api/ai/generate-messages
    → routes/ai.ts (req.body에서 filters 추출, targetInfo 구성)
    → services/ai.ts (generateMessages — Anthropic Claude 우선, OpenAI 폴백)
    → 프롬프트에 타겟 필터조건(등급/성별/연령/지역) + 샘플 고객 포함
```

### 5-10. SMS 발송 흐름

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
| **대시보드 sent vs success 혼동** | monthly_sent에 totalSent(큐INSERT건수)를 넣어 "성공건수"에 실패건까지 표시 | 대시보드 표시값의 출처를 반드시 DB 컬럼까지 추적하여 확인 (D70) |
| **replaceVariables 안전망이 주소록 변수 제거** | 직접발송 시 DB에 있는 수신자 → replaceVariables 호출 → %기타1/2/3%는 fieldMappings에 없음 → 안전망 regex가 빈값으로 제거 | 컨트롤타워 함수의 "안전망"이 의도치 않게 유효한 값을 제거하는지 반드시 확인 (D70) |
| **upload.ts customer_schema 미갱신** | 엑셀 업로드 후 companies.customer_schema가 {}로 방치 → AI/직접발송 변수 매핑 불가 | 데이터 입력 경로가 여러 개일 때 모든 경로에서 관련 메타데이터가 갱신되는지 확인 (D70) |
| **전송 후 state 미초기화** | MMS 전송 후 setMmsUploadedImages([]) 누락 → 이전 이미지 잔류 | 전송 성공 후 초기화 로직에 모든 관련 state가 포함되었는지 확인 (D70) |
| **조건부 UX 분기 누락** | MMS 이미지 있는데 SMS 전환 비용절감 안내 표시 → 사용자 혼란 | UX 분기(모달/안내) 추가 시 해당 상태가 유효한 모든 조건을 고려 (D70) |
| **customers_unified 뷰 미갱신** | customers 테이블에 store_phone 추가했지만 뷰 재생성 안 함 → 뷰 참조하는 모든 SELECT에서 500 에러 | customers 테이블 컬럼 추가 시 customers_unified 뷰도 반드시 DROP+CREATE 재생성 (D71) |
| **FIELD_MAP 추가 vs upload.ts 파생 컬럼 중복** | region을 FIELD_MAP에 추가했으나 upload.ts에서 이미 파생 컬럼으로 별도 처리 → INSERT에 region 두 번 → 업로드 전건 오류 | FIELD_MAP에 필드 추가 시 upload.ts의 파생 컬럼(birth_year, birth_month_day)과 중복 여부 반드시 확인 (D71) |
| **AI 프롬프트 예시가 FIELD_MAP과 모순** | 프롬프트 예시에 "구매횟수":"custom_1"로 안내 → FIELD_MAP에는 purchase_count 존재 → AI가 예시를 따라 잘못 매핑 | FIELD_MAP 필드 추가/변경 시 upload.ts AI 프롬프트 예시/규칙도 반드시 동기화 (D71) |
| **SELECT 쿼리에 신규 컬럼 누락** | FIELD_MAP/DB에 필드 추가하고 upload 정상 작동하지만, customers.ts SELECT에서 안 가져와서 프론트에 null 표시 | DB 컬럼 추가 시: (1) FIELD_MAP (2) upload.ts (3) customers.ts SELECT (4) customers_unified VIEW 4곳 전부 확인 (D71) |
| **배치 사이즈 무단 축소** | BATCH_SIZE 4000→500 변경으로 업로드 속도 7.5배 저하 (30,000건: 8배치→60배치) | 성능 관련 설정값 변경 시 변경 사유와 이전 값을 주석으로 반드시 기록 (D71) |
| **캠페인 상태 lifecycle 조회 누락** | AI 캠페인 생성 시 status='draft'+scheduled_at 설정, 그러나 예약 대기 모달은 status='scheduled'만 조회 → draft 예약 캠페인 미표시 | 상태 기반 조회 UI 구현 시 해당 엔티티의 전체 lifecycle(draft→scheduled→sending→completed/cancelled)을 확인하고 모든 유효 상태를 포함 (D72) |
| **프론트엔드 비용 계산 message_type 무시** | ResultsModal에서 totalSuccess * perSms 단일 계산 → LMS/MMS/카카오도 SMS 단가 적용 | 비용 계산 시 백엔드에서 타입별 단가를 이미 제공하고 있는지 확인하고, 프론트에서 캠페인별 message_type/send_channel에 따라 올바른 단가 적용 (D72) |
| **enrichWithCustomFields column이 SQL SELECT에 직접 노출** | enrichWithCustomFields()가 column:'custom_2' (JSONB 내부 키)를 fieldMappings에 추가 → 5개 발송 경로의 동적 SELECT에 그대로 포함 → "column custom_2 does not exist" 에러 | **유틸 함수가 데이터 구조(column 값 등)를 변경/추가하면, 그 값을 소비하는 모든 곳(특히 SQL 생성부)의 동작을 반드시 끝까지 추적.** custom_fields JSONB 내부 키는 직접 컬럼이 아니므로 SQL SELECT에서 반드시 제외 (D72) |
| **건건이 MySQL INSERT로 발송 성능 저하** | 25,000건 발송에 ~3분 (건건이 INSERT = 25,000회 DB 왕복). 70만건이면 ~90분 | MySQL INSERT는 반드시 bulk INSERT로. sms-queue.ts 컨트롤타워(CT-04)의 `bulkInsertSmsQueue()` 사용. 인라인 INSERT 로직 절대 금지 (D72) |
| **발송 경로 inline 로직 vs 컨트롤타워** | 직접발송에서 MySQL INSERT를 인라인으로 구현 + app_etc2(companyId) 누락 | 발송 관련 MySQL 조작은 반드시 sms-queue.ts 컨트롤타워를 통해야 함. 인라인 구현 시 다른 경로와 불일치 발생 (D72) |
| **normalizePhone이 유선번호를 null 처리** | store_phone에 normalizePhone(휴대폰 전용) 지정 → 매장전화번호(02, 031 등) 3만건 전부 null 저장. enabled-fields 미표시, 개인화 공백 | **FIELD_MAP에 normalizeFunction 지정 시 해당 필드의 실제 데이터 형태를 반드시 확인.** 매장전화번호는 유선번호가 대부분이므로 normalizeStorePhone 사용 (D74) |
| **customer-filter mixed 모드 하드코딩 핸들러** | 필드마다 핸들러를 수동 추가하는 구조 → recent_purchase_amount, purchase_count 누락 → AI 타겟추출 시 필터 무시 (1,224 vs 823) | **컨트롤타워를 만들었으면 동적으로 처리.** FIELD_MAP의 dataType 기반 자동 필터 생성으로 전환. 새 필드 추가 시 핸들러 추가 불필요 (D74) |
| **AI 프롬프트 필터 필드 하드코딩** | 사용 가능한 필터 필드 10개만 하드코딩 → 새 필드/커스텀 필드 미반영 → AI가 해당 필드로 필터 불가 | **AI 프롬프트도 FIELD_MAP + customer_field_definitions 기반 동적 생성.** 고객사별 실제 데이터 있는 필드만 표시. 커스텀 필드는 라벨명으로 전달 (D74) |
| **개별회신번호 필터링 인라인 중복** | AI send와 direct-send에 동일한 콜백 필터링 로직 ~50줄씩 인라인으로 중복 → 동작 불일치(한쪽은 전체 차단, 한쪽은 개별 제외) | **동일 로직이 2곳 이상 인라인이면 즉시 컨트롤타워로 추출.** CT-08 callback-filter.ts 생성으로 단일 진입점 보장 (D75) |
| **타겟추출 건수 하드코딩 제한** | customers.ts extract API에 `limit = 10000` 하드코딩 → 16,993명 매칭인데 10,000명만 추출 | **추출/발송 건수에 인위적 limit 하드코딩 금지.** 필요 시 환경변수나 설정으로 관리 (D75) |
| **custom_fields JSONB flat 미처리** | extract API가 custom_fields JSONB 그대로 반환 → 프론트에서 `r[field_key]` 접근 시 커스텀 필드 NULL 표시 | **JSONB 내부 키를 프론트에서 접근해야 할 때 백엔드 API에서 flat 처리하여 반환** (D75) |
| **window.confirm 사용** | SMS→LMS 전환 확인을 window.confirm으로 표시 → 다크모드/테마 미적용, UX 이질적 | **window.confirm/alert 사용 금지.** 모든 확인 대화상자는 커스텀 모달 컴포넌트 사용 (D75) |
| **AI 문안 요일 오류** | generateMessages 프롬프트에 달력 미제공 → AI가 요일 자체 계산 → 3/20(목)이 실제로는 금요일 | **AI 프롬프트에 날짜/요일이 관여하는 모든 함수에 getKoreanCalendar() 달력 제공 필수.** getKoreanToday() 쓰는 곳이면 getKoreanCalendar()도 함께 (D76) |
| **DB DEFAULT 하드코딩** | spam_filter_tests.spam_check_number에 DEFAULT '0807196700' 하드코딩 → 모든 고객사 테스트에 동일 080번호 기록 | **DB DEFAULT로 특정 값 하드코딩 금지.** 고객사별로 달라지는 값(080번호, 발신번호 등)은 반드시 코드에서 동적 조회하여 INSERT (D78) |
| **SPECIAL_FIELDS 과잉 등록** | customer-filter.ts SPECIAL_FIELDS에 name/email/address 포함 → FIELD_MAP 동적 루프에서 건너뜀 + 전용 핸들러 없음 → AI가 address 필터 반환해도 WHERE절 비어서 전체 고객 반환 | **SPECIAL_FIELDS에는 normalize 헬퍼 필요 필드만. 나머지는 FIELD_MAP 동적 루프가 자동 처리.** 필드별 핸들러 수동 추가 구조 = 누락 재발 (D82) |
| **안전장치가 정상 결과 차단** | 풀백 방지 로직이 DB 추출 결과(actualCount)를 임의로 0으로 덮어씀 → AI 타겟추출이 항상 0명 | **안전장치는 로그만 남기고 정상 결과를 훼손하지 않는다.** DB에서 정확히 추출한 결과가 최종 (D82) |
| **테스트발송 샘플 고객 불일치** | 미리보기 ORDER BY name ASC vs 테스트발송 ORDER BY created_at DESC → 다른 고객 데이터로 치환 | **미리보기 샘플 고객을 테스트발송에 그대로 전달.** 프론트 → 백엔드 sampleCustomer body 전달 (D82) |
| **structured 모드 하드코딩 리스트** | NUMERIC_FIELDS/DATE_FIELDS/store_name 전용 핸들러가 FIELD_MAP 동적 루프 진입을 차단 → contains 미지원, 새 필드 누락 | **structured 모드도 mixed 모드와 동일한 FIELD_MAP 동적 루프로 통일.** 특수 처리 필드(gender/grade/region/age/store_code/sms_opt_in)만 전용 핸들러 유지 (D83) |
| **filter-options에 성별 미포함** | gender가 텍스트 입력(contains) → 핸들러에서 eq/in만 처리 → 필터 무시 → 전체 리스트 | **dropdown으로 제공할 필드는 반드시 filter-options API에 포함.** 텍스트 자유 입력 시 핸들러 불일치 위험 (D83) |
| **자동발송 잠금 미비** | `status='active'→'active'` UPDATE는 잠금 역할 못 함 → 워커 1시간 간격 3회 중복 실행 → 12,051건 3배 발송 | **잠금은 반드시 상태 전환(active→executing)으로 구현.** 동일 상태 UPDATE는 잠금이 아님 (D83) |
| **KST 이중변환** | `toLocaleString('Asia/Seoul') + kstToUtc(-9h)` → KST 서버에서 9시간 이중 빼기 → 10:00 설정이 01:00에 실행 | **시간 변환은 서버 TZ에 의존하지 않고 `Date.UTC() - KST_OFFSET_MS` 패턴 사용** (D83) |
| **기간계 기능 필수 UI 없이 배포** | 자동발송 target_filter UI 미구현 상태에서 배포 → `{}` 필터 → 전체 고객 발송 사고 | **기간계(실제 발송) 기능은 필수 필터/설정 UI 완성 전 배포 금지** (D83) |
| **AI 프롬프트 하드코딩 미점검** | recommendTarget은 동적 프롬프트 전환했지만 같은 파일의 parseBriefing은 하드코딩 방치 → 맞춤한줄 커스텀필드/숫자필드 필터 전면 미작동 | **동일 기능(필터 필드 목록 제공)을 수행하는 프롬프트가 2곳 이상이면 즉시 공통 함수로 추출.** 한 곳 전환 시 동일 파일 내 다른 함수도 반드시 점검 (D84) |
| **sampleCustomer displayName/column 키 불일치** | recommend-target이 displayName 키("이름")로 반환 → test-send의 replaceVariables는 column 키("name")로 접근 → 개인화 전부 NULL | **프론트↔백엔드 간 데이터 키 형식이 다르면 반드시 변환 레이어 또는 양쪽 키 제공.** 미리보기(프론트)와 실제 발송(백엔드)의 데이터 참조 방식이 다를 수 있음 (D85) |
| **자동발송에 직접발송 UI 재활용 시도** | DirectTargetFilterModal(직접발송용)을 자동발송에 끼워넣음 → 3뎁스 모달, UX 이질적 | **기간계 기능별 UX 흐름이 다르면 컨트롤타워(API)만 재활용하고 UI는 전용으로 구현.** 자동발송 타겟은 AI 자동 추출(recommend-target), 직접발송 타겟은 수동 필터(DirectTargetFilterModal) (D86) |
| **auto_relax 기본 true로 타겟 왜곡** | 자동발송에서 recommend-target 호출 시 auto_relax 미설정 → AI가 멋대로 조건 완화 → 의도와 다른 타겟 | **자동발송처럼 사용자 지정 조건이 중요한 경우 auto_relax: false 명시.** 기본값에 의존하지 않고 용도에 맞게 파라미터 명시 (D86) |

### ⚠️ 필수 체크 원칙 1: 유틸 함수 수정/추가 시 소비처 전수 확인

> **D70~D72에서 반복된 패턴:** 유틸 함수(enrichWithCustomFields, buildCustomerFilter 등)에 데이터를 추가하거나 구조를 변경했을 때, 그 반환값을 사용하는 곳에서 어떤 일이 벌어지는지 확인하지 않아 장애 반복.
>
> **원칙:** 유틸 함수를 수정/추가할 때 반드시:
> 1. 해당 함수의 반환값을 사용하는 **모든 호출부**를 grep으로 찾는다
> 2. 각 호출부에서 반환값이 **어떻게 소비되는지** (SQL 생성, API 응답, 프론트 표시 등) 확인한다
> 3. 추가/변경된 데이터가 소비처에서 **부작용을 일으키지 않는지** 검증한다
> 4. 특히 **SQL 쿼리에 동적으로 삽입되는 값**은 반드시 유효한 컬럼명인지 확인한다

### ⚠️ 필수 체크 원칙 2: 컨트롤타워는 반드시 동적으로 — 하드코딩 금지 (D74 교훈)

> **D74에서 반복된 패턴:** FIELD_MAP이라는 컨트롤타워를 만들어놓고, 이를 소비하는 곳(customer-filter.ts, ai.ts)에서 필드별 핸들러를 하드코딩 → 새 필드 추가 시 누락 반복.
>
> **원칙:** 컨트롤타워(FIELD_MAP, customer_field_definitions 등)에 등록된 데이터는 반드시 **동적으로 조회/참조**한다:
> 1. **필터 생성:** `getColumnFields()` 순회 + dataType 기반 자동 연산자. 필드별 if/switch 금지
> 2. **AI 프롬프트:** `getColumnFields()` + COUNT FILTER + customer_field_definitions 기반 동적 생성
> 3. **변수 치환:** `extractVarCatalog()` + `enrichWithCustomFields()` — 이미 동적
> 4. **정규화:** `normalizeByFieldKey()` → FIELD_MAP.normalizeFunction 기반 자동 호출
> 5. **새 필드 추가 시 체크:** FIELD_MAP에 추가하면 위 4곳이 **자동으로** 따라오는지 확인. 수동 핸들러 추가가 필요하면 구조가 잘못된 것

### ⚠️ 필수 체크 원칙 3: 동일 로직 2곳 이상 = 즉시 컨트롤타워 추출 (D75 교훈)

> **D75에서 반복된 패턴:** campaigns.ts AI send와 direct-send에 개별회신번호 필터링 로직이 ~50줄씩 인라인으로 중복 → 한쪽만 수정 시 동작 불일치 발생.
>
> **원칙:** 동일한 비즈니스 로직이 2곳 이상에 인라인으로 존재하면:
> 1. **즉시 컨트롤타워(utils/)에 함수로 추출**한다
> 2. 모든 인라인 코드를 컨트롤타워 호출로 교체한다
> 3. 신규 기능 구현 시에도 "이 로직이 다른 경로에서도 필요한가?" 먼저 확인하고, 필요하면 처음부터 컨트롤타워로 만든다

### ⚠️ 필수 체크 원칙 4: SPECIAL_FIELDS / 하드코딩 리스트에 필드 등록 금지 (D82 교훈)

> **D82에서 반복된 패턴:** customer-filter.ts mixed 모드의 SPECIAL_FIELDS에 name/email/address가 포함 → FIELD_MAP 동적 루프에서 건너뜀 → 전용 핸들러도 없어서 필터 무시 → 전체 고객 반환. structured 모드의 STRING_FIELDS에 phone 누락 → 고객DB 전화번호 필터 무시.
>
> **원칙:**
> 1. **SPECIAL_FIELDS에는 normalize 헬퍼가 필요한 필드(gender, grade, region, age)와 기본 WHERE절 포함 필드(phone, sms_opt_in), 별도 분기 필드(store_code)만 등록**한다
> 2. **나머지 모든 직접 컬럼 필드는 FIELD_MAP 동적 루프가 dataType 기반으로 자동 처리**한다
> 3. **structured 모드도 FIELD_MAP 동적 처리 fallback 추가 완료** — 새 필드는 FIELD_MAP에만 등록하면 양쪽 모드 자동 반영
> 4. **"안전장치"가 정상 결과를 차단하면 안 됨** — 풀백 방지 로직 등 안전장치는 로그만 남기고 DB 추출 결과를 임의로 0으로 덮어쓰지 않는다

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
