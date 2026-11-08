/**
 * ★ 2026-11-08 C116 인앱 구워 보내기 계약 시험(설계서 docs/2026-11-08-c116-inapp-bake-design.md §6 V1 ~ V16)
 *   뿌리 R60(클라이언트가 그릴 수 없는 메시지) · R83(남의 렌더러 칸 규칙을 실측 없이 가정)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import {
  inAppBakePlan, bakedLegacyMessage, serveInAppForClient, inAppHasPersonalTokens, inAppDrawnSlides,
  INAPP_BAKE_EXCLUDED_LAYOUTS, INAPP_CLIENT_CAPS, parseInAppClientCaps, legacyServeTransform, toServedMessage, gateInAppForClient,
} from '../inapp-message';
import {
  inAppBakeKey, readInAppBake, writeInAppBake, sweepInAppBakes, requestInAppBake, inAppBakeAllowedUrl, inAppBakeBytesOver,
  inAppBakeFileName, INAPP_BAKE_RETAIN_MS, INAPP_BAKE_QUEUE_MAX, INAPP_BAKE_MAX_RESPONSE_BYTES, INAPP_BAKE_MAX_TOTAL_BYTES, INAPP_BAKE_VIEW,
  __inAppBakeTest, type InAppBakeJob,
} from '../inapp-bake';
import { ASPECT_RATIOS } from '../image-fit-spec';
import { getServePath } from '../image-serve';
import { drawsWithPosterFrame } from '../../../../sdk-js/src/poster-frame';
import { legacyAppWillBake, LEGACY_BAKE_VIEW, LEGACY_BAKE_SAFE, DEFAULT_OWN_IMAGE_HOSTS, type OwnHostsSnapshot } from '../../../../frontend/src/components/inapp/legacy-app-view';
import { appCapsNote } from '../../../../frontend/src/components/inapp/inappSlides';

const CO = '11111111-2222-3333-4444-555555555555';
const OTHER = '99999999-2222-3333-4444-555555555555';
const IMG = (n: number, co = CO) => `/api/cdp/inapp/image/${co}/p${n}.jpg`;
const msg = (design: any, slides: number, over: Record<string, any> = {}): any => ({
  id: 'aaaaaaaa-0000-0000-0000-000000000001', template: 'full_image', title: '제목', body: '본문', badgeText: null, imageUrl: IMG(0),
  buttons: [{ id: 'b1', label: '바로가기', action_url: 'https://www.invitocorp.com', style: 'primary' }],
  endAt: '2026-11-30T14:59:00.000Z', design, status: 'active', variantWeight: 100,
  posterSlides: Array.from({ length: slides }, (_, i) => ({ image_url: IMG(i), title: `장${i}`, body: `본문${i}`, cta: { label: `버튼${i}`, action_url: `/e/${i}` } })),
  ...over,
});
const NONE = new Set<string>();
/** ★ C116-B 화면 거울 호스트 = 서버 목록을 받은 상태(기본 넷) */
const HOSTS: OwnHostsSnapshot = { status: 'ready', hosts: DEFAULT_OWN_IMAGE_HOSTS };
const ALL = new Set<string>(INAPP_CLIENT_CAPS);
const DESIGNS: Record<string, any> = {
  overlay: {}, baked_sheet: { poster_text: 'baked' }, baked_card: { poster_text: 'baked', poster_frame: 'card' }, live_card: { poster_frame: 'card' },
  coupon: { poster_strip: { type: 'coupon', code: 'HALLO30' } }, countdown: { poster_strip: { type: 'countdown' } },
  event_card: { poster_layout: 'event_card' }, banner_sheet: { poster_layout: 'banner_sheet' },
};

describe('V1 굽기 판정 표', () => {
  for (const [name, d] of Object.entries(DESIGNS)) {
    for (const n of [0, 1, 3]) {
      for (const [capsName, caps] of [['없음', NONE], ['넷', ALL], ['웹뷰', parseInAppClientCaps('webview')], ['일부 frame_card', new Set(['frame_card'])], ['일부 strip_coupon', new Set(['strip_coupon'])]] as const) {
        it(`${name} × ${n}장 × caps ${capsName}`, () => {
          const m = msg(d, n);
          const plan = inAppBakePlan(m, caps as Set<string>, CO);
          const excluded = INAPP_BAKE_EXCLUDED_LAYOUTS.includes(String(d.poster_layout || ''));
          const fullCaps = INAPP_CLIENT_CAPS.every((c) => (caps as Set<string>).has(c));
          const noV4 = !INAPP_CLIENT_CAPS.some((c) => (caps as Set<string>).has(c));
          const need = ['poster_baked', 'frame_card', 'strip_coupon', 'strip_countdown'].filter((c) =>
            (c === 'poster_baked' && d.poster_text === 'baked') || (c === 'frame_card' && d.poster_frame === 'card')
            || (c === 'strip_coupon' && d.poster_strip?.type === 'coupon') || (c === 'strip_countdown' && d.poster_strip?.type === 'countdown'));
          const unmet = need.some((c) => !(caps as Set<string>).has(c));
          const expected = !excluded && !fullCaps && (noV4 || unmet);   // 그림은 flat 이 늘 있음(장 0 = flat 한 장)
          expect(plan.bake).toBe(expected);
          if (plan.bake) expect(plan.expected).toBe(Math.max(1, n));
        });
      }
    }
  }
  it('개인화 낱말 · 남의 그림 · 다른 회사 그림 · 그림 0 = 굽지 않음', () => {
    expect(inAppBakePlan(msg({}, 2, { title: '%고객명%님' }), NONE, CO).bake).toBe(false);   // 메시지 제목 · 본문 · 배지도 본다(한 장 사진 위 글은 바깥 칸을 섞어 그린다 · 보수적으로)
    expect(inAppBakePlan(msg({}, 2, { posterSlides: [{ image_url: IMG(0), title: '%고객명%님 환영' }] }), NONE, CO).bake).toBe(false);
    expect(inAppBakePlan(msg({ poster_strip: { type: 'coupon', code: '{{ customer.name }}' } }, 1), NONE, CO).bake).toBe(false);
    expect(inAppBakePlan(msg({}, 1, { posterSlides: [{ image_url: 'https://mall.example/a.jpg' }] }), NONE, CO).bake).toBe(false);
    expect(inAppBakePlan(msg({}, 1, { posterSlides: [{ image_url: IMG(0, OTHER) }] }), NONE, CO).bake).toBe(false);
    expect(inAppBakePlan(msg({}, 0, { imageUrl: null }), NONE, CO).bake).toBe(false);
    expect(inAppBakePlan({ ...msg({}, 1), template: 'center_modal' }, NONE, CO).bake).toBe(false);
  });
  it('통짜 = 글을 그리지 않으므로 글 속 개인화 낱말로 막지 않는다', () => {
    expect(inAppBakePlan(msg({ poster_text: 'baked' }, 2, { title: '%고객명%' }), NONE, CO).bake).toBe(true);
  });
});

