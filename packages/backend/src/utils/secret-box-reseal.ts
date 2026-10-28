/**
 * 몰 연동 자격 다시 쓰기 본체(★ 2026-10-28 자사몰 대비 K8 · DML-2 · 되돌림 DML-2R) — 스크립트 scripts/seal-integration-secrets.ts 가 부른다.
 * 행마다 읽기 이중 CT 로 읽어 암호문(되돌림 = 평문)으로 다시 쓴다 · 행을 읽은 때와 값이 같을 때만 쓴다(그 사이 앱이 새 토큰을 쓰면 건너뜀).
 * 풀 수 없는 행(다른 키) = 쓰지 않고 실패로 센다(openSecret 이 던짐 · 자격을 잃지 않는다).
 */
import { query } from '../config/database';
import { sealSecret, openSecret, sealMetaSecrets, openMetaSecrets, secretBoxReady, SECRET_META_KEYS, webhookSecretColumnFitsSealed } from './secret-box';

export interface ResealResult { rows: number; changed: number; skipped: number; failed: string[]; webhookLeftPlain: boolean }

export async function resealIntegrationSecrets(reverse: boolean): Promise<ResealResult> {
  if (!secretBoxReady()) throw new Error('CDP_SECRET_BOX_KEY 가 없거나 꼴이 맞지 않습니다(32바이트 · hex 64자 또는 base64).');
  const sealWebhook = reverse || await webhookSecretColumnFitsSealed();
  const f = reverse ? openSecret : sealSecret;
  const fm = reverse ? openMetaSecrets : sealMetaSecrets;
  const rows = (await query(`SELECT id, access_token, refresh_token, webhook_secret, meta FROM company_integrations ORDER BY created_at`)).rows;
  let changed = 0;
  let skipped = 0;
  const failed: string[] = [];
  for (const r of rows) {
    try {
      const meta = r.meta || {};
      const next = {
        access: f(r.access_token),
        refresh: f(r.refresh_token),
        webhook: sealWebhook ? f(r.webhook_secret) : r.webhook_secret,
        meta: fm(meta),
      };
      const same = next.access === r.access_token && next.refresh === r.refresh_token && next.webhook === r.webhook_secret
        && SECRET_META_KEYS.every((k) => next.meta[k] === meta[k]);
      if (same) continue;
      const u = await query(
        `UPDATE company_integrations
            SET access_token = $2, refresh_token = $3, webhook_secret = $4,
                meta = COALESCE(meta, '{}'::jsonb) || $5::jsonb
          WHERE id = $1::uuid
            AND access_token IS NOT DISTINCT FROM $6 AND refresh_token IS NOT DISTINCT FROM $7 AND webhook_secret IS NOT DISTINCT FROM $8
            AND (meta->'woo_consumer_key') IS NOT DISTINCT FROM $9::jsonb AND (meta->'woo_consumer_secret') IS NOT DISTINCT FROM $10::jsonb
            AND (meta->'godo_key') IS NOT DISTINCT FROM $11::jsonb AND (meta->'app_client_secret') IS NOT DISTINCT FROM $12::jsonb`,
        [
          r.id, next.access, next.refresh, next.webhook,
          JSON.stringify(Object.fromEntries(SECRET_META_KEYS.filter((k) => typeof next.meta[k] === 'string').map((k) => [k, next.meta[k]]))),
          r.access_token, r.refresh_token, r.webhook_secret,
          ...SECRET_META_KEYS.map((k) => (meta[k] === undefined ? null : JSON.stringify(meta[k]))),
        ],
      );
      if ((u.rowCount || 0) > 0) changed++;
      else skipped++;
    } catch (err: any) {
      failed.push(r.id);
      console.error(`행 실패 id=${r.id}: ${err?.code || ''} ${String(err?.message || err).slice(0, 120)}`);
    }
  }
  return { rows: rows.length, changed, skipped, failed, webhookLeftPlain: !sealWebhook };
}
