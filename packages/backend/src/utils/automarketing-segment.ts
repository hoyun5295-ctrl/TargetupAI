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
 *
 * ⛔ 여기 들어오는 것은 **상태 조회**뿐이다 — 사건 반응은 여정이 소유한다 (2026-08-04 Harold 확정)
 *   두 기능의 정체성은 **시계의 주인**이다. 여정은 고객의 시계로 움직인다(고객이 무언가를 한 순간
 *   그 사람 시계가 시작되고, 언제 나갈지 우리는 모른다). 자동마케팅은 우리 시계로 움직인다
 *   (우리가 정한 시점이 오면 그때 조건에 맞는 사람을 모아 캠페인 한 건을 낸다).
 *   그래서 새 축을 더하기 전에 이것부터 답한다 — **"방금 무엇을 했다"인가, "지금 어떤 상태다"인가.**
 *   전자면 여정이 구조적으로 더 잘한다(담은 그 사람에게 세 시간 뒤 한 번 ≫ 일주일치를 모아 월요일에).
 *   여기 넣으면 못 하게 막는 게 아니라 **더 못 하게 하는 것**이고, 그러면 기능을 나눈 의미가 없다.
 *   ⛔ 장바구니 포기·상품 조회·배송 시작은 이 기준으로 **여정 전용**이다. 여기 추가 금지.
 *
 * ★ 자동마케팅만 가진 어휘 = **회차와 회차 사이의 변화** (2026-08-04)
 *   여정에는 "지난달"이라는 개념이 아예 없다 — 사람마다 시계가 따로 도니 구간을 자를 기준이 없다.
 *   자동마케팅은 회차라는 시간 격자를 갖고 있어 "지난 회차와 지금 사이에 무엇이 달라졌나"를 물을 수 있고,
 *   그건 담당자가 실제로 쓰는 말이다("이번에 등급 오르신 분", "요즘 발길 끊긴 분", "오랜만에 오신 분").
 *   근거는 회차 스냅샷 하나(operator_cycle_snapshots) — 축마다 장치를 만들지 않는다.
 *   비교할 항목을 스냅샷에 하나 더 담으면 축이 하나 더 열린다.
 */

/** 상태 축(명부 한 장으로 판정) */
type StateSegmentKey = 'all' | 'dormant' | 'recent_buyers' | 'vip' | 'birthday' | 'new_customers';
/** 변화 축(지난 회차 스냅샷과 비교해 판정 — 자동마케팅 고유) */
type ChangeSegmentKey = 'grade_up' | 'first_purchase' | 'returned' | 'went_quiet' | 'spent_more';

export type SegmentKey = StateSegmentKey | ChangeSegmentKey;

export const SEGMENT_KEYS: SegmentKey[] = [
  'all', 'dormant', 'recent_buyers', 'vip', 'birthday', 'new_customers',
  'grade_up', 'first_purchase', 'returned', 'went_quiet', 'spent_more',
];

/** 회차 스냅샷 표 — 변화 축의 유일한 근거. 오퍼레이터마다 **직전 한 벌**만 유지한다(UPSERT 덮어쓰기). */
export const CYCLE_SNAPSHOT_TABLE = 'operator_cycle_snapshots';

/** 담당자가 조절하는 값. 없는 축도 있다. */
export interface SegmentParamDef {
  key: string;
  label: string;
  unit: string;
  default: number;
  min: number;
  max: number;
  /**
   * 담당자가 자주 쓰는 값 — 직접 입력 없이 한 번에 고른다(클릭 1회 원칙).
   * ⛔ 프런트에 두지 않는다. 축마다 자연스러운 구간이 다른데 화면이 목록을 들고 있으면
   *   금액 축에 '30일' 버튼이 뜨는 식으로 어긋난다. 범위와 같은 곳에서 정한다.
   */
  presets: number[];
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
  /** 누적 구매 횟수가 채워진 고객이 있는가 — 첫 구매 전환 축의 근거. */
  hasPurchaseCount: boolean;
  /** 누적 구매 금액이 채워진 고객이 있는가 — 구매 증가 축의 근거. */
  hasPurchaseAmount: boolean;
}

