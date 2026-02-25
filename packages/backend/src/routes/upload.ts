import { Request, Response, Router } from 'express';
import fs from 'fs';
import Redis from 'ioredis';
import multer from 'multer';
import path from 'path';
import * as XLSX from 'xlsx';
import { query } from '../config/database';
import { normalizeGender, normalizeGrade, normalizePhone, normalizeRegion, normalizeSmsOptIn } from '../utils/normalize';

// Excel 시리얼넘버 → YYYY-MM-DD 변환
function excelSerialToDateStr(serial: number): string | null {
  if (serial < 1 || serial > 73050) return null;
  const excelEpoch = new Date(1899, 11, 30);
  const converted = new Date(excelEpoch.getTime() + serial * 86400000);
  const yyyy = converted.getFullYear();
  if (yyyy < 1900 || yyyy > 2099) return null;
  const mm = String(converted.getMonth() + 1).padStart(2, '0');
  const dd = String(converted.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// 범용 날짜 정규화: 시리얼넘버, YYYYMMDD, YYYY-MM-DD 모두 처리
function normalizeDateValue(value: any): string | null {
  if (value === undefined || value === null || value === '') return null;
  const str = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(str)) return str.replace(/\//g, '-');
  if (/^\d{8}$/.test(str)) {
    return `${str.substring(0, 4)}-${str.substring(4, 6)}-${str.substring(6, 8)}`;
  }
  const num = Number(str);
  if (!isNaN(num) && num >= 1 && num <= 73050 && Number.isInteger(num)) {
    return excelSerialToDateStr(num);
  }
  return null;
}

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

import { authenticate } from '../middlewares/auth';

const router = Router();

// 파일 저장 설정
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({ 
  storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.xlsx', '.xls', '.csv'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('지원하지 않는 파일 형식입니다.'));
    }
  }
});

// ================================================================
// POST /parse — 파일 업로드 및 파싱
// allData는 ?includeData=true일 때만 포함 (직접발송/주소록용)
// 고객DB 업로드는 allData 불필요 (/save에서 파일 직접 재파싱)
// ================================================================
router.post('/parse', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '파일이 없습니다.' });
    }

    const filePath = req.file.path;
    const includeData = req.query.includeData === 'true';

    const workbook = XLSX.readFile(filePath, {
      type: 'file',
      cellFormula: false,
      cellHTML: false,
      cellStyles: false,
      sheetStubs: false,
    });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
    
    if (data.length === 0) {
      return res.status(400).json({ error: '파일이 비어있습니다.' });
    }

    // 첫 행이 헤더인지 판별
    const firstRow = data[0];
    const isFirstRowHeader = firstRow.some((cell: any) => {
      const str = String(cell || '').trim();
      return str && isNaN(Number(str.replace(/-/g, '')));
    });

    let headers: string[];
    let dataRows: any[][];
    
    if (isFirstRowHeader) {
      headers = firstRow.map((h: any) => String(h || ''));
      dataRows = data.slice(1);
    } else {
      headers = firstRow.map((_: any, idx: number) => `컬럼${idx + 1}`);
      dataRows = data;
    }

    // 미리보기 (최대 5행)
    const preview = dataRows.slice(0, 5).map(row => {
      const obj: any = {};
      headers.forEach((h, idx) => {
        obj[h] = row[idx];
      });
      return obj;
    });

    const totalRows = dataRows.length;
    const fileId = path.basename(filePath);

    // Redis에 메타 저장 (/save에서 활용 — 파일 재파싱 없이 totalRows 확인)
    await redis.set(`upload:${fileId}:meta`, JSON.stringify({
      totalRows,
      headers
    }), 'EX', 600); // 10분

    const response: any = {
      success: true,
      fileId,
      headers,
      preview,
      totalRows
    };

    // 직접발송/주소록용: includeData=true일 때만 allData 포함
    if (includeData) {
      response.allData = dataRows.map(row => {
        const obj: any = {};
        headers.forEach((h, idx) => {
          obj[h] = row[idx];
        });
        return obj;
      });
    }

    return res.json(response);

  } catch (error: any) {
    console.error('파일 파싱 에러:', error);
    return res.status(500).json({ error: error.message || '파일 처리 중 오류가 발생했습니다.' });
  }
});

