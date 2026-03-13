import { useEffect, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { formatDateTime } from '../utils/formatDate';

interface CalendarModalProps {
  onClose: () => void;
  token: string | null;
  onEdit?: (campaign: any) => void;
}

export default function CalendarModal({ onClose, token, onEdit }: CalendarModalProps) {
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<number | null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState<any>(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  useEffect(() => {
    fetchCampaigns();
  }, [year, month]);

  const fetchCampaigns = async () => {
    try {
      const res = await fetch(`/api/campaigns?year=${year}&month=${month + 1}`, {
        headers: { Authorization: `Bearer ${useAuthStore.getState().token}` },
      });
      const data = await res.json();
      setCampaigns(data.campaigns || []);
    } catch (error) {
      console.error('캠페인 조회 에러:', error);
    }
  };

  const getDaysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
  const getFirstDayOfMonth = (y: number, m: number) => new Date(y, m, 1).getDay();

  const getCampaignsForDay = (day: number) => {
    return campaigns.filter((c) => {
      const dateStr = c.scheduled_at || c.sent_at || c.created_at;
      if (!dateStr) return false;
      const date = new Date(dateStr);
      return date.getDate() === day && date.getMonth() === month && date.getFullYear() === year;
    });
  };

  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const blanks = Array.from({ length: firstDay }, (_, i) => i);

  const statusColors: Record<string, string> = {
    draft: 'bg-amber-100 text-amber-700',
    scheduled: 'bg-blue-200 text-blue-700',
    sending: 'bg-orange-200 text-orange-700',
    completed: 'bg-green-200 text-green-700',
    failed: 'bg-red-200 text-red-700',
    cancelled: 'bg-gray-200 text-gray-400',
  };
  const statusLabels: Record<string, string> = {
    draft: '준비', scheduled: '예약', sending: '진행', completed: '완료', failed: '실패', cancelled: '취소',
  };

  const handleDateClick = (day: number) => {
    setSelectedDate(day);
    setSelectedCampaign(null);
  };

  const handleCampaignClick = (campaign: any, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedCampaign(campaign);
  };

  const selectedDateCampaigns = selectedDate ? getCampaignsForDay(selectedDate) : [];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-[900px] max-h-[650px] overflow-hidden">
        {/* 헤더 */}
        <div className="flex justify-between items-center p-4 border-b bg-gray-50">
          <button onClick={() => setCurrentDate(new Date(year, month - 1, 1))} className="px-3 py-1 hover:bg-gray-200 rounded">←</button>
          <h2 className="text-lg font-bold">{year}년 {month + 1}월</h2>
          <button onClick={() => setCurrentDate(new Date(year, month + 1, 1))} className="px-3 py-1 hover:bg-gray-200 rounded">→</button>
          <button onClick={onClose} className="ml-4 text-gray-500 hover:text-gray-700 text-xl">✕</button>
        </div>

        <div className="flex">
          {/* 캘린더 */}
          <div className="flex-1 p-4">
            {/* 상태 색상 가이드 */}
            <div className="flex items-center gap-4 mb-3 pb-2 border-b text-xs">
              <span className="text-gray-500">상태:</span>
              <div className="flex items-center gap-1">
                <span className="w-3 h-3 rounded bg-amber-100 border border-amber-300"></span>
                <span className="text-gray-600">준비</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-3 h-3 rounded bg-blue-200"></span>
                <span className="text-gray-600">예약</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-3 h-3 rounded bg-green-200"></span>
                <span className="text-gray-600">완료</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-3 h-3 rounded bg-orange-200"></span>
                <span className="text-gray-600">진행</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-3 h-3 rounded bg-gray-200"></span>
                <span className="text-gray-600">취소</span>
              </div>
            </div>
            {/* 요일 헤더 - 색상 적용 */}
            <div className="grid grid-cols-7 gap-1 mb-2">
              {['일','월','화','수','목','금','토'].map((d, idx) => (
                <div 
                  key={d} 
                  className={`text-center text-xs font-medium ${
                    idx === 0 ? 'text-red-500' : idx === 6 ? 'text-blue-500' : 'text-gray-500'
                  }`}
                >
                  {d}
                </div>
              ))}
            </div>
            {/* 날짜 그리드 */}
            <div className="grid grid-cols-7 gap-1">
              {blanks.map(i => <div key={`b-${i}`} className="h-20 bg-gray-50 rounded" />)}
              {days.map(day => {
                const dayCampaigns = getCampaignsForDay(day);
                const isToday = day === new Date().getDate() && month === new Date().getMonth() && year === new Date().getFullYear();
                const isSelected = selectedDate === day;
                const dayOfWeek = new Date(year, month, day).getDay();
                
                const getEventPosition = (c: any) => {
                  return 'single';
                };

                const getBarStyle = (position: string) => {
                  switch (position) {
                    case 'start': return 'rounded-l rounded-r-none';
                    case 'middle': return 'rounded-none';
                    case 'end': return 'rounded-r rounded-l-none';
                    default: return 'rounded';
                  }
                };
                
                return (
                  <div 
                    key={day} 
                    onClick={() => handleDateClick(day)}
                    className={`h-20 border rounded p-1 text-xs cursor-pointer transition-all hover:bg-gray-50 overflow-visible flex flex-col ${
                      isToday ? 'border-blue-500 border-2 bg-blue-50' : 
                      isSelected ? 'border-purple-500 border-2 bg-purple-50' : 'border-gray-200'
                    }`}
                  >
                    {/* 날짜 숫자 - 요일별 색상 */}
                    <div className={`font-medium text-center ${
                      isToday ? 'text-blue-600' : 
                      dayOfWeek === 0 ? 'text-red-500' : 
                      dayOfWeek === 6 ? 'text-blue-500' : 'text-gray-700'
                    }`}>
                      {day}
                    </div>
                    {/* 캠페인 목록 - 연결 바 */}
{dayCampaigns.slice(0, 2).map(c => {
  const position = getEventPosition(c);
  const barMargin = position === 'start' ? '-mr-2' : position === 'end' ? '-ml-2' : position === 'middle' ? '-mx-2' : '';
  return (
    <div 
      key={c.id} 
      onClick={(e) => handleCampaignClick(c, e)} 
      className={`truncate cursor-pointer px-1 mt-0.5 hover:opacity-80 h-5 leading-5 text-[11px] ${statusColors[c.status] || 'bg-gray-100'} ${getBarStyle(position)} ${barMargin}`}
      style={{ zIndex: position === 'start' ? 2 : 1 }}
    >
      {(() => {
  if (position === 'single') return c.campaign_name;
  if (!c.event_start_date || !c.event_end_date) return '';
  const startStr = c.event_start_date.slice(0, 10);
  const endStr = c.event_end_date.slice(0, 10);
  const startDay = parseInt(startStr.split('-')[2]);
  const endDay = parseInt(endStr.split('-')[2]);
  const middleDay = Math.round((startDay + endDay) / 2);
  return day === middleDay ? c.campaign_name : '';
})()}
    </div>
  );
})}
                    {dayCampaigns.length > 2 && (
                      <div className="text-gray-400 mt-0.5 hover:text-purple-600">+{dayCampaigns.length - 2}개 더</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 우측 패널 - 날짜 선택 또는 캠페인 상세 */}
          <div className="w-72 border-l bg-gray-50 flex flex-col max-h-[580px]">
            {selectedCampaign ? (
              <div className="p-4 overflow-y-auto flex-1">
                <div className="flex justify-between items-start mb-4">
                  <h3 className="font-bold text-base leading-tight">{selectedCampaign.campaign_name}</h3>
                  <button onClick={() => setSelectedCampaign(null)} className="text-gray-400 hover:text-gray-600 text-sm">✕</button>
                </div>
                
                <div className="space-y-3 text-sm">
                  {/* 상태 */}
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500 w-16">상태</span>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColors[selectedCampaign.status]}`}>
                      {statusLabels[selectedCampaign.status]}
                      {selectedCampaign.status === 'cancelled' && selectedCampaign.cancelled_by_type === 'super_admin' && (
                        <span className="ml-1 text-red-500">(관리자)</span>
                      )}
                    </span>
                  </div>
                  
                  {/* 취소 사유 (관리자 취소 시) */}
                  {selectedCampaign.status === 'cancelled' && selectedCampaign.cancel_reason && (
                    <div className="flex items-start gap-2">
                      <span className="text-gray-500 w-16">취소사유</span>
                      <span className="text-red-600 text-xs flex-1">{selectedCampaign.cancel_reason}</span>
                    </div>
                  )}
                  
                  {/* 채널 */}
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500 w-16">채널</span>
                    <span className="font-medium">{selectedCampaign.message_type}</span>
                  </div>
                  
                  {/* 대상 */}
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500 w-16">대상</span>
                    <span className="font-medium">{selectedCampaign.target_count?.toLocaleString()}명</span>
                  </div>
                  
                  {/* 예약시간 */}
                  {selectedCampaign.scheduled_at && (
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500 w-16">예약</span>
                      <span className="font-medium text-blue-600">
                        {new Date(selectedCampaign.scheduled_at).toLocaleString('ko-KR', {
                          timeZone: 'Asia/Seoul', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                        })}
                      </span>
                    </div>
                  )}
                  
                  {/* 발송시간 */}
                  {selectedCampaign.sent_at && (
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500 w-16">발송</span>
                      <span className="font-medium">
                        {new Date(selectedCampaign.sent_at).toLocaleString('ko-KR', {
                          timeZone: 'Asia/Seoul', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                        })}
                      </span>
                    </div>
                  )}
                  
                  {/* 메시지 미리보기 */}
                  {selectedCampaign.message_content && (
                    <div className="pt-3 border-t">
                      <div className="text-gray-500 mb-2">💬 메시지</div>
                      <div className="bg-white rounded-lg p-3 text-xs text-gray-700 whitespace-pre-wrap border max-h-24 overflow-y-auto">
                        {selectedCampaign.message_content}
                      </div>
                    </div>
                  )}
                  
                  {/* 발송 결과 */}
                  {(selectedCampaign.status === 'completed' || selectedCampaign.status === 'sending') && (
                    <div className="pt-3 border-t">
                      <div className="text-gray-500 mb-2">📊 발송 결과</div>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="bg-white rounded p-2 border">
                          <div className="font-bold text-gray-700">{selectedCampaign.sent_count?.toLocaleString() || 0}</div>
                          <div className="text-xs text-gray-400">발송</div>
                        </div>
                        <div className="bg-green-50 rounded p-2 border border-green-200">
                          <div className="font-bold text-green-600">{selectedCampaign.success_count?.toLocaleString() || 0}</div>
                          <div className="text-xs text-gray-400">성공</div>
                        </div>
                        <div className="bg-red-50 rounded p-2 border border-red-200">
                          <div className="font-bold text-red-600">{selectedCampaign.fail_count?.toLocaleString() || 0}</div>
                          <div className="text-xs text-gray-400">실패</div>
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {/* 버튼 — 상태별 액션 */}
                  {selectedCampaign.status === 'scheduled' && (
                    <div className="pt-4">
                      <button
                        onClick={async () => {
                          if (!window.confirm('이 예약을 취소하시겠습니까?')) return;
                          try {
                            const token = localStorage.getItem('token');
                            const res = await fetch(`/api/campaigns/${selectedCampaign.id}/cancel`, {
                              method: 'POST',
                              headers: { Authorization: `Bearer ${token}` }
                            });
                            const data = await res.json();
                            if (data.success) {
                              fetchCampaigns();
                              setSelectedCampaign(null);
                            } else {
                              alert(data.error || '예약 취소에 실패했습니다');
                            }
                          } catch (err) {
                            alert('서버 연결 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
                          }
                        }}
                        className="w-full py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 text-sm font-medium transition-colors">
                        🚫 예약 취소
                      </button>
                    </div>
                  )}

                  {/* draft 상태: 발송 미확정 경고 + 삭제 버튼 */}
                  {selectedCampaign.status === 'draft' && (
                    <div className="pt-4 space-y-3">
                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700">
                        <span className="font-bold">⚠️ 발송 미확정</span>
                        <p className="mt-1">이 캠페인은 아직 발송이 확정되지 않았습니다. 발송 버튼을 누르기 전까지 실제 발송되지 않습니다.</p>
                      </div>
                      <button
                        onClick={async () => {
                          if (!window.confirm(`"${selectedCampaign.campaign_name}" 캠페인을 삭제하시겠습니까?\n삭제된 캠페인은 복구할 수 없습니다.`)) return;
                          try {
                            const token = localStorage.getItem('token');
                            const res = await fetch(`/api/campaigns/${selectedCampaign.id}`, {
                              method: 'DELETE',
                              headers: { Authorization: `Bearer ${token}` }
                            });
                            const data = await res.json();
                            if (data.success) {
                              fetchCampaigns();
                              setSelectedCampaign(null);
                            } else {
                              alert(data.error || '삭제에 실패했습니다');
                            }
                          } catch (err) {
                            alert('서버 연결 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
                          }
                        }}
                        className="w-full py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 text-sm font-medium transition-colors">
                        🗑️ 캠페인 삭제
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : selectedDate ? (
              <div className="p-4 overflow-y-auto flex-1">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-bold">
                    {month + 1}월 {selectedDate}일
                    <span className="text-gray-400 font-normal ml-1">
                      ({['일','월','화','수','목','금','토'][new Date(year, month, selectedDate).getDay()]})
                    </span>
                  </h3>
                  <button onClick={() => setSelectedDate(null)} className="text-gray-400 hover:text-gray-600 text-sm">✕</button>
                </div>
                
                {selectedDateCampaigns.length > 0 ? (
                  <div className="space-y-2">
                    {selectedDateCampaigns.map(c => (
                      <div 
                        key={c.id}
                        onClick={() => setSelectedCampaign(c)}
                        className="p-3 bg-white rounded-lg border hover:border-purple-400 cursor-pointer transition-colors"
                      >
                        <div className="font-medium text-sm mb-1 truncate">{c.campaign_name}</div>
                        <div className="flex items-center gap-2 text-xs">
                          <span className={`px-1.5 py-0.5 rounded ${statusColors[c.status]}`}>
                            {statusLabels[c.status]}
                          </span>
                          <span className="text-gray-400">{c.message_type}</span>
                          <span className="text-gray-400">{c.target_count?.toLocaleString()}명</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center text-gray-400 py-8">
                    <div className="text-3xl mb-2">📭</div>
                    <p>이 날짜에 캠페인이 없습니다</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-center text-gray-400 p-4">
                <div>
                  <div className="text-4xl mb-3">📅</div>
                  <p className="text-sm">날짜나 캠페인을<br/>선택해주세요</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
