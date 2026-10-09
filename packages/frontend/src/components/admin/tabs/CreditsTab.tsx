/**
 * CreditsTab — 슈퍼관리자 AdminDashboard 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch, SetStateAction } from 'react';
import { formatDateTime } from '../../../utils/formatDate';
import { creditTxLabel } from '../../../constants/credit';
import type { ModalState } from '../admin-types';

export interface CreditsTabProps {
  creditPanel: 'risk' | 'requests' | 'predictive' | null;
  creditRequests: any[];
  creditRiskCompanies: any[];
  creditTxAll: any[];
  creditTxCompany: string;
  creditTxLoading: boolean;
  creditTxPage: number;
  creditTxTotalPages: number;
  loadAllCreditTx: (page?: number, company?: string) => Promise<void>;
  loadCreditRequests: () => Promise<void>;
  loadCreditRisk: () => Promise<void>;
  loadPendingBadges: () => Promise<void>;
  predictiveRunning: boolean;
  setCreditPanel: Dispatch<SetStateAction<'risk' | 'requests' | 'predictive' | null>>;
  setCreditTxCompany: Dispatch<SetStateAction<string>>;
  setModal: Dispatch<SetStateAction<ModalState>>;
  setPredictiveRunning: Dispatch<SetStateAction<boolean>>;
  showAlert: (title: string, message: string, variant?: 'success' | 'error' | 'warning' | 'info') => void;
  showConfirm: (title: string, message: string, onConfirm: () => void) => void;
}

export default function CreditsTab(props: CreditsTabProps) {
  const { creditPanel, creditRequests, creditRiskCompanies, creditTxAll, creditTxCompany, creditTxLoading, creditTxPage, creditTxTotalPages, loadAllCreditTx, loadCreditRequests, loadCreditRisk, loadPendingBadges, predictiveRunning, setCreditPanel, setCreditTxCompany, setModal, setPredictiveRunning, showAlert, showConfirm } = props;

  // 예측 일괄 분석·차감 수동 실행 (9시 대기 없이 검증·복구·시연). 멱등키로 같은 날 중복 차감 0.
  const handleRunPredictiveNow = () => {
    showConfirm(
      '예측 일괄 실행',
      '요금제 가입 회사(고객 DB 보유) 전체에 지금 즉시 DB 규모별 예측 분석·크레딧 차감을 1회 실행합니다.\n오늘 이미 차감된 회사는 중복 차감되지 않습니다. 진행하시겠습니까?',
      async () => {
        setPredictiveRunning(true);
        try {
          const token = localStorage.getItem('token');
          const res = await fetch('/api/admin/predictive/run-now', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
          const d = await res.json();
          if (res.ok && d.success) {
            if (d.ran === false) {
              showAlert('진행 중', '예측 배치가 이미 실행 중입니다. 잠시 후 다시 시도해 주세요.', 'info');
            } else {
              showAlert('예측 실행 완료', `회사 ${d.companiesProcessed}개 분석 · 고객 ${Number(d.totalUpdated).toLocaleString()}명 갱신 (크레딧 부족 skip ${d.creditSkipped}).`, 'success');
              loadCreditRisk();
              loadAllCreditTx(1);
            }
          } else {
            showAlert('오류', d.error || '예측 수동 실행 실패', 'error');
          }
        } catch {
          showAlert('오류', '예측 수동 실행 실패', 'error');
        } finally {
          setPredictiveRunning(false);
        }
      }
    );
  };

  const handleApproveCreditRequest = (cr: any) => {
    setModal({
      type: 'confirm', title: 'AI 크레딧 충전 승인', variant: 'info',
      message: `${cr.company_name} · ${Number(cr.credits).toLocaleString()} 크레딧을 지급하고 ${Number(cr.total_amount).toLocaleString()}원을 월말 청구 대상으로 처리합니다. 승인할까요?`,
      onConfirm: async () => {
        try {
          const token = localStorage.getItem('token');
          const res = await fetch(`/api/admin/credit-requests/${cr.id}/approve`, { method: 'PUT', headers: { Authorization: `Bearer ${token}` } });
          const d = await res.json().catch(() => ({}));
          // 크레딧 목록은 페이지 단위(20)라 길이로 뱃지를 세면 안 된다 — 카운트를 따로 다시 부른다(즉시 반영).
          if (res.ok) { setModal({ type: 'alert', title: '승인 완료', message: d.message || '지급되었습니다.', variant: 'success' }); loadCreditRequests(); loadPendingBadges(); }
          else setModal({ type: 'alert', title: '승인 실패', message: d.error || '오류', variant: 'error' });
        } catch { setModal({ type: 'alert', title: '오류', message: '네트워크 오류', variant: 'error' }); }
      },
    });
  };

  const handleRejectCreditRequest = (cr: any) => {
    setModal({
      type: 'confirm', title: 'AI 크레딧 충전 거절', variant: 'warning',
      message: `${cr.company_name}의 ${Number(cr.credits).toLocaleString()} 크레딧 충전 요청을 거절할까요?`,
      onConfirm: async () => {
        try {
          const token = localStorage.getItem('token');
          const res = await fetch(`/api/admin/credit-requests/${cr.id}/reject`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ adminNote: '슈퍼관리자 거절' }),
          });
          const d = await res.json().catch(() => ({}));
          if (res.ok) { setModal({ type: 'alert', title: '거절 완료', message: d.message || '거절되었습니다.', variant: 'success' }); loadCreditRequests(); loadPendingBadges(); }
          else setModal({ type: 'alert', title: '거절 실패', message: d.error || '오류', variant: 'error' });
        } catch { setModal({ type: 'alert', title: '오류', message: '네트워크 오류', variant: 'error' }); }
      },
    });
  };
  return (
    <>
    {(
          <div className="space-y-4">
            {/* 크레딧 요약 타일 3칸 — 클릭 시 모달 상세 (가로 여백 축소) */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <button
                onClick={() => setCreditPanel('requests')}
                className="text-left bg-white rounded-2xl border border-gray-200/70 shadow-sm p-5 hover:shadow-md hover:border-violet-200 transition-all"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-700">크레딧 충전 요청</span>
                  {creditRequests.length > 0 && <span className="w-2 h-2 rounded-full bg-violet-500"></span>}
                </div>
                <div className="mt-2 text-3xl font-bold tracking-tight text-violet-700 tabular-nums">
                  {creditRequests.length}<span className="text-base text-gray-400 font-semibold">건</span>
                </div>
                <div className="text-[11px] text-gray-400 mt-1">후불 승인 대기 · 클릭해 상세</div>
              </button>

              <button
                onClick={() => setCreditPanel('risk')}
                className="text-left bg-white rounded-2xl border border-gray-200/70 shadow-sm p-5 hover:shadow-md hover:border-rose-200 transition-all"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-700">크레딧 위험 회사</span>
                  {creditRiskCompanies.length > 0 && <span className="w-2 h-2 rounded-full bg-rose-500"></span>}
                </div>
                <div className="mt-2 text-3xl font-bold tracking-tight text-rose-600 tabular-nums">
                  {creditRiskCompanies.length}<span className="text-base text-gray-400 font-semibold">건</span>
                </div>
                <div className="text-[11px] text-gray-400 mt-1">소진·마이너스 · 업셀/해지방어</div>
              </button>

              <button
                onClick={() => setCreditPanel('predictive')}
                className="text-left bg-white rounded-2xl border border-gray-200/70 shadow-sm p-5 hover:shadow-md hover:border-indigo-200 transition-all"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-700">예측 일괄 분석·차감</span>
                  <svg className="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                </div>
                <div className="mt-2 text-lg font-bold tracking-tight text-indigo-700">매일 오전 9시 자동</div>
                <div className="text-[11px] text-gray-400 mt-1">클릭해 지금 실행</div>
              </button>
            </div>

            {/* 크레딧 충전 요청 모달 */}
            {creditPanel === 'requests' && (
              <div className="fixed inset-0 bg-gray-900/40 flex items-center justify-center p-4 z-50">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
                  <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
                    <h3 className="text-base font-semibold text-gray-900">크레딧 충전 요청 {creditRequests.length}건 <span className="text-sm font-normal text-gray-400">(후불)</span></h3>
                    <button onClick={() => setCreditPanel(null)} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100"><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
                  </div>
                  <div className="p-5 overflow-y-auto">
                    {creditRequests.length === 0 ? (
                      <p className="text-sm text-gray-500 py-10 text-center">대기 중인 크레딧 충전 요청이 없습니다.</p>
                    ) : (
                      <div className="space-y-2">
                        {creditRequests.map((cr) => (
                          <div key={cr.id} className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3 border border-gray-100 flex-wrap gap-2">
                            <div className="flex items-center gap-4 flex-wrap">
                              <span className="px-2 py-0.5 rounded text-xs font-medium bg-violet-100 text-violet-800">크레딧 충전</span>
                              <span className="font-medium text-gray-900">{cr.company_name}</span>
                              <span className="font-bold text-lg text-violet-700">{Number(cr.credits).toLocaleString()} 크레딧</span>
                              <span className="text-sm text-gray-500">월말 청구 {Number(cr.total_amount).toLocaleString()}원</span>
                              <span className="text-xs text-gray-400">{formatDateTime(cr.created_at)}</span>
                            </div>
                            <div className="flex gap-2 flex-shrink-0">
                              <button onClick={() => handleApproveCreditRequest(cr)} className="whitespace-nowrap px-4 py-1.5 bg-violet-600 text-white rounded-lg text-[13px] font-medium hover:bg-violet-700 transition-colors">승인</button>
                              <button onClick={() => handleRejectCreditRequest(cr)} className="whitespace-nowrap px-4 py-1.5 bg-red-500 text-white rounded-lg text-[13px] font-medium hover:bg-red-600 transition-colors">거절</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 크레딧 위험 회사 모달 */}
            {creditPanel === 'risk' && (
              <div className="fixed inset-0 bg-gray-900/40 flex items-center justify-center p-4 z-50">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
                  <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
                    <div>
                      <h3 className="text-base font-semibold text-gray-900">크레딧 위험 회사 {creditRiskCompanies.length}건</h3>
                      <span className="text-[11px] text-gray-400">소진 임박·0·마이너스: 업셀/해지방어 대상</span>
                    </div>
                    <button onClick={() => setCreditPanel(null)} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100"><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
                  </div>
                  <div className="p-5 overflow-y-auto">
                    {creditRiskCompanies.length === 0 ? (
                      <p className="text-sm text-gray-500 py-10 text-center">위험 회사가 없습니다.</p>
                    ) : (
                      <div className="space-y-2">
                        {creditRiskCompanies.map((co) => {
                          const badge = co.risk === 'negative'
                            ? { t: co.nearCap ? '마이너스 · 상한 근접' : '마이너스', c: 'bg-rose-600 text-white' }
                            : co.risk === 'depleted'
                              ? { t: '소진(0)', c: 'bg-rose-200 text-rose-800' }
                              : { t: '소진 임박', c: 'bg-amber-200 text-amber-800' };
                          return (
                            <div key={co.id} className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-2.5 border border-gray-100 flex-wrap gap-2">
                              <div className="flex items-center gap-3 flex-wrap">
                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${badge.c}`}>{badge.t}</span>
                                <span className="font-medium text-gray-900">{co.companyName}</span>
                                <span className="text-xs text-gray-400">{co.planName}</span>
                              </div>
                              <div className="flex items-center gap-4 text-sm flex-shrink-0">
                                <span className={`font-bold tabular-nums ${co.total < 0 ? 'text-rose-600' : 'text-gray-700'}`}>잔액 {Number(co.total).toLocaleString()}</span>
                                <span className="text-xs text-gray-400">월 {Number(co.planCredits).toLocaleString()}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 예측 일괄 분석·차감 실행 모달 */}
            {creditPanel === 'predictive' && (
              <div className="fixed inset-0 bg-gray-900/40 flex items-center justify-center p-4 z-50">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" onClick={(e) => e.stopPropagation()}>
                  <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
                    <h3 className="text-base font-semibold text-gray-900">예측 일괄 분석·차감 실행</h3>
                    <button onClick={() => setCreditPanel(null)} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100"><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
                  </div>
                  <div className="p-6">
                    <p className="text-sm text-gray-600 leading-relaxed">요금제 가입 회사(고객 DB 보유) 전체를 지금 즉시 분석·차감합니다. 매일 오전 9시 자동 실행과 동일하며, 오늘 이미 차감된 회사는 중복되지 않습니다.</p>
                    <button
                      onClick={() => { setCreditPanel(null); handleRunPredictiveNow(); }}
                      disabled={predictiveRunning}
                      className="whitespace-nowrap mt-5 w-full px-4 py-2.5 bg-emerald-600 text-white rounded-xl text-[13px] font-medium hover:bg-emerald-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {predictiveRunning ? '실행 중…' : '지금 실행'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 크레딧 사용 이력 — 전체 회사 */}
            <div className="bg-white rounded-xl border border-gray-200/80 shadow-sm">
              <div className="px-5 py-3.5 border-b border-gray-100 flex flex-wrap justify-between items-center gap-3">
                <h2 className="text-base font-semibold">크레딧 사용 이력</h2>
                <div className="flex items-center gap-2">
                  <input
                    value={creditTxCompany}
                    onChange={(e) => setCreditTxCompany(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') loadAllCreditTx(1); }}
                    placeholder="회사 ID로 필터 (선택 · 비우면 전체)"
                    className="px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] w-64"
                  />
                  <button onClick={() => loadAllCreditTx(1)} className="whitespace-nowrap px-4 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-[13px] font-medium transition-colors">조회</button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-left text-gray-500 border-b">
                      <th className="whitespace-nowrap px-4 py-2 font-medium">회사</th>
                      <th className="whitespace-nowrap px-4 py-2 font-medium">작업</th>
                      <th className="whitespace-nowrap px-4 py-2 font-medium">사용자</th>
                      <th className="whitespace-nowrap px-4 py-2 font-medium text-right">변동</th>
                      <th className="whitespace-nowrap px-4 py-2 font-medium text-right">잔여</th>
                      <th className="whitespace-nowrap px-4 py-2 font-medium text-right">일시</th>
                    </tr>
                  </thead>
                  <tbody>
                    {creditTxLoading ? (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">불러오는 중...</td></tr>
                    ) : creditTxAll.length === 0 ? (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">사용 이력이 없습니다.</td></tr>
                    ) : (
                      creditTxAll.map((tx) => {
                        // ★ 2026-08-13 환불(refund)도 잔액이 늘어나는 축 — CreditHistoryModal isPlus와 같은 기준.
                        const plus = tx.type === 'grant' || tx.type === 'purchase' || tx.type === 'postpaid_grant' || tx.type === 'refund';
                        const after = Number(tx.balance_base_after || 0) + Number(tx.balance_purchased_after || 0);
                        return (
                          <tr key={tx.id} className="border-b last:border-0 hover:bg-gray-50">
                            <td className="px-4 py-2 text-gray-900">{tx.company_name || '-'}</td>
                            <td className="px-4 py-2 text-gray-700">{creditTxLabel(tx.type, tx.source)}</td>
                            <td className="px-4 py-2 text-gray-600">{tx.created_by_name || '자동'}</td>
                            <td className={`px-4 py-2 text-right font-semibold ${plus ? 'text-emerald-600' : 'text-rose-600'}`}>{plus ? '+' : '-'}{Number(tx.amount).toLocaleString()}</td>
                            <td className="px-4 py-2 text-right text-gray-500">{after.toLocaleString()}</td>
                            <td className="px-4 py-2 text-right text-gray-400 whitespace-nowrap">{formatDateTime(tx.created_at)}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-center gap-2 px-6 py-3 border-t">
                <button disabled={creditTxPage <= 1} onClick={() => loadAllCreditTx(creditTxPage - 1)} className="whitespace-nowrap px-3 py-1 rounded border border-gray-200 text-[13px] disabled:opacity-30">이전</button>
                <span className="text-sm text-gray-500">{creditTxPage} / {creditTxTotalPages}</span>
                <button disabled={creditTxPage >= creditTxTotalPages} onClick={() => loadAllCreditTx(creditTxPage + 1)} className="whitespace-nowrap px-3 py-1 rounded border border-gray-200 text-[13px] disabled:opacity-30">다음</button>
              </div>
            </div>
          </div>
        )}
    </>
  );
}
