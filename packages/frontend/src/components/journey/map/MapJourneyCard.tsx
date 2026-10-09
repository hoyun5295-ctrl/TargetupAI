/**
 * MapJourneyCard — 생애 지도의 여정 카드 한 장 (★ 2026-09-29 여정 V2 1차 · 읽기 전용)
 *
 * 카드를 펼치면 칸이 **아래로** 쌓인다(옆 열은 움직이지 않는다 · 설계서 §3).
 * 칸 · 출구 · 잠금 · 선 상태의 의미는 서버 응답을 그대로 그린다. 칸 배열을 보고 갈래를 다시 추론하지 않는다.
 * 모바일은 SVG 선이 없으므로 카드 아래 "다음 → ○○ 여정" 줄이 선을 대신한다(데스크톱도 같은 줄을 보여 준다).
 */
import { AlertCircle, ArrowRight, ChevronDown, Copy, Flag, GitBranch, Hourglass, Layers, Lock, MessageSquare, Target, Users } from 'lucide-react';
import {
  CHIP_STYLE, LINE_SHORT, LINE_STYLE, STATUS_META, countText,
  type MapJourney, type MapLine, type MapStep,
} from '../../../utils/journey-map';
import { stepChannelLabel } from '../../../utils/journey-labels';

interface Props {
  journey: MapJourney;
  outgoing: MapLine[];
  overlapsWith: Array<{ id: string; name: string; concurrentActive: number }>;
  expanded: boolean;
  focused: boolean;
  onToggle: () => void;
  onOpenStep: (step: MapStep) => void;
  onFocusJourney: (id: string) => void;
  onOpenJourney: (id: string) => void;
  /** ★ 0930 V2 5차 — 새 판 만들기(켜짐 · 멈춤 여정의 구조 변경). */
  onNewVersion: (journey: MapJourney) => void;
}

function ChipIcon({ kind }: { kind: string }) {
  if (kind === 'wait') return <Hourglass className="w-3.5 h-3.5 shrink-0" />;
  if (kind === 'condition') return <GitBranch className="w-3.5 h-3.5 shrink-0" />;
  if (kind === 'message') return <MessageSquare className="w-3.5 h-3.5 shrink-0" />;
  if (kind === 'end') return <Flag className="w-3.5 h-3.5 shrink-0" />;
  return <AlertCircle className="w-3.5 h-3.5 shrink-0" />;
}

/** 조건 칸의 두 갈래 문구 — 서버 그래프 간선을 그대로 읽는다. */
function conditionBranches(journey: MapJourney, order: number): { met: string; notMet: string } {
  const edges = journey.graph.edges.filter((e) => e.from === order);
  const met = edges.find((e) => e.kind === 'met');
  const notMet = edges.find((e) => e.kind === 'not_met' || e.kind === 'not_met_end');
  return {
    met: met && met.to > 0 ? '맞으면 다음 칸' : '맞으면 여정 끝',
    notMet: notMet && notMet.kind === 'not_met' ? `아니면 ${notMet.to}번째 칸으로` : '아니면 여정 끝',
  };
}

function ExitMarker({ n, label, first }: { n: number; label: string; first?: boolean }) {
  if (n <= 0) return null;
  return (
    <div className="flex items-center gap-1.5 pl-3 text-[11px] text-emerald-700">
      <Target className="w-3 h-3 shrink-0" />
      <span>{first ? '첫 문자 전에' : '여기서'} {label} {n.toLocaleString('ko-KR')}명 마침</span>
    </div>
  );
}

