/**
 * C112 이미지 스튜디오 브랜드 로고 층(★ 2026-11-07 설계서 docs/2026-11-07-c112-studio-brand-logo-design.md §5)
 *   Z 자리 표 · 판 규칙(순수) · L 로고 원본(안전 변환 · 흰 로고 · 회사 격리 · 상태 캐시)
 *   ★ 2026-11-07 C113 D8 = 외부 주소 캐시 10분 · 확정 키 = 주소 + 그림 내용 · 상태가 읽은 바이트로 비교 · 합성 / D9 = 홈페이지 로고 찾기 · 저장 두 단계
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import crypto from 'crypto';

// 저장 경로는 모듈 로드 시점에 env 로 굳는다 — import 보다 먼저 정한다(brand-image-resolver.test.ts 와 같은 꼴)
const DIRS = vi.hoisted(() => {
  const nodeFs = require('fs') as typeof import('fs');
  const nodeOs = require('os') as typeof import('os');
  const nodePath = require('path') as typeof import('path');
  const root = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'c112-'));
  const d = { logo: nodePath.join(root, 'logos'), inapp: nodePath.join(root, 'inapp'), temp: nodePath.join(root, 'temp') };
  process.env.STUDIO_LOGO_PATH = d.logo;
  process.env.INAPP_IMAGE_PATH = d.inapp;
  process.env.STUDIO_TEMP_PATH = d.temp;
  return d;
});

import {
  allowedLogoCorners, logoTargetSize, logoSizeOptions, logoPlacement, contrastRatio, srgbLuminance, needsPlate, plateTone,
  LOGO_CORNERS,
} from '../studio-zones';
import { safeLogoPng, logoLooksWhite, companyStoredImagePath, studioLogoState, logoConfirmKey, LOGO_REMOTE_TTL_MS, type LogoSourceDeps } from '../studio-logo';

const CO = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const solidPng = (w: number, h: number, rgb: [number, number, number], alpha = 1) =>
  sharp({ create: { width: w, height: h, channels: 4, background: { r: rgb[0], g: rgb[1], b: rgb[2], alpha } } }).png().toBuffer();

describe('Z 자리 표 — 모서리 · 크기 · 여백(D5 · D6 · D14)', () => {
  it('글 없는 판 = 위 두 모서리만 · 보통 = 네 모서리(같으면 왼쪽 위 · 오른쪽 위 · 오른쪽 아래 · 왼쪽 아래)', () => {
    expect(allowedLogoCorners(true)).toEqual(['tl', 'tr']);
    expect(allowedLogoCorners(false)).toEqual(['tl', 'tr', 'br', 'bl']);
    expect([...LOGO_CORNERS]).toEqual(['tl', 'tr', 'br', 'bl']);
  });

  it('크기 = 포스터 폭 12 · 18 · 24% · 비율 유지(포스터 1000×1333 · 로고 400×200)', () => {
    expect(logoTargetSize(1000, 1333, 400, 200, 's')).toEqual({ width: 120, height: 60 });
    expect(logoTargetSize(1000, 1333, 400, 200, 'm')).toEqual({ width: 180, height: 90 });
    expect(logoTargetSize(1000, 1333, 400, 200, 'l')).toEqual({ width: 240, height: 120 });
  });

  it('세로로 긴 로고 = 높이 상한(보통 = 포스터 높이 9% = 120)', () => {
    expect(logoTargetSize(1000, 1333, 100, 400, 'm')).toEqual({ width: 30, height: 120 });
  });

  it('원본보다 크게 키우지 않는다 · 작게는 늘 고를 수 있고 원본 크기로', () => {
    expect(logoTargetSize(1000, 1333, 100, 50, 's')).toEqual({ width: 100, height: 50 });
    expect(logoSizeOptions(1000, 1333, 100, 50)).toEqual([{ id: 's', ok: true }, { id: 'm', ok: false }, { id: 'l', ok: false }]);
    expect(logoSizeOptions(1000, 1333, 400, 200)).toEqual([{ id: 's', ok: true }, { id: 'm', ok: true }, { id: 'l', ok: true }]);
  });

  it('자리 = 여백 4%(포스터 1000 = 40) · 상자가 포스터 안', () => {
    const box = { width: 200, height: 100 };
    expect(logoPlacement(1000, 1333, box, 'tl')).toEqual({ left: 40, top: 40 });
    expect(logoPlacement(1000, 1333, box, 'tr')).toEqual({ left: 760, top: 40 });
    expect(logoPlacement(1000, 1333, box, 'br')).toEqual({ left: 760, top: 1193 });
    expect(logoPlacement(1000, 1333, box, 'bl')).toEqual({ left: 40, top: 1193 });
    expect(logoPlacement(100, 100, { width: 99, height: 99 }, 'br')).toEqual({ left: 0, top: 0 });
  });
});

describe('Z 판 규칙 — WCAG 비텍스트 대비 3:1(D7)', () => {
  it('대비 = WCAG 공개 예시(흰 · 검정 21:1 · #767676 · 흰 4.54:1)', () => {
    expect(contrastRatio(srgbLuminance(255), srgbLuminance(0))).toBeCloseTo(21, 5);
    expect(contrastRatio(srgbLuminance(0x76), srgbLuminance(255))).toBeCloseTo(4.54, 2);
  });

  it('어두운 로고 + 고른 밝은 자리 = 판 없음 · 밝고 어두운 곳이 섞인 자리 = 판', () => {
    const black = srgbLuminance(0);
    const white = srgbLuminance(255);
    expect(needsPlate(black, white, white)).toBe(false);
    expect(needsPlate(black, black, white)).toBe(true);
    expect(needsPlate(srgbLuminance(100), srgbLuminance(128), srgbLuminance(128))).toBe(true);
  });

  it('판 색 = 로고와 대비가 큰 쪽(어두운 로고 = 흰 판 · 흰 로고 = 짙은 판)', () => {
    expect(plateTone(srgbLuminance(20))).toBe('light');
    expect(plateTone(srgbLuminance(250))).toBe('dark');
  });
});

describe('L 안전 변환 — 형식 · 픽셀 상한 · 줄인 PNG · 폭 60(D4)', () => {
  it('png · jpeg · webp = 통과 · 원본 크기 기록 · 1024 안으로 줄임', async () => {
    const png = await safeLogoPng(await solidPng(400, 200, [10, 20, 30]));
    expect(png).toMatchObject({ ok: true, width: 400, height: 200, sourceWidth: 400, sourceHeight: 200 });
    const jpg = await safeLogoPng(await sharp({ create: { width: 300, height: 100, channels: 3, background: '#123456' } }).jpeg().toBuffer());
    expect(jpg).toMatchObject({ ok: true, width: 300, height: 100 });
    const webp = await safeLogoPng(await sharp({ create: { width: 200, height: 200, channels: 3, background: '#654321' } }).webp().toBuffer());
    expect(webp).toMatchObject({ ok: true, width: 200 });
    const big = await safeLogoPng(await solidPng(2000, 1000, [0, 0, 0]));
    expect(big).toMatchObject({ ok: true, width: 1024, height: 512, sourceWidth: 2000, sourceHeight: 1000 });
    if (big.ok) expect((await sharp(big.png).metadata()).format).toBe('png');
  });

  it('svg · gif · 그림 아님 = 형식 · 폭 59 = 작음', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100"/></svg>');
    expect(await safeLogoPng(svg)).toEqual({ ok: false, reason: 'format' });
    const gif = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#000000' } }).gif().toBuffer();
    expect(await safeLogoPng(gif)).toEqual({ ok: false, reason: 'format' });
    expect(await safeLogoPng(Buffer.from('not an image'))).toEqual({ ok: false, reason: 'format' });
    expect(await safeLogoPng(await solidPng(59, 59, [0, 0, 0]))).toEqual({ ok: false, reason: 'small' });
  });

  it('2,500만 화소를 넘는 그림 = 디코드 전에 거절(형식)', async () => {
    const huge = await sharp({ create: { width: 5100, height: 5000, channels: 3, background: '#ffffff' } }).png().toBuffer();
    expect(await safeLogoPng(huge)).toEqual({ ok: false, reason: 'format' });
  });
});

describe('L 흰 로고 — 지금 pngLooksWhite 와 같은 기준(불투명 화소 90% 이상이 밝기 0.9 이상)', () => {
  it('흰 로고 = 참 · 어두운 로고 = 거짓 · 불투명 화소가 거의 없으면 거짓', async () => {
    expect(await logoLooksWhite(await solidPng(200, 100, [250, 250, 250]))).toBe(true);
    expect(await logoLooksWhite(await solidPng(200, 100, [30, 30, 30]))).toBe(false);
    expect(await logoLooksWhite(await solidPng(200, 100, [255, 255, 255], 0))).toBe(false);
  });
});

describe('L 우리 저장본 = 이 회사 폴더 바로 안 파일만(D4)', () => {
  it('같은 회사 저장본 꼴 = 경로(파일 유무는 읽을 때) · 다른 회사 · 폴더 밖 = foreign · 우리 꼴 아님 = null', async () => {
    fs.mkdirSync(path.join(DIRS.inapp, CO), { recursive: true });
    fs.writeFileSync(path.join(DIRS.inapp, CO, 'logo.png'), await solidPng(100, 100, [0, 0, 0]));
    expect(companyStoredImagePath(CO, `/api/cdp/inapp/image/${CO}/logo.png`)).toBe(path.join(DIRS.inapp, CO, 'logo.png'));
    expect(companyStoredImagePath(CO, `https://hanjul.ai/api/cdp/inapp/image/${CO}/logo.png?v=1`)).toBe(path.join(DIRS.inapp, CO, 'logo.png'));
    // 다른 회사 폴더에 실제 파일이 있어도(그 회사에겐 경로) 이 회사에겐 foreign = 폴더 판정이 거른다
    fs.mkdirSync(path.join(DIRS.inapp, OTHER), { recursive: true });
    fs.writeFileSync(path.join(DIRS.inapp, OTHER, 'logo.png'), await solidPng(100, 100, [0, 0, 0]));
    expect(companyStoredImagePath(OTHER, `/api/cdp/inapp/image/${OTHER}/logo.png`)).toBe(path.join(DIRS.inapp, OTHER, 'logo.png'));
    expect(companyStoredImagePath(CO, `/api/cdp/inapp/image/${OTHER}/logo.png`)).toBe('foreign');
    expect(companyStoredImagePath(CO, `/api/cdp/inapp/image/${CO}/none.png`)).toBe(path.join(DIRS.inapp, CO, 'none.png'));
    expect(companyStoredImagePath(CO, '/api/dm/v/images/../secret.png')).toBe('foreign');
    expect(companyStoredImagePath(CO, `/api/dm/v/images/${CO}/..`)).toBe('foreign');
    expect(companyStoredImagePath(CO, `/api/dm/v/images/${OTHER}/a.png`)).toBe('foreign');
    expect(companyStoredImagePath(CO, 'https://example.com/logo.png')).toBeNull();
  });
});

describe('L 로고 상태 — 키트 logo_url 하나 · 주소 해시 캐시 · 바뀌면 새로(D4 · D12)', () => {
  const deps = (kit: Record<string, unknown> | null, fetchImage: LogoSourceDeps['fetchImage']): LogoSourceDeps => ({ readKit: async () => kit as any, fetchImage });

  it('키트 없음 = none · 홈페이지 주소는 미리 채움용으로 돌려준다', async () => {
    expect(await studioLogoState(CO, deps(null, vi.fn()))).toEqual({ state: 'none', homepage: null });
    expect(await studioLogoState(CO, deps({ contact: { website: ' https://shop.example.com ' } }, vi.fn()))).toEqual({ state: 'none', homepage: 'https://shop.example.com' });
  });

  it('https 주소 = 가드 가져오기 1번 · 다음은 캐시 · 주소가 바뀌면 새로 받고 옛 캐시를 지운다', async () => {
    const co = '33333333-3333-4333-8333-333333333333';
    const png = await solidPng(400, 200, [10, 10, 10]);
    const fetchImage = vi.fn(async () => ({ buffer: png, mime: 'image/png', ext: 'png' }));
    const a = await studioLogoState(co, deps({ logo_url: 'https://cdn.example.com/a.png' }, fetchImage));
    expect(a).toMatchObject({ state: 'ready', width: 400, height: 200 });
    const b = await studioLogoState(co, deps({ logo_url: 'https://cdn.example.com/a.png' }, fetchImage));
    expect(b).toEqual(a);
    expect(fetchImage).toHaveBeenCalledTimes(1);
    const c = await studioLogoState(co, deps({ logo_url: 'https://cdn.example.com/b.png' }, fetchImage));
    expect(c.state === 'ready' && a.state === 'ready' && c.key !== a.key).toBe(true);
    expect(fetchImage).toHaveBeenCalledTimes(2);
    const addrKey = crypto.createHash('sha256').update('https://cdn.example.com/b.png').digest('hex').slice(0, 24);
    expect(fs.readdirSync(path.join(DIRS.logo, co))).toEqual([`${addrKey}.png`]);   // 캐시 = 주소 키 · 화면 키 = 확정 키(C113 D8)
    expect((c as any).key).toBe(logoConfirmKey(addrKey, (c as any).png));
  });

  it('우리 저장본 = 디스크에서 읽는다(가져오기 0)', async () => {
    const fetchImage = vi.fn();
    const s = await studioLogoState(CO, deps({ logo_url: `/api/cdp/inapp/image/${CO}/logo.png` }, fetchImage));
    expect(s).toMatchObject({ state: 'ready', width: 100, height: 100 });
    expect(fetchImage).not.toHaveBeenCalled();
  });

  it('svg = 형식(다음에 다시 받지 않는다) · 작음 · http · 다른 회사 저장본 = 쓸 수 없음 · 가져오기 실패 = fetch(다음에 다시 받는다)', async () => {
    const co = '44444444-4444-4444-8444-444444444444';
    const svg = vi.fn(async () => ({ buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"/>'), mime: 'image/svg+xml', ext: 'svg' }));
    expect(await studioLogoState(co, deps({ logo_url: 'https://cdn.example.com/x.svg' }, svg))).toEqual({ state: 'unusable', reason: 'format' });
    expect(await studioLogoState(co, deps({ logo_url: 'https://cdn.example.com/x.svg' }, svg))).toEqual({ state: 'unusable', reason: 'format' });
    expect(svg).toHaveBeenCalledTimes(1);
    const tiny = await solidPng(40, 40, [0, 0, 0]);
    expect(await studioLogoState(co, deps({ logo_url: 'https://cdn.example.com/t.png' }, async () => ({ buffer: tiny, mime: 'image/png', ext: 'png' })))).toEqual({ state: 'unusable', reason: 'small' });
    expect(await studioLogoState(co, deps({ logo_url: 'http://cdn.example.com/h.png' }, vi.fn()))).toEqual({ state: 'unusable', reason: 'format' });
    expect(await studioLogoState(co, deps({ logo_url: `/api/cdp/inapp/image/${OTHER}/logo.png` }, vi.fn()))).toEqual({ state: 'unusable', reason: 'format' });
    const fail = vi.fn(async () => null);
    expect(await studioLogoState(co, deps({ logo_url: 'https://cdn.example.com/f.png' }, fail))).toEqual({ state: 'unusable', reason: 'fetch' });
    await studioLogoState(co, deps({ logo_url: 'https://cdn.example.com/f.png' }, fail));
    expect(fail).toHaveBeenCalledTimes(2);
  });

  it('이 회사 저장본이 지금 없음 · 읽기 실패 = fetch(표시 파일 0) · 파일이 생기면 다음 요청에 바로 준비됨', async () => {
    const co = '55555555-5555-4555-8555-555555555555';
    const url = `/api/cdp/inapp/image/${co}/later.png`;
    expect(await studioLogoState(co, deps({ logo_url: url }, vi.fn()))).toEqual({ state: 'unusable', reason: 'fetch' });
    expect(fs.existsSync(path.join(DIRS.logo, co)) ? fs.readdirSync(path.join(DIRS.logo, co)) : []).toEqual([]);
    fs.mkdirSync(path.join(DIRS.inapp, co), { recursive: true });
    fs.writeFileSync(path.join(DIRS.inapp, co, 'later.png'), await solidPng(300, 120, [20, 20, 20]));
    expect(await studioLogoState(co, deps({ logo_url: url }, vi.fn()))).toMatchObject({ state: 'ready', width: 300, height: 120 });
  });

  it('★ C113 D8 외부 주소 = 10분 안 캐시 · 10분 넘으면 다시 받아 그림이 바뀌면 확정 키도 바뀜 · 못 받으면 옛 그림(시각 갱신 = 다음 10분 동안 다시 안 받음)', async () => {
    const co = '88888888-8888-4888-8888-888888888888';
    const url = 'https://cdn.example.com/brand.png';
    const v1 = await solidPng(400, 200, [10, 10, 10]);
    const v2 = await solidPng(400, 200, [200, 30, 30]);
    let serve: Buffer | null = v1;
    const fetchImage = vi.fn(async () => (serve ? { buffer: serve, mime: 'image/png', ext: 'png' } : null));
    const t0 = Date.now();
    const a = await studioLogoState(co, deps({ logo_url: url }, fetchImage), () => t0);
    const b = await studioLogoState(co, deps({ logo_url: url }, fetchImage), () => t0 + LOGO_REMOTE_TTL_MS - 60_000);   // 9분 = 안 받음
    expect(fetchImage).toHaveBeenCalledTimes(1);
    expect((b as any).key).toBe((a as any).key);
    serve = v2;
    const c = await studioLogoState(co, deps({ logo_url: url }, fetchImage), () => t0 + LOGO_REMOTE_TTL_MS + 60_000);   // 11분 = 다시 받음
    expect(fetchImage).toHaveBeenCalledTimes(2);
    expect(c.state).toBe('ready');
    expect((c as any).key).not.toBe((a as any).key);   // 같은 주소 · 다른 그림 = 다른 확정 키(저장이 LOGO_CHANGED 로 막는다)
    serve = null;   // 받기 실패
    const t1 = t0 + 2 * LOGO_REMOTE_TTL_MS + 120_000;
    const d = await studioLogoState(co, deps({ logo_url: url }, fetchImage), () => t1);
    expect(fetchImage).toHaveBeenCalledTimes(3);
    expect((d as any).key).toBe((c as any).key);   // 옛(마지막으로 받은) 그림
    await studioLogoState(co, deps({ logo_url: url }, fetchImage), () => t1 + 60_000);   // 시각을 갱신했으니 다시 안 받음
    expect(fetchImage).toHaveBeenCalledTimes(3);
  });

  it('★ C113 D8 우리 저장본 = 기한 없음(디스크에서 바로 · 가져오기 0) · ready 에 그 순간 읽은 바이트', async () => {
    const fetchImage = vi.fn();
    const s1 = await studioLogoState(CO, deps({ logo_url: `/api/cdp/inapp/image/${CO}/logo.png` }, fetchImage), () => Date.now() + 10 * LOGO_REMOTE_TTL_MS);
    expect(s1.state).toBe('ready');
    expect(Buffer.isBuffer((s1 as any).png)).toBe(true);
    expect(fetchImage).not.toHaveBeenCalled();
  });
});

// ── P 계획 · 합성 · 미리보기(D1 · D5 ~ D7 · D15) ──────────────────────────
import { planLogo, renderLogoComposite, renderLogoPreview } from '../studio-logo';

/** 흰 바탕(폭 × 높이) · paint = 칠할 사각형들(회색 값) · busy = 4px 바둑판(어수선한 자리) */
async function baseFile(name: string, w: number, h: number, opts: { busy?: Array<{ left: number; top: number; width: number; height: number }>; fill?: number } = {}): Promise<string> {
  const ch = 3;
  const buf = Buffer.alloc(w * h * ch, opts.fill ?? 255);
  for (const r of opts.busy || []) {
    for (let y = r.top; y < r.top + r.height; y++) for (let x = r.left; x < r.left + r.width; x++) {
      const v = ((Math.floor(x / 4) + Math.floor(y / 4)) % 2) ? 0 : 255;
      const i = (y * w + x) * ch;
      buf[i] = v; buf[i + 1] = v; buf[i + 2] = v;
    }
  }
  const f = path.join(DIRS.temp, '..', name);
  await sharp(buf, { raw: { width: w, height: h, channels: ch } }).png().toFile(f);
  return f;
}
async function logoFile(name: string, w: number, h: number, rgb: [number, number, number]): Promise<{ path: string; png: Buffer; width: number; height: number }> {
  const f = path.join(DIRS.temp, '..', name);
  await sharp(await solidPng(w, h, rgb)).toFile(f);
  return { path: f, png: fs.readFileSync(f), width: w, height: h };   // ★ C113 D8 합성 = 상태가 읽은 바이트
}
const px = async (buf: Buffer, x: number, y: number) => {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [data[i], data[i + 1], data[i + 2]];
};

