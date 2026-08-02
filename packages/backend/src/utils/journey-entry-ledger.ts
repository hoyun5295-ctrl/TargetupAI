/**
 * 진입 원장(Entry Ledger) — 신규가입 여정이 "전에 본 적 없는 고객"만 진입시키는 단일 컨트롤타워.
 *
 * 핵심: created_at·customer_id에 의존하지 않고, 시스템이 고객을 식별하는 그 키
 *   (회사 + 매장코드 + 전화번호 = customer-upsert 충돌 키)로 "전에 본 적 있나"를 직접 기록한다.
 *   - 활성화 때 그 시점 전체 고객 식별자를 'baseline'으로 1회 적재 → 그 후 원장에 없는 식별자만 신규.
 *   - 진입 시 'entered' 기록(같은 트랜잭션).
 *   - created_at이 어디서 바뀌든·id가 바뀌든·전체삭제 후 재업로드든 무관(전화번호가 원장에 남음).
 *   - journeys에 FK CASCADE(여정 삭제 시 정리), customers에는 FK 안 검(고객 삭제돼도 기억 보존).
 *
 * 검증된 컬럼(information_schema 2026-06-04):
 *   customers.company_id(uuid)·store_code(varchar,null)·phone(varchar,NOT NULL).
 *   journey_entry_ledger·journeys.entry_baseline_at = 본 재설계 마이그레이션으로 생성.
 */

import { query } from '../config/database';

/**
 * 신규가입 추출용 안티조인 SQL 조각 — 원장에 없는 **사람**만 통과.
 *
 * ★ 2026-08-01 판정 키에서 매장코드를 뺐다 (설계서 §3-0-2).
 *   기록(INSERT)은 테이블 UNIQUE(회사+매장코드+전화번호) 그대로 두고 **판정만 사람 단위**로 좁힌다.
 *   왜: customers upsert 키가 (company_id, COALESCE(store_code,'__NONE__'), phone)라
 *   자사몰로 먼저 등록된 고객(매장코드 없음)을 싱크가 매장코드와 함께 올리면 충돌하지 않아
 *   **새 행이 생긴다.** 옛 판정은 매장코드까지 비교해 그 행을 "처음 보는 사람"으로 봤고,
 *   10년 단골에게 환영 문자가 나갔다. 매장을 옮겨 재등록되는 경우도 같다.
 *   사람은 매장을 옮겨 다녀도 같은 사람이다.
 *
 *   방향 안전성: 비교 항목을 줄이는 변경이라 **제외 범위가 넓어진다**(덜 보낸다).
 *   전화번호 표기가 갈리는 축(하이픈 유무)은 고객 행 병합 과제로 별건 — 자사몰 경로는
 *   cdp-identity가 normalizePhone 후 (company_id, phone)으로 기존 행을 재사용한다.
 *
 * 파라미터는 journeyId 1개(호출부 $N 재사용).
 */
export function buildLedgerAntiJoin(custAlias: string, journeyParamIndex: number): string {
  const a = custAlias;
  return (
    `NOT EXISTS (SELECT 1 FROM journey_entry_ledger l ` +
    `WHERE l.journey_id = $${journeyParamIndex} ` +
    `AND l.company_id = ${a}.company_id ` +
    `AND l.phone = ${a}.phone)`
  );
}

/**
 * 활성화 시점 baseline 적재 — 그 시점 회사 전체 고객 식별자를 'baseline'으로 1회.
 * 멱등(ON CONFLICT DO NOTHING). entry_baseline_at은 아직 NULL일 때만 설정(첫 활성화 1회).
 */
