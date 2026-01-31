import { useState, useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';

interface Campaign {
  id: string;
  campaign_name: string;
  status: string;
  message_type: string;
  target_count: number;
  sent_count: number;
  success_count: number;
  fail_count: number;
  scheduled_at: string | null;
  sent_at: string | null;
  created_at: string;
}

const statusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-800',
  scheduled: 'bg-blue-100 text-blue-800',
  sending: 'bg-yellow-100 text-yellow-800',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
};

const statusLabels: Record<string, string> = {
  draft: '준비',
  scheduled: '예약',
  sending: '진행',
  completed: '완료',
  failed: '실패',
};

export default function CalendarPage() {
  const { token } = useAuthStore();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  useEffect(() => {
    fetchCampaigns();
  }, [year, month]);

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
            {/* 요일 헤더 */}
            <div className="grid grid-cols-7 gap-1 mb-2">
              {['일', '월', '화', '수', '목', '금', '토'].map((day) => (
                <div key={day} className="text-center text-sm font-medium text-gray-500 py-2">
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

                return (
                  <div
                    key={day}
                    className={`h-24 border rounded p-1 overflow-hidden ${
                      isToday ? 'border-blue-500 border-2' : 'border-gray-200'
                    }`}
                  >
                    <div className={`text-sm font-medium mb-1 ${isToday ? 'text-blue-600' : 'text-gray-700'}`}>
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

          {/* 우측 상세 드로어 */}
          <div className="w-80 bg-white rounded-lg shadow p-4">
            {selectedCampaign ? (
              <>
                <div className="flex justify-between items-start mb-4">
                  <h3 className="text-lg font-semibold">{selectedCampaign.campaign_name}</h3>
                  <button
                    onClick={() => setSelectedCampaign(null)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    ✕
                  </button>
                </div>

                <div className="space-y-3">
                  <div>
                    <span className="text-sm text-gray-500">상태</span>
                    <div className={`inline-block ml-2 px-2 py-1 rounded text-sm ${statusColors[selectedCampaign.status]}`}>
                      {statusLabels[selectedCampaign.status] || selectedCampaign.status}
                    </div>
                  </div>

                  <div>
                    <span className="text-sm text-gray-500">채널</span>
                    <span className="ml-2 font-medium">{selectedCampaign.message_type}</span>
                  </div>

                  <div>
                    <span className="text-sm text-gray-500">대상</span>
                    <span className="ml-2 font-medium">{selectedCampaign.target_count?.toLocaleString()}명</span>
                  </div>

                  {selectedCampaign.scheduled_at && (
                    <div>
                      <span className="text-sm text-gray-500">예약시간</span>
                      <span className="ml-2 font-medium">
                        {new Date(selectedCampaign.scheduled_at).toLocaleString('ko-KR')}
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
                    <button className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                      편집
                    </button>
                    <button className="w-full px-4 py-2 border rounded-lg hover:bg-gray-50">
                      복제
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="text-center text-gray-500 py-12">
                <div className="text-4xl mb-4">📋</div>
                <p>캠페인을 선택하면<br />상세 정보가 표시됩니다</p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}