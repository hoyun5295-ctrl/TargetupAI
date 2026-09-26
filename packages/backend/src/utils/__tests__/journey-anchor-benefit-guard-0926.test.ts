/**
 * 날짜축 여정 문안 생성도 AI 혜택 차단기를 지난다 (★ 2026-09-26 한줄로 V2 R259 · AI 임의 혜택 금지)
 *
 * 다른 여정 생성 경로(패키지 생성 636행 · 단계 다듬기 836행)는 `stripUnauthorizedBenefits`로
 * 회사가 준 목표에 없는 혜택을 자리표시로 바꾸는데, 날짜축 단계 문안(`generateAnchorStepMessage`)만
 * 프롬프트 지시뿐이었다(지시는 경계가 아니다).
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
vi.mock('../company-memory', () => ({ buildMemoryPromptContext: async () => '' }));

import { generateAnchorStepMessage } from '../journey-ai-generator';
import { BENEFIT_PLACEHOLDER } from '../copy-benefit-detector';

beforeEach(() => aiMock.mockReset());

describe('날짜축 단계 문안 혜택 차단', () => {
  it('목표에 없는 혜택은 자리표시로 바뀐다(본문·제목)', async () => {
    aiMock.mockResolvedValue(JSON.stringify({ subject: '회원님 30% 할인', message: '%고객명%님, 예약일이 다가옵니다. 지금 30% 할인 쿠폰을 드려요.' }));
    const r = await generateAnchorStepMessage({ companyId: 'c1', objective: '예약일 3일 전 안내', offsetDays: 3 });
    expect(r.message).not.toContain('30% 할인');
    expect(r.message).toContain(BENEFIT_PLACEHOLDER);
    expect(r.subject).not.toContain('30% 할인');
  });

  it('목표에 적힌 혜택은 그대로 둔다', async () => {
    aiMock.mockResolvedValue(JSON.stringify({ subject: '예약 안내', message: '%고객명%님, 방문하시면 10% 할인해 드려요.' }));
    const r = await generateAnchorStepMessage({ companyId: 'c1', objective: '예약일 안내 · 방문 시 10% 할인', offsetDays: 1 });
    expect(r.message).toContain('10% 할인');
  });
});
