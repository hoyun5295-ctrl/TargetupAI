/**
 * sync-ingest.ts — 싱크에이전트 적재 공통 컨트롤타워
 *
 * 소유하는 것
 *   1) 원본 행 키(source_row_key) 정규화 — 고객사 소스 테이블의 PK 값을 그대로 받는다.
 *   2) 구매 원장 적재 SQL 조립(멱등 UPSERT / legacy INSERT).
 *   3) 구매 custom_fields(custom_1~15) 값 정리 — ★ 2026-10-15 적재 시작.
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

/**
 * 같은 원본 행이 한 배치에 두 번 오면 ON CONFLICT가 "같은 행을 두 번 고칠 수 없다"로 터진다 → 마지막 것만 남긴다.
 * 키 행은 **키 정렬**로 돌려준다 — 동시 요청 둘이 겹치는 키를 서로 다른 순서로 UPSERT하면 교착이 된다.
 * 전 요청이 같은 잠금 순서를 갖게 순서를 결정적으로 만든다(행 간 의존이 없어 순서 변경은 결과 무영향).
 */
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
  const keyed = [...byKey.values()].sort((a, b) =>
    (a.source_row_key as string) < (b.source_row_key as string) ? -1
    : (a.source_row_key as string) > (b.source_row_key as string) ? 1 : 0);
  return [...noKey, ...keyed];
}

/** PostgreSQL JSON 파서가 거부하는 글자 — NUL · 짝 없는 서로게이트(앞·뒤) */
const JSONB_NUL_RE = /\u0000/g;
const JSONB_LONE_SURROGATE_RE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

/**
 * custom_fields 값 객체의 글자 값에서 JSONB 가 거부하는 글자를 뺀다(NUL 은 지우고 짝 없는 서로게이트는 U+FFFD).
 * ★ 2026-10-15: 이 글자 하나가 섞이면 JSONB 입력 오류로 그 행 전체(고객·구매)가 적재 실패 → 에이전트 커서는 넘어가 영구 누락.
 *   바뀌는 값은 어차피 저장될 수 없던 값뿐이다(그 밖의 값·키는 그대로).
 */
export function jsonbSafeCustomValues(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = typeof v === 'string'
      ? v.replace(JSONB_NUL_RE, '').replace(JSONB_LONE_SURROGATE_RE, '�')
      : v;
  }
  return out;
}

/** 구매 custom 슬롯 키 — custom_1 ~ custom_15 (고객과 같은 슬롯 체계) */
const PURCHASE_CUSTOM_KEY_RE = /^custom_(?:[1-9]|1[0-5])$/;

/**
 * 에이전트가 보낸 구매 custom_fields(mapRow 결과 · 에이전트가 날짜 글자를 이미 정리) → JSONB 문자열.
 * ★ 2026-10-15 신설: 그동안 서버가 이 값을 읽지 않아 구매 custom 슬롯 값이 전부 버려졌다
 *   (매핑 검증·AI 매핑은 구매 custom_1~15 를 허용하고 에이전트도 보내는데 적재만 빠져 있었다).
 * 받는 것 = custom_1~15 키의 글자·숫자·불리언·null. 그 밖의 키·값(객체·배열)은 버린다. 남는 게 없으면 null.
 */
export function normalizePurchaseCustomFields(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!PURCHASE_CUSTOM_KEY_RE.test(k)) continue;
    if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
  }
  return Object.keys(out).length > 0 ? JSON.stringify(jsonbSafeCustomValues(out)) : null;
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
  /** normalizePurchaseCustomFields 결과(JSONB 문자열) */
  custom_fields: string | null;
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
  const cols = withSourceKey ? 13 : 12;
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
      r.quantity, r.unit_price, r.total_amount, r.custom_fields,
    );
    if (withSourceKey) params.push(r.source_row_key);
  }

  const columnList = withSourceKey
    ? `company_id, customer_id, customer_phone, purchase_date,
       store_code, store_name, product_code, product_name,
       quantity, unit_price, total_amount, custom_fields, source_row_key, created_at`
    : `company_id, customer_id, customer_phone, purchase_date,
       store_code, store_name, product_code, product_name,
       quantity, unit_price, total_amount, custom_fields, created_at`;

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
         total_amount   = EXCLUDED.total_amount,
         custom_fields  = EXCLUDED.custom_fields`
    : '';
  // custom_fields 는 병합하지 않고 바꾼다 — 한 행 = 원본 한 행이라 지금 보낸 값이 진실이다(매핑에서 뺀 슬롯은 사라진다).
  //   고객은 업로드 등 다른 문의 값을 지키려 병합하지만, 구매 원장은 싱크만 쓴다.

  const sql =
    `INSERT INTO purchases (${columnList})
     VALUES ${valueClauses.join(',')}
     ${conflictClause}`;

  return { sql, params };
}

/**
 * ★ 2026-10-04 계통 오류 응답 — 교착(40P01)·시간 초과(57014)·연결(08xxx)처럼 행 데이터 탓이 아닌 오류.
 *
 * 옛: 고객 경로는 그 청크를 "실패 N건"으로, 구매 경로는 단건 폴백 뒤 행마다 실패로 세어 **200**으로 답했다.
 *   에이전트는 HTTP 성공이면 커서를 넘기므로(engine processBatch) 그 행들이 영구히 빠졌다
 *   — 불변 원칙 「커서 전진은 서버 성공 후」 위반(FEATURE-SYNC-AGENT §2).
 * 지금: 남은 청크를 멈추고 503 으로 답한다. 에이전트는 5xx 를 재시도하고, 끝내 실패하면 커서를 멈춘다.
 *   이미 들어간 청크는 다시 와도 멱등이다(고객 = 폰 · 구매 = 원본 행 키).
 * ponytail: 원본 행 키가 없는 구매(PK 없는 테이블의 전량)는 다시 오면 그 청크만큼 중복된다 — 요청 하나를
 *   트랜잭션으로 묶으면 닫히지만 행 폴백에 SAVEPOINT 가 필요해 지금은 수용(그 경로는 1.7.2 에서 증분이 잠긴다).
 */
export const SYNC_RETRY_HTTP_STATUS = 503;
export function syncRetryResponseBody(): { success: false; error: string; code: 'SYNC_RETRY' } {
  return {
    success: false,
    error: '일시적인 서버 오류입니다. 같은 배치를 다시 보내 주세요.',
    code: 'SYNC_RETRY',
  };
}

/** 신규 컬럼 미생성(42703) 판정 — 배포 직후 DDL 실행 전 구간을 legacy 경로로 견딘다. */
export function isUndefinedColumnError(err: any): boolean {
  if (err?.code === '42703') return true;
  const msg = String(err?.message || '');
  return msg.includes('source_row_key') && msg.includes('does not exist');
}
