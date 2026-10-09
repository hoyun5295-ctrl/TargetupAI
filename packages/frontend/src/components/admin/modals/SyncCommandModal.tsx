/**
 * SyncCommandModal — 슈퍼관리자 AdminDashboard 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch, SetStateAction } from 'react';

export interface SyncCommandModalProps {
  loadSyncAgents: () => Promise<void>;
  setShowSyncCommandModal: Dispatch<SetStateAction<boolean>>;
  setSyncCommandType: Dispatch<SetStateAction<'full_sync' | 'restart' | 'pause' | 'resume' | 'report_logs' | 'test_connection'>>;
  showAlert: (title: string, message: string, variant?: 'success' | 'error' | 'warning' | 'info') => void;
  syncCommandType: 'full_sync' | 'restart' | 'pause' | 'resume' | 'report_logs' | 'test_connection';
  syncSelectedAgent: any;
}

export default function SyncCommandModal(props: SyncCommandModalProps) {
  const { loadSyncAgents, setShowSyncCommandModal, setSyncCommandType, showAlert, syncCommandType, syncSelectedAgent } = props;

const handleSyncCommand = async () => {
  if (!syncSelectedAgent) return;
  try {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/admin/sync/agents/${syncSelectedAgent.id}/command`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: syncCommandType })
    });
    if (!res.ok) throw new Error('명령 전송 실패');
    setShowSyncCommandModal(false);
    // ★ D131 후속(2026-04-21): 명령 전송 후 목록 즉시 재조회 — Agent가 실제 pause/resume 수행 후
    //   다음 heartbeat(최대 60분 소요)에 status 반영될 때까지 UI는 기존 상태로 보임.
    //   명령 전송 직후 최소한 "명령 큐에 등록됐다"는 피드백과 함께 목록 리프레시.
    const commandLabels: Record<string, string> = {
      full_sync: '전체 동기화',
      pause: '일시정지',
      resume: '재개',
      restart: '재시작',
      report_logs: '최근 로그 요청',
      test_connection: '소스 DB 연결 테스트',
    };
    const label = commandLabels[syncCommandType] || syncCommandType;
    const ackNote = syncAgentSupportsAck(syncSelectedAgent.agent_version)
      ? ' 실행 결과는 상세 화면의 "명령 결과"에서 확인할 수 있습니다.'
      : '';
    showAlert('성공', `${label} 명령이 등록되었습니다. Agent가 다음 heartbeat(최대 60분)에 수행하고 상태가 반영됩니다.${ackNote}`, 'success');
    loadSyncAgents();
  } catch (e) {
    showAlert('오류', '명령 전송 실패', 'error');
  }
};

// ★ 2026-07-10 원격 관리: ACK(v1.6.1+) 지원 여부 — 진단 명령·dry-run 노출 판단 (백엔드 agent-protocol과 동일 기준)
const syncAgentSupportsAck = (version: string | null | undefined): boolean => {
  const m = String(version || '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m) return false;
  const [a, b, c] = [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3] || '0', 10)];
  if (a !== 1) return a > 1;
  if (b !== 6) return b > 6;
  return c >= 1;
};
  return (
    <>
    {(
        <div className="fixed inset-0 bg-gray-900/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-[400px] overflow-hidden animate-in fade-in zoom-in">
            <div className="p-5 border-b bg-gradient-to-r from-emerald-50 to-green-50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center">
                  <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-800">Agent 명령 전송</h3>
                  <p className="text-xs text-gray-500">{syncSelectedAgent.company_name} · {syncSelectedAgent.agent_name}</p>
                </div>
              </div>
            </div>
            <div className="p-5 space-y-3">
              <label className="text-xs text-gray-500 font-medium mb-1.5 block">명령 유형</label>
              {/* ★ D131 후속(2026-04-21 3차 수정): 자동 선택/비활성 로직 복원.
                  백엔드가 pause/resume 명령 등록 시 sync_agents.status를 즉시 UPDATE하므로
                  UI가 DB 실시간 상태 기반으로 재개/일시정지 활성화 판단 가능 (heartbeat 지연 없음).
                  - paused: pause/full_sync 비활성 (무의미), resume/restart 활성
                  - active: resume 비활성 (재개할 게 없음), pause/full_sync/restart 활성
                  - offline: 경고 + 모두 활성 (Agent 복귀 후 실행) */}
              {(() => {
                const isPaused = syncSelectedAgent.status === 'paused';
                const isOffline = syncSelectedAgent.status === 'inactive' || syncSelectedAgent.status === 'error';
                return (
                  <>
                    {isOffline && (
                      <div className="px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-700">
                        ⚠️ Agent 오프라인 상태입니다. 명령은 Agent 복귀 후 실행됩니다.
                      </div>
                    )}
                    {isPaused && (
                      <div className="px-3 py-2 rounded-lg bg-orange-50 border border-orange-200 text-xs text-orange-700">
                        ⏸️ 현재 일시정지 상태입니다. <b>재개</b> 명령을 선택하세요.
                      </div>
                    )}
                    <div className="space-y-2">
                      <label className={`flex items-center gap-3 p-3 border rounded-lg transition-colors ${syncCommandType === 'full_sync' ? 'border-emerald-500 bg-emerald-50' : 'hover:bg-gray-50'} ${isPaused ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}>
                        <input type="radio" name="cmdType" value="full_sync" checked={syncCommandType === 'full_sync'} onChange={() => setSyncCommandType('full_sync')} className="text-emerald-600" disabled={isPaused} />
                        <div>
                          <div className="text-sm font-medium text-gray-800">전체 동기화</div>
                          <div className="text-xs text-gray-500">{isPaused ? '일시정지 중: 재개 후 실행 가능' : '모든 고객/구매 데이터를 다시 동기화합니다'}</div>
                        </div>
                      </label>
                      <label className={`flex items-center gap-3 p-3 border rounded-lg transition-colors ${syncCommandType === 'pause' ? 'border-orange-500 bg-orange-50' : 'hover:bg-gray-50'} ${isPaused ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}>
                        <input type="radio" name="cmdType" value="pause" checked={syncCommandType === 'pause'} onChange={() => setSyncCommandType('pause')} className="text-orange-600" disabled={isPaused} />
                        <div>
                          <div className="text-sm font-medium text-gray-800">⏸️ 동기화 일시정지</div>
                          <div className="text-xs text-gray-500">{isPaused ? '이미 일시정지 상태입니다' : '스케줄러만 중단 (Agent는 계속 살아있음, heartbeat 유지)'}</div>
                        </div>
                      </label>
                      <label className={`flex items-center gap-3 p-3 border rounded-lg transition-colors ${syncCommandType === 'resume' ? 'border-blue-500 bg-blue-50' : 'hover:bg-gray-50'} ${!isPaused ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}>
                        <input type="radio" name="cmdType" value="resume" checked={syncCommandType === 'resume'} onChange={() => setSyncCommandType('resume')} className="text-emerald-600" disabled={!isPaused} />
                        <div>
                          <div className="text-sm font-medium text-gray-800">▶️ 동기화 재개</div>
                          <div className="text-xs text-gray-500">{!isPaused ? '이미 실행 중입니다' : '일시정지된 스케줄러를 다시 시작합니다'}</div>
                        </div>
                      </label>
                      <label className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${syncCommandType === 'restart' ? 'border-emerald-500 bg-emerald-50' : 'hover:bg-gray-50'}`}>
                        <input type="radio" name="cmdType" value="restart" checked={syncCommandType === 'restart'} onChange={() => setSyncCommandType('restart')} className="text-emerald-600" />
                        <div>
                          <div className="text-sm font-medium text-gray-800">Agent 재시작</div>
                          <div className="text-xs text-gray-500">Agent 프로세스를 종료 (서비스로 설치된 경우 자동 재시작)</div>
                        </div>
                      </label>
                      {/* ★ 2026-07-10 원격 관리 P2: 진단 2종 — v1.6.1+(결과 회신 지원) 전용 */}
                      {(() => {
                        const ackOk = syncAgentSupportsAck(syncSelectedAgent.agent_version);
                        return (
                          <>
                            <label className={`flex items-center gap-3 p-3 border rounded-lg transition-colors ${syncCommandType === 'report_logs' ? 'border-indigo-500 bg-indigo-50' : 'hover:bg-gray-50'} ${!ackOk ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}>
                              <input type="radio" name="cmdType" value="report_logs" checked={syncCommandType === 'report_logs'} onChange={() => setSyncCommandType('report_logs')} className="text-emerald-600" disabled={!ackOk} />
                              <div>
                                <div className="text-sm font-medium text-gray-800">최근 로그 요청</div>
                                <div className="text-xs text-gray-500">{ackOk ? '에이전트 최근 로그 200줄을 회신받아 상세에서 열람' : 'v1.6.1 이상에서 지원'}</div>
                              </div>
                            </label>
                            <label className={`flex items-center gap-3 p-3 border rounded-lg transition-colors ${syncCommandType === 'test_connection' ? 'border-cyan-500 bg-cyan-50' : 'hover:bg-gray-50'} ${!ackOk ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}>
                              <input type="radio" name="cmdType" value="test_connection" checked={syncCommandType === 'test_connection'} onChange={() => setSyncCommandType('test_connection')} className="text-cyan-600" disabled={!ackOk} />
                              <div>
                                <div className="text-sm font-medium text-gray-800">소스 DB 연결 테스트</div>
                                <div className="text-xs text-gray-500">{ackOk ? '고객사 소스 DB 연결·컬럼 조회 상태를 회신받아 확인' : 'v1.6.1 이상에서 지원'}</div>
                              </div>
                            </label>
                          </>
                        );
                      })()}
                    </div>
                  </>
                );
              })()}
              <p className="text-xs text-gray-400">명령 등록 시 상태가 즉시 반영됩니다. Agent는 다음 heartbeat(최대 60분) 때 실제 실행합니다.</p>
            </div>
            <div className="flex border-t">
              <button
                onClick={() => setShowSyncCommandModal(false)}
                className="whitespace-nowrap flex-1 px-4 py-3 text-gray-700 font-medium hover:bg-gray-50 transition-colors border-r"
              >
                취소
              </button>
              <button
                onClick={handleSyncCommand}
                className="whitespace-nowrap flex-1 px-4 py-3 text-emerald-600 font-medium hover:bg-emerald-50 transition-colors"
              >
                명령 전송
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
