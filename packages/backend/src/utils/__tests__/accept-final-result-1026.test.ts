/**
 * ★ 2026-10-26 Codex 1R(돈 묶음 #6 · #7) — AI 결과 정산의 「쓸 결과인가」 = 최종 결과 기준.
 *   꾸미기 = 원문과 같은 글은 바뀐 안이 아니다(그대로면 걷지 않는다) · 변형안 = 거름 뒤 남은 변형이 없으면 걷지 않는다.
 *   정산 함수는 흉내(run → accept 결과만 본다) · 판정 자체는 실제 코드.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({ ai: vi.fn(), accepted: [] as boolean[] }));
vi.mock('../../services/ai', () => ({ callAIWithFallback: (p: any) => m.ai(p) }));
vi.mock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [] })), pool: { query: vi.fn(async () => ({ rows: [] })), connect: vi.fn() } }));
vi.mock('../ai-credit', async (orig) => ({
  ...(await orig<any>()),
  checkCredit: async () => undefined,
  runChargedAi: async (o: any) => { const result = await o.run(); const ok = o.accept(result); m.accepted.push(ok); return { result, charged: ok }; },
}));

import { decorateOperatorMessages } from '../operator-message-decorator';

describe('꾸미기 — 원문 그대로 = 걷지 않는다', () => {
  beforeEach(() => { m.ai.mockReset(); m.accepted.length = 0; });
  const input = (messages: string[]) => ({ companyId: 'c1', messages, selectedVars: ['고객명'], channel: 'lms' as const, isAd: true });
  it('모든 안이 원문 그대로면 kept = 전부 · 걷지 않음', async () => {
    m.ai.mockResolvedValue(JSON.stringify(['가을 신상 안내드려요', '이번 주 할인 소식']));
    const r = await decorateOperatorMessages(input(['가을 신상 안내드려요', '이번 주 할인 소식']));
    expect(r.kept).toEqual([0, 1]);
    expect(r.charged).toBe(false);
  });
  it('하나라도 바뀌면 걷는다 · 바뀌지 않은 안만 kept', async () => {
    m.ai.mockResolvedValue(JSON.stringify(['%고객명%님 가을 신상 안내드려요', '이번 주 할인 소식']));
    const r = await decorateOperatorMessages(input(['가을 신상 안내드려요', '이번 주 할인 소식']));
    expect(r.kept).toEqual([1]);
    expect(r.charged).toBe(true);
  });
});
