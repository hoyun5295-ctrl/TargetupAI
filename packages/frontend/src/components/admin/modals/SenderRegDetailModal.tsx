/**
 * SenderRegDetailModal — 슈퍼관리자 AdminDashboard 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch, SetStateAction } from 'react';
import { formatDateTime } from '../../../utils/formatDate';
import type { ModalState } from '../admin-types';

export interface SenderRegDetailModalProps {
  downloadSenderDoc: (filename: string, originalName?: string) => Promise<void>;
  loadCallbackNumbers: () => Promise<void>;
  loadSenderRegPendingCount: () => Promise<void>;
  loadSenderRegistrations: (status?: string) => Promise<void>;
  rejectReasonInput: string;
  senderRegDetail: any;
  senderRegFilter: 'all' | 'pending' | 'approved' | 'rejected';
  setModal: Dispatch<SetStateAction<ModalState>>;
  setRejectReasonInput: Dispatch<SetStateAction<string>>;
  setSenderRegDetail: Dispatch<any>;
  setShowSenderRegDetailModal: Dispatch<SetStateAction<boolean>>;
}

export default function SenderRegDetailModal(props: SenderRegDetailModalProps) {
  const { downloadSenderDoc, loadCallbackNumbers, loadSenderRegPendingCount, loadSenderRegistrations, rejectReasonInput, senderRegDetail, senderRegFilter, setModal, setRejectReasonInput, setSenderRegDetail, setShowSenderRegDetailModal } = props;

  const handleApproveSenderReg = async (id: string) => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/sender-registration/admin/${id}/approve`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (res.ok) {
        setModal({ type: 'alert', title: '승인 완료', message: '발신번호가 승인되어 등록되었습니다.', variant: 'success' });
        setShowSenderRegDetailModal(false);
        setSenderRegDetail(null);
        loadSenderRegistrations(senderRegFilter);
        loadSenderRegPendingCount();
        loadCallbackNumbers();
      } else {
        setModal({ type: 'alert', title: '승인 실패', message: data.error || '승인 처리에 실패했습니다.', variant: 'error' });
      }
    } catch (error) {
      console.error('승인 처리 실패:', error);
      setModal({ type: 'alert', title: '오류', message: '승인 처리 중 오류가 발생했습니다.', variant: 'error' });
    }
  };

  const handleRejectSenderReg = async (id: string) => {
    if (!rejectReasonInput.trim()) {
      setModal({ type: 'alert', title: '입력 필요', message: '반려 사유를 입력해주세요.', variant: 'warning' });
      return;
    }
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/sender-registration/admin/${id}/reject`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ rejectReason: rejectReasonInput.trim() })
      });
      const data = await res.json();
      if (res.ok) {
        setModal({ type: 'alert', title: '반려 완료', message: '신청이 반려되었습니다.', variant: 'success' });
        setShowSenderRegDetailModal(false);
        setSenderRegDetail(null);
        setRejectReasonInput('');
        loadSenderRegistrations(senderRegFilter);
        loadSenderRegPendingCount();
      } else {
        setModal({ type: 'alert', title: '반려 실패', message: data.error || '반려 처리에 실패했습니다.', variant: 'error' });
      }
    } catch (error) {
      console.error('반려 처리 실패:', error);
      setModal({ type: 'alert', title: '오류', message: '반려 처리 중 오류가 발생했습니다.', variant: 'error' });
    }
  };
  return (
    <>
    {(
        <div className="fixed inset-0 bg-gray-900/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="px-5 py-3.5 border-b border-gray-100 bg-gradient-to-r from-blue-50 to-indigo-50 flex justify-between items-center">
              <h3 className="text-base font-semibold text-gray-800">발신번호 등록 신청 상세</h3>
              <button onClick={() => { setShowSenderRegDetailModal(false); setSenderRegDetail(null); }} className="whitespace-nowrap text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>
            <div className="p-6 space-y-5 overflow-y-auto">
              {/* 기본 정보 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-xs text-gray-500 block">고객사</span>
                  <span className="text-sm font-medium text-gray-900">{senderRegDetail.company_name || '-'}</span>
                </div>
                <div>
                  <span className="text-xs text-gray-500 block">발신번호</span>
                  <span className="text-sm font-mono font-medium text-gray-900">{senderRegDetail.phone}</span>
                </div>
                <div>
                  <span className="text-xs text-gray-500 block">별칭</span>
                  <span className="text-sm text-gray-700">{senderRegDetail.label || '-'}</span>
                </div>
                <div>
                  <span className="text-xs text-gray-500 block">매장</span>
                  <span className="text-sm text-gray-700">{senderRegDetail.store_name || '-'}{senderRegDetail.store_code ? ` (${senderRegDetail.store_code})` : ''}</span>
                </div>
                <div>
                  <span className="text-xs text-gray-500 block">신청자</span>
                  <span className="text-sm text-gray-700">{senderRegDetail.requested_by_name || '-'}</span>
                </div>
                <div>
                  <span className="text-xs text-gray-500 block">신청일</span>
                  <span className="text-sm text-gray-700">{formatDateTime(senderRegDetail.created_at)}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-xs text-gray-500 block">상태</span>
                  <span className={`inline-block px-2 py-1 rounded-full text-xs font-medium mt-0.5 ${
                    senderRegDetail.status === 'pending' ? 'bg-yellow-100 text-yellow-800'
                    : senderRegDetail.status === 'approved' ? 'bg-green-100 text-green-800'
                    : 'bg-red-100 text-red-800'
                  }`}>
                    {senderRegDetail.status === 'pending' ? '승인 대기' : senderRegDetail.status === 'approved' ? '승인 완료' : '반려'}
                  </span>
                </div>
              </div>

              {/* 요청 메모 */}
              {senderRegDetail.request_note && (
                <div>
                  <span className="text-xs text-gray-500 block mb-1">신청 메모</span>
                  <p className="text-sm text-gray-700 bg-gray-50 rounded-lg p-3">{senderRegDetail.request_note}</p>
                </div>
              )}

              {/* 첨부 문서 */}
              <div>
                <span className="text-xs text-gray-500 block mb-2">첨부 문서</span>
                {(senderRegDetail.documents || []).length === 0 ? (
                  <p className="text-sm text-gray-400">첨부된 문서가 없습니다.</p>
                ) : (
                  <div className="space-y-2">
                    {(senderRegDetail.documents || []).map((doc: any, idx: number) => (
                      <div key={idx} className="flex items-center justify-between bg-gray-50 rounded-lg p-3">
                        <div>
                          <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium mr-2 ${
                            doc.type === 'telecom_cert' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                          }`}>
                            {doc.type === 'telecom_cert' ? '통신가입증명원' : '위임장'}
                          </span>
                          <span className="text-sm text-gray-700">{doc.originalName}</span>
                          {doc.fileSize && <span className="text-xs text-gray-400 ml-2">({(doc.fileSize / 1024).toFixed(0)}KB)</span>}
                        </div>
                        <button
                          onClick={() => downloadSenderDoc(doc.storedName, doc.originalName)}
                          className="whitespace-nowrap text-emerald-700 hover:text-emerald-800 text-[13px] font-medium"
                        >
                          다운로드
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 반려 사유 (반려된 경우) */}
              {senderRegDetail.status === 'rejected' && senderRegDetail.reject_reason && (
                <div>
                  <span className="text-xs text-gray-500 block mb-1">반려 사유</span>
                  <p className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{senderRegDetail.reject_reason}</p>
                </div>
              )}

              {/* 승인/반려 액션 (pending일 때만) */}
              {senderRegDetail.status === 'pending' && (
                <div className="border-t pt-5 space-y-4">
                  <div className="flex gap-3">
                    <button
                      onClick={() => handleApproveSenderReg(senderRegDetail.id)}
                      className="whitespace-nowrap flex-1 px-4 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium text-[13px]"
                    >
                      승인 (발신번호 등록)
                    </button>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">반려 사유</label>
                    <textarea
                      value={rejectReasonInput}
                      onChange={(e) => setRejectReasonInput(e.target.value)}
                      placeholder="반려 사유를 입력해주세요..."
                      className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-red-500 outline-none resize-none"
                      rows={2}
                    />
                    <button
                      onClick={() => handleRejectSenderReg(senderRegDetail.id)}
                      className="whitespace-nowrap mt-2 w-full px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium text-[13px]"
                    >
                      반려
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
