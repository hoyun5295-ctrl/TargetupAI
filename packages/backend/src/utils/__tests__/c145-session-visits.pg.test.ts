// replaces: none
/**
 * C145 — 실 PostgreSQL 판(★ 2026-11-19 · 설계서 docs/2026-11-19-c145-public-session-visits-design.md §4)
 *   원장 블록 C145-DDL-1 · C145-DDL-2 를 글자 그대로 돌린다(표 = 운영 schema-only 덤프 사본).
 *   0. DDL 전 = 끄는 자리들이 지금 SQL 로 돈다(트랜잭션 안 포함) · 원인 읽기 = 없음 · 방문 표 없음 = 42P01
 *   1. 같은 프로세스에서 DDL 뒤 = 원인 다섯이 적힌다 · 이미 꺼진 행은 첫 원인 그대로 · 만료된 행 = expired · CHECK
 *   2. 방문 = 같은 id 한 행 · apply 먼저 → start 뒤 = 한 행 · 셋이 다르면 그대로 · 머문 시간 상한 · 하루 뒤 무시 · 요약 · 누구 · 90일 지움
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { pool, query } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { ledgerBlockSql } from './pg/global-setup';
import {
  endSessions, invalidateAppSessions, invalidateCompanySessions, invalidateUserSessions, readSessionEndReason,
} from '../session-manager';
import {
  recordVisitStart, recordVisitBeat, linkVisitApplication, loadPublicVisits, purgePublicVisits,
} from '../public-visits';

let companyId = '';
let userId = '';

async function session(over: { active?: boolean; expiresInMin?: number; app?: string } = {}): Promise<string> {
  const id = randomUUID();
  await insertMinimalRow(pool, 'user_sessions', {
    id, user_id: userId, session_token: id, is_active: over.active ?? true, app_source: over.app ?? 'hanjul',
    expires_at: new Date(Date.now() + (over.expiresInMin ?? 60) * 60_000), last_activity_at: new Date(),
  });
  return id;
}
const sess = async (id: string) => (await query(`SELECT * FROM user_sessions WHERE id = $1`, [id])).rows[0];
const hasCol = async () => (await query(
  `SELECT 1 FROM information_schema.columns WHERE table_name = 'user_sessions' AND column_name = 'ended_reason'`,
)).rows.length > 0;

beforeAll(async () => {
  companyId = randomUUID();
  await insertMinimalRow(pool, 'companies', { id: companyId, company_name: 'C145 시험상사' });
  userId = randomUUID();
  await insertMinimalRow(pool, 'users', { id: userId, company_id: companyId, login_id: `c145_${userId.slice(0, 8)}`, user_type: 'admin', is_active: true });
});

describe('0. DDL 전', () => {
  it('끄는 자리 = 지금 SQL(칸 없음) · 트랜잭션 안에서도 실패 0 · 원인 읽기 = null', async () => {
    expect(await hasCol()).toBe(false);
    const a = await session();
    expect(await invalidateUserSessions(userId)).toBe(1);
    expect((await sess(a)).is_active).toBe(false);
    const b = await session();
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      expect(await invalidateCompanySessions(companyId, c)).toBe(1);
      await c.query('COMMIT');
    } finally { c.release(); }
    expect((await sess(b)).is_active).toBe(false);
    expect(await readSessionEndReason(b, userId)).toBeNull();
  });
  it('방문 표 없음 = 42P01(경로는 503)', async () => {
    await expect(recordVisitStart(
      { id: randomUUID(), page: 'jbn', browserKey: randomUUID(), src: null, referrerHost: null },
      { ip: '203.0.113.5', userAgent: 'x', loginId: null, userType: null },
    )).rejects.toMatchObject({ code: '42P01' });
  });
});

describe('1. DDL 뒤(같은 프로세스) — 끈 원인', () => {
  beforeAll(async () => {
    await pool.query(ledgerBlockSql('C145-DDL-1'));
    await pool.query(ledgerBlockSql('C145-DDL-2'));
  });

  it('다섯 원인 · 실제로 끈 때만 · 이미 꺼진 행은 첫 원인 그대로', async () => {
    expect(await hasCol()).toBe(true);
    const s1 = await session();
    expect(await invalidateAppSessions(userId, 'hanjul')).toBe(1);
    expect((await sess(s1)).ended_reason).toBe('login_elsewhere');
    // 이미 꺼진 행에 로그아웃 = 0행 · 원인 그대로
    expect(await endSessions({ query }, 'id = $1 AND user_id = $2', [s1, userId], 'logout')).toBe(0);
    expect((await sess(s1)).ended_reason).toBe('login_elsewhere');

    const s2 = await session();
    expect(await invalidateUserSessions(userId)).toBe(1);
    expect((await sess(s2)).ended_reason).toBe('account_stopped');

    const s3 = await session();
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      expect(await invalidateCompanySessions(companyId, c)).toBe(1);
      await c.query('COMMIT');
    } finally { c.release(); }
    expect((await sess(s3)).ended_reason).toBe('company_closed');

    const s4 = await session();
    expect(await endSessions({ query }, 'id = $1 AND user_id = $2', [s4, userId], 'logout')).toBe(1);
    expect((await sess(s4)).ended_reason).toBe('logout');
    expect(await readSessionEndReason(s4, userId)).toBe('logout');
  });

  it('만료 시각이 지난 활성 행을 새 로그인이 끄면 = expired', async () => {
    const old = await session({ expiresInMin: -5 });
    const live = await session({ app: 'super' });
    expect(await invalidateAppSessions(userId, 'hanjul')).toBe(1);
    expect((await sess(old)).ended_reason).toBe('expired');
    expect((await sess(live)).is_active).toBe(true);   // 다른 앱은 그대로
    await invalidateUserSessions(userId);
  });

  it('CHECK = 목록 밖 원인은 거절', async () => {
    const s = await session();
    await expect(query(`UPDATE user_sessions SET ended_reason = 'bogus' WHERE id = $1`, [s])).rejects.toMatchObject({ code: '23514' });
    await invalidateUserSessions(userId);
  });
});

describe('2. 방문 기록', () => {
  const ctx = (over: Partial<{ ip: string; userAgent: string; loginId: string | null; userType: string | null }> = {}) => ({
    ip: '203.0.113.7', userAgent: 'Mozilla/5.0 (iPhone) KAKAOTALK 10.4.0', loginId: null, userType: null, ...over,
  });
  const row = async (id: string) => (await query(`SELECT * FROM public_page_visits WHERE id = $1`, [id])).rows[0];
  const backdate = (id: string, sec: number) => query(
    `UPDATE public_page_visits SET started_at = now() - make_interval(secs => $2), last_seen_at = now() - make_interval(secs => $2) WHERE id = $1`, [id, sec]);

  it('같은 id 두 번 = 한 행 · 비어 있는 칸만 채움', async () => {
    const id = randomUUID(); const bk = randomUUID();
    await recordVisitStart({ id, page: 'jbn', browserKey: bk, src: null, referrerHost: null }, ctx());
    await recordVisitStart({ id, page: 'jbn', browserKey: bk, src: 'band', referrerHost: 'band.us' }, ctx({ ip: '198.51.100.9', userAgent: 'other' }));
    const r = await row(id);
    expect(r).toMatchObject({ src: 'band', referrer_host: 'band.us', user_agent: 'Mozilla/5.0 (iPhone) KAKAOTALK 10.4.0' });
    expect(String(r.ip_address)).toBe('203.0.113.7');
    expect((await query(`SELECT count(*)::int AS n FROM public_page_visits WHERE id = $1`, [id])).rows[0].n).toBe(1);
  });

  it('신청 잇기가 먼저 → start 뒤 = 한 행에 신청 · 기기 둘 다 · 이미 이어진 신청은 그대로', async () => {
    const id = randomUUID(); const bk = randomUUID(); const app1 = randomUUID(); const app2 = randomUUID();
    await linkVisitApplication({ visitId: id, browserKey: bk, applicationId: app1, page: 'jbn', ip: '203.0.113.8', userAgent: null });
    await recordVisitStart({ id, page: 'jbn', browserKey: bk, src: 'jbn-chat', referrerHost: null }, ctx({ loginId: 'suran', userType: 'super_admin' }));
    await linkVisitApplication({ visitId: id, browserKey: bk, applicationId: app2, page: 'jbn', ip: null, userAgent: null });
    const r = await row(id);
    expect(r).toMatchObject({ application_id: app1, src: 'jbn-chat', login_id: 'suran', user_agent: 'Mozilla/5.0 (iPhone) KAKAOTALK 10.4.0' });
  });

  it('같은 id 를 다른 browserKey · 다른 page 로 start · beat · 잇기 = 원래 행 그대로', async () => {
    const id = randomUUID(); const bk = randomUUID(); const other = randomUUID();
    await recordVisitStart({ id, page: 'jbn', browserKey: bk, src: null, referrerHost: null }, ctx());
    await recordVisitStart({ id, page: 'jbn', browserKey: other, src: 'evil', referrerHost: 'evil.example' }, ctx({ loginId: 'x' }));
    await linkVisitApplication({ visitId: id, browserKey: other, applicationId: randomUUID(), page: 'jbn', ip: null, userAgent: null });
    await backdate(id, 100);
    await recordVisitBeat({ id, page: 'jbn', browserKey: other, seconds: 60 });
    const r = await row(id);
    expect(r).toMatchObject({ browser_key: bk, src: null, referrer_host: null, login_id: null, application_id: null, visible_seconds: 0 });
  });

  it('신호를 몰아 보내도 = 흐른 시간 + 5초 이하 · 6시간 상한 · 하루 지난 방문은 무시', async () => {
    const id = randomUUID(); const bk = randomUUID();
    await recordVisitStart({ id, page: 'jbn', browserKey: bk, src: null, referrerHost: null }, ctx());
    await backdate(id, 20);
    for (let i = 0; i < 360; i++) await recordVisitBeat({ id, page: 'jbn', browserKey: bk, seconds: 60 });
    // ★ 2026-11-25 신호 360번을 보내는 동안에도 시간이 흐른다 — 25 이하로 고정하면 360번이 1초를 넘는 날(전체 실행 부하 · 느린 PC)
    //   26이 나와 흔들린다(C162 push 관문 · 단독 실행 3회 중 1회 실패 실측). 상한은 **서버 계약 그대로** 그 행에서 계산한다:
    //   마지막 신호 때의 흐른 시간(last_seen_at − started_at · 내림) + 5초. 시험 쪽 시계로 재면 올림 · 조회 대기만큼 상한이 느슨해진다(Codex 1R).
    const b = (await query(
      `SELECT visible_seconds AS v, (FLOOR(EXTRACT(EPOCH FROM (last_seen_at - started_at))) + 5)::int AS cap FROM public_page_visits WHERE id = $1`, [id],
    )).rows[0];
    expect(b.v).toBeGreaterThan(0);
    expect(b.v).toBeLessThanOrEqual(b.cap);
    expect(b.cap).toBeGreaterThanOrEqual(25); // 20초 전으로 돌려놓은 방문이다(상한이 0 근처로 계산돼 위 대조가 헛돌지 않게)

    await query(`UPDATE public_page_visits SET visible_seconds = 21590, started_at = now() - interval '10 hours', last_seen_at = now() - interval '1 hour' WHERE id = $1`, [id]);
    await recordVisitBeat({ id, page: 'jbn', browserKey: bk, seconds: 60 });
    expect((await row(id)).visible_seconds).toBe(21600);

    await query(`UPDATE public_page_visits SET visible_seconds = 0, started_at = now() - interval '25 hours', last_seen_at = now() - interval '1 hour' WHERE id = $1`, [id]);
    await recordVisitBeat({ id, page: 'jbn', browserKey: bk, seconds: 60 });
    expect((await row(id)).visible_seconds).toBe(0);
  });

  it('기간 = 한국 시간 날짜 기준 · 「오늘」에 어제 23:59 방문은 없다 · 「7일」에는 있다(Codex 구현 1R)', async () => {
    await query(`DELETE FROM public_page_visits`);
    const yest = randomUUID(); const today = randomUUID();
    await recordVisitStart({ id: yest, page: 'jbn', browserKey: randomUUID(), src: null, referrerHost: null }, ctx());
    await recordVisitStart({ id: today, page: 'jbn', browserKey: randomUUID(), src: null, referrerHost: null }, ctx());
    const midnight = `(date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul')`;
    await query(`UPDATE public_page_visits SET started_at = ${midnight} - interval '1 minute' WHERE id = $1`, [yest]);
    await query(`UPDATE public_page_visits SET started_at = ${midnight} + interval '1 second' WHERE id = $1`, [today]);
    const names = async () => new Map<string, { nickname: string; companyName: string }>();
    const d1 = await loadPublicVisits('jbn', 1, names);
    expect(d1.rows.map((r) => r.id)).toEqual([today]);
    expect(d1.summary.visits).toBe(1);
    const d7 = await loadPublicVisits('jbn', 7, names);
    expect(d7.rows.map((r) => r.id).sort()).toEqual([today, yest].sort());
    expect(d7.summary.visits).toBe(2);
  });

  it('요약 · 누구 = 신청 → 로그인 흔적 → 알 수 없음 · 같은 브라우저 방문 수', async () => {
    await query(`DELETE FROM public_page_visits`);
    const bkApp = randomUUID(); const bkLogin = randomUUID(); const bkNone = randomUUID(); const app = randomUUID();
    const v1 = randomUUID(); const v2 = randomUUID(); const v3 = randomUUID(); const v4 = randomUUID();
    await recordVisitStart({ id: v1, page: 'jbn', browserKey: bkApp, src: null, referrerHost: null }, ctx());
    await recordVisitStart({ id: v2, page: 'jbn', browserKey: bkApp, src: null, referrerHost: null }, ctx());
    await linkVisitApplication({ visitId: v2, browserKey: bkApp, applicationId: app, page: 'jbn', ip: null, userAgent: null });
    await recordVisitStart({ id: v3, page: 'jbn', browserKey: bkLogin, src: null, referrerHost: null }, ctx({ loginId: 'ceo', userType: 'super_admin', userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/157' }));
    await recordVisitStart({ id: v4, page: 'jbn', browserKey: bkNone, src: null, referrerHost: null }, ctx());
    await query(`UPDATE public_page_visits SET visible_seconds = 30 WHERE id IN ($1, $2)`, [v1, v3]);
    const out = await loadPublicVisits('jbn', 7, async (ids) => new Map(ids.map((i) => [i, { nickname: '시험 직원', companyName: '시험상사' }])));
    expect(out.summary).toEqual({ visits: 4, browsers: 3, avgSeconds: 15, appliedBrowsers: 1 });
    const by = new Map(out.rows.map((r) => [r.id, r]));
    expect(by.get(v1)!.who).toMatchObject({ kind: 'application', nickname: '시험 직원', companyName: '시험상사' });   // 같은 브라우저의 다른 방문에서 신청
    expect(by.get(v1)!.browserVisits).toBe(2);
    expect(by.get(v3)!).toMatchObject({ who: { kind: 'login', loginId: 'ceo', userType: 'super_admin' }, device: 'PC', app: '브라우저' });
    expect(by.get(v4)!).toMatchObject({ who: { kind: 'unknown' }, device: '휴대폰', app: '카카오톡', ip: '203.0.113.7' });
  });

  it('90일 지난 방문 지움 · 개인정보 파기 기록 한 줄', async () => {
    const id = randomUUID(); const keep = randomUUID();
    await recordVisitStart({ id, page: 'jbn', browserKey: randomUUID(), src: null, referrerHost: null }, ctx());
    await recordVisitStart({ id: keep, page: 'jbn', browserKey: randomUUID(), src: null, referrerHost: null }, ctx());
    await query(`UPDATE public_page_visits SET started_at = now() - interval '91 days' WHERE id = $1`, [id]);
    expect(await purgePublicVisits()).toBe(1);
    expect(await row(id)).toBeUndefined();
    expect(await row(keep)).toBeDefined();
    const a = await query(`SELECT details FROM audit_logs WHERE action = 'privacy_purge' AND target_type = 'public_page_visits' ORDER BY created_at DESC LIMIT 1`);
    expect(a.rows[0].details).toMatchObject({ kind: 'public_page_visits', count: 1 });
  });
});
