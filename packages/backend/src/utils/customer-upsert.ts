/**
 * customer-upsert.ts — customers 테이블 UPSERT 컨트롤타워
 *
 * ★ 2026-04-21 Harold님 지시 — 절대 원칙:
 *   upload.ts + sync.ts 양쪽에서 동일한 INSERT 컬럼 목록 / ON CONFLICT UPDATE / values 구성을
 *   각자 인라인 구현하던 것을 단일 진입점으로 통합.
 *
 *   기존 문제:
 *     - sync.ts가 insertCols에 'region' 중복 추가 → PostgreSQL "multiple assignments" 에러 → full sync 전건 실패
 *     - upload.ts 패턴을 복제하지 않고 자체 변형 = 2곳 구조가 어긋남
 *
 *   해결:
 *     - FIELD_MAP(standard-field-map.ts) 기반으로 columnNames 동적 구성
 *     - region 같은 FIELD_MAP 컬럼은 columnNames에서 1회만 포함됨 → 중복 방지 구조적 보장
 *     - source / includeUploadedBy 옵션만 차이, SQL 본체는 완전 동일
 *
 *   호출부:
 *     - routes/upload.ts  (source='upload', includeUploadedBy=true)
 *     - routes/sync.ts    (source='sync',   includeUploadedBy=false)
 *
 *   FIELD_MAP 변경 시 자동 반영 — 어떤 필드를 추가/삭제해도 이 컨트롤타워 수정 불필요.
 */

import { getColumnFields } from './standard-field-map';

export type CustomerUpsertSource = 'upload' | 'sync' | 'manual';

export interface CustomerUpsertBuilderOptions {
  source: CustomerUpsertSource;
  /** upload 경로만 true. sync/manual은 uploaded_by 컬럼 제외. */
  includeUploadedBy: boolean;
  /** RETURNING 절 제어 — 단건 API는 'all' (전체 row 반환), 배치는 'insert_phone' (기본) */
  returning?: 'insert_phone' | 'all';
}

export interface CustomerUpsertBuilder {
  /** INSERT 컬럼 이름 목록 (디버깅/로그용) */
  readonly insertCols: string[];
  /** row당 파라미터 수 — source/created_at/updated_at은 리터럴로 처리되므로 카운트에서 제외 */
  readonly paramsPerRow: number;
  /**
   * 배치 빌더 — row 객체 배열을 받아 SQL + values를 반환.
   * row는 FIELD_MAP columnNames의 각 필드 + birth_year/birth_month_day/custom_fields가 채워진 객체.
   * 호출부에서 파생값 계산을 끝내고 row 객체에 담아서 전달.
   */
  buildBatch(
    companyId: string,
    rows: Record<string, any>[],
    uploadedBy?: string | null,
  ): { sql: string; values: any[] };
}

/**
 * customers UPSERT 빌더 생성.
 * 호출부는 이 빌더의 buildBatch()만 호출하면 됨 — insertCols/updateClauses 직접 조작 금지.
 */
export function createCustomerUpsertBuilder(
  options: CustomerUpsertBuilderOptions,
): CustomerUpsertBuilder {
  const columnFieldDefs = getColumnFields();
  const columnNames = columnFieldDefs.map((f) => f.columnName);

  // INSERT 컬럼 목록 — FIELD_MAP columnNames에 region 등 모든 직접 컬럼이 포함되므로
  // 여기서 개별 컬럼을 추가하면 중복이 되어 PostgreSQL 에러 발생. 절대 추가 금지.
  const insertCols = [
    'company_id',
    ...columnNames,
    'birth_year',
    'birth_month_day',
    'custom_fields',
    ...(options.includeUploadedBy ? ['uploaded_by'] : []),
    'source',
    'created_at',
    'updated_at',
  ];

  // row당 파라미터 수 — source/created_at/updated_at은 리터럴(NOW())로 처리
  const paramsPerRow =
    1 + // company_id
    columnNames.length +
    3 + // birth_year, birth_month_day, custom_fields
    (options.includeUploadedBy ? 1 : 0);

  const sourceLiteral =
    options.source === 'upload' ? "'upload'" :
    options.source === 'sync' ? "'sync'" :
    "'manual'";

  // ON CONFLICT UPDATE 절 — phone/store_code는 UNIQUE 키 구성요소이므로 UPDATE에서 제외
  const updateExclusions = new Set(['phone', 'store_code']);
  const updateClauses = [
    ...columnNames
      .filter((c) => !updateExclusions.has(c))
      .map((c) => `${c} = COALESCE(EXCLUDED.${c}, customers.${c})`),
    'birth_year = COALESCE(EXCLUDED.birth_year, customers.birth_year)',
    'birth_month_day = COALESCE(EXCLUDED.birth_month_day, customers.birth_month_day)',
    `custom_fields = CASE WHEN EXCLUDED.custom_fields IS NOT NULL THEN COALESCE(customers.custom_fields, '{}'::jsonb) || EXCLUDED.custom_fields ELSE customers.custom_fields END`,
    ...(options.includeUploadedBy
      ? ['uploaded_by = COALESCE(EXCLUDED.uploaded_by, customers.uploaded_by)']
      : []),
    // source 덮어쓰기 규칙 (우선순위: sync > upload > manual):
    //   - upload: 기존 sync 유지, 아니면 'upload'
    //   - sync:   항상 'sync' (Agent 원본이 정답)
    //   - manual: 기존 sync/upload 유지, 아니면 'manual'
    options.source === 'upload'
      ? `source = CASE WHEN customers.source = 'sync' THEN 'sync' ELSE 'upload' END`
      : options.source === 'sync'
      ? `source = 'sync'`
      : `source = CASE WHEN customers.source IN ('sync','upload') THEN customers.source ELSE 'manual' END`,
    'updated_at = NOW()',
  ].join(',\n              ');

  const buildRowValues = (
    companyId: string,
    row: Record<string, any>,
    uploadedBy?: string | null,
  ): any[] => {
    const out: any[] = [companyId];
    for (const col of columnNames) {
      out.push(row[col] ?? null);
    }
    out.push(row.birth_year ?? null);
    out.push(row.birth_month_day ?? null);
    out.push(row.custom_fields ?? null);
    if (options.includeUploadedBy) {
      out.push(uploadedBy ?? null);
    }
    return out;
  };

  const buildBatch = (
    companyId: string,
    rows: Record<string, any>[],
    uploadedBy?: string | null,
  ): { sql: string; values: any[] } => {
    const values: any[] = [];
    const placeholders: string[] = [];
    for (const row of rows) {
      const rowValues = buildRowValues(companyId, row, uploadedBy);
      const baseIdx = values.length;
      const paramList = Array.from(
        { length: paramsPerRow },
        (_, k) => `$${baseIdx + k + 1}`,
      ).join(',');
      // source/created_at/updated_at은 리터럴로 고정
      placeholders.push(`(${paramList}, ${sourceLiteral}, NOW(), NOW())`);
      values.push(...rowValues);
    }
    const returningClause =
      options.returning === 'all'
        ? 'RETURNING *, (xmax = 0) as is_insert'
        : 'RETURNING (xmax = 0) as is_insert, phone';
    const sql = `
      INSERT INTO customers (${insertCols.join(', ')})
      VALUES ${placeholders.join(', ')}
      ON CONFLICT (company_id, COALESCE(store_code, '__NONE__'), phone) DO UPDATE SET
              ${updateClauses}
      ${returningClause}
    `;
    return { sql, values };
  };

  return {
    insertCols,
    paramsPerRow,
    buildBatch,
  };
}
