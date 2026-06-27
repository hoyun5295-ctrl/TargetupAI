# 한줄로 문안 두뇌 — RAG + 브랜드 키트 구현 계획

> **For agentic workers:** 이 계획은 inline(현 세션 순차)으로 실행한다. CLAUDE.md `no_parallel_tasks` — 에이전트 병렬 금지, 하나씩 신중히. 각 Task는 RED→GREEN 단계. git add/commit/push·배포는 Harold님이 직접(AI 금지).

**Goal:** 7천 건(`ai_training_logs`)을 실시간 참조(RAG)로 문안 생성에 먹이고, 시의성 컨텍스트·브랜드 키트(자사 시그니처)·복제 가드를 더해 "계절감 반복"을 끝낸다. 이메일·캠페인 SMS 먼저 배선.

**Architecture:** 공통 RAG 코어(검색기·컨텍스트·가드)를 순수/DB 컨트롤타워로 신설 → 공통 프롬프트 빌더 `buildSystemPromptWithBrandVoice`(CT-99)가 합성 → 6개 생성 경로가 자동 수혜. 브랜드 보이스는 수동 5건 → 자동 학습 + 키트 하이브리드. 회사 우선 + 업종 비식별 폴백, 타사 시그니처 3단 차단.

**Tech Stack:** Node/Express + TypeScript, PostgreSQL(`ai_training_logs`·`ai_company_memory`), vitest(`npm test` = `vitest run`), React/TS 프론트.

**스펙:** `docs/superpowers/specs/2026-06-27-copy-brain-rag-brand-kit-design.md`

---

## File Structure

**신규 (packages/backend/src/utils)**
- `copy-context.ts` — 시의성 컨텍스트(순수). 시간·시즌·공휴일·절기·업종이벤트·고객·날씨 슬롯 → 프롬프트 문장.
- `copy-similarity-guard.ts` — 복제·금지어·시그니처 판정(순수). 입력 시그니처 후보 식별 + 출력 누출 검출.
- `copy-rag-retriever.ts` — 성과 문안 검색(DB). 회사→업종 폴백, 성과 정렬, 정직 빈결과. 순수 정렬 헬퍼 분리.
- `brand-voice-learner.ts` — 자동 학습 시드(DB). 회사 발송분에서 대표 문안 풀 자동 구성.

**신규 테스트 (packages/backend/src/utils/__tests__)**
- `copy-context.test.ts` / `copy-similarity-guard.test.ts` / `copy-rag-retriever.test.ts`(순수 헬퍼)

**수정**
- `utils/brand-voice-prompt.ts` — 조립기 확장(RAG 예시 + 컨텍스트 + 키트 + 시그니처 조합).
- `utils/email-ai.ts` — 생성·다듬기에 검색기/가드 배선.
- `routes/ai.ts` — `generateMessages`(캠페인 SMS) 동일 배선.
- `utils/ai-memory-accumulator-worker.ts` — 자동 학습·재추출 통합.
- `routes/ai-memory.ts` — 브랜드 키트 필드 저장/조회.
- `pages/AiMemoryPage.tsx` + `components/AiMemory/BrandVoiceCard.tsx` — slate 통일·키트 주인공·미리보기.
- `status/SCHEMA.md` — `ai_training_logs` 실측·인덱스, `ai_company_memory` 키트 필드.

---

## Phase 1 — 순수 코어 (TDD, DB·AI 무의존)

### Task 1: copy-context.ts — 시의성 컨텍스트 (순수)

**Files:** Create `utils/copy-context.ts`, `utils/__tests__/copy-context.test.ts`

**인터페이스(확정):**
```ts
export type SeasonKey = 'spring'|'summer'|'autumn'|'winter';
export type DayPart = 'morning'|'noon'|'afternoon'|'evening'|'night';
export interface TemporalContext {
  date: string;            // YYYY-MM-DD (KST)
  weekday: string;         // '월'..'일'
  isWeekend: boolean;
  dayPart: DayPart;
  season: SeasonKey;
  holiday: string | null;  // '설날'|'추석'|... | null
  anniversary: string | null; // '크리스마스'|'화이트데이'|... | null
  solarTerm: string | null;   // 절기 '입춘'|'대설'|... | null (근사 표 기반)
}
export interface IndustryEvent { key: string; label: string; window: string; }
export interface CopyContext {
  temporal: TemporalContext;
  industryEvents: IndustryEvent[];
  customer?: { avgCycleDays?: number; topGrade?: string; recentToneHint?: string };
  weather?: { region?: string; summary?: string; tempC?: number };
}
export function buildTemporalContext(now: Date): TemporalContext;
export function buildIndustryEvents(industryCode: string | null, now: Date): IndustryEvent[];
export function renderContextForPrompt(ctx: CopyContext): string; // 프롬프트용 한국어 1~5줄
```