describe('V15 우리 그림 · 굽기 사본 주소', () => {
  it('상대 · 믿는 호스트 절대 = 굽힘 · 같은 경로 남의 호스트 · 다른 회사 = 안 굽힘 · 사본 주소 = 상대 경로', () => {
    const abs = msg({}, 2, { posterSlides: [{ image_url: `https://app.hanjul.ai${IMG(0)}?fit=1x1` }, { image_url: IMG(1) }] });
    const p = inAppBakePlan(abs, NONE, CO);
    expect(p.bake).toBe(true);
    if (!p.bake) return;
    const pm = (p.payload as any).message;
    expect(pm.posterSlides.map((s: any) => s.image_url)).toEqual([IMG(0), IMG(1)]);
    expect(pm.imageUrl).toBe(IMG(0));
    expect((p.payload as any).still).toEqual({ deadlineText: '11월 30일 23:59' });
    expect(inAppBakePlan(msg({}, 1, { posterSlides: [{ image_url: `https://evil.example${IMG(0)}` }] }), NONE, CO).bake).toBe(false);
  });
});

describe('V2 구운 메시지', () => {
  const files = [0, 1, 2].map((i) => `/api/cdp/inapp/image/${CO}/bake-${'a'.repeat(24)}-${i}.jpg`);
  it('글 칸 비움 · 장 버튼 · 그림 링크 · 메시지 버튼 그대로 · 장 그림 · imageUrl = 구운 주소 그대로(★ C116-B 최종 그림 · 맞춤 0) · 그리는 칸 지움', () => {
    const full = toServedMessage(gateInAppForClient(msg({ poster_frame: 'card', poster_strip: { type: 'coupon', code: 'X' }, dismiss_mode: 'snooze_day' }, 3, { badgeText: '배지' }), ALL));
    const out = bakedLegacyMessage(full, files);
    expect([out.title, out.body, out.badgeText]).toEqual(['', '', null]);
    expect(out.design).toEqual({ dismiss_mode: 'snooze_day' });
    expect(out.posterSlides.map((s) => s.image_url)).toEqual(files);
    expect(out.imageUrl).toBe(files[0]);
    expect(out.posterSlides.map((s) => s.cta?.label)).toEqual(['버튼0', '버튼1', '버튼2']);
    expect(out.posterSlides.every((s: any) => s.title === undefined && s.body === undefined && s.eyebrow === undefined)).toBe(true);
    expect(out.buttons).toEqual(full.buttons);
  });
  it('(Codex 설계 1R ①) 장 없는 flat = 단일 포스터 그림(imageUrl)이 구운 그림 · 버튼 = 메시지 버튼', () => {
    const full = toServedMessage(gateInAppForClient(msg({ poster_frame: 'card' }, 0), ALL));
    const out = bakedLegacyMessage(full, files.slice(0, 1));
    expect(out.imageUrl).toBe(files[0]);
    expect(out.buttons[0].label).toBe('바로가기');
  });
});

describe('V3 서빙 한 곳', () => {
  const m = msg({ poster_frame: 'card' }, 2);
  it('준비됨 = 구운 메시지 · 요청 0', () => {
    const calls: InAppBakeJob[] = [];
    const out = serveInAppForClient(m, NONE, CO, { read: () => ['/x/0.jpg', '/x/1.jpg'], request: (j) => calls.push(j) });
    expect(out.posterSlides[0].image_url).toBe('/x/0.jpg');   // 남의 경로 꼴이라 맞춤 꼬리 없음(판정 = toOwnImageRef)
    expect(calls).toHaveLength(0);
  });
  it('준비 안 됨 = 대체(?fit=inapp&fr=2) + 요청 한 번 · 장마다 무대색', () => {
    const calls: InAppBakeJob[] = [];
    const out = serveInAppForClient(m, NONE, CO, { read: () => null, request: (j) => calls.push(j) });
    expect(out).toEqual(legacyServeTransform(toServedMessage(gateInAppForClient(m, NONE)), NONE));
    expect(out.posterSlides[0].image_url).toBe(`${IMG(0)}?fit=inapp&fr=2`);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ companyId: CO, messageId: m.id, expected: 2, stages: ['#111827', '#111827'] });
  });
  it('판 넷 = 원본 그대로 · 읽기 · 요청 0', () => {
    let reads = 0; const calls: unknown[] = [];
    const out = serveInAppForClient(m, ALL, CO, { read: () => { reads++; return null; }, request: (j) => calls.push(j) });
    expect(out.design).toEqual({ poster_frame: 'card' });
    expect(reads + calls.length).toBe(0);
  });
});

