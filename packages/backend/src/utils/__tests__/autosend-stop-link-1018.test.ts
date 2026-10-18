/**
 * ★2026-10-18 자동마케팅 예고 문자 멈춤 링크(utils/autosend-stop-link.ts · routes/autosend-stop-public.ts · 설계서 docs/2026-10-18-planner-v2-design.md §3-8)
 * 토큰 = 범위 · 위조 · 키 없음 = 무효 · 만료 = 예정 시각 + 1시간 · 예고 문장 = 링크 있으면 주소 · 없으면 옛 문장 · 라우트 = 판정 뒤 같은 CT.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import { autosendStopTtlSeconds, signAutosendStopToken, verifyAutosendStopToken } from '../autosend-stop-link';
import { buildAutoSendPrepInfoBody } from '../autosend-policy';

const P = { proposalId: '11111111-1111-4111-8111-111111111111', operatorId: '22222222-2222-4222-8222-222222222222', companyId: '33333333-3333-4333-8333-333333333333' };
let saved: string | undefined;
beforeEach(() => { saved = process.env.JWT_SECRET; process.env.JWT_SECRET = 'test-secret-1018'; });
afterEach(() => { process.env.JWT_SECRET = saved; });

describe('토큰', () => {
  it('서명 → 검증 = 같은 값 · 범위가 다른 토큰 · 위조 = null', () => {
    const t = signAutosendStopToken({ ...P, sendAt: new Date(Date.now() + 3 * 3600_000) });
    expect(verifyAutosendStopToken(t)).toEqual(P);
    const other = jwt.sign({ scope: 'agency_approve', pr: P.proposalId, op: P.operatorId, co: P.companyId }, 'autosend-stop:test-secret-1018');
    expect(verifyAutosendStopToken(other)).toBeNull();
    expect(verifyAutosendStopToken(`${t}x`)).toBeNull();
    expect(verifyAutosendStopToken('')).toBeNull();
  });
  it('키 없음 = 서명 중단 · 검증 null(폴백 키 없음)', () => {
    const t = signAutosendStopToken({ ...P, sendAt: new Date(Date.now() + 3600_000) });
    delete process.env.JWT_SECRET;
    expect(() => signAutosendStopToken({ ...P, sendAt: new Date() })).toThrow();
    expect(verifyAutosendStopToken(t)).toBeNull();
  });
  it('만료 = 예정 시각 + 1시간(최소 1시간)', () => {
    const now = new Date('2026-10-18T00:00:00Z');
    expect(autosendStopTtlSeconds(new Date('2026-10-18T05:00:00Z'), now)).toBe(6 * 3600);
    expect(autosendStopTtlSeconds(new Date('2026-10-17T00:00:00Z'), now)).toBe(3600);
  });
});

describe('예고 문장', () => {
  const base = { sendAtLabel: '10월 20일 14:00', recipientCount: 120, costEstimate: 3000, channelLabel: 'LMS', unitCost: 25 };
  it('링크 있음 = 주소 · 두 버튼 이름 · 옛 [정지] 문장 없음', () => {
    const b = buildAutoSendPrepInfoBody({ ...base, stopUrl: 'https://hanjul.ai/s/abc' });
    expect(b).toContain('https://hanjul.ai/s/abc');
    expect(b).toContain('[이번 회차 건너뛰기]');
    expect(b).not.toContain('[정지]를 눌러주세요');
    expect(b).not.toMatch(/[—–]/);
  });
  it('링크 없음 = 옛 문장 그대로', () => {
    expect(buildAutoSendPrepInfoBody(base)).toContain('자동마케팅 [정지]를 눌러주세요');
  });
});

describe('라우트 배선', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../routes/autosend-stop-public.ts'), 'utf8');
  it('건너뛰기 = canSkip 뒤 adminStopProposal · 일시정지 = canPause 뒤 updateOperator(paused) · 둘 다 전원 통보 · 감사', () => {
    const skip = src.slice(src.indexOf("router.post('/skip'"), src.indexOf("router.post('/pause'"));
    const pause = src.slice(src.indexOf("router.post('/pause'"));
    expect(skip.indexOf('view.canSkip')).toBeLessThan(skip.indexOf('adminStopProposal('));
    expect(pause.indexOf('view.canPause')).toBeLessThan(pause.indexOf("updateOperator(p.companyId, p.operatorId, { status: 'paused' })"));
    for (const seg of [skip, pause]) {
      expect(seg).toContain('notifyAll(');
      expect(seg).toContain('recordAuditLog(');
    }
    expect(src).toContain('AUTOSEND_STOP_TOKEN_HEADER');
  });
});
