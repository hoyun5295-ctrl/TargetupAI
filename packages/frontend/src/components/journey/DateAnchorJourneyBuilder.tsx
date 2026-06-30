/**
 * 날짜축 여정 빌더 — 지정일 D-N (2026-06-30 여정 일반화 SP-B)
 *
 * 회사가 지정한 기준 날짜(예: 포인트 소멸일)를 기준으로 D-7/D-3/D-1/D-0 멀티스텝을 보낸다.
 * 흐름: ① 기준 날짜 + 반복 + 시각 → ② D-N 스텝(며칠 전 + 제목/본문) → ③ 대상 조건 → 검토.
 *   D-0 발송 후: 반복 없음 = 자동 정지(새 날짜 지정 시 재가동) / 반복 = 다음 앵커로 자동 갱신.
 *   스텝 채널 = LMS(광고 표기 자동). 발송 6원칙·정보통신망법 정합.
 */

import { useState } from 'react';
import { CalendarClock, ArrowLeft, Plus, X, Repeat } from 'lucide-react';

export interface DateAnchorStep {
  anchorOffsetDays: number;
  subject: string;
  messageTemplate: string;
}
export interface DateAnchorAudienceCondition { field: string; op: string; value: string; }

export interface DateAnchorBuildResult {
  name: string;
  anchorDate: string;            // 'YYYY-MM-DD'
  anchorRecurrence: string;      // 'none'|'monthly_day'|'monthly_last'|'yearly'
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
  { key: 'age', label: '나이' }, { key: 'purchase_count', label: '구매횟수' }, { key: 'total_purchase_amount', label: '누적구매액' },
];
const COND_OPS = [
  { key: '==', label: '같음' }, { key: '!=', label: '다름' }, { key: '>=', label: '이상' }, { key: '<=', label: '이하' }, { key: '>', label: '초과' }, { key: '<', label: '미만' },
];

function defaultMessage(offset: number): string {
  if (offset === 0) return '%고객명%님, 오늘까지예요.\n\n[소멸 전 사용 안내 또는 회사가 제공할 혜택을 직접 작성해주세요]\n\n자세히 → [URL 입력]';
  return `%고객명%님, ${offset}일 남았어요.\n\n[사용 안내 또는 회사가 제공할 혜택을 직접 작성해주세요]\n\n자세히 → [URL 입력]`;
}
function makeStep(offset: number): DateAnchorStep {
  return { anchorOffsetDays: offset, subject: offset === 0 ? '오늘까지 안내' : `D-${offset} 안내`, messageTemplate: defaultMessage(offset) };
}

interface Props {
  embedded?: boolean;
  onBuild: (result: DateAnchorBuildResult) => void;
  onBack: () => void;
}

