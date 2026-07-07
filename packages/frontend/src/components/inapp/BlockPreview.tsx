/**
 * BlockPreview — content_blocks를 미리보기로 렌더 (D230+ 2026-06-27)
 *
 * SDK inapp-blocks.ts와 톤 1:1 정합 (테마 토큰 공용 — blockTheme.ts).
 * 미리보기는 정적 표현 — 클릭/카운트다운 틱 없이 형태·내용만.
 */

import { useEffect, useState, type CSSProperties } from 'react';
import type { InAppTheme, CardLayoutPlan } from './blockTheme';
import { withAlpha, shadeHex, pickReadableText, planCardLayout, normalizeCardStyle } from './blockTheme';

// 2026-07-07 디자인 2.0 — SDK inapp-blocks FONT_STACK 미러
const FONT_STACK = '"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';

export const ICON_PATHS: Record<string, string> = {
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

export function Icon({ name, color, size = 16, fill = false }: { name: string; color: string; size?: number; fill?: boolean }) {
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
  /** ★ 2026-07-07(5) 형태 골격 — SDK BlockRenderContext.cardStyle 미러 */
  cardStyle?: string;
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
      // ★ 2026-07-07(5) 형태 골격 — 쿠폰 티켓: 칩 없이 자간 넓은 accent 인장 라벨 (SDK 미러)
      if (tone === 'accent' && ctx.cardStyle === 'ticket') {
        return <div key={i} style={{ alignSelf: 'flex-start', fontSize: 11, fontWeight: 800, letterSpacing: '0.18em', color: theme.accent, lineHeight: 1.2 }}>{text}</div>;
      }
      // 디자인 언어 2.1 — plain(모노 에디토리얼): 칩 없이 자간 넓은 민무늬 라벨 (SDK 미러)
      if (tone === 'accent' && theme.eyebrowVariant === 'plain') {
        return <div key={i} style={{ alignSelf: 'flex-start', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.16em', color: theme.textSecondary, lineHeight: 1.2 }}>{text}</div>;
      }
      const solid = tone === 'accent' && theme.eyebrowVariant === 'chip_solid';
      const style: CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', color, alignSelf: 'flex-start', lineHeight: 1.2, display: 'inline-flex', alignItems: 'center', gap: 5 };
      if (solid) Object.assign(style, { background: theme.accent, color: theme.accentText, padding: '5px 11px', borderRadius: 999, boxShadow: `0 4px 12px ${withAlpha(theme.accent, 0.35)}` });
      else if (tone === 'accent') Object.assign(style, { background: theme.accentSoft, padding: '5px 11px', borderRadius: 999, boxShadow: `inset 0 0 0 1px ${withAlpha(theme.accent, 0.14)}` });
      return (
        <div key={i} style={style}>
          {tone === 'accent' && <span style={{ width: 4, height: 4, borderRadius: 999, background: solid ? theme.accentText : theme.accent, opacity: solid ? 0.9 : 1, flexShrink: 0 }} />}
          {text}
        </div>
      );
    }
    case 'headline': {
      const text = t(b.text).trim();
      if (!text) return null;
      // ★ 2026-07-07(5) 형태 골격 — bubble=채팅 스케일(한 단계 작게)·ticket=800 (SDK 미러)
      const bubble = ctx.cardStyle === 'bubble';
      const ticket = ctx.cardStyle === 'ticket';
      const hs: Record<string, number> = bubble ? { sm: 15, md: 17, lg: 19, xl: 21 } : { sm: 16, md: 19, lg: 21, xl: 24 };
      const xl = b.size === 'xl';
      const weight = bubble ? 700 : (ticket || xl) ? Math.max(800, theme.headlineWeight) : theme.headlineWeight;
      const head = (
        <div style={{ fontWeight: weight, fontSize: hs[String(b.size)] || (bubble ? 17 : 19), letterSpacing: xl || weight >= 800 ? '-0.02em' : '-0.01em', lineHeight: 1.28, color: theme.textPrimary }}>{text}</div>
      );
      if (!theme.headlineAccentBar || bubble) return <div key={i}>{head}</div>;
      // 브랜드 쇼케이스 — 헤드라인 아래 accent 짧은 바 (SDK 미러)
      return (
        <div key={i}>
          {head}
          <div style={{ width: 26, height: 4, borderRadius: 999, marginTop: 9, background: `linear-gradient(90deg, ${theme.accent} 0%, ${shadeHex(theme.accent, 30)} 100%)` }} />
        </div>
      );
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
      const mono = theme.bulletVariant === 'mono';
      return (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: mono ? 9 : 8 }}>
          {items.slice(0, 4).map((it: any, j: number) => (
            <div key={j} style={{ display: 'flex', alignItems: 'flex-start', gap: mono ? 9 : 8 }}>
              {mono ? (
                <span style={{ marginTop: 2, flexShrink: 0, display: 'inline-flex' }}>
                  <Icon name={it.icon || 'check'} color={theme.textPrimary} size={14} />
                </span>
              ) : (
                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18, borderRadius: 999, background: withAlpha(theme.accent, 0.14), marginTop: 1, flexShrink: 0 }}>
                  <Icon name={it.icon || 'check'} color={theme.accent} size={12} />
                </span>
              )}
              <div style={{ fontSize: 13, lineHeight: 1.45, color: theme.textPrimary }}>{t(it.text)}</div>
            </div>
          ))}
        </div>
      );
    }
    case 'benefit': {
      const text = t(b.text || '[혜택 안내 — 직접 작성해주세요]');
      // ★ 2026-07-07(5) 형태 골격 — 쿠폰 티켓 카드: 점선 박스 중첩 대신 대형 혜택 타이포 (SDK 미러)
      if (ctx.cardStyle === 'ticket') {
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '15px 16px', borderRadius: theme.innerRadius, background: theme.accentSoft, color: theme.textPrimary }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 38, height: 38, borderRadius: 12, background: theme.accent, flexShrink: 0 }}>
              <Icon name="gift" color={theme.accentText} size={20} />
            </span>
            <div style={{ fontSize: 16.5, fontWeight: 800, lineHeight: 1.35, letterSpacing: '-0.02em', color: theme.textPrimary, minWidth: 0 }}>{text}</div>
          </div>
        );
      }
      const notch: CSSProperties = { position: 'absolute', top: '50%', transform: 'translateY(-50%)', width: 13, height: 13, borderRadius: 999, background: theme.surface, boxShadow: `inset 0 0 0 1.5px ${withAlpha(theme.accent, 0.28)}` };
      return (
        <div key={i} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 11, padding: '13px 18px 13px 14px', background: `linear-gradient(135deg, ${withAlpha(theme.accent, 0.09)} 0%, ${withAlpha(theme.accent, 0.16)} 100%)`, border: `1.5px dashed ${withAlpha(theme.accent, 0.45)}`, borderRadius: theme.innerRadius }}>
          <span style={{ ...notch, left: -8 }} />
          <span style={{ ...notch, right: -8 }} />
          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 10, background: theme.accentSoft, flexShrink: 0 }}>
            <Icon name="gift" color={theme.accent} size={18} />
          </span>
          <div style={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.4, letterSpacing: '-0.01em', color: theme.textPrimary, minWidth: 0 }}>{text}</div>
        </div>
      );
    }
    case 'countdown':
      // 2026-07-07(2) — 고정 목업(23:59:59) 폐기: 실제 마감 시각 기준 실시간 계산 (SDK 산식 1:1)
      return <CountdownLive key={i} b={b} theme={theme} t={t} />;
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
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 11, borderRadius: theme.innerRadius + 2, background: theme.surfaceElevated, border: `1px solid ${theme.border}`, boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
          {b.image && <img src={b.image} alt="" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} style={{ width: 56, height: 56, borderRadius: 12, objectFit: 'cover', flexShrink: 0, boxShadow: `inset 0 0 0 1px ${theme.border}` }} />}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-0.01em', color: theme.textPrimary, lineHeight: 1.3 }}>{name}</div>
            {b.meta && <div style={{ fontSize: 12, color: theme.textSecondary, marginTop: 2 }}>{t(b.meta)}</div>}
          </div>
        </div>
      );
    }
    case 'divider':
      return <div key={i} style={{ height: 1, width: '100%', background: theme.dividerVariant === 'solid' ? theme.border : `linear-gradient(90deg, transparent 0%, ${theme.border} 18%, ${theme.border} 82%, transparent 100%)` }} />;
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
      // ★ 2026-07-07(5) 형태 골격 — 둥근 말풍선: 전폭 버튼 대신 채팅 답장 칩 (SDK 미러)
      if (ctx.cardStyle === 'bubble') {
        return (
          <div key={i} style={{ display: 'flex', flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {buttons.slice(0, 3).map((btn: any, j: number) => {
              const style = btn.style || (j === 0 ? 'primary' : 'secondary');
              const isPrimary = style === 'primary';
              return (
                <div key={j} style={{
                  padding: '11px 18px', borderRadius: 999, fontSize: 13.5, fontWeight: isPrimary ? 800 : 700,
                  letterSpacing: '-0.01em', whiteSpace: 'nowrap', textAlign: 'center', width: 'auto', boxSizing: 'border-box',
                  background: isPrimary ? theme.accent : 'transparent',
                  color: isPrimary ? theme.accentText : theme.accent,
                  boxShadow: isPrimary ? `0 4px 14px ${withAlpha(theme.accent, 0.35)}` : `inset 0 0 0 1.5px ${withAlpha(theme.accent, 0.45)}`,
                }}>
                  {t(btn.label)}
                </div>
              );
            })}
          </div>
        );
      }
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
                padding: isGhost ? '9px 11px' : theme.buttonRadius >= 999 ? '13px 22px' : '13px 20px',
                borderRadius: theme.buttonRadius, fontSize: 14, fontWeight: isPrimary ? 800 : 700,
                letterSpacing: '-0.01em',
                textAlign: 'center', width: stack ? '100%' : 'auto', whiteSpace: 'nowrap', boxSizing: 'border-box',
                border: isTertiary ? `1px solid ${theme.border}` : 'none',
                background: isPrimary ? theme.buttonPrimaryBg : isGhost ? 'transparent' : theme.surfaceElevated,
                color: isPrimary ? theme.buttonPrimaryText : isGhost ? theme.buttonGhostColor : theme.textPrimary,
                boxShadow: isPrimary ? theme.buttonPrimaryShadow : isTertiary ? 'none' : `inset 0 0 0 1px ${theme.border}`,
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

/** 카운트다운 실시간 미리보기 — SDK renderCountdown 산식 1:1 (1일+ = "N일 H시간" / 1시간 미만 = accent 경고 / 마감 후 숨김) */
function CountdownLive({ b, theme, t }: { b: any; theme: InAppTheme; t: (s: any) => string }) {
  const endMs = Date.parse(String(b?.ends_at || ''));
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isFinite(endMs) || endMs - Date.now() <= 0) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [endMs]);
  if (!isFinite(endMs)) {
    // 마감 시각 미설정 — 자사몰에선 표시 안 됨(SDK skip). 편집자에게만 안내.
    return (
      <div style={{ fontSize: 11, color: theme.textSecondary, padding: '9px 12px', borderRadius: theme.innerRadius, background: theme.surfaceElevated, boxShadow: `inset 0 0 0 1px ${theme.border}` }}>
        마감 시각을 설정하면 카운트다운이 표시됩니다
      </div>
    );
  }
  const remain = endMs - now;
  if (remain <= 0) return null; // SDK와 동일 — 마감 지나면 숨김
  const s = Math.floor(remain / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const urgent = remain < 3600 * 1000;
  const segStyle: CSSProperties = { minWidth: 26, padding: '3px 5px', textAlign: 'center', borderRadius: 7, background: urgent ? theme.accentSoft : withAlpha(theme.textPrimary, 0.06), fontSize: 13.5, fontWeight: 800, fontVariantNumeric: 'tabular-nums', letterSpacing: '0.01em', color: urgent ? theme.accent : theme.textPrimary, lineHeight: 1.2 };
  const seg = (txt: string): JSX.Element => <span style={segStyle}>{txt}</span>;
  const colon: CSSProperties = { fontSize: 12, fontWeight: 700, color: theme.textSecondary };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '11px 13px', borderRadius: theme.innerRadius, background: theme.surfaceElevated, boxShadow: `inset 0 0 0 1px ${theme.border}` }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 9, background: theme.accentSoft, flexShrink: 0 }}>
        <Icon name="clock" color={theme.accent} size={15} />
      </span>
      {b.label && <span style={{ fontSize: 12, fontWeight: 500, color: theme.textSecondary }}>{t(b.label)}</span>}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginLeft: 'auto' }}>
        {d > 0 ? (
          <span style={{ fontSize: 14, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: theme.textPrimary }}>{d}일 {h}시간</span>
        ) : (
          <>
            {seg(String(h).padStart(2, '0'))}<span style={colon}>:</span>
            {seg(String(m).padStart(2, '0'))}<span style={colon}>:</span>
            {seg(String(sec).padStart(2, '0'))}
          </>
        )}
      </span>
    </div>
  );
}

