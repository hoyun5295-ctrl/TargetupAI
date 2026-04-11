/**
 * upload-mapping-validator.ts — 고객 DB 업로드 매핑 검증 컨트롤타워 (D111)
 *
 * 배경 (PDF 0408 지적):
 *   "중간관리자 아래 계정에서 고객 DB가 추가되었을 때 동일한 필드 형태가 아니면
 *    데이터가 꼬여 타겟팅이 되지 않습니다. 오류 메시지 또는 업로드 차단이 필요합니다.
 *    실 발송 시 데이터 오류로 오발송 위험이 있습니다."
 *
 * 원인:
 *   - AI 매핑이 회차마다 같은 엑셀 헤더를 다른 custom_N 슬롯에 배정 가능
 *   - 사용자가 수동 매핑 시 기존 customer_field_definitions 와의 일치성 검증 없음
 *   - CT-07 upsertCustomFieldDefinitions 가 ON CONFLICT DO UPDATE 정책 → 기존 라벨/타입이 조용히 덮어쓰임
 *   - 결과: 기존 고객의 custom_fields.custom_N 과 신규 고객의 custom_fields.custom_N 의미 불일치 → 타겟팅 오류
 *
 * 컨트롤타워 역할:
 *   - 업로드 확정 전 매핑을 기존 customer_field_definitions 와 비교
 *   - 충돌 종류별 분류 (slot_label/slot_type/label_moved/label_duplicate_in_file)
 *   - 샘플 값 기반 field_type 자동 감지 (VARCHAR/NUMBER/DATE)
 *   - 호출부: routes/upload.ts POST /validate-mapping
 *
 * ⚠️ 이 검증 없이 /save 를 바로 호출하는 프론트 경로는 금지.
 */

import { query } from '../config/database';

export type ConflictType =
  | 'slot_label_conflict'     // 같은 custom_N 슬롯, 기존 라벨 ≠ 신규 라벨
  | 'slot_type_conflict'      // 같은 custom_N 슬롯, 기존 field_type ≠ 신규 field_type
  | 'label_moved'             // 같은 라벨인데 기존과 다른 custom_N 슬롯에 매핑
  | 'label_duplicate_in_file'; // 같은 업로드 파일 내 다른 헤더가 같은 기존 라벨과 겹침

export type FieldTypeSimple = 'VARCHAR' | 'NUMBER' | 'DATE';

export interface MappingConflict {
  type: ConflictType;
  customKey: string;                                      // 'custom_1' 등
  header: string;                                         // 엑셀 컬럼명
  proposed: { label: string; fieldType: FieldTypeSimple };
  existing?: { customKey: string; label: string; fieldType: string };
  severity: 'error' | 'warning';
  message: string;
  /** 해결 옵션 힌트 (프론트는 이 리스트에서 UI 버튼 구성) */
  resolveOptions: Array<'keep_existing' | 'overwrite' | 'move_slot' | 'cancel'>;
}

export interface MappingValidationResult {
  conflicts: MappingConflict[];
  newFields: Array<{ customKey: string; label: string; fieldType: FieldTypeSimple }>;
  standardFields: string[];  // 표준 필드로 매핑된 헤더 목록
  availableSlots: string[];  // 충돌 해결용 — 비어있는 custom_N 목록
  summary: {
    totalHeaders: number;
    errorCount: number;
    warningCount: number;
    standardCount: number;
    customCount: number;
    ignoredCount: number;
  };
}

/**
 * 샘플 값 배열에서 field_type 자동 감지.
 * upload.ts D101 로직과 동일 규칙 (YYMMDD 우선 → 숫자 → VARCHAR fallback).
 */
export function detectFieldTypeFromSamples(samples: any[]): FieldTypeSimple {
  const valid = samples.filter(v => v != null && v !== '');
  if (valid.length === 0) return 'VARCHAR';

  // 날짜 감지 — YYYY-MM-DD / YYYYMMDD / YYMMDD / Date 객체
  const allDate = valid.every((v: any) => {
    if (v instanceof Date) return true;
    const s = String(v).trim();
    return /^\d{4}-\d{2}-\d{2}/.test(s) || /^\d{8}$/.test(s) || /^\d{6}$/.test(s);
  });
  // 6자리 숫자가 진짜 YYMMDD 인지 월/일 범위 검증
  const looksLikeDate6 = valid.every((v: any) => {
    const s = String(v).trim();
    if (!/^\d{6}$/.test(s)) return true;
    const mm = parseInt(s.substring(2, 4), 10);
    const dd = parseInt(s.substring(4, 6), 10);
    return mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31;
  });
  if (allDate && looksLikeDate6) return 'DATE';

  // 숫자 감지 — 전체가 숫자로 파싱 가능
  const allNumeric = valid.every((v: any) => {
    const s = String(v).trim();
    if (!s) return false;
    // 전화번호 제외
    if (/^0\d/.test(s)) return false;
    if (/^\d[\d-]+\d$/.test(s) && s.includes('-')) return false;
    return !isNaN(Number(s.replace(/,/g, '')));
  });
  if (allNumeric) return 'NUMBER';

  return 'VARCHAR';
}

