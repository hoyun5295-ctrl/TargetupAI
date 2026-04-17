/**
 * PromoCodeSection — 프로모션 코드
 */
import type { PromoCodeProps } from '../../../utils/dm-section-defaults';
import InlineEditable from './InlineEditable';
import type { EditHandler } from './SectionRenderer';

export default function PromoCodeSection({ props, onEdit }: { props: PromoCodeProps; onEdit?: EditHandler }) {
  const editable = !!onEdit;
  if (!props.code && !editable) return null;

  return (
    <div className="dm-section dm-promo-code" style={{ padding: 'var(--dm-sp-6) var(--dm-sp-5)', background: 'linear-gradient(135deg,var(--dm-accent) 0%,var(--dm-primary) 100%)', color: '#fff', textAlign: 'center' }}>
      {(props.description || editable) && (
        <InlineEditable
          className="dm-text-h3"
          style={{ fontWeight: 600, marginBottom: 'var(--dm-sp-3)' }}
          value={props.description || ''}
          placeholder="프로모션 설명"
          onChange={(v) => onEdit?.({ description: v } as Partial<PromoCodeProps>)}
          disabled={!editable}
          maxLength={50}
        />
      )}
      <InlineEditable
        style={{ background: 'rgba(255,255,255,0.95)', color: 'var(--dm-primary)', display: 'inline-block', padding: 'var(--dm-sp-3) var(--dm-sp-6)', borderRadius: 'var(--dm-radius-md)', fontFamily: 'var(--dm-font-mono)', fontSize: 'var(--dm-fs-h2)', fontWeight: 900, letterSpacing: 3, border: '2px dashed rgba(255,255,255,0.5)' }}
        value={props.code || ''}
        placeholder="PROMO2025"
        onChange={(v) => onEdit?.({ code: v } as Partial<PromoCodeProps>)}
        disabled={!editable}
        maxLength={20}
      />
      {(props.instructions || editable) && (
        <InlineEditable
          className="dm-text-small"
          style={{ marginTop: 'var(--dm-sp-3)', opacity: 0.9 }}
          value={props.instructions || ''}
          placeholder="코드 사용 방법 안내 (선택)"
          onChange={(v) => onEdit?.({ instructions: v } as Partial<PromoCodeProps>)}
          disabled={!editable}
          multiline
          maxLength={150}
        />
      )}
      {props.cta_url && (
        <div style={{ marginTop: 'var(--dm-sp-4)' }}>
          <a href={props.cta_url} className="dm-cta" target="_blank" rel="noreferrer" style={{ background: '#fff', color: 'var(--dm-primary)' }}>
            {props.cta_label || '지금 사용하기'}
          </a>
        </div>
      )}
    </div>
  );
}
