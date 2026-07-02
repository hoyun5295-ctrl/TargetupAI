/**
 * 날짜축 여정 빌더 — 컴팩트 버튼+모달 (2026-06-30 여정 일반화 SP-B)
 *
 * AI Operator 디자인 표준(feedback_design_modal_first_simplicity): 긴 1열 폼 금지 = 컴팩트 메인 + 버튼→모달.
 *   - 메인: 자연어 목표 + [AI 자동 생성] 히어로 + 발송설정/대상 요약 버튼 + 스텝 요약 카드.
 *   - 발송 설정·대상 조건·스텝 문안 = 전부 버튼 눌러 모달에서 편집(공용 ModalShell/AudienceModal).
 *   - [AI 자동 생성]: "7일전 3일전 당일" → D-N 스텝 + 문안 일괄. 스텝 문안 편집 = AI 다듬기·꾸미기 모달.
 * 스텝 채널 = LMS((광고) 표기·무료수신거부 자동). 활성화 시 전체 문안 스팸필터 테스트.
 */

import { useState } from 'react';
import { CalendarClock, ArrowLeft, Plus, X, Repeat, Sparkles, Loader2, Wand2, Pencil, Check, CalendarDays, Users } from 'lucide-react';
import { ModalShell, SummaryButton, AudienceModal, buildCustomerConditions, audienceSummary, type AudienceCondition } from './JourneyBuilderUi';
import { buildAdMessageFront } from '../../utils/formatDate';

export interface DateAnchorStep {
  anchorOffsetDays: number;
  subject: string;
  messageTemplate: string;
}

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
const recurrenceLabel = (k: string) => RECURRENCES.find((r) => r.key === k)?.label || '반복 없음';

interface Props {
  embedded?: boolean;
  dataProfileVars: { token: string; label: string }[];
  opt080Number: string;
  onBuild: (result: DateAnchorBuildResult) => void;
  onBack: () => void;
  onGeneratePlan: (objective: string) => Promise<{ offsetDays: number; subject: string; message: string }[] | null>;
  onRefine: (message: string) => Promise<{ message: string; tone: string }[] | null>;
  onDecorate: (message: string, selectedVars: string[]) => Promise<string | null>;
}

