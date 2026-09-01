/**
 * utils/assets.ts — 에셋 라이브러리 컨트롤타워 (2026-07-18 P3)
 *
 * 회사별 이미지 소재 저장소: 채널 에디터 업로드·AI 생성물(P4)을 cdp_assets에 등재하고,
 * 전 채널 에디터의 "라이브러리에서 선택" 픽커가 재사용한다 (설계서 docs/2026-07-18-inapp-simplify-image-studio-design.md §5).
 *
 * 안전 원칙 (DDL 미실행 환경 무중단):
 *  - 등재(registerAsset)는 부가 흐름 — 실패(테이블 없음 포함) 시 조용히 건너뛰고 업로드 자체는 성공 유지.
 *  - 조회/삭제는 테이블 없음을 감지해 라우트가 503 DB_MIGRATION_PENDING으로 답한다 (db_alter_safety_net 미러).
 *  - 행 삭제 시 실물 파일은 지우지 않는다 — 발행된 메시지가 같은 URL을 참조 중일 수 있어 이미지가 깨진다(비파괴).
 */

import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database';
import { loadPlanContext } from './plan-guard';

// 인앱 이미지 실물 저장 경로 — routes/cdp.ts INAPP_IMAGE_BASE와 동일 정의 미러 (단일 env 소스)
const INAPP_IMAGE_BASE = process.env.INAPP_IMAGE_PATH || path.resolve('./uploads/inapp');

// ── 플랜별 저장 용량 한도 (2026-07-18 Harold 확정: 하위 0.5GB / 중위 2.5GB / 최상위 5GB) ──
const GB = 1024 * 1024 * 1024;
export const PLAN_STORAGE_LIMITS: Record<string, number> = {
  FREE: Math.round(0.5 * GB),
  TRIAL: Math.round(0.5 * GB),
  STARTER: Math.round(0.5 * GB),
  BASIC: Math.round(0.5 * GB),
  PRO: Math.round(2.5 * GB),
  BUSINESS: 5 * GB,
  ENTERPRISE: 5 * GB,
};
export const DEFAULT_STORAGE_LIMIT = Math.round(0.5 * GB);

export type AssetKind = 'uploaded' | 'generated' | 'nukki' | 'variant';

export interface AssetRow {
  id: string;
  company_id: string;
  kind: AssetKind;
  url: string;
  filename: string | null;
  bytes: number;
  format: string | null;
  origin: string;
  prompt: string | null;
  channel_spec: string | null;
  width: number | null;
  height: number | null;
  created_at: string;
}

/** cdp_assets 테이블 미생성 감지 — 라우트 503 분기용 */
export function isAssetsTableMissing(err: any): boolean {
  const m = String(err?.message || '');
  return m.includes('cdp_assets') && m.includes('does not exist');
}

/** 에셋 등재 — 부가 흐름: 어떤 실패도 호출부(업로드)를 중단시키지 않는다. 성공 시 asset id, 실패 시 null. */
export async function registerAsset(input: {
  companyId: string;
  createdBy?: string | null;
  kind: AssetKind;
  url: string;
  filename?: string | null;
  bytes?: number;
  format?: string | null;
  origin: string; // inapp / dm / email / studio ...
  prompt?: string | null;
  sourceAssetId?: string | null;
  /** ★ P4(2026-07-19): 채널 규격 태그(mms / inapp-poster / dm / email / free ...) — 라이브러리 2트랙 게이팅용. */
  channelSpec?: string | null;
  /** ★ P4: 산출물 실측 픽셀 — 픽커 표시·저해상 경고용. */
  width?: number | null;
  height?: number | null;
}): Promise<string | null> {
  try {
    const result = await query(
      `INSERT INTO cdp_assets (company_id, created_by, kind, source_asset_id, url, filename, bytes, format, origin, prompt, channel_spec, width, height)
       VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id`,
      [
        input.companyId, input.createdBy || null, input.kind, input.sourceAssetId || null,
        input.url, input.filename || null, Math.max(0, Math.round(input.bytes || 0)),
        input.format || null, input.origin, input.prompt || null,
        input.channelSpec || null,
        input.width != null ? Math.max(0, Math.round(input.width)) : null,
        input.height != null ? Math.max(0, Math.round(input.height)) : null,
      ],
    );
    return result.rows[0]?.id || null;
  } catch (err: any) {
    // 테이블 미생성 등 — 업로드 흐름 무중단. PM2 로그로만 흔적.
    console.warn('[assets] 등재 건너뜀:', err?.message);
    return null;
  }
}

