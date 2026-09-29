/**
 * BatchActivateModal — 켜기 전 점검 · 모두 켜기 (★ 2026-09-30 여정 V2 2차 · 설계서 §5 "켜기")
 *
 * 한 창에서: 여정마다 사전 검증(기존 pretest-validate · 여정마다 차례로) · 한 번에 보낼 최대 인원(필수) ·
 *   처음 켜는 요금(서버 단가 × 초안 수) · 소급 없음 안내 · 겹치는 쌍마다 고르기(알고 둘 다 보냄 / 한쪽 빼기)
 *   → [모두 켜기] = 서버 activate-batch(받는 여정 먼저 · 여정마다 단건과 같은 게이트) → 카드별 결과.
 *
 * ⛔ 자동으로 켜지 않는다 · 게이트를 우회하지 않는다. 최대 인원을 바꾸면 서버가 검증 통과를 지우므로 그 여정은 다시 검증한다.
 * ⛔ 피로도는 겹침 해소 선택지가 아니다(회사 전체 설정 · 설계서 §5).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Power, Users, X, XCircle } from 'lucide-react';
import JourneyModalShell from '../JourneyModalShell';
import type { BatchActivationItem, LifecycleMapData, MapJourney } from '../../../utils/journey-map';

interface Props {
  open: boolean;
  onClose: () => void;
  data: LifecycleMapData;
  /** 처음 골라 둘 여정(문장으로 만들기 결과 · 선 고치기). 비우면 초안 전부. */
  preselect: string[];
  onEditMessages: (journey: MapJourney) => void;
  onDone: () => void;
}

type Check = { state: 'idle' | 'checking' | 'pass' | 'fail'; issues: string[]; weeklyCount?: number; weeklyCost?: number };

const REASON_TEXT: Record<string, string> = {
  placeholder_unedited: '채워야 할 자리표시(혜택 등)가 남아 있어요',
  variable_mapping_invalid: '알림톡 변수 연결이 비었어요',
  spam_filter_failed: '스팸 차단에 걸리는 문구가 있어요',
  subject_missing: '장문 문자 제목이 없어요',
};

