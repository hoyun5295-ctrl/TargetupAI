import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { customersApi, campaignsApi, aiApi } from '../api/client';
import { useAuthStore } from '../stores/authStore';

interface Stats {
  total: string;
  sms_opt_in_count: string;
  male_count: string;
  female_count: string;
}

// 캘린더 모달 컴포넌트
function CalendarModal({ onClose, token }: { onClose: () => void; token: string | null }) {
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedCampaign, setSelectedCampaign] = useState<any>(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  useEffect(() => {
    fetchCampaigns();
  }, [year, month]);

  const fetchCampaigns = async () => {
    try {
      const res = await fetch(`/api/campaigns?year=${year}&month=${month + 1}`, {
        headers: { Authorization: `Bearer ${token}` },
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
      const dateStr = c.scheduled_at || c.created_at;
      const date = new Date(dateStr);
      return date.getDate() === day && date.getMonth() === month && date.getFullYear() === year;
    });
  };

  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const blanks = Array.from({ length: firstDay }, (_, i) => i);

  const statusColors: Record<string, string> = {
    draft: 'bg-gray-200', scheduled: 'bg-blue-200', sending: 'bg-yellow-200',
    completed: 'bg-green-200', failed: 'bg-red-200',
  };
  const statusLabels: Record<string, string> = {
    draft: '준비', scheduled: '예약', sending: '진행', completed: '완료', failed: '실패',
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-[800px] max-h-[600px] overflow-hidden">
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
            <div className="grid grid-cols-7 gap-1 mb-2">
              {['일','월','화','수','목','금','토'].map(d => (
                <div key={d} className="text-center text-xs font-medium text-gray-500">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {blanks.map(i => <div key={`b-${i}`} className="h-16 bg-gray-50 rounded" />)}
              {days.map(day => {
                const dayCampaigns = getCampaignsForDay(day);
                const isToday = day === new Date().getDate() && month === new Date().getMonth() && year === new Date().getFullYear();
                return (
                  <div key={day} className={`h-16 border rounded p-1 text-xs ${isToday ? 'border-blue-500 border-2' : 'border-gray-200'}`}>
                    <div className={`font-medium ${isToday ? 'text-blue-600' : ''}`}>{day}</div>
                    {dayCampaigns.slice(0, 2).map(c => (
                      <div key={c.id} onClick={() => setSelectedCampaign(c)} className={`truncate cursor-pointer px-1 rounded ${statusColors[c.status] || 'bg-gray-100'}`}>
                        {c.campaign_name}
                      </div>
                    ))}
                    {dayCampaigns.length > 2 && <div className="text-gray-400">+{dayCampaigns.length - 2}</div>}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 상세 패널 */}
          <div className="w-56 border-l p-4 bg-gray-50">
            {selectedCampaign ? (
              <div>
                <div className="flex justify-between items-start mb-3">
                  <h3 className="font-bold text-sm">{selectedCampaign.campaign_name}</h3>
                  <button onClick={() => setSelectedCampaign(null)} className="text-gray-400 text-xs">✕</button>
                </div>
                <div className="space-y-2 text-xs">
                  <div><span className="text-gray-500">상태:</span> <span className={`px-2 py-0.5 rounded ${statusColors[selectedCampaign.status]}`}>{statusLabels[selectedCampaign.status]}</span></div>
                  <div><span className="text-gray-500">채널:</span> {selectedCampaign.message_type}</div>
                  <div><span className="text-gray-500">대상:</span> {selectedCampaign.target_count?.toLocaleString()}명</div>
                  {selectedCampaign.status === 'completed' && (
                    <div className="pt-2 border-t">
                      <div className="text-gray-500 mb-1">발송결과</div>
                      <div>성공: {selectedCampaign.success_count?.toLocaleString()}</div>
                      <div>실패: {selectedCampaign.fail_count?.toLocaleString()}</div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-center text-gray-400 text-sm py-8">캠페인 선택</div>
            )}
          </div>
        </div>
      </div>
          </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();

  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [activeTab, setActiveTab] = useState<'target' | 'campaign' | 'send'>('target');
  const [showCalendar, setShowCalendar] = useState(false);
  const [aiCampaignPrompt, setAiCampaignPrompt] = useState('');
  const [showAiResult, setShowAiResult] = useState(false);
  const [aiResult, setAiResult] = useState<any>(null);
  const [aiStep, setAiStep] = useState(1);
  const [selectedChannel, setSelectedChannel] = useState('SMS');
  const [isAd, setIsAd] = useState(true);
  const [showPreview, setShowPreview] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
const [successCampaignId, setSuccessCampaignId] = useState('');
  const [selectedMessage, setSelectedMessage] = useState<any>(null);

  // 타겟 필터
  const [filter, setFilter] = useState({
    gender: '',
    minAge: '',
    maxAge: '',
    grade: '',
    smsOptIn: true,
  });

  // 타겟 결과
  const [targetResult, setTargetResult] = useState<any>(null);

  // 캠페인 설정
  const [campaign, setCampaign] = useState({
    campaignName: '',
    messageType: 'SMS',
    messageContent: '',
    isAd: false,
  });

  // AI 관련 상태
  const [aiLoading, setAiLoading] = useState(false);
  const [aiObjective, setAiObjective] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiMessages, setAiMessages] = useState<any[]>([]);
  const [showAiTarget, setShowAiTarget] = useState(false);
  const [showAiMessage, setShowAiMessage] = useState(false);
  const [campaignContext, setCampaignContext] = useState(''); // 타겟→메시지 연결용

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const response = await customersApi.stats();
      setStats(response.data.stats);
    } catch (error) {
      console.error('통계 로드 실패:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleExtractTarget = async () => {
    try {
      const params: any = {};
      if (filter.gender) params.gender = filter.gender;
      if (filter.minAge) params.minAge = filter.minAge;
      if (filter.maxAge) params.maxAge = filter.maxAge;
      if (filter.grade) params.grade = filter.grade;
      if (filter.smsOptIn) params.smsOptIn = 'true';

      console.log('API 호출 params:', params);
      const response = await customersApi.list({ ...params, limit: 100 });
      setTargetResult(response.data);
    } catch (error) {
      console.error('타겟 추출 실패:', error);
    }
  };

  // AI 타겟 추천
  const handleAiRecommendTarget = async () => {
    if (!aiObjective.trim()) {
      alert('마케팅 목표를 입력해주세요');
      return;
    }
    setAiLoading(true);
    try {
      const response = await aiApi.recommendTarget({ objective: aiObjective });
      const result = response.data;
      console.log('AI 응답:', result);
      console.log('적용할 gender:', result.filters?.gender?.value);

      // 추천된 필터 적용
      if (result.filters) {
        const newFilter = { ...filter };
        if (result.filters.gender?.value) newFilter.gender = result.filters.gender.value;
        if (result.filters.age?.value) {
          newFilter.minAge = result.filters.age.value[0]?.toString() || '';
          newFilter.maxAge = result.filters.age.value[1]?.toString() || '';
        }
        if (result.filters.grade?.value) newFilter.grade = result.filters.grade.value;
        setFilter(newFilter);
        console.log('설정된 필터:', newFilter);
      }
      
      // 캠페인 컨텍스트 저장 (메시지 생성에 사용)
      setCampaignContext(aiObjective);
      
      alert(`AI 추천 완료!\n\n${result.reasoning}\n\n예상 타겟: ${result.estimated_count.toLocaleString()}명`);
      setShowAiTarget(false);
      setAiObjective('');
    } catch (error) {
      console.error('AI 타겟 추천 실패:', error);
      alert('AI 추천 중 오류가 발생했습니다.');
    } finally {
      setAiLoading(false);
    }
  };
// AI 캠페인 생성 (프롬프트 한 방)
const handleAiCampaignGenerate = async () => {
  if (!aiCampaignPrompt.trim()) {
    alert('캠페인 내용을 입력해주세요');
    return;
  }
  setAiLoading(true);
  try {
    // 1. 타겟 + 채널 추천 받기
    const response = await aiApi.recommendTarget({ objective: aiCampaignPrompt });
    const result = response.data;
    
    // AI 결과 저장
    setAiResult({
      target: {
        description: result.reasoning || '추천 타겟',
        count: result.estimated_count || 0,
        filters: result.filters || {},
      },
      recommendedChannel: result.recommended_channel || 'SMS',
      channelReason: result.channel_reason || '간단한 안내 메시지에 적합합니다.',
      recommendedTime: result.recommended_time || '',
    });
    
    // 추천 채널로 기본 설정
    setSelectedChannel(result.recommended_channel || 'SMS');
    setIsAd(result.is_ad !== false);
  
    // 팝업 열기
    setShowAiResult(true);
    setAiStep(1);
  } catch (error) {
    console.error('AI 캠페인 생성 실패:', error);
    alert('AI 추천 중 오류가 발생했습니다.');
  } finally {
    setAiLoading(false);
  }
};

// AI 메시지 생성 (채널 선택 후)
const handleAiGenerateChannelMessage = async () => {
  setAiLoading(true);
  try {
    const response = await aiApi.generateMessage({
      prompt: aiCampaignPrompt,
      brandName: user?.company?.name || '브랜드',
      channel: selectedChannel,
    });
    
    // 메시지 결과 저장
    setAiResult((prev: any) => ({
      ...prev,
      messages: response.data.variants || [],
    }));
    
    // 2단계로 이동
    setAiStep(2);
  } catch (error) {
    console.error('AI 메시지 생성 실패:', error);
    alert('메시지 생성 중 오류가 발생했습니다.');
  } finally {
    setAiLoading(false);
  }
};

  // AI 메시지 생성
  const handleAiGenerateMessage = async () => {
    const prompt = aiPrompt.trim() || campaignContext;
    if (!prompt) {
      alert('메시지 요청 내용을 입력해주세요');
      return;
    }
    setAiLoading(true);
    try {
      const response = await aiApi.generateMessage({
        prompt: prompt,
        brandName: user?.company?.name || '브랜드',
      });
      setAiMessages(response.data.variants || []);
    } catch (error) {
      console.error('AI 메시지 생성 실패:', error);
      alert('AI 메시지 생성 중 오류가 발생했습니다.');
    } finally {
      setAiLoading(false);
    }
  };

  // AI 메시지 선택
  const handleSelectAiMessage = (message: any) => {
    const text = campaign.messageType === 'SMS' ? message.sms_text : message.lms_text;
    setCampaign({ ...campaign, messageContent: text });
    setShowAiMessage(false);
    setAiMessages([]);
    setAiPrompt('');
  };

  const handleCreateCampaign = async () => {
    if (!campaign.campaignName || !campaign.messageContent) {
      alert('캠페인명과 메시지 내용을 입력하세요');
      return;
    }

    try {
      await campaignsApi.create({
        ...campaign,
        targetFilter: filter,
      });
      alert('캠페인이 생성되었습니다');
      setActiveTab('send');
    } catch (error: any) {
      alert(error.response?.data?.error || '캠페인 생성 실패');
    } finally {
      setIsSending(false);
    }
  };
// AI 캠페인 발송 확정
const handleAiCampaignSend = async () => {
  setIsSending(true);  // 이 줄 추가
  try {
    // 선택된 메시지 가져오기 (첫번째 메시지 사용, 나중에 라디오 선택값으로 변경 가능)
    const selectedMsg = aiResult?.messages?.[0];
    if (!selectedMsg) {
      alert('메시지를 선택해주세요');
      return;
    }

    const campaignData = {
      campaignName: `AI캠페인_${new Date().toLocaleDateString('ko-KR')}`,
      messageType: selectedChannel,
      messageContent: selectedMsg.message_text,
      targetFilter: aiResult?.target?.filters || {},
      isAd: true,
      scheduledAt: null, // 즉시 발송 또는 예약시간
    };

    const response = await campaignsApi.create(campaignData);

// 캠페인 발송 API 호출
const campaignId = response.data.campaign?.id;
if (campaignId) {
  await campaignsApi.send(campaignId);
}
    
    // 모달 닫기
    setShowPreview(false);
    setShowAiResult(false);
    setAiStep(1);
    setAiCampaignPrompt('');
    
    setSuccessCampaignId(response.data.campaign?.id || '');
setShowSuccess(true);
    
    // 캘린더 열어서 확인
  } catch (error: any) {
    console.error('캠페인 생성 실패:', error);
    alert(error.response?.data?.error || '캠페인 생성에 실패했습니다.');
  } finally {
    setIsSending(false);
  }
};

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-gray-500">로딩 중...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* 헤더 */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-xl font-bold text-gray-800">Target-UP</h1>
            <p className="text-sm text-gray-500">{user?.company?.name}</p>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/settings')}
              className="flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
            >
              <span className="text-2xl">⚙️</span>
              <span className="text-sm font-medium text-gray-700">설정</span>
            </button>
            <button
              onClick={() => setShowCalendar(true)}
              className="flex items-center gap-2 px-3 py-2 bg-blue-100 hover:bg-blue-200 rounded-lg transition-colors"
            >
              <span className="text-2xl">📅</span>
              <span className="text-sm font-medium text-blue-700">캘린더</span>
            </button>
            <button
              onClick={handleLogout}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              로그아웃
            </button>
          </div>
        </div>
      </header>

      {/* 메인 */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* 통계 카드 */}
        {/* 통계 + AI 프롬프트 영역 */}
        <div className="flex gap-6 mb-8">
          {/* 좌측: 통계 카드 */}
          <div className="w-80 bg-white rounded-xl shadow p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xl">👥</span>
                <span className="text-sm text-gray-500">전체 고객</span>
              </div>
              <span className="text-2xl font-bold text-gray-800">
                {parseInt(stats?.total || '0').toLocaleString()}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xl">✅</span>
                <span className="text-sm text-gray-500">수신동의</span>
              </div>
              <span className="text-2xl font-bold text-green-600">
                {parseInt(stats?.sms_opt_in_count || '0').toLocaleString()}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xl">👨</span>
                <span className="text-sm text-gray-500">남성</span>
              </div>
              <span className="text-2xl font-bold text-blue-600">
                {parseInt(stats?.male_count || '0').toLocaleString()}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xl">👩</span>
                <span className="text-sm text-gray-500">여성</span>
              </div>
              <span className="text-2xl font-bold text-pink-600">
                {parseInt(stats?.female_count || '0').toLocaleString()}
              </span>
            </div>
          </div>

          {/* 우측: AI 프롬프트 입력 */}
          <div className="flex-1 bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl p-6 border border-blue-200">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-2xl">✨</span>
              <h3 className="text-lg font-bold text-gray-800">AI에게 캠페인 요청하기</h3>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              원하는 캠페인을 자유롭게 설명해주세요. AI가 타겟, 메시지, 발송시간을 추천해드립니다.
            </p>
            <textarea
              value={aiCampaignPrompt}
              onChange={(e) => setAiCampaignPrompt(e.target.value)}
              className="w-full p-4 border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              rows={3}
              placeholder="예: 30대 여성 VIP 고객에게 봄 신상품 할인 이벤트 문자 보내줘"
            />
            <button 
              onClick={handleAiCampaignGenerate}
              disabled={aiLoading}
              className="w-full mt-4 px-6 py-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg font-medium hover:from-blue-700 hover:to-purple-700 flex items-center justify-center gap-2 text-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {aiLoading ? (
                <>
                  <span className="animate-spin">⏳</span>
                  AI가 분석 중...
                </>
              ) : (
                <>
                  <span>🚀</span>
                  AI 캠페인 생성
                </>
              )}
            </button>
          </div>
        </div>

        {/* 탭 */}
        <div className="bg-white rounded-lg shadow mb-6">
          <div className="flex border-b">
            <button
              onClick={() => setActiveTab('target')}
              className={`px-6 py-4 text-sm font-medium ${
                activeTab === 'target'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              1. 타겟 추출
            </button>
            <button
              onClick={() => setActiveTab('campaign')}
              className={`px-6 py-4 text-sm font-medium ${
                activeTab === 'campaign'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              2. 캠페인 설정
            </button>
            <button
              onClick={() => setActiveTab('send')}
              className={`px-6 py-4 text-sm font-medium ${
                activeTab === 'send'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              3. 발송
            </button>
          </div>

          <div className="p-6">
            {/* 타겟 추출 탭 */}
            {activeTab === 'target' && (
              <div>
<div className="text-center py-12 text-gray-500">
                <div className="text-6xl mb-4">👆</div>
                <p className="text-lg mb-2">위에서 AI 캠페인을 생성해주세요</p>
                <p className="text-sm">프롬프트를 입력하면 AI가 타겟, 메시지, 발송시간을 추천해드립니다.</p>
              </div>
              </div>
            )}

            {/* 캠페인 설정 탭 */}
            {activeTab === 'campaign' && (
              <div>
                <h3 className="text-lg font-semibold mb-4">캠페인 설정</h3>
                
                {/* 캠페인 컨텍스트 표시 */}
                {campaignContext && (
                  <div className="mb-4 p-3 bg-purple-50 border border-purple-200 rounded-lg">
                    <span className="text-sm text-purple-700">
                      📌 마케팅 목표: {campaignContext}
                    </span>
                  </div>
                )}

                <div className="space-y-4 max-w-2xl">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      캠페인명 *
                    </label>
                    <input
                      type="text"
                      value={campaign.campaignName}
                      onChange={(e) => setCampaign({ ...campaign, campaignName: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg"
                      placeholder="예: 1월 VIP 프로모션"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      메시지 유형
                    </label>
                    <select
                      value={campaign.messageType}
                      onChange={(e) => setCampaign({ ...campaign, messageType: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg"
                    >
                      <option value="SMS">SMS (단문)</option>
                      <option value="LMS">LMS (장문)</option>
                      <option value="MMS">MMS (사진)</option>
                      <option value="KAKAO">카카오 알림톡</option>
                    </select>
                  </div>
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="block text-sm font-medium text-gray-700">
                        메시지 내용 *
                      </label>
                      <button
                        onClick={() => setShowAiMessage(true)}
                        className="bg-purple-600 hover:bg-purple-700 text-white px-3 py-1 rounded text-sm font-medium flex items-center gap-1"
                      >
                        ✨ AI 문구 생성
                      </button>
                    </div>
                    <textarea
                      value={campaign.messageContent}
                      onChange={(e) => setCampaign({ ...campaign, messageContent: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg h-32"
                      placeholder="메시지 내용을 입력하세요..."
                    />
                    <div className="text-right text-sm text-gray-500 mt-1">
                      {campaign.messageContent.length}/90자 (SMS 기준)
                    </div>
                  </div>

                  {/* AI 메시지 생성 모달 */}
                  {showAiMessage && (
                    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                      <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto">
                        <h4 className="text-lg font-semibold mb-4">✨ AI 문구 생성</h4>
                        
                        {aiMessages.length === 0 ? (
                          <>
                            <p className="text-sm text-gray-600 mb-4">
                              어떤 메시지를 보내고 싶은지 설명해주세요.
                            </p>
                            <textarea
                              value={aiPrompt || campaignContext}
                              onChange={(e) => setAiPrompt(e.target.value)}
                              className="w-full px-3 py-2 border rounded-lg h-24 mb-4"
                              placeholder="예: 신규 고객 대상 20% 할인 쿠폰 안내"
                            />
                            <div className="flex gap-2">
                              <button
                                onClick={() => {
                                  setShowAiMessage(false);
                                  setAiPrompt('');
                                }}
                                className="flex-1 px-4 py-2 border rounded-lg text-gray-600"
                              >
                                취소
                              </button>
                              <button
                                onClick={handleAiGenerateMessage}
                                disabled={aiLoading}
                                className="flex-1 bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg disabled:opacity-50"
                              >
                                {aiLoading ? '생성 중...' : 'AI 문구 생성'}
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <p className="text-sm text-gray-600 mb-4">
                              AI가 생성한 문구 중 하나를 선택하세요.
                            </p>
                            <div className="space-y-4 mb-4">
                              {aiMessages.map((msg, idx) => (
                                <div
                                  key={idx}
                                  className="border rounded-lg p-4 hover:border-purple-500 cursor-pointer"
                                  onClick={() => handleSelectAiMessage(msg)}
                                >
                                  <div className="flex justify-between items-start mb-2">
                                    <span className="font-medium text-purple-600">
                                      {msg.variant_id}. {msg.variant_name}
                                    </span>
                                    <span className="text-sm text-gray-500">
                                      점수: {msg.score}
                                    </span>
                                  </div>
                                  <p className="text-sm text-gray-600 mb-2">{msg.concept}</p>
                                  <div className="bg-gray-50 p-2 rounded text-sm">
                                    {campaign.messageType === 'SMS' ? msg.sms_text : msg.lms_text}
                                  </div>
                                </div>
                              ))}
                            </div>
                            <button
                              onClick={() => {
                                setAiMessages([]);
                                setAiPrompt('');
                              }}
                              className="w-full px-4 py-2 border rounded-lg text-gray-600"
                            >
                              다시 생성하기
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={campaign.isAd}
                        onChange={(e) => setCampaign({ ...campaign, isAd: e.target.checked })}
                        className="rounded"
                      />
                      <span className="text-sm text-gray-700">광고성 메시지 (앞에 [광고] 자동 추가)</span>
                    </label>
                  </div>

                  <button
                    onClick={handleCreateCampaign}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium"
                  >
                    캠페인 생성
                  </button>
                </div>
              </div>
            )}

            {/* 발송 탭 */}
            {activeTab === 'send' && (
              <div className="text-center py-12">
                <div className="text-6xl mb-4">📤</div>
                <h3 className="text-lg font-semibold mb-2">발송 준비 완료</h3>
                <p className="text-gray-500 mb-6">
                  캠페인 목록에서 발송할 캠페인을 선택하세요
                </p>
                <button
                  onClick={() => alert('캠페인 목록 페이지로 이동 (개발 예정)')}
                  className="bg-green-600 hover:bg-green-700 text-white px-8 py-3 rounded-lg font-medium"
                >
                  캠페인 발송하기
                </button>
              </div>
            )}
          </div>
        </div>
{/* AI 캠페인 결과 팝업 */}
{showAiResult && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-2xl w-[600px] max-h-[80vh] overflow-y-auto">
              
              {/* 헤더 */}
              <div className="p-6 border-b bg-gradient-to-r from-blue-50 to-purple-50">
                <div className="flex justify-between items-center">
                  <h3 className="text-lg font-bold flex items-center gap-2">
                    <span>✨</span> AI 추천 결과 {aiStep === 1 ? '- 타겟 & 채널' : '- 메시지 & 발송'}
                  </h3>
                  <button onClick={() => { setShowAiResult(false); setAiStep(1); }} className="text-gray-500 hover:text-gray-700 text-xl">✕</button>
                </div>
              </div>

              {/* Step 1: 타겟 + 채널 선택 */}
              {aiStep === 1 && (
                <div className="p-6 space-y-6">
                  {/* 타겟 요약 */}
                  <div className="bg-blue-50 rounded-lg p-4">
                    <div className="text-sm text-gray-600 mb-1">📌 추출된 타겟</div>
                    <div className="font-semibold text-gray-800">{aiResult?.target?.description || '추천 타겟'}</div>
<div className="text-blue-600 font-bold text-lg mt-1">{aiResult?.target?.count?.toLocaleString() || 0}명</div>
                  </div>

                  {/* 채널 추천 */}
                  <div>
                    <div className="text-sm text-gray-600 mb-2">📱 AI 추천 채널</div>
                    <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-4">
                    <div className="font-semibold text-purple-800">{aiResult?.recommendedChannel || 'SMS'} 추천</div>
                    <div className="text-sm text-purple-600 mt-1">"{aiResult?.channelReason || '추천 채널입니다'}"</div>
                    </div>
{/* 광고성 여부 */}
<div className="flex items-center justify-between bg-yellow-50 rounded-lg p-4 mb-4">
                    <div>
                      <div className="font-semibold text-gray-800">📢 광고성 메시지</div>
                      <div className="text-sm text-gray-500">
                        {isAd ? '(광고) 표기 + 무료거부번호 필수 포함' : '알림성 메시지 (표기 불필요)'}
                      </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={isAd} 
                        onChange={(e) => setIsAd(e.target.checked)}
                        className="sr-only peer" 
                      />
                      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
                    </label>
                  </div>
                    <div className="text-sm text-gray-600 mb-2">채널 선택</div>
                    <div className="grid grid-cols-4 gap-2">
                      {['SMS', 'LMS', 'MMS', '카카오'].map((ch) => (
                        <button
                          key={ch}
                          onClick={() => setSelectedChannel(ch)}
                          className={`p-3 rounded-lg border-2 text-center font-medium transition-all ${
                            selectedChannel === ch
                              ? 'border-purple-500 bg-purple-50 text-purple-700'
                              : 'border-gray-200 hover:border-gray-300 text-gray-600'
                          }`}
                        >
                          {ch === 'SMS' && '📱 '}
                          {ch === 'LMS' && '📝 '}
                          {ch === 'MMS' && '🖼️ '}
                          {ch === '카카오' && '💬 '}
                          {ch}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 다음 버튼 */}
                  <button
                    onClick={handleAiGenerateChannelMessage}
                    disabled={aiLoading}
                    className="w-full py-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg font-medium hover:from-blue-700 hover:to-purple-700 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {aiLoading ? (
                      <>
                        <span className="animate-spin">⏳</span>
                        메시지 생성 중...
                      </>
                    ) : (
                      <>다음: 문구 생성 →</>
                    )}
                  </button>
                </div>
              )}

              {/* Step 2: 메시지 + 발송시간 */}
              {aiStep === 2 && (
                <div className="p-6 space-y-6">
                  {/* 선택된 채널 표시 */}
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <span>선택된 채널:</span>
                    <span className="px-2 py-1 bg-purple-100 text-purple-700 rounded font-medium">{selectedChannel}</span>
                  </div>

                  {/* 메시지 3안 */}
                  <div>
                    <div className="text-sm text-gray-600 mb-3">💬 {selectedChannel} 메시지 추천 (택1)</div>
                    <div className="space-y-3">
                      {aiResult?.messages?.length > 0 ? (
                        aiResult.messages.map((msg: any, idx: number) => (
                          <label key={msg.variant_id || idx} className="block border rounded-lg p-4 cursor-pointer hover:border-purple-500 has-[:checked]:border-purple-500 has-[:checked]:bg-purple-50">
                            <input type="radio" name="message" className="mr-2" defaultChecked={idx === 0} />
                            <span className="font-medium">{msg.variant_id}. {msg.variant_name}</span>
                            <p className="text-sm text-gray-600 mt-1 whitespace-pre-wrap">{msg.message_text}</p>
                            <p className="text-xs text-gray-400 mt-1">{msg.byte_count || '?'} / {selectedChannel === 'SMS' ? 90 : 2000} bytes</p>
                          </label>
                        ))
                      ) : (
                        <div className="text-center py-8 text-gray-400">
                          메시지를 불러오는 중...
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 발송시간 */}
                  <div>
                    <div className="text-sm text-gray-600 mb-3">⏰ 발송시간</div>
                    <div className="space-y-2">
                      <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:border-purple-500 has-[:checked]:border-purple-500 has-[:checked]:bg-purple-50">
                        <input type="radio" name="sendTime" defaultChecked />
                        <div>
                          <div className="font-medium">AI 추천시간</div>
                          <div className="text-sm text-gray-500">{aiResult?.recommendedTime || 'AI가 분석한 최적 시간'}</div>
                        </div>
                      </label>
                      <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:border-purple-500 has-[:checked]:border-purple-500 has-[:checked]:bg-purple-50">
                        <input type="radio" name="sendTime" />
                        <div className="font-medium">즉시 발송</div>
                      </label>
                      <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:border-purple-500 has-[:checked]:border-purple-500 has-[:checked]:bg-purple-50">
                        <input type="radio" name="sendTime" />
                        <div className="flex items-center gap-2">
                          <span className="font-medium">직접 선택:</span>
                          <input type="datetime-local" className="border rounded px-2 py-1 text-sm" />
                        </div>
                      </label>
                    </div>
                  </div>

                  {/* 하단 버튼 */}
                  <div className="flex gap-3 pt-4 border-t">
                    <button
                      onClick={() => setAiStep(1)}
                      className="flex-1 py-3 border rounded-lg text-gray-600 hover:bg-gray-100 flex items-center justify-center gap-2"
                    >
                      ← 채널변경
                    </button>
                    <button 
  onClick={() => setShowPreview(true)}
  className="flex-1 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center justify-center gap-2"
>
  👁️ 미리보기
</button>
<button 
  onClick={handleAiCampaignSend}
  disabled={isSending}
  className="flex-1 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 flex items-center justify-center gap-2"
>
{isSending ? '⏳ 발송 중...' : '🚀 발송하기'}
</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        {/* 미리보기 모달 */}
        {showPreview && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-2xl w-[500px] max-h-[80vh] overflow-y-auto">
              <div className="p-6 border-b bg-gradient-to-r from-blue-50 to-purple-50">
                <div className="flex justify-between items-center">
                  <h3 className="text-lg font-bold">📱 발송 미리보기</h3>
                  <button onClick={() => setShowPreview(false)} className="text-gray-500 hover:text-gray-700 text-xl">✕</button>
                </div>
              </div>
              
              <div className="p-6 space-y-4">
                {/* 타겟 정보 */}
                <div className="bg-blue-50 rounded-lg p-4">
                  <div className="text-sm text-gray-600 mb-1">📌 발송 대상</div>
                  <div className="font-semibold">{aiResult?.target?.description || '타겟 고객'}</div>
                  <div className="text-blue-600 font-bold">{aiResult?.target?.count?.toLocaleString() || 0}명</div>
                </div>

                {/* 채널 */}
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">채널:</span>
                  <span className="px-2 py-1 bg-purple-100 text-purple-700 rounded font-medium">{selectedChannel}</span>
                </div>

                {/* 메시지 미리보기 */}
                <div>
                  <div className="text-sm text-gray-600 mb-2">💬 메시지 내용</div>
                  <div className="bg-gray-100 rounded-lg p-4 whitespace-pre-wrap text-sm">
                    {aiResult?.messages?.[0]?.message_text || '메시지 없음'}
                  </div>
                </div>

                {/* 발송 시간 */}
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">⏰ 발송시간:</span>
                  <span className="font-medium">AI 추천시간</span>
                </div>
              </div>

              <div className="p-6 border-t flex gap-3">
                <button
                  onClick={() => setShowPreview(false)}
                  className="flex-1 py-3 border rounded-lg text-gray-600 hover:bg-gray-100"
                >
                  ← 돌아가기
                </button>
                <button
                  onClick={handleAiCampaignSend}
                  disabled={isSending}
                  className="flex-1 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg hover:from-blue-700 hover:to-purple-700"
                >
  {isSending ? '⏳ 발송 중...' : '🚀 발송 확정'}
                </button>
              </div>
            </div>
          </div>
        )}
        {/* 캠페인 확정 성공 모달 */}
        {showSuccess && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-2xl w-[400px] text-center p-8">
              <div className="text-6xl mb-4">🎉</div>
              <h3 className="text-xl font-bold text-gray-800 mb-2">캠페인이 확정되었습니다!</h3>
              <p className="text-gray-500 text-sm mb-4">
                캠페인 ID: {successCampaignId}
              </p>
              <div className="bg-green-50 rounded-lg p-4 mb-6 text-left">
                <div className="text-sm text-gray-600 space-y-1">
                  <div>📱 채널: <span className="font-medium">{selectedChannel}</span></div>
                  <div>👥 대상: <span className="font-medium">{aiResult?.target?.count?.toLocaleString() || 0}명</span></div>
                  <div>⏰ 발송: <span className="font-medium">예약 완료</span></div>
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowSuccess(false);
                    setShowCalendar(true);
                  }}
                  className="flex-1 py-3 border rounded-lg text-gray-600 hover:bg-gray-100"
                >
                  📅 캘린더 확인
                </button>
                <button
                  onClick={() => setShowSuccess(false)}
                  className="flex-1 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg hover:from-blue-700 hover:to-purple-700"
                >
                  확인
                </button>
              </div>
            </div>
          </div>
        )}
        {showCalendar && <CalendarModal onClose={() => setShowCalendar(false)} token={localStorage.getItem('token')} />}
      </main>
    </div>
  );
}