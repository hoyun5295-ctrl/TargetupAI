/**
 * dm-primitives.tsx — DM 캔버스 신규 섹션 공통 빌딩블록 (React, backend dm-render-primitives 미러)
 * 큰 이모지 대신 단색 SVG 아이콘 + 토큰 기반 이벤트 카드 + 공통 CTA 스타일.
 */
import type { CSSProperties, ReactNode } from 'react';

export type DmIconName = 'gift' | 'wheel' | 'ticket' | 'clock' | 'poll' | 'survey' | 'mail' | 'star' | 'image' | 'map' | 'play' | 'heart';

const ICON_PATHS: Record<DmIconName, string> = {
  gift:   '<path d="M20 12v9H4v-9M2 7h20v5H2zM12 22V7M12 7C12 7 9 2 6.5 4S8 7 12 7zM12 7c0 0 3-5 5.5-3S16 7 12 7z"/>',
  wheel:  '<circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4"/>',
  ticket: '<path d="M3 7h18v4a2 2 0 000 4v2H3v-2a2 2 0 000-4z"/><path d="M15 7v10" stroke-dasharray="2 2"/>',
  clock:  '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  poll:   '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  survey: '<path d="M5 3h14v18H5zM9 8h6M9 12h6M9 16h4"/>',
  mail:   '<path d="M3 5h18v14H3z"/><path d="M3 6l9 7 9-7"/>',
  star:   '<path d="M12 3l2.9 6 6.6.6-5 4.3 1.6 6.5L12 17l-6.1 3.4L7.5 14l-5-4.3 6.6-.6z"/>',
  image:  '<path d="M3 5h18v14H3z"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 17l-6-6-9 9"/>',
  map:    '<path d="M9 3L3 6v15l6-3 6 3 6-3V3l-6 3-6-3zM9 3v15M15 6v15"/>',
  play:   '<circle cx="12" cy="12" r="9"/><path d="M10 9l5 3-5 3z"/>',
  heart:  '<path d="M12 21C12 21 3 14 3 8a4.5 4.5 0 019-1 4.5 4.5 0 019 1c0 6-9 13-9 13z"/>',
};

/** 단색 인라인 SVG 아이콘(currentColor). 알 수 없는 이름은 null. */
export function DmIcon({ name, size = 22 }: { name: DmIconName; size?: number }) {
  const p = ICON_PATHS[name];
  if (!p) return null;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden dangerouslySetInnerHTML={{ __html: p }} />
  );
}

const EVENT_CARD_STYLE: CSSProperties = {
  padding: 'var(--dm-sp-6) var(--dm-sp-5)',
  background: 'var(--dm-neutral-50)',
  border: '1px solid var(--dm-neutral-200)',
  borderRadius: 'var(--dm-radius-xl)',
  boxShadow: 'var(--dm-shadow-md)',
  margin: 'var(--dm-sp-3) 0',
};

/** 이벤트/강조 섹션 공통 셸 — 토큰 배경 + 라운드 + 그림자. accentVar는 아이콘 색 CSS 변수명. */
export function DmEventCard({ accentVar, icon, children }: { accentVar: string; icon?: DmIconName; children: ReactNode }) {
  return (
    <div style={EVENT_CARD_STYLE}>
      {icon && <div style={{ color: `var(${accentVar})`, marginBottom: 'var(--dm-sp-3)' }}><DmIcon name={icon} size={26} /></div>}
      {children}
    </div>
  );
}

/** 공통 CTA 버튼 스타일(토큰). 풀폭이 필요하면 { ...DM_CTA_STYLE, width: '100%' }. */
export const DM_CTA_STYLE: CSSProperties = {
  minHeight: 44,
  padding: '0 24px',
  background: 'var(--dm-primary)',
  color: '#fff',
  border: 'none',
  borderRadius: 'var(--dm-radius-md)',
  fontSize: 'var(--dm-fs-body)',
  fontWeight: 700,
  cursor: 'pointer',
};
