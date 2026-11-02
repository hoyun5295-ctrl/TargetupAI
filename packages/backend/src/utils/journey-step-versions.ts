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

/**
 * ★ 2026-11-02 그 칸의 최신 판(스냅샷) 서브쿼리 — 판 읽기 한 곳(설계서 docs/2026-11-02-journey-automarketing-core-fix-design.md 3-0 CT-J1).
 *   최신 = 그 (여정 · 칸)의 created_at 가장 늦은 행 · 실행기 · 검사 스캔 · 보낼 판 판정 · 상황판 · 정지 화면 · 후보가 모두 이것을 부른다.
 *   신뢰도는 `confidence` 별칭으로 준다(칸 이름은 판 쓰기 · 판정 파일 밖에 쓰지 않는다).
 *   쓰는 꼴: `FROM ${latestSnapshotSql(...)} snap` · `LEFT JOIN LATERAL ${latestSnapshotSql(...)} snap ON TRUE` · `(SELECT x.id FROM ${latestSnapshotSql(...)} x)`.
 */
export function latestSnapshotSql(journeyExpr: string, stepExpr: string): string {
  return `(SELECT ss_l.id, ss_l.confidence_score AS confidence, ss_l.created_at, ss_l.message_body, ss_l.message_subject, ss_l.channel
      FROM journey_step_snapshots ss_l WHERE ss_l.step_id = ${stepExpr} AND ss_l.journey_id = ${journeyExpr}
     ORDER BY ss_l.created_at DESC LIMIT 1)`;
}

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

export interface StepVariantRow { id: string; variant_id: string; message_template: string | null; subject: string | null }

/**
 * ★ 2026-11-02 설계서 3-16 · D14 — 칸마다 변이 행(여러 칸 한 번 · 상세 화면 · 켜진 여정 칸 고치기 판정이 읽는다).
 *   run = 잠금을 쥔 트랜잭션에서 부를 때 그 연결(고치기 판정 = 여정 행 잠금 안).
 */
export async function loadVariantRowsByStep(
  stepIds: string[],
  run: (sql: string, params?: any[]) => Promise<{ rows: any[] }> = query,
): Promise<Map<string, StepVariantRow[]>> {
  const out = new Map<string, StepVariantRow[]>();
  if (stepIds.length === 0) return out;
  const r = await run(
    `SELECT id, step_id, variant_id, message_template, subject FROM journey_step_variants WHERE step_id = ANY($1::uuid[]) ORDER BY step_id, variant_id`,
    [stepIds],
  );
  for (const x of r.rows as any[]) {
    const k = String(x.step_id);
    if (!out.has(k)) out.set(k, []);
    out.get(k)!.push({ id: String(x.id), variant_id: String(x.variant_id ?? ''), message_template: x.message_template ?? null, subject: x.subject ?? null });
  }
  return out;
}

/** 그 칸의 변이(검사 · 재검사가 읽는다 · 실행기는 고르기용 목록을 bandit-optimizer 에서 따로 읽는다). */
export async function loadStepVariantRows(stepId: string): Promise<Array<{ id: string; message_template: string | null; subject: string | null }>> {
  return (await loadVariantRowsByStep([stepId])).get(stepId) ?? [];
}
