/**
 * custom_fields JSONB 키 화이트리스트 검증
 *
 * SQL Injection 방지: custom_fields->>'키' 에 사용자 입력이 삽입되는 곳에서
 * 반드시 이 함수로 검증 후 삽입한다.
 *
 * 허용 키: custom_1 ~ custom_15 (customers 테이블 custom_fields JSONB 구조)
 */
/**
 * custom_fields JSONB 키가 유효한지 검증
 * @param name - 검증할 필드 키 (예: 'custom_1', 'custom_15')
 * @returns true면 안전하게 SQL에 삽입 가능
 */
export declare function isValidCustomFieldKey(name: string): boolean;
//# sourceMappingURL=safe-field-name.d.ts.map