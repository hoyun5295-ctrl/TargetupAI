import { Router, Request, Response } from 'express';
import Redis from 'ioredis';
import { normalizePhone, normalizeGender, normalizeGrade, normalizeRegion, normalizeSmsOptIn } from '../utils/normalize';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
import multer from 'multer';
import * as XLSX from 'xlsx';
import path from 'path';
import fs from 'fs';

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

// 파일 업로드 및 파싱
router.post('/parse', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '파일이 없습니다.' });
    }

    const filePath = req.file.path;
    const workbook = XLSX.readFile(filePath, {
      type: 'file',
      cellFormula: false,  // 수식 파싱 안함
      cellHTML: false,     // HTML 파싱 안함
      cellStyles: false,   // 스타일 파싱 안함
      sheetStubs: false,   // 빈 셀 스킵
    });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // JSON으로 변환
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
    
    if (data.length === 0) {
      return res.status(400).json({ error: '파일이 비어있습니다.' });
    }

    // 첫 행이 헤더인지 데이터인지 판별
    // 첫 행이 전부 숫자면 헤더 없는 것으로 판단
    const firstRow = data[0];
    const isFirstRowHeader = firstRow.some((cell: any) => {
      const str = String(cell || '').trim();
      // 숫자가 아니고 빈 문자열도 아니면 헤더로 판단
      return str && isNaN(Number(str.replace(/-/g, '')));
    });

    let headers: string[];
    let dataRows: any[][];
    
    if (isFirstRowHeader) {
      // 첫 행이 헤더
      headers = firstRow.map((h: any) => String(h || ''));
      dataRows = data.slice(1);
    } else {
      // 헤더 없음 - 자동 생성 (A, B, C... 또는 컬럼1, 컬럼2...)
      headers = firstRow.map((_: any, idx: number) => `컬럼${idx + 1}`);
      dataRows = data; // 전체가 데이터
    }

    // 미리보기 데이터 (최대 5행) - 객체 형태로 변환
    const preview = dataRows.slice(0, 5).map(row => {
      const obj: any = {};
      headers.forEach((h, idx) => {
        obj[h] = row[idx];
      });
      return obj;
    });
    
    // 전체 데이터도 객체로 변환
    const allData = dataRows.map(row => {
      const obj: any = {};
      headers.forEach((h, idx) => {
        obj[h] = row[idx];
      });
      return obj;
    });

    const totalRows = dataRows.length;

    // 파일 경로 저장 (나중에 매핑 후 저장할 때 사용)
    const fileId = path.basename(filePath);

    return res.json({
      success: true,
      fileId,
      headers,
      preview,
      allData,
      totalRows
    });

  } catch (error: any) {
    console.error('파일 파싱 에러:', error);
    return res.status(500).json({ error: error.message || '파일 처리 중 오류가 발생했습니다.' });
  }
});
// AI 컬럼 매핑 (Claude API)
router.post('/mapping', async (req: Request, res: Response) => {
  try {
    const { headers } = req.body;
    
    // 우리 DB 컬럼 정의
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
      callback: '매장번호/회신번호 (발신번호로 사용되는 매장 전화번호)'
    };

    // Claude API 호출
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
    
    // JSON 파싱
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

    // phone 필수 체크
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
// 고객 데이터 저장 (source = 'upload')
router.post('/save', authenticate, async (req: Request, res: Response) => {
  try {
    const { fileId, mapping } = req.body;
    const companyId = req.user?.companyId;
    
    if (!fileId || !mapping || !companyId) {
      console.log('Missing params:', { fileId: !!fileId, mapping: !!mapping, companyId: !!companyId });
      return res.status(400).json({ 
        error: '필수 파라미터가 없습니다.',
        missing: { fileId: !fileId, mapping: !mapping, companyId: !companyId }
      });
    }

    // 파일 읽기
    const uploadDir = path.join(__dirname, '../../uploads');
    const filePath = path.join(uploadDir, fileId);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
    }

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

    // DB 연결
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL
    });

    // 플랜 초과 체크
    const limitCheck = await pool.query(`
      SELECT 
        c.id,
        p.max_customers,
        p.plan_name,
        (SELECT COUNT(*) FROM customers WHERE company_id = c.id AND is_active = true) as current_count
      FROM companies c
      LEFT JOIN plans p ON c.plan_id = p.id
      WHERE c.id = $1
    `, [companyId]);

    if (limitCheck.rows.length > 0) {
      const { max_customers, current_count, plan_name } = limitCheck.rows[0];
      const newTotal = Number(current_count) + rows.length;
      if (max_customers && newTotal > max_customers) {
        const available = Number(max_customers) - Number(current_count);
        await pool.end();
        return res.status(403).json({ 
          error: '최대 고객 관리 DB를 초과합니다. 플랜을 업그레이드하세요.',
          code: 'PLAN_LIMIT_EXCEEDED',
          planName: plan_name,
          maxCustomers: max_customers,
          currentCount: Number(current_count),
          requestedCount: rows.length,
          availableCount: available > 0 ? available : 0
        });
      }
    }

    let insertCount = 0;
    let duplicateCount = 0;
    let errorCount = 0;

    // Bulk INSERT (4000건씩)
    const BATCH_SIZE = 4000;
// 진행률 초기화
await redis.set(`upload:${fileId}:progress`, JSON.stringify({
  total: rows.length,
  processed: 0,
  percent: 0
}), 'EX', 300);
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const values: any[] = [];
      const placeholders: string[] = [];
      let paramIndex = 1;

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
          const bd = String(record.birth_date);
          if (bd.length === 10 && bd.includes('-')) {
            record.birth_year = parseInt(bd.substring(0, 4));
            record.birth_month_day = bd.substring(5, 10);
          } else if (bd.length === 4 && !isNaN(Number(bd))) {
            record.birth_year = parseInt(bd);
          }
        }
        if (record.birth_year && !record.birth_date) {
          record.birth_year = parseInt(String(record.birth_year));
        }

        // phone 정규화 + 필수 체크
        record.phone = normalizePhone(record.phone);
        if (!record.phone) {
          errorCount++;
          continue;
        }

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
          record.callback ? String(record.callback).replace(/-/g, '').trim() : null
        );

        placeholders.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6}, $${paramIndex + 7}, $${paramIndex + 8}, $${paramIndex + 9}, $${paramIndex + 10}, $${paramIndex + 11}, $${paramIndex + 12}, $${paramIndex + 13}, $${paramIndex + 14}, 'upload', NOW(), NOW())`);
        paramIndex += 15;
      }

      if (placeholders.length === 0) continue;

      try {
        const result = await pool.query(`
          INSERT INTO customers (company_id, phone, name, gender, birth_date, birth_year, birth_month_day, grade, region, sms_opt_in, email, total_purchase, last_purchase_date, purchase_count, callback, source, created_at, updated_at)
          VALUES ${placeholders.join(', ')}
          ON CONFLICT (company_id, phone) 
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
            source = CASE WHEN customers.source = 'sync' THEN 'sync' ELSE 'upload' END,
            updated_at = NOW()
          RETURNING (xmax = 0) as is_insert
        `, values);

        result.rows.forEach((r: any) => {
          if (r.is_insert) insertCount++;
          else duplicateCount++;
        });
      // 진행률 업데이트
      const processed = Math.min(i + BATCH_SIZE, rows.length);
      await redis.set(`upload:${fileId}:progress`, JSON.stringify({
        total: rows.length,
        processed,
        percent: Math.round((processed / rows.length) * 100)
      }), 'EX', 300);

      } catch (err) {
        console.error('Batch insert error:', err);
        errorCount += batch.length;
      }
    }

    await pool.end();

    // 업로드 파일 삭제 (에러 무시)
    try { fs.unlinkSync(filePath); } catch (e) {}

    return res.json({
      success: true,
      insertCount,
      duplicateCount,
      errorCount,
      totalProcessed: insertCount + duplicateCount,
      message: `${insertCount}건 신규 추가, ${duplicateCount}건 중복`
    });

  } catch (error: any) {
    console.error('저장 에러:', error);
    return res.status(500).json({ error: error.message || '저장 중 오류가 발생했습니다.' });
  }
});
// 진행률 조회 API
router.get('/progress/:fileId', async (req: Request, res: Response) => {
  try {
    const { fileId } = req.params;
    const data = await redis.get(`upload:${fileId}:progress`);
    
    if (data) {
      return res.json(JSON.parse(data));
    }
    return res.json({ total: 0, processed: 0, percent: 0 });
  } catch (error) {
    return res.json({ total: 0, processed: 0, percent: 0 });
  }
});

export default router;