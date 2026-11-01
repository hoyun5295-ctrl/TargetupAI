// replaces: none
/**
 * 여정 점검 응답 · 칸 저장 뒤 자동 검사 — 실 PostgreSQL 판(★ 2026-11-01 여정 재발 방지 배포 2 C5 · 설계서 docs/2026-11-01-journey-recurrence-prevention-design.md §3 C5)
 *
 * 새 SQL(journey-check 의 칸 목록 · 칸 저장 뒤 칸 읽기)과 켜기 검증 · 정의 검사(옮긴 원문)를 운영 표 사본에서 그대로 돌린다.
 * 바깥(스팸 검사 등록 · 엿보기 · 발송 글 그리기)만 시험이 쥔다.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';

const ctl = vi.hoisted(() => ({ enqueued: [] as any[], peek: null as null | { testId: string; outcome: string } }));
vi.mock('../spam-test-queue', async (orig) => {
  const real: any = await orig();
  return {
    ...real,
    peekSpamCheck: async () => ctl.peek,
    enqueueSpamTest: async (p: any) => { ctl.enqueued.push(p); return { ok: true, testId: randomUUID() }; },
  };
});
vi.mock('../journey-message-render', () => ({
  renderJourneySmsMessage: async (p: any) => ({ message: String(p.template || ''), subject: p.subject || '', msgType: p.channel === 'sms' ? 'SMS' : 'LMS' }),
  pickJourneySampleCustomer: async () => ({}),
}));

import { checkJourney, startJourneyStepSpamChecks } from '../journey-check';

const CO = randomUUID();
const OWNER = randomUUID();
const J = randomUUID();
const S1 = randomUUID();
const S2 = randomUUID();
const JA = randomUUID();
const SA = randomUUID();
const JE = randomUUID();
const SE = randomUUID();

beforeAll(async () => {
  await insertMinimalRow(pool, 'companies', { id: CO });
  await insertMinimalRow(pool, 'users', { id: OWNER, company_id: CO, user_type: 'user', is_active: true, phone: '010-0000-1101', login_id: 't-1101-check' });
  await insertMinimalRow(pool, 'journeys', { id: J, company_id: CO, created_by: OWNER, name: '점검 여정', status: 'draft', start_kind: 'event', trigger_event: 'customer.created', callback_number: '0212345678' });
  await insertMinimalRow(pool, 'journey_steps', { id: S1, journey_id: J, step_order: 1, step_type: 'message', channel: 'lms', subject: '환영해요', message_template: '반가워요.\n첫 구매 [혜택 안내: 직접 수정해주세요]', delay_mode: 'relative', delay_hours: 0 });
  await insertMinimalRow(pool, 'journey_steps', { id: S2, journey_id: J, step_order: 2, step_type: 'message', channel: 'sms', message_template: '다시 찾아 주셔서 고마워요', delay_mode: 'relative', delay_hours: 72 });
  await insertMinimalRow(pool, 'journeys', { id: JA, company_id: CO, created_by: OWNER, name: '보관 여정', status: 'draft', start_kind: 'event', trigger_event: 'customer.created', callback_number: '0212345678', archived_at: new Date() });
  await insertMinimalRow(pool, 'journey_steps', { id: SA, journey_id: JA, step_order: 1, step_type: 'message', channel: 'sms', message_template: '보관된 칸', delay_mode: 'relative', delay_hours: 0 });
  await insertMinimalRow(pool, 'journeys', { id: JE, company_id: CO, created_by: OWNER, name: '끝난 여정', status: 'ended', start_kind: 'event', trigger_event: 'customer.created', callback_number: '0212345678' });
  await insertMinimalRow(pool, 'journey_steps', { id: SE, journey_id: JE, step_order: 1, step_type: 'message', channel: 'sms', message_template: '끝난 칸', delay_mode: 'relative', delay_hours: 0 });
});

describe('C5 점검 응답(실 PG)', () => {
  it('칸마다 같은 판정 — 남은 자리 = 고칠 것(본문) · 오늘 검사 없는 칸 = 검사 전 · 판정 문장', async () => {
    ctl.peek = null;
    const c = await checkJourney(CO, J, OWNER);
    expect(Object.keys(c.steps).sort()).toEqual([S1, S2].sort());
    expect(c.steps[S1].some((i) => i.level === 'fix' && i.fixTarget === 'body')).toBe(true);
    expect(c.steps[S2].map((i) => i.level)).toEqual(['before']);
    expect(c.verdict.canActivate).toBe(false);
    expect(c.verdict.sentence).toMatch(/^아직 못 켜요 · 고칠 것 \d+/);
    expect(ctl.enqueued).toEqual([]);   // 점검 응답 = 검사 등록 0
  });

  it('오늘 같은 글 검사가 확인 중이면 = 확인 중(못 켬)', async () => {
    ctl.peek = { testId: randomUUID(), outcome: 'unconfirmed' };
    const c = await checkJourney(CO, J, OWNER);
    expect(c.steps[S2].map((i) => i.level)).toEqual(['confirming']);
    expect(c.verdict.hold).toBeGreaterThanOrEqual(1);
    ctl.peek = null;
  });

  it('다른 회사 = 칸 0', async () => {
    const c = await checkJourney(randomUUID(), J, OWNER);
    expect(Object.keys(c.steps)).toEqual([]);
  });
});

describe('C5 칸 저장 뒤 자동 검사(실 PG)', () => {
  it('문자 칸 = 같은 날 같은 글 이어 보기로 등록 · 보관 여정 · 사용자 없음 = 0', async () => {
    ctl.enqueued.length = 0;
    await startJourneyStepSpamChecks(CO, J, S2, OWNER);
    expect(ctl.enqueued).toHaveLength(1);
    expect(ctl.enqueued[0]).toMatchObject({ companyId: CO, callbackNumber: '0212345678', messageType: 'SMS', reuseSameDay: true, skipPrepaid: false, source: 'auto_ai' });
    await startJourneyStepSpamChecks(CO, JA, SA, OWNER);
    await startJourneyStepSpamChecks(CO, JE, SE, OWNER);   // 끝난 여정 = 0(Codex 구현 1R #2)
    await startJourneyStepSpamChecks(CO, J, S2, null);
    await startJourneyStepSpamChecks(randomUUID(), J, S2, OWNER);
    expect(ctl.enqueued).toHaveLength(1);
  });
});
