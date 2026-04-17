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

/** AI가 URL에서 메타 태그/로고 기반 자동 제안 — V2 구현 예정 (placeholder) */
export async function suggestBrandKitFromUrl(_url: string): Promise<Partial<DmBrandKit>> {
  // TODO: V2 — og:image/apple-touch-icon 기반 로고 추출, 컬러 추출
  return {};
}
