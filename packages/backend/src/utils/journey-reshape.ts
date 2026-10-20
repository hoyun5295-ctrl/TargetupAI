/**
 * journey-reshape.ts — 켜진 여정의 「새 모양」 한 흐름(★ 2026-10-20 여정 V.3 묶음 2 · 설계서 §4-2)
 *
 * 왜 있나
 *   진행 위치가 칸 순서 번호이고(실행기 current_step_order + 1) 이미 보냄 판정이 (실행, 칸 id) 짝이라,
 *   진행 중 고객이 있는 켜진 여정의 칸 모양(채널 · 광고 · 칸 추가 · 삭제 · 이미지 · 알림톡) · 목표 끄기 · 회신번호를 그 자리에서 바꾸면
 *   진행 중 고객의 다음 문자가 바뀐다. 그래서 새로 들어오는 고객부터 바뀐 모양으로 받게 한다(옛 판은 진행 중 고객만 마무리).
 *   옛 [새 판으로 고치기]는 초안만 만들고 끝나 사용자가 검사 · 켜기를 따로 해야 했고 그사이 초안이 남았다(V.3 회의론자 최종 검증).
 *
 * 흐름 = 복제(createNewVersion · 이름 그대로 · 변형 복사) → 바꾼 내용 적용(초안이라 모든 묶음 허용 · 같은 저장 함수) →
 *        사전검사(validateJourneyForActivation · 검사 시작 판 CAS 로 표식) → 켜기(activateJourneyGuarded · 계보당 200 한 번이라 0) .
 *   어디서든 실패하면 복제본을 지운다(숨은 초안 0). 진행 중 고객은 옮기지 않는다.
 *
 * 하지 않는 것: 한 번 보내기 여정(첫 발송 멱등이 여정 id 단위 · 새 판이면 전원에게 다시 보낸다) · 멈춘 여정(진행 중 고객이 멈춘 채 옛 판에 남는다 →
 *   다시 켠 뒤 고친다) · 날짜 기준 여정에서 오늘 이미 보낸 회차가 있을 때(중복 표식이 발송일 단위 · 같은 날 새 판이 같은 회차를 또 보낸다).
 */
import { query } from '../config/database';
import { createNewVersion } from './journey-lineage';
import { updateJourneyStep, addJourneyStep, deleteJourneyStep, deleteJourney, updateJourneyCallback, type JourneyStepDefinition } from './journey-builder';
import { validateJourneyForActivation, type ValidationResult } from './journey-pretest-validator';
import { activateJourneyGuarded } from './journey-activation';
import { normalizeJourneyOptions } from './journey-options-validator';
import { PRODUCT_TRIGGER_EVENT } from './journey-product';

export interface ReshapeChange {
  /** 원본과 같은 순번의 칸에 줄 수정(updateJourneyStep 과 같은 키). */
  stepPatches?: Array<{ order: number; patch: Record<string, unknown> }>;
  /** 지울 칸 순번(원본 기준) — 뒤 순번부터 지운다(앞 칸 순번이 밀리지 않게). */
  deleteOrders?: number[];
  /** 맨 뒤에 더할 칸. */
  addSteps?: Array<Omit<JourneyStepDefinition, 'stepOrder'>>;
  /** 여정 단위 새 모양 옵션(목표 종료 · 목표 종류 · 회신번호 · 회신 모드). */
  options?: { goalExitEnabled?: boolean; goalKind?: string; callbackNumber?: string; callbackMode?: string };
  confirmCallbackExclusion?: boolean;
}

export type ReshapeResult =
  | { ok: true; journeyId: string }
  | { ok: false; code: 'NOT_FOUND' | 'NOT_ALLOWED' | 'NO_CHANGE' | 'DRAFT_EXISTS' | 'SAME_DAY_ANCHOR' | 'ACTIVATE_FAILED'; message: string; draftId?: string }
  | { ok: false; code: 'PRETEST_FAILED'; message: string; result: ValidationResult }
  | { ok: false; code: 'CALLBACK_CONFIRM_REQUIRED'; message: string; callbackUnregisteredCount: number; unregisteredDetails: unknown };

export class ReshapeInputError extends Error {}

