# FIELD-INTEGRATION.md — 표준 필드 아키텍처 통합 가이드

> **목적:** 필수 직접 컬럼 + custom_fields 15개 기준으로 모든 하드코딩을 제거하고 통합한다.
> **기조:** 고객사가 올린 데이터에만 의존. 우리가 데이터를 예측하지 않는다.
> **원칙:** 버그 수정 완료된 발송 파이프라인(campaigns.ts, spam-filter.ts, messageUtils.ts, results.ts, billing.ts)은 절대 건드리지 않는다.
> **기준:** standard-field-map.ts가 유일한 매핑 정의. 모든 파일은 이것만 import.

---

## 0) 기조 (Harold님 확정)

1. **필수 직접 컬럼(17개, store_code 포함) + 커스텀 15개 슬롯 = 최대 32개의 그릇**을 갖추고 있다
2. **고객사가 어떤 스키마를 가지고 있든** AI 자동매핑 또는 수동매핑으로 우리 표준에 맞춘다
3. **잘못 매핑해도 수동으로 바로잡을 수 있다** (자동 + 수동 두 가지 모두 지원)
4. **고객DB현황은 고객사가 실제로 올린 데이터에 있는 필드만** 동적으로 보여준다
5. **AI 문안생성/타겟추출은 해당 고객사의 실제 스키마를 기초로** 동작한다
6. 고객사가 올리지 않은 필드는 **존재 자체를 모르는 것처럼** 동작한다

---

## 1) ✅ Harold님 확정 — 필수 직접 컬럼 (16개)

> 2026-02-26 Harold님 확정. 이것이 유일한 기준.

| # | field_key | displayName | DB 컬럼명 | DB 타입 | DB 존재 | 비고 |
|---|-----------|-------------|-----------|---------|--------|------|
| 1 | name | 고객명 | name | varchar(100) | ✅ | |
| 2 | phone | 고객전화번호 | phone | varchar(20) | ✅ | UNIQUE 키 구성 |
| 3 | gender | 성별 | gender | varchar(10) | ✅ | |
| 4 | age | 나이 | age | integer | ✅ | |
| 5 | birth_date | 생일 | birth_date | date | ✅ | |
| 6 | email | 이메일주소 | email | varchar(100) | ✅ | |
| 7 | address | 주소 | address | text | ✅ | |
| 8 | recent_purchase_store | 최근구매매장 | recent_purchase_store | varchar(100) | ✅ | |
| 9 | registration_type | 등록구분 | registration_type | varchar(50) | ✅ | 온라인/오프라인 |
| 10 | registered_store | 등록매장정보 | registered_store | varchar(100) | ✅ | 온라인→사이트명, 오프라인→매장명 |
| 11 | store_phone | 매장전화번호 | store_phone | varchar(20) | ❌ 신규 | 온라인→대표번호, 오프라인→매장번호 |
| 12 | recent_purchase_amount | 최근구매금액 | recent_purchase_amount | numeric(15,2) | ✅ | |
| 13 | total_purchase_amount | 누적구매금액 | total_purchase_amount | numeric(15,2) | ✅ | |
| 14 | grade | 고객등급 | grade | varchar(50) | ✅ | 업체마다 등급체계 다양 |
| 15 | points | 보유포인트 | points | integer | ✅ | |
| 16 | sms_opt_in | 수신동의여부 | sms_opt_in | boolean | ✅ | field_key≠컬럼명 주의 |

### 시스템 필수 컬럼 (사용자 노출 안 함, 업로드 대상 아님)

| 컬럼명 | 용도 |
|--------|------|
| id | uuid PK |
| company_id | uuid FK |
| store_code | UNIQUE 키 구성요소 (업로드 시 매핑 가능) |
| region | address에서 파생 가능. 기존 데이터 유지용 |
| birth_year | birth_date에서 자동 계산 |
| birth_month_day | birth_date에서 자동 계산 |
| is_active / is_opt_out / is_invalid | 시스템 상태 |
| source | upload / sync |
| custom_fields | JSONB (커스텀 15개 저장소) |
| uploaded_by | 업로드한 사용자 |
| created_at / updated_at | 타임스탬프 |

