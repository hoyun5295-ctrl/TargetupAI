/**
 * 서버 점검 안내 창(로그인 화면) 기간 (★2026-11-02 .62 메모리 점검 · Harold 「기존의 본인인증 대체로 올리면 될 것 같아 약 3시간」)
 *
 * 끝나는 시각이 지나면 창이 저절로 사라지고 로그인 · 발송 인증 안내 창이 돌아온다(다시 배포할 필요 없음).
 * 쓰는 곳 = 로그인 화면(`LoginPage`) · 안내 창(`MaintenanceNoticeModal`).
 */
export const MAINTENANCE_NOTICE_END_AT_MS = new Date('2026-11-03T02:00:00+09:00').getTime();
export const MAINTENANCE_NOTICE_LEAD_TEXT = '11월 2일(월) 밤 11시부터 11월 3일(화) 새벽 2시까지, 약 3시간 동안 서버 장비 점검을 진행합니다.';
export const MAINTENANCE_NOTICE_PERIOD_TEXT = '11월 2일(월) 23:00 ~ 11월 3일(화) 02:00 (약 3시간)';

/** 점검 안내 창을 띄울 때인가(끝나는 시각 전) */
export function isMaintenanceNoticeActive(now: number = Date.now()): boolean {
  return now < MAINTENANCE_NOTICE_END_AT_MS;
}
