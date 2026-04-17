/**
 * dm-brand-kit.ts — 회사별 브랜드 킷 CRUD
 *
 * companies.brand_kit (JSONB) 컬럼에 저장.
 * 컬럼이 존재하지 않을 수 있어 IF NOT EXISTS 확인 후 읽기/쓰기.
 *
 * ⚠️ 추가 마이그레이션 필요 (Harold님 직접 실행):
 *   ALTER TABLE companies ADD COLUMN IF NOT EXISTS brand_kit JSONB;
 *
 * 설계서: status/DM-PRO-DESIGN.md §12
 */
import { query } from '../../config/database';
import type { DmBrandKit } from './dm-tokens';
import { DM_COLOR_TOKENS } from './dm-tokens';

// ────────────── 기본 브랜드 킷 ──────────────

export const DEFAULT_BRAND_KIT: DmBrandKit = {
  primary_color: DM_COLOR_TOKENS.brand.primary,
  accent_color: DM_COLOR_TOKENS.brand.accent,
  neutral_color: DM_COLOR_TOKENS.neutral[700],
  background_color: DM_COLOR_TOKENS.neutral[0],
  tone: 'friendly',
};

// ────────────── 컬럼 존재 확인 (캐시) ──────────────

let columnExists: boolean | null = null;

async function ensureColumn(): Promise<boolean> {
  if (columnExists !== null) return columnExists;
  try {
    const res = await query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_name = 'companies' AND column_name = 'brand_kit'`,
    );
    columnExists = res.rows.length > 0;
  } catch {
    columnExists = false;
  }
  return columnExists;
}

// ────────────── 조회/수정 ──────────────

export async function getCompanyBrandKit(companyId: string): Promise<DmBrandKit> {
  const exists = await ensureColumn();
  if (!exists) return { ...DEFAULT_BRAND_KIT };
  try {
    const res = await query(`SELECT brand_kit FROM companies WHERE id = $1`, [companyId]);
    const raw = res.rows[0]?.brand_kit;
    if (!raw) return { ...DEFAULT_BRAND_KIT };
    const kit = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return { ...DEFAULT_BRAND_KIT, ...(kit || {}) };
  } catch {
    return { ...DEFAULT_BRAND_KIT };
  }
}

export async function updateCompanyBrandKit(companyId: string, patch: Partial<DmBrandKit>): Promise<DmBrandKit> {
  const exists = await ensureColumn();
  if (!exists) {
    // 컬럼 없으면 운영자에게 알림 로그
    console.warn('[BrandKit] companies.brand_kit 컬럼이 없어요. ALTER TABLE 필요.');
    return { ...DEFAULT_BRAND_KIT, ...patch };
  }
  const current = await getCompanyBrandKit(companyId);
  const merged = { ...current, ...patch };
  await query(
    `UPDATE companies SET brand_kit = $1 WHERE id = $2`,
    [JSON.stringify(merged), companyId],
  );
  return merged;
}

/** URL에서 메타 태그/로고/테마컬러 추출 → DmBrandKit 부분값 반환 (D126 V2) */
export async function suggestBrandKitFromUrl(url: string): Promise<Partial<DmBrandKit>> {
  const { extractBrandFromUrl, toBrandKitPatch } = await import('./dm-brand-extractor');
  const result = await extractBrandFromUrl(url);
  return toBrandKitPatch(result);
}

/** 추출 결과 원본(프리뷰 포함)도 함께 반환 — 프론트에서 확인 UI에 사용 */
export async function previewBrandExtract(url: string) {
  const { extractBrandFromUrl, toBrandKitPatch } = await import('./dm-brand-extractor');
  const result = await extractBrandFromUrl(url);
  return {
    raw: result,
    patch: toBrandKitPatch(result),
  };
}