describe('V4 개인화 낱말 = SDK 치환 낱말 전부', () => {
  const sdk = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'sdk-js', 'src', 'inapp.ts'), 'utf8');
  const body = sdk.slice(sdk.indexOf('private replaceVariables('), sdk.indexOf('private replaceVariables(') + 2000);
  const tokens = Array.from(body.matchAll(/'(%[^%']+%)':/g)).map((x) => x[1]);
  it('SDK legacyMap 낱말을 뽑았다', () => { expect(tokens.length).toBeGreaterThanOrEqual(6); });
  for (const t of tokens) {
    it(`${t} = 개인화`, () => { expect(inAppHasPersonalTokens(msg({}, 1, { posterSlides: [{ image_url: IMG(0), body: `${t} 안녕` }] }))).toBe(true); });
  }
  it('{{ customer.x }} = 개인화 · 할인 표기 30%~50% = 아님', () => {
    expect(inAppHasPersonalTokens(msg({}, 1, { posterSlides: [{ image_url: IMG(0), title: '{{ customer.name }}' }] }))).toBe(true);
    expect(inAppHasPersonalTokens(msg({}, 1, { title: '', body: '', posterSlides: [{ image_url: IMG(0), title: '30%~50% 할인' }] }))).toBe(false);
  });
});

describe('V5 제외 레이아웃 = SDK drawsWithPosterFrame 거짓', () => {
  for (const d of Object.values(DESIGNS)) {
    it(JSON.stringify(d), () => {
      expect(INAPP_BAKE_EXCLUDED_LAYOUTS.includes(String(d.poster_layout || ''))).toBe(!drawsWithPosterFrame(d));
    });
  }
});

describe('V6 열쇠', () => {
  const full = (over: Record<string, any> = {}) => toServedMessage(gateInAppForClient(msg({ poster_frame: 'card' }, 2, over), ALL)) as any;
  const k = (m: any, sdk = 'sdk1') => inAppBakeKey(m, sdk);
  it('같은 값 = 같은 열쇠 · 24자리', () => { expect(k(full())).toBe(k(full())); expect(k(full())).toMatch(/^[0-9a-f]{24}$/); });
  it('그리는 값 · SDK 지문 하나만 바뀌어도 다른 열쇠', () => {
    const base = k(full());
    for (const over of [{ design: { poster_frame: 'card', poster_strip: { type: 'countdown' } } }, { endAt: '2026-12-01T00:00:00Z' }, { accentColor: '#ff0000' },
      { posterSlides: [{ image_url: IMG(5) }, { image_url: IMG(1) }] }, { title: '다른 제목' }]) {
      expect(k(full(over)), JSON.stringify(over)).not.toBe(base);
    }
    expect(k(full(), 'sdk2')).not.toBe(base);
  });
  it('버튼 · 켜기 · 비중 · 대상 조건 = 같은 열쇠(K3 · 정지 그리기는 버튼 칸을 만들지 않는다)', () => {
    const base = k(full());
    for (const over of [{ buttons: [] }, { status: 'paused' }, { variantWeight: 30 }, { audienceFilter: { grade: 'VIP' } }]) {
      expect(k(full(over)), JSON.stringify(over)).toBe(base);
    }
  });
});

