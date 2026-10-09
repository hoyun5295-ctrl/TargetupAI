/**
 * ScheduledTab — 슈퍼관리자 AdminDashboard 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch, SetStateAction } from 'react';
import { formatDateTimeShort } from '../../../utils/formatDate';
import type { Company } from '../admin-types';

export interface ScheduledTabProps {
  companies: Company[];
  loadScheduledCampaigns: (page?: number) => Promise<void>;
  openSmsDetail: (campaignId: string) => void;
  scheduledCampaigns: any[];
  scheduledCompanyFilter: string;
  scheduledEndDate: string;
  scheduledLoginId: string;
  scheduledPage: number;
  scheduledPerPage: 20;
  scheduledSearch: string;
  scheduledStartDate: string;
  scheduledStatusFilter: string;
  scheduledTotal: number;
  setCancelReason: Dispatch<SetStateAction<string>>;
  setCancelTarget: Dispatch<SetStateAction<{ id: string; name: string; } | null>>;
  setScheduledCompanyFilter: Dispatch<SetStateAction<string>>;
  setScheduledEndDate: Dispatch<SetStateAction<string>>;
  setScheduledLoginId: Dispatch<SetStateAction<string>>;
  setScheduledSearch: Dispatch<SetStateAction<string>>;
  setScheduledStartDate: Dispatch<SetStateAction<string>>;
  setScheduledStatusFilter: Dispatch<SetStateAction<string>>;
  setShowCancelModal: Dispatch<SetStateAction<boolean>>;
}

export default function ScheduledTab(props: ScheduledTabProps) {
  const { companies, loadScheduledCampaigns, openSmsDetail, scheduledCampaigns, scheduledCompanyFilter, scheduledEndDate, scheduledLoginId, scheduledPage, scheduledPerPage, scheduledSearch, scheduledStartDate, scheduledStatusFilter, scheduledTotal, setCancelReason, setCancelTarget, setScheduledCompanyFilter, setScheduledEndDate, setScheduledLoginId, setScheduledSearch, setScheduledStartDate, setScheduledStatusFilter, setShowCancelModal } = props;

  const openCancelModal = (id: string, name: string) => {
    setCancelTarget({ id, name });
    setCancelReason('');
    setShowCancelModal(true);
  };
  return (
    <>
    {(
          <div className="bg-white rounded-xl border border-gray-200/80 shadow-sm">
            <div className="px-5 py-3.5 border-b border-gray-100">
              <h2 className="text-base font-semibold">예약 캠페인 관리</h2>
            </div>

            {/* 검색 필터 */}
            <div className="px-6 py-3 border-b bg-gray-50 flex flex-wrap gap-3 items-center">
              <select value={scheduledCompanyFilter} onChange={(e) => setScheduledCompanyFilter(e.target.value)}
                className="px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] bg-white">
                <option value="">전체 고객사</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
              </select>
              <select value={scheduledStatusFilter} onChange={(e) => setScheduledStatusFilter(e.target.value)}
                className="px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] bg-white">
                <option value="">전체 상태</option>
                <option value="scheduled">예약</option>
                <option value="cancelled">취소</option>
              </select>
              <input type="date" value={scheduledStartDate} onChange={(e) => setScheduledStartDate(e.target.value)}
                className="px-3 py-1.5 border border-gray-200 rounded-lg text-[13px]" />
              <span className="text-gray-400">~</span>
              <input type="date" value={scheduledEndDate} onChange={(e) => setScheduledEndDate(e.target.value)}
                className="px-3 py-1.5 border border-gray-200 rounded-lg text-[13px]" />
              <input type="text" value={scheduledLoginId} onChange={(e) => setScheduledLoginId(e.target.value)}
                placeholder="계정(로그인ID)" className="w-36 px-3 py-1.5 border border-gray-200 rounded-lg text-[13px]"
                onKeyDown={(e) => e.key === 'Enter' && loadScheduledCampaigns(1)} />
              <input type="text" value={scheduledSearch} onChange={(e) => setScheduledSearch(e.target.value)}
                placeholder="캠페인명/회사명 검색" className="w-48 px-3 py-1.5 border border-gray-200 rounded-lg text-[13px]"
                onKeyDown={(e) => e.key === 'Enter' && loadScheduledCampaigns(1)} />
              <button onClick={() => loadScheduledCampaigns(1)}
                className="whitespace-nowrap px-4 py-2 bg-emerald-600 text-white rounded-lg text-[13px] hover:bg-emerald-700">조회</button>
              <span className="text-sm text-gray-500 ml-auto">총 {scheduledTotal}건</span>
            </div>

            <div className="overflow-x-auto">
              {/* ★ D145 P0 (2026-05-07): 컴팩트 — text-xs base + py-2 + 짧은 일시 포맷 + 캠페인명 240px */}
              <table className="w-full text-xs">
              <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-500 whitespace-nowrap">고객사</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500 whitespace-nowrap">캠페인명</th>
                    <th className="px-3 py-2 text-center font-medium text-gray-500 whitespace-nowrap">대상</th>
                    <th className="px-3 py-2 text-center font-medium text-gray-500 whitespace-nowrap">생성자</th>
                    <th className="px-3 py-2 text-center font-medium text-gray-500 whitespace-nowrap">등록</th>
                    <th className="px-3 py-2 text-center font-medium text-gray-500 whitespace-nowrap">예약시간</th>
                    <th className="px-3 py-2 text-center font-medium text-gray-500 whitespace-nowrap">상태</th>
                    <th className="px-3 py-2 text-center font-medium text-gray-500 whitespace-nowrap">상세</th>
                    <th className="px-3 py-2 text-center font-medium text-gray-500 whitespace-nowrap">관리</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {scheduledCampaigns.length === 0 ? (
                    <tr><td colSpan={9} className="px-6 py-12 text-center text-gray-500">예약/취소 캠페인이 없습니다.</td></tr>
                  ) : scheduledCampaigns.map((campaign) => (
                      <tr key={campaign.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-gray-900 whitespace-nowrap">
                          {campaign.company_name}
                          <span className="text-gray-400 ml-1">({campaign.company_code})</span>
                        </td>
                        <td className="px-3 py-2 text-gray-900" style={{ maxWidth: '240px' }}>
                          <div className="truncate" title={campaign.campaign_name}>{campaign.campaign_name}</div>
                        </td>
                        <td className="px-3 py-2 text-center text-gray-500 whitespace-nowrap">
                          {campaign.target_count?.toLocaleString() || 0}명
                        </td>
                        <td className="px-3 py-2 text-center text-gray-500 whitespace-nowrap">
                          {campaign.created_by_name || '-'}
                          {campaign.created_by_login && <span className="text-gray-400 ml-0.5">({campaign.created_by_login})</span>}
                        </td>
                        <td className="px-3 py-2 text-center text-gray-500 whitespace-nowrap">
                          {campaign.created_at ? formatDateTimeShort(campaign.created_at) : '-'}
                        </td>
                        <td className="px-3 py-2 text-center text-gray-500 whitespace-nowrap">
                          {campaign.scheduled_at ? formatDateTimeShort(campaign.scheduled_at) : '-'}
                        </td>
                        <td className="px-3 py-2 text-center whitespace-nowrap" style={{ minWidth: '70px' }}>
                          {campaign.status === 'scheduled' ? (
                            <span className="px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-800">예약</span>
                          ) : (
                            <div>
                              <span className="px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-800">취소</span>
                              {campaign.cancelled_by_type === 'super_admin' && (
                                <span className="ml-1 text-red-500">(관리자)</span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center whitespace-nowrap" style={{ minWidth: '60px' }}>
                          <button onClick={() => openSmsDetail(campaign.id)}
                            className="whitespace-nowrap text-emerald-700 hover:text-emerald-800 font-medium">[조회]</button>
                        </td>
                        <td className="px-3 py-2 text-center whitespace-nowrap" style={{ minWidth: '60px' }}>
                          {campaign.status === 'scheduled' ? (
                            <button onClick={() => openCancelModal(campaign.id, campaign.campaign_name)}
                              className="whitespace-nowrap text-red-600 hover:text-red-800">취소</button>
                          ) : (
                            <span className="text-gray-400" title={campaign.cancel_reason || ''}>
                              {campaign.cancel_reason ? `사유: ${campaign.cancel_reason.substring(0, 15)}${campaign.cancel_reason.length > 15 ? '…' : ''}` : '-'}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  }
                </tbody>
              </table>
            </div>

            {/* 서버사이드 페이징 */}
            {scheduledTotal > scheduledPerPage && (
              <div className="px-6 py-4 border-t flex items-center justify-between">
                <span className="text-sm text-gray-500">총 {scheduledTotal}건</span>
                <div className="flex gap-1">
                  <button onClick={() => loadScheduledCampaigns(Math.max(1, scheduledPage - 1))} disabled={scheduledPage === 1}
                    className="whitespace-nowrap px-3 py-1 rounded border text-[13px] disabled:opacity-40 hover:bg-gray-50">◀</button>
                  <span className="px-3 py-1 text-sm text-gray-600">{scheduledPage} / {Math.ceil(scheduledTotal / scheduledPerPage)}</span>
                  <button onClick={() => loadScheduledCampaigns(Math.min(Math.ceil(scheduledTotal / scheduledPerPage), scheduledPage + 1))}
                    disabled={scheduledPage >= Math.ceil(scheduledTotal / scheduledPerPage)}
                    className="whitespace-nowrap px-3 py-1 rounded border text-[13px] disabled:opacity-40 hover:bg-gray-50">▶</button>
                </div>
              </div>
            )}
            </div>
        )}
    </>
  );
}
