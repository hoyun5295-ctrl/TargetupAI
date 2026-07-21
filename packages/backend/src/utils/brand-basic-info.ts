/**
 * brand-basic-info.ts — 회사 브랜드 기본정보 CRUD (2026-07-21 브랜드 학습 통합).
 *
 * "브랜드 학습" 모달 ①기본정보 탭이 저장하는 회사 사실 정보 = 기존 companies 컬럼(Phase 0 실측 존재 확인).
 * 신규 저장소·컬럼 없음 — 화이트리스트 컬럼만 부분 업데이트(SQL 인젝션 차단, 컬럼명은 리터럴 화이트리스트).
 * 연락처·SNS·시각 정체성은 companies.brand_kit(jsonb) = dm-brand-kit.ts 소관(분리).
 */
import { query } from '../config/database';
import { isIndustryCode } from './industry-codes';

/** 화이트리스트 = 실측 확인된 companies 컬럼. 이 목록 밖 키는 무시(임의 컬럼 UPDATE 차단).
 *  ★ 2026-07-21 업태=business_type / 종목=business_category (거래내역서 billing.ts 기준·문안 생성이 business_type 참조). */
export const BRAND_BASIC_FIELDS = [
  'brand_name',
  'company_name',
  'business_number',
  'business_type',      // 업태
  'business_category',  // 종목
  'industry_code',
] as const;

export type BrandBasicInfo = Partial<Record<(typeof BRAND_BASIC_FIELDS)[number], string | null>>;

/** 전달 패치에서 화이트리스트 컬럼만 추린다(순수 함수 — 테스트/라우트 공유, 임의 컬럼 주입 차단).
 *  industry_code는 허용 목록(INDUSTRY_CODES)에 있는 값 또는 빈 값(선택 해제)만 통과 — 임의 문자열 저장 차단. */
export function pickBasicInfoFields(patch: unknown): BrandBasicInfo {
  const out: BrandBasicInfo = {};
  if (!patch || typeof patch !== 'object') return out;
  const p = patch as Record<string, unknown>;
  for (const f of BRAND_BASIC_FIELDS) {
    if (!(f in p)) continue;
    const v = p[f];
    const s = v === null || v === undefined ? null : String(v);
    // 업종 코드는 화이트리스트 검증(빈 값=선택 해제 허용, 그 외 유효 코드만)
    if (f === 'industry_code' && s && !isIndustryCode(s)) continue;
    out[f] = s;
  }
  return out;
}

export async function getBrandBasicInfo(companyId: string): Promise<BrandBasicInfo> {
  // ★ SELECT는 화이트리스트(BRAND_BASIC_FIELDS)와 반드시 일치 — 업태=business_type 포함, 제거된 business_item 미선택(저장 후 null 반환 방지, Codex R2).
  const res = await query(
    `SELECT brand_name, company_name, business_number, business_type, business_category, industry_code
     FROM companies WHERE id = $1`,
    [companyId],
  );
  const r = res.rows[0] || {};
  const out: BrandBasicInfo = {};
  for (const f of BRAND_BASIC_FIELDS) out[f] = (r[f] ?? null) as string | null;
  return out;
}

export async function updateBrandBasicInfo(companyId: string, patch: unknown): Promise<BrandBasicInfo> {
  const picked = pickBasicInfoFields(patch);
  const keys = Object.keys(picked) as (typeof BRAND_BASIC_FIELDS)[number][];
  if (keys.length === 0) return getBrandBasicInfo(companyId);
  // 컬럼명은 화이트리스트 리터럴, 값만 파라미터 바인딩 — 전달된 키만 부분 업데이트.
  const sets = keys.map((k, i) => `${k} = $${i + 1}`);
  const vals: (string | null)[] = keys.map((k) => picked[k] ?? null);
  vals.push(companyId);
  await query(
    `UPDATE companies SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${keys.length + 1}`,
    vals,
  );
  return getBrandBasicInfo(companyId);
}
