/**
 * upload-mapping-validator.ts — 고객 DB 업로드 매핑 검증 컨트롤타워 (D111)
 *
 * 배경 (PDF 0408 지적):
 *   "중간관리자 아래 계정에서 고객 DB가 추가되었을 때 동일한 필드 형태가 아니면
 *    데이터가 꼬여 타겟팅이 되지 않습니다. 오류 메시지 또는 업로드 차단이 필요합니다.
 *    실 발송 시 데이터 오류로 오발송 위험이 있습니다."
 *
 * 원인:
 *   - AI 매핑이 회차마다 같은 엑셀 헤더를 다른 custom_N 슬롯에 배정 가능
 *   - 사용자가 수동 매핑 시 기존 customer_field_definitions 와의 일치성 검증 없음
 *   - CT-07 upsertCustomFieldDefinitions 가 ON CONFLICT DO UPDATE 정책 → 기존 라벨/타입이 조용히 덮어쓰임
 *   - 결과: 기존 고객의 custom_fields.custom_N 과 신규 고객의 custom_fields.custom_N 의미 불일치 → 타겟팅 오류
 *
 * 컨트롤타워 역할:
 *   - 업로드 확정 전 매핑을 기존 customer_field_definitions 와 비교
 *   - 충돌 종류별 분류 (slot_label/slot_type/label_moved/label_duplicate_in_file)
 *   - 샘플 값 기반 field_type 자동 감지 (VARCHAR/NUMBER/DATE)
 *   - 호출부: routes/upload.ts POST /validate-mapping
 *
 * ⚠️ 이 검증 없이 /save 를 바로 호출하는 프론트 경로는 금지.
 */
export type ConflictType = 'slot_label_conflict' | 'slot_type_conflict' | 'label_moved' | 'label_duplicate_in_file';
export type FieldTypeSimple = 'VARCHAR' | 'NUMBER' | 'DATE';
export interface MappingConflict {
    type: ConflictType;
    customKey: string;
    header: string;
    proposed: {
        label: string;
        fieldType: FieldTypeSimple;
    };
    existing?: {
        customKey: string;
        label: string;
        fieldType: string;
    };
    severity: 'error' | 'warning';
    message: string;
    /** 해결 옵션 힌트 (프론트는 이 리스트에서 UI 버튼 구성) */
    resolveOptions: Array<'keep_existing' | 'overwrite' | 'move_slot' | 'cancel'>;
}
export interface MappingValidationResult {
    conflicts: MappingConflict[];
    newFields: Array<{
        customKey: string;
        label: string;
        fieldType: FieldTypeSimple;
    }>;
    standardFields: string[];
    availableSlots: string[];
    summary: {
        totalHeaders: number;
        errorCount: number;
        warningCount: number;
        standardCount: number;
        customCount: number;
        ignoredCount: number;
    };
}
/**
 * 샘플 값 배열에서 field_type 자동 감지.
 * upload.ts D101 로직과 동일 규칙 (YYMMDD 우선 → 숫자 → VARCHAR fallback).
 */
export declare function detectFieldTypeFromSamples(samples: any[]): FieldTypeSimple;
/**
 * 매핑 검증 메인 함수.
 *
 * @param companyId        회사 ID
 * @param proposedMapping  { header → fieldKey } — AI 또는 사용자가 결정한 매핑. fieldKey는 'phone'/'name'/'custom_3' 또는 null
 * @param customLabels     { custom_N → label } — 사용자가 지정한 커스텀 필드 한글 라벨 (없으면 header로 폴백)
 * @param sampleData       { header → 샘플 값 배열 } — 각 컬럼 상위 20행 샘플 (타입 감지)
 */
export declare function validateUploadMapping(companyId: string, proposedMapping: Record<string, string | null>, customLabels: Record<string, string>, sampleData: Record<string, any[]>): Promise<MappingValidationResult>;
//# sourceMappingURL=upload-mapping-validator.d.ts.map