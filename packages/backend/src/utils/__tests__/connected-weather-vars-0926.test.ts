/**
 * 날씨 변수 = AI 지시문이 쓰는 이름 그대로 채우고, 모르는 날씨는 지어내지 않는다 (★2026-09-26 한줄로 V2 R1-35)
 *
 * 옛: 실제 값은 weather.today.summary·temperature인데 AI 지시(와 이미 저장된 여정 문안)는 weather.summary·temp·condition == 'Rain'.
 *     → 고객 지역 날씨 자리는 빈칸, 비 분기는 영영 거짓.
 *     또 날씨 API 키가 없거나 호출이 실패하면 날씨를 '맑음'으로 지어냈다(비 오는 날 "맑은 오늘" 문자).
 * 처방: ①날씨 값에 temp·condition(영문 상태 = Rain 등)을 싣고 weather.summary·temp·condition을 고객 지역 값으로 함께 둔다
 *       (이미 저장된 문안도 발송 때 렌더되므로 이름을 맞추는 쪽은 값이다).
 *       ②모르는 날씨 = 값 없음(null). '맑음' 기본값을 없앤다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [{ region: '부산' }] })) }));

import { fetchWeather, enrichLiquidContextWithExternal } from '../connected-content';
import { renderLiquid } from '../liquid-templating';

const realFetch = globalThis.fetch;
const OLD_KEY = process.env.OPENWEATHER_API_KEY;

function mockWeatherApi(main: string | null, temp = 12.4, description = '') {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ weather: main ? [{ main, description }] : [], main: { temp } }),
  })) as any;
}

describe('날씨 값', () => {
  beforeEach(() => { process.env.OPENWEATHER_API_KEY = 'test-key-not-real'; });
  afterEach(() => {
    globalThis.fetch = realFetch;
    if (OLD_KEY === undefined) delete process.env.OPENWEATHER_API_KEY; else process.env.OPENWEATHER_API_KEY = OLD_KEY;
  });

  it('비 = 요약 "비" · 상태 "Rain" · 기온 반올림(temp와 temperature 같은 값)', async () => {
    mockWeatherApi('Rain', 12.4);
    const w = await fetchWeather('광주광역시');
    expect(w).toMatchObject({ summary: '비', condition: 'Rain', temperature: 12, temp: 12 });
  });

  it('API 키가 없으면 날씨를 지어내지 않는다(null)', async () => {
    delete process.env.OPENWEATHER_API_KEY;
    globalThis.fetch = vi.fn() as any;
    expect(await fetchWeather('대전광역시')).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('호출이 실패하면 null', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })) as any;
    expect(await fetchWeather('울산광역시')).toBeNull();
  });

  it('상태가 비어 있으면 null · 표에 없는 상태는 받은 한글 설명(없으면 null)', async () => {
    mockWeatherApi(null);
    expect(await fetchWeather('세종특별자치시')).toBeNull();
    mockWeatherApi('Dust', 20, '먼지');
    expect(await fetchWeather('제주특별자치도')).toMatchObject({ summary: '먼지', condition: 'Dust' });
  });
});

describe('Liquid 컨텍스트', () => {
  beforeEach(() => { process.env.OPENWEATHER_API_KEY = 'test-key-not-real'; });
  afterEach(() => {
    globalThis.fetch = realFetch;
    if (OLD_KEY === undefined) delete process.env.OPENWEATHER_API_KEY; else process.env.OPENWEATHER_API_KEY = OLD_KEY;
  });

  it('AI 지시문 이름(weather.summary·temp·condition)이 고객 지역 값으로 렌더된다', async () => {
    mockWeatherApi('Rain', 31);
    const tpl = "{{ weather.summary }}/{{ weather.temp }} {% if weather.condition == 'Rain' %}우산{% else %}맑음{% endif %}";
    const ctx = await enrichLiquidContextWithExternal(tpl, 'co-1', '경기도');
    const out = renderLiquid(tpl, ctx as any).rendered;
    expect(out).toBe('비/31 우산');
  });

  it('모르는 날씨면 weather를 싣지 않는다(분기는 else · 가짜 맑음 없음)', async () => {
    delete process.env.OPENWEATHER_API_KEY;
    const tpl = "{% if weather.condition == 'Rain' %}우산{% else %}기본{% endif %}{{ weather.summary }}";
    const ctx = await enrichLiquidContextWithExternal(tpl, 'co-1', '강원도');
    expect((ctx as any).weather).toBeUndefined();
    expect(renderLiquid(tpl, ctx as any).rendered).toBe('기본');
  });
});
