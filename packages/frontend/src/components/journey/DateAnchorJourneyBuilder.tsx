/**
 * 날짜축 여정 빌더 — 지정일 D-N + AI 자동 생성 + 스텝별 문안 편집 모달 (2026-06-30 여정 일반화 SP-B)
 *
 * 회사가 지정한 기준 날짜(예: 포인트 소멸일) 기준 D-N 멀티스텝.
 * AI 주도:
 *   - 상단 [AI 자동 생성]: "7일전 3일전 당일" 자연어 → D-7/D-3/D-0 스텝 + 문안 일괄 생성.
 *   - 스텝별 [문안 편집]: 넓은 편집 모달에서 AI 다듬기(3 톤)·AI 꾸미기(활용 컬럼 녹임)로 하나하나 손보기.
 * 스텝 채널 = LMS((광고) 표기·무료수신거부 자동). 활성화 시 전체 문안 스팸필터 테스트.
 * D-0 발송 후: 반복 없음 = 자동 정지(새 날짜 지정 시 재가동) / 반복 = 다음 앵커 자동 갱신.
 */

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarClock, ArrowLeft, Plus, X, Repeat, Sparkles, Loader2, Wand2, Pencil, Check } from 'lucide-react';

export interface DateAnchorStep {
  anchorOffsetDays: number;
  subject: string;
  messageTemplate: string;
}
export interface DateAnchorAudienceCondition { field: string; op: string; value: string; }

export interface DateAnchorBuildResult {
  name: string;
  anchorDate: string;
  anchorRecurrence: string;
  anchorRecurrenceDay: number | null;
  anchorHourKst: number;
  triggerFilters: Record<string, any>;
  steps: { anchorOffsetDays: number; channel: 'lms'; messageTemplate: string; subject: string }[];
}

const RECURRENCES = [
  { key: 'none', label: '반복 없음', desc: 'D-0 후 정지 → 새 날짜 지정 시 재가동' },
  { key: 'monthly_day', label: '매달 N일', desc: '매달 같은 날 반복' },
  { key: 'monthly_last', label: '매달 말일', desc: '매달 마지막 날 반복' },
  { key: 'yearly', label: '매년', desc: '매년 같은 날 반복' },
];

const COND_FIELDS = [
  { key: 'grade', label: '등급' }, { key: 'region', label: '지역' },
  { key: 'store_name', label: '매장명' }, { key: 'store_code', label: '매장코드' },
  { key: 'age', label: '나이' }, { key: 'purchase_count', label: '구매횟수' },
  { key: 'total_purchase_amount', label: '누적구매액' }, { key: 'points', label: '포인트' },
];
const COND_OPS = [
  { key: '==', label: '같음' }, { key: '!=', label: '다름' }, { key: '>=', label: '이상' }, { key: '<=', label: '이하' }, { key: '>', label: '초과' }, { key: '<', label: '미만' },
];

interface Props {
  embedded?: boolean;
  dataProfileVars: { token: string; label: string }[];
  onBuild: (result: DateAnchorBuildResult) => void;
  onBack: () => void;
  /** 자연어 목표 → D-N 스텝 일괄 생성(문안 1건당 1크레딧). 실패 시 null. */
  onGeneratePlan: (objective: string) => Promise<{ offsetDays: number; subject: string; message: string }[] | null>;
  /** AI 다듬기 — 3 톤 후보. */
  onRefine: (message: string) => Promise<{ message: string; tone: string }[] | null>;
  /** AI 꾸미기 — 선택 컬럼 %변수% 녹임. */
  onDecorate: (message: string, selectedVars: string[]) => Promise<string | null>;
}

