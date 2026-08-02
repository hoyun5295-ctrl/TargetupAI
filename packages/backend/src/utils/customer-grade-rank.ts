/**
 * customer-grade-rank.ts — 회사별 등급 서열 (2026-08-02)
 *
 * ⛔ 우리는 등급 사전을 갖지 않는다
 *   고객사마다 등급 체계가 다르다(VIP·VVIP·일반 / 브론즈~다이아 / A·B·C / 1·2·3).
 *   우리가 표를 들고 있으면 다음 고객사에서 깨진다. 값 목록은 **그 회사 데이터에서 뽑고**,
 *   순서는 **사람이 한 번 확인**한 것만 믿는다.
 *
 * ⛔ 구매액으로 서열을 추론하지 않는다
 *   표본이 적은 등급에서 뒤집히고, 뒤집히면 **등급이 떨어진 고객에게 축하가 나간다.**
 *   틀렸을 때 대가가 발송이라 추정을 쓸 자리가 아니다.
 *
 * 저장 규약
 *   - 행이 하나라도 있으면 "그 회사는 확인을 마쳤다".
 *   - `rank_order`가 낮을수록 아래 등급. **같은 값 = 같은 급**(같은 급 이동은 상승이 아니다).
 *   - `rank_order = NULL` = 순서를 매길 수 없는 값(세그먼트처럼 등급이 아닌 것).
 *     전부 NULL이면 상승 판정 자체가 불가하므로 트리거는 잠긴 채로 둔다.
 *   - `customers.grade` 원문은 건드리지 않는다(원본 보존).
 */
import { query, pool } from '../config/database';

/** DB에 저장된 서열 한 줄. */
export interface GradeRankRow {
  gradeValue: string;
  /** 낮을수록 아래 등급. null = 순서 없음. */
  rankOrder: number | null;
}

/** 화면에 보여줄 등급 값 — 실측 목록. */
export interface CompanyGradeValue {
  gradeValue: string;
  customerCount: number;
  /** 이미 순서를 정해 둔 값인가. */
  ranked: boolean;
  rankOrder: number | null;
}

/** 서열 판정에 최소한 필요한 것 — 순위가 매겨진 값이 둘 이상 있어야 "위로 갔다"가 성립한다. */
const MIN_RANKED_VALUES = 2;

/**
 * 이 회사 고객 데이터에 **실제로 있는** 등급 값 + 인원수.
 * ⛔ 목록을 우리가 만들지 않는다. 화면은 이 결과만 보여준다.
 */
export async function listCompanyGradeValues(companyId: string): Promise<CompanyGradeValue[]> {
  const r = await query(
    `SELECT c.grade AS grade_value, COUNT(*)::int AS cnt, r.rank_order
       FROM customers c
       LEFT JOIN customer_grade_ranks r
              ON r.company_id = c.company_id AND r.grade_value = c.grade
      WHERE c.company_id = $1::uuid AND COALESCE(c.grade, '') <> ''
      GROUP BY c.grade, r.rank_order
      ORDER BY COUNT(*) DESC, c.grade ASC`,
    [companyId],
  );
  return r.rows.map((row: any) => ({
    gradeValue: String(row.grade_value),
    customerCount: Number(row.cnt) || 0,
    ranked: row.rank_order != null,
    rankOrder: row.rank_order != null ? Number(row.rank_order) : null,
  }));
}

/** 저장된 서열. 비어 있으면 아직 확인 전이다. */
export async function getGradeRanks(companyId: string): Promise<GradeRankRow[]> {
  const r = await query(
    `SELECT grade_value, rank_order FROM customer_grade_ranks
      WHERE company_id = $1::uuid
      ORDER BY rank_order NULLS LAST, grade_value`,
    [companyId],
  );
  return r.rows.map((row: any) => ({
    gradeValue: String(row.grade_value),
    rankOrder: row.rank_order != null ? Number(row.rank_order) : null,
  }));
}

/**
 * 상승 판정을 할 수 있는 회사인가 — **순위가 매겨진 값이 둘 이상**일 때만.
 * 하나뿐이면 위로 갈 자리가 없고, 전부 순서 없음이면 애초에 등급이 아니다.
 * ⛔ 테이블이 아직 없는 환경(42P01)에서는 잠근 채로 둔다 — 못 여는 쪽이 안전한 방향이다.
 */
