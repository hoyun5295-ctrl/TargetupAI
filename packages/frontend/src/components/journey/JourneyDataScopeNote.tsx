/**
 * JourneyDataScopeNote — "연동한 데이터가 여정의 폭을 정한다" (2026-08-02)
 *
 * 세 진입(마케팅·정보 알림·날짜축) 모달이 **같은 문구를 공유**한다. 각자 쓰면 말이 갈라진다.
 *
 * 왜 이 안내가 필요한가
 *   여정은 우리가 정답표를 갖지 않는다 — 무엇을 만들 수 있는지는 그 회사가 준 데이터가 정한다.
 *   그 사실을 화면이 말하지 않으면, 사용자는 잠긴 이유를 제품 결함으로 읽거나
 *   만들어 놓고 0건으로 도는 여정을 켜 둔 채 기다린다.
 *
 * ⛔ 숫자는 실제 판정 결과에서만 온다(회사별 트리거 가능 여부). 여기서 지어내지 않는다.
 */
import { Database, Lock, Sparkles } from 'lucide-react';

interface Props {
  /** 지금 이 회사가 만들 수 있는 트리거 수. */
  availableCount: number;
  /** 데이터가 없어 잠긴 트리거 수. */
  lockedCount: number;
  /** 잠긴 사유 — 무엇을 연동하면 열리는지가 그대로 들어 있다. 중복 없이 최대 3개만 보여준다. */
  lockedHints?: string[];
  className?: string;
}

export default function JourneyDataScopeNote({ availableCount, lockedCount, lockedHints = [], className = '' }: Props) {
  const total = availableCount + lockedCount;
  const hints = Array.from(new Set(lockedHints.filter(Boolean))).slice(0, 3);
  const ratio = total > 0 ? Math.round((availableCount / total) * 100) : 0;

  return (
    <div className={`rounded-xl border border-white/10 bg-slate-950/50 p-3.5 ${className}`}>
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-sky-400 to-indigo-500">
          <Database className="h-3.5 w-3.5 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-semibold leading-snug text-white/90">
            연동한 데이터가 많을수록 만들 수 있는 여정이 늘어납니다
          </p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-white/55">
            매장 시스템이나 자사몰을 연동하면 구매·등급·행동이 들어오고, 그만큼 고를 수 있는 시작 신호가 많아집니다.
          </p>

          {total > 0 && (
            <>
              <div className="mt-2.5 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-violet-400 to-fuchsia-400 transition-all"
                    style={{ width: `${ratio}%` }}
                  />
                </div>
                <span className="shrink-0 text-[11px] tabular-nums text-white/60">
                  <span className="font-semibold text-violet-200">{availableCount}</span> / {total}종
                </span>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                <span className="inline-flex items-center gap-1 text-emerald-200/90">
                  <Sparkles className="h-3 w-3" /> 지금 만들 수 있어요 {availableCount}종
                </span>
                {lockedCount > 0 && (
                  <span className="inline-flex items-center gap-1 text-amber-200/85">
                    <Lock className="h-3 w-3" /> 데이터가 오면 열려요 {lockedCount}종
                  </span>
                )}
              </div>
            </>
          )}

          {hints.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {hints.map((h) => (
                <li key={h} className="text-[11px] leading-relaxed text-white/45">· {h}</li>
              ))}
            </ul>
          )}

          <p className="mt-2 text-[10px] italic text-white/30">
            Data source — 회사 고객 데이터로 실시간 판정한 결과입니다.
          </p>
        </div>
      </div>
    </div>
  );
}
