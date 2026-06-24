/**
 * ★ 전단AI: AI 마케팅 문구 자동생성
 *
 * 상품별 조리법/효능/보관법/구매포인트 4종을 Claude/GPT로 자동 생성.
 * ai.ts의 callAIWithFallback() 재활용.
 */
export type CopyType = 'recipe' | 'benefit' | 'storage' | 'selling_point';
declare const COPY_TYPE_LABELS: Record<CopyType, string>;
export declare function generateProductCopy(productName: string, category: string | null, copyType: CopyType): Promise<string>;
export declare function generateBatchProductCopy(items: Array<{
    name: string;
    category?: string;
}>, copyType: CopyType): Promise<Record<string, string>>;
export { COPY_TYPE_LABELS };
//# sourceMappingURL=flyer-ai-copy.d.ts.map