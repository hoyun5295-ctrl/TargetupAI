/**
 * 서버 점검 안내 창(로그인 화면) 기간 (★2026-11-02 .62 메모리 점검 · Harold 「기존의 본인인증 대체로 올리면 될 것 같아 약 3시간」)
 * ★ 2026-11-14 다시 넣음 — .62 → .57 서버 장비 교체(Harold 「팝업부터 띄우고 · 늦게 들어와서 작업할 사람들」) · 기간만 오늘 밤으로.
 *
 * 끝나는 시각이 지나면 창이 저절로 사라지고 로그인 · 발송 인증 안내 창이 돌아온다(다시 배포할 필요 없음).
 * 쓰는 곳 = 로그인 화면(`LoginPage`) · 안내 창(`MaintenanceNoticeModal`).
 */
export const MAINTENANCE_NOTICE_END_AT_MS = new Date('2026-11-15T01:00:00+09:00').getTime();
export const MAINTENANCE_NOTICE_LEAD_TEXT = '11월 14일(토) 밤 11시부터 11월 15일(일) 새벽 1시까지, 약 2시간 동안 서버 장비 교체 작업을 진행합니다.';
export const MAINTENANCE_NOTICE_PERIOD_TEXT = '11월 14일(토) 23:00 ~ 11월 15일(일) 01:00 (약 2시간)';

/** 점검 안내 창을 띄울 때인가(끝나는 시각 전) */
export function isMaintenanceNoticeActive(now: number = Date.now()): boolean {
  return now < MAINTENANCE_NOTICE_END_AT_MS;
}
