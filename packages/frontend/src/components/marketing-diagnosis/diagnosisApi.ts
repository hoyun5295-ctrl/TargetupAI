/**
 * AI 마케팅 진단 — API 헬퍼 (2026-08-16 신설 · v3 분기형 확장)
 * 문항 정의의 단일 진실 = 서버 questions 응답(프론트 상수 없음 — §5-3).
 * v3: 퍼널 A는 인증 questions(실측 선치환 동봉)를, 퍼널 B는 공개 questions를 쓴다 — 투영은 서버가 한 벌.
 */

export interface DiagnosisOptionDto { key: string; label: string; hint?: string | null }
export interface DiagnosisShowWhenDto { q: string; in: string[] }
export interface DiagnosisQuestionDto {
  key: string;
  text: string;
  type: 'industry_grid' | 'single' | string;
  tags: string[];
  section?: string | null;
  show_when?: DiagnosisShowWhenDto | null;
  options: DiagnosisOptionDto[];
}
export interface DiagnosisSectionDto { key: string; label: string; intro?: string | null }
export interface DiagnosisQuestionsMetaDto {
  est_label?: string | null;
  sections?: DiagnosisSectionDto[];
}

export interface DiagnosisStateDto {
  eligible: boolean;
  grantable: 'available' | 'already_granted' | 'not_eligible' | 'not_applicable';
  completedAt: string | null;
  invitedAt: string | null;
  trialExpiresAt: string | null;
  recommendedPlanCode: string | null;
}

export interface DiagnosisStageDto {
  key: string;
  label: string;
  line: string;
  position: number;
  issued: boolean;
  scale: string[];
}
export interface DiagnosisCoverDto {
  subject: string | null;
  strength_clause: string | null;
  gap_clause: string | null;
  headline: string;
}
export interface DiagnosisObservationDto {
  items: Array<{ text: string; measured?: boolean }>;
  source: string;
}
export interface DiagnosisAxisRowDto { axis: string; label: string; level: number; level_label: string }
export interface DiagnosisGapDto {
  axis: string;
  label: string;
  heard: string;
  cause: string;
  effect: string;
  direction: string;
  /** v6 채움 킥 — 구 스냅샷(v5 이하)에는 없다. 없으면 렌더 생략(백필 없음). */
  fill?: string;
}
export interface DiagnosisPlanStepDto { week: string; title: string; action: string }

/**
 * 결과 스냅샷 DTO — v1·v2 공용(v2는 v1의 상위집합). v2 전용 필드는 전부 옵셔널로 두고
 * 렌더러가 방어적으로 읽는다(구버전 스냅샷 재열람 백지 차단 — v3 C4).
 */
export interface DiagnosisResultDto {
  v: number;
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
  // ── v2(스토리형) — 옵셔널: v1 스냅샷·preview 부분 결과가 공존한다 ──
  stage?: DiagnosisStageDto | null;
  cover?: DiagnosisCoverDto;
  observation?: DiagnosisObservationDto;
  praises?: string[];
  axes?: DiagnosisAxisRowDto[];
  insights?: string[];
  gaps?: DiagnosisGapDto[];
  plan30?: DiagnosisPlanStepDto[];
  no_match_kind?: 'over_range' | 'other' | null;
  /** preview 전용 — 실행 순서·예시가 신청 뒤에 온다는 안내(서버 문구). */
  plan_note?: string;
  /** v5 — 전문 툴 사용자 전용 견적 구간 한 줄(견적 카드 밖 렌더 금지). */
  pitch_note?: string;
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
  /** v3 — 문항 + 실측 선치환(prefilled). 화면 안내용일 뿐 제출 시 서버가 재계산한다. */
  questions: async () => toJson(await fetch('/api/marketing-diagnosis/questions', { headers: authHeaders() })),
  report: async () => toJson(await fetch('/api/marketing-diagnosis/report', { headers: authHeaders() })),
  invited: async () =>
    toJson(await fetch('/api/marketing-diagnosis/invited', { method: 'POST', headers: authHeaders() })),
  /** version = 사용자가 본 문항 세트(불일치 = 409 VERSION_CHANGED — 조용한 재해석 차단) */
  submit: async (answers: Record<string, string>, version?: string) =>
    toJson(await fetch('/api/marketing-diagnosis/submit', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ answers, question_set_version: version }),
    })),
  consult: async () =>
    toJson(await fetch('/api/marketing-diagnosis/consult', { method: 'POST', headers: authHeaders() })),
};

/** 공개 축(퍼널 B — 미인증) */
export const diagnosisPublicApi = {
  questions: async () => toJson(await fetch('/api/public/marketing-diagnosis/questions')),
  preview: async (answers: Record<string, string>, version?: string) =>
    toJson(await fetch('/api/public/marketing-diagnosis/preview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers, question_set_version: version }),
    })),
  submit: async (payload: {
    answers: Record<string, string>;
    question_set_version?: string;
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