export default function DateAnchorJourneyBuilder({ embedded = false, onBuild, onBack }: Props) {
  const [anchorDate, setAnchorDate] = useState('');
  const [recurrence, setRecurrence] = useState('none');
  const [recurrenceDay, setRecurrenceDay] = useState('1');
  const [hourKst, setHourKst] = useState('10');
  const [steps, setSteps] = useState<DateAnchorStep[]>([makeStep(7), makeStep(3), makeStep(1), makeStep(0)]);
  const [pointsMin, setPointsMin] = useState('');
  const [conditions, setConditions] = useState<DateAnchorAudienceCondition[]>([]);

  const addStep = () => setSteps((s) => [...s, makeStep(0)]);
  const updateStep = (i: number, patch: Partial<DateAnchorStep>) => setSteps((s) => s.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const removeStep = (i: number) => setSteps((s) => s.filter((_, idx) => idx !== i));

  const addCondition = () => setConditions((c) => [...c, { field: 'grade', op: '==', value: '' }]);
  const updateCondition = (i: number, patch: Partial<DateAnchorAudienceCondition>) => setConditions((c) => c.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const removeCondition = (i: number) => setConditions((c) => c.filter((_, idx) => idx !== i));

  const canBuild = Boolean(anchorDate) && steps.length > 0 && steps.every((s) => s.messageTemplate.trim().length >= 10 && s.subject.trim());

  const handleBuild = () => {
    if (!canBuild) return;
    const triggerFilters: Record<string, any> = {};
    const pm = Number(pointsMin);
    if (Number.isFinite(pm) && pm > 0) triggerFilters.points_min = Math.floor(pm);
    const validConds = conditions.filter((c) => c.field && c.op && String(c.value).trim() !== '');
    if (validConds.length > 0) {
      triggerFilters.customer_conditions = validConds.map((c) => ({ field: c.field, op: c.op, value: c.value }));
      triggerFilters.logic = 'AND';
    }
    // offset 큰 것부터(먼저 보냄) step_order 정렬은 부모가 처리. 여기선 입력 순서 유지하되 백엔드 정합 위해 offset desc 정렬.
    const sorted = [...steps].sort((a, b) => b.anchorOffsetDays - a.anchorOffsetDays);
    onBuild({
      name: '날짜축 여정',
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
            <p className="text-xs text-white/50">기준 날짜(예: 포인트 소멸일) 기준 D-N 단계 발송</p>
          </div>
        </div>
      )}

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

      {/* ② D-N 스텝 */}
      <div>
        <h3 className="text-sm font-semibold text-white/90 mb-2"><span className="text-indigo-300">②</span> 단계 구성 (며칠 전에 보낼지)</h3>
        <div className="space-y-2">
          {steps.map((s, i) => (
            <div key={i} className="p-3 rounded-xl bg-white/[0.05] border border-white/10 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-white/50">기준일</span>
                <input type="number" min={0} max={365} value={s.anchorOffsetDays} onChange={(e) => updateStep(i, { anchorOffsetDays: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} className="w-16 bg-white/[0.06] border border-white/15 rounded px-2 py-1.5 text-xs text-white text-center" />
                <span className="text-[11px] text-white/50">일 전{s.anchorOffsetDays === 0 ? ' (당일)' : ''}</span>
                <span className="ml-auto text-[11px] text-indigo-300 font-mono">D-{s.anchorOffsetDays}</span>
                {steps.length > 1 && (
                  <button onClick={() => removeStep(i)} className="p-1 rounded bg-white/5 hover:bg-rose-500/20 border border-white/10" aria-label="단계 삭제">
                    <X className="w-3.5 h-3.5 text-white/60" />
                  </button>
                )}
              </div>
              <input value={s.subject} onChange={(e) => updateStep(i, { subject: e.target.value.slice(0, 40) })} placeholder="제목 (LMS 필수)" className="w-full bg-white/[0.06] border border-white/15 rounded px-2 py-1.5 text-xs text-white" />
              <textarea value={s.messageTemplate} onChange={(e) => updateStep(i, { messageTemplate: e.target.value.slice(0, 2000) })} rows={3} placeholder="본문 — %고객명% 변수 사용 가능, [...] 자리는 직접 작성" className="w-full bg-white/[0.06] border border-white/15 rounded px-2 py-1.5 text-xs text-white resize-y" />
            </div>
          ))}
          <button onClick={addStep} className="inline-flex items-center gap-1 text-xs text-indigo-300 hover:text-indigo-200">
            <Plus className="w-3.5 h-3.5" /> 단계 추가
          </button>
        </div>
        <p className="text-[10px] text-white/40 italic mt-1.5">LMS로 발송되며 (광고) 표기·무료수신거부가 자동 부착됩니다.</p>
      </div>

      {/* ③ 대상 */}
      <div>
        <h3 className="text-sm font-semibold text-white/90 mb-2"><span className="text-indigo-300">③</span> 누구에게 보낼까요</h3>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[11px] text-white/50">포인트</span>
          <input type="number" min={0} value={pointsMin} onChange={(e) => setPointsMin(e.target.value)} placeholder="0" className="w-24 bg-white/[0.06] border border-white/15 rounded px-2 py-1.5 text-xs text-white" />
          <span className="text-[11px] text-white/50">점 이상 (선택)</span>
        </div>
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
