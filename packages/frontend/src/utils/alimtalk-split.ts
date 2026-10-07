/**
 * 알림톡 캠페인 = 알림톡 시도 · 대체 문자 분리 표시 (★2026-10-07 박성용 접수 · 서버 tallyAlimtalkFallback 응답 `alimtalk_split`)
 * 관리자 발송 내역 · 고객사 발송결과가 같은 규칙으로 그린다. 응답에 없으면(조회 실패 · 알림톡 아님) null = 옛 표시.
 */
export interface ChannelCount { total: number; success: number; fail: number; pending: number }
export interface AlimtalkSplit extends ChannelCount { fallback: { LMS: ChannelCount; SMS: ChannelCount } }

export function readAlimtalkSplit(c: any): AlimtalkSplit | null {
  const s = c?.alimtalk_split;
  return s && typeof s === 'object' && s.fallback ? (s as AlimtalkSplit) : null;
}

/** 대체로 나간 문자 줄(건수 있는 것만 · LMS 먼저) */
export function alimtalkFallbackRows(s: AlimtalkSplit): Array<{ type: 'LMS' | 'SMS' } & ChannelCount> {
  return (['LMS', 'SMS'] as const).map((type) => ({ type, ...s.fallback[type] })).filter((r) => r.total > 0);
}
