/**
 * utils/ai-mapping.ts
 * ===================
 * SyncAgent v1.5.0 — AI 컬럼 매핑 컨트롤타워 (신규 CT)
 *
 * 역할:
 *   - 고객사 소스 DB 컬럼명을 한줄로 FIELD_MAP 표준 필드에 매핑
 *   - Claude Opus 4.7 우선 호출 + 프롬프트 캐싱(FIELD_MAP 정의부 ephemeral 5분 TTL)
 *   - 폴백 체인: Opus 4.7 → Sonnet 4.6 → 호출 실패 응답 (Agent가 로컬 autoSuggestMapping 폴백)
 *   - 회사당 월 호출 쿼터 (plans.ai_mapping_monthly_quota, 기본 10)
 *
 * 설계 참조: status/SYNC-AGENT-V1.5.0-DESIGN.md §5
 *
 * ⚠️ 유일한 진입점 — routes/sync.ts /ai-mapping 외부에서 직접 호출 금지.
 *    신규 매핑 경로는 반드시 이 CT를 import하여 사용한다.
 */
export type SupportedDbType = 'mssql' | 'mysql' | 'oracle' | 'postgres' | 'excel' | 'csv';
export type MappingTarget = 'customers' | 'purchases';
export interface AiMappingInput {
    target: MappingTarget;
    tableName: string;
    dbType: SupportedDbType;
    columns: string[];
}
export interface AiMappingResult {
    mapping: Record<string, string | null>;
    modelUsed: 'claude-opus-4-7' | 'claude-sonnet-4-5-20250929' | string;
    cacheHit: boolean;
    tokensUsed: number;
    costEstimate: number;
}
export declare class AiMappingQuotaExceeded extends Error {
    code: string;
    limit: number;
    used: number;
    constructor(limit: number, used: number);
}
export declare class AiMappingUnavailable extends Error {
    code: string;
    constructor(detail: string);
}
/**
 * 고객사 DB 컬럼명을 한줄로 표준 필드에 매핑.
 *
 * 처리 순서:
 *   1. 쿼터 체크 (월 10회 기본) — 초과 시 AiMappingQuotaExceeded
 *   2. Claude Opus 4.7 호출 (프롬프트 캐싱 적용)
 *   3. 실패 시 Sonnet 4.6 폴백
 *   4. 둘 다 실패 시 AiMappingUnavailable
 *   5. 응답 JSON 파싱 + sanitize + 카운트 증가
 *
 * ⚠️ PII 금지: 샘플 데이터 전송 금지. 컬럼명만 전송.
 * ⚠️ API 키는 서버 환경변수 ANTHROPIC_API_KEY만 사용. Agent에 번들링 금지.
 */
export declare function callAiMapping(companyId: string, input: AiMappingInput): Promise<AiMappingResult>;
//# sourceMappingURL=ai-mapping.d.ts.map