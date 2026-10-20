// ★ 2026-10-20 시연이 아닌 테스트 회사(인비토)에도 합성 고객·구매를 매일 쌓는다 — 실발송은 그대로.
//   ① 가짜 번호 판정 ② 허용 목록(시연 아닌 회사는 ENV 에 적은 id 만) ③ 매일 워커 다중 키 ④ 삭제 계획 그래프(공용 CT)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const { DEMO, TEST, REAL, keyOwner } = vi.hoisted(() => ({
  DEMO: '11111111-1111-1111-1111-111111111111',
  TEST: 'c7c97996-19b3-4e4f-9c45-ce10deab257f',
  REAL: '33333333-3333-3333-3333-333333333333',
  keyOwner: new Map<string, string>(),
}));

vi.mock('../../config/database', () => {
  const query = vi.fn(async (sql: string, params: any[] = []) => {
    if (/SELECT id FROM companies WHERE api_key = \$1/.test(sql)) {
      const id = keyOwner.get(String(params[0]));
      return { rows: id ? [{ id }] : [] };
    }
    if (/SELECT is_demo FROM companies/.test(sql)) return { rows: [{ is_demo: params[0] === DEMO }] };
    return { rows: [] };
  });
  return { query, pool: { query }, default: { query } };
});

import { isSyntheticPhone, syntheticDataCompanyIds, parseSyntheticSyncKeys, syntheticTargetCompanyIdOfKey, demoPhone } from '../demo-data';
import { buildDeleteGraph, type FkEdge } from '../fk-delete-plan';
import { __resetDemoCompanyCache } from '../demo-company';

const ROOT = join(__dirname, '../../..');

describe('가짜 번호 판정', () => {
  it('합성 번호(010-0xxx · 010-1xxx 미할당 국번)만 가짜로 본다', () => {
    expect(isSyntheticPhone('01000001234')).toBe(true);
    expect(isSyntheticPhone('01010000001')).toBe(true);
    expect(isSyntheticPhone(demoPhone(2999))).toBe(true);
    expect(isSyntheticPhone('01023456789')).toBe(false);
    expect(isSyntheticPhone('01098765432')).toBe(false);
    expect(isSyntheticPhone('0100000123')).toBe(false);
    expect(isSyntheticPhone('010-0000-1234')).toBe(false);
    expect(isSyntheticPhone('')).toBe(false);
    expect(isSyntheticPhone(null)).toBe(false);
  });
});

describe('허용 목록 · 다중 키', () => {
  it('허용 목록 = 쉼표·공백으로 나눈 uuid 만(소문자로)', () => {
    const ids = syntheticDataCompanyIds({ SYNTHETIC_DATA_COMPANY_IDS: ` ${TEST.toUpperCase()}, not-a-uuid ;${REAL}` });
    expect([...ids].sort()).toEqual([REAL, TEST].sort());
    expect(syntheticDataCompanyIds({}).size).toBe(0);
  });

  it('키 = 기존 시연 키 한 쌍 + SYNTHETIC_SYNC_KEYS(키:시크릿 쉼표) · 같은 키는 처음 것 · 모양이 틀린 것은 버린다', () => {
    const keys = parseSyntheticSyncKeys({
      DEMO_SYNC_API_KEY: 'k1', DEMO_SYNC_SECRET: 's1',
      SYNTHETIC_SYNC_KEYS: 'k2:s2, k3:s3 ,broken, :nokey, nosecret:, k1:dup',
    });
    expect(keys).toEqual([{ apiKey: 'k1', apiSecret: 's1' }, { apiKey: 'k2', apiSecret: 's2' }, { apiKey: 'k3', apiSecret: 's3' }]);
    expect(parseSyntheticSyncKeys({ DEMO_SYNC_API_KEY: 'k1' })).toEqual([]);
  });

  beforeEach(() => { keyOwner.clear(); __resetDemoCompanyCache(); });

  it('시연 회사 키는 허용 목록 없이 통과', async () => {
    keyOwner.set('kd', DEMO);
    await expect(syntheticTargetCompanyIdOfKey('kd', new Set())).resolves.toBe(DEMO);
  });
  it('시연이 아닌 회사는 허용 목록에 있을 때만', async () => {
    keyOwner.set('kt', TEST);
    keyOwner.set('kr', REAL);
    await expect(syntheticTargetCompanyIdOfKey('kt', new Set([TEST]))).resolves.toBe(TEST);
    await expect(syntheticTargetCompanyIdOfKey('kr', new Set([TEST]))).rejects.toThrow(/넣지 않았습니다/);
    await expect(syntheticTargetCompanyIdOfKey('kt', new Set())).rejects.toThrow(/넣지 않았습니다/);
  });
  it('어느 회사 키도 아니면 거절', async () => {
    await expect(syntheticTargetCompanyIdOfKey('nobody', new Set([TEST]))).rejects.toThrow(/넣지 않았습니다/);
  });
});

