/**
 * ★ CT-87: 카카오 템플릿 발송 가능 판정 컨트롤타워 — 2026-06-10
 *
 * 배경 (강조표기형 7300 추적 종결)
 *   IMC 템플릿에는 상태값이 두 벌 있다:
 *     - inspectionStatus(검수): REG/REQ/APR/REJ... — 한줄로가 추적해 온 값 (status 컬럼)
 *     - status(템플릿 활성): A(정상)/R(활성 대기)/S(중단)/D(삭제) — 한줄로가 저장도 가드도 안 하던 값
 *   B_IV_013_02_79738이 검수 APR인데 status R이라 카카오가 모든 발송을 7300으로 거부했고,
 *   화면은 "승인"으로 보여 며칠을 코드·에이전트에서 헤맸다. 같은 프로필의 status A 템플릿은 1800 정상.
 *
 * 역할
 *   - decideKakaoTemplateSendable: imc_template_status 기반 발송 가능 순수 판정
 *   - getImcTemplateStatusSafe: 컬럼 미마이그레이션(ALTER 전)이어도 발송이 깨지지 않는 안전 조회
 *
 * 판정 원칙
 *   - NULL(미동기)·'A' = 허용. 미지의 새 상태값도 허용(과차단으로 발송 전면 중단되는 것이 더 큰 사고).
 *   - 'R'(활성 대기)/'S'(중단)/'D'(삭제)만 명시 차단 — 카카오가 어차피 거부(7300)할 발송을 사전에 막고
 *     사용자에게 진짜 사유를 보여준다.
 */

import { query } from '../config/database';
// 순수 판정은 DB-free 코어로 분리 (config/database import가 순수 테스트를 죽이는 제약 — LESSONS_BACKEND)
export { decideKakaoTemplateSendable } from './kakao-template-guard-core';
export type { KakaoTemplateSendableDecision } from './kakao-template-guard-core';

let _columnMissingLogged = false;

/**
 * imc_template_status 안전 조회 — ALTER 전(컬럼 부재)에도 발송 경로가 깨지지 않게 null 반환.
 * (null = 미동기 취급 → 기존 검수상태 가드만 적용)
 */
export async function getImcTemplateStatusSafe(
  companyId: string,
  templateCode: string
): Promise<string | null> {
  try {
    const r = await query(
      `SELECT imc_template_status FROM kakao_templates
        WHERE company_id = $1 AND template_code = $2 LIMIT 1`,
      [companyId, templateCode]
    );
    return r.rows[0]?.imc_template_status || null;
  } catch (err: any) {
    return handleStatusQueryError(err);
  }
}

/** 템플릿 id 기준 안전 조회 (자동마케팅 등 id로 식별하는 경로용) */
export async function getImcTemplateStatusByIdSafe(templateId: string): Promise<string | null> {
  try {
    const r = await query(
      `SELECT imc_template_status FROM kakao_templates WHERE id = $1::uuid LIMIT 1`,
      [templateId]
    );
    return r.rows[0]?.imc_template_status || null;
  } catch (err: any) {
    return handleStatusQueryError(err);
  }
}

function handleStatusQueryError(err: any): null {
  const msg = err?.message || '';
  if (msg.includes('column') && msg.includes('does not exist')) {
    if (!_columnMissingLogged) {
      _columnMissingLogged = true;
      console.log(
        '[kakao-template-guard] kakao_templates.imc_template_status 컬럼 없음 — ALTER 실행 전까지 활성상태 가드 미적용 (발송은 기존 검수 가드로 계속)'
      );
    }
    return null;
  }
  console.log('[kakao-template-guard] imc_template_status 조회 실패 (가드 미적용 통과):', msg);
  return null;
}
