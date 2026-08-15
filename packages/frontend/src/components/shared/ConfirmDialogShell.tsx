/**
 * ConfirmDialogShell — 발송 계열 확인 다이얼로그 공용 셸 (★ 2026-08-15 신설)
 *
 * 왜 신설했나:
 *   발송 확인 모달들(즉시/예약 확인·회신번호 제외·이름 누락 경고)이 각자 셸을 적고 있었고
 *   전부 옛 규격이었다 — `bg-black bg-opacity-50` 백드롭, 이모지 제목(⚡📅⚠️), `border-b` 회색선,
 *   꽉 찬 하단 버튼 바. 정작 그 모달이 뜨는 화면(`SendWorkspaceShell`)은 화이트 고급형이라
 *   **확인 단계에서만 화면 품질이 떨어졌다.** 각자 적으면 다음에 또 갈라지므로 셸로 뽑는다.
 *
 * 톤 — SendWorkspaceShell과 **같은 언어**(2026-07-31 Harold 확정 화이트 고급형):
 *   · 경계 = `ring-1 ring-slate-900/5` + 깊은 그림자(테두리 선을 쓰지 않는다)
 *   · 면 분리 = `bg-slate-50/70` 서브 서페이스
 *   · 강조색 = 아이콘 배지·주 버튼·수치에만. 넓은 면에 칠하지 않는다
 *   · 이모지 0 — 의미는 lucide 아이콘이 진다
 *
 * 백드롭 클릭으로 닫히지 않는다(오클릭 = 발송 취소 또는 오발송). 닫기는 취소 버튼·ESC만.
 * 처리 중(busy)에는 ESC도 막는다 — 요청이 나간 뒤 창만 닫히면 결과를 볼 곳이 사라진다.
 */

import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Loader2 } from 'lucide-react';

export type DialogTone = 'emerald' | 'blue' | 'amber' | 'violet' | 'rose';

const TONE = {
  emerald: {
    badge: 'from-emerald-500 to-teal-500',
    badgeShadow: 'shadow-emerald-500/25',
    tint: 'from-emerald-50/70 via-white to-white',
    primary: 'bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 shadow-emerald-500/25',
    value: 'text-emerald-600',
  },
  blue: {
    badge: 'from-blue-500 to-indigo-500',
    badgeShadow: 'shadow-blue-500/25',
    tint: 'from-blue-50/70 via-white to-white',
    primary: 'bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-400 hover:to-indigo-400 shadow-blue-500/25',
    value: 'text-blue-600',
  },
  amber: {
    badge: 'from-amber-400 to-orange-500',
    badgeShadow: 'shadow-amber-500/25',
    tint: 'from-amber-50/70 via-white to-white',
    primary: 'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 shadow-amber-500/25',
    value: 'text-amber-600',
  },
  violet: {
    badge: 'from-violet-500 to-fuchsia-500',
    badgeShadow: 'shadow-violet-500/25',
    tint: 'from-violet-50/70 via-white to-white',
    primary: 'bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 shadow-violet-500/25',
    value: 'text-violet-600',
  },
  rose: {
    badge: 'from-rose-500 to-red-500',
    badgeShadow: 'shadow-rose-500/25',
    tint: 'from-rose-50/70 via-white to-white',
    primary: 'bg-gradient-to-r from-rose-500 to-red-500 hover:from-rose-400 hover:to-red-400 shadow-rose-500/25',
    value: 'text-rose-600',
  },
} as const;

export interface ConfirmDialogShellProps {
  show: boolean;
  tone?: DialogTone;
  icon: ReactNode;
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** 취소 버튼 문구 */
  cancelLabel?: string;
  onCancel: () => void;
  /** 주 버튼 문구. 없으면 주 버튼을 렌더하지 않는다(안내 전용 다이얼로그) */
  confirmLabel?: string;
  onConfirm?: () => void;
  /** 처리 중 — 두 버튼 잠금 + 스피너 + ESC 차단 */
  busy?: boolean;
  busyLabel?: string;
  /** 주 버튼 비활성(대상 0건 등) */
  confirmDisabled?: boolean;
  /** 겹침 순서 — 발송 확인(z-[2100]) 위에 경고를 띄우는 경우 올린다 */
  z?: string;
  maxW?: string;
}

