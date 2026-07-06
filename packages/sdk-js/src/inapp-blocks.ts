/**
 * @hanjullo/sdk — In-app Message 블록 렌더러 (D230+ 2026-06-27)
 *
 * content_blocks(jsonb 배열) → DOM. 13 블록 타입. 테마 토큰(inapp-theme) 기반.
 * 미지원 type·필수 필드 누락·미허용(템플릿별) 블록 = 그 블록만 skip(자사몰 안 깨짐).
 *
 * 순수 DOM(jsdom 테스트 가능). 버튼 클릭·이미지 절대화·변수 치환은 ctx 콜백으로 위임.
 */

import type { InAppTheme } from './inapp-theme';
import { withAlpha, shadeHex } from './inapp-theme';

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

export type BlockType =
  | 'media' | 'eyebrow' | 'headline' | 'body' | 'bullets' | 'benefit'
  | 'countdown' | 'rating' | 'product' | 'divider' | 'spacer' | 'cta_group' | 'footer';

export interface ContentBlock {
  type: string;
  [key: string]: any;
}

export interface BlockButton {
  id?: string;
  label: string;
  action_url?: string | null;
  style?: 'primary' | 'secondary' | 'tertiary' | 'ghost';
}

export interface BlockRenderContext {
  theme: InAppTheme;
  template: string;
  /** 텍스트 Liquid/%변수% 치환 */
  replaceVars: (text: string) => string;
  /** 상대 이미지 경로 → 절대 URL */
  absoluteImageUrl: (url: string) => string;
  /** CTA 클릭 — 트래킹 + 닫기 + 이동은 호출부가 처리 */
  onButtonClick: (buttonId: string, actionUrl: string | null) => void;
  /** prefers-reduced-motion: reduce → 순차 등장 끔 */
  reducedMotion: boolean;
  /** is_ad — footer 자동 (광고) 표기 */
  isAd?: boolean;
}

export const ALL_BLOCK_TYPES: BlockType[] = [
  'media', 'eyebrow', 'headline', 'body', 'bullets', 'benefit',
  'countdown', 'rating', 'product', 'divider', 'spacer', 'cta_group', 'footer',
];

// 템플릿별 허용 블록 (스펙 §7). 정의 없는 템플릿 = 전부 허용(안전 default).
const ALL = new Set<string>(ALL_BLOCK_TYPES);
const ALLOWED_BLOCKS: Record<string, Set<string>> = {
  center_modal: ALL,
  full_screen: ALL,
  inline_card: ALL,
  slide_in: new Set(['media', 'eyebrow', 'headline', 'body', 'rating', 'product', 'benefit', 'cta_group', 'divider', 'spacer', 'footer']),
  top_banner: new Set(['media', 'eyebrow', 'headline', 'body', 'cta_group', 'footer']),
  bottom_banner: new Set(['media', 'eyebrow', 'headline', 'body', 'cta_group', 'footer']),
  toast: new Set(['eyebrow', 'headline', 'body', 'footer']),
  floating_button: new Set(['cta_group']),
};

export function isBlockAllowed(template: string, type: string): boolean {
  const set = ALLOWED_BLOCKS[template];
  if (!set) return true;
  return set.has(type);
}

// ════════════════════════════════════════════════════════════════════
// 작은 DOM 헬퍼
// ════════════════════════════════════════════════════════════════════

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  styles?: Partial<CSSStyleDeclaration> | Record<string, string>,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (styles) Object.assign(node.style, styles);
  if (text !== undefined) node.textContent = text;
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 라인 아이콘 (24x24 viewBox, currentColor stroke) */
const ICON_PATHS: Record<string, string> = {
  check: 'M20 6 9 17l-5-5',
  gift: 'M20 12v9H4v-9M2 7h20v5H2zM12 22V7M12 7a3 3 0 0 1-3-3 2 2 0 0 1 2-2c2 0 3 2.5 3 5M12 7a3 3 0 0 0 3-3 2 2 0 0 0-2-2c-2 0-3 2.5-3 5',
  star: 'M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.8 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8z',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  heart: 'M19 14c1.5-1.5 3-3.3 3-5.5A4.5 4.5 0 0 0 12 5 4.5 4.5 0 0 0 2 8.5c0 2.2 1.5 4 3 5.5l7 7z',
  clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  tag: 'M20.6 13.4 12 22l-9-9V3h10l7.6 7.6a2 2 0 0 1 0 2.8zM7 7h.01',
  sparkle: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2 2M16 16l2 2M18 6l-2 2M8 16l-2 2',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  cart: 'M6 6h15l-1.5 9h-12zM6 6 5 3H2M9 20a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM19 20a1 1 0 1 1-2 0 1 1 0 0 1 2 0z',
  user: 'M20 21a8 8 0 1 0-16 0M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
};

