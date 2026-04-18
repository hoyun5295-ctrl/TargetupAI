/**
 * Mock DB 커넥터
 * 실제 DB 없이 개발/테스트용 가짜 데이터 제공
 */

import type { IDbConnector, DbConnectionConfig, RawRow, ColumnInfo } from './types';
import { getLogger } from '../logger';

const logger = getLogger('db:mock');

// ─── 가짜 고객 데이터 ───────────────────────────────────

const MOCK_CUSTOMERS: RawRow[] = [
  { CUST_HP: '010-1234-5678', CUST_NM: '김영희', SEX_CD: '여', BIRTH_DT: '19850315', GRADE_CD: 'VIP고객', ADDR: '서울특별시 강남구', SMS_YN: 'Y', EMAIL: 'kim@test.com', POINT: 15000, STORE_CD: 'S001', STORE_NM: '강남점', LAST_BUY_DT: '2024-12-20', LAST_BUY_AMT: '₩150,000원', TOT_BUY_AMT: '2,500,000', BUY_CNT: 23, updated_at: '2025-02-01 10:00:00' },
  { CUST_HP: '01098765432', CUST_NM: '박철수', SEX_CD: '남자', BIRTH_DT: '1990.07.22', GRADE_CD: 'gold', ADDR: '경기도 수원시', SMS_YN: '1', EMAIL: 'park@test.com', POINT: 8500, STORE_CD: 'S002', STORE_NM: '수원점', LAST_BUY_DT: '20241215', LAST_BUY_AMT: '85000', TOT_BUY_AMT: '1200000', BUY_CNT: 15, updated_at: '2025-02-01 11:00:00' },
  { CUST_HP: '+82-10-5555-1234', CUST_NM: '이민수', SEX_CD: 'M', BIRTH_DT: '1978/11/03', GRADE_CD: '실버', ADDR: '부산광역시 해운대구', SMS_YN: 'Y', EMAIL: 'lee@test.com', POINT: 3200, STORE_CD: 'S003', STORE_NM: '해운대점', LAST_BUY_DT: '2024-12-28', LAST_BUY_AMT: '₩45,000', TOT_BUY_AMT: '650,000', BUY_CNT: 8, updated_at: '2025-02-02 09:00:00' },
  { CUST_HP: '82-10-3333-4444', CUST_NM: '정수진', SEX_CD: 'female', BIRTH_DT: '2000.01.15', GRADE_CD: 'V.I.P', ADDR: '대전시', SMS_YN: 'N', EMAIL: 'jung@test.com', POINT: 22000, STORE_CD: 'S001', STORE_NM: '강남점', LAST_BUY_DT: '2025-01-05', LAST_BUY_AMT: '320000', TOT_BUY_AMT: '4500000', BUY_CNT: 45, updated_at: '2025-02-03 14:00:00' },
  { CUST_HP: '010.7777.8888', CUST_NM: '최동우', SEX_CD: '1', BIRTH_DT: '19951225', GRADE_CD: '일반', ADDR: '인천광역시 남동구', SMS_YN: 'true', EMAIL: 'choi@test.com', POINT: 500, STORE_CD: 'S004', STORE_NM: '인천점', LAST_BUY_DT: '2024.11.30', LAST_BUY_AMT: '￦25,000원', TOT_BUY_AMT: '180000', BUY_CNT: 3, updated_at: '2025-02-03 16:00:00' },
  { CUST_HP: '01011112222', CUST_NM: '한미래', SEX_CD: '여성', BIRTH_DT: '1988-06-10', GRADE_CD: 'VVIP', ADDR: '서울시 마포구', SMS_YN: 'yes', EMAIL: 'han@test.com', POINT: 50000, STORE_CD: 'S005', STORE_NM: '홍대점', LAST_BUY_DT: '2025-01-20', LAST_BUY_AMT: '890,000', TOT_BUY_AMT: '12000000', BUY_CNT: 89, updated_at: '2025-02-04 10:00:00' },
  { CUST_HP: '010-9999-0000', CUST_NM: '서준호', SEX_CD: 'man', BIRTH_DT: '1972/04/08', GRADE_CD: 'platinum', ADDR: '제주특별자치도', SMS_YN: '0', EMAIL: 'seo@test.com', POINT: 35000, STORE_CD: 'S006', STORE_NM: '제주점', LAST_BUY_DT: '2025-01-15', LAST_BUY_AMT: '₩1,200,000', TOT_BUY_AMT: '8500000', BUY_CNT: 62, updated_at: '2025-02-05 08:00:00' },
  { CUST_HP: '01044445555', CUST_NM: '윤서연', SEX_CD: '2', BIRTH_DT: '19930830', GRADE_CD: 'bronze', ADDR: '충청남도 천안시', SMS_YN: 'Y', EMAIL: null, POINT: 1200, STORE_CD: 'S007', STORE_NM: '천안점', LAST_BUY_DT: '2024-10-05', LAST_BUY_AMT: '35000', TOT_BUY_AMT: '420000', BUY_CNT: 6, updated_at: '2025-02-05 12:00:00' },
  { CUST_HP: '', CUST_NM: '전화번호없음', SEX_CD: '남', BIRTH_DT: '19800101', GRADE_CD: 'normal', ADDR: '서울', SMS_YN: 'Y', EMAIL: 'nophone@test.com', POINT: 0, STORE_CD: 'S001', STORE_NM: '강남점', LAST_BUY_DT: '2024-06-01', LAST_BUY_AMT: '10000', TOT_BUY_AMT: '10000', BUY_CNT: 1, updated_at: '2025-02-06 09:00:00' },
  { CUST_HP: '010-6666-7777', CUST_NM: '강하은', SEX_CD: '', BIRTH_DT: '', GRADE_CD: 'new', ADDR: '경상북도 포항시', SMS_YN: '', EMAIL: '', POINT: 0, STORE_CD: 'S008', STORE_NM: '포항점', LAST_BUY_DT: '', LAST_BUY_AMT: '', TOT_BUY_AMT: '0', BUY_CNT: 0, updated_at: '2025-02-06 15:00:00' },
];

