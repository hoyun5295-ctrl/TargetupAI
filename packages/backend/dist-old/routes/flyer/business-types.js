"use strict";
/**
 * ★ 전단AI 업종 라우트
 * 마운트: /api/flyer/business-types
 *
 * 업종별 카테고리 프리셋 + 사용 가능 템플릿 조회.
 * CT-F13(flyer-business-types) 단일 진입점.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const flyer_auth_1 = require("../../middlewares/flyer-auth");
const flyer_1 = require("../../utils/flyer");
const router = (0, express_1.Router)();
/**
 * GET / — 활성 업종 목록 + 카테고리 프리셋 + 템플릿 메타데이터
 *
 * 응답 예:
 * [
 *   {
 *     type_code: 'mart',
 *     type_name: '마트',
 *     category_presets: ['청과/야채', '공산', ...],
 *     default_template: 'grid',
 *     templates: [{ value: 'grid', label: '가격 강조형', desc: '...', color: '...' }, ...]
 *   },
 *   ...
 * ]
 */
router.get('/', flyer_auth_1.flyerAuthenticate, async (_req, res) => {
    try {
        const types = await (0, flyer_1.getBusinessTypes)();
        const result = await Promise.all(types.map(async (t) => ({
            type_code: t.type_code,
            type_name: t.type_name,
            category_presets: t.category_presets,
            default_template: t.default_template,
            templates: await (0, flyer_1.getAvailableTemplates)(t.type_code),
        })));
        return res.json(result);
    }
    catch (error) {
        console.error('[flyer/business-types] error:', error);
        return res.status(500).json({ error: 'Server error' });
    }
});
/**
 * GET /templates — 전체 템플릿 레지스트리 (프론트 미리보기용)
 */
router.get('/templates', flyer_auth_1.flyerAuthenticate, async (_req, res) => {
    return res.json(flyer_1.TEMPLATE_REGISTRY);
});
exports.default = router;
//# sourceMappingURL=business-types.js.map