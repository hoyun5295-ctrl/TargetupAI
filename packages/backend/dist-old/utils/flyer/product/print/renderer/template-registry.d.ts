/**
 * ★ 인쇄전단 V2 (D129) — 템플릿 레지스트리
 *
 * 역할: templates/<id>/ 폴더에서 manifest.json + template.html + template.css를
 *       로드하고 메모리에 캐시. 슬롯 검증 포함.
 *
 * 사용:
 *   const tpl = await loadTemplate('mart_spring_v1');
 *   tpl.manifest  // 파싱된 매니페스트
 *   tpl.html      // template.html 원본
 *   tpl.css       // template.css 원본
 */
import { PaperSizeKey } from '../PAPER-SIZES';
export type SlotType = 'text' | 'rich_text' | 'typography' | 'image' | 'qr' | 'map' | 'product_card' | 'product_grid' | 'category_grid' | 'section_banner' | 'store_header' | 'footer_notice' | 'decoration';
export interface SlotDefinition {
    id: string;
    type: SlotType;
    required?: boolean;
    editable?: boolean;
    maxLength?: number;
    fallback?: string;
    position?: {
        css?: string;
    };
    [key: string]: any;
}
export interface TemplateManifest {
    id: string;
    version: string;
    name: string;
    description?: string;
    industry: 'mart' | 'butcher' | 'fruit' | 'fish' | 'convenience' | 'general';
    season?: 'spring' | 'summer' | 'autumn' | 'winter' | 'chuseok' | 'seol' | 'general';
    paper: {
        size: PaperSizeKey;
        orientation?: 'portrait' | 'landscape';
    };
    pages: number;
    assets: {
        html: string;
        css: string;
        preview?: string;
    };
    tokens?: string;
    slots: SlotDefinition[];
}
export interface LoadedTemplate {
    manifest: TemplateManifest;
    html: string;
    css: string;
    basePath: string;
}
/**
 * 템플릿 로드 (캐시 사용)
 */
export declare function loadTemplate(templateId: string, opts?: {
    nocache?: boolean;
}): Promise<LoadedTemplate>;
/**
 * 캐시 클리어 (개발 중 핫 리로드용)
 */
export declare function clearTemplateCache(templateId?: string): void;
/**
 * 사용 가능한 템플릿 목록 조회
 */
export declare function listTemplates(): Array<{
    id: string;
    name: string;
    industry: string;
    season?: string;
    paper: string;
}>;
/**
 * 슬롯 조회 헬퍼
 */
export declare function getSlot(manifest: TemplateManifest, slotId: string): SlotDefinition | undefined;
//# sourceMappingURL=template-registry.d.ts.map