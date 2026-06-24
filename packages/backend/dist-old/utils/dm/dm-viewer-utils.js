"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.inlineImage = inlineImage;
exports.youtubeEmbedUrl = youtubeEmbedUrl;
/**
 * dm-viewer-utils.ts — DM 뷰어 공용 유틸 (이미지 base64 인라인 + YouTube URL 변환)
 *
 * 소비처: dm-viewer.ts, dm-section-renderer.ts
 * 순환 import 방지를 위한 분리.
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const DM_IMAGE_DIR = path_1.default.join(process.cwd(), 'uploads', 'dm-images');
/**
 * 이미지 src를 base64 data URL로 인라인 변환.
 * 외부 URL/이미 data URL은 그대로 반환.
 * 서버 파일이 없으면 원본 src 유지.
 */
function inlineImage(src) {
    if (!src || src.startsWith('data:') || src.startsWith('http'))
        return src;
    const m = src.match(/\/(?:api\/dm\/images|api\/flyer\/p\/dm-images)\/([^/]+)\/([^/]+)$/);
    if (!m)
        return src;
    const filePath = path_1.default.join(DM_IMAGE_DIR, m[1], m[2]);
    if (!fs_1.default.existsSync(filePath))
        return src;
    try {
        const buf = fs_1.default.readFileSync(filePath);
        const ext = path_1.default.extname(filePath).toLowerCase();
        const mime = ext === '.png' ? 'image/png'
            : ext === '.webp' ? 'image/webp'
                : ext === '.gif' ? 'image/gif'
                    : 'image/jpeg';
        return `data:${mime};base64,${buf.toString('base64')}`;
    }
    catch {
        return src;
    }
}
/**
 * YouTube 워치 URL / 짧은 URL / 이미 embed URL → embed URL로 정규화.
 * 변환 불가능하면 null.
 */
function youtubeEmbedUrl(url) {
    if (!url)
        return null;
    const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    if (m)
        return `https://www.youtube.com/embed/${m[1]}?rel=0&playsinline=1`;
    if (url.includes('youtube.com/embed/'))
        return url;
    return null;
}
//# sourceMappingURL=dm-viewer-utils.js.map