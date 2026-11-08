/**
 * inappSlides — 인앱 만들기 개편 편집기의 장(슬라이드) 순수 함수(★ 2026-09-29 · 설계서 §1-2 · §1-4 · §2)
 *
 * 편집기는 포스터 계열(overlay · event_card · banner_sheet)을 "장 목록" 하나로 다룬다(옛: 첫 장 = flat · 둘째 장부터 = extra_slides).
 *   불러오기 = slidesFromMessage(poster_slides 또는 flat → 장 · 기존 배지를 장마다 라벨로 · 장마다 색·크기 명시)
 *   저장     = messagePatchFromSlides(장 → flat 합성값 + poster_slides + 배지 규칙 + design 첫 장 사본)
 * 서버(inapp-message.ts sanitizePosterSlides · composeFlatFromPosterSlides · commonPosterEyebrow · inAppPublishDefect)와 같은 규칙.
 */
import { POSTER_OVERLAY_DEFAULTS, POSTER_SHEET_DEFAULTS, resolvePosterLayout, type PosterLayout, type SheetSlide } from './PosterSheetPreview';
import { posterFrameRequiredCaps } from './generated/poster-frame';

export const MAX_SLIDES = 5;

/** 편집기 작업본의 장 — _k = 화면 고정 키(순서를 바꿔도 입력 칸이 흔들리지 않게 · 저장하지 않는다) */
export type WsSlide = SheetSlide & { _k: string };

let seq = 0;
export function newSlideKey(): string {
  seq += 1;
  return `s${Date.now().toString(36)}${seq}`;
}

/** 레이아웃 기본 모양(색·크기·맞춤) — 편집기는 장마다 이 값을 명시 기록한다(회의론자 6). */
export function layoutStyle(layout: PosterLayout, design?: Record<string, any> | null): Partial<SheetSlide> {
  if (layout === 'overlay') {
    const d = design || {};
    const overlay = typeof d.poster_text_color === 'string' ? d.poster_text_color : POSTER_OVERLAY_DEFAULTS.titleColor;
    return {
      title_color: typeof d.poster_title_color === 'string' ? d.poster_title_color : overlay,
      body_color: typeof d.poster_body_color === 'string' ? d.poster_body_color : overlay,
      title_size: Number(d.poster_title_size) || POSTER_OVERLAY_DEFAULTS.titleSize,
      body_size: Number(d.poster_body_size) || POSTER_OVERLAY_DEFAULTS.bodySize,
    };
  }
  const D = POSTER_SHEET_DEFAULTS[layout];
  return { bg_color: D.bg, title_color: D.titleColor, body_color: D.bodyColor, title_size: D.titleSize, body_size: D.bodySize, image_fit: D.fit };
}

/** 모양을 바꿀 때 — 글·사진·링크는 두고 색·크기·맞춤만 새 모양 기본으로(흰 글씨가 베이지 칸에 묻히지 않게). */
export function restyleSlides(slides: WsSlide[], layout: PosterLayout, design?: Record<string, any> | null): WsSlide[] {
  const st = layoutStyle(layout, layout === 'overlay' ? null : design);
  return slides.map((s) => {
    const { bg_color: _b, image_fit: _f, title_color: _t, body_color: _c, title_size: _ts, body_size: _bs, ...rest } = s;
    return { ...rest, ...st } as WsSlide;
  });
}

/** 저장된 메시지 → 장 목록. 장이 없으면 flat 이 첫 장. 기존 배지는 라벨이 빈 장마다 복사(설계서 §1-2). */
export function slidesFromMessage(m: Record<string, any>): WsSlide[] {
  const design = m.design && typeof m.design === 'object' ? m.design : {};
  const layout = resolvePosterLayout(design);
  const badge = String(m.badge_text || '').trim();
  const raw: any[] = Array.isArray(m.poster_slides) && m.poster_slides.length > 0 ? m.poster_slides : [];
  let base: SheetSlide[];
  if (raw.length > 0) {
    base = raw.filter((s) => s && typeof s === 'object').map((s) => ({ ...s }));
  } else {
    const b0 = Array.isArray(m.buttons) ? m.buttons[0] : null;
    base = [{
      image_url: m.image_url || '',
      title: m.title || '',
      body: m.body || '',
      ...(b0 && (b0.label || b0.action_url) ? { cta: { label: b0.label || '', action_url: b0.action_url || '', ...(b0.background_color ? { background_color: b0.background_color } : {}), ...(b0.text_color ? { text_color: b0.text_color } : {}) } } : {}),
      ...(m.image_link_url ? { link_url: m.image_link_url } : {}),
    }];
  }
  const st = layoutStyle(layout, design);
  return base.slice(0, MAX_SLIDES).map((s) => {
    const out: WsSlide = { ...st, ...stripEmpty(s), _k: newSlideKey() } as WsSlide;
    if (!String(out.eyebrow || '').trim() && badge) out.eyebrow = badge;
    return out;
  });
}

