/**
 * dm-builder.ts — 모바일 DM 빌더 컨트롤타워
 *
 * 한줄로 AI 프로 요금제 이상 기능.
 * CRUD + 단축URL 발행 + 열람 추적 + 통계 집계.
 */
import crypto from 'crypto';
import { query } from '../../config/database';
import { normalizeDmShortCode } from './dm-code';
import {
  clampPageReached, clampTotalPages, clampDurationDelta, clampScrollPct,
  sanitizeSectionInteractions, mergeSectionInteractions,
  type DmSectionInteractions,
} from './dm-tracking';

// ────────────────── 타입 ──────────────────

export interface DmPageInput {
  title: string;
  store_name?: string;
  // Legacy (D119 slides)
  header_template?: string;
  footer_template?: string;
  header_data?: Record<string, any>;
  footer_data?: Record<string, any>;
  /** D119 DmSlide[] 또는 D128 DmPageGroup[] (pages 컬럼 공유) */
  pages?: DmSlide[] | DmPageGroup[];
  settings?: Record<string, any>;
  // D125 section-based (하위호환 flat)
  layout_mode?: 'scroll' | 'slides' | 'scroll_snap';
  sections?: any[];
  brand_kit?: Record<string, any>;
  template_id?: string;
  ai_prompt?: string;
  approval_status?: 'draft' | 'review' | 'approved' | 'published' | 'rejected';
}

export interface DmSlide {
  order: number;
  type: 'image' | 'video' | 'mixed';
  imageUrl?: string;
  videoUrl?: string;
  videoType?: 'youtube' | 'direct';
  caption?: string;
}

/** D128 V4 — 페이지 계층 (페이지 안에 여러 섹션 조립) */
export interface DmPageGroup {
  id: string;
  name?: string;
  sections: any[];
}

/**
 * DM 저장된 구조(pages/sections)에서 전체 섹션을 flat 배열로 추출.
 * - pages가 D128 새 구조면 pages.flatMap(p => p.sections)
 * - 아니면 sections 필드 그대로
 * - 둘 다 없으면 []
 * 검수/AI 개선/테스트 발송 등 섹션 단위 작업에 사용.
 */
export function extractFlatSectionsFromDm(dm: any): any[] {
  let rawPages = dm?.pages;
  if (typeof rawPages === 'string') { try { rawPages = JSON.parse(rawPages); } catch { rawPages = null; } }
  if (Array.isArray(rawPages) && rawPages.length > 0 && rawPages[0] && Array.isArray(rawPages[0].sections)) {
    return rawPages.flatMap((p: any) => Array.isArray(p.sections) ? p.sections : []);
  }
  let rawSections = dm?.sections;
  if (typeof rawSections === 'string') { try { rawSections = JSON.parse(rawSections); } catch { rawSections = null; } }
  if (Array.isArray(rawSections)) return rawSections;
  return [];
}

// ★ 2026-07-03 DM 카드 창작 문안 추출 (문안 학습 코퍼스 ai_training_logs 적재용).
//   섹션 props에서 카피성 텍스트 필드만 재귀 수집 → 대표 문안 1건. URL·색·id·enum은 제외.
//   실패/빈 값이어도 throw 하지 않음(빈 문자열) — fire-and-forget 학습 적재 안전.
const DM_COPY_KEY = /head|title|body|text|caption|desc|label|message|content|copy|sub/i;
const DM_COPY_SKIP_KEY = /url|link|color|colour|_id|^id$|type|style|align|variant|icon|image|img|src|href|font|size|width|height/i;
export function extractDmCopyText(dm: any): string {
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (val: any, keyHint?: string): void => {
    if (val == null) return;
    if (typeof val === 'string') {
      const t = val.trim();
      if (
        keyHint && DM_COPY_KEY.test(keyHint) && !DM_COPY_SKIP_KEY.test(keyHint) &&
        t.length >= 2 && !/^https?:\/\//i.test(t) && !seen.has(t)
      ) {
        seen.add(t);
        out.push(t);
      }
      return;
    }
    if (Array.isArray(val)) { for (const v of val) walk(v, keyHint); return; }
    if (typeof val === 'object') { for (const k of Object.keys(val)) walk(val[k], k); return; }
  };
  try {
    for (const s of extractFlatSectionsFromDm(dm)) walk(s?.props, undefined);
  } catch { /* 빈 문자열 반환 */ }
  return out.join('\n').slice(0, 2000);
}

