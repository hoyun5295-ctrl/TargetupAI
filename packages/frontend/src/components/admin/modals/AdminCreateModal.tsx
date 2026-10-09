/**
 * AdminCreateModal — 슈퍼관리자 AdminDashboard 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch, SetStateAction } from 'react';

export interface AdminCreateModalProps {
  adminCreate: { loginId: string; name: string; email: string; role: string; password: string; reason: string; } | null;
  adminRoleBusy: boolean;
  adminRoleOptions: any[];
  loadAdminAccounts: () => Promise<void>;
  setAdminCreate: Dispatch<SetStateAction<{ loginId: string; name: string; email: string; role: string; password: string; reason: string; } | null>>;
  setAdminRoleBusy: Dispatch<SetStateAction<boolean>>;
  showAlert: (title: string, message: string, variant?: 'success' | 'error' | 'warning' | 'info') => void;
}

export default function AdminCreateModal(props: AdminCreateModalProps) {
  const { adminCreate, adminRoleBusy, adminRoleOptions, loadAdminAccounts, setAdminCreate, setAdminRoleBusy, showAlert } = props;
  if (!(adminCreate)) return null; // ★ 분리 E — 본체와 같은 조건(타입 좁히기 · 본체가 이미 같은 조건으로 그린다)

  const handleAdminCreate = async () => {
    if (!adminCreate) return;
    setAdminRoleBusy(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/admin/admin-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(adminCreate),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) { showAlert('오류', data?.error || '계정 생성에 실패했습니다.', 'error'); return; }
      setAdminCreate(null);
      await loadAdminAccounts();
      showAlert('완료', '계정을 만들었습니다.\n최초 로그인에서 OTP 등록 화면이 뜨고, 그 다음 비밀번호를 바꿔야 들어갈 수 있습니다.', 'success');
    } finally { setAdminRoleBusy(false); }
  };
  return (
    <>
    {(
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3.5 border-b border-gray-100 flex justify-between items-center flex-shrink-0">
              <div>
                <h3 className="text-base font-bold">직원 계정 추가</h3>
                <p className="text-xs text-gray-500">최초 로그인에서 OTP 등록과 비밀번호 변경을 거칩니다</p>
              </div>
              <button onClick={() => setAdminCreate(null)} className="whitespace-nowrap text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>
            <div className="p-6 space-y-3.5 overflow-auto">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">아이디</label>
                <input
                  value={adminCreate.loginId}
                  onChange={(e) => setAdminCreate({ ...adminCreate, loginId: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })}
                  placeholder="suran"
                  className="w-full px-3 py-1.5 text-[13px] border border-gray-200 rounded-lg font-mono outline-none focus:border-emerald-500"
                />
                <p className="mt-1 text-[11px] text-gray-400">영문 소문자·숫자·밑줄 3~50자. 로그를 사람 단위로 남기려면 공용 아이디를 쓰지 않습니다.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">이름</label>
                  <input
                    value={adminCreate.name}
                    onChange={(e) => setAdminCreate({ ...adminCreate, name: e.target.value })}
                    placeholder="서수란"
                    className="w-full px-3 py-1.5 text-[13px] border border-gray-200 rounded-lg outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">등급</label>
                  <select
                    value={adminCreate.role}
                    onChange={(e) => setAdminCreate({ ...adminCreate, role: e.target.value })}
                    className="w-full px-3 py-1.5 text-[13px] border border-gray-200 rounded-lg outline-none focus:border-emerald-500"
                  >
                    {adminRoleOptions.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">이메일 (선택)</label>
                <input
                  value={adminCreate.email}
                  onChange={(e) => setAdminCreate({ ...adminCreate, email: e.target.value })}
                  className="w-full px-3 py-1.5 text-[13px] border border-gray-200 rounded-lg outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">초기 비밀번호</label>
                <input
                  type="password"
                  value={adminCreate.password}
                  onChange={(e) => setAdminCreate({ ...adminCreate, password: e.target.value })}
                  className="w-full px-3 py-1.5 text-[13px] border border-gray-200 rounded-lg outline-none focus:border-emerald-500"
                />
                <p className="mt-1 text-[11px] text-gray-400">10자 이상. 본인이 첫 로그인에서 반드시 바꿉니다.</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">발급 사유 (선택)</label>
                <input
                  value={adminCreate.reason}
                  onChange={(e) => setAdminCreate({ ...adminCreate, reason: e.target.value })}
                  placeholder="예: 지원팀장 개인 계정 발급"
                  className="w-full px-3 py-1.5 text-[13px] border border-gray-200 rounded-lg outline-none focus:border-emerald-500"
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t flex justify-end gap-2 flex-shrink-0">
              <button onClick={() => setAdminCreate(null)} className="whitespace-nowrap px-4 py-2 text-[13px] border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50">취소</button>
              <button
                onClick={handleAdminCreate}
                disabled={adminRoleBusy || !adminCreate.loginId.trim() || !adminCreate.name.trim() || adminCreate.password.length < 10}
                className="whitespace-nowrap px-4 py-2 text-[13px] font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-40"
              >
                {adminRoleBusy ? '만드는 중...' : '계정 만들기'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
