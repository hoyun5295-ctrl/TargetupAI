// replaces: none
/**
 * 발신번호 → 비토엔진 허용 발신번호 거울(★ 2026-11-24 · B-1124-3 · 설계서 docs/2026-11-24-callback-bito-sync-design.md §4) — 실 PostgreSQL 판.
 *   목록 = V 회사만 · 번호 0 회사 포함 · 회사 단위 판정 집합(지정 사용자 번호 · 원장 전용 번호 포함 · 규격 위반 제외)
 *   저장 = 회차 한 행으로 새 회차만(옛 · 같은 회차 = stale · 결과 행이 없을 때 빈 새 회차 뒤 옛 회차 = 0행) · 화면 칸.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { ledgerBlockSql } from './pg/global-setup';
import { listBitoSenderCompanies, saveBitoSyncResults, loadBitoSyncViews, BITO_SYNC_STALE_MS, isBitoCompany } from '../bito-sender-sync';

const BITO = randomUUID();    // V 둘 · 번호 셋(전체 · 지정 사용자 · 규격 위반) + 원장 전용 번호 하나
const EMPTY = randomUUID();   // V 하나 · 번호 0
const QT = randomUUID();      // B 발송ID 만 = 대상 아님
const tag = String(Math.floor(Math.random() * 10_000)).padStart(4, '0');   // V 판정 = 숫자만(★Codex 구현 1R #4)

beforeAll(async () => {
  for (const id of [BITO, EMPTY, QT]) await insertMinimalRow(pool, 'companies', { id });
  await insertMinimalRow(pool, 'company_agent_ids', { company_id: BITO, agent_send_id: `V9${tag}1` });
  await insertMinimalRow(pool, 'company_agent_ids', { company_id: BITO, agent_send_id: `V9${tag}2` });
  await insertMinimalRow(pool, 'company_agent_ids', { company_id: EMPTY, agent_send_id: `V9${tag}3` });
  await insertMinimalRow(pool, 'company_agent_ids', { company_id: QT, agent_send_id: `B9${tag}4` });
  await insertMinimalRow(pool, 'callback_numbers', { company_id: BITO, phone: '02-1234-5678', assignment_scope: 'all' });
  await insertMinimalRow(pool, 'callback_numbers', { company_id: BITO, phone: '031-555-6666', assignment_scope: 'assigned' });
  await insertMinimalRow(pool, 'callback_numbers', { company_id: BITO, phone: '02-1234-56#7', assignment_scope: 'all' });   // 허용 밖 문자 = 규격 위반
  await insertMinimalRow(pool, 'sender_numbers', { company_id: BITO, phone_number: '1588-0000', is_active: true });          // 원장에만
  await insertMinimalRow(pool, 'callback_numbers', { company_id: QT, phone: '02-9999-0000', assignment_scope: 'all' });
});

describe('bito-sender-sync (실 PG)', () => {
  it('DDL 전 = 관리 화면 칸 없음(목록을 막지 않는다) · 그 뒤 원장 블록 C161-DDL-1 그대로 얹는다', async () => {
    const before = await loadBitoSyncViews([{ id: 'a', company_id: BITO, phone: '02-1234-5678' }]);
    expect(before.size).toBe(0);
    await pool.query(ledgerBlockSql('C161-DDL-1'));
    const cols = await pool.query(`SELECT table_name, count(*)::int AS n FROM information_schema.columns WHERE table_name IN ('bito_sender_sync', 'bito_sender_sync_round') GROUP BY 1 ORDER BY 1`);
    expect(cols.rows).toEqual([{ table_name: 'bito_sender_sync', n: 8 }, { table_name: 'bito_sender_sync_round', n: 2 }]);   // 원장 「확인」 칸과 같은 값
  });

  it('목록 = V 회사만 · 번호 0 회사 포함 · 회사 단위 판정 집합(지정 사용자 · 원장 포함 · 규격 위반 제외)', async () => {
    const list = await listBitoSenderCompanies();
    const mine = list.filter((c) => [BITO, EMPTY, QT].includes(c.companyId));
    expect(mine.map((c) => c.companyId).sort()).toEqual([BITO, EMPTY].sort());
    const b = mine.find((c) => c.companyId === BITO)!;
    expect(b.agentSendIds).toEqual([`V9${tag}1`, `V9${tag}2`]);
    expect(b.numbers).toEqual(['0212345678', '0315556666', '15880000']);   // 숫자 · 정렬 · 규격 위반 0
    expect(mine.find((c) => c.companyId === EMPTY)!.numbers).toEqual([]);
    expect(await isBitoCompany(BITO)).toBe(true);
    expect(await isBitoCompany(QT)).toBe(false);
  });

  it('저장 = 새 회차만 · 옛 · 같은 회차 stale · 결과 행이 없을 때 빈 새 회차 뒤 옛 회차 = 0행', async () => {
    const t0 = new Date(Date.now() - 120_000);
    const t1 = new Date(Date.now() - 60_000);
    const r = (o: string) => ({ companyId: BITO, phone: '0212345678', agentSendId: `V9${tag}1`, customerId: 16, outcome: o as any, reason: null });
    // 결과 행이 하나도 없는 번호(0315556666)로: 빈 새 회차(t1)를 먼저 받은 뒤 닿은 옛 회차(t0) = 0행
    expect(await saveBitoSyncResults(t1, [])).toBe('saved');
    expect(await saveBitoSyncResults(t0, [{ ...r('registered'), phone: '0315556666' }])).toBe('stale');
    expect((await pool.query(`SELECT 1 FROM bito_sender_sync WHERE company_id = $1 AND phone = '0315556666'`, [BITO])).rows.length).toBe(0);
    const t2 = new Date(Date.now() - 30_000);
    expect(await saveBitoSyncResults(t2, [r('registered')])).toBe('saved');
    expect(await saveBitoSyncResults(t2, [r('blocked_in_bito')])).toBe('stale');   // 같은 회차 재전송
    expect(await saveBitoSyncResults(t1, [r('mapping_conflict')])).toBe('stale');  // 옛 회차
    const row = (await pool.query(`SELECT outcome, round_at FROM bito_sender_sync WHERE company_id = $1 AND phone = '0212345678'`, [BITO])).rows[0];
    expect(row.outcome).toBe('registered');
    expect(new Date(row.round_at).getTime()).toBe(t2.getTime());
  });

  it('화면 칸 = 지금 번호 숫자로 찾기 · V 둘 중 하나 빠짐 = checking · 둘 다 = 가장 나쁜 것 · 5분 지남 = delayed · V 없는 회사 = 칸 없음', async () => {
    const t3 = new Date(Date.now() - 10_000);
    await saveBitoSyncResults(t3, [
      { companyId: BITO, phone: '0212345678', agentSendId: `V9${tag}1`, customerId: 16, outcome: 'registered', reason: null },
      { companyId: BITO, phone: '0212345678', agentSendId: `V9${tag}2`, customerId: 16, outcome: 'manual_blocked', reason: null },
      { companyId: BITO, phone: '0315556666', agentSendId: `V9${tag}1`, customerId: 16, outcome: 'registered', reason: null },
    ]);
    const rows = [
      { id: 'a', company_id: BITO, phone: '02-1234-5678' },
      { id: 'b', company_id: BITO, phone: '031-555-6666' },
      { id: 'c', company_id: BITO, phone: '02-1234-56#7' },
      { id: 'd', company_id: QT, phone: '02-9999-0000' },
    ];
    const v = await loadBitoSyncViews(rows);
    expect(v.get('a')?.status).toBe('manual_blocked');
    expect(v.get('b')?.status).toBe('checking');
    expect(v.get('c')?.status).toBe('invalid');
    expect(v.has('d')).toBe(false);
    const later = await loadBitoSyncViews(rows, new Date(Date.now() + BITO_SYNC_STALE_MS + 60_000));
    expect(later.get('a')?.status).toBe('delayed');
  });
});
