import { useState, useEffect } from 'react';
import { manageUsersApi } from '../../api/client';
import CustomModal from '../CustomModal';
import { useLegacyToast } from '../ToastProvider';
import { formatDateTime } from '../../utils/formatDate';

interface User {
  id: string;
  login_id: string;
  name: string;
  email: string;
  phone: string;
  department: string;
  user_type: string;
  status: string;
  store_codes: string;
  last_login_at: string;
  created_at: string;
}

export default function UsersTab() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const setToast = useLegacyToast();
  const [storeCodeList, setStoreCodeList] = useState<string[]>([]);

  // 추가/수정 모달
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [form, setForm] = useState({
    loginId: '', password: '', name: '', email: '', phone: '', department: '',
    storeCodes: [] as string[],
  });

  // 확인/알림 모달
  const [modal, setModal] = useState<{
    show: boolean; title: string; message: string;
    variant: 'success' | 'error' | 'warning' | 'info';
    type: 'alert' | 'confirm' | 'password';
    password?: string; smsSent?: boolean; phone?: string;
    onConfirm?: () => void;
  }>({ show: false, title: '', message: '', variant: 'info', type: 'alert' });

  // 페이징
  const [page, setPage] = useState(1);
  const perPage = 10;

  useEffect(() => { loadUsers(); }, []);

  const loadUsers = async () => {
    try {
      const res = await manageUsersApi.list();
      setUsers(res.data.users);
      setStoreCodeList(res.data.storeCodeList || []);
    } catch { /* */ } finally { setLoading(false); }
  };

  const filteredUsers = users.filter(u =>
    !search ||
    u.login_id.toLowerCase().includes(search.toLowerCase()) ||
    u.name.toLowerCase().includes(search.toLowerCase()) ||
    (u.department || '').toLowerCase().includes(search.toLowerCase())
  );

  // 페이징 계산
  const totalPages = Math.ceil(filteredUsers.length / perPage);
  const pagedUsers = filteredUsers.slice((page - 1) * perPage, page * perPage);
  const startIdx = (page - 1) * perPage + 1;
  const endIdx = Math.min(page * perPage, filteredUsers.length);

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

  // storeCodes 문자열 → 배열
  const parseStoreCodes = (str: string): string[] => {
    if (!str) return [];
    return str.split(',').map(s => s.trim()).filter(Boolean);
  };

  const openAdd = () => {
    setEditing(null);
    setForm({ loginId: '', password: '', name: '', email: '', phone: '', department: '', storeCodes: [] });
    setShowModal(true);
  };

  const openEdit = (u: User) => {
    setEditing(u);
    setForm({
      loginId: u.login_id, password: '', name: u.name,
      email: u.email || '', phone: u.phone || '',
      department: u.department || '',
      storeCodes: parseStoreCodes(u.store_codes),
    });
    setShowModal(true);
  };

  const toggleStoreCode = (code: string) => {
    setForm(f => ({
      ...f,
      storeCodes: f.storeCodes.includes(code)
        ? f.storeCodes.filter(c => c !== code)
        : [...f.storeCodes, code]
    }));
  };

  const handleSave = async () => {
    try {
      const storeCodesPayload = form.storeCodes.length > 0 ? form.storeCodes : null;
      if (editing) {
        await manageUsersApi.update(editing.id, {
          name: form.name, email: form.email, phone: form.phone,
          department: form.department, storeCodes: storeCodesPayload,
        });
        setToast({ msg: '수정되었습니다.', type: 'success' });
      } else {
        if (!form.loginId || !form.password || !form.name) {
          setToast({ msg: '아이디, 비밀번호, 이름은 필수입니다.', type: 'error' });
          return;
        }
        await manageUsersApi.create({
          loginId: form.loginId, password: form.password, name: form.name,
          email: form.email, phone: form.phone, department: form.department,
          storeCodes: storeCodesPayload,
        });
        setToast({ msg: '사용자가 생성되었습니다.', type: 'success' });
      }
      setShowModal(false);
      loadUsers();
    } catch (err: any) {
      setToast({ msg: err.response?.data?.error || '처리 실패', type: 'error' });
    }
  };

  const handleResetPassword = (u: User) => {
    setModal({
      show: true, title: '비밀번호 초기화', variant: 'warning', type: 'confirm',
      message: `${u.name} (${u.login_id})의 비밀번호를 초기화하시겠습니까?`,
      onConfirm: async () => {
        try {
          const res = await manageUsersApi.resetPassword(u.id);
          const d = res.data;
          setModal({
            show: true, title: '초기화 완료', variant: 'success', type: 'password',
            message: '임시 비밀번호가 발급되었습니다.',
            password: d.tempPassword, smsSent: d.smsSent, phone: d.phone,
          });
          loadUsers();
        } catch (err: any) {
          setToast({ msg: err.response?.data?.error || '초기화 실패', type: 'error' });
          setModal(prev => ({ ...prev, show: false }));
        }
      }
    });
  };

  const handleDelete = (u: User) => {
    setModal({
      show: true, title: '사용자 삭제', variant: 'error', type: 'confirm',
      message: `${u.name} (${u.login_id})을(를) 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`,
      onConfirm: async () => {
        try {
          await manageUsersApi.delete(u.id);
          setToast({ msg: '삭제되었습니다.', type: 'success' });
          setModal(prev => ({ ...prev, show: false }));
          loadUsers();
        } catch (err: any) {
          setToast({ msg: err.response?.data?.error || '삭제 실패', type: 'error' });
          setModal(prev => ({ ...prev, show: false }));
        }
      }
    });
  };

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      active: 'bg-green-100 text-green-700',
      inactive: 'bg-gray-100 text-gray-600',
      suspended: 'bg-red-100 text-red-700',
    };
    const labels: Record<string, string> = { active: '활성', inactive: '비활성', suspended: '정지' };
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] || 'bg-gray-100 text-gray-600'}`}>
        {labels[status] || status}
      </span>
    );
  };

  if (loading) return <div className="p-8 text-center text-gray-500">로딩 중...</div>;

  return (
    <>
      <CustomModal
        show={modal.show} title={modal.title} message={modal.message}
        variant={modal.variant} type={modal.type}
        password={modal.password} smsSent={modal.smsSent} phone={modal.phone}
        onClose={() => setModal(prev => ({ ...prev, show: false }))}
        onConfirm={modal.onConfirm}
      />

      <div className="bg-white rounded-lg shadow">
        {/* 헤더 */}
        <div className="px-6 py-4 border-b flex justify-between items-center">
          <h2 className="text-lg font-semibold">사용자 관리</h2>
          <button onClick={openAdd} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition">
            + 사용자 추가
          </button>
        </div>

        {/* 검색 */}
        <div className="px-6 py-3 bg-gray-50 border-b flex items-center gap-4">
          <input
            type="text" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="🔍 아이디, 이름, 부서로 검색..."
            className="flex-1 max-w-xs px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
          />
          <span className="text-sm text-gray-500">총 {filteredUsers.length}명</span>
        </div>

        {/* 테이블 */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">아이디</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">이름</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">부서</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">분류코드</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">연락처</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">상태</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">최근 로그인</th>
                <th className="px-4 py-3 text-center font-medium text-gray-600">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {pagedUsers.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-500">
                  {users.length === 0 ? '등록된 사용자가 없습니다.' : '검색 결과가 없습니다.'}
                </td></tr>
              ) : pagedUsers.map(u => (
                <tr key={u.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-sm">{u.login_id}</td>
                  <td className="px-4 py-3 font-medium">{u.name}</td>
                  <td className="px-4 py-3 text-gray-600">{u.department || '-'}</td>
                  <td className="px-4 py-3">
                    {u.store_codes ? (
                      <div className="flex flex-wrap gap-1">
                        {parseStoreCodes(u.store_codes).map(code => (
                          <span key={code} className="px-1.5 py-0.5 bg-blue-50 text-blue-700 text-xs rounded-md font-medium">
                            {code}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">전체</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{u.phone || u.email || '-'}</td>
                  <td className="px-4 py-3">{statusBadge(u.status)}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                  {formatDateTime(u.last_login_at)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex justify-center gap-1">
                      <button onClick={() => openEdit(u)}
                        className="px-2 py-1 text-xs bg-blue-50 text-blue-600 hover:bg-blue-100 rounded transition">수정</button>
                      <button onClick={() => handleResetPassword(u)}
                        className="px-2 py-1 text-xs bg-amber-50 text-amber-600 hover:bg-amber-100 rounded transition">비번초기화</button>
                      <button onClick={() => handleDelete(u)}
                        className="px-2 py-1 text-xs bg-red-50 text-red-600 hover:bg-red-100 rounded transition">삭제</button>
                    </div>
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
              {startIdx}~{endIdx} / {filteredUsers.length}명
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

      {/* 추가/수정 모달 */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-[fadeIn_0.15s_ease-out]">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 max-h-[85vh] overflow-hidden animate-[zoomIn_0.2s_ease-out]">
            <div className="px-6 pt-6 pb-4 bg-gradient-to-r from-blue-50 to-indigo-50">
              <h3 className="text-lg font-bold text-gray-900">
                {editing ? '✏️ 사용자 수정' : '👤 사용자 추가'}
              </h3>
            </div>
            <div className="px-6 py-4 space-y-3 overflow-y-auto max-h-[60vh]">
              {!editing && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">아이디 *</label>
                    <input value={form.loginId} onChange={(e) => setForm(f => ({ ...f, loginId: e.target.value }))}
                      className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">비밀번호 *</label>
                    <input type="password" value={form.password} onChange={(e) => setForm(f => ({ ...f, password: e.target.value }))}
                      className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                  </div>
                </>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">이름 *</label>
                <input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">이메일</label>
                  <input value={form.email} onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">연락처</label>
                  <input value={form.phone} onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">부서</label>
                <input value={form.department} onChange={(e) => setForm(f => ({ ...f, department: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>

              {/* 담당 분류 코드 — 태그 버튼 선택 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">담당 분류 코드</label>
                {storeCodeList.length === 0 ? (
                  <p className="text-xs text-gray-400 py-2">분류 코드가 등록되지 않았습니다 (전체 접근)</p>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-2 mt-1.5">
                      {storeCodeList.map((code: string) => {
                        const isChecked = form.storeCodes.includes(code);
                        return (
                          <button
                            key={code}
                            type="button"
                            onClick={() => toggleStoreCode(code)}
                            className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-all ${
                              isChecked
                                ? 'bg-blue-100 text-blue-800 border-blue-300 shadow-sm'
                                : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                            }`}
                          >
                            {code}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-xs text-gray-500 mt-2">
                      비워두면 전체 고객 조회 가능
                      {form.storeCodes.length > 0 && (
                        <span className="ml-2 text-blue-600 font-medium">
                          선택: {form.storeCodes.join(', ')}
                        </span>
                      )}
                    </p>
                  </>
                )}
              </div>
            </div>
            <div className="px-6 pb-6 flex gap-3">
              <button onClick={() => setShowModal(false)}
                className="flex-1 py-2.5 rounded-lg text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 transition">취소</button>
              <button onClick={handleSave}
                className="flex-1 py-2.5 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition">
                {editing ? '수정' : '추가'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
