export interface SaveSegmentData {
    name: string;
    emoji?: string;
    segmentType: 'hanjullo' | 'custom';
    prompt?: string;
    autoRelax?: boolean;
    selectedFields?: string[];
    briefing?: string;
    url?: string;
    channel?: string;
    isAd?: boolean;
}
export interface SavedSegment {
    id: string;
    company_id: string;
    user_id: string;
    name: string;
    emoji: string;
    segment_type: 'hanjullo' | 'custom';
    prompt: string | null;
    auto_relax: boolean;
    selected_fields: string[] | null;
    briefing: string | null;
    url: string | null;
    channel: string | null;
    is_ad: boolean;
    last_used_at: string | null;
    created_at: string;
}
/**
 * 세그먼트 저장 (INSERT + 20개 제한)
 */
export declare function saveSegment(companyId: string, userId: string, data: SaveSegmentData): Promise<SavedSegment>;
/**
 * 세그먼트 목록 조회 (최근 사용순)
 */
export declare function getSegments(companyId: string, userId: string): Promise<SavedSegment[]>;
/**
 * 세그먼트 삭제 (소유자 확인)
 */
export declare function deleteSegment(segmentId: string, companyId: string, userId: string): Promise<boolean>;
/**
 * 세그먼트 수정 (소유자 확인)
 */
export declare function updateSegment(segmentId: string, companyId: string, userId: string, data: Partial<SaveSegmentData>): Promise<SavedSegment | null>;
/**
 * 세그먼트 사용 시각 갱신 (fire-and-forget)
 */
export declare function touchSegment(segmentId: string): Promise<void>;
//# sourceMappingURL=saved-segments.d.ts.map