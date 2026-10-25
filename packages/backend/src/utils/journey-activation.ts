/**
 * journey-activation.ts — 여정 켜기 게이트 CT (★ 2026-09-30 여정 V2 2차 · 설계서 §5 · §13-1 "2차 켜기 묶음(치명)")
 *
 * 왜 있나
 *   켜기 게이트(발송 전 문안 검증 마커 · 매장번호 미등록 회신 확인 · 최초 활성화 크레딧 확인/차감 · 1회 발송 첫 적재)가
 *   라우트(POST /operator/journeys/:id/activate) 본문에만 있었다. [모두 켜기]가 activateJourney 를 직접 부르면
 *   이 게이트를 전부 건너뛴다(차감 0 · 미검증 켜짐). 게이트를 여기 한 곳으로 옮기고 단건 라우트와 묶음이 같이 쓴다.
 *
 * ⛔ 동작 불변: 단건 라우트의 순서 · 문구 · 상태 코드 · 멱등키(journey-activate:${journeyId})를 그대로 옮겼다.
 *    라우트는 결과 코드를 옛 응답으로 되돌려 매핑만 한다(routes/ai.ts).
 * ⛔ 묶음은 시작 전에 최초 활성화 합계(초안 수 × 단가)를 한 번 확인한다 — 중간에 잔액이 떨어져 반쯤 켜지는 일을 줄인다.
 *    그래도 중간 실패가 나면 이미 켜진 것은 그대로 두고 카드별 결과를 돌려준다(되돌리지 않는다 · 켜짐은 사용자가 확인한 동작).
 */
import { query } from '../config/database';
import { checkCredit, deductCreditOutcome, InsufficientCreditError, type DeductOutcome } from './ai-credit';
import { getCreditCost } from './ai-credit-calc';
import { selectJourneyTargetCustomerIds, JOURNEY_COUNT_CAP } from './journey-target-extractor';
import { getJourneyOwnerScopeSql } from './store-scope';
import { journeyOwnerConsent } from './mall-consent';
import { filterByIndividualCallback } from './callback-filter';
import { activateJourney } from './journey-builder';
import { dispatchOneShotJourney } from './journey-anchor-scheduler';
import { nextTriggerEvents } from './journey-trigger-capability';
import { buildLifecycleMap } from './journey-lifecycle-map';
import { lineageColumnsReady, pausedClosedSiblings } from './journey-lineage';
import { chargesFirstActivation } from './journey-activation-cost';   // ★ V.3 §5-1 처음 켜기 200 = 계보당 1번(판정 한 곳)

export type GuardedActivation =
  | { ok: true; firstActivation: boolean; charged: number }
  | { ok: false; code: 'NOT_FOUND' | 'DB_MIGRATION_PENDING' | 'PRETEST_REQUIRED' | 'INSUFFICIENT_CREDIT' | 'ACTIVATE_FAILED' | 'CREDIT_SETTLE_FAILED'; message: string }
  | { ok: false; code: 'CALLBACK_CONFIRM_REQUIRED'; message: string; callbackUnregisteredCount: number; unregisteredDetails: unknown };

/**
 * 여정 하나 켜기(게이트 전부). 옛 라우트 본문과 같은 순서:
 *   ①상태 · 검증 마커 조회(컬럼 없음 = 마이그레이션 필요) ②검증 마커 없음 = 거부 ③매장번호 모드 미등록 회신 확인
 *   ④최초 활성화면 크레딧 확인 ⑤activateJourney ⑥최초면 차감(멱등키 고정) ⑦1회 발송 첫 적재(최초만 · 실패 격리)
 * ★ 2026-10-25 성공 뒤 차감 한 규칙(원장 docs/2026-10-25-oneline-all-structure-check.md §8-2 D1 A) — 차감이 동시 소진(잔액 부족) ·
 *   원장 쓰기 실패로 끝나면 방금 켠 첫 켜기를 초안으로 되돌리고 거절한다(옛: 켜진 채 0크레딧). 1회 발송 적재는 차감이 끝난 **뒤**로 옮겼다
 *   (되돌린 여정의 발송이 이미 줄에 서지 않게). 실패한 시도는 원장에 행이 없어 다음 켜기가 같은 키로 정상 차감한다.
 */
