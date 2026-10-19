/**
 * lib/hub-recommend.ts — 「오늘의 추천」 판정 한 곳 (★ 2026-10-19 · docs/2026-10-19-dashboard-four-cards-design.md §2-4)
 *
 * AI 한줄로 화면 추천 띠와 대시보드 「오늘의 추천」 칸이 같이 쓴다(옛 = AiLinePage 안 타입 · 함수 · 원본 그대로 옮김).
 *   - 읽기 = GET /api/ai/operator/self-diagnosis(서버 = SQL만 · AI 0 · 차감 0 · 담당자 숫자 숨김은 서버 briefForViewer)
 *   - 일일 브리핑(company_daily_briefs)이 있으면 그것이 추천의 단일 소스 · 없으면 규칙 추천(폴백)
 *   - 누름 분기 = 정착 제안 → 여정 · 채널 제안 → 그 채널 화면 · 기본 → AI 한줄로 입력창에 그 한 줄
 */

export interface AutoRecommendation {
  id: string;
  priority: 1 | 2 | 3;
  type: string;
  title: string;
  reason: string;
  targetCount: number;
  expectedImpact: string;
  oneClickObjective: string;
}

export interface CompanyHealthDiagnosis {
  overallScore: number;
  topConcerns: string[];
  recommendations: AutoRecommendation[];
}

// ★ 2026-07-02 1차 개편: 일일 브리핑(company_daily_briefs)이 있으면 그것이 추천의 단일 소스 —
//   룰 기반 추천은 브리핑이 아직 없는 회사의 폴백. 자동마케팅 현황 요약 동반.
export interface DiagnosisBrief {
  brief_date: string;
  headline: string | null;
  recommendations: Array<{
    title: string;
    objective: string;
    reason: string;
    targetCount: number | null;
    opportunityType?: string | null;
    recommendedChannel?: 'sms' | 'email' | 'dm' | null;
  }>;
}

export interface AutoMarketingSummary { active: number; pendingProposals: number }

export type BriefRec = DiagnosisBrief['recommendations'][number];
export type HubRec =
  | { kind: 'brief'; rec: BriefRec }
  | { kind: 'rule'; rec: AutoRecommendation };

export function hubRecLabel(r: HubRec): string {
  if (r.kind === 'rule') return '입력창에 채우기';
  if (r.rec.opportunityType === 'journey_promotion') return '여정으로 굳히기';
  if (r.rec.recommendedChannel === 'email') return '이메일에서 진행';
  if (r.rec.recommendedChannel === 'dm') return '모바일 DM에서 진행';
  return '입력창에 채우기';
}

/** 누름 분기 — 정착 제안 = 여정 승격다리 / 채널 제안 = 해당 채널 화면 / 기본 = 자연어 한 줄(규칙 추천은 늘 한 줄) */
export type HubRecAction =
  | { kind: 'line'; objective: string }
  | { kind: 'journey'; objective: string }
  | { kind: 'route'; path: '/email-campaigns' | '/dm-builder' };

export function hubRecAction(r: HubRec): HubRecAction {
  if (r.kind === 'rule') return { kind: 'line', objective: r.rec.oneClickObjective };
  const rec = r.rec;
  if (rec.opportunityType === 'journey_promotion') return { kind: 'journey', objective: rec.objective };
  if (rec.recommendedChannel === 'email') return { kind: 'route', path: '/email-campaigns' };
  if (rec.recommendedChannel === 'dm') return { kind: 'route', path: '/dm-builder' };
  return { kind: 'line', objective: rec.objective };
}

/** 브리핑이 있으면 브리핑 추천 · 없으면 규칙 추천 */
export function buildHubRecs(diagnosis: CompanyHealthDiagnosis, brief: DiagnosisBrief | null): { recs: HubRec[]; useBrief: boolean } {
  const briefRecs = Array.isArray(brief?.recommendations) ? brief!.recommendations : [];
  const useBrief = briefRecs.length > 0;
  const rules = Array.isArray(diagnosis.recommendations) ? diagnosis.recommendations : [];
  const recs: HubRec[] = useBrief
    ? briefRecs.map((rec) => ({ kind: 'brief' as const, rec }))
    : rules.map((rec) => ({ kind: 'rule' as const, rec }));
  return { recs, useBrief };
}

/** AI 한줄로 입력창 넘기기 — AI 한줄로 화면이 열릴 때 이 키를 읽어 입력창에 채운다(DB 상세 창과 같은 키) */
export function stashAiLineObjective(objective: string): void {
  sessionStorage.setItem('ai_operator_prefill_objective', objective);
}

/** 여정 굳히기 넘기기 — 여정 화면(JourneysPage)이 이 키를 읽는다 */
export function stashJourneyObjective(objective: string): void {
  sessionStorage.setItem('journeyObjectivePrefill', JSON.stringify({ objective, message: '' }));
}

export type SelfDiagnosisResult =
  | { ok: true; diagnosis: CompanyHealthDiagnosis; brief: DiagnosisBrief | null; autoMarketing: AutoMarketingSummary | null }
  | { ok: false; locked: boolean };

/** 읽기 — 서버가 요금제로 막으면(403) locked · 그 밖의 실패는 locked 아님(다시 시도할 수 있다) */
export async function loadSelfDiagnosis(): Promise<SelfDiagnosisResult> {
  try {
    const token = localStorage.getItem('token');
    const r = await fetch('/api/ai/operator/self-diagnosis', { headers: { Authorization: `Bearer ${token}` } });
    if (r.status === 403) return { ok: false, locked: true };
    const d = await r.json();
    if (d?.success && d.diagnosis) {
      return { ok: true, diagnosis: d.diagnosis, brief: d.brief || null, autoMarketing: d.autoMarketing || null };
    }
    return { ok: false, locked: false };
  } catch {
    return { ok: false, locked: false };
  }
}
