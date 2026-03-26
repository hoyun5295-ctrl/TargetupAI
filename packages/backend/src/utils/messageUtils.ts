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

import { VarCatalogEntry } from '../services/ai';
import { query } from '../config/database';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 0) 커스텀 필드 동적 매핑 보강
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
      `SELECT field_key, field_label FROM customer_field_definitions
       WHERE company_id = $1 AND (is_hidden = false OR is_hidden IS NULL)`,
      [companyId]
    );
    for (const def of defResult.rows) {
      const label = def.field_label || def.field_key;
      // 이미 있으면 덮어쓰지 않음 (FIELD_MAP 기본 displayName 우선)
      if (!fieldMappings[label]) {
        fieldMappings[label] = {
          column: def.field_key,  // custom_1, custom_2, ... → custom_fields JSONB 내 키
          type: 'string',
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

    // customer가 없으면 (DB에 없는 수신자) 이름도 주소록에서 치환
    if (!customer) {
      result = result.replace(/%이름%/g, addressBookFields.name || '');
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
    } else if (mapping.type === 'number') {
      // ★ D88: PostgreSQL numeric 필드는 string으로 올 수 있음 — 숫자 파싱 후 포맷
      const numVal = typeof rawValue === 'number' ? rawValue : Number(String(rawValue).replace(/,/g, ''));
      displayValue = !isNaN(numVal) ? numVal.toLocaleString() : String(rawValue);
    } else if (mapping.type === 'date' && rawValue) {
      // ★ D85: 날짜 KST 고정 — UTC ISO raw 문자열(2003-04-10T15:00:00.000Z) 노출 방지
      try {
        displayValue = new Date(rawValue).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
      } catch {
        displayValue = String(rawValue);
      }
    } else {
      // ★ D85+D95: 날짜 패턴 자동 감지 — ISO 타임스탬프 + 순수 YYYY-MM-DD 모두 KST 포맷
      const strVal = String(rawValue);
      if (/^\d{4}-\d{2}-\d{2}($|T|\s)/.test(strVal)) {
        try {
          displayValue = new Date(strVal).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
        } catch {
          displayValue = strVal;
        }
      } else {
        displayValue = strVal;
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
