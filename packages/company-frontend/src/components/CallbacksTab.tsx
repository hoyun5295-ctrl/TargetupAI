import { useState, useEffect } from 'react';
import { manageCallbacksApi } from '../api/client';
import CustomModal from './CustomModal';
import Toast from './Toast';
import { formatDate } from '../utils/formatDate';

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
  company_id: string;
  phone: string;
  label: string | null;
  store_code: string | null;
  store_name: string | null;
  documents: DocumentInfo[];
  request_note: string | null;
  status: string;
  reject_reason: string | null;
  company_name: string;
  requested_by_name: string;
  reviewed_by_name: string | null;
  created_at: string;
  reviewed_at: string | null;
}

export default function CallbacksTab() {
  // 서브탭: 'numbers' = 발신번호 관리, 'pending' = 승인 대기
  const [subTab, setSubTab] = useState<'numbers' | 'pending'>('numbers');
  const [pendingCount, setPendingCount] = useState(0);

  // --- 발신번호 관리 ---
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

  // --- 승인 대기 ---
  const [registrations, setRegistrations] = useState<SenderRegistration[]>([]);
  const [regLoading, setRegLoading] = useState(false);
  const [regFilter, setRegFilter] = useState<'pending' | 'approved' | 'rejected' | ''>('pending');
  const [selectedReg, setSelectedReg] = useState<SenderRegistration | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    loadNumbers();
    loadPendingCount();
  }, []);

  useEffect(() => {
    if (subTab === 'pending') {
      loadRegistrations();
    }
  }, [subTab, regFilter]);

  // === 발신번호 관리 로직 ===
  const loadNumbers = async () => {
    try {
      const res = await manageCallbacksApi.list();
      setNumbers(res.data.callbackNumbers || []);
      setAllowSelfRegister(res.data.allowSelfRegister ?? false);
    } catch { /* */ } finally { setLoading(false); }
  };

  const filtered = numbers.filter(n =>
    !search ||
    n.phone.includes(search) ||
    (n.label || '').toLowerCase().includes(search.toLowerCase()) ||
    (n.store_name || '').toLowerCase().includes(search.toLowerCase())
  );

  const totalPages = Math.ceil(filtered.length / perPage);
  const paged = filtered.slice((page - 1) * perPage, page * perPage);
  const startIdx = (page - 1) * perPage + 1;
  const endIdx = Math.min(page * perPage, filtered.length);

  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
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

  // === 승인 대기 로직 ===
  const getToken = () => localStorage.getItem('token') || '';

  const loadPendingCount = async () => {
    try {
      const res = await fetch('/api/sender-registration/admin/pending-count', {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (data.success) setPendingCount(data.count || 0);
    } catch {}
  };

  const loadRegistrations = async () => {
    setRegLoading(true);
    try {
      const url = regFilter
        ? `/api/sender-registration/admin/all?status=${regFilter}`
        : '/api/sender-registration/admin/all';
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (data.success) setRegistrations(data.registrations || []);
    } catch {} finally { setRegLoading(false); }
  };

  const handleApprove = async (reg: SenderRegistration) => {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/sender-registration/admin/${reg.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (data.success) {
        setToast({ msg: `${reg.phone} 발신번호가 승인되어 등록되었습니다.`, type: 'success' });
        setSelectedReg(null);
        loadRegistrations();
        loadPendingCount();
        loadNumbers();
      } else {
        setToast({ msg: data.error || '승인 실패', type: 'error' });
      }
    } catch {
      setToast({ msg: '승인 처리 중 오류', type: 'error' });
    } finally { setActionLoading(false); }
  };

  const handleReject = async (reg: SenderRegistration) => {
    if (!rejectReason.trim()) {
      setToast({ msg: '반려 사유를 입력해주세요.', type: 'error' });
      return;
    }
    setActionLoading(true);
    try {
      const res = await fetch(`/api/sender-registration/admin/${reg.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ rejectReason: rejectReason.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setToast({ msg: '신청이 반려되었습니다.', type: 'success' });
        setSelectedReg(null);
        setRejectReason('');
        loadRegistrations();
        loadPendingCount();
      } else {
        setToast({ msg: data.error || '반려 실패', type: 'error' });
      }
    } catch {
      setToast({ msg: '반려 처리 중 오류', type: 'error' });
    } finally { setActionLoading(false); }
  };

  const handleDownload = (storedName: string) => {
    window.open(`/api/sender-registration/admin/download/${storedName}`, '_blank');
  };

  const statusLabel = (status: string) => {
    switch (status) {
      case 'pending': return { text: '승인 대기', color: 'bg-yellow-100 text-yellow-700' };
      case 'approved': return { text: '승인 완료', color: 'bg-green-100 text-green-700' };
      case 'rejected': return { text: '반려', color: 'bg-red-100 text-red-700' };
      default: return { text: status, color: 'bg-gray-100 text-gray-700' };
    }
  };

  const docTypeLabel = (type: string) => {
    switch (type) {
      case 'telecom_cert': return '통신가입증명원';
      case 'authorization': return '위임장';
      default: return type;
    }
  };

  if (loading) return <div className="p-8 text-center text-gray-500">로딩 중...</div>;

  return (
    <>
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      {modal.show && (
        <CustomModal
          show={modal.show} title={modal.title} message={modal.message}
          variant={modal.variant} type="confirm"
          onClose={() => setModal(prev => ({ ...prev, show: false }))}
          onConfirm={modal.onConfirm}
        />
      )}

      {/* 서브탭 전환 */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setSubTab('numbers')}
          className={`px-5 py-2.5 rounded-lg text-sm font-medium transition ${
            subTab === 'numbers'
              ? 'bg-blue-600 text-white shadow'
              : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'
          }`}
        >
          발신번호 관리
        </button>
        <button
          onClick={() => setSubTab('pending')}
          className={`px-5 py-2.5 rounded-lg text-sm font-medium transition relative ${
            subTab === 'pending'
              ? 'bg-blue-600 text-white shadow'
              : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'
          }`}
        >
          등록 신청 관리
          {pendingCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
              {pendingCount}
            </span>
          )}
        </button>
      </div>

      {/* === 발신번호 관리 탭 === */}
      {subTab === 'numbers' && (
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b flex justify-between items-center">
            <h2 className="text-lg font-semibold">발신번호 관리</h2>
            {allowSelfRegister ? (
              <button onClick={() => setShowAdd(true)}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition">
                + 발신번호 등록
              </button>
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
                  p === '...' ? (
                    <span key={`dots-${i}`} className="px-2 text-gray-400">…</span>
                  ) : (
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

      {/* === 등록 신청 관리 탭 === */}
      {subTab === 'pending' && (
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b flex justify-between items-center">
            <h2 className="text-lg font-semibold">발신번호 등록 신청 관리</h2>
            <div className="flex gap-2">
              {(['pending', 'approved', 'rejected', ''] as const).map((f) => (
                <button key={f || 'all'} onClick={() => setRegFilter(f)}
                  className={`px-3 py-1.5 text-xs rounded-lg transition ${
                    regFilter === f ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}>
                  {f === 'pending' ? '승인 대기' : f === 'approved' ? '승인 완료' : f === 'rejected' ? '반려' : '전체'}
                </button>
              ))}
            </div>
          </div>

          {regLoading ? (
            <div className="p-8 text-center text-gray-500">로딩 중...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">고객사</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">신청번호</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">라벨</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">매장</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">신청자</th>
                    <th className="px-4 py-3 text-center font-medium text-gray-600">상태</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">신청일</th>
                    <th className="px-4 py-3 text-center font-medium text-gray-600">관리</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {registrations.length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-500">
                      {regFilter === 'pending' ? '승인 대기 중인 신청이 없습니다.' : '신청 내역이 없습니다.'}
                    </td></tr>
                  ) : registrations.map(reg => {
                    const st = statusLabel(reg.status);
                    return (
                      <tr key={reg.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium">{reg.company_name}</td>
                        <td className="px-4 py-3 font-mono">{reg.phone}</td>
                        <td className="px-4 py-3 text-gray-700">{reg.label || '-'}</td>
                        <td className="px-4 py-3 text-gray-600">{reg.store_name || '-'}</td>
                        <td className="px-4 py-3 text-gray-600">{reg.requested_by_name || '-'}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${st.color}`}>{st.text}</span>
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(reg.created_at)}</td>
                        <td className="px-4 py-3 text-center">
                          <button onClick={() => { setSelectedReg(reg); setRejectReason(''); }}
                            className="px-3 py-1 text-xs bg-blue-50 text-blue-600 hover:bg-blue-100 rounded transition">
                            상세
                          </button>
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

      {/* === 신청 상세 모달 === */}
      {selectedReg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-[fadeIn_0.15s_ease-out]">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[85vh] overflow-y-auto animate-[zoomIn_0.2s_ease-out]">
            <div className="px-6 pt-6 pb-4 bg-gradient-to-r from-blue-50 to-indigo-50 border-b">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-gray-900">발신번호 등록 신청 상세</h3>
                <button onClick={() => setSelectedReg(null)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
              </div>
            </div>

            <div className="px-6 py-5 space-y-4">
              {/* 기본 정보 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-0.5">고객사</label>
                  <p className="text-sm font-medium">{selectedReg.company_name}</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-0.5">신청자</label>
                  <p className="text-sm">{selectedReg.requested_by_name}</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-0.5">발신번호</label>
                  <p className="text-sm font-mono font-bold text-blue-700">{selectedReg.phone}</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-0.5">라벨</label>
                  <p className="text-sm">{selectedReg.label || '-'}</p>
                </div>
                {selectedReg.store_name && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-0.5">매장</label>
                    <p className="text-sm">{selectedReg.store_name} {selectedReg.store_code && `(${selectedReg.store_code})`}</p>
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-0.5">상태</label>
                  <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusLabel(selectedReg.status).color}`}>
                    {statusLabel(selectedReg.status).text}
                  </span>
                </div>
              </div>

              {/* 신청 메모 */}
              {selectedReg.request_note && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">신청 메모</label>
                  <p className="text-sm bg-gray-50 rounded-lg p-3">{selectedReg.request_note}</p>
                </div>
              )}

              {/* 첨부 서류 */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-2">첨부 서류</label>
                <div className="space-y-2">
                  {(selectedReg.documents || []).map((doc, idx) => (
                    <div key={idx} className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5">
                      <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded font-medium">{docTypeLabel(doc.type)}</span>
                      <span className="flex-1 text-sm text-gray-700 truncate">{doc.originalName}</span>
                      <span className="text-xs text-gray-400">{(doc.fileSize / 1024).toFixed(0)}KB</span>
                      <button onClick={() => handleDownload(doc.storedName)}
                        className="px-2.5 py-1 text-xs bg-white border border-blue-300 text-blue-600 rounded-lg hover:bg-blue-50 font-medium">
                        다운로드
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* 반려 사유 (이미 반려된 경우) */}
              {selectedReg.status === 'rejected' && selectedReg.reject_reason && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <label className="block text-xs font-medium text-red-600 mb-1">반려 사유</label>
                  <p className="text-sm text-red-700">{selectedReg.reject_reason}</p>
                </div>
              )}

              {/* 승인/반려 액션 (pending 상태만) */}
              {selectedReg.status === 'pending' && (
                <div className="border-t pt-4 space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">반려 사유 (반려 시 필수)</label>
                    <textarea
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg text-sm"
                      rows={2}
                      placeholder="통신가입증명원과 번호가 일치하지 않습니다."
                    />
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => setSelectedReg(null)}
                      className="flex-1 py-2.5 rounded-lg text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 transition">
                      닫기
                    </button>
                    <button onClick={() => handleReject(selectedReg)} disabled={actionLoading}
                      className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition disabled:opacity-40">
                      {actionLoading ? '처리 중...' : '반려'}
                    </button>
                    <button onClick={() => handleApprove(selectedReg)} disabled={actionLoading}
                      className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-green-600 text-white hover:bg-green-700 transition disabled:opacity-40">
                      {actionLoading ? '처리 중...' : '승인'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
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
                <input value={addForm.phone} onChange={(e) => setAddForm(f => ({ ...f, phone: e.target.value }))}
                  placeholder="02-1234-5678"
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">라벨</label>
                <input value={addForm.label} onChange={(e) => setAddForm(f => ({ ...f, label: e.target.value }))}
                  placeholder="예: BLOOM 강남점"
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
                <input type="checkbox" checked={addForm.isDefault}
                  onChange={(e) => setAddForm(f => ({ ...f, isDefault: e.target.checked }))}
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
