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
    // ★ 2026-09-27 한줄로 V2 R212 — 확인 실패는 캐시하지 않는다(다음 호출이 다시 확인). 옛: false를 영구 캐시해 재시작 전까지 브랜드킷 저장이 조용히 무시됐다.
    return false;
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
  // ★ 2026-10-19 B-0924-3 — 바꾼 키만 DB 에서 병합(통째 덮기 금지). 읽기 실패로 current 가 기본값이어도 저장된 다른 키
  //   (SNS 자주 쓰는 태그 sns_tag_set 등)를 지우지 않고, 같은 순간 다른 경로의 키 저장도 덮지 않는다.
  //   저장값이 비어 있으면 종전처럼 합친 전체를 쓴다.
  // ★ 2026-11-07 C113 K20 · D20 — 옛 문자열 저장본은 DB 안에서 풀어 키 병합(옛: 앱 쪽 읽기 결과로 통째 덮어 · 읽기가 기본값을 돌려주면
  //   저장된 다른 키를 잃었다) · 풀 수 없는 글이면 캐스트 오류 = 쓰기 0 · 객체 · 빈 키트 문장은 그대로(미가입 변화 0).
  await query(
    `UPDATE companies
        SET brand_kit = CASE jsonb_typeof(brand_kit)
                          WHEN 'object' THEN brand_kit || $1::jsonb
                          WHEN 'string' THEN (brand_kit #>> '{}')::jsonb || $1::jsonb
                          ELSE $2::jsonb END
      WHERE id = $3`,
    [JSON.stringify(cleanPatch), JSON.stringify(merged), companyId],
  );
  return merged;
}

/**
 * ★ 2026-11-07 C112 키트 로고가 비어 있을 때만 채운다(이미지 스튜디오 홈페이지 읽기 · 덮어쓰기 0 · 설계서 D11).
 *   빈 칸 판정과 쓰기 = 대상 행만 읽는 한 문장(같은 순간 다른 경로가 로고를 넣었으면 쓰지 않는다 · 앱 쪽 읽기 0) ·
 *   옛 문자열 저장 = DB 안에서 풀어 그 키들과 합친 객체로(풀 수 없는 글이면 오류 · 쓰기 0 · Codex 구현 1R).
 *   채웠으면 true · 이미 차 있었거나 칸이 없으면 false.
 */
const KIT_OBJECT_SQL = `(CASE jsonb_typeof(brand_kit) WHEN 'object' THEN brand_kit WHEN 'string' THEN (brand_kit #>> '{}')::jsonb ELSE '{}'::jsonb END)`;
export async function setBrandKitLogoIfEmpty(companyId: string, logoUrl: string): Promise<boolean> {
  const exists = await ensureColumn();
  if (!exists) return false;
  const res = await query(
    `UPDATE companies
        SET brand_kit = ${KIT_OBJECT_SQL} || $1::jsonb
      WHERE id = $2
        AND jsonb_typeof(${KIT_OBJECT_SQL}) = 'object'
        AND NULLIF(btrim(${KIT_OBJECT_SQL}->>'logo_url'), '') IS NULL
      RETURNING id`,
    [JSON.stringify({ logo_url: logoUrl }), companyId],
  );
  return res.rows.length > 0;
}

