/**
 * v3-stage.ts — 한줄로 V3 기능의 단계 개방 판정 한 곳 (★ 2026-11-13 C133 · 설계서 docs/2026-11-13-hanjul-v3-design.md §2-3 · §11 · §14)
 *
 * 왜 있나
 *   V3 기능은 배포를 넷으로 끊고(A ~ D) 사내 회사 → 한 곳 → 전체 순서로 연다. 그 「지금 이 회사에 열렸는가」를
 *   기능마다 따로 적으면 입구 · 화면 · 소개 창 칩이 서로 다른 답을 낸다(칩은 약속하는데 기능은 닫혀 있는 꼴 = 로드맵 노출).
 *   → 판정을 여기 하나에 두고 기능의 입구와 소개 창 칩이 **같은 함수**를 부른다.
 *
 * 순서(⛔ 뒤집지 않는다 · plan-guard sns_publish 주석의 사고): 요금제 판정이 먼저 · ENV 명단이 뒤.
 *   ENV 만 보면 명단에 든 미가입 회사가 뚫린다.
 * ENV = `V3_STAGE_<기능>` · 비어 있음 = 닫힘 · `*` = 전 회사 · 회사 id 쉼표 목록(companyListAllows = SNS 단계 개방과 같은 파서).
 *   되돌리기 = ENV 를 비우고 `pm2 restart --update-env`.
 */
import { companyListAllows } from './sns-constants';
import { canUseFeature, loadPlanContext, type FeatureKey, type PlanContext } from './plan-guard';

export const V3_FEATURES = ['journey-pack', 'product-insight', 'benchmark', 'reco', 'split', 'inbox'] as const;
export type V3Feature = (typeof V3_FEATURES)[number];

/** 기능 → ENV 이름(값을 여기서만 정한다 · 배포 원장 ENV 항목과 같은 이름) */
export const V3_STAGE_ENV: Record<V3Feature, string> = {
  'journey-pack': 'V3_STAGE_JOURNEY_PACK',
  'product-insight': 'V3_STAGE_PRODUCT_INSIGHT',
  benchmark: 'V3_STAGE_BENCHMARK',
  reco: 'V3_STAGE_RECO',
  split: 'V3_STAGE_SPLIT',
  inbox: 'V3_STAGE_INBOX',
};

/** 기능 → 요금제 기능 키(새 키를 만들지 않는다 · 설계 회의 기획 수렴 = 스타터부터 · 미가입만 닫힘) */
export const V3_PLAN_KEY: Record<V3Feature, FeatureKey> = {
  'journey-pack': 'auto_campaign',
  'product-insight': 'ai_premium',
  benchmark: 'ai_premium',
  reco: 'ai_premium',
  split: 'ai_premium',
  inbox: 'ai_premium',
};

/** (순수) 요금제가 허용했고 ENV 명단에 든 회사인가 — 요금제가 먼저다(planAllowed 가 false 면 ENV 를 보지 않는다) */
export function v3StageOpen(
  feature: V3Feature,
  companyId: string | null | undefined,
  planAllowed: boolean,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!planAllowed) return false;
  return companyListAllows(companyId, String(env[V3_STAGE_ENV[feature]] || ''));
}

/**
 * (순수) 이 기능의 ENV 명단 — 야간 워커가 「어느 회사를 계산할지」 후보를 좁힐 때 쓴다(명단이 비면 아무 회사도 계산하지 않는다 = 부하 0).
 *   ⛔ 후보일 뿐이다 — 회사마다 v3Live 로 다시 판정한다(요금제가 먼저).
 */
export function v3StageScope(feature: V3Feature, env: Record<string, string | undefined> = process.env): { all: boolean; ids: string[] } {
  const list = String(env[V3_STAGE_ENV[feature]] || '').split(',').map((s) => s.trim()).filter(Boolean);
  return { all: list.includes('*'), ids: list.filter((s) => s !== '*') };
}

/** (순수) 이미 읽은 요금제 문맥으로 판정 — 한 요청에서 여러 기능을 물을 때(소개 창 칩) 요금제를 한 번만 읽는다 */
export function v3LiveWith(feature: V3Feature, companyId: string | null | undefined, ctx: PlanContext | null): boolean {
  if (!ctx || !companyId) return false;
  return v3StageOpen(feature, companyId, canUseFeature(ctx, V3_PLAN_KEY[feature]).allowed);
}

export type V3LiveState = 'open' | 'closed' | 'unknown';

/**
 * 이 회사에 지금 열린 기능인가 — 세 갈래. unknown = 요금제를 읽지 못했다(일시 장애일 수 있다).
 *   입구는 unknown 을 닫힘으로 본다(v3Live · 모르면 열지 않는다). ⛔ 지우는 쪽(야간 정리)은 unknown 을 닫힘으로 보지 않는다(모르면 지우지 않는다).
 */
export async function v3LiveState(feature: V3Feature, companyId: string | null | undefined): Promise<V3LiveState> {
  if (!companyId) return 'closed';
  // 명단에 없으면 요금제를 읽을 것도 없이 닫힘이다(닫힌 회사 · 미가입 회사에 쿼리 0). 명단에 있어도 요금제가 허용해야 열린다(아래).
  if (!v3StageOpen(feature, companyId, true)) return 'closed';
  let ctx: PlanContext | null;
  try {
    ctx = await loadPlanContext(companyId);
  } catch {
    return 'unknown';
  }
  return v3LiveWith(feature, companyId, ctx) ? 'open' : 'closed';
}

/** 이 회사에 지금 열린 기능인가(요금제 조회 실패 = 닫힘 · 모르면 열지 않는다) */
export async function v3Live(feature: V3Feature, companyId: string | null | undefined): Promise<boolean> {
  return (await v3LiveState(feature, companyId)) === 'open';
}

/**
 * 이 회사에 지금 열린 기능 전부 — 화면이 「이 기능의 입구를 그릴까」를 한 번에 묻는다(GET /api/plans/v3-features).
 *   어느 명단에도 없는 회사는 요금제를 읽지 않는다(쿼리 0). 판정은 기능마다 v3LiveWith 그대로(요금제가 먼저).
 *   ⛔ 요금제를 읽지 못하면 null(모름) — 전부 닫힘으로 답하지 않는다(화면이 그 답을 한 로그인 내내 기억해 열린 회사의 입구가 사라진다 · Codex 배포 B 1R).
 */
export async function v3FeaturesFor(companyId: string | null | undefined): Promise<Record<V3Feature, boolean> | null> {
  const out = Object.fromEntries(V3_FEATURES.map((f) => [f, false])) as Record<V3Feature, boolean>;
  if (!companyId || !V3_FEATURES.some((f) => v3StageOpen(f, companyId, true))) return out;
  let ctx: PlanContext | null;
  try {
    ctx = await loadPlanContext(companyId);
  } catch {
    return null;
  }
  for (const f of V3_FEATURES) out[f] = v3LiveWith(f, companyId, ctx);
  return out;
}
