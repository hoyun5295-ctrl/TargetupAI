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
 * ★2026-10-21 전송자격인증 실사 준비 S5 — 「컬럼 없음」 기억(실패 기반)
 *   컬럼이 없는 동안 이 컬럼을 넣은 SQL 이 몇 분마다 실패해 운영 DB 로그에 오류가 쌓였다.
 *   **실제로 그 실패가 난 뒤에만** 기억하고, 기억하는 동안은 그 SQL 을 보내지 않고 곧바로 지금의 대체 경로로 간다.
 *   ⛔ information_schema 사전 탐지로 갈래를 고르지 않는다(LESSONS_BACKEND 2026-09-12 「사전 탐지 캐시는 폴백을 구멍으로 바꾼다」).
 *   기억이 풀리면 다시 한 번 시도한다 — ALTER 뒤에는 늦어도 그때부터 컬럼을 쓴다.
 */
export const IMC_STATUS_COLUMN_MISSING_TTL_MS = 6 * 60 * 60 * 1000;
let _imcColumnMissingUntil = 0;

/** 이 오류가 imc_template_status 컬럼 부재인가(다른 컬럼 부재와 가른다) */
export function isImcStatusColumnMissingError(err: any): boolean {
  const msg = String(err?.message || '');
  return msg.includes('imc_template_status') && msg.includes('does not exist');
}

/** 실제 실패를 본 뒤에만 부른다 */
export function markImcStatusColumnMissing(now: number = Date.now()): void {
  _imcColumnMissingUntil = now + IMC_STATUS_COLUMN_MISSING_TTL_MS;
}

/** 최근 실패로 컬럼 부재를 알고 있는가 — true 면 그 컬럼을 넣은 SQL 을 보내지 않는다 */
export function isImcStatusColumnKnownMissing(now: number = Date.now()): boolean {
  return now < _imcColumnMissingUntil;
}

/** 시험 격리용 — 모듈 상태를 비운다 */
export function resetImcStatusColumnMemory(): void {
  _imcColumnMissingUntil = 0;
  _columnMissingLogged = false;
}

/**
 * imc_template_status 안전 조회 — ALTER 전(컬럼 부재)에도 발송 경로가 깨지지 않게 null 반환.
 * (null = 미동기 취급 → 기존 검수상태 가드만 적용)
 */
export async function getImcTemplateStatusSafe(
  companyId: string,
  templateCode: string
): Promise<string | null> {
  if (isImcStatusColumnKnownMissing()) return null;
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
  if (isImcStatusColumnKnownMissing()) return null;
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
    if (isImcStatusColumnMissingError(err)) markImcStatusColumnMissing();
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