### 커스텀 필드 슬롯 (custom_fields JSONB) — 15개

| # | field_key | displayName 기본값 |
|---|-----------|-------------------|
| 1 | custom_1 | 커스텀1 |
| 2 | custom_2 | 커스텀2 |
| 3 | custom_3 | 커스텀3 |
| 4 | custom_4 | 커스텀4 |
| 5 | custom_5 | 커스텀5 |
| 6 | custom_6 | 커스텀6 |
| 7 | custom_7 | 커스텀7 |
| 8 | custom_8 | 커스텀8 |
| 9 | custom_9 | 커스텀9 |
| 10 | custom_10 | 커스텀10 |
| 11 | custom_11 | 커스텀11 |
| 12 | custom_12 | 커스텀12 |
| 13 | custom_13 | 커스텀13 |
| 14 | custom_14 | 커스텀14 |
| 15 | custom_15 | 커스텀15 |

- 업로드 시 필수 16개에 안 맞는 필드 → AI/수동매핑으로 custom_1~15에 배정
- 고객사별로 custom 슬롯의 의미가 다름 (A사: custom_1=구매횟수, B사: custom_1=결혼기념일)
- `customer_field_definitions` 테이블에 고객사별 커스텀 필드 라벨 저장
- AI 프롬프트에는 실제 라벨명으로 전달 ("custom_1"이 아니라 "구매횟수")

---

## 2) 🔴 DDL 변경 필요

```sql
-- store_phone 컬럼 추가
ALTER TABLE customers ADD COLUMN store_phone varchar(20);
```

- SCHEMA.md에 store_phone 추가 반영 필요
- 기존 컬럼은 삭제하지 않음 (기존 데이터 보존)

---

## 3) 카테고리 정의 (영문 기준 — 유일한 기준)

| 영문 키 | 한글 라벨 | 포함 필드 |
|---------|----------|----------|
| basic | 기본정보 | name, phone, gender, age, birth_date, email, address |
| purchase | 구매정보 | recent_purchase_store, recent_purchase_amount, total_purchase_amount |
| store | 매장/등록정보 | registration_type, registered_store, store_phone |
| membership | 등급/포인트 | grade, points |
| marketing | 수신동의 | sms_opt_in |
| custom | 커스텀 | custom_1 ~ custom_15 |

### 현재 불일치 상태

| standard-field-map.ts | customers.ts | Dashboard.tsx | AiCustomSendFlow |
|----------------------|-------------|---------------|-----------------|
| `basic` | `'기본정보'` | `basic` | `'기본정보'` |
| `segment` | `'등급/포인트'` | `segment` | `'등급/포인트'` |
| `purchase` | `'구매정보'` | `purchase` | `'구매정보'` |
| `store` | `'매장정보'` | `store` | `'지역정보'` |
| `marketing` | `'수신정보'` | `marketing` | (없음) |

→ **전부 불일치. 영문 키 기준으로 통일.**

---

## 4) 파일별 하드코딩 진단

### 4-1. customers.ts — L994~1209

| 위치 | 하드코딩 | 수정 방향 |
|------|---------|----------|
| L1011 `STANDARD_COLUMNS` (28개) | 컬럼명 Set | → `getColumnFields()` |
| L1021 `CATEGORY_MAP` (한글) | field_key→카테고리 | → `FIELD_MAP`에서 동적 조회 (영문) |
| L1093 `DETECTABLE_FIELDS` (24개) | 필드 배열 | → `FIELD_MAP` 기반 동적 감지 |

### 4-2. upload.ts — L504

| 위치 | 하드코딩 | 수정 방향 |
|------|---------|----------|
| L504 INSERT 18개 컬럼 | 컬럼목록+값+ON CONFLICT | → 동적 컬럼 목록 + custom_fields JSONB |
| L480-484 정규화 4개만 | gender/grade/region/smsOptIn | → normalizeByFieldKey() 동적 호출 |

### 4-3. Dashboard.tsx — L2551

| 위치 | 하드코딩 | 수정 방향 |
|------|---------|----------|
| L2551 `CAT_LABELS` (영문→한글) | 카테고리 라벨 | → CATEGORY_LABELS import 또는 백엔드 반환값 사용 |

