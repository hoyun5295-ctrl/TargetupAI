import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Unsubscribes() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [unsubscribes, setUnsubscribes] = useState<any[]>([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, limit: 20, totalPages: 0 });
  const [search, setSearch] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState({ show: false, type: '', message: '' });

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

  const handleDelete = async (id: string) => {
    if (!confirm('삭제하시겠습니까?')) return;

    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/unsubscribes/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setToast({ show: true, type: 'success', message: '삭제되었습니다' });
        loadUnsubscribes();
      }
    } catch (error) {
      setToast({ show: true, type: 'error', message: '삭제 실패' });
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

  const sourceLabel: Record<string, string> = {
    api: '080 자동',
    upload: '파일 업로드',
    manual: '직접 입력',
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
            <span className="text-sm text-gray-500">총 {pagination.total}건</span>
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
                {unsubscribes.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono">{formatPhone(item.phone)}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded text-xs ${
                        item.source === 'api' ? 'bg-blue-100 text-blue-700' :
                        item.source === 'upload' ? 'bg-purple-100 text-purple-700' :
                        'bg-gray-100 text-gray-700'
                      }`}>
                        {sourceLabel[item.source] || item.source}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {new Date(item.created_at).toLocaleString('ko-KR')}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => handleDelete(item.id)}
                        className="text-red-500 hover:text-red-700 text-sm"
                      >
                        삭제
                      </button>
                    </td>
                  </tr>
                ))}
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