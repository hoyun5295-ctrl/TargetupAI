/**
 * 데이터 정규화 — 한줄로 백엔드 `utils/normalize.ts` 컨트롤타워 미러
 *
 * ※ SoT: packages/backend/src/utils/normalize.ts
 *   엑셀 업로드(upload.ts → normalizeByFieldKey)와 싱크에이전트 동기화 결과를
 *   100% 일치시키기 위해 백엔드 normalize.ts 로직을 1:1 복제한다.
 *   백엔드에 정규화 규칙 변경 시 반드시 이 파일도 함께 갱신한다.
 *
 * 원칙 (feedback_mirror_hanjul_standard.md):
 *   Agent 정규화 로직은 반드시 한줄로 엑셀 업로드와 동일 결과를 보장해야 한다.
 */

import { getLogger } from '../logger';
import { FIELD_MAP, getFieldByKey } from './field-map';
import dayjs from 'dayjs';

const logger = getLogger('normalize');

// ============================================================
// 성별 정규화 — 표준값: 'M' | 'F'
// ============================================================
const GENDER_MAP: Record<string, string> = {
  'm': 'M', 'M': 'M',
  '남': 'M', '남자': 'M', '남성': 'M',
  'male': 'M', 'Male': 'M', 'MALE': 'M',
  '1': 'M', 'man': 'M', 'Man': 'M', 'MAN': 'M',
  'f': 'F', 'F': 'F',
  '여': 'F', '여자': 'F', '여성': 'F',
  'female': 'F', 'Female': 'F', 'FEMALE': 'F',
  '2': 'F', 'woman': 'F', 'Woman': 'F', 'WOMAN': 'F',
};

export function normalizeGender(value: any): string | null {
  if (value == null || value === '') return null;
  const v = String(value).trim();
  return GENDER_MAP[v] || null;
}

// ============================================================
// 등급 정규화 — 표준값: 'VVIP', 'VIP', 'GOLD', 'SILVER', 'BRONZE', 'NORMAL'
// ============================================================
const GRADE_MAP: Record<string, string> = {
  'VVIP': 'VVIP', 'vvip': 'VVIP', 'Vvip': 'VVIP',
  'VVIP고객': 'VVIP', 'VVIP회원': 'VVIP', 'VV': 'VVIP',
  'VIP': 'VIP', 'vip': 'VIP', 'Vip': 'VIP',
  'VIP고객': 'VIP', 'VIP회원': 'VIP', 'V': 'VIP',
  'vip고객': 'VIP', 'VIP등급': 'VIP',
  'GOLD': 'GOLD', 'gold': 'GOLD', 'Gold': 'GOLD',
  '골드': 'GOLD', '골드회원': 'GOLD', 'Gold회원': 'GOLD',
  'G': 'GOLD', 'GOLD등급': 'GOLD',
  'SILVER': 'SILVER', 'silver': 'SILVER', 'Silver': 'SILVER',
  '실버': 'SILVER', '실버회원': 'SILVER', 'Silver회원': 'SILVER',
  'S': 'SILVER', 'SILVER등급': 'SILVER',
  'BRONZE': 'BRONZE', 'bronze': 'BRONZE', 'Bronze': 'BRONZE',
  '브론즈': 'BRONZE', '브론즈회원': 'BRONZE', 'Bronze회원': 'BRONZE',
  'B': 'BRONZE', 'BRONZE등급': 'BRONZE',
  'NORMAL': 'NORMAL', 'normal': 'NORMAL', 'Normal': 'NORMAL',
  '일반': 'NORMAL', '일반회원': 'NORMAL', '일반고객': 'NORMAL',
  'REGULAR': 'NORMAL', 'regular': 'NORMAL', 'Regular': 'NORMAL',
  'STANDARD': 'NORMAL', 'standard': 'NORMAL',
  '기본': 'NORMAL', '기본회원': 'NORMAL', 'N': 'NORMAL',
};

