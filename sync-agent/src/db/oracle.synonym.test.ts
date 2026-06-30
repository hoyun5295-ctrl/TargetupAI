/**
 * OracleConnector 시노님(synonym) 지원 테스트
 *
 * 배경(2026-06-30 isae 원격 설치 실측): 고객사가 읽기전용 계정(CRM_VIEW_USER)을 주는데,
 * 이 계정은 본인 소유 테이블이 0개이고 타 스키마(ISUSER2)의 테이블을 시노님으로만 노출한다.
 * 기존 getTables()는 user_tables만 봐서 0개 감지 → 선택 불가, getColumns()는 user_tab_columns만
 * 봐서 시노님 컬럼 0개 → 매핑 불가였다.
 * 데이터 조회(fetch*)는 `FROM "시노님"`을 오라클이 자동 해석하므로 이미 동작 → 메타 2개만 보강.
 */
import { describe, it, expect } from 'vitest';
import { OracleConnector } from './oracle';

function makeConnector(execImpl: (sql: string, binds?: any) => any) {
  const conn = {
    execute: async (sql: string, binds?: any) => execImpl(sql, binds),
    close: async () => {},
  };
  const connector = new OracleConnector({
    host: 'h',
    port: 1521,
    database: 'ISDB',
    username: 'CRM_VIEW_USER',
    password: 'x',
    queryTimeout: 1000,
  } as any);
  (connector as any).pool = { getConnection: async () => conn };
  return connector;
}

describe('OracleConnector 시노님 지원', () => {
  it('getTables — 소유 테이블 0 + 시노님만 있어도 시노님 목록을 반환한다', async () => {
    const connector = makeConnector((sql) => {
      if (/user_tables/i.test(sql) && /user_synonyms/i.test(sql)) {
        return { rows: [{ NAME: '고객' }, { NAME: '고객구매이력' }] };
      }
      return { rows: [] };
    });
    const tables = await connector.getTables();
    expect(tables).toEqual(['고객', '고객구매이력']);
  });

  it('getColumns — 시노님이면 실제 소유자/테이블로 all_tab_columns에서 조회한다', async () => {
    const calls: Array<{ sql: string; binds: any }> = [];
    const connector = makeConnector((sql, binds) => {
      calls.push({ sql, binds });
      if (/user_synonyms/i.test(sql) && /synonym_name/i.test(sql)) {
        return { rows: [{ TABLE_OWNER: 'ISUSER2', TABLE_NAME: '고객' }] };
      }
      if (/all_tab_columns/i.test(sql)) {
        return {
          rows: [
            { COLUMN_NAME: '전화번호', DATA_TYPE: 'VARCHAR2', NULLABLE: 'Y', DATA_LENGTH: 20, DATA_PRECISION: null, DATA_SCALE: null },
            { COLUMN_NAME: '수정일시', DATA_TYPE: 'DATE', NULLABLE: 'Y', DATA_LENGTH: 7, DATA_PRECISION: null, DATA_SCALE: null },
          ],
        };
      }
      if (/all_constraints/i.test(sql)) {
        return { rows: [{ COLUMN_NAME: '전화번호' }] };
      }
      return { rows: [] };
    });

    const cols = await connector.getColumns('고객');
    expect(cols.map((c) => c.name)).toEqual(['전화번호', '수정일시']);
    expect(cols.find((c) => c.name === '전화번호')?.isPrimaryKey).toBe(true);

    const colCall = calls.find((c) => /all_tab_columns/i.test(c.sql));
    expect(colCall?.binds).toMatchObject({ owner: 'ISUSER2', tbl: '고객' });
  });

  it('getColumns — 시노님이 아니면 기존처럼 user_tab_columns에서 조회한다(동작 비악화)', async () => {
    let usedUserTab = false;
    const connector = makeConnector((sql) => {
      if (/user_synonyms/i.test(sql)) return { rows: [] };
      if (/user_tab_columns/i.test(sql)) {
        usedUserTab = true;
        return {
          rows: [
            { COLUMN_NAME: 'PHONE', DATA_TYPE: 'VARCHAR2', NULLABLE: 'N', DATA_LENGTH: 20, DATA_PRECISION: null, DATA_SCALE: null },
          ],
        };
      }
      if (/user_constraints/i.test(sql)) return { rows: [] };
      return { rows: [] };
    });

    const cols = await connector.getColumns('CUSTOMER');
    expect(usedUserTab).toBe(true);
    expect(cols.map((c) => c.name)).toEqual(['PHONE']);
  });
});
