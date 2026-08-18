import { Request, Response, Router } from 'express';
import { logPrivacyExport } from '../utils/privacy-audit';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { query } from '../config/database';
import { authenticate } from '../middlewares/auth';
import { process080Callback, getUserUnsubscribes, registerUnsubscribe, IsolationBlockedError } from '../utils/unsubscribe-helper';
import { deduplicateByPhone } from '../utils/deduplicate';
import { normalizePhone, formatPhoneDisplay } from '../utils/normalize';
import { isFirstRowHeaderRow } from '../utils/excel-columns';

// ★ D162-3 (2026-05-15) 격리 ON 회사 + company_admin = 등록/삭제 차단 가드
//   안내 메시지: "수신거부 사용자격리기능이 적용되어있습니다. 한줄로 운영실에 문의하세요"
const ISOLATION_BLOCK_MESSAGE = '수신거부 사용자격리기능이 적용되어있습니다. 한줄로 운영실에 문의하세요';

async function checkIsolationBlock(companyId: string, userType: string | undefined): Promise<boolean> {
  if (userType !== 'company_admin') return false;
  const result = await query(
    `SELECT COALESCE(user_isolation_enabled, false) AS iso FROM companies WHERE id = $1::uuid`,
    [companyId]
  );
  return result.rows[0]?.iso === true;
}

const router = Router();

// ================================================================
// ★ #4 (2026-07-16) 수신거부 파일 업로드 = 고객DB 업로드(upload.ts)와 동일한 multer+XLSX CT 미러.
//   옛 프론트 file.text() 첫 열 텍스트 파싱은 실제 엑셀(.xlsx 바이너리)을 못 읽어 "상위 1개만" 등록되던 근본을
//   서버 파싱으로 교체. xlsx/xls/csv/txt 전 형식 + 가로·세로 배치 무관 전 셀 추출.
// ================================================================
const unsubUploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `unsub-${uniqueSuffix}${ext}`);
  },
});
const unsubUpload = multer({
  storage: unsubUploadStorage,
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['.xlsx', '.xls', '.csv', '.txt'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('지원하지 않는 파일 형식입니다. (xlsx/xls/csv/txt만 가능)'));
  },
});
// multer 에러(형식/용량)를 사용자 친화 400으로 변환 (raw 500 노출 차단)
function unsubUploadMw(req: Request, res: Response, next: () => void) {
  unsubUpload.single('file')(req, res, (err: any) => {
    if (err) {
      const msg = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE'
        ? '파일이 너무 큽니다. (최대 20MB)'
        : (err?.message || '파일 업로드 오류');
      return res.status(400).json({ error: msg });
    }
    next();
  });
}

// 업로드 파일 → 셀 그리드 (xlsx/xls = XLSX SheetJS, csv/txt = 텍스트). 열 선택을 위해 2차원 그대로 유지.
function parseUnsubFileToGrid(filePath: string, originalName: string): string[][] {
  const ext = path.extname(originalName).toLowerCase();
  if (ext === '.xlsx' || ext === '.xls') {
    const workbook = XLSX.readFile(filePath, {
      type: 'file', cellDates: false, cellFormula: false, cellHTML: false, cellStyles: false, raw: false, sheetStubs: false,
    });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) return [];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as any[][];
    // ★ LESSONS(엑셀 0값 `|| ''` falsy 사고): 셀 falsy 변환 금지 — null/undefined만 걸러 String화.
    return rows.map((r) => (r || []).map((c) => (c === null || c === undefined ? '' : String(c))));
  }
  const text = fs.readFileSync(filePath, 'utf-8');
  return text.split(/\r?\n/).filter((l) => l.length > 0).map((line) => line.split(/[,\t;]/).map((c) => c.trim()));
}

