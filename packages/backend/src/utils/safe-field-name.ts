/**
 * custom_fields JSONB 키 화이트리스트 검증
 *
 * SQL Injection 방지: custom_fields->>'키' 에 사용자 입력이 삽입되는 곳에서
 * 반드시 이 함수로 검증 후 삽입한다.
 *
 * 허용 키: custom_1 ~ custom_15 (customers 테이블 custom_fields JSONB 구조)
 */
import { escapeLiteral } from 'pg';

const VALID_CUSTOM_KEYS = new Set(
  Array.from({ length: 15 }, (_, i) => `custom_${i + 1}`)
);

/**
 * custom_fields JSONB 키가 유효한지 검증
 * @param name - 검증할 필드 키 (예: 'custom_1', 'custom_15')
 * @returns true면 안전하게 SQL에 삽입 가능
 */
export function isValidCustomFieldKey(name: string): boolean {
  return VALID_CUSTOM_KEYS.has(name);
}

/**
 * custom_fields JSONB 값 접근식 — 키가 화이트리스트(custom_1~15) 밖일 수 있는 자리용.
 *
 * ★ 2026-09-25 한줄로 전수점검 C-13: jsonb_object_keys로 모은 키(자사몰 CDP identify가 외부 키를 그대로 병합)와
 *   customer_field_definitions.field_key(`custom_` 접두만 검사)를 따옴표로만 감싸 SQL에 넣던 자리가 있었다.
 *   키에 작은따옴표를 넣으면 뒤를 주석 처리하고 UNION으로 다른 고객사 데이터를 읽을 수 있었다.
 *   키는 pg escapeLiteral로 감싼다 — 평범한 키는 종전과 글자 하나 다르지 않은 SQL이 나온다(`custom_fields->>'custom_1'`).
 *   화이트리스트 키만 받는 자리는 isValidCustomFieldKey 검증이 우선이다.
 */
export function customFieldRef(key: string, tableAlias?: string): string {
  const col = tableAlias ? `${tableAlias}.custom_fields` : 'custom_fields';
  return `${col}->>${escapeLiteral(String(key))}`;
}
