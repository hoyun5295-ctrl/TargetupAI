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
import { reverseDisplayValue, FIELD_DISPLAY_MAP, renderFieldValue } from './standard-field-map';
import { cellToString } from './normalize';
import { query } from '../config/database';
import { renderLiquid, detectLiquidSyntax, flattenCustomerForLiquid, stripLiquidLeftovers } from './liquid-templating';
import { applyVarFallback } from './var-fallback';

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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 0-C) 잔여 %변수% 안전장치 컨트롤타워 (D144 후속 P2 — 2026-05-06)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * fieldMappings 순회 후 잔여 %변수명% 패턴을 빈문자열로 제거.
 *
 * ★ 시작 문자 한글/영문/언더스코어 강제 — 사용자 본문 보존:
 *   - %이름% / %name% / %기타1% — 한글/영문/언더스코어 시작 → 매칭 (정상 변수)
 *   - %~30% / %50% — 특수문자/숫자 시작 → 매칭 안 됨 (사용자 본문 "50%~30% 할인")
 *
 * 의도: 오타/매핑 안 된 변수만 제거. 본문 % 문자는 보존.
 *
 * @param text 원본 메시지 (이미 fieldMappings 순회 완료 상태)
 * @returns 잔여 %변수% 제거된 메시지
 */
export function cleanLeftoverVars(text: string): string {
  if (!text) return '';
  return text.replace(/%[가-힣A-Za-z_][^%\s]{0,19}%/g, '');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1) 핵심 치환 함수
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 주소록(직접발송) 수신자의 기타 필드 타입
 * - 직접발송 시 recipients 배열의 각 항목에서 전달됨
 * - %기타1%, %기타2%, %기타3%, %회신번호% 치환에 사용
 */
