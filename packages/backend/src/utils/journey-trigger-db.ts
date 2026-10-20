/**
 * journey-trigger-db.ts — DB 시작 사건 목록(CHECK journeys_trigger_event_registered)이 그 사건을 받는가
 *
 * 새 시작 사건은 레지스트리(TRIGGER_CONTRACTS)와 DB CHECK 를 함께 늘린다(SCHEMA §journeys). 코드는 배포 뒤 DDL 전까지
 * 그 사건을 저장하지 못하므로, 저장 전에 여기서 묻고 503 DB_MIGRATION_PENDING 으로 돌려준다(상품 재구매 · 앞 여정을 마치면).
 * 제약이 없으면 받는다. 참은 1시간 기억(거짓은 기억하지 않는다 · DDL 직후 바로 열린다).
 */
import { query } from '../config/database';

/** DB 가 아직 이 시작 사건을 받지 않는다(CHECK 교체 전) — 라우트가 503 DB_MIGRATION_PENDING 으로 돌려준다. */
export class JourneyMigrationPendingError extends Error {
  readonly code = 'DB_MIGRATION_PENDING';
  constructor(message: string) { super(message); this.name = 'JourneyMigrationPendingError'; }
}

const acceptedAt = new Map<string, number>();

export async function dbAcceptsTriggerEvent(triggerEvent: string): Promise<boolean> {
  if (Date.now() - (acceptedAt.get(triggerEvent) || 0) < 60 * 60 * 1000) return true;
  const r = await query(
    `SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c
      WHERE c.conrelid = 'journeys'::regclass AND c.contype = 'c' AND pg_get_constraintdef(c.oid) ILIKE '%trigger_event%'`,
  );
  const ok = r.rows.length === 0 || r.rows.every((x: any) => String(x.def || '').includes(`'${triggerEvent}'`));
  if (ok) acceptedAt.set(triggerEvent, Date.now());
  return ok;
}