// 파싱만 하고 커밋 안 된(모달 취소 등) 임시 파일 정리 — 30분 초과분 sweep.
function sweepStaleUnsubFiles(uploadDir: string): void {
  try {
    const now = Date.now();
    for (const f of fs.readdirSync(uploadDir)) {
      if (!f.startsWith('unsub-')) continue;
      const fp = path.join(uploadDir, f);
      try {
        if (now - fs.statSync(fp).mtimeMs > 30 * 60 * 1000) fs.unlinkSync(fp);
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
}

// ================================================================
// 공통 헬퍼: 유료 플랜 업체의 customers.sms_opt_in 동기화
// plan_id가 있는 업체만 customers 테이블 연동 (플랜 없으면 스킵)
// ================================================================
async function syncCustomerOptIn(companyId: string, phone: string, optIn: boolean): Promise<void> {
  const planResult = await query(
    `SELECT plan_id FROM companies WHERE id = $1`,
    [companyId]
  );
  if (!planResult.rows[0]?.plan_id) return; // 플랜 없으면 스킵

  await query(
    `UPDATE customers SET sms_opt_in = $1, updated_at = NOW()
     WHERE company_id = $2 AND phone = $3 AND sms_opt_in = $4`,
    [optIn, companyId, phone, !optIn]
  );
}

// 벌크 버전 (업로드용)
async function syncCustomerOptInBulk(companyId: string, phones: string[], optIn: boolean): Promise<void> {
  const planResult = await query(
    `SELECT plan_id FROM companies WHERE id = $1`,
    [companyId]
  );
  if (!planResult.rows[0]?.plan_id) return; // 플랜 없으면 스킵

  if (phones.length === 0) return;

  await query(
    `UPDATE customers SET sms_opt_in = $1, updated_at = NOW()
     WHERE company_id = $2 AND phone = ANY($3) AND sms_opt_in = $4`,
    [optIn, companyId, phones, !optIn]
  );
}

// ================================================================
// GET /api/unsubscribes/080callback - 나래인터넷 080 콜백
// 컨트롤타워(unsubscribe-helper.ts)의 process080Callback()으로 위임.
// 매칭 = users.opt_out_080_number + companies.opt_out_080_number 합집합 (080 공유 계정 전원 등록 — 2026-07-06 Harold 룰)
// ================================================================
router.get('/080callback', async (req: Request, res: Response) => {
  try {
    const { cid, fr } = req.query;
    // ★ 토큰 검증 제거 — Nginx IP 화이트리스트(나래 6개 IP)로 보안 보장

    if (!cid || !fr) {
      console.log(`[080콜백] 필수 파라미터 누락 - cid=${cid}, fr=${fr}`);
      return res.send('0');
    }

    const phone = String(cid).replace(/\D/g, '');
    const opt080Number = String(fr).replace(/\D/g, '');

    if (phone.length < 10) {
      console.log(`[080콜백] 잘못된 전화번호 - cid=${cid}`);
      return res.send('0');
    }

    // 컨트롤타워에 위임 (users 우선 → companies fallback)
    const result = await process080Callback(phone, opt080Number);

    if (!result.success) {
      // ★ 2026-07-06: 발신자 번호 동봉 — 매칭 실패로 유실된 수신거부를 사후 수동 등록할 수 있게 (성공 로그와 동일 수준)
      console.log(`[080콜백] 매칭 실패 - fr=${fr} (${opt080Number}), 발신자=${phone}`);
      return res.send('0');
    }

    console.log(`[080콜백] 수신거부 등록: ${phone} → ${result.companyName} (${result.insertedCount}명, 080: ${fr})`);
    return res.send('1');
  } catch (error) {
    console.error('[080콜백] 처리 오류:', error);
    return res.send('0');
  }
});

// 아래부터는 인증 필요
router.use(authenticate);

// ================================================================
// GET /api/unsubscribes - 수신거부 목록 조회 (user_id 기준 — ★ B17-01)
// D43-4: opt_out_080_number, opt_out_auto_sync 응답에 추가
// ================================================================
router.get('/', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;
    if (!companyId || !userId) {
      return res.status(403).json({ error: '권한이 필요합니다.' });
    }

    const { page = 1, limit = 20, search } = req.query;

    // CT-03 컨트롤타워 사용: company_admin은 회사 전체, 사용자는 본인 user_id만
    const { data: paged, total } = await getUserUnsubscribes(userId, {
      page: Number(page),
      limit: Number(limit),
      search: search as string | undefined,
      companyId,
      userType,
    });

    // ★ B17-11: 사용자(users) 테이블에서 080 설정 조회 (슈퍼관리자에서 사용자 단에 설정)
    // companies fallback: 사용자 테이블에 없으면 회사 설정 참조
    const userInfo = await query(
      `SELECT opt_out_080_number, opt_out_auto_sync FROM users WHERE id = $1`,
      [userId]
    );
    let opt080Number = userInfo.rows[0]?.opt_out_080_number || '';
    let optOutAutoSync = userInfo.rows[0]?.opt_out_auto_sync || false;

    // 사용자에 없으면 companies fallback (하위호환)
    if (!opt080Number) {
      const companyInfo = await query(
        `SELECT opt_out_080_number, opt_out_auto_sync FROM companies WHERE id = $1`,
        [companyId]
      );
      opt080Number = companyInfo.rows[0]?.opt_out_080_number || '';
      optOutAutoSync = companyInfo.rows[0]?.opt_out_auto_sync || false;
    }
    
    // ★ D162-3 (2026-05-15) 격리 ON/OFF 응답 — frontend에서 admin 등록/삭제 UI 가드용
    const isoResult = await query(
      `SELECT COALESCE(user_isolation_enabled, false) AS iso FROM companies WHERE id = $1::uuid`,
      [companyId]
    );
    const userIsolationEnabled = isoResult.rows[0]?.iso === true;
    // 격리 ON + company_admin = 등록/삭제 차단. 그 외 = 관리 허용.
    const canManageUnsubscribes = !(userType === 'company_admin' && userIsolationEnabled);

    return res.json({
      success: true,
      unsubscribes: paged,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit)),
      },
      opt080Number,
      optOutAutoSync,
      userIsolationEnabled,
      canManageUnsubscribes,
    });
  } catch (error) {
    console.error('수신거부 목록 조회 에러:', error);
    return res.status(500).json({ error: '서버 오류' });
  }
});

