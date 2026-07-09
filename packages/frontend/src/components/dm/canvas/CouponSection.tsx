/**
 * CouponSection — 쿠폰 (할인 + 코드 + 유효기간 + 조건)
 * 2026-07-09: 구도(treatment) 캔버스 미러 — 발행 SSR renderCoupon*(classic/ticket/spotlight)와 동일. classic 골든 보존.
 */
import type { CSSProperties } from 'react';
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

export default function CouponSection({ props, onEdit, treatment }: { props: CouponProps; onEdit?: EditHandler; treatment?: string }) {
  const expire = formatDate(props.expire_date);
  const editable = !!onEdit;
  const t = treatment || 'classic';

  const discountNode = (style: CSSProperties, className?: string) => (
    <InlineEditable
      className={className}
      style={style}
      value={props.discount_label || ''}
      placeholder="할인 (예: 30% OFF)"
      onChange={(v) => onEdit?.({ discount_label: v } as Partial<CouponProps>)}
      disabled={!editable}
      maxLength={30}
    />
  );
  const codeNode = (style: CSSProperties) => (props.coupon_code || editable) ? (
    <InlineEditable
      style={style}
      value={props.coupon_code || ''}
      placeholder="COUPON"
      onChange={(v) => onEdit?.({ coupon_code: v } as Partial<CouponProps>)}
      disabled={!editable}
      maxLength={20}
    />
  ) : null;
  // 유효기간 + 최소구매 + 사용조건(개행 보존) — 전 구도 공용
  const metaNode = (
    <>
      {expire && <div className="dm-text-small" style={{ marginTop: 'var(--dm-sp-3)', color: 'var(--dm-neutral-500)' }}>유효기간: ~ {expire}</div>}
      {props.min_purchase && <div className="dm-text-small" style={{ marginTop: 'var(--dm-sp-1)', color: 'var(--dm-neutral-500)' }}>{Number(props.min_purchase).toLocaleString('ko-KR')}원 이상 구매 시</div>}
      {(props.usage_condition || editable) && (
        <InlineEditable
          className="dm-text-tiny"
          style={{ marginTop: 'var(--dm-sp-2)', color: 'var(--dm-neutral-500)', whiteSpace: 'pre-wrap' }}
          value={props.usage_condition || ''}
          placeholder="사용 조건 (선택)"
          onChange={(v) => onEdit?.({ usage_condition: v } as Partial<CouponProps>)}
          disabled={!editable}
          multiline
          maxLength={100}
        />
      )}
    </>
  );
  const ctaNode = props.cta_url ? (
    <div style={{ marginTop: 'var(--dm-sp-5)' }}>
      <a href={props.cta_url} className="dm-cta dm-cta-primary" target="_blank" rel="noreferrer" style={{ width: '100%', maxWidth: 280 }}>쿠폰 사용하기</a>
    </div>
  ) : null;

  // ── 티켓: 좌우 노치 + 점선 분리 ──
  if (t === 'ticket') {
    const notch = 'radial-gradient(circle at 0 50%, transparent 10px, var(--dm-bg) 11px) left/51% 100% no-repeat, radial-gradient(circle at 100% 50%, transparent 10px, var(--dm-bg) 11px) right/51% 100% no-repeat';
    return (
      <div className="dm-section dm-coupon" style={{ padding: 'calc(var(--dm-sp-6) * var(--dm-section-pad-scale)) var(--dm-sp-5)', background: 'var(--dm-primary-light)' }}>
        <div style={{ background: notch, boxShadow: 'var(--dm-shadow-md)', borderRadius: 'var(--dm-radius-lg)', padding: 'var(--dm-sp-6) var(--dm-sp-8)' }}>
          {discountNode({ fontSize: 'var(--dm-fs-hero)', fontWeight: 900, color: 'var(--dm-primary)', fontFamily: 'var(--dm-font-display)' })}
          {(props.coupon_code || editable) && (
            <div style={{ marginTop: 'var(--dm-sp-4)', borderTop: '1px dashed var(--dm-neutral-300)', paddingTop: 'var(--dm-sp-4)' }}>
              {codeNode({ fontFamily: 'var(--dm-font-mono)', fontSize: 'var(--dm-fs-h2)', fontWeight: 700, letterSpacing: 3, color: 'var(--dm-neutral-900)' })}
            </div>
          )}
          {metaNode}
          {props.cta_url && <div style={{ marginTop: 'var(--dm-sp-4)' }}><a href={props.cta_url} className="dm-cta dm-cta-primary" target="_blank" rel="noreferrer">쿠폰 사용하기</a></div>}
        </div>
      </div>
    );
  }

  // ── 스포트라이트: 코드 대형 강조 (다크 배경 + 모노) ──
  if (t === 'spotlight') {
    return (
      <div className="dm-section dm-coupon" style={{ padding: 'calc(var(--dm-sp-8) * var(--dm-section-pad-scale)) var(--dm-sp-5)', background: 'var(--dm-neutral-900)', color: '#fff' }}>
        {(props.discount_label || editable) && discountNode({ fontSize: 'var(--dm-fs-h3)', fontWeight: 700, color: 'var(--dm-accent)', letterSpacing: 1 })}
        {(props.coupon_code || editable) && (
          <div style={{ marginTop: 'var(--dm-sp-3)' }}>
            {codeNode({ fontFamily: 'var(--dm-font-mono)', fontSize: 'var(--dm-fs-hero)', fontWeight: 900, letterSpacing: 4, color: '#fff' })}
          </div>
        )}
        <div style={{ marginTop: 'var(--dm-sp-2)', color: 'var(--dm-neutral-400)' }}>{metaNode}</div>
        {ctaNode}
      </div>
    );
  }

  // ── classic (기존 — 골든 보존) ──
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
            style={{ marginTop: 'var(--dm-sp-2)', color: 'var(--dm-neutral-500)', whiteSpace: 'pre-wrap' }}
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
