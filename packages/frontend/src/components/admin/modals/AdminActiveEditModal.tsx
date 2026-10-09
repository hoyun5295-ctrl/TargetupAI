/**
 * AdminActiveEditModal — 슈퍼관리자 AdminDashboard 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch, SetStateAction } from 'react';

export interface AdminActiveEditModalProps {
  adminActiveEdit: { id: string; login_id: string; isActive: boolean; reason: string; } | null;
  adminRoleBusy: boolean;
  loadAdminAccounts: () => Promise<void>;
  setAdminActiveEdit: Dispatch<SetStateAction<{ id: string; login_id: string; isActive: boolean; reason: string; } | null>>;
  setAdminRoleBusy: Dispatch<SetStateAction<boolean>>;
  showAlert: (title: string, message: string, variant?: 'success' | 'error' | 'warning' | 'info') => void;
}

export default function AdminActiveEditModal(props: AdminActiveEditModalProps) {
  const { adminActiveEdit, adminRoleBusy, loadAdminAccounts, setAdminActiveEdit, setAdminRoleBusy, showAlert } = props;
  if (!(adminActiveEdit)) return null; // ★ 분리 E — 본체와 같은 조건(타입 좁히기 · 본체가 이미 같은 조건으로 그린다)

  const handleAdminActiveSave = async () => {
    if (!adminActiveEdit) return;
    if (!adminActiveEdit.reason.trim()) { showAlert('확인', '사유를 입력해주세요.', 'error'); return; }
    setAdminRoleBusy(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/admin/admin-accounts/${adminActiveEdit.id}/active`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ isActive: adminActiveEdit.isActive, reason: adminActiveEdit.reason.trim() }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) { showAlert('오류', data?.error || '상태 변경에 실패했습니다.', 'error'); return; }
      const wasDisable = !adminActiveEdit.isActive;
      setAdminActiveEdit(null);
      await loadAdminAccounts();
      // ★1003 중지는 접속 중인 세션까지 끊는다(서버가 끊은 건수를 돌려준다)
      if (wasDisable) {
        const ended = Number(data?.sessionsEnded || 0);
        showAlert('완료', ended > 0 ? `사용을 중지했습니다. 접속 중이던 세션 ${ended}건을 끊었습니다.` : '사용을 중지했습니다. 접속 중인 세션은 없었습니다.', 'success');
      }
    } finally { setAdminRoleBusy(false); }
  };
  return (
    <>
    {(
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3.5 border-b border-gray-100 flex justify-between items-center">
              <div>
                <h3 className="text-base font-bold">{adminActiveEdit.isActive ? '계정 사용 재개' : '계정 사용 중지'}</h3>
                <p className="text-xs text-gray-500 font-mono">{adminActiveEdit.login_id}</p>
              </div>
              <button onClick={() => setAdminActiveEdit(null)} className="whitespace-nowrap text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>
            <div className="p-6 space-y-3">
              <p className="text-xs text-gray-500 leading-relaxed">
                계정 행은 지우지 않고 사용만 막습니다. 지우면 그 계정이 남긴 기록의 주인이 사라져 심사에 낼 이력이 끊깁니다.
              </p>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">사유 (필수)</label>
                <input
                  value={adminActiveEdit.reason}
                  onChange={(e) => setAdminActiveEdit({ ...adminActiveEdit, reason: e.target.value })}
                  placeholder="예: 공용 계정 폐지 · 개인 계정으로 전환"
                  className="w-full px-3 py-1.5 text-[13px] border border-gray-200 rounded-lg outline-none focus:border-emerald-500"
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t flex justify-end gap-2">
              <button onClick={() => setAdminActiveEdit(null)} className="whitespace-nowrap px-4 py-2 text-[13px] border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50">취소</button>
              <button
                onClick={handleAdminActiveSave}
                disabled={adminRoleBusy || !adminActiveEdit.reason.trim()}
                className={`whitespace-nowrap px-4 py-2 text-[13px] font-semibold text-white rounded-lg disabled:opacity-40 ${adminActiveEdit.isActive ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'}`}
              >
                {adminRoleBusy ? '저장 중...' : adminActiveEdit.isActive ? '사용 재개' : '사용 중지'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