### 4-4. services/ai.ts — L102, L115, L1097

| 위치 | 하드코딩 | 수정 방향 |
|------|---------|----------|
| L102 `DEFAULT_FIELD_MAPPINGS` (10개) | 한글변수→컬럼 | → FIELD_MAP + enabled-fields 기반 동적 |
| L115 `DEFAULT_AVAILABLE_VARS` (7개) | 변수명 배열 | → 고객사 보유 필드에서 동적 추출 |
| L1097 `FIELD_TO_VAR` (14개) | field_key→한글명 | → FIELD_MAP.displayName |

### 4-5. AiCustomSendFlow.tsx — L90

| 위치 | 하드코딩 | 수정 방향 |
|------|---------|----------|
| L90 `FIELD_CATEGORIES` (15개) | field_key→한글카테고리 | → 백엔드 반환 category(영문) 사용 |

### 4-6. normalize.ts — L313

| 위치 | 하드코딩 | 수정 방향 |
|------|---------|----------|
| L313 `normalizeCustomerRecord` (12개) | 필드 매핑 | → FIELD_MAP 기반 동적 확장 |

---

## 5) AI 프롬프트 동적 구성 원리

```
1. 고객사 업로드 → AI/수동 매핑 → 필수16개 + custom 슬롯에 저장
2. customer_field_definitions에 custom 슬롯의 실제 라벨 저장
   (예: custom_1 = "구매횟수", custom_3 = "결혼기념일")
3. AI 문안생성/타겟추출 시:
   → enabled-fields API로 해당 고객사의 실제 필드 목록 조회
   → 필드 목록 + 실제 라벨명을 AI 프롬프트에 주입
   → "사용 가능한 변수: %고객명%, %고객등급%, %구매횟수%"
4. AI는 그 변수들만 사용하여 문안 생성 / 타겟 추출
5. 고객사가 올리지 않은 필드는 목록에 없으므로 AI가 쓸 수 없음
```

---

## 6) 세션별 수정 계획

### ⚠️ 절대 금지 범위

campaigns.ts, spam-filter.ts, messageUtils.ts, results.ts, billing.ts, database.ts, auth.ts, 기타 버그 수정 영역 일체

---

### 세션 0: DDL + standard-field-map.ts 재정의 (완료 2026-02-26)

| # | 작업 | 상태 |
|---|------|------|
| 0-1 | customers 테이블 store_phone 컬럼 추가 DDL | ✅ |
| 0-2 | SCHEMA.md 업데이트 | ✅ |
| 0-3 | standard-field-map.ts 재작성 (필수17 + 시스템 + 커스텀15) | ✅ |

### ✅ 세션 1: 입구 정상화 — upload.ts + normalize.ts (완료 2026-02-26)

| # | 작업 | 상태 |
|---|------|------|
| 1-1 | upload.ts: standard-field-map.ts import | ✅ |
| 1-2 | upload.ts: INSERT 하드코딩 → 동적 컬럼 목록 (FIELD_MAP 기반 23파라미터) | ✅ |
| 1-3 | upload.ts: custom_fields JSONB 빌드 + 저장 | ✅ |
| 1-4 | upload.ts: ON CONFLICT UPDATE 동적 생성 + JSONB 병합 | ✅ |
| 1-5 | upload.ts: 정규화 → normalizeByFieldKey() 루프 (birth_date 특별 처리) | ✅ |
| 1-6 | upload.ts: AI 매핑 프롬프트 FIELD_MAP 기반 동적 생성 | ✅ |
| 1-7 | upload.ts: 파생 필드 자동 계산 (birth→year/monthday/age, address→region) | ✅ |
| 1-8 | upload.ts: 커스텀 필드 정의 customer_field_definitions 자동 저장 | ✅ |
| 1-9 | normalize.ts: standard-field-map.ts import + normalizeByFieldKey() + normalizeEmail() | ✅ |
| 1-10 | Dashboard.tsx: /mapping, /progress Authorization 토큰 누락 수정 | ✅ |
| 검증 | 입력→출력 시뮬레이션 + INSERT 컬럼/파라미터 정합성 확인 | ✅ |

### ✅ 세션 2: 조회 + AI 정상화 (완료 2026-02-27)

