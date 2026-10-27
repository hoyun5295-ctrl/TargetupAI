/**
 * integration-problem.ts — 자사몰 연동 문제 분류 CT (★ 2026-10-27 자사몰 대비 K7 · K10 1단 · 설계서 docs/2026-10-27-mall-integration-hardening-design.md · I11)
 *
 * 연동 행에 남은 실패 코드(provider 마다 다른 글자) → { 종류, 원인 } 하나. 화면 · 감시 표 · 경보가 이 함수만 부른다(원인 글자 판정 밖 0 · R1).
 *   transient = 기다리면 풀린다(카드 배지 불변 · 몰 줄 안내 한 줄) · action = 사람이 무엇을 해야 풀린다.
 *   cause = 닫힌 목록(INTEGRATION_CAUSES). 표에 없는 코드는 분류하지 않는다(null · 감시 표가 원문 코드를 그대로 띄운다 · 추측으로 접지 않는다).
 * DB 0 · 순수.
 */

export const TRANSIENT_CAUSES = ['rate_limited', 'network', 'upstream_5xx', 'cap_reached'] as const;
export const ACTION_CAUSES = ['key_rejected', 'permission', 'ip_not_allowed', 'address', 'header_overflow', 'token_rejected', 'app_removed', 'grace_over'] as const;
export const INTEGRATION_CAUSES = [...TRANSIENT_CAUSES, ...ACTION_CAUSES] as const;
export type IntegrationCause = (typeof INTEGRATION_CAUSES)[number];
export interface IntegrationProblem { kind: 'transient' | 'action'; cause: IntegrationCause }

/** provider 실패 코드 → 원인(표에 있는 코드만) — 우커머스 WooApiErrorCode · 고도몰 RETURN 코드 · 공통 상태 */
const CODE_CAUSE: Record<string, Record<string, IntegrationCause>> = {
  woocommerce: {
    unauthorized: 'key_rejected', no_keys: 'key_rejected',
    forbidden: 'permission',
    not_found: 'address', redirect: 'address', invalid_site: 'address', no_integration: 'address',
    header_overflow: 'header_overflow',
    rate_limited: 'rate_limited',
    network: 'network', busy: 'network',
    http: 'upstream_5xx', bad_response: 'upstream_5xx',
    truncated: 'cap_reached',
  },
  godo: {
    '999': 'key_rejected', '997': 'key_rejected', key: 'key_rejected',
    '998': 'permission', partner_key: 'permission', '995': 'permission',
    '996': 'ip_not_allowed',
    '429': 'rate_limited',
  },
};

/** 연동 행 상태 글자 → 원인(토큰을 몰이 거절해 우리가 만료로 표시한 행) */
const STATUS_CAUSE: Record<string, IntegrationCause> = { token_expired: 'token_rejected' };

const kindOf = (cause: IntegrationCause): IntegrationProblem['kind'] =>
  (TRANSIENT_CAUSES as readonly string[]).includes(cause) ? 'transient' : 'action';

/**
 * 그 연동 행의 문제(없으면 null). 상태가 먼저다(토큰 거절은 실패 코드보다 무겁다) · 그다음 마지막 실패 코드.
 * @returns null = 문제 없음 또는 표에 없는 코드(호출부는 code 원문을 함께 들고 있다)
 */
export function integrationProblemOf(provider: string, status: string | null | undefined, code: string | null | undefined): IntegrationProblem | null {
  const byStatus = STATUS_CAUSE[String(status || '')];
  if (byStatus) return { kind: kindOf(byStatus), cause: byStatus };
  const c = String(code || '').trim();
  if (!c) return null;
  const cause = CODE_CAUSE[provider]?.[c];
  return cause ? { kind: kindOf(cause), cause } : null;
}
