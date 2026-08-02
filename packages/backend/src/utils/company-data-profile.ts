/**
 * CT-58 utils/company-data-profile.ts (D210+ Phase 2 2026-05-23)
 *
 * 목적
 *   회사별 customer 테이블 컬럼 채워짐 비율 동적 분석 → AI 시스템 프롬프트 동적 주입.
 *   어설픈 개인화 사고 차단 (옛 D121 filterVarCatalogByData 영역 = 0건/1+ 이진 판단 → 3단계 분류 강화).
 *
 * 본질 매트릭스
 *   - 70%+ 채워짐 = 안전 변수 (AI 무조건 사용 가능)
 *   - 30~70% 채워짐 = 분기 변수 (Liquid fallback 필수 — {{ var | default: '...' }} 또는 {% if %} 패턴)
 *   - 30% 미만 = 차단 변수 (AI 시스템 프롬프트에서 자동 제외)
 *
 * 영구 룰 정합
 *   - feedback_ai_no_arbitrary_benefit (어설픈 개인화 = 신뢰 파괴 차단)
 *   - 회사 격리 (companyId 검증 의무)
 *   - 1시간 메모리 캐시 (DB 변경 빈도 낮음 — 운영 부하 0)
 *   - cold start (총 0건 회사 = 모든 변수 차단 + 일반 안내만)
 *
 * 사용처
 *   - services/ai.ts generateMessages — userMessage 영역 동적 주입
 *   - services/ai-orchestrator.ts — generateMessages 호출 전 자동 조회
 *   - utils/journey-ai-generator.ts — systemPrompt 동적 주입
 *
 * D210+ Phase 2 (Harold 명시 2026-05-23 본질):
 *   "개인화 부분이 어설프게 실수로 들어가는게 더 안좋다 → 동적으로 회사 DB 업로드 현황을 보고
 *    활용할만한것들을 잘 활용해서 맞춤형 개인화 메세징오퍼레이션"
 */

import { query } from '../config/database';
import { getColumnFields } from './standard-field-map';
// ★ 2026-08-01 여정 재설계 — 신규/기존 판정 능력(순수 CT). 타입·판정 규칙은 그쪽이 소유한다.
import { resolveNewCustomerJudgement, type CompanyIdentityCapability } from './journey-identity-signals';
import type { CompanyJourneyFacts } from './journey-trigger-capability';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 외부 노출 인터페이스
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type FieldCategory = 'safe' | 'conditional' | 'blocked';

export interface FieldProfile {
  field: string;          // customers 테이블 컬럼명 (예: name, grade, region)
  label: string;          // 한글 라벨 (예: 고객명, 등급, 지역)
  liquidVar: string;      // Liquid 변수명 (예: customer.name)
  percentVar: string;     // %변수% 형태 (예: 고객명)
  fillRate: number;       // 0~100 (%)
  filledCount: number;
  totalCount: number;
  category: FieldCategory;
}

