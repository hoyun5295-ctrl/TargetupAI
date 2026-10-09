/**
 * TemplateRejectModal — 슈퍼관리자 AdminDashboard 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch, SetStateAction } from 'react';
import type { ModalState } from '../admin-types';

export interface TemplateRejectModalProps {
  loadAdminRcsTemplates: () => Promise<void>;
  loadAdminTemplates: () => Promise<void>;
  rejectModal: { show: boolean; id: string; reason: string; };
  setModal: Dispatch<SetStateAction<ModalState>>;
  setRejectModal: Dispatch<SetStateAction<{ show: boolean; id: string; reason: string; }>>;
}

export default function TemplateRejectModal(props: TemplateRejectModalProps) {
  const { loadAdminRcsTemplates, loadAdminTemplates, rejectModal, setModal, setRejectModal } = props;
  if (!(rejectModal.show)) return null; // ★ 분리 E — 본체와 같은 조건(타입 좁히기 · 본체가 이미 같은 조건으로 그린다)

const handleTemplateRejectConfirm = async () => {
  if (!rejectModal.reason.trim()) {
    setModal({ type: 'alert', title: '입력 오류', message: '반려 사유를 입력해주세요', variant: 'error' });
    return;
  }
  try {
    const tk = localStorage.getItem('token');
    const res = await fetch(`/api/admin/kakao-templates/${rejectModal.id}/reject`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: JSON.stringify({ rejectReason: rejectModal.reason.trim() }) });
    const data = await res.json();
    setRejectModal({ show: false, id: '', reason: '' });
    if (data.success) { loadAdminTemplates(); loadAdminRcsTemplates(); setModal({ type: 'alert', title: '반려 완료', message: '템플릿이 반려되었습니다', variant: 'success' }); }
    else setModal({ type: 'alert', title: '반려 실패', message: data.error, variant: 'error' });
  } catch { setModal({ type: 'alert', title: '오류', message: '서버 오류', variant: 'error' }); }
};
  return (
    <>
    {(
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-[60]">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-[zoomIn_0.25s_ease-out]">
            <div className="px-6 pt-6 pb-2 text-center">
              <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-amber-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
              </div>
              <h3 className="text-base font-bold text-gray-900">템플릿 반려</h3>
              <p className="text-sm text-gray-500 mt-1">반려 사유를 입력해주세요</p>
            </div>
            <div className="px-6 py-3">
              <textarea
                value={rejectModal.reason}
                onChange={e => setRejectModal(prev => ({ ...prev, reason: e.target.value }))}
                placeholder="반려 사유를 입력하세요..."
                rows={3}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-[13px] resize-none focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                autoFocus
              />
            </div>
            <div className="px-6 pb-6 pt-2 flex gap-3">
              <button
                onClick={() => setRejectModal({ show: false, id: '', reason: '' })}
                className="whitespace-nowrap flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium py-2.5 rounded-xl text-[13px] transition"
              >
                취소
              </button>
              <button
                onClick={handleTemplateRejectConfirm}
                className="whitespace-nowrap flex-1 bg-amber-600 hover:bg-amber-700 text-white font-medium py-2.5 rounded-xl text-[13px] transition"
              >
                반려
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
