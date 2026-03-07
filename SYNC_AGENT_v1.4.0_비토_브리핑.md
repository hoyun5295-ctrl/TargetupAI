# Sync Agent v1.4.0 수정 브리핑 — 비토 전달용

> **작성일:** 2026-03-06
> **작성자:** Harold (프로젝트 오너)
> **목적:** Sync Agent v1.3.0 → v1.4.0 업데이트. 한줄로 DB 동적 전환(D39~D48, 2026-02-26~27) 반영.
> **긴급도:** 🔴 상용화 전 필수. 현행 한줄로 시스템과 Sync Agent가 불일치 상태.

---

## 배경 — 왜 수정이 필요한가

Sync Agent v1.3.0은 **2026-02-25** 기준으로 빌드되었다.
그런데 한줄로 서버는 **2026-02-26~27** (D39~D48)에서 **DB 동적 전환을 전면 단행**했다.

핵심 변경 내용:
- customers 테이블에 **신규 필드 6개 + custom_fields(JSONB) 추가**
- **UNIQUE 제약** 변경: `(company_id, phone)` → `(company_id, COALESCE(store_code, '__NONE__'), phone)`
- **컬럼 매핑 기준** 전면 교체: `standard-field-map.ts`가 유일한 매핑 기준
- **파생 필드** 자동 계산 체계 도입 (birth_date → birth_year, birth_month_day, age)
- 커스텀 필드 15개 슬롯(`custom_1~custom_15`)이 `custom_fields` JSONB 컬럼에 저장

**결과: Sync Agent v1.3.0이 보내는 데이터 구조가 현행 한줄로 서버와 맞지 않음.**

---

## 🔴 확인 우선 (비토 먼저 확인 필요)

### 서버 `/api/sync/customers` API 현재 상태 확인

한줄로 백엔드의 **sync.ts** (또는 sync 관련 라우트 파일)에서 `POST /api/sync/customers` 엔드포인트를 확인해줘.

**확인 포인트:**
1. INSERT/UPSERT 쿼리가 **FIELD_MAP 기반 동적**으로 바뀌었는가, 아니면 **예전 하드코딩 INSERT**가 아직 남아있는가?
2. ON CONFLICT 조건이 `(company_id, COALESCE(store_code, '__NONE__'), phone)`으로 변경되었는가?
3. custom_fields JSONB 병합 로직이 있는가?
4. 파생 필드(birth_year, birth_month_day, age, region) 자동 계산이 서버에서 수행되는가?

→ 이 확인 결과에 따라 Sync Agent가 보내야 하는 **정확한 JSON 페이로드 형식**이 결정됨.

---

## 수정 항목 총 정리

### 수정 1: 🔴 Zod customerSchema 신규 필드 추가

**파일:** `src/types/customer.ts` (또는 해당 Zod 스키마 파일)

**추가할 필드:**

```typescript
// 신규 필수 직접 컬럼 (모두 optional — 고객사마다 보유 필드가 다름)
store_phone: z.string().optional(),           // 매장전화번호
registration_type: z.string().optional(),     // 등록구분 (온라인/오프라인)
registered_store: z.string().optional(),      // 등록매장정보
recent_purchase_store: z.string().optional(), // 최근구매매장

// custom_fields JSONB — 핵심 추가
custom_fields: z.record(z.string(), z.unknown()).optional(),
// 예: { "custom_1": "VIP등급", "custom_2": "2024-12-25", ... }

// store_code 중요도 상향 (UNIQUE 키 구성요소)
store_code: z.string().optional(),  // 이미 있을 수 있지만 확인 필요
```

**참고:** `age`는 서버에서 birth_date 기반 자동 계산하므로 Agent가 직접 보낼 필요 없음. 단, 고객사 POS에 나이 컬럼이 따로 있으면 매핑 가능하도록 optional로 유지.

---

### 수정 2: 🔴 autoSuggestMapping 패턴 추가

**파일:** `src/mapping/templates.ts`

한줄로의 현행 표준 필드 16개에 맞는 매핑 패턴 추가:

```
현행 한줄로 표준 필드 (field_key 기준):
─────────────────────────────────────
name             → 고객명
phone            → 고객전화번호
gender           → 성별
age              → 나이
birth_date       → 생일
email            → 이메일주소
address          → 주소
recent_purchase_store  → 최근구매매장     ← 신규
registration_type      → 등록구분         ← 신규
registered_store       → 등록매장정보      ← 신규
store_phone            → 매장전화번호      ← 신규
recent_purchase_amount → 최근구매금액
total_purchase_amount  → 누적구매금액
grade            → 고객등급
points           → 보유포인트
sms_opt_in       → 수신동의여부
```

**추가해야 할 매핑 패턴 예시:**