function iconSvg(key: string, color: string, size: number, fill = false): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', fill ? color : 'none');
  svg.setAttribute('stroke', fill ? 'none' : color);
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.style.flexShrink = '0';
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ICON_PATHS[key] || ICON_PATHS.sparkle);
  svg.appendChild(path);
  return svg;
}

// 내장 일러스트 6종 (장식 — alt 빈값 허용). 미지원 키 = null
const ILLUSTRATIONS = new Set(['welcome', 'celebrate', 'empty_cart', 'gift', 'bell', 'heart']);

function illustrationSvg(key: string, accent: string, soft: string): SVGSVGElement | null {
  if (!ILLUSTRATIONS.has(key)) return null;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.setAttribute('width', '96');
  svg.setAttribute('height', '96');
  svg.setAttribute('fill', 'none');
  const circle = document.createElementNS(SVG_NS, 'circle');
  circle.setAttribute('cx', '60'); circle.setAttribute('cy', '60'); circle.setAttribute('r', '54');
  circle.setAttribute('fill', soft);
  svg.appendChild(circle);
  const iconKey = key === 'welcome' ? 'user' : key === 'empty_cart' ? 'cart' : key === 'celebrate' ? 'sparkle' : key;
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('transform', 'translate(36 36) scale(2)');
  g.setAttribute('stroke', accent);
  g.setAttribute('stroke-width', '2');
  g.setAttribute('stroke-linecap', 'round');
  g.setAttribute('stroke-linejoin', 'round');
  g.setAttribute('fill', 'none');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ICON_PATHS[iconKey] || ICON_PATHS.sparkle);
  g.appendChild(path);
  svg.appendChild(g);
  return svg;
}

// 2026-07-07 디자인 2.0 — Pretendard 우선(호스트 몰에 있으면 사용, 없으면 시스템 한글 폴백. 외부 로드 0)
const FONT_STACK = '"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';

// ════════════════════════════════════════════════════════════════════
// 블록별 렌더러 (HTMLElement | null — null = skip)
// ════════════════════════════════════════════════════════════════════

function renderMedia(b: ContentBlock, ctx: BlockRenderContext): HTMLElement | null {
  const { theme } = ctx;
  const variant = b.variant || (b.url ? 'image' : b.icon ? 'icon' : 'image');

  if (variant === 'icon') {
    const wrap = el('div', {
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      width: '52px', height: '52px', borderRadius: '16px',
      background: withAlpha(theme.accent, 0.14), marginBottom: '4px', flexShrink: '0',
    });
    wrap.appendChild(iconSvg(String(b.icon || 'sparkle'), theme.accent, 26));
    return wrap;
  }

  if (variant === 'illustration') {
    const svg = illustrationSvg(String(b.icon || b.key || ''), theme.accent, withAlpha(theme.accent, 0.12));
    if (!svg) return null;
    const wrap = el('div', { display: 'flex', justifyContent: 'center', marginBottom: '2px' });
    wrap.appendChild(svg);
    return wrap;
  }

  // image
  const url = String(b.url || '').trim();
  if (!url) return null;
  const aspect: Record<string, string> = { '16:9': '56.25%', '4:3': '75%', '1:1': '100%', banner: '34%' };
  const pad = aspect[String(b.aspect)] || aspect['16:9'];
  const radius = typeof b.radius === 'number' ? `${b.radius}px` : `${Math.max(10, theme.radius - 8)}px`;

  const frame = el('div', {
    position: 'relative', width: '100%', paddingTop: pad,
    borderRadius: radius, overflow: 'hidden', background: theme.surfaceElevated,
    boxShadow: `inset 0 0 0 1px ${theme.border}`,
  });
  const img = document.createElement('img');
  img.src = ctx.absoluteImageUrl(url);
  img.alt = '';
  img.loading = 'lazy';
  img.referrerPolicy = 'no-referrer';
  Object.assign(img.style, {
    position: 'absolute', inset: '0', width: '100%', height: '100%',
    objectFit: b.fit === 'contain' ? 'contain' : 'cover', display: 'block',
  });
  img.onerror = () => { frame.style.display = 'none'; };
  frame.appendChild(img);
  if (b.overlay) {
    const ov = el('div', {
      position: 'absolute', inset: '0',
      background: 'linear-gradient(180deg, rgba(0,0,0,0) 45%, rgba(0,0,0,0.28) 75%, rgba(0,0,0,0.52) 100%)',
    });
    frame.appendChild(ov);
  }
  return frame;
}

