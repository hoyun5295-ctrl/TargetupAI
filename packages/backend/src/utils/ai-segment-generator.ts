/**
 * ★ CT-97: AI Segment Generator — D219+ Part 2 (2026-05-27 신설)
 *
 * 🎯 목적
 *   Harold 명시 본질 (2026-05-27): "고객사에서 프롬프트로 입력한 조건에 단 1의 오차도 없는 타겟이 추출되어야 한다.
 *   진짜 중요한 부분이야 이건 책임소재의 부분들이 있을 수도 있는거고."
 *
 *   본 CT = 자연어 자유 입력 → AI Opus 4.7 호출 → CT-01 호환 structured filter 변환 → preview.
 *   기존 CT-01 (customer-filter.ts) 안전 SQL 빌더 재활용 = 한줄로 운영 검증 안전망 정합.
 *
 *   ★ 책임소재 차단 영구 룰:
 *     - AI는 SQL 직접 생성 절대 X = CT-01 structured filter 매트릭스만 출력
 *     - 출력 직후 buildCustomerFilter 호환 검증 (dry-run) 의무 — 실패 시 throw
 *     - 0건 결과 = 자동 완화 X (D171 영구 룰)
 *     - 모든 필드 = 표준 컬럼(FIELD_MAP) 또는 회사 커스텀 칸 맨 키(custom_1~15)만 허용 · 적용 못 하는 조건은 거절(2026-10-12)
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

import { extractJsonFromAiText, aiStr } from './ai-json';
import { getCreditCost } from './ai-credit-calc';
import { runChargedAi } from './ai-credit';
import { callAIWithFallback } from '../services/ai';
import { buildCustomerFilter } from './customer-filter';
import { ownerConsentSql } from './mall-consent';
import { getOwnerCustomerScopeSql } from './store-scope';
import { getFieldByKey, StandardFieldMapping } from './standard-field-map';
import { buildEnabledFieldsPayload } from './enabled-fields';
import { isValidCustomFieldKey } from './safe-field-name';
import { query } from '../config/database';
// ★ 2026-09-27 한줄로 V2 R161 — 프롬프트 날짜 = KST(옛: 오늘 날짜가 없고 예시만 UTC toISOString)
import { kstDateString } from './planner-execution';
import { isPlainAllCustomersRequest } from './all-customers-signal';

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

export interface GenerateSegmentInput {
  companyId: string;
  naturalLanguage: string;
  /**
   * (쓰지 않음) ★ 2026-10-12부터 회사 커스텀 칸은 서버가 직접 읽는다(loadCustomFieldLines).
   * 이 값을 보내던 화면이 0곳이라 AI가 커스텀 칸을 한 번도 몰랐다. 라우트 호환을 위해 자리만 남긴다.
   */
  customFieldKeys?: string[];
  /** ★2026-10-02 요청자 — 매칭 수를 그 사람의 발송과 같은 수신동의 기준으로 센다(몰 동의 회사 · 없으면 관리자 기준). */
  ownerUserId?: string | null;
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
    /** ★ 2026-08-08 filter가 참조한 필드 값(키 = fieldKey) — sampleFields가 목록을 소유 */
    [extra: string]: unknown;
  }>;
  /**
   * ★ 2026-08-08 (임은지 접수) filter가 참조한 필드 — 샘플 추가 열·추출 후 수신자 meta의 축.
   * 라벨은 FIELD_MAP displayName 파생(별도 라벨 테이블 금지 — LESSONS_BACKEND). 회사별 커스텀 라벨은
   * 프론트가 자기 스키마(enabledFields)로 덮는다.
   */
  sampleFields: Array<{ field_key: string; display_name: string; data_type: string; category: string }>;
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

// ★ 2026-10-12 키는 FIELD_MAP 키만 — 옛 목록의 avg_order_value · ltv_score · is_married · wedding_anniversary 는
//   FIELD_MAP 에 없어 구조형 빌더가 조용히 버렸다("VIP + LTV 80 이상" → 등급만 남아 대상이 넓어짐 · 빌더 실행 실측).
//   여기 키를 더하면 FIELD_MAP 에도 있어야 한다(없으면 아래 조건별 검증이 그 조건을 거절한다).
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
  { key: 'points', label: '포인트', type: 'number', allowed: 'gte / lte / between', valueExample: '10000' },
  { key: 'store_name', label: '매장명', type: 'string', allowed: 'eq / contains / in', valueExample: '"강남점"' },
];