export async function activateJourneyGuarded(
  companyId: string,
  journeyId: string,
  userId: string,
  opts: { confirmCallbackExclusion?: boolean; requireActiveSource?: string } = {},
): Promise<GuardedActivation> {
  let stRow;
  try {
    const lineageReady = await lineageColumnsReady();
    stRow = await query(
      `SELECT status, last_pretest_passed_at, start_kind, callback_mode, trigger_event, trigger_filters${lineageReady ? ', lineage_id' : ''} FROM journeys WHERE id = $1::uuid AND company_id = $2::uuid`,
      [journeyId, companyId]
    );
  } catch (colErr: any) {
    const cm = colErr?.message || '';
    if (cm.includes('column') && cm.includes('does not exist')) {
      return { ok: false, code: 'DB_MIGRATION_PENDING', message: 'DB 마이그레이션 필요: 운영자에게 journeys.last_pretest_passed_at ALTER 실행 요청 의무' };
    }
    throw colErr;
  }
  if (stRow.rows.length === 0) return { ok: false, code: 'NOT_FOUND', message: '여정을 찾을 수 없습니다.' };
  const row = stRow.rows[0];
  if (!row.last_pretest_passed_at) {
    return { ok: false, code: 'PRETEST_REQUIRED', message: '발송 전 문안 검증을 먼저 통과해 주세요. 미리보기에서 검증 후 활성화할 수 있습니다.' };
  }

  if (row.callback_mode === 'store' && row.trigger_event && !opts.confirmCallbackExclusion) {
    try {
      const cbIds = await selectJourneyTargetCustomerIds(companyId, row.trigger_event, row.trigger_filters || {}, JOURNEY_COUNT_CAP, undefined, undefined, await getJourneyOwnerScopeSql(companyId, journeyId), await journeyOwnerConsent(companyId, journeyId));
      if (cbIds.length > 0) {
        const cbCust = await query(
          `SELECT store_phone, callback, custom_fields FROM customers WHERE company_id = $1::uuid AND id = ANY($2::uuid[])`,
          [companyId, cbIds]
        );
        const cbResult = await filterByIndividualCallback(cbCust.rows, companyId, userId, 'store_phone');
        if (cbResult.callbackUnregisteredCount > 0) {
          return {
            ok: false,
            code: 'CALLBACK_CONFIRM_REQUIRED',
            callbackUnregisteredCount: cbResult.callbackUnregisteredCount,
            unregisteredDetails: cbResult.unregisteredDetails,
            message: `매장번호가 등록 발신번호가 아닌 고객 ${cbResult.callbackUnregisteredCount}명은 발송이 자동 실패 처리됩니다. 계속 활성화할까요?`,
          };
        }
      }
    } catch (cbErr: any) {
      console.warn('[Journeys activate] 미등록 회신번호 pre-flight 검증 실패(무시):', cbErr?.message);
    }
  }

  // 판의 첫 켜기(one_shot 첫 적재 · 응답) 와 과금(계보당 1번)은 다른 질문이다 — 한 값으로 겸하지 않는다(LESSONS_BACKEND:14).
  const firstActivation = row.status === 'draft';
  const charge = chargesFirstActivation({ id: journeyId, status: String(row.status), lineage_id: row.lineage_id });
  if (charge) {
    try {
      await checkCredit(companyId, getCreditCost('journey-activate'));
    } catch (e) {
      if (e instanceof InsufficientCreditError) {
        return { ok: false, code: 'INSUFFICIENT_CREDIT', message: '여정 저장에 필요한 크레딧이 부족합니다. 크레딧을 충전해 주세요.' };
      }
      throw e;
    }
  }

  const result = await activateJourney(companyId, journeyId, userId, { requireActiveSource: opts.requireActiveSource });
  if (!result.ok) return { ok: false, code: 'ACTIVATE_FAILED', message: result.reason || '활성화 실패' };

  // ★ V.3 Codex 적대 A8 — charged = 실제로 받은 크레딧(차감 결말 그대로). 크레딧제 미적용 = 0(화면이 받지 않은 금액을 말하지 않게).
  let charged = 0;
  if (charge) {
    let outcome: DeductOutcome = 'failed';
    let insufficient = false;
    try {
      outcome = await deductCreditOutcome({
        companyId,
        cost: getCreditCost('journey-activate'),
        source: 'journey-activate',
        createdBy: userId,
        idempotencyKey: `journey-activate:${journeyId}`,
        throwOnInsufficient: true,
      });
    } catch (e) {
      if (!(e instanceof InsufficientCreditError)) throw e;
      insufficient = true;
    }
    if (insufficient || outcome === 'failed') {
      await revertFirstActivation(companyId, journeyId);
      return insufficient
        ? { ok: false, code: 'INSUFFICIENT_CREDIT', message: '여정 저장에 필요한 크레딧이 부족합니다. 크레딧을 충전해 주세요.' }
        : { ok: false, code: 'CREDIT_SETTLE_FAILED', message: '크레딧 기록을 확인하지 못해 켜지 않았어요. 잠시 후 다시 시도해 주세요.' };
    }
    charged = outcome === 'deducted' || outcome === 'duplicate' ? getCreditCost('journey-activate') : 0;
  }

  if (firstActivation && String(row.start_kind) === 'one_shot') {
    try {
      const dr = await dispatchOneShotJourney(companyId, journeyId);
      console.log(`[Journeys activate] one_shot dispatch journey=${journeyId} enqueued=${dr.enqueued} reason=${dr.reason || ''}`);
    } catch (dispErr: any) {
      console.error('[Journeys activate] one_shot dispatch 실패:', dispErr?.message);
    }
  }
  return { ok: true, firstActivation, charged };
}

