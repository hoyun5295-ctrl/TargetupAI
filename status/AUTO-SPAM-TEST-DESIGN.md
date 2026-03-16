# D78: 프로 요금제 자동 스팸검사 기능 설계

> **작성일:** 2026-03-16
> **상태:** 설계 확정 → 구현 중
> **태그:** D78

---

## 1. 기능 개요

프로(100만원) 이상 요금제에서 AI 문안생성 시 3개 variant를 **자동으로 스팸 테스트**하고,
스팸 차단된 문안은 **자동 재생성**하여 안전한 문안 3개만 보여주는 기능.

### 요금제별 차등

| 기능 | 스타터 (15만) | 베이직 (35만) | 프로 (100만) |
|------|:---:|:---:|:---:|
| 스팸필터 수동 테스트 | 유료 | 유료 | **무료** |
| AI 문안생성 | 없음 | 있음 (수동 스팸테스트) | 있음 |
| AI 문안 + 자동 스팸검사 | 없음 | 없음 | **있음** |
| 스팸 차단 문안 자동 재생성 | 없음 | 없음 | **있음** |
| 자동발송 + 자동 스팸검사 | 없음 | 없음 | **있음** |

### 영업 포인트

> "프로 요금제는 스팸필터 테스트가 **무제한 무료**입니다.
> AI가 문구 3개 만들면 자동으로 스팸 검사해서 **안전한 문구만 보여줍니다**.
> 스팸 걸리는 문구는 자동으로 새 문구로 교체됩니다.
> 이건 국내에서 한줄로만 가능합니다."

---

## 2. 핵심 설계: 큐 기반 순차 처리

### 문제

테스트폰이 통신사당 1대(총 3대)이므로, 여러 업체가 동시에 스팸 테스트하면:
- 같은 테스트폰에 여러 문자가 동시 수신 → 매칭 오류 가능성
- 통신사가 단시간 대량 수신을 스팸으로 오판할 위험

### 해결: 글로벌 큐

```
A업체 자동테스트 요청 (variant 3개)
B업체 자동테스트 요청 (variant 3개)
    ↓
[스팸테스트 큐] — 동시에 테스트폰에 1건만
    ↓
A-variant-A 테스트 (30~40초) → 완료
A-variant-B 테스트 (30~40초) → 완료
A-variant-C 테스트 (30~40초) → 완료
B-variant-A 테스트 ...
```

- 테스트폰에 동시 1건만 발송 → 매칭 정확도 100%
- 큐 워커가 3초 간격으로 다음 건 확인
- 수동 테스트도 동일 큐 사용 (공정한 순서)

### Grace Period 분리

| 모드 | QTmsg 성공 후 대기 | 이유 |
|------|:---:|------|
| 수동 테스트 | 10초 (기존) | 빠른 결과 중요 |
| 자동 테스트 | 20초 | 오탐 방지 우선 |

---

## 3. DB 스키마 변경

### 3-1. plans 테이블

```sql
ALTER TABLE plans ADD COLUMN auto_spam_test_enabled BOOLEAN DEFAULT false;

UPDATE plans SET auto_spam_test_enabled = true
WHERE plan_code IN ('PRO', 'BUSINESS', 'ENTERPRISE');
```

### 3-2. spam_filter_tests 테이블

```sql
-- 테스트 소스 구분 (수동 / AI 자동)
ALTER TABLE spam_filter_tests ADD COLUMN source VARCHAR(20) DEFAULT 'manual';

-- 자동 테스트 시 variant 구분 (A/B/C)
ALTER TABLE spam_filter_tests ADD COLUMN variant_id VARCHAR(2);

-- 자동 테스트 배치 그룹 (동일 AI 문안생성 요청의 3건을 묶음)
ALTER TABLE spam_filter_tests ADD COLUMN batch_id UUID;

-- 큐 지원: queued 상태 추가 (기존: pending, active, completed)
-- status 컬럼은 이미 VARCHAR이므로 'queued' 값 추가만 하면 됨

-- 큐 순서 보장용 인덱스
CREATE INDEX idx_spam_filter_tests_queued ON spam_filter_tests (status, created_at)
WHERE status = 'queued';
```

### 3-3. SCHEMA.md 업데이트 필요 항목

- plans.auto_spam_test_enabled
- spam_filter_tests.source, variant_id, batch_id
- status 컬럼 값에 'queued' 추가

---

## 4. 컨트롤타워: spam-test-queue.ts (CT-09)

> **위치:** `packages/backend/src/utils/spam-test-queue.ts`
> **역할:** 스팸 테스트 큐의 유일한 진입점. 큐 등록 + 순차 실행 + 결과 확인

### 주요 함수

```typescript
// 큐에 스팸 테스트 등록 (수동/자동 공용)
enqueueSpamTest(params: SpamTestParams): Promise<SpamTestEnqueueResult>

// 큐 워커: 다음 건 실행 (app.ts에서 setInterval 호출)
processSpamTestQueue(): Promise<void>

// 테스트 실행 (내부): 디바이스 조회 → QTmsg INSERT → 폴링 시작
executeSpamTest(testId: string): Promise<void>

// 배치 결과 조회 (AI 자동테스트용)
getSpamTestBatchResults(batchId: string): Promise<SpamTestBatchResult>

// 자동 스팸테스트 + 재생성 통합 (AI route에서 호출)
autoSpamTestWithRegenerate(params: AutoSpamTestParams): Promise<AutoSpamTestResult>
```

### 인터페이스

