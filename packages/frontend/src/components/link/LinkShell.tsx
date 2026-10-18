/**
 * LinkShell — 담당자가 문자 속 주소로 여는 무로그인 화면의 공통 틀(★ 2026-10-18 · 설계서 docs/2026-10-18-planner-v2-design.md §3-3)
 *
 * 쓰는 화면 = 플래너 당일 재확인 · 여정 정지(그리고 대행 승인 화면이 같은 바닥글 규칙을 쓴다).
 * 밝은 판 · 폰 우선 한 열(최대 560px) · 머리 = 아이콘 + 제목 + 한 줄 · 바닥글 = 인증번호 안내.
 *
 * ⛔ 모듈 바깥에 둔 컴포넌트다 — 화면 함수 안에서 틀을 만들면 렌더마다 새 컴포넌트가 되어 입력칸이 다시 마운트된다
 *   (대행 승인 화면 `Shell` 이 그 형태라 인증 창을 틀 밖에 두었다).
 * ⛔ 문구에 줄표 0 · 모델명 0.
 */
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, Loader2 } from 'lucide-react';

const ICON_TONE = {
  indigo: 'bg-indigo-600 text-white',
  amber: 'bg-amber-500 text-white',
  rose: 'bg-rose-600 text-white',
  emerald: 'bg-emerald-600 text-white',
} as const;
export type LinkTone = keyof typeof ICON_TONE;

export function LinkShell({
  title, subtitle, icon: Icon, tone = 'indigo', service, children,
}: {
  title: string;
  subtitle?: string;
  icon: LucideIcon;
  tone?: LinkTone;
  /** 바닥글 첫 줄(어느 기능 화면인가) */
  service: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-[560px] mx-auto px-4 sm:px-5 py-3.5 flex items-center gap-3">
          <div className={`h-9 w-9 shrink-0 rounded-xl grid place-items-center ${ICON_TONE[tone]}`}>
            <Icon className="w-4 h-4" strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h1 className="text-[16px] font-bold tracking-[-0.02em] text-slate-900 truncate">{title}</h1>
            {subtitle && <p className="text-[12.5px] text-slate-500 truncate">{subtitle}</p>}
          </div>
        </div>
      </header>
      <main className="flex-1 w-full max-w-[560px] mx-auto px-4 sm:px-5 py-5 sm:py-6">{children}</main>
      <footer className="w-full max-w-[560px] mx-auto px-4 sm:px-5 pb-6 space-y-1">
        <p className="text-[11px] text-slate-400">{service} · 이 화면은 안내 문자를 받은 담당자용입니다</p>
        <p className="text-[11px] text-slate-400">인증번호는 이 화면에만 입력합니다. 로그인은 hanjul.ai 로그인 화면에서만 하며, 전화나 메시지로 인증번호를 묻지 않습니다.</p>
      </footer>
    </div>
  );
}

/** 불러오는 중 */
export function LinkLoading() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-12 grid place-items-center text-slate-400">
      <Loader2 className="w-5 h-5 animate-spin" />
    </div>
  );
}

/** 무효 · 만료 · 오류 카드 */
export function LinkInvalid({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
      <span className="mx-auto mb-3 h-11 w-11 rounded-2xl bg-slate-100 text-slate-400 grid place-items-center">
        <AlertTriangle className="w-5 h-5" strokeWidth={2} />
      </span>
      <p className="text-[15px] font-semibold text-slate-900">{title}</p>
      <p className="mt-1.5 text-[13px] text-slate-500 leading-relaxed">{body}</p>
    </div>
  );
}

const NOTICE_TONE = {
  amber: 'border-amber-200 bg-amber-50 text-amber-900',
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  rose: 'border-rose-200 bg-rose-50 text-rose-900',
  slate: 'border-slate-200 bg-white text-slate-700',
} as const;

/** 한 줄 알림(바뀐 상태 · 결과 · 주의) */
export function LinkNotice({ tone = 'amber', icon: Icon = AlertTriangle, children }: { tone?: keyof typeof NOTICE_TONE; icon?: LucideIcon; children: ReactNode }) {
  return (
    <div className={`flex gap-2.5 p-3.5 rounded-xl border ${NOTICE_TONE[tone]}`}>
      <Icon className="w-4 h-4 shrink-0 mt-px" strokeWidth={2} />
      <div className="text-[13px] leading-relaxed min-w-0">{children}</div>
    </div>
  );
}

/** 이름 · 값 한 줄(카드 안 요약) */
export function LinkRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <p className="flex justify-between gap-4 text-[13px]">
      <span className="text-slate-500 shrink-0">{label}</span>
      <b className="text-slate-900 text-right min-w-0 break-words">{value}</b>
    </p>
  );
}
