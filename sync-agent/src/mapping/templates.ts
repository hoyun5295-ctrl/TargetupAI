/**
 * POS/ERP 시스템별 기본 매핑 템플릿
 * 고객사 설치 시 AI 자동 매핑의 시드 데이터로 활용
 *
 * 변경사항 (v1.4.0 — 2026-03-07):
 *   - store_phone, registration_type, registered_store, recent_purchase_store 패턴 추가
 *   - custom_1~custom_15 슬롯 자동 배정 함수(assignCustomFieldSlots) 추가
 *
 * 변경사항 (2026-02-24):
 *   - MBR_ 접두사 패턴 추가 (MBR_HP, MBR_NM 등)
 *   - LST_ 접두사 패턴 추가 (LST_BUY_DT, LST_BUY_AMT 등)
 *   - GRD_CD, AGE_VAL, MARRY_YN, SMS_RCV_YN, BLK_YN, USE_YN 등 추가
 *   - AVG_ORD_VAL, REG_STORE_CD, ORD_DT 패턴 추가
 *   - 135줄 구문 에러 수정 ({ { → {)
 *
 * 변경사항 (2026-02-11):
 *   - autoSuggestMapping() 추가: 키워드 기반 컬럼 자동 매핑 추천
 *   - 복합 패턴(STORE_NM, PROD_NM) 우선 → 단순 패턴(NM) 후순위
 *   - STORE_NM → store_name 정확히 잡히도록 수정
 */

import type { ColumnMapping } from './index';

export interface MappingTemplate {
  name: string;
  description: string;
  customers: ColumnMapping;
  purchases: ColumnMapping;
}

/**
 * 알려진 POS/ERP 시스템의 기본 매핑 템플릿
 */
export const MAPPING_TEMPLATES: MappingTemplate[] = [
  {
    name: 'generic_korean_pos',
    description: '일반적인 한국 POS 시스템',
    customers: {
      'CUST_HP': 'phone',
      'CUST_NM': 'name',
      'SEX_CD': 'gender',
      'BIRTH_DT': 'birth_date',
      'GRADE_CD': 'grade',
      'ADDR': 'address',
      'REGION': 'region',
      'SMS_YN': 'sms_opt_in',
      'EMAIL': 'email',
      'POINT': 'points',
      'STORE_CD': 'store_code',
      'STORE_NM': 'store_name',
      'REG_STORE': 'registered_store',
      'REG_DT': 'registration_type',
      'LAST_BUY_DT': 'recent_purchase_date',
      'LAST_BUY_AMT': 'recent_purchase_amount',
      'TOT_BUY_AMT': 'total_purchase_amount',
      'BUY_CNT': 'purchase_count',
    },
    purchases: {
      'CUST_HP': 'customer_phone',
      'BUY_DT': 'purchase_date',
      'STORE_CD': 'store_code',
      'STORE_NM': 'store_name',
      'PROD_CD': 'product_code',
      'PROD_NM': 'product_name',
      'QTY': 'quantity',
      'UNIT_PRC': 'unit_price',
      'TOT_AMT': 'total_amount',
    },
  },
  {
    name: 'generic_erp',
    description: '일반적인 ERP 고객관리',
    customers: {
      'PHONE': 'phone',
      'PHONE_NO': 'phone',
      'NAME': 'name',
      'CUSTOMER_NAME': 'name',
      'GENDER': 'gender',
      'BIRTHDAY': 'birth_date',
      'BIRTH': 'birth_date',
      'GRADE': 'grade',
      'ADDRESS': 'address',
      'REGION': 'region',
      'EMAIL': 'email',
      'POINT': 'points',
      'POINTS': 'points',
    },
    purchases: {
      'PHONE': 'customer_phone',
      'PHONE_NO': 'customer_phone',
      'PURCHASE_DATE': 'purchase_date',
      'ORDER_DATE': 'purchase_date',
      'PRODUCT_CODE': 'product_code',
      'PRODUCT_NAME': 'product_name',
      'QTY': 'quantity',
      'QUANTITY': 'quantity',
      'PRICE': 'unit_price',
      'AMOUNT': 'total_amount',
      'TOTAL': 'total_amount',
    },
  },
];

// ─── 키워드 기반 자동 매핑 규칙 ─────────────────────────

