/**
 * StatsDetailModal — 슈퍼관리자 AdminDashboard 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch, SetStateAction } from 'react';
import { resolveSendTypeChipClass, resolveSendTypeLabel, resolveChannelLabel } from '../../../utils/campaign-axis';
import { formatCampaignMessageForDisplay } from '../../../utils/formatDate';

export interface StatsDetailModalProps {
  setMessageDetailContent: Dispatch<SetStateAction<{ name: string; content: string; } | null>>;
  setStatsDetail: Dispatch<any>;
  setStatsDetailInfo: Dispatch<SetStateAction<{ date: string; companyName: string; } | null>>;
  statsDetail: any;
  statsDetailInfo: { date: string; companyName: string; } | null;
  statsDetailLoading: boolean;
}

export default function StatsDetailModal(props: StatsDetailModalProps) {
  const { setMessageDetailContent, setStatsDetail, setStatsDetailInfo, statsDetail, statsDetailInfo, statsDetailLoading } = props;
  if (!(statsDetailInfo)) return null; // ★ 분리 E — 본체와 같은 조건(타입 좁히기 · 본체가 이미 같은 조건으로 그린다)
  return (
    <>
    {(
        <div className="fixed inset-0 bg-gray-900/40 flex items-center justify-center p-4 z-[60]">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-gray-900">발송 통계 상세</h3>
                <p className="text-sm text-gray-500 mt-0.5">
                  {statsDetailInfo.date} · {statsDetailInfo.companyName}
                </p>
              </div>
              <button
                onClick={() => { setStatsDetail(null); setStatsDetailInfo(null); }}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="overflow-y-auto max-h-[calc(85vh-64px)] p-6 space-y-6">
              {statsDetailLoading ? (
                <div className="text-center py-12 text-gray-400">로딩 중...</div>
              ) : statsDetail ? (
                <>
                  {/* 사용자별 요약 */}
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                      <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      사용자별 발송 현황
                    </h4>
                    <div className="bg-gray-50 rounded-lg overflow-hidden">
                      <table className="w-full text-[13px]">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="whitespace-nowrap px-4 py-2 text-left text-gray-500 font-medium">사용자</th>
                            <th className="whitespace-nowrap px-4 py-2 text-left text-gray-500 font-medium">아이디</th>
                            <th className="whitespace-nowrap px-4 py-2 text-center text-gray-500 font-medium">부서</th>
                            <th className="whitespace-nowrap px-4 py-2 text-center text-gray-500 font-medium">담당 브랜드</th>
                            <th className="whitespace-nowrap px-4 py-2 text-center text-gray-500 font-medium">캠페인수</th>
                            <th className="whitespace-nowrap px-4 py-2 text-center text-gray-500 font-medium">전송</th>
                            <th className="whitespace-nowrap px-4 py-2 text-center text-gray-500 font-medium">성공</th>
                            <th className="whitespace-nowrap px-4 py-2 text-center text-gray-500 font-medium">실패</th>
                            <th className="whitespace-nowrap px-4 py-2 text-center text-gray-500 font-medium">성공률</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {statsDetail.userStats?.length === 0 ? (
                            <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">데이터가 없습니다.</td></tr>
                          ) : statsDetail.userStats?.map((u: any, idx: number) => {
                            const sent = Number(u.sent);
                            const success = Number(u.success);
                            const fail = Number(u.fail);
                            const rate = sent > 0 ? (success / sent * 100).toFixed(1) : '-';
                            return (
                              <tr key={idx} className="hover:bg-white">
                                <td className="px-4 py-2.5 font-medium text-gray-900">{u.user_name || '(알 수 없음)'}</td>
                                <td className="px-4 py-2.5 text-gray-500 font-mono text-xs">{u.login_id || '-'}</td>
                                <td className="px-4 py-2.5 text-center text-gray-500">{u.department || '-'}</td>
                                <td className="px-4 py-2.5 text-center text-gray-500">{u.store_codes?.length > 0 ? u.store_codes.join(', ') : '-'}</td>
                                <td className="px-4 py-2.5 text-center text-gray-700">{Number(u.runs)}</td>
                                <td className="px-4 py-2.5 text-center text-blue-600 font-medium">{sent.toLocaleString()}</td>
                                <td className="px-4 py-2.5 text-center text-green-600">{success.toLocaleString()}</td>
                                <td className="px-4 py-2.5 text-center text-red-600">{fail.toLocaleString()}</td>
                                <td className="px-4 py-2.5 text-center font-medium">{rate}%</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* 캠페인별 상세 */}
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                      <svg className="w-4 h-4 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                      </svg>
                      캠페인별 발송 내역
                    </h4>
                    <div className="bg-gray-50 rounded-lg overflow-hidden">
                      <table className="w-full text-[13px]">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="whitespace-nowrap px-4 py-2 text-left text-gray-500 font-medium">캠페인명</th>
                            <th className="whitespace-nowrap px-4 py-2 text-center text-gray-500 font-medium">유형</th>
                            <th className="whitespace-nowrap px-4 py-2 text-center text-gray-500 font-medium">발송자</th>
                            <th className="whitespace-nowrap px-4 py-2 text-center text-gray-500 font-medium">대상</th>
                            <th className="whitespace-nowrap px-4 py-2 text-center text-gray-500 font-medium">전송</th>
                            <th className="whitespace-nowrap px-4 py-2 text-center text-gray-500 font-medium">성공</th>
                            <th className="whitespace-nowrap px-4 py-2 text-center text-gray-500 font-medium">실패</th>
                            <th className="whitespace-nowrap px-4 py-2 text-center text-gray-500 font-medium">타입</th>
                            <th className="whitespace-nowrap px-4 py-2 text-left text-gray-500 font-medium">메시지내용</th>
                            <th className="whitespace-nowrap px-4 py-2 text-center text-gray-500 font-medium">등록일시</th>
                            <th className="whitespace-nowrap px-4 py-2 text-center text-gray-500 font-medium">발송일시</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {statsDetail.campaigns?.length === 0 ? (
                            <tr><td colSpan={11} className="px-4 py-8 text-center text-gray-400">데이터가 없습니다.</td></tr>
                          ) : statsDetail.campaigns?.map((c: any, idx: number) => (
                            <tr key={idx} className="hover:bg-white">
                              <td className="px-4 py-2.5 font-medium text-gray-900 max-w-[200px] truncate" title={c.campaign_name}>
                                {c.campaign_name}
                              </td>
                              <td className="px-4 py-2.5 text-center">
                                <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${resolveSendTypeChipClass(c.send_type)}`}>
                                  {resolveSendTypeLabel(c.send_type)}
                                </span>
                              </td>
                              <td className="px-4 py-2.5 text-center text-gray-600">{c.user_name || '-'}</td>
                              <td className="px-4 py-2.5 text-center text-gray-500">{Number(c.target_count || 0).toLocaleString()}</td>
                              <td className="px-4 py-2.5 text-center text-blue-600 font-medium">{Number(c.sent_count || 0).toLocaleString()}</td>
                              <td className="px-4 py-2.5 text-center text-green-600">{Number(c.success_count || 0).toLocaleString()}</td>
                              <td className="px-4 py-2.5 text-center text-red-600">{Number(c.fail_count || 0).toLocaleString()}</td>
                              <td className="px-4 py-2.5 text-center">
                                <span className={`inline-block px-2 py-0.5 rounded text-xs ${
                                  c.message_type === 'LMS' ? 'bg-blue-100 text-blue-700' :
                                  c.message_type === 'MMS' ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'
                                }`}>
                                  {resolveChannelLabel(c)}
                                </span>
                              </td>
                              <td className="px-4 py-2.5 text-left text-xs text-gray-600 max-w-[250px]">
                                {c.message_content ? (
                                  (() => {
                                    // ★ B2: 컨트롤타워 — opt_out_080_number 기반 (광고)+080 부착
                                    const fullMsg = formatCampaignMessageForDisplay(c);
                                    return (
                                      <div
                                        className="truncate cursor-pointer hover:text-blue-600"
                                        title="클릭하여 전체 메시지 보기"
                                        onClick={() => setMessageDetailContent({ name: c.campaign_name, content: fullMsg })}
                                      >
                                        {fullMsg.substring(0, 50)}{fullMsg.length > 50 ? '...' : ''}
                                      </div>
                                    );
                                  })()
                                ) : '-'}
                              </td>
                              <td className="px-4 py-2.5 text-center text-gray-500 font-mono text-xs">
                                {c.created_at ? new Date(c.created_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}
                              </td>
                              <td className="px-4 py-2.5 text-center text-gray-500 font-mono text-xs">
                                {/* ★ 2026-06-13: 예약 우선 — 예약 캠페인 sent_at은 등록 시점 값(0609 교훈) */}
                                {(c.scheduled_at || c.sent_at) ? new Date(c.scheduled_at || c.sent_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
