/**
 * dm-ab-test.ts — DM A/B 테스트 CRUD + variant 선택 + 성과 집계
 *
 * 테이블: dm_ab_tests (D126 V2 신설)
 *         dm_views.ab_test_id / dm_views.ab_variant
 *
 * 상태:
 *   draft     — 생성만 (short_code 없음)
 *   running   — 배포 중 (short_code 발급, 방문자 분배 시작)
 *   paused    — 일시 중지
 *   completed — 종료 + 결과 집계 고정
 *
 * variant 선택:
 *   pickVariant() — 가중치 기반 랜덤 (weight_a + weight_b + weight_c 합을 분모로)
 *   뷰어에서 쿠키로 스티키 (같은 방문자는 같은 variant 유지)
 *
 * 소비처:
 *  - routes/dm.ts (A/B CRUD 라우트 + /ab/:code 뷰어)
 */

import crypto from 'crypto';
import { query } from '../../config/database';

// ────────────── 타입 ──────────────

export type AbTestStatus = 'draft' | 'running' | 'paused' | 'completed';
export type AbPrimaryMetric = 'view' | 'click' | 'conversion' | 'complete_rate';
export type AbVariantKey = 'a' | 'b' | 'c';

export interface AbTestInput {
  name: string;
  description?: string;
  variant_a_page_id: string;
  variant_b_page_id: string;
  variant_c_page_id?: string | null;
  variant_a_weight?: number;
  variant_b_weight?: number;
  variant_c_weight?: number;
  primary_metric?: AbPrimaryMetric;
}

export interface AbTestRecord {
  id: string;
  company_id: string;
  created_by: string | null;
  name: string;
  description: string | null;
  short_code: string | null;
  variant_a_page_id: string;
  variant_b_page_id: string;
  variant_c_page_id: string | null;
  variant_a_weight: number;
  variant_b_weight: number;
  variant_c_weight: number;
  primary_metric: AbPrimaryMetric;
  status: AbTestStatus;
  started_at: string | null;
  ended_at: string | null;
  result_summary: Record<string, any> | null;
  created_at: string;
  updated_at: string;
}

export interface AbVariantStats {
  variant: AbVariantKey;
  page_id: string;
  views: number;
  unique_phones: number;
  avg_duration_sec: number;
  completion_rate: number; // last page 도달율
  clicks: number;
}

export interface AbTestResult {
  test: AbTestRecord;
  variants: AbVariantStats[];
  winner: AbVariantKey | null;
  total_views: number;
}

// ────────────── 내부 유틸 ──────────────

function generateShortCode(length = 7): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

function validateWeights(a: number, b: number, c: number): { ok: boolean; error?: string } {
  if (a < 0 || b < 0 || c < 0) return { ok: false, error: '가중치는 0 이상이어야 합니다.' };
  if (a + b + c <= 0) return { ok: false, error: '가중치 합은 0보다 커야 합니다.' };
  return { ok: true };
}

// ────────────── CRUD ──────────────

export async function createAbTest(
  companyId: string,
  userId: string | null,
  input: AbTestInput,
): Promise<AbTestRecord> {
  const weightA = input.variant_a_weight ?? 50;
  const weightB = input.variant_b_weight ?? 50;
  const weightC = input.variant_c_weight ?? 0;
  const v = validateWeights(weightA, weightB, weightC);
  if (!v.ok) throw new Error(v.error);

  // DM 소유권 확인 (같은 company의 dm_pages만)
  const pageIds = [input.variant_a_page_id, input.variant_b_page_id, input.variant_c_page_id].filter(Boolean) as string[];
  const owned = await query(
    `SELECT id FROM dm_pages WHERE company_id = $1 AND id = ANY($2::uuid[])`,
    [companyId, pageIds],
  );
  if (owned.rows.length !== pageIds.length) {
    throw new Error('A/B 테스트에 포함할 DM 중 일부를 찾을 수 없습니다.');
  }

  const res = await query(
    `INSERT INTO dm_ab_tests (
       company_id, created_by, name, description,
       variant_a_page_id, variant_b_page_id, variant_c_page_id,
       variant_a_weight, variant_b_weight, variant_c_weight,
       primary_metric, status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'draft')
     RETURNING *`,
    [
      companyId,
      userId,
      input.name,
      input.description || null,
      input.variant_a_page_id,
      input.variant_b_page_id,
      input.variant_c_page_id || null,
      weightA,
      weightB,
      weightC,
      input.primary_metric || 'view',
    ],
  );
  return res.rows[0] as AbTestRecord;
}

export async function getAbTest(id: string, companyId: string): Promise<AbTestRecord | null> {
  const res = await query(
    `SELECT * FROM dm_ab_tests WHERE id = $1 AND company_id = $2`,
    [id, companyId],
  );
  return res.rows[0] || null;
}

export async function getAbTestByShortCode(code: string): Promise<AbTestRecord | null> {
  const res = await query(
    `SELECT * FROM dm_ab_tests WHERE short_code = $1 AND status = 'running'`,
    [code],
  );
  return res.rows[0] || null;
}

