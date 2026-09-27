/**
 * brand-basic-info.ts — 회사 브랜드 기본정보 CRUD (2026-07-21 브랜드 학습 통합).
 *
 * "브랜드 학습" 모달 ①기본정보 탭이 저장하는 회사 사실 정보 = 기존 companies 컬럼(Phase 0 실측 존재 확인).
 * 신규 저장소·컬럼 없음 — 화이트리스트 컬럼만 부분 업데이트(SQL 인젝션 차단, 컬럼명은 리터럴 화이트리스트).
 * 연락처·SNS·시각 정체성은 companies.brand_kit(jsonb) = dm-brand-kit.ts 소관(분리).
 */
import { query } from '../config/database';
import { isIndustryCode } from './industry-codes';
import { normalizeBizNumber } from './billing-settings';

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

/**
 * ★ 2026-09-27 한줄로 V2 R170 — 세금계산서 공급받는자 정보(상호·사업자등록번호·업태·종목). 관리자만 바꾼다(라우트).
 * 담당자는 브랜드명·업종만(문안 참고 정보).
 */
export const BRAND_LEGAL_FIELDS = ['company_name', 'business_number', 'business_type', 'business_category'] as const;

const bizDigits = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const sameLegalValue = (field: string, a: unknown, b: unknown) =>
  field === 'business_number' ? bizDigits(a) === bizDigits(b) : String(a ?? '').trim() === String(b ?? '').trim();

/** 요청이 법정 칸을 **실제로** 바꾸는가. 화면은 저장 때 전체를 보내므로 지금 값과 같으면(사업자번호는 숫자만 비교) 바뀐 것이 아니다. */
export function findLegalFieldChanges(current: BrandBasicInfo, picked: BrandBasicInfo): string[] {
  return BRAND_LEGAL_FIELDS.filter((f) => f in picked && !sameLegalValue(f, picked[f], current[f]));
}

export async function updateBrandBasicInfo(companyId: string, patch: unknown): Promise<BrandBasicInfo> {
  const picked = pickBasicInfoFields(patch);
  // ★ 2026-09-27 R170 — 사업자등록번호는 바뀔 때만 형식 CT(숫자 10자리 → 000-00-00000 · 형식 오류면 던진다 → 라우트 400).
  //   같은 번호면 저장값을 그대로 둔다(옛 표기로 저장된 값 때문에 다른 칸 저장이 막히지 않게).
  if ('business_number' in picked) {
    const current = await getBrandBasicInfo(companyId);
    if (bizDigits(picked.business_number) === bizDigits(current.business_number)) delete picked.business_number;
    else picked.business_number = normalizeBizNumber(picked.business_number);
  }
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
