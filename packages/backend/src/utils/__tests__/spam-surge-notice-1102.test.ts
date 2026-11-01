/**
 * 엔진 재설계 E3-5 — 실발송 결과의 스팸 차단 코드 감시(★ 2026-11-02 · 설계서 docs/2026-11-01-journey-automarketing-engine-design.md)
 *
 * 못 박는 것:
 *   - 스팸 차단 코드 = 결과 코드 표에서 이름에 「스팸」이 든 코드(기계로 뽑음 · 손 목록 0)
 *   - 몰림 = 20건 이상 그리고 결과(성공 + 실패)의 30% 이상(경계값)
 *   - 안내 = 결과 안내와 같은 한 통(머리 · 경고 줄) · 알림을 끈 칸도 몰림이면 첫 단계에 한 번 · 자동 보류 0
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { STATUS_CODE_MAP, SPAM_BLOCK_STATUS_CODES, isSpamBlockSurge, SPAM_SURGE_MIN, SPAM_SURGE_RATIO } from '../sms-result-map';
import { buildResultNoticeBody, SPAM_SURGE_NOTICE_TITLE } from '../journey-result-notice';

const read = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');

describe('E3-5 스팸 차단 코드 · 몰림 판정', () => {
  it('코드 목록 = 표에서 이름에 「스팸」이 든 코드 전부(손 목록 0)', () => {
    const want = Object.entries(STATUS_CODE_MAP).filter(([, v]) => v.label.includes('스팸')).map(([k]) => Number(k)).sort((a, b) => a - b);
    expect([...SPAM_BLOCK_STATUS_CODES].sort((a, b) => a - b)).toEqual(want);
    expect(SPAM_BLOCK_STATUS_CODES).toEqual(expect.arrayContaining([3004, 16, 52, 53, 54, 9003, 9010]));
  });
  it('경계값 — 20건 · 30% 둘 다 넘어야(같으면 몰림)', () => {
    expect(SPAM_SURGE_MIN).toBe(20);
    expect(SPAM_SURGE_RATIO).toBe(0.3);
    expect(isSpamBlockSurge(20, 66)).toBe(true);   // 30.3%
    expect(isSpamBlockSurge(20, 67)).toBe(false);  // 29.9%
    expect(isSpamBlockSurge(19, 20)).toBe(false);  // 수 미달
    expect(isSpamBlockSurge(30, 100)).toBe(true);  // 정확히 30%
    expect(isSpamBlockSurge(25, 0)).toBe(false);
  });
});

describe('E3-5 안내 본문 · 배선', () => {
  const base = { journeyName: '생일 여정', stepOrder: 1, messageSteps: 2, isLast: false, sendDay: '2026-11-02', sentCount: 100, countsKnown: true, success: 60, fail: 40, pending: 0, dayTotal: false };
  it('몰림이면 머리 = 스팸 차단 안내 · 수 · 비율 · 여정은 그대로 나감 · 아니면 옛 결과 안내 그대로', () => {
    const b = buildResultNoticeBody({ ...base, spamBlocked: 30 });
    expect(b.startsWith(SPAM_SURGE_NOTICE_TITLE)).toBe(true);
    expect(b).toContain('스팸으로 막았어요');
    expect(b).toContain('30건(30%)');
    expect(b).toContain('여정은 그대로 나가요');
    const plain = buildResultNoticeBody(base);
    expect(plain.startsWith('[여정 발송 결과]')).toBe(true);
    expect(plain).not.toContain('스팸');
  });
  it('결과 안내 자리 = 스팸 수 집계(결과 표만) · 알림 끈 칸도 센다 · 몰림만 첫 단계 한 번 · 자동 보류 · 여정 멈춤 0', () => {
    const n = read('journey-result-notice.ts');
    expect(n).toContain('spamBlocked = Number((await smsCampaignSpamCountsSafe(tables, [row.campaign_id])).get(String(row.campaign_id)) || 0);');
    expect(n).toContain('const surge = countsKnown && isSpamBlockSurge(spamBlocked, success + fail);');
    expect(n).toContain('const surgeOnly = !notifyOn && surge && !row.noticed && !!owner;');
    expect(n).not.toMatch(/pauseJourney|status = 'paused'/);
    const q = read('sms-queue.ts');
    const f = q.slice(q.indexOf('export async function smsCampaignSpamCountsSafe('), q.indexOf('export async function smsCampaignCountsSafe('));
    expect(f).toContain('const { resultTables } = classifyResultTables(tables);');
    expect(f).toContain('status_code IN (${SPAM_BLOCK_STATUS_CODES.join(\',\')})');
  });
});
