/**
 * agency-send-api.ts — 대행발송 API 얇은 미러 (★ 2026-08-22)
 *
 * 설계 = docs/2026-08-22-agency-send-design.md §4-6. 판정·상태는 전부 서버가 준다.
 * ⛔ 프론트가 자격을 다시 계산하지 않는다. `agency_send_allowed`와 API 응답만 믿는다.
 */

export type AgencySendStatus =
  | 'received' | 'testing' | 'awaiting_approval' | 'test_failed' | 'approved'
  | 'final_testing' | 'queued' | 'reapproval' | 'expired' | 'cancelling' | 'cancelled';

export interface AgencySendRequest {
  id: string;
  status: AgencySendStatus;
  /** ★2026-08-26 §18 접수 출처. 라벨은 SOURCE_LABEL 하나가 소유한다(fileName 유무 추정 금지) */
  source: 'screen' | 'one_step' | 'email';
  messageType: 'SMS' | 'LMS' | 'MMS';
  subject: string | null;
  isAd: boolean;
  callbackNumber: string;
  managerPhone: string;
  /** 테스트 문자를 받을 담당자 번호들. 여러 명일 수 있다 */
  managerPhones: string[];
  originalContent: string;
  currentContent: string;
  contentVersion: number;
  /**
   * 행 수정 번호. **승인·문안 수정·시각 변경은 이 값을 그대로 되돌려준다**(낙관적 잠금).
   * 화면이 보고 있던 것과 서버의 것이 다르면 서버가 거절한다 — 담당자가 못 본 문안이나 시각으로
   * 승인이 통과하는 것을 막는 자리다.
   */
  revision: number;
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
  /** 발송 직전 검사를 이미 통과한 문안인가. 값이 있으면 승인 즉시 예약된다 */
  finalTestedAt: string | null;
  /**
   * 발송 전에 검사가 한 번 더 남았는가. 접수한 그날 나가는 건은 접수 검사가 곧 당일 검사라 false다.
   * ⛔ 화면에서 날짜를 다시 계산하지 않는다. 판정은 서버 하나가 소유한다.
   */
  finalTestRequired: boolean;
  reapprovalCount: number;
  queuedAt: string | null;
  campaignId: string | null;
  expiredAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  /**
   * ★2026-08-26(2) 접수 계정 이름. **관리자 응답에만 실려 온다**(일반 사용자는 본인 것만 보므로 키 없음).
   * 값이 있으면 목록·상세가 "누가 낸 접수인지"를 보여준다.
   */
  createdByName?: string | null;
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

/** 재접수(같은 내용으로 다시 접수)용 수신자 목록. 읽기 전용이고, 새 접수는 기존 접수 API를 그대로 탄다 */
export async function fetchAgencyRecipients(id: string): Promise<Array<{ phone: string; vars: Record<string, any> }>> {
  const res = await fetch(`/api/agency-send/${id}/recipients`, { headers: auth() });
  const data = await unwrap(res);
  return data.recipients || [];
}

/**
 * 업로드한 열 이름에서 전화번호 열을 AI가 고른다(★2026-08-25 · Harold "AI 자동매핑까지").
 * 기존 고객DB 업로드의 AI 매핑 endpoint를 그대로 쓴다(`/api/upload/ai-map-columns` · 판정 서버 소유).
 * 요금제에 없거나 실패하면 null을 돌려주고 화면은 기존 추정 규칙으로 폴백한다. 접수를 막지 않는다.
 */
export async function aiGuessPhoneColumn(
  columnNames: string[], sampleRows: any[][],
): Promise<{ phoneColumn: string; needsManualReview: boolean } | null> {
  try {
    const res = await fetch('/api/upload/ai-map-columns', {
      method: 'POST', headers: json(), body: JSON.stringify({ columnNames, sampleRows }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.success) return null;
    const hit = (data.mappings || []).find((m: any) => m?.target === 'phone' && m?.source);
    if (!hit) return null;
    return { phoneColumn: String(hit.source), needsManualReview: !!data.needsManualReview };
  } catch {
    return null;
  }
}

export interface CreateAgencyRequestInput {
  messageType: 'SMS' | 'LMS' | 'MMS';
  subject?: string;
  content: string;
  isAd: boolean;
  callbackNumber: string;
  managerPhones: string[];
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

export async function approveAgencyRequest(id: string, revision: number): Promise<AgencySendRequest> {
  const res = await fetch(`/api/agency-send/${id}/approve`, {
    method: 'POST', headers: json(), body: JSON.stringify({ revision }),
  });
  return (await unwrap(res)).request;
}

export async function updateAgencyContent(
  id: string, content: string, revision: number, subject?: string,
): Promise<AgencySendRequest> {
  const res = await fetch(`/api/agency-send/${id}/content`, {
    method: 'POST', headers: json(), body: JSON.stringify({ content, subject, revision }),
  });
  return (await unwrap(res)).request;
}

export async function rescheduleAgencyRequest(
  id: string, requestedAt: string, revision: number,
): Promise<AgencySendRequest> {
  const res = await fetch(`/api/agency-send/${id}/reschedule`, {
    method: 'POST', headers: json(), body: JSON.stringify({ requestedAt, revision }),
  });
  return (await unwrap(res)).request;
}

/**
 * 취소. **큐 삭제가 아직 안 끝났으면 `pending`으로 돌아온다**(상태는 "취소 중").
 * 취소는 원장과 발송 큐 두 곳을 건드리는 다단계 작업이라, 큐가 지워졌음을 확인하기 전에는 확정하지 않는다.
 */
export async function cancelAgencyRequest(
  id: string, reason?: string,
): Promise<{ request: AgencySendRequest; pending: boolean }> {
  const res = await fetch(`/api/agency-send/${id}/cancel`, {
    method: 'POST', headers: json(), body: JSON.stringify({ reason }),
  });
  const data = await unwrap(res);
  return { request: data.request, pending: !!data.pending };
}

// ────────────── 요청서 원스텝 접수 (★2026-08-25(3) · 서버가 파싱·검증·집계) ──────────────

export interface OneStepAnalysisView {
  subject: string;
  content: string;
  isAd: boolean;
  requestedAt: string | null;
  managerPhones: string[];
  callback: { mode: 'fixed'; number: string } | { mode: 'column'; column: string } | { mode: 'none' };
  headers: string[];
  phoneColumn: string | null;
  /** via: same = 같은 이름 자동 · override = 화면에서 고른 열 · ai = AI 추천(초회 분석에만 온다) */
  varsMatched: Array<{ name: string; column: string | null; via: 'same' | 'override' | 'ai' | null }>;
  counts: { total: number; valid: number; dup: number; invalid: number; callbackMissing: number };
  groups: Array<{ callback: string; count: number; registered: boolean }>;
  /** 상위 50건만 온다 — 전 행은 서버가 갖고 화면은 숫자와 샘플만 본다 */
  sample: Array<{ phone: string; callback?: string }>;
  /** 명단 미리보기용 파일 순서 상위 50행 전체 열 값(제외 전 원본 · 열 순서 = headers) */
  sampleRows: Array<Array<string | number | null>>;
  messageType: 'SMS' | 'LMS' | 'MMS';
  fileName: string | null;
  errors: Array<{ field: string; error: string }>;
}

export interface OneStepOverrides {
  /** 항상 보낸다. 빈 문자열 = "비워 둔 상태"라는 의도이고 서버가 반려한다(조용한 원값 복귀 금지) */
  requestedAt?: string;
  callback?: { mode: 'fixed'; number: string } | { mode: 'column'; column: string };
  /** 항상 보낸다. 빈 배열 = 전부 지웠다는 의도이고 서버가 반려한다 */
  managerPhones?: string[];
  mmsImagePaths?: string[];
  /** 수신자(휴대폰 번호) 열 직접 선택. 자동 선정이 애매한 파일 대비 */
  phoneColumn?: string;
  /**
   * 문안 항목 → 명단 열. 확인 화면 이후 **항상 보낸다**(항목이 없어도 빈 객체).
   * 접수 확정은 이 매핑으로만 간다 — AI 추천은 초회 분석에서 미리 골라 줄 뿐, 서버가
   * 확정 때 다시 추론하지 않는다(화면에서 본 것과 같은 열 보장).
   */
  varMapping?: Record<string, string>;
}

/**
 * ★2026-08-26(2) 통일 양식 = 한 파일(시트1 내용 + 시트2 고객리스트). 화면은 파일 하나만 올린다.
 * 명단 파일(listFile)은 구양식 하위호환 축으로 서버가 계속 받지만, 화면 표준은 null이다.
 */
function oneStepBody(formFile: File, listFile: File | null, overrides: OneStepOverrides): FormData {
  const fd = new FormData();
  fd.append('form', formFile);
  if (listFile) fd.append('list', listFile);
  fd.append('overrides', JSON.stringify(overrides || {}));
  return fd;
}

export async function previewOneStep(formFile: File, listFile: File | null, overrides: OneStepOverrides): Promise<OneStepAnalysisView> {
  const res = await fetch('/api/agency-send/one-step/preview', { method: 'POST', headers: auth(), body: oneStepBody(formFile, listFile, overrides) });
  const data = await unwrap(res);
  return data.analysis;
}

export async function submitOneStep(formFile: File, listFile: File | null, overrides: OneStepOverrides): Promise<AgencySendRequest[]> {
  const res = await fetch('/api/agency-send/one-step', { method: 'POST', headers: auth(), body: oneStepBody(formFile, listFile, overrides) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) {
    const err: any = new Error(data?.error || '접수하지 못했습니다.');
    err.code = data?.code;
    err.errors = data?.errors;
    // 일부만 접수된 경우 만들어진 목록을 화면에 넘겨 목록을 갱신하게 한다
    err.requests = data?.requests;
    throw err;
  }
  return data.requests || [];
}

// ────────────── 문안 변수 (서버 CT `utils/agency-send-vars.ts` 미러) ──────────────

/**
 * 문안에 넣을 수 있는 항목 수. 값은 서버가 소유하고 화면은 미리 안내만 한다.
 * ⚠ 서버 `MAX_AGENCY_VARS`와 **같은 값이어야 한다** — 화면만 늘리면 접수가 400으로 막힌다.
 *   두 값의 일치는 `backend/src/utils/__tests__/agency-send-vars.test.ts`가 기계로 확인한다.
 */
export const MAX_AGENCY_VARS = 4;

/**
 * 문안 안 `%변수%` 목록. 패턴은 서버 `extractAgencyVars`와 **같아야 한다** —
 * 화면이 더 넓게 잡으면 매핑표에 변수가 아닌 것(`%50%` 같은 본문 표기)이 뜨고 개수도 어긋난다.
 */
export function extractAgencyVars(content: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of String(content || '').matchAll(/%([가-힣A-Za-z_][^%\s]{0,19})%/g)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push(m[1]);
  }
  return out;
}

// ────────────── 화면 표시용 (상태 하나가 두 곳에서 다르게 읽히지 않게 여기 모은다) ──────────────

export const STATUS_LABEL: Record<AgencySendStatus, string> = {
  received: '검사 대기',
  testing: '검사 중',
  awaiting_approval: '승인 대기',
  test_failed: '문안 확인 필요',
  approved: '발송 예정',
  // 이 상태는 세 가지를 덮는다: 당일 재검사 · 재승인 건 적재 · 당일 접수 건 적재.
  // "검사 중"이라고 쓰면 뒤 둘에는 거짓이라, 셋 다 참인 말로 둔다(★2026-08-23(2)).
  final_testing: '발송 준비 중',
  queued: '예약 완료',
  reapproval: '재승인 대기',
  expired: '미발송',
  cancelling: '취소 중',
  cancelled: '취소됨',
};

/**
 * ★2026-08-26 §18 접수 출처 라벨 — 목록·상세·슈퍼관리자가 같은 표를 읽는다.
 * ⛔ 색 칩을 쓰지 않는다(색은 상태 축이 소유한다 · console-ui 규약). 출처는 위험도가 아니다.
 */
export const SOURCE_LABEL: Record<AgencySendRequest['source'], string> = {
  screen: '직접 입력',
  one_step: '요청서 접수',
  email: '메일 접수',
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
  cancelling: 'amber',
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
  // `cancelling`은 취소가 진행 중이라 다시 누를 수 없다(두 번 누르면 큐 삭제가 겹친다)
  return status !== 'cancelled' && status !== 'cancelling'
    && status !== 'testing' && status !== 'final_testing';
}

// ────────────── 진행 레일 (★2026-08-25 목록 개편 · 시안 A) ──────────────

export const RAIL_STEPS = ['접수', '문안 검사', '담당자 문자', '승인', '예약', '발송'] as const;

export interface RailState {
  /** 이 번호 미만 단계는 끝났다(0 = 접수) */
  doneBefore: number;
  /** 지금 진행 중인 단계 번호. 종결 상태면 null */
  now: number | null;
  /** 흐름이 멈춘 자리. 취소·미발송·문안 확인 필요가 여기 얹힌다 */
  fail: { at: number; label: string } | null;
  /** 종결(취소·미발송) 건은 레일을 흐리게 그린다 */
  muted: boolean;
}

/**
 * 상태 → 진행 레일. 표시는 여기 하나가 소유한다(행마다 다르게 읽히지 않게).
 * ⛔ 종결 건의 "어디까지 갔었나"는 시도 시각이 아니라 **성공 스탬프**(approvedAt·queuedAt)로만 되짚는다.
 */
export function railFor(r: Pick<AgencySendRequest, 'status' | 'approvedAt' | 'queuedAt'>): RailState {
  switch (r.status) {
    case 'received': return { doneBefore: 1, now: 1, fail: null, muted: false };
    case 'testing': return { doneBefore: 1, now: 1, fail: null, muted: false };
    case 'test_failed': return { doneBefore: 1, now: null, fail: { at: 1, label: '문안 확인' }, muted: false };
    case 'awaiting_approval': return { doneBefore: 3, now: 3, fail: null, muted: false };
    case 'reapproval': return { doneBefore: 3, now: 3, fail: null, muted: false };
    case 'approved': return { doneBefore: 4, now: 4, fail: null, muted: false };
    case 'final_testing': return { doneBefore: 4, now: 4, fail: null, muted: false };
    case 'queued': return { doneBefore: 5, now: 5, fail: null, muted: false };
    case 'expired': {
      const at = r.approvedAt ? 4 : 3;
      return { doneBefore: at, now: null, fail: { at, label: '미발송' }, muted: true };
    }
    case 'cancelling':
    case 'cancelled': {
      const at = r.queuedAt ? 5 : r.approvedAt ? 4 : 2;
      return { doneBefore: at, now: null, fail: { at, label: r.status === 'cancelling' ? '취소 중' : '취소됨' }, muted: true };
    }
  }
}

/** 재접수 대상인가(끝난 건을 같은 내용으로 다시 시작한다) */
export function isRedoable(status: AgencySendStatus): boolean {
  return status === 'cancelled' || status === 'expired';
}

/** "오늘 14:00 · 3시간 후" 같은 상대 표기. 목록의 보낼 시각 칸이 쓴다 */
export function formatWhenRelative(iso: string): { big: string; sub: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { big: '', sub: '' };
  const now = new Date();
  const midnight = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round((midnight(d) - midnight(now)) / 86400000);
  const hm = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
  const md = d.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric', weekday: 'short' });
  if (dayDiff === 0) {
    const hours = Math.round((d.getTime() - now.getTime()) / 3600000);
    return { big: `오늘 ${hm}`, sub: hours > 0 ? `약 ${hours}시간 후` : md };
  }
  if (dayDiff === 1) return { big: `내일 ${hm}`, sub: md };
  if (dayDiff === 2) return { big: `모레 ${hm}`, sub: md };
  if (dayDiff < 0) return { big: `${d.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })} ${hm}`, sub: '지난 접수' };
  return { big: `${d.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })} ${hm}`, sub: md };
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
