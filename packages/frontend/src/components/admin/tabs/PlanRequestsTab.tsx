/**
 * PlanRequestsTab — 슈퍼관리자 AdminDashboard 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import { useState, type Dispatch, type SetStateAction } from 'react';
import { formatDateTime, formatDate } from '../../../utils/formatDate';
import type { ModalState } from '../admin-types';
import { ADMIN_TABLE_ONELINE, ADMIN_TR_OPEN, AdminDetailItem, AdminDetailModal, AdminLongText, adminRowOpen } from '../ui/admin-ui'; // ★ 2026-10-20 표 칸 한 줄 · 행 = 상세 창

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
  // ★ 2026-10-20 행을 누르면 상세 창 · 승인 · 거절은 창 안에서(Harold 「클릭하면 모달 · 거기서 승인」) — 같은 처리 함수 · 같은 확인 창 · 같은 거절 창
  const [detail, setDetail] = useState<any | null>(null);
  const statusLabel = (st: string) => (st === 'pending' ? '대기' : st === 'approved' ? '승인' : st === 'rejected' ? '거절' : st);
  const isTrial = (req: any) => typeof req?.message === 'string' && req.message.startsWith('[무료체험]');

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
              <table className={`w-full text-[13px] ${ADMIN_TABLE_ONELINE}`}>
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
                      <tr key={req.id} {...adminRowOpen(() => setDetail(req))} className={`${ADMIN_TR_OPEN} ${req.status === 'pending' ? 'bg-yellow-50' : ''}`}>
                        <td className="px-4 py-2 text-center text-gray-600 whitespace-nowrap">
                          {formatDateTime(req.created_at)}
                        </td>
                        <td className="px-4 py-2">
                          <AdminLongText text={req.company_name} max={180} rowOpens className="font-medium text-gray-900" />
                          <div className="text-xs text-gray-500">{req.company_code}</div>
                        </td>
                        <td className="px-4 py-2 text-gray-900">
                          <AdminLongText text={`${req.user_name || '-'}${req.user_login_id ? ` (${req.user_login_id})` : ''}`} max={180} rowOpens />
                        </td>
                        <td className="px-4 py-2 text-center text-gray-600 whitespace-nowrap">
                          {req.current_plan_name || '-'}
                        </td>
                        <td className="px-4 py-2 text-center">
                          <span className="font-medium text-blue-600">{req.requested_plan_name}</span>
                          {isTrial(req) && (
                            <span className="ml-1 inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-fuchsia-100 text-fuchsia-700 align-middle">무료체험</span>
                          )}
                          <div className="text-xs text-gray-500">
                            {Number(req.requested_plan_price).toLocaleString()}원/월
                          </div>
                        </td>
                        <td className="px-4 py-2 text-gray-600">
                          <AdminLongText text={req.message} max={160} rowOpens />
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
                            <span className="inline-flex px-2.5 py-1 rounded bg-emerald-50 text-emerald-700 text-xs font-medium">승인 · 거절</span>
                          ) : (
                            <div className="text-xs text-gray-500">
                              <div>{req.processed_by_name || '-'}</div>
                              {req.processed_at && (
                                <div>{formatDate(req.processed_at)}</div>
                              )}
                              {req.admin_note && (
                                <AdminLongText text={req.admin_note} max={120} rowOpens className="text-red-600 mt-1" />
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                </table>
                {detail && (
                  <AdminDetailModal
                    title={`플랜 변경 신청 · ${detail.company_name || '-'}`}
                    onClose={() => setDetail(null)}
                    footer={detail.status === 'pending' ? (
                      <div className="flex gap-2">
                        <button type="button" onClick={() => { const req = detail; setDetail(null); setRejectTarget(req); setRejectReason(''); setShowRejectModal(true); }}
                          className="flex-1 h-9 rounded-lg border border-red-200 bg-white text-red-700 text-[13px] font-medium hover:bg-red-50">거절</button>
                        <button type="button" onClick={() => { const id = detail.id; setDetail(null); handleApproveRequest(id); }}
                          className="flex-1 h-9 rounded-lg bg-green-600 text-white text-[13px] font-medium hover:bg-green-700">승인</button>
                      </div>
                    ) : undefined}
                  >
                    <dl>
                      <AdminDetailItem label="신청일시">{formatDateTime(detail.created_at)}</AdminDetailItem>
                      <AdminDetailItem label="회사">{detail.company_name || '-'}{detail.company_code ? ` (${detail.company_code})` : ''}</AdminDetailItem>
                      <AdminDetailItem label="신청자">{detail.user_name || '-'}{detail.user_login_id ? ` (${detail.user_login_id})` : ''}</AdminDetailItem>
                      <AdminDetailItem label="현재 플랜">{detail.current_plan_name || '-'}</AdminDetailItem>
                      <AdminDetailItem label="신청 플랜">
                        <span className="font-medium text-blue-600">{detail.requested_plan_name}</span> · {Number(detail.requested_plan_price).toLocaleString()}원/월{isTrial(detail) ? ' · 무료체험' : ''}
                      </AdminDetailItem>
                      <AdminDetailItem label="메시지">{detail.message || '-'}</AdminDetailItem>
                      {/* ★ 2026-10-20 여정 V.3 §5-5 — 고객 신청 창과 같은 숫자(켜 둔 여정 한 달 운영 크레딧 · 승인은 막지 않는다) */}
                      {detail.status === 'pending' && (
                        <AdminDetailItem label="켜 둔 여정 크레딧">
                          {detail.journey_forecast == null
                            ? '확인 못 함'
                            : detail.journey_forecast.perLineage?.length
                              ? <span className={detail.requested_plan_credits != null && Number(detail.journey_forecast.total) > Number(detail.requested_plan_credits) ? 'text-amber-700 font-semibold' : ''}>
                                  여정 {detail.journey_forecast.perLineage.length}개 · 한 달 {Number(detail.journey_forecast.total).toLocaleString()}
                                  {detail.journey_forecast.basis === 'measured' ? '(지난 30일 실제)' : '(새 여정은 최대로 셈)'}
                                  {detail.requested_plan_credits != null ? ` · 신청 요금제 기본 ${Number(detail.requested_plan_credits).toLocaleString()}` : ''}
                                  {detail.requested_plan_credits != null && Number(detail.journey_forecast.total) > Number(detail.requested_plan_credits) ? ' · 모자라면 여정이 멈춰요' : ''}
                                </span>
                              : '켜 둔 여정 없음'}
                        </AdminDetailItem>
                      )}
                      <AdminDetailItem label="상태">{statusLabel(detail.status)}</AdminDetailItem>
                      {detail.status !== 'pending' && (
                        <AdminDetailItem label="처리">{detail.processed_by_name || '-'}{detail.processed_at ? ` · ${formatDate(detail.processed_at)}` : ''}</AdminDetailItem>
                      )}
                      {detail.admin_note && <AdminDetailItem label="관리자 메모"><span className="text-red-600">{detail.admin_note}</span></AdminDetailItem>}
                    </dl>
                  </AdminDetailModal>
                )}
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
