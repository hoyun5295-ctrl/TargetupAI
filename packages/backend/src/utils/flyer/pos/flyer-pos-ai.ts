/**
 * ★ CT-F16 — 전단AI POS Agent AI 스키마 분석 컨트롤타워
 *
 * POS DB의 테이블/컬럼/샘플 데이터를 Claude API로 분석하여
 * 회원/판매/재고 테이블 자동 매핑 + 데이터 추출 SQL 자동 생성.
 *
 * 핵심 혁신:
 *   - 기존: POS별로 Adapter 코드 하드코딩 (테이블명/컬럼명 매핑)
 *   - AI: 어떤 POS든 스키마만 읽으면 Claude가 자동 매핑 → 코드 수정 없이 새 POS 대응
 *
 * 의존: @anthropic-ai/sdk (이미 설치됨)
 */

import Anthropic from '@anthropic-ai/sdk';
import { query } from '../../../config/database';

// ============================================================
// 인터페이스
// ============================================================

/** Agent가 보내는 raw 스키마 정보 */
export interface PosRawSchema {
  dbType: 'mssql' | 'mysql' | 'firebird' | 'unknown';
  tables: PosTableInfo[];
  samples?: Record<string, any[]>; // 테이블명 → 샘플 데이터 (최대 10건)
}

export interface PosTableInfo {
  name: string;
  columns: PosColumnInfo[];
  rowCount?: number;
}

export interface PosColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  maxLength?: number;
  isPrimaryKey?: boolean;
}

/** AI 분석 결과 — 서버 저장 + Agent에 반환 */
export interface SchemaMapping {
  version: string;           // 매핑 버전 (재분석 시 비교)
  dbType: string;
  analyzedAt: string;

  // 테이블 매핑
  memberTable: string | null;
  salesTable: string | null;
  inventoryTable: string | null;

  // 컬럼 매핑
  memberColumns: ColumnMapping;
  salesColumns: ColumnMapping;
  inventoryColumns: ColumnMapping | null;

  // 데이터 형식
  phoneFormat: 'raw' | 'masked' | 'encrypted' | 'unknown';
  dateFormat: string;        // e.g., "YYYYMMDD", "YYYY-MM-DD HH:mm:ss"
  genderCodes?: Record<string, string>;  // e.g., { "1": "M", "2": "F" }

  // 추출 SQL 쿼리 (Agent가 직접 실행)
  extractQueries: ExtractQueries;

  // AI 확신도 (0~100)
  confidence: number;

  // AI 분석 노트
  notes: string[];
}

export interface ColumnMapping {
  [standardField: string]: string; // "phone" → "CUST_HP"
}

export interface ExtractQueries {
  newMembers: string;       // 증분 회원 추출 (WHERE 조건에 last_sync placeholder)
  newSales: string;         // 증분 판매 추출
  inventorySnapshot: string; // 전량 재고 스냅샷
  memberCount: string;      // 전체 회원 수
  salesCount: string;       // 기간별 판매 건수
}

// ============================================================
// Claude API 호출
// ============================================================

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

const SCHEMA_ANALYSIS_PROMPT = `당신은 한국 소매/마트/정육점 POS(Point of Sale) 시스템 데이터베이스 전문가입니다.
매장 POS의 DB 스키마와 샘플 데이터를 분석하여 표준 필드로 매핑하세요.

## 표준 필드 정의

### 회원(member) 표준 필드:
- pos_member_id: 회원 고유 ID (PK)
- name: 이름
- phone: 전화번호 (010-xxxx-xxxx 형태)
- gender: 성별 (M/F)
- birth_date: 생년월일
- grade: 등급
- points: 적립 포인트
- total_purchase: 누적 구매금액
- last_purchase_at: 최근 구매일
- sms_opt_in: SMS 수신동의
- address: 주소
- email: 이메일
- registered_at: 등록일

### 판매(sales) 표준 필드:
- receipt_no: 영수증번호
- sold_at: 판매일시
- product_code: 상품코드
- product_name: 상품명
- category: 카테고리/분류
- quantity: 수량
- unit_price: 단가
- sale_price: 판매가
- total_amount: 합계금액
- cost_price: 원가
- pos_member_id: 구매 회원 ID (FK)

### 재고(inventory) 표준 필드:
- product_code: 상품코드
- product_name: 상품명
- category: 카테고리
- current_stock: 현재 재고수량
- unit: 단위 (개, kg, 박스 등)
- cost_price: 원가
- sale_price: 판매가
- expiry_date: 유통기한

## 분석 규칙

1. 한국 POS 특성: 컬럼명이 한글, 약어(HP=핸드폰, NM=이름, CD=코드 등), 또는 영문 혼합일 수 있음
2. 전화번호 형식 판별:
   - raw: 010XXXXXXXX 또는 010-XXXX-XXXX (원본)
   - masked: 010-****-XXXX 또는 중간 자릿수가 * (마스킹)
   - encrypted: 알 수 없는 긴 문자열 (암호화)
   - unknown: 전화번호 컬럼을 찾을 수 없음
3. 날짜 형식: 샘플 데이터에서 감지 (YYYYMMDD, YYYY-MM-DD, 등)
4. 성별 코드: 1/2, M/F, 남/여 등 — 변환 규칙 제공
5. SQL 쿼리는 제공된 dbType에 맞는 문법 사용 (mssql: TOP, dateadd / mysql: LIMIT, date_add)
6. 증분 추출 쿼리에서 last_sync 자리에 :LAST_SYNC_AT placeholder 사용

## 응답 형식

반드시 아래 JSON 형식으로만 응답하세요. 설명 텍스트 없이 JSON만:

{
  "memberTable": "테이블명 또는 null",
  "salesTable": "테이블명 또는 null",
  "inventoryTable": "테이블명 또는 null",
  "memberColumns": { "표준필드": "실제컬럼명", ... },
  "salesColumns": { "표준필드": "실제컬럼명", ... },
  "inventoryColumns": { "표준필드": "실제컬럼명", ... } 또는 null,
  "phoneFormat": "raw|masked|encrypted|unknown",
  "dateFormat": "감지된 형식",
  "genderCodes": { "DB값": "M또는F", ... } 또는 null,
  "extractQueries": {
    "newMembers": "SQL",
    "newSales": "SQL",
    "inventorySnapshot": "SQL",
    "memberCount": "SQL",
    "salesCount": "SQL"
  },
  "confidence": 0-100,
  "notes": ["분석 노트1", "분석 노트2"]
}`;