export interface SegmentAvailability {
  key: SegmentKey;
  label: string;
  available: boolean;
  /** 왜 되는지 / 왜 안 되는지 — 화면에 그대로 나간다. */
  reason: string;
  params: SegmentParamDef[];
  /**
   * 변화 축인가 — 지난 회차 스냅샷과 비교해 판정한다.
   * ⛔ 화면이 이 값을 보고 **첫 회차 안내**를 먼저 보여준다. 비교할 지난 모습이 없는 상태를
   *   "대상 0" 또는 오류로 보여주면 담당자는 고장으로 읽는다 — 정상 동작이고 안내가 맞다.
   */
  needsCycleBaseline: boolean;
}

/** 축이 정해진 뒤 SQL을 만들 때 필요한, DB에서 해석해 넣어 주는 값. */
export interface SegmentBuildContext {
  /** 판정 기준 시각. 주입받는다(테스트 결정성 · 프로세스 시계 의존 제거). */
  now: Date;
  /** vip 전용 — 회사가 확인한 서열에서 상위 급에 속하는 등급 값들. 비면 vip 축은 컴파일 불가. */
  topGradeValues?: string[];
  /**
   * 변화 축 전용 — 어느 오퍼레이터의 회차 스냅샷과 비교할 것인가.
   * ⛔ 없으면 변화 축은 컴파일하지 않는다. 오퍼레이터가 없으면 "지난 회차"가 없고,
   *   그 상태로 조건을 만들면 비교 대상 없는 술어가 조용히 0건을 낸다(사유가 사라진다).
   */
  operatorId?: string | null;
}

const DAYS_PARAM = (label: string, def: number): SegmentParamDef => ({
  key: 'days', label, unit: '일', default: def, min: 1, max: 3650,
  presets: [30, 60, 90, 180, 365],
});

const AMOUNT_PARAM = (label: string, def: number): SegmentParamDef => ({
  key: 'amount', label, unit: '원', default: def, min: 0, max: 100000000,
  presets: [50000, 100000, 300000, 500000, 1000000],
});

interface SegmentContract {
  key: SegmentKey;
  label: string;
  /** 화면 설명 — 이 축이 정확히 누구를 뽑는지 한 줄로. 두루뭉술 금지. */
  description: string;
  params: SegmentParamDef[];
  /** 변화 축 = 지난 회차 스냅샷과 비교한다. 화면 첫 회차 안내와 워커 기준선 심기가 이 값을 본다. */
  needsCycleBaseline?: boolean;
  /** 근거 판정. available=false면 컴파일하지 않는다. */
  resolve: (f: CompanySegmentFacts) => { available: boolean; reason: string };
  /**
   * WHERE에 AND로 붙는 조각을 만들고 params에 값을 push한다(buildAudienceWhere와 같은 방식).
   * 잠긴 축은 호출되지 않는다 — 방어로 throw한다(조용히 0건을 내면 사유가 사라진다).
   */
  build: (params: any[], values: Record<string, number>, ctx: SegmentBuildContext) => string;
}

/**
 * 변화 축 공통 — 지난 회차 스냅샷 한 행을 잡는 EXISTS 껍데기.
 *
 * ⛔ 짝은 **고객 행 id**로 맞춘다. 전화번호로 이으면 같은 사람이 매장별로 여러 행인 회사에서
 *   A매장 행이 B매장 행의 과거와 비교된다 — 등급이 안 바뀐 사람에게 축하가 나가는 형태다.
 *   행 id로 이으면 각 행이 자기 과거와만 비교되고, 지난 회차 이후 새로 생긴 행은 과거가 없어
 *   변화로 잡히지 않는다(모르면 안 보내는 방향 = fail-closed).
 * ⛔ operatorId가 없으면 조건을 만들지 않고 사유와 함께 멈춘다. "지난 회차"가 없는데 술어를 만들면
 *   비교 대상 없는 조건이 조용히 0건을 낸다 — 담당자는 왜 0인지 알 수 없다.
 */