/**
 * 프롬프트에 싣는 커스텀 칸 실제 값 수 · 값 길이 상한(목록이 길면 고르는 데 도움이 안 되고 프롬프트만 길어진다).
 * 값은 자르지 않는다 — 잘린 값을 AI가 고르면 정확 일치(eq)가 0건이 된다. 길거나 줄바꿈이 있는 값은 빼고 싣는다.
 */
const CUSTOM_VALUE_LIMIT = 30;
const CUSTOM_VALUE_MAX_LEN = 40;

/**
 * ★ 2026-10-12 (임은지 접수 · 직접타겟 AI 자연어 모드가 커스텀 칸을 못 읽음) 회사 커스텀 칸을 프롬프트 줄로 만든다.
 * 원천 = 직접 타겟 화면과 같은 CT-18(buildEnabledFieldsPayload · 회사 전체 범위) · 이름 = 회사가 붙인 이름 · 형식 = CT-18 판별.
 * 옛: 호출부가 customFieldKeys 를 보내야만 실렸는데 보내는 화면이 0곳이었고, 실려도 이름 없는 `custom_fields.{키}` 형식이라
 * 구조형 빌더가 그 조건을 버렸다. 키는 빌더가 받는 맨 키(custom_1~15)만 싣는다(그 밖의 JSONB 키는 빌더가 거르지 못한다).
 */
async function loadCustomFieldLines(companyId: string): Promise<{ lines: string[]; labels: Record<string, string> }> {
  const { fields, options } = await buildEnabledFieldsPayload({
    companyId,
    scopeWhere: 'company_id = $1 AND is_active = true',
    scopeParams: [companyId],
  });
  const lines: string[] = [];
  const labels: Record<string, string> = {};
  for (const f of fields) {
    if (!f.is_custom || !isValidCustomFieldKey(f.field_key)) continue;
    const label = String(f.display_name || '').replace(/\s+/g, ' ').trim() || f.field_key;
    labels[f.field_key] = label;
    const head = `- ${f.field_key} (${label})`;
    if (f.data_type === 'number') lines.push(`${head}: type: number / operators: eq / gte / lte / between`);
    else if (f.data_type === 'date') lines.push(`${head}: type: date / operators: gte / lte / between / 값 형식: "YYYY-MM-DD"`);
    else {
      const raw = options[f.field_key] || [];
      const vals = raw
        .map((v) => String(v ?? ''))
        .filter((v) => v.trim() && v.length <= CUSTOM_VALUE_MAX_LEN && !/[\r\n]/.test(v))
        .slice(0, CUSTOM_VALUE_LIMIT);
      const partial = vals.length < raw.length ? ' (일부만 표시)' : '';
      lines.push(`${head}: type: string / operators: eq / in / contains${vals.length ? ` / 실제 값${partial}: ${vals.join(', ')}` : ''}`);
    }
  }
  return { lines, labels };
}

