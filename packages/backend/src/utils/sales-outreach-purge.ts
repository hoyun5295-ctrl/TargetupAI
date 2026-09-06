/**
 * ★ 2026-09-06 S4 AI 영업 아웃리치 — 산출물 파기 공용 함수 (설계 = docs/2026-09-06-campaign-engine-design.md §6)
 *
 * 만료 파기(sweeper)와 사람 삭제(deleteOutreachJob)가 같은 본문을 쓴다. 두 갈래로 갈라 놓으면 한쪽만 고쳐져 한쪽에 파일이 남는다.
 *  - DM 발행 중지(stopDm · not_published = 멱등 성공 · 그 밖 block = 실패로 던진다 · 불변 23)
 *  - 포스터·16:9 배너·재료 사본(brand_profile.media) 공개 파일 삭제(없으면 무시 = 멱등)
 * purged_at 스탬프·롤백은 호출자가 소유한다(선점은 호출자의 상태 조건이 다르다).
 * 이 파일은 발송 능력이 없다(sendMail·runOutreachJob 없음 · 불변식 4).
 */
import * as fs from 'fs';
import * as path from 'path';
import { query } from '../config/database';
import { stopDm } from './dm/dm-builder';

// routes/cdp.ts INAPP_IMAGE_BASE와 동일 정의 미러(단일 env 소스 — utils/assets.ts와 같은 관례)
const INAPP_IMAGE_BASE = process.env.INAPP_IMAGE_PATH || path.resolve('./uploads/inapp');

/** 공개 이미지 URL(/api/cdp/inapp/image/{companyId}/{filename}) → 파일 삭제(멱등). 형식 밖 URL은 건너뜀. 지웠으면 true. */
export function unlinkPublicImage(url: string): boolean {
  const m = String(url || '').match(/\/api\/cdp\/inapp\/image\/([0-9a-f-]{36})\/([A-Za-z0-9._-]+)$/i);
  if (!m) return false;
  const filePath = path.join(INAPP_IMAGE_BASE, m[1], m[2]);
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch (e: any) {
    if (e?.code !== 'ENOENT') throw e; // 없음 = 이미 지워짐(멱등) · 그 외 = 실패로 취급
    return false;
  }
}

export interface PurgeResult { dmsStopped: number; filesDeleted: number }

/**
 * 잡 하나의 외부 노출물을 전부 닫는다. 실패는 던진다(호출자가 스탬프를 롤백한다 · 조용히 넘기지 않는다).
 * 순서 = DM 중지 → 파일 삭제. DM 중지가 먼저인 이유: 링크가 살아 있는 채 이미지가 사라지면 깨진 페이지가 보인다.
 */
export async function purgeOutreachJobArtifacts(jobId: string, companyId: string): Promise<PurgeResult> {
  let dmsStopped = 0;
  let filesDeleted = 0;
  const dms = await query(`SELECT payload FROM sales_outreach_assets WHERE job_id = $1 AND kind = 'dm'`, [jobId]);
  for (const a of dms.rows) {
    const dmId = String(a.payload?.dmId || '');
    if (!dmId) continue;
    const res = await stopDm(dmId, companyId);
    if (res.block && res.block !== 'not_published') throw new Error(`DM 중지 실패(${res.block}): ${dmId}`);
    if (!res.block) dmsStopped += 1;
  }
  const images = await query(`SELECT payload FROM sales_outreach_assets WHERE job_id = $1 AND kind = 'studio_image'`, [jobId]);
  for (const a of images.rows) {
    if (unlinkPublicImage(String(a.payload?.url || ''))) filesDeleted += 1;
    // ★ S3 16:9 배너(실측 배너 0장 폴백)도 같은 저장소
    if (a.payload?.bannerUrl && unlinkPublicImage(String(a.payload.bannerUrl))) filesDeleted += 1;
  }
  const prof = await query(`SELECT brand_profile FROM sales_outreach_jobs WHERE id = $1`, [jobId]);
  const media = prof.rows[0]?.brand_profile?.media;
  if (media) {
    for (const g of (Array.isArray(media.gallery) ? media.gallery : [])) if (unlinkPublicImage(String(g?.url || ''))) filesDeleted += 1;
    for (const p of (Array.isArray(media.products) ? media.products : [])) if (unlinkPublicImage(String(p?.image_url || ''))) filesDeleted += 1;
    if (media.logo?.url && unlinkPublicImage(String(media.logo.url))) filesDeleted += 1;
  }
  return { dmsStopped, filesDeleted };
}
