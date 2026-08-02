/**
 * AI 문안 — 여정 맥락 계약 (2026-08-02, 설계서 §13-3)
 *
 * 왜 필요한가
 *   "앞 스텝과 겹치지 않게"는 프롬프트에 앞 문안이 **실제로 들어갔을 때만** 성립한다.
 *   맥락을 넘기는 코드가 조용히 빠져도 응답은 그럴듯하게 나오므로 눈으로는 회귀를 못 잡는다.
 *   그래서 AI에 넘어간 system 프롬프트 자체를 단정한다.
 *
 * 고정하는 것:
 *   1. 빈 본문 + 맥락 없음 → **AI를 부르지 않는다**(지어낼 근거가 없다).
 *   2. 빈 본문 + 맥락 있음 → 생성 모드로 AI를 부르고, 앞 스텝 문안이 프롬프트에 들어간다.
 *   3. 본문 있음 → 다듬기 모드이면서 맥락도 함께 들어간다(둘 중 하나가 아니다).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/database', () => ({ query: vi.fn(), pool: { connect: vi.fn() } }));
vi.mock('../services/ai', () => ({
  callAIWithFallback: vi.fn(),
  getKoreanCalendar: vi.fn(() => ({})),
}));
vi.mock('./company-memory', () => ({ buildMemoryPromptContext: vi.fn(async () => '') }));
vi.mock('./brand-voice-prompt', () => ({ buildSystemPromptWithBrandVoice: vi.fn(async (_c: string, s: string) => s) }));

import { query } from '../config/database';
import { callAIWithFallback } from '../services/ai';
import { refineStepMessage } from './journey-ai-generator';

const q = query as unknown as ReturnType<typeof vi.fn>;
const ai = callAIWithFallback as unknown as ReturnType<typeof vi.fn>;

const COMPANY = '11111111-1111-1111-1111-111111111111';

const AI_JSON = JSON.stringify({
  candidates: [
    { message: '후보1', tone: '감성적', reasoning: 'r' },
    { message: '후보2', tone: '실용적', reasoning: 'r' },
    { message: '후보3', tone: '캐주얼', reasoning: 'r' },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  q.mockResolvedValue({ rows: [] });
  ai.mockResolvedValue(AI_JSON);
});

/** AI에 실제로 넘어간 system 프롬프트. */
const systemPrompt = () => String(ai.mock.calls[0]?.[0]?.system || '');

