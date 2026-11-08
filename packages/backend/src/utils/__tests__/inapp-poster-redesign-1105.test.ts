/**
 * ★ 2026-11-05 인앱 포스터 · 기능형 재구성 — 계약 시험(설계서 docs/2026-11-05-inapp-poster-function-redesign-design.md §6)
 *
 *   CT-IA1  design 새 키 셋 = 서버 화이트리스트 · SDK 부품 · 프론트 모양 키 · 앱 계약서 같은 값 · 정규화 순서(통짜 → 틀 → 띠)
 *   CT-IA2  통짜 서빙 = 글 칸 0 · 대체 글 · 라우트 개인화 뒤에도 0 · 장 없는 통짜(flat 만) = 첫 장을 만들어 대체 글 보존
 *   CT-IA3  예시 표 = 정규화 왕복 같음 · 게시를 막는 것은 예시 그림 · 채울 자리뿐 · 글에 혜택 숫자 · 낱말 · 줄표 · 가운뎃점 · 모델명 0
 *   CT-IA4  서빙 관문 hard · soft · 여러 장 카드 = hard · 판 낱말 = 서버 = SDK = 앱 계약서 · 필요 판 = SDK 표시 판정과 같은 결과
 *   CT-IA5  프론트 부품 사본 = SDK 부품 글자 같음
 *   CT-IA8  생산자(AI 생성기)가 새 키를 만들지 않는다 · 통짜 변형 규칙 = createVariant 한 곳(부르는 곳 전부)
 *   CT-IA9  판정 다섯 자리 = 쓰기 뒤 결과 행으로 같은 판정 함수 · 인라인 판정 행 0
 *   CT-IA10 R11 모델명 확대(Gemini · GPT · OpenAI · 제미나이 · 프론트 .ts/.tsx + 예시 표)
 *   CT-IA12 트랜잭션 안 DM 판정 읽기 = 그 연결(run)만 · 풀 query 직접 호출 0
 *   + 게시 판정(예시 그림 · 띠 · 끝 시각(부모만) · 통짜 바꿔 넣기 글) · 변형 판정 · DM 주소 판정 · 라우트 배선
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import {
  sanitizeInAppDesign, inAppPublishDefect, inAppRequiredCaps, parseInAppClientCaps, gateInAppForClient, toServedMessage,
  inAppVariantDefect, isPosterFamily, isBakedPoster, INAPP_CLIENT_CAPS, INAPP_POSTER_TEXTS, INAPP_POSTER_FRAMES, INAPP_POSTER_STRIPS,
  INAPP_EXAMPLE_IMAGE_PREFIX, BENEFIT_PLACEHOLDER,
} from '../inapp-message';
import { textHasPersonalizationVar, renderTextForCustomer } from '../inapp-personalization';
import { dmRefOfUrl, inAppRowLinks, inAppDmLinkPolicyDefect, INAPP_DM_PRIZE_SECTIONS } from '../inapp-dm-link-policy';
import { INAPP_EXAMPLES, inAppExampleSeed, inAppExampleIndustry, inAppExampleAssetDir } from '../inapp-examples';
import { getTemplate, findUnfilledTemplateText } from '../image-studio-templates';
import { findAiFillPlaceholder } from '../copy-benefit-detector';
// SDK 부품(순수 판정만 쓴다 · DOM 은 부르지 않는다)
import { posterFrameRequiredCaps, POSTER_FRAME_RULES } from '../../../../sdk-js/src/poster-frame';

const ROOT = join(__dirname, '..', '..', '..', '..');
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const be = (rel: string) => read(join(ROOT, 'backend', 'src', rel));
const fe = (rel: string) => read(join(ROOT, 'frontend', 'src', rel));
const sdk = (rel: string) => read(join(ROOT, 'sdk-js', 'src', rel));
const between = (s: string, a: string, b: string) => {
  const i = s.indexOf(a);
  expect(i, a).toBeGreaterThan(-1);
  const j = s.indexOf(b, i + a.length);
  return s.slice(i, j > -1 ? j : undefined);
};
const quotedList = (src: string, name: RegExp): string[] => {
  const m = src.match(name);
  expect(m, String(name)).toBeTruthy();
  return Array.from(m![1].matchAll(/'([^']+)'/g)).map((x) => x[1]);
};

// ─────────────────────────────── CT-IA1 ───────────────────────────────
describe('CT-IA1 design 새 키 셋 · 정규화', () => {
  it('통짜 · 틀 · 띠만 받는다(모르는 값 = 버림)', () => {
    expect(sanitizeInAppDesign({ poster_text: 'baked' })).toEqual({ poster_text: 'baked' });
    expect(sanitizeInAppDesign({ poster_text: 'x', poster_frame: 'y', poster_strip: { type: 'z' } })).toBeNull();
    expect(sanitizeInAppDesign({ poster_frame: 'card' })).toEqual({ poster_frame: 'card' });
  });
  it('순서 = 통짜 → 틀 → 띠 · 통짜는 poster_layout 을 지운다 · 이벤트 카드 · 배너 시트에는 틀 · 띠를 버린다', () => {
    expect(sanitizeInAppDesign({ poster_text: 'baked', poster_layout: 'event_card', poster_frame: 'card', poster_strip: { type: 'countdown' } }))
      .toEqual({ poster_text: 'baked', poster_frame: 'card', poster_strip: { type: 'countdown' } });
    expect(sanitizeInAppDesign({ poster_layout: 'banner_sheet', poster_frame: 'card', poster_strip: { type: 'coupon', code: 'A' } }))
      .toEqual({ poster_layout: 'banner_sheet' });
  });
  it('쿠폰 코드 = 줄바꿈 제거 · 앞뒤 공백 · 40자 · 글자 종류는 저장에서 거르지 않는다(초안 자리표 보존) · 라벨 30자', () => {
    const d = sanitizeInAppDesign({ poster_strip: { type: 'coupon', code: `  AB\nCD ${'x'.repeat(60)}`, label: 'L'.repeat(40) } })!;
    expect(d.poster_strip.code).toBe(`ABCD ${'x'.repeat(35)}`);
    expect(d.poster_strip.label).toHaveLength(30);
    expect(sanitizeInAppDesign({ poster_strip: { type: 'coupon', code: '[쿠폰 코드: 직접 입력해주세요]' } })!.poster_strip.code).toBe('[쿠폰 코드: 직접 입력해주세요]');
  });
  it('값 표 = 서버 · SDK 부품 · 프론트 모양 키 · 앱 계약서', () => {
    expect([...INAPP_POSTER_TEXTS]).toEqual(['baked']);
    expect([...INAPP_POSTER_FRAMES]).toEqual(['card']);
    expect([...INAPP_POSTER_STRIPS]).toEqual(['coupon', 'countdown']);
    const part = sdk('poster-frame.ts');
    expect(part).toContain("design.poster_text === 'baked'");
    expect(part).toContain("design.poster_frame === 'card'");
    expect(part).toMatch(/strip === 'coupon' \|\| strip === 'countdown'/);
    const slides = fe('components/inapp/inappSlides.ts');
    expect(slides).toContain("d.poster_text = 'baked'");
    expect(slides).toContain("d.poster_frame = 'card'");
    const contract = fe('components/inapp/AppIntegrationContract.tsx');
    for (const k of ['poster_text = "baked"', 'poster_frame = "card"', 'poster_strip.type = "coupon"', 'poster_strip.type = "countdown"']) expect(contract).toContain(k);
  });
  it('세 키는 포스터(full_image)일 때만 읽힌다 = isPosterFamily 한 곳', () => {
    expect(isPosterFamily({ template: 'full_image' })).toBe(true);
    expect(isPosterFamily({ template: 'center_modal', design: { poster_text: 'baked' } })).toBe(false);
    expect(isBakedPoster({ template: 'center_modal', design: { poster_text: 'baked' } })).toBe(false);
    expect(inAppRequiredCaps({ template: 'center_modal', design: { poster_text: 'baked', poster_strip: { type: 'coupon' } } })).toEqual({ hard: [], soft: [] });
  });
});

// ─────────────────────────────── CT-IA4 ───────────────────────────────
describe('CT-IA4 서빙 관문', () => {
  const row = (design: any, slides = 1) => ({ template: 'full_image', design, poster_slides: Array.from({ length: slides }, (_, i) => ({ image_url: `/${i}.jpg` })) });
  it('필요 판 표', () => {
    expect(inAppRequiredCaps(row({ poster_text: 'baked' }))).toEqual({ hard: ['poster_baked'], soft: [] });
    expect(inAppRequiredCaps(row({ poster_strip: { type: 'coupon' } }))).toEqual({ hard: ['strip_coupon'], soft: [] });
    expect(inAppRequiredCaps(row({ poster_strip: { type: 'countdown' } }))).toEqual({ hard: ['strip_countdown'], soft: [] });
    expect(inAppRequiredCaps(row({ poster_frame: 'card' }, 1))).toEqual({ hard: [], soft: ['frame_card'] });
    // 여러 장 카드 = hard(옛 클라이언트가 틀을 지우면 4:5 cover 캐러셀로 잘라 그린다 · Codex 1R C3)
    expect(inAppRequiredCaps(row({ poster_frame: 'card' }, 2))).toEqual({ hard: ['frame_card'], soft: [] });
    expect(inAppRequiredCaps(row({}))).toEqual({ hard: [], soft: [] });
  });
  it('필요 판 = SDK 표시 판정(posterFrameRequiredCaps · 편집기 「앱 새 판」 표시)과 같은 결과', () => {
    const designs = [{}, { poster_text: 'baked' }, { poster_frame: 'card' }, { poster_text: 'baked', poster_frame: 'card', poster_strip: { type: 'coupon' } },
      { poster_strip: { type: 'countdown' } }, { poster_strip: { type: 'x' } }, { poster_frame: 'card', poster_strip: { type: 'countdown' } }];
    for (const d of designs) for (const n of [0, 1, 2, 5]) {
      expect(posterFrameRequiredCaps(d, n), JSON.stringify([d, n])).toEqual(inAppRequiredCaps(row(d, n)));
    }
  });
  it('요청 낱말 = 표 밖 버림 · 200자 · 20낱말', () => {
    expect([...parseInAppClientCaps('poster_baked, frame_card,foo,,strip_coupon')]).toEqual(['poster_baked', 'frame_card', 'strip_coupon']);
    expect(parseInAppClientCaps(undefined).size).toBe(0);
    expect(parseInAppClientCaps(['poster_baked']).size).toBe(0);
    expect(parseInAppClientCaps(`${'x,'.repeat(25)}poster_baked`).size).toBe(0);
  });
  it('★ C114 I-2 내보내지 않음 0 — 판이 빠져도 보낸다 · 카드 판 없음 = 사본에서 틀만 지움(장 수 무관 · 저장 행 무변경) · 나머지 변환 = c114-inapp-serve-1108', () => {
    const baked: any = { id: 'a', template: 'full_image', design: { poster_text: 'baked' }, posterSlides: [{ image_url: '/a.jpg' }] };
    expect(gateInAppForClient(baked, new Set())).toBe(baked);
    expect(gateInAppForClient(baked, new Set(['poster_baked']))).toBe(baked);
    const card: any = { id: 'b', template: 'full_image', design: { poster_frame: 'card', dismiss_mode: 'snooze_day' }, posterSlides: [{ image_url: '/a.jpg' }] };
    const out = gateInAppForClient(card, new Set());
    expect(out.design).toEqual({ dismiss_mode: 'snooze_day' });
    expect(card.design).toEqual({ poster_frame: 'card', dismiss_mode: 'snooze_day' });
    const multi: any = { ...card, posterSlides: [{ image_url: '/a.jpg' }, { image_url: '/b.jpg' }] };
    expect(gateInAppForClient(multi, new Set()).design).toEqual({ dismiss_mode: 'snooze_day' });
    expect(gateInAppForClient(multi, new Set(['frame_card']))).toBe(multi);
  });
  it('판 낱말 = 서버 = SDK = 앱 계약서', () => {
    expect(quotedList(sdk('inapp.ts'), /export const INAPP_SDK_CAPS = \[([^\]]+)\]/)).toEqual([...INAPP_CLIENT_CAPS]);
    expect(quotedList(fe('components/inapp/AppIntegrationContract.tsx'), /export const APP_CONTRACT_CAPS = \[([^\]]+)\]/)).toEqual([...INAPP_CLIENT_CAPS]);
  });
  it('관문 자리 = 변형 고르기 뒤 · 매핑 직후 한 곳(쪽 반복이 이 뒤 수를 센다) · 라우트가 caps · serverNow 를 잇는다', () => {
    const ev = between(be('utils/inapp-message.ts'), 'async function evaluateInAppCandidates(', '\n// ════');
    const iSel = ev.indexOf('selectVariantForCustomer(');
    // ★ 2026-11-08 C116 D4 서빙 한 곳 = serveInAppForClient(굽기 판정 → 구운 메시지 · 아니면 관문 → 통짜 비우기 → 옛 앱 변환 · K1 순서는 그 함수 안)
    const iGate = ev.indexOf('.map((m) => serveInAppForClient(m, clientCaps, input.companyId))');
    const iServe = iGate;
    const fn = between(be('utils/inapp-message.ts'), 'export function serveInAppForClient(', '\n/** D10');
    expect(fn).toContain('return legacyServeTransform(toServedMessage(gateInAppForClient(m, caps)), caps);');
    expect(ev).not.toContain('m !== null');
    const iOpt = ev.indexOf("i.event_type = 'opt_out'");
    expect(iSel).toBeGreaterThan(-1);
    expect(iGate).toBeGreaterThan(iSel);
    expect(iOpt).toBeGreaterThan(iServe);
    const route = between(be('routes/cdp.ts'), "router.get('/inapp/active',", "router.post('/inapp/track',");
    expect(route).toContain('const clientCaps = parseInAppClientCaps(req.query.caps);');
    expect(route).toMatch(/channel: reqChannel,\s*clientCaps,/);
    expect(route).toContain('serverNow: new Date().toISOString()');
  });
  it('SDK = 요청에 caps · 캐시 키에 caps · serverNow 차이를 캐시 항목에 함께', () => {
    const f = between(sdk('inapp.ts'), 'private async fetchAndRender(', '  /** input.customer가 없으면');
    expect(f).toContain("params.set('caps', caps);");
    expect(f).toMatch(/const cacheKey = `[^`]*\|\$\{caps\}`/);
    expect(f).toContain('this.clockOffsetMs = cached.clockOffsetMs;');
    expect(f).toContain('this.setCachedMessages(cacheKey, data.messages, serverCustomer, this.clockOffsetMs);');
  });
});

// ─────────────────────────────── CT-IA2 ───────────────────────────────
describe('CT-IA2 통짜 서빙 비우기', () => {
  const served = (m: any) => toServedMessage({ id: 'x', title: '메시지 제목', body: '본문', badgeText: 'NEW', buttons: [], imageUrl: '/a.jpg', imageLinkUrl: null, template: 'full_image', ...m });
  it('장마다 글 칸 0 · 대체 글 = 그 장 원래 제목(없으면 메시지 제목) · 버튼 · 링크 · 그림 그대로', () => {
    const out = served({ design: { poster_text: 'baked' }, posterSlides: [
      { image_url: '/a.jpg', title: '첫 장', body: 'b', eyebrow: 'e', subtitle: 's', cta: { label: '보기', action_url: '/x' }, link_url: '/l' },
      { image_url: '/b.jpg' },
    ] });
    expect(out.title).toBe('');
    expect(out.body).toBe('');
    expect(out.badgeText).toBeNull();
    expect(out.posterSlides).toEqual([
      { image_url: '/a.jpg', cta: { label: '보기', action_url: '/x' }, link_url: '/l', alt: '첫 장' },
      { image_url: '/b.jpg', alt: '메시지 제목' },
    ]);
  });
  it('(Codex 구현 1R) 장도 버튼도 없고 옛 단일 CTA(action_url)만 있는 통짜 = 같은 합성 CT 로 장 버튼을 만든다', () => {
    const out = served({ design: { poster_text: 'baked' }, posterSlides: [], buttons: [], actionUrl: '/legacy', actionLabel: '보러 가기' });
    expect(out.posterSlides[0].cta).toEqual({ label: '보러 가기', action_url: '/legacy' });
  });
  it('장 없는 통짜(flat 만) = flat 에서 첫 장을 만든 뒤 비운다(대체 글 보존 · Codex 1R C5)', () => {
    const out = served({ design: { poster_text: 'baked' }, posterSlides: [], buttons: [{ label: '가기', action_url: '/go', background_color: '#111111' }], imageLinkUrl: '/img' });
    expect(out.posterSlides).toEqual([{ image_url: '/a.jpg', cta: { label: '가기', action_url: '/go', background_color: '#111111' }, link_url: '/img', alt: '메시지 제목' }]);
    expect(out.title).toBe('');
  });
  it('통짜가 아니면 그대로(같은 객체)', () => {
    const m: any = { id: 'y', template: 'full_image', design: { poster_frame: 'card' }, title: 't', body: 'b', posterSlides: [] };
    expect(toServedMessage(m)).toBe(m);
  });
  it('라우트 개인화(제목 · 본문 · 장 글 치환) 뒤에도 글 칸 0 · 대체 글은 치환 대상이 아니다', () => {
    const out = served({ design: { poster_text: 'baked' }, posterSlides: [{ image_url: '/a.jpg', title: '첫 장' }] });
    const c = { name: '고객' };
    expect(renderTextForCustomer(out.title, c).rendered).toBe('');
    expect(renderTextForCustomer(out.body, c).rendered).toBe('');
    const route = between(be('routes/cdp.ts'), "router.get('/inapp/active',", "router.post('/inapp/track',");
    const slideBlock = between(route, 'if (Array.isArray(m.posterSlides)) {\n          m.posterSlides = m.posterSlides.map(', 'return out;');
    expect(slideBlock).not.toContain('alt');
  });
});

// ─────────────────────────────── 게시 판정 ───────────────────────────────
describe('게시 판정 — 예시 그림 · 띠 · 끝 시각(부모만) · 통짜 바꿔 넣기 글', () => {
  const base = (over: any = {}) => ({ status: 'active', template: 'full_image', title: '제목', body: '', image_url: '/a.jpg', buttons: [], content_blocks: [], poster_slides: [{ image_url: '/a.jpg', title: '제목' }], ...over });
  it('예시 그림 = 장 번호로 · 메시지 그림도', () => {
    const ex = `${INAPP_EXAMPLE_IMAGE_PREFIX}kyeolon-baked-sheet/0?v=1`;
    expect(inAppPublishDefect(base({ poster_slides: [{ image_url: '/a.jpg', title: '제목' }, { image_url: ex }] }))).toEqual({ message: '2번째 장은 예시 그림이에요. 내 그림으로 바꿔 주세요.', field: 'slide_image', slide: 1 });
    expect(inAppPublishDefect(base({ template: 'center_modal', body: 'b', image_url: ex, poster_slides: [] }))?.field).toBe('image');
  });
  it('쿠폰 띠 = 빈 코드 · 채울 자리 · 글자 종류 · 라벨 채울 자리', () => {
    const d = (strip: any) => inAppPublishDefect(base({ design: { poster_strip: strip } }));
    expect(d({ type: 'coupon', code: '' })?.field).toBe('strip');
    expect(d({ type: 'coupon', code: '[쿠폰 코드: 직접 입력해주세요]' })?.message).toBe('쿠폰 코드를 넣어 주세요.');
    expect(d({ type: 'coupon', code: 'AB CD' })?.message).toContain('영문, 숫자, 한글');
    expect(d({ type: 'coupon', code: 'WELCOME_2026-가' })).toBeNull();
    expect(d({ type: 'coupon', code: 'OK', label: '[띠 문구: 직접 입력해주세요]' })?.field).toBe('strip');
  });
  it('남은 시간 띠 = 부모 행만 끝 시각 판정(변형 행에는 기간이 없다 · S1 · S20)', () => {
    const cd = { design: { poster_strip: { type: 'countdown' } } };
    expect(inAppPublishDefect(base({ ...cd, end_at: null }))?.field).toBe('end_at');
    expect(inAppPublishDefect(base({ ...cd, end_at: new Date(Date.now() - 60_000).toISOString() }))?.message).toContain('지났어요');
    expect(inAppPublishDefect(base({ ...cd, end_at: new Date(Date.now() + 3_600_000).toISOString() }))).toBeNull();
    expect(inAppPublishDefect(base({ ...cd, end_at: null, parent_message_id: 'p' }))).toBeNull();
  });
  it('통짜 장 글 = 바꿔 넣기 글 금지 · 「30%할인」은 변수가 아니다(S2)', () => {
    const baked = (title: string) => inAppPublishDefect(base({ design: { poster_text: 'baked' }, title, poster_slides: [{ image_url: '/a.jpg', title }] }));
    expect(baked('%이름%님 반가워요')?.field).toBe('title');
    expect(baked('{{ customer.name }} 님')?.slide).toBe(0);
    expect(baked('가을 30%할인')).toBeNull();
    expect(textHasPersonalizationVar('30%할인 %특가%')).toBe(false);
    expect(textHasPersonalizationVar('%이름%')).toBe(true);
    // 글 얹기 메시지는 지금처럼 바꿔 넣기 글을 쓸 수 있다
    expect(inAppPublishDefect(base({ title: '%이름%님', poster_slides: [{ image_url: '/a.jpg', title: '%이름%님' }] }))).toBeNull();
  });
  it('새 판정은 서버 한 곳 · 화면 사본(publishDefectOf)에 더하지 않는다(R1)', () => {
    const screen = between(fe('components/inapp/inappSlides.ts'), 'export function publishDefectOf(', '\n}\n');
    for (const t of ['poster_strip', 'example-image', 'end_at', 'poster_text']) expect(screen).not.toContain(t);
  });
});

describe('변형 판정 — 통짜 원본의 변형은 통짜 변형만', () => {
  it('통짜 부모 + 글 얹기 변형 = 결함 · 원본을 되돌리면 통과', () => {
    const parent = { template: 'full_image', design: { poster_text: 'baked' } };
    expect(inAppVariantDefect({ template: 'full_image', design: {} }, parent)?.field).toBe('title');
    expect(inAppVariantDefect({ template: 'full_image', design: { poster_text: 'baked' } }, parent)).toBeNull();
    expect(inAppVariantDefect({ template: 'full_image', design: {} }, { template: 'full_image', design: {} })).toBeNull();
  });
});

// ─────────────────────────────── CT-IA9 · 잠금 한 규칙 ───────────────────────────────
describe('CT-IA9 판정 다섯 자리 = 쓰기 뒤 결과 행 · 같은 판정 함수 · 인라인 판정 행 0', () => {
  const m = be('utils/inapp-message.ts');
  const v = be('utils/inapp-variant-optimizer.ts');
  const sites: Array<[string, string]> = [
    ['create', between(m, 'export async function createInAppMessage(', '\nexport async function judgeSavedInAppRow(')],
    ['update', between(m, 'export async function updateInAppMessage(', '\n/**\n * ★ 2026-09-29 인앱 만들기 개편 — 포스터 부모의 모양을 A/B 변형에 전파')],
    ['propagate', between(m, 'export async function propagatePosterToVariants(', '\nexport async function activateInAppMessage(')],
    ['activate', between(m, 'export async function activateInAppMessage(', '\nexport async function deleteInAppMessage(')],
    ['createVariant', between(v, 'export async function createVariant(', '\nexport async function setVariantStatus(')],
  ];
  it.each(sites)('%s — RETURNING * 쓰기 뒤 judgeSavedInAppRow · inAppPublishDefect({ 인라인 0', (_name, src) => {
    const iWrite = src.search(/RETURNING \*/);
    const iJudge = src.indexOf('judgeSavedInAppRow(');
    expect(iWrite).toBeGreaterThan(-1);
    expect(iJudge).toBeGreaterThan(iWrite);
    expect(src).not.toMatch(/inAppPublishDefect\(\{/);
  });
  it('판정 함수 하나가 게시 · 변형 · DM 연결을 모두 본다', () => {
    const j = between(m, 'export async function judgeSavedInAppRow(', '\n/**');
    expect(j).toContain('inAppPublishDefect(row)');
    expect(j).toContain('inAppVariantDefect(row, lockedParent)');
    expect(j).toContain('inAppDmLinkPolicyDefect(run, companyId, row)');
  });
  it('(Codex 구현 1R high) 잠금 한 규칙 = lockParentFirst 하나 — 일반 수정 · 켜기 모두 쓰기 전에 부르고 잠근 부모를 판정에 넘긴다', () => {
    const upd = sites[1][1];
    const iLock = upd.indexOf('await lockParentFirst(client, companyId, messageId);');
    expect(iLock).toBeGreaterThan(upd.indexOf("await client.query('BEGIN');"));
    expect(iLock).toBeLessThan(upd.indexOf('SELECT status FROM cdp_inapp_messages WHERE id = $1::uuid AND company_id = $2::uuid FOR UPDATE'));
    expect(iLock).toBeLessThan(upd.indexOf('result = await client.query('));
    expect(upd).toContain('await judgeSavedInAppRow((t, p) => client.query(t, p), companyId, row, lockedParent)');
    const act = sites[3][1];
    expect(act.indexOf('await lockParentFirst(client, opts.companyId, opts.messageId, opts.parentMessageId);')).toBeLessThan(act.indexOf("UPDATE cdp_inapp_messages SET status = 'active'"));
    // 부모를 직접 잠그는 다른 사본 0(createVariant = 새 행이라 부모 행을 직접 잠근다)
    expect(m.match(/SELECT \* FROM cdp_inapp_messages WHERE id = \$1::uuid AND company_id = \$2::uuid FOR UPDATE/g)?.length).toBe(1);
  });
  it('잠금 한 규칙 — 변형을 쓰는 자리 = 부모 먼저 FOR UPDATE(createVariant · 변형 켜기) · 전파 = 부모 UPDATE 뒤 변형 FOR UPDATE', () => {
    const cv = sites[4][1];
    expect(cv.indexOf('FOR UPDATE')).toBeGreaterThan(-1);
    expect(cv.indexOf('FOR UPDATE')).toBeLessThan(cv.indexOf('INSERT INTO cdp_inapp_messages'));
    expect(cv).toContain('return withTransaction(async (run) => {');
    const act = sites[3][1];
    const iParent = act.indexOf('await lockParentFirst(');
    const iUpd = act.indexOf("UPDATE cdp_inapp_messages SET status = 'active'");
    expect(iParent).toBeGreaterThan(-1);
    expect(iParent).toBeLessThan(iUpd);
    const upd = sites[1][1];
    expect(upd.indexOf('result = await client.query(')).toBeLessThan(upd.indexOf('propagatePosterToVariants(client, row)'));
    expect(sites[2][1]).toMatch(/AND parent_message_id = \$2::uuid AND status <> 'archived'\s*FOR UPDATE/);
  });
});

