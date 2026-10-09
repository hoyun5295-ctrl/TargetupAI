/**
 * SyncDeleteModal — 슈퍼관리자 AdminDashboard 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch, SetStateAction } from 'react';

export interface SyncDeleteModalProps {
  loadSyncAgents: () => Promise<void>;
  setShowSyncDeleteModal: Dispatch<SetStateAction<boolean>>;
  setSyncDeleting: Dispatch<SetStateAction<boolean>>;
  showAlert: (title: string, message: string, variant?: 'success' | 'error' | 'warning' | 'info') => void;
  showConfirm: (title: string, message: string, onConfirm: () => void) => void;
  syncDeleting: boolean;
  syncSelectedAgent: any;
  syncTimeAgo: (dateStr: string | null) => string;
}

export default function SyncDeleteModal(props: SyncDeleteModalProps) {
  const { loadSyncAgents, setShowSyncDeleteModal, setSyncDeleting, showAlert, showConfirm, syncDeleting, syncSelectedAgent, syncTimeAgo } = props;

// ★ D131 후속(2026-04-21): Agent 삭제 (버려진/중복 정리)
//   활성 Agent(30분 이내 heartbeat)는 서버에서 409 반환 → force=true로 강제 가능.
const handleSyncDelete = async (force = false) => {
  if (!syncSelectedAgent) return;
  setSyncDeleting(true);
  try {
    const token = localStorage.getItem('token');
    const url = `/api/admin/sync/agents/${syncSelectedAgent.id}${force ? '?force=true' : ''}`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) {
      if (data.code === 'AGENT_ACTIVE') {
        // 활성 Agent — 사용자에게 강제 삭제 여부 확인
        showConfirm('강제 삭제', `${data.error}\n\n그래도 강제 삭제하시겠습니까?`, () => { void handleSyncDelete(true); });
        setSyncDeleting(false);
        return;
      }
      throw new Error(data.error || 'Agent 삭제 실패');
    }
    setShowSyncDeleteModal(false);
    showAlert('성공', `${data.deleted?.agent_name || 'Agent'}를 삭제했습니다${data.forced ? ' (강제)' : ''}.`, 'success');
    loadSyncAgents();
  } catch (e: any) {
    showAlert('오류', e.message || 'Agent 삭제 실패', 'error');
  } finally {
    setSyncDeleting(false);
  }
};
  return (
    <>
    {(
        <div className="fixed inset-0 bg-gray-900/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-[420px] overflow-hidden animate-in fade-in zoom-in">
            <div className="p-5 border-b bg-gradient-to-r from-red-50 to-orange-50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                  <svg className="w-5 h-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M8 7V4a2 2 0 012-2h4a2 2 0 012 2v3" /></svg>
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-800">Agent 삭제</h3>
                  <p className="text-xs text-gray-500">{syncSelectedAgent.company_name} · {syncSelectedAgent.agent_name}</p>
                </div>
              </div>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-sm text-gray-700">
                이 Agent 레코드를 서버에서 <b className="text-red-600">영구 삭제</b>합니다.
              </p>
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-600 space-y-1.5">
                <div className="flex justify-between"><span className="text-gray-500">Agent ID</span><span className="font-mono">{String(syncSelectedAgent.id).slice(0, 13)}…</span></div>
                <div className="flex justify-between"><span className="text-gray-500">버전</span><span>{syncSelectedAgent.agent_version || '-'}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">마지막 heartbeat</span><span>{syncTimeAgo(syncSelectedAgent.last_heartbeat_at)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">동기화된 고객</span><span>{(syncSelectedAgent.total_customers_synced || 0).toLocaleString()}건</span></div>
              </div>
              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1">
                <div>⚠️ 이미 동기화된 고객 데이터는 유지되지만 <b>해당 Agent의 동기화 이력(sync_logs)은 함께 삭제</b>됩니다.</div>
                <div>⚠️ Agent가 아직 실행 중이면 다음 heartbeat 때 자동 재등록되어 레코드가 다시 생길 수 있습니다. 먼저 Agent 프로세스를 종료하세요.</div>
              </div>
            </div>
            <div className="flex border-t">
              <button
                onClick={() => setShowSyncDeleteModal(false)}
                disabled={syncDeleting}
                className="whitespace-nowrap flex-1 px-4 py-3 text-gray-700 font-medium hover:bg-gray-50 transition-colors border-r disabled:opacity-50"
              >
                취소
              </button>
              <button
                onClick={() => handleSyncDelete(false)}
                disabled={syncDeleting}
                className="whitespace-nowrap flex-1 px-4 py-3 text-red-600 font-medium hover:bg-red-50 transition-colors disabled:opacity-50"
              >
                {syncDeleting ? '삭제 중...' : '삭제'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
