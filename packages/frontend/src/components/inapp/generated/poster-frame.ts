// 자동 복사본 · 직접 고치지 않는다 · 원본 packages/sdk-js/src/poster-frame.ts · node scripts/sync-poster-frame.mjs
/**
 * 그리는 부품 — 인앱 포스터 새 틀(★ 2026-11-05 인앱 포스터 재구성 설계서 docs/2026-11-05-inapp-poster-function-redesign-design.md §3-4 · §3-7)
 *
 * buildPosterFrame(input) → { backdrop, root, parts }
 *   틀 = 바닥 시트 · 떠 있는 카드 / 판 = 통짜(글이 구워진 그림 · 글 안 그림 · 대체 글) · 글 얹기(스크림) / 기능 띠 = 쿠폰 코드 · 남은 시간.
 *   순수 DOM 조립만 한다. 기록 · 네트워크 · 저장소 · 이동 · 시계 반복 0(계약 시험 CT-IA6 이 이 파일 글자를 본다).
 *   손잡이(장 넘김 · 기록 · 하루 보지 않기 · 복사 · 시계 · 키보드 · 링크)는 부르는 쪽이 data-hjl-part 로 찾아 붙인다.
 *   mount = 'page'(몰 화면 · 배경 화면 전체 고정) · 'frame'(편집기 · 갤러리 휴대폰 틀 안 · 배경 = 틀 크기 · 높이 기준 = 틀 높이).
 *
 * ⛔ 이 파일이 원본이다. 프론트는 scripts/sync-poster-frame.mjs 가 글자 그대로 복사한 사본을 쓴다(CT-IA5 · 사본을 직접 고치지 않는다).
 */

/** 깔끔 규칙 = 계약 상수(앱 계약서 · 계약 시험 CT-IA6 이 값을 읽는다) */
export const POSTER_FRAME_RULES = {
  /** 그림 + 띠 + 버튼 + 닫기 줄 전체 높이 상한(보이는 높이 비율) · 넘으면 폭을 줄여 비율 유지 */
  maxHeightRatio: 0.72,
  sheet: { maxWidth: 520, radius: '20px 20px 0 0', footHeight: 52 },
  card: { maxWidth: 400, sideMargin: 28, radius: '16px', closeRowHeight: 44 },
  /** 여러 장 상자 비율(가로 / 세로) · 남는 자리 바탕 */
  multiAspect: 3 / 4,
  multiFill: '#111827',
  /** 쪽 번호 알약 = 그림 위 HTML 의 유일한 예외 */
  pagerInset: 12,
  ctaHeight: 48,
  stripHeight: 52,
  /** 닫기 누름 자리 */
  closeHit: 44,
  /** 강조색 = 메시지 accent_color 하나(띠 · 버튼) · 없으면 이 값 */
  defaultAccent: '#111827',
  /** 그림 위에 얹는 HTML 부품(이것 밖 0) */
  overImageParts: ['pager'] as readonly string[],
  /** ★ C118 정지 full(스튜디오 인앱용 정사각 굽기) 글 여백 = 그림 폭 비율 · 좌우 · 아래 ≥ 인앱 안전 칸 가장자리(백엔드 INAPP_CONTENT_SAFE · 계약 시험 대조) */
  fullTextPad: 0.12,
} as const;

export const POSTER_FRAME_FONT = '"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
export const frameHexOr = (v: any, fb: string): string => (typeof v === 'string' && HEX_RE.test(v.trim()) ? v.trim() : fb);
const sizeOr = (v: any, min: number, max: number, fb: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : fb;
};

export interface PosterFrameSlide {
  image_url: string;
  title?: string | null;
  body?: string | null;
  eyebrow?: string | null;
  alt?: string | null;
  cta?: { label?: string | null; action_url?: string | null; background_color?: string | null; text_color?: string | null } | null;
  link_url?: string | null;
  title_color?: string | null;
  body_color?: string | null;
  title_size?: number | null;
  body_size?: number | null;
  bg_color?: string | null;
}

export interface PosterFrameStrip {
  type: 'coupon' | 'countdown';
  code?: string | null;
  label?: string | null;
}

