/**
 * ai-operator-access.ts — AI Operator 기능을 쓸 수 있는 회사인가 (★ 2026-09-15 Harold 지시)
 *
 * 판정 = 서버 `GET /api/ai/operator/access`(plan-guard `isAiOperatorAllowed` · 유료 요금제·AI 오퍼레이션 체험·슈퍼관리자).
 * 화면은 이 값을 묻기만 한다. 요금제 코드를 받아 다시 조합하지 않는다.
 * 소비처 = AI Operator 허브(카드·[생성]·[이미지]) · 기능 화면 입구(PlanGate). 두 곳이 같은 함수를 써야 판정이 갈리지 않는다.
 *
 * 반환: true = 사용 가능 · false = 잠김 · null = 모름(조회 실패). 모름은 잠그지 않는다(기능마다 서버가 다시 막는다).
 * 캐시: "사용 가능"만 세션 동안 기억한다(기능 화면을 옮겨 다닐 때마다 묻지 않게).
 *   잠김·모름은 기억하지 않는다 — 요금제에 가입한 뒤 다시 들어오면 바로 열려야 한다.
 */
import { fetchStudioTrial } from './studio-trial';

let allowedForToken: string | null = null;
/** 기능별 개방 플래그(`features`) 캐시 — 로그인 단위. 허브 카드 필터가 쓴다. */
let featuresCache: { token: string; features: Record<string, boolean> } | null = null;

/**
 * ★ 2026-09-20: 기능별 개방 플래그. 지금은 `sns` 하나이며 서버 ENV 판정 결과가 그대로 실려 온다.
 * ⛔ 화면은 이 값을 **묻기만** 한다. 회사 id 목록이나 ENV 를 프론트에서 다시 계산하지 않는다(설계서 §2-16).
 * 조회 실패·필드 부재 = 빈 객체 → 플래그가 달린 카드는 **안 보인다**(모르면 열지 않는다).
 */
export async function fetchAiOperatorFeatures(): Promise<Record<string, boolean>> {
  const token = localStorage.getItem('token');
  if (!token) return {};
  if (featuresCache?.token === token) return featuresCache.features;
  try {
    const res = await fetch('/api/ai/operator/access', { headers: { Authorization: `Bearer ${token}` } });
    const d = await res.json();
    const features = d?.success && d.features && typeof d.features === 'object' ? d.features : {};
    featuresCache = { token, features };
    return features;
  } catch {
    return {};
  }
}

/** 이미 "사용 가능"으로 확인된 로그인인가(입구가 로딩 화면 없이 바로 그리기 위한 동기 확인) */
export function isAiOperatorAccessKnownAllowed(): boolean {
  const token = localStorage.getItem('token');
  return !!token && allowedForToken === token;
}

export async function fetchAiOperatorAccess(): Promise<boolean | null> {
  const token = localStorage.getItem('token');
  if (token && allowedForToken === token) return true;
  try {
    const res = await fetch('/api/ai/operator/access', { headers: { Authorization: `Bearer ${token}` } });
    const d = await res.json();
    if (!d?.success) return null;
    if (d.allowed === true) {
      allowedForToken = token;
      return true;
    }
    return d.allowed === false ? false : null;
  } catch {
    return null;
  }
}

/** ★ 2026-11-15 C135 무료체험 3회가 닿는 기능 화면(이 화면 하나뿐 · 서버도 생성 주소 하나에만 체험 길을 둔다) */
export const STUDIO_TRIAL_FEATURE_ID = 'image-studio';

/**
 * ★ 2026-11-16 C138 — 그 기능 화면에 들어갈 수 있는가. **허브 카드와 화면 입구(PlanGate)가 이 함수 하나를 쓴다.**
 *   (C135 가 무료체험 판정을 입구에만 넣어, 신청한 회사가 허브 카드로 들어가면 요금제 안내에 막혔다 — Harold 접수 1116.)
 *   true = 들어간다 · false = 잠김(요금제 안내) · null = 모름(잠그지 않는다 · 기능마다 서버가 다시 막는다).
 *   요금제로 잠긴 회사라도 이미지 스튜디오는 무료체험을 신청했으면 들어간다(판정 = 서버 /api/image-studio/trial · 그 답을 모르면 잠근 채).
 *   access = 요금제 답을 이미 받은 호출부(허브)가 넘긴다 — 같은 답을 다시 묻지 않는다(둘째 물음이 실패해 「모름」이 「잠김」으로 굳는 길이 없다 · Codex 구현 1R).
 */
export async function fetchFeatureEntry(featureId: string, access?: boolean | null): Promise<boolean | null> {
  const allowed = access === undefined ? await fetchAiOperatorAccess() : access;
  if (allowed !== false) return allowed;
  if (featureId !== STUDIO_TRIAL_FEATURE_ID) return false;
  const trial = await fetchStudioTrial();
  return !!(trial?.eligible && trial.requested);
}
