/**
 * HeroSection — 히어로 (풀 배너 + 메인 헤드라인 + 서브카피)
 * 2026-07-09: 구도(treatment) 캔버스 미러 — 발행 SSR renderHero*(classic/typographic/full_bleed/split/editorial_overlap)와 동일.
 *   classic 경로는 기존 그대로(골든 보존). 비-classic 구도만 신규 분기.
 */
import type { CSSProperties } from 'react';
import type { HeroProps } from '../../../utils/dm-section-defaults';
import { dmImageUrl } from '../../../utils/dm-image-url';
import InlineEditable from './InlineEditable';
import type { EditHandler } from './SectionRenderer';

const HEIGHT_PX: Record<string, string> = { sm: '200px', md: '320px', lg: '480px', full: '100vh' };
const HEIGHT_PX_FULLBLEED: Record<string, string> = { sm: '240px', md: '380px', lg: '520px', full: '100vh' };
const FW_HERO = 'var(--dm-fw-hero)' as any; // CSS 변수 fontWeight — csstype 우회

export default function HeroSection({ props, onEdit, treatment }: { props: HeroProps; onEdit?: EditHandler; treatment?: string }) {
  const height = HEIGHT_PX[props.height || 'md'];
  const align = props.align || 'center';
  const textAlign = align as 'left' | 'center' | 'right';
  const justifyContent = align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center';
  // ★ 2026-07-13 디자인 3.0 이미지 스튜디오 — 오버레이 프리셋(미설정=overlay_gradient 하위호환)·초점·강조 (SSR heroOverlayCss/heroFocusCss 미러)
  const gradient = (() => {
    if (!props.overlay) {
      return props.overlay_gradient !== false ? 'linear-gradient(180deg,rgba(0,0,0,0) 40%,rgba(0,0,0,0.5) 100%)' : 'transparent';
    }
    switch (props.overlay) {
      case 'none':   return 'transparent';
      case 'soft':   return 'linear-gradient(180deg,rgba(0,0,0,0) 55%,rgba(0,0,0,0.32) 100%)';
      case 'strong': return 'linear-gradient(180deg,rgba(0,0,0,0.06) 0%,rgba(0,0,0,0.62) 100%)';
      case 'brand':  return 'linear-gradient(200deg, color-mix(in srgb, var(--dm-primary) 55%, transparent) 0%, rgba(0,0,0,0.55) 100%)';
      case 'top':    return 'linear-gradient(0deg,rgba(0,0,0,0) 45%,rgba(0,0,0,0.5) 100%)';
      default:       return 'transparent';
    }
  })();
  const objectPosition = `center ${props.focus === 'top' ? 'top' : props.focus === 'bottom' ? 'bottom' : 'center'}`;
  // ★ 2026-07-22 이미지 맞춤 — contain=완성 포스터 전체(잘림 X), 미지정=cover(회귀 0). SSR renderHero 미러.
  const imgFit: 'cover' | 'contain' = props.image_fit === 'contain' ? 'contain' : 'cover';
  const emCls = props.headline_emphasis === 'marker' ? 'dm-em-marker' : props.headline_emphasis === 'underline' ? 'dm-em-underline' : undefined;
  const editable = !!onEdit;
  // ★ Phase 1: 이미지 없으면 AI 무드 배경(그라데이션)으로 — 휑한 검정 대신 완성형. mood_text로 가독 색.
  const moodBg = (props as unknown as { mood_background?: string }).mood_background;
  const moodText = (props as unknown as { mood_text?: string }).mood_text;
  const baseBg = props.image_url ? 'var(--dm-neutral-900)' : (moodBg || 'var(--dm-neutral-900)');
  const textColor = (!props.image_url && moodBg) ? (moodText || '#fff') : '#fff';

  // ── 편집 가능 텍스트 노드 (구도별 스타일만 다름, 인라인 편집 유지) ──
  const headFs = props.headline_size ? { fontSize: props.headline_size } : {};
  const headCol = props.headline_color ? { color: props.headline_color } : {};
  const subFs = props.sub_copy_size ? { fontSize: props.sub_copy_size } : {};
  const subCol = props.sub_copy_color ? { color: props.sub_copy_color } : {};
  const headNode = (style: CSSProperties, className?: string) =>
    (props.headline || editable) ? (
      <InlineEditable
        className={className}
        style={{ ...style, ...headFs, ...headCol }}
        value={props.headline}
        placeholder="큰 제목을 입력하세요"
        onChange={(v) => onEdit?.({ headline: v } as Partial<HeroProps>)}
        disabled={!editable}
        multiline
        maxLength={80}
      />
    ) : null;
  const subNode = (style: CSSProperties, className?: string) =>
    (props.sub_copy || editable) ? (
      <InlineEditable
        className={className}
        style={{ ...style, ...subFs, ...subCol }}
        value={props.sub_copy || ''}
        placeholder="부가 설명을 입력하세요 (선택)"
        onChange={(v) => onEdit?.({ sub_copy: v } as Partial<HeroProps>)}
        disabled={!editable}
        multiline
        maxLength={200}
      />
    ) : null;
  const imgSrc = props.image_url ? dmImageUrl(props.image_url) : '';
  const t = treatment || 'classic';

  // ── 타이포: 이미지 없이 대형 헤드라인 + 규칙선 ──
  if (t === 'typographic') {
    return (
      <div className="dm-section dm-hero" style={{ background: 'var(--dm-bg)', padding: 'calc(var(--dm-sp-12) * var(--dm-section-pad-scale)) var(--dm-sp-5)', display: 'flex', flexDirection: 'column', gap: 'var(--dm-sp-4)' }}>
        {headNode({ fontSize: 'var(--dm-fs-hero)', fontWeight: FW_HERO, letterSpacing: 'var(--dm-ls-hero)', lineHeight: 1.12, fontFamily: 'var(--dm-font-display)', color: 'var(--dm-neutral-900)' }, emCls)}
        <div style={{ height: 2, width: 48, background: 'var(--dm-primary)' }} />
        {subNode({ fontSize: 'var(--dm-fs-body)', color: 'var(--dm-neutral-600)' })}
      </div>
    );
  }

  // ── 풀블리드: 이미지 꽉 + 중앙 오버레이 ──
  if (t === 'full_bleed') {
    const h = HEIGHT_PX_FULLBLEED[props.height || 'md'];
    return (
      <div className="dm-section dm-hero" style={{ position: 'relative', minHeight: h, overflow: 'hidden', background: baseBg }}>
        {imgSrc && <img src={imgSrc} alt={props.headline || ''} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: imgFit, objectPosition }} />}
        {imgSrc && <div style={{ position: 'absolute', inset: 0, background: props.overlay ? gradient : 'rgba(0,0,0,0.32)' }} />}
        <div style={{ position: 'relative', minHeight: h, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center', padding: 'var(--dm-sp-6) var(--dm-sp-5)', color: '#fff' }}>
          {headNode({ fontSize: 'var(--dm-fs-hero)', fontWeight: FW_HERO, letterSpacing: 'var(--dm-ls-hero)', lineHeight: 1.1, fontFamily: 'var(--dm-font-display)' }, emCls)}
          {subNode({ marginTop: 'var(--dm-sp-3)', fontSize: 'var(--dm-fs-body)', opacity: 0.92 })}
        </div>
      </div>
    );
  }

  // ── 분할: 상단 컬러(버튼색) 타입 블록 + 하단 이미지 ── (신고 1-② 대상)
  if (t === 'split') {
    return (
      <div className="dm-section dm-hero" style={{ background: 'var(--dm-bg)' }}>
        <div style={{ background: 'var(--dm-primary)', color: '#fff', padding: 'calc(var(--dm-sp-8) * var(--dm-section-pad-scale)) var(--dm-sp-5)' }}>
          {headNode({ fontSize: 'var(--dm-fs-hero)', fontWeight: FW_HERO, letterSpacing: 'var(--dm-ls-hero)', lineHeight: 1.12, fontFamily: 'var(--dm-font-display)' }, emCls)}
          {subNode({ marginTop: 'var(--dm-sp-2)', fontSize: 'var(--dm-fs-body)', opacity: 0.9 })}
        </div>
        {imgSrc ? (
          <img src={imgSrc} alt={props.headline || ''} style={{ width: '100%', display: 'block', objectFit: 'cover' }} />
        ) : (
          <div className="dm-mood-slot" style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--dm-neutral-400)' }}>이미지를 추가해주세요</div>
        )}
      </div>
    );
  }

  // ── 에디토리얼 오버랩: 이미지 위 겹치는 카드 ──
  if (t === 'editorial_overlap') {
    return (
      <div className="dm-section dm-hero" style={{ background: 'var(--dm-bg)', paddingBottom: 'var(--dm-sp-5)' }}>
        {imgSrc ? (
          <img src={imgSrc} alt={props.headline || ''} style={{ width: '100%', display: 'block', height: 280, objectFit: 'cover' }} />
        ) : (
          <div className="dm-mood-slot" style={{ height: 240 }} />
        )}
        {/* ★ 2026-07-10 임은지 신고: "버튼 색" 지정 시 오버랩 카드 면에 반영 — 강조 면 변수 폴백(미지정=기존 흰 카드, SSR 미러) */}
        <div style={{ margin: '-32px var(--dm-sp-5) 0', position: 'relative', background: 'var(--dm-accent-surface, var(--dm-bg))', border: '1px solid var(--dm-accent-surface, var(--dm-neutral-200))', borderRadius: 'var(--dm-radius-xl)', boxShadow: 'var(--dm-shadow-lg)', padding: 'var(--dm-sp-6)' }}>
          {headNode({ fontSize: 'var(--dm-fs-h1)', fontWeight: FW_HERO, letterSpacing: 'var(--dm-ls-hero)', lineHeight: 1.2, fontFamily: 'var(--dm-font-display)', color: 'var(--dm-accent-surface-fg, var(--dm-neutral-900))' }, emCls)}
          {subNode({ marginTop: 'var(--dm-sp-2)', fontSize: 'var(--dm-fs-body)', color: 'var(--dm-accent-surface-sub, var(--dm-neutral-600))' })}
        </div>
      </div>
    );
  }

  // ── classic (기존 — 골든 보존) ──
  return (
    <div className="dm-section dm-hero" style={{ position: 'relative', minHeight: height, overflow: 'hidden', background: baseBg }}>
      {props.image_url && (
        <img
          src={dmImageUrl(props.image_url)}
          alt={props.headline || ''}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: imgFit, objectPosition }}
        />
      )}
      {props.image_url && <div style={{ position: 'absolute', inset: 0, background: gradient }} />}
      <div
        style={{
          position: 'relative',
          minHeight: height,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          alignItems: justifyContent,
          padding: 'var(--dm-sp-8) var(--dm-sp-5)',
          color: textColor,
          textAlign,
        }}
      >
        {(props.headline || editable) && (
          <InlineEditable
            className={emCls ? `dm-text-hero ${emCls}` : 'dm-text-hero'}
            style={{
              fontWeight: 800,
              // ★ 2026-07-02(2) 폰트 크기·색상 직접 지정 — 뷰어 SSR과 동일 규칙 (미지정 = 토큰 크기/기본색)
              ...(props.headline_size ? { fontSize: props.headline_size } : {}),
              ...(props.headline_color ? { color: props.headline_color } : {}),
            }}
            value={props.headline}
            placeholder="큰 제목을 입력하세요"
            onChange={(v) => onEdit?.({ headline: v } as Partial<HeroProps>)}
            disabled={!editable}
            multiline
            maxLength={80}
          />
        )}
        {(props.sub_copy || editable) && (
          <InlineEditable
            className="dm-text-body"
            style={{
              marginTop: 'var(--dm-sp-3)',
              opacity: 0.9,
              ...(props.sub_copy_size ? { fontSize: props.sub_copy_size } : {}),
              ...(props.sub_copy_color ? { color: props.sub_copy_color } : {}),
            }}
            value={props.sub_copy || ''}
            placeholder="부가 설명을 입력하세요 (선택)"
            onChange={(v) => onEdit?.({ sub_copy: v } as Partial<HeroProps>)}
            disabled={!editable}
            multiline
            maxLength={200}
          />
        )}
      </div>
    </div>
  );
}
