/**
 * InterviewModal — 문장으로 여정 만들기 (★ 2026-09-30 여정 V2 2차 · 설계서 §5)
 *
 * 한 줄 입력 → 질문(추천 답 미리 선택 · 고르거나 직접 입력 · [이대로 만들기] 상시) → 여정마다 설계 1회(초안 저장)
 *   → 이어붙이기 점검(줄마다 1클릭 고치기) → [모두 켜기] 또는 [지도에서 보기].
 *
 * ★ 2026-10-23 한 줄 여정 한 길 — 여정을 만드는 모든 입구(목록 한 줄 · 지도 한 줄 · 빠른 시작 · 기회 카드 · 다음 수 · 한 줄 답 카드 · 지도 [만들기])가
 *   이 창 하나로 온다(initialSentence = 한 줄 · preset = 시작 사건이 정해진 입구). 옛 화면 패키지 길(돌려보기마다 차감 · 화면 매핑 저장)은 지웠다.
 *
 * 규칙
 *   - 질문 · 선택지 · 추천 답은 서버 CT(journey-interview)가 준다. 화면은 그리기 · 고른 값 보관만.
 *   - 혜택 · 마감일은 담당자가 한 줄에 적은 것만 서버 듣기(listenLine)가 칸에 채워 둔다(고치거나 지울 수 있다). 금액은 서버 단가(costPerJourney) × 만들 여정 수.
 *   - 답은 브라우저 임시 보관(sessionStorage)으로 새로고침해도 남는다. 다 만들면 지운다.
 *   - 못 만든 여정이 있으면(응답이 끊김 · 크레딧 부족 등) 같은 요청 키 · 답을 남겨 [못 만든 여정 다시 시도]가 같은 키로 다시 보낸다
 *     (서버가 이미 만들었으면 그 초안을 돌려준다 · 두 번 차감 없음 · ★ 2026-10-23 Codex 1R).
 *   - 설계는 여정 하나씩 요청한다. 닫으면 남은 여정은 만들지 않는다(지금 만드는 것은 끝까지 만들어진다).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowRight, CheckCircle2, Loader2, Lock, MessageSquarePlus, Sparkles, X, XCircle } from 'lucide-react';
import JourneyModalShell from '../JourneyModalShell';
import ZoneQuestion from '../../zone/ZoneQuestion';
import type { AttachCheckRow, AttachFix, InterviewPlan, InterviewPrepared, InterviewQuestion } from '../../../utils/journey-map';
import { newRequestId } from '../../../utils/request-id';

/** 시작 사건이 정해진 입구(빠른 시작 · 기회 카드 · 다음 수 · 한 줄 답 카드 · 지도 [만들기]). */
export interface InterviewPreset { triggerEvent?: string; templateCode?: string; objective?: string }
/** 빠른 시작 줄(잠김 = 사유 그대로 · 풀 수 있으면 그 행동). */
export interface InterviewQuickStart { code: string; label: string; lockedReason: string | null; lockedAction?: { label: string; onClick: () => void } }

interface Props {
  open: boolean;
  onClose: () => void;
  /** 이어붙이기 점검 줄의 1클릭 고치기(지도). 없으면 점검을 건너뛴다(목록 = 작업 화면에서 손본다). */
  onFix?: (fix: AttachFix) => Promise<void>;
  onFocusJourney: (id: string) => void;
  /** [켜기 전 점검](지도 묶음 켜기). 없으면 버튼을 숨긴다. */
  onActivateMany?: (ids: string[]) => void;
  /** 만든 여정(시작 사건 = 서버가 저장한 값) — 목록은 다음 수 안내에 쓴다. */
  onCreated: (made?: Array<{ journeyId: string; triggerEvent: string; goalExitEnabled: boolean }>) => void;
  /** 한 줄 입구 — 열면 이 문장을 바로 읽는다. */
  initialSentence?: string;
  /** 시작 사건이 정해진 입구 — 열면 그 사건의 질문표를 바로 받는다(AI 0 · 차감 0). */
  preset?: InterviewPreset | null;
  quickStarts?: InterviewQuickStart[];
  /** 만든 여정 열기 버튼 글(목록 = 작업 화면 열기 · 지도 = 지도에서 보기). */
  focusLabel?: string;
}

