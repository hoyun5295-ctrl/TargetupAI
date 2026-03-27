import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import AlimtalkTemplateFormModal from '../components/AlimtalkTemplateFormModal';
import RcsTemplateFormModal from '../components/RcsTemplateFormModal';
import BrandMessageEditor from '../components/BrandMessageEditor';
import BrandMessagePreview from '../components/BrandMessagePreview';
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
  const [phones, setPhones] = useState('');
  const [previewState, setPreviewState] = useState<any>({});

  const handleSend = async (data: any) => {
    const phoneList = phones.split(/[\n,]/).map(p => p.trim().replace(/\D/g, '')).filter(p => p.length >= 10);
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
    <div className="flex gap-6">
      {/* 좌측: 에디터 + 수신자 */}
      <div className="flex-1 space-y-6">
        {/* 수신자 입력 */}
        <div className="bg-gray-50 rounded-xl p-4">
          <label className="block text-sm font-bold text-gray-700 mb-2">수신자 번호</label>
          <textarea
            value={phones}
            onChange={(e) => setPhones(e.target.value)}
            rows={3}
            className="w-full border rounded-lg px-3 py-2 text-sm resize-none"
            placeholder="전화번호 입력 (줄바꿈 또는 쉼표로 구분)&#10;예: 01012345678&#10;01098765432"
          />
          <div className="text-xs text-gray-400 mt-1">
            총 {phones.split(/[\n,]/).map(p => p.trim().replace(/\D/g, '')).filter(p => p.length >= 10).length}건
          </div>
        </div>

        {/* 메시지 에디터 */}
        <BrandMessageEditor profiles={profiles} onSend={handleSend} sending={sending} />
      </div>

      {/* 우측: 미리보기 */}
      <div className="w-[320px] shrink-0">
        <div className="sticky top-4">
          <h3 className="text-sm font-bold text-gray-700 mb-3">미리보기</h3>
          <BrandMessagePreview {...previewState} />
        </div>
      </div>
    </div>
  );
}
