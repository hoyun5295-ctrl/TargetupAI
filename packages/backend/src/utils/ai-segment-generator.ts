/**
 * ★ CT-97: AI Segment Generator — D219+ Part 2 (2026-05-27 신설)
 *
 * 🎯 목적
 *   Harold 명시 본질 (2026-05-27): "고객사에서 프롬프트로 입력한 조건에 단 1의 오차도 없는 타겟이 추출되어야 한다.
 *   진짜 중요한 부분이야 이건 책임소재의 부분들이 있을 수도 있는거고."
 *
 *   본 CT = 자연어 자유 입력 → AI Opus 4.7 호출 → CT-01 호환 structured filter 변환 → preview.
 *   기존 CT-01 (customer-filter.ts) 안전 SQL 빌더 재활용 = 6,000사+ 운영 검증 안전망 정합.
 *
 *   ★ 책임소재 차단 영구 룰:
 *     - AI는 SQL 직접 생성 절대 X = CT-01 structured filter 매트릭스만 출력
 *     - 출력 직후 buildCustomerFilter 호환 검증 (dry-run) 의무 — 실패 시 throw
 *     - 0건 결과 = 자동 완화 X (D171 영구 룰)
 *     - 모든 필드 = 표준 컬럼 또는 custom_fields.{key} 매트릭스만 허용
 *
 * 📋 흐름
 *   1. companyId + naturalLanguage → AI system prompt (지원 필드 매트릭스 + structured filter schema)
 *   2. callAIWithFallback ({ model: 'opus' })
 *   3. extractJSON → JSON.parse → 검증
 *   4. CT-01 buildCustomerFilter dry-run 검증 (SQL build 실패 시 throw)
 *   5. previewSegment = COUNT + LIMIT 5
 *   6. 0건 = throw "조건을 정정해주세요" (자동 완화 X)
 *   7. 결과 반환 = { filter, explanation, matchCount, samples }
 */

import { callAIWithFallback } from '../services/ai';
import { buildCustomerFilter } from './customer-filter';
import { query } from '../config/database';

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

export interface GenerateSegmentInput {
  companyId: string;
  naturalLanguage: string;
  /** 회사별 custom_fields 키 목록 (admin enabled_fields 활용). */
  customFieldKeys?: string[];
}

export interface GenerateSegmentResult {
  /** CT-01 structured filter — { field: { operator, value } } 매트릭스 */
  filter: Record<string, { operator: string; value: any }>;
  explanation: string;
  matchCount: number;
  samples: Array<{
    id: string;
    phone: string;
    name: string | null;
    gender: string | null;
    region: string | null;
    last_purchase_date: string | null;
    total_purchase_amount: number | null;
  }>;
}

export class SegmentGenerationError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'SegmentGenerationError';
  }
}

// ════════════════════════════════════════════════════════════════════
// AI 시스템 프롬프트 — 지원 필드 매트릭스 + structured filter schema 명시
// ════════════════════════════════════════════════════════════════════