export default function MapJourneyCard({
  journey: j, outgoing, overlapsWith, expanded, focused, onToggle, onOpenStep, onFocusJourney, onOpenJourney, onNewVersion,
}: Props) {
  const st = STATUS_META[j.status] || STATUS_META.ended;
  const bodyId = `jmap-card-${j.id}`;
  const dim = j.status === 'ended' || j.status === 'draft';

  return (
    <div
      data-anchor={`j:${j.id}`}
      className={`rounded-xl border bg-white transition-shadow ${dim ? 'border-slate-200 border-dashed' : 'border-slate-300'} ${focused ? 'ring-2 ring-violet-300 shadow-lg shadow-violet-900/40' : ''}`}
    >
      {/* 머리: 선이 붙는 자리(카드 윗부분 · 펼쳐도 위치가 변하지 않는다) */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={bodyId}
        className="w-full text-left px-3 pt-3 pb-2 rounded-t-xl hover:bg-white transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full shrink-0 ${st.dot}`} aria-hidden />
          <span className="flex-1 min-w-0 text-sm font-semibold text-slate-900 truncate">{j.name || '이름 없는 여정'}</span>
          <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500">
          <span>{st.label}</span>
          <span aria-hidden>·</span>
          <span className="truncate">{j.band === 'standing' ? '고른 고객에게' : `${j.triggerLabel} 때 시작`}</span>
        </div>
      </button>

      <div className="px-3 pb-3 space-y-2">
        <p className="text-[11px] leading-relaxed text-slate-400 line-clamp-2">{j.targetSummary}</p>

        <div className="grid grid-cols-3 gap-1.5 text-center">
          <div className="rounded-lg bg-white px-1 py-1.5">
            <div className="text-[11px] text-slate-400">진행 중</div>
            <div className="text-xs font-semibold text-slate-900 tabular-nums">{countText(j.counts.activeNow, '0')}</div>
          </div>
          <div className="rounded-lg bg-white px-1 py-1.5">
            <div className="text-[11px] text-slate-400">{j.windowDays}일 진입</div>
            <div className="text-xs font-semibold text-slate-900 tabular-nums">{countText(j.counts.entered, '0')}</div>
          </div>
          <div className="rounded-lg bg-white px-1 py-1.5">
            <div className="text-[11px] text-slate-400 truncate">{j.goalLabel}</div>
            <div className="text-xs font-semibold text-emerald-700 tabular-nums">
              {j.goalExitEnabled ? countText(j.counts.goalMet, '아직 없음') : '꺼짐'}
            </div>
          </div>
        </div>

        {j.pendingGoalExit != null && j.pendingGoalExit > 0 && (
          <div className="flex items-start gap-1.5 text-[11px] leading-relaxed text-emerald-700">
            <Target className="w-3 h-3 mt-0.5 shrink-0" />
            <span>이미 구매해서 다음 칸 전에 마칠 고객 약 {j.pendingGoalExit.toLocaleString('ko-KR')}명</span>
          </div>
        )}
        {j.notices.map((n) => (
          <p key={n} className="text-[11px] leading-relaxed text-slate-500">{n}</p>
        ))}
        {/* ★ 0930 V2 5차 — 옛 판(새 고객 안 받음 · 진행 중 고객 마무리 중) */}
        {j.olderVersions.length > 0 && (
          <div className="flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-500">
            <Layers className="w-3 h-3 mt-0.5 shrink-0" />
            <span>
              옛 판 {j.olderVersions.length}개 · 진행 중 {j.olderVersions.reduce((a, v) => a + v.activeNow, 0).toLocaleString('ko-KR')}명 마무리 중(새 고객은 이 판이 받아요)
            </span>
          </div>
        )}

        {/* 손봐야 함 = 호박색 전용 */}
        {j.broadAudience && (
          <div className="flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-800">
            <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
            <span>대상 조건이 없어 모든 고객에게 보냅니다.</span>
          </div>
        )}
        {j.capability && !j.capability.available && j.status !== 'ended' && (
          <div className="flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-800">
            <Lock className="w-3 h-3 mt-0.5 shrink-0" />
            <span>새 고객이 들어오지 않아요. {j.capability.reason}</span>
          </div>
        )}
        {j.graph.issues.map((msg) => (
          <div key={msg} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-800">
            <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
            <span>{msg}</span>
          </div>
        ))}

        {overlapsWith.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => onFocusJourney(o.id)}
            className="w-full flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1.5 text-left text-[11px] text-rose-900 hover:bg-rose-100 transition-colors"
          >
            <Users className="w-3 h-3 shrink-0" />
            <span className="flex-1 min-w-0 truncate">같이 받음: {o.name}</span>
            <span className="shrink-0 tabular-nums text-rose-800">{o.concurrentActive > 0 ? `지금 ${o.concurrentActive.toLocaleString('ko-KR')}명` : '지금 0명'}</span>
          </button>
        ))}

        {/* 나가는 선 — 모바일에서는 이 줄이 선이다 */}
        {outgoing.map((ln) => {
          const style = LINE_STYLE[ln.tier];
          return (
            <div key={ln.id} className="flex items-center gap-1.5 text-[11px] text-slate-500">
              <span className="w-3 h-0 border-t-2 shrink-0" style={{ borderColor: style.stroke, borderStyle: ln.tier === 'solid' ? 'solid' : 'dashed' }} aria-hidden />
              <ArrowRight className="w-3 h-3 shrink-0 text-slate-400" />
              <span className="flex-1 min-w-0 truncate">
                {ln.toLabel} 여정 · <span className={ln.tier === 'warn' ? 'text-amber-800' : ln.tier === 'solid' ? 'text-violet-800' : 'text-slate-400'}>{LINE_SHORT[ln.state]}</span>
              </span>
              {ln.tier === 'solid' && (
                <span className="shrink-0 tabular-nums text-slate-500">이어받음 {countText(ln.handedOver)}</span>
              )}
            </div>
          );
        })}

        {expanded && (
          <div id={bodyId} className="pt-2 mt-1 border-t border-slate-200 space-y-1.5">
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
              <Flag className="w-3 h-3 shrink-0 text-violet-700" />
              <span>시작: {j.band === 'standing' ? '고른 고객에게' : j.triggerLabel}</span>
            </div>
            <ExitMarker n={j.exitsBeforeFirst || 0} label={j.goalLabel} first />
            {j.steps.length === 0 && <div className="text-[11px] text-slate-400 pl-3">아직 칸이 없어요.</div>}
            {j.steps.map((s) => {
              const chip = CHIP_STYLE[s.kind] || CHIP_STYLE.unknown;
              const br = s.kind === 'condition' ? conditionBranches(j, s.order) : null;
              return (
                <div key={s.stepId} className="space-y-1.5">
                  <div className="pl-3 text-[11px] text-slate-400">↓ {s.intervalLabel}</div>
                  <button
                    type="button"
                    onClick={() => onOpenStep(s)}
                    className={`w-full text-left rounded-lg px-2.5 py-2 hover:brightness-125 transition ${chip.box}`}
                  >
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold">
                      <ChipIcon kind={s.kind} />
                      <span className="min-w-0 truncate">{s.order}번째 · {s.kind === 'message' ? stepChannelLabel(s.channel) : chip.label}</span>
                      <span className="ml-auto shrink-0 whitespace-nowrap font-normal text-slate-500 tabular-nums">{s.timingLabel}</span>
                    </div>
                    {s.kind === 'message' && s.preview && (
                      <div className="mt-1 text-[11px] leading-relaxed text-slate-500 line-clamp-2">{s.preview}</div>
                    )}
                    {br && (
                      <div className="mt-1 text-[11px] text-slate-500">{br.met} · {br.notMet}</div>
                    )}
                    {(s.waitingHere > 0 || s.kind === 'message') && (
                      <div className="mt-1 flex gap-2 text-[11px] text-slate-400 tabular-nums">
                        {s.waitingHere > 0 && <span>지금 {s.waitingHere.toLocaleString('ko-KR')}명</span>}
                        {s.kind === 'message' && <span className="ml-auto">{s.outOfWindow ? `${j.windowDays}일 창 밖` : `받음 ${countText(s.reached, '0')}`}</span>}
                      </div>
                    )}
                  </button>
                  {s.exitsAfter != null && <ExitMarker n={s.exitsAfter} label={j.goalLabel} />}
                </div>
              );
            })}
            <div className="flex items-center gap-1.5 pl-3 text-[11px] text-slate-500">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-300" aria-hidden />
              <span className="flex-1">{j.entryReplace ? '같은 상품을 다시 사면 처음부터' : j.endNote}</span>
              <span className="tabular-nums text-slate-400">끝까지 {countText(j.counts.completed, '0')}</span>
            </div>
            <div className="flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-400 pt-1">
              <Lock className="w-3 h-3 mt-0.5 shrink-0" />
              <span>{j.edit.reason}</span>
            </div>
            {j.canNewVersion && (
              <button
                type="button"
                onClick={() => onNewVersion(j)}
                className="w-full h-8 rounded-lg text-[11px] font-semibold text-slate-900 bg-violet-200 hover:bg-violet-500 inline-flex items-center justify-center gap-1 transition-colors"
              >
                <Copy className="w-3.5 h-3.5" /> 새 판으로 고치기
              </button>
            )}
            <button
              type="button"
              onClick={() => onOpenJourney(j.id)}
              className="w-full h-8 rounded-lg text-[11px] font-medium text-violet-800 border border-violet-200 hover:bg-violet-100 transition-colors"
            >
              여정 자세히 보기
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
