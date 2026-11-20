// ============================================================
// 대상 번역 module (★ 2026-10-05 · 설계서 docs/2026-10-05-automarketing-trust-design.md §2-2)
//   자동 마케팅의 「누구에게」를 등록(미리보기 · 승인 창) 때 **한 번** 계약으로 옮긴다. 결과는 넷 중 하나다.
//     축(segment_key) · 칸 조건(audience_filters) · 고르기 필요(옮기지 못한 말이 있다) · 막힘(데이터 없음 · 조건 없음 · 주기 짝)
//   ⛔ 조건을 빼서 넓히지 않는다 — 생일 데이터가 없는 회사의 「생일 쿠폰」이 전체 고객으로 잡힌 접수의 뿌리였다.
//   ⛔ 근거 숫자(값 있는 고객 수 · 값 예시 · 대상 수)는 DB 만 센다. AI 가 낸 칸 · 연산자 · 값은 칸 목록으로 검증한다.
//   회차는 이 결과(계약)만 컴파일한다 — 회차마다 대상 AI 를 부르지 않는다(§2 불변 원칙 1).
// ============================================================
import { UserFacingError } from './http-error';
import { query } from '../config/database';
import {
  detectActiveFields, suggestSegmentForObjective, translateObjectiveToConditions,
  type ActiveFieldsResult, type UnexpressedTerm,
} from '../services/ai';
import {
  SegmentKey, normalizeSegmentKey, normalizeSegmentParams, getSegmentContract, checkSchedulePairing, type LockUnlock,
  schedulePeriod, segmentNeedsCycleBaseline, kstMonthDays,
} from './automarketing-segment';
import { listSegmentAvailability, countOperatorAudienceFor, resolveOperatorStoreScope } from './operator-audience';
import { normalizeTargetHint } from './autosend-policy';
import { getColumnFields } from './standard-field-map';
import { customFieldRef } from './safe-field-name';
import { isDateLikeValue, FILTER_OPERATOR_TEXT } from './customer-filter';
// ★ 2026-11-20 P3 · Codex 구현 1R #3 — 칸 조건 검사 · 칸 고르기 = audience-condition 한 곳(순수) · 옛 이름은 다시 내보냄(소비처 무변경)
import { AudienceConditionError, validateCondition, conditionsToFilters, conditionForPick, pickSourceOf } from './audience-condition';
export { AudienceConditionError, validateCondition, conditionsToFilters };

/** 칸 조건 하나(화면 · 저장 공용). 근거 숫자는 DB 가 채운다. */
export interface AudienceCondition {
  /** 사용자가 쓴 말(없으면 칸 이름) */
  term: string;
  /** 표준 칸 key 또는 custom_fields.custom_N */
  field: string;
  /** 화면 이름(표준 칸 표시 이름 · 회사 전용 칸 라벨) */
  label: string;
  operator: string;
  value: any;
  /** 값 있는 고객 수(DB) */
  fillCount?: number;
  /** 값 예시(DB · 자유 입력 칸은 없음) */
  samples?: string[];
  /** 누가 골랐나 — 화면의 「AI 추천」 표시 */
  source: 'ai' | 'user';
}

/** 칸 고르기 목록의 한 줄 */
export interface AudienceFieldOption {
  field: string;
  label: string;
  kind: 'standard' | 'custom';
  dataType: 'string' | 'number' | 'date';
  fillCount: number;
  samples: string[];
  /** 값이 없어 고를 수 없는 칸(옮기지 못한 말과 이름이 겹칠 때만 보여 준다 · 「포인트 칸은 비어 있어요」) */
  disabled?: boolean;
}

