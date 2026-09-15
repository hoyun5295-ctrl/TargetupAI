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
let allowedForToken: string | null = null;

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
