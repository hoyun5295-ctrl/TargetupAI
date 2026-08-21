/**
 * SendWorkspaceShell — 발송 계열 풀스크린 워크스페이스 셸 (★ 2026-07-31 신설)
 *
 * 왜 신설했나:
 *   알림톡·브랜드메시지 발송 모달이 각자 셸을 적고 있었다. 둘 다 흰 배경에 회색 테두리(border-gray-200)를
 *   두르는 옛 규격이라, 같은 화면에서 다른 기능과 나란히 놓으면 완성도가 떨어져 보였다.
 *   각자 적으면 다음에 또 갈라지므로 **발송 모달이 공용하는 셸**로 뽑는다.
 *
 * 톤 — **화이트 고급형**(2026-07-31 Harold 확정. 다크 아님):
 *   고급스러움은 색을 늘려서가 아니라 **테두리를 걷어내고 층을 만드는 것**에서 나온다.
 *     · 경계 = `border-gray-200` 대신 `ring-1 ring-slate-900/5` + 아주 옅은 그림자
 *     · 면 분리 = 회색 박스가 아니라 `bg-slate-50/70` 서브 서페이스
 *     · 강조색 = 아이콘·포커스 링·핵심 버튼에만. 넓은 면에 칠하지 않는다
 *     · 여백 = 좁히지 않는다. 밀도가 낮아야 비싸 보인다
 *   백드롭 클릭으로 닫히지 않는다(작업 손실 방지 — 닫기는 X·ESC만).
 *   2컬럼은 md 이하에서 1컬럼으로 쌓인다.
 */

import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/** 채널 정체성 색 — 알림톡은 amber, 브랜드메시지는 violet */
export type WorkspaceAccent = 'violet' | 'amber';

const ACCENT = {
  violet: {
    icon: 'from-violet-500 to-fuchsia-500',
    iconShadow: 'shadow-violet-500/25',
    headerTint: 'from-violet-50/80 via-white to-white',
  },
  amber: {
    icon: 'from-amber-400 to-orange-500',
    iconShadow: 'shadow-amber-500/25',
    headerTint: 'from-amber-50/80 via-white to-white',
  },
} as const;

export interface SendWorkspaceShellProps {
  show: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon: ReactNode;
  accent?: WorkspaceAccent;
  /** 헤더 아래 안내 띠 (전제 조건 미충족 등). 없으면 렌더하지 않는다 */
  notice?: ReactNode;
  /** 좌측 패널 — 수신자 등. 모바일에서는 위로 쌓인다 */
  aside: ReactNode;
  /** 좌측 패널 폭(데스크톱). 기본 380px */
  asideWidth?: string;
  /** 패널 최대 폭. 3단(수신자·작성·미리보기)이면 넓게 잡는다 */
  maxW?: string;
  /** 우측 본문 */
  children: ReactNode;
}

export default function SendWorkspaceShell({
  show, onClose, title, subtitle, icon, accent = 'violet',
  notice, aside, asideWidth = '380px', maxW = 'max-w-6xl', children,
}: SendWorkspaceShellProps) {
  // ESC 닫기 — 백드롭 클릭은 작업 손실을 만들어 쓰지 않는다(2026-07-04 전면 제거 룰).
  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [show, onClose]);

  if (!show) return null;
  const tone = ACCENT[accent];

  return createPortal(
    <div className="fixed inset-0 z-[2000] bg-slate-900/35 backdrop-blur-[2px] flex items-center justify-center p-3 sm:p-5">
      <div
        className={`bg-white rounded-[20px] w-full ${maxW} h-[94vh] sm:h-[92vh] flex flex-col overflow-hidden ring-1 ring-slate-900/5 shadow-[0_32px_90px_-24px_rgba(15,23,42,0.45)]`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {/* 헤더 — 테두리 대신 아주 옅은 틴트와 얇은 divider로 층을 만든다 */}
        <div className={`shrink-0 flex items-center justify-between gap-3 px-5 sm:px-7 py-4 sm:py-5 border-b border-slate-100 bg-gradient-to-r ${tone.headerTint}`}>
          <div className="flex items-center gap-3.5 min-w-0">
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${tone.icon} flex items-center justify-center shrink-0 shadow-lg ${tone.iconShadow}`}>
              {icon}
            </div>
            <div className="min-w-0">
              <h2 className="text-[15px] sm:text-base font-semibold text-slate-900 tracking-tight truncate">{title}</h2>
              {subtitle && <p className="text-[11px] sm:text-xs text-slate-400 truncate mt-0.5">{subtitle}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-sm text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
          >
            <X size={15} strokeWidth={1.75} />
            <span className="hidden sm:inline">창닫기</span>
          </button>
        </div>

        {notice && <div className="shrink-0 px-5 sm:px-7 pt-4">{notice}</div>}

        {/* 본문 — 데스크톱 2컬럼 / 모바일 1컬럼(좌측이 위) */}
        <div className="flex-1 min-h-0 flex flex-col md:flex-row">
          <aside className="shrink-0 w-full md:w-[var(--aside-w)] flex flex-col min-h-0 max-h-[46vh] md:max-h-none border-b md:border-b-0 md:border-r border-slate-100 bg-slate-50/60"
            style={{ ['--aside-w' as any]: asideWidth }}>
            {aside}
          </aside>
          <main className="flex-1 min-h-0 overflow-y-auto bg-white">{children}</main>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** 안내 띠 — 전제 조건이 빠졌을 때. 요금제 제한과 구분해 쓰라고 톤을 따로 둔다. */
export function WorkspaceNotice({ children }: { children: ReactNode }) {
  return (
    <div className="px-4 py-3 rounded-xl bg-amber-50/80 ring-1 ring-amber-200/70 text-[13px] leading-relaxed text-amber-900">
      {children}
    </div>
  );
}

/** 데이터 출처 표기 — 모든 카드·미리보기에 붙인다(디자인 최소 기준) */
export function SourceCaption({ children }: { children: ReactNode }) {
  return <div className="text-[10px] text-slate-400 italic mt-2">Data source: {children}</div>;
}

/**
 * 발송 계열 공용 폼 컨트롤 클래스.
 * 회색 테두리(`border`) 대신 얇은 링을 쓰고, 포커스에서만 강조색이 드러난다.
 * 화면마다 손으로 적으면 굵기·라운드가 조금씩 달라져 싸구려로 보인다 — 여기 하나만 쓴다.
 */
export const FIELD_CLASS =
  'w-full rounded-xl bg-white px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-300 ' +
  'ring-1 ring-slate-200 focus:ring-2 focus:ring-violet-500/50 outline-none transition shadow-sm';

/** 서브 서페이스 — 섹션을 나눌 때 회색 박스 대신 쓴다 */
export const PANEL_CLASS = 'rounded-2xl bg-slate-50/70 ring-1 ring-slate-900/5 p-4';