export async function listAbTests(companyId: string): Promise<AbTestRecord[]> {
  const res = await query(
    `SELECT * FROM dm_ab_tests WHERE company_id = $1 ORDER BY created_at DESC LIMIT 100`,
    [companyId],
  );
  return res.rows as AbTestRecord[];
}

export async function updateAbTest(
  id: string,
  companyId: string,
  patch: Partial<AbTestInput>,
): Promise<AbTestRecord | null> {
  const current = await getAbTest(id, companyId);
  if (!current) return null;

  // running/completed 상태에서는 가중치/variant 변경 금지
  const frozenFields: (keyof AbTestInput)[] = [
    'variant_a_page_id',
    'variant_b_page_id',
    'variant_c_page_id',
    'variant_a_weight',
    'variant_b_weight',
    'variant_c_weight',
  ];
  if (current.status !== 'draft') {
    for (const f of frozenFields) {
      if (patch[f] !== undefined) {
        throw new Error('실행 중이거나 완료된 테스트는 variant/가중치를 수정할 수 없습니다.');
      }
    }
  }

  const sets: string[] = [];
  const params: any[] = [];
  let idx = 1;

  const setField = (col: string, val: any) => {
    sets.push(`${col} = $${idx++}`);
    params.push(val);
  };

  if (patch.name !== undefined) setField('name', patch.name);
  if (patch.description !== undefined) setField('description', patch.description);
  if (patch.variant_a_page_id !== undefined) setField('variant_a_page_id', patch.variant_a_page_id);
  if (patch.variant_b_page_id !== undefined) setField('variant_b_page_id', patch.variant_b_page_id);
  if (patch.variant_c_page_id !== undefined) setField('variant_c_page_id', patch.variant_c_page_id);
  if (patch.variant_a_weight !== undefined) setField('variant_a_weight', patch.variant_a_weight);
  if (patch.variant_b_weight !== undefined) setField('variant_b_weight', patch.variant_b_weight);
  if (patch.variant_c_weight !== undefined) setField('variant_c_weight', patch.variant_c_weight);
  if (patch.primary_metric !== undefined) setField('primary_metric', patch.primary_metric);

  if (sets.length === 0) return current;
  sets.push(`updated_at = NOW()`);
  params.push(id, companyId);

  const res = await query(
    `UPDATE dm_ab_tests SET ${sets.join(', ')} WHERE id = $${idx++} AND company_id = $${idx} RETURNING *`,
    params,
  );
  return res.rows[0] || null;
}

export async function deleteAbTest(id: string, companyId: string): Promise<boolean> {
  const res = await query(
    `DELETE FROM dm_ab_tests WHERE id = $1 AND company_id = $2`,
    [id, companyId],
  );
  return (res.rowCount ?? 0) > 0;
}

// ────────────── 상태 전환 ──────────────

async function ensureShortCode(id: string): Promise<string> {
  let attempts = 0;
  while (attempts < 10) {
    const code = generateShortCode();
    const dup = await query(
      `SELECT 1 FROM dm_ab_tests WHERE short_code = $1
       UNION ALL
       SELECT 1 FROM dm_pages WHERE short_code = $1`,
      [code],
    );
    if (dup.rows.length === 0) {
      await query(`UPDATE dm_ab_tests SET short_code = $1 WHERE id = $2`, [code, id]);
      return code;
    }
    attempts++;
  }
  throw new Error('short_code 발급 실패');
}

export async function startAbTest(id: string, companyId: string): Promise<AbTestRecord | null> {
  const current = await getAbTest(id, companyId);
  if (!current) return null;
  if (current.status === 'running') return current;

  if (!current.short_code) {
    await ensureShortCode(id);
  }
  const res = await query(
    `UPDATE dm_ab_tests
     SET status = 'running',
         started_at = COALESCE(started_at, NOW()),
         updated_at = NOW()
     WHERE id = $1 AND company_id = $2 RETURNING *`,
    [id, companyId],
  );
  return res.rows[0] || null;
}

export async function pauseAbTest(id: string, companyId: string): Promise<AbTestRecord | null> {
  const res = await query(
    `UPDATE dm_ab_tests SET status = 'paused', updated_at = NOW()
     WHERE id = $1 AND company_id = $2 AND status = 'running' RETURNING *`,
    [id, companyId],
  );
  return res.rows[0] || null;
}

export async function completeAbTest(id: string, companyId: string): Promise<AbTestRecord | null> {
  const summary = await aggregateResults(id, companyId);
  if (!summary) return null;

  const res = await query(
    `UPDATE dm_ab_tests
     SET status = 'completed',
         ended_at = NOW(),
         result_summary = $1,
         updated_at = NOW()
     WHERE id = $2 AND company_id = $3 RETURNING *`,
    [JSON.stringify(summary), id, companyId],
  );
  return res.rows[0] || null;
}

// ────────────── variant 선택 (가중치 랜덤) ──────────────

/**
 * 가중치 기반 variant 선택.
 * @param test AbTestRecord
 * @param existingVariant 쿠키에서 전달된 기존 variant (스티키)
 */
