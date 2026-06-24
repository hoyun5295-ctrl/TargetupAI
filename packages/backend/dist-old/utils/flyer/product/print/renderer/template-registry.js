"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadTemplate = loadTemplate;
exports.clearTemplateCache = clearTemplateCache;
exports.listTemplates = listTemplates;
exports.getSlot = getSlot;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const PAPER_SIZES_1 = require("../PAPER-SIZES");
// ============================================================
// 경로 해석
// ============================================================
const TEMPLATES_DIR = path_1.default.resolve(__dirname, '..', 'templates');
function resolveTemplatePath(templateId) {
    // 경로 traversal 방지: templateId는 영숫자/언더바만 허용
    if (!/^[a-z0-9_]+$/i.test(templateId)) {
        throw new Error(`Invalid templateId: ${templateId}`);
    }
    const dir = path_1.default.join(TEMPLATES_DIR, templateId);
    if (!fs_1.default.existsSync(dir)) {
        throw new Error(`Template not found: ${templateId} (${dir})`);
    }
    return dir;
}
// ============================================================
// 검증
// ============================================================
function validateManifest(m, templateId) {
    if (!m || typeof m !== 'object')
        throw new Error(`[${templateId}] manifest is not an object`);
    if (m.id !== templateId)
        throw new Error(`[${templateId}] manifest.id mismatch: ${m.id}`);
    if (!m.version)
        throw new Error(`[${templateId}] missing version`);
    if (!m.paper || !m.paper.size)
        throw new Error(`[${templateId}] missing paper.size`);
    if (!PAPER_SIZES_1.PAPER_SIZES[m.paper.size]) {
        throw new Error(`[${templateId}] invalid paper.size: ${m.paper.size}`);
    }
    if (!Array.isArray(m.slots))
        throw new Error(`[${templateId}] slots must be array`);
    // 슬롯 ID 중복 검사
    const seen = new Set();
    for (const s of m.slots) {
        if (!s.id)
            throw new Error(`[${templateId}] slot missing id`);
        if (!s.type)
            throw new Error(`[${templateId}] slot ${s.id} missing type`);
        if (seen.has(s.id))
            throw new Error(`[${templateId}] duplicate slot id: ${s.id}`);
        seen.add(s.id);
    }
}
// ============================================================
// 캐시 (메모리, 프로세스 생존기간)
// ============================================================
const cache = new Map();
// ============================================================
// Public API
// ============================================================
/**
 * 템플릿 로드 (캐시 사용)
 */
async function loadTemplate(templateId, opts) {
    if (!opts?.nocache && cache.has(templateId)) {
        return cache.get(templateId);
    }
    const basePath = resolveTemplatePath(templateId);
    // manifest
    const manifestPath = path_1.default.join(basePath, 'manifest.json');
    if (!fs_1.default.existsSync(manifestPath)) {
        throw new Error(`manifest.json not found for ${templateId}`);
    }
    const raw = fs_1.default.readFileSync(manifestPath, 'utf-8');
    let manifest;
    try {
        manifest = JSON.parse(raw);
    }
    catch (e) {
        throw new Error(`[${templateId}] manifest.json parse error: ${e.message}`);
    }
    validateManifest(manifest, templateId);
    // html
    const htmlPath = path_1.default.join(basePath, manifest.assets.html || 'template.html');
    if (!fs_1.default.existsSync(htmlPath)) {
        throw new Error(`template.html not found: ${htmlPath}`);
    }
    const html = fs_1.default.readFileSync(htmlPath, 'utf-8');
    // css
    const cssPath = path_1.default.join(basePath, manifest.assets.css || 'template.css');
    if (!fs_1.default.existsSync(cssPath)) {
        throw new Error(`template.css not found: ${cssPath}`);
    }
    const css = fs_1.default.readFileSync(cssPath, 'utf-8');
    const loaded = { manifest, html, css, basePath };
    cache.set(templateId, loaded);
    return loaded;
}
/**
 * 캐시 클리어 (개발 중 핫 리로드용)
 */
function clearTemplateCache(templateId) {
    if (templateId)
        cache.delete(templateId);
    else
        cache.clear();
}
/**
 * 사용 가능한 템플릿 목록 조회
 */
function listTemplates() {
    if (!fs_1.default.existsSync(TEMPLATES_DIR))
        return [];
    const dirs = fs_1.default.readdirSync(TEMPLATES_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);
    const list = [];
    for (const id of dirs) {
        const mPath = path_1.default.join(TEMPLATES_DIR, id, 'manifest.json');
        if (!fs_1.default.existsSync(mPath))
            continue;
        try {
            const m = JSON.parse(fs_1.default.readFileSync(mPath, 'utf-8'));
            list.push({
                id: m.id,
                name: m.name,
                industry: m.industry,
                season: m.season,
                paper: `${m.paper.size}${m.paper.orientation === 'landscape' ? '-L' : ''}`,
            });
        }
        catch {
            // skip invalid
        }
    }
    return list;
}
/**
 * 슬롯 조회 헬퍼
 */
function getSlot(manifest, slotId) {
    return manifest.slots.find(s => s.id === slotId);
}
//# sourceMappingURL=template-registry.js.map