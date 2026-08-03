/**
 * automarketing-segment.ts — 자동마케팅 세그먼트 계약 (2026-08-03 타겟팅 재설계 A-6)
 *   DB import 0 — 순수. 사실(facts)을 받아 축별 가능 여부·사유를 만들고, 축이 정해지면 SQL 조각을 만든다.
 *
 * 왜 계약인가 (설계서 §2-2·§2-3)
 *   종전 `TARGET_HINTS` 6종은 **자연어 지시**였다 — "휴면 = 최근 구매 기록이 오래된 고객. 회사 스키마에서
 *   최근 구매일 필드를 찾아 구성한다." 그 회사에 근거가 없으면 AI가 다른 필드로 대체하거나 빈 조건을 만들었고,
 *   무엇이 나올지 계약이 없었다. 화면은 6종을 회사 데이터와 무관하게 항상 다 보여줬다.
 *   여기서는 축이 정해지면 SQL이 정해진다 — 같은 축·같은 파라미터·같은 데이터면 언제 돌려도 같은 명단이다.
 *
 * ⛔ 우리는 정답표를 갖지 않는다
 *   "이 회사는 휴면이 되고 저 회사는 안 된다"를 미리 정해 두지 않는다. 근거가 있는지를 런타임에 판정하고,
 *   없으면 숨기지 않고 사유와 함께 잠근다. 사유 문구는 화면에 그대로 나가므로 고객 언어로만 쓴다.
 *
 * ⛔ 예측으로 대상을 고르지 않는다 (feedback_prediction_never_selects_target)
 *   전 축이 "명확한 규칙"이다. 점수·확률로 뽑는 축은 여기 넣지 않는다.
 */

export type SegmentKey = 'all' | 'dormant' | 'recent_buyers' | 'vip' | 'birthday' | 'new_customers';

export const SEGMENT_KEYS: SegmentKey[] = ['all', 'dormant', 'recent_buyers', 'vip', 'birthday', 'new_customers'];

/** 담당자가 조절하는 값. 없는 축도 있다. */
export interface SegmentParamDef {
  key: string;
  label: string;
  unit: string;
  default: number;
  min: number;
  max: number;
}

/**
 * 회사가 실제로 준 것. 호출부(operator-audience)가 실측으로 채운다.
 * 여기서 기본값을 지어내지 않는다 — 모르면 false다.
 */
export interface CompanySegmentFacts {
  /** 최근 구매일이 채워진 고객이 있는가 — 휴면·최근구매 축의 근거. */
  hasRecentPurchaseDate: boolean;
  /** 생일이 채워진 고객이 있는가. */
  hasBirthday: boolean;
  /** 등급 값 자체가 있는가(사유 분기용). */
  hasGradeValues: boolean;
  /**
   * 등급 **서열을 회사가 확인**했는가(서로 다른 순위 2개 이상).
   * ⛔ 값만 있고 서열이 없으면 무엇이 위인지 우리가 알 수 없다. 그 상태로 열면 엉뚱한 등급에 나간다.
   *   여정이 등급 상승에서 쓰는 판정(customer-grade-rank)을 그대로 공유한다.
   */
  hasGradeOrder: boolean;
}

export interface SegmentAvailability {
  key: SegmentKey;
  label: string;
  available: boolean;
  /** 왜 되는지 / 왜 안 되는지 — 화면에 그대로 나간다. */
  reason: string;
  params: SegmentParamDef[];
}

/** 축이 정해진 뒤 SQL을 만들 때 필요한, DB에서 해석해 넣어 주는 값. */
export interface SegmentBuildContext {
  /** 판정 기준 시각. 주입받는다(테스트 결정성 · 프로세스 시계 의존 제거). */
  now: Date;
  /** vip 전용 — 회사가 확인한 서열에서 상위 급에 속하는 등급 값들. 비면 vip 축은 컴파일 불가. */
  topGradeValues?: string[];
}

const DAYS_PARAM = (label: string, def: number): SegmentParamDef => ({
  key: 'days', label, unit: '일', default: def, min: 1, max: 3650,
});

