/**
 * messageUtils.ts — 발송 파이프라인 공통 치환 함수
 *
 * 목적: 5개 발송 경로(AI/직접/테스트/스팸필터/예약수정)의 변수 치환을
 *       이 파일 하나로 통합. 한 곳만 수정하면 전체 반영.
 *
 * 위치: packages/backend/src/utils/messageUtils.ts
 * 생성: 2026-02-26 (D32 발송 파이프라인 전면 복구)
 *
 * 의존: services/ai.ts의 VarCatalogEntry, extractVarCatalog 재사용
 */

import { VarCatalogEntry, extractVarCatalog } from '../services/ai';
import { formatNumericLike } from './format-number';
import { reverseDisplayValue, FIELD_DISPLAY_MAP } from './standard-field-map';
import { query } from '../config/database';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 0-A) 날짜 포맷팅 헬퍼 — 순수 YYYY-MM-DD는 new Date() 없이 직접 파싱
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * ★ D100: 날짜 값을 한국어 포맷으로 변환
 *
 * 순수 YYYY-MM-DD → 직접 파싱 (new Date() 사용 시 UTC 자정 해석 → KST 변환에서 하루 밀림)
 * ISO 타임스탬프(YYYY-MM-DDT...) → new Date() + KST 변환
 *
 * 프론트 formatDate.ts의 formatDate()와 동일한 방식.
 * D99까지 new Date("1995-03-01")로 파싱 → UTC 자정 → KST -9h → "1995. 2. 28." 버그 발생.
 */
export function formatDateValue(value: any): string {
  if (value == null || value === '') return '';

  // Date 객체 직접 처리 — String(Date)은 영문 형식이므로 직접 변환
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
  }

  const str = String(value).trim();

  // 순수 YYYY-MM-DD — UTC 변환 없이 직접 파싱 (하루 밀림 방지)
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const [y, m, d] = str.split('-').map(Number);
    if (y > 0 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}. ${m}. ${d}.`;
    }
  }

  // YYYYMMDD 8자리 — 날짜로 직접 파싱
  if (/^\d{8}$/.test(str)) {
    const y = parseInt(str.substring(0, 4));
    const m = parseInt(str.substring(4, 6));
    const d = parseInt(str.substring(6, 8));
    if (y > 0 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}. ${m}. ${d}.`;
    }
  }

  // ★ D101: YYMMDD 6자리 — 날짜로 직접 파싱 (260331 → 2026. 3. 31.)
  if (/^\d{6}$/.test(str)) {
    const yy = parseInt(str.substring(0, 2));
    const m = parseInt(str.substring(2, 4));
    const d = parseInt(str.substring(4, 6));
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      const y = yy >= 0 && yy <= 50 ? 2000 + yy : 1900 + yy;
      return `${y}. ${m}. ${d}.`;
    }
  }

  // ISO 타임스탬프(T 또는 공백 포함) — KST 변환
  try {
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
    }
  } catch { /* ignore */ }

  return str;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 0-B) 커스텀 필드 동적 매핑 보강
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * fieldMappings에 회사별 커스텀 필드(customer_field_definitions)를 동적 추가
 *
 * - extractVarCatalog()은 FIELD_MAP 기반이라 storageType='custom_fields'를 건너뜀
 * - AI맞춤한줄(generateCustomMessages)은 커스텀 필드 라벨(%선호스타일% 등)을 사용
 * - 실제 발송 시 fieldMappings에 없으면 안전망 regex가 빈값으로 제거 → 미리보기와 불일치
 * - 이 함수가 customer_field_definitions 조회 → fieldMappings에 추가하여 해결
 *
 * ★ B-D70-16 수정: 미리보기 vs 실제 발송 개인화 불일치 해결
 *
 * @param fieldMappings  extractVarCatalog()에서 받은 기본 매핑 (in-place 수정)
 * @param companyId      회사 ID
 * @returns 보강된 fieldMappings (원본 객체 반환)
 */
