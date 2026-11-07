/**
 * 1102 이미지 스튜디오 · 제품 사진 최대 3장을 한 장 포스터로(설계서 docs/2026-11-02-image-studio-multi-product-design.md §4)
 *   S1 묶기 · S2 프롬프트 · S3 요청 읽기 · S4 시도 키 지문 · S5 상한 한 값 · S6 화면 계약 · S7 라우트 순서
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import {
  STUDIO_MAX_PRODUCTS, readProductTempIds, studioProductFingerprint, groupProductCutouts,
  buildPosterPrompt, resolvePreset,
} from '../image-studio';
import { getTemplate } from '../image-studio-templates';
import { studioAttemptKey } from '../image-studio-attempt';
import { runProductPrep, type ProductPrepDeps } from '../../../../frontend/src/lib/studio-products';

const ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.resolve(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

// 투명 캔버스(800×800) 가운데에 불투명 사각형 = 누끼 결과 모양
async function cutoutFile(dir: string, name: string, w: number, h: number, rgb: [number, number, number]): Promise<string> {
  const box = await sharp({ create: { width: w, height: h, channels: 4, background: { r: rgb[0], g: rgb[1], b: rgb[2], alpha: 1 } } }).png().toBuffer();
  const f = path.join(dir, name);
  await sharp({ create: { width: Math.max(800, w + 200), height: Math.max(800, h + 200), channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: box, left: 100, top: 100 }]).png().toFile(f);
  return f;
}

describe('S1 묶기 — 넣은 순서대로 왼쪽부터 · 높이 1200 · 간격 96 · 폭 3600 상한', () => {
  it('세 장 = 폭 합 + 간격 둘 · 알파 · 첫 장이 왼쪽 · 마지막 장이 오른쪽', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-group-'));
    const files = [
      await cutoutFile(dir, 'a.png', 200, 400, [220, 30, 30]),
      await cutoutFile(dir, 'b.png', 300, 300, [30, 200, 30]),
      await cutoutFile(dir, 'c.png', 100, 500, [30, 30, 220]),
    ];
    const g = await groupProductCutouts(files);
    expect(g.mime).toBe('image/png');
    const buf = Buffer.from(g.base64, 'base64');
    const meta = await sharp(buf).metadata();
    // 높이 1200 으로 맞춘 폭 600 + 1200 + 240 = 2040 · 간격 96 × 2
    expect(meta.height).toBe(1200);
    expect(meta.width).toBe(2232);
    expect(meta.hasAlpha).toBe(true);
    const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => { const i = (y * info.width + x) * info.channels; return [data[i], data[i + 1], data[i + 2], data[i + 3]]; };
    expect(px(10, 600)[0]).toBeGreaterThan(150);              // 첫 장(빨강)이 왼쪽
    expect(px(info.width - 10, 600)[2]).toBeGreaterThan(150); // 마지막 장(파랑)이 오른쪽
    expect(px(600 + 48, 600)[3]).toBe(0);                     // 첫 간격은 투명
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it('아주 넓은 세 장 = 폭 3600 이하로 줄인다(비율 유지)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-group-'));
    const files = [
      await cutoutFile(dir, 'a.png', 1000, 100, [200, 0, 0]),
      await cutoutFile(dir, 'b.png', 1000, 100, [0, 200, 0]),
      await cutoutFile(dir, 'c.png', 1000, 100, [0, 0, 200]),
    ];
    const meta = await sharp(Buffer.from((await groupProductCutouts(files)).base64, 'base64')).metadata();
    expect(meta.width).toBeLessThanOrEqual(3600);
    expect(meta.width).toBeGreaterThan(3500);
    expect(meta.height).toBeLessThan(1200);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it('극단 비(10000×10 두 장) = 배율을 먼저 정해 처음부터 한도 안 · 폭 3600 이하 · 높이 1 이상(Codex 설계 1R ②)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-group-'));
    const files = [
      await cutoutFile(dir, 'a.png', 10000, 10, [200, 0, 0]),
      await cutoutFile(dir, 'b.png', 10000, 10, [0, 0, 200]),
    ];
    const meta = await sharp(Buffer.from((await groupProductCutouts(files)).base64, 'base64')).metadata();
    expect(meta.width).toBeLessThanOrEqual(3600);
    expect(meta.height).toBeGreaterThanOrEqual(1);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it('최소 1 보정 뒤 3600 을 넘는 모양 = 만들기 전에 거절(Codex 설계 2R ① 반례 둘)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-group-'));
    const wide = [await cutoutFile(dir, 'a.png', 20000, 10, [200, 0, 0]), await cutoutFile(dir, 'b.png', 20000, 10, [0, 0, 200])];
    await expect(groupProductCutouts(wide)).rejects.toMatchObject({ code: 'PRODUCT_TOO_LARGE' });
    // 여백 없는 한 색 그림 = 잘라낼 것이 없어 그 크기 그대로(아주 얇은 선은 잘라내기가 잡음으로 보고 남기므로 여백을 두지 않는다)
    const plain = async (name: string, w: number, h: number) => {
      const f = path.join(dir, name);
      await sharp({ create: { width: w, height: h, channels: 4, background: { r: 10, g: 10, b: 10, alpha: 1 } } }).png().toFile(f);
      return f;
    };
    const mixed = [await plain('c.png', 3599, 1), await plain('d.png', 1, 100), await plain('e.png', 1, 100)];
    await expect(groupProductCutouts(mixed)).rejects.toMatchObject({ code: 'PRODUCT_TOO_LARGE' });
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it('2,500만 화소 넘는 입력 = 디코드 전에 거절', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-group-'));
    const big = path.join(dir, 'big.png');
    await sharp({ create: { width: 6000, height: 5000, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png({ compressionLevel: 9 }).toFile(big);
    const small = await cutoutFile(dir, 's.png', 200, 200, [0, 0, 0]);
    await expect(groupProductCutouts([small, big])).rejects.toThrow();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('S2 프롬프트 — 개수 줄은 2장부터 · 제품 보존 줄 바로 다음 · 1장 이하는 지금 그대로', () => {
  const template = getTemplate('beauty-clean-bright')!;
  const preset = resolvePreset('poster');
  const texts = { label: 'SIGNATURE', title: '베스트 3종', subtitle: '11월 한정' };
  const now = new Date('2026-11-02T03:00:00Z');
  const base = (extra: Record<string, unknown> = {}) => buildPosterPrompt({ template, preset, texts, hasProduct: true, now, ...extra } as any);

  it('productCount 없음 = 1 = 지금 출력(개수 줄 없음)', () => {
    expect(base({ productCount: 1 })).toBe(base());
    expect(base()).not.toContain('different products');
  });
  it('2 · 3 = 개수 줄이 제품 보존 줄 바로 다음 · 나머지 줄 순서 그대로', () => {
    const one = base().split('\n');
    for (const n of [2, 3]) {
      const lines = base({ productCount: n }).split('\n');
      const i = lines.findIndex((l) => l.startsWith('A product photo with transparent background is attached.'));
      expect(i).toBeGreaterThan(-1);
      expect(lines[i + 1]).toBe(`The attached transparent image contains ${n} different products placed side by side as one group. Show all ${n} products together as the hero group, keep their order and spacing, and preserve every one of them EXACTLY as provided, including each label text.`);
      expect([...lines.slice(0, i + 1), ...lines.slice(i + 2)]).toEqual(one);
    }
  });
  it('제품 없음 = 개수가 와도 개수 줄 없음', () => {
    const p = buildPosterPrompt({ template, preset, texts, hasProduct: false, productCount: 3, now } as any);
    expect(p).not.toContain('different products');
  });
});

describe('S3 요청 읽기 — 새 화면 = cutoutTempIds(0~3) · 옛 화면 = cutoutTempId 하나', () => {
  it('맞는 꼴', () => {
    expect(readProductTempIds({})).toEqual([]);
    expect(readProductTempIds({ cutoutTempId: null })).toEqual([]);
    expect(readProductTempIds({ cutoutTempId: ID(1) })).toEqual([ID(1)]);
    expect(readProductTempIds({ cutoutTempIds: [] })).toEqual([]);
    expect(readProductTempIds({ cutoutTempIds: [ID(1), ID(2), ID(3)] })).toEqual([ID(1), ID(2), ID(3)]);
    // 배열이 있으면 배열이 이긴다(옛 칸은 보지 않는다)
    expect(readProductTempIds({ cutoutTempIds: [ID(2)], cutoutTempId: ID(1) })).toEqual([ID(2)]);
  });
  it('어긋난 꼴 = null', () => {
    expect(readProductTempIds({ cutoutTempIds: [ID(1), ID(2), ID(3), ID(4)] })).toBeNull();
    expect(readProductTempIds({ cutoutTempIds: [ID(1), ID(1)] })).toBeNull();
    expect(readProductTempIds({ cutoutTempIds: [ID(1), 7] })).toBeNull();
    expect(readProductTempIds({ cutoutTempIds: ['../x'] })).toBeNull();
    expect(readProductTempIds({ cutoutTempIds: ID(1) })).toBeNull();
    expect(readProductTempIds({ cutoutTempId: 'not-a-temp-id' })).toBeNull();
    expect(readProductTempIds({ cutoutTempId: 5 })).toBeNull();
  });
  it('상한 = 3', () => {
    expect(STUDIO_MAX_PRODUCTS).toBe(3);
  });
});

describe('S4 시도 키 지문 — 옛 화면 몸(생략 · null · id)은 지금 라우트 키 그대로 · 새 배열은 순서까지', () => {
  const T = 'attempt-token-1102';
  // 지금(배포 전) 라우트의 payload 모양 그대로 — cutoutTempId 자리 · 이름 고정
  const keyOf = (cutoutTempId: unknown) => studioAttemptKey('gen', 'co', T, { templateId: 't', presetKey: 'poster', userHint: null, texts: { title: 'a' }, cutoutTempId, textPosition: null });
  it('생략 · null · id 셋 다 옛 키와 같다', () => {
    expect(studioProductFingerprint({})).toBeUndefined();
    expect(keyOf(studioProductFingerprint({}))).toBe(keyOf(undefined));
    expect(keyOf(studioProductFingerprint({ cutoutTempId: null }))).toBe(keyOf(null));
    expect(keyOf(studioProductFingerprint({ cutoutTempId: ID(1) }))).toBe(keyOf(ID(1)));
    expect(keyOf(undefined)).not.toBe(keyOf(null));   // 생략과 null 은 지금도 다른 키 = 합치면 이중 차감(Codex 설계 1R ①)
  });
  it('새 화면 배열 = 그대로 지문 · 순서가 다르면 다른 키', () => {
    expect(studioProductFingerprint({ cutoutTempIds: [ID(1), ID(2)] })).toEqual([ID(1), ID(2)]);
    expect(keyOf(studioProductFingerprint({ cutoutTempIds: [ID(1), ID(2)] }))).not.toBe(keyOf(studioProductFingerprint({ cutoutTempIds: [ID(2), ID(1)] })));
  });
});

describe('S5 상한 한 값 — 화면 숫자 = 서버 숫자', () => {
  it('StudioMake.tsx 의 STUDIO_MAX_PRODUCTS', () => {
    const make = read('packages/frontend/src/components/studio/StudioMake.tsx');
    const m = make.match(/export const STUDIO_MAX_PRODUCTS = (\d+);/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(STUDIO_MAX_PRODUCTS);
  });
});

// ── S6-가 칸 수명 표 = 준비 함수 동작(lib/studio-products.ts runProductPrep · 프론트 러너가 없어 백엔드 vitest 가 직접 부른다) ──
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const p = new Promise<T>((r, j) => { resolve = r; reject = j; });
  return { p, resolve, reject };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const file = (name: string) => ({ name }) as unknown as File;
function prepDeps(log: string[], state: { alive: boolean }, over: Partial<ProductPrepDeps> = {}): ProductPrepDeps {
  return {
    live: () => state.alive,
    setBusy: (m) => { log.push(`busy:${m}`); },
    upload: async (f) => { log.push(`upload:${f.name}`); return `src-${f.name}`; },
    ingest: async (u) => { log.push(`ingest:${u}`); return `src-${u}`; },
    removeBg: async (s) => { log.push(`bg:${s}`); return `cut-${s}`; },
    preview: async (c) => { log.push(`preview:${c}`); return `blob-${c}`; },
    revoke: (u) => { log.push(`revoke:${u}`); },
    onCutout: (k, c) => { log.push(`cutout:${k}:${c}`); },
    onPreview: (k, u) => { log.push(`show:${k}:${u}`); },
    onFail: (k, m) => { log.push(`fail:${k}:${m}`); },
    ...over,
  };
}
const ITEMS = [
  { key: 'k1', file: file('1-사진.jpg'), imageUrl: null },
  { key: 'k2', file: file('2-움짤.gif'), imageUrl: null },
  { key: 'k3', file: file('3-사진.jpg'), imageUrl: null },
];

describe('S6-가 칸 수명 표 = runProductPrep 동작', () => {
  it('정상 세 장 = 칸마다 원본 → 누끼 → 누끼 id → 미리보기 · 준비 표시는 마지막에 한 번만 끈다', async () => {
    const log: string[] = [];
    const r = await runProductPrep(ITEMS, prepDeps(log, { alive: true }));
    expect(r).toEqual({ ready: 3 });
    expect(log.filter((l) => l === 'busy:')).toHaveLength(1);
    expect(log[log.length - 1]).toBe('busy:');
    expect(log.indexOf('busy:상품 이미지 준비 중... (3/3)')).toBeGreaterThan(log.indexOf('show:k2:blob-cut-src-2-움짤.gif'));
    for (const k of ['k1', 'k2', 'k3']) {
      expect(log.findIndex((l) => l.startsWith(`cutout:${k}:`))).toBeLessThan(log.findIndex((l) => l.startsWith(`show:${k}:`)));
    }
  });
  it('가운데 사진 원본 저장 실패 = 그 칸만 빼고 세 번째 계속 · 표시는 끝에 한 번(직원 15번 · Codex 설계 2R ② · 3R)', async () => {
    const log: string[] = [];
    const r = await runProductPrep(ITEMS, prepDeps(log, { alive: true }, {
      upload: async (f) => { log.push(`upload:${f.name}`); if (f.name.endsWith('.gif')) throw new Error('JPG · PNG · WEBP 사진만 올릴 수 있어요.'); return `src-${f.name}`; },
    }));
    expect(r).toEqual({ ready: 2 });
    expect(log).toContain('fail:k2:JPG · PNG · WEBP 사진만 올릴 수 있어요.');
    expect(log.indexOf('upload:3-사진.jpg')).toBeGreaterThan(log.indexOf('fail:k2:JPG · PNG · WEBP 사진만 올릴 수 있어요.'));
    expect(log).toContain('show:k3:blob-cut-src-3-사진.jpg');
    expect(log.filter((l) => l === 'busy:')).toEqual(['busy:']);
    expect(log[log.length - 1]).toBe('busy:');
  });
  it('미리보기 실패 = 칸 · 누끼 id 그대로(빼지 않는다) · 다음 칸 계속(Codex 설계 1R ③)', async () => {
    const log: string[] = [];
    const r = await runProductPrep(ITEMS.slice(0, 2), prepDeps(log, { alive: true }, {
      preview: async (c) => { log.push(`preview:${c}`); if (c.includes('1-')) throw new Error('x'); return `blob-${c}`; },
    }));
    expect(r).toEqual({ ready: 2 });
    expect(log).toContain('cutout:k1:cut-src-1-사진.jpg');
    expect(log.some((l) => l.startsWith('fail:k1'))).toBe(false);
    expect(log).toContain('show:k2:blob-cut-src-2-움짤.gif');
  });
  it('미리보기 기다리는 중 처음으로 → 미리보기 실패 = 다음 사진 요청 0 · 표시 변경 0(Codex 구현 1R)', async () => {
    const log: string[] = [];
    const state = { alive: true };
    const pv = deferred<string>();
    const run = runProductPrep(ITEMS, prepDeps(log, state, {
      preview: (c) => { log.push(`preview:${c}`); return c.includes('1-') ? pv.p : Promise.resolve(`blob-${c}`); },
    }));
    await flush();
    expect(log[log.length - 1]).toBe('preview:cut-src-1-사진.jpg');
    const at = log.length;
    state.alive = false;   // 처음으로 · 언마운트
    pv.reject(new Error('net'));
    expect(await run).toBeNull();
    expect(log.slice(at)).toEqual([]);
  });
  it('미리보기 기다리는 중 처음으로 → 늦은 미리보기 성공 = 받자마자 해제 · 칸에 안 넣는다', async () => {
    const log: string[] = [];
    const state = { alive: true };
    const pv = deferred<string>();
    const run = runProductPrep(ITEMS.slice(0, 1), prepDeps(log, state, { preview: (c) => { log.push(`preview:${c}`); return pv.p; } }));
    await flush();
    const at = log.length;
    state.alive = false;
    pv.resolve('blob-late');
    expect(await run).toBeNull();
    expect(log.slice(at)).toEqual(['revoke:blob-late']);
  });
  it('누끼 기다리는 중 처음으로 = 누끼 id · 칸 · 표시를 건드리지 않는다', async () => {
    const log: string[] = [];
    const state = { alive: true };
    const bg = deferred<string>();
    const run = runProductPrep(ITEMS.slice(0, 2), prepDeps(log, state, { removeBg: (s) => { log.push(`bg:${s}`); return bg.p; } }));
    await flush();
    const at = log.length;
    state.alive = false;
    bg.resolve('cut-late');
    expect(await run).toBeNull();
    expect(log.slice(at)).toEqual([]);
  });
  it('처음으로 뒤에 온 실패 응답 = 칸을 빼지 않고 알림도 없다', async () => {
    const log: string[] = [];
    const state = { alive: true };
    const up = deferred<string>();
    const run = runProductPrep(ITEMS.slice(0, 1), prepDeps(log, state, { upload: (f) => { log.push(`upload:${f.name}`); return up.p; } }));
    await flush();
    const at = log.length;
    state.alive = false;
    up.reject(new Error('업로드 실패'));
    expect(await run).toBeNull();
    expect(log.slice(at)).toEqual([]);
  });
  it('원본 저장 기다리는 중 처음으로 → 늦은 성공 = 누끼 요청 · 표시 변경 0(Codex 구현 2R 보강 행)', async () => {
    const log: string[] = [];
    const state = { alive: true };
    const up = deferred<string>();
    const run = runProductPrep(ITEMS.slice(0, 2), prepDeps(log, state, { upload: (f) => { log.push(`upload:${f.name}`); return up.p; } }));
    await flush();
    const at = log.length;
    state.alive = false;
    up.resolve('src-late');
    expect(await run).toBeNull();
    expect(log.slice(at)).toEqual([]);
  });
  it('마지막 칸 미리보기 기다리는 중 처음으로 → 실패 = 표시를 끄지 않는다(새 세대 표시를 지키는 쪽 · Codex 구현 2R 보강 행)', async () => {
    const log: string[] = [];
    const state = { alive: true };
    const pv = deferred<string>();
    const run = runProductPrep(ITEMS.slice(0, 2), prepDeps(log, state, {
      preview: (c) => { log.push(`preview:${c}`); return c.includes('2-') ? pv.p : Promise.resolve(`blob-${c}`); },
    }));
    await flush();
    expect(log[log.length - 1]).toBe('preview:cut-src-2-움짤.gif');
    const at = log.length;
    state.alive = false;
    pv.reject(new Error('net'));
    expect(await run).toBeNull();
    expect(log.slice(at)).toEqual([]);
  });
  it('몰 상품 = 이미지 주소로 원본 저장', async () => {
    const log: string[] = [];
    const r = await runProductPrep([{ key: 'm1', imageUrl: 'https://mall/1.jpg' }], prepDeps(log, { alive: true }));
    expect(r).toEqual({ ready: 1 });
    expect(log).toContain('ingest:https://mall/1.jpg');
  });
});

describe('S6 화면 계약 — 배선(소스 읽기 · 동작은 S6-가 + 직원 지시문 12 · 14 · 15 · 16)', () => {
  const make = read('packages/frontend/src/components/studio/StudioMake.tsx');
  it('훅은 세대 하나로 준비 함수를 부르고 · 실패 = 칸 빼기 + 알림 · 누끼 id · 미리보기 = 그 칸에', () => {
    const prep = make.slice(make.indexOf('const prepareProducts = async'), make.indexOf('const addProducts'));
    expect(prep).toContain('const seq = ++prepSeq.current;');
    expect(prep).toContain('const r = await runProductPrep(added, {\n      live,');
    expect(prep).toContain('onFail: (key, message) => { dropItem(key); toast.error(message); },');
    expect(prep).toContain('onCutout: (key, cutoutTempId) => patchItem(key, { cutoutTempId }),');
    expect(prep).toContain('revoke: (url) => URL.revokeObjectURL(url),');
    expect(prep).toContain('if (!r) return;');
    expect(prep).not.toContain('setBusyMsg(');   // 표시 끄기는 준비 함수 한 곳
  });
  it('처음으로 · 언마운트 = 세대 올림 · 미리보기 해제 · 칸 비움(Codex 설계 1R ④)', () => {
    const reset = make.slice(make.indexOf('const reset = useCallback('), make.indexOf('const restart = useCallback('));
    expect(reset).toContain('prepSeq.current += 1;');
    expect(reset).toContain('for (const i of itemsRef.current) if (i.blob) URL.revokeObjectURL(i.blob);');
    expect(reset).toContain('setItems([]);');
    expect(make).toContain('useEffect(() => () => {\n    prepSeq.current += 1;\n    for (const i of itemsRef.current) if (i.blob) URL.revokeObjectURL(i.blob);\n  }, []);');
  });
  it('준비 중 막힘(담기 · 빼기 · 만들기) · 다 차면 담기 막힘', () => {
    expect(make.match(/disabled=\{busy \|\| make\.full\}/g)?.length).toBe(2);
    expect(make).toContain('onClick={() => make.removeItem(it.key)} disabled={busy}');
    const page = read('packages/frontend/src/pages/ImageStudioPage.tsx');
    expect(page).toContain('const busy = !!busyMsg || !!make.busyMsg;');
    // ★ C114 C 만들기 = 아래 고정 바(commitBar) · 할인 숫자가 틀리면 함께 막힌다
    expect(page).toContain('<button onClick={() => generate()} disabled={busy || !ready || (!!make.discountBuild && !make.discountBuild.ok)}');
    const dm = read('packages/frontend/src/components/dm/build/StudioInsertModal.tsx');
    expect(dm).toContain('const generating = !!make.busyMsg;');
    expect(dm).toContain('onClick={generate} disabled={generating || (!!make.discountBuild && !make.discountBuild.ok)}');
  });
  it('생성 몸 = 칸 순서의 누끼 id 목록 · 옛 단일 칸은 보내지 않는다', () => {
    const gen = make.slice(make.indexOf('const generate = async'), make.indexOf('return {\n    template,'));
    expect(gen).toContain('cutoutTempIds: items.flatMap((i) => (i.cutoutTempId ? [i.cutoutTempId] : [])),');
    expect(gen).not.toContain('cutoutTempId,');
  });
  it('담기 = 남은 칸까지만 · 한 번에 여러 장 = 파일 이름 순 · 몰 창에 남은 칸 수', () => {
    expect(make).toContain('const take = sources.slice(0, room);');
    expect(make).toContain("const room = Math.max(0, STUDIO_MAX_PRODUCTS - itemsRef.current.length);");
    expect(make).toContain('type="file" accept="image/*" multiple onChange={make.onUpload}');
    expect(make).toContain(".sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true }))");
    expect(make).toContain('max={make.remaining}');
  });
  it('몰 창 max = 다 차면 새로 체크 안 함 · 미지정(다른 소비처 4곳) = 지금 그대로', () => {
    const picker = read('packages/frontend/src/components/dm/MallProductPickerModal.tsx');
    expect(picker).toContain('else if (max !== undefined && Object.keys(n).length >= max) return s;');
    // 다른 소비처는 max 를 넘기지 않는다(지금 동작 그대로)
    for (const f of ['pages/InAppMessagesPage.tsx', 'pages/QuickCampaignResultPage.tsx', 'components/inapp/PosterEditor.tsx', 'components/dm/panels/editors/ProductCarouselEditor.tsx']) {
      const src = read(`packages/frontend/src/${f}`);
      const tag = src.slice(src.indexOf('<MallProductPickerModal'), src.indexOf('/>', src.indexOf('<MallProductPickerModal')));
      expect(tag, f).not.toContain('max=');
    }
  });
});

describe('S7 라우트 순서 — 거절 · 묶기는 AI 호출 · 차감 앞', () => {
  const route = read('packages/backend/src/routes/image-studio.ts');
  const gen = route.slice(route.indexOf("imageStudioRouter.post('/generate'"), route.indexOf("imageStudioRouter.post('/edit'"));
  it('지문 → 시도 키 → 잠금 · 기억 · 납부 → 요청 읽기 거절 → 크레딧 확인 → 묶기 → 생성 한 줄 그대로', () => {
    const iFp = gen.indexOf('cutoutTempId: studioProductFingerprint(req.body)');
    const iKey = gen.indexOf('studioAttemptKey(');
    const iLock = gen.indexOf('tryAcquireGenerateLock(');
    const iPaid = gen.indexOf('isChargedByKey(');
    const iRead = gen.indexOf('readProductTempIds(req.body)');
    const iCredit = gen.indexOf('checkCredit(');
    const iGroup = gen.indexOf('groupProductCutouts(');
    const iGen = gen.indexOf('generatePoster(prompt, preset, cutout, { engine: studioImageEngine() })');
    for (const i of [iFp, iKey, iLock, iPaid, iRead, iCredit, iGroup, iGen]) expect(i).toBeGreaterThan(-1);
    expect(iKey).toBeLessThan(iFp);   // 지문은 시도 키 호출 안
    expect(iFp).toBeLessThan(iLock);
    expect(iPaid).toBeLessThan(iRead);
    expect(iRead).toBeLessThan(iCredit);
    expect(iCredit).toBeLessThan(iGroup);
    expect(iGroup).toBeLessThan(iGen);
    expect(gen).toContain('productCount: productIds.length');
    // 옛 단일 칸 직접 읽기는 남지 않는다(목록 하나로만 읽는다)
    expect(gen).not.toMatch(/const \{[^}]*\bcutoutTempId\b[^}]*\} = req\.body/);
  });
});
