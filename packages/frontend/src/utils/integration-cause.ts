/**
 * 연동 문제 원인 → 고객 문장(★ 2026-10-28 자사몰 대비 K7 · K14 N2 · I11)
 *
 * 원인 분류는 서버(`backend/src/utils/integration-problem.ts integrationProblemOf`)가 하고 화면은 이 표로 문장만 고른다.
 * 원인 목록 = 서버 INTEGRATION_CAUSES 와 같은 닫힌 목록(계약 시험이 두 목록을 대조한다 · 표에 없는 원인 = 시험 실패).
 * transient = 기다리면 풀린다(배지 그대로 · 몰 줄 안내 한 줄) · action = 사람이 해야 풀린다(조치 필요).
 */
export type IntegrationCause =
  | 'rate_limited' | 'network' | 'upstream_5xx' | 'cap_reached'
  | 'key_rejected' | 'permission' | 'ip_not_allowed' | 'address' | 'header_overflow' | 'token_rejected' | 'app_removed' | 'grace_over';

export interface IntegrationProblem {
  kind: 'transient' | 'action';
  cause: IntegrationCause;
}

export const CAUSE_SENTENCE: Record<IntegrationCause, string> = {
  rate_limited: '몰이 잠시 호출을 막았어요. 자동으로 다시 시도해요.',
  network: '몰 서버에 잠시 닿지 않았어요. 자동으로 다시 시도해요.',
  upstream_5xx: '몰 서버가 잠시 오류를 냈어요. 자동으로 다시 시도해요.',
  cap_reached: '한 번에 가져오는 양의 상한에 닿았어요. 나머지는 이어서 가져와요.',
  key_rejected: '몰이 연결 키를 받지 않아요. 키를 다시 넣어 주세요.',
  permission: '연결 키에 필요한 권한이 없어요. 권한을 확인해 주세요.',
  ip_not_allowed: '몰 관리자에 한줄로 서버의 접속 허용 등록이 필요해요. 담당자에게 문의해 주세요.',
  address: '몰 주소에 닿지 않아요. 몰 주소를 확인해 주세요.',
  header_overflow: '몰의 응답이 너무 커서 읽지 못했어요. 몰에 켜 둔 디버깅 플러그인을 꺼 주세요.',
  token_rejected: '몰 연결 승인이 끊겼어요. 다시 연결해 주세요.',
  app_removed: '몰에서 한줄로 앱이 지워졌어요. 다시 설치해 주세요.',
  grace_over: '연결이 끊긴 지 오래되어 데이터를 받지 못하고 있어요. 다시 연결해 주세요.',
};

/** 원인을 모르는 실패(서버가 분류하지 못한 코드) — 사람 조치 근거가 없어 기다림 문장 */
export const UNKNOWN_PROBLEM_SENTENCE = '수집이 잠시 멈췄어요. 자동으로 다시 시도해요.';
