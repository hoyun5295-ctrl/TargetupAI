/**
 * Click 자동 수집 (보수 — §5 #5).
 * 기본 수집값 = tag + role + data-hjl-event + href sanitized + position 한정.
 * innerText = 기본 OFF — data-hjl-capture="text" opt-in 한정 (개인정보/주문번호 섞임 위험 차단).
 */

import { maskUrl } from './pii-masking';

export interface ClickEvent {
  tag: string;
  role?: string;
  event?: string;
  href?: string;
  text?: string;
  position?: { x: number; y: number };
}

export function setupClickTracking(emit: (event: ClickEvent) => void): () => void {
  if (typeof document === 'undefined') return () => {};

  const handler = (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target || !target.tagName) return;

    const event: ClickEvent = {
      tag: target.tagName.toLowerCase(),
      position: { x: e.clientX, y: e.clientY },
    };

    const role = target.getAttribute('role');
    if (role) event.role = role;

    const hjlEvent = target.getAttribute('data-hjl-event');
    if (hjlEvent) event.event = hjlEvent;

    if (target.tagName === 'A') {
      const href = (target as HTMLAnchorElement).href;
      if (href) event.href = maskUrl(href);
    }

    if (target.getAttribute('data-hjl-capture') === 'text') {
      const text = target.textContent?.trim();
      if (text) event.text = text.slice(0, 100);
    }

    emit(event);
  };

  document.addEventListener('click', handler, true);

  return () => {
    document.removeEventListener('click', handler, true);
  };
}
