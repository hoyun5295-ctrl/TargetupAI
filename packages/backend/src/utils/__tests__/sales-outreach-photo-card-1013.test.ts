// ★ 2026-10-13 AI 영업 최소 품질 장치(설계서 docs/2026-10-13-outreach-minimum-quality-design.md) — 사다리 = 주인공(누끼 → 사진 카드 → 없음) × 배경(AI → 코드)
import { describe, it, expect, vi } from 'vitest';
vi.mock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [] })), pool: { connect: vi.fn() }, default: { connect: vi.fn(), query: vi.fn() } }));
vi.mock('../../services/ai', () => ({ callAIWithFallback: vi.fn(async () => '') }));

import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  photoCardRect, photoCardAdmit, cutoutOpaqueRatio, cutoutAlphaOk, framePhotoCard, codeBackdrop, codeBackdropColors, hexRgb, normalizePhotoForCard,
  OUTREACH_PHOTO_CARD, OUTREACH_CANVAS_NOMINAL, OUTREACH_CUTOUT_ALPHA, POSTER_INK_ZONE,
  outreachTemplatePool, outreachSceneAllowed, OUTREACH_EVENT_SCENE_EXCLUDE_RE, templatePickCandidates, templateFromRank, pickTemplate, stripScaffoldProps, TEMPLATE_POOLS,
  heroRungOf, heroRungLabel, heroRungReasonText, posterFloorOf, floorMissText, measurePosterInkStats, measurePosterInkZone,
} from '../sales-outreach-produce';
import { INDUSTRY_CODES } from '../industry-codes';
import { getTemplate } from '../image-studio-templates';

const OCT = new Date('2026-10-13T03:00:00Z');
const N = OUTREACH_CANVAS_NOMINAL;

describe('D 카드 산식 photoCardRect(순수)', () => {
  it('자리 위 = 글자 띠 끝 상수 · 600² 는 1.5배로 통과(900 ≥ 717) · 자리 안', () => {
    expect(OUTREACH_PHOTO_CARD.box.top.y0).toBe(POSTER_INK_ZONE.top.to);
    const r = photoCardRect(N.top.width, N.top.height, 'top', 600, 600)!;
    expect(r).not.toBeNull();
    expect(r.scale).toBeCloseTo(1.5, 5);
    expect(r.shortPx).toBe(900);
    expect(r.top).toBeGreaterThanOrEqual(Math.round(N.top.height * 0.30));
    expect(r.top + r.height).toBeLessThanOrEqual(Math.round(N.top.height * 0.92));
    expect(r.left).toBeGreaterThanOrEqual(Math.round(N.top.width * 0.08));
  });
  it('게이트 = 사진 짧은 변 ≥ 0.40·S — 478² 통과 · 470² 탈락 · 3000×600 탈락 · 300² 탈락 · gate:false 면 크기만', () => {
    expect(photoCardRect(N.top.width, N.top.height, 'top', 478, 478)).not.toBeNull();
    expect(photoCardRect(N.top.width, N.top.height, 'top', 470, 470)).toBeNull();
    expect(photoCardRect(N.top.width, N.top.height, 'top', 3000, 600)).toBeNull();
    expect(photoCardRect(N.top.width, N.top.height, 'top', 300, 300)).toBeNull();
    const forced = photoCardRect(N.top.width, N.top.height, 'top', 300, 300, { gate: false })!;
    expect(forced.shortPx).toBe(450);
    expect(photoCardRect(0, 10, 'top', 1, 1)).toBeNull();
  });
  it('16:9 — 600² 통과(454 ≥ 432) · 세로 600×900 탈락 · 자리 = 글자 띠(0.55~) 위', () => {
    const r = photoCardRect(N.bottom.width, N.bottom.height, 'bottom', 600, 600)!;
    expect(r).not.toBeNull();
    expect(r.top + r.height).toBeLessThanOrEqual(Math.round(N.bottom.height * 0.52));
    expect(photoCardRect(N.bottom.width, N.bottom.height, 'bottom', 600, 900)).toBeNull();
  });
});

