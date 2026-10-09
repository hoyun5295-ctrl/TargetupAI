/**
 * DepositsTab — 슈퍼관리자 AdminDashboard 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch, SetStateAction } from 'react';
import { formatDateTime } from '../../../utils/formatDate';
import AgentChargePanel from '../../AgentChargePanel';
import SearchableSelect from '../../SearchableSelect';
import type { Company } from '../admin-types';

export interface DepositsTabProps {
  chargeScope: 'web' | 'agent';
  chargeTxCompanyFilter: string;
  chargeTxEndDate: string;
  chargeTxList: any[];
  chargeTxLoading: boolean;
  chargeTxMethodFilter: string;
  chargeTxPage: number;
  chargeTxPerPage: 15;
  chargeTxStartDate: string;
  chargeTxTotal: number;
  chargeTxTypeFilter: string;
  companies: Company[];
  loadChargeManagement: (page?: number) => Promise<void>;
  pendingDeposits: any[];
  setAgentOrderPendingCount: Dispatch<SetStateAction<number>>;
  setChargeScope: Dispatch<SetStateAction<'web' | 'agent'>>;
  setChargeTxCompanyFilter: Dispatch<SetStateAction<string>>;
  setChargeTxEndDate: Dispatch<SetStateAction<string>>;
  setChargeTxMethodFilter: Dispatch<SetStateAction<string>>;
  setChargeTxStartDate: Dispatch<SetStateAction<string>>;
  setChargeTxTypeFilter: Dispatch<SetStateAction<string>>;
  setDepositAdminNote: Dispatch<SetStateAction<string>>;
  setDepositTarget: Dispatch<any>;
  setShowDepositApproveModal: Dispatch<SetStateAction<boolean>>;
  setShowDepositRejectModal: Dispatch<SetStateAction<boolean>>;
}

export default function DepositsTab(props: DepositsTabProps) {
  const { chargeScope, chargeTxCompanyFilter, chargeTxEndDate, chargeTxList, chargeTxLoading, chargeTxMethodFilter, chargeTxPage, chargeTxPerPage, chargeTxStartDate, chargeTxTotal, chargeTxTypeFilter, companies, loadChargeManagement, pendingDeposits, setAgentOrderPendingCount, setChargeScope, setChargeTxCompanyFilter, setChargeTxEndDate, setChargeTxMethodFilter, setChargeTxStartDate, setChargeTxTypeFilter, setDepositAdminNote, setDepositTarget, setShowDepositApproveModal, setShowDepositRejectModal } = props;
  return (
    <>
    {(
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-gray-200/80 shadow-sm p-1.5 flex gap-1.5">
              {([
                ['web', '한줄로 충전', '웹 선불 잔액 · 무통장입금 승인'],
                ['agent', '에이전트 충전', '발송ID(게이트웨이) 지갑'],
              ] as const).map(([key, label, hint]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setChargeScope(key)}
                  className={`flex-1 rounded-xl px-4 py-2.5 text-left transition-colors ${
                    chargeScope === key ? 'bg-emerald-600 text-white' : 'hover:bg-gray-50 text-gray-600'
                  }`}
                >
                  <div className="text-sm font-bold flex items-center gap-2">
                    {label}
                    {key === 'web' && pendingDeposits.length > 0 && (
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${chargeScope === key ? 'bg-white/25 text-white' : 'bg-amber-100 text-amber-800'}`}>
                        대기 {pendingDeposits.length}
                      </span>
                    )}
                  </div>
                  <div className={`text-[11px] mt-0.5 ${chargeScope === key ? 'text-indigo-100' : 'text-gray-400'}`}>{hint}</div>
                </button>
              ))}
            </div>

            {/* 대기 건 알림 */}
            {chargeScope === 'web' && pendingDeposits.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-lg">⏳</span>
                  <h3 className="font-semibold text-amber-800">승인 대기 {pendingDeposits.length}건</h3>
                </div>
                <div className="space-y-2">
                  {pendingDeposits.map((dr) => (
                    <div key={dr.id} className="flex items-center justify-between bg-white rounded-lg px-4 py-3 border border-amber-100">
                      <div className="flex items-center gap-4">
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">무통장입금</span>
                        <span className="font-medium text-gray-900">{dr.company_name}</span>
                        <span className="font-bold text-lg text-gray-900">{Number(dr.amount).toLocaleString()}원</span>
                        <span className="text-sm text-gray-500">입금자: {dr.depositor_name}</span>
                        {dr.held_reason && (
                          <span className="px-2 py-0.5 rounded text-xs font-semibold bg-rose-100 text-rose-700">
                            명의 확인 필요{dr.explanation_note ? ' · 소명 도착' : ''}
                          </span>
                        )}
                        <span className="text-xs text-gray-400">{formatDateTime(dr.created_at)}</span>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setDepositTarget(dr); setDepositAdminNote(''); setShowDepositApproveModal(true); }}
                          className="whitespace-nowrap px-4 py-1.5 bg-emerald-600 text-white rounded-lg text-[13px] font-medium hover:bg-emerald-700 transition-colors"
                        >
                          승인
                        </button>
                        <button
                          onClick={() => { setDepositTarget(dr); setDepositAdminNote(''); setShowDepositRejectModal(true); }}
                          className="whitespace-nowrap px-4 py-1.5 bg-red-500 text-white rounded-lg text-[13px] font-medium hover:bg-red-600 transition-colors"
                        >
                          거절
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ★ 2026-07-24 §5-3 에이전트 충전 실행 — 웹 잔액과 별개 지갑(게이트웨이 원장 직결) */}
            {/* ★ 2026-08-11 접수함 건수를 상위 뱃지로 올린다 — 반려·충전 등록 직후 60초를 기다리지 않게. */}
            {chargeScope === 'agent' && <AgentChargePanel onPendingOrdersChange={setAgentOrderPendingCount} />}

            {/* 전체 잔액 변동 이력 — 한줄로(웹) 지갑 */}
            <div className={`bg-white rounded-xl border border-gray-200/80 shadow-sm ${chargeScope === 'web' ? '' : 'hidden'}`}>
              <div className="px-5 py-3.5 border-b border-gray-100">
                <div className="flex flex-wrap justify-between items-center gap-3 mb-3">
                  <h2 className="text-base font-semibold">잔액 변동 이력</h2>
                  <button
                    onClick={() => loadChargeManagement(1)}
                    className="whitespace-nowrap px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-[13px] font-medium transition-colors"
                  >
                    새로고침
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {/* ★ D150-5 (2026-05-09) PDF #2: 입력 검색 가능하도록 SearchableSelect 적용 */}
                  <div className="min-w-[200px]">
                    <SearchableSelect
                      options={companies.filter((c: any) => c.billing_type === 'prepaid').map((c: any) => ({
                        value: c.id,
                        label: c.company_name,
                      }))}
                      value={chargeTxCompanyFilter === 'all' ? '' : chargeTxCompanyFilter}
                      onChange={(value) => setChargeTxCompanyFilter(value || 'all')}
                      placeholder="고객사 검색..."
                      emptyLabel="전체 고객사"
                      className="w-full"
                    />
                  </div>
                  <select
                    value={chargeTxTypeFilter}
                    onChange={(e) => setChargeTxTypeFilter(e.target.value)}
                    className="px-3 py-1.5 border border-gray-200 rounded-lg text-[13px]"
                  >
                    <option value="all">전체 구분</option>
                    <option value="charge">충전</option>
                    <option value="deduct">차감</option>
                    <option value="refund">환불</option>
                  </select>
                  <select
                    value={chargeTxMethodFilter}
                    onChange={(e) => setChargeTxMethodFilter(e.target.value)}
                    className="px-3 py-1.5 border border-gray-200 rounded-lg text-[13px]"
                  >
                    <option value="all">전체 결제수단</option>
                    <option value="bank_transfer">무통장입금</option>
                    <option value="card">카드결제</option>
                    <option value="virtual_account">가상계좌</option>
                    <option value="admin">관리자</option>
                    <option value="system">시스템(발송)</option>
                  </select>
                  <input
                    type="date"
                    value={chargeTxStartDate}
                    onChange={(e) => setChargeTxStartDate(e.target.value)}
                    className="px-3 py-1.5 border border-gray-200 rounded-lg text-[13px]"
                  />
                  <span className="flex items-center text-gray-400">~</span>
                  <input
                    type="date"
                    value={chargeTxEndDate}
                    onChange={(e) => setChargeTxEndDate(e.target.value)}
                    className="px-3 py-1.5 border border-gray-200 rounded-lg text-[13px]"
                  />
                  {(chargeTxCompanyFilter !== 'all' || chargeTxTypeFilter !== 'all' || chargeTxMethodFilter !== 'all' || chargeTxStartDate || chargeTxEndDate) && (
                    <button
                      onClick={() => { setChargeTxCompanyFilter('all'); setChargeTxTypeFilter('all'); setChargeTxMethodFilter('all'); setChargeTxStartDate(''); setChargeTxEndDate(''); }}
                      className="whitespace-nowrap px-3 py-2 text-[13px] text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      필터 초기화
                    </button>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 whitespace-nowrap">일시</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">고객사</th>
                      <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 whitespace-nowrap">구분</th>
                      <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 whitespace-nowrap">결제수단</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 whitespace-nowrap">금액</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 whitespace-nowrap">변동 후 잔액</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">설명</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {chargeTxLoading ? (
                      <tr>
                        <td colSpan={7} className="px-6 py-12 text-center text-gray-500">불러오는 중...</td>
                      </tr>
                    ) : chargeTxList.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-6 py-12 text-center text-gray-500">잔액 변동 이력이 없습니다.</td>
                      </tr>
                    ) : (
                      chargeTxList.map((tx) => {
                        const typeConfig: Record<string, { label: string; color: string; sign: string }> = {
                          admin_charge: { label: '충전', color: 'bg-emerald-100 text-emerald-800', sign: '+' },
                          charge: { label: '충전', color: 'bg-emerald-100 text-emerald-800', sign: '+' },
                          deposit_charge: { label: '충전', color: 'bg-emerald-100 text-emerald-800', sign: '+' },
                          admin_deduct: { label: '차감', color: 'bg-red-100 text-red-800', sign: '-' },
                          deduct: { label: '차감', color: 'bg-red-100 text-red-800', sign: '-' },
                          refund: { label: '환불', color: 'bg-blue-100 text-blue-800', sign: '+' },
                        };
                        const methodConfig: Record<string, { label: string; color: string }> = {
                          bank_transfer: { label: '무통장입금', color: 'bg-blue-50 text-blue-700' },
                          card: { label: '카드결제', color: 'bg-purple-50 text-purple-700' },
                          virtual_account: { label: '가상계좌', color: 'bg-indigo-50 text-indigo-700' },
                          admin: { label: '관리자', color: 'bg-gray-100 text-gray-700' },
                          system: { label: '시스템', color: 'bg-orange-50 text-orange-700' },
                        };
                        // ★ 2026-10-04 요금제 이용료(선불 이용 기간)는 같은 차감 type이라 참조 유형으로 가른다
                        const tc = (tx.type === 'deduct' && (tx as any).reference_type === 'plan_term')
                          ? { label: '요금제 이용료', color: 'bg-red-100 text-red-800', sign: '-' }
                          : (typeConfig[tx.type] || { label: tx.type, color: 'bg-gray-100 text-gray-600', sign: '' });
                        const mc = methodConfig[tx.payment_method] || { label: tx.payment_method || '-', color: 'bg-gray-50 text-gray-600' };
                        const isPlus = ['admin_charge', 'charge', 'deposit_charge', 'refund'].includes(tx.type);

                        return (
                          <tr key={tx.id} className="hover:bg-gray-50">
                            <td className="px-4 py-2 text-center text-gray-600 whitespace-nowrap text-xs">
                              {formatDateTime(tx.created_at)}
                            </td>
                            <td className="px-4 py-2 font-medium text-gray-900 whitespace-nowrap">
                              {tx.company_name}
                            </td>
                            <td className="px-4 py-2 text-center">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${tc.color}`}>{tc.label}</span>
                            </td>
                            <td className="px-4 py-2 text-center">
                              <span className={`px-2 py-0.5 rounded text-xs font-medium ${mc.color}`}>{mc.label}</span>
                            </td>
                            <td className={`px-4 py-2 text-right font-bold whitespace-nowrap ${isPlus ? 'text-emerald-600' : 'text-red-600'}`}>
                              {tc.sign}{Number(tx.amount).toLocaleString()}원
                            </td>
                            <td className="px-4 py-2 text-right text-gray-600 whitespace-nowrap">
                              {Number(tx.balance_after).toLocaleString()}원
                            </td>
                            <td className="px-4 py-2 text-gray-600 max-w-[300px]">
                              <div className="truncate" title={tx.description || ''}>
                                {tx.description || '-'}
                              </div>
                              {tx.admin_name && (
                                <div className="text-xs text-gray-400">처리: {tx.admin_name}</div>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {chargeTxTotal > chargeTxPerPage && (
                <div className="px-6 py-4 border-t flex items-center justify-between">
                  <span className="text-sm text-gray-500">
                    총 {chargeTxTotal}건 중 {(chargeTxPage - 1) * chargeTxPerPage + 1}-{Math.min(chargeTxPage * chargeTxPerPage, chargeTxTotal)}
                  </span>
                  <div className="flex gap-1">
                    <button onClick={() => loadChargeManagement(chargeTxPage - 1)} disabled={chargeTxPage === 1}
                      className="whitespace-nowrap px-3 py-1 rounded border text-[13px] disabled:opacity-40 hover:bg-gray-50">◀ 이전</button>
                    {(() => {
                      const totalPages = Math.ceil(chargeTxTotal / chargeTxPerPage);
                      const pages: number[] = [];
                      const start = Math.max(1, chargeTxPage - 2);
                      const end = Math.min(totalPages, start + 4);
                      for (let i = start; i <= end; i++) pages.push(i);
                      return pages.map(p => (
                        <button key={p} onClick={() => loadChargeManagement(p)}
                          className={`whitespace-nowrap px-3 py-1 rounded border text-[13px] ${chargeTxPage === p ? 'bg-emerald-600 text-white border-emerald-600' : 'hover:bg-gray-50'}`}>{p}</button>
                      ));
                    })()}
                    <button onClick={() => loadChargeManagement(chargeTxPage + 1)}
                      disabled={chargeTxPage >= Math.ceil(chargeTxTotal / chargeTxPerPage)}
                      className="whitespace-nowrap px-3 py-1 rounded border text-[13px] disabled:opacity-40 hover:bg-gray-50">다음 ▶</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
    </>
  );
}