export async function hasUsableGradeOrder(companyId: string): Promise<boolean> {
  try {
    // ⛔ 2026-08-02 Codex — 행 수가 아니라 **서로 다른 순위가 둘 이상**인지를 본다.
    //   A·B가 둘 다 1급이면 위로 갈 자리가 없어 추출은 영구 0건인데 개방·활성화만 되던 구멍.
    //   그리고 **지금 고객에게 실제로 있는 등급**과 조인한다 — 사라진 등급의 옛 서열행이 개방 근거가 되면 안 된다.
    const r = await query(
      `SELECT COUNT(DISTINCT r.rank_order)::int AS n
         FROM customer_grade_ranks r
        WHERE r.company_id = $1::uuid
          AND r.rank_order IS NOT NULL
          AND EXISTS (SELECT 1 FROM customers c
                       WHERE c.company_id = r.company_id AND c.grade = r.grade_value)`,
      [companyId],
    );
    return (Number(r.rows[0]?.n) || 0) >= MIN_RANKED_VALUES;
  } catch (err: any) {
    if (err?.code === '42P01') return false;   // 마이그레이션 전
    throw err;
  }
}

/** 이 회사가 서열을 저장한 적이 있는가 — "전부 순서 없음"으로 저장한 상태와 미설정을 가른다. */
export async function hasGradeOrderConfig(companyId: string): Promise<boolean> {
  try {
    const r = await query(
      `SELECT 1 FROM customer_grade_ranks WHERE company_id = $1::uuid LIMIT 1`,
      [companyId],
    );
    return r.rows.length > 0;
  } catch (err: any) {
    if (err?.code === '42P01') return false;
    throw err;
  }
}

/**
 * 서열 저장 — 화면이 보낸 순서를 그대로 반영한다.
 *   - 보낸 값만 남긴다(빠진 값은 지운다 — 등급이 사라졌거나 다시 정하는 중이다).
 *   - 같은 순위를 여러 값에 줄 수 있다(같은 급 묶기).
 *   - `rankOrder`가 null이면 순서 없음으로 저장한다.
 * ⛔ 저장은 한 트랜잭션 — 지우고 넣는 사이에 판정이 끼면 그 순간 등급 여정이 빈 표를 본다.
 */
export async function saveGradeRanks(
  companyId: string,
  confirmedBy: string | null,
  rows: GradeRankRow[],
): Promise<{ saved: number }> {
  const clean = (rows || [])
    .map((x) => ({
      gradeValue: String(x.gradeValue || '').trim().slice(0, 50),
      rankOrder: x.rankOrder == null ? null : Math.trunc(Number(x.rankOrder)),
    }))
    .filter((x) => x.gradeValue.length > 0 && (x.rankOrder == null || Number.isFinite(x.rankOrder)));

  // 같은 값이 두 번 오면 마지막 것만 남긴다(화면 중복 입력 방어).
  const byValue = new Map<string, GradeRankRow>();
  for (const x of clean) byValue.set(x.gradeValue, x);
  const finalRows = Array.from(byValue.values());

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // ⛔ 2026-08-02 Codex — 같은 회사의 저장을 **직렬화**한다.
    //   빈 표에서 두 요청이 동시에 지우면 서로 막지 못해, 겹치면 UNIQUE 충돌이고
    //   안 겹치면 **어느 쪽도 보내지 않은 합집합 표**가 남는다(판정 근거가 조용히 뒤섞인다).
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`grade_ranks:${companyId}`]);
    await client.query(`DELETE FROM customer_grade_ranks WHERE company_id = $1::uuid`, [companyId]);
    for (const row of finalRows) {
      await client.query(
        `INSERT INTO customer_grade_ranks (company_id, grade_value, rank_order, confirmed_by, confirmed_at, updated_at)
         VALUES ($1::uuid, $2, $3, $4::uuid, NOW(), NOW())`,
        [companyId, row.gradeValue, row.rankOrder, confirmedBy || null],
      );
    }
    await client.query('COMMIT');
    return { saved: finalRows.length };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
