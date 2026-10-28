/**
 * ★ CT: 자사몰 가져오기 · 적재 오류 판정(★ 2026-10-28 자사몰 대비 K11 · M27 · M29)
 *
 * 1. classifyIngestError = 그 건을 넣을 수 없는 오류(휴대폰 없음 · 필수 칸 · 시각 형식) = 'skip' · 그 밖(DB · 네트워크) = 'retry'.
 *    웹훅 수신 · 재처리 워커(processClaimedDelivery) · 가져오기 · 주기 수집이 같은 판정을 쓴다 — 넣을 수 없는 건이 재처리 3번 뒤
 *    소진 경보로 가지 않는다(장애처럼 다루지 않음).
 * 2. processImportItems = 한 쪽의 건들을 하나씩 적재한다(우커머스 0921 견고화를 공용으로 올림 · 고도몰 M27).
 *    skip = 그 건만 건너뛰고 셈 · retry 부류 = 그 건 실패로 세고 계속 · 연속 retry 부류가 상한이면 장애로 보고 던진다
 *    (전부 실패한 채 「완료」가 되지 않게) · UNIQUE 위반(23505) = 같은 고객을 동시에 만든 다른 건 → 한 번 더 넣으면 합쳐진다.
 * 3. isFirstImportRunning = 그 회사의 어느 몰이든 첫 가져오기가 도는 중인가(첫 구매 보호 · 검증 수정 14 · 상한 48시간 < 구매 진입 3일 창).
 *    판정 칸 = 우커머스 meta.woo_backfill(단계 · 시작 시각) · 그 밖 몰 = meta.first_import_started_at(가져오기가 시작에 쓰고 끝에 지운다).
 */
import { UserFacingError, CdpPhoneRequiredError } from './http-error';
import { query } from '../config/database';
import { ISO_TS } from './integration-token';

export type IngestErrorClass = 'skip' | 'retry';

export function classifyIngestError(err: unknown): IngestErrorClass {
  if (err instanceof CdpPhoneRequiredError) return 'skip';
  if (err instanceof UserFacingError && err.code === 'CDP_INPUT') return 'skip';
  // ★ 1028 Codex R2 #3 — PostgreSQL 데이터 오류(22 = 값 꼴 · 길이 · 23 = 제약 위반)는 다시 해도 같은 건이다 → 넣을 수 없는 건(재시도 부류가 영구히 남지 않게)
  const code = String((err as { code?: unknown } | null)?.code ?? '');
  if (/^2[23][0-9A-Z]{3}$/.test(code)) return 'skip';
  return 'retry';
}

/** 연속 실패 상한 — 데이터 문제는 드문드문 · 장애(DB 끊김)는 연속으로 난다 */
export const IMPORT_MAX_CONSECUTIVE_FAILURES = 10;
const MAX_FAILURE_LOGS_PER_RUN = 20;

/** 한 회차(가져오기 1회 · 주기 수집 1회) 동안 쪽을 넘어 이어지는 연속 실패 수 · 로그 수 */
export interface ImportRunGuard { streak: number; logged: number }
export const newImportGuard = (): ImportRunGuard => ({ streak: 0, logged: 0 });

export interface ImportTally<R> { results: R[]; skipped: number; failed: number }

export async function processImportItems<T, R>(
  items: T[],
  apply: (item: T) => Promise<R>,
  guard: ImportRunGuard,
  label: (item: T) => string,
): Promise<ImportTally<R>> {
  const t: ImportTally<R> = { results: [], skipped: 0, failed: 0 };
  for (const item of items) {
    try {
      t.results.push(await apply(item).catch((e: any) => { if (e?.code === '23505') return apply(item); throw e; }));
      guard.streak = 0;
    } catch (err: any) {
      const skip = classifyIngestError(err) === 'skip';
      if (skip) t.skipped++;
      else { t.failed++; guard.streak++; }
      if (guard.logged < MAX_FAILURE_LOGS_PER_RUN) {
        guard.logged++;
        console.error(`[MallImport] 적재 ${skip ? '건너뜀(넣을 수 없는 건)' : '실패(그 건만)'} ${label(item)} — ${err?.message || err}`);
      }
      if (guard.streak >= IMPORT_MAX_CONSECUTIVE_FAILURES) throw err;
    }
  }
  return t;
}

/** 첫 가져오기 보류 상한(시간) — 가져오기가 죽어 표시가 남아도 여정이 이보다 오래 서지 않는다 */
export const FIRST_IMPORT_HOLD_HOURS = 48;

export async function isFirstImportRunning(companyId: string): Promise<boolean> {
  const ts = (expr: string) => `CASE WHEN ${expr} ~ ${ISO_TS} THEN (${expr})::timestamptz END`;
  const r = await query(
    `SELECT 1 FROM company_integrations
      WHERE company_id = $1::uuid AND status <> 'revoked'
        AND ((meta->'woo_backfill'->>'stage' IN ('customers', 'orders')
              AND ${ts("meta->'woo_backfill'->>'started_at'")} > NOW() - make_interval(hours => $2))
          OR ${ts("meta->>'first_import_started_at'")} > NOW() - make_interval(hours => $2))
      LIMIT 1`,
    [companyId, FIRST_IMPORT_HOLD_HOURS],
  );
  return r.rows.length > 0;
}