export function normalizeGrade(value: any): string | null {
  if (value == null || value === '') return null;
  const v = String(value).trim();
  return GRADE_MAP[v] || v.toUpperCase(); // 매핑 없으면 대문자로 반환 (새로운 등급 허용)
}

// ============================================================
// 지역 정규화 — 표준값: 서울, 부산, ..., 제주
// ============================================================
const REGION_MAP: Record<string, string> = {
  '서울': '서울', '서울시': '서울', '서울특별시': '서울', 'Seoul': '서울', 'seoul': '서울', 'SEOUL': '서울',
  '부산': '부산', '부산시': '부산', '부산광역시': '부산', 'Busan': '부산', 'busan': '부산', 'BUSAN': '부산',
  '대구': '대구', '대구시': '대구', '대구광역시': '대구', 'Daegu': '대구', 'daegu': '대구', 'DAEGU': '대구',
  '인천': '인천', '인천시': '인천', '인천광역시': '인천', 'Incheon': '인천', 'incheon': '인천', 'INCHEON': '인천',
  '광주': '광주', '광주시': '광주', '광주광역시': '광주', 'Gwangju': '광주', 'gwangju': '광주', 'GWANGJU': '광주',
  '대전': '대전', '대전시': '대전', '대전광역시': '대전', 'Daejeon': '대전', 'daejeon': '대전', 'DAEJEON': '대전',
  '울산': '울산', '울산시': '울산', '울산광역시': '울산', 'Ulsan': '울산', 'ulsan': '울산', 'ULSAN': '울산',
  '세종': '세종', '세종시': '세종', '세종특별자치시': '세종', 'Sejong': '세종', 'sejong': '세종', 'SEJONG': '세종',
  '경기': '경기', '경기도': '경기', 'Gyeonggi': '경기', 'gyeonggi': '경기', 'GYEONGGI': '경기',
  '강원': '강원', '강원도': '강원', '강원특별자치도': '강원', 'Gangwon': '강원', 'gangwon': '강원', 'GANGWON': '강원',
  '충북': '충북', '충청북도': '충북', '충북도': '충북', 'Chungbuk': '충북', 'chungbuk': '충북', 'CHUNGBUK': '충북',
  '충남': '충남', '충청남도': '충남', '충남도': '충남', 'Chungnam': '충남', 'chungnam': '충남', 'CHUNGNAM': '충남',
  '전북': '전북', '전라북도': '전북', '전북도': '전북', '전북특별자치도': '전북', 'Jeonbuk': '전북', 'jeonbuk': '전북', 'JEONBUK': '전북',
  '전남': '전남', '전라남도': '전남', '전남도': '전남', 'Jeonnam': '전남', 'jeonnam': '전남', 'JEONNAM': '전남',
  '경북': '경북', '경상북도': '경북', '경북도': '경북', 'Gyeongbuk': '경북', 'gyeongbuk': '경북', 'GYEONGBUK': '경북',
  '경남': '경남', '경상남도': '경남', '경남도': '경남', 'Gyeongnam': '경남', 'gyeongnam': '경남', 'GYEONGNAM': '경남',
  '제주': '제주', '제주도': '제주', '제주시': '제주', '제주특별자치도': '제주', 'Jeju': '제주', 'jeju': '제주', 'JEJU': '제주',
};

export function normalizeRegion(value: any): string | null {
  if (value == null || value === '') return null;
  const v = String(value).trim();
  return REGION_MAP[v] || v;
}

// ============================================================
// 수신동의 정규화 — 표준값: true / false
// ============================================================
const SMS_OPT_IN_TRUE = new Set([
  'true', 'Y', 'y', 'yes', 'YES', 'Yes',
  '동의', '수신동의', '수신 동의', '동의함', '수신동의함',
  '1', 'O', 'o', 'T', 't',
]);
const SMS_OPT_IN_FALSE = new Set([
  'false', 'N', 'n', 'no', 'NO', 'No',
  '거부', '수신거부', '수신 거부',
  '비동의', '불동의', '미동의', '동의안함', '동의 안함', '비동의함',
  '거절', '수신거절', '수신 거절',
  '해지', '탈퇴', '철회',
  '0', 'X', 'x', 'F', 'f',
]);

