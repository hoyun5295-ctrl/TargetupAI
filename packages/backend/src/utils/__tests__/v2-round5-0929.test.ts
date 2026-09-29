/**
 * 한줄로 V2 차수 5 (★ 2026-09-29 · Harold 「추천안으로 전부」) — 범위 밖 기록 묶음 계약
 *
 * ① 체험 스팸 검사: 결과가 전부 발송 실패(failed)면 체험 한 칸으로 세지 않는다(세는 두 곳 = CT 하나)
 * ② 앱 수신 보고: 통신사가 실패로 확정한 행(failed)은 앱 보고로 통과가 되지 않는다(청구 판정이 뒤집히지 않게)
 * ③ 통계 화면 3곳: 스팸 검사 발송 실패 행은 성공·비용에서 빠진다(청구 판정 CT)
 * ④ 적재 0 표식 영구(판정 = 닿는 경로 없음): 정산이 캠페인을 failed 로 닫고 발송 입구가 failed 를 막는다 — 그 전제를 고정
 * ⑤ 여정 'sent' 확정 직후 멈춘 발송: 이미 발송됨 경로도 운영 크레딧을 받는다(멱등키)
 * ⑥ 여정 활성 아닌 실행의 '적재 중' 표식: 주기마다 같은 판정 CT 로 정리(전진 없음)
 * ⑦ 수신자별 회신번호 배정 기준: 확정 입구가 판정한 값을 send_config 에 싣고 워커가 그 값을 쓴다
 * ⑧ 스팸 모달 발송 실패 사유: 게이트웨이 반려(94xx)와 통신사 실패를 가른다
 * ⑨ 자동 스팸 검사 대기열: 등록(차감) 전에 문자로 보낼 수 없는 글자를 막는다
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { newDb } from 'pg-mem';

const SRC = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
const codeOnly = (s: string) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

// ── pg-mem: 스팸 검사 두 표 ─────────────────────────────────────────
function spamDb() {
  const db = newDb();
  db.public.none(`
    CREATE TABLE plans (id uuid PRIMARY KEY, spam_filter_enabled boolean);
    CREATE TABLE companies (id uuid PRIMARY KEY, plan_id uuid);
    INSERT INTO plans VALUES ('00000000-0000-0000-0000-0000000000f1', false);
    INSERT INTO companies VALUES ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000f1');
    CREATE TABLE spam_filter_tests (id uuid PRIMARY KEY, company_id uuid NOT NULL, source text);
    CREATE TABLE spam_filter_test_results (id uuid PRIMARY KEY, test_id uuid NOT NULL, carrier text, message_type text, phone text,
      received boolean DEFAULT false, received_at timestamptz, result text);
  `);
  return db;
}
const CO = '00000000-0000-0000-0000-0000000000c1';
const T = (n: number) => `00000000-0000-0000-0000-0000000000${String(10 + n)}`;
const R = (n: number) => `00000000-0000-0000-0000-0000000001${String(10 + n)}`;

const dbState: { client: any } = { client: null };
vi.mock('../../config/database', () => ({
  default: { query: (sql: string, p?: any[]) => dbState.client.query(sql, p), connect: vi.fn() },
  query: (sql: string, p?: any[]) => dbState.client.query(sql, p),
  mysqlQuery: vi.fn(async () => []),
}));

import { spamTrialCountedSql, countSpamTrialsInTx, readSpamTrialStatus, SPAM_TRIAL_SOURCE } from '../spam-trial';
import { isSpamResultBilled, spamResultRowStatus, spamFailDetail, GATEWAY_REJECT_CODES, SPAM_RESULT } from '../sms-result-map';

describe('① 체험 검사 — 전부 발송 실패면 세지 않는다', () => {
  // ⚠ pg-mem 은 바깥 행을 참조하는 서브쿼리(EXISTS … t.id)를 해석하지 못해 조각은 구조로 고정한다(의미 = Codex 적대 검토 대상).
  const frag = spamTrialCountedSql('t');
  it('조각 = 결과 행이 있고(EXISTS) 실패 아닌 행이 없으면(NOT EXISTS) 세지 않는다', () => {
    expect(frag).toBe(
      "NOT (EXISTS (SELECT 1 FROM spam_filter_test_results fx WHERE fx.test_id = t.id)"
      + " AND NOT EXISTS (SELECT 1 FROM spam_filter_test_results fx WHERE fx.test_id = t.id AND (fx.result IS NULL OR fx.result <> 'failed')))",
    );
  });
  it('세는 두 곳이 같은 CT 조각을 쓴다', () => {
    const src = codeOnly(read('utils/spam-trial.ts'));
    expect(src).toContain("COUNT(*) FILTER (WHERE ${spamTrialCountedSql('t')})::int AS used");
    expect(src).toContain("AND t.source = $2 AND ${spamTrialCountedSql('t')}");
    expect(SPAM_TRIAL_SOURCE).toBe('trial');
  });
  it('countSpamTrialsInTx 가 보내는 SQL 에 조각이 들어간다(잠금 안 판정)', async () => {
    const seen: string[] = [];
    await countSpamTrialsInTx({ query: async (sql: string) => { seen.push(sql); return { rows: [{ used: 0 }] }; } }, CO);
    expect(seen[0]).toContain(frag);
  });
  it('readSpamTrialStatus 가 보내는 SQL 에 조각이 들어간다(화면 남은 횟수)', async () => {
    const seen: string[] = [];
    dbState.client = { query: async (sql: string) => { seen.push(sql); return { rows: [{ spam_filter_enabled: false, used: 1, blocked_found: 0 }] }; } };
    const st = await readSpamTrialStatus(CO);
    expect(seen.some((q) => q.includes(frag))).toBe(true);
    expect(st.remaining).toBe(2);
  });
});

describe('② 앱 수신 보고 — 발송 실패 행은 통과가 되지 않는다', () => {
  const route = read('routes/spam-filter.ts');
  const start = route.indexOf('UPDATE spam_filter_test_results\n       SET received = true');
  const sql = route.slice(start, route.indexOf('RETURNING id', start) + 'RETURNING id'.length);

  it('UPDATE 에 failed 제외 조건과 값이 있다', () => {
    expect(sql).toContain('AND (result IS NULL OR result <> $6)');
    expect(route).toContain('[testId, device.carrier, detectedType, SPAM_RESULT.PASS, device.phone, SPAM_RESULT.FAILED]');
  });

  it('실제 실행: failed 행은 그대로 · 대기(NULL)·차단 행은 통과로', async () => {
    const db = spamDb();
    const { Client } = db.adapters.createPg();
    const c = new Client(); await c.connect();
    await c.query(`INSERT INTO spam_filter_tests VALUES ($1, $2, 'manual')`, [T(1), CO]);
    const put = (id: string, result: string | null) => c.query(
      `INSERT INTO spam_filter_test_results (id, test_id, carrier, message_type, phone, received, result) VALUES ($1, $2, 'SKT', 'SMS', '01000000000', false, $3)`,
      [id, T(1), result],
    );
    await put(R(1), 'failed');
    let r = await c.query(sql, [T(1), 'SKT', 'SMS', SPAM_RESULT.PASS, '01000000000', SPAM_RESULT.FAILED]);
    expect(r.rowCount ?? r.rows.length).toBe(0);
    expect((await c.query(`SELECT result, received FROM spam_filter_test_results WHERE id = $1`, [R(1)])).rows[0]).toMatchObject({ result: 'failed', received: false });

    await c.query(`DELETE FROM spam_filter_test_results`);
    await put(R(2), null);
    r = await c.query(sql, [T(1), 'SKT', 'SMS', SPAM_RESULT.PASS, '01000000000', SPAM_RESULT.FAILED]);
    expect(r.rows.length).toBe(1);

    await c.query(`DELETE FROM spam_filter_test_results`);
    await put(R(3), 'blocked');
    r = await c.query(sql, [T(1), 'SKT', 'SMS', SPAM_RESULT.PASS, '01000000000', SPAM_RESULT.FAILED]);
    expect(r.rows.length).toBe(1);
  });
});

describe('③ 통계 화면 — 발송 실패 행은 성공·비용에서 빠진다', () => {
  it('판정 함수', () => {
    expect(isSpamResultBilled(null)).toBe(false);
    expect(isSpamResultBilled('failed')).toBe(false);
    expect(isSpamResultBilled('timeout')).toBe(true);
    expect(isSpamResultBilled('blocked')).toBe(true);
    expect(isSpamResultBilled('pass')).toBe(true);
    expect(spamResultRowStatus(null)).toBe('pending');
    expect(spamResultRowStatus('failed')).toBe('fail');
    expect(spamResultRowStatus('timeout')).toBe('success');
  });

  it('campaigns·manage-stats 집계가 청구 판정 CT 로 센다(옛 result IS NOT NULL 잔존 0)', () => {
    const campaigns = codeOnly(read('routes/campaigns.ts'));
    const stats = codeOnly(read('routes/manage-stats.ts'));
    for (const s of [campaigns, stats]) {
      expect(s).not.toMatch(/SUM\(CASE WHEN r\.result IS NOT NULL THEN 1 ELSE 0 END\) as completed/);
      expect(s).toContain("SUM(CASE WHEN ${spamBilledResultSql('r')} THEN 1 ELSE 0 END) as completed");
      expect(s).toContain("SUM(CASE WHEN ${spamFailedResultSql('r')} THEN 1 ELSE 0 END) as failed");
    }
    expect(campaigns).toContain('if (isSpamResultBilled(r.result) && isSpamTestBillable(r.source)) {');
    expect(campaigns).toContain('fail: sfFailed,');
    expect(stats).toContain('(testSummary.sms - testSummary.pending - sfSmsFailed) * cSms + (testSummary.lms - sfLmsFailed) * cLms');
  });

  it('상세 목록 3곳의 상태 = 같은 함수', () => {
    expect(read('routes/campaigns.ts')).toContain('status: spamResultRowStatus(r.result),');
    expect(read('routes/manage-stats.ts')).toContain('status: spamResultRowStatus(r.result),');
    expect(read('routes/admin.ts')).toContain('status: spamResultRowStatus(r.result),');
  });
});

describe('④ 적재 0 표식이 영구여도 되는 전제 — 닫힌 캠페인은 다시 나가지 않는다', () => {
  it('정산이 failed 로 닫고, 발송 입구가 막는 상태에 failed 가 있다', async () => {
    const pending = read('utils/refund-pending.ts');
    const settle = pending.slice(pending.indexOf('export async function settleZeroLoadAsObligation'));
    expect(settle).toContain("SET status = 'failed',");
    const { CAMPAIGN_POST_SEND_STATUSES } = await import('../campaign-sweep-scope');
    expect(CAMPAIGN_POST_SEND_STATUSES).toContain('failed');
    const campaigns = read('routes/campaigns.ts');
    const gate = campaigns.slice(campaigns.indexOf('const startGate = await withCampaignStartLock(id'));
    expect(gate.slice(0, 1500)).toContain("if (CAMPAIGN_POST_SEND_STATUSES.includes(String(alive.rows[0].status))) return { run: null, blocked: 'sent' as const };");
  });
});

describe('⑤⑥ 여정 운영 크레딧 = 확정 전에(Codex 1R high) · 활성 아닌 실행 표식 정리', () => {
  const src = read('utils/journey-executor.ts');
  const claim = read('utils/journey-send-claim.ts');
  it('정상 발송: 크레딧 → 확정 순서', () => {
    const at = src.indexOf('await chargeJourneyOperationCredit(exec, new Date());');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(src.indexOf('const confirmed = await confirmJourneyClaimSent(claimLogId);'));
  });
  it('판정으로 확정하는 세 자리는 모두 beforeConfirm 으로 크레딧을 먼저 받는다(확정 뒤 크레딧 호출 0)', () => {
    const calls = src.match(/resolveJourneyClaim\([^;]*\);/g) || [];
    expect(calls.length).toBe(3);
    for (const c of calls) expect(c).toContain('beforeConfirm: (at) => chargeJourneyOperationCredit(');
    expect(src).not.toContain('await chargeJourneyOperationCredit(exec, resolved.sentAt);');
    expect((src.match(/await chargeJourneyOperationCredit\(/g) || []).length).toBe(1);
  });
  it('CT: 들어갔으면 beforeConfirm → 확정(withStats 면 비용 통계까지 한 문장)', () => {
    const body = claim.slice(claim.indexOf("if (verdict === 'loaded') {"));
    expect(body.indexOf('await opts.beforeConfirm(new Date(claim.sent_at));')).toBeLessThan(body.indexOf('confirmJourneyClaimSent(claimId, { withStats: opts.withStats })'));
    const confirm = claim.slice(claim.indexOf('export async function confirmJourneyClaimSent('), claim.indexOf('export async function resolveJourneyClaim('));
    expect(confirm).toContain('UPDATE journey_executions SET total_cost = total_cost + (SELECT cost FROM confirmed)');
    expect(confirm).toContain('UPDATE journeys SET stats_total_cost = stats_total_cost + (SELECT cost FROM confirmed), updated_at = NOW()');
  });
  it('이미 발송됨 경로는 크레딧을 다시 받지 않는다(모든 확정이 크레딧 뒤)', () => {
    const block = src.slice(src.indexOf('if (alreadySent.rows.length > 0) {'), src.indexOf("return 'skipped_already_sent';", src.indexOf('if (alreadySent.rows.length > 0) {')));
    expect(codeOnly(block)).not.toContain('chargeJourneyOperationCredit');
  });
  const fn = src.slice(src.indexOf('async function resolveOrphanJourneyClaims('), src.indexOf('export function startJourneyExecutor('));
  it('표식 정리: 주기 끝 · 활성 아닌 실행 · 10분 넘은 표식 · withStats · 전진 없음', () => {
    const run = src.slice(src.indexOf('export async function runJourneyExecutor('), src.indexOf('async function resolveOrphanJourneyClaims('));
    expect(run).toContain('await resolveOrphanJourneyClaims()');
    expect(fn).toContain("WHERE l.status = 'sending'");
    expect(fn).toContain("AND NOT (e.status = 'active' AND j.status = 'active')");
    expect(fn).toContain("AND l.sent_at < NOW() - ($1 || ' minutes')::interval");
    expect(fn).toContain('withStats: true,');
    expect(fn).not.toContain('advanceOrComplete(');
    expect(fn).not.toContain('UPDATE journey_executions');
  });
  it('크레딧 키는 여정+날짜(같은 날 두 번 불러도 한 번)', () => {
    expect(src).toContain('idempotencyKey: `journey-operation:${exec.journey_id}:${kstDateTag(sentAt)}`');
  });
});

describe('②-2 스팸 결과 판정 쓰기 = 아직 판정 안 된 행만(Codex 1R high)', () => {
  it('쓰는 자리 6곳이 CT 한 문장을 쓴다 · 조건 없는 id 덮어쓰기 0', () => {
    const route = codeOnly(read('routes/spam-filter.ts'));
    const q = codeOnly(read('utils/spam-test-queue.ts'));
    expect((route.match(/SPAM_RESULT_DECIDE_SQL, \[/g) || []).length).toBe(4);
    expect((q.match(/SPAM_RESULT_DECIDE_SQL, \[/g) || []).length).toBe(2);
    for (const s of [route, q]) expect(s).not.toMatch(/UPDATE spam_filter_test_results SET result = \$[12] WHERE id = \$[12]`/);
  });
  it('실제 실행: 실패·통과·시간 초과로 판정된 행은 그대로 · 대기 행만 쓴다', async () => {
    const { SPAM_RESULT_DECIDE_SQL } = await import('../sms-result-map');
    const db = spamDb();
    const { Client } = db.adapters.createPg();
    const c = new Client(); await c.connect();
    await c.query(`INSERT INTO spam_filter_tests VALUES ($1, $2, 'manual')`, [T(1), CO]);
    const put = (id: string, received: boolean, result: string | null) => c.query(
      `INSERT INTO spam_filter_test_results (id, test_id, received, result) VALUES ($1, $2, $3, $4)`, [id, T(1), received, result]);
    await put(R(1), false, 'failed');
    await put(R(2), true, 'pass');
    await put(R(3), false, null);
    for (const id of [R(1), R(2), R(3)]) await c.query(SPAM_RESULT_DECIDE_SQL, [SPAM_RESULT.TIMEOUT, id]);
    const rows = (await c.query(`SELECT id, result FROM spam_filter_test_results ORDER BY id`)).rows;
    expect(rows.map((r: any) => r.result)).toEqual(['failed', 'pass', 'timeout']);
  });
});

describe('⑦ 수신자별 회신번호 배정 기준 = 확정 입구 판정값', () => {
  it('확정 입구가 판정한 값으로 계획하고 같은 값을 싣는다', () => {
    const campaigns = read('routes/campaigns.ts');
    expect(campaigns).toContain('const commitCallbackUserId = callbackAssignmentUserId((req as any).user?.userType, userId);');
    expect(campaigns).toContain('stagingId, companyId, commitCallbackUserId, dedupEnabled !== false,');
    expect(campaigns).toContain('callbackFilterUserId: commitCallbackUserId ?? null,');
  });

  it('send_config 에 싣는다(null = 제한 없음 · 안 밝히면 싣지 않는다)', async () => {
    const { buildDirectSendCampaignParams } = await import('../direct-send-spec');
    const base = { stagingId: 's', campaignName: 'c', msgType: 'SMS', total: 1 } as any;
    const cfgOf = (spec: any) => { const v = buildDirectSendCampaignParams(spec, { companyId: 'co', userId: 'u' })[15]; return typeof v === 'string' ? JSON.parse(v) : v; };
    expect(cfgOf({ ...base, callbackFilterUserId: null }).callbackFilter).toEqual({ userId: null });
    expect(cfgOf({ ...base, callbackFilterUserId: 'u1' }).callbackFilter).toEqual({ userId: 'u1' });
    expect('callbackFilter' in cfgOf(base)).toBe(false);
  });

  it('워커는 실린 값이 있으면 DB 로 다시 판정하지 않는다', () => {
    const w = read('utils/direct-send-worker.ts');
    const block = w.slice(w.indexOf('const storedCallbackFilter ='), w.indexOf('const split = readStoredSplit(cfg);'));
    expect(block).toContain('? (storedCallbackFilter');
    expect(block).toContain('? storedCallbackFilter.userId');
    expect(block).toContain('SELECT user_type FROM users WHERE id = $1');
  });
});

describe('⑧ 스팸 모달 발송 실패 사유', () => {
  it('94xx = 게이트웨이 반려 · 그 밖 = 통신사', () => {
    expect(GATEWAY_REJECT_CODES).toEqual([9401, 9402, 9403, 9404, 9405, 9406, 9407, 9408, 9409]);
    expect(spamFailDetail(9401)).toEqual({ failKind: 'rejected', failLabel: '문자로 보낼 수 없는 글자(작성 화면에서 확인)' });
    expect(spamFailDetail(8).failKind).toBe('carrier');
  });
  it('상세 조회가 실패 행에만 붙이고 단말 번호는 응답에서 뺀다', () => {
    const route = read('routes/spam-filter.ts');
    const block = route.slice(route.indexOf("router.get('/tests/:id'"), route.indexOf("router.post('/devices'"));
    expect(block).toContain('if (results.rows.some((r: any) => r.result === SPAM_RESULT.FAILED)) {');
    expect(block).toContain('const resultRows = results.rows.map(({ phone: _phone, ...r }: any, i: number) =>');
    expect(block).toContain('results: resultRows');
  });
});

describe('⑨ 자동 스팸 검사 대기열 — 등록(차감) 전 글자 판정', () => {
  it('판정이 트랜잭션·차감보다 앞', () => {
    const q = read('utils/spam-test-queue.ts');
    const fn = q.slice(q.indexOf('export async function enqueueSpamTest('), q.indexOf('export async function refundSpamSendFailures('));
    const gate = fn.indexOf('const unsupportedChars = unsupportedSmsCharCodes(...outgoingTexts);');
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(fn.indexOf("await client.query('BEGIN');"));
    expect(gate).toBeLessThan(fn.indexOf('prepaidDeduct('));
    expect(fn).toContain("errorCode: 'SMS_UNSUPPORTED_CHARS'");
  });
});

describe('⑪~⑭ 화면(폭별 실측 0929 · 390~1920 · 잘림 0 = 타겟 머리 부제목 말줄임 설계 1곳 제외)', () => {
  const FE = join(SRC, '..', '..', 'frontend', 'src');
  const fe = (rel: string) => readFileSync(join(FE, rel), 'utf8');
  it('⑬ 공용 발송 바 = 전용 보조 클래스 · 1280+ 옵션 640~760 · 768~1279 두 줄 · 발신번호는 줄이지 않는다', () => {
    expect(fe('components/direct-send/SendBar.tsx')).toContain('className={`ds-modal__foot ds-modal__foot--send${');
    const css = fe('styles/direct-send.css');
    expect(css).toContain('.ds-modal__foot--send { grid-template-columns: minmax(640px, 760px) minmax(460px, 1fr); }');
    expect(css).toContain('.ds-modal__foot--send .ds-sender { flex-shrink: 0; max-width: calc(100% - 212px); }');
    expect(css).toMatch(/@media \(min-width: 768px\) and \(max-width: 1279px\) \{\s*\.ds-modal__foot--send \{ grid-template-columns: minmax\(0, 1fr\); \}/);
    // 알림톡·브랜드메시지 발송 바(ks-foot)는 건드리지 않는다
    expect(fe('components/AlimtalkSendModal.tsx')).not.toContain('ds-modal__foot--send');
  });
  it('⑭ 본문 왼쪽 열 = 창 폭 55%(최소 500 · 최대 560) · 직접발송·타겟 같은 식', () => {
    expect(fe('styles/direct-send.css')).toContain('grid-template-columns: min(560px, max(500px, 55%)) 1px 1fr;');
    expect(fe('components/TargetSendModal.tsx')).toContain('asideWidth="min(560px, max(500px, 55%))"');
  });
  it('타겟 창 수신자 표 = PC 폭에서 카드 안 스크롤(머리 줄 고정 · 선택삭제 줄 고정) · 휴대폰 폭 = 창 스크롤', () => {
    const t = fe('components/TargetSendModal.tsx');
    expect(t).toContain('<div className="p-4 sm:p-6 flex flex-col min-h-full md:h-full">');
    expect(t).toContain('<div className={`${CUI_SCROLL_X} md:flex-1 md:min-h-0 md:overflow-y-auto`}>');
    expect(t).toContain('<thead className={`${CUI_THEAD} md:sticky md:top-0 md:z-[1]`}>');
    expect(t).toContain('<div className="mt-3 shrink-0 flex justify-between items-center gap-2 flex-wrap">');
    expect(t).toContain('min-h-[420px] md:min-h-[320px]');
  });
  it('발송 바가 있는 창은 휴대폰 폭 전체 화면 · 없는 창은 종전 그대로', () => {
    const shell = fe('components/shared/SendWorkspaceShell.tsx');
    expect(shell).toContain("${freeOnMobile ? 'p-0 md:p-5' : 'p-3 sm:p-5'}");
    expect(shell).toContain("'rounded-[20px] h-[94vh] sm:h-[92vh]'");
  });
  it('⑫ MMS 첨부 창 그라데이션 0', () => {
    expect(fe('components/MmsUploadModal.tsx')).not.toMatch(/gradient|fuchsia/);
  });
  it('⑧ 스팸 모달 = 반려면 「보내지 못했어요」 · 통신사 실패는 옛 문구', () => {
    const m = fe('components/SpamFilterTestModal.tsx');
    expect(m).toContain("if (r.result === 'failed' && r.failKind === 'rejected') return { cls: 'block', chip: '보내지 못했어요'");
    expect(m).toContain("if (r.result === 'failed') return { cls: 'block', chip: '전달 실패', sub: '통신사가 문자를 받지 않았어요' };");
  });
  it('③ 통계 탭 2곳 = 실패·시간초과 표시', () => {
    for (const p of ['components/manage/StatsTab.tsx', 'components/StatsTab-company.tsx']) {
      expect(fe(p)).toContain("t.result === 'failed' ? '실패' : t.result === 'timeout' ? '시간초과' : '대기'");
    }
  });
});