describe('C 카드 원천 정규화 normalizePhotoForCard(sharp · Codex 1R 회귀)', () => {
  it('EXIF 회전 사진은 회전 뒤 치수(900×600 · orientation 6 → 600×900)로 게이트를 본다', async () => {
    const jpg = await sharp({ create: { width: 900, height: 600, channels: 3, background: '#336699' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const n = (await normalizePhotoForCard(jpg))!;
    expect([n.width, n.height]).toEqual([600, 900]);
    // 회전 전 치수(900×600)면 16:9 게이트를 통과했지만 올바른 치수(600×900)로는 탈락한다
    expect(photoCardRect(N.bottom.width, N.bottom.height, 'bottom', 900, 600)).not.toBeNull();
    expect(photoCardRect(N.bottom.width, N.bottom.height, 'bottom', n.width, n.height)).toBeNull();
  });
  it('투명 여백은 trim 뒤 치수로 잰다 — 1000² 안 100² 제품은 100² 라 카드 게이트 탈락(여백이 최소 크기를 대신 못 채운다)', async () => {
    const png = await alphaPng(0, 1000, 1000);
    const block = await sharp({ create: { width: 100, height: 100, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 1 } } }).png().toBuffer();
    const withProduct = await sharp(png).composite([{ input: block, left: 450, top: 450 }]).png().toBuffer();
    const n = (await normalizePhotoForCard(withProduct))!;
    expect([n.width, n.height]).toEqual([100, 100]);
    expect(photoCardRect(N.top.width, N.top.height, 'top', n.width, n.height)).toBeNull();
    expect(photoCardRect(N.top.width, N.top.height, 'top', 1000, 1000)).not.toBeNull();
  });
  it('흰 여백 사진은 여백을 걷고 · 단색 전체는 원본 치수 · 깨진 입력 = null', async () => {
    const inner = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#aa2222' } }).png().toBuffer();
    const padded = await sharp({ create: { width: 700, height: 600, channels: 3, background: '#ffffff' } }).composite([{ input: inner, left: 200, top: 200 }]).png().toBuffer();
    const n = (await normalizePhotoForCard(padded))!;
    expect([n.width, n.height]).toEqual([300, 200]);
    const flat = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#777777' } }).png().toBuffer();
    const f = (await normalizePhotoForCard(flat))!;
    expect([f.width, f.height]).toEqual([64, 48]);
    expect(await normalizePhotoForCard(Buffer.from('nope'))).toBeNull();
  });
});

describe('C 카드 입장 photoCardAdmit(순수 · 회의론자 기준)', () => {
  it('product 통과 · photo·other 는 글자 없을 때만 · banner·document·판정 없음 금지 · 인물은 none 만', () => {
    expect(photoCardAdmit({ kind: 'product', text: true }, 'none').ok).toBe(true);
    expect(photoCardAdmit({ kind: 'photo', text: false }, 'none').ok).toBe(true);
    expect(photoCardAdmit({ kind: 'other', text: false }, 'none').ok).toBe(true);
    expect(photoCardAdmit({ kind: 'photo', text: true }, 'none')).toEqual({ ok: false, reason: 'text' });
    expect(photoCardAdmit({ kind: 'banner', text: false }, 'none')).toEqual({ ok: false, reason: 'banner' });
    expect(photoCardAdmit({ kind: 'document', text: false }, 'none')).toEqual({ ok: false, reason: 'document' });
    expect(photoCardAdmit(null, 'none')).toEqual({ ok: false, reason: 'no_judge' });
    expect(photoCardAdmit({ kind: 'product', text: false }, 'person')).toEqual({ ok: false, reason: 'person' });
    expect(photoCardAdmit({ kind: 'product', text: false }, 'undetermined')).toEqual({ ok: false, reason: 'person_unsure' });
    expect(photoCardAdmit({ kind: 'product', text: false }, null)).toEqual({ ok: false, reason: 'person_unsure' });
  });
});

async function alphaPng(opaqueW: number, w = 100, h = 100): Promise<Buffer> {
  const base = sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
  if (opaqueW <= 0) return base.png().toBuffer();
  const block = await sharp({ create: { width: opaqueW, height: h, channels: 4, background: { r: 10, g: 200, b: 30, alpha: 1 } } }).png().toBuffer();
  return base.composite([{ input: block, left: 0, top: 0 }]).png().toBuffer();
}

describe('B 누끼 알파 비율(sharp · AI 0)', () => {
  it('비율 실측 — 0% · 50% · 100%', async () => {
    expect(await cutoutOpaqueRatio(await alphaPng(0))).toBeCloseTo(0, 2);
    expect(await cutoutOpaqueRatio(await alphaPng(50))).toBeCloseTo(0.5, 1);
    expect(await cutoutOpaqueRatio(await alphaPng(100))).toBeCloseTo(1, 2);
    expect(await cutoutOpaqueRatio(Buffer.from('not an image'))).toBeNull();
  });
  it('판정 — rembg 는 0.08~0.85 · 알파 PNG 는 하한만 · 측정 실패 = 통과(현행)', () => {
    expect(OUTREACH_CUTOUT_ALPHA).toEqual({ min: 0.08, maxRembg: 0.85 });
    expect(cutoutAlphaOk(0.5, 'rembg')).toBe(true);
    expect(cutoutAlphaOk(0.95, 'rembg')).toBe(false);
    expect(cutoutAlphaOk(0.03, 'rembg')).toBe(false);
    expect(cutoutAlphaOk(0.95, 'alpha_png')).toBe(true);
    expect(cutoutAlphaOk(0.03, 'alpha_png')).toBe(false);
    expect(cutoutAlphaOk(null, 'rembg')).toBe(true);
  });
});

async function px(buf: Buffer, x: number, y: number): Promise<[number, number, number]> {
  const { data } = await sharp(buf).removeAlpha().raw().extract({ left: x, top: y, width: 1, height: 1 }).toBuffer({ resolveWithObject: true });
  return [data[0], data[1], data[2]];
}

describe('D 사진 카드 합성 framePhotoCard(sharp 픽셀)', () => {
  it('카드 가운데 = 사진 · 매트 = 흰색 · 글자 띠(0.15H) = 배경 · 카드 밖 모서리 = 배경 · 출력 = 캔버스 크기', async () => {
    const W = 400; const H = 533;
    const bg = await sharp({ create: { width: W, height: H, channels: 3, background: { r: 20, g: 40, b: 200 } } }).png().toBuffer();
    const photo = await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 30, g: 200, b: 40 } } }).png().toBuffer();
    const rect = photoCardRect(W, H, 'top', 200, 200, { gate: false })!;
    const out = await framePhotoCard(bg, photo, rect, W, H);
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height]).toEqual([W, H]);
    const center = await px(out, rect.left + Math.floor(rect.width / 2), rect.top + Math.floor(rect.height / 2));
    expect(center[1]).toBeGreaterThan(150); expect(center[2]).toBeLessThan(100);
    const mat = Math.round(OUTREACH_PHOTO_CARD.mat * W);
    const matPx = await px(out, rect.left - Math.ceil(mat / 2), rect.top + Math.floor(rect.height / 2));
    expect(matPx[0]).toBeGreaterThan(240); expect(matPx[1]).toBeGreaterThan(240); expect(matPx[2]).toBeGreaterThan(240);
    const band = await px(out, Math.floor(W / 2), Math.floor(H * 0.15));
    expect(band[2]).toBeGreaterThan(150); expect(band[1]).toBeLessThan(100);
    const corner = await px(out, 2, 2);
    expect(corner[2]).toBeGreaterThan(150);
  });
  it('카드가 캔버스 가장자리에 닿아도 던지지 않는다(오버레이를 잘라 넣는다)', async () => {
    const W = 320; const H = 180;
    const bg = await sharp({ create: { width: W, height: H, channels: 3, background: '#223344' } }).png().toBuffer();
    const photo = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#ffcc00' } }).png().toBuffer();
    const rect = { left: -10, top: 100, width: 200, height: 200, scale: 1, shortPx: 200 };
    const out = await framePhotoCard(bg, photo, rect, W, H);
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height]).toEqual([W, H]);
  });
});