export interface AddressBookFields {
  // ★ D150-3 (2026-05-09) PDF #5: number 허용 — 엑셀 셀이 number 0으로 도착해도 수용
  name?: string | number;
  extra1?: string | number;
  extra2?: string | number;
  extra3?: string | number;
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
  addressBookFields?: AddressBookFields,
  options?: {
    skipNumberFormatting?: boolean;
    // ★ D191 (2026-05-22) Phase B-1 Liquid Templating: 회사 컨텍스트 (Liquid {{ company.name }} 영역 지원)
    company?: { name?: string; brand_name?: string };
    // ★ D191: 테스트 분리용 (Liquid 미적용 강제) — backward compat 검증 영역
    skipLiquid?: boolean;
    // ★ D201 (2026-05-22) Phase B-3 Connected Content: 외부 데이터 (날씨/재고/가격/신상품) Liquid context 통합
    externalContext?: Record<string, any>;
    // ★ 2026-06-22: 변수 대체값 (빈 값 시 적용, 키=변수명). 미전달 시 기존 동작 — 직접발송 불변.
    fieldDefaults?: Record<string, string>;
  }
): string {
  if (!template) return '';

  let result = template;

  // 0단계: 주소록 기타 필드 치환 (직접발송 경로)
  // — fieldMappings에 없는 주소록 전용 변수를 먼저 치환하여 안전망에 잡히지 않도록
  if (addressBookFields) {
    // ★ D123: 직접발송은 고객 원본 데이터 그대로 (skipNumberFormatting=true), AI발송만 포맷팅
    // ★ D150-3 (2026-05-09) PDF #5: cellToString 컨트롤타워(normalize.ts) 사용 — 0/'0' 보존 통일
    const fmtExtra = (val: string | number | null | undefined): string => {
      const s = cellToString(val);
      if (s === '') return '';
      if (options?.skipNumberFormatting) return s;
      return formatNumericLike(s) ?? s;
    };
    result = result
      .replace(/%기타1%/g, fmtExtra(addressBookFields.extra1))
      .replace(/%기타2%/g, fmtExtra(addressBookFields.extra2))
      .replace(/%기타3%/g, fmtExtra(addressBookFields.extra3))
      .replace(/%회신번호%/g, addressBookFields.callback || '');

    // ★ D111 P2: 이름 폴백
    //   - customer가 없으면 주소록 name 사용 (기존 로직)
    //   - customer는 있지만 customer.name이 비어있으면 주소록 name으로 폴백 (NEW)
    //   - customer.name이 있어도 아래 1단계 fieldMappings 치환이 동일한 결과를 내므로 덮어써도 무관
    // ★ D150-3 (2026-05-09) PDF #5: cellToString 컨트롤타워 활용 — 0/'0' 보존
    const customerNameEmpty = !customer || !customer.name || String(customer.name).trim() === '';
    const fbName = cellToString(addressBookFields.name).trim();
    if (customerNameEmpty && fbName) {
      // 이름+고객명+성함 등 FIELD_MAP.aliases 키 전부 커버 (가장 흔한 한글 변수명)
      result = result
        .replace(/%이름%/g, fbName)
        .replace(/%고객명%/g, fbName)
        .replace(/%성함%/g, fbName);
    } else if (!customer) {
      // customer도 없고 addressBookFields.name도 없으면 빈값으로 처리 (안전망 진입 전 선치환)
      result = result.replace(/%이름%/g, '').replace(/%고객명%/g, '').replace(/%성함%/g, '');
    }
  }

  // ★ D191 (2026-05-22) Phase B-1 Liquid Templating
  // Step 1: Liquid 렌더링 (Shopify 표준 호환 — {{ customer.X }} / {% if X %} ... {% endif %})
  // - detectLiquidSyntax = false 시 자동 skip (backward compat 100% 정합 — 기존 %변수% 캠페인 영향 0)
  // - 오류 시 원본 텍스트 반환 (발송 차단 X)
  // - 주소록 fallback 후 + fieldMappings 치환 전 위치 — 영문 column 표준 우선
  // - ★ D201 Phase B-3: externalContext (weather/inventory/price/product) 통합
  if (!options?.skipLiquid && detectLiquidSyntax(result)) {
    const liquidResult = renderLiquid(result, {
      customer: flattenCustomerForLiquid(customer),
      company: options?.company,
      now: new Date(),
      ...(options?.externalContext || {}),
    });
    result = liquidResult.rendered;
    if (liquidResult.errors.length > 0) {
      console.warn('[Liquid] 렌더링 오류:', JSON.stringify(liquidResult.errors));
    }
    // ★ 2026-07-06 발송 최후 방어 — 렌더 후에도 태그가 남으면(파서 오류 시 원본 반환·부분 렌더) 태그만 제거.
    //   어떤 엣지에도 고객에게 {{ }}·{% %} 원문이 발송되지 않는 것을 코드가 보장.
    //   정상 렌더(잔존 0)는 detect=false로 무접촉 — 발송 5경로 기존 동작 영향 0.
    if (detectLiquidSyntax(result)) {
      console.warn('[Liquid] 렌더 후 잔존 태그 검출 → 최후 방어 제거');
      result = stripLiquidLeftovers(result);
    }
  }

  // customer나 fieldMappings 없으면 주소록 치환만 하고 안전망 적용 후 반환
  if (!customer || !fieldMappings) {
    result = cleanLeftoverVars(result);
    return result;
  }

  // 2단계: fieldMappings 기반 DB 필드 치환
  // ★ D142 (2026-04-28): renderFieldValue 단일 진입점으로 단순화 — Harold님 원칙 그대로 구현.
  //   "고정 22개 = FIELD_DISPLAY_FORMAT_MAP 룰대로 / 커스텀(custom_1~15) = 있는 그대로"
  //
  //   이전: mapping.type === 'number' 자동 추론 → custom_* varchar에 콤마 찍히는 사고 반복
  //         (D104, D136 P1, D141 PDF B5, 0428 PDF #5 — 1년 넘게 N회 재발).
  //   신:   mapping.column이 fieldKey 역할 → FIELD_DISPLAY_FORMAT_MAP 매칭 = 룰대로,
  //         매칭 실패(= custom_*, 미지정 키) = String(value) 원본 자동 보존.
  //
  //   skipNumberFormatting 옵션: 호환성 위해 시그니처 유지하되 새 구조에서는 의미 없음
  //   (커스텀 필드는 자동 원본 보존이 동일한 효과 — 옛 D123 의도 그대로 달성).
  for (const [varName, mapping] of Object.entries(fieldMappings)) {
    const pattern = `%${varName}%`;
    if (!result.includes(pattern)) continue;

    // 1차: 최상위 필드에서 조회
    let rawValue = customer[mapping.column];

    // 2차: custom_fields JSONB 내부에서 조회
    if (rawValue === undefined || rawValue === null) {
      rawValue = customer.custom_fields?.[mapping.column] ?? null;
    }

    // ★ D142: 단일 진입점 — mapping.column이 fieldKey.
    //   22개 고정(name/phone/gender/age/birth_date/email/address/region/...) → FIELD_DISPLAY_FORMAT_MAP
    //   custom_1~15 + 미지정 키 → String(value) 원본 (자동 보존)
    const rendered = renderFieldValue(rawValue, mapping.column);
    // ★ 2026-06-22: 빈 값이면 대체값 적용 (fieldDefaults 미전달 시 원래 값 — 직접발송 불변)
    const displayValue = applyVarFallback(rendered, varName, options?.fieldDefaults);

    // 전역 치환 (동일 변수가 여러 번 나올 수 있음)
    result = result.split(pattern).join(displayValue);
  }

  // 3단계 안전장치: 매핑에 없는 잔여 %...% 패턴 제거 (D144 P2: 시작 문자 한글/영문 강제로 본문 % 보존)
  result = cleanLeftoverVars(result);

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
  // ★ D123: opt_out_080_number가 비어있으면 reject_number 폴백 (D120 이전 데이터 호환)
  const compResult = await query(`SELECT COALESCE(NULLIF(opt_out_080_number, ''), reject_number) AS opt080 FROM companies WHERE id = $1`, [companyId]);
  return compResult.rows[0]?.opt080 || '';
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
  if (!isAd) return message;

  const isLms = msgType === 'LMS' || msgType === 'MMS';
  const adPrefix = isLms ? '(광고) ' : '(광고)';

  // ★ D137 (0423 D2 근본): minBreaks=1 통일 — LMS/MMS 강제 빈 줄 삭제
  //   - 히스토리:
  //     · D124: "무료수신거부 앞 빈 줄 필수(가독성)" 요구 → minBreaks=2 (LMS/MMS)
  //     · D136 D2: SMS만 minBreaks=1 완화, LMS/MMS는 여전히 2 → 사용자 불만 재발
  //     · D137: 모든 타입 minBreaks=1 통일. 빈 줄은 아래 2가지 경로로만 발생
  //   - 빈 줄 발생 경로:
  //     1) AI 경로: ai.ts 자동제거 regex `\n?` → `` (D137 수정)으로 \n 1개 보존 →
  //        AI 생성 본문 `...\n\n[브랜드명]\n\n`이 trailingCount=2로 전달 → 빈 줄 1개 유지
  //     2) 직접발송/직접타겟: 고객이 본문 끝 줄바꿈 입력한 만큼 그대로 반영
  //   - SMS/LMS/MMS 공통: 최소 1개 개행 보장 (무료거부가 본문에 안 붙도록)
  //   - AI 문안이 이미 "무료수신거부 080..."을 포함하면 hasRejectFooter=true → 원본 그대로
  //   - D102/D103 안전장치(중복 방지)는 그대로 유지
  const hasAdPrefix = /^\s*[(（]\s*광고\s*[)）]/.test(message); // 반각·전각 (광고) 모두 인식 — 이중부착 방지
  const hasRejectFooter = /무료수신거부|무료거부/.test(message);

  const finalPrefix = hasAdPrefix ? '' : adPrefix;

  // 본문 끝 개행 카운트 + 최소 1개 보장 (무료거부가 본문에 안 붙도록)
  const trailingMatch = message.match(/\n*$/);
  const trailingCount = trailingMatch ? trailingMatch[0].length : 0;
  const minBreaks = 1;
  const actualBreaks = Math.max(trailingCount, minBreaks);

  const rejectText = opt080Number
    ? (isLms ? `무료수신거부 ${opt080Number}` : `무료거부${opt080Number.replace(/-/g, '')}`)
    : (isLms ? `무료수신거부` : `무료거부`);

  const finalFooter = hasRejectFooter ? '' : `${'\n'.repeat(actualBreaks)}${rejectText}`;
  const body = finalFooter ? message.replace(/\n+$/, '') : message;

  return `${finalPrefix}${body}${finalFooter}`;
}

