/**
 * dm-render-primitives.ts — DM 섹션 SSR 공통 빌딩블록 (토큰 기반, 순수)
 *
 * 목적: 신규 16섹션이 공유하는 정제된 디자인 조각. 큰 이모지 + 하드코딩 색 대신
 *       단색 인라인 SVG 아이콘과 디자인 토큰(var(--dm-*))만 사용한다.
 *
 * 소비처: dm-section-renderer.ts (renderLuckyDraw / renderRoulette / ... 등)
 * 외부 의존 0 — DB-free 순수.
 */

export const ICON_NAMES = [
  'gift', 'wheel', 'ticket', 'clock', 'poll', 'survey', 'mail', 'star', 'image', 'map', 'play', 'heart',
] as const;
export type IconName = typeof ICON_NAMES[number];

// 단색 라인 아이콘(24x24, currentColor). 이모지 대체 — SMS/뷰어 호환·톤 일관.
const ICON_PATHS: Record<IconName, string> = {
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

/** 단색 인라인 SVG 아이콘. 알 수 없는 이름은 빈 문자열(깨진 출력 방지). */
export function dmIcon(name: IconName, size = 22): string {
  const p = ICON_PATHS[name];
  if (!p) return '';
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}

/**
 * 이벤트/강조 섹션 공통 셸 — 토큰 배경 + 라운드 + 그림자.
 * accentVar는 아이콘 색으로 쓸 CSS 변수명(예: '--dm-accent').
 */
export function dmEventCard(opts: { accentVar: string; body: string; icon?: IconName }): string {
  const icon = opts.icon
    ? `<div style="color:var(${opts.accentVar});margin-bottom:var(--dm-sp-3)">${dmIcon(opts.icon, 26)}</div>`
    : '';
  return `<div style="padding:var(--dm-sp-6) var(--dm-sp-5);background:var(--dm-neutral-50);border:1px solid var(--dm-neutral-200);border-radius:var(--dm-radius-xl);box-shadow:var(--dm-shadow-md);margin:var(--dm-sp-3) 0">${icon}${opts.body}</div>`;
}
