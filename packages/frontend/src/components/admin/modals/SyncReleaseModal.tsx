/**
 * SyncReleaseModal — 슈퍼관리자 AdminDashboard 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch, SetStateAction } from 'react';

export interface SyncReleaseModalProps {
  setShowSyncReleaseModal: Dispatch<SetStateAction<boolean>>;
  setSyncReleaseForm: Dispatch<SetStateAction<{ version: string; checksum: string; force_update: boolean; tier: string; }>>;
  setSyncReleaseSaving: Dispatch<SetStateAction<boolean>>;
  showAlert: (title: string, message: string, variant?: 'success' | 'error' | 'warning' | 'info') => void;
  syncReleaseForm: { version: string; checksum: string; force_update: boolean; tier: string; };
  syncReleaseSaving: boolean;
}

export default function SyncReleaseModal(props: SyncReleaseModalProps) {
  const { setShowSyncReleaseModal, setSyncReleaseForm, setSyncReleaseSaving, showAlert, syncReleaseForm, syncReleaseSaving } = props;

// ★ 2026-07-01: 자동 업데이트 릴리즈 등록 — 서버 exe 업로드 후 sync_releases 등록 → 박스 매시간 자동 수령
const handleSyncReleaseSubmit = async () => {
  const version = syncReleaseForm.version.trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    showAlert('입력 오류', '버전은 x.y.z 형식이어야 합니다 (예: 1.5.7).', 'error');
    return;
  }
  setSyncReleaseSaving(true);
  try {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/admin/sync/releases', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version,
        checksum: syncReleaseForm.checksum.trim() || undefined,
        force_update: syncReleaseForm.force_update,
        tier: syncReleaseForm.tier || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '릴리즈 등록 실패');
    setShowSyncReleaseModal(false);
    showAlert('성공', `${version} 릴리즈가 등록됐습니다. 각 Agent가 다음 정각(매시간) 버전 확인 때 자동으로 받아 교체합니다.`, 'success');
  } catch (e: any) {
    showAlert('오류', e.message || '릴리즈 등록 실패', 'error');
  } finally {
    setSyncReleaseSaving(false);
  }
};
  return (
    <>
    {(
        <div className="fixed inset-0 bg-gray-900/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-[460px] overflow-hidden animate-in fade-in zoom-in">
            <div className="p-5 border-b bg-gradient-to-r from-violet-50 to-indigo-50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-violet-100 rounded-full flex items-center justify-center">
                  <svg className="w-5 h-5 text-violet-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" /></svg>
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-800">Agent 버전 배포</h3>
                  <p className="text-xs text-gray-500">서버 exe 업로드 후 등록 → 각 Agent가 매시간 자동 수령·교체</p>
                </div>
              </div>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-xs text-gray-500 font-medium mb-1.5 block">버전 (x.y.z)</label>
                <input
                  value={syncReleaseForm.version}
                  onChange={(e) => setSyncReleaseForm({ ...syncReleaseForm, version: e.target.value })}
                  placeholder="1.5.7"
                  className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-violet-500 outline-none"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 font-medium mb-1.5 block">OS 티어 (이 exe가 도는 환경)</label>
                <select
                  value={syncReleaseForm.tier}
                  onChange={(e) => setSyncReleaseForm({ ...syncReleaseForm, tier: e.target.value })}
                  className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] bg-white focus:ring-2 focus:ring-violet-500 outline-none"
                >
                  <option value="win-legacy">win-legacy: Windows 7 · Server 2008 R2 (isae)</option>
                  <option value="win-mid">win-mid: Windows 8.1 · Server 2012 R2</option>
                  <option value="win-modern">win-modern: Windows 10/11 · Server 2016+</option>
                  <option value="linux-legacy">linux-legacy: CentOS 7 · RHEL 7</option>
                  <option value="linux-modern">linux-modern: Ubuntu 20+ · RHEL 8+</option>
                </select>
                <p className="text-[11px] text-gray-400 mt-1">이 티어의 에이전트에게만 배포됩니다(다른 티어 오배포 차단).</p>
              </div>
              <div>
                <label className="text-xs text-gray-500 font-medium mb-1.5 block">체크섬 (SHA-256, 선택)</label>
                <input
                  value={syncReleaseForm.checksum}
                  onChange={(e) => setSyncReleaseForm({ ...syncReleaseForm, checksum: e.target.value })}
                  placeholder="서버 sha256sum 결과 (무결성 검증용)"
                  className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] font-mono focus:ring-2 focus:ring-violet-500 outline-none"
                />
              </div>
              <label className="flex items-center gap-2 text-[13px] text-gray-700">
                <input type="checkbox" checked={syncReleaseForm.force_update} onChange={(e) => setSyncReleaseForm({ ...syncReleaseForm, force_update: e.target.checked })} className="text-violet-600" />
                강제 업데이트 (감지 즉시 교체)
              </label>
              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1">
                <div>• 먼저 <code className="bg-amber-100 px-1 rounded">sync-agent-{'{버전}'}.exe</code>를 서버 <code className="bg-amber-100 px-1 rounded">agent-releases/</code>에 업로드하세요.</div>
                <div>• 등록하면 각 Agent가 다음 정각(매시간) 버전 확인 때 자동으로 받아 교체합니다(박스 원격 불필요).</div>
              </div>
            </div>
            <div className="flex border-t">
              <button
                onClick={() => setShowSyncReleaseModal(false)}
                disabled={syncReleaseSaving}
                className="whitespace-nowrap flex-1 px-4 py-3 text-gray-700 font-medium hover:bg-gray-50 transition-colors border-r disabled:opacity-50"
              >취소</button>
              <button
                onClick={handleSyncReleaseSubmit}
                disabled={syncReleaseSaving}
                className="whitespace-nowrap flex-1 px-4 py-3 text-violet-600 font-medium hover:bg-violet-50 transition-colors disabled:opacity-50"
              >{syncReleaseSaving ? '등록 중...' : '릴리즈 등록'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
