/**
 * SmsDetailModal — 슈퍼관리자 AdminDashboard 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch, SetStateAction } from 'react';
import { resolveChannelLabel } from '../../../utils/campaign-axis';

export interface SmsDetailModalProps {
  loadSmsDetail: (campaignId: string, page?: number) => Promise<void>;
  setSmsDetailModal: Dispatch<SetStateAction<boolean>>;
  setSmsDetailMsgModal: Dispatch<SetStateAction<string | null>>;
  setSmsDetailSearchType: Dispatch<SetStateAction<string>>;
  setSmsDetailSearchValue: Dispatch<SetStateAction<string>>;
  setSmsDetailStatus: Dispatch<SetStateAction<string>>;
  showAlert: (title: string, message: string, variant?: 'success' | 'error' | 'warning' | 'info') => void;
  smsDetailCampaign: any;
  smsDetailLoading: boolean;
  smsDetailPage: number;
  smsDetailRows: any[];
  smsDetailSearchType: string;
  smsDetailSearchValue: string;
  smsDetailStatus: string;
  smsDetailTotal: number;
}

export default function SmsDetailModal(props: SmsDetailModalProps) {
  const { loadSmsDetail, setSmsDetailModal, setSmsDetailMsgModal, setSmsDetailSearchType, setSmsDetailSearchValue, setSmsDetailStatus, showAlert, smsDetailCampaign, smsDetailLoading, smsDetailPage, smsDetailRows, smsDetailSearchType, smsDetailSearchValue, smsDetailStatus, smsDetailTotal } = props;
  return (
    <>
    {(
        <div className="fixed inset-0 bg-gray-900/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl overflow-hidden animate-in fade-in zoom-in" style={{ maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
            {/* 헤더 */}
            <div className="px-5 py-3.5 border-b border-gray-100 bg-gradient-to-r from-blue-50 to-white flex items-center justify-between flex-shrink-0">
              <div>
                <h3 className="text-base font-semibold text-gray-900">발송 상세 내역</h3>
                {smsDetailCampaign && (
                  <div className="flex flex-wrap gap-3 mt-1 text-xs text-gray-500">
                    <span>{smsDetailCampaign.company_name} ({smsDetailCampaign.created_by_login || '-'})</span>
                    <span>•</span>
                    <span className="font-medium text-gray-700">{smsDetailCampaign.campaign_name}</span>
                    <span>•</span>
                    <span>{resolveChannelLabel(smsDetailCampaign)}</span>
                    <span>•</span>
                    <span className={`font-medium ${smsDetailCampaign.status === 'completed' ? 'text-green-600' : smsDetailCampaign.status === 'scheduled' ? 'text-blue-600' : 'text-gray-600'}`}>
                      {smsDetailCampaign.status === 'completed' ? '완료' : smsDetailCampaign.status === 'scheduled' ? '예약' : smsDetailCampaign.status === 'sending' ? '발송중' : smsDetailCampaign.status === 'cancelled' ? '취소' : smsDetailCampaign.status}
                    </span>
                  </div>
                )}
              </div>
              <button onClick={() => setSmsDetailModal(false)}
                className="whitespace-nowrap w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">✕</button>
            </div>

            {/* 필터 */}
            <div className="px-6 py-3 border-b bg-gray-50 flex flex-wrap gap-3 items-center flex-shrink-0">
              <select value={smsDetailStatus} onChange={(e) => setSmsDetailStatus(e.target.value)}
                className="px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] bg-white">
                <option value="">전체 결과</option>
                <option value="success">성공</option>
                <option value="fail">실패</option>
                <option value="pending">대기</option>
              </select>
              <select value={smsDetailSearchType} onChange={(e) => setSmsDetailSearchType(e.target.value)}
                className="px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] bg-white">
                <option value="dest_no">수신번호</option>
                <option value="call_back">회신번호</option>
              </select>
              <input type="text" value={smsDetailSearchValue} onChange={(e) => setSmsDetailSearchValue(e.target.value)}
                placeholder="번호 검색..." className="w-40 px-3 py-1.5 border border-gray-200 rounded-lg text-[13px]"
                onKeyDown={(e) => e.key === 'Enter' && smsDetailCampaign && loadSmsDetail(smsDetailCampaign.id, 1)} />
              <button onClick={() => smsDetailCampaign && loadSmsDetail(smsDetailCampaign.id, 1)}
                className="whitespace-nowrap px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[13px] hover:bg-emerald-700">검색</button>
              <div className="ml-auto flex items-center gap-3">
                {/* ★ 2026-06-15: 슈퍼관리자 상세 엑셀 다운로드 (현재 상태 필터 그대로, 사용자 export와 동일 CT) */}
                <button
                  onClick={async () => {
                    if (!smsDetailCampaign) return;
                    const token = localStorage.getItem('token');
                    const params = new URLSearchParams();
                    if (smsDetailStatus) params.set('status', smsDetailStatus);
                    try {
                      const res = await fetch(`/api/admin/campaigns/${smsDetailCampaign.id}/sms-detail/export?${params.toString()}`, {
                        headers: { Authorization: `Bearer ${token}` },
                      });
                      if (!res.ok) { const err = await res.json().catch(() => ({})); showAlert('오류', (err as any).error || '다운로드 실패', 'error'); return; }
                      const blob = await res.blob();
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `발송상세_${smsDetailCampaign.campaign_name || smsDetailCampaign.id}.csv`;
                      a.click();
                      URL.revokeObjectURL(url);
                    } catch { showAlert('오류', '다운로드 중 오류가 발생했습니다.', 'error'); }
                  }}
                  className="whitespace-nowrap px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[13px] hover:bg-emerald-700">
                  엑셀 다운로드
                </button>
                <span className="text-sm text-gray-500">총 {smsDetailTotal.toLocaleString()}건</span>
              </div>
            </div>

            {/* 테이블 */}
            <div className="overflow-auto flex-1">
              {smsDetailLoading ? (
                <div className="flex items-center justify-center py-20 text-gray-400">
                  <svg className="animate-spin h-6 w-6 mr-2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="60" strokeLinecap="round" /></svg>
                  조회 중...
                </div>
              ) : (
                <table className="w-full text-[13px]">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 whitespace-nowrap">No.</th>
                      <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 whitespace-nowrap">등록일시</th>
                      <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 whitespace-nowrap">발송일시</th>
                      <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 whitespace-nowrap">유형</th>
                      <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 whitespace-nowrap">수신번호</th>
                      <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 whitespace-nowrap">회신번호</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">메시지 내용</th>
                      <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 whitespace-nowrap">타입</th>
                      <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 whitespace-nowrap">통신사</th>
                      <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 whitespace-nowrap">결과</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {smsDetailRows.length === 0 ? (
                      <tr><td colSpan={10} className="px-4 py-12 text-center text-gray-400">
                        {smsDetailCampaign?.status === 'scheduled' ? '아직 발송 전입니다.' : '발송 내역이 없습니다.'}
                      </td></tr>
                    ) : smsDetailRows.map((r: any, idx: number) => (
                      <tr key={r.seqno} className="hover:bg-blue-50/30">
                        <td className="px-3 py-2 text-center text-xs text-gray-400">{(smsDetailPage - 1) * 50 + idx + 1}</td>
                        {/* ★ D124: 등록일시 = 캠페인 created_at (모든 행 동일) */}
                        <td className="px-3 py-2 text-center text-xs text-gray-500 whitespace-nowrap">{smsDetailCampaign?.created_at ? new Date(smsDetailCampaign.created_at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}</td>
                        {/* ★ 발송일시 = sendreqTime(발송요청/예약 시각, KST) — 목록·통계와 동일 기준(D233+). mobsendTime(통신사 응답)은 지연 시 다음날·대기 시 빈칸이라 불일치 */}
                        <td className="px-3 py-2 text-center text-xs text-gray-500 whitespace-nowrap">{r.sendreqTime ? new Date(r.sendreqTime).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}</td>
                        <td className="px-3 py-2 text-center text-xs text-gray-600 whitespace-nowrap">{r.sendType || '-'}</td>
                        <td className="px-3 py-2 text-center text-gray-700 font-mono text-xs hover:text-blue-600 cursor-pointer" style={{ userSelect: 'text' }} title="클릭하면 복사" onClick={() => { if (r.destNo) { navigator.clipboard.writeText(String(r.destNo)); showAlert('복사 완료', '수신번호를 복사했습니다.', 'success'); } }}>{r.destNo}</td>
                        <td className="px-3 py-2 text-center text-gray-500 font-mono text-xs hover:text-blue-600 cursor-pointer" style={{ userSelect: 'text' }} title="클릭하면 복사" onClick={() => { if (r.callBack) { navigator.clipboard.writeText(String(r.callBack)); showAlert('복사 완료', '회신번호를 복사했습니다.', 'success'); } }}>{r.callBack}</td>
                        <td className="px-3 py-2 text-gray-700 text-xs max-w-xs">
                          <div
                            className="truncate cursor-pointer hover:text-blue-600 hover:underline"
                            title="클릭하면 전체 메시지 + 복사"
                            onClick={() => r.msgContents && setSmsDetailMsgModal(r.msgContents)}
                          >
                            {r.msgContents ? (r.msgContents.length > 40 ? r.msgContents.substring(0, 40) + '…' : r.msgContents) : '-'}
                          </div>
                        </td>
                        {/* ★ 2026-10-07 칸 넘침 정정(박성용 접수) — 타입 · 통신사 · 결과는 한 줄 고정 */}
                        <td className="px-3 py-2 text-center text-xs text-gray-600 whitespace-nowrap">{r.msgType}</td>
                        <td className="px-3 py-2 text-center text-xs text-gray-600 whitespace-nowrap">{r.carrier}</td>
                        <td className="px-3 py-2 text-center whitespace-nowrap">
                          {/* ★ 2026-06-13: 발송 예약(미발송) 행은 파란 칩 — 결과 대기와 구분 */}
                          <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${
                            r.statusType === 'success' ? 'bg-green-100 text-green-700' :
                            r.statusType === 'scheduled' ? 'bg-blue-100 text-blue-700' :
                            r.statusType === 'pending' ? 'bg-amber-100 text-amber-700' :
                            'bg-red-100 text-red-700'
                          }`}>{r.statusText}</span>
                          {r.isFallback && <div className="text-[11px] text-gray-400 mt-0.5">알림톡 실패</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* 하단 페이징 */}
            {smsDetailTotal > 50 && (
              <div className="px-6 py-3 border-t bg-gray-50 flex items-center justify-between flex-shrink-0">
                <span className="text-xs text-gray-500">{smsDetailPage} / {Math.ceil(smsDetailTotal / 50)} 페이지</span>
                <div className="flex gap-1">
                  <button onClick={() => smsDetailCampaign && loadSmsDetail(smsDetailCampaign.id, Math.max(1, smsDetailPage - 1))}
                    disabled={smsDetailPage === 1}
                    className="whitespace-nowrap px-3 py-1 rounded border text-xs disabled:opacity-40 hover:bg-white">◀ 이전</button>
                  <button onClick={() => smsDetailCampaign && loadSmsDetail(smsDetailCampaign.id, Math.min(Math.ceil(smsDetailTotal / 50), smsDetailPage + 1))}
                    disabled={smsDetailPage >= Math.ceil(smsDetailTotal / 50)}
                    className="whitespace-nowrap px-3 py-1 rounded border text-xs disabled:opacity-40 hover:bg-white">다음 ▶</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
