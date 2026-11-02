/**
 * utils/ai-credit-release.ts — 못 보낸 발송 크레딧 되돌림 한 함수(★ 2026-11-01 크레딧 컨트롤타워 편입 · 설계서 §16-1 F5 · 뿌리 R4 · R39)
 *
 * 발송 크레딧(SEND_CREDIT_SOURCES)은 보내기 전에 엄격하게 걷고, 확실히 안 나간 시도만 나중에 원 차감 키로 돌려준다(`release:` 키).
 * 옛: 같은 꼴 SQL 이 여정 · 플래너 · 자동 마케팅 세 파일에 따로 있었다(원장 표를 기능이 직접 물음).
 * 지금: 원장 쪽(후보 줄 · 이미 돌려준 키 거르기 · 되돌림 줄 쓰기 · 실패 경보)은 여기 하나, 「그 시도가 나갔나」는 기능이 SQL 조건으로 넘긴다.
 *   - 거르는 조건은 전부 SQL 안(LIMIT 앞) — 정상 차감이 자리를 차지해 못 보낸 시도가 밀려나지 않게(1024 Codex 1R).
 *   - 후보 = 커서 순환(오래된 순 · 지난 회차 마지막 줄 뒤부터 LIMIT 건 · 끝까지 보면 처음부터) — 무엇이 막혀 있어도 한 바퀴 안에 전부 본다.
 *     바퀴의 끝 = 바퀴를 시작한 DB 시각(상한) — 새 후보가 회차마다 LIMIT 만큼 들어와도 그 바퀴는 상한에서 끝나고 처음으로 돌아간다(★ 1102 Codex 구현 4R).
 *     옛(1R~2R): 오래된 순 LIMIT + 빼기 집합 덧대기 → 막힌 항목이 「용량 × 빼는 시간」을 넘으면 다시 앞자리를 막았다(같은 부류 세 번 · ★ 1102 Codex 구현 3R 구조 처방).
 *   - 못 나아가는 후보(보류 · 다른 길로 환불됨 · 되돌릴 수 없는 꼴 · 예외)는 다시 시도할 때까지 뺀다 = 진행이 아니라 다시 시도 빈도(1R-1).
 *   - 자동 환불 기간이 하루 안에 끝나는데 못 돌려준 후보 = 회사별 수 · 크레딧 집계 경보(LIMIT 없음 · 하나도 빠지지 않는다 · 3R).
 *   - 되돌림 = refundCredit(같은 키 두 번 환불 0 · 원 차감 키로 버킷 복원).
 *   - 실패 = 줄마다 로그 + 한 주기 경보 1통(§16-6 · 옛 자동 마케팅은 회사마다 1통).
 */
import { query } from '../config/database';
import { refundCredit } from './ai-credit';
import type { RefundResult } from './ai-credit-tx';
import type { PassFailure } from './system-alert';

export interface UnsentReleaseSpec {
  /** 발송 크레딧 원천 */
  source: string;
  /** 경보 · 로그 이름 */
  pass: string;
  /** 이 원천의 차감 키 꼴(LIKE · 기능이 정한다) */
  keyLike?: string;
  /** 차감 뒤 이만큼 지난 줄만(분) */
  minAgeMinutes?: number;
  /** 이만큼 안의 줄만(일) */
  lookbackDays: number;
  /** 키 셋째 칸(한국 날짜 YYYYMMDD)이 오늘 전인 줄만 — 하루가 끝난 뒤 판정하는 원천(여정 운영) */
  onlyPastDays?: boolean;
  /** 「그 시도가 나가지 않았다」 SQL 조건(원장 줄 별칭 t · AND 로 붙는다 · 기능 표 사실) */
  notSentSql: string;
  limit: number;
  reason: string;
  /** 키 모양 검사(통과 못 하면 건너뜀) */
  acceptKey?: (key: string) => boolean;
}

/** 원장 쪽 조건 + 기능의 안 나감 조건(자리표 $1 원천 · $2 키 꼴(없으면 NULL) · $3 지금은 다시 시도하지 않을 키 text[]) */
function releaseWhere(spec: UnsentReleaseSpec): string {
  return `t.type = 'deduct' AND t.source = $1
        ${spec.keyLike ? 'AND t.idempotency_key LIKE $2' : 'AND $2::text IS NULL'}
        ${spec.minAgeMinutes ? `AND t.created_at < NOW() - INTERVAL '${Math.floor(spec.minAgeMinutes)} minutes'` : ''}
        AND t.created_at > NOW() - INTERVAL '${Math.floor(spec.lookbackDays)} days'
        AND NOT (t.idempotency_key = ANY($3::text[]))
        ${spec.onlyPastDays ? `AND split_part(t.idempotency_key, ':', 3) < to_char((NOW() AT TIME ZONE 'Asia/Seoul')::date, 'YYYYMMDD')` : ''}
        AND NOT EXISTS (SELECT 1 FROM ai_credit_transactions x WHERE x.idempotency_key = 'release:' || t.idempotency_key)
        AND ${spec.notSentSql}`;
}

