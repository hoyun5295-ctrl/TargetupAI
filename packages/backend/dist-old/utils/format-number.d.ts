/**
 * format-number.ts — 숫자 포맷팅 컨트롤타워 (D111)
 *
 * 배경:
 *   - 백엔드 messageUtils.replaceVariables는 소수점 필수 패턴 `\d+\.\d+`만 감지 → 정수 50000이 쉼표 없이 발송
 *   - 프론트 formatPreviewValue는 정수도 감지 → 미리보기는 쉼표 O
 *   - 두 곳의 규칙이 달라서 미리보기/실전송 불일치 (PDF 0408 지적)
 *
 * 정책 (Harold님 확정):
 *   - 정수는 정수 그대로 (강제 소수점 금지): 50000 → 50,000 (NOT 50,000.00)
 *   - trailing zero 제거: 50000.00 → 50,000
 *   - 유효 소수 자릿수 보존: 50000.5 → 50,000.5 / 50000.55 → 50,000.55
 *   - 전화번호(0시작/하이픈 포함) 제외
 *   - YYMMDD 6자리 / YYYYMMDD 8자리 날짜 제외 (월/일 범위 검증)
 *
 * ⚠️ 동일 규칙이 frontend/utils/formatDate.ts 의 formatNumericLike 에도 존재.
 *    규칙 변경 시 반드시 양쪽 동시 수정. 한쪽만 고치면 미리보기/실전송 불일치 재발.
 */
/**
 * 값이 "숫자처럼 보이는지" 판정 후 천단위 쉼표 포맷 문자열 반환.
 * 숫자가 아니거나 제외 조건에 걸리면 null 반환 → 호출부는 원본 문자열 사용.
 */
export declare function formatNumericLike(value: any): string | null;
//# sourceMappingURL=format-number.d.ts.map