// ================================================================
// POST /mapping — AI 컬럼 매핑 (변경 없음)
// ================================================================
router.post('/mapping', async (req: Request, res: Response) => {
  try {
    const { headers } = req.body;
    
    const dbColumns = {
      phone: '전화번호 (필수)',
      name: '고객 이름',
      gender: '성별 (M/F)',
      birth_year: '출생연도 (예: 1990)',
      birth_month_day: '생일 월일 (예: 03-15)',
      birth_date: '생년월일 전체 (예: 1990-03-15)',
      grade: '고객 등급 (VIP, 일반 등)',
      region: '지역',
      sms_opt_in: '마케팅 수신동의 여부',
      email: '이메일',
      total_purchase: '총 구매금액',
      last_purchase_date: '최근 구매일',
      purchase_count: '구매 횟수',
      callback: '매장번호/회신번호 (발신번호로 사용되는 매장 전화번호)',
      store_name: '소속매장명 (매장/지점 이름)',
      store_code: '매장코드 (매장 식별 코드)'
    };

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: `엑셀 파일의 컬럼명을 데이터베이스 컬럼에 매핑해줘.

엑셀 컬럼명: ${JSON.stringify(headers)}

DB 컬럼 (매핑 대상):
${Object.entries(dbColumns).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

규칙:
1. 의미가 비슷하면 매핑해줘 (예: tier → grade, marketing_opt_in → sms_opt_in)
2. 매핑할 DB 컬럼이 없으면 null
3. phone(전화번호)은 반드시 찾아서 매핑해줘

JSON 형식으로만 응답해줘 (다른 설명 없이):
{"엑셀컬럼명": "DB컬럼명 또는 null", ...}`
        }]
      })
    });

    const aiResult: any = await response.json();
    const aiText = aiResult.content?.[0]?.text || '{}';
    
    let mapping: { [key: string]: string | null } = {};
    try {
      const jsonMatch = aiText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        mapping = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.error('AI 응답 파싱 실패:', aiText);
      headers.forEach((h: string) => { mapping[h] = null; });
    }

    const hasPhone = Object.values(mapping).includes('phone');
    const unmapped = Object.entries(mapping).filter(([_, v]) => v === null).map(([k, _]) => k);

    return res.json({
      success: true,
      mapping,
      unmapped,
      hasPhone,
      message: hasPhone ? 'AI 매핑 완료' : '전화번호 컬럼을 찾을 수 없습니다.'
    });

  } catch (error: any) {
    console.error('매핑 에러:', error);
    return res.status(500).json({ error: error.message || '매핑 중 오류가 발생했습니다.' });
  }
});

