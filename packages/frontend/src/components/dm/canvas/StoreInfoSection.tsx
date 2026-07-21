/**
 * StoreInfoSection — 매장/고객센터 정보
 */
import type { StoreInfoProps } from '../../../utils/dm-section-defaults';
import InlineEditable from './InlineEditable';
import type { EditHandler } from './SectionRenderer';

export default function StoreInfoSection({ props, onEdit, treatment }: { props: StoreInfoProps; onEdit?: EditHandler; treatment?: string }) {
  const editable = !!onEdit;
  // ★ 2026-07-13 디자인 3.0 — card 구도(SSR renderStoreInfoCard 미러): 라운드 카드 + 라벨 행
  const isCard = treatment === 'card';
  // ★ 2026-07-21 (#3 남지현) 라벨을 구도별로 발송 SSR과 미러 — card=웹/메일/영업(renderStoreInfoCard), classic=홈페이지/이메일/영업시간(renderStoreInfoClassic).
  //   종전엔 편집·뷰어 두 모드 모두 classic 라벨 하드코딩 → card 구도에서 편집창(홈페이지)≠단말(웹). 최종 라벨 통일은 브랜드킷→브랜드보이스 합산 작업 예정.
  const L = isCard
    ? { website: '웹', email: '메일', business_hours: '영업' }
    : { website: '홈페이지', email: '이메일', business_hours: '영업시간' };
  const sectionStyle: React.CSSProperties = isCard
    ? { padding: 'var(--dm-sp-5)' }
    : { padding: 'var(--dm-sp-5)', background: 'var(--dm-neutral-50)', borderTop: '1px solid var(--dm-neutral-200)' };
  const cardWrap = (children: React.ReactNode) => isCard
    ? <div style={{ background: 'var(--dm-neutral-50)', border: '1px solid var(--dm-neutral-200)', borderRadius: 18, padding: 'var(--dm-sp-5)', display: 'flex', flexDirection: 'column', gap: 'var(--dm-sp-3)', textAlign: 'left', boxShadow: 'var(--dm-shadow-sm)' }}>{children}</div>
    : <>{children}</>;

  // 편집 모드에서는 전체 필드를 인라인 편집 UI로 표시
  if (editable) {
    const row = (label: string, value: string, onChange: (v: string) => void, placeholder: string, multiline = false, maxLength = 100) => (
      <div style={{ display: 'flex', gap: 'var(--dm-sp-2)', alignItems: 'baseline' }}>
        <strong style={{ minWidth: 54 }}>{label}</strong>
        <InlineEditable
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          multiline={multiline}
          maxLength={maxLength}
          style={{ flex: 1, color: 'var(--dm-primary)' }}
        />
      </div>
    );

    return (
      <div className="dm-section dm-store-info" style={sectionStyle}>
        {cardWrap(
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--dm-sp-2)', fontSize: 'var(--dm-fs-small)', color: 'var(--dm-neutral-700)' }}>
              {row('전화', props.phone || '', (v) => onEdit?.({ phone: v } as Partial<StoreInfoProps>), '02-1234-5678')}
              {row(L.website, props.website || '', (v) => onEdit?.({ website: v } as Partial<StoreInfoProps>), 'https://example.com')}
              {row(L.email, props.email || '', (v) => onEdit?.({ email: v } as Partial<StoreInfoProps>), 'hello@example.com')}
              {row('주소', props.address || '', (v) => onEdit?.({ address: v } as Partial<StoreInfoProps>), '서울시 ...', true, 200)}
              {row(L.business_hours, props.business_hours || '', (v) => onEdit?.({ business_hours: v } as Partial<StoreInfoProps>), '평일 10:00~19:00', true, 100)}
            </div>
            {props.map_url && (
              <div style={{ marginTop: 'var(--dm-sp-3)', textAlign: 'center' }}>
                <a href={props.map_url} target="_blank" rel="noreferrer" className="dm-cta dm-cta-outline">매장 위치 보기</a>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  // 뷰어 모드
  const items: { label: string; value: string; href?: string }[] = [];
  if (props.phone)          items.push({ label: '전화', value: props.phone, href: `tel:${props.phone}` });
  if (props.website)        items.push({ label: L.website, value: props.website.replace(/^https?:\/\//, ''), href: props.website });
  if (props.email)          items.push({ label: L.email, value: props.email, href: `mailto:${props.email}` });
  if (props.address)        items.push({ label: '주소', value: props.address });
  if (props.business_hours) items.push({ label: L.business_hours, value: props.business_hours });

  if (items.length === 0 && !props.map_url) return null;

  return (
    <div className="dm-section dm-store-info" style={sectionStyle}>
      {cardWrap(
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--dm-sp-2)', fontSize: 'var(--dm-fs-small)', color: 'var(--dm-neutral-700)' }}>
            {/* ★ 2026-07-21 (#3 남지현) whiteSpace:pre-line — 개행이 실제 있는 값에만(주소·영업시간). SSR renderStoreInfo* 조건부 미러. */}
            {items.map((it, i) =>
              it.href ? (
                <a key={i} href={it.href} target={it.href.startsWith('http') ? '_blank' : undefined} rel="noreferrer" style={{ color: 'var(--dm-primary)', textDecoration: 'none', ...(it.value.includes('\n') ? { whiteSpace: 'pre-line' as const } : {}) }}>
                  <strong>{it.label}</strong> {it.value}
                </a>
              ) : (
                <span key={i} style={it.value.includes('\n') ? { whiteSpace: 'pre-line' } : undefined}><strong>{it.label}</strong> {it.value}</span>
              )
            )}
          </div>
          {props.map_url && (
            <div style={{ marginTop: 'var(--dm-sp-3)', textAlign: 'center' }}>
              <a href={props.map_url} target="_blank" rel="noreferrer" className="dm-cta dm-cta-outline">매장 위치 보기</a>
            </div>
          )}
        </>
      )}
    </div>
  );
}
