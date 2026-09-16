/**
 * dm-custom-short-link.ts — 고객사 자체 URL 단축(hlj.kr) DB 컨트롤타워 (2026-07-10 박성용 신기능)
 *   단가는 여기 적지 않는다 — 원장은 `ai-credit-calc.ts` CREDIT_COST_MAP 하나다(주석에 값을 복사하면 그것이 먼저 낡는다).
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
  throw new Error('단축 코드 발급 실패 (충돌 5회). 잠시 후 다시 시도해주세요.');
}

/** 지정 slug가 이미 쓰인 코드였다 — 라우트가 409로 옮긴다(크레딧 차감 전이라 과금 0). */
export class ShortLinkSlugTakenError extends Error {
  constructor(public readonly slug: string) {
    super('이미 사용 중인 주소입니다. 다른 문구를 입력해주세요.');
    this.name = 'ShortLinkSlugTakenError';
  }
}

/**
 * 생성 — 일일 상한 판정을 INSERT와 같은 단문으로 결합(Codex 지적 정정: 선-카운트 후-INSERT의
 * TOCTOU 레이스 축소). 상한 초과 = null 반환(라우트가 429 — 크레딧 차감 전이라 과금 0).
 *
 * ★ 2026-09-16 `slug` 선택 인자(박성용 접수 — "난수 말고 한글 주소도"). 주면 그 문구가 코드가 되고,
 *   없으면 종전 난수다. **검증은 호출부가 `validateCustomSlug`로 끝낸 값만 넘긴다**(NFC·길이·문자·예약어).
 *   그 규칙은 발행 DM 별칭과 같은 함수를 쓴다 — 두 입구가 다른 규칙을 갖게 두지 않는다.
 *   선점 판정은 `isSlugAvailable`(3축)이고, 그 사이 경합은 `dm_custom_short_links_code_key`(UNIQUE)가
 *   막아 23505로 떨어진다. 둘 다 `ShortLinkSlugTakenError`로 모아 호출부가 한 가지만 처리하게 한다.
 */
export async function createCustomShortLink(input: {
  companyId: string;
  userId: string | null;
  targetUrl: string;
  title: string | null;
  /** 사용자 지정 주소 — `validateCustomSlug` 통과값(NFC). 미지정이면 난수 발급 */
  slug?: string | null;
}): Promise<CustomShortLink | null> {
  const wanted = String(input.slug || '').trim();
  if (wanted && !(await isSlugAvailable(wanted, null))) throw new ShortLinkSlugTakenError(wanted);
  const code = wanted || await issueUniqueCode();
  let r;
  try {
    r = await query(
      `INSERT INTO dm_custom_short_links (company_id, created_by, code, target_url, title)
       SELECT $1::uuid, $2, $3, $4, $5
        WHERE (SELECT COUNT(*) FROM dm_custom_short_links
                WHERE company_id = $1::uuid
                  AND created_at >= (NOW() AT TIME ZONE 'Asia/Seoul')::date AT TIME ZONE 'Asia/Seoul') < $6
       RETURNING id, code, target_url, title, is_active, click_count, last_clicked_at, created_at`,
      [input.companyId, input.userId || null, code, input.targetUrl, input.title, CUSTOM_LINK_DAILY_LIMIT],
    );
  } catch (err: any) {
    // ★ 2026-09-16 UNIQUE(code) 위반 = 위 조회와 INSERT 사이에 누가 같은 주소를 먼저 가져갔다.
    //   지정 주소에서만 일어난다(난수는 3축 미사용 코드를 고른다). 선점과 같은 결과이므로 같은 예외로 모은다.
    if (String(err?.code) === '23505' && wanted) throw new ShortLinkSlugTakenError(wanted);
    throw err;
  }
  if (r.rows.length === 0) return null;
  return mapRow(r.rows[0]);
}

/** 공개 리다이렉트 조회 — 활성 링크만. 미존재/비활성 = null(라우트가 홈 폴백).
 *  ★ 2026-07-15 NFC 정규화 — 한글 slug(iOS 자소 분리 NFD 유입 대비). 쓰기(validateCustomSlug)와 동일 규칙. */
