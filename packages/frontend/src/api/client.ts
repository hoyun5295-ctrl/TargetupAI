import axios from 'axios';
import { attachCreditInterceptor } from '../lib/credit-interceptor';

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});
attachCreditInterceptor(api);

// 요청 인터셉터 - 토큰 추가
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 응답 인터셉터 - 401 처리
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const data = error.response.data;

      localStorage.removeItem('token');
      localStorage.removeItem('user');

      // 강제 로그아웃 (다른 곳에서 로그인)
      if (data?.forceLogout) {
        sessionStorage.setItem('forceLogoutReason', data.error || '다른 곳에서 로그인되어 현재 세션이 종료되었습니다.');
      }

      // 이미 로그인 페이지면 무시
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// Auth API
// ★ D111 P0: appSource='hanjul' 기본 (한줄로 메인 hanjul.ai). 슈퍼관리자 경로는 백엔드가 userType으로 'super'로 덮어씀
export const authApi = {
  login: (data: { loginId: string; password: string; userType?: string; appSource?: string }) =>
    api.post('/auth/login', { appSource: 'hanjul', ...data }),
};

// Companies API
export const companiesApi = {
  list: (params?: any) => api.get('/companies', { params }),
  get: (id: string) => api.get(`/companies/${id}`),
  create: (data: any) => api.post('/companies', data),
  update: (id: string, data: any) => api.put(`/companies/${id}`, data),
  createAdmin: (id: string, data: any) => api.post(`/companies/${id}/admin`, data),
};

// Plans API
export const plansApi = {
  list: () => api.get('/plans'),
};

// Customers API
export const customersApi = {
  list: (params?: any) => api.get('/customers', { params }),
  create: (data: any) => api.post('/customers', data),
  bulkCreate: (customers: any[]) => api.post('/customers/bulk', { customers }),
  stats: () => api.get('/customers/stats'),
  deleteOne: (id: string) => api.delete(`/customers/${id}`),
  bulkDelete: (ids: string[]) => api.post('/customers/bulk-delete', { ids }),
  // ★ 2026-07-03: 고객별 구매 이력 (app.hanjul.ai CustomersTab과 동일 endpoint)
  purchases: (id: string, params?: any) => api.get(`/customers/${id}/purchases`, { params }),
  // ★ 2026-07-08: 구매 통합조회 (전 고객 원장 + 고객/매장별 기간 합계)
  purchaseOverview: (params?: any) => api.get('/customers/purchases/overview', { params }),
};

// Campaigns API
export const campaignsApi = {
  list: (params?: any) => api.get('/campaigns', { params }),
  create: (data: any) => api.post('/campaigns', data),
  send: (id: string, data?: any) => api.post(`/campaigns/${id}/send`, data || {}),
  cancel: (id: string) => api.post(`/campaigns/${id}/cancel`),
};

// AI API
export const aiApi = {
  status: () => api.get('/ai/status'),
  generateMessage: (data: any) => api.post('/ai/generate-message', data),
  recommendTarget: (data: any) => api.post('/ai/recommend-target', data),
};

