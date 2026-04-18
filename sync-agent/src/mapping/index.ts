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
 * 소스 DB 컬럼을 표준 필드로 매핑합니다.
 * custom_1~custom_15로 매핑된 필드는 custom_fields JSONB 객체로 모아집니다.
 */
export function mapRow(row: RawRow, mapping: ColumnMapping): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  const customFields: Record<string, unknown> = {};

  for (const [sourceCol, value] of Object.entries(row)) {
    const targetField = mapping[sourceCol];

    if (!targetField) {
      // 매핑 자체가 없는 컬럼 → 무시 (v1.4.0: custom 슬롯 미배정 컬럼)
      continue;
    }

    const customMatch = targetField.match(CUSTOM_SLOT_RE);
    if (customMatch) {
      // custom_N 슬롯 → custom_fields JSONB에 수집
      customFields[targetField] = value;
    } else {
      // 표준 필드 매핑
      mapped[targetField] = value;
    }
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

    logger.info(`AI 매핑 완료: 모델=${aiResult.modelUsed}, 매핑=${Object.keys(mapping).length}/${sourceColumns.length}, cacheHit=${aiResult.cacheHit}`);

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