interface SegmentContract {
  key: SegmentKey;
  label: string;
  /** 화면 설명 — 이 축이 정확히 누구를 뽑는지 한 줄로. 두루뭉술 금지. */
  description: string;
  params: SegmentParamDef[];
  /** 근거 판정. available=false면 컴파일하지 않는다. */
  resolve: (f: CompanySegmentFacts) => { available: boolean; reason: string };
  /**
   * WHERE에 AND로 붙는 조각을 만들고 params에 값을 push한다(buildAudienceWhere와 같은 방식).
   * 잠긴 축은 호출되지 않는다 — 방어로 throw한다(조용히 0건을 내면 사유가 사라진다).
   */
  build: (params: any[], values: Record<string, number>, ctx: SegmentBuildContext) => string;
}

/** KST 기준 오늘에서 N일 뺀 날짜(YYYY-MM-DD). date 컬럼 비교용. */
export function kstDateMinusDays(now: Date, days: number): string {
  const kstMs = now.getTime() + 9 * 60 * 60 * 1000 - days * 24 * 60 * 60 * 1000;
  return new Date(kstMs).toISOString().slice(0, 10);
}

/** KST 기준 현재 월(1~12). */
export function kstMonth(now: Date): number {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).getUTCMonth() + 1;
}

export const SEGMENT_CONTRACTS: SegmentContract[] = [
  {
    key: 'all',
    label: '전체 고객',
    description: '문자를 받을 수 있는 전체 고객입니다. 추가 조건을 걸지 않습니다.',
    params: [],
    resolve: () => ({ available: true, reason: '문자를 받을 수 있는 전체 고객에게 보냅니다.' }),
    build: () => '',
  },
  {
    key: 'dormant',
    label: '휴면 고객',
    description: '마지막 구매일이 기준일보다 오래된 고객입니다. 구매 기록이 아예 없는 고객은 포함하지 않습니다.',
    params: [DAYS_PARAM('마지막 구매 이후', 90)],
    resolve: (f) => (f.hasRecentPurchaseDate
      ? { available: true, reason: '마지막 구매일이 기준보다 오래된 고객에게 보냅니다.' }
      : { available: false, reason: '고객의 마지막 구매일 정보가 아직 없어요. 구매 이력을 연동하면 열립니다.' }),
    build: (params, values, ctx) => {
      params.push(kstDateMinusDays(ctx.now, values.days));
      // 구매 기록이 없는 고객(NULL)은 휴면이 아니라 미구매다 — 섞으면 무엇을 보낸 건지 알 수 없다.
      return `AND c.recent_purchase_date IS NOT NULL AND c.recent_purchase_date <= $${params.length}`;
    },
  },
  {
    key: 'recent_buyers',
    label: '최근 구매 고객',
    description: '마지막 구매일이 기준일 이내인 고객입니다.',
    params: [DAYS_PARAM('최근', 30)],
    resolve: (f) => (f.hasRecentPurchaseDate
      ? { available: true, reason: '최근에 구매한 고객에게 보냅니다.' }
      : { available: false, reason: '고객의 마지막 구매일 정보가 아직 없어요. 구매 이력을 연동하면 열립니다.' }),
    build: (params, values, ctx) => {
      params.push(kstDateMinusDays(ctx.now, values.days));
      return `AND c.recent_purchase_date >= $${params.length}`;
    },
  },
  {
    key: 'vip',
    label: '상위 등급 고객',
    description: '회사가 정한 등급 순서에서 가장 위에 있는 등급의 고객입니다.',
    params: [],
    resolve: (f) => {
      if (f.hasGradeOrder) return { available: true, reason: '정해 두신 등급 순서에서 가장 위 등급 고객에게 보냅니다.' };
      if (f.hasGradeValues) {
        return { available: false, reason: '고객등급 순서를 아직 정하지 않으셨어요. 등급 순서를 확인하면 열립니다.' };
      }
      return { available: false, reason: '고객등급 정보가 아직 없어요. 등급이 들어오면 열립니다.' };
    },
    build: (params, _values, ctx) => {
      const tops = (ctx.topGradeValues || []).filter((v) => typeof v === 'string' && v.trim());
      // 잠긴 축을 컴파일하려 한 것이다. 조용한 0건 대신 멈춘다.
      if (tops.length === 0) throw new Error('상위 등급 값이 확인되지 않아 상위 등급 축을 만들 수 없습니다.');
      params.push(tops);
      return `AND c.grade = ANY($${params.length}::text[])`;
    },
  },
  {
    key: 'birthday',
    label: '이번 달 생일 고객',
    description: '발송하는 달에 생일이 있는 고객입니다.',
    params: [],
    resolve: (f) => (f.hasBirthday
      ? { available: true, reason: '발송하는 달에 생일이 있는 고객에게 보냅니다.' }
      : { available: false, reason: '고객 생일 정보가 아직 없어요. 생일이 들어오면 열립니다.' }),
    build: (params, _values, ctx) => {
      params.push(kstMonth(ctx.now));
      return `AND c.birth_date IS NOT NULL AND EXTRACT(MONTH FROM c.birth_date) = $${params.length}`;
    },
  },
  {
    key: 'new_customers',
    label: '새로 등록된 고객',
    description: '고객 정보가 등록된 지 기준일 이내인 고객입니다. 등록 시점은 한줄로에 고객 정보가 들어온 때를 말합니다.',
    params: [DAYS_PARAM('등록 후', 30)],
    // 등록 시각은 모든 고객 행에 남는다 — 회사 데이터 사정과 무관하게 언제나 판정 가능하다.
    resolve: () => ({ available: true, reason: '최근에 등록된 고객에게 보냅니다.' }),
    build: (params, values, ctx) => {
      params.push(new Date(ctx.now.getTime() - values.days * 24 * 60 * 60 * 1000).toISOString());
      return `AND c.created_at >= $${params.length}`;
    },
  },
];