/** poster 히어로 — SDK renderPosterHero 미러 (이미지+스크림+겹침 텍스트 / 무이미지=강조색 면)
 *  ★ 2026-07-07(5) fullBleed — 카드 가장자리까지 확장(모서리 0)·히어로 확대·매거진 대형 헤드라인 (SDK 미러) */
function PosterHero({ plan, theme, t, fullBleed }: { plan: CardLayoutPlan; theme: InAppTheme; t: (s: any) => string; fullBleed?: boolean }) {
  const onHero = plan.hero ? '#ffffff' : pickReadableText(theme.accent);
  return (
    <div style={{ position: 'relative', width: '100%', minHeight: fullBleed ? 170 : 136, borderRadius: fullBleed ? 0 : Math.max(12, theme.radius - 8), overflow: 'hidden', display: 'flex', alignItems: 'flex-end', background: plan.hero ? theme.surfaceElevated : `linear-gradient(135deg, ${shadeHex(theme.accent, 10)} 0%, ${theme.accent} 55%, ${shadeHex(theme.accent, -25)} 100%)` }}>
      {plan.hero && (
        <>
          <img src={String(plan.hero.url || '')} alt="" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.02) 30%, rgba(0,0,0,0.58) 100%)' }} />
        </>
      )}
      <div style={{ position: 'relative', padding: fullBleed ? '20px 22px 16px' : '18px 18px 16px', display: 'flex', flexDirection: 'column', gap: 7, width: '100%', boxSizing: 'border-box' }}>
        {plan.overlay.map((ob: any, j: number) => {
          const txt = t(ob.text).trim();
          if (!txt) return null;
          return ob.type === 'eyebrow' ? (
            <div key={j} style={{ alignSelf: 'flex-start', fontSize: fullBleed ? 11 : 10.5, fontWeight: 800, letterSpacing: fullBleed ? '0.2em' : '0.14em', color: onHero, opacity: 0.88, lineHeight: 1.2 }}>{txt}</div>
          ) : (
            <div key={j} style={{ fontSize: fullBleed ? 24 : 22, fontWeight: 800, letterSpacing: fullBleed ? '-0.03em' : '-0.02em', lineHeight: fullBleed ? 1.18 : 1.22, color: onHero, textShadow: plan.hero ? '0 2px 12px rgba(0,0,0,0.35)' : 'none' }}>{txt}</div>
          );
        })}
      </div>
    </div>
  );
}

