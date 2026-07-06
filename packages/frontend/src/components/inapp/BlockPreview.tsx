/**
 * BlockPreview — content_blocks를 미리보기로 렌더 (D230+ 2026-06-27)
 *
 * SDK inapp-blocks.ts와 톤 1:1 정합 (테마 토큰 공용 — blockTheme.ts).
 * 미리보기는 정적 표현 — 클릭/카운트다운 틱 없이 형태·내용만.
 */

import type { CSSProperties } from 'react';
import type { InAppTheme } from './blockTheme';
import { withAlpha, shadeHex } from './blockTheme';

// 2026-07-07 디자인 2.0 — SDK inapp-blocks FONT_STACK 미러
const FONT_STACK = '"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';

const ICON_PATHS: Record<string, string> = {
  check: 'M20 6 9 17l-5-5',
  gift: 'M20 12v9H4v-9M2 7h20v5H2zM12 22V7M12 7a3 3 0 0 1-3-3 2 2 0 0 1 2-2c2 0 3 2.5 3 5M12 7a3 3 0 0 0 3-3 2 2 0 0 0-2-2c-2 0-3 2.5-3 5',
  star: 'M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.8 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8z',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  heart: 'M19 14c1.5-1.5 3-3.3 3-5.5A4.5 4.5 0 0 0 12 5 4.5 4.5 0 0 0 2 8.5c0 2.2 1.5 4 3 5.5l7 7z',
  clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  tag: 'M20.6 13.4 12 22l-9-9V3h10l7.6 7.6a2 2 0 0 1 0 2.8zM7 7h.01',
  sparkle: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2 2M16 16l2 2M18 6l-2 2M8 16l-2 2',
  cart: 'M6 6h15l-1.5 9h-12zM6 6 5 3H2M9 20a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM19 20a1 1 0 1 1-2 0 1 1 0 0 1 2 0z',
  user: 'M20 21a8 8 0 1 0-16 0M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
};

function Icon({ name, color, size = 16, fill = false }: { name: string; color: string; size?: number; fill?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill={fill ? color : 'none'} stroke={fill ? 'none' : color}
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d={ICON_PATHS[name] || ICON_PATHS.sparkle} />
    </svg>
  );
}

interface Ctx {
  theme: InAppTheme;
  replaceVars: (t: string) => string;
}