function stripEmpty(s: SheetSlide): SheetSlide {
  const o: any = {};
  for (const [k, v] of Object.entries(s)) {
    if (v === null || v === undefined) continue;
    o[k] = v;
  }
  return o;
}

/** 새 장 — 지금 장의 모양·버튼 설정을 따라가고 사진·이동 주소는 비운다(장 추가 = 복제 · 설계서 §2). */
export function duplicateSlide(from: WsSlide | undefined, layout: PosterLayout, design?: Record<string, any> | null): WsSlide {
  const base: any = from ? { ...from } : { ...layoutStyle(layout, design) };
  delete base.image_url;
  delete base.link_url;
  return { ...base, image_url: '', _k: newSlideKey() };
}

/** 모든 장 라벨이 같으면 그 값, 아니면 ''(서버 commonPosterEyebrow 와 같은 규칙 · 편집기는 '' 를 명시해 비운다). */
export function commonEyebrow(slides: SheetSlide[]): string {
  if (!slides.length) return '';
  const first = String(slides[0]?.eyebrow || '').trim();
  if (!first) return '';
  return slides.every((s) => String(s?.eyebrow || '').trim() === first) ? first : '';
}

/** 저장용 장(화면 키 제거 · 빈 값 제거 · 버튼은 문구나 주소가 있을 때만) */
export function cleanSlides(slides: WsSlide[]): SheetSlide[] {
  return slides.slice(0, MAX_SLIDES).map((s) => {
    const { _k, ...rest } = s;
    const o: any = {};
    for (const [k, v] of Object.entries(rest)) {
      if (v === null || v === undefined) continue;
      if (typeof v === 'string' && !v.trim() && k !== 'image_url') continue;
      o[k] = typeof v === 'string' ? v : v;
    }
    if (o.cta) {
      const label = String(o.cta.label || '').trim();
      const url = String(o.cta.action_url || '').trim();
      if (!label && !url) delete o.cta;
      else o.cta = { ...o.cta, label, action_url: url || null };
    }
    o.image_url = String(o.image_url || '');
    return o as SheetSlide;
  });
}

/**
 * 장 목록 → 저장할 메시지 칸(설계서 §1-2 · §1-4). flat = 첫 장(옛 앱·옛 SDK 폴백) · design.poster_* = 첫 장 값의 사본.
 * 포스터 계열은 1장이어도 poster_slides 를 보낸다(새 레이아웃은 레이아웃 경로 · overlay 1장은 서버·SDK 가 단일 포스터로 그린다).
 */
export function messagePatchFromSlides(slides: WsSlide[], layout: PosterLayout, design: Record<string, any> | null | undefined): Record<string, any> {
  const clean = cleanSlides(slides);
  const s0: SheetSlide = clean[0] || { image_url: '' };
  const d: Record<string, any> = { ...(design || {}) };
  if (layout === 'overlay') delete d.poster_layout;
  else d.poster_layout = layout;
  const copy = (key: string, v: any) => { if (v === undefined || v === null || v === '') delete d[key]; else d[key] = v; };
  copy('poster_title_color', s0.title_color);
  copy('poster_body_color', s0.body_color);
  copy('poster_title_size', s0.title_size);
  copy('poster_body_size', s0.body_size);
  const cta = s0.cta;
  return {
    template: 'full_image',
    title: String(s0.title || ''),
    body: String(s0.body || ''),
    image_url: s0.image_url || null,
    image_link_url: s0.link_url || null,
    buttons: cta && (cta.label || cta.action_url)
      ? [{ id: 'btn_primary', label: cta.label || '자세히 보기', action_url: cta.action_url || null, style: 'primary', background_color: cta.background_color || '#4f46e5', text_color: cta.text_color || '#ffffff' }]
      : [],
    badge_text: commonEyebrow(clean),
    poster_slides: clean,
    content_blocks: [],
    design: Object.keys(d).length > 0 ? d : null,
  };
}

