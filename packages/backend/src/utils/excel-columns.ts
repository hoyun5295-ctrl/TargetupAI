/**
 * excel-columns.ts — 업로드 시트 열 정리 (순수, DB import 0)
 *
 * ★ 2026-06-22: 직접발송/업로드 컬럼 매핑 모달에 데이터 없는 꼬리 빈 열(컬럼7·8·9…)이 노출되던 문제.
 *   sheet_to_json({header:1, defval:null})이 시트 used-range의 빈 열까지 null로 반환 →
 *   dedupeHeaders가 빈 헤더를 "컬럼N"으로 만들어 드롭다운에 노출.
 *   해법: 헤더·데이터 전 행에서 단 한 칸도 값이 없는 열만 제거(완전 빈 열).
 *   ★ 헤더 없지만 데이터가 있는 열(예: E열 SMS수신여부 2칸)은 유지 — 사용자가 매핑할 실열이므로.
 *   ★ 값 0은 데이터로 인정(D150-3 falsy 사고 회귀 방지). 공백문자만 = 빈 칸 취급.
 *   적용: upload.ts의 헤더 생성 경로(/parse·/validate-mapping·processUploadInBackground) 모두 동일하게
 *   sheet_to_json 직후 호출 → 3곳 헤더 키 일치 보장(데이터 손실 방지).
 */

/** 셀이 비었는지 — null/undefined/공백문자만 = 빈 칸. 값 0/false는 데이터로 인정. */
function isEmptyCell(v: any): boolean {
  if (v === null || v === undefined) return true;
  return String(v).trim() === '';
}

/**
 * 헤더·데이터 전 행에서 값이 단 하나도 없는 열을 제거한 새 행 배열을 반환한다.
 * 모든 열에 값이 하나라도 있으면 원본 배열을 그대로 반환(빠른 경로 — 불필요한 복사 X).
 */
export function dropEmptyColumns(data: any[][]): any[][] {
  if (data.length === 0) return data;
  const colCount = data.reduce((m, row) => Math.max(m, row.length), 0);
  const keep: number[] = [];
  for (let c = 0; c < colCount; c++) {
    if (data.some((row) => !isEmptyCell(row[c]))) keep.push(c);
  }
  if (keep.length === colCount) return data; // 빈 열 없음 → 원본 유지
  return data.map((row) => keep.map((c) => row[c]));
}

/**
 * ★ 2026-06-23: 헤더 행이 있는 시트에서 "헤더가 빈 열"을 매핑 대상에서 제외한다.
 *   직접발송 빈열 재발(컬럼5·7) — dropEmptyColumns는 "값이 한 칸이라도 있으면 유지"라
 *   헤더 없는 메모성 잡열(E열 SMS수신여부 2칸 / G열 잔여 1칸)이 살아남아 "컬럼N"으로 노출됨.
 *   규칙: 헤더(0번째 행)가 비어있는 열은 제거. 단 그 열이 모든 데이터 행에 값이 꽉 찬
 *        경우(=헤더만 빠진 진짜 데이터 열)는 데이터 손실 방지를 위해 유지.
 *   ※ data[0]을 헤더 행으로 간주 — 호출부가 isFirstRowHeaderRow=true일 때만 적용할 것.
 *   ※ dropEmptyColumns 다음에 호출(완전 빈 열은 먼저 제거된 상태 전제).
 */
export function dropEmptyHeaderColumns(data: any[][]): any[][] {
  if (data.length === 0) return data;
  const header = data[0];
  const colCount = data.reduce((m, row) => Math.max(m, row.length), 0);
  const bodyRows = data.slice(1);
  const keep: number[] = [];
  for (let c = 0; c < colCount; c++) {
    if (!isEmptyCell(header[c])) {
      keep.push(c); // 헤더 있는 열 = 항상 유지
      continue;
    }
    // 헤더 없는 열: 모든 데이터 행에 값이 꽉 찬 경우(진짜 무헤더 데이터 열)만 유지
    const fullyPopulated = bodyRows.length > 0 && bodyRows.every((row) => !isEmptyCell(row[c]));
    if (fullyPopulated) keep.push(c);
  }
  if (keep.length === colCount) return data; // 제거할 헤더 빈 열 없음 → 원본 유지
  return data.map((row) => keep.map((c) => row[c]));
}

/**
 * 첫 행이 헤더 행인지 판정 — 텍스트(숫자/전화번호가 아닌) 셀이 하나라도 있으면 헤더로 본다.
 * upload.ts /parse·/validate-mapping·processUploadInBackground 3경로 동일 판정 보장(인라인 중복 제거).
 */
export function isFirstRowHeaderRow(firstRow: any[]): boolean {
  if (!Array.isArray(firstRow)) return false;
  return firstRow.some((cell) => {
    const str = String(cell ?? '').trim();
    return str !== '' && isNaN(Number(str.replace(/-/g, '')));
  });
}

// ================================================================
// ★ 2026-09-27 한줄로 V2 R144 — 헤더 중복 처리(옛 routes/upload.ts 인라인에서 그대로 옮김) + 헤더·행 나누기 CT
// ================================================================
/**
 * 동일 헤더 자동 디덱싱 — 두 번째 이후 동일 헤더에 " (2)", " (3)" 접미사. 빈 헤더는 "컬럼N".
 * 클라이언트 mapping(unique header key)과 백엔드 처리가 같은 키를 쓰게 한다.
 */
export function dedupeHeaders(rawHeaders: any[]): string[] {
  // ★ Set 기반 단일 패스 — 결과가 항상 unique 보장 (엣지 케이스 포함)
  //   예) 입력 ["전화번호", "전화번호", "전화번호 (2)"] → 출력 ["전화번호", "전화번호 (2)", "전화번호 (3)"]
  //   카운터 기반 단순 디덱싱은 위 입력에서 ["전화번호", "전화번호 (2)", "전화번호 (2)"] 충돌 가능.
  const seen = new Set<string>();
  const result: string[] = [];
  rawHeaders.forEach((raw, idx) => {
    let h = String(raw ?? '').trim();
    if (!h) h = `컬럼${idx + 1}`;
    let candidate = h;
    let n = 2;
    while (seen.has(candidate)) {
      candidate = `${h} (${n})`;
      n++;
    }
    seen.add(candidate);
    result.push(candidate);
  });
  return result;
}

/**
 * 시트 행 배열 → 헤더·데이터 행. 업로드 3경로(/parse · /validate-mapping · 백그라운드 저장)가 이것만 쓴다.
 * - 헤더 있는 파일: 헤더 빈 잡열 제외(dropEmptyHeaderColumns) · 중복 헤더 접미사 · 데이터 = 둘째 행부터
 * - 헤더 없는 파일: 이름 = 컬럼1·컬럼2… · 데이터 = 첫 행부터(첫 고객을 버리지 않는다)
 */
export function splitHeaderRows(raw: any[][]): { headers: string[]; rows: any[][]; hasHeader: boolean } {
  const hasHeader = isFirstRowHeaderRow(raw[0]);
  if (hasHeader) {
    const data = dropEmptyHeaderColumns(raw);
    return { headers: dedupeHeaders(data[0] as any[]), rows: data.slice(1), hasHeader };
  }
  return { headers: (raw[0] || []).map((_: any, idx: number) => `컬럼${idx + 1}`), rows: raw, hasHeader };
}
