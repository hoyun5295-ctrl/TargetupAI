// replaces: none
/**
 * C143 — SMS 길이(90바이트) 전 발송 길 닫기 + 관리자 고정 상한 목록(★ 2026-11-18 · 설계서 docs/2026-11-18-c143-sms-length-admin-lists-design.md §4)
 *   뿌리 R68(나갈 수 있는가 · 길이 축) · R47(효과 자리) · R73(고정 상한 목록) · R56(안내 = 실제)
 *   1118 실측 = 90바이트까지 나가고 91바이트부터 통째로 실패(잘려 가지 않음 · 금강제화 11-17 91바이트 100,661통 전량 실패 · 90바이트 97% 성공).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve, relative } from 'path';

const { mysqlCalls } = vi.hoisted(() => ({ mysqlCalls: [] as unknown[][] }));
vi.mock('../../config/database', () => {
  const query = vi.fn(async () => ({ rows: [] }));
  return {
    query,
    mysqlQuery: vi.fn(async (...a: unknown[]) => { mysqlCalls.push(a); return []; }),
    mysqlPool: { getConnection: vi.fn(async () => { throw new Error('시험: 연결 받기 금지'); }) },
    pool: { connect: vi.fn(), query },
    default: { connect: vi.fn(), query },
  };
});
vi.mock('../../services/ai', () => ({ callAIWithFallback: vi.fn(async () => ''), stripIncompatibleEmojis: (t: string) => t, extractVarCatalog: () => ({ fieldMappings: {}, availableVars: [] }) }));

import { bulkInsertSmsQueue, loadQueueUnit, insertTestSmsQueue } from '../sms-queue';
import { smsRowOverLimit, SmsTooLongError, eucKrByteLength, SMS_MAX_BYTES } from '../message-byte';
import { smsMinBytes, smsMinBytesIssue } from '../sms-length';
import { shortenedLengthBounds } from '../short-url';
import { peekSpamCheck } from '../spam-test-queue';
import { query as dbQuery } from '../../config/database';
import { operatorFinalCopyAt, operatorSmsOverflows } from '../operator-final-copy';
import { buildAdMessage } from '../messageUtils';
import { restrictionReasonMessage } from '../account-action';
import { mysqlPool } from '../../config/database';

const BACKEND_SRC = resolve(__dirname, '../..');
const FRONT_SRC = resolve(__dirname, '../../../../frontend/src');
const read = (p: string) => readFileSync(join(BACKEND_SRC, p), 'utf8');
const readFront = (p: string) => readFileSync(join(FRONT_SRC, p), 'utf8');
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== '__tests__' && name !== 'node_modules') out.push(...sourceFiles(p)); }
    else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name) && !/\.verify\.ts$/.test(name) && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}
const rel = (p: string) => relative(BACKEND_SRC, p).replace(/\\/g, '/');
/** 함수 몸통(선언부터 다음 최상위 선언 앞까지) */
const fnBody = (src: string, head: string) => {
  const at = src.indexOf(head);
  if (at < 0) throw new Error(`없음: ${head}`);
  const next = src.slice(at + head.length).search(/\n(export )?(async )?function |\nrouter\.(get|post|put|delete)\(/);
  return next < 0 ? src.slice(at) : src.slice(at, at + head.length + next);
};
/** 큐 줄: [dest, cb, 글, 유형, 제목, 시각, app_etc1, app_etc2, f1, f2, f3] · app_etc2 빈 값 = 시연 막기 조회 0 */
const row = (text: string, type: 'S' | 'L' | 'M' = 'S', dest = '01000000000') => [dest, '0212345678', text, type, '', '', 'c', '', '', '', ''];

beforeEach(() => { mysqlCalls.length = 0; (mysqlPool.getConnection as any).mockClear(); });

describe('판정 한 줄 — smsRowOverLimit', () => {
  it('S 이고 90바이트를 넘을 때만 · 경계 90 = 통과 · 91 = 넘침 · L · M 은 판정 밖', () => {
    expect(smsRowOverLimit('S', 'A'.repeat(90))).toBe(false);
    expect(smsRowOverLimit('S', 'A'.repeat(91))).toBe(true);
    expect(smsRowOverLimit('S', '가'.repeat(45))).toBe(false);
    expect(smsRowOverLimit('S', '가'.repeat(45) + 'A')).toBe(true);
    expect(smsRowOverLimit('L', 'A'.repeat(2000))).toBe(false);
    expect(smsRowOverLimit('M', 'A'.repeat(500))).toBe(false);
    expect(SMS_MAX_BYTES).toBe(90);
  });
});

describe('E1 문자 적재 CT(bulkInsertSmsQueue) = 마지막 문 · 넘는 S 줄만 빼고 실은 수', () => {
  it('섞인 배치 = 넘는 줄만 빠지고 남은 줄의 순서 · 값 = 옛 배열 · 반환 = 실린 수 · 알림 = 뺀 수 · 최장', async () => {
    const run = vi.fn(async () => undefined);
    const seen: Array<[number, number]> = [];
    const rows = [row('A'.repeat(90), 'S', '01000000001'), row('B'.repeat(91), 'S', '01000000002'), row('C'.repeat(2000), 'L', '01000000003'), row('D'.repeat(120), 'S', '01000000004'), row('E', 'S', '01000000005')];
    const n = await bulkInsertSmsQueue(['SMSQ_SEND_1'], rows, true, undefined, { run, onSmsTooLong: (c, m) => seen.push([c, m]) });
    expect(n).toBe(3);
    expect(seen).toEqual([[2, 120]]);
    const params = (run.mock.calls as any[]).flatMap((c) => c[1] as any[]);
    const sentTexts = params.filter((p) => typeof p === 'string' && /^[A-E]+$/.test(p));
    expect(sentTexts).toEqual(['A'.repeat(90), 'C'.repeat(2000), 'E']);
  });
  it('90 이하 줄만 = 옛 그대로(알림 0 · 반환 = 줄 수)', async () => {
    const run = vi.fn(async () => undefined);
    const onSmsTooLong = vi.fn();
    expect(await bulkInsertSmsQueue(['SMSQ_SEND_1'], [row('A'.repeat(90)), row('가'.repeat(45))], true, undefined, { run, onSmsTooLong })).toBe(2);
    expect(onSmsTooLong).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('넘는 줄이 전부 = INSERT 0 · 반환 0 · 던지지 않음(tx 묶음이 되돌려지지 않는다)', async () => {
    const txRun = vi.fn(async () => undefined);
    const tx: any = { run: txRun, afterCommit: vi.fn() };
    await expect(bulkInsertSmsQueue(['SMSQ_SEND_1'], [row('A'.repeat(91)), row('B'.repeat(95))], true, undefined, { tx })).resolves.toBe(0);
    expect(txRun).not.toHaveBeenCalled();
  });
  it('경보 줄 = 회사 · 출처 · 건수 · 최장(본문 · 번호 0) · 판정은 스냅숏보다 앞(빠진 글은 금칙어 탐지에도 안 들어감)', () => {
    const body = fnBody(read('utils/sms-queue.ts'), 'export async function bulkInsertSmsQueue(');
    const warn = body.slice(body.indexOf('[sms-queue][SMS_TOO_LONG]'), body.indexOf('\n', body.indexOf('[sms-queue][SMS_TOO_LONG]')));
    expect(warn).not.toMatch(/\$\{r\[0\]\}|\$\{r\[2\]\}|dest|content/);
    expect(body.indexOf('smsRowOverLimit(r[3], r[2])')).toBeLessThan(body.indexOf('snapshotSendContents(rows)'));
  });
});

describe('E2 여정 적재 CT(loadQueueUnit) — 넘는 줄 = 문장 보내기 전 거절', () => {
  it('S 91 한 줄 = rejected · 단위 기록(record) 0 · 연결 받기 0', async () => {
    const record = vi.fn(async () => undefined);
    const out = await loadQueueUnit({ kind: 'sms', tables: ['SMSQ_SEND_1'], smsRows: [row('A'.repeat(10)), row('B'.repeat(91))], useNow: true, record });
    expect(out.state).toBe('rejected');
    expect((out as any).reason).toContain('SMS 90바이트 초과 1건');   // 길이 거절(연결 · 기록 실패 갈래와 가른다)
    expect(record).not.toHaveBeenCalled();
    expect(mysqlPool.getConnection).not.toHaveBeenCalled();
  });
});

describe('E3 테스트 적재 CT(insertTestSmsQueue) = 방어 · 부르는 자리 전수에 앞 판정', () => {
  it('SMS 91 = SmsTooLongError(400 · SMS_TOO_LONG · 고객 글) · INSERT 0 · LMS 91 = INSERT', async () => {
    const err = await insertTestSmsQueue('01000000000', '0212345678', 'A'.repeat(91), 'SMS', 'test', '').catch((e) => e);
    expect(err).toBeInstanceOf(SmsTooLongError);
    expect(err.status).toBe(400);
    expect(err.code).toBe('SMS_TOO_LONG');
    expect(err.message).toContain('91바이트');
    expect(mysqlCalls.length).toBe(0);
    await insertTestSmsQueue('01000000000', '0212345678', 'A'.repeat(91), 'LMS', 'test', '제목');
    expect(mysqlCalls.length).toBe(1);
  });
  it('K4 부르는 자리(기계 추출) = 여섯 · 자리마다 앞 판정 또는 LMS · 고정 글', () => {
    const callers = sourceFiles(BACKEND_SRC).filter((f) => rel(f) !== 'utils/sms-queue.ts' && /\binsertTestSmsQueue\(/.test(readFileSync(f, 'utf8'))).map(rel).sort();
    expect(callers).toEqual(['routes/campaigns.ts', 'routes/dm.ts', 'routes/spam-filter.ts', 'utils/agency-send-worker.ts', 'utils/spam-probe.ts', 'utils/spam-test-queue.ts']);
    // 직접 테스트 = 차감보다 앞에서 400
    const ts = read('routes/campaigns.ts');
    const testSend = ts.slice(ts.indexOf("router.post('/test-send'"), ts.indexOf("router.post('/'", ts.indexOf("router.post('/test-send'")));
    expect(testSend.indexOf("code: 'SMS_TOO_LONG'")).toBeGreaterThan(0);
    expect(testSend.indexOf("code: 'SMS_TOO_LONG'")).toBeLessThan(testSend.indexOf('prepaidDeduct('));
    // 스팸 직접 = 검사 행 · 체험보다 앞
    const sf = read('routes/spam-filter.ts');
    expect(sf.indexOf("code: 'SMS_TOO_LONG'")).toBeGreaterThan(0);
    expect(sf.indexOf("code: 'SMS_TOO_LONG'")).toBeLessThan(sf.indexOf('INSERT INTO spam_filter_tests'));
    // 스팸 큐 = 등록이 반려(rejected 갈래) · 실행 = 저장 표본 없으면 빈 표본(다시 조회 0)
    const stq = read('utils/spam-test-queue.ts');
    const enq = fnBody(stq, 'export async function enqueueSpamTest(');
    expect(enq.indexOf("errorCode: 'SMS_TOO_LONG'")).toBeGreaterThan(0);
    expect(enq.indexOf("errorCode: 'SMS_TOO_LONG'")).toBeLessThan(enq.indexOf('INSERT INTO spam_filter_tests'));
    expect(fnBody(stq, 'export function enqueueFailureVerdict(')).toContain("'SMS_TOO_LONG'");
    const exec = fnBody(stq, 'async function executeSpamTest(');
    expect(exec).not.toMatch(/FROM customers WHERE company_id = \$1 AND is_active = true AND sms_opt_in = true/);
    // DM 테스트 = LMS 고정 · 탐침 = 고정 짧은 글 · 대행 = C142 길이 판정이 앞
    const dm = read('routes/dm.ts');
    expect(dm.slice(dm.indexOf('await insertTestSmsQueue('), dm.indexOf('await insertTestSmsQueue(') + 400)).toMatch(/'LMS'/);
    expect(read('utils/spam-probe.ts')).toMatch(/insertTestSmsQueue\([^)]*probeText\(/);
    expect(read('utils/agency-send-worker.ts')).toContain('settleSmsBytesOver(');
  });
});

describe('E4 · K5 시스템 단문(직접 INSERT \'S\') = 실제 글 ≤ 90 · 원시 적재 전수', () => {
  it('K1 칸 목록에 msg_type 이 있는 원시 INSERT = sms-queue CT 안 + S 고정 넷(새 자리 = 빨간불)', () => {
    const hits: Record<string, number> = {};
    for (const f of sourceFiles(BACKEND_SRC)) {
      const n = (readFileSync(f, 'utf8').match(/INSERT INTO \$\{[^}]+\}\s*\(([^)]*)\)/g) || []).filter((m) => /\bmsg_type\b/.test(m)).length;
      if (n > 0) hits[rel(f)] = n;
    }
    // sms-queue 여섯 = CT 안(문자 배치 두 꼴 = bulkInsertSmsQueue · loadQueueUnit 이 판정 뒤 부름 · 테스트 두 꼴 = insertTestSmsQueue 판정 뒤 · 알림톡 K · 브랜드 F)
    expect(hits).toEqual({ 'routes/admin.ts': 1, 'routes/manage-users.ts': 1, 'utils/account-action.ts': 1, 'utils/mfa.ts': 1, 'utils/sms-queue.ts': 6 });
  });
  it('조치 안내 = 사유 전부(소스에서 뽑음) · 임시 비밀번호(소스의 자리 수) · 인증번호 · 발신 인증', () => {
    const aa = read('utils/account-action.ts');
    const tpl = /const message = `([^`]*)`;/.exec(fnBody(aa, 'export async function sendRestrictionNotice('))![1];
    const keys = [...aa.slice(aa.indexOf('const REASON_MESSAGE'), aa.indexOf('};', aa.indexOf('const REASON_MESSAGE'))).matchAll(/^\s+([a-z_]+):/gm)].map((m) => m[1]);
    expect(keys).toEqual(expect.arrayContaining(['mfa_failure', 'spam_report', 'admin_action', 'contract_end']));
    for (const k of [...keys, 'unknown_reason']) {
      const text = tpl.replace('${reasonText}', restrictionReasonMessage(k)).replace(/\\n/g, '\n');
      expect(eucKrByteLength(text), k).toBeLessThanOrEqual(SMS_MAX_BYTES);
    }
    for (const p of ['routes/admin.ts', 'routes/manage-users.ts']) {
      const src = read(p);
      const len = Number(/for \(let i = 0; i < (\d+); i\+\+\) \{\s*\n\s*tempPassword \+=/.exec(src)![1]);
      const t = /const message = `(\[Target-UP\] 임시 비밀번호: [^`]*)`;/.exec(src)![1].replace('${tempPassword}', 'X'.repeat(len)).replace(/\\n/g, '\n');
      expect(eucKrByteLength(t), p).toBeLessThanOrEqual(SMS_MAX_BYTES);
    }
    const mfa = read('utils/mfa.ts');
    expect(mfa).toContain("padStart(6, '0')");
    const sa = read('utils/sender-auth.ts');
    for (const [src, re] of [[mfa, /sendAuthCodeSms\(phone, `([^`]*)`\)/], [sa, /sendAuthCodeSms\(\s*params\.phone,\s*`([^`]*)`/]] as const) {
      const t = re.exec(src)![1].replace(/\$\{code\}/, '9'.repeat(6)).replace(/\$\{[A-Z_]+\}/, '99').replace(/\\n/g, '\n');
      expect(eucKrByteLength(t)).toBeLessThanOrEqual(SMS_MAX_BYTES);
    }
  });
});

describe('W3 · L8 하한 CT(smsMinBytes) — 증명되는 하한만', () => {
  const OPT = '0801234567';
  it('변수 없음 = 실제 글(광고 머리 · 꼬리 포함) 정확히 · 경계 90 / 91', () => {
    for (const len of [64, 65, 66]) {
      const t = 'A'.repeat(len);
      const exact = eucKrByteLength(buildAdMessage(t, 'SMS', true, OPT));
      expect(smsMinBytes({ template: t, isAd: true, opt080: OPT, sanitize: true })).toEqual({ bytes: exact, exact: true, hasVars: false });
      expect(smsMinBytesIssue({ template: t, isAd: true, opt080: OPT, sanitize: true }) !== null).toBe(exact > 90);
    }
    expect(smsMinBytes({ template: 'A'.repeat(91), isAd: false, opt080: '', sanitize: false })).toEqual({ bytes: 91, exact: true, hasVars: false });
  });
  it('변수 있음 = 고정 글자만(머리 · 꼬리 없이) · Codex 1R #3 반례(값이 무료수신거부 문구 = 꼬리가 안 붙는 글)는 막지 않는다', () => {
    const t = 'A'.repeat(60) + '\n%거부안내% 0801234567';
    const m = smsMinBytes({ template: t, isAd: true, opt080: OPT, sanitize: true })!;
    expect(m.exact).toBe(false);
    expect(m.hasVars).toBe(true);
    expect(m.bytes).toBe(eucKrByteLength('A'.repeat(60) + '\n 0801234567'));
    expect(smsMinBytesIssue({ template: t, isAd: true, opt080: OPT, sanitize: true })).toBeNull();
    const over = '%이름%님 ' + '가'.repeat(45);
    expect(smsMinBytesIssue({ template: over, isAd: true, opt080: OPT, sanitize: true })).toContain('고객 정보를 넣기 전에도');
  });
  it('Codex 구현 1R #2 — 주소 줄이기 두 갈래: min = 주소마다 짧은 쪽 · max = 긴 쪽 · 하한은 줄이는 길(여정)에서만 min', () => {
    const longUrl = 'https://example.com/' + 'a'.repeat(80);
    const shortUrl = 'http://a.co';
    const src = `앞 ${longUrl} 중간 ${shortUrl} 끝`;
    const b = shortenedLengthBounds(src);
    expect(eucKrByteLength(b.min)).toBeLessThan(eucKrByteLength(src));
    expect(b.min).toContain(shortUrl);          // 짧은 원문 주소는 그대로(줄이면 길어진다)
    expect(b.min).not.toContain(longUrl);       // 긴 주소는 짧은 주소 자리로
    expect(b.max).toContain(longUrl);           // 긴 쪽 = 줄이기가 실패해 원문으로 나가는 갈래
    expect(b.max).not.toContain(shortUrl);      // 짧은 원문 주소가 더 긴 짧은 주소로 바뀌는 갈래
    expect(shortenedLengthBounds('주소 없는 글')).toEqual({ min: '주소 없는 글', max: '주소 없는 글' });
    // 원문은 90 을 넘고 줄이면 들어가는 글 = 줄이는 길(여정)에서는 막지 않는다 · 줄이지 않는 길에서는 막는다
    const t = `안내 ${longUrl}`;
    expect(smsMinBytesIssue({ template: t, isAd: false, opt080: '', sanitize: true })).toContain('바이트예요');
    const m = smsMinBytes({ template: t, isAd: false, opt080: '', sanitize: true, shortenUrls: true })!;
    expect(m.bytes).toBeLessThanOrEqual(90);
    expect(m.exact).toBe(false);
    expect(smsMinBytesIssue({ template: t, isAd: false, opt080: '', sanitize: true, shortenUrls: true })).toBeNull();
  });
  it('Liquid = 판정 생략(null) · 빈 글 = null · 추천 자리 = 표식을 뺀 글(정확하지 않음 표시)', () => {
    expect(smsMinBytes({ template: '{% if customer.grade == "VIP" %}' + 'A'.repeat(100) + '{% endif %}', isAd: true, opt080: OPT, sanitize: true })).toBeNull();
    expect(smsMinBytes({ template: '   ', isAd: true, opt080: OPT, sanitize: true })).toBeNull();
    const reco = smsMinBytes({ template: 'A'.repeat(40) + ' <추천상품: 셔츠 | 바지 || 새 상품> 보세요', isAd: true, opt080: OPT, sanitize: true });
    if (reco) expect(reco.exact).toBe(false);
  });
});

describe('W4 자동마케팅 = 나가는 글로 단문 판정 · 리마인드 = 확정 함수 먼저', () => {
  const ctx = { benefit: null, opt080: '0801234567', callback: '0212345678' };
  const pj = (body: string) => ({ channel: { recommended: 'SMS' }, messages: [{ body }] });
  it('본문은 90 안이어도 (광고) · 무료거부 줄을 붙여 90 을 넘으면 LMS(옛 결함 갈래) · 붙여도 90 안이면 SMS', () => {
    let flipped = false;
    for (let len = 55; len <= 75; len++) {
      const body = 'A'.repeat(len);
      const over = eucKrByteLength(buildAdMessage(body, 'SMS', true, ctx.opt080)) > 90;
      expect(operatorSmsOverflows(body, ctx.opt080)).toBe(over);
      expect(operatorFinalCopyAt(pj(body), 0, ctx)!.msgType).toBe(over ? 'LMS' : 'SMS');
      if (over && len <= 90) flipped = true;
    }
    expect(flipped).toBe(true);
    // 짧은 원문 주소 = 줄이면 더 길어지는 갈래(max)로 잰다 → 원문으로는 90 안이어도 줄인 글이 넘으면 LMS
    let pad = 0;
    while (eucKrByteLength(buildAdMessage('A'.repeat(pad + 1) + ' http://a.co', 'SMS', true, ctx.opt080)) <= 90) pad += 1;
    const base = 'A'.repeat(pad) + ' http://a.co';   // 원문 + 머리 · 꼬리 = 딱 90
    expect(eucKrByteLength(buildAdMessage(base, 'SMS', true, ctx.opt080))).toBe(90);
    expect(operatorSmsOverflows(base, ctx.opt080)).toBe(true);
    expect(operatorFinalCopyAt(pj(base), 0, ctx)!.msgType).toBe('LMS');
  });
  it('리마인드 = operatorFinalCopy 결과의 유형으로 저장 채널 · 제목 · 비용(따로 재는 줄 0)', () => {
    const co = read('utils/continuous-operator.ts');
    const at = co.indexOf('const draftFinal = operatorFinalCopy(');
    expect(at).toBeGreaterThan(0);
    expect(co.indexOf('const reminderType = draftFinal?.msgType', at)).toBeGreaterThan(at);
    expect(co).not.toMatch(/eucKrByteLength\(content\) > 90/);
    expect(read('utils/operator-final-copy.ts')).toMatch(/if \(msgType === 'SMS' && operatorSmsOverflows\(body, ctx\.opt080 \|\| ''\)\) msgType = 'LMS'/);
  });
});

describe('W2 · W3 여정 · L8 예약 문안 수정 · 워커 종결(소스 계약)', () => {
  it('W2 실행기 = 렌더 뒤 · 금칙어 · 비용 · 예산 · 잔액 판정 앞에서 그 고객 sms_too_long', () => {
    const ex = read('utils/journey-executor.ts');
    const at = ex.indexOf("reason: 'sms_too_long'");
    expect(at).toBeGreaterThan(0);
    for (const later of ["reason: 'spam_blocked'", "reason: 'threshold_cost_exceeded'", "reason: 'budget_monthly_exceeded'", "reason: 'insufficient_balance'"]) expect(at).toBeLessThan(ex.indexOf(later));
    expect(ex.slice(at - 200, at)).toContain('smsRowOverLimit(toQtmsgType(msgType), shortenedLengthBounds(r.message).min)');
    // 줄인 뒤 = 넘는 고객만 실패 · 전진 · 차감 0 · 나머지는 그대로(단위 전체 거절 0)
    const after = ex.indexOf('const tooLong = unit.filter((r) => smsRowOverLimit(toQtmsgType(c.msgType), r.message));');
    expect(after).toBeGreaterThan(at);
    expect(ex.slice(after, after + 700)).toMatch(/logStepMany\([\s\S]*?'failed', 'sms_too_long'\)[\s\S]*addedCost: 0[\s\S]*unit = unit\.filter/);
  });
  it('W3 켜기 · 켜진 칸 고치기 = SMS 칸이면 하한 판정(렌더와 같은 재료)', () => {
    const jb = read('utils/journey-builder.ts');
    const core = fnBody(jb, 'async function activationBlockCore(');
    expect(core.indexOf('smsMinBytesIssue(')).toBeGreaterThan(core.indexOf('journeyCopyIssue('));
    expect(core).toContain("if (channel === 'sms')");
    const assert = fnBody(jb, 'async function assertStepCopySendable(');
    expect(assert).toContain('smsMinBytesIssue(');
    expect(assert).toContain("String(cur.channel) === 'sms'");
  });
  it('L8 예약 문안 수정 = 하한 판정이 queued 갈래 앞 · 큐 갈래는 받는 분마다 먼저 다 만든 뒤 판정 · 첫 UPDATE 보다 앞', () => {
    const ts = read('routes/campaigns.ts');
    const h = ts.slice(ts.indexOf("router.put('/:id/message'"), ts.indexOf("router.get('/:id/message/progress'"));
    expect(h.indexOf('smsMinBytesIssue(')).toBeGreaterThan(0);
    expect(h.indexOf('smsMinBytesIssue(')).toBeLessThan(h.indexOf("if (campaign.rows[0].send_phase === 'queued')"));
    expect(h.indexOf('smsRowOverLimit(recipient.msg_type, builtMessage)')).toBeGreaterThan(0);
    expect(h.indexOf('smsRowOverLimit(recipient.msg_type, builtMessage)')).toBeLessThan(h.indexOf('UPDATE ${table}'));
    expect(h.indexOf("code: 'SMS_TOO_LONG'", h.indexOf('builtByRecipient'))).toBeLessThan(h.indexOf('message_edit:'));
    // 배치 고리는 만든 값을 쓴다(조립 두 번 0)
    const loop = h.slice(h.indexOf('for (const recipient of batch)'), h.indexOf('UPDATE ${table}'));
    expect(loop).not.toContain('prepareSendMessage(');
  });
  it('워커 종결 = 채널 합계 0 이면 원인 무관 실패 · both = 문자 + 브랜드 · 길이 초과 수는 진단 칸(판정에 안 씀 · 진행 기록에 저장 · 복원)', () => {
    const w = read('utils/direct-send-worker.ts');
    expect(w).toContain("const loadedTotal = sent + (String(cfg.sendChannel || '').trim() === 'both' ? brandSent : 0);");
    expect(w).toContain("const finalStatus = loadedTotal === 0 ? 'failed' : cfg.scheduled ? 'scheduled' : 'completed';");
    expect(w).not.toMatch(/fixedCallbackBlock && sent === 0/);
    expect(w).toContain('smsTooLong = Number(lp.smsTooLong) || 0;');
    expect(w).toMatch(/const progressJson = \(\) => JSON\.stringify\(\{[^}]*smsTooLong/);
    expect(w.slice(w.indexOf('const finalStatus'), w.indexOf('const finalStatus') + 120)).not.toContain('smsTooLong');
  });
});

describe('W1 길이 초과 창 = 거짓 약속 0 · 판정 식 그대로', () => {
  it('「잘려서 수신」 · 「(잘림)」 · 「잘림 발송」 0 · 광고 판정 식 · 단추 이름', () => {
    const m = readFront('components/ChannelConvertModals.tsx');
    expect(m).not.toMatch(/잘려서|\(잘림\)|잘림 발송|truncatedBytes/);
    expect(m).toContain('const isAdBlocked = adTextEnabled && isOptOutCut;');
    expect(m).toContain('SMS로 보내기(넘는 분 제외)');
    // 좁은 폭(1118 폭 320 확인) = 낱말 단위 줄바꿈 · 단추 위아래(단추 글자 한 줄)
    expect(m).toContain('w-[440px] max-w-[calc(100vw-2rem)] overflow-hidden break-keep');
    expect(m).toContain('grid grid-cols-1 sm:grid-cols-2 gap-3');
    expect(m).toContain('90바이트를 넘는 받는 분에게는 보내지 않고');
  });
});

describe('K10 R73 다섯 자리 = 상한 + 1 · truncated · 화면 안내', () => {
  it('서버', () => {
    const ad = read('routes/admin.ts');
    const geo = ad.slice(ad.indexOf("router.get('/geo/exceptions'"), ad.indexOf("router.post('/geo/exceptions'"));
    expect(geo).toContain('LIMIT ${GEO_EXCEPTIONS_LIMIT + 1}');
    expect(geo).toMatch(/truncated/);
    const em = ad.slice(ad.indexOf("router.get('/companies/:id/agency-send-emails'"), ad.indexOf('const agencyEmailUniqueConflict'));
    expect(em).toContain('LIMIT ${AGENCY_EMAIL_USERS_LIMIT + 1}');
    expect(em).toMatch(/usersTruncated/);
    expect(ad.slice(ad.indexOf("router.get('/watch-log/events'"), ad.indexOf("router.get('/watch-log/events'") + 600)).toMatch(/truncated/);
    const wa = read('utils/watch-alert.ts');
    expect(fnBody(wa, 'export async function loadWatchIpEvents(')).toContain('LIMIT ${WATCH_IP_EVENTS_LIMIT + 1}');
    const ms = read('routes/manage-stats.ts');
    expect((ms.match(/LIMIT \$\{TEST_DETAIL_LIMIT \+ 1\}/g) || []).length).toBe(2);
    expect(ms).toMatch(/testDetailTruncated,/);
    // 옛 말없는 상한 0
    expect(geo).not.toMatch(/LIMIT 300\b/);
    expect(em).not.toMatch(/LIMIT 200\b/);
    expect(ms).not.toMatch(/LIMIT 50\b/);
  });
  it('화면', () => {
    expect(readFront('components/admin/tabs/GeoAccessTab.tsx')).toMatch(/geoExTruncated && /);
    expect(readFront('pages/AdminDashboard.tsx')).toMatch(/setGeoExTruncated\(exData\.truncated === true\)/);
    expect(readFront('components/admin/AgencyEmailSendersModal.tsx')).toMatch(/usersTruncated && /);
    expect(readFront('components/admin/WatchLogTab.tsx')).toMatch(/eventsTruncated && /);
    expect(readFront('components/manage/StatsTab.tsx')).toMatch(/detail\.testDetailTruncated \? ' · 최근 것만'/);
    expect(readFront('components/admin/IdentityStatusTab.tsx')).toMatch(/실패 기록 <span[^>]*>· 최근 30일 · 최근 \{data \? data\.failures\.length/);
  });
});

describe('Codex 구현 1R #3 — 90바이트를 넘는 SMS 검사 글 = 같은 검사 이어 보기 · 엿보기 0', () => {
  const base = { companyId: '00000000-0000-4000-8000-000000000143', userId: '00000000-0000-4000-8000-000000000144', callbackNumber: '0212345678', messageType: 'SMS', firstRecipient: { name: '김가' } as any, rendered: true };
  const keyLookups = () => (dbQuery as any).mock.calls.filter((c: any[]) => /FROM spam_filter_tests/.test(String(c[0]))).length;
  it('90 = 같은 키로 찾는다 · 91(공백 하나 더 = 해시 같음) = 키 없음(찾기 0 · 검사 전)', async () => {
    (dbQuery as any).mockClear();
    await peekSpamCheck({ ...base, messageContentSms: 'A'.repeat(45) + ' ' + 'B'.repeat(44) });
    expect(keyLookups()).toBe(1);
    (dbQuery as any).mockClear();
    expect(await peekSpamCheck({ ...base, messageContentSms: 'A'.repeat(45) + '  ' + 'B'.repeat(44) })).toBeNull();
    expect(keyLookups()).toBe(0);
    // LMS = 길이 판정 밖(같은 키로 찾는다)
    (dbQuery as any).mockClear();
    await peekSpamCheck({ ...base, messageType: 'LMS', messageContentLms: 'A'.repeat(200), subject: '제목' });
    expect(keyLookups()).toBe(1);
  });
  it('키 함수 하나(spamHashInputsOf)가 판정 · 등록 함수의 이어 보기 · 키 잠금 재조회 · 엿보기가 모두 그 키를 쓴다', () => {
    const q = read('utils/spam-test-queue.ts');
    const fn = fnBody(q, 'async function spamHashInputsOf(');
    expect(fn).toContain("!(!isLmsType && smsRowOverLimit('S', personalizedForHash))");
    expect(fnBody(q, 'export async function enqueueSpamTest(')).toContain('const checkKey: SpamCheckKey | null = reuseSameDay ? hashed.key : null;');
    expect(fnBody(q, 'export async function peekSpamCheck(')).toContain('const { key } = await spamHashInputsOf(params);');
  });
  it('AI 한줄로 검사(자기 해시) = 이어 보기 앞에서 too_long · 등록의 길이 반려도 too_long(옛: 503 「시작하지 못했어요」)', () => {
    const a = read('services/ai-line-spam.ts');
    const gate = a.indexOf("if (msgType === 'SMS' && smsRowOverLimit('S', checked)) return { state: 'too_long'");
    expect(gate).toBeGreaterThan(0);
    // ★ 1122 C153 — 이어 보기 판정 = reusableLineSpamTest 한 곳(시작 주소가 잠금 안에서 부른다) · 길이 관문은 그 호출보다 앞
    const reuseAt = a.indexOf('const reuse = hash ? await reusableLineSpamTest(');
    expect(reuseAt).toBeGreaterThan(0);
    expect(gate).toBeLessThan(reuseAt);
    expect(a).toContain("if (out.errorCode === 'SMS_TOO_LONG') return { state: 'too_long', message: out.error };");
    const cards = readFront('components/ai-line/LineResultCards.tsx');
    expect(cards).toMatch(/const HOLD[^;]*'too_long'/);
    expect(cards).toContain("case 'too_long':");
  });
});

describe('Codex 구현 1R #1 — 자동마케팅 승인 금액 = 나가는 유형(LMS 로 올린 SMS 안)', () => {
  it('회차 = 확정 함수가 LMS 로 올리면 예상 비용을 LMS 단가로 다시 셈(상한 판정 · 저장 앞) · 추천 유형은 그대로', () => {
    const co = read('utils/continuous-operator.ts');
    const at = co.indexOf("if (channelForSpam === 'SMS' && firstFinal?.msgType === 'LMS') {");
    expect(at).toBeGreaterThan(co.indexOf('const firstFinal = operatorFinalCopy(orchestratorResult, copyCtx);'));
    expect(at).toBeLessThan(co.indexOf('const capRule = capPath ? operatorCapPolicy('));
    expect(co.slice(at, at + 600)).toContain('costEstimate = Math.round(unit * recipientCount);');
    expect(co.slice(at, at + 600)).not.toMatch(/recommended/);
  });
  it('목록 = 안마다 그 유형 단가 × 대상 수(finalCosts) · 승인 카드 = 고른 안의 값과 유형 · 미리보기 = 고른 안의 유형 단가', () => {
    const co = read('utils/continuous-operator.ts');
    expect(fnBody(co, 'export async function listProposals(')).toContain('finalCosts');
    const card = readFront('components/automarketing/ProposalDecisionCard.tsx');
    expect(card).toContain('const shownCost = canApprove ? proposal.finalCosts?.[effectiveIdx] : null;');
    expect(card).toContain('발송비 · {costType}');
    expect(card).not.toContain('발송비 · {channelName}');
    const pv = readFront('components/automarketing/OperatorPreviewModal.tsx');
    expect(pv).toContain('d?.limits.unitCostByType?.[selFinal.msgType]');
    expect(read('utils/automarketing-preview.ts')).toContain('unitCostByType: { SMS: Number(costs.sms) || 0, LMS: Number(costs.lms) || 0, MMS: Number(costs.mms) || 0 },');
  });
});
