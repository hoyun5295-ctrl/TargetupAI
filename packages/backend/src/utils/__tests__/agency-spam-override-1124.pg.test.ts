// replaces: none
/**
 * 대행발송 「그대로 보내기」 실행 트랜잭션(★ 2026-11-24 · 설계서 docs/2026-11-24-agency-spam-override-design.md §4 3) — 실 PostgreSQL 판.
 *   성공 = 보낼 글 · 버전 +1(같은 글도) · 승인 대기 · 당일 검사 끝 · 표식 삭제 · 사건 한 트랜잭션 / 수정 번호 어긋남 = 409 / 막힘 아님 = 400 / 두 번째 = 거절.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';

// 발신 인증(3.5) 관문 = 승인 CT 의 공용 함수 · 이 시험은 막힌 갈래만 바꿔 본다(인증번호 문자 발송 0)
const gateState = vi.hoisted(() => ({ fail: false }));
vi.mock('../agency-send-approve', async (orig) => ({
  ...(await orig<typeof import('../agency-send-approve')>()),
  agencySenderAuthGate: vi.fn(async () => (gateState.fail
    ? { ok: false, reason: 'first', challengeId: 'c-1', maskedPhone: '010-****-0000', callback: '0221231124', expiresInMinutes: 5 }
    : { ok: true })),
}));
import { randomUUID } from 'crypto';
import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { overrideSpamBlockTx, rescheduleAgencyRequestTx } from '../agency-send-change';
import { isSameKstDay } from '../agency-send-state';

const CO = randomUUID();
const ACTOR = randomUUID();
/** 그 시각의 KST 날짜에서 days 뒤 10시(KST) */
const kstTenOclock = (d: Date, days: number) => { const k = new Date(d.getTime() + 9 * 3_600_000); return new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() + days, 1, 0)); };

async function blockedRow(o: { requestedAt: Date; checkedAt: Date; marker?: boolean; version?: number; tested?: boolean }): Promise<string> {
  const id = randomUUID();
  const version = o.version ?? 2;
  await insertMinimalRow(pool, 'agency_send_requests', {
    id, company_id: CO, status: 'test_failed', source: 'screen', content_version: version, revision: 5,
    original_content: '(광고) 하늘몰 겨울 행사\n무료 수신거부 080-000-0000', current_content: '(광고) 하늘몰 겨울 행사 다듬은 글\n무료 수신거부 080-000-0000',
    file_name: '겨울 행사.xlsx', message_type: 'SMS', callback_number: '0221231124', manager_phone: '01000000000', phone_column: '전화번호',
    requested_at: o.requestedAt,
    last_test_result: JSON.stringify({ round: 3, ...(o.marker === false ? {} : { spamOverridable: { version, submitted: '(광고) 하늘몰 겨울 행사\n무료 수신거부 080-000-0000', checkedAt: o.checkedAt.toISOString(), submittedTested: o.tested ?? true } }) }),
  });
  return id;
}

