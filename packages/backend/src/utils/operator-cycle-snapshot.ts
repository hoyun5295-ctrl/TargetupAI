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
 * 규약 (2026-08-04 Codex 반영으로 확정 — 전체 교체 방식 폐기)
 *   - 문은 둘뿐이다.
 *     ① ensureCycleBaselineRows — **없는 사람만** 기준선 추가(DO NOTHING). 최초 기준선과
 *        매 회차 신규 고객 보충이 같은 문이다. 이미 있는 행(=아직 안 알린 변화)은 건드리지 않는다.
 *     ② advanceCycleSnapshotForPhones — **실제로 발송된 사람만** 지금 모습으로 갱신(DO UPDATE).
 *        근거는 발송 큐의 수신번호(캠페인 종결 후 MySQL `dest_no`)다.
 *   - ⛔ 전체 삭제 후 재삽입은 하지 않는다. 그 방식은 A매장 한 명의 발송이 B매장 고객·피로도 제외자의
 *     변화까지 소진시켰고(발송 범위 ≠ 갱신 범위), 기준선 이후 들어온 고객은 발송이 나야만 행이 생겼다.
 *     문을 둘로 나누면 두 결함이 함께 사라지고 지우는 코드도 없어진다.
 *   - 갱신 시점은 **캠페인 종결 후**다(큐 수락이 아니다). 종결 대조는 continuous-operator.ts의
 *     settle 패스가 소유한다 — 전량 실패(적재 0)면 갱신하지 않아 변화가 다음 회차에 남는다.
 *   - 첫 회차는 비교할 과거가 없다 — 기준선만 심고 대상 0 + 사유 통지(조용한 0건 금지).
 *   - 짝은 고객 행 id(automarketing-segment.cycleCompare 주석 — 전화번호로 이으면 남의 과거와 비교된다).
 *
 * ⛔ 이 표는 사실을 복사하지 않는다. `customers`는 **현재 등급·현재 누적치**만 갖고 과거는
 *   어디에도 없다. 없던 사실을 기록하는 것이라 미러가 아니다. 단 "스냅샷 상태 ↔ 캠페인 결과"는
 *   두 진실이므로 대조 워커(settle 패스)가 함께 있다(6원칙 ③).
 */
import { query } from '../config/database';

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
 * ⛔ 회사 결합 필수 — 어긋난 (operator, company) 쌍이 와도 남의 회사 기준선을 "있다"고 답하지 않는다.
 * ⛔ 테이블이 아직 없으면 false다 — "아직 기준선이 없다"는 담당자가 이해할 수 있는 안내이고 500이 아니다.
 */
export async function hasCycleBaseline(operatorId: string, companyId: string): Promise<boolean> {
  if (!operatorId || !companyId) return false;
  try {
    const r = await query(
      `SELECT 1 FROM operator_cycle_snapshots
        WHERE operator_id = $1::uuid AND company_id = $2::uuid LIMIT 1`,
      [operatorId, companyId],
    );
    return r.rows.length > 0;
  } catch (e: any) {
    if (e?.code === '42P01') return false;
    throw e;
  }
}

/**
 * 기준선 보충 — 스냅샷에 **없는 활성 고객만** 지금 모습으로 추가한다.
 *
 * 최초 기준선(표가 비어 있음)과 매 회차 신규 고객 보충이 같은 문이다. DO NOTHING이라
 * 이미 있는 행 — 즉 아직 발송으로 알리지 않은 변화 — 은 절대 덮이지 않는다.
 * 범위는 회사 전체다. 매장 제한 오퍼레이터라도 새 고객의 기준선을 지금 심어 둬야, 나중에 권한이
 * 넓어졌을 때 그 사람의 변화가 "기준선 없음"으로 영영 안 잡히는 구멍이 없다(기준선 추가는 아무것도
 * 소진하지 않으므로 넓게 심는 것이 안전한 방향이다).
 */
export async function ensureCycleBaselineRows(
  operatorId: string,
  companyId: string,
): Promise<{ inserted: number }> {
  try {
    const r = await query(
      `INSERT INTO operator_cycle_snapshots
         (operator_id, company_id, customer_id, grade, purchase_count, total_purchase_amount, recent_purchase_date, observed_at)
       SELECT $1::uuid, $2::uuid, c.id, c.grade, c.purchase_count, c.total_purchase_amount, c.recent_purchase_date, NOW()
         FROM customers c
        WHERE c.company_id = $2::uuid AND c.is_active = true
       ON CONFLICT (operator_id, customer_id) DO NOTHING`,
      [operatorId, companyId],
    );
    return { inserted: r.rowCount || 0 };
  } catch (e: any) {
    if (e?.code === '42P01') throw migrationPending();
    throw e;
  }
}

/**
 * 회차 마감 — **실제로 발송된 수신번호의 사람만** 지금 모습으로 갱신한다.
 *
 * 번호는 발송 큐(MySQL `dest_no`, `app_etc1` = 캠페인 id)에서 온다 — "누가 실제로 받았나"의
 * 원천이라 발송 범위와 갱신 범위가 구조적으로 같다. 같은 번호의 매장별 행은 전부 갱신한다
 * (발송은 사람 단위로 한 번 나갔고, 그 사람의 변화는 알린 것이다).
 * 멱등 — 같은 번호로 다시 불러도 현재 모습으로 다시 쓸 뿐이라 settle 재시도에 안전하다.
 */
export async function advanceCycleSnapshotForPhones(
  operatorId: string,
  companyId: string,
  phones: string[],
): Promise<{ updated: number }> {
  const clean = Array.from(new Set(
    (phones || []).map((p) => String(p || '').replace(/\D/g, '')).filter((p) => p.length > 0),
  ));
  if (clean.length === 0) return { updated: 0 };
  let updated = 0;
  const CHUNK = 10000;
  try {
    for (let i = 0; i < clean.length; i += CHUNK) {
      const part = clean.slice(i, i + CHUNK);
      const r = await query(
        `INSERT INTO operator_cycle_snapshots
           (operator_id, company_id, customer_id, grade, purchase_count, total_purchase_amount, recent_purchase_date, observed_at)
         SELECT $1::uuid, $2::uuid, c.id, c.grade, c.purchase_count, c.total_purchase_amount, c.recent_purchase_date, NOW()
           FROM customers c
          WHERE c.company_id = $2::uuid
            AND regexp_replace(COALESCE(c.phone, ''), '[^0-9]', '', 'g') = ANY($3::text[])
         ON CONFLICT (operator_id, customer_id) DO UPDATE SET
           grade                 = EXCLUDED.grade,
           purchase_count        = EXCLUDED.purchase_count,
           total_purchase_amount = EXCLUDED.total_purchase_amount,
           recent_purchase_date  = EXCLUDED.recent_purchase_date,
           observed_at           = EXCLUDED.observed_at`,
        [operatorId, companyId, part],
      );
      updated += r.rowCount || 0;
    }
    return { updated };
  } catch (e: any) {
    if (e?.code === '42P01') throw migrationPending();
    throw e;
  }
}
