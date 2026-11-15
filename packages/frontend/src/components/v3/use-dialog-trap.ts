/**
 * use-dialog-trap.ts — 창이 떠 있는 동안의 키보드 규칙 한 곳 (★ 2026-11-15 C135)
 *   Esc = 닫기 · Tab · Shift+Tab 은 창 안에서만 돈다 · 뒤 화면 스크롤 잠금 · 닫으면 포커스를 원래 자리로.
 *   처음 포커스 = 창 자체(tabindex -1 을 준 자리) — 버튼에 포커스 테두리가 미리 그려지지 않는다. Tab 을 누르면 첫 버튼부터 돈다.
 */
import { useEffect, useRef, type RefObject } from 'react';

export function useDialogTrap(rootRef: RefObject<HTMLElement>, onClose: () => void): void {
  // 닫기 함수는 부모가 다시 그릴 때마다 새로 온다 → 최신 것을 담아 두고 쓴다(효과를 다시 돌리면 포커스가 처음 자리로 튄다)
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    const focusables = (): HTMLElement[] => {
      const root = rootRef.current;
      if (!root) return [];
      // 보이는 것만 — 숨은 장면의 버튼(visibility: hidden)이 처음 · 끝 자리에 끼면 포커스를 못 옮겨 창 밖으로 샌다.
      // 링크는 a[href] 로만 — 그냥 [href] 는 아이콘의 <use href> 까지 잡는다.
      return Array.from(root.querySelectorAll<HTMLElement>('button, a[href], [tabindex]:not([tabindex="-1"])'))
        .filter((el) => !el.hasAttribute('disabled') && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden');
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { closeRef.current(); return; }
      if (e.key !== 'Tab') return;
      const root = rootRef.current;
      const items = focusables();
      if (!root || items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      // 창 자체에 포커스가 있을 때(처음 상태)의 Shift+Tab 도 끝 버튼으로 돌린다(앞쪽은 창 밖이다)
      const outside = !root.contains(active) || active === root;
      if (e.shiftKey && (active === first || outside)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || !root.contains(active))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    rootRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus?.();
    };
  }, [rootRef]);
}
