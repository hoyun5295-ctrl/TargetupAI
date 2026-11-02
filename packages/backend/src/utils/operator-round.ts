/**
 * operator-round.ts — 자동마케팅 회차 정체 · 동시 생성 · 교체 한 곳(★ 2026-11-02 설계서 docs/2026-11-02-journey-automarketing-core-fix-design.md 3-1 · 3-0 CT-O1 · D3).
 *
 * 왜 있나
 *   회차를 정체 없이 만들어(다음 생성 시각 · 생성 관문 · 동시 실행이 「같은 발송 시각의 회차」를 몰랐다) 같은 회차 제안이 둘 생기고,
 *   승인 · 보낸 회차 뒤에도 워커가 같은 회차를 다시 만들었다.
 *   → 회차 키 = (운영자 · 일정의 그 회차 시각) · 확인 · 교체 · 넣기 = 회차 잠금 안 한 트랜잭션 · 교체 = 읽은 id 를 조건으로(승인과 엇갈리지 않게).
 */
import { withTransaction } from '../config/database';
import { computeNextOccurrence, type OperatorScheduleKind } from './autosend-policy';

type SqlRun = (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }>;

/** 회차 키 = 일정의 그 회차 시각(고정 = 발송 희망 시각 · AI 최적 = 그 회차의 일정 시각 · ISO) */
export function roundKeyOf(op: {
  schedule: OperatorScheduleKind; scheduleTime: string;
  scheduleDayOfWeek: number | null; scheduleDayOfMonth: number | null; scheduleMonth: number | null;
}, now: Date = new Date()): string {
  return computeNextOccurrence(op.schedule, op.scheduleTime, op.scheduleDayOfWeek, op.scheduleDayOfMonth, op.scheduleMonth, now).toISOString();
}

/** 제안 행의 회차 키(옛 제안 = 대상의 기준 시각 anchorAt) */
export function roundKeySql(alias: string): string {
  return `COALESCE(${alias}.proposal_json->'meta'->>'roundKey', ${alias}.proposal_json->'target'->>'anchorAt')`;
}

/** 이 회차가 이미 끝을 냈다(만들지 않는다) = 예약 · 보내는 중 · 보냄 · 승인 · 거부 · 생략 · 멈춤 */
export const ROUND_DONE_STATUSES = ['scheduled', 'sending', 'sent', 'approved', 'rejected', 'skipped', 'admin_stopped'] as const;
/** 담당자 손에 있는 회차(워커는 만들지 않는다 · 지금 실행 = 교체) */
export const ROUND_OPEN_STATUSES = ['pending', 'admin_review'] as const;

/** 같은 회차 키의 비리마인드 제안 상태 */
export async function roundState(run: SqlRun, operatorId: string, roundKey: string): Promise<{ done: boolean; openIds: string[] }> {
  const r = await run(
    `SELECT p.id, p.status FROM operator_proposals p
      WHERE p.operator_id = $1::uuid AND ${roundKeySql('p')} = $2
        AND COALESCE(p.proposal_json->'meta'->>'is_reminder', 'false') <> 'true'`,
    [operatorId, roundKey],
  );
  const rows = r.rows as Array<{ id: string; status: string }>;
  return {
    done: rows.some((x) => (ROUND_DONE_STATUSES as readonly string[]).includes(String(x.status))),
    openIds: rows.filter((x) => (ROUND_OPEN_STATUSES as readonly string[]).includes(String(x.status))).map((x) => String(x.id)),
  };
}

/** (운영자 · 회차 키) 트랜잭션 잠금 안에서 확인 · 교체 · 넣기(AI 호출은 잠금 밖) */
export async function withRoundLock<T>(operatorId: string, roundKey: string, fn: (run: SqlRun) => Promise<T>): Promise<T> {
  return withTransaction(async (run) => {
    await run(`SELECT pg_advisory_xact_lock(hashtext('operator-round'), hashtext($1::text || ':' || $2::text))`, [operatorId, roundKey]);
    return fn(run);
  });
}

/**
 * 교체 = 읽은 대기 · 검토 제안 id 만 만료(그 상태일 때만) · 돌아온 수 = 본 수일 때만 참(그사이 사람이 승인했으면 거짓 = 새 회차 0 · 롤백은 부르는 쪽).
 */
export async function replaceRoundCas(run: SqlRun, seenOpenIds: string[]): Promise<boolean> {
  if (seenOpenIds.length === 0) return true;
  const r = await run(
    `UPDATE operator_proposals SET status = 'expired'
      WHERE id = ANY($1::uuid[]) AND status IN ('pending', 'admin_review')
      RETURNING id`,
    [seenOpenIds],
  );
  return r.rows.length === seenOpenIds.length;
}
