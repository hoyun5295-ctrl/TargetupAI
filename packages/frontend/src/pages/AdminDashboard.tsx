import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { companiesApi, plansApi } from '../api/client';
import { useAuthStore } from '../stores/authStore';

interface Company {
  id: string;
  company_code: string;
  company_name: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  status: string;
  total_customers: number;
  plan_id: string;
  plan_name: string;
  reject_number: string;
  created_at: string;
}

interface Plan {
  id: string;
  plan_code: string;
  plan_name: string;
  max_customers: number;
  monthly_price: number;
}

interface User {
  id: string;
  login_id: string;
  name: string;
  email: string;
  phone: string;
  department: string;
  user_type: string;
  status: string;
  company_id: string;
  company_name: string;
  last_login_at: string;
  created_at: string;
}

// 커스텀 모달 타입
interface ModalState {
  type: 'confirm' | 'alert' | 'password' | null;
  title: string;
  message: string;
  variant?: 'success' | 'error' | 'warning' | 'info';
  password?: string;
  smsSent?: boolean;
  phone?: string;
  onConfirm?: () => void;
}

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();

  const [activeTab, setActiveTab] = useState<'companies' | 'users' | 'scheduled' | 'callbacks' | 'plans'>('companies');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCompanyModal, setShowCompanyModal] = useState(false);
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [showEditCompanyModal, setShowEditCompanyModal] = useState(false);
  const [editCompany, setEditCompany] = useState({
    id: '',
    companyName: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    status: 'active',
    planId: '',
    rejectNumber: '',
    sendHourStart: 9,
    sendHourEnd: 21,
    dailyLimit: 0,
    holidaySend: false,
    duplicateDays: 7,
    costPerSms: 9.9,
    costPerLms: 27,
    costPerMms: 50,
    costPerKakao: 7.5,
    storeCodeList: [] as string[],
    newStoreCode: '',
  });

  // 예약 캠페인 관리
  const [scheduledCampaigns, setScheduledCampaigns] = useState<any[]>([]);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<{ id: string; name: string } | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [scheduledPage, setScheduledPage] = useState(1);
  const scheduledPerPage = 10;

  // 사용자 검색/필터
  const [userSearch, setUserSearch] = useState('');
  const [userCompanyFilter, setUserCompanyFilter] = useState('all');
  const [expandedCompanies, setExpandedCompanies] = useState<Set<string>>(new Set());

  // 발신번호 관리
  const [callbackNumbers, setCallbackNumbers] = useState<any[]>([]);
  const [showCallbackModal, setShowCallbackModal] = useState(false);
  const [newCallback, setNewCallback] = useState({
    companyId: '',
    phone: '',
    label: '',
    isDefault: false,
  });

  // 회사 목록 검색/필터
  const [companySearch, setCompanySearch] = useState('');
  const [companyStatusFilter, setCompanyStatusFilter] = useState('all');

  // 요금제 관리
  const [planList, setPlanList] = useState<any[]>([]);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [editingPlan, setEditingPlan] = useState<any>(null);
  const [newPlan, setNewPlan] = useState({
    planCode: '',
    planName: '',
    maxCustomers: 1000,
    monthlyPrice: 0,
  });

  // 커스텀 모달 상태
  const [modal, setModal] = useState<ModalState>({ type: null, title: '', message: '' });
  const [copied, setCopied] = useState(false);

  // 신규 고객사 폼
  const [newCompany, setNewCompany] = useState({
    companyCode: '',
    companyName: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    planId: '',
  });

  // 신규 사용자 폼
  const [newUser, setNewUser] = useState({
    companyId: '',
    loginId: '',
    password: '',
    name: '',
    email: '',
    phone: '',
    department: '',
    userType: 'user',
    storeCodes: '',
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [companiesRes, plansRes] = await Promise.all([
        companiesApi.list(),
        plansApi.list(),
      ]);
      setCompanies(companiesRes.data.companies);
      setPlans(plansRes.data.plans);
      
      // 사용자 목록 로드
      await loadUsers();
      // 예약 캠페인 로드
      await loadScheduledCampaigns();
      // 발신번호 로드
      await loadCallbackNumbers();
      // 요금제 로드
      await loadPlans();
    } catch (error) {
      console.error('데이터 로드 실패:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadUsers = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/admin/users', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
      }
    } catch (error) {
      console.error('사용자 로드 실패:', error);
    }
  };

  const loadScheduledCampaigns = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/admin/campaigns/scheduled', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setScheduledCampaigns(data.campaigns || []);
      }
    } catch (error) {
      console.error('예약 캠페인 로드 실패:', error);
    }
  };

  const loadCallbackNumbers = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/admin/callback-numbers', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setCallbackNumbers(data.callbackNumbers || []);
      }
    } catch (error) {
      console.error('발신번호 로드 실패:', error);
    }
  };

  const loadPlans = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/admin/plans', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setPlanList(data.plans || []);
      }
    } catch (error) {
      console.error('요금제 로드 실패:', error);
    }
  };

  // 모달 헬퍼 함수
  const showAlert = (title: string, message: string, variant: 'success' | 'error' | 'warning' | 'info' = 'info') => {
    setModal({ type: 'alert', title, message, variant });
  };

  const showConfirm = (title: string, message: string, onConfirm: () => void) => {
    setModal({ type: 'confirm', title, message, onConfirm });
  };

  const showPasswordModal = (password: string, smsSent?: boolean, phone?: string) => {
    setCopied(false);
    setModal({ type: 'password', title: '임시 비밀번호 발급', message: '', password, smsSent, phone });
  };

  const closeModal = () => {
    setModal({ type: null, title: '', message: '' });
    setCopied(false);
  };

  const handleCopyPassword = async () => {
    if (modal.password) {
      await navigator.clipboard.writeText(modal.password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleCreateCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await companiesApi.create(newCompany);
      setShowCompanyModal(false);
      setNewCompany({
        companyCode: '',
        companyName: '',
        contactName: '',
        contactEmail: '',
        contactPhone: '',
        planId: '',
      });
      loadData();
      showAlert('성공', '고객사가 생성되었습니다.', 'success');
    } catch (error: any) {
      showAlert('오류', error.response?.data?.error || '생성 실패', 'error');
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          ...newUser,
          storeCodes: newUser.storeCodes ? newUser.storeCodes.split(',').map(s => s.trim()).filter(Boolean) : null
        })
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '생성 실패');
      }
      
      setShowUserModal(false);
      setNewUser({
        companyId: '',
        loginId: '',
        password: '',
        name: '',
        email: '',
        phone: '',
        department: '',
        userType: 'user',
        storeCodes: '',
      });
      loadUsers();
      showAlert('성공', '사용자가 생성되었습니다.', 'success');
    } catch (error: any) {
      showAlert('오류', error.message || '생성 실패', 'error');
    }
  };

  const handleResetPassword = async (userId: string, userName: string) => {
    showConfirm(
      '비밀번호 초기화',
      `${userName}님의 비밀번호를 초기화하시겠습니까?`,
      async () => {
        closeModal();
        try {
          const token = localStorage.getItem('token');
          const res = await fetch(`/api/admin/users/${userId}/reset-password`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
          });
          
          if (!res.ok) throw new Error('초기화 실패');
          
          const data = await res.json();
          showPasswordModal(data.tempPassword, data.smsSent, data.phone);
        } catch (error) {
          showAlert('오류', '비밀번호 초기화 실패', 'error');
        }
      }
    );
  };

  const handleDeleteUser = async (userId: string, userName: string) => {
    showConfirm(
      '사용자 삭제',
      `${userName}님을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`,
      async () => {
        closeModal();
        try {
          const token = localStorage.getItem('token');
          const res = await fetch(`/api/admin/users/${userId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
          });
          
          if (!res.ok) throw new Error('삭제 실패');
          
          loadUsers();
          showAlert('성공', '삭제되었습니다.', 'success');
        } catch (error) {
          showAlert('오류', '삭제 실패', 'error');
        }
      }
    );
  };

  const handleEditUser = (user: any) => {
    setEditingUser({
      ...user,
      storeCodes: user.store_codes ? user.store_codes.join(', ') : ''
    });
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;

    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/admin/users/${editingUser.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          name: editingUser.name,
          email: editingUser.email,
          phone: editingUser.phone,
          department: editingUser.department,
          userType: editingUser.user_type,
          status: editingUser.status,
          storeCodes: editingUser.storeCodes ? editingUser.storeCodes.split(',').map((s: string) => s.trim()).filter(Boolean) : null
        })
      });

      if (!res.ok) throw new Error('수정 실패');

      setEditingUser(null);
      loadUsers();
      showAlert('성공', '사용자 정보가 수정되었습니다.', 'success');
    } catch (error) {
      showAlert('오류', '수정 실패', 'error');
    }
  };

  const handleEditCompany = async (company: Company) => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/admin/companies/${company.id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        const c = data.company;
        setEditCompany({
          id: c.id,
          companyName: c.company_name || '',
          contactName: c.contact_name || '',
          contactEmail: c.contact_email || '',
          contactPhone: c.contact_phone || '',
          status: c.status || 'active',
          planId: c.plan_id || '',
          rejectNumber: c.reject_number || '',
          sendHourStart: c.send_hour_start ?? 9,
          sendHourEnd: c.send_hour_end ?? 21,
          dailyLimit: c.daily_limit ?? 0,
          holidaySend: c.holiday_send ?? false,
          duplicateDays: c.duplicate_days ?? 7,
          costPerSms: c.cost_per_sms ?? 9.9,
          costPerLms: c.cost_per_lms ?? 27,
          costPerMms: c.cost_per_mms ?? 50,
          costPerKakao: c.cost_per_kakao ?? 7.5,
          storeCodeList: c.store_code_list || [],
          newStoreCode: '',
        });
        setShowEditCompanyModal(true);
      }
    } catch (error) {
      console.error('회사 정보 로드 실패:', error);
    }
  };

  const handleUpdateCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/admin/companies/${editCompany.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(editCompany)
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '수정 실패');
      }
      
      setShowEditCompanyModal(false);
      loadData();
      showAlert('성공', '고객사 정보가 수정되었습니다.', 'success');
    } catch (error: any) {
      showAlert('오류', error.message || '수정 실패', 'error');
    }
  };

  const openCancelModal = (id: string, name: string) => {
    setCancelTarget({ id, name });
    setCancelReason('');
    setShowCancelModal(true);
  };

  const handleCancelCampaign = async () => {
    if (!cancelTarget || !cancelReason.trim()) {
      showAlert('오류', '취소 사유를 입력해주세요.', 'error');
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/admin/campaigns/${cancelTarget.id}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ reason: cancelReason })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '취소 실패');
      }

      setShowCancelModal(false);
      setCancelTarget(null);
      setCancelReason('');
      loadScheduledCampaigns();
      showAlert('성공', '예약이 취소되었습니다.', 'success');
    } catch (error: any) {
      showAlert('오류', error.message || '취소 실패', 'error');
    }
  };

  const handleCreateCallback = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/admin/callback-numbers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(newCallback)
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '등록 실패');
      }
      
      setShowCallbackModal(false);
      setNewCallback({ companyId: '', phone: '', label: '', isDefault: false });
      loadCallbackNumbers();
      showAlert('성공', '발신번호가 등록되었습니다.', 'success');
    } catch (error: any) {
      showAlert('오류', error.message || '등록 실패', 'error');
    }
  };

  const handleDeleteCallback = (id: string, phone: string) => {
    showConfirm(
      '발신번호 삭제',
      `${phone} 번호를 삭제하시겠습니까?`,
      async () => {
        closeModal();
        try {
          const token = localStorage.getItem('token');
          const res = await fetch(`/api/admin/callback-numbers/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
          });
          
          if (!res.ok) throw new Error('삭제 실패');
          
          loadCallbackNumbers();
          showAlert('성공', '삭제되었습니다.', 'success');
        } catch (error) {
          showAlert('오류', '삭제 실패', 'error');
        }
      }
    );
  };

  const handleSetDefault = async (id: string) => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/admin/callback-numbers/${id}/default`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!res.ok) throw new Error('설정 실패');
      
      loadCallbackNumbers();
      showAlert('성공', '대표번호로 설정되었습니다.', 'success');
    } catch (error) {
      showAlert('오류', '설정 실패', 'error');
    }
  };

  const handleCreatePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/admin/plans', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(newPlan)
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '등록 실패');
      
      setShowPlanModal(false);
      setNewPlan({ planCode: '', planName: '', maxCustomers: 1000, monthlyPrice: 0 });
      loadPlans();
      showAlert('성공', '요금제가 등록되었습니다.', 'success');
    } catch (error: any) {
      showAlert('오류', error.message || '등록 실패', 'error');
    }
  };

  const handleUpdatePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPlan) return;
    
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/admin/plans/${editingPlan.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          planName: editingPlan.plan_name,
          maxCustomers: editingPlan.max_customers,
          monthlyPrice: editingPlan.monthly_price,
          isActive: editingPlan.is_active,
        })
      });
      
      if (!res.ok) throw new Error('수정 실패');
      
      setEditingPlan(null);
      loadPlans();
      showAlert('성공', '수정되었습니다.', 'success');
    } catch (error) {
      showAlert('오류', '수정 실패', 'error');
    }
  };

  const handleDeletePlan = (id: string, name: string) => {
    showConfirm(
      '요금제 삭제',
      `"${name}" 요금제를 삭제하시겠습니까?`,
      async () => {
        closeModal();
        try {
          const token = localStorage.getItem('token');
          const res = await fetch(`/api/admin/plans/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
          });
          
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || '삭제 실패');
          
          loadPlans();
          showAlert('성공', '삭제되었습니다.', 'success');
        } catch (error: any) {
          showAlert('오류', error.message || '삭제 실패', 'error');
        }
      }
    );
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      trial: 'bg-yellow-100 text-yellow-800',
      active: 'bg-green-100 text-green-800',
      suspended: 'bg-red-100 text-red-800',
      terminated: 'bg-gray-100 text-gray-800',
      locked: 'bg-red-100 text-red-800',
      dormant: 'bg-gray-100 text-gray-800',
    };
    const labels: Record<string, string> = {
      trial: '체험',
      active: '활성',
      suspended: '정지',
      terminated: '해지',
      locked: '잠금',
      dormant: '휴면',
    };
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status] || styles.active}`}>
        {labels[status] || status}
      </span>
    );
  };

  const getUserTypeBadge = (userType: string) => {
    if (userType === 'admin') {
      return <span className="px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800">관리자</span>;
    }
    return <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">일반</span>;
  };

  // 필터링된 회사 목록
  const filteredCompanies = companies.filter((company) => {
    const matchesSearch = companySearch === '' || 
      company.company_code.toLowerCase().includes(companySearch.toLowerCase()) ||
      company.company_name.toLowerCase().includes(companySearch.toLowerCase()) ||
      (company.contact_name && company.contact_name.toLowerCase().includes(companySearch.toLowerCase()));
    
    const matchesStatus = companyStatusFilter === 'all' || company.status === companyStatusFilter;
    
    return matchesSearch && matchesStatus;
  });

  // 임시 비밀번호 생성
  const generateTempPassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let password = '';
    for (let i = 0; i < 8; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setNewUser({ ...newUser, password });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-gray-500">로딩 중...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* 헤더 */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-xl font-bold text-gray-800">Target-UP Admin</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">{user?.name}님</span>
            <button
              onClick={handleLogout}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              로그아웃
            </button>
          </div>
        </div>
      </header>

      {/* 메인 */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* 통계 카드 */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm text-gray-500">전체 고객사</div>
            <div className="text-3xl font-bold text-gray-800">{companies.length}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm text-gray-500">활성 고객사</div>
            <div className="text-3xl font-bold text-green-600">
              {companies.filter(c => c.status === 'active').length}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm text-gray-500">전체 사용자</div>
            <div className="text-3xl font-bold text-blue-600">{users.length}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm text-gray-500">요금제</div>
            <div className="text-3xl font-bold text-purple-600">{plans.length}개</div>
          </div>
        </div>

        {/* 탭 메뉴 */}
        <div className="bg-white rounded-lg shadow mb-6">
          <div className="border-b">
            <nav className="flex">
              <button
                onClick={() => setActiveTab('companies')}
                className={`px-6 py-4 text-sm font-medium border-b-2 ${
                  activeTab === 'companies'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                고객사 관리
              </button>
              <button
                onClick={() => setActiveTab('users')}
                className={`px-6 py-4 text-sm font-medium border-b-2 ${
                  activeTab === 'users'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                사용자 관리
              </button>
              <button
                onClick={() => setActiveTab('scheduled')}
                className={`px-6 py-4 text-sm font-medium border-b-2 ${
                  activeTab === 'scheduled'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                예약 관리
              </button>
              <button
                onClick={() => setActiveTab('callbacks')}
                className={`px-6 py-4 text-sm font-medium border-b-2 ${
                  activeTab === 'callbacks'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                발신번호 관리
              </button>
              <button
                onClick={() => setActiveTab('plans')}
                className={`px-6 py-4 text-sm font-medium border-b-2 ${
                  activeTab === 'plans'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                요금제 관리
              </button>
            </nav>
          </div>
        </div>

        {/* 고객사 관리 탭 */}
        {activeTab === 'companies' && (
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b flex justify-between items-center">
              <h2 className="text-lg font-semibold">고객사 목록</h2>
              <button
                onClick={() => setShowCompanyModal(true)}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
              >
                + 고객사 추가
              </button>
            </div>

            {/* 검색/필터 */}
            <div className="px-6 py-3 border-b bg-gray-50 flex gap-4 items-center">
              <div className="flex-1">
                <input
                  type="text"
                  value={companySearch}
                  onChange={(e) => setCompanySearch(e.target.value)}
                  placeholder="회사코드, 회사명, 담당자명 검색..."
                  className="w-full max-w-xs px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">상태:</span>
                <select
                  value={companyStatusFilter}
                  onChange={(e) => setCompanyStatusFilter(e.target.value)}
                  className="px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="all">전체</option>
                  <option value="active">활성</option>
                  <option value="trial">체험</option>
                  <option value="suspended">정지</option>
                  <option value="terminated">해지</option>
                </select>
              </div>
              <div className="text-sm text-gray-500">
                {filteredCompanies.length}개 / 총 {companies.length}개
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">코드</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">회사명</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">담당자</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">요금제</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">상태</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">고객 수</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">등록일</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">관리</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                {filteredCompanies.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-6 py-12 text-center text-gray-500">
                        {companies.length === 0 ? '등록된 고객사가 없습니다.' : '검색 결과가 없습니다.'}
                      </td>
                    </tr>
                  ) : (
                    filteredCompanies.map((company) => (
                      <tr key={company.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 text-sm font-medium text-gray-900">
                          {company.company_code}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-900">{company.company_name}</td>
                        <td className="px-6 py-4 text-sm text-gray-500">{company.contact_name || '-'}</td>
                        <td className="px-6 py-4 text-sm text-gray-500">{company.plan_name || '-'}</td>
                        <td className="px-6 py-4">{getStatusBadge(company.status)}</td>
                        <td className="px-6 py-4 text-sm text-gray-500">
                          {company.total_customers?.toLocaleString() || 0}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-500">
                          {new Date(company.created_at).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4">
                          <button 
                            onClick={() => handleEditCompany(company)}
                            className="text-blue-600 hover:text-blue-800 text-sm mr-2"
                          >
                            수정
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 사용자 관리 탭 */}
        {activeTab === 'users' && (
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b flex justify-between items-center">
              <h2 className="text-lg font-semibold">사용자 목록</h2>
              <button
                onClick={() => setShowUserModal(true)}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
              >
                + 사용자 추가
              </button>
            </div>

            {/* 검색/필터 */}
            <div className="px-6 py-3 bg-gray-50 border-b flex gap-4 items-center">
              <div className="flex-1">
                <input
                  type="text"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="🔍 아이디, 이름으로 검색..."
                  className="w-full max-w-xs px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-600">회사:</label>
                <select
                  value={userCompanyFilter}
                  onChange={(e) => setUserCompanyFilter(e.target.value)}
                  className="px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="all">전체</option>
                  {companies.map(c => (
                    <option key={c.id} value={c.id}>{c.company_name}</option>
                  ))}
                </select>
              </div>
              <span className="text-sm text-gray-500">
                총 {users.filter(u => {
                  const matchSearch = !userSearch || 
                    u.login_id.toLowerCase().includes(userSearch.toLowerCase()) ||
                    u.name.toLowerCase().includes(userSearch.toLowerCase());
                  const matchCompany = userCompanyFilter === 'all' || u.company_id === userCompanyFilter;
                  return matchSearch && matchCompany;
                }).length}명
              </span>
            </div>

            <div className="overflow-x-auto">
              {(() => {
                // 필터링된 사용자
                const filteredUsers = users.filter(u => {
                  const matchSearch = !userSearch || 
                    u.login_id.toLowerCase().includes(userSearch.toLowerCase()) ||
                    u.name.toLowerCase().includes(userSearch.toLowerCase()) ||
                    (u.company_name || '').toLowerCase().includes(userSearch.toLowerCase());
                  const matchCompany = userCompanyFilter === 'all' || u.company_id === userCompanyFilter;
                  return matchSearch && matchCompany;
                });

                // 회사별 그룹핑
                const groupedUsers = filteredUsers.reduce((acc, user) => {
                  const companyId = user.company_id || 'none';
                  if (!acc[companyId]) {
                    acc[companyId] = {
                      companyName: user.company_name || '소속 없음',
                      users: []
                    };
                  }
                  acc[companyId].users.push(user);
                  return acc;
                }, {} as Record<string, { companyName: string; users: typeof users }>);

                const companyIds = Object.keys(groupedUsers);

                if (filteredUsers.length === 0) {
                  return (
                    <div className="px-6 py-12 text-center text-gray-500">
                      {users.length === 0 ? '등록된 사용자가 없습니다.' : '검색 결과가 없습니다.'}
                    </div>
                  );
                }

                return (
                  <div className="divide-y">
                    {companyIds.map(companyId => {
                      const group = groupedUsers[companyId];
                      const isExpanded = expandedCompanies.has(companyId);
                      
                      return (
                        <div key={companyId}>
                          <button
                            onClick={() => {
                              const newSet = new Set(expandedCompanies);
                              if (isExpanded) {
                                newSet.delete(companyId);
                              } else {
                                newSet.add(companyId);
                              }
                              setExpandedCompanies(newSet);
                            }}
                            className="w-full px-6 py-3 bg-gray-50 hover:bg-gray-100 flex items-center justify-between transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <span className={`text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>
                                ▶
                              </span>
                              <span className="font-semibold text-gray-800">{group.companyName}</span>
                              <span className="text-sm text-gray-500">({group.users.length}명)</span>
                            </div>
                          </button>
                          
                          {isExpanded && (
                            <table className="w-full">
                              <thead className="bg-gray-50/50">
                                <tr>
                                  <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase">로그인ID</th>
                                  <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase">이름</th>
                                  <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase">권한</th>
                                  <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase">담당 브랜드</th>
                                  <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase">상태</th>
                                  <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase">최근로그인</th>
                                  <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase">관리</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {group.users.map((u) => (
                                  <tr key={u.id} className="hover:bg-blue-50/30">
                                    <td className="px-6 py-3 text-sm font-medium text-gray-900">{u.login_id}</td>
                                    <td className="px-6 py-3 text-sm text-gray-900">{u.name}</td>
                                    <td className="px-6 py-3">{getUserTypeBadge(u.user_type)}</td>
                                    <td className="px-6 py-3 text-sm text-gray-600">
                                      {(u as any).store_codes && (u as any).store_codes.length > 0 
                                        ? (u as any).store_codes.join(', ') 
                                        : <span className="text-gray-400">전체</span>}
                                    </td>
                                    <td className="px-6 py-3">{getStatusBadge(u.status)}</td>
                                    <td className="px-6 py-3 text-sm text-gray-500">
                                      {u.last_login_at ? new Date(u.last_login_at).toLocaleString() : '-'}
                                    </td>
                                    <td className="px-6 py-3">
                                      <button 
                                        onClick={() => handleEditUser(u)}
                                        className="text-blue-600 hover:text-blue-800 text-sm mr-2"
                                      >
                                        수정
                                      </button>
                                      <button 
                                        onClick={() => handleResetPassword(u.id, u.name)}
                                        className="text-orange-600 hover:text-orange-800 text-sm mr-2"
                                      >
                                        비번초기화
                                      </button>
                                      <button 
                                        onClick={() => handleDeleteUser(u.id, u.name)}
                                        className="text-red-600 hover:text-red-800 text-sm"
                                      >
                                        삭제
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
            </div>
        )}

        {/* 예약 관리 탭 */}
        {activeTab === 'scheduled' && (
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b flex justify-between items-center">
              <h2 className="text-lg font-semibold">예약 캠페인 관리</h2>
              <span className="text-sm text-gray-500">총 {scheduledCampaigns.length}건</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
              <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">고객사</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">캠페인명</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">대상</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">등록일시</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">예약시간</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">상태</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">관리</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {scheduledCampaigns.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                        예약된 캠페인이 없습니다.
                      </td>
                    </tr>
                  ) : (
                    scheduledCampaigns
                      .slice((scheduledPage - 1) * scheduledPerPage, scheduledPage * scheduledPerPage)
                      .map((campaign) => (
                      <tr key={campaign.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 text-sm text-gray-900">
                          {campaign.company_name}
                          <span className="text-gray-400 ml-1">({campaign.company_code})</span>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-900">{campaign.campaign_name}</td>
                        <td className="px-6 py-4 text-sm text-gray-500">
                          {campaign.target_count?.toLocaleString() || 0}명
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-500">
                          {campaign.created_at ? new Date(campaign.created_at).toLocaleString('ko-KR') : '-'}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-500">
                          {campaign.scheduled_at ? new Date(campaign.scheduled_at).toLocaleString('ko-KR') : '-'}
                        </td>
                        <td className="px-6 py-4">
                          {campaign.status === 'scheduled' ? (
                            <span className="px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">예약</span>
                          ) : (
                            <div>
                              <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">취소됨</span>
                              {campaign.cancelled_by_type === 'super_admin' && (
                                <span className="ml-1 text-xs text-red-500">(관리자)</span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          {campaign.status === 'scheduled' ? (
                            <button
                              onClick={() => openCancelModal(campaign.id, campaign.campaign_name)}
                              className="text-red-600 hover:text-red-800 text-sm"
                            >
                              취소
                            </button>
                          ) : (
                            <span className="text-xs text-gray-400">
                              {campaign.cancel_reason && `사유: ${campaign.cancel_reason}`}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* 페이지네이션 */}
            {scheduledCampaigns.length > scheduledPerPage && (
              <div className="px-6 py-4 border-t flex justify-center items-center gap-2">
                <button
                  onClick={() => setScheduledPage(p => Math.max(1, p - 1))}
                  disabled={scheduledPage === 1}
                  className="px-3 py-1 rounded border text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                >
                  ◀ 이전
                </button>
                {Array.from({ length: Math.ceil(scheduledCampaigns.length / scheduledPerPage) }, (_, i) => i + 1)
                  .filter(p => p === 1 || p === Math.ceil(scheduledCampaigns.length / scheduledPerPage) || Math.abs(p - scheduledPage) <= 2)
                  .map((p, idx, arr) => (
                    <span key={p}>
                      {idx > 0 && arr[idx - 1] !== p - 1 && <span className="px-1">...</span>}
                      <button
                        onClick={() => setScheduledPage(p)}
                        className={`w-8 h-8 rounded text-sm ${scheduledPage === p ? 'bg-blue-600 text-white' : 'hover:bg-gray-100'}`}
                      >
                        {p}
                      </button>
                    </span>
                  ))}
                <button
                  onClick={() => setScheduledPage(p => Math.min(Math.ceil(scheduledCampaigns.length / scheduledPerPage), p + 1))}
                  disabled={scheduledPage >= Math.ceil(scheduledCampaigns.length / scheduledPerPage)}
                  className="px-3 py-1 rounded border text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                >
                  다음 ▶
                </button>
              </div>
            )}
            </div>
        )}

        {/* 발신번호 관리 탭 */}
        {activeTab === 'callbacks' && (
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b flex justify-between items-center">
              <h2 className="text-lg font-semibold">발신번호 관리</h2>
              <button
                onClick={() => setShowCallbackModal(true)}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
              >
                + 발신번호 등록
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">고객사</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">발신번호</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">별칭</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">대표</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">등록일</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">관리</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {callbackNumbers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                        등록된 발신번호가 없습니다.
                      </td>
                    </tr>
                  ) : (
                    callbackNumbers.map((cb) => (
                      <tr key={cb.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 text-sm text-gray-900">
                          {cb.company_name}
                          <span className="text-gray-400 ml-1">({cb.company_code})</span>
                        </td>
                        <td className="px-6 py-4 text-sm font-medium text-gray-900">{cb.phone}</td>
                        <td className="px-6 py-4 text-sm text-gray-500">{cb.label || '-'}</td>
                        <td className="px-6 py-4">
                          {cb.is_default ? (
                            <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">대표</span>
                          ) : (
                            <button
                              onClick={() => handleSetDefault(cb.id)}
                              className="text-blue-600 hover:text-blue-800 text-xs"
                            >
                              대표설정
                            </button>
                          )}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-500">
                          {new Date(cb.created_at).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4">
                          <button
                            onClick={() => handleDeleteCallback(cb.id, cb.phone)}
                            className="text-red-600 hover:text-red-800 text-sm"
                          >
                            삭제
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            </div>
        )}

        {/* 요금제 관리 탭 */}
        {activeTab === 'plans' && (
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b flex justify-between items-center">
              <h2 className="text-lg font-semibold">요금제 관리</h2>
              <button
                onClick={() => setShowPlanModal(true)}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
              >
                + 요금제 추가
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">코드</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">요금제명</th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">최대 고객수</th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">월 요금</th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">사용 회사</th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">상태</th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">관리</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {planList.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                        등록된 요금제가 없습니다.
                      </td>
                    </tr>
                  ) : (
                    planList.map((plan) => (
                      <tr key={plan.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 text-sm font-medium text-gray-900">{plan.plan_code}</td>
                        <td className="px-6 py-4 text-sm text-gray-900">{plan.plan_name}</td>
                        <td className="px-6 py-4 text-sm text-center text-gray-600">
                          {plan.max_customers.toLocaleString()}명
                        </td>
                        <td className="px-6 py-4 text-sm text-center text-gray-900 font-medium">
                          {Number(plan.monthly_price).toLocaleString()}원
                        </td>
                        <td className="px-6 py-4 text-sm text-center">
                          <span className="text-blue-600 font-medium">{plan.company_count || 0}개</span>
                        </td>
                        <td className="px-6 py-4 text-center">
                          {plan.is_active ? (
                            <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">활성</span>
                          ) : (
                            <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">비활성</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-center">
                          <div className="flex justify-center gap-2">
                            <button
                              onClick={() => setEditingPlan({ ...plan })}
                              className="text-blue-600 hover:text-blue-800 text-sm"
                            >
                              수정
                            </button>
                            <button
                              onClick={() => handleDeletePlan(plan.id, plan.plan_name)}
                              className="text-red-600 hover:text-red-800 text-sm"
                            >
                              삭제
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* 고객사 추가 모달 */}
      {showCompanyModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
            <div className="px-6 py-4 border-b">
              <h3 className="text-lg font-semibold">새 고객사 추가</h3>
            </div>
            <form onSubmit={handleCreateCompany} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  고객사 코드 *
                </label>
                <input
                  type="text"
                  value={newCompany.companyCode}
                  onChange={(e) => setNewCompany({ ...newCompany, companyCode: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="예: ABC001"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  회사명 *
                </label>
                <input
                  type="text"
                  value={newCompany.companyName}
                  onChange={(e) => setNewCompany({ ...newCompany, companyName: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="예: ABC 주식회사"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  담당자명
                </label>
                <input
                  type="text"
                  value={newCompany.contactName}
                  onChange={(e) => setNewCompany({ ...newCompany, contactName: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  이메일
                </label>
                <input
                  type="email"
                  value={newCompany.contactEmail}
                  onChange={(e) => setNewCompany({ ...newCompany, contactEmail: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  요금제 *
                </label>
                <select
                  value={newCompany.planId}
                  onChange={(e) => setNewCompany({ ...newCompany, planId: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  required
                >
                  <option value="">선택하세요</option>
                  {plans.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.plan_name} ({plan.max_customers.toLocaleString()}명)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  담당 분류 코드
                </label>
                {(() => {
                  const selectedCompany = companies.find(c => c.id === newUser.companyId);
                  const storeList = (selectedCompany as any)?.store_code_list || [];
                  
                  if (!newUser.companyId) {
                    return <p className="text-xs text-gray-400">먼저 소속 회사를 선택하세요</p>;
                  }
                  if (storeList.length === 0) {
                    return <p className="text-xs text-gray-400">이 회사는 분류 코드가 없습니다 (전체 접근)</p>;
                  }
                  
                  return (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {storeList.map((code: string) => {
                        const selected = newUser.storeCodes.split(',').map(s => s.trim()).filter(Boolean);
                        const isChecked = selected.includes(code);
                        return (
                          <label key={code} className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm cursor-pointer border transition-colors ${isChecked ? 'bg-blue-100 text-blue-800 border-blue-300' : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'}`}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                const newSelected = e.target.checked
                                  ? [...selected, code]
                                  : selected.filter(s => s !== code);
                                setNewUser({ ...newUser, storeCodes: newSelected.join(', ') });
                              }}
                              className="sr-only"
                            />
                            {code}
                          </label>
                        );
                      })}
                    </div>
                  );
                })()}
                <p className="text-xs text-gray-500 mt-2">비워두면 전체 고객 조회 가능</p>
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowCompanyModal(false)}
                  className="flex-1 px-4 py-2 border rounded-lg text-gray-700 hover:bg-gray-50"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  추가
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 사용자 추가 모달 */}
      {showUserModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b">
              <h3 className="text-lg font-semibold">새 사용자 추가</h3>
            </div>
            <form onSubmit={handleCreateUser} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  소속 회사 *
                </label>
                <select
                  value={newUser.companyId}
                  onChange={(e) => setNewUser({ ...newUser, companyId: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  required
                >
                  <option value="">선택하세요</option>
                  {companies.map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.company_name} ({company.company_code})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  로그인 ID *
                </label>
                <input
                  type="text"
                  value={newUser.loginId}
                  onChange={(e) => setNewUser({ ...newUser, loginId: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="영문, 숫자 조합"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  초기 비밀번호 *
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newUser.password}
                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                    className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                    placeholder="8자 이상"
                    required
                  />
                  <button
                    type="button"
                    onClick={generateTempPassword}
                    className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm"
                  >
                    자동생성
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  이름 *
                </label>
                <input
                  type="text"
                  value={newUser.name}
                  onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  이메일
                </label>
                <input
                  type="email"
                  value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  연락처
                </label>
                <input
                  type="text"
                  value={newUser.phone}
                  onChange={(e) => setNewUser({ ...newUser, phone: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="010-0000-0000"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  부서
                </label>
                <input
                  type="text"
                  value={newUser.department}
                  onChange={(e) => setNewUser({ ...newUser, department: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  권한 *
                </label>
                <select
                  value={newUser.userType}
                  onChange={(e) => setNewUser({ ...newUser, userType: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="user">일반 사용자</option>
                  <option value="admin">회사 관리자</option>
                  </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  담당 분류 코드
                </label>
                {(() => {
                  const selectedCompany = companies.find(c => c.id === newUser.companyId);
                  const storeList = (selectedCompany as any)?.store_code_list || [];
                  
                  if (!newUser.companyId) {
                    return <p className="text-xs text-gray-400 py-2">먼저 소속 회사를 선택하세요</p>;
                  }
                  if (storeList.length === 0) {
                    return <p className="text-xs text-gray-400 py-2">이 회사는 분류 코드가 없습니다 (전체 접근)</p>;
                  }
                  
                  return (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {storeList.map((code: string) => {
                        const selected = newUser.storeCodes.split(',').map(s => s.trim()).filter(Boolean);
                        const isChecked = selected.includes(code);
                        return (
                          <label key={code} className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm cursor-pointer border transition-colors ${isChecked ? 'bg-blue-100 text-blue-800 border-blue-300' : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'}`}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                const newSelected = e.target.checked
                                  ? [...selected, code]
                                  : selected.filter(s => s !== code);
                                setNewUser({ ...newUser, storeCodes: newSelected.join(', ') });
                              }}
                              className="sr-only"
                            />
                            {code}
                          </label>
                        );
                      })}
                    </div>
                  );
                })()}
                <p className="text-xs text-gray-500 mt-2">비워두면 전체 고객 조회 가능</p>
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowUserModal(false)}
                  className="flex-1 px-4 py-2 border rounded-lg text-gray-700 hover:bg-gray-50"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  추가
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 사용자 수정 모달 */}
      {editingUser && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b bg-gradient-to-r from-blue-50 to-indigo-50">
              <h3 className="text-lg font-semibold text-gray-800">✏️ 사용자 수정</h3>
            </div>
            <form onSubmit={handleUpdateUser} className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">로그인 ID</label>
                <input
                  type="text"
                  value={editingUser.login_id}
                  disabled
                  className="w-full px-3 py-2 border rounded-lg bg-gray-100 text-gray-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">이름 *</label>
                <input
                  type="text"
                  value={editingUser.name}
                  onChange={(e) => setEditingUser({ ...editingUser, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">이메일</label>
                <input
                  type="email"
                  value={editingUser.email || ''}
                  onChange={(e) => setEditingUser({ ...editingUser, email: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">연락처</label>
                <input
                  type="text"
                  value={editingUser.phone || ''}
                  onChange={(e) => setEditingUser({ ...editingUser, phone: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">부서</label>
                <input
                  type="text"
                  value={editingUser.department || ''}
                  onChange={(e) => setEditingUser({ ...editingUser, department: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">권한</label>
                <select
                  value={editingUser.user_type}
                  onChange={(e) => setEditingUser({ ...editingUser, user_type: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="user">일반 사용자</option>
                  <option value="admin">회사 관리자</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">담당 분류 코드</label>
                {(() => {
                  const selectedCompany = companies.find(c => c.id === editingUser.company_id);
                  const storeList = (selectedCompany as any)?.store_code_list || [];
                  
                  if (storeList.length === 0) {
                    return <p className="text-xs text-gray-400">이 회사는 분류 코드가 없습니다 (전체 접근)</p>;
                  }
                  
                  return (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {storeList.map((code: string) => {
                        const selected = (editingUser.storeCodes || '').split(',').map((s: string) => s.trim()).filter(Boolean);
                        const isChecked = selected.includes(code);
                        return (
                          <label key={code} className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm cursor-pointer border transition-colors ${isChecked ? 'bg-blue-100 text-blue-800 border-blue-300' : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'}`}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                const newSelected = e.target.checked
                                  ? [...selected, code]
                                  : selected.filter((s: string) => s !== code);
                                setEditingUser({ ...editingUser, storeCodes: newSelected.join(', ') });
                              }}
                              className="sr-only"
                            />
                            {code}
                          </label>
                        );
                      })}
                    </div>
                  );
                })()}
                <p className="text-xs text-gray-500 mt-2">비워두면 전체 고객 조회 가능</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">상태</label>
                <select
                  value={editingUser.status}
                  onChange={(e) => setEditingUser({ ...editingUser, status: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="active">활성</option>
                  <option value="locked">잠금</option>
                  <option value="dormant">휴면</option>
                  </select>
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="flex-1 px-4 py-2 border rounded-lg text-gray-700 hover:bg-gray-50"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  저장
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 고객사 수정 모달 */}
      {showEditCompanyModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b">
              <h3 className="text-lg font-semibold">고객사 정보 수정</h3>
            </div>
            <form onSubmit={handleUpdateCompany} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  회사명 *
                </label>
                <input
                  type="text"
                  value={editCompany.companyName}
                  onChange={(e) => setEditCompany({ ...editCompany, companyName: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  담당자명
                </label>
                <input
                  type="text"
                  value={editCompany.contactName}
                  onChange={(e) => setEditCompany({ ...editCompany, contactName: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  이메일
                </label>
                <input
                  type="email"
                  value={editCompany.contactEmail}
                  onChange={(e) => setEditCompany({ ...editCompany, contactEmail: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  연락처
                </label>
                <input
                  type="text"
                  value={editCompany.contactPhone}
                  onChange={(e) => setEditCompany({ ...editCompany, contactPhone: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="010-0000-0000"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  요금제 *
                </label>
                <select
                  value={editCompany.planId}
                  onChange={(e) => setEditCompany({ ...editCompany, planId: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  required
                >
                  <option value="">선택하세요</option>
                  {plans.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.plan_name} ({plan.max_customers.toLocaleString()}명)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  상태 *
                </label>
                <select
                  value={editCompany.status}
                  onChange={(e) => setEditCompany({ ...editCompany, status: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="trial">체험</option>
                  <option value="active">활성</option>
                  <option value="suspended">정지</option>
                  <option value="terminated">해지</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  080 수신거부번호
                </label>
                <input
                  type="text"
                  value={editCompany.rejectNumber}
                  onChange={(e) => setEditCompany({ ...editCompany, rejectNumber: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="080-000-0000"
                />
              </div>

              {/* 발송 설정 섹션 */}
              <div className="pt-4 border-t">
                <h4 className="text-sm font-semibold text-gray-800 mb-3">📋 발송 설정</h4>
                
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      발송 시작 시간
                    </label>
                    <select
                      value={editCompany.sendHourStart}
                      onChange={(e) => setEditCompany({ ...editCompany, sendHourStart: Number(e.target.value) })}
                      className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    >
                      {Array.from({ length: 24 }, (_, i) => (
                        <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      발송 종료 시간
                    </label>
                    <select
                      value={editCompany.sendHourEnd}
                      onChange={(e) => setEditCompany({ ...editCompany, sendHourEnd: Number(e.target.value) })}
                      className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    >
                      {Array.from({ length: 24 }, (_, i) => (
                        <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="mt-3">
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    일일 발송 한도 (0 = 무제한)
                  </label>
                  <input
                    type="number"
                    value={editCompany.dailyLimit}
                    onChange={(e) => setEditCompany({ ...editCompany, dailyLimit: Number(e.target.value) })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    min="0"
                    placeholder="0"
                  />
                </div>

                <div className="mt-3">
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    중복 발송 방지 기간 (일)
                  </label>
                  <input
                    type="number"
                    value={editCompany.duplicateDays}
                    onChange={(e) => setEditCompany({ ...editCompany, duplicateDays: Number(e.target.value) })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    min="0"
                    placeholder="7"
                  />
                </div>

                <div className="mt-3 flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="holidaySend"
                    checked={editCompany.holidaySend}
                    onChange={(e) => setEditCompany({ ...editCompany, holidaySend: e.target.checked })}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                  />
                  <label htmlFor="holidaySend" className="text-sm text-gray-700">
                    휴일 발송 허용
                  </label>
                </div>
                </div>

{/* 단가 설정 섹션 */}
<div className="pt-4 border-t">
  <h4 className="text-sm font-semibold text-gray-800 mb-3">💰 단가 설정 (원)</h4>
  
  <div className="grid grid-cols-2 gap-3">
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">SMS</label>
      <input
        type="number"
        step="0.1"
        value={editCompany.costPerSms}
        onChange={(e) => setEditCompany({ ...editCompany, costPerSms: Number(e.target.value) })}
        className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
      />
    </div>
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">LMS</label>
      <input
        type="number"
        step="0.1"
        value={editCompany.costPerLms}
        onChange={(e) => setEditCompany({ ...editCompany, costPerLms: Number(e.target.value) })}
        className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
      />
    </div>
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">MMS</label>
      <input
        type="number"
        step="0.1"
        value={editCompany.costPerMms}
        onChange={(e) => setEditCompany({ ...editCompany, costPerMms: Number(e.target.value) })}
        className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
      />
    </div>
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">카카오</label>
      <input
        type="number"
        step="0.1"
        value={editCompany.costPerKakao}
        onChange={(e) => setEditCompany({ ...editCompany, costPerKakao: Number(e.target.value) })}
        className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
      />
    </div>
    </div>
</div>

{/* 🏷️ 분류 코드 관리 */}
<div className="pt-4 border-t">
  <h4 className="text-sm font-semibold text-gray-800 mb-3">🏷️ 분류 코드 관리</h4>
  <p className="text-xs text-gray-500 mb-3">브랜드, 팀 등으로 고객/사용자를 구분할 때 사용</p>
  
  <div className="flex flex-wrap gap-2 mb-3">
    {editCompany.storeCodeList.map((code, idx) => (
      <span key={idx} className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm">
        {code}
        <button
          type="button"
          onClick={() => setEditCompany({
            ...editCompany,
            storeCodeList: editCompany.storeCodeList.filter((_, i) => i !== idx)
          })}
          className="text-blue-600 hover:text-blue-800 font-bold"
        >
          ×
        </button>
      </span>
    ))}
    {editCompany.storeCodeList.length === 0 && (
      <span className="text-gray-400 text-sm">분류 코드 없음 (전체 공유)</span>
    )}
  </div>
  
  <div className="flex gap-2">
    <input
      type="text"
      value={editCompany.newStoreCode}
      onChange={(e) => setEditCompany({ ...editCompany, newStoreCode: e.target.value.toUpperCase() })}
      className="flex-1 px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
      placeholder="예: LUNA, BLOOM, ONLINE"
      onKeyPress={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const code = editCompany.newStoreCode.trim();
          if (code && !editCompany.storeCodeList.includes(code)) {
            setEditCompany({
              ...editCompany,
              storeCodeList: [...editCompany.storeCodeList, code],
              newStoreCode: ''
            });
          }
        }
      }}
    />
    <button
      type="button"
      onClick={() => {
        const code = editCompany.newStoreCode.trim();
        if (code && !editCompany.storeCodeList.includes(code)) {
          setEditCompany({
            ...editCompany,
            storeCodeList: [...editCompany.storeCodeList, code],
            newStoreCode: ''
          });
        }
      }}
      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
    >
      추가
    </button>
  </div>
</div>

<div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowEditCompanyModal(false)}
                  className="flex-1 px-4 py-2 border rounded-lg text-gray-700 hover:bg-gray-50"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  저장
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 예약 취소 모달 */}
      {showCancelModal && cancelTarget && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-center text-gray-900 mb-2">예약 취소</h3>
              <p className="text-sm text-center text-gray-600 mb-4">
                <span className="font-medium text-gray-900">"{cancelTarget.name}"</span> 캠페인을 취소하시겠습니까?
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  취소 사유 <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-red-500 outline-none resize-none"
                  rows={3}
                  placeholder="취소 사유를 입력해주세요 (이력 관리용)"
                  required
                />
              </div>
            </div>
            <div className="flex border-t">
              <button
                onClick={() => {
                  setShowCancelModal(false);
                  setCancelTarget(null);
                  setCancelReason('');
                }}
                className="flex-1 px-4 py-3 text-gray-700 font-medium hover:bg-gray-50 transition-colors border-r"
              >
                닫기
              </button>
              <button
                onClick={handleCancelCampaign}
                className="flex-1 px-4 py-3 text-red-600 font-medium hover:bg-red-50 transition-colors"
              >
                취소하기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 발신번호 등록 모달 */}
      {showCallbackModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b bg-gradient-to-r from-blue-50 to-indigo-50">
              <h3 className="text-lg font-semibold text-gray-800">📞 발신번호 등록</h3>
            </div>
            <form onSubmit={handleCreateCallback} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  고객사 *
                </label>
                <select
                  value={newCallback.companyId}
                  onChange={(e) => setNewCallback({ ...newCallback, companyId: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  required
                >
                  <option value="">선택하세요</option>
                  {companies.map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.company_name} ({company.company_code})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  발신번호 *
                </label>
                <input
                  type="text"
                  value={newCallback.phone}
                  onChange={(e) => setNewCallback({ ...newCallback, phone: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="02-1234-5678"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  별칭
                </label>
                <input
                  type="text"
                  value={newCallback.label}
                  onChange={(e) => setNewCallback({ ...newCallback, label: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="대표번호, 고객센터 등"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isDefault"
                  checked={newCallback.isDefault}
                  onChange={(e) => setNewCallback({ ...newCallback, isDefault: e.target.checked })}
                  className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                />
                <label htmlFor="isDefault" className="text-sm text-gray-700">
                  대표번호로 설정
                </label>
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowCallbackModal(false);
                    setNewCallback({ companyId: '', phone: '', label: '', isDefault: false });
                  }}
                  className="flex-1 px-4 py-2 border rounded-lg text-gray-700 hover:bg-gray-50"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  등록
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 요금제 추가 모달 */}
      {showPlanModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b bg-gradient-to-r from-green-50 to-emerald-50">
              <h3 className="text-lg font-semibold text-gray-800">💳 요금제 추가</h3>
            </div>
            <form onSubmit={handleCreatePlan} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">요금제 코드 *</label>
                <input
                  type="text"
                  value={newPlan.planCode}
                  onChange={(e) => setNewPlan({ ...newPlan, planCode: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 outline-none"
                  placeholder="예: BASIC, PRO, ENTERPRISE"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">요금제명 *</label>
                <input
                  type="text"
                  value={newPlan.planName}
                  onChange={(e) => setNewPlan({ ...newPlan, planName: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 outline-none"
                  placeholder="예: 베이직, 프로, 엔터프라이즈"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">최대 고객수 *</label>
                <input
                  type="number"
                  value={newPlan.maxCustomers}
                  onChange={(e) => setNewPlan({ ...newPlan, maxCustomers: Number(e.target.value) })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 outline-none"
                  min="0"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">월 요금 (원) *</label>
                <input
                  type="number"
                  value={newPlan.monthlyPrice}
                  onChange={(e) => setNewPlan({ ...newPlan, monthlyPrice: Number(e.target.value) })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 outline-none"
                  min="0"
                  required
                />
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowPlanModal(false);
                    setNewPlan({ planCode: '', planName: '', maxCustomers: 1000, monthlyPrice: 0 });
                  }}
                  className="flex-1 px-4 py-2 border rounded-lg text-gray-700 hover:bg-gray-50"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                >
                  등록
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 요금제 수정 모달 */}
      {editingPlan && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b bg-gradient-to-r from-blue-50 to-indigo-50">
              <h3 className="text-lg font-semibold text-gray-800">✏️ 요금제 수정</h3>
            </div>
            <form onSubmit={handleUpdatePlan} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">요금제 코드</label>
                <input
                  type="text"
                  value={editingPlan.plan_code}
                  disabled
                  className="w-full px-3 py-2 border rounded-lg bg-gray-100 text-gray-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">요금제명 *</label>
                <input
                  type="text"
                  value={editingPlan.plan_name}
                  onChange={(e) => setEditingPlan({ ...editingPlan, plan_name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">최대 고객수 *</label>
                <input
                  type="number"
                  value={editingPlan.max_customers}
                  onChange={(e) => setEditingPlan({ ...editingPlan, max_customers: Number(e.target.value) })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  min="0"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">월 요금 (원) *</label>
                <input
                  type="number"
                  value={editingPlan.monthly_price}
                  onChange={(e) => setEditingPlan({ ...editingPlan, monthly_price: Number(e.target.value) })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  min="0"
                  required
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="planActive"
                  checked={editingPlan.is_active}
                  onChange={(e) => setEditingPlan({ ...editingPlan, is_active: e.target.checked })}
                  className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                />
                <label htmlFor="planActive" className="text-sm text-gray-700">활성화</label>
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setEditingPlan(null)}
                  className="flex-1 px-4 py-2 border rounded-lg text-gray-700 hover:bg-gray-50"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  저장
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===== 커스텀 모달들 ===== */}
      
      {/* 확인 모달 (Confirm) */}
      {modal.type === 'confirm' && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6">
              <div className="w-12 h-12 rounded-full bg-orange-100 flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-center text-gray-900 mb-2">{modal.title}</h3>
              <p className="text-sm text-center text-gray-600 whitespace-pre-line">{modal.message}</p>
            </div>
            <div className="flex border-t">
              <button
                onClick={closeModal}
                className="flex-1 px-4 py-3 text-gray-700 font-medium hover:bg-gray-50 transition-colors border-r"
              >
                취소
              </button>
              <button
                onClick={() => modal.onConfirm?.()}
                className="flex-1 px-4 py-3 text-orange-600 font-medium hover:bg-orange-50 transition-colors"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 알림 모달 (Alert) */}
      {modal.type === 'alert' && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4 ${
                modal.variant === 'success' ? 'bg-green-100' :
                modal.variant === 'error' ? 'bg-red-100' :
                modal.variant === 'warning' ? 'bg-yellow-100' : 'bg-blue-100'
              }`}>
                {modal.variant === 'success' && (
                  <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
                {modal.variant === 'error' && (
                  <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                )}
                {modal.variant === 'warning' && (
                  <svg className="w-6 h-6 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                )}
                {modal.variant === 'info' && (
                  <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
              </div>
              <h3 className="text-lg font-semibold text-center text-gray-900 mb-2">{modal.title}</h3>
              <p className="text-sm text-center text-gray-600">{modal.message}</p>
            </div>
            <div className="border-t">
              <button
                onClick={closeModal}
                className={`w-full px-4 py-3 font-medium transition-colors ${
                  modal.variant === 'success' ? 'text-green-600 hover:bg-green-50' :
                  modal.variant === 'error' ? 'text-red-600 hover:bg-red-50' :
                  modal.variant === 'warning' ? 'text-yellow-600 hover:bg-yellow-50' : 'text-blue-600 hover:bg-blue-50'
                }`}
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 비밀번호 모달 (복사 기능 포함) */}
      {modal.type === 'password' && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6">
              <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-center text-gray-900 mb-4">{modal.title}</h3>
              
              <div className="bg-gray-50 rounded-xl p-4 mb-4">
                <p className="text-xs text-gray-500 mb-2 text-center">임시 비밀번호</p>
                <div className="flex items-center justify-center gap-2">
                  <code className="text-2xl font-mono font-bold text-gray-900 tracking-wider">
                    {modal.password}
                  </code>
                  <button
                    onClick={handleCopyPassword}
                    className={`p-2 rounded-lg transition-all ${
                      copied 
                        ? 'bg-green-100 text-green-600' 
                        : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                    }`}
                    title="복사하기"
                  >
                    {copied ? (
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                      </svg>
                    )}
                  </button>
                </div>
                {copied && (
                  <p className="text-xs text-green-600 text-center mt-2">복사되었습니다!</p>
                )}
              </div>
              
              {modal.smsSent && modal.phone && (
                <div className="bg-blue-50 rounded-lg p-3 mb-4">
                  <p className="text-sm text-blue-800 text-center">
                    📱 <strong>{modal.phone}</strong>로 SMS 발송 완료
                  </p>
                </div>
              )}
              {!modal.smsSent && (
                <div className="bg-yellow-50 rounded-lg p-3 mb-4">
                  <p className="text-sm text-yellow-800 text-center">
                    ⚠️ 휴대폰 번호가 없어 SMS를 발송하지 못했습니다
                  </p>
                </div>
              )}
              
              <p className="text-xs text-gray-500 text-center">
                {modal.smsSent ? '사용자에게 SMS로 전달되었습니다.' : '사용자에게 직접 전달해주세요.'}<br/>
                최초 로그인 시 비밀번호 변경이 필요합니다.
              </p>
            </div>
            <div className="border-t">
              <button
                onClick={closeModal}
                className="w-full px-4 py-3 text-blue-600 font-medium hover:bg-blue-50 transition-colors"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
