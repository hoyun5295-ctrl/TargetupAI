/**
 * HeroSection — 히어로 (풀 배너 + 메인 헤드라인 + 서브카피)
 */
import type { HeroProps } from '../../../utils/dm-section-defaults';
import { dmImageUrl } from '../../../utils/dm-image-url';
import InlineEditable from './InlineEditable';
import type { EditHandler } from './SectionRenderer';

const HEIGHT_PX: Record<string, string> = { sm: '200px', md: '320px', lg: '480px', full: '100vh' };

export default function HeroSection({ props, onEdit }: { props: HeroProps; onEdit?: EditHandler }) {
  const height = HEIGHT_PX[props.height || 'md'];
  const align = props.align || 'center';
  const textAlign = align as 'left' | 'center' | 'right';
  const justifyContent = align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center';
  const gradient = props.overlay_gradient !== false
    ? 'linear-gradient(180deg,rgba(0,0,0,0) 40%,rgba(0,0,0,0.5) 100%)'
    : 'transparent';
  const editable = !!onEdit;
  // ★ Phase 1: 이미지 없으면 AI 무드 배경(그라데이션)으로 — 휑한 검정 대신 완성형. mood_text로 가독 색.
  const moodBg = (props as unknown as { mood_background?: string }).mood_background;
  const moodText = (props as unknown as { mood_text?: string }).mood_text;
  const baseBg = props.image_url ? 'var(--dm-neutral-900)' : (moodBg || 'var(--dm-neutral-900)');
  const textColor = (!props.image_url && moodBg) ? (moodText || '#fff') : '#fff';

  return (
    <div className="dm-section dm-hero" style={{ position: 'relative', minHeight: height, overflow: 'hidden', background: baseBg }}>
      {props.image_url && (
        <img
          src={dmImageUrl(props.image_url)}
          alt={props.headline || ''}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
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
            className="dm-text-hero"
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
            multiline={false}
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
