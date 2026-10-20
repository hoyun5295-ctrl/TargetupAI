/**
 * MapJourneyCard — 지도 여정 요약 카드 한 벌 (★ 2026-10-20 여정 V.3 §10-2 · 데스크톱 캔버스 · 모바일 목록 · 상품 띠 · 아랫띠 공용)
 *
 * 한 장에 여섯 줄(높이 = journey-map-layout 의 S 상수 · 배치 함수가 같은 값으로 자리를 잡는다):
 *   1. 상태 점 · 이름(14px) · ⋯
 *   2. 한 문장 「○○ 때 · 문자 N통 · 언제 끝나는지」(서버 triggerLabel · endNote)
 *   3. 칸 띠 ①─②─③(간격) + 가장 많이 기다리는 칸 한 줄 · 누르면 작업 화면 그 칸
 *   4. 숫자 3칸: 지금 진행 · 최근 N일 들어옴 · 목표로 마침(라벨에 창 일수)
 *   5. (있을 때만) 손볼 곳 · 멈춘 이유 한 줄 · 겹침 결과 문장 + [한 통만 보내기](해소 길이 있는 쌍만 호박)
 *   6. 바닥 [멈추기 | 다시 켜기 | 켜기] [고치기]
 * ⛔ 의미(상태 · 손볼 곳 · 겹침 · 출구)는 서버 값이다. 호박색 = 손볼 곳 전용(멈춤은 회색).
 * ⛔ 「새 판」이라는 말과 버튼은 없다(고치기 = 작업 화면이 새 모양을 서버 한 흐름으로 처리).
 * list 모양(모바일 · 아랫띠)은 줄 높이가 자유이고 「구매하면 → ○○ 여정」 줄이 선을 대신하며, 펼치면 칸 목록이 나온다.
 */
import type { CSSProperties } from 'react';
import { AlertCircle, ArrowRight, ChevronDown, ExternalLink, GitBranch, Hourglass, Layers, Link2, Loader2, Pause, Play, Power, Unlink, Wrench } from 'lucide-react';
import { ZoneMoreMenu } from '../../zone/ZoneHeader';
import {
  CHIP_STYLE, LINE_SHORT, LINE_STYLE, STATUS_META, countText, lineLeadText, lineTargetText,
  type AttachFix, type MapJourney, type MapLine, type MapOverlap, type MapStep,
} from '../../../utils/journey-map';
import { S, SUMMARY_OVERLAP_MAX, summaryNote } from '../../../utils/journey-map-layout';
import { stepChannelLabel } from '../../../utils/journey-labels';

interface Props {
  journey: MapJourney;
  variant: 'canvas' | 'list';
  overlaps: MapOverlap[];
  nameOf: (id: string) => string;
  /** 상품 카드 — 묶인 선 대신 이어받은 사람 수(받는 선들의 합 · 0 이면 줄 없음). */
  incoming?: number | null;
  outgoing?: MapLine[];
  expanded?: boolean;
  onToggle?: () => void;
  focused: boolean;
  busy: boolean;
  style?: CSSProperties;
  onOpen: (stepId: string | null) => void;
  onAction: () => void;
  onFix: (fix: AttachFix) => void;
  onFocusJourney: (id: string) => void;
  onEntrants: () => void;
  /** ★ V.3 §18 — 이 여정 뒤에 다른 여정 붙이기 · 앞 여정에서 떼기(붙은 여정만). */
  onAttach: () => void;
  onDetach: () => void;
  onHover?: (on: boolean) => void;
}

const shortInterval = (s: MapStep) => {
  const t = String(s.intervalLabel || '').replace(/ 뒤$/, '');
  if (t.startsWith('사건이')) return '사건 뒤';
  return t.length > 7 ? `${t.slice(0, 6)}…` : t;
};

function conditionBranches(journey: MapJourney, order: number): string {
  const edges = journey.graph.edges.filter((e) => e.from === order);
  const met = edges.find((e) => e.kind === 'met');
  const notMet = edges.find((e) => e.kind === 'not_met' || e.kind === 'not_met_end');
  return `${met && met.to > 0 ? '맞으면 다음 칸' : '맞으면 여정 끝'} · ${notMet && notMet.kind === 'not_met' ? `아니면 ${notMet.to}번째 칸으로` : '아니면 여정 끝'}`;
}

