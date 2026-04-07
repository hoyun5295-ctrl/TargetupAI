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
  // ★ YYMMDD 날짜 보호: 6자리 숫자가 유효한 날짜 범위면 포맷팅 제외 (260331 → 260,331 방지)
  if (/^\d{6}$/.test(str)) {
    const mm = parseInt(str.slice(2, 4));
    const dd = parseInt(str.slice(4, 6));
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) return str;
  }
  // ★ YYYYMMDD 날짜 보호: 8자리도 동일 (20260331 → 20,260,331 방지)
  if (/^\d{8}$/.test(str)) {
    const mm = parseInt(str.slice(4, 6));
    const dd = parseInt(str.slice(6, 8));
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) return str;
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

/**
 * ★ D98 CT: MMS 이미지 serverPath → API URL 변환 (컨트롤타워)
 * DB에 저장된 절대경로를 브라우저에서 접근 가능한 API URL로 변환
 * 사용처: Dashboard.tsx(템플릿 불러오기), ResultsModal.tsx(발송결과 미리보기)
 */
export function mmsServerPathToUrl(serverPath: string): string {
  const parts = serverPath.replace(/\\/g, '/').split('/');
  const filename = parts[parts.length - 1];
  const companyDir = parts[parts.length - 2];
  return filename && companyDir ? `/api/mms-images/${companyDir}/${filename}` : serverPath;
}

/** 직접발송 파일매핑 필드 목록 (phone 제외) */
export const DIRECT_MAPPING_FIELDS: { key: string; label: string }[] = [
  { key: 'name', label: '이름' },
  { key: 'callback', label: '회신번호' },
  { key: 'extra1', label: '기타1' },
  { key: 'extra2', label: '기타2' },
  { key: 'extra3', label: '기타3' },
];

/**
 * ★ D101: 날짜 값을 한국어 포맷으로 변환 (프론트 전용)
 * YYYY-MM-DD, YYYYMMDD, YYMMDD, ISO 타임스탬프 모두 처리
 * 백엔드 messageUtils.ts formatDateValue와 동일 로직 (프론트/백엔드 일치 보장)
 */
function formatDatePreview(val: any): string {
  if (val == null || val === '') return '';
  const str = String(val).trim();
  // 순수 YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return formatDate(str);
  // ISO 타임스탬프
  if (/^\d{4}-\d{2}-\d{2}(T|\s)/.test(str)) {
    const d = safeParse(str);
    if (!isNaN(d.getTime())) return d.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
    return formatDate(str.slice(0, 10));
  }
  // YYYYMMDD 8자리
  if (/^\d{8}$/.test(str)) {
    const y = parseInt(str.substring(0, 4));
    const m = parseInt(str.substring(4, 6));
    const d = parseInt(str.substring(6, 8));
    if (y > 0 && m >= 1 && m <= 12 && d >= 1 && d <= 31) return `${y}. ${m}. ${d}.`;
  }
  // YYMMDD 6자리
  if (/^\d{6}$/.test(str)) {
    const yy = parseInt(str.substring(0, 2));
    const m = parseInt(str.substring(2, 4));
    const d = parseInt(str.substring(4, 6));
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      const y = yy >= 0 && yy <= 50 ? 2000 + yy : 1900 + yy;
      return `${y}. ${m}. ${d}.`;
    }
  }
  return str;
}

/**
 * ★ D101: 숫자 값을 천단위 쉼표 포맷 (소수점 제거)
 */
function formatNumberPreview(val: any): string {
  if (val == null || val === '') return '';
  const str = String(val).trim();
  // 0으로 시작하는 순수 숫자 (전화번호) — 포맷팅 제외
  if (/^0\d+$/.test(str.replace(/,/g, ''))) return str;
  // ★ D104: YYMMDD/YYYYMMDD 날짜 보호 (data_type 오감지 대응)
  if (/^\d{6}$/.test(str)) {
    const mm = parseInt(str.slice(2, 4)), dd = parseInt(str.slice(4, 6));
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) return str;
  }
  if (/^\d{8}$/.test(str)) {
    const mm = parseInt(str.slice(4, 6)), dd = parseInt(str.slice(6, 8));
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) return str;
  }
  // 하이픈 포함 숫자열 (전화번호 형태) — 포맷팅 제외
  if (/^\d[\d-]+\d$/.test(str) && str.includes('-')) return str;
  const num = Number(str.replace(/,/g, ''));
  if (!isNaN(num) && Number.isFinite(num)) return num.toLocaleString('ko-KR');
  return str;
}