export function pickVariant(
  test: AbTestRecord,
  existingVariant?: AbVariantKey,
): AbVariantKey {
  if (existingVariant && (existingVariant === 'a' || existingVariant === 'b' || (existingVariant === 'c' && test.variant_c_page_id))) {
    return existingVariant;
  }
  const wA = Number(test.variant_a_weight) || 0;
  const wB = Number(test.variant_b_weight) || 0;
  const wC = test.variant_c_page_id ? Number(test.variant_c_weight) || 0 : 0;
  const total = wA + wB + wC;
  if (total <= 0) return 'a';

  const r = Math.random() * total;
  if (r < wA) return 'a';
  if (r < wA + wB) return 'b';
  return 'c';
}

/** variant 키 → dm_pages.id 매핑 */
export function variantToPageId(test: AbTestRecord, key: AbVariantKey): string | null {
  if (key === 'a') return test.variant_a_page_id;
  if (key === 'b') return test.variant_b_page_id;
  if (key === 'c') return test.variant_c_page_id;
  return null;
}

// ────────────── 성과 집계 ──────────────

/**
 * dm_views를 variant별로 GROUP BY 하여 집계.
 * 열람 추적 컬럼:
 *   - views: COUNT(*)
 *   - unique_phones: DISTINCT phone
 *   - avg_duration: AVG(duration_seconds)
 *   - completion_rate: page_reached == total_pages 비율
 *
 * click은 section_interactions JSONB에서 cta click 집계 (V2.1 확장)
 */
export async function aggregateResults(
  id: string,
  companyId: string,
): Promise<AbTestResult | null> {
  const test = await getAbTest(id, companyId);
  if (!test) return null;

  const res = await query(
    `SELECT
       ab_variant,
       COUNT(*)::int                                      AS views,
       COUNT(DISTINCT phone)::int                         AS unique_phones,
       COALESCE(AVG(duration_seconds), 0)::float          AS avg_duration_sec,
       CASE
         WHEN COUNT(*) = 0 THEN 0
         ELSE (COUNT(*) FILTER (WHERE total_pages > 0 AND page_reached >= total_pages))::float / COUNT(*)
       END                                                AS completion_rate,
       COALESCE(SUM(
         CASE WHEN section_interactions ? 'cta_click'
              THEN (section_interactions->>'cta_click')::int
              ELSE 0
         END
       ), 0)::int                                         AS clicks
     FROM dm_views
     WHERE ab_test_id = $1
     GROUP BY ab_variant`,
    [id],
  );

  const statsMap = new Map<string, any>();
  for (const row of res.rows) {
    statsMap.set(row.ab_variant, row);
  }

  const mk = (key: AbVariantKey, pageId: string): AbVariantStats => {
    const r = statsMap.get(key);
    return {
      variant: key,
      page_id: pageId,
      views: r?.views || 0,
      unique_phones: r?.unique_phones || 0,
      avg_duration_sec: r?.avg_duration_sec || 0,
      completion_rate: r?.completion_rate || 0,
      clicks: r?.clicks || 0,
    };
  };

  const variants: AbVariantStats[] = [mk('a', test.variant_a_page_id), mk('b', test.variant_b_page_id)];
  if (test.variant_c_page_id) variants.push(mk('c', test.variant_c_page_id));

  const totalViews = variants.reduce((s, v) => s + v.views, 0);

  // 승자 판정 — primary_metric 기준
  const pickScore = (v: AbVariantStats) => {
    switch (test.primary_metric) {
      case 'view': return v.views;
      case 'click': return v.clicks;
      case 'conversion': return v.clicks; // 현재는 clicks를 proxy로 사용
      case 'complete_rate': return v.completion_rate;
      default: return v.views;
    }
  };
  let winner: AbVariantKey | null = null;
  if (totalViews >= 10) {
    // 최소 10 view 이상일 때만 승자 판정
    const sorted = variants.slice().sort((x, y) => pickScore(y) - pickScore(x));
    if (pickScore(sorted[0]) > pickScore(sorted[1])) {
      winner = sorted[0].variant;
    }
  }

  return {
    test,
    variants,
    winner,
    total_views: totalViews,
  };
}

// ────────────── 뷰어에서 view 기록 ──────────────

/**
 * A/B 테스트용 뷰 기록.
 * (기존 trackDmView는 dm_id 단위이므로 ab_test_id 컬럼도 함께 채움)
 */
export async function trackAbTestView(
  abTestId: string,
  variant: AbVariantKey,
  dmPageId: string,
  companyId: string,
  phone: string | null,
  pageReached: number,
  totalPages: number,
  duration: number,
  ip: string | null,
  userAgent: string | null,
): Promise<void> {
  await query(
    `INSERT INTO dm_views (
       dm_id, company_id, phone, page_reached, total_pages,
       duration_seconds, ip, user_agent,
       ab_test_id, ab_variant
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      dmPageId,
      companyId,
      phone,
      pageReached,
      totalPages,
      duration,
      ip,
      userAgent,
      abTestId,
      variant,
    ],
  );
}