/**
 * 되돌릴 후보 SQL — 시험이 조건을 고정한다. 거르는 조건은 전부 LIMIT 앞.
 *   $4 · $5 = 커서(지난 회차 마지막 줄의 시각 글 · 키 · 처음 = NULL) — 오래된 순으로 커서 뒤부터 LIMIT 건(무엇이 막혀도 한 바퀴 안에 전부 본다 · ★ 1102 Codex 구현 3R).
 *   $6 = 이 바퀴의 상한(바퀴 시작 때 NULL → 그 순간 DB NOW() · 돌려줌 bound_text 로 다음 회차에 그대로) — 상한 뒤 줄은 다음 바퀴(4R).
 */
export function unsentReleaseCandidatesSql(spec: UnsentReleaseSpec): string {
  return `SELECT t.company_id, t.idempotency_key, t.amount, t.created_at::text AS at_text, COALESCE($6::timestamptz, NOW())::text AS bound_text
       FROM ai_credit_transactions t
      WHERE ${releaseWhere(spec)}
        AND t.created_at <= COALESCE($6::timestamptz, NOW())
        AND ($4::timestamptz IS NULL OR (t.created_at, t.idempotency_key) > ($4::timestamptz, $5::text))
      ORDER BY t.created_at ASC, t.idempotency_key ASC
      LIMIT ${Math.floor(spec.limit)}`;
}

/** 기간 끝 하루 안 미해결 후보 = 회사별 수 · 크레딧(LIMIT 없음 · 하나도 빠지지 않는다 · $3 = 끝난 일 키 · ★ 1102 Codex 구현 3R) */
export function unsentReleaseAgingSql(spec: UnsentReleaseSpec): string {
  return `SELECT t.company_id, COUNT(*)::int AS n, COALESCE(SUM(ABS(t.amount)), 0)::int AS credits
       FROM ai_credit_transactions t
      WHERE ${releaseWhere(spec)}
        AND t.created_at <= NOW() - INTERVAL '${Math.max(1, Math.floor(spec.lookbackDays) - 1)} days'
      GROUP BY t.company_id`;
}

/**
 * 확실히 안 나간 시도 하나의 발송 크레딧을 돌려준다(`release:` + 원 차감 키 · 같은 키 두 번 환불 0).
 *   반환 = 환불 결과(돌려줌 · 못 돌려준 까닭) · 실패는 던진다(호출부가 모아 경보하거나 대조 패스가 다시 한다).
 */
export async function releaseOneSendCharge(o: { companyId: string; key: string; amount: number; source: string; reason: string; pass: string }): Promise<RefundResult> {
  const out = await refundCredit({
    companyId: o.companyId,
    amount: Math.abs(Number(o.amount) || 0),
    source: o.source,
    reason: o.reason,
    idempotencyKey: `release:${o.key}`,
    originalIdempotencyKey: o.key,
  });
  if (out.refunded) console.log(`[credit-release][${o.pass}] 못 보낸 시도 ${out.amount} 되돌림 key=${o.key}`);
  return out;
}

/**
 * 지금은 다시 시도하지 않을 키(★ 1102 Codex 구현 1R-1) — 보류 · 되돌릴 수 없는 꼴 = 24시간(보류 경보 하루 1통과 같은 주기 · 사람이 원장으로 판정해 같은 키로 수동 환불) ·
 *   다른 길로 이미 환불됨 = 24시간 + 기간 끝 경보에서 뺌(끝난 일) · 예외 = 30분.
 *   ponytail: 프로세스 기억 — 재기동하면 한 번씩 다시 시도한다(결말이 같으면 다시 들어온다). 기다림을 원장 칸으로 둘 일이 생기면 그때.
 */
const releaseWait = new Map<string, { until: number; settledElsewhere: boolean }>();
const RELEASE_STUCK_WAIT_MS = 24 * 60 * 60 * 1000;
const RELEASE_ERROR_WAIT_MS = 30 * 60 * 1000;
/** 패스마다 커서(지난 회차 마지막 줄 · 이 바퀴 상한) — 없으면 새 바퀴(처음부터 · 상한 = 그때 DB 시각) · 프로세스 기억(재기동 = 새 바퀴) */
const releaseCursor = new Map<string, { at: string; key: string; bound: string }>();

/** 지금 기다리는 키(기다림이 끝난 키는 지운다) */
function waitingKeys(nowMs: number, pick: (w: { settledElsewhere: boolean }) => boolean): string[] {
  const out: string[] = [];
  for (const [k, w] of releaseWait) {
    if (w.until <= nowMs) releaseWait.delete(k);
    else if (pick(w)) out.push(k);
  }
  return out;
}

