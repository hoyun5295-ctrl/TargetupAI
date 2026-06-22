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