**Step 1 — 실패 테스트 작성** (`copy-context.test.ts`)
```ts
import { describe, it, expect } from 'vitest';
import { buildTemporalContext, buildIndustryEvents, renderContextForPrompt } from '../copy-context';

describe('buildTemporalContext', () => {
  it('계절·요일·시간대를 KST로 정확히 분류', () => {
    const t = buildTemporalContext(new Date('2026-08-15T03:00:00Z')); // KST 12:00
    expect(t.season).toBe('summer');
    expect(t.weekday).toBe('토');
    expect(t.isWeekend).toBe(true);
    expect(t.dayPart).toBe('noon');
    expect(t.holiday).toBe('광복절');
  });
  it('공휴일/절기 없으면 null', () => {
    const t = buildTemporalContext(new Date('2026-03-04T01:00:00Z')); // KST 10:00 평일
    expect(t.holiday).toBeNull();
    expect(t.isWeekend).toBe(false);
    expect(t.dayPart).toBe('morning');
  });
});

describe('buildIndustryEvents', () => {
  it('업종+시기 매칭 이벤트만 반환', () => {
    const ev = buildIndustryEvents('fashion', new Date('2026-11-25T01:00:00Z')); // 블프 주간
    expect(ev.some((e) => e.key === 'black_friday')).toBe(true);
  });
  it('업종 null이면 공통 이벤트만/빈 배열 안전', () => {
    expect(Array.isArray(buildIndustryEvents(null, new Date('2026-03-04T01:00:00Z')))).toBe(true);
  });
});

describe('renderContextForPrompt', () => {
  it('빈 컨텍스트도 안전, 값 있으면 한국어 문장', () => {
    const ctx = { temporal: buildTemporalContext(new Date('2026-12-24T03:00:00Z')), industryEvents: [] };
    const s = renderContextForPrompt(ctx as any);
    expect(typeof s).toBe('string');
    expect(s).toContain('겨울');
  });
});
```

**Step 2 — 실패 확인:** `npm test -- copy-context` → FAIL(모듈 없음).

**Step 3 — 구현:** KST 변환(+9h), 계절(월 기준 3~5春/6~8夏/9~11秋/12~2冬), dayPart(시간대), 공휴일 표(양력 고정일 + 음력 설/추석은 2026~2028 근사 날짜 표), 절기 근사 표, 업종 이벤트 표(common + 업종별 window). `renderContextForPrompt`는 값 있는 항목만 자연 문장으로. **임의 상수·추정 0** — 전부 코드 테이블.

**Step 4 — 통과 확인:** `npm test -- copy-context` → PASS.

**Step 5 — 게이트:** `npx tsc --noEmit` 0. (커밋은 Harold)

---

### Task 2: copy-similarity-guard.ts — 복제·시그니처 가드 (순수)

**Files:** Create `utils/copy-similarity-guard.ts`, `utils/__tests__/copy-similarity-guard.test.ts`

**인터페이스(확정):**
```ts
export function normalizeForCompare(text: string): string;   // 공백/기호 정규화, 마스킹 토큰 제거
export function ngramTokens(text: string, n: number): string[];
/** 한 tenant에서 반복되는 고유 n-gram이면 시그니처 후보 → 업종 예시에서 제외 */
export function isLikelySignature(phrase: string, perTenantFreq: Record<string, number>, threshold?: number): boolean;
/** 생성문이 예시와 연속 n어절 일치 또는 유사도 임계 초과면 누출 */
export function checkCopyLeak(generated: string, examples: string[], opts?: { ngram?: number; jaccard?: number }): { leaked: boolean; matched?: string };
/** 금지어 포함 검출 */
export function findBannedWords(text: string, banned: string[]): string[];
```

**Step 1 — 실패 테스트:**
```ts
import { describe, it, expect } from 'vitest';
import { checkCopyLeak, findBannedWords, isLikelySignature } from '../copy-similarity-guard';

describe('checkCopyLeak', () => {
  it('연속 6어절 그대로 베끼면 leaked', () => {
    const ex = ['지금 바로 확인하고 특별한 혜택 받아가세요 오늘만'];
    const r = checkCopyLeak('안녕하세요 지금 바로 확인하고 특별한 혜택 받아가세요 오늘만 드림', ex, { ngram: 6 });
    expect(r.leaked).toBe(true);
  });
  it('표현이 다르면 통과', () => {
    const ex = ['지금 바로 확인하고 특별한 혜택 받아가세요'];
    const r = checkCopyLeak('새로운 소식을 가볍게 전해드려요', ex, { ngram: 6 });
    expect(r.leaked).toBe(false);
  });
});

describe('findBannedWords', () => {
  it('금지어 검출', () => {
    expect(findBannedWords('무료 사은품 증정', ['무료','대박'])).toContain('무료');
  });
});

describe('isLikelySignature', () => {
  it('동일 tenant 반복 고빈도 문구만 후보', () => {
    expect(isLikelySignature('오늘도 좋은 하루', { '오늘도 좋은 하루': 8 }, 3)).toBe(true);
    expect(isLikelySignature('가벼운 인사', { '가벼운 인사': 1 }, 3)).toBe(false);
  });
});
```

