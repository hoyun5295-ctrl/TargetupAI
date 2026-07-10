/**
 * dm-custom-short-link.ts — 고객사 자체 URL 단축(hlj.kr) DB 컨트롤타워 (2026-07-10 박성용 신기능, Harold 100크레딧 확정)
 *
 * 고객사가 자체 제작한 MDM 등 외부 URL을 hlj.kr/<code>로 단축 + 클릭 집계.
 * 서빙 = 기존 공개 라우트 GET /api/dm/v/s/:code의 3순위 조회(토큰 → 발행 페이지 → 커스텀) — nginx 무변경.
 * 검증(도메인 평판 보호)은 dm-custom-short-link-core.ts(순수)가 단일 진실.
 *
 * 테이블 = dm_custom_short_links (2026-07-10 신규 — DDL은 Harold 서버 실행, 미생성 시 라우트가 503 안내).
 */

import { query } from '../../config/database';
import { generateDmShortCode } from './dm-recipient-token';
import { CUSTOM_LINK_DAILY_LIMIT } from './dm-custom-short-link-core';

export interface CustomShortLink {
  id: string;
  code: string;
  targetUrl: string;
  title: string | null;
  isActive: boolean;
  clickCount: number;
  lastClickedAt: string | null;
  createdAt: string;
}

function mapRow(r: any): CustomShortLink {
  return {
    id: r.id,
    code: r.code,
    targetUrl: r.target_url,
    title: r.title || null,
    isActive: r.is_active !== false,
    clickCount: Number(r.click_count) || 0,
    lastClickedAt: r.last_clicked_at || null,
    createdAt: r.created_at,
  };
}

/**
 * 코드 발급 — 3축(수신자 토큰·발행 페이지·커스텀) 전부 미사용인 코드만 채택.
 * /s/:code 조회가 토큰 → 페이지 → 커스텀 순이라, 타 축과 겹치면 커스텀 링크가 영구히 가려진다.
 */
async function issueUniqueCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateDmShortCode();
    const dup = await query(
      `SELECT 1 FROM dm_recipient_tokens WHERE short_code = $1
       UNION ALL SELECT 1 FROM dm_pages WHERE short_code = $1
       UNION ALL SELECT 1 FROM dm_custom_short_links WHERE code = $1
       LIMIT 1`,
      [code],
    );
    if (dup.rows.length === 0) return code;
  }
  throw new Error('단축 코드 발급 실패 (충돌 5회) — 잠시 후 다시 시도해주세요.');
}

/**
 * 생성 — 일일 상한 판정을 INSERT와 같은 단문으로 결합(Codex 지적 정정: 선-카운트 후-INSERT의
 * TOCTOU 레이스 축소). 상한 초과 = null 반환(라우트가 429 — 크레딧 차감 전이라 과금 0).
 */
export async function createCustomShortLink(input: {
  companyId: string;
  userId: string | null;
  targetUrl: string;
  title: string | null;
}): Promise<CustomShortLink | null> {
  const code = await issueUniqueCode();
  const r = await query(
    `INSERT INTO dm_custom_short_links (company_id, created_by, code, target_url, title)
     SELECT $1::uuid, $2, $3, $4, $5
      WHERE (SELECT COUNT(*) FROM dm_custom_short_links
              WHERE company_id = $1::uuid
                AND created_at >= (NOW() AT TIME ZONE 'Asia/Seoul')::date AT TIME ZONE 'Asia/Seoul') < $6
     RETURNING id, code, target_url, title, is_active, click_count, last_clicked_at, created_at`,
    [input.companyId, input.userId || null, code, input.targetUrl, input.title, CUSTOM_LINK_DAILY_LIMIT],
  );
  if (r.rows.length === 0) return null;
  return mapRow(r.rows[0]);
}

/** 공개 리다이렉트 조회 — 활성 링크만. 미존재/비활성 = null(라우트가 홈 폴백). */
export async function lookupCustomShortLink(code: string): Promise<{ targetUrl: string; id: string } | null> {
  const r = await query(
    `SELECT id, target_url FROM dm_custom_short_links
      WHERE code = $1 AND is_active = true
      LIMIT 1`,
    [code],
  );
  if (r.rows.length === 0) return null;
  return { targetUrl: r.rows[0].target_url, id: r.rows[0].id };
}

/** 클릭 집계 — fire-and-forget 호출 전제(실패해도 리다이렉트 무영향) */
export async function recordCustomShortLinkClick(id: string): Promise<void> {
  await query(
    `UPDATE dm_custom_short_links
        SET click_count = click_count + 1, last_clicked_at = NOW()
      WHERE id = $1::uuid`,
    [id],
  );
}

/** 회사 목록 (최근 100건) */
export async function listCustomShortLinks(companyId: string): Promise<CustomShortLink[]> {
  const r = await query(
    `SELECT id, code, target_url, title, is_active, click_count, last_clicked_at, created_at
       FROM dm_custom_short_links
      WHERE company_id = $1::uuid
      ORDER BY created_at DESC
      LIMIT 100`,
    [companyId],
  );
  return r.rows.map(mapRow);
}

/** 활성/비활성 토글 — 회사 격리. 반환 = 갱신 후 행(미존재 null). */
export async function setCustomShortLinkActive(
  companyId: string,
  linkId: string,
  isActive: boolean,
): Promise<CustomShortLink | null> {
  const r = await query(
    `UPDATE dm_custom_short_links
        SET is_active = $3
      WHERE id = $1::uuid AND company_id = $2::uuid
      RETURNING id, code, target_url, title, is_active, click_count, last_clicked_at, created_at`,
    [linkId, companyId, isActive],
  );
  if (r.rows.length === 0) return null;
  return mapRow(r.rows[0]);
}
