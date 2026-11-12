// replaces: none
/**
 * C130 ② 메일 반려 회신 본문 저장 — 실 PostgreSQL 판(★ 2026-11-13 · 설계서 docs/2026-11-13-c130-agency-optout-notice-reply-body-design.md §5 T2-3)
 *
 * 운영 문장을 글자 그대로 돌린다(표 = 운영 schema-only 덤프 사본 · 대기 DDL C130-DDL-1 은 시험 안에서 얹는다).
 *   1. 칸 없는 사본 = 종전 문장(상태 · 시도 기록) · 관제 = 종전 SELECT · 「마이그레이션 필요」
 *   2. 칸 얹은 사본 = 같은 UPDATE 에 제목 · 본문 · NUL 제거 · 20,000자 자름 · 제목 200자 · 관제가 그대로 읽는다
 *   3. 「있음」 캐시가 남은 채 칸이 사라지면(42703) = 종전 문장 한 번 더 · 관제도 종전 SELECT
 * 메일 = 가짜(보낸 횟수만 센다).
 */
import { describe, it, expect, vi } from 'vitest';
import { query } from '../../config/database';
import { ledgerBlockSql } from './pg/global-setup';

const mail = vi.fn(async () => ({ outcome: 'sent', detail: '' }));
vi.mock('../agency-mailer', async (orig) => ({ ...(await orig<any>()), sendAgencyReplyMail: (...a: any[]) => (mail as any)(...a) }));

import { sendRejectReply } from '../agency-send-mail-worker';
import { forgetAgencyColumn, readRecentRejectedIntakes } from '../agency-send-intake';

const MB = 'intake-c130@example.invalid';
let seq = 0;
async function intake(): Promise<string> {
  seq += 1;
  const r = await query(
    `INSERT INTO agency_send_email_intake (mailbox, uidl, message_hash, from_email, status, reason, reply_status)
     VALUES ($1, $2, $3, 'sender@example.invalid', 'rejected', 'form_invalid', 'pending') RETURNING id`,
    [MB, `c130-${seq}`, `h-c130-${seq}`],
  );
  return String(r.rows[0].id);
}
const row = async (id: string) => (await query(`SELECT * FROM agency_send_email_intake WHERE id = $1`, [id])).rows[0];

describe('C130 회신 본문 저장 — 실 PG', () => {
  it('칸 없는 사본 → 칸 얹은 사본 → 칸이 사라진 사본(42703) 순서로 운영 문장 그대로', async () => {
    // 1) 칸 없음 = 종전 문장
    const a = await intake();
    await sendRejectReply(a, MB, 'sender@example.invalid', '[한줄로] 대행발송 접수 불가', '본문 A', null);
    const ra = await row(a);
    expect(ra.reply_status).toBe('sent');
    expect(ra.reply_attempts).toBe(1);
    expect('reply_text' in ra).toBe(false);
    const before = await readRecentRejectedIntakes();
    expect(before.replyBodyReady).toBe(false);
    expect(before.rows.some((r: any) => r.uidl === 'c130-1')).toBe(true);

    // 2) 원장 블록 그대로 얹는다 · 「없음」 캐시는 5분이라 지운다(운영 = 5분 안에 저절로 다시 본다)
    await query(ledgerBlockSql('C130-DDL-1'));
    forgetAgencyColumn('reply_text', 'agency_send_email_intake');
    const b = await intake();
    const longText = `첫 줄\u0000${'가'.repeat(20010)}`;
    await sendRejectReply(b, MB, 'sender@example.invalid', `제목${'x'.repeat(300)}`, longText, null);
    const rb = await row(b);
    expect(rb.reply_status).toBe('sent');
    expect(rb.reply_attempts).toBe(1);
    expect(rb.reply_subject).toBe(`제목${'x'.repeat(198)}`);
    expect(rb.reply_text.includes('\u0000')).toBe(false);
    expect(rb.reply_text.startsWith('첫 줄가')).toBe(true);
    expect(rb.reply_text.endsWith('…(이하 생략)')).toBe(true);
    expect(rb.reply_text.length).toBe(20000 + '…(이하 생략)'.length);
    const ready = await readRecentRejectedIntakes();
    expect(ready.replyBodyReady).toBe(true);
    const shown = ready.rows.find((r: any) => r.uidl === 'c130-2');
    expect(shown.reply_subject).toBe(rb.reply_subject);
    expect(shown.reply_text).toBe(rb.reply_text);
    expect(ready.rows.find((r: any) => r.uidl === 'c130-1').reply_text).toBeNull();   // 칸 앞에 처리된 건 = 짧은 사유만

    // 3) 「있음」 캐시가 남은 채 칸이 사라짐 = 42703 → 종전 SELECT(관제가 null 로 사라지지 않는다)
    const drop = `ALTER TABLE agency_send_email_intake DROP COLUMN reply_subject, DROP COLUMN reply_text`;
    await query(drop);
    const after = await readRecentRejectedIntakes();
    expect(after.replyBodyReady).toBe(false);
    expect(after.rows.some((r: any) => r.uidl === 'c130-2')).toBe(true);

    // 4) 다시 얹고(캐시 = 있음) 또 사라짐 = 회신 기록의 42703 → 종전 문장 한 번 더(메일은 한 번)
    await query(ledgerBlockSql('C130-DDL-1'));
    expect((await readRecentRejectedIntakes()).replyBodyReady).toBe(true);
    await query(drop);
    const c = await intake();
    mail.mockClear();
    await sendRejectReply(c, MB, 'sender@example.invalid', '제목 C', '본문 C', null);
    expect(mail).toHaveBeenCalledTimes(1);
    const rc = await row(c);
    expect(rc.reply_status).toBe('sent');
    expect(rc.reply_attempts).toBe(1);
  }, 60000);
});
