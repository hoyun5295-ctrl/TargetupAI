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

import { cellToString, formatByType } from './formatDate';

/** 조건 빌드에 필요한 필드 메타(활성 필드 응답의 부분집합) */
export interface FilterBuildField {
  field_key: string;
  data_type?: string;
  /** 커스텀 칸(custom_fields JSONB) — 활성 필드 응답의 is_custom */
  is_custom?: boolean;
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

/**
 * ★ 2026-10-20 직접 타겟 추출 창 개편 — 체크 단계가 없다. 값이 있는 칸만 조건이다(값 = 선택).
 *   숫자 칸은 `_min`/`_max` 중 하나라도 있으면, 연령은 고른 연령대 또는 범위 한쪽이 있으면 조건이다.
 *   공백뿐인 글자는 조건이 아니다(위 빌드가 trim 뒤 버리는 것과 같은 판정).
 */
export function fieldHasFilterValue(fieldKey: string, filterValues: Record<string, any>, field?: FilterBuildField): boolean {
  if (field?.data_type === 'number' && fieldKey !== 'age') {
    return !!(filterValues[`${fieldKey}_min`] || filterValues[`${fieldKey}_max`]);
  }
  const val = filterValues[fieldKey];
  if (val === undefined || val === null || val === '') return false;
  if (Array.isArray(val)) return val.length > 0;
  if (fieldKey === 'age') {
    if (val?.mode === 'preset') return (val.presets || []).length > 0;
    if (val?.mode === 'range') return !!(val.min || val.max);
    return false;
  }
  if (typeof val === 'string') return val.trim() !== '';
  return true;
}

/** 조건이 걸린 칸(활성 항목 순서) — buildDynamicFiltersFromSelection 의 첫 인자 */
export function chosenFilterFields(filterValues: Record<string, any>, enabledFields: FilterBuildField[]): string[] {
  return enabledFields.filter((f) => fieldHasFilterValue(f.field_key, filterValues, f)).map((f) => f.field_key);
}

const isSmsOptInKey = (k: string) => k === 'sms_opt_in' || k === 'opt_in_sms';

/** 발송 창(TargetSendModal)에 넘기는 항목 — DirectTargetFilterModal 의 FieldMeta 와 같은 모양 */
export interface ExtractionFieldMeta {
  field_key: string;
  display_name: string;
  variable: string;
  data_type: string;
  category: string;
}

/**
 * ★ 2026-10-20 담기 뒤 넘기는 항목 = 활성 항목 전체(직접발송 칸 맞추기의 고를 항목 · 옛 창은 체크한 칸만 넘겼다 — 체크 단계를 없애면 고를 항목이 사라진다).
 *   순서 = 번호 → 조건 고른 칸 → 나머지(앞쪽에 고른 칸이 보이게) · 문자 수신 동의는 뺀다.
 */
export function extractionFieldsMeta(enabledFields: FilterBuildField[], chosen: string[]): ExtractionFieldMeta[] {
  const usable = enabledFields.filter((f) => !isSmsOptInKey(f.field_key));
  const rank = (k: string) => (k === 'phone' ? -1 : chosen.includes(k) ? chosen.indexOf(k) : chosen.length + usable.findIndex((f) => f.field_key === k));
  return [...usable]
    .sort((a, b) => rank(a.field_key) - rank(b.field_key))
    .map((f: any) => ({
      field_key: f.field_key,
      display_name: f.display_name || f.field_key,
      variable: `%${f.display_name || f.field_key}%`,
      data_type: f.data_type || 'string',
      category: f.category || 'basic',
    }));
}

/**
 * ★ 2026-10-20 담은 고객(보관본 전체 행) → 직접발송 칸 맞추기 창(파일등록과 같은 창)의 표.
 *   직접발송 치환값은 이름 · 회신번호 · 기타1~3 뿐이다(Harold 1020) — 고객 항목 중 무엇을 넣을지는 파일처럼 칸 맞추기에서 고른다.
 *   머리글 = 항목 이름(같은 이름이 둘이면 뒤에 키를 붙인다) · 값 = 화면 표기(성별 F → 여성 · 금액 1,200,000 · CT formatByType) · 번호는 원문.
 *   번호 · 이름 칸은 미리 맞춰 둔다(기타1~3은 사람이 고른다).
 */
const ROW_RESERVED_KEYS = new Set(['phone', 'name', 'extra1', 'extra2', 'extra3', 'callback', '_templateVars', 'originalIdx']);

export function extractionRowsToTable(
  rows: Record<string, unknown>[],
  meta: ExtractionFieldMeta[],
): { headers: string[]; data: Record<string, string>[]; mapping: Record<string, string> } {
  // 머리글 = 행의 키다. 등록(handleMappingApply)이 행을 펼친 뒤 phone · name · extra1~3 · callback · _templateVars 를 덮어쓰고
  //   목록이 originalIdx 를 붙이므로, 그 이름이나 앞 머리글과 겹치면 뒤에 키를 붙인다(겹친 원본 값이 사라지지 않게 · Codex 2R).
  const used = new Set<string>();
  const cols = meta.map((m) => {
    let header = m.display_name;
    if (ROW_RESERVED_KEYS.has(header) || used.has(header)) header = `${m.display_name}(${m.field_key})`;
    for (let i = 2; ROW_RESERVED_KEYS.has(header) || used.has(header); i++) header = `${m.display_name}(${m.field_key}) ${i}`;
    used.add(header);
    return { m, header };
  });
  const data = rows.map((r) => Object.fromEntries(cols.map(({ m, header }) => [
    header,
    m.field_key === 'phone' ? cellToString(r[m.field_key]) : formatByType(r[m.field_key], m.data_type, m.field_key),
  ])));
  const mapping: Record<string, string> = {};
  const headerOf = (k: string) => cols.find((c) => c.m.field_key === k)?.header;
  if (headerOf('phone')) mapping.phone = headerOf('phone')!;
  if (headerOf('name')) mapping.name = headerOf('name')!;
  return { headers: cols.map((c) => c.header), data, mapping };
}

const DAY_LABELS: Record<string, string> ={ '7': '7일', '30': '30일', '90': '90일', '180': '180일', '365': '1년' };

/**
 * ★ 2026-10-20 고른 조건 칩 글(추출 창 오른쪽 요약). 조건이 아니면 null.
 *   optionLabel = 선택지 값 → 화면 글(성별 'F' → '여성' 같은 표시 변환은 화면 CT 가 소유한다).
 */
export function conditionChipLabel(
  field: FilterBuildField & { display_name?: string },
  filterValues: Record<string, any>,
  optionLabel: (fieldKey: string, option: string) => string = (_k, o) => o,
): string | null {
  const k = field.field_key;
  if (!fieldHasFilterValue(k, filterValues, field)) return null;
  const name = String(field.display_name || k);
  const v = filterValues[k];
  if (isSmsOptInKey(k)) return v === 'true' ? `${name}한 고객만` : `${name} 상관없음`;
  if (k === 'age') {
    if (v.mode === 'preset') {
      const ds = [...v.presets].map(Number).sort((a: number, b: number) => a - b);
      return `${name} ${ds.map((d: number) => (d >= 60 ? '60대 이상' : `${d}대`)).join('·')}`;
    }
    if (v.min && v.max) return `${name} ${v.min}~${v.max}세`;
    return v.min ? `${name} ${v.min}세 이상` : `${name} ${v.max}세 이하`;
  }
  if (field.data_type === 'number') {
    const n = (s: string) => Number(s).toLocaleString('ko-KR');
    const lo = filterValues[`${k}_min`];
    const hi = filterValues[`${k}_max`];
    if (lo && hi) return `${name} ${n(lo)}~${n(hi)}`;
    return lo ? `${name} ${n(lo)} 이상` : `${name} ${n(hi)} 이하`;
  }
  if (Array.isArray(v)) {
    const shown = v.slice(0, 2).map((o: string) => optionLabel(k, o)).join('·');
    return v.length > 2 ? `${name} ${shown} 외 ${v.length - 2}` : `${name} ${shown}`;
  }
  if (field.data_type === 'date') {
    if (String(v).startsWith('month:')) return `${name} ${String(v).slice(6)}월`;
    return `${name} ${DAY_LABELS[String(v)] || `${v}일`} 이내`;
  }
  if (field.data_type === 'boolean') return `${name} ${v === 'true' ? '예' : '아니오'}`;
  return `${name} 「${String(v).trim()}」 포함`;
}

/**
 * ★ 2026-10-19 직접 타겟 선택(조건 고르기 창) → AI 한줄로 대상 조건(허브 해석기 = 발송 명단과 같은 해석기의 mixed 형식).
 * 같은 모양은 그대로 둔다. 모양이 다른 것만 옮긴다 = 나이 이상/이하/일치 → minAge · maxAge · 범위, 커스텀 칸 → `custom_fields.키`.
 * 옮길 수 없는 모양은 `unsupported` 로 돌려준다(화면이 막는다 · 조건을 버려 대상이 넓어지면 안 된다).
 * 서버도 칸마다 SQL 이 실제로 나오는지 다시 본다(/api/ai-line/retarget 의 untranslated).
 */
export function toLineAudienceFilters(
  dynamicFilters: Record<string, any>,
  enabledFields: FilterBuildField[],
): { filters: Record<string, unknown>; unsupported: string[] } {
  const custom = new Set(enabledFields.filter((f) => f.is_custom === true).map((f) => f.field_key));
  const filters: Record<string, unknown> = {};
  const unsupported: string[] = [];
  for (const [key, cond] of Object.entries(dynamicFilters || {})) {
    const op = cond?.operator;
    const v = cond?.value;
    if (key === 'age') {
      if (op === 'between' && Array.isArray(v) && v.length === 2) filters.age = { operator: 'between', value: [Number(v[0]), Number(v[1])] };
      else if (op === 'gte' && Number.isFinite(Number(v))) filters.minAge = Number(v);
      else if (op === 'lte' && Number.isFinite(Number(v))) filters.maxAge = Number(v);
      else if (op === 'eq' && Number.isFinite(Number(v))) filters.age = { operator: 'between', value: [Number(v), Number(v)] };
      else unsupported.push(key);
      continue;
    }
    // 성별 여러 개(in)는 해석기가 한 값만 받는다
    if (key === 'gender' && op !== 'eq') { unsupported.push(key); continue; }
    filters[custom.has(key) ? `custom_fields.${key}` : key] = cond;
  }
  return { filters, unsupported };
}