export interface CompanyDataProfile {
  companyId: string;
  totalCustomers: number;
  fields: FieldProfile[];
  safeFields: FieldProfile[];        // 70%+ 채워짐 (무조건 사용)
  conditionalFields: FieldProfile[]; // 30~70% 채워짐 (fallback 필수)
  blockedFields: FieldProfile[];     // 30% 미만 (절대 금지)
  analyzedAt: Date;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 분석 대상 필드 매트릭스 (customers 테이블 — 마케팅 개인화 가치 컬럼만)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface FieldDef {
  field: string;
  label: string;
  percentVar: string;
  dataType: 'string' | 'number' | 'date' | 'boolean';
}

// ★ 2026-07-09: 하드코딩 라벨 테이블 폐기 — FIELD_MAP(standard-field-map) 단일 소스에서 파생.
//   label·percentVar = FIELD_MAP displayName → 활용가능컬럼 버튼·AI 프롬프트가 emit하는 %토큰%이 발송 사전 키(displayName)와 정확히 일치.
//   (옛 하드코딩은 '등급'·'등록매장'·'가입매장'·'최근구매액' 등이 displayName '고객등급'·'매장명'·'등록매장정보'·'최근구매금액'과 어긋나 발송 시 빈칸이던 근본 원인.)
//   phone(수신번호)·sms_opt_in(동의 boolean)은 메시지 변수가 아니므로 제외(buildVarCatalogFromFieldMap과 동일 정책).
//   FIELD_MAP에 없던 avg_order_value·ltv_score·wedding_anniversary는 애초에 발송 치환 불가(사전에 없음)라 활용 목록에서 자연 제외 = 잠재 빈칸 버그 동시 제거.
const ANALYZED_FIELDS: FieldDef[] = getColumnFields()
  .filter((f) => f.fieldKey !== 'phone' && f.fieldKey !== 'sms_opt_in')
  .map((f) => ({
    field: f.columnName,
    label: f.displayName,
    percentVar: f.displayName,
    dataType: f.dataType,
  }));

const SAFE_THRESHOLD = 70;        // 70%+ = 안전 변수
const CONDITIONAL_THRESHOLD = 30; // 30~70% = 분기 변수, 미만 = 차단

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 캐시 (1시간 TTL — DB 변경 빈도 낮음)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const cache = new Map<string, { profile: CompanyDataProfile; expiresAt: number }>();
// ★ 2026-06-25: 1시간 → 5분 단축. clearCompanyDataProfileCache 미호출/다중 pm2 프로세스로 캐시 무효화가
//   안 닿아도 staleness 상한을 5분으로 제한(업로드 직후 "고객 없음" 오표시가 최대 1시간 가던 결함 안전망).
const CACHE_TTL_MS = 5 * 60 * 1000; // 5분

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 핵심 분석 함수
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 회사 customer DB 실측 분석 — 컬럼별 채워짐 비율 + 3단계 분류.
 * 옛 D121 filterVarCatalogByData 영역 확장 (이진 판단 → 비율 + 분류).
 */
export async function analyzeCompanyDataProfile(companyId: string): Promise<CompanyDataProfile> {
  if (!companyId) throw new Error('companyId required');

  // SQL 매트릭스 — 컬럼별 COUNT FILTER (데이터 타입별 조건 분리)
  const countFilters = ANALYZED_FIELDS.map((f) => {
    if (f.dataType === 'number') {
      return `COUNT(*) FILTER (WHERE ${f.field} IS NOT NULL AND ${f.field} > 0) AS cnt_${f.field}`;
    }
    if (f.dataType === 'date' || f.dataType === 'boolean') {
      return `COUNT(*) FILTER (WHERE ${f.field} IS NOT NULL) AS cnt_${f.field}`;
    }
    return `COUNT(*) FILTER (WHERE ${f.field} IS NOT NULL AND ${f.field} != '') AS cnt_${f.field}`;
  });

  const sql = `
    SELECT COUNT(*) AS total, ${countFilters.join(', ')}
    FROM customers
    WHERE company_id = $1::uuid AND is_active = true
  `;

  const r = await query(sql, [companyId]);
  const row = r.rows[0] || {};
  const totalCustomers = parseInt(row.total || '0');

  const fields: FieldProfile[] = ANALYZED_FIELDS.map((f) => {
    const filledCount = parseInt(row[`cnt_${f.field}`] || '0');
    const fillRate = totalCustomers > 0 ? Math.round((filledCount / totalCustomers) * 100) : 0;
    let category: FieldCategory;
    if (fillRate >= SAFE_THRESHOLD) category = 'safe';
    else if (fillRate >= CONDITIONAL_THRESHOLD) category = 'conditional';
    else category = 'blocked';

    return {
      field: f.field,
      label: f.label,
      liquidVar: `customer.${f.field}`,
      percentVar: f.percentVar,
      fillRate,
      filledCount,
      totalCount: totalCustomers,
      category,
    };
  });

  return {
    companyId,
    totalCustomers,
    fields,
    safeFields: fields.filter((f) => f.category === 'safe'),
    conditionalFields: fields.filter((f) => f.category === 'conditional'),
    blockedFields: fields.filter((f) => f.category === 'blocked'),
    analyzedAt: new Date(),
  };
}

/**
 * 캐시 통합 조회 (1시간 TTL — 자주 호출되는 영역 정합).
 */
export async function getCompanyDataProfile(companyId: string): Promise<CompanyDataProfile> {
  const cached = cache.get(companyId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.profile;
  }
  const profile = await analyzeCompanyDataProfile(companyId);
  cache.set(companyId, { profile, expiresAt: Date.now() + CACHE_TTL_MS });
  return profile;
}

/**
 * 캐시 무효화 — 회사 customer DB 대량 업로드 직후 호출 의무 (실시간 정확도 의무 시).
 */
export function clearCompanyDataProfileCache(companyId?: string): void {
  if (companyId) cache.delete(companyId);
  else cache.clear();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ★ 2026-08-01 신규/기존 고객 판정 능력 (여정 재설계 §2-3)
//   우리는 정답표를 갖지 않는다 — "이 회사가 준 것으로 신규를 가릴 수 있는가"를 여기서 계산한다.
//   신규 CT를 만들지 않고 이 프로파일의 소비처를 늘린다(설계서 §2-3).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 이 회사가 신규/기존을 가릴 근거를 갖고 있는가 — **발송 적격성 판정이라 전용 조회로 매번 새로 본다.**
 *
 * ⛔ 개인화 프로파일(getCompanyDataProfile)에서 파생시키지 않는다 (2026-08-01 Codex 적대검증 지적, 전량 수용).
 *   1) 그 프로파일은 5분 캐시인데 싱크에이전트 적재 경로가 무효화를 호출하지 않는다.
 *      근거가 false→true로 바뀐 직후 창에서 새 구매 근거가 술어에서 빠지고, 그 방향은 **더 보내는 쪽**이다.
 *   2) 그 프로파일의 충족률은 반올림된 정수(fillRate)라 201명 중 1명 같은 희소 근거가 0으로 떨어진다.
 *      다른 신호가 하나라도 true면 술어는 만들어지므로 **경고도 없이** 그 근거의 기존 고객이 통과한다.
 *   발송 적격성은 문안 변수 선정과 요구 수준이 다르다. 캐시를 공유하면 안 된다.
 *
 * COUNT이 아니라 EXISTS다 — "한 명이라도 있는가"만 알면 되고, 근거가 있는 회사는 첫 행에서 멈춘다.
 * 컬럼 타입은 운영 information_schema 실측(2026-08-01):
 *   purchase_count int · recent_purchase_date date · total_purchase_amount numeric · points int.
 *
 * ⛔ 여기서 보는 신호는 buildExistingCustomerPredicate가 실제로 쓰는 것과 **같아야 한다**.
 *   게이트가 통과시킨 근거를 술어가 안 보면 그 자체가 fail-open이다(Codex 3R 정정).
 *
 * 끈 것과 이유:
 *   - grade: 기본등급이 무엇인지는 회사가 정해줘야 한다. 우리가 지어내면 그게 곧 정답표다(설계서 §2-3).
 *   - signup_date: 표준 필드에 없다. 주는 회사가 생기면 그 회사에서만 켠다.
 */
