/**
 * ★ 2026-10-04 플래너 보강 B1 기반 — 준비 판정 한 곳(F2) · 후보 창(F1·F9) · 고객 문장 사전(F4) 계약.
 * 설계서 = docs/2026-10-04-planner-material-approval-design.md §6-10 · §9
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { checkChannelReadiness, firstBlockedChannel, type ReadinessDeps } from '../planner-channel-gate';
import { READINESS_REASON, sendRejectReason, PLANNER_REASON } from '../planner-reasons';

const ready: ReadinessDeps = {
  hasDefaultCallback: async () => true,
  opt080: async () => '0801234567',
  dmPlanAllowed: async () => true,
  emailPlanAllowed: async () => true,
  smtpReady: async () => true,
  hasEmailCustomers: async () => true,
  autoBuildEnabled: () => true,
};
const ctx = (phase: 'plan' | 'send') => ({ companyId: 'c1', userId: 'u1', phase });

describe('준비 판정 CT — 재료 창·승인·발송 당일이 같은 함수(F2)', () => {
  it('문자 = 기본 발신번호 + 080', async () => {
    expect((await checkChannelReadiness('sms', ctx('plan'), ready)).ok).toBe(true);
    expect((await checkChannelReadiness('sms', ctx('plan'), { ...ready, hasDefaultCallback: async () => false })).code).toBe('NO_DEFAULT_CALLBACK');
    expect((await checkChannelReadiness('sms', ctx('send'), { ...ready, opt080: async () => '' })).code).toBe('NO_080');
  });

  it('모바일 DM = 요금제 + 엔진 개방(기입·승인) + 문자 준비(DM은 문자 1통에 실려 나간다)', async () => {
    expect((await checkChannelReadiness('dm', ctx('plan'), { ...ready, dmPlanAllowed: async () => false })).code).toBe('DM_PLAN');
    expect((await checkChannelReadiness('dm', ctx('plan'), { ...ready, autoBuildEnabled: () => false })).code).toBe('AUTO_BUILD_OFF');
    expect((await checkChannelReadiness('dm', ctx('plan'), { ...ready, opt080: async () => '' })).code).toBe('NO_080');
    // 발송 당일은 이미 만든 소재를 보낼 수 있는가만 — 요금제·엔진은 묻지 않는다
    expect((await checkChannelReadiness('dm', ctx('send'), { ...ready, dmPlanAllowed: async () => false, autoBuildEnabled: () => false })).ok).toBe(true);
    expect((await checkChannelReadiness('dm', ctx('send'), { ...ready, hasDefaultCallback: async () => false })).code).toBe('NO_DEFAULT_CALLBACK');
  });

  it('메일 = 요금제 + 엔진 + 이메일 고객 + 회사 메일 연결 / 발송 당일은 회사 메일 연결만', async () => {
    expect((await checkChannelReadiness('email', ctx('plan'), { ...ready, emailPlanAllowed: async () => false })).code).toBe('EMAIL_PLAN');
    expect((await checkChannelReadiness('email', ctx('plan'), { ...ready, hasEmailCustomers: async () => false })).code).toBe('NO_EMAIL_CUSTOMERS');
    expect((await checkChannelReadiness('email', ctx('plan'), { ...ready, smtpReady: async () => false })).code).toBe('SMTP_NOT_CONFIGURED');
    expect((await checkChannelReadiness('email', ctx('send'), { ...ready, emailPlanAllowed: async () => false, hasEmailCustomers: async () => false })).ok).toBe(true);
    expect((await checkChannelReadiness('email', ctx('send'), { ...ready, smtpReady: async () => false })).code).toBe('SMTP_NOT_CONFIGURED');
  });

  it('인앱·알림톡은 1차 밖 · 조회 실패는 잠금(fail-closed)', async () => {
    expect((await checkChannelReadiness('inapp', ctx('plan'), ready)).code).toBe('NOT_IN_PHASE1');
    expect((await checkChannelReadiness('alimtalk', ctx('send'), ready)).code).toBe('NOT_IN_PHASE1');
    const r = await checkChannelReadiness('sms', ctx('plan'), { ...ready, hasDefaultCallback: async () => { throw new Error('boom'); } });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('CHECK_FAILED');
    expect(r.reason).not.toContain('boom');
  });

  it('여러 채널 중 첫 잠금을 돌려준다 · 잠금이 없으면 null', async () => {
    expect(await firstBlockedChannel(['sms', 'dm', 'email'], ctx('plan'), ready)).toBeNull();
    const b = await firstBlockedChannel(['sms', 'email'], ctx('plan'), { ...ready, smtpReady: async () => false });
    expect(b?.channel).toBe('email');
    expect(b?.readiness.settingsPath).toBe('/email-campaigns');
  });
});

describe('고객 문장 사전(F4) — 원문 노출 0', () => {
  it('사전 문장에 줄표·영문 내부어·모델명이 없다', () => {
    const all = [
      ...Object.values(READINESS_REASON).map((r) => r.text),
      ...Object.values(PLANNER_REASON),
      sendRejectReason('INSUFFICIENT_BALANCE'),
      sendRejectReason('UNKNOWN_CODE'),
    ];
    for (const t of all) {
      expect(t).not.toMatch(/—|fromEmail|SMTP|진입 의무|column|undefined|Claude|GPT/);
    }
  });
  it('모르는 거부 코드는 일반 문장으로 접는다(예외 문구가 새지 않는다)', () => {
    expect(sendRejectReason('SOMETHING_NEW')).toContain('발송 접수가 거부되었습니다');
    expect(sendRejectReason(null)).toContain('발송 접수가 거부되었습니다');
  });
});

describe('후보 창 CT(F1·F9) — 시작 달이 아니라 날짜 축', () => {
  const src = readFileSync(path.join(__dirname, '..', 'planner-touchpoint.ts'), 'utf8');
  const fn = src.slice(src.indexOf('export async function loadLiveTouchpoints('), src.indexOf('export async function loadEventTouchpoints('));
  it('ends_on 하한으로 고르고 plan_month 하한을 쓰지 않는다', () => {
    expect(fn).toContain('e.ends_on >= $3::date');
    expect(fn).not.toContain('plan_month >=');
  });
  it('상한(시작 30일 전까지)과 승인 각인 거름을 SQL에서 한다(LIMIT 뒤 Node 거름 0)', () => {
    expect(fn).toContain('e.starts_on <= ($');
    expect(fn).toContain("(t.exec_meta ? 'approved')");
  });
  it('옛 호출 축(monthFrom)이 남아 있지 않다', () => {
    for (const f of ['planner-executor.ts', 'planner-reconcile.ts', 'planner-alimtalk.ts']) {
      const s = readFileSync(path.join(__dirname, '..', f), 'utf8');
      expect(s).not.toMatch(/loadLiveTouchpoints\(\{[^}]*monthFrom/);
    }
  });
});
