# Sync Agent v1.3.0 ↔ 한줄로 현행 시스템 GAP 분석

> **작성일:** 2026-03-06
> **목적:** Sync Agent v1.3.0 (DB 동적 전환 이전 기준)과 현행 한줄로 시스템 간 불일치를 식별하고, 수정 범위를 확정한다.
> **기준 문서:** SYNC_AGENT_STATUS.md (v1.3.0) / STATUS.md / SCHEMA.md / FIELD-INTEGRATION.md

---

## 요약: 핵심 GAP 7건

| # | 영역 | 심각도 | 요약 |
|---|------|--------|------|
| GAP-1 | customers 테이블 스키마 | 🔴 Critical | 필수17개 + custom_fields JSONB 체계로 전면 전환됨 |
| GAP-2 | 컬럼 매핑 체계 | 🔴 Critical | autoSuggestMapping → standard-field-map.ts 기반 동적 매핑으로 교체 필요 |
| GAP-3 | UPSERT 로직 (POST /api/sync/customers) | 🔴 Critical | INSERT 컬럼 목록 + ON CONFLICT + custom_fields JSONB 병합 전면 변경 |
| GAP-4 | 정규화(normalize) 로직 | 🟡 Major | normalizeByFieldKey() 동적 정규화 + 파생 필드 자동 계산 추가 |
| GAP-5 | 수신거부 동기화 | 🟡 Major | unsubscribes SoT + opt_out_auto_sync + syncCustomerOptIn 체계 |
| GAP-6 | MySQL 접속 정보 | 🟡 Major | D49 랜섬웨어 대응으로 smsuser 비밀번호 변경 + DES 암호화 동기 변경 |
| GAP-7 | Zod 스키마 (types/) | 🟡 Major | customerSchema 필드 목록이 현행 customers 테이블과 불일치 |

---

## GAP-1: 🔴 customers 테이블 스키마 전면 변경

### Sync Agent v1.3.0이 알고 있는 구조 (추정)
Sync Agent는 Phase 7 (2026-02-25) 기준으로 빌드. 한줄로의 D39~D48 동적 전환(2026-02-26~27)은 **반영되지 않음.**

### 현행 한줄로 customers 테이블 (SCHEMA.md 기준)

**필수 직접 컬럼 16개 (FIELD-INTEGRATION.md Harold님 확정):**

| # | field_key | DB 컬럼명 | DB 타입 | Sync Agent 인지 여부 |
|---|-----------|-----------|---------|---------------------|
| 1 | name | name | varchar(100) | ✅ 기존 |
| 2 | phone | phone | varchar(20) | ✅ 기존 |
| 3 | gender | gender | varchar(10) | ✅ 기존 |
| 4 | age | age | integer | ⚠️ **신규** — 이전엔 birth_date에서 EXTRACT |
| 5 | birth_date | birth_date | date | ✅ 기존 |
| 6 | email | email | varchar(100) | ✅ 기존 |
| 7 | address | address | text | ✅ 기존 |
| 8 | recent_purchase_store | recent_purchase_store | varchar(100) | ⚠️ **신규** |
| 9 | registration_type | registration_type | varchar(50) | ⚠️ **신규** |
| 10 | registered_store | registered_store | varchar(100) | ⚠️ **신규** |
| 11 | store_phone | store_phone | varchar(20) | ⚠️ **신규 (D39 DDL)** |
| 12 | recent_purchase_amount | recent_purchase_amount | numeric(15,2) | ✅ 기존 |
| 13 | total_purchase_amount | total_purchase_amount | numeric(15,2) | ✅ 기존 |
| 14 | grade | grade | varchar(50) | ✅ 기존 |
| 15 | points | points | integer | ✅ 기존 |
| 16 | sms_opt_in | sms_opt_in | boolean | ✅ 기존 |

**파생 컬럼 (시스템 자동 계산, Sync Agent가 birth_date 전송 시 서버에서 계산):**

