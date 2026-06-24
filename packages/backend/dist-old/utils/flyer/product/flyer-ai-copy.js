"use strict";
/**
 * ★ 전단AI: AI 마케팅 문구 자동생성
 *
 * 상품별 조리법/효능/보관법/구매포인트 4종을 Claude/GPT로 자동 생성.
 * ai.ts의 callAIWithFallback() 재활용.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.COPY_TYPE_LABELS = void 0;
exports.generateProductCopy = generateProductCopy;
exports.generateBatchProductCopy = generateBatchProductCopy;
const ai_1 = require("../../../services/ai");
const COPY_TYPE_LABELS = {
    recipe: '조리 팁',
    benefit: '건강 효능',
    storage: '보관법',
    selling_point: '구매 포인트',
};
exports.COPY_TYPE_LABELS = COPY_TYPE_LABELS;
const COPY_PROMPTS = {
    recipe: '다음 식품의 간단한 조리 팁을 40자 이내로 한 문장으로 작성해주세요. 마트 전단지에 넣을 용도입니다.',
    benefit: '다음 식품의 건강 효능이나 영양 정보를 40자 이내로 한 문장으로 작성해주세요.',
    storage: '다음 식품의 보관법을 40자 이내로 한 문장으로 작성해주세요.',
    selling_point: '다음 식품의 구매 매력 포인트를 40자 이내로 한 문장으로 작성해주세요. 마트 전단지 홍보 문구입니다.',
};
const SYSTEM_PROMPT = `당신은 마트 전단지 카피라이터입니다.
주부/가정 타겟으로 친근하고 간결하게 작성합니다.
이모지 1개를 문장 앞에 포함합니다.
반말 금지, 존댓말 사용. 40자 이내.
문구만 출력하세요. 따옴표, 설명, JSON 없이 순수 문구만.`;
// ============================================================
// 단일 상품 문구 생성
// ============================================================
async function generateProductCopy(productName, category, copyType) {
    const prompt = COPY_PROMPTS[copyType];
    const categoryHint = category ? ` (카테고리: ${category})` : '';
    const userMessage = `${prompt}\n\n상품명: ${productName}${categoryHint}`;
    const result = await (0, ai_1.callAIWithFallback)({
        system: SYSTEM_PROMPT,
        userMessage,
        maxTokens: 128,
        temperature: 0.8,
    });
    // 따옴표 제거 + 40자 제한
    let copy = result.trim().replace(/^["']|["']$/g, '');
    if (copy.length > 50)
        copy = copy.slice(0, 47) + '...';
    return copy;
}
// ============================================================
// 배치 문구 생성 (여러 상품 한번에)
// ============================================================
async function generateBatchProductCopy(items, copyType) {
    if (items.length === 0)
        return {};
    const prompt = COPY_PROMPTS[copyType];
    const itemList = items.map((it, i) => `${i + 1}. ${it.name}${it.category ? ` (${it.category})` : ''}`).join('\n');
    const userMessage = `${prompt}\n\n다음 상품들에 대해 각각 한 줄씩 문구를 작성해주세요.\n번호. 문구 형식으로 출력하세요.\n\n${itemList}`;
    const result = await (0, ai_1.callAIWithFallback)({
        system: SYSTEM_PROMPT,
        userMessage,
        maxTokens: 512,
        temperature: 0.8,
    });
    // 파싱: "1. 🍖 문구" 형식
    const map = {};
    const lines = result.trim().split('\n');
    for (const line of lines) {
        const m = line.match(/^(\d+)\.\s*(.+)/);
        if (m) {
            const idx = parseInt(m[1]) - 1;
            if (idx >= 0 && idx < items.length) {
                let copy = m[2].trim().replace(/^["']|["']$/g, '');
                if (copy.length > 50)
                    copy = copy.slice(0, 47) + '...';
                map[items[idx].name] = copy;
            }
        }
    }
    return map;
}
//# sourceMappingURL=flyer-ai-copy.js.map