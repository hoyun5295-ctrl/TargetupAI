import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';

interface SenderManager {
  id: string;
  manager_name: string;
  manager_phone: string;
  manager_email: string | null;
}

interface SenderRegistration {
  id: string;
  phone: string;
  label: string | null;
  store_code: string | null;
  store_name: string | null;
  status: string;
  reject_reason: string | null;
  created_at: string;
}

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

  // 발신번호 관리 담당자
  const [senderManagers, setSenderManagers] = useState<SenderManager[]>([]);
  const [newManagerName, setNewManagerName] = useState('');
  const [newManagerPhone, setNewManagerPhone] = useState('');
  const [newManagerEmail, setNewManagerEmail] = useState('');

  // 발신번호 등록 신청
  const [regPhone, setRegPhone] = useState('');
  const [regLabel, setRegLabel] = useState('');
  const [regStoreCode, setRegStoreCode] = useState('');
  const [regStoreName, setRegStoreName] = useState('');
  const [regNote, setRegNote] = useState('');
  const [regFiles, setRegFiles] = useState<File[]>([]);
  const [regDocTypes, setRegDocTypes] = useState<string[]>([]);
  const [regSubmitting, setRegSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 내 신청 이력
  const [myRegistrations, setMyRegistrations] = useState<SenderRegistration[]>([]);

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

      // 발신번호 관리 담당자 목록
      try {
        const mgrRes = await fetch('/api/sender-registration/managers', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const mgrData = await mgrRes.json();
        if (mgrData.success) {
          setSenderManagers(mgrData.managers || []);
        }
      } catch {}

      // 내 발신번호 등록 신청 이력
      try {
        const regRes = await fetch('/api/sender-registration/my', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const regData = await regRes.json();
        if (regData.success) {
          setMyRegistrations(regData.registrations || []);
        }
      } catch {}
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

  // === 발신번호 관리 담당자 ===
  const handleAddManager = async () => {
    if (!newManagerName.trim() || !newManagerPhone.trim()) {
      showToast('error', '담당자 이름과 전화번호는 필수입니다.');
      return;
    }
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/sender-registration/managers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ managerName: newManagerName.trim(), managerPhone: newManagerPhone.replace(/\D/g, ''), managerEmail: newManagerEmail.trim() || undefined }),
      });
      const data = await res.json();
      if (data.success) {
        setSenderManagers([data.manager, ...senderManagers]);
        setNewManagerName('');
        setNewManagerPhone('');
        setNewManagerEmail('');
        showToast('success', '담당자가 등록되었습니다.');
      } else {
        showToast('error', data.error || '등록 실패');
      }
    } catch {
      showToast('error', '담당자 등록 중 오류');
    }
  };

  const handleDeleteManager = async (id: string) => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/sender-registration/managers/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setSenderManagers(senderManagers.filter(m => m.id !== id));
        showToast('success', '담당자가 삭제되었습니다.');
      }
    } catch {
      showToast('error', '삭제 중 오류');
    }
  };

  // === 발신번호 등록 신청 ===
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setRegFiles(prev => [...prev, ...files]);
    setRegDocTypes(prev => [...prev, ...files.map(() => 'telecom_cert')]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleRemoveFile = (idx: number) => {
    setRegFiles(prev => prev.filter((_, i) => i !== idx));
    setRegDocTypes(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSubmitRegistration = async () => {
    if (!regPhone.trim()) {
      showToast('error', '발신번호를 입력해주세요.');
      return;
    }
    if (regFiles.length === 0) {
      showToast('error', '통신가입증명원 파일을 첨부해주세요.');
      return;
    }

    setRegSubmitting(true);
    try {
      const token = localStorage.getItem('token');
      const formData = new FormData();
      formData.append('phone', regPhone.trim());
      if (regLabel.trim()) formData.append('label', regLabel.trim());
      if (regStoreCode.trim()) formData.append('storeCode', regStoreCode.trim());
      if (regStoreName.trim()) formData.append('storeName', regStoreName.trim());
      if (regNote.trim()) formData.append('requestNote', regNote.trim());
      formData.append('documentTypes', JSON.stringify(regDocTypes));
      regFiles.forEach(file => formData.append('documents', file));

      const res = await fetch('/api/sender-registration', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      if (data.success) {
        showToast('success', '발신번호 등록 신청이 접수되었습니다. 승인 후 등록됩니다.');
        setRegPhone('');
        setRegLabel('');
        setRegStoreCode('');
        setRegStoreName('');
        setRegNote('');
        setRegFiles([]);
        setRegDocTypes([]);
        // 신청 이력 갱신
        setMyRegistrations([data.registration, ...myRegistrations]);
      } else {
        showToast('error', data.error || '신청 실패');
      }
    } catch {
      showToast('error', '신청 중 오류가 발생했습니다.');
    } finally {
      setRegSubmitting(false);
    }
  };

  const statusLabel = (status: string) => {
    switch (status) {
      case 'pending': return { text: '승인 대기', color: 'bg-yellow-100 text-yellow-700' };
      case 'approved': return { text: '승인 완료', color: 'bg-green-100 text-green-700' };
      case 'rejected': return { text: '반려', color: 'bg-red-100 text-red-700' };
      default: return { text: status, color: 'bg-gray-100 text-gray-700' };
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
            승인 완료된 발신번호 목록입니다. 새 번호 등록은 아래 '발신번호 등록 신청'에서 진행해주세요.
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
              <p className="text-sm mt-1">아래에서 발신번호 등록을 신청해주세요</p>
            </div>
          )}
        </section>

        {/* 발신번호 관리 담당자 */}
        <section className="bg-white rounded-lg shadow p-6 min-h-[280px]">
          <h2 className="text-lg font-semibold mb-4">발신번호 관리 담당자</h2>
          <p className="text-sm text-gray-500 mb-4">
            발신번호 등록 신청 시 연락 가능한 담당자 정보입니다.
          </p>

          {senderManagers.length > 0 && (
            <div className="space-y-2 mb-4">
              {senderManagers.map((mgr) => (
                <div key={mgr.id} className="flex items-center gap-3 bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-2.5">
                  <span className="flex-1 text-gray-800">
                    <span className="font-medium">{mgr.manager_name}</span>
                    <span className="ml-2 text-sm text-gray-500">{formatPhone(mgr.manager_phone)}</span>
                    {mgr.manager_email && <span className="ml-2 text-xs text-gray-400">{mgr.manager_email}</span>}
                  </span>
                  <button onClick={() => handleDeleteManager(mgr.id)} className="px-2.5 py-1 text-sm bg-white border border-red-300 text-red-600 rounded-lg hover:bg-red-50">삭제</button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-end gap-2">
            <div className="w-24">
              <label className="block text-sm font-medium text-gray-700 mb-1">이름 *</label>
              <input type="text" value={newManagerName} onChange={(e) => setNewManagerName(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="홍길동" />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">전화번호 *</label>
              <input type="text" value={newManagerPhone} onChange={(e) => setNewManagerPhone(e.target.value.replace(/[^\d-]/g, ''))} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="01012345678" />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">이메일</label>
              <input type="email" value={newManagerEmail} onChange={(e) => setNewManagerEmail(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="email@example.com" />
            </div>
            <button onClick={handleAddManager} disabled={!newManagerName.trim() || !newManagerPhone.replace(/\D/g, '')} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap">
              + 등록
            </button>
          </div>
        </section>

        {/* 발신번호 등록 신청 */}
        <section className="bg-white rounded-lg shadow p-6 col-span-2">
          <h2 className="text-lg font-semibold mb-4">발신번호 등록 신청</h2>
          <p className="text-sm text-gray-500 mb-4">
            통신가입증명원을 첨부하여 발신번호 등록을 신청합니다. 슈퍼관리자 확인 후 승인 시 자동으로 등록됩니다.
          </p>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">발신번호 *</label>
              <input type="text" value={regPhone} onChange={(e) => setRegPhone(e.target.value.replace(/[^\d-]/g, ''))} className="w-full px-3 py-2 border rounded-lg" placeholder="02-1234-5678" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">라벨 (별칭)</label>
              <input type="text" value={regLabel} onChange={(e) => setRegLabel(e.target.value)} className="w-full px-3 py-2 border rounded-lg" placeholder="예: 강남점 대표번호" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">매장코드</label>
              <input type="text" value={regStoreCode} onChange={(e) => setRegStoreCode(e.target.value)} className="w-full px-3 py-2 border rounded-lg" placeholder="매장코드 (선택)" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">매장명</label>
              <input type="text" value={regStoreName} onChange={(e) => setRegStoreName(e.target.value)} className="w-full px-3 py-2 border rounded-lg" placeholder="매장명 (선택)" />
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">신청 메모</label>
            <textarea value={regNote} onChange={(e) => setRegNote(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" rows={2} placeholder="특이사항이 있으면 기입해주세요" />
          </div>

          {/* 파일 첨부 */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">서류 첨부 * (통신가입증명원, 위임장 등)</label>
            <div className="flex items-center gap-3">
              <button onClick={() => fileInputRef.current?.click()} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium border border-gray-300">
                파일 선택
              </button>
              <span className="text-sm text-gray-500">{regFiles.length > 0 ? `${regFiles.length}개 파일 선택됨` : 'PDF, JPG, PNG (최대 10MB)'}</span>
              <input ref={fileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.gif,.bmp,.webp" multiple onChange={handleFileSelect} className="hidden" />
            </div>
            {regFiles.length > 0 && (
              <div className="mt-2 space-y-1">
                {regFiles.map((file, idx) => (
                  <div key={idx} className="flex items-center gap-3 bg-gray-50 border rounded-lg px-3 py-2">
                    <span className="flex-1 text-sm text-gray-700 truncate">{file.name}</span>
                    <select value={regDocTypes[idx] || 'telecom_cert'} onChange={(e) => { const newTypes = [...regDocTypes]; newTypes[idx] = e.target.value; setRegDocTypes(newTypes); }} className="text-xs border rounded px-2 py-1">
                      <option value="telecom_cert">통신가입증명원</option>
                      <option value="authorization">위임장</option>
                    </select>
                    <span className="text-xs text-gray-400">{(file.size / 1024).toFixed(0)}KB</span>
                    <button onClick={() => handleRemoveFile(idx)} className="text-red-500 hover:text-red-700 text-sm">X</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button onClick={handleSubmitRegistration} disabled={regSubmitting || !regPhone.trim() || regFiles.length === 0} className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-40 disabled:cursor-not-allowed">
            {regSubmitting ? '신청 중...' : '등록 신청'}
          </button>
        </section>

        {/* 내 신청 이력 */}
        {myRegistrations.length > 0 && (
          <section className="bg-white rounded-lg shadow p-6 col-span-2">
            <h2 className="text-lg font-semibold mb-4">발신번호 신청 이력</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium text-gray-600">발신번호</th>
                    <th className="px-4 py-2.5 text-left font-medium text-gray-600">라벨</th>
                    <th className="px-4 py-2.5 text-left font-medium text-gray-600">매장</th>
                    <th className="px-4 py-2.5 text-center font-medium text-gray-600">상태</th>
                    <th className="px-4 py-2.5 text-left font-medium text-gray-600">신청일</th>
                    <th className="px-4 py-2.5 text-left font-medium text-gray-600">사유</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {myRegistrations.map(reg => {
                    const st = statusLabel(reg.status);
                    return (
                      <tr key={reg.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 font-mono">{reg.phone}</td>
                        <td className="px-4 py-2.5 text-gray-700">{reg.label || '-'}</td>
                        <td className="px-4 py-2.5 text-gray-600">{reg.store_name || '-'}</td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${st.color}`}>{st.text}</span>
                        </td>
                        <td className="px-4 py-2.5 text-gray-500 text-xs">{new Date(reg.created_at).toLocaleDateString('ko-KR')}</td>
                        <td className="px-4 py-2.5 text-gray-500 text-xs">{reg.reject_reason || '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

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