export function normalizeSmsOptIn(value: any): boolean | null {
  if (value == null || value === '') return null;
  if (typeof value === 'boolean') return value;
  const v = String(value).trim();
  if (SMS_OPT_IN_TRUE.has(v)) return true;
  if (SMS_OPT_IN_FALSE.has(v)) return false;
  return null;
}

// ============================================================
// 결혼 여부 정규화 — 표준값: true (기혼) / false (미혼)
// ============================================================
const MARRIED_TRUE = new Set(['true', 'Y', 'y', '기혼', 'married', 'Married', 'MARRIED', '1']);
const MARRIED_FALSE = new Set(['false', 'N', 'n', '미혼', 'single', 'Single', 'SINGLE', '0', '비혼']);

export function normalizeMarried(value: any): boolean | null {
  if (value == null || value === '') return null;
  if (typeof value === 'boolean') return value;
  const v = String(value).trim();
  if (MARRIED_TRUE.has(v)) return true;
  if (MARRIED_FALSE.has(v)) return false;
  return null;
}

// ============================================================
// 전화번호 정규화 (휴대폰) — 표준값: '01012345678' (숫자만)
// ============================================================
export function normalizePhone(value: any): string | null {
  if (value == null || value === '') return null;
  let v = String(value).trim();
  v = v.replace(/[\s\-\(\)\+\.]/g, '');
  if (v.startsWith('82')) v = '0' + v.slice(2);
  if (v.startsWith('+82')) v = '0' + v.slice(3);
  v = v.replace(/\D/g, '');
  // Excel 숫자 저장으로 인한 앞 0 빠짐 보정
  if (!v.startsWith('0') && /^1[016789]/.test(v)) {
    v = '0' + v;
  }
  if (!isValidKoreanPhone(v)) return null;
  return v;
}

/**
 * 한국 휴대폰 번호 유효성
 * - 010: 11자리
 * - 011/016/017/018/019: 10~11자리 (구번호)
 * - 050x (0502~0508) 안심번호: 11~12자리
 */
export function isValidKoreanPhone(phone: string): boolean {
  if (!phone) return false;
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('010')) return cleaned.length === 11;
  if (/^01[16789]/.test(cleaned)) return cleaned.length >= 10 && cleaned.length <= 11;
  if (/^050[2-8]/.test(cleaned)) return cleaned.length >= 11 && cleaned.length <= 12;
  return false;
}

/**
 * 한국 유선전화번호 유효성
 * ★ D102: 0으로 시작 + 휴대폰(01X) 아닌 7자리 이상이면 유선번호 인정
 *         1588/1544/1577 등 대표번호(8자리)도 허용
 */
export function isValidKoreanLandline(phone: string): boolean {
  if (!phone) return false;
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('0') && !/^01[016789]/.test(cleaned) && cleaned.length >= 7) return true;
  if (/^1[0-9]{3}/.test(cleaned) && cleaned.length === 8) return true;
  return false;
}

/**
 * 매장전화번호 정규화 — 유선 + 휴대폰 + 대표번호 모두 허용
 * - 유선: 하이픈 포함 원본 유지 (포맷 복원)
 * - 휴대폰: normalizePhone 위임 (숫자만)
 * - 대표번호: 숫자만 (8자리)
 */
export function normalizeStorePhone(value: any): string | null {
  if (value == null || value === '') return null;
  let v = String(value).trim();
  v = v.replace(/[\s\(\)\+\.]/g, '');
  const withHyphens = v;
  const digits = v.replace(/\D/g, '');
  if (!digits || digits.length < 7) return null;

  let cleaned = digits;
  if (!cleaned.startsWith('0') && /^[2-9]/.test(cleaned)) {
    cleaned = '0' + cleaned;
  }

  if (/^01[016789]/.test(cleaned)) {
    return normalizePhone(value);
  }

  if (isValidKoreanLandline(cleaned)) {
    if (withHyphens.includes('-')) return withHyphens;
    return cleaned;
  }

  if (/^1[0-9]{3}/.test(cleaned) && cleaned.length === 8) {
    return cleaned;
  }

  return null;
}

