/**
 * GapFinderModal — 빈 곳 찾기 (★ 2026-09-29 여정 V2 1차 · 설계서 §5)
 *
 * 지금 있는 여정을 보고 모자란 곳을 네 묶음으로 보여 준다. 이 창을 여는 데는 AI 호출 0 · 차감 0 · 숫자는 서버 실측 그대로.
 *   ①비어 있는 구간 — 지도 유령 카드 + 기존 "오늘의 여정 기회"(실제 대상 수). [바로 만들기] = 기존 1클릭 생성 경로 재사용(AI 생성 1회 차감 · 금액 = 서버 단가).
 *   ②손봐야 할 곳 — 호박색 선(자동 종료 꺼짐 · 받는 여정 초안/멈춤 · 다시 받기 막힘) · 전 고객 대상 · 칸 규칙 위반 · 데이터가 없어 새 고객이 안 들어오는 여정.
 *   ③겹침 — 같은 구매 한 번에 두 여정이 함께 시작될 수 있는 쌍.
 *   ④데이터가 있어야 열리는 여정 — 무엇을 연동하면 열리는지.
 * ⛔ 성과를 약속하는 숫자(예상 매출 · 전환)를 만들어 내지 않는다. 서버가 준 대상 수만 쓴다.
 */
import { AlertCircle, ArrowRight, Lock, Plus, Sparkles, Users, X } from 'lucide-react';
import JourneyModalShell from '../JourneyModalShell';
import { LINE_SHORT, type AttachFix, type CreateMode, type LifecycleMapData } from '../../../utils/journey-map';

