/**
 * 금칙어 차단 승격 — 차감 앞 판정과 경로별 배선 (★2026-10-03 · 전송자격인증 5.2 · 설계 = 전송자격인증 §4-H)
 *
 * 0819 까지는 판정이 차감 **뒤**(큐 적재 길목)에만 있어 막을 수 없었다(막으면 환불 정합이 깨진다).
 * 이제 차단은 발송 경로마다 **차감 · 캠페인 생성 앞**에서 원문으로 판정하는 함수 하나가 한다.
 *
 * 이 테스트가 지키는 것
 *   1. 차감 앞 판정은 `mode='block'` 규칙만 본다. 탐지 규칙에 걸려도 발송은 그대로다.
 *   2. 걸리면 코드 SPAM_BLOCKED + 고정 안내문. 안내문에 규칙 이름 · 요소가 새지 않는다(우회 문안 방지).
 *   3. 규칙 조회 실패 · 판정 오류는 **통과**(fail-open). 기록 실패는 차단을 풀지 않는다.
 *   4. 판정 입력(composeSpamCheckText) = 제목\n본문 · (광고) · 무료거부 부착 · 080 번호 없음 — 적재 길목 탐지와 같은 모양.
 *   5. 배선 5곳이 전부 차감 · 캠페인 생성 **앞**에 있다. 소비처(플래너 · 대행발송)가 차단을 재시도로 돌리지 않는다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

vi.mock('../../config/database', () => ({ query: vi.fn(), pool: { connect: vi.fn() }, mysqlQuery: vi.fn(async () => []) }));

import { query } from '../../config/database';
import {
  checkSpamBlockBeforeCharge, invalidateSpamBlockCache, SPAM_BLOCK_NOTICE, SPAM_BLOCKED_CODE,
} from '../spam-block';
import { composeSpamCheckText } from '../messageUtils';

const q = query as unknown as ReturnType<typeof vi.fn>;
const COMPANY = '11111111-1111-1111-1111-111111111111';
const read = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8');

const ruleRow = (over: Record<string, any> = {}) => ({
  id: 'r-block', name: '무직자 당일대출', mode: 'block', source: 'kisa', exempt_company_ids: [],
  elements: [{ type: 'keyword', value: '무직자' }, { type: 'keyword', value: '당일' }],
  ...over,
});

/** 규칙 조회는 rows 를, 기록 INSERT 는 성공을 돌려준다 */
function rulesAre(rows: any[]) {
  q.mockImplementation(async (sql: string) => (String(sql).includes('FROM spam_block_rules') ? { rows, rowCount: rows.length } : { rows: [], rowCount: 1 }));
}
const inserts = () => q.mock.calls.filter((c) => String(c[0]).includes('INSERT INTO spam_block_hits'));

