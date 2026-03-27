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
  // ★ 전화번호 보호: 숫자 포맷팅 제외 대상
  // - 0으로 시작하는 순수 숫자 (01012345678 → 1,012,345,678 방지)
  // - 하이픈 포함 숫자열 (1800-8125, 02-1234-5678 등 전화번호 형태)
  const numStr = str.replace(/,/g, '');
  if (/^0\d+$/.test(numStr)) return str;
  if (/^\d[\d-]+\d$/.test(str) && str.includes('-')) return str;
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
// ============================================================
// ★ D96: 직접발송 변수맵 컨트롤타워 (하드코딩 3곳 통합)
// ============================================================

/** 직접발송에서 사용 가능한 변수 목록 — %변수% → recipient 필드키 */
export const DIRECT_VAR_MAP: { variable: string; fieldKey: string; label: string }[] = [
  { variable: '%이름%', fieldKey: 'name', label: '이름' },
  { variable: '%회신번호%', fieldKey: 'callback', label: '회신번호' },
  { variable: '%기타1%', fieldKey: 'extra1', label: '기타1' },
  { variable: '%기타2%', fieldKey: 'extra2', label: '기타2' },
  { variable: '%기타3%', fieldKey: 'extra3', label: '기타3' },
];

/** %변수% → fieldKey 매핑 (간편 조회용) */
export const DIRECT_VAR_TO_FIELD: Record<string, string> = Object.fromEntries(
  DIRECT_VAR_MAP.map(v => [v.variable, v.fieldKey])
);

/** fieldKey → label 매핑 */
export const DIRECT_FIELD_LABELS: Record<string, string> = Object.fromEntries(
  DIRECT_VAR_MAP.map(v => [v.fieldKey, v.label])
);

/**
 * 직접발송 메시지 내 변수를 수신자 데이터로 치환
 * @param fallbackCallback - 수신자에 callback 없을 때 사용할 기본 회신번호
 * @param useFallbackLabels - true이면 값 없는 변수에 라벨명 표시 (미리보기용)
 */
export function replaceDirectVars(
  text: string,
  recipient: Record<string, any>,
  fallbackCallback?: string,
  useFallbackLabels?: boolean
): string {
  if (!text) return text;
  let result = text;
  for (const { variable, fieldKey, label } of DIRECT_VAR_MAP) {
    const val = recipient[fieldKey];
    const hasVal = val != null && String(val).trim();
    // ★ callback(회신번호)은 전화번호이므로 숫자 포맷팅(formatPreviewValue) 적용 금지
    let displayVal: string;
    if (hasVal) {
      displayVal = fieldKey === 'callback' ? String(val).trim() : formatPreviewValue(val);
    } else if (fieldKey === 'callback') {
      displayVal = fallbackCallback || '';
    } else {
      displayVal = useFallbackLabels ? label : '';
    }
    result = result.replace(
      new RegExp(variable.replace(/%/g, '%'), 'g'),
      displayVal
    );
  }
  // 잔여 %변수% 제거 (기존 동작 호환 — 매핑 안 된 변수는 빈값으로)
  result = result.replace(/%[^%\s]{1,20}%/g, '');
  return result;
}

/** 직접발송 파일매핑 필드 목록 (phone 제외) */
export const DIRECT_MAPPING_FIELDS: { key: string; label: string }[] = [
  { key: 'name', label: '이름' },
  { key: 'callback', label: '회신번호' },
  { key: 'extra1', label: '기타1' },
  { key: 'extra2', label: '기타2' },
  { key: 'extra3', label: '기타3' },
];

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

/**
 * ★ D97: 전화번호 포맷팅 컨트롤타워
 * 하이픈 없는 번호 → 하이픈 포함 포맷. 이미 하이픈이 있으면 정규화 후 재포맷.
 * 사용처: Dashboard, DirectSendPanel, AiCampaignSendModal,
 *          CallbackConfirmModal, SpamFilterTestModal, DirectPreviewModal, TargetSendModal
 */
export function formatPhoneNumber(phone: string): string {
  if (!phone) return '';
  const cleaned = phone.replace(/\D/g, '');

  // 휴대폰 11자리: 010-XXXX-XXXX
  if (cleaned.length === 11 && cleaned.startsWith('01')) {
    return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 7)}-${cleaned.slice(7)}`;
  }
  // 휴대폰 10자리 (구형): 01X-XXX-XXXX
  if (cleaned.length === 10 && cleaned.startsWith('01')) {
    return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  }
  // 서울 02 (9자리): 02-XXX-XXXX
  if (cleaned.length === 9 && cleaned.startsWith('02')) {
    return `${cleaned.slice(0, 2)}-${cleaned.slice(2, 5)}-${cleaned.slice(5)}`;
  }
  // 서울 02 (10자리): 02-XXXX-XXXX
  if (cleaned.length === 10 && cleaned.startsWith('02')) {
    return `${cleaned.slice(0, 2)}-${cleaned.slice(2, 6)}-${cleaned.slice(6)}`;
  }
  // 대표번호 8자리 (15XX, 16XX, 18XX): 1XXX-XXXX
  if (cleaned.length === 8 && cleaned.startsWith('1')) {
    return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`;
  }
  // 기타 지역번호 10자리: 0XX-XXX-XXXX
  if (cleaned.length === 10 && cleaned.startsWith('0')) {
    return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  }
  // 기타 지역번호 11자리: 0XX-XXXX-XXXX
  if (cleaned.length === 11 && cleaned.startsWith('0')) {
    return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 7)}-${cleaned.slice(7)}`;
  }
  return phone;
}
