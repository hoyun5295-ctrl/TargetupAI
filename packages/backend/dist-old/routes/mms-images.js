"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const uuid_1 = require("uuid");
const defaults_1 = require("../config/defaults");
const auth_1 = require("../middlewares/auth");
const router = express_1.default.Router();
// MMS 이미지 저장 경로 (환경변수 또는 기본값)
const MMS_IMAGE_BASE = process.env.MMS_IMAGE_PATH || path_1.default.resolve('./uploads/mms');
// multer 설정: 메모리에 임시 저장 후 검증 → 디스크 저장
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: {
        fileSize: defaults_1.LIMITS.mmsImageSize, // 300KB 제한
        files: defaults_1.LIMITS.mmsImageCount, // 최대 3개
    },
    fileFilter: (req, file, cb) => {
        // JPG/JPEG만 허용
        const ext = path_1.default.extname(file.originalname).toLowerCase();
        const mime = file.mimetype.toLowerCase();
        if ((ext === '.jpg' || ext === '.jpeg') && (mime === 'image/jpeg' || mime === 'image/jpg')) {
            cb(null, true);
        }
        else {
            cb(new Error('JPG 파일만 업로드 가능합니다. (PNG, GIF 등은 이통사에서 거절될 수 있습니다)'));
        }
    },
});
// ─────────────────────────────────────────
// POST /api/mms-images/upload — MMS 이미지 업로드 (최대 3장)
// ─────────────────────────────────────────
router.post('/upload', auth_1.authenticate, (req, res) => {
    const uploadHandler = upload.array('images', 3);
    uploadHandler(req, res, async (err) => {
        if (err) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ error: '이미지 크기는 300KB 이하여야 합니다' });
            }
            if (err.code === 'LIMIT_FILE_COUNT') {
                return res.status(400).json({ error: '이미지는 최대 3개까지 첨부 가능합니다' });
            }
            return res.status(400).json({ error: err.message || '이미지 업로드 실패' });
        }
        const files = req.files;
        if (!files || files.length === 0) {
            return res.status(400).json({ error: '이미지 파일을 선택해주세요' });
        }
        const companyId = req.user.companyId;
        if (!companyId) {
            return res.status(400).json({ error: '회사 정보를 찾을 수 없습니다' });
        }
        try {
            // 회사별 디렉토리 생성
            const companyDir = path_1.default.join(MMS_IMAGE_BASE, companyId);
            if (!fs_1.default.existsSync(companyDir)) {
                fs_1.default.mkdirSync(companyDir, { recursive: true });
            }
            // ★ D124 N4: originalName(업로드 원본 파일명) 응답에 포함 — 표시용
            //   multer가 latin1로 읽는 한글 파일명을 utf-8로 복원 (보편적 패턴)
            const results = [];
            for (const file of files) {
                // 파일 크기 재검증 (안전장치)
                if (file.size > defaults_1.LIMITS.mmsImageSize) {
                    return res.status(400).json({ error: `${file.originalname}: 300KB 초과 (${(file.size / 1024).toFixed(0)}KB)` });
                }
                // 고유 파일명 생성
                const filename = `${(0, uuid_1.v4)()}.jpg`;
                const filePath = path_1.default.join(companyDir, filename);
                // 디스크에 저장
                fs_1.default.writeFileSync(filePath, file.buffer);
                // 절대경로 (QTmsg Agent가 접근할 경로)
                const absolutePath = path_1.default.resolve(filePath);
                // ★ 한글 파일명 복원: multer가 latin1로 인코딩된 것을 utf-8로 재해석
                let originalName = file.originalname;
                try {
                    const buf = Buffer.from(file.originalname, 'latin1');
                    const utf8 = buf.toString('utf8');
                    // utf-8로 디코딩한 결과가 replace char(\uFFFD) 미포함이면 채택
                    if (!utf8.includes('\uFFFD'))
                        originalName = utf8;
                }
                catch { /* ignore */ }
                results.push({
                    serverPath: absolutePath,
                    url: `/api/mms-images/${companyId}/${filename}`,
                    filename: filename,
                    originalName,
                    size: file.size,
                });
            }
            console.log(`[MMS] 이미지 ${results.length}개 업로드 완료 (company: ${companyId})`);
            return res.json({
                success: true,
                images: results,
            });
        }
        catch (error) {
            console.error('[MMS] 이미지 업로드 실패:', error);
            return res.status(500).json({ error: '이미지 업로드 중 오류가 발생했습니다' });
        }
    });
});
// ─────────────────────────────────────────
// GET /api/mms-images/:companyId/:filename — 이미지 서빙 (미리보기용)
// ─────────────────────────────────────────
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
router.get('/:companyId/:filename', (req, res) => {
    const { companyId, filename } = req.params;
    // 보안: companyId UUID 포맷 검증 + 경로 탈출 방지
    if (!UUID_REGEX.test(companyId)) {
        return res.status(400).json({ error: '잘못된 요청' });
    }
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return res.status(400).json({ error: '잘못된 파일명' });
    }
    const filePath = path_1.default.join(MMS_IMAGE_BASE, companyId, filename);
    if (!fs_1.default.existsSync(filePath)) {
        return res.status(404).json({ error: '이미지를 찾을 수 없습니다' });
    }
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(path_1.default.resolve(filePath));
});
// ─────────────────────────────────────────
// DELETE /api/mms-images/:companyId/:filename — 이미지 삭제
// ─────────────────────────────────────────
router.delete('/:companyId/:filename', auth_1.authenticate, (req, res) => {
    const { companyId, filename } = req.params;
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return res.status(400).json({ error: '잘못된 파일명' });
    }
    if (req.user.companyId !== companyId && req.user.role !== 'super_admin') {
        return res.status(403).json({ error: '접근 권한 없음' });
    }
    const filePath = path_1.default.join(MMS_IMAGE_BASE, companyId, filename);
    if (fs_1.default.existsSync(filePath)) {
        fs_1.default.unlinkSync(filePath);
        console.log(`[MMS] 이미지 삭제: ${filePath}`);
    }
    return res.json({ success: true });
});
exports.default = router;
//# sourceMappingURL=mms-images.js.map