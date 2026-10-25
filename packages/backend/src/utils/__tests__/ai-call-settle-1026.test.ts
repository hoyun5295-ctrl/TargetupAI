/**
 * ★ 2026-10-26 Codex 1R(돈 묶음 #4 · #5) — AI 공용 호출(callAIWithFallback)의 성공 뒤 차감 순서.
 *   ① 정산 예외(잔액 부족 402 · 원장 쓰기 실패 503)는 공급자 실패가 아니다 → 대체 AI 호출 0 · 원형 그대로 던진다.
 *   ② 캐시 = 정산이 끝난 결과만(옛: 정산 전에 넣어, 돌려주지 않은 결과를 같은 요청이 5분 동안 무료로 받았다).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  claude: vi.fn(),
  gpt: vi.fn(),
  settle: vi.fn(),
  checkCredit: vi.fn(async () => undefined),
  setCache: vi.fn(),
  getCache: vi.fn(() => null),
  order: [] as string[],
}));
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create: m.claude }; } }));
vi.mock('openai', () => ({ default: class { chat = { completions: { create: m.gpt } }; } }));
vi.mock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [] })), pool: { query: vi.fn(async () => ({ rows: [] })), connect: vi.fn() } }));
vi.mock('../ai-rate-limit', () => ({ checkAiRateLimit: vi.fn(async () => undefined), isAiCallLimitExempt: () => false, recordAiCall: vi.fn(async () => 'log-1') }));
vi.mock('../ai-cache', () => ({
  generateCacheKey: () => 'k1',
  getCachedResponse: (...a: any[]) => (m.getCache as any)(...a),
  setCachedResponse: (...a: any[]) => { m.order.push('cache'); return (m.setCache as any)(...a); },
}));
vi.mock('../ai-credit', async (orig) => ({
  ...(await orig<any>()),
  checkCredit: (...a: any[]) => (m.checkCredit as any)(...a),
  settleCreditAfterSuccess: (...a: any[]) => { m.order.push('settle'); return (m.settle as any)(...a); },
}));

import { callAIWithFallback } from '../../services/ai';
import { InsufficientCreditError, CreditSettleError } from '../ai-credit';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const call = () => callAIWithFallback({ system: 's', userMessage: 'u', maxTokens: 100, companyId: COMPANY, source: 'test-source', creditCost: 3 } as any);
const claudeOk = { content: [{ type: 'text', text: '결과' }], usage: { input_tokens: 1, output_tokens: 1 } };

describe('AI 공용 호출 — 정산 예외는 공급자 실패가 아니다 · 캐시는 정산 뒤', () => {
  beforeEach(() => {
    m.claude.mockReset(); m.gpt.mockReset(); m.settle.mockReset(); m.setCache.mockReset(); m.order.length = 0;
    process.env.OPENAI_API_KEY = 'test-key-not-real';
  });
  it('잔액 부족(402) = 그대로 던진다 · 대체 AI 호출 0 · 캐시 0', async () => {
    m.claude.mockResolvedValue(claudeOk);
    m.settle.mockRejectedValue(new InsufficientCreditError(3, 0));
    await expect(call()).rejects.toBeInstanceOf(InsufficientCreditError);
    expect(m.gpt).not.toHaveBeenCalled();
    expect(m.setCache).not.toHaveBeenCalled();
  });
  it('원장 쓰기 실패(503) = 그대로 던진다 · 대체 AI 호출 0 · 캐시 0', async () => {
    m.claude.mockResolvedValue(claudeOk);
    m.settle.mockRejectedValue(new CreditSettleError());
    await expect(call()).rejects.toBeInstanceOf(CreditSettleError);
    expect(m.gpt).not.toHaveBeenCalled();
    expect(m.setCache).not.toHaveBeenCalled();
  });
  it('정산 성공 = 결과 · 캐시는 정산 뒤 한 번', async () => {
    m.claude.mockResolvedValue(claudeOk);
    m.settle.mockResolvedValue('deducted');
    await expect(call()).resolves.toBe('결과');
    expect(m.order).toEqual(['settle', 'cache']);
  });
  it('대체 경로 결과의 잔액 부족도 402 그대로(옛: AI_DELAYED 503 으로 바뀜)', async () => {
    m.claude.mockRejectedValue(new Error('공급자 장애'));
    m.gpt.mockResolvedValue({ choices: [{ message: { content: '대체 결과' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    m.settle.mockRejectedValue(new InsufficientCreditError(3, 0));
    await expect(call()).rejects.toBeInstanceOf(InsufficientCreditError);
    expect(m.gpt).toHaveBeenCalledTimes(1);
    expect(m.setCache).not.toHaveBeenCalled();
  });
});