/**
 * ★ D101: 필드 data_type 기반 포맷팅 (type-aware)
 * date → formatDatePreview, number → formatNumberPreview, 기타 → formatPreviewValue
 */
export function formatByType(val: any, dataType?: string): string {
  if (val == null || val === '') return '';
  if (dataType === 'date') return formatDatePreview(val);
  if (dataType === 'number') return formatNumberPreview(val);
  return formatPreviewValue(val);
}

/**
 * ★ B+0407-1: enum 필드 DB값 → 표시용 한글 역변환 (백엔드 standard-field-map.ts와 동기화)
 *
 * DB는 정규화된 enum 값을 저장하지만 미리보기/메시지에는 한글로 표시.
 * 사용처: replaceMessageVars (메시지 변수 치환 시)
 *
 * ⚠️ 백엔드 standard-field-map.ts FIELD_DISPLAY_MAP과 반드시 동기화 유지.
 */
export const FRONT_FIELD_DISPLAY_MAP: Record<string, Record<string, string>> = {
  gender: {
    m: '남성', f: '여성',
    male: '남성', female: '여성',
    남: '남성', 여: '여성',
  },
};

export function reverseDisplayValueFront(fieldKey: string, dbValue: any): string {
  if (dbValue === null || dbValue === undefined) return '';
  const map = FRONT_FIELD_DISPLAY_MAP[fieldKey];
  if (!map) return String(dbValue);
  const key = String(dbValue).trim().toLowerCase();
  return map[key] || String(dbValue);
}

