import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import AlimtalkTemplateFormModal from '../components/AlimtalkTemplateFormModal';
import RcsTemplateFormModal from '../components/RcsTemplateFormModal';

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

  // 알림톡
  const [alimtalkTemplates, setAlimtalkTemplates] = useState<any[]>([]);
  const [alimtalkFilter, setAlimtalkFilter] = useState('');
  const [showAlimtalkForm, setShowAlimtalkForm] = useState(false);
  const [editingAlimtalk, setEditingAlimtalk] = useState<any>(null);
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
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-5 py-3 text-sm font-medium transition-colors border-b-2 ${
                activeTab === tab.key
                  ? `border-${tab.color}-500 text-${tab.color}-600`
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
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
                  onClick={async () => {
                    const profileName = prompt('프로필 이름을 입력하세요 (예: 브랜드명)');
                    if (!profileName) return;
                    const profileKey = prompt('발신 프로필 키(Sender Key)를 입력하세요');
                    if (!profileKey) return;
                    try {
                      const res = await fetch('/api/companies/kakao-profiles', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
                        body: JSON.stringify({ profileName, profileKey }),
                      });
                      const data = await res.json();
                      if (data.success) {
                        setToast({ show: true, type: 'success', message: '발신 프로필이 등록되었습니다' });
                        fetchProfiles();
                      } else {
                        setToast({ show: true, type: 'error', message: data.error || '등록 실패' });
                      }
                    } catch {
                      setToast({ show: true, type: 'error', message: '서버 오류' });
                    }
                  }}
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
                        onClick={async () => {
                          if (!window.confirm(`"${p.profile_name}" 프로필을 삭제하시겠습니까?`)) return;
                          try {
                            const res = await fetch(`/api/companies/kakao-profiles/${p.id}`, {
                              method: 'DELETE',
                              headers: { Authorization: `Bearer ${getToken()}` },
                            });
                            const data = await res.json();
                            if (data.success) {
                              setToast({ show: true, type: 'success', message: '삭제되었습니다' });
                              fetchProfiles();
                            } else {
                              setToast({ show: true, type: 'error', message: data.error || '삭제 실패' });
                            }
                          } catch {
                            setToast({ show: true, type: 'error', message: '서버 오류' });
                          }
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
          <div className="text-center py-16">
            <div className="text-4xl mb-3">📢</div>
            <h3 className="text-lg font-bold text-gray-900 mb-2">브랜드메시지 발송</h3>
            <p className="text-sm text-gray-500 mb-6">
              카카오 브랜드메시지를 작성하고 발송합니다
            </p>
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-6 max-w-md mx-auto">
              <p className="text-sm text-blue-700">
                브랜드메시지 발송 기능은 현재 메인 발송창에서 이용 가능합니다.<br />
                이 탭으로 이동 예정입니다.
              </p>
            </div>
          </div>
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
