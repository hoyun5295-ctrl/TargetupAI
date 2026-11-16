/**
 * journey-pretest-mark.ts — 발송 전 문안 검증 + 통과 표식 CT(★ 2026-11-15 C134 S3 · 설계서 docs/2026-11-14-journey-step-campaign-owner-design.md §12-3)
 *
 * 왜 있나
 *   「검사 시작 판 잡기 → 검증 → 같은 판일 때만 통과 표식」 세 줄이 두 곳(켜기 전 점검 라우트 · 새 모양 reshape)에 인라인으로 있었다.
 *   합성 회사 여정 세트 워커(journey-selfcheck-set)가 세 번째 소비처라 한 곳으로 모은다(journey-reshape.ts 141 ~ 157 원문 그대로).
 *
 * 규약(옮기기 전과 같다)
 *   · 검사 **시작 시점**의 여정 판(updated_at)을 잡아 두고, 검증이 끝난 뒤 같은 판일 때만 표식을 찍는다.
 *     검증 도중 칸 · 옵션이 바뀌면(수정은 updated_at 을 올린다) 표식은 옛 판을 통과시킨 기록이 된다 → 찍지 않는다(안 켜지는 쪽).
 *   · 시각은 `::text` 원문으로 주고받는다(JS Date 왕복은 µs 를 잘라 같은 판을 다른 판으로 만든다).
 *   · 검증이 통과하지 못하면 표식 문장을 내지 않는다.
 */
import { query } from '../config/database';
import { validateJourneyForActivation, type ValidationResult, type StepSpamParams, type StepSpamTestResult } from './journey-pretest-validator';

export interface PretestMark {
  result: ValidationResult;
  /** 통과했고 검사 시작 판 그대로라 표식을 찍었다. 통과했는데 false = 검증하는 사이 여정이 바뀌었다. */
  marked: boolean;
}

export async function pretestAndMark(
  companyId: string,
  journeyId: string,
  userId: string,
  /** spam = 칸 판의 스팸 결과를 얻는 길(안 주면 검증기의 기본 = 검사를 걸고 기다림 · 실 PG 시험이 결과를 넣는 자리) */
  opts: { spam?: (p: StepSpamParams) => Promise<StepSpamTestResult | null> } = {},
): Promise<PretestMark> {
  const before = await query(`SELECT updated_at::text AS rev FROM journeys WHERE id = $1::uuid AND company_id = $2::uuid`, [journeyId, companyId]);
  const rev: string | null = before.rows[0]?.rev ?? null;
  const result = opts.spam
    ? await validateJourneyForActivation(companyId, journeyId, userId, { spam: opts.spam })
    : await validateJourneyForActivation(companyId, journeyId, userId);
  if (!result.ok) return { result, marked: false };
  const mark = await query(
    `UPDATE journeys SET last_pretest_passed_at = NOW()
      WHERE id = $1::uuid AND company_id = $2::uuid AND updated_at IS NOT DISTINCT FROM $3::timestamptz
      RETURNING id`,
    [journeyId, companyId, rev],
  );
  return { result, marked: mark.rows.length > 0 };
}
