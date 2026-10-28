/**
 * ★ 2026-10-18 플래너 당일 재확인(쌍 단위) — 설계서 docs/2026-10-18-planner-v2-design.md §3-2 · 회의론자 B1~B11 · M1~M3
 *
 * 고정하는 것
 *   ① 검사 판정 3분할(B6) — 결과 0행 · NULL · 시간 초과 = error(통과로 접지 않는다) · 시연 회사(검사 0건) = pass
 *   ② 새 문안 안전 검사 — 원문에 있던 혜택이 빠지면 · 원문에 없던 숫자가 생기면 버린다
 *   ③ 쌍 재확인 진입 — 실행이 주인일 때만 · 행사 승인은 그대로 · 쌍만 planned + recheck · 마감 뒤면 생략 · 취소된 행사면 생략
 *   ④ 쌍 승인 · 건너뛰기 = 같은 조건(B2) — 회차 · 마감 · 화면이 본 지문 · 읽어 둔 상태 그대로(잠금 아래)
 *   ⑤ 엄격 인증(B5) — 시행 스위치와 무관 · MFA 번호 없으면 막음 · 세션이 살아 있어야 통과 · 아니면 인증번호
 *   ⑥ 배선 — 실행부 · 승인 직후 검사가 쌍 재확인으로 · 행사 단위 전이 4곳이 recheck 를 지운다(B4) · M1 · M3 · B1 · B7 · B8 · 링크 인증 자리
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const clientQuery = vi.fn();
const release = vi.fn();
vi.mock('../../config/database', () => ({
  pool: { connect: vi.fn(async () => ({ query: clientQuery, release })) },
  query: vi.fn(async () => ({ rows: [] })),
}));
vi.mock('../system-alimtalk', () => ({ trySendAuthCodeAlimtalk: vi.fn(async () => true) }));
vi.mock('../audit-log', () => ({ recordAuditLog: vi.fn(async () => undefined) }));

import { query } from '../../config/database';
import { spamVerdictOf } from '../spam-test-queue';
// ★ 1024 판정 한 곳(뿌리 대장 R7) — 옛 plannerSpamVerdict(결과 전체) = 첫 안의 공용 판정
const plannerSpamVerdict = (res: { variants: any[]; totalTestCount: number }) => spamVerdictOf(res?.variants?.[0], res?.totalTestCount);
import { enterPairRecheck } from '../planner-review';
import { recheckProposalIssue, buildRecheckNotice, plannerLinkApproveCompanyIds, recheckDeadlineAt } from '../planner-recheck';
import { checkStrictSenderAuth, senderAuthDeviceProof } from '../sender-auth';
import { computeTouchpointDate } from '../marketing-planner';
import { describeTiming } from '../planner-execution';

const qmock = query as unknown as ReturnType<typeof vi.fn>;
const SRC = join(__dirname, '..', '..');
const src = (p: string) => readFileSync(join(SRC, p), 'utf8');

describe('① 검사 판정 3분할(B6)', () => {
  const r = (spamResult: string, carrierResults: Array<{ result: string }>, totalTestCount = 1) => ({ variants: [{ spamResult, carrierResults }], totalTestCount });
  it('통과 = 결과 1개 이상 + 시간 초과 · 실패 0', () => {
    expect(plannerSpamVerdict(r('pass', [{ result: 'received' }, { result: 'received' }]))).toBe('pass');
  });
  it('결과 0행 · NULL(시간 초과로 바뀜) · 실패는 error', () => {
    expect(plannerSpamVerdict(r('pass', []))).toBe('error');
    expect(plannerSpamVerdict(r('pass', [{ result: 'timeout' }]))).toBe('error');
    expect(plannerSpamVerdict(r('pass', [{ result: '' }]))).toBe('error');
    expect(plannerSpamVerdict(r('failed', []))).toBe('error');
    expect(plannerSpamVerdict(r('timeout', []))).toBe('error');
    expect(plannerSpamVerdict({ variants: [], totalTestCount: 1 })).toBe('error');
  });
  it('차단 = blocked · 시연 회사(검사 0건 통과) = pass', () => {
    expect(plannerSpamVerdict(r('blocked', [{ result: 'blocked' }]))).toBe('blocked');
    expect(plannerSpamVerdict(r('pass', [], 0))).toBe('pass');
  });
});

describe('② 새 문안 안전 검사', () => {
  const base = { original: '가을 세일 20% 할인 쿠폰을 드려요', originalSubject: '가을 세일', benefit: '20% 할인', title: '가을 세일', dates: ['2026-10-20', '2026-10-25', '2026-10-20'] };
  it('원문 혜택이 그대로 있고 새 숫자가 없으면 통과', () => {
    expect(recheckProposalIssue({ ...base, text: '이번 가을 세일에서 20% 할인 받아 가세요. 10월 25일까지', subject: '가을 세일 안내' })).toBeNull();
  });
  it('원문에 있던 혜택이 빠지면 버린다', () => {
    expect(recheckProposalIssue({ ...base, text: '가을 세일이 시작됐어요', subject: '' })).toBe('benefit_missing');
  });
  it('원문 · 혜택 · 행사명 · 날짜에 없던 숫자가 생기면 버린다', () => {
    expect(recheckProposalIssue({ ...base, text: '가을 세일 20% 할인에 3만원 추가 적립', subject: '' })).toBe('new_number');
    expect(recheckProposalIssue({ ...base, text: '가을 세일 20% 할인 · 선착순 100명', subject: '' })).toBe('new_number');
  });
  it('채워지지 않은 혜택 자리는 버린다', () => {
    expect(recheckProposalIssue({ ...base, text: '[혜택 직접 작성해주세요] 20% 할인', subject: '' })).toBe('placeholder');
  });
});

describe('통지 문장 · 스위치 · 마감', () => {
  it('당일 = 오늘 20시 · 다른 날 그대로 · 링크', () => {
    const t = buildRecheckNotice({ title: '가을 세일', date: '2026-10-20', today: '2026-10-20', origin: 'send_day', proposalReady: true, link: 'https://hanjul.ai/planner-recheck#t=x', nextSend: '2026-10-25' });
    expect(t).toContain('오늘 문자가 스팸 검사에 막혀');
    expect(t).toContain('새로 쓴 문안은 검사를 통과했습니다');
    expect(t).toContain('오늘 20시까지 정하시면 오늘 보냅니다');
    expect(t).toContain('다른 날은 그대로 갑니다');
    expect(t).toContain('처리하기: https://hanjul.ai/planner-recheck#t=x');
    expect(t).not.toMatch(/—/);
  });
  it('새 문안이 없으면 직접 고치기 안내', () => {
    const t = buildRecheckNotice({ title: '가을 세일', date: '2026-10-22', today: '2026-10-20', origin: 'post_approval', proposalReady: false, link: 'L', nextSend: null });
    expect(t).toContain('새 문안을 만들지 못했어요');
    expect(t).toContain('10/22(목) 20시까지 정하시면 그날 보냅니다');
  });
  it('회사 스위치 = 빈 값이면 닫힘 · uuid 만', () => {
    expect(plannerLinkApproveCompanyIds('')).toEqual([]);
    expect(plannerLinkApproveCompanyIds('*, abc')).toEqual([]);
    expect(plannerLinkApproveCompanyIds('AAAAAAAA-0000-0000-0000-000000000001')).toEqual(['aaaaaaaa-0000-0000-0000-000000000001']);
  });
  it('마감 = 그 날 20시 KST', () => {
    expect(recheckDeadlineAt('2026-10-20').toISOString()).toBe('2026-10-20T11:00:00.000Z');
  });
});

describe('미룬 날(TimingRule.on)', () => {
  it('예정일 계산 한 곳이 앵커보다 먼저 본다 · 시점 라벨', () => {
    expect(computeTouchpointDate({ anchor: 'start', on: '2026-10-23' }, '2026-10-20', '2026-10-25')).toBe('2026-10-23');
    expect(computeTouchpointDate({ anchor: 'end', on: 'bad' }, '2026-10-20', '2026-10-25')).toBe('2026-10-25');
    expect(describeTiming({ anchor: 'start', on: '2026-10-23' })).toBe('행사 기간 중 10/23');
  });
  it('입력 검증은 on 을 받지 않는다(서버만 쓴다)', () => {
    const m = src('utils/marketing-planner.ts');
    expect(m).toMatch(/timing: \{ anchor, \.\.\.\(offsetDays \? \{ offsetDays \} : \{\}\) \}/);
  });
});

describe('③ 쌍 재확인 진입', () => {
  const NOW = new Date('2026-10-20T03:00:00Z'); // KST 12시
  const rowsOf = (over: Partial<Record<string, any>> = {}) => [
    { id: 'c1', status: 'producing', timing_rule: { anchor: 'start' }, exec_meta: { claim_token: 'tok', approved: { hash: 'h' }, ...(over.c1 || {}) } },
    { id: 'd1', status: 'producing', timing_rule: { anchor: 'start' }, exec_meta: { claim_token: 'tok', approved: { hash: 'h2' }, ...(over.d1 || {}) } },
  ];
  const wire = (evStatus: string, rows: any[]) => {
    clientQuery.mockImplementation(async (sql: string) => {
      if (/SELECT plan_month FROM planner_events/.test(sql)) return { rows: [{ plan_month: '2026-10' }] };
      if (/FROM planner_events WHERE id = \$1::uuid AND company_id = \$2::uuid FOR UPDATE/.test(sql)) return { rows: [{ status: evStatus, starts_on: '2026-10-20', ends_on: '2026-10-25' }] };
      if (/SELECT id, status, timing_rule, exec_meta FROM planner_touchpoints/.test(sql)) return { rows };
      if (/UPDATE planner_touchpoints/.test(sql)) return { rows: rows.map((r) => ({ id: r.id })) };
      return { rows: [] };
    });
  };
  beforeEach(() => { clientQuery.mockReset(); release.mockReset(); });

  it('주인일 때 쌍만 planned + recheck(round 1) · 승인 각인을 뗀다 · 행사 상태는 건드리지 않는다', async () => {
    wire('scheduled', rowsOf());
    const out = await enterPairRecheck({ companyId: 'co', eventId: 'ev', carrierId: 'c1', dmId: 'd1', fromStatus: 'producing', claimToken: 'tok', origin: 'send_day', now: NOW });
    expect(out).toEqual({ outcome: 'entered', round: 1, date: '2026-10-20' });
    const sqls = clientQuery.mock.calls.map((c) => String(c[0]));
    const up = clientQuery.mock.calls.find((c) => /SET status = 'planned'/.test(String(c[0])))!;
    expect(String(up[0])).toMatch(/- 'approved' - 'post_approval_spam'/);
    expect(String(up[0])).toMatch(/jsonb_build_object\('recheck'/);
    expect(up[1][1]).toEqual(['c1', 'd1']);
    expect(JSON.parse(up[1][5])).toMatchObject({ round: 1, date: '2026-10-20', origin: 'send_day' });
    expect(sqls.some((s) => /UPDATE planner_events/.test(s))).toBe(false);
    expect(sqls.indexOf('COMMIT')).toBeGreaterThan(-1);
    // 잠금 순서 = 월 원장 → 행사 → 접점
    const iMonth = sqls.findIndex((s) => /planner_monthly_approvals/.test(s));
    const iEv = sqls.findIndex((s) => /FROM planner_events WHERE id = \$1::uuid AND company_id = \$2::uuid FOR UPDATE/.test(s));
    const iTp = sqls.findIndex((s) => /FROM planner_touchpoints\s+WHERE company_id/.test(s) && /FOR UPDATE/.test(s));
    expect(iMonth).toBeLessThan(iEv);
    expect(iEv).toBeLessThan(iTp);
  });

  it('다음 회차는 round + 1', async () => {
    wire('approved', rowsOf({ c1: { recheck: { round: 2 } } }));
    const out = await enterPairRecheck({ companyId: 'co', eventId: 'ev', carrierId: 'c1', dmId: 'd1', fromStatus: 'producing', claimToken: 'tok', origin: 'send_day', now: NOW });
    expect(out.round).toBe(3);
  });

  it('선점 토큰이 다르면 아무것도 바꾸지 않는다(lost)', async () => {
    wire('scheduled', rowsOf({ d1: { claim_token: 'other' } }));
    const out = await enterPairRecheck({ companyId: 'co', eventId: 'ev', carrierId: 'c1', dmId: 'd1', fromStatus: 'producing', claimToken: 'tok', origin: 'send_day', now: NOW });
    expect(out.outcome).toBe('lost');
    expect(clientQuery.mock.calls.some((c) => /UPDATE planner_touchpoints/.test(String(c[0])))).toBe(false);
  });

  it('마감(20시) 뒤면 재확인을 열지 않고 쌍만 생략', async () => {
    wire('scheduled', rowsOf());
    const late = new Date('2026-10-20T11:30:00Z'); // KST 20:30
    const out = await enterPairRecheck({ companyId: 'co', eventId: 'ev', carrierId: 'c1', dmId: 'd1', fromStatus: 'producing', claimToken: 'tok', origin: 'send_day', now: late });
    expect(out.outcome).toBe('past_deadline');
    const up = clientQuery.mock.calls.find((c) => /UPDATE planner_touchpoints/.test(String(c[0])))!;
    expect(String(up[0])).toMatch(/SET status = 'skipped'/);
  });

  it('취소된 행사면 쌍을 생략으로 닫는다', async () => {
    wire('cancelled', rowsOf());
    const out = await enterPairRecheck({ companyId: 'co', eventId: 'ev', carrierId: 'c1', dmId: 'd1', fromStatus: 'producing', claimToken: 'tok', origin: 'send_day', now: NOW });
    expect(out.outcome).toBe('cancelled');
  });

  it('승인 직후 검사(ready)는 승인 각인이 있어야 들어온다', async () => {
    wire('approved', [
      { id: 'c1', status: 'ready', timing_rule: { anchor: 'end' }, exec_meta: {} },
    ]);
    const out = await enterPairRecheck({ companyId: 'co', eventId: 'ev', carrierId: 'c1', dmId: null, fromStatus: 'ready', claimToken: null, origin: 'post_approval', now: NOW });
    expect(out.outcome).toBe('lost');
  });
});

describe('⑤ 엄격 인증(B5)', () => {
  beforeEach(() => { qmock.mockReset(); });
  const prevEnforce = process.env.SENDER_AUTH_ENFORCE_FROM;

  it('시행 스위치가 꺼져 있어도 요구한다 · MFA 번호 없으면 막는다', async () => {
    delete process.env.SENDER_AUTH_ENFORCE_FROM;
    qmock.mockImplementation(async (sql: string) => (/SELECT mfa_phone FROM users/.test(sql) ? { rows: [{ mfa_phone: null }] } : { rows: [] }));
    const r = await checkStrictSenderAuth({ req: { ip: '1.2.3.4', headers: { 'user-agent': 'A' } }, userId: 'u1', companyId: 'co', callback: '0212345678' });
    expect(r).toEqual({ ok: false, blocked: 'no_mfa' });
    process.env.SENDER_AUTH_ENFORCE_FROM = prevEnforce;
  });

  it('같은 기기(세션 + 기기 증명)면 통과 · 증명 없음 · 다른 기기면 인증번호', async () => {
    const prevSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'test-secret';
    const verifiedAt = '2026-10-18T02:59:00.000Z';
    let issued = false;
    qmock.mockImplementation(async (sql: string) => {
      if (/SELECT mfa_phone FROM users/.test(sql)) return { rows: [{ mfa_phone: '01012345678' }] };
      if (/verified_at IS NOT NULL/.test(sql)) return { rows: [{ id: 's1', verified_at: verifiedAt, ip_address: '1.2.3.4', user_agent: 'PHONE', age_seconds: 60 }] };
      if (/ORDER BY created_at DESC/.test(sql)) return { rows: [] };
      if (/INSERT INTO sender_auth_challenges/.test(sql)) { issued = true; return { rows: [{ id: 'ch1' }] }; }
      return { rows: [] };
    });
    const device = senderAuthDeviceProof('s1', verifiedAt);
    const same = await checkStrictSenderAuth({ req: { ip: '1.2.3.9', headers: { 'user-agent': 'PHONE', 'x-sender-auth-device': device } }, userId: 'u1', companyId: 'co', callback: '02-1234-5678' });
    expect(same).toEqual({ ok: true });
    expect(issued).toBe(false);
    // ★ Codex A 1R — 같은 IP 대역 · 같은 브라우저라도 이 기기가 인증번호를 확인한 증명이 없으면 통과하지 않는다
    const noProof = await checkStrictSenderAuth({ req: { ip: '1.2.3.9', headers: { 'user-agent': 'PHONE' } }, userId: 'u1', companyId: 'co', callback: '02-1234-5678' });
    expect(noProof.ok).toBe(false);
    expect(issued).toBe(true);
    issued = false;
    if (prevSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = prevSecret;
    const other = await checkStrictSenderAuth({ req: { ip: '9.9.9.9', headers: { 'user-agent': 'PC' } }, userId: 'u1', companyId: 'co', callback: '02-1234-5678' });
    expect(other.ok).toBe(false);
    expect(issued).toBe(true);
    expect((other as any).gate).toMatchObject({ ok: false, challengeId: 'ch1', reason: 'environment' });
  });

  it('통과로 접는 앞단(시행 스위치 · 시범 명단 · 오류 삼킴)이 없다', () => {
    const s = src('utils/sender-auth.ts');
    const fn = s.slice(s.indexOf('export async function checkStrictSenderAuth'), s.indexOf('export async function isStrictSenderAuthAlive'));
    expect(fn).not.toMatch(/isSenderAuthEnforced|isSenderAuthRequiredFor|isSenderAuthPilotTarget|catch/);
    expect(fn).toMatch(/findVerifiedSession/);
    expect(fn).toMatch(/evaluateSenderAuthSession/);
  });
});

describe('⑥ 배선 계약', () => {
  it('실행부 당일 검사 = 판정 3분할 · 차단은 쌍 재확인 · 장애는 다음 주기 · 상한이면 쌍을 함께 잠금(B11)', () => {
    const e = src('utils/planner-executor.ts');
    expect(e).toMatch(/spamCheckPlannerVerdict\(/);
    expect(e).not.toMatch(/review\(PLANNER_REASON\.spamFailed/);
    expect(e).toMatch(/check\.verdict === 'error'\) return spamCheckDown/);
    expect(e).toMatch(/check\.verdict === 'blocked'\) return recheckPair/);
    expect(e).toMatch(/fromStatus: 'producing', claimToken: claim\.token, origin: 'send_day'/);
    const down = e.slice(e.indexOf('async function spamCheckDown'), e.indexOf('/** 예외(throw) 뒤 동반 DM 정리'));
    expect(down).toMatch(/setTouchpointStates\(tp\.companyId, ids\.map\(\(r\) => \(\{ id: r\.id, status: 'locked'/);
  });

  it('재확인 패스는 발송 시간대 판정 앞(B7) · 즉시 실행은 시간대 안에서만(B1)', () => {
    const e = src('utils/planner-executor.ts');
    // ★ Codex A 1R — 발송 패스 겹침 가드(passRunning) · 시간대 판정(executePass) 앞에서 따로 돈다
    const run = e.slice(e.indexOf('export async function runPlannerExecutionPass'), e.indexOf('let executorTimer'));
    expect(run.indexOf('void runPlannerRecheckPass()')).toBeGreaterThan(-1);
    expect(run.indexOf('void runPlannerRecheckPass()')).toBeLessThan(run.indexOf('if (passRunning) return'));
    expect(run.indexOf('if (passRunning) return')).toBeLessThan(run.indexOf('isSendableHourKst'));
    const kick = e.slice(e.indexOf('export function kickPlannerTouchpointNow'), e.indexOf('// ── 워커'));
    expect(kick).toMatch(/if \(!isSendableHourKst\(new Date\(\), SEND_HOURS\.start, SEND_HOURS\.end\)\) return;/);
  });

  it('승인 직후 검사도 쌍 재확인(행사 전체 되돌림 없음) · 검사 장애는 다음 주기', () => {
    const r = src('utils/planner-review.ts');
    const fn = r.slice(r.indexOf('async function checkCarrierAfterApproval'));
    expect(fn).toMatch(/enterPairRecheck\(/);
    expect(fn).not.toMatch(/revertEventToReview\(/);
    expect(fn).toMatch(/check\.verdict === 'error'\) return 'skip'/);
  });

  it('B4 — 행사 단위 전이 4곳이 recheck 를 지운다', () => {
    const a = src('utils/planner-approve.ts');
    expect(a).toMatch(/exec_meta = \(COALESCE\(exec_meta, '\{\}'::jsonb\) - 'recheck'\) \|\| \$3::jsonb/); // 행사 승인 각인
    const un = a.slice(a.indexOf('export async function unapprovePlannerEvent'), a.indexOf('export async function cancelPlannerEvent'));
    expect(un).toMatch(/exec_meta - 'recheck'/);
    const cancel = a.slice(a.indexOf('export async function cancelPlannerEvent'));
    expect(cancel).toMatch(/- 'recheck'/);
    const r = src('utils/planner-review.ts');
    const rev = r.slice(r.indexOf('export async function revertEventToReview'), r.indexOf('// ── 쌍 재확인 진입'));
    expect(rev).toMatch(/exec_meta - 'recheck'/);
  });

  it('M1 — 승인 직후 검사 표식은 오늘 뒤 캐리어에만', () => {
    expect(src('utils/planner-approve.ts')).toMatch(/carriesDm\.has\(t\.id\) && t\.scheduledOn > today\) patch\.post_approval_spam = 'pending'/);
  });

  it('M3 — 지난 재확인 쌍 = 「다시 확인되지 않아」', () => {
    const c = src('utils/planner-reconcile.ts');
    expect(c).toMatch(/PLANNER_REASON\.recheckMissed/);
    expect(c).toMatch(/다시 확인되지 않아 보내지 않았습니다/);
  });

  it('B8 — 통지 받는 사람은 함수 하나(번호 없는 통지와 재확인 링크가 같이 쓴다)', () => {
    const co = src('utils/continuous-operator.ts');
    const notify = co.slice(co.indexOf('export async function notifyOperatorAdmins'), co.indexOf('export async function notifyOperatorAdmins') + 3000);
    expect(notify).toMatch(/pickOwnerContact\(/);   // ★ 2026-10-28 B-1028-1 = utils/owner-contact.ts 한 곳(여정 안내 두 종도 같은 함수)
    const rc = src('utils/planner-recheck.ts');
    expect(rc).toMatch(/pickOwnerContact\(p\.ev\.companyId, p\.ev\.createdBy\)/);
    expect(rc).toMatch(/notifiedUserId: contact\.userId/);
    expect(rc).toMatch(/adminPhoneNumbers: \[contact\.phone\]/);
  });

  it('링크 = 보내기 · 고치기 · 취소만 인증번호(기기 묶인 엄격판) · 건너뛰기 · 미루기는 인증 없음 · 토큰은 헤더', () => {
    const r = src('routes/planner-recheck-public.ts');
    const part = (name: string) => r.slice(r.indexOf(`router.post('/${name}'`), r.indexOf('});', r.indexOf(`router.post('/${name}'`)));
    for (const n of ['approve', 'edit', 'cancel']) expect(part(n)).toMatch(/actingUser\(req, res, p\)/);
    for (const n of ['skip', 'defer']) expect(part(n)).not.toMatch(/actingUser\(/);
    expect(r).toMatch(/checkStrictSenderAuth\(/);
    expect(r).not.toMatch(/checkSenderAuthGate\(/);
    expect(r).toMatch(/PLANNER_RECHECK_TOKEN_HEADER/);
    expect(r).not.toMatch(/req\.query\.t|req\.params\.token/);
    const app = src('app.ts');
    expect(app).toMatch(/app\.use\('\/api\/planner-recheck', rateLimit/);
    expect(app).toMatch(/app\.use\('\/api\/planner-recheck', plannerRecheckPublicRouter\)/);
  });

  it('쌍 행동은 같은 조건 · 잠금 아래 읽어 둔 상태 그대로(B2 · B3)', () => {
    const rc = src('utils/planner-recheck.ts');
    for (const fn of ['approvePlannerPairTx', 'skipPlannerPairTx', 'editPlannerPairCopyTx', 'deferPlannerPairTx']) {
      const body = rc.slice(rc.indexOf(`export async function ${fn}`), rc.indexOf('\n}\n', rc.indexOf(`export async function ${fn}`)));
      expect(body).toMatch(/loadOpenPair\(/);
      expect(body).toMatch(/lockPairUnchanged\(client, p\)/);
    }
    // 고치기는 행사 리비전 · 상태를 건드리지 않는다(옛 editPlannerCopy 와 다르다)
    const edit = rc.slice(rc.indexOf('export async function editPlannerPairCopyTx'), rc.indexOf('export async function listDeferDates'));
    expect(edit).not.toMatch(/UPDATE planner_events/);
  });
});