export function getSegmentContract(key: string | null | undefined): SegmentContract | null {
  return SEGMENT_CONTRACTS.find((s) => s.key === key) || null;
}

export function normalizeSegmentKey(raw: unknown): SegmentKey | null {
  return SEGMENT_KEYS.includes(raw as SegmentKey) ? (raw as SegmentKey) : null;
}

/**
 * 저장된 파라미터 정규화 — 없는 값은 기본값, 범위를 벗어나면 자른다.
 * 담당자가 넣은 값이 그대로 SQL에 들어가지 않게 하는 자리이기도 하다(숫자만 통과).
 */
export function normalizeSegmentParams(key: SegmentKey, raw: unknown): Record<string, number> {
  const contract = getSegmentContract(key);
  const src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? (raw as Record<string, unknown>) : {};
  const out: Record<string, number> = {};
  for (const def of contract?.params || []) {
    const n = Number(src[def.key]);
    out[def.key] = Number.isFinite(n) ? Math.min(def.max, Math.max(def.min, Math.floor(n))) : def.default;
  }
  return out;
}

/** 이 회사에서 지금 쓸 수 있는 축과 사유 — 화면·등록 검증이 이 결과만 본다. */
export function resolveSegmentAvailability(facts: CompanySegmentFacts): SegmentAvailability[] {
  const f = facts || ({} as CompanySegmentFacts);
  return SEGMENT_CONTRACTS.map((c) => {
    const r = c.resolve(f);
    return { key: c.key, label: c.label, available: r.available, reason: r.reason, params: c.params };
  });
}

/**
 * 축 + 파라미터 → SQL 조각. 결정성의 실체다 — AI 해석이 여기 개입하지 않는다.
 * 반환 sql은 buildAudienceWhere의 filterWhere 자리에 그대로 들어간다(AND 접두 포함).
 */
export function buildSegmentPredicate(
  key: SegmentKey,
  rawParams: unknown,
  params: any[],
  ctx: SegmentBuildContext,
): string {
  const contract = getSegmentContract(key);
  if (!contract) throw new Error(`알 수 없는 발송 대상 축입니다: ${String(key)}`);
  return contract.build(params, normalizeSegmentParams(key, rawParams), ctx);
}
