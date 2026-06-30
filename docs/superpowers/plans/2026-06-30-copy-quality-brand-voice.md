# 문안 퀄리티 강화 + 브랜드보이스 수정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 한줄로 핵심 문안 생성을 꾸미기 격상(3크레딧) 수준으로 끌어올리고, 무증상 OFF 상태인 브랜드보이스 고장을 고치며, 회사 시그니처 누출을 구조적으로 0으로 만든다. (문안 전용 — 발송·DB 마이그레이션 0)

**Architecture:** 생성 파이프라인은 `generateMessages`(services/ai.ts) → `buildSystemPromptWithBrandVoice`(보이스) + `composeCopyBrain`(두뇌: RAG·시의성·키트) 합성 구조를 그대로 둔다. 강화는 (1) 새 순수 CT 2개(`copy-benefit-detector` 혜택감지·`copy-prompt-composer`의 features 렌더)와 (2) 기존 순수 함수(`buildCopyBrainPrompt`·`rankExamples`) 분기 추가, (3) 프롬프트 지시 강화(혜택강조·채널분리·앵글·단일호출 자가비평)로 한다. AI Operator propose는 이미 `generateMessages`를 타므로 자동 반영. 꾸미기(A7)는 `operator-message-decorator`(단일→3개·체크집합 정확반영) + 프론트 칩 정합으로 분리 처리.

**Tech Stack:** Node.js/Express + TypeScript(backend, ts-node 직접 실행), React/TS(frontend), PostgreSQL. 순수 함수 테스트 = `.verify.ts`(ts-node, DB import 금지) / Vitest 혼용 — 본 레포 기존 패턴 따름.

**불변 제약 (절대 깨지 말 것):** 혜택 날조 0(`[직접 작성]`) · 크레딧(문안 5·꾸미기 3·다듬기 1) 그대로 · 모델명 UI 0 · EUC-KR sanitize · 회사 격리(company_id) · 모델 분리(AI Operator opus / 기존 sonnet 무변경) · DB ALTER 0.

---

## File Structure

**신규 생성**
- `packages/backend/src/utils/copy-benefit-detector.ts` — 입력 문안의 구체 혜택 토큰 감지(순수, DB·AI 무의존). A1.
- `packages/backend/src/utils/copy-benefit-detector.test.ts` — 위 순수 테스트.
- `packages/backend/src/utils/__tests__/copy-prompt-composer.verify.ts` — `buildCopyBrainPrompt` 채널분기·features 렌더 순수 테스트(DB import 금지).
- `packages/backend/src/utils/__tests__/copy-rag-retriever.verify.ts` — `rankExamples` 격리게이트·`summarizeIndustryFeatures` 순수 테스트.

**수정**
- `packages/backend/src/utils/brand-voice-prompt.ts` — AND→가이드라인 단독 조건 완화 + few-shot 조건부 + 대표문안 LIMIT 5→10 + `getBrandVoiceStatus` 신설(OFF 가시화). B2.
- `packages/backend/src/utils/copy-rag-retriever.ts` — 격리게이트(`brandVoiceRegistered`) + 업종 source는 features만(text 비움) + `summarizeIndustryFeatures` 순수 함수. A6.
- `packages/backend/src/utils/copy-prompt-composer.ts` — `buildCopyBrainPrompt` 업종 섹션을 원문→features 통계로 교체 + 채널분기 + `composeCopyBrain`이 게이트 전달. A4·A6.
- `packages/backend/src/services/ai.ts` — `generateMessages`에 혜택감지·강조지시(채널분기)·앵글다양화·단일호출 자가비평·출력 누출/금지어 가드 추가. A1·A2·A3·A4·②.
- `packages/backend/src/routes/ai-memory.ts` — 대표문안 등록 상한 5→10. B·A6.
- `packages/backend/src/utils/operator-message-decorator.ts` — 단일 message→3개 배열 + selectedVars 정확집합(체크=포함·해제=제거). A7.
- `packages/backend/src/routes/ai.ts` — `/operator/decorate-message`가 messages[] 3개 처리(1액션=3크레딧 게이트). A7.
- `packages/frontend/src/pages/AiMemoryPage.tsx` + `components/AiMemory/BrandVoiceCard.tsx` — 대표문안 5→10 입력 허용 + 브랜드보이스 OFF 안내. B·A6.
- `packages/frontend/src/pages/AiOperatorPage.tsx` — 사용 변수 칩 자동체크 + 토글 + 꾸미기 호출 시 체크집합 전달 + 3개 변형 전부 적용. A7.

**Phase 의존 순서:** 1(브랜드보이스 fix) → 2(대표문안 5→10) → 3(혜택강조·채널·앵글) → 4(격리게이트) → 5(자가비평) → 6(출력가드) → 7(꾸미기). 각 Phase 끝에 commit. Phase 1~6은 문안 생성 파이프라인(서로 인접), Phase 7은 분리 가능.

---

## Phase 1 — 브랜드보이스 고장 fix (무증상 OFF 종결)

근거: `brand-voice-prompt.ts:174` `if (!data.guideline || data.messages.length === 0) return basePrompt;` = 가이드라인+대표문안 둘 다 있어야 작동(운영 3사 중 1사만 작동). 가이드라인만 있어도 톤 적용되게 완화 + OFF 상태 가시화.

### Task 1: 브랜드보이스 AND 조건 완화 + few-shot 조건부

**Files:**
- Modify: `packages/backend/src/utils/brand-voice-prompt.ts:174-176` (조건), `:185-224`(few-shot 섹션 조건부), `:87`(LIMIT 5→10)

- [ ] **Step 1: LIMIT 5→10 변경**

`packages/backend/src/utils/brand-voice-prompt.ts:83-89` 의 대표문안 조회 `LIMIT 5` → `LIMIT 10`:

```typescript
    query(
      `SELECT memory_value FROM ai_company_memory
       WHERE company_id = $1::uuid AND memory_type = 'representative_message'
       ORDER BY memory_key ASC
       LIMIT 10`,
      [companyId],
    ),
```

- [ ] **Step 2: AND 조건 완화 — 가이드라인만 있어도 작동**

`:174-176` 교체. 대표문안 0건이어도 가이드라인+RAG로 톤 적용(few-shot은 있을 때만):

```typescript
  if (!data.guideline) {
    return basePrompt;
  }
```

- [ ] **Step 3: few-shot 섹션 조건부 렌더**

`:185-188`(fewShotSection 생성)과 `:211-215`(In-Context 섹션)을 대표문안이 있을 때만 포함하도록 변경. `:185` 위에 가드 추가:

```typescript
  const hasFewShot = data.messages.length > 0;
  const fewShotSection = hasFewShot
    ? data.messages.map((m, i) => {
        const meta = m.message_subject ? ` · 제목: ${m.message_subject}` : '';
        return `### 예시 ${i + 1} (채널: ${m.channel}${meta})\n${m.message_text}`;
      }).join('\n\n')
    : '';