// ============================================================
// 나이 정규화
// ============================================================
export function normalizeAge(value: any): number | null {
  if (value == null || value === '') return null;
  // D131: 쉼표 포함 숫자 방어
  const cleaned = typeof value === 'string' ? value.replace(/,/g, '').replace(/\s/g, '').trim() : value;
  const num = Number(cleaned);
  if (isNaN(num) || num < 0 || num > 150) return null;
  return Math.floor(num);
}

export function ageFromBirthYear(birthYear: number): number {
  const currentYear = new Date().getFullYear();
  return currentYear - birthYear;
}

export function ageFromBirthDate(birthDate: string | Date): number | null {
  try {
    const bd = new Date(birthDate);
    if (isNaN(bd.getTime())) return null;
    const now = new Date();
    let age = now.getFullYear() - bd.getFullYear();
    const monthDiff = now.getMonth() - bd.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < bd.getDate())) {
      age--;
    }
    return age >= 0 && age <= 150 ? age : null;
  } catch {
    return null;
  }
}

// ============================================================
// 금액 정규화 — 표준값: number (소수점 2자리)
// ============================================================
export function normalizeAmount(value: any): number | null {
  if (value == null || value === '') return null;
  const cleaned = String(value).replace(/[₩$,\s원]/g, '');
  const num = Number(cleaned);
  if (isNaN(num)) return null;
  return Math.round(num * 100) / 100;
}

