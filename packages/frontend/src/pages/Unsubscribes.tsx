import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDateTime } from '../utils/formatDate';

export default function Unsubscribes() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [unsubscribes, setUnsubscribes] = useState<any[]>([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, limit: 20, totalPages: 0 });
  const [search, setSearch] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState({ show: false, type: '', message: '' });
  const [deleteModal, setDeleteModal] = useState<{ show: boolean; id: string; phone: string }>({ show: false, id: '', phone: '' });
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    loadUnsubscribes();
  }, [pagination.page]);

  const loadUnsubscribes = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const params = new URLSearchParams({
        page: String(pagination.page),
        limit: String(pagination.limit),
      });
      if (search) params.append('search', search);

      const res = await fetch(`/api/unsubscribes?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setUnsubscribes(data.unsubscribes || []);
        setPagination(prev => ({ ...prev, ...data.pagination }));
      }
    } catch (error) {
      console.error('수신거부 목록 로드 실패:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    setPagination(prev => ({ ...prev, page: 1 }));
    loadUnsubscribes();
  };

  const handleAdd = async () => {
    const cleaned = newPhone.replace(/\D/g, '');
    if (cleaned.length < 10) {
      setToast({ show: true, type: 'error', message: '올바른 전화번호를 입력하세요' });
      setTimeout(() => setToast({ show: false, type: '', message: '' }), 3000);
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/unsubscribes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ phone: cleaned }),
      });
      const data = await res.json();
      if (data.success) {
        setToast({ show: true, type: 'success', message: '등록되었습니다' });
        setNewPhone('');
        loadUnsubscribes();
      } else {
        setToast({ show: true, type: 'error', message: data.error || '등록 실패' });
      }
    } catch (error) {
      setToast({ show: true, type: 'error', message: '등록 실패' });
    }
    setTimeout(() => setToast({ show: false, type: '', message: '' }), 3000);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteModal.id) return;
    setDeleting(true);

    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/unsubscribes/${deleteModal.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setToast({ show: true, type: 'success', message: '삭제되었습니다. 수신동의로 복원됩니다.' });
        loadUnsubscribes();
      }
    } catch (error) {
      setToast({ show: true, type: 'error', message: '삭제 실패' });
    } finally {
      setDeleting(false);
      setDeleteModal({ show: false, id: '', phone: '' });
    }
    setTimeout(() => setToast({ show: false, type: '', message: '' }), 3000);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter(line => line.trim());
      const phones = lines.map(line => line.split(/[,\t]/)[0].trim()).filter(p => p.replace(/\D/g, '').length >= 10);

      if (phones.length === 0) {
        setToast({ show: true, type: 'error', message: '유효한 전화번호가 없습니다' });
        setTimeout(() => setToast({ show: false, type: '', message: '' }), 3000);
        return;
      }

      const token = localStorage.getItem('token');
      const res = await fetch('/api/unsubscribes/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ phones }),
      });
      const data = await res.json();
      if (data.success) {
        setToast({ show: true, type: 'success', message: data.message });
        loadUnsubscribes();
      } else {
        setToast({ show: true, type: 'error', message: data.error || '업로드 실패' });
      }
    } catch (error) {
      setToast({ show: true, type: 'error', message: '파일 처리 실패' });
    } finally {
      setUploading(false);
      e.target.value = '';
    }
    setTimeout(() => setToast({ show: false, type: '', message: '' }), 3000);
  };

  const formatPhone = (phone: string) => {
    if (phone.length === 11) {
      return `${phone.slice(0, 3)}-${phone.slice(3, 7)}-${phone.slice(7)}`;
    }
    return phone;
  };

  const sourceLabel: Record<string, { text: string; color: string }> = {
    '080_ars': { text: '080 ARS', color: 'bg-orange-100 text-orange-700' },
    api: { text: '080 자동', color: 'bg-blue-100 text-blue-700' },
    upload: { text: '파일 업로드', color: 'bg-purple-100 text-purple-700' },
    manual: { text: '직접 입력', color: 'bg-gray-100 text-gray-700' },
    db_upload: { text: 'DB 업로드', color: 'bg-teal-100 text-teal-700' },
    sync: { text: 'Sync 연동', color: 'bg-indigo-100 text-indigo-700' },
  };

  return (
    <div className="min-h-screen bg-gray-100">
      {/* 토스트 */}
      {toast.show && (
        <div className={`fixed top-4 right-4 z-50 px-6 py-3 rounded-lg shadow-lg text-white ${
          toast.type === 'success' ? 'bg-gradient-to-r from-green-500 to-emerald-500' : 'bg-gradient-to-r from-red-500 to-rose-500'
        }`}>
          {toast.message}
        </div>
      )}

      {/* 삭제 확인 모달 */}
      {deleteModal.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => !deleting && setDeleteModal({ show: false, id: '', phone: '' })} />
          <div className="relative bg-white rounded-2xl shadow-2xl max-w-sm w-full mx-4 animate-in fade-in zoom-in duration-200">
            <div className="p-6 text-center">
              <div className="w-14 h-14 mx-auto mb-4 bg-red-100 rounded-full flex items-center justify-center">
                <svg className="w-7 h-7 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">수신거부 해제</h3>
              <p className="text-sm text-gray-600 mb-1">
                <span className="font-mono font-semibold text-gray-800">{formatPhone(deleteModal.phone)}</span>
              </p>
              <p className="text-sm text-gray-500 mb-6">
                삭제 시 해당 번호의 수신동의가 복원됩니다.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteModal({ show: false, id: '', phone: '' })}
                  disabled={deleting}
                  className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 font-medium transition-colors"
                >
                  취소
                </button>
                <button
                  onClick={handleDeleteConfirm}
                  disabled={deleting}
                  className="flex-1 px-4 py-2.5 bg-red-500 text-white rounded-xl hover:bg-red-600 font-medium transition-colors disabled:opacity-50"
                >
                  {deleting ? '처리중...' : '삭제'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <header className="bg-white shadow">
        <div className="max-w-6xl mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-xl font-bold">🚫 수신거부 관리</h1>
          <button onClick={() => navigate('/')} className="text-gray-500 hover:text-gray-700">
            ← 대시보드
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        {/* 상단 액션 영역 */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="flex flex-wrap gap-4 items-end">
            {/* 검색 */}
            <div className="flex-1 min-w-[200px]">
              <label className="block text-sm font-medium text-gray-700 mb-1">전화번호 검색</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  placeholder="010-1234-5678"
                  className="flex-1 px-3 py-2 border rounded-lg"
                />
                <button
                  onClick={handleSearch}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  검색
                </button>
              </div>
            </div>

            {/* 직접 추가 */}
            <div className="min-w-[200px]">
              <label className="block text-sm font-medium text-gray-700 mb-1">직접 추가</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                  placeholder="01012345678"
                  className="w-36 px-3 py-2 border rounded-lg"
                />
                <button
                  onClick={handleAdd}
                  className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
                >
                  추가
                </button>
              </div>
            </div>

            {/* 파일 업로드 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">파일 업로드</label>
              <label className={`inline-flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 cursor-pointer ${uploading ? 'opacity-50' : ''}`}>
                <span>📁</span>
                <span>{uploading ? '처리중...' : 'CSV/TXT'}</span>
                <input
                  type="file"
                  accept=".csv,.txt"
                  onChange={handleFileUpload}
                  disabled={uploading}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          <p className="text-xs text-gray-400 mt-3">
            ※ 080 수신거부 시 자동 등록됩니다. 파일 업로드는 한 줄에 하나의 전화번호 형식입니다.
          </p>
        </div>

        {/* 목록 */}
        <div className="bg-white rounded-lg shadow">
          <div className="p-4 border-b flex justify-between items-center">
            <h2 className="font-semibold">수신거부 목록</h2>
            <span className="text-sm text-gray-500">총 {pagination.total.toLocaleString()}건</span>
          </div>

          {loading ? (
            <div className="p-8 text-center text-gray-500">로딩 중...</div>
          ) : unsubscribes.length === 0 ? (
            <div className="p-8 text-center text-gray-400">수신거부 목록이 없습니다</div>
          ) : (
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">전화번호</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">등록 경로</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">등록일시</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">삭제</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {unsubscribes.map((item) => {
                  const src = sourceLabel[item.source] || { text: item.source, color: 'bg-gray-100 text-gray-700' };
                  return (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono">{formatPhone(item.phone)}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded text-xs ${src.color}`}>
                          {src.text}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {formatDateTime(item.created_at)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => setDeleteModal({ show: true, id: item.id, phone: item.phone })}
                          className="text-red-500 hover:text-red-700 text-sm"
                        >
                          삭제
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {/* 페이지네이션 */}
          {pagination.totalPages > 1 && (
            <div className="p-4 border-t flex justify-center gap-2">
              <button
                onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
                disabled={pagination.page === 1}
                className="px-3 py-1 border rounded hover:bg-gray-100 disabled:opacity-50"
              >
                이전
              </button>
              <span className="px-3 py-1 text-sm text-gray-600">
                {pagination.page} / {pagination.totalPages}
              </span>
              <button
                onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
                disabled={pagination.page === pagination.totalPages}
                className="px-3 py-1 border rounded hover:bg-gray-100 disabled:opacity-50"
              >
                다음
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
