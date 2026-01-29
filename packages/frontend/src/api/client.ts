import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
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

// Auth API
export const authApi = {
  login: (data: { loginId: string; password: string; userType?: string }) =>
    api.post('/auth/login', data),
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
};

// Campaigns API
export const campaignsApi = {
  list: (params?: any) => api.get('/campaigns', { params }),
  create: (data: any) => api.post('/campaigns', data),
  send: (id: string) => api.post(`/campaigns/${id}/send`),
};

export default api;