describe('overrideSpamBlockTx (실 PG)', () => {
  beforeAll(async () => { await insertMinimalRow(pool, 'companies', { id: CO }); });

  it('다른 날 막힘 = 보낼 글 · 버전 +1 · 승인 대기 · 당일 검사 끝 없음 · 표식 삭제 · 사건 · 두 번째 = 거절', async () => {
    const id = await blockedRow({ requestedAt: new Date(Date.now() + 3 * 86_400_000), checkedAt: new Date() });
    const out = await overrideSpamBlockTx({ requestId: id, companyId: CO, ownerUserId: null, revision: 5, actorUserId: ACTOR });
    expect(out.ok).toBe(true);
    const r = (await pool.query(`SELECT * FROM agency_send_requests WHERE id = $1`, [id])).rows[0];
    expect(r.status).toBe('awaiting_approval');
    expect(Number(r.content_version)).toBe(3);
    expect(r.current_content).toBe('(광고) 하늘몰 겨울 행사\n무료 수신거부 080-000-0000');
    expect(r.original_content).toBe('(광고) 하늘몰 겨울 행사\n무료 수신거부 080-000-0000');
    expect(r.final_test_at).toBeNull();
    expect(r.last_test_result?.spamOverridable).toBeUndefined();
    expect(r.last_test_result?.round).toBe(3);   // 나머지 키 그대로
    const ev = (await pool.query(`SELECT payload FROM agency_send_events WHERE request_id = $1 AND kind = 'spam_override'`, [id])).rows;
    expect(ev.length).toBe(1);
    expect(ev[0].payload).toMatchObject({ version: 3, fromVersion: 2 });
    const again = await overrideSpamBlockTx({ requestId: id, companyId: CO, ownerUserId: null, revision: Number(r.revision), actorUserId: ACTOR });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.status).toBe(400);
  });

  it('같은 글이어도 버전은 오른다(옛 승인 링크 무효)', async () => {
    const id = await blockedRow({ requestedAt: new Date(Date.now() + 3 * 86_400_000), checkedAt: new Date() });
    await pool.query(`UPDATE agency_send_requests SET current_content = original_content WHERE id = $1`, [id]);
    const out = await overrideSpamBlockTx({ requestId: id, companyId: CO, ownerUserId: null, revision: 5, actorUserId: ACTOR });
    expect(out.ok).toBe(true);
    if (out.ok) expect(Number(out.row.content_version)).toBe(3);
  });

  it('당일 막힘(2시간 안쪽) = 당일 검사 끝 = 막힌 시각', async () => {
    // 막힌 시각 = 보낼 시각과 같은 순간(어느 시각에 돌려도 같은 KST 날 · 판정은 날짜만 본다)
    const requestedAt = new Date(Date.now() + 90 * 60_000);
    const checkedAt = new Date(requestedAt.getTime());
    expect(isSameKstDay(checkedAt, requestedAt)).toBe(true);
    const id = await blockedRow({ requestedAt, checkedAt });
    const out = await overrideSpamBlockTx({ requestId: id, companyId: CO, ownerUserId: null, revision: 5, actorUserId: ACTOR });
    expect(out.ok).toBe(true);
    if (out.ok) expect(new Date(out.row.final_test_at).getTime()).toBe(checkedAt.getTime());
  });

  it('당일 막힘이어도 보낼 글을 검사하지 않은 표식(다듬은 글만 막힘) = 당일 검사 끝 없음 · 2시간 안쪽이면 고를 수 없다(Codex 구현 1R #2)', async () => {
    const requestedAt = new Date(Date.now() + 90 * 60_000);
    const id = await blockedRow({ requestedAt, checkedAt: new Date(requestedAt.getTime()), tested: false });
    const out = await overrideSpamBlockTx({ requestId: id, companyId: CO, ownerUserId: null, revision: 5, actorUserId: ACTOR });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.status).toBe(400);
    const far = await blockedRow({ requestedAt: new Date(Date.now() + 3 * 86_400_000), checkedAt: new Date(Date.now() + 3 * 86_400_000), tested: false });
    const ok = await overrideSpamBlockTx({ requestId: far, companyId: CO, ownerUserId: null, revision: 5, actorUserId: ACTOR });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.row.final_test_at).toBeNull();
  });

  it('이미 어긋난 수정 번호 = 인증번호 앞에서 409(관문을 부르지 않는다 · Codex 구현 2R #1)', async () => {
    const id = await blockedRow({ requestedAt: new Date(Date.now() + 3 * 86_400_000), checkedAt: new Date() });
    gateState.fail = true;
    try {
      const out = await overrideSpamBlockTx({ requestId: id, companyId: CO, ownerUserId: null, revision: 4, actorUserId: ACTOR });
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.status).toBe(409);
    } finally { gateState.fail = false; }
  });

  it('발신 인증에 막히면 403 · 상태 · 버전 · 표식 · 사건 그대로(Codex 구현 1R #1)', async () => {
    const id = await blockedRow({ requestedAt: new Date(Date.now() + 3 * 86_400_000), checkedAt: new Date() });
    gateState.fail = true;
    try {
      const out = await overrideSpamBlockTx({ requestId: id, companyId: CO, ownerUserId: null, revision: 5, actorUserId: ACTOR });
      expect(out.ok).toBe(false);
      if (!out.ok) { expect(out.status).toBe(403); expect(out.code).toBe('SENDER_AUTH_REQUIRED'); expect('senderAuth' in out).toBe(true); }
    } finally { gateState.fail = false; }
    const r = (await pool.query(`SELECT status, content_version, revision, last_test_result FROM agency_send_requests WHERE id = $1`, [id])).rows[0];
    expect(r).toMatchObject({ status: 'test_failed', content_version: 2, revision: 5 });
    expect(r.last_test_result?.spamOverridable?.version).toBe(2);
    const ev = (await pool.query(`SELECT 1 FROM agency_send_events WHERE request_id = $1 AND kind = 'spam_override'`, [id])).rows;
    expect(ev.length).toBe(0);
  });

  it('당일 막힘을 고른 뒤 다른 날로 시각 변경 = 당일 검사 끝 지움(다음 날 2시간 전 재검사가 다시 돈다 · 설계 §4 4)', async () => {
    const requestedAt = new Date(Date.now() + 90 * 60_000);
    const id = await blockedRow({ requestedAt, checkedAt: new Date(requestedAt.getTime()) });
    await pool.query(`UPDATE agency_send_requests SET callback_number = '' WHERE id = $1`, [id]);   // 회신번호 등록 확인은 이 시험 밖
    const out = await overrideSpamBlockTx({ requestId: id, companyId: CO, ownerUserId: null, revision: 5, actorUserId: ACTOR });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.row.final_test_at).not.toBeNull();
    const moved = await rescheduleAgencyRequestTx({
      requestId: id, companyId: CO, ownerUserId: null, revision: Number(out.row.revision),
      requestedAt: kstTenOclock(requestedAt, 2).toISOString(), via: 'screen',   // 발송 허용 시간(9 ~ 21시) 안 · 다른 KST 날
    });
    expect(moved.ok ? 'ok' : JSON.stringify({ s: (moved as any).status, e: (moved as any).error })).toBe('ok');
    if (moved.ok) {
      expect(moved.row.status).toBe('awaiting_approval');
      expect(moved.row.final_test_at).toBeNull();
    }
  });

  it('수정 번호 어긋남 = 409 · 표식 없음(막힘 아닌 test_failed) = 400 · 버전 다름 = 400', async () => {
    const a = await blockedRow({ requestedAt: new Date(Date.now() + 3 * 86_400_000), checkedAt: new Date() });
    const stale = await overrideSpamBlockTx({ requestId: a, companyId: CO, ownerUserId: null, revision: 4, actorUserId: ACTOR });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.status).toBe(409);
    const b = await blockedRow({ requestedAt: new Date(Date.now() + 3 * 86_400_000), checkedAt: new Date(), marker: false });
    const noMarker = await overrideSpamBlockTx({ requestId: b, companyId: CO, ownerUserId: null, revision: 5, actorUserId: ACTOR });
    expect(noMarker.ok).toBe(false);
    if (!noMarker.ok) expect(noMarker.status).toBe(400);
    const c = await blockedRow({ requestedAt: new Date(Date.now() + 3 * 86_400_000), checkedAt: new Date() });
    await pool.query(`UPDATE agency_send_requests SET content_version = 9 WHERE id = $1`, [c]);
    const other = await overrideSpamBlockTx({ requestId: c, companyId: CO, ownerUserId: null, revision: 5, actorUserId: ACTOR });
    expect(other.ok).toBe(false);
  });

  it('다른 회사 · 다른 사용자 접수 = 404', async () => {
    const id = await blockedRow({ requestedAt: new Date(Date.now() + 3 * 86_400_000), checkedAt: new Date() });
    const otherCo = await overrideSpamBlockTx({ requestId: id, companyId: randomUUID(), ownerUserId: null, revision: 5, actorUserId: ACTOR });
    expect(otherCo.ok).toBe(false);
    if (!otherCo.ok) expect(otherCo.status).toBe(404);
    const otherUser = await overrideSpamBlockTx({ requestId: id, companyId: CO, ownerUserId: randomUUID(), revision: 5, actorUserId: ACTOR });
    expect(otherUser.ok).toBe(false);
    if (!otherUser.ok) expect(otherUser.status).toBe(404);
  });

  it('setStatus 의 표식 연산 = SQL NULL 그대로 · 나머지 키 그대로', async () => {
    const r = await pool.query(`SELECT (NULL::jsonb) - 'spamOverridable' AS a, ('{"x":1,"spamOverridable":{"version":1}}'::jsonb) - 'spamOverridable' AS b,
      jsonb_set(COALESCE(NULL::jsonb, '{}'::jsonb), '{spamOverridable}', '{"version":2}'::jsonb) AS c`);
    expect(r.rows[0].a).toBeNull();
    expect(r.rows[0].b).toEqual({ x: 1 });
    expect(r.rows[0].c).toEqual({ spamOverridable: { version: 2 } });
  });
});