describe('G 코드 배경(sharp · AI 0)', () => {
  it('색 = 브랜드 → accent → 중립 · 위가 더 밝다', async () => {
    expect(hexRgb('#1A2B3C')).toEqual({ r: 26, g: 43, b: 60 });
    expect(hexRgb('red')).toBeNull();
    expect(codeBackdropColors(null, '#123456').bottom).toBe('#123456');
    expect(codeBackdropColors('#aa0000', '#123456').bottom).toBe('#aa0000');
    expect(codeBackdropColors('x', 'y').bottom).toBe('#6b7280');
    const png = await codeBackdrop(64, 128, codeBackdropColors('#aa0000', null));
    const meta = await sharp(png).metadata();
    expect([meta.width, meta.height]).toEqual([64, 128]);
    const top = await px(png, 32, 2);
    const bottom = await px(png, 32, 125);
    expect(top[1]).toBeGreaterThan(bottom[1] + 60);
    expect(bottom[0]).toBeGreaterThan(150);
  });
});

describe('F 행사 장면 필터 · 정규식 보강', () => {
  it('전 업종 행사 풀 ≥ 3 · 남은 장면은 물건·숫자 낱말 0 · 제품 풀은 그대로', () => {
    for (const code of INDUSTRY_CODES) {
      const ev = outreachTemplatePool(code, 'event', OCT);
      expect(ev.length, `${code} event`).toBeGreaterThanOrEqual(3);
      expect(ev.every((t) => !OUTREACH_EVENT_SCENE_EXCLUDE_RE.test(t.scaffold)), `${code} scene`).toBe(true);
      const c = templatePickCandidates(code, OCT);
      expect(c.event.map((t) => t.id)).toEqual(ev.map((t) => t.id));
      expect(c.product.length).toBe(outreachTemplatePool(code, 'product', OCT).length);
      expect(TEMPLATE_POOLS[code].product.every((t) => outreachSceneAllowed(t))).toBe(true);
    }
  });
  it('물건·숫자를 그리는 행사 장면은 제외 — 선물 상자 · 향수병 · 숫자 달린 문 · 달력 띠', () => {
    for (const id of ['event-mem-pick-gift', 'event-day-adult', 'event-day-advent', 'event-season-longholiday']) {
      const t = getTemplate(id);
      expect(t, id).toBeTruthy();
      expect(outreachSceneAllowed(t!), id).toBe(false);
    }
    expect(pickTemplate('beauty', 'x:0', false, OCT).scaffold).not.toMatch(OUTREACH_EVENT_SCENE_EXCLUDE_RE);
  });
  it('저장된 순위도 다시 거른다 — 걸러낸 id 는 건너뛰고 전부 걸러지면 해시', () => {
    const allowed = outreachTemplatePool('beauty', 'event', OCT)[0].id;
    const fb = () => pickTemplate('beauty', 'x', false, OCT);
    expect(templateFromRank({ product: [], event: ['event-mem-pick-gift', allowed] }, 'event', 0, fb).id).toBe(allowed);
    expect(templateFromRank({ product: [], event: ['event-mem-pick-gift'] }, 'event', 0, fb).id).toBe(fb().id);
  });
  it('정규식 — product 가 든 자리 문장 3형(centered · standing · platform for the product)만 지우고 주문장은 남긴다', () => {
    const tiles = 'A small set built of glossy tiles, the product centered on the tiled floor, bright light. The upper third is the plain tiled wall. Fresh and clean.';
    expect(stripScaffoldProps(tiles)).not.toContain('product centered');
    expect(stripScaffoldProps(tiles)).toContain('upper third');
    const orchid = 'A single orchid stem casting a shadow, the product standing on a stone ledge beneath the shadow. The upper third is the wall.';
    expect(stripScaffoldProps(orchid)).not.toContain('product standing');
    const water = 'A hydration scene: clear water surface, a wet stone or glass platform for the product. Clean and dewy.';
    expect(stripScaffoldProps(water)).not.toContain('platform for the product');
    expect(stripScaffoldProps(water)).toContain('Clean and dewy');
    const keep = 'A long-standing tradition fills the hall. The crowd is centered around the stage. Only props here.';
    expect(stripScaffoldProps(keep)).toContain('long-standing');
    expect(stripScaffoldProps(keep)).toContain('centered around the stage');
    expect(stripScaffoldProps(keep)).not.toContain('props');
  });
});