```

그리고 `brandVoiceSection` 템플릿의 In-Context 블록(`:211-215`)을 조건부 문자열로 교체:

```typescript
${hasFewShot ? `## In-Context Learning — 회사 대표 문안 Few-shot 예시

아래 ${data.messages.length}건은 본 회사의 실제 마케팅 문안입니다. AI 생성 문안은 본 톤/문체/구조를 자연스럽게 정합하세요. 단, 본문 내용 자체를 복사하지 말고 톤만 학습하세요.

${fewShotSection}
` : ''}
```

- [ ] **Step 4: tsc 검증**

Run: `cd packages/backend && node node_modules/typescript/lib/tsc.js --noEmit`
Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/utils/brand-voice-prompt.ts
git commit -m "fix(copy): 브랜드보이스 AND 조건 완화 — 가이드라인만 있어도 톤 적용 + 대표문안 10건"
```

### Task 2: 브랜드보이스 OFF 가시화 — getBrandVoiceStatus

**Files:**
- Modify: `packages/backend/src/utils/brand-voice-prompt.ts` (신규 export 함수, 파일 끝)

- [ ] **Step 1: getBrandVoiceStatus 추가**

`buildSystemPromptWithBrandVoice` 아래에 추가. 프론트가 "브랜드보이스 작동 여부"를 알 수 있게 같은 캐시 데이터로 판정:

```typescript
export interface BrandVoiceStatus {
  applied: boolean;       // 가이드라인 존재 → 생성에 톤 적용됨
  hasGuideline: boolean;
  representativeCount: number;
  reason?: string;        // applied=false 사유
}

/** 프론트 안내용 — 브랜드보이스가 실제 생성에 적용되는 상태인지 반환 (silent degrade 종결) */
export async function getBrandVoiceStatus(companyId: string | undefined): Promise<BrandVoiceStatus> {
  if (!companyId) return { applied: false, hasGuideline: false, representativeCount: 0, reason: '회사 정보 없음' };
  let data: BrandVoiceCacheEntry;
  try {
    data = await getBrandVoiceData(companyId);
  } catch {
    return { applied: false, hasGuideline: false, representativeCount: 0, reason: '데이터 조회 실패' };
  }
  const hasGuideline = !!data.guideline;
  return {
    applied: hasGuideline,
    hasGuideline,
    representativeCount: data.messages.length,
    reason: hasGuideline ? undefined : '브랜드 가이드라인 미설정 — 대표 문안을 등록하면 우리 회사 톤으로 생성됩니다.',
  };
}
```

- [ ] **Step 2: 상태 endpoint 노출 (ai-memory.ts)**

`packages/backend/src/routes/ai-memory.ts` 의 brand-voice GET 라우트군 근처(`:359` 대표문안 조회 라우트와 같은 영역)에 status endpoint 추가. import는 파일 상단 brand-voice-prompt import에 `getBrandVoiceStatus` 추가:

```typescript
// GET /api/ai-memory/brand-voice/status — 브랜드보이스 적용 여부(프론트 OFF 안내)
router.get('/brand-voice/status', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const status = await getBrandVoiceStatus(companyId);
    return res.json({ success: true, status });
  } catch (err: any) {
    console.error('[brand-voice status] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '상태 조회 실패' });
  }
});
```

(라우트 경로 prefix는 ai-memory 라우터 mount 기준 `/brand-voice/...` 기존 패턴 — `:294` 주석의 `/api/ai-memory/brand-voice/save-messages`와 동일 prefix 확인 후 정합.)

- [ ] **Step 3: tsc 검증**

Run: `cd packages/backend && node node_modules/typescript/lib/tsc.js --noEmit`
Expected: 0 errors

- [ ] **Step 4: 프론트 OFF 안내 배너 (AiMemoryPage)**

`packages/frontend/src/components/AiMemory/BrandVoiceCard.tsx` 상단에, status를 fetch해서 `hasGuideline=false`면 안내 카드 노출. 다크 톤 정합(`bg-amber-500/10 border border-amber-400/30 rounded-xl`), Source caption 불요. native dialog 금지:

```tsx
{voiceStatus && !voiceStatus.hasGuideline && (
  <div className="bg-amber-500/10 border border-amber-400/30 rounded-xl p-3 mb-3 text-sm text-amber-200">
    브랜드보이스가 아직 적용되지 않습니다 — 대표 문안을 등록하면 생성 문안이 우리 회사 톤으로 작성됩니다.
  </div>
)}
```

`voiceStatus`는 `useEffect`로 `GET /api/ai-memory/brand-voice/status` 호출해 state에 저장.

- [ ] **Step 5: 프론트 빌드 검증**

Run: `cd packages/frontend && node node_modules/typescript/lib/tsc.js --noEmit`
Expected: 0 errors

- [ ] **Step 6: 자가 grep — 모델명/native dialog 0건**

Run: `grep -rnE "Opus|Sonnet|GPT|Claude|alert\(|confirm\(|prompt\(" packages/frontend/src/components/AiMemory/BrandVoiceCard.tsx packages/frontend/src/pages/AiMemoryPage.tsx`
Expected: 0 (신규 추가분 기준)

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/utils/brand-voice-prompt.ts packages/backend/src/routes/ai-memory.ts packages/frontend/src/components/AiMemory/BrandVoiceCard.tsx packages/frontend/src/pages/AiMemoryPage.tsx
git commit -m "feat(copy): 브랜드보이스 OFF 가시화 — status endpoint + 프론트 안내 배너"
```

---

## Phase 2 — 대표문안 등록 상한 5→10

근거: 설계서 A6 "대표문안 5→10(등록 화면·LIMIT·저장 상한 모두)". Phase 1에서 LIMIT은 처리됨. 여기서 저장 상한 + 프론트.

### Task 3: 저장 상한 5→10 (backend)

**Files:**
- Modify: `packages/backend/src/routes/ai-memory.ts:432-433`

- [ ] **Step 1: 검증 상한 변경**

`:431-434` 교체:

```typescript
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    if (messages.length < 1 || messages.length > 10) {
      return res.status(400).json({ success: false, error: '대표 문안은 1~10건 등록 가능합니다.' });
    }
```

(DELETE 후 전체 재INSERT 구조라 10건도 `memory_key = msg_01..msg_10` zero-pad가 `String(item.priority).padStart(2,'0')`로 이미 정합 — 정렬 `ORDER BY memory_key ASC` 안전.)

- [ ] **Step 2: tsc 검증**

Run: `cd packages/backend && node node_modules/typescript/lib/tsc.js --noEmit`
Expected: 0 errors

- [ ] **Step 3: 프론트 10건 허용 (AiMemoryPage / BrandVoiceCard)**

`packages/frontend/src/pages/AiMemoryPage.tsx`(또는 BrandVoiceCard) 의 대표문안 추가 버튼 상한·안내 텍스트에서 `5` 하드코딩을 `10`으로 변경. "최대 5건" → "최대 10건", `messages.length >= 5` 추가 차단 → `>= 10`. (정확 위치는 grep `최대 5|>= 5|length < 5|slice(0, 5)`로 식별 후 교체.)

- [ ] **Step 4: 프론트 tsc 검증**

Run: `cd packages/frontend && node node_modules/typescript/lib/tsc.js --noEmit`
Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/routes/ai-memory.ts packages/frontend/src/pages/AiMemoryPage.tsx packages/frontend/src/components/AiMemory/BrandVoiceCard.tsx
git commit -m "feat(copy): 대표 문안 등록 상한 5→10 (등록 화면·저장·LIMIT 정합)"
```

---

## Phase 3 — 혜택 감지·강조 + 채널 분리 + 앵글 다양화

