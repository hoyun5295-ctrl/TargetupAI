/**
 * line-draft-memo.ts — 한 줄 DM 착지 초안 ↔ 멱등키 기억 CT (★ 2026-10-10 · 설계서 docs/2026-10-10-oneline-dm-email-design.md §3-10 · Codex 1R · 2R)
 *
 * 착지 경로는 「초안 행 → 차감」 순서다. **돈을 안 낸 초안은 건네지 않는다**(원장 쓰기 실패 · 잔액 부족 = 초안 회수 + 다시 시도/402).
 * 그래서 여기서 기억하는 것은 두 가지뿐이다.
 *   - paid   = 낸 초안. 같은 시도(같은 멱등키)의 재요청은 새로 만들지 않고 이 초안을 돌려준다(30분).
 *   - orphan = 거두려다 회수(삭제)가 끝내 실패한 미과금 초안. **만료하지 않는다** — 같은 시도의 재요청이 회수를 다시 시도하고,
 *              회수되기 전에는 그 시도로 새 초안을 만들지 않는다.
 *
 * ponytail: 프로세스 메모리 — 재시작하면 잊는다(pm2 fork 1개 전제 · inflight-lock 과 같은 전제). 잊힌 paid 의 재요청은 원장 멱등(이미 낸 키 = 409)이 막고,
 *   잊힌 orphan 은 [CREDIT][ORPHAN] 로그로 남는다(원장 쓰기와 삭제가 연달아 실패한 이중 장애에서만 생긴다). 영속이 필요해지면 초안 행에 멱등키 칸.
 */

const LINE_DRAFT_PAID_TTL_MS = 30 * 60 * 1000;
type LineDraftState = 'paid' | 'orphan';
const memo = new Map<string, { draftId: string; state: LineDraftState; at: number }>();

function prune(now: number): void {
  for (const [k, v] of memo) if (v.state === 'paid' && now - v.at >= LINE_DRAFT_PAID_TTL_MS) memo.delete(k);
}

/** 이 멱등키의 착지 초안 상태를 적는다(paid = 차감 확인 뒤 · orphan = 회수 실패 뒤). */
export function rememberLineDraft(idempotencyKey: string, draftId: string, state: LineDraftState, now: number = Date.now()): void {
  if (!idempotencyKey || !draftId) return;
  prune(now);
  memo.set(idempotencyKey, { draftId, state, at: now });
}

/** 같은 멱등키의 착지 초안(paid 는 30분 · orphan 은 회수될 때까지). 없으면 null. */
export function recallLineDraft(idempotencyKey: string, now: number = Date.now()): { draftId: string; state: LineDraftState } | null {
  const v = idempotencyKey ? memo.get(idempotencyKey) : undefined;
  if (!v) return null;
  if (v.state === 'paid' && now - v.at >= LINE_DRAFT_PAID_TTL_MS) { memo.delete(idempotencyKey); return null; }
  return { draftId: v.draftId, state: v.state };
}

/** 초안을 회수했으면 잊는다(다음 재요청은 새로 만든다). */
export function forgetLineDraft(idempotencyKey: string): void {
  if (idempotencyKey) memo.delete(idempotencyKey);
}

/**
 * 미과금 초안을 거둔다 — 몇 번 다시 시도하고, 끝내 실패하면 [CREDIT][ORPHAN] 로그를 남기고 false.
 * (false 면 호출부는 orphan 으로 적는다 → 같은 시도의 재요청이 회수를 다시 시도한다 · 새 초안 0)
 */
export async function deleteLineDraftWithRetry(
  del: () => Promise<unknown>,
  label: string,
  opts: { attempts?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<boolean> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let i = 1; i <= attempts; i++) {
    try {
      await del();
      return true;
    } catch (err: any) {
      if (i < attempts) { await sleep(i * 200); continue; }
      console.log(`[CREDIT][ORPHAN] ${label} err=${err?.message}`);
    }
  }
  return false;
}
