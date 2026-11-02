// replaces: none
/**
 * 자동마케팅 회차 안내 — 실 PostgreSQL(★ 2026-11-02 설계서 docs/2026-11-02-journey-automarketing-core-fix-design.md 3-2 D)
 *
 * 사람이 승인해 예약된 회차 = 발송 시각 − 준비 시간에 안내 한 통(원장 admin_notified_at) · 승인 대기 회차 = 「승인하지 않으면 보내지 않아요」 한 통
 * (원장 meta.unapprovedNoticeAt · meta 가 없는 옛 행도 기록이 남는다) · 아직 이른 회차 · 자동 예약 회차 · 리마인드 = 0 · 두 번 돌려도 더 보내지 않는다.
 * 바깥(인증 라인 적재)만 시험이 쥔다.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';

const ctl = vi.hoisted(() => ({ sent: [] as string[], fail: false, alerts: [] as string[] }));
vi.mock('../sms-queue', async (orig) => {
  const real: any = await orig();
  return {
    ...real,
    getAuthSmsTable: async () => 'SMSQ_TEST',
    bulkInsertSmsQueue: async (_t: string[], rows: any[][]) => { if (ctl.fail) return 0; ctl.sent.push(String(rows[0]?.[2] ?? '')); return rows.length; },
  };
});
vi.mock('../system-alert', () => ({ sendSystemAlert: async (p: any) => { ctl.alerts.push(String(p?.dedupKey)); return 1; } }));

import { randomUUID } from 'crypto';
import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { deliverRoundNotices, ROUND_NOTICE_BATCH } from '../continuous-operator';
import { autoSendLeadMinutesSql, resolveAutoSendLeadMinutes } from '../autosend-policy';

const CO = randomUUID();
const OWNER = randomUUID();
const OP = randomUUID();
const OP2 = randomUUID();   // 운영자당 예약 회차 하나(ux_operator_proposals_one_scheduled) — 자동 예약 회차는 다른 운영자
const P = { approved: randomUUID(), pending: randomUUID(), early: randomUUID(), auto: randomUUID(), reminder: randomUUID() };
const inMin = (m: number) => new Date(Date.now() + m * 60_000);

beforeAll(async () => {
  await insertMinimalRow(pool, 'companies', { id: CO, company_name: '회차 안내 시험' });
  await insertMinimalRow(pool, 'users', { id: OWNER, company_id: CO, user_type: 'admin', is_active: true, phone: '010-0000-1102', login_id: 't-1102-round-notice' });
  await insertMinimalRow(pool, 'continuous_operators', {
    id: OP, company_id: CO, name: '주간 안내', status: 'active', created_by: OWNER, auto_send_lead_minutes: 120, admin_phone_numbers: ['01000001301'],
  });
  await insertMinimalRow(pool, 'continuous_operators', {
    id: OP2, company_id: CO, name: '자동 예약', status: 'active', created_by: OWNER, auto_send_lead_minutes: 120, admin_phone_numbers: ['01000001302'],
  });
  const row = (id: string, status: string, at: Date, extra: Record<string, unknown> = {}) =>
    insertMinimalRow(pool, 'operator_proposals', { id, operator_id: OP, company_id: CO, status, scheduled_send_at: at, proposal_json: {}, recipient_count: 120, cost_estimate: 3600, ...extra });
  await row(P.approved, 'scheduled', inMin(60), { reviewed_by: OWNER, reviewed_at: new Date() });
  await row(P.pending, 'pending', inMin(60));                                     // meta 없는 옛 꼴
  await row(P.early, 'pending', inMin(300), { proposal_json: { meta: { roundKey: 'x' } } });   // 준비 시간(120분) 전
  await row(P.auto, 'scheduled', inMin(60), { operator_id: OP2 });                 // 자동 예약 = 만들 때 이미 안내
  await row(P.reminder, 'pending', inMin(60), { proposal_json: { meta: { is_reminder: true } } });
});

describe('3-2 D 회차 안내', () => {
  it('승인 예약 · 승인 대기 각 한 통 · 원장 기록 · 이른 회차 · 자동 예약 · 리마인드 = 0', async () => {
    await deliverRoundNotices();
    expect(ctl.sent).toHaveLength(2);
    const r = await pool.query(
      `SELECT id, admin_notified_at IS NOT NULL AS notified, proposal_json->'meta'->>'unapprovedNoticeAt' AS unapproved FROM operator_proposals WHERE operator_id = ANY($1::uuid[])`,
      [[OP, OP2]],
    );
    const by = new Map(r.rows.map((x) => [String(x.id), x]));
    expect(by.get(P.approved).notified).toBe(true);
    expect(by.get(P.pending).unapproved).not.toBeNull();
    expect(by.get(P.early).unapproved).toBeNull();
    expect(by.get(P.auto).notified).toBe(false);
    expect(by.get(P.reminder).unapproved).toBeNull();
  });

  it('다시 돌려도 더 보내지 않는다(meta 없던 옛 행 포함)', async () => {
    await deliverRoundNotices();
    expect(ctl.sent).toHaveLength(2);
  });
});

describe('3-2 D 회차 안내 고르기 = LIMIT 앞 거름(R12)', () => {
  it('준비 시간 SQL 판 = JS 규칙과 같은 값(비었거나 0 이하 = 120 · 상한 1440)', async () => {
    for (const v of [null, 0, -5, 30, 600, 1440, 5000]) {
      const r = await pool.query(`SELECT ${autoSendLeadMinutesSql('$1::int')} AS m`, [v]);
      expect(Number(r.rows[0].m), String(v)).toBe(resolveAutoSendLeadMinutes(v));
    }
  });
  it(`안내 때가 안 된 회차 ${ROUND_NOTICE_BATCH + 1}개가 앞에 있어도 안내 때가 된 뒤 회차 = 이번에 안내`, async () => {
    const short = randomUUID(); const long = randomUUID();
    await insertMinimalRow(pool, 'continuous_operators', { id: short, company_id: CO, name: '짧은 준비', status: 'active', created_by: OWNER, auto_send_lead_minutes: 5, admin_phone_numbers: ['01000001303'] });
    await insertMinimalRow(pool, 'continuous_operators', { id: long, company_id: CO, name: '긴 준비', status: 'active', created_by: OWNER, auto_send_lead_minutes: 600, admin_phone_numbers: ['01000001304'] });
    for (let i = 0; i < ROUND_NOTICE_BATCH + 1; i++) {
      await insertMinimalRow(pool, 'operator_proposals', { id: randomUUID(), operator_id: short, company_id: CO, status: 'pending', scheduled_send_at: inMin(30 + i), proposal_json: { meta: { roundKey: `s${i}` } } });
    }
    const due = randomUUID();
    await insertMinimalRow(pool, 'operator_proposals', { id: due, operator_id: long, company_id: CO, status: 'pending', scheduled_send_at: inMin(120), proposal_json: { meta: { roundKey: 'l' } } });
    const before = ctl.sent.length;
    await deliverRoundNotices();
    expect(ctl.sent.length - before).toBe(1);
    expect((await pool.query(`SELECT proposal_json->'meta'->>'unapprovedNoticeAt' AS n FROM operator_proposals WHERE id = $1`, [due])).rows[0].n).not.toBeNull();
  });
});

describe('3-2 D 회차 안내 못 보냄 = 시도 상한(R8)', () => {
  it('적재 실패 3번 = 고르기에서 빠짐 · 운영 경보 한 통 · 넷째 분 = 시도 0', async () => {
    const op = randomUUID();
    await insertMinimalRow(pool, 'continuous_operators', { id: op, company_id: CO, name: '못 받는 담당자', status: 'active', created_by: OWNER, auto_send_lead_minutes: 120, admin_phone_numbers: ['01000001305'] });
    const p = randomUUID();
    await insertMinimalRow(pool, 'operator_proposals', { id: p, operator_id: op, company_id: CO, status: 'pending', scheduled_send_at: inMin(60), proposal_json: { meta: { roundKey: 'f' } } });
    await pool.query(`UPDATE operator_proposals SET proposal_json = jsonb_set(proposal_json, '{meta,unapprovedNoticeAt}', to_jsonb(NOW()::text)) WHERE operator_id <> $1 AND status = 'pending'`, [op]);   // 앞 시험 행 = 안내함(이 시험만 보게)
    ctl.fail = true;
    try {
      for (let i = 0; i < 4; i++) await deliverRoundNotices();
    } finally { ctl.fail = false; }
    const meta = (await pool.query(`SELECT proposal_json->'meta' AS m FROM operator_proposals WHERE id = $1`, [p])).rows[0].m;
    expect(meta.roundNoticeAttempts).toBe(3);
    expect(meta.unapprovedNoticeAt).toBeUndefined();
    expect(ctl.alerts).toContain(`operator-round-notice:${p}`);
  });
});