// ================================================================
// POST /save — 백그라운드 처리 (즉시 반환)
// ================================================================
router.post('/save', authenticate, async (req: Request, res: Response) => {
  try {
    const { fileId, mapping } = req.body;
    const companyId = req.user?.companyId;
    const userId = (req as any).user?.userId;
    
    if (!fileId || !mapping || !companyId) {
      return res.status(400).json({ 
        error: '필수 파라미터가 없습니다.',
        missing: { fileId: !fileId, mapping: !mapping, companyId: !companyId }
      });
    }

    // 파일 존재 확인
    const uploadDir = path.join(__dirname, '../../uploads');
    const filePath = path.join(uploadDir, fileId);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '파일을 찾을 수 없습니다. 다시 업로드해주세요.' });
    }

    // Redis에서 메타 조회 (파일 재파싱 없이 totalRows 확인)
    let totalRows = 0;
    const metaStr = await redis.get(`upload:${fileId}:meta`);
    if (metaStr) {
      const meta = JSON.parse(metaStr);
      totalRows = meta.totalRows || 0;
    } else {
      // 메타 만료 시 파일에서 빠르게 확인
      const workbook = XLSX.readFile(filePath, { type: 'file', cellFormula: false, cellHTML: false, cellStyles: false, sheetStubs: false });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
      totalRows = Math.max(0, data.length - 1);
    }

    // 플랜 초과 사전 체크
    const limitCheck = await query(`
      SELECT 
        p.max_customers,
        p.plan_name,
        (SELECT COUNT(*) FROM customers WHERE company_id = c.id AND is_active = true) as current_count
      FROM companies c
      LEFT JOIN plans p ON c.plan_id = p.id
      WHERE c.id = $1
    `, [companyId]);

    if (limitCheck.rows.length > 0) {
      const { max_customers, current_count, plan_name } = limitCheck.rows[0];
      const newTotal = Number(current_count) + totalRows;
      if (max_customers && newTotal > max_customers) {
        const available = Number(max_customers) - Number(current_count);
        return res.status(403).json({ 
          error: '최대 고객 관리 DB를 초과합니다. 플랜을 업그레이드하세요.',
          code: 'PLAN_LIMIT_EXCEEDED',
          planName: plan_name,
          maxCustomers: max_customers,
          currentCount: Number(current_count),
          requestedCount: totalRows,
          availableCount: available > 0 ? available : 0
        });
      }
    }

    const startedAt = new Date().toISOString();

    // Redis 초기 상태
    await redis.set(`upload:${fileId}:progress`, JSON.stringify({
      status: 'processing',
      total: totalRows,
      processed: 0,
      percent: 0,
      insertCount: 0,
      duplicateCount: 0,
      errorCount: 0,
      startedAt,
      message: '처리 시작...'
    }), 'EX', 3600);

    // 즉시 응답 (1초 이내)
    res.json({ success: true, fileId, totalRows, message: '백그라운드 처리 시작' });

    // 백그라운드 처리 (res 반환 이후 실행)
    processUploadInBackground(fileId, filePath, mapping, companyId, userId, startedAt).catch(err => {
      console.error('[업로드 백그라운드] 치명적 에러:', err);
    });

  } catch (error: any) {
    console.error('저장 요청 에러:', error);
    return res.status(500).json({ error: error.message || '저장 중 오류가 발생했습니다.' });
  }
});

