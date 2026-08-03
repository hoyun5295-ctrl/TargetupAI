/**
 * sync-ingest.ts — 싱크에이전트 적재 공통 컨트롤타워
 *
 * 소유하는 것
 *   1) 원본 행 키(source_row_key) 정규화 — 고객사 소스 테이블의 PK 값을 그대로 받는다.
 *   2) 구매 원장 적재 SQL 조립(멱등 UPSERT / legacy INSERT).
 *
 * 왜 필요했나 (2026-08-03 실측)
 *   원장에 멱등키가 없어 같은 구매가 두 번 오면 두 행이 됐다. 지금까지 안 터진 이유는
 *   에이전트 증분 커서가 과하게 조여져 애초에 두 번 올 일이 없었기 때문이다 —
 *   **유실이 중복을 가려 왔다.** 커서를 바로잡으면 같은 날짜를 다시 조회해야 하므로
 *   서버가 먼저 멱등해져야 한다. 이 파일이 그 한 자리다.
 *
 * ⛔ created_at은 갱신하지 않는다.
 *   여정 구매 원장 커서(selectPurchaseLedgerRowsForCursor)가 created_at을 **도착 축**으로 읽는다.
 *   UPSERT가 이 값을 올리면 이미 발화한 구매가 커서 창에 다시 들어와 재발송된다.
 *
 * ⛔ 키를 잘라 쓰지 않는다.
 *   길이를 넘겨 자르면 서로 다른 원본 행이 같은 키가 되어 한 건이 조용히 사라진다.
 *   상한을 넘으면 그 행만 실패로 돌려보내고 사유를 남긴다.
 */

/** 원본 행 키 최대 길이 — purchases.source_row_key varchar(200)과 같은 값 */
export const MAX_SOURCE_ROW_KEY_LEN = 200;

export type SourceRowKeyResult =
  | { ok: true; value: string | null }
  | { ok: false; reason: string };

/**
 * payload의 원본 행 키를 검증·정규화한다.
 * 미지정(옛 에이전트) = null → legacy 경로로 적재된다(하위 호환).
 */
export function normalizeSourceRowKey(raw: unknown): SourceRowKeyResult {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw === 'object') {
    return { ok: false, reason: 'source_row_key must be a scalar value' };
  }
  const s = String(raw).trim();
  if (s === '') return { ok: true, value: null };
  if (s.length > MAX_SOURCE_ROW_KEY_LEN) {
    // 자르면 서로 다른 행이 같은 키가 된다 — 자르지 않고 거부한다.
    return { ok: false, reason: `source_row_key exceeds ${MAX_SOURCE_ROW_KEY_LEN} chars` };
  }
  return { ok: true, value: s };
}

/** 같은 원본 행이 한 배치에 두 번 오면 ON CONFLICT가 "같은 행을 두 번 고칠 수 없다"로 터진다 → 마지막 것만 남긴다. */
export function dedupeBySourceRowKey<T extends { source_row_key: string | null }>(rows: T[]): T[] {
  const byKey = new Map<string, T>();
  const noKey: T[] = [];
  for (const r of rows) {
    if (r.source_row_key === null) {
      noKey.push(r);
      continue;
    }
    byKey.set(r.source_row_key, r);
  }
  return [...noKey, ...byKey.values()];
}

export interface PurchaseIngestRow {
  phone: string;
  purchase_date: string | null;
  store_code: string | null;
  store_name: string | null;
  product_code: string | null;
  product_name: string | null;
  quantity: number | null;
  unit_price: number | null;
  total_amount: number | null;
  source_row_key: string | null;
}

/**
 * 구매 적재 SQL 조립.
 *
 * withSourceKey=true  → source_row_key 컬럼 포함 + 부분 유일 인덱스 기반 UPSERT.
 *   키가 NULL인 행은 인덱스 술어(WHERE source_row_key IS NOT NULL) 밖이라 충돌 판정에서 빠진다 →
 *   옛 에이전트가 보낸 키 없는 행은 지금과 똑같이 그냥 INSERT 된다.
 * withSourceKey=false → 컬럼 미생성 구간(배포 직후 ~ DDL 실행 전) legacy 경로.
 */
export function buildPurchaseIngestSql(
  rows: PurchaseIngestRow[],
  companyId: string,
  phoneToCustomerId: Record<string, string | null>,
  withSourceKey: boolean,
): { sql: string; params: any[] } {
  const cols = withSourceKey ? 12 : 11;
  const params: any[] = [];
  const valueClauses: string[] = [];

  for (let j = 0; j < rows.length; j++) {
    const offset = j * cols;
    const slots: string[] = [];
    for (let k = 1; k <= cols; k++) slots.push(`$${offset + k}`);
    valueClauses.push(`(${slots.join(',')},NOW())`);

    const r = rows[j];
    params.push(
      companyId, phoneToCustomerId[r.phone] || null, r.phone,
      r.purchase_date, r.store_code, r.store_name,
      r.product_code, r.product_name,
      r.quantity, r.unit_price, r.total_amount,
    );
    if (withSourceKey) params.push(r.source_row_key);
  }

  const columnList = withSourceKey
    ? `company_id, customer_id, customer_phone, purchase_date,
       store_code, store_name, product_code, product_name,
       quantity, unit_price, total_amount, source_row_key, created_at`
    : `company_id, customer_id, customer_phone, purchase_date,
       store_code, store_name, product_code, product_name,
       quantity, unit_price, total_amount, created_at`;

  // ⛔ created_at은 SET 목록에 없다(도착 축 보존 — 파일 상단 주석).
  const conflictClause = withSourceKey
    ? `ON CONFLICT (company_id, source_row_key) WHERE source_row_key IS NOT NULL
       DO UPDATE SET
         customer_id    = COALESCE(EXCLUDED.customer_id, purchases.customer_id),
         customer_phone = EXCLUDED.customer_phone,
         purchase_date  = EXCLUDED.purchase_date,
         store_code     = EXCLUDED.store_code,
         store_name     = EXCLUDED.store_name,
         product_code   = EXCLUDED.product_code,
         product_name   = EXCLUDED.product_name,
         quantity       = EXCLUDED.quantity,
         unit_price     = EXCLUDED.unit_price,
         total_amount   = EXCLUDED.total_amount`
    : '';

  const sql =
    `INSERT INTO purchases (${columnList})
     VALUES ${valueClauses.join(',')}
     ${conflictClause}`;

  return { sql, params };
}

/** 신규 컬럼 미생성(42703) 판정 — 배포 직후 DDL 실행 전 구간을 legacy 경로로 견딘다. */
export function isUndefinedColumnError(err: any): boolean {
  if (err?.code === '42703') return true;
  const msg = String(err?.message || '');
  return msg.includes('source_row_key') && msg.includes('does not exist');
}