export interface GapOpportunity {
  type: string;
  title: string;
  description: string;
  count: number;
  suggestedObjective: string;
  preferTriggerEvent?: string;
  notices?: string[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  data: LifecycleMapData;
  opportunities: GapOpportunity[];
  onCreate: (triggerEvent: string, objective?: string, mode?: CreateMode) => void;
  onFocusJourney: (id: string) => void;
  onFix: (fix: AttachFix) => void;
}

function Group({ title, count, desc, children }: { title: string; count: number; desc: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <span className="text-[11px] text-white/45 tabular-nums">{count}</span>
      </div>
      <p className="mt-0.5 text-[11px] text-white/45">{desc}</p>
      <div className="mt-2.5 space-y-2">{children}</div>
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed border-white/10 px-3 py-2.5 text-[11px] text-white/40">{text}</div>;
}

export default function GapFinderModal({ open, onClose, data, opportunities, onCreate, onFocusJourney, onFix }: Props) {
  const nameOf = (id: string) => data.journeys.find((j) => j.id === id)?.name || '여정';

  // ① 비어 있는 구간 — 기회 카드(대상 수가 있다)를 먼저, 같은 시작 사건의 유령 카드는 합친다.
  const oppTriggers = new Set(opportunities.map((o) => o.preferTriggerEvent).filter(Boolean) as string[]);
  const ghostsOpen = data.ghosts.filter((g) => g.available && !oppTriggers.has(g.triggerEvent));

  // ② 손봐야 할 곳
  const warnLines = data.lines.filter((l) => l.tier === 'warn');
  const broad = data.journeys.filter((j) => j.broadAudience && j.status !== 'ended');
  const issues = data.journeys.filter((j) => j.graph.issues.length > 0 && j.status !== 'ended');
  const starving = data.journeys.filter((j) => j.status === 'active' && j.capability && !j.capability.available);
  const fixCount = warnLines.length + broad.length + issues.length + starving.length;

  // ④ 데이터가 있어야 열리는 여정 — 유령 카드의 잠김과 합친다(시작 사건당 1줄).
  const locked = data.lockedTriggers;

  const row = 'rounded-xl border px-3 py-2.5';
  const focusBtn = (id: string, label = '지도에서 보기') => (
    <button
      type="button"
      onClick={() => { onClose(); onFocusJourney(id); }}
      className="shrink-0 h-7 px-2.5 rounded-lg text-[11px] font-medium text-white/75 border border-white/15 hover:bg-white/10 inline-flex items-center gap-1 transition-colors"
    >
      {label} <ArrowRight className="w-3 h-3" />
    </button>
  );

  return (
    <JourneyModalShell open={open} onClose={onClose} labelledBy="jmap-gap-title" panelClassName="w-full max-w-2xl">
      <div className="flex items-start gap-3 px-5 pt-5 pb-3 border-b border-white/10">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shrink-0">
          <Sparkles className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 id="jmap-gap-title" className="text-sm font-semibold text-white">빈 곳 찾기</h2>
          <p className="mt-0.5 text-[11px] text-white/50">지금 있는 여정을 보고 비어 있거나 손봐야 할 곳을 모았어요.</p>
        </div>
        <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10" aria-label="닫기">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
        <Group title="비어 있는 구간" count={opportunities.length + ghostsOpen.length} desc={`초안 만들기 ${data.costs.generate} 크레딧 · 켜기 전에는 아무것도 발송되지 않습니다.`}>
          {opportunities.length === 0 && ghostsOpen.length === 0 && <Empty text="지금 데이터로 비어 보이는 구간이 없어요." />}
          {opportunities.map((o) => (
            <div key={`${o.type}:${o.preferTriggerEvent || ''}`} className={`${row} border-white/10 bg-white/[0.03]`}>
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-semibold text-white">{o.title}</span>
                    <span className="text-xs font-bold text-white tabular-nums">{o.count.toLocaleString('ko-KR')}<span className="text-[11px] font-medium text-white/50 ml-0.5">명</span></span>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-white/60">{o.description}</p>
                  {(o.notices || []).map((n) => (
                    <div key={n} className="mt-1 flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-200/90">
                      <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                      <span>{n}</span>
                    </div>
                  ))}
                </div>
                {o.preferTriggerEvent && (
                  <button
                    type="button"
                    onClick={() => onCreate(o.preferTriggerEvent!, o.suggestedObjective)}
                    className="shrink-0 h-8 px-3 rounded-lg text-[11px] font-semibold text-white bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 inline-flex items-center gap-1 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" /> 바로 만들기
                  </button>
                )}
              </div>
            </div>
          ))}
          {ghostsOpen.map((g) => (
            <div key={g.triggerEvent} className={`${row} border-dashed border-white/15 bg-transparent flex items-center gap-3`}>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-white/85">{g.label} 여정이 없어요</div>
                <p className="mt-0.5 text-[11px] text-white/50">이 구간에 들어온 고객에게 보낼 여정이 아직 없습니다.</p>
              </div>
              <button
                type="button"
                onClick={() => onCreate(g.triggerEvent, undefined, g.createMode)}
                className="shrink-0 h-8 px-3 rounded-lg text-[11px] font-semibold text-white bg-violet-600 hover:bg-violet-500 inline-flex items-center gap-1 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> 바로 만들기
              </button>
            </div>
          ))}
        </Group>

        <Group title="손봐야 할 곳" count={fixCount} desc="여정끼리 이어지지 않거나 뜻과 다르게 보내질 수 있는 곳이에요.">
          {fixCount === 0 && <Empty text="지금 손봐야 할 곳이 없어요." />}
          {warnLines.map((l) => (
            <div key={l.id} className={`${row} border-amber-400/30 bg-amber-500/[0.06] flex items-center gap-3`}>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-amber-100">{nameOf(l.fromJourneyId)} → {l.toLabel} 여정 · {LINE_SHORT[l.state]}</div>
                <p className="mt-0.5 text-[11px] leading-relaxed text-amber-100/70">{l.reason}</p>
              </div>
              {l.fix ? (
                <button
                  type="button"
                  onClick={() => { onClose(); onFix(l.fix!); }}
                  className="shrink-0 h-7 px-2.5 rounded-lg text-[11px] font-semibold text-white bg-violet-600 hover:bg-violet-500 transition-colors"
                >
                  {l.fix.label}
                </button>
              ) : focusBtn(l.fromJourneyId)}
            </div>
          ))}
          {broad.map((j) => (
            <div key={`broad:${j.id}`} className={`${row} border-amber-400/30 bg-amber-500/[0.06] flex items-center gap-3`}>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-amber-100">{j.name}</div>
                <p className="mt-0.5 text-[11px] leading-relaxed text-amber-100/70">대상 조건이 없어 모든 고객에게 보냅니다. 뜻한 대상이 맞는지 확인해 주세요.</p>
              </div>
              {focusBtn(j.id)}
            </div>
          ))}
          {issues.map((j) => (
            <div key={`issue:${j.id}`} className={`${row} border-amber-400/30 bg-amber-500/[0.06] flex items-center gap-3`}>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-amber-100">{j.name}</div>
                {j.graph.issues.map((m) => <p key={m} className="mt-0.5 text-[11px] leading-relaxed text-amber-100/70">{m}</p>)}
              </div>
              {focusBtn(j.id)}
            </div>
          ))}
          {starving.map((j) => (
            <div key={`starve:${j.id}`} className={`${row} border-amber-400/30 bg-amber-500/[0.06] flex items-center gap-3`}>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-amber-100">{j.name} · 새 고객이 들어오지 않아요</div>
                <p className="mt-0.5 text-[11px] leading-relaxed text-amber-100/70">{j.capability?.reason}</p>
              </div>
              {focusBtn(j.id)}
            </div>
          ))}
        </Group>

        <Group title="겹침" count={data.overlaps.length} desc="같은 구매 한 번에 두 여정이 함께 시작될 수 있어요. 한 고객이 두 여정의 문자를 모두 받습니다.">
          {data.overlaps.length === 0 && <Empty text="함께 시작되는 여정 쌍이 없어요." />}
          {data.overlaps.map((o) => (
            <div key={`${o.a}|${o.b}`} className={`${row} border-rose-400/30 bg-rose-500/[0.06] flex items-center gap-3`}>
              <Users className="w-4 h-4 text-rose-200 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-rose-100 truncate">{nameOf(o.a)} · {nameOf(o.b)}</div>
                <p className="mt-0.5 text-[11px] text-rose-100/70 tabular-nums">지금 두 여정을 함께 받는 고객 {o.concurrentActive.toLocaleString('ko-KR')}명</p>
              </div>
              {focusBtn(o.a, '두 여정 보기')}
            </div>
          ))}
        </Group>

        <Group title="데이터가 있어야 열리는 여정" count={locked.length} desc="연동하면 이 시작 사건으로 여정을 만들 수 있어요.">
          {locked.length === 0 && <Empty text="지금 데이터로 모든 시작 사건을 쓸 수 있어요." />}
          {locked.map((t) => (
            <div key={t.triggerEvent} className={`${row} border-white/10 bg-white/[0.02] flex items-start gap-2.5`}>
              <Lock className="w-3.5 h-3.5 mt-0.5 text-white/40 shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-white/80">{t.label}</div>
                <p className="mt-0.5 text-[11px] leading-relaxed text-white/50">{t.reason}</p>
              </div>
            </div>
          ))}
        </Group>
      </div>

      <div className="px-5 py-3 border-t border-white/10 text-[10px] text-white/30 italic">
        출처: 여정 · 여정 진행 기록 · 고객 데이터 실시간 집계(AI 호출 없음)
      </div>
    </JourneyModalShell>
  );
}
