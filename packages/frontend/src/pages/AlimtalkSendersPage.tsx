/**
 * 알림톡/브랜드메시지 발신프로필 관리 (슈퍼관리자 전용, 독립 페이지)
 *
 * 실제 UI는 AlimtalkSendersSection에 있음. 본 페이지는 독립 URL로 직접 접근 시
 * 헤더(관리자 홈 버튼 + 타이틀)만 제공하는 얇은 wrapper.
 *
 * 주 사용 경로: AdminDashboard > 발송 관리 탭 > AlimtalkSendersSection 임베드
 */

import { useNavigate } from 'react-router-dom';
import AlimtalkSendersSection from '../components/alimtalk/AlimtalkSendersSection';

export default function AlimtalkSendersPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">
            알림톡/브랜드메시지 발신프로필
          </h1>
          <p className="text-xs text-gray-500">슈퍼관리자 · 휴머스온 IMC 연동</p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/admin')}
          className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg"
        >
          관리자 홈
        </button>
      </header>
      <main className="max-w-7xl mx-auto px-6 py-6">
        <AlimtalkSendersSection />
      </main>
    </div>
  );
}
