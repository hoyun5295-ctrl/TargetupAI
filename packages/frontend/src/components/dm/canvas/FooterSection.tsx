/**
 * FooterSection — 하단 정보 (유의사항 + 고객센터 + 법정안내 + 수신거부)
 */
import type { FooterProps } from '../../../utils/dm-section-defaults';

export default function FooterSection({ props }: { props: FooterProps }) {
  const showUnsub = props.show_unsubscribe_link !== false;

  return (
    <div className="dm-section dm-footer" style={{ padding: 'var(--dm-sp-6) var(--dm-sp-5)', background: 'var(--dm-neutral-100)', borderTop: '1px solid var(--dm-neutral-200)', textAlign: 'center' }}>
      {props.notes && <div className="dm-text-small" style={{ color: 'var(--dm-neutral-600)', marginBottom: 'var(--dm-sp-3)', whiteSpace: 'pre-wrap' }}>{props.notes}</div>}
      {props.cs_phone && (
        <div className="dm-text-small" style={{ color: 'var(--dm-neutral-700)', marginBottom: 'var(--dm-sp-1)' }}>
          <strong>고객센터</strong> <a href={`tel:${props.cs_phone}`} style={{ color: 'var(--dm-primary)', textDecoration: 'none' }}>{props.cs_phone}</a>
        </div>
      )}
      {props.cs_hours && <div className="dm-text-tiny" style={{ color: 'var(--dm-neutral-500)', marginBottom: 'var(--dm-sp-2)' }}>{props.cs_hours}</div>}
      {props.legal_text && <div className="dm-text-tiny" style={{ color: 'var(--dm-neutral-500)', marginTop: 'var(--dm-sp-3)', whiteSpace: 'pre-wrap' }}>{props.legal_text}</div>}
      {showUnsub && (
        <div className="dm-text-tiny" style={{ color: 'var(--dm-neutral-400)', marginTop: 'var(--dm-sp-4)' }}>
          <a href="/api/unsubscribes/form" target="_blank" rel="noreferrer" style={{ color: 'var(--dm-neutral-500)', textDecoration: 'underline' }}>수신거부</a>
        </div>
      )}
    </div>
  );
}
