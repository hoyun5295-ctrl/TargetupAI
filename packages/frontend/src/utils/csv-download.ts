/**
 * csv-download.ts — CSV 다운로드 공용 CT (2026-07-06 Harold 지시)
 *
 *   이메일 발송 이력 · DM 발송 추적 · 인앱 식별 고객 목록의 CSV 내보내기 단일 정의.
 *   - UTF-8 BOM(﻿) — 엑셀에서 한글 깨짐 방지
 *   - 셀 이스케이프 — 콤마/따옴표/줄바꿈 포함 셀은 따옴표 감싸기 + 내부 따옴표 이중화
 *   - 컴포넌트 인라인 정의 금지 (no_inline_duplication) — 반드시 이 유틸을 import
 */

export type CsvCell = string | number | boolean | null | undefined;

function escapeCell(v: CsvCell): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** rows를 CSV 문자열로 직렬화 (헤더 포함) */
export function buildCsv(headers: string[], rows: CsvCell[][]): string {
  const lines = [headers.map(escapeCell).join(',')];
  for (const row of rows) lines.push(row.map(escapeCell).join(','));
  return lines.join('\r\n');
}

/** CSV 파일 다운로드 트리거 — BOM 포함, 파일명에 확장자 자동 보정 */
export function downloadCsv(filename: string, headers: string[], rows: CsvCell[][]): void {
  const name = filename.toLowerCase().endsWith('.csv') ? filename : `${filename}.csv`;
  const blob = new Blob(['﻿' + buildCsv(headers, rows)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * blob 응답(responseType:'blob') API의 오류 메시지 추출 — ★ 2026-07-25 신설.
 * 서버가 400/503 JSON을 내도 blob이라 `err.response.data.error`가 안 잡혀 "다운로드 실패"만 뜨던 문제 해결.
 * (에이전트 통계 엑셀의 기간 오류·PAY 미설정 안내가 사용자에게 그대로 보여야 한다.)
 * 파싱 실패 시 fallback 반환.
 */
export async function extractBlobErrorMessage(err: any, fallback: string): Promise<string> {
  try {
    const data = err?.response?.data;
    if (data instanceof Blob) {
      const text = await data.text();
      const parsed = JSON.parse(text);
      return parsed?.error || fallback;
    }
    return data?.error || fallback;
  } catch {
    return fallback;
  }
}

/** 파일명 안전화 — 캠페인명 등 임의 문자열에서 OS 금지 문자 제거 */
export function safeCsvFilename(base: string, suffix: string): string {
  const cleaned = String(base || '').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 40) || 'export';
  return `${cleaned}_${suffix}`;
}