export interface PosterFrameInput {
  /** 장(그림 있는 장만 · 장 없는 메시지는 부르는 쪽이 flat 에서 첫 장을 만든다) */
  slides: PosterFrameSlide[];
  /** 메시지 design(서빙 사본) */
  design?: Record<string, any> | null;
  /** 강조색(메시지 accent_color) */
  accentColor?: string | null;
  /** 메시지 배지(글 얹기 · 장 라벨이 없을 때) */
  badge?: string | null;
  /** 남은 시간 띠의 마감(ISO 또는 ms) */
  endAt?: string | number | null;
  /** 지금 시각(ms · 서버 시각 기준으로 보정된 값) */
  now: number;
  /** 보여 줄 장 */
  active?: number;
  mount: 'page' | 'frame';
  /** 높이 기준(px) · page = 보이는 창 높이 · frame = 틀 높이 */
  viewportHeight: number;
  /** 글 바꾸기(변수 치환) · 없으면 그대로 */
  text?: (t: string) => string;
  /** 그림 주소 바꾸기(상대 → 절대) · 없으면 그대로 */
  imageSrc?: (u: string) => string;
  /** 글 얹기 제목 서체(이미 안전한 font-family 값) */
  displayFont?: string;
  /**
   * ★ 2026-11-08 C116 D8 정지 그리기(서버 굽기 · 편집기 「구버전 앱 모습」) — 살아 있는 부품을 만들지 않는다:
   *   닫기 줄 · 쪽 번호 · 장 버튼 칸 · 바닥 줄 · 쿠폰 「복사」 0 · 남은 시간 = 마감 시각 글(이름 없는 정적 글) · 높이 예산 = 띠만.
   *   부품 칸이 null 이라 소비자(SDK · 편집기)의 시계 · 버튼 · 복사 · 닫기 연결이 저절로 0(넘김 레일은 남김 · 앱도 넘겨 본다).
   */
  still?: { deadlineText?: string | null; full?: boolean } | null;
}

export interface PosterFrameParts {
  rail: HTMLElement;
  cells: HTMLElement[];
  images: HTMLImageElement[];
  pager: HTMLElement | null;
  prev: HTMLElement | null;
  next: HTMLElement | null;
  /** 정지 그리기면 null */
  ctaHost: HTMLElement | null;
  strip: HTMLElement | null;
  stripCopy: HTMLElement | null;
  stripCode: HTMLElement | null;
  stripTimer: HTMLElement | null;
  /** 정지 그리기면 null */
  dismissDay: HTMLElement | null;
  close: HTMLElement | null;
}

export interface PosterFrameResult {
  backdrop: HTMLElement;
  root: HTMLElement;
  parts: PosterFrameParts;
  /** 이 렌더에 쓴 값(부르는 쪽이 장을 바꿀 때 같은 값으로 다시 그린다) */
  frame: 'sheet' | 'card';
  baked: boolean;
  accent: string;
  /** 한 장 = 보이는 높이가 바뀌면(회전 · 창 크기) 부르는 쪽이 새 높이로 다시 맞춘다 */
  fit: (viewportHeight: number) => void;
}

/**
 * ★ 2026-11-08 C114 I-3 그리는 자리 한 곳 — 포스터(full_image)를 이 틀로 그리는가.
 *   = 이벤트 카드 · 배너 시트가 아니면 전부(사진 위 글 1장 · 여러 장 포함 · 한 장 = 원본 비율 · 여러 장 = 3:4 상자 맞추기 · 잘림 0).
 *   SDK 렌더러 · 편집 미리보기 · 갤러리 썸네일이 이 판정 하나를 쓴다(옛 4:5 cover 캐러셀 = 위아래가 잘렸다 · Harold 1107 「NATURE 잘림」).
 */
export function drawsWithPosterFrame(design: any): boolean {
  const d = design && typeof design === 'object' ? design : {};
  const v = String(d.poster_layout ?? d.posterLayout ?? '');
  return v !== 'event_card' && v !== 'banner_sheet';
}

/** 메시지 바깥 칸(flat) — 장이 없거나 한 장뿐인 옛 포스터가 쓰던 값 */
export interface PosterFlatFallback {
  image_url: string | null;
  title: string;
  body: string;
  cta: PosterFrameSlide['cta'] | null;
  link_url: string | null;
  /** 배지 문구(badge_text) — 장이 없을 때 첫 장 eyebrow(옛 시트 경로와 같음 · Codex 구현 3R) */
  eyebrow: string | null;
}

/**
 * ★ 2026-11-08 C114 Codex 구현 1R — 새 틀에 넣을 장 = 저장된 장 + 메시지 바깥 칸 폴백(SDK · 편집 미리보기 · 예시 갤러리가 이 함수 하나).
 *   장 없음 = 바깥 칸으로 첫 장 · 새 판이 없는 사진 위 글 한 장 = 옛 한 장 포스터처럼 바깥 칸 제목 · 본문 · 버튼 · 그림 링크가
 *   빈 장 값을 채운다(장 값이 있으면 장 값) · 여러 장 · 새 판(통짜 · 카드 · 띠) = 장 그대로(옛 캐러셀 · C106 틀과 같은 규칙).
 */
