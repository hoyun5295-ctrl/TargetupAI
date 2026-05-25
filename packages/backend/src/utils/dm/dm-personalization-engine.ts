/**
 * CT-90 — dm-personalization-engine.ts
 *
 * D216+ 모바일DM 강화 — Liquid 변수 + customer 자동 추천 + 변수 드롭다운.
 *
 * 표준 변수 + customers.custom_fields (사용자 정의) 자동 추출.
 *
 * 호출 영역: routes/dm.ts GET /dm/personalization-vars
 */

import { query } from '../../config/database';

// ────────────── 타입 ──────────────

export type VariableCategory =
  | 'customer_basic'
  | 'customer_purchase'
  | 'customer_grade'
  | 'campaign_context'
  | 'company_info';

export interface PersonalizationVariable {
  variable: string;
  label: string;
  category: VariableCategory;
  example_value?: string;
  default_fallback: string;
  recommended_sections: string[];
  is_custom?: boolean;
}

// ────────────── 표준 변수 매핑 ──────────────

const STANDARD_VARIABLES: PersonalizationVariable[] = [
  // 고객 기본
  {
    variable: 'name',
    label: '고객 이름',
    category: 'customer_basic',
    example_value: '홍길동',
    default_fallback: '고객님',
    recommended_sections: ['header', 'hero', 'text_card', 'cta'],
  },
  {
    variable: 'phone',
    label: '전화번호',
    category: 'customer_basic',
    example_value: '010-1234-5678',
    default_fallback: '',
    recommended_sections: ['store_info'],
  },
  {
    variable: 'email',
    label: '이메일',
    category: 'customer_basic',
    default_fallback: '',
    recommended_sections: ['footer'],
  },
  {
    variable: 'birthday_month',
    label: '생월',
    category: 'customer_basic',
    default_fallback: '',
    recommended_sections: ['hero', 'text_card'],
  },
  // 등급
  {
    variable: 'grade',
    label: '등급',
    category: 'customer_grade',
    example_value: 'VIP',
    default_fallback: '회원',
    recommended_sections: ['header', 'hero', 'text_card'],
  },
  // 구매
  {
    variable: 'recent_purchase_date',
    label: '최근 구매일',
    category: 'customer_purchase',
    example_value: '2026-04-15',
    default_fallback: '최근',
    recommended_sections: ['text_card'],
  },
  {
    variable: 'purchase_count',
    label: '구매 횟수',
    category: 'customer_purchase',
    default_fallback: '',
    recommended_sections: ['text_card'],
  },
  {
    variable: 'total_purchase',
    label: '누적 구매액',
    category: 'customer_purchase',
    default_fallback: '',
    recommended_sections: ['text_card'],
  },
  {
    variable: 'last_visit_store',
    label: '최근 방문 매장',
    category: 'customer_purchase',
    default_fallback: '매장',
    recommended_sections: ['store_info', 'text_card'],
  },
  // 회사 정보
  {
    variable: 'company_name',
    label: '회사명',
    category: 'company_info',
    default_fallback: '저희',
    recommended_sections: ['header', 'footer'],
  },
];

// ────────────── 메인 함수 ──────────────

export interface PersonalizationOptions {
  section_type?: string;
  current_text?: string;
}

export async function getPersonalizationVariables(
  companyId: string,
  options: PersonalizationOptions = {},
): Promise<PersonalizationVariable[]> {
  // customers.custom_fields jsonb keys 자동 추출
  const customColumns = await query(
    `SELECT
      jsonb_object_keys(custom_fields) AS field_name,
      COUNT(*) AS usage_count
    FROM customers
    WHERE company_id = $1 AND custom_fields IS NOT NULL AND custom_fields != '{}'::jsonb
    GROUP BY field_name
    ORDER BY usage_count DESC
    LIMIT 30`,
    [companyId],
  );

  const customVars: PersonalizationVariable[] = customColumns.rows.map((row: any) => ({
    variable: String(row.field_name),
    label: `사용자 정의: ${row.field_name}`,
    category: 'customer_basic' as const,
    default_fallback: '',
    recommended_sections: ['text_card', 'hero'],
    is_custom: true,
  }));

  const allVars = [...STANDARD_VARIABLES, ...customVars];

  // section_type 필터 (옵션)
  if (options.section_type) {
    return allVars.filter((v) => v.recommended_sections.includes(options.section_type!));
  }

  return allVars;
}

// ────────────── Liquid 변수 추출 (편집기 활용) ──────────────

export function extractVariablesFromText(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/%([^%\s]+)%/g) || [];
  return Array.from(new Set(matches.map((m) => m.replace(/%/g, ''))));
}

// ────────────── 변수 추천 (sect_type + 현재 텍스트 기반) ──────────────

export async function recommendVariablesForSection(
  companyId: string,
  sectionType: string,
  currentText: string = '',
): Promise<PersonalizationVariable[]> {
  const all = await getPersonalizationVariables(companyId, { section_type: sectionType });
  const alreadyUsed = new Set(extractVariablesFromText(currentText));
  return all.filter((v) => !alreadyUsed.has(v.variable)).slice(0, 8);
}