function buildSystemPrompt(customFieldLines: string[]): string {
  const customFieldsBlock = customFieldLines.length > 0
    ? `\n[회사별 사용자 정의 필드 (키는 앞의 custom_N 그대로 · 괄호 안은 회사가 붙인 이름)]\n${customFieldLines.join('\n')}\n`
    : '';

  const fieldsBlock = STANDARD_FIELDS.map((f) =>
    `- ${f.key} (${f.label}): type: ${f.type} / operators: ${f.allowed} / 예시값: ${f.valueExample}`,
  ).join('\n');

  return `당신은 한줄로 마케팅 SaaS의 고객 세그먼트 AI 변환기입니다.
사용자가 자연어로 입력한 조건을 정확한 structured filter JSON으로 변환합니다.

[기준 날짜] 오늘(한국 시간) = ${kstDateString()}. "30일 안"·"지난달"·"이번 주" 같은 상대 날짜는 이 날짜 기준으로 계산합니다.

[지원 표준 필드]
${fieldsBlock}
${customFieldsBlock}

[지원 operator]
- eq (같음) / gte (이상) / lte (이하) / between ([최소, 최대]) / in (배열 안)
- contains (문자열 포함) / days_within (N일 안, 날짜 전용) / birth_month (월만 매칭, 날짜 전용)

[출력 형식: structured filter JSON 매트릭스]
{
  "필드명": { "operator": "연산자", "value": 값 },
  "다른필드": { "operator": "연산자", "value": 값 }
}

[규칙: 책임소재 영역 영구 룰]
1. 사용자가 명시한 조건만 변환. 임의로 조건 추가 절대 X
2. 명시되지 않은 조건 = 출력 X (필드 자체 포함하지 X)
3. 모호한 경우 explanation에 "추가 정정 필요" 명시
4. 위 [지원 표준 필드] 또는 [회사별 사용자 정의 필드] 목록에 없는 필드 = 사용 X
5. 위 [지원 operator] 목록에 없는 연산자 = 사용 X
6. 자동 완화 절대 X. 0건 매칭 위험이 있어도 사용자 조건 그대로 변환 의무
7. 사용자가 조건 없이 전체 발송을 원하면(예: "전체 고객", "모든 고객에게", "전부 발송") = "all_customers": true + "filter": {} 출력
8. 사용자가 회사가 붙인 이름(위 괄호 안)으로 말하면 그 칸의 키(custom_N)를 필드명으로 쓴다. "실제 값"이 적힌 칸은 그 값 중에서 띄어쓰기·대소문자 그대로 고른다. "(일부만 표시)" 칸에서 맞는 값이 목록에 없으면 사용자가 쓴 값을 그대로 쓴다
9. 사용자 정의 날짜 칸에는 days_within·birth_month를 쓰지 않는다. 기준 날짜로 계산한 "YYYY-MM-DD" 값으로 gte / lte / between 을 쓴다

[응답 형식: JSON 단일]
\`\`\`json
{
  "filter": { "필드명": { "operator": "...", "value": ... }, ... },
  "all_customers": false,
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
    "recent_purchase_date": { "operator": "lte", "value": "${kstDateString(new Date(Date.now() - 30 * 86400000))}" }
  },
  "explanation": "여성 + 30~39세 + 최근 구매일이 30일 이전인 고객을 추출합니다.",
  "warnings": []
}
\`\`\``;
}

// ════════════════════════════════════════════════════════════════════
// JSON 추출 헬퍼 (inapp-ai-generator.ts 패턴 정합)
// ════════════════════════════════════════════════════════════════════


// ════════════════════════════════════════════════════════════════════
// 메인 함수
// ════════════════════════════════════════════════════════════════════

// ★ 2026-10-15 B-1015-1 — "조건 없는 전체 요청" 판정은 허브(AI 오퍼레이션)도 쓰므로 CT(all-customers-signal)로 옮겼다.
//   본문은 그대로이고 여기서는 기존 import 호환을 위해 다시 내보낸다.
export { isPlainAllCustomersRequest } from './all-customers-signal';

/**
 * 자연어 → CT-01 structured filter 변환 (AI 호출 + 파싱 + 호환 검증).
 * 매칭 수/0건 판정은 하지 않는다 — 호출측이 채널·문맥에 맞는 카운트를 따로 한다.
 * (generateSegmentFromNaturalLanguage = 이 함수 + 문자 발송 기준 previewMatching + 0건 차단.
 *  타겟 추출 엔드포인트 = 이 함수 + 채널 자격 카운트.)
 *
 * @throws SegmentGenerationError code='AI_RESPONSE_INVALID' AI 응답 JSON 파싱 실패
 * @throws SegmentGenerationError code='EMPTY_FILTER' AI가 조건을 추출하지 못함
 * @throws SegmentGenerationError code='FILTER_VALIDATION_FAILED' CT-01 호환 검증 실패
 */
export async function convertNaturalLanguageToFilter(...args: Parameters<typeof convertNaturalLanguageToFilterWithAi>): ReturnType<typeof convertNaturalLanguageToFilterWithAi> {
  // ★ 2026-10-25 원장 Z4 — 돈 = AI 결과 정산 한 곳(조건을 만들어 냈을 때만 · 실패는 던진다) · 쓸 결과가 아니면 0원 · 잔액 부족 402 · 원장 쓰기 실패 503 · 바깥 묶음이면 0
  const { result } = await runChargedAi({
    companyId: args[0].companyId, cost: getCreditCost('ai-segment-generator'), source: 'ai-segment-generator',
    run: () => convertNaturalLanguageToFilterWithAi(...args),
    accept: (r) => true,
  });
  return result;
}

