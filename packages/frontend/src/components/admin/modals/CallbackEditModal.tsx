/**
 * CallbackEditModal — 슈퍼관리자 AdminDashboard 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch } from 'react';

export interface CallbackEditModalProps {
  editingCallback: any;
  loadCallbackNumbers: () => Promise<void>;
  setEditingCallback: Dispatch<any>;
  showAlert: (title: string, message: string, variant?: 'success' | 'error' | 'warning' | 'info') => void;
}

export default function CallbackEditModal(props: CallbackEditModalProps) {
  const { editingCallback, loadCallbackNumbers, setEditingCallback, showAlert } = props;
  if (!(editingCallback)) return null; // ★ 분리 E — 본체와 같은 조건(타입 좁히기 · 본체가 이미 같은 조건으로 그린다)

  const handleUpdateCallback = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCallback) return;
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/admin/callback-numbers/${editingCallback.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ phone: editingCallback.phone, label: editingCallback.label })
      });
      if (!res.ok) throw new Error('수정 실패');
      setEditingCallback(null);
      loadCallbackNumbers();
      showAlert('성공', '발신번호가 수정되었습니다.', 'success');
    } catch (error) {
      showAlert('오류', '수정 실패', 'error');
    }
  };
  return (
    <>
    {(
        <div className="fixed inset-0 bg-gray-900/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6">
              <h3 className="text-base font-semibold text-gray-800 mb-4">발신번호 수정</h3>
              <form onSubmit={handleUpdateCallback} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">발신번호 *</label>
                  <input
                    type="text"
                    value={editingCallback.phone}
                    onChange={(e) => setEditingCallback({ ...editingCallback, phone: e.target.value })}
                    className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">별칭</label>
                  <input
                    type="text"
                    value={editingCallback.label}
                    onChange={(e) => setEditingCallback({ ...editingCallback, label: e.target.value })}
                    className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none"
                    placeholder="예: 대표번호, 강남점"
                  />
                </div>
                <div className="flex gap-2 pt-2">
                  <button type="button" onClick={() => setEditingCallback(null)}
                    className="whitespace-nowrap flex-1 px-4 py-2 border rounded-lg text-gray-700 hover:bg-gray-50">취소</button>
                  <button type="submit"
                    className="whitespace-nowrap flex-1 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">저장</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
