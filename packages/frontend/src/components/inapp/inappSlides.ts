/**
 * inappSlides — 인앱 만들기 개편 편집기의 장(슬라이드) 순수 함수(★ 2026-09-29 · 설계서 §1-2 · §1-4 · §2)
 *
 * 편집기는 포스터 계열(overlay · event_card · banner_sheet)을 "장 목록" 하나로 다룬다(옛: 첫 장 = flat · 둘째 장부터 = extra_slides).
 *   불러오기 = slidesFromMessage(poster_slides 또는 flat → 장 · 기존 배지를 장마다 라벨로 · 장마다 색·크기 명시)
 *   저장     = messagePatchFromSlides(장 → flat 합성값 + poster_slides + 배지 규칙 + design 첫 장 사본)
 * 서버(inapp-message.ts sanitizePosterSlides · composeFlatFromPosterSlides · commonPosterEyebrow · inAppPublishDefect)와 같은 규칙.
 */
import { POSTER_OVERLAY_DEFAULTS, POSTER_SHEET_DEFAULTS, resolvePosterLayout, type PosterLayout, type SheetSlide } from './PosterSheetPreview';

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
  if (slidePh >= 0) return { message: `${slidePh + 1}번째 장의 혜택 안내를 직접 작성해 주세요.`, field: 'placeholder', slide: slidePh };
  if (PH(m.title) || PH(m.body) || PH(m.badge_text) || buttons.some((b) => PH(b?.label))
    || blocks.some((b) => b && ((b.type === 'benefit' && (!String(b.text || '').trim() || PH(b.text))) || (['headline', 'body', 'eyebrow', 'footer'].includes(b.type) && PH(b.text)) || (b.type === 'bullets' && Array.isArray(b.items) && b.items.some((it: any) => PH(it?.text)))))) {
    return { message: '혜택 안내를 회사 정책에 맞게 직접 작성해 주세요.', field: 'placeholder' };
  }
  if (m.template === 'full_image') {
    const idx = slides.findIndex((s) => !s || !String(s.image_url || '').trim());
    if (idx >= 0) return { message: `${idx + 1}번째 장에 사진을 넣어 주세요.`, field: 'slide_image', slide: idx };
    if (!String(m.image_url || '').trim()) return { message: '포스터 사진을 넣어 주세요.', field: 'image', slide: 0 };
  }
  return null;
}

/** 편집기 모양 분류(입구 갤러리 · 모양 바꾸기 공용) */
export type LayoutKey = PosterLayout | 'center_modal' | 'bottom_banner' | 'slide_in' | 'toast' | 'floating_button';
export const LAYOUT_INFO: Record<LayoutKey, { name: string; kind: 'big' | 'basic' | 'small'; desc: string; isNew?: boolean }> = {
  event_card: { name: '이벤트 카드', kind: 'big', desc: '위에 라벨 · 제목 · 본문, 아래 큰 사진 · 쪽 번호', isNew: true },
  banner_sheet: { name: '배너 시트', kind: 'big', desc: '색 면 위 큰 글 3줄 + 오른쪽 상품 사진', isNew: true },
  overlay: { name: '포스터', kind: 'big', desc: '사진이 전부 · 글은 사진 위에 얹기' },
  center_modal: { name: '가운데 팝업', kind: 'basic', desc: '사진 · 제목 · 본문 · 버튼' },
  bottom_banner: { name: '하단 시트', kind: 'basic', desc: '아래에서 올라오는 알림' },
  slide_in: { name: '오른쪽 아래 카드', kind: 'small', desc: '쇼핑을 가리지 않게 구석에' },
  toast: { name: '위쪽 한 줄 알림', kind: 'small', desc: '잠깐 떴다 사라짐' },
  floating_button: { name: '떠 있는 버튼', kind: 'small', desc: '장바구니 · 쿠폰 입구' },
};

/** 채널별 고를 수 있는 모양(웹 = 기존 4형 + 포스터 계열 3 · 앱 = 기본형 2 + 포스터 계열 3) */
export function layoutsFor(channel: 'web' | 'app'): LayoutKey[] {
  return channel === 'app'
    ? ['event_card', 'banner_sheet', 'overlay', 'center_modal', 'bottom_banner']
    : ['event_card', 'banner_sheet', 'overlay', 'center_modal', 'slide_in', 'toast', 'floating_button'];
}

/** 지금 메시지의 모양 키 */
export function layoutKeyOf(m: Record<string, any>): LayoutKey {
  const t = String(m.template || m.position || 'center_modal');
  if (t === 'full_image') return resolvePosterLayout(m.design);
  return (['center_modal', 'bottom_banner', 'slide_in', 'toast', 'floating_button'] as string[]).includes(t) ? (t as LayoutKey) : 'center_modal';
}

export const isPosterLayout = (k: LayoutKey): k is PosterLayout => k === 'overlay' || k === 'event_card' || k === 'banner_sheet';

/**
 * ★ 앱 채널 새 레이아웃 잠금(설계서 §3 · 1차 = 잠금 · 2차 = 앱 계약 구현 + OTA · 실기기 확인 뒤 해제).
 *   2차 코드(첫 고객 앱 렌더 + 계약서)는 들어갔다. 해제는 실기기에서 새 모양·하루 보지 않기를 확인한 뒤 이 값을 true 로.
 *   잠금 중에도 고를 수는 있다 — 「앱 업데이트 필요」 표시 · 안내가 붙는다. 「구버전 앱 모습」은 잠금과 무관하게 버튼으로 본다.
 *   ★ 2026-09-29 해제 — 팝폰 OTA 뒤 실기기에서 이벤트 카드(새 시트 사진 누름 기록 slide_0_image) · 오늘 하루 보지 않기 확인(Harold).
 */
export const APP_SHEET_LAYOUTS_UNLOCKED = true;
