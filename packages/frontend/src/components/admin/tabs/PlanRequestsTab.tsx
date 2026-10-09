/**
 * PlanRequestsTab — 슈퍼관리자 AdminDashboard 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch, SetStateAction } from 'react';
import { formatDateTime, formatDate } from '../../../utils/formatDate';
import type { ModalState } from '../admin-types';

export interface PlanRequestsTabProps {
  closeModal: () => void;
  loadData: () => Promise<void>;
  loadPlanRequests: () => Promise<void>;
  planRequests: any[];
  requestPage: number;
  setModal: Dispatch<SetStateAction<ModalState>>;
  setRejectReason: Dispatch<SetStateAction<string>>;
  setRejectTarget: Dispatch<any>;
  setRequestPage: Dispatch<SetStateAction<number>>;
  setShowRejectModal: Dispatch<SetStateAction<boolean>>;
}

export default function PlanRequestsTab(props: PlanRequestsTabProps) {
  const { closeModal, loadData, loadPlanRequests, planRequests, requestPage, setModal, setRejectReason, setRejectTarget, setRequestPage, setShowRejectModal } = props;
  const requestPerPage = 10;

const handleApproveRequest = async (id: string) => {
  setModal({
      type: 'confirm',
      title: '플랜 변경 승인',
      // ★ 2026-10-04 선불 이용 기간 회사는 돈이 함께 움직인다(올림 = 남은 기간 차액 즉시 · 내림 = 만료 다음 날부터 · 잠김 = 1개월 결제로 다시 열기)
      message: '이 신청을 승인하시겠습니까?\n승인 시 즉시 플랜이 변경됩니다.\n선불 이용 기간 회사: 올림은 남은 기간 차액을 충전 잔액에서 바로 빼고, 내림은 만료 다음 날부터 적용합니다.',
      onConfirm: async () => {
        try {
          const token = localStorage.getItem('token');
          const res = await fetch(`/api/admin/plan-requests/${id}/approve`, {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({})
          });
          
          if (res.ok) {
            const okData = await res.json().catch(() => ({}));
            closeModal();
            // ★ 2026-10-04 선불 이용 기간 처리 결과(차감액·적용일)는 서버 문장을 그대로 보인다
            setModal({ type: 'alert', title: '승인 완료', message: okData?.plan_term ? okData.message : '플랜이 변경되었습니다.', variant: 'success' });
            loadPlanRequests();
            loadData();
          } else {
            const data = await res.json();
            closeModal();
            setModal({ type: 'alert', title: '승인 실패', message: data.error || '승인에 실패했습니다.', variant: 'error' });
          }
        } catch (error) {
          closeModal();
          setModal({ type: 'alert', title: '오류', message: '처리 중 오류가 발생했습니다.', variant: 'error' });
        }
      }
    });
  };
  return (
    <>
    {(
          <div className="bg-white rounded-xl border border-gray-200/80 shadow-sm">
            <div className="px-5 py-3.5 border-b border-gray-100">
              <h2 className="text-base font-semibold">플랜 변경 신청 목록</h2>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 whitespace-nowrap">신청일시</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">회사</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">신청자</th>
                    <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 whitespace-nowrap">현재 플랜</th>
                    <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 whitespace-nowrap">신청 플랜</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">메시지</th>
                    <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 whitespace-nowrap">상태</th>
                    <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 whitespace-nowrap">처리</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {planRequests.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-6 py-12 text-center text-gray-500">
                        플랜 변경 신청이 없습니다.
                      </td>
                    </tr>
                  ) : (
                    planRequests
                      .slice((requestPage - 1) * requestPerPage, requestPage * requestPerPage)
                      .map((req) => (
                      <tr key={req.id} className={`hover:bg-gray-50 ${req.status === 'pending' ? 'bg-yellow-50' : ''}`}>
                        <td className="px-4 py-2 text-center text-gray-600 whitespace-nowrap">
                          {formatDateTime(req.created_at)}
                        </td>
                        <td className="px-4 py-2">
                          <div className="font-medium text-gray-900">{req.company_name}</div>
                          <div className="text-xs text-gray-500">{req.company_code}</div>
                        </td>
                        <td className="px-4 py-2 text-gray-900">
                          {req.user_name} ({req.user_login_id})
                        </td>
                        <td className="px-4 py-2 text-center text-gray-600 whitespace-nowrap">
                          {req.current_plan_name || '-'}
                        </td>
                        <td className="px-4 py-2 text-center">
                          <span className="font-medium text-blue-600">{req.requested_plan_name}</span>
                          {typeof req.message === 'string' && req.message.startsWith('[무료체험]') && (
                            <span className="ml-1 inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-fuchsia-100 text-fuchsia-700 align-middle">무료체험</span>
                          )}
                          <div className="text-xs text-gray-500">
                            {Number(req.requested_plan_price).toLocaleString()}원/월
                          </div>
                        </td>
                        <td className="px-4 py-2 text-gray-600 max-w-[200px] truncate" title={req.message}>
                          {req.message || '-'}
                        </td>
                        <td className="px-4 py-2 text-center">
                          {req.status === 'pending' && (
                            <span className="px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">대기</span>
                          )}
                          {req.status === 'approved' && (
                            <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">승인</span>
                          )}
                          {req.status === 'rejected' && (
                            <span className="px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">거절</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-center">
                          {req.status === 'pending' ? (
                            <div className="flex justify-center gap-2">
                              <button
                                onClick={() => handleApproveRequest(req.id)}
                                className="whitespace-nowrap px-3 py-1 bg-green-600 text-white rounded text-[13px] hover:bg-green-700"
                              >
                                승인
                              </button>
                              <button
                                onClick={() => {
                                  setRejectTarget(req);
                                  setRejectReason('');
                                  setShowRejectModal(true);
                                }}
                                className="whitespace-nowrap px-3 py-1 bg-red-600 text-white rounded text-[13px] hover:bg-red-700"
                              >
                                거절
                              </button>
                            </div>
                          ) : (
                            <div className="text-xs text-gray-500">
                              <div>{req.processed_by_name || '-'}</div>
                              {req.processed_at && (
                                <div>{formatDate(req.processed_at)}</div>
                              )}
                              {req.admin_note && (
                                <div className="text-red-600 mt-1" title={req.admin_note}>
                                  {req.admin_note.length > 10 ? req.admin_note.slice(0, 10) + '...' : req.admin_note}
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                </table>
            </div>
            {planRequests.length > requestPerPage && (
              <div className="px-6 py-4 border-t flex items-center justify-between">
                <span className="text-sm text-gray-500">
                  총 {planRequests.length}개 중 {(requestPage - 1) * requestPerPage + 1}-{Math.min(requestPage * requestPerPage, planRequests.length)}
                </span>
                <div className="flex gap-1">
                  <button onClick={() => setRequestPage(p => Math.max(1, p - 1))} disabled={requestPage === 1}
                    className="whitespace-nowrap px-3 py-1 rounded border text-[13px] disabled:opacity-40 hover:bg-gray-50">◀ 이전</button>
                  {Array.from({ length: Math.ceil(planRequests.length / requestPerPage) }, (_, i) => i + 1).map(p => (
                    <button key={p} onClick={() => setRequestPage(p)}
                      className={`whitespace-nowrap px-3 py-1 rounded border text-[13px] ${requestPage === p ? 'bg-emerald-600 text-white border-emerald-600' : 'hover:bg-gray-50'}`}>{p}</button>
                  ))}
                  <button onClick={() => setRequestPage(p => Math.min(Math.ceil(planRequests.length / requestPerPage), p + 1))}
                    disabled={requestPage >= Math.ceil(planRequests.length / requestPerPage)}
                    className="whitespace-nowrap px-3 py-1 rounded border text-[13px] disabled:opacity-40 hover:bg-gray-50">다음 ▶</button>
                </div>
              </div>
            )}
          </div>
        )}
    </>
  );
}