/** 회사 사용량 + 플랜 한도 — 플랜 조회 실패 시 기본 한도(fail-safe, 500 방지) */
export async function getStorageUsage(companyId: string): Promise<{ usedBytes: number; limitBytes: number; planCode: string }> {
  const usedResult = await query(
    `SELECT COALESCE(SUM(bytes), 0) AS used FROM cdp_assets WHERE company_id = $1::uuid`,
    [companyId],
  );
  const usedBytes = Number(usedResult.rows[0]?.used || 0);
  let planCode = 'FREE';
  try {
    const ctx = await loadPlanContext(companyId);
    if (ctx?.planCode) planCode = ctx.planCode;
  } catch { /* 플랜 조회 실패 = 기본 한도 */ }
  const limitBytes = PLAN_STORAGE_LIMITS[planCode] ?? DEFAULT_STORAGE_LIMIT;
  return { usedBytes, limitBytes, planCode };
}

/** 단건 조회 — 회사 소유 검증 포함. 없으면 null. (P4 MMS 변환 등 파생 작업용)
 *  ownerId 지정 시(담당자) 본인 생성분만 조회 가능(방어 격리). */
export async function getAsset(companyId: string, assetId: string, ownerId?: string | null): Promise<AssetRow | null> {
  const ownerClause = ownerId ? ' AND created_by = $3::uuid' : '';
  const params: any[] = [assetId, companyId];
  if (ownerId) params.push(ownerId);
  const result = await query(
    `SELECT id, company_id, kind, url, filename, bytes, format, origin, prompt, channel_spec, width, height, created_at
       FROM cdp_assets
      WHERE id = $1::uuid AND company_id = $2::uuid${ownerClause}`,
    params,
  );
  return (result.rows[0] as AssetRow) || null;
}

/**
 * URL 기준 단건 조회 — 브랜드 메시지 AI 표시 판정의 보조 축 (2026-09-01 AI 이미지 표시 §4-3).
 * cdp_assets.url은 상대 경로(/api/cdp/inapp/image/{companyId}/{filename})로 저장된다 —
 * 절대 URL은 호출부가 상대 경로로 정규화해 넘긴다. 정확 일치만 본다(파일명이 uuid라 충돌 없음).
 */
export async function getAssetByUrl(companyId: string, url: string): Promise<AssetRow | null> {
  const result = await query(
    `SELECT id, company_id, kind, url, filename, bytes, format, origin, prompt, channel_spec, width, height, created_at
       FROM cdp_assets
      WHERE company_id = $1::uuid AND url = $2
      ORDER BY created_at DESC
      LIMIT 1`,
    [companyId, url],
  );
  return (result.rows[0] as AssetRow) || null;
}

/**
 * 이미지 실물 저장 + 라이브러리 자동 등재 — 업로드 라우트 공용 (2026-09-01 브랜드 편집기 업로드).
 * 저장 경로·URL 규약은 인앱 업로드(routes/cdp.ts /inapp/upload-image)와 동일하다 —
 * 공개 서빙 GET /api/cdp/inapp/image/... 를 그대로 타므로 카카오가 내려받을 수 있다.
 * ★Codex 1R H2 수용 — 등재 실패를 흡수하지 않는다. 등재 없는 파일은 사용량에도 안 잡히고
 * 라이브러리에서 지울 수도 없는 고아가 되므로, 파일을 되돌리고 throw한다(업로드 = 저장+등재 원자).
 */