export function replaceMessageVars(
  text: string,
  fields: { field_key: string; field_label?: string; display_name?: string; data_type?: string; field_type?: string }[],
  customerData: Record<string, any>,
  options?: { removeUnmatched?: boolean; extraReplacements?: Record<string, string> }
): string {
  if (!text) return text;
  let result = text;

  // regex 특수문자 이스케이프 (라벨에 괄호 등 포함 시 에러 방지)
  const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // ★ D101: field_key → data_type 매핑 생성 (column 키 치환 시에도 타입 인식)
  const typeMap: Record<string, string> = {};
  for (const f of fields) {
    const dt = f.data_type || (f.field_type ? f.field_type.toLowerCase() : undefined);
    if (dt) typeMap[f.field_key] = dt;
  }

  // ★ B+0407-1: enum 필드 우선 역변환 (gender 'F' → '여성'). formatByType보다 먼저 적용.
  const renderValue = (fieldKey: string | undefined, val: any, dt: string | undefined): string => {
    if (fieldKey && FRONT_FIELD_DISPLAY_MAP[fieldKey]) {
      return reverseDisplayValueFront(fieldKey, val);
    }
    return formatByType(val, dt);
  };

  // 필드 정의 기반 치환 (field_label → field_key 매핑)
  for (const f of fields) {
    const label = f.field_label || f.display_name || f.field_key;
    const val = customerData[f.field_key];
    const dt = f.data_type || (f.field_type ? f.field_type.toLowerCase() : undefined);
    if (label && val != null) {
      result = result.replace(new RegExp(`%${escapeRegex(label)}%`, 'g'), renderValue(f.field_key, val, dt));
    }
  }

  // column 키로도 치환 (sampleCustomer가 column 키일 때 호환)
  for (const [k, v] of Object.entries(customerData)) {
    if (v != null) {
      result = result.replace(new RegExp(`%${escapeRegex(k)}%`, 'g'), renderValue(k, v, typeMap[k]));
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

/**
 * ★ D99: 수신자의 개별회신번호 값 추출 — 컨트롤타워
 * individualCallbackColumn이 지정되면 해당 컬럼에서 회신번호 추출.
 * custom_fields JSONB 내부 키(custom_1~15)도 지원.
 *
 * 적용: Dashboard.tsx executeTargetSend (recipients + customMessages 2곳)
 */
export function resolveRecipientCallback(
  recipient: any,
  useIndividualCallback: boolean,
  individualCallbackColumn: string
): string | null {
  if (!useIndividualCallback || !individualCallbackColumn) {
    return recipient.callback || null;
  }
  return recipient[individualCallbackColumn]
    || (recipient.custom_fields && individualCallbackColumn.startsWith('custom_')
        ? recipient.custom_fields[individualCallbackColumn]
        : null)
    || null;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ★ D102: (광고)+080 프론트 컨트롤타워
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 메시지에 (광고) 접두사 + 무료거부/무료수신거부 접미사 추가 (프론트 미리보기/바이트계산용)
 *
 * 백엔드 messageUtils.ts의 buildAdMessage()와 동일한 로직.
 * 8곳 이상에서 인라인으로 반복되던 코드를 이 함수 하나로 통합.
 *
 * @param message      순수 본문 (광고 미포함)
/**
 * ★ D103: 전화번호 형태 값 판별 (프론트용)
 * 파일 업로드 시 전화번호 컬럼만 회신번호 드롭다운에 표시하기 위한 컨트롤타워.
 * 백엔드 callback-filter.ts의 isPhoneLikeValue와 동일 로직.
 */
export function isPhoneLikeValue(value: any): boolean {
  if (value == null || value === '') return false;
  const str = String(value).trim();
  const cleaned = str.replace(/[\s\-\(\)\.]/g, '');
  if (!/^\d+$/.test(cleaned)) return false;
  if (cleaned.length < 7 || cleaned.length > 15) return false;
  // ★ D106: 날짜 패턴 제외 (19950301, 20260403 등이 1xxx 대표번호 패턴에 오매칭 방지)
  if (/^(19|20)\d{6}$/.test(cleaned)) return false;
  return /^(01[016789]|02|0[3-6]\d|050\d|070|080|1[0-9]{3})/.test(cleaned);
}

/**
 * ★ D103: 파일 업로드 시 전화번호 형태 헤더 감지
 * 첫 번째 데이터 행의 값이 전화번호 형태인 헤더만 반환.
 */
export function detectPhoneHeaders(headers: string[], data: Record<string, any>[]): string[] {
  if (!headers.length || !data.length) return [];
  return headers.filter(h => {
    const values = data.slice(0, 10).map(row => row[h]).filter(v => v != null && String(v).trim() !== '');
    if (values.length === 0) return false;
    const phoneCount = values.filter(v => isPhoneLikeValue(v)).length;
    return phoneCount / values.length >= 0.5;
  });
}

/** @param msgType      'SMS' | 'LMS' | 'MMS'
 * @param isAd         광고 여부
 * @param optOutNumber 080 수신거부번호
 * @returns (광고)+본문+무료거부 조합 메시지. 광고 아니면 원본 반환.
 */
export function buildAdMessageFront(
  message: string,
  msgType: string,
  isAd: boolean,
  optOutNumber: string
): string {
  if (!isAd || !optOutNumber) return message;

  const isSms = msgType === 'SMS';
  const adPrefix = isSms ? '(광고)' : '(광고) ';
  const rejectFooter = isSms
    ? `\n무료거부${optOutNumber.replace(/-/g, '')}`
    : `\n무료수신거부 ${optOutNumber}`;

  return `${adPrefix}${message}${rejectFooter}`;
}

/**
 * ★ B2: 캠페인 표시용 메시지 컨트롤타워
 *
 * 발송 결과/캘린더/슈퍼관리자/대시보드/자동발송 등 모든 표시 경로에서
 * "(광고)+080번호" 부착된 최종 메시지를 일관되게 생성한다.
 *
 * 데이터 출처 우선순위:
 *  1) realSentMessage (MySQL msg_contents 등 이미 발송된 텍스트) → 그대로 사용
 *     (prepareSendMessage 거쳐 큐에 INSERT됐으므로 이미 (광고)+080 포함 상태)
 *  2) campaign.message_content (DB 순수본문) → buildAdMessageFront 로 (광고)+080 부착
 *
 * ⚠️ 절대 금지:
 *  - 4번째 인자 자리에 callback_number(회신번호) 전달 금지 (D106 재발 패턴)
 *  - 표시 경로에서 buildAdMessageFront 직접 호출 금지 — 반드시 이 함수를 통할 것
 *
 * @param campaign - opt_out_080_number 포함된 캠페인 객체 (백엔드에서 LEFT JOIN으로 내려옴)
 * @param realSentMessage - MySQL에 INSERT된 실제 발송 텍스트 (있으면 우선)
 */
export function formatCampaignMessageForDisplay(
  campaign: {
    message_content?: string | null;
    message_type?: string | null;
    is_ad?: boolean | null;
    opt_out_080_number?: string | null;
  } | null | undefined,
  realSentMessage?: string | null
): string {
  if (realSentMessage) return realSentMessage;
  if (!campaign) return '';
  return buildAdMessageFront(
    campaign.message_content || '',
    campaign.message_type || 'SMS',
    campaign.is_ad || false,
    campaign.opt_out_080_number || ''
  );
}
