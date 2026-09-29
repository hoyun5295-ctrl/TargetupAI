/**
 * ProductJourneyModal — 상품 재구매 여정 만들기 (★ 2026-09-30 여정 V2 3차 · 설계서 §6)
 *
 * 상품 고르기(이 회사 현역 문에서 최근 팔린 목록뿐 · 직접 입력 없음) → 사용 기간 확인(같은 상품을 다시 산 간격의 중앙값 + 표본 수 ·
 * 담당자가 확정) → 혜택(선택) → [초안 만들기] = AI 설계 1회(서버 단가) + 서버 초안 저장. 첫 문자는 확정한 사용 기간 뒤에 나간다.
 * 목록 · 간격 계산은 DB 실측이다(AI 0 · 차감 0). 같은 상품을 다시 사면 여정이 끝나고, 다시 사면 새 주기로 처음부터 시작한다.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Package, Search, X } from 'lucide-react';
import JourneyModalShell from '../JourneyModalShell';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (journeyId: string) => void;
}

interface Product { key: string; name: string; buyers: number; orders: number; lastAt: string | null }
interface Catalog { door: 'mall' | 'ledger'; products: Product[]; omittedOrders: number; truncated: boolean; ready: boolean; lockedReason: string | null; costPerJourney: number }
interface Period { medianDays: number | null; sample: number; customers: number }

const MAX_PICK = 30;

function headers(): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` };
}
function newId(): string {
  try { if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID(); } catch { /* 아래 대체 */ }
  const h = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < 32; i++) s += h[Math.floor(Math.random() * 16)];
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-8${s.slice(17, 20)}-${s.slice(20, 32)}`;
}

export default function ProductJourneyModal({ open, onClose, onCreated }: Props) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [period, setPeriod] = useState<Period | null>(null);
  const [periodLoading, setPeriodLoading] = useState(false);
  const [days, setDays] = useState('');
  const [daysTouched, setDaysTouched] = useState(false);
  const [benefit, setBenefit] = useState('');
  const [callbacks, setCallbacks] = useState<Array<{ phone: string; description: string | null; is_default: boolean }>>([]);
  const [callback, setCallback] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(newId());

  useEffect(() => {
    if (!open) return;
    requestId.current = newId();
    setCatalog(null); setLoadError(null); setQ(''); setPicked([]); setPeriod(null); setDays(''); setDaysTouched(false);
    setBenefit(''); setError(null); setCreating(false);
    void (async () => {
      try {
        const [cr, nr] = await Promise.all([
          fetch('/api/ai/operator/journeys-product/catalog', { headers: headers() }),
          fetch('/api/ai/operator/journeys-callback-numbers', { headers: headers() }).catch(() => null),
        ]);
        const cd = await cr.json().catch(() => ({}));
        if (cr.ok && cd?.success) setCatalog(cd as Catalog); else setLoadError(cd?.error || '상품 목록을 불러오지 못했어요.');
        const nd = nr ? await nr.json().catch(() => null) : null;
        const nums = nd?.success && Array.isArray(nd.numbers) ? nd.numbers : [];
        setCallbacks(nums);
        const def = nums.find((n: any) => n.is_default) || (nums.length === 1 ? nums[0] : null);
        setCallback(def ? String(def.phone) : '');
      } catch {
        setLoadError('네트워크 오류로 상품 목록을 불러오지 못했어요.');
      }
    })();
  }, [open]);

  // 고른 상품이 바뀌면 사용 기간 제안을 다시 받는다(0.4초 모아서).
  useEffect(() => {
    if (!open || picked.length === 0) { setPeriod(null); return; }
    setPeriodLoading(true);
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch('/api/ai/operator/journeys-product/period', { method: 'POST', headers: headers(), body: JSON.stringify({ keys: picked }) });
        const d = await res.json().catch(() => ({}));
        if (res.ok && d?.success) {
          setPeriod({ medianDays: d.medianDays ?? null, sample: Number(d.sample || 0), customers: Number(d.customers || 0) });
          if (!daysTouched && d.medianDays) setDays(String(d.medianDays));
        } else setPeriod(null);
      } catch {
        setPeriod(null);
      } finally {
        setPeriodLoading(false);
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [open, picked]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => {
    const list = catalog?.products || [];
    const s = q.trim().toLowerCase();
    return s ? list.filter((p) => p.name.toLowerCase().includes(s) || p.key.toLowerCase().includes(s)) : list;
  }, [catalog, q]);
  const nameOf = (k: string) => catalog?.products.find((p) => p.key === k)?.name || k;

  const toggle = (k: string) => setPicked((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : prev.length >= MAX_PICK ? prev : [...prev, k]));

  const daysNum = Math.floor(Number(days));
  const daysOk = !!days.trim() && Number.isFinite(daysNum) && daysNum >= 1 && daysNum <= 365;
  const needCallback = callbacks.length > 1 && !callbacks.some((c) => c.is_default);
  const canCreate = !!catalog?.ready && !catalog?.lockedReason && picked.length > 0 && daysOk && !creating && callbacks.length > 0 && (!needCallback || !!callback);

  const create = async () => {
    if (!canCreate) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/operator/journeys-product/create', {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ requestId: requestId.current, keys: picked, periodDays: daysNum, benefitText: benefit.trim() || undefined, callbackNumber: callback || undefined }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d?.success) {
        onCreated(String(d.journeyId));
        onClose();
      } else {
        setError(d?.error || '여정을 만들지 못했어요.');
      }
    } catch {
      setError('네트워크 오류로 여정을 만들지 못했어요.');
    } finally {
      setCreating(false);
    }
  };

  const doorLabel = catalog?.door === 'mall' ? '자사몰 주문' : '매장 · ERP 구매';

  return (
    <JourneyModalShell open={open} onClose={onClose} labelledBy="jmap-product-title" panelClassName="w-full max-w-2xl" disableDismiss={creating}>
      <div className="flex items-start gap-3 px-5 pt-5 pb-3 border-b border-white/10">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-teal-500 to-violet-500 flex items-center justify-center shrink-0">
          <Package className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 id="jmap-product-title" className="text-sm font-semibold text-white">상품 재구매 여정 만들기</h2>
          <p className="mt-0.5 text-[11px] text-white/50">고른 상품을 산 고객에게 다 써 갈 때쯤 다시 사도록 권해요. 같은 상품을 다시 사면 여정이 끝나고, 새 주기로 다시 시작합니다.</p>
        </div>
        <button type="button" onClick={onClose} disabled={creating} className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 disabled:opacity-40" aria-label="닫기">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {!catalog && !loadError && <div className="flex items-center gap-2 text-[11px] text-white/50 py-8 justify-center"><Loader2 className="w-4 h-4 animate-spin" />최근 팔린 상품을 모으는 중</div>}
        {loadError && <p className="text-[11px] text-rose-300">{loadError}</p>}
        {catalog && (
          <>
            {catalog.lockedReason && (
              <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2.5 text-[11px] leading-relaxed text-amber-100">{catalog.lockedReason}</div>
            )}
            {!catalog.ready && (
              <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2.5 text-[11px] leading-relaxed text-amber-100">
                상품 재구매 여정을 받을 준비가 아직 안 됐어요(운영자 DB 갱신 대기). 상품과 사용 기간은 미리 볼 수 있어요.
              </div>
            )}
            <section>
              <div className="flex items-baseline gap-2">
                <h3 className="text-xs font-semibold text-white">1. 상품 고르기</h3>
                <span className="text-[11px] text-white/45">{doorLabel} · 최근 180일 · {picked.length}/{MAX_PICK}</span>
              </div>
              {picked.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {picked.map((k) => (
                    <button key={k} type="button" onClick={() => toggle(k)} className="h-7 px-2.5 rounded-lg text-[11px] font-medium bg-teal-500/20 border border-teal-400/40 text-teal-100 inline-flex items-center gap-1">
                      {nameOf(k)} <X className="w-3 h-3" />
                    </button>
                  ))}
                </div>
              )}
              <label className="relative mt-2 block">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/35" aria-hidden />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="상품 이름 · 코드 찾기" aria-label="상품 찾기" className="w-full h-9 pl-8 pr-3 rounded-lg bg-slate-950 border border-white/10 text-xs placeholder-white/30 focus:outline-none focus:border-violet-400" />
              </label>
              <div className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-white/10 divide-y divide-white/5">
                {shown.length === 0 && <div className="px-3 py-4 text-[11px] text-white/40">{catalog.products.length === 0 ? `최근 180일 ${doorLabel}에 상품 정보가 없어요.` : '찾는 상품이 없어요.'}</div>}
                {shown.map((p) => {
                  const on = picked.includes(p.key);
                  return (
                    <label key={p.key} className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer ${on ? 'bg-teal-500/10' : 'hover:bg-white/[0.04]'}`}>
                      <input type="checkbox" checked={on} onChange={() => toggle(p.key)} className="w-4 h-4 accent-teal-500" />
                      <span className="flex-1 min-w-0 text-xs text-white truncate">{p.name}</span>
                      <span className="shrink-0 text-[11px] text-white/45 tabular-nums">구매 고객 {p.buyers.toLocaleString('ko-KR')}명</span>
                    </label>
                  );
                })}
              </div>
              {(catalog.truncated || catalog.omittedOrders > 0) && (
                <p className="mt-1.5 text-[11px] text-white/40">
                  {catalog.truncated ? '많이 팔린 상품부터 300개까지 보여요. ' : ''}
                  {catalog.omittedOrders > 0 ? `상품 목록 없이 들어온 주문 ${catalog.omittedOrders.toLocaleString('ko-KR')}건은 판정에서 빠져요.` : ''}
                </p>
              )}
            </section>

            <section>
              <h3 className="text-xs font-semibold text-white">2. 사용 기간</h3>
              <p className="mt-0.5 text-[11px] text-white/45">산 뒤 이만큼 지나면 첫 문자가 나가요.</p>
              {picked.length === 0 ? (
                <p className="mt-2 text-[11px] text-white/40">상품을 고르면 같은 상품을 다시 산 간격을 계산해요.</p>
              ) : periodLoading ? (
                <p className="mt-2 flex items-center gap-1.5 text-[11px] text-white/50"><Loader2 className="w-3.5 h-3.5 animate-spin" />다시 산 간격을 계산하는 중</p>
              ) : period && period.medianDays ? (
                <p className="mt-2 text-[11px] text-emerald-200/90">같은 상품을 다시 산 간격(가운데 값) {period.medianDays}일 · 표본 {period.sample.toLocaleString('ko-KR')}건 · 고객 {period.customers.toLocaleString('ko-KR')}명</p>
              ) : (
                <p className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-200/90"><AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />다시 산 기록이 적어요(표본 {period?.sample ?? 0}건). 사용 기간을 직접 정해 주세요.</p>
              )}
              <label className="mt-2 flex items-center gap-2 text-[11px] text-white/60">
                <input
                  value={days}
                  onChange={(e) => { setDaysTouched(true); setDays(e.target.value.replace(/[^0-9]/g, '')); }}
                  inputMode="numeric"
                  placeholder="예: 30"
                  aria-label="사용 기간(일)"
                  className={`w-24 h-9 px-3 rounded-lg bg-slate-950 border text-xs tabular-nums focus:outline-none focus:border-violet-400 ${daysOk || !days ? 'border-white/10' : 'border-amber-400/50'}`}
                />
                <span>일 뒤 첫 문자</span>
              </label>
            </section>

            <section>
              <h3 className="text-xs font-semibold text-white">3. 넣을 혜택(선택)</h3>
              <input value={benefit} onChange={(e) => setBenefit(e.target.value)} maxLength={200} placeholder="예: 재구매 10% 쿠폰" aria-label="혜택" className="mt-2 w-full h-9 px-3 rounded-lg bg-slate-950 border border-white/10 text-xs placeholder-white/30 focus:outline-none focus:border-violet-400" />
              <p className="mt-1 text-[11px] text-white/40">비워 두면 혜택 자리를 표시해 두고, 켜기 전에 채우게 해요.</p>
            </section>

            {callbacks.length === 0 && <p className="text-[11px] text-amber-200/90">등록된 회신번호가 없어요. 회신번호를 먼저 등록해 주세요.</p>}
            {needCallback && (
              <section>
                <h3 className="text-xs font-semibold text-white">보낼 번호</h3>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {callbacks.map((c) => (
                    <button key={c.phone} type="button" onClick={() => setCallback(c.phone)} className={callback === c.phone ? 'h-8 px-3 rounded-lg text-xs font-semibold border border-violet-400/60 bg-violet-600/40 text-white' : 'h-8 px-3 rounded-lg text-xs border border-white/15 text-white/70 hover:bg-white/10'}>
                      {c.phone}{c.description ? ` · ${c.description}` : ''}
                    </button>
                  ))}
                </div>
              </section>
            )}
            {error && <p className="flex items-start gap-1.5 text-[11px] text-rose-300"><AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />{error}</p>}
          </>
        )}
      </div>

      <div className="px-5 py-3 border-t border-white/10 flex items-center gap-2">
        <span className="flex-1 text-[11px] text-white/45">
          {creating ? '여정을 설계하는 중(30초 안팎) · 닫지 말아 주세요' : `초안 만들기 ${catalog?.costPerJourney ?? 0} 크레딧 · 켜기 전에는 보내지 않아요`}
        </span>
        <button type="button" onClick={() => void create()} disabled={!canCreate} className="h-9 px-4 rounded-lg text-xs font-semibold text-white bg-violet-600 hover:bg-violet-500 disabled:opacity-50 inline-flex items-center gap-1.5">
          {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          초안 만들기
        </button>
      </div>
    </JourneyModalShell>
  );
}