function renderEyebrow(b: ContentBlock, ctx: BlockRenderContext): HTMLElement | null {
  const text = ctx.replaceVars(String(b.text || '')).trim();
  if (!text) return null;
  const { theme } = ctx;
  const tone = b.tone || 'accent';
  const color = tone === 'on_media' ? theme.onMedia : tone === 'neutral' ? theme.textSecondary : theme.accent;
  const chip = el('div', {
    display: 'inline-flex', alignItems: 'center', gap: '5px', alignSelf: 'flex-start',
    fontSize: '11px', fontWeight: '700', letterSpacing: '0.05em',
    color, lineHeight: '1.2',
  }, text);
  if (tone === 'accent') {
    Object.assign(chip.style, {
      background: theme.accentSoft, padding: '5px 11px', borderRadius: '999px',
      boxShadow: `inset 0 0 0 1px ${withAlpha(theme.accent, 0.14)}`,
    });
    // 앞에 작은 점 하나 — 라벨 칩의 생동감 (텍스트보다 먼저 삽입)
    const dot = el('span', {
      width: '4px', height: '4px', borderRadius: '999px', background: theme.accent, flexShrink: '0',
    });
    chip.insertBefore(dot, chip.firstChild);
  }
  return chip;
}

const HEADLINE_SIZES: Record<string, string> = { sm: '16px', md: '19px', lg: '21px', xl: '24px' };
const BODY_SIZES: Record<string, string> = { sm: '13px', md: '14px', lg: '15.5px' };

function renderHeadline(b: ContentBlock, ctx: BlockRenderContext): HTMLElement | null {
  const text = ctx.replaceVars(String(b.text || '')).trim();
  if (!text) return null;
  const xl = b.size === 'xl';
  return el('div', {
    fontWeight: xl ? '800' : '700',
    fontSize: HEADLINE_SIZES[String(b.size)] || '19px',
    letterSpacing: xl ? '-0.02em' : '-0.01em',
    lineHeight: '1.28',
    color: ctx.theme.textPrimary,
  }, text);
}

function renderBody(b: ContentBlock, ctx: BlockRenderContext): HTMLElement | null {
  const text = ctx.replaceVars(String(b.text || ''));
  if (!text.trim()) return null;
  return el('div', {
    fontSize: BODY_SIZES[String(b.size)] || '14px', fontWeight: '400', lineHeight: '1.6',
    letterSpacing: '-0.005em',
    color: ctx.theme.textSecondary, whiteSpace: 'pre-wrap',
  }, text);
}