// ================================================================
// GET /api/unsubscribes/export - 전체 엑셀(CSV) 다운로드
// ★ 2026-06-13 신설 (콤비타·던필드 알파 요청): 목록과 같은 격리 기준(CT-03)으로 전체 내려받기.
//   - company_admin = 회사 전체 / 일반 사용자 = 본인 등록분 (getUserUnsubscribes 그대로)
//   - 전화번호는 하이픈 포맷(formatPhoneDisplay) — 엑셀 숫자 인식으로 앞 0이 사라지는 것 차단
// ================================================================
router.get('/export', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;
    if (!companyId || !userId) {
      return res.status(403).json({ error: '권한이 필요합니다.' });
    }

    const { search } = req.query;
    const { data: rows, total } = await getUserUnsubscribes(userId, {
      page: 1,
      limit: 500000, // 전체 — 주소록/고객DB 상한(수십만)보다 넉넉히
      search: search as string | undefined,
      companyId,
      userType,
    });

    const sourceLabel: Record<string, string> = {
      '080_ars': '080 ARS',
      api: '080 자동',
      upload: '파일 업로드',
      manual: '직접 입력',
      db_upload: 'DB 업로드',
      sync: 'Sync 연동',
    };

    const BOM = '﻿';
    const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    // ★ 2026-08-18 전송자격인증 4.2 — 개인정보 반출 이력
    await logPrivacyExport({ req, kind: 'unsubscribes', count: rows.length });
    res.setHeader('Content-Disposition', `attachment; filename=unsubscribes_${today}.csv`);
    res.write(BOM + '전화번호,유입경로,등록일시\n');

    for (const r of rows) {
      const phone = formatPhoneDisplay(r.phone);
      const src = sourceLabel[r.source] || r.source || '-';
      const at = r.created_at
        ? new Date(new Date(r.created_at).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ')
        : '';
      res.write(`${phone},${src},${at}\n`);
    }
    res.end();
    console.log(`[unsubscribes] 전체 다운로드 — company=${companyId} user=${userId} ${rows.length}/${total}건`);
    return;
  } catch (error) {
    console.error('수신거부 전체 다운로드 에러:', error);
    return res.status(500).json({ error: '서버 오류' });
  }
});

