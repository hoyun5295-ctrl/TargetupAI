/**
 * 컬럼 매핑 모듈
 * 고객사 DB 컬럼명 → Target-UP 표준 필드명 변환
 *
 * v1.4.0: custom_1~custom_15 슬롯 매핑 → custom_fields JSONB 구성
 * v1.5.0: suggestMappingWithAI() — Claude Opus 4.7 자동 매핑 (서버 호출) + 실패 시 로컬 폴백
 */

import type { RawRow } from '../db/types';
import type { AuthCredentials } from '../api/auth';
import type { AiMappingTarget, AiMappingSupportedDbType } from '../types/api';
import { getLogger } from '../logger';
import { requestAiMapping } from '../setup/ai-mapping-client';
import { autoSuggestMapping, assignCustomFieldSlots } from './templates';

const logger = getLogger('mapping');

export type ColumnMapping = Record<string, string>; // { "CUST_HP": "phone" }

/** custom_N 슬롯 패턴 매칭 */
const CUSTOM_SLOT_RE = /^custom_(\d+)$/;

/**
 * 복합 매핑 허용 필드 — 여러 소스 컬럼을 이어붙여 하나로 만든다.
 *   레거시 DB가 한 값을 여러 칸에 쪼개 저장하는 경우 대응(2026-06-30 isae 실측:
 *   휴대폰이 핸드폰1='010' / 핸드폰2='1234' / 핸드폰3='5678' 3칸으로 분리).
 *   여기 없는 필드는 editMapping에서 중복 매핑이 차단되어 1:1만 가능하다.
 */
export const COMPOSITE_FIELDS = new Set(['phone', 'customer_phone', 'address']);

/** 전화번호류 복합 — 구분자 없이 숫자만 잇는다(010+1234+5678). 그 외(주소 등)는 공백으로 잇는다. */
const PHONE_COMPOSITE_FIELDS = new Set(['phone', 'customer_phone']);

/** 소스 컬럼명을 끝자리 숫자 기준으로 자연 정렬(핸드폰1 < 핸드폰2 < 핸드폰3). */
function naturalCompare(a: string, b: string): number {
  const ma = a.match(/^(.*?)(\d+)$/);
  const mb = b.match(/^(.*?)(\d+)$/);
  if (ma && mb && ma[1] === mb[1]) return parseInt(ma[2], 10) - parseInt(mb[2], 10);
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * 소스 DB 컬럼을 표준 필드로 매핑합니다.
 * custom_1~custom_15로 매핑된 필드는 custom_fields JSONB 객체로 모아집니다.
 * 같은 표준 필드에 소스 컬럼이 2개 이상 매핑되면(쪼개진 전화번호 등) 끝자리 숫자 순으로 이어붙입니다.
 */
export function mapRow(row: RawRow, mapping: ColumnMapping): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  const customFields: Record<string, unknown> = {};

  // target 필드별로 소스 컬럼을 모은다(row에 실재하는 컬럼만 — 기존 동작 유지).
  const sourcesByTarget = new Map<string, string[]>();
  for (const [sourceCol, targetField] of Object.entries(mapping)) {
    if (!targetField) continue; // 매핑 없는 컬럼 무시
    if (!Object.prototype.hasOwnProperty.call(row, sourceCol)) continue;
    const list = sourcesByTarget.get(targetField);
    if (list) list.push(sourceCol);
    else sourcesByTarget.set(targetField, [sourceCol]);
  }

  for (const [targetField, sourceCols] of sourcesByTarget) {
    const isCustom = CUSTOM_SLOT_RE.test(targetField);

    let value: unknown;
    if (sourceCols.length === 1 || isCustom) {
      // 단일 매핑(또는 custom 슬롯 — 1:1이라 복합 없음). 기존 동작 그대로.
      value = row[sourceCols[0]];
    } else {
      // 복합 필드: 끝자리 숫자 순으로 값을 이어붙인다(빈/널 조각은 건너뜀).
      //   전화번호류는 구분자 없이(숫자), 주소 등은 공백으로 잇는다.
      const sep = PHONE_COMPOSITE_FIELDS.has(targetField) ? '' : ' ';
      const joined = [...sourceCols]
        .sort(naturalCompare)
        .map((c) => row[c])
        .filter((v) => v !== null && v !== undefined && String(v).trim() !== '')
        .map((v) => String(v).trim())
        .join(sep);
      value = joined === '' ? null : joined;
    }

    if (isCustom) customFields[targetField] = value;
    else mapped[targetField] = value;
  }

  // 커스텀 필드가 있으면 JSONB 객체로 추가
  if (Object.keys(customFields).length > 0) {
    mapped.custom_fields = customFields;
  }

  return mapped;
}

/**
 * 배치 매핑 (다수 행)
 */
export function mapBatch(rows: RawRow[], mapping: ColumnMapping): Record<string, unknown>[] {
  const mapped = rows.map((row) => mapRow(row, mapping));
  logger.debug(`매핑 완료: ${mapped.length}건`);
  return mapped;
}

