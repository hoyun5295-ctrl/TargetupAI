/**
 * 고객 보안 점검 공지 · 확인 현황 (★2026-10-29 Harold 「확인한 업체가 누군지 보안인증 메뉴에서 체크」 · B 카드 + C 점검 기록 + D 공지 확인 현황)
 *
 * 설계 = docs/2026-10-29-customer-security-notice-ack-design.md(Codex 설계 3R approve).
 * 원천 = audit_logs(새 칸 · 새 테이블 0) · 판정 · 기록 · 집계 = utils/customer-notice.ts 한 곳.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';

vi.mock('../../config/database', () => ({ query: vi.fn(), pool: { connect: vi.fn() } }));
vi.mock('../demo-company', () => ({ listDemoCompanyIds: vi.fn(), isDemoCompany: vi.fn(async () => false) }));

import { query } from '../../config/database';
import { listDemoCompanyIds } from '../demo-company';
import { recordAuditLog, recordAuditLogStrict } from '../audit-log';
import { listInternalCompanyIds } from '../internal-company';
import {
  CUSTOMER_NOTICES, CUSTOMER_NOTICE_ACTIONS, parseNoticeEvent, noticeActor, isNoticeShowing, noticeForUser, recordNoticeEvent, loadNoticeAck,
} from '../customer-notice';

const mockQuery = query as unknown as ReturnType<typeof vi.fn>;
const mockDemoIds = listDemoCompanyIds as unknown as ReturnType<typeof vi.fn>;
const DEMO = '11111111-1111-4111-8111-111111111111';
const TEST_CO = '22222222-2222-4222-8222-222222222222';

beforeEach(() => { mockQuery.mockReset(); mockDemoIds.mockReset(); delete process.env.INTERNAL_TEST_COMPANY_IDS; });

describe('사내 회사 목록 — 시연 ∪ 사내 시험(집계 제외용 · R25 · Codex 설계 1R)', () => {
  it('시연 회사와 ENV 사내 시험 회사를 함께 · 소문자 · 중복 없이', async () => {
    mockDemoIds.mockResolvedValue([DEMO]);
    process.env.INTERNAL_TEST_COMPANY_IDS = ` ${TEST_CO.toUpperCase()}, ${DEMO}, not-a-uuid `;
    expect((await listInternalCompanyIds()).sort()).toEqual([DEMO, TEST_CO].sort());
  });

  it('둘 다 없으면 빈 목록', async () => {
    mockDemoIds.mockResolvedValue([]);
    expect(await listInternalCompanyIds()).toEqual([]);
  });
});

describe('감사 로그 쓰기 — 바꾸기 전 동작 캡처(recordAuditLog) · 실패를 던지는 짝(recordAuditLogStrict)', () => {
  const req = { ip: '9.8.7.6', headers: { 'user-agent': 'UA/1' } };

  it('recordAuditLog = 빈 값은 NULL · details 는 JSON · IP · UA 는 req 에서 · 반환 undefined', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const r = await recordAuditLog({ actorUserId: 'u1', action: 'x_act', targetType: 't', targetId: 'id1', details: { a: 1 }, req });
    expect(r).toBeUndefined();
    const [sql, params] = mockQuery.mock.calls[0];
    expect(String(sql)).toContain('INSERT INTO audit_logs (user_id, action, target_type, target_id, details, ip_address, user_agent)');
    expect(params).toEqual(['u1', 'x_act', 't', 'id1', '{"a":1}', '9.8.7.6', 'UA/1']);
  });

  it('recordAuditLog = 생략한 값은 NULL · req 없으면 IP NULL · UA 빈 글자', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await recordAuditLog({ action: 'y_act' });
    expect(mockQuery.mock.calls[0][1]).toEqual([null, 'y_act', null, null, null, null, '']);
  });

  it('recordAuditLog = INSERT 가 실패해도 던지지 않는다(본 동작 영향 0)', async () => {
    mockQuery.mockRejectedValue(new Error('db down'));
    await expect(recordAuditLog({ action: 'z_act' })).resolves.toBeUndefined();
  });

  it('recordAuditLogStrict = 같은 INSERT · 같은 값 · 실패는 던진다', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await recordAuditLogStrict({ actorUserId: 'u1', action: 'x_act', targetType: 't', targetId: 'id1', details: { a: 1 }, req });
    expect(mockQuery.mock.calls[0][1]).toEqual(['u1', 'x_act', 't', 'id1', '{"a":1}', '9.8.7.6', 'UA/1']);
    mockQuery.mockReset();
    mockQuery.mockRejectedValue(new Error('db down'));
    await expect(recordAuditLogStrict({ action: 'z_act' })).rejects.toThrow('db down');
  });
});

const N = CUSTOMER_NOTICES[0];
const PERSON = { userId: 'u-1', companyId: 'c-1', loginId: 'mkt01', userType: 'company_user' };
const reqOf = (user: any) => ({ user, ip: '1.2.3.4', headers: { 'user-agent': 'ua' } });
const sqlOf = (i: number) => String(mockQuery.mock.calls[i][0]);
const paramsOf = (i: number) => mockQuery.mock.calls[i][1];

describe('공지 원장 · 요청 정규화 · 대상', () => {
  it('원장에 있는 id 와 아는 사건만 받는다', () => {
    expect(parseNoticeEvent({ noticeId: N.id, event: 'ack' })?.event).toBe('ack');
    expect(parseNoticeEvent({ noticeId: N.id, event: 'shown' })?.notice.id).toBe(N.id);
    expect(parseNoticeEvent({ noticeId: 'nope', event: 'ack' })).toBeNull();
    expect(parseNoticeEvent({ noticeId: N.id, event: 'click' })).toBeNull();
    expect(parseNoticeEvent(null)).toBeNull();
  });

  it('고객사 사람 계정만 대상 · 슈퍼관리자 · 회사 없는 토큰 제외', () => {
    expect(noticeActor(PERSON)).toEqual({ userId: 'u-1', companyId: 'c-1', loginId: 'mkt01' });
    expect(noticeActor({ ...PERSON, userType: 'super_admin' })).toBeNull();
    expect(noticeActor({ ...PERSON, companyId: undefined })).toBeNull();
    expect(noticeActor(null)).toBeNull();
  });

  it('띄우는 기간 = 시작일부터 마지막 날까지(그날 포함)', () => {
    const n = { id: 'x', title: 'x', startsAt: '2026-10-29', showUntil: '2026-11-30' };
    expect(isNoticeShowing(n, '2026-10-28')).toBe(false);
    expect(isNoticeShowing(n, '2026-10-29')).toBe(true);
    expect(isNoticeShowing(n, '2026-11-30')).toBe(true);
    expect(isNoticeShowing(n, '2026-12-01')).toBe(false);
  });
});

describe('띄울지 판정 — 이 회사에서 이 계정이 아직 확인 안 한 공지', () => {
  it('확인 기록이 없으면 공지 · 있으면 null', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect((await noticeForUser(PERSON, '2026-11-01'))?.id).toBe(N.id);
    mockQuery.mockResolvedValueOnce({ rows: [{ x: 1 }] });
    expect(await noticeForUser(PERSON, '2026-11-01')).toBeNull();
  });

  it('판정 SQL = 계정 · 공지 시작일(KST 0시) 범위 읽기 · 같은 회사 · 같은 공지의 확인만 센다', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await noticeForUser(PERSON, '2026-11-01');
    expect(sqlOf(0)).toMatch(/user_id = \$1 AND created_at >= \(\$2::date::timestamp AT TIME ZONE 'Asia\/Seoul'\)/);
    expect(sqlOf(0)).toMatch(/details->>'companyId' = \$4 AND details->>'noticeId' = \$5/);
    expect(paramsOf(0)).toEqual(['u-1', '2026-10-29', 'customer_notice_ack', 'c-1', N.id]);
  });

  it('기간 밖 · 슈퍼관리자 = 조회 없이 null · 조회 오류 = null(띄우지 않음)', async () => {
    expect(await noticeForUser(PERSON, '2026-12-01')).toBeNull();
    expect(await noticeForUser({ ...PERSON, userType: 'super_admin' }, '2026-11-01')).toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
    mockQuery.mockRejectedValueOnce(new Error('db down'));
    expect(await noticeForUser(PERSON, '2026-11-01')).toBeNull();
  });
});

describe('사건 기록', () => {
  it('ack = 기록이 없으면 그 순간의 회사 · 아이디와 함께 남긴다', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    expect(await recordNoticeEvent(reqOf(PERSON), { notice: N, event: 'ack' }, '2026-11-01')).toBe('ok');
    expect(sqlOf(1)).toContain('INSERT INTO audit_logs');
    expect(paramsOf(1).slice(0, 3)).toEqual(['u-1', 'customer_notice_ack', 'customer_notice']);
    expect(JSON.parse(paramsOf(1)[4])).toEqual({ noticeId: N.id, companyId: 'c-1', loginId: 'mkt01' });
  });

  it('ack = 이미 있으면 새로 쓰지 않고 성공(순차 재시도 두 번 = 한 행)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ x: 1 }] });
    expect(await recordNoticeEvent(reqOf(PERSON), { notice: N, event: 'ack' }, '2026-11-01')).toBe('ok');
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('ack = 저장 실패는 던진다(가짜 성공 0)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(new Error('insert failed'));
    await expect(recordNoticeEvent(reqOf(PERSON), { notice: N, event: 'ack' }, '2026-11-01')).rejects.toThrow('insert failed');
  });

  it('shown · report 도 저장 실패는 던진다(가짜 성공 0 · Codex 구현 1R)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(new Error('insert failed'));
    await expect(recordNoticeEvent(reqOf(PERSON), { notice: N, event: 'shown' }, '2026-11-01')).rejects.toThrow('insert failed');
    mockQuery.mockReset();
    mockQuery.mockRejectedValueOnce(new Error('insert failed'));
    await expect(recordNoticeEvent(reqOf(PERSON), { notice: N, event: 'report' }, '2026-11-01')).rejects.toThrow('insert failed');
  });

  it('shown = 처음 한 번만 · 두 번째는 쓰지 않는다', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    await recordNoticeEvent(reqOf(PERSON), { notice: N, event: 'shown' }, '2026-11-01');
    expect(sqlOf(1)).toContain('INSERT INTO audit_logs');
    mockQuery.mockReset();
    mockQuery.mockResolvedValueOnce({ rows: [{ x: 1 }] });
    await recordNoticeEvent(reqOf(PERSON), { notice: N, event: 'shown' }, '2026-11-01');
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('기간이 끝난 공지 = 점검 기록 열람만 받고 ack · shown 은 closed', async () => {
    expect(await recordNoticeEvent(reqOf(PERSON), { notice: N, event: 'ack' }, '2026-12-01')).toBe('closed');
    expect(await recordNoticeEvent(reqOf(PERSON), { notice: N, event: 'shown' }, '2026-12-01')).toBe('closed');
    expect(mockQuery).not.toHaveBeenCalled();
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await recordNoticeEvent(reqOf(PERSON), { notice: N, event: 'report' }, '2026-12-01')).toBe('ok');
    expect(paramsOf(0)[1]).toBe('customer_notice_report');
  });

  it('슈퍼관리자 · 회사 없는 토큰 = 기록하지 않음', async () => {
    expect(await recordNoticeEvent(reqOf({ ...PERSON, userType: 'super_admin' }), { notice: N, event: 'ack' }, '2026-11-01')).toBe('skipped');
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('공지 확인 현황(D) 집계', () => {
  const CO_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; // 확인함(지워진 계정이 눌렀다)
  const CO_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; // 보기만 함
  const CO_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'; // 아직 안 봄

  function route(sql: string) {
    if (sql.includes('FROM companies c')) return { rows: [{ company_id: CO_A, company_name: '확인 회사' }, { company_id: CO_B, company_name: '본 회사' }, { company_id: CO_C, company_name: '안 본 회사' }] };
    if (sql.includes('FROM users u')) return { rows: [
      { company_id: CO_A, user_id: 'ua1', login_id: 'a-now', name: '지금 계정', last_login_at: '2026-10-30T01:00:00Z' },
      { company_id: CO_B, user_id: 'ub1', login_id: 'b1', name: '', last_login_at: '2026-10-29T10:00:00Z' },
      { company_id: CO_C, user_id: 'uc1', login_id: 'c1', name: '', last_login_at: '2026-10-31T10:00:00Z' },
    ] };
    if (sql.includes('FROM audit_logs al')) return { rows: [
      { company_id: CO_A, user_id: 'gone', login_id: 'a-gone', action: 'customer_notice_shown', first_at: '2026-10-29T11:00:00Z' },
      { company_id: CO_A, user_id: 'gone', login_id: 'a-gone', action: 'customer_notice_ack', first_at: '2026-10-29T11:05:00Z' },
      { company_id: CO_B, user_id: 'ub1', login_id: 'b1', action: 'customer_notice_shown', first_at: '2026-10-29T10:01:00Z' },
      { company_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', user_id: 'ux', login_id: 'x', action: 'customer_notice_ack', first_at: '2026-10-29T10:00:00Z' },
    ] };
    throw new Error(`예상 밖 SQL: ${sql.slice(0, 60)}`);
  }

  it('상태 3종 · 아직 안 봄부터 · 지워진 계정의 확인도 그 회사 확인함 · 대상 밖 회사 사건은 버림', async () => {
    mockDemoIds.mockResolvedValue([DEMO]);
    mockQuery.mockImplementation(async (sql: string) => route(sql));
    const d = await loadNoticeAck(N.id);
    expect(d?.summary).toEqual({ companies: 3, acked: 1, seen: 1, none: 1 });
    expect(d?.companies.map((c) => [c.companyName, c.status])).toEqual([['안 본 회사', 'none'], ['본 회사', 'seen'], ['확인 회사', 'acked']]);
    const a = d!.companies.find((c) => c.companyId === CO_A)!;
    expect(a.ackAt).toBe('2026-10-29T11:05:00.000Z');
    expect(a.ackLoginId).toBe('a-gone');
    expect(a.accounts.find((x) => x.loginId === 'a-gone')).toMatchObject({ current: false, ackAt: '2026-10-29T11:05:00.000Z' });
    expect(a.accounts.find((x) => x.loginId === 'a-now')).toMatchObject({ current: true, ackAt: null });
  });

  it('대상 회사 SQL = 활성 · 사내 회사 목록 제외(uuid 배열) · 사건 SQL = 공지 시작일로 묶음', async () => {
    mockDemoIds.mockResolvedValue([DEMO]);
    process.env.INTERNAL_TEST_COMPANY_IDS = TEST_CO;
    mockQuery.mockImplementation(async (sql: string) => route(sql));
    await loadNoticeAck(N.id);
    const coCall = mockQuery.mock.calls.find((c) => String(c[0]).includes('FROM companies c'))!;
    expect(String(coCall[0])).toMatch(/c\.status IS NULL OR c\.status = 'active'/);
    expect(String(coCall[0])).toMatch(/NOT \(c\.id = ANY\(\$1::uuid\[\]\)\)/);
    expect([...coCall[1][0]].sort()).toEqual([DEMO, TEST_CO].sort());
    const evCall = mockQuery.mock.calls.find((c) => String(c[0]).includes('FROM audit_logs al'))!;
    expect(String(evCall[0])).toMatch(/created_at >= \(\$1::date::timestamp AT TIME ZONE 'Asia\/Seoul'\)/);
    expect(evCall[1][0]).toBe(N.startsAt);
  });

  it('원장에 없는 공지 id = null', async () => {
    expect(await loadNoticeAck('nope')).toBeNull();
  });
});

describe('배선 계약(소스) — 화면 · 경로 · 권한 · 문구', () => {
  const FRONT = resolve(__dirname, '../../../../frontend/src');
  const front = (rel: string) => readFileSync(join(FRONT, rel), 'utf8').replace(/\r\n/g, '\n');
  const back = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8').replace(/\r\n/g, '\n');
  /** 주석을 걷은 소스(문구 검사용) */
  const code = (src: string) => src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

  it('화면 공지 id = 서버 공지 원장 id', () => {
    const id = front('constants/security-report.ts').match(/SECURITY_NOTICE_ID = '([^']+)'/)?.[1];
    expect(CUSTOMER_NOTICES.map((n) => n.id)).toContain(id);
  });

  it('공지 사건 action 마다 감사 로그 화면 라벨이 있다', () => {
    const labels = front('constants/audit-action-labels.ts');
    for (const a of Object.values(CUSTOMER_NOTICE_ACTIONS)) expect(labels, a).toMatch(new RegExp(`^\\s{2}${a}: '`, 'm'));
  });

  it('App = 카드 전역 한 번 · C 경로 · 에이전트 전용 회사 허용 목록', () => {
    const app = front('App.tsx');
    expect(app.match(/<SecurityNoticeCard \/>/g)?.length).toBe(1);
    expect(app).toMatch(/path="\/security-report"/);
    expect(app).toMatch(/const AGENT_ALLOWED_PATHS = \[[^\]]*'\/security-report'[^\]]*\]/);
  });

  it('카드 = 로그인 표식으로 새로 그림 · 확인은 204 뒤에만 · 성공은 로그인 세대에 알림 · 도움말 버튼 숨김', () => {
    const card = front('components/SecurityNoticeCard.tsx');
    const page = front('pages/SecurityReportPage.tsx');
    expect(card).toMatch(/<NoticeCardForLogin key=\{loginMark\}/);
    // 성공 알림은 alive 검사 앞(카드가 내려가도 같은 로그인의 새 카드에 닿는다 · Codex 구현 1R)
    expect(card).toMatch(/if \(status === 204\) \{ markNoticeAcked\(loginMark, noticeId\); return; \}\n\s*if \(!alive\.current\) return;/);
    // 표식은 누른 순간의 로그인(응답 순간이 아니다) · 카드는 prop 의 loginMark · 점검 기록 화면은 await 앞에서 잡는다
    expect(card).not.toMatch(/function markNoticeAcked[\s\S]{0,200}useAuthStore\.getState/);
    expect(page).toMatch(/const loginMark = currentLoginMark\(\);\s*try \{\s*const status = await postNoticeEvent/);
    expect(card).toMatch(/readMark\(ACKED_KEY\) === `\$\{loginMark\}\|\$\{id\}`/);
    expect(card).toMatch(/window\.addEventListener\(ACKED_EVENT, on\)/);
    expect(page).toMatch(/if \(status === 204\) markNoticeAcked\(loginMark, SECURITY_NOTICE_ID\);/);
    expect(card).toMatch(/useBodyFlag\('data-interrupt-open', !!noticeId\)/);
  });

  it('고객 경로는 로그인 문 뒤 · 관리자 경로는 열람 권한 문', () => {
    const co = back('routes/companies.ts');
    const gate = co.indexOf('router.use(authenticate);');
    expect(gate).toBeGreaterThan(0);
    expect(co.indexOf("router.get('/notice/current'")).toBeGreaterThan(gate);
    expect(co.indexOf("router.post('/notice/event'")).toBeGreaterThan(gate);
    const ad = back('routes/admin.ts');
    const body = ad.slice(ad.indexOf("router.get('/customer-notice-ack',"), ad.indexOf("router.get('/customer-notice-ack',") + 400);
    expect(body).toMatch(/if \(!\(await isNoticeAckViewer\(req\.user\?\.userId\)\)\)/);
  });

  it('고객 문구 = 가운뎃점 · 줄표 · 모델명 0', () => {
    for (const rel of ['constants/security-report.ts', 'components/SecurityNoticeCard.tsx', 'pages/SecurityReportPage.tsx']) {
      const src = code(front(rel));
      expect(src, rel).not.toMatch(/[·—]/);
      expect(src, rel).not.toMatch(/Opus|Sonnet|Haiku|GPT|Claude|Anthropic|claude-/);
    }
  });
});
