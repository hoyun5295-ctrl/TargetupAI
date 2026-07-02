/**
 * Target-UP 데이터 정규화 유틸리티
 * 
 * 다양한 고객사 DB의 값을 Target-UP 표준값으로 변환
 * 모든 정규화 로직을 한 곳에서 관리
 * 
 * 사용처: customers.ts, ai.ts, upload.ts, sync agent 등
 */

import { getFieldByKey } from './standard-field-map';

// ============================================================
// 성별 정규화
// 표준값: 'M' (남성), 'F' (여성)
// ============================================================
const GENDER_MAP: Record<string, string> = {
  // 남성 변형
  'm': 'M', 'M': 'M',
  '남': 'M', '남자': 'M', '남성': 'M',
  'male': 'M', 'Male': 'M', 'MALE': 'M',
  '1': 'M', 'man': 'M', 'Man': 'M', 'MAN': 'M',
  // 여성 변형
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

/** 필터용: 표준값 → DB에 존재할 수 있는 모든 변형값 배열 */
export function getGenderVariants(standardValue: string): string[] {
  if (standardValue === 'M') return ['M', 'm', '남', '남자', '남성', 'male', 'Male', 'MALE', '1', 'man', 'Man', 'MAN'];
  if (standardValue === 'F') return ['F', 'f', '여', '여자', '여성', 'female', 'Female', 'FEMALE', '2', 'woman', 'Woman', 'WOMAN'];
  return [standardValue];
}

// ============================================================
// 등급 정규화
// 표준값: 'VVIP', 'VIP', 'GOLD', 'SILVER', 'BRONZE', 'NORMAL'
// ============================================================
const GRADE_MAP: Record<string, string> = {
  // VVIP
  'VVIP': 'VVIP', 'vvip': 'VVIP', 'Vvip': 'VVIP',
  'VVIP고객': 'VVIP', 'VVIP회원': 'VVIP', 'VV': 'VVIP',
  // VIP
  'VIP': 'VIP', 'vip': 'VIP', 'Vip': 'VIP',
  'VIP고객': 'VIP', 'VIP회원': 'VIP', 'V': 'VIP',
  'vip고객': 'VIP', 'VIP등급': 'VIP',
  // GOLD
  'GOLD': 'GOLD', 'gold': 'GOLD', 'Gold': 'GOLD',
  '골드': 'GOLD', '골드회원': 'GOLD', 'Gold회원': 'GOLD',
  'G': 'GOLD', 'GOLD등급': 'GOLD',
  // SILVER
  'SILVER': 'SILVER', 'silver': 'SILVER', 'Silver': 'SILVER',
  '실버': 'SILVER', '실버회원': 'SILVER', 'Silver회원': 'SILVER',
  'S': 'SILVER', 'SILVER등급': 'SILVER',
  // BRONZE
  'BRONZE': 'BRONZE', 'bronze': 'BRONZE', 'Bronze': 'BRONZE',
  '브론즈': 'BRONZE', '브론즈회원': 'BRONZE', 'Bronze회원': 'BRONZE',
  'B': 'BRONZE', 'BRONZE등급': 'BRONZE',
  // NORMAL
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

/** 필터용: 표준값 → DB에 존재할 수 있는 모든 변형값 배열 */
export function getGradeVariants(standardValue: string): string[] {
  const variants: string[] = [];
  for (const [key, val] of Object.entries(GRADE_MAP)) {
    if (val === standardValue) variants.push(key);
  }
  return variants.length > 0 ? variants : [standardValue];
}

// ============================================================
// 지역 정규화
// 표준값: 서울, 부산, 대구, 인천, 광주, 대전, 울산, 세종,
//        경기, 강원, 충북, 충남, 전북, 전남, 경북, 경남, 제주
// ============================================================
const REGION_MAP: Record<string, string> = {
  // 서울
  '서울': '서울', '서울시': '서울', '서울특별시': '서울', 'Seoul': '서울', 'seoul': '서울', 'SEOUL': '서울',
  // 부산
  '부산': '부산', '부산시': '부산', '부산광역시': '부산', 'Busan': '부산', 'busan': '부산', 'BUSAN': '부산',
  // 대구
  '대구': '대구', '대구시': '대구', '대구광역시': '대구', 'Daegu': '대구', 'daegu': '대구', 'DAEGU': '대구',
  // 인천
  '인천': '인천', '인천시': '인천', '인천광역시': '인천', 'Incheon': '인천', 'incheon': '인천', 'INCHEON': '인천',
  // 광주
  '광주': '광주', '광주시': '광주', '광주광역시': '광주', 'Gwangju': '광주', 'gwangju': '광주', 'GWANGJU': '광주',
  // 대전
  '대전': '대전', '대전시': '대전', '대전광역시': '대전', 'Daejeon': '대전', 'daejeon': '대전', 'DAEJEON': '대전',
  // 울산
  '울산': '울산', '울산시': '울산', '울산광역시': '울산', 'Ulsan': '울산', 'ulsan': '울산', 'ULSAN': '울산',
  // 세종
  '세종': '세종', '세종시': '세종', '세종특별자치시': '세종', 'Sejong': '세종', 'sejong': '세종', 'SEJONG': '세종',
  // 경기
  '경기': '경기', '경기도': '경기', 'Gyeonggi': '경기', 'gyeonggi': '경기', 'GYEONGGI': '경기',
  // 강원
  '강원': '강원', '강원도': '강원', '강원특별자치도': '강원', 'Gangwon': '강원', 'gangwon': '강원', 'GANGWON': '강원',
  // 충북
  '충북': '충북', '충청북도': '충북', '충북도': '충북', 'Chungbuk': '충북', 'chungbuk': '충북', 'CHUNGBUK': '충북',
  // 충남
  '충남': '충남', '충청남도': '충남', '충남도': '충남', 'Chungnam': '충남', 'chungnam': '충남', 'CHUNGNAM': '충남',
  // 전북
  '전북': '전북', '전라북도': '전북', '전북도': '전북', '전북특별자치도': '전북', 'Jeonbuk': '전북', 'jeonbuk': '전북', 'JEONBUK': '전북',
  // 전남
  '전남': '전남', '전라남도': '전남', '전남도': '전남', 'Jeonnam': '전남', 'jeonnam': '전남', 'JEONNAM': '전남',
  // 경북
  '경북': '경북', '경상북도': '경북', '경북도': '경북', 'Gyeongbuk': '경북', 'gyeongbuk': '경북', 'GYEONGBUK': '경북',
  // 경남
  '경남': '경남', '경상남도': '경남', '경남도': '경남', 'Gyeongnam': '경남', 'gyeongnam': '경남', 'GYEONGNAM': '경남',
  // 제주
  '제주': '제주', '제주도': '제주', '제주시': '제주', '제주특별자치도': '제주', 'Jeju': '제주', 'jeju': '제주', 'JEJU': '제주',
};

export function normalizeRegion(value: any): string | null {
  if (value == null || value === '') return null;
  const v = String(value).trim();
  return REGION_MAP[v] || v; // 매핑 없으면 원본 반환 (해외 주소 등)
}

/** 필터용: 표준값 → DB에 존재할 수 있는 모든 변형값 배열 */
export function getRegionVariants(standardValue: string): string[] {
  const variants: string[] = [];
  for (const [key, val] of Object.entries(REGION_MAP)) {
    if (val === standardValue) variants.push(key);
  }
  return variants.length > 0 ? variants : [standardValue];
}

// ============================================================
// 수신동의 정규화
// 표준값: true / false
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
// 결혼 여부 정규화
// 표준값: true (기혼) / false (미혼)
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
// 전화번호 정규화
// 표준값: '01012345678' (숫자만, 하이픈 없이)
// ============================================================
export function normalizePhone(value: any): string | null {
  if (value == null || value === '') return null;
  let v = String(value).trim();
  // 특수문자 제거
  v = v.replace(/[\s\-\(\)\+\.]/g, '');
  // 국가코드 +82 → 0
  if (v.startsWith('82')) v = '0' + v.slice(2);
  if (v.startsWith('+82')) v = '0' + v.slice(3);
  // 숫자만 남기기
  v = v.replace(/\D/g, '');
  // ★ D137 D5: Excel 숫자 저장 등으로 앞 0 빠짐 보정 — 휴대폰 + 서울/지방 지역번호 + 070/050X 전수
  //   프론트 formatDate.ts `normalizePhoneKr` 과 완전 동일 regex (미러)
  // ★ D142 (2026-04-28): regex 정밀화. 옛 `\d{6,10}` 너무 관대 → "1800-8125"(8자리 대표번호)의
  //   "18"이 휴대폰 prefix `1[016789]`에 매치되어 "018008125"로 0 추가되던 PDF 0428 #2 사고.
  //   prefix별 정확한 자릿수 강제 (휴대폰=9~10자리/안심번호=10~11자리/지역번호=8~10자리/070=10자리)
  //   8자리 1XXX 대표번호(1588/1644/1670/1800/1899 등)는 어떤 prefix에도 매치 안 되어 안전.
  if (!v.startsWith('0') && (
    /^2\d{7,8}$/.test(v) ||           // 02 서울 (총 9~10자리, 0 빠짐 = 8~9자리)
    /^1[016789]\d{7,8}$/.test(v) ||   // 휴대폰 010~019 (총 10~11자리, 0 빠짐 = 9~10자리)
    /^3[1-3]\d{7,8}$/.test(v) ||      // 경기/인천/강원
    /^4[1-4]\d{7,8}$/.test(v) ||      // 충남/대전/충북/세종
    /^5[1-5]\d{7,8}$/.test(v) ||      // 부산/울산/대구/경북/경남
    /^50[2-9]\d{6,7}$/.test(v) ||     // 050X 안심번호 (총 11~12자리, 0 빠짐 = 10~11자리)
    /^6[1-4]\d{7,8}$/.test(v) ||      // 전남/광주/전북/제주
    /^70\d{8}$/.test(v)               // 070 (총 11자리, 0 빠짐 = 10자리)
  )) {
    v = '0' + v;
  }
  // 유효성 검사: 한국 휴대폰 번호만 허용
  if (!isValidKoreanPhone(v)) return null;
  return v;
}

/**
 * 한국 전화번호 유효성 검증
 * - 010: 11자리 (010XXXXXXXX)
 * - 011/016/017/018/019: 10~11자리 (구번호 허용)
 * - 050x: 안심번호 (0502, 0503, 0504, 0505, 0506, 0507, 0508) → 11~12자리
 * - 01/050x 외 → false
 */
export function isValidKoreanPhone(phone: string): boolean {
  if (!phone) return false;
  const cleaned = phone.replace(/\D/g, '');
  // 010 → 반드시 11자리
  if (cleaned.startsWith('010')) return cleaned.length === 11;
  // 011, 016, 017, 018, 019 → 10~11자리 (구번호)
  if (/^01[16789]/.test(cleaned)) return cleaned.length >= 10 && cleaned.length <= 11;
  // 050x 안심번호 (0502~0508) → 11~12자리
  if (/^050[2-8]/.test(cleaned)) return cleaned.length >= 11 && cleaned.length <= 12;
  // 그 외 → 무효
  return false;
}

/**
 * 한국 유선 전화번호 유효성 검증
 * - 02: 서울 (9~10자리: 02XXXXXXX 또는 02XXXXXXXX)
 * - 031~055: 지역번호 (10~11자리)
 * - 070: 인터넷전화 (11자리)
 * - 080: 수신자부담 (11자리)
 * - 1588/1544/1577 등: 대표번호 (8자리)
 */
export function isValidKoreanLandline(phone: string): boolean {
  if (!phone) return false;
  const cleaned = phone.replace(/\D/g, '');
  // ★ D102: 범위 제한 없이 — 0으로 시작 + 휴대폰(01X) 아닌 7자리 이상이면 유선번호로 인정
  if (cleaned.startsWith('0') && !/^01[016789]/.test(cleaned) && cleaned.length >= 7) return true;
  // 1588, 1544, 1577 등 대표번호 → 8자리
  if (/^1[0-9]{3}/.test(cleaned) && cleaned.length === 8) return true;
  return false;
}

/**
 * 전화번호 표시용 하이픈 포맷 (2026-06-13 — frontend formatDate.ts formatPhoneNumber 미러)
 * - 엑셀/CSV 내보내기에서 앞 0 소실(숫자 인식)을 막고 화면 표기와 통일.
 * - 알 수 없는 길이는 원본 그대로 반환 (값 훼손 금지).
 */
export function formatPhoneDisplay(value: any): string {
  if (value == null || value === '') return '';
  const digits = String(value).replace(/\D/g, '');
  if (/^01\d{9}$/.test(digits)) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;   // 11자리 휴대폰
  if (/^01\d{8}$/.test(digits)) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;    // 10자리 휴대폰(011 등)
  if (/^02\d{8}$/.test(digits)) return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6)}`;    // 서울 10자리
  if (/^02\d{7}$/.test(digits)) return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;    // 서울 9자리
  if (/^0\d{9}$/.test(digits)) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;     // 지역 10자리
  if (/^0\d{10}$/.test(digits)) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;    // 지역 11자리
  return String(value);
}

/**
 * 매장전화번호 정규화 (유선번호 + 휴대폰 모두 허용)
 * - 유선번호: 02, 031~055, 070, 080, 1588 등
 * - 휴대폰: 010, 011~019
 * - 하이픈 포함 형태로 반환
 */
/**
 * ★ 2026-06-23: 080 수신거부번호 입력 정규화.
 *   빈 문자열·공백만·null/undefined = 삭제 의도 → null 반환. 그 외 trim한 값 반환.
 *   회사 설정 저장 시 user 오버라이드(users.opt_out_080_number) 삭제가 반영되도록 사용.
 */
export function normalizeOpt080Input(raw: any): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  return s === '' ? null : s;
}

export function normalizeStorePhone(value: any): string | null {
  if (value == null || value === '') return null;
  let v = String(value).trim();
  // 특수문자 제거
  v = v.replace(/[\s\(\)\+\.]/g, '');
  // 하이픈만 남긴 원본 보관 (포맷팅 복원용)
  const withHyphens = v;
  // 숫자만 추출
  const digits = v.replace(/\D/g, '');
  if (!digits || digits.length < 7) return null;

  // 앞 0 빠짐 보정 (Excel 숫자 저장)
  let cleaned = digits;
  if (!cleaned.startsWith('0') && /^[2-9]/.test(cleaned)) {
    cleaned = '0' + cleaned;
  }

  // 휴대폰이면 normalizePhone 위임
  if (/^01[016789]/.test(cleaned)) {
    return normalizePhone(value);
  }

  // 유선번호 유효성
  if (isValidKoreanLandline(cleaned)) {
    // 하이픈 포함 원본이 있으면 사용, 없으면 숫자만 반환
    if (withHyphens.includes('-')) return withHyphens;
    return cleaned;
  }

  // 대표번호 (1588 등)
  if (/^1[0-9]{3}/.test(cleaned) && cleaned.length === 8) {
    return cleaned;
  }

  return null;
}

// ============================================================
// 나이 정규화
// 표준값: 정수 (만 나이)
// birth_date 또는 birth_year에서 계산 가능
// ============================================================
export function normalizeAge(value: any): number | null {
  if (value == null || value === '') return null;
  const num = Number(value);
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
// 금액 정규화
// 표준값: number (소수점 2자리)
// ============================================================
export function normalizeAmount(value: any): number | null {
  if (value == null || value === '') return null;
  // 통화 기호, 쉼표 제거
  const cleaned = String(value).replace(/[₩$,\s원]/g, '');
  const num = Number(cleaned);
  if (isNaN(num)) return null;
  return Math.round(num * 100) / 100;
}

// ============================================================
// 날짜 정규화
// 표준값: 'YYYY-MM-DD' (ISO 형식)
// ============================================================
export function normalizeDate(value: any): string | null {
  if (value == null || value === '') return null;

  // Date 객체 직접 처리 (XLSX cellDates: true)
  // ★ D99: UTC 기준 Math.ceil(올림)으로 가장 가까운 자정으로 올림
  // XLSX cellDates:true → 엑셀 시리얼을 Date 변환 시 부동소수점 오차로 14:59:08 UTC 같은 값 생성
  // 예: 엑셀 3/1/95 → Date("1995-02-28T14:59:08.000Z") → 어떤 TZ든 getDate()=28 → 하루 전
  // 해결: UTC ms를 dayMs로 올림(ceil) → 정확한 자정 UTC → getUTCFullYear/Month/Date
  // D98 로컬TZ 방식 실패 원인: 14:59 UTC + KST 9h = 23:59 → 여전히 28일 (다음날로 안 넘어감)
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

  // 엑셀 시리얼넘버 (숫자형 또는 정수형 문자열 — 1~73050 범위)
  // ★ D92: UTC 기반 연산으로 타임존 무관하게 정확한 날짜 변환
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

  // 이미 ISO 형식
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  // YYYYMMDD
  if (/^\d{8}$/.test(v)) return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
  // YYYY/MM/DD
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(v)) return v.replace(/\//g, '-');
  // YYYY.MM.DD
  if (/^\d{4}\.\d{2}\.\d{2}$/.test(v)) return v.replace(/\./g, '-');
  // ★ D83: 한국식 날짜 형식 — "2025. 12. 17." "2025. 1. 3." "2025.12.17." (공백+점 조합)
  const koMatch = v.replace(/\.$/, '').match(/^(\d{4})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})$/);
  if (koMatch) {
    const yyyy = koMatch[1];
    const mm = String(parseInt(koMatch[2])).padStart(2, '0');
    const dd = String(parseInt(koMatch[3])).padStart(2, '0');
    if (parseInt(mm) >= 1 && parseInt(mm) <= 12 && parseInt(dd) >= 1 && parseInt(dd) <= 31) {
      return `${yyyy}-${mm}-${dd}`;
    }
  }
  // ★ D79: YYMMDD 6자리 형식 (250103 → 2025-01-03)
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

  // Date 파싱 시도
  try {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  } catch {}

  return null;
}

/**
 * ★ D95: 커스텀 필드 값 정규화 — upload.ts / sync.ts에서 호출
 * Date 객체 또는 JS Date.toString() 문자열이면 normalizeDate로 YYYY-MM-DD 변환.
 * 일반 문자열(건성, 매트 등)은 그대로 반환. YYMMDD 6자리 같은 모호한 값은 건드리지 않음.
 */
export function normalizeCustomFieldValue(val: any): string {
  if (val == null || val === '') return '';
  // Date 객체 → normalizeDate
  if (val instanceof Date) {
    return normalizeDate(val) || String(val);
  }
  // JS Date.toString() 형식: "Wed Jan 01 2025 23:59:08 GMT+0900 (...)"
  if (typeof val === 'string' && /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s\w{3}\s\d{2}\s\d{4}/.test(val)) {
    return normalizeDate(val) || val;
  }
  // ISO 타임스탬프 문자열: "2025-01-01T14:59:08.000Z"
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(val)) {
    return normalizeDate(val) || val;
  }
  return String(val);
}

// ============================================================
// 일괄 정규화 (동기화/업로드 시 레코드 한 건 통째로 변환)
// ============================================================
export interface NormalizedCustomer {
  phone: string | null;
  name: string | null;
  gender: string | null;
  birth_date: string | null;
  age: number | null;
  email: string | null;
  grade: string | null;
  region: string | null;
  points: number | null;
  total_purchase_amount: number | null;
  recent_purchase_date: string | null;
  sms_opt_in: boolean | null;
  is_married: boolean | null;
  [key: string]: any; // custom_fields 등 추가 필드
}

export function normalizeCustomerRecord(raw: Record<string, any>): NormalizedCustomer {
  return {
    phone: normalizePhone(raw.phone || raw.mobile || raw.phone_number || raw.tel || raw.cell_phone),
    name: raw.name ? String(raw.name).trim() : null,
    gender: normalizeGender(raw.gender || raw.sex || raw.성별),
    birth_date: normalizeDate(raw.birth_date || raw.birthday || raw.birthdate || raw.생년월일),
    age: normalizeAge(raw.age || raw.나이),
    email: raw.email ? String(raw.email).trim().toLowerCase() : null,
    grade: (raw.grade || raw.등급 || raw.membership || raw.level || raw.회원등급) ? String(raw.grade || raw.등급 || raw.membership || raw.level || raw.회원등급).trim() : null,
    region: normalizeRegion(raw.region || raw.지역 || raw.area || raw.city || raw.도시),
    points: raw.points != null ? Number(raw.points) || null : null,
    total_purchase_amount: normalizeAmount(raw.total_purchase_amount || raw.총구매금액 || raw.total_spent),
    recent_purchase_date: normalizeDate(raw.recent_purchase_date || raw.최근구매일 || raw.last_purchase),
    sms_opt_in: normalizeSmsOptIn(raw.sms_opt_in ?? raw.수신동의 ?? raw.opt_in ?? raw.marketing_agree),
    is_married: normalizeMarried(raw.is_married || raw.결혼여부 || raw.married),
  };
}

// ============================================================
// 표준값 상수 (프론트엔드/AI에서 참조)
// ============================================================
export const STANDARD_VALUES = {
  gender: ['M', 'F'],
  grade: ['VVIP', 'VIP', 'GOLD', 'SILVER', 'BRONZE', 'NORMAL'],
  region: ['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주'],
  sms_opt_in: [true, false],
  is_married: [true, false],
} as const;

// ============================================================
// 필터 헬퍼: DB에 어떤 형식으로 저장되어 있든 잡아내는 SQL 조건 생성
// ============================================================
export function buildGenderFilter(value: string, paramIndex: number): { sql: string; params: any[]; nextIndex: number } {
  const variants = getGenderVariants(value);
  return {
    sql: ` AND gender = ANY($${paramIndex}::text[])`,
    params: [variants],
    nextIndex: paramIndex + 1,
  };
}

export function buildRegionFilter(value: string, paramIndex: number): { sql: string; params: any[]; nextIndex: number } {
  const variants = getRegionVariants(value);
  return {
    sql: ` AND region = ANY($${paramIndex}::text[])`,
    params: [variants],
    nextIndex: paramIndex + 1,
  };
}

export function buildGradeFilter(value: string | string[], paramIndex: number): { sql: string; params: any[]; nextIndex: number } {
  if (Array.isArray(value)) {
    const allVariants = value.flatMap(v => getGradeVariants(v));
    return {
      sql: ` AND grade = ANY($${paramIndex}::text[])`,
      params: [allVariants],
      nextIndex: paramIndex + 1,
    };
  }
  const variants = getGradeVariants(value);
  return {
    sql: ` AND grade = ANY($${paramIndex}::text[])`,
    params: [variants],
    nextIndex: paramIndex + 1,
  };
}

// ============================================================
// 이메일 정규화
// 표준값: 소문자 trim
// ============================================================
export function normalizeEmail(value: any): string | null {
  if (value == null || value === '') return null;
  return String(value).trim().toLowerCase();
}

// ============================================================
// 웹 URL 정규화 — ★ 2026-07-02 (Harold 신고: www.poppon.co.kr 이메일 링크 이동 안 됨)
// 스킴 없는 도메인형(www.x.y / a.b/path)에 https:// 부착.
// 기존 스킴(http/https/mailto/tel)·앵커(#)·상대경로(/)·개인화 변수({{)는 그대로 보존.
// 소비처: 이메일 섹션 렌더러 · 이메일 클릭 추적 래핑 · DM safeUrl (전수 통합 — 인라인 스킴 검사 대체)
// ============================================================
export function normalizeWebUrl(value: any): string {
  const s = String(value ?? '').trim();
  if (!s) return '';
  if (/^(https?:|mailto:|tel:|#|\/)/i.test(s)) return s;
  if (s.includes('{{')) return s; // Liquid 개인화 변수 URL은 치환 전이라 손대지 않음
  // 도메인형 (www.poppon.co.kr, poppon.co.kr/event?x=1 등) = https:// 부착
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/i.test(s)) return `https://${s}`;
  return s;
}

