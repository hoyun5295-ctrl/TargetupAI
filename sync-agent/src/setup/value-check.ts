/**
 * 설치 값 확인 (★ 2026-10-28 P2 · docs/2026-10-28-sync-value-check-summary-guard-design.md §3)
 *
 * 첫 전체 동기화 전에, 매핑된 수신동의 · 탈퇴 표시 · 성별 컬럼의 실제 값 분포를 DB 에서 읽어 판정을 보여 주고
 * 낱말표가 모르는 글자만 설치 담당이 그 자리에서 분류한다(고객사에 다시 묻지 않는다 · 엠티콜렉션 「수신/미수신」 · 「탈퇴」).
 * 소비처 = setup/cli.ts(마법사 Step 4 끝) · setup/edit-config.ts(메뉴 [6]). 판정 = normalize `builtinValueJudgement` 한 곳.
 * 결과는 설정 최상위 `valueMaps` — 정규화는 낱말표가 null 로 판정한 글자에만 쓴다(normalize applyInstallValueMaps).
 */

import type { ValueMaps } from '../config/schema';
import { builtinValueJudgement, singleSourceColumn, VALUE_MAP_FIELDS, type ValueMapField, type ValueMapTarget } from '../normalize';

/** 서로 다른 값이 이보다 많으면 분류하지 않는다(그 컬럼이 수신동의 · 탈퇴 · 성별 칸이 아닐 가능성이 크다) */
export const VALUE_CHECK_LIMIT = 30;
/** 이보다 긴 글자는 분류하지 않는다(표시 · 설정 크기) */
const MAX_VALUE_LENGTH = 100;
/**
 * 컬럼 하나 값 세기 상한 — 넘으면 어댑터가 실행을 끊고 이 단계는 건너뛴다(지금 규칙 · 설치 계속).
 * 설정 queryTimeout(기본 30초)을 쓰지 않는 이유 = 복호화 함수가 든 100만 행 뷰(엠티)는 30초를 넘길 수 있고, 넘으면 값 확인 자체를 못 한다.
 */
export const VALUE_CHECK_TIMEOUT_MS = 5 * 60 * 1000;

export interface ValueCount { value: string | null; count: number }

export interface ValueCheckConnector {
  countColumnValues?(tableName: string, column: string, limit: number, timeoutMs: number): Promise<{ values: ValueCount[]; truncated: boolean }>;
}

export interface ValueCheckIo {
  log(line: string): void;
  askSelect(question: string, choices: { name: string; value: any }[]): Promise<any>;
}

const FIELD_LABEL: Record<ValueMapField, string> = { sms_opt_in: '수신동의', is_opt_out: '탈퇴·거부 표시', gender: '성별' };

type Classified = boolean | 'M' | 'F';

