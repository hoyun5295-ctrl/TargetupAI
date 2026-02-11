// timezone 정보 없는 timestamp를 UTC로 처리
function toUTC(dateStr: string): string {
  if (!dateStr.endsWith('Z') && !dateStr.includes('+') && !/\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr.replace(' ', 'T') + 'Z';
  }
  return dateStr;
}

export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  return new Date(toUTC(dateStr)).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  return new Date(toUTC(dateStr)).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
}

export function formatDateTimeShort(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  return new Date(toUTC(dateStr)).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  });
}