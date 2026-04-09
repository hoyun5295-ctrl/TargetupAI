/**
 * ★ D112: 전단AI 슈퍼관리자 대시보드
 *
 * 한줄로 AdminDashboard.tsx와 동일한 레이아웃/구조.
 * 차이: 강조색 orange + 용어 (총판/매장) + flyer_* API
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

interface Distributor {
  id: string; company_name: string; business_type: string; owner_name: string;
  owner_phone: string; plan_type: string; payment_status: string; pos_type: string;
  pos_last_sync_at: string; created_at: string;
}

interface Store {
  id: string; login_id: string; email: string; name: string; store_name: string;
  business_type: string; business_number: string; payment_status: string;
  prepaid_balance: number; monthly_fee: number; plan_started_at: string;
  plan_expires_at: string; contact_name: string; contact_phone: string;
  role: string; company_name: string; last_login_at: string; created_at: string;
}

export default function FlyerAdminDashboard() {
  const navigate = useNavigate();
  const { token, user, logout } = useAuthStore();
  const [activeTab, setActiveTab] = useState<string>('distributors');
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [stats, setStats] = useState<FlyerStats | null>(null);
  const [distributors, setDistributors] = useState<Distributor[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);

  // 총판 생성 모달
  const [showCreateDist, setShowCreateDist] = useState(false);
  const [newDist, setNewDist] = useState({
    company_name: '', business_type: 'mart', owner_name: '', owner_phone: '',
    address: '', business_number: '',
    admin_login_id: '', admin_password: '', admin_name: '',
  });

  // D113: 매장 생성 모달
  const [showCreateStore, setShowCreateStore] = useState(false);
  const [newStore, setNewStore] = useState({
    company_id: '', login_id: '', password: '', name: '', phone: '',
    business_type: 'mart', store_name: '',
    business_number: '', business_reg_name: '', business_reg_owner: '',
    business_category: '', business_item: '', business_address: '',
    tax_email: '', tax_manager_name: '', tax_manager_phone: '',
    contact_name: '', contact_phone: '', contact_email: '',
    monthly_fee: '150000', memo: '',
  });
  // D113: 업종 목록 (API)
  const [businessTypes, setBusinessTypes] = useState<{type_code: string; type_name: string}[]>([]);

  const apiFetch = useCallback(async (url: string, opts?: RequestInit) => {
    return fetch(url, { ...opts, headers: { ...opts?.headers, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
  }, [token]);

  const loadStats = useCallback(async () => {
    try {
      const res = await apiFetch('/api/admin/flyer/dashboard');
      if (res.ok) setStats(await res.json());
    } catch {} finally { setLoading(false); }
  }, [apiFetch]);

  const loadDistributors = useCallback(async () => {
    try {
      const res = await apiFetch('/api/admin/flyer/companies');
      if (res.ok) { const d = await res.json(); setDistributors(d.items || []); }
    } catch {}
  }, [apiFetch]);

  const loadStores = useCallback(async () => {
    try {
      const res = await apiFetch('/api/admin/flyer/stores');
      if (res.ok) { const d = await res.json(); setStores(d.items || []); }
    } catch {}
  }, [apiFetch]);

  const loadBusinessTypes = useCallback(async () => {
    try {
      const res = await apiFetch('/api/admin/flyer/business-types');
      if (res.ok) setBusinessTypes(await res.json());
    } catch {}
  }, [apiFetch]);

  useEffect(() => { loadStats(); loadBusinessTypes(); }, [loadStats, loadBusinessTypes]);
  useEffect(() => { if (activeTab === 'distributors') loadDistributors(); }, [activeTab, loadDistributors]);
  useEffect(() => { if (activeTab === 'stores') loadStores(); }, [activeTab, loadStores]);

  const handleCreateDist = async () => {
    if (!newDist.company_name || !newDist.admin_login_id || !newDist.admin_password) {
      alert('총판명, 관리자 아이디, 비밀번호는 필수입니다'); return;
    }
    try {
      const res = await apiFetch('/api/admin/flyer/companies', { method: 'POST', body: JSON.stringify(newDist) });
      if (res.ok) {
        setShowCreateDist(false);
        setNewDist({ company_name: '', business_type: 'mart', owner_name: '', owner_phone: '', address: '', business_number: '', admin_login_id: '', admin_password: '', admin_name: '' });
        loadDistributors(); loadStats();
        alert('총판이 생성되었습니다');
      } else { const err = await res.json(); alert(err.error || '생성 실패'); }
    } catch { alert('서버 오류'); }
  };

  // D113: 매장 생성
  const handleCreateStore = async () => {
    if (!newStore.company_id || !newStore.login_id || !newStore.password || !newStore.business_type) {
      alert('총판, 아이디, 비밀번호, 업종은 필수입니다'); return;
    }
    try {
      const body = { ...newStore, monthly_fee: parseInt(newStore.monthly_fee) || 150000 };
      const res = await apiFetch('/api/admin/flyer/stores', { method: 'POST', body: JSON.stringify(body) });
      if (res.ok) {
        setShowCreateStore(false);
        setNewStore({ company_id: '', login_id: '', password: '', name: '', phone: '', business_type: 'mart', store_name: '', business_number: '', business_reg_name: '', business_reg_owner: '', business_category: '', business_item: '', business_address: '', tax_email: '', tax_manager_name: '', tax_manager_phone: '', contact_name: '', contact_phone: '', contact_email: '', monthly_fee: '150000', memo: '' });
        loadStores(); loadStats();
        alert('매장이 생성되었습니다');
      } else { const err = await res.json(); alert(err.error || '생성 실패'); }
    } catch { alert('서버 오류'); }
  };

  // D113: 입금 확인 (활성화)
  const handleActivateStore = async (storeId: string) => {
    const months = prompt('활성화 개월 수 (기본 1):', '1');
    if (!months) return;
    try {
      const res = await apiFetch(`/api/admin/flyer/stores/${storeId}/activate`, { method: 'POST', body: JSON.stringify({ months: parseInt(months) || 1 }) });
      if (res.ok) { alert('매장이 활성화되었습니다'); loadStores(); }
      else { const err = await res.json(); alert(err.error || '활성화 실패'); }
    } catch { alert('서버 오류'); }
  };

  // D113: 잔액 충전
  const handleChargeStore = async (storeId: string) => {
    const amount = prompt('충전 금액 (원):', '100000');
    if (!amount) return;
    try {
      const res = await apiFetch(`/api/admin/flyer/stores/${storeId}/charge`, { method: 'POST', body: JSON.stringify({ amount: parseInt(amount) || 0 }) });
      if (res.ok) { const d = await res.json(); alert(`충전 완료. 잔액: ₩${Number(d.prepaid_balance).toLocaleString()}`); loadStores(); }
      else { const err = await res.json(); alert(err.error || '충전 실패'); }
    } catch { alert('서버 오류'); }
  };

  const handleSwitchToHanjullo = async () => {
    try {
      const res = await apiFetch('/api/admin/switch-service', { method: 'POST', body: JSON.stringify({ to: 'hanjullo' }) });
      if (res.ok) { const data = await res.json(); localStorage.setItem('token', data.token); navigate('/admin'); }
    } catch {}
  };

  const handleLogout = () => { logout(); navigate('/login'); };

  // 한줄로 AdminDashboard와 동일한 드롭다운 그룹 메뉴 구조
  const menuGroups = [
    {
      label: '총판 관리', color: 'orange',
      tabs: ['distributors', 'stores'],
      items: [
        { key: 'distributors', label: '총판 관리' },
        { key: 'stores', label: '매장 관리' },
      ],
    },
    {
      label: '발송 관리', color: 'emerald',
      tabs: ['campaigns', 'stats'],
      items: [
        { key: 'campaigns', label: '캠페인 내역' },
        { key: 'stats', label: '발송 통계' },
      ],
    },
    {
      label: '요금/정산', color: 'amber',
      tabs: ['billing'],
      items: [
        { key: 'billing', label: '정산 관리' },
      ],
    },
    {
      label: '시스템', color: 'gray',
      tabs: ['posAgents'],
      items: [
        { key: 'posAgents', label: 'POS Agent' },
      ],
    },
  ];

  const colorMap: Record<string, { active: string; hover: string; bg: string }> = {
    orange: { active: 'text-orange-600', hover: 'hover:text-orange-600', bg: 'bg-orange-50' },
    emerald: { active: 'text-emerald-600', hover: 'hover:text-emerald-600', bg: 'bg-emerald-50' },
    amber: { active: 'text-amber-600', hover: 'hover:text-amber-600', bg: 'bg-amber-50' },
    gray: { active: 'text-gray-700', hover: 'hover:text-gray-600', bg: 'bg-gray-50' },
  };

  return (
    <div className="min-h-screen bg-gray-100">
      {/* 헤더 — 한줄로와 동일 구조 */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold text-gray-800 cursor-pointer hover:text-orange-600 transition" onClick={() => window.location.reload()}>
              시스템 관리 <span className="text-sm font-normal text-orange-500 ml-1">전단AI</span>
            </h1>
            <ServiceSwitcher currentService="flyer" onSwitch={(to) => { if (to === 'hanjullo') handleSwitchToHanjullo(); }} />
          </div>
          <div className="flex items-center gap-4">
            <SessionTimer />
            <span className="text-sm text-gray-600">{user?.name}님</span>
            <button onClick={handleLogout} className="text-sm text-gray-500 hover:text-gray-700">로그아웃</button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* 통계 카드 — 한줄로와 동일 레이아웃 */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm text-gray-500">전체 총판</div>
            <div className="text-3xl font-bold text-gray-800">{loading ? '-' : (stats?.activeCompanies ?? 0)}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm text-gray-500">전체 매장</div>
            <div className="text-3xl font-bold text-orange-600">{loading ? '-' : (stats?.totalUsers ?? 0)}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm text-gray-500">전체 고객</div>
            <div className="text-3xl font-bold text-blue-600">{loading ? '-' : (stats?.totalCustomers ?? 0).toLocaleString()}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm text-gray-500">발송 건수</div>
            <div className="text-3xl font-bold text-green-600">{loading ? '-' : (stats?.totalSent ?? 0).toLocaleString()}</div>
          </div>
        </div>

        {/* 드롭다운 그룹 메뉴 — 한줄로와 동일 구조 */}
        <div className="bg-white rounded-lg shadow mb-6">
          <div className="border-b px-4 py-2 flex items-center gap-1">
            {menuGroups.map(group => {
              const isGroupActive = group.tabs.includes(activeTab);
              const isOpen = openMenu === group.label;
              const c = colorMap[group.color] || colorMap.orange;

              return (
                <div key={group.label} className="relative">
                  <button
                    onClick={() => setOpenMenu(isOpen ? null : group.label)}
                    onBlur={() => setTimeout(() => setOpenMenu(null), 150)}
                    className={`px-4 py-2.5 text-sm font-medium rounded-lg transition-all flex items-center gap-1.5 ${
                      isGroupActive ? `${c.active} ${c.bg}` : `text-gray-500 ${c.hover} hover:bg-gray-50`
                    }`}
                  >
                    {group.label}
                    <svg className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </button>
                  {isOpen && (
                    <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-lg border py-1 z-50 min-w-[160px]">
                      {group.items.map(item => (
                        <button key={item.key}
                          onMouseDown={() => { setActiveTab(item.key); setOpenMenu(null); }}
                          className={`w-full text-left px-4 py-2 text-sm transition ${
                            activeTab === item.key ? `${c.active} ${c.bg} font-medium` : 'text-gray-600 hover:bg-gray-50'
                          }`}
                        >{item.label}</button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="p-4">
            {/* 총판 관리 */}
            {activeTab === 'distributors' && (
              <div>
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-lg font-bold text-gray-800">총판 관리</h2>
                  <button onClick={() => setShowCreateDist(true)}
                    className="bg-orange-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-orange-600 transition">
                    + 총판 등록
                  </button>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600 border-b">
                    <tr>
                      <th className="text-left px-4 py-3">총판명</th>
                      <th className="text-left px-4 py-3">업태</th>
                      <th className="text-left px-4 py-3">담당자</th>
                      <th className="text-left px-4 py-3">연락처</th>
                      <th className="text-left px-4 py-3">상태</th>
                      <th className="text-left px-4 py-3">POS</th>
                      <th className="text-left px-4 py-3">등록일</th>
                      <th className="text-left px-4 py-3">관리</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {distributors.length === 0 ? (
                      <tr><td colSpan={8} className="text-center py-8 text-gray-400">등록된 총판이 없습니다</td></tr>
                    ) : distributors.map(d => (
                      <tr key={d.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium">{d.company_name}</td>
                        <td className="px-4 py-3 text-gray-500">{d.business_type || '-'}</td>
                        <td className="px-4 py-3">{d.owner_name || '-'}</td>
                        <td className="px-4 py-3 text-gray-500">{d.owner_phone || '-'}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            d.payment_status === 'active' ? 'bg-green-100 text-green-700' :
                            d.payment_status === 'suspended' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'
                          }`}>{d.payment_status === 'active' ? '활성' : d.payment_status === 'suspended' ? '정지' : d.payment_status}</span>
                        </td>
                        <td className="px-4 py-3 text-gray-500">{d.pos_type || '-'}</td>
                        <td className="px-4 py-3 text-gray-400 text-xs">{d.created_at?.slice(0, 10)}</td>
                        <td className="px-4 py-3">
                          <button onClick={async () => { if (!confirm(`${d.company_name} 총판을 삭제하시겠습니까?`)) return; try { const r = await apiFetch(`/api/admin/flyer/companies/${d.id}`, { method: 'DELETE' }); if (r.ok) { loadDistributors(); loadStats(); } } catch {} }} className="px-2 py-1 text-xs text-red-500 hover:bg-red-50 rounded">삭제</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* 매장 관리 — D113 강화 */}
            {activeTab === 'stores' && (
              <div>
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-lg font-bold text-gray-800">매장 관리</h2>
                  <button onClick={() => setShowCreateStore(true)} className="px-4 py-2 bg-orange-500 text-white rounded-lg text-sm font-semibold hover:bg-orange-600">+ 매장 등록</button>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600 border-b">
                    <tr>
                      <th className="text-left px-4 py-3">아이디</th>
                      <th className="text-left px-4 py-3">매장명</th>
                      <th className="text-left px-4 py-3">업종</th>
                      <th className="text-left px-4 py-3">총판</th>
                      <th className="text-left px-4 py-3">상태</th>
                      <th className="text-right px-4 py-3">잔액</th>
                      <th className="text-left px-4 py-3">등록일</th>
                      <th className="text-left px-4 py-3">관리</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {stores.length === 0 ? (
                      <tr><td colSpan={8} className="text-center py-8 text-gray-400">등록된 매장이 없습니다</td></tr>
                    ) : stores.map(s => (
                      <tr key={s.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium">{s.login_id || '-'}</td>
                        <td className="px-4 py-3">{s.store_name || s.name || '-'}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            s.business_type === 'butcher' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                          }`}>{s.business_type === 'butcher' ? '정육' : '마트'}</span>
                        </td>
                        <td className="px-4 py-3 text-gray-500">{s.company_name}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            s.payment_status === 'active' ? 'bg-green-100 text-green-700' :
                            s.payment_status === 'suspended' ? 'bg-red-100 text-red-700' :
                            'bg-yellow-100 text-yellow-700'
                          }`}>{s.payment_status === 'active' ? '활성' : s.payment_status === 'suspended' ? '정지' : '대기'}</span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-gray-600">₩{Number(s.prepaid_balance || 0).toLocaleString()}</td>
                        <td className="px-4 py-3 text-gray-400 text-xs">{s.created_at?.slice(0, 10)}</td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1">
                            {s.payment_status !== 'active' && (
                              <button onClick={() => handleActivateStore(s.id)} className="px-2 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600">입금확인</button>
                            )}
                            <button onClick={() => handleChargeStore(s.id)} className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600">충전</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* 캠페인 내역 */}
            {activeTab === 'campaigns' && (
              <div className="text-center py-12 text-gray-400">
                <p className="text-lg mb-1">캠페인 내역</p>
                <p className="text-sm">기능 개발과 함께 추가 예정</p>
              </div>
            )}

            {/* 발송 통계 */}
            {activeTab === 'stats' && (
              <div className="text-center py-12 text-gray-400">
                <p className="text-lg mb-1">발송 통계</p>
                <p className="text-sm">기능 개발과 함께 추가 예정</p>
              </div>
            )}

            {/* 정산 관리 */}
            {activeTab === 'billing' && (
              <div className="text-center py-12 text-gray-400">
                <p className="text-lg mb-1">정산 관리</p>
                <p className="text-sm">매장당 월 15만원 / 총판 수수료 5만원 — 기능 개발과 함께 추가 예정</p>
              </div>
            )}

            {/* POS Agent */}
            {activeTab === 'posAgents' && (
              <div className="text-center py-12 text-gray-400">
                <p className="text-lg mb-1">POS Agent 모니터링</p>
                <p className="text-sm">Phase B에서 구현 예정</p>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* 총판 등록 모달 */}
      {showCreateDist && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowCreateDist(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-800 mb-4">총판 등록</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">총판명 *</label>
                <input value={newDist.company_name} onChange={e => setNewDist(p => ({...p, company_name: e.target.value}))}
                  className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="○○유통" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">업태</label>
                  <select value={newDist.business_type} onChange={e => setNewDist(p => ({...p, business_type: e.target.value}))}
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">담당자명</label>
                  <input value={newDist.owner_name} onChange={e => setNewDist(p => ({...p, owner_name: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">연락처</label>
                  <input value={newDist.owner_phone} onChange={e => setNewDist(p => ({...p, owner_phone: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="010-0000-0000" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">사업자등록번호</label>
                  <input value={newDist.business_number} onChange={e => setNewDist(p => ({...p, business_number: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="000-00-00000" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">주소</label>
                <input value={newDist.address} onChange={e => setNewDist(p => ({...p, address: e.target.value}))}
                  className="w-full border rounded-lg px-3 py-2 text-sm" />
              </div>
              <hr className="my-2" />
              <p className="text-xs text-gray-500 font-medium">총판 관리자 계정</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">아이디 *</label>
                  <input value={newDist.admin_login_id} onChange={e => setNewDist(p => ({...p, admin_login_id: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="dist_admin" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">비밀번호 *</label>
                  <input type="password" value={newDist.admin_password} onChange={e => setNewDist(p => ({...p, admin_password: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">관리자 이름</label>
                <input value={newDist.admin_name} onChange={e => setNewDist(p => ({...p, admin_name: e.target.value}))}
                  className="w-full border rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowCreateDist(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">취소</button>
              <button onClick={handleCreateDist} className="px-4 py-2 text-sm bg-orange-500 text-white rounded-lg hover:bg-orange-600 font-medium">등록</button>
            </div>
          </div>
        </div>
      )}
      {/* D113: 매장 등록 모달 */}
      {showCreateStore && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 overflow-y-auto py-8" onClick={() => setShowCreateStore(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl mx-4 p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-800 mb-4">매장 등록</h3>
            <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-2">
              {/* 기본 정보 */}
              <p className="text-xs text-orange-600 font-bold">기본 정보</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">총판 *</label>
                  <select value={newStore.company_id} onChange={e => setNewStore(p => ({...p, company_id: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm">
                    <option value="">총판 선택</option>
                    {distributors.map(d => <option key={d.id} value={d.id}>{d.company_name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">업종 *</label>
                  <select value={newStore.business_type} onChange={e => setNewStore(p => ({...p, business_type: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm">
                    {businessTypes.length > 0
                      ? businessTypes.map(bt => <option key={bt.type_code} value={bt.type_code}>{bt.type_name}</option>)
                      : <><option value="mart">마트</option><option value="butcher">정육점</option></>
                    }
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">매장명</label>
                  <input value={newStore.store_name} onChange={e => setNewStore(p => ({...p, store_name: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="○○마트 ○○점" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">담당자</label>
                  <input value={newStore.name} onChange={e => setNewStore(p => ({...p, name: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">아이디 *</label>
                  <input value={newStore.login_id} onChange={e => setNewStore(p => ({...p, login_id: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="store_login" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">비밀번호 *</label>
                  <input type="password" value={newStore.password} onChange={e => setNewStore(p => ({...p, password: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>

              {/* 사업자등록증 */}
              <hr className="my-2" />
              <p className="text-xs text-orange-600 font-bold">사업자등록증</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">사업자등록번호</label>
                  <input value={newStore.business_number} onChange={e => setNewStore(p => ({...p, business_number: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="000-00-00000" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">상호</label>
                  <input value={newStore.business_reg_name} onChange={e => setNewStore(p => ({...p, business_reg_name: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">대표자</label>
                  <input value={newStore.business_reg_owner} onChange={e => setNewStore(p => ({...p, business_reg_owner: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">업태</label>
                  <input value={newStore.business_category} onChange={e => setNewStore(p => ({...p, business_category: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="도소매" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">종목</label>
                  <input value={newStore.business_item} onChange={e => setNewStore(p => ({...p, business_item: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="식료품" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">사업장 주소</label>
                <input value={newStore.business_address} onChange={e => setNewStore(p => ({...p, business_address: e.target.value}))}
                  className="w-full border rounded-lg px-3 py-2 text-sm" />
              </div>

              {/* 세금계산서 */}
              <hr className="my-2" />
              <p className="text-xs text-orange-600 font-bold">세금계산서</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">이메일</label>
                  <input value={newStore.tax_email} onChange={e => setNewStore(p => ({...p, tax_email: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="tax@company.com" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">담당자명</label>
                  <input value={newStore.tax_manager_name} onChange={e => setNewStore(p => ({...p, tax_manager_name: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">담당자 연락처</label>
                  <input value={newStore.tax_manager_phone} onChange={e => setNewStore(p => ({...p, tax_manager_phone: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="010-0000-0000" />
                </div>
              </div>

              {/* 담당자 */}
              <hr className="my-2" />
              <p className="text-xs text-orange-600 font-bold">담당자 정보</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">담당자명</label>
                  <input value={newStore.contact_name} onChange={e => setNewStore(p => ({...p, contact_name: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">연락처</label>
                  <input value={newStore.contact_phone} onChange={e => setNewStore(p => ({...p, contact_phone: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="010-0000-0000" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">이메일</label>
                  <input value={newStore.contact_email} onChange={e => setNewStore(p => ({...p, contact_email: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>

              {/* 과금 */}
              <hr className="my-2" />
              <p className="text-xs text-orange-600 font-bold">과금</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">월정액 (원)</label>
                  <input type="number" value={newStore.monthly_fee} onChange={e => setNewStore(p => ({...p, monthly_fee: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">메모</label>
                  <input value={newStore.memo} onChange={e => setNewStore(p => ({...p, memo: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowCreateStore(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">취소</button>
              <button onClick={handleCreateStore} className="px-4 py-2 text-sm bg-orange-500 text-white rounded-lg hover:bg-orange-600 font-medium">등록</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
