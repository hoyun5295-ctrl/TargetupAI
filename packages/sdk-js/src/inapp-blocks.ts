/**
 * @hanjullo/sdk — In-app Message 블록 렌더러 (D230+ 2026-06-27)
 *
 * content_blocks(jsonb 배열) → DOM. 13 블록 타입. 테마 토큰(inapp-theme) 기반.
 * 미지원 type·필수 필드 누락·미허용(템플릿별) 블록 = 그 블록만 skip(자사몰 안 깨짐).
 *
 * 순수 DOM(jsdom 테스트 가능). 버튼 클릭·이미지 절대화·변수 치환은 ctx 콜백으로 위임.
 */

import type { InAppTheme } from './inapp-theme';
import { withAlpha, shadeHex, pickReadableText, safeFontFamily } from './inapp-theme';

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
  /** ★ 2026-07-07(5) 형태 축 골격 — 블록 렌더가 타이포·CTA·라벨 구조를 형태별로 바꿀 때 참조. 미지정 = classic */
  cardStyle?: CardStyle;
  // ── ★ 2026-07-14 디자인 3.0 (미지정 = 현행 렌더 — 기존 발행물 회귀 0) ──
  /** 모션 2.0 활성 (design.motion='rich' && !reducedMotion). keyframes는 inapp.ts가 1회 주입(hjl- 접두) */
  motion?: boolean;
  /** 구도 — resolveInAppTreatment 통과값만 (fail-closed, 미허용 = classic) */
  treatment?: InAppTreatment;
  /** 헤드라인 서체 오버라이드 (design.font_display — 테마 displayFont보다 우선) */
  displayFont?: string;
  /** ★ 2026-07-17 텍스트 정렬 (design.text_align) — 루트 text-align 상속이 닿지 않는 flex 행 블록(쿠폰·CTA 행)의
   *  justify-content 미러 전용. 카운트다운(좌 라벨+우 시계)·목록(마커)·상품 카드(좌 이미지+우 정보)는 구조 유지.
   *  미지정 = 기존 렌더 그대로(회귀 0). */
  textAlign?: 'center' | 'right';
}

// ════════════════════════════════════════════════════════════════════
// ★ 2026-07-14 디자인 3.0 — 구도(treatment) 허용표. template×card_style 조합별 fail-closed 단일 진실.
//   미허용·미설정 = classic(현행 조판). poster/ticket/bubble은 자기 구도 보유라 classic만.
// ════════════════════════════════════════════════════════════════════

export type InAppTreatment = 'classic' | 'framed' | 'typographic' | 'spotlight';

export const INAPP_TREATMENTS: Record<string, InAppTreatment[]> = {
  'center_modal|classic': ['classic', 'framed', 'typographic', 'spotlight'],
  'inline_card|classic': ['classic', 'framed', 'typographic', 'spotlight'],
  'full_screen|classic': ['classic', 'framed', 'typographic'],
  'slide_in|classic': ['classic', 'typographic', 'spotlight'],
};

