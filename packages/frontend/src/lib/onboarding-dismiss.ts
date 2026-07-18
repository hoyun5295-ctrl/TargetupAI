/**
 * 온보딩 위저드 "오늘 하루 보지 않기" 24h cooldown — localStorage 헬퍼.
 *
 * ★ 2026-07-18 (Codex M1 재시도 라운드): 원래 pages/OnboardingWizardPage.tsx 안에 있었으나,
 *   대시보드 정적 그래프(OnboardingCard)가 그 페이지에서 런타임 함수를 import하면
 *   Dashboard 청크가 위저드 lazy 청크(53KB+)를 물고 들어가 라우트 격리가 깨진다.
 *   공용 소비(위저드 페이지 + OnboardingCard)를 위해 독립 모듈로 분리 — 동작 원문 그대로.
 */

const DISMISS_KEY = 'onboarding_wizard_dismissed_until';
const COOLDOWN_MS = 24 * 60 * 60 * 1000;

export function isWizardDismissedNow(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const until = Number(raw);
    return Number.isFinite(until) && until > Date.now();
  } catch {
    return false;
  }
}

export function dismissWizardForToday(): void {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now() + COOLDOWN_MS));
  } catch {
    // localStorage 차단 = 무시 (보안 모드에서 영향 0)
  }
}

export function clearWizardDismiss(): void {
  try {
    localStorage.removeItem(DISMISS_KEY);
  } catch { /* skip */ }
}
