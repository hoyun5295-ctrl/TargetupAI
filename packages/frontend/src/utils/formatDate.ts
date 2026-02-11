/**
 * KST 시간 포맷 유틸
 * 모든 시간 표시에 이 함수를 사용할 것
 */

// 날짜+시간: 2026. 2. 11. 오후 2:53:08
export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
}

// 날짜만: 2026. 2. 11.
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
}

// 짧은 날짜+시간: 02/11 14:53
export function formatDateTimeShort(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}