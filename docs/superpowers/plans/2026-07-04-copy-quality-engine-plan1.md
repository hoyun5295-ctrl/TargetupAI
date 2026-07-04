# 문안 퀄리티 엔진 계획 1 — 자기검수 루프 (스키마 변경 0)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline, 순차) — CLAUDE.md no_parallel_tasks로 subagent 병렬 금지. 스텝은 `- [ ]` 체크박스.

**Goal:** 생성된 문안을 도메인 규칙(채널 바이트·구조)·스팸 위험·브랜드 금지어로 채점하고, 미달 시 재생성하는 자기검수 루프를 만들어 모든 문안 생성에 붙인다.

**Architecture:** 순수 컨트롤타워 4개(텍스트 메트릭·스팸 위험·도메인 규칙·통합 채점) + 오케스트레이터 1개(생성→채점→재생성). 전부 fire-safe(실패 시 초안 그대로 반환, 생성 절대 미차단). 스키마 변경 없음, 스팸 사전은 시드 config(추후 오프라인 마이너가 보강).

**Tech Stack:** TypeScript, vitest (`npx vitest run <파일>`). 신규 파일 = `packages/backend/src/utils/`.

**참조 스펙:** docs/superpowers/specs/2026-07-04-copy-quality-engine-design.md (§4.4·4.5·4.8)

---

### Task 1: 텍스트 메트릭 CT (한국어 바이트·구조)

**Files:**
- Create: `packages/backend/src/utils/copy-text-metrics.ts`
- Test: `packages/backend/src/utils/copy-text-metrics.test.ts`

- [ ] **Step 1: 실패 테스트 작성**
```ts
import { describe, it, expect } from 'vitest';
import { smsByteLength, sentenceCount, hasCta } from './copy-text-metrics';

describe('copy-text-metrics', () => {
  it('한글은 2바이트, ASCII는 1바이트로 센다', () => {
    expect(smsByteLength('가나다')).toBe(6);
    expect(smsByteLength('abc')).toBe(3);
    expect(smsByteLength('가a')).toBe(3);
    expect(smsByteLength('')).toBe(0);
  });
  it('문장 수를 센다(구분자 . ! ? 줄바꿈)', () => {
    expect(sentenceCount('안녕하세요. 반갑습니다!')).toBe(2);
    expect(sentenceCount('한 문장')).toBe(1);
    expect(sentenceCount('')).toBe(0);
  });
  it('CTA 힌트 포함 여부를 판정한다', () => {
    expect(hasCta('지금 신청하세요')).toBe(true);
    expect(hasCta('그냥 인사말')).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `cd packages/backend && npx vitest run src/utils/copy-text-metrics.test.ts` · Expected: FAIL (module not found).

- [ ] **Step 3: 최소 구현**
```ts
// copy-text-metrics.ts — 문안 텍스트 메트릭(순수, 의존 0)
const CTA_HINTS = ['지금', '바로', '확인', '방문', '오세요', '받아', '신청', '예약', '클릭', '구매', '주문'];

/** 한국 SMS 바이트 길이(한글/비ASCII=2, ASCII=1). SMS 90 / LMS 2000 판정용 근사. */
export function smsByteLength(text: string): number {
  let n = 0;
  for (const ch of text || '') n += ch.charCodeAt(0) > 0x7f ? 2 : 1;
  return n;
}

export function sentenceCount(text: string): number {
  const t = String(text || '');
  if (!t.trim()) return 0;
  return t.split(/[.!?。\n]/).filter((s) => s.trim().length > 0).length || 1;
}

export function hasCta(text: string, hints: string[] = CTA_HINTS): boolean {
  const t = String(text || '');
  return hints.some((h) => t.includes(h));
}

export { CTA_HINTS };
```

- [ ] **Step 4: 통과 확인** — Run: `cd packages/backend && npx vitest run src/utils/copy-text-metrics.test.ts` · Expected: PASS.

- [ ] **Step 5: 커밋(Harold 수행)** — `copy-text-metrics CT + 테스트` (AI는 커밋 안 함, 표준 종료 멘트로 인계).

---

### Task 2: 스팸 위험 CT (시드 사전 + 스캔)

**Files:**
- Create: `packages/backend/src/utils/copy-spam-risk.ts`
- Test: `packages/backend/src/utils/copy-spam-risk.test.ts`

- [ ] **Step 1: 실패 테스트 작성**
```ts
import { describe, it, expect } from 'vitest';
import { scoreSpamRisk } from './copy-spam-risk';

