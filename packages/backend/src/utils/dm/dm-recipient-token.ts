/**
 * dm-recipient-token.ts — 모바일DM 수신자별 개인화 토큰 (sub-project A · P4)
 *
 *   발행 URL이 공용 1개라 접속자를 알 수 없던 빈틈을 메운다.
 *   발송 시 수신자별 난수 토큰을 발급하고, 링크를 `/api/dm/v/dm-<code>?r=<token>`로 만든다.
 *   뷰어가 ?r=<token>을 받으면 토큰→customer를 조회해 그 사람 데이터로 개인화 렌더한다.
 *   토큰 없음/만료 = 공용 렌더(PII 노출 0).
 *
 *   ⛔ 신규 테이블 dm_recipient_tokens — 미마이그레이션 시 호출부 endpoint에서 503 처리(db_alter_safety_net).
 */

import { randomBytes } from 'crypto';
import { query } from '../../config/database';

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** 추측 불가 난수 토큰 (base62, 기본 24자). crypto.randomBytes 기반. */
export function generateDmToken(len = 24): string {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += BASE62[bytes[i] % 62];
  return out;
}

export interface DmTokenLookup {
  dmId: string;
  customerId: string;
  companyId: string;
}

/**
 * 수신자별 DM 토큰 발급 (발송 staging 시점). 만료 = N일 후.
 * 같은 (dm, customer)라도 매 발송 새 토큰 — 추적/만료 독립.
 */
export async function issueDmRecipientToken(
  dmId: string,
  customerId: string,
  companyId: string,
  expiresDays = 30,
): Promise<string> {
  const token = generateDmToken(24);
  await query(
    `INSERT INTO dm_recipient_tokens (token, dm_id, customer_id, company_id, created_at, expires_at)
     VALUES ($1, $2::uuid, $3::uuid, $4::uuid, NOW(), NOW() + ($5 || ' days')::interval)`,
    [token, dmId, customerId, companyId, String(Math.max(1, Math.floor(expiresDays)))],
  );
  return token;
}

/**
 * 토큰 조회 — 만료 전이면 { dmId, customerId, companyId }, 아니면 null.
 * 뷰어가 ?r=<token>으로 호출. 만료/미존재 = null → 공용 fallback 렌더.
 */
export async function lookupDmRecipientToken(token: string): Promise<DmTokenLookup | null> {
  if (!token || token.length < 8 || token.length > 32) return null;
  const r = await query(
    `SELECT dm_id, customer_id, company_id
       FROM dm_recipient_tokens
      WHERE token = $1 AND (expires_at IS NULL OR expires_at > NOW())
      LIMIT 1`,
    [token],
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  return {
    dmId: String(row.dm_id),
    customerId: String(row.customer_id),
    companyId: String(row.company_id),
  };
}

/**
 * 수신자 목록에 토큰 벌크 발급 (발송 staging 시점, UNNEST 1회 INSERT).
 * 반환 = [{ customerId, token }] — 호출부가 수신자별 링크 구성에 사용.
 */
export async function issueDmRecipientTokensBulk(
  dmId: string,
  companyId: string,
  customerIds: string[],
  expiresDays = 30,
): Promise<Array<{ customerId: string; token: string }>> {
  if (!customerIds || customerIds.length === 0) return [];
  const pairs = customerIds.map((cid) => ({ customerId: String(cid), token: generateDmToken(24) }));
  const tokens = pairs.map((p) => p.token);
  const custs = pairs.map((p) => p.customerId);
  await query(
    `INSERT INTO dm_recipient_tokens (token, dm_id, customer_id, company_id, created_at, expires_at)
     SELECT u.token, $2::uuid, u.customer_id::uuid, $3::uuid, NOW(), NOW() + ($4 || ' days')::interval
       FROM UNNEST($1::text[], $5::text[]) AS u(token, customer_id)`,
    [tokens, dmId, companyId, String(Math.max(1, Math.floor(expiresDays))), custs],
  );
  return pairs;
}