async function convertNaturalLanguageToFilterWithAi(
  input: GenerateSegmentInput,
): Promise<{ filter: GenerateSegmentResult['filter']; explanation: string; isAll?: boolean }> {
  const { companyId, naturalLanguage } = input;

  if (!naturalLanguage?.trim()) {
    throw new SegmentGenerationError('EMPTY_INPUT', '자연어 입력이 비어있습니다.');
  }

  // 1. AI 호출
  const custom = await loadCustomFieldLines(companyId);
  const system = buildSystemPrompt(custom.lines);
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
    parsed = extractJsonFromAiText(aiResult || '');   // ★ 2026-09-30 WP4 — JSON 추출은 CT 하나(ai-json · 코드펜스 · 머리말 · 문자열 안 줄바꿈 제어문자 복구 · 0630 사고 부류). 인라인 추출 정의 금지.
  } catch (e: any) {
    throw new SegmentGenerationError(
      'AI_RESPONSE_INVALID',
      `AI 응답 파싱 실패: ${e.message}. 다시 시도해주세요.`,
    );
  }

  const filter = parsed?.filter;
  const explanation = aiStr(parsed?.explanation).slice(0, 500);

  // ★ 2026-07-02(3) 전체 고객 = 1급 타겟 — "전체고객에게 발송"이 EMPTY_FILTER로 죽던 구멍 수정. filter {} = 조건 없음 = 전체.
  // ★ 2026-09-26 한줄로 V2 R1-21 — 전체는 **조건이 비었고 입력이 조건 없는 전체 요청일 때만**(허용 목록).
  //   옛: 조건을 못 뽑으면 문장에 "전체·모든·모두·전부"만 있어도 전체로 넓혔고("서울 지역 모든 고객"도 전체),
  //   AI 플래그가 참이면 AI가 뽑은 조건까지 버렸다. 이제 조건이 있으면 조건이 이긴다(좁은 쪽) · 그 밖의 빈 조건 = EMPTY_FILTER.
  const emptyFilter = !filter || typeof filter !== 'object' || Object.keys(filter).length === 0;
  const wantsAll = emptyFilter && isPlainAllCustomersRequest(input.naturalLanguage);
  if (wantsAll) {
    return { filter: {}, explanation: explanation || '전체 고객을 대상으로 합니다.', isAll: true };
  }

  if (emptyFilter) {
    throw new SegmentGenerationError(
      'EMPTY_FILTER',
      'AI가 조건을 추출하지 못했습니다. 더 구체적으로 입력해주세요. (예: "30일 안 구매한 30대 여성" / 전체 발송은 "전체 고객")',
    );
  }

  // 3. CT-01 buildCustomerFilter 호환 검증 (dry-run — SQL 실행 X)
  //   ★ 2026-10-12 조건마다 따로 본다. 옛: 전체 SQL 이 비었는지만 봐서, 빌더가 적용하지 못하는 조건(FIELD_MAP 밖 키 ·
  //   `custom_fields.custom_1` 형식 · 빈 값)이 다른 조건과 섞이면 그 조건만 조용히 빠지고 더 넓은 대상이 추출됐다.
  //   이제 하나라도 SQL 이 안 되면 멈춘다(빼고 진행하지 않는다 · "단 1의 오차도 없는 타겟").
  const unapplied: string[] = [];
  try {
    for (const [key, condition] of Object.entries(filter)) {
      const one = buildCustomerFilter({ [key]: condition }, {
        tableAlias: 'c',
        startParamIndex: 2,
        storeCodeMode: 'skip',
        inputFormat: 'structured',
      });
      // 값이 null(달력에 없는 날짜) · NaN(숫자 아닌 값)인 조건도 적용 못 한 것이다 — 그대로 두면 0건으로만 보여 이유를 모른다
      const badValue = one.params.some((p) => p === null || (typeof p === 'number' && Number.isNaN(p)));
      if (!one.sql.trim() || one.params.length === 0 || badValue) unapplied.push(custom.labels[key] || getFieldByKey(key)?.displayName || key);
    }
  } catch (e: any) {
    throw new SegmentGenerationError(
      'FILTER_VALIDATION_FAILED',
      `필터 검증 실패: ${e.message}. 조건을 정정해주세요.`,
    );
  }
  if (unapplied.length > 0) {
    throw new SegmentGenerationError(
      'FILTER_VALIDATION_FAILED',
      `적용할 수 없는 조건이 있어 멈췄습니다(${unapplied.join(', ')}). 조건을 다르게 적어 다시 시도해주세요.`,
    );
  }

  return { filter, explanation };
}

