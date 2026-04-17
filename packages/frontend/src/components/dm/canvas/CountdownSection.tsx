/**
 * CountdownSection — 카운트다운 (실시간 틱)
 */
import { useEffect, useState } from 'react';
import type { CountdownProps } from '../../../utils/dm-section-defaults';

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

export default function CountdownSection({ props }: { props: CountdownProps }) {
  const [t, setT] = useState(() => calcDiff(props.end_datetime));

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

  return (
    <div className="dm-section dm-countdown" style={{ padding: 'var(--dm-sp-6) var(--dm-sp-5)', background: 'var(--dm-neutral-900)', color: '#fff', textAlign: 'center' }}>
      <div className="dm-text-h3" style={{ color: 'var(--dm-accent)', fontWeight: 700, marginBottom: 'var(--dm-sp-3)' }}>
        {props.urgency_text || '마감까지'}
      </div>
      <div style={{ display: 'flex', gap: 'var(--dm-sp-3)', justifyContent: 'center', flexWrap: 'wrap' }}>
        {units.filter(u => u.show).map((u, i) => (
          <div key={i} style={{ background: 'rgba(255,255,255,0.1)', borderRadius: 'var(--dm-radius-md)', padding: 'var(--dm-sp-3) var(--dm-sp-4)', minWidth: 64 }}>
            <div style={{ fontSize: 'var(--dm-fs-h1)', fontWeight: 900, fontFamily: 'var(--dm-font-mono)' }}>{pad(u.val)}</div>
            <div style={{ fontSize: 'var(--dm-fs-tiny)', opacity: 0.8, marginTop: 2 }}>{u.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
