// ★ 2026-09-30 이미지 생성 엔진 스위치 — 3방식 블라인드(원장 docs/2026-09-30-ai-model-prompt-upgrade.md §2-4)
//   기본 gemini(배포만으로 무변경) · 스튜디오 라우트만 엔진을 넘긴다 · 4K 는 늘 Gemini · 안전 거부·시간 초과는 대체 금지
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const GEMINI_OK = {
  candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'R0VNSU5J' } }] } }],
  usageMetadata: { candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1120 }] },
};
const OPENAI_OK = {
  data: [{ b64_json: 'T1BFTkFJ' }],
  usage: { input_tokens: 229, output_tokens: 2223, output_tokens_details: { image_tokens: 2223, text_tokens: 0 } },
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const realFetch = globalThis.fetch;
let calls: Array<{ url: string; init?: RequestInit }> = [];
let openaiReply: () => Response | Promise<Response> = () => json(OPENAI_OK);

async function load() {
  vi.resetModules();
  return import('../image-studio');
}

beforeEach(() => {
  vi.stubEnv('GEMINI_API_KEY', 'test-gemini-key');
  vi.stubEnv('OPENAI_API_KEY', 'test-openai-key');
  vi.stubEnv('STUDIO_IMAGE_ENGINE', '');
  calls = [];
  openaiReply = () => json(OPENAI_OK);
  globalThis.fetch = vi.fn(async (url: any, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u.startsWith('https://api.openai.com/')) return openaiReply();
    if (u.startsWith('https://generativelanguage.googleapis.com/')) return json(GEMINI_OK);
    throw new Error(`예상 밖 호출 ${u}`);
  }) as any;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.unstubAllEnvs();
});

const openaiCalls = () => calls.filter((c) => c.url.startsWith('https://api.openai.com/'));
const geminiCalls = () => calls.filter((c) => c.url.startsWith('https://generativelanguage.googleapis.com/'));

describe('studioImageEngine — 스위치(호출 시점 ENV)', () => {
  it('미설정·다른 값 = gemini', async () => {
    const m = await load();
    expect(m.studioImageEngine()).toBe('gemini');
    vi.stubEnv('STUDIO_IMAGE_ENGINE', 'gemini');
    expect(m.studioImageEngine()).toBe('gemini');
    vi.stubEnv('STUDIO_IMAGE_ENGINE', 'gpt');
    expect(m.studioImageEngine()).toBe('gemini');
  });
  it('openai(대소문자·공백 무시) + 키 있음 = openai', async () => {
    const m = await load();
    vi.stubEnv('STUDIO_IMAGE_ENGINE', ' OpenAI ');
    expect(m.studioImageEngine()).toBe('openai');
  });
  it('openai 인데 키 없음 = gemini(서비스 유지)', async () => {
    const m = await load();
    vi.stubEnv('STUDIO_IMAGE_ENGINE', 'openai');
    vi.stubEnv('OPENAI_API_KEY', '');
    expect(m.studioImageEngine()).toBe('gemini');
  });
});

describe('openaiImageSize — 규격(16의 배수 · 화소 범위 · 실험 구간 밖)', () => {
  it('포스터 3:4 2K = 블라인드 비교와 같은 1536x2048 · MMS 3:4 1K = 1008x1344', async () => {
    const m = await load();
    expect(m.openaiImageSize('3:4', '2K')).toBe('1536x2048');
    expect(m.openaiImageSize('3:4', '1K')).toBe('1008x1344');
  });
  it('모든 프리셋이 규격 안', async () => {
    const m = await load();
    for (const p of Object.values(m.CHANNEL_PRESETS)) {
      const [w, h] = m.openaiImageSize(p.aspectRatio, p.imageSize).split('x').map(Number);
      expect(w % 16).toBe(0);
      expect(h % 16).toBe(0);
      expect(Math.max(w, h)).toBeLessThanOrEqual(3840);
      expect(w * h).toBeGreaterThanOrEqual(655_360);
      expect(w * h).toBeLessThanOrEqual(2560 * 1440);
      const [a, b] = p.aspectRatio.split(':').map(Number);
      expect(Math.abs(w / h - a / b)).toBeLessThan(0.02);
    }
  });
});