export type AudienceTranslation =
  // ★ 2026-11-17 C142 — repeatNotice = 반복 짝(매일 · 매주 + 상태 조건)을 담당자가 직접 골라 통과한 경고 줄 · ackKey = 막힌 짝의 지문(화면이 되돌려 보낸다) · unlock = 사람이 화면에서 풀 수 있는 잠금(등급 순서)
  | { kind: 'axis'; segmentKey: SegmentKey; segmentParams: Record<string, number>; label: string; description: string; mapped: boolean; repeatNotice?: string }
  | { kind: 'filters'; conditions: AudienceCondition[]; repeatNotice?: string }
  | { kind: 'needs_choice'; conditions: AudienceCondition[]; unresolved: UnexpressedTerm[]; options: AudienceFieldOption[] }
  | { kind: 'blocked'; code: 'DATA_MISSING' | 'PAIRING' | 'NO_CONDITION' | 'TRANSLATE_FAILED'; reason: string; suggestKey?: SegmentKey | null; ackKey?: string; unlock?: LockUnlock; axisKey?: SegmentKey };

const FREE_TEXT = new Set(['name', 'address', 'email']);

// ── 칸 목록 · 근거 ──

/** 이 회사의 칸 목록 + 근거(값 있는 고객 수 · 값 예시). 값 있는 칸만 고를 수 있다. */
export async function loadAudienceFieldOptions(companyId: string, active?: ActiveFieldsResult): Promise<{ options: AudienceFieldOption[]; zero: AudienceFieldOption[]; active: ActiveFieldsResult }> {
  const a = active || await detectActiveFields(companyId);
  const counts = a.fillCounts || {};
  const options: AudienceFieldOption[] = [];
  const zero: AudienceFieldOption[] = [];
  const rangeFields = a.activeColumnFields.filter((f) => f.dataType === 'number' || f.dataType === 'date');
  const ranges: Record<string, string[]> = {};
  if (rangeFields.length > 0) {
    try {
      const sel = rangeFields.map((f) => `MIN(${f.columnName})::text AS "min_${f.fieldKey}", MAX(${f.columnName})::text AS "max_${f.fieldKey}"`).join(', ');
      const r = await query(`SELECT ${sel} FROM customers WHERE company_id = $1 AND is_active = true`, [companyId]);
      const row = r.rows[0] || {};
      for (const f of rangeFields) {
        const lo = row[`min_${f.fieldKey}`];
        const hi = row[`max_${f.fieldKey}`];
        ranges[f.fieldKey] = [lo, hi].filter((v) => v != null && v !== '').map((v) => String(v).slice(0, 10));
      }
    } catch { /* 범위 예시는 부가 정보 — 실패해도 목록은 낸다 */ }
  }
  for (const f of getColumnFields()) {
    if (f.fieldKey === 'phone' || f.fieldKey === 'sms_opt_in') continue;
    const fillCount = counts[f.fieldKey] || 0;
    const dataType = (f.dataType === 'number' || f.dataType === 'date') ? f.dataType : 'string';
    const opt: AudienceFieldOption = {
      field: f.fieldKey, label: f.displayName, kind: 'standard', dataType, fillCount,
      samples: FREE_TEXT.has(f.fieldKey) ? [] : (dataType === 'string' ? (a.distinctValues[f.fieldKey] || []).slice(0, 3) : (ranges[f.fieldKey] || [])),
    };
    if (fillCount > 0) options.push(opt); else zero.push({ ...opt, disabled: true });
  }
  const customKeys = Object.keys(a.customFieldLabels);
  if (customKeys.length > 0) {
    let cc: Record<string, any> = {};
    try {
      const sel = customKeys.map((k, i) => `COUNT(*) FILTER (WHERE ${customFieldRef(k)} IS NOT NULL AND ${customFieldRef(k)} <> '')::int AS "c${i}"`).join(', ');
      const r = await query(`SELECT ${sel} FROM customers WHERE company_id = $1 AND is_active = true`, [companyId]);
      cc = r.rows[0] || {};
    } catch { /* 셀 수 없으면 회사 전용 칸은 고를 수 없는 것으로(넓히는 쪽으로 해석하지 않는다) */ }
    customKeys.forEach((k, i) => {
      const fillCount = Number(cc[`c${i}`]) || 0;
      const samples = (a.distinctValues[`custom_fields.${k}`] || []).slice(0, 3);
      // ★ 2026-11-20 R100 — 표본이 모두 날짜 모양이면 날짜 칸(변환기가 이상 · 이하 · 상대 기준을 날짜로 비교하는 것과 같은 판정 isDateLikeValue)
      const dated = samples.length > 0 && samples.every((s) => isDateLikeValue(s));
      const numeric = !dated && samples.length > 0 && samples.every((s) => /^-?[\d,.]+$/.test(String(s)));
      const opt: AudienceFieldOption = {
        field: `custom_fields.${k}`, label: a.customFieldLabels[k], kind: 'custom',
        dataType: dated ? 'date' : numeric ? 'number' : 'string', fillCount, samples,
      };
      if (fillCount > 0) options.push(opt); else zero.push({ ...opt, disabled: true });
    });
  }
  options.sort((x, y) => y.fillCount - x.fillCount);
  return { options, zero, active: a };
}