// ============================================================
// 필드키 기반 정규화 디스패처
// standard-field-map.ts의 normalizeFunction 값에 따라 호출
// ============================================================
export function normalizeByFieldKey(fieldKey: string, value: any): any {
  if (value == null || value === '') return null;

  const field = getFieldByKey(fieldKey);
  if (!field || !field.normalizeFunction) {
    // ★ D99: Date 객체는 String()하면 영문 날짜 문자열이 되어 후속 normalizeCustomFieldValue에서
    // Math.ceil Date 분기를 못 타고 문자열 파싱 → 하루 밀림. Date 객체는 그대로 반환
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
      // D131: 쉼표 포함 숫자("1,800") 파싱 지원 — 서수란 팀장 제보(Agent 동일 이슈 동시 해결)
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

/**
 * 셀 값(엑셀/JSON)을 안전하게 문자열로 변환.
 * null/undefined/NaN만 빈 문자열, 0 / '0' / false / Date 등은 그대로 보존.
 *
 * ★ D150-3 (2026-05-09) PDF #5 — 직접발송 0 NULL 사고 root cause fix
 *   frontend formatDate.ts cellToString 미러. 모든 backend 셀/주소록 변환을 이 헬퍼로 통합.
 *   인라인 safeStr 정의 금지 — 컨트롤타워 일관 import.
 */
export function cellToString(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'number') return Number.isNaN(val) ? '' : String(val);
  if (typeof val === 'string') return val;
  if (typeof val === 'boolean') return String(val);
  if (val instanceof Date) return val.toISOString();
  return String(val);
}