/**
 * ★ D142+ (2026-04-29) 0429 PDF B1 — INSERT 직전 D103 강제 정규화 컨트롤타워
 *
 * frontend `formatDate.ts:909 stripAdParts`와 정확히 동일 로직(미러).
 * 사용자가 textarea에 (광고)/무료거부를 직접 박은 변칙 입력을 정규화하여
 * DB의 `campaigns.message_content`는 항상 "순수본문"만 저장되도록 강제한다.
 *
 * 사용처: campaigns.ts direct-send / POST `/` AI 캠페인 등 INSERT 직전
 * 호출부 패턴:
 *   const sanitized = stripAdParts(rawMessage);
 *   const hadMarker = sanitized !== rawMessage;
 *   const finalIsAd = (req.body.adEnabled === true) || hadMarker;  // 자동 승격
 *
 * 정규식은 buildAdMessage가 만드는 정확한 패턴만 매칭 — 본문 내부 텍스트 훼손 방지.
 * idempotent: 이미 순수본문이면 변화 없음. 여러 번 적용해도 동일 결과.
 */
export function stripAdParts(text: string): string {
  if (!text) return '';
  let result = text;
  // 끝의 무료수신거부 (LMS) 제거: "\n무료수신거부 080-xxx-xxxx"
  result = result.replace(/\s*\n?\s*무료수신거부\s*[\d-]+\s*$/g, '');
  // 끝의 무료거부 (SMS) 제거: "\n무료거부080xxxxxxxx"
  result = result.replace(/\s*\n?\s*무료거부\d+\s*$/g, '');
  // 시작의 (광고) prefix 제거 (반각 "(광고)" + 전각 "（광고）" + 내부/양끝 공백)
  result = result.replace(/^\s*[(（]\s*광고\s*[)）]\s*/g, '');
  return result;
}