// ================================================================
// 백그라운드 업로드 처리 함수
// ================================================================
async function processUploadInBackground(
  fileId: string,
  filePath: string,
  mapping: Record<string, string>,
  companyId: string,
  userId: string | null,
  startedAt: string
) {
  let insertCount = 0;
  let duplicateCount = 0;
  let errorCount = 0;

  try {
    // 파일 읽기
    const workbook = XLSX.readFile(filePath, {
      type: 'file',
      cellFormula: false,
      cellHTML: false,
      cellStyles: false,
      sheetStubs: false,
    });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
    
    const headers = data[0] as string[];
    const rows = data.slice(1);
    const totalRows = rows.length;

    // 업로드 사용자의 store_codes 조회
    let userStoreCodes: string[] = [];
    if (userId) {
      const userResult = await query('SELECT store_codes FROM users WHERE id = $1', [userId]);
      userStoreCodes = userResult.rows[0]?.store_codes || [];
    }

    const BATCH_SIZE = 500;
    const hasFileStoreCode = Object.values(mapping).includes('store_code');

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const values: any[] = [];
      const placeholders: string[] = [];
      let paramIndex = 1;
      const batchPhones: string[] = [];
      const seenInBatch = new Set<string>();

      for (const row of batch) {
        const record: any = {};
        
        headers.forEach((header, idx) => {
          const dbColumn = mapping[header];
          if (dbColumn && row[idx] !== undefined && row[idx] !== null && row[idx] !== '') {
            record[dbColumn] = row[idx];
          }
        });

        // birth_date 파싱 → birth_year, birth_month_day 분리
        if (record.birth_date) {
          const bd = String(record.birth_date).trim();
          // 4자리 연도만 입력된 경우 (예: 1990)
          if (/^\d{4}$/.test(bd) && parseInt(bd) >= 1900 && parseInt(bd) <= 2099) {
            record.birth_year = parseInt(bd);
          } else {
            const normalized = normalizeDateValue(bd);
            if (normalized) {
              record.birth_date = normalized;
              record.birth_year = parseInt(normalized.substring(0, 4));
              record.birth_month_day = normalized.substring(5, 10);
            }
          }
        }
        if (record.birth_year && !record.birth_date) {
          record.birth_year = parseInt(String(record.birth_year));
        }

        // last_purchase_date 시리얼넘버/형식 정규화
        if (record.last_purchase_date) {
          const normalized = normalizeDateValue(record.last_purchase_date);
          if (normalized) {
            record.last_purchase_date = normalized;
          }
        }

        // phone 정규화 + 필수 체크
        record.phone = normalizePhone(record.phone);
        if (!record.phone) {
          errorCount++;
          continue;
        }

        // 배치 내 중복: store_code 포함 dedupe
        const dedupeKey = `${record.phone}__${record.store_code || '__NONE__'}`;
        if (seenInBatch.has(dedupeKey)) {
          duplicateCount++;
          continue;
        }
        seenInBatch.add(dedupeKey);

        batchPhones.push(record.phone);

        // 데이터 정규화
        record.gender = normalizeGender(record.gender);
        record.grade = normalizeGrade(record.grade);
        record.region = normalizeRegion(record.region);
        const smsOptIn = normalizeSmsOptIn(record.sms_opt_in);

        values.push(
          companyId, record.phone, record.name || null, record.gender || null,
          record.birth_date || null, record.birth_year || null, record.birth_month_day || null,
          record.grade || null, record.region || null,
          smsOptIn !== null ? smsOptIn : true,
          record.email || null, record.total_purchase || null, record.last_purchase_date || null, record.purchase_count || null,
          record.callback ? String(record.callback).replace(/-/g, '').trim() : null,
          record.store_name || null, record.store_code || null,
          userId || null
        );

        placeholders.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6}, $${paramIndex + 7}, $${paramIndex + 8}, $${paramIndex + 9}, $${paramIndex + 10}, $${paramIndex + 11}, $${paramIndex + 12}, $${paramIndex + 13}, $${paramIndex + 14}, $${paramIndex + 15}, $${paramIndex + 16}, $${paramIndex + 17}, 'upload', NOW(), NOW())`);
        paramIndex += 18;
      }

      if (placeholders.length > 0) {
        try {
          const result = await query(`
            INSERT INTO customers (company_id, phone, name, gender, birth_date, birth_year, birth_month_day, grade, region, sms_opt_in, email, total_purchase, last_purchase_date, purchase_count, callback, store_name, store_code, uploaded_by, source, created_at, updated_at)
            VALUES ${placeholders.join(', ')}
            ON CONFLICT (company_id, COALESCE(store_code, '__NONE__'), phone) 
            DO UPDATE SET 
              name = COALESCE(EXCLUDED.name, customers.name),
              gender = COALESCE(EXCLUDED.gender, customers.gender),
              birth_date = COALESCE(EXCLUDED.birth_date, customers.birth_date),
              birth_year = COALESCE(EXCLUDED.birth_year, customers.birth_year),
              birth_month_day = COALESCE(EXCLUDED.birth_month_day, customers.birth_month_day),
              grade = COALESCE(EXCLUDED.grade, customers.grade),
              region = COALESCE(EXCLUDED.region, customers.region),
              sms_opt_in = COALESCE(EXCLUDED.sms_opt_in, customers.sms_opt_in),
              email = COALESCE(EXCLUDED.email, customers.email),
              total_purchase = COALESCE(EXCLUDED.total_purchase, customers.total_purchase),
              last_purchase_date = COALESCE(EXCLUDED.last_purchase_date, customers.last_purchase_date),
              purchase_count = COALESCE(EXCLUDED.purchase_count, customers.purchase_count),
              callback = COALESCE(EXCLUDED.callback, customers.callback),
              store_name = COALESCE(EXCLUDED.store_name, customers.store_name),
              store_code = COALESCE(EXCLUDED.store_code, customers.store_code),
              uploaded_by = COALESCE(EXCLUDED.uploaded_by, customers.uploaded_by),
              source = CASE WHEN customers.source = 'sync' THEN 'sync' ELSE 'upload' END,
              updated_at = NOW()
            RETURNING (xmax = 0) as is_insert, phone
          `, values);

          result.rows.forEach((r: any) => {
            if (r.is_insert) insertCount++;
            else duplicateCount++;
          });

          // customer_stores N:N 매핑
          if (hasFileStoreCode && batchPhones.length > 0) {
            await query(`
              INSERT INTO customer_stores (company_id, customer_id, store_code)
              SELECT c.company_id, c.id, c.store_code
              FROM customers c
              WHERE c.company_id = $1 AND c.phone = ANY($2::text[]) AND c.store_code IS NOT NULL AND c.store_code != ''
              ON CONFLICT (customer_id, store_code) DO NOTHING
            `, [companyId, batchPhones]);
          }
          if (!hasFileStoreCode && userStoreCodes.length > 0 && batchPhones.length > 0) {
            await query(`
              INSERT INTO customer_stores (company_id, customer_id, store_code)
              SELECT $1, c.id, unnest($2::text[])
              FROM customers c
              WHERE c.company_id = $1 AND c.phone = ANY($3::text[])
              ON CONFLICT (customer_id, store_code) DO NOTHING
            `, [companyId, userStoreCodes, batchPhones]);
          }
        } catch (err) {
          console.error('[업로드 백그라운드] Batch insert error:', err);
          errorCount += batch.length;
        }
      }

      // 진행률 업데이트
      const processed = Math.min(i + BATCH_SIZE, totalRows);
      await redis.set(`upload:${fileId}:progress`, JSON.stringify({
        status: 'processing',
        total: totalRows,
        processed,
        percent: Math.round((processed / totalRows) * 100),
        insertCount,
        duplicateCount,
        errorCount,
        startedAt,
        message: '처리 중...'
      }), 'EX', 3600);
    }

    // ===== 완료 =====
    const completedAt = new Date().toISOString();
    await redis.set(`upload:${fileId}:progress`, JSON.stringify({
      status: 'completed',
      total: totalRows,
      processed: totalRows,
      percent: 100,
      insertCount,
      duplicateCount,
      errorCount,
      startedAt,
      completedAt,
      message: `총 ${totalRows.toLocaleString()}건 중 신규 ${insertCount.toLocaleString()}건, 업데이트 ${duplicateCount.toLocaleString()}건${errorCount > 0 ? `, 오류 ${errorCount.toLocaleString()}건` : ''}`
    }), 'EX', 3600);

    console.log(`[업로드 완료] fileId=${fileId}, 신규=${insertCount}, 업데이트=${duplicateCount}, 오류=${errorCount}`);

    // ===== sms_opt_in=false 고객 → unsubscribes 자동 등록 =====
    if (companyId && userId) {
      try {
        const unsubResult = await query(`
          INSERT INTO unsubscribes (company_id, user_id, phone, source)
          SELECT $1, $2, phone, 'db_upload'
          FROM customers
          WHERE company_id = $1 AND sms_opt_in = false AND is_active = true
            AND NOT EXISTS (
              SELECT 1 FROM unsubscribes u WHERE u.company_id = $1 AND u.phone = customers.phone
            )
          ON CONFLICT (user_id, phone) DO NOTHING
        `, [companyId, userId]);
        if (unsubResult.rowCount && unsubResult.rowCount > 0) {
          console.log(`[업로드] 수신거부 자동등록: ${unsubResult.rowCount}건 (company: ${companyId})`);
        }
      } catch (unsubError) {
        console.error('[업로드] 수신거부 자동등록 실패:', unsubError);
      }
    }

    // 파일 삭제
    try { fs.unlinkSync(filePath); } catch (e) {}

  } catch (error: any) {
    console.error('[업로드 백그라운드] 처리 에러:', error);
    await redis.set(`upload:${fileId}:progress`, JSON.stringify({
      status: 'failed',
      total: 0,
      processed: insertCount + duplicateCount + errorCount,
      percent: 0,
      insertCount,
      duplicateCount,
      errorCount,
      startedAt,
      error: error.message || 'DB 처리 오류',
      message: `오류 발생. ${(insertCount + duplicateCount).toLocaleString()}건까지 처리 완료. 재업로드 시 중복 건은 자동 스킵됩니다.`
    }), 'EX', 3600);
  }
}

// ================================================================
// GET /progress/:fileId — 진행률 조회 (강화)
// ================================================================
router.get('/progress/:fileId', async (req: Request, res: Response) => {
  try {
    const { fileId } = req.params;
    const data = await redis.get(`upload:${fileId}:progress`);
    
    if (data) {
      return res.json(JSON.parse(data));
    }
    return res.json({ status: 'unknown', total: 0, processed: 0, percent: 0 });
  } catch (error) {
    return res.json({ status: 'unknown', total: 0, processed: 0, percent: 0 });
  }
});

export default router;
