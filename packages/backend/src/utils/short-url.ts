/**
 * ★ CT-40: 단축 URL 생성/조회 컨트롤타워 — D183 (2026-05-20)
 *
 * 🎯 목적
 *   SMS/카톡 본문의 긴 URL을 짧은 hash로 단축 + 클릭 트래킹.
 *   - 단축 URL = {SHORT_URL_BASE}/{hash} (예: https://app.hanjul.ai/c/aB3xY9zQ)
 *   - 클릭 시 cdp_events 'message_click' 기록 + 원본 URL redirect
 *   - accumulateCampaignLearning 영역에서 정확한 click_count 학습 (D182 cron 통합)
 *
 * 📋 hash 매트릭스
 *   - base62 (0-9 a-z A-Z) 8자 = 62^8 = 218조 영역 → 충돌 거의 0
 *   - 충돌 시 재시도 최대 3회
 *
 * ⛔ 영구 원칙
 *   - 단축 실패 시 원본 URL 그대로 반환 (안전 영역)
 *   - 만료된 단축 URL = redirect 차단 + fallback URL
 */

import { query } from '../config/database';
import { randomBytes } from 'crypto';

const HASH_LENGTH = 8;
const HASH_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const SHORT_URL_BASE = (process.env.SHORT_URL_BASE || 'https://app.hanjul.ai/c').replace(/\/+$/, '');

function generateHash(): string {
  const bytes = randomBytes(HASH_LENGTH);
  let hash = '';
  for (let i = 0; i < HASH_LENGTH; i++) {
    hash += HASH_ALPHABET[bytes[i] % HASH_ALPHABET.length];
  }
  return hash;
}

export interface CreateShortUrlInput {
  companyId: string;
  fullUrl: string;
  campaignId?: string;
  expiresAt?: Date;
}

export interface ShortUrlResolution {
  fullUrl: string;
  companyId: string;
  campaignId: string | null;
}

/**
 * 단축 URL 생성 — hash 충돌 시 3회 재시도
 */
export async function createShortUrl(input: CreateShortUrlInput): Promise<{ hash: string; shortUrl: string }> {
  if (!input.fullUrl || !/^https?:\/\//.test(input.fullUrl)) {
    throw new Error('fullUrl은 http(s)://로 시작해야 합니다.');
  }
  if (!input.companyId) {
    throw new Error('companyId는 필수입니다.');
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const hash = generateHash();
    try {
      await query(
        // D183 정정: short_urls 영역 = 한줄전단(hanjulDM) 전단지 미리보기 영역 → 한줄로 캠페인 영역 별 테이블 분리
        `INSERT INTO message_short_urls (hash, full_url, company_id, campaign_id, expires_at)
         VALUES ($1, $2, $3::uuid, $4, $5)`,
        [hash, input.fullUrl, input.companyId, input.campaignId || null, input.expiresAt || null],
      );
      return { hash, shortUrl: `${SHORT_URL_BASE}/${hash}` };
    } catch (err: any) {
      if (err?.code === '23505' && attempt < 2) continue;
      throw err;
    }
  }
  throw new Error('단축 URL 생성 실패 (hash 충돌 3회)');
}

/**
 * hash로 단축 URL 조회 — 만료 시 null 반환
 */
export async function resolveShortUrl(hash: string): Promise<ShortUrlResolution | null> {
  const result = await query(
    // D183 정정: 한줄로 캠페인 단축 URL 전용 테이블 (한줄전단 short_urls와 분리)
    `SELECT full_url, company_id, campaign_id, expires_at
     FROM message_short_urls
     WHERE hash = $1
     LIMIT 1`,
    [hash],
  );
  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  if (row.expires_at && new Date(row.expires_at) < new Date()) return null;

  return {
    fullUrl: row.full_url,
    companyId: row.company_id,
    campaignId: row.campaign_id || null,
  };
}

const URL_REGEX = /https?:\/\/[^\s<>"]+/g;

/**
 * 텍스트 안의 모든 URL을 단축 URL로 치환
 * - 이미 SHORT_URL_BASE로 시작하는 URL은 skip
 * - 단축 실패 시 원본 URL 그대로 보존 (안전 영역)
 */
export async function shortenUrlsInText(
  text: string,
  companyId: string,
  campaignId?: string,
): Promise<string> {
  if (!text) return text;
  const urls = text.match(URL_REGEX);
  if (!urls || urls.length === 0) return text;

  let result = text;
  // 중복 URL 제거 (동일 URL 다중 등장 시 한 번만 단축)
  const uniqueUrls = Array.from(new Set(urls));

  for (const url of uniqueUrls) {
    if (url.startsWith(`${SHORT_URL_BASE}/`)) continue;
    try {
      const { shortUrl } = await createShortUrl({ companyId, fullUrl: url, campaignId });
      // 정규식 대신 split/join으로 안전 치환 (특수문자 escape 불요)
      result = result.split(url).join(shortUrl);
    } catch (err) {
      console.warn('[short-url] 단축 실패, 원본 보존:', (err as any)?.message);
    }
  }
  return result;
}

export { SHORT_URL_BASE };
