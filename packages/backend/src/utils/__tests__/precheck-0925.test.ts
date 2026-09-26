/**
 * 0925 보내기 전 점검 — 맞춤법 공용 엔진 · 대행발송 맞춤법 · 직접발송 점검 · 스팸 무료 체험 계약
 * 설계 = docs/2026-09-25-agency-spell-check-design.md · docs/2026-09-25-direct-send-precheck-design.md
 *
 * 잠그는 것
 *   1. 문자 보호 구간 — 변수·(광고)·수신거부 줄·전화번호·링크·기호를 건드리는 후보는 버린다 · 보통 오타는 받는다
 *   2. 단문 90바이트 — 고친 뒤 91바이트면 blocked · 장문은 막지 않는다 · 화면 거울도 같은 규칙
 *   3. 대행 결과는 문안 버전에 묶인다 · 실패는 null · 승인 안내 줄(0이면 없음 · 줄표 0)
 *   4. 워커 A 순서(테스트 문자 → 검사 → 승인 안내) · 자동 교정 0 · 문안 수정이 결과를 지운다
 *   5. 스팸 체험 — 차감을 건너뛰고 잠금 안에서 세고 넣는다 · 청구·비용 집계 4곳이 같은 조건으로 뺀다
 *   6. 고치기 거울(서버 ↔ 화면 본체 글자 동일) · 스팸 판정 = 서버(기대 테스트폰 채움) · 맞춤법 한도(1분 창 · 월 5회 · 예약 수명 · 표 없음 폴백)
 *   7. AI 호출 한도 면제는 문자 맞춤법만(SNS 동작 불변)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ── DB 흉내(맞춤법 한도 예약) ──
const db = vi.hoisted(() => ({
  used: 0,
  missing: false,
  inserted: 0,
  doneRows: 1,
  calls: [] as string[],
}));
vi.mock('../../config/database', () => {
  const client = {
    query: vi.fn(async (sql: string) => {
      db.calls.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
      if (/COUNT\(\*\)::int AS used FROM spell_check_uses/.test(sql)) {
        if (db.missing) { const e: any = new Error('relation "spell_check_uses" does not exist'); e.code = '42P01'; throw e; }
        return { rows: [{ used: db.used }] };
      }
      if (/INSERT INTO spell_check_uses/.test(sql)) { db.inserted += 1; return { rows: [{ id: 77 }] }; }
      if (/SET status = 'done'/.test(sql)) { db.calls.push('DONE ' + sql.replace(/\s+/g, ' ')); return { rows: [], rowCount: db.doneRows }; }
      if (/SET status = 'failed'/.test(sql)) { db.calls.push('FAILED'); return { rows: [], rowCount: 1 }; }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return {
    query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
    default: { connect: vi.fn(async () => client), query: vi.fn(async () => ({ rows: [] })) },
  };
});
vi.mock('../../services/ai', () => ({ callAIWithFallback: vi.fn(), withCopyRules: (s: string) => s }));

import { judgeSpellCandidates, applySpellIssue } from '../spell-check';
import { smsSpellProtectedSpans, markSmsByteBlocked, dropLinkChangingIssues, SMS_SPELL_BYTE_LIMIT } from '../sms-spell-check';
import { readAgencySpell } from '../agency-send-spell';
import { buildPassedNotify } from '../agency-send-notify';
import { eucKrByteLength } from '../message-byte';
import { judgeSpamVerdict, spamBillableTestSql, withExpectedSpamDevices, SPAM_TRIAL_LIMIT, SPAM_TRIAL_SOURCE } from '../spam-trial';
import {
  AI_CALL_LIMIT_EXEMPT_SOURCES, aiLimitCountedSql, isAiCallLimitExempt,
} from '../ai-rate-limit';
import { AGENCY_SPELL_SOURCE } from '../agency-send-spell';
import {
  DIRECT_SPELL_SOURCE, finishSpellUse, reserveSpellUse, resetSpellMinuteWindow, takeSpellMinuteSlot, SPELL_FREE_MONTHLY_LIMIT, SPELL_PER_MINUTE_LIMIT,
} from '../spell-check-quota';
import {
  markSpellRowFixed, markSpellRowsByteBlocked, isSendWarnDismissed, dismissSendWarn,
  type SpellRow,
} from '../../../../frontend/src/utils/send-checks';

const SRC = resolve(__dirname, '../..');
const FRONT = resolve(__dirname, '../../../../frontend/src');
// 작업 폴더는 core.autocrlf로 CRLF가 섞인다 — 비교 전에 줄 끝을 맞춘다
const read = (p: string) => readFileSync(resolve(SRC, p), 'utf8').replace(/\r\n/g, '\n');
const readFront = (p: string) => readFileSync(resolve(FRONT, p), 'utf8').replace(/\r\n/g, '\n');

/** `export function name(...) {...}` 본체(시그니처 포함 · 첫 줄부터 닫는 `\n}`까지) */
function fnBody(src: string, name: string): string {
  const i = src.indexOf(`export function ${name}(`);
  expect(i, `${name} 없음`).toBeGreaterThanOrEqual(0);
  const j = src.indexOf('\n}\n', i);
  return src.slice(i, j + 2);
}

