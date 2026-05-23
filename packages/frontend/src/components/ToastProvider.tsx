/**
 * ToastProvider.tsx — Generic 알림 토스트 (D212+ 2026-05-23 Harold 명시)
 *
 * 본질: native alert() 영구 폐기 — 항상 커스텀 다크 톤 toast 의무 (영구 룰 feedback_no_native_browser_dialog 정합)
 *   - 우측 상단 영역 stacked + 자동 사라짐 (3초)
 *   - success / error / info / warning 4 모드
 *   - 다크 톤 매트릭스
 *
 * 사용 패턴:
 *   const toast = useToast();
 *   toast.success('저장되었습니다');
 *   toast.error('처리 중 오류 발생');
 *   toast.info('AI가 분석 중입니다');
 *
 * App.tsx 안 ToastProvider 통합 의무.
 *
 * ★ 옛 Toast.tsx 영역 = 단일 인스턴스 + 옛 호출처 영역 영향 0건 (legacy 호환)
 */

import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  duration: number;
}

interface ToastContextValue {
  show: (type: ToastType, message: string, duration?: number) => void;
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
  info: (message: string, duration?: number) => void;
  warning: (message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TYPE_CONFIG: Record<ToastType, { icon: typeof CheckCircle2; bg: string; border: string; text: string; iconColor: string }> = {
  success: {
    icon: CheckCircle2,
    bg: 'bg-emerald-500/15',
    border: 'border-emerald-400/40',
    text: 'text-emerald-100',
    iconColor: 'text-emerald-300',
  },
  error: {
    icon: AlertCircle,
    bg: 'bg-rose-500/15',
    border: 'border-rose-400/40',
    text: 'text-rose-100',
    iconColor: 'text-rose-300',
  },
  info: {
    icon: Info,
    bg: 'bg-cyan-500/15',
    border: 'border-cyan-400/40',
    text: 'text-cyan-100',
    iconColor: 'text-cyan-300',
  },
  warning: {
    icon: AlertTriangle,
    bg: 'bg-amber-500/15',
    border: 'border-amber-400/40',
    text: 'text-amber-100',
    iconColor: 'text-amber-300',
  },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const remove = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((type: ToastType, message: string, duration = 3000) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, type, message, duration }]);
  }, []);

  const value: ToastContextValue = {
    show,
    success: (message, duration) => show('success', message, duration),
    error: (message, duration) => show('error', message, duration),
    info: (message, duration) => show('info', message, duration),
    warning: (message, duration) => show('warning', message, duration),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <ToastBox key={t.id} item={t} onClose={() => remove(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastBox({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  const config = TYPE_CONFIG[item.type];
  const Icon = config.icon;

  useEffect(() => {
    if (item.duration <= 0) return;
    const timer = setTimeout(onClose, item.duration);
    return () => clearTimeout(timer);
  }, [item.duration, onClose]);

  return (
    <div
      className={`${config.bg} border ${config.border} backdrop-blur-md rounded-xl shadow-2xl px-4 py-3 min-w-[280px] max-w-md flex items-start gap-3 pointer-events-auto`}
      role="status"
    >
      <Icon className={`w-4 h-4 ${config.iconColor} flex-shrink-0 mt-0.5`} />
      <div className={`flex-1 text-[13px] ${config.text} leading-relaxed whitespace-pre-wrap`}>{item.message}</div>
      <button
        onClick={onClose}
        className="p-0.5 hover:bg-white/10 rounded transition-colors flex-shrink-0"
        aria-label="닫기"
      >
        <X className="w-3 h-3 text-white/50" />
      </button>
    </div>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // fallback — Provider 영역 없으면 console.warn (사용자 노출 X)
    return {
      show: (type, message) => console.warn(`[Toast 미통합] ${type}: ${message}`),
      success: (message) => console.warn(`[Toast 미통합] success: ${message}`),
      error: (message) => console.warn(`[Toast 미통합] error: ${message}`),
      info: (message) => console.warn(`[Toast 미통합] info: ${message}`),
      warning: (message) => console.warn(`[Toast 미통합] warning: ${message}`),
    };
  }
  return ctx;
}