**Step 2 — 실패 확인:** `npm test -- copy-similarity-guard` → FAIL.

**Step 3 — 구현:** 정규화(공백 압축, 마스킹 토큰 `{brand}` 등 제거), n-gram 어절 슬라이딩 일치 + Jaccard 백업, 금지어 부분일치, 시그니처 빈도 임계. 순수.

**Step 4 — 통과:** `npm test -- copy-similarity-guard` → PASS.

**Step 5 — 게이트:** `npx tsc --noEmit` 0.

---

## Phase 2 — 검색기 + 데이터 검증 게이트

### Task 3 (게이트): ai_training_logs 실데이터 확정 — Harold SQL

코드 작성 전, 아래 순수 덤프 SQL을 Harold님께 제공하고 결과 확인(절대 0번 원칙 — 추측 컬럼 0). 결과로 MIN_COMPANY_SAMPLE/MIN_TOTAL_SAMPLE 임계와 폴백 동작을 확정.
```sql
-- 1) 컬럼 존재(코드 INSERT 컬럼 검증)
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name='ai_training_logs' ORDER BY ordinal_position;
-- 2) 총량·업종/성과 채움률
SELECT count(*) total,
       count(industry_code) has_industry,
       count(success_count) has_success,
       count(*) FILTER (WHERE message_type='EMAIL') email_cnt,
       count(*) FILTER (WHERE message_type IN ('SMS','LMS','MMS')) sms_cnt,
       count(distinct tenant_ref) tenants
FROM ai_training_logs;
-- 3) 인덱스 현황
SELECT indexname, indexdef FROM pg_indexes WHERE tablename='ai_training_logs';
```

### Task 4: copy-rag-retriever.ts — 성과 문안 검색

**Files:** Create `utils/copy-rag-retriever.ts`, `utils/__tests__/copy-rag-retriever.test.ts`(순수 정렬/조립 헬퍼만)

**인터페이스(확정):**
```ts
export interface CopyExample { text: string; source: 'company'|'industry'; features: Record<string,unknown>|null; successRate: number|null; }
export interface RetrieveInput { companyId: string; industryCode: string|null; channel: 'EMAIL'|'SMS'|'LMS'|'MMS'|'KAKAO'; isAd: boolean; limit?: number; }
export interface RetrieveResult { examples: CopyExample[]; companyCount: number; industryCount: number; }
/** 순수: 행 배열 → 성과 정렬 + 회사 우선 + dedup + limit. 성과 NULL이면 최신순 degrade */
export function rankExamples(companyRows: RawRow[], industryRows: RawRow[], limit: number, minCompany: number): CopyExample[];
export async function retrieveCopyExamples(input: RetrieveInput): Promise<RetrieveResult>;
```

**Step 1 — 실패 테스트(순수 rankExamples):** 회사 행이 minCompany 이상이면 회사만, 미만이면 업종 보강; 성과 높은 순; 성과 전부 null이면 최신순; dedup. (테스트 코드는 구현 시 RawRow 형태 확정 후 작성 — Task 3 결과 반영.)

**Step 2~4:** RED→GREEN(순수). `retrieveCopyExamples`는 꼬리표 SQL(tenant_ref=hmacHash(companyId) 1차, industry_code 2차) — `getSourceRef`/hmac은 training-logger 해시와 동일 비밀키 재사용(`getTenantRef` export 추가). 인덱스 없으면 Task 3 결과로 `CREATE INDEX IF NOT EXISTS` SQL을 Harold께 제공.

**Step 5 — 게이트:** `npm test` GREEN + `tsc` 0.

---

## Phase 3 — 조립기 + 배선 (이메일·캠페인 SMS)

### Task 5: brand-voice-prompt.ts 조립기 확장

**Files:** Modify `utils/brand-voice-prompt.ts`

새 export `composeCopyBrain(opts: { companyId; industryCode; channel; isAd; now: Date }): Promise<{ promptSuffix: string; examples: CopyExample[] }>` — 내부에서 `retrieveCopyExamples` + `buildTemporalContext`/`buildIndustryEvents` + 브랜드 키트(키트 필드 포함) + 시그니처 조합 지시를 한국어 프롬프트로 합성. 기존 `buildSystemPromptWithBrandVoice`는 유지하되 옵션 인자로 컨텍스트/예시를 받아 suffix에 덧붙이는 오버로드 추가(기존 호출부 무변경 = 하위호환). 업종 예시엔 "표현 복제 금지" 지시.

