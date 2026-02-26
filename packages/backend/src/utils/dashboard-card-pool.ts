/**
 * utils/dashboard-card-pool.ts
 * ============================
 * 대시보드 동적 카드 풀 정의 (D41)
 *
 * FIELD_MAP 필수 17개 기반 카드 17종.
 * 슈퍼관리자가 고객사별로 4개 또는 8개를 선택.
 * 
 * 이 파일은 companies.ts + admin.ts에서 import.
 */

// ─── 타입 정의 ───

export type CardType = 'count' | 'rate' | 'sum' | 'distribution';

export interface DashboardCardDef {
  cardId: string;
  label: string;
  type: CardType;
  icon: string;        // lucide-react 아이콘명
  description: string; // 슈퍼관리자 설정 UI 설명
}

// ─── 카드 풀 — 17종 ───

export const DASHBOARD_CARD_POOL: DashboardCardDef[] = [
  { cardId: 'total_customers',     label: '전체 고객 수',      type: 'count',        icon: 'Users',        description: '전체 등록 고객 수' },
  { cardId: 'gender_male',         label: '남성 수',           type: 'count',        icon: 'User',         description: '성별이 남성인 고객 수' },
  { cardId: 'gender_female',       label: '여성 수',           type: 'count',        icon: 'User',         description: '성별이 여성인 고객 수' },
  { cardId: 'birthday_this_month', label: '이번달 생일 고객',  type: 'count',        icon: 'Cake',         description: '이번 달 생일인 고객 수' },
  { cardId: 'age_distribution',    label: '연령대별 분포',     type: 'distribution', icon: 'BarChart3',    description: '연령대별 고객 분포' },
  { cardId: 'grade_distribution',  label: '등급별 고객 수',    type: 'distribution', icon: 'Award',        description: '고객 등급별 분포' },
  { cardId: 'region_top',          label: '지역별 TOP',        type: 'distribution', icon: 'MapPin',       description: '지역별 고객 수 상위' },
  { cardId: 'store_distribution',  label: '매장별 고객 수',    type: 'distribution', icon: 'Store',        description: '매장별 고객 분포' },
  { cardId: 'email_rate',          label: '이메일 보유율',     type: 'rate',         icon: 'Mail',         description: '이메일 주소 보유 비율 (%)' },
  { cardId: 'total_purchase_sum',  label: '총 구매금액',       type: 'sum',          icon: 'DollarSign',   description: '전체 고객 누적 구매금액 합계' },
  { cardId: 'recent_30d_purchase', label: '30일 내 구매',      type: 'count',        icon: 'ShoppingCart', description: '최근 30일 내 구매 이력이 있는 고객 수' },
  { cardId: 'inactive_90d',        label: '90일+ 미구매',      type: 'count',        icon: 'UserX',        description: '최근 90일간 구매 이력이 없는 고객 수' },
  { cardId: 'new_this_month',      label: '신규고객 (이번달)', type: 'count',        icon: 'UserPlus',     description: '이번 달 신규 등록된 고객 수' },
  { cardId: 'opt_out_count',       label: '수신거부 수',       type: 'count',        icon: 'BellOff',      description: '수신거부 등록 건수' },
  { cardId: 'opt_in_count',        label: '수신동의 수',       type: 'count',        icon: 'Bell',         description: 'SMS 수신동의 고객 수' },
  { cardId: 'active_campaigns',    label: '진행 캠페인 수',    type: 'count',        icon: 'Send',         description: '현재 진행 중인 캠페인 수' },
  { cardId: 'monthly_spend',       label: '이번달 사용금액',   type: 'sum',          icon: 'CreditCard',   description: '이번 달 발송 사용 금액' },
];

// ─── 헬퍼 ───

/** 유효한 cardId Set */
export const VALID_CARD_IDS = new Set(DASHBOARD_CARD_POOL.map(c => c.cardId));

/** cardId로 카드 정의 조회 */
export function getCardDef(cardId: string): DashboardCardDef | undefined {
  return DASHBOARD_CARD_POOL.find(c => c.cardId === cardId);
}

/** 카드 ID 배열 유효성 검증 */
export function validateCardIds(cardIds: string[]): { valid: boolean; invalid: string[] } {
  const invalid = cardIds.filter(id => !VALID_CARD_IDS.has(id));
  return { valid: invalid.length === 0, invalid };
}
