/**
 * 대행발송 개편 축 0 — 승인의 법정 추가 인증(전송자격인증 3.5) + 링크 승인 계정 (★2026-10-16 · 설계 = docs/2026-10-16-agency-send-mobile-control-design.md §2 축 0)
 *
 * 고정하는 것
 *   ① ★2026-11-05 Harold 「양식의 담당자(테스트 받을) 번호로 다 나가서 승인 · 로그인 인증번호는 사용자 ID 하나당 하나」
 *      = 승인 링크는 요청서 담당자 번호 **전부**에 간다(1016 의 「계정 MFA 번호와 같은 번호에만」을 되돌림)
 *   ② 로그인 화면 승인은 발신 인증 게이트를 부른다 — 승인할 수 없는 건에는 인증번호 문자를 보내지 않고, 막히면 트랜잭션을 열지 않는다
 *   ③ 링크 승인 = 토큰 번호가 지금도 담당자 · 문안 버전 같음 · 인증번호 없음 · approved_by NULL · 이력에 누른 번호
 *   ④ 인증번호 확인 응답 = 로그인 경로 CT 함수 · 링크 경로에는 인증번호 확인 주소가 없다
 *   ⑤ 화면 배선(PC 상세 = 인증 훅 · 모바일 링크 화면 = 인증번호 창 없음)
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
import { senderAuthVerifyResponse } from '../sender-auth';

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

describe('① 링크 = 요청서 담당자 번호 전부(★1105)', () => {
  it('승인 문장 발급은 번호마다 승인 주소를 싣는다 · 계정 MFA 번호 대조 · 링크 없는 갈래가 없다', () => {
    const w = src('utils/agency-send-worker.ts');
    const body = w.slice(w.indexOf('async function buildApproveTexts'), w.indexOf('async function sendManagerTest'));
    expect(body).toContain('buildShortAgencyApproveUrl(');
    expect(body).not.toMatch(/resolveLinkApprovers|buildNoLinkApproverLine|mfa_phone|continue;/);
    expect(body).toMatch(/for \(const phone of phones\)[\s\S]*out\.push\(\{ phone, text: compose\(approveUrl\) \}\)/);
  });

  it('계정 MFA 번호로 링크 권한을 정하던 함수 · 직원 회사 ENV 는 코드에 없다', () => {
    for (const p of ['utils/agency-send-link.ts', 'utils/agency-send-approve.ts', 'routes/agency-approve.ts', 'utils/agency-send-worker.ts', 'utils/agency-send-notify.ts']) {
      expect(src(p), p).not.toMatch(/resolveLinkApprovers|pickLinkApprovers|AGENCY_STAFF_COMPANY_IDS|buildNoLinkApproverLine/);
    }
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

  it('링크 승인 = 담당자 번호면 승인 · 인증 관문 없음(계정 로그인 인증번호와 무관) · approved_by NULL · 이력에 누른 번호', async () => {
    primePreRead(ROW);
    primeTx(ROW);
    gateMock.mockResolvedValue({ ok: false, reason: 'first', challengeId: 'x', maskedPhone: 'm', callback: 'c', expiresInMinutes: 5 });
    const out = await approveAgencyRequestTx({
      requestId: 'req-1', revision: 7, approvedBy: null, via: 'link', req: {},
      link: { phone: '01033334444', contentVersion: 3 },
    });
    expect(out.ok).toBe(true);
    expect(gateMock).not.toHaveBeenCalled();
    expect(qmock.mock.calls.some((c) => /FROM users/.test(String(c[0])))).toBe(false);
    const upd = clientQuery.mock.calls.find((c) => /UPDATE agency_send_requests/.test(String(c[0])))!;
    expect(upd[1][0]).toBeNull();
    const ev = clientQuery.mock.calls.find((c) => /INSERT INTO agency_send_events/.test(String(c[0])))!;
    const payload = JSON.parse(ev[1][1]);
    expect(payload).toMatchObject({ via: 'link', phone: '01033334444' });
    expect(payload.by).toBeUndefined();
  });

  it('링크 승인에 approvedBy 가 실려 와도 그 계정 관문을 걸지 않는다', async () => {
    primePreRead(ROW);
    primeTx(ROW);
    const out = await approveAgencyRequestTx({
      requestId: 'req-1', revision: 7, approvedBy: 'u-creator', via: 'link', req: {},
      link: { phone: '01011112222', contentVersion: 3 },
    });
    expect(out.ok).toBe(true);
    expect(gateMock).not.toHaveBeenCalled();
  });

  it('담당자 목록에 없는 번호의 링크 = 404 · 트랜잭션을 열지 않는다', async () => {
    primePreRead(ROW);
    const out: any = await approveAgencyRequestTx({
      requestId: 'req-1', revision: 7, approvedBy: null, via: 'link', req: {},
      link: { phone: '01099998888', contentVersion: 3 },
    });
    expect(out).toMatchObject({ ok: false, status: 404 });
    expect(clientQuery).not.toHaveBeenCalled();
  });

  it('잠금 아래에서 그 번호가 담당자에서 빠졌으면 404 로 되돌린다', async () => {
    primePreRead(ROW);
    primeTx({ ...ROW, manager_phones: ['01011112222'] });
    const out: any = await approveAgencyRequestTx({
      requestId: 'req-1', revision: 7, approvedBy: null, via: 'link', req: {},
      link: { phone: '01033334444', contentVersion: 3 },
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

  it('로그인 경로는 CT 함수 · 링크 경로에는 인증번호 확인 주소가 없다(★1105)', () => {
    expect(src('routes/auth.ts')).toContain('senderAuthVerifyResponse(verdict)');
    const ap = src('routes/agency-approve.ts');
    expect(ap).not.toContain('/sender-auth/verify');
    expect(ap).not.toMatch(/verifySenderAuthChallenge|senderAuthRejection/);
  });
});

describe('배선 — 발급 · 링크 열기 · 승인 라우트', () => {
  it('승인 링크 발급 = 워커 분기 공통 함수 하나(세 분기 + 축 4 두 곳)', () => {
    const w = src('utils/agency-send-worker.ts');
    expect((w.match(/buildApproveTexts\(managerPhonesOf\(/g) || []).length).toBe(5);
  });

  it('링크 열기 = 토큰 번호가 지금도 담당자 · 문안 버전 같음(계정 판정 없음)', () => {
    const ap = src('routes/agency-approve.ts');
    const fn = ap.slice(ap.indexOf('async function resolveToken'), ap.indexOf('function toApprovalView'));
    expect(fn).toContain('agencyManagerPhones(row).includes(payload.phone)');
    expect(fn).not.toContain('approverUserId');
  });

  it('PC 승인 라우트는 403 인증 요구를 같은 몸통으로 돌려준다(링크 라우트는 인증 요구가 없다)', () => {
    const s = src('routes/agency-send.ts');
    expect(s).toContain('senderAuthRejection(');
    expect(s).toMatch(/approveAgencyRequestTx\(\{[\s\S]{0,400}req: \{ ip:/);
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

  it('모바일 링크 화면 = 인증번호 창 · 안내 없음(★1105)', () => {
    const p = fe('pages/AgencyApprovePage.tsx');
    expect(p).not.toMatch(/useSenderAuth|SenderAuthModal|senderAuth\.|verifyAgencyLinkSenderAuth/);
    expect(p).not.toContain('인증번호는 이 화면에만 입력합니다');
    expect(p).not.toContain('인증번호 창이 뜨면');
    expect(fe('components/agency/agency-send-api.ts')).not.toContain('/api/agency-approve/sender-auth/verify');
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
