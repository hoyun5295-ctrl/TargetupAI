/**
 * 대행발송 자격 확인이 DB 오류에 매달리지 않는다 (★ 2026-09-26 한줄로 V2 R285 · CRASH 묶음)
 *
 * Express 4는 async 핸들러의 거절을 받지 않는다. 대행발송 전 라우트가 try 밖에서 `requireAgencySend`(요금제 조회)를 불러,
 * 그 조회가 던지면 응답 없이 unhandledRejection 로그만 남고 요청이 매달렸다(화면은 시간 초과까지 로딩).
 * 처방: 자격 확인 함수 안에서 조회 실패를 JSON 500으로 끝낸다(라우트·미들웨어 전부 이 함수를 지난다).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../middlewares/auth', () => ({ authenticate: (_q: any, _r: any, n: any) => n() }));
vi.mock('../../config/database', () => ({
  default: { query: vi.fn(async () => ({ rows: [] })), connect: vi.fn() },
  query: vi.fn(async () => ({ rows: [] })),
}));
vi.mock('../plan-guard', async (orig) => {
  const actual: any = await orig();
  return { ...actual, loadPlanContext: vi.fn(async () => { throw new Error('connect ETIMEDOUT'); }) };
});

import router from '../../routes/agency-send';

function findHandler(method: string, path: string) {
  const layer = (router as any).stack.find((l: any) => l.route && l.route.path === path && l.route.methods[method]);
  const handles = layer.route.stack.map((s: any) => s.handle);
  return handles[handles.length - 1];
}

function mockRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: any) => { res.body = b; return res; };
  return res;
}

describe('대행발송 자격 확인 실패', () => {
  it('요금제 조회가 던져도 JSON 500으로 끝난다(매달리지 않는다)', async () => {
    const handler = findHandler('get', '/');
    const res = mockRes();
    await handler({ user: { companyId: 'c1', userId: 'u1', userType: 'company_admin' }, query: {} }, res, () => undefined);
    expect(res.statusCode).toBe(500);
    expect(res.body?.success).toBe(false);
  });
});

// 같은 뿌리(자격 확인 헬퍼가 try 밖 조회) — 인앱·이메일·온보딩 헬퍼도 조회 실패를 JSON 500으로 끝낸다
import { readFileSync } from 'fs';
import { resolve } from 'path';
describe('같은 모양 헬퍼', () => {
  const read = (f: string) => readFileSync(resolve(__dirname, '../../routes', f), 'utf8');
  const body = (src: string, head: string) => src.slice(src.indexOf(head), src.indexOf('\n}\n', src.indexOf(head)));
  it.each([
    ['cdp.ts', 'async function ensureInAppAccess(', 'isCdpEnabledForPlan(companyId)'],
    ['email.ts', 'async function ensureEmailAdmin(', 'isCdpEnabledForPlan(companyId)'],
    ['email.ts', 'async function ensureEmailAccess(', 'isCdpEnabledForPlan(companyId)'],
    ['onboarding.ts', 'async function requireAiOperatorTrialActive(', 'loadPlanContext(companyId)'],
  ])('%s %s 조회는 try 안이고 실패는 500', (file, head, call) => {
    const b = body(read(file), head);
    const callAt = b.indexOf(call);
    expect(callAt).toBeGreaterThan(-1);
    expect(b.lastIndexOf('try {', callAt)).toBeGreaterThan(-1);
    expect(b.slice(callAt)).toMatch(/catch \(err: any\)[\s\S]*status\(500\)/);
  });
});