describe('V7 · V13 저장 · 쓸기 · 되돌림 · 캐시', () => {
  let dir: string;
  const job = (key: string, messageId = 'm-1', expected = 2): InAppBakeJob => ({ companyId: CO, messageId, key, expected, payload: {}, stages: Array(expected).fill('#111827') });
  const K = (c: string) => c.repeat(24);
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c116-bake-')); __inAppBakeTest.reset(); __inAppBakeTest.setImageBase(dir); });
  afterEach(() => { __inAppBakeTest.reset(); fs.rmSync(dir, { recursive: true, force: true }); });
  const imgs = (n: number) => Array.from({ length: n }, (_, i) => Buffer.from(`img${i}`));
  const exists = (key: string, i: number) => fs.existsSync(path.join(dir, CO, inAppBakeFileName(key, i)));

  it('쓰기 → 읽기 · json 없는 반쪽 = 없음 · 장 수 다름 = 없음', () => {
    expect(readInAppBake(CO, K('a'), 2)).toBeNull();
    fs.mkdirSync(path.join(dir, CO), { recursive: true });
    fs.writeFileSync(path.join(dir, CO, inAppBakeFileName(K('a'), 0)), 'x');
    expect(readInAppBake(CO, K('a'), 1)).toBeNull();   // json 없음
    writeInAppBake(job(K('a')), imgs(2));
    expect(readInAppBake(CO, K('a'), 2)).toEqual([0, 1].map((i) => `/api/cdp/inapp/image/${CO}/${inAppBakeFileName(K('a'), i)}`));
    expect(readInAppBake(CO, K('a'), 3)).toBeNull();
  });
  it('A 응답 → B 완성 → A 그림 = 있음(바로 지우지 않음) · 48시간 지난 옛 열쇠만 지움 · 다른 메시지 그대로', () => {
    const t0 = new Date('2026-11-08T00:00:00Z');
    writeInAppBake(job(K('a')), imgs(2), t0);
    writeInAppBake(job(K('c'), 'm-2'), imgs(1), t0);
    expect(readInAppBake(CO, K('a'), 2)).toBeTruthy();
    writeInAppBake(job(K('b')), imgs(2), new Date(t0.getTime() + 1000));   // B 완성 = A 에 supersededAt
    expect(exists(K('a'), 0) && exists(K('a'), 1)).toBe(true);
    sweepInAppBakes(CO, 'm-1', K('b'), new Date(t0.getTime() + INAPP_BAKE_RETAIN_MS - 1000));
    expect(exists(K('a'), 0)).toBe(true);
    sweepInAppBakes(CO, 'm-1', K('b'), new Date(t0.getTime() + INAPP_BAKE_RETAIN_MS + 5000));
    expect(exists(K('a'), 0)).toBe(false);   // 대체된 뒤 48시간 = 그 전에 내려간 주소의 유예 끝
    expect(readInAppBake(CO, K('a'), 2)).toBeNull();   // V13 지운 열쇠 = 준비 아님(캐시도 빠짐)
    expect(exists(K('b'), 0) && exists(K('c'), 0)).toBe(true);
  });
  it('(Codex 구현 1R ②) 캐시를 비우지 않고 A → B → A(캐시 적중) → C(48시간 뒤) = A 보존', () => {
    const t0 = new Date('2026-11-08T00:00:00Z');
    writeInAppBake(job(K('a')), imgs(2), t0);
    expect(readInAppBake(CO, K('a'), 2)).toBeTruthy();                       // 캐시에 들어감
    writeInAppBake(job(K('b')), imgs(2), new Date(t0.getTime() + 1000));   // A = supersededAt
    expect(readInAppBake(CO, K('a'), 2)).toBeTruthy();                       // 되돌림 = 캐시 적중 · 지움 유예 풀림
    expect(JSON.parse(fs.readFileSync(path.join(dir, CO, `bake-${K('a')}.json`), 'utf8')).supersededAt).toBeNull();
    writeInAppBake(job(K('c')), imgs(2), new Date(t0.getTime() + INAPP_BAKE_RETAIN_MS * 3));   // C 완성 = A 는 이제 처음 대체됨
    expect(exists(K('a'), 0) && exists(K('a'), 1)).toBe(true);
    expect(readInAppBake(CO, K('a'), 2)).toBeTruthy();
  });
  it('(Codex 구현 2R ① · 3R ①) 되돌림 표시를 파일에 못 지우면 구운 주소를 내보내지 않는다(대체) · 재시작 뒤에도 같음 · 지워지면 내보낸다', () => {
    const t0 = new Date('2026-11-08T00:00:00Z');
    writeInAppBake(job(K('a')), imgs(2), t0);
    writeInAppBake(job(K('b')), imgs(2), new Date(t0.getTime() + 1000));   // A = supersededAt(과거 시각)
    __inAppBakeTest.reset(); __inAppBakeTest.setImageBase(dir);            // 재시작(캐시 · 메모리 비움)
    const jf = path.join(dir, CO, `bake-${K('a')}.json`);
    const realWrite = fs.renameSync;
    (fs as any).renameSync = (from: string, to: string) => { if (to === jf) throw new Error('쓰기 실패'); return realWrite(from, to); };
    try {
      expect(readInAppBake(CO, K('a'), 2)).toBeNull();                      // 못 지움 = 내보내지 않음(대체)
      __inAppBakeTest.reset(); __inAppBakeTest.setImageBase(dir);          // 또 재시작
      expect(readInAppBake(CO, K('a'), 2)).toBeNull();
    } finally { (fs as any).renameSync = realWrite; }
    expect(JSON.parse(fs.readFileSync(jf, 'utf8')).supersededAt).not.toBeNull();
    sweepInAppBakes(CO, 'm-1', K('c'), new Date(Date.now() + INAPP_BAKE_RETAIN_MS * 2));   // 내보낸 적 없는 옛 열쇠 = 지워도 된다
    expect(exists(K('a'), 0)).toBe(false);
    // 지워지면 내보낸다 · 그 뒤 쓸기 = 지움 유예 새로 시작(파일 기록)
    writeInAppBake(job(K('d')), imgs(2), t0);
    writeInAppBake(job(K('e')), imgs(2), new Date(t0.getTime() + 1000));   // D = supersededAt
    expect(readInAppBake(CO, K('d'), 2)).toBeTruthy();
    expect(JSON.parse(fs.readFileSync(path.join(dir, CO, `bake-${K('d')}.json`), 'utf8')).supersededAt).toBeNull();
    sweepInAppBakes(CO, 'm-1', K('e'), new Date(Date.now() + INAPP_BAKE_RETAIN_MS * 2));
    expect(exists(K('d'), 0)).toBe(true);
  });
  it('(Codex 구현 4R ①) 되돌림 때 json 을 못 읽으면 내보내지 않는다(캐시 적중 · 처음 읽기 둘 다) · 읽기가 돌아오면 내보내고 48시간 지킨다', () => {
    const t0 = new Date('2026-11-08T00:00:00Z');
    writeInAppBake(job(K('a')), imgs(2), t0);
    expect(readInAppBake(CO, K('a'), 2)).toBeTruthy();                       // 캐시에 들어감
    writeInAppBake(job(K('b')), imgs(2), new Date(t0.getTime() + 1000));   // A = supersededAt
    const jf = path.join(dir, CO, `bake-${K('a')}.json`);
    const realRead = fs.readFileSync;
    (fs as any).readFileSync = (f: any, ...rest: any[]) => { if (String(f) === jf) throw new Error('읽기 실패'); return (realRead as any)(f, ...rest); };
    try {
      expect(readInAppBake(CO, K('a'), 2)).toBeNull();                     // 캐시 적중 · 못 읽음
      __inAppBakeTest.reset(); __inAppBakeTest.setImageBase(dir);
      expect(readInAppBake(CO, K('a'), 2)).toBeNull();                     // 처음 읽기 · 못 읽음
    } finally { (fs as any).readFileSync = realRead; }
    expect(readInAppBake(CO, K('a'), 2)).toBeTruthy();                       // 읽기 돌아옴 = 내보냄 · 표시 지움
    expect(JSON.parse(fs.readFileSync(jf, 'utf8')).supersededAt).toBeNull();
    sweepInAppBakes(CO, 'm-1', K('c'), new Date(Date.now() + INAPP_BAKE_RETAIN_MS * 2));   // C 직후 쓸기 = A 는 이제 처음 대체 표시만
    expect(exists(K('a'), 0) && exists(K('a'), 1)).toBe(true);
  });
  it('(Codex 구현 4R ①) 쓰기가 예외 없이 끝나도 다시 읽어 표시가 남아 있으면 내보내지 않는다', () => {
    const t0 = new Date('2026-11-08T00:00:00Z');
    writeInAppBake(job(K('a')), imgs(2), t0);
    writeInAppBake(job(K('b')), imgs(2), new Date(t0.getTime() + 1000));   // A = supersededAt
    __inAppBakeTest.reset(); __inAppBakeTest.setImageBase(dir);
    const jf = path.join(dir, CO, `bake-${K('a')}.json`);
    const realRename = fs.renameSync;
    (fs as any).renameSync = (from: string, to: string) => { if (to === jf) { fs.unlinkSync(from); return; } return realRename(from, to); };   // 조용히 안 바뀜
    try {
      expect(readInAppBake(CO, K('a'), 2)).toBeNull();
    } finally { (fs as any).renameSync = realRename; }
    expect(JSON.parse(fs.readFileSync(jf, 'utf8')).supersededAt).not.toBeNull();
  });
  it('(Codex 구현 3R ①) 캐시에 든 열쇠가 대체된 뒤 되돌림 표시를 못 지우면 캐시 적중이어도 내보내지 않는다', () => {
    const t0 = new Date('2026-11-08T00:00:00Z');
    writeInAppBake(job(K('a')), imgs(2), t0);
    expect(readInAppBake(CO, K('a'), 2)).toBeTruthy();                       // 캐시에 들어감
    writeInAppBake(job(K('b')), imgs(2), new Date(t0.getTime() + 1000));   // A = supersededAt(캐시는 남음)
    const jf = path.join(dir, CO, `bake-${K('a')}.json`);
    const realWrite = fs.renameSync;
    (fs as any).renameSync = (from: string, to: string) => { if (to === jf) throw new Error('쓰기 실패'); return realWrite(from, to); };
    try {
      expect(readInAppBake(CO, K('a'), 2)).toBeNull();
    } finally { (fs as any).renameSync = realWrite; }
    expect(readInAppBake(CO, K('a'), 2)).toBeTruthy();
    expect(JSON.parse(fs.readFileSync(jf, 'utf8')).supersededAt).toBeNull();
  });
  it('되돌림 = 옛 열쇠가 다시 읽히면 supersededAt 지움 → 쓸기가 지우지 않는다', () => {
    const t0 = new Date('2026-11-08T00:00:00Z');
    writeInAppBake(job(K('a')), imgs(2), t0);
    writeInAppBake(job(K('b')), imgs(2), new Date(t0.getTime() + 1000));
    __inAppBakeTest.setImageBase(dir);   // 캐시를 비우지 않고 읽기 = 되돌림 판정은 json 확인 때
    __inAppBakeTest.reset(); __inAppBakeTest.setImageBase(dir);
    expect(readInAppBake(CO, K('a'), 2)).toBeTruthy();
    const j = JSON.parse(fs.readFileSync(path.join(dir, CO, `bake-${K('a')}.json`), 'utf8'));
    expect(j.supersededAt).toBeNull();
    sweepInAppBakes(CO, 'm-1', K('a'), new Date(t0.getTime() + INAPP_BAKE_RETAIN_MS * 3));
    expect(exists(K('a'), 0)).toBe(true);
  });
});