function hasChange(c: ReshapeChange): boolean {
  return (c.stepPatches || []).length > 0 || (c.deleteOrders || []).length > 0 || (c.addSteps || []).length > 0
    || (!!c.options && Object.keys(c.options).length > 0);
}

/** 초안(복제본)에 여정 단위 옵션을 적용 — 값 정규화는 옵션 주소와 같은 함수. */
async function applyReshapeOptions(companyId: string, draftId: string, triggerEvent: string, opts: NonNullable<ReshapeChange['options']>): Promise<void> {
  const norm = normalizeJourneyOptions(opts as Record<string, any>);
  if ('goalKind' in opts && String(norm.options.goalKind) === 'product' && triggerEvent !== PRODUCT_TRIGGER_EVENT) {
    throw new ReshapeInputError('같은 상품 재구매 목표는 상품 재구매 여정에서만 쓸 수 있어요.');
  }
  const sets: string[] = [];
  const params: any[] = [draftId, companyId];
  const add = (col: string, val: any) => { params.push(val); sets.push(`${col} = $${params.length}`); };
  if ('goalExitEnabled' in opts) add('goal_exit_enabled', norm.options.goalExitEnabled);
  if ('goalKind' in opts) add('goal_kind', norm.options.goalKind);
  if ('callbackMode' in opts) add('callback_mode', norm.options.callbackMode);
  if (sets.length > 0) {
    await query(
      `UPDATE journeys SET ${sets.join(', ')}, last_pretest_passed_at = NULL, updated_at = NOW()
        WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'draft'`,
      params,
    );
  }
  if ('callbackNumber' in opts && norm.options.callbackNumber) {
    const ok = await updateJourneyCallback(companyId, draftId, norm.options.callbackNumber);
    if (!ok) throw new ReshapeInputError('회신번호를 바꾸지 못했어요.');
  }
}