const PH = (t: any) => { const s = String(t || ''); return s.includes('[혜택') || s.includes('[직접 작성') || s.includes('직접 작성해주세요'); };
/** ★ 2026-10-24 ② 혜택 자리가 아닌 채울 자리 글자(처음 찾은 것) — 있으면 그 글자를 인용한다(서버 inAppPublishDefect 와 같은 순서) */
const fillOf = (v: any): string | null => (JSON.stringify(v ?? '').match(/\[[^[\]\n]{0,60}\]/g) || []).find((x) => PH(x) && !x.startsWith('[혜택')) ?? null;

export interface PublishDefect { message: string; slide?: number; field?: 'title' | 'body' | 'placeholder' | 'image' | 'slide_image' }

/**
 * 발행 전 점검 — 서버 게시 조건 CT(inAppPublishDefect)와 같은 판정을 먼저 화면에서 한다(그 장으로 데려가려고).
 * 서버가 최종 판정이다(결과 행 기준 · 미달 = 되돌리고 400).
 */
export function publishDefectOf(m: Record<string, any>): PublishDefect | null {
  const slides: any[] = Array.isArray(m.poster_slides) ? m.poster_slides : [];
  const buttons: any[] = Array.isArray(m.buttons) ? m.buttons : [];
  const blocks: any[] = Array.isArray(m.content_blocks) ? m.content_blocks : [];
  if (!String(m.title || '').trim()) return { message: '제목을 입력해 주세요.', field: 'title', slide: 0 };
  const posterWithSlides = m.template === 'full_image' && slides.length > 0;
  if (!posterWithSlides && !String(m.body || '').trim()) return { message: '본문을 입력해 주세요.', field: 'body' };
  const slidePh = slides.findIndex((s) => s && (PH(s.title) || PH(s.body) || PH(s.eyebrow) || PH(s.subtitle) || PH(s.cta?.label)));
  if (slidePh >= 0) {
    const f = fillOf(slides[slidePh]);
    return { message: f ? `${slidePh + 1}번째 장에 직접 채울 자리 "${f}"가 남아 있어요. 그 자리를 채워 주세요.` : `${slidePh + 1}번째 장의 혜택 안내를 직접 작성해 주세요.`, field: 'placeholder', slide: slidePh };
  }
  if (PH(m.title) || PH(m.body) || PH(m.badge_text) || buttons.some((b) => PH(b?.label))
    || blocks.some((b) => b && ((b.type === 'benefit' && (!String(b.text || '').trim() || PH(b.text))) || (['headline', 'body', 'eyebrow', 'footer'].includes(b.type) && PH(b.text)) || (b.type === 'bullets' && Array.isArray(b.items) && b.items.some((it: any) => PH(it?.text)))))) {
    const f = fillOf([m.title, m.body, m.badge_text, buttons, blocks]);
    return { message: f ? `직접 채울 자리 "${f}"가 남아 있어요. 그 자리를 채워 주세요.` : '혜택 안내를 회사 정책에 맞게 직접 작성해 주세요.', field: 'placeholder' };
  }
  if (m.template === 'full_image') {
    const idx = slides.findIndex((s) => !s || !String(s.image_url || '').trim());
    if (idx >= 0) return { message: `${idx + 1}번째 장에 사진을 넣어 주세요.`, field: 'slide_image', slide: idx };
    if (!String(m.image_url || '').trim()) return { message: '포스터 사진을 넣어 주세요.', field: 'image', slide: 0 };
  }
  return null;
}

