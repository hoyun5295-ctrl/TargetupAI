/**
 * ★ CT-F18 — 수신자별 단축URL 벌크 생성
 *
 * Phase 1: 수신자별 추적 URL 시스템
 * - 5자리 base62 코드 생성 (62^5 = 약 9.1억 조합)
 * - 벌크 INSERT (배치 5000건 단위)
 * - 발송 시 SMS 메시지에 개인별 URL 삽입
 *
 * 설계: dm-builder.ts generateShortCode() 패턴 재활용
 * 참조: flyer-sms-queue.ts bulkInsertSmsQueue() 배치 패턴
 */

import crypto from 'crypto';
import { query } from '../../../config/database';

// ============================================================
// 상수
// ============================================================
const BASE62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const CODE_LENGTH = 5;
const BATCH_SIZE = 5000;
const MAX_COLLISION_RETRIES = 3; // 벌크 INSERT 충돌 시 재시도 횟수

/**
 * 도메인 조회 (환경변수 우선)
 * hjl.kr 등록 후 .env에 SHORT_URL_DOMAIN=hjl.kr 설정
 */
export function getShortUrlDomain(): string {
  return process.env.SHORT_URL_DOMAIN || 'hanjul-flyer.kr';
}

// ============================================================
// 단축 코드 생성 (단일)
// ============================================================
export function generateShortCode(length = CODE_LENGTH): string {
  const bytes = crypto.randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i++) {
    code += BASE62[bytes[i] % 62];
  }
  return code;
}

// ============================================================
// 수신자별 코드 매핑 생성 (메모리 내 — DB INSERT 전)
// ============================================================
export interface RecipientCode {
  phone: string;
  code: string;
  url: string;
}

function generateUniqueCodes(
  phones: string[],
): RecipientCode[] {
  const domain = getShortUrlDomain();
  const usedCodes = new Set<string>();
  const results: RecipientCode[] = [];

  for (const phone of phones) {
    let code: string;
    let attempts = 0;
    do {
      code = generateShortCode();
      attempts++;
    } while (usedCodes.has(code) && attempts < 100);

    usedCodes.add(code);
    results.push({
      phone,
      code,
      url: `https://${domain}/${code}`,
    });
  }

  return results;
}

// ============================================================
// 벌크 INSERT — short_urls 테이블에 tracking 레코드 삽입
// ============================================================
export async function bulkInsertTrackingUrls(
  flyerId: string,
  companyId: string,
  campaignId: string,
  recipients: RecipientCode[],
): Promise<void> {
  if (recipients.length === 0) return;

  // 배치 단위로 분할
  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const batch = recipients.slice(i, i + BATCH_SIZE);
    await insertBatch(flyerId, companyId, campaignId, batch);
  }
}

