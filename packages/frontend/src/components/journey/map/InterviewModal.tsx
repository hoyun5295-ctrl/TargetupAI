/**
 * InterviewModal — 문장으로 여정 만들기 (★ 2026-09-30 여정 V2 2차 · 설계서 §5)
 *
 * 한 줄 입력 → 질문(추천 답 미리 선택 · 고르거나 직접 입력 · [이대로 만들기] 상시) → 여정마다 설계 1회(초안 저장)
 *   → 이어붙이기 점검(줄마다 1클릭 고치기) → [모두 켜기] 또는 [지도에서 보기].
 *
 * 규칙
 *   - 질문 · 선택지 · 추천 답은 서버 CT(journey-interview)가 준다. 화면은 그리기 · 고른 값 보관만.
 *   - 혜택은 미리 채우지 않는다. 금액은 서버 단가(costPerJourney) × 만들 여정 수.
 *   - 답은 브라우저 임시 보관(sessionStorage)으로 새로고침해도 남는다. 다 만들면 지운다.
 *   - 설계는 여정 하나씩 요청한다. 닫으면 남은 여정은 만들지 않는다(지금 만드는 것은 끝까지 만들어진다).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowRight, CheckCircle2, Loader2, Lock, MessageSquarePlus, Sparkles, X, XCircle } from 'lucide-react';
import JourneyModalShell from '../JourneyModalShell';
import type { AttachCheckRow, AttachFix, InterviewPlan, InterviewPrepared, InterviewQuestion } from '../../../utils/journey-map';

interface Props {
  open: boolean;
  onClose: () => void;
  onFix: (fix: AttachFix) => Promise<void>;
  onFocusJourney: (id: string) => void;
  onActivateMany: (ids: string[]) => void;
  onCreated: () => void;
}

type Phase = 'input' | 'reading' | 'questions' | 'designing' | 'done';
interface Progress { planKey: string; title: string; status: 'wait' | 'run' | 'ok' | 'fail'; journeyId?: string; message?: string }

const STORE_KEY = 'jmap-interview-v1';
const EXAMPLES = [
  '가입한 고객이 첫 구매까지 오고 재구매로 이어지게 해 줘',
  '장바구니에 담고 안 산 고객을 다시 불러 줘',
  '한동안 안 산 고객을 되살리는 여정 만들어 줘',
  '생일 앞둔 고객에게 축하 쿠폰 보내 줘',
];

function newId(): string {
  try { if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID(); } catch { /* 아래 대체 */ }
  const h = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < 32; i++) s += h[Math.floor(Math.random() * 16)];
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-8${s.slice(17, 20)}-${s.slice(20, 32)}`;
}

function authHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` };
}

