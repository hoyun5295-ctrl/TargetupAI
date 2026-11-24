// replaces: none
/**
 * 메일 접수 검사 결과 회신(★ 2026-11-24 · 설계서 docs/2026-11-23-spam-block-cause-hint-design.md §8-2 M3 · 배포 2 Codex 1R) — 실 PostgreSQL 판.
 *   보낼 것 = 지금의 test_failed 가 스팸 막힘에서 온 것(마지막 사건 = 사람 판단 · 그 앞 이 버전 막힘 사건) · 발송 단계 실패 · 다른 사유는 보내지 않는다.
 *   한 번 보낸 버전은 다시 안 보낸다 · 다른 회사 원장 행으로 안 보낸다.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'crypto';

const sent = vi.hoisted(() => ({ list: [] as Array<{ to: string; subject: string; text: string }> }));
vi.mock('../agency-mailer', async (orig) => ({
  ...(await orig() as any),
  sendAgencyReplyMail: async (m: any) => { sent.list.push({ to: m.to, subject: m.subject, text: m.text }); return { outcome: 'sent', detail: '' }; },
}));
vi.mock('../system-alert', async (orig) => ({ ...(await orig() as any), sendSystemAlert: async () => 1 }));

import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { sendPendingSpamResultMails } from '../agency-send-mail-worker';

const MB = `mb-1124-${randomUUID().slice(0, 6)}`;
const CO = randomUUID();
const OTHER = randomUUID();

async function request(o: { events: Array<{ kind: string; payload?: any; minAgo: number }>; company?: string }): Promise<string> {
  const id = randomUUID();
  const company = o.company ?? CO;
  await insertMinimalRow(pool, 'agency_send_requests', {
    id, company_id: company, status: 'test_failed', source: 'email', content_version: 1,
    original_content: '(광고) 하늘몰\n>https://a.example/x\n무료 수신거부 080-000-0000', current_content: '(광고) 하늘몰\n>https://a.example/x\n무료 수신거부 080-000-0000',
    file_name: '겨울 행사.xlsx', message_type: 'SMS', callback_number: '0221231125', manager_phone: '01000000000', phone_column: '전화번호', requested_at: new Date(Date.now() + 86_400_000),
  });
  for (const e of o.events) {
    await pool.query(`INSERT INTO agency_send_events (request_id, kind, payload, created_at) VALUES ($1, $2, $3::jsonb, NOW() - ($4::int * INTERVAL '1 minute'))`,
      [id, e.kind, JSON.stringify(e.payload ?? {}), e.minAgo]);
  }
  await pool.query(`UPDATE agency_send_requests SET updated_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [id]);
  await insertMinimalRow(pool, 'agency_send_email_intake', {
    mailbox: MB, uidl: `u-${id.slice(0, 8)}`, message_hash: `h-${id}`, from_email: `${id.slice(0, 6)}@example.test`,
    company_id: CO, status: 'accepted', request_ids: [id], message_id: `<${id}@example.test>`,
  });
  return id;
}
const blocked = { kind: 'spam_blocked', payload: { round: 1, carriers: [{ carrier: 'KT', messageType: 'SMS', result: 'blocked' }, { carrier: 'SKT', messageType: 'SMS', result: 'pass' }] } };

beforeAll(async () => {
  await insertMinimalRow(pool, 'companies', { id: CO });
  await insertMinimalRow(pool, 'companies', { id: OTHER });
});
beforeEach(() => { sent.list.length = 0; });

describe('검사 결과 회신 대상', () => {
  it('스팸 막힘 사람 판단(마지막 사건) = 한 통 · 같은 버전 두 번째 틱 = 0', async () => {
    const id = await request({ events: [{ ...blocked, minAgo: 3 }, { kind: 'test_failed', payload: { rounds: 3 }, minAgo: 1 }] });
    await sendPendingSpamResultMails(MB);
    const mine = sent.list.filter((m) => m.to.startsWith(id.slice(0, 6)));
    expect(mine.length).toBe(1);
    expect(mine[0].subject).toBe('[한줄로] 문안이 KT 스팸 검사에 걸렸습니다');
    expect(mine[0].text).toContain('KT 막힘   SKT 도착');
    expect(mine[0].text).not.toMatch(/—|시험 폰|테스트폰|장비 문제/);
    sent.list.length = 0;
    await sendPendingSpamResultMails(MB);
    expect(sent.list.filter((m) => m.to.startsWith(id.slice(0, 6))).length).toBe(0);
  });

  it('발송 단계 실패(통과 뒤 등록 차단정보 · 마지막 사건 = dispatch_*) = 0 · 장애 셈 · 글자 사유 = 0', async () => {
    const a = await request({ events: [{ ...blocked, minAgo: 30 }, { kind: 'refined', minAgo: 29 }, { kind: 'awaiting_approval', minAgo: 28 }, { kind: 'dispatch_spam_blocked', minAgo: 1 }] });
    const b = await request({ events: [{ ...blocked, minAgo: 3 }, { kind: 'test_failed', payload: { reason: 'spam_check_error' }, minAgo: 1 }] });
    const c = await request({ events: [{ ...blocked, minAgo: 3 }, { kind: 'test_failed', payload: { reason: 'unsupported_chars' }, minAgo: 1 }] });
    await sendPendingSpamResultMails(MB);
    for (const id of [a, b, c]) expect(sent.list.filter((m) => m.to.startsWith(id.slice(0, 6))).length).toBe(0);
  });

  it('막힘 사건이 문안 수정 앞(옛 버전)뿐 = 0', async () => {
    const id = await request({ events: [{ ...blocked, minAgo: 10 }, { kind: 'content_edited', minAgo: 5 }, { kind: 'test_failed', payload: { reason: 'sms_bytes' }, minAgo: 1 }] });
    await sendPendingSpamResultMails(MB);
    expect(sent.list.filter((m) => m.to.startsWith(id.slice(0, 6))).length).toBe(0);
  });

  it('★ 배포 2 Codex 2R — 4a 로 멈춘 건 = 4a 확정 사건의 통신사 · 문장(대기 사이 KT 가 통과로 바뀌고 LG U+ 만 4a)', async () => {
    const twoBlocked = { kind: 'spam_blocked', payload: { round: 1, carriers: [{ carrier: 'KT', messageType: 'SMS', result: 'blocked' }, { carrier: 'LGU', messageType: 'SMS', result: 'blocked' }, { carrier: 'SKT', messageType: 'SMS', result: 'pass' }] } };
    const id = await request({ events: [
      { ...twoBlocked, minAgo: 40 },
      { kind: 'spam_hint', payload: { version: 1, parentTestId: randomUUID(), sentTo: ['KT', 'LGU'] }, minAgo: 39 },
      { kind: 'spam_hint', payload: { version: 1, parentTestId: randomUUID(), branch: '4a', carriers: ['LGU'], arrived: ['KT', 'SKT'], sentence: '글 속 주소를 빼니 LG U+에 도착했습니다. 주소를 바꿔 주세요.' }, minAgo: 2 },
      { kind: 'test_failed', payload: { rounds: 1, reason: 'spam_address' }, minAgo: 1 },
    ] });
    await sendPendingSpamResultMails(MB);
    const mine = sent.list.filter((m) => m.to.startsWith(id.slice(0, 6)));
    expect(mine.length).toBe(1);
    expect(mine[0].subject).toBe('[한줄로] 문안이 LG U+ 스팸 검사에 걸렸습니다');
    expect(mine[0].text).toContain('LG U+ 막힘   KT 도착   SKT 도착');
    expect(mine[0].text).toContain('글 속 주소를 빼니 LG U+에 도착했습니다. 주소를 바꿔 주세요.');
  });

  it('★ 배포 2 Codex 3R — 4a 도착 = 확정 사건의 arrived 만(T 에서 시간 초과였던 SKT 는 도착 아님)', async () => {
    const withTimeout = { kind: 'spam_blocked', payload: { round: 1, carriers: [{ carrier: 'KT', messageType: 'SMS', result: 'blocked' }, { carrier: 'LGU', messageType: 'SMS', result: 'pass' }, { carrier: 'SKT', messageType: 'SMS', result: null }] } };
    const id = await request({ events: [
      { ...withTimeout, minAgo: 40 },
      { kind: 'spam_hint', payload: { version: 1, parentTestId: randomUUID(), branch: '4a', carriers: ['KT'], arrived: ['LGU'], sentence: '글 속 주소를 빼니 KT에 도착했습니다. 주소를 바꿔 주세요.' }, minAgo: 2 },
      { kind: 'test_failed', payload: { rounds: 1, reason: 'spam_address' }, minAgo: 1 },
    ] });
    await sendPendingSpamResultMails(MB);
    const mine = sent.list.filter((m) => m.to.startsWith(id.slice(0, 6)));
    expect(mine.length).toBe(1);
    expect(mine[0].text).toContain('KT 막힘   LG U+ 도착');
    expect(mine[0].text).not.toContain('SKT 도착');
  });

  it('★ 배포 2 Codex 4R — 4a = 처음 막힘 기록(spam_blocked)이 빠져도 확정 사건으로 한 통 · 다른 버전의 4a 사건만 있으면 0', async () => {
    const hint4a = { kind: 'spam_hint', payload: { version: 1, parentTestId: randomUUID(), branch: '4a', carriers: ['KT'], arrived: ['SKT', 'LGU'], sentence: '글 속 주소를 빼니 KT에 도착했습니다. 주소를 바꿔 주세요.' } };
    const id = await request({ events: [
      { ...hint4a, minAgo: 2 },
      { kind: 'test_failed', payload: { rounds: 1, reason: 'spam_address' }, minAgo: 1 },
    ] });
    const old = await request({ events: [
      { ...hint4a, payload: { ...hint4a.payload, version: 0 }, minAgo: 2 },
      { kind: 'test_failed', payload: { rounds: 1, reason: 'spam_address' }, minAgo: 1 },
    ] });
    await sendPendingSpamResultMails(MB);
    const mine = sent.list.filter((m) => m.to.startsWith(id.slice(0, 6)));
    expect(mine.length).toBe(1);
    expect(mine[0].text).toContain('KT 막힘   SKT 도착   LG U+ 도착');
    expect(sent.list.filter((m) => m.to.startsWith(old.slice(0, 6))).length).toBe(0);
  });

  it('다른 회사 접수 원장 행으로 안 보낸다', async () => {
    const id = await request({ company: OTHER, events: [{ ...blocked, minAgo: 3 }, { kind: 'test_failed', payload: { rounds: 3 }, minAgo: 1 }] });
    await sendPendingSpamResultMails(MB);
    expect(sent.list.filter((m) => m.to.startsWith(id.slice(0, 6))).length).toBe(0);
  });
});