/**
 * 자연어 → CT-01 structured filter 변환 + 문자 발송 기준 preview.
 *
 * @throws SegmentGenerationError code='AI_RESPONSE_INVALID' AI 응답 JSON 파싱 실패
 * @throws SegmentGenerationError code='FILTER_VALIDATION_FAILED' CT-01 호환 검증 실패
 * @throws SegmentGenerationError code='ZERO_MATCH' 0건 매칭 (자동 완화 X — D171 영구 룰)
 */
export async function generateSegmentFromNaturalLanguage(...args: Parameters<typeof generateSegmentFromNaturalLanguageWithAi>): ReturnType<typeof generateSegmentFromNaturalLanguageWithAi> {
  // ★ 2026-10-25 원장 Z4 — 돈 = AI 결과 정산 한 곳(1명 이상 맞을 때만 · 0명 · 실패는 던진다) · 쓸 결과가 아니면 0원 · 잔액 부족 402 · 원장 쓰기 실패 503 · 바깥 묶음이면 0
  const { result } = await runChargedAi({
    companyId: args[0].companyId, cost: getCreditCost('ai-segment-generator'), source: 'ai-segment-generator',
    run: () => generateSegmentFromNaturalLanguageWithAi(...args),
    accept: (r) => r.matchCount > 0,
  });
  return result;
}

async function generateSegmentFromNaturalLanguageWithAi(
  input: GenerateSegmentInput,
): Promise<GenerateSegmentResult> {
  const { filter, explanation } = await convertNaturalLanguageToFilter(input);

  // 매칭 수 + 샘플 5건 (CT-01 buildCustomerFilter + COUNT + LIMIT, 문자 발송 가능 기준)
  const { matchCount, samples, sampleFields } = await previewMatching(input.companyId, filter, undefined, input.ownerUserId);

  // 0건 결과 = 자동 완화 X (D171 영구 룰)
  if (matchCount === 0) {
    throw new SegmentGenerationError(
      'ZERO_MATCH',
      '매칭되는 고객이 0명입니다. 조건을 더 넓혀주세요. (자동 완화는 마케팅 의도 파괴 위험으로 차단됩니다)',
    );
  }

  return { filter, explanation, matchCount, samples, sampleFields };
}

/**
 * 미리보기 — 매칭 수 + 샘플 N건 (저장 직후 또는 Wizard step 4 즉시 표시).
 *
 * 발송 가능 강제 = is_active=true + sms_opt_in=true + !is_opt_out + !is_invalid.
 */
/** 샘플 고정 열 — filter 참조 필드 추가 열은 여기 없는 키만 더한다(별칭 충돌 차단). */
const BASE_SAMPLE_KEYS = new Set(['id', 'phone', 'name', 'gender', 'region', 'last_purchase_date', 'total_purchase_amount']);

/**
 * ★ 2026-08-08 (임은지 접수 08-05) filter가 참조한 필드를 샘플 열로 함께 싣는다.
 * 조건 필드가 안 보이면 미리보기로 "조건이 맞았는지"를 검증할 수 없고, 추출 뒤 발송 화면의
 * 열·%변수% 축(meta)도 이 목록에서 나온다. 축은 filter의 키 하나다 — { field: { operator, value } }
 * 구조라 그 키가 곧 조건 필드고, 매핑은 FIELD_MAP(단일 기준)으로만 푼다.
 * FIELD_MAP 밖 키는 조용히 제외(fail-safe — 컬럼명을 추측해 SQL을 만들지 않는다).
 * sms_opt_in은 발송 가능 강제로 항상 true라 싣지 않는다.
 */
