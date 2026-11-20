/**
 * audience-condition.ts — ★ 2026-11-20 자동마케팅 칸 조건 하나의 검사 + 칸 고른 뒤 조건 = 한 곳(순수 · DB · AI 무의존)
 *   설계서 docs/2026-11-20-staff-tickets-four-design.md P3 · Codex 구현 1R #3 — 옛 칸 잠금(audience-pick pickKindsFor)이 허용 표를 따로 하나 더 가져
 *   회사 숫자 칸의 「중 하나(in)」 조건까지 잠갔다. 이제 잠금 = 번역기가 실제로 받는 그 검사(validateCondition → conditionsToFilters) 하나.
 *   쓰는 자리 = 대상 번역(audience-translate · 옛 이름 다시 내보냄) · 인터뷰 질문(automarketing-interview) · 미리보기 잠금(automarketing-preview).
 *   (AudienceConditionError · 허용 표 · validateCondition · conditionsToFilters = audience-translate.ts 에서 글자 그대로 옮김)
 */
import { filterConditionIssues } from './customer-filter';
import type { AudienceCondition, AudienceFieldOption, AudienceTranslation } from './audience-translate';

/** 일수를 값으로 받는 상대 날짜 기준(R100) */
export const RELATIVE_DAY_OPS: ReadonlySet<string> = new Set(['days_within', 'days_passed']);

/** 사용자가 고른 칸 조건이 칸 목록에 없거나 모양이 틀렸다(400) */
export class AudienceConditionError extends Error {}


const OPS_BY_TYPE: Record<'string' | 'number' | 'date', Set<string>> = {
  string: new Set(['eq', 'in', 'contains']),
  number: new Set(['eq', 'gte', 'lte', 'between']),
  // ★ 2026-11-20 R100 days_passed = 「N일 이상 지남」(회차마다 그날 기준 · 설계서 docs/2026-11-20-staff-tickets-four-design.md P1-3)
  date: new Set(['days_within', 'days_passed', 'gte', 'lte', 'date_gte', 'date_lte', 'birth_month']),
};
const CUSTOM_OPS = new Set(['eq', 'gte', 'lte', 'between', 'in', 'contains', 'date_gte', 'date_lte', 'days_within', 'days_passed']);

/** 칸 조건 검증 — 칸 목록(값 있는 칸) · 연산자 · 값 모양. 틀리면 null(호출부가 고르기 필요로 돌린다). */
export function validateCondition(
  c: { term?: string; field: string; operator: string; value: any },
  options: AudienceFieldOption[],
  source: 'ai' | 'user',
): AudienceCondition | null {
  const opt = options.find((o) => o.field === c.field);
  if (!opt) return null;
  const op = String(c.operator || '').trim();
  const allowed = opt.kind === 'custom' ? CUSTOM_OPS : (c.field === 'birth_date' ? OPS_BY_TYPE.date : OPS_BY_TYPE[opt.dataType]);
  if (!allowed.has(op)) return null;
  // 값이 비거나 숫자 문법이 아니면 조건이 아니다 — 숫자로 바꾸면 0 이 되어 「0 이상 = 전원」으로 넓어진다(Codex 2R · 3R: 「,」 도)
  const present = (v: any) => v != null && String(v).trim() !== '';
  const num = (v: any): number | null => {
    const t = String(v ?? '').replace(/,/g, '').trim();
    return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
  };
  let value = c.value;
  if (op === 'between') {
    if (!Array.isArray(value) || value.length !== 2) return null;
    const nums = value.map(num);
    if (nums.some((n: number | null) => n == null)) return null;
    value = nums;
  } else if (op === 'in') {
    if (!Array.isArray(value) || value.length === 0 || !value.every(present)) return null;
    value = value.map((v: any) => String(v)).slice(0, 50);
  } else if (['gte', 'lte', 'birth_month'].includes(op) && opt.dataType !== 'date' || RELATIVE_DAY_OPS.has(op) || op === 'birth_month') {
    const n = num(value);
    if (n == null) return null;
    value = n;
  } else {
    if (value == null || String(value).trim() === '') return null;
    value = String(value).trim().slice(0, 100);
  }
  return {
    term: String(c.term || opt.label).slice(0, 40), field: opt.field, label: opt.label, operator: op, value,
    fillCount: opt.fillCount, samples: opt.samples, source,
  };
}

/**
 * 칸 조건 → 컴파일용 filters(buildFilterWhereClauseCompat 형식) — 조건 → SQL 의 유일한 다리(등록 검증 · 미리보기 · 회차 · 발송 공용).
 *   ⛔ 조건이 하나라도 사라지면 대상이 넓어진다(Codex 1R) — 사라지는 입력은 여기서 거절한다(AudienceConditionError).
 *     ① 같은 칸은 이상 + 이하 한 쌍(between)만 — 그 밖 겹침은 앞 조건이 덮인다.
 *     ② 조건마다 SQL 이 실제로 나와야 한다 — 지원하지 않는 연산자는 빈 조각이 된다(★ 2026-10-18 매장 코드는 이제 소속 표 조건으로 나온다 · customer-filter 0-3).
 */