/** ticket 절취선 — SDK renderTicketPerforation 미러 (점선 + 양측 펀치홀)
 *  ★ 2026-07-07(5) fullBleed — 카드 가장자리 다이컷 노치(반원 절단)로 확대 (SDK 미러) */
function TicketPerforation({ theme, fullBleed }: { theme: InAppTheme; fullBleed?: boolean }) {
  const size = fullBleed ? 18 : 16;
  const hole = (side: 'left' | 'right'): CSSProperties => ({
    position: 'absolute', top: '50%', transform: 'translateY(-50%)', [side]: fullBleed ? -9 : -6,
    width: size, height: size, borderRadius: 999,
    background: fullBleed ? shadeHex(theme.surface, -12) : theme.surfaceElevated,
    boxShadow: fullBleed
      ? `inset 0 2px 4px rgba(0,0,0,0.18), inset 0 0 0 1px ${theme.border}`
      : `inset 0 1px 3px rgba(0,0,0,0.12), inset 0 0 0 1px ${theme.border}`,
  });
  return (
    <div style={{ position: 'relative', height: fullBleed ? 24 : 22, display: 'flex', alignItems: 'center' }}>
      <span style={hole('left')} />
      <div style={{ flex: 1, margin: fullBleed ? '0 20px' : '0 16px', borderTop: `2px dashed ${withAlpha(theme.textPrimary, 0.16)}` }} />
      <span style={hole('right')} />
    </div>
  );
}

