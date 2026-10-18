/**
 * PlannerAudiencePicker — 판2 「대상 상품 · 언제 산 고객」(★ 2026-10-18 v2 입력 축 · 설계서 docs/2026-10-18-planner-v2-design.md §3-6)
 *
 * 목록 = 그 회사 지금 들어오는 곳(자사몰 결제 주문 / 매장 원장)의 최근 180일 관측 상품(서버 · 여정과 같은 함수) · 직접 입력 없음.
 * 한 줄에서 읽은 낱말(「기초」)이 이름에 든 상품을 위로 올리기만 한다 · **미리 체크 0** · 최대 30개(넘으면 거절 · 잘라내지 않음).
 * 「언제 산」 = [최근 90일][6개월][1년][기록 전체] 필수 · 기본값 없음(한 줄의 「모두」는 [기록 전체]에 표시만).
 * 인원 = 실행과 같은 문(서버 /audience/count · 문자 · 메일 · 받을 수 있는 분만).
 * ⛔ 숫자는 서버가 센 값만 · 모델명 0 · native dialog 0 · 줄표 0.
 */
import { useEffect, useMemo, useState } from 'react';
import { Check, LoaderCircle, Search, TriangleAlert } from 'lucide-react';
import { plannerApi, won, type AudienceCountState, type ObservedProduct, type PlannerAudience } from './planner-api';

export const PLANNER_AUDIENCE_KEYS_MAX = 30;
/** 0 = 기록 전체 */
export type SinceDays = 90 | 180 | 365 | 0;
const SINCE_CHIPS: Array<{ days: SinceDays; label: string }> = [
  { days: 90, label: '최근 90일' }, { days: 180, label: '6개월' }, { days: 365, label: '1년' }, { days: 0, label: '기록 전체' },
];

/** kept = 고치기 창이 연 저장값의 날짜(칩을 다시 누르지 않으면 그대로 · 다시 입력 요구 0) */
export interface BuyerDraft { door: 'mall' | 'ledger' | null; keys: string[]; names: string[]; sinceDays: SinceDays | null; kept?: { since: string | null } }

/** (순수) KST 오늘에서 N일 전 'YYYY-MM-DD' · 0 = null(기록 전체) */
export function sinceDateOf(days: SinceDays, now: Date = new Date()): string | null {
  if (days === 0) return null;
  const kst = new Date(now.getTime() + 9 * 3600 * 1000);
  kst.setUTCDate(kst.getUTCDate() - days);
  return kst.toISOString().slice(0, 10);
}

/** (순수) 저장할 받는 사람 — 다 고르지 않았으면 null */
export function buyerAudienceOf(d: BuyerDraft, now: Date = new Date()): PlannerAudience | null {
  if (!d.door || d.keys.length === 0 || (d.sinceDays === null && !d.kept)) return null;
  return { kind: 'product_buyers', door: d.door, keys: d.keys, names: d.names, since: d.sinceDays !== null ? sinceDateOf(d.sinceDays, now) : d.kept!.since };
}

