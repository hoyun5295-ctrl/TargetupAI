/**
 * 상품 · 검색어 반응 구역(★ 2026-11-13 C133 F2 ③ · 설계서 docs/2026-11-13-hanjul-v3-design.md §5-2)
 *
 * 성과리포트 안의 한 구역. 닫힌 회사 · 분류코드로 나뉜 담당자에게는 서버가 닫혔다고 답하고 여기서는 아무것도 그리지 않는다.
 *   - 상품 표 = 최근 30일 조회 · 장바구니 · 구매 · 조회 대비 구매 비율 · 지난 30일 대비(머리글을 눌러 정렬 · 좁은 화면은 카드 1열)
 *   - 검색어 표 = 최근 30일 검색 수 · 검색한 고객 수
 *   - 인앱 메시지 표 = 메시지별 최근 30일 노출 · 클릭 · 클릭률(이미 있는 인앱 통계 응답 그대로 · 응답이 비면 이 보기는 없다)
 *   - 줄 끝 버튼 = 「보고 안 산 고객 n명에게 보내기」 · 「이 말을 찾은 고객 n명에게 보내기」 → 직접발송 창이 그 고객들로 채워진 채 열린다.
 *     인원은 표와 따로 불러온다(표가 먼저 뜬다). 인원을 못 읽었거나 0명이면 버튼을 그리지 않는다. 보낼 때 서버가 지금 다시 센다.
 * 숫자는 서버가 준 값만(지어내지 않는다) · 순위 · 재고를 약속하는 문구 없음.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowUp, ArrowUpDown, MousePointerClick, Search, Send, ShoppingBag } from 'lucide-react';
import ZoneSegmented from '../zone/ZoneSegmented';
import {
  fetchProductInsightLive, fetchProductInsight, fetchAudienceCounts, fetchInappTopMessages, stashAudience,
  sortProducts, buyRate, viewDiff, hasBothDoors, DOOR_LABEL,
  type ProductInsight, type ProductSignal, type ProductSortKey, type AudienceCounts, type InappTopMessage,
} from '../../utils/product-insight';
import { INAPP_TEMPLATE_LABELS } from '../inapp/blockTheme';

type View = 'products' | 'terms' | 'inapp';
const FIRST_ROWS = 20;
const num = (n: number) => n.toLocaleString();
const pct = (r: number | null) => (r === null ? '—' : `${(r * 100).toFixed(1)}%`);

const SORTS: Array<{ key: ProductSortKey; label: string }> = [
  { key: 'views', label: '조회' },
  { key: 'carts', label: '장바구니' },
  { key: 'orders', label: '구매' },
  { key: 'rate', label: '조회 대비 구매' },
  { key: 'diff', label: '지난 30일 대비' },
];

function Diff({ p }: { p: ProductSignal }) {
  const d = viewDiff(p);
  if (p.prevViews === 0 && p.views > 0) return <span className="text-slate-500">새로 보임</span>;
  if (d === 0) return <span className="text-slate-400">같음</span>;
  return (
    <span className={`inline-flex items-center gap-0.5 font-semibold ${d > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
      {d > 0 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
      조회 {num(Math.abs(d))}
    </span>
  );
}

const SEND_BTN = 'inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 hover:bg-slate-700 px-3 h-9 text-[12.5px] font-semibold text-white transition-colors whitespace-nowrap focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300';

export default function ProductSignalSection() {
  const navigate = useNavigate();
  const [live, setLive] = useState(false);
  const [data, setData] = useState<ProductInsight | null>(null);
  const [failed, setFailed] = useState(false);
  const [counts, setCounts] = useState<AudienceCounts | null>(null);
  const [inapp, setInapp] = useState<InappTopMessage[]>([]);
  const [view, setView] = useState<View>('products');
  const [sortKey, setSortKey] = useState<ProductSortKey>('views');
  const [desc, setDesc] = useState(true);
  const [showAll, setShowAll] = useState(false);

  // 불러오기 한 차례 — 열렸는지 → 표 → 인원(표가 먼저 뜬다). 화면을 떠나면 늦은 응답을 반영하지 않는다.
  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!(await fetchProductInsightLive()) || !alive) return;
      setLive(true);
      const got = await fetchProductInsight();
      if (!alive) return;
      if (!got) { setFailed(true); return; }
      setData(got);
      void fetchInappTopMessages().then((m) => { if (alive) setInapp(m); });
      const keys = got.products.filter((p) => p.door === 'mall' && p.views > 0).map((p) => p.key);
      const terms = got.terms.filter((t) => t.customers > 0).map((t) => t.term);
      if (keys.length === 0 && terms.length === 0) return;
      const c = await fetchAudienceCounts(keys, terms);
      if (alive) setCounts(c);
    })();
    return () => { alive = false; };
  }, []);

  const sorted = useMemo(() => (data ? sortProducts(data.products, sortKey, desc) : []), [data, sortKey, desc]);
  const bothDoors = useMemo(() => (data ? hasBothDoors(data.products) : false), [data]);

  if (!live) return null;

  const frame = 'rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.06)]';
  if (failed) {
    return <div className={frame}><p className="text-[13px] text-slate-500">상품 반응을 불러오지 못했어요. 「다시 읽기」를 눌러 주세요.</p></div>;
  }
  if (!data) {
    return <div className={`${frame} h-40 animate-pulse`} aria-label="상품 반응 불러오는 중" />;
  }

  const send = (kind: 'product' | 'search', value: string, label: string, seen: number) => {
    stashAudience({ kind, value, label, seen });
    navigate('/dashboard?open=direct-send');
  };
  const onSort = (key: ProductSortKey) => {
    if (key === sortKey) setDesc((d) => !d);
    else { setSortKey(key); setDesc(true); }
  };
  const productBtn = (p: ProductSignal) => {
    const n = p.door === 'mall' ? counts?.products[p.key] ?? 0 : 0;
    if (n <= 0) return null;
    return (
      <button type="button" className={SEND_BTN} onClick={() => send('product', p.key, p.name, n)}>
        <Send className="w-3.5 h-3.5" />보고 안 산 고객 {num(n)}명에게 보내기
      </button>
    );
  };
  const termBtn = (term: string) => {
    const n = counts?.terms[term] ?? 0;
    if (n <= 0) return null;
    return (
      <button type="button" className={SEND_BTN} onClick={() => send('search', term, term, n)}>
        <Send className="w-3.5 h-3.5" />이 말을 찾은 고객 {num(n)}명에게 보내기
      </button>
    );
  };
  const rows = showAll ? sorted : sorted.slice(0, FIRST_ROWS);
  const empty = !data.hasSignals && data.terms.length === 0 && inapp.length === 0;
  // 인앱 응답이 늦게 비어 오면 그 보기에 머물지 않는다
  const shown: View = view === 'inapp' && inapp.length === 0 ? 'products' : view;

  return (
    <section className={frame} aria-labelledby="product-signal-title">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 id="product-signal-title" className="text-[15px] font-bold text-slate-900">상품 · 검색어 반응</h3>
          <p className="mt-0.5 text-[12px] text-slate-500 break-keep">최근 {data.windowDays}일 · 조회와 검색은 자사몰 · 구매는 자사몰과 매장</p>
        </div>
        {!empty && (
          <ZoneSegmented<View>
            ariaLabel="보기"
            value={shown}
            onChange={setView}
            items={[
              { id: 'products', label: '상품', icon: ShoppingBag, count: data.products.length },
              { id: 'terms', label: '검색어', icon: Search, count: data.terms.length },
              ...(inapp.length > 0 ? [{ id: 'inapp' as const, label: '인앱 메시지', icon: MousePointerClick, count: inapp.length }] : []),
            ]}
          />
        )}
      </div>

      {empty ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 px-4 py-5">
          <p className="text-[13px] text-slate-600 break-keep">자사몰 연결 뒤 상품 조회가 들어오면 여기에 보여요.</p>
          <button type="button" onClick={() => navigate('/cdp-settings')}
            className="rounded-lg bg-white border border-slate-300 px-3 h-9 text-[12.5px] font-semibold text-slate-800 hover:bg-slate-100 transition-colors">
            자사몰 연결 보기
          </button>
        </div>
      ) : shown === 'inapp' ? (
        <>
          <div className="mt-3 hidden md:block overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[12px] text-slate-500">
                  <th scope="col" className="py-2 pr-3 font-semibold">메시지</th>
                  <th scope="col" className="py-2 px-2 font-semibold">자리</th>
                  <th scope="col" className="py-2 px-2 font-semibold text-right">노출</th>
                  <th scope="col" className="py-2 px-2 font-semibold text-right">클릭</th>
                  <th scope="col" className="py-2 pl-2 font-semibold text-right">클릭률</th>
                </tr>
              </thead>
              <tbody>
                {inapp.map((m) => (
                  <tr key={m.messageId} className="border-b border-slate-100 last:border-0">
                    <td className="py-2.5 pr-3 font-semibold text-slate-900 break-keep">{m.title || '제목 없음'}</td>
                    <td className="py-2.5 px-2 text-slate-600 whitespace-nowrap">{INAPP_TEMPLATE_LABELS[m.template] || '인앱'}</td>
                    <td className="py-2.5 px-2 text-right tabular-nums">{num(m.impressions)}</td>
                    <td className="py-2.5 px-2 text-right tabular-nums">{num(m.clicks)}</td>
                    <td className="py-2.5 pl-2 text-right tabular-nums font-semibold text-slate-900">{pct(m.ctr)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="mt-3 md:hidden space-y-2">
            {inapp.map((m) => (
              <li key={m.messageId} className="rounded-xl border border-slate-200 p-3">
                <div className="font-semibold text-[14px] text-slate-900 break-keep">{m.title || '제목 없음'}</div>
                <div className="mt-1 text-[12px] text-slate-600">
                  {INAPP_TEMPLATE_LABELS[m.template] || '인앱'} · 노출 {num(m.impressions)} · 클릭 {num(m.clicks)} · 클릭률 {pct(m.ctr)}
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-slate-400">최근 30일 · 노출 10회 이상인 메시지 · 클릭률 높은 순</p>
        </>
      ) : shown === 'products' ? (
        data.products.length === 0 ? (
          <p className="mt-4 rounded-xl bg-slate-50 px-4 py-5 text-[13px] text-slate-600">최근 {data.windowDays}일에 조회 · 구매된 상품이 없어요.</p>
        ) : (
          <>
            {/* 넓은 화면 = 표(머리글을 눌러 정렬) */}
            <div className="mt-3 hidden md:block overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-[12px] text-slate-500">
                    <th scope="col" className="py-2 pr-3 font-semibold">상품</th>
                    {SORTS.map((s) => (
                      <th key={s.key} scope="col" className="py-2 px-2 font-semibold text-right whitespace-nowrap"
                        aria-sort={sortKey === s.key ? (desc ? 'descending' : 'ascending') : 'none'}>
                        <button type="button" onClick={() => onSort(s.key)}
                          className={`inline-flex items-center gap-1 hover:text-slate-900 transition-colors ${sortKey === s.key ? 'text-slate-900' : ''}`}>
                          {s.label}
                          {sortKey === s.key ? (desc ? <ArrowDown className="w-3 h-3" /> : <ArrowUp className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                        </button>
                      </th>
                    ))}
                    <th scope="col" className="py-2 pl-3 font-semibold text-right">바로 보내기</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={`${p.door}:${p.key}`} className="border-b border-slate-100 last:border-0">
                      <td className="py-2.5 pr-3 max-w-[280px]">
                        <span className="font-semibold text-slate-900 break-keep">{p.name}</span>
                        {bothDoors && <span className="ml-1.5 text-[11px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 whitespace-nowrap">{DOOR_LABEL[p.door]}</span>}
                      </td>
                      <td className="py-2.5 px-2 text-right tabular-nums">{p.door === 'mall' ? num(p.views) : '—'}</td>
                      <td className="py-2.5 px-2 text-right tabular-nums">{p.door === 'mall' ? num(p.carts) : '—'}</td>
                      <td className="py-2.5 px-2 text-right tabular-nums font-semibold text-slate-900">{num(p.orders)}</td>
                      <td className="py-2.5 px-2 text-right tabular-nums">{pct(buyRate(p))}</td>
                      <td className="py-2.5 px-2 text-right text-[12px] whitespace-nowrap">{p.door === 'mall' ? <Diff p={p} /> : <span className="text-slate-400">—</span>}</td>
                      <td className="py-2 pl-3 text-right">{productBtn(p)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* 좁은 화면 = 카드 1열 */}
            <ul className="mt-3 md:hidden space-y-2">
              {rows.map((p) => (
                <li key={`${p.door}:${p.key}`} className="rounded-xl border border-slate-200 p-3">
                  <div className="font-semibold text-[14px] text-slate-900 break-keep">
                    {p.name}
                    {bothDoors && <span className="ml-1.5 text-[11px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-normal">{DOOR_LABEL[p.door]}</span>}
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                    <div><div className="text-[11px] text-slate-500">조회</div><div className="text-[14px] font-semibold tabular-nums">{p.door === 'mall' ? num(p.views) : '—'}</div></div>
                    <div><div className="text-[11px] text-slate-500">장바구니</div><div className="text-[14px] font-semibold tabular-nums">{p.door === 'mall' ? num(p.carts) : '—'}</div></div>
                    <div><div className="text-[11px] text-slate-500">구매</div><div className="text-[14px] font-semibold tabular-nums">{num(p.orders)}</div></div>
                  </div>
                  {p.door === 'mall' && (
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-slate-600">
                      <span>조회 대비 구매 {pct(buyRate(p))}</span>
                      <span>지난 30일 대비 <Diff p={p} /></span>
                    </div>
                  )}
                  {productBtn(p) && <div className="mt-2.5 flex">{productBtn(p)}</div>}
                </li>
              ))}
            </ul>
            {sorted.length > FIRST_ROWS && (
              <div className="mt-3 flex justify-center">
                <button type="button" onClick={() => setShowAll((v) => !v)}
                  className="rounded-lg border border-slate-300 px-4 h-9 text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
                  {showAll ? '위 20개만 보기' : `나머지 ${num(sorted.length - FIRST_ROWS)}개 더 보기`}
                </button>
              </div>
            )}
          </>
        )
      ) : data.terms.length === 0 ? (
        <p className="mt-4 rounded-xl bg-slate-50 px-4 py-5 text-[13px] text-slate-600">최근 {data.windowDays}일에 들어온 검색어가 없어요.</p>
      ) : (
        <>
          <div className="mt-3 hidden md:block overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[12px] text-slate-500">
                  <th scope="col" className="py-2 pr-3 font-semibold">검색어</th>
                  <th scope="col" className="py-2 px-2 font-semibold text-right">검색 수</th>
                  <th scope="col" className="py-2 px-2 font-semibold text-right">검색한 고객</th>
                  <th scope="col" className="py-2 pl-3 font-semibold text-right">바로 보내기</th>
                </tr>
              </thead>
              <tbody>
                {data.terms.map((t) => (
                  <tr key={t.term} className="border-b border-slate-100 last:border-0">
                    <td className="py-2.5 pr-3 font-semibold text-slate-900 break-all">{t.term}</td>
                    <td className="py-2.5 px-2 text-right tabular-nums">{num(t.searches)}</td>
                    <td className="py-2.5 px-2 text-right tabular-nums">{num(t.customers)}명</td>
                    <td className="py-2 pl-3 text-right">{termBtn(t.term)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="mt-3 md:hidden space-y-2">
            {data.terms.map((t) => (
              <li key={t.term} className="rounded-xl border border-slate-200 p-3">
                <div className="font-semibold text-[14px] text-slate-900 break-all">{t.term}</div>
                <div className="mt-1 text-[12px] text-slate-600">검색 {num(t.searches)}번 · 검색한 고객 {num(t.customers)}명</div>
                {termBtn(t.term) && <div className="mt-2.5 flex">{termBtn(t.term)}</div>}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
