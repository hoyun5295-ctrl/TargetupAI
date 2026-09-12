/**
 * customerFilterBuild.ts — 화면에서 고른 조건 → CT-01 호환 filter (프론트 CT)
 *
 * 🎯 목적
 *   "필드를 체크하고 값을 고른 상태"를 서버가 아는 filter 구조(`{필드: {operator, value}}`)로 바꾼다.
 *   직접발송의 조건 선택(DirectTargetFilterModal)과 모바일DM 타겟 추출의 직접 선택 탭이 **같은 규칙**으로
 *   조건을 만들어야, 같은 조건을 골랐을 때 두 화면의 인원수가 갈라지지 않는다.
 *
 * 유래 (★ 2026-09-12)
 *   DirectTargetFilterModal 안에 있던 `buildDynamicFiltersForAPI`를 **본체 그대로** 옮겼다.
 *   컴포넌트 상태를 직접 읽던 자리(selectedFields·filterValues·enabledFields)만 인자로 받는다.
 *   규칙을 고칠 일이 생기면 여기만 고친다 — 화면 쪽에 같은 로직을 다시 쓰지 않는다.
 *
 * ⛔ 주의
 *   - `smsOptIn`은 filter에 넣지 않고 따로 돌려준다. 소비처가 문자 축이면 별도 파라미터로 보내고,
 *     채널 자격(모바일DM·카카오)에 수신동의가 이미 들어 있는 축이면 쓰지 않는다.
 *   - 날짜·숫자 필드의 DB 컬럼 이름 차이(`last_purchase_date` → `recent_purchase_date`)는 여기서 흡수한다.
 */

/** 조건 빌드에 필요한 필드 메타(활성 필드 응답의 부분집합) */
export interface FilterBuildField {
  field_key: string;
  data_type?: string;
  [extra: string]: unknown;
}

export interface DynamicFilterBuildResult {
  /** CT-01 호환 filter — `{필드: {operator, value}}` */
  dynamicFilters: Record<string, any>;
  /** 문자 수신동의 조건을 켰는가(필드 축이 아니라 별도 파라미터) */
  smsOptIn: boolean;
}

/**
 * 선택 상태 → filter.
 * ★ D104: selectedFields 순회 — filterValues에 본 키가 없어도 `_min`/`_max`를 참조할 수 있다.
 */
export function buildDynamicFiltersFromSelection(
  selectedFields: Iterable<string>,
  filterValues: Record<string, any>,
  enabledFields: FilterBuildField[],
): DynamicFilterBuildResult {
  const filters: Record<string, any> = {};
  let smsOptIn = false;

  const dbColMap: Record<string, string> = {
    'last_purchase_date': 'recent_purchase_date',
    'last_purchase_amount': 'recent_purchase_amount'
  };

  for (const fieldKey of selectedFields) {
    const field = enabledFields.find((f: any) => f.field_key === fieldKey);
    if (!field) continue;
    const value = filterValues[fieldKey];

    // sms_opt_in 별도 처리
    if (fieldKey === 'sms_opt_in' || fieldKey === 'opt_in_sms') {
      smsOptIn = value === 'true';
      continue;
    }

    // 연령 특수 처리
    if (fieldKey === 'age') {
      if (value?.mode === 'preset' && value.presets?.length > 0) {
        const decades = value.presets.map(Number).sort((a: number, b: number) => a - b);
        const min = decades[0];
        const maxD = decades[decades.length - 1];
        if (maxD >= 60) {
          filters['age'] = min >= 60
            ? { operator: 'gte', value: 60 }
            : { operator: 'gte', value: min };
        } else {
          filters['age'] = { operator: 'between', value: [min, maxD + 9] };
        }
      } else if (value?.mode === 'range') {
        if (value.min && value.max) {
          filters['age'] = { operator: 'between', value: [Number(value.min), Number(value.max)] };
        } else if (value.min) {
          filters['age'] = { operator: 'gte', value: Number(value.min) };
        } else if (value.max) {
          filters['age'] = { operator: 'lte', value: Number(value.max) };
        }
      }
      continue;
    }

    // 숫자 — 범위 (min ~ max) ★ filterValues에 본 키 없어도 _min/_max로 처리
    if (field.data_type === 'number' && fieldKey !== 'age') {
      const dbCol = dbColMap[fieldKey] || fieldKey;
      const minVal = filterValues[`${fieldKey}_min`];
      const maxVal = filterValues[`${fieldKey}_max`];
      if (minVal && maxVal) {
        filters[dbCol] = { operator: 'between', value: [Number(minVal), Number(maxVal)] };
      } else if (minVal) {
        filters[dbCol] = { operator: 'gte', value: Number(minVal) };
      } else if (maxVal) {
        filters[dbCol] = { operator: 'lte', value: Number(maxVal) };
      }
      continue;
    }

    // 날짜 필드
    if (field.data_type === 'date') {
      if (!value) continue;
      const dbCol = dbColMap[fieldKey] || fieldKey;
      if (typeof value === 'string' && value.startsWith('month:')) {
        filters[dbCol] = { operator: 'birth_month', value: parseInt(value.replace('month:', '')) };
      } else {
        filters[dbCol] = { operator: 'days_within', value: parseInt(value) };
      }
      continue;
    }

    // 다중선택 (배열)
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      if (value.length === 1) {
        filters[fieldKey] = { operator: 'eq', value: value[0] };
      } else {
        filters[fieldKey] = { operator: 'in', value };
      }
      continue;
    }

    if (!value && value !== false) continue;

    // 불린
    if (field.data_type === 'boolean') {
      filters[fieldKey] = { operator: 'eq', value: value === 'true' };
      continue;
    }

    // 문자열 (옵션 없는 텍스트 → contains)
    if (field.data_type === 'string' && typeof value === 'string' && value.trim()) {
      filters[fieldKey] = { operator: 'contains', value: value.trim() };
      continue;
    }
  }

  return { dynamicFilters: filters, smsOptIn };
}
