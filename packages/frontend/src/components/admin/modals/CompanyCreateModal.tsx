/**
 * CompanyCreateModal — 슈퍼관리자 AdminDashboard 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch, SetStateAction } from 'react';
import { formatPlanOptionLabel } from '../../../utils/planLabel';
import { companiesApi } from '../../../api/client';
import type { Company } from '../admin-types';
import type { Plan } from '../admin-types';

export interface CompanyCreateModalProps {
  companies: Company[];
  loadData: () => Promise<void>;
  newCompany: { companyCode: string; companyName: string; contactName: string; contactEmail: string; contactPhone: string; planId: string; usageType: string; };
  newUser: { companyId: string; loginId: string; password: string; name: string; email: string; phone: string; department: string; userType: string; storeCodes: string; };
  plans: Plan[];
  setNewCompany: Dispatch<SetStateAction<{ companyCode: string; companyName: string; contactName: string; contactEmail: string; contactPhone: string; planId: string; usageType: string; }>>;
  setNewUser: Dispatch<SetStateAction<{ companyId: string; loginId: string; password: string; name: string; email: string; phone: string; department: string; userType: string; storeCodes: string; }>>;
  setShowCompanyModal: Dispatch<SetStateAction<boolean>>;
  showAlert: (title: string, message: string, variant?: 'success' | 'error' | 'warning' | 'info') => void;
}

export default function CompanyCreateModal(props: CompanyCreateModalProps) {
  const { companies, loadData, newCompany, newUser, plans, setNewCompany, setNewUser, setShowCompanyModal, showAlert } = props;

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
        usageType: 'web',
      });
      loadData();
      showAlert('성공', '고객사가 생성되었습니다.', 'success');
    } catch (error: any) {
      showAlert('오류', error.response?.data?.error || '생성 실패', 'error');
    }
  };
  return (
    <>
    {(
        <div className="fixed inset-0 bg-gray-900/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="px-5 py-3.5 border-b border-gray-100">
              <h3 className="text-base font-semibold">새 고객사 추가</h3>
            </div>
            <form onSubmit={handleCreateCompany} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  고객사 코드 *
                </label>
                <input
                  type="text"
                  value={newCompany.companyCode}
                  onChange={(e) => setNewCompany({ ...newCompany, companyCode: e.target.value })}
                  className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none"
                  placeholder="예: ABC001"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  회사명 *
                </label>
                <input
                  type="text"
                  value={newCompany.companyName}
                  onChange={(e) => setNewCompany({ ...newCompany, companyName: e.target.value })}
                  className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none"
                  placeholder="예: ABC 주식회사"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  담당자명
                </label>
                <input
                  type="text"
                  value={newCompany.contactName}
                  onChange={(e) => setNewCompany({ ...newCompany, contactName: e.target.value })}
                  className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  이메일
                </label>
                <input
                  type="email"
                  value={newCompany.contactEmail}
                  onChange={(e) => setNewCompany({ ...newCompany, contactEmail: e.target.value })}
                  className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  요금제 *
                </label>
                <select
                  value={newCompany.planId}
                  onChange={(e) => setNewCompany({ ...newCompany, planId: e.target.value })}
                  className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none"
                  required
                >
                  <option value="">선택하세요</option>
                  {plans.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {formatPlanOptionLabel(plan.plan_name, plan.monthly_price)}
                    </option>
                  ))}
                </select>
              </div>
              {/* ★ 2026-07-03 사용구분 — web(웹발송) / agent(QTmsg 에이전트 전용) / both(웹+에이전트) */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  사용구분 *
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { value: 'web', label: '웹발송', desc: '한줄로 전체 기능' },
                    { value: 'agent', label: '에이전트', desc: '카카오템플릿+결과만' },
                    { value: 'both', label: '웹+에이전트', desc: '웹 발송과 에이전트 발송을 함께 사용' },
                  ] as const).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setNewCompany({ ...newCompany, usageType: opt.value })}
                      className={`px-2 py-2 rounded-lg border text-center transition ${
                        newCompany.usageType === opt.value
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                          : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      <div className="text-sm font-medium">{opt.label}</div>
                      <div className="text-[10px] text-gray-400 mt-0.5">{opt.desc}</div>
                    </button>
                  ))}
                </div>
                {newCompany.usageType === 'agent' && (
                  <p className="text-xs text-amber-600 mt-1.5">
                    에이전트 전용 계정은 로그인 시 카카오 템플릿 관리만 접근 가능합니다 (대시보드 차단).
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
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
                          <label key={code} className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[13px] cursor-pointer border transition-colors ${isChecked ? 'bg-blue-100 text-blue-800 border-blue-300' : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'}`}>
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
                  className="whitespace-nowrap flex-1 px-4 py-2 border rounded-lg text-gray-700 hover:bg-gray-50"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="whitespace-nowrap flex-1 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
                >
                  추가
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