export async function getCompanyIdentityCapability(companyId: string): Promise<CompanyIdentityCapability> {
  const r = await query(
    `SELECT
       EXISTS (SELECT 1 FROM customers WHERE company_id = $1::uuid AND purchase_count IS NOT NULL AND purchase_count > 0) AS has_purchase_count,
       EXISTS (SELECT 1 FROM customers WHERE company_id = $1::uuid AND recent_purchase_date IS NOT NULL) AS has_recent_purchase_date,
       EXISTS (SELECT 1 FROM customers WHERE company_id = $1::uuid AND last_purchase_date IS NOT NULL AND last_purchase_date <> '') AS has_last_purchase_date,
       EXISTS (SELECT 1 FROM customers WHERE company_id = $1::uuid AND total_purchase_amount IS NOT NULL AND total_purchase_amount > 0) AS has_total_purchase_amount,
       EXISTS (SELECT 1 FROM customers WHERE company_id = $1::uuid AND points IS NOT NULL AND points > 0) AS has_points`,
    [companyId],
  );
  const row = r.rows[0] || {};
  return {
    hasPurchaseCount: row.has_purchase_count === true,
    hasRecentPurchaseDate: row.has_recent_purchase_date === true,
    hasLastPurchaseDate: row.has_last_purchase_date === true,
    hasTotalPurchaseAmount: row.has_total_purchase_amount === true,
    hasPoints: row.has_points === true,
    defaultGrade: null,
    signupDateColumn: null,
  };
}

