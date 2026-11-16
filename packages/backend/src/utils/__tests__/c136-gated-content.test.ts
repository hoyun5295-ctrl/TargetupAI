// replaces: none
/**
 * C136 배포 가 — 소개 내용을 로그인 뒤로(★ 2026-11-16 · 설계서 docs/2026-11-16-c136-proposal-kit-trial-design.md §2 · §11)
 *   Harold 「의미없이 전부 공개로 해놓으면 서비스 내용만 가져가서 복제 · 안내창도 마찬가지로」
 *   1. 그림 문 = 이름 꼴 + 보관 폴더에 실제로 있는 이름만 · 받을 수 있는 계정 = 고객사 사용자(에이전트 전용 회사 제외)
 *   2. 소스 계약 = 프론트 저장소(src · public)에 소개 글 · 그림이 없다 · 그림 주소는 로그인 뒤 · 캐시에 남기지 않는다
 *   3. 화면 = 그림을 전부 받아야 글이 된다(하나라도 못 받으면 null · 받은 것은 버린다) · 준비 · 선점 응답의 꼴
 *   판정(준비 → 선점) 시험 = c133-v3-intro.test.ts · c135-v3-popup-trial.test.ts · 실 PG 판 = c133-v3-intro.pg.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('../../config/database', () => ({ query: vi.fn(), pool: { query: vi.fn(), connect: vi.fn() } }));

import { query } from '../../config/database';
import {
  GATED_IMAGE_DIR, GATED_CACHE_CONTROL, COMPANY_USAGE_SQL,
  isGatedImageName, gatedImageFile, isCompanyUser, canSeeIntroContent,
} from '../gated-content';
import { V3_POPUP_CSS, V3_SCENES_HTML, V3_TRIAL_HTML, V3_MORPH_SETS } from '../../content/gated/v3-popup';
import { gatedImageNames, fillGatedImages, resolveGated, GATED_IMAGE_PATH } from '../../../../frontend/src/utils/gated-content';
import { peekV3Intro, claimV3Intro } from '../../../../frontend/src/utils/v3-intro';
import { readMorphSets } from '../../../../frontend/src/components/v3/v3-motion';

const mockQuery = query as unknown as ReturnType<typeof vi.fn>;
const SRC = join(__dirname, '..', '..');
const FRONT = join(SRC, '..', '..', 'frontend');
const back = (rel: string) => readFileSync(join(SRC, rel), 'utf8').replace(/\r\n/g, '\n');
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const USER = { userId: 'u-1', companyId: 'c-1', userType: 'company_admin' };

beforeEach(() => { mockQuery.mockReset(); });

describe('그림 문 — 이름 꼴 + 보관 폴더에 실제로 있는 이름만', () => {
  it('이름 꼴 = 영문 소문자 · 숫자 · 붙임표 + jpg · webp(경로 조각 · 점 둘 · 대문자 · 다른 확장자 = 거절)', () => {
    for (const ok of ['poster-serum.jpg', 'cut-knit.webp', 'a.jpg']) expect(isGatedImageName(ok), ok).toBe(true);
    for (const bad of ['../x.jpg', 'a/b.jpg', 'a\\b.jpg', 'x..jpg', '.jpg', 'Poster.jpg', 'x.png', 'x.jpg.exe', 'x.jpg?x=1', '', null, undefined, 7, 'a'.repeat(61) + '.jpg']) {
      expect(isGatedImageName(bad as any), String(bad)).toBe(false);
    }
  });

  it('보관 폴더에 있는 이름만 돌려준다 · 꼴이 맞아도 없는 이름 = null · 폴더가 없으면 null', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gated-'));
    try {
      writeFileSync(join(dir, 'poster-a.jpg'), 'x');
      writeFileSync(join(dir, 'cut-a.webp'), 'x');
      expect(gatedImageFile('poster-a.jpg', dir)).toEqual({ absPath: join(dir, 'poster-a.jpg'), mime: 'image/jpeg' });
      expect(gatedImageFile('cut-a.webp', dir)?.mime).toBe('image/webp');
      expect(gatedImageFile('poster-b.jpg', dir)).toBeNull();
      expect(gatedImageFile('../poster-a.jpg', dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(gatedImageFile('poster-a.jpg', join(tmpdir(), 'gated-none-' + Date.now()))).toBeNull();
  });

  it('실제 보관 폴더 = 창이 쓰는 그림이 모두 있다 · 그림 말고 다른 파일은 없다', () => {
    const names = readdirSync(GATED_IMAGE_DIR);
    expect(names.length).toBeGreaterThanOrEqual(9);
    for (const n of names) expect(isGatedImageName(n), n).toBe(true);
    for (const n of gatedImageNames(V3_POPUP_CSS, V3_SCENES_HTML, V3_TRIAL_HTML)) expect(gatedImageFile(n), n).not.toBeNull();
  });
});

describe('받을 수 있는 계정 — 고객사 사용자 · 에이전트 전용 회사 제외', () => {
  it('슈퍼관리자 · 회사 없는 토큰 · 사용자 없는 토큰 = 조회 없이 거절', async () => {
    for (const u of [{ ...USER, userType: 'super_admin' }, { userId: 'u-1', userType: 'company_admin' }, { companyId: 'c-1', userType: 'company_user' }, null, undefined]) {
      expect(isCompanyUser(u as any)).toBe(false);
      expect(await canSeeIntroContent(u as any)).toBe(false);
    }
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('회사 용도가 agent 면 거절 · web · 빈 값 = 허용 · 회사 행이 없으면 거절 · 조회 실패는 던진다(부르는 쪽이 접는다)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ usage_type: 'agent' }] });
    expect(await canSeeIntroContent(USER)).toBe(false);
    expect(mockQuery).toHaveBeenLastCalledWith(COMPANY_USAGE_SQL, ['c-1']);
    mockQuery.mockResolvedValueOnce({ rows: [{ usage_type: 'web' }] });
    expect(await canSeeIntroContent(USER)).toBe(true);
    mockQuery.mockResolvedValueOnce({ rows: [{ usage_type: null }] });
    expect(await canSeeIntroContent({ ...USER, userType: 'company_user' })).toBe(true);
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await canSeeIntroContent(USER)).toBe(false);
    mockQuery.mockRejectedValueOnce(new Error('db down'));
    await expect(canSeeIntroContent(USER)).rejects.toThrow('db down');
    expect(COMPANY_USAGE_SQL).not.toMatch(/INSERT|UPDATE|DELETE/);
  });
});

describe('소스 계약 — 소개 글 · 그림은 프론트 저장소에 없고 로그인 뒤에만 나간다', () => {
  const routes = back('routes/plans.ts');
  const code = routes.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
  const img = code.slice(code.indexOf("router.get('/gated/img/:name'"), code.indexOf("router.get('/v3-features'"));

  it('⛔ 프론트의 공개 폴더 · 소스에 소개 글 · 그림이 없다(번들 · 정적 파일로 꺼낼 수 없다)', () => {
    expect(existsSync(join(FRONT, 'public', 'v3'))).toBe(false);
    expect(existsSync(join(FRONT, 'public', 'about-v3.html'))).toBe(false);
    // 서버 보관 글에서 뽑은 구절(창마다 · 문자 문안 · 알림톡)이 프론트 어디에도 없다
    const needles = ['담아 두고 안 산', '결온의 가족이 되어 주셔서', '제품 사진만 올리세요.', '같은 업종 평균', 'hanjul.ai/s/kyeolon', '밤사이 채우는 윤기', 'poster-serum', 'cut-knit', 'gated:poster'];
    const all = V3_POPUP_CSS + V3_SCENES_HTML + V3_TRIAL_HTML + V3_MORPH_SETS.map((x) => x.text).join('\n');
    for (const n of needles.slice(0, 8)) expect(all, n).toContain(n);   // 구절이 실제로 서버 글에 있는 것인지부터(헛 구절로 통과하지 않게)
    const files = [...walk(join(FRONT, 'src')), ...walk(join(FRONT, 'public'))].filter((p) => /\.(ts|tsx|html|css|json|js|svg|md|txt)$/.test(p));
    expect(files.length).toBeGreaterThan(300);
    const hits: string[] = [];
    for (const p of files) {
      const text = readFileSync(p, 'utf8');
      for (const n of needles) if (text.includes(n)) hits.push(`${p.slice(FRONT.length + 1).replace(/\\/g, '/')} :: ${n}`);
    }
    expect(hits).toEqual([]);
    // 옛 공개 그림 주소 꼴도 프론트 소스에 남지 않았다
    for (const p of files) expect(readFileSync(p, 'utf8'), p).not.toMatch(/["'(]\/v3\/[a-z0-9-]+\.(?:jpg|webp)/);
  });

  it('움직임 파일에는 움직임만 — 업종 셋(가게 이름 · 문자 문안)은 인자로 받는다', () => {
    const motion = readFileSync(join(FRONT, 'src', 'components', 'v3', 'v3-motion.ts'), 'utf8').replace(/\r\n/g, '\n');
    expect(motion).toContain('export function mountScenes(pop: HTMLElement, sets: readonly MorphSet[]): () => void {');
    expect(motion).toContain('export function mountTrialStage(pop: HTMLElement, sets: readonly MorphSet[]): () => void {');
    expect(motion).not.toMatch(/const SETS\b|\(광고\)|무료수신거부|import .* from '\.\/v3-popup-parts'/);
    for (const set of V3_MORPH_SETS) { expect(motion).not.toContain(set.name); expect(motion).not.toContain(set.text.split('\n')[1]); }
  });

  it('그림 주소 = 로그인 필수 + 사용자당 호출 상한 · 캐시에 남기지 않는다 · 못 주는 경우는 전부 404(있는 이름인지 알려 주지 않는다)', () => {
    expect(code).toContain("router.get('/gated/img/:name', authenticate, gatedImageLimiter, async");
    expect(img.indexOf("res.setHeader('Cache-Control', GATED_CACHE_CONTROL);")).toBeLessThan(img.indexOf('await canSeeIntroContent('));
    expect(GATED_CACHE_CONTROL).toBe('private, no-store');
    expect(img).toContain('const file = allowed ? gatedImageFile(req.params.name) : null;');
    expect(img).toContain("if (!file) return res.status(404).json({ success: false, error: '찾을 수 없습니다.' });");
    expect(img.match(/status\(404\)/g)!.length).toBeGreaterThanOrEqual(1);
    expect(img).not.toMatch(/status\(403\)/);
    // 경로는 CT 가 준 것만 쓴다(요청 값으로 경로를 직접 잇지 않는다)
    expect(img).toContain('fs.createReadStream(file.absPath)');
    expect(img).not.toMatch(/path\.join|sendFile|express\.static/);
    expect(img).toContain("res.setHeader('X-Content-Type-Options', 'nosniff');");
  });

  it('보관 폴더 · 보관 글을 내보내는 자리는 그 주소와 소개 창 판정뿐이다(정적 공개 마운트 0)', () => {
    const files = walk(SRC).filter((p) => /\.ts$/.test(p) && !/__tests__/.test(p));
    const users = files.filter((p) => /assets[/'", ]+gated|GATED_IMAGE_DIR|content\/gated\//.test(readFileSync(p, 'utf8')))
      .map((p) => p.slice(SRC.length + 1).replace(/\\/g, '/')).sort();
    // 배포 가의 셋은 반드시 있고, 그 밖은 배포 나의 둘(제안 페이지 글 · 그 CT)까지만 허용한다(가만 커밋된 판 · 나까지 커밋된 판 둘 다 통과)
    const base = ['content/gated/v3-popup.ts', 'utils/gated-content.ts', 'utils/v3-intro.ts'];
    expect(users.filter((u) => base.includes(u))).toEqual(base);
    expect(users.filter((u) => !base.includes(u) && !['content/gated/proposal-page.ts', 'utils/proposal-trial.ts'].includes(u))).toEqual([]);
    expect(back('app.ts')).not.toMatch(/gated/);
    expect(back('routes/intro-public.ts')).not.toMatch(/gated|v3-popup|v3-login/);
  });
});

describe('화면 — 그림을 전부 받아야 글이 된다', () => {
  const realFetch = globalThis.fetch;
  const store = new Map<string, string>();
  const made: string[] = [];
  const revoked: string[] = [];
  let createSpy: any;
  let revokeSpy: any;
  beforeEach(() => {
    store.clear();
    made.length = 0;
    revoked.length = 0;
    (globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
    createSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => { const u = `blob:test/${made.length + 1}`; made.push(u); return u; });
    revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation((u: string) => { revoked.push(u); });
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete (globalThis as any).localStorage;
    createSpy.mockRestore();
    revokeSpy.mockRestore();
  });
  const imageRes = (type = 'image/jpeg', ok = true) => ({ ok, blob: async () => new Blob(['x'], { type }) }) as any;

  it('(순수) 그림 이름 뽑기 = 중복 없이 나온 순서 · 자리 바꾸기 = 모르는 이름이 있으면 null', () => {
    const css = '.a{background:url(gated:poster-a.jpg)}.b{background:url(gated:cut-b.webp)}.c{background:url(gated:poster-a.jpg)}';
    expect(gatedImageNames(css, '<img src="gated:photo-c.jpg">')).toEqual(['poster-a.jpg', 'cut-b.webp', 'photo-c.jpg']);
    expect(fillGatedImages(css, new Map([['poster-a.jpg', 'blob:1'], ['cut-b.webp', 'blob:2']]))).toBe('.a{background:url(blob:1)}.b{background:url(blob:2)}.c{background:url(blob:1)}');
    expect(fillGatedImages(css, new Map([['poster-a.jpg', 'blob:1']]))).toBeNull();
    expect(gatedImageNames('url(gated:../x.jpg) url(gated:X.JPG)')).toEqual([]);
  });

  it('토큰이 없으면 받으러 가지 않는다', async () => {
    const f = vi.fn();
    globalThis.fetch = f as any;
    expect(await resolveGated({ css: 'url(gated:a.jpg)', html: '' })).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it('전부 받으면 글의 그림 자리가 blob 주소로 바뀐다 · 로그인 토큰을 싣고 캐시에 남기지 않는다 · release 가 주소를 버린다', async () => {
    store.set('token', 'tok-1');
    const f = vi.fn(async () => imageRes());
    globalThis.fetch = f as any;
    const got = await resolveGated({ css: '.a{background:url(gated:a.jpg)}', html: '<i class="x" style="background:url(gated:b.webp)"></i>' });
    expect(got).not.toBeNull();
    expect(got!.css).toBe('.a{background:url(blob:test/1)}');
    expect(got!.html).toContain('url(blob:test/2)');
    expect(f.mock.calls.map((c: any[]) => c[0])).toEqual([GATED_IMAGE_PATH + 'a.jpg', GATED_IMAGE_PATH + 'b.webp']);
    for (const c of f.mock.calls as any[]) { expect(c[1].headers.Authorization).toBe('Bearer tok-1'); expect(c[1].cache).toBe('no-store'); }
    expect(revoked).toEqual([]);
    got!.release();
    expect(revoked.sort()).toEqual(['blob:test/1', 'blob:test/2']);
    got!.release();
    expect(revoked).toHaveLength(2);   // 두 번 불러도 한 번만 버린다
  });

  it('⛔ 하나라도 못 받으면 null — 받아 둔 그림 주소는 버린다(그림 빠진 창을 띄우지 않는다)', async () => {
    store.set('token', 'tok-1');
    globalThis.fetch = vi.fn(async (url: string) => (String(url).endsWith('b.jpg') ? imageRes('image/jpeg', false) : imageRes())) as any;
    expect(await resolveGated({ css: 'url(gated:a.jpg) url(gated:b.jpg)', html: '' })).toBeNull();
    expect(revoked).toEqual(made);
    // 그림이 아닌 응답(오류 본문 등)도 못 받은 것이다
    made.length = 0; revoked.length = 0;
    globalThis.fetch = vi.fn(async () => imageRes('application/json')) as any;
    expect(await resolveGated({ css: 'url(gated:a.jpg)', html: '' })).toBeNull();
    // 요청이 던져도(끊김) 같다
    globalThis.fetch = vi.fn(async () => { throw new Error('net'); }) as any;
    expect(await resolveGated({ css: 'url(gated:a.jpg)', html: '' })).toBeNull();
  });

  it('⛔ 하나가 실패해 접은 뒤에 늦게 끝난 요청은 그림 주소를 만들지 않는다(버릴 자리가 없는 주소 0)', async () => {
    store.set('token', 'tok-1');
    let finishLate: () => void = () => undefined;
    const late = new Promise<void>((r) => { finishLate = r; });
    globalThis.fetch = vi.fn(async (url: string) => {
      if (String(url).endsWith('b.jpg')) return imageRes('image/jpeg', false);            // 바로 실패
      return { ok: true, blob: async () => { await late; return new Blob(['x'], { type: 'image/jpeg' }); } } as any;   // 늦게 끝난다
    }) as any;
    expect(await resolveGated({ css: 'url(gated:a.jpg) url(gated:b.jpg)', html: '' })).toBeNull();
    finishLate();
    await new Promise((r) => setTimeout(r, 10));
    expect(made).toEqual([]);
  });

  it('준비 응답 = 판 열쇠 · 판 · 글이 다 있을 때만 · 선점 = 서버가 그 열쇠를 잡았다고 답했을 때만 true', async () => {
    store.set('token', 'tok-1');
    const json = (body: any, ok = true) => ({ ok, status: ok ? 200 : 503, json: async () => body }) as any;
    const content = { css: '.v3p{}', html: '<div></div>', sets: [] };
    globalThis.fetch = vi.fn(async () => json({ success: true, introKey: 'v3-scenes', variant: 'scenes', content })) as any;
    expect(await peekV3Intro()).toEqual({ introKey: 'v3-scenes', variant: 'scenes', content });
    for (const bad of [
      { success: true, introKey: null }, { success: false, introKey: 'v3-scenes', variant: 'scenes', content },
      { success: true, introKey: 'v3-scenes', variant: 'old', content }, { success: true, introKey: 'v3-scenes', variant: 'scenes' },
      { success: true, introKey: 'v3-scenes', variant: 'scenes', content: { css: '', html: '<div></div>' } },
    ]) {
      globalThis.fetch = vi.fn(async () => json(bad)) as any;
      expect(await peekV3Intro(), JSON.stringify(bad).slice(0, 60)).toBeNull();
    }
    globalThis.fetch = vi.fn(async () => json(null, false)) as any;
    expect(await peekV3Intro()).toBeNull();

    const f = vi.fn(async () => json({ success: true, show: true, introKey: 'v3-scenes', variant: 'scenes' }));
    globalThis.fetch = f as any;
    expect(await claimV3Intro('v3-scenes')).toBe(true);
    expect(JSON.parse((f.mock.calls[0] as any[])[1].body)).toEqual({ introKey: 'v3-scenes' });
    expect(await claimV3Intro('studio-trial')).toBe(false);   // 서버가 다른 판을 잡았다고 답하면 띄우지 않는다
    globalThis.fetch = vi.fn(async () => json({ success: true, show: false })) as any;
    expect(await claimV3Intro('v3-scenes')).toBe(false);
  });

  it('업종 셋 = 꼴이 맞는 것만(서버 글을 그대로 믿지 않는다) · 실제 서버 값은 셋 다 통과', () => {
    expect(readMorphSets(V3_MORPH_SETS)).toHaveLength(3);
    const ok = { src: 'i-sk', cut: 'i-ck', post: 'i-n1', c: [0.5, 0.5, 0.2], p: [0.6, 0.6, 0.1], name: '가게', text: '(광고)' };
    expect(readMorphSets([ok, { ...ok, src: 'x y' }, { ...ok, c: [1, 2] }, { ...ok, name: 3 }, null, { ...ok, post: 'a"><script>' }])).toEqual([ok]);
    expect(readMorphSets(undefined)).toEqual([]);
    expect(readMorphSets('x')).toEqual([]);
  });
});