function renderBullets(b: ContentBlock, ctx: BlockRenderContext): HTMLElement | null {
  const items = Array.isArray(b.items) ? b.items.filter((it: any) => it && String(it.text || '').trim()) : [];
  if (items.length === 0) return null;
  const { theme } = ctx;
  const list = el('div', { display: 'flex', flexDirection: 'column', gap: '8px' });
  items.slice(0, 4).forEach((it: any) => {
    const row = el('div', { display: 'flex', alignItems: 'flex-start', gap: '8px' });
    const ic = el('span', {
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: '18px', height: '18px', borderRadius: '999px',
      background: withAlpha(theme.accent, 0.14), marginTop: '1px', flexShrink: '0',
    });
    ic.appendChild(iconSvg(String(it.icon || 'check'), theme.accent, 12));
    row.appendChild(ic);
    row.appendChild(el('div', {
      fontSize: '13px', lineHeight: '1.45', color: theme.textPrimary,
    }, ctx.replaceVars(String(it.text))));
    list.appendChild(row);
  });
  return list;
}

function renderBenefit(b: ContentBlock, ctx: BlockRenderContext): HTMLElement | null {
  const { theme } = ctx;
  const text = ctx.replaceVars(String(b.text || '[혜택 안내 — 직접 작성해주세요]'));
  // 쿠폰 티켓 2.0 — 그라데이션 워시 + 양측 펀치홀 + 아이콘 배지
  const ticket = el('div', {
    position: 'relative', display: 'flex', alignItems: 'center', gap: '11px',
    padding: '13px 18px 13px 14px',
    background: `linear-gradient(135deg, ${withAlpha(theme.accent, 0.09)} 0%, ${withAlpha(theme.accent, 0.16)} 100%)`,
    border: `1.5px dashed ${withAlpha(theme.accent, 0.45)}`,
    borderRadius: '14px',
    color: theme.textPrimary,
  });
  // 양측 노치 (티켓 펀치홀 — 면 색으로 구멍처럼)
  const notchStyle = {
    position: 'absolute', top: '50%', transform: 'translateY(-50%)',
    width: '13px', height: '13px', borderRadius: '999px', background: theme.surface,
    boxShadow: `inset 0 0 0 1.5px ${withAlpha(theme.accent, 0.28)}`,
  } as Record<string, string>;
  ticket.appendChild(el('span', { ...notchStyle, left: '-8px' }));
  ticket.appendChild(el('span', { ...notchStyle, right: '-8px' }));
  const ic = el('span', {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: '32px', height: '32px', borderRadius: '10px', flexShrink: '0',
    background: theme.accentSoft,
  });
  ic.appendChild(iconSvg('gift', theme.accent, 18));
  ticket.appendChild(ic);
  ticket.appendChild(el('div', {
    fontSize: '13.5px', fontWeight: '700', lineHeight: '1.4', letterSpacing: '-0.01em',
    color: theme.textPrimary, minWidth: '0',
  }, text));
  return ticket;
}