```typescript
interface SpamTestParams {
  companyId: string;
  userId: string;
  callbackNumber: string;
  messageContentSms?: string;
  messageContentLms?: string;
  messageType: 'SMS' | 'LMS' | 'MMS';
  subject?: string;
  firstRecipient?: Record<string, any>;
  source: 'manual' | 'auto_ai';
  variantId?: string;  // 'A', 'B', 'C'
  batchId?: string;
  skipPrepaid?: boolean;
}

interface AutoSpamTestParams {
  companyId: string;
  userId: string;
  callbackNumber: string;
  messageType: 'SMS' | 'LMS' | 'MMS';
  subject?: string;
  variants: Array<{
    variantId: string;
    messageText: string;
  }>;
  isAd: boolean;
  rejectNumber?: string;
  firstRecipient?: Record<string, any>;
  // 재생성용 파라미터
  generateParams: {
    prompt: string;
    targetInfo: any;
    extraContext: any;
  };
  maxRetries?: number;  // 기본 2회
}

interface AutoSpamTestResult {
  batchId: string;
  variants: Array<{
    variantId: string;
    messageText: string;
    spamResult: 'pass' | 'blocked' | 'failed' | 'timeout';
    carrierResults: Array<{
      carrier: string;
      messageType: string;
      result: string;
    }>;
    regenerated: boolean;  // 재생성되었는지
    regenerateCount: number;
  }>;
  totalTestCount: number;
  totalRegenerateCount: number;
}
```

---

## 5. 발송 흐름 변경

### 기존 (베이직)

```
AI 문안 3개 생성 → 프론트에 표시 → 사용자가 수동 스팸테스트 → 선택 → 발송
```

### 변경 (프로)

```
AI 문안 3개 생성
  → 큐에 variant A/B/C 등록 (batch_id로 묶음)
  → 큐 워커가 순차 테스트 실행 (A→B→C)
  → 스팸 차단된 variant → AI 재생성 → 다시 큐 등록 → 재테스트
  → 최대 2회 재시도 후에도 차단 → 차단 뱃지로 표시
  → 프론트에 최종 결과 표시
    ├─ ✅ 수신 안전 (선택 가능)
    ├─ 🔄 재생성됨 + ✅ 수신 안전 (선택 가능)
    └─ 🚫 스팸 차단 (선택 불가, 최대 재시도 초과 시)
```

### 소요 시간 예상

| 시나리오 | 소요 시간 |
|----------|----------|
| 3개 모두 통과 | ~2분 (40초 × 3) |
| 1개 재생성 | ~2분 40초 |
| 2개 재생성 | ~3분 20초 |
| 최악 (전부 2회 재시도) | ~6분 |

---

## 6. 프론트엔드 UX

### 프로 사용자: AI 문안생성 결과 화면

```
┌──────────────────────────────────────┐
│  AI가 스팸 안전 검사 중... (2/3 완료) │
│  ██████████░░░░░░░░░░░ 67%           │
│                                      │
│  [A안 ✅ 수신 안전]  [B안 ⏳ 검사중]  │
│  [C안 ✅ 수신 안전]                   │
│                                      │
│  * 스팸 차단 문구는 자동 교체됩니다    │
└──────────────────────────────────────┘
```

### 검사 완료 후

```
┌──────────────────────────────────────┐
│  [A안] ✅ 수신 안전                   │
│  "봄맞이 30% 할인! 지금 매장..."      │
│                                      │
│  [B안] ✅ 수신 안전 (🔄 재생성됨)     │
│  "봄 시즌 특별 혜택을 준비..."        │
│                                      │
│  [C안] ✅ 수신 안전                   │
│  "고객님만을 위한 봄맞이..."          │
│                                      │
│  [🛡️ 스팸필터] [✅ 캠페인확정]        │
└──────────────────────────────────────┘
```

---

## 7. 수정 대상 파일

| 파일 | 변경 내용 | 비고 |
|------|-----------|------|
| **DB** | plans, spam_filter_tests 컬럼 추가 | Harold님 서버에서 실행 |
| **새 CT-09: utils/spam-test-queue.ts** | 큐 기반 스팸테스트 컨트롤타워 | 핵심 신규 파일 |
| **routes/spam-filter.ts** | 수동 테스트 큐 연동 + 프로 무료 | 기존 로직 리팩토링 |
| **routes/ai.ts** | generate-message에 자동 스팸테스트 | autoSpamTestWithRegenerate 호출 |
| **routes/companies.ts** | my-plan 응답에 auto_spam_test_enabled | SELECT 1줄 추가 |
| **app.ts** | 큐 워커 setInterval 시작 | startSpamTestQueueWorker() |
| **프론트: AiCampaignResultPopup.tsx** | 스팸 뱃지 + 진행률 UI | 프로 전용 UI |
| **프론트: Dashboard.tsx** | planInfo에 auto_spam_test_enabled | state 1줄 추가 |
| **status/SCHEMA.md** | 스키마 업데이트 | 문서 반영 |

---

## 8. 컨트롤타워 원칙 준수

- **CT-09 (spam-test-queue.ts):** 스팸 테스트 큐 + 실행의 유일한 진입점
- 기존 spam-filter.ts 라우트 → CT-09의 `enqueueSpamTest()` 호출로 변경
- AI 자동 테스트 → CT-09의 `autoSpamTestWithRegenerate()` 호출
- 인라인 스팸테스트 로직 절대 금지 (D75 원칙)

---

## 9. 확장 계획

| 단계 | 테스트폰 | 동시 처리 | 대상 고객 수 |
|------|----------|----------|-------------|
| Phase 1 (지금) | 통신사당 1대 (3대) | 1건 순차 | ~20개사 |
| Phase 2 | 통신사당 2~3대 | 2건 병렬 | ~50개사 |
| Phase 3 | 테스트폰 풀 + 로드밸런싱 | N건 병렬 | 100개사+ |
