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
  status: string;
  total_customers: number;
  plan_name: string;
  created_at: string;
}

interface Plan {
  id: string;
  plan_code: string;
  plan_name: string;
  max_customers: number;
  monthly_price: number;
}

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  
  const [companies, setCompanies] = useState<Company[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  
  // 새 고객사 폼
  const [newCompany, setNewCompany] = useState({
    companyCode: '',
    companyName: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    planId: '',
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
    } catch (error) {
      console.error('데이터 로드 실패:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await companiesApi.create(newCompany);
      setShowModal(false);
      setNewCompany({
        companyCode: '',
        companyName: '',
        contactName: '',
        contactEmail: '',
        contactPhone: '',
        planId: '',
      });
      loadData();
    } catch (error: any) {
      alert(error.response?.data?.error || '생성 실패');
    }
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
    };
    const labels: Record<string, string> = {
      trial: '체험',
      active: '활성',
      suspended: '정지',
      terminated: '해지',
    };
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status] || styles.trial}`}>
        {labels[status] || status}
      </span>
    );
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
            <div className="text-sm text-gray-500">체험 중</div>
            <div className="text-3xl font-bold text-yellow-600">
              {companies.filter(c => c.status === 'trial').length}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm text-gray-500">요금제</div>
            <div className="text-3xl font-bold text-blue-600">{plans.length}개</div>
          </div>
        </div>

        {/* 고객사 목록 */}
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b flex justify-between items-center">
            <h2 className="text-lg font-semibold">고객사 목록</h2>
            <button
              onClick={() => setShowModal(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
            >
              + 고객사 추가
            </button>
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
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {companies.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                      등록된 고객사가 없습니다.
                    </td>
                  </tr>
                ) : (
                  companies.map((company) => (
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
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* 고객사 추가 모달 */}
      {showModal && (
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
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
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
    </div>
  );
}
