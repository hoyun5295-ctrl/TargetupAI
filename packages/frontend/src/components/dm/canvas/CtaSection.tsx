/**
 * CtaSection — CTA 버튼 (1~2개, 가로/세로)
 * 2026-07-09: 구도(treatment) 캔버스 미러 — 발행 SSR renderCta*(classic/bar/ghost)와 동일. classic 골든 보존.
 */
import type { CSSProperties } from 'react';
import type { CtaProps } from '../../../utils/dm-section-defaults';
import { ctaLayoutApplies } from '../../../utils/dm-treatment';
import InlineEditable from './InlineEditable';
import type { EditHandler } from './SectionRenderer';

export default function CtaSection({ props, onEdit, treatment }: { props: CtaProps; onEdit?: EditHandler; treatment?: string }) {
  const buttons = Array.isArray(props.buttons) ? props.buttons : [];
  const editable = !!onEdit;
  if (buttons.length === 0 && !editable) return null;

  const layout = props.layout || 'stack';
  const t = treatment || 'classic';
  // ★ 2026-09-04 (임은지 접수) 가로 여부 판정은 SSR과 **같은 CT**를 쓴다 — 조건을 각자 쓰면 한쪽만 고쳐진다.
  const isRow = layout === 'row' && ctaLayoutApplies(t, buttons.length);
  const flexDir = isRow ? 'row' : 'column';
  const flexWrap = isRow ? 'wrap' : 'nowrap';

  const updateButtonLabel = (idx: number, newLabel: string) => {
    if (!onEdit) return;
    const next = buttons.map((b, i) => (i === idx ? { ...b, label: newLabel } : b));
    onEdit({ buttons: next } as Partial<CtaProps>);
  };
  // 편집 모드 = 라벨 인라인 편집 / 읽기 모드 = 텍스트
  const labelEl = (idx: number, b: { label?: string }) => editable ? (
    <InlineEditable value={b.label || ''} placeholder="버튼 문구" onChange={(v) => updateButtonLabel(idx, v)} maxLength={30} style={{ minWidth: 60 }} />
  ) : (b.label || '자세히 보기');

  // ★ 2026-07-15 버튼 색 직접 지정(남지현·임은지) — SSR ctaBtnColorStyle 미러. 미지정 = 프리셋 유지.
  const btnColorStyle = (b: { color?: string; style?: string }): CSSProperties =>
    !b.color ? {}
      : b.style === 'outline' ? { borderColor: b.color, color: b.color }
      : { background: b.color, backgroundImage: 'none', color: '#fff' };

  // ── 바: 첫 버튼 강조 바 + 화살표 ──
  if (t === 'bar' && buttons.length > 0) {
    const b = buttons[0];
    const more = buttons.slice(1);
    const barStyle: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--dm-sp-3)', background: b.color || 'var(--dm-primary)', color: '#fff', padding: 'var(--dm-sp-5) var(--dm-sp-6)', fontSize: 'var(--dm-fs-h3)', fontWeight: 700, letterSpacing: '-0.01em', borderRadius: 16, boxShadow: 'var(--dm-shadow-md)' };
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
    // ★ 2026-09-04 SSR renderCtaGhost 미러 — 가로면 버튼이 칸을 나눠 갖는다(세로는 stretch 풀폭 그대로).
    const ghostStyleBase: CSSProperties = {
      display: 'block', textAlign: 'center', border: '2px solid var(--dm-primary)', color: 'var(--dm-primary)',
      borderRadius: 'var(--dm-radius-lg)', padding: 'var(--dm-sp-4)', fontSize: 'var(--dm-fs-body)',
      fontWeight: 700, letterSpacing: 0.5,
      ...(isRow ? { flex: '1 1 0', minWidth: 0 } : {}),
    };
    return (
      <div className="dm-section dm-cta-section" style={{ padding: 'calc(var(--dm-sp-6) * var(--dm-section-pad-scale)) var(--dm-sp-5)' }}>
        <div style={{
          display: 'flex', flexDirection: flexDir, gap: 'var(--dm-sp-3)',
          ...(isRow ? { flexWrap: 'wrap' as const, justifyContent: 'var(--dm-section-justify, center)' } : {}),
        }}>
          {buttons.map((b, i) => {
            const ghostStyle: CSSProperties = b.color ? { ...ghostStyleBase, borderColor: b.color, color: b.color } : ghostStyleBase;
            return editable ? (
              <div key={i} style={ghostStyle}>{labelEl(i, b)}</div>
            ) : (
              <a key={i} href={b.url || '#'} target="_blank" rel="noreferrer" style={ghostStyle}>{b.label || '자세히 보기'}</a>
            );
          })}
        </div>
      </div>
    );
  }

  // ── 스티키: 하단 고정 바 (★ 2026-07-13 — 래퍼 .dm-sticky-cta가 position:sticky 담당, SSR renderCtaSticky 미러) ──
  if (t === 'sticky' && buttons.length > 0) {
    const b = buttons[0];
    const stickyStyle: CSSProperties = {
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--dm-sp-2)',
      background: b.color || 'color-mix(in srgb, var(--dm-primary) 92%, transparent)', color: '#fff',
      padding: 'var(--dm-sp-4) var(--dm-sp-6)', fontSize: 'var(--dm-fs-body)', fontWeight: 800,
      letterSpacing: '-0.01em', borderRadius: 999,
      boxShadow: '0 10px 30px -8px color-mix(in srgb, var(--dm-primary) 60%, transparent)',
      backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
    };
    return (
      <div className="dm-section dm-cta-section" style={{ padding: 'var(--dm-sp-3) var(--dm-sp-4)' }}>
        {editable ? (
          <div style={stickyStyle}><span>{labelEl(0, b)}</span><span aria-hidden="true">→</span></div>
        ) : (
          <a href={b.url || '#'} target="_blank" rel="noreferrer" style={stickyStyle}><span>{b.label || '자세히 보기'}</span><span aria-hidden="true">→</span></a>
        )}
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
        justifyContent: isRow ? 'var(--dm-section-justify, center)' : undefined,
        alignItems: isRow ? undefined : 'var(--dm-section-justify, center)',
      }}>
        {buttons.map((b, i) => {
          const cls = b.style === 'secondary' ? 'dm-cta dm-cta-secondary'
                    : b.style === 'outline'   ? 'dm-cta dm-cta-outline'
                    : 'dm-cta dm-cta-primary';
          const colorStyle = btnColorStyle(b);
          return editable ? (
            <span key={i} className={cls} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, ...colorStyle }}>
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
            <a key={i} href={b.url || '#'} className={cls} target="_blank" rel="noreferrer" style={colorStyle}>
              {b.icon && <span style={{ marginRight: 'var(--dm-sp-1)' }}>{b.icon}</span>}
              {b.label || '자세히 보기'}
            </a>
          );
        })}
      </div>
    </div>
  );
}
