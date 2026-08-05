/**
 * free-messaging-grant-worker.ts — 요금제 무료 메시징 월 지급 워커 (★ 2026-08-05 신설)
 *
 * 하는 일은 하나다 — **당월분 지급 행이 없으면 만든다.** 지급 자체가 멱등(회사×월×유형 UNIQUE)이라
 * 이 워커는 "언제 도는가"를 정교하게 맞출 필요가 없다.
 *
 * 그래서 `trial-downgrade-worker`처럼 "다음 04:00까지 대기"를 계산하지 않고 **짧은 주기로 계속 확인**한다:
 *  · 월 경계에서 지급이 늦어지는 창이 최대 10분으로 줄어든다(그 시간대는 야간이라 광고 발송이 법으로 막혀 있다).
 *  · 프로세스가 월 1일에 죽어 있었어도 다음 기동에 자동으로 메워진다 — 놓친 지급을 따로 추적할 장치가 필요 없다.
 *  · **기동 즉시 1회 도는 것이 곧 배포 시점 소급 지급 경로**다(설계 §4 — 8월분 즉시 적용).
 *
 * 비용은 무시할 수준이다. 한 패스 = `INSERT ... SELECT ... ON CONFLICT DO NOTHING` 4문(유형별 1문),
 * 대상은 회사 수(백 단위)뿐이고 충돌은 UNIQUE 인덱스 탐침으로 끝난다.
 *
 * ⚠ DDL 미실행이면 CT가 무료 0으로 폴백하고 이 워커는 조용히 skip한다(발송·과금 무영향).
 */

import { grantFreeMessagingForCurrentMonth } from './free-messaging';

const PASS_INTERVAL_MS = 10 * 60 * 1000;

let _scheduled = false;
let _timer: NodeJS.Timeout | null = null;
let _running = false;

export async function runFreeMessagingGrantPass(): Promise<{ granted: number; skipped: boolean }> {
  // 겹침 방지 — 앞 패스가 길어져도 두 패스가 같은 INSERT를 동시에 던지지 않게 한다
  // (UNIQUE가 최종 방어지만, 23505 로그로 시끄러워지는 것을 피한다).
  if (_running) return { granted: 0, skipped: true };
  _running = true;
  try {
    const res = await grantFreeMessagingForCurrentMonth();
    // 신규 지급이 있을 때만 남긴다 — 10분마다 "0건"을 찍으면 로그가 의미를 잃는다.
    if (res.granted > 0) {
      console.log(`[무료메시징][지급] 당월분 ${res.granted}행 신규 지급`);
    }
    return res;
  } catch (err: any) {
    console.error('[무료메시징][지급] 패스 실패:', err?.message || err);
    return { granted: 0, skipped: true };
  } finally {
    _running = false;
  }
}

export function startFreeMessagingGrantWorker(): void {
  if (_scheduled) return;
  _scheduled = true;
  console.log(`[무료메시징][스케줄러] started (기동 즉시 1회 + ${PASS_INTERVAL_MS / 60000}분 주기)`);

  // 기동 즉시 1회 — 배포 시점에 당월분이 바로 지급된다.
  void runFreeMessagingGrantPass();
  _timer = setInterval(() => { void runFreeMessagingGrantPass(); }, PASS_INTERVAL_MS);
}

export function stopFreeMessagingGrantWorker(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
  _scheduled = false;
}
