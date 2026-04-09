/**
 * ★ D112: 전단AI 슈퍼관리자 대시보드
 *
 * 서비스 스위처(한줄로↔전단AI) + 통계 + 회사 생성/관리 + 사용자 생성 + POS Agent
 * 주황 테마. 한줄로 AdminDashboard.tsx와 완전 별개.
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import ServiceSwitcher from '../components/ServiceSwitcher';
import SessionTimer from '../components/SessionTimer';

interface FlyerStats {
  activeCompanies: number;
  totalUsers: number;
  totalCampaigns: number;
  totalSent: number;
  totalSuccess: number;
  totalCustomers: number;
}

interface FlyerCompany {
  id: string; company_name: string; business_type: string; owner_name: string;
  owner_phone: string; plan_type: string; payment_status: string; pos_type: string;
  created_at: string;
}

interface FlyerUser {
  id: string; login_id: string; email: string; name: string; role: string;
  company_name: string; last_login_at: string; created_at: string;
}

export default function FlyerAdminDashboard() {
  const navigate = useNavigate();
  const { token, user, logout } = useAuthStore();
  const [activeTab, setActiveTab] = useState<'dashboard' | 'companies' | 'users' | 'pos'>('dashboard');
  const [stats, setStats] = useState<FlyerStats | null>(null);
  const [companies, setCompanies] = useState<FlyerCompany[]>([]);
  const [users, setUsers] = useState<FlyerUser[]>([]);
  const [loading, setLoading] = useState(true);

  // 회사 생성 모달
  const [showCreateCompany, setShowCreateCompany] = useState(false);
  const [newCompany, setNewCompany] = useState({
    company_name: '', business_type: 'mart', owner_name: '', owner_phone: '',
    address: '', admin_login_id: '', admin_password: '', admin_name: '',
  });

  const apiFetch = useCallback(async (url: string, opts?: RequestInit) => {
    return fetch(url, { ...opts, headers: { ...opts?.headers, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
  }, [token]);

  const loadStats = useCallback(async () => {
    try {
      const res = await apiFetch('/api/admin/flyer/dashboard');
      if (res.ok) setStats(await res.json());
    } catch {} finally { setLoading(false); }
  }, [apiFetch]);

  const loadCompanies = useCallback(async () => {
    try {
      const res = await apiFetch('/api/admin/flyer/companies');
      if (res.ok) { const d = await res.json(); setCompanies(d.items || []); }
    } catch {}
  }, [apiFetch]);

  const loadUsers = useCallback(async () => {
    try {
      const res = await apiFetch('/api/admin/flyer/users');
      if (res.ok) setUsers(await res.json());
    } catch {}
  }, [apiFetch]);

  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => { if (activeTab === 'companies') loadCompanies(); }, [activeTab, loadCompanies]);
  useEffect(() => { if (activeTab === 'users') loadUsers(); }, [activeTab, loadUsers]);

  const handleCreateCompany = async () => {
    if (!newCompany.company_name || !newCompany.admin_login_id || !newCompany.admin_password) {
      alert('회사명, 관리자 아이디, 비밀번호는 필수입니다');
      return;
    }
    try {
      const res = await apiFetch('/api/admin/flyer/companies', {
        method: 'POST', body: JSON.stringify(newCompany),
      });
      if (res.ok) {
        setShowCreateCompany(false);
        setNewCompany({ company_name: '', business_type: 'mart', owner_name: '', owner_phone: '', address: '', admin_login_id: '', admin_password: '', admin_name: '' });
        loadCompanies(); loadStats();
        alert('회사가 생성되었습니다');
      } else {
        const err = await res.json();
        alert(err.error || '생성 실패');
      }
    } catch { alert('서버 오류'); }
  };

  const handleSwitchToHanjullo = async () => {
    try {
      const res = await apiFetch('/api/admin/switch-service', {
        method: 'POST', body: JSON.stringify({ to: 'hanjullo' }),
      });
      if (res.ok) {
        const data = await res.json();
        localStorage.setItem('token', data.token);
        navigate('/admin');
      }
    } catch { console.error('서비스 전환 실패'); }
  };

  const tabs = [
    { key: 'dashboard' as const, label: '대시보드', icon: '📊' },
    { key: 'companies' as const, label: '회사 관리', icon: '🏪' },
    { key: 'users' as const, label: '사용자', icon: '👤' },
    { key: 'pos' as const, label: 'POS Agent', icon: '🔌' },
  ];

  return (
    <div className="min-h-screen bg-orange-50/30">
      {/* 헤더 */}
      <header className="bg-white shadow border-b-2 border-orange-300">
        <div className="max-w-7xl mx-auto px-4 py-3 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold text-orange-700">전단AI 관리</h1>
            <ServiceSwitcher currentService="flyer" onSwitch={(to) => { if (to === 'hanjullo') handleSwitchToHanjullo(); }} />
          </div>
          <div className="flex items-center gap-4">
            <SessionTimer />
            <span className="text-sm text-gray-600">{user?.name}님</span>
            <button onClick={() => { logout(); navigate('/login'); }} className="text-sm text-gray-500 hover:text-gray-700">로그아웃</button>
          </div>
        </div>
      </header>

      {/* 전단AI 모드 배너 */}
      <div className="bg-orange-100 border-b border-orange-200 px-6 py-1.5">
        <span className="text-orange-600 text-xs font-medium">🟠 전단AI 모드 — 마트/로컬 매장 데이터를 관리합니다</span>
      </div>

      {/* 탭 메뉴 */}
      <div className="max-w-7xl mx-auto px-4 pt-4">
        <div className="flex gap-1 bg-white rounded-lg shadow p-1 mb-6">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition ${
                activeTab === t.key ? 'bg-orange-500 text-white shadow' : 'text-gray-600 hover:bg-orange-50'
              }`}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 pb-8">
        {/* 대시보드 탭 */}
        {activeTab === 'dashboard' && (
          loading ? <div className="text-center py-20 text-gray-400">로딩 중...</div> :
          stats ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <SC label="활성 마트" value={stats.activeCompanies} c="orange" />
              <SC label="전체 사용자" value={stats.totalUsers} c="blue" />
              <SC label="전체 고객" value={stats.totalCustomers.toLocaleString()} c="green" />
              <SC label="캠페인 수" value={stats.totalCampaigns} c="purple" />
              <SC label="발송 건수" value={stats.totalSent.toLocaleString()} c="indigo" />
              <SC label="성공 건수" value={stats.totalSuccess.toLocaleString()} c="emerald" />
            </div>
          ) : <div className="text-center py-20 text-red-400">데이터 로드 실패</div>
        )}

        {/* 회사 관리 탭 */}
        {activeTab === 'companies' && (
          <div>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-gray-800">전단AI 회사 목록</h2>
              <button onClick={() => setShowCreateCompany(true)}
                className="bg-orange-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-orange-600 transition">
                + 회사 생성
              </button>
            </div>

            <div className="bg-white rounded-xl shadow overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-orange-50 text-gray-600">
                  <tr>
                    <th className="text-left px-4 py-3">회사명</th>
                    <th className="text-left px-4 py-3">업태</th>
                    <th className="text-left px-4 py-3">사장님</th>
                    <th className="text-left px-4 py-3">연락처</th>
                    <th className="text-left px-4 py-3">결제상태</th>
                    <th className="text-left px-4 py-3">POS</th>
                    <th className="text-left px-4 py-3">생성일</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {companies.length === 0 ? (
                    <tr><td colSpan={7} className="text-center py-8 text-gray-400">등록된 회사가 없습니다</td></tr>
                  ) : companies.map(c => (
                    <tr key={c.id} className="hover:bg-orange-50/50">
                      <td className="px-4 py-3 font-medium">{c.company_name}</td>
                      <td className="px-4 py-3 text-gray-500">{c.business_type || '-'}</td>
                      <td className="px-4 py-3">{c.owner_name || '-'}</td>
                      <td className="px-4 py-3 text-gray-500">{c.owner_phone || '-'}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          c.payment_status === 'active' ? 'bg-green-100 text-green-700' :
                          c.payment_status === 'suspended' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'
                        }`}>{c.payment_status}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-500">{c.pos_type || '-'}</td>
                      <td className="px-4 py-3 text-gray-400 text-xs">{c.created_at?.slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 사용자 탭 */}
        {activeTab === 'users' && (
          <div>
            <h2 className="text-lg font-bold text-gray-800 mb-4">전단AI 사용자 목록</h2>
            <div className="bg-white rounded-xl shadow overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-orange-50 text-gray-600">
                  <tr>
                    <th className="text-left px-4 py-3">아이디</th>
                    <th className="text-left px-4 py-3">이름</th>
                    <th className="text-left px-4 py-3">회사</th>
                    <th className="text-left px-4 py-3">역할</th>
                    <th className="text-left px-4 py-3">마지막 로그인</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {users.length === 0 ? (
                    <tr><td colSpan={5} className="text-center py-8 text-gray-400">등록된 사용자가 없습니다</td></tr>
                  ) : users.map(u => (
                    <tr key={u.id} className="hover:bg-orange-50/50">
                      <td className="px-4 py-3 font-medium">{u.login_id || u.email}</td>
                      <td className="px-4 py-3">{u.name || '-'}</td>
                      <td className="px-4 py-3 text-gray-500">{u.company_name}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          u.role === 'flyer_admin' ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-600'
                        }`}>{u.role === 'flyer_admin' ? '관리자' : '직원'}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs">{u.last_login_at?.slice(0, 16) || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* POS Agent 탭 */}
        {activeTab === 'pos' && (
          <div className="bg-white rounded-xl shadow p-8 text-center text-gray-400">
            <p className="text-lg mb-2">🔌 POS Agent 모니터링</p>
            <p className="text-sm">Phase B에서 구현 예정</p>
            <p className="text-xs mt-2">API: /api/admin/flyer/pos-agents</p>
          </div>
        )}
      </main>

      {/* 회사 생성 모달 */}
      {showCreateCompany && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6">
            <h3 className="text-lg font-bold text-gray-800 mb-4">🏪 전단AI 회사 생성</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">마트/매장명 *</label>
                <input value={newCompany.company_name} onChange={e => setNewCompany(p => ({...p, company_name: e.target.value}))}
                  className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="○○마트" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">업태</label>
                  <select value={newCompany.business_type} onChange={e => setNewCompany(p => ({...p, business_type: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm">
                    <option value="mart">마트</option>
                    <option value="butcher">정육점</option>
                    <option value="seafood">수산</option>
                    <option value="bakery">베이커리</option>
                    <option value="cafe">카페</option>
                    <option value="other">기타</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">사장님 이름</label>
                  <input value={newCompany.owner_name} onChange={e => setNewCompany(p => ({...p, owner_name: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">연락처</label>
                <input value={newCompany.owner_phone} onChange={e => setNewCompany(p => ({...p, owner_phone: e.target.value}))}
                  className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="010-0000-0000" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">주소</label>
                <input value={newCompany.address} onChange={e => setNewCompany(p => ({...p, address: e.target.value}))}
                  className="w-full border rounded-lg px-3 py-2 text-sm" />
              </div>
              <hr className="my-2" />
              <p className="text-xs text-gray-500 font-medium">관리자 계정 (전단AI 로그인용)</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">아이디 *</label>
                  <input value={newCompany.admin_login_id} onChange={e => setNewCompany(p => ({...p, admin_login_id: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="mart_admin" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">비밀번호 *</label>
                  <input type="password" value={newCompany.admin_password} onChange={e => setNewCompany(p => ({...p, admin_password: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">관리자 이름</label>
                <input value={newCompany.admin_name} onChange={e => setNewCompany(p => ({...p, admin_name: e.target.value}))}
                  className="w-full border rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowCreateCompany(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">취소</button>
              <button onClick={handleCreateCompany}
                className="px-4 py-2 text-sm bg-orange-500 text-white rounded-lg hover:bg-orange-600 font-medium">생성</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SC({ label, value, c }: { label: string; value: number | string; c: string }) {
  const bg: Record<string, string> = { orange: 'bg-orange-50 border-orange-200', blue: 'bg-blue-50 border-blue-200', green: 'bg-green-50 border-green-200', purple: 'bg-purple-50 border-purple-200', indigo: 'bg-indigo-50 border-indigo-200', emerald: 'bg-emerald-50 border-emerald-200' };
  const tx: Record<string, string> = { orange: 'text-orange-700', blue: 'text-blue-700', green: 'text-green-700', purple: 'text-purple-700', indigo: 'text-indigo-700', emerald: 'text-emerald-700' };
  return (
    <div className={`rounded-xl border p-4 ${bg[c] || 'bg-gray-50 border-gray-200'}`}>
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className={`text-xl font-bold ${tx[c] || 'text-gray-700'}`}>{value}</div>
    </div>
  );
}