// ════════════════════════════════════════════════════════════════════
// 스텝 문안 편집 모달 — 넓은 편집 + AI 다듬기(3 톤) + AI 꾸미기(컬럼 선택). 중첩 모달 z-[2000].
// ════════════════════════════════════════════════════════════════════
function StepEditModal({
  step, offsetDays, dataProfileVars, onRefine, onDecorate, onSave, onClose,
}: {
  step: DateAnchorStep;
  offsetDays: number;
  dataProfileVars: { token: string; label: string }[];
  onRefine: (m: string) => Promise<{ message: string; tone: string }[] | null>;
  onDecorate: (m: string, vars: string[]) => Promise<string | null>;
  onSave: (subject: string, message: string) => void;
  onClose: () => void;
}) {
  const [subject, setSubject] = useState(step.subject);
  const [message, setMessage] = useState(step.messageTemplate);
  const [candidates, setCandidates] = useState<{ message: string; tone: string }[]>([]);
  const [selectedVars, setSelectedVars] = useState<Set<string>>(new Set());
  const [refining, setRefining] = useState(false);
  const [decorating, setDecorating] = useState(false);

  const doRefine = async () => {
    if (refining || message.trim().length < 10) return;
    setRefining(true);
    try { const c = await onRefine(message); if (c) setCandidates(c); } finally { setRefining(false); }
  };
  const doDecorate = async () => {
    if (decorating || selectedVars.size === 0 || message.trim().length < 5) return;
    setDecorating(true);
    try { const m = await onDecorate(message, Array.from(selectedVars)); if (m) { setMessage(m); setCandidates([]); } } finally { setDecorating(false); }
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-[2000] p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl max-w-xl w-full max-h-[92vh] overflow-hidden flex flex-col text-white" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="flex items-center justify-between p-4 border-b border-white/10 bg-gradient-to-r from-indigo-500/10 to-violet-500/10">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-400 to-violet-500 flex items-center justify-center">
              <Pencil className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">단계 문안 편집 <span className="text-indigo-300 font-mono">D-{offsetDays}</span></h3>
              <p className="text-[11px] text-white/45">AI 다듬기·꾸미기로 손보고 저장하세요</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-lg" aria-label="닫기"><X className="w-4 h-4 text-white/50" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div>
            <label className="block text-[11px] text-white/50 mb-1">제목 (LMS 필수)</label>
            <input value={subject} onChange={(e) => setSubject(e.target.value.slice(0, 40))} placeholder="본문 요약 한 줄" className="w-full bg-white/[0.06] border border-white/15 rounded-lg px-3 py-2 text-sm text-white" />
          </div>
          <div>
            <label className="block text-[11px] text-white/50 mb-1">본문</label>
            <textarea value={message} onChange={(e) => setMessage(e.target.value.slice(0, 2000))} rows={9} placeholder="본문을 작성하거나 AI 다듬기/꾸미기로 손보세요. 구체 혜택(%·원·쿠폰)은 직접 채워주세요." className="w-full bg-white/[0.06] border border-white/15 rounded-lg px-3 py-2 text-sm text-white resize-y leading-relaxed" />
            <div className="text-right text-[10px] text-white/35 mt-0.5">{message.length} / 2000자</div>
          </div>

          {/* AI 다듬기 */}
          <div className="p-3 rounded-xl bg-white/[0.04] border border-white/10">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold text-white/85">AI 다듬기 <span className="text-white/40 font-normal">3가지 톤 후보</span></span>
              <button onClick={doRefine} disabled={refining || message.trim().length < 10} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-gradient-to-r from-sky-500 to-indigo-500 text-[11px] font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed">
                {refining ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />} 다듬기
              </button>
            </div>
            {candidates.length > 0 && (
              <div className="space-y-1.5">
                {candidates.map((c, i) => (
                  <div key={i} className="p-2 rounded-lg bg-white/[0.05] border border-white/10">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-indigo-300 font-medium">{c.tone}</span>
                      <button onClick={() => { setMessage(c.message); setCandidates([]); }} className="inline-flex items-center gap-1 text-[10px] text-emerald-300 hover:text-emerald-200">
                        <Check className="w-3 h-3" /> 적용
                      </button>
                    </div>
                    <p className="text-[11px] text-white/70 whitespace-pre-wrap leading-relaxed">{c.message}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* AI 꾸미기 */}
          <div className="p-3 rounded-xl bg-white/[0.04] border border-violet-400/20">
            <div className="flex items-center justify-between mb-1.5">
              <div>
                <span className="text-xs font-semibold text-white/85">AI 꾸미기</span>
                <span className="text-[10px] text-white/40 ml-1">{selectedVars.size > 0 ? `${selectedVars.size}개 선택` : '활용할 컬럼 선택'}</span>
              </div>
              <button onClick={doDecorate} disabled={decorating || selectedVars.size === 0 || message.trim().length < 5} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-gradient-to-r from-violet-500 to-fuchsia-500 text-[11px] font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed">
                {decorating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} 꾸미기
              </button>
            </div>
            {dataProfileVars.length === 0 ? (
              <p className="text-[11px] text-white/40">고객 데이터가 있어야 개인화 컬럼이 표시됩니다.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {dataProfileVars.map((v) => {
                  const on = selectedVars.has(v.token);
                  return (
                    <button key={v.token} onClick={() => setSelectedVars((prev) => { const n = new Set(prev); if (n.has(v.token)) n.delete(v.token); else n.add(v.token); return n; })}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${on ? 'bg-violet-500/30 text-violet-100 border-violet-400/50' : 'bg-white/5 text-white/55 border-white/10 hover:bg-white/10'}`}>
                      %{v.label}%
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-white/10">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm text-white/70">닫기</button>
          <button onClick={() => onSave(subject, message)} disabled={message.trim().length < 10 || !subject.trim()} className="px-4 py-2 rounded-lg bg-gradient-to-r from-indigo-500 to-violet-500 text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed">저장</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default function DateAnchorJourneyBuilder({ embedded = false, dataProfileVars, onBuild, onBack, onGeneratePlan, onRefine, onDecorate }: Props) {
  const [objective, setObjective] = useState('');
  const [anchorDate, setAnchorDate] = useState('');
  const [recurrence, setRecurrence] = useState('none');
  const [recurrenceDay, setRecurrenceDay] = useState('1');
  const [hourKst, setHourKst] = useState('10');
  const [steps, setSteps] = useState<DateAnchorStep[]>([{ anchorOffsetDays: 7, subject: '', messageTemplate: '' }]);
  const [conditions, setConditions] = useState<DateAnchorAudienceCondition[]>([]);
  const [generating, setGenerating] = useState(false);
  const [editIdx, setEditIdx] = useState<number | null>(null);

  const addStep = () => setSteps((s) => [...s, { anchorOffsetDays: 0, subject: '', messageTemplate: '' }]);
  const updateStep = (i: number, patch: Partial<DateAnchorStep>) => setSteps((s) => s.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const removeStep = (i: number) => setSteps((s) => s.filter((_, idx) => idx !== i));

  const addCondition = () => setConditions((c) => [...c, { field: 'grade', op: '==', value: '' }]);
  const updateCondition = (i: number, patch: Partial<DateAnchorAudienceCondition>) => setConditions((c) => c.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const removeCondition = (i: number) => setConditions((c) => c.filter((_, idx) => idx !== i));

  const handleAutoGenerate = async () => {
    if (!objective.trim() || generating) return;
    setGenerating(true);
    try {
      const gen = await onGeneratePlan(objective.trim());
      if (gen && gen.length > 0) {
        setSteps(gen.map((g) => ({ anchorOffsetDays: g.offsetDays, subject: g.subject, messageTemplate: g.message })));
      }
    } finally {
      setGenerating(false);
    }
  };

  const canBuild = Boolean(anchorDate) && steps.length > 0 && steps.every((s) => s.messageTemplate.trim().length >= 10 && s.subject.trim());

  const handleBuild = () => {
    if (!canBuild) return;
    const triggerFilters: Record<string, any> = {};
    const validConds = conditions.filter((c) => c.field && c.op && String(c.value).trim() !== '');
    if (validConds.length > 0) {
      triggerFilters.customer_conditions = validConds.map((c) => ({ field: c.field, op: c.op, value: c.value }));
      triggerFilters.logic = 'AND';
    }
    const sorted = [...steps].sort((a, b) => b.anchorOffsetDays - a.anchorOffsetDays);
    onBuild({
      name: objective.trim() ? objective.trim().slice(0, 40) : '날짜축 여정',
      anchorDate,
      anchorRecurrence: recurrence,
      anchorRecurrenceDay: recurrence === 'monthly_day' ? Math.max(1, Math.min(31, Number(recurrenceDay) || 1)) : null,
      anchorHourKst: Math.max(0, Math.min(23, Number(hourKst) || 10)),
      triggerFilters,
      steps: sorted.map((s) => ({
        anchorOffsetDays: Math.max(0, Math.floor(Number(s.anchorOffsetDays) || 0)),
        channel: 'lms' as const,
        messageTemplate: s.messageTemplate,
        subject: s.subject,
      })),
    });
  };

  return (
    <div className="space-y-4 text-white">
      {!embedded && (
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10" aria-label="뒤로">
            <ArrowLeft className="w-4 h-4 text-white/70" />
          </button>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-400 to-violet-500 flex items-center justify-center">
            <CalendarClock className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-base md:text-lg font-semibold">날짜축 여정 만들기</h2>
            <p className="text-xs text-white/50">기준 날짜 기준 D-N 단계 발송 · AI가 만들어드려요</p>
          </div>
        </div>
      )}

      {/* 자연어 목표 + AI 자동 생성 */}
      <div className="bg-gradient-to-br from-fuchsia-500/10 via-purple-500/10 to-indigo-500/10 border border-fuchsia-500/30 rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-4 h-4 text-fuchsia-300" />
          <span className="text-sm font-semibold">무엇을 알릴까요</span>
        </div>
        <input
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          placeholder="예: 포인트 소멸 임박 고객에게 7일전 3일전 당일 사용 독려"
          className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2.5 text-sm placeholder-white/30 focus:outline-none focus:border-fuchsia-400"
          onKeyDown={(e) => { if (e.key === 'Enter' && !generating && objective.trim()) { e.preventDefault(); handleAutoGenerate(); } }}
        />
        <div className="flex items-center justify-between mt-2 gap-2 flex-wrap">
          <p className="text-[11px] text-white/45">"7일전 3일전 당일"처럼 시점을 적으면 단계까지 자동으로 만들어드립니다.</p>
          <button onClick={handleAutoGenerate} disabled={generating || objective.trim().length < 3}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-fuchsia-500 to-purple-500 text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed">
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} AI 자동 생성
          </button>
        </div>
        <p className="text-[10px] text-white/40 mt-1.5 italic">구체 혜택(%·원·쿠폰)은 자동 생성에 포함되지 않습니다 — 단계 편집에서 직접 채워주세요.</p>
      </div>

      {/* ① 기준 날짜 + 반복 + 시각 */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-white/90"><span className="text-indigo-300">①</span> 기준 날짜</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] text-white/50 mb-1">기준 날짜</label>
            <input type="date" value={anchorDate} onChange={(e) => setAnchorDate(e.target.value)} className="w-full bg-white/[0.06] border border-white/15 rounded-lg px-3 py-2 text-sm text-white [color-scheme:dark]" />
          </div>
          <div>
            <label className="block text-[11px] text-white/50 mb-1">기본 발송 시각 (KST)</label>
            <select value={hourKst} onChange={(e) => setHourKst(e.target.value)} className="w-full bg-white/[0.06] border border-white/15 rounded-lg px-3 py-2 text-sm text-white [&>option]:bg-slate-800">
              {Array.from({ length: 14 }, (_, i) => i + 8).map((h) => <option key={h} value={h}>{h}시</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-[11px] text-white/50 mb-1"><Repeat className="w-3 h-3 inline mr-1" />반복</label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {RECURRENCES.map((r) => {
              const active = r.key === recurrence;
              return (
                <button key={r.key} onClick={() => setRecurrence(r.key)} className={`p-2.5 rounded-lg border text-left transition-colors ${active ? 'bg-indigo-500/20 border-indigo-400/60' : 'bg-white/[0.06] border-white/15 hover:bg-white/[0.1]'}`}>
                  <div className="text-xs font-semibold text-white">{r.label}</div>
                  <div className="text-[10px] text-white/55 mt-0.5 leading-tight">{r.desc}</div>
                </button>
              );
            })}
          </div>
          {recurrence === 'monthly_day' && (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[11px] text-white/50">매달</span>
              <input type="number" min={1} max={31} value={recurrenceDay} onChange={(e) => setRecurrenceDay(e.target.value)} className="w-16 bg-white/[0.06] border border-white/15 rounded px-2 py-1.5 text-xs text-white" />
              <span className="text-[11px] text-white/50">일</span>
            </div>
          )}
        </div>
      </div>

      {/* ② 단계 — 요약 카드 + 문안 편집 모달 */}
      <div>
        <h3 className="text-sm font-semibold text-white/90 mb-2"><span className="text-indigo-300">②</span> 단계 구성 (며칠 전에 보낼지)</h3>
        <div className="space-y-2">
          {steps.map((s, i) => {
            const empty = s.messageTemplate.trim().length < 10;
            return (
              <div key={i} className="p-3 rounded-xl bg-white/[0.05] border border-white/10">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] text-white/50">기준일</span>
                  <input type="number" min={0} max={365} value={s.anchorOffsetDays} onChange={(e) => updateStep(i, { anchorOffsetDays: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} className="w-16 bg-white/[0.06] border border-white/15 rounded px-2 py-1.5 text-xs text-white text-center" />
                  <span className="text-[11px] text-white/50">일 전{s.anchorOffsetDays === 0 ? ' (당일)' : ''}</span>
                  <span className="text-[11px] text-indigo-300 font-mono">D-{s.anchorOffsetDays}</span>
                  <button onClick={() => setEditIdx(i)} className="ml-auto inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 border border-white/15 text-[11px] font-medium">
                    <Pencil className="w-3.5 h-3.5" /> 문안 편집
                  </button>
                  {steps.length > 1 && (
                    <button onClick={() => removeStep(i)} className="p-1 rounded bg-white/5 hover:bg-rose-500/20 border border-white/10" aria-label="단계 삭제">
                      <X className="w-3.5 h-3.5 text-white/60" />
                    </button>
                  )}
                </div>
                <div className="mt-2">
                  {empty ? (
                    <p className="text-[11px] text-amber-200/70">문안이 비어 있습니다 — [문안 편집]에서 AI로 작성하세요.</p>
                  ) : (
                    <>
                      <p className="text-xs font-medium text-white/80 truncate">{s.subject || '(제목 없음)'}</p>
                      <p className="text-[11px] text-white/50 line-clamp-2 whitespace-pre-wrap mt-0.5">{s.messageTemplate}</p>
                    </>
                  )}
                </div>
              </div>
            );
          })}
          <button onClick={addStep} className="inline-flex items-center gap-1 text-xs text-indigo-300 hover:text-indigo-200">
            <Plus className="w-3.5 h-3.5" /> 단계 추가
          </button>
        </div>
        <p className="text-[10px] text-white/40 italic mt-1.5">LMS로 발송되며 (광고) 표기·무료수신거부가 자동 부착됩니다. 활성화 시 전체 문안 스팸필터 테스트를 거칩니다.</p>
      </div>

      {/* ③ 대상 — 자유 조건(포인트 한정 아님) */}
      <div>
        <h3 className="text-sm font-semibold text-white/90 mb-2"><span className="text-indigo-300">③</span> 누구에게 보낼까요</h3>
        <p className="text-[11px] text-white/50 mb-2">조건을 만족하는 고객에게 발송합니다. 조건이 없으면 전체 활성 고객이 대상입니다. (등급·지역·매장·포인트 등 자유롭게)</p>
        <div className="space-y-2">
          {conditions.map((c, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <select value={c.field} onChange={(e) => updateCondition(i, { field: e.target.value })} className="bg-white/[0.06] border border-white/15 rounded px-2 py-1.5 text-xs text-white [&>option]:bg-slate-800">
                {COND_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
              <select value={c.op} onChange={(e) => updateCondition(i, { op: e.target.value })} className="bg-white/[0.06] border border-white/15 rounded px-2 py-1.5 text-xs text-white [&>option]:bg-slate-800">
                {COND_OPS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
              <input value={c.value} onChange={(e) => updateCondition(i, { value: e.target.value })} placeholder="값" className="flex-1 min-w-0 bg-white/[0.06] border border-white/15 rounded px-2 py-1.5 text-xs text-white" />
              <button onClick={() => removeCondition(i)} className="p-1.5 rounded bg-white/5 hover:bg-rose-500/20 border border-white/10" aria-label="조건 삭제">
                <X className="w-3.5 h-3.5 text-white/60" />
              </button>
            </div>
          ))}
          <button onClick={addCondition} className="inline-flex items-center gap-1 text-xs text-indigo-300 hover:text-indigo-200">
            <Plus className="w-3.5 h-3.5" /> 조건 추가
          </button>
        </div>
      </div>

      <div className="flex justify-end pt-1">
        <button onClick={handleBuild} disabled={!canBuild} className="px-5 py-3 bg-gradient-to-r from-indigo-500 to-violet-500 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed">
          다음 — 흐름 검토
        </button>
      </div>

      {editIdx !== null && steps[editIdx] && (
        <StepEditModal
          step={steps[editIdx]}
          offsetDays={steps[editIdx].anchorOffsetDays}
          dataProfileVars={dataProfileVars}
          onRefine={onRefine}
          onDecorate={onDecorate}
          onSave={(subject, message) => { updateStep(editIdx, { subject, messageTemplate: message }); setEditIdx(null); }}
          onClose={() => setEditIdx(null)}
        />
      )}
    </div>
  );
}