/**
 * 한 번역 안에서 말(term)을 유일하게 — 말이 창 편집의 식별자다(같은 말 둘이면 하나를 고를 때 다른 하나가 빠진다 · Codex 3R).
 *   두 번째부터 「금액 (2)」. 이름 없는 말 = 「대상 조건」.
 */
export function termUniquer(): (raw: string | null | undefined) => string {
  const used = new Set<string>();
  return (raw) => {
    const t = String(raw || '').trim().slice(0, 36) || '대상 조건';
    let out = t;
    for (let i = 2; used.has(out); i++) out = `${t} (${i})`;
    used.add(out);
    return out;
  };
}

// ★ 2026-11-20 R1 — 기준 문구 = 변환기 옆 한 표(FILTER_OPERATOR_TEXT)
const OP_TEXT = FILTER_OPERATOR_TEXT;

/** 칸 조건 → 사람 말 한 줄(화면 기준 · 문안 대상 블록 공용). 예: 「잔여멤버쉽 1,000 이상 · 등급 VIP」 */
export function describeConditions(conditions: Array<Pick<AudienceCondition, 'label' | 'operator' | 'value'>>): string {
  const fmt = (v: any) => (typeof v === 'number' ? v.toLocaleString('ko-KR') : String(v));
  return conditions.map((c) => {
    if (c.operator === 'between' && Array.isArray(c.value)) return `${c.label} ${fmt(c.value[0])}~${fmt(c.value[1])}`;
    if (c.operator === 'in' && Array.isArray(c.value)) return `${c.label} ${c.value.join('·')}`;
    if (c.operator === 'birth_month') return `${c.label} ${fmt(c.value)}월`;
    if (c.operator === 'days_passed') return `${c.label} ${fmt(c.value)}${OP_TEXT.days_passed}`;   // 「최근구매일 90일 이상 지남」
    const tail = OP_TEXT[c.operator] ?? '';
    return `${c.label} ${fmt(c.value)}${tail ? ` ${tail}` : ''}`;
  }).join(' · ');
}

// ── 번역 ──

/**
 * 목표 → 계약. 명시 값(고른 축 · 옛 축 힌트 · 고른 칸 조건)이 있으면 AI 를 부르지 않는다.
 *   AI 순서 = 축 매핑(잠긴 축 포함) → 칸 번역. 둘 다 무과금(등록 1회 번역).
 */