/** ★ 2026-07-07(5) bubble 발신자 행 — SDK renderBubbleSender 미러 (브랜드 그라데이션 아바타 + 라벨) */
function BubbleSender({ text, theme }: { text: string; theme: InAppTheme }) {
  if (!text) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 999, flexShrink: 0, background: `linear-gradient(135deg, ${theme.accent} 0%, ${shadeHex(theme.accent, -18)} 100%)`, boxShadow: `0 3px 8px ${withAlpha(theme.accent, 0.35)}` }}>
        <Icon name="sparkle" color={theme.accentText} size={15} />
      </span>
      <div style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: '-0.01em', color: theme.textPrimary, minWidth: 0 }}>{text}</div>
    </div>
  );
}

export function BlockPreview({ blocks, theme, replaceVars, isAd, cardStyle, zonePads }: {
  blocks: any[];
  theme: InAppTheme;
  replaceVars?: (t: string) => string;
  isAd?: boolean;
  /** 형태 축 — classic/bubble/ticket/poster (카드형 템플릿에서만 전달) */
  cardStyle?: string | null;
  /** ★ 2026-07-07(5) ticket/poster 존 분할 시 구간별 패딩 (미전달 = 기존 인셋 렌더) — SDK ZONE_PADS 미러 */
  zonePads?: { main: string; stub: string; body: string } | null;
}) {
  const style = normalizeCardStyle(cardStyle);
  const ctx: Ctx = { theme, replaceVars: replaceVars || ((s: string) => s), cardStyle: style };
  const list = Array.isArray(blocks) ? blocks : [];
  const hasFooter = list.some((b) => b?.type === 'footer');
  const plan = planCardLayout(list, style);
  const t = ctx.replaceVars as (s: any) => string;

  const posterOn = style === 'poster' && (plan.hero || plan.overlay.length > 0);
  const ticketOn = style === 'ticket' && plan.stub.length > 0;
  const zoned = !!zonePads && (posterOn || ticketOn);
  const zoneStyle = (pad: string): CSSProperties => ({ display: 'flex', flexDirection: 'column', gap: 13, padding: pad, minWidth: 0, boxSizing: 'border-box' });
  const adLine = isAd && !hasFooter
    ? <div style={{ fontSize: 11, fontWeight: 500, color: withAlpha(theme.textSecondary, 0.85) }}>(광고)</div>
    : null;

  const body = posterOn ? (
    <>
      <PosterHero plan={plan} theme={theme} t={(s) => t(String(s ?? ''))} fullBleed={zoned} />
      {zoned ? (
        <div style={zoneStyle(zonePads!.body)}>
          {plan.main.map((b, i) => renderBlock(b, i, ctx)).filter(Boolean)}
          {adLine}
        </div>
      ) : (
        plan.main.map((b, i) => renderBlock(b, i, ctx)).filter(Boolean)
      )}
    </>
  ) : ticketOn ? (
    zoned ? (
      <>
        <div style={zoneStyle(zonePads!.main)}>{plan.main.map((b, i) => renderBlock(b, i, ctx)).filter(Boolean)}</div>
        <div style={{ background: withAlpha(theme.accent, 0.06) }}>
          <TicketPerforation theme={theme} fullBleed />
          <div style={zoneStyle(zonePads!.stub)}>
            {plan.stub.map((b, i) => renderBlock(b, i + plan.main.length + 1, ctx)).filter(Boolean)}
            {adLine}
          </div>
        </div>
      </>
    ) : (
      <>
        {plan.main.map((b, i) => renderBlock(b, i, ctx)).filter(Boolean)}
        <TicketPerforation theme={theme} />
        {plan.stub.map((b, i) => renderBlock(b, i + plan.main.length + 1, ctx)).filter(Boolean)}
      </>
    )
  ) : style === 'bubble' && plan.sender ? (
    <>
      <BubbleSender text={t(String(plan.sender.text ?? '')).trim()} theme={theme} />
      {plan.main.map((b, i) => renderBlock(b, i, ctx)).filter(Boolean)}
    </>
  ) : (
    <>{list.map((b, i) => renderBlock(b, i, ctx)).filter(Boolean)}</>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: zoned ? 0 : 13, color: theme.textPrimary, fontFamily: FONT_STACK, letterSpacing: '-0.005em' }}>
      {body}
      {!zoned && adLine}
    </div>
  );
}
