/**
 * HeaderSection — 헤더 섹션 (4 variant: logo/banner/countdown/coupon)
 */
import type { HeaderProps } from '../../../utils/dm-section-defaults';
import InlineEditable from './InlineEditable';
import type { EditHandler } from './SectionRenderer';

export default function HeaderSection({ props, storeName = '', onEdit }: { props: HeaderProps; storeName?: string; onEdit?: EditHandler }) {
  const variant = props.variant || 'logo';
  const brand = props.brand_name || storeName || '';
  const editable = !!onEdit;

  if (variant === 'banner') {
    return (
      <div className="dm-header dm-header-banner">
        {props.banner_image_url && (
          <img src={props.banner_image_url} alt={brand} style={{ width: '100%', display: 'block' }} />
        )}
      </div>
    );
  }

  if (variant === 'countdown') {
    const eventDate = props.event_date ? new Date(props.event_date) : null;
    const dday = eventDate ? Math.ceil((eventDate.getTime() - Date.now()) / 86400000) : 0;
    const ddayText = dday > 0 ? `D-${dday}` : dday === 0 ? 'D-Day' : `D+${Math.abs(dday)}`;
    return (
      <div className="dm-header dm-header-countdown" style={{ background: 'linear-gradient(135deg,var(--dm-primary) 0%,var(--dm-primary-hover) 100%)', color: '#fff', padding: 'var(--dm-sp-6) var(--dm-sp-5)', textAlign: 'center' }}>
        <div style={{ fontSize: 36, fontWeight: 900, letterSpacing: 2 }}>{ddayText}</div>
        {(props.event_title || editable) && (
          <InlineEditable
            style={{ fontSize: 'var(--dm-fs-small)', opacity: 0.9, marginTop: 'var(--dm-sp-2)', fontWeight: 500 }}
            value={props.event_title || ''}
            placeholder="이벤트 이름"
            onChange={(v) => onEdit?.({ event_title: v } as Partial<HeaderProps>)}
            disabled={!editable}
            maxLength={40}
          />
        )}
        {(brand || editable) && (
          <InlineEditable
            style={{ fontSize: 'var(--dm-fs-tiny)', opacity: 0.6, marginTop: 'var(--dm-sp-1)' }}
            value={brand}
            placeholder="브랜드명"
            onChange={(v) => onEdit?.({ brand_name: v } as Partial<HeaderProps>)}
            disabled={!editable}
            maxLength={30}
          />
        )}
      </div>
    );
  }

  if (variant === 'coupon') {
    return (
      <div className="dm-header dm-header-coupon" style={{ background: 'linear-gradient(135deg,var(--dm-accent) 0%,var(--dm-primary) 100%)', color: '#fff', padding: 'var(--dm-sp-6) var(--dm-sp-5)', textAlign: 'center' }}>
        {(props.discount_label || editable) && (
          <InlineEditable
            style={{ fontSize: 'var(--dm-fs-h3)', fontWeight: 700, marginBottom: 'var(--dm-sp-2)' }}
            value={props.discount_label || ''}
            placeholder="할인 혜택 (예: 10% OFF)"
            onChange={(v) => onEdit?.({ discount_label: v } as Partial<HeaderProps>)}
            disabled={!editable}
            maxLength={30}
          />
        )}
        {(props.coupon_code || editable) && (
          <InlineEditable
            style={{ background: 'rgba(255,255,255,0.25)', display: 'inline-block', padding: 'var(--dm-sp-2) var(--dm-sp-6)', borderRadius: 'var(--dm-radius-md)', fontSize: 'var(--dm-fs-h2)', fontWeight: 900, letterSpacing: 3, fontFamily: 'var(--dm-font-mono)' }}
            value={props.coupon_code || ''}
            placeholder="COUPON"
            onChange={(v) => onEdit?.({ coupon_code: v } as Partial<HeaderProps>)}
            disabled={!editable}
            maxLength={20}
          />
        )}
        {(brand || editable) && (
          <InlineEditable
            style={{ fontSize: 'var(--dm-fs-tiny)', opacity: 0.7, marginTop: 'var(--dm-sp-2)' }}
            value={brand}
            placeholder="브랜드명"
            onChange={(v) => onEdit?.({ brand_name: v } as Partial<HeaderProps>)}
            disabled={!editable}
            maxLength={30}
          />
        )}
      </div>
    );
  }

  // variant === 'logo'
  return (
    <div className="dm-header dm-header-logo" style={{ background: 'var(--dm-bg)', padding: 'var(--dm-sp-4) var(--dm-sp-5)', borderBottom: '1px solid var(--dm-neutral-200)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--dm-sp-2)' }}>
        {props.logo_url && <img src={props.logo_url} alt={brand} style={{ height: 32, borderRadius: 'var(--dm-radius-sm)' }} />}
        {(brand || editable) && (
          <InlineEditable
            style={{ fontSize: 'var(--dm-fs-h3)', fontWeight: 700, color: 'var(--dm-neutral-900)' }}
            value={brand}
            placeholder="브랜드명"
            onChange={(v) => onEdit?.({ brand_name: v } as Partial<HeaderProps>)}
            disabled={!editable}
            maxLength={30}
          />
        )}
      </div>
      {props.phone && <a href={`tel:${props.phone}`} style={{ fontSize: 'var(--dm-fs-small)', color: 'var(--dm-neutral-500)', textDecoration: 'none' }}>{props.phone}</a>}
    </div>
  );
}