```typescript
// 신규 필드 매핑 패턴
{ pattern: /store.*phone|매장.*전화|매장.*번호|STORE_TEL/i, field: 'store_phone', priority: 100 },
{ pattern: /reg.*type|등록.*구분|가입.*구분|REG_TYPE|JOIN_TYPE/i, field: 'registration_type', priority: 100 },
{ pattern: /reg.*store|등록.*매장|가입.*매장|REG_STORE/i, field: 'registered_store', priority: 100 },
{ pattern: /recent.*store|최근.*매장|LST.*STORE|LAST_BUY_STORE/i, field: 'recent_purchase_store', priority: 100 },
```

**주의:** 기존 매핑 패턴과 충돌하지 않도록 priority 조정. 특히 `STORE_NM`은 기존 BUG-003에서 수정한 로직 유지.

---

### 수정 3: 🔴 custom_fields JSONB 구성 로직 추가

**핵심 개념:** 고객사 POS DB 컬럼 중 표준 16개에 매핑 안 되는 필드 → `custom_1 ~ custom_15` 슬롯에 자동 배정

**파일:** `src/mapping/` 또는 `src/sync/engine.ts`

**로직:**

```
1. autoSuggestMapping 실행 → 표준 16개 필드에 매핑된 컬럼 확정
2. 매핑 안 된 나머지 컬럼 → custom_1, custom_2, ... custom_15 순서로 자동 배정
3. 최대 15개까지만 (초과 시 경고 로그)
4. 매핑 결과를 config.enc에 저장 (기존 구조 활용)
5. 동기화 시 custom 매핑된 필드값을 custom_fields 객체로 구성:
   {
     "custom_1": "POS에서 가져온 값",
     "custom_2": "POS에서 가져온 값",
     ...
   }
```

**설치 마법사(setup) 연동:**
- 매핑 결과 화면에서 표준 16개 + 커스텀 배정 결과를 보여줘야 함
- 사용자가 수동으로 커스텀 슬롯 재배정 가능해야 함 (--edit-config로도)

---

### 수정 4: 🔴 API 페이로드 구조 변경

**파일:** `src/api/client.ts` 또는 `src/sync/engine.ts`

**현재 (v1.3.0) 전송 형식 (추정):**
```json
{
  "customers": [
    {
      "name": "홍길동",
      "phone": "01012345678",
      "gender": "M",
      "birth_date": "1990-05-15",
      "grade": "VIP",
      "points": 5000,
      "store_code": "S001",
      ...
    }
  ]
}
```

**변경 후 (v1.4.0) 전송 형식:**
```json
{
  "customers": [
    {
      "name": "홍길동",
      "phone": "01012345678",
      "gender": "M",
      "birth_date": "1990-05-15",
      "grade": "VIP",
      "points": 5000,
      "store_code": "S001",
      "store_phone": "02-1234-5678",
      "registration_type": "오프라인",
      "registered_store": "강남점",
      "recent_purchase_store": "홍대점",
      "recent_purchase_amount": 150000,
      "total_purchase_amount": 3500000,
      "sms_opt_in": true,
      "email": "hong@example.com",
      "address": "서울시 강남구 역삼동",
      "custom_fields": {
        "custom_1": "골드회원",
        "custom_2": "2024-12-25",
        "custom_3": "추천인: 김철수"
      }
    }
  ]
}
```

**핵심 변경점:**
- `custom_fields` 객체 추가 (JSONB로 서버에 저장)
- `store_code` 반드시 포함 (없으면 서버에서 `'__NONE__'`으로 처리 — UNIQUE 키 영향)
- 신규 필드 4개 추가 (store_phone, registration_type, registered_store, recent_purchase_store)
- **파생 필드(birth_year, birth_month_day, age, region)는 보내지 않아도 됨** — 서버에서 자동 계산

---

### 수정 5: 🔴 store_code 전송 보장

**파일:** `src/sync/engine.ts`

현행 한줄로 customers 테이블의 UNIQUE 제약:
```sql
UNIQUE (company_id, COALESCE(store_code, '__NONE__'), phone)
```

**의미:** 같은 전화번호라도 매장코드가 다르면 **별도 고객 레코드**로 저장됨.

**Sync Agent 대응:**
- 고객사 POS에 store_code(매장코드) 컬럼이 있으면 → 반드시 매핑해서 전송
- 없으면 → store_code 필드를 생략하거나 null 전송 (서버에서 `'__NONE__'`으로 폴백)
- autoSuggestMapping에 store_code 패턴이 이미 있는지 확인 → 없으면 추가:

```typescript
{ pattern: /store.*code|매장.*코드|STORE_CD|SHOP_CD|BR_CD/i, field: 'store_code', priority: 120 },
```

---

### 수정 6: 🟡 customer_field_definitions 등록 API

**파일:** `src/api/client.ts`

Sync Agent가 커스텀 필드를 매핑한 경우, **최초 동기화 시** 서버에 커스텀 필드 라벨을 등록해야 함.

**확인 필요:** 한줄로 서버에 이 API가 이미 있는지 비토가 확인:
```
POST /api/sync/field-definitions  (또는 유사 엔드포인트)
```

