// replaces: none
/**
 * C133 F4 나눠 보내기 — DB 를 읽지 않는 판정(★ 2026-11-14 · 설계서 docs/2026-11-13-hanjul-v3-design.md §6 · §18 「배포 C-3」)
 *   1. 문안 자격 = 이름 변수만 · 모든 주소를 새로 줄일 수 있다 · 주소 안 변수 없음(화면 잠금 이유 = 이 글자)
 *   2. 인원 나누기 = 문안별 균등 · 나눌 수 없는 수는 막는다
 *   3. 판정 시각 = 기다림 뒤 · 광고면 발송 창 안으로
 *   4. 승자 = 신뢰 구간이 겹치지 않을 때만 · 아니면 첫 문안
 *   5. 주소 엄격 줄이기 = 전부 아니면 실패 · 자리로 바꾼다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../config/database', () => ({ query: db.query, pool: {}, mysqlQuery: vi.fn() }));

import {
  splitNameVarNames, splitVariantIssue, splitVariantsIssue, splitBytesIssue, splitSizes, splitDecideAt, judgeSplit, splitVariantLabel,
  SPLIT_PCTS, SPLIT_WAITS, isSplitPct, isSplitWait, isSplitMsgType,
  rememberClosedStart, SPLIT_CLOSED_KEEP_MS, SPLIT_CLOSED_MAX,
} from '../campaign-split-rules';
import { listUrlsForTracking, shortenUrlsStrict, shortenedLengthPreview, SHORT_URL_BASE } from '../short-url';
import { sendableAt } from '../send-time-util';
import { FIELD_MAP } from '../standard-field-map';
import { splitStartMachine, splitStartEmpty, splitStartLocked, type SplitStartAnswer, type SplitStartState } from '../../../../frontend/src/utils/split-start';

const LINK = 'https://shop.example/sale';
const ok = (text: string, subject = '제목') => ({ text, subject });

beforeEach(() => {
  db.query.mockReset();
  db.query.mockResolvedValue({ rows: [], rowCount: 1 });
  delete process.env.DM_SHORT_LINK_BASE;
});

describe('문안 자격(화면 잠금 이유 = 서버 시작 관문)', () => {
  it('이름 변수 = 직접발송 워커가 적재 표의 이름으로 채우는 그 이름들(FIELD_MAP name)', () => {
    const f = FIELD_MAP.find((x) => x.fieldKey === 'name')!;
    expect(splitNameVarNames().sort()).toEqual([f.displayName, ...(f.aliases || [])].sort());
    expect(splitNameVarNames().sort()).toEqual(['고객명', '성함', '이름']);
  });
  it('쓸 수 있는 문안 = 이름 변수 · 퍼센트 기호 · 퍼센트 인코딩 주소가 있어도 통과', () => {
    expect(splitVariantIssue(ok(`%이름%님 50% 할인 ${LINK}`), 'SMS')).toBeNull();
    expect(splitVariantIssue(ok(`%고객명%님 %성함%님 ${LINK}`, '가을 세일 안내'), 'LMS')).toBeNull();
    expect(splitVariantIssue(ok('가을 세일 https://shop.example/%EC%9D%B4%EB%A6%84?a=1'), 'SMS')).toBeNull();
    expect(splitVariantIssue({ text: `제목 없는 단문 ${LINK}` }, 'SMS')).toBeNull();
  });
  it.each([
    ['EMPTY', ok('   '), 'SMS'],
    ['SUBJECT_REQUIRED', { text: `긴 글 ${LINK}`, subject: ' ' }, 'LMS'],
    ['LIQUID', ok(`{% if customer.grade == 'VIP' %}특별{% endif %} ${LINK}`), 'SMS'],
    ['LIQUID', ok(`{{ customer.name }}님 ${LINK}`), 'SMS'],
    ['VARS', ok(`%이름%님 %등급% 회원 ${LINK}`), 'SMS'],
    ['VARS_SUBJECT', ok(`세일 ${LINK}`, '%보유포인트%점'), 'LMS'],
    ['VARS_SUBJECT', ok(`%이름%님 세일 ${LINK}`, '%이름%님께'), 'LMS'],   // 제목의 이름 변수 = 배관이 채우지 않아 글자 그대로 나간다
    ['NO_LINK', ok('%이름%님 세일이에요'), 'SMS'],
    ['SHORT_LINK', ok(`세일 ${SHORT_URL_BASE}/aB3xY9zQ`), 'SMS'],
    ['SHORT_LINK', ok(`세일 ${LINK} 그리고 ${SHORT_URL_BASE}/aB3xY9zQ`), 'SMS'],
    ['VAR_IN_LINK', ok('세일 https://shop.example/?n=%이름%'), 'SMS'],
    ['VAR_IN_LINK', ok('세일 https://shop.example/?g=%등급%'), 'SMS'],
  ] as const)('%s — 못 쓰는 문안', (code, v, type) => {
    expect(splitVariantIssue(v, type)?.code).toBe(code);
  });
  it('모바일 DM 짧은 주소도 이미 줄인 주소다(문안별로 따로 셀 수 없다)', () => {
    process.env.DM_SHORT_LINK_BASE = 'https://hlj.example/';
    expect(splitVariantIssue(ok('세일 https://hlj.example/반짝세일'), 'SMS')?.code).toBe('SHORT_LINK');
    expect(splitVariantIssue(ok('세일 https://hlj.example.other/반짝세일'), 'SMS')).toBeNull();
  });
  it('이름 말고 다른 변수 = 어느 변수인지 이유에 적는다(본문 · 제목 · 중복 없이)', () => {
    const issue = splitVariantIssue(ok(`%등급% %등급% %매장% ${LINK}`, '가을 세일'), 'LMS');
    expect(issue?.message).toContain('%등급%, %매장%');
    // 단문은 제목을 싣지 않으므로 제목의 변수를 보지 않는 것이 아니다 — 넘어온 제목 글자는 유형과 무관하게 본다(시작 관문이 단문의 제목을 버린 뒤 부른다)
    expect(splitVariantIssue(ok(`세일 ${LINK}`, '%이름%님'), 'SMS')?.code).toBe('VARS_SUBJECT');
  });
  it('문안 묶음 = 2 ~ 3개 · 문안마다 자격 · 같은 글은 한 번만', () => {
    const a = ok(`A 문안 ${LINK}`); const b = ok(`B 문안 ${LINK}`); const c = ok(`C 문안 ${LINK}`);
    expect(splitVariantsIssue([a, b], 'SMS')).toBeNull();
    expect(splitVariantsIssue([a, b, c], 'SMS')).toBeNull();
    expect(splitVariantsIssue([a], 'SMS')?.issue.code).toBe('COUNT');
    expect(splitVariantsIssue([a, b, c, ok(`D ${LINK}`)], 'SMS')?.issue.code).toBe('COUNT');
    expect(splitVariantsIssue([a, ok('링크 없음')], 'SMS')).toEqual({ index: 1, issue: expect.objectContaining({ code: 'NO_LINK' }) });
    expect(splitVariantsIssue([a, b, { text: ` A 문안 ${LINK} `, subject: '제목 ' }], 'SMS')).toEqual({ index: 2, issue: expect.objectContaining({ code: 'SAME_COPY' }) });
    expect(splitVariantsIssue([a, { ...a, subject: '다른 제목' }], 'LMS')).toBeNull();
  });
  it('고르는 값 = 목록 안의 것만', () => {
    expect([...SPLIT_PCTS]).toEqual([10, 20, 30]);
    expect([...SPLIT_WAITS]).toEqual(['1h', '3h', '6h', 'nextday']);
    for (const bad of [0, 15, '10', null, undefined]) expect(isSplitPct(bad)).toBe(false);
    for (const bad of ['2h', '', 1, null]) expect(isSplitWait(bad)).toBe(false);
    expect([isSplitMsgType('SMS'), isSplitMsgType('LMS'), isSplitMsgType('MMS'), isSplitMsgType('sms')]).toEqual([true, true, false, false]);
    expect([0, 1, 2].map(splitVariantLabel)).toEqual(['문안 A', '문안 B', '문안 C']);
  });
});

describe('받는 글의 바이트 한도', () => {
  it('단문 90 · LMS 2000 바이트까지(한글 = 2바이트) · 넘으면 문안 이름과 바이트를 적는다', () => {
    expect(splitBytesIssue('a'.repeat(90), 'SMS', '문안 A')).toBeNull();
    expect(splitBytesIssue('가'.repeat(45), 'SMS', '문안 A')).toBeNull();
    expect(splitBytesIssue('a'.repeat(91), 'SMS', '문안 B')).toMatchObject({ code: 'BYTES' });
    expect(splitBytesIssue('가'.repeat(45) + 'a', 'SMS', '문안 B')?.message).toContain('문안 B: SMS는 90바이트까지예요. 광고 표기와 줄인 주소를 넣으면 91바이트예요.');
    expect(splitBytesIssue('a'.repeat(2000), 'LMS', '문안 A')).toBeNull();
    expect(splitBytesIssue('a'.repeat(2001), 'LMS', '문안 A')?.message).toContain('2,001바이트');
  });
  it('미리 보기의 글 = 실제로 줄인 글과 길이가 같다(짧은 주소 머리 + 해시 8글자) · 이미 줄인 주소 · 주소 없는 글은 그대로', async () => {
    const text = `A ${LINK}/a B ${LINK}/a-very-long-path?x=1 끝`;
    const real = await shortenUrlsStrict(text, 'co');
    const fake = shortenedLengthPreview(text);
    expect(fake.length).toBe(real.text.length);
    expect(fake).toBe(`A ${SHORT_URL_BASE}/00000000 B ${SHORT_URL_BASE}/00000000 끝`);
    expect(shortenedLengthPreview(`세일 ${SHORT_URL_BASE}/aB3xY9zQ`)).toBe(`세일 ${SHORT_URL_BASE}/aB3xY9zQ`);
    expect(shortenedLengthPreview('주소 없음')).toBe('주소 없음');
    expect(shortenedLengthPreview('')).toBe('');
  });
});

describe('인원 나누기', () => {
  it('먼저 보낼 몫을 문안별로 균등하게(내림) · 나머지 = 그 밖 전부', () => {
    expect(splitSizes(1000, 20, 2)).toEqual({ perVariant: 100, testTotal: 200, rest: 800 });
    expect(splitSizes(1000, 30, 3)).toEqual({ perVariant: 100, testTotal: 300, rest: 700 });
    expect(splitSizes(1001, 10, 3)).toEqual({ perVariant: 33, testTotal: 99, rest: 902 });
    expect(splitSizes(20, 10, 2)).toEqual({ perVariant: 1, testTotal: 2, rest: 18 });
  });
  it('문안마다 1명 · 나머지 1명이 안 되면 나누지 않는다 · 목록 밖 값도', () => {
    expect(splitSizes(19, 10, 2)).toBeNull();     // 문안마다 0명
    expect(splitSizes(10, 10, 3)).toBeNull();
    expect(splitSizes(0, 20, 2)).toBeNull();
    expect(splitSizes(1000, 15 as any, 2)).toBeNull();
    expect(splitSizes(1000, 20, 1)).toBeNull();
    expect(splitSizes(1000, 20, 4)).toBeNull();
    expect(splitSizes(1000.5, 20, 2)).toBeNull();
  });
});

describe('판정 시각', () => {
  const at = (iso: string) => new Date(iso);
  it('기다림 = 1 · 3 · 6시간 · 다음 날 같은 시각', () => {
    const start = at('2026-11-16T10:00:00+09:00');
    expect(splitDecideAt(start, '1h', false).toISOString()).toBe(at('2026-11-16T11:00:00+09:00').toISOString());
    expect(splitDecideAt(start, '3h', false).toISOString()).toBe(at('2026-11-16T13:00:00+09:00').toISOString());
    expect(splitDecideAt(start, '6h', false).toISOString()).toBe(at('2026-11-16T16:00:00+09:00').toISOString());
    expect(splitDecideAt(start, 'nextday', false).toISOString()).toBe(at('2026-11-17T10:00:00+09:00').toISOString());
  });
  it('광고 = 발송 창 밖이면 다음 창으로(여정이 쓰는 함수 그대로) · 광고가 아니면 그 시각 그대로', () => {
    const start = at('2026-11-16T18:30:00+09:00');   // 6시간 뒤 = 00:30
    const raw = at('2026-11-17T00:30:00+09:00');
    expect(splitDecideAt(start, '6h', false).toISOString()).toBe(raw.toISOString());
    expect(splitDecideAt(start, '6h', true).toISOString()).toBe(sendableAt(raw, false).toISOString());
    expect(splitDecideAt(start, '6h', true).getTime()).toBeGreaterThan(raw.getTime());
    expect(splitDecideAt(start, '1h', true).toISOString()).toBe(at('2026-11-16T19:30:00+09:00').toISOString());
  });
});

describe('승자 판정(누른 기기 수 ÷ 발송 성공 수)', () => {
  it('신뢰 구간이 겹치지 않으면 가장 높은 문안', () => {
    expect(judgeSplit([{ sent: 1000, devices: 50 }, { sent: 1000, devices: 200 }])).toMatchObject({ verdict: 'winner', winnerIndex: 1, rates: [0.05, 0.2] });
    expect(judgeSplit([{ sent: 1000, devices: 300 }, { sent: 1000, devices: 50 }, { sent: 1000, devices: 40 }])).toMatchObject({ verdict: 'winner', winnerIndex: 0 });
  });
  it('겹치면 첫 문안(차이가 뚜렷하지 않다) · 셋 가운데 하나와만 겹쳐도', () => {
    expect(judgeSplit([{ sent: 1000, devices: 50 }, { sent: 1000, devices: 55 }])).toMatchObject({ verdict: 'no_difference', winnerIndex: 0 });
    expect(judgeSplit([{ sent: 30, devices: 3 }, { sent: 30, devices: 6 }])).toMatchObject({ verdict: 'no_difference', winnerIndex: 0 });
    expect(judgeSplit([{ sent: 1000, devices: 40 }, { sent: 1000, devices: 300 }, { sent: 1000, devices: 290 }])).toMatchObject({ verdict: 'no_difference', winnerIndex: 0 });
    expect(judgeSplit([{ sent: 1000, devices: 0 }, { sent: 1000, devices: 0 }])).toMatchObject({ verdict: 'no_difference', winnerIndex: 0 });
  });
  it('발송 성공 수를 모르는 문안이 있으면 재지 않는다(첫 문안)', () => {
    expect(judgeSplit([{ sent: null, devices: 9 }, { sent: 1000, devices: 300 }])).toMatchObject({ verdict: 'not_ready', winnerIndex: 0, rates: [null, 0.3] });
    expect(judgeSplit([{ sent: 0, devices: 0 }, { sent: 1000, devices: 300 }])).toMatchObject({ verdict: 'not_ready', winnerIndex: 0 });
    expect(judgeSplit([{ sent: 1000, devices: 300 }])).toMatchObject({ verdict: 'not_ready', winnerIndex: 0 });
  });
  it('누른 기기 수가 발송 성공 수보다 많으면 성공 수로 본다(비율이 1 을 넘지 않는다)', () => {
    const j = judgeSplit([{ sent: 10, devices: 25 }, { sent: 1000, devices: 10 }]);
    expect(j.rates).toEqual([1, 0.01]);
    expect(j).toMatchObject({ verdict: 'winner', winnerIndex: 0 });
  });
});

describe('주소 엄격 줄이기(short-url)', () => {
  it('주소의 자리와 종류', () => {
    const text = `A ${LINK} B ${SHORT_URL_BASE}/aB3xY9zQ`;
    expect(listUrlsForTracking(text)).toEqual([
      { url: LINK, start: 2, end: 2 + LINK.length, kind: 'plain' },
      { url: `${SHORT_URL_BASE}/aB3xY9zQ`, start: text.indexOf(SHORT_URL_BASE), end: text.length, kind: 'short' },
    ]);
    expect(listUrlsForTracking('주소 없음')).toEqual([]);
    expect(listUrlsForTracking('')).toEqual([]);
  });
  it('모든 주소를 줄이고 해시를 돌려준다 · 한 주소가 다른 주소의 앞부분이어도 섞이지 않는다 · 같은 주소는 해시 하나', async () => {
    const text = 'A https://shop.example/x B https://shop.example/xy C https://shop.example/x 끝';
    const r = await shortenUrlsStrict(text, 'co');
    expect(r.hashes).toHaveLength(2);
    const [h1, h2] = r.hashes;
    expect(r.text).toBe(`A ${SHORT_URL_BASE}/${h1} B ${SHORT_URL_BASE}/${h2} C ${SHORT_URL_BASE}/${h1} 끝`);
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(db.query.mock.calls.map((c) => c[1][1])).toEqual(['https://shop.example/x', 'https://shop.example/xy']);
    expect(db.query.mock.calls.every((c) => c[1][2] === 'co')).toBe(true);
  });
  it('이미 줄인 주소가 있으면 던진다(아무것도 만들지 않는다) · 주소가 없으면 글 그대로', async () => {
    await expect(shortenUrlsStrict(`A ${LINK} B ${SHORT_URL_BASE}/aB3xY9zQ`, 'co')).rejects.toMatchObject({ code: 'SHORT_LINK_ALREADY', status: 400 });
    expect(db.query).not.toHaveBeenCalled();
    expect(await shortenUrlsStrict('주소 없음', 'co')).toEqual({ text: '주소 없음', hashes: [] });
  });
  it('한 건이라도 못 줄이면 던진다(원문 주소를 조용히 남기지 않는다)', async () => {
    db.query.mockResolvedValueOnce({ rows: [], rowCount: 1 }).mockRejectedValueOnce(new Error('DB 끊김'));
    await expect(shortenUrlsStrict('A https://a.example/1 B https://b.example/2', 'co')).rejects.toThrow('DB 끊김');
  });
});

describe('계약(소스) — 길 하나 · 잠금 하나 · 관문 · 배선', () => {
  const be = (rel: string) => readFileSync(resolve(__dirname, '../..', rel), 'utf8').replace(/\r\n/g, '\n');
  const fe = (rel: string) => readFileSync(resolve(__dirname, '../../../../frontend/src', rel), 'utf8').replace(/\r\n/g, '\n');
  const ct = be('utils/campaign-split.ts');
  const order = (text: string, ...marks: string[]) => {
    let at = -1;
    for (const m of marks) { const i = text.indexOf(m, at + 1); expect(i, m).toBeGreaterThan(at); at = i; }
  };

  it('대상 = AI 한줄로 발송 길과 같은 함수 · 같은 순서 · 같은 조각(범위 서브쿼리 · 수신거부 조건이 글자까지 같다)', () => {
    const route = be('routes/campaigns.ts');
    const send = route.slice(route.indexOf("router.post('/:id/send'"));
    order(send, 'getStoreScope(', 'resolveSendConsent(', 'resolveAdminSendConsent(', 'buildFilterQueryCompat(', 'buildSendConsent({');
    // CT = 같은 순서를 세 함수에 나눠 둔다: 범위 · 몰 동의 판정 → 대상 조건 → 자격 조각(동의 · 범위 · 수신거부)
    const scope = ct.slice(ct.indexOf('export async function resolveSplitScope('), ct.indexOf('export function splitAudienceWhere('));
    order(scope, 'getStoreScope(', 'resolveSendConsent(', 'resolveAdminSendConsent(');
    const plan = ct.slice(ct.indexOf('export async function planSplit('), ct.indexOf('export function normalizeSplitId('));
    order(plan, 'resolveSplitScope(ctx)', 'buildFilterQueryCompat(', 'splitAudienceWhere(ctx, scope, { where: filterQuery.where, params: filterQuery.params })');
    const where = ct.slice(ct.indexOf('export function splitAudienceWhere('), ct.indexOf('const PHONE_DIGITS_SQL'));
    order(where, 'buildSendConsent({', "sendConsent.storeFilter.replace('$STORE_IDX'", 'unsubParamIdx');
    const scopeSql = " AND c.id IN (SELECT customer_id FROM customer_stores WHERE company_id = c.company_id AND store_code = ANY($STORE_IDX::text[]))";
    expect(send).toContain(scopeSql);
    expect(ct).toContain(scopeSql);
    expect(send).toContain("AND NOT EXISTS (SELECT 1 FROM unsubscribes u WHERE u.user_id = $${unsubParamIdx} AND u.phone = c.phone)");
    expect(ct).toContain("AND NOT EXISTS (SELECT 1 FROM unsubscribes u WHERE u.user_id = $${unsubParamIdx} AND u.phone = c.phone)");
    expect(send).toContain("WHERE c.company_id = $1 AND c.is_active = true AND ");
    expect(ct).toContain("where: `c.company_id = $1 AND c.is_active = true AND ${sendConsent.customerConsent} ${filter.where}${storeFilterFinal}");
    // 몰별 수신동의로 판정되는 발송은 쓰지 않는다 = 재확인이 고객 행의 동의만 보아도 된다
    expect(ct).toContain('if (sendEnforce || sendAdminConsent !== null) {');
    expect(ct).toContain("buildSendConsent({ enforce: false, alias: 'c', storeFilter: scope.storeFilter })");
    expect(ct).toContain("buildFilterQueryCompat(input.targetFilter, ctx.companyId, { storeConsent: false })");
  });
  it('발송 = 직접발송 코어를 부르기만 한다(한 자리) · 배관 파일을 끌어오지 않는다 · 갈래 값은 있는 값', () => {
    expect(ct.split('createDirectSendCampaign(').length - 1).toBe(1);
    expect(ct).not.toMatch(/from '\.\.\/routes\//);
    expect(ct).not.toMatch(/from '\.\/direct-send-(worker|processor)'/);
    expect(ct).toContain("sendType: 'operator',");
    expect(ct).toContain("branch: 'ai'");
    expect(ct).toContain("import { DEFINITE_NO_COMMIT } from './planner-executor';");
    expect(be('utils/planner-executor.ts')).toContain("export const DEFINITE_NO_COMMIT = new Set(['INSUFFICIENT_BALANCE'");
    expect(ct).toContain("activationGuard: { sql: 'EXISTS (SELECT 1 FROM campaign_split_tests s WHERE s.id = $2::uuid AND s.claim_token = $3::uuid FOR SHARE)', params: [row.id, token] },");
  });
  it('묶음 = 표식(적재 묶음 id)을 먼저 적고 → 적재 → 피로도 → 관문 → 코어 · 피로도는 관문 길이어도 건다', () => {
    const send = ct.slice(ct.indexOf('async function sendGroup('), ct.indexOf('/** 판정에 쓰는 문안별 값'));
    order(send, "g.state = 'sending'; g.stagingId = stagingId;", 'await saveGroups(row, token);', 'INSERT INTO campaign_send_staging', 'getFatigueCap(', 'getFatigueBlockedSet(', 'resolveAdGateMode(', 'gateStaging(', 'adHold.pass();', 'createDirectSendCampaign(', '} finally {', 'if (adHold.holding) await adHold.settle();');
    // 광고 관문이 쥔 예약을 놓는 자리 = finally 한 곳(던짐 포함 모든 출구)
    expect(send.split('adHold.settle()').length - 1).toBe(1);
    // 닫힌 회사 = 막힘이 아니라 그만(화면이 닫혀 누를 자리가 없다)
    order(send, "const live = await v3LiveState('split', ctx.companyId);", "if (live === 'unknown') return { later: true };", "if (live === 'closed') return { cancel: ");
    expect(send).toContain('FROM campaign_split_members m JOIN customers c ON c.id = m.customer_id');
    // 관문을 다시 보는 것 = 적재 묶음 id 를 적기 전(막혀도 묶음이 pending 으로 남는다)
    order(send, "v3LiveState('split'", 'hasCompanyLineGroup(', 'checkCallbackSpec(', 'isCallbackRegistered(', 'getOpt080Number(', 'resolveSplitScope(ctx)', 'const stagingId = randomUUID();');
  });
  it('실행 = 잠금을 얻은 뒤에 쥔다(열쇠는 uuidLockKey) · 쥔 뒤 대조부터 · 끝나면 놓는다', () => {
    expect(ct.split("withKeyedLock('campaign-split', uuidLockKey(id)").length - 1).toBe(3);   // 실행 · 그만 · 이어 보내기
    const adv = ct.slice(ct.indexOf('export async function advanceSplit('), ct.indexOf('async function runSplit('));
    order(adv, 'const id = normalizeSplitId(rawId);', "withKeyedLock('campaign-split', uuidLockKey(id)", 'SET claim_token = $2::uuid, claimed_at = NOW()', "status IN ('testing', 'deciding')", 'claimed_at < NOW() - make_interval(mins => $3::int)', 'runSplit(row, token, now)', '} finally {', 'SET claim_token = NULL, claimed_at = NULL');
    expect(adv).toContain('[id, token, LOCK_STALE_MINUTES]');
    const run = ct.slice(ct.indexOf('async function runSplit('), ct.indexOf('// 담당자 조작'));
    order(run, 'reconcileGroup(row, g)', "if (row.status === 'testing') {", 'sendGroup(row, token, g, v.tracked', 'const floor = Math.max(...tests.map((g) => (g.goesAt ? splitDecideAt(new Date(g.goesAt), row.wait_code, row.spec.isAd).getTime() : 0)));', "await writeSplit(row, token, 'decide_at = $3', [new Date(floor)]);", "return 'waiting';", 'measureSplit(row)', 'judgeSplit(m.arms)', "status = 'deciding'", "sendGroup(row, token, rest, v.tracked, v.subject, '나머지', now())", "finishSplit(row, token, 'done', null)");
    // 판정 시각의 재료 = 저장된 값뿐(이번 실행이 접수했는지를 보지 않는다) · 묶음이 나가는 시각은 sending 표식과 한 문장으로 적힌다
    expect(run).not.toContain('acceptedNow');
    const send = ct.slice(ct.indexOf('async function sendGroup('), ct.indexOf('const SPLIT_DEVICES_SQL'));
    order(send, "new Date(spec.scheduledAt).getTime() > at.getTime() ? spec.scheduledAt : null;", "g.state = 'sending'; g.stagingId = stagingId; g.campaignId = null; g.total = null; g.goesAt = (future ? new Date(future) : at).toISOString();", 'await saveGroups(row, token);', 'createDirectSendCampaign(');
    expect(send).not.toContain('Date.now()');
    // 같은 id 의 만들기 · 버리기 = 한 줄 · 닫은 id 는 만드는 자리에서 거절
    expect(ct).toContain('withSplitStartTurn(id, () => createSplitInTurn(ctx, id, plan));');
    const make = ct.slice(ct.indexOf('async function createSplitInTurn('), ct.indexOf('// 실행 — 길 하나'));
    order(make, 'SELECT company_id FROM campaign_split_tests WHERE id = $1::uuid', 'return { created: false };', "if (closedStarts.has(uuidLockKey(id))) throw reject('SPLIT_START_CLOSED'", 'shortenUrlsStrict(v.text, ctx.companyId)', 'INSERT INTO campaign_split_tests');
    const drop = ct.slice(ct.indexOf('export async function discardSplitStart('), ct.indexOf('async function createSplitInTurn('));
    order(drop, 'return withSplitStartTurn(id, async () => {', 'const split = await readSplit(ctx, id);', 'if (split) return split;', 'rememberClosedStart(closedStarts, uuidLockKey(id), at);');
    // 내 표식일 때만 쓴다 · 끝난 상태가 되는 문장에서 고정 표를 지운다
    expect(ct).toContain('WHERE id = $1::uuid AND claim_token = $2::uuid`,');
    expect(ct).toContain('DELETE FROM campaign_split_members m USING fin WHERE m.split_id = fin.id');
    // 판정 시각을 정하는 자리 = 시작 계획(planSplit)과 시험 묶음을 접수하는 자리(runSplit) 둘뿐 — 이어 보내기는 시각을 정하지 않는다
    expect(ct.split('splitDecideAt(').length - 1).toBe(2);
    const resume = ct.slice(ct.indexOf('export async function resumeSplit('), ct.indexOf('// 조회 — 요약 창'));
    expect(resume).not.toContain('decide_at');
    // 요금제를 읽지 못한 것(later)은 아무 상태도 바꾸지 않고 다음 실행으로
    expect(run.split("'later' in out ? 'postponed' : haltSplit(row, token, out)").length - 1).toBe(2);
  });
  it('시작 요청 = 있으면 그대로 → 관문 → 발신 인증 → 만들기 → 실행(요청 하나가 값 전부) · 닫힌 회사 403 · 표 없으면 503', () => {
    const r = be('routes/campaign-split.ts');
    const start = r.slice(r.indexOf("router.post('/', guarded('start'"), r.indexOf("router.get('/', guarded('list'"));
    order(start, 'if (await aiZonePlanBlocked(req, res)) return;', 'normalizeSplitId(input.id)', 'readSplit(ctx, id)', 'planSplit(ctx, { ...input, id })', 'checkSenderAuthGate({', 'senderAuthRejection(gate)', 'createSplit(ctx, id, plan)', 'advanceSplit(id)');
    const resume = r.slice(r.indexOf("router.post('/:id/resume', guarded('resume'"));
    order(resume, 'if (await aiZonePlanBlocked(req, res)) return;', 'resumeSplit(ctx, req.params.id)', 'advanceSplit(req.params.id)');
    expect(r).toContain("if (stageGate && !(await v3Live('split', ctx.companyId))) {");
    // 단계 개방을 보지 않는 주소 = 시작 요청 버리기 하나(보낸 요청의 끝은 기능이 닫힌 뒤에도 서버가 답한다 · 발송 0)
    expect(r.split('}, false));').length - 1).toBe(1);
    const discard = r.slice(r.indexOf("router.post('/:id/discard', guarded('discard'"), r.indexOf('// GET / — 최근'));
    expect(discard).toContain('discardSplitStart(ctx, req.params.id)');
    expect(discard).toContain('}, false));');
    expect(discard).not.toMatch(/advanceSplit|createSplit\(|planSplit/);
    expect(r).toContain("handleDbMigrationError(err, res, 'campaign_split_tests')");
    expect(r).not.toMatch(/createDirectSendCampaign|\bquery\(/);
    for (const path of ["router.get('/status'", "router.post('/preview', guarded('preview'", "router.get('/:id', guarded('read'", "router.post('/:id/stop', guarded('stop'", "router.post('/:id/resume', guarded('resume'"]) expect(r).toContain(path);
    const app = be('app.ts');
    expect(app).toContain("app.use('/api/campaign-split', campaignSplitRoutes);");
    expect(app).toContain('  startCampaignSplitWorker();');
    const w = be('utils/campaign-split-worker.ts');
    expect(w).toContain('await advanceSplit(String(r.id))');
    expect(w).not.toMatch(/function tick\(/);   // 흔한 이름은 이름으로 따라가는 계약(원장 R2)에서 다른 워커의 같은 이름과 섞인다
    expect(w).not.toMatch(/createDirectSendCampaign|sendGroup/);
    expect(w).toContain("if (e?.code === '42P01') {");
  });
  it('화면 = 열린 회사에만 · 판정은 서버의 답 · 시작 요청의 주인은 결과 창 하나 · 켜면 문안 하나 발송을 잠근다', () => {
    const ui = fe('components/split/SplitSend.tsx');
    expect(ui.split("useV3Feature('split')").length - 1).toBe(2);
    expect(ui).toContain('if (!live || shown.length === 0) return null;');
    // 시작 요청 = 결과 창이 쥔 상태 기계 하나(규칙 = utils/split-start · React 밖)
    expect(fe('utils/split-start.ts')).not.toMatch(/^import /m);
    const hook = ui.slice(ui.indexOf('export function useSplitStart('), ui.indexOf('export function SplitStartDialog('));
    expect(hook).toContain('const [m] = useState(() => splitStartMachine<StartView, SplitView>(');
    expect(hook).toContain('{ get: () => cur.current, set: (s) => { cur.current = s; setState(s); } },');
    expect(hook).toContain("post: (body) => sendJson(API, { method: 'POST', body }, START_TIMEOUT_MS),");
    expect(hook).toContain('read: (id) => fetchJson(`${API}/${id}`),');
    expect(hook).toContain("discard: (id) => sendJson(`${API}/${id}/discard`, { method: 'POST' }),");
    // 확인 창 = 요청 묶음으로만 그린다(패널의 지금 값 · 미리 보기를 읽지 않는다) · 요청이 있으면 뜬다
    const dialog = ui.slice(ui.indexOf('export function SplitStartDialog('), ui.indexOf('// AI 한줄로 결과 창의 패널'));
    expect(dialog).toContain('if (!pending) return null;');
    expect(dialog).toContain('const v = pending.view;');
    expect(dialog).not.toMatch(/\bp\.|preview\.data|wrapAdText|useState|useEffect/);
    expect(dialog).toContain('disabled={working} onClick={ctl.leave}');
    expect(dialog).toContain('disabled={working} onClick={ctl.submit}');
    // 패널 = 고치는 값만 쥔다 · 시작 요청을 보내지도 버리지도 않는다(열기만)
    const panel = ui.slice(ui.indexOf('export function SplitSendPanel('), ui.indexOf('// 대시보드 현황 줄'));
    expect(panel).toContain('const { pending, started: done } = p.start.state;');
    expect(panel).toContain('const canEdit = live && p.messages.length >= 2;');
    expect(panel).toContain('if (!canEdit && !done) return null;');
    expect(panel).toContain('p.start.open({');
    expect(panel).toContain('id, body: { ...body(), id },');
    expect(panel).not.toMatch(/sendJson\(API,|\/discard|setPending|setStart\(|splitStartMachine|\.submit\(|\.leave\(/);
    // 미리 보기는 시작 상태에 묶이지 않는다(요청이 떠 있으면 쉰다)
    expect(panel).toContain('const paused = !ready || !!pending;');
    expect(panel).toContain('}, [bodyKey, paused]);');
    expect(panel).toContain('p.onActiveChange?.(on);');
    expect(ui).not.toMatch(/\/api\/campaigns\b|window\.(confirm|alert)|\b(alert|confirm)\(/);
    expect(ui).not.toMatch(/Claude|Anthropic|GPT|Opus|Sonnet|Haiku|Fable/i);
    expect(ui).toContain('누른 기기 수 기준');
    const popup = fe('components/AiCampaignResultPopup.tsx');
    // 주인 = 결과 창: 패널이 다시 만들어져도(채널 변경) · 창을 닫았다 열어도 요청이 남는다. 창을 새로 열 때 무엇을 지울지는 상태 기계가 정한다(reopen)
    expect(popup).toContain('const split = useSplitStart({ onSenderAuth, onStarted: onSplitStarted });');
    expect(popup).toContain('useEffect(() => { if (show) { setSplitOn(false); split.reopen(); } }, [show]);');
    expect(popup).toContain('const splitLocked = splitOn || split.locked;');
    expect(popup).toContain('disabled={charsetBlocked || splitLocked}');
    expect(popup).toContain('if (charsetBlocked || splitLocked) return;');
    expect(popup).toContain('start={split}');
    expect(popup).toContain('onActiveChange={setSplitOn}');
    expect(popup).not.toMatch(/setSplitStarted|splitStarted/);
    // 확인 창은 단계 블록 밖(창의 뿌리 · 다른 창들 뒤)에서 그린다 = 어느 단계에서도 보인다
    expect(popup.split('<SplitStartDialog ctl={split} />').length - 1).toBe(1);
    expect(popup.indexOf('<SplitStartDialog ctl={split} />')).toBeGreaterThan(popup.indexOf('<TargetRecipientsModal'));
    expect(popup.indexOf('const split = useSplitStart(')).toBeLessThan(popup.indexOf('if (!show) return null;'));
    const dash = fe('pages/Dashboard.tsx');
    expect(dash).toContain('onSenderAuth={senderAuth.handleResponse}');
    expect(dash).toContain('{!hideAi && <SplitStatusCard refreshKey={splitRefresh} />}');
  });
});

describe('화면이 버린 시작 id 의 기억', () => {
  it('한 시간이 지난 것은 잊는다 · 최대 건수를 넘지 않는다(가장 먼저 적힌 것부터 잊는다)', () => {
    const m = new Map<string, number>();
    rememberClosedStart(m, 'a', 0);
    rememberClosedStart(m, 'b', SPLIT_CLOSED_KEEP_MS);      // 꼭 한 시간 = 아직 기억한다
    expect([...m.keys()]).toEqual(['a', 'b']);
    rememberClosedStart(m, 'c', SPLIT_CLOSED_KEEP_MS + 1);
    expect([...m.keys()]).toEqual(['b', 'c']);
    const big = new Map<string, number>();
    for (let i = 0; i < SPLIT_CLOSED_MAX + 5; i++) rememberClosedStart(big, `k${i}`, 1000);
    expect(big.size).toBe(SPLIT_CLOSED_MAX);
    expect(big.has('k4')).toBe(false);
    expect(big.has('k5')).toBe(true);
    expect(big.has(`k${SPLIT_CLOSED_MAX + 4}`)).toBe(true);
  });
});

describe('시작 요청의 상태(화면 · utils/split-start) — 보낸 요청은 서버의 답으로만 떠난다', () => {
  type V = { tag: string };
  type S = { id: string };
  const ans = (status: number, body: any = null): SplitStartAnswer => ({ ok: status >= 200 && status < 300, status, body });
  const LOST = ans(0);
  const REQ = { id: 'id-1', body: { id: 'id-1', name: '가을' }, view: { tag: 'v1' } };
  const SPLIT = { id: 'id-1' };
  /** 서버 답을 차례로 내는 시험대 — 없으면 응답이 끊긴 것(LOST) */
  function board(script: { post?: Array<SplitStartAnswer | Promise<SplitStartAnswer>>; read?: SplitStartAnswer[]; discard?: Array<SplitStartAnswer | Promise<SplitStartAnswer>> } = {}) {
    const box: { state: SplitStartState<V, S> } = { state: splitStartEmpty<V, S>() };
    const log: string[] = [];
    const started: S[] = [];
    const retries: Array<() => void> = [];
    const next = (name: 'post' | 'read' | 'discard', arg: string): Promise<SplitStartAnswer> => {
      log.push(`${name}:${arg}`);
      const q = (script[name] || []) as Array<SplitStartAnswer | Promise<SplitStartAnswer>>;
      return Promise.resolve(q.length ? q.shift()! : LOST);
    };
    const m = splitStartMachine<V, S>(
      { get: () => box.state, set: (s) => { box.state = s; } },
      {
        post: (body) => next('post', `${body.id}/${body.name}`),
        read: (id) => next('read', id),
        discard: (id) => next('discard', id),
        senderAuth: (body, retry) => { if (!body?.senderAuth) return false; retries.push(retry); return true; },
        onStarted: (s) => { started.push(s); },
      },
    );
    return { m, box, log, started, retries };
  }

  it('시작 응답에 나눠 보내기가 있으면 시작됨 = 요청이 떠나고 · 한 번 알리고 · 잠금은 남는다(창을 새로 열 때까지)', async () => {
    const b = board({ post: [ans(200, { success: true, split: SPLIT })] });
    expect(splitStartLocked(b.box.state)).toBe(false);
    b.m.open(REQ);
    expect(b.box.state.pending).toEqual({ ...REQ, sent: false });
    expect(splitStartLocked(b.box.state)).toBe(true);
    await b.m.submit();
    expect(b.box.state).toEqual({ pending: null, phase: { kind: 'idle' }, started: SPLIT });
    expect(b.started).toEqual([SPLIT]);
    expect(b.log).toEqual(['post:id-1/가을']);
    expect(splitStartLocked(b.box.state)).toBe(true);
    b.m.reopen();
    expect(b.box.state).toEqual(splitStartEmpty());
  });
  it('응답이 끊겼고 읽기에도 없으면 모름 = 요청이 남고 잠긴다 · 창을 새로 열어도 남는다 · 다시 확인 = 같은 id · 같은 본문', async () => {
    const b = board({ read: [ans(404)], post: [LOST, ans(200, { success: true, split: SPLIT })] });
    b.m.open(REQ);
    await b.m.submit();
    expect(b.box.state.phase.kind).toBe('unknown');
    expect(b.box.state.pending).toEqual({ ...REQ, sent: true });
    b.m.reopen();                                          // 결과 창을 닫았다 열어도
    b.m.open({ id: 'id-2', body: { id: 'id-2', name: '다른 것' }, view: { tag: 'v2' } });   // 다른 값으로 새로 시작하려 해도
    expect(b.box.state.pending).toEqual({ ...REQ, sent: true });
    expect(splitStartLocked(b.box.state)).toBe(true);
    await b.m.submit();
    expect(b.log).toEqual(['post:id-1/가을', 'read:id-1', 'post:id-1/가을']);
    expect(b.box.state.started).toEqual(SPLIT);
  });
  it('응답이 끊겨도 읽기에 있으면 시작됨(새 id 를 만들지 않는다)', async () => {
    const b = board({ post: [LOST], read: [ans(200, { success: true, split: SPLIT })] });
    b.m.open(REQ);
    await b.m.submit();
    expect(b.box.state).toEqual({ pending: null, phase: { kind: 'idle' }, started: SPLIT });
    expect(b.started).toEqual([SPLIT]);
  });
  it('모름 뒤의 거절(403)은 버릴 근거가 아니다 = 요청이 남고 · 떠나려면 서버에 묻는다 → 서버가 「이미 있다」면 시작된 것', async () => {
    const b = board({
      post: [LOST, ans(403, { success: false, code: 'V3_STAGE_CLOSED', error: '이 기능을 쓸 수 없습니다.' })],
      read: [ans(404)],
      discard: [ans(200, { success: true, split: SPLIT })],
    });
    b.m.open(REQ);
    await b.m.submit();                                    // 응답 끊김(앞 요청은 서버에서 만들어졌다)
    await b.m.submit();                                    // 다시 확인 → 관문이 거절
    expect(b.box.state.phase).toEqual({ kind: 'error', message: '이 기능을 쓸 수 없습니다.' });
    expect(b.box.state.pending).toEqual({ ...REQ, sent: true });
    expect(splitStartLocked(b.box.state)).toBe(true);
    b.m.reopen();
    expect(b.box.state.pending?.id).toBe('id-1');
    await b.m.leave();                                     // 돌아가기 = 서버에 닫아 달라고 한다
    expect(b.log).toEqual(['post:id-1/가을', 'read:id-1', 'post:id-1/가을', 'discard:id-1']);
    expect(b.box.state).toEqual({ pending: null, phase: { kind: 'idle' }, started: SPLIT });
    expect(b.started).toEqual([SPLIT]);
  });
  it('서버 오류(5xx) 뒤 읽기가 404 여도 버리지 않는다(짐작하지 않는다) · 거절(4xx)만 받은 요청도 떠날 때는 서버에 묻는다', async () => {
    const b = board({ post: [ans(500, { success: false, error: '처리하지 못했습니다.' }), ans(400, { success: false, error: '잔액이 부족해요.' })], read: [ans(404)], discard: [ans(200, { success: true, split: null })] });
    b.m.open(REQ);
    await b.m.submit();
    expect(b.box.state.phase.kind).toBe('unknown');
    expect(b.box.state.pending?.sent).toBe(true);
    await b.m.submit();
    expect(b.box.state.phase).toEqual({ kind: 'error', message: '잔액이 부족해요.' });
    expect(splitStartLocked(b.box.state)).toBe(true);
    await b.m.leave();
    expect(b.log[b.log.length - 1]).toBe('discard:id-1');
    expect(b.box.state).toEqual(splitStartEmpty());           // 서버가 닫았다고 답했다 = 버려졌다(잠금이 풀린다)
    expect(b.started).toEqual([]);
  });
  it('버리기의 답을 못 받으면 요청이 남는다(잠금이 이어진다) · 답이 success 가 아니어도 남는다', async () => {
    const b = board({ post: [LOST], read: [LOST], discard: [LOST, ans(403, { success: false, error: '고객사 권한이 필요합니다.' }), ans(200, { success: true, split: null })] });
    b.m.open(REQ);
    await b.m.submit();
    await b.m.leave();
    expect(b.box.state.phase.kind).toBe('unknown');
    expect(b.box.state.pending).toEqual({ ...REQ, sent: true });
    await b.m.leave();
    expect(b.box.state.pending).toEqual({ ...REQ, sent: true });
    expect(splitStartLocked(b.box.state)).toBe(true);
    await b.m.leave();
    expect(b.box.state).toEqual(splitStartEmpty());
  });
  it('보낸 적 없는 요청은 서버에 묻지 않고 버린다 · 창을 새로 열면 처음으로', async () => {
    const b = board();
    b.m.open(REQ);
    await b.m.leave();
    expect(b.log).toEqual([]);
    expect(b.box.state).toEqual(splitStartEmpty());
    b.m.open(REQ);
    b.m.reopen();
    expect(b.box.state).toEqual(splitStartEmpty());
  });
  it('보내는 중 · 닫는 중에는 다시 보내거나 떠나지 못한다(요청이 겹치지 않는다)', async () => {
    let answer!: (a: SplitStartAnswer) => void;
    const slow = new Promise<SplitStartAnswer>((r) => { answer = r; });
    const b = board({ post: [slow] });
    b.m.open(REQ);
    const first = b.m.submit();
    expect(b.box.state.phase.kind).toBe('busy');
    await b.m.submit();
    await b.m.leave();
    b.m.reopen();
    expect(b.log).toEqual(['post:id-1/가을']);
    expect(b.box.state.pending).toEqual({ ...REQ, sent: true });
    answer(ans(200, { success: true, split: SPLIT }));
    await first;
    expect(b.box.state.started).toEqual(SPLIT);
    // 닫는 중
    let closed!: (a: SplitStartAnswer) => void;
    const c = board({ post: [LOST], read: [LOST], discard: [new Promise<SplitStartAnswer>((r) => { closed = r; })] });
    c.m.open(REQ);
    await c.m.submit();
    const leaving = c.m.leave();
    expect(c.box.state.phase.kind).toBe('closing');
    await c.m.submit();
    await c.m.leave();
    expect(c.log).toEqual(['post:id-1/가을', 'read:id-1', 'discard:id-1']);
    closed(ans(200, { success: true, split: null }));
    await leaving;
    expect(c.box.state).toEqual(splitStartEmpty());
  });
  it('발신 인증 요구 = 보낸 요청으로 남고 인증 뒤 같은 요청으로 다시 · 그 사이 요청이 떠났으면 재시도는 아무것도 보내지 않는다', async () => {
    const b = board({ post: [ans(403, { senderAuth: true }), ans(200, { success: true, split: SPLIT })] });
    b.m.open(REQ);
    await b.m.submit();
    expect(b.box.state.phase.kind).toBe('idle');
    expect(b.box.state.pending).toEqual({ ...REQ, sent: true });
    b.retries[0]();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(b.log).toEqual(['post:id-1/가을', 'post:id-1/가을']);
    expect(b.box.state.started).toEqual(SPLIT);
    // 인증을 기다리는 사이 요청을 버렸고 다른 요청을 열었다 → 옛 재시도는 새 요청을 보내지 않는다
    const c = board({ post: [ans(403, { senderAuth: true })], discard: [ans(200, { success: true, split: null })] });
    c.m.open(REQ);
    await c.m.submit();
    await c.m.leave();
    c.m.open({ id: 'id-2', body: { id: 'id-2', name: '다른 것' }, view: { tag: 'v2' } });
    c.retries[0]();
    await Promise.resolve(); await Promise.resolve();
    expect(c.log).toEqual(['post:id-1/가을', 'discard:id-1']);
    expect(c.box.state.pending).toEqual({ id: 'id-2', body: { id: 'id-2', name: '다른 것' }, view: { tag: 'v2' }, sent: false });
  });
  it('이미 시작했으면 새 요청을 열지 않는다 · 진행 상황 창이 바꾼 값은 시작한 것에만 받는다', async () => {
    const b = board({ post: [ans(200, { success: true, split: SPLIT })] });
    b.m.changed({ id: 'x' });
    expect(b.box.state.started).toBeNull();
    b.m.open(REQ);
    await b.m.submit();
    b.m.open({ id: 'id-2', body: { id: 'id-2' }, view: { tag: 'v2' } });
    expect(b.box.state.pending).toBeNull();
    b.m.changed({ id: 'id-1' });
    expect(b.started).toHaveLength(2);
  });
});