// ============================================================
// 날짜 정규화 — 표준값: 'YYYY-MM-DD'
// ★ D99: Math.ceil(올림)으로 가장 가까운 자정(UTC) 복원
// ★ D83: 한국식 "2025. 12. 17." 형식 지원
// ★ D79: YYMMDD 6자리(250103 → 2025-01-03) 지원
// ============================================================
export function normalizeDate(value: any): string | null {
  if (value == null || value === '') return null;

  if (value instanceof Date && !isNaN(value.getTime())) {
    const dayMs = 86400000;
    const ceiled = new Date(Math.ceil(value.getTime() / dayMs) * dayMs);
    const yyyy = ceiled.getUTCFullYear();
    if (yyyy >= 1900 && yyyy <= 2099) {
      const mm = String(ceiled.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(ceiled.getUTCDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    }
    return null;
  }

  // 엑셀 시리얼넘버
  const numVal = typeof value === 'number' ? value : Number(value);
  if (!isNaN(numVal) && Number.isInteger(numVal) && numVal >= 1 && numVal <= 73050) {
    const excelEpochMs = Date.UTC(1899, 11, 30);
    const converted = new Date(excelEpochMs + numVal * 86400000);
    const yyyy = converted.getUTCFullYear();
    if (yyyy >= 1900 && yyyy <= 2099) {
      const mm = String(converted.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(converted.getUTCDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    }
  }

  const v = String(value).trim();

  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  if (/^\d{8}$/.test(v)) return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(v)) return v.replace(/\//g, '-');
  if (/^\d{4}\.\d{2}\.\d{2}$/.test(v)) return v.replace(/\./g, '-');

  // 한국식 "2025. 12. 17." / "2025. 1. 3."
  const koMatch = v.replace(/\.$/, '').match(/^(\d{4})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})$/);
  if (koMatch) {
    const yyyy = koMatch[1];
    const mm = String(parseInt(koMatch[2])).padStart(2, '0');
    const dd = String(parseInt(koMatch[3])).padStart(2, '0');
    if (parseInt(mm) >= 1 && parseInt(mm) <= 12 && parseInt(dd) >= 1 && parseInt(dd) <= 31) {
      return `${yyyy}-${mm}-${dd}`;
    }
  }

  // YYMMDD 6자리
  if (/^\d{6}$/.test(v)) {
    const yy = parseInt(v.substring(0, 2));
    const mm = v.substring(2, 4);
    const dd = v.substring(4, 6);
    const yyyy = yy >= 0 && yy <= 50 ? 2000 + yy : 1900 + yy;
    if (parseInt(mm) >= 1 && parseInt(mm) <= 12 && parseInt(dd) >= 1 && parseInt(dd) <= 31) {
      return `${yyyy}-${mm}-${dd}`;
    }
  }

  // MM/DD/YYYY (미국식)
  const usMatch = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (usMatch) return `${usMatch[3]}-${usMatch[1]}-${usMatch[2]}`;

  try {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  } catch {}

  return null;
}

/**
 * 구매일시 정규화 — 'YYYY-MM-DD HH:mm:ss'
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

/**
 * 커스텀 필드 값 정규화 (D95)
 */
export function normalizeCustomFieldValue(val: any): string {
  if (val == null || val === '') return '';
  if (val instanceof Date) {
    return normalizeDate(val) || String(val);
  }
  if (typeof val === 'string' && /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s\w{3}\s\d{2}\s\d{4}/.test(val)) {
    return normalizeDate(val) || val;
  }
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(val)) {
    return normalizeDate(val) || val;
  }
  return String(val);
}

// ============================================================
// 이메일 정규화
// ============================================================
export function normalizeEmail(value: any): string | null {
  if (value == null || value === '') return null;
  return String(value).trim().toLowerCase();
}

// ============================================================
// 필드키 기반 정규화 디스패처 — 엑셀 업로드(upload.ts)와 동일 경로
// ============================================================
export function normalizeByFieldKey(fieldKey: string, value: any): any {
  if (value == null || value === '') return null;

  const field = getFieldByKey(fieldKey);
  if (!field || !field.normalizeFunction) {
    if (value instanceof Date) return value;
    return String(value).trim();
  }

  switch (field.normalizeFunction) {
    case 'trim':
      return String(value).trim();
    case 'normalizePhone':
      return normalizePhone(value);
    case 'normalizeStorePhone':
      return normalizeStorePhone(value);
    case 'normalizeGender':
      return normalizeGender(value);
    case 'parseInt': {
      // D131: 쉼표 포함 숫자("1,800") 파싱 지원 — 서수란 팀장 제보
      const cleaned = String(value).replace(/,/g, '').replace(/\s/g, '').trim();
      const num = parseInt(cleaned, 10);
      return isNaN(num) ? null : num;
    }
    case 'normalizeDate':
      return normalizeDate(value);
    case 'normalizeEmail':
      return normalizeEmail(value);
    case 'normalizeAmount':
      return normalizeAmount(value);
    case 'normalizeGrade':
      return normalizeGrade(value);
    case 'normalizeSmsOptIn':
      return normalizeSmsOptIn(value);
    default:
      return String(value).trim();
  }
}

// ============================================================
// 고객 레코드 정규화 — FIELD_MAP 기반 동적 처리 (엑셀 업로드와 동일)
// ============================================================
export function normalizeCustomer(
  mapped: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...mapped };

  // FIELD_MAP을 순회하면서 각 필드의 normalizeFunction에 따라 동적 정규화
  for (const field of FIELD_MAP) {
    if (field.storageType === 'custom_fields') continue; // custom은 별도 처리
    const key = field.fieldKey;
    if (!(key in result)) continue;
    result[key] = normalizeByFieldKey(key, result[key]);
  }

  // 생년월일 파생 필드 계산 (FIELD_MAP에 없는 파생 필드)
  if (result.birth_date && typeof result.birth_date === 'string') {
    const parts = result.birth_date.split('-');
    if (parts.length === 3) {
      result.birth_year = result.birth_year ?? parseInt(parts[0], 10);
      result.birth_month_day = result.birth_month_day ?? `${parts[1]}-${parts[2]}`;

      if (!result.age) {
        const birthYear = parseInt(parts[0], 10);
        const currentYear = new Date().getFullYear();
        result.age = currentYear - birthYear;
      }
    }
  }

  // 커스텀 필드 값 정규화 (custom_1 ~ custom_15)
  for (let i = 1; i <= 15; i++) {
    const key = `custom_${i}`;
    if (key in result && result[key] != null && result[key] !== '') {
      result[key] = normalizeCustomFieldValue(result[key]);
    }
  }

  return result;
}

