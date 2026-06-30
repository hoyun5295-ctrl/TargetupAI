/**
 * 날짜축 여정 빌더 — 지정일 D-N + AI 문안 생성 (2026-06-30 여정 일반화 SP-B)
 *
 * 회사가 지정한 기준 날짜(예: 포인트 소멸일)를 기준으로 D-N 멀티스텝을 보낸다.
 * AI 주도: 자연어 목표 한 줄 → 각 단계 [AI 문안생성](1크레딧)으로 안내문 자동 작성(구체 혜택은 placeholder).
 * 흐름: ① 기준 날짜 + 반복 + 시각 → ② 자유 단계(며칠 전 + AI 문안생성) → ③ 대상 조건(자유) → 검토.
 *   D-0 발송 후: 반복 없음 = 자동 정지(새 날짜 지정 시 재가동) / 반복 = 다음 앵커 자동 갱신.
 *   스텝 채널 = LMS((광고) 표기·무료수신거부 자동). 활성화 시 전체 문안 스팸필터 테스트.
 */

import { useState } from 'react';
import { CalendarClock, ArrowLeft, Plus, X, Repeat, Sparkles, Loader2, Wand2 } from 'lucide-react';

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

// 대상 조건 — applyCustomerConditions 허용 필드(백엔드 정합). 포인트는 한 옵션일 뿐, 한정 아님.
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
  onBuild: (result: DateAnchorBuildResult) => void;
  onBack: () => void;
  /** AI 문안생성 — 1건 1크레딧. 부모(JourneysPage)가 endpoint 호출 + 크레딧/토스트 처리. 실패 시 null. */
  onGenerateMessage: (objective: string, offsetDays: number) => Promise<{ subject: string; message: string } | null>;
}

