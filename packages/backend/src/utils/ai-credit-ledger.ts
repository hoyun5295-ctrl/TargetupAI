/**
 * utils/ai-credit-ledger.ts — 크레딧 원장 읽기(★ 2026-11-01 크레딧 컨트롤타워 편입 · 설계서 docs/2026-11-01-credit-control-tower-design.md §16-1)
 *
 * 기능 파일은 원장 표를 직접 묻지 않고 이 함수들을 부른다(뿌리 R39 · credit-ct-contract.test.ts).
 *   - 연결(db) = 호출부의 것을 받는다. 기능 잠금 안 거래에서 세는 값(대행 환불 회차 등)은 그 client 를 그대로 넘긴다.
 *   - 조회 실패는 삼키지 않는다(던진다) — 모르는 납부를 「안 냈다」로 접으면 이미 낸 금액을 다시 청구한다.
 *   - 키 접두 · 꼴은 LIKE 특수문자(% _ \)를 글자로 묻는다(접두가 그 문자를 품어도 다른 키를 잡지 않는다).
 */
type Db = { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> };

/** LIKE 특수문자를 글자로(기본 ESCAPE = \) */
function likeLiteral(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** 이 키 접두들 중 하나로 시작하는 원장 키 전부(이메일 완성 목록 등) */
export async function ledgerKeysWithPrefixes(db: Db, companyId: string, prefixes: readonly string[]): Promise<string[]> {
  if (!companyId || prefixes.length === 0) return [];
  const r = await db.query(
    `SELECT idempotency_key FROM ai_credit_transactions
      WHERE company_id = $1::uuid AND idempotency_key LIKE ANY($2::text[])`,
    [companyId, prefixes.map((p) => `${likeLiteral(p)}%`)],
  );
  return r.rows.map((x: any) => String(x.idempotency_key));
}

/** 키 접두 줄(키 · type · 금액) — 다음 시도 키 · 회차를 기능이 셀 때 */
export async function ledgerRowsByKeyPrefix(
  db: Db,
  companyId: string,
  keyPrefix: string,
): Promise<Array<{ idempotency_key: string; type: string; amount: number }>> {
  if (!companyId || !keyPrefix) return [];
  const r = await db.query(
    `SELECT idempotency_key, type, amount FROM ai_credit_transactions
      WHERE company_id = $1::uuid AND idempotency_key LIKE $2`,
    [companyId, `${likeLiteral(keyPrefix)}%`],
  );
  return r.rows.map((x: any) => ({ idempotency_key: String(x.idempotency_key), type: String(x.type), amount: Number(x.amount) || 0 }));
}

/** 이 type · 원천 · 키 접두의 원장 줄 수 */
export async function countLedgerRows(db: Db, o: { companyId: string; type: string; source: string; keyPrefix: string }): Promise<number> {
  const r = await db.query(
    `SELECT COUNT(*)::int AS cnt FROM ai_credit_transactions
      WHERE company_id = $1::uuid AND type = $2 AND source = $3 AND idempotency_key LIKE $4`,
    [o.companyId, o.type, o.source, `${likeLiteral(o.keyPrefix)}%`],
  );
  return Number(r.rows[0]?.cnt) || 0;
}

/** 이 키 · type · 원천 줄의 금액(없으면 null) */
export async function ledgerAmountByKey(db: Db, o: { companyId: string; key: string; type: string; source: string }): Promise<number | null> {
  const r = await db.query(
    `SELECT amount FROM ai_credit_transactions
      WHERE idempotency_key = $1 AND company_id = $2::uuid AND type = $3 AND source = $4 LIMIT 1`,
    [o.key, o.companyId, o.type, o.source],
  );
  return r.rows.length > 0 ? Number(r.rows[0].amount) || 0 : null;
}

/** 키 꼴(LIKE 꼴 그대로 · 호출부가 % 자리를 정한다) 중 하나라도 맞는 차감 합 */
export async function sumDeductedByKeyLikes(db: Db, companyId: string, likes: readonly string[]): Promise<number> {
  if (!companyId || likes.length === 0) return 0;
  const r = await db.query(
    `SELECT COALESCE(SUM(amount), 0)::int AS paid FROM ai_credit_transactions
      WHERE company_id = $1::uuid AND type = 'deduct' AND idempotency_key LIKE ANY($2::text[])`,
    [companyId, likes],
  );
  return Number(r.rows[0]?.paid) || 0;
}

/** 이 원천 차감을 키 n번째 칸(1부터)으로 묶은 기간 수 · 첫 시각(여정 운영 예상 · 지도) */
export async function deductStatsByKeySegment(
  db: Db,
  o: { companyId: string; source: string; segment: number; windowDays: number; now: Date },
): Promise<Array<{ segment: string; n: number; firstAt: Date | string | null }>> {
  const r = await db.query(
    `SELECT split_part(idempotency_key, ':', $3::int) AS seg,
            COUNT(*) FILTER (WHERE created_at > $4::timestamptz - ($5::int * INTERVAL '1 day'))::int AS n,
            MIN(created_at) AS first_at
       FROM ai_credit_transactions
      WHERE company_id = $1::uuid AND source = $2 AND type = 'deduct'
      GROUP BY 1`,
    [o.companyId, o.source, o.segment, o.now.toISOString(), o.windowDays],
  );
  return r.rows.map((x: any) => ({ segment: String(x.seg || ''), n: Number(x.n) || 0, firstAt: x.first_at || null }));
}

/** 이 원천 차감의 기간 수 */
export async function deductCountSince(db: Db, o: { companyId: string; source: string; windowDays: number; now: Date }): Promise<number> {
  const r = await db.query(
    `SELECT COUNT(*)::int AS n FROM ai_credit_transactions
      WHERE company_id = $1::uuid AND source = $2 AND type = 'deduct'
        AND created_at > $3::timestamptz - ($4::int * INTERVAL '1 day')`,
    [o.companyId, o.source, o.now.toISOString(), o.windowDays],
  );
  return Number(r.rows[0]?.n) || 0;
}
