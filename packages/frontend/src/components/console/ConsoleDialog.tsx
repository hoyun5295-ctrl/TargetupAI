/**
 * ConsoleDialog — 작성기 부속 모달(특수문자·보관함·문자 저장) 공용 셸 (★ 2026-08-21 신설)
 *
 * 왜 있는가:
 *   직접발송·직접 타겟 발송이 함께 쓰는 부속 모달 3종이 Dashboard.tsx 안에 인라인으로 있었고
 *   전부 옛 규격이었다: 이모지 제목(✨ 📂 💾), 헤더 색 제각각(purple / amber / emerald), 회색 border,
 *   글자 ✕. 정작 그 모달이 뜨는 직접 타겟 발송은 인디고 콘솔 톤이라 **부속 단계에서만 화면 품질이 떨어졌다.**
 *   각자 적으면 다음에 또 갈라지므로 셸 하나로 뽑는다.
 *
 * 톤 = `console-ui.ts`의 폼 모달 토큰(CUI_MODAL*) 그대로. 색은 **호출자가 고른다**:
 *   직접 타겟 발송 = indigo(콘솔 톤), 직접발송 = emerald(그 패널의 `ds-*` 색). 직접발송을 인디고로 맞출지는
 *   별건(콘솔 톤 문서 §5)이라 여기서 그쪽 색을 바꾸지 않는다.
 *
 * 층: 발송 셸(SendWorkspaceShell, 호출부가 z-50을 넘긴다) 위에 떠야 해서 z-[70]. body 끝에 포털로 붙인다.
 * ⛔ 스크림·박스에 transform·backdrop-filter를 넣지 않는다(CUI_MODAL 주석의 P0 경위. 등장 효과는 opacity만).
 * 백드롭 클릭으로 닫히지 않는다(작성 중 오클릭 보호). 닫기 = X·ESC.
 */

import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { CUI_MODAL, CUI_MODAL_CLOSE, CUI_MODAL_HEAD, CUI_MODAL_TITLE, CUI_MODAL_DESC } from '../../utils/console-ui';

export type ConsoleAccent = 'indigo' | 'emerald';

/** 호출자별 강조색. 값은 여기 한 곳만 소유한다(모달 3종이 같은 표를 읽는다). */
export const CONSOLE_ACCENT = {
  indigo: {
    badge: 'bg-indigo-600 text-white',
    primary: 'bg-indigo-600 text-white hover:bg-indigo-700 focus-visible:ring-indigo-600/20',
    hoverCell: 'hover:ring-indigo-400 hover:bg-indigo-50 hover:text-indigo-700',
    focusField: 'focus:border-indigo-600 focus:ring-indigo-600/15',
    link: 'text-indigo-600 hover:text-indigo-700',
    pill: 'bg-indigo-50 text-indigo-700',
  },
  emerald: {
    badge: 'bg-emerald-600 text-white',
    primary: 'bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:ring-emerald-600/20',
    hoverCell: 'hover:ring-emerald-400 hover:bg-emerald-50 hover:text-emerald-700',
    focusField: 'focus:border-emerald-600 focus:ring-emerald-600/15',
    link: 'text-emerald-700 hover:text-emerald-800',
    pill: 'bg-emerald-50 text-emerald-700',
  },
} as const;

/** 주 버튼. CUI_BTN_PRIMARY와 같은 골격에 색만 호출자 것을 입힌다. */
export const CONSOLE_BTN_BASE =
  'h-9 px-3.5 inline-flex items-center justify-center gap-1.5 rounded-lg text-[13.5px] font-semibold whitespace-nowrap ' +
  'transition active:scale-[.98] motion-reduce:active:scale-100 disabled:opacity-40 disabled:pointer-events-none ' +
  'focus:outline-none focus-visible:ring-4';

interface Props {
  show: boolean;
  accent: ConsoleAccent;
  icon: ReactNode;
  title: string;
  subtitle?: string;
  /** 박스 최대 폭. 기본 max-w-[420px] */
  maxW?: string;
  onClose: () => void;
  children: ReactNode;
  /** 하단 버튼 줄. 없으면 렌더하지 않는다 */
  footer?: ReactNode;
}

export default function ConsoleDialog({ show, accent, icon, title, subtitle, maxW = 'max-w-[420px]', onClose, children, footer }: Props) {
  // ESC는 **이 창만** 닫는다. 아래 깔린 발송 셸(SendWorkspaceShell)도 window keydown으로 ESC를 듣고 있어,
  //   같은 버블 단계에 두면 기호 창을 닫으려다 발송 창까지 닫힌다 → 캡처 단계에서 먼저 받고 전파를 끊는다.
  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [show, onClose]);

  if (!show) return null;
  const tone = CONSOLE_ACCENT[accent];

  return createPortal(
    <div className="fixed inset-0 z-[70] bg-neutral-900/45 flex items-center justify-center p-4 animate-in fade-in duration-150 motion-reduce:animate-none">
      <div className={`${CUI_MODAL} ${maxW}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className={CUI_MODAL_HEAD}>
          <div className="flex items-center gap-3 min-w-0">
            <div className={`h-9 w-9 shrink-0 rounded-xl grid place-items-center ${tone.badge}`}>{icon}</div>
            <div className="min-w-0">
              <h3 className={CUI_MODAL_TITLE}>{title}</h3>
              {subtitle && <p className={CUI_MODAL_DESC}>{subtitle}</p>}
            </div>
          </div>
          <button type="button" onClick={onClose} className={CUI_MODAL_CLOSE} aria-label="닫기">
            <X className="w-4 h-4" strokeWidth={1.75} />
          </button>
        </div>
        {children}
        {footer}
      </div>
    </div>,
    document.body,
  );
}