| 컬럼 | 파생 원본 | 비고 |
|------|----------|------|
| birth_year | birth_date → 연도 | integer |
| birth_month_day | birth_date → MMDD | varchar(10) |
| age | birth_date → 나이 | integer, 직접 저장 |
| region | address → 시/도 추출 | varchar(100) |

**핵심 추가: custom_fields (JSONB)**
- 필수 16개에 매핑 안 되는 필드 → custom_1~custom_15 슬롯에 저장
- `customer_field_definitions` 테이블에 고객사별 커스텀 필드 라벨 저장
- ON CONFLICT 시 `custom_fields || $new_custom_fields` 병합

**레거시 컬럼 (미사용 결정, 데이터 보존만):**
- total_purchase, callback, store_name, last_purchase_date, purchase_count
- Sync Agent가 이 컬럼들에 데이터를 보내고 있다면 → 무해하지만 비효율

**UNIQUE 제약 변경:**
```
기존: (company_id, phone)  ← Sync Agent가 알고 있을 가능성
현행: (company_id, COALESCE(store_code, '__NONE__'), phone)
```
→ store_code가 UNIQUE 키 구성요소에 추가됨. **Sync Agent가 store_code를 전송하지 않으면 UPSERT 시 '__NONE__'으로 폴백되어 동작은 하지만, 동일 고객이 다른 매장에 있는 경우 중복 생성 가능.**

### 수정 필요 사항
- [ ] Sync Agent의 고객 데이터 전송 시 **신규 필드 6개** 매핑 지원 추가
- [ ] **custom_fields JSONB** 구조 지원 추가 (고객사 POS에서 필수16개 외 필드 → custom_1~15 매핑)
- [ ] **store_code** 전송 로직 확인 (UNIQUE 키 구성요소)
- [ ] 레거시 컬럼 전송 정리 (불필요한 필드 전송 중단 또는 유지)

---

## GAP-2: 🔴 컬럼 매핑 체계 전면 교체

### Sync Agent v1.3.0 현재
- `src/mapping/` — autoSuggestMapping (templates.ts 매핑 패턴 기반)
- MBR_HP→phone, MBR_NM→name, GRD_CD→grade 등 **패턴 매칭 하드코딩**
- 매핑 결과를 config.enc에 저장 → 동기화 시 사용

### 한줄로 현행
- `standard-field-map.ts`가 **유일한 매핑 기준**
- standard_fields 테이블 (DB)에서 field_key, displayName, category, data_type 정의
- 업로드/동기화 모든 입구에서 이 매핑 레이어를 import해서 사용
- 카테고리: basic, purchase, store, membership, marketing, custom (영문 키 통일)

### 수정 필요 사항
- [ ] Sync Agent의 `autoSuggestMapping`이 **standard-field-map.ts 기준 field_key**로 매핑하도록 업데이트
- [ ] 매핑 결과가 서버 API에 전송될 때 **한줄로 standard_fields field_key 기준**으로 전달
- [ ] 커스텀 필드(custom_1~15) 자동 배정 로직 추가 (필수 16개에 안 맞는 필드)
- [ ] `customer_field_definitions`에 커스텀 필드 라벨 등록 API 호출 추가

---

## GAP-3: 🔴 서버 API UPSERT 로직 변경

### Sync Agent가 호출하는 API
```
POST /api/sync/customers ← 고객 데이터 벌크 UPSERT (최대 5,000건/배치)
```

### 서버 측 변경사항 (D39 이후)
서버의 sync.ts (또는 customers.ts)에서 UPSERT 로직이 다음과 같이 변경됨:

1. **INSERT 컬럼 목록**: 하드코딩 18개 → FIELD_MAP 기반 동적 생성 (23+ 파라미터)
2. **custom_fields JSONB**: 필수 16개 외 필드를 `{"custom_1": "값", "custom_2": "값"}` 형태로 저장
3. **ON CONFLICT**: `(company_id, COALESCE(store_code, '__NONE__'), phone)` 기준
4. **JSONB 병합**: `custom_fields = EXCLUDED.custom_fields || customers.custom_fields`
5. **파생 필드**: birth_date → birth_year/birth_month_day/age 서버에서 자동 계산