export async function enrichWithCustomFields(
  fieldMappings: Record<string, VarCatalogEntry>,
  companyId: string
): Promise<Record<string, VarCatalogEntry>> {
  try {
    const defResult = await query(
      `SELECT field_key, field_label, field_type FROM customer_field_definitions
       WHERE company_id = $1 AND (is_hidden = false OR is_hidden IS NULL)`,
      [companyId]
    );
    for (const def of defResult.rows) {
      const label = def.field_label || def.field_key;
      // ★ D101: field_type 기반 동적 type 설정 (기존 'string' 하드코딩 → 동적)
      // field_type: VARCHAR→string, NUMBER/INTEGER→number, DATE/DATETIME→date
      // ⚠️ VARCHAR 자동 샘플링은 하지 않음 — 시리얼/고객번호(정수)에 쉼표 찍히는 부작용 방지
      // VARCHAR인 경우 replaceVariables else 분기에서 소수점(".") 있는 값만 숫자 포맷팅
      const ft = (def.field_type || 'VARCHAR').toUpperCase();
      const mappedType: 'string' | 'number' | 'date' =
        ft === 'NUMBER' || ft === 'INTEGER' || ft === 'NUMERIC' ? 'number' :
        ft === 'DATE' || ft === 'DATETIME' ? 'date' : 'string';
      // 이미 있으면 덮어쓰지 않음 (FIELD_MAP 기본 displayName 우선)
      if (!fieldMappings[label]) {
        fieldMappings[label] = {
          column: def.field_key,
          type: mappedType,
          description: label,
          sample: '',
          storageType: 'custom_fields',
        };
      }
    }
  } catch (e) {
    // 조회 실패 시 기본 매핑으로 진행 (발송 중단하지 않음)
    console.warn('[enrichWithCustomFields] customer_field_definitions 조회 실패:', e);
  }
  return fieldMappings;
}
// 1) 핵심 치환 함수
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 주소록(직접발송) 수신자의 기타 필드 타입
 * - 직접발송 시 recipients 배열의 각 항목에서 전달됨
 * - %기타1%, %기타2%, %기타3%, %회신번호% 치환에 사용
 */
export interface AddressBookFields {
  name?: string;
  extra1?: string;
  extra2?: string;
  extra3?: string;
  callback?: string;
}

/**
 * 단건 메시지 변수 치환 (모든 발송 경로의 유일한 치환 함수)
 *
 * 실행 흐름:
 *  0. (직접발송) 주소록 기타 필드 치환 — %기타1/2/3%, %회신번호%
 *  1. fieldMappings 순회 — %한글라벨% → customer[column] 치환
 *     - column이 최상위에 없으면 custom_fields JSONB에서 탐색
 *     - 타입별 포맷: number → toLocaleString(), date → toLocaleDateString('ko-KR')
 *  2. 잔여 %...% 패턴 → 빈문자열 strip (안전장치)
 *
 * @param template          원본 메시지 (예: "%이름%님, %등급% 전용 혜택!")
 * @param customer          고객 데이터 (DB row). phone, name, grade, custom_fields 등. null이면 주소록 필드만 치환.
 * @param fieldMappings     { 한글라벨: VarCatalogEntry } — extractVarCatalog()에서 추출
 * @param addressBookFields (선택) 직접발송 주소록 기타 필드. 전달 시 %기타1/2/3%, %회신번호% 치환.
 *                          customer가 null이면 %이름%도 여기서 치환.
 * @returns 치환 완료된 메시지
 */
