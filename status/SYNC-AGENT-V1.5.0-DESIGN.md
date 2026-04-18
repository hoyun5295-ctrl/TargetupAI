# Sync Agent v1.5.0 완전 설계서

> **작성일:** 2026-04-18
> **목적:** Sync Agent v1.5.0 릴리스를 위한 모든 설계 결정사항 확정본
> **전제:** 한줄로AI 기존 패턴이 있으면 반드시 그것을 복제. 새 정책 창안 금지.
> **구현 시점:** 다음 세션 (2~3일 소요 예상)
> **QA:** 서팀장이 v1.5.0 완성본으로 전체 테스트
> **배포:** v1.5.0 빅뱅. 파일럿 없음 (기존 사용자 0).

---

## 📑 목차

1. [핵심 철학](#1-핵심-철학)
2. [토론 결정사항 요약표 (T-1 ~ T-6)](#2-토론-결정사항-요약표)
3. [엔드-투-엔드 플로우](#3-엔드-투-엔드-플로우)
4. [T-1: 사용자/브랜드별 격리](#4-t-1-사용자브랜드별-격리)
5. [T-2: AI 매핑 (Opus 4.7)](#5-t-2-ai-매핑-opus-47)
6. [T-3: 삭제 감지](#6-t-3-삭제-감지)
7. [T-5: 동기화 주기](#7-t-5-동기화-주기)
8. [UUID 정책 (T-1 사전 토론)](#8-uuid-정책)
9. [DB 스키마 변경](#9-db-스키마-변경)
10. [API 명세](#10-api-명세)
11. [설치 마법사 UX](#11-설치-마법사-ux)
12. [기존 Gap 정리 체크리스트](#12-기존-gap-정리-체크리스트)
13. [구현 체크리스트](#13-구현-체크리스트)
14. [배포 계획 (T-6)](#14-배포-계획)
15. [롤백 절차](#15-롤백-절차)

---

## 1. 핵심 철학

### 1-1. 한줄로AI 표준 복제 원칙 (절대 원칙)

**"Sync Agent는 새 정책을 창안하지 않는다. 한줄로AI 기존 패턴을 정확히 복제한다."**

- 수신거부 처리 → `upload.ts` 의 CT-03 3단 배정 패턴 복제
- AI 매핑 → `upload.ts /mapping` 프롬프트 구조 복제
- 삭제 감지 → 한줄로 표준(감지 안 함) 복제
- 정규화 → `utils/normalize.ts` + `normalizeByFieldKey()` 재사용
- 필드 매핑 → `utils/standard-field-map.ts` FIELD_MAP 기준

### 1-2. AI 사용 경계

- **Claude Opus 4.7** = 최초 설치 시 **DB 컬럼 매핑 1회** 전용
- 이후 동기화 루프에 AI 개입 없음
- 재호출 트리거: 새 컬럼 발견 / 사용자 "재추천" 클릭 / 매핑 수동 리셋
- **폴백 체인:** Opus 4.7 → Sonnet 4.6 → 기존 `autoSuggestMapping()` (Agent 로컬)

### 1-3. 멀티테넌트 + 샤딩 전제

- `company_id` 기반 멀티테넌트 (현재 구조 불변)
- 고객 3,000만 row마다 샤드 추가 (HPE DL20 Gen11 스펙 기준)
- 슈퍼관리자 메타 DB가 `company_id → shard_id` 라우팅
- **네트워크/DB 비용 최적화는 불필요** (서버 스펙으로 커버). Agent hash 비교 등 과잉설계 폐기

### 1-4. 효율성 우선

- 증분 동기화만 사용. 풀싱크는 최초 설치 1회 외에는 없음
- `updated_at > lastSyncAt` 기준 변경분만 조회
- UPSERT는 `ON CONFLICT DO UPDATE` 그대로 (write amplification 허용)

---

## 2. 토론 결정사항 요약표

| # | 주제 | 확정 사항 |
|---|------|---------|
| **T-1** | 사용자/브랜드별 격리 | `store_code` AI 자동 매핑 + 시스템 가상 user (`is_system=true`) + 엑셀 업로드 차단 모달 + CT-03 3단 배정 |
| **T-2** | AI 매핑 (Opus 4.7) | `upload.ts /mapping` 복제 + 프롬프트 캐싱 + 컬럼명만 전송 + 커스텀 15개까지 순서 배정 |
| **T-3** | 삭제 감지 | 한줄로 표준 복제 = 감지 안 함. `sms_opt_in` 변경으로 자동 처리 |
| T-4 | PII 정책 | T-2에 흡수 (컬럼명만 전송) |
| **T-5** | 동기화 주기 | 6시간 고정 (하루 4회), Heartbeat 1시간, 큐 재전송 30분, 설정 폴링 제거, 슈퍼관리자만 설정 |
| **T-6** | 배포/롤아웃 | v1.5.0 빅뱅. 파일럿 없음. 서팀장 QA. 2~3일 구현 |
| 사전 | UUID + customer_code | `customers.id` 유지 + `customer_code` 신규 컬럼 (회사 login_id + 시퀀스 6자리) + UI 숨김 |

---

## 3. 엔드-투-엔드 플로우

```
┌───────────────────────────────────────────────────────────────────┐
│                    [설치 시점 — 1회만]                             │
│                                                                   │
│  [슈퍼관리자] sys.hanjullo.com                                    │
│    · 고객사 계약 체결                                              │
│    · api_key/api_secret 발급                                      │
│    · companies.use_db_sync = true                                 │
│    · 싱크 주기 설정 (기본 6시간)                                   │
│    · 시스템 user 자동 생성 (트리거)                                │
│           ↓                                                       │
│  [고객사 담당자] Agent 설치                                        │
│    · SyncAgent-Setup-1.5.0.exe (Windows)                         │
│    · 또는 SyncAgent-1.5.0-linux-x64.tar.gz (Linux)               │
│    · 설치 마법사 → DB 접속 정보 입력                               │
│    · "AI 자동 매핑" 버튼 클릭                                      │
│           ↓                                                       │
│  [Agent] 소스 DB 스캔                                             │
│    · 테이블/컬럼 목록 조회                                         │
│    · 샘플 20건 SELECT (field_type 감지용, 외부 전송 ❌)           │
│           ↓                                                       │
│  [Agent → 한줄로 서버] POST /api/sync/ai-mapping                  │
│    body: { columns: [...], target: 'customers' }                 │
│           ↓                                                       │
│  [서버] Anthropic SDK 호출                                        │
│    · Model: claude-opus-4-7                                       │
│    · FIELD_MAP 프롬프트 캐싱 (cache_control: ephemeral)           │
│    · 폴백: Sonnet 4.6 → 로컬 autoSuggestMapping()                │
│           ↓                                                       │
│  [서버 → Agent] 매핑 결과 반환                                    │
│    { "CUST_HP": "phone", "MBR_NM": "name", ... }                 │
│           ↓                                                       │
│  [Agent] 설치 마법사 UI에 매핑 자동 입력 (사용자 검토/수정 가능)  │
│           ↓                                                       │
│  [Agent → 서버] POST /api/sync/field-definitions                 │
│    · custom_1~custom_15 라벨 등록 (CT-07)                         │
│           ↓                                                       │
│  [Agent] config.enc 저장 + 서비스 등록 (systemd/sc.exe)           │
│           ↓                                                       │
│  [최초 풀싱크 1회] POST /api/sync/customers (mode: 'full')        │
│    · 전체 고객 전송                                                │
│    · customers.id (UUID) 자동 부여                                 │
│    · customer_code 자동 생성 ({login_id}-000001)                  │
└───────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────┐
│                    [운영 시점 — 6시간마다]                         │
│                                                                   │
│  [스케줄러] 6시간 주기 cron                                       │
│           ↓                                                       │
│  [Agent] 소스 DB에서 증분 조회                                    │
│    · SELECT * FROM customer_table                                │
│      WHERE updated_at > lastSyncAt                               │
│      LIMIT 4000 OFFSET N                                          │
│           ↓                                                       │
│  [Agent] 컬럼 매핑 + Zod 검증                                     │
│    · 컬럼 매핑은 설치 시 AI가 확정한 것 그대로 사용 (AI 재호출 없음)│
│           ↓                                                       │
│  [Agent → 서버] POST /api/sync/customers (mode: 'incremental')    │
│           ↓                                                       │
│  [서버] FIELD_MAP 기반 동적 UPSERT                                │
│    · ON CONFLICT (company_id, store_code, phone) DO UPDATE        │
│    · sms_opt_in=false → unsubscribes 자동 INSERT                 │
│      (시스템 user + admin + store_code 담당 user에게 3단 배정)    │
│    · 응답에 config 포함 (설정 폴링 제거)                          │
│           ↓                                                       │
│  [Agent] config 변경 감지 시 스케줄러 재시작                      │
│                                                                   │
│  [Heartbeat] 매 1시간 POST /api/sync/heartbeat                    │
│  [큐 재전송] 매 30분 (큐에 있을 때만)                             │
└───────────────────────────────────────────────────────────────────┘
```

---

## 4. T-1: 사용자/브랜드별 격리

### 4-1. 3단계 격리 구조 (한줄로 기존)

| Level | 키 | 적용 |
|-------|----|------|
| 1. 회사 격리 | `company_id` | 절대 불변. 모든 쿼리에 자동 적용 |
| 2. 브랜드 격리 | `customers.store_code` ↔ `users.store_codes[]` | `company_user`만 적용. admin은 전체 |
| 3. 업로더 격리 | `customers.uploaded_by` | 옵션 기능, 거의 미사용 |

### 4-2. 싱크 데이터의 3단계 적용

**① 회사 격리:** `sync_agents.company_id` 기반 자동. 변경 없음.

**② 브랜드 격리:** 소스 DB의 구분자 컬럼(예: `STORE_CD`)을 `store_code`로 AI 매핑. 매핑되면:
- company_user가 자기 `store_codes` 범위만 조회
- 매핑 안 되면 단일 브랜드 회사로 처리 (store_code=NULL)
- 매핑 결과에 `store_code` 없는데 **다매장 업체**인 경우 → 설치 마법사에서 슈퍼관리자에게 경고

**③ 업로더 격리:** **시스템 가상 user**가 `uploaded_by`에 기록됨.
- `users.is_system=true` 컬럼 추가
- 회사 생성 시 자동으로 시스템 user INSERT (트리거 또는 회사 생성 API에서 함께 처리)
- 로그인 차단 (login API에서 `is_system=false` 강제)
- 관리자 UI에서 숨김

### 4-3. 수신거부 처리 (upload.ts admin 패턴 복제)

**싱크 시 `sms_opt_in=false` 고객 발견 시:**

```sql
-- 1. 시스템 user에게 INSERT (source='sync')
INSERT INTO unsubscribes (company_id, user_id, phone, source)
SELECT $companyId, $systemUserId, phone, 'sync'
FROM customers
WHERE company_id = $companyId AND sms_opt_in = false AND is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM unsubscribes u WHERE u.user_id = $systemUserId AND u.phone = customers.phone
  )
ON CONFLICT (user_id, phone) DO NOTHING;

-- 2. 회사의 admin user들에게도 INSERT (D88 패턴 복제)
INSERT INTO unsubscribes (company_id, user_id, phone, source)
SELECT c.company_id, u.id, c.phone, 'sync'
FROM customers c
JOIN users u ON u.company_id = c.company_id AND u.user_type = 'admin'
WHERE c.company_id = $companyId AND c.sms_opt_in = false AND c.is_active = true
ON CONFLICT (user_id, phone) DO NOTHING;

-- 3. store_code 담당 company_user들에게 INSERT (upload.ts 패턴 복제)
INSERT INTO unsubscribes (company_id, user_id, phone, source)
SELECT c.company_id, u.id, c.phone, 'sync'
FROM customers c
JOIN users u ON u.company_id = c.company_id AND u.user_type = 'user'
  AND c.store_code = ANY(u.store_codes)
WHERE c.company_id = $companyId AND c.sms_opt_in = false AND c.is_active = true
ON CONFLICT (user_id, phone) DO NOTHING;
```

**재동의 처리:** 없음 (한줄로 표준 = 수동 삭제만).

### 4-4. 엑셀 업로드 차단 (싱크 사용 중 회사)

**차단 조건:**
```
companies.use_db_sync = true 
AND EXISTS (SELECT 1 FROM sync_agents WHERE company_id = $companyId AND status = 'active')
```

**차단 대상 UI:**
- 고객 DB 엑셀 업로드 버튼
- 고객 개별 수동 추가/수정
- 고객 전체 삭제 버튼

**허용 대상 UI:**
- 직접발송 수신자 엑셀 (일회성 목록)
- 수신거부 번호 엑셀 업로드 (unsubscribes 독립)
- AI 분석 / 발송 (데이터 조회/발송만)

**차단 모달 (공통 컴포넌트 `SyncActiveBlockModal.tsx`):**
```
┌────────────────────────────────────────────┐
│  🔗 싱크에이전트 사용 중                     │
│                                            │
│  이 회사는 현재 싱크에이전트를 통해 고객사    │
│  DB 서버와 자동 동기화 중입니다.             │
│                                            │
│  고객 DB를 수동으로 수정하면 다음 동기화 때   │
│  소스 DB 데이터로 다시 덮어써져 변경 내용이   │
│  유실됩니다.                                │
│                                            │
│  고객 정보를 변경하려면 귀사의 DB 서버에서    │
│  직접 수정해주세요.                         │
│                                            │
│  문의: 한줄로 고객센터 1588-XXXX             │
│                                            │
│         [확인]                              │
└────────────────────────────────────────────┘
```

---

## 5. T-2: AI 매핑 (Opus 4.7)

### 5-1. 기본 사양

| 항목 | 값 |
|------|----|
| 모델 | `claude-opus-4-7` |
| 폴백 1 | `claude-sonnet-4-6` |
| 폴백 2 | Agent 로컬 `autoSuggestMapping()` (이미 구현) |
| 프롬프트 캐싱 | FIELD_MAP 정의부 `cache_control: ephemeral` (5분 TTL) |
| Extended Thinking | OFF (매핑은 단일 추론) |
| Max tokens | 4000 |
| 호출 빈도 | 최초 설치 1회 + 필요 시 재호출 (새 컬럼 발견/수동 리셋) |
| 호출 비용 | 1회당 ~$0.075 (100개 고객사 설치 = $7.5) |
| 호출 제한 | 회사당 월 10회 (초과 시 오류) |

### 5-2. 프롬프트 구조 (upload.ts:189-220 복제)

```typescript
const mappingPrompt = `고객사 소스 DB 테이블 컬럼을 한줄로 표준 필드에 매핑해줘.

소스 DB 테이블: ${tableName}
DB 타입: ${dbType}  // mssql/mysql/oracle/postgres/excel
컬럼명 목록: ${JSON.stringify(columns)}

[CACHED START — FIELD_MAP 정의]
한줄로 표준 필드 (21개 + 커스텀 15개):
- phone: 고객전화번호 (필수)
- name: 고객명
- gender: 성별
- age: 나이
- birth_date: 생일
- email: 이메일주소
- address: 주소
- region: 지역
- recent_purchase_store: 최근구매매장
- recent_purchase_amount: 최근구매금액
- total_purchase_amount: 누적구매금액
- purchase_count: 구매횟수
- recent_purchase_date: 최근구매일
- store_code: 브랜드코드
- registration_type: 등록구분
- registered_store: 등록매장정보
- store_phone: 매장전화번호
- store_name: 매장명
- grade: 고객등급
- points: 보유포인트
- sms_opt_in: 수신동의여부
- custom_1 ~ custom_15: 커스텀 슬롯
[CACHED END]

규칙:
1. 의미가 비슷하면 매핑 (CUST_HP→phone, MBR_NM→name, SEX_CD→gender 등)
2. 위 필드에 해당 안 되면 custom_1부터 순서대로 (최대 custom_15까지)
3. phone은 반드시 매핑
4. 시스템 컬럼(created_at, updated_at, is_active 등)은 null
5. age는 정수 나이만. 연령대("20대")는 custom 필드로
6. 매장 관련 필드 정확히 구분:
   - registered_store: 등록매장, 가입매장, 소속매장
   - recent_purchase_store: 최근구매매장, 최종구매매장
   - store_code: 브랜드코드, 구분코드 (CPB, NARS 등)
   - store_phone: 매장전화번호
   - store_name: 단순 매장명
7. 날짜/구매 필드 구분:
   - birth_date: 생년월일
   - recent_purchase_date: 최근구매일
   - recent_purchase_amount vs total_purchase_amount
   - purchase_count: 구매횟수

JSON 형식만 응답 (설명 없이):
{"소스컬럼명": "field_key 또는 null", ...}

예시: {"CUST_HP": "phone", "CUST_NM": "name", "SEX_CD": "gender", "MY_INTERNAL_FLAG": null}
⚠️ 반드시 field_key 영문만. 한글 설명 금지.`;
```

### 5-3. PII 정책

- **컬럼명만** Anthropic API에 전송
- 샘플 데이터(실제 row 값) 전송 **금지**
- field_type 자동 감지는 Agent 내부 로직으로 (샘플 20건 SELECT, 외부 미전송)

### 5-4. field_type 자동 감지 (upload.ts:796-817 복제)

Agent가 Field Mapping 완료 후 `custom_N`으로 배정된 컬럼에 대해:

```typescript
async function detectCustomFieldType(columnName: string): Promise<'DATE' | 'NUMBER' | 'VARCHAR'> {
  const samples = await dbConnector.fetchSample(tableName, columnName, 20);
  const nonNull = samples.filter(v => v != null && v !== '');
  if (nonNull.length === 0) return 'VARCHAR';

  const allDate = nonNull.every(v => {
    const s = String(v).trim();
    return /^\d{4}-\d{2}-\d{2}/.test(s) || /^\d{8}$/.test(s) || /^\d{6}$/.test(s) || (v instanceof Date);
  });
  const looksLikeDate6 = nonNull.every(v => {
    const s = String(v).trim();
    if (!/^\d{6}$/.test(s)) return true;
    const mm = parseInt(s.substring(2, 4));
    const dd = parseInt(s.substring(4, 6));
    return mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31;
  });
  const allNumeric = nonNull.every(v => !isNaN(Number(v)) && String(v).trim() !== '');

  if (allDate && looksLikeDate6) return 'DATE';
  if (allNumeric) return 'NUMBER';
  return 'VARCHAR';
}
```

### 5-5. 매핑 결과 저장

**Agent 로컬:** `config.enc` 에 `mapping.customers`, `mapping.purchases`, `mapping.customFieldLabels` 저장.

**서버 측:** Agent가 `POST /api/sync/field-definitions` 호출하여 `customer_field_definitions` 테이블에 custom_1~15 라벨 등록. **CT-07 `upsertCustomFieldDefinitions()` 재사용.**

### 5-6. 커스텀 필드 15개 정책

- AI가 보는 순서대로 앞 15개만 custom_1~custom_15 배정 (upload.ts 표준)
- 16개 이상이면 설치 마법사에 "커스텀 필드는 최대 15개까지 지원됩니다" 안내만
- 과잉 케이스는 실무상 드뭄 (21개 표준 + 15개 = 36개면 중견기업 커버)

---

## 6. T-3: 삭제 감지

**결론: 삭제 감지 없음. 한줄로AI 표준 복제.**

### 6-1. 근거

- 한줄로 엑셀 업로드 (`upload.ts`)도 삭제 감지 없음 — UPSERT만
- `customers.is_active` 컬럼 존재하지만 현재 활용 경로 없음
- Hard delete는 사람이 명시적으로 버튼 눌러야만 발생

### 6-2. 탈퇴 처리 흐름 (이미 완성)

```
고객사 소스 DB: SMS_YN 'Y' → 'N' (updated_at 갱신)
        ↓
증분 싱크가 감지 → Agent 전송
        ↓
서버: sms_opt_in=false UPSERT
        ↓
sync.ts:587-611 자동 트리거:
  unsubscribes INSERT (시스템 user + admin + store_code 담당 user)
        ↓
모든 발송 경로에서 buildUnsubscribeFilter 자동 제외
```

**실무상 99% 탈퇴는 이 흐름으로 처리됨.**

### 6-3. Row 완전 삭제 Edge Case

- 개인정보보호법 5년 보관 의무 → 실무상 드묾
- 발생 시 한줄로 관리자 UI에서 수동 삭제 (기존 기능)
- 풀싱크 도입 불필요 (증분 싱크 대원칙 유지)

---

## 7. T-5: 동기화 주기

### 7-1. 확정값

| 항목 | 값 |
|------|----|
| 고객 싱크 주기 | **6시간 고정** (하루 4회) |
| 구매 싱크 주기 | **6시간 고정** (하루 4회) |
| 최소값 | 6시간 (우회 불가) |
| Heartbeat | 1시간 |
| 큐 재전송 | 30분 (큐에 있을 때만) |
| **설정 폴링** | **제거** (싱크 응답에 config 포함) |

### 7-2. 권한/변경

- 설정 권한: **슈퍼관리자만**
- 최초 설정: 설치 마법사에서 슈퍼관리자가 계약 시 입력
- 운영 중 변경: sys.hanjullo.com 슈퍼관리자 UI에서 변경
- 반영: Agent가 다음 싱크 때 응답의 config 필드 감지 → 스케줄러 자동 재시작

### 7-3. 고객사 UI 차단

- `company_admin`/`company_user`는 싱크 주기 변경 UI 접근 불가
- 설정 화면에 "싱크 주기 변경은 고객센터 문의" 안내만

### 7-4. 부하 비교 (30개 Agent 기준)

| 호출 | 기존 | 신규 |
|-----|------|------|
| 고객 싱크 | 720회/일 | 120회/일 |
| 구매 싱크 | 1,440회/일 | 120회/일 |
| 설정 폴링 | 8,640회/일 | **0회 (제거)** |
| Heartbeat | 8,640회/일 | 720회/일 |
| **합계** | **~19,440회/일** | **~960회/일 (20배 ↓)** |

고객사 DB 쿼리도 **288회/일 → 4회/일 (72배 감소)**.

---

## 8. UUID 정책

### 8-1. customers.id (UUID) — 기존 유지

- 최초 INSERT 시 `gen_random_uuid()` 자동 부여 (이미 구현)
- 한줄로 내부 불변 식별자
- UPSERT 시 UUID 유지 (기존 row 재사용)
- **모든 입구에서 phone 기준 매칭 → 같은 phone = 같은 UUID 보장**

### 8-2. customer_code (신규 컬럼)

**목적:** 내부 로그/디버깅에서 "어느 회사 고객인지" 즉시 식별.

**포맷:** `{company.login_id}-{6자리 시퀀스}` → 예: `invito-000001`, `siseido-000042`

**규칙:**
- 회사별 INCREMENT 시퀀스 (`customer_code_seq` 테이블 또는 회사별 counter 관리)
- UI 노출 완전 금지 (Harold님 정책)
- 순수 로그/디버깅 용도
- INSERT 시 자동 생성 (트리거 또는 서버 로직)

### 8-3. UI 숨김 정책

**제외 대상:**
- `GET /api/customers` 응답 본문에서 `id`, `customer_code` 필드 제거
- `CustomerDBModal.tsx` 컬럼 표시에서 제외
- Export 기능 제외

**포함 대상 (내부):**
- 서버 로그
- 슈퍼관리자 디버깅 화면 (sys.hanjullo.com)

### 8-4. 전체 삭제 정책

- **Hard delete + 경고 모달 + 새 UUID 부여** (옵션 A 확정)
- 싱크에이전트 사용 중 회사는 전체 삭제 버튼 자체 차단 (T-1과 연계)

**경고 모달:**
```
⚠️ 고객 전체 삭제 시 발생하는 영구 손실

- AI가 축적한 고객별 분석 데이터 (성별/연령/구매패턴 학습)
- 내부 고객 식별번호 (재업로드 시 새로 부여되어 이전 기록과 연결 불가)

삭제 후에는 되돌릴 수 없습니다.

[취소] [삭제 진행]
```

---

## 9. DB 스키마 변경

### 9-1. 신규 컬럼 (ALTER TABLE)

```sql
-- users.is_system (시스템 가상 user 구분)
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_system BOOLEAN DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_users_system ON users(company_id) WHERE is_system = true;

-- customers.customer_code (회사별 디버깅 식별자)
ALTER TABLE customers ADD COLUMN IF NOT EXISTS customer_code VARCHAR(50);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_code 
  ON customers(company_id, customer_code) 
  WHERE customer_code IS NOT NULL;
```

### 9-2. 신규 테이블 (시퀀스 관리)

```sql
-- 회사별 customer_code 시퀀스 (동시성 안전)
CREATE TABLE IF NOT EXISTS customer_code_sequences (
  company_id UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  last_number BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 9-3. 회사 생성 시 시스템 user 자동 생성

**옵션 A (트리거):**
```sql
CREATE OR REPLACE FUNCTION create_system_user_on_company_insert()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO users (id, company_id, login_id, user_type, name, is_active, is_system)
  VALUES (
    gen_random_uuid(),
    NEW.id,
    'system_sync_' || NEW.id::text,
    'system',
    '싱크에이전트 (시스템)',
    true,
    true
  );
  INSERT INTO customer_code_sequences (company_id, last_number) VALUES (NEW.id, 0);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_create_system_user 
  AFTER INSERT ON companies
  FOR EACH ROW EXECUTE FUNCTION create_system_user_on_company_insert();
```

**옵션 B (애플리케이션 로직):** 회사 생성 API에서 함께 INSERT.

**추천:** B (애플리케이션 로직). 트리거는 디버깅 어렵고 한줄로 코드베이스 특성상 애플리케이션 레이어에서 관리가 일관됨.

### 9-4. 기존 회사 마이그레이션 (일회성)

```sql
-- 기존 회사마다 시스템 user 생성
INSERT INTO users (id, company_id, login_id, user_type, name, is_active, is_system)
SELECT 
  gen_random_uuid(),
  c.id,
  'system_sync_' || c.id::text,
  'system',
  '싱크에이전트 (시스템)',
  true,
  true
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM users u WHERE u.company_id = c.id AND u.is_system = true
);

-- 기존 회사마다 customer_code 시퀀스 초기화
INSERT INTO customer_code_sequences (company_id, last_number)
SELECT c.id, 0
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM customer_code_sequences s WHERE s.company_id = c.id
);

-- 기존 customer들 customer_code 채우기 (회사별 오래된 순)
WITH numbered AS (
  SELECT 
    id,
    company_id,
    ROW_NUMBER() OVER (PARTITION BY company_id ORDER BY created_at ASC, id ASC) as rn
  FROM customers
  WHERE customer_code IS NULL
)
UPDATE customers c
SET customer_code = 
  (SELECT login_id FROM companies WHERE id = c.company_id) 
  || '-' 
  || LPAD(n.rn::text, 6, '0')
FROM numbered n
WHERE c.id = n.id;

-- 시퀀스 보정
UPDATE customer_code_sequences s
SET last_number = (SELECT COUNT(*) FROM customers c WHERE c.company_id = s.company_id);
```

### 9-5. 로그인 차단 (is_system user)

백엔드 auth.ts 수정:
```typescript
// login API에 추가
const user = await query('SELECT * FROM users WHERE login_id = $1', [loginId]);
if (user.rows[0]?.is_system) {
  return res.status(403).json({ error: '시스템 계정은 로그인할 수 없습니다.' });
}
```

---

## 10. API 명세

### 10-1. 신규: `POST /api/sync/ai-mapping`

**인증:** `X-Sync-ApiKey` / `X-Sync-Secret` (Agent 인증)

**Request:**
```json
{
  "target": "customers",
  "tableName": "CUSTOMER_MASTER",
  "dbType": "mssql",
  "columns": ["CUST_HP", "CUST_NM", "SEX_CD", "BIRTH_DT", "GRADE_CD", "..."]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "mapping": {
      "CUST_HP": "phone",
      "CUST_NM": "name",
      "SEX_CD": "gender",
      "BIRTH_DT": "birth_date",
      "GRADE_CD": "grade",
      "PREF_COLOR": "custom_1",
      "INTERNAL_FLAG": null
    },
    "modelUsed": "claude-opus-4-7",
    "cacheHit": true,
    "tokensUsed": 2847,
    "costEstimate": 0.075
  }
}
```

**에러 응답:**
```json
{
  "success": false,
  "error": "AI 매핑 호출 한도 초과 (월 10회)",
  "code": "AI_MAPPING_QUOTA_EXCEEDED",
  "fallback": {
    "mapping": { /* autoSuggestMapping 결과 */ },
    "modelUsed": "local_fallback"
  }
}
```

**서버 구현 CT:**
- 신규 유틸: `utils/ai-mapping.ts` (컨트롤타워)
- 함수: `callClaudeMapping(columns, target, companyId) → mapping`
- 쿼터 체크: `plans.ai_mapping_monthly_quota` (기본 10) vs `companies.ai_mapping_calls_month`
- 프롬프트 캐싱: Anthropic SDK `cache_control` 활용
- 폴백 체인 구현 (Opus → Sonnet → 에러 응답)

### 10-2. 변경: `POST /api/sync/customers`

**응답에 config 필드 추가 (설정 폴링 제거):**

```json
{
  "success": true,
  "data": {
    "upsertedCount": 150,
    "failedCount": 0,
    "failures": []
  },
  "config": {
    "syncIntervalCustomers": 360,
    "syncIntervalPurchases": 360,
    "heartbeatInterval": 60,
    "queueRetryInterval": 30,
    "version": "2026-04-18T10:00:00Z"
  }
}
```

- Agent가 `config.version` 비교 → 변경 시 스케줄러 재시작

### 10-3. 제거: `GET /api/sync/config`

**제거하지 않고 유지하되, Agent는 더 이상 호출하지 않음.** 이유:
- 기존 Agent(v1.4.x) 호환성 (기존 사용자 0이긴 하지만 방어적)
- 긴급 설정 조회 API로 역할 유지

### 10-4. 기존 유지 (변경 없음)

- `POST /api/sync/register`
- `POST /api/sync/heartbeat` (주기만 1시간으로 Agent 쪽 변경)
- `POST /api/sync/purchases`
- `POST /api/sync/log`
- `GET /api/sync/version`
- `POST /api/sync/field-definitions`

---

## 11. 설치 마법사 UX

### 11-1. Windows 웹 UI (`setup/setup-html.ts`)

**Step 1. 서버 접속 정보** (기존)
- API Key, API Secret, Server URL

**Step 2. 고객사 DB 접속 정보** (기존)
- DB 타입 (MSSQL/MySQL/Oracle/PostgreSQL/Excel/CSV)
- Host, Port, User, Password, Database

**Step 3. 테이블 선택** (기존)
- 고객 테이블, 구매 테이블 (옵션)

**Step 4. 🆕 AI 자동 매핑** (신규)
```
┌────────────────────────────────────────────┐
│   🤖 AI 자동 매핑 (Claude Opus 4.7)         │
│                                            │
│   고객사 DB의 컬럼을 한줄로 표준 필드에       │
│   자동으로 매핑합니다.                       │
│                                            │
│   [AI 자동 매핑 실행]                        │
│                                            │
│   ─────── 매핑 결과 (수정 가능) ───────      │
│   CUST_HP  →  phone ✓                      │
│   CUST_NM  →  name ✓                       │
│   SEX_CD   →  gender ✓                     │
│   BIRTH_DT →  birth_date ✓                 │
│   ...                                      │
│   PREF_COLOR →  custom_1 ("선호색상")        │
│   INTERNAL_FLAG →  (매핑 안 함) ▼           │
│                                            │
│   ⚠️ 다매장 업체이신가요?                    │
│   브랜드 구분자 컬럼(STORE_CD 등)이          │
│   매핑되지 않았습니다. 계속 진행하시면       │
│   단일 브랜드로 처리됩니다.                  │
│                                            │
│   [이전]  [재추천]  [다음]                   │
└────────────────────────────────────────────┘
```

**Step 5. 싱크 설정** (슈퍼관리자만, 슈퍼관리자 플래그 확인)
- 고객 싱크 주기: 6시간 (기본)
- 구매 싱크 주기: 6시간 (기본)

**Step 6. 완료 + 최초 풀싱크**
- config.enc 저장
- 서비스 등록 (sc.exe / systemctl)
- 최초 풀싱크 백그라운드 실행

### 11-2. Linux CLI (`setup/cli.ts`)

Windows 웹 UI와 동일한 단계, `@inquirer/prompts` 대화형:

```
? DB 타입을 선택하세요 (Use arrow keys)
> mssql
  mysql
  oracle
  postgres
  excel

? AI 자동 매핑을 실행하시겠습니까? (Y/n) Y
[AI] Claude Opus 4.7 호출 중... (예상 비용 $0.075)

매핑 결과:
  CUST_HP  → phone
  CUST_NM  → name
  ...

? 매핑 결과를 적용하시겠습니까? (Y/n) Y
? 수정할 매핑이 있으신가요? (y/N) N

✓ 설치 완료
```

### 11-3. 매핑 수정 (설치 후)

**CLI:** `sync-agent --edit-config` (기존 기능에 매핑 편집 추가)

**Windows 웹 UI 재실행:** `sync-agent --setup-web` → 기존 config 로드 후 재편집

---

## 12. 기존 Gap 정리 체크리스트

v1.5.0에 함께 처리:

| ID | 내용 | 작업 |
|----|------|------|
| M-1 | Agent Zod 스키마의 레거시 필드 9개 | `types/customer.ts`에서 `registered_store_number, last_purchase_date, total_purchase, avg_order_value, ltv_score, wedding_anniversary, is_married, is_opt_out, is_active` 제거 |
| M-2 | `normalizeStorePhone` 누락 | Agent `normalize/phone.ts`에 `normalizeStorePhone()` 추가 (서버 `utils/normalize.ts:258-293` 로직 복제) |
| M-3 | `companies.customer_schema` 미동기화 | `/api/sync/field-definitions` 서버 구현에 customer_schema 자동 갱신 추가 (upload.ts 820번대 패턴 참조) |
| M-4 | FIELD_MAP Agent 동적 동기화 | Agent가 서버 FIELD_MAP을 가져올 수 있는 `GET /api/sync/field-map` 신규 추가. 설치 시 1회 호출 + config.enc 캐시 |
| M-5 | Oracle 설치 가이드 | 설치 마법사에서 DB 타입 Oracle 선택 시 "oracledb 패키지를 함께 설치하시겠습니까?" 자동 설치 옵션 |

---

## 13. 구현 체크리스트

### 13-1. 백엔드 (packages/backend/src/)

- [ ] `utils/ai-mapping.ts` 신규 (CT) — Claude 호출 + 캐싱 + 폴백 + 쿼터
- [ ] `routes/sync.ts` 변경:
  - [ ] `POST /ai-mapping` 신규 라우트
  - [ ] `POST /customers` 응답에 config 필드 추가
  - [ ] `POST /field-definitions` 확장 — customer_schema 동기 갱신
  - [ ] `GET /field-map` 신규 (M-4)
  - [ ] 시스템 user로 unsubscribes INSERT 로직 변경 (upload.ts admin 패턴 복제)
- [ ] `routes/auth.ts` — `is_system=true` 로그인 차단
- [ ] `routes/customers.ts` — API 응답에서 id/customer_code 제거
- [ ] `middlewares/sync-active-check.ts` 신규 — 엑셀 업로드 차단용 미들웨어 (customer 변경 라우트에 적용)
- [ ] DB 마이그레이션 **실행 안내 문서** 작성 (SQL 파일 자동생성 금지 — feedback_no_sql_generation 원칙) → heredoc 방식으로 Harold님이 서버에서 직접 복붙 실행

### 13-2. Agent (sync-agent/src/)

- [ ] `setup/ai-mapping-client.ts` 신규 — `/api/sync/ai-mapping` 호출
- [ ] `setup/setup-html.ts` — Step 4 AI 매핑 UI 추가
- [ ] `setup/cli.ts` — AI 매핑 대화형 추가
- [ ] `setup/edit-config.ts` — 매핑 수정 UI
- [ ] `mapping/index.ts` — `suggestMappingWithAI()` 신규
- [ ] `types/customer.ts` — 레거시 9개 필드 제거 (M-1)
- [ ] `normalize/phone.ts` — `normalizeStorePhone()` 추가 (M-2)
- [ ] `scheduler/index.ts`:
  - [ ] 고객/구매 주기 기본 60→360분, 30→360분
  - [ ] 설정 폴링 제거 (`pollRemoteConfig` 호출 삭제)
  - [ ] Heartbeat 5→60분
  - [ ] 큐 재전송 5→30분
- [ ] `api/client.ts` — `syncCustomers/Purchases` 응답의 config 파싱 + 스케줄러 재시작 트리거
- [ ] `service/index.ts` — systemd/sc.exe 동작 검증 (변경 없음, Linux 빌드 재확인)

### 13-3. 프론트엔드 (packages/frontend/src/)

- [ ] `components/SyncActiveBlockModal.tsx` 신규 — 엑셀 업로드 차단 모달
- [ ] `Dashboard.tsx` — 엑셀 업로드/전체삭제 버튼에 `use_db_sync` 체크
- [ ] `CustomerDBModal.tsx` — id/customer_code 컬럼 표시 제거
- [ ] `Settings.tsx` — 싱크 주기 변경 UI (company_admin용) 제거 or "고객센터 문의" 안내로 교체
- [ ] `AdminDashboard.tsx` (슈퍼관리자) — 회사별 싱크 주기 변경 페이지 신규

### 13-4. DB (프로덕션 배포 시)

**❗ SQL 파일 자동생성 금지** (feedback_no_sql_generation 원칙).
AI 역할: Harold님이 서버에서 그대로 복붙 실행할 수 있는 heredoc 명령어 한 세트 안내 (OPS.md 패턴).

Claude가 Day 1 완료 시 대화창에 아래 블록을 순서대로 제공 → Harold님이 복붙 실행:
```bash
# 1. SSH 접속
ssh administrator@58.227.193.62
cd /home/administrator/targetup-app

# 2. 백업
BACKUP=backups/pre_sync_v1_5_0_$(date +%Y%m%d_%H%M).sql.gz
docker exec targetup-postgres pg_dump -U targetup targetup | gzip > $BACKUP

# 3. 마이그레이션 (heredoc)
docker exec -i targetup-postgres psql -U targetup targetup << 'EOF'
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_system BOOLEAN DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS customer_code VARCHAR(50);
CREATE TABLE IF NOT EXISTS customer_code_sequences (...);
ALTER TABLE plans ADD COLUMN IF NOT EXISTS ai_mapping_monthly_quota INTEGER DEFAULT 10;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS ai_mapping_calls_month INTEGER DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_users_system ON users(company_id) WHERE is_system = true;
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_code ON customers(company_id, customer_code) WHERE customer_code IS NOT NULL;
-- 9-4 일회성 마이그레이션 쿼리 (기존 회사 시스템 user + customer_code 채우기)
-- [Day 1 작업 후 Claude가 정확한 SQL 블록 제공]
EOF

# 4. 검증
docker exec targetup-postgres psql -U targetup targetup -c "\d users"
docker exec targetup-postgres psql -U targetup targetup -c "\d customers"

# 5. 롤백 (필요 시)
# gunzip -c $BACKUP | docker exec -i targetup-postgres psql -U targetup targetup
```

### 13-5. 빌드/배포

- [ ] Windows: `npm run build:exe` → `release/sync-agent.exe`
- [ ] Linux: `npm run build:linux` → `release/sync-agent`
- [ ] Linux 패키징: `bash installer/build-linux-package.sh 1.5.0`
- [ ] Windows 인스톨러: `installer/build-installer.bat 1.5.0`
- [ ] 체크섬 생성 + `sync_releases` 테이블 등록
- [ ] 서버 .env에 `ANTHROPIC_API_KEY_MAPPING` 추가 (또는 기존 키 재사용 결정)

---

## 14. 배포 계획 (T-6)

### 14-1. 타임라인

| 일자 | 작업 |
|------|------|
| 2026-04-19 (Day 1) | 백엔드 ai-mapping.ts + routes/sync.ts 변경 + DB 마이그레이션 준비 |
| 2026-04-20 (Day 2) | Agent 설치 마법사 AI 매핑 UI + scheduler 주기 변경 + Zod/정규화 정리 |
| 2026-04-21 (Day 3) | 프론트 엑셀 차단 모달 + 슈퍼관리자 UI + Linux/Windows 빌드 + 서팀장 QA 전달 |
| 2026-04-22~23 | 서팀장 E2E 테스트 (MSSQL/MySQL 시뮬레이션) + 이슈 fix |
| 2026-04-24 | 첫 고객사 배포 준비 완료 |

### 14-2. 릴리스 정책

- **v1.5.0 빅뱅** — 파일럿 없음 (기존 사용자 0)
- 기존 Windows 고객사 자동 업그레이드: 해당 없음 (0명)
- 신규 고객사는 처음부터 v1.5.0 설치

### 14-3. QA 시나리오 (서팀장 전달용)

**A. 신규 설치 시나리오**
1. 슈퍼관리자 sys.hanjullo.com에서 테스트 회사 생성 → API 키 발급
2. 로컬 MySQL/MSSQL에 setup_test_db.sql로 테스트 DB 구성
3. Windows에 `SyncAgent-Setup-1.5.0.exe` 설치
4. 설치 마법사 → AI 자동 매핑 실행 → 매핑 확인
5. 서비스 시작 → 최초 풀싱크 → 한줄로 DB에 데이터 INSERT 확인
6. 각 고객에 UUID + customer_code 부여 확인 (슈퍼 DB 조회)

**B. 증분 싱크 시나리오**
1. 소스 DB에서 1건 UPDATE
2. 6시간 대기 (또는 수동 트리거)
3. 한줄로 DB에 변경 반영 확인
4. 변경 안 된 row는 전송 안 된 것 확인 (로그)

**C. 수신거부 싱크 시나리오**
1. 소스 DB에서 `SMS_YN='Y' → 'N'` 변경
2. 싱크 실행
3. 한줄로 customers.sms_opt_in=false 확인
4. unsubscribes 테이블에 **4건**(시스템 user + admin + 브랜드담당A + 브랜드담당B) INSERT 확인
5. 발송 시 해당 phone 제외 확인

**D. 엑셀 업로드 차단 시나리오**
1. 싱크 사용 중 회사의 고객 업로드 버튼 클릭
2. `SyncActiveBlockModal` 표시 확인
3. 직접발송 수신자 엑셀은 정상 작동 확인

**E. Linux 설치 시나리오**
1. `tar -xzf SyncAgent-1.5.0-linux-x64.tar.gz`
2. `sudo bash install.sh`
3. `sudo /opt/sync-agent/sync-agent --setup-cli`
4. AI 매핑 대화형 수행
5. `systemctl start sync-agent` → `journalctl -u sync-agent -f` 로그 확인

**F. 설정 변경 시나리오**
1. 슈퍼관리자가 싱크 주기 6h → 8h 변경
2. Agent 다음 싱크 시 응답의 config.version 감지
3. 스케줄러 자동 재시작 로그 확인
4. 8시간 후 싱크 실행 확인

---

## 15. 롤백 절차

### 15-1. 백엔드 롤백

```bash
# 한줄로 서버
cd /home/administrator/targetup-app
git revert <commit-hash-range>
npm run build --workspace=packages/backend
pm2 restart targetup-backend
```

### 15-2. DB 롤백 (필요 시)

```sql
-- 새 컬럼 제거 (데이터 유실 주의)
ALTER TABLE users DROP COLUMN IF EXISTS is_system;
ALTER TABLE customers DROP COLUMN IF EXISTS customer_code;
DROP TABLE IF EXISTS customer_code_sequences;

-- 시스템 user 제거 (company별)
DELETE FROM users WHERE is_system = true;
```

### 15-3. Agent 롤백

- v1.5.0 설치한 고객사는 `sync_releases` 테이블에 v1.4.1 (fallback) 레코드를 활성화
- Agent가 `/api/sync/version` 조회 → v1.4.1로 다운그레이드
- 다운그레이드 URL과 체크섬 사전 준비

### 15-4. Agent 서비스 수동 복구

**Windows:**
```powershell
sc stop SyncAgent
cd "C:\Program Files\SyncAgent"
copy v1.4.1.exe sync-agent.exe
sc start SyncAgent
```

**Linux:**
```bash
sudo systemctl stop sync-agent
sudo cp /opt/sync-agent/backup/v1.4.1/sync-agent /opt/sync-agent/sync-agent
sudo systemctl start sync-agent
```

---

## 부록 A: 주요 의사결정 로그

| 결정 | 이유 | 대안 기각 근거 |
|------|------|-------------|
| AI 모델 Opus 4.7 | 설치 1회 + 월 100만원 요금제 정당성 | Sonnet/Haiku는 매핑 정확도 차이로 고객사 지원 부담 증가 |
| API 키 서버 보관 (Agent에 번들링 X) | 리버스엔지니어링 방지 | Agent 번들은 strings 추출로 유출 가능 |
| Agent hash 비교 미도입 | HPE 서버 스펙 + 샤딩 구조로 write amplification 부담 미미 | 복잡도 대비 이득 미미 |
| 삭제 감지 없음 | 한줄로 표준 복제 + 실무상 row 삭제 드묾 + sms_opt_in으로 99% 커버 | 풀싱크는 증분 대원칙 롤백 |
| 6시간 주기 | 고객사 DB 부담 + 서버 부하 감소 + 실시간 요구 없음 | 5분 폴링은 30개 기준 일 17k회 공회전 |
| customer_code 별도 컬럼 | customers.id (UUID PK) 포맷 변경 시 FK 대량 마이그레이션 | PK 교체는 기간계 접촉 위험 |
| 시스템 user (`is_system`) | 엑셀 upload.ts admin 패턴 복제 + 관리자 교체 안전 | Agent 등록자 고정은 퇴사 시 문제 |
| v1.5.0 빅뱅 | 기존 사용자 0 + 서팀장 QA 일원화 | 2단계는 QA 중복 |

---

## 부록 B: 원칙 체크리스트

설계서 작성 시 지킨 CLAUDE.md 원칙:

- [x] **4-1** 현황 파악 → 설계안 제시 → Harold님 컨펌 → 구현 (6개 주제 순차 토론 후 작성)
- [x] **4-2** 하드코딩 금지 — FIELD_MAP, normalize 함수명 등 모두 기존 컨트롤타워 참조
- [x] **4-3** 기간계 무접촉 — 기존 sync.ts, upload.ts 로직 변경 최소화. 새 라우트 신설 우선
- [x] **0** 컨트롤타워 우선 — ai-mapping.ts 신규 CT, CT-03/CT-07 재사용
- [x] **1-3** 한줄로AI 표준 복제 원칙 — upload.ts 패턴 적극 차용
- [x] **4-7** 하나씩 세심하게 — 6개 주제 토론 형식으로 완료
- [x] **feedback_no_patchwork** — 땜질 없음, 컨트롤타워화
- [x] **feedback_controltower_first** — 반복 로직 인라인 금지
- [x] **feedback_verify_data_flow** — 엔드-투-엔드 플로우 명시
- [x] **feedback_no_guessing_fix** — Harold님 발언 정확히 인용, 추측 없음

---

**설계서 끝. 다음 세션에서 이 문서 그대로 구현 진행.**
