/**
 * integration-scope.test.ts — 자사몰 연동 권한 CT (설계서 docs/2026-09-18-mall-integration-user-scope-design.md §2-1·§2-3·§3-2)
 *
 * 상시 원칙: 고객사 관리자는 회사 전체의 연동을 다루고, 사용자는 자기 분류코드의 연동만 다룬다.
 * ⛔ 분류코드는 요청 본문에서 오지 않는다 — 세션 사용자의 users.store_codes(DB)에서 정한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/database', () => ({ query: vi.fn() }));

import { query } from '../../config/database';
import {
  resolveIntegrationActor,
  canTouchIntegration,
  pickStoreCodeForConnect,
  resolveStoreCodeByOriginHost,
  integrationLockMessage,
} from '../integration-scope';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const q = query as unknown as ReturnType<typeof vi.fn>;

function db(o: { storeCodes?: string[] | null; registry?: string[] | null; originStoreCode?: string | null } = {}) {
  q.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM users')) return { rows: [{ store_codes: o.storeCodes ?? null }] };
    if (sql.includes('FROM companies')) return { rows: [{ store_code_list: o.registry ?? null }] };
    if (sql.includes('FROM company_integrations')) return { rows: o.originStoreCode ? [{ store_code: o.originStoreCode }] : [] };
    return { rows: [] };
  });
}

// ⛔ 블록 본문으로 쓴다 — 화살표가 mock 을 돌려주면 vitest 가 그것을 정리 함수로 알고 테스트 뒤에 인자 없이 호출한다
beforeEach(() => { q.mockReset(); });

describe('resolveIntegrationActor', () => {
  it('회사 관리자 = admin (DB 조회 없이)', async () => {
    db();
    expect(await resolveIntegrationActor({ userId: USER, companyId: COMPANY, userType: 'company_admin' })).toEqual({ kind: 'admin', companyId: COMPANY });
    expect(q).not.toHaveBeenCalled();
  });

  it('분류코드가 배정된 사용자 = user + DB 에서 다시 읽은 코드(공백·빈 값 제거)', async () => {
    db({ storeCodes: [' IROIRO ', '', 'ILBON'] });
    expect(await resolveIntegrationActor({ userId: USER, companyId: COMPANY, userType: 'company_user' }))
      .toEqual({ kind: 'user', companyId: COMPANY, storeCodes: ['IROIRO', 'ILBON'] });
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('FROM users');
    expect(sql).toContain('company_id');          // 남의 회사 사용자 id 로 코드를 읽지 못한다
    expect(params).toEqual([USER, COMPANY]);
  });

  it('분류코드 미배정 사용자 = blocked(NO_STORE_CODE)', async () => {
    db({ storeCodes: null });
    expect(await resolveIntegrationActor({ userId: USER, companyId: COMPANY, userType: 'company_user' })).toEqual({ kind: 'blocked', reason: 'NO_STORE_CODE' });
  });

  it('회사 없는 세션·그 밖의 계정 유형 = blocked', async () => {
    db();
    expect(await resolveIntegrationActor({ userId: USER, userType: 'company_admin' })).toEqual({ kind: 'blocked', reason: 'NO_COMPANY' });
    expect(await resolveIntegrationActor({ userId: USER, companyId: COMPANY, userType: 'super_admin' })).toEqual({ kind: 'blocked', reason: 'NOT_ALLOWED' });
    expect(await resolveIntegrationActor(undefined)).toEqual({ kind: 'blocked', reason: 'NO_COMPANY' });
  });
});

describe('canTouchIntegration', () => {
  const admin = { kind: 'admin', companyId: COMPANY } as const;
  const user = { kind: 'user', companyId: COMPANY, storeCodes: ['IROIRO'] } as const;
  it('관리자는 전부', () => {
    expect(canTouchIntegration(admin, 'IROIRO')).toBe(true);
    expect(canTouchIntegration(admin, null)).toBe(true);
  });
  it('사용자는 자기 분류코드의 몰만 · 회사 공용(분류코드 없음) 몰은 못 다룬다', () => {
    expect(canTouchIntegration(user, 'IROIRO')).toBe(true);
    expect(canTouchIntegration(user, 'ILBON')).toBe(false);
    expect(canTouchIntegration(user, null)).toBe(false);
    expect(canTouchIntegration(user, '')).toBe(false);
  });
  it('blocked 는 아무것도', () => {
    expect(canTouchIntegration({ kind: 'blocked', reason: 'NO_STORE_CODE' }, 'IROIRO')).toBe(false);
  });
});

describe('pickStoreCodeForConnect', () => {
  it('사용자(코드 1개): 요청 값과 무관하게 자기 코드 · 남의 코드를 요청하면 거부', async () => {
    const user = { kind: 'user', companyId: COMPANY, storeCodes: ['IROIRO'] } as const;
    expect(await pickStoreCodeForConnect(user, undefined)).toEqual({ ok: true, storeCode: 'IROIRO' });
    expect(await pickStoreCodeForConnect(user, 'IROIRO')).toEqual({ ok: true, storeCode: 'IROIRO' });
    expect(await pickStoreCodeForConnect(user, 'ILBON')).toEqual({ ok: false, code: 'STORE_CODE_NOT_YOURS' });
  });

  it('사용자(코드 여러 개): 자기 코드 중에서 골라야 한다', async () => {
    const user = { kind: 'user', companyId: COMPANY, storeCodes: ['IROIRO', 'ILBON'] } as const;
    expect(await pickStoreCodeForConnect(user, '')).toEqual({ ok: false, code: 'STORE_CODE_REQUIRED' });
    expect(await pickStoreCodeForConnect(user, 'ILBON')).toEqual({ ok: true, storeCode: 'ILBON' });
    expect(await pickStoreCodeForConnect(user, 'LENS')).toEqual({ ok: false, code: 'STORE_CODE_NOT_YOURS' });
  });

  it('관리자: 비우면 회사 공용(null) · 고르면 등록부에 있는 값만', async () => {
    const admin = { kind: 'admin', companyId: COMPANY } as const;
    db({ registry: ['IROIRO', 'ILBON'] });
    expect(await pickStoreCodeForConnect(admin, '')).toEqual({ ok: true, storeCode: null });
    expect(await pickStoreCodeForConnect(admin, ' ILBON ')).toEqual({ ok: true, storeCode: 'ILBON' });
    expect(await pickStoreCodeForConnect(admin, 'NOPE')).toEqual({ ok: false, code: 'STORE_CODE_UNKNOWN' });
  });

  it('blocked 는 거부', async () => {
    expect(await pickStoreCodeForConnect({ kind: 'blocked', reason: 'NO_STORE_CODE' }, 'IROIRO')).toEqual({ ok: false, code: 'NOT_ALLOWED' });
  });
});

describe('resolveStoreCodeByOriginHost', () => {
  it('브라우저 수집의 Origin 호스트로 그 회사 연동 행의 분류코드를 찾는다(www 제거 = 몰 식별자와 같은 정규화)', async () => {
    db({ originStoreCode: 'IROIRO' });
    expect(await resolveStoreCodeByOriginHost(COMPANY, 'https://www.iroirotokyo.net')).toBe('IROIRO');
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('FROM company_integrations');
    expect(sql).toContain("status <> 'revoked'");
    expect(params).toEqual([COMPANY, 'iroirotokyo.net']);
  });
  it('못 찾거나 호스트가 이상하면 null(현행과 같은 무분류 적재)', async () => {
    db();
    expect(await resolveStoreCodeByOriginHost(COMPANY, 'https://unknown.example')).toBeNull();
    expect(await resolveStoreCodeByOriginHost(COMPANY, '')).toBeNull();
  });
  it('조회 실패는 던지지 않는다(수집을 막지 않는다)', async () => {
    q.mockRejectedValueOnce(new Error('boom'));
    await expect(resolveStoreCodeByOriginHost(COMPANY, 'https://iroirotokyo.net')).resolves.toBeNull();
  });
});

describe('integrationLockMessage — 잠금 사유는 서버가 말한다', () => {
  it('사유마다 문장이 다르고 내부 낱말·줄표가 없다', () => {
    const codes = ['NO_STORE_CODE', 'NOT_ALLOWED', 'NO_COMPANY', 'STORE_CODE_REQUIRED', 'STORE_CODE_NOT_YOURS', 'STORE_CODE_UNKNOWN', 'MALL_OWNED_BY_OTHER_STORE', 'STORE_CODE_CHANGE_NOT_SUPPORTED'] as const;
    const msgs = codes.map((c) => integrationLockMessage(c));
    expect(new Set(msgs).size).toBe(codes.length);
    for (const m of msgs) {
      expect(m.length).toBeGreaterThan(5);
      expect(m).not.toMatch(/store_code|storeCode|—/);
    }
    expect(integrationLockMessage('NO_STORE_CODE')).toContain('분류 코드');
  });
});