export async function lookupCustomShortLink(code: string): Promise<{ targetUrl: string; id: string } | null> {
  const c = String(code || '').trim().normalize('NFC');
  if (!c) return null;
  const r = await query(
    `SELECT id, target_url FROM dm_custom_short_links
      WHERE code = $1 AND is_active = true
      LIMIT 1`,
    [c],
  );
  if (r.rows.length === 0) return null;
  return { targetUrl: r.rows[0].target_url, id: r.rows[0].id };
}

// ════════════════════════════════════════════════════════════
// ★ 2026-07-15 발행 DM 한글 주소 별칭 (Harold 확정 — 이새 vo.la 사례)
//   기존 커스텀 단축 테이블 재사용 + dm_page_id 연결(DM당 1개 — 부분 UNIQUE 인덱스).
//   무료(발행비 기수령·남용 표면 작음) — 과금되는 외부 URL 단축과 별개 경로.
//   컬럼 dm_page_id 미마이그레이션 = 호출부(라우트)가 503 안내(db_alter_safety_net).
// ════════════════════════════════════════════════════════════

export interface DmAliasLink {
  id: string;
  code: string;
  targetUrl: string;
  clickCount: number;
  lastClickedAt: string | null;
  createdAt: string;
}

function mapAliasRow(r: any): DmAliasLink {
  return {
    id: r.id,
    code: r.code,
    targetUrl: r.target_url,
    clickCount: Number(r.click_count) || 0,
    lastClickedAt: r.last_clicked_at || null,
    createdAt: r.created_at,
  };
}

/** slug가 3축(수신자 토큰·발행 페이지·커스텀) 어디에도 없는지 — 지정 slug용 충돌 검사.
 *  excludeDmPageId = 자기 DM의 기존 별칭 행은 충돌에서 제외(별칭 변경 허용). */
export async function isSlugAvailable(slug: string, excludeDmPageId?: string | null): Promise<boolean> {
  const dup = await query(
    `SELECT 1 FROM dm_recipient_tokens WHERE short_code = $1
     UNION ALL SELECT 1 FROM dm_pages WHERE short_code = $1
     UNION ALL SELECT 1 FROM dm_custom_short_links WHERE code = $1 AND ($2::uuid IS NULL OR dm_page_id IS DISTINCT FROM $2::uuid)
     LIMIT 1`,
    [slug, excludeDmPageId || null],
  );
  return dup.rows.length === 0;
}

/** DM의 현재 한글 주소 별칭 조회 (없으면 null) */
export async function getDmAliasLink(dmPageId: string, companyId: string): Promise<DmAliasLink | null> {
  const r = await query(
    `SELECT id, code, target_url, click_count, last_clicked_at, created_at
       FROM dm_custom_short_links
      WHERE dm_page_id = $1::uuid AND company_id = $2::uuid
      LIMIT 1`,
    [dmPageId, companyId],
  );
  if (r.rows.length === 0) return null;
  return mapAliasRow(r.rows[0]);
}

/**
 * 별칭 생성/변경 — DM당 1행 유지(있으면 code·target UPDATE = 클릭 집계 연속).
 * slug는 validateCustomSlug 통과값(NFC) 전제. 반환 null = slug 선점(충돌).
 */
export async function upsertDmAliasLink(input: {
  companyId: string;
  userId: string | null;
  dmPageId: string;
  slug: string;
  targetUrl: string;
  title: string | null;
}): Promise<DmAliasLink | null> {
  if (!(await isSlugAvailable(input.slug, input.dmPageId))) return null;
  const existing = await getDmAliasLink(input.dmPageId, input.companyId);
  if (existing) {
    const r = await query(
      `UPDATE dm_custom_short_links
          SET code = $3, target_url = $4, title = $5, is_active = true
        WHERE id = $1::uuid AND company_id = $2::uuid
        RETURNING id, code, target_url, click_count, last_clicked_at, created_at`,
      [existing.id, input.companyId, input.slug, input.targetUrl, input.title],
    );
    return r.rows.length > 0 ? mapAliasRow(r.rows[0]) : null;
  }
  const r = await query(
    `INSERT INTO dm_custom_short_links (company_id, created_by, code, target_url, title, dm_page_id)
     VALUES ($1::uuid, $2, $3, $4, $5, $6::uuid)
     RETURNING id, code, target_url, click_count, last_clicked_at, created_at`,
    [input.companyId, input.userId || null, input.slug, input.targetUrl, input.title, input.dmPageId],
  );
  return mapAliasRow(r.rows[0]);
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
