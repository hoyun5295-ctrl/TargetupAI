/**
 * JourneyPlanModal — 자연어 한 칸 다음에 오는 추천 모달 (2026-08-02, 설계서 §13-4 / §6-1)
 *
 * 담는 것 넷
 *   1. 어떤 트리거를 왜 골랐는지(근거)
 *   2. 이 여정의 목적
 *   3. 몇 스텝을 왜 그렇게 잡았는지
 *   4. **이 회사 데이터로 가능한지** — 불가면 무엇을 연동해야 하는지(설계서 §2-3 게이트)
 *
 * ⛔ 4번이 이 모달의 핵심이다. 만들어지고 켜지는데 영원히 0건인 여정이 이 재설계가 없애려는 상태다.
 *   가능 여부는 우리가 미리 정해 두지 않고 그 회사가 준 데이터로 판정한 결과를 그대로 받아 보여준다.
 */
import { createPortal } from 'react-dom';
import { X, Sparkles, Target, Lock, CheckCircle2, ArrowRight, RefreshCw, Loader2 } from 'lucide-react';

export interface PlanStepRow {
  stepOrder: number;
  timingLabel: string;
  intent: string;
  channel: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onNext: () => void;
  onRegenerate?: () => void;
  regenerating?: boolean;
  /** 여정 이름 — AI가 지은 것. */
  name: string;
  /** 사람 말로 된 트리거 이름(예: "첫 구매"). 카탈로그 라벨을 그대로 받는다. */
  triggerLabel: string;
  /** 왜 이 트리거인지 — 생성 AI가 낸 근거. */
  reasoning: string;
  /** 사용자가 쓴 자연어 목적. */
  objective?: string;
  steps: PlanStepRow[];
  /** 이 회사 데이터로 이 트리거를 판정할 수 있는가. */
  available: boolean;
  /** 잠겼을 때의 사유 — 무엇을 연동하면 열리는지가 그대로 들어 있다. */
  unavailableReason?: string;
  /**
   * 이 트리거를 쓸 때 미리 알아야 하는 것(§13-5) — 예: 매장 구매는 하루 모아 다음 날 오전에 나간다.
   * 판정은 페이지가 한다. 이 모달은 문구를 만들지 않는다.
   */
  notice?: string;
}

export default function JourneyPlanModal({
  open, onClose, onNext, onRegenerate, regenerating = false,
  name, triggerLabel, reasoning, objective, steps, available, unavailableReason, notice,
}: Props) {
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm md:items-center md:p-6">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-slate-900 shadow-2xl md:rounded-2xl">
        {/* 헤더 */}
        <div className="flex items-start gap-3 border-b border-white/10 px-5 py-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-base font-bold text-white">{name || '추천 여정'}</h3>
            <p className="text-[11px] text-white/45">이렇게 만들어 드릴게요. 확인하고 넘어가면 스텝을 하나씩 다듬습니다.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-white/40 transition-colors hover:bg-white/5 hover:text-white/70" aria-label="닫기">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* 1 — 왜 이 트리거인가 */}
          <section className="rounded-xl border border-white/10 bg-slate-950/50 p-3.5">
            <div className="mb-2 flex items-center gap-2">
              <span className="rounded-lg bg-violet-500/20 px-2 py-0.5 text-[11px] font-semibold text-violet-100">{triggerLabel}</span>
              <span className="text-[11px] text-white/40">일 때 시작합니다</span>
            </div>
            <p className="text-[12.5px] leading-relaxed text-white/75">{reasoning || '입력하신 내용에 맞는 시작 신호를 골랐습니다.'}</p>
            {notice && (
              <p className="mt-2 rounded-lg border border-sky-400/25 bg-sky-500/10 px-2.5 py-2 text-[11.5px] leading-relaxed text-sky-100">
                {notice}
              </p>
            )}
            <p className="mt-2 text-[10px] italic text-white/30">Data source — 입력한 문장을 읽고 AI가 고른 시작 신호</p>
          </section>

          {/* 2 — 목적 */}
          {objective && (
            <section className="rounded-xl border border-white/10 bg-slate-950/50 p-3.5">
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-white/70">
                <Target className="h-3.5 w-3.5 text-fuchsia-300" /> 이 여정의 목적
              </div>
              <p className="text-[12.5px] leading-relaxed text-white/70">{objective}</p>
            </section>
          )}

          {/* 3 — 스텝 계획 */}
          <section className="rounded-xl border border-white/10 bg-slate-950/50 p-3.5">
            <div className="mb-2.5 text-xs font-semibold text-white/70">
              스텝 {steps.length}개로 나눴습니다
            </div>
            <ol className="space-y-2">
              {steps.map((s) => (
                <li key={s.stepOrder} className="flex gap-2.5">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-white/10 text-[10px] font-bold text-white/70">
                    {s.stepOrder}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[12px] font-medium text-white/85">{s.timingLabel}</span>
                      <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] uppercase text-white/40">{s.channel}</span>
                    </div>
                    {s.intent && <p className="text-[11.5px] leading-relaxed text-white/50">{s.intent}</p>}
                  </div>
                </li>
              ))}
            </ol>
            <p className="mt-2.5 text-[10px] italic text-white/30">Data source — AI가 만든 스텝 구성. 다음 화면에서 하나씩 고칠 수 있습니다.</p>
          </section>

          {/* 4 — 이 회사 데이터로 가능한가 */}
          <section
            className={`flex gap-2.5 rounded-xl border p-3.5 ${
              available ? 'border-emerald-400/25 bg-emerald-500/10' : 'border-amber-400/30 bg-amber-500/10'
            }`}
          >
            {available ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
            ) : (
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
            )}
            <div className="min-w-0 flex-1">
              <div className={`text-xs font-semibold ${available ? 'text-emerald-100' : 'text-amber-100'}`}>
                {available ? '지금 바로 만들 수 있어요' : '아직 만들 수 없어요'}
              </div>
              <p className={`mt-0.5 text-[11.5px] leading-relaxed ${available ? 'text-emerald-100/75' : 'text-amber-100/80'}`}>
                {available
                  ? '이 여정을 판단할 데이터가 들어와 있습니다.'
                  : unavailableReason || '이 여정을 판단할 데이터가 아직 들어오지 않았어요.'}
              </p>
            </div>
          </section>
        </div>

        {/* 푸터 */}
        <div className="flex flex-wrap items-center gap-2 border-t border-white/10 bg-slate-900/95 px-5 py-3.5">
          {onRegenerate && (
            <button
              type="button"
              onClick={onRegenerate}
              disabled={regenerating}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-xs font-medium text-white/60 transition-colors hover:bg-white/5 disabled:opacity-50"
            >
              {regenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              다시 만들기
            </button>
          )}
          <button
            type="button"
            onClick={onNext}
            disabled={!available}
            className="ml-auto inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-violet-500/20 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            스텝 1 설정하기 <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