// ================================================================
// POST /api/unsubscribes - 직접 추가 (user_id 기준)
// D43-4: 유료 플랜 업체는 customers.sms_opt_in = false 동시 업데이트
// ================================================================
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const companyId = req.user?.companyId;
    if (!userId || !companyId) {
      return res.status(403).json({ error: '권한이 필요합니다.' });
    }
    
    const { phone } = req.body;
    const userType = req.user?.userType;

    // ★ D162-3 격리 ON + company_admin 가드 (등록 차단)
    if (await checkIsolationBlock(companyId, userType)) {
      return res.status(403).json({ error: ISOLATION_BLOCK_MESSAGE });
    }

    // ★ D162 (2026-05-15) 0 자동 보정: 기존 `replace(/\D/g, '')`만으로는 카카오 받은 CSV 등
    //   앞 0 누락된 10자리 휴대폰(예: 1066133762)이 그대로 INSERT → customers.phone 11자리와
    //   매칭 X → 수신거부 등록됐다 표시되지만 발송 시 스팸 발송 사고 영구 위험.
    //   normalize.ts CT의 normalizePhone(0 자동 보정 + 한국 휴대폰 유효성 검사) 적용.
    const cleanPhone = normalizePhone(phone);

    if (!cleanPhone) {
      return res.status(400).json({ error: '올바른 전화번호를 입력하세요.' });
    }

    // CT-03 (D162-3): 격리 OFF=회사 전체 broadcast / 격리 ON=사용자 본인+admin sync
    let insertedCount: number;
    try {
      insertedCount = await registerUnsubscribe(companyId, userId, userType || 'company_user', cleanPhone, 'manual');
    } catch (e) {
      if (e instanceof IsolationBlockedError) {
        return res.status(403).json({ error: ISOLATION_BLOCK_MESSAGE });
      }
      throw e;
    }

    // D43-4: 유료 플랜 업체면 customers.sms_opt_in = false 동시 업데이트
    await syncCustomerOptIn(companyId, cleanPhone, false);

    // ★ Audit 로그 (시간 + IP + 등록 주체 + 영향 row 수)
    const ip = req.headers['x-forwarded-for'] || req.ip || 'unknown';
    console.log(`[unsubscribe-audit][add] ${new Date().toISOString()} ip=${ip} actor=${req.user?.loginId || userId} company=${companyId} phone=${cleanPhone} inserted_rows=${insertedCount}`);

    return res.json({ success: true, message: '등록되었습니다.' });
  } catch (error) {
    console.error('수신거부 추가 에러:', error);
    return res.status(500).json({ error: '서버 오류' });
  }
});

