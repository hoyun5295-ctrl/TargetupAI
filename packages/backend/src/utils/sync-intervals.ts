/**
 * 에이전트 주기 해석 (SoT) — 이 에이전트가 **실제로** 몇 분마다 heartbeat·동기화를 하는가.
 *
 * ★ 2026-09-02 신설. 경위: 슈퍼관리자 온라인 판정이 "60분 주기"를 상수로 박아 두고
 *   70분/130분으로 잘랐다. 그런데 동기화 주기는 **고객사마다 다르고 기본이 360분(6시간)** 이다.
 *   6시간 주기 고객사는 정상인데도 3시간만 지나면 오프라인으로 표시된다.
 *   (경위 = Harold님 지적: "고객사가 동기화 시간설정을 얼만큼으로 했는지 모르잖아?")
 *
 * 값의 자리가 두 겹이다 — `config` jsonb(원격 설정)가 우선, 없으면 레거시 컬럼, 그다음 기본값.
 * 이 우선순위는 에이전트에게 실제로 내려가는 `getSyncConfigForAgent`(routes/sync.ts)와 **같은 벌**이다.
 * ⛔ 한쪽만 바꾸면 화면이 말하는 주기와 에이전트가 도는 주기가 갈린다. 바꿀 때 둘을 함께 본다.
 *
 * ⚠ 알려진 불일치(이번 범위 밖 · 기록만): 레거시 `GET /api/sync/config`(routes/sync.ts)는 같은 질문에
 *   기본값 60/30으로 답한다. v1.5.0에서 폴링이 제거돼 에이전트가 그 경로를 쓰지 않으므로 실효는
 *   `getSyncConfigForAgent` 쪽(360/360)이다. 정리하려면 그 엔드포인트의 소비처부터 확인해야 한다.
 */

/** 에이전트 설정 기본값 — `getSyncConfigForAgent`와 같은 값이어야 한다. */
export const AGENT_INTERVAL_DEFAULTS = {
  heartbeatMin: 60,
  customersMin: 360,
  purchasesMin: 360,
} as const;

export interface AgentIntervals {
  heartbeatMin: number;
  customersMin: number;
  purchasesMin: number;
}

/** 양수 정수만 받아들인다 — 0·음수·NaN이 들어오면 판정이 무너지므로 기본값으로 되돌린다. */
function positiveOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * @param config  sync_agents.config jsonb (원격 설정이 우선한다)
 * @param agent   sync_agents 행 (레거시 컬럼 폴백)
 */
export function resolveAgentIntervals(
  config: Record<string, any> | null | undefined,
  agent?: { sync_interval_customers?: unknown; sync_interval_purchases?: unknown } | null,
): AgentIntervals {
  const c = config || {};
  return {
    heartbeatMin: positiveOr(c.heartbeat_interval, AGENT_INTERVAL_DEFAULTS.heartbeatMin),
    customersMin: positiveOr(
      c.sync_interval_customers ?? agent?.sync_interval_customers,
      AGENT_INTERVAL_DEFAULTS.customersMin,
    ),
    purchasesMin: positiveOr(
      c.sync_interval_purchases ?? agent?.sync_interval_purchases,
      AGENT_INTERVAL_DEFAULTS.purchasesMin,
    ),
  };
}
