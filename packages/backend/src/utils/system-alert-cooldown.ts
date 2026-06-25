/**
 * system-alert-cooldown.ts — 시스템 알림 쿨다운 판단 (순수 함수, DB import 0)
 *
 * 2026-06-25: sendSystemAlert 쿨다운이 프로세스 메모리(Map)라 pm2 재시작마다 초기화 →
 *   싱크에이전트 중단 알림이 재시작/배포 때마다 다시 나가 종일 스팸.
 *   상태를 PG(system_alert_state.last_sent_at)에 영속화하고, 쿨다운 판단은 이 순수 함수로 분리.
 */

/**
 * 직전 발송 시각 기준 쿨다운 중인지 판단.
 * @param lastSentAtMs 마지막 발송 epoch ms (없으면 null/undefined — 첫 발송)
 * @param cooldownMs   쿨다운 길이 ms
 * @param nowMs        현재 epoch ms
 * @returns true면 쿨다운 중(발송 skip), false면 발송 허용
 */
export function isAlertOnCooldown(
  lastSentAtMs: number | null | undefined,
  cooldownMs: number,
  nowMs: number,
): boolean {
  if (lastSentAtMs == null) return false;
  return nowMs - lastSentAtMs < cooldownMs;
}
