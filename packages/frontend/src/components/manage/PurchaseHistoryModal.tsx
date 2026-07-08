import { useState, useEffect, useRef } from 'react';
import { customersApi } from '../../api/client';

// 고객 1명 구매 이력 상세 모달 (기존 GET /customers/:id/purchases 재사용).
// 고객DB 탭 인라인 모달과 동일 UI를 공용 컴포넌트로 추출 — 구매 통합조회 [상세]에서 사용.
interface PurchaseRow {
  purchase_date: string;
  total_amount: number;
  quantity: number;
  store_code: string;
  store_name: string;
}
interface PurchaseData {
  summary: { totalCount: number; totalAmount: number };
  purchases: PurchaseRow[];
  pagination: { total: number; page: number; limit: number; totalPages: number };
}
interface Props {
  customerId: string;
  name?: string;
  phone?: string;
  onClose: () => void;
  onError?: (msg: string) => void;
}

const fmtAmount = (v: number) => (!v ? '-' : Number(v).toLocaleString() + '원');

export default function PurchaseHistoryModal({ customerId, name, phone, onClose, onError }: Props) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PurchaseData | null>(null);
  // 요청 카운터 가드 — 연타/늦은 응답이 최신 페이지를 오염하지 않게 최신 요청만 반영
  const reqRef = useRef(0);

  const load = async (page = 1) => {
    const reqId = ++reqRef.current;
    if (page === 1) setData(null);
    setLoading(true);
    try {
      const res = await customersApi.purchases(customerId, { page, limit: 20 });
      if (reqRef.current !== reqId) return;
      setData({
        summary: res.data.summary || { totalCount: 0, totalAmount: 0 },
        purchases: res.data.purchases || [],
        pagination: res.data.pagination || { total: 0, page, limit: 20, totalPages: 0 },
      });
    } catch (e: any) {
      if (reqRef.current !== reqId) return;
      onError?.(e.response?.data?.error || '구매 이력 조회 실패');
      if (page === 1) onClose(); // 최초 열기 실패 시만 닫기
    } finally {
      if (reqRef.current === reqId) setLoading(false);
    }
  };

  // customerId 바뀌면(다른 고객 상세) 재조회
  useEffect(() => {
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  // ESC 닫기 (백드롭 클릭 닫힘은 금지 — X/닫기/ESC만)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-in fade-in">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col animate-in zoom-in-95 fade-in duration-200">
        {/* 헤더 */}
        <div className="flex items-start justify-between p-5 border-b border-slate-100">
          <div>
            <h3 className="text-lg font-bold text-slate-900 tracking-tight">구매 이력</h3>
            <p className="text-sm text-slate-500 mt-0.5">{name || '-'} · {phone || '-'}</p>
          </div>
          <button onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition" title="닫기">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 요약 */}
        {data && (
          <div className="flex gap-2 px-5 pt-4">
            <span className="px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-full text-xs font-medium">
              총 {data.summary.totalCount.toLocaleString()}건
            </span>
            <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-full text-xs font-medium">
              총 구매액 {Number(data.summary.totalAmount).toLocaleString()}원
            </span>
          </div>
        )}

        {/* 목록 */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="text-center py-12 text-slate-400">불러오는 중...</div>
          ) : !data || data.purchases.length === 0 ? (
            <div className="text-center py-12 text-slate-400">구매 이력이 없습니다</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-100">
                  <tr>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">구매일</th>
                    <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-400">금액</th>
                    <th className="px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-400">수량</th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">매장</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {data.purchases.map((p, i) => (
                    <tr key={i} className="hover:bg-slate-50/70 transition">
                      <td className="px-3 py-2 text-left text-slate-700">{p.purchase_date || '-'}</td>
                      <td className="px-3 py-2 text-right text-slate-800 font-medium">{fmtAmount(p.total_amount)}</td>
                      <td className="px-3 py-2 text-center text-slate-600">{p.quantity ?? '-'}</td>
                      <td className="px-3 py-2 text-left text-slate-600 text-xs">{p.store_name || p.store_code || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 페이지네이션 + 닫기 */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 bg-slate-50 rounded-b-2xl">
          <div className="text-sm text-slate-500 tabular-nums">
            {data && data.pagination.totalPages > 1 ? `${data.pagination.page} / ${data.pagination.totalPages} 페이지` : ''}
          </div>
          <div className="flex gap-1">
            {data && data.pagination.totalPages > 1 && (
              <>
                <button onClick={() => load(data.pagination.page - 1)}
                  disabled={loading || data.pagination.page === 1}
                  className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg text-slate-600 disabled:opacity-30 hover:bg-white transition">‹</button>
                <button onClick={() => load(data.pagination.page + 1)}
                  disabled={loading || data.pagination.page === data.pagination.totalPages}
                  className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg text-slate-600 disabled:opacity-30 hover:bg-white transition">›</button>
              </>
            )}
            <button onClick={onClose}
              className="px-4 py-1.5 text-sm font-medium border border-slate-200 rounded-lg text-slate-600 hover:bg-white transition ml-2">닫기</button>
          </div>
        </div>
      </div>
    </div>
  );
}