export default function DateAnchorJourneyBuilder({ embedded = false, onBuild, onBack, onGenerateMessage }: Props) {
  const [objective, setObjective] = useState('');
  const [anchorDate, setAnchorDate] = useState('');
  const [recurrence, setRecurrence] = useState('none');
  const [recurrenceDay, setRecurrenceDay] = useState('1');
  const [hourKst, setHourKst] = useState('10');
  const [steps, setSteps] = useState<DateAnchorStep[]>([{ anchorOffsetDays: 7, subject: '', messageTemplate: '' }]);
  const [conditions, setConditions] = useState<DateAnchorAudienceCondition[]>([]);
  const [genIdx, setGenIdx] = useState<number | null>(null);

  const addStep = () => setSteps((s) => [...s, { anchorOffsetDays: 0, subject: '', messageTemplate: '' }]);
  const updateStep = (i: number, patch: Partial<DateAnchorStep>) => setSteps((s) => s.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const removeStep = (i: number) => setSteps((s) => s.filter((_, idx) => idx !== i));

  const addCondition = () => setConditions((c) => [...c, { field: 'grade', op: '==', value: '' }]);
  const updateCondition = (i: number, patch: Partial<DateAnchorAudienceCondition>) => setConditions((c) => c.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const removeCondition = (i: number) => setConditions((c) => c.filter((_, idx) => idx !== i));

  const handleGenerate = async (i: number) => {
    if (!objective.trim() || genIdx !== null) return;
    setGenIdx(i);
    try {
      const r = await onGenerateMessage(objective.trim(), steps[i].anchorOffsetDays);
      if (r && r.message) updateStep(i, { subject: r.subject || steps[i].subject, messageTemplate: r.message });
    } finally {
      setGenIdx(null);
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
    const sorted = [...steps].sort((a, b) => b.anchorOffsetDays - a.anchorOffsetDays); // 먼저 보내는 것(큰 offset) 먼저
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
            <p className="text-xs text-white/50">기준 날짜 기준 D-N 단계 발송 · AI가 문안을 만들어드려요</p>
          </div>
        </div>
      )}

      {/* 자연어 목표 — AI 문안생성의 맥락 */}
      <div className="bg-gradient-to-br from-fuchsia-500/10 via-purple-500/10 to-indigo-500/10 border border-fuchsia-500/30 rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-4 h-4 text-fuchsia-300" />
          <span className="text-sm font-semibold">무엇을 알릴까요</span>
        </div>
        <input
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          placeholder="예: 포인트 소멸 임박 고객에게 소멸 전 사용 독려 / 멤버십 갱신일 안내 / 행사 시작일 안내"
          className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2.5 text-sm placeholder-white/30 focus:outline-none focus:border-fuchsia-400"
        />
        <p className="text-[11px] text-white/45 mt-1.5">이 목표를 바탕으로 각 단계의 [AI 문안생성]이 안내문을 만들어드립니다. 구체 혜택(%·원·쿠폰)은 직접 채워주세요.</p>
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

      {/* ② 자유 단계 + AI 문안생성 */}
      <div>
        <h3 className="text-sm font-semibold text-white/90 mb-2"><span className="text-indigo-300">②</span> 단계 구성 (며칠 전에 보낼지)</h3>
        <div className="space-y-2">
          {steps.map((s, i) => (
            <div key={i} className="p-3 rounded-xl bg-white/[0.05] border border-white/10 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] text-white/50">기준일</span>
                <input type="number" min={0} max={365} value={s.anchorOffsetDays} onChange={(e) => updateStep(i, { anchorOffsetDays: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} className="w-16 bg-white/[0.06] border border-white/15 rounded px-2 py-1.5 text-xs text-white text-center" />
                <span className="text-[11px] text-white/50">일 전{s.anchorOffsetDays === 0 ? ' (당일)' : ''}</span>
                <span className="text-[11px] text-indigo-300 font-mono">D-{s.anchorOffsetDays}</span>
                <button
                  onClick={() => handleGenerate(i)}
                  disabled={!objective.trim() || genIdx !== null}
                  title={!objective.trim() ? '먼저 위에 목표를 입력해주세요' : 'AI 문안생성 (1크레딧)'}
                  className="ml-auto inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-gradient-to-r from-fuchsia-500/80 to-purple-500/80 text-[11px] font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {genIdx === i ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                  AI 문안생성
                </button>
                {steps.length > 1 && (
                  <button onClick={() => removeStep(i)} className="p-1 rounded bg-white/5 hover:bg-rose-500/20 border border-white/10" aria-label="단계 삭제">
                    <X className="w-3.5 h-3.5 text-white/60" />
                  </button>
                )}
              </div>
              <input value={s.subject} onChange={(e) => updateStep(i, { subject: e.target.value.slice(0, 40) })} placeholder="제목 (LMS 필수) — AI 문안생성 또는 직접 입력" className="w-full bg-white/[0.06] border border-white/15 rounded px-2 py-1.5 text-xs text-white" />
              <textarea value={s.messageTemplate} onChange={(e) => updateStep(i, { messageTemplate: e.target.value.slice(0, 2000) })} rows={3} placeholder="본문 — [AI 문안생성]을 누르면 자동 작성됩니다. 구체 혜택은 직접 채워주세요." className="w-full bg-white/[0.06] border border-white/15 rounded px-2 py-1.5 text-xs text-white resize-y" />
            </div>
          ))}
          <button onClick={addStep} className="inline-flex items-center gap-1 text-xs text-indigo-300 hover:text-indigo-200">
            <Plus className="w-3.5 h-3.5" /> 단계 추가
          </button>
        </div>
        <p className="text-[10px] text-white/40 italic mt-1.5">LMS로 발송되며 (광고) 표기·무료수신거부가 자동 부착됩니다. 활성화 시 전체 문안 스팸필터 테스트를 거칩니다.</p>
      </div>

      {/* ③ 대상 — 포인트 한정 아님, 자유 조건 */}
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
    </div>
  );
}
