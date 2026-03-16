/**
 * ★ D69: 자동발송 페이지
 *
 * - 프로 미만: 블러 프리뷰 + CTA (AnalysisModal 패턴)
 * - 프로 이상: 실제 기능 (목록 + 생성/수정/삭제)
 * - company_admin + company_user 모두 접근 가능
 */

import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import AutoSendFormModal from '../components/AutoSendFormModal';

// ============================================================
// 타입
// ============================================================

interface AutoCampaign {
  id: string;
  campaign_name: string;
  description: string | null;
  schedule_type: string;
  schedule_day: number | null;
  schedule_time: string;
  target_filter: any;
  store_code: string | null;
  message_type: string;
  message_content: string;
  callback_number: string;
  is_ad: boolean;
  status: string;
  last_run_at: string | null;
  next_run_at: string | null;
  total_runs: number;
  total_sent: number;
  created_at: string;
  creator_login_id: string;
  run_count: number;
}

interface PlanInfo {
  auto_campaign_enabled: boolean;
  max_auto_campaigns: number | null;
  ai_premium_enabled: boolean;
}

// ============================================================
// 헬퍼
// ============================================================

const SCHEDULE_LABEL: Record<string, string> = {
  monthly: '매월',
  weekly: '매주',
  daily: '매일',
};

const DAY_LABEL = ['일', '월', '화', '수', '목', '금', '토'];

