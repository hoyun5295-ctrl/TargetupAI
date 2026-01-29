import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { customersApi, campaignsApi } from '../api/client';
import { useAuthStore } from '../stores/authStore';

interface Stats {
  total: string;
  sms_opt_in_count: string;
  male_count: string;
  female_count: string;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'target' | 'campaign' | 'send'>('target');
  
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
  
  // 캠페인 폼
  const [campaign, setCampaign] = useState({
    campaignName: '',
    messageType: 'SMS',
    messageContent: '',
    isAd: false,
  });

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
      
      const response = await customersApi.list({ ...params, limit: 100 });
      setTargetResult(response.data);
    } catch (error) {
      console.error('타겟 추출 실패:', error);
    }
  };

  const handleCreateCampaign = async () => {
    if (!campaign.campaignName || !campaign.messageContent) {
      alert('캠페인명과 메시지 내용을 입력하세요.');
      return;
    }
    
    try {
      const response = await campaignsApi.create({
        ...campaign,
        targetFilter: filter,
      });
      alert('캠페인이 생성되었습니다.');
      setActiveTab('send');
    } catch (error: any) {
      alert(error.response?.data?.error || '캠페인 생성 실패');
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
            <span className="text-sm text-gray-600">{user?.name}님</span>
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
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm text-gray-500">전체 고객</div>
            <div className="text-3xl font-bold text-gray-800">
              {parseInt(stats?.total || '0').toLocaleString()}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm text-gray-500">수신동의</div>
            <div className="text-3xl font-bold text-green-600">
              {parseInt(stats?.sms_opt_in_count || '0').toLocaleString()}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm text-gray-500">남성</div>
            <div className="text-3xl font-bold text-blue-600">
              {parseInt(stats?.male_count || '0').toLocaleString()}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm text-gray-500">여성</div>
            <div className="text-3xl font-bold text-pink-600">
              {parseInt(stats?.female_count || '0').toLocaleString()}
            </div>
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
                <h3 className="text-lg font-semibold mb-4">타겟 조건 설정</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      성별
                    </label>
                    <select
                      value={filter.gender}
                      onChange={(e) => setFilter({ ...filter, gender: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg"
                    >
                      <option value="">전체</option>
                      <option value="M">남성</option>
                      <option value="F">여성</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      최소 나이
                    </label>
                    <input
                      type="number"
                      value={filter.minAge}
                      onChange={(e) => setFilter({ ...filter, minAge: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg"
                      placeholder="예: 20"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      최대 나이
                    </label>
                    <input
                      type="number"
                      value={filter.maxAge}
                      onChange={(e) => setFilter({ ...filter, maxAge: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg"
                      placeholder="예: 40"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      등급
                    </label>
                    <input
                      type="text"
                      value={filter.grade}
                      onChange={(e) => setFilter({ ...filter, grade: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg"
                      placeholder="예: VIP"
                    />
                  </div>
                  <div className="flex items-end">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={filter.smsOptIn}
                        onChange={(e) => setFilter({ ...filter, smsOptIn: e.target.checked })}
                        className="rounded"
                      />
                      <span className="text-sm text-gray-700">수신동의만</span>
                    </label>
                  </div>
                </div>
                
                <button
                  onClick={handleExtractTarget}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium"
                >
                  타겟 추출
                </button>

                {targetResult && (
                  <div className="mt-6">
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                      <span className="text-blue-800 font-medium">
                        추출된 타겟: {targetResult.pagination.total.toLocaleString()}명
                      </span>
                    </div>
                    
                    <div className="border rounded-lg overflow-hidden">
                      <table className="w-full">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">이름</th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">전화번호</th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">성별</th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">등급</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {targetResult.customers.slice(0, 10).map((c: any) => (
                            <tr key={c.id}>
                              <td className="px-4 py-2 text-sm">{c.name || '-'}</td>
                              <td className="px-4 py-2 text-sm">{c.phone}</td>
                              <td className="px-4 py-2 text-sm">{c.gender === 'M' ? '남' : c.gender === 'F' ? '여' : '-'}</td>
                              <td className="px-4 py-2 text-sm">{c.grade || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    
                    <button
                      onClick={() => setActiveTab('campaign')}
                      className="mt-4 bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-lg font-medium"
                    >
                      다음: 캠페인 설정 →
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* 캠페인 설정 탭 */}
            {activeTab === 'campaign' && (
              <div>
                <h3 className="text-lg font-semibold mb-4">캠페인 설정</h3>
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
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      메시지 내용 *
                    </label>
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
                  캠페인 목록에서 발송할 캠페인을 선택하세요.
                </p>
                <button className="bg-green-600 hover:bg-green-700 text-white px-8 py-3 rounded-lg font-medium">
                  캠페인 목록 보기
                </button>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