export default function InterviewModal({ open, onClose, onFix, onFocusJourney, onActivateMany, onCreated }: Props) {
  const [phase, setPhase] = useState<Phase>('input');
  const [sentence, setSentence] = useState('');
  const [prepared, setPrepared] = useState<InterviewPrepared | null>(null);
  const [plans, setPlans] = useState<InterviewPlan[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [callbackPhone, setCallbackPhone] = useState('');
  const [interviewId, setInterviewId] = useState('');
  const [progress, setProgress] = useState<Progress[]>([]);
  const [attach, setAttach] = useState<AttachCheckRow[] | null>(null);
  const [fixing, setFixing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef(false);

  // 열 때: 질문 단계에서 멈춘 답이 있으면 되살린다(새로고침 보존).
  useEffect(() => {
    if (!open) return;
    cancelRef.current = false;
    try {
      const raw = sessionStorage.getItem(STORE_KEY);
      if (raw) {
        const v = JSON.parse(raw);
        if (v?.prepared && Array.isArray(v.plans) && v.plans.length > 0) {
          setSentence(String(v.sentence || ''));
          setPrepared(v.prepared);
          setPlans(v.plans);
          setAnswers(v.answers || {});
          setCallbackPhone(String(v.callbackPhone || ''));
          setInterviewId(String(v.interviewId || newId()));
          setPhase('questions');
          return;
        }
      }
    } catch { /* 보관값이 깨졌으면 처음부터 */ }
    setPhase('input');
  }, [open]);

  useEffect(() => {
    if (phase !== 'questions' || !prepared) return;
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify({ sentence, prepared, plans, answers, callbackPhone, interviewId }));
    } catch { /* 보관 못 해도 진행은 된다 */ }
  }, [phase, sentence, prepared, plans, answers, callbackPhone, interviewId]);

  const clearStore = () => { try { sessionStorage.removeItem(STORE_KEY); } catch { /* 무시 */ } };

  const close = () => {
    cancelRef.current = true;
    onClose();
  };

  const read = async () => {
    const s = sentence.trim();
    if (s.length < 4) { setError('만들고 싶은 여정을 한 문장으로 적어 주세요.'); return; }
    setError(null);
    setPhase('reading');
    try {
      const res = await fetch('/api/ai/operator/journeys-interview/parse', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ sentence: s }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d?.success) {
        setError(d?.error || '문장을 읽지 못했어요.');
        setPhase('input');
        return;
      }
      const p: InterviewPrepared = { plans: d.plans, questions: d.questions, callback: d.callback, costPerJourney: Number(d.costPerJourney || 0) };
      setPrepared(p);
      setPlans(p.plans);
      setAnswers({});
      setCallbackPhone(p.callback.defaultPhone || '');
      setInterviewId(newId());
      setPhase('questions');
    } catch {
      setError('네트워크 오류로 문장을 읽지 못했어요.');
      setPhase('input');
    }
  };

  const triggerOf = (planKey: string): string => {
    const q = prepared?.questions.find((x) => x.id === `${planKey}:trigger`);
    return answers[`${planKey}:trigger`] || q?.recommended || plans.find((p) => p.key === planKey)?.triggerEvent || '';
  };
  const recommendedOf = (q: InterviewQuestion): string | undefined => {
    if (q.recommendedByTrigger) return q.recommendedByTrigger[triggerOf(q.planKey)] ?? q.recommended;
    return q.recommended;
  };
  const valueOf = (q: InterviewQuestion): string => answers[q.id] ?? recommendedOf(q) ?? '';
  const visible = (q: InterviewQuestion) => !(q.hideForTriggers || []).includes(triggerOf(q.planKey));

  const needsCallbackChoice = !!prepared && !prepared.callback.defaultPhone;
  const noCallback = !!prepared && prepared.callback.options.length === 0;
  const totalCost = (prepared?.costPerJourney || 0) * plans.length;
  const canBuild = plans.length > 0 && !noCallback && (!needsCallbackChoice || !!callbackPhone);

  const build = async () => {
    if (!canBuild) return;
    cancelRef.current = false;
    const list: Progress[] = plans.map((p) => ({ planKey: p.key, title: p.title, status: 'wait' }));
    setProgress(list);
    setAttach(null);
    setPhase('designing');
    const done: string[] = [];
    for (let i = 0; i < plans.length; i++) {
      if (cancelRef.current) break;
      const p = plans[i];
      setProgress((prev) => prev.map((x) => (x.planKey === p.key ? { ...x, status: 'run' } : x)));
      const planAnswers = Object.fromEntries(Object.entries(answers).filter(([k]) => k.startsWith(`${p.key}:`)));
      try {
        const res = await fetch('/api/ai/operator/journeys-interview/design', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ interviewId, plan: p, answers: planAnswers, callbackNumber: callbackPhone || undefined }),
        });
        const d = await res.json().catch(() => ({}));
        if (res.ok && d?.success) {
          done.push(String(d.journeyId));
          setProgress((prev) => prev.map((x) => (x.planKey === p.key ? { ...x, status: 'ok', journeyId: String(d.journeyId), title: String(d.name || x.title) } : x)));
        } else {
          setProgress((prev) => prev.map((x) => (x.planKey === p.key ? { ...x, status: 'fail', message: d?.error || '만들지 못했어요.' } : x)));
          if (res.status === 402) break;   // 크레딧 부족이면 남은 여정도 못 만든다
        }
      } catch {
        setProgress((prev) => prev.map((x) => (x.planKey === p.key ? { ...x, status: 'fail', message: '네트워크 오류로 만들지 못했어요.' } : x)));
      }
    }
    if (cancelRef.current) return;
    clearStore();
    onCreated();
    setPhase('done');
    if (done.length > 0) void loadAttach(done);
  };

  const loadAttach = async (ids: string[]) => {
    try {
      const res = await fetch(`/api/ai/operator/journeys-attach-check?ids=${encodeURIComponent(ids.join(','))}`, { headers: authHeaders() });
      const d = await res.json().catch(() => ({}));
      setAttach(d?.success && Array.isArray(d.rows) ? d.rows : []);
    } catch {
      setAttach([]);
    }
  };

  const createdIds = useMemo(() => progress.filter((p) => p.status === 'ok' && p.journeyId).map((p) => p.journeyId!), [progress]);

  const runFix = async (row: AttachCheckRow) => {
    if (!row.fix) return;
    setFixing(row.id);
    try {
      await onFix(row.fix);
      if (row.fix.action !== 'create' && row.fix.action !== 'activate') await loadAttach(createdIds);
    } finally {
      setFixing(null);
    }
  };

  const restart = () => {
    clearStore();
    setPrepared(null);
    setPlans([]);
    setAnswers({});
    setProgress([]);
    setAttach(null);
    setPhase('input');
  };

  const pill = (selected: boolean, disabled?: boolean) => disabled
    ? 'h-8 px-3 rounded-lg text-xs border border-white/10 text-white/30 cursor-not-allowed inline-flex items-center gap-1'
    : selected
      ? 'h-8 px-3 rounded-lg text-xs font-semibold border border-violet-400/60 bg-violet-600/40 text-white inline-flex items-center gap-1.5'
      : 'h-8 px-3 rounded-lg text-xs border border-white/15 text-white/70 hover:bg-white/10 transition-colors inline-flex items-center gap-1.5';

  return (
    <JourneyModalShell open={open} onClose={close} labelledBy="jmap-interview-title" panelClassName="w-full max-w-2xl" disableDismiss={phase === 'designing'}>
      <div className="flex items-start gap-3 px-5 pt-5 pb-3 border-b border-white/10">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shrink-0">
          <MessageSquarePlus className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 id="jmap-interview-title" className="text-sm font-semibold text-white">문장으로 여정 만들기</h2>
          <p className="mt-0.5 text-[11px] text-white/50">한 문장이면 몇 가지만 묻고 여정 초안을 만들어요. 켜기 전에는 아무것도 보내지 않아요.</p>
        </div>
        <button type="button" onClick={close} className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10" aria-label={phase === 'designing' ? '그만 만들기' : '닫기'}>
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {(phase === 'input' || phase === 'reading') && (
          <div className="space-y-3">
            <label className="block text-xs font-semibold text-white/80" htmlFor="jmap-interview-input">어떤 여정을 만들고 싶으세요?</label>
            <textarea
              id="jmap-interview-input"
              value={sentence}
              onChange={(e) => setSentence(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void read(); } }}
              rows={3}
              maxLength={300}
              disabled={phase === 'reading'}
              placeholder="예: 가입한 고객이 첫 구매까지 오고 재구매로 이어지게 해 줘"
              className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-white/10 text-sm placeholder-white/30 focus:outline-none focus:border-violet-400 resize-none"
            />
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((ex) => (
                <button key={ex} type="button" onClick={() => setSentence(ex)} disabled={phase === 'reading'} className="px-2.5 py-1 rounded-full text-[11px] text-white/60 border border-white/10 hover:bg-white/10 hover:text-white/85 transition-colors">
                  {ex}
                </button>
              ))}
            </div>
            {error && <p className="flex items-start gap-1.5 text-[11px] text-rose-300"><AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />{error}</p>}
          </div>
        )}

        {phase === 'questions' && prepared && (
          <div className="space-y-4">
            <div className="rounded-xl bg-white/[0.03] border border-white/10 px-3 py-2 text-[11px] text-white/55">
              “{sentence}”을 이렇게 나눴어요. 추천 답을 골라 두었으니 그대로 만들어도 돼요.
            </div>
            {needsCallbackChoice && (
              <section className="rounded-xl border border-amber-400/30 bg-amber-500/[0.05] p-3">
                <div className="text-xs font-semibold text-amber-100">어느 번호로 보낼까요?</div>
                {noCallback ? (
                  <p className="mt-1 text-[11px] text-amber-100/80">등록된 회신번호가 없어요. 회신번호를 먼저 등록해 주세요.</p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="회신번호">
                    {prepared.callback.options.map((o) => (
                      <button key={o.phone} type="button" role="radio" aria-checked={callbackPhone === o.phone} onClick={() => setCallbackPhone(o.phone)} className={pill(callbackPhone === o.phone)}>
                        {o.phone}{o.description ? ` · ${o.description}` : ''}
                      </button>
                    ))}
                  </div>
                )}
              </section>
            )}
            {plans.map((p, idx) => (
              <section key={p.key} className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                <div className="flex items-start gap-2">
                  <span className="w-6 h-6 rounded-full bg-violet-500/20 text-violet-200 text-[11px] font-bold flex items-center justify-center shrink-0">{idx + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-white">{p.title}</div>
                    {p.objective && <p className="mt-0.5 text-[11px] text-white/50">{p.objective}</p>}
                  </div>
                  {plans.length > 1 && (
                    <button type="button" onClick={() => setPlans((prev) => prev.filter((x) => x.key !== p.key))} className="text-[11px] text-white/45 hover:text-white/80 px-2 py-1 rounded hover:bg-white/10">
                      이 여정 빼기
                    </button>
                  )}
                </div>
                <div className="mt-3 space-y-3">
                  {prepared.questions.filter((q) => q.planKey === p.key && visible(q)).map((q) => (
                    <div key={q.id}>
                      <div className="text-xs font-medium text-white/80">{q.label}</div>
                      {q.kind === 'choice' ? (
                        <div className="mt-1.5 flex flex-wrap gap-1.5" role="radiogroup" aria-label={q.label}>
                          {(q.options || []).map((o) => (
                            <button
                              key={o.value}
                              type="button"
                              role="radio"
                              aria-checked={valueOf(q) === o.value}
                              disabled={o.disabled}
                              title={o.disabled ? o.reason : o.desc}
                              onClick={() => setAnswers((prev) => ({ ...prev, [q.id]: o.value }))}
                              className={pill(valueOf(q) === o.value, o.disabled)}
                            >
                              {o.disabled && <Lock className="w-3 h-3" />}
                              {o.label}
                              {!o.disabled && recommendedOf(q) === o.value && <span className="text-[11px] text-violet-200/80">추천</span>}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <input
                          value={answers[q.id] || ''}
                          onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                          placeholder={q.placeholder}
                          maxLength={q.maxLength}
                          aria-label={q.label}
                          className="mt-1.5 w-full h-9 px-3 rounded-lg bg-slate-900 border border-white/10 text-xs placeholder-white/30 focus:outline-none focus:border-violet-400"
                        />
                      )}
                      {q.help && <p className="mt-1 text-[11px] text-white/40">{q.help}</p>}
                      {q.kind === 'choice' && (q.options || []).filter((o) => o.disabled).map((o) => (
                        <p key={o.value} className="mt-1 flex items-start gap-1 text-[11px] text-white/40">
                          <Lock className="w-3 h-3 mt-0.5 shrink-0" />
                          <span>{o.label}: {o.reason || '지금 데이터로는 만들 수 없어요.'}</span>
                        </p>
                      ))}
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        {(phase === 'designing' || phase === 'done') && (
          <div className="space-y-4">
            <div className="space-y-2">
              {progress.map((p) => (
                <div key={p.planKey} className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                  {p.status === 'run' ? <Loader2 className="w-4 h-4 animate-spin text-violet-300" />
                    : p.status === 'ok' ? <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                      : p.status === 'fail' ? <XCircle className="w-4 h-4 text-rose-300" />
                        : <span className="w-4 h-4 rounded-full border border-white/20" aria-hidden />}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-white truncate">{p.title}</div>
                    <div className="text-[11px] text-white/45">
                      {p.status === 'run' ? '설계하는 중(30초 안팎)' : p.status === 'ok' ? '초안으로 저장했어요' : p.status === 'fail' ? p.message : '차례를 기다리는 중'}
                    </div>
                  </div>
                  {p.status === 'ok' && p.journeyId && (
                    <button type="button" onClick={() => { close(); onFocusJourney(p.journeyId!); }} className="text-[11px] text-violet-200 hover:underline inline-flex items-center gap-0.5">
                      지도에서 <ArrowRight className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {phase === 'designing' && (
              <p className="text-[11px] text-white/40">닫으면 남은 여정은 만들지 않아요. 지금 만드는 여정은 끝까지 만들어집니다.</p>
            )}

            {phase === 'done' && createdIds.length > 0 && (
              <section>
                <h3 className="text-sm font-semibold text-white">이어붙이기 점검</h3>
                <p className="mt-0.5 text-[11px] text-white/45">새 여정이 다른 여정과 어떻게 이어지는지 봤어요.</p>
                <div className="mt-2 space-y-2">
                  {attach === null && <div className="flex items-center gap-2 text-[11px] text-white/50"><Loader2 className="w-3.5 h-3.5 animate-spin" />점검하는 중</div>}
                  {attach !== null && attach.length === 0 && <div className="text-[11px] text-white/40">이어질 곳과 손볼 곳이 없어요.</div>}
                  {(attach || []).map((r) => (
                    <div key={r.id} className={`rounded-xl border px-3 py-2.5 flex items-center gap-3 ${r.tier === 'warn' ? 'border-amber-400/30 bg-amber-500/[0.06]' : r.tier === 'solid' ? 'border-violet-400/25 bg-violet-500/[0.06]' : 'border-white/10 bg-white/[0.02]'}`}>
                      <div className="flex-1 min-w-0">
                        <div className={`text-xs font-semibold ${r.tier === 'warn' ? 'text-amber-100' : 'text-white/85'}`}>{r.text}</div>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-white/55">{r.reason}</p>
                      </div>
                      {r.fix && (
                        <button
                          type="button"
                          disabled={fixing === r.id}
                          onClick={() => void runFix(r)}
                          className="shrink-0 h-8 px-3 rounded-lg text-[11px] font-semibold text-white bg-violet-600 hover:bg-violet-500 disabled:opacity-50 inline-flex items-center gap-1 transition-colors"
                        >
                          {fixing === r.id && <Loader2 className="w-3 h-3 animate-spin" />}
                          {r.fix.label}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>

      <div className="px-5 py-3 border-t border-white/10 flex items-center gap-2">
        {(phase === 'input' || phase === 'reading') && (
          <>
            <span className="flex-1 text-[11px] text-white/40">문장을 읽는 데는 크레딧이 들지 않아요.</span>
            <button type="button" onClick={() => void read()} disabled={phase === 'reading'} className="h-9 px-4 rounded-lg text-xs font-semibold text-white bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 disabled:opacity-50 inline-flex items-center gap-1.5">
              {phase === 'reading' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {phase === 'reading' ? '문장을 읽는 중' : '질문 받기'}
            </button>
          </>
        )}
        {phase === 'questions' && (
          <>
            <button type="button" onClick={restart} className="h-9 px-3 rounded-lg text-xs text-white/60 hover:bg-white/10">다시 쓰기</button>
            <span className="flex-1 text-right text-[11px] text-white/50 tabular-nums">여정 {plans.length}개 · 초안 만들기 {totalCost} 크레딧</span>
            <button type="button" onClick={() => void build()} disabled={!canBuild} className="h-9 px-4 rounded-lg text-xs font-semibold text-white bg-violet-600 hover:bg-violet-500 disabled:opacity-50">
              이대로 만들기
            </button>
          </>
        )}
        {phase === 'designing' && (
          <span className="flex-1 flex items-center gap-2 text-[11px] text-white/50"><Loader2 className="w-3.5 h-3.5 animate-spin" />여정을 차례로 설계하고 있어요</span>
        )}
        {phase === 'done' && (
          <>
            <button type="button" onClick={restart} className="h-9 px-3 rounded-lg text-xs text-white/60 hover:bg-white/10">새로 만들기</button>
            <span className="flex-1" />
            {createdIds.length > 0 && (
              <button type="button" onClick={() => { close(); onFocusJourney(createdIds[0]); }} className="h-9 px-3 rounded-lg text-xs font-medium text-white/80 border border-white/15 hover:bg-white/10">
                지도에서 보기
              </button>
            )}
            {createdIds.length > 0 && (
              <button type="button" onClick={() => { close(); onActivateMany(createdIds); }} className="h-9 px-4 rounded-lg text-xs font-semibold text-white bg-violet-600 hover:bg-violet-500">
                켜기 전 점검
              </button>
            )}
          </>
        )}
      </div>
    </JourneyModalShell>
  );
}
