import { useState, useEffect, useRef } from 'react';
import { manageCallbacksApi } from '../../api/client';
import CustomModal from '../CustomModal';
import Toast from '../Toast';
import { formatDate } from '../../utils/formatDate';

interface CallbackNumber {
  id: string;
  phone: string;
  label: string;
  is_default: boolean;
  store_code: string;
  store_name: string;
  created_at: string;
}

interface DocumentInfo {
  type: string;
  originalName: string;
  storedName: string;
  filePath: string;
  fileSize: number;
}

interface SenderRegistration {
  id: string;
  phone: string;
  label: string | null;
  store_code: string | null;
  store_name: string | null;
  number_type: string;
  documents: DocumentInfo[];
  request_note: string | null;
  status: string;
  reject_reason: string | null;
  created_at: string;
}

interface SenderManager {
  id: string;
  manager_name: string;
  manager_phone: string;
  manager_email: string | null;
  authorization_doc: { originalName: string; storedName: string; filePath: string; fileSize: number } | null;
  status: string; // pending | approved | rejected
  reject_reason: string | null;
}

export default function CallbacksTab() {
  // 서브탭
  const [subTab, setSubTab] = useState<'numbers' | 'register'>('numbers');

  // --- 발신번호 목록 ---
  const [numbers, setNumbers] = useState<CallbackNumber[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [allowSelfRegister, setAllowSelfRegister] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ phone: '', label: '', isDefault: false, storeCode: '', storeName: '' });
  const [modal, setModal] = useState<{ show: boolean; title: string; message: string; variant: 'success' | 'error' | 'warning' | 'info'; onConfirm?: () => void; }>({ show: false, title: '', message: '', variant: 'info' });
  const [page, setPage] = useState(1);
  const perPage = 10;

  // --- 1차: 담당자 + 위임장 ---
  const [senderManagers, setSenderManagers] = useState<SenderManager[]>([]);
  const [newMgrName, setNewMgrName] = useState('');
  const [newMgrPhone, setNewMgrPhone] = useState('');
  const [newMgrEmail, setNewMgrEmail] = useState('');
  const [mgrAuthFile, setMgrAuthFile] = useState<File | null>(null);
  const mgrFileInputRef = useRef<HTMLInputElement>(null);
  const [mgrSubmitting, setMgrSubmitting] = useState(false);

  // --- 2차: 발신번호 등록 ---
  const [hasApproved, setHasApproved] = useState(false);
  const [regPhone, setRegPhone] = useState('');
  const [regLabel, setRegLabel] = useState('');
  const [regStoreCode, setRegStoreCode] = useState('');
  const [regStoreName, setRegStoreName] = useState('');
  const [regNote, setRegNote] = useState('');
  const [regNumberType, setRegNumberType] = useState<'landline' | 'mobile'>('landline');
  const [regFiles, setRegFiles] = useState<File[]>([]);
  const [regDocTypes, setRegDocTypes] = useState<string[]>([]);
  const [regSubmitting, setRegSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 신청 이력
  const [myRegistrations, setMyRegistrations] = useState<SenderRegistration[]>([]);

  useEffect(() => { loadNumbers(); }, []);

  useEffect(() => {
    if (subTab === 'register') {
      loadRegistrations();
      loadManagers();
      checkApprovedManager();
    }
  }, [subTab]);

  const getToken = () => localStorage.getItem('token') || '';

  // === 발신번호 목록 로직 ===
  const loadNumbers = async () => {
    try {
      const res = await manageCallbacksApi.list();
      setNumbers(res.data.callbackNumbers || []);
      setAllowSelfRegister(res.data.allowSelfRegister ?? false);
    } catch { /* */ } finally { setLoading(false); }
  };

  const filtered = numbers.filter(n =>
    !search || n.phone.includes(search) || (n.label || '').toLowerCase().includes(search.toLowerCase()) || (n.store_name || '').toLowerCase().includes(search.toLowerCase())
  );
  const totalPages = Math.ceil(filtered.length / perPage);
  const paged = filtered.slice((page - 1) * perPage, page * perPage);
  const startIdx = (page - 1) * perPage + 1;
  const endIdx = Math.min(page * perPage, filtered.length);

  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    if (totalPages <= 7) { for (let i = 1; i <= totalPages; i++) pages.push(i); }
    else {
      pages.push(1);
      if (page > 3) pages.push('...');
      for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i);
      if (page < totalPages - 2) pages.push('...');
      pages.push(totalPages);
    }
    return pages;
  };

  const handleAdd = async () => {
    if (!addForm.phone) { setToast({ msg: '발신번호를 입력해주세요.', type: 'error' }); return; }
    try {
      await manageCallbacksApi.create(addForm);
      setToast({ msg: '발신번호가 등록되었습니다.', type: 'success' });
      setShowAdd(false);
      setAddForm({ phone: '', label: '', isDefault: false, storeCode: '', storeName: '' });
      loadNumbers();
    } catch (err: any) {
      setToast({ msg: err.response?.data?.error || '등록 실패', type: 'error' });
    }
  };

  const handleDelete = (n: CallbackNumber) => {
    setModal({
      show: true, title: '발신번호 삭제', variant: 'error',
      message: `${n.phone} (${n.label || '라벨 없음'})을(를) 삭제하시겠습니까?`,
      onConfirm: async () => {
        try {
          await manageCallbacksApi.delete(n.id);
          setToast({ msg: '삭제되었습니다.', type: 'success' });
          setModal(prev => ({ ...prev, show: false }));
          loadNumbers();
        } catch (err: any) {
          setToast({ msg: err.response?.data?.error || '삭제 실패', type: 'error' });
          setModal(prev => ({ ...prev, show: false }));
        }
      }
    });
  };

  const handleSetDefault = async (n: CallbackNumber) => {
    try {
      await manageCallbacksApi.setDefault(n.id);
      setToast({ msg: '대표번호로 설정되었습니다.', type: 'success' });
      loadNumbers();
    } catch (err: any) {
      setToast({ msg: err.response?.data?.error || '설정 실패', type: 'error' });
    }
  };

  // === 1차: 담당자 + 위임장 로직 ===
  const loadManagers = async () => {
    try {
      const res = await fetch('/api/sender-registration/managers', { headers: { Authorization: `Bearer ${getToken()}` } });
      const data = await res.json();
      if (data.success) setSenderManagers(data.managers || []);
    } catch {}
  };

  const checkApprovedManager = async () => {
    try {
      const res = await fetch('/api/sender-registration/has-approved-manager', { headers: { Authorization: `Bearer ${getToken()}` } });
      const data = await res.json();
      if (data.success) setHasApproved(data.hasApprovedManager);
    } catch {}
  };

  const handleAddManager = async () => {
    if (!newMgrName.trim() || !newMgrPhone.trim()) { setToast({ msg: '담당자 이름과 전화번호는 필수입니다.', type: 'error' }); return; }
    if (!mgrAuthFile) { setToast({ msg: '위임장 파일을 첨부해주세요.', type: 'error' }); return; }
    setMgrSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('managerName', newMgrName.trim());
      formData.append('managerPhone', newMgrPhone.replace(/\D/g, ''));
      if (newMgrEmail.trim()) formData.append('managerEmail', newMgrEmail.trim());
      formData.append('authorizationDoc', mgrAuthFile);

      const res = await fetch('/api/sender-registration/managers', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: formData,
      });
      const data = await res.json();
      if (data.success) {
        setSenderManagers([data.manager, ...senderManagers]);
        setNewMgrName(''); setNewMgrPhone(''); setNewMgrEmail('');
        setMgrAuthFile(null);
        if (mgrFileInputRef.current) mgrFileInputRef.current.value = '';
        setToast({ msg: '담당자 등록 및 위임장이 접수되었습니다. 관리자 승인을 기다려주세요.', type: 'success' });
      } else { setToast({ msg: data.error || '등록 실패', type: 'error' }); }
    } catch { setToast({ msg: '등록 중 오류', type: 'error' }); }
    finally { setMgrSubmitting(false); }
  };

  const handleDeleteManager = async (id: string) => {
    try {
      const res = await fetch(`/api/sender-registration/managers/${id}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (data.success) {
        setSenderManagers(senderManagers.filter(m => m.id !== id));
        setToast({ msg: '삭제되었습니다.', type: 'success' });
        checkApprovedManager();
      }
    } catch { setToast({ msg: '삭제 중 오류', type: 'error' }); }
  };

  // === 2차: 발신번호 등록 로직 ===
  const loadRegistrations = async () => {
    try {
      const res = await fetch('/api/sender-registration/my', { headers: { Authorization: `Bearer ${getToken()}` } });
      const data = await res.json();
      if (data.success) setMyRegistrations(data.registrations || []);
    } catch {}
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const defaultType = regNumberType === 'mobile' ? 'consent_form' : 'telecom_cert';
    setRegFiles(prev => [...prev, ...files]);
    setRegDocTypes(prev => [...prev, ...files.map(() => defaultType)]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleRemoveFile = (idx: number) => {
    setRegFiles(prev => prev.filter((_, i) => i !== idx));
    setRegDocTypes(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSubmitRegistration = async () => {
    if (!regPhone.trim()) { setToast({ msg: '발신번호를 입력해주세요.', type: 'error' }); return; }
    if (regFiles.length === 0) {
      const msg = regNumberType === 'mobile' ? '발신번호 사용 동의서 및 재직증명서를 첨부해주세요.' : '통신가입증명원을 첨부해주세요.';
      setToast({ msg, type: 'error' }); return;
    }
    setRegSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('phone', regPhone.trim());
      formData.append('numberType', regNumberType);
      if (regLabel.trim()) formData.append('label', regLabel.trim());
      if (regStoreCode.trim()) formData.append('storeCode', regStoreCode.trim());
      if (regStoreName.trim()) formData.append('storeName', regStoreName.trim());
      if (regNote.trim()) formData.append('requestNote', regNote.trim());
      formData.append('documentTypes', JSON.stringify(regDocTypes));
      regFiles.forEach(file => formData.append('documents', file));

      const res = await fetch('/api/sender-registration', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: formData,
      });
      const data = await res.json();
      if (data.success) {
        setToast({ msg: '발신번호 등록 신청이 접수되었습니다.', type: 'success' });
        setRegPhone(''); setRegLabel(''); setRegStoreCode(''); setRegStoreName(''); setRegNote('');
        setRegFiles([]); setRegDocTypes([]); setRegNumberType('landline');
        setMyRegistrations([data.registration, ...myRegistrations]);
      } else {
        setToast({ msg: data.error || '신청 실패', type: 'error' });
      }
    } catch {
      setToast({ msg: '신청 중 오류가 발생했습니다.', type: 'error' });
    } finally { setRegSubmitting(false); }
  };

  const formatPhone = (phone: string) => {
    const c = phone.replace(/\D/g, '');
    if (c.length === 11) return `${c.slice(0,3)}-${c.slice(3,7)}-${c.slice(7)}`;
    if (c.length === 10) return `${c.slice(0,3)}-${c.slice(3,6)}-${c.slice(6)}`;
    return phone;
  };

  const statusLabel = (status: string) => {
    switch (status) {
      case 'pending': return { text: '승인 대기', color: 'bg-yellow-100 text-yellow-700' };
      case 'approved': return { text: '승인 완료', color: 'bg-green-100 text-green-700' };
      case 'rejected': return { text: '반려', color: 'bg-red-100 text-red-700' };
      default: return { text: status, color: 'bg-gray-100 text-gray-700' };
    }
  };

  if (loading) return <div className="p-8 text-center text-gray-500">로딩 중...</div>;

  return (
    <>
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      {modal.show && (
        <CustomModal show={modal.show} title={modal.title} message={modal.message} variant={modal.variant} type="confirm"
          onClose={() => setModal(prev => ({ ...prev, show: false }))} onConfirm={modal.onConfirm} />
      )}

      {/* 서브탭 */}
      <div className="flex gap-2 mb-4">
        <button onClick={() => setSubTab('numbers')}
          className={`px-5 py-2.5 rounded-lg text-sm font-medium transition ${subTab === 'numbers' ? 'bg-blue-600 text-white shadow' : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'}`}>
          등록 발신번호
        </button>
        <button onClick={() => setSubTab('register')}
          className={`px-5 py-2.5 rounded-lg text-sm font-medium transition ${subTab === 'register' ? 'bg-blue-600 text-white shadow' : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'}`}>
          발신번호 등록 신청
        </button>
      </div>

      {/* === 등록 발신번호 탭 === */}
      {subTab === 'numbers' && (
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b flex justify-between items-center">
            <h2 className="text-lg font-semibold">등록 발신번호</h2>
            {allowSelfRegister ? (
              <button onClick={() => setShowAdd(true)}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition">+ 발신번호 등록</button>
            ) : (
              <span className="text-xs text-gray-400 bg-gray-50 px-3 py-2 rounded-lg border border-dashed border-gray-300">
                발신번호 등록/삭제는 슈퍼관리자만 가능합니다
              </span>
            )}
          </div>

          <div className="px-6 py-3 bg-gray-50 border-b flex items-center gap-4">
            <input type="text" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="발신번호, 라벨, 매장 검색..."
              className="flex-1 max-w-xs px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            <span className="text-sm text-gray-500">총 {filtered.length}건</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">발신번호</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">라벨</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">매장</th>
                  <th className="px-4 py-3 text-center font-medium text-gray-600">대표</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">등록일</th>
                  <th className="px-4 py-3 text-center font-medium text-gray-600">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {paged.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-500">
                    {numbers.length === 0 ? '등록된 발신번호가 없습니다.' : '검색 결과가 없습니다.'}
                  </td></tr>
                ) : paged.map(n => (
                  <tr key={n.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono font-medium">{n.phone}</td>
                    <td className="px-4 py-3 text-gray-700">{n.label || '-'}</td>
                    <td className="px-4 py-3 text-gray-600">{n.store_name || '-'}</td>
                    <td className="px-4 py-3 text-center">
                      {n.is_default ? (
                        <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-bold rounded-full">대표</span>
                      ) : (
                        <button onClick={() => handleSetDefault(n)} className="text-xs text-gray-400 hover:text-blue-600 transition">설정</button>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(n.created_at)}</td>
                    <td className="px-4 py-3 text-center">
                      {allowSelfRegister ? (
                        <button onClick={() => handleDelete(n)} className="px-2 py-1 text-xs bg-red-50 text-red-600 hover:bg-red-100 rounded transition">삭제</button>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="px-6 py-3 border-t flex items-center justify-between">
              <span className="text-sm text-gray-500">{startIdx}~{endIdx} / {filtered.length}건</span>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                  className="px-3 py-1.5 text-sm rounded-lg border bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition">이전</button>
                {getPageNumbers().map((p, i) =>
                  p === '...' ? <span key={`d-${i}`} className="px-2 text-gray-400">…</span> : (
                    <button key={p} onClick={() => setPage(p as number)}
                      className={`px-3 py-1.5 text-sm rounded-lg transition ${p === page ? 'bg-blue-600 text-white' : 'bg-white border text-gray-600 hover:bg-gray-50'}`}>{p}</button>
                  )
                )}
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                  className="px-3 py-1.5 text-sm rounded-lg border bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition">다음</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* === 발신번호 등록 신청 탭 === */}
      {subTab === 'register' && (
        <div className="space-y-4">

          {/* ========== 1차: 담당자 등록 + 위임장 ========== */}
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center gap-3 mb-3">
              <span className="flex items-center justify-center w-7 h-7 rounded-full bg-indigo-600 text-white text-sm font-bold">1</span>
              <h3 className="text-base font-semibold">담당자 등록 및 위임장 제출</h3>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              발신번호 등록을 위해 먼저 담당자 정보와 위임장을 제출해주세요. 관리자 승인 후 발신번호 등록이 가능합니다.
            </p>

            {/* 양식 다운로드 */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
              <p className="text-sm font-medium text-blue-800 mb-2">양식 다운로드</p>
              <a href="/templates/발신번호_등록_위임장.docx" download
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-blue-300 text-blue-700 rounded-lg text-sm hover:bg-blue-100 transition">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                위임장 양식 다운로드
              </a>
            </div>

            {/* 기존 담당자 목록 + 상태 */}
            {senderManagers.length > 0 && (
              <div className="space-y-2 mb-4">
                {senderManagers.map((mgr) => {
                  const st = statusLabel(mgr.status);
                  return (
                    <div key={mgr.id} className={`flex items-center gap-3 rounded-lg px-4 py-2.5 border ${
                      mgr.status === 'approved' ? 'bg-green-50 border-green-200' :
                      mgr.status === 'rejected' ? 'bg-red-50 border-red-200' :
                      'bg-yellow-50 border-yellow-200'
                    }`}>
                      <span className="flex-1 text-sm text-gray-800">
                        <span className="font-medium">{mgr.manager_name}</span>
                        <span className="ml-2 text-gray-500">{formatPhone(mgr.manager_phone)}</span>
                        {mgr.manager_email && <span className="ml-2 text-xs text-gray-400">{mgr.manager_email}</span>}
                      </span>
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${st.color}`}>{st.text}</span>
                      {mgr.status === 'rejected' && mgr.reject_reason && (
                        <span className="text-xs text-red-500" title={mgr.reject_reason}>반려: {mgr.reject_reason}</span>
                      )}
                      <button onClick={() => handleDeleteManager(mgr.id)}
                        className="px-2.5 py-1 text-xs bg-white border border-red-300 text-red-600 rounded-lg hover:bg-red-50">삭제</button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 담당자 등록 폼 */}
            <div className="space-y-3">
              <div className="flex items-end gap-2">
                <div className="w-24">
                  <label className="block text-xs font-medium text-gray-700 mb-1">이름 *</label>
                  <input type="text" value={newMgrName} onChange={(e) => setNewMgrName(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="홍길동" />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-700 mb-1">전화번호 *</label>
                  <input type="text" value={newMgrPhone} onChange={(e) => setNewMgrPhone(e.target.value.replace(/[^\d-]/g, ''))}
                    className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="01012345678" />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-700 mb-1">이메일</label>
                  <input type="email" value={newMgrEmail} onChange={(e) => setNewMgrEmail(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="email@example.com" />
                </div>
              </div>

              {/* 위임장 첨부 */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">위임장 첨부 *</label>
                <div className="flex items-center gap-3">
                  <button onClick={() => mgrFileInputRef.current?.click()}
                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium border border-gray-300">파일 선택</button>
                  <span className="text-sm text-gray-500">
                    {mgrAuthFile ? mgrAuthFile.name : 'PDF, JPG, PNG (최대 10MB)'}
                  </span>
                  {mgrAuthFile && (
                    <button onClick={() => { setMgrAuthFile(null); if (mgrFileInputRef.current) mgrFileInputRef.current.value = ''; }}
                      className="text-red-500 hover:text-red-700 text-sm">X</button>
                  )}
                  <input ref={mgrFileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.gif,.bmp,.webp"
                    onChange={(e) => { if (e.target.files?.[0]) setMgrAuthFile(e.target.files[0]); }} className="hidden" />
                </div>
              </div>

              <button onClick={handleAddManager}
                disabled={mgrSubmitting || !newMgrName.trim() || !newMgrPhone.replace(/\D/g, '') || !mgrAuthFile}
                className="px-5 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition">
                {mgrSubmitting ? '등록 중...' : '담당자 등록 + 위임장 제출'}
              </button>
            </div>
          </div>

          {/* ========== 2차: 발신번호 등록 신청 ========== */}
          <div className={`bg-white rounded-lg shadow p-6 ${!hasApproved ? 'opacity-60' : ''}`}>
            <div className="flex items-center gap-3 mb-3">
              <span className={`flex items-center justify-center w-7 h-7 rounded-full text-white text-sm font-bold ${hasApproved ? 'bg-indigo-600' : 'bg-gray-400'}`}>2</span>
              <h3 className="text-base font-semibold">발신번호 등록 신청</h3>
              {hasApproved && <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded-full font-medium">위임장 승인 완료</span>}
            </div>

            {!hasApproved ? (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-center">
                <p className="text-sm text-yellow-800 font-medium">먼저 1단계 담당자 등록 및 위임장 승인을 완료해주세요.</p>
                <p className="text-xs text-yellow-600 mt-1">위임장이 관리자에 의해 승인되면 발신번호 등록이 가능합니다.</p>
              </div>
            ) : (
              <>
                <p className="text-sm text-gray-500 mb-4">번호 유형에 맞는 서류를 첨부하여 발신번호 등록을 신청합니다. 관리자 확인 후 승인 시 자동 등록됩니다.</p>

                {/* 번호 유형 선택 */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">번호 유형 *</label>
                  <div className="flex gap-3">
                    <label className={`flex-1 cursor-pointer border-2 rounded-lg p-3 transition ${
                      regNumberType === 'landline' ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'
                    }`}>
                      <input type="radio" name="numberType" value="landline" checked={regNumberType === 'landline'}
                        onChange={() => { setRegNumberType('landline'); setRegFiles([]); setRegDocTypes([]); }}
                        className="sr-only" />
                      <span className="text-sm font-medium text-gray-900">일반번호 (유선전화)</span>
                      <p className="text-xs text-gray-500 mt-0.5">02, 031 등 일반 전화번호</p>
                    </label>
                    <label className={`flex-1 cursor-pointer border-2 rounded-lg p-3 transition ${
                      regNumberType === 'mobile' ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'
                    }`}>
                      <input type="radio" name="numberType" value="mobile" checked={regNumberType === 'mobile'}
                        onChange={() => { setRegNumberType('mobile'); setRegFiles([]); setRegDocTypes([]); }}
                        className="sr-only" />
                      <span className="text-sm font-medium text-gray-900">임직원 개인 휴대폰번호</span>
                      <p className="text-xs text-gray-500 mt-0.5">010 등 개인 명의 휴대폰</p>
                    </label>
                  </div>
                </div>

                {/* 번호 유형별 안내 + 양식 다운로드 */}
                <div className={`rounded-lg p-3 mb-4 border ${regNumberType === 'landline' ? 'bg-gray-50 border-gray-200' : 'bg-orange-50 border-orange-200'}`}>
                  {regNumberType === 'landline' ? (
                    <div>
                      <p className="text-sm font-medium text-gray-800">필요 서류: 통신가입증명원</p>
                      <p className="text-xs text-gray-500 mt-1">해당 번호의 통신사에서 발급받은 통신가입증명원을 첨부해주세요.</p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-sm font-medium text-orange-800">필요 서류: 발신번호 사용 동의서 + 재직증명서</p>
                      <p className="text-xs text-orange-600 mt-1">개인 휴대폰번호 등록 시 발신번호 사용 동의서와 재직증명서를 함께 첨부해주세요. 재직증명서는 자체 양식으로 준비해주세요.</p>
                      <div className="mt-2">
                        <a href="/templates/발신번호_사용_동의서.docx" download
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-orange-300 text-orange-700 rounded-lg text-sm hover:bg-orange-100 transition">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                          발신번호 사용 동의서 양식 다운로드
                        </a>
                      </div>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">발신번호 *</label>
                    <input type="text" value={regPhone} onChange={(e) => setRegPhone(e.target.value.replace(/[^\d-]/g, ''))}
                      className="w-full px-3 py-2 border rounded-lg" placeholder={regNumberType === 'mobile' ? '010-1234-5678' : '02-1234-5678'} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">라벨 (별칭)</label>
                    <input type="text" value={regLabel} onChange={(e) => setRegLabel(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg" placeholder="예: 강남점 대표번호" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">매장코드</label>
                    <input type="text" value={regStoreCode} onChange={(e) => setRegStoreCode(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg" placeholder="매장코드 (선택)" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">매장명</label>
                    <input type="text" value={regStoreName} onChange={(e) => setRegStoreName(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg" placeholder="매장명 (선택)" />
                  </div>
                </div>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">신청 메모</label>
                  <textarea value={regNote} onChange={(e) => setRegNote(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg text-sm" rows={2} placeholder="특이사항이 있으면 기입해주세요" />
                </div>

                {/* 파일 첨부 */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    서류 첨부 * {regNumberType === 'landline'
                      ? '(통신가입증명원)'
                      : '(발신번호 사용 동의서 + 재직증명서)'}
                  </label>
                  <div className="flex items-center gap-3">
                    <button onClick={() => fileInputRef.current?.click()}
                      className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium border border-gray-300">파일 선택</button>
                    <span className="text-sm text-gray-500">{regFiles.length > 0 ? `${regFiles.length}개 파일 선택됨` : 'PDF, JPG, PNG (최대 10MB)'}</span>
                    <input ref={fileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.gif,.bmp,.webp,.docx" multiple onChange={handleFileSelect} className="hidden" />
                  </div>
                  {regFiles.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {regFiles.map((file, idx) => (
                        <div key={idx} className="flex items-center gap-3 bg-gray-50 border rounded-lg px-3 py-2">
                          <span className="flex-1 text-sm text-gray-700 truncate">{file.name}</span>
                          <select value={regDocTypes[idx] || 'telecom_cert'} onChange={(e) => { const t = [...regDocTypes]; t[idx] = e.target.value; setRegDocTypes(t); }}
                            className="text-xs border rounded px-2 py-1">
                            {regNumberType === 'landline' ? (
                              <option value="telecom_cert">통신가입증명원</option>
                            ) : (
                              <>
                                <option value="consent_form">발신번호 사용 동의서</option>
                                <option value="employment_cert">재직증명서</option>
                              </>
                            )}
                          </select>
                          <span className="text-xs text-gray-400">{(file.size / 1024).toFixed(0)}KB</span>
                          <button onClick={() => handleRemoveFile(idx)} className="text-red-500 hover:text-red-700 text-sm">X</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <button onClick={handleSubmitRegistration} disabled={regSubmitting || !regPhone.trim() || regFiles.length === 0}
                  className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-40 disabled:cursor-not-allowed">
                  {regSubmitting ? '신청 중...' : '등록 신청'}
                </button>
              </>
            )}
          </div>

          {/* 신청 이력 */}
          {myRegistrations.length > 0 && (
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-base font-semibold mb-3">신청 이력</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-4 py-2.5 text-left font-medium text-gray-600">발신번호</th>
                      <th className="px-4 py-2.5 text-left font-medium text-gray-600">유형</th>
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
                          <td className="px-4 py-2.5 text-gray-600 text-xs">
                            {reg.number_type === 'mobile' ? '휴대폰' : '일반번호'}
                          </td>
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
            </div>
          )}
        </div>
      )}

      {/* 등록 모달 (기존) */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-[fadeIn_0.15s_ease-out]">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 animate-[zoomIn_0.2s_ease-out]">
            <div className="px-6 pt-6 pb-4 bg-gradient-to-r from-blue-50 to-indigo-50">
              <h3 className="text-lg font-bold text-gray-900">발신번호 등록</h3>
            </div>
            <div className="px-6 py-4 space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">발신번호 *</label>
                <input value={addForm.phone} onChange={(e) => setAddForm(f => ({ ...f, phone: e.target.value }))} placeholder="02-1234-5678"
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">라벨</label>
                <input value={addForm.label} onChange={(e) => setAddForm(f => ({ ...f, label: e.target.value }))} placeholder="예: BLOOM 강남점"
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">매장코드</label>
                  <input value={addForm.storeCode} onChange={(e) => setAddForm(f => ({ ...f, storeCode: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">매장명</label>
                  <input value={addForm.storeName} onChange={(e) => setAddForm(f => ({ ...f, storeName: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={addForm.isDefault} onChange={(e) => setAddForm(f => ({ ...f, isDefault: e.target.checked }))}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                <span className="text-sm text-gray-700">대표번호로 설정</span>
              </label>
            </div>
            <div className="px-6 pb-6 flex gap-3">
              <button onClick={() => setShowAdd(false)}
                className="flex-1 py-2.5 rounded-lg text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 transition">취소</button>
              <button onClick={handleAdd}
                className="flex-1 py-2.5 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition">등록</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
