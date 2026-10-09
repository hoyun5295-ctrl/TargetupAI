/**
 * LineGroupsTab — 슈퍼관리자 AdminDashboard 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch } from 'react';

export interface LineGroupsTabProps {
  lineGroups: any[];
  lineGroupsLoading: boolean;
  loadLineGroups: () => Promise<void>;
  setEditingLineGroup: Dispatch<any>;
  showAlert: (title: string, message: string, variant?: 'success' | 'error' | 'warning' | 'info') => void;
  showConfirm: (title: string, message: string, onConfirm: () => void) => void;
}

export default function LineGroupsTab(props: LineGroupsTabProps) {
  const { lineGroups, lineGroupsLoading, loadLineGroups, setEditingLineGroup, showAlert, showConfirm } = props;

const deleteLineGroup = async (id: string) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`/api/admin/line-groups/${id}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
  await loadLineGroups();
};

const handleDeleteLineGroup = (lg: any) => {
  showConfirm(
    '라인그룹 삭제',
    `"${lg.group_name}" 라인그룹을 삭제하시겠습니까?\n이 라인으로 발송한 과거 캠페인의 집계·정산 조회 범위가 바뀔 수 있습니다.`,
    async () => {
      try {
        await deleteLineGroup(lg.id);
        showAlert('삭제 완료', `${lg.group_name} 라인그룹이 삭제되었습니다.`, 'success');
      } catch (e: any) {
        showAlert('삭제 실패', e?.message || '라인그룹 삭제에 실패했습니다.', 'error');
      }
    }
  );
};
  return (
    <>
    {(
        <div className="bg-white rounded-xl border border-gray-200/80 shadow-sm">
          <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold">발송 라인 설정</h2>
              <p className="text-xs text-gray-500 mt-1">
                라인그룹은 발송 라우팅 축입니다. 바꾸면 적재·취소·집계·정산이 함께 움직입니다.
              </p>
            </div>
            <button
              onClick={() => setEditingLineGroup({ group_name: '', group_type: 'bulk', sms_tables: '', sort_order: lineGroups.length + 1, is_active: true })}
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-[13px] font-medium hover:bg-emerald-700 transition-colors whitespace-nowrap"
            >
              새 라인그룹
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 whitespace-nowrap">순서</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">그룹명</th>
                  <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 whitespace-nowrap">타입</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">발송 테이블</th>
                  <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 whitespace-nowrap">배정 고객사</th>
                  <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 whitespace-nowrap">상태</th>
                  <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 whitespace-nowrap">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {lineGroupsLoading ? (
                  <tr><td colSpan={7} className="px-6 py-12 text-center text-gray-500">불러오는 중...</td></tr>
                ) : lineGroups.length === 0 ? (
                  <tr><td colSpan={7} className="px-6 py-12 text-center text-gray-500">등록된 라인그룹이 없습니다.</td></tr>
                ) : (
                  lineGroups.map((lg: any) => {
                    const typeLabels: Record<string, { label: string; cls: string }> = {
                      bulk: { label: '대량발송', cls: 'bg-blue-100 text-blue-700' },
                      test: { label: '테스트', cls: 'bg-amber-100 text-amber-700' },
                      auth: { label: '인증', cls: 'bg-purple-100 text-purple-700' },
                      bito: { label: '자체 게이트웨이', cls: 'bg-emerald-100 text-emerald-700' },
                    };
                    const t = typeLabels[lg.group_type] || { label: lg.group_type, cls: 'bg-gray-100 text-gray-700' };
                    return (
                      <tr key={lg.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 text-center text-gray-500">{lg.sort_order}</td>
                        <td className="px-4 py-2.5 font-medium text-gray-900 whitespace-nowrap">{lg.group_name}</td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={`whitespace-nowrap px-2 py-0.5 rounded text-xs font-medium ${t.cls}`}>{t.label}</span>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-gray-600">{(lg.sms_tables || []).join(', ')}</td>
                        <td className="px-4 py-2.5 text-center text-gray-700">{Number(lg.company_count || 0).toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${lg.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                            {lg.is_active ? '활성' : '비활성'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-center whitespace-nowrap">
                          <button
                            onClick={() => setEditingLineGroup({ ...lg, sms_tables: (lg.sms_tables || []).join(', ') })}
                            className="whitespace-nowrap px-2.5 py-1 text-xs border rounded-lg text-gray-700 hover:bg-gray-100"
                          >
                            수정
                          </button>
                          <button
                            onClick={() => handleDeleteLineGroup(lg)}
                            className="whitespace-nowrap ml-1.5 px-2.5 py-1 text-xs border border-red-200 rounded-lg text-red-600 hover:bg-red-50"
                          >
                            삭제
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="px-6 py-3 border-t text-xs text-gray-400">
            고객사·사용자 배정은 [고객 관리 → 고객사 관리 → 수정 → 발송 라인] 및 [사용자 관리 → 수정 → 발송 라인그룹]에서 합니다.
          </div>
        </div>
      )}
    </>
  );
}
