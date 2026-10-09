/**
 * JourneyDiagnosisPanel — AI 진단 (★ 2026-10-09 고객 관계 지도 · 설계서 docs/2026-10-09-journey-crm-map-design.md §5)
 *
 * 이 회사 고객이 사는 리듬(구매 원장 실측) → 가입부터 재구매 · 휴면 · 복귀까지 여정 세트 추천 → 1클릭 초안 → 켜기 전 점검.
 *   - 여는 데 AI 0 · 차감 0(GET /operator/journeys-diagnosis · 서버 24시간 캐시는 리듬 사실만).
 *   - 초안 = 서버가 계획을 다시 계산해 만든다(POST /operator/journeys-reco/design · 화면 숫자를 보내지 않는다) · 상품 = 기존 상품 만들기.
 *   - 표본 미달 · 연동 잠금 · 이미 있음은 숨기지 않고 그 상태로 보여 준다. 자동으로 켜지 않는다(만든 뒤 켜기 전 점검으로).
 * ⛔ 성과 약속 숫자 · 지어낸 혜택 0 · 크레딧 합계 20 이상이면 확인 한 단계(크레딧 모달 규칙).
 */
import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, Lock, Package, Sparkles, TrendingUp } from 'lucide-react';
import { useToast } from '../../ToastProvider';

interface FlowPlanItem {
  key: string;
  triggerEvent: string;
  title: string;
  objective: string;
  daysFromStart: number[];
  dormantDays: number | null;
  measured: boolean;
  evidence: string;
  sample: number | null;
  status: 'ready' | 'exists' | 'drafted' | 'locked';
  reason: string;
}
interface ProductCycle { key: string; name: string; buyers: number; medianDays: number; sample: number; status: 'ready' | 'exists' }
interface Diagnosis {
  computedAt: string;
  rhythm: unknown | null;
  facts: Array<{ label: string; value: string }>;
  flowPlan: FlowPlanItem[];
  products: ProductCycle[];
  quote: { draftEach: number; activateEach: number };
  source: string;
}

interface Props {
  open: boolean;
  /** 만든 초안 id 목록 → 페이지가 지도를 다시 읽고 켜기 전 점검을 연다. */
  onDrafted: (journeyIds: string[]) => void;
  /** 만드는 동안 창을 닫지 못하게(닫기 = 취소인데 이미 나간 요청은 되돌릴 수 없다). */
  onBusyChange?: (busy: boolean) => void;
}

const dayLabel = (d: number) => (d === 0 ? '바로' : `D+${d}`);
/**
 * 상품 초안 요청 키(결정적) — 상품 · 주기 **내용만**의 해시(Codex 3R high · 4R medium · 날짜를 넣으면 자정을 넘긴 재시도가 다른 요청).
 *   화면 수명에 묶인 무작위 키는 창 · 페이지를 다시 열 때마다 새로 생겨 결과를 모르는 요청이 다른 요청으로 보였다.
 *   같은 내용 = 같은 키 → 서버 과금 원장(회사별)이 이미 만든 초안을 다시 만들지 않는다. 추천 흐름 초안의 키는 서버가 계산한다.
 *   직접 고르는 상품 창(ProductJourneyModal)은 제 키를 따로 쓴다.
 */