async function insertBatch(
  flyerId: string,
  companyId: string,
  campaignId: string,
  batch: RecipientCode[],
): Promise<void> {
  // VALUES 절 동적 생성: ($1, $2, $3, $4, $5, $6, $7), ($8, $9, ...) ...
  const values: any[] = [];
  const placeholders: string[] = [];

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 90); // 90일 만료

  for (let i = 0; i < batch.length; i++) {
    const offset = i * 7;
    placeholders.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7})`
    );
    values.push(
      batch[i].code,     // code
      flyerId,            // flyer_id
      companyId,          // company_id
      expiresAt,          // expires_at
      batch[i].phone,    // phone
      campaignId,         // campaign_id
      'tracking',         // url_type
    );
  }

  const sql = `
    INSERT INTO short_urls (code, flyer_id, company_id, expires_at, phone, campaign_id, url_type)
    VALUES ${placeholders.join(', ')}
    ON CONFLICT (code) DO NOTHING
  `;

  const result = await query(sql, values);

  // 충돌로 인해 일부 미삽입 시 재시도
  const inserted = result.rowCount ?? batch.length;
  if (inserted < batch.length) {
    const missingCount = batch.length - inserted;
    console.warn(`[CT-F18] ${missingCount}건 코드 충돌 — 재생성 시도`);

    // 충돌난 코드 찾아서 재생성
    const codes = batch.map(b => b.code);
    const existing = await query(
      `SELECT code FROM short_urls WHERE code = ANY($1)`,
      [codes]
    );
    const existingSet = new Set(existing.rows.map((r: any) => r.code));
    const failedItems = batch.filter(b => existingSet.has(b.code));

    if (failedItems.length > 0) {
      // 새 코드 생성 후 재시도
      const retryItems = failedItems.map(item => ({
        ...item,
        code: generateShortCode(),
      }));
      await insertBatch(flyerId, companyId, campaignId, retryItems);
    }
  }
}

// ============================================================
// ★ 메인 함수: 수신자별 추적 URL 생성 + DB INSERT + URL 맵 반환
// ============================================================
export async function generateTrackingUrls(
  flyerId: string,
  companyId: string,
  campaignId: string,
  phones: string[],
): Promise<Map<string, string>> {
  if (phones.length === 0) return new Map();

  // 1. 코드 생성 (메모리)
  const recipientCodes = generateUniqueCodes(phones);

  // 2. DB 벌크 INSERT
  await bulkInsertTrackingUrls(flyerId, companyId, campaignId, recipientCodes);

  // 3. phone → url 맵 반환 (flyer-send.ts에서 메시지 치환용)
  const urlMap = new Map<string, string>();
  for (const rc of recipientCodes) {
    urlMap.set(rc.phone, rc.url);
  }

  return urlMap;
}

// ============================================================
// 추적 통계 조회
// ============================================================
export interface TrackingStats {
  totalSent: number;
  totalClicked: number;
  clickRate: number;
  clickedList: { phone: string; clickedAt: string; clickCount: number }[];
  notClickedList: { phone: string }[];
}

export async function getTrackingStats(
  flyerId: string,
  campaignId?: string,
): Promise<TrackingStats> {
  // 발송된 추적 URL 전체 조회
  const whereExtra = campaignId ? ' AND su.campaign_id = $2' : '';
  const params: any[] = [flyerId];
  if (campaignId) params.push(campaignId);

  const sentResult = await query(
    `SELECT su.phone
     FROM short_urls su
     WHERE su.flyer_id = $1 AND su.url_type = 'tracking'${whereExtra}`,
    params
  );
  const sentPhones = sentResult.rows.map((r: any) => r.phone);
  const totalSent = sentPhones.length;

  if (totalSent === 0) {
    return { totalSent: 0, totalClicked: 0, clickRate: 0, clickedList: [], notClickedList: [] };
  }

  // 클릭한 사람 (유니크 phone 기준, 최초 클릭 시각 + 총 클릭 수)
  const clickResult = await query(
    `SELECT uc.phone,
            MIN(uc.created_at) as first_click,
            COUNT(*) as click_count
     FROM url_clicks uc
     JOIN short_urls su ON su.id = uc.short_url_id
     WHERE su.flyer_id = $1 AND su.url_type = 'tracking' AND uc.phone IS NOT NULL
     ${campaignId ? 'AND su.campaign_id = $2' : ''}
     GROUP BY uc.phone`,
    params
  );

  const clickedSet = new Set<string>();
  const clickedList = clickResult.rows.map((r: any) => {
    clickedSet.add(r.phone);
    return {
      phone: r.phone,
      clickedAt: r.first_click,
      clickCount: parseInt(r.click_count, 10),
    };
  });

  const notClickedList = sentPhones
    .filter((p: string) => !clickedSet.has(p))
    .map((p: string) => ({ phone: p }));

  const totalClicked = clickedList.length;
  const clickRate = totalSent > 0 ? Math.round((totalClicked / totalSent) * 1000) / 10 : 0;

  return { totalSent, totalClicked, clickRate, clickedList, notClickedList };
}