// ================================================================
// POST /api/unsubscribes/upload/parse - 1단계: 파일 파싱 + 열 메타 반환 (xlsx/xls/csv/txt)
//   여러 열이면 프론트에서 전화번호 열을 선택하게 함(추천인 번호 등 오추출 차단). 파일은 커밋까지 서버 보관.
// ================================================================
router.post('/upload/parse', unsubUploadMw, async (req: Request, res: Response) => {
  const filePath = req.file?.path;
  try {
    const userId = req.user?.userId;
    const companyId = req.user?.companyId;
    if (!userId || !companyId) {
      return res.status(403).json({ error: '권한이 필요합니다.' });
    }
    if (!req.file || !filePath) {
      return res.status(400).json({ error: '업로드할 파일이 필요합니다.' });
    }
    const userType = req.user?.userType;

    // ★ D162-3 격리 ON + company_admin 가드
    if (await checkIsolationBlock(companyId, userType)) {
      if (filePath) { try { fs.unlinkSync(filePath); } catch { /* skip */ } }
      return res.status(403).json({ error: ISOLATION_BLOCK_MESSAGE });
    }

    const grid = parseUnsubFileToGrid(filePath, req.file.originalname);
    if (grid.length === 0) {
      try { fs.unlinkSync(filePath); } catch { /* skip */ }
      return res.status(400).json({ error: '파일이 비어있거나 읽을 수 없습니다.' });
    }

    const hasHeader = isFirstRowHeaderRow(grid[0]);
    const dataRows = hasHeader ? grid.slice(1) : grid;
    const colCount = grid.reduce((m, r) => Math.max(m, r.length), 0);

    const columns: Array<{ index: number; header: string; samples: string[]; phoneCount: number }> = [];
    for (let c = 0; c < colCount; c++) {
      const cells = dataRows.map((r) => r[c] ?? '').filter((v) => String(v).trim() !== '');
      const phoneCount = cells.reduce((n, v) => n + (normalizePhone(v) ? 1 : 0), 0);
      const headerRaw = hasHeader ? (grid[0][c] || '') : '';
      columns.push({
        index: c,
        header: (String(headerRaw).trim() || `${c + 1}번째 열`).slice(0, 40),
        samples: cells.slice(0, 3).map((s) => String(s).slice(0, 30)),
        phoneCount,
      });
    }
    // 전화번호가 가장 많은 열 추천
    const suggestedColumn = columns.reduce((best, col) => (col.phoneCount > (columns[best]?.phoneCount ?? -1) ? col.index : best), 0);

    sweepStaleUnsubFiles(path.dirname(filePath));

    return res.json({
      success: true,
      fileId: path.basename(filePath), // 커밋 때 이 파일을 재파싱
      hasHeader,
      totalRows: dataRows.length,
      columns,
      suggestedColumn,
    });
  } catch (error) {
    if (filePath) { try { fs.unlinkSync(filePath); } catch { /* skip */ } }
    console.error('수신거부 파싱 에러:', error);
    return res.status(500).json({ error: '파일 파싱 오류' });
  }
});

