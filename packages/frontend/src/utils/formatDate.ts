// ★ D89: 날짜 포맷팅 유틸 — 순수 날짜(YYYY-MM-DD)는 UTC 변환 없이 직접 파싱

/**
 * ★ B2(0417 PDF #2): MMS 발송 전 이미지 첨부 검증 컨트롤타워
 *   MMS 유형 선택 후 이미지 0장인 상태로 발송 시 과금 혼동(MMS 단가) 발생 → 차단.
 *   5개 발송 경로(직접/직접타겟/한줄로AI/맞춤한줄/자동발송) 전부 동일 검증.
 *
 * @param msgType 'SMS' | 'LMS' | 'MMS' | 'S' | 'L' | 'M' | 기타
 * @param imageCount 첨부된 MMS 이미지 수
 * @returns 에러 메시지(차단 필요 시) 또는 null(통과)
 */
export function validateMmsBeforeSend(msgType: string | undefined | null, imageCount: number): string | null {
  const isMms = msgType === 'MMS' || msgType === 'M';
  if (isMms && (!imageCount || imageCount === 0)) {
    return 'MMS는 이미지 첨부가 필수입니다. 이미지를 업로드하거나 발송타입을 SMS/LMS로 변경해주세요.';
  }
  return null;
}


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
/**
 * ★ D111: 숫자 포맷팅 컨트롤타워 (프론트)
 *
 * 백엔드 backend/utils/format-number.ts 의 formatNumericLike 와 **완전 동일한 규칙**.
 * 규칙 변경 시 반드시 양쪽 동시 수정 — 한쪽만 고치면 미리보기/실전송 불일치 재발.
 *
 * 정책 (Harold님 확정):
 *   - 정수 그대로 (강제 소수점 금지): 50000 → "50,000" (NOT "50,000.00")
 *   - trailing zero 제거: 50000.00 → "50,000"
 *   - 유효 소수 보존: 50000.5 → "50,000.5", 50000.55 → "50,000.55"
 *   - 전화번호(0시작/하이픈) 제외
 *   - YYMMDD / YYYYMMDD 날짜 제외 (월/일 범위 검증)
 *
 * 숫자로 포맷 가능하면 문자열, 아니면 null 반환.
 */
export function formatNumericLike(value: any): string | null {
  if (value === null || value === undefined) return null;

  if (typeof value === 'number') {
    if (!isFinite(value)) return null;
    return formatFiniteNumberFront(value);
  }

  const str = String(value).trim();
  if (!str) return null;

  // 1. 전화번호 제외: 0 시작 순수 숫자
  if (/^0\d+$/.test(str)) return null;

  // 2. 하이픈 포함 숫자열 제외 (1800-8125 등)
  if (/^\d[\d-]+\d$/.test(str) && str.includes('-')) return null;

  // 3. 쉼표 제거 후 정수/소수 패턴 매칭
  const clean = str.replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(clean)) return null;

  // 4. YYMMDD 날짜 → 날짜 문자열 반환 (PPT#1: 백엔드 format-number.ts와 동기화)
  if (/^\d{6}$/.test(clean)) {
    const mm = parseInt(clean.slice(2, 4), 10);
    const dd = parseInt(clean.slice(4, 6), 10);
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      const yy = parseInt(clean.slice(0, 2), 10);
      const yyyy = yy >= 50 ? 1900 + yy : 2000 + yy;
      return `${yyyy}.${String(mm).padStart(2, '0')}.${String(dd).padStart(2, '0')}`;
    }
  }

  // 5. YYYYMMDD 날짜 → 날짜 문자열 반환 (PPT#1: 백엔드 format-number.ts와 동기화)
  if (/^\d{8}$/.test(clean)) {
    const mm = parseInt(clean.slice(4, 6), 10);
    const dd = parseInt(clean.slice(6, 8), 10);
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return `${clean.slice(0, 4)}.${clean.slice(4, 6)}.${clean.slice(6, 8)}`;
    }
  }

  const num = Number(clean);
  if (isNaN(num) || !isFinite(num)) return null;
  return formatFiniteNumberFront(num);
}

function formatFiniteNumberFront(num: number): string {
  if (Number.isInteger(num)) {
    return num.toLocaleString('ko-KR');
  }
  const [intPart, decPart] = num.toString().split('.');
  const intFormatted = Number(intPart).toLocaleString('ko-KR');
  return decPart ? `${intFormatted}.${decPart}` : intFormatted;
}