function resolveFilterSampleFields(filter: Record<string, unknown> | null | undefined): StandardFieldMapping[] {
  return Object.keys(filter || {})
    .filter((k) => !BASE_SAMPLE_KEYS.has(k) && k !== 'sms_opt_in')
    .map((k) => getFieldByKey(k))
    .filter((f): f is StandardFieldMapping => !!f);
}

export async function previewMatching(
  companyId: string,
  filter: Record<string, { operator: string; value: any }>,
  sampleSize = 5,
  // ★ 2026-10-02 요청자 — 몰 동의 회사는 그 사람의 발송과 같은 기준으로 센다(담당자 = 자기 분류코드 소속 행 · 그 밖 = 관리자 기준).
  //   안 넘기면 관리자 기준이라 담당자 화면이 실제 발송보다 적게 세고, 자연어 생성이 0건으로 막혔다(Codex 1002 R1).
  ownerUserId?: string | null,
): Promise<{ matchCount: number; samples: GenerateSegmentResult['samples']; sampleFields: GenerateSegmentResult['sampleFields'] }> {
  // ★ 2026-10-02 수신동의 읽기 = CT(mall-consent · 몰 동의 회사가 아니면 옛 글자)
  const consent = await ownerConsentSql(companyId, ownerUserId, 'c');
  // ★ 2026-10-21 (서수란 접수 · 직접 타겟 추출) 요청자 범위 = CT. 없으면 분류코드 미배정 담당자에게 회사 전체 고객 수·이름·번호가 보였다
  //   (같은 창의 인원 · 담기는 범위로 0명). 관리자 · 분류 체계 없는 회사는 빈 조각이라 종전과 같다.
  const scopeSql = await getOwnerCustomerScopeSql(companyId, ownerUserId, 'c');
  // CT-01 호환 SQL 빌드 ($1 = companyId, $2~ = filter values)
  const { sql: filterSql, params } = buildCustomerFilter(filter, {
    tableAlias: 'c',
    startParamIndex: 2,
    storeCodeMode: 'skip',
    consent,
    inputFormat: 'structured',
  });

  // 발송 가능 강제 + 회사 격리 + filter 조합
  const baseWhere = `
    c.company_id = $1
    AND c.is_active = true
    AND ${consent.isTrue}
    AND (c.is_opt_out = false OR c.is_opt_out IS NULL)
    AND (c.is_invalid = false OR c.is_invalid IS NULL)${scopeSql}
    ${filterSql}
  `;

  // filter 참조 필드 추가 열 — 식별자는 사용자 입력이 아니라 FIELD_MAP 상수(columnName)에서만 나온다.
  const extraFields = resolveFilterSampleFields(filter);
  const extraSelect = extraFields
    .map((f) => (f.storageType === 'custom_fields'
      ? `, c.custom_fields ->> '${f.columnName}' AS "${f.fieldKey}"`
      // 날짜 컬럼(date)을 그대로 꺼내면 Date → JSON 이 UTC 시각이 되어 하루 앞으로 보였다(★1021) — 날짜 글자로 꺼낸다
      : f.dataType === 'date'
        ? `, to_char(c.${f.columnName}, 'YYYY-MM-DD') AS "${f.fieldKey}"`
        : `, c.${f.columnName} AS "${f.fieldKey}"`))
    .join('');

  const countSql = `SELECT COUNT(*)::int AS cnt FROM customers c WHERE ${baseWhere}`;
  const safeSampleSize = Math.max(1, Math.min(sampleSize, 50));
  const sampleSql = `
    SELECT c.id, c.phone, c.name, c.gender, c.region,
           c.last_purchase_date, c.total_purchase_amount${extraSelect}
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
    samples: sampleRes.rows.map((r: any) => {
      const row: GenerateSegmentResult['samples'][number] = {
        id: r.id,
        phone: r.phone,
        name: r.name,
        gender: r.gender,
        region: r.region,
        last_purchase_date: r.last_purchase_date,
        total_purchase_amount: r.total_purchase_amount != null ? Number(r.total_purchase_amount) : null,
      };
      for (const f of extraFields) row[f.fieldKey] = r[f.fieldKey] ?? null;
      return row;
    }),
    sampleFields: extraFields.map((f) => ({
      field_key: f.fieldKey, display_name: f.displayName, data_type: f.dataType, category: f.category,
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