/**
 * ★ 2026-10-25 첫 켜기 되돌리기(차감을 걷지 못함 · 위 규칙) — 계보 첫 켜기(초안 → 켜짐)만 여기 온다.
 *   켜기가 바꾼 칸(상태 · 승인 · 「앞 여정을 마치면」 기준 시각)을 초안 때로 돌린다. 그 사이 다른 전이가 있었으면(active 아님) 건드리지 않는다.
 */
async function revertFirstActivation(companyId: string, journeyId: string): Promise<void> {
  try {
    await query(
      `UPDATE journeys SET status = 'draft', approved_by = NULL, approved_at = NULL,
              last_event_cursor = CASE WHEN trigger_event = 'journey.after' THEN NULL ELSE last_event_cursor END,
              updated_at = NOW()
        WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'active'`,
      [journeyId, companyId],
    );
  } catch (err: any) {
    console.error(`[Journeys activate] 첫 켜기 되돌리기 실패 — 무과금 켜짐(수동 확인) journey=${journeyId}:`, err?.message || err);
    void import('./system-alert').then(({ sendSystemAlert }) => sendSystemAlert({
      dedupKey: `journey-activate-revert:${journeyId}`,
      title: '여정 켜기 크레딧을 걷지 못했는데 켜기를 되돌리지 못했습니다.',
      details: ['상태: 돈을 받지 않은 여정이 켜져 있음'],
      action: '슈퍼관리자에서 그 회사의 여정 상태를 확인해 주세요.',
    })).catch(() => undefined);
  }
}

/**
 * ★ 2026-10-20 여정 V.3 §6-4 — 켤 여정이 낀 겹침 쌍 중 아직 고르지 않은 것(정렬한 「a|b」).
 *   판정 = 지도와 같은 겹침(buildLifecycleMap · computeOverlapPairs) · 고른 쌍 = 여정에 저장된 것(trigger_filters.overlap_ack) + 이번 요청.
 *   옛: 묶음 켜기만 확인하고 고른 쌍을 저장하지 않아 ①하나씩 켜기(지도 · 목록)는 겹침 확인 없이 켜졌고 ②다시 켤 때마다 또 물었다.
 */
export async function unresolvedOverlapPairs(companyId: string, journeyIds: string[], requestAcks: string[]): Promise<string[]> {
  const ids = new Set(journeyIds.map(String));
  if (ids.size === 0) return [];
  const map = await buildLifecycleMap(companyId);
  const stored = await query(
    `SELECT id, trigger_filters->'overlap_ack' AS ack FROM journeys WHERE company_id = $1::uuid AND id = ANY($2::uuid[])`,
    [companyId, [...ids]],
  );
  const ack = new Set<string>((requestAcks || []).map(String));
  for (const r of stored.rows as any[]) if (Array.isArray(r.ack)) for (const k of r.ack) ack.add(String(k));
  const out = new Set<string>();
  for (const o of map.overlaps) {
    if (!ids.has(o.a) && !ids.has(o.b)) continue;
    const k = [o.a, o.b].sort().join('|');
    if (!ack.has(k)) out.add(k);
  }
  return [...out];
}