// ================================================================
// POST /api/unsubscribes/upload - 2단계: 선택 열 커밋 등록 (user_id 기준)
//   body: { fileId, columnIndex }. D43-4: 유료 플랜 업체는 customers.sms_opt_in = false 벌크 업데이트
// ================================================================
router.post('/upload', async (req: Request, res: Response) => {
  const userId = req.user?.userId;
  const companyId = req.user?.companyId;
  if (!userId || !companyId) {
    return res.status(403).json({ error: '권한이 필요합니다.' });
  }
  const userType = req.user?.userType;
  const { fileId, columnIndex } = req.body || {};
  if (!fileId || typeof fileId !== 'string' || typeof columnIndex !== 'number' || columnIndex < 0) {
    return res.status(400).json({ error: '파일 정보가 올바르지 않습니다. 다시 업로드해주세요.' });
  }

  // 경로 조작 차단: basename만 허용 + unsub- 접두사 + uploads 내 실존
  const safeName = path.basename(fileId);
  const uploadDir = path.join(__dirname, '../../uploads');
  const filePath = path.join(uploadDir, safeName);
  if (!safeName.startsWith('unsub-') || !fs.existsSync(filePath)) {
    return res.status(400).json({ error: '업로드 파일을 찾을 수 없습니다. 파일을 다시 선택해주세요.' });
  }

  try {
    // ★ D162-3 격리 ON + company_admin 가드 (업로드 차단)
    if (await checkIsolationBlock(companyId, userType)) {
      return res.status(403).json({ error: ISOLATION_BLOCK_MESSAGE });
    }

    // 선택 열의 셀만 추출. 헤더 행 별도 제외 불필요 — 헤더 텍스트는 normalizePhone에서 자연 탈락.
    const grid = parseUnsubFileToGrid(filePath, safeName);
    const seen = new Set<string>();
    const phones: string[] = [];
    for (const row of grid) {
      const cleanPhone = normalizePhone(row[columnIndex]); // ★ D162 0 자동 보정 + 유효성
      if (cleanPhone && !seen.has(cleanPhone)) {
        seen.add(cleanPhone);
        phones.push(cleanPhone);
      }
    }

    if (phones.length === 0) {
      return res.status(400).json({ error: '선택한 열에 유효한 전화번호가 없습니다. 다른 열을 선택해주세요.' });
    }

    let skipCount = 0;
    const insertedPhones: string[] = [];
    for (const cleanPhone of phones) {
      // CT-03 (D162-3): 격리 OFF=회사 전체 broadcast / 격리 ON=사용자 본인+admin sync
      let cnt: number;
      try {
        cnt = await registerUnsubscribe(companyId, userId, userType || 'company_user', cleanPhone, 'upload');
      } catch (e) {
        if (e instanceof IsolationBlockedError) {
          return res.status(403).json({ error: ISOLATION_BLOCK_MESSAGE });
        }
        throw e;
      }
      if (cnt > 0) insertedPhones.push(cleanPhone);
      else skipCount++; // 회사 전체에 이미 등록됨 = 중복
    }

    // D43-4: 유료 플랜 업체면 새로 등록된 번호들 벌크 sms_opt_in = false
    if (insertedPhones.length > 0) {
      await syncCustomerOptInBulk(companyId, insertedPhones, false);
    }

    // ★ Audit 로그 (시간 + IP + 등록 주체 + 업로드 결과)
    const ip = req.headers['x-forwarded-for'] || req.ip || 'unknown';
    console.log(`[unsubscribe-audit][upload] ${new Date().toISOString()} ip=${ip} actor=${req.user?.loginId || userId} company=${companyId} col=${columnIndex} parsed=${phones.length} inserted=${insertedPhones.length} skipped=${skipCount}`);

    return res.json({
      success: true,
      message: `${insertedPhones.length}건 등록, ${skipCount}건 중복 제외`,
      insertCount: insertedPhones.length,
      skipCount,
    });
  } catch (error) {
    console.error('수신거부 업로드 에러:', error);
    return res.status(500).json({ error: '서버 오류' });
  } finally {
    // 커밋 후 임시 파일 정리 (디스크 누적 차단)
    try { fs.unlinkSync(filePath); } catch { /* 이미 없으면 무시 */ }
  }
});