describe('H 단 기록 · 최소선(순수)', () => {
  it('라벨 · 사유 문장', () => {
    expect(heroRungLabel('cutout', 'ai')).toBe('누끼');
    expect(heroRungLabel('photo_card', 'code')).toBe('사진 카드 · 코드 배경');
    expect(heroRungLabel('none', 'ai')).toBe('글자 포스터');
    expect(heroRungReasonText('cutout', 'ai', null)).toBeNull();
    expect(heroRungReasonText('photo_card', 'ai', 'low_res:480')).toContain('480');
    expect(heroRungReasonText('photo_card', 'ai', 'low_res:480')).toContain('사진 카드');
    expect(heroRungReasonText('none', 'code', 'text|digits_twice')).toContain('글자가 있어');
    expect(heroRungReasonText('none', 'code', 'text|digits_twice')).toContain('숫자가 두 번');
    expect(heroRungReasonText('cutout', 'code', 'bg_failed')).toContain('배경 생성에 실패');
  });
  it('최소선 — 주인공 없음 · 제목 = 업체명 · AI 배경 숫자 · 폰트 없음 · 코드 배경은 digits 제외', () => {
    expect(posterFloorOf({ subject: 'cutout', bg: 'ai', title: '가을 세일', companyName: '헤라', digits: false, fontPath: '/f.ttf' })).toEqual({ ok: true, miss: [] });
    expect(posterFloorOf({ subject: 'none', bg: 'ai', title: '헤라', companyName: '헤라', digits: true, fontPath: null }).miss).toEqual(['subject', 'title', 'digits', 'font']);
    expect(posterFloorOf({ subject: 'none', bg: 'code', title: '가을', companyName: '헤라', digits: true, fontPath: '/f' }).miss).toEqual(['subject']);
    expect(floorMissText(['title'])).toContain('업체명');
    expect(floorMissText([])).toBeNull();
  });
  it('heroRungOf — 새 행은 그대로 · 옛 행은 usedCutout 으로 추정(label 만) · 이미지 없는 행 = null', () => {
    const fresh = { url: 'u', heroRung: { poster: { subject: 'photo_card', bg: 'ai', label: '사진 카드', reasonText: 'x' }, banner: null, floor: { ok: true, miss: [] } } };
    expect(heroRungOf(fresh)!.poster.label).toBe('사진 카드');
    expect(heroRungOf({ url: 'u', usedCutout: true })!.poster).toMatchObject({ subject: 'cutout', bg: 'ai', label: '누끼', reasonText: null });
    expect(heroRungOf({ url: 'u', usedCutout: false })!.poster.label).toBe('글자 포스터');
    expect(heroRungOf({ url: null, usedCutout: true })).toBeNull();
    expect(heroRungOf(null)).toBeNull();
  });
});