function renderCountdown(b: ContentBlock, ctx: BlockRenderContext): HTMLElement | null {
  const endMs = Date.parse(String(b.ends_at || ''));
  if (!isFinite(endMs)) return null;
  const { theme } = ctx;
  const box = el('div', {
    display: 'flex', alignItems: 'center', gap: '9px',
    padding: '11px 13px', borderRadius: '14px',
    background: theme.surfaceElevated, color: theme.textPrimary,
    boxShadow: `inset 0 0 0 1px ${theme.border}`,
  });
  const ic = el('span', {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: '28px', height: '28px', borderRadius: '9px', background: theme.accentSoft, flexShrink: '0',
  });
  ic.appendChild(iconSvg('clock', theme.accent, 15));
  box.appendChild(ic);
  const label = String(b.label || '').trim();
  if (label) box.appendChild(el('span', { fontSize: '12px', fontWeight: '500', color: theme.textSecondary }, ctx.replaceVars(label)));

  // 세그먼트 시계 (HH:MM:SS 각 칸 분리 — 1일 이상은 "N일 H시간" 단일 표기)
  const time = el('span', {
    display: 'inline-flex', alignItems: 'center', gap: '3px', marginLeft: 'auto',
  });
  box.appendChild(time);
  const seg = (txt: string, urgent: boolean) => el('span', {
    minWidth: '26px', padding: '3px 5px', textAlign: 'center', borderRadius: '7px',
    background: urgent ? theme.accentSoft : withAlpha(theme.textPrimary, 0.06),
    fontSize: '13.5px', fontWeight: '800', fontVariantNumeric: 'tabular-nums', letterSpacing: '0.01em',
    color: urgent ? theme.accent : theme.textPrimary, lineHeight: '1.2',
  }, txt);
  const colon = () => el('span', { fontSize: '12px', fontWeight: '700', color: theme.textSecondary }, ':');

  const render = (ms: number) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const urgent = ms < 3600 * 1000; // 1시간 미만 = accent 강조
    while (time.firstChild) time.removeChild(time.firstChild);
    if (d > 0) {
      time.appendChild(el('span', {
        fontSize: '14px', fontWeight: '800', fontVariantNumeric: 'tabular-nums', color: theme.textPrimary,
      }, `${d}일 ${h}시간`));
      return;
    }
    time.appendChild(seg(String(h).padStart(2, '0'), urgent));
    time.appendChild(colon());
    time.appendChild(seg(String(m).padStart(2, '0'), urgent));
    time.appendChild(colon());
    time.appendChild(seg(String(sec).padStart(2, '0'), urgent));
  };
  const tick = () => {
    const remain = endMs - Date.now();
    if (remain <= 0) {
      box.style.display = 'none';
      if (timer) clearInterval(timer);
      return;
    }
    render(remain);
    // 카드에서 떨어져 나가면(닫힘) 인터벌 정리
    if (typeof document !== 'undefined' && !document.contains(box) && timer) clearInterval(timer);
  };
  tick();
  let timer: ReturnType<typeof setInterval> | null = null;
  if (endMs - Date.now() > 0) timer = setInterval(tick, 1000);
  return box;
}

function star(kind: 'full' | 'half' | 'empty', accent: string, dim: string): SVGSVGElement {
  const color = kind === 'empty' ? dim : accent;
  return iconSvg('star', color, 15, kind === 'full');
}

function renderRating(b: ContentBlock, ctx: BlockRenderContext): HTMLElement | null {
  const value = Math.max(0, Math.min(5, Number(b.value)));
  if (!isFinite(value) || value <= 0) return null;
  const { theme } = ctx;
  const row = el('div', { display: 'flex', alignItems: 'center', gap: '8px' });
  const stars = el('div', { display: 'flex', gap: '2px' });
  for (let i = 1; i <= 5; i++) {
    const kind = value >= i ? 'full' : value >= i - 0.5 ? 'half' : 'empty';
    stars.appendChild(star(kind, theme.accent, withAlpha(theme.textSecondary, 0.4)));
  }
  row.appendChild(stars);
  const parts: string[] = [value.toFixed(1)];
  if (b.count) parts.push(`후기 ${Number(b.count).toLocaleString()}`);
  if (b.label) parts.push(String(b.label));
  row.appendChild(el('div', { fontSize: '12px', color: theme.textSecondary }, ctx.replaceVars(parts.join(' · '))));
  return row;
}

function renderProduct(b: ContentBlock, ctx: BlockRenderContext): HTMLElement | null {
  const name = ctx.replaceVars(String(b.name || '')).trim();
  if (!name) return null;
  const { theme } = ctx;
  const card = el('div', {
    display: 'flex', alignItems: 'center', gap: '12px',
    padding: '11px', borderRadius: '16px',
    background: theme.surfaceElevated, border: `1px solid ${theme.border}`,
    boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
  });
  const imgUrl = String(b.image || '').trim();
  if (imgUrl) {
    const img = document.createElement('img');
    img.src = ctx.absoluteImageUrl(imgUrl);
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    Object.assign(img.style, { width: '56px', height: '56px', borderRadius: '12px', objectFit: 'cover', flexShrink: '0', boxShadow: `inset 0 0 0 1px ${theme.border}` });
    img.onerror = () => { img.style.display = 'none'; };
    card.appendChild(img);
  }
  const col = el('div', { minWidth: '0', flex: '1' });
  col.appendChild(el('div', { fontSize: '14px', fontWeight: '700', letterSpacing: '-0.01em', color: theme.textPrimary, lineHeight: '1.3' }, name));
  const meta = ctx.replaceVars(String(b.meta || '')).trim();
  if (meta) col.appendChild(el('div', { fontSize: '12px', color: theme.textSecondary, marginTop: '2px' }, meta));
  if (b.rating) {
    const r = renderRating({ type: 'rating', value: b.rating }, ctx);
    if (r) { r.style.marginTop = '4px'; col.appendChild(r); }
  }
  card.appendChild(col);
  return card;
}

