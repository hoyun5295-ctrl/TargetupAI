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

import { query } from '../../../config/database';

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
  // ━━ 기본 (8개 엔진 대표) ━━
  grid:             { value: 'grid', label: '가격 강조형', desc: '2열 카드, 가격 대형 강조', color: 'linear-gradient(to right, #ef4444, #f97316)' },
  magazine:         { value: 'magazine', label: '매거진형', desc: '1열 좌우교대, 대형 이미지', color: 'linear-gradient(to right, #292524, #c2410c)' },
  editorial:        { value: 'editorial', label: '에디토리얼', desc: '첫상품 풀블리드 + 2열', color: 'linear-gradient(to right, #0f172a, #334155)' },
  showcase:         { value: 'showcase', label: '쇼케이스', desc: '대형 싱글 카드, 절약액', color: 'linear-gradient(to right, #7c3aed, #ec4899)' },
  highlight:        { value: 'highlight', label: '특가 하이라이트', desc: '다크+옐로, 임팩트 강조', color: 'linear-gradient(to right, #18181b, #facc15)' },

  // ━━ 시즌 (모든 업종 공통) ━━
  season_newyear:   { value: 'season_newyear', label: '설날 특선', desc: '빨강+금색, 대형 쇼케이스', color: 'linear-gradient(to right, #dc2626, #ca8a04)' },
  season_chuseok:   { value: 'season_chuseok', label: '추석 한가위', desc: '남색+주황, 풀블리드', color: 'linear-gradient(to right, #1e40af, #f59e0b)' },
  season_summer:    { value: 'season_summer', label: '여름 시원특가', desc: '시안+블루, 3열 촘촘', color: 'linear-gradient(to right, #06b6d4, #0891b2)' },
  season_winter:    { value: 'season_winter', label: '겨울 따뜻특가', desc: '딥로즈, 매거진형', color: 'linear-gradient(to right, #be123c, #fb7185)' },
  season_christmas: { value: 'season_christmas', label: '크리스마스', desc: '그린+레드, 가로 스크롤', color: 'linear-gradient(to right, #15803d, #dc2626)' },

  // ━━ 행사 유형 (모든 업종 공통) ━━
  event_bogo:       { value: 'event_bogo', label: '1+1 / 2+1', desc: '오렌지, 2열 혜택 강조', color: 'linear-gradient(to right, #f97316, #ea580c)' },
  event_timesale:   { value: 'event_timesale', label: '타임세일', desc: '블랙+레드, 가로 스크롤', color: 'linear-gradient(to right, #171717, #ef4444)' },
  event_membership: { value: 'event_membership', label: '멤버십 데이', desc: '퍼플, 대+소 타일 교차', color: 'linear-gradient(to right, #7e22ce, #a855f7)' },
  event_grand_open: { value: 'event_grand_open', label: '그랜드 오픈', desc: '블랙+골드, 풀블리드', color: 'linear-gradient(to right, #1c1917, #fbbf24)' },

  // ━━ 마트 확장 ━━
  mart_fresh:       { value: 'mart_fresh', label: '신선식품 특화', desc: '녹색, 2열 그리드', color: 'linear-gradient(to right, #22c55e, #059669)' },
  mart_clearance:   { value: 'mart_clearance', label: '창고대방출', desc: '노랑+빨강, 3열 촘촘', color: 'linear-gradient(to right, #eab308, #ef4444)' },
  mart_general:     { value: 'mart_general', label: '공산품 특가', desc: '슬레이트, 3열 깔끔', color: 'linear-gradient(to right, #475569, #6366f1)' },
  mart_seafood:     { value: 'mart_seafood', label: '수산 코너', desc: '딥블루, 대형배너+리스트', color: 'linear-gradient(to right, #1d4ed8, #3b82f6)' },

  // ━━ 정육 확장 ━━
  butcher_premium:  { value: 'butcher_premium', label: '프리미엄 정육', desc: '다크+골드, 매거진형', color: 'linear-gradient(to right, #111827, #d97706)' },
  butcher_hanwoo:   { value: 'butcher_hanwoo', label: '한우 전문', desc: '블랙+앰버, 대형배너', color: 'linear-gradient(to right, #1c1917, #f59e0b)' },
  butcher_giftset:  { value: 'butcher_giftset', label: '선물세트', desc: '앰버+골드, 타일 교차', color: 'linear-gradient(to right, #92400e, #d97706)' },
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
  const commonCodes = [
    'grid', 'magazine', 'editorial', 'showcase', 'highlight',
    'season_newyear', 'season_chuseok', 'season_summer', 'season_winter', 'season_christmas',
    'event_bogo', 'event_timesale', 'event_membership', 'event_grand_open',
  ];

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