export async function storeAssetFile(input: {
  companyId: string;
  userId: string;
  buffer: Buffer;
  originalName: string;
  origin: string;
}): Promise<{ url: string; filename: string; bytes: number; assetId: string }> {
  const companyDir = path.join(INAPP_IMAGE_BASE, input.companyId);
  if (!fs.existsSync(companyDir)) fs.mkdirSync(companyDir, { recursive: true });
  const ext = path.extname(input.originalName).toLowerCase();
  const filename = `${uuidv4()}${ext}`;
  const filepath = path.join(companyDir, filename);
  fs.writeFileSync(filepath, input.buffer);
  const url = `/api/cdp/inapp/image/${input.companyId}/${filename}`;
  const assetId = await registerAsset({
    companyId: input.companyId,
    createdBy: input.userId,
    kind: 'uploaded',
    origin: input.origin,
    url,
    filename: input.originalName,
    bytes: input.buffer.length,
    format: ext.replace('.', '') || null,
  });
  if (!assetId) {
    // ★Codex 2R M1 부분 수용 — registerAsset은 오류를 null로 축약하므로 "커밋됐는데 응답만 끊긴"
    //   불확정 결과일 수 있다. 파일을 지우기 전에 행 존재를 재확인하고, 실제로 커밋됐으면 그 행을
    //   성공으로 돌려준다(행은 남고 파일만 지워지는 깨진 소재 방지). 재확인마저 실패하는 잔여 위험 =
    //   BUGS B-0901-1 ③.
    try {
      const committed = await getAssetByUrl(input.companyId, url);
      if (committed) return { url, filename, bytes: input.buffer.length, assetId: committed.id };
    } catch { /* 재확인 불가 — 아래 회수·오류 경로로 */ }
    try {
      fs.unlinkSync(filepath);
    } catch (e: any) {
      console.warn('[assets] 등재 실패 파일 회수 실패(고아 파일 가능):', filepath, e?.message);
    }
    throw new Error('이미지를 라이브러리에 등재하지 못했습니다. 잠시 후 다시 시도해주세요.');
  }
  return { url, filename, bytes: input.buffer.length, assetId };
}

/** 목록 — 최신순, 검색(q = 파일명·프롬프트 부분 일치), 최대 200건.
 *  ownerId 지정 시(담당자) 본인 생성분만, null/미지정(관리자)이면 회사 전체. */
export async function listAssets(companyId: string, q?: string, ownerId?: string | null): Promise<AssetRow[]> {
  const ownerClause = ownerId ? ' AND created_by = $3::uuid' : '';
  const params: any[] = [companyId, q?.trim() || null];
  if (ownerId) params.push(ownerId);
  const result = await query(
    `SELECT id, company_id, kind, url, filename, bytes, format, origin, prompt, channel_spec, width, height, created_at
       FROM cdp_assets
      WHERE company_id = $1::uuid
        AND ($2::text IS NULL OR filename ILIKE '%' || $2 || '%' OR prompt ILIKE '%' || $2 || '%')${ownerClause}
      ORDER BY created_at DESC
      LIMIT 200`,
    params,
  );
  return result.rows as AssetRow[];
}

/** 삭제 — 발행물(인앱 메시지)이 참조 중이면 거부(in_use), 미참조면 행 + 실물 파일 함께 삭제.
 *  행만 지우고 파일을 남기면 "삭제→재업로드" 반복으로 디스크가 무한 증식한다(Codex E2 — 0716 디스크 100% 사고 부류).
 *  참조 중 파일을 지우면 발행물 이미지가 깨진다 — 그래서 참조 검사로 두 축을 모두 지킨다. */
export async function deleteAsset(
  companyId: string,
  assetId: string,
): Promise<{ deleted: boolean; inUse: boolean }> {
  const rowResult = await query(
    `SELECT url FROM cdp_assets WHERE id = $1::uuid AND company_id = $2::uuid`,
    [assetId, companyId],
  );
  if (rowResult.rows.length === 0) return { deleted: false, inUse: false };
  const url: string = String(rowResult.rows[0].url || '');

  // 인앱 메시지 참조 검사 (image_url 정확 일치 + buttons/content_blocks 본문 포함) — archived 제외
  if (url) {
    const refResult = await query(
      `SELECT 1 FROM cdp_inapp_messages
        WHERE company_id = $1::uuid AND status != 'archived'
          AND (image_url = $2 OR buttons::text LIKE '%' || $2 || '%' OR content_blocks::text LIKE '%' || $2 || '%')
        LIMIT 1`,
      [companyId, url],
    );
    if (refResult.rows.length > 0) return { deleted: false, inUse: true };
  }

  await query(`DELETE FROM cdp_assets WHERE id = $1::uuid AND company_id = $2::uuid`, [assetId, companyId]);

  // 실물 파일 삭제 — 우리 서빙 URL(/api/cdp/inapp/image/{companyId}/{filename})만, best-effort
  const m = url.match(/^\/api\/cdp\/inapp\/image\/([^/]+)\/([^/?#]+)$/);
  if (m && m[1] === companyId) {
    const filepath = path.join(INAPP_IMAGE_BASE, companyId, m[2]);
    try { if (fs.existsSync(filepath)) fs.unlinkSync(filepath); } catch (e: any) {
      console.warn('[assets] 파일 삭제 실패(행은 삭제됨):', e?.message);
    }
  }
  return { deleted: true, inUse: false };
}
