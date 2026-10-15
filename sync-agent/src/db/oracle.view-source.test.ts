/**
 * OracleConnector 뷰 소스 (★ 2026-10-15 엠티콜렉션 v1.2 회신 대조에서 나온 A·B·D)
 *
 * 엠티 구성 = 뷰 소유자 UBOB3_MTREAL · 읽기 계정 sync_reader 에 GRANT SELECT 만 · 뷰라 PK 메타 없음.
 *   B) user_* 만 보던 목록이 0개 → 권한 받은 표·뷰를 `소유자.이름`으로 노출하고 SQL 은 "소유자"."이름"
 *   A) 지정 키 유일성 검사가 Oracle 에 없어 마법사가 키 단계를 말없이 건너뜀 → GROUP BY 한 번으로 센다
 *   D) 조인·집계 뷰는 ROWID 를 못 줘 전체 동기화가 통째로 실패 → 고유 키 순서로 읽는다
 * 11g 실측 전의 계약 고정이다(실제 오류 번호·속도는 로컬 11g 재현에서 닫는다).
 */
import { describe, it, expect } from 'vitest';
import { OracleConnector } from './oracle';

type Call = { sql: string; binds: any; opts: any };

function makeConnector(execImpl: (sql: string, binds: any) => any) {
  const calls: Call[] = [];
  const conn = {
    execute: async (sql: string, binds?: any, opts?: any) => {
      calls.push({ sql, binds, opts });
      return execImpl(sql, binds);
    },
    close: async () => {},
  };
  const connector = new OracleConnector({
    host: 'h', port: 1521, database: 'MTDB', username: 'SYNC_READER', password: 'x', queryTimeout: 1000,
  } as any);
  (connector as any).pool = { getConnection: async () => conn };
  (connector as any).oracledb = { STRING: 'STRING', OUT_FORMAT_OBJECT: 4002 };
  return { connector, calls };
}

const SALE = 'UBOB3_MTREAL.V_CUSTOMER_SALE';
const SALE_REF = '"UBOB3_MTREAL"."V_CUSTOMER_SALE"';
const isProbe = (sql: string) => /SELECT ROWIDTOCHAR\(ROWID\) AS rid_ FROM/.test(sql);

/** 판매 뷰 메타 — 고유 키 SLIP_NO(문자) + SEQ(숫자) · PK 메타 없음(뷰의 실제 모습) */
function saleMeta(sql: string, binds: any): any {
  if (/all_tab_columns/i.test(sql) && /column_id/i.test(sql)) {
    return {
      rows: [
        { COLUMN_NAME: 'SLIP_NO', DATA_TYPE: 'VARCHAR2', NULLABLE: 'N', DATA_LENGTH: 20, DATA_PRECISION: null, DATA_SCALE: null },
        { COLUMN_NAME: 'SEQ', DATA_TYPE: 'NUMBER', NULLABLE: 'N', DATA_LENGTH: 22, DATA_PRECISION: null, DATA_SCALE: null },
        { COLUMN_NAME: 'AMOUNT', DATA_TYPE: 'NUMBER', NULLABLE: 'Y', DATA_LENGTH: 22, DATA_PRECISION: null, DATA_SCALE: null },
      ],
    };
  }
  if (/all_constraints/i.test(sql)) return { rows: [] };
  if (/SELECT data_type FROM all_tab_columns/i.test(sql)) {
    return { rows: [{ DATA_TYPE: binds.col === 'SEQ' ? 'NUMBER' : 'VARCHAR2' }] };
  }
  return null;
}

const ROWID_ERR = new Error('ORA-01446: cannot select ROWID from, or sample, a view with DISTINCT, GROUP BY, etc.');