export function frameSlidesWithFlat(slides: PosterFrameSlide[], flat: PosterFlatFallback, design: any): PosterFrameSlide[] {
  const has = (v: any) => typeof v === 'string' && v.trim().length > 0;
  const list = (Array.isArray(slides) ? slides : []).filter((s) => s && has(s.image_url));
  if (list.length === 0) {
    return has(flat.image_url) ? [{ image_url: String(flat.image_url), title: flat.title, body: flat.body, eyebrow: flat.eyebrow, cta: flat.cta, link_url: flat.link_url }] : [];
  }
  // (Codex 구현 2R) 이벤트 카드 · 배너 시트 = 시트 렌더러가 장 그대로 그린다 → 바깥 칸을 섞지 않는다(미리보기 = 실제)
  if (list.length === 1 && drawsWithPosterFrame(design) && !usesPosterFrame(design)) {
    const s = list[0];
    const ctaOk = !!s.cta && (has(s.cta.label) || has(s.cta.action_url));
    return [{
      ...s,
      title: has(s.title) ? s.title : flat.title,
      body: has(s.body) ? s.body : flat.body,
      cta: ctaOk ? s.cta : flat.cta,
      link_url: has(s.link_url) ? s.link_url : flat.link_url,
    }];
  }
  return list;
}

/** 이 메시지가 새 판(통짜 · 떠 있는 카드 · 띠 중 하나라도)을 쓰는가 — 편집 칸 · 필요 판 판정용(그리는 자리 판정 = drawsWithPosterFrame) */
export function usesPosterFrame(design: any): boolean {
  if (!design || typeof design !== 'object') return false;
  const strip = design.poster_strip && typeof design.poster_strip === 'object' ? String(design.poster_strip.type || '') : '';
  return design.poster_text === 'baked' || design.poster_frame === 'card' || strip === 'coupon' || strip === 'countdown';
}

/**
 * 이 메시지를 그리려면 클라이언트에 필요한 판(편집기 「앱 새 판이 깔린 뒤 보여요」 표시용). 서버 서빙 관문 inAppRequiredCaps 와
 *   같은 규칙이다(계약 시험 CT-IA4 가 표본 표로 두 함수를 묶는다 · 서빙 판정은 서버가 한다).
 */
export function posterFrameRequiredCaps(design: any, slideCount: number): { hard: string[]; soft: string[] } {
  const hard: string[] = [];
  const soft: string[] = [];
  const d = design && typeof design === 'object' ? design : {};
  if (d.poster_text === 'baked') hard.push('poster_baked');
  const strip = d.poster_strip && typeof d.poster_strip === 'object' ? String(d.poster_strip.type || '') : '';
  if (strip === 'coupon') hard.push('strip_coupon');
  if (strip === 'countdown') hard.push('strip_countdown');
  if (d.poster_frame === 'card') (slideCount >= 2 ? hard : soft).push('frame_card');
  return { hard, soft };
}

export function resolvePosterFrameStrip(design: any): PosterFrameStrip | null {
  const s = design && typeof design === 'object' ? design.poster_strip : null;
  if (!s || typeof s !== 'object') return null;
  if (s.type === 'coupon') return { type: 'coupon', code: String(s.code || ''), label: s.label ? String(s.label) : null };
  if (s.type === 'countdown') return { type: 'countdown', label: s.label ? String(s.label) : null };
  return null;
}

/** 남은 시간 글(순수) — 0 이하 = 「마감됐어요」 · 하루 이상 = 「N일 HH:MM:SS」 */
export function formatCountdown(msLeft: number): string {
  if (!Number.isFinite(msLeft) || msLeft <= 0) return '마감됐어요';
  const total = Math.floor(msLeft / 1000);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const p2 = (n: number) => String(n).padStart(2, '0');
  const hms = `${p2(h)}:${p2(m)}:${p2(s)}`;
  return d > 0 ? `${d}일 ${hms}` : hms;
}

export function countdownEndMs(endAt: string | number | null | undefined): number | null {
  if (endAt === null || endAt === undefined || endAt === '') return null;
  const ms = typeof endAt === 'number' ? endAt : new Date(endAt).getTime();
  return Number.isFinite(ms) ? ms : null;
}