// ── 발송 설정 모달 (기준 날짜 + 시각 + 반복) ──
function SettingsModal({ initial, onSave, onClose }: {
  initial: { anchorDate: string; recurrence: string; recurrenceDay: string; hourKst: string };
  onSave: (v: { anchorDate: string; recurrence: string; recurrenceDay: string; hourKst: string }) => void;
  onClose: () => void;
}) {
  const [anchorDate, setAnchorDate] = useState(initial.anchorDate);
  const [recurrence, setRecurrence] = useState(initial.recurrence);
  const [recurrenceDay, setRecurrenceDay] = useState(initial.recurrenceDay);
  const [hourKst, setHourKst] = useState(initial.hourKst);
  return (
    <ModalShell title="발송 설정" subtitle="기준 날짜 · 발송 시각 · 반복" icon={<CalendarDays className="w-4 h-4 text-white" />} onClose={onClose}
      footer={<>
        <button onClick={onClose} className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm text-white/70">닫기</button>
        <button onClick={() => onSave({ anchorDate, recurrence, recurrenceDay, hourKst })} disabled={!anchorDate} className="px-4 py-2 rounded-lg bg-gradient-to-r from-indigo-500 to-violet-500 text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed">저장</button>
      </>}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label className="block text-[11px] text-white/50 mb-1">기준 날짜</label>
          <input type="date" value={anchorDate} onChange={(e) => setAnchorDate(e.target.value)} className="w-full bg-white/[0.06] border border-white/15 rounded-lg px-3 py-2 text-sm text-white [color-scheme:dark]" />
        </div>
        <div>
          <label className="block text-[11px] text-white/50 mb-1">발송 시각 (KST)</label>
          <select value={hourKst} onChange={(e) => setHourKst(e.target.value)} className="w-full bg-white/[0.06] border border-white/15 rounded-lg px-3 py-2 text-sm text-white">
            {Array.from({ length: 14 }, (_, i) => i + 8).map((h) => <option key={h} value={h}>{h}시</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="block text-[11px] text-white/50 mb-1"><Repeat className="w-3 h-3 inline mr-1" />반복</label>
        <div className="grid grid-cols-2 gap-2">
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
    </ModalShell>
  );
}

// ── 스텝 문안 편집 모달 (D-N + 제목 + 본문 + AI 다듬기/꾸미기) ──
function StepEditModal({ step, dataProfileVars, opt080Number, onRefine, onDecorate, onSave, onClose }: {
  step: DateAnchorStep;
  dataProfileVars: { token: string; label: string }[];
  opt080Number: string;
  onRefine: (m: string) => Promise<{ message: string; tone: string }[] | null>;
  onDecorate: (m: string, vars: string[]) => Promise<string | null>;
  onSave: (offsetDays: number, subject: string, message: string) => void;
  onClose: () => void;
}) {
  const [offset, setOffset] = useState(step.anchorOffsetDays);
  const [subject, setSubject] = useState(step.subject);
  const [message, setMessage] = useState(step.messageTemplate);
  const [candidates, setCandidates] = useState<{ message: string; tone: string }[]>([]);
  const [selectedVars, setSelectedVars] = useState<Set<string>>(new Set());
  const [refining, setRefining] = useState(false);
  const [decorating, setDecorating] = useState(false);

  const doRefine = async () => { if (refining || message.trim().length < 10) return; setRefining(true); try { const c = await onRefine(message); if (c) setCandidates(c); } finally { setRefining(false); } };
  const doDecorate = async () => { if (decorating || selectedVars.size === 0 || message.trim().length < 5) return; setDecorating(true); try { const m = await onDecorate(message, Array.from(selectedVars)); if (m) { setMessage(m); setCandidates([]); } } finally { setDecorating(false); } };

  return (
    <ModalShell title={`단계 문안 편집 · D-${offset}`} subtitle="AI 다듬기·꾸미기로 손보고 저장" icon={<Pencil className="w-4 h-4 text-white" />} onClose={onClose}
      footer={<>
        <button onClick={onClose} className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm text-white/70">닫기</button>
        <button onClick={() => onSave(offset, subject, message)} disabled={message.trim().length < 10 || !subject.trim()} className="px-4 py-2 rounded-lg bg-gradient-to-r from-indigo-500 to-violet-500 text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed">저장</button>
      </>}>
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-white/50">기준일</span>
        <input type="number" min={0} max={365} value={offset} onChange={(e) => setOffset(Math.max(0, Math.min(365, Math.floor(Number(e.target.value) || 0))))} className="w-16 bg-white/[0.06] border border-white/15 rounded px-2 py-1.5 text-xs text-white text-center" />
        <span className="text-[11px] text-white/50">일 전{offset === 0 ? ' (당일)' : ''}</span>
        <span className="ml-auto text-[11px] text-indigo-300 font-mono">D-{offset}</span>
      </div>
      <div>
        <label className="block text-[11px] text-white/50 mb-1">제목 (LMS 필수)</label>
        <input value={subject} onChange={(e) => setSubject(e.target.value.slice(0, 40))} placeholder="본문 요약 한 줄" className="w-full bg-white/[0.06] border border-white/15 rounded-lg px-3 py-2 text-sm text-white" />
      </div>
      <div>
        <label className="block text-[11px] text-white/50 mb-1">본문 <span className="text-white/35">(순수 본문 — (광고)·무료수신거부는 직접 쓰지 마세요)</span></label>
        <textarea value={message} onChange={(e) => setMessage(e.target.value.slice(0, 2000))} rows={8} placeholder="AI 다듬기/꾸미기로 손보세요. 구체 혜택(%·원·쿠폰)은 직접 채워주세요." className="w-full bg-white/[0.06] border border-white/15 rounded-lg px-3 py-2 text-sm text-white resize-y leading-relaxed" />
        <div className="text-right text-[10px] text-white/35 mt-0.5">{message.length} / 2000자</div>
      </div>

      {/* 발송 미리보기 — (광고)+무료수신거부 080 자동 합성(실발송 형태). 읽기 전용. */}
      {message.trim().length >= 5 && (
        <div className="p-3 rounded-xl bg-emerald-500/[0.06] border border-emerald-400/20">
          <div className="text-[11px] text-emerald-200/80 font-medium mb-1">발송 미리보기 <span className="text-white/40 font-normal">실제 발송 형태 (자동 합성)</span></div>
          <p className="text-[11px] text-white/75 whitespace-pre-wrap leading-relaxed">{buildAdMessageFront(message, 'LMS', true, opt080Number)}</p>
          {!opt080Number && <p className="text-[10px] text-amber-200/60 mt-1">무료수신거부 080번호는 발신번호 설정에서 등록하면 함께 표시됩니다.</p>}
        </div>
      )}
      <div className="p-3 rounded-xl bg-white/[0.04] border border-white/10">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-semibold text-white/85">AI 다듬기 <span className="text-white/40 font-normal">3가지 톤</span></span>
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
                  <button onClick={() => { setMessage(c.message); setCandidates([]); }} className="inline-flex items-center gap-1 text-[10px] text-emerald-300 hover:text-emerald-200"><Check className="w-3 h-3" /> 적용</button>
                </div>
                <p className="text-[11px] text-white/70 whitespace-pre-wrap leading-relaxed">{c.message}</p>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="p-3 rounded-xl bg-white/[0.04] border border-violet-400/20">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-semibold text-white/85">AI 꾸미기 <span className="text-white/40 font-normal">{selectedVars.size > 0 ? `${selectedVars.size}개 선택` : '컬럼 선택'}</span></span>
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
    </ModalShell>
  );
}

export default function DateAnchorJourneyBuilder({ embedded = false, dataProfileVars, opt080Number, onBuild, onBack, onGeneratePlan, onRefine, onDecorate }: Props) {
  const [objective, setObjective] = useState('');
  const [anchorDate, setAnchorDate] = useState('');
  const [recurrence, setRecurrence] = useState('none');
  const [recurrenceDay, setRecurrenceDay] = useState('1');
  const [hourKst, setHourKst] = useState('10');
  const [steps, setSteps] = useState<DateAnchorStep[]>([]);
  const [conditions, setConditions] = useState<AudienceCondition[]>([]);
  const [generating, setGenerating] = useState(false);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showAudience, setShowAudience] = useState(false);

  const handleAutoGenerate = async () => {
    if (!objective.trim() || generating) return;
    setGenerating(true);
    try {
      const gen = await onGeneratePlan(objective.trim());
      if (gen && gen.length > 0) setSteps(gen.map((g) => ({ anchorOffsetDays: g.offsetDays, subject: g.subject, messageTemplate: g.message })));
    } finally {
      setGenerating(false);
    }
  };

  const addStep = () => { setSteps((s) => [...s, { anchorOffsetDays: 0, subject: '', messageTemplate: '' }]); setEditIdx(steps.length); };
  const removeStep = (i: number) => setSteps((s) => s.filter((_, idx) => idx !== i));

  const canBuild = Boolean(anchorDate) && steps.length > 0 && steps.every((s) => s.messageTemplate.trim().length >= 10 && s.subject.trim());

  const handleBuild = () => {
    if (!canBuild) return;
    const conds = buildCustomerConditions(conditions);
    const sorted = [...steps].sort((a, b) => b.anchorOffsetDays - a.anchorOffsetDays);
    onBuild({
      name: objective.trim() ? objective.trim().slice(0, 40) : '날짜축 여정',
      anchorDate,
      anchorRecurrence: recurrence,
      anchorRecurrenceDay: recurrence === 'monthly_day' ? Math.max(1, Math.min(31, Number(recurrenceDay) || 1)) : null,
      anchorHourKst: Math.max(0, Math.min(23, Number(hourKst) || 10)),
      triggerFilters: conds || {},
      steps: sorted.map((s) => ({ anchorOffsetDays: Math.max(0, Math.floor(Number(s.anchorOffsetDays) || 0)), channel: 'lms' as const, messageTemplate: s.messageTemplate, subject: s.subject })),
    });
  };

  return (
    <div className="space-y-3 text-white">
      {!embedded && (
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10" aria-label="뒤로"><ArrowLeft className="w-4 h-4 text-white/70" /></button>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-400 to-violet-500 flex items-center justify-center"><CalendarClock className="w-5 h-5 text-white" /></div>
          <div>
            <h2 className="text-base md:text-lg font-semibold">날짜축 여정 만들기</h2>
            <p className="text-xs text-white/50">기준 날짜 기준 D-N 단계 발송 · AI가 만들어드려요</p>
          </div>
        </div>
      )}

      {/* 히어로 — 자연어 목표 + AI 자동 생성 */}
      <div className="bg-gradient-to-br from-fuchsia-500/10 via-purple-500/10 to-indigo-500/10 border border-fuchsia-500/30 rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-2"><Sparkles className="w-4 h-4 text-fuchsia-300" /><span className="text-sm font-semibold">무엇을 알릴까요</span></div>
        <input
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          placeholder="예: 포인트 소멸 임박 고객에게 7일전 3일전 당일 사용 독려"
          className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2.5 text-sm placeholder-white/30 focus:outline-none focus:border-fuchsia-400"
          onKeyDown={(e) => { if (e.key === 'Enter' && !generating && objective.trim()) { e.preventDefault(); handleAutoGenerate(); } }}
        />
        <div className="flex items-center justify-between mt-2 gap-2 flex-wrap">
          <p className="text-[11px] text-white/45">"7일전 3일전 당일"처럼 시점을 적으면 단계까지 자동 생성됩니다.</p>
          <button onClick={handleAutoGenerate} disabled={generating || objective.trim().length < 3} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-fuchsia-500 to-purple-500 text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed">
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} AI 자동 생성
          </button>
        </div>
      </div>

      {/* 발송 설정 — 요약 버튼 → 모달 */}
      <SummaryButton icon={<CalendarDays className="w-4 h-4 text-white" />} label="발송 설정" onClick={() => setShowSettings(true)}
        value={anchorDate ? `${anchorDate} · ${hourKst}시 · ${recurrenceLabel(recurrence)}` : '기준 날짜를 설정하세요'} />

      {/* 단계 — 요약 카드 + 문안 편집 모달 */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-semibold text-white/70">단계 {steps.length > 0 ? `${steps.length}개` : ''}</span>
          <button onClick={addStep} className="inline-flex items-center gap-1 text-xs text-indigo-300 hover:text-indigo-200"><Plus className="w-3.5 h-3.5" /> 단계 추가</button>
        </div>
        {steps.length === 0 ? (
          <div className="p-4 rounded-2xl bg-white/[0.03] border border-dashed border-white/15 text-center">
            <p className="text-[11px] text-white/45">위에서 [AI 자동 생성]을 누르거나 [단계 추가]로 직접 만드세요.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {steps.map((s, i) => {
              const empty = s.messageTemplate.trim().length < 10;
              return (
                <div key={i} className="flex items-center gap-2.5 p-3 rounded-2xl bg-white/[0.05] border border-white/10">
                  <span className="w-12 text-center text-[11px] font-mono text-indigo-300 bg-indigo-500/15 border border-indigo-400/30 rounded-lg py-1.5 shrink-0">D-{s.anchorOffsetDays}</span>
                  <div className="flex-1 min-w-0">
                    {empty ? (
                      <p className="text-[11px] text-amber-200/70">문안 미작성 — [문안 편집]에서 작성</p>
                    ) : (
                      <>
                        <p className="text-xs font-medium text-white/85 truncate">{s.subject || '(제목 없음)'}</p>
                        <p className="text-[11px] text-white/45 truncate">{s.messageTemplate.replace(/\n/g, ' ')}</p>
                      </>
                    )}
                  </div>
                  <button onClick={() => setEditIdx(i)} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 border border-white/15 text-[11px] font-medium shrink-0"><Pencil className="w-3.5 h-3.5" /> 문안 편집</button>
                  <button onClick={() => removeStep(i)} className="p-1.5 rounded bg-white/5 hover:bg-rose-500/20 border border-white/10 shrink-0" aria-label="단계 삭제"><X className="w-3.5 h-3.5 text-white/60" /></button>
                </div>
              );
            })}
          </div>
        )}
        <p className="text-[10px] text-white/40 italic mt-1.5">LMS로 발송되며 (광고) 표기·무료수신거부가 자동 부착됩니다. 활성화 시 전체 문안 스팸필터 테스트를 거칩니다.</p>
      </div>

      {/* 대상 — 요약 버튼 → 모달 */}
      <SummaryButton icon={<Users className="w-4 h-4 text-white" />} label="대상" value={audienceSummary(conditions)} onClick={() => setShowAudience(true)} />

      <div className="flex justify-end pt-1">
        <button onClick={handleBuild} disabled={!canBuild} className="px-5 py-3 bg-gradient-to-r from-indigo-500 to-violet-500 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed">다음 — 흐름 검토</button>
      </div>

      {showSettings && (
        <SettingsModal initial={{ anchorDate, recurrence, recurrenceDay, hourKst }}
          onSave={(v) => { setAnchorDate(v.anchorDate); setRecurrence(v.recurrence); setRecurrenceDay(v.recurrenceDay); setHourKst(v.hourKst); setShowSettings(false); }}
          onClose={() => setShowSettings(false)} />
      )}
      {showAudience && (
        <AudienceModal initial={conditions} onSave={(c) => { setConditions(c); setShowAudience(false); }} onClose={() => setShowAudience(false)} />
      )}
      {editIdx !== null && steps[editIdx] && (
        <StepEditModal step={steps[editIdx]} dataProfileVars={dataProfileVars} opt080Number={opt080Number} onRefine={onRefine} onDecorate={onDecorate}
          onSave={(offsetDays, subject, message) => { setSteps((s) => s.map((x, idx) => (idx === editIdx ? { anchorOffsetDays: offsetDays, subject, messageTemplate: message } : x))); setEditIdx(null); }}
          onClose={() => setEditIdx(null)} />
      )}
    </div>
  );
}