/** 못 보낸 시도의 발송 크레딧을 돌려준다. 반환 = 후보 수 · 돌려준 수 · 보류 수 */
export async function releaseUnsentSendCharges(spec: UnsentReleaseSpec): Promise<{ candidates: number; released: number; held: number }> {
  const cursor = releaseCursor.get(spec.pass) ?? null;
  const r = await query(unsentReleaseCandidatesSql(spec), [spec.source, spec.keyLike ?? null, waitingKeys(Date.now(), () => true), cursor?.at ?? null, cursor?.key ?? null, cursor?.bound ?? null]);
  // 이 바퀴를 상한까지 다 봤으면(LIMIT 보다 적음) 다음 회차는 새 바퀴 · 아니면 이번 마지막 줄 뒤부터(상한 그대로)
  const lastRow = r.rows[r.rows.length - 1] as { at_text?: string; idempotency_key?: string; bound_text?: string } | undefined;
  if (!lastRow || r.rows.length < Math.floor(spec.limit)) releaseCursor.delete(spec.pass);
  else releaseCursor.set(spec.pass, { at: String(lastRow.at_text), key: String(lastRow.idempotency_key), bound: String(lastRow.bound_text) });
  let released = 0;
  let held = 0;
  const failures: PassFailure[] = [];
  for (const row of r.rows as Array<{ company_id: string; idempotency_key: string; amount: number }>) {
    const key = String(row.idempotency_key);
    if (spec.acceptKey && !spec.acceptKey(key)) {
      // 이 기능의 키 모양이 아님 = 이 패스 후보가 아니다 · 하루 동안 LIMIT 앞에서 뺀다(자리 차지 0 · 기간 끝 경보 대상 아님)
      releaseWait.set(key, { until: Date.now() + RELEASE_STUCK_WAIT_MS, settledElsewhere: true });
      continue;
    }
    try {
      const out = await releaseOneSendCharge({ companyId: String(row.company_id), key, amount: Number(row.amount) || 0, source: spec.source, reason: spec.reason, pass: spec.pass });
      if (out.refunded) { released += 1; continue; }
      // 못 나아가는 결말 = 하루 기다린다(보류 경보 = 환불 CT 한 곳 · 다른 길 환불 = 끝난 일 · 그 밖 = 사람이 볼 실패)
      const settledElsewhere = out.skipReason === 'already_refunded' || out.skipReason === 'duplicate';
      releaseWait.set(key, { until: Date.now() + RELEASE_STUCK_WAIT_MS, settledElsewhere });
      if (out.skipReason === 'held_after_lifetime_end') held += 1;
      else if (!settledElsewhere) {
        failures.push({ companyId: String(row.company_id), error: `되돌릴 수 없는 꼴: ${out.skipReason || '알 수 없음'}`, key });
        console.error(`[credit-release][${spec.pass}][REFUND-MISS] 되돌릴 수 없는 꼴 ${out.skipReason} key=${key}(하루 뒤 다시)`);
      }
    } catch (e: any) {
      releaseWait.set(key, { until: Date.now() + RELEASE_ERROR_WAIT_MS, settledElsewhere: false });
      failures.push({ companyId: String(row.company_id), error: String(e?.message || e), key });
      console.error(`[credit-release][${spec.pass}][REFUND-MISS] 되돌림 실패 key=${key}(30분 뒤 다시):`, e?.message || e);
    }
  }
  if (held > 0) console.warn(`[credit-release][${spec.pass}] 보류 ${held}건(끝난 수명 뒤 구성분 모름 · 하루 뒤 다시 · 경보 = 환불 CT)`);
  // 자동 환불 기간이 하루 안에 끝나는데 못 돌려준 후보(다른 길로 환불된 키 제외) = 회사별 수 · 크레딧 집계 경보 · 창이 끝나 조용히 사라지지 않게
  const aging = await query(unsentReleaseAgingSql(spec), [spec.source, spec.keyLike ?? null, waitingKeys(Date.now(), (w) => w.settledElsewhere)]);
  const { alertPassFailures } = await import('./system-alert');
  await alertPassFailures({
    pass: `credit-release:${spec.pass}`, title: '보내지 못한 발송의 크레딧을 돌려주지 못한 회사가 있습니다.', failures, total: r.rows.length,
    action: '서버 로그 [credit-release] REFUND-MISS 줄의 키를 확인해 주세요(다음 회차에 다시 시도 · 기간이 지나면 같은 키로 수동 환불).',
  }).catch(() => undefined);
  await alertPassFailures({
    pass: `credit-release-aging:${spec.pass}`, title: `자동 환불 기간(${spec.lookbackDays}일)이 하루 안에 끝나는데 돌려주지 못한 발송 크레딧이 있습니다.`,
    failures: (aging.rows as Array<{ company_id: string; n: number; credits: number }>).map((x) => ({ companyId: String(x.company_id), error: `미해결 ${Number(x.n) || 0}건 · ${Number(x.credits) || 0}크레딧` })),
    total: aging.rows.length,
    action: '원장에서 그 회사의 이 원천 차감 중 되돌림 줄(release: + 원 키)이 없는 키를 찾아 같은 키로 수동 환불해 주세요(기간이 지나면 자동으로 다시 보지 않습니다).',
  }).catch(() => undefined);
  return { candidates: r.rows.length, released, held };
}