/**
 * 자동 매핑 규칙 정의
 *
 * ⚠️ 중요: 규칙은 위에서부터 순서대로 평가됨
 *          복합 패턴(STORE_NM)을 단순 패턴(NM)보다 위에 배치!
 *
 * priority: 높을수록 우선 (같은 컬럼에 여러 규칙이 매칭될 때)
 * patterns: 대소문자 무시 매칭, 컬럼명에 포함되면 매칭
 * exact: true면 정확히 일치해야 함
 */
interface MappingRule {
  targetField: string;
  patterns: string[];
  exact?: boolean;      // 정확 일치만 (기본 false = 부분 일치)
  priority: number;     // 높을수록 우선
}

const CUSTOMER_RULES: MappingRule[] = [
  // ── 최우선: 복합 패턴 (구체적인 것부터) ──
  { targetField: 'store_name',             patterns: ['STORE_NM', 'STORE_NAME', 'SHOP_NM', 'SHOP_NAME', 'BRANCH_NM'], priority: 100 },
  { targetField: 'store_code',             patterns: ['STORE_CD', 'STORE_CODE', 'SHOP_CD', 'SHOP_CODE', 'BRANCH_CD', 'BR_CD'], priority: 120 },
  { targetField: 'store_phone',            patterns: ['STORE_TEL', 'SHOP_TEL', 'STORE_PHONE', 'SHOP_PHONE', 'BRANCH_TEL'], priority: 100 },
  { targetField: 'registered_store',       patterns: ['REG_STORE', 'JOIN_STORE', 'REGIST_STORE'], priority: 100 },
  { targetField: 'registered_store_number',patterns: ['REG_STORE_NO', 'REG_STORE_CD', 'JOIN_STORE_NO'], priority: 100 },
  { targetField: 'recent_purchase_date',   patterns: ['LAST_BUY_DT', 'LST_BUY_DT', 'LAST_PURCHASE_DT', 'RECENT_BUY_DT', 'LAST_BUY_DATE'], priority: 100 },
  { targetField: 'recent_purchase_amount', patterns: ['LAST_BUY_AMT', 'LST_BUY_AMT', 'LAST_PURCHASE_AMT', 'RECENT_BUY_AMT'], priority: 100 },
  { targetField: 'recent_purchase_store',  patterns: ['LAST_BUY_STORE', 'LST_BUY_STORE', 'LAST_PURCHASE_STORE', 'RCT_STORE', 'RECENT_STORE'], priority: 100 },
  { targetField: 'total_purchase_amount',  patterns: ['TOT_BUY_AMT', 'TOT_BUY_AMT2', 'TOTAL_BUY_AMT', 'TOT_PURCHASE_AMT', 'TOTAL_PURCHASE'], priority: 100 },
  { targetField: 'purchase_count',         patterns: ['BUY_CNT', 'PURCHASE_CNT', 'BUY_COUNT', 'ORDER_CNT'], priority: 100 },
  { targetField: 'avg_order_value',        patterns: ['AVG_BUY_AMT', 'AVG_ORD_VAL', 'AVG_ORDER', 'AVG_PURCHASE', 'AVG_ORDER_AMT'], priority: 100 },
  { targetField: 'birth_date',             patterns: ['BIRTH_DT', 'BIRTH_DATE', 'BIRTHDAY', 'BIRTH_DAY'], priority: 90 },
  { targetField: 'birth_year',             patterns: ['BIRTH_YR', 'BIRTH_YEAR', 'BYEAR'], priority: 90 },
  { targetField: 'birth_month_day',        patterns: ['BIRTH_MD', 'BIRTH_MMDD'], priority: 90 },
  { targetField: 'wedding_anniversary',    patterns: ['WEDDING_DT', 'WEDDING_DATE', 'ANNIVERSARY'], priority: 90 },
  { targetField: 'sms_opt_in',             patterns: ['SMS_YN', 'SMS_RCV_YN', 'SMS_OPT', 'SMS_AGREE', 'MKT_AGREE', 'RECV_YN'], priority: 90 },
  { targetField: 'is_opt_out',             patterns: ['OPT_OUT', 'REJECT_YN', 'DENY_YN', 'BLOCK_YN', 'BLK_YN'], priority: 90 },
  { targetField: 'registration_type',      patterns: ['REG_TYPE', 'JOIN_TYPE', 'REG_GB', 'REG_DT'], priority: 80 },

  // ── 중간: 일반 패턴 ──
  { targetField: 'phone',    patterns: ['CUST_HP', 'MBR_HP', 'CUST_TEL', 'CUST_PHONE', 'PHONE_NO', 'HP_NO', 'MOBILE', 'CELLPHONE', 'CALLBACK_NO'], priority: 80 },
  { targetField: 'phone',    patterns: ['PHONE', 'HP', 'TEL', 'MOBILE_NO'], exact: true, priority: 70 },
  { targetField: 'name',     patterns: ['CUST_NM', 'MBR_NM', 'CUST_NAME', 'CUSTOMER_NM', 'CUSTOMER_NAME', 'MEMBER_NM'], priority: 80 },
  { targetField: 'gender',   patterns: ['SEX_CD', 'SEX_CODE', 'GENDER_CD', 'GENDER_CODE'], priority: 80 },
  { targetField: 'gender',   patterns: ['SEX', 'GENDER'], exact: true, priority: 70 },
  { targetField: 'grade',    patterns: ['GRADE_CD', 'GRD_CD', 'GRADE_CODE', 'MEMBER_GRADE', 'VIP_CD', 'LEVEL_CD'], priority: 80 },
  { targetField: 'grade',    patterns: ['GRADE', 'LEVEL', 'RANK'], exact: true, priority: 70 },
  { targetField: 'email',    patterns: ['EMAIL', 'E_MAIL', 'MAIL'], priority: 70 },
  { targetField: 'address',  patterns: ['ADDR', 'ADDRESS', 'FULL_ADDR'], priority: 70 },
  { targetField: 'region',   patterns: ['REGION', 'AREA', 'CITY', 'SIDO'], priority: 70 },
  { targetField: 'points',   patterns: ['POINT', 'POINTS', 'MILEAGE', 'BONUS'], priority: 70 },
  { targetField: 'age',      patterns: ['AGE', 'AGE_VAL'], exact: true, priority: 70 },
  { targetField: 'is_married', patterns: ['MARRIED', 'MARRIAGE', 'IS_MARRIED', 'MARRY_YN'], priority: 70 },
  { targetField: 'is_active', patterns: ['IS_ACTIVE', 'ACTIVE_YN', 'USE_YN', 'STATUS'], priority: 60 },
  { targetField: 'ltv_score', patterns: ['LTV', 'LTV_SCORE', 'LIFETIME_VALUE'], priority: 60 },

  // ── 최하위: 단순 패턴 (위에서 안 잡힌 것만) ──
  { targetField: 'name',     patterns: ['NM', 'NAME'], exact: true, priority: 10 },
  { targetField: 'birth_date', patterns: ['BIRTH'], exact: true, priority: 10 },
];

