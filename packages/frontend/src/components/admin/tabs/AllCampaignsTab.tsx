/**
 * AllCampaignsTab — 슈퍼관리자 AdminDashboard 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch, SetStateAction } from 'react';
import { readAlimtalkSplit, alimtalkFallbackRows } from '../../../utils/alimtalk-split';
import { Fragment } from 'react';
import { formatDateTimeShort } from '../../../utils/formatDate';
import { resolveSendTypeChipClass, resolveSendTypeLabel, resolveChannelLabel } from '../../../utils/campaign-axis';
import type { Company } from '../admin-types';

export interface AllCampaignsTabProps {
  allCampaigns: any[];
  allCampaignsCompany: string;
  allCampaignsEndDate: string;
  allCampaignsPage: number;
  allCampaignsSearch: string;
  allCampaignsStartDate: string;
  allCampaignsStatus: string;
  allCampaignsTotal: number;
  companies: Company[];
  loadAllCampaigns: (page?: number) => Promise<void>;
  openSmsDetail: (campaignId: string) => void;
  setAllCampaignsCompany: Dispatch<SetStateAction<string>>;
  setAllCampaignsEndDate: Dispatch<SetStateAction<string>>;
  setAllCampaignsSearch: Dispatch<SetStateAction<string>>;
  setAllCampaignsStartDate: Dispatch<SetStateAction<string>>;
  setAllCampaignsStatus: Dispatch<SetStateAction<string>>;
}

export default function AllCampaignsTab(props: AllCampaignsTabProps) {
  const { allCampaigns, allCampaignsCompany, allCampaignsEndDate, allCampaignsPage, allCampaignsSearch, allCampaignsStartDate, allCampaignsStatus, allCampaignsTotal, companies, loadAllCampaigns, openSmsDetail, setAllCampaignsCompany, setAllCampaignsEndDate, setAllCampaignsSearch, setAllCampaignsStartDate, setAllCampaignsStatus } = props;
  return (
    <>
    {(
          <div className="bg-white rounded-xl border border-gray-200/80 shadow-sm">
            <div className="px-5 py-3.5 border-b border-gray-100">
              <div className="flex flex-wrap gap-3 items-center">
                <select value={allCampaignsCompany} onChange={(e) => setAllCampaignsCompany(e.target.value)}
                  className="px-3 py-1.5 border border-gray-200 rounded-lg text-[13px]">
                  <option value="">전체 고객사</option>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
                </select>
                <select value={allCampaignsStatus} onChange={(e) => setAllCampaignsStatus(e.target.value)}
                  className="px-3 py-1.5 border border-gray-200 rounded-lg text-[13px]">
                  <option value="">전체 상태</option>
                  <option value="draft">임시저장</option>
                  <option value="scheduled">예약</option>
                  <option value="sending">발송중</option>
                  <option value="completed">완료</option>
                  <option value="cancelled">취소</option>
                </select>
                <input type="date" value={allCampaignsStartDate} onChange={(e) => setAllCampaignsStartDate(e.target.value)}
                  className="px-3 py-1.5 border border-gray-200 rounded-lg text-[13px]" />
                <span className="text-gray-400">~</span>
                <input type="date" value={allCampaignsEndDate} onChange={(e) => setAllCampaignsEndDate(e.target.value)}
                  className="px-3 py-1.5 border border-gray-200 rounded-lg text-[13px]" />
                <input type="text" placeholder="캠페인명 / 회사명 / 계정" value={allCampaignsSearch}
                  onChange={(e) => setAllCampaignsSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && loadAllCampaigns(1)}
                  className="px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] w-52" />
                <button onClick={() => loadAllCampaigns(1)}
                  className="whitespace-nowrap px-4 py-2 bg-emerald-600 text-white rounded-lg text-[13px] hover:bg-emerald-700">조회</button>
                <span className="text-sm text-gray-500 ml-auto">총 {allCampaignsTotal}건</span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="whitespace-nowrap px-3 py-2 text-left text-gray-500 font-medium">회사(계정)</th>
                    <th className="whitespace-nowrap px-3 py-2 text-left text-gray-500 font-medium">캠페인명</th>
                    <th className="whitespace-nowrap px-3 py-2 text-center text-gray-500 font-medium">등록일시</th>
                    <th className="whitespace-nowrap px-3 py-2 text-center text-gray-500 font-medium">발송일시</th>
                    <th className="whitespace-nowrap px-3 py-2 text-center text-gray-500 font-medium">유형</th>
                    <th className="whitespace-nowrap px-3 py-2 text-center text-gray-500 font-medium">문자</th>
                    <th className="whitespace-nowrap px-3 py-2 text-center text-gray-500 font-medium">총건수</th>
                    <th className="whitespace-nowrap px-3 py-2 text-center text-gray-500 font-medium">성공</th>
                    <th className="whitespace-nowrap px-3 py-2 text-center text-gray-500 font-medium">실패</th>
                    <th className="whitespace-nowrap px-3 py-2 text-center text-gray-500 font-medium">대기</th>
                    <th className="whitespace-nowrap px-3 py-2 text-center text-gray-500 font-medium">상태</th>
                    <th className="whitespace-nowrap px-3 py-2 text-center text-gray-500 font-medium">상세</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {allCampaigns.length === 0 ? (
                    <tr><td colSpan={12} className="px-4 py-12 text-center text-gray-400">캠페인이 없습니다.</td></tr>
                  ) : allCampaigns.map((c: any) => {
                    // ★ 2026-10-07 (박성용 접수) 알림톡 캠페인 = 알림톡 시도로 세고, 대체로 나간 문자는 아래 줄로(거래내역서와 같은 기준)
                    const split = readAlimtalkSplit(c);
                    const sent = split ? split.total : (parseInt(c.total_sent) || 0);
                    const success = split ? split.success : (parseInt(c.total_success) || 0);
                    const fail = split ? split.fail : (parseInt(c.total_fail) || 0);
                    const pending = split ? split.pending : (c.total_pending != null ? (parseInt(c.total_pending) || 0) : Math.max(0, sent - success - fail));
                    return (
                    <Fragment key={c.id}>
                    <tr className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-700">
                        <div>{c.company_name || '-'}</div>
                        {c.created_by_login && <div className="text-xs text-gray-400">{c.created_by_login}</div>}
                      </td>
                      <td className="px-3 py-2 font-medium text-gray-900">{c.name}</td>
                      <td className="px-3 py-2 text-center text-gray-500 text-xs whitespace-nowrap">
                        {c.created_at ? formatDateTimeShort(c.created_at) : '-'}
                      </td>
                      <td className="px-3 py-2 text-center text-gray-500 text-xs whitespace-nowrap">
                        {/* ★ 발송일시 = 송출일 기준(예약시각 우선) — 발송통계·상세와 일치 */}
                        {c.scheduled_at ? formatDateTimeShort(c.scheduled_at) : c.sent_at ? formatDateTimeShort(c.sent_at) : '-'}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                          resolveSendTypeChipClass(c.send_type)
                        }`}>{resolveSendTypeLabel(c.send_type)}</span>
                      </td>
                      <td className="px-3 py-2 text-center text-xs text-gray-600">{resolveChannelLabel(c)}</td>
                      <td className="px-3 py-2 text-center text-gray-700">{sent.toLocaleString()}</td>
                      <td className="px-3 py-2 text-center text-green-600 font-medium">{success.toLocaleString()}</td>
                      <td className="px-3 py-2 text-center text-red-600">{fail.toLocaleString()}</td>
                      <td className="px-3 py-2 text-center text-amber-600">{pending.toLocaleString()}</td>
                      <td className="px-3 py-2 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                          c.status === 'completed' ? 'bg-green-100 text-green-700' :
                          c.status === 'sending' ? 'bg-amber-100 text-amber-700' :
                          c.status === 'scheduled' ? 'bg-blue-100 text-blue-700' :
                          c.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                          'bg-gray-100 text-gray-700'
                        }`}>
                          {c.status === 'completed' ? '완료' : c.status === 'sending' ? '발송중' : c.status === 'scheduled' ? '예약' : c.status === 'cancelled' ? '취소' : c.status === 'draft' ? '임시' : c.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        {c.status !== 'draft' && (
                          <button onClick={() => openSmsDetail(c.id)}
                            className="whitespace-nowrap text-emerald-700 hover:text-emerald-800 text-xs font-medium">[조회]</button>
                        )}
                      </td>
                    </tr>
                    {split && alimtalkFallbackRows(split).map((f) => (
                      <tr key={`${c.id}-${f.type}`} className="bg-gray-50/70">
                        <td className="px-3 py-1.5" />
                        <td className="px-3 py-1.5 text-xs text-gray-500" colSpan={4}>↳ 알림톡 실패분</td>
                        <td className="px-3 py-1.5 text-center text-xs text-gray-600 whitespace-nowrap">대체 {f.type}</td>
                        <td className="px-3 py-1.5 text-center text-xs text-gray-700">{f.total.toLocaleString()}</td>
                        <td className="px-3 py-1.5 text-center text-xs text-green-600 font-medium">{f.success.toLocaleString()}</td>
                        <td className="px-3 py-1.5 text-center text-xs text-red-600">{f.fail.toLocaleString()}</td>
                        <td className="px-3 py-1.5 text-center text-xs text-amber-600">{f.pending.toLocaleString()}</td>
                        <td className="px-3 py-1.5" colSpan={2} />
                      </tr>
                    ))}
                    </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {allCampaignsTotal > 10 && (
              <div className="px-6 py-4 border-t flex items-center justify-between">
                <span className="text-sm text-gray-500">총 {allCampaignsTotal}건</span>
                <div className="flex gap-1">
                  <button onClick={() => loadAllCampaigns(Math.max(1, allCampaignsPage - 1))} disabled={allCampaignsPage === 1}
                    className="whitespace-nowrap px-3 py-1 rounded border text-[13px] disabled:opacity-40 hover:bg-gray-50">◀</button>
                  {Array.from({ length: Math.ceil(allCampaignsTotal / 10) }, (_, i) => i + 1).slice(
                    Math.max(0, allCampaignsPage - 3), Math.min(Math.ceil(allCampaignsTotal / 10), allCampaignsPage + 2)
                  ).map(p => (
                    <button key={p} onClick={() => loadAllCampaigns(p)}
                      className={`whitespace-nowrap w-8 h-8 rounded text-[13px] ${p === allCampaignsPage ? 'bg-emerald-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>{p}</button>
                  ))}
                  <button onClick={() => loadAllCampaigns(Math.min(Math.ceil(allCampaignsTotal / 10), allCampaignsPage + 1))}
                    disabled={allCampaignsPage >= Math.ceil(allCampaignsTotal / 10)}
                    className="whitespace-nowrap px-3 py-1 rounded border text-[13px] disabled:opacity-40 hover:bg-gray-50">▶</button>
                </div>
              </div>
            )}
          </div>
        )}
    </>
  );
}
