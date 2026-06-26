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
      active: 'bg-emerald-100 text-emerald-700',
      inactive: 'bg-slate-100 text-slate-600',
      suspended: 'bg-rose-100 text-rose-700',
    };
    const dot: Record<string, string> = { active: 'bg-emerald-500', inactive: 'bg-slate-400', suspended: 'bg-rose-500' };
    const labels: Record<string, string> = { active: '활성', inactive: '비활성', suspended: '정지' };
    return (
      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium ${colors[status] || 'bg-slate-100 text-slate-600'}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${dot[status] || 'bg-slate-400'}`} />
        {labels[status] || status}
      </span>
    );
  };

  if (loading) return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col items-center justify-center gap-3 py-16 text-slate-400">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6 animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
      <span className="text-sm">불러오는 중…</span>
    </div>
  );

  return (
    <>
      <CustomModal
        show={modal.show} title={modal.title} message={modal.message}
        variant={modal.variant} type={modal.type}
        password={modal.password} smsSent={modal.smsSent} phone={modal.phone}
        onClose={() => setModal(prev => ({ ...prev, show: false }))}
        onConfirm={modal.onConfirm}
      />

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {/* 헤더 */}
        <div className="px-6 py-5 border-b border-slate-100 flex justify-between items-center gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
            </span>
            <div>
              <h2 className="text-lg font-bold text-slate-900 tracking-tight">사용자 관리</h2>
              <p className="text-xs text-slate-400 mt-0.5">계정 추가·권한·분류 코드 관리</p>
            </div>
          </div>
          <button onClick={openAdd} className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white px-4 py-2 rounded-lg text-sm font-semibold shadow-sm shadow-indigo-600/20 transition">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
            사용자 추가
          </button>
        </div>

        {/* 검색 */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-4">
          <div className="relative flex-1 max-w-xs">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
            <input
              type="text" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="아이디, 이름, 부서로 검색"
              className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 placeholder-slate-400 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10 outline-none transition"
            />
          </div>
          <span className="text-sm text-slate-400">총 <span className="font-semibold text-slate-700 tabular-nums">{filteredUsers.length}</span>명</span>
        </div>

        {/* 테이블 */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">아이디</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">이름</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">부서</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">분류코드</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">연락처</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">상태</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">최근 로그인</th>
                <th className="px-6 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-400">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {pagedUsers.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-16 text-center text-sm text-slate-400">
                  {users.length === 0 ? '등록된 사용자가 없습니다.' : '검색 결과가 없습니다.'}
                </td></tr>
              ) : pagedUsers.map(u => (
                <tr key={u.id} className="hover:bg-slate-50/70 transition">
                  <td className="px-6 py-3.5 font-mono text-xs text-slate-600">{u.login_id}</td>
                  <td className="px-4 py-3.5 font-semibold text-slate-700">{u.name}</td>
                  <td className="px-4 py-3.5 text-slate-500">{u.department || '-'}</td>
                  <td className="px-4 py-3.5">
                    {u.store_codes ? (
                      <div className="flex flex-wrap gap-1">
                        {parseStoreCodes(u.store_codes).map(code => (
                          <span key={code} className="px-2 py-0.5 bg-indigo-50 text-indigo-600 text-xs rounded-md font-medium ring-1 ring-indigo-100">
                            {code}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">전체</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-slate-500">{u.phone || u.email || '-'}</td>
                  <td className="px-4 py-3.5">{statusBadge(u.status)}</td>
                  <td className="px-4 py-3.5 text-slate-400 text-xs tabular-nums">
                  {formatDateTime(u.last_login_at)}
                  </td>
                  <td className="px-6 py-3.5">
                    <div className="flex justify-end gap-1.5">
                      <button onClick={() => openEdit(u)}
                        className="px-2.5 py-1 text-xs font-medium bg-slate-50 text-slate-600 hover:bg-indigo-50 hover:text-indigo-600 rounded-lg transition">수정</button>
                      <button onClick={() => handleResetPassword(u)}
                        className="px-2.5 py-1 text-xs font-medium bg-slate-50 text-slate-600 hover:bg-amber-50 hover:text-amber-600 rounded-lg transition">비번 초기화</button>
                      <button onClick={() => handleDelete(u)}
                        className="px-2.5 py-1 text-xs font-medium bg-slate-50 text-slate-600 hover:bg-rose-50 hover:text-rose-600 rounded-lg transition">삭제</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 페이징 */}
        {totalPages > 1 && (
          <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between">
            <span className="text-xs text-slate-400 tabular-nums">
              {startIdx}–{endIdx} / 전체 {filteredUsers.length}명
            </span>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition">
                이전
              </button>
              {getPageNumbers().map((p, i) =>
                p === '...' ? (
                  <span key={`dots-${i}`} className="px-2 text-slate-300">…</span>
                ) : (
                  <button key={p} onClick={() => setPage(p as number)}
                    className={`min-w-[2.25rem] px-3 py-1.5 text-sm font-medium rounded-lg transition tabular-nums ${p === page ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/20' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                    {p}
                  </button>
                )
              )}
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition">
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
            <div className="px-6 py-5 bg-gradient-to-r from-indigo-50 via-white to-white border-b border-slate-100 flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm shadow-indigo-600/20">
                {editing ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6" /><path d="M22 11h-6" /></svg>
                )}
              </span>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-500">{editing ? '계정 수정' : '계정 추가'}</p>
                <h3 className="text-lg font-bold text-slate-900 tracking-tight">{editing ? '사용자 수정' : '새 사용자'}</h3>
              </div>
            </div>
            <div className="px-6 py-4 space-y-3 overflow-y-auto max-h-[60vh]">
              {!editing && (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">아이디 *</label>
                    <input value={form.loginId} onChange={(e) => setForm(f => ({ ...f, loginId: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10 outline-none transition" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">비밀번호 *</label>
                    <input type="password" value={form.password} onChange={(e) => setForm(f => ({ ...f, password: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10 outline-none transition" />
                  </div>
                </>
              )}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">이름 *</label>
                <input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10 outline-none transition" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">이메일</label>
                  <input value={form.email} onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10 outline-none transition" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">연락처</label>
                  <input value={form.phone} onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10 outline-none transition" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">부서</label>
                <input value={form.department} onChange={(e) => setForm(f => ({ ...f, department: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10 outline-none transition" />
              </div>

              {/* 담당 분류 코드 — 태그 버튼 선택 */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">담당 분류 코드</label>
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
                            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
                              isChecked
                                ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm shadow-indigo-600/20'
                                : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                            }`}
                          >
                            {code}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-xs text-slate-400 mt-2">
                      비워두면 전체 고객 조회 가능
                      {form.storeCodes.length > 0 && (
                        <span className="ml-2 text-indigo-600 font-medium">
                          선택: {form.storeCodes.join(', ')}
                        </span>
                      )}
                    </p>
                  </>
                )}
              </div>
            </div>
            <div className="px-6 py-4 flex gap-3 border-t border-slate-100">
              <button onClick={() => setShowModal(false)}
                className="flex-1 py-2.5 rounded-lg text-sm font-semibold border border-slate-200 text-slate-600 hover:bg-slate-50 transition">취소</button>
              <button onClick={handleSave}
                className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm shadow-indigo-600/20 transition">
                {editing ? '수정 저장' : '추가'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
