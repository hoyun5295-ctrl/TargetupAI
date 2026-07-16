/**
 * InAppMessagePreview.tsx — 인앱 메시지 실시간 미리보기 (브레이즈급)
 *
 * 디바이스 프레임(브라우저/모바일) 안에 선택한 template을 실제 위치·모양 그대로 렌더.
 * SDK inapp.ts 렌더 톤(둥근/그림자/말줄임/CTA/이미지 절대화)과 1:1 정합.
 */

import { useEffect, useState, type CSSProperties } from 'react';
import { Monitor, Smartphone, Sun, Moon } from 'lucide-react';
import {
  resolveTheme, normalizeCardStyle, planCardLayout, resolveInAppTreatment, inappGoogleFontsUrl, safeFontFamily,
  type InAppTheme, type InAppTreatment,
} from './inapp/blockTheme';
import { BlockPreview } from './inapp/BlockPreview';

// ★ 2026-07-07(5) 형태 골격 — ticket(2톤)/poster(풀블리드) 존 분할 시 구간별 패딩.
//   SDK ZONE_PADS 미러 (미리보기 축소 스케일에 맞춰 비례 축소).
const PREVIEW_ZONE_PADS: Record<string, { main: string; stub: string; body: string }> = {
  modal: { main: '20px 22px 14px', stub: '13px 22px 18px', body: '16px 22px 22px' },
  slide: { main: '15px 17px 11px', stub: '10px 17px 14px', body: '12px 17px 17px' },
  inline: { main: '16px 18px 12px', stub: '11px 18px 15px', body: '13px 18px 18px' },
};

export interface PreviewButton {
  label: string;
  style?: 'primary' | 'secondary' | 'tertiary';
  background_color?: string;
  text_color?: string;
}

export interface InAppMessagePreviewProps {
  template: string;
  title: string;
  body: string;
  imageUrl?: string | null;
  badge?: string | null;
  buttons?: PreviewButton[];
  backgroundColor: string;
  textColor: string;
  // ★ D230+ 블록 + 테마 — 있으면 블록 렌더(parity), 없으면 기존 title/body 렌더
  blocks?: any[] | null;
  theme?: string | null;
  accentColor?: string | null;
  isAd?: boolean;
  replaceVars?: (t: string) => string;
  /** ★ 2026-07-07(2) 형태 축 — classic/bubble/ticket/poster (SDK 렌더 1:1) */
  cardStyle?: string | null;
  /** ★ 2026-07-14 디자인 3.0 — design jsonb (font_display/treatment/motion/backdrop — SDK 소비 1:1 미러. 모션은 정적 미리보기라 미표현) */
  design?: Record<string, any> | null;
}

/** 미리보기는 관리자 화면 = 백엔드와 같은 도메인. 상대경로(/api/..., /uploads/...)를 그대로 둬 현재 origin으로 로드한다.
 *  절대 도메인 하드코딩은 운영 도메인이 다를 때 미리보기만 404를 유발하므로 쓰지 않는다(썸네일은 상대경로라 정상). */
function toAbsoluteImage(url?: string | null): string | undefined {
  return url || undefined;
}

type Variant = 'banner' | 'modal' | 'slide' | 'toast' | 'inline' | 'full' | 'floating';

const VARIANT_MAP: Record<string, Variant> = {
  top_banner: 'banner', bottom_banner: 'banner',
  center_modal: 'modal', full_screen: 'full',
  slide_in: 'slide', inline_card: 'inline',
  toast: 'toast', floating_button: 'floating',
};

function hideOnError(e: React.SyntheticEvent<HTMLImageElement>) {
  (e.currentTarget as HTMLImageElement).style.display = 'none';
}