function renderDivider(_b: ContentBlock, ctx: BlockRenderContext): HTMLElement {
  // 양끝이 스며드는 페이드 구분선
  return el('div', {
    height: '1px', width: '100%',
    background: `linear-gradient(90deg, transparent 0%, ${ctx.theme.border} 18%, ${ctx.theme.border} 82%, transparent 100%)`,
  });
}

function renderSpacer(b: ContentBlock): HTMLElement {
  const h: Record<string, string> = { sm: '4px', md: '10px', lg: '20px' };
  return el('div', { height: h[String(b.size)] || h.md });
}

function renderCtaGroup(b: ContentBlock, ctx: BlockRenderContext): HTMLElement | null {
  const buttons: BlockButton[] = Array.isArray(b.buttons) ? b.buttons.filter((x: any) => x && String(x.label || '').trim()) : [];
  if (buttons.length === 0) return null;
  const { theme } = ctx;
  const stack = b.layout !== 'inline';
  const wrap = el('div', {
    display: 'flex', flexDirection: stack ? 'column' : 'row', gap: '8px', flexWrap: 'wrap',
  });
  buttons.slice(0, 3).forEach((btn, idx) => {
    const style = btn.style || (idx === 0 ? 'primary' : 'secondary');
    const isPrimary = style === 'primary';
    const isGhost = style === 'ghost';
    const isTertiary = style === 'tertiary';
    // primary = 세로 그라데이션(accent → 짙은 accent) + 근접/원거리 2중 그림자 — 눌리는 입체감
    const primaryBg = `linear-gradient(180deg, ${shadeHex(theme.accent, 6)} 0%, ${shadeHex(theme.accent, -12)} 100%)`;
    const primaryShadow = `0 1px 2px ${withAlpha(shadeHex(theme.accent, -40), 0.3)}, 0 8px 22px ${withAlpha(theme.accent, 0.38)}, inset 0 1px 0 rgba(255,255,255,0.18)`;
    const primaryShadowHover = `0 2px 4px ${withAlpha(shadeHex(theme.accent, -40), 0.3)}, 0 12px 28px ${withAlpha(theme.accent, 0.48)}, inset 0 1px 0 rgba(255,255,255,0.18)`;
    const node = el('button', {
      cursor: 'pointer', fontFamily: FONT_STACK,
      padding: isGhost ? '9px 11px' : '13px 20px',
      borderRadius: '14px',
      fontSize: '14px', fontWeight: isPrimary ? '800' : '700',
      letterSpacing: '-0.01em', whiteSpace: 'nowrap', textAlign: 'center',
      width: stack ? '100%' : 'auto',
      transition: 'transform 0.16s cubic-bezier(0.22,1,0.36,1), box-shadow 0.2s ease, background 0.2s ease, filter 0.2s ease',
      border: isTertiary ? `1px solid ${theme.border}` : 'none',
      background: isPrimary ? primaryBg : isGhost ? 'transparent' : theme.surfaceElevated,
      color: isPrimary ? theme.accentText : isGhost ? theme.accent : theme.textPrimary,
      boxShadow: isPrimary ? primaryShadow : isTertiary ? 'none' : `inset 0 0 0 1px ${theme.border}`,
    }, ctx.replaceVars(btn.label));
    // 마이크로 인터랙션 — hover 살짝 떠오름 + 그림자 확장, press 눌림
    node.addEventListener('mouseenter', () => {
      node.style.transform = 'translateY(-1px)';
      if (isPrimary) node.style.boxShadow = primaryShadowHover;
      else if (!isGhost) node.style.filter = 'brightness(1.04)';
    });
    node.addEventListener('mouseleave', () => {
      node.style.transform = 'none';
      if (isPrimary) node.style.boxShadow = primaryShadow;
      node.style.filter = 'none';
    });
    node.addEventListener('mousedown', () => { node.style.transform = 'scale(0.97)'; });
    node.addEventListener('mouseup', () => { node.style.transform = 'translateY(-1px)'; });
    node.addEventListener('click', () => {
      ctx.onButtonClick(String(btn.id || `btn_${idx}`), btn.action_url ?? null);
    });
    wrap.appendChild(node);
  });
  return wrap;
}

