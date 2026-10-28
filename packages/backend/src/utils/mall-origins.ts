/**
 * ★ CT: 몰 연동의 수집 허용 도메인(★ 2026-10-28 자사몰 대비 K12 · M28 · M20)
 *
 * 브라우저 SDK 수집은 companies.cdp_allowed_origins 에 있는 도메인에서만 열린다(cdp-auth requireCdpBrowserOrigin).
 * 1. registerMallAllowedOrigins = 그 연동 행이 넣은 값을 행 meta.auto_origins 에 적고 회사 목록에 더한다.
 *    회사 목록에 이미 있는 손 등록 값(어느 살아 있는 몰 행의 값도 아닌 것)은 그 행의 것으로 적지 않는다 → 해제가 그 값을 지우지 않는다.
 *    다른 몰 행과 같이 쓰는 값은 적는다(먼저 해제한 몰이 남은 몰의 값을 지우지 않게 · 해제는 남은 행의 값을 뺀 나머지만 지운다).
 *    ponytail: 몰이 넣은 뒤에 같은 값을 손으로 다시 넣으면(목록 변화 없음) 그 몰 해제 때 함께 빠진다 · 손 등록 표를 따로 두면 닫힌다.
 * 2. releaseMallAllowedOrigins = 해제 뒤 그 행이 넣은 값만 뺀다(다른 살아 있는 몰 행이 넣은 같은 값 · 손 등록은 그대로).
 *    그 행이 지금도 해제 상태일 때만(Codex R1 #8 · 해제 잠금을 놓은 뒤 같은 몰이 다시 연결됐으면 아무것도 안 함 · 등록 · 해제 = 같은 회사 행 잠금으로 줄 섬).
 * meta.auto_origins 를 쓰는 SQL = 이 파일 하나(R1). 넣는 값 = 몰 식별자로 만든 플랫폼 도메인 · 몰이 보낸(서명 검증된) 주소만.
 */
import { query } from '../config/database';

/** 몰 식별자 · 확인된 호스트 → 수집 허용 도메인(판정은 www. 만 떼므로 모바일 m. 은 따로 넣는다) */
export function mallPlatformOrigins(provider: string, host: string): string[] {
  const h = String(host || '').trim().toLowerCase();
  if (!h) return [];
  if (provider === 'cafe24') return [`https://${h}.cafe24.com`, `https://m.${h}.cafe24.com`];
  return [`https://${h}`, `https://www.${h}`, `https://m.${h}`];
}

export async function registerMallAllowedOrigins(companyId: string, provider: string, mallId: string, origins: string[]): Promise<void> {
  if (origins.length === 0) return;
  await query(
    `WITH cur AS (
       SELECT COALESCE(cdp_allowed_origins, '{}'::text[]) AS list FROM companies WHERE id = $1::uuid FOR UPDATE
     ), ir AS (
       SELECT id, COALESCE(meta->'auto_origins', '[]'::jsonb) AS mine FROM company_integrations
        WHERE company_id = $1::uuid AND provider = $2 AND mall_id = $3 AND status <> 'revoked' FOR UPDATE
     ), auto_all AS (
       SELECT x FROM company_integrations ci, jsonb_array_elements_text(COALESCE(ci.meta->'auto_origins', '[]'::jsonb)) x
        WHERE ci.company_id = $1::uuid AND ci.status <> 'revoked'
     ), added AS (
       -- 손 등록 = 회사 목록에 있는데 어느 살아 있는 몰 행의 값도 아닌 것 · 그것만 이 행의 것으로 적지 않는다(다른 몰과 같이 쓰는 값은 적는다)
       SELECT o FROM unnest($4::text[]) o WHERE NOT EXISTS (SELECT 1 FROM cur WHERE o = ANY (cur.list)) OR o IN (SELECT x FROM auto_all)
     ), upd AS (
       UPDATE company_integrations ci
          SET meta = COALESCE(ci.meta, '{}'::jsonb) || jsonb_build_object('auto_origins',
                (SELECT COALESCE(jsonb_agg(DISTINCT s.x), '[]'::jsonb)
                   FROM (SELECT jsonb_array_elements_text(ir.mine) AS x FROM ir UNION SELECT o FROM added) s))
         FROM ir WHERE ci.id = ir.id
       RETURNING ci.id
     )
     UPDATE companies
        SET cdp_allowed_origins = ARRAY(SELECT DISTINCT unnest((SELECT list FROM cur) || $4::text[])), updated_at = NOW()
      WHERE id = $1::uuid AND EXISTS (SELECT 1 FROM upd)`,
    [companyId, provider, mallId, origins],
  );
}

export async function releaseMallAllowedOrigins(companyId: string, provider: string, mallId: string): Promise<void> {
  await query(
    `WITH lock AS (
       SELECT 1 FROM companies WHERE id = $1::uuid FOR UPDATE
     ), ir AS (
       SELECT id, COALESCE(meta->'auto_origins', '[]'::jsonb) AS mine FROM company_integrations
        WHERE company_id = $1::uuid AND provider = $2 AND mall_id = $3 AND status = 'revoked' AND EXISTS (SELECT 1 FROM lock) FOR UPDATE
     ), others AS (
       SELECT x FROM company_integrations ci, jsonb_array_elements_text(COALESCE(ci.meta->'auto_origins', '[]'::jsonb)) x
        WHERE ci.company_id = $1::uuid AND ci.status <> 'revoked' AND ci.id NOT IN (SELECT id FROM ir)
     ), gone AS (
       SELECT jsonb_array_elements_text(mine) AS g FROM ir EXCEPT SELECT x FROM others
     ), clr AS (
       UPDATE company_integrations ci SET meta = ci.meta - 'auto_origins' FROM ir WHERE ci.id = ir.id RETURNING ci.id
     )
     UPDATE companies
        SET cdp_allowed_origins = ARRAY(SELECT o FROM unnest(COALESCE(cdp_allowed_origins, '{}'::text[])) o WHERE o NOT IN (SELECT g FROM gone)),
            updated_at = NOW()
      WHERE id = $1::uuid AND EXISTS (SELECT 1 FROM clr)`,
    [companyId, provider, mallId],
  );
}

/** 살아 있는 몰 연동 행이 넣은 수집 허용 도메인(화면이 「몰 연동이 넣은 값」으로 읽기 전용 표시 · 지우기 거절에 쓴다) */
export async function listMallAutoOrigins(companyId: string): Promise<string[]> {
  const r = await query(
    `SELECT DISTINCT x FROM company_integrations ci, jsonb_array_elements_text(COALESCE(ci.meta->'auto_origins', '[]'::jsonb)) x
      WHERE ci.company_id = $1::uuid AND ci.status <> 'revoked' ORDER BY x`,
    [companyId],
  );
  return r.rows.map((row: any) => String(row.x));
}
