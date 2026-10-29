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
import type { ValueMaps } from '../config/schema';
import type { DbType } from '../db/types';
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
// 탈퇴·거부 표시(is_opt_out) 정규화 — true = 거부·탈퇴(발송 제외) / false = 아님
// ★ 2026-10-15 엠티콜렉션 YN_WITHDRAW(Y = 탈퇴). 수신동의와 극성이 반대라 낱말표를 따로 둔다.
// ============================================================
const OPT_OUT_TRUE = new Set([
  'true', 'Y', 'y', 'yes', 'YES', 'Yes', '1', 'T', 't', 'O', 'o',
  '거부', '수신거부', '수신 거부', '거절', '탈퇴', '탈퇴회원', '해지', '철회',
]);
const OPT_OUT_FALSE = new Set([
  'false', 'N', 'n', 'no', 'NO', 'No', '0', 'F', 'f', 'X', 'x', '정상',
]);

export function normalizeOptOutFlag(value: any): boolean | null {
  if (value == null || value === '') return null;
  if (typeof value === 'boolean') return value;
  const v = String(value).trim();
  if (OPT_OUT_TRUE.has(v)) return true;
  if (OPT_OUT_FALSE.has(v)) return false;
  return null;
}

// ============================================================
// ★ 2026-10-28 설치별 값 분류(P2 · docs/2026-10-28-sync-value-check-summary-guard-design.md §3)
// 낱말표(위 세 표)는 손대지 않는다 — 모든 설치의 판정이 바뀐다. 낱말표가 모르는 글자만, 설치 때 사람이 분류한 표로 바꾼다.
// 표가 없거나 안 맞으면(아래 resolveValueMaps) 지금 동작 그대로.
// ============================================================
export type ValueMapField = 'sms_opt_in' | 'is_opt_out' | 'gender';
export const VALUE_MAP_FIELDS: readonly ValueMapField[] = ['sms_opt_in', 'is_opt_out', 'gender'];

/** 낱말표 판정 한 곳(정규화 · 설치 값 확인 공용) — null = 모름(설치 분류 대상) */
export function builtinValueJudgement(field: ValueMapField, raw: unknown): boolean | string | null {
  if (field === 'sms_opt_in') return normalizeSmsOptIn(raw);
  if (field === 'is_opt_out') return normalizeOptOutFlag(raw);
  return normalizeGender(raw);
}

/** 그 필드에 매핑된 원본 컬럼이 정확히 하나면 그 이름 · 없거나 둘 이상(이어붙이기)이면 null */
export function singleSourceColumn(mapping: Record<string, string>, field: string): string | null {
  const cols = Object.keys(mapping).filter((c) => mapping[c] === field);
  return cols.length === 1 ? cols[0] : null;
}

/**
 * 분류표의 원본 식별 — **저장된 접속 설정 모양**(config.database)에서 만든다(마법사 · 설정 편집 · 엔진이 같은 함수 · Codex 설계 1R).
 * 어댑터 getSourceId 를 쓰지 않는 이유 = 마법사가 접속에 쓴 객체와 저장 객체의 기본값 채움이 달라 같은 DB 가 다른 글자가 될 수 있다.
 * 비밀번호는 넣지 않는다.
 */
export function valueMapSourceOf(db: { type: string; host?: string; port?: number; database?: string; username?: string; filePath?: string }): string {
  return JSON.stringify([db.type, db.host ?? '', db.port ?? null, db.database ?? '', db.username ?? '', db.filePath ?? '']);
}

/** 분류표가 묶인 원본 · 고객 테이블 — 엔진은 config 에서, 마법사 · 설정 편집은 저장할 설정에서 */
export interface ValueMapTarget { table: string; source: string }

/**
 * 적용 판정 한 곳 — 표의 원본 · 고객 테이블이 지금 설정과 같고, column 이 지금 고객 매핑의 단일 원본 컬럼과 같을 때만 그 표를 쓴다.
 * DB · 테이블 · 매핑 컬럼 중 하나라도 바뀌면 옛 표는 저절로 빠진다(지금 동작 + 배치 로그 그대로 · 다시 분류 = 설정 편집 [6]).
 */
