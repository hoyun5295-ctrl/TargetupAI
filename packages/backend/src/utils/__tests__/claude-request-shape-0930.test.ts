/**
 * Claude 모델별 요청 형태 CT (2026-09-30 · Harold 결정 B = 문안 Sonnet 5.5 · 정밀 Opus 5.5)
 *
 * 못 박는 것 = 운영 키 실측(0930 Harold 서버 · API 원문):
 *   - Sonnet 5.5: thinking disabled → 400("between_tools 로 보내라") · between_tools OK(생각 0) · adaptive OK · temperature → 400(deprecated)
 *   - Opus 5.5: thinking disabled → 400(미지원) · adaptive + effort low OK · adaptive + effort high OK · temperature → 400
 *   - 지금 운영(Sonnet 5 · Opus 4.8) 형태는 0701 이래 그대로(되돌리기 경로)
 *   - 모르는 모델 = 새 모델이 모두 받는 형태(adaptive · temperature 없음)
 */
import { describe, it, expect } from 'vitest';
import { AI_MODELS, claudeModelFamily, claudeRequestShape, gptRequestShape, resolveMaxTokens } from '../../config/defaults';

describe('모델 판정(허용 목록)', () => {
  it('새 모델 · 지금 운영 · 옛 모델 · 모르는 모델을 가른다', () => {
    expect(claudeModelFamily('claude-sonnet-5-5')).toBe('sonnet_5_5');
    expect(claudeModelFamily('claude-opus-5-5')).toBe('opus_5_5');
    expect(claudeModelFamily('claude-sonnet-5')).toBe('adaptive_v1');
    expect(claudeModelFamily('claude-opus-4-8')).toBe('adaptive_v1');
    expect(claudeModelFamily('claude-opus-4-7')).toBe('adaptive_v1');
    expect(claudeModelFamily('claude-sonnet-4-5-20250929')).toBe('legacy');
    expect(claudeModelFamily('claude-haiku-4-5-20251001')).toBe('legacy');
    // ⛔ 옛 정규식은 'sonnet-5' 부분 문자열로 잡았다 — 5.5 는 5 와 다른 형태를 받는다.
    expect(claudeModelFamily('claude-sonnet-5-5')).not.toBe('adaptive_v1');
    expect(claudeModelFamily('claude-fable-5-1')).toBe('unknown');
    expect(claudeModelFamily('')).toBe('unknown');
  });
  it('기본값 = 최신 모델(문안 Sonnet 5.5 · 정밀 Opus 5.5) — .env 에 모델 키가 없으면 이 값으로 돈다(0930 실측)', () => {
    if (!process.env.CLAUDE_MODEL) expect(AI_MODELS.claude).toBe('claude-sonnet-5-5');
    if (!process.env.CLAUDE_OPUS_MODEL) expect(AI_MODELS.opus).toBe('claude-opus-5-5');
  });
});

describe('요청 형태 = 실측이 받은 모양만', () => {
  it('Sonnet 5.5: 끄기 = between_tools · 켜기 = adaptive · temperature 없음', () => {
    expect(claudeRequestShape('claude-sonnet-5-5', { temperature: 0.7 })).toEqual({ thinking: { type: 'between_tools' } });
    expect(claudeRequestShape('claude-sonnet-5-5', { temperature: 0.1, thinking: true })).toEqual({ thinking: { type: 'adaptive' } });
  });
  it('Opus 5.5: 끄기 불가 → adaptive + effort low · 켜기 = adaptive · temperature 없음', () => {
    expect(claudeRequestShape('claude-opus-5-5', { temperature: 0.3 })).toEqual({ thinking: { type: 'adaptive' }, output_config: { effort: 'low' } });
    expect(claudeRequestShape('claude-opus-5-5', { thinking: true })).toEqual({ thinking: { type: 'adaptive' } });
  });
  it('지금 운영(Sonnet 5 · Opus 4.8) 형태는 0701 이래 그대로 — 되돌리기 경로', () => {
    expect(claudeRequestShape('claude-sonnet-5', { temperature: 0.7 })).toEqual({ thinking: { type: 'disabled' } });
    expect(claudeRequestShape('claude-opus-4-8', { thinking: true })).toEqual({ thinking: { type: 'adaptive' } });
  });
  it('옛 모델만 temperature(생각 켜면 1) · enabled+예산', () => {
    expect(claudeRequestShape('claude-haiku-4-5-20251001', { temperature: 0.3 })).toEqual({ temperature: 0.3 });
    expect(claudeRequestShape('claude-haiku-4-5-20251001', { temperature: 0.3, thinking: true, thinkingBudget: 2000 }))
      .toEqual({ temperature: 1, thinking: { type: 'enabled', budget_tokens: 2000 } });
  });
  it('모르는 모델 = adaptive · temperature 없음(틀려도 400 이 아니라 생각 토큰을 더 쓰는 쪽)', () => {
    expect(claudeRequestShape('claude-fable-5-1', { temperature: 0.7 })).toEqual({ thinking: { type: 'adaptive' } });
  });
  it('어떤 새 모델에도 disabled 를 보내지 않는다(0930 실측 400)', () => {
    for (const m of ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1']) {
      expect(JSON.stringify(claudeRequestShape(m))).not.toContain('disabled');
      expect(claudeRequestShape(m, { temperature: 0.5 })).not.toHaveProperty('temperature');
    }
  });
});

describe('출력 한도 여유(상한일 뿐)', () => {
  it('Sonnet 5.5 = 1.5배 · Opus 5.5 · 모르는 모델 = 생각 토큰 몫(2배와 +1024 중 큰 값) · 상한 16000 · 옛 모델 그대로', () => {
    expect(resolveMaxTokens(1000, 'claude-sonnet-5-5')).toBe(1500);
    expect(resolveMaxTokens(200, 'claude-opus-5-5')).toBe(1224);
    expect(resolveMaxTokens(4096, 'claude-opus-5-5')).toBe(8192);
    expect(resolveMaxTokens(12000, 'claude-opus-5-5')).toBe(16000);
    expect(resolveMaxTokens(1000, 'claude-haiku-4-5-20251001')).toBe(1000);
    expect(resolveMaxTokens(1000, 'claude-sonnet-5')).toBe(1500);
  });
});

describe('GPT 대체 = 최신(gpt-6-luna) · temperature 는 옛 계열만(0930 실측)', () => {
  it('기본값 = gpt-6-luna(문안 · AI Operator 둘 다)', () => {
    if (!process.env.GPT_MODEL) expect(AI_MODELS.gpt).toBe('gpt-6-luna');
    if (!process.env.GPT_OPERATOR_MODEL) expect(AI_MODELS.gptOperator).toBe('gpt-6-luna');
  });
  it('최신 · 모르는 GPT 는 temperature 를 싣지 않는다(실측 400) · 옛 계열만 싣는다', () => {
    for (const m of ['gpt-6-luna', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6.1-sol', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-9-x']) {
      expect(gptRequestShape(m, { temperature: 0.3 }), m).toEqual({});
    }
    expect(gptRequestShape('gpt-4o', { temperature: 0.3 })).toEqual({ temperature: 0.3 });
    expect(gptRequestShape('gpt-4.1-mini', { temperature: 0.2 })).toEqual({ temperature: 0.2 });
    expect(gptRequestShape('gpt-4o')).toEqual({});
  });
});
