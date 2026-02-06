import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

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
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Auth
export const authApi = {
  login: (data: { loginId: string; password: string }) =>
    api.post('/auth/login', data),
  changePassword: (data: { currentPassword: string; newPassword: string }) =>
    api.post('/auth/change-password', data),
};

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
};

export default api;