describe('generatePoster — 엔진 분기', () => {
  it('엔진 미지정 = Gemini 만(스위치가 켜져 있어도 · 아웃리치·예시 배치 보호)', async () => {
    const m = await load();
    vi.stubEnv('STUDIO_IMAGE_ENGINE', 'openai');
    const img = await m.generatePoster('p', m.resolvePreset('poster'), null);
    expect(openaiCalls()).toHaveLength(0);
    expect(geminiCalls()).toHaveLength(1);
    expect(img).toMatchObject({ base64: 'R0VNSU5J', engine: 'gemini' });
  });
  it('openai · 사진 없음 = 생성 끝점(JSON · 모델 · 1536x2048 · high · jpeg)', async () => {
    const m = await load();
    const img = await m.generatePoster('포스터 프롬프트', m.resolvePreset('poster'), null, { engine: 'openai' });
    expect(openaiCalls()).toHaveLength(1);
    expect(geminiCalls()).toHaveLength(0);
    const c = openaiCalls()[0];
    expect(c.url).toBe('https://api.openai.com/v1/images/generations');
    const body = JSON.parse(String(c.init?.body));
    expect(body).toMatchObject({ model: 'gpt-image-2.5-sunburst', prompt: '포스터 프롬프트', size: '1536x2048', quality: 'high', output_format: 'jpeg', n: 1 });
    expect((c.init?.headers as any).Authorization).toBe('Bearer test-openai-key');
    expect(img).toMatchObject({ base64: 'T1BFTkFJ', mime: 'image/jpeg', imageTokens: 2223, engine: 'openai' });
  });
  it('openai · 누끼 첨부 = 수정 끝점(multipart image[])', async () => {
    const m = await load();
    await m.generatePoster('p', m.resolvePreset('poster'), { base64: Buffer.from('png-bytes').toString('base64'), mime: 'image/png' }, { engine: 'openai' });
    const c = openaiCalls()[0];
    expect(c.url).toBe('https://api.openai.com/v1/images/edits');
    const form = c.init?.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get('model')).toBe('gpt-image-2.5-sunburst');
    expect(form.get('size')).toBe('1536x2048');
    const file = form.getAll('image[]')[0] as Blob;
    expect(file.type).toBe('image/png');
    expect(Buffer.from(await file.arrayBuffer()).toString()).toBe('png-bytes');
  });
  it('openai 일시 장애(500) = 같은 요청을 Gemini 로 한 번(로그 남김)', async () => {
    const m = await load();
    openaiReply = () => json({ error: { message: 'server', code: 'server_error' } }, 500);
    const warn = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'log').mockImplementation(() => {});
    const img = await m.generatePoster('p', m.resolvePreset('poster'), null, { engine: 'openai' });
    expect(openaiCalls()).toHaveLength(1);
    expect(geminiCalls()).toHaveLength(1);
    expect(img).toMatchObject({ base64: 'R0VNSU5J', engine: 'gemini' });  // 대체를 결과가 드러낸다(비교 검증이 섞지 않게)
    expect(warn.mock.calls.some((a) => String(a[0]).includes('gemini 로 대체'))).toBe(true);
    warn.mockRestore(); err.mockRestore();
  });
  it('openai 한도(429)·권한(401)도 Gemini 로 대체', async () => {
    const m = await load();
    const err = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'log').mockImplementation(() => {});
    for (const status of [429, 401]) {
      calls = [];
      openaiReply = () => json({ error: { code: 'x' } }, status);
      await m.generatePoster('p', m.resolvePreset('poster'), null, { engine: 'openai' });
      expect(geminiCalls()).toHaveLength(1);
    }
    err.mockRestore(); warn.mockRestore();
  });
  it('안전 거부(moderation_blocked) = SAFETY_BLOCKED · Gemini 로 돌리지 않는다', async () => {
    const m = await load();
    openaiReply = () => json({ error: { type: 'image_generation_user_error', code: 'moderation_blocked' } }, 400);
    const err = vi.spyOn(console, 'log').mockImplementation(() => {});
    await expect(m.generatePoster('p', m.resolvePreset('poster'), null, { engine: 'openai' })).rejects.toMatchObject({ code: 'SAFETY_BLOCKED', noCharge: true });
    expect(geminiCalls()).toHaveLength(0);
    err.mockRestore();
  });
  it('그 밖의 400(코드 없음 · 본문 못 읽음 포함) = GEN_FAILED · Gemini 로 돌리지 않는다(fail-closed)', async () => {
    const m = await load();
    const err = vi.spyOn(console, 'log').mockImplementation(() => {});
    for (const reply of [() => new Response('not-json', { status: 400 }), () => json({ error: { type: 'invalid_request_error', code: 'invalid_size' } }, 400)]) {
      calls = [];
      openaiReply = reply;
      await expect(m.generatePoster('p', m.resolvePreset('poster'), null, { engine: 'openai' })).rejects.toMatchObject({ code: 'GEN_FAILED', noCharge: true });
      expect(geminiCalls()).toHaveLength(0);
    }
    err.mockRestore();
  });
  it('시간 초과 = GEN_FAILED · Gemini 로 돌리지 않는다(대기 두 배 금지)', async () => {
    const m = await load();
    openaiReply = () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; };
    const err = vi.spyOn(console, 'log').mockImplementation(() => {});
    await expect(m.generatePoster('p', m.resolvePreset('poster'), null, { engine: 'openai' })).rejects.toMatchObject({ code: 'GEN_FAILED', noCharge: true });
    expect(geminiCalls()).toHaveLength(0);
    err.mockRestore();
  });
  it('늦은 실패(30초 넘어 온 5xx) = GEN_FAILED · Gemini 로 돌리지 않는다(대기 두 배 금지)', async () => {
    const m = await load();
    let now = 1_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    openaiReply = () => { now += 40_000; return json({ error: { code: 'server_error' } }, 503); };
    const err = vi.spyOn(console, 'log').mockImplementation(() => {});
    await expect(m.generatePoster('p', m.resolvePreset('poster'), null, { engine: 'openai' })).rejects.toMatchObject({ code: 'GEN_FAILED', noCharge: true });
    expect(geminiCalls()).toHaveLength(0);
    clock.mockRestore(); err.mockRestore();
  });
  it('응답에 이미지가 없으면 Gemini 로 대체', async () => {
    const m = await load();
    openaiReply = () => json({ data: [] });
    const warn = vi.spyOn(console, 'log').mockImplementation(() => {});
    const img = await m.generatePoster('p', m.resolvePreset('poster'), null, { engine: 'openai' });
    expect(img).toMatchObject({ base64: 'R0VNSU5J', engine: 'gemini' });
    warn.mockRestore();
  });
});

