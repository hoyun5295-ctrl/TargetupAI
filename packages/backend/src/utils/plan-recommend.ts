/**
 * CT: 마케팅 진단 추천 룰 + 문항 정의 검증 (2026-08-16 신설 · v3 분기형 확장 —
 * 설계서 docs/2026-08-16-marketing-diagnosis-design.md §4-5 · v3 = docs/2026-08-16-marketing-diagnosis-v3-design.md §2)
 *
 * 순수 함수만 — DB/IO/시간 의존 0. 입력(definition, answers, planRows)만으로 결과가 정해진다.
 *
 * 원칙 (설계서 §2·§3-1 · v3 §2)
 *   - 답변→요금제 직접 매핑 금지. 선택지 requires(요구조건) → plans 컬럼의 2단만.
 *   - 추천 후보 = is_active AND monthly_price > 0 (FREE·TRIAL·STAFF 0원 플랜 자동 제외).
 *   - 만족 0행 = no_match (오추천 금지). v3: no_match_kind로 상위 이탈(over_range)을 가른다 —
 *     최고가 후보 행조차 수치 요구 미달이면 "요금제 범위를 넘는 규모"라 고도화 상담이 정직한 결론.
 *   - 컬럼별 허용 op 표는 이 CT가 소유한다. ai_credits_per_month는 NULL=0 컬럼이라 gte만.
 *   - v3 분기: show_when(같은 섹션·앞 문항·깊이 2)·axis 게이트(level 서수 = 축 등급)·requires는 루트 전용.
 *     answers 검증은 "가시 문항 전부 답 + 비가시 답 거부"(화면은 게이트가 아니다 — 답을 골라 빼는 조작 차단).
 *   - v1·v2 definition(meta·section·show_when 없음)은 전 함수가 기존과 동일하게 동작한다(하위 호환).
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
  /** 보조설명 한 줄(안심 카피) — 리포트·근거 문장에 절대 인용되지 않는다(라벨만 인용 계약). */
  hint?: string;
  /** 축 게이트 전용 — 축 등급(0~3, 오름차순). 미지정 = 선택지 index. */
  level?: number;
  /** "모름/확인 안 함" 계열 표식 — 3개 이상이면 단계 눈금 미발행(감점 아님). */
  unknown?: boolean;
  requires?: DiagnosisRequire[];
}

export interface DiagnosisShowWhen {
  /** 같은 섹션의 앞선 게이트 문항 key(자신도 show_when이 없는 문항만 — 깊이 2 상한). */
  q: string;
  in: string[];
}

export const DIAGNOSIS_AXES = ['list', 'targeting', 'sending', 'production', 'repeat', 'measure'] as const;
export type DiagnosisAxis = (typeof DIAGNOSIS_AXES)[number];

export interface DiagnosisQuestion {
  key: string;
  text: string;
  type: string;
  tags?: string[];
  /** v3 — meta.sections의 key. meta.sections가 있으면 전 문항 의무. */
  section?: string;
  /** v3 — 있으면 축 게이트(전원 노출·level 서수가 축 등급). */
  axis?: DiagnosisAxis;
  /** v3 — 있으면 분기 심화(등급 불개입 — 관찰·처방 문장 선택 전용). */
  show_when?: DiagnosisShowWhen;
  options: DiagnosisOption[];
}

export interface DiagnosisSectionMeta {
  key: string;
  label: string;
  intro?: string;
}

export interface DiagnosisMeta {
  /** 카피 소유권 = seed("약 3분 · 답변에 따라 문항이 달라져요") — 문항 수 표기 금지(m5). */
  est_label?: string;
  sections?: DiagnosisSectionMeta[];
}

export interface DiagnosisDefinition {
  version: string;
  rule_version: string;
  meta?: DiagnosisMeta;
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

/** seed·활성 세트 로드 시 구조 검증 — 통과 못 한 definition은 활성화하면 안 된다(위반 = 503 fail-closed). */
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

