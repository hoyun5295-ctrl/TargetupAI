/**
 * journey-identity-signals.ts — "이 사람이 이 회사의 신규 고객인가" 판정 컨트롤타워 (2026-08-01)
 *   DB import 0 — 순수. SQL 조각과 판정 결과만 만든다.
 *
 * 왜 있나
 *   현재 코드는 "우리 DB에 언제 나타났나"를 "언제 고객이 됐나"로 쓴다.
 *   이 둘은 **이관이 끼는 순간 갈라진다**. 그리고 이관은 예외가 아니라 모든 고객사의 첫 단계다.
 *   자사몰로 먼저 등록된 고객(매장코드 없음)을 싱크가 매장코드와 함께 올리면
 *   customers upsert 키 (company_id, COALESCE(store_code,'__NONE__'), phone)가 충돌하지 않아
 *   **새 행이 생기고 진입 원장에 없으니 신규가 된다** — 10년 단골에게 환영 문자가 나간다.
 *
 * ⛔ 우리는 정답표를 갖지 않는다 (설계서 §2-3)
 *   고객사마다 여는 범위가 다르다. "이 판정은 이 필드 여섯 개를 요구한다"고 못 박을 수 없다.
 *   **그 회사가 준 것 안에서 쓸 수 있는 근거를 골라 쓴다.** 하나도 없으면 판정 불가라고 말하고 잠근다.
 *   억지 폴백("명단에 없으니 신규")이 곧 사고다.
 *
 * 컬럼 근거 — 전부 운영 코드가 이미 쓰는 컬럼이라 신규 컬럼 0:
 *   customers.purchase_count·total_purchase_amount(applyCustomerConditions 허용 필드)
 *   customers.recent_purchase_date(휴면 추출)·points(포인트 추출)·grade(등급 분포 집계)
 *   customers.last_purchase_date(customer-upsert·cdp-orders 갱신, text)
 *   purchases(company_id·customer_id — customer-purchase-aggregates 집계 원장)
 *
 * NULL 의미론
 *   부정 신호는 전부 COALESCE로 감싸 절대 NULL을 돌려주지 않는다.
 *   `NOT (신호)`가 NULL이 되면 그 행이 통째로 걸러져 **신규가 0건이 된다**(반대 방향 사고).
 */
import { NO_JOINED_AT_REASON } from './customer-joined-at';   // ★ 2026-11-02 가입 근거 CT(CT-J6)

/** 판정 근거 종류. exact > strong > weak 순으로 신뢰도가 낮아진다. */
export type IdentitySignalKey =
  | 'signup_date'
  | 'purchase_count'
  | 'recent_purchase_date'
  | 'last_purchase_date'
  | 'total_purchase_amount'
  | 'points'
  | 'grade';

export type SignalStrength = 'exact' | 'strong' | 'weak';

export const SIGNAL_LABELS: Record<IdentitySignalKey, string> = {
  signup_date: '가입일',
  purchase_count: '구매 횟수',
  recent_purchase_date: '최근 구매일',
  last_purchase_date: '마지막 구매일',
  total_purchase_amount: '총 구매액',
  points: '보유 포인트',
  grade: '등급',
};

export const SIGNAL_STRENGTH: Record<IdentitySignalKey, SignalStrength> = {
  signup_date: 'exact',
  purchase_count: 'strong',
  recent_purchase_date: 'strong',
  last_purchase_date: 'strong',
  total_purchase_amount: 'strong',
  points: 'weak',
  grade: 'weak',
};

/**
 * 그 회사가 실제로 쓸 수 있는 근거 — **게이트 판정 전용**(어떤 술어를 만들지에는 쓰지 않는다).
 * 호출부(company-data-profile)가 채운다. 여기서 기본값을 지어내지 않는다 — 모르면 false다.
 *
 * ⛔ 이 목록은 buildExistingCustomerPredicate가 실제로 보는 신호와 **같아야 한다**.
 *   게이트가 통과시킨 근거를 술어가 안 보면 그 자체가 fail-open이다(Codex 3R 정정).
 */
