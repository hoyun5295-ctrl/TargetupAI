/**
 * 날짜 정규화
 * 다양한 형식 → 'YYYY-MM-DD'
 *
 * 입력 예시:
 *   20240101        → 2024-01-01
 *   2024.01.01      → 2024-01-01
 *   2024/01/01      → 2024-01-01
 *   2024-01-01      → 2024-01-01
 *   01/01/2024      → 2024-01-01 (MM/DD/YYYY)
 *   Date 객체       → 2024-01-01
 */

import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';

dayjs.extend(customParseFormat);

const DATE_FORMATS = [
  'YYYY-MM-DD',
  'YYYYMMDD',
  'YYYY.MM.DD',
  'YYYY/MM/DD',
  'MM/DD/YYYY',
  'DD/MM/YYYY',
  'YYYY-MM-DD HH:mm:ss',
  'YYYY-MM-DDTHH:mm:ss',
  'YYYY-MM-DDTHH:mm:ssZ',
];

export function normalizeDate(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') return null;

  // Date 객체 처리
  if (raw instanceof Date) {
    if (isNaN(raw.getTime())) return null;
    return dayjs(raw).format('YYYY-MM-DD');
  }

  const value = String(raw).trim();

  // 다양한 포맷 시도
  for (const format of DATE_FORMATS) {
    const parsed = dayjs(value, format, true); // strict mode
    if (parsed.isValid()) {
      // 합리적 범위 체크 (1900~2100)
      const year = parsed.year();
      if (year >= 1900 && year <= 2100) {
        return parsed.format('YYYY-MM-DD');
      }
    }
  }

  // dayjs 기본 파싱 폴백
  const fallback = dayjs(value);
  if (fallback.isValid()) {
    const year = fallback.year();
    if (year >= 1900 && year <= 2100) {
      return fallback.format('YYYY-MM-DD');
    }
  }

  return null;
}

/**
 * 타임스탬프 정규화 (구매일시용)
 * → 'YYYY-MM-DD HH:mm:ss'
 */
export function normalizeTimestamp(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') return null;

  if (raw instanceof Date) {
    if (isNaN(raw.getTime())) return null;
    return dayjs(raw).format('YYYY-MM-DD HH:mm:ss');
  }

  const value = String(raw).trim();
  const parsed = dayjs(value);

  if (parsed.isValid()) {
    return parsed.format('YYYY-MM-DD HH:mm:ss');
  }

  return null;
}