  // v3 — meta.sections 검증(있을 때만: v1·v2 하위 호환)
  const sectionOrder: string[] = [];
  if (def.meta !== undefined) {
    if (!def.meta || typeof def.meta !== 'object' || Array.isArray(def.meta)) {
      errors.push('meta가 객체가 아님');
    } else if (def.meta.sections !== undefined) {
      if (!Array.isArray(def.meta.sections) || def.meta.sections.length === 0) {
        errors.push('meta.sections가 배열이 아니거나 비어 있음');
      } else {
        for (const s of def.meta.sections) {
          if (!s || typeof s.key !== 'string' || !s.key.trim() || typeof s.label !== 'string' || !s.label.trim()) {
            errors.push('섹션 key/label 누락');
            continue;
          }
          if (sectionOrder.includes(s.key)) errors.push(`섹션 key 중복: ${s.key}`);
          sectionOrder.push(s.key);
        }
      }
    }
  }
  const hasSections = sectionOrder.length > 0;

  const qKeys = new Set<string>();
  const axisSeen = new Set<string>();
  const byKey = new Map<string, DiagnosisQuestion>();
  let lastSectionIdx = 0;
  const closedSections = new Set<string>();

  for (const q of def.questions) {
    if (!q || typeof q.key !== 'string' || !q.key.trim()) { errors.push('문항 key 누락'); continue; }
    if (qKeys.has(q.key)) errors.push(`문항 key 중복: ${q.key}`);
    qKeys.add(q.key);
    if (typeof q.text !== 'string' || !q.text.trim()) errors.push(`문항 text 누락: ${q.key}`);

    // v3 — 섹션 소속·연속성(도트 고정의 전제: 섹션은 한 번 지나가면 다시 나오지 않는다)
    if (hasSections) {
      const si = typeof q.section === 'string' ? sectionOrder.indexOf(q.section) : -1;
      if (si < 0) {
        errors.push(`섹션 미지정/미등록: ${q.key}`);
      } else if (si < lastSectionIdx) {
        errors.push(`섹션 순서 역행: ${q.key} (${q.section})`);
      } else {
        if (si > lastSectionIdx) closedSections.add(sectionOrder[lastSectionIdx]);
        if (closedSections.has(q.section as string)) errors.push(`섹션 재등장: ${q.key} (${q.section})`);
        lastSectionIdx = si;
      }
    } else if (q.section !== undefined) {
      errors.push(`meta.sections 없이 section 지정: ${q.key}`);
    }

    // v3 — 축 게이트
    if (q.axis !== undefined) {
      if (!DIAGNOSIS_AXES.includes(q.axis)) errors.push(`미등록 축: ${q.key}.${q.axis}`);
      else if (axisSeen.has(q.axis)) errors.push(`축 게이트 중복: ${q.axis}`);
      else axisSeen.add(q.axis);
      if (q.show_when !== undefined) errors.push(`축 게이트에 show_when 금지: ${q.key}`);
    }

    // v3 — 분기(show_when): 앞 문항·같은 섹션·게이트(자신은 무분기)만 참조, in은 실존 옵션 부분집합
    if (q.show_when !== undefined) {
      const sw = q.show_when;
      if (!sw || typeof sw.q !== 'string' || !Array.isArray(sw.in) || sw.in.length === 0) {
        errors.push(`show_when 형식 오류: ${q.key}`);
      } else {
        const ref = byKey.get(sw.q);
        if (!ref) errors.push(`show_when이 앞선 문항을 참조하지 않음: ${q.key} → ${sw.q}`);
        else {
          if (ref.show_when !== undefined) errors.push(`분기의 분기(깊이 3) 금지: ${q.key} → ${sw.q}`);
          if (hasSections && ref.section !== q.section) errors.push(`타 섹션 분기 금지: ${q.key} → ${sw.q}`);
          // 참조 문항의 options가 손상돼도 예외가 아니라 { ok:false }여야 한다(Codex 1R — 503 fail-closed 계약)
          if (!Array.isArray(ref.options)) {
            errors.push(`show_when 참조 문항의 options 손상: ${q.key} → ${sw.q}`);
          } else {
            const refOpts = new Set(ref.options.map((o) => o?.key));
            for (const v of sw.in) {
              if (typeof v !== 'string' || !refOpts.has(v)) errors.push(`show_when.in 미실존 선택지: ${q.key} → ${sw.q}.${v}`);
            }
          }
        }
      }
    }

    if (!Array.isArray(q.options) || q.options.length === 0) { errors.push(`선택지 없음: ${q.key}`); byKey.set(q.key, q); continue; }
    if (q.axis !== undefined && (q.options.length < 4 || q.options.length > 5)) {
      errors.push(`축 게이트 선택지는 4~5개: ${q.key}`);
    }

    const oKeys = new Set<string>();
    let prevLevel = -1;
    let hasRequires = false;
    for (let oi = 0; oi < q.options.length; oi++) {
      const o = q.options[oi];
      if (!o || typeof o.key !== 'string' || !o.key.trim()) { errors.push(`선택지 key 누락: ${q.key}`); continue; }
      if (oKeys.has(o.key)) errors.push(`선택지 key 중복: ${q.key}.${o.key}`);
      oKeys.add(o.key);
      if (o.hint !== undefined && (typeof o.hint !== 'string' || !o.hint.trim())) errors.push(`hint 형식 오류: ${q.key}.${o.key}`);
      if (o.unknown !== undefined && typeof o.unknown !== 'boolean') errors.push(`unknown 형식 오류: ${q.key}.${o.key}`);
      if (q.axis !== undefined) {
        const lv = o.level ?? oi;
        if (typeof lv !== 'number' || !Number.isInteger(lv) || lv < 0 || lv > 3) {
          errors.push(`level은 0~3 정수: ${q.key}.${o.key}`);
        } else if (lv < prevLevel) {
          errors.push(`level 오름차순 위반: ${q.key}.${o.key}`);
        } else {
          prevLevel = lv;
        }
      } else if (o.level !== undefined) {
        errors.push(`level은 축 게이트 전용: ${q.key}.${o.key}`);
      }
      if (o.requires === undefined) continue;
      hasRequires = true;
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
    // 분기 뒤 requires 금지 — 안 물은 경로에서 요구가 조용히 소실되어 추천이 비결정이 된다(회의 확정).
    if (hasRequires && q.show_when !== undefined) errors.push(`분기 문항에 requires 금지: ${q.key}`);

    byKey.set(q.key, q);
  }
  // 축 게이트는 전부 아니면 0(★Codex 2R) — 일부 축만 있는 definition은 없는 축을 level 0으로
  // 단정한 거짓 리포트를 만든다. 부분 축 = 활성화 자체를 막는다(503 fail-closed).
  if (axisSeen.size > 0 && axisSeen.size !== DIAGNOSIS_AXES.length) {
    errors.push(`축 게이트 불완전: ${DIAGNOSIS_AXES.length}축 전부 필요(현재 ${axisSeen.size})`);
  }
  return { ok: errors.length === 0, errors };
}

/**
 * 가시 문항 집합 — show_when 없는 문항 + 조건 충족 분기.
 * 분기는 앞 문항만 참조하므로(validateDefinition) answers 전체 기준 단일 패스로 결정적이다.
 */
export function visibleQuestions(
  def: DiagnosisDefinition,
  answers: Record<string, unknown>,
): DiagnosisQuestion[] {
  return def.questions.filter((q) => {
    if (!q.show_when) return true;
    const v = answers[q.show_when.q];
    return typeof v === 'string' && q.show_when.in.includes(v);
  });
}

export interface AnswersCheck {
  ok: boolean;
  error?: string;
}

export interface ValidateAnswersOpts {
  /**
   * 서버 실측 선치환 축(퍼널 A prefill)의 게이트 key + 그 게이트를 참조하는 분기 key.
   * 이 키들은 ①답이 없어도 통과(서버가 실측으로 채운다) ②가시성 판정을 건너뛴다
   * (로드 시점과 제출 시점의 실측 값 차이로 분기 경로가 어긋나는 창을 흡수 — 실측은 단조 증가).
   * 값이 왔다면 유효한 option key여야 하는 것은 동일하다.
   */
  optionalKeys?: ReadonlySet<string>;
}

/**
 * answers 검증 — 객체형 · 정의 밖 문항 거부 · **가시 문항 전부 답 필수 + 비가시 문항 답 거부**(v3) ·
 * 값은 그 문항의 option key 중 하나. 저장·계산·지급 전부 이 검증 뒤에만.
 * v1·v2 definition(분기 없음)에서는 기존과 동일하게 "전 문항 정확 일치"다.
 */
export function validateAnswers(
  def: DiagnosisDefinition,
  input: unknown,
  opts: ValidateAnswersOpts = {},
): AnswersCheck {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: '답변 형식이 올바르지 않습니다.' };
  }
  const answers = input as Record<string, unknown>;
  const optional = opts.optionalKeys ?? new Set<string>();
  const qByKey = new Map(def.questions.map((q) => [q.key, q]));
  for (const key of Object.keys(answers)) {
    if (!qByKey.has(key)) return { ok: false, error: `정의에 없는 문항: ${key}` };
  }
  const visible = new Set(visibleQuestions(def, answers).map((q) => q.key));
  for (const q of def.questions) {
    const v = answers[q.key];
    if (visible.has(q.key)) {
      if (v === undefined) {
        if (optional.has(q.key)) continue;
        return { ok: false, error: `답변 누락: ${q.key}` };
      }
    } else if (v !== undefined && !optional.has(q.key)) {
      // 고아 답변(게이트를 바꾼 뒤 남은 분기 답 등) — 프론트 prune 의무·서버는 게이트
      return { ok: false, error: `표시되지 않는 문항의 답변: ${q.key}` };
    }
    if (v !== undefined && (typeof v !== 'string' || !q.options.some((o) => o.key === v))) {
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
  /**
   * no_match일 때만 의미: 'over_range' = 최고가 후보 행조차 수치 요구(gte·gte_or_null) 미달 =
   * 요금제 범위를 넘는 규모(고도화 상담이 정직한 결론) / 'other' = 그 외. 매치되면 null.
   */
  no_match_kind: 'over_range' | 'other' | null;
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
 * requires 수집은 **가시 문항만**(v3 — requires는 루트 전용이라 실제로는 전 문항이지만 벨트를 한 벌 더).
 * 선택 = 전 요구조건 만족 행 중 monthly_price ASC, plan_code ASC(동률 2차 정렬 확정 — §4-5).
 */
export function recommendPlan(
  def: DiagnosisDefinition,
  answers: Record<string, string>,
  planRows: PlanRowLike[],
  opts: ValidateAnswersOpts = {},
): RecommendResult {
  const check = validateAnswers(def, answers, opts);
  if (!check.ok) throw new Error(`answers 검증 미통과: ${check.error}`);

  const rules: Array<{ rule: DiagnosisRequire; reason: RecommendReason }> = [];
  for (const q of visibleQuestions(def, answers)) {
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

  const no_match = eligible.length === 0;
  let no_match_kind: RecommendResult['no_match_kind'] = null;
  if (no_match) {
    // over_range = 수치 요구(gte·gte_or_null)가 존재하고, 그 **전부를** 만족하는 후보가 0일 때만.
    // 최고가 한 행이 아니라 전 후보를 본다 — 가격과 용량의 단조 관계를 가정하지 않는다(Codex 1R).
    const numericRules = rules.filter(({ rule }) => rule.op !== 'is_true');
    const overRange =
      numericRules.length > 0 &&
      candidates.length > 0 &&
      !candidates.some((row) => numericRules.every(({ rule }) => satisfies(row, rule)));
    no_match_kind = overRange ? 'over_range' : 'other';
  }

  return {
    plan: eligible[0] ?? null,
    reasons: rules.map((r) => r.reason),
    no_match,
    no_match_kind,
  };
}
