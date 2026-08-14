import { Request, Response, Router } from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import * as XLSX from 'xlsx';
import Anthropic from '@anthropic-ai/sdk';
import { query } from '../config/database';
import { redis, AI_MODELS, AI_MAX_TOKENS, CACHE_TTL, TIMEOUTS, BATCH_SIZES, isAdaptiveOnlyModel, resolveMaxTokens } from '../config/defaults';
import { normalizeByFieldKey, normalizeRegion, normalizeDate, normalizeCustomFieldValue, salvageBirthParts } from '../utils/normalize';
import { CATEGORY_LABELS, FIELD_MAP, getColumnFields, getCustomFields, getFieldByKey, upsertCustomFieldDefinitions } from '../utils/standard-field-map';
import { validateUploadMapping } from '../utils/upload-mapping-validator';
import { createCustomerUpsertBuilder, buildSmsOptInBackfill, isRowLevelDbError } from '../utils/customer-upsert';
// ★ 2026-06-25: 고객 업로드 완료 시 회사 데이터 프로필 캐시 무효화(게이트 "고객 없음" 오표시 차단)
import { clearCompanyDataProfileCache } from '../utils/company-data-profile';
import { clearEnabledFieldsCache } from '../utils/enabled-fields';
import { dropEmptyColumns, dropEmptyHeaderColumns, isFirstRowHeaderRow } from '../utils/excel-columns';
import { registerBulkCompanyUserUnsubscribes } from '../utils/unsubscribe-helper';

// ★ D79: 날짜 정규화는 컨트롤타워(normalize.ts)의 normalizeDate() 사용
// 인라인 normalizeDate 제거 — 컨트롤타워 원칙 위반이었음

import { authenticate } from '../middlewares/auth';
import { blockIfSyncActive } from '../middlewares/sync-active-check';
// ★ D219+ Part 2 후속 (2026-05-27): CT-96 활용 — AddressBookModal AI 자동 매핑 (STARTER+ 게이팅)
import { requirePlanFeature } from '../utils/plan-guard';
import { mapColumnsWithAi, ColumnMappingError } from '../utils/ai-column-mapper';

const router = Router();

// ★ 2026-07-06 raw fetch 폐기 — SDK 클라이언트 (7/1 Sonnet 5 게이팅 sweep이 raw fetch만 놓쳐
//   적응형 사고 블록 선행 시 빈 매핑이 되던 사고의 뿌리. ai-call-invariants.test가 raw fetch 재유입을 기계 차단)
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });

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