describe('checkSpamBlockBeforeCharge — 차감 앞 차단 판정', () => {
  beforeEach(() => {
    q.mockReset();
    invalidateSpamBlockCache();
  });

  it('차단 규칙에 걸리면 SPAM_BLOCKED + 고정 안내문 · 기록은 action_taken=block', async () => {
    rulesAre([ruleRow()]);
    const v = await checkSpamBlockBeforeCharge({ items: [{ text: '\n무직자 당일 승인', recipients: 120 }], companyId: COMPANY, userId: 'u1', source: 'direct' });
    expect(v).toEqual({ blocked: true, code: SPAM_BLOCKED_CODE, notice: SPAM_BLOCK_NOTICE, ruleIds: ['r-block'] });
    expect(inserts()).toHaveLength(1);
    expect(inserts()[0][1]).toEqual(['r-block', COMPANY, 'u1', 'direct', 'block', 'block', 120, '\n무직자 당일 승인']);
  });

  it('★ 탐지 규칙에 걸려도 막지 않고, 여기서는 기록도 하지 않는다(탐지 기록은 적재 길목 몫)', async () => {
    rulesAre([ruleRow({ mode: 'detect' }), ruleRow({ id: 'r-hold', mode: 'hold' })]);
    const v = await checkSpamBlockBeforeCharge({ items: [{ text: '무직자 당일', recipients: 5 }], companyId: COMPANY });
    expect(v).toEqual({ blocked: false });
    expect(inserts()).toHaveLength(0);
  });

  it('안 걸리면 통과하고 기록하지 않는다', async () => {
    rulesAre([ruleRow()]);
    expect(await checkSpamBlockBeforeCharge({ items: [{ text: '당일 배송 안내', recipients: 5 }], companyId: COMPANY })).toEqual({ blocked: false });
    expect(inserts()).toHaveLength(0);
  });

  it('예외 회사는 그 규칙으로 막히지 않는다', async () => {
    rulesAre([ruleRow({ exempt_company_ids: [COMPANY] })]);
    expect((await checkSpamBlockBeforeCharge({ items: [{ text: '무직자 당일', recipients: 1 }], companyId: COMPANY })).blocked).toBe(false);
  });

  it('★ 안내문에 규칙 이름 · 요소가 새지 않는다 — 요소를 알면 그것만 피한 문안이 나온다', async () => {
    rulesAre([ruleRow()]);
    const v = await checkSpamBlockBeforeCharge({ items: [{ text: '무직자 당일', recipients: 1 }], companyId: COMPANY });
    if (!v.blocked) throw new Error('막혀야 한다');
    expect(v.notice).not.toContain('무직자');
    expect(v.notice).not.toContain('당일대출');
  });

  it('★ 규칙 조회 실패는 통과(fail-open) — 필터 오류로 전 고객 발송이 멈추면 안 된다', async () => {
    q.mockRejectedValue(new Error('connection terminated'));
    expect(await checkSpamBlockBeforeCharge({ items: [{ text: '무직자 당일', recipients: 1 }], companyId: COMPANY })).toEqual({ blocked: false });
  });

  it('★ 기록 INSERT 가 실패해도 차단은 그대로다', async () => {
    q.mockImplementation(async (sql: string) => {
      if (String(sql).includes('FROM spam_block_rules')) return { rows: [ruleRow()], rowCount: 1 };
      throw new Error('insert failed');
    });
    expect((await checkSpamBlockBeforeCharge({ items: [{ text: '무직자 당일', recipients: 1 }], companyId: COMPANY })).blocked).toBe(true);
  });

  it('같은 원문은 한 번만 판정하고 건수는 합친다 · 이상한 건수는 0 으로 적는다', async () => {
    rulesAre([ruleRow()]);
    await checkSpamBlockBeforeCharge({
      items: [{ text: '무직자 당일', recipients: 3 }, { text: '무직자 당일', recipients: 4 }, { text: '무직자 당일', recipients: NaN as any }],
      companyId: COMPANY,
    });
    expect(inserts()[0][1][6]).toBe(7);
  });

  it('★ 옛 기준으로 저장된 규칙(대출 + 무직자대출 = 사실상 단일 키워드)은 차단 모드여도 적용하지 않는다', async () => {
    rulesAre([ruleRow({ elements: [{ type: 'keyword', value: '대출' }, { type: 'keyword', value: '무직자대출' }] })]);
    expect(await checkSpamBlockBeforeCharge({ items: [{ text: '무직자대출 안내', recipients: 1 }], companyId: COMPANY })).toEqual({ blocked: false });
  });

  it('규칙이 없으면 DB 기록 없이 통과', async () => {
    rulesAre([]);
    expect(await checkSpamBlockBeforeCharge({ items: [{ text: '무직자 당일', recipients: 1 }] })).toEqual({ blocked: false });
    expect(inserts()).toHaveLength(0);
  });
});

describe('composeSpamCheckText — 판정 입력 = 적재 길목 탐지와 같은 모양(제목\\n본문)', () => {
  it('정보성 SMS = 빈 제목 + 개행 + 본문 그대로', () => {
    expect(composeSpamCheckText({ message: '안내드립니다', subject: '', msgType: 'SMS', isAd: false })).toBe('\n안내드립니다');
  });

  it('광고 LMS = 제목 (광고) · 본문 (광고) + 무료수신거부(번호 없음)', () => {
    const t = composeSpamCheckText({ message: '할인 안내', subject: '가을 세일', msgType: 'lms', isAd: true });
    expect(t).toBe('(광고) 가을 세일\n(광고) 할인 안내\n무료수신거부');
    expect(t).not.toMatch(/080/);
  });

  it('★ Codex 1R — 단문은 제목을 싣지 않는다(발송과 같은 subjectForMsgType) · 남아 온 옛 제목으로 막지 않는다', () => {
    expect(composeSpamCheckText({ message: '깨끗한 본문', subject: '무직자 당일', msgType: 'SMS', isAd: false })).toBe('\n깨끗한 본문');
    expect(composeSpamCheckText({ message: '깨끗한 본문', subject: '무직자 당일', msgType: 'S', isAd: true })).toBe('\n(광고)깨끗한 본문\n무료거부');
  });

  it('유형 축약값 · 모르는 값은 발송 변환과 같은 유형으로 읽는다(L · 모름 = LMS)', () => {
    expect(composeSpamCheckText({ message: '본문', subject: '제목', msgType: 'L', isAd: true })).toBe('(광고) 제목\n(광고) 본문\n무료수신거부');
    expect(composeSpamCheckText({ message: '본문', subject: '제목', msgType: '???', isAd: false })).toBe('제목\n본문');
  });

  it('변수는 치환하지 않는다(원문 판정)', () => {
    expect(composeSpamCheckText({ message: '%이름%님 안내', subject: null, msgType: 'SMS', isAd: false })).toBe('\n%이름%님 안내');
  });
});

