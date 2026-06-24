/**
 * CT-17: 휴머스온 IMC 응답코드 → 한줄로 내부 상태 매핑 컨트롤타워
 *
 * ALIMTALK-DESIGN.md §5-3, §9 준수.
 *
 * 두 종류의 코드 맵:
 *   1) IMC_RESULT_CODE_MAP — 관리 API 응답 code (0000/4xxx/5xxx/6xxx/9xxx)
 *   2) IMC_REPORT_CODE_MAP — 웹훅 리포트 reportCode (발송 결과)
 *
 * 참고: 전체 응답 코드는 월요일 IMC 응답 코드 문서 최종 확인 후 보강 예정.
 * 알 수 없는 코드는 fallback(system_error)로 안전 처리됨.
 */
export type ImcCodeKind = 'success' | 'user_error' | 'system_error' | 'inspect' | 'retryable';
export interface ImcCodeMapping {
    kind: ImcCodeKind;
    userMessage?: string;
    logLevel: 'info' | 'warn' | 'error';
    retry?: boolean;
}
export declare const IMC_RESULT_CODE_MAP: Record<string, ImcCodeMapping>;
export declare function resolveImcCode(code: string): ImcCodeMapping;
export type ReportKind = 'delivered' | 'failed' | 'unknown';
export interface ReportCodeMapping {
    kind: ReportKind;
    userMessage: string;
}
/**
 * 카카오 리포트 코드 맵 (웹훅 reportCode)
 *
 * 출처: `C:\Users\ceo\Downloads\imc_extracted\10_52_06_응답 코드.txt` 실 스펙 대조 완료
 * 이전 구현의 오매핑(1001/1002/1004 의미 완전히 반대)은 전부 교정됨.
 * 알 수 없는 코드는 `resolveReportCode()` fallback이 "알 수 없는 리포트 코드 (xxx)"로 처리.
 */
export declare const IMC_REPORT_CODE_MAP: Record<string, ReportCodeMapping>;
export declare function resolveReportCode(code: string): ReportCodeMapping;
export type ReportType = 'SM' | 'LM' | 'MM' | 'AT' | 'FT' | 'RCS';
export declare const REPORT_TYPE_LABEL: Record<string, string>;
//# sourceMappingURL=alimtalk-result-map.d.ts.map