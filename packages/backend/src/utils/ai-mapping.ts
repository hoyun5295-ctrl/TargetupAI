/**
 * utils/ai-mapping.ts
 * ===================
 * SyncAgent v1.5.0 — AI 컬럼 매핑 컨트롤타워 (신규 CT)
 *
 * 역할:
 *   - 고객사 소스 DB 컬럼명을 한줄로 FIELD_MAP 표준 필드에 매핑
 *   - 1차 모델 = AI_MODELS.claude(Sonnet 5 — defaults.ts 단일 진실, ★ 2026-07-06 Harold 지시로 통일)
 *     + 프롬프트 캐싱(FIELD_MAP 정의부 ephemeral 5분 TTL)
 *   - 폴백 체인: 1차 → Sonnet 4.5 legacy → 호출 실패 응답 (Agent가 로컬 autoSuggestMapping 폴백)
 *   - 회사당 월 호출 쿼터 (plans.ai_mapping_monthly_quota, 기본 10)
 *
 * 설계 참조: status/SYNC-AGENT-V1.5.0-DESIGN.md §5
 *
 * ⚠️ 유일한 진입점 — routes/sync.ts /ai-mapping 외부에서 직접 호출 금지.
 *    신규 매핑 경로는 반드시 이 CT를 import하여 사용한다.
 */

import Anthropic from '@anthropic-ai/sdk';
import { query } from '../config/database';
import { FIELD_MAP } from './standard-field-map';
import { AI_MODELS, isAdaptiveOnlyModel } from '../config/defaults';
// ★2026-09-02 대상별 허용 필드 = 매핑 계약 CT(저장 검증과 같은 표를 본다)
import { SYNC_PURCHASE_FIELD_GUIDE, SYNC_PURCHASE_TARGET_FIELDS } from './sync-mapping-fields';

// ============================================================
// 환경변수 / 모델
// ============================================================

// ★ 2026-07-06 Harold 지시 — 매핑 1차 모델을 Sonnet 5(AI_MODELS.claude)로 통일. 모델 정책은 defaults.ts 한 곳이 진실.
//   (서버 .env에 CLAUDE_MAPPING_MODEL이 명시돼 있으면 그 값이 우선 — 배포 시 확인)
const MODEL_PRIMARY = process.env.CLAUDE_MAPPING_MODEL || AI_MODELS.claude;
const MODEL_SONNET_FALLBACK = process.env.CLAUDE_MAPPING_FALLBACK || 'claude-sonnet-4-5-20250929';
const MAX_TOKENS = 4000;

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

// ============================================================
// 타입
// ============================================================

export type SupportedDbType = 'mssql' | 'mysql' | 'oracle' | 'postgres' | 'excel' | 'csv';
export type MappingTarget = 'customers' | 'purchases';

export interface AiMappingInput {
  target: MappingTarget;
  tableName: string;
  dbType: SupportedDbType;
  columns: string[];
}

export interface AiMappingResult {
  mapping: Record<string, string | null>;
  modelUsed: 'claude-opus-4-7' | 'claude-sonnet-4-5-20250929' | string;
  cacheHit: boolean;
  tokensUsed: number;
  costEstimate: number; // USD 추정
}

export class AiMappingQuotaExceeded extends Error {
  code = 'AI_MAPPING_QUOTA_EXCEEDED';
  limit: number;
  used: number;
  constructor(limit: number, used: number) {
    super(`AI 매핑 호출 한도 초과 (월 ${limit}회, 사용 ${used}회)`);
    this.limit = limit;
    this.used = used;
  }
}

export class AiMappingUnavailable extends Error {
  code = 'AI_MAPPING_UNAVAILABLE';
  constructor(detail: string) {
    super(`AI 매핑 호출 실패: ${detail}`);
  }
}

// ============================================================
// 쿼터 체크 — 회사당 월 10회 (plans.ai_mapping_monthly_quota)
// ============================================================

