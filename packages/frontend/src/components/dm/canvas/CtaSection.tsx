/**
 * CtaSection — CTA 버튼 (1~2개, 가로/세로)
 */
import type { CtaProps } from '../../../utils/dm-section-defaults';
import InlineEditable from './InlineEditable';
import type { EditHandler } from './SectionRenderer';

export default function CtaSection({ props, onEdit }: { props: CtaProps; onEdit?: EditHandler }) {
  const buttons = Array.isArray(props.buttons) ? props.buttons : [];
  const editable = !!onEdit;
  if (buttons.length === 0 && !editable) return null;

  const layout = props.layout || 'stack';
  const flexDir = layout === 'row' ? 'row' : 'column';
  const flexWrap = layout === 'row' ? 'wrap' : 'nowrap';

  const updateButtonLabel = (idx: number, newLabel: string) => {
    if (!onEdit) return;
    const next = buttons.map((b, i) => (i === idx ? { ...b, label: newLabel } : b));
    onEdit({ buttons: next } as Partial<CtaProps>);
  };

  return (
    <div className="dm-section dm-cta-section" style={{ padding: 'var(--dm-sp-5)', textAlign: 'center' }}>
      <div style={{ display: 'flex', flexDirection: flexDir, flexWrap, gap: 'var(--dm-sp-3)', justifyContent: 'center' }}>
        {buttons.map((b, i) => {
          const cls = b.style === 'secondary' ? 'dm-cta dm-cta-secondary'
                    : b.style === 'outline'   ? 'dm-cta dm-cta-outline'
                    : 'dm-cta dm-cta-primary';
          return editable ? (
            <span key={i} className={cls} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {b.icon && <span>{b.icon}</span>}
              <InlineEditable
                value={b.label || ''}
                placeholder="버튼 문구"
                onChange={(v) => updateButtonLabel(i, v)}
                maxLength={30}
                style={{ minWidth: 60 }}
              />
            </span>
          ) : (
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
