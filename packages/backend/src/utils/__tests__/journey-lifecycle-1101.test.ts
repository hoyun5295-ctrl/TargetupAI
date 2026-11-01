/**
 * C3 수명 시험(★ 2026-11-01 여정 재발 방지 배포 2 · 설계서 §3 C3) — 사람 혜택 · 링크가 여정 생산자를 몇 번 지나도 산다
 *
 * 생산자 = 다듬기(refineStepMessage · 쓰기 → 고치기 → 고치기 · 정산 · 출구 포함 실물 함수) · 가짜 AI 는 지어낸 20% 꼴 · 링크 뺀 꼴 · 혜택을 바꿔 쓴 꼴을 돌려준다.
 * 끝: 사람 혜택(값 · 종류 짝) 살아 있음 · 링크 1개 · 자리표시 0 · 지어낸 20% 0 · 후보마다 출구 즉시 검사(check).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../ai-credit', async (orig) => ({
  ...(await orig<any>()),
  checkCredit: async () => undefined,
  runChargedAi: async (o: any) => { const result = await o.run(); return { result, charged: o.accept ? o.accept(result) : true }; },
  settleCreditAfterSuccess: async () => 'not_applicable',
}));
vi.mock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [] })), pool: { connect: vi.fn() } }));
vi.mock('../../services/ai', () => ({ callAIWithFallback: vi.fn(), getKoreanCalendar: vi.fn(() => ({})) }));
vi.mock('../company-memory', () => ({ buildMemoryPromptContext: vi.fn(async () => '') }));
vi.mock('../brand-voice-prompt', () => ({
  VOICE_KIND_BY_STEP: 'by_step', voiceLearned: async () => false, getBrandVoiceSnapshot: async () => null, voiceLearnedOf: () => false, resolveGuidelineFor: () => null,
  getBrandGuideline: async () => null,
  composeVoicePrompt: async (i: { basePrompt: string }) => ({ system: i.basePrompt, guideline: null, shape: null, voiceLearned: false, exampleCount: 0 }),
}));

import { callAIWithFallback } from '../../services/ai';
import { refineStepMessage } from '../journey-ai-generator';
import { parseCopyFacts } from '../journey-copy-facts';

const ai = callAIWithFallback as unknown as ReturnType<typeof vi.fn>;
const HUMAN = '첫 구매 10% 할인쿠폰';
const LINK = 'https://shop.example.invalid/first';
const at = '2026-11-01T00:00:00.000Z';
const facts = parseCopyFacts({ benefits: [{ text: HUMAN, by: 'question', at }], link: { url: LINK, by: 'question', at } });
const answer = (message: string) => JSON.stringify({ candidates: [{ message, tone: '실용적', reasoning: 'r' }] });

beforeEach(() => { vi.clearAllMocks(); });

describe('C3 수명 — 쓰기 → 고치기 → 고치기', () => {
  it('지어낸 20% · 링크 뺀 꼴 · 바꿔 쓴 혜택을 지나도 사람 혜택 · 링크 1개 · 자리표시 0', async () => {
    const journey = { triggerLabel: '신규 가입', objective: '가입 환영', stepOrder: 1, hoursFromTrigger: 0, previousMessages: [] };
    // 1) 쓰기 — AI 가 지어낸 20% 를 쓰고 링크를 빠뜨린다
    ai.mockResolvedValueOnce(answer('가입을 환영해요.\n> 가입 축하 20% 할인쿠폰\n지금 둘러보세요.'));
    const r1 = await refineStepMessage({ companyId: 'co', copyFacts: facts, currentMessage: '', channel: 'lms', isAd: false, journey, variants: 1 } as any);
    expect(r1.candidates).toHaveLength(1);
    let cur = r1.candidates[0].message;
    // 2) 고치기 — AI 가 링크 줄을 지운다(원장 링크가 다시 들어간다)
    ai.mockResolvedValueOnce(answer(cur.split('\n').filter((l) => !l.includes(LINK)).join('\n').replace('가입을 환영해요.', '가입을 진심으로 환영해요.')));
    const r2 = await refineStepMessage({ companyId: 'co', copyFacts: facts, currentMessage: cur, channel: 'lms', isAd: false, journey, variants: 1 } as any);
    expect(r2.candidates).toHaveLength(1);   // 링크 줄을 뺀 안도 원장 링크가 다시 들어가 산다
    cur = r2.candidates[0].message;
    // 3) 고치기 — AI 가 혜택을 「20% 할인」으로 바꿔 쓴다(지어낸 값 = 자리표시 → 원장 혜택으로 채움 · 또는 후보 탈락)
    ai.mockResolvedValueOnce(answer(cur.replace(HUMAN, '가입 축하 20% 할인')));
    const r3 = await refineStepMessage({ companyId: 'co', copyFacts: facts, currentMessage: cur, channel: 'lms', isAd: false, journey, variants: 1 } as any);
    expect(r3.candidates).toHaveLength(1);   // 바꿔 쓴 20% = 자리표시 → 원장 혜택으로 채운 안
    cur = r3.candidates[0].message;

    expect(cur).toContain(HUMAN);
    expect(cur.split(LINK).length - 1).toBe(1);
    expect(cur).not.toMatch(/20%|\[혜택|직접 수정/);
    for (const r of [r1, r2, r3]) for (const c of r.candidates) expect(c.check && (c.check.quick === 'ok' || c.check.quick === 'fix')).toBe(true);
  });
});