const STANDARD_FIELDS = [
  { key: 'gender', label: '성별', type: 'string', allowed: 'eq / in', valueExample: '"M" 또는 "F" 또는 ["M","F"]' },
  { key: 'age', label: '나이', type: 'number', allowed: 'eq / gte / lte / between', valueExample: '30 또는 [20,29]' },
  { key: 'grade', label: '회원 등급', type: 'string', allowed: 'eq / in', valueExample: '"VIP" 또는 ["VIP","골드"]' },
  { key: 'region', label: '지역', type: 'string', allowed: 'eq / in', valueExample: '"서울" 또는 ["서울","경기"]' },
  { key: 'birth_date', label: '생일', type: 'date', allowed: 'days_within / birth_month / gte / lte / between', valueExample: 'birth_month: 5 (5월생) / days_within: 30 (30일 안)' },
  { key: 'recent_purchase_date', label: '최근 구매일', type: 'date', allowed: 'gte / lte / between / days_within', valueExample: 'gte: "2026-04-27" / days_within: 30' },
  { key: 'recent_purchase_amount', label: '최근 구매 금액', type: 'number', allowed: 'gte / lte / between', valueExample: '50000' },
  { key: 'total_purchase_amount', label: '누적 구매 금액', type: 'number', allowed: 'gte / lte / between', valueExample: '500000' },
  { key: 'purchase_count', label: '구매 횟수', type: 'number', allowed: 'gte / lte / between / eq', valueExample: '3' },
  { key: 'avg_order_value', label: '평균 구매 금액 (AOV)', type: 'number', allowed: 'gte / lte / between', valueExample: '30000' },
  { key: 'ltv_score', label: 'LTV 점수', type: 'number', allowed: 'gte / lte / between', valueExample: '80' },
  { key: 'points', label: '포인트', type: 'number', allowed: 'gte / lte / between', valueExample: '10000' },
  { key: 'store_name', label: '매장명', type: 'string', allowed: 'eq / contains / in', valueExample: '"강남점"' },
  { key: 'is_married', label: '결혼 여부', type: 'boolean', allowed: 'eq', valueExample: 'true / false' },
  { key: 'wedding_anniversary', label: '결혼기념일', type: 'date', allowed: 'days_within / birth_month / gte / lte', valueExample: 'days_within: 30' },
];

function buildSystemPrompt(customFieldKeys: string[]): string {
  const customFieldsBlock = customFieldKeys.length > 0
    ? `\n[회사별 사용자 정의 필드 (custom_fields)]\n${customFieldKeys.map((k) => `- custom_fields.${k}`).join('\n')}\n위 키는 \`custom_fields.{키}\` 형식으로 사용 (예: "custom_fields.region": { "operator": "eq", "value": "강남" })\n`
    : '';

  const fieldsBlock = STANDARD_FIELDS.map((f) =>
    `- ${f.key} (${f.label}) — type: ${f.type} / operators: ${f.allowed} / 예시값: ${f.valueExample}`,
  ).join('\n');

  return `당신은 한줄로 마케팅 SaaS의 고객 세그먼트 AI 변환기입니다.
사용자가 자연어로 입력한 조건을 정확한 structured filter JSON으로 변환합니다.

[지원 표준 필드]
${fieldsBlock}
${customFieldsBlock}

[지원 operator]
- eq (같음) / gte (이상) / lte (이하) / between ([최소, 최대]) / in (배열 안)
- contains (문자열 포함) / days_within (N일 안 — 날짜 전용) / birth_month (월만 매칭 — 날짜 전용)

[출력 형식 — structured filter JSON 매트릭스]
{
  "필드명": { "operator": "연산자", "value": 값 },
  "다른필드": { "operator": "연산자", "value": 값 }
}

[규칙 — 책임소재 영역 영구 룰]
1. 사용자가 명시한 조건만 변환 — 임의로 조건 추가 절대 X
2. 명시되지 않은 조건 = 출력 X (필드 자체 포함하지 X)
3. 모호한 경우 explanation에 "추가 정정 필요" 명시
4. 위 [지원 표준 필드] 또는 [회사별 사용자 정의 필드] 목록에 없는 필드 = 사용 X
5. 위 [지원 operator] 목록에 없는 연산자 = 사용 X
6. 자동 완화 절대 X — 0건 매칭 위험이 있어도 사용자 조건 그대로 변환 의무

[응답 형식 — JSON 단일]
\`\`\`json
{
  "filter": { "필드명": { "operator": "...", "value": ... }, ... },
  "explanation": "변환 결과 요약 (사용자가 입력한 조건을 어떻게 해석했는지 한국어로 1~2 문장)",
  "warnings": ["사용자에게 추가 정정이 필요한 항목 (없으면 빈 배열)"]
}
\`\`\`

[변환 예시]
사용자 입력: "30일 안 구매하지 않은 30대 여성"
응답:
\`\`\`json
{
  "filter": {
    "gender": { "operator": "eq", "value": "F" },
    "age": { "operator": "between", "value": [30, 39] },
    "recent_purchase_date": { "operator": "lte", "value": "${new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)}" }
  },
  "explanation": "여성 + 30~39세 + 최근 구매일이 30일 이전인 고객을 추출합니다.",
  "warnings": []
}
\`\`\``;
}

