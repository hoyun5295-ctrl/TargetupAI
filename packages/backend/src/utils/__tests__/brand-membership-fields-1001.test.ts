/**
 * ★ 2026-10-01 활성 필드(CT-18)의 매장코드 = 소속 표 — B-1001-3 · Codex R1 medium
 *   자사몰 연동 회사는 고객 행 store_code 가 전부 비어 고객 행 칸만 세면 매장코드 필드가 꺼졌다 →
 *   엑셀 다운로드·고객 목록에 매장코드 열이 없고, 표시 식(storeCodeDisplayExpr)까지 가지 못했다.
 *   처방: 고객 행 값이 0건이면 범위 안 소속 행 유무로 켠다 · 드롭다운 옵션 = 범위 안 고객의 소속 분류코드.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const seen: Array<{ sql: string; params: any[] }> = [];
let hasMembership = true;
const queryMock = vi.fn(async (sql: string, params: any[] = []) => {
  seen.push({ sql, params });
  if (sql.includes('SELECT EXISTS (SELECT 1 FROM customer_stores cs')) return { rows: [{ has: hasMembership }] };
  if (sql.includes('SELECT DISTINCT cs.store_code FROM customer_stores cs')) return { rows: [{ store_code: '렌즈고고' }, { store_code: '일본이모' }] };
  return { rows: [] }; // 필드 정의·고객 행 COUNT(전부 0)·커스텀 키·샘플 = 없음
});
vi.mock('../../config/database', () => ({ query: (...a: any[]) => (queryMock as any)(...a) }));

import { detectEnabledFields, buildEnabledFieldsPayload, clearEnabledFieldsCache } from '../enabled-fields';

const CO = '00000000-0000-0000-0000-0000000000c1';
const SCOPE = { companyId: CO, scopeWhere: 'company_id = $1 AND is_active = true', scopeParams: [CO] };

beforeEach(() => {
  seen.length = 0;
  hasMembership = true;
  clearEnabledFieldsCache(CO);
});

describe('활성 필드 — 고객 행 매장코드가 전부 비어도 소속이 있으면 매장코드를 켠다', () => {
  it('소속 행 있음 → store_code 필드 포함 · 회사 id 는 맨 뒤 자리표', async () => {
    const { fields } = await detectEnabledFields(SCOPE, { bypassCache: true });
    expect(fields.map((f) => f.field_key)).toContain('store_code');
    const ex = seen.find((x) => x.sql.includes('SELECT EXISTS (SELECT 1 FROM customer_stores cs'))!;
    expect(ex.sql).toContain('cs.company_id = $2 AND cs.customer_id IN (SELECT id FROM customers WHERE company_id = $1 AND is_active = true)');
    expect(ex.params).toEqual([CO, CO]);
  });
  it('소속 행도 없음 → store_code 필드 없음(종전과 같음)', async () => {
    hasMembership = false;
    const { fields } = await detectEnabledFields(SCOPE, { bypassCache: true });
    expect(fields.map((f) => f.field_key)).not.toContain('store_code');
  });
  it('드롭다운 옵션 = 범위 안 고객의 소속 분류코드', async () => {
    const payload: any = await buildEnabledFieldsPayload(SCOPE, { bypassDetectorCache: true });
    expect(payload.options.store_code).toEqual(['렌즈고고', '일본이모']);
    const opt = seen.find((x) => x.sql.includes('SELECT DISTINCT cs.store_code FROM customer_stores cs'))!;
    expect(opt.params).toEqual([CO, CO]);
    expect(seen.some((x) => /SELECT DISTINCT store_code FROM customers/.test(x.sql))).toBe(false);
  });
});
