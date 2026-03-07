# Sync Agent v1.4.0 수정 브리핑 — 비토 전달용 (FINAL)

> **작성일:** 2026-03-07
> **작성자:** Harold (프로젝트 오너)
> **목적:** Sync Agent v1.3.0 → v1.4.0 업데이트
> **긴급도:** 🔴 상용화 전 필수

---

## 배경

Sync Agent v1.3.0은 2026-02-25 빌드. 한줄로는 2026-02-26~27(D39~D48)에서 **DB 동적 전환을 전면 단행**했다. 핵심 변경:

- customers 테이블 → **표준 필드 17개 + custom_fields(JSONB) 15슬롯** 체계
- **standard-field-map.ts**가 유일한 필드 매핑 기준 (하드코딩 전면 제거)
- UNIQUE 제약 → `(company_id, COALESCE(store_code, '__NONE__'), phone)`
- 파생 필드 자동 계산: birth_date → birth_year, birth_month_day, age / address → region

---

## ✅ 서버(sync.ts) 수정 완료 — 비토가 할 필요 없음

**아래 5건은 한줄로 서버 sync.ts에서 이미 수정 완료 (208줄 추가, 64줄 삭제).**
Sync Agent만 이 서버에 맞춰서 수정하면 된다.

| # | 수정 내용 | 상태 |
|---|----------|------|
| 1 | INSERT 하드코딩 19컬럼 → **FIELD_MAP 기반 동적 생성** (getColumnFields) | ✅ 완료 |
| 2 | 신규 필드 4개(store_phone, registration_type, registered_store, recent_purchase_store) + birth_month_day 추가 | ✅ 완료 |
| 3 | custom_fields JSONB 병합: `COALESCE` → `CASE WHEN ... || ...` (기존값 보존+신규 병합) | ✅ 완료 |
| 4 | 파생 필드 서버 자동 계산: birth_date→birth_year/birth_month_day/age, address→region | ✅ 완료 |
| 5 | `POST /api/sync/field-definitions` 신규 엔드포인트 추가 | ✅ 완료 |

---

## 서버 API 현행 스펙 (Sync Agent가 맞춰야 할 것들)

### API 엔드포인트 목록 (8개 — 1개 신규 추가)

```
POST /api/sync/register             ← Agent 최초 등록
POST /api/sync/heartbeat            ← Agent 상태 보고
POST /api/sync/customers            ← 고객 데이터 벌크 UPSERT (최대 5,000건/배치)
POST /api/sync/purchases            ← 구매내역 벌크 INSERT
POST /api/sync/log                  ← 동기화 결과 로그 전송
POST /api/sync/field-definitions    ← 🆕 커스텀 필드 라벨 등록
GET  /api/sync/config               ← Agent 설정 원격 조회
GET  /api/sync/version              ← Agent 버전 확인
```

### POST /api/sync/customers — 페이로드 스펙

서버가 현재 받아들이는 고객 데이터 형식:

```json
{
  "mode": "incremental",
  "batchIndex": 1,
  "totalBatches": 5,
  "customers": [
    {
      // ── 표준 필드 17개 (standard-field-map.ts 기준) ──
      "name": "홍길동",
      "phone": "01012345678",
      "gender": "M",
      "birth_date": "1990-05-15",
      "age": 36,
      "email": "hong@example.com",
      "address": "서울시 강남구 역삼동 123",
      "recent_purchase_store": "홍대점",
      "recent_purchase_amount": 150000,
      "total_purchase_amount": 3500000,
      "store_code": "S001",
      "registration_type": "오프라인",
      "registered_store": "강남점",
      "store_phone": "02-1234-5678",
      "grade": "VIP",
      "points": 5000,
      "sms_opt_in": true,

      // ── 파생 필드 (선택 — 서버가 자동 계산하므로 없어도 됨) ──
      "birth_year": 1990,
      "region": "서울",

      // ── 커스텀 필드 (JSONB) ──
      "custom_fields": {
        "custom_1": "골드회원",
        "custom_2": "2024-12-25",
        "custom_3": "추천인: 김철수"
      }
    }
  ]
}
```

**서버 동작 상세:**

| 항목 | 서버 처리 방식 |
|------|--------------|
| phone | `normalizePhone()` 정규화 후 UPSERT |
| birth_date | `normalizeDate()` 후 → birth_year, birth_month_day, age **자동 계산** |
| age | Agent가 보낸 값 OR birth_date에서 파생값 (파생값 우선) |
| region | Agent가 보낸 값 OR address에서 시/도 자동 추출 |
| birth_year | Agent가 보낸 값 OR birth_date에서 자동 계산 |
| birth_month_day | birth_date에서 **서버가 자동 계산** (MM-DD 형식) |
| sms_opt_in | 미전송 시 **기본 true** |
| store_code | UNIQUE 키 구성요소. 없으면 서버에서 `'__NONE__'`으로 폴백 |
| custom_fields | JSONB — 서버에서 `기존값 \|\| 새값` 병합 (기존 커스텀 유지 + 신규 추가) |

