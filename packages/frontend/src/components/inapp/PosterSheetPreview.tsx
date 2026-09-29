/**
 * PosterSheetPreview — 포스터 계열 3모양 미리보기 · 편집 무대(★ 2026-09-29 인앱 만들기 개편 · 설계서 §1-1 · §2)
 *
 * SDK(packages/sdk-js/src/inapp.ts)의 미러:
 *   event_card   = renderPosterSheet — 위 글 칸(라벨 · 제목 · 본문 · 면색) / 아래 사진 4:3 / 쪽 번호 N / M / 바닥 글자 버튼 둘
 *   banner_sheet = renderPosterSheet — 색 면 · 좌상단 탭 칩 · X · 왼쪽 글(윗줄 · 큰 제목 · 아랫줄 · 버튼) · 오른쪽 사진(contain)
 *   overlay      = renderPoster / renderPosterCarousel — 사진 위 글(스크림) · 여러 장이면 점 · 활성 장 버튼 · 다시 보지 않기
 * 부품 이름(data-hjl-part) · 기본값(POSTER_SHEET_DEFAULTS) · 바닥 문구가 SDK 와 같다 — 대조 테스트(inapp-sheet-parity-0929)가 묶는다.
 *
 * editable = 편집기 무대. 빈 칸도 자리 글로 보여 주고(누르면 그 칸을 고친다) · 사진 자리는 눌러서·끌어 놓아 넣는다.
 * editable 이 없으면 실물과 같게 빈 칸을 그리지 않는다.
 */
import { useState, type CSSProperties, type DragEvent, type MouseEvent, type ReactNode } from 'react';
import { safeFontFamily } from './blockTheme';

export type PosterLayout = 'overlay' | 'event_card' | 'banner_sheet';
export const POSTER_LAYOUTS: PosterLayout[] = ['overlay', 'event_card', 'banner_sheet'];

/** SDK resolvePosterLayout 미러 — 모르는 값·없음 = overlay(지금 포스터). */
export function resolvePosterLayout(design: any): PosterLayout {
  const v = design && typeof design === 'object' ? String(design.poster_layout || '') : '';
  return (POSTER_LAYOUTS as string[]).includes(v) ? (v as PosterLayout) : 'overlay';
}

/** SDK POSTER_SHEET_DEFAULTS 미러(값이 빠진 장의 폴백 · 편집기는 장마다 명시 기록). */
export const POSTER_SHEET_DEFAULTS: Record<'event_card' | 'banner_sheet', {
  bg: string; titleColor: string; bodyColor: string; titleSize: number; bodySize: number; fit: 'cover' | 'contain';
}> = {
  event_card: { bg: '#f7f1e3', titleColor: '#8a3b1f', bodyColor: '#57534e', titleSize: 26, bodySize: 14, fit: 'cover' },
  banner_sheet: { bg: '#db2777', titleColor: '#fde047', bodyColor: '#ffffff', titleSize: 26, bodySize: 19, fit: 'contain' },
};
/** overlay(지금 포스터) 기본 — SDK renderPoster 폴백과 같은 값 */
export const POSTER_OVERLAY_DEFAULTS = { titleColor: '#ffffff', bodyColor: '#ffffff', titleSize: 20, bodySize: 14 };

export type SheetEditKey = 'eyebrow' | 'subtitle' | 'title' | 'body' | 'cta';

export interface SheetSlide {
  image_url?: string | null;
  eyebrow?: string | null;
  subtitle?: string | null;
  title?: string | null;
  body?: string | null;
  cta?: { label?: string | null; action_url?: string | null; background_color?: string | null; text_color?: string | null } | null;
  link_url?: string | null;
  bg_color?: string | null;
  title_color?: string | null;
  body_color?: string | null;
  title_size?: number | null;
  body_size?: number | null;
  image_fit?: 'cover' | 'contain' | null;
}

export interface SheetEditable {
  selected: SheetEditKey | null;
  onPick: (key: SheetEditKey, el: HTMLElement) => void;
  onImagePick: () => void;
  onImageDrop: (files: FileList) => void;
}

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
export const hexOr = (v: any, fb: string) => (typeof v === 'string' && HEX.test(v) ? v : fb);
const sizeOr = (v: any, min: number, max: number, fb: number) => { const n = Number(v); return Number.isFinite(n) && n >= min && n <= max ? n : fb; };
const FONT = '"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';