### 수정 필요 사항

**옵션 A: Sync Agent가 새 필드 구조에 맞춰 전송 (권장)**
- [ ] Sync Agent가 전송하는 JSON 페이로드에 신규 필드 포함
- [ ] custom_fields 객체 구성 로직 추가
- [ ] store_code 필드 전송 보장

**옵션 B: 서버 sync.ts에서 레거시 페이로드 호환 처리**
- [ ] 서버 /api/sync/customers에 "레거시 필드명 → 현행 필드명" 변환 레이어 추가
- [ ] Sync Agent 수정 없이 서버에서 흡수 (과도기 방안)

→ **Harold님 결정 필요:** A안(Agent 수정) vs B안(서버 호환) vs A+B 병행

---

## GAP-4: 🟡 정규화(normalize) 로직 불일치

### Sync Agent v1.3.0 현재
- `src/normalize/` — phone, gender, date, amount, region, grade 정규화
- 자체 정규화 후 서버에 전송

### 한줄로 현행
- `normalizeByFieldKey()` — standard-field-map.ts의 normalize 함수 참조로 동적 정규화
- **파생 필드 자동 계산 추가:**
  - birth_date → birth_year (integer), birth_month_day (MMDD string), age (integer)
  - address → region (시/도 추출)
- normalizeEmail() 신규 추가

### 수정 필요 사항
- [ ] Sync Agent의 정규화 결과가 서버 기대값과 일치하는지 점검
  - gender: 서버가 재정규화하는지, Agent 값 그대로 저장하는지
  - date 포맷: ISO 8601 기준 통일 여부
  - amount: 소수점 처리 (numeric(15,2))
- [ ] 파생 필드는 **서버에서 계산**하므로 Agent가 보낼 필요 없음 → 확인 필요
- [ ] email 정규화 추가 (소문자 변환 + trim)

---

## GAP-5: 🟡 수신거부(opt_out) 동기화 체계 변경

### Sync Agent v1.3.0 현재
- 수신거부 동기화 로직 없음 (범위 밖 명시: "양방향 동기화 — 향후 고도화 과제")
- 고객 데이터에 sms_opt_in 필드만 전송

### 한줄로 현행 (D43-4 + D48 완료)
- **unsubscribes** 테이블이 SoT (Single Source of Truth)
- opt_outs는 레거시 (확인용만)
- `companies.opt_out_auto_sync` 플래그로 고객사별 자동동기화 on/off
- `syncCustomerOptIn()` / `syncCustomerOptInBulk()` 공통 헬퍼
- 나래 080 ARS 콜백 연동 완료

### 수정 필요 사항
- [ ] Sync Agent가 sms_opt_in=false 전송 시, 서버가 unsubscribes에도 반영하는지 확인
- [ ] **역방향**: 한줄로에서 수신거부된 고객 → Sync Agent가 동기화 시 이를 인지해야 하는지 (현재 범위 밖이지만 검토 필요)
- [ ] opt_out_auto_sync=true인 고객사에서 Sync Agent가 수신동의 상태를 변경할 때의 영향 분석

---

## GAP-6: 🟡 MySQL 접속 정보 변경 (D49 보안 대응)

### 변경 내역
- 2026-02-28 MySQL 랜섬웨어 공격 대응으로:
  - smsuser 비밀번호 강화 (sms123 → 새 비밀번호)
  - Agent encrypt_pass DES 암호화 동기 변경
  - 127.0.0.1 바인딩 (외부 접근 차단)
  - smsuser DROP 권한 제거

### Sync Agent 영향
- Sync Agent는 **고객사 로컬 DB**에 접속하므로, 한줄로 MySQL(QTmsg 발송 DB)에는 직접 접속하지 않음
- **영향 없을 가능성 높음** — 단, Sync Agent가 한줄로 API를 통해 인증하는 경우:
  - API Key 인증: `test-sync-api-key-001` / `test-sync-api-secret-001` → 변경 여부 확인 필요
  - 서버 측 sync.ts 인증 로직이 D49 이후 변경되었는지 확인

