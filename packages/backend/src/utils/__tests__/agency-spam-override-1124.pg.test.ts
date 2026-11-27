// replaces: none
/**
 * 대행발송 「그대로 보내기」 실행 트랜잭션(★ 2026-11-24 · 설계서 docs/2026-11-24-agency-spam-override-design.md §4 3) — 실 PostgreSQL 판.
 * ★ 2026-11-27 C167-C(R113 · 설계서 docs/2026-11-27-c167-agency-spam-choice-design.md §5-3) — 「{처음 접수한 문안} 그대로 승인」 = 글 교체 + 승인 한 트랜잭션.
 *   성공 = 보낼 글 · 버전 +1(같은 글도) · approved · approval_version = 새 버전 · 당일 검사 끝 · 표식 삭제 · 사건 spam_override + approved /
 *   상태 = test_failed · 승인 대기 · 재승인(고친 글로 승인을 묻는 중) / 주체 = 로그인 · 담당자 링크 / 실패 = 상태 변경 0.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';

// 발신 인증(3.5) 관문 = 승인 CT 의 공용 함수 · 이 시험은 막힌 갈래만 바꿔 본다(인증번호 문자 발송 0)
const gateState = vi.hoisted(() => ({ fail: false, calls: 0 }));
vi.mock('../agency-send-approve', async (orig) => ({
  ...(await orig<typeof import('../agency-send-approve')>()),
  agencySenderAuthGate: vi.fn(async () => {
    gateState.calls += 1;
    return gateState.fail
      ? { ok: false, reason: 'first', challengeId: 'c-1', maskedPhone: '010-****-0000', callback: '0221231124', expiresInMinutes: 5 }
      : { ok: true };
  }),
}));
// 적재 워커 깨움 = 이 시험 밖(커밋 뒤 부르는지만 소스 계약이 본다)
vi.mock('../agency-send-worker', async (orig) => ({
  ...(await orig<typeof import('../agency-send-worker')>()),
  triggerAgencySendDispatch: vi.fn(),
}));
import { randomUUID } from 'crypto';
import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { overrideSpamBlockTx, rescheduleAgencyRequestTx, type AgencyOverrideActor } from '../agency-send-change';
import { isSameKstDay } from '../agency-send-state';

const CO = randomUUID();
const ACTOR = randomUUID();
const PHONE = '01000000000';
const screen = (ownerUserId: string | null = null): AgencyOverrideActor => ({ via: 'screen', userId: ACTOR, ownerUserId });
const SUBMITTED = '(광고) 하늘몰 겨울 행사\n무료 수신거부 080-000-0000';
/** 그 시각의 KST 날짜에서 days 뒤 10시(KST) */
const kstTenOclock = (d: Date, days: number) => { const k = new Date(d.getTime() + 9 * 3_600_000); return new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() + days, 1, 0)); };

async function blockedRow(o: {
  requestedAt: Date; checkedAt: Date; marker?: boolean; version?: number; tested?: boolean;
  status?: string; current?: string; submitted?: string; approvalRequestedAt?: Date | null;
}): Promise<string> {
  const id = randomUUID();
  const version = o.version ?? 2;
  const submitted = o.submitted ?? SUBMITTED;
  await insertMinimalRow(pool, 'agency_send_requests', {
    id, company_id: CO, status: o.status ?? 'test_failed', source: 'screen', content_version: version, revision: 5,
    original_content: submitted, current_content: o.current ?? '(광고) 하늘몰 겨울 행사 다듬은 글\n무료 수신거부 080-000-0000',
    file_name: '겨울 행사.xlsx', message_type: 'SMS', callback_number: '0221231124', manager_phone: PHONE, phone_column: '전화번호',
    requested_at: o.requestedAt,
    ...(o.approvalRequestedAt !== undefined ? { approval_requested_at: o.approvalRequestedAt } : {}),
    last_test_result: JSON.stringify({ round: 3, ...(o.marker === false ? {} : { spamOverridable: { version, submitted, checkedAt: o.checkedAt.toISOString(), submittedTested: o.tested ?? true } }) }),
  });
  return id;
}
const rowOf = async (id: string) => (await pool.query(`SELECT * FROM agency_send_requests WHERE id = $1`, [id])).rows[0];
const eventsOf = async (id: string, kind: string) => (await pool.query(`SELECT payload FROM agency_send_events WHERE request_id = $1 AND kind = $2`, [id, kind])).rows;