export default function ConfirmDialogShell({
  show, tone = 'emerald', icon, title, subtitle, children,
  cancelLabel = '취소', onCancel,
  confirmLabel, onConfirm,
  busy = false, busyLabel = '처리 중...', confirmDisabled = false,
  z = 'z-[2100]', maxW = 'max-w-[440px]',
}: ConfirmDialogShellProps) {
  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => {
      // 처리 중 ESC = 요청은 나갔는데 화면만 사라지는 상태를 만든다. 막는다.
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [show, busy, onCancel]);

  if (!show) return null;
  const t = TONE[tone];

  return createPortal(
    <div className={`fixed inset-0 ${z} bg-slate-900/40 backdrop-blur-[3px] flex items-center justify-center p-4 animate-backdrop-in`}>
      <div
        className={`bg-white rounded-[20px] w-full ${maxW} max-h-[88vh] flex flex-col overflow-hidden ring-1 ring-slate-900/5 shadow-[0_32px_90px_-24px_rgba(15,23,42,0.45)] animate-dialog-in`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {/* 헤더 — 선 대신 옅은 틴트로 층을 만든다 */}
        <div className={`shrink-0 flex items-start gap-3.5 px-6 py-5 border-b border-slate-100 bg-gradient-to-r ${t.tint}`}>
          <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${t.badge} flex items-center justify-center shrink-0 shadow-lg ${t.badgeShadow}`}>
            {icon}
          </div>
          <div className="min-w-0 pt-0.5">
            <h3 className="text-[15px] font-semibold text-slate-900 tracking-tight">{title}</h3>
            {subtitle && <p className="text-[11.5px] text-slate-400 mt-0.5 leading-relaxed">{subtitle}</p>}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">{children}</div>

        {/* 푸터 — 꽉 찬 분할 바 대신 우측 정렬. 주 버튼만 색을 갖는다 */}
        <div className="shrink-0 flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-100 bg-slate-50/70">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2.5 rounded-xl text-[13px] font-medium text-slate-500 hover:text-slate-800 hover:bg-white ring-1 ring-transparent hover:ring-slate-200 disabled:opacity-40 transition"
          >
            {cancelLabel}
          </button>
          {confirmLabel && onConfirm && (
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy || confirmDisabled}
              className={`px-5 py-2.5 rounded-xl text-[13px] font-semibold text-white shadow-lg ${t.primary} disabled:opacity-40 disabled:shadow-none inline-flex items-center justify-center gap-1.5 transition`}
            >
              {busy ? (<><Loader2 size={14} className="animate-spin" />{busyLabel}</>) : confirmLabel}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** 수치 강조 블록 — 확인 다이얼로그의 주인공(발송 건수 등). 한 화면에 하나만 쓴다. */
export function DialogHeadline({
  value, unit, label, tone = 'emerald',
}: { value: number | string; unit: string; label: string; tone?: DialogTone }) {
  return (
    <div className="rounded-2xl bg-slate-50/70 ring-1 ring-slate-900/5 px-5 py-4">
      <p className="text-[11.5px] text-slate-400">{label}</p>
      <p className="mt-1 flex items-baseline gap-1.5">
        <span className={`text-[30px] leading-none font-bold tabular-nums tracking-tight ${TONE[tone].value}`}>
          {typeof value === 'number' ? value.toLocaleString() : value}
        </span>
        <span className="text-[13px] font-medium text-slate-500">{unit}</span>
      </p>
    </div>
  );
}

/** 라벨-값 한 줄. 부수 정보(제외 내역·유형·예약시각)에 쓴다. */
export function DialogRow({
  label, value, accent,
}: { label: string; value: ReactNode; accent?: 'rose' | 'amber' | 'slate' | 'blue' }) {
  const color =
    accent === 'rose' ? 'text-rose-500'
    : accent === 'amber' ? 'text-amber-600'
    : accent === 'blue' ? 'text-blue-600'
    : 'text-slate-700';
  return (
    <div className="flex items-center justify-between gap-4 py-2 border-b border-slate-100 last:border-0">
      <span className="text-[12.5px] text-slate-400 shrink-0">{label}</span>
      <span className={`text-[13px] font-semibold tabular-nums text-right ${color}`}>{value}</span>
    </div>
  );
}

/** 주의 문구 — 회수 불가·예약 취소 기한처럼 되돌릴 수 없는 사실만 적는다. */
export function DialogCaution({ children, tone = 'amber' }: { children: ReactNode; tone?: 'amber' | 'rose' }) {
  const cls = tone === 'rose'
    ? 'bg-rose-50/70 ring-rose-200/70 text-rose-800'
    : 'bg-amber-50/70 ring-amber-200/70 text-amber-900';
  return (
    <div className={`mt-4 px-3.5 py-2.5 rounded-xl ring-1 text-[12px] leading-relaxed ${cls}`}>
      {children}
    </div>
  );
}