export function conditionsToFilters(
  conditions: Array<Pick<AudienceCondition, 'field' | 'operator' | 'value'> & { label?: string }>,
): Record<string, { operator: string; value: any }> {
  const out: Record<string, { operator: string; value: any }> = {};
  const names: Record<string, string> = {};
  for (const c of conditions) {
    names[c.field] = c.label || names[c.field] || c.field;
    const prev = out[c.field];
    if (prev) {
      if ((prev.operator === 'gte' && c.operator === 'lte') || (prev.operator === 'lte' && c.operator === 'gte')) {
        const lo = prev.operator === 'gte' ? prev.value : c.value;
        const hi = prev.operator === 'lte' ? prev.value : c.value;
        out[c.field] = { operator: 'between', value: [lo, hi] };
        continue;
      }
      throw new AudienceConditionError(`「${names[c.field]}」 칸에 조건이 겹쳐요. 한 칸에는 조건 하나(이상 · 이하는 한 쌍까지)만 쓸 수 있어요.`);
    }
    out[c.field] = { operator: c.operator, value: c.value };
  }
  // ★ 2026-11-20 R101 — 판정 = 조건 모양 CT 하나(옛: 빈 조각만 봐서 날짜 칸의 글자 값 = 0건(AND FALSE)이 통과 → 매 회차 0명 · 칸 key 노출)
  const issue = filterConditionIssues(out).find((i) => i.reason !== 'ignored');   // 칸 목록에 기본 WHERE 키는 없다(방어)
  if (issue) throw new AudienceConditionError(`「${names[issue.field] || issue.field}」 조건은 발송 대상 조건으로 쓸 수 없어요. 다른 칸을 골라 주세요.`);
  return out;
}

// ── 칸 고른 뒤 조건(판정 = 위 검사 그대로 · 따로 둔 허용 표 없음) ──

type PickSource = { term: string; operator?: string | null; value?: any };

/**
 * 고른 칸 + 그 말의 기준 → 번역기가 받는 조건(못 받으면 null).
 *   기준이 없는 말 = 옛 기본(숫자 gte 1 · 글자 eq 표본) · 날짜 칸은 방향(며칠 안 · 며칠 이상 지남)을 짐작하지 않는다.
 */
export function conditionForPick(src: PickSource | null | undefined, opt: AudienceFieldOption): AudienceCondition | null {
  if (!src) return null;
  const op = String(src.operator || '').trim();
  if (!op && opt.dataType === 'date') return null;
  const numeric = opt.dataType === 'number';
  const made = validateCondition({
    term: src.term, field: opt.field,
    operator: op || (numeric ? 'gte' : 'eq'),
    value: src.value ?? (numeric ? 1 : (opt.samples[0] ?? '')),
  }, [opt], 'user');
  if (!made) return null;
  try { conditionsToFilters([made]); } catch { return null; }   // SQL 로 안 나오는 조건(표 밖 기준 · 틀린 값) = 고를 수 없음
  return made;
}

/** 잠긴 칸의 사유(인터뷰 질문 · 승인 창이 같은 글). 고를 수 있으면 null. */
export function pickLockReason(src: PickSource | null | undefined, opt: AudienceFieldOption): string | null {
  if (conditionForPick(src, opt)) return null;
  const op = String(src?.operator || '').trim();
  if (!op && opt.dataType === 'date') return '날짜 기준(최근 며칠 안 · 며칠 이상 지남)을 알 수 없어 날짜 칸은 고를 수 없어요. 한 줄에 「90일 이상 지난」처럼 적어 주세요.';
  if ((RELATIVE_DAY_OPS.has(op) || op === 'birth_month' || op === 'date_gte' || op === 'date_lte') && opt.dataType !== 'date') return '이 말은 날짜 기준이라 날짜 칸만 고를 수 있어요.';
  return '이 말의 기준 · 값을 이 칸에 쓸 수 없어요.';
}

/** 보관본(carry)에서 그 말의 기준 출처 = 못 정한 말(unresolved) 먼저 · 없으면 앞 조건 */
export function pickSourceOf(carry: AudienceTranslation | null | undefined, term: string | null | undefined): PickSource | null {
  if (!carry || !term) return null;
  if (carry.kind === 'needs_choice') {
    const u = carry.unresolved.find((x) => x.term === term);
    if (u) return { term, operator: u.operator ?? null, value: u.value };
  }
  if (carry.kind === 'needs_choice' || carry.kind === 'filters') {
    const c = carry.conditions.find((x) => x.term === term);
    if (c) return { term, operator: c.operator, value: c.value };
  }
  return null;
}

/** 화면 · 질문표용 — 말마다 잠긴 칸과 사유(못 정한 말 + 정한 말 · 「다른 칸 고르기」) */
export function pickLocksOf(tr: AudienceTranslation, options: AudienceFieldOption[]): Record<string, Array<{ field: string; reason: string }>> {
  const out: Record<string, Array<{ field: string; reason: string }>> = {};
  const terms = [
    ...(tr.kind === 'needs_choice' ? tr.unresolved.map((u) => u.term) : []),
    ...(tr.kind === 'needs_choice' || tr.kind === 'filters' ? tr.conditions.map((c) => c.term) : []),
  ];
  for (const term of terms) {
    const src = pickSourceOf(tr, term);
    const locks = options.flatMap((o) => { const reason = pickLockReason(src, o); return reason ? [{ field: o.field, reason }] : []; });
    if (locks.length > 0) out[term] = locks;
  }
  return out;
}
