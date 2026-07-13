/**
 * PromoCodeSection — 프로모션 코드
 */
import type { PromoCodeProps } from '../../../utils/dm-section-defaults';
import InlineEditable from './InlineEditable';
import type { EditHandler } from './SectionRenderer';

export default function PromoCodeSection({ props, onEdit, treatment }: { props: PromoCodeProps; onEdit?: EditHandler; treatment?: string }) {
  const editable = !!onEdit;
  if (!props.code && !editable) return null;

  // ── 라이트: 브랜드색 테두리 카드 (★ 2026-07-13 — SSR renderPromoCodeLight 미러) ──
  if (treatment === 'light') {
    return (
      <div className="dm-section dm-promo-code" style={{ padding: 'calc(var(--dm-sp-6) * var(--dm-section-pad-scale)) var(--dm-sp-5)', background: 'var(--dm-bg)' }}>
        <div style={{ border: '2px solid color-mix(in srgb, var(--dm-primary) 35%, transparent)', borderRadius: 20, padding: 'var(--dm-sp-6)', boxShadow: 'var(--dm-shadow-sm)' }}>
          <div className="dm-overline" style={{ color: 'var(--dm-primary)', marginBottom: 'var(--dm-sp-3)' }}>PROMO CODE</div>
          {(props.description || editable) && (
            <InlineEditable className="dm-text-h3" style={{ fontWeight: 600, marginBottom: 'var(--dm-sp-4)', color: 'var(--dm-neutral-800)' }}
              value={props.description || ''} placeholder="프로모션 설명"
              onChange={(v) => onEdit?.({ description: v } as Partial<PromoCodeProps>)} disabled={!editable} maxLength={50} />
          )}
          <InlineEditable
            style={{ fontFamily: 'var(--dm-font-mono)', fontSize: 'var(--dm-fs-h1)', fontWeight: 800, letterSpacing: 5, padding: 'var(--dm-sp-3) var(--dm-sp-5)', border: '1px dashed color-mix(in srgb, var(--dm-primary) 45%, transparent)', borderRadius: 14, display: 'inline-block', color: 'var(--dm-primary)' }}
            value={props.code || ''} placeholder="PROMO2026"
            onChange={(v) => onEdit?.({ code: v } as Partial<PromoCodeProps>)} disabled={!editable} maxLength={20} />
          {(props.instructions || editable) && (
            <InlineEditable className="dm-text-small" style={{ marginTop: 'var(--dm-sp-4)', color: 'var(--dm-neutral-500)' }}
              value={props.instructions || ''} placeholder="코드 사용 방법 안내 (선택)"
              onChange={(v) => onEdit?.({ instructions: v } as Partial<PromoCodeProps>)} disabled={!editable} multiline maxLength={150} />
          )}
        </div>
      </div>
    );
  }

  // ── classic: 다크 에디토리얼 패널 (★ 2026-07-13 — 발행 SSR renderPromoCode와 3면 일치 정렬. 옛 캔버스 원색 그라데이션 = 발행물과 불일치라 SSR 기준으로 미러) ──
  return (
    <div className="dm-section dm-promo-code" style={{ padding: 'var(--dm-sp-8) var(--dm-sp-5)', background: '#171717', color: '#fff' }}>
      <div className="dm-overline" style={{ color: 'var(--dm-accent)', marginBottom: 'var(--dm-sp-3)' }}>PROMO CODE</div>
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
        style={{ display: 'inline-block', padding: 'var(--dm-sp-3) var(--dm-sp-5)', borderRadius: 14, fontFamily: 'var(--dm-font-mono)', fontSize: 'var(--dm-fs-h1)', fontWeight: 800, letterSpacing: 5, border: '1px dashed rgba(255,255,255,0.35)' }}
        value={props.code || ''}
        placeholder="PROMO2026"
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
          <a href={props.cta_url} className="dm-cta" target="_blank" rel="noreferrer" style={{ background: '#fff', color: '#171717' }}>
            {props.cta_label || '지금 사용하기'}
          </a>
        </div>
      )}
    </div>
  );
}
