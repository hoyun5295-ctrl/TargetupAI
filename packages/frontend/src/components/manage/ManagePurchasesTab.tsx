import { useState, useEffect } from 'react';
import { customersApi, manageUsersApi } from '../../api/client';
import PurchaseHistoryModal from './PurchaseHistoryModal';

// 구매 통합조회 — 전 고객 구매 원장(가) + 고객/매장별 기간 합계 요약(나)를 한 화면에서.
// 기간: 일 / 월 / 년 / 직접범위. 각 행 [상세] → 기존 고객별 구매 이력 모달 재사용.

type Mode = 'ledger' | 'summary';
type GroupBy = 'customer' | 'store';
type Gran = 'day' | 'month' | 'year' | 'custom';

interface UserOption { id: string; name: string; login_id: string; department: string; }
interface OverviewData {
  mode: Mode;
  groupBy: GroupBy;
  summary: { totalCount: number; totalAmount: number; customerCount: number; avgOrder: number };
  rows: any[];
  pagination: { total: number; page: number; limit: number; totalPages: number };
}

const pad = (n: number) => String(n).padStart(2, '0');
const toYmd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const won = (v: any) => Number(v || 0).toLocaleString() + '원';

// from 포함 ~ to 미포함 (YYYY-MM-DD). label = 화면 표기.
function periodRange(gran: Gran, anchor: Date, customFrom: string, customTo: string) {
  const y = anchor.getFullYear(); const m = anchor.getMonth(); const d = anchor.getDate();
  if (gran === 'day') {
    return { from: toYmd(new Date(y, m, d)), to: toYmd(new Date(y, m, d + 1)), label: toYmd(new Date(y, m, d)) };
  }
  if (gran === 'month') {
    return { from: toYmd(new Date(y, m, 1)), to: toYmd(new Date(y, m + 1, 1)), label: `${y}년 ${m + 1}월` };
  }
  if (gran === 'year') {
    return { from: toYmd(new Date(y, 0, 1)), to: toYmd(new Date(y + 1, 0, 1)), label: `${y}년` };
  }
  if (customFrom && customTo) {
    const toD = new Date(customTo); toD.setDate(toD.getDate() + 1);
    return { from: customFrom, to: toYmd(toD), label: `${customFrom} ~ ${customTo}` };
  }
  return { from: '', to: '', label: '전체 기간' };
}

function stepAnchor(gran: Gran, anchor: Date, dir: number): Date {
  const y = anchor.getFullYear(); const m = anchor.getMonth(); const d = anchor.getDate();
  if (gran === 'day') return new Date(y, m, d + dir);
  if (gran === 'month') return new Date(y, m + dir, 1);
  if (gran === 'year') return new Date(y + dir, 0, 1);
  return anchor;
}

