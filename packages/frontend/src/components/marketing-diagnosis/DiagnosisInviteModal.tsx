/**
 * DiagnosisInviteModal — 최초 1회 초대 (2026-08-16 신설 · 설계서 §5-2)
 *
 * 표시 즉시 서버 기록(POST /invited — localStorage 판정 금지)은 부모가 담당.
 * 초대 형식 계약: 3줄 + 시작 버튼 · 백드롭/Esc 허용 · 「나중에 하기」 · 요금제·가격·무료 단어 0.
 */
import { Stethoscope } from 'lucide-react';
import JourneyModalShell from '../journey/JourneyModalShell';

interface Props {
  open: boolean;
  onClose: () => void;
  onStart: () => void;
}

export default function DiagnosisInviteModal({ open, onClose, onStart }: Props) {
  return (
    <JourneyModalShell
      open={open}
      onClose={onClose}
      labelledBy="diagnosis-invite-title"
      zIndexClassName="z-[1900]"
      panelClassName="w-full max-w-md"
    >
      <div className="relative overflow-hidden px-6 pb-6 pt-7 text-center">
        <div className="pointer-events-none absolute -top-20 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full bg-sky-400/15 blur-3xl" aria-hidden />
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-sky-400 to-indigo-500 shadow-lg shadow-sky-500/25">
          <Stethoscope className="h-6 w-6 text-white" aria-hidden />
        </span>
        <h2 id="diagnosis-invite-title" className="mt-4 text-lg font-bold tracking-tight text-white">
          우리 매장 마케팅, 지금 어느 단계일까요?
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-white/70">
          8개 질문에 답하면 AI가 우리 회사 기준으로 진단 리포트를 만들어 드려요.
          <br />
          약 2분이면 충분해요.
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            onClick={onStart}
            className="min-h-[48px] w-full rounded-xl bg-gradient-to-r from-sky-500 to-indigo-500 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-sky-500/25 transition-all hover:shadow-xl"
          >
            진단 시작하기
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] w-full rounded-xl px-4 py-2 text-sm text-white/50 transition-colors hover:text-white/80"
          >
            나중에 하기
          </button>
        </div>
      </div>
    </JourneyModalShell>
  );
}