const PURCHASE_RULES: MappingRule[] = [
  // ── 최우선: 복합 패턴 ──
  { targetField: 'store_name',    patterns: ['STORE_NM', 'STORE_NAME', 'SHOP_NM', 'SHOP_NAME'], priority: 100 },
  { targetField: 'store_code',    patterns: ['STORE_CD', 'STORE_CODE', 'SHOP_CD', 'SHOP_CODE'], priority: 100 },
  { targetField: 'product_name',  patterns: ['PROD_NM', 'PROD_NAME', 'PRODUCT_NM', 'PRODUCT_NAME', 'ITEM_NM', 'ITEM_NAME'], priority: 100 },
  { targetField: 'product_code',  patterns: ['PROD_CD', 'PROD_CODE', 'PRODUCT_CD', 'PRODUCT_CODE', 'ITEM_CD', 'ITEM_CODE'], priority: 100 },
  { targetField: 'customer_phone', patterns: ['CUST_HP', 'MBR_HP', 'MBR_PHONE', 'CUST_TEL', 'CUST_PHONE', 'BUYER_HP', 'BUYER_PHONE', 'CALLBACK_NO'], priority: 100 },
  { targetField: 'customer_phone', patterns: ['PHONE', 'HP', 'TEL', 'MOBILE'], exact: true, priority: 80 },
  { targetField: 'purchase_date', patterns: ['BUY_DT', 'BUY_DATE', 'PURCHASE_DT', 'PURCHASE_DATE', 'ORDER_DT', 'ORD_DT', 'ORDER_DATE', 'SALE_DT'], priority: 100 },
  { targetField: 'total_amount',  patterns: ['TOT_AMT', 'TOTAL_AMT', 'TOTAL_AMOUNT', 'SALE_AMT', 'PAY_AMT'], priority: 100 },
  { targetField: 'unit_price',    patterns: ['UNIT_PRC', 'UNIT_PRICE', 'PRICE', 'SELL_PRC'], priority: 90 },
  { targetField: 'quantity',      patterns: ['QTY', 'QUANTITY', 'EA', 'CNT'], priority: 90 },
];

