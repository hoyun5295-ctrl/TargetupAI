/**
 * 정산·청구 · 수정세금계산서 (★ 2026-09-27 한줄로 V2 차수 1 BILL·TAX 묶음)
 *
 * m027 일반 발행·일괄발급에 「끝나지 않은 기간」 차단이 없었다(정액 발행에만) → 발행 뒤~기간 끝 발송분이 빠지고 다음 발행은 겹침 차단 = 영구 미청구.
 * R368 기간 충돌 안내가 pg Date를 문자열로 잘라 'Wed Jul 01'처럼 연도 없는 영문이 나갔다.
 * m029 수정 재발행이 정액(기본요금) 장도 사용량 발행으로 다시 만들어 정액보다 적게 청구됐다.
 * R095 수정 재발행이 삭제를 커밋한 뒤 발행을 시도 → 확실히 막히는 사유(기간·결제 방식·겹침·정액 조건)를 삭제 전에 본다.
 * m030 정액 판정(사용량 ≤ 최소과금)이 같은 기간 수량 조정을 몰랐다.
 * m032 확정·수금 → 초안 되돌림이 열려 있어, 되돌린 뒤 삭제가 사유 없이 통과했다.
 * m033 미리보기가 080·수기 추가 항목·080 고정료·수량 조정을 빼고 계산해 실제 발행 금액과 달랐다.
 * m045 사용금액 표시가 「프로 이상 테스트·스팸 무료」로 실제 차감을 빼 적게 보였다.
 * m062 레거시 직접발송 축이 예약·발송 시각 달로만 후보를 뽑아, 월을 넘긴 분할 발송의 다음 달 행이 어느 달에도 안 잡혔다.
 * m063 집계·정산 테이블 = 활성 라인 그룹만 → 라인 그룹을 끄면 그 라인의 과거 발송분이 청구·집계에서 빠졌다.
 * m028 수정세금계산서가 진행 중만 중복으로 봐, 이미 발행된 전액 취소(4·6)를 또 만들 수 있었고 누적 음수 검사가 없었다.
 * S1-H01 발행에 반영된 수량 조정을 지울 수 있어, 재발행 기준 수량(청구 수량 − 반영분)이 틀어졌다.
 * m060 ★Harold 결정 — 테스트 MMS는 회사 MMS 단가로 청구(테스트 브랜드와 같은 방식 · 선불 차감도 MMS 단가).
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const issue = src('billing-issue.ts');
const route = src('..', 'routes', 'billing.ts');
const issueBody = issue.slice(issue.indexOf('export async function issueBilling('), issue.indexOf('export async function issueMinimumChargeBilling('));
const minBody = issue.slice(issue.indexOf('export async function issueMinimumChargeBilling('));
const previewBody = route.slice(route.indexOf("router.get('/preview'"), route.indexOf("router.get('/preview'") + 20000);
const deleteBody = route.slice(route.indexOf('const handleBillingDelete = async'), route.indexOf("router.delete('/:id', handleBillingDelete);"));

vi.mock('../../config/database', () => ({
  default: { query: vi.fn(async () => ({ rows: [] })), connect: vi.fn() },
  pool: { query: vi.fn(async () => ({ rows: [] })), connect: vi.fn() },
  query: vi.fn(async () => ({ rows: [] })),
  mysqlQuery: vi.fn(async () => []),
  mysqlBillingQuery: vi.fn(async () => []),
}));

describe('m027 끝나지 않은 기간 = 발행하지 않는다(일반·정액·미리보기 같은 판정)', () => {
  it('판정 CT: 끝 ≥ 오늘(KST)이면 열린 기간', async () => {
    const { isBillingPeriodOpen } = await import('../billing-issue');
    const now = Date.UTC(2026, 8, 27, 3, 0);   // KST 09-27 12:00
    expect(isBillingPeriodOpen('2026-09-26', now)).toBe(false);
    expect(isBillingPeriodOpen('2026-09-27', now)).toBe(true);
    expect(isBillingPeriodOpen('2026-09-30', now)).toBe(true);
    expect(isBillingPeriodOpen('2026-09-26', Date.UTC(2026, 8, 26, 14, 30))).toBe(true);    // KST 09-26 23:30 = 그날은 아직 열림
    expect(isBillingPeriodOpen('2026-09-26', Date.UTC(2026, 8, 26, 15, 30))).toBe(false);   // KST 09-27 00:30 = 닫힘(UTC 날짜가 아니라 KST)
  });
  it('일반 발행은 기간 충돌 조회 전에 막는다 · 정액·미리보기도 같은 CT', () => {
    const i = issueBody.indexOf('if (isBillingPeriodOpen(billing_end)) {');
    expect(i).toBeGreaterThan(-1);
    expect(i).toBeLessThan(issueBody.indexOf('await readBillingPeriodConflicts(company_id, billing_start, billing_end, input.txClient ?? pool)'));
    expect(issueBody).toContain("code: 'BILLING_PERIOD_OPEN'");
    expect(minBody).toContain('if (isBillingPeriodOpen(billing_end)) {');
    expect(minBody).not.toContain('const kstToday =');
    expect(previewBody).toContain("if (isBillingPeriodOpen(endDate)) block('BILLING_PERIOD_OPEN'");
  });
});

describe('R368 기간 충돌 날짜 = YYYY-MM-DD 문자열', () => {
  it('조회가 날짜를 문자열로 받는다(연도 없는 영문 금지)', async () => {
    const { readBillingPeriodConflicts } = await import('../billing-issue');
    const calls: Array<[string, any[]]> = [];
    const db = { query: vi.fn(async (sql: string, p: any[]) => { calls.push([sql, p]); return { rows: [] }; }) };
    await readBillingPeriodConflicts('c1', '2026-09-01', '2026-09-30', db);
    expect(calls[0][0]).toContain('billing_start::text AS billing_start');
    expect(calls[0][0]).toContain('billing_end::text AS billing_end');
    expect(calls[1][0]).toContain('period_start::text AS period_start');
    expect(calls[0][1]).toHaveLength(3);   // 제외 없음 = 종전 그대로
  });
});

describe('m029 · R095 수정 재발행', () => {
  it('정액 장 표식은 정액 발행 하나만 만든다(상수 하나)', async () => {
    const { MIN_CHARGE_ITEM_TYPE } = await import('../billing-issue');
    expect(MIN_CHARGE_ITEM_TYPE).toBe('EXTRA_BASE_FEE');
    expect(minBody).toContain("'${MIN_CHARGE_ITEM_TYPE}'");
  });
  it('지우는 장이 정액 장이면 정액 발행으로 다시 만든다', () => {
    expect(deleteBody).toContain('MIN_CHARGE_ITEM_TYPE');
    expect(deleteBody).toMatch(/reissueKind === 'min_charge'\s*\?\s*await issueMinimumChargeBilling\(/);
  });
  // ★ Codex BILL 1R high — 삭제 전 점검은 정액 자격 등 검사를 다 베낄 수 없다(두 트랜잭션이 뿌리) → 구조 수정:
  //   발행 코어가 호출자 트랜잭션에 SAVEPOINT로 참여하고, 수정 재발행은 삭제 + 재발행을 한 트랜잭션으로 묶는다.
  it('수정 재발행 = 삭제와 같은 트랜잭션(발행 코어에 txClient) · 막히면 삭제도 되돌린다', () => {
    expect(deleteBody).not.toContain('preflightBillingReissue');
    expect(deleteBody.match(/txClient: client,/g) || []).toHaveLength(2);
    const iIssue = deleteBody.indexOf('out = reissueKind === ');
    const iCommit = deleteBody.indexOf("await client.query('COMMIT');", iIssue);
    expect(iIssue).toBeGreaterThan(deleteBody.indexOf("await client.query('DELETE FROM billings WHERE id = ANY($1::uuid[])', [targetIds]);"));
    expect(iCommit).toBeGreaterThan(iIssue);
    const failPart = deleteBody.slice(deleteBody.indexOf('} catch (reErr: any) {', iIssue), iCommit);
    expect(failPart).toContain("await client.query('ROLLBACK')");
    expect(failPart).toContain('deleted: false,');
    expect(deleteBody).not.toContain('deleted: true,');
    expect(deleteBody).toMatch(/if \(reissueKind === 'usage'\) \{\s*const adjRows = await client\.query\(/);
  });
  it('발행 코어(일반·정액): 호출자 트랜잭션이면 SAVEPOINT · 반납 안 함 · 잠금 전 겹침·무료 공제도 그 연결로', () => {
    expect(issue).not.toContain('export async function preflightBillingReissue(');
    expect(issue).toContain("? { begin: 'SAVEPOINT billing_issue', commit: 'RELEASE SAVEPOINT billing_issue', rollback: 'ROLLBACK TO SAVEPOINT billing_issue' }");
    for (const body of [issueBody, minBody]) {
      expect(body).toContain('const client = outerTx ?? await pool.connect();');
      expect(body).toContain('await client.query(tx.begin);');
      expect(body).toContain('await client.query(tx.commit);');
      expect(body).toContain('await client.query(tx.rollback);');
      expect(body).toContain('if (!outerTx) client.release();');
      expect(body).not.toContain("await client.query('BEGIN');");
    }
    expect(issueBody).toContain('await readBillingPeriodConflicts(company_id, billing_start, billing_end, input.txClient ?? pool)');
    expect(issueBody).toContain('await readFreeDeductibleForBilling(company_id, billing_start, billing_end, input.txClient)');
  });
});

describe('m030 정액 판정에 수량 조정', () => {
  it('일반·정액 발행이 같은 조정 CT를 쓰고, 정액은 조정 포함 사용량으로 판정한다', () => {
    expect(issueBody).toContain('await loadAdjustmentItemsForIssue(client, company_id, billing_start, billing_end, priced.items)');
    expect(minBody).toContain('await loadAdjustmentItemsForIssue(client, company_id, billing_start, billing_end, priced.items)');
    expect(minBody).toMatch(/const usageItems = \[\.\.\.priced\.items, \.\.\.minAdjust\.items\];/);
    expect(minBody).toMatch(/const usageSupply = usageItems\.reduce\(/);
    expect(minBody).toContain('assertNoNegativeAdjusted(usageItems)');
  });
});

describe('m032 확정·수금 → 초안 되돌림 금지', () => {
  it('상태 변경은 초안이 아닌 장을 초안으로 바꾸지 않는다', () => {
    const at = route.indexOf("router.put('/:id/status'");
    const body = route.slice(at, route.indexOf('const handleBillingDelete = async', at));
    expect(body).toContain("WHERE id = $2 AND ($1 <> 'draft' OR status = 'draft')");
    expect(body).toContain("code: 'BILLING_STATUS_REVERT_BLOCKED'");
  });
});

describe('m033 미리보기 = 발행과 같은 추가 항목·수량 조정', () => {
  it('추가 항목 모으기 CT: 잠금은 발행만(미리보기는 FOR UPDATE 없음)', async () => {
    const { collectExtraBillingRows } = await import('../billing-issue');
    const sqls: string[] = [];
    const client = { query: vi.fn(async (sql: string) => { sqls.push(sql); return { rows: [] }; }) };
    await collectExtraBillingRows(client, 'c1', 2026, 8, null, { lockRows: false });
    expect(sqls.some((s) => /INSERT INTO billing_extra_items/.test(s))).toBe(true);   // 080 고정료 근거 자동 생성
    expect(sqls.find((s) => /FROM billing_extra_items e/.test(s))).not.toContain('FOR UPDATE');
    sqls.length = 0;
    await collectExtraBillingRows(client, 'c1', 2026, 8, null, { lockRows: true });
    expect(sqls.find((s) => /FROM billing_extra_items e/.test(s))).toContain('FOR UPDATE OF e');
  });
  it('발행 코어는 CT를 잠금으로 · 미리보기는 되돌리는 트랜잭션 안에서 부르고 금액에 싣는다', () => {
    expect(issueBody).toContain('await collectExtraBillingRows(client, company_id, billing_year, billing_month, adminId, { lockRows: true })');
    expect(previewBody).toContain('await collectExtraBillingRows(dry, companyId, labelYm.year, labelYm.month, null, { lockRows: false })');
    expect(previewBody).toMatch(/await dry\.query\('ROLLBACK'\)/);
    expect(previewBody).toMatch(/const previewItems = \[\.\.\.buildPlanBillingItems\(planSegments\), \.\.\.priced\.items, \.\.\.previewExtraItems, \.\.\.previewAdjustItems\];/);
  });
});

describe('m045 사용금액 = 실제 차감(요금제 예외 없음)', () => {
  it('프로 이상 예외 판정이 없다', () => {
    const m = src('monthly-usage.ts');
    expect(m).not.toContain('isProOrAbove');
    expect(m).toContain("AND (reference_type = 'test' OR reference_id = '00000000-0000-0000-0000-000000000000')");
  });
});

describe('m062 레거시 직접발송 후보 창', () => {
  it('기간 시작 92일 전부터 후보(수량은 발송 시각으로 자르므로 이중 계상 없음)', () => {
    const a = src('send-usage-aggregation.ts');
    const legacy = a.slice(a.indexOf('const legacyDirectResult = await pool.query('), a.indexOf('const journeyResult = await pool.query('));
    expect(legacy).toContain("AND COALESCE(c3.scheduled_at, c3.sent_at) >= (${kstStart('$2')}) - INTERVAL '92 days'");
  });
});

describe('m063 비활성 라인 그룹의 실존 테이블도 집계·정산에', () => {
  it('비활성 그룹 테이블 중 MySQL에 있는 것만', async () => {
    vi.resetModules();
    vi.doMock('../../config/database', () => ({
      query: vi.fn(async (sql: string) => (/is_active = false/.test(sql)
        ? { rows: [{ sms_tables: ['SMSQ_SEND_21', 'SMSQ_SEND_22'] }] } : { rows: [] })),
      mysqlQuery: vi.fn(async () => [{ TABLE_NAME: 'SMSQ_SEND_21' }, { TABLE_NAME: 'SMSQ_SEND_1' }]),
    }));
    const sq = await import('../sms-queue');
    expect(await sq.getInactiveLineGroupTables()).toEqual(['SMSQ_SEND_21']);
    vi.doUnmock('../../config/database');
  });
  it('집계 합집합·정산 테이블이 합친다(발송 경로·비토 발신키 판정은 그대로)', () => {
    const sq = src('sms-queue.ts');
    const all = sq.slice(sq.indexOf('export async function getCompanyAllLiveSmsTables('), sq.indexOf('export async function getCampaignQueueTables('));
    expect(all).toContain('await getInactiveLineGroupTables()');
    const agg = src('send-usage-aggregation.ts');
    expect(agg).toMatch(/getBillingCompanyTables = async[\s\S]{0,300}getInactiveLineGroupTables\(\)/);
    expect(sq.slice(sq.indexOf('export async function getBitoSmsTables('), sq.indexOf('export async function getBitoSmsTables(') + 900)).not.toContain('getInactiveLineGroupTables');
  });
});

describe('m028 수정세금계산서 누적 검사', () => {
  const orig = { supplyAmount: 100000, taxAmount: 10000 };
  const row = (modifyCode: number, s: number, t: number, status = 'issued') => ({ modifyCode, supplyAmount: s, taxAmount: t, status });
  it('전액 취소(4·6)가 이미 있으면 더 만들지 않는다(실패 건 포함 · 취소된 건 제외는 호출부)', async () => {
    const { assertModifyCumulative, ModifyPlanError } = await import('../taxbill-popbill');
    expect(() => assertModifyCumulative(orig, [row(4, -100000, -10000)], [row(6, -100000, -10000)])).toThrow(ModifyPlanError);
    expect(() => assertModifyCumulative(orig, [row(6, -100000, -10000, 'failed')], [row(2, 5000, 500)])).toThrow(/전액 취소/);
  });
  it('발행이 확인되지 않은 증액은 가용 잔액이 아니다(Codex BILL 1R)', async () => {
    const { assertModifyCumulative } = await import('../taxbill-popbill');
    const o = { supplyAmount: 1000000, taxAmount: 100000 };
    // 발행된 감액 −50만 · 실패한 증액 +50만 → 새 감액 −60만은 실제 발행분 기준 −10만
    expect(() => assertModifyCumulative(o, [row(2, -500000, -50000), row(2, 500000, 50000, 'failed')], [row(2, -600000, -60000)])).toThrow(/음수/);
    expect(() => assertModifyCumulative(o, [row(2, -500000, -50000), row(2, 500000, 50000, 'issued')], [row(2, -600000, -60000)])).not.toThrow();
  });
  it('당초 + 기존 수정 + 이번 계획의 누적이 음수면 거절', async () => {
    const { assertModifyCumulative } = await import('../taxbill-popbill');
    expect(() => assertModifyCumulative(orig, [row(2, -60000, -6000)], [row(2, -50000, -5000)])).toThrow(/음수/);
    expect(() => assertModifyCumulative(orig, [row(2, -60000, -6000)], [row(2, -30000, -3000)])).not.toThrow();
    expect(() => assertModifyCumulative(orig, [], [row(1, -100000, -10000), row(1, 90000, 9000)])).not.toThrow();
  });
  it('라우트: 취소 아닌 같은 당초 장 수정분을 모아 계획 뒤 검사', () => {
    const at = route.indexOf("router.post('/taxbill-issues/:id/modify'");
    const body = route.slice(at, route.indexOf("router.post('/taxbill-issues/:id/retry'", at));
    expect(body).toContain("WHERE org_nts_confirm_num = $1 AND kind = 'modify' AND status <> 'cancelled'");
    expect(body.indexOf('assertModifyCumulative(')).toBeGreaterThan(body.indexOf('const planned = planModifyIssue('));
    expect(body.indexOf('assertModifyCumulative(')).toBeLessThan(body.indexOf('INSERT INTO taxbill_issues'));
  });
});

describe('S1-H01 발행에 반영된 수량 조정은 지우지 않는다 · 발행 중 조정은 잠긴다', () => {
  it('조정 조회는 발행 트랜잭션에서 잠그고, 반영 마킹 건수를 검증한다(Codex BILL 1R)', () => {
    const q = src('billing-qty-adjust.ts');
    const fn = q.slice(q.indexOf('export async function loadQtyAdjustments('), q.indexOf('export class QtyAdjustmentError'));
    expect(fn).toContain("${opts.lock ? 'FOR UPDATE' : ''}");
    // 미리보기(되돌리는 트랜잭션)는 잠그지 않는다 — 잠그면 수정 재발행과 교착(Codex BILL 2R)
    expect(previewBody).toContain('loadAdjustmentItemsForIssue(dry, companyId, startDate, endDate, priced.items, { lock: false })');
    expect(issueBody).toMatch(/WHERE id = ANY\(\$2::uuid\[\]\)\s*RETURNING id`/);
    expect(issueBody).toContain("code: 'BILLING_QTY_ADJUST_CHANGED'");
  });
  it('삭제는 미반영만 · 반영분은 409 안내', () => {
    const at = route.indexOf("router.delete('/qty-adjustments/:adjId'");
    const body = route.slice(at, at + 2500);
    expect(body).toContain('DELETE FROM billing_qty_adjustments WHERE id = $1::uuid AND applied_billing_id IS NULL RETURNING id');
    expect(body).toContain("code: 'BILLING_QTY_ADJUST_APPLIED'");
  });
});

describe('m060 테스트 MMS = 회사 MMS 단가', () => {
  it('유형키·단가·미설정·금액 항등식·표시 이름', async () => {
    const { testBillingTypeKey, BILLING_TYPES } = await import('../billing-types');
    expect(testBillingTypeKey('M')).toBe('TEST_MMS');
    expect(testBillingTypeKey('L')).toBe('TEST_LMS');
    expect(BILLING_TYPES.some((t) => t.key === 'TEST_MMS' && t.companyPriceColumn === null)).toBe(true);
    const { resolveBillingUnitPricesDetailed } = await import('../send-usage-aggregation');
    const r = resolveBillingUnitPricesDetailed({ cost_per_sms: 10, cost_per_lms: 30, cost_per_mms: 110 } as any);
    expect(r.prices.TEST_MMS).toBe(r.prices.MMS);   // 회사 MMS 단가(공급가 환산 규칙까지 같은 값)
    expect(r.prices.TEST_MMS).not.toBe(r.prices.TEST_LMS);
    expect(resolveBillingUnitPricesDetailed({ cost_per_sms: 10, cost_per_lms: 30, cost_per_mms: null } as any).unsetKeys).toContain('TEST_MMS');
    expect(issue).toContain('(totalTestMms * prices.TEST_MMS)');
    expect(src('billing-pdf.ts')).toContain("TEST_MMS: '테스트MMS'");
    expect(readFileSync(join(__dirname, '..', '..', '..', '..', 'frontend', 'src', 'pages', 'AdminDashboard.tsx'), 'utf8')).toContain("TEST_MMS: '테스트MMS'");
  });
});