// Billing API
export const billingApi = {
  // 기존 거래내역서
  preview: (params: any) => api.get('/admin/billing/preview', { params }),
  createInvoice: (data: any) => api.post('/admin/billing/invoices', data),
  getInvoices: (params?: any) => api.get('/admin/billing/invoices', { params }),
  getInvoice: (id: string) => api.get(`/admin/billing/invoices/${id}`),
  updateStatus: (id: string, status: string) => api.put(`/admin/billing/invoices/${id}/status`, { status }),
  getPdf: (id: string) => api.get(`/admin/billing/invoices/${id}/pdf`),
  // 정산
  // ★ 2026-07-26 발행 단위(scope) — 단일 계정 지정(user_id)은 서버가 422로 차단한다
  //   (테스트·스팸·에이전트·크레딧이 빠진 청구서를 만들던 옛 방식). 계정별은 scope='by_user'로
  //   회사 전체가 계정 장 N + 공통 장 1 묶음으로 나온다.
  generateBilling: (data: { company_id: string; scope?: 'combined' | 'by_user'; billing_start: string; billing_end: string }) =>
    api.post('/admin/billing/generate', data),
  getBillings: (params?: { company_id?: string; year?: number; status?: string }) =>
    api.get('/admin/billing/list', { params }),
  getBillingItems: (id: string) =>
    api.get(`/admin/billing/${id}/items`),
  updateBillingStatus: (id: string, status: string) =>
    api.put(`/admin/billing/${id}/status`, { status }),
  // ★ 2026-07-26 확정·수금·메일 발송분은 서버가 사유를 요구한다(BILLING_DELETE_NEEDS_REASON 422).
  //   묶음(batch) 발행분은 서버가 묶음 전체를 원자적으로 지운다.
  deleteBilling: (id: string, reason?: string) =>
    api.delete(`/admin/billing/${id}`, reason ? { data: { reason } } : undefined),
  getCompanyUsers: (companyId: string) =>
    api.get(`/admin/billing/company-users/${companyId}`),
  // ★ 2026-07-26 본문(body_html) 전송 폐기 — 서버가 `billing_items`에서 항목표를 만들고
  //   정합 검사(BILLING_ITEM_HEADER_MISMATCH)를 통과한 본문만 보낸다. 화면이 만든 본문을 넘기면
  //   그 검사를 우회해 항목 합계가 안 맞는 청구서가 고객에게 나간다(회수 불가).
  //   수신자·제목은 그 자리에서 고칠 수 있으므로 그대로 넘긴다.
  //   `resend`는 이미 발송된 정산서를 다시 보낼 때만 true — 서버가 409(BILLING_ALREADY_EMAILED)로
  //   한 번 되돌려 확인을 받는다(같은 청구서가 확인 없이 두 번 나가는 것을 막는다).
  //   `resend_of`는 그 409에서 받은 발송 시각이다. 확인을 **그 이력에 묶어** 두 사람이 동시에
  //   확인 화면을 보고 있을 때 뒤늦은 클릭이 남의 발송을 못 보고 또 보내는 것을 막는다.
  sendBillingEmail: (id: string, data: { to: string; subject: string; resend?: boolean; resend_of?: string }) =>
    api.post(`/admin/billing/${id}/send-email`, data),
};

// ===== 고객사 관리자 전용 API (manage) =====

// 사용자 관리
export const manageUsersApi = {
  list: () => api.get('/manage/users'),
  create: (data: any) => api.post('/manage/users', data),
  update: (id: string, data: any) => api.put(`/manage/users/${id}`, data),
  delete: (id: string) => api.delete(`/manage/users/${id}`),
  resetPassword: (id: string) => api.post(`/manage/users/${id}/reset-password`),
};

// 발신번호 관리
export const manageCallbacksApi = {
  list: () => api.get('/manage/callbacks'),
  create: (data: any) => api.post('/manage/callbacks', data),
  update: (id: string, data: any) => api.put(`/manage/callbacks/${id}`, data),
  delete: (id: string) => api.delete(`/manage/callbacks/${id}`),
  setDefault: (id: string) => api.put(`/manage/callbacks/${id}/default`),
  // D87: 배정 관리
  updateScope: (id: string, scope: 'all' | 'assigned') => api.put(`/manage/callbacks/${id}/scope`, { scope }),
  getAssignments: (id: string) => api.get(`/manage/callbacks/${id}/assignments`),
  saveAssignments: (id: string, userIds: string[]) => api.put(`/manage/callbacks/${id}/assignments`, { userIds }),
  removeAssignment: (id: string, userId: string) => api.delete(`/manage/callbacks/${id}/assignments/${userId}`),
};

// 예약 캠페인 관리
export const manageScheduledApi = {
  list: () => api.get('/manage/scheduled'),
  cancel: (id: string, reason: string) => api.post(`/manage/scheduled/${id}/cancel`, { reason }),
};

// 발송 통계
export const manageStatsApi = {
  send: (params: any) => api.get('/manage/stats/send', { params }),
  sendDetail: (params: any) => api.get('/manage/stats/send/detail', { params }),
  // ★ 2026-07-23 (서수란) 발송 통계 엑셀(CSV) 다운로드 — 웹+에이전트 합산
  exportCsv: (params: any) => api.get('/manage/stats/send/export', { params, responseType: 'blob' }),
};

export default api;
