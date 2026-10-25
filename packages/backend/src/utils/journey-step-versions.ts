/**
 * journey-step-versions.ts — 한 문자 칸이 실제로 보낼 수 있는 글 목록 한 곳
 *   (★ 2026-10-25 여정 구조체크 2차 #1 · 뿌리 대장 R5 「본 것 ≠ 나가는 것」)
 *
 * 왜 있나
 *   A/B 변이가 있는 칸을 켜기 검사는 변이 본문을 칸의 채널 · 제목으로 검사했고, 발송 2시간 전 재검사는 변이를 안 보고 칸 스냅샷만 검사했고,
 *   실행기는 변이의 본문 · 채널 · 제목으로 보냈다(세 곳이 서로 다른 글을 봤다 · 재검사가 고친 문안은 변이가 덮어 안 나갔다).
 *   → 「이 칸이 보낼 수 있는 판」을 여기 하나에서 정하고 켜기 검사 · 재검사 · 실행기가 같은 규칙을 쓴다.
 *
 * 규칙
 *   - 변이가 있으면 변이마다 한 판: 본문 = 변이 본문 · 제목 = 변이 제목(없으면 칸 제목). 채널은 늘 칸 채널(변이 = 같은 채널의 다른 글).
 *   - 변이가 없으면 칸 한 판: 본문 · 제목 = 최신 스냅샷(켠 뒤 고친 문안) · 없으면 칸.
 *   - 알림톡 칸은 변이를 만들지 않는다(승인 템플릿이 본문 · 쓰기 문 = bandit-optimizer createJourneyStepVariant).
 */
import { query } from '../config/database';

export interface StepSendVersion {
  /** journey_step_variants.id · 변이가 없으면 null */
  variantId: string | null;
  body: string;
  subject: string | null;
}

/** 변이 한 판을 칸에 덮는 규칙(순수) — 실행기 · 검사가 같은 함수. 채널 · 알림톡 값은 덮지 않는다. */
export function applyVariantToStep<T extends { message_template: string | null; subject: string | null }>(
  step: T,
  variant: { messageTemplate?: string | null; subject?: string | null },
): T {
  return {
    ...step,
    message_template: variant.messageTemplate || step.message_template,
    subject: variant.subject || step.subject,
  };
}

/** (순수) 보낼 수 있는 판 목록. */
export function stepSendVersions(
  step: { message_template: string | null; subject: string | null },
  snapshot: { message_body?: string | null; message_subject?: string | null } | null,
  variants: Array<{ id: string; message_template: string | null; subject: string | null }>,
): StepSendVersion[] {
  const base = {
    message_template: snapshot?.message_body || step.message_template,
    subject: snapshot?.message_subject || step.subject,
  };
  if (variants.length === 0) return [{ variantId: null, body: String(base.message_template || ''), subject: base.subject ?? null }];
  return variants.map((v) => {
    const merged = applyVariantToStep(base, { messageTemplate: v.message_template, subject: v.subject });
    return { variantId: v.id, body: String(merged.message_template || ''), subject: merged.subject ?? null };
  });
}

/** 그 칸의 변이(검사 · 재검사가 읽는다 · 실행기는 고르기용 목록을 bandit-optimizer 에서 따로 읽는다). */
export async function loadStepVariantRows(stepId: string): Promise<Array<{ id: string; message_template: string | null; subject: string | null }>> {
  const r = await query(
    `SELECT id, message_template, subject FROM journey_step_variants WHERE step_id = $1::uuid ORDER BY variant_id`,
    [stepId],
  );
  return r.rows.map((x: any) => ({ id: String(x.id), message_template: x.message_template ?? null, subject: x.subject ?? null }));
}
