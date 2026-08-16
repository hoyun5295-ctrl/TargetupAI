/**
 * CT: 마케팅 진단 데이터 접근 공용부 (2026-08-16 신설 — 설계서 §4-3·§4-4 공유)
 *
 * 인증 라우트(marketing-diagnosis.ts)와 공개 라우트(marketing-diagnosis-public.ts)가 같은
 * 활성 문항 세트·plans 로드를 쓴다 — 라우트마다 인라인로 두 벌 만들지 않는다(no_inline_duplication).
 */
import { Response } from 'express';
import { query } from '../config/database';
import { validateDefinition, type DiagnosisDefinition } from './plan-recommend';

/** 추천 CT 입력용 plans 로드 — op 표 전 축 컬럼(§4-5. 전부 2026-08-16 실측 실존 컬럼). */
export const DIAGNOSIS_PLAN_ROWS_SQL = `
  SELECT id, plan_code, plan_name, monthly_price, is_active,
         ai_credits_per_month, max_auto_campaigns, cdp_events_per_month, max_customers,
         customer_db_enabled, auto_campaign_enabled, mobile_dm_enabled, cdp_enabled
    FROM plans`;

/** 활성 definition이 구조 검증을 통과하지 못했다 — 호출부는 503으로 변환한다(fail-closed). */
export class DiagnosisDefinitionInvalidError extends Error {
  constructor(public readonly errors: string[]) {
    super(`활성 진단 definition 검증 실패: ${errors.join(' / ')}`);
    this.name = 'DiagnosisDefinitionInvalidError';
  }
}

/**
 * 활성 문항 세트(정확히 1개 — uq_dqs_active). 0개 = null(호출부가 503 원칙 10).
 * ★Codex 적대 수용 — 검증을 이 로더에 집중한다: DB JSON을 그대로 믿으면 seed 드리프트
 * (미등록 컬럼·비허용 op·행 version 불일치)가 공개 경로에서 500이나 오추천으로 샌다.
 * 위반 = DiagnosisDefinitionInvalidError → 전 소비 라우트가 503으로 변환(fail-closed).
 */
export async function loadActiveQuestionSet(): Promise<{ version: string; definition: DiagnosisDefinition } | null> {
  const r = await query(
    `SELECT version, definition FROM diagnosis_question_sets WHERE is_active = true LIMIT 1`,
  );
  if (r.rows.length === 0) return null;
  const version = String(r.rows[0].version);
  const definition = r.rows[0].definition as DiagnosisDefinition;
  const check = validateDefinition(definition);
  if (!check.ok) throw new DiagnosisDefinitionInvalidError(check.errors);
  if (definition.version !== version) {
    throw new DiagnosisDefinitionInvalidError([`행 version(${version})과 definition.version(${definition.version}) 불일치`]);
  }
  return { version, definition };
}

/** 로더 검증 실패를 503으로 변환 — 전 소비 라우트 공용(처리했으면 true). */
export function handleDefinitionInvalid(err: unknown, res: Response): boolean {
  if (err instanceof DiagnosisDefinitionInvalidError) {
    console.error('[marketing-diagnosis] 활성 definition 검증 실패:', err.errors.join(' / '));
    res.status(503).json({ success: false, code: 'DB_MIGRATION_PENDING', error: '진단 문항 구성 점검이 필요합니다.' });
    return true;
  }
  return false;
}
