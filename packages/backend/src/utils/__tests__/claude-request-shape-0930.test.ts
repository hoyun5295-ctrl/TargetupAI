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
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { AI_MODELS, claudeModelFamily, claudeRequestShape, copyThinkingEnabled, gptRequestShape, resolveMaxTokens } from '../../config/defaults';

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

describe('문안 생성 생각하기 스위치(CLAUDE_COPY_THINKING · 0930 Harold 결정 · 기본 꺼짐)', () => {
  it('값이 없거나 on/1/true/yes 가 아니면 꺼짐 = 지금 동작 그대로', () => {
    const saved = process.env.CLAUDE_COPY_THINKING;
    try {
      delete process.env.CLAUDE_COPY_THINKING;
      expect(copyThinkingEnabled()).toBe(false);
      for (const v of ['off', '0', 'false', '', 'enable']) { process.env.CLAUDE_COPY_THINKING = v; expect(copyThinkingEnabled()).toBe(false); }
      for (const v of ['on', 'ON', '1', 'true', ' yes ']) { process.env.CLAUDE_COPY_THINKING = v; expect(copyThinkingEnabled()).toBe(true); }
    } finally {
      if (saved === undefined) delete process.env.CLAUDE_COPY_THINKING; else process.env.CLAUDE_COPY_THINKING = saved;
    }
  });
  it('켜면 문안 모델은 adaptive(생각) · 끄면 between_tools(0930 실측 형태)', () => {
    expect(claudeRequestShape('claude-sonnet-5-5', { thinking: true })).toEqual({ thinking: { type: 'adaptive' } });
    expect(claudeRequestShape('claude-sonnet-5-5', { thinking: undefined })).toEqual({ thinking: { type: 'between_tools' } });
  });
  it('생각을 켠 호출은 출력 한도에 생각 토큰 몫(2배 · +4096 중 큰 값)을 더한다 — 끈 호출 한도는 그대로', () => {
    expect(resolveMaxTokens(2048, 'claude-sonnet-5-5')).toBe(3072);
    expect(resolveMaxTokens(2048, 'claude-sonnet-5-5', true)).toBe(6144);
    expect(resolveMaxTokens(2048, 'claude-opus-5-5')).toBe(4096);
    expect(resolveMaxTokens(4096, 'claude-opus-5-5', true)).toBe(8192);
    expect(resolveMaxTokens(12000, 'claude-sonnet-5-5', true)).toBe(16000);
    expect(resolveMaxTokens(2048, 'claude-sonnet-4-5-20250929', true)).toBe(2048);
  });
  it('스위치는 기본 · 맞춤 문안 생성에만 · AI Operator(opus) 호출은 따르지 않는다 · 공통 CT 는 thinking 을 한도에 넘긴다', () => {
    const ai = readFileSync(resolve(process.cwd(), 'src', 'services', 'ai.ts'), 'utf8');
    expect((ai.match(/copyThinkingEnabled\(\)/g) || []).length).toBe(2);
    expect(ai).toContain("thinking: extraContext?.model === 'opus' ? undefined : (copyThinkingEnabled() || undefined),");
    const custom = ai.slice(ai.indexOf('export async function generateCustomMessages('), ai.indexOf('export async function countFilteredCustomers('));
    expect(custom).toContain('thinking: copyThinkingEnabled() || undefined,');
    expect(ai).toContain('max_tokens: resolveMaxTokens(params.maxTokens, modelName, params.thinking === true),');
  });
});