async function productRequestId(key: string, periodDays: number): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`diagnosis-product|${key}|${periodDays}`));
  const h = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export default function JourneyDiagnosisPanel({ open, onDrafted, onBusyChange }: Props) {
  const toast = useToast();
  const [diag, setDiag] = useState<Diagnosis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!open) return;
    setConfirming(false);
    setLoading(true);
    setError(null);
    fetch('/api/ai/operator/journeys-diagnosis', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
      .then((r) => r.json())
      .then((d) => {
        if (!d?.success) throw new Error(d?.error || '진단을 불러오지 못했어요.');
        const dg = d.diagnosis as Diagnosis;
        setDiag(dg);
        setPicked(new Set([
          ...dg.flowPlan.filter((p) => p.status === 'ready').map((p) => `flow:${p.triggerEvent}`),
          ...dg.products.filter((p) => p.status === 'ready').slice(0, 2).map((p) => `product:${p.key}`),
        ]));
      })
      .catch((e) => setError(e?.message || '진단을 불러오지 못했어요.'))
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => { onBusyChange?.(busy); }, [busy]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = useMemo(() => picked.size, [picked]);
  const cost = diag ? total * diag.quote.draftEach : 0;

  const toggle = (k: string) => setPicked((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const run = async () => {
    if (!diag || total === 0) return;
    if (cost >= 20 && !confirming) { setConfirming(true); return; }
    setConfirming(false);
    setBusy(true);
    const made: string[] = [];
    const failed: string[] = [];
    let changed = false;
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` };
    try {
      // 칸마다 통신 예외를 잡는다 — 앞에서 만든(과금된) 초안 목록이 예외 하나로 사라지지 않게. 결과를 모르는 요청은 멈추고 알린다.
      // 본문을 못 읽거나(연결 끊김 · JSON 아닌 프록시 오류) 성공 여부가 확정되지 않으면 = 결과 모름(lost) → 멈춘다(Codex 2R).
      const call = async (url: string, body: unknown): Promise<{ ok: boolean; d: any; lost: boolean }> => {
        try {
          const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
          const d = await res.json();
          if (!d || typeof d.success !== 'boolean') return { ok: false, d: null, lost: true };
          return { ok: res.ok && d.success === true, d, lost: false };
        } catch {
          return { ok: false, d: null, lost: true };
        }
      };
      let stop = false;
      for (const p of diag.flowPlan.filter((x) => picked.has(`flow:${x.triggerEvent}`))) {
        setProgress(`${p.title} 초안을 만드는 중`);
        const r = await call('/api/ai/operator/journeys-reco/design', { triggerEvent: p.triggerEvent, shownDays: p.daysFromStart });
        if (r.ok && r.d.journeyId) { made.push(String(r.d.journeyId)); if (r.d.recalculated) changed = true; continue; }
        failed.push(`${p.title}: ${r.lost ? '연결이 끊겨 결과를 확인하지 못했어요(다시 누르면 같은 요청으로 확인합니다)' : r.d?.error || '만들지 못했어요'}`);
        if (r.lost || r.d?.code === 'INSUFFICIENT_CREDIT') { stop = true; break; }
      }
      for (const pr of stop ? [] : diag.products.filter((x) => picked.has(`product:${x.key}`))) {
        setProgress(`${pr.name} 다시 채우기 초안을 만드는 중`);
        const r = await call('/api/ai/operator/journeys-product/create', { requestId: await productRequestId(pr.key, pr.medianDays), keys: [pr.key], periodDays: pr.medianDays });
        if (r.ok && r.d.journeyId) { made.push(String(r.d.journeyId)); continue; }
        failed.push(`${pr.name}: ${r.lost ? '연결이 끊겨 결과를 확인하지 못했어요(다시 누르면 같은 요청으로 확인합니다)' : r.d?.error || '만들지 못했어요'}`);
        if (r.lost || r.d?.code === 'INSUFFICIENT_CREDIT') break;
      }
    } finally {
      setBusy(false);
      setProgress(null);
    }
    if (failed.length > 0) toast.error(failed.join(' · '));
    if (made.length > 0) {
      toast.success(`초안 ${made.length}개를 만들었어요.${changed ? ' 그사이 실측이 새로 계산되어 간격이 조금 바뀐 초안이 있어요.' : ''} 켜기 전 점검에서 확인하고 켜 주세요.`);
      onDrafted(made);
    }
  };

  if (loading && !diag) {
    return <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-slate-500"><Loader2 className="w-4 h-4 animate-spin" />고객 구매 리듬을 재는 중</div>;
  }
  if (error && !diag) return <div className="py-6 text-center text-[12px] text-rose-700">{error}</div>;
  if (!diag) return null;

  return (
    <section className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/70 via-white to-white p-4">
      <div className="flex items-center gap-2">
        <TrendingUp className="w-4 h-4 text-indigo-600" />
        <h3 className="text-[14px] font-semibold text-slate-900">이 회사 고객이 사는 리듬</h3>
      </div>
      {diag.facts.length > 0 ? (
        <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {diag.facts.map((f) => (
            <div key={f.label} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
              <dt className="text-[11px] text-slate-500">{f.label}</dt>
              <dd className="mt-0.5 text-[13px] font-medium text-slate-900">{f.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-2 text-[12px] text-slate-500">{diag.source}</p>
      )}

      <div className="mt-4 flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-indigo-600" />
        <h3 className="text-[14px] font-semibold text-slate-900">가입부터 다시 오기까지 추천 여정</h3>
      </div>
      <p className="mt-0.5 text-[11px] text-slate-500">시작 사건과 보내는 시점은 위 실측으로 정했어요. AI 는 문안과 이름만 씁니다.</p>
      <ol className="mt-2.5 space-y-2">
        {diag.flowPlan.map((p, i) => {
          const k = `flow:${p.triggerEvent}`;
          const ready = p.status === 'ready';
          return (
            <li key={p.triggerEvent} className={`rounded-xl border px-3 py-2.5 ${ready ? 'border-slate-200 bg-white' : 'border-dashed border-slate-200 bg-slate-50/60'}`}>
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[13px] font-semibold text-slate-900">{p.title}</span>
                    <span className="flex flex-wrap gap-1">
                      {p.daysFromStart.map((d, n) => (
                        <span key={n} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] tabular-nums text-slate-600">{n + 1}통 {dayLabel(d)}</span>
                      ))}
                    </span>
                    {!p.measured && <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800">참고 간격</span>}
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{p.evidence}</p>
                  {!ready && (
                    <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-500">
                      {p.status === 'locked' ? <Lock className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3 text-emerald-600" />}{p.reason}
                    </p>
                  )}
                </div>
                {ready && (
                  <label className="shrink-0 inline-flex items-center gap-1.5 text-[12px] text-slate-700">
                    <input type="checkbox" checked={picked.has(k)} onChange={() => toggle(k)} className="h-4 w-4 rounded border-slate-300" />
                    만들기
                  </label>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {diag.products.length > 0 && (
        <>
          <div className="mt-4 flex items-center gap-2">
            <Package className="w-4 h-4 text-indigo-600" />
            <h3 className="text-[14px] font-semibold text-slate-900">다시 많이 사는 상품</h3>
          </div>
          <ul className="mt-2 space-y-2">
            {diag.products.map((pr) => {
              const k = `product:${pr.key}`;
              return (
                <li key={pr.key} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-slate-900 truncate">{pr.name}</div>
                    <p className="mt-0.5 text-[11px] text-slate-500">보통 {pr.medianDays}일마다 다시 사요({pr.sample.toLocaleString('ko-KR')}건) · 다 쓸 때쯤 알려 주는 여정</p>
                  </div>
                  {pr.status === 'exists'
                    ? <span className="shrink-0 inline-flex items-center gap-1 text-[11px] text-slate-500"><CheckCircle2 className="w-3 h-3 text-emerald-600" />이미 있어요</span>
                    : (
                      <label className="shrink-0 inline-flex items-center gap-1.5 text-[12px] text-slate-700">
                        <input type="checkbox" checked={picked.has(k)} onChange={() => toggle(k)} className="h-4 w-4 rounded border-slate-300" />
                        만들기
                      </label>
                    )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {confirming && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-900">
          초안 {total}개에 {cost.toLocaleString('ko-KR')} 크레딧이 들어요. 만든 뒤에도 켜기 전에는 아무것도 보내지 않아요. 켤 때 여정마다 {diag.quote.activateEach.toLocaleString('ko-KR')} 크레딧이 따로 듭니다.
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="flex-1 text-[11px] text-slate-500">
          {total > 0 ? `고른 ${total}개 · 초안 ${cost.toLocaleString('ko-KR')} 크레딧(여정당 ${diag.quote.draftEach})` : '만들 여정을 골라 주세요.'}
        </span>
        {confirming && <button type="button" onClick={() => setConfirming(false)} className="h-9 px-3 rounded-lg text-[12px] text-slate-600 border border-slate-200 hover:bg-slate-50">취소</button>}
        <button type="button" onClick={() => void run()} disabled={busy || total === 0}
          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg text-[12px] font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {busy ? (progress || '만드는 중') : confirming ? '그대로 만들기' : '추천대로 초안 만들기'}
        </button>
      </div>
      <p className="mt-2 text-[10px] italic text-slate-400">Data source: {diag.source} · {new Date(diag.computedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 계산</p>
    </section>
  );
}
