import { Router, Request, Response } from 'express';
import { authenticate, requireCompanyAdmin, requireSuperAdmin } from '../middlewares/auth';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import {
  // 담당자
  getManagers,
  createManager,
  updateManager,
  deleteManager,
  // 등록 신청
  createRegistration,
  getRegistrationsByCompany,
  getPendingRegistrations,
  getAllRegistrations,
  getRegistrationById,
  approveRegistration,
  rejectRegistration,
  getPendingCount,
} from '../utils/sender-registration';
import type { DocumentInfo } from '../utils/sender-registration';

const router = Router();

// ============================================================
//  파일 업로드 설정 (통신가입증명원, 위임장)
// ============================================================
const SENDER_DOCS_DIR = path.join(__dirname, '../../uploads/sender-docs');

const docStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    if (!fs.existsSync(SENDER_DOCS_DIR)) {
      fs.mkdirSync(SENDER_DOCS_DIR, { recursive: true });
    }
    cb(null, SENDER_DOCS_DIR);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, uniqueSuffix + ext);
  },
});

const docUpload = multer({
  storage: docStorage,
  fileFilter: (_req, file, cb) => {
    const allowedTypes = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
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
router.get('/managers', authenticate, requireCompanyAdmin, async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user!.companyId;
    const managers = await getManagers(companyId);
    res.json({ success: true, managers });
  } catch (error: any) {
    console.error('담당자 목록 조회 실패:', error);
    res.status(500).json({ error: '담당자 목록 조회 실패' });
  }
});

// POST /managers — 담당자 등록
router.post('/managers', authenticate, requireCompanyAdmin, async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user!.companyId;
    const { managerName, managerPhone, managerEmail } = req.body;

    if (!managerName || !managerPhone) {
      return res.status(400).json({ error: '담당자 이름과 전화번호는 필수입니다.' });
    }

    const manager = await createManager(companyId, { managerName, managerPhone, managerEmail });
    res.json({ success: true, manager });
  } catch (error: any) {
    console.error('담당자 등록 실패:', error);
    res.status(500).json({ error: '담당자 등록 실패' });
  }
});

// PUT /managers/:id — 담당자 수정
router.put('/managers/:id', authenticate, requireCompanyAdmin, async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user!.companyId;
    const manager = await updateManager(req.params.id, companyId, req.body);
    if (!manager) {
      return res.status(404).json({ error: '담당자를 찾을 수 없습니다.' });
    }
    res.json({ success: true, manager });
  } catch (error: any) {
    console.error('담당자 수정 실패:', error);
    res.status(500).json({ error: '담당자 수정 실패' });
  }
});

// DELETE /managers/:id — 담당자 삭제
router.delete('/managers/:id', authenticate, requireCompanyAdmin, async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user!.companyId;
    const deleted = await deleteManager(req.params.id, companyId);
    if (!deleted) {
      return res.status(404).json({ error: '담당자를 찾을 수 없습니다.' });
    }
    res.json({ success: true, message: '담당자가 삭제되었습니다.' });
  } catch (error: any) {
    console.error('담당자 삭제 실패:', error);
    res.status(500).json({ error: '담당자 삭제 실패' });
  }
});

// --- 발신번호 등록 신청 ---

// POST / — 발신번호 등록 신청 (파일 업로드 포함)
router.post(
  '/',
  authenticate,
  requireCompanyAdmin,
  docUpload.array('documents', 5),
  async (req: Request, res: Response) => {
    try {
      const { companyId, userId } = (req as any).user!;
      const { phone, label, storeCode, storeName, requestNote, documentTypes } = req.body;

      if (!phone) {
        return res.status(400).json({ error: '발신번호는 필수입니다.' });
      }

      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        return res.status(400).json({ error: '통신가입증명원 파일을 첨부해주세요.' });
      }

      // documentTypes: JSON 파싱 (프론트에서 '["telecom_cert","authorization"]' 형태로 전달)
      let docTypes: string[] = [];
      try {
        docTypes = typeof documentTypes === 'string' ? JSON.parse(documentTypes) : (documentTypes || []);
      } catch {
        docTypes = files.map(() => 'telecom_cert');
      }

      const documents: DocumentInfo[] = files.map((file, idx) => ({
        type: (docTypes[idx] || 'telecom_cert') as 'telecom_cert' | 'authorization',
        originalName: file.originalname,
        storedName: file.filename,
        filePath: `/uploads/sender-docs/${file.filename}`,
        fileSize: file.size,
        uploadedAt: new Date().toISOString(),
      }));

      const registration = await createRegistration({
        companyId,
        requestedBy: userId,
        phone,
        label,
        storeCode,
        storeName,
        documents,
        requestNote,
      });

      res.json({ success: true, registration });
    } catch (error: any) {
      console.error('발신번호 등록 신청 실패:', error);
      res.status(400).json({ error: error.message || '등록 신청 실패' });
    }
  }
);