const el = (tag: string, part: string | null, style: Record<string, string>, text?: string): HTMLElement => {
  const e = document.createElement(tag);
  if (part) e.setAttribute('data-hjl-part', part);
  Object.assign(e.style, style);
  if (text !== undefined) e.textContent = text;
  return e;
};

/**
 * 글 얹기 스크림(그림 아래 그라데이션 위 라벨 · 제목 · 본문) — 지금 포스터 · 캐러셀 · 새 틀이 같은 함수를 부른다(규격 한 곳).
 *   제목 · 본문 · 라벨 모두 없으면 null.
 */
export function buildPosterScrimEl(o: {
  title: string; body: string; badge: string;
  overlayColor: string; titleColor: string; bodyColor: string;
  titleSize: number; bodySize: number; displayFont: string;
  /** ★ C118 정지 full = 글 · 배지를 안전 칸 안으로(좌우 · 아래 여백 = 폭 비율 · 정사각 칸이라 세로도 같은 길이) */
  safeInset?: boolean;
}): HTMLDivElement | null {
  if (!o.title && !o.body && !o.badge) return null;
  const scrim = document.createElement('div');
  const padPct = Math.round(POSTER_FRAME_RULES.fullTextPad * 100);
  Object.assign(scrim.style, {
    position: 'absolute', left: '0', right: '0', bottom: '0',
    padding: o.safeInset ? `52px ${padPct}% ${padPct}%` : '52px 22px 18px',
    background: 'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.66) 100%)',
    color: o.overlayColor, boxSizing: 'border-box',
    // 본문이 그림 높이를 넘는 극단 경우 — 잘라내지 않고 그림 안에서 스크롤
    //   ★ C118 정지 full = 글 상자 전체가 가로 · 세로 fullTextPad ~ (1 − fullTextPad) 사각형 안(높이 상한 = 위 경계) · 넘침 = 굽기 쪽이 굽지 않음(inapp-bake 글 넘침 판정 · Codex 구현 2R)
    maxHeight: o.safeInset ? `${100 - padPct}%` : '100%', overflowY: 'auto',
  });
  if (o.badge) {
    const badge = document.createElement('div');
    badge.textContent = o.badge;
    Object.assign(badge.style, {
      display: 'inline-block',
      background: 'rgba(255,255,255,0.2)',
      color: o.titleColor,
      fontSize: '11px',
      fontWeight: '700',
      letterSpacing: '0.03em',
      padding: '4px 11px',
      borderRadius: '999px',
      marginBottom: '12px',
    });
    scrim.appendChild(badge);
  }
  if (o.title) {
    const t = document.createElement('div');
    Object.assign(t.style, { fontWeight: '800', fontSize: `${o.titleSize}px`, letterSpacing: '-0.01em', lineHeight: '1.3', marginBottom: o.body ? '5px' : '0', color: o.titleColor });
    if (o.displayFont) t.style.fontFamily = `${o.displayFont}, ${POSTER_FRAME_FONT}`;
    t.textContent = o.title;
    scrim.appendChild(t);
  }
  if (o.body) {
    const b = document.createElement('div');
    Object.assign(b.style, { fontSize: `${o.bodySize}px`, opacity: '0.94', lineHeight: '1.55', whiteSpace: 'pre-wrap', color: o.bodyColor });
    b.textContent = o.body;
    scrim.appendChild(b);
  }
  return scrim;
}

/** 장 버튼(그림 아래 흰 칸 · 가로 꽉 찬 48px · 강조색) — 장이 바뀌면 부르는 쪽이 같은 함수로 다시 채운다 */
export function fillPosterFrameCta(host: HTMLElement, slide: PosterFrameSlide | undefined, accent: string, text?: (t: string) => string): HTMLButtonElement | null {
  host.textContent = '';
  const c = slide && slide.cta;
  if (!c || !(c.label || c.action_url)) {
    host.style.display = 'none';
    return null;
  }
  host.style.display = 'block';
  const label = String(c.label || '자세히 보기');
  const b = el('button', 'cta', {
    display: 'block', width: '100%', height: `${POSTER_FRAME_RULES.ctaHeight}px`, border: 'none', borderRadius: '12px', cursor: 'pointer',
    background: frameHexOr(c.background_color, accent), color: frameHexOr(c.text_color, '#ffffff'),
    fontSize: '15px', fontWeight: '800', fontFamily: 'inherit', letterSpacing: '-0.01em',
  }, text ? text(label) : label) as HTMLButtonElement;
  host.appendChild(b);
  return b;
}

