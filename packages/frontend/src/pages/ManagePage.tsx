import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import UsersTab from '../components/manage/UsersTab';
import CallbacksTab from '../components/manage/CallbacksTab';
import ScheduledTab from '../components/manage/ScheduledTab';
import StatsTab from '../components/manage/StatsTab';
import ManageCustomersTab from '../components/manage/ManageCustomersTab';

type Tab = 'users' | 'callbacks' | 'scheduled' | 'stats' | 'customers';

const TABS: { key: Tab; label: string }[] = [
  { key: 'users', label: '사용자' },
  { key: 'callbacks', label: '발신번호' },
  { key: 'scheduled', label: '예약캠페인' },
  { key: 'stats', label: '발송통계' },
  { key: 'customers', label: '고객DB' },
];

function TabIcon({ k }: { k: Tab }) {
  const p = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, className: 'w-4 h-4' };
  switch (k) {
    case 'users': return <svg {...p}><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>;
    case 'callbacks': return <svg {...p}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" /></svg>;
    case 'scheduled': return <svg {...p}><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>;
    case 'stats': return <svg {...p}><path d="M3 3v18h18" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" /></svg>;
    case 'customers': return <svg {...p}><path d="M17 21v-2a4 4 0 0 0-3-3.87" /><path d="M9 21v-2a4 4 0 0 0-4-4H4" /><circle cx="9" cy="7" r="4" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>;
  }
}

export default function ManagePage() {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const [activeTab, setActiveTab] = useState<Tab>('users');

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* 헤더 */}
      <header className="bg-white/90 backdrop-blur border-b border-slate-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-16">
            {/* 로고 + 돌아가기 */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => navigate('/dashboard')}
                className="flex items-center gap-1.5 text-slate-400 hover:text-slate-700 transition"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                <span className="text-sm font-medium">대시보드</span>
              </button>
              <div className="w-px h-5 bg-slate-200" />
              <img src="/logo.png" alt="한줄로" className="h-7" />
              <span className="hidden sm:inline px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded-md text-xs font-semibold ring-1 ring-indigo-100">
                관리자
              </span>
            </div>

            {/* 사용자 정보 */}
            <div className="flex items-center gap-4">
              <span className="text-sm text-slate-500">
                <span className="font-semibold text-slate-800">{user?.name || user?.loginId}</span>
                {user?.company?.name && (
                  <span className="text-slate-400 ml-1">({user.company.name})</span>
                )}
              </span>
              <button onClick={handleLogout}
                className="text-sm text-slate-400 hover:text-rose-600 transition font-medium">
                로그아웃
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* 탭 네비게이션 */}
        <div className="flex gap-1 mb-6 bg-white rounded-2xl border border-slate-200 shadow-sm p-1.5 overflow-x-auto">
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition whitespace-nowrap ${
                activeTab === tab.key
                  ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/20'
                  : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
              }`}
            >
              <TabIcon k={tab.key} />
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
