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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middlewares/auth");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const sender_registration_1 = require("../utils/sender-registration");
const router = (0, express_1.Router)();
// ============================================================
//  파일 업로드 설정 (통신가입증명원, 위임장)
// ============================================================
const SENDER_DOCS_DIR = path_1.default.join(__dirname, '../../uploads/sender-docs');
const docStorage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => {
        if (!fs_1.default.existsSync(SENDER_DOCS_DIR)) {
            fs_1.default.mkdirSync(SENDER_DOCS_DIR, { recursive: true });
        }
        cb(null, SENDER_DOCS_DIR);
    },
    filename: (_req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        const ext = path_1.default.extname(file.originalname).toLowerCase();
        cb(null, uniqueSuffix + ext);
    },
});
const docUpload = (0, multer_1.default)({
    storage: docStorage,
    fileFilter: (_req, file, cb) => {
        const allowedTypes = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
        const ext = path_1.default.extname(file.originalname).toLowerCase();
        if (allowedTypes.includes(ext)) {
            cb(null, true);
        }
        else {
            cb(new Error('허용되지 않는 파일 형식입니다. (PDF, JPG, PNG 등만 가능)'));
        }
    },
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});
// ============================================================
//  고객사관리자용 API (authenticate + requireCompanyAdmin)
// ============================================================
// --- 담당자 관리 ---
// GET /managers — 담당자 목록 조회
router.get('/managers', auth_1.authenticate, auth_1.requireCompanyAdmin, async (req, res) => {
    try {
        const companyId = req.user.companyId;
        const managers = await (0, sender_registration_1.getManagers)(companyId);
        res.json({ success: true, managers });
    }
    catch (error) {
        console.error('담당자 목록 조회 실패:', error);
        res.status(500).json({ error: '담당자 목록 조회 실패' });
    }
});
// POST /managers — 담당자 등록 (위임장 파일 첨부 필수)
router.post('/managers', auth_1.authenticate, auth_1.requireCompanyAdmin, docUpload.single('authorizationDoc'), async (req, res) => {
    try {
        const companyId = req.user.companyId;
        const { managerName, managerPhone, managerEmail } = req.body;
        if (!managerName || !managerPhone) {
            return res.status(400).json({ error: '담당자 이름과 전화번호는 필수입니다.' });
        }
        const file = req.file;
        if (!file) {
            return res.status(400).json({ error: '위임장 파일을 첨부해주세요.' });
        }
        const authorizationDoc = {
            originalName: file.originalname,
            storedName: file.filename,
            filePath: `/uploads/sender-docs/${file.filename}`,
            fileSize: file.size,
            uploadedAt: new Date().toISOString(),
        };
        const manager = await (0, sender_registration_1.createManager)(companyId, { managerName, managerPhone, managerEmail, authorizationDoc });
        res.json({ success: true, manager });
    }
    catch (error) {
        console.error('담당자 등록 실패:', error);
        res.status(400).json({ error: error.message || '담당자 등록 실패' });
    }
});
// PUT /managers/:id — 담당자 수정
router.put('/managers/:id', auth_1.authenticate, auth_1.requireCompanyAdmin, async (req, res) => {
    try {
        const companyId = req.user.companyId;
        const manager = await (0, sender_registration_1.updateManager)(req.params.id, companyId, req.body);
        if (!manager) {
            return res.status(404).json({ error: '담당자를 찾을 수 없습니다.' });
        }
        res.json({ success: true, manager });
    }
    catch (error) {
        console.error('담당자 수정 실패:', error);
        res.status(500).json({ error: '담당자 수정 실패' });
    }
});
// DELETE /managers/:id — 담당자 삭제
router.delete('/managers/:id', auth_1.authenticate, auth_1.requireCompanyAdmin, async (req, res) => {
    try {
        const companyId = req.user.companyId;
        const deleted = await (0, sender_registration_1.deleteManager)(req.params.id, companyId);
        if (!deleted) {
            return res.status(404).json({ error: '담당자를 찾을 수 없습니다.' });
        }
        res.json({ success: true, message: '담당자가 삭제되었습니다.' });
    }
    catch (error) {
        console.error('담당자 삭제 실패:', error);
        res.status(500).json({ error: '담당자 삭제 실패' });
    }
});
// --- 발신번호 등록 신청 ---
// POST / — 발신번호 등록 신청 (파일 업로드 포함)
router.post('/', auth_1.authenticate, auth_1.requireCompanyAdmin, docUpload.array('documents', 5), async (req, res) => {
    try {
        const { companyId, userId } = req.user;
        const { phone, label, storeCode, storeName, requestNote, documentTypes, numberType } = req.body;
        if (!phone) {
            return res.status(400).json({ error: '발신번호는 필수입니다.' });
        }
        const files = req.files;
        if (!files || files.length === 0) {
            const docLabel = numberType === 'other' ? '필요 서류(발신번호 사용 동의서 등)' : '통신가입증명원';
            return res.status(400).json({ error: `${docLabel} 파일을 첨부해주세요.` });
        }
        // documentTypes: JSON 파싱 (프론트에서 '["telecom_cert","consent_form"]' 형태로 전달)
        let docTypes = [];
        try {
            docTypes = typeof documentTypes === 'string' ? JSON.parse(documentTypes) : (documentTypes || []);
        }
        catch {
            docTypes = files.map(() => 'telecom_cert');
        }
        const documents = files.map((file, idx) => ({
            type: (docTypes[idx] || 'telecom_cert'),
            originalName: file.originalname,
            storedName: file.filename,
            filePath: `/uploads/sender-docs/${file.filename}`,
            fileSize: file.size,
            uploadedAt: new Date().toISOString(),
        }));
        const registration = await (0, sender_registration_1.createRegistration)({
            companyId,
            requestedBy: userId,
            phone,
            label,
            storeCode,
            storeName,
            numberType: numberType === 'other' ? 'other' : 'company',
            documents,
            requestNote,
        });
        res.json({ success: true, registration });
    }
    catch (error) {
        console.error('발신번호 등록 신청 실패:', error);
        res.status(400).json({ error: error.message || '등록 신청 실패' });
    }
});
// GET /my — 내 회사의 신청 목록 조회
router.get('/my', auth_1.authenticate, auth_1.requireCompanyAdmin, async (req, res) => {
    try {
        const companyId = req.user.companyId;
        const registrations = await (0, sender_registration_1.getRegistrationsByCompany)(companyId);
        res.json({ success: true, registrations });
    }
    catch (error) {
        console.error('신청 목록 조회 실패:', error);
        res.status(500).json({ error: '신청 목록 조회 실패' });
    }
});
// GET /has-approved-manager — 승인된 담당자 존재 여부 (프론트에서 2차 진행 가능 여부 판단)
router.get('/has-approved-manager', auth_1.authenticate, auth_1.requireCompanyAdmin, async (req, res) => {
    try {
        const companyId = req.user.companyId;
        const approved = await (0, sender_registration_1.hasApprovedManager)(companyId);
        res.json({ success: true, hasApprovedManager: approved });
    }
    catch (error) {
        res.status(500).json({ error: '확인 실패' });
    }
});
// ============================================================
//  슈퍼관리자용 API
// ============================================================
// --- 담당자 위임장 승인/반려 ---
// GET /admin/pending-managers — 담당자 승인 대기 목록
router.get('/admin/pending-managers', auth_1.authenticate, auth_1.requireSuperAdmin, async (_req, res) => {
    try {
        const managers = await (0, sender_registration_1.getPendingManagers)();
        res.json({ success: true, managers });
    }
    catch (error) {
        console.error('담당자 승인 대기 목록 조회 실패:', error);
        res.status(500).json({ error: '조회 실패' });
    }
});
// GET /admin/all-managers — 전체 담당자 목록 (필터: ?status=pending|approved|rejected)
router.get('/admin/all-managers', auth_1.authenticate, auth_1.requireSuperAdmin, async (req, res) => {
    try {
        const status = req.query.status;
        const managers = await (0, sender_registration_1.getAllManagers)(status);
        res.json({ success: true, managers });
    }
    catch (error) {
        console.error('전체 담당자 목록 조회 실패:', error);
        res.status(500).json({ error: '조회 실패' });
    }
});
// POST /admin/managers/:id/approve — 담당자 위임장 승인
router.post('/admin/managers/:id/approve', auth_1.authenticate, auth_1.requireSuperAdmin, async (req, res) => {
    try {
        const adminId = req.user.adminId || req.user.userId;
        const manager = await (0, sender_registration_1.approveManager)(req.params.id, adminId);
        res.json({ success: true, message: '담당자 위임장이 승인되었습니다.', manager });
    }
    catch (error) {
        console.error('담당자 승인 실패:', error);
        res.status(400).json({ error: error.message || '승인 처리 실패' });
    }
});
// POST /admin/managers/:id/reject — 담당자 위임장 반려
router.post('/admin/managers/:id/reject', auth_1.authenticate, auth_1.requireSuperAdmin, async (req, res) => {
    try {
        const adminId = req.user.adminId || req.user.userId;
        const { rejectReason } = req.body;
        if (!rejectReason) {
            return res.status(400).json({ error: '반려 사유를 입력해주세요.' });
        }
        const manager = await (0, sender_registration_1.rejectManager)(req.params.id, adminId, rejectReason);
        res.json({ success: true, message: '담당자 위임장이 반려되었습니다.', manager });
    }
    catch (error) {
        console.error('담당자 반려 실패:', error);
        res.status(400).json({ error: error.message || '반려 처리 실패' });
    }
});
// --- 발신번호 등록 승인/반려 ---
// GET /admin/pending — 승인 대기 목록
router.get('/admin/pending', auth_1.authenticate, auth_1.requireSuperAdmin, async (_req, res) => {
    try {
        const registrations = await (0, sender_registration_1.getPendingRegistrations)();
        res.json({ success: true, registrations });
    }
    catch (error) {
        console.error('승인 대기 목록 조회 실패:', error);
        res.status(500).json({ error: '조회 실패' });
    }
});
// GET /admin/all — 전체 신청 목록 (필터: ?status=pending|approved|rejected)
router.get('/admin/all', auth_1.authenticate, auth_1.requireSuperAdmin, async (req, res) => {
    try {
        const status = req.query.status;
        const registrations = await (0, sender_registration_1.getAllRegistrations)(status);
        res.json({ success: true, registrations });
    }
    catch (error) {
        console.error('전체 신청 목록 조회 실패:', error);
        res.status(500).json({ error: '조회 실패' });
    }
});
// GET /admin/pending-count — 승인 대기 건수 (배지용) — 담당자 + 발신번호 합산
router.get('/admin/pending-count', auth_1.authenticate, auth_1.requireSuperAdmin, async (_req, res) => {
    try {
        const counts = await (0, sender_registration_1.getPendingCount)();
        // 하위호환: count(total)도 포함
        res.json({ success: true, ...counts, count: counts.total });
    }
    catch (error) {
        res.status(500).json({ error: '조회 실패' });
    }
});
// GET /admin/:id — 단건 상세 조회
router.get('/admin/:id', auth_1.authenticate, auth_1.requireSuperAdmin, async (req, res) => {
    try {
        const registration = await (0, sender_registration_1.getRegistrationById)(req.params.id);
        if (!registration) {
            return res.status(404).json({ error: '신청을 찾을 수 없습니다.' });
        }
        res.json({ success: true, registration });
    }
    catch (error) {
        console.error('신청 상세 조회 실패:', error);
        res.status(500).json({ error: '조회 실패' });
    }
});
// POST /admin/:id/approve — 승인
router.post('/admin/:id/approve', auth_1.authenticate, auth_1.requireSuperAdmin, async (req, res) => {
    try {
        const adminId = req.user.adminId || req.user.userId;
        const result = await (0, sender_registration_1.approveRegistration)(req.params.id, adminId);
        res.json({
            success: true,
            message: '발신번호가 승인되어 등록되었습니다.',
            registration: result.registration,
            callbackNumber: result.callbackNumber,
        });
    }
    catch (error) {
        console.error('승인 처리 실패:', error);
        res.status(400).json({ error: error.message || '승인 처리 실패' });
    }
});
// POST /admin/:id/reject — 반려
router.post('/admin/:id/reject', auth_1.authenticate, auth_1.requireSuperAdmin, async (req, res) => {
    try {
        const adminId = req.user.adminId || req.user.userId;
        const { rejectReason } = req.body;
        if (!rejectReason) {
            return res.status(400).json({ error: '반려 사유를 입력해주세요.' });
        }
        const registration = await (0, sender_registration_1.rejectRegistration)(req.params.id, adminId, rejectReason);
        res.json({
            success: true,
            message: '신청이 반려되었습니다.',
            registration,
        });
    }
    catch (error) {
        console.error('반려 처리 실패:', error);
        res.status(400).json({ error: error.message || '반려 처리 실패' });
    }
});
// GET /admin/download/:filename — 문서 다운로드
router.get('/admin/download/:filename', auth_1.authenticate, auth_1.requireSuperAdmin, async (req, res) => {
    try {
        const filename = req.params.filename;
        // 경로 조작 방지
        if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
            return res.status(400).json({ error: '잘못된 파일명입니다.' });
        }
        const filePath = path_1.default.join(SENDER_DOCS_DIR, filename);
        if (!fs_1.default.existsSync(filePath)) {
            return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
        }
        res.download(filePath);
    }
    catch (error) {
        console.error('문서 다운로드 실패:', error);
        res.status(500).json({ error: '다운로드 실패' });
    }
});
// GET /download/:filename — 고객사관리자 문서 다운로드 (자사 문서만)
router.get('/download/:filename', auth_1.authenticate, auth_1.requireCompanyAdmin, async (req, res) => {
    try {
        const companyId = req.user.companyId;
        const filename = req.params.filename;
        if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
            return res.status(400).json({ error: '잘못된 파일명입니다.' });
        }
        // 해당 파일이 이 회사의 신청 문서인지 확인
        const check = await Promise.resolve().then(() => __importStar(require('../config/database'))).then(m => m.default.query(`SELECT id FROM sender_registrations
       WHERE company_id = $1 AND documents::text LIKE $2`, [companyId, `%${filename}%`]));
        if (check.rows.length === 0) {
            return res.status(403).json({ error: '접근 권한이 없는 파일입니다.' });
        }
        const filePath = path_1.default.join(SENDER_DOCS_DIR, filename);
        if (!fs_1.default.existsSync(filePath)) {
            return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
        }
        res.download(filePath);
    }
    catch (error) {
        console.error('문서 다운로드 실패:', error);
        res.status(500).json({ error: '다운로드 실패' });
    }
});
exports.default = router;
//# sourceMappingURL=sender-registration.js.map