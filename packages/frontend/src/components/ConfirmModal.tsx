/**
 * ConfirmModal.tsx — Generic 확인 모달 (D212+ 2026-05-23 Harold 명시)
 *
 * 본질: native confirm() 영구 폐기 — 항상 커스텀 다크 톤 모달 의무 (영구 룰 feedback_no_native_browser_dialog 정합)
 *   - mode 영역 분기 (default / info / warning / danger)
 *   - 다크 톤 매트릭스 (bg-slate-900 + border-white/10 + rounded-2xl + shadow-2xl)
 *   - ESC 닫기 + backdrop click 닫기 + autoFocus on confirm button
 *
 * 사용 패턴:
 *   const [confirm, setConfirm] = useState<ConfirmState | null>(null);
 *   ...
 *   setConfirm({ mode: 'danger', title: '...', description: '...', onConfirm: async () => {...} });
 *   ...
 *   <ConfirmModal state={confirm} onClose={() => setConfirm(null)} />
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, AlertTriangle, Info, AlertCircle, Check } from 'lucide-react';

export type ConfirmMode = 'default' | 'info' | 'warning' | 'danger';

export interface ConfirmState {
  mode?: ConfirmMode;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void | Promise<void>;
}

interface Props {
  state: ConfirmState | null;
  onClose: () => void;
}

const MODE_CONFIG: Record<ConfirmMode, {
  icon: typeof AlertTriangle;
  iconBg: string;
  iconText: string;
  border: string;
  button: string;
  defaultConfirm: string;
}> = {
  default: {
    icon: Check,
    iconBg: 'bg-indigo-500/20',
    iconText: 'text-indigo-300',
    border: 'border-indigo-400/30',
    button: 'bg-indigo-500/40 hover:bg-indigo-500/60 text-indigo-50',
    defaultConfirm: '확인',
  },
  info: {
    icon: Info,
    iconBg: 'bg-cyan-500/20',
    iconText: 'text-cyan-300',
    border: 'border-cyan-400/30',
    button: 'bg-cyan-500/40 hover:bg-cyan-500/60 text-cyan-50',
    defaultConfirm: '확인',
  },
  warning: {
    icon: AlertCircle,
    iconBg: 'bg-amber-500/20',
    iconText: 'text-amber-300',
    border: 'border-amber-400/30',
    button: 'bg-amber-500/40 hover:bg-amber-500/60 text-amber-50',
    defaultConfirm: '진행',
  },
  danger: {
    icon: AlertTriangle,
    iconBg: 'bg-rose-500/20',
    iconText: 'text-rose-300',
    border: 'border-rose-400/40',
    button: 'bg-rose-500/40 hover:bg-rose-500/60 text-rose-50',
    defaultConfirm: '삭제',
  },
};

export default function ConfirmModal({ state, onClose }: Props) {
  const [running, setRunning] = useState(false);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const open = !!state;
  const config = MODE_CONFIG[state?.mode || 'default'];
  const Icon = config.icon;

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onEsc);
    setTimeout(() => confirmBtnRef.current?.focus(), 50);
    return () => window.removeEventListener('keydown', onEsc);
  }, [open, onClose]);

  if (!open || !state) return null;

  const handleConfirm = async () => {
    setRunning(true);
    try {
      await state.onConfirm();
      onClose();
    } catch {
      // 호출자가 에러 핸들링 의무 — modal은 닫지 않음
    } finally {
      setRunning(false);
    }
  };

  return createPortal(
    // ★ 2026-06-25: 확인/차단 모달 통일 티어 z-[2000] — DM ModalBase(1000) 위, 시스템 모달(9997+) 아래.
    //   (확인창은 자신을 띄운 모달보다 항상 위에 떠야 함. 기존 z-[140]은 DM 모달 뒤로 깔리던 결함.)
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[2000] p-4"
    >
      <div
        className={`bg-slate-900 border ${config.border} rounded-2xl shadow-2xl max-w-md w-full overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl ${config.iconBg} flex items-center justify-center`}>
              <Icon className={`w-5 h-5 ${config.iconText}`} />
            </div>
            <h3 className="text-base font-semibold text-white">{state.title}</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"
            aria-label="닫기"
          >
            <X className="w-4 h-4 text-white/50" />
          </button>
        </div>

        {/* 본문 */}
        {state.description && (
          <div className="px-5 py-4">
            <div className="text-sm text-white/75 leading-relaxed whitespace-pre-wrap">
              {state.description}
            </div>
          </div>
        )}

        {/* 액션 */}
        <div className="flex items-center gap-2 p-5 border-t border-white/10 bg-slate-950/50">
          <button
            onClick={onClose}
            disabled={running}
            className="flex-1 px-4 py-2 bg-white/5 hover:bg-white/10 disabled:opacity-50 text-white/80 rounded-lg text-sm font-medium transition-colors"
          >
            {state.cancelLabel || '취소'}
          </button>
          <button
            ref={confirmBtnRef}
            onClick={handleConfirm}
            disabled={running}
            className={`flex-1 px-4 py-2 ${config.button} disabled:opacity-30 disabled:cursor-not-allowed rounded-lg text-sm font-semibold transition-colors`}
          >
            {running ? '진행 중' : (state.confirmLabel || config.defaultConfirm)}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
