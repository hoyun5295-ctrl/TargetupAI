/**
 * ★ 전단AI: 상품 자동 카테고리 분류
 *
 * 3단계 파이프라인:
 *  1. 키워드 규칙 매칭 (즉시, 80%+ 커버)
 *  2. 카탈로그 DB 참조 (기존 등록 상품)
 *  3. AI 폴백 (미분류만 배치 호출)
 *
 * 업종별 키워드 맵 지원 (mart/butcher).
 */
export declare function classifyProducts(items: Array<{
    name: string;
}>, businessType: string, companyId: string): Promise<Record<string, string[]>>;
//# sourceMappingURL=flyer-category-classifier.d.ts.map