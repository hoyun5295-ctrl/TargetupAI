/**
 * ManualTemplateFormModal — 슈퍼관리자 AdminDashboard 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch, SetStateAction } from 'react';
import type { Company } from '../admin-types';
import type { ModalState } from '../admin-types';

export interface ManualTemplateFormModalProps {
  companies: Company[];
  loadAdminTemplates: () => Promise<void>;
  manualForm: { companyId: string; templateCode: string; templateName: string; category: string; messageType: string; content: string; };
  setManualForm: Dispatch<SetStateAction<{ companyId: string; templateCode: string; templateName: string; category: string; messageType: string; content: string; }>>;
  setModal: Dispatch<SetStateAction<ModalState>>;
  setShowManualTemplateForm: Dispatch<SetStateAction<boolean>>;
}

export default function ManualTemplateFormModal(props: ManualTemplateFormModalProps) {
  const { companies, loadAdminTemplates, manualForm, setManualForm, setModal, setShowManualTemplateForm } = props;

const handleManualTemplateSubmit = async () => {
  if (!manualForm.companyId || !manualForm.templateName || !manualForm.content) {
    setModal({ type: 'alert', title: '입력 오류', message: '고객사, 템플릿명, 본문은 필수입니다', variant: 'error' });
    return;
  }
  try {
    const tk = localStorage.getItem('token');
    const res = await fetch('/api/admin/kakao-templates/manual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` },
      body: JSON.stringify(manualForm),
    });
    const data = await res.json();
    if (data.success) {
      setShowManualTemplateForm(false);
      setManualForm({ companyId: '', templateCode: '', templateName: '', category: '', messageType: 'BA', content: '' });
      loadAdminTemplates();
      setModal({ type: 'alert', title: '등록 완료', message: '템플릿이 승인 상태로 등록되었습니다', variant: 'success' });
    } else setModal({ type: 'alert', title: '등록 실패', message: data.error, variant: 'error' });
  } catch { setModal({ type: 'alert', title: '오류', message: '서버 오류', variant: 'error' }); }
};
  return (
    <>
    {(
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gray-100 bg-gradient-to-r from-amber-50 to-white flex justify-between items-center">
              <div>
                <h3 className="text-base font-bold">기존 템플릿 수동 등록</h3>
                <p className="text-xs text-gray-500">이미 카카오에 등록된 템플릿을 승인 상태로 직접 등록합니다</p>
              </div>
              <button onClick={() => setShowManualTemplateForm(false)} className="whitespace-nowrap text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>
            <div className="px-6 py-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">고객사 <span className="text-red-500">*</span></label>
                <select value={manualForm.companyId} onChange={e => setManualForm({ ...manualForm, companyId: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-[13px]">
                  <option value="">선택</option>
                  {companies.map((c: any) => <option key={c.id} value={c.id}>{c.companyName || c.company_name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">템플릿 코드</label>
                  <input value={manualForm.templateCode} onChange={e => setManualForm({ ...manualForm, templateCode: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-[13px]" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">카테고리</label>
                  <select value={manualForm.category} onChange={e => setManualForm({ ...manualForm, category: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-[13px]">
                    <option value="">선택</option>
                    {['결제/입금','배송/물류','예약/일정','회원가입/인증','공지/안내','주문/구매','이벤트/프로모션','고객관리','기타'].map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">템플릿명 <span className="text-red-500">*</span></label>
                <input value={manualForm.templateName} onChange={e => setManualForm({ ...manualForm, templateName: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-[13px]" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">본문 <span className="text-red-500">*</span></label>
                <textarea value={manualForm.content} onChange={e => setManualForm({ ...manualForm, content: e.target.value })}
                  rows={5} className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-[13px] resize-none" />
              </div>
            </div>
            <div className="px-6 py-3 border-t bg-gray-50 flex justify-end gap-3">
              <button onClick={() => setShowManualTemplateForm(false)}
                className="whitespace-nowrap px-5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-[13px]">취소</button>
              <button onClick={handleManualTemplateSubmit}
                className="whitespace-nowrap px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-[13px] font-medium">승인 상태로 등록</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
