/**
 * ★ CT-F16 — 전단AI POS Agent AI 스키마 분석 컨트롤타워
 *
 * POS DB의 테이블/컬럼/샘플 데이터를 Claude API로 분석하여
 * 회원/판매/재고 테이블 자동 매핑 + 데이터 추출 SQL 자동 생성.
 *
 * 핵심 혁신:
 *   - 기존: POS별로 Adapter 코드 하드코딩 (테이블명/컬럼명 매핑)
 *   - AI: 어떤 POS든 스키마만 읽으면 Claude가 자동 매핑 → 코드 수정 없이 새 POS 대응
 *
 * 의존: @anthropic-ai/sdk (이미 설치됨)
 */
/** Agent가 보내는 raw 스키마 정보 */
export interface PosRawSchema {
    dbType: 'mssql' | 'mysql' | 'firebird' | 'unknown';
    tables: PosTableInfo[];
    samples?: Record<string, any[]>;
}
export interface PosTableInfo {
    name: string;
    columns: PosColumnInfo[];
    rowCount?: number;
}
export interface PosColumnInfo {
    name: string;
    dataType: string;
    nullable: boolean;
    maxLength?: number;
    isPrimaryKey?: boolean;
}
/** AI 분석 결과 — 서버 저장 + Agent에 반환 */
export interface SchemaMapping {
    version: string;
    dbType: string;
    analyzedAt: string;
    memberTable: string | null;
    salesTable: string | null;
    inventoryTable: string | null;
    memberColumns: ColumnMapping;
    salesColumns: ColumnMapping;
    inventoryColumns: ColumnMapping | null;
    phoneFormat: 'raw' | 'masked' | 'encrypted' | 'unknown';
    dateFormat: string;
    genderCodes?: Record<string, string>;
    extractQueries: ExtractQueries;
    confidence: number;
    notes: string[];
}
export interface ColumnMapping {
    [standardField: string]: string;
}
export interface ExtractQueries {
    newMembers: string;
    newSales: string;
    inventorySnapshot: string;
    memberCount: string;
    salesCount: string;
}
/**
 * ★ AI 스키마 분석 — POS DB 스키마를 Claude로 자동 매핑
 */
export declare function analyzeSchema(rawSchema: PosRawSchema): Promise<SchemaMapping>;
/**
 * 스키마 매핑을 DB에 저장
 */
export declare function saveSchemaMapping(agentId: string, mapping: SchemaMapping): Promise<void>;
/**
 * Agent의 저장된 스키마 매핑 조회
 */
export declare function getSchemaMapping(agentId: string): Promise<SchemaMapping | null>;
/**
 * 전화번호 마스킹 감지 (샘플 데이터 기반)
 */
export declare function detectPhoneFormat(samples: string[]): 'raw' | 'masked' | 'encrypted' | 'unknown';
//# sourceMappingURL=flyer-pos-ai.d.ts.map