// ================================================================
// DELETE /api/unsubscribes/:id - 삭제 (user_id 기준 — ★ B17-01)
// D43-4: 유료 플랜 업체만 customers.sms_opt_in = true 복원
// ================================================================
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;
    const loginId = req.user?.loginId;
    if (!companyId || !userId) {
      return res.status(403).json({ error: '권한이 필요합니다.' });
    }

    // ★ D162-3 격리 ON + company_admin 가드 (삭제 차단)
    if (await checkIsolationBlock(companyId, userType)) {
      return res.status(403).json({ error: ISOLATION_BLOCK_MESSAGE });
    }

    const { id } = req.params;

    // ★ 삭제 대상 phone 조회 — id는 목록에 표시된 row uuid.
    //   ⚠️ B17-01(수신거부 필터=user_id 기준)과는 별개 축이다. 소유검증은 company_id 기준이어야 한다:
    //   등록(registerUnsubscribe 격리 OFF)은 회사 전 사용자에게 broadcast → 한 phone에 user_id 여러 행 존재.
    //   company_admin 목록(getUserUnsubscribes)은 DISTINCT ON(phone)으로 '아무 사용자 행의 id'를 표시하므로,
    //   그 id의 user_id가 로그인 본인과 다르면 옛 `AND user_id = 본인` 조건이 0건 → 삭제 스킵인데 성공 표시.
    //   (이것이 "삭제가 안 되는데 성공 토스트" 재오픈 근본 — 2026-07-16 실측 확정)
    //   삭제 실행 자체가 D162-3로 이미 회사 전체(company_id + phone)라, 소유검증도 company_id로 맞추는 게 정합.
    const target = await query(
      `SELECT phone FROM unsubscribes WHERE id = $1 AND company_id = $2::uuid`,
      [id, companyId]
    );

    if (target.rows.length === 0) {
      // 대상 없음 = 남의 회사 id이거나 이미 삭제된 항목. 거짓 성공 금지(6원칙 ②).
      return res.status(404).json({ success: false, error: '삭제할 수신거부 대상을 찾을 수 없습니다.' });
    }

    const targetPhone = target.rows[0].phone;

    // 회사 전체 active user의 해당 phone row 모두 삭제 + 삭제 row 수 반환 (D162-3)
    const delResult = await query(
      `DELETE FROM unsubscribes WHERE company_id = $1::uuid AND phone = $2::varchar RETURNING user_id`,
      [companyId, targetPhone]
    );
    const deletedCount = delResult.rowCount || 0;

    // ★ Audit 로그 (시간 + IP + 삭제 주체 + 영향 row 수) — PM2 로그 검색 가능
    const ip = req.headers['x-forwarded-for'] || req.ip || 'unknown';
    console.log(`[unsubscribe-audit][delete] ${new Date().toISOString()} ip=${ip} actor=${loginId || userId} company=${companyId} phone=${targetPhone} affected_rows=${deletedCount}`);

    // D43-4: customers.sms_opt_in = true 복원 (실제 삭제된 경우만)
    if (deletedCount > 0) {
      await syncCustomerOptIn(companyId, targetPhone, true);
    }

    // 6원칙 ②: 실제 효과(삭제 건수) 검증 후에만 성공 표시 — 0건이면 성공 아님
    return res.json({
      success: deletedCount > 0,
      message: deletedCount > 0 ? '삭제되었습니다.' : '삭제된 항목이 없습니다.',
      deletedCount,
    });
  } catch (error) {
    console.error('수신거부 삭제 에러:', error);
    return res.status(500).json({ error: '서버 오류' });
  }
});

// ================================================================
// POST /api/unsubscribes/check - 수신거부 체크 (user_id 기준 — 080 자동연동과 일관성 유지)
// ================================================================
router.post('/check', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(403).json({ error: '권한이 필요합니다.' });
    }

    const { phones } = req.body;
    if (!phones || !Array.isArray(phones)) {
      return res.json({ unsubscribeCount: 0, unsubscribePhones: [], duplicateCount: 0 });
    }

    // ★ D137 D4: 중복 카운트도 함께 반환 (발송 전 안내창 미리보기)
    //   CT-14 deduplicateByPhone 재사용 — 실제 발송 시와 동일한 normalizePhone 기준 → 카운트 일치 보장
    const dedupResult = deduplicateByPhone(phones.map((p: string) => ({ phone: String(p || '') })));
    const duplicateCount = dedupResult.duplicateCount;
    const cleanPhones = dedupResult.unique
      .map((r: any) => String(r.phone || '').replace(/\D/g, ''))
      .filter(Boolean);

    const result = await query(
      `SELECT DISTINCT phone FROM unsubscribes WHERE user_id = $1 AND phone = ANY($2)`,
      [userId, cleanPhones]
    );

    return res.json({
      unsubscribeCount: result.rows.length,
      unsubscribePhones: result.rows.map((r: any) => r.phone),
      duplicateCount,
    });
  } catch (error) {
    console.error('수신거부 체크 에러:', error);
    return res.status(500).json({ error: '서버 오류' });
  }
});

export default router;
