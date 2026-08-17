import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
// ★ 2026-07-03 에이전트(QTmsg) 전용 회사 게이팅 — 요금제 가드 면제 + 알림톡 탭만 + 로그아웃 버튼
import { useAuthStore, isAgentOnlyCompany } from '../stores/authStore';
import RcsTemplateFormModal from '../components/RcsTemplateFormModal';
// ★ D130: 알림톡 통합 관리 (IMC 연동)
import AlimtalkManagementSection from '../components/alimtalk/AlimtalkManagementSection';
// 브랜드 템플릿 관리 (기본형 발송용 템플릿 등록·검수)
import BrandTemplateManagementSection from '../components/alimtalk/BrandTemplateManagementSection';

function getToken(): string {
  return localStorage.getItem('token') || '';
}

type Tab = 'alimtalk' | 'brand' | 'rcs';

const STATUS_BADGE: Record<string, { label: string; bg: string; text: string }> = {
  pending:  { label: '승인대기', bg: 'bg-amber-100', text: 'text-amber-700' },
  approved: { label: '승인', bg: 'bg-green-100', text: 'text-green-700' },
  rejected: { label: '반려', bg: 'bg-red-100', text: 'text-red-700' },
  dormant:  { label: '휴면', bg: 'bg-gray-100', text: 'text-gray-500' },
};