/**
 * ★ AI 스키마 분석 — POS DB 스키마를 Claude로 자동 매핑
 */
export async function analyzeSchema(rawSchema: PosRawSchema): Promise<SchemaMapping> {
  // 스키마 정보를 프롬프트에 포함
  const schemaDescription = formatSchemaForPrompt(rawSchema);

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: `${SCHEMA_ANALYSIS_PROMPT}\n\n## 분석 대상 DB\n\nDB 엔진: ${rawSchema.dbType}\n\n${schemaDescription}`,
    }],
  });

  // Claude 응답에서 JSON 추출
  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('AI 분석 결과에서 JSON을 추출할 수 없습니다.');
  }

  const parsed = JSON.parse(jsonMatch[0]);

  const mapping: SchemaMapping = {
    version: '1.0',
    dbType: rawSchema.dbType,
    analyzedAt: new Date().toISOString(),
    memberTable: parsed.memberTable,
    salesTable: parsed.salesTable,
    inventoryTable: parsed.inventoryTable,
    memberColumns: parsed.memberColumns || {},
    salesColumns: parsed.salesColumns || {},
    inventoryColumns: parsed.inventoryColumns || null,
    phoneFormat: parsed.phoneFormat || 'unknown',
    dateFormat: parsed.dateFormat || 'unknown',
    genderCodes: parsed.genderCodes || undefined,
    extractQueries: parsed.extractQueries || {
      newMembers: '', newSales: '', inventorySnapshot: '', memberCount: '', salesCount: '',
    },
    confidence: parsed.confidence || 0,
    notes: parsed.notes || [],
  };

  return mapping;
}

/**
 * 스키마 정보를 프롬프트 문자열로 포맷
 */
function formatSchemaForPrompt(schema: PosRawSchema): string {
  const parts: string[] = [];

  parts.push('### 테이블 목록');
  for (const table of schema.tables) {
    parts.push(`\n**${table.name}** (${table.rowCount ?? '?'}건)`);
    parts.push('| 컬럼명 | 타입 | Nullable | PK |');
    parts.push('|--------|------|----------|-----|');
    for (const col of table.columns) {
      parts.push(`| ${col.name} | ${col.dataType}${col.maxLength ? `(${col.maxLength})` : ''} | ${col.nullable ? 'Y' : 'N'} | ${col.isPrimaryKey ? 'Y' : ''} |`);
    }
  }

  if (schema.samples) {
    parts.push('\n### 샘플 데이터 (상위 10건)');
    for (const [tableName, rows] of Object.entries(schema.samples)) {
      if (rows.length === 0) continue;
      parts.push(`\n**${tableName}:**`);
      // 헤더
      const cols = Object.keys(rows[0]);
      parts.push('| ' + cols.join(' | ') + ' |');
      parts.push('| ' + cols.map(() => '---').join(' | ') + ' |');
      // 데이터 (최대 5건)
      for (const row of rows.slice(0, 5)) {
        const vals = cols.map(c => {
          const v = row[c];
          if (v === null || v === undefined) return 'NULL';
          const s = String(v);
          return s.length > 30 ? s.slice(0, 27) + '...' : s;
        });
        parts.push('| ' + vals.join(' | ') + ' |');
      }
    }
  }

  return parts.join('\n');
}

/**
 * 스키마 매핑을 DB에 저장
 */
export async function saveSchemaMapping(agentId: string, mapping: SchemaMapping): Promise<void> {
  await query(
    `UPDATE flyer_pos_agents
     SET schema_mapping = $2::jsonb,
         pos_type = $3,
         updated_at = NOW()
     WHERE id = $1`,
    [agentId, JSON.stringify(mapping), mapping.dbType]
  );
}

/**
 * Agent의 저장된 스키마 매핑 조회
 */
export async function getSchemaMapping(agentId: string): Promise<SchemaMapping | null> {
  const result = await query(
    `SELECT schema_mapping FROM flyer_pos_agents WHERE id = $1`,
    [agentId]
  );
  if (result.rows.length === 0) return null;
  return result.rows[0].schema_mapping || null;
}

/**
 * 전화번호 마스킹 감지 (샘플 데이터 기반)
 */
export function detectPhoneFormat(samples: string[]): 'raw' | 'masked' | 'encrypted' | 'unknown' {
  if (samples.length === 0) return 'unknown';

  let rawCount = 0;
  let maskedCount = 0;

  for (const s of samples) {
    if (!s) continue;
    const clean = s.replace(/[-\s]/g, '');
    if (/^01[016789]\d{7,8}$/.test(clean)) {
      rawCount++;
    } else if (/\*/.test(s)) {
      maskedCount++;
    }
  }

  if (rawCount > samples.length * 0.5) return 'raw';
  if (maskedCount > samples.length * 0.3) return 'masked';
  if (rawCount === 0 && maskedCount === 0) return 'encrypted';
  return 'unknown';
}