// ─── 자동 매핑 추천 함수 ────────────────────────────────

export interface AutoMappingSuggestion {
  /** 소스 컬럼 → 추천 타겟 필드 */
  mapping: ColumnMapping;
  /** 매핑 성공한 컬럼 수 */
  matchedCount: number;
  /** 매핑 안 된 컬럼 목록 */
  unmapped: string[];
  /** 각 매핑의 신뢰도 (debug용) */
  details: Array<{
    sourceColumn: string;
    targetField: string;
    matchedPattern: string;
    priority: number;
  }>;
}

/**
 * 소스 DB 컬럼명을 분석하여 표준 필드 매핑을 자동 추천합니다.
 *
 * 규칙:
 *   1. 복합 패턴(STORE_NM → store_name)을 먼저 체크 (priority 높음)
 *   2. 단순 패턴(NM → name)은 나중에 체크 (priority 낮음)
 *   3. 하나의 타겟 필드에 여러 소스가 매칭되면 priority 높은 것 우선
 *   4. 하나의 소스 컬럼은 하나의 타겟에만 매핑
 */
export function autoSuggestMapping(
  sourceColumns: string[],
  target: 'customers' | 'purchases',
): AutoMappingSuggestion {
  const rules = target === 'customers' ? CUSTOMER_RULES : PURCHASE_RULES;

  // 각 소스 컬럼에 대한 최적 매핑 후보 수집
  const candidates: Array<{
    sourceColumn: string;
    targetField: string;
    matchedPattern: string;
    priority: number;
  }> = [];

  for (const col of sourceColumns) {
    const colUpper = col.toUpperCase();
    let bestMatch: typeof candidates[0] | null = null;

    for (const rule of rules) {
      for (const pattern of rule.patterns) {
        const patternUpper = pattern.toUpperCase();
        let matched = false;

        if (rule.exact) {
          // 정확 일치
          matched = colUpper === patternUpper;
        } else {
          // 정확 일치 먼저 체크 (보너스), 없으면 부분 일치
          if (colUpper === patternUpper) {
            matched = true;
          } else if (colUpper.includes(patternUpper) || patternUpper.includes(colUpper)) {
            matched = true;
          }
        }

        if (matched) {
          // 정확 일치에 보너스 점수
          const exactBonus = colUpper === patternUpper ? 50 : 0;
          const effectivePriority = rule.priority + exactBonus;

          if (!bestMatch || effectivePriority > bestMatch.priority) {
            bestMatch = {
              sourceColumn: col,
              targetField: rule.targetField,
              matchedPattern: pattern,
              priority: effectivePriority,
            };
          }
        }
      }
    }

    if (bestMatch) {
      candidates.push(bestMatch);
    }
  }

  // 타겟 필드 중복 해결: 같은 타겟에 여러 소스가 매칭되면 priority 높은 것만
  const targetMap = new Map<string, typeof candidates[0]>();
  // priority 높은 것부터 처리
  candidates.sort((a, b) => b.priority - a.priority);

  const usedSources = new Set<string>();
  const finalDetails: typeof candidates = [];

  for (const candidate of candidates) {
    // 이미 이 소스 컬럼이 다른 타겟에 할당됐으면 스킵
    if (usedSources.has(candidate.sourceColumn)) continue;
    // 이미 이 타겟 필드에 다른 소스가 할당됐으면 스킵
    if (targetMap.has(candidate.targetField)) continue;

    targetMap.set(candidate.targetField, candidate);
    usedSources.add(candidate.sourceColumn);
    finalDetails.push(candidate);
  }

  // 결과 조합
  const mapping: ColumnMapping = {};
  for (const detail of finalDetails) {
    mapping[detail.sourceColumn] = detail.targetField;
  }

  const unmapped = sourceColumns.filter((col) => !usedSources.has(col));

  return {
    mapping,
    matchedCount: finalDetails.length,
    unmapped,
    details: finalDetails,
  };
}

