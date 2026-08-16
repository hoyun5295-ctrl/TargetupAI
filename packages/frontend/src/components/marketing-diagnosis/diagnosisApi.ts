/**
 * AI 마케팅 진단 — API 헬퍼 (2026-08-16 신설 · 설계서 §4-3·§4-4)
 * 문항 정의의 단일 진실 = GET /api/public/marketing-diagnosis/questions (프론트 상수 없음 — §5-3).
 */

export interface DiagnosisOptionDto { key: string; label: string }
export interface DiagnosisQuestionDto {
  key: string;
  text: string;
  type: 'industry_grid' | 'single' | string;
  tags: string[];
  options: DiagnosisOptionDto[];
}

export interface DiagnosisStateDto {
  eligible: boolean;
  grantable: 'available' | 'already_granted' | 'not_eligible' | 'not_applicable';
  completedAt: string | null;
  invitedAt: string | null;
  trialExpiresAt: string | null;
  recommendedPlanCode: string | null;
}

export interface DiagnosisResultDto {
  v: 1;
  summary: string;
  findings: Array<{ key: string; text: string }>;
  effects: Array<{ kind: string; label: string; value: string; source: string }>;
  recommendation: {
    plan_code: string;
    plan_name: string;
    monthly_price: number;
    reasons: Array<{ question: string; option: string; column: string }>;
  } | null;
  no_match: boolean;
  grant_outcome: 'granted' | 'already_granted' | 'not_eligible' | 'not_applicable' | null;
  examples: { industry: string | null };
}

const authHeaders = (): Record<string, string> => ({
  Authorization: `Bearer ${localStorage.getItem('token')}`,
  'Content-Type': 'application/json',
});

async function toJson(res: Response) {
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

/** 인증 축(퍼널 A) */
export const diagnosisApi = {
  state: async () => toJson(await fetch('/api/marketing-diagnosis/state', { headers: authHeaders() })),
  report: async () => toJson(await fetch('/api/marketing-diagnosis/report', { headers: authHeaders() })),
  invited: async () =>
    toJson(await fetch('/api/marketing-diagnosis/invited', { method: 'POST', headers: authHeaders() })),
  submit: async (answers: Record<string, string>) =>
    toJson(await fetch('/api/marketing-diagnosis/submit', {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({ answers }),
    })),
  consult: async () =>
    toJson(await fetch('/api/marketing-diagnosis/consult', { method: 'POST', headers: authHeaders() })),
};

/** 공개 축(퍼널 B — 미인증) */
export const diagnosisPublicApi = {
  questions: async () => toJson(await fetch('/api/public/marketing-diagnosis/questions')),
  preview: async (answers: Record<string, string>) =>
    toJson(await fetch('/api/public/marketing-diagnosis/preview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers }),
    })),
  submit: async (payload: {
    answers: Record<string, string>;
    company_name: string;
    contact_name: string;
    email: string;
    phone: string;
    consent: boolean;
    website?: string;   // 허니팟 — 사람은 비워 둔다
    src?: string;
  }) =>
    toJson(await fetch(`/api/public/marketing-diagnosis/submit${payload.src ? `?src=${encodeURIComponent(payload.src)}` : ''}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })),
};
