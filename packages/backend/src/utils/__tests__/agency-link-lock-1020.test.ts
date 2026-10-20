/**
 * ★ 2026-10-20 서수란 접수 cmvgfv8r51 「(이메일대행) 승인 후 취소 · 전송시간 15분전 취소」
 *
 * 증상: 보낼 시각 16:20 건을 16:10 에 링크 화면에서 취소 → 서버는 15분 잠금으로 거절(409 · 실측 = 16:20 그대로 발송),
 *   화면은 사유를 맨 위 띠(안 보이는 곳)에 그리고 아래에는 「승인되었습니다 · 발송 2시간 전에 자동으로 예약을 잡고」 카드.
 * 구조: 링크 화면은 열 때 받은 actions 를 계속 썼다(15분 잠금 = 시각에 달린 권한) · 결과 카드는 상태와 상관없이 같은 문장.
 * 처방 계약:
 *   ① lockLinkActions = 서버 actions 에 「지금 시각」 잠금을 덧씌운다 · 더 막기만 한다(서버가 막은 것은 그 사유 그대로)
 *   ② linkApprovedCard = 승인된 건의 카드를 상태대로(막 승인 · 예약됨 · 못 바꾸는 이유)
 *   ③ 배선 = 링크 화면이 시계(useClockTick)로 ①을 다시 판정하고, 조작 결과 안내를 버튼 자리에 그린다(같은 모양 링크 화면 2곳 포함)
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  lockLinkActions, linkApprovedCard, sendChangeLockStartsAt, type AgencyLinkActions,
} from '../../../../frontend/src/components/agency/agency-send-api';

const LOCK = '보낼 시각 15분 전부터는 승인 · 취소 · 수정할 수 없어요.';
const NOW = Date.parse('2026-10-20T16:10:00+09:00');
const open = { ok: true, reason: null };
const allOpen: AgencyLinkActions = {
  approve: open, cancel: open, reschedule: open, resume: open, spellFix: open, editText: open, approveBy: null,
};
const FE = path.resolve(__dirname, '../../../../frontend/src');
const read = (rel: string) => fs.readFileSync(path.join(FE, rel), 'utf8');

describe('① lockLinkActions — 화면을 연 뒤 잠금 시각이 와도 버튼이 닫힌다', () => {
  it('보낼 시각 10분 전 = 열린 조작 전부 닫힘 · 사유 = 잠금 문장', () => {
    const out = lockLinkActions(allOpen, '2026-10-20T16:20:00+09:00', NOW)!;
    for (const k of ['approve', 'cancel', 'reschedule', 'resume', 'spellFix', 'editText'] as const) {
      expect(out[k], k).toEqual({ ok: false, reason: LOCK });
    }
  });
  it('보낼 시각 20분 전 = 서버 판정 그대로', () => {
    expect(lockLinkActions(allOpen, '2026-10-20T16:30:00+09:00', NOW)).toEqual(allOpen);
  });
  it('지난 시각 = 잠그지 않는다(서버와 같다 · 만료 건을 새 시각으로 살리는 길)', () => {
    expect(lockLinkActions(allOpen, '2026-10-20T16:05:00+09:00', NOW)).toEqual(allOpen);
  });
  it('서버가 이미 막은 조작은 서버 사유 그대로 · 승인 마감도 그대로', () => {
    const a: AgencyLinkActions = { ...allOpen, cancel: { ok: false, reason: '이미 취소된 건이에요.' }, approveBy: '2026-10-20T16:05:00+09:00' };
    const out = lockLinkActions(a, '2026-10-20T16:20:00+09:00', NOW)!;
    expect(out.cancel).toEqual({ ok: false, reason: '이미 취소된 건이에요.' });
    expect(out.approveBy).toBe('2026-10-20T16:05:00+09:00');
  });
  it('actions 가 없으면 없음 그대로(옛 응답)', () => {
    expect(lockLinkActions(undefined, '2026-10-20T16:20:00+09:00', NOW)).toBeUndefined();
  });
  it('잠금 시작 시각 = 보낼 시각 15분 전(열어 둔 화면이 그 순간 다시 판정할 경계) · 잘못된 값 = null', () => {
    expect(sendChangeLockStartsAt('2026-10-20T16:20:00+09:00')).toBe(Date.parse('2026-10-20T16:05:00+09:00'));
    expect(sendChangeLockStartsAt('')).toBeNull();
    expect(sendChangeLockStartsAt('not-a-date')).toBeNull();
  });
  it('경계 50ms 뒤 = 잠김 · 경계 1초 전 = 열림(타이머가 경계를 넘긴 시각으로 다시 그린다)', () => {
    const at = sendChangeLockStartsAt('2026-10-20T16:20:00+09:00')!;
    expect(lockLinkActions(allOpen, '2026-10-20T16:20:00+09:00', at + 50)!.cancel.ok).toBe(false);
    expect(lockLinkActions(allOpen, '2026-10-20T16:20:00+09:00', at - 1000)!.cancel.ok).toBe(true);
  });
});

describe('② linkApprovedCard — 승인된 건의 카드는 상태대로', () => {
  const when = '2026. 10. 20. 16:20';
  it('막 승인 + 아직 예약 전(approved) = 2시간 전 예약 안내', () => {
    expect(linkApprovedCard({ justApproved: true, status: 'approved', when, cancel: open })).toEqual({
      title: '승인되었습니다', body: '발송 2시간 전에 자동으로 예약을 잡고, 정해진 시각에 나갑니다. 이 창은 닫으셔도 됩니다.',
    });
  });
  it('막 승인 + 승인과 함께 예약됨(queued · 실측 15:19:10 같은 초) = 2시간 문장을 쓰지 않는다', () => {
    expect(linkApprovedCard({ justApproved: true, status: 'queued', when, cancel: open })).toEqual({
      title: '승인되었습니다', body: '예약을 잡았습니다. 2026. 10. 20. 16:20에 나갑니다. 이 창은 닫으셔도 됩니다.',
    });
  });
  it('막 승인 + 발송 전 마지막 검사 중(final_testing) = 예약했다고 쓰지 않는다', () => {
    expect(linkApprovedCard({ justApproved: true, status: 'final_testing', when, cancel: open })).toEqual({
      title: '승인되었습니다', body: '발송 전 마지막 검사를 하고 있어요. 통과하면 2026. 10. 20. 16:20에 나갑니다. 이 창은 닫으셔도 됩니다.',
    });
  });
  it('다시 연 화면 + 취소 가능 = 취소할 수 있다고 쓴다', () => {
    expect(linkApprovedCard({ justApproved: false, status: 'queued', when, cancel: open })).toEqual({
      title: '승인되었습니다', body: '정해진 시각에 나갑니다. 보내지 않으려면 아래에서 취소할 수 있어요.',
    });
  });
  it('다시 연 화면 + 15분 잠금(접수 장면) = 몇 시에 나가는지 + 못 바꾸는 이유', () => {
    expect(linkApprovedCard({ justApproved: false, status: 'queued', when, cancel: { ok: false, reason: LOCK } })).toEqual({
      title: '승인된 발송입니다', body: `2026. 10. 20. 16:20에 나갑니다. ${LOCK}`,
    });
  });
  it('승인된 상태가 아니면 카드 없음', () => {
    expect(linkApprovedCard({ justApproved: false, status: 'awaiting_approval', when, cancel: open })).toBeNull();
  });
});

describe('③ 배선 — 링크 화면', () => {
  const page = read('pages/AgencyApprovePage.tsx');
  it('대행 링크 = 시계(경계 = 잠금 시작 시각)로 잠금을 다시 판정한 actions 를 쓴다', () => {
    expect(page).toContain('useClockTick(undefined, \'request\' in state ? sendChangeLockStartsAt(state.request.requestedAt) : null)');
    const hook = read('hooks/useClockTick.ts');
    expect(hook).toMatch(/setTimeout\(\(\) => setNow\(Date\.now\(\)\), wait \+ 50\)/);
    expect(page).toMatch(/const a = lockLinkActions\(r\.actions, r\.requestedAt, nowMs\);/);
    expect(page).not.toMatch(/const a = r\.actions;/);
  });
  it('대행 링크 = 카드 문장은 linkApprovedCard 한 곳(화면 안 고정 문장 0)', () => {
    expect(page).toContain('linkApprovedCard(');
    expect(page).not.toContain('발송 2시간 전에 자동으로 예약을 잡고');
  });
  it('대행 링크 = 조작 결과 안내는 버튼 칸 안(맨 위 띠 0)', () => {
    const actionsAt = page.indexOf('data-link="actions"');
    const noticeAt = page.indexOf('{state.notice}');
    expect(actionsAt).toBeGreaterThan(0);
    expect(noticeAt).toBeGreaterThan(actionsAt);
    expect(page.match(/\{state\.notice\}/g)?.length).toBe(1);
  });
  for (const rel of ['pages/AutosendStopPage.tsx', 'pages/JourneyPausePage.tsx']) {
    it(`${rel} = 조작 결과 안내는 내용 카드 아래 · 버튼 바로 위`, () => {
      const src = read(rel);
      const cardAt = src.indexOf('<div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">');
      const noticeAt = src.indexOf('{notice && <LinkNotice');
      expect(cardAt).toBeGreaterThan(0);
      expect(noticeAt).toBeGreaterThan(cardAt);
      expect(src.match(/\{notice && <LinkNotice/g)?.length).toBe(1);
    });
  }
});