export function resolveInAppTreatment(template: string, cardStyle: string, requested: any): InAppTreatment {
  const allowed = INAPP_TREATMENTS[`${template}|${cardStyle}`];
  const req = String(requested || '');
  return allowed && (allowed as string[]).includes(req) ? (req as InAppTreatment) : 'classic';
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
  // ★ 2026-07-18 포스터형(P1) — flat 전용, 블록 미지원 (backend·frontend 미러와 3면 동일)
  full_image: new Set<string>(),
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

/** ★ P2-2 (2026-07-12) 원화 표기 — 상품 블록 가격 행 (이메일 렌더러 formatWon과 동일 표기) */
function formatWon(n: number): string {
  return `${Math.round(n).toLocaleString('ko-KR')}원`;
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

  // ★ 2026-07-07(5) 형태 골격 — 쿠폰 티켓: 칩 없이 자간 넓은 accent 인장 라벨 (테마 무관 티켓 시그니처)
  if (tone === 'accent' && ctx.cardStyle === 'ticket') {
    return el('div', {
      alignSelf: 'flex-start', fontSize: '11px', fontWeight: '800', letterSpacing: '0.18em',
      color: theme.accent, lineHeight: '1.2',
    }, text);
  }

  // 디자인 언어 2.1 — plain(모노 에디토리얼): 칩 없이 자간 넓은 민무늬 라벨
  if (tone === 'accent' && theme.eyebrowVariant === 'plain') {
    return el('div', {
      alignSelf: 'flex-start', fontSize: '10.5px', fontWeight: '700', letterSpacing: '0.16em',
      color: theme.textSecondary, lineHeight: '1.2',
    }, text);
  }

  const chip = el('div', {
    display: 'inline-flex', alignItems: 'center', gap: '5px', alignSelf: 'flex-start',
    fontSize: '11px', fontWeight: '700', letterSpacing: '0.05em',
    color, lineHeight: '1.2',
  }, text);
  if (tone === 'accent') {
    if (theme.eyebrowVariant === 'chip_solid') {
      // 브랜드 쇼케이스 — accent 솔리드 칩
      Object.assign(chip.style, {
        background: theme.accent, color: theme.accentText,
        padding: '5px 11px', borderRadius: '999px',
        boxShadow: `0 4px 12px ${withAlpha(theme.accent, 0.35)}`,
      });
      const dot = el('span', {
        width: '4px', height: '4px', borderRadius: '999px',
        background: theme.accentText, opacity: '0.9', flexShrink: '0',
      });
      chip.insertBefore(dot, chip.firstChild);
    } else {
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
  }
  return chip;
}

const HEADLINE_SIZES: Record<string, string> = { sm: '16px', md: '19px', lg: '21px', xl: '24px' };
// ★ 2026-07-07(5) 형태 골격 — 둥근 말풍선은 채팅 스케일 (한 단계 작게, 대화체 밀도)
const BUBBLE_HEADLINE_SIZES: Record<string, string> = { sm: '15px', md: '17px', lg: '19px', xl: '21px' };
const BODY_SIZES: Record<string, string> = { sm: '13px', md: '14px', lg: '15.5px' };

function renderHeadline(b: ContentBlock, ctx: BlockRenderContext): HTMLElement | null {
  const text = ctx.replaceVars(String(b.text || '')).trim();
  if (!text) return null;
  const { theme } = ctx;
  const bubble = ctx.cardStyle === 'bubble';
  const ticket = ctx.cardStyle === 'ticket';
  const xl = b.size === 'xl';
  const weight = bubble ? 700 : (ticket || xl) ? Math.max(800, theme.headlineWeight) : theme.headlineWeight;
  // ★ 3.0 — 크기 배율: 테마 headlineScale × typographic 구도 1.25 (미설정 = 1, 현행 크기 그대로)
  const baseSize = (bubble ? BUBBLE_HEADLINE_SIZES : HEADLINE_SIZES)[String(b.size)] || (bubble ? '17px' : '19px');
  const scale = (theme.headlineScale || 1) * (ctx.treatment === 'typographic' && !bubble ? 1.25 : 1);
  const head = el('div', {
    fontWeight: String(weight),
    fontSize: scale !== 1 ? `${Math.round(parseFloat(baseSize) * scale * 10) / 10}px` : baseSize,
    letterSpacing: xl || weight >= 800 || scale > 1.15 ? '-0.02em' : '-0.01em',
    lineHeight: '1.28',
    color: theme.textPrimary,
  });
  // ★ 3.0 — 헤드라인 전용 서체 (design.font_display 우선 → 테마 displayFont. 미설정 = 카드 서체 상속)
  const df = safeFontFamily(ctx.displayFont || theme.displayFont, '');
  if (df) head.style.fontFamily = df;
  // ★ 3.0 — 강조 표시 (블록 필드 emphasis — DM emphasizeHead 미러. 미설정 = 평문 그대로)
  if (b.emphasis === 'marker' || b.emphasis === 'underline') {
    const span = el('span', {}, text);
    if (b.emphasis === 'marker') {
      Object.assign(span.style, {
        background: `linear-gradient(180deg, rgba(0,0,0,0) 58%, ${withAlpha(theme.accent, 0.3)} 58%)`,
        borderRadius: '2px', padding: '0 2px',
      });
    } else {
      Object.assign(span.style, { boxShadow: `inset 0 -2px 0 ${theme.accent}`, paddingBottom: '1px' });
    }
    head.appendChild(span);
  } else {
    head.textContent = text;
  }
  // ★ 3.0 — 모티프 마크(테마 아트디렉션) + 기존 브랜드 쇼케이스 accent 바 (버블은 채팅 골격이라 둘 다 제외)
  const decorations: HTMLElement[] = [];
  if (theme.motif && !bubble) {
    if (theme.motif === 'rule') decorations.push(el('div', { width: '22px', height: '3px', borderRadius: '999px', background: theme.accent, marginBottom: '9px' }));
    else if (theme.motif === 'dot') decorations.push(el('div', { width: '6px', height: '6px', borderRadius: '999px', background: theme.accent, marginBottom: '9px' }));
    else if (theme.motif === 'bracket') decorations.push(el('div', { width: '12px', height: '12px', borderLeft: `2.5px solid ${theme.accent}`, borderTop: `2.5px solid ${theme.accent}`, marginBottom: '8px' }));
  }
  const withBar = theme.headlineAccentBar && !bubble;
  if (decorations.length === 0 && !withBar) return head;
  const wrap = el('div');
  for (const d of decorations) wrap.appendChild(d);
  wrap.appendChild(head);
  if (withBar) {
    // 브랜드 쇼케이스 — 헤드라인 아래 accent 짧은 바
    wrap.appendChild(el('div', {
      width: '26px', height: '4px', borderRadius: '999px', marginTop: '9px',
      background: `linear-gradient(90deg, ${theme.accent} 0%, ${shadeHex(theme.accent, 30)} 100%)`,
    }));
  }
  return wrap;
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
  const mono = theme.bulletVariant === 'mono';
  const list = el('div', { display: 'flex', flexDirection: 'column', gap: mono ? '9px' : '8px' });
  items.slice(0, 4).forEach((it: any) => {
    const row = el('div', { display: 'flex', alignItems: 'flex-start', gap: mono ? '9px' : '8px' });
    if (mono) {
      // 모노 에디토리얼 — 배지 없이 잉크색 아이콘만
      const ic = iconSvg(String(it.icon || 'check'), theme.textPrimary, 14);
      ic.style.marginTop = '2px';
      row.appendChild(ic);
    } else {
      const ic = el('span', {
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: '18px', height: '18px', borderRadius: '999px',
        background: withAlpha(theme.accent, 0.14), marginTop: '1px', flexShrink: '0',
      });
      ic.appendChild(iconSvg(String(it.icon || 'check'), theme.accent, 12));
      row.appendChild(ic);
    }
    row.appendChild(el('div', {
      fontSize: '13px', lineHeight: '1.45', color: theme.textPrimary,
    }, ctx.replaceVars(String(it.text))));
    list.appendChild(row);
  });
  return list;
}

/** ★ 3.0 모션 — 쿠폰 샤인 스윕. 호스트 위에 클립(inset 0, overflow hidden) + 광 띠. keyframes = inapp.ts hjl-shine */
function attachShine(host: HTMLElement, radiusPx: number): void {
  host.style.position = host.style.position || 'relative';
  const clip = el('div', {
    position: 'absolute', inset: '0', borderRadius: `${radiusPx}px`,
    overflow: 'hidden', pointerEvents: 'none',
  });
  const band = el('div', {
    position: 'absolute', top: '-40%', bottom: '-40%', left: '0', width: '38%',
    background: 'linear-gradient(105deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.35) 50%, rgba(255,255,255,0) 100%)',
    // 이동은 keyframes(hjl-shine)의 transform이 소유 — 레이아웃 속성(left) 애니메이션 금지(컴포지터 전용)
    animation: 'hjl-shine 3.2s ease-in-out infinite',
  });
  clip.appendChild(band);
  host.appendChild(clip);
}

function renderBenefit(b: ContentBlock, ctx: BlockRenderContext): HTMLElement | null {
  const { theme } = ctx;
  const text = ctx.replaceVars(String(b.text || '[혜택 안내 — 직접 작성해주세요]'));
  // ★ 2026-07-07(5) 형태 골격 — 쿠폰 티켓 카드: 카드 자체가 티켓(절취선+스터브)이라
  //   점선 박스 중첩(티켓 안 티켓) 대신 대형 혜택 타이포로 승격
  //   ★ 3.0 — spotlight 구도(classic 카드)도 같은 대형 승격을 사용
  if (ctx.cardStyle === 'ticket' || ctx.treatment === 'spotlight') {
    const big = el('div', {
      display: 'flex', alignItems: 'center', gap: '12px',
      padding: '15px 16px', borderRadius: `${theme.innerRadius}px`,
      background: theme.accentSoft, color: theme.textPrimary,
      // ★ 2026-07-17 text_align 미러 — flex 행이라 상속이 안 닿아 justify-content로 (미지정 = 기존 좌측)
      ...(ctx.textAlign ? { justifyContent: ctx.textAlign === 'center' ? 'center' : 'flex-end' } : {}),
    });
    const bigIc = el('span', {
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: '38px', height: '38px', borderRadius: '12px', flexShrink: '0',
      background: theme.accent,
    });
    bigIc.appendChild(iconSvg('gift', theme.accentText, 20));
    big.appendChild(bigIc);
    big.appendChild(el('div', {
      fontSize: '16.5px', fontWeight: '800', lineHeight: '1.35', letterSpacing: '-0.02em',
      color: theme.textPrimary, minWidth: '0',
    }, text));
    if (ctx.motion) attachShine(big, theme.innerRadius);
    return big;
  }
  // 쿠폰 티켓 2.0 — 그라데이션 워시 + 양측 펀치홀 + 아이콘 배지
  const ticket = el('div', {
    position: 'relative', display: 'flex', alignItems: 'center', gap: '11px',
    padding: '13px 18px 13px 14px',
    background: `linear-gradient(135deg, ${withAlpha(theme.accent, 0.09)} 0%, ${withAlpha(theme.accent, 0.16)} 100%)`,
    border: `1.5px dashed ${withAlpha(theme.accent, 0.45)}`,
    borderRadius: `${theme.innerRadius}px`,
    color: theme.textPrimary,
    // ★ 2026-07-17 text_align 미러 — flex 행이라 상속이 안 닿아 justify-content로 (미지정 = 기존 좌측)
    ...(ctx.textAlign ? { justifyContent: ctx.textAlign === 'center' ? 'center' : 'flex-end' } : {}),
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
  if (ctx.motion) attachShine(ticket, theme.innerRadius);
  return ticket;
}

function renderCountdown(b: ContentBlock, ctx: BlockRenderContext): HTMLElement | null {
  const endMs = Date.parse(String(b.ends_at || ''));
  if (!isFinite(endMs)) return null;
  const { theme } = ctx;
  const box = el('div', {
    display: 'flex', alignItems: 'center', gap: '9px',
    padding: '11px 13px', borderRadius: `${theme.innerRadius}px`,
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
    const secEl = seg(String(sec).padStart(2, '0'), urgent);
    // ★ 3.0 모션 — 초 칸 팝 (매 틱 요소 재생성이라 자동 재생. keyframes = inapp.ts hjl-tick)
    if (ctx.motion) secEl.style.animation = 'hjl-tick 0.3s ease-out';
    time.appendChild(secEl);
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
    padding: '11px', borderRadius: `${theme.innerRadius + 2}px`,
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
  // ★ P2-2 (2026-07-12) 가격 구조화 — discount_price 있으면 accent 800 할인가 + 취소선 정가(이메일 렌더러와 동일 문법).
  //   가격 미입력 시에만 기존 meta 문자열 표시(하위호환 — 기존 저장분 렌더 무변화).
  const price = Number(b.price);
  const discount = Number(b.discount_price);
  const hasPrice = isFinite(price) && price > 0;
  const hasDiscount = isFinite(discount) && discount > 0;
  if (hasDiscount || hasPrice) {
    const row = el('div', { display: 'flex', alignItems: 'baseline', gap: '6px', marginTop: '3px', flexWrap: 'wrap' });
    if (hasDiscount) {
      row.appendChild(el('span', { fontSize: '14px', fontWeight: '800', letterSpacing: '-0.01em', color: theme.accent }, formatWon(discount)));
      if (hasPrice) row.appendChild(el('span', { fontSize: '12px', color: theme.textSecondary, textDecoration: 'line-through' }, formatWon(price)));
    } else {
      row.appendChild(el('span', { fontSize: '14px', fontWeight: '800', letterSpacing: '-0.01em', color: theme.textPrimary }, formatWon(price)));
    }
    col.appendChild(row);
  } else {
    const meta = ctx.replaceVars(String(b.meta || '')).trim();
    if (meta) col.appendChild(el('div', { fontSize: '12px', color: theme.textSecondary, marginTop: '2px' }, meta));
  }
  if (b.rating) {
    const r = renderRating({ type: 'rating', value: b.rating }, ctx);
    if (r) { r.style.marginTop = '4px'; col.appendChild(r); }
  }
  card.appendChild(col);
  // ★ 3.0 — 상품 링크: link_url 있으면 카드 전체가 이동 표면 (클릭 추적 + 닫기 + safeNavigate = ctx 콜백 단일 길목).
  //   미설정 = 현행 비클릭 카드 그대로 (기존 발행물 회귀 0).
  const rawLink = String(b.link_url || '').trim();
  if (/^https?:\/\//i.test(rawLink)) {
    Object.assign(card.style, {
      cursor: 'pointer',
      transition: 'transform 0.16s cubic-bezier(0.22,1,0.36,1), box-shadow 0.2s ease',
    });
    card.setAttribute('role', 'link');
    const arrow = iconSvg('arrow', theme.textSecondary, 15);
    arrow.style.opacity = '0.55';
    card.appendChild(arrow);
    card.addEventListener('mouseenter', () => { card.style.transform = 'translateY(-1px)'; card.style.boxShadow = '0 6px 16px rgba(0,0,0,0.09)'; });
    card.addEventListener('mouseleave', () => { card.style.transform = 'none'; card.style.boxShadow = '0 2px 8px rgba(0,0,0,0.04)'; });
    card.addEventListener('click', () => {
      ctx.onButtonClick(String(b.id || 'product'), rawLink);
    });
  }
  return card;
}

function renderDivider(_b: ContentBlock, ctx: BlockRenderContext): HTMLElement {
  // fade = 양끝이 스며드는 구분선 / solid = 헤어라인 (모노 에디토리얼·브랜드)
  return el('div', {
    height: '1px', width: '100%',
    background: ctx.theme.dividerVariant === 'solid'
      ? ctx.theme.border
      : `linear-gradient(90deg, transparent 0%, ${ctx.theme.border} 18%, ${ctx.theme.border} 82%, transparent 100%)`,
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

  // ★ 2026-07-07(5) 형태 골격 — 둥근 말풍선: 전폭 버튼 대신 채팅 답장 칩 (자동 폭 알약, 가로 나열)
  if (ctx.cardStyle === 'bubble') {
    const chipWrap = el('div', {
      display: 'flex', flexDirection: 'row', gap: '8px', flexWrap: 'wrap',
      // ★ 2026-07-17 text_align 미러 — 칩 행 justify-content (미지정 = 기존 좌측)
      ...(ctx.textAlign ? { justifyContent: ctx.textAlign === 'center' ? 'center' : 'flex-end' } : {}),
    });
    buttons.slice(0, 3).forEach((btn, idx) => {
      const style = btn.style || (idx === 0 ? 'primary' : 'secondary');
      const isPrimary = style === 'primary';
      const chip = el('button', {
        cursor: 'pointer', fontFamily: FONT_STACK,
        padding: '11px 18px', borderRadius: '999px',
        fontSize: '13.5px', fontWeight: isPrimary ? '800' : '700',
        letterSpacing: '-0.01em', whiteSpace: 'nowrap', textAlign: 'center',
        width: 'auto', border: 'none',
        background: isPrimary ? theme.accent : 'transparent',
        color: isPrimary ? theme.accentText : theme.accent,
        boxShadow: isPrimary
          ? `0 4px 14px ${withAlpha(theme.accent, 0.35)}`
          : `inset 0 0 0 1.5px ${withAlpha(theme.accent, 0.45)}`,
        transition: 'transform 0.16s cubic-bezier(0.22,1,0.36,1), filter 0.2s ease',
      }, ctx.replaceVars(btn.label));
      // ★ 3.0 모션 — 대표 CTA 맥동 (밝기 파동 — transform 미사용이라 hover 리프트와 충돌 0)
      if (ctx.motion && isPrimary) chip.style.animation = 'hjl-cta-pulse 2.8s ease-in-out infinite';
      chip.addEventListener('mouseenter', () => { chip.style.transform = 'translateY(-1px)'; chip.style.filter = 'brightness(1.05)'; });
      chip.addEventListener('mouseleave', () => { chip.style.transform = 'none'; chip.style.filter = 'none'; });
      chip.addEventListener('mousedown', () => { chip.style.transform = 'scale(0.96)'; });
      chip.addEventListener('click', () => {
        ctx.onButtonClick(String(btn.id || `btn_${idx}`), btn.action_url ?? null);
      });
      chipWrap.appendChild(chip);
    });
    return chipWrap;
  }

  const stack = b.layout !== 'inline';
  const wrap = el('div', {
    display: 'flex', flexDirection: stack ? 'column' : 'row', gap: '8px', flexWrap: 'wrap',
    // ★ 2026-07-17 text_align 미러 — 비스택 버튼 행 justify-content (스택 = 전폭이라 무영향, 미지정 = 기존 좌측)
    ...(ctx.textAlign && !stack ? { justifyContent: ctx.textAlign === 'center' ? 'center' : 'flex-end' } : {}),
  });
  buttons.slice(0, 3).forEach((btn, idx) => {
    const style = btn.style || (idx === 0 ? 'primary' : 'secondary');
    const isPrimary = style === 'primary';
    const isGhost = style === 'ghost';
    const isTertiary = style === 'tertiary';
    // 디자인 언어 2.1 — primary 면/글자/그림자/모서리는 테마 토큰이 완성한 값 사용
    const primaryShadow = theme.buttonPrimaryShadow;
    const node = el('button', {
      cursor: 'pointer', fontFamily: FONT_STACK,
      padding: isGhost ? '9px 11px' : theme.buttonRadius >= 999 ? '13px 22px' : '13px 20px',
      borderRadius: `${theme.buttonRadius}px`,
      fontSize: '14px', fontWeight: isPrimary ? '800' : '700',
      letterSpacing: '-0.01em', whiteSpace: 'nowrap', textAlign: 'center',
      width: stack ? '100%' : 'auto',
      transition: 'transform 0.16s cubic-bezier(0.22,1,0.36,1), box-shadow 0.2s ease, background 0.2s ease, filter 0.2s ease',
      border: isTertiary ? `1px solid ${theme.border}` : 'none',
      background: isPrimary ? theme.buttonPrimaryBg : isGhost ? 'transparent' : theme.surfaceElevated,
      color: isPrimary ? theme.buttonPrimaryText : isGhost ? theme.buttonGhostColor : theme.textPrimary,
      boxShadow: isPrimary ? primaryShadow : isTertiary ? 'none' : `inset 0 0 0 1px ${theme.border}`,
    }, ctx.replaceVars(btn.label));
    // ★ 3.0 모션 — 대표 CTA 맥동 (밝기 파동 — transform 미사용이라 hover 리프트와 충돌 0)
    if (ctx.motion && isPrimary) node.style.animation = 'hjl-cta-pulse 2.8s ease-in-out infinite';
    // 마이크로 인터랙션 — hover 살짝 떠오름 + 밝기 상승, press 눌림
    node.addEventListener('mouseenter', () => {
      node.style.transform = 'translateY(-1px)';
      if (!isGhost) node.style.filter = 'brightness(1.05)';
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

// ════════════════════════════════════════════════════════════════════
// 카드 형태 축 (2026-07-07(2) 디자인 언어 2.1) — 색상(테마)과 독립인 "형태" 축
//   classic = 기본 카드 / bubble = 꼬리 달린 둥근 말풍선 / ticket = 절취선 쿠폰 티켓 / poster = 매거진 포스터
//   토스트·배너·플로팅은 자체 형태라 미적용(classic 동작).
// ════════════════════════════════════════════════════════════════════

export type CardStyle = 'classic' | 'bubble' | 'ticket' | 'poster';
export const CARD_STYLES: CardStyle[] = ['classic', 'bubble', 'ticket', 'poster'];

export function normalizeCardStyle(v: any): CardStyle {
  return (CARD_STYLES as string[]).includes(String(v)) ? (String(v) as CardStyle) : 'classic';
}

export interface CardLayoutPlan {
  /** poster — 히어로로 승격되는 첫 media(image) 블록. 없으면 null(강조색 면 히어로) */
  hero: ContentBlock | null;
  /** poster — 히어로 위에 겹칠 블록 (eyebrow·headline 각 첫 1개) */
  overlay: ContentBlock[];
  /** 본문 영역 블록 */
  main: ContentBlock[];
  /** ticket — 절취선 뒤 스터브 블록 (마지막 cta_group부터 끝까지) */
  stub: ContentBlock[];
  /** ★ 2026-07-07(5) bubble — 발신자 행(아바타+라벨)으로 승격되는 첫 eyebrow. 그 외 형태 = null */
  sender: ContentBlock | null;
}

/** 카드 형태별 블록 배치 계획 — SDK 렌더와 관리자 미리보기가 같은 분할을 쓰도록 순수 함수로 고정 */
export function planCardLayout(blocks: ContentBlock[], style: CardStyle): CardLayoutPlan {
  const list = Array.isArray(blocks) ? blocks.filter((b) => b && typeof b === 'object') : [];
  if (style === 'poster') {
    let hero: ContentBlock | null = null;
    const overlay: ContentBlock[] = [];
    const main: ContentBlock[] = [];
    let eyebrowTaken = false;
    let headlineTaken = false;
    for (const b of list) {
      if (!hero && b.type === 'media' && (b.variant === 'image' || (!b.variant && b.url)) && String(b.url || '').trim()) { hero = b; continue; }
      if (!eyebrowTaken && b.type === 'eyebrow') { overlay.push(b); eyebrowTaken = true; continue; }
      if (!headlineTaken && b.type === 'headline') { overlay.push(b); headlineTaken = true; continue; }
      main.push(b);
    }
    return { hero, overlay, main, stub: [], sender: null };
  }
  if (style === 'ticket') {
    let cut = -1;
    for (let i = list.length - 1; i >= 0; i--) {
      if (String(list[i].type) === 'cta_group') { cut = i; break; }
    }
    if (cut <= 0) return { hero: null, overlay: [], main: list, stub: [], sender: null };
    return { hero: null, overlay: [], main: list.slice(0, cut), stub: list.slice(cut), sender: null };
  }
  if (style === 'bubble') {
    let sender: ContentBlock | null = null;
    const main: ContentBlock[] = [];
    for (const b of list) {
      if (!sender && b.type === 'eyebrow') { sender = b; continue; }
      main.push(b);
    }
    return { hero: null, overlay: [], main, stub: [], sender };
  }
  return { hero: null, overlay: [], main: list, stub: [], sender: null };
}

/** ★ 2026-07-07(5) bubble 발신자 행 — 브랜드 그라데이션 아바타 + 라벨 (채팅 발신자 골격). 순수 DOM. */
export function renderBubbleSender(sender: ContentBlock, ctx: BlockRenderContext): HTMLElement | null {
  const text = ctx.replaceVars(String(sender?.text || '')).trim();
  if (!text) return null;
  const { theme } = ctx;
  const row = el('div', { display: 'flex', alignItems: 'center', gap: '9px' });
  const avatar = el('span', {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: '30px', height: '30px', borderRadius: '999px', flexShrink: '0',
    background: `linear-gradient(135deg, ${theme.accent} 0%, ${shadeHex(theme.accent, -18)} 100%)`,
    boxShadow: `0 3px 8px ${withAlpha(theme.accent, 0.35)}`,
  });
  avatar.appendChild(iconSvg('sparkle', theme.accentText, 15));
  row.appendChild(avatar);
  row.appendChild(el('div', {
    fontSize: '12.5px', fontWeight: '800', letterSpacing: '-0.01em', color: theme.textPrimary, minWidth: '0',
  }, text));
  return row;
}

/** poster 히어로 — 이미지(스크림+겹침 텍스트) 또는 강조색 면 + 헤드라인. 순수 DOM.
 *  ★ 2026-07-07(5) fullBleed=true — 카드 가장자리까지 확장(모서리 0)·히어로 190px·매거진 대형 헤드라인. */
export function renderPosterHero(plan: CardLayoutPlan, ctx: BlockRenderContext, fullBleed = false): HTMLElement | null {
  if (!plan.hero && plan.overlay.length === 0) return null;
  const { theme } = ctx;
  const hero = el('div', {
    position: 'relative', width: '100%', minHeight: fullBleed ? '190px' : '136px',
    borderRadius: fullBleed ? '0' : `${Math.max(12, theme.radius - 8)}px`,
    overflow: 'hidden', display: 'flex', alignItems: 'flex-end',
    background: plan.hero
      ? theme.surfaceElevated
      : `linear-gradient(135deg, ${shadeHex(theme.accent, 10)} 0%, ${theme.accent} 55%, ${shadeHex(theme.accent, -25)} 100%)`,
  });
  if (plan.hero) {
    const img = document.createElement('img');
    img.src = ctx.absoluteImageUrl(String(plan.hero.url || ''));
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    Object.assign(img.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover' });
    img.onerror = () => { img.style.display = 'none'; };
    hero.appendChild(img);
    hero.appendChild(el('div', {
      position: 'absolute', inset: '0',
      background: 'linear-gradient(180deg, rgba(0,0,0,0.02) 30%, rgba(0,0,0,0.58) 100%)',
    }));
  }
  const onHero = plan.hero ? '#ffffff' : pickReadableText(theme.accent);
  const txt = el('div', { position: 'relative', padding: fullBleed ? '22px 24px 18px' : '18px 18px 16px', display: 'flex', flexDirection: 'column', gap: '7px', width: '100%', boxSizing: 'border-box' });
  for (const b of plan.overlay) {
    const t = ctx.replaceVars(String(b.text || '')).trim();
    if (!t) continue;
    if (b.type === 'eyebrow') {
      txt.appendChild(el('div', {
        alignSelf: 'flex-start', fontSize: fullBleed ? '11px' : '10.5px', fontWeight: '800',
        letterSpacing: fullBleed ? '0.2em' : '0.14em',
        color: onHero, opacity: '0.88', lineHeight: '1.2',
      }, t));
    } else if (b.type === 'headline') {
      txt.appendChild(el('div', {
        fontSize: fullBleed ? '26px' : '22px', fontWeight: '800',
        letterSpacing: fullBleed ? '-0.03em' : '-0.02em', lineHeight: fullBleed ? '1.18' : '1.22',
        color: onHero, textShadow: plan.hero ? '0 2px 12px rgba(0,0,0,0.35)' : 'none',
      }, t));
    }
  }
  hero.appendChild(txt);
  return hero;
}

/** ticket 절취선 — 양측 펀치홀 + 점선. 순수 DOM.
 *  ★ 2026-07-07(5) fullBleed=true — 카드 가장자리 다이컷 노치(반원 절단)로 확대. 카드 overflow:hidden이 반원으로 잘라준다. */
export function renderTicketPerforation(theme: InAppTheme, fullBleed = false): HTMLElement {
  const row = el('div', { position: 'relative', height: fullBleed ? '24px' : '22px', display: 'flex', alignItems: 'center' });
  const hole = (side: 'left' | 'right') => {
    const h = el('span', {
      position: 'absolute', top: '50%', transform: 'translateY(-50%)',
      width: fullBleed ? '18px' : '16px', height: fullBleed ? '18px' : '16px', borderRadius: '999px',
      background: fullBleed ? shadeHex(theme.surface, -12) : theme.surfaceElevated,
      boxShadow: fullBleed
        ? `inset 0 2px 4px rgba(0,0,0,0.18), inset 0 0 0 1px ${theme.border}`
        : `inset 0 1px 3px rgba(0,0,0,0.12), inset 0 0 0 1px ${theme.border}`,
    });
    (h.style as any)[side] = fullBleed ? '-9px' : '-6px';
    return h;
  };
  row.appendChild(hole('left'));
  row.appendChild(el('div', { flex: '1', margin: fullBleed ? '0 20px' : '0 16px', borderTop: `2px dashed ${withAlpha(theme.textPrimary, 0.16)}` }));
  row.appendChild(hole('right'));
  return row;
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
