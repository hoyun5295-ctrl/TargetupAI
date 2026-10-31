/**
 * image-studio-samples-1101.test.ts — 템플릿 예시 그림 = 서버 스크립트 · 서빙본(1400px) · 버전 주소 긴 캐시 (2026-11-01)
 * 경위: 예시 생성 주소는 1025 R15 로 지워졌고(C88 새 200장을 만들 길 0), 갤러리 카드가 원본(평균 2.6MB)을 10장씩 받아 시연 때 느렸다.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-samples-'));
let m: typeof import('../image-studio');
beforeAll(async () => {
  process.env.STUDIO_SAMPLE_PATH = dir;
  vi.resetModules();
  m = await import('../image-studio');
});

describe('예시 파일 — 저장 · 찾기 · 빠진 것', () => {
  it('저장은 모델이 준 형식 확장자로 한 번에 옮기고(임시 파일 0) · 찾기는 파일 시각을 v 로 준다', () => {
    const out = m.saveTemplateSample('tpl-a', { base64: Buffer.from('jpegbytes').toString('base64'), mime: 'image/jpeg' });
    expect(path.basename(out)).toBe('tpl-a.jpg');
    expect(fs.readdirSync(dir).filter((f) => f.startsWith('.tmp-'))).toEqual([]);
    const s = m.findTemplateSample('tpl-a')!;
    expect(s.absPath).toBe(out);
    expect(s.mime).toBe('image/jpeg');
    expect(s.v).toBe(Math.floor(fs.statSync(out).mtimeMs));
    m.saveTemplateSample('tpl-p', { base64: 'AA==', mime: 'image/png' });
    expect(m.findTemplateSample('tpl-p')!.mime).toBe('image/png');
    expect(m.findTemplateSample('tpl-none')).toBeNull();
  });
  it('빠진 것 = 파일도 카탈로그 주소도 없는 것 · 카탈로그 순서 · id 를 주면 그 안에서만', () => {
    const all = [{ id: 'tpl-a' }, { id: 'tpl-b' }, { id: 'tpl-c', exampleUrl: 'https://x/y.jpg' }, { id: 'tpl-d' }];
    expect(m.templatesMissingSample(all).map((t) => t.id)).toEqual(['tpl-b', 'tpl-d']);
    expect(m.templatesMissingSample(all, ['tpl-d', 'tpl-a']).map((t) => t.id)).toEqual(['tpl-d']);
  });
});

describe('예시 배치 — 장수 · 실패 상한', () => {
  const list = Array.from({ length: 10 }, (_, i) => ({ id: `t${i}` }));
  it('앞에서부터 count 장만 만든다', async () => {
    const seen: string[] = [];
    const r = await m.runSampleBatch(list, 4, async (t) => { seen.push(t.id); }, () => {});
    expect(seen).toEqual(['t0', 't1', 't2', 't3']);
    expect(r).toEqual({ made: ['t0', 't1', 't2', 't3'], failed: [] });
  });
  it('실패가 3번 쌓이면 남은 장수가 있어도 멈춘다(장애 때 돈이 새지 않게)', async () => {
    let calls = 0;
    const r = await m.runSampleBatch(list, 10, async (t) => { calls++; if (t.id !== 't1') throw new Error('x'); }, () => {});
    expect(r.made).toEqual(['t1']);
    expect(r.failed).toEqual(['t0', 't2', 't3']);
    expect(calls).toBe(4);
  });
});

describe('배선 — 서빙본 · 버전 주소 · 스크립트', () => {
  const src = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
  const route = src('..', 'routes', 'image-studio.ts');
  const sampleRoute = route.slice(route.indexOf("imageStudioRouter.get('/template-sample/:id'"), route.indexOf('imageStudioRouter.use(authenticate)'));
  it('예시 주소는 원본이 아니라 서빙본(image-serve CT)을 보낸다', () => {
    expect(sampleRoute).toContain('res.sendFile(path.resolve(await getServePath(sample.absPath)))');
    expect(sampleRoute).not.toContain('res.sendFile(sample.absPath)');
  });
  it('1년 캐시는 목록이 준 버전 주소(?v=)에만 · 목록은 v 를 붙인다', () => {
    expect(sampleRoute).toContain("req.query.v ? 'public, max-age=31536000, immutable' : 'public, max-age=3600'");
    expect(route).toContain('`/api/image-studio/template-sample/${t.id}?v=${s.v}`');
  });
  it('스크립트는 CT 를 부른다(빠진 것 · 저장 · 배치 상한 · 고객과 같은 엔진) · 예시 생성 주소는 다시 열지 않는다', () => {
    const script = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'scripts', 'studio-samples.ts'), 'utf8');
    for (const fn of ['templatesMissingSample(', 'saveTemplateSample(', 'runSampleBatch(', 'studioImageEngine()', 'getServePath(']) expect(script).toContain(fn);
    expect(route).not.toContain('template-samples/generate');
  });
});
