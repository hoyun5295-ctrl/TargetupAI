import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import UsersTab from '../components/manage/UsersTab';
import CallbacksTab from '../components/manage/CallbacksTab';
import ScheduledTab from '../components/manage/ScheduledTab';
import StatsTab from '../components/manage/StatsTab';
import ManageCustomersTab from '../components/manage/ManageCustomersTab';

type Tab = 'users' | 'callbacks' | 'scheduled' | 'stats' | 'customers';

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'users', label: '사용자', icon: '👤' },
  { key: 'callbacks', label: '발신번호', icon: '📞' },
  { key: 'scheduled', label: '예약캠페인', icon: '⏰' },
  { key: 'stats', label: '발송통계', icon: '📊' },
  { key: 'customers', label: '고객DB', icon: '👥' },
];

export default function ManagePage() {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const [activeTab, setActiveTab] = useState<Tab>('users');

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <header className="bg-white border-b shadow-sm sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-14">
            {/* 로고 + 돌아가기 */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => navigate('/dashboard')}
                className="flex items-center gap-2 text-gray-500 hover:text-gray-700 transition"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                <span className="text-sm font-medium">대시보드</span>
              </button>
              <div className="w-px h-6 bg-gray-200" />
              <img src="/logo.png" alt="한줄로" className="h-8" />
              <span className="hidden sm:inline px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">
                관리자
              </span>
            </div>

            {/* 사용자 정보 */}
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-600">
                <span className="font-medium">{user?.name || user?.loginId}</span>
                {user?.company?.name && (
                  <span className="text-gray-400 ml-1">({user.company.name})</span>
                )}
              </span>
              <button onClick={handleLogout}
                className="text-sm text-gray-500 hover:text-red-600 transition font-medium">
                로그아웃
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* 탭 네비게이션 */}
        <div className="flex gap-1 mb-6 bg-white rounded-xl shadow-sm p-1.5">
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition ${
                activeTab === tab.key
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* 탭 컨텐츠 */}
        {activeTab === 'users' && <UsersTab />}
        {activeTab === 'callbacks' && <CallbacksTab />}
        {activeTab === 'scheduled' && <ScheduledTab />}
        {activeTab === 'stats' && <StatsTab />}
        {activeTab === 'customers' && <ManageCustomersTab />}
      </div>
    </div>
  );
}
