/**
 * JourneyAttachModal — 이 여정 뒤에 다른 여정 붙이기(★ 2026-10-20 여정 V.3 §18 · Harold 「기존 여정 뒤에 붙일 방법 · 붙을 수 있는지 점검」)
 *
 * 한 창 = 확인 한 단계: ① 넘길 고객(목표를 이뤄 마친 · 끝까지 받은 · 둘 다 · 막힌 결과는 이유) ② 붙일 여정(붙일 수 있는 것 위 ·
 *   못 붙이는 것은 이유와 함께 흐리게) ③ 고른 여정의 알림 → [붙이기]. 붙인 여정은 들어오는 방식이 바뀌는 갈림길이라 이유를 한 줄로 보인다.
 * ⛔ 판정(막음 · 알림)은 서버 한 함수(journey-attach judgeAttach) · 저장할 때 서버가 잠금 안에서 다시 판정한다(화면 판정으로 붙이지 않는다).
 */
import { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Link2, Loader2, X } from 'lucide-react';
import JourneyModalShell from '../JourneyModalShell';
import { useToast } from '../../ToastProvider';
import { STATUS_META, journeyApiErrorText, type AfterOutcome, type MapJourney } from '../../../utils/journey-map';

interface Candidate { id: string; name: string; status: string; triggerLabel: string; attachedAfterName: string | null; blocks: string[]; warns: string[] }
interface OutcomeOpt { key: AfterOutcome; label: string; available: boolean; reason: string | null; finished30d: number }
interface CandidatesResponse { outcomes: OutcomeOpt[]; candidates: Candidate[]; migrationPending: boolean }

interface Props {
  open: boolean;
  /** 앞 여정(이 여정 뒤에 붙인다). */
  after: Pick<MapJourney, 'id' | 'name' | 'goalExitEnabled'> | null;
  onClose: () => void;
  /** 붙인 여정 id — 페이지가 지도를 다시 읽고 그 카드로 간다. */
  onAttached: (journeyId: string) => void;
}

const PENDING_TEXT = '준비 중이라 아직 붙일 수 없어요. 잠시 뒤 다시 시도해 주세요.';

function authHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` };
}

export default function JourneyAttachModal({ open, after, onClose, onAttached }: Props) {
  const toast = useToast();
  const [outcome, setOutcome] = useState<AfterOutcome>('any');
  const [data, setData] = useState<CandidatesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [blocks, setBlocks] = useState<string[]>([]);
  const seq = useRef(0);

  // 열 때 · 결과를 바꿀 때 서버 판정을 다시 읽는다(늦은 응답은 버린다).
  const reload = async (o: AfterOutcome) => {
    if (!after) return;
    const my = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ai/operator/journeys/${after.id}/attach-candidates?outcome=${o}`, { headers: authHeaders() });
      const d = await res.json().catch(() => ({}));
      if (my !== seq.current) return;
      if (res.ok && d?.success) setData({ outcomes: d.outcomes || [], candidates: d.candidates || [], migrationPending: d.migrationPending === true });
      else setError(journeyApiErrorText(d, '붙일 수 있는 여정을 불러오지 못했어요.'));
    } catch {
      if (my === seq.current) setError('네트워크 오류로 불러오지 못했어요.');
    } finally {
      if (my === seq.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (!open || !after) { seq.current++; return; }
    const first: AfterOutcome = 'any';
    setOutcome(first);
    setData(null);
    setPicked(null);
    setBlocks([]);
    setSaving(false);
    void reload(first);
  }, [open, after?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickOutcome = (o: AfterOutcome) => {
    if (o === outcome || saving) return;
    setOutcome(o);
    setBlocks([]);
    void reload(o);
  };

  const chosen = data?.candidates.find((c) => c.id === picked) || null;
  const canSave = !!chosen && chosen.blocks.length === 0 && !saving && !loading && !error && !data?.migrationPending;   // 다시 읽기 실패 = 옛 판정으로 저장하지 않는다

  const save = async () => {
    if (!after || !chosen || !canSave) return;
    setSaving(true);
    setBlocks([]);
    try {
      const res = await fetch(`/api/ai/operator/journeys/${chosen.id}/attach`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ afterJourneyId: after.id, outcome }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d?.success) {
        toast.success(`「${chosen.name}」를 「${after.name}」 뒤에 붙였어요.`);
        onAttached(chosen.id);
        onClose();
        return;
      }
      setBlocks(Array.isArray(d?.blocks) && d.blocks.length > 0 ? d.blocks : [journeyApiErrorText(d, '붙이지 못했어요.')]);
      void reload(outcome);
    } catch {
      setBlocks(['네트워크 오류로 붙이지 못했어요. 지도를 다시 읽고 확인해 주세요.']);
    } finally {
      setSaving(false);
    }
  };

  return (
    <JourneyModalShell open={open && !!after} onClose={onClose} labelledBy="jattach-title" panelClassName="w-full max-w-2xl" zIndexClassName="z-[70]" disableDismiss={saving}>
      <div className="flex items-start gap-3 border-b border-slate-200 px-5 pb-3 pt-5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-sky-500">
          <Link2 className="h-4 w-4 text-white" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="jattach-title" className="truncate text-[15px] font-semibold text-slate-900">「{after?.name || '여정'}」 뒤에 여정 붙이기</h2>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-slate-500">붙인 여정은 이 여정을 마친 고객만 받아요. 원래 시작은 [앞 여정에서 떼기]로 되돌릴 수 있어요.</p>
        </div>
        <button type="button" onClick={onClose} disabled={saving} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40" aria-label="닫기">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
        {data?.migrationPending && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-900">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{PENDING_TEXT}
          </div>
        )}

        <section aria-labelledby="jattach-outcome">
          <h3 id="jattach-outcome" className="text-[13px] font-semibold text-slate-700">어떤 고객을 넘길까요</h3>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup" aria-labelledby="jattach-outcome">
            {(data?.outcomes || []).map((o) => {
              const on = outcome === o.key;
              return (
                <button key={o.key} type="button" role="radio" aria-checked={on} disabled={!o.available || saving} onClick={() => pickOutcome(o.key)} title={o.reason || undefined}
                  className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${on ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 bg-white hover:border-indigo-200'} disabled:cursor-not-allowed disabled:opacity-50`}>
                  <div className="text-[13px] font-semibold text-slate-900">{o.label}</div>
                  <div className="mt-0.5 text-[12px] tabular-nums text-slate-500">{o.available ? `최근 30일 ${o.finished30d.toLocaleString('ko-KR')}명` : (o.reason || '고를 수 없어요')}</div>
                </button>
              );
            })}
            {!data && loading && <div className="flex items-center gap-2 text-[13px] text-slate-500"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />불러오는 중</div>}
          </div>
        </section>

        <section aria-labelledby="jattach-list">
          <div className="flex items-center gap-2">
            <h3 id="jattach-list" className="text-[13px] font-semibold text-slate-700">어느 여정을 붙일까요</h3>
            {loading && data && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" aria-label="다시 확인 중" />}
          </div>
          {error && <p className="mt-2 text-[13px] text-rose-700">{error}</p>}
          {data && data.candidates.length === 0 && <p className="mt-2 text-[13px] text-slate-500">붙일 수 있는 여정이 없어요. 여정을 먼저 만들어 주세요.</p>}
          <ul className="mt-2 space-y-2">
            {(data?.candidates || []).map((c) => {
              const blocked = c.blocks.length > 0;
              const on = picked === c.id;
              const st = STATUS_META[c.status] || STATUS_META.ended;
              return (
                <li key={c.id}>
                  <button type="button" disabled={blocked || saving} onClick={() => { setPicked(c.id); setBlocks([]); }} aria-pressed={on}
                    className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${on ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 bg-white hover:border-indigo-200'} ${blocked ? 'cursor-not-allowed bg-slate-50 opacity-70 hover:border-slate-200' : ''}`}>
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${st.dot}`} aria-label={st.label} />
                      <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-slate-900">{c.name || '이름 없는 여정'}</span>
                      {on && <CheckCircle2 className="h-4 w-4 shrink-0 text-indigo-600" aria-hidden />}
                    </div>
                    <div className="mt-0.5 truncate pl-4 text-[12px] text-slate-500">
                      {st.label} · 지금 {c.attachedAfterName ? `「${c.attachedAfterName}」 마친 뒤` : `${c.triggerLabel} 때`}
                    </div>
                    {blocked && <div className="mt-1 pl-4 text-[12px] leading-relaxed text-slate-500">{c.blocks[0]}</div>}
                  </button>
                  {on && c.warns.length > 0 && (
                    <ul className="mt-1.5 space-y-1 pl-4">
                      {c.warns.map((w) => (
                        <li key={w} className="flex items-start gap-1.5 text-[12.5px] leading-relaxed text-slate-600">
                          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />{w}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-5 py-3">
        {blocks.length > 0 && <p className="w-full text-[12.5px] leading-relaxed text-rose-700 sm:w-auto sm:flex-1">{blocks[0]}</p>}
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-semibold text-slate-700 hover:border-slate-300 disabled:opacity-40">닫기</button>
          <button type="button" onClick={() => void save()} disabled={!canSave}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 text-[13px] font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Link2 className="h-4 w-4" aria-hidden />}붙이기
          </button>
        </div>
      </div>
    </JourneyModalShell>
  );
}