describe('H 글자 띠 표준편차(sharp) — 기존 평균 함수는 그대로', () => {
  it('고른 배경 = 편차 0 근처 · 체크무늬 = 편차 큼 · 평균 함수 반환 불변', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-'));
    const flat = path.join(dir, 'flat.png');
    fs.writeFileSync(flat, await sharp({ create: { width: 64, height: 64, channels: 3, background: '#808080' } }).png().toBuffer());
    const s = await measurePosterInkStats(flat, 'top');
    expect(s!.std).toBeLessThan(1);
    expect(await measurePosterInkZone(flat, 'top')).toBeCloseTo(s!.mean, 3);
    const half = await sharp({ create: { width: 32, height: 64, channels: 3, background: '#ffffff' } }).png().toBuffer();
    const checker = path.join(dir, 'checker.png');
    fs.writeFileSync(checker, await sharp({ create: { width: 64, height: 64, channels: 3, background: '#000000' } }).composite([{ input: half, left: 0, top: 0 }]).png().toBuffer());
    expect((await measurePosterInkStats(checker, 'top'))!.std).toBeGreaterThan(100);
    expect(await measurePosterInkStats(path.join(dir, 'none.png'), 'top')).toBeNull();
  });
});

describe('배선 계약(소스 문자열) — throw 0 · 카드도 제품 순위 · 배경 원본만 검사 · photo 는 누끼 후보에 남는다', () => {
  const produce = fs.readFileSync(path.join(__dirname, '..', 'sales-outreach-produce.ts'), 'utf8');
  const jobs = fs.readFileSync(path.join(__dirname, '..', 'sales-outreach-jobs.ts'), 'utf8');
  it('숫자 2회 throw 가 없다 · 코드 배경 폴백 두 자리(숫자 2회 · 생성 실패)', () => {
    expect(produce).not.toContain("throw new Error('포스터 배경에 숫자가 두 번 나와");
    expect(produce).toContain("posterBgReason = retry ? 'digits_twice' : 'bg_failed'");
    expect(produce).toContain("posterBgReason = 'bg_failed'");
    expect(produce).toContain("made = await renderComposite('top', preset, '', 'code')");
  });
  it('템플릿 분기·진열면 지시 = 주인공 유무(누끼 또는 카드)', () => {
    expect(produce).toContain("hasSubject ? 'product' : 'event'");
    expect(produce).toContain('posterStyleHint(input.brandColor || null, false, hasSubject)');
  });
  it('유출 검사는 made.bgPath(배경 원본) · 합성 입력은 composeBg(카드 중간본) 로 분리', () => {
    expect(produce).toContain('posterScore = await scoreBg(made.bgPath)');
    expect(produce).toContain('bgPath: composeBg, cutoutPath: cutoutPath');
    expect(produce).toContain('return { absPath: out.absPath, tempId: out.tempId, composed, bgPath, ink, bg: bgSource');
  });
  it('Codex 1R — 검사 장애만 삼키고(scoreBg) 코드 배경 합성 실패는 전파 · 알파 여부보다 기존 판정 · 입장 전 정규화 버퍼로 합성', () => {
    // 코드 배경 폴백이 "유출 검사 건너뜀" catch 안에 있지 않다: 그 문구는 scoreBg 헬퍼 한 곳에만 있다
    const skipMsg = produce.split("포스터 유출 검사 건너뜀").length - 1;
    expect(skipMsg).toBe(1);
    expect(produce).toContain("const scoreBg = async (p: string)");
    expect(produce).toContain("const judge = cardKinds[srcUrl] || (isAlphaPng ? { kind: 'product' as const, text: false } : null);");
    expect(produce).toContain("} else if (kind === 'banner' || kind === 'document') {");
    expect(produce).toContain('const norm = admit.ok ? await normalizePhotoForCard(img.buffer) : null;');
    expect(produce).toContain('card = { buffer: norm.buffer, from: srcUrl, width: norm.width, height: norm.height, reason: fail };');
  });
  it('jobs — 누끼 후보 제외는 banner·document 만 · cardKinds·designatedUrls·heroRung 전달', () => {
    expect(jobs).toContain("const notCutout = (k: string | null | undefined) => k === 'banner' || k === 'document';");
    expect(jobs).toMatch(/cardKinds,\s+designatedUrls,\s+\}\);/);
    expect(jobs).toContain('heroRung: img.heroRung,');
  });
});