describe('editOrUpscale — 4K 는 늘 Gemini · 2K 수정 지시만 스위치', () => {
  const base = { baseImageBase64: Buffer.from('jpg-bytes').toString('base64'), baseMime: 'image/jpeg', basePrompt: '원 프롬프트', aspectRatio: '3:4' };
  it('4K + engine openai = Gemini 만', async () => {
    const m = await load();
    await m.editOrUpscale({ ...base, instruction: m.UPSCALE_4K_INSTRUCTION, imageSize: '4K', engine: 'openai' });
    expect(openaiCalls()).toHaveLength(0);
    expect(geminiCalls()).toHaveLength(1);
  });
  it('2K 수정 + engine openai = 수정 끝점(지시 + 나머지 유지 · 원본 이미지)', async () => {
    const m = await load();
    await m.editOrUpscale({ ...base, instruction: '배경을 밤으로', imageSize: '2K', engine: 'openai' });
    const c = openaiCalls()[0];
    expect(c.url).toBe('https://api.openai.com/v1/images/edits');
    const form = c.init?.body as FormData;
    expect(form.get('prompt')).toBe(`배경을 밤으로\n${m.OPENAI_EDIT_KEEP_REST}`);
    expect(form.get('size')).toBe('1536x2048');
    expect(Buffer.from(await (form.getAll('image[]')[0] as Blob).arrayBuffer()).toString()).toBe('jpg-bytes');
    expect(geminiCalls()).toHaveLength(0);
  });
  it('엔진 미지정 = Gemini(멀티턴 · 원 프롬프트 동봉)', async () => {
    const m = await load();
    await m.editOrUpscale({ ...base, instruction: '배경을 밤으로', imageSize: '2K' });
    expect(openaiCalls()).toHaveLength(0);
    const body = JSON.parse(String(geminiCalls()[0].init?.body));
    expect(body.contents[0].parts[0].text).toBe('원 프롬프트');
  });
});

describe('배선 — 스튜디오 라우트만 엔진을 넘긴다', () => {
  const src = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
  it('/generate · /edit 는 studioImageEngine() 을 넘긴다', () => {
    const r = src('..', 'routes', 'image-studio.ts');
    expect(r).toContain('generatePoster(prompt, preset, cutout, { engine: studioImageEngine() })');
    expect(r).toMatch(/editOrUpscale\(\{[\s\S]*?engine: studioImageEngine\(\),[\s\S]*?\}\);/);
  });
  it('템플릿 예시 배치 · 아웃리치는 엔진을 넘기지 않는다(Gemini 그대로)', () => {
    const r = src('..', 'routes', 'image-studio.ts');
    expect(r).toContain('await generatePoster(prompt, preset, null);');
    expect(src('sales-outreach-produce.ts')).not.toMatch(/studioImageEngine|engine:\s*'openai'/);
  });
});