describe('★ 배선 5곳 — 전부 차감 · 캠페인 생성 앞', () => {
  const campaigns = read('routes/campaigns.ts');

  it('캠페인 발송(POST /:id/send): 문자 · both 만 · 차감 앞 · 막히면 실행 행을 실패로 닫는다', () => {
    const at = campaigns.indexOf("source: 'campaign',\n  });");
    const deduct = campaigns.indexOf('const sendDeduct = await prepaidDeduct(');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(deduct);
    const block = campaigns.slice(campaigns.lastIndexOf("if (sendChannel === 'sms' || sendChannel === 'both') {\n  const spamVerdict", at), deduct);
    expect(block).toContain('checkSpamBlockBeforeCharge(');
    expect(block).toContain("await failCampaignRun(campaignRun.id, '금칙어 차단으로 발송 중단');");
    expect(block).toMatch(/return res\.status\(400\)\.json\(\{ error: spamVerdict\.notice, code: spamVerdict\.code \}\)/);
  });

  it('직접발송(POST /direct-send): 캠페인 INSERT · 차감 앞', () => {
    const start = campaigns.indexOf("router.post('/direct-send'");
    const at = campaigns.indexOf("source: 'direct',", start);
    const insert = campaigns.indexOf('INSERT INTO campaigns (company_id, campaign_name, message_type, message_content, subject, callback_number', start);
    const deduct = campaigns.indexOf('prepaidDeduct(', start);
    expect(start).toBeGreaterThan(0);
    expect(at).toBeGreaterThan(start);
    expect(at).toBeLessThan(insert);
    expect(at).toBeLessThan(deduct);
    expect(campaigns.slice(at - 400, at)).toContain("directChannel === 'sms' || directChannel === 'both'");
  });

  it('직접발송 코어: 캠페인 INSERT 앞 · DirectSendError(SPAM_BLOCKED, 400)', () => {
    const core = read('utils/direct-send-core.ts');
    const fn = core.indexOf('export async function createDirectSendCampaign(');
    const at = core.indexOf('checkSpamBlockBeforeCharge(', fn);
    const insert = core.indexOf('query(CAMPAIGN_INSERT_SQL', fn);
    expect(at).toBeGreaterThan(fn);
    expect(at).toBeLessThan(insert);
    expect(core.slice(at, insert)).toContain('throw new DirectSendError(spamVerdict.code, spamVerdict.notice, 400)');
  });

  it('자동발송: 알림톡 제외 · 캠페인 INSERT · 차감 앞 · 회차 실패(재시도 아님)', () => {
    const w = read('utils/auto-campaign-worker.ts');
    const at = w.indexOf('checkSpamBlockBeforeCharge(');
    expect(at).toBeGreaterThan(0);
    // 이 회차의 캠페인 행 생성 · 차감이 전부 판정 뒤에 있다(판정 앞에는 캠페인 INSERT 가 없다)
    const fnStart = w.lastIndexOf('const autoPh = findUneditedSendPlaceholder(', at);
    expect(fnStart).toBeGreaterThan(0);
    expect(w.slice(fnStart, at)).not.toContain('INSERT INTO campaigns (');
    expect(w.indexOf('INSERT INTO campaigns (', at)).toBeGreaterThan(at);
    expect(w.indexOf('await prepaidDeduct(', at)).toBeGreaterThan(w.indexOf('INSERT INTO campaigns (', at));
    expect(w.slice(at - 400, at)).toContain("ac.channel !== 'alimtalk'");
    expect(w.slice(at, at + 600)).toContain('await markFailed(ac, autoSpam.notice);');
  });

  it('여정: 단축 URL · 차감 앞 · 그 실행만 실패로 남기고 여정은 멈추지 않는다', () => {
    const j = read('utils/journey-executor.ts');
    const at = j.indexOf('checkSpamBlockBeforeCharge(');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(j.indexOf('shortenUrlsInText(', at));
    expect(at).toBeLessThan(j.indexOf('await prepaidDeduct(', at));
    const branch = j.slice(at, j.indexOf('shortenUrlsInText(', at));
    expect(branch).toContain("await logFailedStep(exec.execution_id, step.id, 'spam_blocked');");
    expect(branch).toContain('await advanceOrComplete(exec, step, 0);');
    expect(branch).not.toContain('pauseJourney(');
  });

  it('배선 수 = 5 (라우트 2 · 코어 1 · 자동발송 1 · 여정 1) — 새 경로가 생기면 이 숫자부터 바뀐다', () => {
    const count = (s: string) => (s.match(/checkSpamBlockBeforeCharge\(/g) || []).length;
    expect(count(campaigns)).toBe(2);
    expect(count(read('utils/direct-send-core.ts'))).toBe(1);
    expect(count(read('utils/auto-campaign-worker.ts'))).toBe(1);
    expect(count(read('utils/journey-executor.ts'))).toBe(1);
  });
});

describe('★ 관리자 모드 전환 — 전환 길은 하나 · 차단 승격은 지금 기준 검증을 다시 통과해야 한다', () => {
  const admin = read('routes/admin.ts');
  const at = admin.indexOf("router.patch('/spam-block/rules/:id/mode'");
  const body = admin.slice(at, admin.indexOf("router.post('/spam-block/simulate'", at));

  it('차단으로 올릴 때 validateElements 를 다시 돈다 · 전후 값은 한 문장(행 잠금)으로 잡아 감사 기록', () => {
    expect(at).toBeGreaterThan(0);
    expect(body).toMatch(/if \(raw === 'block'\) \{[\s\S]*validateElements\(current\.rows\[0\]\.elements\)/);
    expect(body).toContain('FOR UPDATE');
    expect(body).toContain("action: 'spam_block_rule_mode'");
    expect(body).toContain('invalidateSpamBlockCache();');
  });

  it('규칙 수정(PUT) · 생성(POST)은 모드를 바꾸지 않는다 — 새 규칙은 언제나 탐지', () => {
    const put = admin.slice(admin.indexOf("router.put('/spam-block/rules/:id'"), at);
    expect(put).not.toMatch(/SET[\s\S]*\bmode\s*=/);
    const post = admin.slice(admin.indexOf("router.post('/spam-block/rules'"), admin.indexOf("router.put('/spam-block/rules/:id'"));
    expect(post).toContain("$2::jsonb, 'detect',");
  });

  it('시뮬레이션 입력 = 차단과 같은 함수(composeSpamCheckText)', () => {
    const sim = admin.slice(admin.indexOf("router.post('/spam-block/simulate'"), admin.indexOf("router.get('/spam-block/hits'"));
    expect(sim).toContain('composeSpamCheckText(');
  });
});

describe('★ 소비처 — 차단을 재시도로 돌리지 않는다', () => {
  it('플래너: SPAM_BLOCKED 는 커밋 전 거절(표식을 걷는다)', () => {
    const p = read('utils/planner-executor.ts');
    expect(p).toMatch(/const DEFINITE_NO_COMMIT = new Set\(\[[^\]]*SPAM_BLOCKED_CODE\]\)/);
  });

  it('대행발송: SPAM_BLOCKED 는 문안 확인(test_failed)으로 닫고 담당자에게 알린다 · 재시도 갈래보다 앞', () => {
    const a = read('utils/agency-send-worker.ts');
    const at = a.indexOf('if (code === SPAM_BLOCKED_CODE) {');
    const retry = a.indexOf("await logEvent(row.id, 'dispatch_retry'", at);
    expect(at).toBeGreaterThan(0);
    expect(retry).toBeGreaterThan(at);
    const branch = a.slice(at, retry);
    expect(branch).toContain("if (!await setStatus(row.id, 'test_failed', { ...RELEASE }, token)) return;");
    expect(branch).toContain("await notifyFailed('dispatch_spam_blocked'");
    expect(branch).toContain('DELETE FROM campaign_send_staging');
  });

  it('적재 길목 탐지는 차단 기록을 쓰지 않는다(action 미지정 = detect)', () => {
    const s = read('utils/sms-queue.ts');
    const at = s.indexOf('await logSpamBlockHits({');
    expect(at).toBeGreaterThan(0);
    expect(s.slice(at, s.indexOf('});', at))).not.toContain("action: 'block'");
  });
});