// ★ D120: 필드명 키워드 기반 숫자/날짜 판정 — 금액 필드의 6/8자리 숫자를 날짜로 잘못 변환하는 버그 방지
const NUMERIC_FIELD_KEYWORDS = ['금액', '구매', '매출', '포인트', '잔액', '가격', '횟수', '건수', '카운트', '수량', '비용', '평균', '합계', '총액', 'amount', 'price', 'count', 'point'];
const DATE_FIELD_KEYWORDS = ['생일', '생년월일', '가입일', '구매일', '날짜', '등록일', '방문일', '기념일', '결혼', 'date', 'birth'];

function isNumericFieldByLabel(label: string): boolean {
  const lower = label.toLowerCase();
  return NUMERIC_FIELD_KEYWORDS.some(k => lower.includes(k));
}

function isDateFieldByLabel(label: string): boolean {
  const lower = label.toLowerCase();
  return DATE_FIELD_KEYWORDS.some(k => lower.includes(k));
}

export function formatPreviewValue(val: any, opts?: { fieldLabel?: string; fieldKey?: string }): string {
  if (val == null || val === '') return '';
  // ★ D136 (D7-2): 커스텀필드는 고객사 업로드 원본 그대로 표시 — 숫자 콤마/날짜 변환 금지
  //   Harold님 원칙: 고정필드(FIELD_MAP column)만 매핑된 형식으로 보여주고, custom_1~15는 고객 데이터 훼손 금지.
  //   14자리 varchar "20260416150000" → "20,260,416,150,000" 콤마 적용되던 버그 차단.
  if (opts?.fieldKey?.startsWith('custom_')) return String(val);
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
  // ★ D120: 필드명 키워드가 전달되면 숫자/날짜 판정 — 6/8자리 모호한 숫자 처리
  // fieldLabel이 없으면 기존 동작 100% 유지 (하위호환)
  if (opts?.fieldLabel) {
    if (isNumericFieldByLabel(opts.fieldLabel)) {
      // 금액/포인트/횟수 키워드 → 6/8자리 날짜 변환 스킵, 숫자 포맷팅만
      const clean = str.replace(/,/g, '');
      if (/^0\d+$/.test(clean)) return clean; // 0으로 시작 보호
      const num = Number(clean);
      if (!isNaN(num)) {
        if (Number.isInteger(num)) return num.toLocaleString('ko-KR');
        const [intPart, decPart] = num.toString().split('.');
        return Number(intPart).toLocaleString('ko-KR') + (decPart ? '.' + decPart : '');
      }
      return str;
    }
    // 날짜 키워드 → 기존 6/8자리 날짜 변환 진행 (아래로 fall-through)
  }
  // ★ PPT#1: YYYYMMDD 8자리 날짜 패턴 → 날짜 형태로 표시 (커스텀필드 숫자처리 방지)
  if (/^\d{8}$/.test(str)) {
    const mm = parseInt(str.slice(4, 6), 10);
    const dd = parseInt(str.slice(6, 8), 10);
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return formatDate(`${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)}`);
    }
  }
  // ★ PPT#1: YYMMDD 6자리 날짜 패턴 → 날짜 형태로 표시
  if (/^\d{6}$/.test(str)) {
    const mm = parseInt(str.slice(2, 4), 10);
    const dd = parseInt(str.slice(4, 6), 10);
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      const yy = parseInt(str.slice(0, 2), 10);
      const yyyy = yy >= 50 ? 1900 + yy : 2000 + yy;
      return formatDate(`${yyyy}-${str.slice(2, 4)}-${str.slice(4, 6)}`);
    }
  }
  // ★ D111: 숫자/전화/YYMMDD 처리를 formatNumericLike 컨트롤타워로 통합
  //   이전: 인라인으로 정수/소수/전화번호/YYMMDD 규칙이 중복 구현됨 → 백엔드와 불일치 발생
  const fmt = formatNumericLike(str);
  return fmt !== null ? fmt : str;
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
 * ★ D137: 파일명용 압축 타임스탬프 `YYYYMMDDHHmmss` (14자)
 * 이전 inline 패턴 `toISOString().replace(/[-:T]/g, '')`가 Tailwind JIT에
 * arbitrary value(`-: T;`)로 오스캔되어 CSS 빌드 WARNING 발생 → 컨트롤타워화.
 * 사용처: CustomerDBModal 등 파일 다운로드 시 파일명 suffix.
 */