describe('P 계획 · 합성 — 판 · 자리 · 결정적(D5 ~ D7)', () => {
  it('흰 바탕 + 어두운 로고 = 판 없음 · 결과 = 바탕 크기 JPEG · 로고 화소가 왼쪽 위 자리에', async () => {
    const base = await baseFile('p-white.png', 1000, 1333);
    const logo = await logoFile('p-dark.png', 400, 200, [20, 20, 20]);
    const plan = await planLogo(base, logo, { corner: 'tl', size: 'm' }, false);
    if ('error' in plan) throw new Error(plan.error);
    expect(plan.plate).toBeNull();
    expect(plan.logo.width).toBe(180);
    expect(plan.logo.height).toBe(90);
    const out = await renderLogoComposite(base, logo.png, plan);
    const m = await sharp(out).metadata();
    expect([m.format, m.width, m.height]).toEqual(['jpeg', 1000, 1333]);
    const c = await px(out, plan.logo.left + 90, plan.logo.top + 45);
    expect(Math.max(...c)).toBeLessThan(60);
    const far = await px(out, 900, 1200);
    expect(Math.min(...far)).toBeGreaterThan(240);
  });

  it('어수선한 자리(바둑판) = 판 · 어두운 로고 = 흰 판(판 여백 화소가 밝다)', async () => {
    const base = await baseFile('p-busy.png', 1000, 1333, { busy: [{ left: 0, top: 0, width: 400, height: 300 }] });
    const logo = await logoFile('p-dark2.png', 400, 200, [20, 20, 20]);
    const plan = await planLogo(base, logo, { corner: 'tl', size: 'm' }, false);
    if ('error' in plan) throw new Error(plan.error);
    expect(plan.plate).not.toBeNull();
    expect(plan.plate!.tone).toBe('light');
    const out = await renderLogoComposite(base, logo.png, plan);
    const edge = await px(out, plan.plate!.left + Math.round(plan.plate!.width / 2), plan.plate!.top + 3);
    expect(Math.min(...edge)).toBeGreaterThan(200);
  });

  it('기본 모서리 = 가장 조용한 곳 · 글 없는 판이면 아래가 조용해도 위에서', async () => {
    const W = 1000, H = 1333, B = { width: 330, height: 200 };
    const base = await baseFile('p-auto.png', W, H, { busy: [
      { left: 0, top: 0, ...B },                       // 왼쪽 위
      { left: W - B.width, top: 0, width: B.width, height: 60 },   // 오른쪽 위 = 조금만
      { left: 0, top: H - B.height, ...B },             // 왼쪽 아래
    ] });
    const logo = await logoFile('p-dark3.png', 400, 200, [20, 20, 20]);
    const auto = await planLogo(base, logo, { corner: null, size: null }, false);
    if ('error' in auto) throw new Error(auto.error);
    expect(auto.corner).toBe('br');
    expect(auto.size).toBe('m');
    expect(auto.corners).toEqual(['tl', 'tr', 'br', 'bl']);
    const tl = await planLogo(base, logo, { corner: null, size: null }, true);
    if ('error' in tl) throw new Error(tl.error);
    expect(tl.corner).toBe('tr');
    expect(tl.corners).toEqual(['tl', 'tr']);
  });

  it('허용 밖 = 오류(글 없는 판 + 아래 모서리 · 고를 수 없는 크기)', async () => {
    const base = await baseFile('p-white2.png', 1000, 1333);
    const small = await logoFile('p-small.png', 100, 50, [0, 0, 0]);
    expect(await planLogo(base, small, { corner: 'bl', size: 's' }, true)).toEqual({ error: 'corner' });
    expect(await planLogo(base, small, { corner: 'tl', size: 'l' }, false)).toEqual({ error: 'size' });
    const p = await planLogo(base, small, { corner: 'tl', size: null }, false);
    if ('error' in p) throw new Error(p.error);
    expect(p.size).toBe('s');
    expect([p.logo.width, p.logo.height]).toEqual([100, 50]);
    expect(p.sizes).toEqual([{ id: 's', ok: true }, { id: 'm', ok: false }, { id: 'l', ok: false }]);
  });

  it('같은 입력 두 번 = 같은 바이트(미리보기 · 저장이 같은 함수) · 미리보기 = 폭 1080 이하 data URL · 임시 폴더 쓰기 0', async () => {
    const base = await baseFile('p-det.png', 1500, 2000);
    const logo = await logoFile('p-dark4.png', 400, 200, [20, 20, 20]);
    const plan = await planLogo(base, logo, { corner: null, size: null }, false);
    if ('error' in plan) throw new Error(plan.error);
    const a = await renderLogoComposite(base, logo.png, plan);
    const b = await renderLogoComposite(base, logo.png, plan);
    expect(a.equals(b)).toBe(true);
    const before = fs.existsSync(DIRS.temp) ? fs.readdirSync(DIRS.temp, { recursive: true } as any).length : 0;
    const url = await renderLogoPreview(base, logo.png, plan);
    expect(url.startsWith('data:image/jpeg;base64,')).toBe(true);
    const meta = await sharp(Buffer.from(url.slice('data:image/jpeg;base64,'.length), 'base64')).metadata();
    expect(meta.width).toBe(1080);
    const after = fs.existsSync(DIRS.temp) ? fs.readdirSync(DIRS.temp, { recursive: true } as any).length : 0;
    expect(after).toBe(before);
  });
});

