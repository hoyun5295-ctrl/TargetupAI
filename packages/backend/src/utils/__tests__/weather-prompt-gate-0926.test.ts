/**
 * 날씨 연결이 없으면 AI에게 날씨 변수를 쓰라고 하지 않는다 (★2026-09-26 한줄로 V2 R1-35 후속)
 *
 * R1-35로 모르는 날씨는 지어내지 않게(null) 됐다 → 날씨 API 키가 없는 서버에서는 {{ weather.* }} 자리가 빈칸으로 나간다.
 * 그런데 여정 AI 지시문은 날씨 변수를 "의무"로 쓰게 했다 → 빈칸 문장("오늘  날씨와 함께")이 만들어진다.
 * 처방: 지시 블록을 날씨 CT가 소유한다(buildWeatherPromptBlock · buildWeatherRefineRule) — 키가 있으면 종전 글 그대로,
 *   없으면 날씨 단어·날씨 변수 모두 쓰지 않는다.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildWeatherPromptBlock, buildWeatherRefineRule, isWeatherConfigured } from '../connected-content';

const OLD = process.env.OPENWEATHER_API_KEY;
afterEach(() => { if (OLD === undefined) delete process.env.OPENWEATHER_API_KEY; else process.env.OPENWEATHER_API_KEY = OLD; });

describe('날씨 지시 블록', () => {
  it('키가 있으면 날씨 변수 안내(종전 글)', () => {
    process.env.OPENWEATHER_API_KEY = 'test-key-not-real';
    expect(isWeatherConfigured()).toBe(true);
    expect(buildWeatherPromptBlock()).toContain('{{ weather.summary }}');
    expect(buildWeatherRefineRule()).toContain('{{ weather.summary }}');
  });
  it('키가 없으면 날씨 변수를 쓰지 않게 한다', () => {
    delete process.env.OPENWEATHER_API_KEY;
    expect(isWeatherConfigured()).toBe(false);
    const b = buildWeatherPromptBlock();
    expect(b).not.toContain('의무');
    expect(b).toContain('쓰지 않는다');
    expect(buildWeatherRefineRule()).toContain('쓰지 않는다');
  });
});

describe('배선', () => {
  const src = readFileSync(join(__dirname, '..', 'journey-ai-generator.ts'), 'utf8');
  it('여정 AI 지시문이 날씨 CT의 블록을 쓴다(날씨 변수 의무 문장을 직접 들고 있지 않다)', () => {
    expect(src).toContain('${buildWeatherPromptBlock()}');
    expect(src).toContain('${buildWeatherRefineRule()}');
    expect(src).not.toContain('✓ 발송 시점 실시간 자동 분기는 Liquid 변수 의무:');
  });
});
