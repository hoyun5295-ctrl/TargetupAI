/**
 * ★ 2026-11-08 C116-B 옛 연동 앱 출력 = 모든 고객사 앱 공통 규칙 하나 — 계약 시험(설계서 docs/2026-11-08-c116b-inapp-universal-output-design.md §4 VB1 ~ VB12)
 *   뿌리 R83(남의 렌더러 칸 규칙에 서버 출력을 맞춤 · 한 앱 공식 일반화) · R-값문구(서버 동작 = 안내 · 미리보기)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { ASPECT_RATIOS, INAPP_STAGE_FILL, inAppStageColor } from '../image-fit-spec';
import { fitToCanvas, getServePath, SERVE_MAX_WIDTH } from '../image-serve';
import { composeInAppBakeSlide, requestInAppBake, INAPP_BAKE_VERSION, __inAppBakeTest, type InAppBakeJob } from '../inapp-bake';
import { withInAppImageFit, inAppBakePlan, legacyServeTransform, toServedMessage, gateInAppForClient } from '../inapp-message';
import { trustedImageHosts } from '../brand-image-resolver';
import { POSTER_FRAME_RULES } from '../../../../sdk-js/src/poster-frame';
import {
  legacyAppImageUrl, legacyAppPreviewOf, legacyAppWillBake, inAppImageOwnership, legacyStageOf,
  LEGACY_BAKE_SAFE, LEGACY_STAGE_FILL, LEGACY_FIT_REV, DEFAULT_OWN_IMAGE_HOSTS, type OwnHostsSnapshot,
} from '../../../../frontend/src/components/inapp/legacy-app-view';

const CO = '11111111-2222-3333-4444-555555555555';
const IMG = (n: number | string) => `/api/cdp/inapp/image/${CO}/p${n}.jpg`;
const NONE = new Set<string>();
const READY: OwnHostsSnapshot = { status: 'ready', hosts: DEFAULT_OWN_IMAGE_HOSTS };
const fe = (rel: string) => fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'frontend', 'src', ...rel.split('/')), 'utf8');
const msg = (design: any, slides: Array<Record<string, any>>, over: Record<string, any> = {}): any => ({
  id: 'aaaaaaaa-0000-0000-0000-000000000001', template: 'full_image', title: '제목', body: '본문', badgeText: null, imageUrl: slides[0]?.image_url ?? IMG(0),
  buttons: [{ id: 'b1', label: '바로가기', action_url: 'https://www.invitocorp.com', style: 'primary' }],
  endAt: '2026-11-30T14:59:00.000Z', design, status: 'active', variantWeight: 100, posterSlides: slides, ...over,
});

describe('VB1 규격 하나', () => {
  it('정사각 · 가운데 80% × 80% · 무대색 = SDK 여러 장 칸 채움 · rev 2', () => {
    expect(ASPECT_RATIOS.inapp).toEqual({ w: 1, h: 1, rev: 2, safe: { w: 0.8, h: 0.8, fill: INAPP_STAGE_FILL } });
    expect(INAPP_STAGE_FILL).toBe(POSTER_FRAME_RULES.multiFill);
  });
  it('화면 상수 = 서버 상수(안전 칸 · 무대색 · rev)', () => {
    expect(LEGACY_BAKE_SAFE).toEqual({ w: 0.8, h: 0.8 });
    expect(LEGACY_STAGE_FILL).toBe(INAPP_STAGE_FILL);
    expect(LEGACY_FIT_REV).toBe(ASPECT_RATIOS.inapp.rev);
  });
  it('무대색 판정 = 장 bg_color(3 · 6자리) · 아니면 기본 · 화면 = 서버', () => {
    for (const v of ['#fff', '#FFFFFF', '#123abc', '#12345678', '#1234', 'red', '', null, undefined, ' #abc ']) {
      expect(legacyStageOf(v)).toBe(inAppStageColor(v));
    }
    expect(inAppStageColor('#12345678')).toBe(INAPP_STAGE_FILL);
    expect(inAppStageColor(' #abc ')).toBe('#abc');
  });
});

describe('VB2 · VB3 실제 서빙(무대색 · rev 폴더 · 옛 변환본 안 씀)', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c116b-serve-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const noise = async (w: number, h: number, file: string) => {
    const raw = Buffer.alloc(w * h * 3);
    for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24;   // 결정적 잡음(가장자리가 고르지 않은 사진 = 옛 갈래면 흐림)
    const p = path.join(dir, file);
    await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toFile(p);
    return p;
  };
  const corner = async (buf: Buffer) => {
    const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    return [[0, 0], [info.width - 1, 0], [0, info.height - 1], [info.width - 1, info.height - 1]].map(([x, y]) => {
      const o = (y * info.width + x) * info.channels; return [data[o], data[o + 1], data[o + 2]];
    });
  };
  it('VB2 잡음 사진도 빈자리 = 무대색 단색(흐림 0)', async () => {
    const p = await noise(300, 500, 'n.png');
    const out = await fitToCanvas(fs.readFileSync(p), 1000, 1000, 'pad', ASPECT_RATIOS.inapp.safe!);
    for (const c of await corner(out)) expect(c.map((v, k) => Math.abs(v - [0x11, 0x18, 0x27][k]) <= 2)).toEqual([true, true, true]);
  });
  it('VB3 rev 폴더 = 1400-inapp-pad-r2 · 옛 폴더(1400-inapp-pad)에 더 새 변환본이 있어도 안 씀 · 1x1 폴더 이름 그대로', async () => {
    const p = await noise(400, 600, 'a.png');
    const old = path.join(dir, '.serve', `${SERVE_MAX_WIDTH}-inapp-pad`);
    fs.mkdirSync(old, { recursive: true });
    fs.writeFileSync(path.join(old, 'a.png'), Buffer.from('옛 변환본'));
    const out = await getServePath(p, { aspect: 'inapp', mode: 'pad' });
    expect(out.split(path.sep).slice(-2)[0]).toBe(`${SERVE_MAX_WIDTH}-inapp-pad-r2`);
    expect(fs.readFileSync(out).equals(Buffer.from('옛 변환본'))).toBe(false);
    const sq = await getServePath(p, { aspect: '1x1', mode: 'pad' });
    expect(sq.split(path.sep).slice(-2)[0]).toBe(`${SERVE_MAX_WIDTH}-1x1-pad`);
  });
});

describe('VB4 구운 그림 합성(투명 모서리 → 무대 · 정사각 · 가운데 80% · 늘리지 않음)', () => {
  const card = async (w: number, h: number) => {
    // 빨간 둥근 카드(모서리 밖 = 투명)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect x="0" y="0" width="${w}" height="${h}" rx="${Math.round(w * 0.12)}" fill="#ff0000"/></svg>`;
    return sharp(Buffer.from(svg)).png().toBuffer();
  };
  const px = async (buf: Buffer, fx: number, fy: number) => {
    const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
    const x = Math.round((info.width - 1) * fx), y = Math.round((info.height - 1) * fy);
    const o = (y * info.width + x) * info.channels; return [data[o], data[o + 1], data[o + 2]];
  };
  const near = (a: number[], b: number[]) => a.every((v, k) => Math.abs(v - b[k]) <= 12);
  it('세로로 긴 카드 = 정사각 JPEG · 귀퉁이 · 카드 둥근 모서리 밖 = 무대색 · 가운데 = 카드 · 내용 = 가운데 80%', async () => {
    const out = await composeInAppBakeSlide(await card(600, 900), '#00ff00');
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(meta.height);
    expect(meta.width).toBe(Math.ceil(900 / 0.8));
    for (const [fx, fy] of [[0, 0], [1, 1], [0.5, 0.05], [0.5, 0.95]]) expect(near(await px(out, fx, fy), [0, 255, 0])).toBe(true);
    expect(near(await px(out, 0.5, 0.5), [255, 0, 0])).toBe(true);
    // 카드 왼쪽 위 둥근 모서리 바로 밖(카드 상자 귀퉁이) = 무대색(흰 귀퉁이 0)
    const side = meta.width!, cw = 900 * (600 / 900), x0 = (side - cw) / 2 / side, y0 = 0.1;
    expect(near(await px(out, x0 + 0.002, y0 + 0.002), [0, 255, 0])).toBe(true);
  });
  it('무대색이 꼴이 아니면 기본 · 큰 그림 = SERVE_MAX_WIDTH 상한', async () => {
    const out = await composeInAppBakeSlide(await card(1500, 2000), 'red');
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(SERVE_MAX_WIDTH);
    expect(near(await px(out, 0, 0), [0x11, 0x18, 0x27])).toBe(true);
  });
});

describe('VB6 · VB7 장마다 무대색 · 판', () => {
  beforeEach(() => __inAppBakeTest.reset());
  it('판정 stages = 장 bg_color(꼴 맞음) · 아니면 기본 · 길이 = 장 수', () => {
    const m = msg({ poster_frame: 'card' }, [{ image_url: IMG(0), bg_color: '#ffffff' }, { image_url: IMG(1), bg_color: 'red' }, { image_url: IMG(2), bg_color: '#ff000080' }]);
    const p = inAppBakePlan(m, NONE, CO);
    expect(p.bake).toBe(true);
    if (!p.bake) return;
    expect(p.stages).toEqual(['#ffffff', INAPP_STAGE_FILL, INAPP_STAGE_FILL]);
    expect(p.stages.length).toBe(p.expected);
  });
  it('일감 무대색 길이 · 꼴이 어긋나면 invalid', () => {
    __inAppBakeTest.setRunner(() => new Promise(() => {}));
    const base: InAppBakeJob = { companyId: CO, messageId: 'm', key: 'a'.repeat(24), expected: 2, payload: {}, stages: ['#111827', '#111827'] };
    expect(requestInAppBake({ ...base, stages: ['#111827'] })).toBe('invalid');
    expect(requestInAppBake({ ...base, stages: ['#111827', 'red'] })).toBe('invalid');
    expect(requestInAppBake({ ...base, stages: undefined as any })).toBe('invalid');
    expect(requestInAppBake(base)).toBe('queued');
  });
  it('굽기 판 3(최종 정사각 그림 · ★ C118 인앱용 full 합성)', () => expect(INAPP_BAKE_VERSION).toBe(3));
});

describe('VB8 맞춤 주소 정규화(멱등 · 입구 무관)', () => {
  const Q = `fit=inapp&fr=${ASPECT_RATIOS.inapp.rev}`;
  const table: Array<[string, string]> = [
    [IMG(1), `${IMG(1)}?${Q}`],
    [`${IMG(1)}?fit=inapp`, `${IMG(1)}?${Q}`],
    [`${IMG(1)}?fit=inapp&fr=1`, `${IMG(1)}?${Q}`],
    [`${IMG(1)}?a=1&fit=inapp&fr=2`, `${IMG(1)}?a=1&${Q}`],
    [`${IMG(1)}?fit=inapp&fit=inapp`, `${IMG(1)}?${Q}`],
    [`${IMG(1)}?fit=1x1`, `${IMG(1)}?fit=1x1`],
    [`${IMG(1)}#x`, `${IMG(1)}?${Q}#x`],
    [`https://app.hanjul.ai${IMG(1)}?fit=inapp`, `https://app.hanjul.ai${IMG(1)}?${Q}`],
    [`https://evil.example${IMG(1)}`, `https://evil.example${IMG(1)}`],
    ['https://mall.example/a.jpg?fit=inapp', 'https://mall.example/a.jpg?fit=inapp'],
    ['/api/cdp/inapp/example-image/beauty-1/0?v=3', `/api/cdp/inapp/example-image/beauty-1/0?v=3&${Q}`],
  ];
  for (const [inp, want] of table) {
    it(`${inp} → ${want} · 두 번 거쳐도 같다 · 화면 거울 = 서버`, () => {
      expect(withInAppImageFit(inp)).toBe(want);
      expect(withInAppImageFit(withInAppImageFit(inp))).toBe(want);
      expect(legacyAppImageUrl(inp, {}, READY)).toBe(want);
    });
  }
});

describe('VB10 화면 거울 = 서버 변환 결과(레이아웃별 전체)', () => {
  const urls = [IMG(0), `${IMG(1)}?fit=inapp`, `https://hanjul.ai${IMG(2)}`, 'https://mall.example/x.jpg', `${IMG(3)}?fit=1x1`, '/api/cdp/inapp/example-image/k/0'];
  for (const [name, design] of [['사진 위 글', {}], ['카드', { poster_frame: 'card' }], ['통짜 쿠폰', { poster_text: 'baked', poster_strip: { type: 'coupon', code: 'Z9' } }], ['이벤트 카드', { poster_layout: 'event_card' }], ['배너', { poster_layout: 'banner_sheet' }]] as const) {
    it(`${name}: 장 그림 · flat 그림 주소 = 서버`, () => {
      const m = msg(design, urls.map((u, i) => ({ image_url: u, title: `장${i}` })), { title: '%이름%' });   // 개인화 = 굽지 않는 대체 길
      const server = legacyServeTransform(toServedMessage(gateInAppForClient(m, NONE)), NONE);
      const view = legacyAppPreviewOf(design, m.posterSlides, m.endAt, READY);
      expect(view.slides.map((s: any) => s.image_url)).toEqual(server.posterSlides!.map((s: any) => s.image_url));
      expect(legacyAppImageUrl(m.imageUrl, view.design, READY)).toBe(server.imageUrl);
      expect(view.unknown).toBe(false);
    });
  }
  it('구운 모습 칸 바탕 = 지금 장 무대색 · 대체 두 자리 = 서버 맞춤 주소 · 확인 중 칸', () => {
    expect(fe('components/inapp/LegacyBakedPreview.tsx')).toContain('background: legacyStageOf(');
    const pe = fe('components/inapp/PosterEditor.tsx');
    expect(pe).toContain('legacyAppPreviewOf(design, slides, endAt, ownHosts)');
    expect(pe).toContain('<LegacyAppPreviewPending failed={ownHosts.status === \'error\'} onRetry={loadOwnImageHosts} />');
    const pv = fe('components/InAppMessagePreview.tsx');
    // (Codex 구현 1R ①) flat 그림 없음 = undefined(판정 보류 아님) · null 만 보류
    expect(pv).toContain('const legacyFlat = legacyView && imageUrlIn ? legacyAppImageUrl(imageUrlIn, legacyView.design, ownHosts, legacyView.full) : undefined;');   // ★ C118 B2 전부 인앱용 = inappfull
    expect(pv).toContain('legacyFlat === null');
    expect(pv).toContain('const imageUrl = legacyView ? (legacyFlat ?? imageUrlIn) : imageUrlIn;');
    expect(pv).toContain('<LegacyAppPreviewPending failed={ownHosts.status === \'error\'} onRetry={loadOwnImageHosts} />');
  });
});

describe('VB12 믿는 호스트 = 서버 목록 하나(화면 짐작 0 · 세 값)', () => {
  const ENV = { HANJUL_BASE_URL: process.env.HANJUL_BASE_URL, PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL };
  afterEach(() => { process.env.HANJUL_BASE_URL = ENV.HANJUL_BASE_URL; process.env.PUBLIC_BASE_URL = ENV.PUBLIC_BASE_URL; if (ENV.HANJUL_BASE_URL === undefined) delete process.env.HANJUL_BASE_URL; if (ENV.PUBLIC_BASE_URL === undefined) delete process.env.PUBLIC_BASE_URL; });
  it('서버 목록 = 기본 넷 + 환경값 호스트 · 화면 기본 넷 ⊂ 서버 목록', () => {
    process.env.PUBLIC_BASE_URL = 'https://cdn.example.test/';
    const s = trustedImageHosts();
    expect(s.has('cdn.example.test')).toBe(true);
    for (const h of DEFAULT_OWN_IMAGE_HOSTS) expect(s.has(h)).toBe(true);
  });
  it('환경값 전용 호스트 그림: 받기 전 · 실패 = unknown · 받은 뒤 = own(서버와 같은 맞춤 · 굽기)', () => {
    process.env.PUBLIC_BASE_URL = 'https://cdn.example.test';
    const u = `https://cdn.example.test${IMG(5)}`;
    const got: OwnHostsSnapshot = { status: 'ready', hosts: trustedImageHosts() };
    expect(inAppImageOwnership(u, { status: 'loading', hosts: DEFAULT_OWN_IMAGE_HOSTS })).toBe('unknown');
    expect(inAppImageOwnership(u, { status: 'error', hosts: DEFAULT_OWN_IMAGE_HOSTS })).toBe('unknown');
    expect(inAppImageOwnership(u, got)).toBe('own');
    expect(legacyAppImageUrl(u, {}, { status: 'loading', hosts: DEFAULT_OWN_IMAGE_HOSTS })).toBeNull();
    expect(legacyAppImageUrl(u, {}, got)).toBe(withInAppImageFit(u));
    const m = msg({ poster_frame: 'card' }, [{ image_url: u }]);
    expect(legacyAppWillBake({ design: m.design, slides: m.posterSlides, imageUrl: m.imageUrl, texts: [] }, { status: 'loading', hosts: DEFAULT_OWN_IMAGE_HOSTS })).toBe('unknown');
    expect(legacyAppWillBake({ design: m.design, slides: m.posterSlides, imageUrl: m.imageUrl, texts: [] }, got)).toBe(inAppBakePlan(m, NONE, CO).bake);
  });
  it('서버가 안 믿는 호스트 = 받은 뒤 foreign(맞춤 0 · 굽기 거짓) · 상대 경로 = 늘 own · 기본 넷 = 받기 전에도 own', () => {
    const loading: OwnHostsSnapshot = { status: 'loading', hosts: DEFAULT_OWN_IMAGE_HOSTS };
    expect(inAppImageOwnership(`https://preview.example.test${IMG(1)}`, READY)).toBe('foreign');
    expect(legacyAppImageUrl(`https://preview.example.test${IMG(1)}`, {}, READY)).toBe(`https://preview.example.test${IMG(1)}`);
    expect(withInAppImageFit(`https://preview.example.test${IMG(1)}`)).toBe(`https://preview.example.test${IMG(1)}`);
    expect(inAppImageOwnership(IMG(1), loading)).toBe('own');
    expect(inAppImageOwnership(`https://hanjul.ai${IMG(1)}`, loading)).toBe('own');
    expect(inAppImageOwnership('https://mall.example/a.jpg', loading)).toBe('foreign');   // 우리 그림 길이 아님 = 호스트 무관
  });
  it('바깥 그림 · 개인화가 하나라도 있으면 unknown 보다 먼저 거짓', () => {
    const loading: OwnHostsSnapshot = { status: 'loading', hosts: DEFAULT_OWN_IMAGE_HOSTS };
    const u = `https://cdn.example.test${IMG(5)}`;
    expect(legacyAppWillBake({ design: {}, slides: [{ image_url: u }, { image_url: 'https://mall.example/a.jpg' }], texts: [] }, loading)).toBe(false);
    expect(legacyAppWillBake({ design: {}, slides: [{ image_url: u, title: '%이름%' }], texts: [] }, loading)).toBe(false);
  });
  it('길 = 로그인 뒤 · 서버 CT 그대로 · 화면 = 그 목록만(화면 호스트 자동 신뢰 0)', () => {
    const route = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'cdp.ts'), 'utf8');
    const at = route.indexOf("router.get('/inapp/own-image-hosts'");
    expect(at).toBeGreaterThan(route.indexOf('router.use(authenticate);'));
    expect(route.slice(at, at + 400)).toContain('Array.from(trustedImageHosts())');
    const store = fe('components/inapp/inapp-image-hosts.ts');
    expect(store).toContain("api.get('/cdp/inapp/own-image-hosts')");
    expect(fe('components/inapp/legacy-app-view.ts')).not.toContain('location.hostname');
  });
});

describe('VB9 연동 안내 = 서버 동작(숫자 = 규격 상수 · 옛 문구 0)', () => {
  const src = fe('components/inapp/AppIntegrationContract.tsx');
  it('정사각 · 가운데 % 상수 · 가운데 맞춤 · 범위 · 바깥 주소 · 주소 판', () => {
    expect(src).toContain("const LEGACY_PCT = Math.round(LEGACY_BAKE_SAFE.w * 100);");
    for (const t of ['완성된 정사각 그림', '가운데 ${LEGACY_PCT}% × ${LEGACY_PCT}%', '가운데 맞춤 cover', '5:4 ~ 4:5', '바깥 주소 그림은 원본 그대로', '주소(fr)']) expect(src).toContain(t);
    // 5:4 ~ 4:5 = 안전 칸 0.8 의 cover 허용 범위(세로/가로 0.8 ~ 1/0.8)
    expect([ASPECT_RATIOS.inapp.safe!.h, 1 / ASPECT_RATIOS.inapp.safe!.w]).toEqual([0.8, 1.25]);
  });
  it('옛 문구(틀 지움 · 4:5 미리 맞춤) 0', () => {
    for (const t of ['틀을 지워 바닥 시트로', '4:5 로 미리 맞춰', '여러 장 그림은 4:5']) expect(src).not.toContain(t);
  });
});