export function resolveValueMaps(
  valueMaps: ValueMaps | undefined,
  customerMapping: Record<string, string>,
  target: ValueMapTarget,
): ValueMaps | undefined {
  if (!valueMaps) return undefined;
  const fits = (field: ValueMapField, e: { column: string; table: string; source: string } | undefined) =>
    !!e && e.table === target.table && e.source === target.source && singleSourceColumn(customerMapping, field) === e.column;
  const out: ValueMaps = {};
  if (fits('sms_opt_in', valueMaps.sms_opt_in)) out.sms_opt_in = valueMaps.sms_opt_in;
  if (fits('is_opt_out', valueMaps.is_opt_out)) out.is_opt_out = valueMaps.is_opt_out;
  if (fits('gender', valueMaps.gender)) out.gender = valueMaps.gender;
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * 고객 커서 정체성에 넣는 분류표 지문 — 분류가 바뀌면 커서가 폐기돼 고객 전량이 새 분류로 다시 나간다(Codex 설계 1R).
 * 필드 · 값 글자 순으로 정렬해 저장 순서와 무관하게 같은 표 = 같은 글자.
 */
export function valueMapsDigest(maps: ValueMaps): string {
  const rows = VALUE_MAP_FIELDS.filter((f) => maps[f]).map((f) => {
    const e = maps[f]!;
    const vals = Object.entries(e.values as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return [f, e.column, e.table, e.source, vals];
  });
  return JSON.stringify(rows);
}

/** 낱말표 판정이 null 인 글자만 표의 값으로 바꾼다(낱말표가 아는 값은 표가 있어도 그대로) */
function applyInstallValueMaps(result: Record<string, unknown>, maps: ValueMaps): void {
  for (const field of VALUE_MAP_FIELDS) {
    const m = maps[field];
    if (!m || !(field in result)) continue;
    const raw = result[field];
    if (raw == null || typeof raw === 'boolean') continue;
    const v = String(raw).trim();
    if (v === '' || builtinValueJudgement(field, v) !== null) continue;
    if (Object.prototype.hasOwnProperty.call(m.values, v)) result[field] = (m.values as Record<string, unknown>)[v];
  }
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
  // 국가코드 82 → 0. '+'는 바로 위에서 지웠으므로 '+82…'와 '82…'가 여기서 같은 문자열이다(★2026-09-13(3) 도달하지 않던 +82 분기 제거)
  if (v.startsWith('82')) v = '0' + v.slice(2);
  v = v.replace(/\D/g, '');
  // ★ D142 (2026-04-28): 한줄로 backend normalize.ts와 미러. prefix별 정확한 자릿수 강제.
  //   PDF 0428 #2 "1800-8125 → 018008125" 사고 차단.
  //   8자리 대표번호(1588/1644/1670/1800/1899 등)는 어떤 prefix에도 매치 안 되어 0 추가 안 됨.
  if (!v.startsWith('0') && (
    /^2\d{7,8}$/.test(v) ||           // 02 서울
    /^1[016789]\d{7,8}$/.test(v) ||   // 휴대폰 010~019
    /^3[1-3]\d{7,8}$/.test(v) ||      // 경기/인천/강원
    /^4[1-4]\d{7,8}$/.test(v) ||      // 충남/대전/충북/세종
    /^5[1-5]\d{7,8}$/.test(v) ||      // 부산/울산/대구/경북/경남
    /^50[2-9]\d{6,7}$/.test(v) ||     // 050X 안심번호
    /^6[1-4]\d{7,8}$/.test(v) ||      // 전남/광주/전북/제주
    /^70\d{8}$/.test(v)               // 070
  )) {
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
export function normalizeTimestamp(raw: unknown, opts?: { utcWallClock?: boolean }): string | null {
  if (raw === null || raw === undefined || raw === '') return null;

  if (raw instanceof Date) {
    if (isNaN(raw.getTime())) return null;
    // ★ 1.7.2 MSSQL(tedious useUTC 기본 true)은 원본 벽시계를 UTC 성분에 담아 준다 — 로컬로 읽으면 +9시간(15시 이후 구매 = 다음 날).
    //   custom 칸은 0913 에 같은 규칙으로 되돌렸다(normalizeSyncCustomFieldValue) · 구매일만 빠져 있었다.
    if (opts?.utcWallClock) {
      const p = (n: number) => String(n).padStart(2, '0');
      return `${raw.getUTCFullYear()}-${p(raw.getUTCMonth() + 1)}-${p(raw.getUTCDate())} ${p(raw.getUTCHours())}:${p(raw.getUTCMinutes())}:${p(raw.getUTCSeconds())}`;
    }
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

/**
 * 동기화 경로 custom_1~15 값 정리(★2026-09-13(3) 싱크 ⓒ · 동기화 전용 · 백엔드 원본 함수는 위 normalizeCustomFieldValue 그대로).
 *
 * 원칙 = custom 원본 100% 보존(memory `feedback_custom_field_raw_preserve`): 문자열·숫자·불리언은 한 글자도 바꾸지 않는다.
 * 날짜 컬럼만 되돌린다: 드라이버가 준 JS Date를 그대로 직렬화하면 **UTC ISO 문자열**이 되어(KST 자정 날짜가 전날 15:00Z)
 * 원본 DB에 없는 글자가 저장·발송된다 → 원본 DB가 보여 주는 벽시계 글자로 되돌린다.
 * 드라이버별 벽시계 성분(라이브러리 소스 확인):
 *  - mysql2: timezone 기본 'local'(connection_config.js) → 로컬 성분
 *  - tedious(mssql): useUTC 기본 true(connection.js) → UTC 성분(어댑터가 useUTC를 바꾸지 않는다)
 *  - PostgreSQL·Oracle 어댑터: 로컬 Date를 toISOString으로 넘긴다(postgres-date 로컬 · oracledb DATE/TIMESTAMP 로컬) → 매핑이 되돌린다(아래)
 * ⛔ 백엔드 normalizeCustomFieldValue를 쓰지 마라: UTC 올림·ISO 앞 10자리 자르기라 날짜가 하루 밀리고 시각이 사라진다.
 * ★ 2026-10-29 1.7.5 PostgreSQL·Oracle 의 ISO 되돌림은 여기서 하지 않는다 — 매핑(mapRow)이 **원본 컬럼 타입이 날짜인 값만**
 *   adapterIsoToWallClock 으로 되돌린다(표준 날짜 칸 · custom 칸 · 구매일 공통 · 뿌리 대장 R16).
 *   옛: 이 함수가 글자 모양(toISOString 꼴)으로 날짜를 추측했다 → TEXT 칸의 같은 꼴 원문까지 바뀌고(Codex 1R),
 *   PG 는 'postgresql' 과 비교해(어댑터 dbType = 'postgres') 한 번도 돌지 않아 PG 날짜가 하루 밀린 채 나갔다.
 */
const CONNECTOR_ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * PG · Oracle 어댑터가 날짜 타입 컬럼의 로컬 Date 를 toISOString 으로 넘긴 글자 → 원본 벽시계 글자(그 밖의 값은 그대로).
 * ⛔ 날짜 타입 원본 컬럼의 값에만 부른다(부르는 곳 = mapping/mapRow 한 곳 · 컬럼 타입 판정 = 엔진 dateSourceColumns).
 */
export function adapterIsoToWallClock(v: unknown): unknown {
  if (typeof v !== 'string' || !CONNECTOR_ISO_RE.test(v)) return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : wallClockText(d, false);
}

function wallClockText(d: Date, utc: boolean): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  const Y = utc ? d.getUTCFullYear() : d.getFullYear();
  const M = utc ? d.getUTCMonth() : d.getMonth();
  const D = utc ? d.getUTCDate() : d.getDate();
  const h = utc ? d.getUTCHours() : d.getHours();
  const mi = utc ? d.getUTCMinutes() : d.getMinutes();
  const s = utc ? d.getUTCSeconds() : d.getSeconds();
  const ms = utc ? d.getUTCMilliseconds() : d.getMilliseconds();
  const date = `${Y}-${p(M + 1)}-${p(D)}`;
  if (!h && !mi && !s && !ms) return date;
  return `${date} ${p(h)}:${p(mi)}:${p(s)}${ms ? `.${p(ms, 3)}` : ''}`;
}

export function normalizeSyncCustomFieldValue(v: unknown, dbType?: DbType): unknown {
  if (v === null || v === undefined || v === '') return v;
  if (typeof v === 'bigint') return v.toString(); // JSON 직렬화 예외 방지
  if (!(v instanceof Date) || Number.isNaN(v.getTime())) return v;
  return wallClockText(v, dbType === 'mssql');
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
  // ★2026-09-13(3) 동기화 경로는 원본 DB 종류를 넘긴다(custom_fields 날짜 되돌림 · 없으면 날짜 되돌림 없이 원형 그대로)
  // ★ 2026-10-28 valueMaps = 엔진이 resolveValueMaps 로 거른 설치별 값 분류(없으면 지금 동작 그대로)
  opts?: { dbType?: DbType; valueMaps?: ValueMaps },
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...mapped };

  // ★ 2026-10-28 설치별 값 분류는 맨 앞 — 아래 수신동의 「알아볼 수 없음」 표시 · 탈퇴 접기가 분류된 값으로 판정한다
  if (opts?.valueMaps) applyInstallValueMaps(result, opts.valueMaps);

  // ★ 1.7.2 수신동의 칸에 값은 있는데 알아볼 수 없으면(낱말표 밖) 그 글자를 표시로 싣는다 — 서버가 신규 고객을 미동의로 넣는다.
  //   null 로만 접으면 서버는 「값 없음」으로 보고 신규 기본 동의(true)를 탄다(거부 표기가 동의로 들어가던 자리).
  //   ⛔ 서버 `utils/normalize.ts isUnrecognizedSmsOptIn` 과 같은 규칙.
  const rawConsent = result.sms_opt_in;
  const consentUnrecognized =
    rawConsent != null && typeof rawConsent !== 'boolean' && String(rawConsent).trim() !== '' && normalizeSmsOptIn(rawConsent) === null;

  // FIELD_MAP을 순회하면서 각 필드의 normalizeFunction에 따라 동적 정규화
  for (const field of FIELD_MAP) {
    if (field.storageType === 'custom_fields') continue; // custom은 별도 처리
    const key = field.fieldKey;
    if (!(key in result)) continue;
    result[key] = normalizeByFieldKey(key, result[key]);
  }
  if (consentUnrecognized) result.sms_opt_in_unknown = String(rawConsent).trim().slice(0, 20);

  // ★ 2026-10-15 탈퇴·거부 표시(is_opt_out)는 수신거부로 접는다. 서버 sync 는 is_opt_out 을 받지 않는다(FIELD_MAP 21 컬럼 ·
  //   Zod 도 지운다) — sms_opt_in=false 로 보내야 서버 reconcileSyncUnsubscribes 가 수신거부로 등록한다(엠티 YN_WITHDRAW · 질의서 3-7).
  //   알아볼 수 없는 값(탈퇴일 등)도 거부로 접는다 — 탈퇴 회원 광고 발송 = 정보통신망법. 그 글자는 opt_out_unknown 으로 배치 한 줄 로그(engine).
  //   ⛔ 빈 값·N 은 손대지 않는다(수신동의 미제공이면 미제공 그대로 = 서버 기존 값 보존).
  if ('is_opt_out' in result) {
    const rawOptOut = result.is_opt_out;
    delete result.is_opt_out;
    const flag = normalizeOptOutFlag(rawOptOut);
    const optOutUnknown = flag === null && rawOptOut != null && String(rawOptOut).trim() !== '';
    if (flag === true || optOutUnknown) {
      result.sms_opt_in = false;
      delete result.sms_opt_in_unknown;
      if (optOutUnknown) result.opt_out_unknown = String(rawOptOut).trim().slice(0, 20);
    }
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

  // ★2026-09-13(3) 싱크 ⓒ 동기화 매핑(mapRow)은 custom 슬롯을 custom_fields 아래에 넣는다 — 위 최상위 루프가 닿지 않던 자리.
  if (result.custom_fields) result.custom_fields = normalizeSyncCustomFields(result.custom_fields, opts?.dbType);

  return result;
}

/**
 * 동기화 매핑 custom_fields(mapRow 결과) 값 정리 — 고객·구매 공용(★ 2026-10-15 구매도 같은 규칙).
 *   ⛔ 새 객체로 만든다(호출부 `{ ...mapped }`는 얕은 복사라 제자리 수정은 넘긴 행을 바꾼다).
 *   ⛔ Buffer 값은 키를 뺀다. null로 보내면 서버 병합이 저장된 값을 지운다.
 *   객체가 아니면 손대지 않는다.
 */
function normalizeSyncCustomFields(cf: unknown, dbType?: DbType): unknown {
  if (!cf || typeof cf !== 'object' || Array.isArray(cf)) return cf;
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(cf as Record<string, unknown>)) {
    if (Buffer.isBuffer(val)) continue;
    out[k] = normalizeSyncCustomFieldValue(val, dbType);
  }
  return out;
}

// ─── 구매 데이터 정규화 ─────────────────────────────────

export function normalizePurchase(
  mapped: Record<string, unknown>,
  opts?: { dbType?: DbType },
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...mapped };

  if ('customer_phone' in result) {
    result.customer_phone = normalizePhone(result.customer_phone);
  }

  if ('purchase_date' in result) {
    result.purchase_date = normalizeTimestamp(result.purchase_date, { utcWallClock: opts?.dbType === 'mssql' });
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

  // ★ 2026-10-15 구매 custom 슬롯도 고객과 같은 규칙(날짜 = 원본 벽시계 글자 · Buffer 제외) — 서버가 구매 custom_fields 로 적재한다.
  //   옛: 정리 없이 보내 날짜 칸이 UTC ISO 글자(KST 자정 = 전날 15:00Z)로 나갔다(서버는 그동안 받지 않고 버렸다).
  if (result.custom_fields) result.custom_fields = normalizeSyncCustomFields(result.custom_fields, opts?.dbType);

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

export function normalizeCustomerBatch(rows: Record<string, unknown>[], opts?: { dbType?: DbType; valueMaps?: ValueMaps }): NormalizationResult {
  const normalized: Record<string, unknown>[] = [];
  const dropped: NormalizationResult['dropped'] = [];

  for (const row of rows) {
    const result = normalizeCustomer(row, opts);

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

export function normalizePurchaseBatch(rows: Record<string, unknown>[], opts?: { dbType?: DbType }): NormalizationResult {
  const normalized: Record<string, unknown>[] = [];
  const dropped: NormalizationResult['dropped'] = [];

  for (const row of rows) {
    const result = normalizePurchase(row, opts);

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
