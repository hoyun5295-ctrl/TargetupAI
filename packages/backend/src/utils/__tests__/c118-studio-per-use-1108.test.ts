/**
 * ★ 2026-11-08 C118 용도별 제작 · 앱 채널 모양 — 계약 시험(설계서 docs/2026-11-08-c118-studio-per-use-inapp-app-design.md §4 T1 ~ T11 · T8 · T10 SDK 쪽 = sdk-js c118-frame-1108)
 *   뿌리 R83(남의 렌더러 칸 규칙에 맞춤 = 이미 깔린 앱이 실제로 그리는 것만) · R-용도(한 장으로 모든 채널 = 품질 하락 → 용도별 크기 · 인앱용 = 꽉 찬 정사각)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// 저장 경로는 모듈 로드 시점에 env 로 굳는다 — import 보다 먼저(c112 시험과 같은 꼴)
const DIRS = vi.hoisted(() => {
  const nodeFs = require('fs') as typeof import('fs');
  const nodeOs = require('os') as typeof import('os');
  const nodePath = require('path') as typeof import('path');
  const root = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'c118-'));
  const d = { inapp: nodePath.join(root, 'inapp'), temp: nodePath.join(root, 'temp') };
  process.env.INAPP_IMAGE_PATH = d.inapp;
  process.env.STUDIO_TEMP_PATH = d.temp;
  return d;
});
// DB = 표 행만 돌려주는 가짜(굽기 대상 · app-ready 는 서빙과 같은 사본을 쓰는지만 본다)
const DB = vi.hoisted(() => ({ rows: [] as any[], sql: [] as string[] }));
vi.mock('../../config/database', () => ({
  query: vi.fn(async (sql: string, params: any[]) => {
    DB.sql.push(sql);
    if (/WHERE id = \$1::uuid/.test(sql)) return { rows: DB.rows.filter((r) => r.id === params[0]) };
    if (/WHERE parent_message_id = \$1::uuid/.test(sql)) return { rows: DB.rows.filter((r) => r.parent_message_id === params[0] && r.status === 'active') };
    return { rows: [] };
  }),
  pool: { query: vi.fn(async () => ({ rows: [] })), connect: vi.fn() },
  withTransaction: vi.fn(),
}));
// 굽기 판 읽기 · 요청 = 가로채기(나머지 굽기 CT 는 진짜)
const BAKE = vi.hoisted(() => ({ have: new Set<string>(), requests: [] as any[] }));
vi.mock('../inapp-bake', async (orig) => {
  const m = await orig<typeof import('../inapp-bake')>();
  return {
    ...m,
    readInAppBake: (_co: string, key: string, expected: number) => (BAKE.have.has(key) ? Array.from({ length: expected }, (_, i) => `/b/${key}-${i}.jpg`) : null),
    requestInAppBake: (job: any) => { BAKE.requests.push(job); return 'queued'; },
  };
});

import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import {
  CHANNEL_PRESETS, resolvePreset, buildPosterPrompt, isStudioFullPreset, studioPermanentName, STUDIO_FULL_PRESET,
  writeTempMeta, moveTempToPermanent, findPermanentByTempId, restorePermanentToTemp, writeStudioPermanent, findTempFile,
} from '../image-studio';
import { getTemplate } from '../image-studio-templates';
import { ASPECT_RATIOS, INAPP_STAGE_FILL, INAPP_CONTENT_SAFE } from '../image-fit-spec';
import { logoPlacement, LOGO_MARGIN_RATIO } from '../studio-zones';
import { readDiscountOffer, discountPromptLines, discountFixedLayoutLine } from '../studio-discount';
import {
  APP_BASIC_IMAGE, appBasicImageVisible, activeAfterRemove, withMessageImage,
} from '../../../../frontend/src/components/inapp/inappSlides';
import { logoSafeEdgeOf } from '../studio-logo';
import { POSTER_FRAME_RULES } from '../../../../sdk-js/src/poster-frame';
import { getServePath } from '../image-serve';
import { composeInAppBakeSlide, INAPP_BAKE_VERSION } from '../inapp-bake';
import {
  appShapeAllowed, appShapeTransitionBlocked, APP_SHAPE_ERROR, isFullBleedInAppImage, withInAppImageFit, inAppFitQuery,
  inAppBakePlan, serveInAppForClient, legacyServeTransform, toServedMessage, gateInAppForClient,
  servedVariantRow, inAppBakeTargets, inAppAppReady, prebakeInAppMessage,
} from '../inapp-message';
import {
  APP_LAYOUT_KEYS, layoutsFor, appShapeAllowedFor, appSafeLayoutKey, stripAllowedFor, designForKey, type LayoutKey,
} from '../../../../frontend/src/components/inapp/inappSlides';
import {
  isFullBleedInAppImageUrl, legacyAppWillBake, legacyAppPreviewOf, legacyAppImageUrl, legacyAppBakesFull,
  LEGACY_FULL_FIT_REV, DEFAULT_OWN_IMAGE_HOSTS, type OwnHostsSnapshot,
} from '../../../../frontend/src/components/inapp/legacy-app-view';

const CO = '11111111-2222-3333-4444-555555555555';
const T1D = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1';
const T2D = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee2';
const IMG = (n: number | string) => `/api/cdp/inapp/image/${CO}/p${n}.jpg`;
const FULL = (n: number | string) => `/api/cdp/inapp/image/${CO}/s${n}.full.jpeg`;
const NONE = new Set<string>();
const READY: OwnHostsSnapshot = { status: 'ready', hosts: DEFAULT_OWN_IMAGE_HOSTS };
const fe = (rel: string) => fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'frontend', 'src', ...rel.split('/')), 'utf8');
const be = (rel: string) => fs.readFileSync(path.join(__dirname, '..', '..', ...rel.split('/')), 'utf8');
const msg = (design: any, slides: Array<Record<string, any>>, over: Record<string, any> = {}): any => ({
  id: 'aaaaaaaa-0000-0000-0000-000000000001', template: 'full_image', title: '제목', body: '본문', badgeText: null, imageUrl: slides[0]?.image_url ?? IMG(0),
  buttons: [{ id: 'b1', label: '바로가기', action_url: 'https://www.invitocorp.com', style: 'primary' }],
  endAt: '2026-11-30T14:59:00.000Z', design, status: 'active', variantWeight: 100, posterSlides: slides, ...over,
});

// ─────────────────────────────────────────────────────────────────────────
describe('T1 용도 프리셋 넷 · 옛 키 그대로 · 화면 표 = 서버 표', () => {
  it('용도 넷 = 비율 · 채널 규격(설계서 A1 표)', () => {
    const pick = (k: string) => ({ ar: CHANNEL_PRESETS[k].aspectRatio, spec: CHANNEL_PRESETS[k].channelSpec });
    expect(pick('use-inapp')).toEqual({ ar: '1:1', spec: 'inapp-poster' });
    expect(pick('use-dm')).toEqual({ ar: '3:4', spec: 'dm' });
    expect(pick('use-email')).toEqual({ ar: '4:3', spec: 'email' });
    expect(pick('poster')).toEqual({ ar: '3:4', spec: 'poster' });
  });
  it('옛 키 다섯 = 값 무변경(옛 임시 · 자산 해석)', () => {
    expect(['inapp-poster', 'dm-card', 'email-hero', 'free', 'mms'].map((k) => [k, CHANNEL_PRESETS[k].aspectRatio, CHANNEL_PRESETS[k].channelSpec])).toEqual([
      ['inapp-poster', '3:4', 'inapp-poster'], ['dm-card', '1:1', 'dm'], ['email-hero', '16:9', 'email'], ['free', '3:4', 'free'], ['mms', '3:4', 'mms'],
    ]);
    expect(resolvePreset('없는키').key).toBe('poster');
  });
  it('인앱용 판정 = use-inapp 하나', () => {
    expect(STUDIO_FULL_PRESET).toBe('use-inapp');
    expect(['use-inapp', 'inapp-poster', 'poster', 'use-dm', undefined, null].map(isStudioFullPreset)).toEqual([true, false, false, false, false, false]);
  });
  it('화면 용도 표(StudioUsePicker STUDIO_USES) = 서버 프리셋 키 · 비율(기계 추출)', () => {
    const src = fe('components/studio/StudioUsePicker.tsx');
    const rows = [...src.matchAll(/\{ key: '(\w+)', presetKey: '([\w-]+)', label: '[^']+', size: '[^']+', ratio: '(\d+) \/ (\d+)'/g)].map((m) => [m[1], m[2], `${m[3]}:${m[4]}`]);
    expect(rows.map((r) => r[0])).toEqual(['inapp', 'dm', 'email', 'free']);
    for (const [, key, ratio] of rows) expect(CHANNEL_PRESETS[key].aspectRatio, key).toBe(ratio);
  });
});

describe('T2 인앱 용도 프롬프트', () => {
  const t = getTemplate('beauty-clean-bright')!;
  for (const zone of ['top', 'bottom'] as const) {
    it(`글 자리 ${zone} = 꽉 찬 정사각 · 테두리 · 상자 · 띠 0 · 가운데 80% · 고른 쪽 자연 빈 공간 · 주제 반대쪽`, () => {
      const p = buildPosterPrompt({ template: t, preset: resolvePreset('use-inapp'), hasProduct: true, texts: { title: '맑게' }, textPosition: zone });
      expect(p).toContain('aspect ratio 1:1');
      expect(p).toContain('full-bleed square in-app popup visual');
      expect(p).toContain('no frame, border, card, box, banner bar or empty margins');
      expect(p).toContain('central 80% of the width and the central 80% of the height');
      const half = zone === 'top' ? 'upper' : 'lower';
      const other = zone === 'top' ? 'lower' : 'upper';
      expect(p).toContain(`The ${half} part of the square is a natural, color-matched calm continuation of the same scene where the copy sits, not a panel or overlay box.`);
      expect(p).toContain(`Place the main subject and props in the ${other} part`);
    });
  }
  it('인앱 아닌 용도 = 인앱 문장 0(지금 그대로)', () => {
    for (const k of ['poster', 'use-dm', 'use-email']) {
      const p = buildPosterPrompt({ template: t, preset: resolvePreset(k), hasProduct: true, texts: { title: '맑게' }, textPosition: 'top' });
      expect(p, k).not.toContain('full-bleed square in-app popup');
    }
  });
});

describe('T3 글 자리 = 인앱 용도면 모든 템플릿 · 그 밖 지금 그대로', () => {
  it('서버 /generate = 템플릿 종류로 거르지 않고 허용 값만(위 · 가운데 · 아래)', () => {
    const r = be('routes/image-studio.ts');
    expect(r).toContain("const textPos = textPosition === 'top' || textPosition === 'center' || textPosition === 'bottom' ? textPosition : null;");
    expect(r).toContain('textPosition: textPos,');
  });
  it('화면 요청 본문 = 인앱 용도 → 고른 자리(모든 템플릿) · 글 없는 판 = 아래 · 그 밖 = 행사만', () => {
    const s = fe('components/studio/StudioMake.tsx');
    expect(s).toContain("const inappUse = opts?.presetKey === 'use-inapp';");
    expect(s).toContain("textPosition: textless ? 'bottom' : (inappUse ? (discountKind ? 'top' : (opts?.textPosition || 'top')) : (isEvent(template) ? textPosition : null)),");
    expect(s).toContain("templateId: template.id, presetKey: opts?.presetKey || 'poster',");
  });
  it('편집기 안 스튜디오 = 용도 고정(DM = use-dm · 인앱 = use-inapp + 글 자리 · 글 없는 판 = 고르기 없음)', () => {
    const m = fe('components/dm/build/StudioInsertModal.tsx');
    expect(m).toContain("const usePreset = use === 'inapp' ? 'use-inapp' : 'use-dm';");
    expect(m).toContain("make.generate({ textless, presetKey: usePreset, textPosition: use === 'inapp' && !textless ? zone : null })");
    expect(m).toContain("{use === 'inapp' && !textless && (");
    expect(fe('pages/InAppMessagesPage.tsx')).toMatch(/<StudioInsertModal\s+open=\{studioOpen\}\s+onClose=\{\(\) => setStudioOpen\(false\)\}\s+use="inapp"/);
  });
});

describe('T4 용도 고르기 → 칸 · 얼린 본문 · 다시 만들기 · 크레딧 표시', () => {
  const page = fe('pages/ImageStudioPage.tsx');
  const make = fe('components/studio/StudioMake.tsx');
  const picker = fe('components/studio/StudioUsePicker.tsx');
  it('「만들기」 = 용도 고르기 창(바로 만들지 않음)', () => {
    expect(page).toContain('setUsePickerOpen(true);');
    expect(page).toContain('<StudioUsePicker open={usePickerOpen} isAdmin={isCompanyAdmin}');
    expect(page).not.toContain('const r = await make.generate();');
  });
  it('고른 용도마다 칸 = 얼린 본문 + 새 표 · 차례로', () => {
    expect(page).toContain("const body = make.buildGenerateBody({ presetKey: u.presetKey, textPosition: u.key === 'inapp' ? pick.zone : null });");
    expect(page).toContain('slots.push({ use: u.key, presetKey: u.presetKey, label: u.label, poster: u.poster, body, token: newStudioAttempt() });');
    expect(page).toContain('if (!(await runSlot(slots[i], i, slots.length))) failed.push(slots[i]);');
  });
  it('다시 만들기 = 같은 표 + 같은 본문(지금 입력으로 다시 짜지 않음) · 성공 때만 칸 걷힘', () => {
    expect(page).toContain('const r = await make.runGenerateBody(slot.body, slot.token, false,');
    expect(page).toContain('if (await runSlot(slot, 0, 1)) setFailedSlots((prev) => prev.filter((x) => x !== slot));');
    const retry = page.slice(page.indexOf('const retrySlot'), page.indexOf('void GENERATE_PRESET_KEY'));
    expect(retry).not.toContain('buildGenerateBody');
  });
  it('보내는 본문 = 얼린 사본 + 표(지금 입력을 다시 읽지 않음) · 결과 문구 = 얼린 본문의 문구', () => {
    expect(make).toContain("await studioPost('/api/image-studio/generate', { ...body, attemptToken });");
    expect(make).toContain('const bt = (body.texts || {}) as StudioTexts;');
    expect(make).toContain('texts: { ...sendTexts }, userHint: hint || null,');
  });
  it('용도로 만든 그림 = 그 채널 버튼 하나(자유 = 셋)', () => {
    expect(page).toContain("return k === 'inapp' || k === 'dm' || k === 'email' ? k : null;");
    expect(page).toContain('(!only || ch.key === only)');
  });
  it('크레딧 = 고른 수 × 단가표 값 · 0개 = 만들기 막힘 · 인앱 = 글 자리 위 / 아래(기본 위)', () => {
    expect(picker).toContain("const unit = creditCost('image-studio-generate');");
    expect(picker).toContain('const total = picked.length * unit;');
    expect(picker).toContain('disabled={picked.length === 0}');
    expect(picker).toContain("useEffect(() => { if (open) { setPicked([]); setZone('top'); } }, [open]);");
    expect(picker).toContain("{u.key === 'inapp' && on && (");
  });
});

// ─────────────────────────────────────────────────────────────────────────
const SHAPES: Array<[string, string, any, boolean]> = [
  ['통짜 시트', 'full_image', { poster_text: 'baked' }, true],
  ['사진 위 글', 'full_image', {}, true],
  ['통짜 카드', 'full_image', { poster_text: 'baked', poster_frame: 'card' }, false],
  ['사진 위 글 카드', 'full_image', { poster_frame: 'card' }, false],
  ['이벤트 카드', 'full_image', { poster_layout: 'event_card' }, false],
  ['배너 시트', 'full_image', { poster_layout: 'banner_sheet' }, false],
  ['쿠폰 띠', 'full_image', { poster_text: 'baked', poster_strip: { type: 'coupon', code: 'Z9' } }, false],
  ['마감 띠', 'full_image', { poster_strip: { type: 'countdown' } }, false],
  ['가운데 팝업', 'center_modal', null, true],
  ['하단 시트', 'bottom_banner', null, true],
  // (Codex 구현 1R ③) 깔린 앱은 그 밖 모양을 하단 시트로 그린다 = 고른 모양과 다름
  ['위쪽 배너', 'top_banner', null, false],
  ['전체 화면', 'full_screen', null, false],
  ['안쪽 카드', 'inline_card', null, false],
  ['오른쪽 아래 카드', 'slide_in', null, false],
  ['한 줄 알림', 'toast', null, false],
  ['떠 있는 버튼', 'floating_button', null, false],
  ['빈 값', '', null, false],
];

describe('T5 앱 채널 모양 = 넷 · 서버 판정 = 화면 거울', () => {
  for (const [name, tpl, design, ok] of SHAPES) {
    it(`${name} = ${ok ? '허용' : '안 됨'} · 서버 = 화면`, () => {
      expect(appShapeAllowed(tpl, design)).toBe(ok);
      expect(appShapeAllowedFor(tpl, design)).toBe(ok);
    });
  }
  it('앱 모양 목록 = 통짜 시트 · 사진 위 글 · 가운데 팝업 · 하단 시트 · 웹 = 지금 그대로', () => {
    expect([...APP_LAYOUT_KEYS]).toEqual(['baked_sheet', 'overlay', 'center_modal', 'bottom_banner']);
    expect(layoutsFor('app')).toEqual([...APP_LAYOUT_KEYS]);
    expect(layoutsFor('app', 'event_card')).toEqual([...APP_LAYOUT_KEYS]);
    expect(layoutsFor('web')).toEqual(['baked_sheet', 'baked_card', 'overlay', 'live_card', 'event_card', 'center_modal', 'slide_in', 'toast', 'floating_button']);
  });
  it('앱 목록의 모양마다 만든 design = 서버 허용', () => {
    for (const k of APP_LAYOUT_KEYS) {
      const tpl = k === 'center_modal' || k === 'bottom_banner' ? k : 'full_image';
      expect(appShapeAllowed(tpl, designForKey(k, {})), k).toBe(true);
    }
  });
  it('띠 = 앱 0 · 웹 지금 그대로', () => {
    for (const k of ['overlay', 'baked_sheet', 'baked_card', 'live_card'] as LayoutKey[]) {
      expect(stripAllowedFor(k, 'app'), k).toBe(false);
      expect(stripAllowedFor(k, 'web'), k).toBe(true);
      expect(stripAllowedFor(k), k).toBe(true);
    }
  });
  it('앱으로 들어온 새 메시지 = 가장 가까운 허용 모양', () => {
    const table: Array<[LayoutKey, LayoutKey]> = [
      ['baked_card', 'baked_sheet'], ['live_card', 'overlay'], ['event_card', 'overlay'], ['banner_sheet', 'overlay'],
      ['slide_in', 'center_modal'], ['toast', 'center_modal'], ['floating_button', 'center_modal'],
      ['baked_sheet', 'baked_sheet'], ['overlay', 'overlay'], ['center_modal', 'center_modal'], ['bottom_banner', 'bottom_banner'],
    ];
    for (const [from, to] of table) {
      expect(appSafeLayoutKey(from), from).toBe(to);
      expect(APP_LAYOUT_KEYS.includes(appSafeLayoutKey(from)), from).toBe(true);
    }
  });
  it('서버 저장 = 앱 + 안 되는 모양으로 바뀜만 막음 · 그대로 다시 저장 = 허용 · 새 행 = 막음 · 웹 = 무관', () => {
    const card = { template: 'full_image', design: { poster_frame: 'card' } };
    const sheet = { template: 'full_image', design: { poster_text: 'baked' } };
    expect(appShapeTransitionBlocked(null, { ...card, channel: 'app' })).toBe(true);
    expect(appShapeTransitionBlocked(null, { ...sheet, channel: 'app' })).toBe(false);
    expect(appShapeTransitionBlocked(null, { ...card, channel: 'web' })).toBe(false);
    expect(appShapeTransitionBlocked({ ...card, channel: 'app' }, { ...card, channel: 'app' })).toBe(false);
    expect(appShapeTransitionBlocked({ ...card, channel: 'app' }, { template: 'full_image', design: { poster_frame: 'card', accent: '#fff' }, channel: 'app' })).toBe(false);
    expect(appShapeTransitionBlocked({ ...sheet, channel: 'app' }, { ...card, channel: 'app' })).toBe(true);
    expect(appShapeTransitionBlocked({ ...card, channel: 'web' }, { ...card, channel: 'app' })).toBe(true);
    expect(appShapeTransitionBlocked({ template: 'full_image', design: { poster_layout: 'event_card' }, channel: 'app' }, { ...card, channel: 'app' })).toBe(true);
    // 변형 · 새 행이 포스터 아닌 안 되는 모양 = 막음 · 이미 그 모양인 저장 행 그대로 = 허용
    expect(appShapeTransitionBlocked(null, { template: 'toast', design: null, channel: 'app' })).toBe(true);
    expect(appShapeTransitionBlocked({ template: 'center_modal', design: null, channel: 'app' }, { template: 'toast', design: null, channel: 'app' })).toBe(true);
    expect(appShapeTransitionBlocked({ template: 'top_banner', design: null, channel: 'app' }, { template: 'top_banner', design: null, channel: 'app' })).toBe(false);
    expect(appShapeTransitionBlocked(null, { template: 'toast', design: null, channel: 'web' })).toBe(false);
  });
  it('서버 입구 셋(만들기 · 고치기 · 변형) = 같은 판정 · 같은 400 문장', () => {
    const im = be('utils/inapp-message.ts');
    expect(im).toContain("if (appShapeTransitionBlocked(null, { template, design, channel })) throw new UserFacingError(400, 'APP_SHAPE_UNSUPPORTED', APP_SHAPE_ERROR);");
    expect(im).toContain('if (row && appShapeTransitionBlocked(shapeBefore, { template: row.template, design: row.design, channel: row.channel })) {');
    const vo = be('utils/inapp-variant-optimizer.ts');
    expect(vo).toContain("if (appShapeTransitionBlocked(null, { template: input.template || parent.template, design: parent.design, channel: parent.channel === 'app' ? 'app' : 'web' })) {");
    expect(vo.indexOf('appShapeTransitionBlocked(null')).toBeLessThan(vo.indexOf('INSERT INTO cdp_inapp_messages'));
    expect(APP_SHAPE_ERROR).toContain('통짜 포스터 · 사진 위 글 · 가운데 팝업 · 하단 시트');
  });
  it('화면: 장 추가 = 앱이면 사진 위 글 · 저장된 뺀 모양 = 경고 줄 · 새 앱 메시지 = 허용 모양으로 · 장 패널 = 채널', () => {
    const p = fe('pages/InAppMessagesPage.tsx');
    expect(p).toContain("onConfirm: () => switchLayout(isApp ? 'overlay' : 'event_card', { addSlide: true }),");
    expect(p).toContain('if (!isApp || editing.id) return;');
    expect(p).toContain('const safe = appSafeLayoutKey(appShapeKey);');
    expect(p).toContain("channel={isApp ? 'app' : 'web'}");
    const pe = fe('components/inapp/PosterEditor.tsx');
    expect(pe).toContain("const currentUnavailable = channel === 'app' && !APP_LAYOUT_KEYS.includes(current);");
    expect(pe).toContain("'이 모양은 앱에서 그대로 보이지 않아요'");
    expect(pe).toContain('{stripAllowedFor(layoutKey, channel) && (');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('T6 영구 이름 계약 · 맞춤 서빙', () => {
  const putTemp = (id: string, presetKey: string) => {
    writeTempMeta(CO, id, { kind: 'poster', ext: 'jpeg', mime: 'image/jpeg', presetKey });
    fs.writeFileSync(path.join(DIRS.temp, CO, `${id}.jpeg`), Buffer.from('img'));
  };
  afterEach(() => { fs.rmSync(path.join(DIRS.inapp, CO), { recursive: true, force: true }); fs.rmSync(path.join(DIRS.temp, CO), { recursive: true, force: true }); });
  it('이름 CT = 인앱용만 .full.', () => {
    expect(studioPermanentName(T1D, 'png', true)).toBe(`${T1D}.full.png`);
    expect(studioPermanentName(T1D, 'png', false)).toBe(`${T1D}.png`);
  });
  it('저장(옮김) = 인앱 용도 → .full. · 그 밖 → 옛 이름 · 다시 찾기 = 두 이름 다(응답 유실 다시 저장 = 409 아님)', () => {
    putTemp(T1D, 'use-inapp');
    putTemp(T2D, 'use-dm');
    const a = moveTempToPermanent(CO, T1D)!;
    const b = moveTempToPermanent(CO, T2D)!;
    expect(a.filename).toBe(`${T1D}.full.jpeg`);
    expect(b.filename).toBe(`${T2D}.jpeg`);
    expect(findPermanentByTempId(CO, T1D)?.url).toBe(`/api/cdp/inapp/image/${CO}/${T1D}.full.jpeg`);
    expect(findPermanentByTempId(CO, T2D)?.url).toBe(`/api/cdp/inapp/image/${CO}/${T2D}.jpeg`);
  });
  it('등재 실패 되돌림 = 실제로 옮긴 이름으로(임시 그림 다시 생김 · 영구 자리 비움)', () => {
    putTemp(T1D, 'use-inapp');
    const a = moveTempToPermanent(CO, T1D)!;
    restorePermanentToTemp(CO, T1D, a.ext, { kind: 'poster', ext: 'jpeg', mime: 'image/jpeg', presetKey: 'use-inapp' }, a.filename);
    expect(findTempFile(CO, T1D)).not.toBeNull();
    expect(findPermanentByTempId(CO, T1D)).toBeNull();
    expect(be('routes/image-studio.ts')).toContain('restorePermanentToTemp(companyId, effTempId, moved.ext, rest, moved.filename)');
  });
  it('로고 얹어 바로 쓰기 = 인앱 용도면 .full.(이름 CT 같은 갈래)', () => {
    expect(writeStudioPermanent(CO, T1D, 'jpeg', Buffer.from('x'), { full: true }).filename).toBe(`${T1D}.full.jpeg`);
    expect(writeStudioPermanent(CO, T2D, 'jpeg', Buffer.from('x')).filename).toBe(`${T2D}.jpeg`);
    expect(be('utils/studio-logo.ts')).toContain("writeStudioPermanent(companyId, tempId, 'jpeg', buf, { full: isStudioFullPreset(meta.presetKey) })");
  });
  it('인앱용 판정 = 우리 그림 + .full. 이름 · 서버 = 화면', () => {
    const table: Array<[string, boolean]> = [
      [FULL(1), true], [`${FULL(1)}?fit=inapp&fr=2`, true], [`https://hanjul.ai${FULL(1)}`, true], [IMG(1), false],
      [`https://evil.example${FULL(1)}`, false], ['https://mall.example/a.full.jpg', false], [`/api/cdp/inapp/image/${CO}/full.jpg`, false], ['', false],
    ];
    for (const [u, want] of table) {
      expect(isFullBleedInAppImage(u), u).toBe(want);
      expect(isFullBleedInAppImageUrl(u, READY), u).toBe(want);
    }
  });
  it('맞춤 주소 = 인앱용 inappfull(rev 1) · 그 밖 inapp(rev 2) · 화면 판 = 서버 판', () => {
    expect(ASPECT_RATIOS.inappfull).toEqual({ w: 1, h: 1, rev: 1, cover: true });
    expect(LEGACY_FULL_FIT_REV).toBe(ASPECT_RATIOS.inappfull.rev);
    expect(inAppFitQuery(true)).toBe('fit=inappfull&fr=1');
    expect(withInAppImageFit(FULL(1), true)).toBe(`${FULL(1)}?fit=inappfull&fr=1`);
    expect(withInAppImageFit(`${FULL(1)}?fit=inapp&fr=2`, true)).toBe(`${FULL(1)}?fit=inappfull&fr=1`);
    expect(withInAppImageFit(`${FULL(1)}?fit=inappfull&fr=1`)).toBe(`${FULL(1)}?fit=inapp&fr=2`);
    expect(legacyAppImageUrl(FULL(1), {}, READY, true)).toBe(`${FULL(1)}?fit=inappfull&fr=1`);
  });
  describe('실제 서빙', () => {
    let dir: string;
    beforeEach(() => { dir = fs.mkdtempSync(path.join(DIRS.inapp, 'serve-')); });
    const solid = async (w: number, h: number, file: string) => {
      const p = path.join(dir, file);
      await sharp({ create: { width: w, height: h, channels: 3, background: { r: 255, g: 0, b: 0 } } }).jpeg({ quality: 95 }).toFile(p);
      return p;
    };
    const corners = async (p: string) => {
      const { data, info } = await sharp(fs.readFileSync(p)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      return { w: info.width, h: info.height, px: [[0, 0], [info.width - 1, 0], [0, info.height - 1], [info.width - 1, info.height - 1]].map(([x, y]) => { const o = (y * info.width + x) * info.channels; return [data[o], data[o + 1], data[o + 2]]; }) };
    };
    const isRed = (c: number[]) => c[0] > 230 && c[1] < 30 && c[2] < 30;
    it('inappfull = 정사각 · 여백 0(가로로 긴 빨강 600 × 400 → 400 × 400 · 네 귀 빨강)', async () => {
      const out = await getServePath(await solid(600, 400, 'w.jpg'), { aspect: 'inappfull', mode: 'pad' });
      const c = await corners(out);
      expect([c.w, c.h]).toEqual([400, 400]);
      for (const px of c.px) expect(isRed(px)).toBe(true);
    });
    it('inappfull + 이미 정사각 = 원본 그대로', async () => {
      const p = await solid(500, 500, 's.jpg');
      expect(await getServePath(p, { aspect: 'inappfull', mode: 'pad' })).toBe(p);
    });
    it('inapp(지금 규칙) = 정사각 원본이어도 가운데 80% · 귀 = 무대색', async () => {
      const c = await corners(await getServePath(await solid(500, 500, 'q.jpg'), { aspect: 'inapp', mode: 'pad' }));
      for (const px of c.px) expect(isRed(px)).toBe(false);
    });
  });
  it('서빙 사본 = 그리는 그림 전부 인앱용일 때만 inappfull · 하나라도 아니면 inapp · 일반 사진으로 바꾸면 inapp 로', () => {
    const personal = { title: '%이름%' };   // 개인화 = 굽지 않는 대체 길(맞춤 주소만 본다)
    const all = legacyServeTransform(toServedMessage(gateInAppForClient(msg({}, [{ image_url: FULL(1), title: 'a' }, { image_url: FULL(2), title: 'b' }], personal), NONE)), NONE);
    expect(all.posterSlides!.map((s: any) => s.image_url)).toEqual([`${FULL(1)}?fit=inappfull&fr=1`, `${FULL(2)}?fit=inappfull&fr=1`]);
    const mixed = legacyServeTransform(toServedMessage(gateInAppForClient(msg({}, [{ image_url: FULL(1), title: 'a' }, { image_url: IMG(2), title: 'b' }], personal), NONE)), NONE);
    expect(mixed.posterSlides!.map((s: any) => s.image_url)).toEqual([`${FULL(1)}?fit=inapp&fr=2`, `${IMG(2)}?fit=inapp&fr=2`]);
    const swapped = legacyServeTransform(toServedMessage(gateInAppForClient(msg({}, [{ image_url: IMG(9), title: 'a' }], personal), NONE)), NONE);
    expect(swapped.posterSlides![0].image_url).toBe(`${IMG(9)}?fit=inapp&fr=2`);
    // 화면 거울
    const view = legacyAppPreviewOf({}, [{ image_url: FULL(1), title: 'a' }, { image_url: FULL(2), title: 'b' }], null, READY);
    expect(view.full).toBe(true);
    expect(view.slides.map((s: any) => s.image_url)).toEqual(all.posterSlides!.map((s: any) => s.image_url));
    expect(legacyAppPreviewOf({}, [{ image_url: FULL(1) }, { image_url: IMG(2) }], null, READY).full).toBe(false);
    expect(legacyAppPreviewOf({}, [], null, READY, FULL(3)).full).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('T7 굽기 판정 · 인앱용', () => {
  beforeEach(() => { BAKE.requests.length = 0; BAKE.have.clear(); });
  const baked = { poster_text: 'baked' };
  it('통짜 시트 + 전부 인앱용 = 굽지 않음 · 원본 + inappfull · 화면 거울 = 굽지 않음', () => {
    const m = msg(baked, [{ image_url: FULL(1) }, { image_url: FULL(2) }]);
    expect(inAppBakePlan(m, NONE, CO).bake).toBe(false);
    const out = serveInAppForClient(m, NONE, CO);
    expect(BAKE.requests.length).toBe(0);
    expect(out.posterSlides!.map((s: any) => s.image_url)).toEqual([`${FULL(1)}?fit=inappfull&fr=1`, `${FULL(2)}?fit=inappfull&fr=1`]);
    expect(legacyAppWillBake({ design: m.design, slides: m.posterSlides, imageUrl: m.imageUrl, texts: [m.title, m.body] }, READY)).toBe(false);
  });
  it('통짜 시트 + 표지 없는 그림(하나라도) = 지금처럼 굽기 · 정지 full 아님', () => {
    for (const slides of [[{ image_url: IMG(1) }], [{ image_url: FULL(1) }, { image_url: IMG(2) }]]) {
      const p = inAppBakePlan(msg(baked, slides), NONE, CO);
      expect(p.bake).toBe(true);
      if (p.bake) { expect(p.fullBleed).toBe(false); expect((p.payload as any).still.full).toBeUndefined(); }
    }
    expect(legacyAppWillBake({ design: baked, slides: [{ image_url: IMG(1) }] }, READY)).toBe(true);
  });
  it('사진 위 글(글을 얹어야 함) + 전부 인앱용 = 굽기 · 정지 full(여백 0) · 화면 = 구운 모습 full', () => {
    const p = inAppBakePlan(msg({}, [{ image_url: FULL(1), title: '가을' }]), NONE, CO);
    expect(p.bake).toBe(true);
    if (p.bake) { expect(p.fullBleed).toBe(true); expect((p.payload as any).still).toEqual({ deadlineText: '11월 30일 23:59', full: true }); }
    expect(legacyAppBakesFull([{ image_url: FULL(1) }], null, READY)).toBe(true);
    expect(legacyAppBakesFull([{ image_url: FULL(1) }, { image_url: IMG(2) }], null, READY)).toBe(false);
  });
  it('(Codex 구현 1R ①) 카드 · 띠 + 전부 인앱용 = 굽기는 여백 규칙(글 · 띠가 안전 칸 밖) · 화면 거울 같음', () => {
    for (const d of [{ poster_frame: 'card' }, { poster_strip: { type: 'coupon', code: 'Z9' } }, { poster_strip: { type: 'countdown' } }, { poster_text: 'baked', poster_frame: 'card' }, { poster_text: 'baked', poster_strip: { type: 'coupon', code: 'Z9' } }]) {
      const p = inAppBakePlan(msg(d, [{ image_url: FULL(1), title: '가을' }]), NONE, CO);
      expect(p.bake, JSON.stringify(d)).toBe(true);
      if (p.bake) { expect(p.fullBleed, JSON.stringify(d)).toBe(false); expect((p.payload as any).still.full).toBeUndefined(); }
      expect(legacyAppBakesFull([{ image_url: FULL(1) }], null, READY, d), JSON.stringify(d)).toBe(false);
    }
    expect(legacyAppBakesFull([{ image_url: FULL(1) }], null, READY, {})).toBe(true);
    expect(fe('components/inapp/PosterEditor.tsx')).toContain('full={legacyAppBakesFull(slides as any, null, ownHosts, design)}');
    expect(fe('components/InAppMessagePreview.tsx')).toContain('full={legacyAppBakesFull(Array.isArray(slidesIn) ? slidesIn : [], imageUrlIn, ownHosts, designIn)}');
  });
  it('기존 3:4 사진 위 글 = 지금 굽기 그대로(여백 규칙 · 정지 full 아님)', () => {
    const p = inAppBakePlan(msg({}, [{ image_url: IMG(1), title: '가을' }]), NONE, CO);
    expect(p.bake).toBe(true);
    if (p.bake) expect(p.fullBleed).toBe(false);
  });
  it('굽기 판 3 · 일감에 full 전달', () => {
    expect(INAPP_BAKE_VERSION).toBe(3);
    serveInAppForClient(msg({}, [{ image_url: FULL(1), title: '가을' }]), NONE, CO);
    expect(BAKE.requests.length).toBe(1);
    expect(BAKE.requests[0].full).toBe(true);
  });
});

describe('(Codex 구현 1R ① ②) 인앱용 그림 위 층 = 안전 칸 값 하나', () => {
  it('안전 칸 = 0.8 · 맞춤 safe · 프롬프트 · SDK 정지 full 글 여백(≥ 가장자리)이 같은 값', () => {
    expect(INAPP_CONTENT_SAFE).toBe(0.8);
    expect(ASPECT_RATIOS.inapp.safe).toMatchObject({ w: INAPP_CONTENT_SAFE, h: INAPP_CONTENT_SAFE });
    expect(POSTER_FRAME_RULES.fullTextPad).toBeGreaterThanOrEqual((1 - INAPP_CONTENT_SAFE) / 2);
  });
  it('(Codex 구현 2R) 넘치는 글 = 굽지 않음(스크롤 칸이 그림으로 찍히지 않는다 · 대체 = 앱이 글을 얹는다)', () => {
    const b = be('utils/inapp-bake.ts');
    expect(b).toContain("return (oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1;");
    expect(b).toContain('if (overflow) throw Object.assign(new Error(`글 넘침(장 ${s})`), { inAppBakePermanent: true });');
    const sdk = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'sdk-js', 'src', 'poster-frame.ts'), 'utf8');
    expect(sdk).toContain("maxHeight: o.safeInset ? `${100 - padPct}%` : '100%', overflowY: 'auto',");
  });
  it('인앱용 로고 = 가로 · 세로 가장자리 10% 밖 0(네 모서리 · 로고 상자 전체가 가운데 80% 안) · 그 밖 = 폭 4% 그대로', () => {
    const edge = logoSafeEdgeOf('use-inapp');
    expect(edge).toBeCloseTo(0.1, 10);
    expect(logoSafeEdgeOf('poster')).toBe(0);
    expect(logoSafeEdgeOf('use-dm')).toBe(0);
    const box = { width: 180, height: 45 };
    for (const [W, H] of [[1000, 1000], [1200, 900], [900, 1200]]) {
      for (const c of ['tl', 'tr', 'bl', 'br'] as const) {
        const p = logoPlacement(W, H, box, c, edge);
        expect(p.left, `${W}x${H} ${c}`).toBeGreaterThanOrEqual(W * 0.1);
        expect(p.top, `${W}x${H} ${c}`).toBeGreaterThanOrEqual(H * 0.1);
        expect(p.left + box.width, `${W}x${H} ${c}`).toBeLessThanOrEqual(W * 0.9);
        expect(p.top + box.height, `${W}x${H} ${c}`).toBeLessThanOrEqual(H * 0.9);
      }
    }
    expect(logoPlacement(1000, 1000, box, 'tl')).toEqual({ left: Math.round(1000 * LOGO_MARGIN_RATIO), top: Math.round(1000 * LOGO_MARGIN_RATIO) });
    const lg = be('utils/studio-logo.ts');
    expect(lg).toContain('const p = logoPlacement(W, H, outer, c, safeEdge);');
    expect(lg).toContain('layers.textless, logoSafeEdgeOf(meta.presetKey));');
    expect(lg).toContain('textless, logoSafeEdgeOf(meta.presetKey));');
  });
});

describe('T8 굽기 합성 full = 정사각 · 여백 0', () => {
  it('세로로 긴 투명 PNG 300 × 500(빨강 꽉) → 300 × 300 · 네 귀 = 빨강(무대색 0) · full 아님 = 귀 무대색', async () => {
    const png = await sharp({ create: { width: 300, height: 500, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
    const read = async (buf: Buffer) => {
      const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      return { w: info.width, h: info.height, c: [data[0], data[1], data[2]] };
    };
    const full = await read(await composeInAppBakeSlide(png, INAPP_STAGE_FILL, true));
    expect([full.w, full.h]).toEqual([300, 300]);
    expect(full.c[0]).toBeGreaterThan(230);
    const pad = await read(await composeInAppBakeSlide(png, INAPP_STAGE_FILL, false));
    expect(pad.w).toBe(pad.h);
    expect(pad.c[0]).toBeLessThan(40);
  });
  it('굽기 일 = 정지 full · 합성 full 을 그 일감 값으로', () => {
    const b = be('utils/inapp-bake.ts');
    expect(b).toContain('job.full');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('T9 굽기 대상 = 서빙과 같은 사본 · 반영 뒤 준비', () => {
  const P = 'aaaaaaaa-0000-4000-8000-000000000001';
  const V = 'aaaaaaaa-0000-4000-8000-000000000002';
  const row = (over: Record<string, any>) => ({
    id: P, company_id: CO, template: 'full_image', title: '제목', body: '본문', status: 'active', channel: 'app', design: {},
    image_url: FULL(1), poster_slides: [{ image_url: FULL(1), title: '가을' }], buttons: [], parent_message_id: null,
    start_at: '2026-11-01T00:00:00.000Z', end_at: '2026-11-30T14:59:00.000Z', variant_weight: 50, ...over,
  });
  beforeEach(() => { DB.rows = []; DB.sql.length = 0; BAKE.have.clear(); BAKE.requests.length = 0; });
  it('변형 사본 = 부모 시작 · 끝 시각(변형 행엔 기간 없음) · 서빙 Step 4 = 같은 함수', () => {
    const v = servedVariantRow({ id: V, start_at: null, end_at: null, title: 'B' }, { start_at: 's', end_at: 'e' });
    expect(v).toEqual({ id: V, start_at: 's', end_at: 'e', title: 'B' });
    expect(be('utils/inapp-message.ts')).toContain('selected.push(servedVariantRow(variantR.rows[0], cand));');
  });
  it('대상 = 게시 중 앱 부모 + 게시 중 변형 · 변형 id 로 불러도 묶음 전체 · 변형 열쇠 = 부모 끝 시각이 든 사본의 열쇠', async () => {
    DB.rows = [row({}), row({ id: V, parent_message_id: P, start_at: null, end_at: null, title: 'B' }), row({ id: 'aaaaaaaa-0000-4000-8000-000000000003', parent_message_id: P, status: 'paused' })];
    const t = await inAppBakeTargets(CO, V);
    expect(t.map((x) => x.messageId)).toEqual([P, V]);
    const kidPlan = t[1].plan;
    expect(kidPlan.bake).toBe(true);
    if (kidPlan.bake) expect(kidPlan.full.endAt).toEqual(new Date('2026-11-30T14:59:00.000Z'));
  });
  it('웹 · 멈춘 부모 = 대상 0 = none', async () => {
    DB.rows = [row({ channel: 'web' })];
    expect(await inAppAppReady(CO, P)).toBe('none');
    DB.rows = [row({ status: 'paused' })];
    expect(await inAppAppReady(CO, P)).toBe('none');
    DB.rows = [row({ design: { poster_text: 'baked' } })];   // 통짜 시트 + 인앱용 = 굽지 않음 = 대상 0
    expect(await inAppAppReady(CO, P)).toBe('none');
  });
  it('app-ready = 대상 전부 구운 판 있음 · 하나라도 없음 = pending', async () => {
    DB.rows = [row({}), row({ id: V, parent_message_id: P, start_at: null, end_at: null, title: 'B' })];
    expect(await inAppAppReady(CO, P)).toBe('pending');
    const t = await inAppBakeTargets(CO, P);
    const keys = t.map((x) => (x.plan.bake ? x.plan.key : ''));
    BAKE.have.add(keys[0]);
    expect(await inAppAppReady(CO, P)).toBe('pending');
    BAKE.have.add(keys[1]);
    expect(await inAppAppReady(CO, P)).toBe('ready');
  });
  it('미리 굽기 = 대상마다 요청(이미 구운 것 건너뜀) · full 전달', async () => {
    DB.rows = [row({}), row({ id: V, parent_message_id: P, start_at: null, end_at: null, title: 'B' })];
    const t = await inAppBakeTargets(CO, P);
    BAKE.have.add(t[0].plan.bake ? t[0].plan.key : '');
    await prebakeInAppMessage(CO, P);
    expect(BAKE.requests.map((r) => r.messageId)).toEqual([V]);
    expect(BAKE.requests[0].full).toBe(true);
  });
  it('[반영](게시 중 고치기) = 미리 굽기 · app-ready 길 = 로그인 · 회사 소유 확인 · 편집기 = 준비됨 전 「준비 중」', () => {
    const c = be('routes/cdp.ts');
    expect(c).toContain("else if (message.status === 'active') void prebakeInAppMessage(companyId, message.id);");
    const ready = c.slice(c.indexOf("router.get('/inapp/:id/app-ready'"), c.indexOf("router.get('/inapp/:id/app-ready'") + 900);
    expect(ready).toContain('isInAppMessageOwned');
    expect(ready).toContain('inAppAppReady(companyId, req.params.id)');
    const p = fe('pages/InAppMessagesPage.tsx');
    expect(p).toContain("if (snap.channel === 'app') void watchAppReady(snap.id);");
    expect(p).toContain("setSaveInfo({ tone: 'saving', text: '게시 중 · 반영됨 · 앱 화면 준비 중' });");
    expect(p).toContain("if (d?.status === 'ready' || d?.status === 'none') { setSaveInfo({ tone: 'saved', text: '게시 중 · 반영됨 · 앱 화면 준비됨' }); return; }");
    // (Codex 구현 1R ④) 반영한 그대로 · 게시 중 · 같은 메시지일 때만 표시를 바꾼다
    expect(p).toContain("const same = () => gen === appReadyGen.current && editingRef.current.id === id && editingRef.current.status === 'active'");
    expect(p).toContain('&& savedKeyRef.current === key && keyOf(editingRef.current) === key;');
    const w = p.slice(p.indexOf('const watchAppReady'), p.indexOf('const applyLive'));
    expect(w.match(/if \(!same\(\)\) return;/g)?.length).toBe(2);
    expect(w).toContain("if (same()) setSaveInfo({ tone: 'error',");
    expect(w).not.toContain('if (gen !== appReadyGen.current) return;');
  });
});

describe('T11 만드는 중 안내 = 흰 카드 · 진한 글씨', () => {
  it('흐림 0 · 흰 카드 · 글씨 slate-900 / 600 · 옛 회색 글씨 0', () => {
    const page = fe('pages/ImageStudioPage.tsx');
    const at = page.indexOf('C118 A5');
    const block = page.slice(at - 200, at + 1600);
    expect(block).toContain('rounded-2xl bg-white shadow-2xl');
    expect(block).toContain('text-[15px] font-bold text-slate-900');
    expect(block).toContain('text-[13px] text-slate-600 mt-1.5">창을 닫지 마세요');
    expect(block).not.toContain('backdrop-blur');
    expect(page).not.toContain('<p className="text-[11px] text-slate-400 mt-1">창을 닫지 마세요</p>');
  });
});

// ═══════════════ §10 보정 · 1108 실사용 시험 접수 6건(E1 ~ E6 · T12 ~ T17) ═══════════════
describe('T12 (E1) 만드는 중 안내 = 포스터 이름 · 줄 나눔', () => {
  const page = fe('pages/ImageStudioPage.tsx');
  it('용도 표 넷 = 포스터 이름 칸(기계 추출)', () => {
    const src = fe('components/studio/StudioUsePicker.tsx');
    expect([...src.matchAll(/poster: '([^']+)' \}/g)].map((m) => m[1])).toEqual(['인앱 메시지용 포스터', '모바일 DM용 포스터', '이메일 마케팅용 포스터', '자유 형태 포스터']);
  });
  it('안내 = [N장 중 i번째] · {포스터}를 만들고 있어요 · 약 20~30초 걸려요 · 실패 칸 = {포스터}를 만들지 못했어요 · 옛 문구 0', () => {
    expect(page).toContain("`${n > 1 ? `${n}장 중 ${i + 1}번째` : ''}\\n${slot.poster}를 만들고 있어요\\n약 20~30초 걸려요`");
    expect(page).toContain('{slot.poster}를 만들지 못했어요');
    expect(page).not.toContain('만드는 중 (약 20~30초)');
    expect(page).not.toContain('{slot.label} · 만들지 못했어요');
  });
  it('안내 카드 = 줄마다 그림(위 작은 줄 · 굵은 줄 · 작은 줄 · 한 줄 메시지 = 굵은 줄 하나)', () => {
    expect(page).toContain("const ls = String(overlayMsg || '').split('\\n');");
    expect(page).toContain("if (ls.length === 1) return { step: '', title: ls[0], notes: [] as string[] };");
    expect(page).toContain("return { step: ls[0], title: ls[1] || '', notes: ls.slice(2).filter(Boolean) };");
    expect(page).toContain('<p className="text-[15px] font-bold text-slate-900 break-keep">{overlayLines.title}</p>');
  });
});

describe('T13 (E2) 로고 = 기본 꺼짐(세 화면 같은 CT)', () => {
  it('생성 직후 /layers = on false · 켜짐 갈래 = 사용자 동작만(로고 찾아 저장 · 모서리 · 크기)', () => {
    const make = fe('components/studio/StudioMake.tsx');
    expect(make).toContain('const lay = await postLayers(im.tempId, { on: false, corner: null, size: null }, textless);');
    expect(make).not.toContain('postLayers(im.tempId, { on: true');
    // (Codex 구현 1R ②) 못 읽은 카드의 설정 = 꺼짐(AI 수정 · 다시 시도가 로고를 켜지 않는다)
    expect(fe('lib/studio-layers.ts')).toContain("return logo?.state === 'ready' ? { on: logo.on, corner: logo.corner, size: logo.size } : { on: false, corner: null, size: null };");
    for (const f of ['pages/ImageStudioPage.tsx', 'components/dm/build/StudioInsertModal.tsx']) expect(fe(f)).toContain('useStudioMake(');
  });
});

describe('T14 (E3) 할인 템플릿 = 글 자리 위 고정', () => {
  const t = getTemplate('discount-price-cream')!;
  const o = (readDiscountOffer({ before: 28500, sale: 19500, period: '11월10일~11월14일' }, 'price') as any).offer;
  it('서버 = 할인이면 아래를 보내도 위(인앱용)', () => {
    const p = buildPosterPrompt({ template: t, preset: resolvePreset('use-inapp'), hasProduct: true, texts: { title: '핑크앰플' }, textPosition: 'bottom', offer: o });
    expect(p).toContain('The upper part of the square is a natural, color-matched calm continuation');
    expect(p).not.toContain('The lower part of the square is a natural');
    expect(p).toContain('at the upper third of the frame');
    expect(p).not.toContain('lower third');
  });
  it('할인 아닌 템플릿 = 고른 자리 그대로', () => {
    const p = buildPosterPrompt({ template: getTemplate('beauty-clean-bright')!, preset: resolvePreset('use-inapp'), hasProduct: true, texts: { title: '맑게' }, textPosition: 'bottom' });
    expect(p).toContain('The lower part of the square is a natural');
  });
  it('화면 = 할인이면 위 고정 표시 · 본문 = 위(고르기 창 · 편집기 안 스튜디오 창)', () => {
    expect(fe('components/studio/StudioUsePicker.tsx')).toContain("zone: zoneLocked ? 'top' : zone");
    expect(fe('components/studio/StudioUsePicker.tsx')).toContain('위쪽에 글 · 할인 템플릿은 글이 위, 제품이 아래로 정해져 있어요.');
    expect(fe('pages/ImageStudioPage.tsx')).toContain('zoneLocked={!!make.discountKind}');
    expect(fe('components/dm/build/StudioInsertModal.tsx')).toContain('{make.discountKind ? (');
  });
});

describe('T15 (E6) 할인 + 인앱용 = 혜택 줄 · 고정 틀도 안전 칸 안', () => {
  const o = (readDiscountOffer({ items: ['앰버 세럼', '케이블 니트'], prices: [38000, 129000], sale: 139000, period: '11.10 ~ 11.16', gift: '울 머플러' }, 'set') as any).offer;
  it('인앱용(0.8) = 「very top · very bottom」 0 · 바깥 10% 띠 문장 · 고정 틀 = 띠 = 배경만 · 가운데 80%', () => {
    const lines = discountPromptLines(o, null, INAPP_CONTENT_SAFE).join('\n');
    expect(lines).not.toMatch(/very top|very bottom/);
    expect(lines).toContain('just inside the outer 10% band (never in it)');
    const fixed = discountFixedLayoutLine(o, INAPP_CONTENT_SAFE);
    expect(fixed).not.toMatch(/very top|very bottom/);
    expect(fixed).toContain('that outer 10% band on every side is background only');
    expect(fixed).toContain('stay inside the central 80% of the width and of the height');
  });
  it('인앱 아님 = 지금 문장 글자 그대로', () => {
    expect(discountPromptLines(o).join('\n')).toContain('Date pill at the very top of the poster, above the headline');
    expect(discountFixedLayoutLine(o)).toContain('the date pill at the very top');
    expect(discountFixedLayoutLine(o)).toContain('The gift tag alone sits at the very bottom edge');
    expect(discountFixedLayoutLine(o)).not.toContain('band');
  });
  it('프롬프트 조립 = 인앱용만 안전 칸 인자', () => {
    const t = getTemplate('discount-price-cream')!;
    const p1 = (readDiscountOffer({ before: 28500, sale: 19500, period: '11월10일~11월14일' }, 'price') as any).offer;
    const inapp = buildPosterPrompt({ template: t, preset: resolvePreset('use-inapp'), hasProduct: true, texts: { title: '핑크앰플' }, offer: p1 });
    const dm = buildPosterPrompt({ template: t, preset: resolvePreset('use-dm'), hasProduct: true, texts: { title: '핑크앰플' }, offer: p1 });
    expect(inapp).toContain('that outer 10% band on every side is background only');
    expect(inapp).not.toContain('Date pill at the very top');
    expect(dm).not.toContain('outer 10% band');
    expect(dm).toContain('Date pill at the very top');
  });
});

describe('T16 (E4) 장 목록 빼기 · 뺀 뒤 선택', () => {
  const K = ['A', 'B', 'C'];
  it('activeAfterRemove 표(손으로 정한 값)', () => {
    expect(activeAfterRemove(K, 1, 2)).toBe(1);   // B 편집 중 C 빼기 = B
    expect(activeAfterRemove(K, 1, 0)).toBe(0);   // B 편집 중 A 빼기 = B(번호 0)
    expect(activeAfterRemove(K, 1, 1)).toBe(0);   // B 빼기 = A
    expect(activeAfterRemove(K, 0, 0)).toBe(0);   // 첫 장 빼기 = 새 첫 장(B)
    expect(activeAfterRemove(K, 2, 2)).toBe(1);   // 끝 장 빼기 = 앞 장
    expect(activeAfterRemove(['C', 'A', 'B'], 2, 0)).toBe(1);   // 재정렬 뒤(C,A,B) B 편집 중 C 빼기 = B
    expect(activeAfterRemove(['A'], 0, 0)).toBe(0);
  });
  it('목록 줄마다 빼기 = 2장 이상 · 같은 함수(오른쪽 버튼 = 지금 장)', () => {
    expect(fe('components/inapp/PosterEditor.tsx')).toContain('onRemove={onRemove && slides.length > 1 ? (id) => { const i = slides.findIndex((s) => s._k === id); if (i >= 0) onRemove(i); } : undefined}');
    const p = fe('pages/InAppMessagesPage.tsx');
    expect(p).toContain('setActive(activeAfterRemove(slides.map((s) => s._k), safeActive, i));');
    expect(p).toContain('const removeSlide = () => removeSlideAt(safeActive);');
    expect(p).toContain('onRemove={removeSlideAt}');
  });
});

describe('T17 (E5) 앱 기본형 그림 잘림 · 그림 넣기 규칙', () => {
  it('규칙 상수 = 깔린 앱(높이 45% · 팝업 좌우 20 · 최대 420 · 화면 390 × 844 · 문턱 90%)', () => {
    expect(APP_BASIC_IMAGE).toMatchObject({ maxHeightRatio: 0.45, modalSideMargin: 20, modalMaxWidth: 420, view: { width: 390, height: 844 }, warnBelow: 0.9 });
  });
  it('보이는 비율 표(손으로 계산 · 팝업 폭 350 · 시트 폭 390 · 상한 379.8)', () => {
    const near = (a: number | null, b: number) => expect(Math.abs((a as number) - b)).toBeLessThan(0.001);
    near(appBasicImageVisible('center_modal', 1), 1);
    near(appBasicImageVisible('center_modal', 4 / 3), 1);
    near(appBasicImageVisible('center_modal', 3 / 4), 0.8139);
    near(appBasicImageVisible('center_modal', 4 / 5), 0.8681);
    near(appBasicImageVisible('center_modal', 9 / 16), 0.6104);
    near(appBasicImageVisible('center_modal', 16 / 9), 1);
    near(appBasicImageVisible('bottom_banner', 1), 0.9738);
    near(appBasicImageVisible('bottom_banner', 3 / 4), 0.7304);
    near(appBasicImageVisible('bottom_banner', 4 / 5), 0.7791);
    near(appBasicImageVisible('bottom_banner', 9 / 16), 0.5478);
    near(appBasicImageVisible('bottom_banner', 4 / 3), 1);
    expect(appBasicImageVisible('center_modal', 0)).toBeNull();
    expect(appBasicImageVisible('center_modal', NaN)).toBeNull();
  });
  it('그림 넣기 규칙 표(블록 media 있음 · 없음 · 블록 없음 · 명시 aspect 보존)', () => {
    const withMedia = { template: 'center_modal', image_url: 'old', content_blocks: [{ type: 'headline', text: 'x' }, { type: 'media', variant: 'icon', url: 'o', aspect: '16:9' }] };
    expect(withMessageImage(withMedia, 'N')).toEqual({ template: 'center_modal', image_url: 'N', content_blocks: [{ type: 'headline', text: 'x' }, { type: 'media', variant: 'image', url: 'N', aspect: '16:9' }] });
    const noAspect = { template: 'center_modal', content_blocks: [{ type: 'media', variant: 'icon', url: 'o' }] };
    expect(withMessageImage(noAspect, 'N').content_blocks[0]).toEqual({ type: 'media', variant: 'image', url: 'N', aspect: 'natural' });
    const noMedia = { template: 'bottom_banner', content_blocks: [{ type: 'headline', text: 'x' }] };
    expect(withMessageImage(noMedia, 'N').content_blocks).toEqual([{ type: 'media', variant: 'image', url: 'N', aspect: '16:9' }, { type: 'headline', text: 'x' }]);
    expect(withMessageImage({ template: 'center_modal', image_url: null }, 'N')).toEqual({ template: 'center_modal', image_url: 'N' });
  });
  it('세 입구(업로드 · 라이브러리 · 기본형 스튜디오) = 같은 함수 · 옛 image_url 만 바꾸기 0', () => {
    const p = fe('pages/InAppMessagesPage.tsx');
    expect(p).toContain('setEditing((prev) => (prev ? withMessageImage(prev, data.url) : prev));');
    expect(p).toContain('setEditing((prev) => (prev ? withMessageImage(prev, a.url) : prev));');
    expect(p).toContain('if (!posterMode) { setEditing((prev) => (prev ? withMessageImage(prev, url) : prev)); return; }');
    expect(p).not.toContain('setEditing({ ...editing, image_url: a.url });');
  });
  it('크기 = 주소별 세 상태 · 지금 주소 결과만 · 확인 대기 뒤 판정 · 실패 = 안내 줄(창 0)', () => {
    const h = fe('components/inapp/useImageRatio.ts');
    expect(h).toContain("setSt({ url, status: ok ? 'ready' : 'error', ratio: ok ? img.naturalWidth / img.naturalHeight : 0 });");
    expect(h).toContain('if (!alive) return;');
    const p = fe('pages/InAppMessagesPage.tsx');
    expect(p).toContain("const basicKnown = !!basicImg && basicRatio.url === basicImg && (basicRatio.status === 'ready' || basicRatio.status === 'error');");
    expect(p).toContain('if (basicKey && prevBasicKeyRef.current !== basicKey) cropCheckRef.current = { key: basicKey, url: basicImg };');
    expect(p).toContain('if (!basicKnown) return;   // 크기 오기 전 = 기다림');
    expect(p).toContain('if (basicVisible === null || basicVisible >= APP_BASIC_IMAGE.warnBelow) return;');
    expect(p).toContain('const basicWarn = !!basicKey && basicKnown && (basicVisible === null || basicVisible < APP_BASIC_IMAGE.warnBelow);');
    expect(p).toContain("altLabel: '다른 사진 고르기',");
    expect(p).toContain("cancelLabel: '그대로 두기',");
  });
  it('미리보기 · 계약서 = 같은 상수(옛 150px 고정 0)', () => {
    const pv = fe('components/InAppMessagePreview.tsx');
    expect(pv).toContain("maxHeight: Math.round(APP_BASIC_IMAGE.previewScreenHeight * APP_BASIC_IMAGE.maxHeightRatio), objectFit: 'cover'");
    expect(pv).not.toContain("style={{ width: '100%', height: 150, objectFit: 'cover', display: 'block' }}");
    const c = fe('components/inapp/AppIntegrationContract.tsx');
    expect(c).toContain('화면 높이 ${Math.round(APP_BASIC_IMAGE.maxHeightRatio * 100)}%를 넘는 부분만 가운데 맞춤 cover로 자르세요');
  });
});

describe('(Codex 구현 1R ①) 스튜디오 창 = 늘 붙은 하나 · 열린 동안 되돌리기 0', () => {
  it('창 하나(포스터 · 기본형 공용 · 모양 조건부 붙이기 0) · 열린 동안 Ctrl+Z 무시', () => {
    const p = fe('pages/InAppMessagesPage.tsx');
    expect(p.match(/<StudioInsertModal\b/g)?.length).toBe(1);
    expect(p).not.toContain('{posterMode && (() => {');
    expect(p).not.toContain('{!posterMode && isApp && (');
    expect(p).toContain('if (studioOpen) return;   // ★ C118 Codex 구현 1R ① 스튜디오 창이 열린 동안 = 편집기 되돌리기 · 다시 0');
  });
});
