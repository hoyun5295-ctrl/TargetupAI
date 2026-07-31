import { useState, useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { formatDateTime } from '../utils/formatDate';
import { resolveChannelLabel } from '../utils/campaign-axis';

interface Campaign {
  id: string;
  campaign_name: string;
  status: string;
  message_type: string;
  // 카카오·알림톡은 message_type이 전부 'LMS'라 채널 구분은 이 값이 담당한다(GET /api/campaigns 응답).
  send_channel?: string | null;
  target_count: number;
  sent_count: number;
  success_count: number;
  fail_count: number;
  scheduled_at: string | null;
  sent_at: string | null;
  created_at: string;
}

const statusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  scheduled: 'bg-pink-100 text-pink-700',
  sending: 'bg-yellow-100 text-yellow-800',
  completed: 'bg-amber-100 text-amber-700',
  failed: 'bg-red-100 text-red-800',
  cancelled: 'bg-gray-200 text-gray-500',
};

const statusLabels: Record<string, string> = {
  draft: '준비',
  scheduled: '예약',
  sending: '진행',
  completed: '완료',
  failed: '실패',
  cancelled: '취소',
};

export default function CalendarPage() {
  const { token } = useAuthStore();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  useEffect(() => {
    fetchCampaigns();
  }, [year, month]);

  // 드로어 열기/닫기 동기화
  useEffect(() => {
    if (selectedCampaign) {
      setDrawerOpen(true);
    }
  }, [selectedCampaign]);

  const closeDrawer = () => {
    setDrawerOpen(false);
    setTimeout(() => setSelectedCampaign(null), 300); // 애니메이션 후 데이터 클리어
  };

  const fetchCampaigns = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/campaigns?year=${year}&month=${month + 1}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setCampaigns(data.campaigns || []);
    } catch (error) {
      console.error('캠페인 조회 에러:', error);
    }
    setLoading(false);
  };

  const getDaysInMonth = (year: number, month: number) => {
    return new Date(year, month + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (year: number, month: number) => {
    return new Date(year, month, 1).getDay();
  };

  const getCampaignsForDay = (day: number) => {
    return campaigns.filter((c) => {
      const dateStr = c.scheduled_at || c.created_at;
      const date = new Date(dateStr);
      return date.getDate() === day && date.getMonth() === month && date.getFullYear() === year;
    });
  };

  const prevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const blanks = Array.from({ length: firstDay }, (_, i) => i);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-gray-900">📅 캠페인 캘린더</h1>
          <button
            onClick={() => window.location.href = '/dashboard'}
            className="text-gray-600 hover:text-gray-900"
          >
            ← 대시보드로
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* 월 네비게이션 */}
        <div className="flex justify-between items-center mb-6">
          <button
            onClick={prevMonth}
            className="px-4 py-2 bg-white border rounded-lg hover:bg-gray-50"
          >
            ← 이전달
          </button>
          <h2 className="text-xl font-semibold">
            {year}년 {month + 1}월
          </h2>
          <button
            onClick={nextMonth}
            className="px-4 py-2 bg-white border rounded-lg hover:bg-gray-50"
          >
            다음달 →
          </button>
        </div>

        <div className="flex gap-6">
          {/* 캘린더 그리드 */}
          <div className="flex-1 bg-white rounded-lg shadow p-4">
            {/* 상태 색상 가이드 */}
            <div className="flex items-center gap-4 mb-4 pb-3 border-b">
              <span className="text-sm text-gray-500">상태:</span>
              <div className="flex items-center gap-1">
                <span className="w-3 h-3 rounded bg-amber-100 border border-amber-300"></span>
                <span className="text-xs text-gray-600">완료</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-3 h-3 rounded bg-pink-100 border border-pink-300"></span>
                <span className="text-xs text-gray-600">예약</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-3 h-3 rounded bg-gray-200 border border-gray-300"></span>
                <span className="text-xs text-gray-600">취소</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-3 h-3 rounded bg-yellow-100 border border-yellow-300"></span>
                <span className="text-xs text-gray-600">진행중</span>
              </div>
            </div>
            {/* 요일 헤더 */}
            <div className="grid grid-cols-7 gap-1 mb-2">
              {['일', '월', '화', '수', '목', '금', '토'].map((day, idx) => (
                <div 
                  key={day} 
                  className={`text-center text-sm font-medium py-2 ${
                    idx === 0 ? 'text-red-500' : idx === 6 ? 'text-blue-500' : 'text-gray-500'
                  }`}
                >
                  {day}
                </div>
              ))}
            </div>

            {/* 날짜 그리드 */}
            <div className="grid grid-cols-7 gap-1">
              {blanks.map((i) => (
                <div key={`blank-${i}`} className="h-24 bg-gray-50 rounded" />
              ))}
              {days.map((day) => {
                const dayCampaigns = getCampaignsForDay(day);
                const isToday =
                  day === new Date().getDate() &&
                  month === new Date().getMonth() &&
                  year === new Date().getFullYear();
                const dayOfWeek = new Date(year, month, day).getDay();

                return (
                  <div
                    key={day}
                    className={`h-24 border rounded p-1 overflow-hidden cursor-pointer hover:bg-gray-50 transition-colors ${
                      isToday ? 'border-blue-500 border-2 bg-blue-50' : 'border-gray-200'
                    }`}
                  >
                    <div className={`text-sm font-medium mb-1 ${
                      isToday ? 'text-blue-600' : 
                      dayOfWeek === 0 ? 'text-red-500' : 
                      dayOfWeek === 6 ? 'text-blue-500' : 'text-gray-700'
                    }`}>
                      {day}
                    </div>
                    <div className="space-y-1">
                      {dayCampaigns.slice(0, 2).map((c) => (
                        <div
                          key={c.id}
                          onClick={() => setSelectedCampaign(c)}
                          className={`text-xs px-1 py-0.5 rounded truncate cursor-pointer hover:opacity-80 ${
                            statusColors[c.status] || 'bg-gray-100'
                          }`}
                        >
                          {c.campaign_name}
                        </div>
                      ))}
                      {dayCampaigns.length > 2 && (
                        <div className="text-xs text-gray-500">+{dayCampaigns.length - 2}개</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 우측 상세 드로어 - 슬라이드 애니메이션 */}
          <div 
            className={`w-80 bg-white rounded-lg shadow-lg transition-all duration-300 ease-in-out overflow-hidden ${
              drawerOpen ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-4 pointer-events-none'
            }`}
            style={{ minHeight: '400px' }}
          >
            {selectedCampaign ? (
              <div className="p-4">
                <div className="flex justify-between items-start mb-4">
                  <h3 className="text-lg font-semibold">{selectedCampaign.campaign_name}</h3>
                  <button
                    onClick={closeDrawer}
                    className="text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    ✕
                  </button>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center">
                    <span className="text-sm text-gray-500 w-16">상태</span>
                    <span className={`px-2 py-1 rounded text-sm ${statusColors[selectedCampaign.status]}`}>
                      {statusLabels[selectedCampaign.status] || selectedCampaign.status}
                    </span>
                  </div>

                  <div className="flex items-center">
                    <span className="text-sm text-gray-500 w-16">채널</span>
                    <span className="font-medium">{resolveChannelLabel(selectedCampaign)}</span>
                  </div>

                  <div className="flex items-center">
                    <span className="text-sm text-gray-500 w-16">대상</span>
                    <span className="font-medium">{selectedCampaign.target_count?.toLocaleString()}명</span>
                  </div>

                  {selectedCampaign.scheduled_at && (
                    <div className="flex items-center">
                      <span className="text-sm text-gray-500 w-16">예약</span>
                      <span className="font-medium">
                      {formatDateTime(selectedCampaign.scheduled_at)}
                      </span>
                    </div>
                  )}

                  {selectedCampaign.status === 'completed' && (
                    <div className="pt-3 border-t">
                      <div className="text-sm text-gray-500 mb-2">발송 결과</div>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="bg-gray-50 rounded p-2">
                          <div className="text-lg font-bold">{selectedCampaign.sent_count?.toLocaleString()}</div>
                          <div className="text-xs text-gray-500">발송</div>
                        </div>
                        <div className="bg-green-50 rounded p-2">
                          <div className="text-lg font-bold text-green-600">{selectedCampaign.success_count?.toLocaleString()}</div>
                          <div className="text-xs text-gray-500">성공</div>
                        </div>
                        <div className="bg-red-50 rounded p-2">
                          <div className="text-lg font-bold text-red-600">{selectedCampaign.fail_count?.toLocaleString()}</div>
                          <div className="text-xs text-gray-500">실패</div>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="pt-4 space-y-2">
                    <button className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                      편집
                    </button>
                    <button className="w-full px-4 py-2 border rounded-lg hover:bg-gray-50 transition-colors">
                      복제
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center text-gray-500 py-12 p-4">
                <div className="text-4xl mb-4">📋</div>
                <p>캠페인을 선택하면<br />상세 정보가 표시됩니다</p>
              </div>
            )}
          </div>
        </div>

        {/* 로딩 표시 */}
        {loading && (
          <div className="fixed inset-0 bg-black bg-opacity-20 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-4 shadow-lg">
              <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto"></div>
              <p className="mt-2 text-gray-600">로딩 중...</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