function cycleCompare(params: any[], ctx: SegmentBuildContext, inner: () => string): string {
  const operatorId = String(ctx.operatorId || '').trim();
  if (!operatorId) {
    throw new Error('이 조건은 지난번 발송 때와 비교해서 대상을 정합니다. 저장하면 첫 회차에 기준을 잡고 그다음 회차부터 대상이 잡힙니다.');
  }
  params.push(operatorId);
  const opIdx = params.length;
  return `AND EXISTS (
         SELECT 1 FROM ${CYCLE_SNAPSHOT_TABLE} s
          WHERE s.operator_id = $${opIdx}::uuid
            AND s.customer_id = c.id
            ${inner()}
       )`;
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

  // ══════════════════════════════════════════════════════════════════
  // 변화 축 — 지난 회차와 지금 사이에 무엇이 달라졌나 (2026-08-04)
  //   여정이 구조적으로 못 하는 질문이다. 여정은 사람마다 시계가 따로 돌아 구간을 자를 기준이 없다.
  //   전부 같은 근거(회차 스냅샷 한 벌)를 쓰므로 비교할 항목을 스냅샷에 더하면 축이 하나 더 열린다.
  //   ⛔ 첫 회차는 비교할 지난 모습이 없다 — 기준선만 심고 대상 0 + 사유 통지(조용한 0건 금지).
  // ══════════════════════════════════════════════════════════════════
  {
    key: 'grade_up',
    label: '등급이 오른 고객',
    description: '지난번 발송 때보다 등급이 올라간 고객입니다. 회사가 정한 등급 순서로만 판단하고, 같은 급 안에서 이름만 바뀐 것은 상승으로 보지 않습니다.',
    params: [],
    needsCycleBaseline: true,
    resolve: (f) => {
      if (f.hasGradeOrder) return { available: true, reason: '지난번보다 등급이 올라간 고객에게 보냅니다.' };
      if (f.hasGradeValues) {
        return { available: false, reason: '고객등급 순서를 아직 정하지 않으셨어요. 등급 순서를 확인하면 열립니다.' };
      }
      return { available: false, reason: '고객등급 정보가 아직 없어요. 등급이 들어오면 열립니다.' };
    },
    // ⛔ 여정 등급 상승과 같은 판정 — 양쪽 등급이 모두 순서표에 있고 순위가 실제로 올라간 경우만.
    //   모르는 값을 추측해 넣으면 그 순간 오발송이다(떨어진 분께 축하가 나간다).
    build: (params, _values, ctx) => cycleCompare(params, ctx, () => `
            AND EXISTS (
              SELECT 1 FROM customer_grade_ranks ro, customer_grade_ranks rn
               WHERE ro.company_id = c.company_id AND ro.grade_value = s.grade   AND ro.rank_order IS NOT NULL
                 AND rn.company_id = c.company_id AND rn.grade_value = c.grade   AND rn.rank_order IS NOT NULL
                 AND rn.rank_order > ro.rank_order
            )`),
  },
  {
    key: 'first_purchase',
    label: '처음 구매한 고객',
    description: '지난번 발송 때까지 구매가 없다가 그 사이에 첫 구매를 한 고객입니다.',
    params: [],
    needsCycleBaseline: true,
    resolve: (f) => (f.hasPurchaseCount
      ? { available: true, reason: '지난번 이후 첫 구매를 한 고객에게 보냅니다.' }
      : { available: false, reason: '고객의 구매 횟수 정보가 아직 없어요. 구매 이력을 연동하면 열립니다.' }),
    build: (params, _values, ctx) => cycleCompare(params, ctx, () => `
            AND COALESCE(s.purchase_count, 0) = 0
            AND COALESCE(c.purchase_count, 0) >= 1`),
  },
  {
    key: 'returned',
    label: '다시 돌아온 고객',
    description: '지난번 발송 때 이미 오래 조용했던 고객이 그 사이에 다시 구매한 경우입니다.',
    params: [DAYS_PARAM('지난번 기준 조용했던 기간', 90)],
    needsCycleBaseline: true,
    resolve: (f) => (f.hasRecentPurchaseDate
      ? { available: true, reason: '오래 쉬었다가 다시 구매한 고객에게 보냅니다.' }
      : { available: false, reason: '고객의 마지막 구매일 정보가 아직 없어요. 구매 이력을 연동하면 열립니다.' }),
    // 기준 날짜는 **그 스냅샷을 찍은 날**에서 뺀다 — 오늘에서 빼면 회차 간격만큼 창이 밀린다.
    // recent_purchase_date가 KST 날짜라 관측 시각도 KST로 잘라 같은 축에 놓는다.
    build: (params, values, ctx) => cycleCompare(params, ctx, () => {
      params.push(values.days);
      const d = params.length;
      return `
            AND s.recent_purchase_date IS NOT NULL
            AND s.recent_purchase_date <= ((s.observed_at AT TIME ZONE 'Asia/Seoul')::date - $${d}::int)
            AND c.recent_purchase_date IS NOT NULL
            AND c.recent_purchase_date > s.recent_purchase_date`;
    }),
  },
  {
    key: 'went_quiet',
    label: '발길이 끊긴 고객',
    description: '지난번 발송 때는 최근에 구매하던 고객인데 그 뒤로 한 번도 구매가 없어 기준일이 지난 경우입니다.',
    params: [DAYS_PARAM('구매 없이 지난 기간', 60)],
    needsCycleBaseline: true,
    resolve: (f) => (f.hasRecentPurchaseDate
      ? { available: true, reason: '잘 오시다가 발길이 끊긴 고객에게 보냅니다.' }
      : { available: false, reason: '고객의 마지막 구매일 정보가 아직 없어요. 구매 이력을 연동하면 열립니다.' }),
    // ⛔ 휴면 축과 다르다. 휴면은 "지금 오래 안 샀다"(계속 휴면인 사람도 매번 잡힌다)이고
    //   이 축은 "지난번엔 활발했는데 그 뒤로 끊겼다"는 **전환**이다. 그래서 세 조건을 모두 건다 —
    //   ①그 사이 구매 없음(마지막 구매일·횟수 둘 다 그대로) ②지난번엔 기준 안에 있었다 ③지금은 기준을 넘겼다.
    build: (params, values, ctx) => cycleCompare(params, ctx, () => {
      params.push(values.days);
      const d = params.length;
      params.push(kstDateMinusDays(ctx.now, values.days));
      const cutoff = params.length;
      return `
            AND c.recent_purchase_date IS NOT DISTINCT FROM s.recent_purchase_date
            AND COALESCE(c.purchase_count, 0) = COALESCE(s.purchase_count, 0)
            AND s.recent_purchase_date IS NOT NULL
            AND s.recent_purchase_date > ((s.observed_at AT TIME ZONE 'Asia/Seoul')::date - $${d}::int)
            AND c.recent_purchase_date <= $${cutoff}::date`;
    }),
  },
  {
    key: 'spent_more',
    label: '지난번보다 많이 산 고객',
    description: '지난번 발송 이후 구매 금액이 기준만큼 늘어난 고객입니다.',
    params: [AMOUNT_PARAM('늘어난 구매 금액', 100000)],
    needsCycleBaseline: true,
    resolve: (f) => (f.hasPurchaseAmount
      ? { available: true, reason: '지난번 이후 많이 구매해 주신 고객에게 보냅니다.' }
      : { available: false, reason: '고객의 구매 금액 정보가 아직 없어요. 구매 이력을 연동하면 열립니다.' }),
    build: (params, values, ctx) => cycleCompare(params, ctx, () => {
      params.push(values.amount);
      return `
            AND COALESCE(c.total_purchase_amount, 0) - COALESCE(s.total_purchase_amount, 0) >= $${params.length}::numeric`;
    }),
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
    return {
      key: c.key, label: c.label, available: r.available, reason: r.reason, params: c.params,
      needsCycleBaseline: c.needsCycleBaseline === true,
    };
  });
}

/** 이 축이 지난 회차 스냅샷을 필요로 하는가 — 화면 안내·워커 기준선 심기가 이 하나만 본다. */
export function segmentNeedsCycleBaseline(key: string | null | undefined): boolean {
  return getSegmentContract(key)?.needsCycleBaseline === true;
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
