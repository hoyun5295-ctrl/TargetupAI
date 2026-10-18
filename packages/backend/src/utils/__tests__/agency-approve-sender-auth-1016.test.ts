/**
 * 대행발송 개편 축 0 — 승인의 법정 추가 인증(전송자격인증 3.5) + 링크 승인 계정 (★2026-10-16 · 설계 = docs/2026-10-16-agency-send-mobile-control-design.md §2 축 0)
 *
 * 고정하는 것
 *   ① 승인 링크는 「담당자 번호 ∩ 계정 MFA 번호」에만 간다(접수 계정 우선 · 아니면 관리자 정확히 하나
 *      · 아니면 직원 회사(AGENCY_STAFF_COMPANY_IDS) 계정 정확히 하나 — ★1016 Harold: 고객사에 넘기기 전 직원 검증)
 *   ② 승인 CT 가 발신 인증 게이트를 부른다 — 승인할 수 없는 건에는 인증번호 문자를 보내지 않고, 막히면 트랜잭션을 열지 않는다
 *   ③ 링크 승인의 승인 계정은 잠금 아래에서 다시 판정하고 approved_by 에 남는다
 *   ④ 인증번호 확인 응답은 로그인 경로와 링크 경로가 같은 CT 함수
 *   ⑤ 화면 배선(PC 상세 · 모바일 링크 화면)은 훅 하나 · 판정을 화면에서 다시 조립하지 않는다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// ── 승인 CT 동작 테스트용 모의(DB · 게이트 · 워커 · 회신번호 조회) ─────────────────────────
const clientQuery = vi.fn();
const release = vi.fn();
vi.mock('../../config/database', () => ({
  pool: { connect: vi.fn(async () => ({ query: clientQuery, release })) },
  query: vi.fn(async () => ({ rows: [] })),
}));
const gateMock = vi.fn();
const enforcedMock = vi.fn(() => true);
vi.mock('../sender-auth', async (orig) => {
  const real: any = await orig();
  return { ...real, checkSenderAuthGate: (...a: any[]) => gateMock(...a), isSenderAuthEnforced: () => enforcedMock() };
});
vi.mock('../agency-send-worker', () => ({ triggerAgencySendDispatch: vi.fn() }));
const rowCallbacksMock = vi.fn(async () => [] as string[]);
vi.mock('../agency-send-intake', () => ({ loadRequestRowCallbacks: (...a: any[]) => rowCallbacksMock(...a) }));

import { query } from '../../config/database';
import { approveAgencyRequestTx } from '../agency-send-approve';
import { pickLinkApprovers, resolveLinkApprovers, agencyStaffCompanyIds } from '../agency-send-link';
import { senderAuthVerifyResponse } from '../sender-auth';
import { buildNoLinkApproverLine } from '../agency-send-notify';

const qmock = query as unknown as ReturnType<typeof vi.fn>;
const SRC = join(__dirname, '..', '..');
const FE = join(SRC, '..', '..', 'frontend', 'src');
const src = (p: string) => readFileSync(join(SRC, p), 'utf8');
const fe = (p: string) => readFileSync(join(FE, p), 'utf8');

const FUTURE = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString();
const ROW = {
  id: 'req-1', company_id: 'co-1', created_by: 'u-creator', status: 'awaiting_approval', revision: 7,
  requested_at: FUTURE, final_test_at: null, content_version: 3, callback_number: '0212345678',
  manager_phones: ['01011112222', '01033334444'], manager_phone: null, recipient_count: 12,
};

describe('① 링크 승인 계정 — pickLinkApprovers', () => {
  const CO = { companyId: 'co-1' };
  const users = [
    { id: 'u-creator', company_id: 'co-1', user_type: 'user', mfa_phone: '010-1111-2222' },
    { id: 'a-1', company_id: 'co-1', user_type: 'admin', mfa_phone: '01033334444' },
  ];

  it('접수 계정 번호 → 접수 계정 · 관리자 번호 → 그 관리자 (표기 차이는 정규화)', () => {
    const m = pickLinkApprovers(['01011112222', '01033334444'], 'u-creator', users, CO);
    expect(m.get('01011112222')).toBe('u-creator');
    expect(m.get('01033334444')).toBe('a-1');
  });

  it('MFA 번호가 안 맞는 번호는 링크가 없다', () => {
    expect(pickLinkApprovers(['01099998888'], 'u-creator', users, CO).size).toBe(0);
  });

  it('같은 번호를 쓰는 관리자가 둘이면 정할 수 없어 링크 없음', () => {
    const m = pickLinkApprovers(['01055556666'], 'u-creator', [
      { id: 'a-1', company_id: 'co-1', user_type: 'admin', mfa_phone: '01055556666' },
      { id: 'a-2', company_id: 'co-1', user_type: 'admin', mfa_phone: '010-5555-6666' },
    ], CO);
    expect(m.has('01055556666')).toBe(false);
  });

  it('접수 계정과 관리자가 같은 번호면 접수 계정이 먼저다(계정이 여럿인 업체 · 최종 검증 1)', () => {
    const m = pickLinkApprovers(['01055556666'], 'u-creator', [
      { id: 'u-creator', company_id: 'co-1', user_type: 'user', mfa_phone: '01055556666' },
      { id: 'a-1', company_id: 'co-1', user_type: 'admin', mfa_phone: '01055556666' },
    ], CO);
    expect(m.get('01055556666')).toBe('u-creator');
  });

  it('접수 계정이 아닌 일반 사용자 번호는 링크를 받지 않는다(불변 11 · DB 어휘 admin 만)', () => {
    const m = pickLinkApprovers(['01077778888'], 'u-creator', [
      { id: 'u-other', company_id: 'co-1', user_type: 'user', mfa_phone: '01077778888' },
      { id: 'x', company_id: 'co-1', user_type: 'company_admin', mfa_phone: '01077778888' },   // JWT 어휘는 DB 에 없다
    ], CO);
    expect(m.size).toBe(0);
  });

  it('MFA 번호가 비어 있으면 무시', () => {
    expect(pickLinkApprovers(['01011112222'], 'u-creator', [{ id: 'u-creator', company_id: 'co-1', user_type: 'user', mfa_phone: null }], CO).size).toBe(0);
  });

  // ★2026-10-16 Harold — 고객사에 넘기기 전 직원이 업체 접수에 자기 번호를 담당자로 넣어 검증한다(지금 실데이터 13건 전부).
  //   직원 = 직원 회사(ENV) 계정. 인증번호는 직원 자기 계정 MFA 번호로 받는다. 고객사가 담당자 본인 번호를 계정에 등록하면 그쪽이 먼저다.
  const STAFF = { companyId: 'co-1', staffCompanyIds: ['co-staff'] };

  it('직원 회사 계정의 MFA 번호면 그 직원이 승인 계정(유형 무관 · 고객사 접수여도)', () => {
    const m = pickLinkApprovers(['01049564956'], 'u-creator', [
      { id: 's-1', company_id: 'co-staff', user_type: 'user', mfa_phone: '010-4956-4956' },
    ], STAFF);
    expect(m.get('01049564956')).toBe('s-1');
  });

  it('직원 회사 명단이 비어 있으면 직원 번호는 링크가 없다(종전 축 0 그대로)', () => {
    const rows = [{ id: 's-1', company_id: 'co-staff', user_type: 'user', mfa_phone: '01049564956' }];
    expect(pickLinkApprovers(['01049564956'], 'u-creator', rows, { companyId: 'co-1', staffCompanyIds: [] }).size).toBe(0);
    expect(pickLinkApprovers(['01049564956'], 'u-creator', rows, CO).size).toBe(0);
  });

  it('직원 회사가 아닌 다른 고객사 계정 번호는 링크가 없다(회사 경계)', () => {
    const m = pickLinkApprovers(['01012341234'], 'u-creator', [
      { id: 'o-1', company_id: 'co-other', user_type: 'admin', mfa_phone: '01012341234' },
    ], STAFF);
    expect(m.size).toBe(0);
  });

  it('직원 계정 둘이 같은 번호면 그중 관리자 하나 · 관리자가 없거나 둘이면 링크 없음', () => {
    const m = pickLinkApprovers(['01052575257'], 'u-creator', [
      { id: 's-admin', company_id: 'co-staff', user_type: 'admin', mfa_phone: '01052575257' },
      { id: 's-shared', company_id: 'co-staff', user_type: 'user', mfa_phone: '01052575257' },
    ], STAFF);
    expect(m.get('01052575257')).toBe('s-admin');
    expect(pickLinkApprovers(['01052575257'], 'u-creator', [
      { id: 's-1', company_id: 'co-staff', user_type: 'user', mfa_phone: '01052575257' },
      { id: 's-2', company_id: 'co-staff', user_type: 'user', mfa_phone: '01052575257' },
    ], STAFF).size).toBe(0);
  });

  it('고객사 계정이 같은 번호를 갖고 있으면 고객사 쪽이 먼저다(고객사 본인 등록 뒤에는 직원 승인이 빠진다)', () => {
    const m = pickLinkApprovers(['01049564956'], 'u-creator', [
      { id: 'u-creator', company_id: 'co-1', user_type: 'user', mfa_phone: '01049564956' },
      { id: 's-1', company_id: 'co-staff', user_type: 'user', mfa_phone: '01049564956' },
    ], STAFF);
    expect(m.get('01049564956')).toBe('u-creator');
  });

  it('직원 회사 ENV = 회사 id 목록만(전 회사 * · 형식 밖 값은 버린다)', () => {
    expect(agencyStaffCompanyIds(' 11111111-2222-3333-4444-555555555555 , * ,abc,')).toEqual(['11111111-2222-3333-4444-555555555555']);
    expect(agencyStaffCompanyIds(undefined)).toEqual([]);
    expect(agencyStaffCompanyIds('*')).toEqual([]);
    // ★Codex 3R medium — PG 는 uuid 를 소문자로 돌려준다. 대문자로 적은 ENV 도 직원으로 맞아야 한다
    expect(agencyStaffCompanyIds('ABCDEF01-2222-3333-4444-55555555AAAA')).toEqual(['abcdef01-2222-3333-4444-55555555aaaa']);
  });

  it('조회 = 접수 회사(접수 계정 · 관리자) + 직원 회사 계정 · 직원 회사는 ENV 에서', async () => {
    const prev = process.env.AGENCY_STAFF_COMPANY_IDS;
    process.env.AGENCY_STAFF_COMPANY_IDS = '11111111-2222-3333-4444-555555555555';
    try {
      const db = { query: vi.fn(async () => ({ rows: [
        { id: 's-1', company_id: '11111111-2222-3333-4444-555555555555', user_type: 'user', mfa_phone: '01049564956' },
      ] })) };
      const m = await resolveLinkApprovers({ company_id: 'co-1', created_by: 'u-creator', manager_phones: ['01049564956'] }, db);
      expect(m.get('01049564956')).toBe('s-1');
      const [sql, params] = (db.query.mock.calls[0] as any[]);
      expect(String(sql)).toMatch(/company_id = ANY\(\$3::uuid\[\]\)/);
      expect(params[2]).toEqual(['11111111-2222-3333-4444-555555555555']);
    } finally {
      if (prev === undefined) delete process.env.AGENCY_STAFF_COMPANY_IDS; else process.env.AGENCY_STAFF_COMPANY_IDS = prev;
    }
  });

  it('링크 없는 번호에 붙는 안내 줄 = 링크 받는 번호 끝자리', () => {
    expect(buildNoLinkApproverLine(['01011112222', '01033334444'])).toBe('승인은 끝자리 2222, 4444 담당자가 휴대폰으로 합니다.');
    expect(buildNoLinkApproverLine([])).toBe('');
  });
});

describe('② 승인 CT — 발신 인증 게이트의 자리', () => {
  beforeEach(() => {
    clientQuery.mockReset(); release.mockReset(); gateMock.mockReset(); qmock.mockReset();
    rowCallbacksMock.mockReset(); rowCallbacksMock.mockResolvedValue([]);
    enforcedMock.mockReset(); enforcedMock.mockReturnValue(true);
    qmock.mockResolvedValue({ rows: [] });
  });

  /** 사전 읽기(query) → 링크면 승인 계정 조회(query) → 트랜잭션(client) 순서로 응답을 깐다 */
  const primePreRead = (row: any, users: any[] = []) => {
    qmock.mockImplementation(async (sql: string) => {
      if (/FROM agency_send_requests/.test(sql)) return { rows: [row] };
      if (/FROM users/.test(sql)) return { rows: users };
      return { rows: [] };
    });
  };
  const primeTx = (row: any, users: any[] = []) => {
    clientQuery.mockImplementation(async (sql: string) => {
      if (/FOR UPDATE/.test(sql)) return { rows: [row] };
      if (/FROM users/.test(sql)) return { rows: users };
      if (/UPDATE agency_send_requests/.test(sql)) return { rows: [{ ...row, status: 'approved' }] };
      return { rows: [] };
    });
  };

  it('승인할 수 없는 건(이미 승인됨)에는 인증번호를 보내지 않는다 · 트랜잭션도 열지 않는다', async () => {
    primePreRead({ ...ROW, status: 'approved' });
    const out = await approveAgencyRequestTx({ requestId: 'req-1', revision: 7, companyId: 'co-1', approvedBy: 'u-creator', via: 'screen', req: {} });
    expect(out.ok).toBe(false);
    expect(gateMock).not.toHaveBeenCalled();
    expect(clientQuery).not.toHaveBeenCalled();
  });

  it('게이트가 막으면 403 SENDER_AUTH_REQUIRED + 인증 재료 · 트랜잭션을 열지 않는다', async () => {
    primePreRead(ROW);
    gateMock.mockResolvedValue({ ok: false, reason: 'first', challengeId: 'ch-1', maskedPhone: '010-****-2222', callback: '0212345678', expiresInMinutes: 5 });
    const out: any = await approveAgencyRequestTx({ requestId: 'req-1', revision: 7, companyId: 'co-1', approvedBy: 'u-creator', via: 'screen', req: {} });
    expect(out).toMatchObject({ ok: false, status: 403, code: 'SENDER_AUTH_REQUIRED' });
    expect(out.senderAuth.challengeId).toBe('ch-1');
    expect(gateMock.mock.calls[0][0]).toMatchObject({ userId: 'u-creator', companyId: 'co-1', callback: '0212345678', useIndividualCallback: false });
    expect(clientQuery).not.toHaveBeenCalled();
  });

  it('인증 키 = 발송과 같은 판정 — 수신자 회신번호가 하나라도 있으면 계정 축(*) (최종 검증 7)', async () => {
    primePreRead(ROW);
    rowCallbacksMock.mockResolvedValue(['0299990000']);
    gateMock.mockResolvedValue({ ok: false, reason: 'first', challengeId: 'c', maskedPhone: 'm', callback: 'x', expiresInMinutes: 5 });
    await approveAgencyRequestTx({ requestId: 'req-1', revision: 7, companyId: 'co-1', approvedBy: 'u-creator', via: 'screen', req: {} });
    expect(gateMock.mock.calls[0][0].useIndividualCallback).toBe(true);
  });

  it('스위치가 꺼져 있으면 수신자 회신번호 조회도 하지 않는다(오늘 동작 그대로)', async () => {
    enforcedMock.mockReturnValue(false);
    primePreRead(ROW);
    primeTx(ROW);
    gateMock.mockResolvedValue({ ok: true });
    const out = await approveAgencyRequestTx({ requestId: 'req-1', revision: 7, companyId: 'co-1', approvedBy: 'u-creator', via: 'screen', req: {} });
    expect(out.ok).toBe(true);
    expect(rowCallbacksMock).not.toHaveBeenCalled();
  });

  it('링크 승인 = 토큰 번호의 승인 계정으로 게이트 · 잠금 아래 재판정 · approved_by 기록', async () => {
    const users = [{ id: 'u-creator', user_type: 'user', mfa_phone: '01011112222' }];
    primePreRead(ROW, users);
    primeTx(ROW, users);
    gateMock.mockResolvedValue({ ok: true });
    const out = await approveAgencyRequestTx({
      requestId: 'req-1', revision: 7, approvedBy: null, via: 'link', req: {},
      link: { phone: '01011112222', contentVersion: 3 },
    });
    expect(out.ok).toBe(true);
    expect(gateMock.mock.calls[0][0].userId).toBe('u-creator');
    const upd = clientQuery.mock.calls.find((c) => /UPDATE agency_send_requests/.test(String(c[0])))!;
    expect(upd[1][0]).toBe('u-creator');
    const ev = clientQuery.mock.calls.find((c) => /INSERT INTO agency_send_events/.test(String(c[0])))!;
    expect(JSON.parse(ev[1][1])).toMatchObject({ via: 'link', by: 'u-creator', phone: '01011112222' });
    // 승인 계정 조회가 트랜잭션 안에서도 한 번 더 돈다
    expect(clientQuery.mock.calls.some((c) => /FROM users/.test(String(c[0])))).toBe(true);
  });

  it('링크 번호에 승인 계정이 없으면 404 · 인증번호를 보내지 않는다', async () => {
    primePreRead(ROW, []);
    const out: any = await approveAgencyRequestTx({
      requestId: 'req-1', revision: 7, approvedBy: null, via: 'link', req: {},
      link: { phone: '01011112222', contentVersion: 3 },
    });
    expect(out).toMatchObject({ ok: false, status: 404 });
    expect(gateMock).not.toHaveBeenCalled();
  });

  it('잠금 아래에서 승인 계정이 바뀌었으면(강등·비활성·번호 변경) 404 로 되돌린다', async () => {
    primePreRead(ROW, [{ id: 'u-creator', user_type: 'user', mfa_phone: '01011112222' }]);
    primeTx(ROW, []);   // 트랜잭션 안에서는 그 계정이 더 이상 후보가 아니다
    gateMock.mockResolvedValue({ ok: true });
    const out: any = await approveAgencyRequestTx({
      requestId: 'req-1', revision: 7, approvedBy: null, via: 'link', req: {},
      link: { phone: '01011112222', contentVersion: 3 },
    });
    expect(out).toMatchObject({ ok: false, status: 404 });
    expect(clientQuery.mock.calls.some((c) => /UPDATE agency_send_requests/.test(String(c[0])))).toBe(false);
  });
});