// ── S 저장 1 · 2단계(D3 · 영구 이름 = 바탕 id) ──────────────────────────
import { logoSaveStage, readLogoSaveLayers, type LogoSaveDeps } from '../studio-logo';
import { writeTempBuffer, findTempFile, findPermanentByTempId, discardTemp } from '../image-studio';

describe('S 저장 — 바탕 하나 = 소재 하나 · 기존 복구 이름 그대로', () => {
  const SCO = '55555555-5555-4555-8555-555555555555';
  let readyLogo: { path: string; png: Buffer; width: number; height: number };
  const KEY = 'a'.repeat(24);
  const makeBase = async () => writeTempBuffer(SCO, await sharp(await solidPng(900, 1200, [240, 240, 240])).png().toBuffer(), {
    kind: 'poster', ext: 'png', mime: 'image/png', prompt: 'p', presetKey: 'poster', channelSpec: 'poster', aspectRatio: '3:4', width: null, height: null,
  });
  const permPath = (id: string) => path.join(DIRS.inapp, SCO, `${id}.jpeg`);
  const layersOn = (over: Partial<{ corner: string; size: string; key: string }> = {}) =>
    readLogoSaveLayers({ logo: { on: true, corner: 'tl', size: 's', key: KEY, ...over } }) as any;
  const mk = (over: Partial<LogoSaveDeps> & { assets?: Map<string, string> } = {}) => {
    const assets = over.assets || new Map<string, string>();
    const registerConfirmed = vi.fn(async (input: any) => { const id = `asset-${assets.size + 1}`; assets.set(input.url, id); return { id, registered: 'yes' as const }; });
    const { assets: _a, ...rest } = over;
    const deps: LogoSaveDeps = {
      logoState: async () => ({ state: 'ready', key: KEY, ...readyLogo }),
      storageUsage: async () => ({ usedBytes: 0, limitBytes: 1e12 }),
      assetByUrl: async (_c, url) => (assets.has(url) ? { id: assets.get(url)!, channel_spec: 'poster' } : null),
      registerConfirmed,
      discardBase: (c, id) => discardTemp(c, id),
      ...rest,
    };
    return { deps, assets, registerConfirmed: (over.registerConfirmed as any) || registerConfirmed };
  };
  const ctx = (tempId: string, layers: any) => ({ companyId: SCO, userId: null, tempId, title: '봄 신상', channelSpec: undefined, layers });

  it('layers 읽기 — 켜짐 · 허용 값 · 키 꼴 · 끔 · 없음', () => {
    expect(readLogoSaveLayers(undefined)).toBeNull();
    expect(readLogoSaveLayers({ logo: { on: false } })).toBeNull();
    expect(readLogoSaveLayers({ logo: { on: true, corner: 'tl', size: 'm', key: KEY }, textless: true })).toEqual({ corner: 'tl', size: 'm', key: KEY, textless: true });
    expect(readLogoSaveLayers({ logo: { on: true, corner: 'xx', size: 'm', key: KEY } })).toBe('invalid');
    expect(readLogoSaveLayers({ logo: { on: true, corner: 'tl', size: 'xl', key: KEY } })).toBe('invalid');
    expect(readLogoSaveLayers({ logo: { on: true, corner: 'tl', size: 'm', key: '../x' } })).toBe('invalid');
  });

  it('켜짐 = 영구 이름 {바탕 id}.jpeg · 바탕 크기 JPEG · 등재 뒤 바탕 그림 · 사이드카 삭제', async () => {
    readyLogo = await logoFile('s-logo.png', 400, 200, [20, 20, 20]);
    const base = await makeBase();
    const { deps, registerConfirmed } = mk();
    const r = await logoSaveStage(ctx(base, layersOn()), deps);
    expect(r?.status).toBe(200);
    expect((r!.body as any).asset.url).toBe(`/api/cdp/inapp/image/${SCO}/${base}.jpeg`);
    const m = await sharp(permPath(base)).metadata();
    expect([m.format, m.width, m.height]).toEqual(['jpeg', 900, 1200]);
    expect(findTempFile(SCO, base)).toBeNull();
    expect(registerConfirmed).toHaveBeenCalledTimes(1);
    // 바탕이 지워진 뒤의 재요청 = 지금 판정이 쓰는 이름 그대로 찾힌다
    expect(findPermanentByTempId(SCO, base)?.url).toBe(`/api/cdp/inapp/image/${SCO}/${base}.jpeg`);
  });

  it('등재 모름 503 뒤 = 같은 설정 · 다른 설정 · 끔 재요청 모두 두 번째 등재 0(소재가 있으면 그 소재)', async () => {
    for (const retry of [layersOn(), layersOn({ corner: 'br', size: 's' }), null]) {
      const base = await makeBase();
      const assets = new Map<string, string>();
      let first = true;
      const registerConfirmed = vi.fn(async (input: any) => {
        assets.set(input.url, 'asset-x');                          // 커밋은 됐는데
        if (first) { first = false; return { id: null, registered: 'unknown' as const }; }   // 확인 실패
        return { id: 'asset-y', registered: 'yes' as const };
      });
      const { deps } = mk({ assets, registerConfirmed });
      const r1 = await logoSaveStage(ctx(base, layersOn()), deps);
      expect(r1?.status).toBe(503);
      expect(fs.existsSync(permPath(base))).toBe(true);
      expect(findTempFile(SCO, base)).not.toBeNull();
      const r2 = await logoSaveStage(ctx(base, retry), deps);
      expect(r2?.status).toBe(200);
      expect((r2!.body as any).asset.id).toBe('asset-x');
      expect(registerConfirmed).toHaveBeenCalledTimes(1);
      expect(findTempFile(SCO, base)).toBeNull();
    }
  });

  it('0행 확정 뒤 = 켜짐은 그 이름에 덮어써 등재 · 끔은 그 파일을 지우고 지금 갈래로(바탕 그대로)', async () => {
    const base = await makeBase();
    const assets = new Map<string, string>();
    const registerConfirmed = vi.fn(async () => ({ id: null, registered: 'unknown' as const }));
    const { deps } = mk({ assets, registerConfirmed });
    expect((await logoSaveStage(ctx(base, layersOn()), deps))?.status).toBe(503);
    const off = await logoSaveStage(ctx(base, null), deps);
    expect(off).toBeNull();
    expect(fs.existsSync(permPath(base))).toBe(false);
    expect(findTempFile(SCO, base)).not.toBeNull();

    const base2 = await makeBase();
    const reg2 = vi.fn()
      .mockResolvedValueOnce({ id: null, registered: 'unknown' as const })
      .mockImplementationOnce(async (input: any) => { assets.set(input.url, 'asset-z'); return { id: 'asset-z', registered: 'yes' as const }; });
    const d2 = mk({ assets, registerConfirmed: reg2 }).deps;
    expect((await logoSaveStage(ctx(base2, layersOn({ corner: 'tl' })), d2))?.status).toBe(503);
    const again = await logoSaveStage(ctx(base2, layersOn({ corner: 'br' })), d2);
    expect(again?.status).toBe(200);
    expect(reg2).toHaveBeenCalledTimes(2);
    expect(findTempFile(SCO, base2)).toBeNull();
  });

  it('등재 없음 = 영구 파일 지우고 바탕 그대로 503 · 저장 공간 초과 = 409 · 파일 0 · 바탕 그대로', async () => {
    const base = await makeBase();
    const { deps } = mk({ registerConfirmed: vi.fn(async () => ({ id: null, registered: 'no' as const })) });
    const r = await logoSaveStage(ctx(base, layersOn()), deps);
    expect(r?.status).toBe(503);
    expect(fs.existsSync(permPath(base))).toBe(false);
    expect(findTempFile(SCO, base)).not.toBeNull();
    const full = await logoSaveStage(ctx(base, layersOn()), mk({ storageUsage: async () => ({ usedBytes: 100, limitBytes: 101 }) }).deps);
    expect(full?.status).toBe(409);
    expect((full!.body as any).code).toBe('STORAGE_FULL');
    expect(fs.existsSync(permPath(base))).toBe(false);
    expect(findTempFile(SCO, base)).not.toBeNull();
  });

  it('로고를 지금 쓸 수 없음 = 409 LOGO_UNAVAILABLE · 키 다름 = 409 LOGO_CHANGED(합성 전 · 파일 0)', async () => {
    const base = await makeBase();
    const un = await logoSaveStage(ctx(base, layersOn()), mk({ logoState: async () => ({ state: 'unusable', reason: 'format' }) }).deps);
    expect([un?.status, (un!.body as any).code]).toEqual([409, 'LOGO_UNAVAILABLE']);
    const ch = await logoSaveStage(ctx(base, layersOn({ key: 'b'.repeat(24) })), mk().deps);
    expect([ch?.status, (ch!.body as any).code]).toEqual([409, 'LOGO_CHANGED']);
    expect(fs.existsSync(permPath(base))).toBe(false);
  });

  it('바탕 지우기 실패 = 200 · 다음 요청이 1단계에서 그 소재로 마무리', async () => {
    const base = await makeBase();
    const assets = new Map<string, string>();
    const failing = mk({ assets, discardBase: () => { throw new Error('EBUSY'); } });
    expect((await logoSaveStage(ctx(base, layersOn()), failing.deps))?.status).toBe(200);
    expect(findTempFile(SCO, base)).not.toBeNull();
    const ok = mk({ assets });
    const r = await logoSaveStage(ctx(base, layersOn({ corner: 'br' })), ok.deps);
    expect(r?.status).toBe(200);
    expect(ok.registerConfirmed).not.toHaveBeenCalled();
    expect(findTempFile(SCO, base)).toBeNull();
  });

  it('바탕 없음 · 옛 MMS 사양 · 끔(남은 영구 파일 없음) = 지금 갈래로(null)', async () => {
    expect(await logoSaveStage(ctx('66666666-6666-4666-8666-666666666666', layersOn()), mk().deps)).toBeNull();
    const base = await makeBase();
    expect(await logoSaveStage({ ...ctx(base, layersOn()), channelSpec: 'mms' }, mk().deps)).toBeNull();
    expect(await logoSaveStage(ctx(base, null), mk().deps)).toBeNull();
    expect(fs.existsSync(permPath(base))).toBe(false);
  });
});

