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
import { checkCredit, deductCreditSafe, InsufficientCreditError } from './ai-credit';
import { getCreditCost } from './ai-credit-calc';
import { selectJourneyTargetCustomerIds, JOURNEY_COUNT_CAP } from './journey-target-extractor';
import { getJourneyOwnerScopeSql } from './store-scope';
import { filterByIndividualCallback } from './callback-filter';
import { activateJourney } from './journey-builder';
import { dispatchOneShotJourney } from './journey-anchor-scheduler';
import { nextTriggerEvents } from './journey-trigger-capability';

export type GuardedActivation =
  | { ok: true; firstActivation: boolean }
  | { ok: false; code: 'NOT_FOUND' | 'DB_MIGRATION_PENDING' | 'PRETEST_REQUIRED' | 'INSUFFICIENT_CREDIT' | 'ACTIVATE_FAILED'; message: string }
  | { ok: false; code: 'CALLBACK_CONFIRM_REQUIRED'; message: string; callbackUnregisteredCount: number; unregisteredDetails: unknown };

/**
 * 여정 하나 켜기(게이트 전부). 옛 라우트 본문과 같은 순서:
 *   ①상태 · 검증 마커 조회(컬럼 없음 = 마이그레이션 필요) ②검증 마커 없음 = 거부 ③매장번호 모드 미등록 회신 확인
 *   ④최초 활성화면 크레딧 확인 ⑤activateJourney ⑥1회 발송 첫 적재(최초만 · 실패 격리) ⑦최초면 차감(멱등키 고정)
 */
export async function activateJourneyGuarded(
  companyId: string,
  journeyId: string,
  userId: string,
  opts: { confirmCallbackExclusion?: boolean } = {},
): Promise<GuardedActivation> {
  let stRow;
  try {
    stRow = await query(
      `SELECT status, last_pretest_passed_at, start_kind, callback_mode, trigger_event, trigger_filters FROM journeys WHERE id = $1::uuid AND company_id = $2::uuid`,
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
      const cbIds = await selectJourneyTargetCustomerIds(companyId, row.trigger_event, row.trigger_filters || {}, JOURNEY_COUNT_CAP, undefined, undefined, await getJourneyOwnerScopeSql(companyId, journeyId));
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

  const firstActivation = row.status === 'draft';
  if (firstActivation) {
    try {
      await checkCredit(companyId, getCreditCost('journey-activate'));
    } catch (e) {
      if (e instanceof InsufficientCreditError) {
        return { ok: false, code: 'INSUFFICIENT_CREDIT', message: '여정 저장에 필요한 크레딧이 부족합니다. 크레딧을 충전해 주세요.' };
      }
      throw e;
    }
  }

  const result = await activateJourney(companyId, journeyId, userId);
  if (!result.ok) return { ok: false, code: 'ACTIVATE_FAILED', message: result.reason || '활성화 실패' };

  if (firstActivation && String(row.start_kind) === 'one_shot') {
    try {
      const dr = await dispatchOneShotJourney(companyId, journeyId);
      console.log(`[Journeys activate] one_shot dispatch journey=${journeyId} enqueued=${dr.enqueued} reason=${dr.reason || ''}`);
    } catch (dispErr: any) {
      console.error('[Journeys activate] one_shot dispatch 실패:', dispErr?.message);
    }
  }

  if (firstActivation) {
    await deductCreditSafe({
      companyId,
      cost: getCreditCost('journey-activate'),
      source: 'journey-activate',
      createdBy: userId,
      idempotencyKey: `journey-activate:${journeyId}`,
    });
  }
  return { ok: true, firstActivation };
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
  | { ok: false; code: 'INSUFFICIENT_CREDIT'; message: string; needed: number };

/**
 * 모두 켜기 — 받는 여정 먼저 · 시작 전 최초 활성화 합계 잔액 확인 · 여정마다 activateJourneyGuarded(게이트 전부).
 * 초안 · 멈춤만 켠다(켜짐 · 끝남 · 보관 = NOT_ALLOWED). 회사 밖 id 는 NOT_FOUND(존재를 알리지 않는다).
 */
export async function activateJourneysInOrder(
  companyId: string,
  userId: string,
  journeyIds: string[],
  opts: { confirmCallbackExclusionIds?: string[] } = {},
): Promise<BatchActivation> {
  const ids = [...new Set(journeyIds.map(String))].slice(0, MAX_BATCH_ACTIVATION);
  const r = await query(
    `SELECT id, name, status, trigger_event FROM journeys
      WHERE company_id = $1::uuid AND id = ANY($2::uuid[]) AND archived_at IS NULL`,
    [companyId, ids],
  );
  const rows = r.rows.map((x: any) => ({ id: String(x.id), name: String(x.name || ''), status: String(x.status), triggerEvent: String(x.trigger_event || '') }));
  const found = new Set(rows.map((x) => x.id));
  const items: BatchActivationItem[] = ids
    .filter((id) => !found.has(id))
    .map((id) => ({ journeyId: id, name: '', result: { ok: false, code: 'NOT_FOUND', message: '여정을 찾을 수 없습니다.' } }));

  const drafts = rows.filter((x) => x.status === 'draft').length;
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
    } catch (err: any) {
      console.error('[Journeys activate-batch] 여정 켜기 오류:', j.id, err?.message);
      items.push({ journeyId: j.id, name: j.name, result: { ok: false, code: 'ACTIVATE_FAILED', message: '켜는 중 오류가 났어요. 잠시 뒤 다시 시도해 주세요.' } });
    }
  }
  return { ok: true, items };
}