function getScheduleText(ac: AutoCampaign): string {
  const time = typeof ac.schedule_time === 'string'
    ? ac.schedule_time.slice(0, 5)
    : ac.schedule_time;

  if (ac.schedule_type === 'daily') {
    return `매일 ${time}`;
  }
  if (ac.schedule_type === 'weekly') {
    return `매주 ${DAY_LABEL[ac.schedule_day ?? 0]}요일 ${time}`;
  }
  if (ac.schedule_type === 'monthly') {
    return `매월 ${ac.schedule_day}일 ${time}`;
  }
  return '';
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function getToken(): string {
  return localStorage.getItem('token') || '';
}

// ============================================================
// 컴포넌트
// ============================================================

export default function AutoSendPage() {
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState<AutoCampaign[]>([]);
  const [plan, setPlan] = useState<PlanInfo>({ auto_campaign_enabled: false, max_auto_campaigns: null, ai_premium_enabled: false });
  const [activeCount, setActiveCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // 모달
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<AutoCampaign | null>(null);

  // 확인 모달
  const [confirmModal, setConfirmModal] = useState<{
    show: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({ show: false, title: '', message: '', onConfirm: () => {} });

  // ============================================================
  // 데이터 로드
  // ============================================================

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/auto-campaigns', {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error('조회 실패');
      const data = await res.json();
      setCampaigns(data.autoCampaigns || []);
      setPlan(data.plan || { auto_campaign_enabled: false, max_auto_campaigns: null, ai_premium_enabled: false });
      setActiveCount(data.activeCount || 0);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ============================================================
  // 액션 핸들러
  // ============================================================

  const handlePause = async (id: string) => {
    try {
      const res = await fetch(`/api/auto-campaigns/${id}/pause`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || '일시정지 실패');
        return;
      }
      fetchData();
    } catch { alert('일시정지에 실패했습니다.'); }
  };

  const handleResume = async (id: string) => {
    try {
      const res = await fetch(`/api/auto-campaigns/${id}/resume`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || '재개 실패');
        return;
      }
      fetchData();
    } catch { alert('재개에 실패했습니다.'); }
  };

  const handleDelete = (ac: AutoCampaign) => {
    setConfirmModal({
      show: true,
      title: '자동발송 삭제',
      message: `"${ac.campaign_name}" 자동발송을 삭제하시겠습니까?\n삭제 후에는 복구할 수 없습니다.`,
      onConfirm: async () => {
        setConfirmModal(prev => ({ ...prev, show: false }));
        try {
          const res = await fetch(`/api/auto-campaigns/${ac.id}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${getToken()}` },
          });
          if (!res.ok) {
            const data = await res.json();
            alert(data.error || '삭제 실패');
            return;
          }
          fetchData();
        } catch { alert('삭제에 실패했습니다.'); }
      },
    });
  };

  const handleEdit = (ac: AutoCampaign) => {
    setEditingCampaign(ac);
    setShowFormModal(true);
  };

  const handleCreate = () => {
    setEditingCampaign(null);
    setShowFormModal(true);
  };

  const handleFormSuccess = () => {
    setShowFormModal(false);
    setEditingCampaign(null);
    fetchData();
  };

  // ============================================================
  // 프로 미만: 블러 프리뷰 + CTA
  // ============================================================

  if (!loading && !plan.auto_campaign_enabled) {
    return (
      <div className="min-h-screen bg-gray-50">
        {/* 헤더 */}
        <div className="bg-white border-b border-gray-200">
          <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-2xl">⏰</span>
                <h1 className="text-xl font-bold text-gray-800">자동발송</h1>
              </div>
              <p className="text-sm text-gray-500 mt-1">
                반복 발송 스케줄을 설정하면 자동으로 메시지가 발송됩니다
              </p>
            </div>
            <button
              onClick={() => navigate('/dashboard')}
              className="text-sm text-gray-400 hover:text-gray-600 transition"
            >
              ← 돌아가기
            </button>
          </div>
        </div>

        <div className="max-w-5xl mx-auto px-6 py-8">
          {/* 소개 */}
          <div className="mb-8" style={{ animation: 'fadeIn 0.4s ease-out' }}>
            <h3 className="text-sm font-semibold text-gray-600 mb-3">이런 자동발송을 설정할 수 있어요</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                { icon: '🎂', name: '생일 축하 발송', desc: '매월 1일 · SMS · 이번 달 생일 고객에게 자동 발송' },
                { icon: '📢', name: 'VIP 주간 프로모션', desc: '매주 월요일 · LMS · VIP 등급 고객 대상' },
                { icon: '🎁', name: '신규 고객 웰컴', desc: '매일 · SMS · 어제 등록 고객에게 환영 메시지' },
              ].map((item, idx) => (
                <div
                  key={idx}
                  className="bg-white rounded-xl border border-gray-200 p-4"
                  style={{ animation: `fadeIn ${0.3 + idx * 0.1}s ease-out` }}
                >
                  <div className="text-2xl mb-2">{item.icon}</div>
                  <div className="font-medium text-gray-800 text-sm">{item.name}</div>
                  <div className="text-xs text-gray-500 mt-1">{item.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* 블러 프리뷰 */}
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-gray-500 mb-3 flex items-center gap-2">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
              </svg>
              자동발송 관리 화면 미리보기
            </h3>
            <div className="relative rounded-xl border border-gray-200 bg-gray-50/50 p-5 overflow-hidden">
              {/* 블러 오버레이 */}
              <div className="absolute inset-0 bg-white/40 backdrop-blur-sm z-10 flex items-center justify-center">
                <div className="bg-white/90 rounded-xl px-5 py-3 shadow-lg flex items-center gap-2 border border-amber-200">
                  <svg className="w-3.5 h-3.5 text-amber-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                  </svg>
                  <span className="text-sm font-medium text-gray-700">프로 요금제 이상 사용 가능</span>
                </div>
              </div>
              <div className="space-y-3 select-none" style={{ filter: 'blur(6px)' }}>
                {[
                  { name: '생일 축하 발송', schedule: '매월 1일 10:00', type: 'SMS', count: '1,628' },
                  { name: 'VIP 프로모션', schedule: '매주 월요일 09:00', type: 'LMS', count: '342' },
                  { name: '휴면 고객 리마인드', schedule: '매월 15일 14:00', type: 'SMS', count: '891' },
                ].map((item, idx) => (
                  <div key={idx} className="bg-white rounded-lg border border-gray-200 p-4 flex items-center justify-between">
                    <div>
                      <div className="font-medium text-gray-800">{item.name}</div>
                      <div className="text-xs text-gray-500">{item.schedule} · {item.type} · {item.count}명</div>
                    </div>
                    <span className="text-xs text-green-600 font-medium">활성</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* CTA */}
          <div
            className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl border border-amber-200 p-6 text-center"
            style={{ animation: 'fadeIn 0.6s ease-out' }}
          >
            <div className="flex items-center justify-center gap-2 mb-2">
              <span className="text-xl">👑</span>
              <h3 className="text-lg font-bold text-gray-800">프로 요금제로 업그레이드</h3>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              월 100만원으로 자동발송, AI 분석까지 모두 사용하세요
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => navigate('/pricing')}
                className="bg-white border border-gray-300 text-gray-700 px-5 py-2 rounded-lg text-sm hover:bg-gray-50 transition"
              >
                요금제 안내 보기
              </button>
              <button
                onClick={() => navigate('/pricing')}
                className="bg-amber-500 hover:bg-amber-600 text-white px-5 py-2 rounded-lg text-sm font-medium transition"
              >
                업그레이드 신청
              </button>
            </div>
          </div>
        </div>

        <style>{`
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
          }
        `}</style>
      </div>
    );
  }

  // ============================================================
  // 프로 이상: 실제 기능
  // ============================================================

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-2xl">⏰</span>
              <h1 className="text-xl font-bold text-gray-800">자동발송</h1>
              {plan.max_auto_campaigns && (
                <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                  {activeCount}/{plan.max_auto_campaigns}
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500 mt-1">
              반복 발송 스케줄을 설정하면 자동으로 메시지가 발송됩니다
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleCreate}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-1.5"
            >
              <span className="text-lg leading-none">+</span> 새 자동발송
            </button>
            <button
              onClick={() => navigate('/dashboard')}
              className="text-sm text-gray-400 hover:text-gray-600 transition"
            >
              ← 돌아가기
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6">
        {loading ? (
          <div className="text-center py-20 text-gray-400">로딩 중...</div>
        ) : error ? (
          <div className="text-center py-20 text-red-400">{error}</div>
        ) : campaigns.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-4xl mb-4">⏰</div>
            <p className="text-gray-500 mb-2">아직 설정된 자동발송이 없습니다</p>
            <p className="text-sm text-gray-400 mb-6">생일 축하, VIP 프로모션 등 반복 발송을 자동화하세요</p>
            <button
              onClick={handleCreate}
              className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition"
            >
              + 첫 자동발송 만들기
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {campaigns.map((ac, idx) => (
              <div
                key={ac.id}
                className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow"
                style={{ animation: `fadeIn ${0.2 + idx * 0.05}s ease-out` }}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-gray-800">{ac.campaign_name}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        ac.status === 'active'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}>
                        {ac.status === 'active' ? '● 활성' : '○ 일시정지'}
                      </span>
                      <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">
                        {ac.message_type}
                      </span>
                    </div>
                    <div className="text-sm text-gray-500 space-y-0.5">
                      <div>{getScheduleText(ac)}</div>
                      {ac.description && (
                        <div className="text-xs text-gray-400">{ac.description}</div>
                      )}
                      <div className="flex items-center gap-4 text-xs text-gray-400 mt-1">
                        <span>누적 {ac.total_runs}회 실행</span>
                        <span>총 {ac.total_sent.toLocaleString()}건 발송</span>
                        {ac.last_run_at && <span>최근: {formatDate(ac.last_run_at)}</span>}
                        {ac.next_run_at && ac.status === 'active' && (
                          <span className="text-blue-500">다음: {formatDate(ac.next_run_at)}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 액션 버튼 */}
                  <div className="flex items-center gap-2 ml-4">
                    <button
                      onClick={() => handleEdit(ac)}
                      className="text-xs text-gray-500 hover:text-blue-600 px-3 py-1.5 rounded-lg hover:bg-blue-50 transition"
                    >
                      수정
                    </button>
                    {ac.status === 'active' ? (
                      <button
                        onClick={() => handlePause(ac.id)}
                        className="text-xs text-gray-500 hover:text-amber-600 px-3 py-1.5 rounded-lg hover:bg-amber-50 transition"
                      >
                        일시정지
                      </button>
                    ) : (
                      <button
                        onClick={() => handleResume(ac.id)}
                        className="text-xs text-gray-500 hover:text-green-600 px-3 py-1.5 rounded-lg hover:bg-green-50 transition"
                      >
                        재개
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(ac)}
                      className="text-xs text-gray-400 hover:text-red-600 px-3 py-1.5 rounded-lg hover:bg-red-50 transition"
                    >
                      삭제
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 생성/수정 모달 */}
      {showFormModal && (
        <AutoSendFormModal
          campaign={editingCampaign}
          aiPremiumEnabled={plan.ai_premium_enabled}
          onClose={() => { setShowFormModal(false); setEditingCampaign(null); }}
          onSuccess={handleFormSuccess}
        />
      )}

      {/* 확인 모달 */}
      {confirmModal.show && (
        <>
          <style>{`
            @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
            @keyframes zoomIn { from { opacity: 0; transform: scale(0.92); } to { opacity: 1; transform: scale(1); } }
          `}</style>
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-[fadeIn_0.2s_ease-out]">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-[zoomIn_0.25s_ease-out]">
              <div className="px-6 pt-8 pb-2 text-center">
                <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-7 h-7 text-red-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                </div>
                <h3 className="text-lg font-bold text-gray-900">{confirmModal.title}</h3>
                <p className="text-sm text-gray-500 mt-2 leading-relaxed whitespace-pre-line">{confirmModal.message}</p>
              </div>
              <div className="px-6 pb-6 pt-4 flex gap-3">
                <button
                  onClick={() => setConfirmModal(prev => ({ ...prev, show: false }))}
                  className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium py-2.5 rounded-xl text-sm transition"
                >
                  취소
                </button>
                <button
                  onClick={confirmModal.onConfirm}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white font-medium py-2.5 rounded-xl text-sm transition"
                >
                  삭제
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
