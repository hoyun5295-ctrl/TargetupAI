/**
 * SyncAgentsTab — 슈퍼관리자 AdminDashboard 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch, SetStateAction } from 'react';
import type { JSX } from 'react/jsx-runtime';

export interface SyncAgentsTabProps {
  getSyncOnlineBadge: (onlineStatus: string, dbStatus?: string, hbMin?: number, syncMin?: number) => JSX.Element;
  loadSyncAgents: () => Promise<void>;
  setShowSyncCommandModal: Dispatch<SetStateAction<boolean>>;
  setShowSyncConfigModal: Dispatch<SetStateAction<boolean>>;
  setShowSyncDeleteModal: Dispatch<SetStateAction<boolean>>;
  setShowSyncDetailModal: Dispatch<SetStateAction<boolean>>;
  setShowSyncMappingModal: Dispatch<SetStateAction<boolean>>;
  setShowSyncReleaseModal: Dispatch<SetStateAction<boolean>>;
  setSyncAgentDetail: Dispatch<any>;
  setSyncCommandType: Dispatch<SetStateAction<'full_sync' | 'restart' | 'pause' | 'resume' | 'report_logs' | 'test_connection'>>;
  setSyncConfigForm: Dispatch<SetStateAction<{ sync_interval_customers: number; sync_interval_purchases: number; }>>;
  setSyncDetailLoading: Dispatch<SetStateAction<boolean>>;
  setSyncMapAckSupported: Dispatch<SetStateAction<boolean>>;
  setSyncMapCustomers: Dispatch<SetStateAction<{ src: string; target: string; label: string; }[]>>;
  setSyncMapPurchases: Dispatch<SetStateAction<{ src: string; target: string; label: string; }[]>>;
  setSyncMapReportLoading: Dispatch<SetStateAction<boolean>>;
  setSyncMapReported: Dispatch<any>;
  setSyncReleaseForm: Dispatch<SetStateAction<{ version: string; checksum: string; force_update: boolean; tier: string; }>>;
  setSyncSelectedAgent: Dispatch<any>;
  showAlert: (title: string, message: string, variant?: 'success' | 'error' | 'warning' | 'info') => void;
  syncAgents: any[];
  syncAgentsLoading: boolean;
  syncTimeAgo: (dateStr: string | null) => string;
}

export default function SyncAgentsTab(props: SyncAgentsTabProps) {
  const { getSyncOnlineBadge, loadSyncAgents, setShowSyncCommandModal, setShowSyncConfigModal, setShowSyncDeleteModal, setShowSyncDetailModal, setShowSyncMappingModal, setShowSyncReleaseModal, setSyncAgentDetail, setSyncCommandType, setSyncConfigForm, setSyncDetailLoading, setSyncMapAckSupported, setSyncMapCustomers, setSyncMapPurchases, setSyncMapReportLoading, setSyncMapReported, setSyncReleaseForm, setSyncSelectedAgent, showAlert, syncAgents, syncAgentsLoading, syncTimeAgo } = props;

const loadSyncAgentDetail = async (agentId: string) => {
  setSyncDetailLoading(true);
  setShowSyncDetailModal(true);
  try {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/admin/sync/agents/${agentId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('조회 실패');
    const data = await res.json();
    setSyncAgentDetail(data);
  } catch (e) {
    showAlert('오류', 'Agent 상세 조회 실패', 'error');
    setShowSyncDetailModal(false);
  } finally {
    setSyncDetailLoading(false);
  }
};

// ★ 2026-07-10 원격 관리 P0-2: 모달 오픈 = 에이전트 자기 보고(reported) 로드 → 기존 매핑 프리필.
//   옛 구조(항상 빈 행)는 "한 줄 추가 저장 = 그 대상 매핑 전체 소실" 함정이었다(에이전트는 타겟 단위 통째 교체 — 실측).
const openSyncMappingModal = async (agent: any) => {
  setSyncSelectedAgent(agent);
  setSyncMapReported(null);
  setSyncMapAckSupported(false);
  setSyncMapCustomers([]);
  setSyncMapPurchases([]);
  setShowSyncMappingModal(true);
  setSyncMapReportLoading(true);
  try {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/admin/sync/agents/${agent.id}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Agent 상세 조회 실패');
    const reported = data.agent?.reported || null;
    setSyncMapReported(reported);
    setSyncMapAckSupported(!!data.agent?.supports_ack);
    if (reported?.appliedMapping) {
      const labels = reported.appliedMapping.customFieldLabels || {};
      const custRows = Object.entries(reported.appliedMapping.customers || {}).map(([src, target]) => ({
        src,
        target: String(target),
        label: /^custom_\d+$/.test(String(target)) ? String(labels[String(target)] || '') : '',
      }));
      const purchRows = Object.entries(reported.appliedMapping.purchases || {}).map(([src, target]) => ({
        src,
        target: String(target),
        label: '',
      }));
      setSyncMapCustomers(custRows);
      setSyncMapPurchases(purchRows);
    }
  } catch (e: any) {
    showAlert('오류', e.message || 'Agent 상세 조회 실패', 'error');
  } finally {
    setSyncMapReportLoading(false);
  }
};
  return (
    <>
    {(
        <div className="bg-white rounded-xl border border-gray-200/80 shadow-sm">
          <div className="px-5 py-3.5 border-b border-gray-100 flex justify-between items-center">
            <h2 className="text-base font-semibold">Sync Agent 모니터링</h2>
            <div className="flex items-center gap-3">
              <button
                onClick={() => { setSyncReleaseForm({ version: '', checksum: '', force_update: true, tier: 'win-legacy' }); setShowSyncReleaseModal(true); }}
                className="text-[13px] text-violet-600 hover:text-violet-800 font-medium flex items-center gap-1"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" /></svg>
                버전 배포
              </button>
              <button
                onClick={loadSyncAgents}
                className="text-[13px] text-emerald-700 hover:text-emerald-800 font-medium flex items-center gap-1"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                새로고침
              </button>
            </div>
          </div>

          {syncAgentsLoading ? (
            <div className="p-12 text-center text-gray-500">로딩 중...</div>
          ) : syncAgents.length === 0 ? (
            <div className="p-12 text-center text-gray-400">
              <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" /></svg>
              <p>등록된 Sync Agent가 없습니다.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="whitespace-nowrap px-4 py-2 text-left text-xs font-medium text-gray-500 ">고객사</th>
                    <th className="whitespace-nowrap px-4 py-2 text-left text-xs font-medium text-gray-500 ">Agent명</th>
                    <th className="whitespace-nowrap px-4 py-2 text-left text-xs font-medium text-gray-500 ">버전</th>
                    <th className="whitespace-nowrap px-4 py-2 text-left text-xs font-medium text-gray-500 ">DB</th>
                    <th className="whitespace-nowrap px-4 py-2 text-center text-xs font-medium text-gray-500 ">상태</th>
                    <th className="whitespace-nowrap px-4 py-2 text-left text-xs font-medium text-gray-500 ">마지막 Heartbeat</th>
                    <th className="whitespace-nowrap px-4 py-2 text-left text-xs font-medium text-gray-500 ">마지막 동기화</th>
                    <th className="whitespace-nowrap px-4 py-2 text-right text-xs font-medium text-gray-500 ">고객 수</th>
                    <th className="whitespace-nowrap px-4 py-2 text-right text-xs font-medium text-gray-500 ">오늘 동기화</th>
                    <th className="whitespace-nowrap px-4 py-2 text-right text-xs font-medium text-gray-500 ">에러</th>
                    <th className="whitespace-nowrap px-4 py-2 text-center text-xs font-medium text-gray-500 ">관리</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {syncAgents.map((agent: any) => (
                    <tr key={agent.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-medium text-gray-900">{agent.company_name || '-'}</td>
                      <td className="px-4 py-2 text-gray-700">{agent.agent_name || '-'}</td>
                      <td className="px-4 py-2 text-gray-500">{agent.agent_version || '-'}</td>
                      <td className="px-4 py-2 text-gray-500">{agent.db_type || '-'}</td>
                      <td className="px-4 py-2 text-center">{getSyncOnlineBadge(agent.online_status, agent.status, agent.heartbeat_interval_min, agent.sync_interval_customers_min)}</td>
                      <td className="px-4 py-2 text-gray-500">{syncTimeAgo(agent.last_heartbeat_at)}</td>
                      <td className="px-4 py-2 text-gray-500">
                        {syncTimeAgo(agent.last_sync_at)}
                        {/* ★ 2026-06-13: 통신은 정상인데 동기화만 3시간+ 멈춘 상태 표시 (인비토 6/13 06:00 중단 실측 후속) */}
                        {agent.is_online && agent.last_sync_at && (Date.now() - new Date(agent.last_sync_at).getTime() > 3 * 3600 * 1000) && (
                          <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700">동기화 지연</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right text-gray-700">{(agent.total_customers_synced || 0).toLocaleString()}</td>
                      <td className="px-4 py-2 text-right text-gray-700">{agent.today_sync_count || 0}건</td>
                      <td className="px-4 py-2 text-right">
                        <span className={agent.recent_error_count > 0 ? 'text-red-600 font-medium' : 'text-gray-400'}>
                          {agent.recent_error_count || 0}건
                        </span>
                      </td>
                      <td className="px-4 py-2 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => { setSyncSelectedAgent(agent); loadSyncAgentDetail(agent.id); }}
                            className="whitespace-nowrap text-emerald-700 hover:text-emerald-800 text-xs font-medium px-2 py-1 rounded hover:bg-emerald-50"
                          >
                            상세
                          </button>
                          <button
                            onClick={() => {
                              setSyncSelectedAgent(agent);
                              // ★ 2026-09-27 한줄로 V2 R271 — 행의 실제 주기로 연다(옛: 60/30 고정값이라 저장하면 실제 주기를 덮었다)
                              setSyncConfigForm({
                                sync_interval_customers: Number(agent.sync_interval_customers_min) || 60,
                                sync_interval_purchases: Number(agent.sync_interval_purchases_min) || 30,
                              });
                              setShowSyncConfigModal(true);
                            }}
                            className="whitespace-nowrap text-gray-600 hover:text-gray-800 text-xs font-medium px-2 py-1 rounded hover:bg-gray-100"
                          >
                            설정
                          </button>
                          <button
                            onClick={() => {
                              setSyncSelectedAgent(agent);
                              // ★ D131 후속: paused 상태면 기본값을 'resume'으로 자동 선택
                              setSyncCommandType(agent.status === 'paused' ? 'resume' : 'full_sync');
                              setShowSyncCommandModal(true);
                            }}
                            className="whitespace-nowrap text-emerald-600 hover:text-emerald-800 text-xs font-medium px-2 py-1 rounded hover:bg-emerald-50"
                          >
                            명령
                          </button>
                          {/* ★ 2026-07-01: 매핑 — 원격 컬럼 매핑 편집(재설치 없이) */}
                          <button
                            onClick={() => openSyncMappingModal(agent)}
                            className="whitespace-nowrap text-violet-600 hover:text-violet-800 text-xs font-medium px-2 py-1 rounded hover:bg-violet-50"
                          >
                            매핑
                          </button>
                          {/* ★ D131 후속(2026-04-21): 삭제 버튼 — 버려진/중복 Agent 정리 */}
                          <button
                            onClick={() => {
                              setSyncSelectedAgent(agent);
                              setShowSyncDeleteModal(true);
                            }}
                            className="whitespace-nowrap text-red-600 hover:text-red-800 text-xs font-medium px-2 py-1 rounded hover:bg-red-50"
                          >
                            삭제
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}
