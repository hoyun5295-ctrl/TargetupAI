import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';


export default function Settings() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isAdmin = user?.userType === 'company_admin';
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newPhone, setNewPhone] = useState('');
  const [newName, setNewName] = useState('');
  const [managerContacts, setManagerContacts] = useState<{id?: string, phone: string, name: string, type?: string}[]>([]);
  const [testContactMode, setTestContactMode] = useState<'shared' | 'personal' | 'both'>('shared');
  const [activeTab, setActiveTab] = useState<'shared' | 'personal'>('shared');
  const [callbackNumbers, setCallbackNumbers] = useState<{id: string, phone: string, label: string, is_default: boolean, store_code?: string, store_name?: string}[]>([]);
  const [callbackPage, setCallbackPage] = useState(0);
  const callbackPageSize = 5;


  // 토스트
  const [toast, setToast] = useState<{show: boolean, type: 'success' | 'error', message: string}>({show: false, type: 'success', message: ''});

  const [settings, setSettings] = useState({
    brand_name: '',
    business_type: '',
    reject_number: '',
    monthly_budget: 1000000,
    cost_per_sms: 9.9,
    cost_per_lms: 27,
    cost_per_mms: 50,
    cost_per_kakao: 7.5,
    send_start_hour: 9,
    send_end_hour: 20,
    daily_limit_per_customer: 1,
    holiday_send_allowed: false,
    duplicate_prevention_days: 7,
    target_strategy: 'balanced',
    cross_category_allowed: true,
    approval_required: false,
  });

  useEffect(() => {
    loadSettings();
  }, []);

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ show: true, type, message });
    setTimeout(() => setToast({ show: false, type: 'success', message: '' }), 3000);
  };

  const loadSettings = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/companies/settings', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data) {
        const { manager_phones, manager_contacts, manager_phone, callback_auth_phone, callback_auth_verified, ...rest } = data;
        setSettings((prev) => ({ ...prev, ...rest }));
        // 담당자 사전수신 목록
        const tcRes = await fetch('/api/test-contacts', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const tcData = await tcRes.json();
        if (tcData.success) {
          setManagerContacts(tcData.contacts || []);
          setTestContactMode(tcData.mode || 'shared');
        }
      }

      // 회신번호 목록
      const cbRes = await fetch('/api/companies/callback-numbers', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const cbData = await cbRes.json();
      if (cbData.success) {
        setCallbackNumbers(cbData.numbers || []);
      }

    } catch (error) {
      console.error('설정 로드 실패:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/companies/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ...settings, manager_contacts: managerContacts }),
      });
      const data = await res.json();
      showToast('success', data.message || '저장 완료');
    } catch (error) {
      showToast('error', '저장 실패');
    } finally {
      setSaving(false);
    }
  };

  // 담당자 번호 포맷
  const formatPhone = (phone: string) => {
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length === 11) {
      return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 7)}-${cleaned.slice(7)}`;
    }
    if (cleaned.length === 10) {
      return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    }
    return phone;
  };

  // 사전수신 번호 추가
  const handleAddPhone = async () => {
    const cleaned = newPhone.replace(/\D/g, '');
    if (cleaned.length < 10 || cleaned.length > 11) {
      showToast('error', '올바른 전화번호를 입력해주세요');
      return;
    }
    const token = localStorage.getItem('token');
    const res = await fetch('/api/test-contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: newName.trim(), phone: cleaned, isShared: testContactMode === 'both' ? activeTab === 'shared' : undefined }),
    });
    const data = await res.json();
    if (data.success) {
      setManagerContacts([...managerContacts, data.contact]);
      setNewPhone('');
      setNewName('');
    } else {
      showToast('error', data.error || '추가 실패');
    }
  };

  // 사전수신 담당자 삭제
  const handleRemovePhone = async (id: string) => {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/test-contacts/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (data.success) {
      setManagerContacts(managerContacts.filter((c) => c.id !== id));
    } else {
      showToast('error', data.error || '삭제 실패');
    }
  };


  if (loading) return <div className="p-8 text-center">로딩 중...</div>;

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white shadow">
        <div className="max-w-4xl mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-xl font-bold">회사 설정</h1>
          <button onClick={() => navigate('/')} className="text-gray-500 hover:text-gray-700">
            ← 대시보드
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        <div className="grid grid-cols-2 gap-6">

        {/* 기본 정보 */}
        <section className="bg-white rounded-lg shadow p-6 min-h-[280px]">
          <h2 className="text-lg font-semibold mb-4">기본 정보</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">브랜드명</label>
              <input
                type="text"
                value={settings.brand_name || ''}
                onChange={(e) => setSettings({ ...settings, brand_name: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                placeholder="예: 타겟업"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">업종</label>
              <select
                value={settings.business_type || ''}
                onChange={(e) => setSettings({ ...settings, business_type: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              >
                <option value="">선택</option>
                <option value="cosmetics">화장품</option>
                <option value="food">식품</option>
                <option value="fashion">패션</option>
                <option value="education">교육</option>
                <option value="healthcare">헬스케어</option>
                <option value="other">기타</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">080 수신거부번호</label>
              <input
                type="text"
                value={settings.reject_number || ''}
                onChange={(e) => setSettings({ ...settings, reject_number: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                placeholder="예: 080-123-4567"
              />
            </div>
          </div>
        </section>

        {/* 담당자 사전수신 */}
        <section className="bg-white rounded-lg shadow p-6 min-h-[280px]">
          <h2 className="text-lg font-semibold mb-4">담당자 사전수신</h2>
          <p className="text-sm text-gray-500 mb-4">
            캠페인 발송 전 등록된 담당자 전원에게 테스트 문자를 보내 확인할 수 있습니다.
          </p>

          {testContactMode === 'both' && (
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setActiveTab('shared')}
                className={`px-4 py-2 rounded-lg text-sm font-medium ${
                  activeTab === 'shared' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                회사 공용
              </button>
              <button
                onClick={() => setActiveTab('personal')}
                className={`px-4 py-2 rounded-lg text-sm font-medium ${
                  activeTab === 'personal' ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                내 번호
              </button>
            </div>
          )}

          {managerContacts.filter(c =>
            testContactMode === 'both'
              ? (activeTab === 'shared' ? c.type === 'shared' : c.type === 'personal')
              : true
          ).length > 0 ? (
            <div className="space-y-2 mb-4">
              {managerContacts
                .filter(c => testContactMode === 'both' ? (activeTab === 'shared' ? c.type === 'shared' : c.type === 'personal') : true)
                .map((contact, idx) => (
                <div
                  key={contact.id || contact.phone}
                  className={`flex items-center gap-3 rounded-lg px-4 py-2.5 ${
                    contact.type === 'shared' ? 'bg-blue-50 border border-blue-200' : 'bg-purple-50 border border-purple-200'
                  }`}
                >
                  <span className="flex-1 font-medium text-gray-800">
                    {contact.name || `담당자 ${idx + 1}`}: {formatPhone(contact.phone)}
                  </span>
                  <button
                    onClick={() => contact.id && handleRemovePhone(contact.id)}
                    className="px-2.5 py-1 text-sm bg-white border border-red-300 text-red-600 rounded-lg hover:bg-red-50"
                  >
                    삭제
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-4 text-gray-400 mb-4">등록된 담당자가 없습니다</div>
          )}

          <div className="flex items-end gap-2">
            <div className="w-24">
              <label className="block text-sm font-medium text-gray-700 mb-1">이름</label>
              <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} className="w-full px-3 py-2 border rounded-lg" placeholder="홍길동" />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">전화번호</label>
              <input type="text" value={newPhone} onChange={(e) => setNewPhone(e.target.value.replace(/[^\d-]/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter') handleAddPhone(); }} className="w-full px-3 py-2 border rounded-lg" placeholder="01012345678" />
            </div>
            <button onClick={handleAddPhone} disabled={!newPhone.replace(/\D/g, '')} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed">
              + 추가
            </button>
          </div>
        </section>

        {/* 등록 회신번호 (읽기전용) */}
        <section className="bg-white rounded-lg shadow p-6 min-h-[280px]">
          <h2 className="text-lg font-semibold mb-4">등록 회신번호</h2>
          <p className="text-sm text-gray-500 mb-4">
            승인 완료된 발신번호 목록입니다. 새 번호 등록은 관리 메뉴의 '발신번호 관리'에서 신청해주세요.
          </p>

          {callbackNumbers.length > 0 ? (
            <div className="space-y-2 mb-4">
              {callbackNumbers.slice(callbackPage * callbackPageSize, (callbackPage + 1) * callbackPageSize).map((cb) => (
                <div key={cb.id} className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3">
                  <span className="flex-1 font-medium text-gray-800">
                    {cb.phone}
                    {cb.store_name && <span className="ml-2 text-sm text-gray-500">({cb.store_name})</span>}
                    {!cb.store_name && cb.label && <span className="ml-2 text-sm text-gray-500">({cb.label})</span>}
                  </span>
                  {cb.is_default && (
                    <span className="px-2 py-0.5 bg-emerald-500 text-white text-xs rounded-full">기본</span>
                  )}
                </div>
              ))}
              {callbackNumbers.length > callbackPageSize && (
                <div className="flex items-center justify-center gap-2 pt-3">
                  <button onClick={() => setCallbackPage(p => Math.max(0, p - 1))} disabled={callbackPage === 0} className="px-3 py-1 text-sm border rounded-lg disabled:opacity-30 hover:bg-gray-50">이전</button>
                  <span className="text-sm text-gray-600">{callbackPage + 1} / {Math.ceil(callbackNumbers.length / callbackPageSize)}</span>
                  <button onClick={() => setCallbackPage(p => Math.min(Math.ceil(callbackNumbers.length / callbackPageSize) - 1, p + 1))} disabled={callbackPage >= Math.ceil(callbackNumbers.length / callbackPageSize) - 1} className="px-3 py-1 text-sm border rounded-lg disabled:opacity-30 hover:bg-gray-50">다음</button>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-400">
              <p>등록된 회신번호가 없습니다</p>
              <p className="text-sm mt-1">관리 메뉴에서 발신번호 등록을 신청해주세요</p>
            </div>
          )}
        </section>

        {/* 요금 설정 - 관리자만 */}
        {isAdmin && (
        <section className="bg-white rounded-lg shadow p-6 min-h-[240px]">
          <h2 className="text-lg font-semibold mb-4">요금 설정</h2>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">월 예산 (원)</label>
              <input type="number" value={settings.monthly_budget} onChange={(e) => setSettings({ ...settings, monthly_budget: Number(e.target.value) })} className="w-full px-3 py-2 border rounded-lg" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">SMS 단가 <span className="text-gray-400">(원)</span></label>
              <input type="number" step="0.1" value={settings.cost_per_sms} disabled className="w-full px-3 py-2 border rounded-lg bg-gray-100 text-gray-500 cursor-not-allowed" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">LMS 단가 <span className="text-gray-400">(원)</span></label>
              <input type="number" step="0.1" value={settings.cost_per_lms} disabled className="w-full px-3 py-2 border rounded-lg bg-gray-100 text-gray-500 cursor-not-allowed" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">MMS 단가 <span className="text-gray-400">(원)</span></label>
              <input type="number" step="0.1" value={settings.cost_per_mms} disabled className="w-full px-3 py-2 border rounded-lg bg-gray-100 text-gray-500 cursor-not-allowed" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">카카오 단가 <span className="text-gray-400">(원)</span></label>
              <input type="number" step="0.1" value={settings.cost_per_kakao} disabled className="w-full px-3 py-2 border rounded-lg bg-gray-100 text-gray-500 cursor-not-allowed" />
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-2">※ 단가는 관리자가 설정합니다</p>
        </section>
        )}

        {/* 발송 정책 - 관리자만 */}
        {isAdmin && (
        <section className="bg-white rounded-lg shadow p-6 min-h-[240px]">
          <h2 className="text-lg font-semibold mb-4">발송 정책</h2>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">발송 시작시간</label>
              <select value={settings.send_start_hour} onChange={(e) => setSettings({ ...settings, send_start_hour: Number(e.target.value) })} className="w-full px-3 py-2 border rounded-lg">
                {Array.from({ length: 24 }, (_, i) => (<option key={i} value={i}>{i}시</option>))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">발송 종료시간</label>
              <select value={settings.send_end_hour} onChange={(e) => setSettings({ ...settings, send_end_hour: Number(e.target.value) })} className="w-full px-3 py-2 border rounded-lg">
                {Array.from({ length: 24 }, (_, i) => (<option key={i} value={i}>{i}시</option>))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">고객당 일일 한도</label>
              <input type="number" value={settings.daily_limit_per_customer} onChange={(e) => setSettings({ ...settings, daily_limit_per_customer: Number(e.target.value) })} className="w-full px-3 py-2 border rounded-lg" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">중복 방지 기간 (일)</label>
              <input type="number" value={settings.duplicate_prevention_days} onChange={(e) => setSettings({ ...settings, duplicate_prevention_days: Number(e.target.value) })} className="w-full px-3 py-2 border rounded-lg" />
            </div>
            <div className="flex items-center pt-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={settings.holiday_send_allowed} onChange={(e) => setSettings({ ...settings, holiday_send_allowed: e.target.checked })} className="rounded" />
                <span className="text-sm text-gray-700">휴일 발송 허용</span>
              </label>
            </div>
          </div>
        </section>
        )}

        </div>

        {/* 저장 버튼 */}
        <div className="flex justify-center mt-6">
          <button onClick={handleSave} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-lg font-medium disabled:opacity-50">
            {saving ? '저장 중...' : '설정 저장'}
          </button>
        </div>
      </main>

      {/* 토스트 */}
      {toast.show && (
        <div className={`fixed top-6 left-1/2 transform -translate-x-1/2 px-6 py-3 rounded-lg shadow-lg z-[100] text-sm font-medium ${
          toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
        }`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}
