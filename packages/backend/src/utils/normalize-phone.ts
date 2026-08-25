/**
 * 전화번호 정규화 유틸리티
 *
 * 모든 비숫자 문자를 제거하여 일관된 전화번호 형식을 보장합니다.
 * campaigns.ts, spam-filter.ts 등 전체 모듈에서 동일한 정규화 함수를 사용합니다.
 *
 * 패턴: /\D/g (비숫자 전체 제거) — 하이픈(-), 공백, 괄호, 점 등 모두 처리
 * 기존 replace(/-/g, '') → normalizePhone() 으로 통일
 */

/**
 * 전화번호에서 모든 비숫자 문자를 제거
 * @param phone - 원본 전화번호 문자열
 * @returns 숫자만 남은 전화번호 (예: '010-1234-5678' → '01012345678')
 */
export function normalizePhone(phone: string): string {
  if (!phone || typeof phone !== 'string') return '';
  return phone.replace(/\D/g, '');
}

/**
 * 엑셀 숫자 셀이 떨어뜨린 휴대폰 앞자리 0 복원 (★2026-08-26 대행발송 §18-4 · Harold 실물 명단).
 *
 * 엑셀은 "01052958517"을 숫자 셀로 저장하면 "1052958517"로 만든다. 숫자만 10자리이고
 * `1[016789]`로 시작하는 값만 휴대폰의 0 유실로 보고 앞에 0을 붙인다.
 * ⛔ 구형 011 완성형(10자리)의 0 유실분(9자리)은 복원하지 않는다 — 오복원 위험이 더 크다.
 * ⛔ 기존 `normalizePhone`의 동작은 바꾸지 않는다(전 플랫폼 소비처 영향 0 · 이 함수는 대행발송 명단 경로 전용).
 */
export function restoreMobileLeadingZero(digits: string): string {
  return /^1[016789]\d{8}$/.test(String(digits || '')) ? `0${digits}` : String(digits || '');
}

/** 대행발송 명단·요청서 번호 정규화 = 숫자만 남기고 휴대폰 0 유실 복원. 소비처 = 대행발송 접수·파서 경로만 */
export function normalizeAgencyPhone(raw: any): string {
  return restoreMobileLeadingZero(normalizePhone(String(raw ?? '')));
}