/** 앞뒤 공백을 지운 글자로 합친다(정규화와 같은 기준) · 빈 글자와 NULL 은 「값 없음」 하나로 센다 */
export function mergeTrimmed(values: ValueCount[]): { rows: Array<{ value: string; count: number }>; blank: number } {
  const byValue = new Map<string, number>();
  let blank = 0;
  for (const { value, count } of values) {
    const v = value == null ? '' : String(value).trim();
    if (v === '') { blank += count; continue; }
    byValue.set(v, (byValue.get(v) || 0) + count);
  }
  const rows = [...byValue.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
  return { rows, blank };
}

/** 판정 글자(낱말표 판정 · 설치 분류 공용) */
export function judgementLabel(field: ValueMapField, judged: Classified | string | null): string {
  if (judged === null) return '알 수 없음';
  if (field === 'sms_opt_in') return judged === true ? '수신동의' : '수신거부';
  if (field === 'is_opt_out') return judged === true ? '탈퇴(발송 제외)' : '정상';
  return judged === 'M' ? '남' : judged === 'F' ? '여' : '알 수 없음';
}

/** 모르는 글자의 선택지 · value null = 모름(표에 넣지 않음 = 지금 규칙) */
export function classificationChoices(field: ValueMapField): { name: string; value: Classified | null }[] {
  if (field === 'sms_opt_in') {
    return [
      { name: '수신동의', value: true },
      { name: '수신거부', value: false },
      { name: '모름 (지금 규칙: 신규 고객은 미동의로 들어갑니다)', value: null },
    ];
  }
  if (field === 'is_opt_out') {
    return [
      { name: '탈퇴 (발송 제외)', value: true },
      { name: '정상 (발송 가능)', value: false },
      { name: '모름 (지금 규칙: 수신거부로 처리합니다)', value: null },
    ];
  }
  return [
    { name: '남', value: 'M' },
    { name: '여', value: 'F' },
    { name: '모름 (비워 둡니다)', value: null },
  ];
}

/** 모름(표 밖 · 분류 안 함)일 때 정규화가 내는 결과 글자 — 요약 줄용 */
function unclassifiedOutcome(field: ValueMapField): string {
  if (field === 'sms_opt_in') return '알 수 없음(신규 미동의)';
  if (field === 'is_opt_out') return '알 수 없음(수신거부로 처리)';
  return '알 수 없음(비움)';
}

function setEntry(out: ValueMaps, field: ValueMapField, column: string, target: ValueMapTarget, values: Record<string, Classified>): void {
  const scope = { column, table: target.table, source: target.source };
  if (field === 'gender') out.gender = { ...scope, values: values as Record<string, 'M' | 'F'> };
  else out[field] = { ...scope, values: values as Record<string, boolean> };
}

/**
 * 값 확인 한 번 — 고객 표 · 고객 매핑 기준.
 * @param target 분류표를 묶을 고객 테이블 · 원본(normalize valueMapSourceOf(저장할 접속 설정))
 * @param current 지금 저장된 표(설정 편집에서 다시 돌릴 때) — 쿼리가 실패한 필드는 컬럼 · 테이블 · 원본이 같으면 그 표를 그대로 둔다
 * @returns 새 valueMaps(분류가 하나도 없으면 undefined)
 */
export async function runValueCheck(
  connector: ValueCheckConnector,
  target: ValueMapTarget,
  customerMapping: Record<string, string>,
  current: ValueMaps | undefined,
  io: ValueCheckIo,
): Promise<ValueMaps | undefined> {
  const out: ValueMaps = {};
  const keepCurrent = (field: ValueMapField, column: string) => {
    const prev = current?.[field];
    if (prev && prev.column === column && prev.table === target.table && prev.source === target.source) {
      setEntry(out, field, column, target, prev.values as Record<string, Classified>);
    }
  };

  if (!connector.countColumnValues) {
    io.log('  ⚠  이 원본은 값 확인을 지원하지 않습니다. 동기화 뒤 로그의 값 안내(CONSENT_VALUE_UNKNOWN · OPT_OUT_VALUE_UNKNOWN)를 확인해 주세요.');
    for (const field of VALUE_MAP_FIELDS) {
      const column = singleSourceColumn(customerMapping, field);
      if (column) keepCurrent(field, column);
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }

  for (const field of VALUE_MAP_FIELDS) {
    const label = FIELD_LABEL[field];
    const column = singleSourceColumn(customerMapping, field);
    if (!column) {
      if (Object.values(customerMapping).filter((t) => t === field).length > 1) {
        io.log(`  ⚠  ${label}: 컬럼 여러 개를 이어 붙인 매핑이라 값 확인을 하지 않습니다.`);
      }
      continue;
    }

    io.log('');
    io.log(`  🔄 ${label} (${column}) 값 세는 중... (큰 표는 몇 분 걸릴 수 있습니다 · ${VALUE_CHECK_TIMEOUT_MS / 60000}분을 넘으면 건너뜁니다)`);
    let result: { values: ValueCount[]; truncated: boolean };
    try {
      result = await connector.countColumnValues(target.table, column, VALUE_CHECK_LIMIT, VALUE_CHECK_TIMEOUT_MS);
    } catch (e: any) {
      io.log(`  ⚠  ${label} 값 확인 실패 (${e?.message || e}). 건너뜁니다(지금 규칙대로 동기화합니다).`);
      keepCurrent(field, column);
      continue;
    }
    if (result.truncated) {
      io.log(`  ⚠  ${label} (${column}) 값이 ${VALUE_CHECK_LIMIT}가지를 넘습니다. 이 컬럼이 ${label} 칸이 맞는지 매핑을 다시 확인해 주세요.`);
      io.log('     분류하지 않고 지금 규칙대로 동기화합니다.');
      continue;
    }

    const { rows, blank } = mergeTrimmed(result.values);
    io.log(`  [ ${label} · ${column} ]`);
    for (const r of rows) {
      io.log(`    "${r.value}"  ${r.count.toLocaleString()}건  → ${judgementLabel(field, builtinValueJudgement(field, r.value) as Classified | null)}`);
    }
    if (blank > 0) io.log(`    (값 없음)  ${blank.toLocaleString()}건  → 그대로 둡니다`);

    const values: Record<string, Classified> = {};
    const tally = new Map<string, number>();
    const add = (k: string, n: number) => tally.set(k, (tally.get(k) || 0) + n);
    for (const r of rows) {
      const builtin = builtinValueJudgement(field, r.value) as Classified | null;
      if (builtin !== null) { add(judgementLabel(field, builtin), r.count); continue; }
      if (r.value.length > MAX_VALUE_LENGTH) {
        io.log(`  ⚠  너무 긴 값(${r.value.length}자)은 분류하지 않습니다.`);
        add(unclassifiedOutcome(field), r.count);
        continue;
      }
      const picked: Classified | null = await io.askSelect(
        `${label} 값 "${r.value}" (${r.count.toLocaleString()}건)은 무엇입니까?`,
        classificationChoices(field),
      );
      if (picked === null || picked === undefined) { add(unclassifiedOutcome(field), r.count); continue; }
      values[r.value] = picked;
      add(judgementLabel(field, picked), r.count);
    }
    if (blank > 0) add('값 없음', blank);

    if (Object.keys(values).length > 0) setEntry(out, field, column, target, values);
    io.log(`  ✅ ${label} 결과: ${[...tally.entries()].map(([k, n]) => `${k} ${n.toLocaleString()}`).join(' · ') || '행 없음'}`);
  }

  return Object.keys(out).length > 0 ? out : undefined;
}
