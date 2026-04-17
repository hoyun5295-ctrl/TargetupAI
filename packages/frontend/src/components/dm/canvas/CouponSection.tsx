/**
 * CouponSection — 쿠폰 (할인 + 코드 + 유효기간 + 조건)
 */
import type { CouponProps } from '../../../utils/dm-section-defaults';

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

export default function CouponSection({ props }: { props: CouponProps }) {
  const expire = formatDate(props.expire_date);

  return (
    <div className="dm-section dm-coupon" style={{ padding: 'var(--dm-sp-6) var(--dm-sp-5)', background: 'var(--dm-primary-light)' }}>
      <div style={{ background: 'var(--dm-bg)', border: '2px dashed var(--dm-primary)', borderRadius: 'var(--dm-radius-lg)', padding: 'var(--dm-sp-6)', textAlign: 'center' }}>
        <div className="dm-text-hero" style={{ color: 'var(--dm-primary)', fontWeight: 900 }}>
          {props.discount_label || '할인'}
        </div>
        {props.coupon_code && (
          <div style={{ marginTop: 'var(--dm-sp-3)', background: 'var(--dm-primary)', color: '#fff', display: 'inline-block', padding: 'var(--dm-sp-2) var(--dm-sp-5)', borderRadius: 'var(--dm-radius-md)', fontFamily: 'var(--dm-font-mono)', fontSize: 'var(--dm-fs-h3)', fontWeight: 700, letterSpacing: 2 }}>
            {props.coupon_code}
          </div>
        )}
        {expire && <div className="dm-text-small" style={{ marginTop: 'var(--dm-sp-3)', color: 'var(--dm-neutral-500)' }}>유효기간: ~ {expire}</div>}
        {props.min_purchase && <div className="dm-text-small" style={{ marginTop: 'var(--dm-sp-1)', color: 'var(--dm-neutral-500)' }}>{Number(props.min_purchase).toLocaleString('ko-KR')}원 이상 구매 시</div>}
        {props.usage_condition && <div className="dm-text-tiny" style={{ marginTop: 'var(--dm-sp-2)', color: 'var(--dm-neutral-500)' }}>{props.usage_condition}</div>}
        {props.cta_url && (
          <div style={{ marginTop: 'var(--dm-sp-4)' }}>
            <a href={props.cta_url} className="dm-cta dm-cta-primary" target="_blank" rel="noreferrer">쿠폰 사용하기</a>
          </div>
        )}
      </div>
    </div>
  );
}