function Seg({ options, value, onChange }: { options: { key: string; label: string }[]; value: string; onChange: (k: any) => void }) {
  return (
    <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
      {options.map(o => (
        <button key={o.key} onClick={() => onChange(o.key)}
          className={`px-3 py-1.5 rounded-md text-sm font-semibold transition ${
            value === o.key ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function GradeBadge({ grade }: { grade: string }) {
  if (!grade) return <span className="text-slate-400">-</span>;
  const g = grade.toUpperCase();
  const cls = g === 'VIP' ? 'bg-amber-100 text-amber-700' : g === 'GOLD' ? 'bg-yellow-100 text-yellow-700' : 'bg-slate-100 text-slate-600';
  return <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${cls}`}>{grade}</span>;
}

export default function ManagePurchasesTab() {
  const [mode, setMode] = useState<Mode>('ledger');
  const [groupBy, setGroupBy] = useState<GroupBy>('customer');
  const [gran, setGran] = useState<Gran>('month');
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [search, setSearch] = useState('');
  const [storeCode, setStoreCode] = useState('');       // 원장에서 특정 매장만 (매장 요약 → 원장 보기)
  const [storeLabel, setStoreLabel] = useState('');

  const [users, setUsers] = useState<UserOption[]>([]);
  const [filterUserId, setFilterUserId] = useState('');

  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [detail, setDetail] = useState<{ id: string; name: string; phone: string } | null>(null);

  const period = periodRange(gran, anchor, customFrom, customTo);

  const runQuery = async (pageArg: number) => {
    const { from, to } = periodRange(gran, anchor, customFrom, customTo);
    setLoading(true);
    try {
      const params: any = { mode, page: pageArg, limit: 25 };
      if (mode === 'summary') params.groupBy = groupBy;
      if (from) params.from = from;
      if (to) params.to = to;
      if (search.trim()) params.search = search.trim();
      if (filterUserId) params.filterUserId = filterUserId;
      if (mode === 'ledger' && storeCode) params.storeCode = storeCode;
      const res = await customersApi.purchaseOverview(params);
      setData(res.data);
      setPage(pageArg);
    } catch (e: any) {
      setToast({ msg: e.response?.data?.error || '구매 통합조회 실패', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  // 사용자 목록 (관리자용 필터)
  useEffect(() => {
    (async () => {
      try {
        const res = await manageUsersApi.list();
        const list = (res.data.users || res.data || []).map((u: any) => ({
          id: u.id, name: u.name, login_id: u.login_id || u.loginId, department: u.department || '',
        }));
        setUsers(list);
      } catch { /* 필터는 선택 기능 — 실패해도 조회는 동작 */ }
    })();
  }, []);

  // 필터(기간·모드·그룹·사용자·매장) 변경 시 1페이지부터 재조회
  useEffect(() => {
    runQuery(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, groupBy, gran, anchor, customFrom, customTo, filterUserId, storeCode]);

  // 토스트 자동 소멸 (render 본문 setTimeout 대신 effect로)
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const handleSearch = () => runQuery(1);
  const clearStore = () => { setStoreCode(''); setStoreLabel(''); };
  const openStoreLedger = (row: any) => {
    setStoreCode(row.store_code || '');
    setStoreLabel(row.store_label || row.store_code || '(미지정)');
    setMode('ledger');
  };
  const openDetail = (row: any) =>
    setDetail({ id: row.customer_id, name: row.customer_name || '-', phone: row.customer_phone || '-' });

  const s = data?.summary;
  const rows = data?.rows || [];
  const pg = data?.pagination || { total: 0, page: 1, limit: 25, totalPages: 0 };
  const isLedger = mode === 'ledger';
  const isStore = mode === 'summary' && groupBy === 'store';

  return (
    <div className="space-y-4">
      {/* 상단 바 */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                <path d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
              </svg>
            </span>
            <div>
              <h2 className="text-lg font-bold text-slate-900 tracking-tight">구매 통합조회</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {period.label} · 총 매출 <span className="font-semibold text-slate-600 tabular-nums">{won(s?.totalAmount)}</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {users.length >= 1 && (
              <select value={filterUserId} onChange={(e) => setFilterUserId(e.target.value)}
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 bg-white focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10 outline-none transition">
                <option value="">전체 사용자</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.name} ({u.login_id}){u.department ? ` - ${u.department}` : ''}</option>
                ))}
              </select>
            )}
            <div className="relative">
              <input type="text" value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
                placeholder="고객 이름 또는 전화번호"
                className="pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 w-56 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10 outline-none transition" />
              <svg className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <button onClick={handleSearch}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 shadow-sm shadow-indigo-600/20 transition">
              조회
            </button>
          </div>
        </div>
      </div>

      {/* 컨트롤: 기간 + 뷰 */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
        <div className="flex flex-col gap-3">
          {/* 기간 */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs font-semibold text-slate-400 w-10">기간</span>
            <Seg
              options={[{ key: 'day', label: '일' }, { key: 'month', label: '월' }, { key: 'year', label: '년' }, { key: 'custom', label: '직접' }]}
              value={gran} onChange={(k) => setGran(k)} />
            {gran !== 'custom' ? (
              <div className="inline-flex items-center gap-1">
                <button onClick={() => setAnchor(stepAnchor(gran, anchor, -1))}
                  className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50 transition" title="이전">‹</button>
                <span className="px-3 py-1.5 text-sm font-semibold text-slate-700 tabular-nums min-w-[110px] text-center">{period.label}</span>
                <button onClick={() => setAnchor(stepAnchor(gran, anchor, 1))}
                  className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50 transition" title="다음">›</button>
                <button onClick={() => setAnchor(new Date())}
                  className="ml-1 px-3 py-1.5 text-xs font-medium text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50 transition">오늘</button>
              </div>
            ) : (
              <div className="inline-flex items-center gap-2">
                <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                  className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm text-slate-700 focus:border-indigo-400 outline-none" />
                <span className="text-slate-400">~</span>
                <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
                  className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm text-slate-700 focus:border-indigo-400 outline-none" />
              </div>
            )}
          </div>

          {/* 뷰 */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs font-semibold text-slate-400 w-10">보기</span>
            <Seg
              options={[{ key: 'ledger', label: '구매 원장' }, { key: 'summary', label: '합계 요약' }]}
              value={mode} onChange={(k) => { if (k === 'summary') clearStore(); setMode(k); }} />
            {mode === 'summary' && (
              <Seg
                options={[{ key: 'customer', label: '고객별' }, { key: 'store', label: '매장별' }]}
                value={groupBy} onChange={(k) => setGroupBy(k)} />
            )}
            {isLedger && storeCode && (
              <button onClick={clearStore}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-full text-xs font-medium hover:bg-indigo-100 transition">
                매장: {storeLabel || storeCode}
                <span className="text-indigo-400">✕</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 요약 타일 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: '총 매출', value: won(s?.totalAmount), accent: 'text-emerald-600' },
          { label: '총 건수', value: (s?.totalCount || 0).toLocaleString() + '건', accent: 'text-slate-800' },
          { label: '구매 고객 수', value: (s?.customerCount || 0).toLocaleString() + '명', accent: 'text-indigo-600' },
          { label: '객단가', value: won(s?.avgOrder), accent: 'text-slate-800' },
        ].map(t => (
          <div key={t.label} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
            <p className="text-xs text-slate-400">{t.label}</p>
            <p className={`text-xl font-bold tabular-nums mt-1 ${t.accent}`}>{loading ? '…' : t.value}</p>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-slate-400 italic -mt-1">Data source: 구매 원장(purchases), 선택 기간 실제 집계</p>

      {/* 테이블 */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100">
              {isLedger ? (
                <tr>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">구매일</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">고객</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">매장</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">상품</th>
                  <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-400">수량</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-400">금액</th>
                  <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-400 w-16">상세</th>
                </tr>
              ) : isStore ? (
                <tr>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">매장</th>
                  <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-400">구매 고객 수</th>
                  <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-400">구매 건수</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-400">합계 금액</th>
                  <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-400">최근 구매</th>
                  <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-400 w-20">원장</th>
                </tr>
              ) : (
                <tr>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">고객</th>
                  <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-400">등급</th>
                  <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-400">구매 횟수</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-400">합계 금액</th>
                  <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-400">최근 구매</th>
                  <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-400 w-16">상세</th>
                </tr>
              )}
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? (
                <tr><td colSpan={7} className="text-center py-12 text-slate-400">불러오는 중...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-slate-400">해당 기간 구매 내역이 없습니다</td></tr>
              ) : isLedger ? (
                rows.map((r, i) => (
                  <tr key={r.id || i} className="hover:bg-slate-50/70 transition">
                    <td className="px-4 py-3 text-left text-slate-600 text-xs tabular-nums">{r.purchase_date || '-'}</td>
                    <td className="px-4 py-3 text-left font-medium text-slate-800">
                      {r.customer_name || '-'}
                      <span className="text-slate-400 text-xs ml-1.5">{r.customer_phone || ''}</span>
                    </td>
                    <td className="px-4 py-3 text-left text-slate-600 text-xs">{r.store_name || r.store_code || '-'}</td>
                    <td className="px-4 py-3 text-left text-slate-600 text-xs">{r.product_name || '-'}</td>
                    <td className="px-4 py-3 text-center text-slate-600">{r.quantity ?? '-'}</td>
                    <td className="px-4 py-3 text-right text-slate-800 font-medium tabular-nums">{won(r.total_amount)}</td>
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => openDetail(r)}
                        className="px-2.5 py-1 text-xs font-medium text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition">이력</button>
                    </td>
                  </tr>
                ))
              ) : isStore ? (
                rows.map((r, i) => (
                  <tr key={(r.store_code || '') + i} className="hover:bg-slate-50/70 transition">
                    <td className="px-4 py-3 text-left font-medium text-slate-800">{r.store_label || '-'}</td>
                    <td className="px-4 py-3 text-center text-slate-600 tabular-nums">{(r.customer_count || 0).toLocaleString()}</td>
                    <td className="px-4 py-3 text-center text-slate-600 tabular-nums">{(r.purchase_count || 0).toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-slate-800 font-semibold tabular-nums">{won(r.total_amount)}</td>
                    <td className="px-4 py-3 text-center text-slate-500 text-xs tabular-nums">{r.last_purchase_date || '-'}</td>
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => openStoreLedger(r)}
                        className="px-2.5 py-1 text-xs font-medium text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition">원장 보기</button>
                    </td>
                  </tr>
                ))
              ) : (
                rows.map((r, i) => (
                  <tr key={r.customer_id || i} className="hover:bg-slate-50/70 transition">
                    <td className="px-4 py-3 text-left font-medium text-slate-800">
                      {r.customer_name || '-'}
                      <span className="text-slate-400 text-xs ml-1.5">{r.customer_phone || ''}</span>
                    </td>
                    <td className="px-4 py-3 text-center"><GradeBadge grade={r.grade} /></td>
                    <td className="px-4 py-3 text-center text-slate-600 tabular-nums">{(r.purchase_count || 0).toLocaleString()}회</td>
                    <td className="px-4 py-3 text-right text-slate-800 font-semibold tabular-nums">{won(r.total_amount)}</td>
                    <td className="px-4 py-3 text-center text-slate-500 text-xs tabular-nums">{r.last_purchase_date || '-'}</td>
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => openDetail(r)}
                        className="px-2.5 py-1 text-xs font-medium text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition">이력</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* 페이지네이션 */}
        {pg.totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100">
            <div className="text-xs text-slate-400 tabular-nums">
              {((pg.page - 1) * pg.limit) + 1}–{Math.min(pg.page * pg.limit, pg.total)}
              <span className="text-slate-300"> / 전체 {pg.total.toLocaleString()}{isLedger ? '건' : isStore ? '개 매장' : '명'}</span>
            </div>
            <div className="flex gap-1">
              <button onClick={() => runQuery(1)} disabled={pg.page === 1}
                className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg text-slate-600 disabled:opacity-30 hover:bg-slate-50 transition">«</button>
              <button onClick={() => runQuery(pg.page - 1)} disabled={pg.page === 1}
                className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg text-slate-600 disabled:opacity-30 hover:bg-slate-50 transition">‹</button>
              <span className="px-3 py-1.5 text-sm font-semibold text-indigo-600 tabular-nums">{pg.page} / {pg.totalPages}</span>
              <button onClick={() => runQuery(pg.page + 1)} disabled={pg.page === pg.totalPages}
                className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg text-slate-600 disabled:opacity-30 hover:bg-slate-50 transition">›</button>
              <button onClick={() => runQuery(pg.totalPages)} disabled={pg.page === pg.totalPages}
                className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg text-slate-600 disabled:opacity-30 hover:bg-slate-50 transition">»</button>
            </div>
          </div>
        )}
      </div>

      {/* 상세 모달 (기존 고객별 구매 이력 재사용) */}
      {detail && (
        <PurchaseHistoryModal
          customerId={detail.id}
          name={detail.name}
          phone={detail.phone}
          onClose={() => setDetail(null)}
          onError={(msg) => setToast({ msg, type: 'error' })}
        />
      )}

      {/* 토스트 */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[10000] animate-in slide-in-from-bottom fade-in duration-300">
          <div className={`px-5 py-3 rounded-xl shadow-lg text-sm font-medium text-white ${toast.type === 'success' ? 'bg-emerald-600' : 'bg-rose-600'}`}>
            {toast.msg}
          </div>
        </div>
      )}
    </div>
  );
}
