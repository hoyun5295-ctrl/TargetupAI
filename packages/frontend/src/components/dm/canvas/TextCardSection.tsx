/**
 * TextCardSection — 텍스트 카드 (태그 + 헤드라인 + 본문 + 이미지 조합)
 */
import type { TextCardProps } from '../../../utils/dm-section-defaults';

export default function TextCardSection({ props }: { props: TextCardProps }) {
  const pos = props.image_position || 'top';
  const align = props.align || 'left';
  const isHoriz = pos === 'left' || pos === 'right';
  const flexDir = pos === 'bottom' ? 'column-reverse' : pos === 'left' ? 'row' : pos === 'right' ? 'row-reverse' : 'column';
  const outerPadding = pos === 'top' || pos === 'bottom' ? '0' : 'var(--dm-sp-4) var(--dm-sp-5)';

  return (
    <div className="dm-section dm-text-card" style={{ padding: 0, background: 'var(--dm-bg)' }}>
      <div style={{ display: 'flex', flexDirection: flexDir as any, gap: isHoriz ? 'var(--dm-sp-3)' : '0', padding: outerPadding }}>
        {props.image_url && (
          <div style={{ flex: isHoriz ? '0 0 40%' : '0 0 auto', width: isHoriz ? undefined : '100%' }}>
            <img
              src={props.image_url}
              alt={props.headline || ''}
              style={{ width: '100%', display: 'block', borderRadius: pos === 'top' ? 0 : 'var(--dm-radius-md)' }}
            />
          </div>
        )}
        <div style={{ flex: 1, padding: 'var(--dm-sp-4) var(--dm-sp-5)', textAlign: align as 'left' | 'center' }}>
          {props.tag && (
            <div style={{ display: 'inline-block', background: 'var(--dm-primary-light)', color: 'var(--dm-primary)', padding: 'var(--dm-sp-1) var(--dm-sp-2)', borderRadius: 'var(--dm-radius-sm)', fontSize: 'var(--dm-fs-tiny)', fontWeight: 700, marginBottom: 'var(--dm-sp-2)' }}>
              {props.tag}
            </div>
          )}
          {props.headline && <div className="dm-text-h2" style={{ color: 'var(--dm-neutral-900)', marginBottom: 'var(--dm-sp-2)' }}>{props.headline}</div>}
          {props.body && <div className="dm-text-body" style={{ color: 'var(--dm-neutral-700)', whiteSpace: 'pre-wrap' }}>{props.body}</div>}
        </div>
      </div>
    </div>
  );
}