/**
 * 편집기 모양 분류(입구 갤러리 · 모양 바꾸기 공용).
 * ★ 2026-11-05 인앱 포스터 재구성 §3-10 — 포스터 갈래에 새 키 셋: 통짜 · 바닥 시트(baked_sheet) · 통짜 · 떠 있는 카드(baked_card) ·
 *   사진 위 글 · 떠 있는 카드(live_card). 키 ↔ design 은 designForKey 하나 · 반대 = layoutKeyOf 하나(세 키 poster_layout · poster_text · poster_frame 을 함께).
 *   새 키의 그리는 갈래(PosterLayout)는 overlay(지금 포스터 갈래)다 = posterLayoutOfKey.
 */
export type PosterKey = PosterLayout | 'baked_sheet' | 'baked_card' | 'live_card';
export type LayoutKey = PosterKey | 'center_modal' | 'bottom_banner' | 'slide_in' | 'toast' | 'floating_button';
export const LAYOUT_INFO: Record<LayoutKey, { name: string; kind: 'big' | 'basic' | 'small'; desc: string; isNew?: boolean }> = {
  baked_sheet: { name: '통짜 포스터', kind: 'big', desc: '글이 들어간 그림 그대로, 아래에서 올라와요', isNew: true },
  baked_card: { name: '통짜 포스터 카드', kind: 'big', desc: '글이 들어간 그림을 화면 가운데 카드로', isNew: true },
  overlay: { name: '사진 위 글', kind: 'big', desc: '사진 위에 글을 얹어요, 여러 장 넘기기' },
  live_card: { name: '사진 위 글 카드', kind: 'big', desc: '사진 위에 글을 얹고 화면 가운데 카드로', isNew: true },
  event_card: { name: '이벤트 카드', kind: 'big', desc: '위에 라벨 · 제목 · 본문, 아래 큰 사진 · 쪽 번호', isNew: true },
  banner_sheet: { name: '배너 시트', kind: 'big', desc: '색 면 위 큰 글 3줄 + 오른쪽 상품 사진', isNew: true },
  center_modal: { name: '가운데 팝업', kind: 'basic', desc: '사진 · 제목 · 본문 · 버튼' },
  bottom_banner: { name: '하단 시트', kind: 'basic', desc: '아래에서 올라오는 알림' },
  slide_in: { name: '오른쪽 아래 카드', kind: 'small', desc: '쇼핑을 가리지 않게 구석에' },
  toast: { name: '위쪽 한 줄 알림', kind: 'small', desc: '잠깐 떴다 사라짐' },
  floating_button: { name: '떠 있는 버튼', kind: 'small', desc: '장바구니 · 쿠폰 입구' },
};

/**
 * 채널별 고를 수 있는 모양. ★ 2026-11-05 §3-12 배너 시트는 입구 · 모양 바꾸기에서 내린다 — 이미 배너 시트인 메시지(current)에만 보인다
 *   (저장된 배너 시트는 그대로 그린다).
 */
export function layoutsFor(channel: 'web' | 'app', current?: LayoutKey | null): LayoutKey[] {
  const poster: LayoutKey[] = ['baked_sheet', 'baked_card', 'overlay', 'live_card', 'event_card', ...(current === 'banner_sheet' ? ['banner_sheet' as LayoutKey] : [])];
  return channel === 'app'
    ? [...poster, 'center_modal', 'bottom_banner']
    : [...poster, 'center_modal', 'slide_in', 'toast', 'floating_button'];
}

/** 지금 메시지의 모양 키 — design 세 키(poster_layout · poster_text · poster_frame)를 함께 읽는다 */
export function layoutKeyOf(m: Record<string, any>): LayoutKey {
  const t = String(m.template || m.position || 'center_modal');
  if (t === 'full_image') {
    const d = m.design && typeof m.design === 'object' ? m.design : {};
    if (d.poster_text === 'baked') return d.poster_frame === 'card' ? 'baked_card' : 'baked_sheet';
    const L = resolvePosterLayout(d);
    if (L === 'overlay' && d.poster_frame === 'card') return 'live_card';
    return L;
  }
  return (['center_modal', 'bottom_banner', 'slide_in', 'toast', 'floating_button'] as string[]).includes(t) ? (t as LayoutKey) : 'center_modal';
}

export const isPosterLayout = (k: LayoutKey): k is PosterKey =>
  k === 'overlay' || k === 'event_card' || k === 'banner_sheet' || k === 'baked_sheet' || k === 'baked_card' || k === 'live_card';