describe('B — 권한만 받은 다른 스키마의 표·뷰', () => {
  it('목록에 `소유자.이름`으로 더한다 — 직접·역할 권한만, PUBLIC 은 보지 않고 시퀀스는 뺀다', async () => {
    const { connector, calls } = makeConnector((sql) => {
      if (/user_tab_privs/i.test(sql)) {
        return { rows: [{ NAME: 'UBOB3_MTREAL.V_CUSTOMER_MST' }, { NAME: 'UBOB3_MTREAL.V_CUSTOMER_SALE' }] };
      }
      if (/user_tables/i.test(sql)) return { rows: [{ NAME: 'MY_TABLE' }] };
      return { rows: [] };
    });
    expect(await connector.getTables()).toEqual(['MY_TABLE', 'UBOB3_MTREAL.V_CUSTOMER_MST', 'UBOB3_MTREAL.V_CUSTOMER_SALE']);
    const grantSql = calls.find((c) => /user_tab_privs/i.test(c.sql))!.sql;
    expect(grantSql).toMatch(/role_tab_privs/i);
    expect(grantSql).toMatch(/session_roles/i);
    expect(grantSql).toMatch(/all_sequences/i);
    // 11g 실측: all_objects 조인은 189초+ 로 마법사를 멈춘다
    expect(grantSql).not.toMatch(/all_objects/i);
    expect(grantSql).not.toMatch(/PUBLIC/i);
  });

  it('권한 목록 조회가 실패해도 종전 목록은 그대로 돌려준다', async () => {
    const { connector } = makeConnector((sql) => {
      if (/user_tab_privs/i.test(sql)) throw new Error('ORA-00942: table or view does not exist');
      return { rows: [{ NAME: '고객' }] };
    });
    expect(await connector.getTables()).toEqual(['고객']);
  });

  it('getColumns — `소유자.이름`은 시노님 조회 없이 그 소유자로 all_tab_columns 를 본다', async () => {
    const { connector, calls } = makeConnector((sql, binds) => saleMeta(sql, binds) ?? { rows: [] });
    const cols = await connector.getColumns(SALE);
    expect(cols.map((c) => c.name)).toEqual(['SLIP_NO', 'SEQ', 'AMOUNT']);
    expect(calls.some((c) => /user_synonyms/i.test(c.sql))).toBe(false);
    expect(calls.find((c) => /column_id/i.test(c.sql))!.binds).toEqual({ owner: 'UBOB3_MTREAL', tbl: 'V_CUSTOMER_SALE' });
  });

  it('SQL 에는 "소유자"."이름"으로 들어간다 — 점이 없으면 종전 그대로', async () => {
    const { connector, calls } = makeConnector(() => ({ rows: [{ CNT: 3 }] }));
    await connector.getRowCount(SALE);
    await connector.getRowCount('CUSTOMER');
    expect(calls[0].sql).toContain(`FROM ${SALE_REF}`);
    expect(calls[1].sql).toContain('FROM "CUSTOMER"');
  });

  it('점이 둘 이상인 이름은 거절한다', async () => {
    const { connector } = makeConnector(() => ({ rows: [] }));
    await expect(connector.getRowCount('A.B.C')).rejects.toThrow('표 이름 형식');
  });

  it('키셋 증분 — 타입 조회는 원래 이름(소유자)으로, FROM 은 "소유자"."이름"으로', async () => {
    const { connector, calls } = makeConnector((sql, binds) => {
      if (/SELECT data_type FROM all_tab_columns/i.test(sql)) {
        return { rows: [{ DATA_TYPE: binds.col === 'DM_CHANGE' ? 'DATE' : 'VARCHAR2' }] };
      }
      return { rows: [] };
    });
    await connector.fetchIncrementalKeyset('UBOB3_MTREAL.V_CUSTOMER_MST', 'DM_CHANGE', ['CD_CUSTOMER'], null, 100);
    const typeCalls = calls.filter((c) => /SELECT data_type FROM all_tab_columns/i.test(c.sql));
    expect(typeCalls.map((c) => c.binds.owner)).toEqual(['UBOB3_MTREAL', 'UBOB3_MTREAL']);
    expect(calls[calls.length - 1].sql).toContain('FROM "UBOB3_MTREAL"."V_CUSTOMER_MST" t');
  });
});

describe('A — 지정 키 유일성 실측', () => {
  it('복합 키를 GROUP BY 한 번으로 센다(뷰 1회 읽기)', async () => {
    const { connector, calls } = makeConnector(() => ({ rows: [{ TOTAL: 10, DISTINCT_KEYS: 9, NULL_KEYS: 1 }] }));
    const r = await connector.countKeyUniqueness(SALE, ['SLIP_NO', 'SEQ']);
    expect(r).toEqual({ total: 10, distinct: 9, nulls: 1 });
    expect(calls).toHaveLength(1);
    const sql = calls[0].sql;
    expect(sql).toContain(`FROM ${SALE_REF}`);
    expect(sql).toContain('GROUP BY "SLIP_NO", "SEQ"');
    expect(sql).toContain('CASE WHEN "SLIP_NO" IS NULL OR "SEQ" IS NULL THEN 1 ELSE 0 END');
  });

  it('행이 없으면 0·0·0', async () => {
    const { connector } = makeConnector(() => ({ rows: [{ TOTAL: 0, DISTINCT_KEYS: 0, NULL_KEYS: 0 }] }));
    expect(await connector.countKeyUniqueness('CUST_VIEW', ['CD_CUSTOMER'])).toEqual({ total: 0, distinct: 0, nulls: 0 });
  });
});