function renderBlock(b: any, i: number, ctx: Ctx): JSX.Element | null {
  const { theme, replaceVars } = ctx;
  const t = (s: any) => replaceVars(String(s ?? ''));
  switch (b?.type) {
    case 'eyebrow': {
      const text = t(b.text).trim();
      if (!text) return null;
      const tone = b.tone || 'accent';
      const color = tone === 'on_media' ? theme.onMedia : tone === 'neutral' ? theme.textSecondary : theme.accent;
      const style: CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', color, alignSelf: 'flex-start', lineHeight: 1.2, display: 'inline-flex', alignItems: 'center', gap: 5 };
      if (tone === 'accent') Object.assign(style, { background: theme.accentSoft, padding: '5px 11px', borderRadius: 999, boxShadow: `inset 0 0 0 1px ${withAlpha(theme.accent, 0.14)}` });
      return (
        <div key={i} style={style}>
          {tone === 'accent' && <span style={{ width: 4, height: 4, borderRadius: 999, background: theme.accent, flexShrink: 0 }} />}
          {text}
        </div>
      );
    }
    case 'headline': {
      const text = t(b.text).trim();
      if (!text) return null;
      const hs: Record<string, number> = { sm: 16, md: 19, lg: 21, xl: 24 };
      const xl = b.size === 'xl';
      return <div key={i} style={{ fontWeight: xl ? 800 : 700, fontSize: hs[String(b.size)] || 19, letterSpacing: xl ? '-0.02em' : '-0.01em', lineHeight: 1.28, color: theme.textPrimary }}>{text}</div>;
    }
    case 'body': {
      const text = t(b.text);
      if (!text.trim()) return null;
      const bs: Record<string, number> = { sm: 13, md: 14, lg: 15.5 };
      return <div key={i} style={{ fontSize: bs[String(b.size)] || 14, lineHeight: 1.6, letterSpacing: '-0.005em', color: theme.textSecondary, whiteSpace: 'pre-wrap' }}>{text}</div>;
    }
    case 'bullets': {
      const items = Array.isArray(b.items) ? b.items.filter((it: any) => String(it?.text || '').trim()) : [];
      if (!items.length) return null;
      return (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.slice(0, 4).map((it: any, j: number) => (
            <div key={j} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18, borderRadius: 999, background: withAlpha(theme.accent, 0.14), marginTop: 1, flexShrink: 0 }}>
                <Icon name={it.icon || 'check'} color={theme.accent} size={12} />
              </span>
              <div style={{ fontSize: 13, lineHeight: 1.45, color: theme.textPrimary }}>{t(it.text)}</div>
            </div>
          ))}
        </div>
      );
    }
    case 'benefit': {
      const text = t(b.text || '[혜택 안내 — 직접 작성해주세요]');
      const notch: CSSProperties = { position: 'absolute', top: '50%', transform: 'translateY(-50%)', width: 13, height: 13, borderRadius: 999, background: theme.surface, boxShadow: `inset 0 0 0 1.5px ${withAlpha(theme.accent, 0.28)}` };
      return (
        <div key={i} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 11, padding: '13px 18px 13px 14px', background: `linear-gradient(135deg, ${withAlpha(theme.accent, 0.09)} 0%, ${withAlpha(theme.accent, 0.16)} 100%)`, border: `1.5px dashed ${withAlpha(theme.accent, 0.45)}`, borderRadius: 14 }}>
          <span style={{ ...notch, left: -8 }} />
          <span style={{ ...notch, right: -8 }} />
          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 10, background: theme.accentSoft, flexShrink: 0 }}>
            <Icon name="gift" color={theme.accent} size={18} />
          </span>
          <div style={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.4, letterSpacing: '-0.01em', color: theme.textPrimary, minWidth: 0 }}>{text}</div>
        </div>
      );
    }
    case 'countdown': {
      const seg: CSSProperties = { minWidth: 26, padding: '3px 5px', textAlign: 'center', borderRadius: 7, background: withAlpha(theme.textPrimary, 0.06), fontSize: 13.5, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: theme.textPrimary, lineHeight: 1.2 };
      const colon: CSSProperties = { fontSize: 12, fontWeight: 700, color: theme.textSecondary };
      return (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '11px 13px', borderRadius: 14, background: theme.surfaceElevated, boxShadow: `inset 0 0 0 1px ${theme.border}` }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 9, background: theme.accentSoft, flexShrink: 0 }}>
            <Icon name="clock" color={theme.accent} size={15} />
          </span>
          {b.label && <span style={{ fontSize: 12, fontWeight: 500, color: theme.textSecondary }}>{t(b.label)}</span>}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginLeft: 'auto' }}>
            <span style={seg}>23</span><span style={colon}>:</span><span style={seg}>59</span><span style={colon}>:</span><span style={seg}>59</span>
          </span>
        </div>
      );
    }
    case 'rating': {
      const value = Math.max(0, Math.min(5, Number(b.value)));
      if (!value) return null;
      const parts = [value.toFixed(1)];
      if (b.count) parts.push(`후기 ${Number(b.count).toLocaleString()}`);
      if (b.label) parts.push(String(b.label));
      return (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', gap: 2 }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Icon key={n} name="star" color={value >= n - 0.5 ? theme.accent : withAlpha(theme.textSecondary, 0.4)} size={15} fill={value >= n} />
            ))}
          </div>
          <div style={{ fontSize: 12, color: theme.textSecondary }}>{t(parts.join(' · '))}</div>
        </div>
      );
    }
    case 'product': {
      const name = t(b.name).trim();
      if (!name) return null;
      return (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 11, borderRadius: 16, background: theme.surfaceElevated, border: `1px solid ${theme.border}`, boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
          {b.image && <img src={b.image} alt="" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} style={{ width: 56, height: 56, borderRadius: 12, objectFit: 'cover', flexShrink: 0, boxShadow: `inset 0 0 0 1px ${theme.border}` }} />}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-0.01em', color: theme.textPrimary, lineHeight: 1.3 }}>{name}</div>
            {b.meta && <div style={{ fontSize: 12, color: theme.textSecondary, marginTop: 2 }}>{t(b.meta)}</div>}
          </div>
        </div>
      );
    }
    case 'divider':
      return <div key={i} style={{ height: 1, width: '100%', background: `linear-gradient(90deg, transparent 0%, ${theme.border} 18%, ${theme.border} 82%, transparent 100%)` }} />;
    case 'spacer': {
      const h: Record<string, number> = { sm: 4, md: 10, lg: 20 };
      return <div key={i} style={{ height: h[String(b.size)] ?? 10 }} />;
    }
    case 'media': {
      const variant = b.variant || (b.url ? 'image' : b.icon ? 'icon' : 'image');
      if (variant === 'icon') {
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 52, height: 52, borderRadius: 16, background: withAlpha(theme.accent, 0.14), flexShrink: 0 }}>
            <Icon name={b.icon || 'sparkle'} color={theme.accent} size={26} />
          </div>
        );
      }
      if (variant === 'illustration') {
        return (
          <div key={i} style={{ display: 'flex', justifyContent: 'center' }}>
            <div style={{ width: 88, height: 88, borderRadius: '50%', background: withAlpha(theme.accent, 0.12), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={b.icon === 'welcome' ? 'user' : b.icon === 'empty_cart' ? 'cart' : b.icon === 'celebrate' ? 'sparkle' : (b.icon || 'sparkle')} color={theme.accent} size={40} />
            </div>
          </div>
        );
      }
      const url = String(b.url || '').trim();
      if (!url) return null;
      const pad: Record<string, string> = { '16:9': '56.25%', '4:3': '75%', '1:1': '100%', banner: '34%' };
      return (
        <div key={i} style={{ position: 'relative', width: '100%', paddingTop: pad[String(b.aspect)] || pad['16:9'], borderRadius: Math.max(10, theme.radius - 8), overflow: 'hidden', background: theme.surfaceElevated, boxShadow: `inset 0 0 0 1px ${theme.border}` }}>
          <img src={url} alt="" onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none'; }} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: b.fit === 'contain' ? 'contain' : 'cover' }} />
        </div>
      );
    }
    case 'cta_group': {
      const buttons = Array.isArray(b.buttons) ? b.buttons.filter((x: any) => String(x?.label || '').trim()) : [];
      if (!buttons.length) return null;
      const stack = b.layout !== 'inline';
      return (
        <div key={i} style={{ display: 'flex', flexDirection: stack ? 'column' : 'row', gap: 8, flexWrap: 'wrap' }}>
          {buttons.slice(0, 3).map((btn: any, j: number) => {
            const style = btn.style || (j === 0 ? 'primary' : 'secondary');
            const isPrimary = style === 'primary';
            const isGhost = style === 'ghost';
            const isTertiary = style === 'tertiary';
            return (
              <div key={j} style={{
                padding: isGhost ? '9px 11px' : '13px 20px', borderRadius: 14, fontSize: 14, fontWeight: isPrimary ? 800 : 700,
                letterSpacing: '-0.01em',
                textAlign: 'center', width: stack ? '100%' : 'auto', whiteSpace: 'nowrap', boxSizing: 'border-box',
                border: isTertiary ? `1px solid ${theme.border}` : 'none',
                background: isPrimary ? `linear-gradient(180deg, ${shadeHex(theme.accent, 6)} 0%, ${shadeHex(theme.accent, -12)} 100%)` : isGhost ? 'transparent' : theme.surfaceElevated,
                color: isPrimary ? theme.accentText : isGhost ? theme.accent : theme.textPrimary,
                boxShadow: isPrimary
                  ? `0 1px 2px ${withAlpha(shadeHex(theme.accent, -40), 0.3)}, 0 8px 22px ${withAlpha(theme.accent, 0.38)}, inset 0 1px 0 rgba(255,255,255,0.18)`
                  : isTertiary ? 'none' : `inset 0 0 0 1px ${theme.border}`,
              }}>
                {t(btn.label)}
              </div>
            );
          })}
        </div>
      );
    }
    case 'footer': {
      const text = t(b.text).trim();
      if (!text) return null;
      return <div key={i} style={{ fontSize: 11, fontWeight: 500, lineHeight: 1.5, color: withAlpha(theme.textSecondary, 0.85) }}>{text}</div>;
    }
    default:
      return null;
  }
}

export function BlockPreview({ blocks, theme, replaceVars, isAd }: {
  blocks: any[];
  theme: InAppTheme;
  replaceVars?: (t: string) => string;
  isAd?: boolean;
}) {
  const ctx: Ctx = { theme, replaceVars: replaceVars || ((s: string) => s) };
  const list = Array.isArray(blocks) ? blocks : [];
  const hasFooter = list.some((b) => b?.type === 'footer');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 13, color: theme.textPrimary, fontFamily: FONT_STACK, letterSpacing: '-0.005em' }}>
      {list.map((b, i) => renderBlock(b, i, ctx)).filter(Boolean)}
      {isAd && !hasFooter && (
        <div style={{ fontSize: 11, fontWeight: 500, color: withAlpha(theme.textSecondary, 0.85) }}>(광고)</div>
      )}
    </div>
  );
}
