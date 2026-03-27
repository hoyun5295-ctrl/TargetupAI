import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import AlimtalkTemplateFormModal from '../components/AlimtalkTemplateFormModal';
import RcsTemplateFormModal from '../components/RcsTemplateFormModal';
import BrandMessageEditor from '../components/BrandMessageEditor';
import DirectTargetFilterModal from '../components/DirectTargetFilterModal';
import { formatPhoneNumber } from '../utils/formatDate';

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
  const [activeTab, setActiveTab] = useState<Tab>('alimtalk');
  const [loading, setLoading] = useState(false);

  // ★ 브랜드메시지 엔터프라이즈 게이팅
  const [planCode, setPlanCode] = useState<string>('');
  const [brandLockedModal, setBrandLockedModal] = useState(false);
  const isBrandLocked = !['ENTERPRISE'].includes(planCode);

  // 알림톡
  const [alimtalkTemplates, setAlimtalkTemplates] = useState<any[]>([]);
  const [alimtalkFilter, setAlimtalkFilter] = useState('');
  const [showAlimtalkForm, setShowAlimtalkForm] = useState(false);
  const [editingAlimtalk, setEditingAlimtalk] = useState<any>(null);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [showProfileForm, setShowProfileForm] = useState(false);
  const [profileForm, setProfileForm] = useState({ profileName: '', profileKey: '' });
  const [profileSaving, setProfileSaving] = useState(false);

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

  const fetchAlimtalkTemplates = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (alimtalkFilter) params.set('status', alimtalkFilter);
      const res = await fetch(`/api/companies/kakao-templates?${params}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (data.success) setAlimtalkTemplates(data.templates);
    } catch { /* ignore */ }
  }, [alimtalkFilter]);

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

  const fetchProfiles = useCallback(async () => {
    try {
      const res = await fetch('/api/companies/kakao-profiles', {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (data.success) setProfiles(data.profiles);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchAlimtalkTemplates(), fetchRcsTemplates(), fetchProfiles()])
      .finally(() => setLoading(false));

    // 플랜 정보 조회 (브랜드메시지 게이팅용)
    fetch('/api/companies/my-plan', { headers: { Authorization: `Bearer ${getToken()}` } })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.plan_code) setPlanCode(d.plan_code); })
      .catch(() => {});
  }, [fetchAlimtalkTemplates, fetchRcsTemplates, fetchProfiles]);

  const deleteTemplate = async (type: 'kakao' | 'rcs', id: string, name: string) => {
    setConfirmModal({
      show: true,
      title: '템플릿 삭제',
      message: `"${name}"을(를) 삭제하시겠습니까? 승인대기 상태만 삭제 가능합니다.`,
      onConfirm: async () => {
        try {
          const endpoint = type === 'kakao'
            ? `/api/companies/kakao-templates/${id}`
            : `/api/companies/rcs-templates/${id}`;
          const res = await fetch(endpoint, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${getToken()}` },
          });
          const data = await res.json();
          if (data.success) {
            setToast({ show: true, type: 'success', message: '삭제되었습니다' });
            type === 'kakao' ? fetchAlimtalkTemplates() : fetchRcsTemplates();
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
    { key: 'brand' as Tab, label: '브랜드메시지', icon: '📢', color: 'blue' },
    { key: 'rcs' as Tab, label: 'RCS 템플릿', icon: '📱', color: 'purple' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">카카오 & RCS</h1>
            <p className="text-sm text-gray-500 mt-0.5">알림톡 템플릿, 브랜드메시지, RCS 관리</p>
          </div>
          <button onClick={() => navigate('/')}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg text-sm transition">
            ← 대시보드
          </button>
        </div>
      </div>

      {/* 탭 */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-6 flex">
          {tabs.map(tab => {
            const locked = tab.key === 'brand' && isBrandLocked;
            return (
              <button
                key={tab.key}
                onClick={() => {
                  if (locked) { setBrandLockedModal(true); return; }
                  setActiveTab(tab.key);
                }}
                className={`px-5 py-3 text-sm font-medium transition-colors border-b-2 relative ${
                  activeTab === tab.key
                    ? `border-${tab.color}-500 text-${tab.color}-600`
                    : locked
                      ? 'border-transparent text-gray-300 cursor-not-allowed'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.icon} {tab.label}
                {locked && <span className="ml-1 text-[10px]">🔒</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* 컨텐츠 */}
      <div className="max-w-6xl mx-auto px-6 py-6">

        {/* ═══ 알림톡 템플릿 탭 ═══ */}
        {activeTab === 'alimtalk' && (
          <div>
            {/* 발신 프로필 관리 */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-lg">👤</span>
                  <h3 className="text-sm font-bold text-gray-800">발신 프로필</h3>
                  <span className="text-xs text-gray-400">카카오톡 채널에서 발급받은 발신 프로필 키를 등록합니다</span>
                </div>
                <button
                  onClick={() => { setProfileForm({ profileName: '', profileKey: '' }); setShowProfileForm(true); }}
                  className="px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-700 rounded-lg text-xs font-medium transition"
                >
                  + 프로필 등록
                </button>
              </div>
              {profiles.length === 0 ? (
                <div className="text-center py-4 text-gray-400 text-sm">
                  등록된 발신 프로필이 없습니다. 카카오톡 채널의 Sender Key를 등록해주세요.
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {profiles.map((p: any) => (
                    <div key={p.id} className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      <span className="text-sm font-medium text-amber-800">{p.profile_name}</span>
                      <span className="text-xs text-amber-500 font-mono">{p.profile_key?.slice(0, 8)}...</span>
                      <button
                        onClick={() => {
                          setConfirmModal({
                            show: true, title: '프로필 삭제', message: `"${p.profile_name}" 프로필을 삭제하시겠습니까?`,
                            onConfirm: async () => {
                              try {
                                const res = await fetch(`/api/companies/kakao-profiles/${p.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${getToken()}` } });
                                const data = await res.json();
                                if (data.success) { setToast({ show: true, type: 'success', message: '삭제되었습니다' }); fetchProfiles(); }
                                else { setToast({ show: true, type: 'error', message: data.error || '삭제 실패' }); }
                              } catch { setToast({ show: true, type: 'error', message: '서버 오류' }); }
                              setConfirmModal(prev => ({ ...prev, show: false }));
                            }
                          });
                        }}
                        className="text-amber-400 hover:text-red-500 text-xs ml-1"
                      >✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 필터 + 등록 버튼 */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex gap-2">
                {[
                  { value: '', label: '전체' },
                  { value: 'pending', label: '승인대기' },
                  { value: 'approved', label: '승인' },
                  { value: 'rejected', label: '반려' },
                ].map(f => (
                  <button key={f.value}
                    onClick={() => setAlimtalkFilter(f.value)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${
                      alimtalkFilter === f.value
                        ? 'bg-amber-600 text-white'
                        : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'
                    }`}>
                    {f.label}
                  </button>
                ))}
              </div>
              <button onClick={() => { setEditingAlimtalk(null); setShowAlimtalkForm(true); }}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-medium transition">
                + 템플릿 등록 요청
              </button>
            </div>

            {/* 목록 */}
            {loading ? (
              <div className="text-center py-16 text-gray-400">로딩 중...</div>
            ) : alimtalkTemplates.length === 0 ? (
              <div className="text-center py-16">
                <div className="text-4xl mb-3">💬</div>
                <p className="text-gray-500">등록된 알림톡 템플릿이 없습니다</p>
                <p className="text-sm text-gray-400 mt-1">템플릿을 등록하면 카카오 검수 후 발송에 사용할 수 있습니다</p>
              </div>
            ) : (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium text-gray-600">템플릿명</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-600">카테고리</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-600">유형</th>
                      <th className="px-4 py-3 text-center font-medium text-gray-600">상태</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-600">등록일</th>
                      <th className="px-4 py-3 text-center font-medium text-gray-600">관리</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {alimtalkTemplates.map(t => {
                      const badge = STATUS_BADGE[t.status] || STATUS_BADGE.pending;
                      return (
                        <tr key={t.id} className="hover:bg-gray-50 transition">
                          <td className="px-4 py-3">
                            <div className="font-medium text-gray-900">{t.template_name}</div>
                            {t.template_code && <div className="text-xs text-gray-400">{t.template_code}</div>}
                          </td>
                          <td className="px-4 py-3 text-gray-600">{t.category || '-'}</td>
                          <td className="px-4 py-3 text-gray-600">{t.message_type || 'BA'}</td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${badge.bg} ${badge.text}`}>
                              {badge.label}
                            </span>
                            {t.status === 'rejected' && t.reject_reason && (
                              <div className="text-xs text-red-400 mt-0.5" title={t.reject_reason}>
                                {t.reject_reason.length > 20 ? t.reject_reason.slice(0, 20) + '...' : t.reject_reason}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-gray-500">{formatDate(t.created_at)}</td>
                          <td className="px-4 py-3 text-center">
                            {['pending', 'rejected'].includes(t.status) && (
                              <div className="flex gap-1 justify-center">
                                <button onClick={() => { setEditingAlimtalk(t); setShowAlimtalkForm(true); }}
                                  className="text-xs text-blue-600 hover:text-blue-700">수정</button>
                                <button onClick={() => deleteTemplate('kakao', t.id, t.template_name)}
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

        {/* ═══ 브랜드메시지 탭 ═══ */}
        {activeTab === 'brand' && (
          <BrandMessageTab profiles={profiles} setToast={setToast} />
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
                <p className="text-sm text-gray-400 mt-1">RCS 미지원 단말은 SMS로 자동 폴백됩니다</p>
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
                                <button onClick={() => deleteTemplate('rcs', t.id, t.template_name)}
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
      {showAlimtalkForm && (
        <AlimtalkTemplateFormModal
          template={editingAlimtalk}
          profiles={profiles}
          onClose={() => { setShowAlimtalkForm(false); setEditingAlimtalk(null); }}
          onSuccess={() => { setShowAlimtalkForm(false); setEditingAlimtalk(null); fetchAlimtalkTemplates(); setToast({ show: true, type: 'success', message: '저장되었습니다' }); }}
        />
      )}

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

      {/* 발신 프로필 등록 모달 */}
      {showProfileForm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
               style={{ animation: 'zoomIn 0.2s ease-out' }}>
            <div className="px-6 py-4 border-b bg-gradient-to-r from-amber-50 to-white flex justify-between items-center">
              <div>
                <h3 className="text-lg font-bold text-gray-900">발신 프로필 등록</h3>
                <p className="text-xs text-gray-500 mt-0.5">카카오톡 채널의 Sender Key를 등록합니다</p>
              </div>
              <button onClick={() => setShowProfileForm(false)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">프로필 이름 <span className="text-red-500">*</span></label>
                <input value={profileForm.profileName} onChange={e => setProfileForm({ ...profileForm, profileName: e.target.value })}
                  placeholder="예: 브랜드명, 매장명"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Sender Key <span className="text-red-500">*</span></label>
                <input value={profileForm.profileKey} onChange={e => setProfileForm({ ...profileForm, profileKey: e.target.value })}
                  placeholder="카카오톡 채널에서 발급받은 키"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-200" />
                <p className="text-xs text-gray-400 mt-1">카카오 비즈니스 채널 관리자에서 확인할 수 있습니다</p>
              </div>
            </div>
            <div className="px-6 py-3 border-t bg-gray-50 flex justify-end gap-3">
              <button onClick={() => setShowProfileForm(false)}
                className="px-5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm transition">취소</button>
              <button
                onClick={async () => {
                  if (!profileForm.profileName || !profileForm.profileKey) {
                    setToast({ show: true, type: 'error', message: '프로필 이름과 Sender Key를 입력해주세요' });
                    return;
                  }
                  setProfileSaving(true);
                  try {
                    const res = await fetch('/api/companies/kakao-profiles', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
                      body: JSON.stringify(profileForm),
                    });
                    const data = await res.json();
                    if (data.success) {
                      setShowProfileForm(false);
                      setToast({ show: true, type: 'success', message: '발신 프로필이 등록되었습니다' });
                      fetchProfiles();
                    } else {
                      setToast({ show: true, type: 'error', message: data.error || '등록 실패' });
                    }
                  } catch {
                    setToast({ show: true, type: 'error', message: '서버 오류' });
                  } finally {
                    setProfileSaving(false);
                  }
                }}
                disabled={profileSaving}
                className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-medium transition disabled:opacity-50">
                {profileSaving ? '등록 중...' : '등록'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 브랜드메시지 잠금 모달 */}
      {brandLockedModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full mx-4 p-6">
            <div className="text-center">
              <div className="text-4xl mb-3">🔒</div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">브랜드메시지</h3>
              <p className="text-sm text-gray-600 mb-4">
                브랜드메시지는 <span className="font-bold text-purple-600">엔터프라이즈</span> 요금제부터 이용 가능합니다.
              </p>
              <p className="text-xs text-gray-400 mb-6">
                카카오 브랜드메시지 8종 유형 발송 + 템플릿 기반 개인화 발송 기능이 포함됩니다.
              </p>
              <div className="flex gap-2">
                <button onClick={() => setBrandLockedModal(false)}
                  className="flex-1 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg text-sm transition">
                  닫기
                </button>
                <button onClick={() => { setBrandLockedModal(false); navigate('/settings'); }}
                  className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition">
                  요금제 확인
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast.show && (
        <div className={`fixed bottom-6 right-6 px-4 py-2 rounded-lg text-sm text-white shadow-lg z-[60]
          ${toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}

// ============================================================
// BrandMessageTab — 브랜드메시지 발송 탭 (수신자 + 에디터 + 미리보기)
// ============================================================
function BrandMessageTab({ profiles, setToast }: {
  profiles: { id: string; profile_key: string; profile_name: string }[];
  setToast: (t: { show: boolean; type: 'success' | 'error'; message: string }) => void;
}) {
  const [sending, setSending] = useState(false);

  // ★ 수신자 입력 3탭 (직접입력 / 파일등록 / DB추출)
  type RecipientMode = 'direct' | 'file' | 'db';
  const [recipientMode, setRecipientMode] = useState<RecipientMode>('direct');
  const [phones, setPhones] = useState('');
  const [recipientList, setRecipientList] = useState<{ phone: string }[]>([]);

  // 파일 업로드
  const [fileLoading, setFileLoading] = useState(false);
  const [fileHeaders, setFileHeaders] = useState<string[]>([]);
  const [filePreview, setFilePreview] = useState<any[]>([]);
  const [fileData, setFileData] = useState<any[]>([]);
  const [showMapping, setShowMapping] = useState(false);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [mappingLoading, setMappingLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [fileName, setFileName] = useState('');

  // DB추출
  const [showDbExtract, setShowDbExtract] = useState(false);

  // 수신자 건수 계산
  const getPhoneList = (): string[] => {
    if (recipientMode === 'direct') {
      return phones.split(/[\n,]/).map(p => p.trim().replace(/\D/g, '')).filter(p => p.length >= 10);
    }
    return recipientList.map(r => r.phone);
  };

  // 파일 업로드 처리
  const handleFileUpload = async (file: File) => {
    setFileLoading(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/upload/parse?includeData=true', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      if (data.success) {
        setFileHeaders(data.headers);
        setFilePreview(data.preview);
        setFileData(data.allData || data.preview);
        setFileName(file.name);
        setColumnMapping({});
        setShowMapping(true);
      } else {
        setToast({ show: true, type: 'error', message: data.error || '파일 파싱 실패' });
      }
    } catch {
      setToast({ show: true, type: 'error', message: '파일 업로드 중 오류가 발생했습니다.' });
    } finally {
      setFileLoading(false);
    }
  };

  // 파일 매핑 적용
  const handleMappingApply = async () => {
    if (!columnMapping.phone) {
      setToast({ show: true, type: 'error', message: '수신번호는 필수입니다.' });
      return;
    }
    setMappingLoading(true);
    setLoadingProgress(0);
    await new Promise(resolve => setTimeout(resolve, 10));

    const total = fileData.length;
    const chunkSize = 5000;
    const mapped: { phone: string }[] = [];

    for (let i = 0; i < total; i += chunkSize) {
      const chunk = fileData.slice(i, i + chunkSize);
      const processed = chunk.map(row => {
        const phone = String(row[columnMapping.phone] || '').trim().replace(/\D/g, '');
        return { phone };
      }).filter(r => r.phone && r.phone.length >= 10);

      mapped.push(...processed);
      setLoadingProgress(Math.min(100, Math.round((i + chunkSize) / total * 100)));
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    // 중복 제거
    const seen = new Set<string>();
    const deduped = mapped.filter(r => { if (seen.has(r.phone)) return false; seen.add(r.phone); return true; });

    setRecipientList(deduped);
    setRecipientMode('file');
    setMappingLoading(false);
    setShowMapping(false);
    const dupCount = mapped.length - deduped.length;
    setToast({ show: true, type: 'success', message: `${deduped.length.toLocaleString()}건 등록 완료${dupCount > 0 ? ` (중복 ${dupCount}건 제거)` : ''}` });
  };

  // DB추출 완료 콜백
  const handleDbExtracted = (recipients: any[], count: number) => {
    const mapped = recipients.map(r => ({ phone: String(r.phone || '').replace(/\D/g, '') })).filter(r => r.phone.length >= 10);
    setRecipientList(mapped);
    setRecipientMode('db');
    setShowDbExtract(false);
    setToast({ show: true, type: 'success', message: `${count.toLocaleString()}명 추출 완료` });
  };

  const handleSend = async (data: any) => {
    const phoneList = getPhoneList();
    if (phoneList.length === 0) {
      setToast({ show: true, type: 'error', message: '수신자 번호를 입력해주세요' });
      return;
    }
    if (!data.senderKey) {
      setToast({ show: true, type: 'error', message: '발신 프로필을 선택해주세요' });
      return;
    }

    setSending(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/campaigns/brand-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...data, phones: phoneList }),
      });
      const result = await res.json();
      if (result.success) {
        setToast({ show: true, type: 'success', message: `브랜드메시지 ${result.sentCount}건 발송 완료` });
        setPhones('');
        setRecipientList([]);
      } else {
        setToast({ show: true, type: 'error', message: result.error || '발송 실패' });
      }
    } catch (err) {
      setToast({ show: true, type: 'error', message: '발송 중 오류가 발생했습니다' });
    } finally {
      setSending(false);
    }
  };

  return (
    <>
    <div className="space-y-6">
      {/* 수신자 입력 — 3버튼 + 결과 영역 */}
      <div className="bg-white rounded-xl border-2 border-gray-200 overflow-hidden">
        {/* 3버튼 탭 */}
        <div className="flex gap-3 p-4 pb-0">
          <button
            onClick={() => setRecipientMode('direct')}
            className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all ${
              recipientMode === 'direct'
                ? 'bg-emerald-500 text-white shadow-md shadow-emerald-200'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >✏️ 직접입력</button>
          <button
            onClick={() => {
              setRecipientMode('file');
              if (recipientList.length === 0 || recipientMode !== 'file') {
                // 파일 대화상자 열기
                const inp = document.createElement('input');
                inp.type = 'file'; inp.accept = '.xlsx,.xls,.csv';
                inp.onchange = (ev) => { const f = (ev.target as HTMLInputElement).files?.[0]; if (f) handleFileUpload(f); };
                inp.click();
              }
            }}
            className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all ${
              recipientMode === 'file'
                ? 'bg-amber-500 text-white shadow-md shadow-amber-200'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            } ${fileLoading ? 'opacity-60 cursor-wait' : ''}`}
          >{fileLoading ? '⏳ 분석중...' : '📁 파일등록'}</button>
          <button
            onClick={() => { setRecipientMode('db'); setShowDbExtract(true); }}
            className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all ${
              recipientMode === 'db'
                ? 'bg-blue-500 text-white shadow-md shadow-blue-200'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >🔍 DB추출</button>
        </div>

        {/* 컨텐츠 영역 */}
        <div className="p-4">
          {/* 직접입력 모드 */}
          {recipientMode === 'direct' && (
            <>
              <textarea
                value={phones}
                onChange={(e) => setPhones(e.target.value)}
                rows={3}
                className="w-full border-2 border-gray-200 rounded-lg px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:border-emerald-400"
                placeholder="전화번호 입력 (줄바꿈 또는 쉼표로 구분)&#10;예: 01012345678, 01098765432"
              />
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-gray-400">
                  총 <span className="font-bold text-emerald-600 text-sm">{getPhoneList().length.toLocaleString()}</span>건
                </span>
                {phones && (
                  <button onClick={() => setPhones('')} className="text-xs text-gray-400 hover:text-red-500">초기화</button>
                )}
              </div>
            </>
          )}

          {/* 파일등록 모드 */}
          {recipientMode === 'file' && (
            <>
              {recipientList.length > 0 ? (
                <div className="flex items-center justify-between bg-amber-50 rounded-lg p-3 border border-amber-200">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center text-lg">📁</div>
                    <div>
                      <div className="text-sm font-medium text-gray-800">{fileName}</div>
                      <div className="text-xs text-gray-500">
                        총 <span className="font-bold text-amber-600">{recipientList.length.toLocaleString()}</span>건
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => {
                      const inp = document.createElement('input');
                      inp.type = 'file'; inp.accept = '.xlsx,.xls,.csv';
                      inp.onchange = (ev) => { const f = (ev.target as HTMLInputElement).files?.[0]; if (f) handleFileUpload(f); };
                      inp.click();
                    }} className="px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-100 hover:bg-amber-200 rounded-lg transition-colors">
                      다시 업로드
                    </button>
                    <button onClick={() => { setRecipientList([]); setFileName(''); }} className="px-3 py-1.5 text-xs font-medium text-gray-500 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">
                      초기화
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={() => {
                  const inp = document.createElement('input');
                  inp.type = 'file'; inp.accept = '.xlsx,.xls,.csv';
                  inp.onchange = (ev) => { const f = (ev.target as HTMLInputElement).files?.[0]; if (f) handleFileUpload(f); };
                  inp.click();
                }} className="w-full py-8 border-2 border-dashed border-amber-300 rounded-xl text-center hover:bg-amber-50 transition-colors cursor-pointer">
                  <div className="text-3xl mb-2">📁</div>
                  <div className="text-sm text-gray-600 font-medium">클릭하여 파일을 업로드하세요</div>
                  <div className="text-xs text-gray-400 mt-1">.xlsx, .xls, .csv</div>
                </button>
              )}
            </>
          )}

          {/* DB추출 모드 */}
          {recipientMode === 'db' && (
            <>
              {recipientList.length > 0 ? (
                <div className="flex items-center justify-between bg-blue-50 rounded-lg p-3 border border-blue-200">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center text-lg">🔍</div>
                    <div>
                      <div className="text-sm font-medium text-gray-800">DB 추출 결과</div>
                      <div className="text-xs text-gray-500">
                        총 <span className="font-bold text-blue-600">{recipientList.length.toLocaleString()}</span>건
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setShowDbExtract(true)} className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-100 hover:bg-blue-200 rounded-lg transition-colors">
                      다시 추출
                    </button>
                    <button onClick={() => setRecipientList([])} className="px-3 py-1.5 text-xs font-medium text-gray-500 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">
                      초기화
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setShowDbExtract(true)} className="w-full py-8 border-2 border-dashed border-blue-300 rounded-xl text-center hover:bg-blue-50 transition-colors cursor-pointer">
                  <div className="text-3xl mb-2">🔍</div>
                  <div className="text-sm text-gray-600 font-medium">클릭하여 고객 DB에서 추출하세요</div>
                  <div className="text-xs text-gray-400 mt-1">필터 조건으로 대상자를 선택합니다</div>
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* 메시지 에디터 (미리보기 통합) */}
      <BrandMessageEditor profiles={profiles} onSend={handleSend} sending={sending} />
    </div>

    {/* 파일 매핑 모달 */}
    {showMapping && (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
        <div className="bg-white rounded-2xl shadow-2xl w-[550px] max-h-[80vh] overflow-y-auto">
          <div className="px-5 py-3 border-b bg-blue-50 flex justify-between items-center">
            <div>
              <h3 className="font-bold text-sm">📁 컬럼 매핑</h3>
              <p className="text-xs text-gray-500 mt-0.5">수신번호 컬럼을 선택해주세요</p>
            </div>
            <button onClick={() => setShowMapping(false)} className="text-gray-500 hover:text-gray-700">✕</button>
          </div>
          <div className="px-5 py-4">
            <div className="flex items-center gap-3 p-3 bg-red-50 rounded-lg border border-red-200 mb-3">
              <span className="text-xs font-bold text-red-700 w-20 shrink-0">📱 수신번호 *</span>
              <span className="text-gray-400 text-xs">→</span>
              <select className="flex-1 border border-red-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-red-400 min-w-0"
                value={columnMapping.phone || ''} onChange={(e) => setColumnMapping({ ...columnMapping, phone: e.target.value })}>
                <option value="">-- 선택 --</option>
                {fileHeaders.map((h, i) => {
                  const sample = fileData[0]?.[h];
                  return <option key={i} value={h}>{h}{sample ? ` (예: ${String(sample).slice(0, 15)})` : ''}</option>;
                })}
              </select>
            </div>
            {filePreview.length > 0 && (
              <div className="mt-3 border rounded-lg overflow-hidden">
                <div className="bg-gray-50 px-3 py-2 text-xs font-medium text-gray-600">미리보기 (상위 {Math.min(filePreview.length, 3)}건)</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b bg-gray-50">
                        {fileHeaders.slice(0, 5).map((h, i) => (
                          <th key={i} className="px-2 py-1.5 text-left font-medium text-gray-600 whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filePreview.slice(0, 3).map((row, ri) => (
                        <tr key={ri} className="border-b">
                          {fileHeaders.slice(0, 5).map((h, ci) => (
                            <td key={ci} className="px-2 py-1.5 text-gray-700 whitespace-nowrap">{String(row[h] || '').slice(0, 20)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
          <div className="px-5 py-3 border-t bg-gray-50 flex justify-between items-center">
            <span className="text-xs text-gray-600">총 <strong>{fileData.length.toLocaleString()}</strong>건</span>
            <div className="flex gap-2">
              <button onClick={() => setShowMapping(false)} className="px-4 py-2 border rounded-lg text-xs font-medium hover:bg-gray-100">취소</button>
              <button onClick={handleMappingApply} disabled={!columnMapping.phone || mappingLoading}
                className="px-6 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-xs font-bold disabled:opacity-50"
              >{mappingLoading ? `처리중... ${loadingProgress}%` : '등록하기'}</button>
            </div>
          </div>
        </div>
      </div>
    )}

    {/* DB추출 모달 */}
    {showDbExtract && (
      <DirectTargetFilterModal
        show={showDbExtract}
        onClose={() => setShowDbExtract(false)}
        onExtracted={(recipients, count, _fieldsMeta, _cbPhone) => handleDbExtracted(recipients, count)}
      />
    )}
    </>
  );
}
