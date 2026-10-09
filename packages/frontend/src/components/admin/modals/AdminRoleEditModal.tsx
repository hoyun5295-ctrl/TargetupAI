/**
 * AdminRoleEditModal — 슈퍼관리자 AdminDashboard 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch, SetStateAction } from 'react';

export interface AdminRoleEditModalProps {
  adminRoleBusy: boolean;
  adminRoleEdit: { id: string; login_id: string; role: string; reason: string; } | null;
  adminRoleOptions: any[];
  loadAdminAccounts: () => Promise<void>;
  setAdminRoleBusy: Dispatch<SetStateAction<boolean>>;
  setAdminRoleEdit: Dispatch<SetStateAction<{ id: string; login_id: string; role: string; reason: string; } | null>>;
  showAlert: (title: string, message: string, variant?: 'success' | 'error' | 'warning' | 'info') => void;
}

export default function AdminRoleEditModal(props: AdminRoleEditModalProps) {
  const { adminRoleBusy, adminRoleEdit, adminRoleOptions, loadAdminAccounts, setAdminRoleBusy, setAdminRoleEdit, showAlert } = props;
  if (!(adminRoleEdit)) return null; // ★ 분리 E — 본체와 같은 조건(타입 좁히기 · 본체가 이미 같은 조건으로 그린다)

  const handleAdminRoleSave = async () => {
    if (!adminRoleEdit) return;
    if (!adminRoleEdit.reason.trim()) { showAlert('확인', '변경 사유를 입력해주세요.', 'error'); return; }
    setAdminRoleBusy(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/admin/admin-accounts/${adminRoleEdit.id}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ role: adminRoleEdit.role, reason: adminRoleEdit.reason.trim() }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) { showAlert('오류', data?.error || '등급 변경에 실패했습니다.', 'error'); return; }
      setAdminRoleEdit(null);
      await loadAdminAccounts();
    } finally { setAdminRoleBusy(false); }
  };
  return (
    <>
    {(
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3.5 border-b border-gray-100 flex justify-between items-center">
              <div>
                <h3 className="text-base font-bold">등급 변경</h3>
                <p className="text-xs text-gray-500 font-mono">{adminRoleEdit.login_id}</p>
              </div>
              <button onClick={() => setAdminRoleEdit(null)} className="whitespace-nowrap text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">등급</label>
                <select
                  value={adminRoleEdit.role}
                  onChange={(e) => setAdminRoleEdit({ ...adminRoleEdit, role: e.target.value })}
                  className="w-full px-3 py-1.5 text-[13px] border border-gray-200 rounded-lg outline-none focus:border-emerald-500"
                >
                  {adminRoleOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <p className="mt-1.5 text-[11px] text-gray-500 leading-relaxed">
                  {adminRoleOptions.find((o) => o.value === adminRoleEdit.role)?.desc || ''}
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">변경 사유 (필수)</label>
                <input
                  value={adminRoleEdit.reason}
                  onChange={(e) => setAdminRoleEdit({ ...adminRoleEdit, reason: e.target.value })}
                  placeholder="예: 지원팀장 승진에 따른 권한 조정"
                  className="w-full px-3 py-1.5 text-[13px] border border-gray-200 rounded-lg outline-none focus:border-emerald-500"
                />
                <p className="mt-1.5 text-[11px] text-gray-400">이 사유가 접근권한 변경 이력 대장에 그대로 남습니다.</p>
              </div>
            </div>
            <div className="px-6 py-4 border-t flex justify-end gap-2">
              <button onClick={() => setAdminRoleEdit(null)} className="whitespace-nowrap px-4 py-2 text-[13px] border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50">취소</button>
              <button
                onClick={handleAdminRoleSave}
                disabled={adminRoleBusy || !adminRoleEdit.reason.trim()}
                className="whitespace-nowrap px-4 py-2 text-[13px] font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-40"
              >
                {adminRoleBusy ? '저장 중...' : '변경 저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