// ================================================================
// ★ D141 B1: 동일 헤더 자동 디덱싱 (헬퍼)
//   고객사 엑셀에 같은 이름의 컬럼이 2개 있으면 (예: "전화번호" 2개)
//   객체 키 충돌로 한쪽 데이터가 사라지고 매핑 시 모두 동일 값으로 적용되는 사고 방지.
//   해법: 두 번째 이후 동일 헤더에 " (2)", " (3)" 접미사를 자동 부여.
//   빈 헤더는 "컬럼N"으로 통일.
//
//   적용 3곳: POST /parse / POST /validate-mapping / processUploadInBackground.
//   세 곳이 동일 결과를 내야 클라이언트 mapping(unique header key)과 백엔드 처리가 일치한다.
// ================================================================
function dedupeHeaders(rawHeaders: any[]): string[] {
  // ★ Set 기반 단일 패스 — 결과가 항상 unique 보장 (엣지 케이스 포함)
  //   예) 입력 ["전화번호", "전화번호", "전화번호 (2)"] → 출력 ["전화번호", "전화번호 (2)", "전화번호 (3)"]
  //   카운터 기반 단순 디덱싱은 위 입력에서 ["전화번호", "전화번호 (2)", "전화번호 (2)"] 충돌 가능.
  const seen = new Set<string>();
  const result: string[] = [];
  rawHeaders.forEach((raw, idx) => {
    let h = String(raw ?? '').trim();
    if (!h) h = `컬럼${idx + 1}`;
    let candidate = h;
    let n = 2;
    while (seen.has(candidate)) {
      candidate = `${h} (${n})`;
      n++;
    }
    seen.add(candidate);
    result.push(candidate);
  });
  return result;
}

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB — 엑셀 업로드 상한
    files: 1,
  },
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
    // ★ 2026-08-14: D53 customer_db_enabled 게이팅 제거 — 고객 DB 잠금 폐지(plan-guard.ts 상단 주석).
    //   canUseFeature('customer_db')는 항상 허용으로 바꿨는데 이 인라인 조회가 남아 미가입 업로드를 계속 막았다(Codex 1R).

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
    
    let data = dropEmptyColumns(XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null }) as any[][]);

    if (data.length === 0) {
      return res.status(400).json({ error: '파일이 비어있습니다.' });
    }

    // 첫 행이 헤더인지 판별 (CT — 3경로 동일 판정)
    const isFirstRowHeader = isFirstRowHeaderRow(data[0]);
    // ★ 2026-06-23: 헤더 있는 파일은 헤더 빈 잡열(컬럼5·7 — E열 SMS수신여부 등) 매핑에서 제외
    if (isFirstRowHeader) data = dropEmptyHeaderColumns(data);
    const firstRow = data[0];

    // ★ D141 B1: 동일 헤더 자동 디덱싱 (dedupeHeaders 헬퍼)
    let headers: string[];
    let dataRows: any[][];

    if (isFirstRowHeader) {
      headers = dedupeHeaders(firstRow);
      dataRows = data.slice(1);
    } else {
      headers = firstRow.map((_: any, idx: number) => `컬럼${idx + 1}`);
      dataRows = data;
    }

    // 미리보기 (최대 5행)
    // ★ D100: Date 객체를 YYYY-MM-DD로 변환 — normalizeDate 컨트롤타워 사용 (인라인 금지)
    const preview = dataRows.slice(0, 5).map(row => {
      const obj: any = {};
      headers.forEach((h, idx) => {
        let val = row[idx];
        if (val instanceof Date) {
          val = normalizeDate(val) || val;
        }
        obj[h] = val;
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
    // ★ D100: Date 객체를 YYYY-MM-DD 문자열로 변환 — normalizeDate 컨트롤타워 사용
    //   근본 원인: JSON.stringify(Date) → UTC ISO 문자열("1995-02-28T15:00:00.000Z") → 프론트에서 하루 밀림
    if (includeData) {
      response.allData = dataRows.map(row => {
        const obj: any = {};
        headers.forEach((h, idx) => {
          let val = row[idx];
          if (val instanceof Date) {
            val = normalizeDate(val) || val;
          }
          obj[h] = val;
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

    let aiText = '';

    // 1차: Claude (★ 2026-07-06 raw fetch → SDK 전환 — analysis.ts 정답 패턴 미러.
    //   7/1 Sonnet 5 전환의 게이팅 sweep이 raw fetch만 놓쳐, 적응형 사고 블록이 첫 블록으로 오면
    //   content[0].text=undefined → 빈 매핑인데 "호출 성공" 로그가 찍히던 사고(박성용 0706 18:01)의 뿌리.)
    try {
      const adaptiveGuard: any = isAdaptiveOnlyModel(AI_MODELS.claude) ? { thinking: { type: 'disabled' } } : {};
      const response: any = await anthropic.messages.create({
        model: AI_MODELS.claude,
        max_tokens: resolveMaxTokens(AI_MAX_TOKENS.fieldMapping, AI_MODELS.claude),
        messages: [{ role: 'user', content: mappingPrompt }],
        ...adaptiveGuard,
      });
      // 첫 블록 가정 폐기 — text 타입 블록 탐색 (사고 블록 선행 대응)
      aiText = (response.content || []).find((b: any) => b?.type === 'text')?.text || '';
      if (!aiText.trim()) throw new Error('응답에 text 블록 없음');
      console.log('[AI 매핑] Claude 호출 성공');
    } catch (claudeErr: any) {
      console.warn(`[AI 매핑] Claude 실패 (${claudeErr.message}) → gpt fallback`);

      // 2차: gpt fallback
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
      // ★ 2026-07-06 폴백 응답 검증 — 오류/빈 응답인데 "성공" 로그를 찍고 빈 매핑을 내보내던 위장 성공 제거 (6원칙 ②)
      if (gptResult.error) throw new Error(`gpt fallback 실패: ${gptResult.error.message || 'API error'}`);
      aiText = gptResult.choices?.[0]?.message?.content || '';
      if (!aiText.trim()) throw new Error('gpt fallback 응답 비어 있음');
      console.log('[AI 매핑] gpt fallback 성공');
    }

    let mapping: { [key: string]: string | null } = {};
    try {
      const jsonMatch = aiText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        mapping = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.error('AI 응답 파싱 실패:', aiText);
    }

    // ★ 2026-07-06 빈 매핑 정직 처리 — AI가 매핑 JSON을 못 준 경우 "AI 매핑 완료"로 위장하지 않고
    //   전 컬럼 null + 명시 안내로 수동 매핑을 유도한다 (모달은 열려야 수동 배정 가능 — 200 유지).
    const aiMappingEmpty = Object.keys(mapping).length === 0;
    if (aiMappingEmpty) {
      console.error('[AI 매핑] 매핑 결과 0건 — 수동 매핑 안내로 응답:', aiText.slice(0, 200));
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
      // ★ 2026-07-06 정직 안내 — AI 매핑 0건이면 "완료" 위장 대신 수동 매핑 안내
      message: aiMappingEmpty
        ? 'AI 자동 매핑에 실패했습니다. 컬럼을 수동으로 선택해주세요.'
        : (hasPhone ? 'AI 매핑 완료' : '전화번호 컬럼을 찾을 수 없습니다.')
    });

  } catch (error: any) {
    console.error('매핑 에러:', error);
    return res.status(500).json({ error: error.message || '매핑 중 오류가 발생했습니다.' });
  }
});

// ================================================================
// POST /validate-mapping — 업로드 매핑 충돌 검증 (D111)
// ================================================================
// Harold님 지시: 기존 customer_field_definitions 와 매핑 충돌 사전 감지.
// /mapping 직후 /save 호출 전에 반드시 이 API 통과.
// 컨트롤타워: utils/upload-mapping-validator.ts validateUploadMapping
// ================================================================
router.post('/validate-mapping', authenticate, async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const { fileId, mapping, customLabels } = req.body as {
      fileId: string;
      mapping: Record<string, string | null>;
      customLabels?: Record<string, string>;
    };

    if (!companyId) {
      return res.status(403).json({ error: '권한이 없습니다.' });
    }
    if (!fileId || !mapping) {
      return res.status(400).json({ error: 'fileId, mapping 은 필수입니다.' });
    }

    const uploadDir = path.join(__dirname, '../../uploads');
    const safeFileId = path.basename(fileId);
    const filePath = path.join(uploadDir, safeFileId);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '파일을 찾을 수 없습니다. 다시 업로드해주세요.' });
    }

    // 파일에서 샘플 20행 추출 — 타입 감지용
    const workbook = XLSX.readFile(filePath, {
      type: 'file',
      cellFormula: false,
      cellHTML: false,
      cellStyles: false,
      cellDates: true,
      raw: false,
      sheetStubs: false,
    });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    let data = dropEmptyColumns(XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as any[][]);
    if (data.length === 0) {
      return res.status(400).json({ error: '파일이 비어있습니다.' });
    }
    // ★ 2026-06-23: /parse와 동일 — 헤더 있는 파일은 헤더 빈 잡열 제외(매핑 키 일치)
    if (isFirstRowHeaderRow(data[0] as any[])) data = dropEmptyHeaderColumns(data);
    // ★ D141 B1: dedupeHeaders 헬퍼 — /parse와 동일 결과 보장
    //   클라이언트가 보낸 mapping의 unique header 키와 백엔드 sampleData의 키가 일치해야
    //   매핑 검증 결과(타입 감지 등)가 정확.
    const headers = dedupeHeaders(data[0] as any[]);
    const rows = data.slice(1, Math.min(21, data.length));

    const sampleData: Record<string, any[]> = {};
    headers.forEach((h, idx) => {
      sampleData[h] = rows.map(r => r[idx]);
    });

    const result = await validateUploadMapping(
      companyId,
      mapping,
      customLabels || {},
      sampleData
    );

    return res.json({ success: true, ...result });
  } catch (error: any) {
    console.error('매핑 검증 에러:', error);
    return res.status(500).json({ error: error.message || '매핑 검증 중 오류가 발생했습니다.' });
  }
});