**→ Agent가 반드시 보내야 하는 필드: `phone` (필수), 나머지는 전부 optional.**
**→ 파생 필드(birth_year, birth_month_day, age, region)는 안 보내도 서버가 계산.**
**→ custom_fields는 객체로 보내면 서버가 JSONB 병합.**

### 🆕 POST /api/sync/field-definitions — 커스텀 필드 라벨 등록

Sync Agent가 커스텀 필드를 매핑한 경우, **최초 동기화 시 1회** 호출.

```json
{
  "definitions": [
    { "field_key": "custom_1", "field_label": "결혼기념일", "field_type": "date" },
    { "field_key": "custom_2", "field_label": "추천인", "field_type": "string" },
    { "field_key": "custom_3", "field_label": "VIP구분", "field_type": "string" }
  ]
}
```

**제약:**
- `field_key`는 `custom_1` ~ `custom_15`만 허용
- 최대 15개
- 이미 등록된 정의가 있으면 UPSERT (덮어쓰기)
- `field_type` 미전송 시 기본 `'string'`

---

## Sync Agent 수정 항목 (비토 작업 범위)

### 수정 1: 🔴 Zod customerSchema 신규 필드 추가

**파일:** `src/types/customer.ts` (또는 해당 Zod 스키마 파일)

```typescript
// 기존 필드에 아래 추가:
store_phone: z.string().optional(),           // 매장전화번호
registration_type: z.string().optional(),     // 등록구분
registered_store: z.string().optional(),      // 등록매장정보
recent_purchase_store: z.string().optional(), // 최근구매매장
custom_fields: z.record(z.string(), z.unknown()).optional(), // JSONB 커스텀
store_code: z.string().optional(),            // UNIQUE 키 구성요소 — 중요!
```

---

### 수정 2: 🔴 autoSuggestMapping 패턴 추가

**파일:** `src/mapping/templates.ts`

한줄로 표준 필드 17개 (field_key 기준):

```
기존 유지:  name, phone, gender, age, birth_date, email, address,
            recent_purchase_amount, total_purchase_amount, grade, points, sms_opt_in,
            store_code

신규 추가:  store_phone, registration_type, registered_store, recent_purchase_store
```

신규 매핑 패턴 예시:

```typescript
{ pattern: /store.*phone|매장.*전화|매장.*번호|STORE_TEL|SHOP_TEL/i, field: 'store_phone', priority: 100 },
{ pattern: /reg.*type|등록.*구분|가입.*구분|REG_TYPE|JOIN_TYPE|REG_GB/i, field: 'registration_type', priority: 100 },
{ pattern: /reg.*store|등록.*매장|가입.*매장|REG_STORE|JOIN_STORE/i, field: 'registered_store', priority: 100 },
{ pattern: /recent.*store|최근.*매장|LST.*STORE|LAST_BUY_STORE|RCT_STORE/i, field: 'recent_purchase_store', priority: 100 },
```

---

### 수정 3: 🔴 custom_fields 자동 배정 로직

**핵심:** 고객사 POS 컬럼 중 표준 17개에 매핑 안 되는 나머지 → custom_1~custom_15에 자동 배정

**파일:** `src/mapping/` (매핑 결과 처리부) + `src/sync/engine.ts`

**로직:**

```
1. autoSuggestMapping 실행 → 표준 17개에 매핑된 컬럼 확정
2. 매핑 안 된 나머지 POS 컬럼 → custom_1, custom_2, ... custom_15 순서 배정
   - 최대 15개 (초과 시 경고 로그 + 초과분 무시)
3. 매핑 결과를 config.enc에 저장:
   {
     "columnMapping": {
       "MBR_NM": "name",
       "MBR_HP": "phone",
       "WEDDING_DT": "custom_1",    ← 표준에 없는 필드
       "RECOMMEND_BY": "custom_2"   ← 표준에 없는 필드
     },
     "customFieldLabels": {
       "custom_1": "결혼기념일",
       "custom_2": "추천인"
     }
   }
4. 동기화 시 custom 매핑된 값을 custom_fields 객체로 구성
5. 최초 동기화 시 POST /api/sync/field-definitions 호출
   → customFieldLabels를 서버에 등록
```

---

### 수정 4: 🔴 API 전송 페이로드 변경

**파일:** `src/api/client.ts` 또는 `src/sync/engine.ts`

**변경 전 (v1.3.0):**
```json
{
  "name": "홍길동",
  "phone": "01012345678",
  "gender": "M",
  "birth_date": "1990-05-15",
  "grade": "VIP"
}
```

**변경 후 (v1.4.0):**
```json
{
  "name": "홍길동",
  "phone": "01012345678",
  "gender": "M",
  "birth_date": "1990-05-15",
  "grade": "VIP",
  "store_code": "S001",
  "store_phone": "02-1234-5678",
  "registration_type": "오프라인",
  "registered_store": "강남점",
  "recent_purchase_store": "홍대점",
  "custom_fields": {
    "custom_1": "2024-12-25",
    "custom_2": "김철수"
  }
}
```

