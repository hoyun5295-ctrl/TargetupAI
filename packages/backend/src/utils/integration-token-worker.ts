/**
 * 연동 토큰 유지 워커(★ 2026-10-28 자사몰 대비 K6 · M3 · M31 · R8)
 *
 * 카페24 · 아임웹은 웹훅을 받는 동안 우리 쪽에서 API 를 부르지 않으면 토큰을 갱신할 일이 없다 → 갱신 토큰(카페24 14일)이 끊기면
 * 재연결 전까지 수집이 멈춘다. 마지막 갱신에서 카페24 6일 · 아임웹 29일 지난 active 행을 기존 갱신 CT 로 살린다(1시간 주기).
 *   - 확정 거절 = 갱신 CT 가 markTokenRejected 로 만료 표시(다음 회차 대상에서 빠짐 · 수신은 유예 동안 계속) + 경보 1회
 *   - 일시 실패 = 다음 회차에 다시 · 같은 행 연속 3회 = 경보(meta.token_keepalive_fails · 성공하면 지움)
 *   - 대상 = SQL WHERE 의 active 행만 · 회차 상한(LIMIT 앞 거름 · R8 · R12)
 */
import { query } from '../config/database';
import { sendSystemAlert } from './system-alert';
import { isDefinitiveTokenRejection } from './integration-token-error';
import { listTokenKeepaliveTargets, type ReceiveProvider } from './integration-token';
import { getCafe24Integration, getCafe24ByoCredentials, ensureFreshCafe24Token, registerCafe24AllowedOrigins } from './cafe24-client';
import { getImwebIntegration, ensureFreshImwebToken } from './imweb-client';

const INTERVAL_MS = 60 * 60 * 1000;
const FAIL_ALERT_AT = 3;
const LABEL: Record<ReceiveProvider, string> = { cafe24: '카페24', imweb: '아임웹' };

async function refreshOne(provider: ReceiveProvider, companyId: string, mallId: string): Promise<void> {
  if (provider === 'cafe24') {
    const integ = await getCafe24Integration(companyId, mallId);
    if (!integ || integ.status !== 'active') return;
    await ensureFreshCafe24Token(integ, await getCafe24ByoCredentials(companyId, mallId));
    await registerCafe24AllowedOrigins(companyId, mallId);   // ★1028 K12 주기 갱신(연결 전에 붙은 몰 · 지워진 값)
  } else {
    const integ = await getImwebIntegration(companyId, mallId);
    if (!integ || integ.status !== 'active') return;
    await ensureFreshImwebToken(integ);
  }
}

async function companyName(companyId: string): Promise<string> {
  const r = await query(`SELECT company_name FROM companies WHERE id = $1::uuid`, [companyId]).catch(() => ({ rows: [] as any[] }));
  return String(r.rows[0]?.company_name || '고객사');
}

/** 한 회차 — 갱신한 행 수 */
export async function runTokenKeepalivePass(): Promise<number> {
  let refreshed = 0;
  for (const provider of ['cafe24', 'imweb'] as const) {
    for (const t of await listTokenKeepaliveTargets(provider)) {
      try {
        await refreshOne(provider, t.companyId, t.mallId);
        await query(`UPDATE company_integrations SET meta = meta - 'token_keepalive_fails' WHERE id = $1::uuid AND meta ? 'token_keepalive_fails'`, [t.id]);
        refreshed++;
      } catch (err: any) {
        if (isDefinitiveTokenRejection(err)) {
          console.warn(`[Token Keepalive] ${provider} 갱신 거절 → 만료 표시 company=${t.companyId} mall=${t.mallId}`);
          await sendSystemAlert({
            companyId: t.companyId,
            dedupKey: `token-rejected:${provider}:${t.id}`,
            cooldownMs: 24 * 60 * 60 * 1000,
            title: `${LABEL[provider]} 연동 토큰이 거절되어 다시 연결이 필요합니다.`,
            details: [`고객사: ${await companyName(t.companyId)}`, `몰: ${t.mallId}`],
            action: '유예 기간 동안은 웹훅을 계속 받습니다. 고객사에 그 몰을 다시 연결해 달라고 안내해 주세요.',
          });
          continue;
        }
        const r = await query(
          `UPDATE company_integrations
              SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('token_keepalive_fails', COALESCE(NULLIF(meta->>'token_keepalive_fails', '')::int, 0) + 1)
            WHERE id = $1::uuid
            RETURNING (meta->>'token_keepalive_fails')::int AS fails`,
          [t.id],
        ).catch(() => ({ rows: [] as any[] }));
        const fails = Number(r.rows[0]?.fails || 0);
        console.warn(`[Token Keepalive] ${provider} 일시 실패 ${fails}회 company=${t.companyId} mall=${t.mallId}: ${err?.message || err}`);
        if (fails >= FAIL_ALERT_AT) {
          await sendSystemAlert({
            companyId: t.companyId,
            dedupKey: `token-keepalive:${provider}:${t.id}`,
            cooldownMs: 12 * 60 * 60 * 1000,
            title: `${LABEL[provider]} 연동 토큰 갱신이 ${fails}번 연속 실패했습니다.`,
            details: [`고객사: ${await companyName(t.companyId)}`, `몰: ${t.mallId}`],
            action: '몰 쪽 장애인지 확인해 주세요. 갱신 토큰이 끊기기 전에 살아나지 않으면 다시 연결이 필요합니다.',
          });
        }
      }
    }
  }
  return refreshed;
}

let running = false;
async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const n = await runTokenKeepalivePass();
    if (n > 0) console.log(`[Token Keepalive] 토큰 갱신 ${n}건`);
  } catch (err) {
    console.error('[Token Keepalive] 회차 오류:', err);
  } finally {
    running = false;
  }
}

export function startTokenKeepaliveWorker(): void {
  setInterval(tick, INTERVAL_MS);
  setTimeout(tick, 7 * 60 * 1000);   // 기동 7분 뒤 첫 회차(다른 워커와 겹치지 않게)
  console.log('[Token Keepalive] 워커 시작 (1시간 주기 · 카페24 6일 · 아임웹 29일)');
}
