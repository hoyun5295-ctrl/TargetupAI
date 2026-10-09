/**
 * SyncConfigModal — 슈퍼관리자 AdminDashboard 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch, SetStateAction } from 'react';

export interface SyncConfigModalProps {
  loadSyncAgents: () => Promise<void>;
  setShowSyncConfigModal: Dispatch<SetStateAction<boolean>>;
  setSyncConfigForm: Dispatch<SetStateAction<{ sync_interval_customers: number; sync_interval_purchases: number; }>>;
  showAlert: (title: string, message: string, variant?: 'success' | 'error' | 'warning' | 'info') => void;
  syncConfigForm: { sync_interval_customers: number; sync_interval_purchases: number; };
  syncSelectedAgent: any;
}

export default function SyncConfigModal(props: SyncConfigModalProps) {
  const { loadSyncAgents, setShowSyncConfigModal, setSyncConfigForm, showAlert, syncConfigForm, syncSelectedAgent } = props;

const handleSyncConfigSave = async () => {
  if (!syncSelectedAgent) return;
  try {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/admin/sync/agents/${syncSelectedAgent.id}/config`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(syncConfigForm)
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || '설정 변경 실패');
    }
    setShowSyncConfigModal(false);
    showAlert('성공', '설정이 저장되었습니다. Agent가 다음 config 조회 시 반영됩니다.', 'success');
    loadSyncAgents();
  } catch (e: any) {
    showAlert('오류', e.message || '설정 변경 실패', 'error');
  }
};
  return (
    <>
    {(
        <div className="fixed inset-0 bg-gray-900/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-[400px] overflow-hidden animate-in fade-in zoom-in">
            <div className="p-5 border-b bg-gradient-to-r from-gray-50 to-slate-50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center">
                  <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-800">동기화 설정</h3>
                  <p className="text-xs text-gray-500">{syncSelectedAgent.company_name} · {syncSelectedAgent.agent_name}</p>
                </div>
              </div>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-xs text-gray-500 font-medium mb-1.5 block">고객 동기화 주기 (분)</label>
                <input
                  type="number"
                  min={5}
                  value={syncConfigForm.sync_interval_customers}
                  onChange={(e) => setSyncConfigForm({ ...syncConfigForm, sync_interval_customers: parseInt(e.target.value) || 5 })}
                  className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 font-medium mb-1.5 block">구매 동기화 주기 (분)</label>
                <input
                  type="number"
                  min={5}
                  value={syncConfigForm.sync_interval_purchases}
                  onChange={(e) => setSyncConfigForm({ ...syncConfigForm, sync_interval_purchases: parseInt(e.target.value) || 5 })}
                  className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none"
                />
              </div>
              <p className="text-xs text-gray-400">Agent가 다음 config 조회 시 변경사항이 반영됩니다.</p>
            </div>
            <div className="flex border-t">
              <button
                onClick={() => setShowSyncConfigModal(false)}
                className="whitespace-nowrap flex-1 px-4 py-3 text-gray-700 font-medium hover:bg-gray-50 transition-colors border-r"
              >
                취소
              </button>
              <button
                onClick={handleSyncConfigSave}
                className="whitespace-nowrap flex-1 px-4 py-3 text-emerald-700 font-medium hover:bg-emerald-50 transition-colors"
              >
                저장하기
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