// ─── 가짜 구매 데이터 ───────────────────────────────────

const MOCK_PURCHASES: RawRow[] = [
  { CUST_HP: '010-1234-5678', BUY_DT: '2024-12-20 14:30:00', STORE_CD: 'S001', STORE_NM: '강남점', PROD_CD: 'P001', PROD_NM: '프리미엄 세트', QTY: 1, UNIT_PRC: '₩150,000', TOT_AMT: '150,000', updated_at: '2025-02-01 10:00:00' },
  { CUST_HP: '010-1234-5678', BUY_DT: '2024-12-15 11:20:00', STORE_CD: 'S001', STORE_NM: '강남점', PROD_CD: 'P002', PROD_NM: '기본 패키지', QTY: 2, UNIT_PRC: '45000', TOT_AMT: '90,000', updated_at: '2025-02-01 10:00:00' },
  { CUST_HP: '01098765432', BUY_DT: '2024-12-15 16:45:00', STORE_CD: 'S002', STORE_NM: '수원점', PROD_CD: 'P003', PROD_NM: '스페셜 아이템', QTY: 1, UNIT_PRC: '85,000', TOT_AMT: '85000', updated_at: '2025-02-01 11:00:00' },
  { CUST_HP: '+82-10-5555-1234', BUY_DT: '2024-12-28 10:00:00', STORE_CD: 'S003', STORE_NM: '해운대점', PROD_CD: 'P004', PROD_NM: '겨울 한정판', QTY: 3, UNIT_PRC: '￦15,000원', TOT_AMT: '₩45,000원', updated_at: '2025-02-02 09:00:00' },
  { CUST_HP: '82-10-3333-4444', BUY_DT: '2025-01-05 18:30:00', STORE_CD: 'S001', STORE_NM: '강남점', PROD_CD: 'P005', PROD_NM: '신년 기획전', QTY: 1, UNIT_PRC: '320000', TOT_AMT: '320,000', updated_at: '2025-02-03 14:00:00' },
  { CUST_HP: '010.7777.8888', BUY_DT: '2024.11.30 13:15:00', STORE_CD: 'S004', STORE_NM: '인천점', PROD_CD: 'P006', PROD_NM: '베이직 상품', QTY: 5, UNIT_PRC: '5000', TOT_AMT: '25,000', updated_at: '2025-02-03 16:00:00' },
  { CUST_HP: '01011112222', BUY_DT: '2025-01-20 20:00:00', STORE_CD: 'S005', STORE_NM: '홍대점', PROD_CD: 'P007', PROD_NM: 'VVIP 전용 세트', QTY: 1, UNIT_PRC: '890000', TOT_AMT: '890,000', updated_at: '2025-02-04 10:00:00' },
  { CUST_HP: '', BUY_DT: '2024-06-01 09:00:00', STORE_CD: 'S001', STORE_NM: '강남점', PROD_CD: 'P008', PROD_NM: '테스트 상품', QTY: 1, UNIT_PRC: '10000', TOT_AMT: '10000', updated_at: '2025-02-06 09:00:00' },
];

// ─── 컬럼 메타데이터 ────────────────────────────────────