// ─────────────────────────────── CT-IA8 ───────────────────────────────
describe('CT-IA8 생산자 · 통짜 변형 규칙 한 곳', () => {
  it('AI 생성기는 새 키를 만들지 않는다', () => {
    const gen = be('utils/inapp-ai-generator.ts');
    for (const k of ['poster_text', 'poster_frame', 'poster_strip']) expect(gen).not.toContain(k);
  });
  it('createVariant 를 부르는 곳 = 라우트 · 빠른 작업 둘 · 통짜 그림 필수 · 본문 필수는 createVariant 한 곳 · 라우트는 원본 · 제목만', () => {
    const files = ['routes/cdp.ts', 'utils/inapp-quick-action.ts', 'utils/inapp-message.ts', 'utils/inapp-variant-optimizer.ts'];
    const calls = files.flatMap((f) => Array.from(be(f).matchAll(/\bcreateVariant\(/g)).map(() => f));
    expect(calls.filter((f) => !f.endsWith('inapp-variant-optimizer.ts')).sort()).toEqual(['routes/cdp.ts', 'utils/inapp-quick-action.ts']);
    const cv = between(be('utils/inapp-variant-optimizer.ts'), 'export async function createVariant(', '\nexport async function setVariantStatus(');
    expect(cv).toContain("'INAPP_VARIANT_NEEDS_IMAGE'");
    const route = between(be('routes/cdp.ts'), "router.post('/inapp/variant',", "router.post('/inapp/upload-image',");
    expect(route).toContain('if (!parent_message_id || !variantData.title) {');
  });
  it('빠른 작업 AI 다듬기 = 통짜 부모는 AI 호출 · 차감 전에 거절', () => {
    const q = between(be('utils/inapp-quick-action.ts'), 'export async function quickActionAIRefine(', 'const system = `');
    expect(q).toContain('if (isBakedPoster(parent)) throw new UserFacingError(400, ');
    expect(q).toMatch(/text_color, design\s+FROM cdp_inapp_messages/);
    // 없는 칸(is_ad)을 읽지 않는다 — 실 PG 42703(운영 정의 해시 대조 덤프)
    expect(q).not.toMatch(/SELECT[^`]*is_ad/);
  });
});

// ─────────────────────────────── DM 연결 판정 · CT-IA12 ───────────────────────────────
describe('DM 참여 연결 판정', () => {
  it('주소 → DM 가리킴(정식 · 짧은 주소 · 그 밖 · 채울 자리)', () => {
    expect(dmRefOfUrl('https://hanjul.ai/api/dm/v/dm-abc123')).toEqual({ kind: 'code', code: 'dm-abc123' });
    expect(dmRefOfUrl('/api/dm/v/s/Ab12Cd')).toEqual({ kind: 'short', code: 'Ab12Cd' });
    expect(dmRefOfUrl('https://hlj.kr/Ab12Cd', 'https://hlj.kr')).toEqual({ kind: 'short', code: 'Ab12Cd' });
    expect(dmRefOfUrl('https://hlj.kr/a/b', 'https://hlj.kr')).toBeNull();
    expect(dmRefOfUrl('https://mall.example/event')).toBeNull();
    expect(dmRefOfUrl('[DM 참여 페이지: 직접 입력해주세요]')).toBeNull();
  });
  it('판정 행의 모든 링크 = 최상위 action_url · buttons · image_link_url · 장 cta · 장 link_url', () => {
    const links = inAppRowLinks({ action_url: '/a', buttons: [{ action_url: '/b' }], image_link_url: '/c', poster_slides: [{ cta: { action_url: '/d' }, link_url: '/e' }] });
    expect(links).toEqual([{ url: '/a' }, { url: '/b' }, { url: '/c' }, { url: '/d', slide: 0 }, { url: '/e', slide: 0 }]);
  });
  it('경품 · 재고 DM = 막음 · 다른 회사 · 게시 안 됨 = 막음 · 투표 DM = 통과 · 읽기는 run 으로만', async () => {
    const calls: string[] = [];
    const dms: Record<string, any> = {
      'prize': { company_id: 'c1', pages: [{ sections: [{ type: 'poll' }, { type: 'roulette' }] }] },
      'poll': { company_id: 'c1', sections: [{ type: 'poll' }] },
      'other': { company_id: 'c2', sections: [{ type: 'poll' }] },
    };
    const run: any = async (text: string, params: any[]) => {
      calls.push(text);
      if (text.includes('FROM dm_pages WHERE short_code = $1 AND status')) {
        const dm = dms[String(params[0])];
        return { rows: dm ? [dm] : [] };
      }
      return { rows: [] };
    };
    const row = (url: string) => ({ status: 'active', buttons: [{ action_url: url }] });
    expect((await inAppDmLinkPolicyDefect(run, 'c1', row('/api/dm/v/dm-prize')))?.field).toBe('link');
    expect((await inAppDmLinkPolicyDefect(run, 'c1', row('/api/dm/v/dm-other')))?.message).toContain('연결할 수 없는 DM');
    expect((await inAppDmLinkPolicyDefect(run, 'c1', row('/api/dm/v/dm-gone')))?.field).toBe('link');
    expect(await inAppDmLinkPolicyDefect(run, 'c1', row('/api/dm/v/dm-poll'))).toBeNull();
    expect(await inAppDmLinkPolicyDefect(run, 'c1', row('https://mall.example/x'))).toBeNull();
    expect(calls.length).toBeGreaterThan(0);
    expect(INAPP_DM_PRIZE_SECTIONS).toEqual(['lucky_draw', 'roulette', 'limited_quantity']);
  });
  it('CT-IA12 — 판정 함수 몸통에 풀 query 직접 호출 0 · 재사용 세 함수는 run 인자(없으면 풀 · 지금 호출처 영향 0)', () => {
    const body = between(be('utils/inapp-dm-link-policy.ts'), 'export async function inAppDmLinkPolicyDefect(', '\n}\n');
    expect(body).not.toMatch(/\bquery\(/);
    expect(body).not.toMatch(/\bpool\./);
    for (const fn of ['lookupDmShortLink(ref.code, run)', 'lookupCustomShortLink(ref.code, run)', 'getDmByCode(code, run)']) expect(body).toContain(fn);
    expect(be('utils/dm/dm-builder.ts')).toContain('export async function getDmByCode(code: string, run: TxRun = query) {');
    expect(be('utils/dm/dm-recipient-token.ts')).toContain('export async function lookupDmShortLink(code: string, run: TxRun = query)');
    expect(be('utils/dm/dm-custom-short-link.ts')).toContain('export async function lookupCustomShortLink(code: string, run: TxRun = query)');
    const lk = between(be('utils/dm/dm-recipient-token.ts'), 'export async function lookupDmShortLink(', '\n}\n');
    expect(lk).not.toMatch(/await query\(/);
  });
});

// ─────────────────────────────── CT-IA3 예시 표 ───────────────────────────────
describe('CT-IA3 예시 표', () => {
  const textsOf = (ex: (typeof INAPP_EXAMPLES)[number]): string[] => {
    const out: string[] = [ex.title, ex.brand];
    for (const s of ex.seed.poster_slides || []) out.push(s.eyebrow, s.title, s.body, s.cta?.label);
    if (ex.seed.design?.poster_strip?.label) out.push(ex.seed.design.poster_strip.label);
    for (const sl of ex.slides) out.push(sl.texts.label, sl.texts.title, sl.texts.subtitle);
    return out.filter((t): t is string => typeof t === 'string' && !!t.trim() && !t.startsWith('['));
  };
  it('id = 파일 이름 꼴 · 겹침 0 · 업종 · 장 수 = seed 장 수 · 템플릿 · 누끼 실재', () => {
    const ids = INAPP_EXAMPLES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const ex of INAPP_EXAMPLES) {
      expect(ex.id).toMatch(/^[a-z0-9-]+$/);
      expect(['beauty', 'fashion', 'commerce', 'cafe']).toContain(ex.industry);
      expect(ex.slides.length).toBe(ex.seed.poster_slides.length);
      for (const sl of ex.slides) {
        expect(getTemplate(sl.studioTemplateId), sl.studioTemplateId).toBeTruthy();
        if (sl.product) expect(existsSync(join(inAppExampleAssetDir(), sl.product)), sl.product).toBe(true);
      }
    }
  });
  it('글 = 혜택 숫자 · 혜택 낱말 · 줄표 · 가운뎃점 · 모델명 0(사람이 쓴 표 · 혜택은 채울 자리)', () => {
    for (const ex of INAPP_EXAMPLES) for (const t of textsOf(ex)) {
      expect(t, `${ex.id}: ${t}`).not.toMatch(/\d\s*%|\d[\d,]*\s*원|쿠폰|무료|할인|증정|—|–|·|Gemini|GPT|OpenAI|제미나이|Claude/);
    }
  });
  it('seed = 정규화 왕복 같음 · 게시를 막는 것은 예시 그림 · 채울 자리뿐 · 그림을 바꾸고 자리를 채우면 통과', () => {
    for (const ex of INAPP_EXAMPLES) {
      const seed = inAppExampleSeed(ex, ex.slides.map(() => 1));
      expect(sanitizeInAppDesign(seed.design), ex.id).toEqual(seed.design);
      const row = { status: 'active', template: 'full_image', title: seed.poster_slides[0].title, body: '', buttons: [], content_blocks: [],
        image_url: seed.poster_slides[0].image_url, poster_slides: seed.poster_slides, design: seed.design, end_at: new Date(Date.now() + 3_600_000).toISOString() };
      const d = inAppPublishDefect(row);
      expect(d, ex.id).not.toBeNull();
      expect(['slide_image', 'placeholder', 'strip'], `${ex.id}: ${d?.message}`).toContain(d!.field);
      const fill = (v: any): any => JSON.parse(JSON.stringify(v).replace(/\[[^\]"]{0,60}직접 (?:입력|작성)해주세요\]/g, 'FILLED1'));
      const fixed = fill({ ...row, poster_slides: row.poster_slides.map((s: any, i: number) => ({ ...s, image_url: `/mine/${i}.jpg` })), image_url: '/mine/0.jpg' });
      expect(inAppPublishDefect(fixed), ex.id).toBeNull();
    }
  });
  it('혜택 자리가 필요한 예시(쿠폰 · 남은 시간)는 seed 부제 = 혜택 자리표 · 쿠폰 코드 = 자리표 · 「AI로 내 그림 만들기」 = 생성 판정이 막는 꼴', () => {
    for (const ex of INAPP_EXAMPLES.filter((e) => e.seed.design?.poster_strip)) {
      expect(ex.seed.poster_slides[0].body, ex.id).toBe(BENEFIT_PLACEHOLDER);
      if (ex.seed.design.poster_strip.type === 'coupon') expect(findAiFillPlaceholder(ex.seed.design.poster_strip.code), ex.id).toBeTruthy();
    }
    // 편집기 「AI로 내 그림 만들기」 미리 채움 = 부제에 혜택 자리표(생성 라우트 findUnfilledTemplateText 가 막는다)
    expect(findUnfilledTemplateText({ label: '회사', title: '제목', subtitle: '[혜택 안내: 직접 작성해주세요]' })).toBe('subtitle');
    const page = fe('pages/InAppMessagesPage.tsx');
    expect(page).toContain('const subtitle = fromExample ? BENEFIT_SLOT : String(cur?.body ||');
    expect(fe('components/inapp/inappStarters.ts')).toContain("export const BENEFIT_SLOT = '[혜택 안내: 직접 작성해주세요]';");
  });
  it('업종 = 스튜디오 「우리 업종 먼저」 셋만(그 밖 null = 전체)', () => {
    expect(inAppExampleIndustry('beauty')).toBe('beauty');
    expect(inAppExampleIndustry('fashion')).toBe('fashion');
    expect(inAppExampleIndustry('food')).toBe('cafe');
    expect(inAppExampleIndustry('digital')).toBeNull();
    expect(inAppExampleIndustry(null)).toBeNull();
  });
  it('R15 — 새 주소 둘을 갤러리가 부른다 · 공개 그림 주소는 인증 앞 · 목록은 인증 뒤', () => {
    const r = be('routes/cdp.ts');
    const iAuth = r.indexOf('router.use(authenticate);');
    expect(r.indexOf("router.get('/inapp/example-image/:id/:slide',")).toBeLessThan(iAuth);
    expect(r.indexOf("router.get('/inapp/examples',")).toBeGreaterThan(iAuth);
    expect(r.indexOf("router.get('/inapp/dm-links',")).toBeGreaterThan(iAuth);
    expect(fe('components/inapp/InAppExampleGallery.tsx')).toContain("studioFetch('/api/cdp/inapp/examples')");
    expect(fe('components/inapp/InAppDmLinkPicker.tsx')).toContain("studioFetch('/api/cdp/inapp/dm-links')");
    expect(be('utils/inapp-examples.ts')).toContain('`${INAPP_EXAMPLE_IMAGE_PREFIX}${id}/${slide}');
    expect(fe('components/inapp/PosterEditor.tsx')).toContain("export const EXAMPLE_IMAGE_PREFIX = '/api/cdp/inapp/example-image/';");
    expect(INAPP_EXAMPLE_IMAGE_PREFIX).toBe('/api/cdp/inapp/example-image/');
  });
});

// ─────────────────────────────── CT-IA5 · CT-IA6 일부 ───────────────────────────────
describe('CT-IA5 프론트 부품 사본 = SDK 원본 글자 같음', () => {
  it('머리 한 줄을 뺀 본문이 같다(사본을 직접 고치지 않는다 · node scripts/sync-poster-frame.mjs)', () => {
    const copy = fe('components/inapp/generated/poster-frame.ts');
    const header = copy.slice(0, copy.indexOf('\n') + 1);
    expect(header).toContain('자동 복사본');
    expect(copy.slice(header.length)).toBe(sdk('poster-frame.ts'));
  });
  it('규칙 상수 값(계약서 · 깔끔 규칙)', () => {
    expect(POSTER_FRAME_RULES.closeHit).toBe(44);
    expect(POSTER_FRAME_RULES.maxHeightRatio).toBe(0.72);
    expect(POSTER_FRAME_RULES.ctaHeight).toBe(48);
    expect(POSTER_FRAME_RULES.stripHeight).toBe(52);
    expect(POSTER_FRAME_RULES.card.maxWidth).toBe(400);
    expect(POSTER_FRAME_RULES.card.sideMargin).toBe(28);
    expect(POSTER_FRAME_RULES.sheet.maxWidth).toBe(520);
    expect([...POSTER_FRAME_RULES.overImageParts]).toEqual(['pager']);
  });
});

// ─────────────────────────────── CT-IA10 R11 확대 ───────────────────────────────
describe('CT-IA10 모델명 0 — 프론트 .ts · .tsx 전부 + 예시 표', () => {
  const FE = join(ROOT, 'frontend', 'src');
  const files: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(n)) files.push(p);
    }
  };
  walk(FE);
  it('Gemini · GPT · OpenAI · 제미나이 = 화면 글 0', () => {
    const bad = files.filter((f) => /['"`>][^'"`<>]*(\bGemini\b|\bGPT\b|\bOpenAI\b|제미나이)[^'"`<>]*['"`<]/.test(read(f).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')));
    expect(bad).toEqual([]);
  });
  it('예시 표에 모델명 0', () => {
    expect(be('utils/inapp-examples.ts').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')).not.toMatch(/Gemini|GPT|OpenAI|제미나이|Claude|Anthropic/);
  });
});

// ─────────────────────────────── 화면 배선 ───────────────────────────────
describe('화면 배선 — 죽은 단추 0 · 서버 결함 데려가기 · 앱 판 · 배너 시트 입구 내림', () => {
  it('통짜 메시지 = 문구 다듬기 단추 대신 이유 한 줄', () => {
    const page = fe('pages/InAppMessagesPage.tsx');
    expect(page).toContain("action.type === 'ai_refine' && refineBaked ? (");
    expect(page).toContain("refineTarget.template === 'full_image' && (refineTarget.design as any)?.poster_text === 'baked'");
  });
  it('서버 결함 자리 = 띠 · 끝 시각 · 링크 · 사진', () => {
    const h = between(fe('pages/InAppMessagesPage.tsx'), 'const handleServerError = (data: any) => {', "if (data?.code === 'INAPP_DISPLAY_UNAVAILABLE')");
    for (const f of ["f === 'end_at'", "f === 'strip'", "f === 'link'", "f === 'slide_image'"]) expect(h).toContain(f);
  });
  it('앱 표시 = 확인된 판 상수(처음 빈 집합) · 옛 전역 잠금 상수 삭제', () => {
    const slides = fe('components/inapp/inappSlides.ts');
    expect(slides).toContain('export const APP_CONFIRMED_CAPS: ReadonlySet<string> = new Set<string>([]);');
    for (const f of ['components/inapp/inappSlides.ts', 'components/inapp/PosterEditor.tsx', 'components/inapp/InAppEntryGallery.tsx', 'pages/InAppMessagesPage.tsx']) {
      expect(fe(f).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')).not.toContain('APP_SHEET_LAYOUTS_UNLOCKED');
    }
  });
  it('배너 시트 = 입구 · 모양 바꾸기에서 내림(이미 배너 시트인 메시지에만) · 시작본 = 통짜', () => {
    const slides = fe('components/inapp/inappSlides.ts');
    expect(slides).toContain("...(current === 'banner_sheet' ? ['banner_sheet' as LayoutKey] : [])");
    const starters = fe('components/inapp/inappStarters.ts');
    expect(starters).not.toContain("layout: 'banner_sheet'");
    expect(starters).toContain("design: { poster_text: 'baked', dismiss_mode: 'snooze_day' }");
  });
  it('공용 스튜디오 창 = 새 인자 셋(DM 호출부 무변경 · 둘째 인자 안 씀)', () => {
    const m = fe('components/dm/build/StudioInsertModal.tsx');
    expect(m).toContain('onInserted: (url: string, texts?: StudioTexts) => void;');
    expect(m).toContain('initialTemplateId?: string | null;');
    expect(m).toContain("const r = await make.generate({ textless, presetKey: usePreset, textPosition: use === 'inapp' && !textless ? zone : null });");   // ★ C118 A4 용도 고정
  });
});
