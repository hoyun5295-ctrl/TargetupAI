/**
 * CouponSection — 쿠폰 (할인 + 코드 + 유효기간 + 조건)
 */
import type { CouponProps } from '../../../utils/dm-section-defaults';
import InlineEditable from './InlineEditable';
import type { EditHandler } from './SectionRenderer';

function formatDate(iso?: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  } catch {
    return iso;
  }
}

export default function CouponSection({ props, onEdit }: { props: CouponProps; onEdit?: EditHandler }) {
  const expire = formatDate(props.expire_date);
  const editable = !!onEdit;

  // ★ 2026-07-02(5) 발행물(SSR) 격상과 동일 스타일 — 에디터·발행물 시각 일치 (3면 대조)
  return (
    <div className="dm-section dm-coupon" style={{ padding: 'var(--dm-sp-8) var(--dm-sp-5)', background: 'var(--dm-primary-light)' }}>
      <div style={{ background: 'var(--dm-bg)', border: '1px solid var(--dm-neutral-200)', borderRadius: 20, boxShadow: 'var(--dm-shadow-md)', padding: 'var(--dm-sp-8) var(--dm-sp-6)' }}>
        <div style={{ fontSize: 'var(--dm-fs-tiny)', fontWeight: 700, letterSpacing: 3, color: 'var(--dm-neutral-500)', marginBottom: 'var(--dm-sp-3)' }}>COUPON</div>
        <InlineEditable
          className="dm-text-hero"
          style={{ color: 'var(--dm-primary)', fontWeight: 900, fontFamily: 'var(--dm-font-display)' }}
          value={props.discount_label || ''}
          placeholder="할인 (예: 30% OFF)"
          onChange={(v) => onEdit?.({ discount_label: v } as Partial<CouponProps>)}
          disabled={!editable}
          maxLength={30}
        />
        {(props.coupon_code || editable) && (
          <div style={{ marginTop: 'var(--dm-sp-4)', borderTop: '1px dashed var(--dm-neutral-300)', paddingTop: 'var(--dm-sp-4)' }}>
            <InlineEditable
              style={{ background: 'var(--dm-neutral-900)', color: '#fff', display: 'inline-block', padding: 'var(--dm-sp-2) var(--dm-sp-6)', borderRadius: 999, fontFamily: 'var(--dm-font-mono)', fontSize: 'var(--dm-fs-h3)', fontWeight: 700, letterSpacing: 3 }}
              value={props.coupon_code || ''}
              placeholder="COUPON"
              onChange={(v) => onEdit?.({ coupon_code: v } as Partial<CouponProps>)}
              disabled={!editable}
              maxLength={20}
            />
          </div>
        )}
        {expire && <div className="dm-text-small" style={{ marginTop: 'var(--dm-sp-3)', color: 'var(--dm-neutral-500)' }}>유효기간: ~ {expire}</div>}
        {props.min_purchase && <div className="dm-text-small" style={{ marginTop: 'var(--dm-sp-1)', color: 'var(--dm-neutral-500)' }}>{Number(props.min_purchase).toLocaleString('ko-KR')}원 이상 구매 시</div>}
        {(props.usage_condition || editable) && (
          <InlineEditable
            className="dm-text-tiny"
            style={{ marginTop: 'var(--dm-sp-2)', color: 'var(--dm-neutral-500)' }}
            value={props.usage_condition || ''}
            placeholder="사용 조건 (선택)"
            onChange={(v) => onEdit?.({ usage_condition: v } as Partial<CouponProps>)}
            disabled={!editable}
            multiline
            maxLength={100}
          />
        )}
        {props.cta_url && (
          <div style={{ marginTop: 'var(--dm-sp-5)' }}>
            <a href={props.cta_url} className="dm-cta dm-cta-primary" target="_blank" rel="noreferrer" style={{ width: '100%', maxWidth: 280 }}>쿠폰 사용하기</a>
          </div>
        )}
      </div>
    </div>
  );
}
