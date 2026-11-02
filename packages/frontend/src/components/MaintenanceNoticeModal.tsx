/**
 * MaintenanceNoticeModal — 로그인 화면 서버 점검 안내 창 (★2026-11-02 · Harold 「기존의 본인인증 대체로 올리면 될 것 같아」)
 *
 * 노출 규칙
 *   - 점검이 끝나는 시각 전까지 로그인 · 발송 인증 안내 창(`LoginPolicyNoticeModal`) 자리에 뜬다(판정 = `isMaintenanceNoticeActive`).
 *   - 끝나는 시각이 지나면 뜨지 않고 인증 안내 창이 돌아온다.
 *   - 틀(머리 색 · 크기 · 닫기)은 인증 안내 창과 같다.
 */
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { MAINTENANCE_NOTICE_LEAD_TEXT, MAINTENANCE_NOTICE_PERIOD_TEXT } from '../constants/maintenanceNotice';

const ROWS: Array<{ label: string; text: string }> = [
  { label: '점검 시간', text: MAINTENANCE_NOTICE_PERIOD_TEXT },
  { label: '점검 중', text: '한줄로 접속과 문자 발송이 잠시 멈춥니다.' },
];

export default function MaintenanceNoticeModal({ onClose }: { onClose: () => void }) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="mtn-backdrop fixed inset-0 z-40 flex items-center justify-center bg-slate-900/55 p-3 backdrop-blur-sm sm:p-6"
      role="presentation"
    >
      <style>{`
        @keyframes mtnBackdrop { from { opacity: 0; } to { opacity: 1; } }
        @keyframes mtnPanel {
          from { opacity: 0; transform: translateY(14px) scale(0.975); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .mtn-backdrop { animation: mtnBackdrop 0.22s ease-out both; }
        .mtn-panel { animation: mtnPanel 0.42s cubic-bezier(0.16, 1, 0.3, 1) both; }
        @media (prefers-reduced-motion: reduce) {
          .mtn-backdrop, .mtn-panel { animation: none; }
        }
      `}</style>

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mtn-title"
        className="mtn-panel flex max-h-[calc(100vh-1.5rem)] w-full max-w-[560px] flex-col overflow-hidden rounded-[22px] bg-white shadow-[0_28px_70px_-18px_rgba(15,23,42,0.55)]"
      >
        {/* 머리 — 로그인 화면 브랜드 패널과 같은 색 */}
        <div className="relative shrink-0 overflow-hidden bg-gradient-to-br from-emerald-600 via-teal-700 to-blue-800 px-6 pb-5 pt-6 sm:px-9 sm:pb-6 sm:pt-7">
          <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-white/[0.07]" />
          <div className="pointer-events-none absolute -bottom-24 right-24 h-44 w-44 rounded-full bg-white/[0.05]" />

          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="absolute right-3.5 top-3.5 flex h-9 w-9 items-center justify-center rounded-full text-white/75 transition hover:bg-white/15 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
          >
            <X className="h-5 w-5" strokeWidth={2.2} />
          </button>

          <h3
            id="mtn-title"
            className="relative pr-8 text-[21px] font-bold leading-[1.3] tracking-[-0.02em] text-white sm:text-[24px]"
          >
            서버 점검 안내
          </h3>
          <p className="relative mt-2.5 break-keep text-[14px] leading-[1.6] text-emerald-50 sm:text-[15px]">
            {MAINTENANCE_NOTICE_LEAD_TEXT}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 sm:px-9">
          <dl>
            {ROWS.map((r) => (
              <div
                key={r.label}
                className="grid gap-x-5 gap-y-1 border-b border-slate-100 py-3 sm:grid-cols-[84px_1fr] sm:items-baseline"
              >
                <dt className="text-[13px] font-semibold text-emerald-700">{r.label}</dt>
                <dd className="break-keep text-[15.5px] font-semibold leading-snug tracking-[-0.01em] text-slate-900 sm:text-[16px]">{r.text}</dd>
              </div>
            ))}
          </dl>
          <p className="break-keep py-3 text-[13.5px] leading-relaxed text-slate-600">
            더 안정적인 서비스를 위한 점검입니다. 이용에 불편을 드려 죄송합니다.
          </p>
        </div>

        <div className="flex shrink-0 items-center justify-end border-t border-slate-100 px-6 py-3 sm:px-9">
          <button
            ref={confirmRef}
            type="button"
            onClick={onClose}
            className="rounded-xl bg-emerald-600 px-7 py-2.5 text-[15px] font-semibold text-white transition hover:bg-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 active:bg-emerald-800"
          >
            확인했습니다
          </button>
        </div>
      </div>
    </div>
  );
}
