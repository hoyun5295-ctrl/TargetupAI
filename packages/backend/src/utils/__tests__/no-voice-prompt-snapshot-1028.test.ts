/**
 * 목소리 없는 회사 = 지시문 글자 그대로 (★ 2026-10-28 AI 메모리 설계 I15 · K15-1 · docs/2026-10-28-ai-memory-brand-voice-design.md)
 *
 * 묶음 A 가 문자 규칙을 CT(copy-house-rules)로 옮기고 목소리 지시를 composeVoicePrompt 로 모아도
 * 대표 문안 · 가이드라인이 없는 회사가 받는 system · 사용자 메시지는 한 글자도 바뀌지 않아야 한다(법 변경만 예외 · 묶음 0 에서 이미 반영).
 * 스냅숏 = 묶음 0 끝 시점의 실제 generateMessages 호출 인자(AI 공급자 호출 직전 값).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

const sent: Array<{ system: string; user: string }> = [];
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      create: async (p: any) => {
        const system = Array.isArray(p.system) ? p.system.map((b: any) => b.text).join('') : String(p.system);
        sent.push({ system, user: String(p.messages?.[0]?.content ?? '') });
        const v = (id: string) => ({ variant_id: id, variant_name: id, concept: '', message_text: '[한줄 뷰티]\n가을 신상이 들어왔어요.\n지금 만나 보세요.', subject: '한줄 뷰티 신상 안내', score: 80 });
        return { content: [{ type: 'text', text: JSON.stringify({ variants: [v('A'), v('B'), v('C')], recommendation: 'A', recommendation_reason: '' }) }], usage: { input_tokens: 1, output_tokens: 1 } };
      },
    };
  },
}));
vi.mock('../../config/database', () => ({
  default: { query: vi.fn(async () => ({ rows: [] })), connect: vi.fn() },
  query: vi.fn(async () => ({ rows: [] })),
  pool: { query: vi.fn(async () => ({ rows: [] })), connect: vi.fn() },
}));
vi.mock('../ai-rate-limit', async (orig) => ({ ...(await orig<any>()), checkAiRateLimit: vi.fn(async () => {}), recordAiCall: vi.fn(async () => null) }));
vi.mock('../ai-cache', async (orig) => ({ ...(await orig<any>()), getCachedResponse: vi.fn(() => null), setCachedResponse: vi.fn() }));
vi.mock('../ai-credit', async (orig) => ({ ...(await orig<any>()), checkCredit: vi.fn(async () => {}), settleCreditAfterSuccess: vi.fn(async () => {}) }));

import { generateMessages } from '../../services/ai';

describe('I15 목소리 없는 회사 = 지시문 글자 그대로(generateMessages)', () => {
  // 키가 없으면 generateMessages 가 AI 를 부르지 않고 기본 문안을 돌려준다(1148) · 공급자는 위에서 가짜로 바꿨다(도달 불가 값)
  const prevKey = process.env.ANTHROPIC_API_KEY;
  beforeAll(() => { process.env.ANTHROPIC_API_KEY = 'test-not-a-key'; vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-28T03:00:00Z')); });
  afterAll(() => { vi.useRealTimers(); if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prevKey; });

  const target = { total: 1200, avgSpent: 0, avgVisits: 0, topGrade: '', ageRange: '', gender: '' } as any;
  const cases: Array<[string, string, Record<string, unknown>]> = [
    ['lms-ad', '이번 주 가을 신상 20% 할인', { channel: 'LMS', isAd: true, rejectNumber: '080-123-4567', brandName: '한줄 뷰티' }],
    ['sms-ad', '오늘만 특가 안내', { channel: 'SMS', isAd: true, rejectNumber: '080-123-4567', brandName: '한줄 뷰티' }],
    ['lms-notice', '고객님께 감사 인사', { channel: 'LMS', isAd: false, brandName: '한줄 뷰티', voiceKind: 'notice' }],
  ];
  for (const [name, prompt, ctx] of cases) {
    it(name, async () => {
      sent.length = 0;
      await generateMessages(prompt, target, { companyId: '00000000-0000-0000-0000-0000000000aa', ...ctx } as any);
      expect(sent.length).toBeGreaterThan(0);
      await expect(`=== system ===\n${sent[0].system}\n=== user ===\n${sent[0].user}\n`).toMatchFileSnapshot(`./__snapshots__/no-voice-${name}.txt`);
    });
  }
});