**핵심 변경점:**
- `store_code` 필수 전송 (UNIQUE 키 구성요소 — 없으면 null 전송)
- 신규 필드 4개 추가
- `custom_fields` 객체 추가
- **파생 필드(birth_year, birth_month_day, age, region)는 안 보내도 됨** — 서버가 자동 계산

---

### 수정 5: 🟡 설치 마법사 커스텀 매핑 지원

**파일:** `src/setup/cli.ts`, `src/setup/server.ts`, `src/setup/edit-config.ts`

매핑 결과 화면에서:
- 표준 17개 매핑 결과 표시
- **커스텀 배정 결과** 표시 (예: "WEDDING_DT → custom_1 (결혼기념일)")
- 사용자가 커스텀 슬롯 재배정 + 라벨 수정 가능

---

### 수정 6: 🟡 field-definitions 최초 등록 호출

**파일:** `src/sync/engine.ts` 또는 `src/index.ts`

**시점:** 최초 동기화 실행 시 (또는 매핑 변경 시) 1회 호출

```typescript
// 최초 동기화 또는 매핑 변경 감지 시
if (hasCustomFieldMappings && !fieldDefinitionsRegistered) {
  await apiClient.post('/api/sync/field-definitions', {
    definitions: Object.entries(config.customFieldLabels).map(([key, label]) => ({
      field_key: key,
      field_label: label,
      field_type: 'string'  // 또는 date/number 추론
    }))
  });
  // 성공 시 플래그 저장
}
```

---

### 수정 7: 🟡 needsEncodingFix 자동 감지 (선택)

**파일:** `src/db/mysql.ts`

현재 R4 리스크(정상 DB에서 오히려 깨질 수 있음) 해소를 위한 선택 과제.

최초 연결 시 샘플 HEX 체크:
```sql
SELECT HEX(한글컬럼) FROM 테이블 LIMIT 5
→ 한글 1글자 3바이트(정상) vs 6~7바이트(이중 인코딩) → 자동 판별
```

→ **v1.4.0에서 하면 좋지만, 시간 부족하면 v1.5.0으로 미뤄도 됨.**

---

## 수정 파일 요약

| # | 파일 | 수정 내용 | 우선순위 |
|---|------|----------|---------|
| 1 | src/types/customer.ts | Zod 스키마 신규 필드 + custom_fields | 🔴 |
| 2 | src/mapping/templates.ts | 신규 필드 4개 매핑 패턴 추가 | 🔴 |
| 3 | src/mapping/ (또는 신규) | custom_fields 자동 배정 로직 | 🔴 |
| 4 | src/sync/engine.ts | 전송 페이로드에 custom_fields + 신규 필드 | 🔴 |
| 5 | src/api/client.ts | field-definitions API 호출 + custom_fields 전송 | 🔴 |
| 6 | src/setup/cli.ts | 커스텀 매핑 결과 표시 + 라벨 입력 | 🟡 |
| 7 | src/setup/server.ts | 웹 UI에도 커스텀 매핑 반영 | 🟡 |
| 8 | src/setup/edit-config.ts | 커스텀 매핑 편집 지원 | 🟡 |
| 9 | src/db/mysql.ts | needsEncodingFix 자동 감지 (선택) | 🟢 |

---

## 테스트 체크리스트

- [ ] 기존 테스트 DB (20만+50만) 동기화 100% 성공 유지
- [ ] 신규 필드 4개가 한줄로 customers 테이블에 정상 저장
- [ ] custom_fields JSONB가 정상 저장 + 재동기화 시 **기존값 유지 + 신규 병합** 확인
- [ ] store_code가 UNIQUE 키에 정상 반영
- [ ] 커스텀 필드 라벨이 customer_field_definitions에 등록되는지 확인
- [ ] 파생 필드(birth_year, birth_month_day, age, region) 서버 자동 계산 정상 작동
- [ ] 한글 인코딩 깨짐 없음 (needsEncodingFix 동작 유지)
- [ ] --edit-config에서 커스텀 매핑 수정 가능
- [ ] v1.4.0 최종 빌드 (exe + Linux bin)

---

## 참고 문서 (비토 필독)

| 문서 | 위치 | 내용 |
|------|------|------|
| FIELD-INTEGRATION.md | status/ | 표준 필드 17개 + 커스텀 15개 전체 정의 (유일한 기준) |
| SCHEMA.md | status/ | customers 테이블 전체 컬럼 상세 |
| standard-field-map.ts | packages/backend/src/utils/ | FIELD_MAP 코드 — 이 구조에 맞춰야 함 |
| sync.ts (수정 완료) | packages/backend/src/routes/ | 서버 API 현행 코드 — 페이로드 참조 |

---

## Harold님 확정 사항

- ✅ Sync Agent를 직접 수정한다 (서버 호환 레이어 아님)
- ✅ custom_fields 커스텀 15개 슬롯 매핑은 **지금 반드시 필요**
- ✅ v1.4.0 릴리스를 **상용화 전에 완료**
- ✅ 서버 sync.ts는 이미 수정 완료 — Agent만 맞추면 됨
