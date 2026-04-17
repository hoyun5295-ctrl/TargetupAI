/**
 * StoreInfoSection — 매장/고객센터 정보
 */
import type { StoreInfoProps } from '../../../utils/dm-section-defaults';

export default function StoreInfoSection({ props }: { props: StoreInfoProps }) {
  const items: { label: string; value: string; href?: string }[] = [];
  if (props.phone)          items.push({ label: '전화', value: props.phone, href: `tel:${props.phone}` });
  if (props.website)        items.push({ label: '홈페이지', value: props.website.replace(/^https?:\/\//, ''), href: props.website });
  if (props.email)          items.push({ label: '이메일', value: props.email, href: `mailto:${props.email}` });
  if (props.address)        items.push({ label: '주소', value: props.address });
  if (props.business_hours) items.push({ label: '영업시간', value: props.business_hours });

  if (items.length === 0 && !props.map_url) return null;

  return (
    <div className="dm-section dm-store-info" style={{ padding: 'var(--dm-sp-5)', background: 'var(--dm-neutral-50)', borderTop: '1px solid var(--dm-neutral-200)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--dm-sp-2)', fontSize: 'var(--dm-fs-small)', color: 'var(--dm-neutral-700)' }}>
        {items.map((it, i) =>
          it.href ? (
            <a key={i} href={it.href} target={it.href.startsWith('http') ? '_blank' : undefined} rel="noreferrer" style={{ color: 'var(--dm-primary)', textDecoration: 'none' }}>
              <strong>{it.label}</strong> {it.value}
            </a>
          ) : (
            <span key={i}><strong>{it.label}</strong> {it.value}</span>
          )
        )}
      </div>
      {props.map_url && (
        <div style={{ marginTop: 'var(--dm-sp-3)', textAlign: 'center' }}>
          <a href={props.map_url} target="_blank" rel="noreferrer" className="dm-cta dm-cta-outline">매장 위치 보기</a>
        </div>
      )}
    </div>
  );
}
