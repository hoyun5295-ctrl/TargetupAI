/**
 * ★2026-10-18 대행발송 모바일 제어 축 1~4(설계서 docs/2026-10-16-agency-send-mobile-control-design.md §2)
 *
 * 고정하는 것
 *   ① 축 4 승인 대기 24시간 — 마감 = min(요청 + 24h, 보낼 시각 - 리드타임) · 승인 판정 · 만료 판정이 같은 함수 · 컬럼 전(값 없음) = 규칙 쉼
 *   ② 축 1 전이표 정정 3
 *   ③ 축 2 조작 정책 한 벌(link · user · staff)
 *   ④ 축 3 맞춤법 적용(id · 잠김 · 겹침 · 원문 불일치 · 역순 치환)
 *   ⑤ 통보 문장(줄표 0 · 누른 번호 끝자리) · 링크 배선(가드 = agencyActions('link') · 효과 = 로그인과 같은 CT)
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  APPROVAL_WAIT_HOURS, approvalDeadline, canTransition, checkApproval, isApprovalExpired, isApprovalTimedOut,
} from '../agency-send-state';
import { agencyActions } from '../agency-send-actions';
import { applyAgencySpellFixes } from '../agency-send-change';
import { buildApprovalTimeoutNotify, buildLinkActionNotify } from '../agency-send-notify';

const H = 3_600_000;
const now = new Date('2026-10-18T03:00:00Z');
const at = (h: number) => new Date(now.getTime() + h * H);

describe('① 승인 대기 24시간', () => {
  it('요청 뒤 24시간 = 닫힘(경계 포함) · 값 없음 = 규칙 쉼', () => {
    expect(isApprovalTimedOut('awaiting_approval', now, at(-23.99))).toBe(false);
    expect(isApprovalTimedOut('awaiting_approval', now, at(-24))).toBe(true);
    expect(isApprovalTimedOut('reapproval', now, at(-30))).toBe(true);
    expect(isApprovalTimedOut('approved', now, at(-30))).toBe(false);
    expect(isApprovalTimedOut('awaiting_approval', now, null)).toBe(false);
    expect(APPROVAL_WAIT_HOURS).toBe(24);
  });
  it('마감 = 더 이른 쪽(요청 + 24h vs 보낼 시각 - 2시간)', () => {
    expect(approvalDeadline('awaiting_approval', at(72), null, at(-1))?.toISOString()).toBe(at(23).toISOString());
    expect(approvalDeadline('awaiting_approval', at(10), null, at(-1))?.toISOString()).toBe(at(8).toISOString());
    expect(approvalDeadline('awaiting_approval', at(10), null, null)?.toISOString()).toBe(at(8).toISOString());
    expect(approvalDeadline('approved', at(10), null, at(-1))).toBeNull();
  });
  it('승인 판정 · 만료 판정이 같은 규칙', () => {
    const t = { status: 'awaiting_approval' as const, revision: 3, requestedAt: at(72), finalTestedAt: null, approvalRequestedAt: at(-25) };
    expect(checkApproval(t, 3, now)).toMatchObject({ ok: false, code: 'APPROVAL_TIMEOUT' });
    expect(isApprovalExpired('awaiting_approval', at(72), now, null, at(-25))).toBe(true);
    expect(checkApproval({ ...t, approvalRequestedAt: at(-2) }, 3, now)).toEqual({ ok: true });
    expect(isApprovalExpired('awaiting_approval', at(72), now, null, at(-2))).toBe(false);
    // 컬럼 전(값 없음) = 지금 동작 그대로
    expect(isApprovalExpired('awaiting_approval', at(72), now, null)).toBe(false);
  });
});

describe('② 전이표 정정 3', () => {
  it('만료 → 승인 대기 · 재승인 대기 → 승인 대기 · 승인 대기 자기 자신', () => {
    expect(canTransition('expired', 'awaiting_approval')).toBe(true);
    expect(canTransition('reapproval', 'awaiting_approval')).toBe(true);
    expect(canTransition('awaiting_approval', 'awaiting_approval')).toBe(true);
    expect(canTransition('sent', 'awaiting_approval')).toBe(false);
  });
});

describe('③ 조작 정책 한 벌', () => {
  const base = { status: 'awaiting_approval', revision: 5, requested_at: at(30).toISOString(), final_test_at: null, approval_requested_at: at(-1).toISOString(), campaign_id: null, content_version: 2, spell_check: null };
  it('링크 · 승인 대기 = 승인 · 취소 · 시각 변경 · 자유 문안 수정은 로그인만', () => {
    const a = agencyActions('link', base, now);
    expect([a.approve.ok, a.cancel.ok, a.reschedule.ok, a.resume.ok, a.editText.ok]).toEqual([true, true, true, false, false]);
    expect(a.approveBy).toBe(at(23).toISOString());
    expect(agencyActions('user', base, now).editText.ok).toBe(true);
  });
  it('staff = 취소만', () => {
    const a = agencyActions('staff', base, now);
    expect([a.approve.ok, a.cancel.ok, a.reschedule.ok, a.resume.ok, a.spellFix.ok]).toEqual([false, true, false, false, false]);
  });
  it('만료 · 보낼 시각이 남음 = 같은 시각으로 다시 진행 · 너무 가까우면 숨김', () => {
    expect(agencyActions('link', { ...base, status: 'expired' }, now).resume.ok).toBe(true);
    expect(agencyActions('link', { ...base, status: 'expired', requested_at: at(1).toISOString() }, now).resume.ok).toBe(false);
  });
  it('승인됨 = 취소만(시각 · 고치기 없음) · 예약이 시작된 건 = 시각 변경 없음', () => {
    const a = agencyActions('link', { ...base, status: 'queued', campaign_id: 'c1' }, now);
    expect([a.cancel.ok, a.reschedule.ok, a.spellFix.ok]).toEqual([true, false, false]);
    expect(agencyActions('link', { ...base, campaign_id: 'c1' }, now).reschedule.ok).toBe(false);
  });
  it('맞춤법 고치기 = 고칠 수 있는 제안이 있고 시간이 남을 때만', () => {
    const spell = { version: 2, checkedAt: '', failed: false, issues: [{ id: 'i1', start: 0, end: 2, before: '안되', after: '안 돼', kind: 'spacing', reason: '' }] };
    expect(agencyActions('link', { ...base, spell_check: spell }, now).spellFix.ok).toBe(true);
    expect(agencyActions('link', { ...base, spell_check: { ...spell, version: 1 } }, now).spellFix.ok).toBe(false);
    expect(agencyActions('link', { ...base, spell_check: spell, requested_at: at(0.5).toISOString() }, now).spellFix.ok).toBe(false);
  });
});

describe('④ 맞춤법 적용(저장된 제안 · id)', () => {
  const text = '오늘 할인 됩니다 안되요';
  const issues: any[] = [
    { id: 'a', start: 3, end: 9, before: '할인 됩니다', after: '할인됩니다', kind: 'spacing', reason: '' },
    { id: 'b', start: 10, end: 13, before: '안되요', after: '안 돼요', kind: 'typo', reason: '' },
    { id: 'c', start: 3, end: 5, before: '할인', after: '세일', kind: 'typo', reason: '' },
    { id: 'z', start: 0, end: 2, before: '오늘', after: '금일', kind: 'typo', reason: '', blocked: 'sms_bytes' },
  ];
  it('여러 곳 = 역순 치환(앞 위치가 밀리지 않는다)', () => {
    expect(applyAgencySpellFixes(text, issues, ['a', 'b'])).toEqual({ ok: true, content: '오늘 할인됩니다 안 돼요' });
  });
  it('없는 id · 다른 버전(null) · 원문 불일치 = SPELL_STALE · 잠김 · 겹침 · 빈 선택', () => {
    expect(applyAgencySpellFixes(text, issues, ['x'])).toMatchObject({ ok: false, code: 'SPELL_STALE' });
    expect(applyAgencySpellFixes(text, null, ['a'])).toMatchObject({ ok: false, code: 'SPELL_STALE' });
    expect(applyAgencySpellFixes('바뀐 문안입니다', issues, ['a'])).toMatchObject({ ok: false, code: 'SPELL_STALE' });
    expect(applyAgencySpellFixes(text, issues, ['z'])).toMatchObject({ ok: false, code: 'SPELL_BLOCKED' });
    expect(applyAgencySpellFixes(text, issues, ['a', 'c'])).toMatchObject({ ok: false, code: 'SPELL_OVERLAP' });
    expect(applyAgencySpellFixes(text, issues, [])).toMatchObject({ ok: false, code: 'SPELL_EMPTY' });
  });
});

describe('⑤ 통보 문장 · 링크 배선', () => {
  it('문장 = 줄표 0 · 누른 번호 끝자리 · 링크는 받는 번호에만', () => {
    const t1 = buildLinkActionNotify({ label: '가을 세일', action: 'cancel', tail: '5678' });
    const t2 = buildApprovalTimeoutNotify({ label: '가을 세일', whenText: '10월 20일 14:00', approveUrl: 'https://hanjul.ai/a/x' });
    const t3 = buildApprovalTimeoutNotify({ label: '가을 세일', whenText: '10월 20일 14:00' });
    for (const t of [t1, t2, t3]) expect(t).not.toMatch(/[—–]/);
    expect(t1).toContain('끝자리 5678');
    expect(t2).toContain('https://hanjul.ai/a/x');
    expect(t3).toContain('로그인');
  });
  it('링크 POST 셋 = agencyActions(link) 가드 → 로그인과 같은 CT', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../routes/agency-approve.ts'), 'utf8').replace(/\r\n/g, '\n');
    for (const [route, guard, ct] of [
      ["router.post('/cancel'", "agencyActions('link', resolved.row).cancel", 'cancelAgencyRequestTx('],
      ["router.post('/reschedule'", "agencyActions('link', resolved.row).reschedule", 'rescheduleAgencyRequestTx('],
      ["router.post('/spell-fix'", "agencyActions('link', resolved.row).spellFix", 'editAgencyContentTx('],
    ] as const) {
      const s = src.indexOf(route);
      const seg = src.slice(s, src.indexOf('router.', s + route.length));
      expect(seg.indexOf('await resolveToken(req)')).toBeGreaterThan(0);
      expect(seg.indexOf(guard)).toBeGreaterThan(seg.indexOf('await resolveToken(req)'));
      expect(seg.indexOf(ct)).toBeGreaterThan(seg.indexOf(guard));
      expect(seg).toContain('afterLinkAction(');
    }
    const pc = fs.readFileSync(path.join(__dirname, '../../routes/agency-send.ts'), 'utf8');
    expect(pc).toMatch(/await editAgencyContentTx\(/);
    expect(pc).toMatch(/await rescheduleAgencyRequestTx\(/);
  });
});
