import { describe, it, expect } from 'vitest';
import {
  normalizeSourceRowKey,
  dedupeBySourceRowKey,
  buildPurchaseIngestSql,
  normalizePurchaseCustomFields,
  jsonbSafeCustomValues,
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
  custom_fields: null,
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

  it('키가 있으면 부분 유일 인덱스 기반 UPSERT — 행당 13 파라미터', () => {
    const { sql, params } = buildPurchaseIngestSql(
      [row({ source_row_key: 'K1' }), row({ source_row_key: 'K2' })],
      'company-uuid',
      phoneMap,
      true,
    );
    expect(params).toHaveLength(26);
    expect(sql).toContain('source_row_key');
    expect(sql).toContain('ON CONFLICT (company_id, source_row_key) WHERE source_row_key IS NOT NULL');
    expect(sql).toContain('DO UPDATE SET');
  });

  it('⛔ created_at은 갱신 목록에 없다 — 올리면 여정 구매 커서가 이미 발화한 구매를 다시 집는다', () => {
    const { sql } = buildPurchaseIngestSql([row({ source_row_key: 'K1' })], 'c', phoneMap, true);
    const setBlock = sql.slice(sql.indexOf('DO UPDATE SET'));
    expect(setBlock).not.toContain('created_at');
  });

  it('legacy(컬럼 미생성) 경로는 기존과 같은 INSERT — 행당 12 파라미터, ON CONFLICT 없음', () => {
    const { sql, params } = buildPurchaseIngestSql([row()], 'company-uuid', phoneMap, false);
    expect(params).toHaveLength(12);
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

  // ★ 2026-10-15 구매 custom 슬롯 값 — 옛 SQL 에는 custom_fields 가 없어 에이전트가 보낸 값이 전부 버려졌다
  it('custom_fields 는 total_amount 바로 뒤 자리로 적재된다(두 경로 모두)', () => {
    const cf = '{"custom_1":"S-0001"}';
    for (const withKey of [true, false]) {
      const { sql, params } = buildPurchaseIngestSql([row({ custom_fields: cf, source_row_key: 'K1' })], 'c', phoneMap, withKey);
      const cols = sql.slice(sql.indexOf('(') + 1, sql.indexOf(')')).split(',').map((s) => s.trim());
      expect(cols.indexOf('custom_fields')).toBe(cols.indexOf('total_amount') + 1);
      expect(params[cols.indexOf('custom_fields')]).toBe(cf);
    }
  });

  it('재전송은 custom_fields 를 바꾼다(병합 아님 — 매핑에서 뺀 슬롯은 사라진다)', () => {
    const { sql } = buildPurchaseIngestSql([row({ source_row_key: 'K1' })], 'c', phoneMap, true);
    expect(sql.slice(sql.indexOf('DO UPDATE SET'))).toContain('custom_fields  = EXCLUDED.custom_fields');
  });
});

describe('jsonbSafeCustomValues — JSONB 거부 글자만 고친다(고객·구매 custom_fields 공용)', () => {
  it('NUL 은 지우고 짝 없는 서로게이트는 U+FFFD', () => {
    expect(jsonbSafeCustomValues({ custom_1: 'A\u0000B', custom_2: 'x\ud800y', custom_3: 'z\udc00' }))
      .toEqual({ custom_1: 'AB', custom_2: 'x�y', custom_3: 'z�' });
  });

  it('정상 글자(짝 맞는 이모지 포함)·숫자·null·객체는 그대로', () => {
    const v = { custom_1: '회원 😀 001', custom_2: 7, custom_3: null, custom_4: { a: 1 } };
    expect(jsonbSafeCustomValues(v)).toEqual(v);
  });
});

describe('normalizePurchaseCustomFields — 에이전트 구매 custom_fields → JSONB 문자열', () => {
  it('custom_1~15 의 글자·숫자·불리언·null 만 받는다', () => {
    expect(JSON.parse(normalizePurchaseCustomFields({
      custom_1: ' S-0001 ', custom_2: 7, custom_3: true, custom_4: null, custom_15: '2026-10-15',
    }) as string)).toEqual({ custom_1: ' S-0001 ', custom_2: 7, custom_3: true, custom_4: null, custom_15: '2026-10-15' });
  });

  it('슬롯 밖 키(custom_0·custom_16·임의 키)와 객체·배열 값은 버린다', () => {
    expect(normalizePurchaseCustomFields({
      custom_0: 'x', custom_16: 'x', phone: '010', custom_1: { a: 1 }, custom_2: [1], custom_3: 'ok',
    })).toBe('{"custom_3":"ok"}');
  });

  it('JSONB 가 거부하는 글자는 뺀다 — 섞이면 구매 행 전체가 적재 실패', () => {
    expect(JSON.parse(normalizePurchaseCustomFields({ custom_1: 'A\u0000B' }) as string)).toEqual({ custom_1: 'AB' });
  });

  it('없거나 객체가 아니거나 남는 게 없으면 null', () => {
    expect(normalizePurchaseCustomFields(undefined)).toBeNull();
    expect(normalizePurchaseCustomFields(null)).toBeNull();
    expect(normalizePurchaseCustomFields('custom_1')).toBeNull();
    expect(normalizePurchaseCustomFields([{ custom_1: 'x' }])).toBeNull();
    expect(normalizePurchaseCustomFields({ other: 'x' })).toBeNull();
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