/** 인앱 카드 내부 (이미지+제목+본문+CTA) — SDK 렌더 톤 일치 */
function CardInner({ title, body, imageUrl, badge, buttons, textColor, variant, design }: {
  title: string; body: string; imageUrl?: string | null; badge?: string | null; buttons?: PreviewButton[]; textColor: string; variant: Variant; design?: Record<string, any> | null;
}) {
  const img = toAbsoluteImage(imageUrl);
  const clampMap: Record<Variant, number> = { banner: 2, slide: 4, inline: 5, modal: 3, full: 10, toast: 2, floating: 1 };
  const clamp = clampMap[variant];
  const isBanner = variant === 'banner';
  const bigTitle = variant === 'full' ? 19 : (isBanner || variant === 'toast') ? 13.5 : 15.5;
  // ★ 2026-07-17 텍스트 정렬 (design.text_align) — SDK 렌더 미러. 미지정=왼쪽
  const textAlign: 'left' | 'center' | 'right' = design?.text_align === 'center' ? 'center' : design?.text_align === 'right' ? 'right' : 'left';

  return (
    <div style={{ display: 'flex', flexDirection: isBanner ? 'row' : 'column', alignItems: isBanner ? 'center' : 'stretch', gap: isBanner ? 12 : 0, color: textColor, width: '100%' }}>
      {img && isBanner && (
        <img src={img} alt="" onError={hideOnError} style={{ width: 42, height: 42, objectFit: 'cover', borderRadius: 11, flexShrink: 0 }} />
      )}
      {img && !isBanner && variant !== 'toast' && variant !== 'floating' && (
        <img src={img} alt="" onError={hideOnError} style={{ width: '100%', height: variant === 'modal' || variant === 'full' ? 128 : 100, objectFit: 'cover', borderRadius: 13, marginBottom: 13, boxShadow: '0 4px 16px rgba(0,0,0,0.14)' }} />
      )}
      <div style={{ flex: isBanner ? 1 : undefined, minWidth: 0, textAlign }}>
        {badge && !isBanner && variant !== 'toast' && variant !== 'floating' && (
          <div style={{ display: 'inline-block', background: 'rgba(255,255,255,0.2)', color: textColor, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.03em', padding: '3px 9px', borderRadius: 999, marginBottom: 8 }}>
            {badge}
          </div>
        )}
        <div style={{ fontWeight: 700, fontSize: bigTitle, letterSpacing: '-0.01em', lineHeight: 1.35, marginBottom: 5 }}>
          {title || '제목 미리보기'}
        </div>
        <div style={{ fontSize: variant === 'toast' ? 11.5 : 12.5, opacity: 0.84, lineHeight: 1.5, whiteSpace: 'pre-wrap', display: '-webkit-box', WebkitLineClamp: clamp, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {body || '본문 미리보기'}
        </div>
        {buttons && buttons.length > 0 && variant !== 'toast' && (() => {
          const stackBtn = variant === 'modal' || variant === 'full';
          return (
            <div style={{ display: 'flex', flexDirection: stackBtn ? 'column' : 'row', gap: 7, marginTop: isBanner ? 0 : 13, flexWrap: 'wrap' }}>
              {buttons.slice(0, 3).map((b, i) => {
                const primary = (b.style || 'primary') === 'primary';
                const tertiary = b.style === 'tertiary';
                return (
                  <div key={i} style={{
                    background: b.background_color || (primary ? '#4f46e5' : 'rgba(255,255,255,0.18)'),
                    color: b.text_color || textColor,
                    border: tertiary ? '1px solid rgba(255,255,255,0.35)' : 'none',
                    padding: stackBtn ? '9px 15px' : '7px 15px', borderRadius: 9, fontSize: 12, fontWeight: primary ? 700 : 600,
                    width: stackBtn ? '100%' : 'auto', textAlign: 'center', boxSizing: 'border-box',
                    boxShadow: primary ? '0 4px 12px rgba(0,0,0,0.2)' : 'none', whiteSpace: 'nowrap',
                  }}>
                    {b.label || '버튼'}
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>
      {isBanner && (
        <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'rgba(255,255,255,0.16)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, flexShrink: 0, opacity: 0.7 }}>✕</div>
      )}
    </div>
  );
}

/** template별 위치 + 카드 모양 오버레이 (블록 있으면 테마 토큰으로 BlockPreview) */
function Overlay({ variant, themeTokens, treatment, ...rest }: { variant: Variant; themeTokens?: InAppTheme | null; treatment?: InAppTreatment } & Omit<InAppMessagePreviewProps, 'template'>) {
  const { backgroundColor, textColor, blocks, replaceVars, isAd } = rest;
  const usingBlocks = !!(themeTokens && blocks && blocks.length > 0);
  // ★ 2026-07-07(2) 형태 축 — 카드형 variant에만 적용 (SDK와 동일 게이트)
  const cardish = variant === 'modal' || variant === 'slide' || variant === 'inline' || variant === 'full';
  const cardStyle = usingBlocks && cardish ? normalizeCardStyle(rest.cardStyle) : 'classic';
  // ★ 2026-07-14 디자인 3.0 — 서체 오버라이드(design.font_display) + 백드롭 딤/블러 (SDK 소비 미러)
  const displayFont = safeFontFamily(rest.design?.font_display, '') || undefined;
  const BACKDROP_DIM: Record<string, string> = { soft: 'rgba(8,10,18,0.38)', standard: 'rgba(8,10,18,0.55)', deep: 'rgba(8,10,18,0.72)' };
  const backdropDim = BACKDROP_DIM[String(rest.design?.backdrop?.dim || '')] || BACKDROP_DIM.standard;
  const backdropBlurOn = rest.design?.backdrop?.blur !== false;
  // ★ 2026-07-17 텍스트 정렬 (design.text_align) — SDK renderMessage가 루트 [data-hanjullo-msg]에 적용하는 것을 미러.
  //   블록(BlockPreview)·flat 공통으로 카드 루트에서 상속. 미지정/left = 스타일 자체를 안 얹어 현행 렌더 유지(회귀 0).
  const rootTextAlign = rest.design?.text_align === 'center' ? ('center' as const) : rest.design?.text_align === 'right' ? ('right' as const) : undefined;
  const bubble = cardStyle === 'bubble' && (variant === 'modal' || variant === 'slide' || variant === 'inline');
  const bubbleRadius = (small: 'bl' | 'br') => {
    const rr = themeTokens ? themeTokens.radius + 4 : 24;
    return small === 'bl' ? `${rr}px ${rr}px ${rr}px 14px` : `${rr}px ${rr}px 14px ${rr}px`;
  };
  const bubbleTail = (side: 'left' | 'right') => (
    <div style={{
      position: 'absolute', bottom: -9, [side]: 30, width: 20, height: 20,
      background: themeTokens?.surface || '#ffffff', transform: 'rotate(45deg)',
      borderRight: `1px solid ${themeTokens?.border || 'rgba(0,0,0,0.08)'}`,
      borderBottom: `1px solid ${themeTokens?.border || 'rgba(0,0,0,0.08)'}`,
      borderRadius: '0 0 5px 0',
    } as CSSProperties} />
  );
  // 2026-07-07 디자인 2.0 — SDK makeContainer 미러: 그라데이션 면(surfaceBg) + 링+3중 그림자 합성
  const cardBg = usingBlocks ? (themeTokens!.surfaceBg || themeTokens!.surface) : (backgroundColor || '#4f46e5');
  const cardShadow = usingBlocks ? `${themeTokens!.ring ? `${themeTokens!.ring}, ` : ''}${themeTokens!.shadow}` : undefined;
  // ★ 2026-07-07(5) 형태 골격 — 존 분할 여부 (SDK renderBlockMessage와 동일 판정)
  const plan = usingBlocks ? planCardLayout(blocks!, cardStyle) : null;
  const zonePads = PREVIEW_ZONE_PADS[variant as string];
  const zoned = !!plan && !!zonePads && (
    (cardStyle === 'poster' && (!!plan.hero || plan.overlay.length > 0)) ||
    (cardStyle === 'ticket' && plan.stub.length > 0)
  );
  const inner = usingBlocks
    ? <BlockPreview blocks={blocks!} theme={themeTokens!} replaceVars={replaceVars} isAd={isAd} cardStyle={cardish ? cardStyle : undefined} zonePads={zoned ? zonePads : undefined} treatment={cardish ? treatment : undefined} displayFont={displayFont} />
    : <CardInner {...rest} variant={variant} textColor={textColor} />;

  const cardBase: CSSProperties = {
    background: cardBg,
    position: 'absolute',
    fontFamily: '"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif',
    boxSizing: 'border-box',
    ...(rootTextAlign ? { textAlign: rootTextAlign } : {}),
    ...(usingBlocks ? { color: themeTokens!.textPrimary, border: `1px solid ${themeTokens!.border}` } : {}),
  };
  const r = (def: number) => (usingBlocks ? themeTokens!.radius : def);
  const sh = (def: string) => cardShadow || def;
  // ★ 2026-07-16 SDK appendOptOutLink 미러 — 토스트·플로팅 제외 전 표면에 "다시 보지 않기"(명시 거부) 노출
  const optOutHint = (
    <div style={{ textAlign: 'center', fontSize: 10, opacity: 0.45, textDecoration: 'underline dotted', textUnderlineOffset: 3, padding: '6px 0 2px' }}>다시 보지 않기</div>
  );

  if (variant === 'banner') {
    return <div style={{ ...cardBase, top: 0, left: 0, right: 0, padding: '13px 16px', boxShadow: '0 8px 28px rgba(0,0,0,0.18)' }}>{inner}{optOutHint}</div>;
  }
  if (variant === 'modal') {
    const heroImg = usingBlocks ? undefined : toAbsoluteImage(rest.imageUrl);
    return (
      <div style={{ position: 'absolute', inset: 0, background: backdropDim, ...(backdropBlurOn ? { backdropFilter: 'blur(10px) saturate(1.35)', WebkitBackdropFilter: 'blur(10px) saturate(1.35)' } : {}), display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 } as CSSProperties}>
        <div style={{ ...cardBase, position: 'relative', maxWidth: 330, width: '100%', maxHeight: '92%', display: 'flex', flexDirection: 'column', borderRadius: bubble ? bubbleRadius('bl') : r(20), overflow: bubble ? 'visible' : 'hidden', boxShadow: sh('0 24px 60px rgba(0,0,0,0.45)') }}>
          {heroImg && <img src={heroImg} alt="" onError={hideOnError} style={{ width: '100%', maxHeight: 130, objectFit: 'cover', display: 'block', flexShrink: 0 }} />}
          <div style={{ padding: zoned ? 0 : 22, overflowY: 'auto' }}>
            {usingBlocks ? inner : <CardInner {...rest} imageUrl={null} variant="modal" textColor={textColor} />}
            {optOutHint}
          </div>
          {bubble && bubbleTail('left')}
        </div>
      </div>
    );
  }
  if (variant === 'full') {
    return <div style={{ ...cardBase, inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: 24, overflowY: 'auto' }}>{inner}{optOutHint}</div>;
  }
  if (variant === 'slide') {
    return (
      <div style={{ ...cardBase, right: 16, bottom: 16, maxWidth: 236, maxHeight: '88%', overflowY: bubble ? 'visible' : 'auto', borderRadius: bubble ? bubbleRadius('br') : r(16), padding: zoned ? 0 : 17, overflow: zoned ? 'hidden' : undefined, boxShadow: sh('0 16px 40px rgba(0,0,0,0.3)') }}>
        {inner}
        {optOutHint}
        {bubble && bubbleTail('right')}
      </div>
    );
  }
  if (variant === 'toast') {
    return <div style={{ ...cardBase, top: 16, right: 16, maxWidth: 234, borderRadius: r(14), padding: '12px 14px', boxShadow: sh('0 8px 22px rgba(0,0,0,0.25)') }}>{inner}</div>;
  }
  if (variant === 'floating') {
    let label = rest.buttons?.[0]?.label || rest.title || '문의하기';
    if (usingBlocks) {
      const cg = (blocks || []).find((b: any) => b?.type === 'cta_group');
      const f = cg?.buttons?.[0];
      label = (f?.label) || rest.title || '문의하기';
    }
    if (replaceVars) label = replaceVars(label);
    return <div style={{ ...cardBase, right: 16, bottom: 16, borderRadius: 999, padding: '13px 21px', fontWeight: 800, letterSpacing: '-0.01em', fontSize: 13, color: usingBlocks ? themeTokens!.accentText : textColor, background: usingBlocks ? themeTokens!.accent : cardBg, border: 'none', boxShadow: '0 2px 6px rgba(0,0,0,0.18), 0 10px 26px rgba(0,0,0,0.3)' }}>{label}</div>;
  }
  // inline_card — 본문 흐름 안
  return (
    <div style={{ position: 'absolute', top: 64, left: 14, right: 14 }}>
      <div style={{ ...cardBase, position: 'relative', borderRadius: bubble ? bubbleRadius('bl') : r(15), padding: zoned ? 0 : 18, overflow: zoned ? 'hidden' : undefined, boxShadow: sh('0 6px 20px rgba(0,0,0,0.12)') }}>
        {inner}
        {optOutHint}
        {bubble && bubbleTail('left')}
      </div>
    </div>
  );
}

/** 더미 자사몰 배경 — 인앱이 뜨는 맥락 (라이트/다크 몰 양쪽) */
function DummySite({ dark }: { dark?: boolean }) {
  const bg = dark ? '#101218' : '#f4f4f6';
  const bar = dark ? '#171a22' : '#fff';
  const barBorder = dark ? '#232734' : '#ebebee';
  const chip = dark ? '#2b3040' : '#d6d6db';
  const dot = dark ? '#262b38' : '#e3e3e7';
  const card = dark ? '#171a22' : '#fff';
  const cardBorder = dark ? '#232734' : '#ededf1';
  return (
    <div style={{ position: 'absolute', inset: 0, background: bg, overflow: 'hidden' }}>
      <div style={{ height: 34, background: bar, borderBottom: `1px solid ${barBorder}`, display: 'flex', alignItems: 'center', padding: '0 14px', gap: 8 }}>
        <div style={{ width: 46, height: 9, borderRadius: 3, background: chip }} />
        <div style={{ flex: 1 }} />
        <div style={{ width: 9, height: 9, borderRadius: '50%', background: dot }} />
        <div style={{ width: 9, height: 9, borderRadius: '50%', background: dot }} />
      </div>
      <div style={{ padding: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ height: 58, borderRadius: 10, background: card, border: `1px solid ${cardBorder}` }} />
        ))}
      </div>
    </div>
  );
}

export function InAppMessagePreview(props: InAppMessagePreviewProps) {
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [siteMode, setSiteMode] = useState<'light' | 'dark'>('light');
  const variant = VARIANT_MAP[props.template] || 'banner';
  const isMobile = device === 'mobile';
  const useBlocks = Array.isArray(props.blocks) && props.blocks.length > 0;
  const siteDark = siteMode === 'dark';
  const themeTokens = useBlocks ? resolveTheme(props.theme, props.accentColor, siteDark) : null;
  // ★ 2026-07-14 디자인 3.0 — 구도(fail-closed) + 미리보기 서체 실로딩 (SDK ensureFontLink 미러 — 카탈로그 매칭 화이트리스트)
  const treatment = useBlocks ? resolveInAppTreatment(props.template, normalizeCardStyle(props.cardStyle), props.design?.treatment) : 'classic';
  const fontsUrl = inappGoogleFontsUrl(props.design?.font_display, themeTokens?.displayFont);
  useEffect(() => {
    if (!fontsUrl) return;
    if (document.querySelector(`link[data-hjl-fonts="${fontsUrl}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = fontsUrl;
    link.setAttribute('data-hjl-fonts', fontsUrl);
    document.head.appendChild(link);
    // 편집 화면 폰트 링크는 세션 내 재사용 — 제거하지 않음(중복 가드가 단일 유지)
  }, [fontsUrl]);

  return (
    <div>
      {/* 디바이스 + 자사몰 모드 토글 */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
        {(['desktop', 'mobile'] as const).map((d) => {
          const Icon = d === 'desktop' ? Monitor : Smartphone;
          const active = device === d;
          return (
            <button
              key={d}
              onClick={() => setDevice(d)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors ${active ? 'bg-violet-500/30 border border-violet-400/50 text-white' : 'bg-white/5 border border-white/10 text-white/50 hover:text-white/80'}`}
            >
              <Icon className="w-3.5 h-3.5" /> {d === 'desktop' ? '데스크탑' : '모바일'}
            </button>
          );
        })}
        <button
          onClick={() => setSiteMode(siteDark ? 'light' : 'dark')}
          title="자사몰 라이트/다크 모드로 보기 (자동 테마는 몰 모드를 따라갑니다)"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors ${siteDark ? 'bg-slate-500/30 border border-slate-400/50 text-white' : 'bg-white/5 border border-white/10 text-white/50 hover:text-white/80'}`}
        >
          {siteDark ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />} 몰 {siteDark ? '다크' : '라이트'}
        </button>
      </div>
      {props.theme === 'auto' && useBlocks && (
        <div className="text-[10px] text-white/40 text-center -mt-1 mb-2">자동 테마 = 고객 자사몰의 라이트/다크 모드를 따라갑니다 — 위 토글로 양쪽 확인</div>
      )}

      {/* 디바이스 프레임 */}
      <div className="mx-auto" style={{ width: isMobile ? 300 : '100%', maxWidth: isMobile ? 300 : 440, transition: 'width 0.2s ease' }}>
        <div style={{ borderRadius: isMobile ? 26 : 14, overflow: 'hidden', boxShadow: '0 14px 44px rgba(0,0,0,0.42)', border: '1px solid rgba(255,255,255,0.12)' }}>
          {/* 상단 바 */}
          <div style={{ height: 30, background: '#26262e', display: 'flex', alignItems: 'center', padding: '0 12px', gap: 6 }}>
            {isMobile ? (
              <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
                <div style={{ width: 54, height: 5, borderRadius: 3, background: '#45454f' }} />
              </div>
            ) : (
              <>
                <div style={{ width: 9, height: 9, borderRadius: '50%', background: '#ff5f57' }} />
                <div style={{ width: 9, height: 9, borderRadius: '50%', background: '#febc2e' }} />
                <div style={{ width: 9, height: 9, borderRadius: '50%', background: '#28c840' }} />
                <div style={{ flex: 1, marginLeft: 8 }}>
                  <div style={{ height: 16, borderRadius: 8, background: '#1b1b20', display: 'flex', alignItems: 'center', padding: '0 10px', fontSize: 10, color: '#6b6b75' }}>www.yoursite.com</div>
                </div>
              </>
            )}
          </div>
          {/* 콘텐츠 (더미 사이트 + 인앱 오버레이) */}
          <div style={{ position: 'relative', height: isMobile ? 580 : 540, overflow: 'hidden' }}>
            <DummySite dark={siteDark} />
            <Overlay variant={variant} themeTokens={themeTokens} treatment={treatment} {...props} />
          </div>
        </div>
      </div>

      <div className="text-[10px] text-white/30 italic mt-2.5 text-center">
        Data source — 선택한 형태·내용 그대로 자사몰에 표시됩니다
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// ★ 2026-07-16 앱 채널 미리보기 — 앱 실렌더(네이티브 바텀시트/중앙 모달) 1:1 미러
//   범용 보장 계약: 앱은 flat(이미지·배지·제목·본문·버튼)만 렌더 — 미리보기도 같은 요소만 그린다.
//   (미리보기가 실물과 다른 요소를 그리던 것이 "편집기 ≠ 앱" 사고의 표면 — 실렌더 미러 의무)
// ════════════════════════════════════════════════════════════════════

export interface AppInAppPreviewProps {
  template: string;
  title: string;
  body: string;
  imageUrl?: string | null;
  badge?: string | null;
  buttons?: Array<{ label: string; background_color?: string; text_color?: string }>;
  backgroundColor: string;
  textColor: string;
  design?: Record<string, any> | null;
}

/** 더미 앱 화면 — 인앱이 뜨는 맥락 (라이트 앱 리스트) */
function DummyAppScreen() {
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#f5f5f7', overflow: 'hidden' }}>
      <div style={{ height: 44, background: '#ffffff', borderBottom: '1px solid #ececf0', display: 'flex', alignItems: 'center', padding: '0 14px', gap: 8 }}>
        <div style={{ width: 58, height: 10, borderRadius: 3, background: '#d9d9de' }} />
        <div style={{ flex: 1 }} />
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#e4e4e8' }} />
      </div>
      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 9 }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} style={{ height: 62, borderRadius: 12, background: '#ffffff', border: '1px solid #ececf0', display: 'flex', alignItems: 'center', gap: 10, padding: '0 10px' }}>
            <div style={{ width: 44, height: 44, borderRadius: 9, background: '#ebebef', flexShrink: 0 }} />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div style={{ width: '62%', height: 8, borderRadius: 3, background: '#e2e2e7' }} />
              <div style={{ width: '38%', height: 7, borderRadius: 3, background: '#ececf0' }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AppInAppPreview({ template, title, body, imageUrl, badge, buttons, backgroundColor, textColor, design }: AppInAppPreviewProps) {
  const isModal = template === 'center_modal';
  const img = imageUrl || undefined;
  // ★ 2026-07-17 텍스트 정렬 (design.text_align) — SDK 렌더 미러. 미지정=왼쪽
  const ta: 'left' | 'center' | 'right' = design?.text_align === 'center' ? 'center' : design?.text_align === 'right' ? 'right' : 'left';
  const badgeSelf = ta === 'center' ? 'center' : ta === 'right' ? 'flex-end' : 'flex-start';
  const card = (
    <div style={{
      background: backgroundColor || '#1f1f29',
      color: textColor || '#ffffff',
      overflow: 'hidden',
      fontFamily: '"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif',
      ...(isModal
        ? { borderRadius: 22, margin: '0 18px', maxWidth: 420, width: 'calc(100% - 36px)' }
        : { borderTopLeftRadius: 24, borderTopRightRadius: 24, width: '100%', paddingBottom: 10 }),
    }}>
      {img && (
        <img src={img} alt="" onError={hideOnError} style={{ width: '100%', height: 150, objectFit: 'cover', display: 'block' }} />
      )}
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8, textAlign: ta }}>
        {badge ? (
          <div style={{ alignSelf: badgeSelf, background: 'rgba(255,255,255,0.18)', borderRadius: 999, padding: '3px 10px' }}>
            <span style={{ color: textColor, fontSize: 10.5, fontWeight: 700 }}>{badge}</span>
          </div>
        ) : null}
        <div style={{ fontSize: 17, fontWeight: 800, lineHeight: 1.35 }}>{title || '제목 미리보기'}</div>
        {body ? (
          <div style={{ fontSize: 13, lineHeight: 1.5, opacity: 0.82, whiteSpace: 'pre-wrap' }}>{body}</div>
        ) : null}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 6 }}>
          {(buttons || []).slice(0, 3).map((b, i) => (
            <div key={i} style={{ background: b.background_color || 'rgba(255,255,255,0.16)', borderRadius: 12, padding: '10px 0', textAlign: 'center' }}>
              <span style={{ color: b.text_color || '#ffffff', fontSize: 13.5, fontWeight: 700 }}>{b.label || '버튼'}</span>
            </div>
          ))}
          {/* 앱 실렌더 미러 — 다시 보지 않기(영구 거부) · 닫기(이번만) */}
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 22 }}>
            <span style={{ color: textColor, opacity: 0.45, fontSize: 12, textDecoration: 'underline', padding: '8px 0' }}>다시 보지 않기</span>
            <span style={{ color: textColor, opacity: 0.55, fontSize: 12, padding: '8px 0' }}>닫기</span>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div>
      <div className="mx-auto" style={{ width: 300 }}>
        <div style={{ borderRadius: 26, overflow: 'hidden', boxShadow: '0 14px 44px rgba(0,0,0,0.42)', border: '1px solid rgba(255,255,255,0.12)' }}>
          {/* 상단 바 (모바일 노치) */}
          <div style={{ height: 30, background: '#26262e', display: 'flex', alignItems: 'center', padding: '0 12px' }}>
            <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
              <div style={{ width: 54, height: 5, borderRadius: 3, background: '#45454f' }} />
            </div>
          </div>
          {/* 앱 화면 + 백드롭 + 시트/모달 */}
          <div style={{ position: 'relative', height: 580, overflow: 'hidden' }}>
            <DummyAppScreen />
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(10,10,15,0.6)', display: 'flex', flexDirection: 'column', justifyContent: isModal ? 'center' : 'flex-end', alignItems: 'center' }}>
              {card}
            </div>
          </div>
        </div>
      </div>
      <div className="text-[10px] text-white/30 italic mt-2.5 text-center">
        Data source — 앱 실렌더와 동일 요소(이미지·배지·제목·본문·버튼)만 표시 · 만든 그대로 앱에 뜹니다
      </div>
    </div>
  );
}
