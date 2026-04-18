/**
 * DB 커넥터 공통 인터페이스
 * Strategy 패턴: 모든 DB 커넥터가 이 인터페이스를 구현
 */

export type DbType = 'mssql' | 'mysql' | 'oracle' | 'postgres' | 'excel' | 'csv';

export interface DbConnectionConfig {
  type: DbType;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  queryTimeout: number; // ms

  // ─── Excel/CSV 전용 (optional) ──────────────────────
  /** 파일 경로 (excel/csv 타입 시 필수) */
  filePath?: string;
  /** Excel 시트 이름 (기본: 첫 번째 시트) */
  sheetName?: string;
  /** CSV 구분자 (기본: ,) */
  delimiter?: string;
  /** CSV 인코딩 (기본: utf-8) */
  encoding?: string;
  /** 파일 변경 감시 모드 */
  watchMode?: boolean;
}

export interface IDbConnector {
  /** DB 타입 식별자 */
  readonly dbType: DbType;

  /** 연결 수립 */
  connect(): Promise<void>;

  /** 연결 해제 */
  disconnect(): Promise<void>;

  /** 연결 상태 확인 */
  isConnected(): boolean;

  /** 연결 테스트 (설치 시 사용) */
  testConnection(): Promise<boolean>;

  /**
   * 테이블의 컬럼 목록 조회 (매핑 설정 시 사용)
   */
  getColumns(tableName: string): Promise<ColumnInfo[]>;

  /**
   * 테이블 목록 조회
   */
  getTables(): Promise<string[]>;

  /**
   * 증분 데이터 조회: timestampColumn > since 인 레코드
   */
  fetchIncremental(
    tableName: string,
    timestampColumn: string,
    since: string, // ISO 8601
    limit: number,
    offset: number,
  ): Promise<RawRow[]>;

  /**
   * 전체 데이터 조회 (페이지네이션)
   */
  fetchAll(
    tableName: string,
    limit: number,
    offset: number,
  ): Promise<RawRow[]>;

  /**
   * 테이블 전체 레코드 수 조회
   */
  getRowCount(tableName: string): Promise<number>;
}

// ─── 보조 타입 ──────────────────────────────────────────

/** DB에서 조회한 원시 행 데이터 */
export type RawRow = Record<string, unknown>;

/** 컬럼 메타데이터 */
export interface ColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  maxLength?: number;
  isPrimaryKey?: boolean;
}