// ════════════════════════════════════════════════════════════════════
// JSON 추출 헬퍼 (inapp-ai-generator.ts 패턴 정합)
// ════════════════════════════════════════════════════════════════════

function extractJSON(text: string): string {
  if (text.includes('```json')) {
    const start = text.indexOf('```json') + 7;
    const end = text.indexOf('```', start);
    return text.slice(start, end).trim();
  }
  if (text.includes('```')) {
    const start = text.indexOf('```') + 3;
    const end = text.indexOf('```', start);
    return text.slice(start, end).trim();
  }
  return text.trim();
}

// ════════════════════════════════════════════════════════════════════
// 메인 함수
// ════════════════════════════════════════════════════════════════════

/**
 * 자연어 → CT-01 structured filter 변환 + preview.
 *
 * @throws SegmentGenerationError code='AI_RESPONSE_INVALID' AI 응답 JSON 파싱 실패
 * @throws SegmentGenerationError code='FILTER_VALIDATION_FAILED' CT-01 호환 검증 실패
 * @throws SegmentGenerationError code='ZERO_MATCH' 0건 매칭 (자동 완화 X — D171 영구 룰)
 */
export async function generateSegmentFromNaturalLanguage(
  input: GenerateSegmentInput,
): Promise<GenerateSegmentResult> {
  const { companyId, naturalLanguage } = input;
  const customFieldKeys = input.customFieldKeys || [];

  if (!naturalLanguage?.trim()) {
    throw new SegmentGenerationError('EMPTY_INPUT', '자연어 입력이 비어있습니다.');
  }

  // 1. AI 호출 (Opus 4.7)
  const system = buildSystemPrompt(customFieldKeys);
  const userMessage = `사용자 입력: ${naturalLanguage.trim()}\n\n위 입력을 structured filter JSON으로 변환해주세요.`;

  const aiResult = await callAIWithFallback({
    system,
    userMessage,
    model: 'opus',
    maxTokens: 2048,
    temperature: 0.2, // 정확성 우선 — 낮은 temperature
    companyId,
    source: 'ai-segment-generator',
  });

  // 2. JSON 추출 + 파싱
  let parsed: any;
  try {
    const jsonText = extractJSON(aiResult || '');
    parsed = JSON.parse(jsonText);
  } catch (e: any) {
    throw new SegmentGenerationError(
      'AI_RESPONSE_INVALID',
      `AI 응답 파싱 실패: ${e.message}. 다시 시도해주세요.`,
    );
  }

  const filter = parsed?.filter;
  const explanation = String(parsed?.explanation || '').slice(0, 500);

  if (!filter || typeof filter !== 'object' || Object.keys(filter).length === 0) {
    throw new SegmentGenerationError(
      'EMPTY_FILTER',
      'AI가 조건을 추출하지 못했습니다. 더 구체적으로 입력해주세요. (예: "30일 안 구매한 30대 여성")',
    );
  }

  // 3. CT-01 buildCustomerFilter 호환 검증 (dry-run — SQL 실행 X)
  try {
    const buildResult = buildCustomerFilter(filter, {
      tableAlias: 'c',
      startParamIndex: 2,
      storeCodeMode: 'skip',
      inputFormat: 'structured',
    });
    if (!buildResult.sql || buildResult.params.length === 0) {
      throw new Error('필터 조건이 SQL로 변환되지 않았습니다.');
    }
  } catch (e: any) {
    throw new SegmentGenerationError(
      'FILTER_VALIDATION_FAILED',
      `필터 검증 실패: ${e.message}. 조건을 정정해주세요.`,
    );
  }

  // 4. 매칭 수 + 샘플 5건 (CT-01 buildCustomerFilter + COUNT + LIMIT)
  const { matchCount, samples } = await previewMatching(companyId, filter);

  // 5. 0건 결과 = 자동 완화 X (D171 영구 룰)
  if (matchCount === 0) {
    throw new SegmentGenerationError(
      'ZERO_MATCH',
      '매칭되는 고객이 0명입니다. 조건을 더 넓혀주세요. (자동 완화는 마케팅 의도 파괴 위험으로 차단됩니다)',
    );
  }

  return { filter, explanation, matchCount, samples };
}

