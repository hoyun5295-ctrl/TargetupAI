/**
 * SettlementOverviewModal — 총 정산표 (★2026-08-05 Harold 명시)
 *
 * 전 고객사의 총 청구금·수금완료·미납을 한 화면에. **소유자(ceo) 계정 전용**이라
 * 진입점 자체가 권한 응답(`/billing/overview/access`)으로 가려진다.
 *
 * 원칙
 *  - 미납은 **누적**이 기본이다. 월로 끊으면 지난달 못 받은 돈이 화면에서 사라진다.
 *  - 상단 카드는 아래 표의 합이다(서버가 같은 행에서 만들어 내린다) — 카드와 표가 갈리지 않는다.
 *  - 수금완료(`paid`) 처리한 장만 미납에서 빠진다. 직원이 [수금완료]를 찍는 그 축이다.
 * 다크 모달 z-[2000] + createPortal + ESC + 모바일 반응형 + Source caption. 배경 클릭으로 닫히지 않는다.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Wallet, X, Loader2, AlertTriangle, TrendingDown, CheckCircle2, Receipt } from 'lucide-react';

interface OverviewRow {
  company_id: string;
  company_name: string;
  sheet_count: number;
  unpaid_sheets: number;
  total_amount: number;
  paid_amount: number;
  unpaid_amount: number;
  last_period: string | null;
}

interface OverviewSummary {
  company_count: number;
  sheet_count: number;
  total_amount: number;
  paid_amount: number;
  unpaid_amount: number;
  unpaid_company_count: number;
}

interface Props {
  show: boolean;
  onClose: () => void;
}

const won = (n: number) => `${Math.round(Number(n) || 0).toLocaleString()}원`;

/** 202607 → 2026-07 */
const periodLabel = (v: string | null) => {
  const s = String(v || '');
  return /^\d{6}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4)}` : '-';
};

export default function SettlementOverviewModal({ show, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<OverviewRow[]>([]);
  const [summary, setSummary] = useState<OverviewSummary | null>(null);
  /** 누적이 기본 — 값이 있으면 그 달만 본다(YYYY-MM). */
  const [month, setMonth] = useState<string>('');

  useEffect(() => {
    if (!show) return;
    let alive = true;
    setLoading(true);
    setError(null);
    const qs = /^\d{4}-\d{2}$/.test(month) ? `?from=${month}&to=${month}` : '';
    const token = localStorage.getItem('token');
    fetch(`/api/admin/billing/overview${qs}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (!d || d.success === false) throw new Error(d?.error || '총 정산표를 불러오지 못했습니다.');
        setRows(Array.isArray(d.rows) ? d.rows : []);
        setSummary(d.summary || null);
      })
      .catch((e) => { if (alive) { setError(e?.message || '총 정산표를 불러오지 못했습니다.'); setRows([]); setSummary(null); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [show, month]);

  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [show, onClose]);

  if (!show) return null;

  const card = (label: string, value: string, sub: string, tone: string, Icon: any) => (
    <div className={`flex-1 min-w-[180px] px-4 py-3 rounded-xl border ${tone}`}>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide opacity-80">
        <Icon className="w-3.5 h-3.5" /> {label}
      </div>
      <div className="text-xl font-bold mt-1 tabular-nums">{value}</div>
      <div className="text-[11px] opacity-60 mt-0.5">{sub}</div>
    </div>
  );

  return createPortal(
    <div className="fixed inset-0 z-[2000] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
      <div className="w-full max-w-5xl bg-slate-900 border border-white/10 rounded-2xl shadow-2xl max-h-[90vh] flex flex-col overflow-hidden max-md:max-h-[92vh]">
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-white/10 bg-gradient-to-r from-slate-950 via-emerald-950/30 to-slate-950 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center shadow-lg shadow-emerald-500/20 shrink-0">
              <Wallet className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h3 className="text-white font-bold text-base truncate">총 정산표</h3>
              <div className="text-xs text-white/50 mt-0.5">
                {month ? `${month} 한 달` : '전체 누적'} · 수금완료 처리한 장은 미납에서 빠집니다
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="px-2 py-1 text-xs rounded-lg bg-white/5 border border-white/10 text-white/80 [color-scheme:dark]"
            />
            {month && (
              <button type="button" onClick={() => setMonth('')}
                className="px-2 py-1 text-xs rounded-lg bg-white/5 border border-white/10 text-white/60 hover:text-white/90">누적으로</button>
            )}
            <button type="button" onClick={onClose} className="text-white/50 hover:text-white p-1.5 hover:bg-white/5 rounded transition-colors" aria-label="닫기">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 min-h-[240px]">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-white/50 gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-emerald-300" />
              <span className="text-sm">정산 현황을 불러오는 중...</span>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
              <AlertTriangle className="w-6 h-6 text-rose-400" />
              <span className="text-sm text-rose-300">{error}</span>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-3 mb-4">
                {card('총 청구금', won(summary?.total_amount || 0), `${summary?.company_count || 0}개사 · ${summary?.sheet_count || 0}장`,
                  'bg-white/5 border-white/10 text-white', Receipt)}
                {card('수금완료', won(summary?.paid_amount || 0), '입금 확인된 장의 합',
                  'bg-emerald-500/10 border-emerald-400/30 text-emerald-100', CheckCircle2)}
                {card('미납', won(summary?.unpaid_amount || 0), `${summary?.unpaid_company_count || 0}개사 남음`,
                  'bg-rose-500/10 border-rose-400/30 text-rose-100', TrendingDown)}
              </div>

              {rows.length === 0 ? (
                <div className="text-center py-12 text-white/40 text-sm">해당 기간에 발행된 정산이 없습니다.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="text-left text-[11px] text-white/45 border-b border-white/10">
                        <th className="py-2 pr-2 font-medium w-10">#</th>
                        <th className="py-2 px-2 font-medium">고객사</th>
                        <th className="py-2 px-2 font-medium text-right whitespace-nowrap">총 청구금</th>
                        <th className="py-2 px-2 font-medium text-right whitespace-nowrap">수금완료</th>
                        <th className="py-2 px-2 font-medium text-right whitespace-nowrap">미납</th>
                        <th className="py-2 px-2 font-medium text-right whitespace-nowrap">장</th>
                        <th className="py-2 px-2 font-medium text-right whitespace-nowrap">최근 청구월</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={r.company_id} className="border-b border-white/5 hover:bg-white/[0.03]">
                          <td className="py-2 pr-2 text-white/40 tabular-nums">{i + 1}</td>
                          <td className="py-2 px-2 text-white/90">{r.company_name}</td>
                          <td className="py-2 px-2 text-white/70 text-right tabular-nums whitespace-nowrap">{won(r.total_amount)}</td>
                          <td className="py-2 px-2 text-emerald-300/80 text-right tabular-nums whitespace-nowrap">{won(r.paid_amount)}</td>
                          <td className={`py-2 px-2 text-right tabular-nums whitespace-nowrap font-semibold ${r.unpaid_amount > 0 ? 'text-rose-300' : 'text-white/30'}`}>
                            {won(r.unpaid_amount)}
                          </td>
                          <td className="py-2 px-2 text-white/50 text-right tabular-nums whitespace-nowrap">
                            {r.unpaid_sheets > 0 ? `${r.unpaid_sheets}/${r.sheet_count}` : r.sheet_count}
                          </td>
                          <td className="py-2 px-2 text-white/50 text-right tabular-nums whitespace-nowrap">{periodLabel(r.last_period)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 shrink-0">
          <div className="text-[10px] text-white/30 italic">
            Data source: 발행된 정산 장(billings) 실측 합 · 미납 = 수금완료로 표시되지 않은 장 · 삭제된 장은 제외
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