**페이로드 예시:**
```json
{
  "company_id": "081000cc-...",
  "definitions": [
    { "field_key": "custom_1", "field_label": "결혼기념일", "field_type": "date" },
    { "field_key": "custom_2", "field_label": "추천인", "field_type": "string" },
    { "field_key": "custom_3", "field_label": "VIP여부", "field_type": "string" }
  ]
}
```

→ 이 API가 없으면 **서버에 신규 엔드포인트 추가 필요** (한줄로 백엔드 sync.ts에 추가)

---

### 수정 7: 🟡 정규화 결과 정합성 확인

**파일:** `src/normalize/`

Sync Agent의 정규화 결과가 한줄로 서버 기대값과 일치하는지 점검:

| 필드 | Agent 정규화 | 서버 기대값 | 확인 |
|------|-------------|-----------|------|
| phone | 01012345678 (하이픈 제거) | 01012345678 | ✅ 동일 |
| gender | M/F | M/F 또는 male/female | ⬜ 확인 필요 |
| birth_date | YYYY-MM-DD (ISO) | YYYY-MM-DD (date 타입) | ✅ 동일 |
| amount | 숫자 (소수점 2자리) | numeric(15,2) | ⬜ 정밀도 확인 |
| grade | 원본 그대로 | varchar(50) | ✅ |
| email | 소문자+trim | varchar(100) | ⬜ Agent에 email 정규화 있는지 확인 |
| sms_opt_in | boolean | boolean | ✅ |

---

### 수정 8: 🟡 needsEncodingFix 자동 감지 개선 (선택사항)

**파일:** `src/db/mysql.ts`

현재 v1.3.0의 `needsEncodingFix=true` 강제 설정은 정상 utf8mb4 DB에서 오히려 데이터를 깨뜨릴 수 있음 (RISK R4).

**개선안:** 최초 연결 시 샘플 데이터 HEX 체크로 이중 인코딩 자동 감지:
```
SELECT HEX(컬럼명) FROM 테이블 LIMIT 5
→ 한글 1글자가 3바이트(ECA095 등)면 정상, 6~7바이트면 이중 인코딩
→ 자동으로 needsEncodingFix 결정
```

→ 이건 v1.4.0에서 하면 좋고, 시간 부족하면 v1.5.0으로 미뤄도 됨.

---

## 수정 파일 요약

| # | 파일 | 수정 내용 | 우선순위 |
|---|------|----------|---------|
| 1 | src/types/customer.ts | Zod 스키마 신규 필드 + custom_fields 추가 | 🔴 |
| 2 | src/mapping/templates.ts | 신규 필드 매핑 패턴 추가 | 🔴 |
| 3 | src/mapping/ (또는 신규 파일) | custom_fields 자동 배정 로직 | 🔴 |
| 4 | src/sync/engine.ts | 전송 페이로드에 custom_fields + 신규 필드 포함 | 🔴 |
| 5 | src/api/client.ts | custom_fields 포함 전송 + field-definitions 등록 API | 🔴 |
| 6 | src/setup/cli.ts + server.ts | 설치 마법사에 커스텀 필드 매핑 UI/CLI 추가 | 🟡 |
| 7 | src/setup/edit-config.ts | 커스텀 매핑 편집 지원 | 🟡 |
| 8 | src/normalize/ | email 정규화 추가 + 정합성 확인 | 🟡 |
| 9 | src/db/mysql.ts | needsEncodingFix 자동 감지 (선택) | 🟢 |

---

## 테스트 체크리스트

- [ ] 기존 테스트 DB (Docker MySQL 8.0, 20만+50만)로 동기화 100% 성공 유지
- [ ] 신규 필드 4개가 한줄로 customers 테이블에 정상 저장되는지 확인
- [ ] custom_fields JSONB가 정상 저장 + 재동기화 시 병합(||)되는지 확인
- [ ] store_code가 UNIQUE 키에 정상 반영되는지 확인
- [ ] 커스텀 필드 라벨이 customer_field_definitions에 등록되는지 확인
- [ ] 한글 인코딩 깨짐 없는지 확인 (needsEncodingFix 동작 유지)
- [ ] --edit-config로 커스텀 매핑 수정 가능한지 확인
- [ ] v1.4.0 최종 빌드 (exe + Linux bin)

---

## 참고 문서

비토가 작업할 때 반드시 참조해야 할 한줄로 측 문서:

1. **FIELD-INTEGRATION.md** — 표준 필드 16개 + 커스텀 15개 전체 정의 (유일한 기준)
2. **SCHEMA.md** — customers 테이블 전체 컬럼 상세
3. **STATUS.md 섹션 7-1** — standard-field-map.ts 아키텍처 설명
4. **STATUS.md D39~D48** — DB 동적 전환 작업 이력

이 문서들을 비토한테 같이 전달하면 가장 좋음.

---

## Harold님 메모

> 확정 사항:
> - Sync Agent를 직접 수정한다 (서버 호환 레이어 아님)
> - custom_fields 커스텀 15개 슬롯 매핑은 지금 반드시 필요
> - v1.4.0 릴리스를 상용화 전에 완료한다