/**
 * 미리보기 — 매칭 수 + 샘플 N건 (저장 직후 또는 Wizard step 4 즉시 표시).
 *
 * 발송 가능 강제 = is_active=true + sms_opt_in=true + !is_opt_out + !is_invalid.
 */
export async function previewMatching(
  companyId: string,
  filter: Record<string, { operator: string; value: any }>,
  sampleSize = 5,
): Promise<{ matchCount: number; samples: GenerateSegmentResult['samples'] }> {
  // CT-01 호환 SQL 빌드 ($1 = companyId, $2~ = filter values)
  const { sql: filterSql, params } = buildCustomerFilter(filter, {
    tableAlias: 'c',
    startParamIndex: 2,
    storeCodeMode: 'skip',
    inputFormat: 'structured',
  });

  // 발송 가능 강제 + 회사 격리 + filter 조합
  const baseWhere = `
    c.company_id = $1
    AND c.is_active = true
    AND c.sms_opt_in = true
    AND (c.is_opt_out = false OR c.is_opt_out IS NULL)
    AND (c.is_invalid = false OR c.is_invalid IS NULL)
    ${filterSql}
  `;

  const countSql = `SELECT COUNT(*)::int AS cnt FROM customers c WHERE ${baseWhere}`;
  const safeSampleSize = Math.max(1, Math.min(sampleSize, 50));
  const sampleSql = `
    SELECT c.id, c.phone, c.name, c.gender, c.region,
           c.last_purchase_date, c.total_purchase_amount
      FROM customers c
     WHERE ${baseWhere}
     ORDER BY c.id ASC
     LIMIT ${safeSampleSize}
  `;

  const fullParams = [companyId, ...params];
  const [countRes, sampleRes] = await Promise.all([
    query(countSql, fullParams),
    query(sampleSql, fullParams),
  ]);

  return {
    matchCount: Number(countRes.rows[0]?.cnt ?? 0),
    samples: sampleRes.rows.map((r: any) => ({
      id: r.id,
      phone: r.phone,
      name: r.name,
      gender: r.gender,
      region: r.region,
      last_purchase_date: r.last_purchase_date,
      total_purchase_amount: r.total_purchase_amount != null ? Number(r.total_purchase_amount) : null,
    })),
  };
}

/**
 * Wizard step 4 confirm — saved_segments INSERT (filter_jsonb 컬럼 활용).
 *
 * D219+ Part 2: saved_segments ALTER ADD filter_jsonb JSONB 의무 (Harold 직접 PG).
 */
export async function saveSegmentFromWizard(input: {
  companyId: string;
  userId: string;
  name: string;
  filter: Record<string, { operator: string; value: any }>;
  naturalLanguage: string;
}): Promise<{ id: string }> {
  const { companyId, userId, name, filter, naturalLanguage } = input;

  const result = await query(
    `INSERT INTO saved_segments (
      id, company_id, user_id, name, emoji, segment_type,
      prompt, auto_relax, filter_jsonb, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), $1, $2, $3, '🎯', 'custom',
      $4, false, $5::jsonb, NOW(), NOW()
    ) RETURNING id`,
    [companyId, userId, name.slice(0, 100), naturalLanguage.slice(0, 1000), JSON.stringify(filter)],
  );

  return { id: result.rows[0].id };
}