export default function KakaoRcsPage() {
  const navigate = useNavigate();
  // ★ 2026-07-03 에이전트 전용 회사: 요금제 가드 면제 + 알림톡 탭만 노출 + 헤더 = 로그아웃
  const { user, logout } = useAuthStore();
  const isAgentOnly = isAgentOnlyCompany(user);
  const [activeTab, setActiveTab] = useState<Tab>('alimtalk');
  // ★ D150-2 (2026-05-09): 브랜드 sub-tab (템플릿 관리 / 발송)
  const [loading, setLoading] = useState(false);

  // ★ 2026-07-29 브랜드메시지 요금제 게이팅 폐지 (Harold 확정) — 모든 요금제에서 모든 기능을 쓴다.
  //   그 전에는 ENTERPRISE만 통과해 임직원 요금제까지 막혀 있었다. 잠금 상태·잠금 모달·플랜 조회를
  //   함께 지웠다 — 게이트를 없앴는데 장치가 남으면 다음 사람이 제한이 있는 줄 안다.
  //   남은 게이트는 **채널 연동 여부**(`companies.kakao_enabled`)뿐이고, 그건 요금제가 아니라
  //   발신프로필이 있어야 나가는 기술적 전제라 유지한다.

  // 알림톡 탭은 D130 `<AlimtalkManagementSection />`이 전담 — 상태는 해당 컴포넌트 내부에서 관리.
  // 브랜드메시지 탭용 프로필 목록만 KakaoRcsPage에서 유지.
  const [profiles, setProfiles] = useState<any[]>([]);

  // RCS
  const [rcsTemplates, setRcsTemplates] = useState<any[]>([]);
  const [rcsFilter, setRcsFilter] = useState('');
  const [showRcsForm, setShowRcsForm] = useState(false);
  const [editingRcs, setEditingRcs] = useState<any>(null);

  // 삭제 확인
  const [confirmModal, setConfirmModal] = useState<{
    show: boolean; title: string; message: string; onConfirm: () => void;
  }>({ show: false, title: '', message: '', onConfirm: () => {} });

  const [toast, setToast] = useState({ show: false, type: '' as 'success' | 'error', message: '' });

  useEffect(() => {
    if (!toast.show) return;
    const t = setTimeout(() => setToast(prev => ({ ...prev, show: false })), 3000);
    return () => clearTimeout(t);
  }, [toast.show]);

  // RCS 템플릿 조회
  const fetchRcsTemplates = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (rcsFilter) params.set('status', rcsFilter);
      const res = await fetch(`/api/companies/rcs-templates?${params}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (data.success) setRcsTemplates(data.templates);
    } catch { /* ignore */ }
  }, [rcsFilter]);

  // 프로필 조회 (브랜드 템플릿 탭 전달용)
  const fetchProfiles = useCallback(async () => {
    try {
      const res = await fetch('/api/alimtalk/senders', {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (data.success) setProfiles(data.profiles);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchRcsTemplates(), fetchProfiles()])
      .finally(() => setLoading(false));

  }, [fetchRcsTemplates, fetchProfiles]);

  // RCS 템플릿 삭제 (알림톡은 Section 내부에서 담당)
  const deleteRcsTemplate = async (id: string, name: string) => {
    setConfirmModal({
      show: true,
      title: '템플릿 삭제',
      message: `"${name}"을(를) 삭제하시겠습니까? 승인대기 상태만 삭제 가능합니다.`,
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/companies/rcs-templates/${id}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${getToken()}` },
          });
          const data = await res.json();
          if (data.success) {
            setToast({ show: true, type: 'success', message: '삭제되었습니다' });
            fetchRcsTemplates();
          } else {
            setToast({ show: true, type: 'error', message: data.error || '삭제 실패' });
          }
        } catch {
          setToast({ show: true, type: 'error', message: '서버 오류' });
        }
        setConfirmModal(prev => ({ ...prev, show: false }));
      },
    });
  };

  const formatDate = (d: string) => {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
  };

  const tabs = [
    { key: 'alimtalk' as Tab, label: '알림톡 템플릿', icon: '💬', color: 'amber' },
    // ★ 2026-07-03 에이전트 전용 회사 = 알림톡 템플릿만 (브랜드메시지·RCS 탭 숨김)
    ...(isAgentOnly ? [] : [
      { key: 'brand' as Tab, label: '브랜드 템플릿', icon: '📢', color: 'blue' },
      { key: 'rcs' as Tab, label: 'RCS 템플릿', icon: '📱', color: 'purple' },
    ]),
  ];


  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">{isAgentOnly ? '카카오 템플릿 관리' : '카카오 & RCS'}</h1>
            <p className="text-sm text-gray-500 mt-0.5">{isAgentOnly ? '알림톡 템플릿 등록 · 검수 관리' : '카카오톡·RCS 템플릿을 등록하고 검수 상태를 관리합니다'}</p>
          </div>
          {isAgentOnly ? (
            // ★ 2026-07-03 에이전트 전용 회사 — 대시보드 진입점 제거
            // ★ 2026-07-20 Harold 확정 3메뉴: 카카오 템플릿(현재)·발송결과·발신번호 등록 — /manage 축소 탭으로 연결
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <button onClick={() => navigate('/manage?tab=stats')}
                className="px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-lg text-sm font-medium transition">
                발송결과
              </button>
              <button onClick={() => navigate('/manage?tab=callbacks')}
                className="px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-lg text-sm font-medium transition">
                발신번호 등록
              </button>
              <button onClick={() => { logout(); navigate('/login'); }}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg text-sm transition">
                로그아웃
              </button>
            </div>
          ) : (
            <button onClick={() => navigate('/')}
              className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg text-sm transition">
              ← 대시보드
            </button>
          )}
        </div>
      </div>

      {/* 탭 */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-6 flex">
          {tabs.map(tab => {
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-5 py-3 text-sm font-medium transition-colors border-b-2 relative ${
                  activeTab === tab.key
                    ? `border-${tab.color}-500 text-${tab.color}-600`
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.icon} {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 컨텐츠 */}
      <div className="max-w-6xl mx-auto px-6 py-6">

        {/* ═══ 알림톡 템플릿 탭 (D130 — IMC 연동 통합 섹션) ═══ */}
        {activeTab === 'alimtalk' && <AlimtalkManagementSection />}

        {/* ═══ 브랜드메시지 탭 ═══ */}
        {/* ★ D150-2 (2026-05-09): sub-tab 도입 — "템플릿 관리"(신규) / "발송"(기존) 분리 */}
        {/* ═══ 브랜드 템플릿 탭 ═══ */}
        {/* ★ 2026-07-31 '발송' 서브탭 제거 — 이 페이지는 템플릿 관리다.
            브랜드메시지 발송은 직접발송 헤더의 브랜드메시지 모달이 유일한 경로다(입구를 둘로 두면 갈라진다). */}
        {activeTab === 'brand' && (
          <BrandTemplateManagementSection profiles={profiles} setToast={setToast} />
        )}

        {/* ═══ RCS 템플릿 탭 ═══ */}
        {activeTab === 'rcs' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex gap-2">
                {[
                  { value: '', label: '전체' },
                  { value: 'pending', label: '승인대기' },
                  { value: 'approved', label: '승인' },
                  { value: 'rejected', label: '반려' },
                ].map(f => (
                  <button key={f.value}
                    onClick={() => setRcsFilter(f.value)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${
                      rcsFilter === f.value
                        ? 'bg-purple-600 text-white'
                        : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'
                    }`}>
                    {f.label}
                  </button>
                ))}
              </div>
              <button onClick={() => { setEditingRcs(null); setShowRcsForm(true); }}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition">
                + RCS 템플릿 등록 요청
              </button>
            </div>

            {loading ? (
              <div className="text-center py-16 text-gray-400">로딩 중...</div>
            ) : rcsTemplates.length === 0 ? (
              <div className="text-center py-16">
                <div className="text-4xl mb-3">📱</div>
                <p className="text-gray-500">등록된 RCS 템플릿이 없습니다</p>
                {/* ★ 2026-08-17 "미지원 단말 SMS 자동 폴백" 문구 삭제 — 그렇게 동작한 적이 없다. */}
                <p className="text-sm text-gray-400 mt-1">RCS 발송은 준비 중입니다</p>
              </div>
            ) : (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium text-gray-600">템플릿명</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-600">메시지 유형</th>
                      <th className="px-4 py-3 text-center font-medium text-gray-600">상태</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-600">등록일</th>
                      <th className="px-4 py-3 text-center font-medium text-gray-600">관리</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {rcsTemplates.map(t => {
                      const badge = STATUS_BADGE[t.status] || STATUS_BADGE.pending;
                      return (
                        <tr key={t.id} className="hover:bg-gray-50 transition">
                          <td className="px-4 py-3 font-medium text-gray-900">{t.template_name}</td>
                          <td className="px-4 py-3 text-gray-600">{t.message_type}</td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${badge.bg} ${badge.text}`}>
                              {badge.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-500">{formatDate(t.created_at)}</td>
                          <td className="px-4 py-3 text-center">
                            {['pending', 'rejected'].includes(t.status) && (
                              <div className="flex gap-1 justify-center">
                                <button onClick={() => { setEditingRcs(t); setShowRcsForm(true); }}
                                  className="text-xs text-blue-600 hover:text-blue-700">수정</button>
                                <button onClick={() => deleteRcsTemplate(t.id, t.template_name)}
                                  className="text-xs text-red-500 hover:text-red-700">삭제</button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ═══ 모달들 ═══ */}
      {/* ★ D130: 알림톡 관련 모달(등록/수정/Wizard/알림수신자)은 AlimtalkManagementSection 내부에서 관리 */}

      {showRcsForm && (
        <RcsTemplateFormModal
          template={editingRcs}
          onClose={() => { setShowRcsForm(false); setEditingRcs(null); }}
          onSuccess={() => { setShowRcsForm(false); setEditingRcs(null); fetchRcsTemplates(); setToast({ show: true, type: 'success', message: '저장되었습니다' }); }}
        />
      )}

      {/* 삭제 확인 모달 */}
      {confirmModal.show && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="px-6 pt-8 pb-2 text-center">
              <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl">🗑️</span>
              </div>
              <h3 className="text-lg font-bold text-gray-900">{confirmModal.title}</h3>
              <p className="text-sm text-gray-500 mt-2">{confirmModal.message}</p>
            </div>
            <div className="px-6 pb-6 pt-4 flex gap-3">
              <button onClick={() => setConfirmModal(prev => ({ ...prev, show: false }))}
                className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition">
                취소
              </button>
              <button onClick={() => confirmModal.onConfirm()}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition">
                삭제
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ★ D130: 레거시 발신 프로필 등록 모달(Sender Key 수동 입력)은 AlimtalkManagementSection의 Wizard로 대체됨 */}


      {/* Toast */}
      {toast.show && (
        <div className={`fixed bottom-6 right-6 px-4 py-2 rounded-lg text-sm text-white shadow-lg z-[10000]
          ${toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}