function renderFooter(b: ContentBlock, ctx: BlockRenderContext): HTMLElement | null {
  let text = ctx.replaceVars(String(b.text || '')).trim();
  // is_ad — (광고) 표기 자동 (수신거부 번호는 회사 admin이 직접 작성 — 임의 번호 생성 금지)
  if (ctx.isAd && !/\(광고\)/.test(text)) text = text ? `(광고) ${text}` : '(광고)';
  if (!text) return null;
  return el('div', {
    fontSize: '11px', fontWeight: '500', lineHeight: '1.5',
    color: withAlpha(ctx.theme.textSecondary, 0.85),
  }, text);
}

const RENDERERS: Record<string, (b: ContentBlock, ctx: BlockRenderContext) => HTMLElement | null> = {
  media: renderMedia,
  eyebrow: renderEyebrow,
  headline: renderHeadline,
  body: renderBody,
  bullets: renderBullets,
  benefit: renderBenefit,
  countdown: renderCountdown,
  rating: renderRating,
  product: renderProduct,
  divider: renderDivider,
  spacer: renderSpacer as any,
  cta_group: renderCtaGroup,
  footer: renderFooter,
};

// ════════════════════════════════════════════════════════════════════
// 메인 — 블록 배열 → DOM (허용 필터 + 순차 등장 + is_ad 자동 footer)
// ════════════════════════════════════════════════════════════════════

export function renderBlocks(root: HTMLElement, blocks: ContentBlock[], ctx: BlockRenderContext): void {
  const rendered: HTMLElement[] = [];
  let hasFooter = false;

  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    const type = String(block.type || '');
    if (!RENDERERS[type]) continue;                       // 미지원 type skip
    if (!isBlockAllowed(ctx.template, type)) continue;    // 템플릿 미허용 skip
    let node: HTMLElement | null = null;
    try {
      node = RENDERERS[type](block, ctx);
    } catch {
      node = null; // 한 블록 오류가 메시지 전체를 깨지 않게
    }
    if (!node) continue;
    if (type === 'footer') hasFooter = true;
    root.appendChild(node);
    rendered.push(node);
  }

  // is_ad인데 footer 블록이 없으면 (광고) 자동 주입
  if (ctx.isAd && !hasFooter) {
    const auto = renderFooter({ type: 'footer', text: '' }, ctx);
    if (auto) { root.appendChild(auto); rendered.push(auto); }
  }

  applyStagger(rendered, ctx.reducedMotion);
}

/** 블록 0→N 순차 등장 (opacity + translateY, easeOutQuint). reducedMotion이면 즉시 표시. */
function applyStagger(nodes: HTMLElement[], reducedMotion: boolean): void {
  if (reducedMotion || nodes.length === 0) return;
  const raf = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16) as any;
  nodes.forEach((n) => {
    n.style.opacity = '0';
    n.style.transform = 'translateY(10px)';
    n.style.transition = 'opacity 0.45s cubic-bezier(0.22,1,0.36,1), transform 0.45s cubic-bezier(0.22,1,0.36,1)';
  });
  raf(() => raf(() => {
    nodes.forEach((n, i) => {
      const delay = Math.min(i * 70, 420);
      setTimeout(() => { n.style.opacity = '1'; n.style.transform = 'none'; }, delay);
    });
  }));
}
