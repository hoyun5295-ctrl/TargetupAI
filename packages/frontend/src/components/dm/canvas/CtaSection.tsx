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
    <div className="dm-section dm-cta-section" style={{ padding: 'var(--dm-sp-5)' }}>
      <div style={{
        display: 'flex',
        flexDirection: flexDir,
        flexWrap,
        gap: 'var(--dm-sp-3)',
        // 가로 정렬: row=주축(justifyContent) / column(stack)=교차축(alignItems).
        // column에서 justifyContent는 세로축이라 가로 정렬이 안 먹고, alignItems 기본 stretch가 버튼을 풀폭으로 늘려 정렬이 안 보였음.
        justifyContent: layout === 'row' ? 'var(--dm-section-justify, center)' : undefined,
        alignItems: layout === 'row' ? undefined : 'var(--dm-section-justify, center)',
      }}>
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
