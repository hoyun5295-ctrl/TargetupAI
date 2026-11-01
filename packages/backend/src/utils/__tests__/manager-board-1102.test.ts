/**
 * 엔진 재설계 E4-2 · E5 — 담당자 주간 요약 · 상황판(★ 2026-11-02 · 설계서 docs/2026-11-01-journey-automarketing-engine-design.md)
 *
 * 못 박는 것:
 *   - 상황판 토큰 ↔ 정지 토큰 = 같은 비밀 · 같은 꼴이지만 서로를 못 연다(kind · 필수 칸) · 만료 · 위조 = 거절
 *   - 칸 검사 한 단어 · 판정 문장 · 주간 창(월요일 09~12시 KST · 지난주 월요일) · 본문
 *   - 배선: 담당자 링크(비추적) · 공개 경로 = 읽기 GET 하나 · 화면 = 헤더 토큰 · native dialog 0
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { generateManagerBoardToken, verifyManagerBoardToken, stepCheckOf, boardVerdict } from '../manager-board';
import { generatePauseToken, verifyPauseToken, signLinkToken } from '../journey-pause-handler';
import { digestWindow, buildWeeklyDigestBody } from '../manager-weekly-digest';
import { MANAGER_LINK_PATHS, isManagerLinkUrl } from '../short-url';

const read = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');
const FE = join(__dirname, '..', '..', '..', '..', 'frontend', 'src');

beforeAll(() => { process.env.JOURNEY_PAUSE_TOKEN_SECRET = 'test-secret-1102'; });

describe('E5-1 상황판 토큰 = 정지 토큰과 서로 못 연다', () => {
  it('발급 · 검증 · 정지 토큰으로 상황판 0 · 상황판 토큰으로 정지 0', async () => {
    const board = generateManagerBoardToken('c1', 'u1')!;
    expect(verifyManagerBoardToken(board)).toEqual({ companyId: 'c1', userId: 'u1' });
    expect(await verifyPauseToken(board)).toBeNull();
    const pause = await generatePauseToken({ stepId: 's', executionId: 'e', companyId: 'c1', journeyId: 'j' });
    expect(await verifyPauseToken(pause)).toMatchObject({ step_id: 's', company_id: 'c1' });
    expect(verifyManagerBoardToken(pause)).toBeNull();
  });
  it('만료 · 위조 · 키 없음 = 거절', () => {
    const old = signLinkToken({ kind: 'manager-board', company_id: 'c', user_id: 'u', expires_at: Date.now() - 1 })!;
    expect(verifyManagerBoardToken(old)).toBeNull();
    const t = generateManagerBoardToken('c', 'u')!;
    expect(verifyManagerBoardToken(t.slice(0, -2) + 'xx')).toBeNull();
    const key = process.env.JOURNEY_PAUSE_TOKEN_SECRET;
    delete process.env.JOURNEY_PAUSE_TOKEN_SECRET;
    expect(generateManagerBoardToken('c', 'u')).toBeNull();
    expect(verifyManagerBoardToken(t)).toBeNull();
    process.env.JOURNEY_PAUSE_TOKEN_SECRET = key;
  });
});

describe('E5 순수 판정', () => {
  it('칸 검사 한 단어 = 지금 판 보류 > 검사 기다림 > 확인 못 함 > 통과 · 문자 칸이 아니면 없음', () => {
    expect(stepCheckOf({ channel: 'kakao', confidence: 0, decStatus: 'held', decCurrent: true })).toBe('none');
    expect(stepCheckOf({ channel: 'lms', confidence: 0, decStatus: 'held', decCurrent: true })).toBe('held');
    expect(stepCheckOf({ channel: 'lms', confidence: 0, decStatus: 'held', decCurrent: false })).toBe('waiting');
    expect(stepCheckOf({ channel: 'sms', confidence: 100, decStatus: 'unverified', decCurrent: true })).toBe('unverified');
    expect(stepCheckOf({ channel: 'sms', confidence: 100, decStatus: 'notified', decCurrent: true })).toBe('passed');
    expect(stepCheckOf({ channel: 'sms', confidence: null, decStatus: null, decCurrent: false })).toBe('passed');
  });
  it('판정 문장 = 할 일 0 / 저절로 처리되는 일만 / 손으로 할 일 n', () => {
    expect(boardVerdict([])).toEqual({ tone: 'ok', sentence: '모두 정상이에요. 지금 확인할 일이 없어요.' });
    expect(boardVerdict([{ kind: 'dispatch_pending', title: 't', reason: 'r', action: null }]).tone).toBe('ok');
    const w = boardVerdict([{ kind: 'held_step', title: 't', reason: 'r', action: { label: 'a', href: '/x' } }, { kind: 'dispatch_pending', title: 't', reason: 'r', action: null }]);
    expect(w).toEqual({ tone: 'warn', sentence: '확인할 일이 1건 있어요. 아래에서 하나씩 볼 수 있어요.' });
  });
  it('주간 창 = 월요일 09~12시 KST · 지난주 월요일', () => {
    expect(digestWindow(new Date('2026-11-02T00:30:00Z'))).toEqual({ open: true, weekStart: '2026-10-26' });    // 월 09:30 KST
    expect(digestWindow(new Date('2026-11-01T23:59:00Z')).open).toBe(false);                                   // 월 08:59
    expect(digestWindow(new Date('2026-11-02T03:00:00Z')).open).toBe(false);                                   // 월 12:00
    expect(digestWindow(new Date('2026-11-03T01:00:00Z'))).toEqual({ open: false, weekStart: '2026-10-26' });  // 화
    expect(digestWindow(new Date('2026-11-01T01:00:00Z')).weekStart).toBe('2026-10-19');                       // 일요일 = 그 주 월요일의 지난주
  });
  it('주간 요약 본문 = 기간 · 여정 · 자동마케팅 · 보낸 수 · 성공률 · 할 일 · 상황판 주소', () => {
    const b = buildWeeklyDigestBody({ companyName: '가', weekStart: '2026-10-26', journeys: 3, operators: 1, sent: 12345, successRate: 97.5, todos: 2, boardUrl: 'https://app.hanjul.ai/s/x' });
    expect(b).toContain('[한줄로 주간 요약]');
    expect(b).toContain('10월 26일 ~ 11월 1일');
    expect(b).toContain('켜진 여정 3개 · 자동마케팅 1개');
    expect(b).toContain('보낸 수 12,345건 · 성공률 97.5%');
    expect(b).toContain('확인할 일 2건이 있어요.');
    expect(b).toContain('상황판: https://app.hanjul.ai/s/x');
    expect(b).not.toMatch(/—/);
  });
});

describe('배선(소스 계약)', () => {
  it('담당자 링크 = 비추적 · 공개 경로 = 읽기 GET 하나(바꾸는 일 0) · 앱 = 마운트 + 버킷 + 주간 워커', () => {
    expect([...MANAGER_LINK_PATHS]).toContain('manager-board');
    expect(isManagerLinkUrl('https://hanjul.ai/manager-board#t=x')).toBe(true);
    const r = read('../routes/manager-board-public.ts');
    expect(r.match(/router\.(get|post|put|patch|delete)\(/g)).toEqual(['router.get(']);
    const app = read('../app.ts');
    expect(app).toContain("app.use('/api/manager-board', rateLimit({ ...approveLimiterOpts }));");
    expect(app).toContain("app.use('/api/manager-board', managerBoardPublicRouter);");
    expect(app).toContain('startWeeklyDigestWorker();');
  });
  it('화면 = 헤더 토큰 · 주소 토큰 지움(useApproveToken) · native dialog 0 · 모델명 0 · 라우트 등록', () => {
    const page = readFileSync(join(FE, 'pages', 'ManagerBoardPage.tsx'), 'utf8');
    expect(page).toContain("headers: { 'X-Manager-Board-Token': token }");
    expect(page).toContain('useApproveToken()');
    expect(page).not.toMatch(/\b(alert|confirm|prompt)\(/);
    expect(page).not.toMatch(/Opus|Sonnet|Haiku|GPT|Claude|Anthropic/);
    expect(readFileSync(join(FE, 'App.tsx'), 'utf8')).toContain('<Route path="/manager-board" element={<ManagerBoardPage />} />');
  });
  it('주간 요약 = 시도 잡기 먼저(상한 3) · 그 안에서 상황판을 읽는다 · 받는 사람 = pickOwnerContact', () => {
    const d = read('manager-weekly-digest.ts');
    const f = d.slice(d.indexOf('async function sendDigestTo('), d.indexOf('export function startWeeklyDigestWorker'));
    expect(f.indexOf('claim: async')).toBeLessThan(f.indexOf('await loadManagerBoardFor('));
    expect(f).toContain('manager_weekly_digests.attempts < $4');
    expect(d).toContain('await pickOwnerContact(companyId,');
  });
});