// ── H 홈페이지 로고 찾기 · 저장 두 단계(C112 D11 · ★ C113 D9) ──────────────
import { readHomepageLogo, useHomepageLogo, type HomepageLogoDeps } from '../studio-logo';
import { readTempMeta } from '../image-studio';

describe('H 홈페이지 로고 — 찾기 = 임시 후보(키트 · 영구 쓰기 0) · 저장 = 영구로 옮겨 키트 빈 칸에만', () => {
  const HCO = '77777777-7777-4777-8777-777777777777';
  const HTML = '<html><head><link rel="apple-touch-icon" href="/apple.png"></head><body><img class="site-logo" src="/img/logo.gif"><img src="/img/logo-main.png" alt="logo"></body></html>';
  const mkDeps = (kit: Record<string, unknown>, images: Record<string, Buffer | null>, over: Partial<HomepageLogoDeps> = {}) => {
    const fetchImage = vi.fn(async (u: string) => (images[u] ? { buffer: images[u]!, mime: 'image/png', ext: 'png' } : null));
    const deps: HomepageLogoDeps = {
      readKit: async () => kit as any,
      fetchImage,
      fetchHtml: vi.fn(async () => ({ html: HTML, baseUrl: 'https://shop.example.com/', finalUrl: 'https://shop.example.com/' })),
      setLogoIfEmpty: vi.fn(async (_c: string, url: string) => { if (kit.logo_url) return false; kit.logo_url = url; return true; }),
      ...over,
    };
    return { deps, fetchImage };
  };
  const inappFiles = () => (fs.existsSync(path.join(DIRS.inapp, HCO)) ? fs.readdirSync(path.join(DIRS.inapp, HCO)).sort() : []);
  const good = () => solidPng(320, 120, [20, 40, 60]);

  it('이미 찬 키트 = 페이지를 읽지 않고 지금 상태', async () => {
    const kitPng = await solidPng(300, 150, [10, 10, 10]);
    fs.mkdirSync(path.join(DIRS.inapp, HCO), { recursive: true });
    fs.writeFileSync(path.join(DIRS.inapp, HCO, 'kit.png'), kitPng);
    const { deps } = mkDeps({ logo_url: `/api/cdp/inapp/image/${HCO}/kit.png` }, {});
    const r = await readHomepageLogo(HCO, 'shop.example.com', deps);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ success: true, saved: false, logo: { state: 'ready' } });
    expect(deps.fetchHtml).not.toHaveBeenCalled();
  });

  it('주소 꼴 = 400 · 페이지 못 읽음 = 422', async () => {
    const { deps } = mkDeps({}, {});
    expect((await readHomepageLogo(HCO, 'not a url', deps)).status).toBe(400);
    const r = await readHomepageLogo(HCO, 'shop.example.com', { ...deps, fetchHtml: async () => null });
    expect([r.status, (r.body as any).code]).toEqual([422, 'READ_FAILED']);
  });

  it('찾기 = img logo 먼저 · gif 건너뜀 · 통과한 첫 PNG = 임시 후보(보기 data URL) · 키트 · 영구 쓰기 0 → 저장 = 영구 · 빈 칸 · 같은 후보 다시 저장 = 404', async () => {
    const kit: Record<string, unknown> = {};
    const gif = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#000000' } }).gif().toBuffer();
    const { deps, fetchImage } = mkDeps(kit, {
      'https://shop.example.com/img/logo.gif': gif,
      'https://shop.example.com/img/logo-main.png': await good(),
      'https://shop.example.com/apple.png': await solidPng(180, 180, [0, 0, 0]),
    });
    const before = inappFiles();
    const r = await readHomepageLogo(HCO, 'https://shop.example.com', deps);
    expect(r.status).toBe(200);
    const cand = (r.body as any).candidate;
    expect(cand.preview.startsWith('data:image/png;base64,')).toBe(true);
    expect(readTempMeta(HCO, cand.tempId)?.kind).toBe('logo');
    expect(fetchImage.mock.calls.map((c) => c[0])).toEqual(['https://shop.example.com/img/logo.gif', 'https://shop.example.com/img/logo-main.png']);
    expect(deps.setLogoIfEmpty).not.toHaveBeenCalled();
    expect(kit.logo_url).toBeUndefined();
    expect(inappFiles()).toEqual(before);

    const u = await useHomepageLogo(HCO, cand.tempId, deps);
    expect(u.status).toBe(200);
    expect(u.body).toMatchObject({ success: true, saved: true, logo: { state: 'ready' } });
    expect(kit.logo_url).toBe(`/api/cdp/inapp/image/${HCO}/${cand.tempId}.png`);
    expect(findTempFile(HCO, cand.tempId)).toBeNull();
    expect((await sharp(path.join(DIRS.inapp, HCO, `${cand.tempId}.png`)).metadata()).format).toBe('png');
    expect((await useHomepageLogo(HCO, cand.tempId, deps)).status).toBe(404);
  });

  it('흰 로고 · 작은 그림 · 400KB 초과 · 2,500만 화소 = 건너뜀 · 다 걸러지면 422(임시 0)', async () => {
    const bad: Record<string, Buffer> = {
      'https://shop.example.com/img/logo.gif': await solidPng(200, 100, [252, 252, 252]),
      'https://shop.example.com/img/logo-main.png': await solidPng(50, 50, [0, 0, 0]),
      'https://shop.example.com/apple.png': Buffer.concat([await solidPng(300, 100, [0, 0, 0]), Buffer.alloc(400_001)]),
    };
    const none = mkDeps({}, bad);
    const tempBefore = fs.existsSync(path.join(DIRS.temp, HCO)) ? fs.readdirSync(path.join(DIRS.temp, HCO)).length : 0;
    const r = await readHomepageLogo(HCO, 'https://shop.example.com', none.deps);
    expect([r.status, (r.body as any).code]).toEqual([422, 'LOGO_NOT_FOUND']);
    const huge = await sharp({ create: { width: 5100, height: 5000, channels: 3, background: '#000000' } }).png().toBuffer();
    const r2 = await readHomepageLogo(HCO, 'https://shop.example.com', mkDeps({}, { 'https://shop.example.com/img/logo-main.png': huge }).deps);
    expect(r2.status).toBe(422);
    const tempAfter = fs.existsSync(path.join(DIRS.temp, HCO)) ? fs.readdirSync(path.join(DIRS.temp, HCO)).length : 0;
    expect(tempAfter).toBe(tempBefore);
  });

  it('저장 사이 다른 경로가 로고를 넣었으면 = 덮지 않고 saved 거짓 · 옮긴 사본 지움', async () => {
    const kit: Record<string, unknown> = {};
    const { deps } = mkDeps(kit, { 'https://shop.example.com/img/logo-main.png': await good() }, { setLogoIfEmpty: vi.fn(async () => false) });
    const cand = ((await readHomepageLogo(HCO, 'https://shop.example.com', deps)).body as any).candidate;
    const u = await useHomepageLogo(HCO, cand.tempId, deps);
    expect(u.status).toBe(200);
    expect((u.body as any).saved).toBe(false);
    expect(kit.logo_url).toBeUndefined();
    expect(fs.existsSync(path.join(DIRS.inapp, HCO, `${cand.tempId}.png`))).toBe(false);
  });

  it('저장 중 키트 쓰기 오류 = 그대로 올린다(옮긴 사본은 남긴다: 커밋 여부를 모른다)', async () => {
    const { deps } = mkDeps({}, { 'https://shop.example.com/img/logo-main.png': await good() }, {
      setLogoIfEmpty: vi.fn(async () => { throw new Error('invalid input syntax for type json'); }),
    });
    const cand = ((await readHomepageLogo(HCO, 'https://shop.example.com', deps)).body as any).candidate;
    await expect(useHomepageLogo(HCO, cand.tempId, deps)).rejects.toThrow('invalid input syntax');
    expect(fs.existsSync(path.join(DIRS.inapp, HCO, `${cand.tempId}.png`))).toBe(true);
  });

  it('로고 후보가 아닌 임시(포스터) = 404 · 꼴이 틀린 id = 400 · 그 사이 키트가 찼으면 후보를 버리고 saved 거짓', async () => {
    const poster = writeTempBuffer(HCO, await good(), { kind: 'poster', ext: 'png', mime: 'image/png' });
    const { deps } = mkDeps({}, {});
    expect((await useHomepageLogo(HCO, poster, deps)).status).toBe(404);
    expect((await useHomepageLogo(HCO, '../x', deps)).status).toBe(400);
    const kit: Record<string, unknown> = {};
    const two = mkDeps(kit, { 'https://shop.example.com/img/logo-main.png': await good() });
    const cand = ((await readHomepageLogo(HCO, 'https://shop.example.com', two.deps)).body as any).candidate;
    kit.logo_url = `/api/cdp/inapp/image/${HCO}/kit.png`;
    const u = await useHomepageLogo(HCO, cand.tempId, two.deps);
    expect((u.body as any).saved).toBe(false);
    expect(findTempFile(HCO, cand.tempId)).toBeNull();
    expect(two.deps.setLogoIfEmpty).not.toHaveBeenCalled();
  });
});