export async function translateAudience(input: {
  companyId: string;
  userId: string | null;
  objective: string;
  schedule: string | null | undefined;
  segmentKey?: string | null;
  segmentParams?: Record<string, number> | null;
  targetHint?: string | null;
  conditions?: Array<{ term?: string; field: string; operator?: string; value?: any }> | null;   // ★ 2026-11-20 P3 기준 없음 = 칸만 고름(보관본 기준으로 채움)
  /** 창 편집 — 지금 창의 번역. 그 번역의 말(term)은 하나도 빠지지 않아야 한다(이미 정한 말 = 그대로 · 못 정한 말 = 남으면 계속 고르기) */
  carry?: AudienceTranslation | null;
  /** ★ C142 — 담당자가 직접 고른 반복 짝의 지문(보관본 · 승인 기록) · 지금 짝 지문과 같을 때만 통과 */
  repeatAck?: string | null;
}): Promise<AudienceTranslation> {
  const explicitKeyRaw = typeof input.segmentKey === 'string' && input.segmentKey.trim()
    ? input.segmentKey.trim()
    : (normalizeTargetHint(input.targetHint) || '');   // 옛 축 힌트 = 같은 이름의 축(AI 지시 갈래 삭제)
  const axes = await listSegmentAvailability(input.companyId);
  // ★ C142 — 짝 막힘 제안은 이 회사에서 열린 축만(잠긴 「등급이 오른 고객」을 가리키지 않는다 · R56)
  const isAvailable = (k: SegmentKey) => axes.some((x) => x.key === k && x.available);
  const pairOf = (target: Parameters<typeof checkSchedulePairing>[1]) => checkSchedulePairing(input.schedule, target, input.repeatAck ?? null, isAvailable);
  /** 칸 조건이 확정된 뒤의 짝 판정(지문 = 그 조건) — 통과 = filters(+ 경고 줄) · 막힘 = PAIRING + 지문 */
  const filtersOrPairing = (conditions: AudienceCondition[]): AudienceTranslation => {
    const pair = pairOf({ conditions });
    if (!pair.ok) return { kind: 'blocked', code: 'PAIRING', reason: pair.reason, suggestKey: pair.suggestKey, ackKey: pair.ackKey };
    return { kind: 'filters', conditions, ...(pair.repeatNotice ? { repeatNotice: pair.repeatNotice } : {}) };
  };

  const asAxis = (key: SegmentKey, params: Record<string, number> | null | undefined, mapped: boolean): AudienceTranslation => {
    const a = axes.find((x) => x.key === key);
    const c = getSegmentContract(key);
    if (!a || !a.available) {
      return {
        kind: 'blocked', code: 'DATA_MISSING',
        reason: `이 목표는 「${c?.label || key}」에게 보내는 목표인데, ${a?.reason || '이 조건을 지금은 쓸 수 없어요.'}`,
        ...(a?.unlock ? { unlock: a.unlock, axisKey: key } : {}),   // ★ C142 — 막힘 창이 [등급 순서 정하기]를 그리고 · 저장 뒤 이 축으로 다시 센다
      };
    }
    const segmentParams = normalizeSegmentParams(key, params);
    const pair = pairOf({ segmentKey: key, segmentParams });
    if (!pair.ok) return { kind: 'blocked', code: 'PAIRING', reason: pair.reason, suggestKey: pair.suggestKey, ackKey: pair.ackKey };
    return { kind: 'axis', segmentKey: key, segmentParams, label: c?.label || key, description: c?.description || '', mapped, ...(pair.repeatNotice ? { repeatNotice: pair.repeatNotice } : {}) };
  };

  if (explicitKeyRaw) {
    const key = normalizeSegmentKey(explicitKeyRaw);
    // ★ 2026-10-25 R11 — 다른 대상 판정과 같은 사람 문장(옛: 내부 키를 붙여 고객 화면에 보였다)
    if (!key) throw new AudienceConditionError('알 수 없는 발송 대상이에요. 화면을 새로 고친 뒤 대상을 다시 골라 주세요.');
    return asAxis(key, input.segmentParams, false);
  }

  const { options, zero, active } = await loadAudienceFieldOptions(input.companyId);
  // 못 정한 말과 이름이 겹치는 빈 칸도 보여 준다(「포인트 칸은 비어 있어요」)
  const withRelated = (terms: UnexpressedTerm[]) => [
    ...options, ...zero.filter((z) => terms.some((u) => u.term && (z.label.includes(u.term) || u.term.includes(z.label)))),
  ];

  if (Array.isArray(input.conditions) && input.conditions.length > 0) {
    // ★ C142 — 짝 판정은 조건이 확정된 뒤(지문 = 고른 조건) · 아래 filters 반환 자리
    if (input.conditions.length > 8) throw new AudienceConditionError('조건은 8개까지 고를 수 있어요.');   // 잘라 내면 그만큼 넓어진다
    // ★ 2026-11-20 P3 — 기준 없이 칸만 온 조건(화면 「칸 고르기」 · 인터뷰 칸 답) = 보관본의 그 말 기준으로 서버가 채운다(규칙 한 곳)
    const filled = input.conditions.map((c): { term?: string; field: string; operator: string; value: any } => {
      if (String(c.operator || '').trim()) return { ...c, operator: String(c.operator), value: c.value };
      const opt = options.find((o) => o.field === c.field);
      const made = opt ? conditionForPick(pickSourceOf(input.carry, c.term), opt) : null;
      if (!made) throw new AudienceConditionError(`「${c.term || '이 조건'}」은(는) 「${opt?.label || '고른'}」 칸으로 볼 수 없어요. 다른 칸을 골라 주세요.`);
      return made;
    });
    const validated = filled.map((c) => validateCondition(c, options, 'user'));
    if (validated.some((v) => !v)) throw new AudienceConditionError('고르신 칸이나 기준을 쓸 수 없어요. 값이 있는 칸과 숫자 기준으로 다시 골라 주세요.');
    const picked = validated as AudienceCondition[];
    conditionsToFilters(picked);   // 겹침 · SQL 로 안 나오는 조건 = 400(저장 전에)
    // ★ Codex 2R — 창의 말(term)은 하나도 빠지지 않는다: 이미 정한 말이 빠지면 400 · 못 정한 말이 남으면 계속 고르기
    const carry = input.carry && (input.carry.kind === 'filters' || input.carry.kind === 'needs_choice') ? input.carry : null;
    if (carry) {
      const covered = new Set(picked.map((c) => c.term));
      const lost = [...new Set(carry.conditions.map((c) => c.term))].filter((t) => !covered.has(t));
      if (lost.length > 0) throw new AudienceConditionError(`「${lost.join('」 · 「')}」 조건이 빠졌어요. 조건은 빼지 않고 칸이나 기준만 바꿀 수 있어요.`);
      const remaining = carry.kind === 'needs_choice' ? carry.unresolved.filter((u) => !covered.has(u.term)) : [];
      if (remaining.length > 0) {
        const uniq = termUniquer();
        const conds = picked.map((c) => ({ ...c, term: uniq(c.term) }));
        return { kind: 'needs_choice', conditions: conds, unresolved: remaining.map((u) => ({ ...u, term: uniq(u.term) })), options: withRelated(remaining) };
      }
    }
    const uniq = termUniquer();
    return filtersOrPairing(picked.map((c) => ({ ...c, term: uniq(c.term) })));
  }

  const objective = String(input.objective || '').trim();
  const mapped = await suggestSegmentForObjective(input.companyId, input.userId, objective, axes);
  if (mapped) {
    const key = normalizeSegmentKey(mapped.key);
    if (key) return asAxis(key, mapped.params, true);
  }

  const translated = await translateObjectiveToConditions(input.companyId, input.userId, objective, active);
  if (!translated) {
    return { kind: 'blocked', code: 'TRANSLATE_FAILED', reason: '목표에서 누구에게 보낼지 읽지 못했어요. 받는 분을 골라 주세요.' };
  }
  if (translated.everyone) {
    return { kind: 'blocked', code: 'NO_CONDITION', reason: '누구에게 보낼지 조건이 없어요. 받는 분을 골라 주세요. 모든 고객에게 보내려면 「전체 고객」을 고르면 돼요.' };
  }
  // 말을 먼저 유일하게 — 같은 말의 조건 둘(하한 · 상한)이 고르기 한 번에 함께 사라지지 않게
  const uniq = termUniquer();
  const aiConditions = translated.conditions.map((c) => ({ ...c, term: uniq(c.term || c.field) }));
  const conditions: AudienceCondition[] = [];
  const unresolved: UnexpressedTerm[] = translated.unexpressed.map((u) => ({ ...u, term: uniq(u.term) }));
  for (const c of aiConditions) {
    const v = validateCondition(c, options, 'ai');
    let usable = !!v;
    if (v) {
      // 앞 조건과 겹치거나 SQL 로 안 나오면 = 빼지 않고 고르게(남은 조건만으로 넓어지지 않게)
      try { conditionsToFilters([...conditions, v]); } catch (e) { if (!(e instanceof AudienceConditionError)) throw e; usable = false; }
    }
    if (usable) conditions.push(v!);
    else unresolved.push({ term: c.term || c.field, operator: c.operator, value: c.value });   // 목록 밖 칸 = 빼지 않고 고르게
  }
  if (unresolved.length > 0) return { kind: 'needs_choice', conditions, unresolved, options: withRelated(unresolved) };
  if (conditions.length === 0) {
    return { kind: 'blocked', code: 'NO_CONDITION', reason: '누구에게 보낼지 조건이 없어요. 받는 분을 골라 주세요. 모든 고객에게 보내려면 「전체 고객」을 고르면 돼요.' };
  }
  return filtersOrPairing(conditions);
}

