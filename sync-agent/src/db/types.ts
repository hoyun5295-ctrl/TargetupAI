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

  // ─── 암호화 연결 (★ 2026-07-27) ─────────────────────
  /**
   * TLS(암호화) 연결 사용 여부. 기본 false = 기존 동작 그대로(사내망 평문 연결).
   *
   * 클라우드 DB(AWS Aurora/RDS, Azure SQL 등)는 `require_secure_transport=ON`이 켜져 있으면
   * 평문 연결을 서버가 거부한다. 2026-07-27 MySQL 8.0.45 실측: 옵션 없으면 `ER_SECURE_TRANSPORT_REQUIRED`(3159),
   * ssl 옵션만 주면 TLS_AES_256_GCM_SHA384로 접속 성공.
   */
  ssl?: boolean;
  /**
   * 서버 인증서 검증에 쓸 CA 번들 파일 경로(선택).
   * 미지정 = **암호화만 하고 인증서 검증은 생략**(사설·자체서명 인증서 허용).
   * 폐쇄망/VPC 안에서 도는 전제라 기본을 검증 생략으로 둔다 — 지정하면 검증까지 한다.
   */
  sslCaPath?: string;

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

  /**
   * 키셋 증분 조회 (★ 2026-08-03 커서 재설계).
   *   커서 (tsRaw, keys) **다음** 행을 (ts ASC, pk... ASC) 순서로 최대 limit건.
   *   - tsRaw는 이 어댑터 자신이 만들어 준 DB 원문 문자열이다 — 같은 형식으로 파싱해 비교한다.
   *   - 타입 변환은 항상 상수(바인드) 쪽에서. 컬럼 쪽 캐스트는 인덱스를 죽인다.
   *   - 타임스탬프 NULL 행은 제외한다(전량 동기화에서만 들어온다 — 기존 의미 보존).
   *   - cursor=null이면 처음부터(ts 정렬 전체 스캔) — 큰 테이블에서는 비싸므로 엔진은 전량 경로를 쓴다.
   *   반환 rows에는 내부 원문 컬럼이 제거되어 있고, meta[i]가 rows[i]의 커서 성분이다.
   *   미구현 어댑터(excel·csv 등)는 엔진이 기존 fetchIncremental 경로를 유지한다.
   */
  fetchIncrementalKeyset?(
    tableName: string,
    timestampColumn: string,
    pkColumns: string[],
    cursor: import('./keyset').IncrementalCursor | null,
    limit: number,
  ): Promise<{ rows: RawRow[]; meta: import('./keyset').RowCursorMeta[] }>;

  /**
   * 현재 최대 (ts, pk...) 튜플 조회 (★ 2026-08-03) — 전량 동기화 **시작 시점**의 커서 씨앗.
   *   전량 스캔은 PK 순서라 마지막 행이 최대 시각이 아니다. 시작 시점 최대값을 커서로 삼으면
   *   스캔 중 새로 생긴 행(ts ≥ 씨앗)이 첫 증분에서 잡히고, 겹침은 서버 멱등이 흡수한다.
   *   타임스탬프 NULL 행 제외. 행이 없으면 null.
   *   beforeTsRawExclusive 지정 시 ts < 그 값인 행 중 최대 — "닫힌 버킷 경계" 조회용
   *   (최대 ts 버킷은 아직 열려 있어 커서로 삼으면 같은 ts의 후행 삽입이 영구 유실된다 — Codex F2).
   */
  fetchMaxCursor?(
    tableName: string,
    timestampColumn: string,
    pkColumns: string[],
    beforeTsRawExclusive?: string | null,
  ): Promise<import('./keyset').IncrementalCursor | null>;

  /**
   * 접속 대상 식별자 (★ 2026-08-03) — 커서 fingerprint 재료(host:port/database 등).
   *   소스가 바뀌었는데 커서를 재사용하면 새 소스의 행을 건너뛴다(fail-closed 폐기 근거).
   */
  getSourceId?(): string;
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