/**
 * ★ 2026-07-02: 깊은 제거 버전 — 본문 "중간"에 들어간 (광고)/무료수신거부 문구까지 제거.
 * 문구가 본문 어디든 남아 있으면 buildAdMessage(hasRejectFooter)가 설정 080 합성을 건너뛰어
 * 문안 속 임의 번호가 그대로 발송되는 결함 차단용 — DM 타겟 발송 문안 정리에 사용.
 * 주의: 해당 문구가 포함된 텍스트 조각을 지우므로, buildAdMessage 정확 패턴만 걷어내야 하는
 * 기존 경로(campaigns direct-send 등)는 계속 stripAdParts를 사용한다.
 */
export function stripAdPartsDeep(text: string): string {
  if (!text) return '';
  let result = stripAdParts(text);
  // 본문 중간의 무료수신거부/무료거부 문구 + 뒤따르는 번호 제거
  result = result.replace(/[ \t]*(?:무료\s*수신\s*거부|무료거부)[ \t]*[:：]?[ \t]*[\d-]*[ \t]*/g, '');
  // 본문 중간의 (광고) 마커 제거 (반각·전각)
  result = result.replace(/[(（]\s*광고\s*[)）][ \t]*/g, '');
  // 제거로 생긴 빈 줄/꼬리 공백 정리
  result = result.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return result;
}

/**
 * ★ KISA 2026-05: LMS/MMS 제목에 (광고) 자동 부착
 * - isAd=true + LMS/MMS일 때만 제목 앞에 "(광고) " 접두사
 * - SMS는 제목 필드 없으므로 원본 반환
 * - 중복 방지: 이미 (광고)로 시작하면 안 붙임
 * - prepareSendMessage 내부에서 호출됨 (컨트롤타워 단일 진입점)
 * - spam-test-queue.ts처럼 prepareSendMessage 미사용 경로에서는 직접 import
 */
export function buildAdSubject(subject: string, msgType: string, isAd: boolean): string {
  if (!isAd) return subject;
  if (msgType !== 'LMS' && msgType !== 'MMS') return subject;
  if (!subject) return '(광고)';
  if (/^\s*[(（]\s*광고\s*[)）]/.test(subject)) return subject; // 중복 방지 (반각·전각)
  return `(광고) ${subject}`;
}

/**
 * ★ D103: 발송 메시지 최종 준비 컨트롤타워
 * 모든 발송 경로(AI즉시/AI예약/직접/타겟/자동발송)의 유일한 진입점.
 * 변수 치환 → (광고)+080 조합을 한 함수로 통합.
 * 각 발송 경로에서 replaceVariables + buildAdMessage를 인라인으로 호출하던 패턴을 제거.
 *
 * ★ KISA 2026-05: subject도 통합 처리. isAd=true + LMS/MMS일 때 제목에 (광고) 자동 부착.
 *   호출부에서 subject를 별도 처리할 필요 없이 반환값의 subject를 그대로 사용.
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
    subject?: string;
    skipNumberFormatting?: boolean;  // ★ D123: 직접발송은 고객 원본 데이터 그대로
    // ★ D191 (2026-05-22) Phase B-1 Liquid Templating: Liquid 컨텍스트 (회사 정보)
    company?: { name?: string; brand_name?: string };
    skipLiquid?: boolean;
    // ★ D201 (2026-05-22) Phase B-3: Connected Content 외부 데이터
    externalContext?: Record<string, any>;
  }
): { message: string; subject: string } {
  // 1. 변수 치환 (Liquid 렌더링 + %변수% 치환 통합)
  let msg = replaceVariables(template, customer, fieldMappings, options.addressBookFields, {
    skipNumberFormatting: options.skipNumberFormatting,
    company: options.company,
    skipLiquid: options.skipLiquid,
    externalContext: options.externalContext,
  });
  // 2. (광고)+080 본문 (중복 방지 안전장치 내장)
  msg = buildAdMessage(msg, options.msgType, options.isAd, options.opt080Number);
  // 3. ★ KISA 2026-05: 제목 (광고) 부착 (isAd + LMS/MMS만)
  //    ★ D191-fix1 (2026-05-22) Harold 명시: 제목은 변수/Liquid 사용 X — 단순 본문 요약 텍스트만 정합 (가독성 + 통신사 표시 영역 좁음)
  const subj = buildAdSubject(options.subject || '', options.msgType, options.isAd);
  return { message: msg, subject: subj };
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