// ── V 미리보기 단계(/layers · D1 · D2 · D8) ──────────────────────────
import { previewLogoStage, readLayerPreviewRequest } from '../studio-logo';

describe('V 미리보기 — 응답 안 그림 · 확정 설정 · 파일 0', () => {
  const VCO = '88888888-8888-4888-8888-888888888888';
  const KEY = 'c'.repeat(24);
  let logo: { path: string; width: number; height: number };
  const poster = async (kind: 'poster' | 'cutout' = 'poster') => writeTempBuffer(VCO, await sharp(await solidPng(900, 1200, [240, 240, 240])).png().toBuffer(), {
    kind, ext: 'png', mime: 'image/png', prompt: 'p', presetKey: 'poster', channelSpec: 'poster', aspectRatio: '3:4', width: null, height: null,
  });
  const ready = () => ({ logoState: async () => ({ state: 'ready' as const, key: KEY, ...logo }) });

  it('요청 읽기 — on 은 참 · 거짓만 · 모서리 · 크기는 비거나 허용 값', () => {
    expect(readLayerPreviewRequest({ on: true })).toEqual({ on: true, corner: null, size: null });
    expect(readLayerPreviewRequest({ on: false, corner: 'br', size: 'l' })).toEqual({ on: false, corner: 'br', size: 'l' });
    expect(readLayerPreviewRequest({ on: 'yes' })).toBe('invalid');
    expect(readLayerPreviewRequest({ on: true, corner: 'middle' })).toBe('invalid');
    expect(readLayerPreviewRequest(null)).toBe('invalid');
  });

  it('바탕 없음 · 포스터가 아닌 임시 그림 = 404', async () => {
    logo = await logoFile('v-logo.png', 400, 200, [20, 20, 20]);
    expect((await previewLogoStage(VCO, '99999999-9999-4999-8999-999999999999', { on: true, corner: null, size: null }, false, ready())).status).toBe(404);
    const cut = await poster('cutout');
    expect((await previewLogoStage(VCO, cut, { on: true, corner: null, size: null }, false, ready())).status).toBe(404);
  });

  it('키트 로고 없음 = 200 · 미리보기 null · 상태만', async () => {
    const b = await poster();
    const r = await previewLogoStage(VCO, b, { on: true, corner: null, size: null }, false, { logoState: async () => ({ state: 'none', homepage: 'https://shop.example.com' }) });
    expect(r).toEqual({ status: 200, body: { success: true, logo: { state: 'none', homepage: 'https://shop.example.com' }, preview: null } });
  });

  it('켜짐 = 확정 설정(키 · 자리 · 크기 · 칩) + 미리보기 · 끔 = 미리보기 null + 자리 · 칩 그대로 · 임시 파일 수 변화 0', async () => {
    const b = await poster();
    const dir = path.join(DIRS.temp, VCO);
    const before = fs.readdirSync(dir).length;
    const on = await previewLogoStage(VCO, b, { on: true, corner: null, size: null }, false, ready());
    expect(on.status).toBe(200);
    const body = on.body as any;
    expect(body.logo).toMatchObject({ state: 'ready', on: true, key: KEY, size: 'm', plate: false, corners: ['tl', 'tr', 'br', 'bl'] });
    expect(['tl', 'tr', 'br', 'bl']).toContain(body.logo.corner);
    expect(body.preview.startsWith('data:image/jpeg;base64,')).toBe(true);
    const off = await previewLogoStage(VCO, b, { on: false, corner: 'br', size: 's' }, false, ready());
    expect(off.body).toMatchObject({ success: true, preview: null, logo: { state: 'ready', on: false, corner: 'br', size: 's' } });
    expect(JSON.stringify(on.body)).not.toContain(logo.path);
    expect(fs.readdirSync(dir).length).toBe(before);
  });

  it('글 없는 판 + 아래 모서리 = 400', async () => {
    const b = await poster();
    expect((await previewLogoStage(VCO, b, { on: true, corner: 'bl', size: null }, true, ready())).status).toBe(400);
  });
});

