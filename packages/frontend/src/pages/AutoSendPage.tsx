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
import { formatCampaignMessageForDisplay } from '../utils/formatDate';

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
  // ★ D96: AI 생성 문안 관련
  ai_generate_enabled: boolean;
  generated_message_content: string | null;
  generated_message_subject: string | null;
  generated_at: string | null;
  ai_generation_status: string | null;
  fallback_message_content: string | null;
  // ★ B2: 백엔드 LEFT JOIN으로 내려오는 사용자/회사 080 번호
  opt_out_080_number: string | null;
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
  // ★ DB에 UTC로 저장된 시간을 KST로 변환하여 표시
  const d = new Date(dateStr);
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}-${String(kst.getUTCDate()).padStart(2, '0')} ${String(kst.getUTCHours()).padStart(2, '0')}:${String(kst.getUTCMinutes()).padStart(2, '0')}`;
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

  // ★ D86: 실행 이력 모달
  // ★ B2: ac 객체도 저장 — 표시 시 (광고)+080 부착에 message_type/is_ad/opt_out_080_number 필요
  const [historyModal, setHistoryModal] = useState<{ show: boolean; campaignName: string; ac: AutoCampaign | null; runs: any[] }>({ show: false, campaignName: '', ac: null, runs: [] });
  const [historyLoading, setHistoryLoading] = useState(false);

  // ★ D96: AI 생성 문안 확인/수정 모달
  const [messageModal, setMessageModal] = useState<{
    show: boolean;
    campaignId: string;
    campaignName: string;
    content: string;
    subject: string;
    generatedAt: string | null;
    aiStatus: string | null;
    fallback: string | null;
    isAd: boolean;
    messageType: string;
  }>({ show: false, campaignId: '', campaignName: '', content: '', subject: '', generatedAt: null, aiStatus: null, fallback: null, isAd: false, messageType: 'SMS' });
  const [messageEditing, setMessageEditing] = useState(false);
  const [messageSaving, setMessageSaving] = useState(false);

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
  // ★ D86: 실행 이력 조회 — GET /api/auto-campaigns/:id (runs 포함)
  // ============================================================
  const fetchRunHistory = async (ac: AutoCampaign) => {
    setHistoryLoading(true);
    setHistoryModal({ show: true, campaignName: ac.campaign_name, ac, runs: [] });
    try {
      const res = await fetch(`/api/auto-campaigns/${ac.id}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (res.ok) {
        const data = await res.json();
        // ★ B2: 백엔드 응답의 autoCampaign(opt_out_080_number 포함)을 우선 저장 — 폴백으로 목록의 ac 사용
        setHistoryModal({ show: true, campaignName: ac.campaign_name, ac: data.autoCampaign || ac, runs: data.runs || [] });
      }
    } catch (err) {
      console.error('이력 조회 실패:', err);
    } finally {
      setHistoryLoading(false);
    }
  };

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

  // ★ D96: AI 생성 문안 보기
  const handleViewMessage = (ac: AutoCampaign) => {
    setMessageModal({
      show: true,
      campaignId: ac.id,
      campaignName: ac.campaign_name,
      content: ac.generated_message_content || '',
      subject: ac.generated_message_subject || '',
      generatedAt: ac.generated_at,
      aiStatus: ac.ai_generation_status,
      fallback: ac.fallback_message_content,
      isAd: ac.is_ad,
      messageType: ac.message_type,
    });
    setMessageEditing(false);
  };

  // ★ D96: AI 생성 문안 저장
  const handleSaveMessage = async () => {
    if (!messageModal.content.trim()) return;
    setMessageSaving(true);
    try {
      const res = await fetch(`/api/auto-campaigns/${messageModal.campaignId}/generated-message`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({
          generated_message_content: messageModal.content,
          generated_message_subject: messageModal.subject || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || '저장 실패');
        return;
      }
      setMessageEditing(false);
      fetchData();
    } catch { alert('저장에 실패했습니다.'); }
    finally { setMessageSaving(false); }
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
                      {ac.ai_generate_enabled && (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          ac.generated_message_content
                            ? 'bg-violet-100 text-violet-700'
                            : 'bg-gray-100 text-gray-500'
                        }`}>
                          {ac.generated_message_content ? 'AI문안 생성됨' : 'AI 대기'}
                        </span>
                      )}
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
                    {/* ★ D96: AI 생성 문안 보기 */}
                    {ac.ai_generate_enabled && (
                      <button
                        onClick={() => handleViewMessage(ac)}
                        className={`text-xs px-3 py-1.5 rounded-lg transition ${
                          ac.generated_message_content
                            ? 'text-violet-600 hover:text-violet-700 hover:bg-violet-50 font-medium'
                            : 'text-gray-400 cursor-default'
                        }`}
                        disabled={!ac.generated_message_content}
                        title={ac.generated_message_content ? 'AI 생성 문안 확인/수정' : 'AI 문안이 아직 생성되지 않았습니다'}
                      >
                        문안
                      </button>
                    )}
                    {/* ★ D86: 실행 이력 보기 */}
                    <button
                      onClick={() => fetchRunHistory(ac)}
                      className="text-xs text-gray-500 hover:text-violet-600 px-3 py-1.5 rounded-lg hover:bg-violet-50 transition"
                    >
                      이력
                    </button>
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

      {/* ★ D96: AI 생성 문안 확인/수정 모달 */}
      {messageModal.show && (
        <>
          <style>{`
            @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
            @keyframes zoomIn { from { opacity: 0; transform: scale(0.92); } to { opacity: 1; transform: scale(1); } }
          `}</style>
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-[fadeIn_0.2s_ease-out]">
            <div
              className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden animate-[zoomIn_0.25s_ease-out]"
              onClick={e => e.stopPropagation()}
            >
              {/* 헤더 */}
              <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-violet-50 to-white">
                <div>
                  <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                    AI 생성 문안
                    {messageModal.aiStatus && (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        messageModal.aiStatus === 'ai_generated' ? 'bg-violet-100 text-violet-700' :
                        messageModal.aiStatus === 'ai_fallback' ? 'bg-amber-100 text-amber-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {messageModal.aiStatus === 'ai_generated' ? 'AI 생성' : messageModal.aiStatus === 'ai_fallback' ? '폴백' : '고정문안'}
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5">{messageModal.campaignName}</p>
                  {messageModal.generatedAt && (
                    <p className="text-xs text-gray-400 mt-0.5">생성일: {formatDate(messageModal.generatedAt)}</p>
                  )}
                </div>
                <button
                  onClick={() => setMessageModal(prev => ({ ...prev, show: false }))}
                  className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition text-lg"
                >
                  &times;
                </button>
              </div>

              {/* 본문 */}
              <div className="flex-1 overflow-auto px-6 py-4 space-y-4">
                {/* 제목 (LMS/MMS) */}
                {(messageModal.messageType === 'LMS' || messageModal.messageType === 'MMS') && (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">제목</label>
                    {messageEditing ? (
                      <input
                        value={messageModal.subject}
                        onChange={e => setMessageModal(prev => ({ ...prev, subject: e.target.value }))}
                        className="w-full border border-violet-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                      />
                    ) : (
                      <p className="text-sm text-gray-800 bg-gray-50 rounded-lg px-3 py-2">{messageModal.subject || '-'}</p>
                    )}
                  </div>
                )}

                {/* 메시지 본문 */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    본문 {messageModal.isAd && <span className="text-orange-500">(광고)</span>}
                  </label>
                  {messageEditing ? (
                    <textarea
                      value={messageModal.content}
                      onChange={e => setMessageModal(prev => ({ ...prev, content: e.target.value }))}
                      rows={8}
                      className="w-full border border-violet-300 rounded-lg px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-violet-500 leading-relaxed"
                    />
                  ) : (
                    <div className="bg-gray-50 rounded-lg px-3 py-2.5 text-sm text-gray-800 whitespace-pre-line leading-relaxed min-h-[120px]">
                      {messageModal.content || '(아직 생성되지 않음)'}
                    </div>
                  )}
                </div>

                {/* 폴백 메시지 참고 */}
                {messageModal.fallback && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                    <p className="text-xs font-medium text-amber-700 mb-1">폴백 메시지 (AI 실패 시 사용)</p>
                    <p className="text-xs text-gray-600 whitespace-pre-line">{messageModal.fallback}</p>
                  </div>
                )}

                <p className="text-xs text-gray-400">
                  다음 발송에 위 문안이 사용됩니다. 수정하면 변경된 내용으로 발송됩니다.
                </p>
              </div>

              {/* 하단 버튼 */}
              <div className="px-6 py-4 border-t bg-gray-50 flex justify-end gap-3">
                {messageEditing ? (
                  <>
                    <button
                      onClick={() => setMessageEditing(false)}
                      className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm transition"
                    >
                      취소
                    </button>
                    <button
                      onClick={handleSaveMessage}
                      disabled={messageSaving}
                      className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-violet-400 text-white rounded-lg text-sm font-medium transition"
                    >
                      {messageSaving ? '저장 중...' : '저장'}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => setMessageModal(prev => ({ ...prev, show: false }))}
                      className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm transition"
                    >
                      닫기
                    </button>
                    <button
                      onClick={() => setMessageEditing(true)}
                      className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium transition"
                    >
                      수정
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ★ D86: 실행 이력 모달 */}
      {historyModal.show && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b bg-gray-50">
              <div>
                <h3 className="text-lg font-bold text-gray-800">실행 이력</h3>
                <p className="text-xs text-gray-500">{historyModal.campaignName}</p>
              </div>
              <button onClick={() => setHistoryModal({ show: false, campaignName: '', ac: null, runs: [] })} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition text-lg">&times;</button>
            </div>

            <div className="flex-1 overflow-auto px-6 py-4">
              {historyLoading ? (
                <div className="text-center py-10 text-gray-400">조회 중...</div>
              ) : historyModal.runs.length === 0 ? (
                <div className="text-center py-10 text-gray-400">아직 실행 이력이 없습니다.</div>
              ) : (
                <div className="space-y-3">
                  {historyModal.runs.map((run: any) => {
                    const statusMap: Record<string, { label: string; color: string }> = {
                      completed: { label: '완료', color: 'bg-green-100 text-green-700' },
                      sending: { label: '발송중', color: 'bg-blue-100 text-blue-700' },
                      notified: { label: '알림발송', color: 'bg-violet-100 text-violet-700' },
                      pending: { label: '대기', color: 'bg-gray-100 text-gray-600' },
                      failed: { label: '실패', color: 'bg-red-100 text-red-700' },
                      cancelled: { label: '취소', color: 'bg-amber-100 text-amber-700' },
                    };
                    const st = statusMap[run.status] || { label: run.status, color: 'bg-gray-100 text-gray-600' };
                    return (
                      <div key={run.id} className="border border-gray-200 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-gray-800">#{run.run_number}회차</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.color}`}>{st.label}</span>
                            {run.ai_generation_status && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-violet-50 text-violet-600">
                                {run.ai_generation_status === 'ai_generated' ? 'AI생성' : run.ai_generation_status === 'ai_fallback' ? '폴백' : '고정문안'}
                              </span>
                            )}
                          </div>
                          {/* ★ D114 P8-2: 상태별 시간 표시 분기 — 알림/스팸은 실행 시각, 실발송은 예약 시각 */}
                          <span className="text-xs text-gray-400">
                            {run.status === 'notified' ? formatDate(run.notified_at || run.scheduled_at)
                              : run.status === 'spam_tested' ? formatDate(run.started_at || run.scheduled_at)
                              : formatDate(run.scheduled_at)}
                          </span>
                        </div>
                        <div className="grid grid-cols-4 gap-2 text-center">
                          <div className="bg-gray-50 rounded-lg p-2">
                            <div className="text-xs text-gray-500">대상</div>
                            <div className="text-sm font-bold text-gray-800">{(run.target_count || 0).toLocaleString()}</div>
                          </div>
                          <div className="bg-blue-50 rounded-lg p-2">
                            <div className="text-xs text-blue-600">발송</div>
                            <div className="text-sm font-bold text-blue-700">{(run.sent_count || 0).toLocaleString()}</div>
                          </div>
                          <div className="bg-green-50 rounded-lg p-2">
                            <div className="text-xs text-green-600">성공</div>
                            <div className="text-sm font-bold text-green-700">{(run.success_count || 0).toLocaleString()}</div>
                          </div>
                          <div className="bg-red-50 rounded-lg p-2">
                            <div className="text-xs text-red-600">실패</div>
                            <div className="text-sm font-bold text-red-700">{(run.fail_count || 0).toLocaleString()}</div>
                          </div>
                        </div>
                        {/* ★ D96: 회차별 AI 생성 문안 표시
                            ★ B2: 컨트롤타워 — 실제 발송된 본문에 (광고)+080 부착하여 표시 */}
                        {run.generated_message_content && (
                          <div className="mt-2 bg-violet-50 border border-violet-200 rounded-lg p-2.5">
                            <p className="text-xs font-medium text-violet-600 mb-1">사용된 문안</p>
                            <p className="text-xs text-gray-700 whitespace-pre-line leading-relaxed line-clamp-3">
                              {historyModal.ac
                                ? formatCampaignMessageForDisplay({
                                    message_content: run.generated_message_content,
                                    message_type: historyModal.ac.message_type,
                                    is_ad: historyModal.ac.is_ad,
                                    opt_out_080_number: historyModal.ac.opt_out_080_number,
                                  })
                                : run.generated_message_content}
                            </p>
                          </div>
                        )}
                        {run.cancel_reason && (
                          <p className="text-xs text-amber-600 mt-2">취소 사유: {run.cancel_reason}</p>
                        )}
                        {run.notified_at && (
                          <p className="text-xs text-violet-500 mt-1">사전알림: {formatDate(run.notified_at)}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
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
