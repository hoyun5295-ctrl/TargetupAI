// ★ D89: 날짜 포맷팅 유틸 — 순수 날짜(YYYY-MM-DD)는 UTC 변환 없이 직접 파싱

/**
 * timezone 정보 없는 timestamp를 UTC로 처리
 * ⚠️ 순수 날짜(YYYY-MM-DD)에는 사용하지 않는다 — formatDate에서 별도 처리
 */
function toUTC(dateStr: string): string {
  if (!dateStr.endsWith('Z') && !dateStr.includes('+') && !/\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr.replace(' ', 'T') + 'Z';
  }
  return dateStr;
}

/**
 * 안전하게 Date 파싱 — toUTC 실패 시 원본으로 재시도
 * JS Date.toString() 형식("Tue Dec 31 2024 21:10:08 GMT+0000 ...") 등도 파싱 가능
 */
function safeParse(dateStr: string): Date {
  const d = new Date(toUTC(dateStr));
  if (!isNaN(d.getTime())) return d;
  // toUTC 실패 → 원본 그대로 파싱 (JS Date.toString() 형식 등)
  const d2 = new Date(dateStr);
  return d2;
}

export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  const d = safeParse(String(dateStr));
  if (isNaN(d.getTime())) return String(dateStr);
  return d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
}

/**
 * ★ D89: 날짜만 표시
 * - 순수 날짜(YYYY-MM-DD): UTC 변환 없이 직접 파싱 → 하루 밀림 방지
 * - TIMESTAMP: 기존 UTC→KST 변환 유지
 * - JS Date raw 형식: safeParse로 처리
 */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  const s = String(dateStr).trim();

  // 순수 날짜(YYYY-MM-DD) — UTC 변환 없이 직접 표시 (하루 밀림 방지)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number);
    if (y > 0 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}. ${m}. ${d}.`;
    }
  }

  // TIMESTAMP 또는 기타 형식 — safeParse + KST 변환
  const d = safeParse(s);
  if (isNaN(d.getTime())) return s; // 파싱 실패 → 원본 그대로
  return d.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
}

export function formatDateTimeShort(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  const d = safeParse(String(dateStr));
  if (isNaN(d.getTime())) return String(dateStr);
  return d.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  });
}
