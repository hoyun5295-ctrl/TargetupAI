/**
 * CtaSection — CTA 버튼 (1~2개, 가로/세로)
 */
import type { CtaProps } from '../../../utils/dm-section-defaults';

export default function CtaSection({ props }: { props: CtaProps }) {
  const buttons = Array.isArray(props.buttons) ? props.buttons : [];
  if (buttons.length === 0) return null;

  const layout = props.layout || 'stack';
  const flexDir = layout === 'row' ? 'row' : 'column';
  const flexWrap = layout === 'row' ? 'wrap' : 'nowrap';

  return (
    <div className="dm-section dm-cta-section" style={{ padding: 'var(--dm-sp-5)', textAlign: 'center' }}>
      <div style={{ display: 'flex', flexDirection: flexDir, flexWrap, gap: 'var(--dm-sp-3)', justifyContent: 'center' }}>
        {buttons.map((b, i) => {
          const cls = b.style === 'secondary' ? 'dm-cta dm-cta-secondary'
                    : b.style === 'outline'   ? 'dm-cta dm-cta-outline'
                    : 'dm-cta dm-cta-primary';
          return (
            <a key={i} href={b.url || '#'} className={cls} target="_blank" rel="noreferrer">
              {b.icon && <span style={{ marginRight: 'var(--dm-sp-1)' }}>{b.icon}</span>}
              {b.label || '자세히 보기'}
            </a>
          );
        })}
      </div>
    </div>
  );
}