export function compactTimestamp(date: Date = new Date()): string {
  const iso = date.toISOString().slice(0, 19); // YYYY-MM-DDTHH:mm:ss
  const y = iso.slice(0, 4);
  const mo = iso.slice(5, 7);
  const d = iso.slice(8, 10);
  const h = iso.slice(11, 13);
  const mi = iso.slice(14, 16);
  const s = iso.slice(17, 19);
  return `${y}${mo}${d}${h}${mi}${s}`;
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
  // ★ D141 B3 심화: recipient null/undefined 가드 — 컨트롤타워 자체 안전망
  //   D109 원칙: "데이터 출처 시점에서 안전 처리하여 모든 호출부 자동 보호"
  //   현재 호출부(DirectSendPanel, DirectPreviewModal)는 외부 가드 있지만,
  //   향후 호출부 추가 시 가드 누락으로 인한 흰화면 사고 재발 차단.
  if (!text || !recipient) return text;
  let result = text;
  for (const { variable, fieldKey, label } of DIRECT_VAR_MAP) {
    const val = recipient[fieldKey];
    const hasVal = val != null && String(val).trim();
    // ★ D123: 직접발송은 고객이 올린 데이터 그대로 출력 (숫자 콤마 자동변환 안 함)
    let displayVal: string;
    if (hasVal) {
      displayVal = String(val).trim();  // 원본 그대로 — formatPreviewValue 제거
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
 * ★ D111: 숫자 포맷 — formatNumericLike 컨트롤타워 호출 1줄로 통합
 *   이전: 인라인으로 정수/소수/전화번호/YYMMDD 규칙이 중복 구현됨 (formatPreviewValue와 불일치)
 *   변경: 공용 컨트롤타워로 규칙 한 곳에서 관리
 */
function formatNumberPreview(val: any): string {
  if (val == null || val === '') return '';
  const str = String(val).trim();
  const fmt = formatNumericLike(str);
  return fmt !== null ? fmt : str;
}

/**
 * ★ D101: 필드 data_type 기반 포맷팅 (type-aware)
 * date → formatDatePreview, number → formatNumberPreview, 기타 → formatPreviewValue
 *
 * ★ D136 (D7-2 Harold님 원칙): 3번째 인자 fieldKey 추가.
 *   커스텀필드(custom_1~15)는 고객사 업로드 원본 그대로 표시.
 *   data_type 무시하고 String(val) 반환 — 숫자 콤마/날짜 변환/포맷팅 금지.
 *   고정필드(FIELD_MAP column)만 매핑된 형식으로 포맷팅.
 */
export function formatByType(val: any, dataType?: string, fieldKey?: string): string {
  if (val == null || val === '') return '';
  // 커스텀필드: 원본 그대로 (Harold님 원칙 — 고객사 데이터 훼손 금지)
  if (fieldKey && fieldKey.startsWith('custom_')) return String(val);
  if (dataType === 'date') return formatDatePreview(val);
  if (dataType === 'number') return formatNumberPreview(val);
  return formatPreviewValue(val, { fieldKey });
}

/**
 * ★ B+0407-1: enum 필드 DB값 → 표시용 한글 역변환 (백엔드 standard-field-map.ts와 동기화)
 *
 * DB는 정규화된 enum 값을 저장하지만 미리보기/메시지에는 한글로 표시.
 * 사용처: replaceMessageVars (메시지 변수 치환 시)
 *
 * ⚠️ 백엔드 standard-field-map.ts FIELD_DISPLAY_MAP과 반드시 동기화 유지.
 */
// ★ D114 P5b: field key → 한글 표시명 매핑 (RecommendTemplateModal 등에서 사용)
export const FIELD_KEY_DISPLAY_MAP: Record<string, string> = {
  name: '고객명', phone: '전화번호', gender: '성별', age: '나이',
  birth_date: '생일', email: '이메일', address: '주소', region: '지역',
  grade: '등급', points: '포인트', sms_opt_in: '수신동의',
  recent_purchase_date: '최근구매일', recent_purchase_amount: '최근구매금액',
  total_purchase_amount: '누적구매금액', purchase_count: '구매횟수',
  recent_purchase_store: '최근구매매장', registered_store: '등록매장',
  registration_type: '등록유형', store_code: '매장코드',
  store_name: '매장명', store_phone: '매장전화번호',
};

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
  // ★ D141 B3 심화: customerData null/undefined 가드 — 컨트롤타워 자체 안전망
  //   D109 원칙: "데이터 출처 시점에서 안전 처리하여 모든 호출부 자동 보호"
  //   호출부 3곳(AiCustomSendFlow 2곳 + AutoSendFormModal)에서 sampleData/sc/spamSampleCustomer가
  //   undefined인 시점이 있으면 customerData[fieldKey] 또는 Object.entries 접근으로 흰화면 사고.
  if (!text) return text;
  const data = customerData || {};
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
  // ★ D136 (D7-2): fieldKey 전달 — 커스텀필드(custom_1~15)는 formatByType에서 원본 그대로 반환.
  const renderValue = (fieldKey: string | undefined, val: any, dt: string | undefined): string => {
    if (fieldKey && FRONT_FIELD_DISPLAY_MAP[fieldKey]) {
      return reverseDisplayValueFront(fieldKey, val);
    }
    return formatByType(val, dt, fieldKey);
  };

  // 필드 정의 기반 치환 (field_label → field_key 매핑)
  for (const f of fields) {
    const label = f.field_label || f.display_name || f.field_key;
    const val = data[f.field_key];
    const dt = f.data_type || (f.field_type ? f.field_type.toLowerCase() : undefined);
    if (label && val != null) {
      result = result.replace(new RegExp(`%${escapeRegex(label)}%`, 'g'), renderValue(f.field_key, val, dt));
    }
  }

  // column 키로도 치환 (sampleCustomer가 column 키일 때 호환)
  for (const [k, v] of Object.entries(data)) {
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

// ============================================================
// ★ B+0407-1: 변수 치환 통합 컨트롤타워 (인라인 replaceVars 7곳 통합)
// ============================================================
//
// 기존: 직접발송/직접타겟발송/AI 미리보기 등 7개 컴포넌트에 동일 패턴의
//       인라인 `replaceVars` 함수가 산재 → enum 역변환(gender F→여성) 누락,
//       숫자 포맷팅 누락, 컴포넌트별 동작 불일치.
//
// 통합: 아래 두 컨트롤타워 + 기존 replaceMessageVars / replaceDirectVars 4개로 통일.
//
// ⚠️ 절대 금지:
//   - 컴포넌트에 새 인라인 replaceVars 작성 금지
//   - 반드시 아래 4개 함수 중 하나를 import 해서 사용

/**
 * 패턴 A — FieldMeta 기반 치환 (직접타겟발송/일부 직접발송 미리보기·스팸필터·바이트계산용)
 *
 * 입력 fieldsMeta: [{ field_key, variable, data_type?, display_name? }, ...]
 * recipient: 고객 1명 (DB row + custom_fields flat)
 *
 * 처리 순서:
 *   1) recipient[field_key] 우선 (custom_fields fallback)
 *   2) FRONT_FIELD_DISPLAY_MAP[field_key] 매칭 → enum 역변환 (gender F→여성)
 *   3) formatByType(val, data_type) → 숫자/날짜 포맷팅
 *   4) fallback=true이면 빈 값일 때 display_name으로 대체 (미리보기용 라벨 표시)
 *
 * 사용처: DirectPreviewModal.replaceVarsWithMeta, TargetSendModal.replaceVars
 */
export interface ReplaceVarsFieldMeta {
  field_key: string;
  variable: string;
  data_type?: string;
  display_name?: string;
}

export function replaceVarsByFieldMeta(
  text: string,
  recipient: any,
  fieldsMeta: ReplaceVarsFieldMeta[],
  options?: { fallback?: boolean }
): string {
  if (!text || !recipient) return text;
  const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const fallback = options?.fallback ?? false;
  let result = text;

  fieldsMeta.forEach(fm => {
    if (fm.field_key === 'phone' || fm.field_key === 'sms_opt_in') return;
    const pattern = new RegExp(escapeRegex(fm.variable), 'g');
    let rawValue = recipient[fm.field_key];
    if ((rawValue == null || rawValue === '') && recipient.custom_fields && typeof recipient.custom_fields === 'object') {
      rawValue = recipient.custom_fields[fm.field_key];
    }

    let display: string;
    if (rawValue != null && rawValue !== '') {
      // ★ enum 필드(gender F→여성) 역변환 우선
      if (FRONT_FIELD_DISPLAY_MAP[fm.field_key]) {
        display = reverseDisplayValueFront(fm.field_key, rawValue);
      } else {
        // ★ D136 (D7-2): fieldKey 전달 — 커스텀필드 원본 그대로 반환
        display = formatByType(rawValue, fm.data_type, fm.field_key);
      }
    } else {
      display = fallback ? (fm.display_name || fm.field_key) : '';
    }
    result = result.replace(pattern, display);
  });

  return result;
}

/**
 * 패턴 C — sampleCustomer(displayName 한국어 키) 기반 치환 (한줄로 AI 결과/미리보기용)
 *
 * 입력 sampleCustomer: { "이름": "김철수", "고객등급": "VIP", "성별": "F", ... }
 * 키가 한국어 라벨이거나 column 키 둘 다 가능.
 *
 * 처리:
 *   1) sampleCustomer 모든 키를 %키%로 치환 — formatPreviewValue로 포맷팅
 *   2) FRONT_FIELD_DISPLAY_MAP — sampleCustomer에 column 키('gender')가 있으면 역변환
 *   3) aliasMap 적용 (예: 이름 → 고객명, 성함)
 *   4) removeUnmatched=true이면 잔여 %변수% 제거
 *
 * 사용처: AiCampaignResultPopup.replaceVars, AiPreviewModal.replaceVars
 */
export function replaceVarsBySampleCustomer(
  text: string,
  sampleCustomer: Record<string, any> | null | undefined,
  options?: {
    removeUnmatched?: boolean;
    aliasMap?: Record<string, string[]>; // 한국어 라벨 → 별칭 배열 (예: { "이름": ["고객명","성함"] })
  }
): string {
  if (!text) return text;
  const sc = sampleCustomer || {};
  let result = text;
  const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // 1) sampleCustomer 직접 치환
  Object.entries(sc).forEach(([k, v]) => {
    if (v == null) return;
    // enum 필드(column 키) 역변환 우선
    const display = FRONT_FIELD_DISPLAY_MAP[k]
      ? reverseDisplayValueFront(k, v)
      : formatPreviewValue(v);
    result = result.replace(new RegExp(`%${escapeRegex(k)}%`, 'g'), display);
  });

  // 2) aliasMap 적용 (예: sc["이름"] = "김철수"이면 %고객명%, %성함%도 치환)
  if (options?.aliasMap) {
    Object.entries(options.aliasMap).forEach(([realKey, aliases]) => {
      const val = sc[realKey];
      if (val == null) return;
      const display = FRONT_FIELD_DISPLAY_MAP[realKey]
        ? reverseDisplayValueFront(realKey, val)
        : formatPreviewValue(val);
      aliases.forEach(a => {
        result = result.replace(new RegExp(`%${escapeRegex(a)}%`, 'g'), display);
      });
    });
  }

  // 3) 잔여 %변수% 제거
  if (options?.removeUnmatched !== false) {
    result = result.replace(/%[^%\s]{1,20}%/g, '');
  }

  return result;
}

/**
 * ★ D137 D5: 한국 전화번호 앞 0 자동 보정 + 정규화 컨트롤타워
 *   - 백엔드 utils/normalize.ts `normalizePhone` 의 보정 로직과 완전 동일 (미러)
 *   - 특수문자 제거 + 국가코드(+82/82) 변환 + 앞 0 보정 (휴대폰 + 서울/지방 지역번호 + 070/050X)
 *   - 유효성 검사는 하지 않음 (프론트는 입력 시점 보정 전용)
 *   - 사용처: DirectSendPanel 직접입력/파일등록 3곳
 *
 * 보정 규칙 (엑셀 숫자 저장 등으로 앞 0 빠진 경우만):
 *   - `2`  (8~10자리) → 02  (서울)
 *   - `1[016789]` → 01X (휴대폰 010/011/016/017/018/019)
 *   - `3[1-3]` → 031/032/033 (경기/인천/강원)
 *   - `4[1-4]` → 041/042/043/044 (충남/대전/충북/세종)
 *   - `5[1-5]` → 051/052/053/054/055 (부산/울산/대구/경북/경남)
 *   - `50[2-9]` → 0502~0509 (안심번호)
 *   - `6[1-4]` → 061/062/063/064 (전남/광주/전북/제주)
 *   - `70` → 070 (인터넷전화)
 *   - 위 prefix 에 해당 안 하면 건드리지 않음 (오변환 방지)
 */
export function normalizePhoneKr(value: any): string {
  if (value == null || value === '') return '';
  let v = String(value).trim();
  v = v.replace(/[\s\-()+.]/g, '');
  if (v.startsWith('+82')) v = '0' + v.slice(3);
  else if (v.startsWith('82')) v = '0' + v.slice(2);
  v = v.replace(/\D/g, '');
  if (!v.startsWith('0') && /^(2|1[016789]|3[1-3]|4[1-4]|5(?:[1-5]|0[2-9])|6[1-4]|70)\d{6,10}$/.test(v)) {
    v = '0' + v;
  }
  return v;
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
  // ★ D123 P6: 050X 인터넷전화 12자리 — 0504/0507 등: 050X-XXXX-XXXX
  if (cleaned.length === 12 && cleaned.startsWith('050')) {
    return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 8)}-${cleaned.slice(8)}`;
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
 * ★ D137 (0424): fallbackCallback 파라미터 추가 (optional, 하위호환).
 *   - 개별회신번호 OFF이거나 매핑 컬럼값 비었을 때 쓸 대체 번호.
 *   - DirectPreviewModal에서 selectedCallback(사용자가 드롭다운에서 선택한 기본 발신번호) 전달.
 *   - D137 이전 호출부(Dashboard.tsx executeTargetSend)는 파라미터 생략 시 기존 동작 유지.
 *
 * 적용: Dashboard.tsx executeTargetSend/executeDirectSend, DirectPreviewModal
 */
export function resolveRecipientCallback(
  recipient: any,
  useIndividualCallback: boolean,
  individualCallbackColumn: string,
  fallbackCallback?: string
): string | null {
  // ★ D141 B3: recipient null/undefined 가드
  //   보관함 → 메시지 적용 → 수신자 0명 상태에서 미리보기 클릭 시
  //   firstR=undefined가 그대로 들어와 `recipient.callback` 접근으로 TypeError 발생.
  //   React 트리 unmount → 흰 화면 → 새로고침 시 JWT 만료로 로그아웃 인식되던 문제.
  if (!recipient) {
    return fallbackCallback || null;
  }
  if (!useIndividualCallback || !individualCallbackColumn) {
    return recipient.callback || fallbackCallback || null;
  }
  return recipient[individualCallbackColumn]
    || (recipient.custom_fields && individualCallbackColumn.startsWith('custom_')
        ? recipient.custom_fields[individualCallbackColumn]
        : null)
    || fallbackCallback
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
  if (!isAd) return message;

  const isSms = msgType === 'SMS';
  const isLms = !isSms; // LMS/MMS
  const adPrefix = isSms ? '(광고)' : '(광고) ';

  // ★ D137 (0423 D2 근본): 백엔드 messageUtils.ts buildAdMessage와 완전 동일 규칙 (미러).
  //   - minBreaks=1 통일 (D136까지 LMS/MMS=2 강제 → D137 완화, 사용자 직접발송 빈 줄 제거)
  //   - 빈 줄은 고객 입력 또는 AI 원본 개행 (ai.ts 자동제거 regex `\n?` 제거로 보존)에 의해서만 발생
  //   - AI 문안이 이미 "무료수신거부 080..."을 포함하면 hasRejectFooter=true → 원본 유지
  const hasAdPrefix = message.startsWith('(광고)');
  const hasRejectFooter = /무료수신거부|무료거부/.test(message);

  const finalPrefix = hasAdPrefix ? '' : adPrefix;

  const trailingMatch = message.match(/\n*$/);
  const trailingCount = trailingMatch ? trailingMatch[0].length : 0;
  const minBreaks = 1;
  const actualBreaks = Math.max(trailingCount, minBreaks);

  const rejectText = optOutNumber
    ? (isSms ? `무료거부${optOutNumber.replace(/-/g, '')}` : `무료수신거부 ${optOutNumber}`)
    : (isSms ? `무료거부` : `무료수신거부`);

  const finalFooter = hasRejectFooter ? '' : `${'\n'.repeat(actualBreaks)}${rejectText}`;
  const body = finalFooter ? message.replace(/\n+$/, '') : message;

  return `${finalPrefix}${body}${finalFooter}`;
}

/**
 * ★ KISA 2026-05: LMS/MMS 제목에 (광고) 자동 부착 (프론트 미리보기/표시용)
 * - 백엔드 messageUtils.ts buildAdSubject와 동일 로직
 * - isAd=true + LMS/MMS일 때만 제목 앞에 "(광고) " 접두사
 * - 중복 방지: 이미 (광고)로 시작하면 안 붙임
 */
export function buildAdSubjectFront(subject: string, msgType: string, isAd: boolean): string {
  if (!isAd) return subject;
  if (msgType !== 'LMS' && msgType !== 'MMS') return subject;
  if (!subject) return '(광고)';
  if (subject.startsWith('(광고)')) return subject;
  return `(광고) ${subject}`;
}

/**
 * ★ B2 후속: D103 위반 데이터(message_content에 (광고)/무료거부가 이미 포함된 캠페인) 정규화
 *
 * 컨트롤타워가 표시 직전에 본문에서 (광고) 접두사 + 무료거부 푸터를 제거하여
 * 항상 "순수 본문" 상태로 만든 뒤, is_ad 플래그에 따라 다시 정확히 부착한다.
 *
 * 이로써:
 *  - is_ad=false 인데 본문에 (광고)가 박혀있는 D103 위반 데이터 → 표시 시 자동 제거
 *  - is_ad=true 인 정상 데이터 → strip 후 다시 정확히 부착
 *
 * 정규식은 backend buildAdMessage 가 만드는 정확한 패턴만 매칭 — 본문 내부 텍스트 훼손 방지.
 */
function stripAdParts(text: string): string {
  if (!text) return '';
  let result = text;
  // 끝의 무료수신거부 (LMS) 제거: "\n무료수신거부 080-xxx-xxxx"
  result = result.replace(/\s*\n?\s*무료수신거부\s*[\d-]+\s*$/g, '');
  // 끝의 무료거부 (SMS) 제거: "\n무료거부080xxxxxxxx"
  result = result.replace(/\s*\n?\s*무료거부\d+\s*$/g, '');
  // 시작의 (광고) prefix 제거 (양식: "(광고)" or "(광고) ")
  result = result.replace(/^\s*\(광고\)\s*/g, '');
  return result;
}

/**
 * ★ B2 → D137 D6: 캠페인 표시용 메시지 컨트롤타워
 *
 * 발송 결과/캘린더/슈퍼관리자/대시보드/자동발송 등 모든 표시 경로에서
 * "(광고)+080번호" 부착된 최종 메시지를 **일관되게** 생성한다.
 *
 * ★ D137 D6 근본 수정 — (광고)/무료거부 표시 불일치 3번째 재발(D102/D106/D109) 해결:
 *   - 기존: `if (realSentMessage) return realSentMessage;` → msg_contents 그대로 반환
 *     → MySQL 저장값이 경로별(프리셋/구버전/AI생성)로 (광고)/무료거부 포함여부 섞여 있으면
 *        "리스트에는 붙어있는데 상세에는 누락" 같은 불일치 발생
 *   - 변경: realSentMessage 도 **stripAdParts + buildAdMessageFront** 통과 →
 *          데이터 출처와 무관하게 **순수본문 + is_ad 기반 재부착** 으로 완전 일관
 *
 * 데이터 출처 우선순위 (통과하는 파이프라인은 동일):
 *  1) realSentMessage (MySQL msg_contents 등 실 발송 텍스트)
 *  2) campaign.message_content (DB 순수본문)
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
  // ★ D137 D6: realSentMessage / message_content 둘 다 동일 파이프라인 통과
  const source = realSentMessage || campaign?.message_content || '';
  if (!campaign) return source; // campaign 없으면 정규화 불가 — 원본 반환
  // D103 위반 데이터 및 msg_contents 에 박힌 (광고)/무료거부 흔적 제거 후 is_ad 기반 재부착
  const pureBody = stripAdParts(source);
  return buildAdMessageFront(
    pureBody,
    campaign.message_type || 'SMS',
    campaign.is_ad || false,
    campaign.opt_out_080_number || ''
  );
}
