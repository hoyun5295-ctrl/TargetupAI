/**
 * CtaSection — CTA 버튼 (1~2개, 가로/세로)
 * 2026-07-09: 구도(treatment) 캔버스 미러 — 발행 SSR renderCta*(classic/bar/ghost)와 동일. classic 골든 보존.
 */
import type { CSSProperties } from 'react';
import type { CtaProps } from '../../../utils/dm-section-defaults';
import InlineEditable from './InlineEditable';
import type { EditHandler } from './SectionRenderer';

export default function CtaSection({ props, onEdit, treatment }: { props: CtaProps; onEdit?: EditHandler; treatment?: string }) {
  const buttons = Array.isArray(props.buttons) ? props.buttons : [];
  const editable = !!onEdit;
  if (buttons.length === 0 && !editable) return null;

  const layout = props.layout || 'stack';
  const flexDir = layout === 'row' ? 'row' : 'column';
  const flexWrap = layout === 'row' ? 'wrap' : 'nowrap';
  const t = treatment || 'classic';

  const updateButtonLabel = (idx: number, newLabel: string) => {
    if (!onEdit) return;
    const next = buttons.map((b, i) => (i === idx ? { ...b, label: newLabel } : b));
    onEdit({ buttons: next } as Partial<CtaProps>);
  };
  // 편집 모드 = 라벨 인라인 편집 / 읽기 모드 = 텍스트
  const labelEl = (idx: number, b: { label?: string }) => editable ? (
    <InlineEditable value={b.label || ''} placeholder="버튼 문구" onChange={(v) => updateButtonLabel(idx, v)} maxLength={30} style={{ minWidth: 60 }} />
  ) : (b.label || '자세히 보기');

  // ── 바: 첫 버튼 강조 바 + 화살표 ──
  if (t === 'bar' && buttons.length > 0) {
    const b = buttons[0];
    const more = buttons.slice(1);
    const barStyle: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--dm-sp-3)', background: 'var(--dm-primary)', color: '#fff', padding: 'var(--dm-sp-5) var(--dm-sp-6)', fontSize: 'var(--dm-fs-h3)', fontWeight: 700, letterSpacing: '-0.01em', borderRadius: 16, boxShadow: 'var(--dm-shadow-md)' };
    const arrow = <span aria-hidden="true" style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(255,255,255,0.18)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0 }}>→</span>;
    return (
      <div className="dm-section dm-cta-section" style={{ padding: 'var(--dm-sp-5)' }}>
        {editable ? (
          <div style={barStyle}><span>{labelEl(0, b)}</span>{arrow}</div>
        ) : (
          <a href={b.url || '#'} target="_blank" rel="noreferrer" style={barStyle}><span>{b.label || '자세히 보기'}</span>{arrow}</a>
        )}
        {more.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--dm-sp-2)', padding: 'var(--dm-sp-4) 0 0' }}>
            {more.map((x, i) => editable ? (
              <span key={i + 1} className="dm-cta dm-cta-secondary" style={{ display: 'inline-flex', alignItems: 'center' }}>{labelEl(i + 1, x)}</span>
            ) : (
              <a key={i + 1} href={x.url || '#'} className="dm-cta dm-cta-secondary" target="_blank" rel="noreferrer">{x.label || '자세히 보기'}</a>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── 고스트: 아웃라인 대형 라벨 ──
  if (t === 'ghost' && buttons.length > 0) {
    const ghostStyle: CSSProperties = { display: 'block', textAlign: 'center', border: '2px solid var(--dm-primary)', color: 'var(--dm-primary)', borderRadius: 'var(--dm-radius-lg)', padding: 'var(--dm-sp-4)', fontSize: 'var(--dm-fs-body)', fontWeight: 700, letterSpacing: 0.5 };
    return (
      <div className="dm-section dm-cta-section" style={{ padding: 'calc(var(--dm-sp-6) * var(--dm-section-pad-scale)) var(--dm-sp-5)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--dm-sp-3)' }}>
          {buttons.map((b, i) => editable ? (
            <div key={i} style={ghostStyle}>{labelEl(i, b)}</div>
          ) : (
            <a key={i} href={b.url || '#'} target="_blank" rel="noreferrer" style={ghostStyle}>{b.label || '자세히 보기'}</a>
          ))}
        </div>
      </div>
    );
  }

  // ── classic (기존 — 골든 보존) ──
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
