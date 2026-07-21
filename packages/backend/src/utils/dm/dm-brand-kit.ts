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

// ────────────── 정규화 (서체 한/영 폴백) ──────────────

/**
 * ★ 2026-07-21 브랜드 학습 통합 — 서체 한/영 신키 폴백.
 * font_ko(한글 서체) = 기존 본문 서체(font_family) 폴백(무손실·회귀 0).
 * font_en(영문 서체)은 신규 축(기존 대응 없음) — font_display(헤드라인)는 축이 달라 폴백하지 않는다. 미설정 기본.
 * 헤드라인 서체(font_display)는 렌더에서 그대로 유지(하위호환) — 이 함수는 손대지 않는다.
 * 순수 함수(DB 접근 X) — 로드 경로와 테스트가 공유.
 */
export function normalizeBrandKit<T extends Partial<DmBrandKit>>(kit: T): T {
  if (!kit) return kit;
  return {
    ...kit,
    font_ko: kit.font_ko ?? kit.font_family,
  };
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
    return normalizeBrandKit({ ...DEFAULT_BRAND_KIT, ...(kit || {}) });
  } catch {
    return { ...DEFAULT_BRAND_KIT };
  }
}

/**
 * 회사가 실제 저장한 브랜드 킷 원본 — 미설정/컬럼 부재 = null (기본값 병합 X).
 * "회사가 브랜드 색을 설정했는가" 판정용 (인앱 AI 강조색 강제 등) —
 * getCompanyBrandKit은 기본값을 병합해 설정 여부를 구분할 수 없다.
 */
export async function getCompanyBrandKitRaw(companyId: string): Promise<Partial<DmBrandKit> | null> {
  const exists = await ensureColumn();
  if (!exists) return null;
  try {
    const res = await query(`SELECT brand_kit FROM companies WHERE id = $1`, [companyId]);
    const raw = res.rows[0]?.brand_kit;
    if (!raw) return null;
    const kit = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return kit && typeof kit === 'object' ? kit : null;
  } catch {
    return null;
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
  // ★ 2026-07-21 (Codex R2 #7) undefined 키는 병합 전 제거 — 내부 호출이 {k: undefined}를 넘겨도 기존값이 지워지지 않게.
  //   의도적 클리어는 명시 null로만(프론트는 클리어 시 null 전송). undefined는 "미변경"으로 취급.
  const cleanPatch = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  const merged = { ...current, ...cleanPatch };
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
