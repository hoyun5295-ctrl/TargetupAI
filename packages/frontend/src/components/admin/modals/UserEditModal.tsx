/**
 * UserEditModal — 슈퍼관리자 AdminDashboard 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch } from 'react';
import type { Company } from '../admin-types';

export interface UserEditModalProps {
  companies: Company[];
  editingUser: any;
  lineGroups: any[];
  loadUsers: () => Promise<void>;
  setEditingUser: Dispatch<any>;
  showAlert: (title: string, message: string, variant?: 'success' | 'error' | 'warning' | 'info') => void;
  showConfirm: (title: string, message: string, onConfirm: () => void) => void;
}

export default function UserEditModal(props: UserEditModalProps) {
  const { companies, editingUser, lineGroups, loadUsers, setEditingUser, showAlert, showConfirm } = props;
  if (!(editingUser)) return null; // ★ 분리 E — 본체와 같은 조건(타입 좁히기 · 본체가 이미 같은 조건으로 그린다)

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;

    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/admin/users/${editingUser.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          name: editingUser.name,
          email: editingUser.email,
          phone: editingUser.phone,
          department: editingUser.department,
          userType: editingUser.user_type,
          status: editingUser.status,
          storeCodes: editingUser.storeCodes ? editingUser.storeCodes.split(',').map((s: string) => s.trim()).filter(Boolean) : null,
          lineGroupId: editingUser.line_group_id || null,
          optOut080Number: editingUser.opt_out_080_number || null,
          optOutAutoSync: editingUser.opt_out_auto_sync || false
        })
      });

      if (!res.ok) throw new Error('수정 실패');

      // ★ 2026-08-18 로그인 인증번호는 별도 endpoint — 변경 시 신뢰 기기 해제 + 전용 이력이 남는다
      const mfaRes = await fetch(`/api/admin/users/${editingUser.id}/mfa-phone`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ mfaPhone: editingUser.mfa_phone || '' }),
      });
      if (!mfaRes.ok) {
        const mfaErr = await mfaRes.json().catch(() => ({} as any));
        setEditingUser(null);
        loadUsers();
        showAlert('일부 저장됨', mfaErr?.error || '로그인 인증번호는 저장하지 못했습니다.', 'error');
        return;
      }

      setEditingUser(null);
      loadUsers();
      showAlert('성공', '사용자 정보가 수정되었습니다.', 'success');
    } catch (error) {
      showAlert('오류', '수정 실패', 'error');
    }
  };
  return (
    <>
    {(
        <div className="fixed inset-0 bg-gray-900/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gray-100 bg-gradient-to-r from-blue-50 to-indigo-50">
              <h3 className="text-base font-semibold text-gray-800">사용자 수정</h3>
            </div>
            <form onSubmit={handleUpdateUser} className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">로그인 ID</label>
                <input
                  type="text"
                  value={editingUser.login_id}
                  disabled
                  className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] bg-gray-100 text-gray-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">이름 *</label>
                <input
                  type="text"
                  value={editingUser.name}
                  onChange={(e) => setEditingUser({ ...editingUser, name: e.target.value })}
                  className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">이메일</label>
                <input
                  type="email"
                  value={editingUser.email || ''}
                  onChange={(e) => setEditingUser({ ...editingUser, email: e.target.value })}
                  className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">연락처</label>
                <input
                  type="text"
                  value={editingUser.phone || ''}
                  onChange={(e) => setEditingUser({ ...editingUser, phone: e.target.value })}
                  className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">부서</label>
                <input
                  type="text"
                  value={editingUser.department || ''}
                  onChange={(e) => setEditingUser({ ...editingUser, department: e.target.value })}
                  className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none"
                />
              </div>
              {/* ★ 2026-08-18 로그인 인증번호 — 계정당 하나. 계약 담당자 번호를 여기서 등록한다 */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  로그인 인증번호 <span className="text-xs font-normal text-gray-400">(휴대폰 · 계정당 1개)</span>
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="01012345678 (비우면 인증 해제)"
                  value={editingUser.mfa_phone || ''}
                  onChange={(e) => setEditingUser({ ...editingUser, mfa_phone: e.target.value.replace(/\D/g, '').slice(0, 11) })}
                  className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none"
                />
                <p className="text-[11px] text-gray-400 mt-1">
                  로그인 시 이 번호로 6자리를 보냅니다. 번호를 바꾸면 기존 기기 인증이 모두 해제됩니다.
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">권한</label>
                <select
                  value={editingUser.user_type}
                  onChange={(e) => setEditingUser({ ...editingUser, user_type: e.target.value })}
                  className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none"
                >
                  <option value="user">일반 사용자</option>
                  <option value="admin">회사 관리자</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">발송 라인그룹</label>
                <select
                  value={editingUser.line_group_id || ''}
                  onChange={(e) => setEditingUser({ ...editingUser, line_group_id: e.target.value || null })}
                  className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none"
                >
                  <option value="">회사 기본 라인그룹 사용</option>
                  {lineGroups.filter((lg: any) => (lg.group_type === 'bulk' || lg.group_type === 'bito') && lg.is_active).map((lg: any) => (
                    <option key={lg.id} value={lg.id}>{lg.group_name} ({lg.sms_tables?.length || 0}개 테이블)</option>
                  ))}
                </select>
                <p className="text-xs text-gray-400 mt-1">개별 라인그룹 설정 시 이 사용자의 발송은 해당 라인으로 분리됩니다</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">담당 분류 코드</label>
                {(() => {
                  const selectedCompany = companies.find(c => c.id === editingUser.company_id);
                  const storeList = (selectedCompany as any)?.store_code_list || [];
                  
                  if (storeList.length === 0) {
                    return <p className="text-xs text-gray-400">이 회사는 분류 코드가 없습니다 (전체 접근)</p>;
                  }
                  
                  return (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {storeList.map((code: string) => {
                        const selected = (editingUser.storeCodes || '').split(',').map((s: string) => s.trim()).filter(Boolean);
                        const isChecked = selected.includes(code);
                        return (
                          <label key={code} className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[13px] cursor-pointer border transition-colors ${isChecked ? 'bg-blue-100 text-blue-800 border-blue-300' : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'}`}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                const newSelected = e.target.checked
                                  ? [...selected, code]
                                  : selected.filter((s: string) => s !== code);
                                setEditingUser({ ...editingUser, storeCodes: newSelected.join(', ') });
                              }}
                              className="sr-only"
                            />
                            {code}
                          </label>
                        );
                      })}
                    </div>
                  );
                })()}
                <p className="text-xs text-gray-500 mt-2">비워두면 전체 고객 조회 가능</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">상태</label>
                <select
                  value={editingUser.status}
                  onChange={(e) => setEditingUser({ ...editingUser, status: e.target.value })}
                  className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none"
                >
                  <option value="active">활성</option>
                  <option value="locked">잠금</option>
                  <option value="dormant">휴면</option>
                  </select>
              </div>

              {/* 080 수신거부 자동연동 섹션 */}
              <div className="border-t pt-4 mt-4">
                <div className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  080 수신거부 자동연동 (나래인터넷)
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">080 수신거부번호</label>
                    <input
                      type="text"
                      value={editingUser.opt_out_080_number || ''}
                      onChange={(e) => setEditingUser({ ...editingUser, opt_out_080_number: e.target.value })}
                      className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none"
                      placeholder="예: 080-719-6700"
                    />
                    <p className="text-xs text-gray-400 mt-1">나래인터넷에서 발급받은 080번호 입력. 콜백 시 이 번호로 사용자 매칭</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="block text-xs font-medium text-gray-500">자동연동</label>
                    <button
                      type="button"
                      onClick={() => setEditingUser({ ...editingUser, opt_out_auto_sync: !editingUser.opt_out_auto_sync })}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${editingUser.opt_out_auto_sync ? 'bg-green-500' : 'bg-gray-300'}`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${editingUser.opt_out_auto_sync ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                    <span className={`text-sm ${editingUser.opt_out_auto_sync ? 'text-green-600 font-medium' : 'text-gray-400'}`}>
                      {editingUser.opt_out_auto_sync ? 'ON' : 'OFF'}
                    </span>
                  </div>
                  {!editingUser.opt_out_080_number && editingUser.opt_out_auto_sync && (
                    <p className="text-xs text-orange-500">⚠️ 080번호를 입력해야 자동연동이 작동합니다</p>
                  )}
                </div>

                {/* 업로드 고객 DB 현황 */}
                {editingUser.uploaded_customer_count > 0 && (
                  <div className="mt-3 p-3 bg-blue-50 rounded-lg">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">업로드 고객 DB: <strong>{Number(editingUser.uploaded_customer_count).toLocaleString()}건</strong></span>
                      <button
                        type="button"
                        onClick={() => showConfirm('고객 DB 삭제', `이 사용자가 업로드한 고객 ${Number(editingUser.uploaded_customer_count).toLocaleString()}건을 전부 삭제하시겠습니까?\n연관 구매내역도 함께 삭제되며, 복구할 수 없습니다.`, async () => {
                          try {
                            const token = localStorage.getItem('token');
                            const res = await fetch(`/api/admin/users/${editingUser.id}/customers`, {
                              method: 'DELETE',
                              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
                            });
                            if (res.ok) {
                              const data = await res.json();
                              showAlert('성공', `${data.deletedCount}명 삭제 (구매내역 ${data.deletedPurchases}건 포함)`, 'success');
                              setEditingUser({ ...editingUser, uploaded_customer_count: 0 });
                            } else {
                              const data = await res.json();
                              showAlert('오류', data.error || '삭제 실패', 'error');
                            }
                          } catch { showAlert('오류', '삭제 실패', 'error'); }
                        })}
                        className="whitespace-nowrap px-3 py-1 text-xs bg-red-100 text-red-700 rounded-lg hover:bg-red-200"
                      >
                        고객 DB 삭제
                      </button>
                    </div>
                  </div>
                )}

                {/* 수신거부 현황 */}
                {editingUser.unsubscribe_count > 0 && (
                  <div className="mt-3 p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-gray-600">수신거부: <strong>{Number(editingUser.unsubscribe_count).toLocaleString()}건</strong></span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              const token = localStorage.getItem('token');
                              const res = await fetch(`/api/admin/users/${editingUser.id}/unsubscribes/export`, {
                                headers: { 'Authorization': `Bearer ${token}` }
                              });
                              if (!res.ok) throw new Error('다운로드 실패');
                              const blob = await res.blob();
                              const url = window.URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = `unsubscribes_${editingUser.name}_${new Date().toISOString().slice(0,10)}.csv`;
                              a.click();
                              window.URL.revokeObjectURL(url);
                            } catch { showAlert('오류', '다운로드 실패', 'error'); }
                          }}
                          className="whitespace-nowrap px-3 py-1 text-xs bg-emerald-100 text-emerald-700 rounded-lg hover:bg-blue-200"
                        >
                          다운로드
                        </button>
                        <button
                          type="button"
                          onClick={() => showConfirm('수신거부 삭제', `이 사용자의 수신거부 ${Number(editingUser.unsubscribe_count).toLocaleString()}건을 전부 삭제하시겠습니까?\n삭제 후 복구할 수 없습니다.`, async () => {
                            try {
                              const token = localStorage.getItem('token');
                              const res = await fetch(`/api/admin/users/${editingUser.id}/unsubscribes`, {
                                method: 'DELETE',
                                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
                              });
                              if (res.ok) {
                                const data = await res.json();
                                showAlert('성공', `${data.deletedCount}건 삭제되었습니다.`, 'success');
                                setEditingUser({ ...editingUser, unsubscribe_count: 0 });
                              }
                            } catch { showAlert('오류', '삭제 실패', 'error'); }
                          })}
                          className="whitespace-nowrap px-3 py-1 text-xs bg-red-100 text-red-700 rounded-lg hover:bg-red-200"
                        >
                          전체삭제
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="whitespace-nowrap flex-1 px-4 py-2 border rounded-lg text-gray-700 hover:bg-gray-50"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="whitespace-nowrap flex-1 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
                >
                  저장
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