describe('1. 문자 보호 구간', () => {
  const text = '(광고)[한줄로] %이름%님 신메뉴 오픈 했어요! 금요일까지 10% 할인 적용 됬어요.\n'
    + '【행사】 문의 010-0000-0000 · hanjul.ai/menu\n무료거부0807196700';
  const spans = smsSpellProtectedSpans(text, ['한줄로']);
  const judge = (before: string, after: string) => judgeSpellCandidates(text, [{ before, after, reason: '테스트' }], spans);

  it('변수 · (광고) · 수신거부 줄 · 전화번호 · 링크 · 기호 · 회사명을 건드리면 버린다', () => {
    expect(judge('%이름%님', '%이 름%님')).toEqual([]);
    expect(judge('(광고)[한줄로]', '(광 고)[한줄로]')).toEqual([]);
    expect(judge('무료거부0807196700', '무료 거부0807196700')).toEqual([]);
    expect(judge('010-0000-0000', '010-0000-0001')).toEqual([]);
    expect(judge('hanjul.ai/menu', 'hanjul.ai/menus')).toEqual([]);
    expect(judge('【행사】', '[행사]')).toEqual([]);
    expect(judge('[한줄로]', '[한 줄로]')).toEqual([]);
  });
  it('Codex 1R — 문안 맨 끝·맨 앞 링크에 글자를 붙이는 후보도 버린다 · 교정 뒤 링크가 다르면 버린다', () => {
    const tail = '신메뉴 보러 가기 hanjul.ai/menu';
    const tailSpans = smsSpellProtectedSpans(tail, []);
    expect(judgeSpellCandidates(tail, [{ before: 'hanjul.ai/menu', after: 'hanjul.ai/menus' }], tailSpans)).toEqual([]);
    const head = 'hanjul.ai/menu 에서 보세요';
    expect(judgeSpellCandidates(head, [{ before: 'hanjul.ai/menu', after: 'www.hanjul.ai/menu' }], smsSpellProtectedSpans(head, []))).toEqual([]);
    // 두 번째 그물: 경계 판정을 지나도 링크 문자열이 바뀌면 버린다
    const issue = { id: 'x', start: tail.length - 14, end: tail.length, before: 'hanjul.ai/menu', after: 'hanjul.ai/menus', kind: 'typo' as const, reason: '' };
    expect(dropLinkChangingIssues(tail, [issue])).toEqual([]);
    const ok = { id: 'y', start: 0, end: 3, before: '신메뉴', after: '신 메뉴', kind: 'spacing' as const, reason: '' };
    expect(dropLinkChangingIssues(tail, [ok])).toHaveLength(1);
  });
  it('보통 오타·띄어쓰기는 받는다', () => {
    const typo = judge('적용 됬어요', '적용됐어요');
    expect(typo).toHaveLength(1);
    const spacing = judge('오픈 했어요', '오픈했어요');
    expect(spacing).toHaveLength(1);
    expect(spacing[0].kind).toBe('spacing');
  });
});

describe('2. 단문 90바이트', () => {
  const text = '사과하나 ' + '가'.repeat(40) + '.';
  it('만든 문안이 정확히 90바이트다(시험 전제)', () => {
    expect(eucKrByteLength(text)).toBe(SMS_SPELL_BYTE_LIMIT);
  });
  const issues = judgeSpellCandidates(text, [{ before: '사과하나', after: '사과 하나' }], []);
  it('고친 뒤 91바이트면 blocked · 장문(null)은 막지 않는다', () => {
    expect(issues).toHaveLength(1);
    expect(markSmsByteBlocked(text, issues, 90)[0].blocked).toBe('sms_bytes');
    expect(markSmsByteBlocked(text, issues, null)[0].blocked).toBeUndefined();
  });
  it('화면 거울 — 한도를 넘고 늘어나는 고치기만 잠근다(이미 넘은 글에서 줄어드는 고치기는 연다)', () => {
    const rows: SpellRow[] = issues.map((issue) => ({ issue, status: 'open' }));
    const measure = (t: string) => eucKrByteLength(t);
    expect(markSpellRowsByteBlocked(text, rows, measure)[0].issue.blocked).toBe('sms_bytes');
    expect(markSpellRowsByteBlocked(text, rows, null)[0].issue.blocked).toBeUndefined();
    const over = '사과 하나 ' + '가'.repeat(50);
    const shrink = judgeSpellCandidates(over, [{ before: '사과 하나', after: '사과하나' }], []);
    const view = markSpellRowsByteBlocked(over, shrink.map((issue) => ({ issue, status: 'open' as const })), measure);
    expect(view[0].issue.blocked).toBeUndefined();
  });
  it('고친 줄 뒤쪽 위치를 민다(화면 거울)', () => {
    const t = '오픈 했어요 적용 됬어요';
    const found = judgeSpellCandidates(t, [{ before: '오픈 했어요', after: '오픈했어요' }, { before: '적용 됬어요', after: '적용됐어요' }], []);
    const rows: SpellRow[] = found.map((issue) => ({ issue, status: 'open' }));
    const next = applySpellIssue(t, found[0]);
    const moved = markSpellRowFixed(rows, found[0]);
    expect(moved[0].status).toBe('fixed');
    expect(next.slice(moved[1].issue.start, moved[1].issue.end)).toBe('적용 됬어요');
  });
});