const CUSTOMER_COLUMNS: ColumnInfo[] = [
  { name: 'CUST_HP', dataType: 'varchar', nullable: false, maxLength: 20, isPrimaryKey: true },
  { name: 'CUST_NM', dataType: 'varchar', nullable: true, maxLength: 100 },
  { name: 'SEX_CD', dataType: 'varchar', nullable: true, maxLength: 10 },
  { name: 'BIRTH_DT', dataType: 'varchar', nullable: true, maxLength: 20 },
  { name: 'GRADE_CD', dataType: 'varchar', nullable: true, maxLength: 50 },
  { name: 'ADDR', dataType: 'varchar', nullable: true, maxLength: 200 },
  { name: 'SMS_YN', dataType: 'varchar', nullable: true, maxLength: 5 },
  { name: 'EMAIL', dataType: 'varchar', nullable: true, maxLength: 100 },
  { name: 'POINT', dataType: 'int', nullable: true },
  { name: 'STORE_CD', dataType: 'varchar', nullable: true, maxLength: 50 },
  { name: 'STORE_NM', dataType: 'varchar', nullable: true, maxLength: 100 },
  { name: 'LAST_BUY_DT', dataType: 'varchar', nullable: true, maxLength: 20 },
  { name: 'LAST_BUY_AMT', dataType: 'varchar', nullable: true, maxLength: 20 },
  { name: 'TOT_BUY_AMT', dataType: 'varchar', nullable: true, maxLength: 20 },
  { name: 'BUY_CNT', dataType: 'int', nullable: true },
  { name: 'updated_at', dataType: 'datetime', nullable: true },
];

const PURCHASE_COLUMNS: ColumnInfo[] = [
  { name: 'CUST_HP', dataType: 'varchar', nullable: false, maxLength: 20 },
  { name: 'BUY_DT', dataType: 'datetime', nullable: false },
  { name: 'STORE_CD', dataType: 'varchar', nullable: true, maxLength: 50 },
  { name: 'STORE_NM', dataType: 'varchar', nullable: true, maxLength: 100 },
  { name: 'PROD_CD', dataType: 'varchar', nullable: true, maxLength: 50 },
  { name: 'PROD_NM', dataType: 'varchar', nullable: true, maxLength: 200 },
  { name: 'QTY', dataType: 'int', nullable: true },
  { name: 'UNIT_PRC', dataType: 'varchar', nullable: true, maxLength: 20 },
  { name: 'TOT_AMT', dataType: 'varchar', nullable: true, maxLength: 20 },
  { name: 'updated_at', dataType: 'datetime', nullable: true },
];

// ─── Mock 커넥터 ────────────────────────────────────────

export class MockDbConnector implements IDbConnector {
  readonly dbType = 'mysql' as const;
  private connected = false;

  constructor(_config?: DbConnectionConfig) {
    // config 무시 — Mock이니까
  }

  async connect(): Promise<void> {
    this.connected = true;
    logger.info('🧪 Mock DB 연결됨 (테스트 모드)');
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    logger.info('🧪 Mock DB 연결 해제');
  }

  isConnected(): boolean {
    return this.connected;
  }

  async testConnection(): Promise<boolean> {
    await this.connect();
    logger.info('🧪 Mock DB 연결 테스트 성공');
    return true;
  }

  async getTables(): Promise<string[]> {
    return ['CUSTOMER', 'PURCHASE'];
  }

  async getColumns(tableName: string): Promise<ColumnInfo[]> {
    if (tableName.toUpperCase() === 'CUSTOMER') return CUSTOMER_COLUMNS;
    if (tableName.toUpperCase() === 'PURCHASE') return PURCHASE_COLUMNS;
    return [];
  }

  async fetchIncremental(
    tableName: string,
    timestampColumn: string,
    since: string,
    limit: number,
    offset: number,
  ): Promise<RawRow[]> {
    const data = this.getDataForTable(tableName);
    const sinceDate = new Date(since);

    const filtered = data.filter((row) => {
      const rowDate = new Date(row[timestampColumn] as string);
      return rowDate > sinceDate;
    });

    const paged = filtered.slice(offset, offset + limit);
    logger.info(`🧪 Mock 증분 조회: ${paged.length}건 (since: ${since})`, { tableName });
    return paged;
  }

  async fetchAll(
    tableName: string,
    limit: number,
    offset: number,
  ): Promise<RawRow[]> {
    const data = this.getDataForTable(tableName);
    const paged = data.slice(offset, offset + limit);
    logger.info(`🧪 Mock 전체 조회: ${paged.length}건`, { tableName, offset, limit });
    return paged;
  }

  async getRowCount(tableName: string): Promise<number> {
    return this.getDataForTable(tableName).length;
  }

  private getDataForTable(tableName: string): RawRow[] {
    if (tableName.toUpperCase() === 'CUSTOMER') return MOCK_CUSTOMERS;
    if (tableName.toUpperCase() === 'PURCHASE') return MOCK_PURCHASES;
    return [];
  }
}
