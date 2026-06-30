/**
 * DB 커넥터 공통 인터페이스
 * Strategy 패턴: 모든 DB 커넥터가 이 인터페이스를 구현
 */

// 향후 확장 자리: 'odbc' — 티베로/DB2/알티베이스 등 Node 전용 드라이버가 없는 DB는
// node-odbc + 고객 PC ODBC 드라이버로 단일 커넥터를 추가한다 (실제 고객 발생 시).
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
   * 전체 데이터 조회 (OFFSET 페이지네이션)
   */
  fetchAll(
    tableName: string,
    limit: number,
    offset: number,
  ): Promise<RawRow[]>;

  /**
   * 전체 데이터 조회 (키셋 페이지네이션 — 안정 키 기준).
   * ★ 2026-06-30: 깊은 OFFSET 재스캔이 없어 대용량/라이브 테이블에서도 중간 짧은·빈
   *   페이지로 인한 조기 종료가 없다(이새에프앤씨 full 조기종료 사고 근본 정정).
   *   afterKey=null이면 처음부터. 반환 lastKey를 다음 호출 afterKey로 넘긴다.
   *   미구현 어댑터는 엔진이 자동으로 OFFSET 경로로 폴백한다(optional).
   */
  fetchAllKeyset?(
    tableName: string,
    limit: number,
    afterKey: string | null,
  ): Promise<{ rows: RawRow[]; lastKey: string | null }>;

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

/**
 * 단일 컬럼 PK 이름 반환 (복합 PK·PK 없음이면 null).
 * ★ 2026-06-30: OFFSET 페이지네이션 안정 정렬 키 선택용 — 무정렬 OFFSET의
 *   깊은 구간 행 건너뜀/중복(이새식 결함과 동류)을 차단한다.
 */
export function singleColumnPk(columns: ColumnInfo[]): string | null {
  const pks = columns.filter((c) => c.isPrimaryKey);
  return pks.length === 1 ? pks[0].name : null;
}
