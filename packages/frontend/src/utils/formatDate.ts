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

/**
 * ★ D92: 변수 치환 미리보기용 포맷팅 — 프론트 전 경로의 유일한 포맷팅 함수
 *
 * - 날짜(ISO): "2025-03-01T00:00:00.000Z" → "2025. 3. 1."
 * - 숫자: "35000.00" → "35,000"
 * - 기타: 그대로 반환
 *
 * 사용처: Dashboard.tsx, TargetSendModal.tsx, AiCustomSendFlow.tsx,
 *          AiPreviewModal.tsx, DirectPreviewModal.tsx, AiCampaignResultPopup.tsx
 */
export function formatPreviewValue(val: any): string {
  if (val == null || val === '') return '';
  const str = String(val);
  // 날짜: ISO 형식(YYYY-MM-DDT...) — KST 변환 후 날짜 추출 (하루 밀림 방지)
  if (/^\d{4}-\d{2}-\d{2}(T|\s)/.test(str)) {
    const d = safeParse(str);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
    }
    return formatDate(str.slice(0, 10));
  }
  // 순수 날짜(YYYY-MM-DD)
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return formatDate(str);
  }
  // ★ 전화번호 보호: 0으로 시작하는 순수 숫자 문자열은 숫자 포맷팅 하지 않음
  // (예: 01012345678 → 1,012,345,678 방지)
  const numStr = str.replace(/,/g, '');
  if (/^0\d+$/.test(numStr)) return str;
  // 숫자: 소수점 제거 + 천단위 쉼표
  if (/^-?\d+(\.\d+)?$/.test(numStr)) {
    const num = Number(numStr);
    if (!isNaN(num) && Number.isFinite(num)) return num.toLocaleString('ko-KR');
  }
  return str;
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

/**
 * ★ D95: SMS 바이트 계산 — EUC-KR 기준 (한글 2byte, 영문/숫자/ASCII 1byte)
 * 프론트 전 경로의 유일한 바이트 계산 함수.
 * 사용처: Dashboard.tsx, AiCustomSendFlow.tsx, TargetSendModal.tsx 등
 */
export function calculateSmsBytes(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    bytes += text.charCodeAt(i) > 127 ? 2 : 1;
  }
  return bytes;
}

/**
 * ★ D95: SMS 바이트 기준 문자열 자르기
 * maxBytes 초과 시 해당 바이트 직전까지 잘린 문자열 반환.
 */
export function truncateToSmsBytes(text: string, maxBytes: number = 90): string {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    bytes += text.charCodeAt(i) > 127 ? 2 : 1;
    if (bytes > maxBytes) return text.substring(0, i);
  }
  return text;
}

/**
 * ★ D95: 프론트 변수 치환 컨트롤타워
 * %한글라벨% → 고객 데이터 값으로 치환. formatPreviewValue로 숫자/날짜 포맷팅.
 *
 * @param text - 치환 대상 메시지 (예: "%이름%님 %포인트%원 적립")
 * @param fields - 필드 정의 배열 (enabled-fields API 응답, field_key/field_label 포함)
 * @param customerData - 고객 데이터 객체 (field_key 기반, 예: {name: '홍길동', point: 5000})
 * @param options.removeUnmatched - true이면 남은 %변수% 빈값으로 제거 (기본 false)
 * @param options.extraReplacements - 추가 치환 맵 ({%회신번호%: '07012345678'} 등)
 */
export function replaceMessageVars(
  text: string,
  fields: { field_key: string; field_label?: string; display_name?: string }[],
  customerData: Record<string, any>,
  options?: { removeUnmatched?: boolean; extraReplacements?: Record<string, string> }
): string {
  if (!text) return text;
  let result = text;

  // regex 특수문자 이스케이프 (라벨에 괄호 등 포함 시 에러 방지)
  const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // 필드 정의 기반 치환 (field_label → field_key 매핑)
  for (const f of fields) {
    const label = f.field_label || f.display_name || f.field_key;
    const val = customerData[f.field_key];
    if (label && val != null) {
      result = result.replace(new RegExp(`%${escapeRegex(label)}%`, 'g'), formatPreviewValue(val));
    }
  }

  // column 키로도 치환 (sampleCustomer가 column 키일 때 호환)
  for (const [k, v] of Object.entries(customerData)) {
    if (v != null) {
      result = result.replace(new RegExp(`%${escapeRegex(k)}%`, 'g'), formatPreviewValue(v));
    }
  }

  // 추가 치환 (회신번호 등 필드 외 변수)
  if (options?.extraReplacements) {
    for (const [pattern, value] of Object.entries(options.extraReplacements)) {
      result = result.replace(new RegExp(escapeRegex(pattern), 'g'), value);
    }
  }

  // 잔여 %변수% 제거
  if (options?.removeUnmatched) {
    result = result.replace(/%[^%\s]{1,20}%/g, '');
  }

  return result;
}