/** 모양 키 → 그리는 갈래(장 색 · 크기 기본 · 장 편집 칸) — 새 키 셋은 지금 포스터 갈래(overlay) */
export function posterLayoutOfKey(k: LayoutKey): PosterLayout {
  return k === 'event_card' || k === 'banner_sheet' ? k : 'overlay';
}

/** 모양 키 → design(세 키를 함께 쓰고 지운다 · 그 밖 키는 그대로) — 서버 sanitizeInAppDesign 정규화 순서와 같은 조합만 만든다 */
export function designForKey(key: LayoutKey, design?: Record<string, any> | null): Record<string, any> {
  const d: Record<string, any> = { ...(design || {}) };
  delete d.poster_layout;
  delete d.poster_text;
  delete d.poster_frame;
  if (key === 'event_card' || key === 'banner_sheet') {
    d.poster_layout = key;
    delete d.poster_strip;   // 이벤트 카드 · 배너 시트 = 띠 없음(서버가 버린다 · 죽은 칸 0)
  }
  if (key === 'baked_sheet' || key === 'baked_card') d.poster_text = 'baked';
  if (key === 'baked_card' || key === 'live_card') d.poster_frame = 'card';
  return d;
}

/** 이 모양에서 기능 띠를 고를 수 있는가(정규화가 버리는 조합은 칸을 그리지 않는다) */
export function stripAllowedFor(k: LayoutKey): boolean {
  return k === 'overlay' || k === 'baked_sheet' || k === 'baked_card' || k === 'live_card';
}

/**
 * ★ 2026-11-05 §3-2 앱에서 확인된 판 — 팝폰 OTA 뒤 실기기(안드로이드 · iOS)에서 확인한 낱말만 넣는다(처음 = 빈 집합).
 *   옛 전역 APP_SHEET_LAYOUTS_UNLOCKED 를 대신한다. 0929 세 모양(사진 위 글 · 이벤트 카드 · 배너 시트)은 판이 필요 없어 늘 보인다.
 */
export const APP_CONFIRMED_CAPS: ReadonlySet<string> = new Set<string>([]);

/**
 * 앱 채널에서 옛 앱(웹뷰를 붙이지 않은 앱)이 이 메시지를 어떻게 보이나 · null = 그대로 보임.
 * ★ 2026-11-08 C114 I-4 = 내보내지 않음 0 → hidden 은 늘 거짓 · ★ C116 = 서버가 구워 보낸다 → 누르는 동작이 다른 것만 말한다(굽지 않는 개인화 · 남의 그림은 편집기 구버전 앱 모습이 대체 꼴로 보여 준다).
 *   판정 = 서버 관문과 같은 규칙(posterFrameRequiredCaps) · 웹뷰 앱 · 웹 = 그대로.
 */
export function appCapsNote(design: Record<string, any> | null | undefined, slideCount: number): { hidden: boolean; text: string } | null {
  const need = posterFrameRequiredCaps(design, slideCount);
  const missing = new Set([...need.hard, ...need.soft].filter((c) => !APP_CONFIRMED_CAPS.has(c)));
  // ★ 2026-11-08 C116 D11 옛 앱 = 서버가 이 모양 그대로 그림으로 구워 보낸다 → 다른 것(누르는 동작)만 말한다
  if (missing.has('strip_coupon')) return { hidden: false, text: '옛 앱에서는 쿠폰 복사 버튼 없이 코드만 보여요' };
  if (missing.has('strip_countdown')) return { hidden: false, text: '옛 앱에서는 남은 시간 대신 마감 시각이 보여요' };
  return null;
}

// ★ C114 옛 앱 미리보기 꼴 · 게시 끝 시각 글 = legacy-app-view.ts(React 없는 순수 · 백엔드 계약 시험이 서버 함수와 직접 대조)
export { inAppDeadlineText, legacyAppPreviewOf } from './legacy-app-view';
export function appCapsNoteForKey(k: LayoutKey): { hidden: boolean; text: string } | null {
  return isPosterLayout(k) ? appCapsNote(designForKey(k, null), 1) : null;
}
