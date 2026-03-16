import { Request, Response, Router } from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import * as XLSX from 'xlsx';
import { query } from '../config/database';
import { redis, AI_MODELS, AI_MAX_TOKENS, CACHE_TTL, TIMEOUTS, BATCH_SIZES } from '../config/defaults';
import { normalizeByFieldKey, normalizeRegion } from '../utils/normalize';
import { CATEGORY_LABELS, FIELD_MAP, getColumnFields, getCustomFields, getFieldByKey, upsertCustomFieldDefinitions } from '../utils/standard-field-map';

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

// 범용 날짜 정규화: Date객체, 시리얼넘버, YYYYMMDD, YYYY-MM-DD 모두 처리
function normalizeDateValue(value: any): string | null {
  if (value === undefined || value === null || value === '') return null;

  // Date 객체 직접 처리 (XLSX cellDates: true)
  if (value instanceof Date && !isNaN(value.getTime())) {
    const yyyy = value.getFullYear();
    if (yyyy >= 1900 && yyyy <= 2099) {
      const mm = String(value.getMonth() + 1).padStart(2, '0');
      const dd = String(value.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    }
    return null;
  }

  const str = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(str)) return str.replace(/\//g, '-');
  if (/^\d{8}$/.test(str)) {
    return `${str.substring(0, 4)}-${str.substring(4, 6)}-${str.substring(6, 8)}`;
  }
  // ★ D79: YYMMDD 6자리 형식 (250103 → 2025-01-03)
  if (/^\d{6}$/.test(str)) {
    const yy = parseInt(str.substring(0, 2));
    const mm = str.substring(2, 4);
    const dd = str.substring(4, 6);
    const yyyy = yy >= 0 && yy <= 50 ? 2000 + yy : 1900 + yy;
    if (parseInt(mm) >= 1 && parseInt(mm) <= 12 && parseInt(dd) >= 1 && parseInt(dd) <= 31) {
      return `${yyyy}-${mm}-${dd}`;
    }
  }
  const num = Number(str);
  if (!isNaN(num) && num >= 1 && num <= 73050 && Number.isInteger(num)) {
    return excelSerialToDateStr(num);
  }
  return null;
}

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
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, uniqueSuffix + ext);
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
router.post('/parse', authenticate, upload.single('file'), async (req: Request, res: Response) => {
  try {
    // ★ D53: 요금제 게이팅 — customer_db_enabled 체크
    // 직접발송용 파싱(includeData=true)은 게이팅 제외 — 만료 후에도 직접발송 파일등록 허용
    const companyIdForGating = req.user?.companyId;
    const isDirectSendParse = req.query.includeData === 'true';
    if (companyIdForGating && !isDirectSendParse) {
      const planCheck = await query(
        `SELECT p.customer_db_enabled FROM companies c
         LEFT JOIN plans p ON c.plan_id = p.id
         WHERE c.id = $1`,
        [companyIdForGating]
      );
      if (!planCheck.rows[0]?.customer_db_enabled) {
        return res.status(403).json({
          error: '고객 DB 관리는 스타터 이상 요금제에서 이용 가능합니다.',
          code: 'PLAN_FEATURE_LOCKED'
        });
      }
    }

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
      cellDates: true,   // ★ 날짜 셀을 Date 객체로 변환
      raw: false,         // ★ 셀 포매팅 적용 (숫자 정밀도 유지)
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
    }), 'EX', CACHE_TTL.uploadMeta); // 10분

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
router.post('/mapping', authenticate, async (req: Request, res: Response) => {
  try {
    const { headers } = req.body;
    
    // FIELD_MAP 기반 동적 매핑 대상 생성
    const mappingTargets: Record<string, string> = {};
    for (const field of FIELD_MAP) {
      const desc = field.fieldKey === 'phone' ? `${field.displayName} (필수)` : field.displayName;
      mappingTargets[field.fieldKey] = desc;
    }
    // 파생 필드 — DB 컬럼에 존재하지만 FIELD_MAP에는 없는 인식 대상
    mappingTargets['birth_year'] = '출생연도 (4자리 연도만 있을 때. 생년월일 전체는 birth_date에)';

    const mappingPrompt = `엑셀 파일의 컬럼명을 데이터베이스 컬럼에 매핑해줘.

엑셀 컬럼명: ${JSON.stringify(headers)}

DB 컬럼 (매핑 대상):
${Object.entries(mappingTargets).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

규칙:
1. 의미가 비슷하면 매핑해줘 (예: tier → grade, marketing_opt_in → sms_opt_in, total_spend → total_purchase_amount)
2. 위 필드에 해당하지 않는 컬럼은 custom_1부터 순서대로 배정 (최대 custom_15까지)
3. phone(전화번호)은 반드시 찾아서 매핑해줘
4. customer_id, created_at 등 시스템 컬럼은 null
5. age는 정수 나이만 매핑. 연령대(20대 등)는 custom 필드로 배정
6. ⚠️ 매장 관련 필드 구분 (반드시 정확히 매핑!):
   - registered_store: 등록매장, 가입매장, 소속매장, 주이용매장 등 고객이 등록된/소속된 매장명
   - recent_purchase_store: 최근구매매장, 최종구매매장, 마지막구매매장 등 가장 최근에 구매한 매장명
   - store_code: 브랜드코드, 구분코드, 분류코드 등 브랜드 식별 코드 (CPB, NARS 등)
   - store_phone: 매장전화번호, 매장번호 등 매장의 전화번호
   - store_name: 매장명, 점포명 등 매장 이름 (등록매장/구매매장이 아닌 단순 매장명)
   ※ "매장명"만 있을 때 → 문맥상 등록/소속 매장이면 registered_store, 구매 매장이면 recent_purchase_store, 단순 매장명이면 store_name
7. ⚠️ 날짜/구매 관련 필드 구분:
   - birth_date: 생년월일, 생일 (YYYY-MM-DD 또는 YYYYMMDD)
   - recent_purchase_date: 최근구매일, 최종구매일, 마지막구매일 등 가장 최근 구매 날짜
   - recent_purchase_amount: 최근구매금액, 최종구매금액
   - total_purchase_amount: 누적구매금액, 총구매금액
   - purchase_count: 구매횟수, 구매건수, 구매수

JSON 형식으로만 응답해줘 (다른 설명 없이):
{"엑셀컬럼명": "DB컬럼명(영문 key) 또는 null", ...}

예시: {"고객번호": null, "휴대폰": "phone", "이름": "name", "성별코드": "gender", "등급": "grade", "구매횟수": "purchase_count", "최근구매일": "recent_purchase_date"}
⚠️ 반드시 DB컬럼의 영문 key(phone, name, gender 등)를 값으로 넣어야 합니다. 한글 설명을 넣지 마세요!`;

    let aiText = '{}';

    // 1차: Claude
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY || '',
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: AI_MODELS.claude,
          max_tokens: AI_MAX_TOKENS.fieldMapping,
          messages: [{ role: 'user', content: mappingPrompt }]
        })
      });
      const aiResult: any = await response.json();
      if (aiResult.error) throw new Error(aiResult.error.message || 'Claude API error');
      aiText = aiResult.content?.[0]?.text || '{}';
      console.log('[AI 매핑] Claude 호출 성공');
    } catch (claudeErr: any) {
      console.warn(`[AI 매핑] Claude 실패 (${claudeErr.message}) → gpt-5.1 fallback`);

      // 2차: gpt-5.1 fallback
      if (!process.env.OPENAI_API_KEY) throw new Error('Claude 실패 + OPENAI_API_KEY 미설정');
      const gptResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: AI_MODELS.gpt,
          max_completion_tokens: AI_MAX_TOKENS.fieldMapping,
          messages: [{ role: 'user', content: mappingPrompt }]
        })
      });
      const gptResult: any = await gptResponse.json();
      aiText = gptResult.choices?.[0]?.message?.content || '{}';
      console.log('[AI 매핑] gpt-5.1 fallback 성공');
    }
    
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

    // 표준 필드 정보 (프론트엔드 동적 렌더링용 — 직접 컬럼 + 파생 필드)
    const standardFields = FIELD_MAP.filter(f => f.storageType === 'column').map(f => ({
      fieldKey: f.fieldKey,
      displayName: f.displayName,
      category: f.category,
      dataType: f.dataType,
      sortOrder: f.sortOrder
    }));
    // 파생 필드 추가 (DB 컬럼 존재, FIELD_MAP 미포함이지만 프론트엔드 표시 필요)
    standardFields.push(
      { fieldKey: 'birth_year', displayName: '출생연도', category: 'basic', dataType: 'number', sortOrder: 5.1 },
      { fieldKey: 'birth_month_day', displayName: '생일(월-일)', category: 'basic', dataType: 'string', sortOrder: 5.2 }
    );
    standardFields.sort((a: any, b: any) => a.sortOrder - b.sortOrder);

    return res.json({
      success: true,
      mapping,
      unmapped,
      hasPhone,
      standardFields,
      categoryLabels: CATEGORY_LABELS,
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
    const { fileId, mapping, customLabels } = req.body;
    const companyId = req.user?.companyId;
    const userId = (req as any).user?.userId;

    // ★ D53: 요금제 게이팅 — customer_db_enabled 체크
    if (companyId) {
      const planCheck = await query(
        `SELECT p.customer_db_enabled FROM companies c
         LEFT JOIN plans p ON c.plan_id = p.id
         WHERE c.id = $1`,
        [companyId]
      );
      if (!planCheck.rows[0]?.customer_db_enabled) {
        return res.status(403).json({
          error: '고객 DB 관리는 스타터 이상 요금제에서 이용 가능합니다.',
          code: 'PLAN_FEATURE_LOCKED'
        });
      }
    }

    if (!fileId || !mapping || !companyId) {
      return res.status(400).json({ 
        error: '필수 파라미터가 없습니다.',
        missing: { fileId: !fileId, mapping: !mapping, companyId: !companyId }
      });
    }

    // 파일 존재 확인 — path.basename으로 경로 탐색 방어
    const uploadDir = path.join(__dirname, '../../uploads');
    const safeFileId = path.basename(fileId);
    const filePath = path.join(uploadDir, safeFileId);
    
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
      const workbook = XLSX.readFile(filePath, { type: 'file', cellFormula: false, cellHTML: false, cellStyles: false, cellDates: true, raw: false, sheetStubs: false });
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
    }), 'EX', CACHE_TTL.uploadProgress);

    // 즉시 응답 (1초 이내)
    res.json({ success: true, fileId, totalRows, message: '백그라운드 처리 시작' });

    // 백그라운드 처리 (res 반환 이후 실행)
    processUploadInBackground(fileId, filePath, mapping, companyId, userId, startedAt, customLabels).catch(err => {
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
  startedAt: string,
  customLabels?: Record<string, string>
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
      cellDates: true,   // ★ 날짜 셀을 Date 객체로 변환
      raw: false,         // ★ 셀 포매팅 적용 (숫자 정밀도 유지)
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

    const BATCH_SIZE = BATCH_SIZES.customerUpload;
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
          const fieldKey = mapping[header];
          if (fieldKey && row[idx] !== undefined && row[idx] !== null && row[idx] !== '') {
            record[fieldKey] = row[idx];
          }
        });

        // ── FIELD_MAP 기반 정규화 ──
        // birth_date는 파생 필드 계산에서 특별 처리 (4자리 연도, Excel 시리얼넘버 등)
        for (const key of Object.keys(record)) {
          if (key === 'birth_date') continue;
          if (getFieldByKey(key)) {
            record[key] = normalizeByFieldKey(key, record[key]);
          }
        }

        // phone 필수 체크 (normalizeByFieldKey에서 normalizePhone 적용됨)
        if (!record.phone) {
          errorCount++;
          continue;
        }

        // ★ 브랜드 격리: 파일에 store_code 컬럼이 없으면 업로드 사용자의 store_codes[0] 자동 할당
        // → UNIQUE(company_id, store_code, phone) 제약에 의해 브랜드별 별개 레코드로 분리됨
        if (!hasFileStoreCode && !record.store_code && userStoreCodes.length > 0) {
          record.store_code = userStoreCodes[0];
        }

        // 배치 내 중복: store_code 포함 dedupe
        const dedupeKey = `${record.phone}__${record.store_code || '__NONE__'}`;
        if (seenInBatch.has(dedupeKey)) {
          duplicateCount++;
          continue;
        }
        seenInBatch.add(dedupeKey);
        batchPhones.push(record.phone);

        // ── 파생 필드 계산 ──
        let derivedBirthYear: number | null = null;
        let derivedBirthMonthDay: string | null = null;
        let derivedAge: number | null = null;
        let derivedRegion: string | null = null;
        const currentYear = new Date().getFullYear();

        // birth_date → birth_year, birth_month_day, age 파생
        if (record.birth_date) {
          // ★ B17-09: Date 객체(XLSX cellDates)를 String()하면 영문 형식이 되어 정규화 실패
          // normalizeDateValue()가 Date 객체를 직접 처리하도록 먼저 호출
          if (record.birth_date instanceof Date) {
            const normalized = normalizeDateValue(record.birth_date);
            record.birth_date = normalized || record.birth_date;
          }
          const bd = String(record.birth_date).trim();
          if (/^\d{4}$/.test(bd) && parseInt(bd) >= 1900 && parseInt(bd) <= 2099) {
            // 4자리 연도만 입력 (예: 1983)
            derivedBirthYear = parseInt(bd);
            derivedAge = currentYear - derivedBirthYear;
            record.birth_date = null; // date 타입에 연도만 넣으면 에러
          } else {
            const normalized = normalizeDateValue(bd);
            if (normalized) {
              record.birth_date = normalized;
              derivedBirthYear = parseInt(normalized.substring(0, 4));
              derivedBirthMonthDay = normalized.substring(5, 10);
              derivedAge = currentYear - derivedBirthYear;
            }
          }
        }

        // birth_year 직접 매핑 (birth_date가 없을 때)
        if (record.birth_year && !derivedBirthYear) {
          const by = parseInt(String(record.birth_year));
          if (!isNaN(by) && by >= 1900 && by <= 2099) {
            derivedBirthYear = by;
            derivedAge = currentYear - by;
          }
        }

        // age: 파생값 우선, 없으면 직접 매핑값
        if (derivedAge) {
          record.age = derivedAge;
        }

        // region: 직접 매핑 우선, 없으면 address에서 파생
        if (record.region) {
          derivedRegion = normalizeRegion(record.region);
        } else if (record.address && typeof record.address === 'string') {
          const firstToken = record.address.split(/[\s,]/)[0];
          if (firstToken) derivedRegion = normalizeRegion(firstToken);
        }

        // ── INSERT 값 빌드 (FIELD_MAP 기반 동적) ──
        const columnFieldDefs = getColumnFields(); // 직접 컬럼 필드 (sortOrder 순)
        const rowValues: any[] = [companyId]; // company_id

        for (const field of columnFieldDefs) {
          if (field.fieldKey === 'sms_opt_in') {
            // 수신동의: 미제공 시 기본 true
            const val = record[field.fieldKey];
            rowValues.push(val !== null && val !== undefined ? val : true);
          } else if (field.fieldKey === 'region') {
            // region: 파생값(normalizeRegion 적용) 우선 사용
            rowValues.push(derivedRegion ?? record[field.fieldKey] ?? null);
          } else {
            rowValues.push(record[field.fieldKey] ?? null);
          }
        }

        // 파생 컬럼 (region은 FIELD_MAP 순회에서 처리됨)
        rowValues.push(derivedBirthYear);
        rowValues.push(derivedBirthMonthDay);

        // custom_fields JSONB 빌드
        const customObj: Record<string, any> = {};
        for (const cf of getCustomFields()) {
          if (record[cf.fieldKey] != null && record[cf.fieldKey] !== '') {
            let val = record[cf.fieldKey];
            // ★ B17-09: Date 객체(XLSX cellDates)를 String()하면 영문 형식 그대로 저장됨
            // normalizeDateValue()로 YYYY-MM-DD 변환 후 저장
            if (val instanceof Date) {
              val = normalizeDateValue(val) || String(val);
            }
            customObj[cf.columnName] = String(val);
          }
        }
        rowValues.push(Object.keys(customObj).length > 0 ? JSON.stringify(customObj) : null);

        // uploaded_by
        rowValues.push(userId || null);

        values.push(...rowValues);

        // 플레이스홀더: 파라미터 N개(동적) + 리터럴 3개 ('upload', NOW(), NOW())
        const paramCount = rowValues.length;
        const paramList = Array.from({ length: paramCount }, (_, j) => `$${paramIndex + j}`).join(', ');
        placeholders.push(`(${paramList}, 'upload', NOW(), NOW())`);
        paramIndex += paramCount;
      }

      if (placeholders.length > 0) {
        try {
          // ── 동적 INSERT + ON CONFLICT ──
          const columnFieldDefs = getColumnFields();
          const columnNames = columnFieldDefs.map(f => f.columnName);
          const insertCols = [
            'company_id', ...columnNames,
            'birth_year', 'birth_month_day', 'custom_fields',
            'uploaded_by', 'source', 'created_at', 'updated_at'
          ].join(', ');

          // ON CONFLICT UPDATE: phone, store_code 제외 (UNIQUE 키)
          const updateExclusions = new Set(['phone', 'store_code']);
          const updateClauses = [
            ...columnNames
              .filter(c => !updateExclusions.has(c))
              .map(c => `${c} = COALESCE(EXCLUDED.${c}, customers.${c})`),
            'birth_year = COALESCE(EXCLUDED.birth_year, customers.birth_year)',
            'birth_month_day = COALESCE(EXCLUDED.birth_month_day, customers.birth_month_day)',
            `custom_fields = CASE WHEN EXCLUDED.custom_fields IS NOT NULL THEN COALESCE(customers.custom_fields, '{}'::jsonb) || EXCLUDED.custom_fields ELSE customers.custom_fields END`,
            'uploaded_by = COALESCE(EXCLUDED.uploaded_by, customers.uploaded_by)',
            `source = CASE WHEN customers.source = 'sync' THEN 'sync' ELSE 'upload' END`,
            'updated_at = NOW()'
          ].join(',\n              ');

          const result = await query(`
            INSERT INTO customers (${insertCols})
            VALUES ${placeholders.join(', ')}
            ON CONFLICT (company_id, COALESCE(store_code, '__NONE__'), phone) 
            DO UPDATE SET 
              ${updateClauses}
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
          // B10-03: 파일에 store_code 없고 userStoreCodes도 없지만 DB에 기존 store_code가 있는 경우 보존
          if (!hasFileStoreCode && userStoreCodes.length === 0 && batchPhones.length > 0) {
            await query(`
              INSERT INTO customer_stores (company_id, customer_id, store_code)
              SELECT c.company_id, c.id, c.store_code
              FROM customers c
              WHERE c.company_id = $1 AND c.phone = ANY($2::text[]) AND c.store_code IS NOT NULL AND c.store_code != ''
              ON CONFLICT (customer_id, store_code) DO NOTHING
            `, [companyId, batchPhones]);
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
      }), 'EX', CACHE_TTL.uploadProgress);
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
    }), 'EX', CACHE_TTL.uploadProgress);

    console.log(`[업로드 완료] fileId=${fileId}, 신규=${insertCount}, 업데이트=${duplicateCount}, 오류=${errorCount}`);

    // ===== 커스텀 필드 정의 저장 — CT-07 컨트롤타워 사용 =====
    if (companyId) {
      try {
        const customMappings: Array<{ fieldKey: string; label: string }> = [];
        for (const [header, fieldKey] of Object.entries(mapping)) {
          if (typeof fieldKey === 'string' && fieldKey.startsWith('custom_')) {
            const label = customLabels?.[fieldKey] || header;
            customMappings.push({ fieldKey, label });
          }
        }
        if (customMappings.length > 0) {
          await upsertCustomFieldDefinitions(companyId, customMappings);
        }
      } catch (defErr) {
        console.error('[업로드] 커스텀 필드 정의 저장 실패:', defErr);
      }
    }

    // ===== sms_opt_in=false 고객 → unsubscribes 자동 등록 (CT-03) =====
    // admin이 업로드해도 고객의 store_code 기준 올바른 브랜드 사용자에게 배정
    if (companyId && userId) {
      try {
        const userTypeResult = await query('SELECT user_type FROM users WHERE id = $1', [userId]);
        const uploaderType = userTypeResult.rows[0]?.user_type === 'admin' ? 'company_admin' : 'company_user';

        if (uploaderType === 'company_admin') {
          // admin → 각 고객의 store_code 기준 브랜드 사용자에게 자동 배정
          const unsubResult = await query(`
            INSERT INTO unsubscribes (company_id, user_id, phone, source)
            SELECT c.company_id, u.id, c.phone, 'db_upload'
            FROM customers c
            JOIN users u ON u.company_id = c.company_id
              AND u.user_type = 'user'
              AND c.store_code = ANY(u.store_codes)
            WHERE c.company_id = $1 AND c.sms_opt_in = false AND c.is_active = true
            ON CONFLICT (user_id, phone) DO NOTHING
          `, [companyId]);
          if (unsubResult.rowCount && unsubResult.rowCount > 0) {
            console.log(`[업로드] 수신거부 자동등록(admin→브랜드배정): ${unsubResult.rowCount}건 (company: ${companyId})`);
          }
        } else {
          // 브랜드 사용자 → 본인 user_id로 등록
          const unsubResult = await query(`
            INSERT INTO unsubscribes (company_id, user_id, phone, source)
            SELECT $1, $2, phone, 'db_upload'
            FROM customers
            WHERE company_id = $1 AND sms_opt_in = false AND is_active = true
              AND NOT EXISTS (
                SELECT 1 FROM unsubscribes u WHERE u.user_id = $2 AND u.phone = customers.phone
              )
            ON CONFLICT (user_id, phone) DO NOTHING
          `, [companyId, userId]);
          if (unsubResult.rowCount && unsubResult.rowCount > 0) {
            console.log(`[업로드] 수신거부 자동등록: ${unsubResult.rowCount}건 (company: ${companyId})`);
          }
        }
      } catch (unsubError) {
        console.error('[업로드] 수신거부 자동등록 실패:', unsubError);
      }
    }

    // ===== customer_schema 자동 갱신 (customers.ts 일괄추가와 동일 로직) =====
    // 업로드 완료 후 회사의 customer_schema를 실제 고객 데이터 기반으로 갱신
    // → AI 메시지 생성, 직접발송 변수 치환 등에서 활용
    if (companyId) {
      try {
        await query(`
          UPDATE companies SET customer_schema = (
            SELECT jsonb_build_object(
              'genders', (SELECT array_agg(DISTINCT gender) FROM customers WHERE company_id = $1 AND gender IS NOT NULL),
              'grades', (SELECT array_agg(DISTINCT grade) FROM customers WHERE company_id = $1 AND grade IS NOT NULL),
              'custom_field_keys', (SELECT array_agg(DISTINCT k) FROM customers, jsonb_object_keys(custom_fields) k WHERE company_id = $1),
              'store_codes', (SELECT array_agg(DISTINCT store_code) FROM customer_stores WHERE company_id = $1)
            )
          ) WHERE id = $1
        `, [companyId]);
        console.log(`[업로드] customer_schema 갱신 완료 (company: ${companyId})`);
      } catch (schemaErr) {
        console.error('[업로드] customer_schema 갱신 실패:', schemaErr);
      }
    }

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
    }), 'EX', CACHE_TTL.uploadProgress);
  } finally {
    // 파일 삭제 (성공/실패 무관하게 반드시 실행)
    try { fs.unlinkSync(filePath); } catch (e) {}
  }
}

// ================================================================
// GET /progress/:fileId — 진행률 조회 (강화)
// ================================================================
router.get('/progress/:fileId', authenticate, async (req: Request, res: Response) => {
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

// ================================================================
// 잔존 업로드 파일 자동 정리 (1시간 초과 파일 삭제)
// /parse 후 /save를 타지 않은 파일, 에러로 누락된 파일 정리
// ================================================================
function cleanupStaleUploads() {
  const uploadDir = path.join(__dirname, '../../uploads');
  if (!fs.existsSync(uploadDir)) return;

  const ONE_HOUR_MS = 60 * 60 * 1000;
  const now = Date.now();
  let cleaned = 0;

  try {
    const files = fs.readdirSync(uploadDir);
    for (const file of files) {
      const filePath = path.join(uploadDir, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.isFile() && (now - stat.mtimeMs) > ONE_HOUR_MS) {
          fs.unlinkSync(filePath);
          cleaned++;
        }
      } catch (e) { /* 개별 파일 에러 무시 */ }
    }
    if (cleaned > 0) {
      console.log(`[업로드 정리] 잔존 파일 ${cleaned}개 삭제 완료`);
    }
  } catch (err) {
    console.error('[업로드 정리] 디렉토리 스캔 실패:', err);
  }
}

// 서버 시작 시 1회 정리 + 1시간 간격 반복
cleanupStaleUploads();
setInterval(cleanupStaleUploads, TIMEOUTS.uploadCleanup);

export default router;