### 수정 필요 사항
- [ ] Sync Agent → 한줄로 API 인증 키가 유효한지 확인
- [ ] 테스트 환경의 Docker MySQL 접속 정보(localhost:3307)는 무관 (로컬 테스트 전용)

---

## GAP-7: 🟡 Zod 스키마 불일치 (src/types/)

### Sync Agent v1.3.0 현재
- `src/types/` — Zod 스키마로 customer, purchase 데이터 검증
- 스키마가 Phase 7 기준 customers 테이블 구조에 맞춰져 있음

### 현행 불일치 예상
- age: optional → 파생 필드로 서버 계산 (Agent 전송 불필요할 수 있음)
- store_phone, registration_type, registered_store, recent_purchase_store: 스키마에 미정의
- custom_fields: JSONB 구조 미정의
- store_code: UNIQUE 키 구성요소로 중요도 상승

### 수정 필요 사항
- [ ] customerSchema에 신규 필드 6개 optional 추가
- [ ] custom_fields: z.record(z.string(), z.unknown()).optional() 추가
- [ ] store_code 필드 중요도 상향 (UNIQUE 키 구성)

---

## 수정 우선순위 & 작업 계획 (제안)

### Phase 1: 🔴 즉시 (Sync Agent가 현행 한줄로에 데이터를 보낼 수 없는 문제)

| # | 작업 | 예상 난이도 | 수정 파일 |
|---|------|-----------|----------|
| 1-1 | Zod customerSchema 신규 필드 추가 | 낮음 | src/types/customer.ts |
| 1-2 | autoSuggestMapping 패턴에 신규 필드 매핑 추가 | 중간 | src/mapping/templates.ts |
| 1-3 | custom_fields JSONB 구성 로직 추가 | 중간 | src/sync/engine.ts 또는 src/mapping/ |
| 1-4 | API 페이로드에 custom_fields + 신규 필드 포함 | 중간 | src/api/client.ts |
| 1-5 | store_code 전송 보장 (UNIQUE 키) | 낮음 | src/sync/engine.ts |

### Phase 2: 🟡 단기 (안정성 + 호환성)

| # | 작업 | 예상 난이도 | 수정 파일 |
|---|------|-----------|----------|
| 2-1 | standard-field-map.ts 기준 매핑 체계 도입 | 높음 | src/mapping/ 전체 리팩토링 |
| 2-2 | customer_field_definitions API 호출 추가 | 중간 | src/api/client.ts |
| 2-3 | 정규화 결과 서버 기대값 정합성 테스트 | 중간 | src/normalize/ |
| 2-4 | 수신거부 동기화 영향 분석 + 대응 | 중간 | 설계 먼저 |

### Phase 3: 🟢 중기 (고도화)

| # | 작업 | 예상 난이도 |
|---|------|-----------|
| 3-1 | 서버 /api/sync/customers에서 standard-field-map.ts 기반 동적 UPSERT 적용 여부 확인 |
| 3-2 | Sync Agent 설치 마법사에 custom 필드 매핑 UI 추가 |
| 3-3 | needsEncodingFix 자동 감지 고도화 (R4 리스크 해소) |
| 3-4 | v1.4.0 릴리스 빌드 + sync_releases 등록 |

---

## Harold님 결정 필요 사항

1. **GAP-3 옵션 선택:** Sync Agent 수정(A) vs 서버 호환 레이어(B) vs 병행(A+B)?
2. **custom_fields 범위:** Sync Agent에서 고객사 POS의 표준 16개 외 필드를 custom_1~15에 매핑하는 기능이 지금 필요한가, 아니면 향후 과제인가?
3. **서버 /api/sync/customers 현행 코드:** D39 이후 이 API도 FIELD_MAP 기반으로 변경되었는지, 아니면 레거시 INSERT가 아직 유지 중인지 확인 필요
4. **v1.4.0 릴리스 시점:** 상용화 전 Sync Agent 업데이트가 필수인지, 아니면 상용화 후 고도화 과제인지?
