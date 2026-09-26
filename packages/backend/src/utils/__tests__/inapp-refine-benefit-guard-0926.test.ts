/**
 * 인앱 AI 다듬기 — 원본에 없던 혜택이 생긴 안은 변형으로 만들지 않는다 (★2026-09-26 한줄로 V2 R1-45 일부)
 *
 * AI 다듬기가 만든 3안은 검토 없이 active 변형으로 바로 방문자에게 노출된다. 혜택 보존은 프롬프트 지시뿐이라
 * 지어낸 혜택이 그대로 게시될 수 있었다(AI 임의 혜택 금지). 혜택 차단 CT로 판정해 그런 안은 건너뛴다.
 * (검토 단계 신설 = 초안으로 만들기는 제품 동작 변경이라 결정 대기)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const aiMock = vi.fn();
const queryMock = vi.fn();
const createVariantMock = vi.fn(async () => 'v-new');
vi.mock('../../services/ai', () => ({ callAIWithFallback: (...a: any[]) => (aiMock as any)(...a) }));
vi.mock('../../config/database', () => ({ query: (...a: any[]) => (queryMock as any)(...a) }));
vi.mock('../inapp-variant-optimizer', () => ({ createVariant: (...a: any[]) => (createVariantMock as any)(...a) }));
vi.mock('../inapp-funnel-stats', () => ({ buildHourlyDistribution: () => [] }));

import { quickActionAIRefine } from '../inapp-quick-action';

beforeEach(() => {
  aiMock.mockReset(); queryMock.mockReset(); createVariantMock.mockClear();
  queryMock.mockResolvedValue({ rows: [{ id: 'm1', title: '가을 신상 입고', body: '이번 주 10% 할인 중이에요', template: 'popup', buttons: [] }] });
});

describe('AI 다듬기 혜택 차단', () => {
  it('원본에 없던 혜택이 생긴 안은 건너뛰고 나머지만 만든다', async () => {
    aiMock.mockResolvedValue(JSON.stringify({ variants: [
      { tone: '감성적', title: '가을 신상', body: '이번 주 10% 할인으로 만나요' },
      { tone: '실용적', title: '신상 입고', body: '지금 50% 할인 + 무료배송' },
      { tone: '캐주얼', title: '신상 왔어요', body: '10% 할인 놓치지 마세요' },
    ] }));
    const r = await quickActionAIRefine('c1', 'm1', 'u1');
    expect(createVariantMock).toHaveBeenCalledTimes(2);
    const bodies = createVariantMock.mock.calls.map((c: any[]) => c[2].body);
    expect(bodies.join(' ')).not.toContain('50%');
    expect(r.createdVariantIds.length).toBe(2);
  });
});