/**
 * 매핑 검증 메인 함수.
 *
 * @param companyId        회사 ID
 * @param proposedMapping  { header → fieldKey } — AI 또는 사용자가 결정한 매핑. fieldKey는 'phone'/'name'/'custom_3' 또는 null
 * @param customLabels     { custom_N → label } — 사용자가 지정한 커스텀 필드 한글 라벨 (없으면 header로 폴백)
 * @param sampleData       { header → 샘플 값 배열 } — 각 컬럼 상위 20행 샘플 (타입 감지)
 */
export async function validateUploadMapping(
  companyId: string,
  proposedMapping: Record<string, string | null>,
  customLabels: Record<string, string>,
  sampleData: Record<string, any[]>
): Promise<MappingValidationResult> {
  // 기존 customer_field_definitions 전부 조회
  const existingResult = await query(
    `SELECT field_key, field_label, field_type
     FROM customer_field_definitions
     WHERE company_id = $1 AND field_key LIKE 'custom_%'`,
    [companyId]
  );

  // ★ D114 P2: 고객 0명이면 충돌을 warning으로 격하 (기존 데이터 없으므로 의미 충돌 없음)
  const customerCountResult = await query(
    'SELECT COUNT(*) as cnt FROM customers WHERE company_id = $1 AND is_active = true',
    [companyId]
  );
  const hasCustomers = parseInt(customerCountResult.rows[0].cnt) > 0;

  const existingByKey = new Map<string, { label: string; fieldType: string }>();
  const existingByLabel = new Map<string, { customKey: string; fieldType: string }>();
  for (const row of existingResult.rows) {
    existingByKey.set(row.field_key, { label: row.field_label, fieldType: row.field_type || 'VARCHAR' });
    if (row.field_label) {
      existingByLabel.set(normalizeLabel(row.field_label), {
        customKey: row.field_key,
        fieldType: row.field_type || 'VARCHAR',
      });
    }
  }

  const conflicts: MappingConflict[] = [];
  const newFields: MappingValidationResult['newFields'] = [];
  const standardFields: string[] = [];
  const usedCustomKeys = new Set<string>();
  const labelToHeadersInFile = new Map<string, string[]>();
  let standardCount = 0;
  let customCount = 0;
  let ignoredCount = 0;

  for (const [header, fieldKey] of Object.entries(proposedMapping)) {
    if (!fieldKey) {
      ignoredCount++;
      continue;
    }
    if (!fieldKey.startsWith('custom_')) {
      standardFields.push(header);
      standardCount++;
      continue;
    }

    customCount++;
    usedCustomKeys.add(fieldKey);

    // 제안 라벨 결정 (customLabels 우선, 없으면 header)
    const proposedLabel = (customLabels[fieldKey] || header || '').trim();
    const proposedType = detectFieldTypeFromSamples(sampleData[header] || []);
    const existing = existingByKey.get(fieldKey);

    // 파일 내 동일 라벨 다중 사용 체크용
    const normLabel = normalizeLabel(proposedLabel);
    if (!labelToHeadersInFile.has(normLabel)) labelToHeadersInFile.set(normLabel, []);
    labelToHeadersInFile.get(normLabel)!.push(header);

    if (existing) {
      // 기존 슬롯에 이미 필드 정의 있음 → 라벨/타입 비교
      if (normalizeLabel(existing.label) !== normLabel) {
        // ★ D114 P2: 고객 0명이면 warning으로 격하 — 기존 데이터가 없으므로 덮어쓰기 안전
        const sev = hasCustomers ? 'error' : 'warning';
        conflicts.push({
          type: 'slot_label_conflict',
          customKey: fieldKey,
          header,
          proposed: { label: proposedLabel, fieldType: proposedType },
          existing: { customKey: fieldKey, label: existing.label, fieldType: existing.fieldType },
          severity: sev,
          message: hasCustomers
            ? `"${fieldKey}" 슬롯에는 이미 "${existing.label}" (${existing.fieldType}) 필드가 저장되어 있습니다. "${proposedLabel}"로 덮어쓰면 기존 고객 데이터와 의미가 섞입니다.`
            : `"${fieldKey}" 슬롯에 기존 정의 "${existing.label}"이 남아있지만 고객 데이터가 없어 안전하게 덮어쓸 수 있습니다.`,
          resolveOptions: hasCustomers ? ['keep_existing', 'overwrite', 'move_slot', 'cancel'] : ['overwrite', 'cancel'],
        });
        if (hasCustomers) continue;
        // 고객 0명이면 warning이므로 계속 진행 (newFields에 추가하지 않고 그대로)
        continue;
      }
      if (existing.fieldType.toUpperCase() !== proposedType) {
        const sev = hasCustomers ? 'error' : 'warning';
        conflicts.push({
          type: 'slot_type_conflict',
          customKey: fieldKey,
          header,
          proposed: { label: proposedLabel, fieldType: proposedType },
          existing: { customKey: fieldKey, label: existing.label, fieldType: existing.fieldType },
          severity: sev,
          message: hasCustomers
            ? `"${fieldKey}" 슬롯의 타입이 기존 ${existing.fieldType}과 신규 ${proposedType}로 다릅니다. 타겟팅/미리보기가 오동작할 수 있습니다.`
            : `"${fieldKey}" 슬롯의 타입이 다르지만 고객 데이터가 없어 안전하게 변경됩니다.`,
          resolveOptions: hasCustomers ? ['keep_existing', 'overwrite', 'cancel'] : ['overwrite', 'cancel'],
        });
        if (hasCustomers) continue;
        continue;
      }
      // 기존 라벨/타입 일치 — 정상 갱신
    } else {
      // 기존 슬롯 비어있음 → 신규 등록이지만 label_moved 검사 필요
      const movedFrom = existingByLabel.get(normLabel);
      if (movedFrom && movedFrom.customKey !== fieldKey) {
        conflicts.push({
          type: 'label_moved',
          customKey: fieldKey,
          header,
          proposed: { label: proposedLabel, fieldType: proposedType },
          existing: { customKey: movedFrom.customKey, label: proposedLabel, fieldType: movedFrom.fieldType },
          severity: 'error',
          message: `"${proposedLabel}"은(는) 이미 ${movedFrom.customKey} 슬롯에 저장되어 있습니다. 신규 업로드에서 ${fieldKey}로 배정되면 같은 라벨이 두 슬롯에 나뉘어 타겟팅 오류가 발생합니다.`,
          resolveOptions: ['move_slot', 'cancel'],
        });
        continue;
      }
      newFields.push({ customKey: fieldKey, label: proposedLabel, fieldType: proposedType });
    }
  }

  // 파일 내 라벨 중복 검사
  for (const [normLabel, headers] of labelToHeadersInFile.entries()) {
    if (headers.length > 1) {
      conflicts.push({
        type: 'label_duplicate_in_file',
        customKey: proposedMapping[headers[0]] || '',
        header: headers.join(' / '),
        proposed: { label: normLabel, fieldType: 'VARCHAR' },
        severity: 'error',
        message: `같은 라벨 "${normLabel}"이 ${headers.length}개 컬럼(${headers.join(', ')})에 동시에 사용되었습니다. 라벨을 구분해주세요.`,
        resolveOptions: ['cancel'],
      });
    }
  }

  // 비어있는 custom 슬롯 계산 (1~15 중 사용 안 된 것)
  const availableSlots: string[] = [];
  for (let i = 1; i <= 15; i++) {
    const key = `custom_${i}`;
    if (!usedCustomKeys.has(key) && !existingByKey.has(key)) {
      availableSlots.push(key);
    }
  }

  return {
    conflicts,
    newFields,
    standardFields,
    availableSlots,
    summary: {
      totalHeaders: Object.keys(proposedMapping).length,
      errorCount: conflicts.filter(c => c.severity === 'error').length,
      warningCount: conflicts.filter(c => c.severity === 'warning').length,
      standardCount,
      customCount,
      ignoredCount,
    },
  };
}

/** 라벨 정규화 — 공백/대소문자 무시 비교용 */
function normalizeLabel(label: string): string {
  return (label || '').trim().toLowerCase().replace(/\s+/g, '');
}