/** ★ V.3 §6-4 — 켜기에 성공한 여정에 고른 쌍을 저장(그 여정이 낀 쌍만 · 기존과 합침 · 판 = updated_at 은 올리지 않는다 · 사전검사 판 유지). */
export async function persistOverlapAcks(companyId: string, journeyIds: string[], acks: string[]): Promise<void> {
  for (const id of journeyIds.map(String)) {
    const mine = (acks || []).map(String).filter((k) => k.split('|').includes(id));
    if (mine.length === 0) continue;
    const cur = await query(`SELECT trigger_filters->'overlap_ack' AS ack FROM journeys WHERE id = $1::uuid AND company_id = $2::uuid`, [id, companyId]);
    const before: string[] = Array.isArray(cur.rows[0]?.ack) ? cur.rows[0].ack.map(String) : [];
    const merged = [...new Set([...before, ...mine])].sort().slice(0, 50);
    await query(
      `UPDATE journeys SET trigger_filters = COALESCE(trigger_filters, '{}'::jsonb) || jsonb_build_object('overlap_ack', $3::jsonb)
        WHERE id = $1::uuid AND company_id = $2::uuid`,
      [id, companyId, JSON.stringify(merged)],
    );
  }
}

/** ★ V.3 §6-5 — 지금 판을 다시 켜면 같은 계보의 멈춘 옛 판(진입 닫힘 · 진행 중 고객 마무리분)도 같은 관문으로 다시 켠다. */
export async function resumeLineageSiblings(companyId: string, journeyId: string, userId: string): Promise<{ resumed: string[]; failed: Array<{ id: string; message: string }> }> {
  const resumed: string[] = [];
  const failed: Array<{ id: string; message: string }> = [];
  for (const id of await pausedClosedSiblings(companyId, journeyId)) {
    try {
      const r = await activateJourneyGuarded(companyId, id, userId, { confirmCallbackExclusion: true });
      if (r.ok) resumed.push(id);
      else failed.push({ id, message: r.message });
    } catch (e: any) {
      failed.push({ id, message: e?.message || '다시 켜지 못했어요' });
    }
  }
  return { resumed, failed };
}

/** 묶음 켜기 한 번에 받는 여정 수 상한(문장으로 만들기 = 최대 4 · 여유 포함). */
export const MAX_BATCH_ACTIVATION = 10;

/**
 * 받는 여정 먼저 — 묶음 안에서 A 의 다음 사건(계약 간선)이 B 의 시작 사건이면 B 를 A 보다 먼저 켠다.
 * 같은 단계끼리는 받은 순서를 지킨다. 순환이면 남은 순서 그대로(계약 간선에는 순환이 없다 · parity 테스트).
 */
export function orderReceiversFirst<T extends { id: string; triggerEvent: string }>(items: T[]): T[] {
  const remaining = [...items];
  const out: T[] = [];
  while (remaining.length > 0) {
    const ready = remaining.filter((a) => {
      const next = nextTriggerEvents(a.triggerEvent);
      return !remaining.some((b) => b.id !== a.id && next.includes(b.triggerEvent));
    });
    const pick = ready.length > 0 ? ready : [...remaining];
    for (const p of pick) {
      out.push(p);
      remaining.splice(remaining.indexOf(p), 1);
    }
  }
  return out;
}

export interface BatchActivationItem {
  journeyId: string;
  name: string;
  result: GuardedActivation | { ok: false; code: 'NOT_ALLOWED'; message: string };
}

export type BatchActivation =
  | { ok: true; items: BatchActivationItem[] }
  | { ok: false; code: 'INSUFFICIENT_CREDIT'; message: string; needed: number }
  | { ok: false; code: 'OVERLAP_UNRESOLVED'; message: string; pairs: string[] };

/**
 * 모두 켜기 — 받는 여정 먼저 · 시작 전 최초 활성화 합계 잔액 확인 · 여정마다 activateJourneyGuarded(게이트 전부).
 * 초안 · 멈춤만 켠다(켜짐 · 끝남 · 보관 = NOT_ALLOWED). 회사 밖 id 는 NOT_FOUND(존재를 알리지 않는다).
 */
