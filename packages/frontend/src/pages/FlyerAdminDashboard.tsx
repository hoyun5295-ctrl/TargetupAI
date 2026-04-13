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

  // ★ D114: 커스텀 토스트 (alert 교체)
  const [toast, setToast] = useState<{ show: boolean; type: 'success' | 'error'; message: string }>({ show: false, type: 'success', message: '' });
  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ show: true, type, message });
    setTimeout(() => setToast({ show: false, type: 'success', message: '' }), 3000);
  };

  // 총판 생성 모달
  const [showCreateDist, setShowCreateDist] = useState(false);
  const [newDist, setNewDist] = useState({
    company_name: '', business_type: 'mart', owner_name: '', owner_phone: '',
    address: '', business_number: '',
    // ★ D114: 사업자등록증 전체 필드 추가
    business_reg_name: '', business_reg_owner: '',
    business_category: '', business_item: '', business_address: '',
    tax_email: '', tax_manager_name: '', tax_manager_phone: '',
    admin_login_id: '', admin_password: '', admin_name: '',
  });

  // ★ D114: 총판 수정 모달 신설
  const [editDist, setEditDist] = useState<Distributor | null>(null);
  const [editDistForm, setEditDistForm] = useState<Record<string, string>>({});

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

  // ★ POS Agent 상태 목록
  const [posAgents, setPosAgents] = useState<Array<{
    agentId: string; companyId: string; companyName: string; storeName: string;
    syncStatus: string; lastSyncAt: string | null; lastHeartbeat: string | null;
    posType: string; dbType: string; errorCount: number;
  }>>([]);
  const [posLoading, setPosLoading] = useState(false);

  const loadPosAgents = useCallback(async () => {
    setPosLoading(true);
    try {
      const res = await apiFetch('/api/flyer/pos/agents');
      if (res.ok) setPosAgents(await res.json());
    } catch {} finally { setPosLoading(false); }
  }, [apiFetch]);

  useEffect(() => { loadStats(); loadBusinessTypes(); }, [loadStats, loadBusinessTypes]);
  useEffect(() => { if (activeTab === 'distributors') loadDistributors(); }, [activeTab, loadDistributors]);
  useEffect(() => { if (activeTab === 'stores') loadStores(); }, [activeTab, loadStores]);
  useEffect(() => { if (activeTab === 'posAgents') loadPosAgents(); }, [activeTab, loadPosAgents]);

  const handleCreateDist = async () => {
    if (!newDist.company_name || !newDist.admin_login_id || !newDist.admin_password) {
      showToast('error', '총판명, 관리자 아이디, 비밀번호는 필수입니다'); return;
    }
    try {
      const res = await apiFetch('/api/admin/flyer/companies', { method: 'POST', body: JSON.stringify(newDist) });
      if (res.ok) {
        setShowCreateDist(false);
        setNewDist({ company_name: '', business_type: 'mart', owner_name: '', owner_phone: '', address: '', business_number: '', business_reg_name: '', business_reg_owner: '', business_category: '', business_item: '', business_address: '', tax_email: '', tax_manager_name: '', tax_manager_phone: '', admin_login_id: '', admin_password: '', admin_name: '' });
        loadDistributors(); loadStats();
        showToast('success', '총판이 생성되었습니다');
      } else { const err = await res.json(); showToast('error', err.error || '생성 실패'); }
    } catch { showToast('error', '서버 오류'); }
  };

  // D113: 매장 생성
  const handleCreateStore = async () => {
    if (!newStore.company_id || !newStore.login_id || !newStore.password || !newStore.business_type) {
      showToast('error', '총판, 아이디, 비밀번호, 업종은 필수입니다'); return;
    }
    try {
      const body = { ...newStore, monthly_fee: parseInt(newStore.monthly_fee) || 150000 };
      const res = await apiFetch('/api/admin/flyer/stores', { method: 'POST', body: JSON.stringify(body) });
      if (res.ok) {
        setShowCreateStore(false);
        setNewStore({ company_id: '', login_id: '', password: '', name: '', phone: '', business_type: 'mart', store_name: '', business_number: '', business_reg_name: '', business_reg_owner: '', business_category: '', business_item: '', business_address: '', tax_email: '', tax_manager_name: '', tax_manager_phone: '', contact_name: '', contact_phone: '', contact_email: '', monthly_fee: '150000', memo: '' });
        loadStores(); loadStats();
        showToast('success', '매장이 생성되었습니다');
      } else { const err = await res.json(); showToast('error', err.error || '생성 실패'); }
    } catch { showToast('error', '서버 오류'); }
  };

  // D113: 입금확인/충전 모달
  const [actionModal, setActionModal] = useState<{ type: 'activate' | 'charge' | 'delete_dist' | null; storeId?: string; distId?: string; storeName?: string }>({ type: null });
  const [actionValue, setActionValue] = useState('');
  const [actionResult, setActionResult] = useState('');

  const openActivateModal = (storeId: string, storeName: string) => { setActionModal({ type: 'activate', storeId, storeName }); setActionValue('150000'); setActionResult(''); };
  const openChargeModal = (storeId: string, storeName: string) => { setActionModal({ type: 'charge', storeId, storeName }); setActionValue('100000'); setActionResult(''); };
  const openDeleteDistModal = (distId: string, storeName: string) => { setActionModal({ type: 'delete_dist', distId, storeName }); setActionResult(''); };

  const handleActionSubmit = async () => {
    try {
      if (actionModal.type === 'activate' && actionModal.storeId) {
        const res = await apiFetch(`/api/admin/flyer/stores/${actionModal.storeId}/activate`, { method: 'POST', body: JSON.stringify({ amount: parseInt(actionValue) || 0 }) });
        if (res.ok) { const d = await res.json(); setActionResult(d.message || '충전 완료'); loadStores(); loadStats(); setTimeout(() => setActionModal({ type: null }), 1500); }
        else { const err = await res.json(); setActionResult(err.error || '실패'); }
      } else if (actionModal.type === 'charge' && actionModal.storeId) {
        const res = await apiFetch(`/api/admin/flyer/stores/${actionModal.storeId}/charge`, { method: 'POST', body: JSON.stringify({ amount: parseInt(actionValue) || 0 }) });
        if (res.ok) { const d = await res.json(); setActionResult(`충전 완료. 잔액: ₩${Number(d.prepaid_balance).toLocaleString()}`); loadStores(); setTimeout(() => setActionModal({ type: null }), 1500); }
        else { const err = await res.json(); setActionResult(err.error || '실패'); }
      } else if (actionModal.type === 'delete_dist' && actionModal.distId) {
        const res = await apiFetch(`/api/admin/flyer/companies/${actionModal.distId}`, { method: 'DELETE' });
        if (res.ok) { setActionResult('삭제 완료'); loadDistributors(); loadStats(); setTimeout(() => setActionModal({ type: null }), 1000); }
        else { setActionResult('삭제 실패'); }
      }
    } catch { setActionResult('서버 오류'); }
  };

  // D113: 매장 수정
  const [editStore, setEditStore] = useState<Store | null>(null);
  const [editStoreForm, setEditStoreForm] = useState<Record<string, string>>({});

  const handleEditStore = (s: Store) => {
    setEditStore(s);
    setEditStoreForm({
      store_name: s.store_name || '', business_type: s.business_type || 'mart',
      business_number: s.business_number || '', contact_name: s.contact_name || '',
      contact_phone: s.contact_phone || '', monthly_fee: String(s.monthly_fee || 150000),
      payment_status: s.payment_status || 'pending',
    });
  };

  const handleSaveEditStore = async () => {
    if (!editStore) return;
    try {
      const body: Record<string, any> = { ...editStoreForm };
      if (body.monthly_fee) body.monthly_fee = parseInt(body.monthly_fee) || 150000;
      const res = await apiFetch(`/api/admin/flyer/stores/${editStore.id}`, { method: 'PUT', body: JSON.stringify(body) });
      if (res.ok) { setEditStore(null); loadStores(); showToast('success', '수정되었습니다'); }
      else { const err = await res.json(); showToast('error', err.error || '수정 실패'); }
    } catch { showToast('error', '서버 오류'); }
  };

  // ★ D114: 총판 수정
  const handleEditDist = (d: Distributor) => {
    setEditDist(d);
    setEditDistForm({
      company_name: d.company_name || '', business_type: d.business_type || 'mart',
      owner_name: d.owner_name || '', owner_phone: d.owner_phone || '',
      business_number: (d as any).business_number || '',
      address: (d as any).address || '',
      business_reg_name: (d as any).business_reg_name || '',
      business_reg_owner: (d as any).business_reg_owner || '',
      business_category: (d as any).business_category || '',
      business_item: (d as any).business_item || '',
      business_address: (d as any).business_address || '',
      tax_email: (d as any).tax_email || '',
      tax_manager_name: (d as any).tax_manager_name || '',
      tax_manager_phone: (d as any).tax_manager_phone || '',
      payment_status: d.payment_status || 'pending',
    });
  };
  const handleSaveEditDist = async () => {
    if (!editDist) return;
    try {
      const res = await apiFetch(`/api/admin/flyer/companies/${editDist.id}`, { method: 'PUT', body: JSON.stringify(editDistForm) });
      if (res.ok) { setEditDist(null); loadDistributors(); showToast('success', '총판 정보가 수정되었습니다'); }
      else { const err = await res.json(); showToast('error', err.error || '수정 실패'); }
    } catch { showToast('error', '서버 오류'); }
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
                          <div className="flex gap-1">
                            <button onClick={() => handleEditDist(d)} className="px-2 py-1 text-xs bg-gray-500 text-white rounded hover:bg-gray-600">수정</button>
                            <button onClick={() => openDeleteDistModal(d.id, d.company_name)} className="px-2 py-1 text-xs text-red-500 hover:bg-red-50 rounded">삭제</button>
                          </div>
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
                              <button onClick={() => openActivateModal(s.id, s.store_name || s.name)} className="px-2 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600">입금확인</button>
                            )}
                            <button onClick={() => openChargeModal(s.id, s.store_name || s.name)} className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600">충전</button>
                            <button onClick={() => handleEditStore(s)} className="px-2 py-1 text-xs bg-gray-500 text-white rounded hover:bg-gray-600">수정</button>
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
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-gray-800">POS Agent 모니터링</h3>
                  <button onClick={loadPosAgents} className="text-sm text-orange-600 hover:text-orange-700 font-medium">새로고침</button>
                </div>
                {posLoading ? <div className="text-center py-8 text-gray-400">로딩 중...</div> :
                posAgents.length === 0 ? <div className="text-center py-12 text-gray-400"><p className="text-lg mb-1">등록된 POS Agent 없음</p><p className="text-sm">매장에 POS Agent를 설치하면 여기에 표시됩니다.</p></div> : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 text-gray-600">
                        <tr>
                          <th className="px-4 py-3 text-left font-medium">총판/매장</th>
                          <th className="px-4 py-3 text-left font-medium">POS 종류</th>
                          <th className="px-4 py-3 text-center font-medium">상태</th>
                          <th className="px-4 py-3 text-left font-medium">마지막 동기화</th>
                          <th className="px-4 py-3 text-left font-medium">마지막 하트비트</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {posAgents.map(a => (
                          <tr key={a.agentId} className="hover:bg-gray-50">
                            <td className="px-4 py-3">
                              <div className="font-semibold text-gray-800">{a.storeName || a.companyName}</div>
                              <div className="text-xs text-gray-400">{a.companyName}</div>
                            </td>
                            <td className="px-4 py-3 text-gray-600">{a.posType || '-'} / {a.dbType || '-'}</td>
                            <td className="px-4 py-3 text-center">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
                                a.syncStatus === 'connected' ? 'bg-green-100 text-green-700' :
                                a.syncStatus === 'error' ? 'bg-red-100 text-red-700' :
                                'bg-gray-100 text-gray-600'
                              }`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${
                                  a.syncStatus === 'connected' ? 'bg-green-500' :
                                  a.syncStatus === 'error' ? 'bg-red-500' : 'bg-gray-400'
                                }`} />
                                {a.syncStatus === 'connected' ? '연결됨' : a.syncStatus === 'error' ? '오류' : '대기'}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-gray-500 text-xs">{a.lastSyncAt ? new Date(a.lastSyncAt).toLocaleString('ko') : '-'}</td>
                            <td className="px-4 py-3 text-gray-500 text-xs">{a.lastHeartbeat ? new Date(a.lastHeartbeat).toLocaleString('ko') : '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* 총판 등록 모달 */}
      {showCreateDist && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowCreateDist(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-800 px-6 pt-6 pb-3 shrink-0">총판 등록</h3>
            <div className="space-y-3 overflow-y-auto px-6 flex-1">
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
              {/* ★ D114: 사업자등록증 전체 필드 추가 */}
              <hr className="my-2" />
              <p className="text-xs text-orange-600 font-bold">사업자등록증</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">상호</label>
                  <input value={newDist.business_reg_name} onChange={e => setNewDist(p => ({...p, business_reg_name: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">대표자</label>
                  <input value={newDist.business_reg_owner} onChange={e => setNewDist(p => ({...p, business_reg_owner: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">업태</label>
                  <input value={newDist.business_category} onChange={e => setNewDist(p => ({...p, business_category: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="도소매" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">종목</label>
                  <input value={newDist.business_item} onChange={e => setNewDist(p => ({...p, business_item: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="식료품" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">사업장 주소</label>
                <input value={newDist.business_address} onChange={e => setNewDist(p => ({...p, business_address: e.target.value}))}
                  className="w-full border rounded-lg px-3 py-2 text-sm" />
              </div>
              <hr className="my-2" />
              <p className="text-xs text-orange-600 font-bold">세금계산서</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">이메일</label>
                  <input value={newDist.tax_email} onChange={e => setNewDist(p => ({...p, tax_email: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="tax@company.com" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">담당자명</label>
                  <input value={newDist.tax_manager_name} onChange={e => setNewDist(p => ({...p, tax_manager_name: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">담당자 연락처</label>
                  <input value={newDist.tax_manager_phone} onChange={e => setNewDist(p => ({...p, tax_manager_phone: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="010-0000-0000" />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t shrink-0">
              <button onClick={() => setShowCreateDist(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">취소</button>
              <button onClick={handleCreateDist} className="px-4 py-2 text-sm bg-orange-500 text-white rounded-lg hover:bg-orange-600 font-medium">등록</button>
            </div>
          </div>
        </div>
      )}
      {/* D113: 매장 등록 모달 */}
      {showCreateStore && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowCreateStore(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-800 px-6 pt-6 pb-3 shrink-0">매장 등록</h3>
            <div className="space-y-3 overflow-y-auto px-6 flex-1">
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
            <div className="flex justify-end gap-2 px-6 py-4 border-t shrink-0">
              <button onClick={() => setShowCreateStore(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">취소</button>
              <button onClick={handleCreateStore} className="px-4 py-2 text-sm bg-orange-500 text-white rounded-lg hover:bg-orange-600 font-medium">등록</button>
            </div>
          </div>
        </div>
      )}

      {/* D113: 입금확인/충전/삭제 모달 */}
      {actionModal.type && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setActionModal({ type: null })}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-800 mb-4">
              {actionModal.type === 'activate' ? '입금 확인 (잔액 충전)' :
               actionModal.type === 'charge' ? '잔액 충전' :
               '총판 삭제'}
            </h3>
            <p className="text-sm text-gray-500 mb-4">{actionModal.storeName || ''}</p>
            {actionModal.type === 'activate' && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">입금 금액 (원)</label>
                <input type="number" value={actionValue} onChange={e => setActionValue(e.target.value)} min="1000" step="10000"
                  className="w-full border rounded-lg px-3 py-2 text-sm" />
                <p className="text-xs text-gray-400 mt-1">입금 확인 시 잔액에 충전됩니다. 매장에서 이용료 결제 시 활성화됩니다.</p>
              </div>
            )}
            {actionModal.type === 'charge' && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">충전 금액 (원)</label>
                <input type="number" value={actionValue} onChange={e => setActionValue(e.target.value)} min="1000" step="10000"
                  className="w-full border rounded-lg px-3 py-2 text-sm" />
              </div>
            )}
            {actionModal.type === 'delete_dist' && (
              <p className="text-sm text-red-500 mb-4">이 총판과 하위 데이터를 삭제합니다. 되돌릴 수 없습니다.</p>
            )}
            {actionResult && (
              <p className={`text-sm mb-3 font-medium ${actionResult.includes('완료') ? 'text-green-600' : 'text-red-500'}`}>{actionResult}</p>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => setActionModal({ type: null })} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">취소</button>
              <button onClick={handleActionSubmit} className={`px-4 py-2 text-sm text-white rounded-lg font-medium ${
                actionModal.type === 'delete_dist' ? 'bg-red-500 hover:bg-red-600' : 'bg-orange-500 hover:bg-orange-600'
              }`}>
                {actionModal.type === 'activate' ? '입금 확인' : actionModal.type === 'charge' ? '충전' : '삭제'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* D113→D114: 매장 수정 모달 (전체 필드) */}
      {editStore && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setEditStore(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 px-6 pt-6 pb-3 shrink-0">
              <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-800">매장 수정</h3>
                <p className="text-sm text-gray-500">{editStore.store_name || editStore.name}</p>
              </div>
            </div>
            <div className="space-y-3 overflow-y-auto px-6 flex-1">
              <p className="text-xs text-orange-600 font-bold">기본 정보</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">매장명</label>
                  <input value={editStoreForm.store_name || ''} onChange={e => setEditStoreForm(p => ({...p, store_name: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-300 focus:border-orange-400 transition" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">업종</label>
                  <select value={editStoreForm.business_type || 'mart'} onChange={e => setEditStoreForm(p => ({...p, business_type: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-300 transition">
                    {businessTypes.length > 0
                      ? businessTypes.map(bt => <option key={bt.type_code} value={bt.type_code}>{bt.type_name}</option>)
                      : <><option value="mart">마트</option><option value="butcher">정육점</option></>
                    }
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">사업자등록번호</label>
                  <input value={editStoreForm.business_number || ''} onChange={e => setEditStoreForm(p => ({...p, business_number: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-300 transition" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">상태</label>
                  <select value={editStoreForm.payment_status || 'pending'} onChange={e => setEditStoreForm(p => ({...p, payment_status: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-300 transition">
                    <option value="pending">대기</option>
                    <option value="active">활성</option>
                    <option value="suspended">정지</option>
                  </select>
                </div>
              </div>
              <hr className="my-2" />
              <p className="text-xs text-orange-600 font-bold">담당자 / 과금</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">담당자</label>
                  <input value={editStoreForm.contact_name || ''} onChange={e => setEditStoreForm(p => ({...p, contact_name: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-300 transition" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">담당자 연락처</label>
                  <input value={editStoreForm.contact_phone || ''} onChange={e => setEditStoreForm(p => ({...p, contact_phone: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-300 transition" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">월정액 (원)</label>
                  <input type="number" value={editStoreForm.monthly_fee || '150000'} onChange={e => setEditStoreForm(p => ({...p, monthly_fee: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-300 transition" />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t shrink-0">
              <button onClick={() => setEditStore(null)} className="px-5 py-2.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition">취소</button>
              <button onClick={handleSaveEditStore} className="px-5 py-2.5 text-sm bg-orange-500 text-white rounded-lg hover:bg-orange-600 font-medium shadow-sm transition">저장</button>
            </div>
          </div>
        </div>
      )}

      {/* ★ D114: 총판 수정 모달 (예쁜 버전 — 아이콘+제목+설명+animate) */}
      {editDist && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setEditDist(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 px-6 pt-6 pb-3 shrink-0">
              <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-800">총판 수정</h3>
                <p className="text-sm text-gray-500">{editDist.company_name}</p>
              </div>
            </div>
            <div className="space-y-3 overflow-y-auto px-6 flex-1">
              <p className="text-xs text-orange-600 font-bold">기본 정보</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">총판명</label>
                  <input value={editDistForm.company_name || ''} onChange={e => setEditDistForm(p => ({...p, company_name: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-300 focus:border-orange-400 transition" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">업태</label>
                  <select value={editDistForm.business_type || 'mart'} onChange={e => setEditDistForm(p => ({...p, business_type: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-300 transition">
                    <option value="mart">마트</option><option value="butcher">정육점</option>
                    <option value="seafood">수산</option><option value="bakery">베이커리</option>
                    <option value="cafe">카페</option><option value="other">기타</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">담당자명</label>
                  <input value={editDistForm.owner_name || ''} onChange={e => setEditDistForm(p => ({...p, owner_name: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-300 transition" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">연락처</label>
                  <input value={editDistForm.owner_phone || ''} onChange={e => setEditDistForm(p => ({...p, owner_phone: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-300 transition" placeholder="010-0000-0000" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">사업자등록번호</label>
                  <input value={editDistForm.business_number || ''} onChange={e => setEditDistForm(p => ({...p, business_number: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-300 transition" placeholder="000-00-00000" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">상태</label>
                  <select value={editDistForm.payment_status || 'pending'} onChange={e => setEditDistForm(p => ({...p, payment_status: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-300 transition">
                    <option value="pending">대기</option>
                    <option value="active">활성</option>
                    <option value="suspended">정지</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">주소</label>
                <input value={editDistForm.address || ''} onChange={e => setEditDistForm(p => ({...p, address: e.target.value}))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-300 transition" />
              </div>
              <hr className="my-2" />
              <p className="text-xs text-orange-600 font-bold">사업자등록증</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">상호</label>
                  <input value={editDistForm.business_reg_name || ''} onChange={e => setEditDistForm(p => ({...p, business_reg_name: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-300 transition" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">대표자</label>
                  <input value={editDistForm.business_reg_owner || ''} onChange={e => setEditDistForm(p => ({...p, business_reg_owner: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-300 transition" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">업태</label>
                  <input value={editDistForm.business_category || ''} onChange={e => setEditDistForm(p => ({...p, business_category: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-300 transition" placeholder="도소매" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">종목</label>
                  <input value={editDistForm.business_item || ''} onChange={e => setEditDistForm(p => ({...p, business_item: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-300 transition" placeholder="식료품" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">사업장 주소</label>
                <input value={editDistForm.business_address || ''} onChange={e => setEditDistForm(p => ({...p, business_address: e.target.value}))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-300 transition" />
              </div>
              <hr className="my-2" />
              <p className="text-xs text-orange-600 font-bold">세금계산서</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">이메일</label>
                  <input value={editDistForm.tax_email || ''} onChange={e => setEditDistForm(p => ({...p, tax_email: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-300 transition" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">담당자명</label>
                  <input value={editDistForm.tax_manager_name || ''} onChange={e => setEditDistForm(p => ({...p, tax_manager_name: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-300 transition" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">담당자 연락처</label>
                  <input value={editDistForm.tax_manager_phone || ''} onChange={e => setEditDistForm(p => ({...p, tax_manager_phone: e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-300 transition" />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t shrink-0">
              <button onClick={() => setEditDist(null)} className="px-5 py-2.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition">취소</button>
              <button onClick={handleSaveEditDist} className="px-5 py-2.5 text-sm bg-orange-500 text-white rounded-lg hover:bg-orange-600 font-medium shadow-sm transition">저장</button>
            </div>
          </div>
        </div>
      )}

      {/* ★ D114: 토스트 메시지 (alert 교체) */}
      {toast.show && (
        <div className="fixed top-6 right-6 z-[9999] animate-in slide-in-from-top-2 duration-300">
          <div className={`flex items-center gap-3 px-5 py-3.5 rounded-xl shadow-lg border ${
            toast.type === 'success' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'
          }`}>
            {toast.type === 'success'
              ? <svg className="w-5 h-5 text-green-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              : <svg className="w-5 h-5 text-red-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            }
            <span className="text-sm font-medium">{toast.message}</span>
          </div>
        </div>
      )}
    </div>
  );
}
