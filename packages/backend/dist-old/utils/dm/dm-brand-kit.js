"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_BRAND_KIT = void 0;
exports.getCompanyBrandKit = getCompanyBrandKit;
exports.updateCompanyBrandKit = updateCompanyBrandKit;
exports.suggestBrandKitFromUrl = suggestBrandKitFromUrl;
exports.previewBrandExtract = previewBrandExtract;
/**
 * dm-brand-kit.ts — 회사별 브랜드 킷 CRUD
 *
 * companies.brand_kit (JSONB) 컬럼에 저장.
 * 컬럼이 존재하지 않을 수 있어 IF NOT EXISTS 확인 후 읽기/쓰기.
 *
 * ⚠️ 추가 마이그레이션 필요 (Harold님 직접 실행):
 *   ALTER TABLE companies ADD COLUMN IF NOT EXISTS brand_kit JSONB;
 *
 * 설계서: status/DM-PRO-DESIGN.md §12
 */
const database_1 = require("../../config/database");
const dm_tokens_1 = require("./dm-tokens");
// ────────────── 기본 브랜드 킷 ──────────────
exports.DEFAULT_BRAND_KIT = {
    primary_color: dm_tokens_1.DM_COLOR_TOKENS.brand.primary,
    accent_color: dm_tokens_1.DM_COLOR_TOKENS.brand.accent,
    neutral_color: dm_tokens_1.DM_COLOR_TOKENS.neutral[700],
    background_color: dm_tokens_1.DM_COLOR_TOKENS.neutral[0],
    tone: 'friendly',
};
// ────────────── 컬럼 존재 확인 (캐시) ──────────────
let columnExists = null;
async function ensureColumn() {
    if (columnExists !== null)
        return columnExists;
    try {
        const res = await (0, database_1.query)(`SELECT 1 FROM information_schema.columns
       WHERE table_name = 'companies' AND column_name = 'brand_kit'`);
        columnExists = res.rows.length > 0;
    }
    catch {
        columnExists = false;
    }
    return columnExists;
}
// ────────────── 조회/수정 ──────────────
async function getCompanyBrandKit(companyId) {
    const exists = await ensureColumn();
    if (!exists)
        return { ...exports.DEFAULT_BRAND_KIT };
    try {
        const res = await (0, database_1.query)(`SELECT brand_kit FROM companies WHERE id = $1`, [companyId]);
        const raw = res.rows[0]?.brand_kit;
        if (!raw)
            return { ...exports.DEFAULT_BRAND_KIT };
        const kit = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return { ...exports.DEFAULT_BRAND_KIT, ...(kit || {}) };
    }
    catch {
        return { ...exports.DEFAULT_BRAND_KIT };
    }
}
async function updateCompanyBrandKit(companyId, patch) {
    const exists = await ensureColumn();
    if (!exists) {
        // 컬럼 없으면 운영자에게 알림 로그
        console.warn('[BrandKit] companies.brand_kit 컬럼이 없어요. ALTER TABLE 필요.');
        return { ...exports.DEFAULT_BRAND_KIT, ...patch };
    }
    const current = await getCompanyBrandKit(companyId);
    const merged = { ...current, ...patch };
    await (0, database_1.query)(`UPDATE companies SET brand_kit = $1 WHERE id = $2`, [JSON.stringify(merged), companyId]);
    return merged;
}
/** URL에서 메타 태그/로고/테마컬러 추출 → DmBrandKit 부분값 반환 (D126 V2) */
async function suggestBrandKitFromUrl(url) {
    const { extractBrandFromUrl, toBrandKitPatch } = await Promise.resolve().then(() => __importStar(require('./dm-brand-extractor')));
    const result = await extractBrandFromUrl(url);
    return toBrandKitPatch(result);
}
/** 추출 결과 원본(프리뷰 포함)도 함께 반환 — 프론트에서 확인 UI에 사용 */
async function previewBrandExtract(url) {
    const { extractBrandFromUrl, toBrandKitPatch } = await Promise.resolve().then(() => __importStar(require('./dm-brand-extractor')));
    const result = await extractBrandFromUrl(url);
    return {
        raw: result,
        patch: toBrandKitPatch(result),
    };
}
//# sourceMappingURL=dm-brand-kit.js.map