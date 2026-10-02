/**
 * 스팸 검사 — 앱 수신 보고가 어느 검사의 것인지 고르는 규칙 · 늦은 보고 반영 (★2026-10-02)
 *
 * 실측(1002): 시험 폰이 문자를 받고도 보고를 9초 안에 못 내보내 버렸고(앱 1.1), 서버는 "통신사 전송 성공 + 앱 보고 없음"을
 *   '차단'으로 판정했다(SKT 12:46 · KT 오전 6건). 고객 화면에는 「SKT에서 막혔어요」가 떴고 문자는 수신함에 있었다.
 * 앱 1.2 는 서버가 답할 때까지 다시 보낸다(최대 10분). 그래서 서버는
 *   ① 닫힌 검사에도 늦은 보고를 반영한다 — **문안이 같을 때만**(다른 검사의 수신이 진짜 차단을 통과로 덮지 않게)
 *   ② 받는 사람 화면에 통신사가 붙이는 머리말([Web발신])을 떼고 문안을 견준다(종전에는 이것 때문에 문안 대조가 늘 실패했다)
 *   ③ 문자를 받은 뒤에 만들어진 검사는 그 문자의 검사가 아니다(늦은 보고와 그 재전송이 뒤에 만든 검사를 통과로 만들지 않게).
 *      받은 때 = 요청이 서버에 도착한 시각 − 앱이 잰 「받은 뒤 지난 시간」. 폰 시계의 시각은 쓰지 않는다(폰 시계가 틀려도 제때 온 보고를 버리지 않게).
 *   ④ 그 문자의 검사를 먼저 정하고, 고칠 수 있는 때(닫힌 지 10분 안)인가는 그 뒤에 본다(지난 검사를 미리 빼면 재전송이 더 오래된 검사로 넘어간다).
 *
 * 시각 조건 · 10분 창 · 같은 보고 재전송의 실제 동작은 PostgreSQL 16 실측이 소유한다(이 파일은 문장의 모양과 순서를 고정한다).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const state: any = { text: [] as any[], active: [] as any[], device: [] as any[], calls: [] as { sql: string; params: any[] }[] };
const queryMock = vi.fn(async (sql: string, params?: any[]) => {
  const s = String(sql);
  state.calls.push({ sql: s, params: params || [] });
  if (s.includes('t.message_hash = $2')) return { rows: state.text };
  if (s.includes('JOIN spam_filter_tests t ON t.id = tr.test_id')) return { rows: state.device };
  if (s.includes("WHERE status = 'active'") && s.includes('REPLACE(callback_number')) return { rows: state.active };
  return { rows: [] };
});
vi.mock('../../config/database', () => ({ default: { query: vi.fn() }, query: (...a: any[]) => (queryMock as any)(...a), mysqlQuery: vi.fn(async () => []) }));

import {
  computeMessageHash, stripCarrierOriginTag, spamReportHash, parseReportAgeMs, spamReportReceivedAt, resolveSpamReportTest,
  SPAM_LATE_REPORT_MINUTES, SPAM_REPORT_TEXT_MATCH_SQL, SPAM_REPORT_ACTIVE_SQL,
} from '../spam-test-queue';

const SENT = '(광고)안녕하세요\n무료거부0807196700';
const RECEIVED = '[Web발신]\n(광고)안녕하세요\n무료거부0807196700';   // KT·SKT 시험 폰 로그 실측 모양
const H = computeMessageHash(SENT);
const AT = 1_790_000_000_000;   // 문자를 받은 때(서버 시계 ms)
const base = { senderClean: '18008125', devicePhone: '01000000001', carrier: 'SKT', messageType: 'SMS' as const, messageContent: RECEIVED, receivedAtMs: AT as number | null };
const textCalls = () => state.calls.filter((c: any) => c.sql.includes('t.message_hash = $2'));
const activeCalls = () => state.calls.filter((c: any) => c.sql.includes("WHERE status = 'active'") && !c.sql.includes('t.message_hash'));
const flat = (s: string) => s.replace(/\s+/g, ' ');

beforeEach(() => { state.text = []; state.active = []; state.device = []; state.calls = []; queryMock.mockClear(); });

describe('문안 대조 — 통신사 머리말을 떼고 견준다', () => {
  it('받는 사람 화면의 [Web발신] · [국제발신] · [국외발신] 머리말만 뗀다', () => {
    expect(stripCarrierOriginTag(RECEIVED)).toBe(SENT);
    expect(stripCarrierOriginTag('[국제발신]\n본문')).toBe('본문');
    expect(stripCarrierOriginTag('  [국외발신] 본문')).toBe('본문');
    // 본문 중간의 같은 글자 · 다른 대괄호 머리말은 건드리지 않는다
    expect(stripCarrierOriginTag('[이벤트] 안내 [Web발신] 아님')).toBe('[이벤트] 안내 [Web발신] 아님');
    expect(stripCarrierOriginTag('(광고)[Web발신]')).toBe('(광고)[Web발신]');
    expect(stripCarrierOriginTag('')).toBe('');
    expect(stripCarrierOriginTag(undefined as any)).toBe('');
  });
  it('폰이 보고한 문안의 해시 = 보낸 문안의 해시(줄바꿈·공백 차이는 종전 규칙대로 무시)', () => {
    expect(spamReportHash(RECEIVED)).toBe(H);
    expect(spamReportHash('[Web발신](광고)안녕하세요 무료거부0807196700')).toBe(H);
    expect(spamReportHash('[Web발신]\n(광고)안녕하세요\n무료거부0801234567')).not.toBe(H);
    // 머리말을 떼지 않던 종전 계산은 실제 보고와 맞지 않았다
    expect(computeMessageHash(RECEIVED)).not.toBe(H);
    expect(spamReportHash('')).toBe('');
  });
});

describe('앱이 실어 보내는 「받은 뒤 지난 시간」', () => {
  it('0 이상의 정수(ms)만 받는다 · 그 밖은 없는 것으로 본다(1.1 앱은 보내지 않는다)', () => {
    expect(parseReportAgeMs('1200')).toBe(1200);
    expect(parseReportAgeMs(1200)).toBe(1200);
    expect(parseReportAgeMs(' 0 ')).toBe(0);
    expect(parseReportAgeMs(599_000)).toBe(599_000);
    for (const bad of [undefined, null, '', 'abc', '-1', -1, '1.5', 1.5, NaN, Infinity, '1e3', {}, [], true]) expect(parseReportAgeMs(bad)).toBeNull();
    // 앱은 10분이 지난 보고를 버린다 — 한 시간을 넘는 값은 잘못된 값이다
    expect(parseReportAgeMs(60 * 60_000)).toBe(60 * 60_000);
    expect(parseReportAgeMs(60 * 60_000 + 1)).toBeNull();
    expect(parseReportAgeMs('9999999999')).toBeNull();
  });
  it('★ 받은 때 = 요청이 도착한 시각 − 지난 시간 · 지난 시간을 모르면 null', () => {
    expect(spamReportReceivedAt(AT, 131_000)).toBe(AT - 131_000);
    expect(spamReportReceivedAt(AT, 0)).toBe(AT);
    expect(spamReportReceivedAt(AT, null)).toBeNull();
  });
});

describe('문안으로 고르는 문장', () => {
  const s = flat(SPAM_REPORT_TEXT_MATCH_SQL);
  const where = s.slice(0, s.indexOf('ORDER BY'));
  const order = s.slice(s.indexOf('ORDER BY'));
  it('같은 발신번호 · 같은 문안 · 이 단말(번호+통신사+유형)의 행이 있는 검사에서 하나', () => {
    expect(where).toContain("REPLACE(t.callback_number, '-', '') = $1");
    expect(where).toContain('t.message_hash = $2');
    expect(where).toContain('WHERE tr.test_id = t.id AND tr.phone = $3 AND tr.carrier = $4 AND tr.message_type = $5)');
    expect(order).toMatch(/LIMIT 1$/);
  });
  it('고르는 순서 = 진행 중이고 이 단말의 보고를 아직 기다리는 검사(종전 규칙) → 그 밖에는 가장 최근에 만든 것', () => {
    expect(order).toBe("ORDER BY (t.status = 'active' AND EXISTS ( SELECT 1 FROM spam_filter_test_results w WHERE w.test_id = t.id AND w.phone = $3 AND w.carrier = $4 AND w.message_type = $5 AND w.received = false AND w.result IS NULL)) DESC, t.created_at DESC LIMIT 1");
  });
  it('진행 중인 검사 + 닫힌 검사 · 닫힌 검사는 받은 때를 아는 보고(1.2)만', () => {
    expect(where).toContain("AND (t.status = 'active' OR ($6::double precision IS NOT NULL AND t.status = 'completed'))");
  });
  it('★ 닫힌 지 10분은 후보를 거르는 조건이 아니다 — 고른 검사가 고칠 수 있는 때인가(correctable)로만 돌려준다', () => {
    // Codex 2R: 지난 검사를 후보에서 미리 빼면, 같은 보고의 재전송이 더 오래된 다른 닫힌 검사로 넘어가 진짜 차단을 통과로 고친다
    expect(SPAM_LATE_REPORT_MINUTES).toBe(10);
    expect(s).toContain("SELECT t.id, t.status, (t.status = 'active' OR t.completed_at >= NOW() - INTERVAL '10 minutes') AS correctable FROM");
    expect(where.slice(where.indexOf('WHERE'))).not.toContain('completed_at');
  });
  it('★ 문자를 받은 뒤에 만들어진 검사는 뺀다 — 받은 때는 밖에서 정해 넘긴 값이다(문장을 돌리는 때의 시각 · 허용 오차를 쓰지 않는다)', () => {
    // Codex 2R: 문장 안에서 NOW() − 지난 시간으로 계산하면, 문장을 돌리기 전의 대기만큼 받은 때가 늦게 잡혀 뒤에 만든 검사가 후보에 든다
    expect(where).toContain("AND ($6::double precision IS NULL OR t.created_at <= to_timestamp($6::double precision / 1000.0))");
    expect(where.slice(where.indexOf('WHERE'))).not.toContain('NOW()');
    expect(s).not.toMatch(/\+ INTERVAL/);
  });
  it('⛔ 닫힌 검사는 행의 상태(수신 표시 · 판정)로 고르지 않는다 — 같은 보고가 두 번 올 때 더 오래된 닫힌 검사로 넘어가 진짜 차단을 통과로 고친다', () => {
    // 후보 조건에는 행의 상태가 없다 · 순서에서 행의 상태를 보는 것은 진행 중인 검사뿐이다
    expect(where).not.toMatch(/\.received/);
    expect(where).not.toMatch(/\.result/);
    expect(order).toContain("(t.status = 'active' AND EXISTS (");
    expect(order.match(/received = false/g)).toHaveLength(1);
  });
  it('종전 규칙의 후보 문장도 같은 시각 조건을 쓴다', () => {
    const a = flat(SPAM_REPORT_ACTIVE_SQL);
    expect(a).toContain("WHERE status = 'active' AND REPLACE(callback_number, '-', '') = $1");
    expect(a).toContain("AND ($2::double precision IS NULL OR created_at <= to_timestamp($2::double precision / 1000.0))");
    expect(a).not.toContain('NOW()');
    expect(a).toContain('ORDER BY created_at DESC');
  });
});

describe('resolveSpamReportTest — 이 보고는 어느 검사의 것인가', () => {
  it('문안이 같은 검사가 있으면 그 검사다 · 진행 중이면 늦은 보고가 아니다', async () => {
    state.text = [{ id: 'A', status: 'active', correctable: true }];
    expect(await resolveSpamReportTest(base)).toEqual({ testId: 'A', late: false, via: 'hash' });
    const [c] = textCalls();
    expect(c.sql).toBe(SPAM_REPORT_TEXT_MATCH_SQL);
    expect(c.params).toEqual(['18008125', H, '01000000001', 'SKT', 'SMS', AT]);
    // 문안으로 골랐으면 종전 규칙을 보지 않는다
    expect(activeCalls()).toHaveLength(0);
  });
  it('★ 늦은 보고: 문안이 같은 닫힌 검사를 고르면 late = true', async () => {
    state.text = [{ id: 'CLOSED', status: 'completed', correctable: true }];
    expect(await resolveSpamReportTest({ ...base, receivedAtMs: AT - 131_000 })).toEqual({ testId: 'CLOSED', late: true, via: 'hash' });
    expect(textCalls()[0].params[5]).toBe(AT - 131_000);
  });
  it('★ 그 문자의 검사가 닫힌 지 10분을 넘었으면 무시한다 — 종전 규칙으로도 넘어가지 않는다', async () => {
    // 문안 문장이 고른 검사(그 문자의 검사)가 고칠 수 있는 때를 지났다. 같은 발신번호로 진행 중인 다른 검사가 있어도 그리로 가지 않는다
    state.text = [{ id: 'OLD', status: 'completed', correctable: false }];
    state.active = [{ id: 'B' }];
    expect(await resolveSpamReportTest(base)).toBeNull();
    expect(activeCalls()).toHaveLength(0);
    // 값이 비어 온 경우(닫힌 검사에 완료 시각이 없다)도 고칠 수 있는 것으로 치지 않는다
    state.text = [{ id: 'OLD', status: 'completed', correctable: null }];
    expect(await resolveSpamReportTest(base)).toBeNull();
  });
  it('받은 때를 모르는 보고(1.1)는 $6 = NULL 로 묻는다(문장이 진행 중인 검사만 본다)', async () => {
    state.text = [{ id: 'A', status: 'active', correctable: true }];
    expect(await resolveSpamReportTest({ ...base, receivedAtMs: null })).toEqual({ testId: 'A', late: false, via: 'hash' });
    expect(textCalls()[0].params[5]).toBeNull();
  });
  it('★ 문안이 같은 진행 중인 다른 검사가 있어도 문안 문장이 고른 것 하나로 끝난다 — 종전 규칙으로 넘어가 다른 검사를 고르지 않는다', async () => {
    // 문안 문장이 닫힌 검사 A 를 골랐다(받은 뒤에 만들어진 B 는 문장이 뺐다). 진행 중인 B 가 종전 규칙의 후보여도 A 다
    state.text = [{ id: 'A', status: 'completed', correctable: true }];
    state.active = [{ id: 'B' }];
    expect(await resolveSpamReportTest({ ...base, receivedAtMs: AT - 131_000 })).toEqual({ testId: 'A', late: true, via: 'hash' });
    expect(activeCalls()).toHaveLength(0);
  });
  it('문안이 같은 검사가 없으면 종전 규칙 — 진행 중인 검사가 하나면 그것', async () => {
    state.active = [{ id: 'A' }];
    expect(await resolveSpamReportTest(base)).toEqual({ testId: 'A', late: false, via: 'single' });
    const [c] = activeCalls();
    expect(c.sql).toBe(SPAM_REPORT_ACTIVE_SQL);
    expect(c.params).toEqual(['18008125', AT]);
  });
  it('문안을 알 수 없는 보고(빈 본문)는 문안 문장을 건너뛴다 — 닫힌 검사는 문안이 같을 때만 고친다', async () => {
    state.text = [{ id: 'CLOSED', status: 'completed', correctable: true }];
    expect(await resolveSpamReportTest({ ...base, messageContent: '' })).toBeNull();
    expect(textCalls()).toHaveLength(0);
    state.active = [{ id: 'A' }];
    expect(await resolveSpamReportTest({ ...base, messageContent: '' })).toEqual({ testId: 'A', late: false, via: 'single' });
  });
  it('후보가 없으면 null', async () => {
    expect(await resolveSpamReportTest(base)).toBeNull();
  });
  it('진행 중인 검사가 여럿이고 문안으로 못 가리면 종전처럼 이 단말에 보고가 아직 없는 가장 최근 검사', async () => {
    state.active = [{ id: 'B2' }, { id: 'B1' }];
    state.device = [{ test_id: 'B1' }];
    expect(await resolveSpamReportTest(base)).toEqual({ testId: 'B1', late: false, via: 'device' });
    const d = state.calls.find((c: any) => c.sql.includes('JOIN spam_filter_tests t ON t.id = tr.test_id'));
    expect(d.params).toEqual([['B2', 'B1'], '01000000001', 'SKT']);
    state.device = [];
    expect(await resolveSpamReportTest(base)).toBeNull();
  });
});

describe('소스 계약 — 수신 보고 라우트', () => {
  const route = readFileSync(join(__dirname, '../../routes/spam-filter.ts'), 'utf8');
  const at0 = route.indexOf("router.post('/report'");
  const body = route.slice(at0, route.indexOf('router.', at0 + 10));
  it('어느 검사인지는 CT 하나가 고른다(라우트에 매칭을 다시 쓰지 않는다)', () => {
    expect(body).toContain('resolveSpamReportTest(');
    expect(body).not.toContain("WHERE status = 'active'");
    expect(body).not.toContain('computeMessageHash(');
  });
  it('★ 받은 때 = 요청 도착 시각 − 앱이 잰 「받은 뒤 지난 시간」 · 도착 시각은 어떤 대기보다 먼저 한 번만 잡는다', () => {
    expect(body).toContain('const reportAgeMs = parseReportAgeMs(ageMs);');
    expect(body).toContain('receivedAtMs: spamReportReceivedAt(arrivedAtMs, reportAgeMs),');
    // 도착 시각 = 핸들러의 첫 문장(try 앞 · 첫 await 앞). 그 밖에서는 지금 시각을 읽지 않는다
    const first = body.indexOf('const arrivedAtMs = Date.now();');
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(body.indexOf('try {'));
    expect(first).toBeLessThan(body.indexOf('await '));
    expect(body.match(/Date\.now\(\)/g)).toHaveLength(1);
    // 폰 시계의 시각(receivedAt)을 요청에서 읽지 않는다
    expect(body).not.toMatch(/req\.body\.receivedAt|\breceivedAt\b\s*[,}]/);
  });
  it('결과 행 갱신 문장은 그대로다 — 단말 번호까지 맞추고 발송 실패 행은 바꾸지 않는다', () => {
    expect(body).toMatch(/UPDATE spam_filter_test_results[\s\S]*WHERE test_id = \$1 AND carrier = \$2 AND message_type = \$3 AND phone = \$5 AND received = false\s+AND \(result IS NULL OR result <> \$6\)/);
  });
  it('닫힌 검사를 다시 닫지 않는다(완료 시각을 늦은 보고 시각으로 덮지 않는다)', () => {
    const done = body.match(/UPDATE spam_filter_tests SET status = 'completed', completed_at = NOW\(\)\s+WHERE id = \$1([^`]*)`/);
    expect(done).not.toBeNull();
    expect(done![1]).toContain("AND status = 'active'");
  });
});