/**
 * DM에서 페이지 구조(DmPageGroup[]) 추출.
 * 없으면 sections를 단일 페이지로 감싸서 반환.
 */
export function extractPagesFromDm(dm: any): DmPageGroup[] {
  let rawPages = dm?.pages;
  if (typeof rawPages === 'string') { try { rawPages = JSON.parse(rawPages); } catch { rawPages = null; } }
  if (Array.isArray(rawPages) && rawPages.length > 0 && rawPages[0] && Array.isArray(rawPages[0].sections)) {
    return rawPages.map((p: any, i: number): DmPageGroup => ({
      id: p.id || `p-${i}`,
      name: p.name,
      sections: Array.isArray(p.sections) ? p.sections : [],
    }));
  }
  const flat = extractFlatSectionsFromDm(dm);
  if (flat.length > 0) return [{ id: 'p-legacy', sections: flat }];
  return [];
}

// ────────────────── CRUD ──────────────────

export async function createDm(companyId: string, userId: string, data: DmPageInput) {
  const layoutMode = data.layout_mode || (Array.isArray(data.sections) && data.sections.length > 0 ? 'scroll' : 'slides');
  const result = await query(
    `INSERT INTO dm_pages (
       company_id, created_by, title, store_name,
       header_template, footer_template, header_data, footer_data,
       pages, settings,
       layout_mode, sections, brand_kit, template_id, ai_prompt, approval_status
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     RETURNING *`,
    [
      companyId, userId, data.title, data.store_name || null,
      data.header_template || 'default', data.footer_template || 'default',
      JSON.stringify(data.header_data || {}), JSON.stringify(data.footer_data || {}),
      JSON.stringify(data.pages || []), JSON.stringify(data.settings || {}),
      layoutMode,
      data.sections ? JSON.stringify(data.sections) : null,
      data.brand_kit ? JSON.stringify(data.brand_kit) : null,
      data.template_id || null,
      data.ai_prompt || null,
      data.approval_status || 'draft',
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
  // D125
  if (data.layout_mode !== undefined) { sets.push(`layout_mode = $${idx++}`); params.push(data.layout_mode); }
  if (data.sections !== undefined) { sets.push(`sections = $${idx++}`); params.push(JSON.stringify(data.sections)); }
  if (data.brand_kit !== undefined) { sets.push(`brand_kit = $${idx++}`); params.push(JSON.stringify(data.brand_kit)); }
  if (data.template_id !== undefined) { sets.push(`template_id = $${idx++}`); params.push(data.template_id); }
  if (data.ai_prompt !== undefined) { sets.push(`ai_prompt = $${idx++}`); params.push(data.ai_prompt); }
  if (data.approval_status !== undefined) { sets.push(`approval_status = $${idx++}`); params.push(data.approval_status); }

  if (sets.length === 0) return null;

  sets.push(`updated_at = NOW()`);
  params.push(id, companyId);

  const result = await query(
    `UPDATE dm_pages SET ${sets.join(', ')} WHERE id = $${idx++} AND company_id = $${idx} RETURNING *`,
    params
  );
  return result.rows[0] || null;
}

// ────────────────── 버전 관리 (D125 §13) ──────────────────

export async function saveDmVersion(
  dmId: string,
  label: string,
  sections: any[],
  brandKit: any,
  note: string | null,
  userId: string,
): Promise<any> {
  const res = await query(
    `SELECT COALESCE(MAX(version_number), 0) + 1 AS next FROM dm_versions WHERE dm_id = $1`,
    [dmId],
  );
  const versionNumber = res.rows[0]?.next || 1;
  const ins = await query(
    `INSERT INTO dm_versions (dm_id, version_label, version_number, sections, brand_kit, note, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [dmId, label, versionNumber, JSON.stringify(sections), JSON.stringify(brandKit || {}), note, userId],
  );
  return ins.rows[0];
}

export async function listDmVersions(dmId: string, companyId: string): Promise<any[]> {
  // company_id 소속 확인
  const own = await query(`SELECT id FROM dm_pages WHERE id = $1 AND company_id = $2`, [dmId, companyId]);
  if (own.rows.length === 0) return [];
  const res = await query(
    `SELECT id, version_label, version_number, note, created_by, created_at,
            sections, brand_kit
     FROM dm_versions WHERE dm_id = $1 ORDER BY version_number DESC
     LIMIT 50`,
    [dmId],
  );
  return res.rows;
}

export async function restoreDmVersion(dmId: string, versionId: string, companyId: string): Promise<any | null> {
  const own = await query(`SELECT id FROM dm_pages WHERE id = $1 AND company_id = $2`, [dmId, companyId]);
  if (own.rows.length === 0) return null;
  const vRes = await query(`SELECT sections, brand_kit FROM dm_versions WHERE id = $1 AND dm_id = $2`, [versionId, dmId]);
  if (vRes.rows.length === 0) return null;
  const v = vRes.rows[0];
  const upd = await query(
    `UPDATE dm_pages SET sections = $1, brand_kit = $2, updated_at = NOW()
     WHERE id = $3 AND company_id = $4 RETURNING *`,
    [v.sections, v.brand_kit, dmId, companyId],
  );
  return upd.rows[0] || null;
}

// ────────────────── 승인 플로우 (D125 §13-3) ──────────────────

export async function setApprovalStatus(
  dmId: string,
  companyId: string,
  status: 'draft' | 'review' | 'approved' | 'published' | 'rejected',
): Promise<any | null> {
  const res = await query(
    `UPDATE dm_pages SET approval_status = $1, updated_at = NOW()
     WHERE id = $2 AND company_id = $3 RETURNING *`,
    [status, dmId, companyId],
  );
  return res.rows[0] || null;
}

export async function deleteDm(id: string, companyId: string) {
  // dm_views ON DELETE CASCADE로 자동 삭제
  const result = await query(
    `DELETE FROM dm_pages WHERE id = $1 AND company_id = $2 RETURNING id`,
    [id, companyId]
  );
  return (result.rowCount ?? 0) > 0;
}

/** 목록 카드 폰목업 썸네일용 경량 요약 (sections 원본은 응답에 싣지 않음) */
export interface DmSectionSummary {
  types: string[];        // visible 섹션 type (order순, 최대 6)
  headline: string | null;
  accent: string | null;  // brand_kit primary_color
  count: number;          // 전체 섹션(또는 legacy 슬라이드) 수
}

const SECTION_SUMMARY_MAX_TYPES = 6;

/**
 * dm_pages 한 행(sections/pages/brand_kit) → 썸네일 요약. 순수(DB/AI 의존 0) — verify 스크립트 대상.
 * sections(D125) 우선, 없으면 legacy pages 길이만 count.
 */
export function buildSectionSummary(row: { sections?: any; pages?: any; brand_kit?: any }): DmSectionSummary {
  const bk = row.brand_kit && typeof row.brand_kit === 'object' ? row.brand_kit : null;
  const accent = bk && bk.primary_color ? String(bk.primary_color) : null;

  const sections = Array.isArray(row.sections) ? row.sections : null;
  if (sections && sections.length > 0) {
    const visible = sections
      .filter((s: any) => s && s.type && s.visible !== false)
      .sort((a: any, b: any) => (Number(a.order) || 0) - (Number(b.order) || 0));
    const types = visible.slice(0, SECTION_SUMMARY_MAX_TYPES).map((s: any) => String(s.type));
    let headline: string | null = null;
    for (const s of visible) {
      const p = (s && s.props) || {};
      const cand = p.headline || p.brand_name || p.body || p.title || null;
      if (cand && String(cand).trim()) { headline = String(cand).trim().slice(0, 60); break; }
    }
    return { types, headline, accent, count: visible.length };
  }

  const pages = Array.isArray(row.pages) ? row.pages : null;
  return { types: [], headline: null, accent, count: pages ? pages.length : 0 };
}

export async function getDmList(companyId: string) {
  // raw pages는 전송하지 않음 — 길이만 page_count로 SQL 집계(jsonb_array_length). sections/brand_kit만 요약 계산에 사용.
  // ★ 2026-07-02(3) has_send_history = 타겟 발송 이력 여부(dm_recipient_tokens EXISTS) — 카드 [발송 추적] 노출 판단.
  //   토큰 테이블 미마이그레이션(구 환경)이어도 목록이 죽지 않게 폴백.
  let result;
  try {
    result = await query(
      `SELECT id, title, store_name, status, approval_status, layout_mode,
              short_code, view_count, sections, brand_kit,
              COALESCE(jsonb_array_length(pages), 0) as page_count,
              EXISTS (SELECT 1 FROM dm_recipient_tokens t WHERE t.dm_id = dm_pages.id) AS has_send_history,
              created_at, updated_at
       FROM dm_pages WHERE company_id = $1
       ORDER BY updated_at DESC`,
      [companyId]
    );
  } catch (e: any) {
    const msg = e?.message || '';
    if (!(msg.includes('relation') && msg.includes('does not exist'))) throw e;
    result = await query(
      `SELECT id, title, store_name, status, approval_status, layout_mode,
              short_code, view_count, sections, brand_kit,
              COALESCE(jsonb_array_length(pages), 0) as page_count,
              false AS has_send_history,
              created_at, updated_at
       FROM dm_pages WHERE company_id = $1
       ORDER BY updated_at DESC`,
      [companyId]
    );
  }
  // sections/brand_kit 원본은 요약으로 압축해 응답에서 제거(목록 payload 경량)
  return result.rows.map((row: any) => {
    const summary = buildSectionSummary(row);
    // legacy(슬라이드) DM은 sections가 없어 summary.count=0 → SQL 집계한 page_count로 보정
    if (summary.types.length === 0 && summary.count === 0) {
      summary.count = Number(row.page_count) || 0;
    }
    return {
      id: row.id,
      title: row.title,
      store_name: row.store_name,
      status: row.status,
      approval_status: row.approval_status,
      layout_mode: row.layout_mode,
      short_code: row.short_code,
      view_count: row.view_count,
      page_count: row.page_count,
      has_send_history: !!row.has_send_history,
      section_summary: summary,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  });
}

/**
 * DM 복제 — 콘텐츠 컬럼 INSERT...SELECT 복사 + 상태 초기화(draft / 단축URL·조회수 reset). 회사 격리.
 * AI 호출 0 = 크레딧 차감 없음.
 */
export async function cloneDm(id: string, companyId: string, userId: string) {
  const result = await query(
    `INSERT INTO dm_pages (
       company_id, created_by, title, store_name,
       header_template, footer_template, header_data, footer_data,
       pages, settings, layout_mode, sections, brand_kit, template_id, ai_prompt,
       event_type, personalization_strategy, quick_start_scenario,
       status, approval_status, short_code, view_count
     )
     SELECT
       company_id, $3, LEFT(COALESCE(NULLIF(title, ''), '제목 없음') || ' 사본', 200), store_name,
       header_template, footer_template, header_data, footer_data,
       pages, settings, layout_mode, sections, brand_kit, template_id, ai_prompt,
       event_type, personalization_strategy, quick_start_scenario,
       'draft', 'draft', NULL, 0
     FROM dm_pages
     WHERE id = $1 AND company_id = $2
     RETURNING *`,
    [id, companyId, userId]
  );
  return result.rows[0] || null;
}

export async function getDmDetail(id: string, companyId: string) {
  const result = await query(
    `SELECT * FROM dm_pages WHERE id = $1 AND company_id = $2`,
    [id, companyId]
  );
  return result.rows[0] || null;
}

export async function getDmByCode(code: string) {
  // ★ 2026-06-22: 공개 URL이 dm-{short_code} 형식이라 선두 "dm-" 제거 후 조회 (저장 short_code는 접두사 없음).
  const result = await query(
    `SELECT * FROM dm_pages WHERE short_code = $1 AND status = 'published'`,
    [normalizeDmShortCode(code)]
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

/**
 * 2026-07-02 수신자별 추적 근본 수정 — 뷰어 비콘 입력.
 * duration/section은 직전 비콘 이후 "증가분"만 담아 서버가 합산 병합한다.
 * 신규 컬럼(recipient_token/anonymous_id/max_scroll_pct) 미마이그레이션 시 PG 에러 그대로 throw →
 * 라우트가 isDbMigrationPendingError로 503 변환(db_alter_safety_net).
 */
export interface DmViewTrackInput {
  dmId: string;
  companyId: string;
  /** 서버가 토큰으로 확정한 고객 phone (클라 phone 불신뢰) — 구 ?p= 링크 하위호환용으로만 클라 값 허용 */
  phone?: string | null;
  /** 발송 링크 수신자 토큰 (추적 1급 키) */
  recipientToken?: string | null;
  /** 뷰어 localStorage 익명 ID (토큰·phone 없을 때 행 중복 방지 키) */
  anonymousId?: string | null;
  pageReached?: number;
  totalPages?: number;
  /** 직전 비콘 이후 체류 증가분(초) */
  durationDelta?: number;
  /** 스크롤 최대 도달 %(0~100) — 미측정 null */
  maxScrollPct?: number | null;
  /** 섹션별 노출/클릭 증가분 */
  sectionDelta?: DmSectionInteractions | null;
  /** 뷰어 진입 비콘 여부 — 신규 행 또는 재방문 시 view_count +1 */
  isInit?: boolean;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * ★ 2026-07-02(5) 수신자별 발송·열람 원시 행 — CT 단일 진입.
 * 소비처: dm.ts recipients-tracking(목록) / recipient-detail(1명) / ai-memory-accumulator-worker(DM 학습).
 * customerId 전달 시 그 수신자 1명만 반환.
 */
export async function getDmRecipientEngagementRows(dmId: string, companyId: string, customerId?: string) {
  const r = await query(
    `SELECT DISTINCT ON (t.customer_id)
            t.customer_id, c.name, c.phone, t.created_at AS sent_at,
            v.page_reached, v.total_pages, v.duration_seconds, v.max_scroll_pct,
            v.section_interactions, v.viewed_at, v.last_active_at,
            v.open_count, v.seen_anon_ids,
            EXISTS (SELECT 1 FROM dm_event_responses er WHERE er.campaign_id = t.dm_id AND er.customer_id = t.customer_id) AS responded
       FROM dm_recipient_tokens t
       JOIN customers c ON c.id = t.customer_id AND c.company_id = t.company_id
       LEFT JOIN LATERAL (
         SELECT dv.page_reached, dv.total_pages, dv.duration_seconds, dv.max_scroll_pct,
                dv.section_interactions, dv.viewed_at, dv.last_active_at,
                dv.open_count, dv.seen_anon_ids
           FROM dm_views dv
          WHERE dv.dm_id = t.dm_id
            AND (dv.recipient_token = t.token OR (dv.phone IS NOT NULL AND dv.phone = c.phone))
          ORDER BY dv.viewed_at DESC LIMIT 1
       ) v ON true
      WHERE t.dm_id = $1::uuid AND t.company_id = $2::uuid
        AND ($3::uuid IS NULL OR t.customer_id = $3::uuid)
      ORDER BY t.customer_id, t.created_at DESC
      LIMIT 1000`,
    [dmId, companyId, customerId || null],
  );
  return r.rows;
}

export async function trackDmView(input: DmViewTrackInput) {
  const { dmId, companyId } = input;
  const pageReached = clampPageReached(input.pageReached);
  const totalPages = clampTotalPages(input.totalPages);
  const durationDelta = clampDurationDelta(input.durationDelta);
  const maxScrollPct = clampScrollPct(input.maxScrollPct);
  const sectionDelta = sanitizeSectionInteractions(input.sectionDelta);
  const hasSectionDelta = Object.keys(sectionDelta).length > 0;
  const token = input.recipientToken ? String(input.recipientToken).slice(0, 32) : null;
  const phone = input.phone ? String(input.phone).slice(0, 20) : null;
  const anonymousId = input.anonymousId ? String(input.anonymousId).slice(0, 100) : null;

  // UPSERT 키 우선순위: 토큰 > phone > 익명ID (같은 사람 = 같은 행에 누적, 열람 1회 = 1행)
  let existing: { id: string; section_interactions: any } | null = null;
  if (token) {
    const r = await query(
      `SELECT id, section_interactions FROM dm_views WHERE dm_id = $1 AND recipient_token = $2 ORDER BY viewed_at DESC LIMIT 1`,
      [dmId, token],
    );
    existing = r.rows[0] || null;
  }
  if (!existing && phone) {
    const r = await query(
      `SELECT id, section_interactions FROM dm_views WHERE dm_id = $1 AND phone = $2 ORDER BY viewed_at DESC LIMIT 1`,
      [dmId, phone],
    );
    existing = r.rows[0] || null;
  }
  if (!existing && !token && !phone && anonymousId) {
    const r = await query(
      `SELECT id, section_interactions FROM dm_views WHERE dm_id = $1 AND anonymous_id = $2 ORDER BY viewed_at DESC LIMIT 1`,
      [dmId, anonymousId],
    );
    existing = r.rows[0] || null;
  }

  if (existing) {
    const merged = hasSectionDelta ? mergeSectionInteractions(existing.section_interactions, sectionDelta) : null;
    await query(
      `UPDATE dm_views SET
         page_reached = GREATEST(page_reached, $1),
         total_pages = GREATEST(total_pages, $2),
         duration_seconds = duration_seconds + $3,
         max_scroll_pct = CASE WHEN $4::int IS NULL THEN max_scroll_pct ELSE GREATEST(COALESCE(max_scroll_pct, 0), $4::int) END,
         section_interactions = COALESCE($5::jsonb, section_interactions),
         recipient_token = COALESCE(recipient_token, $6),
         phone = COALESCE(phone, $7),
         anonymous_id = COALESCE(anonymous_id, $8),
         last_active_at = NOW()
       WHERE id = $9`,
      [pageReached, totalPages, durationDelta, maxScrollPct, merged ? JSON.stringify(merged) : null, token, phone, anonymousId, existing.id],
    );
    // 재방문(진입 비콘)만 조회수 +1 — 하트비트/이탈 비콘은 미증가
    if (input.isInit) {
      await query(`UPDATE dm_pages SET view_count = view_count + 1 WHERE id = $1`, [dmId]);
    }
    // ★ 2026-07-06 재열람·기기(공유) 신호 — 별도 UPDATE + 격리(신규 컬럼 미마이그레이션이어도 본 추적은 무결).
    //   open_count: 진입 비콘마다 +1(재열람 횟수). seen_anon_ids: 새 익명ID만 append(최대 20 — 공유 기기 수).
    if (input.isInit || anonymousId) {
      try {
        await query(
          `UPDATE dm_views SET
             open_count = open_count + $1,
             seen_anon_ids = CASE
               WHEN $2::text IS NULL THEN seen_anon_ids
               WHEN seen_anon_ids IS NULL THEN jsonb_build_array($2::text)
               WHEN NOT (seen_anon_ids @> to_jsonb($2::text)) AND jsonb_array_length(seen_anon_ids) < 20
                 THEN seen_anon_ids || to_jsonb($2::text)
               ELSE seen_anon_ids
             END
           WHERE id = $3`,
          [input.isInit ? 1 : 0, anonymousId, existing.id],
        );
      } catch (e: any) {
        // 컬럼 미존재(ALTER 전) = 조용히 skip — 기존 추적 무결
        if (!String(e?.message || '').includes('does not exist')) console.warn('[trackDmView] 재열람 신호 기록 실패:', e?.message);
      }
    }
  } else {
    await query(
      `INSERT INTO dm_views (dm_id, company_id, phone, recipient_token, anonymous_id, page_reached, total_pages, duration_seconds, max_scroll_pct, section_interactions, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        dmId, companyId, phone, token, anonymousId, pageReached, totalPages, durationDelta, maxScrollPct,
        hasSectionDelta ? JSON.stringify(sectionDelta) : null, input.ip || null, input.userAgent || null,
      ],
    );
    await query(`UPDATE dm_pages SET view_count = view_count + 1 WHERE id = $1`, [dmId]);
    // ★ 2026-07-06 첫 열람 행에 첫 기기 기록 (open_count는 DEFAULT 1) — 격리, 실패해도 본 추적 무결
    if (anonymousId) {
      try {
        await query(
          `UPDATE dm_views SET seen_anon_ids = jsonb_build_array($1::text)
           WHERE dm_id = $2 AND company_id = $3 AND seen_anon_ids IS NULL
             AND ((recipient_token IS NOT NULL AND recipient_token = $4) OR (recipient_token IS NULL AND anonymous_id = $1))`,
          [anonymousId, dmId, companyId, token],
        );
      } catch (e: any) {
        if (!String(e?.message || '').includes('does not exist')) console.warn('[trackDmView] 첫 기기 기록 실패:', e?.message);
      }
    }
  }
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
