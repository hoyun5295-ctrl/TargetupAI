/**
 * C130 ② 메일 반려 회신 본문 저장 · 보기(★ 2026-11-13 · 남지현 접수 cmwd365ga1co9jnscho414cx1 · 설계서 docs/2026-11-13-c130-agency-optout-notice-reply-body-design.md §5)
 *
 *   T2-1 = 동작: 반려 회신은 세 갈래(정상 · 상한 안내 · 보내지 않음) 모두 회신 제목 · 본문을 같은 UPDATE 에 싣는다 ·
 *          접수 완료 회신은 싣지 않는다 · 칸 없음 = 종전 문장 · 칸 확인이 던짐 = 종전 문장(메일 한 번 · 상태 기록 됨) ·
 *          42703 = 캐시를 지우고 종전 문장 한 번 더(메일 한 번).
 *   T2-2 = 소스 계약(구문 트리): 회신 호출 8곳 = 반려 6곳 sendRejectReply · 접수 완료 2곳 sendReplyAndRecord(저장 인자 없음).
 *   T2-5 = 동작: 관제 「최근 반려」 = 칸 있음 · 없음 · 확인 실패 · 새 SELECT 42703 네 갈래(관제가 사라지지 않는다).
 * DB = 가짜(문장 꼴로 응답) · 메일 = 가짜(보낸 횟수만 센다). 실 PG 문장은 agency-reply-body-c130.pg 가 본다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as ts from 'typescript';

const q = vi.fn();
vi.mock('../../config/database', () => ({
  default: { query: (...a: any[]) => q(...a), connect: vi.fn() },
  pool: { query: (...a: any[]) => q(...a), connect: vi.fn() },
  query: (...a: any[]) => q(...a),
}));
const mail = vi.fn();
vi.mock('../agency-mailer', async (orig) => ({ ...(await orig<any>()), sendAgencyReplyMail: (...a: any[]) => mail(...a) }));

type Info = 'yes' | 'no' | 'throw';
let info: Info = 'yes';
let hourly = 0;
let daily = 0;
let storeErr: any = null;
let selectErr: any = null;
let infoCalls = 0;
const updates: Array<{ sql: string; params: any[] }> = [];
const selects: string[] = [];

beforeEach(async () => {
  info = 'yes'; hourly = 0; daily = 0; storeErr = null; selectErr = null; infoCalls = 0;
  updates.length = 0; selects.length = 0;
  q.mockReset(); mail.mockReset();
  mail.mockResolvedValue({ outcome: 'sent', detail: '' });
  q.mockImplementation(async (sql: string, params: any[] = []) => {
    if (sql.includes('information_schema.columns')) {
      infoCalls += 1;
      if (info === 'throw') throw new Error('연결 끊김');
      return { rows: info === 'yes' ? [{ '?column?': 1 }] : [] };
    }
    if (sql.includes("interval '1 hour'")) return { rows: [{ c: hourly }] };
    if (sql.includes("interval '24 hours'")) return { rows: [{ c: daily }] };
    if (sql.startsWith('UPDATE agency_send_email_intake')) {
      updates.push({ sql, params });
      if (storeErr && sql.includes('reply_text')) throw storeErr;
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('FROM agency_send_email_intake i')) {
      selects.push(sql);
      if (selectErr && sql.includes('reply_text')) throw selectErr;
      return { rows: [{ uidl: 'u1' }] };
    }
    throw new Error(`예상 밖 문장: ${sql.slice(0, 80)}`);
  });
  const { forgetAgencyColumn } = await import('../agency-send-intake');
  forgetAgencyColumn('reply_text', 'agency_send_email_intake');   // 칸 판정 캐시는 모듈 상태 = 시험마다 비운다
});

const W = () => import('../agency-send-mail-worker');
const ID = '00000000-0000-0000-0000-0000000000c1';
const MB = 'intake@example.invalid';
const TO = 'sender@example.invalid';

describe('T2-1 회신 기록 = 반려만 본문을 싣는다', () => {
  it('반려 · 정상 발송 = 같은 UPDATE 에 상태 · 시도 · 제목 · 본문', async () => {
    const { sendRejectReply } = await W();
    await sendRejectReply(ID, MB, TO, '[한줄로] 대행발송 접수 불가', '반려 본문', null);
    expect(mail).toHaveBeenCalledTimes(1);
    expect(updates).toHaveLength(1);
    expect(updates[0].sql).toContain('reply_attempts = reply_attempts + 1');
    expect(updates[0].sql).toContain('reply_subject = $3, reply_text = $4');
    expect(updates[0].params).toEqual([ID, 'sent', '[한줄로] 대행발송 접수 불가', '반려 본문']);
  }, 20000);

  it('반려 · 보내지 않음(같은 사유 24시간) = 메일 0 · 상태 skipped · 시도 그대로 · 만든 본문을 싣는다', async () => {
    const { sendRejectReply } = await W();
    daily = 1;
    await sendRejectReply(ID, MB, TO, '제목', '안 보낸 본문', null, 'owner_inactive');
    expect(mail).not.toHaveBeenCalled();
    expect(updates).toHaveLength(1);
    expect(updates[0].sql).not.toContain('reply_attempts');
    expect(updates[0].params).toEqual([ID, 'skipped', '제목', '안 보낸 본문']);
  });

  it('접수 완료 회신(sendReplyAndRecord 그대로) = 본문을 싣지 않고 칸 확인도 하지 않는다', async () => {
    const { sendReplyAndRecord } = await W();
    await sendReplyAndRecord(ID, MB, TO, '[한줄로] 접수 완료', '문안 · 담당자 번호', null, undefined, true);
    expect(mail).toHaveBeenCalledTimes(1);
    expect(infoCalls).toBe(0);
    expect(updates).toHaveLength(1);
    expect(updates[0].sql).not.toContain('reply_text');
    expect(updates[0].params).toEqual([ID, 'sent']);
  });

  it('칸 없음 = 종전 문장', async () => {
    const { sendRejectReply } = await W();
    info = 'no';
    await sendRejectReply(ID, MB, TO, '제목', '본문', null);
    expect(updates.map((u) => u.params)).toEqual([[ID, 'sent']]);
    expect(updates[0].sql).toContain('reply_attempts = reply_attempts + 1');
  });

  it('칸 확인이 던짐 = 위로 던지지 않고 종전 문장 · 메일 한 번 · 상태 기록 됨(재시도가 같은 메일을 또 보내지 않는다)', async () => {
    const { sendRejectReply } = await W();
    info = 'throw';
    await expect(sendRejectReply(ID, MB, TO, '제목', '본문', null)).resolves.toBeUndefined();
    expect(mail).toHaveBeenCalledTimes(1);
    expect(updates.map((u) => u.params)).toEqual([[ID, 'sent']]);
  });

  it('본문 칸 문장이 42703 = 캐시를 지우고 종전 문장 한 번 더 · 메일 한 번 · 다음 기록은 칸을 새로 확인한다', async () => {
    const { sendRejectReply } = await W();
    storeErr = Object.assign(new Error('column "reply_text" does not exist'), { code: '42703' });
    await sendRejectReply(ID, MB, TO, '제목', '본문', null);
    expect(mail).toHaveBeenCalledTimes(1);
    expect(updates).toHaveLength(2);
    expect(updates[1].params).toEqual([ID, 'sent']);
    expect(infoCalls).toBe(1);
    storeErr = null;
    info = 'no';
    await sendRejectReply(ID, MB, TO, '제목', '본문', null);
    expect(infoCalls).toBe(2);   // 「있음」 캐시가 남았으면 다시 확인하지 않고 또 42703 을 맞는다
  });

  it('본문 칸 문장의 다른 오류 = 종전처럼 위로 던진다', async () => {
    const { sendRejectReply } = await W();
    storeErr = Object.assign(new Error('deadlock'), { code: '40P01' });
    await expect(sendRejectReply(ID, MB, TO, '제목', '본문', null)).rejects.toThrow('deadlock');
    expect(updates).toHaveLength(1);
  });

  it('저장 값 범위 = NUL 제거 · 제목 200자 · 본문 20,000자 넘으면 자르고 꼬리', async () => {
    const { replyBodyForStore } = await W();
    const b = replyBodyForStore(`가\u0000${'나'.repeat(300)}`, `x\u0000${'y'.repeat(20005)}`);
    expect(b.subject).toBe(`가${'나'.repeat(199)}`);
    expect(b.text.startsWith('xy')).toBe(true);
    expect(b.text.endsWith('…(이하 생략)')).toBe(true);
    expect(b.text.length).toBe(20000 + '…(이하 생략)'.length);
    expect(replyBodyForStore('t', 'short')).toEqual({ subject: 't', text: 'short' });
  });
});

describe('T2-1 상한 안내 갈래(시간당 상한이 켜진 운영) = 실제로 나간 상한 안내를 싣는다', () => {
  it('정확히 상한에 닿은 회차 = 상한 안내 한 통 · 그 제목 · 본문 저장', async () => {
    vi.resetModules();
    process.env.AGENCY_MAIL_REPLY_RATE_PER_HOUR = '1';
    try {
      const { sendRejectReply } = await import('../agency-send-mail-worker');
      const { forgetAgencyColumn } = await import('../agency-send-intake');
      forgetAgencyColumn('reply_text', 'agency_send_email_intake');
      hourly = 1;
      await sendRejectReply(ID, MB, TO, '원래 제목', '원래 본문', null);
      expect(mail).toHaveBeenCalledTimes(1);
      expect(mail.mock.calls[0][0].subject).toBe('[한줄로] 안내 메일을 잠시 보낼 수 없습니다');
      expect(updates).toHaveLength(1);
      expect(updates[0].params[2]).toBe('[한줄로] 안내 메일을 잠시 보낼 수 없습니다');
      expect(updates[0].params[3]).toBe(mail.mock.calls[0][0].text);
      expect(updates[0].params[3]).not.toContain('원래 본문');
    } finally {
      delete process.env.AGENCY_MAIL_REPLY_RATE_PER_HOUR;
      vi.resetModules();
    }
  }, 20000);
});

describe('T2-2 회신 호출 분류(구문 트리 · 기계 추출)', () => {
  it('반려 6곳 = sendRejectReply · 접수 완료 2곳 = sendReplyAndRecord(저장 인자 없음) · sendReplyAndRecord 를 직접 부르는 반려 0', () => {
    const file = join(__dirname, '..', 'agency-send-mail-worker.ts');
    const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const calls: Array<{ name: string; inFn: string | null; args: number; subject: string }> = [];
    const enclosingFn = (n: ts.Node): string | null => {
      for (let p: ts.Node | undefined = n.parent; p; p = p.parent) if (ts.isFunctionDeclaration(p)) return p.name?.text ?? null;
      return null;
    };
    const walk = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && ['sendRejectReply', 'sendReplyAndRecord'].includes(n.expression.text)) {
        calls.push({ name: n.expression.text, inFn: enclosingFn(n), args: n.arguments.length, subject: n.arguments[3]?.getText(sf) ?? '' });
      }
      ts.forEachChild(n, walk);
    };
    walk(sf);
    const reject = calls.filter((c) => c.name === 'sendRejectReply');
    const plain = calls.filter((c) => c.name === 'sendReplyAndRecord' && c.inFn !== 'sendRejectReply');
    expect(reject).toHaveLength(6);
    expect(reject.every((c) => c.inFn === 'processMessage')).toBe(true);
    expect(plain).toHaveLength(2);
    // 접수 완료 두 곳 = 9번째 인자(저장 선택)를 넘기지 않는다 · 반려 문구 제목을 쓰지 않는다
    for (const c of plain) {
      expect(c.args).toBeLessThanOrEqual(8);
      expect(c.subject).not.toMatch(/접수 불가|이미 접수된/);
    }
    // 반려 제목(「접수 불가」 · 「이미 접수된」)을 쓰는 호출은 전부 sendRejectReply
    expect(calls.filter((c) => /접수 불가|이미 접수된/.test(c.subject)).every((c) => c.name === 'sendRejectReply')).toBe(true);
    // sendRejectReply 안의 sendReplyAndRecord = 하나 · 저장 켬
    const inner = calls.filter((c) => c.name === 'sendReplyAndRecord' && c.inFn === 'sendRejectReply');
    expect(inner).toHaveLength(1);
    expect(inner[0].args).toBe(9);
  });
});

describe('T2-5 관제 「최근 반려」 네 갈래 = 관제가 사라지지 않는다', () => {
  it('칸 있음 = 본문 칸을 싣는 SELECT · replyBodyReady true', async () => {
    const { readRecentRejectedIntakes } = await import('../agency-send-intake');
    const r = await readRecentRejectedIntakes();
    expect(r).toEqual({ rows: [{ uidl: 'u1' }], replyBodyReady: true });
    expect(selects).toHaveLength(1);
    expect(selects[0]).toContain('i.reply_subject, i.reply_text');
  });

  it('칸 없음 = 종전 SELECT · false', async () => {
    const { readRecentRejectedIntakes } = await import('../agency-send-intake');
    info = 'no';
    const r = await readRecentRejectedIntakes();
    expect(r.replyBodyReady).toBe(false);
    expect(selects).toHaveLength(1);
    expect(selects[0]).not.toContain('reply_text');
  });

  it('칸 확인이 던짐 = 종전 SELECT · false(던지지 않는다)', async () => {
    const { readRecentRejectedIntakes } = await import('../agency-send-intake');
    info = 'throw';
    const r = await readRecentRejectedIntakes();
    expect(r).toEqual({ rows: [{ uidl: 'u1' }], replyBodyReady: false });
    expect(selects[0]).not.toContain('reply_text');
  });

  it('새 SELECT 42703 = 캐시 지우고 종전 SELECT 한 번 · false · 다음 조회는 칸을 새로 확인', async () => {
    const { readRecentRejectedIntakes } = await import('../agency-send-intake');
    selectErr = Object.assign(new Error('column i.reply_text does not exist'), { code: '42703' });
    const r = await readRecentRejectedIntakes();
    expect(r).toEqual({ rows: [{ uidl: 'u1' }], replyBodyReady: false });
    expect(selects).toHaveLength(2);
    expect(selects[1]).not.toContain('reply_text');
    await readRecentRejectedIntakes();
    expect(infoCalls).toBe(2);
  });

  it('그 밖 오류 = 던진다(관제 묶음의 catch 가 종전대로 받는다)', async () => {
    const { readRecentRejectedIntakes } = await import('../agency-send-intake');
    selectErr = Object.assign(new Error('timeout'), { code: '57014' });
    await expect(readRecentRejectedIntakes()).rejects.toThrow('timeout');
  });

  it('관리자 라우트 = 이 CT 하나로 읽고 응답에 replyBodyReady 를 싣는다(인라인 조회 0)', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'routes', 'admin.ts'), 'utf8');
    expect(src.split('readRecentRejectedIntakes(').length - 1).toBe(1);
    expect(src).toContain('replyBodyReady: recentRejected.replyBodyReady');
    expect(src).not.toMatch(/i\.reply_text/);
  });
});