export function replaceVariables(
  template: string,
  customer: Record<string, any> | null,
  fieldMappings: Record<string, VarCatalogEntry>,
  addressBookFields?: AddressBookFields
): string {
  if (!template) return '';

  let result = template;

  // 0단계: 주소록 기타 필드 치환 (직접발송 경로)
  // — fieldMappings에 없는 주소록 전용 변수를 먼저 치환하여 안전망에 잡히지 않도록
  if (addressBookFields) {
    result = result
      .replace(/%기타1%/g, addressBookFields.extra1 || '')
      .replace(/%기타2%/g, addressBookFields.extra2 || '')
      .replace(/%기타3%/g, addressBookFields.extra3 || '')
      .replace(/%회신번호%/g, addressBookFields.callback || '');

    // ★ D111 P2: 이름 폴백
    //   - customer가 없으면 주소록 name 사용 (기존 로직)
    //   - customer는 있지만 customer.name이 비어있으면 주소록 name으로 폴백 (NEW)
    //   - customer.name이 있어도 아래 1단계 fieldMappings 치환이 동일한 결과를 내므로 덮어써도 무관
    const customerNameEmpty = !customer || !customer.name || String(customer.name).trim() === '';
    if (customerNameEmpty && addressBookFields.name) {
      // 이름+고객명+성함 등 FIELD_MAP.aliases 키 전부 커버 (가장 흔한 한글 변수명)
      result = result
        .replace(/%이름%/g, addressBookFields.name)
        .replace(/%고객명%/g, addressBookFields.name)
        .replace(/%성함%/g, addressBookFields.name);
    } else if (!customer) {
      // customer도 없고 addressBookFields.name도 없으면 빈값으로 처리 (안전망 진입 전 선치환)
      result = result.replace(/%이름%/g, '').replace(/%고객명%/g, '').replace(/%성함%/g, '');
    }
  }

  // customer나 fieldMappings 없으면 주소록 치환만 하고 안전망 적용 후 반환
  if (!customer || !fieldMappings) {
    result = result.replace(/%[^%\s]{1,20}%/g, '');
    return result;
  }

  // 1단계: fieldMappings 기반 DB 필드 치환
  for (const [varName, mapping] of Object.entries(fieldMappings)) {
    const pattern = `%${varName}%`;
    if (!result.includes(pattern)) continue;

    // 1차: 최상위 필드에서 조회
    let rawValue = customer[mapping.column];

    // 2차: custom_fields JSONB 내부에서 조회
    if (rawValue === undefined || rawValue === null) {
      rawValue = customer.custom_fields?.[mapping.column] ?? null;
    }

    // 타입별 포맷팅
    let displayValue = '';
    if (rawValue === null || rawValue === undefined) {
      displayValue = '';
    } else if (FIELD_DISPLAY_MAP[mapping.column]) {
      // ★ B+0407-1: enum 필드(gender 등) → 한글 역변환 (FIELD_DISPLAY_MAP 컨트롤타워)
      displayValue = reverseDisplayValue(mapping.column, rawValue);
    } else if (mapping.type === 'number') {
      // ★ D111: formatNumericLike 컨트롤타워 — 정수/소수 자동 포맷, trailing zero 제거, 전화/YYMMDD 제외
      const fmt = formatNumericLike(rawValue);
      displayValue = fmt !== null ? fmt : String(rawValue);
    } else if (mapping.type === 'date' && rawValue) {
      // ★ D100: 날짜 KST 고정 — 순수 YYYY-MM-DD는 new Date() 없이 직접 파싱 (하루 밀림 방지)
      displayValue = formatDateValue(rawValue);
    } else {
      const strVal = String(rawValue);
      // ★ D100: 날짜 패턴 자동 감지 — 순수 YYYY-MM-DD는 직접 파싱, ISO는 KST 변환
      if (/^\d{4}-\d{2}-\d{2}($|T|\s)/.test(strVal)) {
        displayValue = formatDateValue(strVal);
      } else {
        // ★ D111: 정수/소수 자동 감지 — formatNumericLike 컨트롤타워 (field_type=VARCHAR 기존 데이터 대응)
        //   이전: /^-?\d+\.\d+$/ (소수점 필수) 패턴 → 정수 50000 감지 못함 → 쉼표 없이 발송
        //   변경: formatNumericLike — 정수도 감지, trailing zero 제거, 전화번호/YYMMDD 제외
        const fmt = formatNumericLike(strVal);
        displayValue = fmt !== null ? fmt : strVal;
      }
    }

    // 전역 치환 (동일 변수가 여러 번 나올 수 있음)
    result = result.split(pattern).join(displayValue);
  }

  // 2단계 안전장치: 매핑에 없는 잔여 %...% 패턴 제거
  result = result.replace(/%[^%\s]{1,20}%/g, '');

  return result;
}

/**
 * 복수 고객 일괄 치환 → 수신자별 {phone, message} 배열 반환
 * AI발송 경로에서 사용
 */
export function bulkReplaceVariables(
  template: string,
  customers: Record<string, any>[],
  fieldMappings: Record<string, VarCatalogEntry>
): { phone: string; message: string }[] {
  return customers.map(customer => ({
    phone: customer.phone,
    message: replaceVariables(template, customer, fieldMappings),
  }));
}

/**
 * 스팸필터/테스트용 — 타겟 최상단(첫 번째) 고객 데이터로 치환
 *
 * Harold님 지시: "실제 발송할 타겟데이터 중 가장 상단에 있는 걸로 테스트"
 * 하드코딩 "김민수/VIP/강남점" 완전 제거
 *
 * @param template       원본 메시지
 * @param customers      발송 대상 고객 배열 (최소 1명)
 * @param fieldMappings  필드 매핑
 * @returns 첫 번째 고객 데이터로 치환된 메시지 (고객 없으면 원본 반환)
 */