describe('④ 인증번호 확인 응답 = CT 함수 하나', () => {
  it('통과 · 만료 · 잠김 · 불일치', () => {
    expect(senderAuthVerifyResponse({ status: 'ok', callbackNumber: '0212345678' })).toEqual({ status: 200, body: { success: true, callback: '0212345678' } });
    expect(senderAuthVerifyResponse({ status: 'expired' }).body.code).toBe('SENDER_AUTH_EXPIRED');
    expect(senderAuthVerifyResponse({ status: 'locked' }).body.code).toBe('SENDER_AUTH_LOCKED');
    const inv = senderAuthVerifyResponse({ status: 'invalid', remaining: 3 });
    expect(inv.status).toBe(400);
    expect(inv.body.error).toContain('남은 시도 3회');
  });

  it('로그인 경로와 링크 경로가 같은 함수를 쓴다', () => {
    expect(src('routes/auth.ts')).toContain('senderAuthVerifyResponse(verdict)');
    const ap = src('routes/agency-approve.ts');
    expect(ap).toContain("router.post('/sender-auth/verify'");
    expect(ap).toContain('senderAuthVerifyResponse(verdict)');
    expect(ap).toMatch(/verifySenderAuthChallenge\(\{[^}]*userId: resolved\.approverUserId/);
  });
});

describe('배선 — 발급 · 링크 열기 · 승인 라우트', () => {
  it('승인 링크 발급은 승인 계정이 있는 번호에만(워커 3분기 공통 함수)', () => {
    const w = src('utils/agency-send-worker.ts');
    const body = w.slice(w.indexOf('async function buildApproveTexts'), w.indexOf('async function sendManagerTest'));
    expect(body).toContain('resolveLinkApprovers(');
    expect(body).toContain('buildNoLinkApproverLine(');
    // 세 분기 + ★2026-10-18 축 4 두 곳(24시간 만료 안내 · 시각 변경 뒤 승인 요청 다시 보내기)이 접수 계정을 넘긴다
    expect((w.match(/buildApproveTexts\(managerPhonesOf\(/g) || []).length).toBe(5);
    expect((w.match(/created_by \?\? null\),/g) || []).length).toBe(5);
  });

  it('링크 열기도 승인 계정을 판정한다(없으면 같은 404)', () => {
    const ap = src('routes/agency-approve.ts');
    const fn = ap.slice(ap.indexOf('async function resolveToken'), ap.indexOf('function toApprovalView'));
    expect(fn).toContain('resolveLinkApprovers(');
    expect(fn).toContain('approverUserId');
  });

  it('PC 승인 · 링크 승인 라우트가 403 인증 요구를 같은 몸통으로 돌려준다', () => {
    for (const p of ['routes/agency-send.ts', 'routes/agency-approve.ts']) {
      const s = src(p);
      expect(s, p).toContain('senderAuthRejection(');
      expect(s, p).toMatch(/approveAgencyRequestTx\(\{[\s\S]{0,400}req: \{ ip:/);
    }
  });

  it('승인 CT: 게이트는 BEGIN 앞 · 승인 판정이 게이트 앞', () => {
    const s = src('utils/agency-send-approve.ts');
    const gate = s.indexOf('checkSenderAuthGate(');
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(s.indexOf("client.query('BEGIN')"));
    expect(s.indexOf('checkApproval(')).toBeLessThan(gate);
  });
});

describe('⑤ 화면 배선', () => {
  it('PC 상세 승인 = useSenderAuth 훅 + 인증 창 · 판정은 서버', () => {
    const d = fe('components/agency/AgencySendDetail.tsx');
    expect(d).toMatch(/useSenderAuth\(\)/);
    expect(d).toContain('<SenderAuthModal');
    const approve = d.slice(d.indexOf('const doApprove'), d.indexOf('const doSaveContent'));
    expect(approve).toMatch(/senderAuth\.handleResponse\(/);
    expect(d).not.toMatch(/SENDER_AUTH_ENFORCE_FROM|SENDER_AUTH_PILOT_LOGIN_IDS/);
  });

  it('모바일 링크 화면 = 같은 훅 + 링크 토큰 확인 함수 주입', () => {
    const p = fe('pages/AgencyApprovePage.tsx');
    expect(p).toMatch(/useSenderAuth\(\{\s*verifyRequest/);
    expect(p).toContain('<SenderAuthModal');
    expect(p).toMatch(/senderAuth\.handleResponse\(/);
    expect(p).not.toMatch(/SENDER_AUTH_ENFORCE_FROM|SENDER_AUTH_PILOT_LOGIN_IDS/);
    expect(p).not.toContain('이 화면은 입력을 받지 않습니다');
    expect(p).toContain('인증번호는 이 화면에만 입력합니다');
    const api = fe('components/agency/agency-send-api.ts');
    expect(api).toContain("'/api/agency-approve/sender-auth/verify'");
    expect(api).toMatch(/'X-Agency-Approve-Token'/);
  });

  it('훅의 기본 확인 경로는 그대로 · 인증 입력칸은 문자 자동 채움', () => {
    expect(fe('hooks/useSenderAuth.ts')).toContain('/api/auth/sender-auth/verify');
    expect(fe('components/SenderAuthModal.tsx')).toContain('autoComplete="one-time-code"');
  });

  it('API 오류에 서버 몸통이 실린다(인증 재료를 화면이 읽는다)', () => {
    const api = fe('components/agency/agency-send-api.ts');
    const fn = api.slice(api.indexOf('async function unwrap'), api.indexOf('async function unwrap') + 400);
    expect(fn).toContain('err.data = data');
  });
});
