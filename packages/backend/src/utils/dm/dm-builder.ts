/**
 * dm-builder.ts — 모바일 DM 빌더 컨트롤타워
 *
 * 한줄로 AI 프로 요금제 이상 기능.
 * CRUD + 단축URL 발행 + 열람 추적 + 통계 집계.
 */
import crypto from 'crypto';
import { query } from '../../config/database';

// ────────────────── 타입 ──────────────────

export interface DmPageInput {
  title: string;
  store_name?: string;
  header_template?: string;
  footer_template?: string;
  header_data?: Record<string, any>;
  footer_data?: Record<string, any>;
  pages: DmSlide[];
  settings?: Record<string, any>;
}

export interface DmSlide {
  order: number;
  type: 'image' | 'video' | 'mixed';
  imageUrl?: string;
  videoUrl?: string;
  videoType?: 'youtube' | 'direct';
  caption?: string;
}

// ────────────────── CRUD ──────────────────

export async function createDm(companyId: string, userId: string, data: DmPageInput) {
  const result = await query(
    `INSERT INTO dm_pages (company_id, created_by, title, store_name, header_template, footer_template, header_data, footer_data, pages, settings)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      companyId, userId, data.title, data.store_name || null,
      data.header_template || 'default', data.footer_template || 'default',
      JSON.stringify(data.header_data || {}), JSON.stringify(data.footer_data || {}),
      JSON.stringify(data.pages || []), JSON.stringify(data.settings || {}),
    ]
  );
  return result.rows[0];
}

export async function updateDm(id: string, companyId: string, data: Partial<DmPageInput>) {
  const sets: string[] = [];
  const params: any[] = [];
  let idx = 1;

  if (data.title !== undefined) { sets.push(`title = $${idx++}`); params.push(data.title); }
  if (data.store_name !== undefined) { sets.push(`store_name = $${idx++}`); params.push(data.store_name); }
  if (data.header_template !== undefined) { sets.push(`header_template = $${idx++}`); params.push(data.header_template); }
  if (data.footer_template !== undefined) { sets.push(`footer_template = $${idx++}`); params.push(data.footer_template); }
  if (data.header_data !== undefined) { sets.push(`header_data = $${idx++}`); params.push(JSON.stringify(data.header_data)); }
  if (data.footer_data !== undefined) { sets.push(`footer_data = $${idx++}`); params.push(JSON.stringify(data.footer_data)); }
  if (data.pages !== undefined) { sets.push(`pages = $${idx++}`); params.push(JSON.stringify(data.pages)); }
  if (data.settings !== undefined) { sets.push(`settings = $${idx++}`); params.push(JSON.stringify(data.settings)); }

  if (sets.length === 0) return null;

  sets.push(`updated_at = NOW()`);
  params.push(id, companyId);

  const result = await query(
    `UPDATE dm_pages SET ${sets.join(', ')} WHERE id = $${idx++} AND company_id = $${idx} RETURNING *`,
    params
  );
  return result.rows[0] || null;
}

export async function deleteDm(id: string, companyId: string) {
  // dm_views ON DELETE CASCADE로 자동 삭제
  const result = await query(
    `DELETE FROM dm_pages WHERE id = $1 AND company_id = $2 RETURNING id`,
    [id, companyId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function getDmList(companyId: string) {
  const result = await query(
    `SELECT id, title, store_name, status, short_code, view_count,
            COALESCE(jsonb_array_length(pages), 0) as page_count,
            created_at, updated_at
     FROM dm_pages WHERE company_id = $1
     ORDER BY updated_at DESC`,
    [companyId]
  );
  return result.rows;
}

export async function getDmDetail(id: string, companyId: string) {
  const result = await query(
    `SELECT * FROM dm_pages WHERE id = $1 AND company_id = $2`,
    [id, companyId]
  );
  return result.rows[0] || null;
}

export async function getDmByCode(code: string) {
  const result = await query(
    `SELECT * FROM dm_pages WHERE short_code = $1 AND status = 'published'`,
    [code]
  );
  return result.rows[0] || null;
}

// ────────────────── 단축URL 발행 ──────────────────

function generateShortCode(length = 7): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

export async function publishDm(id: string, companyId: string) {
  // 기존 short_code 확인
  const existing = await query(
    `SELECT short_code FROM dm_pages WHERE id = $1 AND company_id = $2`,
    [id, companyId]
  );
  if (!existing.rows[0]) return null;
  if (existing.rows[0].short_code) {
    return { short_code: existing.rows[0].short_code };
  }

  // 새 코드 생성 (충돌 시 재시도)
  let code: string = '';
  let attempts = 0;
  do {
    code = generateShortCode();
    const dup = await query(`SELECT id FROM dm_pages WHERE short_code = $1`, [code]);
    if (dup.rows.length === 0) break;
    attempts++;
  } while (attempts < 10);

  const result = await query(
    `UPDATE dm_pages SET short_code = $1, status = 'published', updated_at = NOW()
     WHERE id = $2 AND company_id = $3 RETURNING short_code`,
    [code, id, companyId]
  );
  return result.rows[0] || null;
}

// ────────────────── 열람 추적 ──────────────────

export async function trackDmView(
  dmId: string, companyId: string, phone: string | null,
  pageReached: number, totalPages: number, duration: number,
  ip: string | null, userAgent: string | null
) {
  if (phone) {
    // 같은 phone + dm_id 조합이면 page_reached/duration 갱신 (UPSERT)
    const existing = await query(
      `SELECT id, page_reached FROM dm_views WHERE dm_id = $1 AND phone = $2 ORDER BY viewed_at DESC LIMIT 1`,
      [dmId, phone]
    );
    if (existing.rows[0]) {
      const newReached = Math.max(existing.rows[0].page_reached, pageReached);
      await query(
        `UPDATE dm_views SET page_reached = $1, duration_seconds = duration_seconds + $2, last_active_at = NOW()
         WHERE id = $3`,
        [newReached, Math.max(0, duration), existing.rows[0].id]
      );
    } else {
      await query(
        `INSERT INTO dm_views (dm_id, company_id, phone, page_reached, total_pages, duration_seconds, ip, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [dmId, companyId, phone, pageReached, totalPages, duration, ip, userAgent]
      );
    }
  } else {
    // phone 없으면 익명 조회수만 카운트
    await query(
      `INSERT INTO dm_views (dm_id, company_id, phone, page_reached, total_pages, ip, user_agent)
       VALUES ($1, $2, NULL, $3, $4, $5, $6)`,
      [dmId, companyId, pageReached, totalPages, ip, userAgent]
    );
  }
  // 총 조회수 증가
  await query(`UPDATE dm_pages SET view_count = view_count + 1 WHERE id = $1`, [dmId]);
}

// ────────────────── 통계 ──────────────────

export async function getDmStats(id: string, companyId: string) {
  // 전체 요약
  const summary = await query(
    `SELECT COUNT(*) as total_views,
            COUNT(DISTINCT phone) FILTER (WHERE phone IS NOT NULL) as unique_viewers,
            AVG(page_reached)::numeric(5,1) as avg_page_reached,
            AVG(duration_seconds)::numeric(10,0) as avg_duration,
            COUNT(*) FILTER (WHERE page_reached >= total_pages AND total_pages > 0) as completed_views
     FROM dm_views WHERE dm_id = $1 AND company_id = $2`,
    [id, companyId]
  );

  // 전화번호별 상세
  const byPhone = await query(
    `SELECT phone, MAX(page_reached) as max_page, MAX(total_pages) as total_pages,
            SUM(duration_seconds) as total_duration, MIN(viewed_at) as first_view, MAX(last_active_at) as last_view
     FROM dm_views WHERE dm_id = $1 AND company_id = $2 AND phone IS NOT NULL
     GROUP BY phone ORDER BY first_view DESC LIMIT 200`,
    [id, companyId]
  );

  return {
    summary: summary.rows[0],
    viewers: byPhone.rows,
  };
}