/** 현재 KST 기준 YYYY-MM */
function currentYearMonth(): string {
  const now = new Date();
  const kstMs = now.getTime() + 9 * 60 * 60 * 1000;
  const kst = new Date(kstMs);
  const yyyy = kst.getUTCFullYear();
  const mm = String(kst.getUTCMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

/**
 * 쿼터 체크 + 필요 시 월 리셋.
 * 새 월이면 ai_mapping_calls_month=0으로 리셋 후 카운트 시작.
 * 쿼터 초과 시 AiMappingQuotaExceeded 던짐.
 *
 * @returns { limit, used_before } — 사전 사용량 정보
 */
async function checkQuotaAndReset(companyId: string): Promise<{ limit: number; usedBefore: number }> {
  const now = currentYearMonth();

  // plan + 현재 사용량 + 마지막 호출 월 조회
  const res = await query(
    `SELECT
       COALESCE(p.ai_mapping_monthly_quota, 10) AS quota,
       COALESCE(c.ai_mapping_calls_month, 0) AS calls,
       c.ai_mapping_last_month
     FROM companies c
     LEFT JOIN plans p ON p.id = c.plan_id
     WHERE c.id = $1`,
    [companyId]
  );
  if (res.rows.length === 0) {
    throw new AiMappingUnavailable('회사를 찾을 수 없습니다.');
  }
  const { quota, calls, ai_mapping_last_month } = res.rows[0];
  const limit = Number(quota) || 10;

  // 월이 바뀌었으면 카운트 리셋
  if (ai_mapping_last_month !== now) {
    await query(
      `UPDATE companies SET ai_mapping_calls_month = 0, ai_mapping_last_month = $1, updated_at = NOW() WHERE id = $2`,
      [now, companyId]
    );
    return { limit, usedBefore: 0 };
  }

  const used = Number(calls) || 0;
  if (used >= limit) {
    throw new AiMappingQuotaExceeded(limit, used);
  }
  return { limit, usedBefore: used };
}

/** 호출 성공 후 카운트 증가 */
async function incrementQuota(companyId: string): Promise<void> {
  const now = currentYearMonth();
  await query(
    `UPDATE companies
       SET ai_mapping_calls_month = COALESCE(ai_mapping_calls_month, 0) + 1,
           ai_mapping_last_month = $1,
           updated_at = NOW()
     WHERE id = $2`,
    [now, companyId]
  );
}

// ============================================================
// 프롬프트 구성
// ============================================================

/**
 * FIELD_MAP 정의 텍스트 — 이 부분을 캐싱 대상으로 지정.
 * Anthropic 프롬프트 캐싱: 5분 TTL, 1024 토큰 이상 필요.
 * FIELD_MAP 36개 필드 설명만으로도 1024토큰은 충분히 넘음.
 */
/**
 * ★ 2026-09-02 구매 대상 전용 필드표 — 종전에는 대상과 무관하게 아래 고객 필드표만 줬다.
 *   그래서 구매 테이블을 매핑해도 AI가 고를 수 있는 것이 `phone`·`recent_purchase_date`뿐이었고,
 *   아난티 구매 매핑이 통째로 고객 필드로 채워져 98,600건이 전량 드롭됐다(BUGS B-0902-4).
 *   AI는 주어진 목록 밖을 고를 수 없다 — **목록이 곧 게이트다.**
 *   목록의 단일 진실 = `sync-mapping-fields.ts`(저장 시 검증도 같은 표를 쓴다).
 */
function buildPurchaseFieldReference(): string {
  const lines: string[] = [];
  lines.push('한줄로 구매(purchases) 표준 필드 정의:');
  lines.push('');
  for (const f of SYNC_PURCHASE_FIELD_GUIDE) {
    lines.push(`- ${f.key}: ${f.label}${f.hint ? ` (${f.hint})` : ''}`);
  }
  lines.push('- custom_1 ~ custom_15: 커스텀 슬롯 (위 필드에 해당 없는 데이터용, 최대 15개)');
  lines.push('');
  lines.push('매핑 규칙:');
  lines.push('1. 이 표는 **구매 내역 테이블** 전용이다. 고객 필드(phone, name, birth_date, recent_purchase_date,');
  lines.push('   total_purchase_amount 등)는 여기서 쓸 수 없다. 비슷해 보여도 고르지 마라.');
  lines.push('2. 고객 전화번호는 phone이 아니라 **customer_phone**이다.');
  lines.push('3. 구매일은 recent_purchase_date가 아니라 **purchase_date**다.');
  lines.push('4. 그 건의 결제 금액은 total_purchase_amount(고객 누적)가 아니라 **total_amount**다.');
  lines.push('5. customer_phone과 purchase_date는 반드시 매핑한다. 둘 중 하나라도 없으면 전량 적재 실패다.');
  lines.push('6. 위 필드에 해당 안 되면 custom_1부터 순서대로 (최대 custom_15까지).');
  lines.push('7. 시스템 컬럼(created_at, updated_at, is_active, 순번 등)은 null.');
  lines.push('');
  lines.push('응답 형식: JSON만 (설명 없이)');
  lines.push('{"소스컬럼명": "field_key 또는 null", ...}');
  lines.push('');
  lines.push('예시: {"TRAN_TEL": "customer_phone", "TRAN_ADAT": "purchase_date", "TRAN_TOT": "total_amount", "TRAN_GNAME": "product_name", "TRAN_SEQ": null}');
  lines.push('⚠️ 반드시 field_key 영문만. 한글 설명 금지.');
  return lines.join('\n');
}

function buildFieldMapReference(): string {
  const lines: string[] = [];
  lines.push('한줄로 표준 필드 정의 (36개 필드 = 직접 컬럼 21개 + 커스텀 15개):');
  lines.push('');
  for (const f of FIELD_MAP) {
    if (f.storageType === 'custom_fields') continue;
    const extra = f.fieldKey === 'phone' ? ' (필수)' : '';
    const aliases = f.aliases && f.aliases.length > 0 ? ` (동의어: ${f.aliases.join(', ')})` : '';
    lines.push(`- ${f.fieldKey}: ${f.displayName}${extra}${aliases}`);
  }
  lines.push('- custom_1 ~ custom_15: 커스텀 슬롯 (표준 필드에 해당 없는 데이터용, 최대 15개)');
  lines.push('');
  lines.push('매핑 규칙:');
  lines.push('1. 의미가 비슷하면 매핑한다 (예: CUST_HP→phone, MBR_NM→name, SEX_CD→gender).');
  lines.push('2. 위 필드에 해당 안 되면 custom_1부터 순서대로 (최대 custom_15까지).');
  lines.push('3. phone은 반드시 매핑한다.');
  lines.push('4. 시스템 컬럼(created_at, updated_at, is_active, customer_id 등)은 null.');
  lines.push('5. age는 정수 나이만. 연령대("20대")는 custom 필드로.');
  lines.push('6. 매장 관련 필드 정확히 구분:');
  lines.push('   - registered_store: 등록매장, 가입매장, 소속매장');
  lines.push('   - recent_purchase_store: 최근구매매장, 최종구매매장');
  lines.push('   - store_code: 브랜드코드, 구분코드 (CPB, NARS 등)');
  lines.push('   - store_phone: 매장전화번호');
  lines.push('   - store_name: 단순 매장명');
  lines.push('7. 날짜/구매 필드 구분:');
  lines.push('   - birth_date: 생년월일');
  lines.push('   - recent_purchase_date: 최근구매일');
  lines.push('   - recent_purchase_amount vs total_purchase_amount');
  lines.push('   - purchase_count: 구매횟수');
  lines.push('');
  lines.push('응답 형식: JSON만 (설명 없이)');
  lines.push('{"소스컬럼명": "field_key 또는 null", ...}');
  lines.push('');
  lines.push('예시: {"CUST_HP": "phone", "CUST_NM": "name", "SEX_CD": "gender", "MY_INTERNAL_FLAG": null}');
  lines.push('⚠️ 반드시 field_key 영문만. 한글 설명 금지.');
  return lines.join('\n');
}

function buildUserPrompt(input: AiMappingInput): string {
  return `고객사 소스 DB 테이블 컬럼을 한줄로 표준 필드에 매핑해줘.

대상: ${input.target}
DB 타입: ${input.dbType}
테이블명: ${input.tableName}
컬럼명 목록: ${JSON.stringify(input.columns)}

위 [한줄로 표준 필드 정의]를 기준으로 각 컬럼을 어떤 field_key에 매핑할지 JSON 형식으로 응답해줘.`;
}

// ============================================================
// Claude 호출 (Opus → Sonnet 폴백)
// ============================================================

interface RawCallResult {
  text: string;
  modelUsed: string;
  cacheHit: boolean;
  tokensUsed: number;
}

async function callClaudeModel(modelId: string, input: AiMappingInput): Promise<RawCallResult> {
  // ★2026-09-02 대상별로 필드표를 가른다 — 구매에 고객 필드표를 주면 AI가 그것밖에 못 고른다.
  const systemBlock = input.target === 'purchases'
    ? buildPurchaseFieldReference()
    : buildFieldMapReference();
  const userPrompt = buildUserPrompt(input);

  // ★ 2026-07-06 적응형 사고 게이팅 — Sonnet 5·Opus 4.7/4.8은 thinking 생략 시 자동 ON.
  //   사고 블록이 첫 블록으로 오면 아래 추출이 빈손이 되므로 disabled 명시 (7/1 SDK 7곳 정정과 동일 정합).
  const adaptiveGuard: any = isAdaptiveOnlyModel(modelId) ? { thinking: { type: 'disabled' } } : {};
  const response: any = await anthropic.messages.create({
    model: modelId,
    max_tokens: MAX_TOKENS,
    system: [
      {
        type: 'text',
        text: systemBlock,
        cache_control: { type: 'ephemeral' },
      } as any,
    ],
    messages: [{ role: 'user', content: userPrompt }],
    ...adaptiveGuard,
  } as any);

  // ★ 2026-07-06 첫 블록 가정 폐기 — text 타입 블록 탐색 (사고 블록 선행 대응, 업로드 매핑 빈손 사고 동일 클래스)
  const text = (response.content || []).find((b: any) => b?.type === 'text')?.text || '';
  const usage = response.usage || {};
  const cacheRead = Number(usage.cache_read_input_tokens || 0);
  const inputTokens = Number(usage.input_tokens || 0);
  const outputTokens = Number(usage.output_tokens || 0);
  const tokensUsed = inputTokens + outputTokens + cacheRead;

  return {
    text,
    modelUsed: modelId,
    cacheHit: cacheRead > 0,
    tokensUsed,
  };
}

/**
 * JSON 파싱 — AI 응답에서 {...} 블록만 추출 후 JSON.parse.
 * 파싱 실패 시 빈 객체 반환 (Agent가 로컬 폴백하도록).
 */
function parseMappingJson(text: string): Record<string, string | null> {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return {};
    const parsed = JSON.parse(match[0]);
    if (typeof parsed !== 'object' || parsed === null) return {};
    return parsed as Record<string, string | null>;
  } catch {
    return {};
  }
}

/** 매핑 결과 정리: 유효 field_key만 남기고 중복 제거 + custom_1~15 순서 재배정. */
function sanitizeMapping(
  mapping: Record<string, string | null>,
  columns: string[],
  target: MappingTarget = 'customers'
): Record<string, string | null> {
  // ★2026-09-02 대상별 허용 키 — 종전에는 고객 필드로 고정이라, 구매 매핑에서 AI가 customer_phone을
  //   제대로 골라도 여기서 유효하지 않은 키로 보고 null로 버렸다(프롬프트만 고쳐서는 안 되는 이유).
  //   구매 목록의 단일 진실 = sync-mapping-fields.ts(저장 검증과 같은 표).
  const validKeys = new Set(
    target === 'purchases'
      ? SYNC_PURCHASE_TARGET_FIELDS
      : [
          ...FIELD_MAP.filter((f) => f.storageType === 'column').map((f) => f.fieldKey),
          ...Array.from({ length: 15 }, (_, i) => `custom_${i + 1}`),
          'birth_year', // 파생 필드 허용 (upload.ts와 동일)
        ]
  );

  // 1단계: 요청한 columns 순서로 재구성 + 유효성 검증
  const result: Record<string, string | null> = {};
  for (const col of columns) {
    const v = mapping[col];
    if (v === null || v === undefined) {
      result[col] = null;
      continue;
    }
    const key = String(v).trim();
    if (!key || !validKeys.has(key)) {
      result[col] = null;
      continue;
    }
    result[col] = key;
  }

  // 2단계: 중복 제거 — 같은 field_key에 여러 컬럼이 매핑된 경우 첫 번째만 유지
  const usedKeys = new Set<string>();
  for (const col of columns) {
    const v = result[col];
    if (!v) continue;
    if (v.startsWith('custom_')) continue; // custom_N은 3단계에서 재배정
    if (usedKeys.has(v)) {
      result[col] = null;
    } else {
      usedKeys.add(v);
    }
  }

  // 3단계: custom_N 재배정 — AI가 반환한 순서 유지, 1~15 순서대로 다시 할당
  let customIdx = 1;
  for (const col of columns) {
    if (result[col] && String(result[col]).startsWith('custom_')) {
      if (customIdx > 15) {
        result[col] = null;
      } else {
        result[col] = `custom_${customIdx}`;
        customIdx++;
      }
    }
  }

  return result;
}

/** 토큰 기준 비용 추정 — Opus 4.7 기준 (입력 $15/M, 출력 $75/M, 캐시 쓰기 $18.75/M, 캐시 읽기 $1.5/M). */
function estimateCost(modelUsed: string, tokensUsed: number): number {
  // 설계서 5-1 명시 "1회당 ~$0.075" — 토큰 비율 대략 inputHeavy 가정으로 평균 $25/M = 0.000025 * tokens
  const perToken = modelUsed.includes('opus') ? 0.000025 : 0.000005;
  return Number((tokensUsed * perToken).toFixed(4));
}

// ============================================================
// 메인 진입점
// ============================================================

/**
 * 고객사 DB 컬럼명을 한줄로 표준 필드에 매핑.
 *
 * 처리 순서:
 *   1. 쿼터 체크 (월 10회 기본) — 초과 시 AiMappingQuotaExceeded
 *   2. 1차 모델(AI_MODELS.claude = Sonnet 5) 호출 (프롬프트 캐싱 적용)
 *   3. 실패 시 Sonnet 4.5 legacy 폴백
 *   4. 둘 다 실패 시 AiMappingUnavailable
 *   5. 응답 JSON 파싱 + sanitize + 카운트 증가
 *
 * ⚠️ PII 금지: 샘플 데이터 전송 금지. 컬럼명만 전송.
 * ⚠️ API 키는 서버 환경변수 ANTHROPIC_API_KEY만 사용. Agent에 번들링 금지.
 */
export async function callAiMapping(
  companyId: string,
  input: AiMappingInput
): Promise<AiMappingResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new AiMappingUnavailable('ANTHROPIC_API_KEY 미설정');
  }

  // 입력 검증
  if (!input.columns || input.columns.length === 0) {
    throw new AiMappingUnavailable('columns가 비어있습니다.');
  }
  if (input.columns.length > 500) {
    throw new AiMappingUnavailable('컬럼 수가 너무 많습니다 (최대 500개).');
  }

  // 쿼터 체크 (예외 발생 가능)
  const { limit, usedBefore } = await checkQuotaAndReset(companyId);

  // 1차: MODEL_PRIMARY (Sonnet 5 — defaults.ts 단일 진실)
  let raw: RawCallResult;
  try {
    raw = await callClaudeModel(MODEL_PRIMARY, input);
    console.log(
      `[AI Mapping] 1차(${raw.modelUsed}) 호출 성공 (company=${companyId}, tokens=${raw.tokensUsed}, cacheHit=${raw.cacheHit})`
    );
  } catch (primaryErr: any) {
    console.warn(`[AI Mapping] 1차 실패 (${primaryErr.status || primaryErr.message}) → legacy 폴백`);
    // 2차: Sonnet 4.5 legacy 폴백
    try {
      raw = await callClaudeModel(MODEL_SONNET_FALLBACK, input);
      console.log(
        `[AI Mapping] legacy 폴백 성공 (company=${companyId}, tokens=${raw.tokensUsed})`
      );
    } catch (fallbackErr: any) {
      console.error(`[AI Mapping] 폴백도 실패 (${fallbackErr.status || fallbackErr.message})`);
      throw new AiMappingUnavailable(
        `1차+폴백 모두 실패. Agent 로컬 autoSuggestMapping을 사용하세요.`
      );
    }
  }

  // 응답 파싱
  const rawMapping = parseMappingJson(raw.text);
  if (Object.keys(rawMapping).length === 0) {
    console.warn('[AI Mapping] 응답 JSON 파싱 실패 — 전체 null 매핑 반환');
  }
  const mapping = sanitizeMapping(rawMapping, input.columns, input.target);

  // 쿼터 증가 (성공 시에만)
  await incrementQuota(companyId);

  console.log(
    `[AI Mapping] 완료 (company=${companyId}, model=${raw.modelUsed}, used=${usedBefore + 1}/${limit})`
  );

  return {
    mapping,
    modelUsed: raw.modelUsed,
    cacheHit: raw.cacheHit,
    tokensUsed: raw.tokensUsed,
    costEstimate: estimateCost(raw.modelUsed, raw.tokensUsed),
  };
}
