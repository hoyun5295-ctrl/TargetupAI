/**
 * 싱크 매핑 검증 계약 — 잘못된 매핑이 저장되면 그 대상이 **전량 드롭**된다.
 *
 * ★ 2026-09-02 신설. 회귀 대상 = 아난티 실제 사고:
 *   구매 매핑이 고객 필드(phone·recent_purchase_date)로 채워져 저장됐고, 에이전트가
 *   customer_phone·purchase_date를 못 찾아 98,600건을 통째로 버렸다(성공 0). BUGS B-0902-4.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  SYNC_CUSTOMER_TARGET_FIELDS,
  SYNC_PURCHASE_TARGET_FIELDS,
  SYNC_REQUIRED_TARGET_FIELDS,
  validateSyncMapping,
  validateSyncMappingTarget,
} from '../sync-mapping-fields';

/** 아난티가 실제로 저장하고 있던 구매 매핑(사고 원본 · config.reported.appliedMapping.purchases) */
const ANANTI_BROKEN_PURCHASE_MAPPING = {
  CHEK_TRAN_TEL: 'phone',
  CHEK_TRAN_ADAT: 'recent_purchase_date',
  CHEK_TRAN_AMT: 'recent_purchase_amount',
  CHEK_TRAN_TAMT: 'total_purchase_amount',
  CHEK_TRAN_RNAME: 'name',
  CHEK_TRAN_TEL2: 'store_phone',
  CHEK_TRAN_SEQ: 'custom_3',
};

describe('구매 매핑 검증 — 아난티 사고 회귀', () => {
  it('고객 필드로 채운 구매 매핑을 잡는다 (98,600건 전량 드롭의 원인)', () => {
    const issues = validateSyncMappingTarget('purchases', ANANTI_BROKEN_PURCHASE_MAPPING, { requireAll: true });
    expect(issues.length).toBeGreaterThan(0);
  });

  it('필수 필드 두 개가 없다는 것을 콕 집어 말한다', () => {
    const issues = validateSyncMappingTarget('purchases', ANANTI_BROKEN_PURCHASE_MAPPING, { requireAll: true });
    const missing = issues.filter((i) => i.kind === 'missing_required').map((i) => i.message).join(' ');
    expect(missing).toContain('customer_phone');
    expect(missing).toContain('purchase_date');
  });

  it('다른 대상의 필드를 썼다고 알려 준다 (담당자가 무엇을 고칠지 알아야 한다)', () => {
    const issues = validateSyncMappingTarget('purchases', { CHEK_TRAN_TEL: 'phone' }, { requireAll: false });
    expect(issues[0].kind).toBe('unknown_field');
    expect(issues[0].message).toContain('customers 필드');
  });

  it('올바른 구매 매핑은 통과한다', () => {
    const ok = {
      CHEK_TRAN_TEL: 'customer_phone',
      CHEK_TRAN_ADAT: 'purchase_date',
      CHEK_TRAN_TOT: 'total_amount',
      CHEK_TRAN_GNAME: 'product_name',
      CHEK_TRAN_SEQ: 'custom_3',
    };
    expect(validateSyncMappingTarget('purchases', ok, { requireAll: true })).toEqual([]);
  });

  it('필수 필드가 하나만 빠져도 잡는다', () => {
    const issues = validateSyncMappingTarget('purchases', { A: 'customer_phone', B: 'total_amount' }, { requireAll: true });
    expect(issues.some((i) => i.kind === 'missing_required' && i.message.includes('purchase_date'))).toBe(true);
  });
});

describe('고객 매핑 검증', () => {
  it('phone 없는 고객 매핑을 잡는다 (전량 드롭 조건)', () => {
    const issues = validateSyncMappingTarget('customers', { CM_NAME: 'name' }, { requireAll: true });
    expect(issues.some((i) => i.kind === 'missing_required' && i.message.includes('phone'))).toBe(true);
  });

  it('아난티의 실제 고객 매핑은 정상이다 (고객 싱크는 실제로 돌고 있었다)', () => {
    const ananti = {
      CM_NO: 'custom_1', CM_NAME: 'name', CM_BIRTH: 'birth_date',
      CM_LDATE: 'recent_purchase_date', CM_PHONE: 'phone', CM_HADDR1: 'address',
    };
    expect(validateSyncMappingTarget('customers', ananti, { requireAll: true })).toEqual([]);
  });

  it('구매 전용 필드를 고객 매핑에 쓰면 잡는다 (반대 방향도 막는다)', () => {
    const issues = validateSyncMappingTarget('customers', { X: 'phone', Y: 'customer_phone' }, { requireAll: true });
    expect(issues.some((i) => i.kind === 'unknown_field' && i.message.includes('purchases 필드'))).toBe(true);
  });
});

describe('부분 갱신(dry-run)에서는 필수 누락으로 막지 않는다', () => {
  it('잘못된 필드는 잡되 필수 누락은 통과 — 진단을 막으면 안 된다', () => {
    const issues = validateSyncMapping({ purchases: { A: 'total_amount' } }, { requireAll: false });
    expect(issues).toEqual([]);
  });
});

describe('프론트 목록과 백엔드 계약이 같은 벌이다', () => {
  // 어긋나면 "화면에서 고를 수 있는데 저장이 거절되는" 상태가 된다(또는 그 반대).
  const FRONT = resolve(__dirname, '../../../../frontend/src/pages/AdminDashboard.tsx');

  const literalsOf = (constName: string): string[] => {
    const src = readFileSync(FRONT, 'utf8');
    const m = src.match(new RegExp(`const ${constName} = \\[([\\s\\S]*?)\\];`));
    if (!m) throw new Error(`${constName}를 프론트에서 찾지 못했다 — 이름이 바뀌었으면 이 테스트도 함께 고친다.`);
    return [...m[1].matchAll(/'([a-z_0-9]+)'/g)].map((x) => x[1]);
  };

  it('구매 대상 필드 목록이 일치한다', () => {
    const backend = SYNC_PURCHASE_TARGET_FIELDS.filter((f) => !f.startsWith('custom_'));
    expect(literalsOf('SYNC_PURCHASE_TARGET_FIELDS')).toEqual(backend);
  });

  it('고객 대상 필드 목록이 일치한다', () => {
    const backend = SYNC_CUSTOMER_TARGET_FIELDS.filter((f) => !f.startsWith('custom_'));
    expect(literalsOf('SYNC_CUSTOMER_TARGET_FIELDS')).toEqual(backend);
  });

  it('필수 필드는 그 대상의 허용 목록 안에 있다', () => {
    for (const f of SYNC_REQUIRED_TARGET_FIELDS.customers) expect(SYNC_CUSTOMER_TARGET_FIELDS).toContain(f);
    for (const f of SYNC_REQUIRED_TARGET_FIELDS.purchases) expect(SYNC_PURCHASE_TARGET_FIELDS).toContain(f);
  });
});