export default function MapJourneyCard({
  journey: j, variant, overlaps, nameOf, incoming, outgoing = [], expanded = false, onToggle, focused, busy, style,
  onOpen, onAction, onFix, onFocusJourney, onEntrants, onAttach, onDetach, onHover,
}: Props) {
  const canvas = variant === 'canvas';
  const st = STATUS_META[j.status] || STATUS_META.ended;
  const dim = j.status === 'ended' || j.status === 'draft';
  const msgCount = j.steps.filter((s) => s.kind === 'message').length;
  const note = summaryNote(j);
  const shownSteps = j.steps.length > 4 ? j.steps.slice(0, 3) : j.steps;
  const busiest = j.steps.reduce<MapStep | null>((m, s) => (s.waitingHere > (m?.waitingHere || 0) ? s : m), null);
  const older = j.olderVersions.reduce((a, v) => a + Number(v.activeNow || 0), 0);
  const row = (h: number): CSSProperties | undefined => (canvas ? { height: h } : undefined);
  const action = j.status === 'active' ? { label: '멈추기', Icon: Pause } : j.status === 'paused' ? { label: '다시 켜기', Icon: Play } : j.status === 'draft' ? { label: '켜기', Icon: Power } : null;

  return (
    <div
      data-jmap-card={j.id}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
      style={style}
      className={`${canvas ? 'absolute overflow-hidden' : ''} flex flex-col rounded-2xl border bg-white transition-shadow ${dim ? 'border-dashed border-slate-300' : 'border-slate-200 shadow-sm'} ${focused ? 'ring-2 ring-indigo-300' : ''}`}
    >
      <div className="flex flex-col" style={{ padding: S.pad, gap: S.gap }}>
        {/* 1. 머리 */}
        <div className="flex items-center gap-2" style={row(S.head)}>
          <span className={`h-2 w-2 shrink-0 rounded-full ${st.dot}`} aria-label={st.label} />
          <button type="button" onClick={() => onOpen(null)} className="min-w-0 flex-1 truncate text-left text-[14px] font-semibold leading-5 text-slate-900 hover:text-indigo-700">
            {j.name || '이름 없는 여정'}
          </button>
          {!canvas && onToggle && (
            <button type="button" onClick={onToggle} aria-expanded={expanded} aria-label={expanded ? '칸 접기' : '칸 펼치기'} className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
              <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            </button>
          )}
          <ZoneMoreMenu tone="light" items={[
            { label: '진입 고객 보기', icon: ExternalLink, onClick: onEntrants },
            { label: '작업 화면 열기', icon: Wrench, onClick: () => onOpen(null) },
            ...(j.status !== 'ended' ? [{ label: '뒤에 여정 붙이기', icon: Link2, onClick: onAttach }] : []),
            ...(j.attachedAfter && j.status !== 'ended' ? [{ label: '앞 여정에서 떼기', icon: Unlink, onClick: onDetach }] : []),
          ]} />
        </div>

        {/* 2. 한 문장 */}
        <p className="truncate text-[12.5px] leading-[18px] text-slate-500" style={row(S.line)}>
          {st.label} · {j.attachedAfter ? j.triggerLabel : j.band === 'standing' ? '고른 고객에게' : `${j.triggerLabel} 때`} · 문자 {msgCount}통 · {j.entryReplace ? '다시 사면 처음부터' : j.endNote}
        </p>

        {/* 3. 칸 띠 */}
        <div className="flex flex-col justify-between" style={row(S.strip)}>
          {j.steps.length === 0 ? (
            <span className="text-[12px] text-slate-400">아직 칸이 없어요.</span>
          ) : (
            <>
              <div className="flex min-w-0 items-center gap-1 overflow-hidden">
                {shownSteps.map((s, i) => {
                  const Icon = s.kind === 'wait' ? Hourglass : s.kind === 'condition' ? GitBranch : null;
                  return (
                    <span key={s.stepId} className="flex min-w-0 items-center gap-1">
                      {i > 0 && <span className="h-px w-2 shrink-0 bg-slate-300" aria-hidden />}
                      <button type="button" onClick={() => onOpen(s.stepId)} title={`${s.order}번째 · ${s.kind === 'message' ? stepChannelLabel(s.channel) : CHIP_STYLE[s.kind]?.label || '칸'} · ${s.intervalLabel}`}
                        className={`inline-flex h-[22px] shrink-0 items-center gap-1 rounded-full border px-1.5 text-[12px] tabular-nums ${s.waitingHere > 0 ? 'border-indigo-200 bg-indigo-50 text-indigo-800' : 'border-slate-200 bg-white text-slate-600'} hover:border-indigo-300`}>
                        {Icon ? <Icon className="h-3 w-3 shrink-0" aria-hidden /> : <span className="font-semibold">{s.order}</span>}<span className="text-slate-400">·</span>{shortInterval(s)}
                      </button>
                    </span>
                  );
                })}
                {j.steps.length > shownSteps.length && <span className="shrink-0 text-[12px] text-slate-400">외 {j.steps.length - shownSteps.length}칸</span>}
              </div>
              <div className="truncate text-[12px] leading-4 text-slate-500">
                {busiest ? `${busiest.order}번째 칸에 지금 ${busiest.waitingHere.toLocaleString('ko-KR')}명 기다려요` : j.status === 'active' ? '지금 기다리는 고객이 없어요' : ' '}
              </div>
            </>
          )}
        </div>

        {/* 4. 숫자 3칸 */}
        <div className="grid grid-cols-3 gap-1.5" style={row(S.nums)}>
          {[
            ['지금 진행', countText(j.counts.inProgress, '0'), 'text-slate-900'],
            [`${j.windowDays}일 들어옴`, countText(j.counts.entered, '0'), 'text-slate-900'],
            [`${j.goalLabel}로 마침`, j.goalExitEnabled ? countText(j.counts.goalMet, '0') : '목표 끔', 'text-emerald-700'],
          ].map(([k, v, tone]) => (
            <div key={k} className="min-w-0 rounded-lg bg-slate-50 px-2 py-1">
              <div className="truncate text-[12px] leading-4 text-slate-500">{k}</div>
              <div className={`truncate text-[14px] font-semibold leading-5 tabular-nums ${tone}`}>{v}</div>
            </div>
          ))}
        </div>

        {/* 5. 손볼 곳 · 멈춘 이유 */}
        {note && (
          <div className={`flex min-w-0 items-center gap-1.5 text-[12px] ${note.tone === 'fix' ? 'text-amber-800' : 'text-slate-500'}`} style={row(S.note)}>
            {note.tone === 'paused' ? <Pause className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />}
            <span className="min-w-0 flex-1 truncate" title={note.text}>{note.text}</span>
            {note.tone === 'fix' && j.health.fix && (
              <button type="button" onClick={() => onFix(j.health.fix!)} className="shrink-0 font-semibold text-amber-900 underline underline-offset-2">{j.health.fix.label}</button>
            )}
          </div>
        )}
        {overlaps.slice(0, canvas ? SUMMARY_OVERLAP_MAX : overlaps.length).map((o) => {
          const other = o.a === j.id ? o.b : o.a;
          return (
            <div key={`${o.a}|${o.b}`} className={`flex min-w-0 items-center gap-1.5 rounded-lg px-2 text-[12px] ${o.fix ? 'bg-amber-50 text-amber-900' : 'bg-slate-50 text-slate-500'}`} style={row(S.overlap)}>
              <button type="button" onClick={() => onFocusJourney(other)} className="min-w-0 flex-1 truncate text-left" title={o.text}>{o.text || `같은 구매에 문자 2통 · ${nameOf(other)}`}</button>
              {o.fix && <button type="button" onClick={() => onFix(o.fix!)} className="shrink-0 font-semibold underline underline-offset-2">{o.fix.label}</button>}
            </div>
          );
        })}

        {/* list 모양 — 선 대신 줄 · 옛 모양 마무리 · 상품 이어받음 */}
        {!canvas && incoming != null && incoming > 0 && <p className="text-[12px] text-slate-500">앞 여정에서 이어받음 {incoming.toLocaleString('ko-KR')}명</p>}
        {!canvas && older > 0 && (
          <p className="flex items-center gap-1.5 text-[12px] text-slate-500"><Layers className="h-3.5 w-3.5 shrink-0" aria-hidden />옛 모양으로 마무리 중 {older.toLocaleString('ko-KR')}명</p>
        )}
        {!canvas && outgoing.map((ln) => (
          <div key={ln.id} className="flex items-center gap-1.5 text-[12px] text-slate-500">
            <span className="h-0 w-3 shrink-0 border-t-2" style={{ borderColor: LINE_STYLE[ln.tier].stroke, borderStyle: ln.tier === 'solid' ? 'solid' : 'dashed' }} aria-hidden />
            <ArrowRight className="h-3 w-3 shrink-0 text-slate-400" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{lineLeadText(ln)} → {lineTargetText(ln)} · <span className={ln.tier === 'warn' ? 'text-amber-800' : 'text-slate-500'}>{LINE_SHORT[ln.state]}</span></span>
            {ln.tier === 'solid' && (ln.handedOver || 0) > 0 && <span className="shrink-0 tabular-nums">이어받음 {Number(ln.handedOver).toLocaleString('ko-KR')}명</span>}
          </div>
        ))}
        {!canvas && expanded && (
          <div className="space-y-1.5 border-t border-slate-100 pt-2">
            {j.steps.map((s) => (
              <button key={s.stepId} type="button" onClick={() => onOpen(s.stepId)} className={`w-full rounded-lg px-2.5 py-2 text-left ${(CHIP_STYLE[s.kind] || CHIP_STYLE.unknown).box}`}>
                <div className="flex items-center gap-1.5 text-[12px] font-semibold">
                  <span className="min-w-0 truncate">{s.order}번째 · {s.kind === 'message' ? stepChannelLabel(s.channel) : (CHIP_STYLE[s.kind] || CHIP_STYLE.unknown).label}</span>
                  <span className="ml-auto shrink-0 font-normal text-slate-500">{s.intervalLabel}</span>
                </div>
                {s.kind === 'message' && s.preview && <div className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-slate-500">{s.preview}</div>}
                {s.kind === 'condition' && <div className="mt-1 text-[12px] text-slate-500">{conditionBranches(j, s.order)}</div>}
                {s.waitingHere > 0 && <div className="mt-1 text-[12px] tabular-nums text-slate-500">지금 {s.waitingHere.toLocaleString('ko-KR')}명 기다림</div>}
              </button>
            ))}
          </div>
        )}

        {/* 6. 바닥 버튼 */}
        <div className="flex items-center gap-1.5" style={row(S.actions)}>
          {action && (
            <button type="button" onClick={onAction} disabled={busy}
              className={`inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-[12.5px] font-semibold disabled:opacity-50 ${j.status === 'active' ? 'border border-slate-200 bg-white text-slate-700 hover:border-slate-300' : 'bg-slate-900 text-white hover:bg-slate-800'}`}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <action.Icon className="h-3.5 w-3.5" aria-hidden />}{action.label}
            </button>
          )}
          <button type="button" onClick={() => onOpen(null)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[12.5px] font-semibold text-slate-700 hover:border-indigo-200 hover:text-indigo-700">
            <Wrench className="h-3.5 w-3.5" aria-hidden />고치기
          </button>
          {canvas && incoming != null && incoming > 0 && <span className="ml-auto truncate text-[12px] tabular-nums text-slate-500">이어받음 {incoming.toLocaleString('ko-KR')}명</span>}
          {canvas && !(incoming != null && incoming > 0) && older > 0 && <span className="ml-auto truncate text-[12px] tabular-nums text-slate-500" title="옛 모양으로 마무리 중">마무리 중 {older.toLocaleString('ko-KR')}명</span>}
        </div>
      </div>
    </div>
  );
}
