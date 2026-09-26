/**
 * 여정 스팸 사전검사 자동 재작성 — AI가 원본에 없는 혜택을 만들면 그 재작성을 버린다 (★2026-09-26 한줄로 V2 R1-44)
 *
 * 스팸 사전검사에 걸리면 AI 재작성문이 실발송 스냅샷 본문을 **사람 검토 없이** 바꾼다(담당자에게는 안내만).
 * 혜택을 바꾸지 말라는 건 프롬프트 지시뿐이라, 지어낸 혜택(할인율·무료 등)이 그대로 고객에게 나갈 수 있었다(AI 임의 혜택 금지).
 * 처방: 대행 다듬기(agency-send-refine)와 같은 혜택 차단 CT로 판정 — 원본에 없던 혜택이 있으면 재작성 실패(null)로 본다
 *   → 기존 흐름대로 자동 교체 없이 담당자 안내.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const aiMock = vi.fn();
vi.mock('../../services/ai', async (orig) => {
  const actual: any = await orig();
  return { ...actual, callAIWithFallback: (...a: any[]) => (aiMock as any)(...a) };
});
vi.mock('../../config/database', () => ({
  query: vi.fn(async () => ({ rows: [{ company_name: '인비토', brand_tone: '친근함' }] })),
  default: { query: vi.fn(async () => ({ rows: [] })) },
}));
vi.mock('../brand-voice-prompt', () => ({ buildSystemPromptWithBrandVoice: async (_c: string, s: string) => s }));

import { regenerateStepAvoidingSpam } from '../journey-ai-generator';

beforeEach(() => aiMock.mockReset());

describe('여정 자동 재작성 혜택 차단', () => {
  it('원본에 없던 혜택을 만들면 버린다(null)', async () => {
    aiMock.mockResolvedValue('지금 오시면 50% 할인해 드려요');
    const r = await regenerateStepAvoidingSpam({ companyId: 'c1', currentMessage: '지금 오시면 좋은 소식이 있어요', channel: 'sms', isAd: false, matchedStopWords: ['대박'] } as any);
    expect(r).toBeNull();
  });

  it('원본 혜택을 그대로 둔 재작성은 통과', async () => {
    aiMock.mockResolvedValue('이번 주 10% 할인 소식 전해드려요');
    const r = await regenerateStepAvoidingSpam({ companyId: 'c1', currentMessage: '대박 이번 주 10% 할인!!', channel: 'sms', isAd: false, matchedStopWords: ['대박'] } as any);
    expect(r).toContain('10% 할인');
  });
});
