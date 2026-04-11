/**
 * ★ CT-F13 — 전단AI 업종 레지스트리 컨트롤타워
 *
 * 업종(business_type) 조회 + 템플릿 메타데이터의 유일한 진입점.
 * - DB: flyer_business_types 테이블에서 업종별 카테고리 프리셋 + 사용 가능 템플릿 조회
 * - 코드: TEMPLATE_REGISTRY에 템플릿 label/desc/color 메타데이터 정의
 *
 * 업종 추가: DB INSERT만으로 확장 (코드 수정 없음)
 * 템플릿 추가: TEMPLATE_REGISTRY + CT-F14 렌더러 추가
 */

import { query } from '../../config/database';

// ============================================================
// 인터페이스
// ============================================================

export interface BusinessType {
  type_code: string;
  type_name: string;
  category_presets: string[];
  default_template: string;
  is_active: boolean;
  sort_order: number;
}

export interface TemplateInfo {
  value: string;
  label: string;
  desc: string;
  color: string; // ★ D114: CSS gradient (인라인 스타일용) — Tailwind 동적 클래스는 purge됨
}

// ============================================================
// 템플릿 메타데이터 레지스트리 (코드에서 정의)
// ★ D114: color를 Tailwind 클래스 → CSS linear-gradient hex로 변경
//   이유: API에서 동적으로 받아오는 Tailwind 클래스는 빌드 시 purge되어 색상 미표시
// ============================================================

export const TEMPLATE_REGISTRY: Record<string, TemplateInfo> = {
  // --- 공통 (모든 업종 사용 가능) ---
  grid: {
    value: 'grid',
    label: '가격 강조형',
    desc: '빨간 테마, 2열 카드',
    color: 'linear-gradient(to right, #ef4444, #f97316)',
  },
  list: {
    value: 'list',
    label: '리스트형',
    desc: '딥블루, 깔끔 모던',
    color: 'linear-gradient(to right, #1d4ed8, #3b82f6)',
  },
  highlight: {
    value: 'highlight',
    label: '특가 하이라이트',
    desc: '다크 모드, TOP PICK',
    color: 'linear-gradient(to right, #1f2937, #d97706)',
  },

  // --- 마트 전용 ---
  mart_fresh: {
    value: 'mart_fresh',
    label: '신선식품 특화',
    desc: '녹색 테마, 농산물 강조',
    color: 'linear-gradient(to right, #22c55e, #059669)',
  },
  mart_weekend: {
    value: 'mart_weekend',
    label: '주말특가',
    desc: '보라+핑크, 주말 행사',
    color: 'linear-gradient(to right, #a855f7, #ec4899)',
  },
  mart_seasonal: {
    value: 'mart_seasonal',
    label: '시즌 행사',
    desc: '파랑+시안, 명절/절기',
    color: 'linear-gradient(to right, #3b82f6, #22d3ee)',
  },
  mart_clearance: {
    value: 'mart_clearance',
    label: '창고대방출',
    desc: '노랑+빨강, 대량할인',
    color: 'linear-gradient(to right, #eab308, #ef4444)',
  },

  // --- 정육 전용 ---
  butcher_premium: {
    value: 'butcher_premium',
    label: '프리미엄 정육',
    desc: '다크+골드, 한우 특화',
    color: 'linear-gradient(to right, #111827, #d97706)',
  },
  butcher_daily: {
    value: 'butcher_daily',
    label: '오늘의 고기',
    desc: '빨강, 일일특가',
    color: 'linear-gradient(to right, #dc2626, #f43f5e)',
  },
  butcher_bulk: {
    value: 'butcher_bulk',
    label: '대용량 팩',
    desc: '네이비, 중량 강조',
    color: 'linear-gradient(to right, #1e3a8a, #4f46e5)',
  },
};

// ============================================================
// 캐시 (5분 TTL)
// ============================================================

let _cache: BusinessType[] | null = null;
let _cacheTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

export function invalidateBusinessTypeCache(): void {
  _cache = null;
  _cacheTime = 0;
}

// ============================================================
// 업종 조회 함수
// ============================================================

/**
 * 전체 활성 업종 목록 (캐시 5분).
 */
export async function getBusinessTypes(): Promise<BusinessType[]> {
  const now = Date.now();
  if (_cache && now - _cacheTime < CACHE_TTL_MS) return _cache;

  const result = await query(
    `SELECT type_code, type_name, category_presets, default_template, is_active, sort_order
     FROM flyer_business_types
     WHERE is_active = true
     ORDER BY sort_order ASC, type_code ASC`
  );

  const types: BusinessType[] = result.rows.map((r: any) => ({
    type_code: r.type_code,
    type_name: r.type_name,
    category_presets: typeof r.category_presets === 'string'
      ? JSON.parse(r.category_presets)
      : (r.category_presets || []),
    default_template: r.default_template || 'grid',
    is_active: r.is_active,
    sort_order: r.sort_order || 0,
  }));

  _cache = types;
  _cacheTime = now;
  return types;
}

/**
 * 단건 조회. 캐시에서 검색.
 */
export async function getBusinessType(typeCode: string): Promise<BusinessType | null> {
  const types = await getBusinessTypes();
  return types.find(t => t.type_code === typeCode) || null;
}

/**
 * 업종별 카테고리 프리셋. 미존재 시 빈 배열.
 */
export async function getCategoryPresets(typeCode: string): Promise<string[]> {
  const bt = await getBusinessType(typeCode);
  return bt?.category_presets || [];
}

/**
 * 업종별 사용 가능 템플릿 (메타데이터 포함).
 * DB의 available_templates가 없으면 공통 3종 + 업종 prefix 자동 매칭.
 */
export async function getAvailableTemplates(typeCode: string): Promise<TemplateInfo[]> {
  // 공통 템플릿 (모든 업종 사용 가능)
  const commonCodes = ['grid', 'list', 'highlight'];

  // 업종별 prefix로 매칭 (mart_ → 마트, butcher_ → 정육)
  const prefixMap: Record<string, string> = {
    mart: 'mart_',
    butcher: 'butcher_',
  };

  const prefix = prefixMap[typeCode] || `${typeCode}_`;
  const typeCodes = Object.keys(TEMPLATE_REGISTRY).filter(
    code => commonCodes.includes(code) || code.startsWith(prefix)
  );

  return typeCodes
    .map(code => TEMPLATE_REGISTRY[code])
    .filter((t): t is TemplateInfo => !!t);
}

/**
 * 전체 업종 목록 (관리용 — is_active 무관).
 */
export async function getAllBusinessTypes(): Promise<BusinessType[]> {
  const result = await query(
    `SELECT type_code, type_name, category_presets, default_template, is_active, sort_order
     FROM flyer_business_types
     ORDER BY sort_order ASC, type_code ASC`
  );

  return result.rows.map((r: any) => ({
    type_code: r.type_code,
    type_name: r.type_name,
    category_presets: typeof r.category_presets === 'string'
      ? JSON.parse(r.category_presets)
      : (r.category_presets || []),
    default_template: r.default_template || 'grid',
    is_active: r.is_active,
    sort_order: r.sort_order || 0,
  }));
}
