import { describe, it, expect } from 'vitest';
import {
  normalizeSourceRowKey,
  dedupeBySourceRowKey,
  buildPurchaseIngestSql,
  isUndefinedColumnError,
  MAX_SOURCE_ROW_KEY_LEN,
  PurchaseIngestRow,
} from './sync-ingest';

const row = (over: Partial<PurchaseIngestRow> = {}): PurchaseIngestRow => ({
  phone: '01000000000',
  purchase_date: '2026-08-03',
  store_code: 'SP59',
  store_name: '테스트점',
  product_code: 'P1',
  product_name: '상품',
  quantity: 1,
  unit_price: 1000,
  total_amount: 1000,
  source_row_key: null,
  ...over,
});

describe('normalizeSourceRowKey — 원본 행 키는 자르지 않는다', () => {
  it('미지정(옛 에이전트)은 null — legacy 경로로 간다', () => {
    expect(normalizeSourceRowKey(undefined)).toEqual({ ok: true, value: null });
    expect(normalizeSourceRowKey(null)).toEqual({ ok: true, value: null });
    expect(normalizeSourceRowKey('   ')).toEqual({ ok: true, value: null });
  });

  it('숫자 PK도 문자열로 받는다', () => {
    expect(normalizeSourceRowKey(12345)).toEqual({ ok: true, value: '12345' });
  });

  it('상한 초과는 자르지 않고 거부한다 — 자르면 서로 다른 행이 같은 키가 되어 한 건이 사라진다', () => {
    const long = 'A'.repeat(MAX_SOURCE_ROW_KEY_LEN + 1);
    const r = normalizeSourceRowKey(long);
    expect(r.ok).toBe(false);
    expect(normalizeSourceRowKey('A'.repeat(MAX_SOURCE_ROW_KEY_LEN))).toEqual({
      ok: true,
      value: 'A'.repeat(MAX_SOURCE_ROW_KEY_LEN),
    });
  });

  it('객체는 거부한다', () => {
    expect(normalizeSourceRowKey({ a: 1 }).ok).toBe(false);
  });
});

describe('dedupeBySourceRowKey — 한 배치 안 같은 키는 ON CONFLICT를 터뜨린다', () => {
  it('같은 키는 마지막 것만 남는다', () => {
    const out = dedupeBySourceRowKey([
      row({ source_row_key: 'K1', total_amount: 100 }),
      row({ source_row_key: 'K1', total_amount: 200 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].total_amount).toBe(200);
  });

  it('키 없는 행은 서로 지우지 않는다 — 같은 사람이 같은 날 두 번 산 것을 한 건으로 만들지 않는다', () => {
    const out = dedupeBySourceRowKey([row(), row(), row({ source_row_key: 'K1' })]);
    expect(out).toHaveLength(3);
  });

  it('키 행은 키 정렬로 나간다 — 동시 요청이 겹치는 키를 다른 순서로 잠그면 교착이 된다', () => {
    const out = dedupeBySourceRowKey([
      row({ source_row_key: 'B2' }),
      row(),                          // 키 없는 행은 맨 앞 유지
      row({ source_row_key: 'A1' }),
      row({ source_row_key: 'C3' }),
    ]);
    expect(out.map((r) => r.source_row_key)).toEqual([null, 'A1', 'B2', 'C3']);
  });
});

describe('buildPurchaseIngestSql', () => {
  const phoneMap = { '01000000000': 'cust-uuid' };

  it('키가 있으면 부분 유일 인덱스 기반 UPSERT — 행당 12 파라미터', () => {
    const { sql, params } = buildPurchaseIngestSql(
      [row({ source_row_key: 'K1' }), row({ source_row_key: 'K2' })],
      'company-uuid',
      phoneMap,
      true,
    );
    expect(params).toHaveLength(24);
    expect(sql).toContain('source_row_key');
    expect(sql).toContain('ON CONFLICT (company_id, source_row_key) WHERE source_row_key IS NOT NULL');
    expect(sql).toContain('DO UPDATE SET');
  });

  it('⛔ created_at은 갱신 목록에 없다 — 올리면 여정 구매 커서가 이미 발화한 구매를 다시 집는다', () => {
    const { sql } = buildPurchaseIngestSql([row({ source_row_key: 'K1' })], 'c', phoneMap, true);
    const setBlock = sql.slice(sql.indexOf('DO UPDATE SET'));
    expect(setBlock).not.toContain('created_at');
  });

  it('legacy(컬럼 미생성) 경로는 기존과 같은 INSERT — 행당 11 파라미터, ON CONFLICT 없음', () => {
    const { sql, params } = buildPurchaseIngestSql([row()], 'company-uuid', phoneMap, false);
    expect(params).toHaveLength(11);
    expect(sql).not.toContain('source_row_key');
    expect(sql).not.toContain('ON CONFLICT');
  });

  it('customer_id는 phone 조회 결과로 채우고, 못 찾으면 null', () => {
    const { params } = buildPurchaseIngestSql([row({ phone: '01099999999' })], 'c', phoneMap, false);
    expect(params[1]).toBeNull();
    const found = buildPurchaseIngestSql([row()], 'c', phoneMap, false);
    expect(found.params[1]).toBe('cust-uuid');
  });

  it('UPSERT는 기존 customer_id를 지우지 않는다(COALESCE)', () => {
    const { sql } = buildPurchaseIngestSql([row({ source_row_key: 'K1' })], 'c', phoneMap, true);
    expect(sql).toContain('COALESCE(EXCLUDED.customer_id, purchases.customer_id)');
  });
});

describe('isUndefinedColumnError — 배포 직후 DDL 전 구간 판정', () => {
  it('42703이면 참', () => {
    expect(isUndefinedColumnError({ code: '42703' })).toBe(true);
  });

  it('다른 오류는 거짓 — 조용히 legacy로 내려가면 안 된다', () => {
    expect(isUndefinedColumnError({ code: '23505', message: 'duplicate key' })).toBe(false);
    expect(isUndefinedColumnError(new Error('connection terminated'))).toBe(false);
  });
});
