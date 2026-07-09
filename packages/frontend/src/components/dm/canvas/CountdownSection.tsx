/**
 * CountdownSection — 카운트다운 (실시간 틱)
 */
import { useEffect, useState } from 'react';
import type { CountdownProps } from '../../../utils/dm-section-defaults';
import InlineEditable from './InlineEditable';
import type { EditHandler } from './SectionRenderer';

function calcDiff(end: string): { d: number; h: number; m: number; s: number } {
  if (!end) return { d: 0, h: 0, m: 0, s: 0 };
  const diff = Math.max(0, new Date(end).getTime() - Date.now());
  return {
    d: Math.floor(diff / 86400000),
    h: Math.floor((diff % 86400000) / 3600000),
    m: Math.floor((diff % 3600000) / 60000),
    s: Math.floor((diff % 60000) / 1000),
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

export default function CountdownSection({ props, onEdit }: { props: CountdownProps; onEdit?: EditHandler }) {
  const [t, setT] = useState(() => calcDiff(props.end_datetime));
  const editable = !!onEdit;

  useEffect(() => {
    if (!props.end_datetime) return;
    const interval = setInterval(() => setT(calcDiff(props.end_datetime)), 1000);
    return () => clearInterval(interval);
  }, [props.end_datetime]);

  const units: Array<{ show?: boolean; val: number; label: string }> = [
    { show: props.show_days, val: t.d, label: '일' },
    { show: props.show_hours, val: t.h, label: '시간' },
    { show: props.show_minutes, val: t.m, label: '분' },
    { show: props.show_seconds, val: t.s, label: '초' },
  ];

  // ★ 2026-07-02(5) 발행물(SSR) 격상과 동일 스타일 — 에디터·발행물 시각 일치 (3면 대조)
  return (
    <div className="dm-section dm-countdown" style={{ padding: 'var(--dm-sp-8) var(--dm-sp-5)', background: props.background_color || 'var(--dm-neutral-900)', color: '#fff' }}>
      <InlineEditable
        style={{ fontSize: 'var(--dm-fs-small)', fontWeight: 700, letterSpacing: 3, color: props.urgency_color || 'var(--dm-accent)', marginBottom: 'var(--dm-sp-5)' }}
        value={props.urgency_text || '마감까지'}
        placeholder="마감 안내 문구"
        onChange={(v) => onEdit?.({ urgency_text: v } as Partial<CountdownProps>)}
        disabled={!editable}
        maxLength={40}
      />
      <div style={{ display: 'flex', gap: 'var(--dm-sp-2)', justifyContent: 'var(--dm-section-justify, center)', flexWrap: 'wrap', alignItems: 'stretch' }}>
        {units.filter(u => u.show).map((u, i) => (
          <div key={i} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 14, padding: 'var(--dm-sp-4) var(--dm-sp-3)', minWidth: 76 }}>
            <div style={{ fontSize: 34, fontWeight: 800, fontFamily: 'var(--dm-font-display)', fontVariantNumeric: 'tabular-nums', letterSpacing: 1, lineHeight: 1.1 }}>{pad(u.val)}</div>
            <div style={{ fontSize: 11, opacity: 0.55, marginTop: 6, letterSpacing: 2 }}>{u.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
