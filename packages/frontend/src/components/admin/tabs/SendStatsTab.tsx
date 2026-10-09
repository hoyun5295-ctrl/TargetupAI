/**
 * SendStatsTab — 슈퍼관리자 AdminDashboard 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch, SetStateAction } from 'react';
import SearchableSelect from '../../SearchableSelect';
import type { Company } from '../admin-types';

export interface SendStatsTabProps {
  AGENT_STATS_PER_PAGE: 20;
  agentStatsRows: any[];
  agentStatsSafePage: number;
  agentStatsTotalPages: number;
  companies: Company[];
  loadSendStats: (page?: number, viewOverride?: 'daily' | 'monthly') => Promise<void>;
  sendStats: any;
  setAgentStatsPage: Dispatch<SetStateAction<number>>;
  setStatsChannel: Dispatch<SetStateAction<'web' | 'agent'>>;
  setStatsCompanyFilter: Dispatch<SetStateAction<string>>;
  setStatsEndDate: Dispatch<SetStateAction<string>>;
  setStatsStartDate: Dispatch<SetStateAction<string>>;
  setStatsView: Dispatch<SetStateAction<'daily' | 'monthly'>>;
  showAlert: (title: string, message: string, variant?: 'success' | 'error' | 'warning' | 'info') => void;
  statsChannel: 'web' | 'agent';
  statsCompanyFilter: string;
  statsEndDate: string;
  statsPage: number;
  statsStartDate: string;
  statsTotal: number;
  statsView: 'daily' | 'monthly';
}

export default function SendStatsTab(props: SendStatsTabProps) {
  const { AGENT_STATS_PER_PAGE, agentStatsRows, agentStatsSafePage, agentStatsTotalPages, companies, loadSendStats, sendStats, setAgentStatsPage, setStatsChannel, setStatsCompanyFilter, setStatsEndDate, setStatsStartDate, setStatsView, showAlert, statsChannel, statsCompanyFilter, statsEndDate, statsPage, statsStartDate, statsTotal, statsView } = props;
  return (
    <>
    {(
          <div className="space-y-4">
            {/* ★ 2026-07-23 채널 탭 — 웹/에이전트 구분 */}
            <div className="flex items-center gap-1 border-b border-gray-200">
              {([['web', '웹 발송'], ['agent', '에이전트 발송']] as const).map(([key, label]) => (
                <button key={key} onClick={() => { setStatsChannel(key); loadSendStats(1); }}
                  className={`whitespace-nowrap px-4 py-2 text-[13px] font-semibold border-b-2 -mb-px transition ${statsChannel === key ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
                  {label}
                </button>
              ))}
            </div>
            {/* 요약 바 (얇게) — 채널별 */}
            {(statsChannel === 'agent' ? sendStats?.agentSummary : sendStats?.summary) && (() => {
              const s = statsChannel === 'agent' ? sendStats.agentSummary : sendStats.summary;
              const sent = Number(s.total_sent);
              const success = Number(s.total_success);
              const fail = Number(s.total_fail);
              const pending = s.total_pending != null ? Number(s.total_pending) : Math.max(0, sent - success - fail);
              // D183 fix: 성공률 = 전송 대비 성공 비율 (대기 영역 포함 분모) — 사용자 관점 정합
              const rate = sent > 0 ? (success / sent * 100).toFixed(1) : '-';
              return (
                <div className="bg-white rounded-xl border border-gray-200/80 shadow-sm px-6 py-3 flex items-center gap-8 text-sm">
                  <span className="text-gray-500">조회 기간 합계</span>
                  <span className="font-semibold text-blue-600">전송 {sent.toLocaleString()}</span>
                  <span className="font-semibold text-green-600">성공 {success.toLocaleString()}</span>
                  <span className="font-semibold text-red-600">실패 {fail.toLocaleString()}</span>
                  <span className="font-semibold text-amber-600">대기 {pending.toLocaleString()}</span>
                  <span className="font-semibold text-gray-700">성공률 {sent > 0 ? `${rate}%` : '-'}</span>
                </div>
              );
            })()}
           
            {/* 필터 영역 */}
            <div className="bg-white rounded-xl border border-gray-200/80 shadow-sm px-6 py-4 flex flex-wrap gap-3 items-center">
              <div className="flex bg-gray-100 rounded-lg p-1">
                {([['daily', '일별'], ['monthly', '월별']] as const).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => { setStatsView(key); loadSendStats(1, key); }}
                    className={`whitespace-nowrap px-4 py-1.5 rounded-md text-[13px] font-medium transition-colors ${
                      statsView === key ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 text-sm">
                <input
                  type="date"
                  value={statsStartDate}
                  onChange={(e) => setStatsStartDate(e.target.value)}
                  className="px-3 py-1.5 border border-gray-200 rounded-lg text-[13px]"
                />
                <span className="text-gray-400">~</span>
                <input
                  type="date"
                  value={statsEndDate}
                  onChange={(e) => setStatsEndDate(e.target.value)}
                  className="px-3 py-1.5 border border-gray-200 rounded-lg text-[13px]"
                />
              </div>
              {/* ★ D144 P13: 검색 가능 select — 회사명 입력으로 검색, 67개+ 스크롤 대신 */}
              <SearchableSelect
                options={companies.map(c => ({ value: c.id, label: c.company_name }))}
                value={statsCompanyFilter}
                onChange={setStatsCompanyFilter}
                emptyLabel="전체 고객사"
                placeholder="고객사 선택/검색..."
                className="w-48"
              />
              <button
                onClick={() => loadSendStats(1)}
                className="whitespace-nowrap px-4 py-1.5 bg-emerald-600 text-white rounded-lg text-[13px] hover:bg-emerald-700"
              >
                조회
              </button>
              {/* ★ D114 P10: 발송통계 엑셀(CSV) 다운로드 — fetch+blob (Authorization 헤더 필수).
                  ★2026-07-24 에이전트 탭도 지원 — /stats/export/agent (기간×고객사×발송ID×발급명×대상ID×유형, 정산 대조용) */}
              <button
                onClick={async () => {
                  const token = localStorage.getItem('token');
                  if (!statsStartDate || !statsEndDate) { showAlert('안내', '시작일과 종료일을 선택해주세요.', 'warning'); return; }
                  const isAgent = statsChannel === 'agent';
                  const params = new URLSearchParams();
                  params.set('startDate', statsStartDate);
                  params.set('endDate', statsEndDate);
                  if (statsCompanyFilter) params.set('companyId', statsCompanyFilter);
                  if (isAgent) params.set('view', statsView);
                  try {
                    const res = await fetch(`/api/admin/stats/export${isAgent ? '/agent' : ''}?${params.toString()}`, {
                      headers: { Authorization: `Bearer ${token}` },
                    });
                    if (!res.ok) { const err = await res.json().catch(() => ({})); showAlert('오류', (err as any).error || '다운로드 실패', 'error'); return; }
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    // ★ 2026-07-25 CSV → .xlsx (서버가 exceljs로 서식·숫자형까지 넣어 내려준다)
                    a.download = `${isAgent ? '에이전트발송통계' : '발송통계'}_${statsStartDate}_${statsEndDate}.xlsx`;
                    a.click();
                    URL.revokeObjectURL(url);
                  } catch { showAlert('오류', '다운로드 중 오류가 발생했습니다.', 'error'); }
                }}
                className="whitespace-nowrap px-4 py-1.5 bg-emerald-600 text-white rounded-lg text-[13px] hover:bg-emerald-700"
              >
                엑셀 다운로드
              </button>
              <span className="text-sm text-gray-400 ml-auto">총 {statsChannel === 'agent' ? (sendStats?.agentTotal || 0) : statsTotal}건</span>
            </div>

            {/* 테이블 */}
            <div className="bg-white rounded-xl border border-gray-200/80 shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead className="bg-gray-50">
                  <tr>
                      <th className="whitespace-nowrap px-4 py-2 text-left text-gray-500 font-medium">{statsView === 'daily' ? '날짜' : '월'}</th>
                      <th className="whitespace-nowrap px-4 py-2 text-left text-gray-500 font-medium">고객사</th>
                      {/* ★ 2026-07-24 발송ID(CustId) — 고객사 화면과 동일 축(정산 대조) */}
                      {statsChannel === 'agent' && <th className="whitespace-nowrap px-4 py-2 text-left text-gray-500 font-medium">발송ID</th>}
                      {statsChannel === 'agent' && <th className="whitespace-nowrap px-4 py-2 text-left text-gray-500 font-medium">유형</th>}
                      <th className="whitespace-nowrap px-4 py-2 text-center text-gray-500 font-medium">전송</th>
                      <th className="whitespace-nowrap px-4 py-2 text-center text-gray-500 font-medium">성공</th>
                      <th className="whitespace-nowrap px-4 py-2 text-center text-gray-500 font-medium">실패</th>
                      <th className="whitespace-nowrap px-4 py-2 text-center text-gray-500 font-medium">대기</th>
                      <th className="whitespace-nowrap px-4 py-2 text-center text-gray-500 font-medium">성공률</th>
                      <th className="whitespace-nowrap px-4 py-2 text-center text-gray-500 font-medium">발송라인</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {!(statsChannel === 'agent' ? sendStats?.agentRows : sendStats?.rows)?.length ? (
                      <tr><td colSpan={statsChannel === 'agent' ? 10 : 8} className="px-4 py-12 text-center text-gray-400">데이터가 없습니다.</td></tr>
                    ) : (statsChannel === 'agent'
                        ? agentStatsRows.slice((agentStatsSafePage - 1) * AGENT_STATS_PER_PAGE, agentStatsSafePage * AGENT_STATS_PER_PAGE)
                        : sendStats.rows
                      ).map((row: any, idx: number) => {
                      const sent = Number(row.sent);
                      const success = Number(row.success);
                      const fail = Number(row.fail);
                      const pending = row.pending != null ? Number(row.pending) : Math.max(0, sent - success - fail);
                      // D183 fix: 성공률 = 전송 대비 성공 비율 (대기 영역 포함 분모) — 사용자 관점 정합
                      const rate = sent > 0 ? (success / sent * 100).toFixed(1) : '-';
                      return (
                        <tr key={idx} className="hover:bg-gray-50">
                          <td className="px-4 py-2 font-medium text-gray-900 font-mono">{row.date || row.month || row.period}</td>
                          <td className="px-4 py-2 text-gray-700">{row.company_name}</td>
                          {statsChannel === 'agent' && (
                            <td className="px-4 py-2 font-mono text-xs text-gray-600">
                              {row.agent_send_id || '-'}{row.cust_name ? <span className="text-gray-400"> / {row.cust_name}</span> : null}
                              {/* ★ 2026-07-25 부달 재전송 귀속분(공용 엔진 계정 → 원 발송ID). 해석 실패분은 고객사가 (미귀속)으로 표시된다 */}
                              {row.is_relay ? <span className="ml-1.5 px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-sans">부달 재전송</span> : null}
                            </td>
                          )}
                          {statsChannel === 'agent' && <td className="px-4 py-2"><span className="px-2 py-0.5 rounded-md bg-violet-50 text-violet-700 text-xs font-medium">{row.type_label || row.msg_type}</span></td>}
                          <td className="px-4 py-2 text-center text-blue-600 font-medium">{sent.toLocaleString()}</td>
                          <td className="px-4 py-2 text-center text-green-600">{success.toLocaleString()}</td>
                          <td className="px-4 py-2 text-center text-red-600">{fail.toLocaleString()}</td>
                          <td className="px-4 py-2 text-center text-amber-600">{pending.toLocaleString()}</td>
                          <td className="px-4 py-2 text-center font-medium">{sent > 0 ? `${rate}%` : '-'}</td>
                          <td className="px-4 py-2 text-center">
                            {statsChannel === 'agent' ? (
                              <span className="px-2 py-1 bg-violet-50 text-violet-700 text-xs rounded-full font-medium">에이전트</span>
                            ) : row.line_group_name ? (
                              <span className="px-2 py-1 bg-blue-50 text-blue-700 text-xs rounded-full font-medium">{row.line_group_name}</span>
                            ) : (
                              <span className="text-xs text-gray-400">미배정</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* 페이징 — 웹은 서버 페이징, 에이전트는 클라이언트 페이징(서버가 전량 반환하는 축) */}
              {statsChannel === 'agent' && agentStatsTotalPages > 1 && (
                <div className="px-6 py-4 border-t flex items-center justify-between">
                  <span className="text-xs text-gray-400 tabular-nums">
                    {(agentStatsSafePage - 1) * AGENT_STATS_PER_PAGE + 1}–
                    {Math.min(agentStatsSafePage * AGENT_STATS_PER_PAGE, agentStatsRows.length)} / 전체 {agentStatsRows.length}건
                  </span>
                  <div className="flex justify-center gap-2">
                    <button onClick={() => setAgentStatsPage(Math.max(1, agentStatsSafePage - 1))} disabled={agentStatsSafePage === 1}
                      className="whitespace-nowrap px-3 h-8 rounded text-[13px] text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed">이전</button>
                    {Array.from({ length: agentStatsTotalPages }, (_, i) => i + 1).slice(
                      Math.max(0, agentStatsSafePage - 3), Math.min(agentStatsTotalPages, agentStatsSafePage + 2)
                    ).map(p => (
                      <button key={p} onClick={() => setAgentStatsPage(p)}
                        className={`whitespace-nowrap w-8 h-8 rounded text-[13px] ${p === agentStatsSafePage ? 'bg-emerald-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
                        {p}
                      </button>
                    ))}
                    <button onClick={() => setAgentStatsPage(Math.min(agentStatsTotalPages, agentStatsSafePage + 1))} disabled={agentStatsSafePage === agentStatsTotalPages}
                      className="whitespace-nowrap px-3 h-8 rounded text-[13px] text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed">다음</button>
                  </div>
                </div>
              )}
              {statsChannel === 'web' && statsTotal > 10 && (
                <div className="px-6 py-4 border-t flex justify-center gap-2">
                  {Array.from({ length: Math.ceil(statsTotal / 10) }, (_, i) => i + 1).slice(
                    Math.max(0, statsPage - 3), Math.min(Math.ceil(statsTotal / 10), statsPage + 2)
                  ).map(p => (
                    <button
                      key={p}
                      onClick={() => loadSendStats(p)}
                      className={`whitespace-nowrap w-8 h-8 rounded text-[13px] ${p === statsPage ? 'bg-emerald-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {!sendStats && (
              <div className="text-center py-12 text-gray-400">통계 데이터를 불러오는 중...</div>
            )}
          </div>
        )}
    </>
  );
}