export interface CompanyIdentityCapability {
  /**
   * 고객사가 가입일을 주는 경우의 customers 컬럼명. 표준 필드에는 없으므로 **주는 회사만** 해당.
   * 화이트리스트 검증을 통과한 이름만 쓴다(주입 차단).
   */
  signupDateColumn?: string | null;
  hasPurchaseCount?: boolean;
  hasRecentPurchaseDate?: boolean;
  hasLastPurchaseDate?: boolean;
  hasTotalPurchaseAmount?: boolean;
  hasPoints?: boolean;
  /** 회사가 "기본등급"을 설정한 경우에만 등급을 근거로 쓴다. 미설정이면 등급 신호는 안 쓴다. */
  defaultGrade?: string | null;
}

/** SQL 식별자 안전 문자만 — alias·컬럼명 주입 차단 (channel-eligibility와 동일 정책). */
const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** 가입일로 쓸 수 있는 컬럼 화이트리스트. 이 목록 밖 이름은 무시한다(조용히 안 쓴다 = 안전 방향). */
const ALLOWED_SIGNUP_COLUMNS = new Set(['signup_date', 'joined_at', 'registered_at', 'member_since']);

function assertAlias(alias: string): string {
  if (!SAFE_IDENT.test(alias)) throw new Error(`안전하지 않은 테이블 alias: ${alias}`);
  return alias;
}

/** 이 회사에서 실제로 쓸 수 있는 근거 목록 — 신뢰도 순. */
export function availableSignals(cap: CompanyIdentityCapability): IdentitySignalKey[] {
  const c = cap || {};
  const out: IdentitySignalKey[] = [];
  const signupCol = String(c.signupDateColumn || '').trim();
  if (signupCol && SAFE_IDENT.test(signupCol) && ALLOWED_SIGNUP_COLUMNS.has(signupCol)) out.push('signup_date');
  if (c.hasPurchaseCount) out.push('purchase_count');
  if (c.hasRecentPurchaseDate) out.push('recent_purchase_date');
  if (c.hasLastPurchaseDate) out.push('last_purchase_date');
  if (c.hasTotalPurchaseAmount) out.push('total_purchase_amount');
  if (c.hasPoints) out.push('points');
  if (String(c.defaultGrade ?? '').trim()) out.push('grade');
  return out;
}

export interface NewCustomerJudgement {
  /** 이 회사에서 신규/기존을 가를 수 있는가. false면 신규가입 계열 여정을 잠근다. */
  canJudge: boolean;
  /** 실제로 쓰는 근거(신뢰도 순). */
  basis: IdentitySignalKey[];
  /** 가장 높은 근거의 신뢰도. 근거가 없으면 null. */
  strength: SignalStrength | null;
  /** 화면에 그대로 보여줄 한 줄. 못 하면 무엇을 더 주면 되는지. */
  reason: string;
}

/**
 * 이 회사에서 신규 판정이 되는가 — 판정 결과와 사유를 함께 돌려준다.
 * 못 하면 "명단에 없으니 신규"로 폴백하지 않는다. 그건 10년 단골에게 환영 문자를 보내는 길이다.
 */
export function resolveNewCustomerJudgement(cap: CompanyIdentityCapability): NewCustomerJudgement {
  // ★ 2026-11-02 설계서 3-6(D19) — 근거 = 가입 사실(가입일)만. 구매 · 포인트 · 등급은 「기존 근거」로 쓰지 않는다(가입 포인트 · 첫 구매가 같이 온 진짜 신규가 빠졌다).
  const basis = availableSignals(cap).filter((k) => k === 'signup_date');
  if (basis.length === 0) {
    return { canJudge: false, basis: [], strength: null, reason: NO_JOINED_AT_REASON };
  }
  const strength = SIGNAL_STRENGTH[basis[0]];
  const labels = basis.map((k) => SIGNAL_LABELS[k]).join('·');
  return {
    canJudge: true,
    basis,
    strength,
    reason: `${labels}로 기존 고객을 가려냅니다.`,
  };
}

// ★ 2026-11-02 설계서 3-6(D19) — 「전에도 고객이었다」 술어(구매 · 포인트 · 등급) · 가입일 술어를 지웠다: 신규 판정 = 가입 근거 한 곳(customer-joined-at newSignupSql).