/**
 * 소스 컬럼명을 기반으로 가장 적합한 매핑 템플릿을 추천합니다.
 * @returns 매칭률이 가장 높은 템플릿 (없으면 null)
 */
export function suggestTemplate(
  sourceColumns: string[],
  target: 'customers' | 'purchases',
): { template: MappingTemplate; matchRate: number } | null {
  const sourceSet = new Set(sourceColumns.map((c) => c.toUpperCase()));
  let bestMatch: { template: MappingTemplate; matchRate: number } | null = null;

  for (const template of MAPPING_TEMPLATES) {
    const mapping = target === 'customers' ? template.customers : template.purchases;
    const templateColumns = Object.keys(mapping).map((c) => c.toUpperCase());

    const matched = templateColumns.filter((c) => sourceSet.has(c));
    const matchRate = templateColumns.length > 0
      ? matched.length / templateColumns.length
      : 0;

    if (!bestMatch || matchRate > bestMatch.matchRate) {
      bestMatch = { template, matchRate };
    }
  }

  // 매칭률 20% 이상일 때만 추천
  return bestMatch && bestMatch.matchRate >= 0.2 ? bestMatch : null;
}

// ─── 커스텀 필드 슬롯 자동 배정 (v1.4.0) ────────────────

/** 한줄로 표준 필드 17개 (field_key 기준) — 커스텀 배정 시 제외 대상 */
export const STANDARD_FIELD_KEYS = new Set([
  'name', 'phone', 'gender', 'age', 'birth_date', 'email', 'address',
  'recent_purchase_store', 'recent_purchase_amount', 'total_purchase_amount',
  'store_code', 'registration_type', 'registered_store', 'store_phone',
  'grade', 'points', 'sms_opt_in',
  // 시스템/레거시 필드 (표준 아니지만 커스텀 슬롯에 넣지 않음)
  'store_name', 'registered_store_number', 'recent_purchase_date',
  'last_purchase_date', 'total_purchase', 'purchase_count', 'avg_order_value',
  'ltv_score', 'wedding_anniversary', 'is_married', 'is_opt_out', 'is_active',
  'birth_year', 'birth_month_day', 'region',
]);

const MAX_CUSTOM_SLOTS = 15;

export interface CustomFieldAssignment {
  /** 확장된 매핑 (기존 + custom_1~15 배정 추가) */
  mapping: ColumnMapping;
  /** 커스텀 슬롯 라벨 { custom_1: "원본컬럼명", ... } */
  customFieldLabels: Record<string, string>;
  /** 슬롯 초과로 무시된 컬럼 */
  overflowColumns: string[];
}

/**
 * 표준 17개에 매핑 안 된 POS 컬럼 → custom_1~custom_15에 자동 배정
 *
 * @param baseMapping autoSuggestMapping 결과 (표준 필드 매핑)
 * @param unmappedColumns 매핑 안 된 소스 컬럼 목록
 * @returns 확장된 매핑 + 커스텀 라벨
 */
export function assignCustomFieldSlots(
  baseMapping: ColumnMapping,
  unmappedColumns: string[],
): CustomFieldAssignment {
  const mapping = { ...baseMapping };
  const customFieldLabels: Record<string, string> = {};
  const overflowColumns: string[] = [];

  // 이미 custom_N에 배정된 슬롯 확인 (edit-config로 수동 지정한 경우)
  const usedSlots = new Set<number>();
  for (const targetField of Object.values(mapping)) {
    const match = targetField.match(/^custom_(\d+)$/);
    if (match) usedSlots.add(parseInt(match[1], 10));
  }

  let nextSlot = 1;
  for (const col of unmappedColumns) {
    // 다음 빈 슬롯 찾기
    while (nextSlot <= MAX_CUSTOM_SLOTS && usedSlots.has(nextSlot)) {
      nextSlot++;
    }

    if (nextSlot > MAX_CUSTOM_SLOTS) {
      overflowColumns.push(col);
      continue;
    }

    const slotKey = `custom_${nextSlot}`;
    mapping[col] = slotKey;
    customFieldLabels[slotKey] = col; // 기본 라벨 = 원본 컬럼명
    usedSlots.add(nextSlot);
    nextSlot++;
  }

  return { mapping, customFieldLabels, overflowColumns };
}
