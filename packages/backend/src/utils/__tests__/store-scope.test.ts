/**
 * store-scope.test.ts — CT-02 브랜드(분류코드) 격리 판정 (설계서 docs/2026-09-18-mall-integration-user-scope-design.md §1-2 ③ · §2-7 · §3-6)
 *
 * 이 CT 는 소비처가 8파일 28곳(고객 조회·직접 타겟 발송·자동 캠페인·수신거부·운영 대상)인데 2026-09-18 전까지 테스트가 0개였다.
 * ① 현재 동작 캡처(고치기 전 통과) ② ★0918 변경 1갈래 = "배정은 됐는데 내 코드의 고객이 아직 없고 회사에는 분류 체계가 있다"
 *   → 종전 no_filter(회사 전체가 열림 · 조회뿐 아니라 직접 타겟 발송까지) → filtered(결과 0건 = "아직 내 고객이 없다"가 정답).
 *   인비토 사례(회사 전체 customer_stores 0행 · D136)는 그대로 no_filter.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/database', () => ({ query: vi.fn() }));

import { query } from '../../config/database';
import { getStoreScope } from '../store-scope';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const q = query as unknown as ReturnType<typeof vi.fn>;

interface Db { storeCodes?: string[] | null; myMatch?: boolean; companyHasRows?: boolean; allowFull?: boolean | 'missing_column' }

function db(o: Db) {
  q.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM users')) return { rows: [{ store_codes: o.storeCodes ?? null }] };
    if (sql.includes('customer_stores') && sql.includes('ANY(')) return { rows: [{ has_match: !!o.myMatch }] };
    if (sql.includes('customer_stores')) return { rows: [{ has_stores: !!o.companyHasRows }] };
    if (sql.includes('allow_user_full_access')) {
      if (o.allowFull === 'missing_column') throw new Error('column "allow_user_full_access" does not exist');
      return { rows: [{ allow_user_full_access: o.allowFull === true }] };
    }
    return { rows: [] };
  });
}

beforeEach(() => { q.mockReset(); });

describe('getStoreScope · 현재 동작 캡처', () => {
  it('배정 있음 + 내 코드의 고객이 있음 → filtered(내 코드)', async () => {
    db({ storeCodes: ['CPB'], myMatch: true, companyHasRows: true });
    expect(await getStoreScope(COMPANY, USER)).toEqual({ type: 'filtered', storeCodes: ['CPB'] });
  });

  it('배정 있음 + 회사 전체에 분류 체계가 없음(인비토 · D136) → no_filter', async () => {
    db({ storeCodes: ['JIHYUN'], myMatch: false, companyHasRows: false });
    expect(await getStoreScope(COMPANY, USER)).toEqual({ type: 'no_filter' });
  });

  it('배정 없음 + 분류 체계 있음 + 회사 옵션 꺼짐 → blocked', async () => {
    db({ storeCodes: null, companyHasRows: true, allowFull: false });
    expect(await getStoreScope(COMPANY, USER)).toEqual({ type: 'blocked' });
  });

  it('배정 없음 + 분류 체계 있음 + 회사 옵션 켜짐 → no_filter', async () => {
    db({ storeCodes: [], companyHasRows: true, allowFull: true });
    expect(await getStoreScope(COMPANY, USER)).toEqual({ type: 'no_filter' });
  });

  it('배정 없음 + 분류 체계 있음 + 옵션 컬럼 미마이그레이션 → blocked(false 취급 · db_alter_safety_net)', async () => {
    db({ storeCodes: null, companyHasRows: true, allowFull: 'missing_column' });
    expect(await getStoreScope(COMPANY, USER)).toEqual({ type: 'blocked' });
  });

  it('배정 없음 + 분류 체계 없음 → no_filter', async () => {
    db({ storeCodes: null, companyHasRows: false });
    expect(await getStoreScope(COMPANY, USER)).toEqual({ type: 'no_filter' });
  });
});

describe('getStoreScope · ★0918 변경', () => {
  it('배정 있음 + 내 코드의 고객은 아직 없음 + 회사에는 분류 체계 있음 → filtered(결과 0건) · 회사 전체를 열지 않는다', async () => {
    // 이에스페이먼트: 이로이로도쿄 몰이 먼저 붙어 customer_stores 가 생긴 뒤, 아직 자기 몰을 안 붙인 일본이모 담당자
    db({ storeCodes: ['ILBON'], myMatch: false, companyHasRows: true });
    expect(await getStoreScope(COMPANY, USER)).toEqual({ type: 'filtered', storeCodes: ['ILBON'] });
  });
});
