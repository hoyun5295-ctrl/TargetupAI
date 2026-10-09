/**
 * SyncDetailModal — 슈퍼관리자 AdminDashboard 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch, SetStateAction } from 'react';
import type { JSX } from 'react/jsx-runtime';
import { formatDateTimeShort } from '../../../utils/formatDate';
import { Fragment } from 'react';

export interface SyncDetailModalProps {
  getSyncOnlineBadge: (onlineStatus: string, dbStatus?: string, hbMin?: number, syncMin?: number) => JSX.Element;
  setShowSyncDetailModal: Dispatch<SetStateAction<boolean>>;
  syncAgentDetail: any;
  syncDetailLoading: boolean;
  syncSelectedAgent: any;
}

export default function SyncDetailModal(props: SyncDetailModalProps) {
  const { getSyncOnlineBadge, setShowSyncDetailModal, syncAgentDetail, syncDetailLoading, syncSelectedAgent } = props;
  return (
    <>
    {(
        <div className="fixed inset-0 bg-gray-900/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-[700px] max-h-[85vh] overflow-hidden animate-in fade-in zoom-in">
            <div className="p-5 border-b bg-gradient-to-r from-blue-50 to-indigo-50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                    <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" /></svg>
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-gray-800">Agent 상세</h3>
                    <p className="text-xs text-gray-500">{syncSelectedAgent?.company_name} · {syncSelectedAgent?.agent_name}</p>
                  </div>
                </div>
                <button onClick={() => setShowSyncDetailModal(false)} className="text-gray-400 hover:text-gray-600">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            </div>
            <div className="p-5 overflow-y-auto max-h-[calc(85vh-80px)]">
              {syncDetailLoading ? (
                <div className="text-center py-8 text-gray-500">로딩 중...</div>
              ) : syncAgentDetail ? (
                <>
                  {/* 기본 정보 */}
                  <div className="grid grid-cols-3 gap-3 mb-5">
                    <div className="bg-gray-50 rounded-lg p-3">
                      <div className="text-xs text-gray-400 mb-1">버전</div>
                      <div className="font-medium text-gray-800">{syncAgentDetail.agent?.agent_version || '-'}</div>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3">
                      <div className="text-xs text-gray-400 mb-1">OS</div>
                      <div className="font-medium text-gray-800 text-xs">{syncAgentDetail.agent?.os_info || '-'}</div>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3">
                      <div className="text-xs text-gray-400 mb-1">상태</div>
                      <div>{getSyncOnlineBadge(syncAgentDetail.agent?.online_status, syncAgentDetail.agent?.status, undefined, syncAgentDetail.agent?.sync_interval_customers)}</div>
                    </div>
                  </div>

                  {/* 통계 카드 */}
                  <div className="grid grid-cols-4 gap-3 mb-5">
                    <div className="bg-blue-50 rounded-lg p-3 text-center">
                      <div className="text-xl font-bold text-blue-700">{syncAgentDetail.stats?.total_syncs_today || 0}</div>
                      <div className="text-xs text-blue-500">오늘 동기화</div>
                    </div>
                    <div className="bg-red-50 rounded-lg p-3 text-center">
                      <div className="text-xl font-bold text-red-700">{syncAgentDetail.stats?.total_errors_today || 0}</div>
                      <div className="text-xs text-red-500">오늘 에러</div>
                    </div>
                    <div className="bg-emerald-50 rounded-lg p-3 text-center">
                      <div className="text-xl font-bold text-emerald-700">{(syncAgentDetail.stats?.total_customers || 0).toLocaleString()}</div>
                      <div className="text-xs text-emerald-500">총 고객</div>
                    </div>
                    <div className="bg-purple-50 rounded-lg p-3 text-center">
                      <div className="text-xl font-bold text-purple-700">{(syncAgentDetail.stats?.total_purchases || 0).toLocaleString()}</div>
                      <div className="text-xs text-purple-500">총 구매</div>
                    </div>
                  </div>

                  {/* ★ 2026-07-10 원격 관리 P0: 에이전트 자기 보고 — 적용 매핑·소스 컬럼 (서버 사본, 진실 이원화 해소) */}
                  <h4 className="text-sm font-semibold text-gray-700 mb-2">에이전트 자기 보고</h4>
                  {syncAgentDetail.agent?.reported ? (
                    <div className="border rounded-lg p-3 mb-5 text-xs space-y-2 bg-emerald-50/40 border-emerald-200">
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-gray-600">
                        <span>보고 시각 <b className="text-gray-800">{syncAgentDetail.agent.reported.reportedAt ? formatDateTimeShort(syncAgentDetail.agent.reported.reportedAt) : '-'}</b></span>
                        <span>매핑 해시 <b className="font-mono text-gray-800">{syncAgentDetail.agent.reported.configVersion || '-'}</b></span>
                        <span>고객 매핑 <b className="text-gray-800">{Object.keys(syncAgentDetail.agent.reported.appliedMapping?.customers || {}).length}건</b></span>
                        <span>구매 매핑 <b className="text-gray-800">{Object.keys(syncAgentDetail.agent.reported.appliedMapping?.purchases || {}).length}건</b></span>
                        <span>소스 컬럼 고객 <b className="text-gray-800">{(syncAgentDetail.agent.reported.sourceColumns?.customers || []).length}개</b>{syncAgentDetail.agent.reported.sourceColumns?.purchases ? <> · 구매 <b className="text-gray-800">{syncAgentDetail.agent.reported.sourceColumns.purchases.length}개</b></> : null}</span>
                      </div>
                      <details>
                        <summary className="cursor-pointer text-emerald-700 font-medium">적용 매핑 펼쳐보기</summary>
                        <div className="mt-2 grid grid-cols-2 gap-3">
                          <div>
                            <div className="text-gray-500 mb-1">고객</div>
                            <div className="bg-white border rounded p-2 max-h-40 overflow-y-auto font-mono text-[11px] space-y-0.5">
                              {Object.entries(syncAgentDetail.agent.reported.appliedMapping?.customers || {}).map(([s, t]: any) => (
                                <div key={s}>{s} → {String(t)}{/^custom_\d+$/.test(String(t)) && syncAgentDetail.agent.reported.appliedMapping?.customFieldLabels?.[String(t)] ? ` (${syncAgentDetail.agent.reported.appliedMapping.customFieldLabels[String(t)]})` : ''}</div>
                              ))}
                              {Object.keys(syncAgentDetail.agent.reported.appliedMapping?.customers || {}).length === 0 && <div className="text-gray-400">없음</div>}
                            </div>
                          </div>
                          <div>
                            <div className="text-gray-500 mb-1">구매</div>
                            <div className="bg-white border rounded p-2 max-h-40 overflow-y-auto font-mono text-[11px] space-y-0.5">
                              {Object.entries(syncAgentDetail.agent.reported.appliedMapping?.purchases || {}).map(([s, t]: any) => (
                                <div key={s}>{s} → {String(t)}</div>
                              ))}
                              {Object.keys(syncAgentDetail.agent.reported.appliedMapping?.purchases || {}).length === 0 && <div className="text-gray-400">없음</div>}
                            </div>
                          </div>
                        </div>
                      </details>
                    </div>
                  ) : (
                    <div className="border border-amber-200 bg-amber-50 rounded-lg p-3 mb-5 text-xs text-amber-800">
                      아직 자기 보고가 없습니다. 구버전(v1.6.1 미만) 또는 신버전 첫 heartbeat 전입니다.
                    </div>
                  )}

                  {/* ★ 2026-07-10 P1: 대기 명령 + 명령 결과 (ACK) */}
                  {(syncAgentDetail.agent?.pending_commands || []).length > 0 && (
                    <>
                      <h4 className="text-sm font-semibold text-gray-700 mb-2">대기 중 명령</h4>
                      <div className="border rounded-lg p-3 mb-5 text-xs space-y-1">
                        {(syncAgentDetail.agent.pending_commands || []).map((c: any, i: number) => (
                          <div key={c.id || i} className="flex items-center justify-between gap-2">
                            <span className="font-medium text-gray-700">{c.type}</span>
                            <span className="text-gray-400">
                              등록 {c.created_at ? formatDateTimeShort(c.created_at) : '-'}
                              {c.attempts ? ` · 전달 ${c.attempts}회` : ' · 미전달'}
                              {c.delivered_at ? ` (최근 ${formatDateTimeShort(c.delivered_at)})` : ''}
                            </span>
                          </div>
                        ))}
                        <div className="text-gray-400 pt-1">{syncAgentDetail.agent?.supports_ack ? '에이전트 실행 확인(ACK) 수신 시 목록에서 사라집니다. 5회 재전달 미응답 시 실패로 만료됩니다.' : '구버전 에이전트: 다음 heartbeat에 전달 후 목록에서 사라집니다(결과 회신 없음).'}</div>
                      </div>
                    </>
                  )}
                  <h4 className="text-sm font-semibold text-gray-700 mb-2">명령 결과 (최근 {(syncAgentDetail.agent?.command_results || []).length}건)</h4>
                  <div className="border rounded-lg overflow-hidden mb-5">
                    {(syncAgentDetail.agent?.command_results || []).length === 0 ? (
                      <div className="px-3 py-4 text-center text-xs text-gray-400">
                        {syncAgentDetail.agent?.supports_ack ? '아직 회신된 명령 결과가 없습니다.' : '구버전 에이전트(v1.6.1 미만)는 명령 결과를 회신하지 않습니다.'}
                      </div>
                    ) : (
                      <div className="divide-y">
                        {[...(syncAgentDetail.agent.command_results || [])].reverse().map((r: any, i: number) => (
                          <div key={`${r.commandId || i}`} className="px-3 py-2 text-xs">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`px-1.5 py-0.5 rounded font-medium ${r.ok ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{r.ok ? '성공' : '실패'}</span>
                              <span className="font-medium text-gray-700">{r.type}</span>
                              <span className="text-gray-400">{r.completedAt ? formatDateTimeShort(r.completedAt) : '-'}</span>
                            </div>
                            {r.message && <div className="mt-1 text-gray-600">{r.message}</div>}
                            {/* report_logs — 로그 열람 */}
                            {Array.isArray(r.data?.lines) && r.data.lines.length > 0 && (
                              <details className="mt-1">
                                <summary className="cursor-pointer text-indigo-600">로그 {r.data.lines.length}줄 보기{r.data.truncated ? ' (앞부분 생략됨)' : ''}</summary>
                                <pre className="mt-1 bg-gray-900 text-gray-100 rounded p-2 max-h-64 overflow-auto text-[10px] leading-relaxed whitespace-pre-wrap">{r.data.lines.join('\n')}</pre>
                              </details>
                            )}
                            {/* mapping_dryrun — 소스 1행 → 매핑 결과 미리보기 */}
                            {(r.data?.customers || r.data?.purchases) && (
                              <details className="mt-1">
                                <summary className="cursor-pointer text-indigo-600">매핑 미리보기 결과</summary>
                                <pre className="mt-1 bg-gray-50 border rounded p-2 max-h-64 overflow-auto text-[10px] leading-relaxed whitespace-pre-wrap">{JSON.stringify(r.data, null, 2)}</pre>
                              </details>
                            )}
                            {/* test_connection — 상세 */}
                            {typeof r.data?.connected === 'boolean' && (
                              <div className="mt-1 text-gray-500">연결 {r.data.connected ? '정상' : '실패'}{typeof r.data.customerColumns === 'number' ? ` · 고객 ${r.data.customerColumns}컬럼` : ''}{typeof r.data.purchaseColumns === 'number' ? ` · 구매 ${r.data.purchaseColumns}컬럼` : ''}{r.data.error ? ` · ${r.data.error}` : ''}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* 동기화 이력 */}
                  <h4 className="text-sm font-semibold text-gray-700 mb-2">최근 동기화 이력</h4>
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="whitespace-nowrap px-3 py-2 text-left text-gray-500">시각</th>
                          <th className="whitespace-nowrap px-3 py-2 text-left text-gray-500">타입</th>
                          <th className="whitespace-nowrap px-3 py-2 text-left text-gray-500">모드</th>
                          <th className="whitespace-nowrap px-3 py-2 text-right text-gray-500">건수</th>
                          <th className="whitespace-nowrap px-3 py-2 text-right text-gray-500">성공</th>
                          <th className="whitespace-nowrap px-3 py-2 text-right text-gray-500">실패</th>
                          <th className="whitespace-nowrap px-3 py-2 text-right text-gray-500">소요</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {(syncAgentDetail.recent_logs || []).map((log: any) => (
                          <Fragment key={log.id}>
                          <tr className="hover:bg-gray-50">
                            <td className="px-3 py-2 text-gray-500">{(log.started_at || log.completed_at) ? formatDateTimeShort(log.started_at || log.completed_at) : '-'}</td>
                            <td className="px-3 py-2">
                              <span className={`px-1.5 py-0.5 rounded text-xs ${log.sync_type === 'customers' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                                {log.sync_type === 'customers' ? '고객' : '구매'}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-gray-500">{log.mode === 'full' ? '전체' : '증분'}</td>
                            <td className="px-3 py-2 text-right text-gray-700">{log.total_count || 0}</td>
                            <td className="px-3 py-2 text-right text-green-600">{log.success_count || 0}</td>
                            <td className="px-3 py-2 text-right">
                              <span className={log.fail_count > 0 ? 'text-red-600 font-medium' : 'text-gray-400'}>{log.fail_count || 0}</span>
                            </td>
                            <td className="px-3 py-2 text-right text-gray-500">{log.duration_ms ? `${(log.duration_ms / 1000).toFixed(1)}초` : '-'}</td>
                          </tr>
                          {/* ★ 2026-06-13: 실패 행 상세(failures jsonb) — 어떤 행이 왜 실패했는지 표시 (식별 불가 구멍 해소) */}
                          {Array.isArray(log.failures) && log.failures.length > 0 && (
                            <tr className="bg-red-50/60">
                              <td colSpan={7} className="px-3 py-1.5 text-[11px] text-red-700">
                                실패 상세: {log.failures.slice(0, 5).map((f: any, i: number) => (
                                  <span key={i} className="mr-3 font-mono">{f.phone || '(번호 없음)'}: {f.reason || '원인 미기록'}</span>
                                ))}
                                {(log.failures_total ?? log.failures.length) > 5 && <span className="text-red-400">외 {(log.failures_total ?? log.failures.length) - 5}건</span>}
                              </td>
                            </tr>
                          )}
                          </Fragment>
                        ))}
                        {(!syncAgentDetail.recent_logs || syncAgentDetail.recent_logs.length === 0) && (
                          <tr><td colSpan={7} className="px-3 py-2.5 text-center text-gray-400">동기화 이력이 없습니다.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className="text-center py-8 text-gray-400">데이터를 불러올 수 없습니다.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
