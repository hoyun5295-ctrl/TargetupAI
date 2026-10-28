// replaces: none
/**
 * 몰 OAuth 승인 묶기 · 첫 가져오기 판정 — 실 PostgreSQL 판(★ 2026-10-28 자사몰 대비 M24 · K11 검증 수정 14)
 *
 * 주장이 SQL 에 기댄다: 승인 행 payload jsonb 합치기 · DELETE … RETURNING 으로 한 번만 꺼내기 · 1시간 창 · meta 시각 글자 꼴 검사 · 48시간.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { pool, query } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { stashPendingApproval, confirmPendingApproval } from '../oauth-pending';
import { isFirstImportRunning } from '../mall-import';

const A = '00000000-0000-0000-0000-0000000000f1';
const B = '00000000-0000-0000-0000-0000000000f2';
const state = async (companyId: string, nonce: string, ageMin = 0) => {
  await query(
    `INSERT INTO cdp_webhook_deliveries (id, company_id, source, webhook_event, idempotency_key, payload, status, created_at)
     VALUES (gen_random_uuid(), $1::uuid, 'cafe24', 'oauth_state', $2, $3::jsonb, 'received', NOW() - make_interval(mins => $4))`,
    [companyId, `state:${nonce}`, JSON.stringify({ mall_id: 'm-' + nonce, nonce }), ageMin],
  );
};

beforeAll(async () => {
  await insertMinimalRow(pool, 'companies', { id: A });
  await insertMinimalRow(pool, 'companies', { id: B });
});

describe('M24 승인 묶기', () => {
  const seen: any[] = [];
  const save = async (st: any, p: any) => { seen.push([st.mall_id, p]); return st.mall_id; };
  it('확정 = 승인을 시작한 회사 + 콜백이 준 확정 표 · 한 번만 · 다른 회사 · 틀린 표 · 다른 출처 = 저장 0(행 그대로)', async () => {
    await state(A, 'n1');
    const confirm = await stashPendingApproval(A, 'cafe24', 'n1', { access_token: 'at', refresh_token: 'rt' });
    expect(await confirmPendingApproval(B, 'cafe24', confirm, save)).toBeNull();
    expect(await confirmPendingApproval(A, 'cafe24', 'wrong-confirm-token-xxxxxxxx', save)).toBeNull();
    expect(await confirmPendingApproval(A, 'imweb', confirm, save)).toBeNull();
    expect(seen).toEqual([]);
    expect(await confirmPendingApproval(A, 'cafe24', confirm, save)).toEqual({ result: 'm-n1' });
    expect(seen).toEqual([['m-n1', { access_token: 'at', refresh_token: 'rt' }]]);
    expect(await confirmPendingApproval(A, 'cafe24', confirm, save)).toBeNull();
  });
  it('저장이 던지면 승인 행이 남아 다시 확정된다(Codex R1 #7) · 동시 두 번 = 한 번만 저장', async () => {
    await state(A, 'n3');
    const confirm = await stashPendingApproval(A, 'cafe24', 'n3', { access_token: 'x' });
    await expect(confirmPendingApproval(A, 'cafe24', confirm, async () => { throw new Error('save down'); })).rejects.toThrow('save down');
    let saves = 0;
    const slow = async (st: any) => { saves++; await new Promise((r) => setTimeout(r, 150)); return st.mall_id; };
    const [a, b] = await Promise.all([confirmPendingApproval(A, 'cafe24', confirm, slow), confirmPendingApproval(A, 'cafe24', confirm, slow)]);
    expect([a, b].filter(Boolean)).toEqual([{ result: 'm-n3' }]);
    expect(saves).toBe(1);
  });
  it('저장은 넘겨받은 실행자로 = 승인 행 지우기와 한 커밋(Codex R2 #1) · 저장 뒤 실패하면 저장도 되돌린다', async () => {
    await state(A, 'n4');
    const confirm = await stashPendingApproval(A, 'cafe24', 'n4', { access_token: 'y' });
    await expect(confirmPendingApproval(A, 'cafe24', confirm, async (_st, _p, run) => {
      await run(`UPDATE companies SET updated_at = '2000-01-01' WHERE id = $1::uuid`, [A]);
      throw new Error('after save');
    })).rejects.toThrow('after save');
    expect((await query(`SELECT updated_at::date::text AS d FROM companies WHERE id = $1::uuid`, [A])).rows[0].d).not.toBe('2000-01-01');
    const ok = await confirmPendingApproval(A, 'cafe24', confirm, async (st, _p, run) => {
      await run(`UPDATE companies SET updated_at = NOW() WHERE id = $1::uuid`, [A]);
      return st.mall_id;
    });
    expect(ok).toEqual({ result: 'm-n4' });
  });
  it('1시간 지난 승인 = 확정 0 · 없는 승인에 담기 = 던짐', async () => {
    await state(A, 'n2', 61);
    const confirm = await stashPendingApproval(A, 'cafe24', 'n2', { x: 1 });
    expect(await confirmPendingApproval(A, 'cafe24', confirm, save)).toBeNull();
    await expect(stashPendingApproval(A, 'cafe24', 'nope', { x: 1 })).rejects.toThrow();
  });
});

describe('K11 첫 가져오기 판정(첫 구매 보호)', () => {
  const row = async (mallId: string, meta: object, status = 'active') => {
    await query(
      `INSERT INTO company_integrations (id, company_id, provider, mall_id, access_token, refresh_token, scope, meta, status, created_at, updated_at)
       VALUES (gen_random_uuid(), $1::uuid, 'woocommerce', $2, '', '', '', $3::jsonb, $4, NOW(), NOW())`,
      [B, mallId, JSON.stringify(meta), status],
    );
  };
  const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
  it('도는 중(우커머스 단계 · 그 밖 표시) + 48시간 안 = 참 · 끝남 · 48시간 넘음 · 꼴 밖 시각 · 해제 행 = 거짓', async () => {
    expect(await isFirstImportRunning(B)).toBe(false);
    await row('done.example', { woo_backfill: { stage: 'done', started_at: ago(1) } });
    await row('old.example', { woo_backfill: { stage: 'orders', started_at: ago(49) } });
    await row('bad.example', { woo_backfill: { stage: 'orders', started_at: 'not-a-time' } });
    await row('gone.example', { woo_backfill: { stage: 'orders', started_at: ago(1) } }, 'revoked');
    expect(await isFirstImportRunning(B)).toBe(false);
    await row('run.example', { woo_backfill: { stage: 'customers', started_at: ago(2) } });
    expect(await isFirstImportRunning(B)).toBe(true);
    await query(`UPDATE company_integrations SET meta = meta || '{"woo_backfill":{"stage":"done"}}'::jsonb WHERE company_id = $1::uuid AND mall_id = 'run.example'`, [B]);
    expect(await isFirstImportRunning(B)).toBe(false);
    await query(`UPDATE company_integrations SET meta = meta || jsonb_build_object('first_import_started_at', $2::text) WHERE company_id = $1::uuid AND mall_id = 'done.example'`, [B, ago(3)]);
    expect(await isFirstImportRunning(B)).toBe(true);
  });
});