describe('3. 대행 결과 · 안내 문구', () => {
  const issues = [{ id: '0-2', start: 0, end: 2, before: 'a', after: 'b', kind: 'typo', reason: '' }];
  it('버전이 같을 때만 · 실패는 null', () => {
    expect(readAgencySpell({ content_version: 3, spell_check: { version: 3, issues, failed: false } })).toHaveLength(1);
    expect(readAgencySpell({ content_version: 4, spell_check: { version: 3, issues, failed: false } })).toBeNull();
    expect(readAgencySpell({ content_version: 3, spell_check: { version: 3, issues: [], failed: true } })).toBeNull();
    expect(readAgencySpell({ content_version: 3 })).toBeNull();
  });
  it('0곳이면 줄이 없고, N곳이면 한 줄 · 줄표·이모지 0', () => {
    const base = { label: '가을 행사', whenText: '9월 26일 10:00', count: 100 };
    expect(buildPassedNotify(base)).not.toContain('맞춤법');
    expect(buildPassedNotify({ ...base, spellCount: 0 })).not.toContain('맞춤법');
    const two = buildPassedNotify({ ...base, spellCount: 2, approveUrl: 'https://example.invalid/a' });
    expect(two).toContain('맞춤법을 확인할 곳이 2곳 있습니다. 승인 전에 확인해 주세요.');
    const shifted = buildPassedNotify({ ...base, spellCount: 1, originalWhenText: '9월 26일 09:00' });
    expect(shifted).toContain('맞춤법을 확인할 곳이 1곳');
    for (const t of [two, shifted]) {
      expect(t).not.toContain('—');
      expect(t).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});

describe('4. 워커 A 순서 · 자동 교정 0 · 문안 수정이 결과를 지운다', () => {
  const worker = read('utils/agency-send-worker.ts');
  const first = worker.slice(worker.indexOf('async function runFirstTest('), worker.indexOf('async function runFinalTest('));
  it('테스트 문자 → 맞춤법 → 승인 안내', () => {
    const a = first.indexOf('await sendManagerTest({');
    const b = first.indexOf('await runAgencySpellAfterTest({');
    const c = first.indexOf('buildPassedNotify({ label, whenText, count, originalWhenText, spellCount })');
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    // 막힌 분기(test_failed)에는 검사가 없다
    const failed = first.slice(first.indexOf('if (!passed) {'), first.indexOf('const passedAt = new Date();'));
    expect(failed).not.toContain('runAgencySpellAfterTest');
    // 당일 재검사(워커 B)는 검사하지 않는다
    const second = worker.slice(worker.indexOf('async function runFinalTest('), worker.indexOf('async function dispatchToPipeline('));
    expect(second).not.toContain('runAgencySpellAfterTest');
  });
  it('Codex 1R — 안내 건수는 안내 직전 최신 저장값에서 센다(훅 반환값을 믿지 않는다)', () => {
    const iFresh = first.indexOf('const linkRow = (await freshLinkFields(row.id)) || row;');
    const iCount = first.indexOf('const spellCount = await readAgencySpellCount(row.id);');
    const iNotify = first.indexOf('buildPassedNotify({ label, whenText, count, originalWhenText, spellCount })');
    expect(iFresh).toBeGreaterThan(0);
    expect(iCount).toBeGreaterThan(iFresh);
    expect(iNotify).toBeGreaterThan(iCount);
    expect(first).not.toMatch(/const spellCount = await runAgencySpellAfterTest/);
  });
  it('Codex 1R·2R — 20초 상한은 AI 호출(보호 낱말 조회 포함)에 · DB 단계는 이웃과 같은 취급 · 이력은 기다리지 않는다', () => {
    const spell = read('utils/agency-send-spell.ts');
    const check = spell.slice(spell.indexOf('export async function checkAgencySpelling('), spell.indexOf('export function readAgencySpell('));
    expect(check.indexOf('loadSmsSpellProtectedWords')).toBeGreaterThan(check.indexOf('const run = (async () => {'));
    expect(check).toContain('Promise.race([run, timeout])');
    const hook = spell.slice(spell.indexOf('export async function runAgencySpellAfterTest('), spell.indexOf('export async function readAgencySpellCount('));
    expect(hook).toContain('void input.logEvent(');
    expect(hook).not.toContain('pool.connect');
    expect(hook).not.toMatch(/SET LOCAL/);
  });
  it('검사 층은 문안을 쓰지 않는다 · 저장은 버전 조건', () => {
    const spell = read('utils/agency-send-spell.ts');
    expect(spell).not.toMatch(/current_content\s*=/);
    expect(spell).toMatch(/WHERE id = \$2::uuid AND content_version = \$3/);
  });
  it('문안 수정 UPDATE가 결과를 지운다(컬럼이 있을 때)', () => {
    const route = read('routes/agency-send.ts');
    expect(route).toContain("const clearSpell = (await hasAgencySpellColumn()) ? 'spell_check = NULL, ' : '';");
    expect(route).toContain('SET ${clearSpell}original_content = $1');
  });
  it('접수 화면 사전 검사 라우트가 상세(/:id)보다 먼저 선다', () => {
    const route = read('routes/agency-send.ts');
    expect(route.indexOf("router.post('/spell-check'")).toBeGreaterThan(0);
    expect(route.indexOf("router.post('/spell-check'")).toBeLessThan(route.indexOf("router.get('/:id'"));
  });
  it('이벤트 표에 spell_checked 등재', () => {
    expect(readFront('components/agency/AgencyEventLog.tsx')).toContain("spell_checked: '맞춤법을 확인했습니다'");
  });
});

describe('5. 스팸 무료 체험 · 청구 제외', () => {
  it('상수 · 조건 조각', () => {
    expect(SPAM_TRIAL_LIMIT).toBe(3);
    expect(SPAM_TRIAL_SOURCE).toBe('trial');
    // ★ 2026-09-26 F49: 무료 자동 검사(auto_ai_free)도 함께 뺀다
    expect(spamBillableTestSql('t')).toBe("COALESCE(t.source, 'manual') NOT IN ('trial', 'auto_ai_free')");
  });
  const route = read('routes/spam-filter.ts');
  it('체험은 차감하지 않는다 · 잠금 안에서 세고 넣는다 · 한 통도 못 나가면 되돌린다', () => {
    const iDeduct = route.indexOf('prepaidDeduct(companyId, spamSendCount');
    const iGuard = route.lastIndexOf('if (!trialMode) {', iDeduct);
    expect(iGuard).toBeGreaterThan(0);
    expect(iDeduct - iGuard).toBeLessThan(200);
    const tx = route.slice(route.indexOf("await client.query('BEGIN');"), route.indexOf("await client.query('COMMIT');"));
    expect(tx).toContain('SPAM_TRIAL_LOCK_SQL');
    expect(tx).toContain('countSpamTrialsInTx');
    expect(tx).toMatch(/used >= SPAM_TRIAL_LIMIT/);
    expect(tx).toContain('SPAM_TRIAL_SOURCE');
    expect(route).toMatch(/if \(trialMode && sentCount === 0\)/);
  });
  it('청구·비용 집계 4곳이 같은 조건으로 뺀다 · 테스트 결과 화면 비용 0', () => {
    const agg = read('utils/send-usage-aggregation.ts');
    expect((agg.match(/\$\{spamBillableTestSql\('t'\)\}/g) || []).length).toBe(2);
    expect(read('routes/manage-stats.ts')).toContain("WHERE t.company_id = $1 AND ${spamBillableTestSql('t')} ${sfDateWhere}");
    expect(read('routes/admin.ts')).toContain("WHERE t.company_id = $1 AND ${spamBillableTestSql('t')} ${sfDateWhere}");
    const camp = read('routes/campaigns.ts');
    expect(camp).toContain('const isTrial = r.source === SPAM_TRIAL_SOURCE;');
    // ★ 2026-09-26 F49: 비용은 청구 제외 판정 CT(체험 + 무료 자동 검사)를 따른다
    expect(camp).toContain('if (isCompleted && isSpamTestBillable(r.source)) {');
  });
  it('Codex 1R — 최근 검사 조회는 실제로 보낸 종류의 결과가 있는 검사만 인정한다', () => {
    const rc = route.slice(route.indexOf("router.post('/recent-check'"), route.indexOf("router.get('/tests'"));
    expect(rc).toContain("const sentType = isLms ? 'LMS' : 'SMS';");
    expect(rc).toContain('AND EXISTS (SELECT 1 FROM spam_filter_test_results r WHERE r.test_id = t.id AND r.message_type = $4)');
    expect(rc).toContain('WHERE test_id = $1 AND message_type = $2 ORDER BY carrier');
  });
  it('Codex 4R·5R — 결과 행 = 실제로 보낸 건(보낼 때마다 한 행) · 판정 자리에서 지금 테스트폰으로 채운다', () => {
    const send = route.slice(route.indexOf('let sentCount = 0;'), route.indexOf('// 7) 15초 폴링'));
    expect(send).not.toContain('unnest(');
    expect(send.indexOf('INSERT INTO spam_filter_test_results')).toBeLessThan(send.indexOf('await insertTestSmsQueue('));
    const rc = route.slice(route.indexOf("router.post('/recent-check'"), route.indexOf("router.get('/tests'"));
    expect(rc).toContain('SELECT carrier, phone FROM spam_filter_devices WHERE is_active = true');
    expect(rc).toContain('const rows = withExpectedSpamDevices(results.rows, devices.rows);');
    expect(rc).toContain("judgeSpamVerdict(expired ? 'completed' : String(test.status), rows)");
    expect(rc).not.toMatch(/judgeSpamVerdict\([^)]*results\.rows\)/);
  });
  it('일부 통신사 결과만 있으면 통과가 아니다(진행 중 = running · 끝남 = warn + 결과 없는 통신사)', () => {
    const devices = [{ carrier: 'SKT', phone: '010-0000-0001' }, { carrier: 'KT', phone: '01000000002' }, { carrier: 'LGU', phone: '01000000003' }];
    const partial = [{ carrier: 'SKT', phone: '01000000001', received: true, result: 'pass' }];
    const filled = withExpectedSpamDevices(partial, devices);
    expect(filled.map((r) => r.carrier)).toEqual(['SKT', 'KT', 'LGU']);
    expect(judgeSpamVerdict('active', filled)).toBe('running');
    expect(judgeSpamVerdict('completed', filled)).toBe('warn');
    // 전부 있으면 채우지 않는다(정상 경로 불변)
    const full = devices.map((d) => ({ carrier: d.carrier, phone: d.phone, received: true, result: 'pass' }));
    expect(withExpectedSpamDevices(full, devices)).toHaveLength(3);
    expect(judgeSpamVerdict('completed', withExpectedSpamDevices(full, devices))).toBe('pass');
    // Codex 6R — 같은 번호가 통신사를 옮겼으면 새 통신사는 결과 없음
    const moved = [{ carrier: 'SKT', phone: '01000000001' }, { carrier: 'LGU', phone: '01000000002' }];
    const before = [
      { carrier: 'SKT', phone: '01000000001', received: true, result: 'pass' },
      { carrier: 'KT', phone: '01000000002', received: true, result: 'pass' },
    ];
    const f2 = withExpectedSpamDevices(before, moved);
    expect(f2.map((r) => r.carrier)).toEqual(['SKT', 'KT', 'LGU']);
    expect(judgeSpamVerdict('completed', f2)).toBe('warn');
  });
  it('고치기 거울 — 서버와 화면 본체가 글자까지 같다 · 스팸 판정은 화면에 본체가 없다(서버 값만)', () => {
    expect(fnBody(readFront('utils/send-checks.ts'), 'applySpellIssue')).toBe(fnBody(read('utils/spell-check.ts'), 'applySpellIssue'));
    expect(readFront('utils/send-checks.ts')).not.toContain('export function judgeSpamVerdict(');
  });
  it('판정 표', () => {
    const r = (carrier: string, received: boolean, result: string | null) => ({ carrier, received, result });
    expect(judgeSpamVerdict('completed', [r('SKT', true, 'pass'), r('KT', false, 'blocked')])).toBe('blocked');
    expect(judgeSpamVerdict('active', [r('SKT', true, 'pass'), r('KT', true, 'pass')])).toBe('pass');
    expect(judgeSpamVerdict('active', [r('SKT', true, 'pass'), r('KT', false, null)])).toBe('running');
    expect(judgeSpamVerdict('completed', [r('SKT', true, 'pass'), r('KT', false, 'timeout')])).toBe('warn');
  });
});

describe('6. 맞춤법 한도', () => {
  beforeEach(() => { db.used = 0; db.missing = false; db.inserted = 0; db.doneRows = 1; db.calls = []; resetSpellMinuteWindow(); });
  it('1분 창 = 사용자당 6회', () => {
    const now = 1_000_000;
    for (let i = 0; i < SPELL_PER_MINUTE_LIMIT; i += 1) expect(takeSpellMinuteSlot('c:u', now + i)).toBe(true);
    expect(takeSpellMinuteSlot('c:u', now + 10)).toBe(false);
    expect(takeSpellMinuteSlot('c:u', now + 60_001)).toBe(true);
  });
  it('미가입 월 5회 — 잠금 뒤 세고, 다 쓰면 넣지 않는다', async () => {
    db.used = SPELL_FREE_MONTHLY_LIMIT;
    const r = await reserveSpellUse({ companyId: 'c1', userId: 'u1', monthlyLimit: SPELL_FREE_MONTHLY_LIMIT });
    expect(r).toMatchObject({ ok: false, code: 'SPELL_FREE_EXHAUSTED' });
    expect(db.inserted).toBe(0);
    expect(db.calls.findIndex((c) => c.startsWith('SELECT pg_advisory_xact_lock'))).toBeLessThan(db.calls.findIndex((c) => c.startsWith('SELECT COUNT(*)::int')));
  });
  it('남았으면 예약 행을 넣는다', async () => {
    db.used = 2;
    const r = await reserveSpellUse({ companyId: 'c1', userId: 'u1', monthlyLimit: SPELL_FREE_MONTHLY_LIMIT });
    expect(r).toEqual({ ok: true, useId: 77 });
    expect(db.inserted).toBe(1);
  });
  it('Codex 4R·5R — 수명 한 벌: 세는 자리 = done + 살아 있는 reserved · 완료도 살아 있을 때만 · 문장 시각', () => {
    const q = read('utils/spell-check-quota.ts');
    expect(q).toContain("const SPELL_LEASE_ALIVE_SQL = `created_at > clock_timestamp() - INTERVAL '70 minutes'`;");
    expect(q).toContain("const SPELL_COUNTED_SQL = `(status = 'done' OR (status = 'reserved' AND ${SPELL_LEASE_ALIVE_SQL}))`;");
    expect((q.match(/AND \$\{SPELL_COUNTED_SQL\}`/g) || []).length).toBe(2);
    expect(q).not.toContain("status <> 'failed'");
    expect(q).not.toMatch(/NOW\(\) - INTERVAL/);
  });
  it('완료: 회사 잠금 뒤 살아 있는 예약만 done · 수명이 지났으면 failed 로 닫고 false', async () => {
    db.doneRows = 1;
    expect(await finishSpellUse(77, 'c1', { failed: false, issueCount: 3 })).toBe(true);
    const iLock = db.calls.findIndex((c) => c.startsWith('SELECT pg_advisory_xact_lock'));
    const iDone = db.calls.findIndex((c) => c.startsWith('DONE'));
    expect(iLock).toBeGreaterThanOrEqual(0);
    expect(iDone).toBeGreaterThan(iLock);
    expect(db.calls[iDone]).toContain("AND created_at > clock_timestamp() - INTERVAL '70 minutes'");
    expect(db.calls).not.toContain('FAILED');
    db.calls = []; db.doneRows = 0;
    expect(await finishSpellUse(77, 'c1', { failed: false, issueCount: 3 })).toBe(false);
    expect(db.calls).toContain('FAILED');
    expect(await finishSpellUse(null, 'c1', { failed: false, issueCount: 0 })).toBe(true);
    expect(await finishSpellUse(77, 'c1', { failed: true, issueCount: 0 })).toBe(false);
  });
  it('Codex 5R — 무료 회사는 done 으로 기록된 검사만 결과를 준다', () => {
    const r = read('routes/send-checks.ts');
    expect(r).toContain('const recorded = await finishSpellUse(useId, companyId, { failed: r.failed, issueCount: r.issues.length });');
    expect(r).toContain('if (!r.failed && !recorded && !paid) return res.status(502).json(SPELL_FAILED_BODY);');
  });
  it('Codex 4R — 사용량 조회가 실패해도 끝난 검사 결과는 돌려준다', () => {
    const r = read('routes/send-checks.ts');
    const spell = r.slice(r.indexOf("router.post('/spell'"));
    expect(spell).toContain('const usage = await readSpellUsage(companyId).catch(');
    expect(spell).toContain('spell: usage ? spellView(paid, usage) : null,');
    expect(spell.indexOf('useId = null;')).toBeLessThan(spell.indexOf('const usage = await readSpellUsage'));
  });
  it('표가 없으면 요금제 회사는 기록 없이 진행 · 미가입은 막는다(fail-closed)', async () => {
    db.missing = true;
    expect(await reserveSpellUse({ companyId: 'c1', userId: null, monthlyLimit: null })).toEqual({ ok: true, useId: null });
    expect(await reserveSpellUse({ companyId: 'c1', userId: null, monthlyLimit: 5 })).toEqual({ ok: false, code: 'DB_MIGRATION_PENDING' });
  });
});

describe('7. 월 AI 호출 한도 면제 = 문자 맞춤법만 · 검사와 셈이 같은 목록(★Harold B안)', () => {
  it('면제 목록 = 직접발송·대행 맞춤법 source 둘 · 이름은 CT-55가 소유', () => {
    expect([...AI_CALL_LIMIT_EXEMPT_SOURCES]).toEqual([DIRECT_SPELL_SOURCE, AGENCY_SPELL_SOURCE]);
    expect(isAiCallLimitExempt(DIRECT_SPELL_SOURCE)).toBe(true);
    expect(isAiCallLimitExempt(AGENCY_SPELL_SOURCE)).toBe(true);
    for (const other of ['sns-typo-check', 'help-ask', 'agency-send-refine', 'unknown', '', null, undefined]) {
      expect(isAiCallLimitExempt(other as any)).toBe(false);
    }
  });
  it('관문은 목록으로 판정한다(호출마다 붙이는 면제 표시 없음)', () => {
    const ai = read('services/ai.ts');
    expect(ai).toMatch(/const \{ checkAiRateLimit, isAiCallLimitExempt \} = await import\('\.\.\/utils\/ai-rate-limit'\);\s*if \(!isAiCallLimitExempt\(params\.source\)\) \{\s*await checkAiRateLimit\(params\.companyId\);/);
    for (const f of ['services/ai.ts', 'utils/spell-check.ts', 'utils/sms-spell-check.ts', 'utils/sns-spell-check.ts']) {
      expect(read(f)).not.toContain('rateLimitExempt');
    }
  });
  it('셈 조각 — 면제 source 를 빼고 NULL source 옛 행은 센다', () => {
    expect(aiLimitCountedSql()).toBe("COALESCE(source, '') NOT IN ('direct-send-spell', 'agency-send-spell')");
  });
  it('한도와 비교되는 숫자 전부가 같은 조각을 쓴다 · 출처별 분포는 그대로 보인다', () => {
    const rl = read('utils/ai-rate-limit.ts');
    const monthly = rl.slice(rl.indexOf('export async function getMonthlyUsage('), rl.indexOf('export async function checkAiRateLimit('));
    expect(monthly).toContain('AND ${aiLimitCountedSql()}`');
    const daily = rl.slice(rl.indexOf('export async function getDailyUsage('), rl.indexOf('export async function getModelBreakdown('));
    expect(daily).toContain('(COUNT(*) FILTER (WHERE ${aiLimitCountedSql()}))::int AS count');
    expect(daily).toContain('COALESCE(SUM(cost_won), 0)::int AS cost');
    const breakdown = rl.slice(rl.indexOf('export async function getModelBreakdown('));
    expect(breakdown).not.toContain('aiLimitCountedSql');
    const usage = read('routes/ai-usage.ts');
    const prev = usage.slice(usage.indexOf('const prevMonthRes = await query('), usage.indexOf('const prevMonthCalls ='));
    expect(prev).toContain('AND ${aiLimitCountedSql()}`');
    // 라우트에 ai_call_log 를 직접 세는 곳이 전월 한 곳뿐이다(새로 생기면 같은 조각을 쓰는지 여기서 걸린다)
    expect((usage.match(/FROM ai_call_log/g) || []).length).toBe(1);
  });
});

describe('8. 화면 계약', () => {
  const panel = readFront('components/DirectSendPanel.tsx');
  const warn = readFront('components/direct-send/SendSpamWarnModal.tsx');
  it('옛 보조 버튼 3개·옵션 카드가 사라지고 점검 칸 · 발송 바 · 경고 창이 선다', () => {
    expect(panel).not.toContain('<span>스팸필터테스트</span>');
    expect(panel).not.toContain('<span>AI 다듬기</span>');
    expect(panel).not.toContain('ds-optcard');
    expect(panel).toContain('<DirectCheckTiles');
    expect(panel).toContain('<footer className="ds-modal__foot">');
    expect(panel).toContain('<SendSpamWarnModal');
    expect(panel).toContain('<TrialUpsellModal');
    expect(panel).toContain('await decideSendWarn()');
  });
  it('경고 창 — 통신사 스팸 서비스 이름 · 비용 청구 안내 · 24시간 다시 보지 않기(안 한 경우에만)', () => {
    expect(warn).toContain('SKT T스팸필터링');
    expect(warn).toContain('KT 스팸차단');
    expect(warn).toContain('LG U+ 스팸차단');
    expect(warn).toMatch(/variant === 'none' && \(\s*<label className="ds-warn-dismiss">/);
  });
  it('★Harold 0925 A안 — 안내는 그림 세 칸(걸림 → 스팸함 → 비용 청구) · 긴 문단 없음 · 단어 단위 줄바꿈', () => {
    const flow = warn.slice(warn.indexOf('<div className="ds-warn-flow"'), warn.indexOf("{variant === 'none' && (\n            <>"));
    expect(flow).toContain("'스팸 차단에 걸림'");
    expect(flow).toContain('<b>고객 스팸함으로</b>');
    expect(flow).toContain('<b>비용은 청구</b>');
    expect((flow.match(/className="ds-warn-arrow"/g) || []).length).toBe(2);
    expect(warn).not.toContain('<div className="ds-warn-card">');
    const css = readFront('styles/direct-send.css');
    expect(css).toMatch(/\.ds-warn-step b \{[^}]*word-break: keep-all;/);
    expect(css).toMatch(/\.ds-warn-step small \{[^}]*word-break: keep-all;/);
  });
  it('다시 보지 않기 — 사용자별 24시간', () => {
    const store = new Map<string, string>();
    (globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
    const t0 = 1_700_000_000_000;
    expect(isSendWarnDismissed('u1', t0)).toBe(false);
    dismissSendWarn('u1', t0);
    expect(isSendWarnDismissed('u1', t0 + 1000)).toBe(true);
    expect(isSendWarnDismissed('u2', t0 + 1000)).toBe(false);
    expect(isSendWarnDismissed('u1', t0 + 24 * 60 * 60 * 1000 + 1)).toBe(false);
    delete (globalThis as any).localStorage;
  });
  it('창 = 전체 화면(★Harold 0925) · 본문 칸 상한은 모바일만', () => {
    const css = readFront('styles/direct-send.css');
    const modal = css.slice(css.indexOf('.ds-modal {'), css.indexOf('.ds-modal__header {'));
    expect(modal).toContain('width: 100vw;');
    expect(modal).toContain('height: 100vh;');
    expect(modal).not.toMatch(/max-height|min-height/);
    expect(css).toContain('.ds-scope { --ds-editor-cap: none; }');
    expect(css).toContain('.ds-scope { --ds-editor-cap: 420px; }');
  });
  it('★Harold 0925 — 스팸 검사 사용자 문구에 "테스트폰" 0(검사 방식을 드러내지 않는다 · 주석 제외)', () => {
    const codeLines = (src: string) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
    const files: Array<[string, string]> = [
      ['front', 'components/SpamFilterTestModal.tsx'],
      ['front', 'components/direct-send/DirectCheckTiles.tsx'],
      ['front', 'components/direct-send/SendSpamWarnModal.tsx'],
      ['front', 'components/direct-send/TrialUpsellModal.tsx'],
      ['back', 'content/feature-catalog.ts'],
      ['back', 'routes/spam-filter.ts'],
      ['back', 'utils/spam-test-queue.ts'],
    ];
    for (const [side, f] of files) {
      const hits = codeLines(side === 'front' ? readFront(f) : read(f)).filter((l) => l.includes('테스트폰'));
      expect(hits, f).toEqual([]);
    }
    expect(readFront('components/SpamFilterTestModal.tsx')).toContain('{carrierLabel(c)} 스팸 검사</b>');
  });
  it('★Harold 0925 — 빈 수신자 목록의 업로드 칸이 목록 칸 안에 들어간다(잘림 없음)', () => {
    const css = readFront('styles/direct-send.css');
    const empty = css.slice(css.indexOf('.ds-list-empty {'), css.indexOf('.ds-list-empty > .ds-dropzone'));
    expect(empty).toContain('min-height: 0;');
    expect(empty).toContain('align-items: stretch;');
    expect(css).toContain('.ds-list-empty > .ds-dropzone { flex: 1; min-height: 0;');
  });
  it('모델명 0 · native dialog 0(새 화면 파일)', () => {
    const files = [
      'components/direct-send/DirectCheckTiles.tsx', 'components/direct-send/DirectSpellModal.tsx',
      'components/direct-send/SendSpamWarnModal.tsx', 'components/direct-send/SplitSendPopover.tsx',
      'components/direct-send/TrialUpsellModal.tsx', 'components/SpamFilterTestModal.tsx', 'utils/send-checks.ts',
    ];
    for (const f of files) {
      const t = readFront(f);
      expect(t, f).not.toMatch(/\b(Opus|Sonnet|Haiku|GPT|Claude|Anthropic)\b/);
      expect(t, f).not.toMatch(/\b(alert|confirm|prompt)\(/);
    }
  });
});