| # | 작업 | 상태 |
|---|------|------|
| 2-1 | customers.ts: STANDARD_COLUMNS/CATEGORY_MAP/DETECTABLE_FIELDS 삭제 → FIELD_MAP 기반 동적 생성 | ✅ |
| 2-2 | customers.ts: 카테고리 영문 반환 통일 + enabled-fields 응답에 categories: CATEGORY_LABELS 추가 | ✅ |
| 2-3 | Dashboard.tsx: CAT_LABELS 삭제 → 백엔드 categories 응답 사용 (categoryLabels state) | ✅ |
| 2-4 | services/ai.ts: DEFAULT_FIELD_MAPPINGS/DEFAULT_AVAILABLE_VARS/FIELD_TO_VAR 삭제 → buildVarCatalogFromFieldMap() + fieldKeyToVarName() | ✅ |
| 2-5 | AiCustomSendFlow.tsx: FIELD_CATEGORIES 삭제 + CATEGORY_ICONS 영문 키 전환 → 백엔드 category 사용 | ✅ |
| 검증 | 필터 UI 정상 + AI가 보유 필드만 사용 | ⬜ 실동작 검증 대기 |

---

## 6-1) 세션 1 결정사항 (Harold님 확정 2026-02-26)

| 항목 | 결정 |
|------|------|
| 레거시 컬럼 | **옵션 A — 미사용.** total_purchase, callback, store_name, last_purchase_date, purchase_count는 신규 업로드에서 사용하지 않음. 기존 데이터 보존, 신규는 필수 17개 + custom_fields만 |
| 파생 필드 | birth_date에서 birth_year/birth_month_day/age 자동 계산. address에서 region 파생 |
| birth_date 특별 처리 | normalizeByFieldKey 루프에서 제외 — 4자리 연도(예: 1983) 감지를 위해 파생 로직에서 직접 처리 |
| AI 매핑 커스텀 자동 배정 | 필수 17개에 매핑 안 되는 필드 → custom_1~15 순서 배정, 원본 라벨 customer_field_definitions에 저장 |
| custom_fields JSONB 병합 | ON CONFLICT 시 기존 custom_fields에 || 연산자로 병합 (기존 값 유지 + 신규 추가) |

---

## 6-2) 세션 2 결정사항 (Harold님 확정 2026-02-27)

| 항목 | 결정 |
|------|------|
| 카테고리 라벨 | **백엔드가 CATEGORY_LABELS를 응답에 포함.** 프론트는 별도 하드코딩 없이 백엔드 응답 그대로 사용. 카테고리 정의의 유일한 기준은 standard-field-map.ts |
| ai.ts 폴백 | **하드코딩 폴백 전면 삭제.** customer_schema 없으면 FIELD_MAP 기반 동적 생성 (buildVarCatalogFromFieldMap). 고객사 실제 보유 데이터만 AI에 전달 |
| 프론트 카테고리 아이콘 | 영문 키(basic, purchase, store, membership, marketing, custom)로 직접 매핑. UI 표시 전용, 비즈니스 로직 아님 |

---

## 7) 정상 동작 (건드리면 안 됨)

- ✅ AI 자동매핑 (/api/upload/mapping)
- ✅ 수동매핑 UI
- ✅ 발송 5개 경로 치환 (messageUtils.ts)
- ✅ 스팸필터 테스트
- ✅ 발송결과 조회 (results.ts)
- ✅ 정산 (billing.ts)
- ✅ 선불/후불 차감·환불

---

*최종 업데이트: 2026-02-27 — 세션0~2 전체 완료. 세션2: customers.ts 하드코딩 4곳(STANDARD_COLUMNS/CATEGORY_MAP/DETECTABLE_FIELDS/dataCheck) 삭제→FIELD_MAP 동적, ai.ts 3곳(DEFAULT_FIELD_MAPPINGS/DEFAULT_AVAILABLE_VARS/FIELD_TO_VAR) 삭제→FIELD_MAP 동적, Dashboard.tsx CAT_LABELS 삭제→백엔드 categories 사용, AiCustomSendFlow.tsx FIELD_CATEGORIES 삭제→백엔드 category 사용. 실동작 검증 대기.*
