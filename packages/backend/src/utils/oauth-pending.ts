/**
 * ★ CT: 몰 OAuth 승인 묶기(★ 2026-10-28 자사몰 대비 K8 · M24 · 구조체크 SC7)
 *
 * 몰 승인 콜백은 로그인 정보 없이 온다(몰이 브라우저를 우리 콜백 주소로 돌려보낸다 · 콜백 도메인 ≠ 화면 도메인).
 * 콜백이 곧바로 연동 행에 넣으면, 남의 회사가 시작한 승인 링크를 몰 주인이 누르는 것만으로 그 몰이 남의 회사에 묶인다.
 * → 콜백 = 토큰을 그 승인의 oauth_state 행 payload 에 암호문으로 담고(미확정) 새 확정 표를 만들어 로그인된 화면으로 돌려보낸다.
 *   확정 = 화면(JWT 회사 = 그 승인을 시작한 회사)이 확정 표로 부를 때만 · 그 행을 지우며 꺼낸다(두 번 확정 0).
 *   확정 표는 콜백을 받은 브라우저에만 간다(승인을 시작한 쪽이 state 를 알아도 확정 표는 모른다).
 *   확정되지 않으면 1시간 정리(cdp-webhook-retry-worker)가 지운다 = 토큰이 연동 행에 들어가지 않은 채 사라짐(다시 승인).
 */
import { createHash, randomBytes } from 'crypto';
import { query, withTransaction, type TxRun } from '../config/database';
import { sealSecret, openSecret } from './secret-box';

const hashOf = (confirm: string): string => createHash('sha256').update(confirm).digest('hex');

/** 콜백 — 토큰을 미확정으로 담고 확정 표를 돌려준다(그 승인 행이 없으면 던진다) */
export async function stashPendingApproval(companyId: string, source: string, nonce: string, pending: object): Promise<string> {
  const confirm = randomBytes(24).toString('base64url');
  const r = await query(
    `UPDATE cdp_webhook_deliveries
        SET payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object('pending', $4::text, 'confirm_hash', $5::text)
      WHERE company_id = $1::uuid AND source = $2 AND webhook_event = 'oauth_state' AND idempotency_key = $3
      RETURNING id`,
    [companyId, source, `state:${nonce}`, sealSecret(JSON.stringify(pending)), hashOf(confirm)],
  );
  if (r.rows.length === 0) throw new Error('승인 상태가 없습니다(만료 또는 변조).');
  return confirm;
}

/**
 * 화면 확정 — 그 회사 · 그 몰 출처 · 1시간 안의 미확정 승인을 잠그고 풀어 save 에 넘긴 뒤, save 가 끝나면 그 승인 행을 지운다(한 트랜잭션 ·
 * save 는 넘겨받은 실행자로만 DB 를 쓴다 · 몰 API 호출 · 허용 도메인 등록 같은 바깥 일은 커밋 뒤 호출부가).
 * save 가 던지면 되돌린다 = 승인 행이 남아 같은 확정을 다시 할 수 있다(Codex R1 #7 · 옛: 먼저 지우고 저장해 저장 실패 = 토큰 영구 소실).
 * 동시에 두 번 확정하면 둘째는 첫째의 잠금을 기다린 뒤 행이 없어 null(두 번 저장 0). 없거나 풀 수 없으면 null(save 를 부르지 않는다).
 */
export async function confirmPendingApproval<T>(
  companyId: string, source: string, confirm: string,
  save: (state: Record<string, any>, pending: any, run: TxRun) => Promise<T>,
): Promise<{ result: T } | null> {
  if (!confirm) return null;
  return withTransaction(async (run) => {
    const r = await run(
      `SELECT id, payload FROM cdp_webhook_deliveries
        WHERE company_id = $1::uuid AND source = $2 AND webhook_event = 'oauth_state'
          AND payload->>'confirm_hash' = $3 AND created_at > NOW() - INTERVAL '1 hour'
        FOR UPDATE`,
      [companyId, source, hashOf(confirm)],
    );
    const row = r.rows[0];
    if (!row) return null;
    let pending: any = null;
    try { pending = JSON.parse(openSecret(String(row.payload?.pending || '')) || 'null'); } catch { pending = null; }
    if (!pending) return null;
    // 연동 저장 · 승인 행 지우기 = 같은 실행자 = 한 커밋(Codex R2 #1 · 옛: 저장이 다른 연결에서 먼저 커밋돼 뒤 지우기가 실패하면 옛 승인으로 다시 저장할 수 있었다)
    const result = await save(row.payload || {}, pending, run);
    await run(`DELETE FROM cdp_webhook_deliveries WHERE id = $1::uuid`, [row.id]);
    return { result };
  });
}

/** 콜백이 돌려보낼 화면 주소(로그인된 화면이 확정을 부른다) */
export function approvalConfirmUrl(provider: 'cafe24' | 'imweb', confirm: string): string {
  const base = (process.env.PUBLIC_BASE_URL || 'https://hanjul.ai').replace(/\/$/, '');
  return `${base}/oauth-confirm?provider=${provider}&oauth_confirm=${encodeURIComponent(confirm)}`;   // 요금제 문 밖 전용 화면(미가입 계정의 카페24 앱 실행 동선)
}