export async function reshapeJourney(companyId: string, journeyId: string, userId: string, change: ReshapeChange): Promise<ReshapeResult> {
  const src = await query(
    `SELECT id, status, start_kind, trigger_event FROM journeys WHERE id = $1::uuid AND company_id = $2::uuid AND archived_at IS NULL`,
    [journeyId, companyId],
  );
  if (src.rows.length === 0) return { ok: false, code: 'NOT_FOUND', message: '여정을 찾을 수 없어요.' };
  const row = src.rows[0];
  if (row.status !== 'active') {
    return {
      ok: false,
      code: 'NOT_ALLOWED',
      message: row.status === 'paused'
        ? '멈춘 여정에 진행 중인 고객이 있어요. 칸 모양은 다시 켠 뒤 바꿔 주세요(새로 들어오는 고객부터 바뀐 모양으로 받아요).'
        : '끝난 여정은 고칠 수 없어요.',
    };
  }
  if (String(row.start_kind) === 'one_shot') {
    return { ok: false, code: 'NOT_ALLOWED', message: '한 번 보내기 여정은 보낸 뒤 모양을 바꿀 수 없어요. 새 여정으로 만들어 주세요.' };
  }
  if (!hasChange(change)) return { ok: false, code: 'NO_CHANGE', message: '바꿀 내용이 없어요.' };
  if (String(row.start_kind) === 'date_anchor') {
    const sent = await query(
      `SELECT 1 FROM journey_step_logs l JOIN journey_executions e ON e.id = l.execution_id
        WHERE e.journey_id = $1::uuid AND l.status = 'sent'
          AND (l.sent_at AT TIME ZONE 'Asia/Seoul')::date = (NOW() AT TIME ZONE 'Asia/Seoul')::date
        LIMIT 1`,
      [journeyId],
    );
    if (sent.rows.length > 0) {
      return { ok: false, code: 'SAME_DAY_ANCHOR', message: '오늘 이미 보낸 회차가 있어요. 같은 날 두 번 나가지 않게 내일 바꿔 주세요.' };
    }
  }

  const nv = await createNewVersion(companyId, journeyId);
  if (nv.existing) {
    return { ok: false, code: 'DRAFT_EXISTS', draftId: nv.journeyId, message: '이 여정을 고치던 초안이 남아 있어요. 그 초안을 켜거나 지운 뒤 다시 바꿔 주세요.' };
  }
  const draftId = nv.journeyId;
  const discard = async () => {
    await deleteJourney(companyId, draftId).catch((e: any) => console.error(`[reshape] 복제본 삭제 실패 draft=${draftId}:`, e?.message || e));
  };
  try {
    // 복제 직후 칸 순번 = 원본 순번(createNewVersion 이 step_order 를 그대로 복사)
    const st = await query(`SELECT id, step_order FROM journey_steps WHERE journey_id = $1::uuid ORDER BY step_order`, [draftId]);
    const idOf = new Map<number, string>(st.rows.map((r: any) => [Number(r.step_order), String(r.id)]));
    for (const p of change.stepPatches || []) {
      const sid = idOf.get(Number(p.order));
      if (!sid) throw new ReshapeInputError('고칠 칸을 찾지 못했어요. 새로고침 뒤 다시 시도해 주세요.');
      const ok = await updateJourneyStep(companyId, draftId, sid, p.patch as any);
      if (!ok) throw new ReshapeInputError('칸을 고치지 못했어요.');
    }
    for (const order of [...(change.deleteOrders || [])].map(Number).sort((a, b) => b - a)) {
      const sid = idOf.get(order);
      if (!sid) throw new ReshapeInputError('지울 칸을 찾지 못했어요. 새로고침 뒤 다시 시도해 주세요.');
      const r = await deleteJourneyStep(companyId, draftId, sid);
      if (!r) throw new ReshapeInputError('칸을 지우지 못했어요.');
    }
    for (const step of change.addSteps || []) {
      const r = await addJourneyStep(companyId, draftId, step);
      if (!r) throw new ReshapeInputError('칸을 더하지 못했어요.');
    }
    if (change.options && Object.keys(change.options).length > 0) {
      await applyReshapeOptions(companyId, draftId, String(row.trigger_event || ''), change.options);
    }

    // 사전검사 — 검사 시작 판(updated_at)을 잡아 두고 같은 판일 때만 표식(pretest-validate 주소와 같은 규약)
    const before = await query(`SELECT updated_at::text AS rev FROM journeys WHERE id = $1::uuid AND company_id = $2::uuid`, [draftId, companyId]);
    const rev: string | null = before.rows[0]?.rev ?? null;
    const v = await validateJourneyForActivation(companyId, draftId, userId);
    if (!v.ok) {
      await discard();
      return { ok: false, code: 'PRETEST_FAILED', message: '바꾼 문자가 발송 전 검사를 통과하지 못했어요. 걸린 칸을 고친 뒤 다시 저장해 주세요.', result: v };
    }
    const mark = await query(
      `UPDATE journeys SET last_pretest_passed_at = NOW()
        WHERE id = $1::uuid AND company_id = $2::uuid AND updated_at IS NOT DISTINCT FROM $3::timestamptz
        RETURNING id`,
      [draftId, companyId, rev],
    );
    if (mark.rows.length === 0) {
      await discard();
      return { ok: false, code: 'ACTIVATE_FAILED', message: '검사하는 사이에 여정이 바뀌었어요. 다시 저장해 주세요.' };
    }
    // ★ Codex 적대 A2 — 원본이 그사이 멈췄으면(사람 멈춤) 켜지 않는다(같은 계보 잠금 안에서 판정 · 멈춤도 같은 잠금).
    const a = await activateJourneyGuarded(companyId, draftId, userId, { confirmCallbackExclusion: change.confirmCallbackExclusion === true, requireActiveSource: journeyId });
    if (!a.ok) {
      await discard();
      if (a.code === 'CALLBACK_CONFIRM_REQUIRED') {
        return { ok: false, code: 'CALLBACK_CONFIRM_REQUIRED', message: a.message, callbackUnregisteredCount: a.callbackUnregisteredCount, unregisteredDetails: a.unregisteredDetails };
      }
      return { ok: false, code: 'ACTIVATE_FAILED', message: a.message };
    }
    return { ok: true, journeyId: draftId };
  } catch (e) {
    await discard();
    throw e;
  }
}
