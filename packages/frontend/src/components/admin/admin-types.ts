/**
 * admin-types.ts — 슈퍼관리자 화면 공용 타입(★ 2026-10-09 파일 분리 E · AdminDashboard.tsx 맨 위에서 원문 그대로 옮김)
 */
export interface Company {
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
  usage_type?: 'web' | 'agent' | 'both'; // ★ 2026-07-03 사용구분
  // ★ 2026-10-09 목록 응답(c.* + p.plan_code)에 이미 실려 오던 칸 — 요금 구분(utils/planLabel.ts companyPlanState)에 쓴다
  plan_code?: string | null;
  subscription_status?: string | null;
  trial_expires_at?: string | null;
}

export interface Plan {
  id: string;
  plan_code: string;
  plan_name: string;
  max_customers: number;
  monthly_price: number;
}

export interface User {
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
export interface ModalState {
  type: 'confirm' | 'alert' | 'password' | null;
  title: string;
  message: string;
  variant?: 'success' | 'error' | 'warning' | 'info';
  password?: string;
  smsSent?: boolean;
  phone?: string;
  onConfirm?: () => void;
}