describe('V8 대기열 · 시한 · 받은 바이트', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c116-q-')); __inAppBakeTest.reset(); __inAppBakeTest.setImageBase(dir); });
  afterEach(() => { __inAppBakeTest.reset(); fs.rmSync(dir, { recursive: true, force: true }); });
  const j = (c: string, co = CO): InAppBakeJob => ({ companyId: co, messageId: `m-${c}`, key: c.repeat(24 / c.length), expected: 1, payload: {}, stages: ['#111827'] });

  it('같은 열쇠 한 번 · 상한 20 · 실패 = 쉼', async () => {
    let release: () => void = () => {};
    __inAppBakeTest.setRunner(() => new Promise((r) => { release = () => r([Buffer.from('x')]); }), { deadlineMs: 5_000 });
    expect(requestInAppBake(j('a'))).toBe('queued');
    expect(requestInAppBake(j('a'))).toBe('duplicate');
    const hex = '0123456789abcdef';
    let full = '';
    for (let i = 0; i < INAPP_BAKE_QUEUE_MAX + 2; i++) full = requestInAppBake(j(hex[i % 16] + hex[(i >> 4) % 16]));
    expect(full).toBe('full');
    release();
    __inAppBakeTest.setRunner(async () => { throw new Error('실패'); }, { deadlineMs: 5_000 });
  });
  it('끝나지 않는 가짜 일 뒤 다음 회사 일이 시한 뒤 끝난다 · 자리 반환 · 중단 함수 불림', async () => {
    let aborted = 0;
    let n = 0;
    __inAppBakeTest.setRunner((job) => (n++ === 0 ? new Promise<Buffer[]>(() => {}) : Promise.resolve([Buffer.from(job.key)])), { deadlineMs: 50, abort: () => { aborted++; } });
    requestInAppBake(j('d'));
    requestInAppBake(j('e', '22222222-2222-3333-4444-555555555555'));
    await __inAppBakeTest.idle();
    expect(aborted).toBe(1);
    expect(readInAppBake('22222222-2222-3333-4444-555555555555', 'e'.repeat(24), 1)).toBeTruthy();
    expect(requestInAppBake(j('d'))).toBe('cooldown');
  });
  it('(Codex 구현 1R ①) 굽지 않아야 하는 메시지(글 넘침) = 다시 굽지 않음 · 보통 실패 = 10분 뒤 다시', async () => {
    __inAppBakeTest.setRunner(async (job) => { throw Object.assign(new Error('글 넘침'), { inAppBakePermanent: job.key.startsWith('f') }); }, { deadlineMs: 1_000 });
    requestInAppBake(j('f')); requestInAppBake(j('9'));
    await __inAppBakeTest.idle();
    const later = Date.now() + 24 * 3600 * 1000;
    expect(requestInAppBake(j('f'), later)).toBe('cooldown');
    expect(requestInAppBake(j('9'), later)).toBe('queued');
  });
  it('받은 바이트 = 요청 하나 · 합 상한(길이 헤더 없는 조각 여러 번)', () => {
    const per = new Map<string, number>(); const total = { n: 0 };
    let over = false;
    for (let i = 0; i < 9 && !over; i++) over = inAppBakeBytesOver(per, 'r1', 1024 * 1024, total);
    expect(over).toBe(true);
    const per2 = new Map<string, number>(); const t2 = { n: 0 };
    let o2 = false;
    for (let i = 0; i < 6 && !o2; i++) o2 = inAppBakeBytesOver(per2, `r${i}`, 7 * 1024 * 1024, t2);
    expect(o2).toBe(true);
    expect(INAPP_BAKE_MAX_RESPONSE_BYTES).toBe(8 * 1024 * 1024);
    expect(INAPP_BAKE_MAX_TOTAL_BYTES).toBe(40 * 1024 * 1024);
  });
  it('크롬이 열어도 되는 주소 = 굽기 출처 + 구글 글꼴 + data/blob', () => {
    const base = 'http://127.0.0.1:3000';
    expect(inAppBakeAllowedUrl(`${base}/api/cdp/inapp/image/${CO}/a.jpg`, base)).toBe(true);
    expect(inAppBakeAllowedUrl('https://fonts.gstatic.com/s/a.woff2', base)).toBe(true);
    expect(inAppBakeAllowedUrl('data:image/png;base64,AA', base)).toBe(true);
    for (const bad of ['https://app.hanjul.ai/x', 'http://127.0.0.1:5432/', 'http://10.0.0.1/', 'https://mall.example/a.jpg', 'file:///etc/passwd']) {
      expect(inAppBakeAllowedUrl(bad, base), bad).toBe(false);
    }
  });
});

