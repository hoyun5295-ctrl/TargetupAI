/**
 * sync-releases.ts — 싱크 에이전트 원격 업데이트 릴리스 고르기 · 등록 컨트롤타워(★ 2026-11-04 C101)
 *
 * 범위 = (티어 · 회사) 짝. 회사 칸이 빈 릴리스 = 그 티어 전체(지금 동작) · 회사 칸이 있는 릴리스 = 그 회사 에이전트만
 *   (설계서 docs/2026-11-03-sync-duplicate-phone-consent-design.md 3-2 ⑩ · FEATURE-SYNC-AGENT §10 고객사마다 출고).
 * 고르는 순서 = 회사 지정 > 티어 일치 > 전역 · 등록은 같은 범위의 활성 릴리스만 끈다(다른 범위는 그대로).
 * ⛔ sync_releases 를 고르거나 끄는 SQL 은 이 파일에만 둔다(라우트 = routes/sync.ts 버전 확인 · routes/admin-sync.ts 등록).
 */
import type { TxRun } from '../config/database';

export interface SyncReleaseRow {
  version: string; download_url: string | null; checksum: string | null; release_notes: string | null;
  force_update: boolean; released_at: Date; tier: string | null; company_id: string | null;
}

/** 이 에이전트(티어 · 회사)가 받을 활성 릴리스 하나 · 없으면 null */
export async function pickSyncRelease(run: TxRun, tier: string | null, companyId: string): Promise<SyncReleaseRow | null> {
  const r = await run(
    `SELECT version, download_url, checksum, release_notes, force_update, released_at, tier, company_id
       FROM sync_releases
      WHERE is_active = true AND (tier = $1 OR tier IS NULL) AND (company_id IS NULL OR company_id = $2::uuid)
      ORDER BY (CASE WHEN company_id = $2::uuid THEN 0 ELSE 1 END), (CASE WHEN tier = $1 THEN 0 ELSE 1 END), released_at DESC
      LIMIT 1`,
    [tier, companyId],
  );
  return r.rows[0] ?? null;
}

/** 등록 — 같은 범위(티어 · 회사)의 활성 릴리스만 끄고 새 릴리스를 켠다(부르는 쪽 트랜잭션 안) */
export async function registerSyncRelease(run: TxRun, p: {
  version: string; downloadUrl: string; checksum: string | null; releaseNotes: string | null; forceUpdate: boolean;
  tier: string | null; companyId: string | null;
}): Promise<Record<string, unknown>> {
  await run(
    `UPDATE sync_releases SET is_active = false
      WHERE is_active = true AND tier IS NOT DISTINCT FROM $1 AND company_id IS NOT DISTINCT FROM $2::uuid`,
    [p.tier, p.companyId],
  );
  const ins = await run(
    `INSERT INTO sync_releases (version, download_url, checksum, release_notes, force_update, is_active, tier, company_id)
     VALUES ($1, $2, $3, $4, $5, true, $6, $7)
     RETURNING id, version, tier, company_id, download_url, force_update, is_active, released_at`,
    [p.version, p.downloadUrl, p.checksum, p.releaseNotes, p.forceUpdate, p.tier, p.companyId],
  );
  return ins.rows[0];
}
