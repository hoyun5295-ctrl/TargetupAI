/**
 * BlockPreview — content_blocks를 미리보기로 렌더 (D230+ 2026-06-27)
 *
 * SDK inapp-blocks.ts와 톤 1:1 정합 (테마 토큰 공용 — blockTheme.ts).
 * 미리보기는 정적 표현 — 클릭/카운트다운 틱 없이 형태·내용만.
 */

import type { CSSProperties } from 'react';
import type { InAppTheme } from './blockTheme';
import { withAlpha } from './blockTheme';

const FONT_STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

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
      const style: CSSProperties = { fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', color, alignSelf: 'flex-start', lineHeight: 1.2 };
      if (tone === 'accent') Object.assign(style, { background: withAlpha(theme.accent, 0.12), padding: '4px 10px', borderRadius: 999, display: 'inline-flex' });
      return <div key={i} style={style}>{text}</div>;
    }
    case 'headline': {
      const text = t(b.text).trim();
      if (!text) return null;
      const xl = b.size === 'xl';
      return <div key={i} style={{ fontWeight: 600, fontSize: xl ? 22 : 18, letterSpacing: xl ? '-0.01em' : '-0.005em', lineHeight: 1.3, color: theme.textPrimary }}>{text}</div>;
    }
    case 'body': {
      const text = t(b.text);
      if (!text.trim()) return null;
      return <div key={i} style={{ fontSize: 13.5, lineHeight: 1.55, color: theme.textSecondary, whiteSpace: 'pre-wrap' }}>{text}</div>;
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
      return (
        <div key={i} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: withAlpha(theme.accent, 0.1), border: `1px dashed ${withAlpha(theme.accent, 0.5)}`, borderRadius: 12 }}>
          <span style={{ position: 'absolute', left: -7, top: '50%', transform: 'translateY(-50%)', width: 12, height: 12, borderRadius: 999, background: theme.surface }} />
          <Icon name="gift" color={theme.accent} size={20} />
          <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.4, color: theme.textPrimary, minWidth: 0 }}>{text}</div>
        </div>
      );
    }
    case 'countdown': {
      return (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 12, background: theme.surfaceElevated }}>
          <Icon name="clock" color={theme.accent} size={16} />
          {b.label && <span style={{ fontSize: 12, color: theme.textSecondary }}>{t(b.label)}</span>}
          <span style={{ fontSize: 14, fontWeight: 700, color: theme.textPrimary, fontVariantNumeric: 'tabular-nums' }}>23:59:59</span>
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
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 10, borderRadius: 14, background: theme.surfaceElevated, border: `1px solid ${theme.border}` }}>
          {b.image && <img src={b.image} alt="" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} style={{ width: 52, height: 52, borderRadius: 10, objectFit: 'cover', flexShrink: 0 }} />}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: theme.textPrimary, lineHeight: 1.3 }}>{name}</div>
            {b.meta && <div style={{ fontSize: 12, color: theme.textSecondary, marginTop: 2 }}>{t(b.meta)}</div>}
          </div>
        </div>
      );
    }
    case 'divider':
      return <div key={i} style={{ height: 1, width: '100%', background: theme.border }} />;
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
        <div key={i} style={{ position: 'relative', width: '100%', paddingTop: pad[String(b.aspect)] || pad['16:9'], borderRadius: Math.max(10, theme.radius - 8), overflow: 'hidden', background: theme.surfaceElevated }}>
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
                padding: isGhost ? '8px 10px' : '11px 18px', borderRadius: 12, fontSize: 13.5, fontWeight: isPrimary ? 700 : 600,
                textAlign: 'center', width: stack ? '100%' : 'auto', whiteSpace: 'nowrap', boxSizing: 'border-box',
                border: isTertiary ? `1px solid ${theme.border}` : 'none',
                background: isPrimary ? theme.accent : isGhost ? 'transparent' : theme.surfaceElevated,
                color: isPrimary ? theme.accentText : isGhost ? theme.accent : theme.textPrimary,
                boxShadow: isPrimary ? `0 6px 18px ${withAlpha(theme.accent, 0.32)}` : 'none',
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, color: theme.textPrimary, fontFamily: FONT_STACK }}>
      {list.map((b, i) => renderBlock(b, i, ctx)).filter(Boolean)}
      {isAd && !hasFooter && (
        <div style={{ fontSize: 11, fontWeight: 500, color: withAlpha(theme.textSecondary, 0.85) }}>(광고)</div>
      )}
    </div>
  );
}