describe('V12 서빙 한 곳(R60 · K6 · 소스에서 기계 추출)', () => {
  const root = path.join(__dirname, '..', '..');
  const files: string[] = [];
  const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== '__tests__') walk(p); } else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name)) files.push(p); } };
  walk(root);
  it('gateInAppForClient · legacyServeTransform 부르는 곳 = inapp-message.ts 의 serveInAppForClient · inAppBakePlan 안뿐', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      for (const fn of ['gateInAppForClient(', 'legacyServeTransform(']) {
        let at = src.indexOf(fn);
        while (at >= 0) {
          const before = src.slice(Math.max(0, at - 16), at);
          const isDef = /function\s+$/.test(before);
          if (!isDef) {
            // 바로 앞 함수 선언(export · async · 일반 모두 · M10 = export async function 을 놓쳤다)
            let name = '';
            for (const d of src.slice(0, at).matchAll(/(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*[(<]/g)) name = d[1];
            if (!(f.endsWith(path.join('utils', 'inapp-message.ts')) && ['serveInAppForClient', 'inAppBakePlan'].includes(name))) offenders.push(`${path.basename(f)}:${name}:${fn}`);
          }
          at = src.indexOf(fn, at + fn.length);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('V14 보이는 곳(★ C116-B 공통 규칙 · 독립 계산 · 한 앱 칸 공식 0)', () => {
  // 원본 r_o(세로/가로)를 inapp 캔버스(정사각) 안전 칸에 inside 로 넣고, 칸 세로/가로 b 를 가운데 맞춤 cover 로 채웠을 때 원본이 통째로 보이는가
  const spec = ASPECT_RATIOS.inapp;
  const visible = (ro: number, b: number) => {
    const W = 1, H = spec.h / spec.w;   // 캔버스
    const bw = W * spec.safe!.w, bh = H * spec.safe!.h;
    const fw = Math.min(bw, bh / ro), fh = fw * ro;   // 원본(inside)
    // cover: 캔버스 세로/가로 = H/W · 칸 b 가 더 세로로 길면 좌우가 잘림 · 아니면 위아래가 잘림
    const c = H / W;
    const visW = b >= c ? W * (c / b) : W;
    const visH = b >= c ? H : H * (b / c);
    return fw <= visW + 1e-9 && fh <= visH + 1e-9;
  };
  // 연동 계약 약속 = 칸 가로:세로 5:4 ~ 4:5(세로/가로 0.8 ~ 1.25) · 원본 비율 무관
  for (const ro of [1, 4 / 3, 1.5, 3, 9 / 16, 1 / 3]) {
    for (const b of [0.8, 0.85, 0.93, 1, 1.1, 1.2, 1.25]) {
      it(`원본 세로/가로 ${ro.toFixed(3)} · 칸 ${b} = 통째로 보임`, () => expect(visible(ro, b)).toBe(true));
    }
  }
  it('약속 범위 밖(칸 4:3 · 16:9 등) = 잘릴 수 있다(계약에 범위를 적은 까닭)', () => {
    expect(visible(1, 1.5) && visible(1, 0.5625)).toBe(false);
  });
  it('규격 = 정사각 · 가운데 80% × 80% · 무대색 · rev 2(값을 바꾸면 rev 를 올린다)', () => {
    expect(spec).toEqual({ w: 1, h: 1, rev: 2, safe: { w: 0.8, h: 0.8, fill: '#111827' } });
  });
});

describe('V16 실제 서빙(getServePath · inapp)', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c116-serve-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  // 원본 = 두꺼운 검은 테두리(짧은 변의 15% · 가장자리 = 고른 검정 → 바탕 = 검정 단색) + 흰 속 → 결과에서 흰 칸의 범위 ⊂ 원본 자리
  const make = async (w: number, h: number, file: string, animated = false) => {
    const p = path.join(dir, file);
    const bd = Math.round(Math.min(w, h) * 0.15);
    const frame = await sharp({ create: { width: w, height: h, channels: 3, background: { r: 0, g: 0, b: 0 } } })
      .composite([{ input: await sharp({ create: { width: w - 2 * bd, height: h - 2 * bd, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer(), left: bd, top: bd }])
      .removeAlpha().raw().toBuffer();   // 합성 결과 = 4채널 → 3채널로(시험 그림 깨짐 방지)
    if (animated) {
      // 진짜 다중 프레임(두 장 이어 붙여 움직이는 webp · sharp join)
      // 같은 장 두 개는 인코더가 한 장으로 합친다 → 둘째 장 속을 조금 다르게(250 · 흰 칸 판정 안)
      const one = await sharp(frame, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
      const two = await sharp(one).composite([{ input: await sharp({ create: { width: w - 2 * bd, height: h - 2 * bd, channels: 3, background: { r: 250, g: 250, b: 250 } } }).png().toBuffer(), left: bd, top: bd }]).png().toBuffer();
      await sharp([one, two], { join: { animated: true } } as any).webp().toFile(p);
      expect((await sharp(fs.readFileSync(p)).metadata()).pages).toBe(2);
    } else if (file.endsWith('.gif')) {
      await sharp(frame, { raw: { width: w, height: h, channels: 3 } }).gif().toFile(p);
    } else {
      await sharp(frame, { raw: { width: w, height: h, channels: 3 } }).png().toFile(p);
    }
    return { p, fx: (w - 2 * bd) / w, fy: (h - 2 * bd) / h };
  };
  const whiteBox = async (p: string) => {
    const { data, info } = await sharp(fs.readFileSync(p)).removeAlpha().raw().toBuffer({ resolveWithObject: true });   // 버퍼 = 윈도우 파일 잠금 0
    let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1;
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
      const o = (y * info.width + x) * info.channels;
      if (data[o] > 200 && data[o + 1] > 200 && data[o + 2] > 200) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    }
    return { W: info.width, H: info.height, x0, y0, x1, y1 };
  };
  for (const [name, w, h, file, animated] of [
    ['작은 정사각 1000×1000', 1000, 1000, 'sq.png', false], ['세로 600×900', 600, 900, 'tall.png', false], ['가로 900×500', 900, 500, 'wide.png', false],
    ['움직이는 정사각 webp', 400, 400, 'anim.webp', true], ['GIF 정사각', 400, 400, 'g.gif', false],
  ] as const) {
    it(`${name} = 정사각 캔버스 · 원본이 안전 칸(80% × 80%) 안 · 바깥 = 무대색`, async () => {
      const { p: src, fx, fy } = await make(w, h, file, animated);
      const out = await getServePath(src, { aspect: 'inapp', mode: 'pad' });
      expect(out).not.toBe(src);   // 원본 그대로 반환 0(Codex 설계 2R ① · 3R ①)
      const b = await whiteBox(out);
      expect(b.W).toBe(b.H);
      // 흰 속 = 원본 안쪽(축마다 비율 fx · fy) → 원본 상자 = 흰 칸을 그 비율로 넓힌 것 · 그 상자가 안전 칸 안
      const ow = (b.x1 - b.x0 + 1) / fx, oh = (b.y1 - b.y0 + 1) / fy;
      expect(b.x1).toBeGreaterThan(b.x0);
      expect(ow).toBeLessThanOrEqual(b.W * 0.8 + 4);
      expect(oh).toBeLessThanOrEqual(b.H * 0.8 + 4);
      // ★ C116-B 빈자리 = 무대색(흐림 · 가장자리 색 0) — 네 귀퉁이 픽셀
      const { data, info } = await sharp(fs.readFileSync(out)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      for (const [x, y] of [[1, 1], [info.width - 2, 1], [1, info.height - 2], [info.width - 2, info.height - 2]]) {
        const o = (y * info.width + x) * info.channels;
        expect([data[o], data[o + 1], data[o + 2]].map((v, k) => Math.abs(v - [0x11, 0x18, 0x27][k]) <= 3)).toEqual([true, true, true]);
      }
      const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
      expect(Math.abs(cx - b.W / 2)).toBeLessThanOrEqual(3);
      expect(Math.abs(cy - b.H / 2)).toBeLessThanOrEqual(3);
    });
  }
});

describe('V11 편집기 거울 · 안내', () => {
  const cases: Array<[string, any]> = [
    ['카드 여러 장', msg({ poster_frame: 'card' }, 3)],
    ['쿠폰 한 장', msg({ poster_strip: { type: 'coupon', code: 'A' } }, 1)],
    ['개인화 장', msg({}, 2, { posterSlides: [{ image_url: IMG(0), title: '%이름%님' }] })],
    ['남의 그림', msg({}, 1, { posterSlides: [{ image_url: 'https://mall.example/a.jpg' }] })],
    ['이벤트 카드', msg({ poster_layout: 'event_card' }, 2)],
    ['통짜', msg({ poster_text: 'baked' }, 2, { title: '%고객명%' })],
    ['장 없음 flat', msg({ poster_frame: 'card' }, 0)],
  ];
  for (const [name, m] of cases) {
    it(`${name}: 화면 legacyAppWillBake = 서버 inAppBakePlan(caps 없음)`, () => {
      const server = inAppBakePlan(m, NONE, CO).bake;
      const fe = legacyAppWillBake({ design: m.design, slides: m.posterSlides, imageUrl: m.imageUrl, texts: [m.title, m.body, m.badgeText] }, HOSTS);
      expect(fe).toBe(server);
    });
  }
  it('(Codex 구현 1R ⑤) 미리보기 굽기 화면 · 안전 칸 = 서버 값', () => {
    expect(LEGACY_BAKE_VIEW).toEqual({ width: INAPP_BAKE_VIEW.width, height: INAPP_BAKE_VIEW.height });
    expect(LEGACY_BAKE_SAFE).toEqual({ w: ASPECT_RATIOS.inapp.safe!.w, h: ASPECT_RATIOS.inapp.safe!.h });
  });
  it('(Codex 구현 1R ④) 통짜 · 장 버튼 글 개인화 = 그림에 안 그리므로 굽힘(서버 = 화면) · 통짜 띠 코드 개인화 = 안 굽힘', () => {
    const m1 = msg({ poster_text: 'baked', poster_frame: 'card' }, 2, { posterSlides: [{ image_url: IMG(0), cta: { label: '%고객명%님 혜택' } }, { image_url: IMG(1) }] });
    expect(inAppBakePlan(m1, NONE, CO).bake).toBe(true);
    expect(legacyAppWillBake({ design: m1.design, slides: m1.posterSlides, imageUrl: m1.imageUrl, texts: [m1.title, m1.body, m1.badgeText] }, HOSTS)).toBe(true);
    const m2 = msg({ poster_text: 'baked', poster_strip: { type: 'coupon', code: '{{ customer.code }}' } }, 2);
    expect(inAppBakePlan(m2, NONE, CO).bake).toBe(false);
    expect(legacyAppWillBake({ design: m2.design, slides: m2.posterSlides, imageUrl: m2.imageUrl, texts: [m2.title, m2.body, m2.badgeText] }, HOSTS)).toBe(false);
  });
  it('안내 = 누르는 동작이 다른 것만(쿠폰 · 남은 시간) · 카드만 = 없음', () => {
    expect(appCapsNote({ poster_strip: { type: 'coupon', code: 'A' } }, 1)?.text).toBe('옛 앱에서는 쿠폰 복사 버튼 없이 코드만 보여요');
    expect(appCapsNote({ poster_strip: { type: 'countdown' } }, 1)?.text).toBe('옛 앱에서는 남은 시간 대신 마감 시각이 보여요');
    expect(appCapsNote({ poster_frame: 'card' }, 3)).toBeNull();
  });
  it('(V9b) 편집기 미리보기 = 시계 · 버튼 연결이 부품 칸으로만 · 정지 칸 전달 · 구버전 앱 모습 = 구운 모습 부품', () => {
    const fe = (rel: string) => fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'frontend', 'src', ...rel.split('/')), 'utf8');
    const pfp = fe('components/inapp/PosterFramePreview.tsx');
    expect(pfp).toContain('const timer = parts.stripTimer && endMs !== null');
    expect(pfp).toContain("text: replaceVars, displayFont: safeFontFamily(design?.font_display, ''), still,");
    expect(pfp).toContain('rail.textContent = PREVIEW_RAIL_CSS;');
    const lbp = fe('components/inapp/LegacyBakedPreview.tsx');
    expect(lbp).toContain('still={{ deadlineText: inAppDeadlineText(endAt ?? null), ...(full ? { full: true } : {}) }}');   // ★ C118 B2 인앱용 = full
    expect(fe('components/inapp/PosterEditor.tsx')).toContain('const bakeJudge = legacyApp ? legacyAppWillBake(');
    expect(fe('components/inapp/PosterEditor.tsx')).toContain('const bakedLegacy = bakeJudge === true;');
    expect(fe('components/InAppMessagePreview.tsx')).toContain('const bakeJudge = legacyPoster ? legacyAppWillBake(');
    expect(fe('components/InAppMessagePreview.tsx')).toContain('const bakedLegacy = bakeJudge === true;');
    // (Codex 구현 1R ⑥) 넘긴 장의 버튼 = 여러 장 = 장 버튼 · 한 장 = 메시지 버튼(팝폰 InAppBottomSheet.tsx:145 · :232-235)
    expect(fe('components/InAppMessagePreview.tsx')).toContain('const bakedBtn: any = bakedSlideList.length >= 2 ? (bakedSlideList[Math.min(bakedActive, bakedSlideList.length - 1)] as any)?.cta || null : (buttons || [])[0] || null;');
    expect(fe('components/InAppMessagePreview.tsx')).toContain('onActive={setBakedActive}');
    // (Codex 구현 1R ⑤) 서버 화면에서 그려 안전 칸에 맞춘다
    expect(lbp).toContain('bakeFit');
    expect(pfp).toContain('viewportHeight: bakeFit ? LEGACY_BAKE_VIEW.height : h');
    // (Codex 구현 2R ②) 측정 = 변환 전 좌표(조상 배율 나눔)
    expect(pfp).toContain('const k = W > 0 ? host2.getBoundingClientRect().width / W : 1;');
    expect(pfp).toContain('const rw = r0.width / k, rh = r0.height / k, rx = (r0.left - sr.left) / k, ry = (r0.top - sr.top) / k;');
  });
});

describe('V2 보조 — SDK 가 그리는 장 수(K2)', () => {
  it('그림 없는 장은 빼고 센다 · 장 없음 = flat 한 장', () => {
    expect(inAppDrawnSlides(msg({}, 0, { posterSlides: [{ image_url: '' }, { image_url: IMG(1) }] })).length).toBe(1);
    expect(inAppDrawnSlides(msg({}, 0)).length).toBe(1);
    expect(inAppDrawnSlides(msg({}, 0, { imageUrl: null })).length).toBe(0);
  });
});