// ── F 화면 판단 순수 함수(frontend lib · backend vitest 가 import · D8 · D9 · D11 · D12) ──────────
import {
  logoRowView, layersForSave, logoSettingsOf, layerRequest, logoUnusableText,
  LOGO_SAVED_TEXT, LOGO_SMALL_SIZE_TEXT,
} from '../../../../frontend/src/lib/studio-layers';

describe('F 로고 줄 보기 · 저장 layers — 두 결과 화면이 같은 함수', () => {
  const ready = (over: Record<string, unknown> = {}) => ({
    state: 'ready' as const, on: true, corner: 'tr' as const, size: 'm' as const, key: 'd'.repeat(24), plate: false,
    corners: ['tl', 'tr', 'br', 'bl'] as Array<'tl' | 'tr' | 'br' | 'bl'>, sizes: [{ id: 's' as const, ok: true }, { id: 'm' as const, ok: true }, { id: 'l' as const, ok: true }],
    ...over,
  });

  it('저장한 카드 = 바꿀 수 없다는 한 줄(준비됨이어도)', () => {
    expect(logoRowView({ saved: true, failed: false, logo: ready() })).toEqual({ mode: 'saved', text: LOGO_SAVED_TEXT });
  });

  it('미리보기 실패 = 다시 얹기 · 미리보기 전 = 숨김', () => {
    expect(logoRowView({ saved: false, failed: true, logo: null })).toMatchObject({ mode: 'failed', action: '다시 얹기' });
    expect(logoRowView({ saved: false, failed: false, logo: null })).toEqual({ mode: 'hidden' });
  });

  it('키트 로고 없음 = 홈페이지 읽기(주소 미리 채움) · 쓸 수 없음 = 사유(가져오기 실패만 다시 얹기)', () => {
    expect(logoRowView({ saved: false, failed: false, logo: { state: 'none', homepage: 'https://shop.example.com' } }))
      .toEqual({ mode: 'read', text: '브랜드 키트에 로고가 없어요', hint: '저장하면 DM과 이메일에도 이 로고가 쓰여요', button: '로고 찾기', homepage: 'https://shop.example.com' });   // ★ C113 D9 찾기 · 저장 두 단계
    expect(logoRowView({ saved: false, failed: false, logo: { state: 'unusable', reason: 'format' } })).toEqual({ mode: 'note', text: logoUnusableText('format'), action: null });
    expect(logoRowView({ saved: false, failed: false, logo: { state: 'unusable', reason: 'fetch' } })).toMatchObject({ mode: 'note', action: '다시 얹기' });
    expect(logoUnusableText('small')).toContain('너무 작아요');
  });

  it('준비됨 = 스위치 · 서버가 준 모서리(읽는 순서) · 고를 수 있는 크기만 칩 · 하나뿐이면 칩 0 · 못 고르는 크기가 있으면 이유 한 줄', () => {
    const v = logoRowView({ saved: false, failed: false, logo: ready({ corners: ['tl', 'tr'], sizes: [{ id: 's', ok: true }, { id: 'm', ok: false }, { id: 'l', ok: false }], size: 's' }) });
    expect(v).toEqual({
      mode: 'controls', on: true, corner: 'tr', size: 's',
      corners: [{ id: 'tl', label: '왼쪽 위' }, { id: 'tr', label: '오른쪽 위' }],
      sizes: [],
      sizeNote: LOGO_SMALL_SIZE_TEXT,
    });
    const all = logoRowView({ saved: false, failed: false, logo: ready({ corners: ['br', 'tl', 'bl', 'tr'] }) }) as any;
    expect(all.sizeNote).toBeNull();
    expect(all.sizes.map((x: any) => x.label)).toEqual(['작게', '보통', '크게']);
    expect(all.corners.map((x: any) => x.label)).toEqual(['왼쪽 위', '오른쪽 위', '왼쪽 아래', '오른쪽 아래']);
  });

  it('저장 layers = 서버 확정 설정이 켜짐일 때만(끔 · 없음 · 실패 · 미리보기 전 = null = 바탕 그대로)', () => {
    expect(layersForSave(ready(), false, true)).toEqual({ logo: { on: true, corner: 'tr', size: 'm', key: 'd'.repeat(24) }, textless: true });
    expect(layersForSave(ready({ on: false }), false, false)).toBeNull();
    expect(layersForSave(ready(), true, false)).toBeNull();
    expect(layersForSave({ state: 'none', homepage: null }, false, false)).toBeNull();
    expect(layersForSave(null, false, false)).toBeNull();
  });

  it('지금 설정 = 확정 값(AI 수정 · 다시 얹기 뒤 같은 자리) · 없으면 켜짐 · 자동 · 미리보기 요청 몸', () => {
    expect(logoSettingsOf(ready({ on: false, corner: 'bl', size: 'l' }))).toEqual({ on: false, corner: 'bl', size: 'l' });
    expect(logoSettingsOf(null)).toEqual({ on: true, corner: null, size: null });
    expect(layerRequest('b', { on: true, corner: null, size: null }, false)).toEqual({ baseTempId: 'b', logo: { on: true, corner: null, size: null }, textless: false });
  });
});