describe('D — ROWID 를 못 주는 뷰의 전체 동기화', () => {
  it('ROWID 불가(ORA-01446)면 고유 키 순서로 읽고, 마지막 행 키로 다음 페이지를 잇는다', async () => {
    const pages = [
      [{ SLIP_NO: 'S1', SEQ: '1', AMOUNT: 100 }, { SLIP_NO: 'S1', SEQ: '2', AMOUNT: 50 }],
      [],
    ];
    let page = 0;
    const { connector, calls } = makeConnector((sql, binds) => {
      if (isProbe(sql)) throw ROWID_ERR;
      const meta = saleMeta(sql, binds);
      if (meta) return meta;
      return { rows: pages[page++] ?? [] };
    });

    const first = await connector.fetchAllKeyset(SALE, 2, null, ['SLIP_NO', 'SEQ']);
    expect(first.rows).toHaveLength(2);
    expect(first.lastKey).toBe('["S1","2"]');
    const firstSql = calls.filter((c) => /ORDER BY NLSSORT/.test(c.sql))[0];
    expect(firstSql.sql).toContain(`FROM ${SALE_REF} t`);
    expect(firstSql.sql).toContain('"SLIP_NO" IS NOT NULL AND "SEQ" IS NOT NULL');
    // 문자 키는 이진 순서 · 숫자 키는 그대로
    expect(firstSql.sql).toContain(`ORDER BY NLSSORT("SLIP_NO", 'NLS_SORT=BINARY'), "SEQ"`);
    expect(firstSql.sql).not.toContain(':k0');
    // 지정 키 NUMBER 는 문자열로 받는다(반올림 차단) · 키가 아닌 숫자 컬럼은 그대로
    expect(firstSql.opts.fetchInfo.SEQ).toEqual({ type: 'STRING' });
    expect(firstSql.opts.fetchInfo.AMOUNT).toBeUndefined();

    const second = await connector.fetchAllKeyset(SALE, 2, first.lastKey, ['SLIP_NO', 'SEQ']);
    expect(second.rows).toHaveLength(0);
    expect(second.lastKey).toBeNull();
    const secondSql = calls.filter((c) => /ORDER BY NLSSORT/.test(c.sql))[1];
    expect(secondSql.sql).toContain('("SLIP_NO" > :k0 OR ("SLIP_NO" = :k0 AND ("SEQ" > TO_NUMBER(:k1))))');
    expect(secondSql.binds).toEqual({ lim: 2, k0: 'S1', k1: '2' });
    // ROWID 판정은 표마다 한 번
    expect(calls.filter((c) => isProbe(c.sql))).toHaveLength(1);
  });

  it('ROWID 가 되면 종전 ROWID 경로 그대로', async () => {
    const { connector, calls } = makeConnector((sql, binds) => {
      if (isProbe(sql)) return { rows: [{ RID_: 'AAA' }] };
      return saleMeta(sql, binds) ?? { rows: [{ SLIP_NO: 'S1', RID_: 'AAAB' }] };
    });
    const r = await connector.fetchAllKeyset(SALE, 2, null, ['SLIP_NO', 'SEQ']);
    expect(r.lastKey).toBe('AAAB');
    const main = calls[calls.length - 1].sql;
    expect(main).toContain('ROWIDTOCHAR(t.ROWID) AS rid_');
    expect(main).toContain('CHARTOROWID(:afterKey)');
  });

  it('ROWID 시험의 다른 오류(접속 끊김 등)는 「ROWID 불가」로 보지 않고 그대로 던진다', async () => {
    const { connector } = makeConnector((sql, binds) => {
      if (isProbe(sql)) throw new Error('ORA-03113: end-of-file on communication channel');
      return saleMeta(sql, binds) ?? { rows: [] };
    });
    await expect(connector.fetchAllKeyset(SALE, 2, null, ['SLIP_NO'])).rejects.toThrow('ORA-03113');
  });

  it('ROWID 도 키도 없으면 분명한 오류로 멈춘다(일부만 보내지 않는다)', async () => {
    const { connector } = makeConnector((sql, binds) => {
      if (isProbe(sql)) throw ROWID_ERR;
      return saleMeta(sql, binds) ?? { rows: [] };
    });
    await expect(connector.fetchAllKeyset(SALE, 100, null, [])).rejects.toThrow('고유 키 없이는 전체 동기화를 할 수 없습니다');
    await expect(connector.fetchAll(SALE, 100, 0)).rejects.toThrow('고유 키 없이는 전체 동기화를 할 수 없습니다');
  });

  it('fetchAll 정렬 — ROWID 불가면 키 순서, 키도 없으면 1행 미리보기만 정렬 없이', async () => {
    const { connector, calls } = makeConnector((sql, binds) => {
      if (isProbe(sql)) throw ROWID_ERR;
      return saleMeta(sql, binds) ?? { rows: [] };
    });
    await connector.fetchAll(SALE, 100, 0, ['SLIP_NO', 'SEQ']);
    expect(calls[calls.length - 1].sql).toContain(`FROM ${SALE_REF} ORDER BY NLSSORT("SLIP_NO", 'NLS_SORT=BINARY'), "SEQ"`);
    await connector.fetchAll(SALE, 1, 0);
    const preview = calls[calls.length - 1].sql;
    expect(preview).toContain(`FROM ${SALE_REF}\n`);
    expect(preview).not.toContain('ORDER BY');
  });

  it('fetchAll — ROWID 가 되면 종전처럼 ROWID 정렬', async () => {
    const { connector, calls } = makeConnector((sql, binds) => {
      if (isProbe(sql)) return { rows: [{ RID_: 'AAA' }] };
      return saleMeta(sql, binds) ?? { rows: [] };
    });
    await connector.fetchAll(SALE, 100, 0);
    expect(calls[calls.length - 1].sql).toContain(`FROM ${SALE_REF} ORDER BY ROWID`);
  });
});
