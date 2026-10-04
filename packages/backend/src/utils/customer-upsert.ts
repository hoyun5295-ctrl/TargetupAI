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
  /**
   * ★ 2026-09-28 한줄로 V2 R206 — 값이 바뀐 기존 행만 다시 쓴다(ON CONFLICT DO UPDATE ... WHERE 새 값 IS DISTINCT FROM 옛 값).
   *   full 싱크마다 전 행을 재작성하던 것(죽은 튜플 · 쓰기 부하)을 막는다. 바뀌지 않은 행은 RETURNING 에 나오지 않으므로
   *   반환 행으로 건수를 세거나 id 를 받아 쓰는 경로(업로드 건수 · 수동 등록 매장 연결)는 켜지 않는다. 지금 켜는 곳 = sync.
   */
  skipUnchanged?: boolean;
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
  // ★ D214+ (2026-05-24) Unified Customer Profile 정합: active_sources / last_activity_at 추가 (리터럴 영역 — paramsPerRow 영향 X)
  // ★ D214+ 순서 영역 정합 의무: paramList 영역(company_id + columnNames + 3 + uploaded_by옵션) → literal 영역(active_sources + last_activity_at + source + created_at + updated_at)
  const insertCols = [
    'company_id',
    ...columnNames,
    'birth_year',
    'birth_month_day',
    'custom_fields',
    ...(options.includeUploadedBy ? ['uploaded_by'] : []),
    'active_sources',           // ★ D214+ literal — INSERT 영역 안 ['sync'|'upload'|'manual'] 박음
    'last_activity_at',         // ★ D214+ literal — INSERT 영역 안 NOW() 박음
    'source',
    'created_at',
    'updated_at',
  ];

  // row당 파라미터 수 — source/created_at/updated_at/active_sources/last_activity_at은 리터럴(NOW())로 처리
  const paramsPerRow =
    1 + // company_id
    columnNames.length +
    3 + // birth_year, birth_month_day, custom_fields
    (options.includeUploadedBy ? 1 : 0);

  const sourceLiteral =
    options.source === 'upload' ? "'upload'" :
    options.source === 'sync' ? "'sync'" :
    "'manual'";

  // ★ D214+ active_sources 리터럴 (sourceLiteral 활용 — '["sync"]'::jsonb 영역)
  const activeSourcesLiteral = `('["' || ${sourceLiteral} || '"]')::jsonb`;

  // ON CONFLICT UPDATE 절 — phone은 UNIQUE 키(company_id, phone) 구성요소라 제외.
  // store_code는 키가 아니지만 제외 유지(★2026-08-14) — 첫 등록 매장을 보존하고 다매장은 customer_stores가 소유.
  // ★ D214+ (2026-05-24) Unified Customer Profile 정합:
  //   RFM 컬럼 영역 = GREATEST 강제 의무 (자사몰 영역 cdp-orders.ts 영역 안 최신 영역 덮어쓰기 사고 차단)
  //   - recent_purchase_date / purchase_count / last_purchase_date = GREATEST (옛 = COALESCE 덮어쓰기 영역 사고)
  //   - total_purchase_amount = COALESCE 유지 (POS 영역 = 영구 누적 영역 본질)
  const updateExclusions = new Set([
    'phone', 'store_code',
    // ★ D214+ RFM 영역 = 별도 GREATEST 영역 정합 (옛 COALESCE 덮어쓰기 사고 차단)
    'recent_purchase_date', 'purchase_count', 'last_purchase_date',
  ]);
  // [칸, 새 값 식] — SET 절과 「바뀌었나」 판정(skipUnchanged)이 같은 식을 쓴다.
  const updatePairs: Array<[string, string]> = [
    ...columnNames
      .filter((c) => !updateExclusions.has(c))
      .map((c): [string, string] => [c, `COALESCE(EXCLUDED.${c}, customers.${c})`]),
    // ★ D214+ RFM 영역 GREATEST 강제 매트릭스 (자사몰 ↔ POS 충돌 해결)
    ['recent_purchase_date', `GREATEST(COALESCE(EXCLUDED.recent_purchase_date, customers.recent_purchase_date), COALESCE(customers.recent_purchase_date, EXCLUDED.recent_purchase_date))`],
    ['purchase_count', `GREATEST(COALESCE(EXCLUDED.purchase_count, customers.purchase_count, 0), COALESCE(customers.purchase_count, 0))`],
    ['last_purchase_date', `GREATEST(COALESCE(EXCLUDED.last_purchase_date, customers.last_purchase_date), COALESCE(customers.last_purchase_date, EXCLUDED.last_purchase_date))`],
    ['birth_year', 'COALESCE(EXCLUDED.birth_year, customers.birth_year)'],
    ['birth_month_day', 'COALESCE(EXCLUDED.birth_month_day, customers.birth_month_day)'],
    ['custom_fields', `CASE WHEN EXCLUDED.custom_fields IS NOT NULL THEN COALESCE(customers.custom_fields, '{}'::jsonb) || EXCLUDED.custom_fields ELSE customers.custom_fields END`],
    // ★ D214+ active_sources jsonb 영역 안 source push (옛 영역 안 미존재 시 append)
    ['active_sources', `CASE WHEN customers.active_sources @> ('"' || ${sourceLiteral} || '"')::jsonb THEN customers.active_sources ELSE COALESCE(customers.active_sources, '[]'::jsonb) || ('["' || ${sourceLiteral} || '"]')::jsonb END`],
    // ★ 2026-09-28 한줄로 V2 R206(Harold 승인) — 적재(싱크·업로드·수동)는 고객 활동이 아니다 → last_activity_at 을 다시 쓰지 않는다.
    //   옛: 적재마다 전원의 마지막 활동 시각을 지금으로 바꿔, 인앱 「최근 N일 활동」 조건에 적재된 고객 전원이 잡혔다.
    //   활동 시각은 실제 이벤트(cdp-profile-recompute)가 소유한다. 신규 행의 첫 값(INSERT NOW())은 종전 그대로다.
    ...(options.includeUploadedBy
      ? [['uploaded_by', 'COALESCE(EXCLUDED.uploaded_by, customers.uploaded_by)'] as [string, string]]
      : []),
    // source 덮어쓰기 규칙 (우선순위: sync > upload > manual):
    //   - upload: 기존 sync 유지, 아니면 'upload'
    //   - sync:   항상 'sync' (Agent 원본이 정답)
    //   - manual: 기존 sync/upload 유지, 아니면 'manual'
    ['source', options.source === 'upload'
      ? `CASE WHEN customers.source = 'sync' THEN 'sync' ELSE 'upload' END`
      : options.source === 'sync'
      ? `'sync'`
      : `CASE WHEN customers.source IN ('sync','upload') THEN customers.source ELSE 'manual' END`],
  ];
  const updateClauses = [
    ...updatePairs.map(([c, e]) => `${c} = ${e}`),
    'updated_at = NOW()',
  ].join(',\n              ');
  // 바뀐 행만 쓰기(R206) — 새 값 묶음이 옛 값 묶음과 다를 때만 UPDATE 한다(NULL 도 값으로 비교).
  const unchangedGuard = options.skipUnchanged
    ? `\n      WHERE ROW(${updatePairs.map(([, e]) => e).join(', ')}) IS DISTINCT FROM ROW(${updatePairs.map(([c]) => `customers.${c}`).join(', ')})`
    : '';

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
      // ★ D214+ source/created_at/updated_at/active_sources/last_activity_at은 리터럴로 고정
      // insertCols 영역 순서 정합: ...columnNames, birth_year, birth_month_day, custom_fields, active_sources, last_activity_at, [uploaded_by], source, created_at, updated_at
      placeholders.push(`(${paramList}, ${activeSourcesLiteral}, NOW(), ${sourceLiteral}, NOW(), NOW())`);
      values.push(...rowValues);
    }
    const returningClause =
      options.returning === 'all'
        ? 'RETURNING *, (xmax = 0) as is_insert'
        : 'RETURNING (xmax = 0) as is_insert, phone';
    // ★ 2026-08-14 충돌 축 정정 — (company_id, phone). 이새 실측 164건 영구 실패의 뿌리.
    //   customers에는 유니크가 두 벌 있었다: customers_company_id_phone_key(company_id, phone)와
    //   idx_customers_company_store_phone(company_id, COALESCE(store_code,'__NONE__'), phone).
    //   arbiter가 후자(느슨한 쪽)를 보고 있어서, 같은 폰이 다른 매장으로 오면 "충돌 아님" 판정
    //   → 신규 INSERT 시도 → 전자(엄격한 쪽)가 거절 = duplicate key. 그 고객은 매 동기화마다 영구 실패.
    //   설계 진실은 "폰당 고객 1행"(다매장은 customer_stores가 소유)이므로 arbiter를 phone 키에 맞춘다.
    //   store_code는 updateExclusions라 기존 매장이 보존되고, 새 매장은 customer_stores에 쌓인다.
    //   ⚠ 배포 후 idx_customers_company_store_phone은 죽은 인덱스다(phone 키가 항상 먼저 잡는다) — DDL로 제거.
    //   ⚠ idx_customers_code(company_id, customer_code)는 여전히 arbiter 밖 — 같은 코드·다른 폰이 오면
    //     그 행은 실패 로그로 남는다(자동 병합은 사람 판정 없이 하지 않는다).
    const sql = `
      INSERT INTO customers (${insertCols.join(', ')})
      VALUES ${placeholders.join(', ')}
      ON CONFLICT (company_id, phone) DO UPDATE SET
              ${updateClauses}${unchangedGuard}
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

/**
 * ★ 2026-08-14 수신동의 신규 기본값 백필 (Codex 1R 정정의 나머지 반쪽)
 *
 * 결함: 호출부(sync/upload/manual)가 sms_opt_in 미제공을 true로 채워 보내면, ON CONFLICT UPDATE의
 *   COALESCE(EXCLUDED.sms_opt_in, ...)가 **기존 false(수신거부)를 true로 되돌린다** — arbiter가
 *   (company_id, phone)이 된 뒤로는 다른 매장 행도 흡수하므로 노출 폭이 넓다.
 * 구조: 호출부는 명시값 없으면 null을 보낸다 → UPDATE는 COALESCE가 기존 값을 보존(false 불변).
 *   INSERT는 명시 null이 컬럼 DEFAULT(true)를 타지 않아 null로 남으므로(2026-08-14 information_schema
 *   실측: is_nullable=YES, default=true), 업서트 직후 이 백필로 **null인 행만** 정책 기본 true로 채운다.
 *   기존 행은 COALESCE 보존 탓에 null이 될 수 없어 이 UPDATE는 신규(및 원래 null이던) 행만 만진다.
 * VALUES에 COALESCE($n,true)를 넣는 방식은 EXCLUDED가 표현식 **결과**를 봐서 UPDATE까지 true가
 *   전파되므로 답이 아니다(같은 세션 자가 반증). 되살리지 말 것.
 */
export function buildSmsOptInBackfill(
  companyId: string,
  phones: string[],
): { sql: string; values: any[] } {
  return {
    sql: `UPDATE customers SET sms_opt_in = true
          WHERE company_id = $1 AND phone = ANY($2::text[]) AND sms_opt_in IS NULL`,
    values: [companyId, phones],
  };
}

/**
 * ★ 2026-10-04 수신동의 값을 알아볼 수 없던 행 = 신규면 미동의 (싱크·자사몰 전수점검 S15 · 결정 ②).
 * ⛔ buildSmsOptInBackfill(신규 기본 true) **보다 먼저** 실행한다 — 그 백필은 NULL 행만 채우므로 여기서 false 가 된 행은 건너뛴다.
 * 기존 행은 업서트의 COALESCE 가 옛 값을 지켜 NULL 이 아니므로 바뀌지 않는다(모르는 값으로 옛 동의·거부를 덮지 않는다).
 */
export function buildSmsOptInUnknownDefault(
  companyId: string,
  phones: string[],
): { sql: string; values: any[] } {
  return {
    sql: `UPDATE customers SET sms_opt_in = false
          WHERE company_id = $1 AND phone = ANY($2::text[]) AND sms_opt_in IS NULL`,
    values: [companyId, phones],
  };
}

/**
 * ★ 2026-10-04 신규 행 수신동의 기본값 — 못 알아본 글자 = 미동의(먼저) → 값 없음 = 기본 동의.
 * ⛔ 업서트와 **같은 트랜잭션** 안에서 부른다(Codex 1004 R1 high). 커밋된 NULL 이 잠깐이라도 보이면
 *   같은 번호를 동의값 없이 보낸 다른 요청의 기본 동의 백필이 먼저 true 로 채우고, 이 요청의 미동의는 NULL 조건에 걸려 건너뛴다.
 */
export async function applySmsOptInDefaults(
  run: (sql: string, values: any[]) => Promise<unknown>,
  companyId: string,
  phones: string[],
  unknownPhones: ReadonlySet<string>,
): Promise<void> {
  if (phones.length === 0) return;
  const unknown = phones.filter((p) => unknownPhones.has(p));
  if (unknown.length > 0) {
    const u = buildSmsOptInUnknownDefault(companyId, unknown);
    await run(u.sql, u.values);
  }
  const b = buildSmsOptInBackfill(companyId, phones);
  await run(b.sql, b.values);
}

/**
 * ★ 2026-08-14 (Codex 2R): 배치 실패 → 단건 폴백을 허용할 오류인지 분류.
 *
 * 행 데이터에 국한된 오류(무결성 위반 23xxx · 데이터 형식 22xxx)만 행 격리의 의미가 있다.
 * 연결(08xxx)·구문(42xxx)·자원(53xxx)·운영자 개입(57xxx) 같은 계통 오류에 단건 폴백을 돌리면
 * 같은 실패를 최대 청크 크기만큼 반복해 **장애 중인 DB에 부하를 증폭**한다(5,000건 요청 = 최대 5,010회).
 * 계통 오류면 그 청크를 통째 실패로 계상하고 폴백 없이 넘어간다.
 *
 * ★ 2026-09-02 `21000`(cardinality_violation) 추가 — "ON CONFLICT DO UPDATE command cannot affect
 *   row a second time". **배치 안에 같은 충돌 키가 두 번 들어왔다는 뜻이므로 단건으로 쪼개면 그냥 풀린다.**
 *   위 계통 오류들과 정반대다(폴백이 부하를 늘리는 게 아니라 해결한다).
 *   경위 = 아난티 싱크에서 이 코드가 계통 오류로 분류돼 폴백이 생략되고, 중복 1건 때문에 청크 500건이
 *   통째로 버려졌다(최근 24시간 25,244건 · 53청크). 실측 SQLSTATE 21000 확인.
 *   ⛔ 이 판정은 sync·upload·manual 세 경로가 공유한다 — 한쪽만 고치면 같은 사고가 다른 문으로 다시 온다.
 */
export function isRowLevelDbError(err: any): boolean {
  const code = String(err?.code || '');
  return code.startsWith('22') || code.startsWith('23') || code === '21000';
}