/**
 * v1.5.0 — Claude Opus 4.7 자동 매핑 (서버 호출).
 *
 * 처리 순서:
 *   1. 서버 /api/sync/ai-mapping 호출 (설계서 §5)
 *   2. 서버 응답 실패(쿼터 초과/서비스 장애) 시 → 로컬 autoSuggestMapping 폴백
 *   3. custom_N 자동 배정 + 커스텀 라벨 생성
 *
 * ⚠️ PII 금지: 컬럼명만 전송. 샘플 데이터 절대 전송하지 않음.
 *
 * @param options 서버 접속 정보 + 인증 자격증명
 * @param target customers | purchases
 * @param tableName 소스 DB 테이블명 (프롬프트 컨텍스트용)
 * @param dbType 소스 DB 타입
 * @param sourceColumns 소스 컬럼명 목록
 * @returns 매핑 + 커스텀 라벨 + 모델 정보 + 폴백 여부
 */
export interface SuggestMappingWithAIOptions {
  serverUrl: string;
  credentials: AuthCredentials;
  target: AiMappingTarget;
  tableName: string;
  dbType: AiMappingSupportedDbType;
  sourceColumns: string[];
}

export interface SuggestMappingWithAIResult {
  mapping: ColumnMapping;
  customFieldLabels: Record<string, string>;
  overflowColumns: string[];
  unmappedColumns: string[];
  modelUsed: string;
  fallbackUsed: boolean;
  fallbackReason?: string;
  cacheHit?: boolean;
  tokensUsed?: number;
  costEstimate?: number;
}

export async function suggestMappingWithAI(
  options: SuggestMappingWithAIOptions,
): Promise<SuggestMappingWithAIResult> {
  const { serverUrl, credentials, target, tableName, dbType, sourceColumns } = options;

  // 1차: 서버 AI 매핑 호출
  try {
    const aiResult = await requestAiMapping(
      { serverUrl, credentials },
      { target, tableName, dbType, columns: sourceColumns },
    );

    // 서버가 반환한 매핑을 ColumnMapping으로 변환 (null 값 제외)
    const aiMapping: ColumnMapping = {};
    for (const [col, field] of Object.entries(aiResult.mapping)) {
      if (field && typeof field === 'string') {
        aiMapping[col] = field;
      }
    }
    const unmapped = sourceColumns.filter((c) => !aiMapping[c]);

    // custom_N 자동 배정 (AI가 이미 custom_N을 지정한 경우 그 순서 유지 + 나머지 매핑 안 된 것 이어서 배정)
    const { mapping, customFieldLabels, overflowColumns } = assignCustomFieldSlots(aiMapping, unmapped);

    logger.info(`AI 매핑 완료: 매핑=${Object.keys(mapping).length}/${sourceColumns.length}, cacheHit=${aiResult.cacheHit}`);

    return {
      mapping,
      customFieldLabels,
      overflowColumns,
      unmappedColumns: sourceColumns.filter((c) => !mapping[c]),
      modelUsed: aiResult.modelUsed,
      fallbackUsed: false,
      cacheHit: aiResult.cacheHit,
      tokensUsed: aiResult.tokensUsed,
      costEstimate: aiResult.costEstimate,
    };
  } catch (error: any) {
    const reason = error?.message || String(error);
    logger.warn(`AI 매핑 서버 호출 실패 → 로컬 autoSuggestMapping 폴백: ${reason}`);

    // 2차: 로컬 폴백
    const local = autoSuggestMapping(sourceColumns, target);
    const { mapping, customFieldLabels, overflowColumns } = assignCustomFieldSlots(local.mapping, local.unmapped);

    return {
      mapping,
      customFieldLabels,
      overflowColumns,
      unmappedColumns: sourceColumns.filter((c) => !mapping[c]),
      modelUsed: 'local_fallback',
      fallbackUsed: true,
      fallbackReason: reason,
    };
  }
}

/**
 * 매핑 설정 유효성 검증
 * @returns 경고 메시지 목록 (빈 배열이면 문제 없음)
 */
export function validateMapping(
  mapping: ColumnMapping,
  sourceColumns: string[],
  target: 'customers' | 'purchases',
): string[] {
  const warnings: string[] = [];

  // 매핑에 있는데 소스 DB에 없는 컬럼
  for (const sourceCol of Object.keys(mapping)) {
    if (!sourceColumns.includes(sourceCol)) {
      warnings.push(`매핑 컬럼 '${sourceCol}'이 소스 DB에 존재하지 않습니다.`);
    }
  }

  // 필수 필드 매핑 확인
  const requiredFields = target === 'customers'
    ? ['phone']
    : ['customer_phone', 'purchase_date', 'total_amount'];

  const mappedTargets = new Set(Object.values(mapping));
  for (const required of requiredFields) {
    if (!mappedTargets.has(required)) {
      warnings.push(`필수 필드 '${required}'에 매핑된 소스 컬럼이 없습니다.`);
    }
  }

  return warnings;
}