export function replaceWithFirstCustomer(
  template: string,
  customers: Record<string, any>[],
  fieldMappings: Record<string, VarCatalogEntry>
): string {
  if (!customers || customers.length === 0) return template;
  return replaceVariables(template, customers[0], fieldMappings);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CT-AD: (광고)+080 수신거부 컨트롤타워
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 080 수신거부번호 조회 — users 우선 → companies fallback
 *
 * ★ D102 컨트롤타워화: campaigns.ts 3곳 + auto-campaign-worker.ts + spam-test-queue.ts에
 *   동일한 080번호 조회 로직이 인라인으로 흩어져 있어서 auto-campaign-worker에서 누락됨.
 *   이 함수 하나로 통합.
 *
 * @param userId    사용자 ID (users.opt_out_080_number 우선)
 * @param companyId 회사 ID (companies.opt_out_080_number fallback)
 * @returns 080번호 문자열 (없으면 '')
 */
export async function getOpt080Number(userId: string | null, companyId: string): Promise<string> {
  if (userId) {
    const userResult = await query('SELECT opt_out_080_number FROM users WHERE id = $1', [userId]);
    const userOpt = userResult.rows[0]?.opt_out_080_number;
    if (userOpt) return userOpt;
  }
  const compResult = await query('SELECT opt_out_080_number FROM companies WHERE id = $1', [companyId]);
  return compResult.rows[0]?.opt_out_080_number || '';
}

/**
 * 메시지에 (광고) 접두사 + 무료거부/무료수신거부 접미사 추가
 *
 * ★ D102 컨트롤타워화: 모든 발송 경로(AI발송, 직접발송, 직접타겟발송, 자동발송, 스팸테스트)에서
 *   이 함수 하나로 (광고)+080 조합. 인라인 코드 전면 제거.
 *
 * SMS: (광고)본문\n무료거부08012345678
 * LMS/MMS: (광고) 본문\n무료수신거부 080-1234-5678
 *
 * @param message     원본 메시지 (순수 본문, (광고) 미포함)
 * @param msgType     메시지 타입 ('SMS' | 'LMS' | 'MMS')
 * @param isAd        광고 여부
 * @param opt080Number 080 수신거부번호 (getOpt080Number로 조회한 값)
 * @returns (광고)+본문+무료거부 조합된 메시지. 광고 아니거나 080번호 없으면 원본 반환.
 */
export function buildAdMessage(
  message: string,
  msgType: string,
  isAd: boolean,
  opt080Number: string
): string {
  if (!isAd || !opt080Number) return message;

  const isLms = msgType === 'LMS' || msgType === 'MMS';
  const adPrefix = isLms ? '(광고) ' : '(광고)';
  const rejectFooter = isLms
    ? `\n무료수신거부 ${opt080Number}`
    : `\n무료거부${opt080Number.replace(/-/g, '')}`;

  // ★ D103: 중복 방지 안전장치 — 이미 (광고)가 있으면 접두사 안 붙임, 이미 수신거부가 있으면 푸터 안 붙임
  const hasAdPrefix = message.startsWith('(광고)');
  const hasRejectFooter = /무료수신거부|무료거부/.test(message);

  const finalPrefix = hasAdPrefix ? '' : adPrefix;
  const finalFooter = hasRejectFooter ? '' : rejectFooter;

  return `${finalPrefix}${message}${finalFooter}`;
}

/**
 * ★ D103: 발송 메시지 최종 준비 컨트롤타워
 * 모든 발송 경로(AI즉시/AI예약/직접/타겟/자동발송)의 유일한 진입점.
 * 변수 치환 → (광고)+080 조합을 한 함수로 통합.
 * 각 발송 경로에서 replaceVariables + buildAdMessage를 인라인으로 호출하던 패턴을 제거.
 */
export function prepareSendMessage(
  template: string,
  customer: Record<string, any> | null,
  fieldMappings: Record<string, VarCatalogEntry>,
  options: {
    msgType: string;
    isAd: boolean;
    opt080Number: string;
    addressBookFields?: AddressBookFields;
  }
): string {
  // 1. 변수 치환
  let msg = replaceVariables(template, customer, fieldMappings, options.addressBookFields);
  // 2. (광고)+080 (중복 방지 안전장치 내장)
  msg = buildAdMessage(msg, options.msgType, options.isAd, options.opt080Number);
  return msg;
}

/**
 * ★ D102: 필드 매핑 준비 컨트롤타워
 * customer_schema 조회 + extractVarCatalog + enrichWithCustomFields 3종 세트를 한 함수로 통합.
 * campaigns.ts 4곳 + spam-filter.ts 1곳 + auto-campaign-worker.ts 1곳 + spam-test-queue.ts 2곳에서
 * 인라인으로 반복되던 코드.
 */
export async function prepareFieldMappings(companyId: string): Promise<Record<string, VarCatalogEntry>> {
  const schemaResult = await query('SELECT customer_schema FROM companies WHERE id = $1', [companyId]);
  const { fieldMappings } = extractVarCatalog(schemaResult.rows[0]?.customer_schema);
  await enrichWithCustomFields(fieldMappings, companyId);
  return fieldMappings;
}
