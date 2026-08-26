/**
 * AgencyProgressRail — 대행발송 6단계 진행 레일 (★2026-08-26(2) AgencySendPage에서 원본 복사로 승격)
 *
 * 소비처 = 고객 화면(AgencySendPage) + 슈퍼관리자 대행발송 내역(AgencySendLedgerPanel).
 * 표시 판정은 railFor(CT · agency-send-api)가 소유하고 여기는 그리기만 한다.
 * ⛔ 색은 인디고 계열만(바이올렛은 AI 화면 색 · LESSONS_FRONTEND 핵심 원칙). 라이트 지면 전용.
 */
import { Check, X } from 'lucide-react';
import { RAIL_STEPS, railFor, type AgencySendRequest } from './agency-send-api';

export default function AgencyProgressRail({ r }: { r: Pick<AgencySendRequest, 'status' | 'approvedAt' | 'queuedAt'> }) {
  const rail = railFor(r);
  // 흐름이 닿은 마지막 단계. 연결선은 이 값 하나로 단조롭게 칠한다(마디별 조건 분기를 두지 않는다)
  const reach = rail.fail ? rail.fail.at : (rail.now ?? Math.max(0, rail.doneBefore - 1));
  const lineOn = rail.muted ? 'bg-neutral-300' : 'bg-indigo-600';
  return (
    <div className="flex items-start flex-1 min-w-[340px]" aria-label="진행 단계">
      {RAIL_STEPS.map((label, i) => {
        const fail = rail.fail?.at === i;
        const now = !fail && rail.now === i;
        const done = !fail && !now && i < rail.doneBefore;
        return (
          <div key={label} className="flex-1 flex flex-col items-center relative">
            {i > 0 && (
              <span className={`absolute left-0 right-1/2 top-[9px] h-0.5 ${reach >= i ? lineOn : 'bg-neutral-200'}`} aria-hidden="true" />
            )}
            {i < RAIL_STEPS.length - 1 && (
              <span className={`absolute left-1/2 right-0 top-[9px] h-0.5 ${reach >= i + 1 ? lineOn : 'bg-neutral-200'}`} aria-hidden="true" />
            )}
            <span className={`relative z-10 h-5 w-5 rounded-full grid place-items-center border-2 ${
              fail ? 'bg-rose-500 border-rose-500 text-white'
                : now ? 'bg-white border-indigo-600'
                : done ? (rail.muted ? 'bg-neutral-300 border-neutral-300 text-white' : 'bg-indigo-600 border-indigo-600 text-white')
                : 'bg-white border-neutral-200'}`}>
              {fail ? <X className="w-2.5 h-2.5" strokeWidth={3.2} />
                : now ? <span className="h-[7px] w-[7px] rounded-full bg-indigo-600 animate-pulse" />
                : done ? <Check className="w-2.5 h-2.5" strokeWidth={3.2} />
                : null}
            </span>
            <span className={`mt-1 text-[11px] whitespace-nowrap ${
              fail ? 'text-rose-700 font-bold'
                : now ? 'text-indigo-700 font-bold'
                : done ? (rail.muted ? 'text-neutral-400 font-semibold' : 'text-indigo-700 font-semibold')
                : 'text-neutral-400 font-semibold'}`}>
              {fail ? rail.fail!.label : label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
