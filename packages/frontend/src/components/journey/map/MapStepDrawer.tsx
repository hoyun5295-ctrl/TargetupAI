/**
 * MapStepDrawer — 생애 지도 칸 서랍 (★ 2026-09-29 여정 V2 1차 · 읽기 전용)
 *
 * 1차는 보기만 한다. 고치기는 [여정 자세히 보기](기존 편집 입구)로 보낸다 — 편집 입구를 둘로 늘리지 않는다(2차에 이 서랍이 편집 입구가 된다).
 * 문안 전체는 기존 여정 상세 조회(/operator/journeys/:id)에서 받는다. 시간 · 잠금 문구는 지도 응답(서버) 그대로.
 * 데스크톱 = 가운데 창 · 모바일 = 아래 시트(여정 모달 공용 껍데기 JourneyModalShell · 포커스 · Esc · 복귀).
 */
import { useEffect, useState } from 'react';
import { GitBranch, Hourglass, Loader2, Lock, MessageSquare, X } from 'lucide-react';
import JourneyModalShell from '../JourneyModalShell';
import { stepChannelLabel, stepTypeLabel } from '../../../utils/journey-labels';
import type { MapJourney, MapStep } from '../../../utils/journey-map';

interface Props {
  journey: MapJourney | null;
  step: MapStep | null;
  onClose: () => void;
  onOpenJourney: (id: string) => void;
  /** ★ 2026-09-30 V2 2차 — 초안 · 멈춘 여정의 문안 고치기(기존 문안 수정 창 · 편집 입구를 새로 만들지 않는다). */
  onEditMessages: (journey: MapJourney) => void;
}

interface StepFull {
  message_template?: string | null;
  subject?: string | null;
  wait_event_name?: string | null;
}

export default function MapStepDrawer({ journey, step, onClose, onOpenJourney, onEditMessages }: Props) {
  const open = !!journey && !!step;
  const [full, setFull] = useState<StepFull | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!journey || !step) return;
    let alive = true;
    setFull(null);
    setFailed(false);
    setLoading(true);
    fetch(`/api/ai/operator/journeys/${journey.id}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        const row = (d?.detail?.steps || []).find((s: any) => String(s.id) === step.stepId);
        if (row) setFull(row); else setFailed(true);
      })
      .catch(() => { if (alive) setFailed(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [journey, step]);

  if (!journey || !step) return null;
  const Icon = step.kind === 'wait' ? Hourglass : step.kind === 'condition' ? GitBranch : MessageSquare;

  return (
    <JourneyModalShell
      open={open}
      onClose={onClose}
      labelledBy="jmap-step-title"
      panelClassName="w-full max-w-lg"
    >
      <div className="flex min-h-0 flex-1 flex-col text-white">
        <div className="flex items-start gap-3 px-5 pt-5 pb-3 border-b border-white/10">
          <div className="w-9 h-9 rounded-xl bg-violet-500/15 border border-violet-400/30 flex items-center justify-center shrink-0">
            <Icon className="w-4 h-4 text-violet-200" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 id="jmap-step-title" className="text-sm font-semibold truncate">
              {step.order}번째 칸 · {stepTypeLabel(step.kind)}{step.kind === 'message' ? ` · ${stepChannelLabel(step.channel)}` : ''}
            </h2>
            <p className="mt-0.5 text-[11px] text-white/50 truncate">{journey.name}</p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10" aria-label="닫기">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-white/[0.04] px-3 py-2">
              <div className="text-[11px] text-white/45">언제</div>
              <div className="text-xs font-semibold tabular-nums">{step.timingLabel}</div>
            </div>
            <div className="rounded-lg bg-white/[0.04] px-3 py-2">
              <div className="text-[11px] text-white/45">앞 칸 뒤</div>
              <div className="text-xs font-semibold">{step.intervalLabel}</div>
            </div>
            <div className="rounded-lg bg-white/[0.04] px-3 py-2">
              <div className="text-[11px] text-white/45">이 칸 차례</div>
              <div className="text-xs font-semibold tabular-nums">{step.waitingHere.toLocaleString('ko-KR')}명</div>
            </div>
            <div className="rounded-lg bg-white/[0.04] px-3 py-2">
              <div className="text-[11px] text-white/45">여기서 {journey.goalLabel}(30일)</div>
              <div className="text-xs font-semibold tabular-nums text-emerald-300">{step.exitsAfter == null ? '자동 종료 꺼짐' : `${step.exitsAfter.toLocaleString('ko-KR')}명`}</div>
            </div>
          </div>

          {step.kind === 'message' && (
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[11px] font-semibold text-white/70">문안</span>
                {step.isAd && <span className="text-[11px] px-1.5 py-0.5 rounded bg-white/10 text-white/60">광고</span>}
              </div>
              {loading ? (
                <div className="flex items-center gap-2 text-[11px] text-white/50 py-6 justify-center">
                  <Loader2 className="w-4 h-4 animate-spin" /> 문안을 불러오는 중
                </div>
              ) : (
                <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
                  {full?.subject && <div className="text-xs font-semibold mb-1.5">{full.subject}</div>}
                  <pre className="whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-white/80">
                    {full?.message_template || step.preview || (failed ? '문안을 불러오지 못했어요.' : '문안이 비어 있어요.')}
                  </pre>
                </div>
              )}
            </div>
          )}

          {step.kind === 'wait' && (
            <p className="text-xs leading-relaxed text-white/70">
              {full?.wait_event_name ? '정한 행동이 일어나면 바로 다음 칸으로, 늦어도 정한 시간이 지나면 다음 칸으로 넘어갑니다.' : '정한 시간만큼 기다린 뒤 다음 칸으로 넘어갑니다.'}
            </p>
          )}

          <div className="flex items-start gap-2 rounded-lg bg-white/[0.03] px-3 py-2.5 text-[11px] leading-relaxed text-white/55">
            <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{journey.lock.reason}</span>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-white/10 flex gap-2">
          {(journey.status === 'draft' || journey.status === 'paused') && step.kind === 'message' && (
            <button
              type="button"
              onClick={() => onEditMessages(journey)}
              className="flex-1 h-10 rounded-lg text-xs font-semibold bg-violet-600 hover:bg-violet-500 text-white transition-colors"
            >
              문안 고치기
            </button>
          )}
          <button
            type="button"
            onClick={() => onOpenJourney(journey.id)}
            className="flex-1 h-10 rounded-lg text-xs font-semibold text-violet-100 border border-violet-400/30 hover:bg-violet-500/15 transition-colors"
          >
            여정 자세히 보기
          </button>
        </div>
      </div>
    </JourneyModalShell>
  );
}
