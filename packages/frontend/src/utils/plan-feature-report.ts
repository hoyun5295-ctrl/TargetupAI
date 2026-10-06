/**
 * plan-feature-report.ts — 기능 안내 · 로그인 안내 창에서 본 것 · 누른 것을 서버에 남긴다 (★ 2026-10-06 Harold 지시)
 *
 * 원천이 되는 화면 = 슈퍼관리자 「기능 관심 업체」(ceo 전용). 서버 = POST /api/plans/feature-seen(로그인 필수 · 사용자당 1분 30회 ·
 * 고객사 사용자만 기록 · utils/feature-interest.ts). 응답을 기다리지 않고, 실패해도 화면에 영향이 없다.
 *   open    = 창이 뜸(기능 안내 창 · 로그인 안내 창)
 *   pricing = 기능 안내 창의 「요금제 보기」
 *   go      = 로그인 안내 창의 「지금 바로가기」
 */
export function reportPlanFeature(featureId: string, event: 'open' | 'pricing' | 'go'): void {
  const token = localStorage.getItem('token');
  if (!token) return;
  try {
    void fetch('/api/plans/feature-seen', {
      method: 'POST',
      keepalive: true, // 누르면 곧바로 화면을 옮긴다 — 옮겨도 요청이 끝까지 가게
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ featureId, event }),
    }).catch(() => { /* 기록 실패는 무시 */ });
  } catch { /* 기록 실패는 무시 */ }
}