function headers(): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` };
}

export default function BatchActivateModal({ open, onClose, data, preselect, onEditMessages, onDone }: Props) {
  const candidates = useMemo(
    () => data.journeys.filter((j) => j.status === 'draft' || j.status === 'paused'),
    [data.journeys],
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [caps, setCaps] = useState<Record<string, string>>({});
  /** 서버에 저장된 최대 인원 — 지도 응답은 저장 직후 갱신되지 않으므로 여기서 쥔다(같은 값을 또 저장 · 재검증하지 않게). */
  const [savedCaps, setSavedCaps] = useState<Record<string, number | null>>({});
  const [checks, setChecks] = useState<Record<string, Check>>({});
  const [acks, setAcks] = useState<Set<string>>(new Set());
  const [confirmCb, setConfirmCb] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<BatchActivationItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runId = useRef(0);

  // 열 때 초기화 — 고른 여정 · 저장된 최대 인원.
  useEffect(() => {
    if (!open) return;
    const pre = preselect.length > 0 ? preselect.filter((id) => candidates.some((c) => c.id === id)) : candidates.filter((c) => c.status === 'draft').map((c) => c.id);
    setSelected(new Set(pre));
    setCaps(Object.fromEntries(candidates.map((c) => [c.id, c.thresholdRecipients != null ? String(c.thresholdRecipients) : ''])));
    setSavedCaps(Object.fromEntries(candidates.map((c) => [c.id, c.thresholdRecipients])));
    setChecks({});
    setAcks(new Set());
    setConfirmCb(new Set());
    setResults(null);
    setError(null);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const validateOne = async (id: string, rid: number) => {
    setChecks((prev) => ({ ...prev, [id]: { state: 'checking', issues: [] } }));
    try {
      const res = await fetch(`/api/ai/operator/journeys/${id}/pretest-validate`, { method: 'POST', headers: headers() });
      const d = await res.json().catch(() => ({}));
      if (rid !== runId.current) return;
      const j = candidates.find((c) => c.id === id);
      const orderOf = (stepId: string) => j?.steps.find((s) => s.stepId === stepId)?.order;
      if (res.ok && d?.ok) {
        setChecks((prev) => ({ ...prev, [id]: { state: 'pass', issues: [], weeklyCount: d.estimatedWeeklyTriggerCount, weeklyCost: d.totalCost } }));
      } else {
        const issues: string[] = Array.isArray(d?.failedSteps) && d.failedSteps.length > 0
          ? d.failedSteps.slice(0, 3).map((f: any) => `${orderOf(f.stepId) ? `${orderOf(f.stepId)}번째 칸: ` : ''}${REASON_TEXT[f.reason] || '문안을 확인해 주세요'}`)
          : [d?.error || (res.status === 503 ? '검증을 준비 중이에요. 잠시 뒤 다시 시도해 주세요.' : '문안이 없거나 검증하지 못했어요.')];
        setChecks((prev) => ({ ...prev, [id]: { state: 'fail', issues } }));
      }
    } catch {
      if (rid !== runId.current) return;
      setChecks((prev) => ({ ...prev, [id]: { state: 'fail', issues: ['네트워크 오류로 검증하지 못했어요.'] } }));
    }
  };

  const validateAll = async (ids: string[]) => {
    const rid = ++runId.current;
    for (const id of ids) {
      if (rid !== runId.current) return;
      await validateOne(id, rid);
    }
  };

  // 고른 여정은 차례로 검증(기존 사전 검증 · 여정마다 스팸 검사가 돌아 한꺼번에 돌리지 않는다).
  useEffect(() => {
    if (!open || results) return;
    const todo = [...selected].filter((id) => !checks[id]);
    if (todo.length > 0) void validateAll(todo);
  }, [open, selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: string) => setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const pairs = useMemo(() => data.overlaps.filter((o) => selected.has(o.a) || selected.has(o.b)), [data.overlaps, selected]);
  const nameOf = (id: string) => data.journeys.find((j) => j.id === id)?.name || '여정';
  const pairKey = (o: { a: string; b: string }) => [o.a, o.b].sort().join('|');

  const selectedList = candidates.filter((c) => selected.has(c.id));
  const drafts = selectedList.filter((c) => c.status === 'draft').length;
  const credit = drafts * data.costs.activate;
  const capOk = (id: string) => { const n = Math.floor(Number(caps[id])); return !!caps[id]?.trim() && Number.isFinite(n) && n >= 1; };
  const allPass = selectedList.every((c) => checks[c.id]?.state === 'pass');
  const allCaps = selectedList.every((c) => capOk(c.id));
  const allAck = pairs.every((o) => acks.has(pairKey(o)));
  const ready = selectedList.length > 0 && allPass && allCaps && allAck && !running;

  const run = async () => {
    if (!ready) return;
    setRunning(true);
    setError(null);
    try {
      // 바뀐 최대 인원 먼저 저장 → 서버가 검증 통과를 지우므로 그 여정은 다시 검증한 뒤 켠다.
      const changed = selectedList.filter((c) => Math.floor(Number(caps[c.id])) !== savedCaps[c.id]);
      for (const c of changed) {
        const res = await fetch(`/api/ai/operator/journeys/${c.id}/options`, {
          method: 'PATCH', headers: headers(), body: JSON.stringify({ thresholdRecipients: Math.floor(Number(caps[c.id])) }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok || !d?.success) { setError(`${c.name}: ${d?.error || '최대 인원을 저장하지 못했어요.'}`); return; }
        setSavedCaps((prev) => ({ ...prev, [c.id]: Math.floor(Number(caps[c.id])) }));
      }
      if (changed.length > 0) {
        const rid = ++runId.current;
        for (const c of changed) await validateOne(c.id, rid);
        setError('최대 인원을 저장해 다시 검증했어요. 결과를 확인하고 한 번 더 눌러 주세요.');
        return;
      }
      const res = await fetch('/api/ai/operator/journeys-activate-batch', {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ journeyIds: selectedList.map((c) => c.id), confirmCallbackExclusionIds: [...confirmCb] }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d?.success) { setError(d?.error || '켜지 못했어요.'); return; }
      setResults(d.items || []);
      onDone();
    } catch {
      setError('네트워크 오류로 켜지 못했어요.');
    } finally {
      setRunning(false);
    }
  };

  /**
   * ★ 2026-09-30 V2 3차 — 첫 구매 ↔ 주문 완료 겹침 해소: 주문 완료 여정(초안 · 멈춤)에서 첫 구매 고객을 뺀다.
   *   옵션을 바꾸면 서버가 검증 통과를 지우므로 그 여정을 다시 검증한다.
   */
  const excludeFirstPurchase = async (pairKeyValue: string, journeyId: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/ai/operator/journeys/${journeyId}/options`, { method: 'PATCH', headers: headers(), body: JSON.stringify({ exclude_first_purchase: true }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d?.success) { setError(d?.error || '첫 구매 고객을 빼지 못했어요.'); return; }
      setAcks((prev) => new Set(prev).add(pairKeyValue));
      if (selected.has(journeyId)) { const rid = ++runId.current; void validateOne(journeyId, rid); }
    } catch {
      setError('네트워크 오류로 바꾸지 못했어요.');
    }
  };

  const retryWithCallback = (id: string) => {
    setConfirmCb((prev) => new Set(prev).add(id));
    setResults(null);
    setSelected(new Set([id]));
  };

  return (
    <JourneyModalShell open={open} onClose={onClose} labelledBy="jmap-batch-title" panelClassName="w-full max-w-2xl" disableDismiss={running}>
      <div className="flex items-start gap-3 px-5 pt-5 pb-3 border-b border-white/10">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-violet-500 flex items-center justify-center shrink-0">
          <Power className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 id="jmap-batch-title" className="text-sm font-semibold text-white">켜기 전 점검</h2>
          <p className="mt-0.5 text-[11px] text-white/50">받는 여정부터 차례로 켭니다. 켠 뒤에 조건을 새로 만족한 고객부터 보내요(지난 사건으로는 보내지 않아요).</p>
        </div>
        <button type="button" onClick={onClose} disabled={running} className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 disabled:opacity-40" aria-label="닫기">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {results ? (
          <div className="space-y-2">
            {results.map((it) => (
              <div key={it.journeyId} className={`rounded-xl border px-3 py-2.5 flex items-start gap-2.5 ${it.result.ok ? 'border-emerald-400/30 bg-emerald-500/[0.06]' : 'border-rose-400/30 bg-rose-500/[0.06]'}`}>
                {it.result.ok ? <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-300 shrink-0" /> : <XCircle className="w-4 h-4 mt-0.5 text-rose-300 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-white">{it.name || nameOf(it.journeyId)}</div>
                  <p className="mt-0.5 text-[11px] text-white/60">
                    {it.result.ok ? (it.result.firstActivation ? `켰어요 · ${data.costs.activate} 크레딧` : '다시 켰어요') : it.result.message}
                  </p>
                </div>
                {!it.result.ok && it.result.code === 'CALLBACK_CONFIRM_REQUIRED' && (
                  <button type="button" onClick={() => retryWithCallback(it.journeyId)} className="shrink-0 h-7 px-2.5 rounded-lg text-[11px] font-semibold text-white bg-amber-600 hover:bg-amber-500">
                    알고 켜기
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <>
            {candidates.length === 0 && <div className="text-[11px] text-white/45">켤 초안이나 멈춘 여정이 없어요.</div>}
            <div className="space-y-2">
              {candidates.map((c) => {
                const ck = checks[c.id];
                const on = selected.has(c.id);
                return (
                  <div key={c.id} className={`rounded-xl border px-3 py-3 ${on ? 'border-violet-400/30 bg-violet-500/[0.05]' : 'border-white/10 bg-white/[0.02]'}`}>
                    <div className="flex items-center gap-2.5">
                      <input type="checkbox" checked={on} onChange={() => toggle(c.id)} disabled={running} className="w-4 h-4 accent-violet-500" aria-label={`${c.name} 켜기에 넣기`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-white truncate">{c.name}</div>
                        <div className="text-[11px] text-white/45">{c.status === 'draft' ? `초안 · 처음 켜기 ${data.costs.activate} 크레딧` : '멈춤 · 다시 켜기 0 크레딧'} · {c.triggerLabel}</div>
                      </div>
                      {on && (
                        <span className="shrink-0 text-[11px] inline-flex items-center gap-1">
                          {!ck || ck.state === 'checking' ? <><Loader2 className="w-3.5 h-3.5 animate-spin text-violet-300" /><span className="text-white/50">검증 중</span></>
                            : ck.state === 'pass' ? <><CheckCircle2 className="w-3.5 h-3.5 text-emerald-300" /><span className="text-emerald-200">통과</span></>
                              : <><AlertCircle className="w-3.5 h-3.5 text-amber-300" /><span className="text-amber-200">고칠 곳</span></>}
                        </span>
                      )}
                    </div>
                    {on && (
                      <div className="mt-2.5 pl-6 space-y-2">
                        <label className="flex items-center gap-2 text-[11px] text-white/60">
                          <span className="shrink-0">한 번에 보낼 최대 인원</span>
                          <input
                            value={caps[c.id] ?? ''}
                            onChange={(e) => setCaps((prev) => ({ ...prev, [c.id]: e.target.value.replace(/[^0-9]/g, '') }))}
                            inputMode="numeric"
                            placeholder="예: 500"
                            disabled={running}
                            className={`w-28 h-8 px-2 rounded-lg bg-slate-900 border text-xs tabular-nums focus:outline-none focus:border-violet-400 ${capOk(c.id) ? 'border-white/10' : 'border-amber-400/50'}`}
                          />
                          <span className="text-white/35">명</span>
                        </label>
                        {ck?.state === 'pass' && (ck.weeklyCount != null) && (
                          <p className="text-[11px] text-white/45 tabular-nums">7일 예상 {Number(ck.weeklyCount).toLocaleString('ko-KR')}건 · 발송비 약 {Number(ck.weeklyCost || 0).toLocaleString('ko-KR')}원</p>
                        )}
                        {ck?.state === 'fail' && (
                          <div className="space-y-1">
                            {ck.issues.map((m) => <p key={m} className="text-[11px] text-amber-200/90">{m}</p>)}
                            <div className="flex gap-1.5">
                              <button type="button" onClick={() => onEditMessages(c)} className="h-7 px-2.5 rounded-lg text-[11px] font-medium text-violet-100 border border-violet-400/30 hover:bg-violet-500/15">문안 고치기</button>
                              <button type="button" onClick={() => { const rid = ++runId.current; void validateOne(c.id, rid); }} className="h-7 px-2.5 rounded-lg text-[11px] text-white/70 border border-white/15 hover:bg-white/10">다시 검증</button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {pairs.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-xs font-semibold text-white">함께 시작되는 여정</h3>
                {pairs.map((o) => {
                  const k = pairKey(o);
                  return (
                    <div key={k} className="rounded-xl border border-rose-400/30 bg-rose-500/[0.06] px-3 py-2.5">
                      <div className="flex items-center gap-2 text-xs font-semibold text-rose-100">
                        <Users className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{nameOf(o.a)} · {nameOf(o.b)}</span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-rose-100/70">같은 구매 한 번에 두 여정이 함께 시작돼 한 고객이 두 여정의 문자를 모두 받을 수 있어요.</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <button type="button" onClick={() => setAcks((prev) => new Set(prev).add(k))} className={acks.has(k) ? 'h-7 px-2.5 rounded-lg text-[11px] font-semibold bg-rose-500/40 text-white' : 'h-7 px-2.5 rounded-lg text-[11px] text-rose-100 border border-rose-400/30 hover:bg-rose-500/15'}>
                          알고 둘 다 보냄
                        </button>
                        {(() => {
                          const ja = data.journeys.find((j) => j.id === o.a);
                          const jb = data.journeys.find((j) => j.id === o.b);
                          const order = [ja, jb].find((j) => j?.triggerEvent === 'cdp.purchase');
                          const first = [ja, jb].find((j) => j?.triggerEvent === 'purchase.first');
                          if (!order || !first || (order.status !== 'draft' && order.status !== 'paused')) return null;
                          return (
                            <button type="button" onClick={() => void excludeFirstPurchase(k, order.id)} className="h-7 px-2.5 rounded-lg text-[11px] text-violet-100 border border-violet-400/30 hover:bg-violet-500/15">
                              {order.name}에서 첫 구매 고객 빼기
                            </button>
                          );
                        })()}
                        {[o.a, o.b].filter((id) => selected.has(id)).map((id) => (
                          <button key={id} type="button" onClick={() => { toggle(id); setAcks((prev) => { const n = new Set(prev); n.delete(k); return n; }); }} className="h-7 px-2.5 rounded-lg text-[11px] text-white/70 border border-white/15 hover:bg-white/10">
                            {nameOf(id)} 이번엔 켜지 않기
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </section>
            )}
          </>
        )}
        {error && <p className="flex items-start gap-1.5 text-[11px] text-amber-200"><AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />{error}</p>}
      </div>

      <div className="px-5 py-3 border-t border-white/10 flex items-center gap-2">
        {results ? (
          <>
            <span className="flex-1" />
            <button type="button" onClick={onClose} className="h-9 px-4 rounded-lg text-xs font-semibold text-white bg-violet-600 hover:bg-violet-500">닫기</button>
          </>
        ) : (
          <>
            <span className="flex-1 text-[11px] text-white/50 tabular-nums">
              {selectedList.length}개 켜기 · {credit > 0 ? `처음 켜기 ${credit} 크레딧` : '크레딧 0'}
              {!allCaps && selectedList.length > 0 ? ' · 최대 인원을 정해 주세요' : !allPass && selectedList.length > 0 ? ' · 검증을 통과해야 켤 수 있어요' : !allAck ? ' · 함께 시작되는 여정을 골라 주세요' : ''}
            </span>
            <button type="button" onClick={() => void run()} disabled={!ready} className="h-9 px-4 rounded-lg text-xs font-semibold text-white bg-violet-600 hover:bg-violet-500 disabled:opacity-50 inline-flex items-center gap-1.5">
              {running && <Loader2 className="w-4 h-4 animate-spin" />}
              모두 켜기
            </button>
          </>
        )}
      </div>
    </JourneyModalShell>
  );
}