근거: 설계서 A1(입력 두 갈래)·A4(채널분리)·A3(앵글). 혜택은 **현재 입력**(cleanPrompt)에서 감지해야 함(RAG 코퍼스는 마스킹돼 `{amount}`만 — 1-1 관찰). generateMessages 안에서 처리.

### Task 4: 혜택 감지 순수 함수 (copy-benefit-detector)

**Files:**
- Create: `packages/backend/src/utils/copy-benefit-detector.ts`
- Test: `packages/backend/src/utils/copy-benefit-detector.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```typescript
// packages/backend/src/utils/copy-benefit-detector.test.ts
import { describe, it, expect } from 'vitest';
import { detectBenefits } from './copy-benefit-detector';

describe('detectBenefits — 구체 혜택 토큰 감지', () => {
  it('퍼센트 할인 감지', () => {
    const r = detectBenefits('이번 주 전 품목 30% 할인');
    expect(r.hasBenefit).toBe(true);
    expect(r.tokens).toContain('30%');
  });
  it('원 단위 금액 감지', () => {
    expect(detectBenefits('5000원 적립 이벤트').hasBenefit).toBe(true);
  });
  it('N+N 증정 감지', () => {
    expect(detectBenefits('1+1 행사').hasBenefit).toBe(true);
  });
  it('키워드 혜택 감지 (반값·무료배송·사은품·쿠폰)', () => {
    expect(detectBenefits('전 상품 반값 세일').hasBenefit).toBe(true);
    expect(detectBenefits('오늘만 무료배송').hasBenefit).toBe(true);
    expect(detectBenefits('구매 시 사은품 증정').hasBenefit).toBe(true);
    expect(detectBenefits('할인 쿠폰 드려요').hasBenefit).toBe(true);
  });
  it('혜택 없는 안내문은 false', () => {
    const r = detectBenefits('신상품이 입고되었습니다. 매장에서 만나보세요.');
    expect(r.hasBenefit).toBe(false);
    expect(r.tokens).toEqual([]);
  });
  it('연도/시각 숫자는 혜택 오탐 X', () => {
    expect(detectBenefits('2026년 봄 신상 출시').hasBenefit).toBe(false);
    expect(detectBenefits('오후 3시 오픈').hasBenefit).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd packages/backend && node node_modules/vitest/vitest.mjs run src/utils/copy-benefit-detector.test.ts`
Expected: FAIL — "Cannot find module './copy-benefit-detector'"

- [ ] **Step 3: 구현**

```typescript
// packages/backend/src/utils/copy-benefit-detector.ts
/**
 * copy-benefit-detector.ts — 입력 문안의 구체 혜택 토큰 감지 (순수, DB·AI 무의존)
 *
 * 목적: 사용자가 자연어로 넣은 실혜택(%·원·N+N·반값·무료배송·사은품·쿠폰 등)을 감지해
 *       후크·CTA의 주인공으로 강조하도록 generateMessages가 채널별 강조 지시를 붙이게 한다.
 *       감지 X면 시의성(계절·시즌)으로 풍성 — 혜택 날조는 절대 0.
 *
 * 오탐 가드: 연도(20xx년)·시각(N시)·N월/N일은 혜택 아님.
 */

export interface BenefitDetectResult {
  hasBenefit: boolean;
  tokens: string[]; // 감지된 혜택 토큰 (강조 대상)
}

const KEYWORD_BENEFITS = [
  '반값', '무료배송', '무료 배송', '사은품', '쿠폰', '적립', '무료증정', '무료 증정',
  '1+1', '2+1', '증정', '경품', '할인',
];

export function detectBenefits(input: string): BenefitDetectResult {
  const text = String(input || '');
  const tokens: string[] = [];

  // 1) 퍼센트 (예: 30%, 50 %)
  for (const m of text.matchAll(/\d{1,3}\s*%/g)) tokens.push(m[0].replace(/\s+/g, ''));

  // 2) 원 단위 금액 (예: 5000원, 1만원) — '년/월/일/시'가 바로 뒤따르면 제외
  for (const m of text.matchAll(/\d[\d,]*\s*원/g)) tokens.push(m[0].replace(/\s+/g, ''));
  for (const m of text.matchAll(/\d+\s*만\s*원/g)) tokens.push(m[0].replace(/\s+/g, ''));

  // 3) N+N (예: 1+1, 2+1)
  for (const m of text.matchAll(/\d\s*\+\s*\d/g)) tokens.push(m[0].replace(/\s+/g, ''));

  // 4) 키워드
  for (const kw of KEYWORD_BENEFITS) {
    if (text.includes(kw)) tokens.push(kw);
  }

  // dedup
  const uniq = Array.from(new Set(tokens));
  return { hasBenefit: uniq.length > 0, tokens: uniq };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd packages/backend && node node_modules/vitest/vitest.mjs run src/utils/copy-benefit-detector.test.ts`
Expected: PASS (6 passed)

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/utils/copy-benefit-detector.ts packages/backend/src/utils/copy-benefit-detector.test.ts
git commit -m "feat(copy): 혜택 토큰 감지 순수 CT (copy-benefit-detector) + TDD"
```

### Task 5: 혜택 강조 지시 빌더 (채널분기) 순수 함수

**Files:**
- Modify: `packages/backend/src/utils/copy-benefit-detector.ts` (함수 추가)
- Test: `packages/backend/src/utils/copy-benefit-detector.test.ts` (테스트 추가)

- [ ] **Step 1: 실패 테스트 추가**

기존 테스트 파일 끝에 추가:

```typescript
import { buildBenefitEmphasis } from './copy-benefit-detector';

describe('buildBenefitEmphasis — 채널별 강조 지시', () => {
  it('혜택 있음 + SMS/LMS = 텍스트 강조 지시(이모지 금지)', () => {
    const s = buildBenefitEmphasis(['30%', '무료배송'], 'SMS');
    expect(s).toContain('30%');
    expect(s).toContain('무료배송');
    expect(s).toMatch(/후크|첫 줄|강조/);
    expect(s).not.toMatch(/😀|🔥|✨/);
  });
  it('혜택 있음 + LMS = 텍스트 강조(【】·▶ 허용 안내)', () => {
    const s = buildBenefitEmphasis(['반값'], 'LMS');
    expect(s).toContain('반값');
  });
  it('혜택 없음 = 시의성 풍성 지시(혜택 날조 금지)', () => {
    const s = buildBenefitEmphasis([], 'SMS');
    expect(s).toMatch(/계절|시즌|시의성/);
    expect(s).toMatch(/날조|지어내지/);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd packages/backend && node node_modules/vitest/vitest.mjs run src/utils/copy-benefit-detector.test.ts`
Expected: FAIL — "buildBenefitEmphasis is not a function"

- [ ] **Step 3: 구현 추가**

`copy-benefit-detector.ts` 끝에 추가:

```typescript
type Channel = 'SMS' | 'LMS' | 'MMS' | '카카오' | 'KAKAO' | 'EMAIL' | string;

/**
 * 혜택 유무 + 채널에 따른 강조 지시문 생성.
 *  - 혜택 O: 후크·CTA 주인공 배치. SMS/LMS = 텍스트 강조(【】·▶·줄바꿈, 이모지 금지).
 *  - 혜택 X: 계절감·시의성으로 풍성. 혜택 날조 절대 금지.
 */
export function buildBenefitEmphasis(tokens: string[], channel: Channel): string {
  if (tokens.length > 0) {
    const list = tokens.join(', ');
    const isText = channel === 'SMS' || channel === 'LMS' || channel === 'MMS';
    const styleLine = isText
      ? '- 강조 방식: 첫 줄(후크)과 CTA에 혜택을 주인공으로 배치. 【】·▶·줄바꿈으로 텍스트 강조하되 이모지·통신사 미지원 특수문자는 절대 쓰지 마세요.'
      : '- 강조 방식: 혜택 숫자를 시각적으로 도드라지게(크게·굵게) 후크와 CTA의 주인공으로 배치하세요.';
    return [
      '',
      '## 혜택 강조 (최우선)',
      `- 사용자가 입력한 실제 혜택: ${list}`,
      '- 위 혜택을 메시지의 후크(첫 인상)와 CTA(행동 유도)의 중심에 두고, 혜택이 바로 보이게 구성하세요.',
      styleLine,
      '- 단, 입력에 없는 새로운 혜택(다른 %·원·쿠폰·무료 등)을 추가로 지어내지 마세요.',
    ].join('\n');
  }
  return [
    '',
    '## 풍성도 (혜택 미입력 — 시의성으로)',
    '- 구체 혜택(%·원·쿠폰·무료 등)을 절대 지어내지 마세요. 혜택 날조 금지.',
    '- 대신 현재 계절감·해당 월 특성·시즌 이벤트·요일/시간 맥락을 자연스럽게 살려 문안 자체를 풍성하게 작성하세요.',
  ].join('\n');
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd packages/backend && node node_modules/vitest/vitest.mjs run src/utils/copy-benefit-detector.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/utils/copy-benefit-detector.ts packages/backend/src/utils/copy-benefit-detector.test.ts
git commit -m "feat(copy): 채널별 혜택 강조/시의성 풍성 지시 빌더 + TDD"
```

### Task 6: generateMessages에 혜택강조·앵글·채널분리 배선

**Files:**
- Modify: `packages/backend/src/services/ai.ts` (import 상단 + `generateMessages` userMessage 조립부 `:1113-1168`)

- [ ] **Step 1: import 추가**

`services/ai.ts` 상단 import 영역(`:14-15` 인접)에:

```typescript
import { detectBenefits, buildBenefitEmphasis } from '../utils/copy-benefit-detector';
```

- [ ] **Step 2: 혜택 감지 + 강조문 생성**

`generateMessages` 안, `cleanPrompt` 확정 직후(`:1076` 아래)에:

```typescript
  // ★ A1/A4 (2026-06-30): 입력 혜택 감지 → 채널별 강조 / 미입력 시 시의성 풍성 (혜택 날조 0)
  const benefitDetect = detectBenefits(cleanPrompt);
  const benefitEmphasis = buildBenefitEmphasis(benefitDetect.tokens, channel);
```

- [ ] **Step 3: userMessage에 강조문 + 앵글 다양화 삽입**

`userMessage` 템플릿의 `## 요청사항` 블록(`:1148` 인접)에 `benefitEmphasis`를 끼우고, A/B/C 앵글 다양화 지시를 추가. `:1149` 의 요청 문장을 다음으로 교체:

```typescript
## 요청사항
${channel} 채널에 최적화된 3가지 문안(A/B/C)을 생성해주세요.
- A/B/C는 서로 다른 각도로 작성하세요: A=핵심 혜택/제안 직설, B=감성·공감 또는 스토리, C=긴급·한정(마감/수량) 또는 실용 정보. (단, 없는 혜택·없는 마감일을 지어내지 말 것 — 각도만 다르게)
- 브랜드명은 "[${brandName}]" 형태로 정확히 사용
${benefitEmphasis}
```

(기존 `:1150-1158` 의 브랜드명/슬로건/금지/byte/kakao/LMS 안내 라인은 그대로 이어둠.)

- [ ] **Step 4: 채널 밀도 안내 강화 (A4)**

`:1158` LMS 안내 라인 뒤에 LMS/MMS 풍성 안내 추가(SMS는 기존 byte 밀도 안내 유지). `:1158` 의 LMS 조건 라인을 다음으로 교체:

```typescript
${channel === 'LMS' || channel === 'MMS' ? '- LMS/MMS는 줄바꿈·문단으로 가독성 좋게, 후크→본문→CTA 구조로 풍성하게 작성 (한 줄 최대 17자 내외, 이모지 금지)\n- ⚠️ subject(제목)에는 %변수% 절대 사용 금지! 고정 텍스트만!' : ''}
${channel === 'SMS' ? '- SMS는 길이가 아니라 밀도입니다. 한정된 바이트 안에 후크+혜택+CTA를 압축하세요.' : ''}
```

- [ ] **Step 5: tsc 검증**

Run: `cd packages/backend && node node_modules/typescript/lib/tsc.js --noEmit`
Expected: 0 errors

- [ ] **Step 6: 자가 grep — 시스템 프롬프트 안 구체 혜택 날조 지시 0 / 이모지 금지 유지**

Run: `grep -nE "지어내|날조|이모지" packages/backend/src/utils/copy-benefit-detector.ts`
Expected: 혜택 날조 금지·이모지 금지 문구 존재 확인 (구체 혜택 하드코딩 0)

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/services/ai.ts
git commit -m "feat(copy): generateMessages 혜택강조·채널분리·앵글 다양화 배선 (propose 자동 반영)"
```

---

## Phase 4 — 회사 격리 게이트 (시그니처 누출 구조적 0)

근거: 설계서 A6. 게이트 = 브랜드보이스 등록 여부. 등록 회사 = 자기것만(업종 폴백 OFF). 미등록 = 업종을 **message_features 구조·통계로만**(원문 0). 현재 `copy-rag-retriever`는 업종 폴백을 `final_message` 원문으로 담고 `copy-prompt-composer:71-77`이 raw 주입 — 이걸 교체.

### Task 7: 업종 features 요약 순수 함수 + 격리게이트

**Files:**
- Modify: `packages/backend/src/utils/copy-rag-retriever.ts`
- Test: `packages/backend/src/utils/__tests__/copy-rag-retriever.verify.ts`

- [ ] **Step 1: 실패 테스트 작성 (verify.ts — DB import 금지, 순수 함수만)**

```typescript
// packages/backend/src/utils/__tests__/copy-rag-retriever.verify.ts
import assert from 'node:assert';
import { rankExamples, summarizeIndustryFeatures, type TrainingRow } from '../copy-rag-retriever';

function row(msg: string, features: Record<string, unknown> | null = null): TrainingRow {
  return { final_message: msg, message_features: features, sent_count: 100, success_count: 10, created_at: '2026-06-01' };
}

// 등록 회사(brandVoiceRegistered=true) → 업종 폴백 OFF: 회사 표본 부족해도 회사것만, 타사 0
{
  const company = [row('우리 회사 문안 1')];
  const industry = [row('타사 문안 A'), row('타사 문안 B'), row('타사 문안 C')];
  const out = rankExamples(company, industry, 8, 5, true /* brandVoiceRegistered */);
  assert.strictEqual(out.every((e) => e.source === 'company'), true, '등록 회사는 타사 0');
  assert.strictEqual(out.length, 1);
}

// 미등록 회사(false) + 회사 부족 → 업종 보강하되 features만(원문 비움)
{
  const company: TrainingRow[] = [];
  const industry = [row('타사 문안 A'), row('타사 문안 B'), row('타사 문안 C')];
  const out = rankExamples(company, industry, 8, 5, false);
  const ind = out.filter((e) => e.source === 'industry');
  assert.strictEqual(ind.length > 0, true, '미등록은 업종 보강');
  assert.strictEqual(ind.every((e) => e.text === ''), true, '업종 source 원문 비움(누출 0)');
}

// summarizeIndustryFeatures — 구조·통계만
{
  const rows = [row('안녕하세요 신상 입고. 지금 확인하세요'), row('봄 신상 만나보세요. 매장 방문 환영')];
  const f = summarizeIndustryFeatures(rows);
  assert.strictEqual(typeof f.avgLengthChars, 'number');
  assert.strictEqual(typeof f.sampleCount, 'number');
  assert.strictEqual(f.sampleCount, 2);
  // 원문 문장이 결과 어디에도 없어야(누출 0)
  assert.strictEqual(JSON.stringify(f).includes('신상'), false, 'features에 원문 단어 누출 0');
}

console.log('copy-rag-retriever.verify PASS');
```

- [ ] **Step 2: 실패 확인**

Run: `cd packages/backend && node -r ts-node/register src/utils/__tests__/copy-rag-retriever.verify.ts`
Expected: FAIL — `summarizeIndustryFeatures` export 없음 / `rankExamples` 5th arg 미지원

- [ ] **Step 3: summarizeIndustryFeatures 구현 + rankExamples 게이트 인자 추가**

`copy-rag-retriever.ts` 에 추가/수정:

```typescript
export interface IndustryFeatureSummary {
  sampleCount: number;
  avgLengthChars: number;
  avgSentenceCount: number;
  hasCtaRatio: number;      // CTA(지금/바로/확인/방문 등)를 포함한 표본 비율 0~1
}

const CTA_HINTS = ['지금', '바로', '확인', '방문', '오세요', '받아', '신청', '예약', '클릭'];

/** 업종 표본의 구조·통계만 요약 (원문 문장·고유표현 일절 미포함 — 시그니처 누출 0) */
export function summarizeIndustryFeatures(rows: TrainingRow[]): IndustryFeatureSummary {
  const n = rows.length;
  if (n === 0) return { sampleCount: 0, avgLengthChars: 0, avgSentenceCount: 0, hasCtaRatio: 0 };
  let lenSum = 0, sentSum = 0, ctaCount = 0;
  for (const r of rows) {
    const t = String(r.final_message || '');
    lenSum += t.length;
    sentSum += (t.split(/[.!?。\n]/).filter((s) => s.trim().length > 0).length) || 1;
    if (CTA_HINTS.some((h) => t.includes(h))) ctaCount++;
  }
  return {
    sampleCount: n,
    avgLengthChars: Math.round(lenSum / n),
    avgSentenceCount: Math.round((sentSum / n) * 10) / 10,
    hasCtaRatio: Math.round((ctaCount / n) * 100) / 100,
  };
}
```

`rankExamples` 시그니처에 `brandVoiceRegistered` 추가하고 폴백 분기 + 업종 text 비움:

```typescript
export function rankExamples(
  company: TrainingRow[],
  industry: TrainingRow[],
  limit: number,
  minCompany: number,
  brandVoiceRegistered = false,
): CopyExample[] {
  const co = sortRanked(company.map((r) => toRanked(r, 'company')));
  let pool: RankedRow[] = co;
  // ★ A6: 브랜드보이스 등록 회사 = 업종 폴백 OFF(자기것만). 미등록 + 회사 부족 시에만 업종 보강.
  if (!brandVoiceRegistered && company.length < minCompany) {
    const ind = sortRanked(
      industry.map((r) => {
        const rk = toRanked(r, 'industry');
        rk.ex.text = ''; // ★ 업종 원문 비움 — 프롬프트엔 features만 들어감(누출 0)
        return rk;
      }),
    );
    pool = [...co, ...ind];
  }

  const seen = new Set<string>();
  const out: CopyExample[] = [];
  for (const r of pool) {
    // 업종(text 비움)은 dedup 키를 features 기반으로 — text='' 충돌 방지
    const key = r.ex.source === 'company'
      ? (r.ex.text || '').replace(/\s+/g, ' ').trim()
      : `industry:${out.filter((e) => e.source === 'industry').length}`;
    if (r.ex.source === 'company' && (!key || seen.has(key))) continue;
    if (r.ex.source === 'company') seen.add(key);
    out.push(r.ex);
    if (out.length >= limit) break;
  }
  return out;
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd packages/backend && node -r ts-node/register src/utils/__tests__/copy-rag-retriever.verify.ts`
Expected: `copy-rag-retriever.verify PASS`

- [ ] **Step 5: retrieveCopyExamples가 게이트 전달 + features 반환**

`retrieveCopyExamples` 입력에 `brandVoiceRegistered?: boolean` 추가, 등록 회사면 업종 쿼리 자체 skip, `rankExamples` 5th arg 전달, 결과에 `industryFeatures` 포함:

```typescript
export interface RetrieveInput {
  companyId: string;
  industryCode: string | null;
  channels: string[];
  isAd: boolean;
  limit?: number;
  brandVoiceRegistered?: boolean; // ★ A6 게이트
}

export interface RetrieveResult {
  examples: CopyExample[];
  companyCount: number;
  industryCount: number;
  industryFeatures: IndustryFeatureSummary | null; // ★ A6
}
```

`retrieveCopyExamples` 본문: 업종 쿼리 가드를 `if (!input.brandVoiceRegistered && companyRes.rows.length < MIN_COMPANY_SAMPLE && industryCode)` 로 바꾸고, `rankExamples(companyRows, industryRows, limit, MIN_COMPANY_SAMPLE, !!input.brandVoiceRegistered)`, 반환에 `industryFeatures: industryRows.length ? summarizeIndustryFeatures(industryRows) : null` 추가. 정직 폴백 분기에도 `industryFeatures: null` 동반.

- [ ] **Step 6: tsc 검증**

Run: `cd packages/backend && node node_modules/typescript/lib/tsc.js --noEmit`
Expected: 0 errors (composeCopyBrain 호출부가 새 필드 안 줘도 optional이라 통과 — 다음 Task에서 연결)

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/utils/copy-rag-retriever.ts packages/backend/src/utils/__tests__/copy-rag-retriever.verify.ts
git commit -m "feat(copy): A6 격리게이트 — 등록 회사 업종 폴백 OFF + 업종은 features 통계만 (누출 0) + TDD"
```

### Task 8: composer가 업종을 features로 렌더 + 게이트 판정

**Files:**
- Modify: `packages/backend/src/utils/copy-prompt-composer.ts:50-105`(buildCopyBrainPrompt), `:108-149`(composeCopyBrain)
- Test: `packages/backend/src/utils/__tests__/copy-prompt-composer.verify.ts`

- [ ] **Step 1: 실패 테스트 작성 (순수 buildCopyBrainPrompt — DB import 무)**

```typescript
// packages/backend/src/utils/__tests__/copy-prompt-composer.verify.ts
import assert from 'node:assert';
import { buildCopyBrainPrompt } from '../copy-prompt-composer';

// 업종 features만 전달 → 원문 문장 0, 통계 안내만
{
  const suffix = buildCopyBrainPrompt({
    examples: [],
    industryFeatures: { sampleCount: 12, avgLengthChars: 88, avgSentenceCount: 3, hasCtaRatio: 0.75 },
    contextLine: '',
    kit: {},
    channel: 'LMS',
  });
  assert.strictEqual(suffix.includes('88'), true, '평균 길이 통계 포함');
  assert.strictEqual(/문안 \d|\. /.test(suffix.replace('88', '')), true || true); // 통계 텍스트 존재
  assert.strictEqual(suffix.includes('타사'), true, '같은 업종 구조 참고 안내');
}

// 회사 예시는 원문 참고 허용(자기것)
{
  const suffix = buildCopyBrainPrompt({
    examples: [{ text: '우리 회사 대표 문안', source: 'company', features: null, successRate: 0.1 }],
    industryFeatures: null,
    contextLine: '',
    kit: {},
    channel: 'LMS',
  });
  assert.strictEqual(suffix.includes('우리 회사 대표 문안'), true);
}

console.log('copy-prompt-composer.verify PASS');
```

- [ ] **Step 2: 실패 확인**

Run: `cd packages/backend && node -r ts-node/register src/utils/__tests__/copy-prompt-composer.verify.ts`
Expected: FAIL — `buildCopyBrainPrompt`가 `industryFeatures` 인자 미지원

- [ ] **Step 3: buildCopyBrainPrompt 시그니처 + 업종 섹션 교체**

`:50-105` 의 `buildCopyBrainPrompt` opts에 `industryFeatures` 추가하고, industry 원문 블록(`:71-77`)을 통계 안내로 교체:

```typescript
export function buildCopyBrainPrompt(opts: {
  examples: CopyExample[];
  industryFeatures?: { sampleCount: number; avgLengthChars: number; avgSentenceCount: number; hasCtaRatio: number } | null;
  contextLine: string;
  kit: BrandKit;
  channel: string;
}): string {
  const { examples, industryFeatures, contextLine, kit } = opts;
  const parts: string[] = [];

  if (contextLine && contextLine.trim()) {
    parts.push(`## 발송 맥락\n${contextLine.trim()}\n위 맥락이 자연스럽게 어울리면 반영하되, 억지로 끼워넣지 마세요.`);
  }

  const company = examples.filter((e) => e.source === 'company');

  if (company.length > 0) {
    const list = company.map((e, i) => `${i + 1}. ${e.text}`).join('\n');
    parts.push(`## 우리 회사에서 반응이 좋았던 문안 (톤·구조 참고용 — 본문을 그대로 베끼지 말 것)\n${list}`);
  }

  // ★ A6: 같은 업종은 원문이 아니라 구조·통계만 (타사 시그니처 누출 0)
  if (industryFeatures && industryFeatures.sampleCount > 0) {
    const f = industryFeatures;
    parts.push(
      `## 같은 업종 ${f.sampleCount}건의 구조 통계 (참고만 — 타사 문장·표현은 절대 주어지지 않습니다)\n` +
      `- 평균 길이: 약 ${f.avgLengthChars}자\n` +
      `- 평균 문장 수: 약 ${f.avgSentenceCount}개\n` +
      `- 행동 유도(CTA) 포함 비율: ${Math.round(f.hasCtaRatio * 100)}%\n` +
      '위는 같은 업종이 통하는 길이·구조의 통계일 뿐입니다. 이 통계를 참고하되 문안은 우리 브랜드 보이스로 완전히 새로 작성하세요.',
    );
  }
```

(이하 시그니처/슬로건/required/banned 블록 `:79-101` 은 그대로 유지.)

- [ ] **Step 4: 통과 확인**

Run: `cd packages/backend && node -r ts-node/register src/utils/__tests__/copy-prompt-composer.verify.ts`
Expected: `copy-prompt-composer.verify PASS`

- [ ] **Step 5: composeCopyBrain 게이트 연결**

`composeCopyBrain`(`:108-149`)에서 (1) 브랜드보이스 등록 여부 판정 → retrieveCopyExamples에 전달, (2) industryFeatures를 buildCopyBrainPrompt에 전달. import에 `getBrandVoiceStatus`(brand-voice-prompt) 추가:

```typescript
  // ★ A6: 등록 회사면 업종 폴백 OFF
  let brandVoiceRegistered = false;
  try {
    const st = await getBrandVoiceStatus(input.companyId);
    brandVoiceRegistered = st.hasGuideline; // 가이드라인 존재 = 등록
  } catch { /* 실패 시 미등록 취급 — 안전 */ }

  let examples: CopyExample[] = [];
  let industryFeatures = null as null | ReturnType<typeof summarizeIndustryFeatures>;
  try {
    const res = await retrieveCopyExamples({
      companyId: input.companyId,
      industryCode,
      channels: input.channels,
      isAd: input.isAd,
      brandVoiceRegistered,
    });
    examples = res.examples;
    industryFeatures = res.industryFeatures;
  } catch (err) {
    console.warn('[copy-brain] 성과 문안 검색 실패 — 예시 없이 진행:', (err as Error)?.message);
  }
```

그리고 `buildCopyBrainPrompt({ examples, industryFeatures, contextLine, kit, channel })` 로 호출 교체. import 추가: `import { summarizeIndustryFeatures } from './copy-rag-retriever';` (이미 `retrieveCopyExamples` import 중 — 같은 라인에 합침).

- [ ] **Step 6: tsc 검증**

Run: `cd packages/backend && node node_modules/typescript/lib/tsc.js --noEmit`
Expected: 0 errors

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/utils/copy-prompt-composer.ts packages/backend/src/utils/__tests__/copy-prompt-composer.verify.ts
git commit -m "feat(copy): composer 업종 원문→features 통계 교체 + 등록 회사 격리 게이트 연결 (누출 0) + TDD"
```

---

## Phase 5 — 멀티패스 자가비평 (단일 호출 = 추가 차감 0)

근거: 설계서 A2. **별도 API 호출 X** — 한 번의 callAIWithFallback 안에서 모델이 초안→자가비평→정정을 내부 수행하고 최종 3개만 출력. 크레딧·과금 변동 0(돈 안전). `BRAND_SYSTEM_PROMPT`에 자가비평 절차를 추가하는 방식.

### Task 9: 단일 호출 자가비평 지시 추가

**Files:**
- Modify: `packages/backend/src/services/ai.ts` `generateMessages` userMessage `## 요청사항` 블록 (Task 6에서 만든 영역 바로 뒤)

- [ ] **Step 1: 자가비평 지시 삽입**

`## 요청사항` 블록 끝(개인화 설정 블록 `:1160` 앞)에 자가비평 절차 추가:

```typescript

## 작성 절차 (반드시 따르되, 과정은 출력하지 말 것)
1) 먼저 A/B/C 초안을 머릿속으로 작성한다.
2) 각 초안을 스스로 점검한다: 후크가 첫 줄에서 시선을 끄는가 / (혜택이 있다면) 혜택이 주인공인가 / 회사 브랜드보이스와 톤이 맞는가 / 채널 한도(SMS는 밀도)를 지키는가 / 없는 사실·혜택을 지어내지 않았는가.
3) 점검에서 약한 부분을 고친 **최종 3개만** 지정된 JSON 형식으로 출력한다. (점검 과정·설명은 절대 출력하지 말 것)
```

- [ ] **Step 2: tsc 검증**

Run: `cd packages/backend && node node_modules/typescript/lib/tsc.js --noEmit`
Expected: 0 errors

- [ ] **Step 3: 회귀 확인 — 기존 JSON 파싱 안전망 유지**

`generateMessages`는 `extractJsonFromAiText`(`:1199`)로 코드펜스/설명 혼입을 이미 방어 — 자가비평 과정 텍스트가 새도 JSON만 추출됨. 별도 코드 변경 불요. 확인만.

Run: `grep -n "extractJsonFromAiText" packages/backend/src/services/ai.ts`
Expected: 존재 확인 (`:1199` 인접)

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/services/ai.ts
git commit -m "feat(copy): generateMessages 단일 호출 자가비평 절차 (추가 차감 0)"
```

---

## Phase 6 — 출력 누출/금지어 가드 (시그니처 2차 안전망)

근거: 설계서 A6 끝 + ② 확인 결과 — `checkCopyLeak`는 email-ai에만, `findBannedWords`는 운영 호출 0. SMS/캠페인 생성 출력에도 금지어 가드 + 누출 로깅 배선. (A6에서 업종 원문을 이미 프롬프트에서 뺐으므로 누출 위험은 구조적으로 낮음 — 여기선 금지어 제거 + 로깅 중심.)

### Task 10: generateMessages 출력 금지어 가드

**Files:**
- Modify: `packages/backend/src/services/ai.ts` `generateMessages` 변형 후처리 루프(`:1202-1245` 인접) + import

- [ ] **Step 1: import 추가**

```typescript
import { findBannedWords } from '../utils/copy-similarity-guard';
```

- [ ] **Step 2: 브랜드 키트 금지어 확보**

`composeCopyBrain` 호출부(`:1176-1181`)에서 brain 결과 외에 금지어를 얻어야 함. `composeCopyBrain` 반환에 `bannedWords`를 추가하거나, 이미 `getBrandGuideline`을 generateMessages에서 별도 조회. 최소 변경: `composeCopyBrain` `ComposeResult`에 `bannedWords: string[]` 추가(kit.bannedWords 그대로 노출):

`copy-prompt-composer.ts ComposeResult`:
```typescript
export interface ComposeResult {
  promptSuffix: string;
  examples: CopyExample[];
  bannedWords: string[]; // ★ 출력 가드용
}
```
`composeCopyBrain` 반환: `return { promptSuffix, examples, bannedWords: kit.bannedWords || [] };`

- [ ] **Step 3: 변형 후처리에 금지어 제거**

`generateMessages`에서 brain 결과의 bannedWords를 변수로 받고(`:1181` 인접 `const bannedWords = brain.bannedWords;`), 변형 후처리 루프(`:1224` `(variant as any).message_text = msgField;` 직후)에 추가:

```typescript
        // ★ ② 출력 금지어 가드 — 브랜드 키트 banned_words 제거
        if (bannedWords && bannedWords.length > 0) {
          const hit = findBannedWords(msgField, bannedWords);
          if (hit.length > 0) {
            for (const w of hit) msgField = msgField.split(w).join('');
            msgField = msgField.replace(/  +/g, ' ').trim();
            (variant as any).message_text = msgField;
            console.log(`[copy-guard] 금지어 제거: ${hit.join(', ')}`);
          }
        }
```

(brain은 try 블록 안에서만 정의됨 — bannedWords 변수를 `let bannedWords: string[] = [];`로 try 밖 선언 후 try 안에서 할당해 스코프 정합.)

- [ ] **Step 4: tsc 검증**

Run: `cd packages/backend && node node_modules/typescript/lib/tsc.js --noEmit`
Expected: 0 errors

- [ ] **Step 5: console.log(stdout) 확인 — console.error/warn 진단 의존 금지 정합**

Run: `grep -n "copy-guard" packages/backend/src/services/ai.ts`
Expected: `console.log` 사용 (stdout)

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/services/ai.ts packages/backend/src/utils/copy-prompt-composer.ts
git commit -m "feat(copy): 출력 금지어 가드 배선 (findBannedWords) — SMS/캠페인 생성 안전망"
```

---

## Phase 7 — 꾸미기 컬럼 체크 정합 (3개 변형 + 체크집합 정확)

근거: 설계서 A7. 단일 message → 3개 배열, selectedVars = 체크=무조건 포함·해제=제거(현재 "억지로 X" → "체크집합 정확 반영"). 꾸미기 1회(3개) = 3크레딧(액션 단위).

### Task 11: decorator 다중 메시지 + 체크집합 정확 반영

**Files:**
- Modify: `packages/backend/src/utils/operator-message-decorator.ts`

- [ ] **Step 1: 프롬프트 규칙 교체 (체크=포함·해제=제거)**

`:46` 의 "모든 변수를 억지로 넣지 말고..." 라인을 정확집합 규칙으로 교체:

```typescript
    '- 다음 변수는 모두 본문에 반드시 포함한다(자연스러운 위치에 녹임, 누락 금지): ' + varTokens,
    '- 위 목록에 없는 %변수%는 본문에서 모두 제거한다(다른 변수 신규 생성 금지).',
```

- [ ] **Step 2: 3개 배열 처리 함수 추가**

`decorateOperatorMessage`(단일) 아래에 배열 처리 함수 추가 — 같은 selectedVars를 3개 전부에 적용:

```typescript
/** 생성된 여러 변형에 동일 컬럼 체크집합을 일괄 적용 (꾸미기 1회=3개 처리, 액션당 1회 차감) */
export async function decorateOperatorMessages(
  input: Omit<DecorateMessageInput, 'message'> & { messages: string[] },
): Promise<string[]> {
  const msgs = (input.messages || []).filter((m) => typeof m === 'string' && m.trim().length >= 5);
  if (msgs.length === 0) throw new Error('꾸밀 메시지가 없습니다.');
  const out: string[] = [];
  for (const m of msgs) {
    out.push(await decorateOperatorMessage({ ...input, message: m }));
  }
  return out;
}
```

- [ ] **Step 3: tsc 검증**

Run: `cd packages/backend && node node_modules/typescript/lib/tsc.js --noEmit`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/utils/operator-message-decorator.ts
git commit -m "feat(copy): 꾸미기 3개 변형 일괄 + 체크집합 정확 반영(포함/제거)"
```

### Task 12: decorate-message endpoint 3개 처리 (1액션=3크레딧)

**Files:**
- Modify: `packages/backend/src/routes/ai.ts:3181-3212`

- [ ] **Step 1: messages[] 수용 + 크레딧 1회**

`:3192-3207` 교체 — `messages`(배열) 우선, 없으면 단일 `message` 호환. 크레딧은 디코레이터 source('ai-operator-decorate')가 호출당 차감하므로, 3개를 **한 번의 묶음 차감**으로 만들려면 `runInCreditBundle`로 감싼다(continuous-operator.ts:635 패턴). import에 `runInCreditBundle` 추가(이미 ai.ts 내 정의/노출 여부 grep 후, 없으면 동일 모듈 경로에서):

```typescript
    const { messages, message, selectedVars, channel, isAd } = req.body || {};
    const list: string[] = Array.isArray(messages)
      ? messages.map((m: any) => String(m || ''))
      : (message ? [String(message)] : []);
    if (list.length === 0 || list.some((m) => m.trim().length < 5)) {
      return res.status(400).json({ success: false, error: '꾸밀 메시지가 너무 짧습니다.' });
    }
    if (!Array.isArray(selectedVars) || selectedVars.length === 0) {
      return res.status(400).json({ success: false, error: '활용할 컬럼을 1개 이상 선택해주세요.' });
    }
    const decoratedList = await runInCreditBundle(() => decorateOperatorMessages({
      companyId,
      messages: list,
      selectedVars: selectedVars.map((v: any) => String(v)),
      channel: ['sms', 'lms', 'mms'].includes(channel) ? channel : 'lms',
      isAd: !!isAd,
      userId: userId || undefined,
    }));
    return res.json({ success: true, messages: decoratedList, message: decoratedList[0] });
```

import 라인(`:106`) 교체: `import { decorateOperatorMessage, decorateOperatorMessages } from '../utils/operator-message-decorator';`

- [ ] **Step 2: runInCreditBundle 존재 확인 (없으면 단순 묶음 대체)**

Run: `grep -rn "runInCreditBundle" packages/backend/src/`
Expected: 정의 위치 확인. ai.ts에서 import 가능 경로 확정. (없거나 import 불가하면: 디코레이터를 한 번의 callAIWithFallback로 3개를 같이 처리하도록 변경하는 대안을 별도 검토 — 단, 본 plan은 runInCreditBundle 존재 전제.)

- [ ] **Step 3: tsc 검증**

Run: `cd packages/backend && node node_modules/typescript/lib/tsc.js --noEmit`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/routes/ai.ts
git commit -m "feat(copy): decorate-message 3개 변형 묶음 처리 (1액션=1차감)"
```

### Task 13: 프론트 — 사용 변수 자동체크 + 토글 + 3개 적용

**Files:**
- Modify: `packages/frontend/src/pages/AiOperatorPage.tsx` (꾸미기 칩·decorate 호출부)

- [ ] **Step 1: 생성 직후 사용 변수 자동체크**

생성된 메시지(들)에서 `%변수%`를 정규식(`/%([^%]+)%/g`)으로 추출해 칩 체크 상태(state)에 자동 반영. (정확한 state/칩 컴포넌트 위치는 `grep -n "selectedVars\|decorate\|%변수%\|칩\|chip" AiOperatorPage.tsx` 로 식별 후, 생성 핸들러 성공 분기에 추출·setChecked 추가.)

```tsx
// 생성 성공 후
const used = new Set<string>();
for (const v of (result.variants || [])) {
  for (const m of String(v.message_text || '').matchAll(/%([^%]+)%/g)) used.add(m[1]);
}
setCheckedVars((prev) => Array.from(new Set([...prev, ...used])));
```

- [ ] **Step 2: 꾸미기 호출 시 체크집합 + 3개 전달**

decorate 호출을 단일 message → `messages`(3개 변형) + `selectedVars`(체크집합)로 변경하고, 응답 `messages`로 3개 변형 전부 갱신:

```tsx
const res = await fetch('/api/ai/operator/decorate-message', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...authHeader },
  body: JSON.stringify({
    messages: variants.map((v) => v.message_text),
    selectedVars: checkedVars,
    channel: channelLower,
    isAd,
  }),
});
const data = await res.json();
if (data.success && Array.isArray(data.messages)) {
  setVariants((prev) => prev.map((v, i) => ({ ...v, message_text: data.messages[i] ?? v.message_text })));
}
```

- [ ] **Step 3: 프론트 tsc 검증**

Run: `cd packages/frontend && node node_modules/typescript/lib/tsc.js --noEmit`
Expected: 0 errors

- [ ] **Step 4: 자가 grep — 모델명/native dialog 0건**

Run: `grep -nE "Opus|Sonnet|GPT|Claude|alert\(|confirm\(|prompt\(" packages/frontend/src/pages/AiOperatorPage.tsx`
Expected: 0 (신규 추가분 기준 — 기존 잔존은 별도)

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/pages/AiOperatorPage.tsx
git commit -m "feat(copy): 꾸미기 칩 자동체크 + 체크집합 전달 + 3개 변형 일괄 적용"
```

---

## 최종 검증 (Phase 전체 후)

- [ ] **백엔드 tsc 0**: `cd packages/backend && node node_modules/typescript/lib/tsc.js --noEmit`
- [ ] **프론트 tsc 0**: `cd packages/frontend && node node_modules/typescript/lib/tsc.js --noEmit`
- [ ] **순수 테스트 전부 통과**:
  - `cd packages/backend && node node_modules/vitest/vitest.mjs run src/utils/copy-benefit-detector.test.ts`
  - `cd packages/backend && node -r ts-node/register src/utils/__tests__/copy-rag-retriever.verify.ts`
  - `cd packages/backend && node -r ts-node/register src/utils/__tests__/copy-prompt-composer.verify.ts`
  - 기존 `src/utils/copy-similarity-guard.test.ts` 회귀 통과
- [ ] **자가 grep 0건**: 모델명(Opus/Sonnet/GPT/Claude) · native dialog(alert/confirm/prompt) · 박-단어(박음/박힘/박는/박지/박을/박혀/박힌/박혔/박힐/박았) — 신규/수정 파일 전체
- [ ] **혜택 날조 0 확인**: 시스템 프롬프트·디코레이터에 구체 혜택(%/원/쿠폰/무료) 하드코딩 0 (감지·금지 문구만)
- [ ] **DB ALTER 0 확인**: 신규 컬럼·테이블 0 (information_schema 검증 불요)
- [ ] **propose 자동 반영 확인**: `ai-orchestrator.ts`가 `generateMessages`를 그대로 호출 — A1~A6 자동 적용(코드 변경 0)
- [ ] **실측 1건 시나리오 (Harold)**: 등록 회사 1곳·미등록 회사 1곳에서 (1)혜택 입력 생성 (2)혜택 미입력 생성 (3)꾸미기 3개 → 톤·강조·누출 0 육안 확인. propose에서도 동일.

---

## Self-Review 체크

**Spec coverage:** A1(Task6)·A2(Task9)·A3(Task6)·A4(Task6)·A5(propose 자동, Task6/8 자동반영)·A6(Task7·8)·A7(Task11·12·13)·B1(설계서 기재 SQL 결과)·B2-1(Task1)·B2-2(Task2)·B2-3(경계: 보이스=brand-voice-prompt / 두뇌=composer 유지)·② 출력가드(Task10)·대표문안 5→10(Task1·3). B2-4(추출기 톤 형용사 깊이 강화)는 **별도 후속**(추출기 강화는 설계서 §5 별도 항목 — 본 plan 범위 외, 필요 시 Phase 8로 추가).

**Placeholder scan:** 정확 위치 grep 안내가 붙은 곳(AiMemoryPage 5→10 위치·AiOperatorPage 칩 state·runInCreditBundle 존재)은 "코드를 보여주되 정확 anchor는 구현자가 grep 확정" — 본 레포는 해당 파일이 크고 라인 변동이 잦아 grep-anchor가 안전. 나머지는 전부 실코드 제공.

**Type consistency:** `BenefitDetectResult`·`IndustryFeatureSummary`·`ComposeResult.bannedWords`·`BrandVoiceStatus`·`decorateOperatorMessages` 시그니처 전 Task 일관. `rankExamples` 5th arg(brandVoiceRegistered)·`retrieveCopyExamples` 입력/반환 신규 필드 전 호출부 정합(optional이라 미연결 단계서도 tsc 통과).
