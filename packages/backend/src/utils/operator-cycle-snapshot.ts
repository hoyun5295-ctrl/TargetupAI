/**
 * operator-cycle-snapshot.ts — 자동마케팅 회차 스냅샷 (2026-08-04 행동 축 확장)
 *
 * 왜 있나 — 자동마케팅과 여정을 가르는 것이 여기 있다.
 *   여정은 **고객의 시계**로 움직인다. 고객이 무언가를 한 순간 그 사람 시계가 시작되고, 사람마다
 *   시각이 따로 돌아 "지난달"이라는 개념 자체가 없다.
 *   자동마케팅은 **우리 시계**로 움직인다. 회차라는 시간 격자가 있어서 "지난 회차와 지금 사이에
 *   무엇이 달라졌나"를 물을 수 있고, 그건 담당자가 실제로 쓰는 말이다 —
 *   "이번에 등급 오르신 분", "요즘 발길 끊긴 분", "오랜만에 다시 오신 분".
 *   그 질문에 답하려면 **지난 회차의 모습**을 갖고 있어야 한다. 이 표가 그것이다.
 *
 * 규약
 *   - 오퍼레이터마다 **직전 한 벌**만 둔다. 회차가 끝나면 통째로 갈아 끼운다(이력 표가 아니다).
 *   - 짝은 고객 행 id로 맞춘다(automarketing-segment.cycleCompare 주석 — 전화번호로 이으면
 *     매장별 여러 행인 회사에서 남의 과거와 비교된다).
 *   - 갱신 시점은 **발송이 끝난 뒤**다. 제안 생성 시점에 갈아 끼우면 발송 직전 재추출이
 *     자기가 방금 심은 스냅샷과 비교해 대상 0이 된다("보여준 수 = 나가는 수"가 깨진다).
 *   - 발송이 안 나간 회차는 갱신하지 않는다. 안 알린 변화는 아직 남아 있는 변화다.
 *   - 첫 회차는 비교할 과거가 없다 — 기준선만 심고 대상 0 + 사유 통지(조용한 0건 금지).
 *
 * ⛔ 이 표는 사실을 복사하지 않는다. `customers`는 **현재 등급·현재 누적치**만 갖고 과거는
 *   어디에도 없다. 없던 사실을 기록하는 것이라 미러가 아니고, 그래서 멱등키·대조 워커가 필요 없다.
 */
import { query, pool } from '../config/database';

export interface CycleSnapshotResult {
  /** 이번에 심은 행 수. */
  rows: number;
  /** 이 회차 전에 비교할 과거가 있었는가 — false면 이번이 기준선 회차다. */
  hadBaseline: boolean;
}

/** 테이블 미생성(42P01)을 라우트·워커가 알아볼 수 있게 코드를 붙여 던진다. */
function migrationPending(): Error {
  return Object.assign(
    new Error('DB 마이그레이션 필요 — operator_cycle_snapshots 테이블 생성 요청'),
    { code: 'DB_MIGRATION_PENDING' },
  );
}

/**
 * 표가 운영에 있는가 — 변화 축을 컴파일하기 전 단 한 곳에서 본다.
 *
 * 없는 표를 참조하는 SQL은 42P01로 터지고, 그건 담당자 화면에 500으로 나간다. 축을 만들기 전에
 * 여기서 갈라 **사유가 있는 503**으로 돌려준다(db_alter_safety_net의 표 판).
 * 캐시는 "준비됨"만 기억한다 — 마이그레이션은 배포 뒤에 돌고, 그때 재기동 없이 자동 활성돼야 한다.
 */
let snapshotTableReadyCache = false;
export async function isCycleSnapshotReady(): Promise<boolean> {
  if (snapshotTableReadyCache) return true;
  const r = await query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = 'operator_cycle_snapshots' LIMIT 1`,
  );
  snapshotTableReadyCache = r.rows.length > 0;
  return snapshotTableReadyCache;
}

/** 표 미생성을 라우트가 503으로 돌려줄 수 있게 코드를 붙여 던진다. */
export function cycleSnapshotMigrationPending(): Error {
  return migrationPending();
}

/**
 * 비교할 지난 회차가 있는가.
 * ⛔ 테이블이 아직 없으면 false다 — 없는 것을 있다고 하면 변화 축이 42P01로 터진다.
 *   "아직 기준선이 없다"는 안내는 담당자가 이해할 수 있는 상태이고, 500은 아니다.
 */
export async function hasCycleBaseline(operatorId: string): Promise<boolean> {
  if (!operatorId) return false;
  try {
    const r = await query(
      `SELECT 1 FROM operator_cycle_snapshots WHERE operator_id = $1::uuid LIMIT 1`,
      [operatorId],
    );
    return r.rows.length > 0;
  } catch (e: any) {
    if (e?.code === '42P01') return false;
    throw e;
  }
}

/**
 * 회차 스냅샷 갈아 끼우기 — 지금 이 회사 고객의 모습을 이 오퍼레이터의 "지난 회차"로 남긴다.
 *
 * 지우고 넣는 것을 한 트랜잭션에 둔다. 나눠 두면 그 사이에 대상을 세는 요청이 **빈 과거**를 보고
 * 변화 0을 돌려준다 — 화면에는 "대상 없음"이 뜨는데 이유가 어디에도 없다.
 *
 * 범위는 회사 전체다. 매장 제한은 대상을 세고 뽑는 자리(buildAudienceWhere storeFilter)가 이미
 * 적용하므로, 여기서 한 번 더 좁히면 담당자 권한이 바뀔 때 과거가 통째로 사라진다.
 */
export async function recordCycleSnapshot(
  operatorId: string,
  companyId: string,
): Promise<CycleSnapshotResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const before = await client.query(
      `SELECT 1 FROM operator_cycle_snapshots WHERE operator_id = $1::uuid LIMIT 1`,
      [operatorId],
    );
    await client.query(`DELETE FROM operator_cycle_snapshots WHERE operator_id = $1::uuid`, [operatorId]);
    const ins = await client.query(
      `INSERT INTO operator_cycle_snapshots
         (operator_id, company_id, customer_id, grade, purchase_count, total_purchase_amount, recent_purchase_date, observed_at)
       SELECT $1::uuid, $2::uuid, c.id, c.grade, c.purchase_count, c.total_purchase_amount, c.recent_purchase_date, NOW()
         FROM customers c
        WHERE c.company_id = $2::uuid AND c.is_active = true`,
      [operatorId, companyId],
    );
    await client.query('COMMIT');
    return { rows: ins.rowCount || 0, hadBaseline: before.rows.length > 0 };
  } catch (e: any) {
    await client.query('ROLLBACK').catch(() => {});
    if (e?.code === '42P01') throw migrationPending();
    throw e;
  } finally {
    client.release();
  }
}
