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
const SMS_OPT_IN_TRUE = new Set(['true', 'Y', 'y', 'yes', 'YES', 'Yes', '동의', '수신동의', '1', 'O', 'o', 'T', 't']);
const SMS_OPT_IN_FALSE = new Set(['false', 'N', 'n', 'no', 'NO', 'No', '거부', '수신거부', '0', 'X', 'x', 'F', 'f']);

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
  // Excel 숫자 저장으로 인한 앞 0 빠짐 보정
  // 10XXXXXXXX (10자리) → 010XXXXXXXX (11자리)
  // 11~19XXXXXXX (9~10자리) → 011~019XXXXXXX (구번호)
  if (!v.startsWith('0') && /^1[016789]/.test(v)) {
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
 * - 01로 시작하지 않거나 자릿수 불일치 → false
 */
export function isValidKoreanPhone(phone: string): boolean {
  if (!phone) return false;
  const cleaned = phone.replace(/\D/g, '');
  // 010 → 반드시 11자리
  if (cleaned.startsWith('010')) return cleaned.length === 11;
  // 011, 016, 017, 018, 019 → 10~11자리 (구번호)
  if (/^01[16789]/.test(cleaned)) return cleaned.length >= 10 && cleaned.length <= 11;
  // 그 외 → 무효
  return false;
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
  const v = String(value).trim();
  
  // 이미 ISO 형식
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  // YYYYMMDD
  if (/^\d{8}$/.test(v)) return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
  // YYYY/MM/DD
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(v)) return v.replace(/\//g, '-');
  // YYYY.MM.DD
  if (/^\d{4}\.\d{2}\.\d{2}$/.test(v)) return v.replace(/\./g, '-');
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
// 필드키 기반 정규화 디스패처
// standard-field-map.ts의 normalizeFunction 값에 따라 호출
// ============================================================
export function normalizeByFieldKey(fieldKey: string, value: any): any {
  if (value == null || value === '') return null;

  const field = getFieldByKey(fieldKey);
  if (!field || !field.normalizeFunction) {
    return String(value).trim();
  }

  switch (field.normalizeFunction) {
    case 'trim':
      return String(value).trim();
    case 'normalizePhone':
      return normalizePhone(value);
    case 'normalizeGender':
      return normalizeGender(value);
    case 'parseInt': {
      const num = parseInt(String(value), 10);
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
