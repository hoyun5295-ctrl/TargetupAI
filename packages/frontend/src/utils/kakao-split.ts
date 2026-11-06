/**
 * 카카오 캠페인 = 카카오 시도 · 대체 문자 분리 표시 (★2026-10-07 박성용 접수 · 서버 tallyKakaoFallback 응답 `kakao_split`)
 * ★ 2026-11-05 C107(접수 T2) — 알림톡에 더해 브랜드메시지 전용 캠페인도 같은 모양(서버 분리 대상 = billing-types isKakaoSplitChannel).
 * 관리자 발송 내역 · 고객사 발송결과가 같은 규칙으로 그린다. 응답에 없으면(조회 실패 · 분리 대상 아님) null = 옛 표시.
 */
import { isAlimtalkChannel } from './campaign-axis';

export interface ChannelCount { total: number; success: number; fail: number; pending: number }
/** ★ 2026-11-06 C107F ② friendSuccess = 카카오 성공 중 브랜드로 실제 친구에게 간 수(친구 단가 · 옛 응답엔 없다 = 0) */
export interface KakaoSplit extends ChannelCount { fallback: { LMS: ChannelCount; SMS: ChannelCount }; friendSuccess?: number }

export function readKakaoSplit(c: any): KakaoSplit | null {
  const s = c?.kakao_split;
  return s && typeof s === 'object' && s.fallback ? (s as KakaoSplit) : null;
}

/** 대체로 나간 문자 줄(건수 있는 것만 · LMS 먼저) */
export function kakaoFallbackRows(s: KakaoSplit): Array<{ type: 'LMS' | 'SMS' } & ChannelCount> {
  return (['LMS', 'SMS'] as const).map((type) => ({ type, ...s.fallback[type] })).filter((r) => r.total > 0);
}

/** 아랫줄 머리 글 — 무엇이 실패해 문자로 넘어갔는가 */
export function kakaoFailLabel(c: any): string {
  return isAlimtalkChannel(c) ? '알림톡 실패분' : '브랜드메시지 실패분';
}