export async function seedBaselineForJourney(journeyId: string, companyId: string): Promise<{ seeded: number }> {
  const r = await query(
    `INSERT INTO journey_entry_ledger (journey_id, company_id, store_code, phone, kind)
     SELECT $1::uuid, c.company_id, c.store_code, c.phone, 'baseline'
       FROM customers c
      WHERE c.company_id = $2::uuid AND c.phone IS NOT NULL AND c.phone <> ''
     ON CONFLICT (journey_id, company_id, COALESCE(store_code, '__NONE__'), phone) DO NOTHING`,
    [journeyId, companyId],
  );
  await query(
    `UPDATE journeys SET entry_baseline_at = NOW() WHERE id = $1::uuid AND entry_baseline_at IS NULL`,
    [journeyId],
  );
  return { seeded: r.rowCount || 0 };
}

/**
 * 진입 기록 — 호출부 트랜잭션 client로 execution INSERT와 원자 처리.
 * 멱등(ON CONFLICT DO NOTHING) — 같은 식별자 중복 진입 차단.
 */
export async function recordEnteredWithClient(
  client: { query: (sql: string, params?: any[]) => Promise<any> },
  journeyId: string,
  companyId: string,
  storeCode: string | null,
  phone: string,
): Promise<void> {
  await client.query(
    `INSERT INTO journey_entry_ledger (journey_id, company_id, store_code, phone, kind)
     VALUES ($1::uuid, $2::uuid, $3, $4, 'entered')
     ON CONFLICT (journey_id, company_id, COALESCE(store_code, '__NONE__'), phone) DO NOTHING`,
    [journeyId, companyId, storeCode, phone],
  );
}

// ═══════════════════════════════════════════════════════════
// §11-5 #7 — 원장 상태 일반화 (2026-08-02, 설계서 §3-0)
//   "전에 본 적 있나"(baseline/entered)에 "그때 상태값이 무엇이었나"(kind='state')를 얹는다.
//   등급 변동이 첫 소비자 — 이전 등급을 기억해야 "변했다"를 판정한다.
//   ⛔ state 행은 **사람 단위**(store_code NULL 고정)로 한 행만 둔다. 매장별로 쪼개면
//     같은 사람의 두 행이 서로 다른 옛 등급을 들고 있어 갱신 후에도 다른 행이 계속 발화한다.
//   state_value 컬럼은 §11-D-3 DDL — 없으면(42703) 호출부가 활성화를 거부한다(fail-closed).
// ═══════════════════════════════════════════════════════════

/**
 * 등급 기준선 재기준 — 매 활성화마다 전 고객의 (사람, 등급)을 현재값으로.
 * ⛔ Codex 2R — 거부된 활성화·정지 기간의 낡은 기준선이 다음 활성화 첫 회차에 변동을 몰아 발화시킨다.
 *   재기준은 그 변동을 보내지 않는 방향(덜 보냄)이다.
 */
export async function seedGradeStateForJourney(journeyId: string, companyId: string): Promise<{ seeded: number }> {
  const r = await query(
    `INSERT INTO journey_entry_ledger (journey_id, company_id, store_code, phone, kind, state_value)
     SELECT $1::uuid, s.company_id, NULL, s.phone, 'state', s.grade
       FROM (
         SELECT DISTINCT ON (c.phone) c.company_id, c.phone, c.grade
           FROM customers c
          WHERE c.company_id = $2::uuid AND c.phone IS NOT NULL AND c.phone <> ''
            AND COALESCE(c.grade, '') <> ''
          ORDER BY c.phone, c.created_at DESC
       ) s
     ON CONFLICT (journey_id, company_id, COALESCE(store_code, '__NONE__'), phone)
     DO UPDATE SET state_value = EXCLUDED.state_value`,
    [journeyId, companyId],
  );
  await query(
    `UPDATE journeys SET entry_baseline_at = NOW() WHERE id = $1::uuid AND entry_baseline_at IS NULL`,
    [journeyId],
  );
  return { seeded: r.rowCount || 0 };
}