// ── 대상 수 · 날짜별 예상 ──

/**
 * 계약의 대상 수(회차와 같은 문 · 같은 게이트 · 같은 매장 범위). 변화 축은 첫 회차가 기준선이라 null.
 *   anchor = 회차 기준 시각(생일 축 기간의 기준일).
 */
export async function countContractAudience(input: {
  companyId: string;
  ownerUserId: string | null;
  schedule: string | null | undefined;
  segmentKey?: string | null;
  segmentParams?: Record<string, number> | null;
  conditions?: Array<Pick<AudienceCondition, 'field' | 'operator' | 'value'>> | null;
  anchor?: Date;
}): Promise<number | null> {
  const key = normalizeSegmentKey(input.segmentKey);
  if (key && segmentNeedsCycleBaseline(key)) return null;
  const scope = await resolveOperatorStoreScope(input.companyId, input.ownerUserId);
  if (scope.blocked) throw new UserFacingError(409, 'STORE_SCOPE_MISSING', '담당 매장이 지정되지 않아 발송 대상을 정할 수 없어요. 관리자에게 매장 권한을 받아 주세요.');
  const m = await countOperatorAudienceFor({
    companyId: input.companyId,
    segmentKey: key,
    segmentParams: input.segmentParams,
    legacyFilters: key ? null : conditionsToFilters(input.conditions || []),
    storeFilter: scope.storeFilter,
    baseParams: scope.baseParams,
    ownerUserId: input.ownerUserId,
    period: schedulePeriod(input.schedule),
    now: input.anchor,
  });
  return m.count;
}

