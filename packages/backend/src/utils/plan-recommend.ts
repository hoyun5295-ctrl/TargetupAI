/**
 * CT: 마케팅 진단 추천 룰 (2026-08-16 신설 — 설계서 docs/2026-08-16-marketing-diagnosis-design.md §4-5)
 *
 * 순수 함수만 — DB/IO/시간 의존 0. 입력(definition, answers, planRows)만으로 결과가 정해진다.
 *
 * 원칙 (설계서 §2·§3-1)
 *   - 답변→요금제 직접 매핑 금지. 선택지 requires(요구조건) → plans 컬럼의 2단만.
 *   - requires는 실효 게이트·실사용 수량 축만 쓴다. 2026-08-16 실측(§3-1 — B안 확정)으로 v1은
 *     ai_credits_per_month(gte) 단일 축이다: boolean 플래그는 런타임 게이트가 아니고(FREE만 차단),
 *     max_auto_campaigns·cdp_events_per_month는 하위 플랜 NULL(=런타임 무제한) 역전이라 제외.
 *     plans 실값 정정(설계서 §10 ⑧) 후 문항 세트 v2 seed로 재도입한다 — 그래서 op 표는 전 축을 유지한다.
 *   - 추천 후보 = is_active AND monthly_price > 0 (FREE·TRIAL·STAFF 0원 플랜 자동 제외 — §2-5).
 *   - 만족 0행 = no_match (오추천 금지 — 리포트는 추천 카드 대신 상담 CTA — §4-5).
 *   - 컬럼별 허용 op 표는 이 CT가 소유한다. ai_credits_per_month는 NULL=0 컬럼이라 gte만 —
 *     gte_or_null을 허용하면 값을 안 채운 요금제가 최저가로 추천되는 사고가 된다.
 *   - answers 완전 검증(validateAnswers) 뒤에만 저장·계산·지급한다 — recommendPlan도 내부에서
 *     한 번 더 검증하고 미통과면 throw(우회 경로 차단 벨트).
 */

export type RequireOp = 'is_true' | 'gte' | 'gte_or_null';

export interface DiagnosisRequire {
  column: string;
  op: RequireOp;
  value?: number;
}

export interface DiagnosisOption {
  key: string;
  label: string;
  requires?: DiagnosisRequire[];
}

export interface DiagnosisQuestion {
  key: string;
  text: string;
  type: string;
  tags?: string[];
  options: DiagnosisOption[];
}

export interface DiagnosisDefinition {
  version: string;
  rule_version: string;
  questions: DiagnosisQuestion[];
}

/** plans 행 최소 형태 — SELECT * 결과를 그대로 받되 계산에 쓰는 축만 명시한다. */
export interface PlanRowLike {
  id: string;
  plan_code: string;
  plan_name: string;
  monthly_price: number | string;
  is_active: boolean;
  [column: string]: unknown;
}

/**
 * 컬럼별 허용 op 표 — 이 CT가 소유(설계서 §4-5). 여기 없는 컬럼은 requires에 올 수 없다.
 * NULL 의미론이 컬럼마다 다르므로 op를 컬럼에 묶는다:
 *   NULL=0(ai_credits_per_month) → gte만 / NULL=무제한(한도 축) → gte_or_null만.
 */
export const COLUMN_ALLOWED_OPS: Readonly<Record<string, readonly RequireOp[]>> = {
  ai_credits_per_month: ['gte'],
  max_auto_campaigns: ['gte_or_null'],
  cdp_events_per_month: ['gte_or_null'],
  max_customers: ['gte_or_null'],
  customer_db_enabled: ['is_true'],
  auto_campaign_enabled: ['is_true'],
  mobile_dm_enabled: ['is_true'],
  cdp_enabled: ['is_true'],
};

export interface DefinitionCheck {
  ok: boolean;
  errors: string[];
}