/**
 * 관측 적재 — state 행이 없는 고객의 현재 등급을 기록(진입 없음). 워커가 매 회차 호출.
 * ⛔ Codex 2R — 기준선 이후 새로 나타난 고객은 state가 없어 "대상 아님"인데 만드는 곳도 없어
 *   그 고객의 이후 변동까지 영영 못 잡는 자기참조 구멍이었다. 첫 관측 = 기록만, 변동은 다음부터.
 */
export async function observeGradeStateForJourney(journeyId: string, companyId: string): Promise<number> {
  const r = await query(
    `INSERT INTO journey_entry_ledger (journey_id, company_id, store_code, phone, kind, state_value)
     SELECT $1::uuid, s.company_id, NULL, s.phone, 'state', s.grade
       FROM (
         SELECT DISTINCT ON (c.phone) c.company_id, c.phone, c.grade
           FROM customers c
          WHERE c.company_id = $2::uuid AND c.phone IS NOT NULL AND c.phone <> ''
            AND COALESCE(c.grade, '') <> ''
            AND NOT EXISTS (
              SELECT 1 FROM journey_entry_ledger l
               WHERE l.journey_id = $1::uuid AND l.company_id = c.company_id
                 AND l.phone = c.phone AND l.kind = 'state'
            )
          ORDER BY c.phone, c.created_at DESC
       ) s
     ON CONFLICT (journey_id, company_id, COALESCE(store_code, '__NONE__'), phone) DO NOTHING`,
    [journeyId, companyId],
  );
  return r.rowCount || 0;
}

/**
 * 진입한 고객의 state를 **현재 등급**으로 갱신 — 진입 트랜잭션 안에서(원자성).
 * 갱신을 빼먹으면 같은 변동이 매 회차 재발화한다.
 */
export async function syncGradeStateWithClient(
  client: { query: (sql: string, params?: any[]) => Promise<any> },
  journeyId: string,
  companyId: string,
  customerIds: string[],
): Promise<void> {
  if (customerIds.length === 0) return;
  await client.query(
    `INSERT INTO journey_entry_ledger (journey_id, company_id, store_code, phone, kind, state_value)
     SELECT $1::uuid, s.company_id, NULL, s.phone, 'state', s.grade
       FROM (
         SELECT DISTINCT ON (c.phone) c.company_id, c.phone, c.grade
           FROM customers c
          WHERE c.id = ANY($2::uuid[]) AND c.company_id = $3::uuid
            AND c.phone IS NOT NULL AND c.phone <> ''
          ORDER BY c.phone, c.created_at DESC
       ) s
     ON CONFLICT (journey_id, company_id, COALESCE(store_code, '__NONE__'), phone)
     DO UPDATE SET state_value = EXCLUDED.state_value`,
    [journeyId, customerIds, companyId],
  );
}

/**
 * baseline 적재 여부 — 추출이 원장 모드(활성)인지 created_at 추정 모드(초안 미리보기)인지 가른다.
 */
export async function hasBaseline(journeyId: string): Promise<boolean> {
  const r = await query(`SELECT entry_baseline_at FROM journeys WHERE id = $1::uuid`, [journeyId]);
  return !!r.rows[0]?.entry_baseline_at;
}

/**
 * ★ 2026-07-11 홀드아웃 대조군 — journeys.holdout_pct(신규 컬럼, 0~30 클램프) 조회.
 *   42703(미마이그레이션)·조회 실패 = 0(전원 발송군, 현행 동일). 배정은 "최초 진입"에서만 —
 *   재진입(reentry)은 이미 발송군이었던 고객이라 굴리지 않는다(대조군 오염 방지).
 */
export async function getJourneyHoldoutPct(journeyId: string): Promise<number> {
  try {
    const r = await query(`SELECT holdout_pct FROM journeys WHERE id = $1::uuid`, [journeyId]);
    const pct = Number(r.rows[0]?.holdout_pct);
    if (!Number.isFinite(pct) || pct <= 0) return 0;
    return Math.min(30, Math.floor(pct));
  } catch {
    return 0;
  }
}