/**
 * 날짜별 예상 대상(생일 축 · 매일 주기만 — 날짜로 정확히 정해지는 축). 그 밖은 null(회차마다 그때 다시 센다).
 *   startAt = 승인 기간 첫 회차 발송 시각.
 */
export async function forecastByDate(input: {
  companyId: string;
  ownerUserId: string | null;
  schedule: string | null | undefined;
  segmentKey?: string | null;
  startAt: Date;
  days: number;
}): Promise<Array<{ date: string; count: number }> | null> {
  if (normalizeSegmentKey(input.segmentKey) !== 'birthday' || schedulePeriod(input.schedule) !== 'day') return null;
  const out: Array<{ date: string; count: number }> = [];
  for (let i = 0; i < input.days; i++) {
    const at = new Date(input.startAt.getTime() + i * 24 * 60 * 60 * 1000);
    const count = await countContractAudience({
      companyId: input.companyId, ownerUserId: input.ownerUserId, schedule: input.schedule,
      segmentKey: 'birthday', anchor: at,
    });
    const kst = new Date(at.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    out.push({ date: kst, count: count ?? 0 });
  }
  return out;
}

/** 테스트 · 화면 설명용 — 생일 기간의 월일 목록(축 계약과 같은 함수) */
export const birthdayWindowDays = kstMonthDays;