/** 편집 자리 글(빈 칸일 때 편집 무대에서만) */
const PLACEHOLDER: Record<SheetEditKey, string> = {
  eyebrow: '라벨', subtitle: '윗줄', title: '제목을 넣어 주세요', body: '본문', cta: '버튼 문구',
};

export function PosterSheetPreview({
  layout, slides, design, replaceVars, active: activeProp, onActiveChange, scale = 0.82, badge,
  radius = '18px 18px 0 0', shadow = '0 -18px 50px rgba(0,0,0,0.4)', arrows = false, editable,
}: {
  layout: PosterLayout;
  slides: SheetSlide[];
  design?: Record<string, any> | null;
  replaceVars?: (t: string) => string;
  /** 보여 줄 장(편집기가 쥐면 제어형) */
  active?: number;
  onActiveChange?: (i: number) => void;
  scale?: number;
  /** overlay 전용 — 장 라벨이 없을 때의 메시지 배지(SDK 와 같은 폴백) */
  badge?: string | null;
  radius?: string;
  shadow?: string;
  /** 좌우 화살표(PC 미리보기 · 편집 무대) */
  arrows?: boolean;
  editable?: SheetEditable;
}) {
  const [own, setOwn] = useState(0);
  const list: SheetSlide[] = Array.isArray(slides) && slides.length > 0 ? slides : [{}];
  const count = list.length;
  const idx = Math.max(0, Math.min(count - 1, activeProp ?? own));
  const go = (n: number) => { const next = ((n % count) + count) % count; setOwn(next); onActiveChange?.(next); };
  const s = list[idx] || {};
  const rv = (t: any) => (replaceVars ? replaceVars(String(t || '')) : String(t || ''));
  const font = safeFontFamily(design?.font_display, '') || undefined;
  const snooze = String(design?.dismiss_mode || '') === 'snooze_day';
  const px = (n: number) => Math.round(n * scale);
  const edOutline = (key: SheetEditKey): CSSProperties => (editable
    ? { cursor: 'text', outline: editable.selected === key ? '2px solid #8b5cf6' : 'none', outlineOffset: 2, borderRadius: 4 }
    : {});

  // 칸 하나 — 값이 있거나 편집 무대면 그린다(실물과 같게 빈 칸은 안 그린다)
  const field = (key: SheetEditKey, style: CSSProperties, raw: any, fallback?: string) => {
    const text = rv(raw) || fallback || '';
    if (!text && !editable) return null;
    return (
      <div data-hjl-part={key} data-edit={editable ? key : undefined}
        onClick={editable ? (e: MouseEvent<HTMLElement>) => { e.stopPropagation(); editable.onPick(key, e.currentTarget); } : undefined}
        style={{ ...style, ...edOutline(key), ...(!text && editable ? { opacity: 0.5 } : {}) }}>
        {text || PLACEHOLDER[key]}
      </div>
    );
  };

  const fitOf = (d: 'cover' | 'contain') => (s.image_fit === 'cover' || s.image_fit === 'contain' ? s.image_fit : d);
  const imgSlot = (style: CSSProperties, imgStyle: CSSProperties, fit: 'cover' | 'contain', emptyColor: string, children?: ReactNode) => {
    const url = s.image_url ? String(s.image_url) : '';
    const drop = editable ? {
      onClick: (e: MouseEvent) => { if ((e.target as HTMLElement).closest('[data-edit],[data-hjl-part="prev"],[data-hjl-part="next"]')) return; editable.onImagePick(); },
      onDragOver: (e: DragEvent) => { e.preventDefault(); },
      onDrop: (e: DragEvent) => { e.preventDefault(); if (e.dataTransfer?.files?.length) editable.onImageDrop(e.dataTransfer.files); },
    } : {};
    return (
      <div data-hjl-part="media" data-img-slot={editable ? '1' : undefined} {...drop} style={{ ...style, ...(editable ? { cursor: 'pointer' } : {}) }}>
        {url
          ? <img src={url} alt="" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} style={{ width: '100%', height: '100%', display: 'block', objectFit: fit, ...imgStyle }} />
          : (
            <div style={{ width: '100%', height: '100%', minHeight: 'inherit', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, fontSize: px(12.5), fontWeight: 700, color: emptyColor, border: editable ? '2px dashed rgba(127,127,127,0.35)' : 'none', boxSizing: 'border-box', textAlign: 'center', padding: 10 }}>
              {editable ? '사진을 끌어 놓거나 눌러서 넣기' : '사진 필요'}
              {editable && <span style={{ fontSize: px(10.5), fontWeight: 500, opacity: 0.85 }}>내 파일 · 라이브러리 · 몰 상품</span>}
            </div>
          )}
        {s.link_url && String(s.link_url).trim() && (
          <div style={{ position: 'absolute', top: 8, left: 8, background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 9.5, fontWeight: 700, padding: '2px 7px', borderRadius: 999, zIndex: 3 }}>사진 누르면 이동</div>
        )}
        {children}
      </div>
    );
  };

  const pager = count > 1 ? (
    <div data-hjl-part="pager" style={{ position: 'absolute', right: 10, bottom: 10, height: 22, padding: '0 9px', borderRadius: 999, background: 'rgba(28,25,23,0.55)', color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', zIndex: 4, pointerEvents: 'none' }}>
      {idx + 1} / {count}
    </div>
  ) : null;
  const navArrows = arrows && count > 1 ? (
    <>
      {([-1, 1] as const).map((d) => (
        <button key={d} type="button" data-hjl-part={d < 0 ? 'prev' : 'next'} aria-label={d < 0 ? '이전 장' : '다음 장'}
          onClick={(e) => { e.stopPropagation(); go(idx + d); }}
          style={{ position: 'absolute', top: '50%', [d < 0 ? 'left' : 'right']: 8, transform: 'translateY(-50%)', width: 30, height: 30, borderRadius: 999, border: 'none', background: 'rgba(255,255,255,0.88)', color: '#1b1d23', fontSize: 18, lineHeight: 1, cursor: 'pointer', zIndex: 6, boxShadow: '0 2px 10px rgba(0,0,0,0.18)' } as CSSProperties}>
          {d < 0 ? '‹' : '›'}
        </button>
      ))}
    </>
  ) : null;
  const closeX = (color: string) => (
    <div style={{ position: 'absolute', top: px(10), right: px(12), zIndex: 5, width: px(28), height: px(28), borderRadius: 999, background: 'rgba(127,127,127,0.18)', color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: px(13), pointerEvents: 'none' }}>✕</div>
  );
  const optOutLabel = snooze ? '오늘 하루 보지 않기' : '다시 보지 않기';

  // ───────── overlay(지금 포스터) ─────────
  if (layout === 'overlay') {
    const msgOverlay = hexOr(design?.poster_text_color, POSTER_OVERLAY_DEFAULTS.titleColor);
    const tColor = hexOr(s.title_color, hexOr(design?.poster_title_color, msgOverlay));
    const bColor = hexOr(s.body_color, hexOr(design?.poster_body_color, msgOverlay));
    const tSize = px(sizeOr(s.title_size, 14, 32, sizeOr(design?.poster_title_size, 14, 32, POSTER_OVERLAY_DEFAULTS.titleSize)));
    const bSize = px(sizeOr(s.body_size, 10, 22, sizeOr(design?.poster_body_size, 10, 22, POSTER_OVERLAY_DEFAULTS.bodySize)));
    const multi = count > 1;
    const hasImg = !!s.image_url;
    const eyebrowText = rv(s.eyebrow) || rv(badge);
    const cta = s.cta;
    return (
      <div data-hjl-layout="overlay" style={{ position: 'relative', width: '100%', maxHeight: '96%', display: 'flex', flexDirection: 'column', background: '#ffffff', color: '#1b1d23', borderRadius: radius, overflow: 'hidden', boxShadow: shadow, fontFamily: FONT }}>
        <div style={{ position: 'relative', flexShrink: 1, minHeight: 0, overflow: 'hidden', color: '#fff' }}>
          {imgSlot(
            multi || !hasImg
              ? { position: 'relative', width: '100%', aspectRatio: '4 / 5', maxHeight: px(440), overflow: 'hidden', background: hasImg ? '#23252c' : 'linear-gradient(135deg,#e8e8ee,#d4d4dd)' }
              : { position: 'relative', width: '100%', overflow: 'hidden' },
            multi || !hasImg ? {} : { height: 'auto', maxHeight: px(440) },
            'cover', '#6b6b75',
            (eyebrowText || s.title || s.body || editable) ? (
              <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: `${px(52)}px ${px(22)}px ${px(18)}px`, background: 'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.66) 100%)', color: msgOverlay, maxHeight: '100%', overflowY: 'auto', boxSizing: 'border-box' }}>
                {(eyebrowText || editable) && (
                  <div style={{ marginBottom: px(8) }}>
                    <span data-hjl-part="eyebrow" data-edit={editable ? 'eyebrow' : undefined}
                      onClick={editable ? (e) => { e.stopPropagation(); editable.onPick('eyebrow', e.currentTarget); } : undefined}
                      style={{ display: 'inline-block', background: 'rgba(255,255,255,0.2)', fontSize: px(11), fontWeight: 700, letterSpacing: '0.03em', padding: `${px(4)}px ${px(11)}px`, borderRadius: 999, color: tColor, ...edOutline('eyebrow'), ...(!eyebrowText ? { opacity: 0.55 } : {}) }}>
                      {eyebrowText || PLACEHOLDER.eyebrow}
                    </span>
                  </div>
                )}
                {field('title', { fontWeight: 800, fontSize: tSize, letterSpacing: '-0.01em', lineHeight: 1.3, marginBottom: px(5), color: tColor, ...(font ? { fontFamily: font } : {}) }, s.title)}
                {field('body', { fontSize: bSize, opacity: 0.94, lineHeight: 1.55, whiteSpace: 'pre-wrap', color: bColor }, s.body)}
              </div>
            ) : null,
          )}
          {closeX('#ffffff')}
          {navArrows}
        </div>
        <div style={{ padding: `${px(12)}px ${px(20)}px ${px(8)}px`, flexShrink: 0 }}>
          {multi && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 5, marginBottom: px(10) }}>
              {list.map((_, i) => (
                <div key={i} data-hjl-dot={i} style={{ width: i === idx ? 18 : 7, height: 7, borderRadius: 999, background: i === idx ? hexOr(design?.poster_title_color, '#1b1d23') : 'rgba(27,29,35,0.22)' }} />
              ))}
            </div>
          )}
          {(cta && (cta.label || cta.action_url)) || editable ? (
            <div data-hjl-part="cta" data-edit={editable ? 'cta' : undefined}
              onClick={editable ? (e) => { e.stopPropagation(); editable.onPick('cta', e.currentTarget); } : undefined}
              style={{ background: hexOr(cta?.background_color, '#4f46e5'), color: hexOr(cta?.text_color, '#ffffff'), padding: `${px(11)}px ${px(15)}px`, borderRadius: 10, fontSize: px(14), fontWeight: 700, textAlign: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.2)', ...edOutline('cta'), ...(!cta?.label && editable ? { opacity: 0.55 } : {}) }}>
              {rv(cta?.label) || (editable ? PLACEHOLDER.cta : '자세히 보기')}
            </div>
          ) : null}
          <div data-hjl-part={snooze ? 'foot-snooze' : 'foot-optout'} style={{ textAlign: 'center', fontSize: px(11.5), opacity: 0.5, textDecoration: 'underline dotted', textUnderlineOffset: 3, padding: `${px(8)}px 0 ${px(4)}px` }}>{optOutLabel}</div>
        </div>
      </div>
    );
  }

  // ───────── event_card · banner_sheet ─────────
  const D = POSTER_SHEET_DEFAULTS[layout];
  const bg = hexOr(s.bg_color, D.bg);
  const titleColor = hexOr(s.title_color, D.titleColor);
  const bodyColor = hexOr(s.body_color, D.bodyColor);
  const titleSize = px(sizeOr(s.title_size, 14, 32, D.titleSize));
  const bodySize = px(sizeOr(s.body_size, 10, 22, D.bodySize));
  const fit = fitOf(D.fit);

  let bodyEl: ReactNode;
  if (layout === 'event_card') {
    bodyEl = (
      <div data-hjl-slide={idx} style={{ display: 'flex', flexDirection: 'column' }}>
        <div data-hjl-part="text" style={{ background: bg, padding: `${px(26)}px ${px(24)}px ${px(18)}px` }}>
          {field('eyebrow', { fontSize: px(13), fontWeight: 800, letterSpacing: '0.06em', color: titleColor }, s.eyebrow)}
          {field('title', { fontSize: titleSize, fontWeight: 800, color: titleColor, marginTop: (s.eyebrow || editable) ? px(8) : 0, letterSpacing: '-0.02em', lineHeight: 1.2, whiteSpace: 'pre-wrap', ...(font ? { fontFamily: font } : {}) }, s.title)}
          {field('body', { fontSize: bodySize, color: bodyColor, marginTop: px(10), lineHeight: 1.55, whiteSpace: 'pre-wrap' }, s.body)}
        </div>
        <div style={{ position: 'relative' }}>
          {imgSlot({ position: 'relative', width: '100%', aspectRatio: '4 / 3', overflow: 'hidden', background: fit === 'contain' ? bg : '#e7e0d2' }, {}, fit, '#8a7f6a')}
          {pager}
        </div>
      </div>
    );
  } else {
    const cta = s.cta;
    const showCta = !!(cta && (cta.label || cta.action_url)) || !!editable;
    bodyEl = (
      <div data-hjl-slide={idx} data-hjl-part="panel" style={{ position: 'relative', background: bg, color: bodyColor, padding: `${px(48)}px ${px(18)}px ${px(22)}px`, minHeight: px(300), overflow: 'hidden', boxSizing: 'border-box' }}>
        {(s.eyebrow || editable) && (
          <div data-hjl-part="eyebrow" data-edit={editable ? 'eyebrow' : undefined}
            onClick={editable ? (e) => { e.stopPropagation(); editable.onPick('eyebrow', e.currentTarget); } : undefined}
            style={{ position: 'absolute', top: 0, left: px(18), height: px(34), padding: `0 ${px(14)}px`, borderRadius: `0 0 ${px(12)}px ${px(12)}px`, background: '#111827', color: '#fff', fontSize: px(13), fontWeight: 800, display: 'flex', alignItems: 'center', zIndex: 3, whiteSpace: 'nowrap', maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis', ...edOutline('eyebrow'), ...(!s.eyebrow ? { opacity: 0.55 } : {}) }}>
            {rv(s.eyebrow) || PLACEHOLDER.eyebrow}
          </div>
        )}
        {closeX('#111827')}
        <div style={{ position: 'relative', zIndex: 2, width: '64%' }}>
          {field('subtitle', { fontSize: px(14), fontWeight: 700, opacity: 0.95, color: bodyColor, lineHeight: 1.35, whiteSpace: 'pre-wrap' }, s.subtitle)}
          {field('title', { fontSize: titleSize, fontWeight: 900, color: titleColor, lineHeight: 1.12, marginTop: (s.subtitle || editable) ? px(10) : 0, letterSpacing: '-0.03em', whiteSpace: 'pre-wrap', ...(font ? { fontFamily: font } : {}) }, s.title)}
          {field('body', { fontSize: bodySize, fontWeight: 900, color: bodyColor, lineHeight: 1.2, marginTop: px(6), letterSpacing: '-0.02em', whiteSpace: 'pre-wrap' }, s.body)}
          {showCta && (
            <div style={{ marginTop: px(18) }}>
              <span data-hjl-part="cta" data-edit={editable ? 'cta' : undefined}
                onClick={editable ? (e) => { e.stopPropagation(); editable.onPick('cta', e.currentTarget); } : undefined}
                style={{ display: 'inline-flex', alignItems: 'center', height: px(36), padding: `0 ${px(16)}px`, borderRadius: 999, background: hexOr(cta?.background_color, '#ffffff'), color: hexOr(cta?.text_color, '#111827'), fontSize: px(13), fontWeight: 800, ...edOutline('cta'), ...(!cta?.label && editable ? { opacity: 0.55 } : {}) }}>
                {rv(cta?.label) || (editable ? PLACEHOLDER.cta : '자세히 보기')}
              </span>
            </div>
          )}
        </div>
        {imgSlot({ position: 'absolute', right: -px(10), bottom: 0, width: '58%', height: '78%', zIndex: 1 }, { objectPosition: 'center bottom' }, fit, 'rgba(255,255,255,0.9)')}
        {pager}
      </div>
    );
  }

  return (
    <div data-hjl-layout={layout} style={{ position: 'relative', width: '100%', maxHeight: '96%', display: 'flex', flexDirection: 'column', background: '#ffffff', color: '#1b1d23', borderRadius: radius, overflow: 'hidden', boxShadow: shadow, fontFamily: FONT }}>
      <div style={{ position: 'relative', flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}>
        {bodyEl}
        {navArrows}
      </div>
      <div data-hjl-part="foot" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: `${px(14)}px ${px(22)}px ${px(18)}px`, background: '#ffffff', color: '#57534e', fontSize: px(14), flexShrink: 0 }}>
        <span data-hjl-part={snooze ? 'foot-snooze' : 'foot-optout'}>{optOutLabel}</span>
        <span data-hjl-part="foot-close">닫기</span>
      </div>
    </div>
  );
}
