export interface DmPageInput {
    title: string;
    store_name?: string;
    header_template?: string;
    footer_template?: string;
    header_data?: Record<string, any>;
    footer_data?: Record<string, any>;
    /** D119 DmSlide[] 또는 D128 DmPageGroup[] (pages 컬럼 공유) */
    pages?: DmSlide[] | DmPageGroup[];
    settings?: Record<string, any>;
    layout_mode?: 'scroll' | 'slides' | 'scroll_snap';
    sections?: any[];
    brand_kit?: Record<string, any>;
    template_id?: string;
    ai_prompt?: string;
    approval_status?: 'draft' | 'review' | 'approved' | 'published' | 'rejected';
}
export interface DmSlide {
    order: number;
    type: 'image' | 'video' | 'mixed';
    imageUrl?: string;
    videoUrl?: string;
    videoType?: 'youtube' | 'direct';
    caption?: string;
}
/** D128 V4 — 페이지 계층 (페이지 안에 여러 섹션 조립) */
export interface DmPageGroup {
    id: string;
    name?: string;
    sections: any[];
}
/**
 * DM 저장된 구조(pages/sections)에서 전체 섹션을 flat 배열로 추출.
 * - pages가 D128 새 구조면 pages.flatMap(p => p.sections)
 * - 아니면 sections 필드 그대로
 * - 둘 다 없으면 []
 * 검수/AI 개선/테스트 발송 등 섹션 단위 작업에 사용.
 */
export declare function extractFlatSectionsFromDm(dm: any): any[];
/**
 * DM에서 페이지 구조(DmPageGroup[]) 추출.
 * 없으면 sections를 단일 페이지로 감싸서 반환.
 */
export declare function extractPagesFromDm(dm: any): DmPageGroup[];
export declare function createDm(companyId: string, userId: string, data: DmPageInput): Promise<any>;
export declare function updateDm(id: string, companyId: string, data: Partial<DmPageInput>): Promise<any>;
export declare function saveDmVersion(dmId: string, label: string, sections: any[], brandKit: any, note: string | null, userId: string): Promise<any>;
export declare function listDmVersions(dmId: string, companyId: string): Promise<any[]>;
export declare function restoreDmVersion(dmId: string, versionId: string, companyId: string): Promise<any | null>;
export declare function setApprovalStatus(dmId: string, companyId: string, status: 'draft' | 'review' | 'approved' | 'published' | 'rejected'): Promise<any | null>;
export declare function deleteDm(id: string, companyId: string): Promise<boolean>;
export declare function getDmList(companyId: string): Promise<any[]>;
export declare function getDmDetail(id: string, companyId: string): Promise<any>;
export declare function getDmByCode(code: string): Promise<any>;
export declare function publishDm(id: string, companyId: string): Promise<any>;
export declare function trackDmView(dmId: string, companyId: string, phone: string | null, pageReached: number, totalPages: number, duration: number, ip: string | null, userAgent: string | null): Promise<void>;
export declare function getDmStats(id: string, companyId: string): Promise<{
    summary: any;
    viewers: any[];
}>;
//# sourceMappingURL=dm-builder.d.ts.map