// GET /my — 내 회사의 신청 목록 조회
router.get('/my', authenticate, requireCompanyAdmin, async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user!.companyId;
    const registrations = await getRegistrationsByCompany(companyId);
    res.json({ success: true, registrations });
  } catch (error: any) {
    console.error('신청 목록 조회 실패:', error);
    res.status(500).json({ error: '신청 목록 조회 실패' });
  }
});

// ============================================================
//  슈퍼관리자용 API
// ============================================================

// GET /admin/pending — 승인 대기 목록
router.get('/admin/pending', authenticate, requireSuperAdmin, async (_req: Request, res: Response) => {
  try {
    const registrations = await getPendingRegistrations();
    res.json({ success: true, registrations });
  } catch (error: any) {
    console.error('승인 대기 목록 조회 실패:', error);
    res.status(500).json({ error: '조회 실패' });
  }
});

// GET /admin/all — 전체 신청 목록 (필터: ?status=pending|approved|rejected)
router.get('/admin/all', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string | undefined;
    const registrations = await getAllRegistrations(status);
    res.json({ success: true, registrations });
  } catch (error: any) {
    console.error('전체 신청 목록 조회 실패:', error);
    res.status(500).json({ error: '조회 실패' });
  }
});

// GET /admin/pending-count — 승인 대기 건수 (배지용)
router.get('/admin/pending-count', authenticate, requireSuperAdmin, async (_req: Request, res: Response) => {
  try {
    const count = await getPendingCount();
    res.json({ success: true, count });
  } catch (error: any) {
    res.status(500).json({ error: '조회 실패' });
  }
});

// GET /admin/:id — 단건 상세 조회
router.get('/admin/:id', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const registration = await getRegistrationById(req.params.id);
    if (!registration) {
      return res.status(404).json({ error: '신청을 찾을 수 없습니다.' });
    }
    res.json({ success: true, registration });
  } catch (error: any) {
    console.error('신청 상세 조회 실패:', error);
    res.status(500).json({ error: '조회 실패' });
  }
});

// POST /admin/:id/approve — 승인
router.post('/admin/:id/approve', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const adminId = (req as any).user!.adminId || (req as any).user!.userId;
    const result = await approveRegistration(req.params.id, adminId);
    res.json({
      success: true,
      message: '발신번호가 승인되어 등록되었습니다.',
      registration: result.registration,
      callbackNumber: result.callbackNumber,
    });
  } catch (error: any) {
    console.error('승인 처리 실패:', error);
    res.status(400).json({ error: error.message || '승인 처리 실패' });
  }
});

// POST /admin/:id/reject — 반려
router.post('/admin/:id/reject', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const adminId = (req as any).user!.adminId || (req as any).user!.userId;
    const { rejectReason } = req.body;

    if (!rejectReason) {
      return res.status(400).json({ error: '반려 사유를 입력해주세요.' });
    }

    const registration = await rejectRegistration(req.params.id, adminId, rejectReason);
    res.json({
      success: true,
      message: '신청이 반려되었습니다.',
      registration,
    });
  } catch (error: any) {
    console.error('반려 처리 실패:', error);
    res.status(400).json({ error: error.message || '반려 처리 실패' });
  }
});

// GET /admin/download/:filename — 문서 다운로드
router.get('/admin/download/:filename', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const filename = req.params.filename;
    // 경로 조작 방지
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: '잘못된 파일명입니다.' });
    }
    const filePath = path.join(SENDER_DOCS_DIR, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
    }
    res.download(filePath);
  } catch (error: any) {
    console.error('문서 다운로드 실패:', error);
    res.status(500).json({ error: '다운로드 실패' });
  }
});

// GET /download/:filename — 고객사관리자 문서 다운로드 (자사 문서만)
router.get('/download/:filename', authenticate, requireCompanyAdmin, async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user!.companyId;
    const filename = req.params.filename;

    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: '잘못된 파일명입니다.' });
    }

    // 해당 파일이 이 회사의 신청 문서인지 확인
    const check = await import('../config/database').then(m => m.default.query(
      `SELECT id FROM sender_registrations
       WHERE company_id = $1 AND documents::text LIKE $2`,
      [companyId, `%${filename}%`]
    ));
    if (check.rows.length === 0) {
      return res.status(403).json({ error: '접근 권한이 없는 파일입니다.' });
    }

    const filePath = path.join(SENDER_DOCS_DIR, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
    }
    res.download(filePath);
  } catch (error: any) {
    console.error('문서 다운로드 실패:', error);
    res.status(500).json({ error: '다운로드 실패' });
  }
});

export default router;