type Phase = 'input' | 'reading' | 'questions' | 'designing' | 'done';
/** unknown = 결과를 모름(응답 · 본문 끊김 · 서버 오류 · 처리 중) — 서버가 이미 만들었을 수 있다 · 그 초안 id 를 받을 때만 풀린다 */
interface Progress { planKey: string; title: string; status: 'wait' | 'run' | 'ok' | 'fail'; journeyId?: string; message?: string; summary?: string; notices?: string[]; unknown?: boolean }

const STORE_KEY = 'jmap-interview-v1';
const EXAMPLES = [
  '가입한 고객이 첫 구매까지 오고 재구매로 이어지게 해 줘',
  '장바구니에 담고 안 산 고객을 다시 불러 줘',
  '한동안 안 산 고객을 되살리는 여정 만들어 줘',
  '생일 앞둔 고객에게 축하 쿠폰 보내 줘',
];


function authHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` };
}

export default function InterviewModal({ open, onClose, onFix, onFocusJourney, onActivateMany, onCreated, initialSentence, preset, quickStarts, focusLabel }: Props) {
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
    // ★ 2026-10-23 입구가 정한 값(한 줄 · 시작 사건)이 있으면 그것부터 — 보관된 옛 답보다 우선
    if (preset && (preset.triggerEvent || preset.templateCode)) { clearStore(); void loadPreset(preset); return; }
    if (initialSentence && initialSentence.trim().length >= 4) { clearStore(); setSentence(initialSentence.trim()); void read(initialSentence.trim()); return; }
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
          setInterviewId(String(v.interviewId || newRequestId()));
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

  /** 받은 질문표를 그린다 — 칸에 채워 둔 값(혜택 · 마지막 날)은 답으로 옮겨 서버에 그대로 간다(보이는 것 = 보내는 것). */
  const applyPrepared = (d: any) => {
    const p: InterviewPrepared = { plans: d.plans, questions: d.questions, callback: d.callback, costPerJourney: Number(d.costPerJourney || 0), notes: Array.isArray(d.notes) ? d.notes : [] };
    setPrepared(p);
    setPlans(p.plans);
    setAnswers(Object.fromEntries(p.questions.filter((q) => (q.kind === 'text' || q.kind === 'date') && q.recommended).map((q) => [q.id, String(q.recommended)])));
    setCallbackPhone(p.callback.defaultPhone || '');
    setInterviewId(newRequestId());
    setPhase('questions');
  };

  const loadPreset = async (ps: InterviewPreset) => {
    setError(null);
    setPhase('reading');
    try {
      const res = await fetch('/api/ai/operator/journeys-interview/preset', { method: 'POST', headers: authHeaders(), body: JSON.stringify(ps) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d?.success) { setError(d?.error || '질문을 준비하지 못했어요.'); setPhase('input'); return; }
      setSentence('');   // 시작 사건이 정해진 입구 = 나눈 문장이 없다(「…을 이렇게 나눴어요」를 말하지 않는다)
      applyPrepared(d);
    } catch {
      setError('네트워크 오류로 질문을 준비하지 못했어요.');
      setPhase('input');
    }
  };

  const read = async (given?: string) => {
    const s = (given ?? sentence).trim();
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
      applyPrepared(d);
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

  /** only = 다시 시도할 계획(못 만든 것만 · 같은 요청 키). 없으면 처음부터 전부. */
  const build = async (only?: string[]) => {
    if (!canBuild) return;
    cancelRef.current = false;
    const targets = only ? plans.filter((p) => only.includes(p.key)) : plans;
    const keptIds = only ? progress.filter((x) => x.status === 'ok' && x.journeyId && !only.includes(x.planKey)).map((x) => x.journeyId!) : [];
    setProgress((prev) => (only
      ? prev.map((x) => (only.includes(x.planKey) ? { ...x, status: 'wait', message: undefined } : x))
      : plans.map((p) => ({ planKey: p.key, title: p.title, status: 'wait' }))));
    setAttach(null);
    setPhase('designing');
    const done: string[] = [];
    const made: Array<{ journeyId: string; triggerEvent: string; goalExitEnabled: boolean }> = [];
    for (let i = 0; i < targets.length; i++) {
      if (cancelRef.current) break;
      const p = targets[i];
      setProgress((prev) => prev.map((x) => (x.planKey === p.key ? { ...x, status: 'run' } : x)));
      const planAnswers = Object.fromEntries(Object.entries(answers).filter(([k]) => k.startsWith(`${p.key}:`)));
      try {
        const res = await fetch('/api/ai/operator/journeys-interview/design', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ interviewId, plan: p, answers: planAnswers, callbackNumber: callbackPhone || undefined }),
        });
        const d = await res.json().catch(() => null);
        if (d === null) throw new Error('본문을 못 읽음');   // 200 이어도 본문이 끊기면 만들어졌는지 모른다 = 결과 모름
        // ★ 2026-10-19 B-1010-12 — 이미 만든 초안(같은 요청)이면 서버가 그 id 를 실어 준다 = 만든 것으로 보고 연다
        if ((res.ok && d?.success) || (!res.ok && d?.journeyId)) {
          done.push(String(d.journeyId));
          made.push({ journeyId: String(d.journeyId), triggerEvent: String(d.triggerEvent || p.triggerEvent || ''), goalExitEnabled: d.goalExitEnabled === true });
          setProgress((prev) => prev.map((x) => (x.planKey === p.key ? { ...x, status: 'ok', unknown: false, journeyId: String(d.journeyId), title: String(d.name || x.title), summary: d.targetSummary ? String(d.targetSummary) : undefined, notices: Array.isArray(d.notices) ? d.notices.map(String) : [] } : x)));
        } else {
          setProgress((prev) => prev.map((x) => (x.planKey === p.key ? { ...x, status: 'fail', message: d?.error || '만들지 못했어요.', unknown: x.unknown || res.status >= 500 || res.status === 409 } : x)));
          if (res.status === 402) break;   // 크레딧 부족이면 남은 여정도 못 만든다
        }
      } catch {
        setProgress((prev) => prev.map((x) => (x.planKey === p.key ? { ...x, status: 'fail', message: '응답을 받지 못했어요. 다시 시도하면 만들어졌는지 확인해요.', unknown: true } : x)));
      }
    }
    if (cancelRef.current) return;
    if (made.length === targets.length) clearStore();   // 못 만든 여정이 있으면 같은 요청 키 · 답을 남긴다(다시 열어도 같은 키)
    onCreated(made);
    setPhase('done');
    const okIds = [...keptIds, ...done];
    if (okIds.length > 0 && onFix) void loadAttach(okIds);
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
  const retryKeys = useMemo(() => progress.filter((p) => p.status === 'fail' || p.status === 'wait').map((p) => p.planKey), [progress]);
  const unsure = progress.some((p) => p.unknown);   // 앞 행의 402 로 멈춰 대기로 남은 결과 모름도 포함(3R)

  const runFix = async (row: AttachCheckRow) => {
    if (!row.fix) return;
    setFixing(row.id);
    try {
      if (!onFix) return;
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
    ? 'h-8 px-3 rounded-lg text-xs border border-slate-200 text-slate-400 cursor-not-allowed inline-flex items-center gap-1'
    : selected
      ? 'h-8 px-3 rounded-lg text-xs font-semibold border border-violet-300 bg-violet-200 text-slate-900 inline-flex items-center gap-1.5'
      : 'h-8 px-3 rounded-lg text-xs border border-slate-300 text-slate-600 hover:bg-slate-100 transition-colors inline-flex items-center gap-1.5';

  return (
    <JourneyModalShell open={open} onClose={close} labelledBy="jmap-interview-title" panelClassName="w-full max-w-2xl" disableDismiss={phase === 'designing'}>
      <div className="flex items-start gap-3 px-5 pt-5 pb-3 border-b border-slate-200">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shrink-0">
          <MessageSquarePlus className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 id="jmap-interview-title" className="text-sm font-semibold text-slate-900">문장으로 여정 만들기</h2>
          <p className="mt-0.5 text-[11px] text-slate-500">한 문장이면 몇 가지만 묻고 여정 초안을 만들어요. 켜기 전에는 아무것도 보내지 않아요.</p>
        </div>
        <button type="button" onClick={close} className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100" aria-label={phase === 'designing' ? '그만 만들기' : '닫기'}>
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {(phase === 'input' || phase === 'reading') && (
          <div className="space-y-3">
            <label className="block text-xs font-semibold text-slate-700" htmlFor="jmap-interview-input">어떤 여정을 만들고 싶으세요?</label>
            <textarea
              id="jmap-interview-input"
              value={sentence}
              onChange={(e) => setSentence(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void read(); } }}
              rows={3}
              maxLength={300}
              disabled={phase === 'reading'}
              placeholder="예: 가입한 고객이 첫 구매까지 오고 재구매로 이어지게 해 줘"
              className="w-full px-3 py-2.5 rounded-xl bg-slate-100 border border-slate-200 text-sm placeholder-slate-400 focus:outline-none focus:border-violet-400 resize-none"
            />
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((ex) => (
                <button key={ex} type="button" onClick={() => setSentence(ex)} disabled={phase === 'reading'} className="px-2.5 py-1 rounded-full text-[11px] text-slate-500 border border-slate-200 hover:bg-slate-100 hover:text-slate-700 transition-colors">
                  {ex}
                </button>
              ))}
            </div>
            {quickStarts && quickStarts.length > 0 && (
              <div className="pt-1">
                <div className="text-xs font-semibold text-slate-700">빠른 시작</div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {quickStarts.map((q) => (q.lockedReason ? (
                    <span key={q.code} title={q.lockedReason} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] text-slate-400 border border-slate-200">
                      <Lock className="w-3 h-3" />{q.label}
                      {q.lockedAction && <button type="button" onClick={q.lockedAction.onClick} className="ml-1 text-violet-800 hover:underline">{q.lockedAction.label}</button>}
                    </span>
                  ) : (
                    <button key={q.code} type="button" disabled={phase === 'reading'} onClick={() => void loadPreset({ templateCode: q.code })}
                      className="px-2.5 py-1 rounded-full text-[11px] text-violet-800 border border-violet-200 bg-violet-50 hover:bg-violet-100 transition-colors">
                      {q.label}
                    </button>
                  )))}
                </div>
              </div>
            )}
            {error && <p className="flex items-start gap-1.5 text-[11px] text-rose-700"><AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />{error}</p>}
          </div>
        )}

        {phase === 'questions' && prepared && (
          <div className="space-y-4">
            <div className="rounded-xl bg-white border border-slate-200 px-3 py-2 text-[11px] text-slate-500">
              {sentence ? `“${sentence}”을 이렇게 나눴어요. ` : ''}추천 답을 골라 두었으니 그대로 만들어도 돼요.
            </div>
            {(prepared.notes || []).map((n) => (
              <p key={n} className="flex items-start gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />{n}
              </p>
            ))}
            {needsCallbackChoice && (
              <section className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                <div className="text-xs font-semibold text-amber-900">어느 번호로 보낼까요?</div>
                {noCallback ? (
                  <p className="mt-1 text-[11px] text-amber-900">등록된 회신번호가 없어요. 회신번호를 먼저 등록해 주세요.</p>
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
              <section key={p.key} className="rounded-2xl border border-slate-200 bg-slate-100 p-4">
                <div className="flex items-start gap-2">
                  <span className="w-6 h-6 rounded-full bg-violet-100 text-violet-800 text-[11px] font-bold flex items-center justify-center shrink-0">{idx + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-slate-900">{p.title}</div>
                    {p.objective && <p className="mt-0.5 text-[11px] text-slate-500">{p.objective}</p>}
                  </div>
                  {plans.length > 1 && (
                    <button type="button" onClick={() => setPlans((prev) => prev.filter((x) => x.key !== p.key))} className="text-[11px] text-slate-400 hover:text-slate-700 px-2 py-1 rounded hover:bg-slate-100">
                      이 여정 빼기
                    </button>
                  )}
                </div>
                <div className="mt-3 space-y-3">
                  {prepared.questions.filter((q) => q.planKey === p.key && visible(q)).map((q) => (
                    // ★ 2026-10-24 질문 한 줄 = 공용 부품(ZoneQuestion · 자동 마케팅 한 줄 창과 같은 모양)
                    <ZoneQuestion
                      key={q.id}
                      q={q}
                      value={q.kind === 'choice' ? valueOf(q) : (answers[q.id] || '')}
                      recommendedValue={q.kind === 'choice' ? recommendedOf(q) : undefined}
                      onChange={(v) => setAnswers((prev) => ({ ...prev, [q.id]: v }))}
                    />
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
                <div key={p.planKey} className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                  {p.status === 'run' ? <Loader2 className="w-4 h-4 animate-spin text-violet-700" />
                    : p.status === 'ok' ? <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                      : p.status === 'fail' ? <XCircle className="w-4 h-4 text-rose-700" />
                        : <span className="w-4 h-4 rounded-full border border-slate-300" aria-hidden />}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-slate-900 truncate">{p.title}</div>
                    <div className="text-[11px] text-slate-400">
                      {p.status === 'run' ? '설계하는 중(30초 안팎)' : p.status === 'ok' ? (p.summary ? `초안으로 저장했어요 · ${p.summary}` : '초안으로 저장했어요') : p.status === 'fail' ? p.message : '차례를 기다리는 중'}
                    </div>
                    {(p.notices || []).map((n) => <div key={n} className="text-[11px] text-amber-800">{n}</div>)}
                  </div>
                  {p.status === 'ok' && p.journeyId && (
                    <button type="button" onClick={() => { close(); onFocusJourney(p.journeyId!); }} className="text-[11px] text-violet-800 hover:underline inline-flex items-center gap-0.5">
                      {focusLabel ? '열기' : '지도에서'} <ArrowRight className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {phase === 'designing' && (
              <p className="text-[11px] text-slate-400">닫으면 남은 여정은 만들지 않아요. 지금 만드는 여정은 끝까지 만들어집니다.</p>
            )}
            {phase === 'done' && retryKeys.length > 0 && (
              <p className="text-[11px] text-slate-500">다시 시도하면 같은 요청으로 보내요. 이미 만들어진 여정은 그 초안을 열고 크레딧은 다시 들지 않아요.</p>
            )}

            {/* 고치기 연결이 있는 곳(지도)만 점검한다 — 없으면 점검 줄을 그리지 않는다(옛: 「점검하는 중」이 끝없이 남았다) */}
            {phase === 'done' && createdIds.length > 0 && onFix && (
              <section>
                <h3 className="text-sm font-semibold text-slate-900">이어붙이기 점검</h3>
                <p className="mt-0.5 text-[11px] text-slate-400">새 여정이 다른 여정과 어떻게 이어지는지 봤어요.</p>
                <div className="mt-2 space-y-2">
                  {attach === null && <div className="flex items-center gap-2 text-[11px] text-slate-500"><Loader2 className="w-3.5 h-3.5 animate-spin" />점검하는 중</div>}
                  {attach !== null && attach.length === 0 && <div className="text-[11px] text-slate-400">이어질 곳과 손볼 곳이 없어요.</div>}
                  {(attach || []).map((r) => (
                    <div key={r.id} className={`rounded-xl border px-3 py-2.5 flex items-center gap-3 ${r.tier === 'warn' ? 'border-amber-200 bg-amber-50' : r.tier === 'solid' ? 'border-violet-200 bg-violet-50' : 'border-slate-200 bg-white'}`}>
                      <div className="flex-1 min-w-0">
                        <div className={`text-xs font-semibold ${r.tier === 'warn' ? 'text-amber-900' : 'text-slate-700'}`}>{r.text}</div>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{r.reason}</p>
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

      <div className="px-5 py-3 border-t border-slate-200 flex items-center gap-2">
        {(phase === 'input' || phase === 'reading') && (
          <>
            <span className="flex-1 text-[11px] text-slate-400">문장을 읽는 데는 크레딧이 들지 않아요.</span>
            <button type="button" onClick={() => void read()} disabled={phase === 'reading'} className="h-9 px-4 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 inline-flex items-center gap-1.5">
              {phase === 'reading' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {phase === 'reading' ? '문장을 읽는 중' : '질문 받기'}
            </button>
          </>
        )}
        {phase === 'questions' && (
          <>
            <button type="button" onClick={restart} className="h-9 px-3 rounded-lg text-xs text-slate-500 hover:bg-slate-100">다시 쓰기</button>
            <span className="flex-1 text-right text-[11px] text-slate-500 tabular-nums">여정 {plans.length}개 · 초안 만들기 {totalCost} 크레딧</span>
            <button type="button" onClick={() => void build()} disabled={!canBuild} className="h-9 px-4 rounded-lg text-xs font-semibold text-white bg-violet-600 hover:bg-violet-500 disabled:opacity-50">
              이대로 만들기
            </button>
          </>
        )}
        {phase === 'designing' && (
          <span className="flex-1 flex items-center gap-2 text-[11px] text-slate-500"><Loader2 className="w-3.5 h-3.5 animate-spin" />여정을 차례로 설계하고 있어요</span>
        )}
        {phase === 'done' && (
          <>
            {/* 결과를 모르는 요청(응답 · 본문 끊김 · 서버 오류 · 처리 중)이 남았으면 새 요청(새 키)을 열지 않는다 — 새로 만들면 두 번 차감될 수 있다.
                결과 모름은 서버가 그 초안 id 를 돌려줄 때(ok)만 풀린다(다시 시도가 앞에서 거절돼도 남는다). */}
            {!unsure && <button type="button" onClick={restart} className="h-9 px-3 rounded-lg text-xs text-slate-500 hover:bg-slate-100">새로 만들기</button>}
            <span className="flex-1" />
            {retryKeys.length > 0 && (
              <button type="button" onClick={() => void build(retryKeys)} className="h-9 px-4 rounded-lg text-xs font-semibold text-white bg-violet-600 hover:bg-violet-500">
                못 만든 여정 다시 시도
              </button>
            )}
            {createdIds.length > 0 && (
              <button type="button" onClick={() => { close(); onFocusJourney(createdIds[0]); }} className="h-9 px-3 rounded-lg text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-100">
                {focusLabel || '지도에서 보기'}
              </button>
            )}
            {createdIds.length > 0 && onActivateMany && (
              <button type="button" onClick={() => { close(); onActivateMany?.(createdIds); }} className="h-9 px-4 rounded-lg text-xs font-semibold text-white bg-violet-600 hover:bg-violet-500">
                켜기 전 점검
              </button>
            )}
          </>
        )}
      </div>
    </JourneyModalShell>
  );
}
