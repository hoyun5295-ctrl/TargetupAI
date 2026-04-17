/**
 * HeroSection — 히어로 (풀 배너 + 메인 헤드라인 + 서브카피)
 */
import type { HeroProps } from '../../../utils/dm-section-defaults';
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

  return (
    <div className="dm-section dm-hero" style={{ position: 'relative', minHeight: height, overflow: 'hidden', background: 'var(--dm-neutral-900)' }}>
      {props.image_url && (
        <img
          src={props.image_url}
          alt={props.headline || ''}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />
      )}
      <div style={{ position: 'absolute', inset: 0, background: gradient }} />
      <div
        style={{
          position: 'relative',
          minHeight: height,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          alignItems: justifyContent,
          padding: 'var(--dm-sp-8) var(--dm-sp-5)',
          color: '#fff',
          textAlign,
        }}
      >
        {(props.headline || editable) && (
          <InlineEditable
            className="dm-text-hero"
            style={{ fontWeight: 800 }}
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
            style={{ marginTop: 'var(--dm-sp-3)', opacity: 0.9 }}
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
