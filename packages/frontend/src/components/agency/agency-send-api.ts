/**
 * agency-send-api.ts — 대행발송 API 얇은 미러 (★ 2026-08-22)
 *
 * 설계 = docs/2026-08-22-agency-send-design.md §4-6. 판정·상태는 전부 서버가 준다.
 * ⛔ 프론트가 자격을 다시 계산하지 않는다. `agency_send_allowed`와 API 응답만 믿는다.
 */

export type AgencySendStatus =
  | 'received' | 'testing' | 'awaiting_approval' | 'test_failed' | 'approved'
  | 'final_testing' | 'queued' | 'reapproval' | 'expired' | 'cancelled';

export interface AgencySendRequest {
  id: string;
  status: AgencySendStatus;
  messageType: 'SMS' | 'LMS' | 'MMS';
  subject: string | null;
  isAd: boolean;
  callbackNumber: string;
  managerPhone: string;
  originalContent: string;
  currentContent: string;
  contentVersion: number;
  mmsImagePaths: string[];
  requestedAt: string;
  recipientCount: number;
  fileName: string | null;
  varMapping: Record<string, string>;
  testRound: number;
  lastTestAt: string | null;
  lastTestResult: any;
  approvedAt: string | null;
  approvalVersion: number | null;
  reapprovalCount: number;
  queuedAt: string | null;
  campaignId: string | null;
  expiredAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
}

export interface AgencySendEvent {
  kind: string;
  payload: any;
  created_at: string;
}

const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('token') || ''}` });
const json = () => ({ 'Content-Type': 'application/json', ...auth() });

async function unwrap(res: Response): Promise<any> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) {
    const err: any = new Error(data?.error || '요청을 처리하지 못했습니다.');
    err.code = data?.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function fetchAgencyRequests(): Promise<AgencySendRequest[]> {
  const res = await fetch('/api/agency-send', { headers: auth() });
  const data = await unwrap(res);
  return data.requests || [];
}

export async function fetchAgencyRequest(id: string): Promise<{ request: AgencySendRequest; events: AgencySendEvent[] }> {
  const res = await fetch(`/api/agency-send/${id}`, { headers: auth() });
  const data = await unwrap(res);
  return { request: data.request, events: data.events || [] };
}

export interface CreateAgencyRequestInput {
  messageType: 'SMS' | 'LMS' | 'MMS';
  subject?: string;
  content: string;
  isAd: boolean;
  callbackNumber: string;
  managerPhone: string;
  requestedAt: string;
  mmsImagePaths?: string[];
  fileName?: string | null;
  phoneColumn: string;
  varMapping: Record<string, string>;
  recipients: Array<{ phone: string; vars: Record<string, any> }>;
}

export async function createAgencyRequest(input: CreateAgencyRequestInput): Promise<AgencySendRequest> {
  const res = await fetch('/api/agency-send', { method: 'POST', headers: json(), body: JSON.stringify(input) });
  const data = await unwrap(res);
  return data.request;
}

export async function approveAgencyRequest(id: string, contentVersion: number): Promise<AgencySendRequest> {
  const res = await fetch(`/api/agency-send/${id}/approve`, {
    method: 'POST', headers: json(), body: JSON.stringify({ contentVersion }),
  });
  return (await unwrap(res)).request;
}

export async function updateAgencyContent(id: string, content: string, subject?: string): Promise<AgencySendRequest> {
  const res = await fetch(`/api/agency-send/${id}/content`, {
    method: 'POST', headers: json(), body: JSON.stringify({ content, subject }),
  });
  return (await unwrap(res)).request;
}

export async function rescheduleAgencyRequest(id: string, requestedAt: string): Promise<AgencySendRequest> {
  const res = await fetch(`/api/agency-send/${id}/reschedule`, {
    method: 'POST', headers: json(), body: JSON.stringify({ requestedAt }),
  });
  return (await unwrap(res)).request;
}

export async function cancelAgencyRequest(id: string, reason?: string): Promise<AgencySendRequest> {
  const res = await fetch(`/api/agency-send/${id}/cancel`, {
    method: 'POST', headers: json(), body: JSON.stringify({ reason }),
  });
  return (await unwrap(res)).request;
}

// ────────────── 화면 표시용 (상태 하나가 두 곳에서 다르게 읽히지 않게 여기 모은다) ──────────────

export const STATUS_LABEL: Record<AgencySendStatus, string> = {
  received: '검사 대기',
  testing: '검사 중',
  awaiting_approval: '승인 대기',
  test_failed: '문안 확인 필요',
  approved: '발송 예정',
  final_testing: '발송 전 검사 중',
  queued: '예약 완료',
  reapproval: '재승인 대기',
  expired: '미발송',
  cancelled: '취소됨',
};

export const STATUS_TONE: Record<AgencySendStatus, 'neutral' | 'amber' | 'blue' | 'green' | 'rose'> = {
  received: 'neutral',
  testing: 'blue',
  awaiting_approval: 'amber',
  test_failed: 'rose',
  approved: 'blue',
  final_testing: 'blue',
  queued: 'green',
  reapproval: 'amber',
  expired: 'rose',
  cancelled: 'neutral',
};

/** 담당자가 지금 승인할 수 있는 상태인가(서버가 최종 판정하고, 화면은 버튼을 켜고 끄는 데만 쓴다) */
export function isApprovable(status: AgencySendStatus): boolean {
  return status === 'awaiting_approval' || status === 'reapproval';
}

/** 문안·시각을 고칠 수 있는 상태인가 */
export function isEditableStatus(status: AgencySendStatus): boolean {
  return status === 'awaiting_approval' || status === 'reapproval' || status === 'test_failed' || status === 'expired';
}

export function isCancelable(status: AgencySendStatus): boolean {
  return status !== 'cancelled' && status !== 'testing' && status !== 'final_testing';
}

/** 요청 시각을 화면에 쓰는 형태로 */
export function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

/** `<input type="datetime-local">`이 쓰는 문자열로 (로컬 시각) */
export function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
