/**
 * sample-customer-scope.test.ts — 개인화 샘플 고객 1명 조회의 분류코드 격리 (★0922 · Harold 지시)
 *
 * 결함(0922 실측): POST /api/campaigns/test-send 가 getStoreScope 로 storeFilter·storeParams 를 만들어 놓고 한 번도 안 썼다.
 *   샘플 고객 조회가 회사 전체를 읽어, 분류코드가 배정된 몰별 사용자(이에스페이먼트 espayment1~4)의 테스트 발송·스팸 테스트에
 *   **다른 몰 고객의 이름·커스텀 필드**가 개인화 치환으로 찍혀 나갔다. 같은 모양 = spam-filter.ts · spam-test-queue.ts 2곳.
 * 규약: 격리 판정 = getStoreScope 하나 · 범위 서브쿼리 한 모양 · 샘플 0명이면 빈 객체(테스트 발송은 막지 않는다) ·
 *       관리자·슈퍼·분류 체계 없는 회사(no_filter)는 SQL·파라미터가 1바이트도 달라지지 않는다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

vi.mock('../../config/database', () => ({ query: vi.fn() }));

import { query } from '../../config/database';
import { getSampleCustomerScope } from '../store-scope';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const q = query as unknown as ReturnType<typeof vi.fn>;

interface Db { dbUserType?: string; storeCodes?: string[] | null; myMatch?: boolean; companyHasRows?: boolean }
function db(o: Db) {
  q.mockImplementation(async (sql: string) => {
    if (sql.includes('user_type')) return { rows: o.dbUserType ? [{ user_type: o.dbUserType }] : [] };
    if (sql.includes('FROM users')) return { rows: [{ store_codes: o.storeCodes ?? null }] };
    if (sql.includes('customer_stores') && sql.includes('ANY(')) return { rows: [{ has_match: !!o.myMatch }] };
    if (sql.includes('customer_stores')) return { rows: [{ has_stores: !!o.companyHasRows }] };
    if (sql.includes('allow_user_full_access')) return { rows: [{ allow_user_full_access: false }] };
    return { rows: [] };
  });
}
beforeEach(() => { q.mockReset(); });

describe('getSampleCustomerScope — 샘플 고객 조회에 붙일 범위 조각', () => {
  it('분류코드 사용자(filtered) → 범위 서브쿼리 한 모양 + 자기 코드 파라미터', async () => {
    db({ storeCodes: ['이로이로도쿄'], myMatch: true, companyHasRows: true });
    const s = await getSampleCustomerScope(COMPANY, USER, { userType: 'company_user', paramIndex: 2 });
    expect(s.where).toBe(' AND id IN (SELECT customer_id FROM customer_stores WHERE company_id = $1 AND store_code = ANY($2::text[]))');
    expect(s.params).toEqual([['이로이로도쿄']]);
  });
  it('관리자·슈퍼 = getStoreScope 를 부르지 않는다 · 빈 조각(기존 SQL 과 1바이트도 같다)', async () => {
    db({});
    for (const userType of ['company_admin', 'super_admin']) {
      expect(await getSampleCustomerScope(COMPANY, USER, { userType, paramIndex: 2 })).toEqual({ where: '', params: [] });
    }
    expect(q).not.toHaveBeenCalled();
  });
  it('분류 체계 없는 회사의 사용자(no_filter) → 빈 조각', async () => {
    db({ storeCodes: null, companyHasRows: false });
    expect(await getSampleCustomerScope(COMPANY, USER, { userType: 'company_user', paramIndex: 2 })).toEqual({ where: '', params: [] });
  });
  it('blocked(분류 체계 있는데 미배정) → 고객을 주지 않는다(AND FALSE) — 샘플은 빈 객체로 떨어지고 다른 몰 고객이 새지 않는다', async () => {
    db({ storeCodes: null, companyHasRows: true });
    expect(await getSampleCustomerScope(COMPANY, USER, { userType: 'company_user', paramIndex: 2 })).toEqual({ where: ' AND FALSE', params: [] });
  });
  it('userType 을 모르는 경로(큐 워커) = users.user_type 으로 판정 — user 만 격리 · admin 은 빈 조각 · 사용자 없음은 빈 조각', async () => {
    db({ dbUserType: 'user', storeCodes: ['렌즈007'], myMatch: true, companyHasRows: true });
    const s = await getSampleCustomerScope(COMPANY, USER, { paramIndex: 2 });
    expect(s.params).toEqual([['렌즈007']]);
    db({ dbUserType: 'admin' });
    expect(await getSampleCustomerScope(COMPANY, USER, { paramIndex: 2 })).toEqual({ where: '', params: [] });
    db({});
    expect(await getSampleCustomerScope(COMPANY, null, { paramIndex: 2 })).toEqual({ where: '', params: [] });
  });
});

describe('소스 계약 — 샘플 고객 조회 4곳이 전부 범위를 탄다(인라인 재구현 0)', () => {
  const SRC = resolve(__dirname, '..', '..');
  const read = (rel: string) => readFileSync(resolve(SRC, rel), 'utf-8');
  const SAMPLE_RE = /FROM customers[^`]*?sms_opt_in = true[^`]*?LIMIT 1`/g;

  it('campaigns.ts test-send: 만들어 둔 storeFilter·storeParams 를 실제로 쓴다($STORE_IDX 치환 · /:id/send 와 같은 모양)', () => {
    const r = read('routes/campaigns.ts');
    const block = r.slice(r.indexOf("router.post('/test-send'"), r.indexOf('// 회신번호 가져오기'));
    expect(block).toContain("storeFilter.replace('$STORE_IDX'");
    const sample = block.match(SAMPLE_RE) || [];
    expect(sample).toHaveLength(1);
    expect(sample[0]).toContain('${testStoreFilterFinal}');
    expect(block).toMatch(/\[companyId, \.\.\.storeParams\]/);
  });
  it('spam-filter.ts · spam-test-queue.ts(2곳): getSampleCustomerScope 조각이 샘플 조회에 붙는다', () => {
    const a = read('routes/spam-filter.ts');
    expect(a).toContain('getSampleCustomerScope(');
    expect((a.match(SAMPLE_RE) || []).every((s) => s.includes('${sampleScope.where}'))).toBe(true);
    expect((a.match(SAMPLE_RE) || []).length).toBe(1);
    const b = read('utils/spam-test-queue.ts');
    expect((b.match(/getSampleCustomerScope\(/g) || []).length).toBe(2);
    const samples = b.match(SAMPLE_RE) || [];
    expect(samples).toHaveLength(2);
    expect(samples.every((s) => s.includes('${sampleScope.where}'))).toBe(true);
  });
  it('격리 판정을 다시 쓰지 않는다 — 세 파일 어디에도 store_codes 직접 조회가 없다', () => {
    for (const f of ['routes/spam-filter.ts', 'utils/spam-test-queue.ts']) {
      expect(read(f)).not.toMatch(/SELECT store_codes FROM users/);
    }
  });
});
