import { useEffect, useState } from 'react';
import { X, Sparkles, ArrowDownRight, ArrowUpRight, RotateCcw, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { creditTxLabel } from '../../constants/credit';

/**
 * CreditHistoryModal — AI 크레딧 사용/충전 이력 모달 (D229+).
 * 무엇으로 얼마가 차감/충전됐는지 투명하게. 화이트/모던(대시보드 톤 일치).
 * 데이터: GET /api/companies/my-credit/transactions (ai_credit_transactions).
 */
interface CreditTx {
  id: string;
  type: string;
  amount: number;
  bucket?: string;
  source?: string | null;
  balance_base_after?: number;
  balance_purchased_after?: number;
  reason?: string | null;
  created_at: string;
  created_by_name?: string | null;  // 사용자명(시스템 자동 차감은 null → '자동' 표기)
}

interface CreditSummary {
  total?: number;
  planCredits?: number;
  baseRemaining?: number;
  purchased?: number;
  monthlyUsed?: number;
}

interface Props {
  onClose: () => void;
  onGoPricing?: () => void;
  creditInfo?: CreditSummary | null;
}

const fmt = (n: number | undefined | null) => Number(n || 0).toLocaleString();
const fmtDate = (s: string) => {
  const d = new Date(s);
  if (isNaN(d.getTime())) return '';
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getMonth() + 1}.${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

// ★ 2026-08-13 환불(refund) = 잔액이 늘어나는 축 — 마이너스로 표시하면 이력이 거짓말이 된다.
const isPlus = (t: string) => t === 'grant' || t === 'purchase' || t === 'postpaid_grant' || t === 'refund';
const isReset = (t: string) => t === 'reset';

export default function CreditHistoryModal({ onClose, onGoPricing, creditInfo }: Props) {
  const [rows, setRows] = useState<CreditTx[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const token = localStorage.getItem('token');
        const res = await fetch(`/api/companies/my-credit/transactions?page=${page}`, { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) {
          const d = await res.json();
          if (alive) { setRows(d.transactions || []); setTotalPages(d.totalPages || 1); setTotal(d.total || 0); }
        }
      } catch { /* 조회 실패 시 빈 목록 */ }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [page]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* 헤더 */}
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <div>
              <div className="text-sm font-bold text-gray-900">AI 크레딧</div>
              <div className="text-[11px] text-gray-400">사용 이력 총 {fmt(total)}건</div>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 잔여 + 3칸 요약 (기본 제공 · 이번달 사용 · 충전) */}
        {creditInfo && (
          <div className="border-b border-gray-100 px-5 py-4">
            <div className="mb-3 flex items-baseline gap-1.5">
              <span className="text-2xl font-bold tabular-nums text-violet-700">{fmt(creditInfo.total)}</span>
              <span className="text-sm text-gray-400">크레딧 잔여</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-violet-50 p-3 text-center">
                <div className="text-[11px] text-gray-500">기본 제공</div>
                <div className="mt-0.5 text-base font-bold tabular-nums text-violet-700">{fmt(creditInfo.planCredits)}</div>
              </div>
              <div className="rounded-xl bg-amber-50 p-3 text-center">
                <div className="text-[11px] text-gray-500">이번달 사용</div>
                <div className="mt-0.5 text-base font-bold tabular-nums text-amber-600">{fmt(creditInfo.monthlyUsed)}</div>
              </div>
              <div className="rounded-xl bg-emerald-50 p-3 text-center">
                <div className="text-[11px] text-gray-500">충전</div>
                <div className="mt-0.5 text-base font-bold tabular-nums text-emerald-600">{fmt(creditInfo.purchased)}</div>
              </div>
            </div>
          </div>
        )}

        {/* 목록 */}
        <div className="max-h-[55vh] min-h-[200px] overflow-y-auto px-2 py-2">
          {loading ? (
            <div className="flex h-40 items-center justify-center text-gray-300"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : rows.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-1 text-gray-300">
              <Sparkles className="h-6 w-6" />
              <span className="text-sm">아직 사용 이력이 없습니다</span>
            </div>
          ) : (
            rows.map((tx) => {
              const plus = isPlus(tx.type);
              const reset = isReset(tx.type);
              const after = Number(tx.balance_base_after || 0) + Number(tx.balance_purchased_after || 0);
              const Icon = reset ? RotateCcw : plus ? ArrowUpRight : ArrowDownRight;
              const tone = reset ? 'text-cyan-600 bg-cyan-50' : plus ? 'text-emerald-600 bg-emerald-50' : 'text-rose-600 bg-rose-50';
              const amtTone = reset ? 'text-cyan-600' : plus ? 'text-emerald-600' : 'text-rose-600';
              return (
                <div key={tx.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition hover:bg-gray-50">
                  <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${tone}`}><Icon className="h-4 w-4" /></div>
                  <div className="w-24 flex-shrink-0 min-w-0">
                    <div className="truncate text-sm font-medium text-gray-800">{creditTxLabel(tx.type, tx.source)}</div>
                    <div className="truncate text-[11px] text-gray-400">{fmtDate(tx.created_at)}</div>
                  </div>
                  <div className="flex-1 min-w-0 px-2 text-center">
                    <div className="truncate text-xs font-semibold text-gray-700">{tx.created_by_name || '자동'}</div>
                    {tx.reason ? <div className="truncate text-[10px] text-gray-400">{tx.reason}</div> : null}
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <div className={`text-sm font-bold tabular-nums ${amtTone}`}>{reset ? '' : plus ? '+' : '-'}{fmt(tx.amount)}</div>
                    <div className="text-[10px] text-gray-400">잔여 {fmt(after)}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* 푸터 — 페이지네이션 + 요금제·충전 */}
        <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3">
          <div className="flex items-center gap-1">
            <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-1 text-[11px] tabular-nums text-gray-400">{page} / {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          {onGoPricing && (
            <button onClick={onGoPricing} className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-700">
              요금제 · 충전
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