describe('overrideSpamBlockTx = 처음 문안 그대로 승인(실 PG)', () => {
  beforeAll(async () => {
    await insertMinimalRow(pool, 'companies', { id: CO });
    await insertMinimalRow(pool, 'users', { id: ACTOR, company_id: CO, user_type: 'admin', is_active: true, phone: '010-0000-1127', login_id: `t-c167-${ACTOR.slice(0, 8)}` });
  });

  it('test_failed 다른 날 = 보낼 글 · 버전 +1 · 승인 · 승인 버전 = 새 버전 · 당일 검사 끝 없음 · 표식 삭제 · 사건 둘 · 두 번째 = 거절', async () => {
    const id = await blockedRow({ requestedAt: new Date(Date.now() + 3 * 86_400_000), checkedAt: new Date() });
    const out = await overrideSpamBlockTx({ requestId: id, companyId: CO, actor: screen(), revision: 5 });
    expect(out.ok ? 'ok' : JSON.stringify(out)).toBe('ok');
    const r = await rowOf(id);
    expect(r.status).toBe('approved');
    expect(Number(r.content_version)).toBe(3);
    expect(Number(r.approval_version)).toBe(3);
    expect(r.approved_by).toBe(ACTOR);
    expect(r.approved_at).not.toBeNull();
    expect(r.current_content).toBe(SUBMITTED);
    expect(r.final_test_at).toBeNull();
    expect(r.last_test_result?.spamOverridable).toBeUndefined();
    expect(r.last_test_result?.round).toBe(3);   // 나머지 키 그대로
    expect((await eventsOf(id, 'spam_override'))[0]?.payload).toMatchObject({ version: 3, fromVersion: 2, fromStatus: 'test_failed', via: 'screen', by: ACTOR });
    expect((await eventsOf(id, 'approved'))[0]?.payload).toMatchObject({ revision: 5, via: 'screen', by: ACTOR, submitted: true });
    const again = await overrideSpamBlockTx({ requestId: id, companyId: CO, actor: screen(), revision: Number(r.revision) });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.status).toBe(400);
  });

  it('test_failed 표식 글 = 지금 글(다듬은 글을 버리고 처음 글이 막힘)도 승인 · 버전은 오른다(옛 승인 링크 무효)', async () => {
    const id = await blockedRow({ requestedAt: new Date(Date.now() + 3 * 86_400_000), checkedAt: new Date(), current: SUBMITTED });
    const out = await overrideSpamBlockTx({ requestId: id, companyId: CO, actor: screen(), revision: 5 });
    expect(out.ok).toBe(true);
    if (out.ok) { expect(Number(out.row.content_version)).toBe(3); expect(out.row.status).toBe('approved'); }
  });

  it('승인 대기(고친 글로 통과) = 처음 글로 승인 · 승인 요청 시각 그대로(24시간 마감 유지)', async () => {
    const asked = new Date(Date.now() - 3 * 3_600_000);
    const id = await blockedRow({ requestedAt: new Date(Date.now() + 3 * 86_400_000), checkedAt: new Date(), status: 'awaiting_approval', approvalRequestedAt: asked });
    const out = await overrideSpamBlockTx({ requestId: id, companyId: CO, actor: screen(), revision: 5 });
    expect(out.ok ? 'ok' : JSON.stringify(out)).toBe('ok');
    const r = await rowOf(id);
    expect(r).toMatchObject({ status: 'approved', current_content: SUBMITTED });
    expect(new Date(r.approval_requested_at).getTime()).toBe(asked.getTime());
    expect((await eventsOf(id, 'spam_override'))[0]?.payload).toMatchObject({ fromStatus: 'awaiting_approval' });
  });

  it('승인 대기 24시간 지남 = 거절 · 상태 그대로(일반 승인과 같은 마감 · Codex 설계 1R #1)', async () => {
    const id = await blockedRow({ requestedAt: new Date(Date.now() + 3 * 86_400_000), checkedAt: new Date(), status: 'awaiting_approval', approvalRequestedAt: new Date(Date.now() - 25 * 3_600_000) });
    const out = await overrideSpamBlockTx({ requestId: id, companyId: CO, actor: screen(), revision: 5 });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.status).toBe(400);
    expect(await rowOf(id)).toMatchObject({ status: 'awaiting_approval', content_version: 2, revision: 5 });
  });

  it('승인 대기에서 표식 글 = 지금 글 = 고를 것 없음(400)', async () => {
    const id = await blockedRow({ requestedAt: new Date(Date.now() + 3 * 86_400_000), checkedAt: new Date(), status: 'awaiting_approval', current: SUBMITTED, approvalRequestedAt: new Date() });
    const out = await overrideSpamBlockTx({ requestId: id, companyId: CO, actor: screen(), revision: 5 });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.status).toBe(400);
  });

  it('담당자 링크 = 발신 인증 없이 승인 · 사건에 번호 / 옛 버전 토큰 · 담당자 아닌 번호 = 404 · 상태 그대로', async () => {
    const id = await blockedRow({ requestedAt: new Date(Date.now() + 3 * 86_400_000), checkedAt: new Date() });
    const before = gateState.calls;
    const wrongVer = await overrideSpamBlockTx({ requestId: id, companyId: null, actor: { via: 'link', phone: PHONE, contentVersion: 1 }, revision: 5 });
    expect(wrongVer.ok).toBe(false);
    if (!wrongVer.ok) expect(wrongVer.status).toBe(404);
    const stranger = await overrideSpamBlockTx({ requestId: id, companyId: null, actor: { via: 'link', phone: '01099999999', contentVersion: 2 }, revision: 5 });
    expect(stranger.ok).toBe(false);
    expect(await rowOf(id)).toMatchObject({ status: 'test_failed', content_version: 2 });
    const out = await overrideSpamBlockTx({ requestId: id, companyId: null, actor: { via: 'link', phone: PHONE, contentVersion: 2, ip: '127.0.0.1', ua: 'vitest' }, revision: 5 });
    expect(out.ok ? 'ok' : JSON.stringify(out)).toBe('ok');
    expect(gateState.calls).toBe(before);   // 링크 = 발신 인증 관문을 부르지 않는다
    const r = await rowOf(id);
    expect(r).toMatchObject({ status: 'approved', approved_by: null });
    expect((await eventsOf(id, 'approved'))[0]?.payload).toMatchObject({ via: 'link', phone: PHONE, submitted: true });
  });

  it('표식 글에 채우지 않은 자리 = 확인 값 없으면 409 · 상태 그대로 / 확인 값 있으면 승인', async () => {
    const withBlank = '(광고) OOO점 겨울 행사\n무료 수신거부 080-000-0000';
    const id = await blockedRow({ requestedAt: new Date(Date.now() + 3 * 86_400_000), checkedAt: new Date(), submitted: withBlank });
    const no = await overrideSpamBlockTx({ requestId: id, companyId: CO, actor: screen(), revision: 5 });
    expect(no.ok).toBe(false);
    if (!no.ok) { expect(no.status).toBe(409); expect(no.code).toBe('BLANK_ACK_REQUIRED'); }
    expect(await rowOf(id)).toMatchObject({ status: 'test_failed', revision: 5 });
    const yes = await overrideSpamBlockTx({ requestId: id, companyId: CO, actor: screen(), revision: 5, blankAck: true });
    expect(yes.ok).toBe(true);
  });

  it('당일 막힘(2시간 안쪽) = 당일 검사 끝 = 막힌 시각', async () => {
    // 막힌 시각 = 보낼 시각과 같은 순간(어느 시각에 돌려도 같은 KST 날 · 판정은 날짜만 본다)
    const requestedAt = new Date(Date.now() + 90 * 60_000);
    const checkedAt = new Date(requestedAt.getTime());
    expect(isSameKstDay(checkedAt, requestedAt)).toBe(true);
    const id = await blockedRow({ requestedAt, checkedAt });
    const out = await overrideSpamBlockTx({ requestId: id, companyId: CO, actor: screen(), revision: 5 });
    expect(out.ok).toBe(true);
    if (out.ok) expect(new Date(out.row.final_test_at).getTime()).toBe(checkedAt.getTime());
  });

  it('당일 막힘이어도 보낼 글을 검사하지 않은 표식(다듬은 글만 막힘) = 당일 검사 끝 없음 · 2시간 안쪽이면 고를 수 없다(Codex 구현 1R #2)', async () => {
    const requestedAt = new Date(Date.now() + 90 * 60_000);
    const id = await blockedRow({ requestedAt, checkedAt: new Date(requestedAt.getTime()), tested: false });
    const out = await overrideSpamBlockTx({ requestId: id, companyId: CO, actor: screen(), revision: 5 });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.status).toBe(400);
    const far = await blockedRow({ requestedAt: new Date(Date.now() + 3 * 86_400_000), checkedAt: new Date(Date.now() + 3 * 86_400_000), tested: false });
    const ok = await overrideSpamBlockTx({ requestId: far, companyId: CO, actor: screen(), revision: 5 });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.row.final_test_at).toBeNull();
  });

  it('이미 어긋난 수정 번호 = 인증번호 앞에서 409(관문을 부르지 않는다 · Codex 구현 2R #1)', async () => {
    const id = await blockedRow({ requestedAt: new Date(Date.now() + 3 * 86_400_000), checkedAt: new Date() });
    gateState.fail = true;
    try {
      const out = await overrideSpamBlockTx({ requestId: id, companyId: CO, actor: screen(), revision: 4 });
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.status).toBe(409);
    } finally { gateState.fail = false; }
  });

  it('발신 인증에 막히면 403 · 상태 · 버전 · 표식 · 사건 그대로(Codex 구현 1R #1)', async () => {
    const id = await blockedRow({ requestedAt: new Date(Date.now() + 3 * 86_400_000), checkedAt: new Date() });
    gateState.fail = true;
    try {
      const out = await overrideSpamBlockTx({ requestId: id, companyId: CO, actor: screen(), revision: 5 });
      expect(out.ok).toBe(false);
      if (!out.ok) { expect(out.status).toBe(403); expect(out.code).toBe('SENDER_AUTH_REQUIRED'); expect('senderAuth' in out).toBe(true); }
    } finally { gateState.fail = false; }
    const r = await rowOf(id);
    expect(r).toMatchObject({ status: 'test_failed', content_version: 2, revision: 5 });
    expect(r.last_test_result?.spamOverridable?.version).toBe(2);
    expect((await eventsOf(id, 'spam_override')).length).toBe(0);
    expect((await eventsOf(id, 'approved')).length).toBe(0);
  });

  // ★ 2026-11-27 C167-C — 그대로 승인 = 곧 승인 완료(승인 완료 건의 시각 변경은 일반 승인과 같이 막힘) → 시각 변경은 고르기 전(승인 대기)에서 본다:
  //   고친 글로 승인을 묻는 중에 다른 날로 옮기면 표식은 같은 버전 그대로 남고(고를 길 유지 · 접수 재오픈 2) 당일 근거는 다른 날이라 쓰지 않는다(그 날 2시간 전 재검사가 돈다)
  it('고친 글 승인 대기에서 다른 날로 시각 변경 = 표식 유지 · 그 뒤 처음 문안 그대로 승인 = 당일 검사 끝 없음', async () => {
    const requestedAt = new Date(Date.now() + 3 * 86_400_000);
    const id = await blockedRow({ requestedAt, checkedAt: new Date(), status: 'awaiting_approval', approvalRequestedAt: new Date() });
    await pool.query(`UPDATE agency_send_requests SET callback_number = '' WHERE id = $1`, [id]);   // 회신번호 등록 확인은 이 시험 밖
    const moved = await rescheduleAgencyRequestTx({
      requestId: id, companyId: CO, ownerUserId: null, revision: 5,
      requestedAt: kstTenOclock(requestedAt, 2).toISOString(), via: 'screen',   // 발송 허용 시간(9 ~ 21시) 안 · 다른 KST 날
    });
    expect(moved.ok ? 'ok' : JSON.stringify({ s: (moved as any).status, e: (moved as any).error })).toBe('ok');
    if (!moved.ok) return;
    expect(moved.row.status).toBe('awaiting_approval');
    expect(moved.row.last_test_result?.spamOverridable?.version).toBe(2);
    const out = await overrideSpamBlockTx({ requestId: id, companyId: CO, actor: screen(), revision: Number(moved.row.revision) });
    expect(out.ok ? 'ok' : JSON.stringify(out)).toBe('ok');
    if (out.ok) { expect(out.row.status).toBe('approved'); expect(out.row.final_test_at).toBeNull(); }
  });

  it('수정 번호 어긋남 = 409 · 표식 없음(막힘 아닌 test_failed) = 400 · 버전 다름 = 400', async () => {
    const a = await blockedRow({ requestedAt: new Date(Date.now() + 3 * 86_400_000), checkedAt: new Date() });
    const stale = await overrideSpamBlockTx({ requestId: a, companyId: CO, actor: screen(), revision: 4 });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.status).toBe(409);
    const b = await blockedRow({ requestedAt: new Date(Date.now() + 3 * 86_400_000), checkedAt: new Date(), marker: false });
    const noMarker = await overrideSpamBlockTx({ requestId: b, companyId: CO, actor: screen(), revision: 5 });
    expect(noMarker.ok).toBe(false);
    if (!noMarker.ok) expect(noMarker.status).toBe(400);
    const c = await blockedRow({ requestedAt: new Date(Date.now() + 3 * 86_400_000), checkedAt: new Date() });
    await pool.query(`UPDATE agency_send_requests SET content_version = 9 WHERE id = $1`, [c]);
    const other = await overrideSpamBlockTx({ requestId: c, companyId: CO, actor: screen(), revision: 5 });
    expect(other.ok).toBe(false);
  });

  it('다른 회사 · 다른 사용자 접수 = 404', async () => {
    const id = await blockedRow({ requestedAt: new Date(Date.now() + 3 * 86_400_000), checkedAt: new Date() });
    const otherCo = await overrideSpamBlockTx({ requestId: id, companyId: randomUUID(), actor: screen(), revision: 5 });
    expect(otherCo.ok).toBe(false);
    if (!otherCo.ok) expect(otherCo.status).toBe(404);
    const otherUser = await overrideSpamBlockTx({ requestId: id, companyId: CO, actor: screen(randomUUID()), revision: 5 });
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
