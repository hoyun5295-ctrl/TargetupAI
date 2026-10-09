/**
 * LineGroupEditModal — 슈퍼관리자 AdminDashboard 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch, SetStateAction } from 'react';

export interface LineGroupEditModalProps {
  editingLineGroup: any;
  lineGroupSaving: boolean;
  loadLineGroups: () => Promise<void>;
  setEditingLineGroup: Dispatch<any>;
  setLineGroupSaving: Dispatch<SetStateAction<boolean>>;
  showAlert: (title: string, message: string, variant?: 'success' | 'error' | 'warning' | 'info') => void;
}

export default function LineGroupEditModal(props: LineGroupEditModalProps) {
  const { editingLineGroup, lineGroupSaving, loadLineGroups, setEditingLineGroup, setLineGroupSaving, showAlert } = props;
  if (!(editingLineGroup)) return null; // ★ 분리 E — 본체와 같은 조건(타입 좁히기 · 본체가 이미 같은 조건으로 그린다)

const saveLineGroup = async (id: string | null, data: any) => {
  const token = localStorage.getItem('token');
  const url = id ? `/api/admin/line-groups/${id}` : '/api/admin/line-groups';
  const method = id ? 'PUT' : 'POST';
  const res = await fetch(url, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
  await loadLineGroups();
  return await res.json();
};

// ★ 2026-07-17 발송 라인 설정 탭 — 저장/삭제 핸들러.
//   sms_tables는 화면에서 콤마 구분 문자열로 다루고, 저장 직전 배열로 되돌린다.
//   테이블명 유효성(SMSQ_SEND[_n][_yyyymm])은 백엔드 validateSmsTables가 최종 판정 — 프론트는 형식만 다듬는다.
const handleSaveLineGroup = async () => {
  if (!editingLineGroup) return;
  const groupName = String(editingLineGroup.group_name || '').trim();
  const tables = String(editingLineGroup.sms_tables || '')
    .split(',').map((t: string) => t.trim()).filter(Boolean);
  if (!groupName) return showAlert('입력 확인', '그룹명을 입력해주세요.', 'warning');
  if (tables.length === 0) return showAlert('입력 확인', '발송 테이블을 1개 이상 입력해주세요.', 'warning');

  setLineGroupSaving(true);
  try {
    await saveLineGroup(editingLineGroup.id || null, {
      groupName,
      groupType: editingLineGroup.group_type,
      smsTables: tables,
      sortOrder: Number(editingLineGroup.sort_order) || 0,
      ...(editingLineGroup.id ? { isActive: !!editingLineGroup.is_active } : {}),
    });
    setEditingLineGroup(null);
    showAlert('저장 완료', `${groupName} 라인그룹이 저장되었습니다.`, 'success');
  } catch (e: any) {
    showAlert('저장 실패', e?.message || '라인그룹 저장에 실패했습니다.', 'error');
  } finally {
    setLineGroupSaving(false);
  }
};
  return (
    <>
    {(
        <div className="fixed inset-0 bg-gray-900/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gray-100 bg-gradient-to-r from-blue-50 to-indigo-50">
              <h3 className="text-base font-semibold text-gray-800">
                {editingLineGroup.id ? '라인그룹 수정' : '새 라인그룹'}
              </h3>
            </div>
            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">그룹명 *</label>
                <input
                  type="text"
                  value={editingLineGroup.group_name}
                  onChange={(e) => setEditingLineGroup({ ...editingLineGroup, group_name: e.target.value })}
                  placeholder="비토게이트웨이 2"
                  className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">타입 *</label>
                <select
                  value={editingLineGroup.group_type}
                  onChange={(e) => setEditingLineGroup({ ...editingLineGroup, group_type: e.target.value })}
                  className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none"
                >
                  <option value="bulk">대량발송 (bulk)</option>
                  <option value="bito">자체 게이트웨이 (bito)</option>
                  <option value="test">테스트 (test)</option>
                  <option value="auth">인증 (auth)</option>
                </select>
                <p className="text-xs text-gray-400 mt-1">
                  대량발송·자체 게이트웨이만 고객사/사용자 배정 드롭다운에 노출됩니다. 테스트·인증은 시스템 전용입니다.
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">발송 테이블 *</label>
                <input
                  type="text"
                  value={editingLineGroup.sms_tables}
                  onChange={(e) => setEditingLineGroup({ ...editingLineGroup, sms_tables: e.target.value })}
                  placeholder="SMSQ_SEND_14"
                  className="w-full px-3 py-1.5 border border-gray-200 rounded-lg font-mono text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none"
                />
                <p className="text-xs text-gray-400 mt-1">
                  콤마로 구분. 2개 이상이면 라운드로빈으로 나눠 적재합니다. MySQL에 실재하는 테이블만 넣어야 합니다.
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">정렬 순서</label>
                <input
                  type="number"
                  value={editingLineGroup.sort_order}
                  onChange={(e) => setEditingLineGroup({ ...editingLineGroup, sort_order: e.target.value })}
                  className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none"
                />
              </div>
              {editingLineGroup.id && (
                <label className="flex items-center gap-2 text-[13px] text-gray-700">
                  <input
                    type="checkbox"
                    checked={!!editingLineGroup.is_active}
                    onChange={(e) => setEditingLineGroup({ ...editingLineGroup, is_active: e.target.checked })}
                    className="w-4 h-4"
                  />
                  활성 (비활성하면 이 라인으로 새 발송이 나가지 않습니다)
                </label>
              )}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingLineGroup(null)}
                  className="whitespace-nowrap flex-1 px-4 py-2 border rounded-lg text-gray-700 hover:bg-gray-50"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={handleSaveLineGroup}
                  disabled={lineGroupSaving}
                  className="whitespace-nowrap flex-1 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                >
                  {lineGroupSaving ? '저장 중...' : '저장'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