export default function PlannerAudiencePicker({ value, onChange, terms, allTimeHint, eventId, disabled }: {
  value: BuyerDraft;
  onChange: (v: BuyerDraft) => void;
  /** 한 줄에서 읽은 상품 낱말(위로 올리기만) */
  terms: string[];
  /** 한 줄에 「모두」라고 적었다 → [기록 전체]에 표시만 */
  allTimeHint: boolean;
  eventId: string | null;
  disabled?: boolean;
}) {
  const [list, setList] = useState<{ door: 'mall' | 'ledger'; products: ObservedProduct[]; omittedOrders: number; truncated: boolean } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [count, setCount] = useState<{ sms: AudienceCountState; email: AudienceCountState } | 'loading' | null>(null);
  const [limitNote, setLimitNote] = useState(false);

  useEffect(() => {
    let alive = true;
    void plannerApi<{ door: 'mall' | 'ledger'; products: ObservedProduct[]; omittedOrders: number; truncated: boolean }>('/api/marketing-planner/audience/products').then((r) => {
      if (!alive) return;
      if (!r.ok) { setLoadError(r.data?.error || '상품 목록을 불러오지 못했어요.'); return; }
      setList(r.data);
      // 들어오는 곳이 바뀌었으면(저장한 키 = 옛 문의 키) 고른 상품을 비운다 · 처음이면 문을 정한다
      if (value.door && value.door !== r.data.door && value.keys.length > 0) onChange({ ...value, door: r.data.door, keys: [], names: [] });
      else if (value.door !== r.data.door) onChange({ ...value, door: r.data.door });
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = useMemo(() => {
    if (!list) return [];
    const needle = q.trim().toLowerCase();
    const hit = (p: ObservedProduct) => terms.some((t) => t && p.name.toLowerCase().includes(t.toLowerCase()));
    return list.products
      .filter((p) => !needle || p.name.toLowerCase().includes(needle))
      .map((p) => ({ p, hit: hit(p) }))
      .sort((a, b) => Number(b.hit) - Number(a.hit));
  }, [list, q, terms]);
  const termHits = shown.filter((x) => x.hit).length;

  // 인원 — 다 고르면 서버가 센다(실행과 같은 문)
  const audience = buyerAudienceOf(value);
  const audienceKey = JSON.stringify(audience);
  useEffect(() => {
    if (!audience) { setCount(null); return; }
    let alive = true;
    setCount('loading');
    const t = setTimeout(async () => {
      const r = await plannerApi<{ sms: AudienceCountState; email: AudienceCountState }>('/api/marketing-planner/audience/count', { body: { audience, ...(eventId ? { eventId } : {}) } });
      if (!alive) return;
      setCount(r.ok ? r.data : { sms: { state: 'error', count: null, reason: r.data?.error }, email: { state: 'error', count: null } });
    }, 400);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audienceKey, eventId]);

  const toggle = (p: ObservedProduct) => {
    if (disabled) return;
    const on = value.keys.includes(p.key);
    if (!on && value.keys.length >= PLANNER_AUDIENCE_KEYS_MAX) { setLimitNote(true); return; }
    setLimitNote(false);
    onChange(on
      ? { ...value, keys: value.keys.filter((k) => k !== p.key), names: value.names.filter((_, i) => value.keys[i] !== p.key) }
      : { ...value, keys: [...value.keys, p.key], names: [...value.names, p.name] });
  };
  const countText = (c: AudienceCountState) => (c.state === 'known' ? `${won(c.count || 0)}명` : c.state === 'blocked' ? '정할 수 없어요' : '확인 중 문제');

  return (
    <div className={`space-y-3 ${disabled ? 'opacity-60 pointer-events-none' : ''}`}>
      <div>
        <p className="text-[12.5px] font-semibold text-slate-700">대상 상품<span className="ml-1.5 font-normal text-slate-500">이 상품을 산 고객에게 보내요 · 최대 {PLANNER_AUDIENCE_KEYS_MAX}개</span></p>
        {loadError ? <p className="mt-1.5 text-[12.5px] text-rose-700">{loadError}</p> : !list ? (
          <div className="mt-1.5 h-24 rounded-xl bg-slate-100 animate-pulse" aria-hidden="true" />
        ) : list.products.length === 0 ? (
          <p className="mt-1.5 text-[12.5px] text-amber-800">최근 180일에 팔린 상품 기록이 없어요. 전체 고객으로 담아 주세요.</p>
        ) : (
          <>
            <div className="mt-1.5 relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input value={q} onChange={(e) => setQ(e.target.value.slice(0, 40))} placeholder="상품 이름으로 찾기" aria-label="상품 이름으로 찾기"
                className="w-full h-10 pl-9 pr-3 rounded-xl bg-white border border-slate-300 text-[13.5px] outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            {terms.length > 0 && (
              <p className="mt-1.5 text-[12px] text-slate-500">{termHits > 0 ? `이름에 ${terms.map((t) => `「${t}」`).join(' ')}가 든 상품 ${termHits}개를 위에 두었어요` : `이름에 ${terms.map((t) => `「${t}」`).join(' ')}가 든 상품이 없어요. 아래에서 골라 주세요`}</p>
            )}
            <ul className="mt-1.5 max-h-60 overflow-y-auto rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
              {shown.slice(0, 120).map(({ p, hit }) => {
                const on = value.keys.includes(p.key);
                return (
                  <li key={p.key}>
                    <button type="button" role="checkbox" aria-checked={on} onClick={() => toggle(p)}
                      className={`w-full px-3 py-2.5 flex items-center gap-2.5 text-left hover:bg-slate-50 ${on ? 'bg-indigo-50/60' : ''}`}>
                      <span className={`w-5 h-5 rounded-[6px] grid place-items-center shrink-0 ${on ? 'bg-indigo-600 text-white' : 'border border-slate-300 bg-white'}`}>{on && <Check className="w-[13px] h-[13px]" />}</span>
                      <span className={`min-w-0 flex-1 text-[13.5px] truncate ${hit ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>{p.name}</span>
                      <span className="text-[12px] text-slate-500 tabular-nums whitespace-nowrap">{won(p.buyers)}명 구매</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="mt-1.5 text-[12px] text-slate-500 tabular-nums">고른 상품 {value.keys.length}개{list.truncated ? ' · 많이 팔린 300개까지 보여요' : ''}{list.omittedOrders > 0 ? ` · 상품 목록 없이 들어온 주문 ${won(list.omittedOrders)}건은 빠져요` : ''}</p>
            {limitNote && <p className="mt-1 text-[12px] text-amber-800">상품은 {PLANNER_AUDIENCE_KEYS_MAX}개까지 고를 수 있어요.</p>}
          </>
        )}
      </div>
      <div>
        <p className="text-[12.5px] font-semibold text-slate-700">언제 산 고객인가요<span className="ml-1.5 text-[11px] font-semibold text-amber-800 border border-amber-200 bg-amber-50 rounded-md px-1.5 py-px">꼭</span></p>
        <div className="mt-1.5 flex flex-wrap gap-1.5" role="radiogroup" aria-label="언제 산 고객">
          {SINCE_CHIPS.map((c) => {
            const on = value.sinceDays === c.days;
            return (
              <button key={c.days} type="button" role="radio" aria-checked={on} onClick={() => onChange({ ...value, sinceDays: c.days })}
                className={`h-9 px-3 rounded-lg border text-[12.5px] font-semibold inline-flex items-center gap-1 ${on ? 'border-indigo-300 bg-indigo-50 text-indigo-900' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}>
                {on && <Check className="w-[13px] h-[13px]" />}{c.label}
                {c.days === 0 && allTimeHint && !on && <span className="text-[11px] font-normal text-violet-700">· 한 줄에 「모두」</span>}
              </button>
            );
          })}
        </div>
        {value.sinceDays !== null && value.sinceDays !== 0 && <p className="mt-1 text-[12px] text-slate-500 tabular-nums">{sinceDateOf(value.sinceDays)} 이후 산 고객</p>}
        {value.sinceDays === null && value.kept && <p className="mt-1 text-[12px] text-slate-500 tabular-nums">저장한 기간 그대로 · {value.kept.since ? `${value.kept.since} 이후 산 고객` : '기록 전체'}</p>}
      </div>
      {list && (
        <p className="text-[12px] text-slate-600">{list.door === 'mall' ? '자사몰 결제 주문 기준이에요 · 매장 구매는 들어가지 않아요' : '매장 구매 기록 기준이에요 · 자사몰 주문은 들어가지 않아요'}</p>
      )}
      {count && (
        <div className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-[13px] tabular-nums" role="status" aria-live="polite">
          {count === 'loading' ? <span className="inline-flex items-center gap-1.5 text-slate-500"><LoaderCircle className="w-4 h-4 animate-spin" />받는 사람을 세는 중이에요</span> : (
            <>
              <p>보낼 수 있는 분 · 문자 <b>{countText(count.sms)}</b> · 메일 <b>{countText(count.email)}</b></p>
              <p className="text-[12px] text-slate-500 mt-0.5">수신거부를 뺀 받을 수 있는 분만 셌어요</p>
              {(count.sms.state !== 'known' && count.sms.reason) && <p className="mt-1 text-[12px] text-amber-800 inline-flex items-start gap-1"><TriangleAlert className="w-3.5 h-3.5 mt-0.5 shrink-0" />{count.sms.reason}</p>}
            </>
          )}
        </div>
      )}
      <p className="text-[10px] text-slate-500 italic">Data source: 최근 180일 구매 기록(결제된 주문) · 인원은 발송과 같은 조건으로 센 실조회입니다.</p>
    </div>
  );
}