/** 쪽 번호 글 */
export function setPosterFramePager(pager: HTMLElement | null, idx: number, count: number): void {
  if (!pager) return;
  const n = pager.querySelector('[data-hjl-part="pager-text"]');
  if (n) n.textContent = `${idx + 1} / ${count}`;
}

/** 한 장 그림을 원본 비율로 높이 상한 안에 넣는 폭(px) — 그림이 크면 폭을 줄인다(자름 0). 순수. */
export function fitPosterFrameWidth(natW: number, natH: number, viewportHeight: number, chrome: number, maxWidth: number): number | null {
  if (!(natW > 0 && natH > 0 && viewportHeight > 0)) return null;
  const capPx = Math.round(viewportHeight * POSTER_FRAME_RULES.maxHeightRatio) - chrome;
  if (capPx <= 0) return null;
  return Math.min(maxWidth, Math.round(capPx * (natW / natH)));
}

export function buildPosterFrame(input: PosterFrameInput): PosterFrameResult {
  const R = POSTER_FRAME_RULES;
  const design = input.design && typeof input.design === 'object' ? input.design : {};
  const frame: 'sheet' | 'card' = design.poster_frame === 'card' ? 'card' : 'sheet';
  const baked = design.poster_text === 'baked';
  const strip = resolvePosterFrameStrip(design);
  const accent = frameHexOr(input.accentColor, R.defaultAccent);
  const tx = (t: any) => (input.text ? input.text(String(t || '')) : String(t || ''));
  const src = (u: string) => (input.imageSrc ? input.imageSrc(u) : u);
  const slides = input.slides.filter((s) => s && typeof s.image_url === 'string' && s.image_url.trim().length > 0);
  const count = slides.length;
  const active = Math.max(0, Math.min(count - 1, Math.floor(Number(input.active) || 0)));
  const snooze = String(design.dismiss_mode || '') === 'snooze_day';
  const vh = Math.max(1, Math.floor(input.viewportHeight || 0));
  const isCard = frame === 'card';
  const maxW = isCard ? R.card.maxWidth : R.sheet.maxWidth;
  // 그림 밖 높이(띠 · 버튼 칸 · 닫기 줄) — 높이 상한 계산에 쓴다
  const still = !!input.still;
  const hasCtaAny = slides.some((s) => s.cta && (s.cta.label || s.cta.action_url));
  // ★ C116 정지 = 버튼 칸 · 닫기 줄 · 바닥 줄을 만들지 않으므로 예산에서도 뺀다(버튼 유무가 그림 크기를 바꾸지 않게 · Codex 설계 1R ⑥)
  const chrome = (strip ? R.stripHeight : 0) + (still ? 0 : (hasCtaAny ? R.ctaHeight + 24 : 0) + (isCard ? R.card.closeRowHeight + 8 : R.sheet.footHeight));

  const backdrop = el('div', 'frame-backdrop', {
    position: input.mount === 'page' ? 'fixed' : 'absolute', inset: '0',
    // ★ C116 정지 = 바깥 어둠 0(구운 그림 모서리 · 편집기 앱 시트 안 그림)
    background: still ? 'transparent' : 'rgba(8,10,18,0.55)', zIndex: input.mount === 'page' ? '2147483646' : '1',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: isCard ? 'center' : 'flex-end',
    padding: isCard ? `0 ${R.card.sideMargin}px` : '0', boxSizing: 'border-box',
  });
  if (input.mount === 'page' && !still) {
    backdrop.style.backdropFilter = 'blur(14px) saturate(1.35)';
    (backdrop.style as any).webkitBackdropFilter = 'blur(14px) saturate(1.35)';
  }

  // 여러 장 = 3:4 상자 → 폭 상한을 높이에서 바로 정한다 · 한 장 = 그림이 들어온 뒤 원본 비율로(fitPosterFrameWidth)
  const multiMaxW = Math.max(1, Math.floor((Math.round(vh * R.maxHeightRatio) - chrome) * R.multiAspect));   // ★ C118 B5 높이 상한 먼저
  const root = el('div', 'frame-root', {
    width: '100%', maxWidth: `${count > 1 ? Math.min(maxW, multiMaxW) : maxW}px`,
    position: 'relative', zIndex: input.mount === 'page' ? '2147483647' : '2',
    fontFamily: POSTER_FRAME_FONT, boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
  });
  root.setAttribute('data-hjl-frame', frame);
  root.setAttribute('data-hjl-text', baked ? 'baked' : 'live');

  // 떠 있는 카드 = 카드 위 어둠 위 한 줄(왼쪽 하루 보지 않기 흰 글 · 오른쪽 X 44px)
  let dismissDay: HTMLElement | null = null;
  let close: HTMLElement | null = null;
  if (still) {
    // ★ C116 정지 = 닫기 줄 · 바닥 줄 없음(앱이 자기 것을 그린다)
  } else if (isCard) {
    const row = el('div', 'card-close-row', {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: `${R.card.closeRowHeight}px`, marginBottom: '8px', color: '#ffffff',
    });
    dismissDay = el('button', snooze ? 'foot-snooze' : 'foot-optout', {
      background: 'none', border: 'none', color: '#ffffff', fontSize: '14px', fontWeight: '600', cursor: 'pointer',
      height: `${R.closeHit}px`, padding: '0 4px', fontFamily: 'inherit', whiteSpace: 'nowrap',
    }, snooze ? '오늘 하루 보지 않기' : '다시 보지 않기');
    close = el('button', 'foot-close', {
      width: `${R.closeHit}px`, height: `${R.closeHit}px`, border: 'none', background: 'none', color: '#ffffff', cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0',
    });
    close.setAttribute('aria-label', '닫기');
    close.appendChild(closeIcon(20));
    row.appendChild(dismissDay);
    row.appendChild(close);
    root.appendChild(row);
  } else {
    dismissDay = el('button', snooze ? 'foot-snooze' : 'foot-optout', {}, snooze ? '오늘 하루 보지 않기' : '다시 보지 않기');
    close = el('button', 'foot-close', {}, '닫기');
  }

  const box = el('div', isCard ? 'card' : 'sheet', {
    width: '100%', background: '#ffffff', color: '#1b1d23', overflow: 'hidden', boxSizing: 'border-box',
    // ★ C118 B2 정지 + 인앱용(full) = 모서리 0(앱이 자기 시트를 그린다 · 구운 그림 = 정사각 그대로)
    borderRadius: still && input.still && input.still.full ? '0' : isCard ? R.card.radius : R.sheet.radius,
    // ★ C116-B D3 정지 = 그림자 0(찍는 틀 상자 밖으로 뻗어 잘리는 값 · 무대색 위에서는 보이지 않는다)
    boxShadow: still ? 'none' : isCard ? '0 18px 50px rgba(0,0,0,0.35)' : '0 -6px 24px rgba(0,0,0,0.22), 0 -24px 70px rgba(0,0,0,0.35)',
    display: 'flex', flexDirection: 'column',
  });

  // 그림 — 넘기는 줄(장마다 한 칸) · 쪽 번호 알약만 그림 위
  const media = el('div', 'media', { position: 'relative', width: '100%', flex: '0 0 auto' });
  const rail = el('div', 'rail', {
    display: 'flex', overflowX: count > 1 ? 'auto' : 'hidden', overflowY: 'hidden',
    scrollSnapType: 'x mandatory', width: '100%',
  });
  rail.setAttribute('data-hjl-carousel', '1');
  (rail.style as any).webkitOverflowScrolling = 'touch';
  const cells: HTMLElement[] = [];
  const images: HTMLImageElement[] = [];
  const overlayColor = frameHexOr(design.poster_text_color, '#ffffff');
  slides.forEach((s, i) => {
    const cell = el('div', 'slide', {
      position: 'relative', flex: '0 0 100%', width: '100%', scrollSnapAlign: 'start', scrollSnapStop: 'always', boxSizing: 'border-box',
      ...(count > 1 ? { aspectRatio: '3 / 4', background: frameHexOr(s.bg_color, R.multiFill), display: 'flex', alignItems: 'center', justifyContent: 'center' } : {}),
    });
    cell.setAttribute('data-hjl-slide', String(i));
    const img = document.createElement('img');
    img.setAttribute('data-hjl-part', 'image');
    img.src = src(s.image_url);
    img.alt = baked ? String(s.alt || s.title || '').trim() : '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    Object.assign(img.style, count > 1
      ? { width: '100%', height: '100%', objectFit: 'contain', display: 'block' }
      : { width: '100%', height: 'auto', display: 'block' });
    cell.appendChild(img);
    if (!baked) {
      const scrim = buildPosterScrimEl({
        title: tx(s.title), body: tx(s.body), badge: tx(s.eyebrow) || tx(input.badge),
        overlayColor,
        titleColor: frameHexOr(s.title_color, frameHexOr(design.poster_title_color, overlayColor)),
        bodyColor: frameHexOr(s.body_color, frameHexOr(design.poster_body_color, overlayColor)),
        titleSize: sizeOr(s.title_size, 14, 32, sizeOr(design.poster_title_size, 14, 32, 20)),
        bodySize: sizeOr(s.body_size, 10, 22, sizeOr(design.poster_body_size, 10, 22, 14)),
        displayFont: input.displayFont || '',
        safeInset: !!(input.still && input.still.full),
      });
      if (scrim) cell.appendChild(scrim);
    }
    rail.appendChild(cell);
    cells.push(cell);
    images.push(img);
  });
  media.appendChild(rail);

  let pager: HTMLElement | null = null;
  let prev: HTMLElement | null = null;
  let next: HTMLElement | null = null;
  if (count > 1 && !still) {
    // ★ C118 B5 사진 위 글이 있으면 쪽 번호 = 그림 오른쪽 위(아래쪽 글과 겹치지 않게) · 없으면 지금처럼 아래
    const liveText = !baked && slides.some((s) => !!(String(s.title || '').trim() || String(s.body || '').trim() || String(s.eyebrow || '').trim()));
    pager = el('div', 'pager', {
      position: 'absolute', right: `${R.pagerInset}px`, ...(liveText ? { top: `${R.pagerInset}px` } : { bottom: `${R.pagerInset}px` }), height: '28px', borderRadius: '999px',
      background: 'rgba(17,24,39,0.62)', color: '#ffffff', fontSize: '12px', fontWeight: '700',
      display: 'flex', alignItems: 'center', zIndex: '3', overflow: 'hidden',
    });
    const arrow = (part: 'prev' | 'next', ch: string, label: string) => {
      const a = el('button', part, {
        width: '28px', height: '28px', border: 'none', background: 'none', color: '#ffffff', cursor: 'pointer',
        fontSize: '16px', lineHeight: '1', padding: '0', fontFamily: 'inherit',
      }, ch);
      a.setAttribute('aria-label', label);
      return a;
    };
    prev = arrow('prev', '‹', '이전 장');
    next = arrow('next', '›', '다음 장');
    pager.appendChild(prev);
    pager.appendChild(el('span', 'pager-text', { padding: '0 2px', whiteSpace: 'nowrap' }, `${active + 1} / ${count}`));
    pager.appendChild(next);
    media.appendChild(pager);
  }
  box.appendChild(media);

  // 기능 띠(그림과 버튼 사이 52px)
  let stripEl: HTMLElement | null = null;
  let stripCopy: HTMLElement | null = null;
  let stripCode: HTMLElement | null = null;
  let stripTimer: HTMLElement | null = null;
  if (strip) {
    stripEl = el('div', 'strip', {
      display: 'flex', alignItems: 'center', gap: '10px', height: `${R.stripHeight}px`, padding: '0 16px', boxSizing: 'border-box',
      background: '#f4f4f5', borderBottom: '1px solid #e4e4e7', flex: '0 0 auto',
    });
    stripEl.setAttribute('data-hjl-strip', strip.type);
    const label = el('span', 'strip-label', {
      fontSize: '13px', fontWeight: '700', color: '#3f3f46', flex: '1 1 auto', minWidth: '0',
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    }, strip.label || (strip.type === 'coupon' ? '쿠폰 코드' : '마감까지'));
    stripEl.appendChild(label);
    if (strip.type === 'coupon') {
      // (Codex 구현 1R) 긴 코드(40자)가 [복사]를 밀어내지 않게 — 코드 칸은 줄어들며 말줄임 · [복사]는 줄지 않는다 · 복사 원문 = 글자 전체(textContent)
      stripCode = el('span', 'strip-code', {
        fontSize: '15px', fontWeight: '800', color: accent, letterSpacing: '0.04em', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        whiteSpace: 'nowrap', userSelect: 'all', flex: '0 1 auto', minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis',
      }, String(strip.code || ''));
      stripCode.setAttribute('title', String(strip.code || ''));
      stripEl.appendChild(stripCode);
      if (!still) {
        stripCopy = el('button', 'strip-copy', {
          height: '34px', padding: '0 14px', borderRadius: '999px', border: `1.5px solid ${accent}`, background: '#ffffff', color: accent,
          fontSize: '13px', fontWeight: '800', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', flex: '0 0 auto',
        }, '복사');
        stripEl.appendChild(stripCopy);
      }
    } else if (still) {
      // ★ C116 정지 = 마감 시각 글(서버 inAppDeadlineText) · 시계 부품 칸에 내놓지 않는다(소비자 시계 연결 0)
      stripEl.appendChild(el('span', 'strip-deadline', {
        fontSize: '16px', fontWeight: '800', color: accent, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', flex: '0 0 auto',
      }, String(input.still?.deadlineText || '').trim() || '마감 시각 미정'));
    } else {
      const endMs = countdownEndMs(input.endAt);
      stripTimer = el('span', 'strip-timer', {
        fontSize: '16px', fontWeight: '800', color: accent, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', flex: '0 0 auto',
      }, endMs === null ? '마감 시각 미정' : formatCountdown(endMs - input.now));
      stripEl.appendChild(stripTimer);
    }
    box.appendChild(stripEl);
  }

  // 장 버튼 칸(흰 칸 · 그림 위에 얹지 않음)
  let ctaHost: HTMLElement | null = null;
  if (!still) {
    ctaHost = el('div', 'cta-host', { padding: '12px 16px', boxSizing: 'border-box', flex: '0 0 auto' });
    fillPosterFrameCta(ctaHost, slides[active], accent, input.text);
    box.appendChild(ctaHost);
  }

  // 바닥 시트 = 바닥 흰 줄 52px(왼쪽 하루 보지 않기 · 오른쪽 닫기)
  if (!isCard && dismissDay && close) {
    const foot = el('div', 'foot', {
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: `${R.sheet.footHeight}px`, padding: '0 20px',
      background: '#ffffff', color: '#57534e', fontSize: '14px', boxSizing: 'border-box', borderTop: '1px solid #f4f4f5', flex: '0 0 auto',
    });
    const footBtn = { background: 'none', border: 'none', color: 'inherit', fontSize: '14px', fontWeight: '500', cursor: 'pointer', height: `${R.closeHit}px`, padding: '0 2px', fontFamily: 'inherit', whiteSpace: 'nowrap' };
    Object.assign(dismissDay.style, footBtn);
    Object.assign(close.style, footBtn);
    foot.appendChild(dismissDay);
    foot.appendChild(close);
    box.appendChild(foot);
  }
  root.appendChild(box);
  backdrop.appendChild(root);

  // 한 장 = 그림이 들어오면 원본 비율로 높이 상한 안에 들도록 폭을 줄인다(자름 0)
  let fitVh = vh;
  // ★ C118 B5 여러 장 칸 비율 = 첫 장 그림 실제 비율을 3:4 ~ 4:3 으로 묶음(들어오기 전 3:4) · 폭 상한 = 높이 상한 먼저(최소 160 은 그 안에서만)
  let multiAspect: number = R.multiAspect;
  const fit = (nextVh: number) => {
    fitVh = Math.max(1, Math.floor(nextVh || fitVh));
    if (count > 1) {
      const capH = Math.round(fitVh * R.maxHeightRatio) - chrome;
      const byHeight = Math.floor(capH * multiAspect);
      root.style.maxWidth = `${Math.max(1, Math.min(maxW, byHeight))}px`;   // 높이 상한이 늘 이긴다(옛 최소 160 = 낮은 화면에서 높이 넘침)
      return;
    }
    const img = images[0];
    if (!img) return;
    const w = fitPosterFrameWidth(img.naturalWidth, img.naturalHeight, fitVh, chrome, maxW);
    if (w) root.style.maxWidth = `${w}px`;
  };
  if (count === 1) {
    const img = images[0];
    img.addEventListener('load', () => fit(fitVh));
    if (img.complete) fit(fitVh);
  } else if (count > 1 && images[0]) {
    const first = images[0];
    const applyAspect = () => {
      if (!(first.naturalWidth > 0 && first.naturalHeight > 0)) return;
      multiAspect = Math.min(4 / 3, Math.max(3 / 4, first.naturalWidth / first.naturalHeight));
      for (const c of cells) c.style.aspectRatio = `${Math.round(multiAspect * 1000)} / 1000`;
      fit(fitVh);
    };
    first.addEventListener('load', applyAspect);
    if (first.complete) applyAspect();
  }

  return {
    backdrop, root, frame, baked, accent, fit,
    parts: { rail, cells, images, pager, prev, next, ctaHost, strip: stripEl, stripCopy, stripCode, stripTimer, dismissDay, close },
  };
}

function closeIcon(size: number): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.4');
  svg.setAttribute('stroke-linecap', 'round');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', 'M6 6l12 12M18 6L6 18');
  svg.appendChild(p);
  return svg;
}