// ─── 구매 데이터 정규화 ─────────────────────────────────

export function normalizePurchase(
  mapped: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...mapped };

  if ('customer_phone' in result) {
    result.customer_phone = normalizePhone(result.customer_phone);
  }

  if ('purchase_date' in result) {
    result.purchase_date = normalizeTimestamp(result.purchase_date);
  }

  // 금액 필드 (normalizeAmount가 쉼표·통화기호 제거)
  const amountFields = ['total_amount', 'unit_price'];
  for (const field of amountFields) {
    if (field in result) {
      result[field] = normalizeAmount(result[field]);
    }
  }

  // 수량 (쉼표 포함 방어)
  if ('quantity' in result && result.quantity !== null && result.quantity !== undefined) {
    const raw = result.quantity;
    const cleaned = typeof raw === 'string'
      ? raw.replace(/,/g, '').replace(/\s/g, '').trim()
      : raw;
    const num = Number(cleaned);
    result.quantity = isNaN(num) ? null : Math.round(num);
  }

  return result;
}

// ─── 배치 정규화 ────────────────────────────────────────

export interface NormalizationResult {
  normalized: Record<string, unknown>[];
  dropped: Array<{
    row: Record<string, unknown>;
    reason: string;
  }>;
}

export function normalizeCustomerBatch(rows: Record<string, unknown>[]): NormalizationResult {
  const normalized: Record<string, unknown>[] = [];
  const dropped: NormalizationResult['dropped'] = [];

  for (const row of rows) {
    const result = normalizeCustomer(row);

    if (!result.phone) {
      dropped.push({ row, reason: '전화번호 정규화 실패 또는 누락' });
      continue;
    }

    normalized.push(result);
  }

  if (dropped.length > 0) {
    logger.warn(`고객 정규화: ${dropped.length}건 제외 (총 ${rows.length}건 중)`);
  }

  return { normalized, dropped };
}

export function normalizePurchaseBatch(rows: Record<string, unknown>[]): NormalizationResult {
  const normalized: Record<string, unknown>[] = [];
  const dropped: NormalizationResult['dropped'] = [];

  for (const row of rows) {
    const result = normalizePurchase(row);

    if (!result.customer_phone) {
      dropped.push({ row, reason: '고객 전화번호 정규화 실패 또는 누락' });
      continue;
    }
    if (!result.purchase_date) {
      dropped.push({ row, reason: '구매일시 정규화 실패 또는 누락' });
      continue;
    }

    normalized.push(result);
  }

  if (dropped.length > 0) {
    logger.warn(`구매 정규화: ${dropped.length}건 제외 (총 ${rows.length}건 중)`);
  }

  return { normalized, dropped };
}

// ─── 필터용: 표준값 → 모든 변형값 배열 ───────────────────

export function getGenderVariants(standardValue: string): string[] {
  if (standardValue === 'M') return ['M', 'm', '남', '남자', '남성', 'male', 'Male', 'MALE', '1', 'man', 'Man', 'MAN'];
  if (standardValue === 'F') return ['F', 'f', '여', '여자', '여성', 'female', 'Female', 'FEMALE', '2', 'woman', 'Woman', 'WOMAN'];
  return [standardValue];
}

export function getGradeVariants(standardValue: string): string[] {
  const variants: string[] = [];
  for (const [key, val] of Object.entries(GRADE_MAP)) {
    if (val === standardValue) variants.push(key);
  }
  return variants.length > 0 ? variants : [standardValue];
}

export function getRegionVariants(standardValue: string): string[] {
  const variants: string[] = [];
  for (const [key, val] of Object.entries(REGION_MAP)) {
    if (val === standardValue) variants.push(key);
  }
  return variants.length > 0 ? variants : [standardValue];
}

// ─── FIELD_MAP re-export (호출부 편의) ──────────────────
export { FIELD_MAP, getFieldByKey } from './field-map';