// ================================================================
// POST /save — 백그라운드 처리 (즉시 반환)
// ================================================================
router.post('/save', authenticate, blockIfSyncActive, async (req: Request, res: Response) => {
  try {
    const { fileId, mapping, customLabels } = req.body;
    const companyId = req.user?.companyId;
    const userId = (req as any).user?.userId;

    // ★ 2026-08-14: D53 customer_db_enabled 게이팅 제거 — 고객 DB 잠금 폐지(plan-guard.ts 상단 주석).

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
      const data = dropEmptyColumns(XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as any[][]);
      totalRows = Math.max(0, data.length - 1);
    }

    // ★ 2026-08-14: 플랜 초과 사전 체크(max_customers) 제거 — 2026-06-30 크레딧 모델 v2
    //   "DB 저장 상한 폐지" 확정분의 적재 경로 반영. 저장 건수로 막지 않는다(규모 통제 = 일일 분석 크레딧).
    //   sync.ts·customers.ts 동일 패턴과 같은 세션에 일괄 제거했다.

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
    let data = dropEmptyColumns(XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null }) as any[][]);
    // ★ 2026-06-23: /parse·/validate-mapping과 동일 — 헤더 있는 파일은 헤더 빈 잡열 제외(매핑 키 일치·데이터 손실 0)
    if (isFirstRowHeaderRow(data[0] as any[])) data = dropEmptyHeaderColumns(data);

    // ★ D141 B1: dedupeHeaders 헬퍼 — 클라이언트 mapping의 unique header 키와 정확히 일치해야 매핑 적용
    //   누락 시: 동일 헤더 컬럼이 있는 엑셀 업로드 → 백그라운드 처리에서 raw header 사용 → mapping[rawHeader] 미스 → 매핑 미적용 → 데이터 손실 사고
    const headers = dedupeHeaders(data[0] as any[]);
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

    // ★ 2026-04-21: customer-upsert.ts 컨트롤타워 사용 (sync.ts와 공용 — region 중복 구조적 차단)
    const uploadUpsertBuilder = createCustomerUpsertBuilder({
      source: 'upload',
      includeUploadedBy: true,
    });

    // ★ 2026-08-14 (Codex 2R): 매장 소속 매핑 실패 배치 수 — 0이 아니면 완료 메시지에 표면화
    let storeMappingErrorBatches = 0;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const batchRows: Record<string, any>[] = []; // 컨트롤타워 buildBatch 입력
      const batchPhones: string[] = [];
      const seenInBatch = new Set<string>();
      // ★ 2026-08-14 (Codex 1R): 다매장 소속 쌍 — phone dedupe로 버려지는 후속 행의 매장 코드도
      //   customer_stores에는 적재해야 한다(다매장 진실 = customer_stores). dedupe 전에 전 행에서 수집.
      const storePairs: Array<{ phone: string; store: string }> = [];
      // ★ 2026-08-14 (Codex 2R): 업서트 실패 phone — 매장 소속 적재 제외 대상
      const failedPhones = new Set<string>();

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

        // ★ 브랜드 소속: 파일에 store_code 컬럼이 없으면 업로드 사용자의 store_codes[0] 자동 할당.
        //   (매장 소속의 진실은 customer_stores N:N — customers 행은 폰당 1행이다.
        //    옛 주석의 "UNIQUE(company_id, store_code, phone)로 별개 레코드 분리"는 사실이 아니었다 —
        //    customers_company_id_phone_key가 항상 먼저 막았다. 2026-08-14 arbiter 정정에서 확인.)
        if (!hasFileStoreCode && !record.store_code && userStoreCodes.length > 0) {
          record.store_code = userStoreCodes[0];
        }

        // ★ 2026-08-14 (Codex 1R): dedupe로 행이 버려져도 매장 소속은 잃지 않는다 — 쌍 먼저 수집.
        if (record.store_code) {
          storePairs.push({ phone: record.phone, store: String(record.store_code) });
        }

        // 배치 내 중복: phone 기준 dedupe
        // ★ 2026-08-14: store_code 포함 키 → phone 단독. upsert 충돌 축이 (company_id, phone)이므로
        //   같은 폰이 두 매장으로 한 배치에 오면 같은 행을 2회 갱신하게 되어 배치 전체가 죽는다.
        //   구 arbiter에서도 이 조합은 phone 키 위반으로 배치가 통째 실패했다. 첫 행만 남긴다.
        const dedupeKey = record.phone;
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
          // normalizeDate()가 Date 객체를 직접 처리하도록 먼저 호출
          if (record.birth_date instanceof Date) {
            const normalized = normalizeDate(record.birth_date);
            record.birth_date = normalized || record.birth_date;
          }
          const bd = String(record.birth_date).trim();
          if (/^\d{4}$/.test(bd) && parseInt(bd) >= 1900 && parseInt(bd) <= 2099) {
            // 4자리 연도만 입력 (예: 1983)
            derivedBirthYear = parseInt(bd);
            derivedAge = currentYear - derivedBirthYear;
            record.birth_date = null; // date 타입에 연도만 넣으면 에러
          } else {
            // ★ 2026-08-14: 정규화 실패 = 값 없음. 조건부 대입이라 실패 시 원본이 그대로 남아
            //   PG로 흘러가던 자리(sync.ts 동일 패턴 — 아난티 date/time field value out of range).
            const normalized = normalizeDate(bd);
            record.birth_date = normalized;
            if (!normalized) {
              // ★ 2026-08-14: 음력 생일 구제(sync.ts 동일) — 비윤년 2/29 등은 연도·월-일만 살린다.
              const salvaged = salvageBirthParts(bd);
              if (salvaged) {
                derivedBirthYear = salvaged.year;
                derivedBirthMonthDay = salvaged.monthDay;
                derivedAge = currentYear - salvaged.year;
              }
            }
            if (normalized) {
              derivedBirthYear = parseInt(normalized.substring(0, 4));
              derivedBirthMonthDay = normalized.substring(5, 10);
              // ★ D102: 생일 지남 여부 반영 (단순 연도 뺄셈 → 올해 생일 안 지났으면 -1)
              const now = new Date();
              const todayMD = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
              derivedAge = currentYear - derivedBirthYear - (derivedBirthMonthDay > todayMD ? 1 : 0);
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

        // ── INSERT 값 빌드 (FIELD_MAP 기반 동적, customer-upsert 컨트롤타워에 위임) ──
        const columnFieldDefs = getColumnFields();
        const batchRow: Record<string, any> = {};

        for (const field of columnFieldDefs) {
          if (field.fieldKey === 'sms_opt_in') {
            // ★ 2026-08-14 (Codex 1R): 미제공 = null — true로 채우면 UPDATE가 기존 수신거부를 되돌린다.
            //   신규 행 기본 true는 업서트 직후 buildSmsOptInBackfill이 채운다.
            const val = record[field.fieldKey];
            batchRow[field.columnName] = val !== null && val !== undefined ? val : null;
          } else if (field.fieldKey === 'region') {
            // region: 파생값(normalizeRegion 적용) 우선 사용
            batchRow[field.columnName] = derivedRegion ?? record[field.fieldKey] ?? null;
          } else {
            batchRow[field.columnName] = record[field.fieldKey] ?? null;
          }
        }

        // 파생 컬럼 (region은 FIELD_MAP columnName 순회에서 이미 담김)
        batchRow.birth_year = derivedBirthYear;
        batchRow.birth_month_day = derivedBirthMonthDay;

        // custom_fields JSONB 빌드 — normalizeCustomFieldValue 컨트롤타워 사용
        const customObj: Record<string, any> = {};
        for (const cf of getCustomFields()) {
          if (record[cf.fieldKey] != null && record[cf.fieldKey] !== '') {
            customObj[cf.columnName] = normalizeCustomFieldValue(record[cf.fieldKey]);
          }
        }
        batchRow.custom_fields = Object.keys(customObj).length > 0 ? JSON.stringify(customObj) : null;

        batchRows.push(batchRow);
      }

      if (batchRows.length > 0) {
        try {
          // ── 컨트롤타워 buildBatch 호출 — insertCols/updateClauses/values 구성 전부 위임 ──
          const { sql, values: queryValues } = uploadUpsertBuilder.buildBatch(
            companyId,
            batchRows,
            userId || null,
          );
          const result = await query(sql, queryValues);

          result.rows.forEach((r: any) => {
            if (r.is_insert) insertCount++;
            else duplicateCount++;
          });
        } catch (err: any) {
          // ★ 2026-08-14 (Codex 1R): 배치 통사 → 단건 폴백 — sync.ts와 동일 구조.
          //   한 행의 충돌(customer_code 유니크 등)이 정상 499행까지 실패로 만들던 자리.
          // ★ 2026-08-14 (Codex 2R): 계통 오류는 폴백 금지(부하 증폭 — customer-upsert.ts 참조) +
          //   실패 phone을 추적해 매장 소속 적재에서 제외한다(실패 행에 소속만 붙는 것 차단).
          if (!isRowLevelDbError(err)) {
            errorCount += batchRows.length;
            batchRows.forEach((row) => failedPhones.add(row.phone));
            console.error(`[업로드 백그라운드] 배치 실패(계통 오류 — 폴백 생략): ${err?.message || err}`);
          } else {
            console.warn(`[업로드 백그라운드] 배치 UPSERT 실패 → 단건 재시도: ${err?.message || err}`);
            for (const row of batchRows) {
              try {
                const { sql: rowSql, values: rowValues } = uploadUpsertBuilder.buildBatch(
                  companyId, [row], userId || null,
                );
                const rowResult = await query(rowSql, rowValues);
                rowResult.rows.forEach((r: any) => {
                  if (r.is_insert) insertCount++;
                  else duplicateCount++;
                });
              } catch (rowErr: any) {
                errorCount++;
                failedPhones.add(row.phone);
                console.warn(`[업로드 백그라운드] 단건 실패 phone=${row.phone}: ${rowErr?.message || rowErr}`);
              }
            }
          }
        }

        // ★ 2026-08-14 (Codex 1R): 신규 행 수신동의 기본 true 백필 — sync.ts와 동일 구조
        if (batchPhones.length > 0) {
          try {
            const backfill = buildSmsOptInBackfill(companyId, batchPhones);
            await query(backfill.sql, backfill.values);
          } catch (bfErr: any) {
            console.error('[업로드 백그라운드] 수신동의 백필 오류:', bfErr?.message || bfErr);
          }
        }

        // ── customer_stores N:N 매핑 (★2026-08-14 폴백 경로도 타도록 try 밖으로) ──
        try {
          // ★ 2026-08-14 (Codex 2R): 업서트 성공 phone만 — 실패 행에 새 매장 소속만 붙는 것 차단.
          const okPairs = storePairs.filter(p => !failedPhones.has(p.phone));
          const okPhones = batchPhones.filter(p => !failedPhones.has(p));
          // ★ 2026-08-14 (Codex 1R): 파일이 매장 코드를 준 경우 = dedupe 전에 수집한 (phone, store) 쌍 전부.
          //   업서트 후 customers.store_code를 되읽는 옛 방식은 UPDATE에서 보존되는 기존 매장만 남겨
          //   새 매장 소속이 영영 안 생겼다.
          if (okPairs.length > 0) {
            await query(`
              INSERT INTO customer_stores (company_id, customer_id, store_code)
              SELECT $1, c.id, s.store_code
              FROM unnest($2::text[], $3::text[]) AS s(phone, store_code)
              JOIN customers c ON c.company_id = $1 AND c.phone = s.phone
              ON CONFLICT (customer_id, store_code) DO NOTHING
            `, [companyId, okPairs.map(p => p.phone), okPairs.map(p => p.store)]);
          }
          if (!hasFileStoreCode && userStoreCodes.length > 0 && okPhones.length > 0) {
            await query(`
              INSERT INTO customer_stores (company_id, customer_id, store_code)
              SELECT $1, c.id, unnest($2::text[])
              FROM customers c
              WHERE c.company_id = $1 AND c.phone = ANY($3::text[])
              ON CONFLICT (customer_id, store_code) DO NOTHING
            `, [companyId, userStoreCodes, okPhones]);
          }
          // B10-03: 파일에 store_code 없고 userStoreCodes도 없지만 DB에 기존 store_code가 있는 경우 보존
          if (!hasFileStoreCode && userStoreCodes.length === 0 && okPhones.length > 0) {
            await query(`
              INSERT INTO customer_stores (company_id, customer_id, store_code)
              SELECT c.company_id, c.id, c.store_code
              FROM customers c
              WHERE c.company_id = $1 AND c.phone = ANY($2::text[]) AND c.store_code IS NOT NULL AND c.store_code != ''
              ON CONFLICT (customer_id, store_code) DO NOTHING
            `, [companyId, okPhones]);
          }
        } catch (storeErr: any) {
          // ★ 2026-08-14 (Codex 2R): 조용한 완료 금지 — 소속 매핑 실패는 배치 단위로 표면화
          storeMappingErrorBatches++;
          console.error('[업로드 백그라운드] customer_stores 매핑 오류:', storeErr?.message || storeErr);
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
      message: `총 ${totalRows.toLocaleString()}건 중 신규 ${insertCount.toLocaleString()}건, 업데이트 ${duplicateCount.toLocaleString()}건${errorCount > 0 ? `, 오류 ${errorCount.toLocaleString()}건` : ''}${storeMappingErrorBatches > 0 ? ` · 매장 소속 매핑 실패 ${storeMappingErrorBatches}배치 — 같은 파일 재업로드로 복구 가능` : ''}`
    }), 'EX', CACHE_TTL.uploadProgress);

    // ★ 2026-06-25: 고객 수/필드 채워짐이 바뀌었으므로 데이터 프로필 캐시 무효화 → 게이트·AI 프롬프트 즉시 반영
    if (companyId) clearCompanyDataProfileCache(companyId);
    // ★ 2026-07-03: 업로드로 필드 구성이 바뀔 수 있음 — 활성 필드 캐시 동반 무효화
    if (companyId) clearEnabledFieldsCache(companyId);

    console.log(`[업로드 완료] fileId=${fileId}, 신규=${insertCount}, 업데이트=${duplicateCount}, 오류=${errorCount}`);

    // ===== 커스텀 필드 정의 저장 — CT-07 컨트롤타워 사용 =====
    if (companyId) {
      try {
        const customMappings: Array<{ fieldKey: string; label: string; fieldType?: string }> = [];
        for (const [header, fieldKey] of Object.entries(mapping)) {
          if (typeof fieldKey === 'string' && fieldKey.startsWith('custom_')) {
            const label = customLabels?.[fieldKey] || header;
            // ★ D101: 업로드 데이터 샘플링으로 field_type 자동 감지
            let fieldType: string | undefined;
            const sampleVals = rows.slice(0, Math.min(20, rows.length))
              .map((r: any) => r[header])
              .filter((v: any) => v != null && v !== '');
            if (sampleVals.length > 0) {
              // ★ D101: 날짜 감지를 숫자보다 먼저 — YYMMDD 6자리, YYYYMMDD 8자리 포함
              const allDate = sampleVals.every((v: any) => {
                const s = String(v).trim();
                return /^\d{4}-\d{2}-\d{2}/.test(s) || /^\d{8}$/.test(s) || /^\d{6}$/.test(s) || (v instanceof Date);
              });
              // 6자리 숫자가 날짜일 수 있으므로 YYMMDD 유효성 추가 검증
              const looksLikeDate6 = sampleVals.every((v: any) => {
                const s = String(v).trim();
                if (!/^\d{6}$/.test(s)) return true; // 6자리 아닌 값은 패스
                const mm = parseInt(s.substring(2, 4));
                const dd = parseInt(s.substring(4, 6));
                return mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31;
              });
              const allNumeric = sampleVals.every((v: any) => !isNaN(Number(v)) && String(v).trim() !== '');
              // 날짜 패턴을 먼저 체크 (6자리 날짜가 숫자로 잘못 분류되는 것 방지)
              // ★ DB CHECK 허용값(INT/VARCHAR/DATE/BOOLEAN) 표준값 직접 사용 — CT-07 toDbFieldType 경유 시에도 매핑되지만 호출부 통일성 위해 표준값 원본 유지
              if (allDate && looksLikeDate6) fieldType = 'DATE';
              else if (allNumeric) fieldType = 'INT';
            }
            customMappings.push({ fieldKey, label, fieldType });
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
          // ★ D88: admin 본인에게도 수신거부 등록 (admin도 발송 주체이므로 필수)
          const adminUnsubResult = await query(`
            INSERT INTO unsubscribes (company_id, user_id, phone, source)
            SELECT $1, $2, phone, 'db_upload'
            FROM customers
            WHERE company_id = $1 AND sms_opt_in = false AND is_active = true
              AND NOT EXISTS (
                SELECT 1 FROM unsubscribes u WHERE u.user_id = $2 AND u.phone = customers.phone
              )
            ON CONFLICT (user_id, phone) DO NOTHING
          `, [companyId, userId]);
          if (adminUnsubResult.rowCount && adminUnsubResult.rowCount > 0) {
            console.log(`[업로드] 수신거부 자동등록(admin 본인): ${adminUnsubResult.rowCount}건 (company: ${companyId})`);
          }

          // ★ D136 (2026-04-22): admin → company_user 자동 배정을 CT-03 registerBulkCompanyUserUnsubscribes로 통합.
          //   기존 `c.store_code = ANY(u.store_codes)` 단일 조건 → getStoreScope 4단계 판정.
          //   sync.ts + upload.ts + unsubscribe-helper.ts 3곳 분산 패턴을 단일 컨트롤타워로 통일.
          const unsubCount = await registerBulkCompanyUserUnsubscribes(companyId, 'db_upload');
          if (unsubCount > 0) {
            console.log(`[업로드] 수신거부 자동등록(admin→브랜드배정, CT-03): ${unsubCount}건 (company: ${companyId})`);
          }
        } else {
          // ★ D114 P3: 브랜드 사용자 → 본인 user_id + 본인 store_codes 범위 고객만 등록
          // 이전: 회사 전체 sms_opt_in=false → 다른 사용자가 업로드한 수신거부까지 공유
          // 수정: store_codes 매칭 고객만 (없으면 전체 — 단일 브랜드 회사)
          const hasStoreCodes = userStoreCodes && userStoreCodes.length > 0;
          const unsubResult = await query(`
            INSERT INTO unsubscribes (company_id, user_id, phone, source)
            SELECT $1, $2, phone, 'db_upload'
            FROM customers
            WHERE company_id = $1 AND sms_opt_in = false AND is_active = true
              ${hasStoreCodes ? 'AND store_code = ANY($3)' : ''}
              AND NOT EXISTS (
                SELECT 1 FROM unsubscribes u WHERE u.user_id = $2 AND u.phone = customers.phone
              )
            ON CONFLICT (user_id, phone) DO NOTHING
          `, hasStoreCodes ? [companyId, userId, userStoreCodes] : [companyId, userId]);
          if (unsubResult.rowCount && unsubResult.rowCount > 0) {
            console.log(`[업로드] 수신거부 자동등록: ${unsubResult.rowCount}건 (company: ${companyId}, storeCodes: ${hasStoreCodes ? userStoreCodes.join(',') : 'all'})`);
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

// ============================================================
// ★ D219+ Part 2 후속 (2026-05-27): Excel/CSV 컬럼 AI 자동 매핑 endpoint
//   AddressBookModal 파일 업로드 직후 자동 호출 + 향후 customer-upsert 임포트 흐름 재활용 가능.
//   게이팅 = ai_mapping (STARTER+) — 기존 plan-guard FeatureKey 정합.
//   본 endpoint = CT-96 mapColumnsWithAi 호출 + 신뢰도 score + 사용자 정정 필요 여부 응답.
// ============================================================

/**
 * POST /api/upload/ai-map-columns
 * body: { columnNames: string[], sampleRows: any[][] }
 * 응답: { mappings, confidenceScore, needsManualReview }
 */
router.post(
  '/ai-map-columns',
  authenticate,
  requirePlanFeature('ai_mapping'),
  async (req: Request, res: Response) => {
    try {
      const companyId = req.user?.companyId;
      if (!companyId) {
        return res.status(401).json({ success: false, error: '인증 필요' });
      }
      const { columnNames, sampleRows } = req.body as {
        columnNames: string[];
        sampleRows: any[][];
      };
      if (!Array.isArray(columnNames) || columnNames.length === 0) {
        return res.status(400).json({ success: false, error: 'columnNames 배열 필수' });
      }

      const result = await mapColumnsWithAi({
        companyId,
        columnNames,
        sampleRows: Array.isArray(sampleRows) ? sampleRows : [],
      });

      return res.json({ success: true, ...result });
    } catch (err: any) {
      if (err instanceof ColumnMappingError) {
        return res.status(400).json({ success: false, code: err.code, error: err.message });
      }
      console.error('[upload/ai-map-columns] 실패:', err);
      return res.status(500).json({ success: false, error: 'AI 컬럼 매핑 실패' });
    }
  },
);

export default router;
