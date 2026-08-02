/**
 * JourneyModalShell — 여정 모달의 공용 껍데기 (2026-08-02)
 *
 * 진입 추천·저장 브리핑·마케팅 진입 셋이 같은 접근성 계약을 각자 빠뜨렸다.
 * 모달마다 붙이면 다음 모달에서 또 빠지므로 **껍데기 하나가 소유**한다.
 *
 * 여기서 책임지는 것
 *   - `role="dialog"` + `aria-modal` + 제목 연결(`aria-labelledby`)
 *   - 열릴 때 안으로 포커스 이동, Tab이 배경으로 새지 않게 가둠
 *   - Escape로 닫기, 닫은 뒤 **열었던 버튼으로 포커스 복귀**
 *   - 바깥(배경) 클릭으로 닫기
 *
 * 모양(헤더·본문·푸터)은 각 모달이 그린다 — 껍데기는 동작만 가진다.
 */
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface Props {
  open: boolean;
  onClose: () => void;
  /** 제목 요소의 id — 스크린리더가 이 모달이 무엇인지 읽는 근거. */
  labelledBy: string;
  children: React.ReactNode;
  /** 패널 클래스 — 모달마다 폭이 다르다. */
  panelClassName?: string;
  /** 겹침 순서. 다른 모달 위에 뜰 때만 올린다. */
  zIndexClassName?: string;
}

export default function JourneyModalShell({
  open, onClose, labelledBy, children,
  panelClassName = 'w-full max-w-2xl',
  zIndexClassName = 'z-[60]',
}: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = (document.activeElement as HTMLElement) || null;

    // 열리면 안쪽 첫 조작 대상으로 포커스를 옮긴다(없으면 패널 자체).
    const focusFirst = () => {
      const panel = panelRef.current;
      if (!panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      (items.find((el) => el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') || items[0] || panel).focus();
    };
    const raf = requestAnimationFrame(focusFirst);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      // 배경으로 새는 두 경계만 되돌린다 — 안쪽 이동은 브라우저 기본 순서를 그대로 둔다.
      if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKeyDown, true);
      // 닫은 뒤 열었던 자리로 돌아간다 — 안 하면 포커스가 문서 처음으로 튄다.
      restoreRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className={`fixed inset-0 ${zIndexClassName} flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm md:items-center md:p-6`}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={`flex max-h-[92vh] flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-slate-900 shadow-2xl outline-none md:rounded-2xl ${panelClassName}`}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