describe('refineStepMessage — 여정 맥락', () => {
  it('빈 본문 + 맥락 없음이면 AI를 부르지 않는다', async () => {
    const r = await refineStepMessage({ companyId: COMPANY, currentMessage: '', channel: 'lms', isAd: true });
    expect(r.candidates).toEqual([]);
    expect(ai).not.toHaveBeenCalled();
  });

  it('빈 본문이어도 맥락이 있으면 생성 모드로 부른다 — 사람이 먼저 열 글자를 쓰지 않아도 된다', async () => {
    const r = await refineStepMessage({
      companyId: COMPANY,
      currentMessage: '',
      channel: 'lms',
      isAd: true,
      journey: {
        triggerLabel: '첫 구매',
        objective: '첫 구매 고객을 두 번째 구매로',
        stepOrder: 2,
        hoursFromTrigger: 72,
        previousMessages: [{ stepOrder: 1, hoursFromTrigger: 0, message: '첫 구매 감사합니다' }],
      },
    });
    expect(ai).toHaveBeenCalledTimes(1);
    expect(r.candidates.length).toBe(3);

    const sys = systemPrompt();
    expect(sys).toContain('첫 구매');
    expect(sys).toContain('첫 구매 고객을 두 번째 구매로');
    expect(sys).toContain('2번째 스텝');
    expect(sys).toContain('첫 구매 감사합니다');           // 앞 스텝 문안이 실제로 들어갔다
    expect(sys).toContain('아직 비어 있다');                // 생성 모드임을 알린다
  });

  it('본문이 있으면 다듬기 모드지만 맥락은 그대로 함께 간다', async () => {
    await refineStepMessage({
      companyId: COMPANY,
      currentMessage: '다시 만나 반가워요 고객님께 안내드립니다',
      channel: 'lms',
      isAd: true,
      journey: {
        triggerLabel: '휴면 복귀',
        stepOrder: 3,
        hoursFromTrigger: 24,
        previousMessages: [
          { stepOrder: 1, hoursFromTrigger: 0, message: '오랜만입니다' },
          { stepOrder: 2, hoursFromTrigger: 12, message: '다시 찾아주셔서 감사합니다' },
        ],
      },
    });
    const sys = systemPrompt();
    expect(sys).toContain('오랜만입니다');
    expect(sys).toContain('다시 찾아주셔서 감사합니다');
    expect(sys).not.toContain('아직 비어 있다');   // 생성 모드 문구는 붙지 않는다
  });

  it('발송 시점 문구는 화면과 같은 단일 출처를 쓴다 — 72시간이면 3일', async () => {
    await refineStepMessage({
      companyId: COMPANY,
      currentMessage: '',
      channel: 'lms',
      isAd: true,
      journey: { triggerLabel: '첫 구매', stepOrder: 2, hoursFromTrigger: 72, previousMessages: [] },
    });
    expect(systemPrompt()).toContain('트리거 후 3일 뒤');
  });

  it('AI가 지어낸 혜택은 후보에서 placeholder로 되돌린다 — 프롬프트는 경계가 아니다', async () => {
    ai.mockResolvedValue(JSON.stringify({
      candidates: [{ message: '첫 구매 감사합니다. 다음 방문에 30% 할인해 드려요', tone: '실용적', reasoning: 'r' }],
    }));
    const r = await refineStepMessage({
      companyId: COMPANY,
      currentMessage: '',
      channel: 'lms',
      isAd: true,
      journey: { triggerLabel: '첫 구매', objective: '첫 구매 고객을 두 번째 구매로', stepOrder: 1, hoursFromTrigger: 0, previousMessages: [] },
    });
    expect(r.candidates[0].message).not.toContain('30%');
    expect(r.candidates[0].message).toContain('[혜택 안내 — 직접 수정해주세요]');
  });

  it('목적에 혜택을 써도 생성 모드에서는 남기지 않는다 — 목적은 근거가 아니다', async () => {
    ai.mockResolvedValue(JSON.stringify({
      candidates: [{ message: '말씀하신 30% 할인 안내드립니다', tone: '실용적', reasoning: 'r' }],
    }));
    const r = await refineStepMessage({
      companyId: COMPANY,
      currentMessage: '',
      channel: 'lms',
      isAd: true,
      journey: { triggerLabel: '첫 구매', objective: '30% 할인 행사를 알리고 싶어요', stepOrder: 1, hoursFromTrigger: 0, previousMessages: [] },
    });
    expect(r.candidates[0].message).not.toContain('30%');
    expect(r.candidates[0].message).toContain('[혜택 안내 — 직접 수정해주세요]');
  });

  it('사람이 원본 본문에 쓴 혜택은 다듬어도 남는다', async () => {
    ai.mockResolvedValue(JSON.stringify({
      candidates: [{ message: '30% 할인 안내드립니다', tone: '실용적', reasoning: 'r' }],
    }));
    const r = await refineStepMessage({
      companyId: COMPANY,
      currentMessage: '이번 주 30% 할인 행사 안내드려요',
      channel: 'lms',
      isAd: true,
    });
    expect(r.candidates[0].message).toContain('30%');
  });

  it('앞 스텝이 비어 있으면 그 줄을 넣지 않는다 — 빈 라벨은 AI를 헷갈리게 한다', async () => {
    await refineStepMessage({
      companyId: COMPANY,
      currentMessage: '',
      channel: 'lms',
      isAd: true,
      journey: { triggerLabel: '생일', stepOrder: 2, hoursFromTrigger: 0, previousMessages: [{ stepOrder: 1, hoursFromTrigger: 0, message: '   ' }] },
    });
    expect(systemPrompt()).not.toContain('앞 스텝 문안');
  });
});