export async function activateJourneysInOrder(
  companyId: string,
  userId: string,
  journeyIds: string[],
  opts: { confirmCallbackExclusionIds?: string[]; acknowledgedOverlaps?: string[] } = {},
): Promise<BatchActivation> {
  const ids = [...new Set(journeyIds.map(String))].slice(0, MAX_BATCH_ACTIVATION);
  const lineageReady = await lineageColumnsReady();
  const r = await query(
    `SELECT id, name, status, trigger_event${lineageReady ? ', lineage_id' : ''} FROM journeys
      WHERE company_id = $1::uuid AND id = ANY($2::uuid[]) AND archived_at IS NULL`,
    [companyId, ids],
  );
  const rows = r.rows.map((x: any) => ({ id: String(x.id), name: String(x.name || ''), status: String(x.status), triggerEvent: String(x.trigger_event || ''), lineageId: x.lineage_id ? String(x.lineage_id) : null }));
  const found = new Set(rows.map((x) => x.id));
  const items: BatchActivationItem[] = ids
    .filter((id) => !found.has(id))
    .map((id) => ({ journeyId: id, name: '', result: { ok: false, code: 'NOT_FOUND', message: '여정을 찾을 수 없습니다.' } }));

  // ★ 2026-10-19 B-1009-5 — 겹침 해소 「필수」를 서버가 본다(옛: 모두 켜기 창만 강제 · API 직접 호출 · 시드는 해소 없이 켜졌다).
  //   판정 = 지도와 같은 겹침 쌍(buildLifecycleMap) · 켤 여정이 낀 쌍마다 화면이 고른 쌍 키(정렬한 「a|b」)가 있어야 한다.
  //   「첫 구매 고객 빼기」로 해소한 쌍은 지도에서 이미 빠진다. 켤 것이 하나도 없으면 보지 않는다.
  //   ★ 2026-10-20 V.3 §6-4 — 판정 한 곳(unresolvedOverlapPairs · 저장된 고른 쌍 포함) · 켠 뒤 고른 쌍 저장.
  const toActivate = new Set(rows.filter((x) => x.status === 'draft' || x.status === 'paused').map((x) => x.id));
  if (toActivate.size > 0) {
    const pairs = await unresolvedOverlapPairs(companyId, [...toActivate], opts.acknowledgedOverlaps || []);
    if (pairs.length > 0) {
      return { ok: false, code: 'OVERLAP_UNRESOLVED', message: `함께 시작되는 여정 ${pairs.length}쌍을 어떻게 할지 골라 주세요.`, pairs };
    }
  }

  // ★ V.3 §5-1 — 합계도 단건과 같은 판정(새 판 초안 = 0).
  const drafts = rows.filter((x) => chargesFirstActivation({ id: x.id, status: x.status, lineage_id: x.lineageId })).length;
  const needed = drafts * getCreditCost('journey-activate');
  if (needed > 0) {
    try {
      await checkCredit(companyId, needed);
    } catch (e) {
      if (e instanceof InsufficientCreditError) {
        return { ok: false, code: 'INSUFFICIENT_CREDIT', message: `여정 ${drafts}개를 처음 켜는 데 ${needed} 크레딧이 필요합니다. 크레딧을 충전해 주세요.`, needed };
      }
      throw e;
    }
  }

  const confirmSet = new Set((opts.confirmCallbackExclusionIds || []).map(String));
  for (const j of orderReceiversFirst(rows)) {
    if (j.status !== 'draft' && j.status !== 'paused') {
      items.push({ journeyId: j.id, name: j.name, result: { ok: false, code: 'NOT_ALLOWED', message: j.status === 'active' ? '이미 켜져 있어요.' : '끝난 여정은 켤 수 없어요.' } });
      continue;
    }
    try {
      const result = await activateJourneyGuarded(companyId, j.id, userId, { confirmCallbackExclusion: confirmSet.has(j.id) });
      items.push({ journeyId: j.id, name: j.name, result });
      if (result.ok) {
        await persistOverlapAcks(companyId, [j.id], opts.acknowledgedOverlaps || []).catch((e: any) => console.warn('[Journeys activate-batch] 고른 겹침 저장 실패(켜기는 유지):', j.id, e?.message));
        if (j.status === 'paused') await resumeLineageSiblings(companyId, j.id, userId).catch((e: any) => console.warn('[Journeys activate-batch] 옛 판 다시 켜기 실패:', j.id, e?.message));
      }
    } catch (err: any) {
      console.error('[Journeys activate-batch] 여정 켜기 오류:', j.id, err?.message);
      items.push({ journeyId: j.id, name: j.name, result: { ok: false, code: 'ACTIVATE_FAILED', message: '켜는 중 오류가 났어요. 잠시 뒤 다시 시도해 주세요.' } });
    }
  }
  return { ok: true, items };
}
