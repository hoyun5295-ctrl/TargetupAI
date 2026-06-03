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
import { CONFIRM_CREDIT_COSTS, CREDIT_SOURCE_LABELS } from '../constants/credit';

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

// 통일 다크 톤 — 베이스는 slate-900, 타입 구분은 좌측 액센트 바 + 아이콘 색만(알록달록 배경 제거).
const TYPE_CONFIG: Record<ToastType, { icon: typeof CheckCircle2; accent: string; iconColor: string }> = {
  success: { icon: CheckCircle2, accent: 'bg-emerald-400', iconColor: 'text-emerald-300' },
  error: { icon: AlertCircle, accent: 'bg-rose-400', iconColor: 'text-rose-300' },
  info: { icon: Info, accent: 'bg-cyan-400', iconColor: 'text-cyan-300' },
  warning: { icon: AlertTriangle, accent: 'bg-amber-400', iconColor: 'text-amber-300' },
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

  // 사후 크레딧 토스트 — 전역 인터셉터가 dispatch한 credit:used 수신(큰 차감은 사전 모달이 안내하므로 skip).
  useEffect(() => {
    const onCredit = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!d || !d.source) return;
      if (CONFIRM_CREDIT_COSTS[d.source]) return; // 발행·게시·저장·풀분석 등 큰 차감은 모달이 안내
      const label = CREDIT_SOURCE_LABELS[d.source] || 'AI 작업';
      show('info', `${label} · ${Number(d.used).toLocaleString()} 크레딧 사용 · 잔여 ${Number(d.balance).toLocaleString()}`);
    };
    window.addEventListener('credit:used', onCredit);
    return () => window.removeEventListener('credit:used', onCredit);
  }, [show]);

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
      className="relative overflow-hidden bg-slate-900/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl shadow-black/40 pl-4 pr-3 py-3 min-w-[280px] max-w-md flex items-start gap-3 pointer-events-auto"
      role="status"
    >
      <span className={`absolute left-0 top-0 bottom-0 w-1 ${config.accent}`} aria-hidden />
      <Icon className={`w-4 h-4 ${config.iconColor} flex-shrink-0 mt-0.5`} />
      <div className="flex-1 text-[13px] text-white/90 leading-relaxed whitespace-pre-wrap">{item.message}</div>
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

/** 옛 Toast.tsx 호환 shim — setToast({msg,type}) 시그니처 유지(전환용). 신규 코드는 useToast() 직접 사용. */
export function useLegacyToast() {
  const toast = useToast();
  return (t: { msg: string; type: 'success' | 'error' } | null) => {
    if (t) toast[t.type](t.msg);
  };
}
