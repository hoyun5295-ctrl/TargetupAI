import { useState, useEffect } from 'react';
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

export default function CallbacksTab() {
  const [numbers, setNumbers] = useState<CallbackNumber[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [allowSelfRegister, setAllowSelfRegister] = useState(false);

  // 등록 모달
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({
    phone: '', label: '', isDefault: false, storeCode: '', storeName: '',
  });

  // 확인 모달
  const [modal, setModal] = useState<{
    show: boolean; title: string; message: string;
    variant: 'success' | 'error' | 'warning' | 'info';
    onConfirm?: () => void;
  }>({ show: false, title: '', message: '', variant: 'info' });

  // 페이징
  const [page, setPage] = useState(1);
  const perPage = 10;

  useEffect(() => { loadNumbers(); }, []);

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

  // 페이징 계산
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
    if (!addForm.phone) {
      setToast({ msg: '발신번호를 입력해주세요.', type: 'error' });
      return;
    }
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

      <div className="bg-white rounded-lg shadow">
        {/* 헤더 */}
        <div className="px-6 py-4 border-b flex justify-between items-center">
          <h2 className="text-lg font-semibold">발신번호 관리</h2>
          {allowSelfRegister ? (
            <button onClick={() => setShowAdd(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition">
              + 발신번호 등록
            </button>
          ) : (
            <span className="text-xs text-gray-400 bg-gray-50 px-3 py-2 rounded-lg border border-dashed border-gray-300">
              🔒 발신번호 등록/삭제는 슈퍼관리자만 가능합니다
            </span>
          )}
        </div>

        {/* 검색 */}
        <div className="px-6 py-3 bg-gray-50 border-b flex items-center gap-4">
          <input
            type="text" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="🔍 발신번호, 라벨, 매장 검색..."
            className="flex-1 max-w-xs px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
          />
          <span className="text-sm text-gray-500">총 {filtered.length}건</span>
        </div>

        {/* 테이블 */}
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
                      <button onClick={() => handleSetDefault(n)}
                        className="text-xs text-gray-400 hover:text-blue-600 transition">설정</button>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                  {formatDate(n.created_at)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {allowSelfRegister ? (
                      <button onClick={() => handleDelete(n)}
                        className="px-2 py-1 text-xs bg-red-50 text-red-600 hover:bg-red-100 rounded transition">삭제</button>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 페이징 */}
        {totalPages > 1 && (
          <div className="px-6 py-3 border-t flex items-center justify-between">
            <span className="text-sm text-gray-500">
              {startIdx}~{endIdx} / {filtered.length}건
            </span>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1.5 text-sm rounded-lg border bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition">
                이전
              </button>
              {getPageNumbers().map((p, i) =>
                p === '...' ? (
                  <span key={`dots-${i}`} className="px-2 text-gray-400">…</span>
                ) : (
                  <button key={p} onClick={() => setPage(p as number)}
                    className={`px-3 py-1.5 text-sm rounded-lg transition ${p === page ? 'bg-blue-600 text-white' : 'bg-white border text-gray-600 hover:bg-gray-50'}`}>
                    {p}
                  </button>
                )
              )}
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="px-3 py-1.5 text-sm rounded-lg border bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition">
                다음
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 등록 모달 */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-[fadeIn_0.15s_ease-out]">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 animate-[zoomIn_0.2s_ease-out]">
            <div className="px-6 pt-6 pb-4 bg-gradient-to-r from-blue-50 to-indigo-50">
              <h3 className="text-lg font-bold text-gray-900">📞 발신번호 등록</h3>
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
