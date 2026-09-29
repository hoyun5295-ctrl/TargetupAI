/**
 * 여정 V2 3차 — 상품 재구매 · 진입 교체 (2026-09-30 · 설계서 §6 · Harold 승인 결정 3)
 *
 * 못 박는 것:
 *   - 계약: 상품 구매 = 상품 고르기 전용(AI 선택 · 프리셋에서 빠짐) · 목표 = 같은 상품 재구매 · 사건마다 다시 받음 · 두 문 커서
 *   - 상품 키 규칙 한 벌(자사몰 productId → productName · 원장 product_code → product_name) — 진입 · 목표 · 목록이 같은 규칙
 *   - 상품 · 문이 없으면 저장 거부(영영 0건 금지) · 저장하면 재진입 켜짐 · 쿨다운 0 · 진입 교체 켜짐 · 목표 product
 *   - 생성기: 상품 없이 상품 트리거 = 거부 · 상품 경로 = 첫 문자 대기 = 확정 사용 기간
 *   - 워커 배선: 상품 자격 필터 · 문 바뀜 = 멈춤 · 진입 교체 = 같은 트랜잭션에서 옛 실행을 닫고 넣는다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

vi.mock('../../config/database', () => ({ query: vi.fn(), pool: { connect: vi.fn() } }));
vi.mock('../company-data-profile', () => ({ getCompanyJourneyFacts: vi.fn(), getCompanyDataProfile: vi.fn().mockResolvedValue(null), formatProfileForAiPrompt: vi.fn(() => '') }));
vi.mock('../../services/ai', () => ({ callAIWithFallback: vi.fn(), getKoreanCalendar: vi.fn(() => '') }));
vi.mock('../company-memory', () => ({ buildMemoryPromptContext: vi.fn().mockResolvedValue('') }));

import { query } from '../../config/database';
import { callAIWithFallback } from '../../services/ai';
import {
  getTriggerContract, isProductPickTrigger, aiSelectableTriggerEvents, goalKindForTrigger, defaultGoalExitFor,
  contractReentryPolicy, storageTemplateCodeFor, laneForTrigger, formatTriggerMenuForAi,
} from '../journey-trigger-capability';
import { resolveCdpCursorEventName, usesPurchaseLedger, classifyJourneyTrigger } from '../journey-cdp-cursor';
import {
  productMatchInRow, mallItemKeySql, ledgerProductKeySql, normalizeProductFilters, qualifyProductBatch, MAX_PRODUCT_KEYS,
} from '../journey-product';
import { usesEntryReplacement } from '../journey-entry-replace';
import { normalizeJourneyOptions } from '../journey-options-validator';
import { describeJourneyTarget } from '../journey-step-format';
import { createJourneyFromTemplate } from '../journey-builder';
import { generateJourneyPackage } from '../journey-ai-generator';
import { JourneyInputError } from '../journey-step-limits';

const q = query as unknown as ReturnType<typeof vi.fn>;
const ai = callAIWithFallback as unknown as ReturnType<typeof vi.fn>;
const SRC = (f: string) => readFileSync(resolve(process.cwd(), 'src/utils', f), 'utf8');
const COMPANY = '22222222-2222-2222-2222-222222222222';
const USER = '33333333-3333-3333-3333-333333333333';
const PF = { product_keys: ['SOAP-01'], product_names: ['샤워비누'], door: 'ledger' };
const MSG = { stepOrder: 1, stepType: 'message' as const, delayHours: 720, channel: 'lms' as const, messageTemplate: '%고객명%님, 샤워비누 다 써 가실 때쯤이라 안부 전해요.', subject: '안부', isAd: true };

function captureInsert() {
  const cap: { journeyParams?: any[]; sql?: string } = {};
  q.mockImplementation(async (sql: string, params?: any[]) => {
    if (/INSERT INTO journeys \(/.test(sql)) { cap.journeyParams = params; cap.sql = sql; return { rows: [{ id: '11111111-1111-1111-1111-111111111111' }] }; }
    if (/INSERT INTO journey_steps/.test(sql)) return { rows: [{ id: '44444444-4444-4444-4444-444444444444' }] };
    return { rows: [], rowCount: 0 };
  });
  return cap;
}
function insertValue(cap: { journeyParams?: any[]; sql?: string }, col: string): any {
  const sql = cap.sql || '';
  const cols = sql.slice(sql.indexOf('(') + 1, sql.indexOf(') VALUES')).split(',').map((c) => c.trim());
  const vals = sql.slice(sql.indexOf('VALUES (') + 8, sql.lastIndexOf(') RETURNING')).split(',').map((v) => v.trim());
  const i = cols.indexOf(col);
  if (i < 0) throw new Error(`INSERT 에 ${col} 컬럼이 없다`);
  const m = vals[i].match(/^\$(\d+)/);
  return m ? cap.journeyParams![Number(m[1]) - 1] : vals[i];
}

beforeEach(() => { q.mockReset(); ai.mockReset(); });

describe('계약', () => {
  it('상품 구매 = 상품 고르기 전용 · 목표 = 같은 상품 재구매 · 사건마다 다시 받음 · 상품 레인', () => {
    const c = getTriggerContract('purchase.product')!;
    expect(c.implemented).toBe(true);
    expect(isProductPickTrigger('purchase.product')).toBe(true);
    expect(aiSelectableTriggerEvents()).not.toContain('purchase.product');
    expect(formatTriggerMenuForAi()).not.toContain('purchase.product');
    expect(goalKindForTrigger('purchase.product')).toBe('product');
    expect(defaultGoalExitFor('purchase.product')).toBe(true);
    expect(contractReentryPolicy('purchase.product')).toEqual({ allowReentry: true, cooldownDays: 0 });
    expect(storageTemplateCodeFor('purchase.product')).toBe('repeat');
    expect(laneForTrigger('purchase.product')).toBe('product');
  });
  it('두 문 커서 경로(구매 스트림) · 커서 이벤트 = purchase', () => {
    expect(resolveCdpCursorEventName('purchase.product')).toBe('purchase');
    expect(usesPurchaseLedger('purchase.product')).toBe(true);
    expect(classifyJourneyTrigger('purchase.product')).toBe('event_cursor');
  });
  it('기존 트리거의 목표 종류 · AI 선택은 그대로', () => {
    expect(goalKindForTrigger('cdp.purchase')).toBe('purchase');
    expect(goalKindForTrigger('customer.points_expiring')).toBe('points_used');
    expect(aiSelectableTriggerEvents()).toContain('cdp.purchase');
  });
});

describe('상품 키 규칙(한 벌)', () => {
  it('자사몰 = productId 먼저 · 없으면 productName · 숫자 id · 앞뒤 공백', () => {
    const keys = new Set(['123', '샤워비누']);
    expect(productMatchInRow({ items: [{ productId: 123, productName: 'X' }] }, keys)).toEqual({ key: '123', name: 'X' });
    expect(productMatchInRow({ items: [{ productId: '', productName: ' 샤워비누 ' }] }, keys)).toEqual({ key: '샤워비누', name: '샤워비누' });
    expect(productMatchInRow({ items: [{ productId: '999', productName: '샤워비누' }] }, keys)).toBeNull();
  });
  it('원장 = product_code 먼저 · 없으면 product_name', () => {
    const keys = new Set(['SOAP-01', '바디워시']);
    expect(productMatchInRow({ product_code: 'SOAP-01', product_name: '샤워비누' }, keys)).toEqual({ key: 'SOAP-01', name: '샤워비누' });
    expect(productMatchInRow({ product_name: '바디워시' }, keys)).toEqual({ key: '바디워시', name: '바디워시' });
    expect(productMatchInRow({ product_code: 'X', product_name: '바디워시' }, keys)).toBeNull();
  });
  it('SQL 조각도 같은 순서(id/코드 먼저 · 빈 값은 다음 후보)', () => {
    const m = mallItemKeySql('it');
    expect(m.indexOf("'productId'")).toBeLessThan(m.indexOf("'productName'"));
    expect(m).toContain('NULLIF(TRIM(');
    const l = ledgerProductKeySql('p');
    expect(l.indexOf('product_code')).toBeLessThan(l.indexOf('product_name'));
    expect(l).toContain('NULLIF(TRIM(');
  });
});

describe('상품 필터 검증', () => {
  it('상품 0개 · 문 없음 · 상한 초과 = 거부', () => {
    expect(() => normalizeProductFilters({ door: 'mall' })).toThrow(JourneyInputError);
    expect(() => normalizeProductFilters({ product_keys: ['a'] })).toThrow(JourneyInputError);
    expect(() => normalizeProductFilters({ product_keys: Array.from({ length: MAX_PRODUCT_KEYS + 1 }, (_, i) => `k${i}`), door: 'mall' })).toThrow(JourneyInputError);
  });
  it('중복 제거 · 이름 짝 맞춤 · 이름 없으면 키', () => {
    expect(normalizeProductFilters({ product_keys: [' a ', 'a', 'b'], product_names: ['에이', '에이2', ''], door: 'ledger' }))
      .toEqual({ product_keys: ['a', 'b'], product_names: ['에이', 'b'], door: 'ledger' });
  });
});

describe('진입 자격(워커 배치)', () => {
  it('고른 상품이 든 구매만 남기고 · 진입 변수 · 사건 id = 그 행', () => {
    const batch: any = { ids: ['c1', 'c2'], propertiesByCustomer: { c1: { a: 1 }, c2: {} }, eventIdByCustomer: { c1: 'e1', c2: 'e3' }, newCursor: { at: '', eventId: null }, truncated: false };
    const rows: any[] = [
      { customerId: 'c1', eventId: 'e1', properties: { items: [{ productId: 'Z' }] } },
      { customerId: 'c1', eventId: 'e2', properties: { items: [{ productId: 'SOAP', productName: '샤워비누' }] } },
      { customerId: 'c2', eventId: 'e3', properties: { product_code: 'OTHER' } },
    ];
    qualifyProductBatch(batch, rows, ['SOAP']);
    expect(batch.ids).toEqual(['c1']);
    expect(batch.propertiesByCustomer.c1).toMatchObject({ product_name: '샤워비누', product_key: 'SOAP' });
    expect(batch.eventIdByCustomer.c1).toBe('e2');
  });
});

describe('저장 경로', () => {
  it('상품이 없으면 거부(만들어도 영영 0건)', async () => {
    captureInsert();
    await expect(createJourneyFromTemplate({ companyId: COMPANY, createdBy: USER, templateCode: 'repeat', callbackNumber: '0200000000', steps: [MSG], triggerEvent: 'purchase.product', triggerFilters: {} } as any))
      .rejects.toBeInstanceOf(JourneyInputError);
  });
  it('상품 저장 = 재진입 켜짐 · 쿨다운 0 · 진입 교체 켜짐 · 목표 product (AI · 화면 값 무시)', async () => {
    const cap = captureInsert();
    await createJourneyFromTemplate({ companyId: COMPANY, createdBy: USER, templateCode: 'repeat', callbackNumber: '0200000000', steps: [MSG], triggerEvent: 'purchase.product', triggerFilters: PF, allowReentry: false, reentryCooldownDays: 30 } as any);
    const tf = JSON.parse(insertValue(cap, 'trigger_filters'));
    expect(tf).toMatchObject({ product_keys: ['SOAP-01'], door: 'ledger', entry_replace: true });
    expect(insertValue(cap, 'allow_reentry')).toBe(true);
    expect(insertValue(cap, 'reentry_cooldown_days')).toBe(0);
    expect(insertValue(cap, 'goal_kind')).toBe('product');
  });
  it('다른 트리거에는 진입 교체를 켜지 않는다(기존 동작)', async () => {
    const cap = captureInsert();
    await createJourneyFromTemplate({ companyId: COMPANY, createdBy: USER, templateCode: 'repeat', callbackNumber: '0200000000', steps: [MSG], triggerEvent: 'cdp.purchase', triggerFilters: {} } as any);
    expect(JSON.parse(insertValue(cap, 'trigger_filters')).entry_replace).toBeUndefined();
  });
});

describe('생성기', () => {
  const AI_JSON = JSON.stringify({ name: '샤워비누 재구매', templateCode: 'repeat', triggerEvent: 'cdp.purchase', steps: [
    { stepOrder: 1, stepType: 'message', delayHours: 72, channel: 'lms', messageTemplate: '%고객명%님, 샤워비누 다 써 가실 때쯤이에요. 편하실 때 들러 주세요.', subject: '안부', isAd: true },
    { stepOrder: 2, stepType: 'message', delayHours: 168, channel: 'sms', messageTemplate: '%고객명%님, 한 번 더 안부 전해요. 좋은 하루 보내세요.', subject: '', isAd: true },
  ] });
  it('상품 없이 상품 트리거로 만들면 거부(1클릭 · 다음 수 경로)', async () => {
    q.mockResolvedValue({ rows: [] });
    await expect(generateJourneyPackage({ companyId: COMPANY, createdBy: USER, preferTriggerEvent: 'purchase.product' })).rejects.toBeInstanceOf(JourneyInputError);
    expect(ai).not.toHaveBeenCalled();
  });
  it('상품 경로 = 대상 = 고른 상품 · 첫 문자 = 확정 사용 기간 뒤 · 진입 교체 켜짐', async () => {
    q.mockResolvedValue({ rows: [] });
    ai.mockResolvedValue(AI_JSON);
    const pkg = await generateJourneyPackage({
      companyId: COMPANY, createdBy: USER, objective: '샤워비누 재구매', preferTriggerEvent: 'purchase.product',
      product: { keys: ['SOAP-01'], names: ['샤워비누'], door: 'ledger', periodDays: 30 },
    });
    expect(pkg.triggerEvent).toBe('purchase.product');
    expect(pkg.triggerFilters).toMatchObject({ product_keys: ['SOAP-01'], door: 'ledger', entry_replace: true });
    expect(pkg.steps[0].delayHours).toBe(720);
    expect(pkg.steps[1].delayHours).toBe(168);
    expect(pkg.targetSummary).toContain('샤워비누');
  });
});

describe('진입 교체 · 옵션', () => {
  it('명시 true 만 켜짐', () => {
    expect(usesEntryReplacement({ entry_replace: true })).toBe(true);
    expect(usesEntryReplacement({ entry_replace: 'true' })).toBe(false);
    expect(usesEntryReplacement({})).toBe(false);
    expect(usesEntryReplacement(null)).toBe(false);
  });
  it('옵션 PATCH 는 불리언으로 정규화해 저장한다', () => {
    expect(normalizeJourneyOptions({ entry_replace: 'true' }).triggerFilters.entry_replace).toBe(true);
    expect(normalizeJourneyOptions({ entry_replace: false }).triggerFilters.entry_replace).toBe(false);
    expect(normalizeJourneyOptions({}).triggerFilters.entry_replace).toBeUndefined();
  });
  it('대상 문장에 고른 상품', () => {
    expect(describeJourneyTarget('purchase.product', { product_names: ['샤워비누', '바디워시', '샴푸', '린스'] })).toBe('대상: 샤워비누 · 바디워시 · 샴푸 외 1개를 산 고객');
  });
});

describe('워커 · 실행기 배선(원문)', () => {
  const watcher = SRC('journey-trigger-watcher.ts');
  const executor = SRC('journey-executor.ts');
  it('상품 자격 필터는 구매 전이 자격 필터 자리(두 문 공용)에 있다', () => {
    const fn = watcher.slice(watcher.indexOf('async function qualifyPurchaseTransition'), watcher.indexOf('async function finishCursorBatch'));
    expect(fn).toContain('qualifyProductBatch(');
    expect((watcher.match(/await qualifyPurchaseTransition\(/g) || []).length).toBe(2);
  });
  it('문이 바뀌거나 상품이 없으면 커서 경로 전에 멈춘다', () => {
    const fn = watcher.slice(watcher.indexOf('async function processJourneyTrigger'), watcher.indexOf('async function resolveCursorWindow'));
    expect(fn.indexOf('currentPurchaseDoor(')).toBeGreaterThan(-1);
    expect(fn.indexOf('currentPurchaseDoor(')).toBeLessThan(fn.indexOf('processCdpCursorJourney('));
    expect(fn).toContain('pauseJourneyForCompany(');
  });
  it('진입 교체 = 같은 트랜잭션에서 옛 실행을 닫은 뒤 넣는다', () => {
    const fn = watcher.slice(watcher.indexOf('async function finishCursorBatch'), watcher.indexOf('async function processPurchaseLedgerJourney'));
    const close = fn.indexOf('CLOSE_ACTIVE_FOR_REPLACEMENT_SQL');
    expect(close).toBeGreaterThan(fn.indexOf("client.query('BEGIN')"));
    expect(close).toBeLessThan(fn.indexOf('INSERT_EXECUTION_SQL'));
    expect(fn).toContain('usesEntryReplacement(j.trigger_filters)');
  });
  it('실행기: 저장된 product 목표만 같은 상품 재구매 판정(상품 없으면 계속)', () => {
    const fn = executor.slice(executor.indexOf('async function isGoalConvertedSinceEntry'), executor.indexOf('async function markExecutionCompleted'));
    expect(fn).toContain("if (v === 'product')");
    expect(fn).toContain('PRODUCT_REPURCHASE_SINCE_ENTRY_SQL');
    expect(fn).toMatch(/if \(productKeys\.length === 0\) return false;/);
  });
});

describe('겹침 해소: 주문 완료 여정에서 첫 구매 고객 빼기', () => {
  it('옵션 키는 불리언으로 저장 · 대상 문장에 드러난다', () => {
    expect(normalizeJourneyOptions({ exclude_first_purchase: 'true' }).triggerFilters.exclude_first_purchase).toBe(true);
    expect(describeJourneyTarget('cdp.purchase', { exclude_first_purchase: true })).toBe('대상: 첫 구매 고객 제외 · 이 사건이 생긴 고객');
  });
  it('워커: 주문 완료 여정이 키를 가질 때만 이전 구매가 있는 고객만 남긴다(키 없는 기존 행 무변경)', () => {
    const w = SRC('journey-trigger-watcher.ts');
    const fn = w.slice(w.indexOf('async function qualifyPurchaseTransition'), w.indexOf('async function finishCursorBatch'));
    expect(fn).toContain("j.trigger_event === 'cdp.purchase' && (j.trigger_filters || {}).exclude_first_purchase === true");
    expect(fn).toMatch(/if \(excludeFirst\) \{\s*batch\.ids = batch\.ids\.filter\(\(id\) => prior\.has\(id\)\);/);
  });
});