게이트: 기존 6개 호출부 시그니처 무변경(grep 확인) + tsc 0.

### Task 6: email-ai.ts 배선

**Files:** Modify `utils/email-ai.ts`

`generateEmailOneShot`/`generateEmailSections`/`refineEmail`에서 `composeCopyBrain` 호출 → system 프롬프트에 suffix 결합 + 생성 후 `checkCopyLeak(generated, examples.industry)` 위반 시 1회 재생성 → 그래도면 예시 없이 재생성. 금지어 가드 동일. `industryCode`는 companies에서 조회(없으면 null). 발송 로직 무수정.

게이트: tsc 0 + 자가 grep(모델명/박-단어 0).

### Task 7: routes/ai.ts generateMessages 배선

**Files:** Modify `routes/ai.ts` (구현 직전 `generateMessages` 정밀 grep)

동일 패턴: 채널 SMS/LMS/MMS로 `composeCopyBrain` + 복제·금지어 가드. 33자 SMS는 시그니처 자동 축약(조립기에서 처리).

게이트: tsc 0 + 실측 1건(생성 호출 → 예시 주입 로그 확인).

---

## Phase 4 — 브랜드 키트 + 자동 학습

### Task 8: 브랜드 키트 필드 저장/조회

**Files:** Modify `routes/ai-memory.ts`, `utils/brand-voice-prompt.ts`(읽기)

`brand_guideline` memory_value(jsonb)에 `signature_locked`/`signature_mode`/`slogans[]`/`required_words[]`/`banned_words[]` 추가. save/extract 시 admin 명시 필드는 보존(자동 추출이 덮지 않음 — 필드별 병합). 스키마 변경 없음(jsonb).

### Task 9: brand-voice-learner.ts 자동 학습

**Files:** Create `utils/brand-voice-learner.ts`, Modify `utils/ai-memory-accumulator-worker.ts`

회사 `representative_message` 0건이면 `ai_training_logs`(자기 발송, 성과 상위)에서 대표 문안 풀 자동 시드 + 가이드라인 추출(admin 미입력 필드만). 워커 1일 1회 통합, 멱등. 표본 미달 회사는 생략(가짜 금지).

게이트: tsc 0 + 표본 미달 시 생략 단위 테스트.

---

## Phase 5 — 화면 리디자인

### Task 10: AiMemoryPage + BrandVoiceCard slate 통일·키트 주인공

**Files:** Modify `pages/AiMemoryPage.tsx`, `components/AiMemory/BrandVoiceCard.tsx`(+ 필요 시 `components/AiMemory/BrandKitEditor.tsx` 신규)

- 배경 `from-violet-900...` → `bg-slate-950` + violet 액센트(0627 인앱 톤).
- 브랜드 키트(시그니처/슬로건/필수어/금지어/대표문안)를 최상단 주인공 카드. 분석(도넛·Top10·자세히분석)은 "자세히 보기" 모달/접기. cleanup·add 중복 제거.
- 키트 등록 + "이 키트로 쓰면 이렇게 나옵니다" 미리보기(조합 프리뷰 또는 샘플 1건 생성).
- 5건 상한 완화(저장 넉넉, 주입은 검색기 엄선).
- 영구 룰: native dialog 0(ConfirmModal+useToast), 모델명 0, 모바일 반응형, Source caption.

게이트: frontend tsc 0 + 자가 grep(confirm/prompt/alert·모델명·박-단어 0).

---

## 최종 검증 (전 Phase 후)

- backend tsc 0 / frontend tsc 0 / `npm test` GREEN(신규 3 + 기존 회귀).
- 자가 grep: 모델명·박-단어·native dialog·임의 혜택·가짜 0% 0건.
- 실측 1건 시나리오: 테스트 회사 1건 생성 → RAG 예시 주입 + 시그니처 조합 + 복제 가드 통과 확인.
- Harold 배포: ALTER/인덱스 SQL(Task 3·4 결과) → build:safe → pm2 restart all.

---

## Self-Review (스펙 대조)

- 스펙 ①~⑧ ↔ Task 1~10 매핑: ①=T4 ②=T1 ③=T5 ④=T2 ⑤=T8 ⑥=T9 ⑦=T6·T7 ⑧=T10. 누락 없음.
- 데이터 검증(스펙 §3) = Task 3 게이트로 선행.
- 시그니처 3단(스펙 §6): 입력=T2 isLikelySignature, 프롬프트=T5 지시, 출력=T2 checkCopyLeak(T6·T7 호출).
- 정직 폴백(스펙 §7): T4 빈결과 → T5/T6 예시 없이 생성. 임의 상수 0.
- 미해결(스펙 §10): 날씨 외부 API = copy-context weather 슬롯만(어댑터 후속), 임베딩 = 범위 밖. 계획 반영.
