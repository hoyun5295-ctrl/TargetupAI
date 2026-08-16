/**
 * DiagnosisHeroCard — 대시보드 상시 진입 카드 (2026-08-16 신설 · 설계서 §5-2)
 *
 * 노출은 부모(Dashboard)가 서버 state로 판정한다 — 이 카드는 표시 전용(dismiss 없음·실물 크기).
 *   variant 'invite' = eligible && !completedAt — 진단 유도(회사명 1인칭 · "8문항 약 2분" · 가격 단어 0 · NEW 뱃지만)
 *   variant 'trial'  = completedAt && trialExpiresAt > now — 「체험 D-N · 첫 발송 해보기」(D-N = state.trialExpiresAt)
 */
import { ArrowRight, Stethoscope, Zap } from 'lucide-react';

interface Props {
  variant: 'invite' | 'trial';
  companyName?: string | null;
  trialExpiresAt?: string | null;
  onStart?: () => void;
  onFirstSend?: () => void;
}

function dDay(trialExpiresAt?: string | null): number | null {
  if (!trialExpiresAt) return null;
  const diff = new Date(trialExpiresAt).getTime() - Date.now();
  if (Number.isNaN(diff) || diff <= 0) return null;
  return Math.ceil(diff / (24 * 60 * 60 * 1000));
}

export default function DiagnosisHeroCard({ variant, companyName, trialExpiresAt, onStart, onFirstSend }: Props) {
  if (variant === 'trial') {
    const d = dDay(trialExpiresAt);
    if (d == null) return null;
    return (
      <button
        type="button"
        onClick={onFirstSend}
        className="group relative mb-4 w-full overflow-hidden rounded-2xl border border-sky-400/25 bg-gradient-to-r from-sky-600/25 via-indigo-600/20 to-slate-900 px-5 py-4 text-left shadow-sm transition-all hover:border-sky-400/50 hover:shadow-lg sm:px-6 break-keep"
      >
        <div className="pointer-events-none absolute -right-10 -top-16 h-44 w-44 rounded-full bg-sky-400/10 blur-2xl" aria-hidden />
        <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-sky-400 to-indigo-500">
              <Zap className="h-5 w-5 text-white" aria-hidden />
            </span>
            <span>
              <span className="block text-[15px] font-bold tracking-tight text-white sm:text-base">
                체험이 진행 중이에요 · D-{d}
              </span>
              <span className="mt-0.5 block text-xs text-white/65 sm:text-[13px]">
                진단 리포트에서 추천받은 기능을 지금 바로 써보세요
              </span>
            </span>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-xl bg-white px-4 py-2 text-[13px] font-bold text-indigo-700 shadow-sm sm:self-auto">
            첫 발송 해보기 <ArrowRight className="h-4 w-4" aria-hidden />
          </span>
        </div>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onStart}
      className="group relative mb-4 w-full overflow-hidden rounded-2xl border border-sky-400/25 bg-gradient-to-r from-sky-600/30 via-indigo-600/25 to-slate-900 px-5 py-4 text-left shadow-sm transition-all hover:border-sky-400/50 hover:shadow-lg sm:px-6 break-keep"
    >
      <div className="pointer-events-none absolute -right-10 -top-16 h-44 w-44 rounded-full bg-sky-400/10 blur-2xl" aria-hidden />
      <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-sky-400 to-indigo-500">
            <Stethoscope className="h-5 w-5 text-white" aria-hidden />
            <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-sky-300 motion-safe:animate-ping" aria-hidden />
            <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-sky-300" aria-hidden />
          </span>
          <span>
            <span className="flex items-center gap-2 text-[15px] font-bold tracking-tight text-white sm:text-base">
              {companyName ? `${companyName}의 마케팅, 지금 진단받아 보세요` : '우리 마케팅, 지금 진단받아 보세요'}
              <span className="rounded-md bg-sky-400/20 px-1.5 py-0.5 text-[10px] font-bold text-sky-300">NEW</span>
            </span>
            <span className="mt-0.5 block text-xs text-white/65 sm:text-[13px]">
              8문항 약 2분이면 AI가 우리 회사 기준 리포트를 만들어 드려요
            </span>
          </span>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-xl bg-white px-4 py-2 text-[13px] font-bold text-indigo-700 shadow-sm sm:self-auto">
          진단 시작 <ArrowRight className="h-4 w-4" aria-hidden />
        </span>
      </div>
    </button>
  );
}