describe('삭제 계획 그래프(fk-delete-plan)', () => {
  const fk = (name: string, child: string, col: string, parent: string, delType: string): FkEdge =>
    ({ name, child, parent, childCols: [col], parentCols: ['id'], delType });
  const fks: FkEdge[] = [
    fk('je_customer', 'journey_executions', 'customer_id', 'customers', 'c'),
    fk('jsl_exec', 'journey_step_logs', 'execution_id', 'journey_executions', 'c'),
    fk('ev_customer', 'cdp_events', 'customer_id', 'customers', 'n'),
    fk('cust_company', 'customers', 'company_id', 'companies', 'c'),
    fk('pur_company', 'purchases', 'company_id', 'companies', 'c'),
  ];
  const companyCond = { pred: '"company_id" = $1::uuid', depth: 1, via: 'company_id' };

  it('고객·구매에서 시작하면 지우는 규칙(CASCADE 등)의 자식만 따라가고, 값만 비우는 자식(SET NULL)·회사 행은 넣지 않는다', () => {
    const g = buildDeleteGraph(fks, new Map([['customers', companyCond], ['purchases', companyCond]]));
    expect([...g.affected].sort()).toEqual(['customers', 'journey_executions', 'journey_step_logs', 'purchases']);
    expect(g.preds.get('customers')!.pred).toBe('("company_id" = $1::uuid)');
    expect(g.preds.get('journey_executions')!.pred).toBe('("customer_id" IN (SELECT "id" FROM "customers" WHERE ("company_id" = $1::uuid)))');
    expect(g.preds.get('journey_step_logs')!.depth).toBe(3);
    expect(g.preds.get('journey_executions')!.depth).toBe(2);
    expect(g.preds.has('cdp_events')).toBe(false);
    expect(g.preds.has('companies')).toBe(false);
  });

  it('회사 통째(퇴역 시연 회사 삭제)도 같은 함수 — 회사 행은 id, company_id 표는 회사 조건 + 외래키 조건', () => {
    const g = buildDeleteGraph(fks, new Map([
      ['companies', { pred: '"id" = $1::uuid', depth: 0, via: '대상 회사' }],
      ['customers', companyCond], ['purchases', companyCond],
    ]));
    expect(g.preds.get('companies')!.pred).toBe('("id" = $1::uuid)');
    expect(g.preds.get('customers')!.pred).toBe('("company_id" = $1::uuid OR "company_id" IN (SELECT "id" FROM "companies" WHERE ("id" = $1::uuid)))');
    expect(g.preds.get('customers')!.depth).toBe(1);
  });

  it('여러 칸 외래키 · 자기참조는 경고로 남긴다', () => {
    const g = buildDeleteGraph([
      ...fks,
      { name: 'multi', child: 'x_table', parent: 'customers', childCols: ['a', 'b'], parentCols: ['id', 'company_id'], delType: 'a' },
      fk('self', 'customers', 'referrer_id', 'customers', 'a'),
    ], new Map([['customers', companyCond]]));
    expect(g.warnings.some((w) => w.startsWith('여러 칸 외래키 multi'))).toBe(true);
    expect(g.cycles.some((c) => c.fk === 'self')).toBe(true);
  });
});

describe('스크립트 계약(소스)', () => {
  const purge = readFileSync(join(ROOT, 'scripts/purge-retired-demo-company.ts'), 'utf-8');
  const reset = readFileSync(join(ROOT, 'scripts/reset-synthetic-test-company.ts'), 'utf-8');
  it('퇴역 시연 회사 삭제는 공용 삭제 계획 CT 를 쓴다(같은 계획기를 두 벌 두지 않는다)', () => {
    expect(purge).toMatch(/from '\.\.\/src\/utils\/fk-delete-plan'/);
    expect(purge).not.toMatch(/const build = \(t: string\)/);
  });
  it('테스트 회사 재설정은 허용 목록 · 시연 아님 · 전원 가짜 번호 · 수신거부 보호 · 점검 건수 일치 뒤에만 지운다', () => {
    expect(reset).toMatch(/syntheticDataCompanyIds\(\)/);
    expect(reset).toMatch(/is_demo/);
    expect(reset).toMatch(/SYNTHETIC_PHONE_PATTERN/);
    expect(reset).toMatch(/PROTECTED_TABLES/);
    expect(reset).toMatch(/'unsubscribes'/);
    expect(reset).toMatch(/--expect=/);
    expect(reset).toMatch(/REPEATABLE READ/);
    expect(reset).toMatch(/from '\.\.\/src\/utils\/fk-delete-plan'/);
  });
});