describe('copy-spam-risk', () => {
  it('스팸 사전 단어가 있으면 위험 점수와 hits를 낸다', () => {
    const r = scoreSpamRisk('지금 대출 무료 당첨 확인');
    expect(r.score).toBeGreaterThan(0);
    expect(r.hits.length).toBeGreaterThan(0);
  });
  it('깨끗한 문안은 위험 0에 가깝다', () => {
    const r = scoreSpamRisk('오늘 신메뉴가 나왔어요. 매장에서 만나요.');
    expect(r.score).toBeLessThan(0.2);
  });
  it('과도한 특수문자에 가산한다', () => {
    expect(scoreSpamRisk('대박!!!!! ★★★★★ 지금!!!').score)
      .toBeGreaterThan(scoreSpamRisk('대박 지금').score);
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `cd packages/backend && npx vitest run src/utils/copy-spam-risk.test.ts` · Expected: FAIL.

- [ ] **Step 3: 최소 구현**
```ts
// copy-spam-risk.ts — 스팸 위험 스캔(순수, 로컬 초고속). 시드 사전은 추후 오프라인 마이너가 보강.
// ⚠️ 로컬 사전은 위험 완화용이며 통신사 실제 판정 보장 아님.
export const SPAM_SEED_LEXICON: string[] = [
  '대출', '도박', '카지노', '바카라', '토토', '성인', '19금',
  '당첨', '경품', '공짜', '무료체험', '보장', '수익', '재테크',
  '몸매', '다이어트보장', '최저가보장', '100%',
];

/** 0~1 스팸 위험 점수 + 걸린 신호. 실제 스팸필터 호출 없음(로컬 대조만). */
export function scoreSpamRisk(text: string): { score: number; hits: string[] } {
  const t = String(text || '');
  if (!t.trim()) return { score: 0, hits: [] };
  const hits: string[] = [];
  for (const w of SPAM_SEED_LEXICON) if (t.includes(w)) hits.push(w);

  let score = Math.min(hits.length * 0.25, 0.8);
  // 과도한 특수문자/느낌표 가산
  const bangs = (t.match(/[!★☆♥♡~]/g) || []).length;
  if (bangs >= 4) score += 0.2;
  else if (bangs >= 2) score += 0.1;

  return { score: Math.min(score, 1), hits };
}
```

- [ ] **Step 4: 통과 확인** — Run: `cd packages/backend && npx vitest run src/utils/copy-spam-risk.test.ts` · Expected: PASS.

- [ ] **Step 5: 커밋(Harold)** — `copy-spam-risk CT(시드 사전) + 테스트`.

---

### Task 3: 도메인 규칙 CT (채널별)

**Files:**
- Create: `packages/backend/src/utils/copy-domain-rules.ts`
- Test: `packages/backend/src/utils/copy-domain-rules.test.ts`

- [ ] **Step 1: 실패 테스트 작성**
```ts
import { describe, it, expect } from 'vitest';
import { checkDomainRules } from './copy-domain-rules';

describe('copy-domain-rules', () => {
  it('SMS 90바이트 초과면 위반', () => {
    const long = '가'.repeat(50); // 100바이트
    const r = checkDomainRules(long, 'SMS');
    expect(r.pass).toBe(false);
    expect(r.violations.some(v => v.includes('바이트'))).toBe(true);
  });
  it('SMS 90바이트 이내 + CTA면 통과', () => {
    const r = checkDomainRules('지금 매장에서 신메뉴 확인하세요', 'SMS');
    expect(r.pass).toBe(true);
  });
  it('CTA 없으면 위반(구조 루브릭)', () => {
    const r = checkDomainRules('오늘 날씨가 좋네요', 'SMS');
    expect(r.violations.some(v => v.includes('행동 유도'))).toBe(true);
  });
  it('LMS는 2000바이트까지 허용', () => {
    const r = checkDomainRules('지금 확인 ' + '가'.repeat(100), 'LMS');
    expect(r.violations.some(v => v.includes('바이트'))).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `cd packages/backend && npx vitest run src/utils/copy-domain-rules.test.ts` · Expected: FAIL.

- [ ] **Step 3: 최소 구현**
```ts
// copy-domain-rules.ts — 채널별 문안 규칙(순수). 광고표기·무료거부는 발송단에서 시스템 부착이라 여기선 미검사.
import { smsByteLength, hasCta } from './copy-text-metrics';

const BYTE_LIMIT: Record<string, number> = { SMS: 90, LMS: 2000, MMS: 2000, KAKAO: 1000 };

export function checkDomainRules(
  text: string,
  channel: string,
): { pass: boolean; violations: string[] } {
  const t = String(text || '');
  const violations: string[] = [];
  const limit = BYTE_LIMIT[channel] ?? 2000;

  const bytes = smsByteLength(t);
  if (bytes > limit) violations.push(`${channel} 바이트 초과(${bytes}/${limit})`);
  if (t.trim().length < 5) violations.push('본문이 너무 짧음');
  if (!hasCta(t)) violations.push('행동 유도(CTA) 표현 없음');

  return { pass: violations.length === 0, violations };
}
```

- [ ] **Step 4: 통과 확인** — Run: `cd packages/backend && npx vitest run src/utils/copy-domain-rules.test.ts` · Expected: PASS.

- [ ] **Step 5: 커밋(Harold)** — `copy-domain-rules CT + 테스트`.

---

### Task 4: 통합 채점 CT

**Files:**
- Create: `packages/backend/src/utils/copy-quality-score.ts`
- Test: `packages/backend/src/utils/copy-quality-score.test.ts`

- [ ] **Step 1: 실패 테스트 작성**
```ts
import { describe, it, expect } from 'vitest';
import { scoreCopy } from './copy-quality-score';

describe('copy-quality-score', () => {
  it('깨끗+규정통과+CTA면 pass', () => {
    const r = scoreCopy({ text: '지금 매장에서 신메뉴 확인하세요', channel: 'SMS', bannedWords: [] });
    expect(r.pass).toBe(true);
    expect(r.feedback.length).toBe(0);
  });
  it('금지어 포함이면 fail + 피드백', () => {
    const r = scoreCopy({ text: '지금 확인하세요', channel: 'SMS', bannedWords: ['확인'] });
    expect(r.pass).toBe(false);
    expect(r.feedback.join()).toContain('금지어');
  });
  it('스팸 위험 높으면 fail', () => {
    const r = scoreCopy({ text: '무료 대출 당첨 지금 신청', channel: 'SMS', bannedWords: [] });
    expect(r.pass).toBe(false);
    expect(r.feedback.join()).toContain('스팸');
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `cd packages/backend && npx vitest run src/utils/copy-quality-score.test.ts` · Expected: FAIL.

- [ ] **Step 3: 최소 구현**
```ts
// copy-quality-score.ts — 도메인 규칙 + 스팸 위험 + 금지어를 통합 채점(순수).
import { checkDomainRules } from './copy-domain-rules';
import { scoreSpamRisk } from './copy-spam-risk';

const SPAM_FAIL_THRESHOLD = 0.5;

export function scoreCopy(input: {
  text: string;
  channel: string;
  bannedWords?: string[];
}): { pass: boolean; total: number; feedback: string[] } {
  const feedback: string[] = [];

  const domain = checkDomainRules(input.text, input.channel);
  feedback.push(...domain.violations);

  const spam = scoreSpamRisk(input.text);
  if (spam.score >= SPAM_FAIL_THRESHOLD) {
    feedback.push(`스팸 위험 높음(${spam.hits.join(', ') || '특수문자 과다'})`);
  }

  const banned = (input.bannedWords || []).filter((w) => w && input.text.includes(w));
  if (banned.length > 0) feedback.push(`금지어 사용: ${banned.join(', ')}`);

  const pass = domain.pass && spam.score < SPAM_FAIL_THRESHOLD && banned.length === 0;
  // total: 1에서 위반·위험 차감(랭킹·로그용)
  const total = Math.max(0, 1 - domain.violations.length * 0.2 - spam.score - banned.length * 0.3);
  return { pass, total, feedback };
}
```

- [ ] **Step 4: 통과 확인** — Run: `cd packages/backend && npx vitest run src/utils/copy-quality-score.test.ts` · Expected: PASS.

- [ ] **Step 5: 커밋(Harold)** — `copy-quality-score 통합 채점 CT + 테스트`.

---

### Task 5: 생성→채점→재생성 루프

**Files:**
- Create: `packages/backend/src/utils/copy-quality-loop.ts`
- Test: `packages/backend/src/utils/copy-quality-loop.test.ts`

- [ ] **Step 1: 실패 테스트 작성**
```ts
import { describe, it, expect } from 'vitest';
import { generateWithQualityLoop } from './copy-quality-loop';

describe('copy-quality-loop', () => {
  it('첫 초안이 통과면 1회로 끝난다', async () => {
    let calls = 0;
    const r = await generateWithQualityLoop({
      channel: 'SMS', bannedWords: [],
      generate: async () => { calls++; return '지금 매장에서 신메뉴 확인하세요'; },
    });
    expect(calls).toBe(1);
    expect(r.text).toContain('신메뉴');
  });
  it('미달이면 피드백 담아 재생성(상한 2 초과 안 함)', async () => {
    let calls = 0;
    const drafts = ['무료 대출 당첨', '무료 대출 당첨', '지금 신메뉴 확인하세요'];
    const r = await generateWithQualityLoop({
      channel: 'SMS', bannedWords: [], maxRounds: 2,
      generate: async () => drafts[calls++] ?? drafts[drafts.length - 1],
    });
    expect(calls).toBe(3); // 초안 1 + 재생성 2
    expect(r.text).toContain('신메뉴');
  });
  it('generate가 throw해도 절대 터지지 않고 마지막/빈 결과 반환', async () => {
    const r = await generateWithQualityLoop({
      channel: 'SMS', bannedWords: [],
      generate: async () => { throw new Error('AI 실패'); },
    });
    expect(typeof r.text).toBe('string');
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `cd packages/backend && npx vitest run src/utils/copy-quality-loop.test.ts` · Expected: FAIL.

- [ ] **Step 3: 최소 구현**
```ts
// copy-quality-loop.ts — 생성→채점→재생성 오케스트레이터. 절대 생성 미차단(실패=초안 폴백).
import { scoreCopy } from './copy-quality-score';

export async function generateWithQualityLoop(input: {
  channel: string;
  bannedWords?: string[];
  maxRounds?: number; // 재생성 상한(기본 2)
  generate: (feedback?: string[]) => Promise<string>;
}): Promise<{ text: string; total: number; rounds: number }> {
  const maxRounds = input.maxRounds ?? 2;
  let best = { text: '', total: -1 };
  let feedback: string[] | undefined;

  for (let round = 0; round <= maxRounds; round++) {
    let draft = '';
    try {
      draft = await input.generate(feedback);
    } catch {
      return { text: best.text, total: Math.max(best.total, 0), rounds: round };
    }
    let s;
    try {
      s = scoreCopy({ text: draft, channel: input.channel, bannedWords: input.bannedWords });
    } catch {
      return { text: draft, total: 0, rounds: round + 1 };
    }
    if (s.total > best.total) best = { text: draft, total: s.total };
    if (s.pass) return { text: draft, total: s.total, rounds: round + 1 };
    feedback = s.feedback;
  }
  return { text: best.text, total: best.total, rounds: maxRounds + 1 };
}
```

- [ ] **Step 4: 통과 확인** — Run: `cd packages/backend && npx vitest run src/utils/copy-quality-loop.test.ts` · Expected: PASS.

- [ ] **Step 5: 전체 신규 테스트 회귀** — Run: `cd packages/backend && npx vitest run src/utils/copy-text-metrics.test.ts src/utils/copy-spam-risk.test.ts src/utils/copy-domain-rules.test.ts src/utils/copy-quality-score.test.ts src/utils/copy-quality-loop.test.ts` · Expected: 전부 PASS.

- [ ] **Step 6: 커밋(Harold)** — `copy-quality-loop 오케스트레이터 + 테스트`.

---

### Task 6: 실제 생성 경로 연결 (안전 폴백) — ★ 착수 전 read 필수

**Files:**
- Read 먼저: `packages/backend/src/services/ai.ts` (composeCopyBrain 사용부 ~1195 + 캠페인 SMS/LMS 생성 호출 지점)
- Modify: 확인된 생성 호출 지점(SMS/LMS 1개 경로부터)
- tsc: `cd packages/backend && npx tsc --noEmit`

- [ ] **Step 1:** 생성 호출 지점을 read로 확정(입력·출력 형태, 어디서 문안 문자열이 나오는지). 인라인 로직 신설 금지 — 위 CT만 import.
- [ ] **Step 2:** 기존 단일 생성 호출을 `generateWithQualityLoop`로 감싼다. `generate: (feedback) => 기존_생성(feedback 있으면 프롬프트 끝에 "다음 문제를 고쳐 다시 작성: <feedback>" 부착)`. channel·bannedWords는 composeCopyBrain 결과(bannedWords)·요청 채널에서 전달.
- [ ] **Step 3:** 전체를 try-catch로 감싸 실패 시 기존 단일 생성 결과로 폴백(생성 절대 미차단).
- [ ] **Step 4:** 우선 SMS/LMS 1개 경로에만 적용(폭발 반경 최소). 다른 채널은 후속.
- [ ] **Step 5:** `npx tsc --noEmit` 0 에러 확인.
- [ ] **Step 6: 커밋(Harold)** — `문안 자기검수 루프를 SMS/LMS 생성에 연결(안전 폴백)`.

---

## Self-Review (작성자 점검)
- 스펙 커버리지: §4.4 도메인 규칙(Task 3)·§4.8 스팸 런타임(Task 2)·§4.5 채점 재생성 루프(Task 4·5)·연결(Task 6). §4.1 랭커/§4.2 탈색/§4.3 검색/§4.6 큐레이션/§4.7 라벨/§4.8 오프라인 마이너 = 계획 2·3.
- Placeholder: Task 1~5 실제 코드·테스트 완비. Task 6은 미열람 코드 의존이라 "read 먼저" 단계로 명시(로직 패턴은 확정).
- 타입 일치: `scoreCopy`·`scoreSpamRisk`·`checkDomainRules`·`generateWithQualityLoop` 시그니처 태스크 간 일관.
- 광고표기/무료거부는 발송단 시스템 부착이라 규칙에서 제외(오검 방지).
