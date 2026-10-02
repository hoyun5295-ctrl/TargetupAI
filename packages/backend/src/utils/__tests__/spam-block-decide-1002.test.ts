/**
 * 스팸 검사 — 「통신사 전송 성공 + 앱 보고 없음」을 차단으로 확정하는 때 (★2026-10-02 · B-1002-1)
 *
 * 실측(1002 14:51): 시험 폰의 통신을 끊고 문자를 받게 했더니 보고가 받은 뒤 32.9초에 서버에 닿았다. 그때 서버는 이미
 *   그 통신사를 차단으로 확정하고 검사를 닫은 뒤였다(종전 = 검사 시작 뒤 30초쯤 확정). 화면에는 「막혔어요」가 떴다.
 * 사람들은 화면을 한 번 보고 닫는다 → 처음 뜨는 판정이 맞아야 한다 → 확정을 검사 시작 뒤 45초로 늦춘다.
 *   60초가 아닌 이유: 검사 화면은 시작 뒤 60초에 결과 읽기를 멈추고 수동 검사는 15초마다 확인한다. 화면에 보이는 마지막 확인이 45초다.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

vi.mock('../../config/database', () => ({ default: { query: vi.fn() }, query: vi.fn(async () => ({ rows: [] })), mysqlQuery: vi.fn(async () => []) }));

import { spamBlockedDue, SPAM_BLOCK_DECIDE_AFTER_MS } from '../spam-test-queue';

const T0 = 1_790_000_000_000;
const due = (sinceStartSec: number, sinceSuccessSec: number | null, graceSec: number) =>
  spamBlockedDue({
    nowMs: T0 + sinceStartSec * 1000,
    startedAtMs: T0,
    successSeenAtMs: sinceSuccessSec === null ? undefined : T0 + (sinceStartSec - sinceSuccessSec) * 1000,
    graceMs: graceSec * 1000,
  });

describe('spamBlockedDue — 차단을 확정해도 되는가', () => {
  it('검사를 시작한 뒤 45초가 지나기 전에는 확정하지 않는다', () => {
    expect(SPAM_BLOCK_DECIDE_AFTER_MS).toBe(45_000);
    // 종전에 확정하던 때: 수동 검사 30초 확인(성공을 15초에 봄 · 유예 10초) → 이제는 기다린다
    expect(due(30, 15, 10)).toBe(false);
    expect(due(44.9, 29.9, 10)).toBe(false);
    // 45초 확인에서 확정한다
    expect(due(45, 30, 10)).toBe(true);
    expect(due(60, 45, 10)).toBe(true);
  });
  it('45초가 지났어도 통신사 성공을 본 뒤 유예가 지나야 한다(성공을 방금 봤으면 다음 확인까지 기다린다)', () => {
    expect(due(45, 0, 10)).toBe(false);
    expect(due(45, 9.9, 10)).toBe(false);
    expect(due(45, 10, 10)).toBe(true);
    // 큐 워커의 유예(수동 20초 · 자동 25초)
    expect(due(45, 19, 20)).toBe(false);
    expect(due(45, 20, 20)).toBe(true);
    expect(due(50, 24, 25)).toBe(false);
    expect(due(50, 25, 25)).toBe(true);
  });
  it('통신사 성공을 아직 못 봤으면 차단이 아니다(결과 없음은 시간초과가 정한다)', () => {
    expect(due(45, null, 10)).toBe(false);
    expect(due(90, null, 10)).toBe(false);
  });
});

describe('소스 계약 — 두 경로가 같은 판정 함수를 쓴다', () => {
  const route = readFileSync(join(__dirname, '../../routes/spam-filter.ts'), 'utf8');
  const queue = readFileSync(join(__dirname, '../spam-test-queue.ts'), 'utf8');
  const manual = route.slice(route.indexOf('const qtmsgSuccessTime = new Map'), route.indexOf("router.post('/report'"));
  const worker = queue.slice(queue.indexOf('async function executeSpamTest('), queue.indexOf('// 안전장치 타임아웃'));

  it('수동 검사 라우트: 확정 조건 = spamBlockedDue(시작 = 검사 행의 created_at · 유예 10초)', () => {
    expect(manual).toContain('spamBlockedDue({');
    expect(manual).toContain('startedAtMs: new Date(activeCheck2.rows[0].created_at).getTime(),');
    expect(manual).toContain('successSeenAtMs: qtmsgSuccessTime.get(rowKey),');
    expect(manual).toContain('graceMs: BLOCKED_GRACE_MS,');
    expect(manual).toContain('const BLOCKED_GRACE_MS = 10000;');
    // 유예만으로 확정하던 종전 조건이 남아 있지 않다
    expect(manual).not.toMatch(/Date\.now\(\) - qtmsgSuccessTime\.get\(rowKey\)! >= BLOCKED_GRACE_MS/);
  });
  it('큐 워커: 확정 조건 = spamBlockedDue(시작 = 실행 시작 시각 · 유예는 수동 20초 · 자동 25초 그대로)', () => {
    expect(worker).toContain('spamBlockedDue({ nowMs: Date.now(), startedAtMs: activatedAt, successSeenAtMs: qtmsgSuccessTime.get(rowKey), graceMs })');
    expect(worker).not.toMatch(/Date\.now\(\) - qtmsgSuccessTime\.get\(rowKey\)! >= graceMs/);
    expect(queue).toContain('const MANUAL_GRACE_MS = 20000;');
    expect(queue).toContain('const AUTO_GRACE_MS = 25000;');
  });
  it('검사 제한 시간에 남은 행을 닫는 규칙은 그대로다(통신사 성공을 봤으면 차단 · 아니면 시간초과)', () => {
    expect(manual).toMatch(/if \(qtmsgSuccessTime\.has\(rowKey\)\) \{\s+finalResult = SPAM_RESULT\.BLOCKED;/);
    expect(worker).toContain('const finalResult = qtmsgSuccessTime.has(rowKey) ? SPAM_RESULT.BLOCKED : SPAM_RESULT.TIMEOUT;');
  });
  it('확정을 미루는 시간은 검사 화면이 결과 읽기를 멈추는 60초보다 15초(수동 검사의 확인 간격) 이상 앞선다', () => {
    // 화면(SpamFilterTestModal)은 시작 뒤 60초에 읽기를 멈춘다. 수동 검사는 15초마다 확인한다 → 화면에 보이는 마지막 확인 = 45초
    expect(SPAM_BLOCK_DECIDE_AFTER_MS).toBeLessThanOrEqual(60_000 - 15_000);
    expect(route).toMatch(/\}, 15000\);/);
    const modal = readFileSync(join(__dirname, '../../../../frontend/src/components/SpamFilterTestModal.tsx'), 'utf8');
    expect(modal).toContain('Math.ceil((60000 - elapsed) / 1000)');
  });
  it('★ 검사 창을 다시 열어 복원할 때 남은 시간은 서버가 준 남은 초로 잰다(이 PC 의 시계와 서버의 시작 시각을 견주지 않는다)', () => {
    // Codex 1R: PC 시계가 서버보다 20초 빠르면 화면이 서버 40초에 결과 읽기를 멈춰, 45초에 확정되는 차단을 못 본다
    const modal = readFileSync(join(__dirname, '../../../../frontend/src/components/SpamFilterTestModal.tsx'), 'utf8');
    const restore = modal.slice(modal.indexOf('const checkActiveTest = async'), modal.indexOf('// 상태 초기화 (재테스트용)'));
    expect(restore).toContain("const remainingSec = typeof data.remainingSeconds === 'number' ? Math.max(0, Math.min(60, data.remainingSeconds)) : null;");
    expect(restore).toContain('? Date.now() - (60000 - remainingSec * 1000)');
    // 타이머 기준에 서버의 시작 시각을 그대로 넣던 종전 줄이 없다
    expect(restore).not.toContain('serverCreatedAtRef.current = new Date(data.createdAt).getTime();');
    // 도착 시간 표시용 기준은 서버 시각 그대로다
    expect(restore).toContain('serverTestCreatedRef.current = new Date(data.createdAt).getTime();');
    // 서버는 진행 중인 검사에 남은 초를 싣는다
    const route = readFileSync(join(__dirname, '../../routes/spam-filter.ts'), 'utf8');
    expect(route).toContain('remainingSeconds: Math.ceil(remainingMs / 1000),');
  });
});