/** seed·활성 세트 로드 시 구조 검증 — 통과 못 한 definition은 활성화하면 안 된다. */
export function validateDefinition(input: unknown): DefinitionCheck {
  const errors: string[] = [];
  const def = input as DiagnosisDefinition;
  if (!def || typeof def !== 'object' || Array.isArray(def)) {
    return { ok: false, errors: ['definition이 객체가 아님'] };
  }
  if (typeof def.version !== 'string' || !def.version.trim()) errors.push('version 누락');
  if (typeof def.rule_version !== 'string' || !def.rule_version.trim()) errors.push('rule_version 누락');
  if (!Array.isArray(def.questions) || def.questions.length === 0) {
    errors.push('questions가 비어 있음');
    return { ok: errors.length === 0, errors };
  }
  const qKeys = new Set<string>();
  for (const q of def.questions) {
    if (!q || typeof q.key !== 'string' || !q.key.trim()) { errors.push('문항 key 누락'); continue; }
    if (qKeys.has(q.key)) errors.push(`문항 key 중복: ${q.key}`);
    qKeys.add(q.key);
    if (typeof q.text !== 'string' || !q.text.trim()) errors.push(`문항 text 누락: ${q.key}`);
    if (!Array.isArray(q.options) || q.options.length === 0) { errors.push(`선택지 없음: ${q.key}`); continue; }
    const oKeys = new Set<string>();
    for (const o of q.options) {
      if (!o || typeof o.key !== 'string' || !o.key.trim()) { errors.push(`선택지 key 누락: ${q.key}`); continue; }
      if (oKeys.has(o.key)) errors.push(`선택지 key 중복: ${q.key}.${o.key}`);
      oKeys.add(o.key);
      if (o.requires === undefined) continue;
      if (!Array.isArray(o.requires)) { errors.push(`requires가 배열이 아님: ${q.key}.${o.key}`); continue; }
      for (const r of o.requires) {
        const allowed = r && typeof r.column === 'string' ? COLUMN_ALLOWED_OPS[r.column] : undefined;
        if (!allowed) { errors.push(`미등록 컬럼: ${q.key}.${o.key}.${r?.column}`); continue; }
        if (!allowed.includes(r.op)) { errors.push(`컬럼 비허용 op: ${r.column} ${r.op}`); continue; }
        if (r.op === 'is_true') {
          if (r.value !== undefined) errors.push(`is_true는 value를 갖지 않음: ${r.column}`);
        } else if (typeof r.value !== 'number' || !Number.isFinite(r.value)) {
          errors.push(`${r.op}에 유한 숫자 value 필요: ${r.column}`);
        }
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

export interface AnswersCheck {
  ok: boolean;
  error?: string;
}

/**
 * answers 완전 검증(설계서 §4-5) — 객체형 · 활성 definition의 문항 key 집합과 정확히 일치(누락·초과 400)
 * · 값은 그 문항의 option key 중 하나. 저장·계산·지급 전부 이 검증 뒤에만.
 */
export function validateAnswers(def: DiagnosisDefinition, input: unknown): AnswersCheck {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: '답변 형식이 올바르지 않습니다.' };
  }
  const answers = input as Record<string, unknown>;
  const qByKey = new Map(def.questions.map((q) => [q.key, q]));
  for (const key of Object.keys(answers)) {
    if (!qByKey.has(key)) return { ok: false, error: `정의에 없는 문항: ${key}` };
  }
  for (const q of def.questions) {
    const v = answers[q.key];
    if (v === undefined) return { ok: false, error: `답변 누락: ${q.key}` };
    if (typeof v !== 'string' || !q.options.some((o) => o.key === v)) {
      return { ok: false, error: `유효하지 않은 선택지: ${q.key}` };
    }
  }
  return { ok: true };
}

export interface RecommendReason {
  question: string;
  option: string;
  column: string;
}

export interface RecommendResult {
  plan: PlanRowLike | null;
  reasons: RecommendReason[];
  no_match: boolean;
}

function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function satisfies(row: PlanRowLike, rule: DiagnosisRequire): boolean {
  const v = row[rule.column];
  switch (rule.op) {
    case 'is_true':
      return v === true;
    case 'gte':
      // NULL=0 의미론 — 값 미기재 요금제는 0으로 취급해 탈락시킨다.
      return toNum(v) >= (rule.value as number);
    case 'gte_or_null':
      // NULL=무제한 의미론(한도 축) — 미기재는 통과.
      return v === null || v === undefined ? true : toNum(v) >= (rule.value as number);
  }
}

/**
 * 추천 계산. validateAnswers 미통과 answers는 throw — 검증을 건너뛰는 우회 경로를 코드가 막는다.
 * 선택 = 전 요구조건 만족 행 중 monthly_price ASC, plan_code ASC(동률 2차 정렬 확정 — §4-5).
 */
export function recommendPlan(
  def: DiagnosisDefinition,
  answers: Record<string, string>,
  planRows: PlanRowLike[],
): RecommendResult {
  const check = validateAnswers(def, answers);
  if (!check.ok) throw new Error(`answers 검증 미통과: ${check.error}`);

  const rules: Array<{ rule: DiagnosisRequire; reason: RecommendReason }> = [];
  for (const q of def.questions) {
    const opt = q.options.find((o) => o.key === answers[q.key]);
    for (const rule of opt?.requires ?? []) {
      rules.push({ rule, reason: { question: q.text, option: opt!.label, column: rule.column } });
    }
  }

  const candidates = planRows.filter((r) => r.is_active === true && toNum(r.monthly_price) > 0);
  const eligible = candidates.filter((row) => rules.every(({ rule }) => satisfies(row, rule)));
  eligible.sort((a, b) =>
    toNum(a.monthly_price) - toNum(b.monthly_price) || a.plan_code.localeCompare(b.plan_code),
  );

  return {
    plan: eligible[0] ?? null,
    reasons: rules.map((r) => r.reason),
    no_match: eligible.length === 0,
  };
}