/**
 * 이 회사가 지금 만들 수 있는 여정을 가르는 사실(facts) — 화면 게이트용 (설계서 §2-3).
 *
 * 캐시하지 않는다. 발송 적격성과 같은 판단이고, 고객사가 방금 연동을 붙인 직후에
 * "아직 안 된다"고 잘못 안내하면 그대로 이탈로 이어진다.
 * 전부 EXISTS라 근거가 있는 회사는 첫 행에서 멈춘다.
 *
 * 사용 컬럼은 모두 운영 SQL이 이미 쓰는 것이다 — customers.birth_month_day·birth_date(생일 추출),
 * cdp_events.event_name(커서·조건 평가). 신규 컬럼 0.
 */
export async function getCompanyJourneyFacts(companyId: string): Promise<CompanyJourneyFacts> {
  const identity = await getCompanyIdentityCapability(companyId);
  const r = await query(
    `SELECT
       EXISTS (SELECT 1 FROM customers WHERE company_id = $1::uuid
                 AND ((birth_month_day IS NOT NULL AND birth_month_day <> '') OR birth_date IS NOT NULL)) AS has_birthday,
       -- ★ 2026-08-01 §11-4: 구매는 문이 둘이다 — 자사몰 이벤트 또는 싱크 원장 중 하나만 있으면 열린다.
       (EXISTS (SELECT 1 FROM cdp_events WHERE company_id = $1::uuid AND event_name = 'purchase')
        OR EXISTS (SELECT 1 FROM purchases WHERE company_id = $1::uuid
                     AND purchase_date IS NOT NULL AND customer_id IS NOT NULL)) AS has_purchase_events,
       EXISTS (SELECT 1 FROM cdp_events WHERE company_id = $1::uuid AND event_name = 'cart_add') AS has_cart_events,
       EXISTS (SELECT 1 FROM cdp_events WHERE company_id = $1::uuid AND event_name = 'product_view') AS has_browse_events,
       EXISTS (SELECT 1 FROM cdp_events WHERE company_id = $1::uuid AND event_name = 'custom_order_shipped') AS has_shipped_events`,
    [companyId],
  );
  const row = r.rows[0] || {};
  return {
    canJudgeNewCustomer: resolveNewCustomerJudgement(identity).canJudge,
    hasRecentPurchaseDate: identity.hasRecentPurchaseDate === true,
    hasPoints: identity.hasPoints === true,
    hasBirthday: row.has_birthday === true,
    hasPurchaseEvents: row.has_purchase_events === true,
    hasCartEvents: row.has_cart_events === true,
    hasBrowseEvents: row.has_browse_events === true,
    hasShippedEvents: row.has_shipped_events === true,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AI 시스템 프롬프트 변환
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * AI 시스템 프롬프트 안 동적 주입 영역 텍스트 변환.
 * journey-ai-generator + ai-orchestrator generateMessages 양쪽 사용.
 *
 * 출력 매트릭스 — 안전/분기/차단 3단계 명시 + 실측 채워짐 비율 명시.
 */
export function formatProfileForAiPrompt(
  profile: CompanyDataProfile,
  opts?: {
    /**
     * ★ 2026-07-06 변수 세계 분리 — 결과물이 Liquid를 렌더하는 경로인지에 따라 지시가 달라야 한다.
     *   'liquid'(기본값 — 여정·인앱): 현행 그대로. Liquid 분기 fallback 지시 유지.
     *   'percent'(캠페인·오퍼레이터 generateMessages): %변수% 세계 — Liquid 문법({{ }}·{% %}) 지시·예시 전면 제거.
     *   기원: 오퍼레이터 메인 생성물에 {% if customer.churn_risk > 0.7 %} 노출(psy5868, 2026-07-06) —
     *   %변수% 세계에 "분기 변수 = Liquid 패턴 의무" 지시가 그대로 주입되던 결선 오류.
     */
    variableStyle?: 'liquid' | 'percent';
  },
): string {
  const style = opts?.variableStyle || 'liquid';

  if (profile.totalCustomers === 0) {
    return `[★ ★ ★ 회사 실측 데이터 매트릭스 — 절대 준수 ★ ★ ★]
- 현재 회사 customer DB = 0건 (cold start)
- 개인화 변수 절대 사용 금지 (${style === 'liquid' ? "Liquid {{ customer.X }} 또는 %변수%" : '%변수% 형태'} 어디에도 사용 X)
- 모두에게 동일한 일반 안내 본문만 작성 의무
`;
  }

  const formatSafeField = (f: FieldProfile) =>
    style === 'liquid'
      ? `  - {{ customer.${f.field} }} 또는 %${f.percentVar}% (${f.label}, ${f.fillRate}% 채워짐)`
      : `  - %${f.percentVar}% (${f.label}, ${f.fillRate}% 채워짐)`;
  const formatConditionalField = (f: FieldProfile) =>
    style === 'liquid'
      ? `  - {{ customer.${f.field} }} 또는 %${f.percentVar}% (${f.label}, ${f.fillRate}% 채워짐)`
      : `  - %${f.percentVar}% (${f.label}, ${f.fillRate}% 채워짐 — 값이 비어 있는 고객 존재)`;
  const formatBlockedField = (f: FieldProfile) =>
    `  - ${f.label} (${f.fillRate}% 채워짐 — 데이터 부족)`;

  // ★ D210+ Phase 2-fix3 (Harold 명시 2026-05-23): 안전 변수 사용 의무 강화.
  //   옛 사고 영역 = AI 응답 본문 안 변수 활용 X 사고 (Harold 검증 발견).
  //   원인 = "무조건 사용 가능" 영역만 안내 → AI가 "사용 가능" vs "사용 의무" 영역 X 인지 사고.
  //   본 fix = "1~3개 자연 활용 의무 + 구체 예시 + 변수 0건 사고 차단" 명령 강화.
  const safeExamples = profile.safeFields.slice(0, 3).map((f) => `"%${f.percentVar}%"`).join(' / ');

  return `[★ ★ ★ 회사 실측 데이터 활용 매트릭스 — 절대 준수 ★ ★ ★]
회사 customer DB 총 ${profile.totalCustomers.toLocaleString()}건 분석 결과.
아래 매트릭스 외 변수 임의 작성 시 발송 시점 자동 차단됩니다.

[★ ★ ★ 안전 변수 — 본문 안 1~3개 자연 활용 의무 ★ ★ ★]
※ 아래 변수는 회사 customer DB 70% 이상 채워짐 = 발송 시점 100% 안전.
※ AI 응답 본문(message_text) 안 = 본 매트릭스 안 1~3개 변수 자연 활용 의무.
※ 활용 예시: "${safeExamples || '%고객명%'}님 안녕하세요" / "%고객명%님, %고객등급% 회원 전용 안내드려요" / "오랜만이에요 %고객명%님".
※ ⚠️ 변수 활용 0건 응답 절대 금지 — 일반 안내만 작성 시 사고. 반드시 위 안전 변수에서 1~3개 본문 안에 자연스럽게 포함.
※ ⚠️ 3개 안(A/B/C) 모두 동일 안전 변수 자연 활용 의무 (한 안만 변수 활용 + 나머지 일반 안내 금지).

${profile.safeFields.length > 0 ? profile.safeFields.map(formatSafeField).join('\n') : '  (해당 영역 없음 — 안전 변수가 없으므로 변수 사용 신중)'}

${style === 'liquid'
  ? `[분기 변수 — Liquid fallback 의무 (30~70% 채워짐)]
${profile.conditionalFields.length > 0
    ? profile.conditionalFields.map(formatConditionalField).join('\n') +
      `\n  → 사용 시 다음 패턴 의무:\n` +
      `     {{ customer.X | default: '고객' }}   (값 없으면 자동 대체)\n` +
      `     {% if customer.X %}...{% else %}...{% endif %}   (조건 분기)`
    : '  (해당 영역 없음)'}`
  : `[주의 변수 — 값이 비어 있을 수 있음 (30~70% 채워짐)]
${profile.conditionalFields.length > 0
    ? profile.conditionalFields.map(formatConditionalField).join('\n') +
      `\n  → 이 변수들은 값이 없는 고객이 있으므로, 확신이 없으면 위 안전 변수만 사용하세요.\n` +
      `  → 사용한다면 값이 비어도 문장이 자연스럽게 읽히도록 구성하세요.`
    : '  (해당 영역 없음)'}
※ ⚠️ 이 문안 형식에서는 Liquid 등 템플릿 문법(중괄호 표기·조건 분기 태그) 절대 사용 금지 — 개인화는 %변수% 형태만 허용됩니다.`}

[차단 변수 — 절대 사용 금지 (30% 미만 채워짐 — 데이터 부족)]
${profile.blockedFields.length > 0 ? profile.blockedFields.map(formatBlockedField).join('\n') : '  (해당 영역 없음)'}
`;
}
