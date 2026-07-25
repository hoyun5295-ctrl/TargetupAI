/**
 * manage-stats-export.ts — 발송 통계(웹+에이전트) 엑셀(CSV) 빌더 컨트롤타워
 *
 * ★ 2026-07-23 (서수란) 웹+에이전트 사용 업체는 화면 탭이 분리돼 합산 수량 확인이 번거로움 →
 *   한 파일에 웹·에이전트 발송 수량을 '채널' 컬럼으로 묶어 내보낸다(수량·발송ID별 구분 = 정산 오차 확인).
 * ★ 2026-07-25 고객 대상 출력은 **.xlsx(exceljs)**가 기본이다(Harold 지시 · LESSONS_BACKEND 룰).
 *   행을 만드는 함수는 순수하게 두고 CSV·xlsx가 그 행을 공유한다 — 형식이 둘이어도 숫자는 하나여야 한다.
 *   CSV 빌더는 하위 호환·테스트용으로 남긴다(BOM 포함 UTF-8 — 엑셀 한글 깨짐 방지).
 */

import { buildXlsxBuffer, type XlsxColumnSpec } from './xlsx-writer';

export interface StatsExportWebRow {
  period: string;
  type_label?: string; // ★ 2026-07-25 (#3) 웹 발송유형(SMS/LMS/MMS/알림톡). 없으면 '(유형 미상)'
  sent: number | string;
  success: number | string;
  fail: number | string;
  pending?: number | string;
}

export interface StatsExportAgentRow {
  period: string;
  agent_send_id: string;
  cust_name?: string; // ★ 2026-07-25 발급명(RSRM_SalesMst.CustNm) — 엑셀 필터·정산 구분용 별도 컬럼
  store_id?: string;  // ★ 2026-07-25 (#2) 대상ID(StoreId 원본) — 발송 시 입력한 청구 구분 축. ''=대상ID 없음
  is_relay?: boolean; // ★ 2026-07-25 (#4) 부달 재전송 귀속분
  type_label?: string;
  msg_type?: string;
  sent: number | string;
  success: number | string;
  fail: number | string;
  pending: number | string;
}

const CSV_HEADERS = ['채널', '기간', '발송ID', '발급명', '대상ID', '유형', '구분', '전송', '성공', '실패', '대기'];

/**
 * ★ 2026-07-25 엑셀(.xlsx) 열 규격 — 헤더는 CSV와 **같은 배열에서 파생**한다.
 *   두 형식이 각자 헤더를 들면 언젠가 갈라지고, 정산 대조 파일에서 그건 곧 오독이다.
 *   수량 4열은 numeric으로 표시해 엑셀에서 합계·필터가 바로 먹게 한다(CSV의 고질적 문제).
 */
const NUMERIC_HEADERS = new Set(['전송', '성공', '실패', '대기']);
const COLUMN_WIDTH: Record<string, number> = {
  채널: 10, 기간: 14, 발송ID: 12, 발급명: 24, 대상ID: 22, 유형: 16, 구분: 12,
  고객사: 24, 전송: 12, 성공: 12, 실패: 12, 대기: 12,
};
function toColumnSpecs(headers: string[]): XlsxColumnSpec[] {
  return headers.map((h) => ({ header: h, numeric: NUMERIC_HEADERS.has(h), width: COLUMN_WIDTH[h] }));
}
export const MANAGE_STATS_COLUMNS: XlsxColumnSpec[] = toColumnSpecs(CSV_HEADERS);

/**
 * 쉼표·큰따옴표·줄바꿈(CR/LF) 포함 값은 큰따옴표로 감싸고 내부 "는 ""로 이스케이프.
 * ★ CSV/Excel 수식 주입 차단 — 아래 문자로 시작하는 셀(발신자가 입력한 대상ID 등)은 '를 앞에 붙여 텍스트로 강제.
 *   대상 = ASCII `= + - @`, tab, CR, LF + 전각 `＝ ＋ － ＠`(엑셀이 전각도 수식으로 해석·저장 후 재열기 시 발동).
 */
function csvEscape(v: unknown): string {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r\n＝＋－＠]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const n = (v: unknown): number => Number(v) || 0;
/** 대상ID(StoreId) 셀 — 빈 값은 '(대상ID 없음)'으로 표기(아난티 등 대상ID 미입력 발송분). */
const storeCell = (v?: string): string => (v && v.trim() !== '' ? v : '(대상ID 없음)');
/** 귀속 구분 — 직접 발송분과 부달(미달) 재전송 귀속분을 엑셀에서 구분해 정산 대조가 가능하게 한다. */
const originCell = (isRelay?: boolean): string => (isRelay ? '부달재전송' : '직접');

/**
 * 웹·테스트 rows(기간×유형) + 에이전트 rows(기간×발송ID×대상ID×유형) → CSV 문자열(BOM 포함).
 * 웹·테스트 행은 발송ID/발급명/대상ID만 공란(에이전트 전용 축)이고 **유형은 채운다**.
 * 웹·테스트 유형은 청구서와 같은 집계(send-usage-aggregation CT)에서 온다 — 정산 대조가 성립해야 하기 때문.
 */
export interface ManageStatsInput {
  webRows?: StatsExportWebRow[];
  /** ★ 2026-07-25 테스트발송·스팸필터 사용분 — 화면 '테스트' 탭과 같은 구분. 청구 대상이라 엑셀에 포함한다. */
  testRows?: StatsExportWebRow[];
  agentRows?: StatsExportAgentRow[];
}

/**
 * (순수) 발송통계 표의 **데이터 행**을 만든다. 헤더는 포함하지 않는다.
 * ★ 2026-07-25 CSV와 xlsx가 이 함수 하나를 공유한다 — 형식이 둘이어도 숫자는 하나여야 한다.
 */
export function buildManageStatsRows(input: ManageStatsInput): Array<Array<string | number>> {
  const rows: Array<Array<string | number>> = [];
  for (const r of input.webRows || []) {
    // 웹 행: 발송ID/발급명/대상ID는 에이전트 전용 축이라 공란.
    // ★ 2026-07-25 (#3) 유형은 채운다 — 빈 셀은 담당자에게 "데이터 누락"으로 읽힌다.
    rows.push(['웹', r.period, '', '', '', r.type_label || '(유형 미상)', '직접', n(r.sent), n(r.success), n(r.fail), r.pending === undefined ? '' : n(r.pending)]);
  }
  for (const r of input.testRows || []) {
    rows.push(['테스트', r.period, '', '', '', r.type_label || '(유형 미상)', '직접', n(r.sent), n(r.success), n(r.fail), r.pending === undefined ? '' : n(r.pending)]);
  }
  for (const r of input.agentRows || []) {
    rows.push(['에이전트', r.period, r.agent_send_id || '', r.cust_name || '', storeCell(r.store_id), r.type_label || r.msg_type || '', originCell(r.is_relay), n(r.sent), n(r.success), n(r.fail), n(r.pending)]);
  }
  return rows;
}

export function buildManageStatsCsv(input: ManageStatsInput): string {
  const BOM = '﻿';
  const lines = buildManageStatsRows(input).map((r) => r.map(csvEscape).join(','));
  return BOM + CSV_HEADERS.join(',') + (lines.length ? '\n' + lines.join('\n') : '');
}

/** 발송통계 엑셀(.xlsx) — CSV와 같은 행·같은 헤더에서 나온다. */
export async function buildManageStatsXlsx(
  input: ManageStatsInput,
  meta: { title?: string; caption?: string },
): Promise<Buffer> {
  return buildXlsxBuffer({
    sheetName: '발송통계',
    title: meta.title,
    caption: meta.caption,
    columns: MANAGE_STATS_COLUMNS,
    rows: buildManageStatsRows(input),
  });
}

/** ★ 2026-07-24 슈퍼관리자 에이전트(엔진) 통계 CSV 행 — 고객사 축이 추가된 형태(기간×고객사×발송ID×대상ID×유형). */
export interface AdminAgentStatsCsvRow {
  period: string;
  company_name?: string;
  agent_send_id?: string;
  cust_name?: string; // ★ 2026-07-25 발급명(RSRM_SalesMst.CustNm) — 엑셀 필터·정산 구분용 별도 컬럼
  store_id?: string;  // ★ 2026-07-25 (#2) 대상ID(StoreId 원본). ''=대상ID 없음
  is_relay?: boolean; // ★ 2026-07-25 (#4) 부달 재전송 귀속분
  type_label?: string;
  msg_type?: string;
  sent: number | string;
  success: number | string;
  fail: number | string;
  pending: number | string;
}

const ADMIN_AGENT_CSV_HEADERS = ['기간', '고객사', '발송ID', '발급명', '대상ID', '유형', '구분', '전송', '성공', '실패', '대기'];
export const ADMIN_AGENT_COLUMNS: XlsxColumnSpec[] = toColumnSpecs(ADMIN_AGENT_CSV_HEADERS);

/** (순수) 슈퍼 에이전트 통계 데이터 행 — CSV·xlsx 공용. */
export function buildAdminAgentStatsRows(rows: AdminAgentStatsCsvRow[]): Array<Array<string | number>> {
  return (rows || []).map((r) => [
    r.period, r.company_name || '', r.agent_send_id || '', r.cust_name || '', storeCell(r.store_id),
    r.type_label || r.msg_type || '', originCell(r.is_relay), n(r.sent), n(r.success), n(r.fail), n(r.pending),
  ]);
}

/** 슈퍼 에이전트 통계 엑셀(.xlsx) — CSV와 같은 행에서 나온다. */
export async function buildAdminAgentStatsXlsx(
  rows: AdminAgentStatsCsvRow[],
  meta: { title?: string; caption?: string },
): Promise<Buffer> {
  return buildXlsxBuffer({
    sheetName: '에이전트발송통계',
    title: meta.title,
    caption: meta.caption,
    columns: ADMIN_AGENT_COLUMNS,
    rows: buildAdminAgentStatsRows(rows),
  });
}

/**
 * 슈퍼관리자 에이전트 통계 rows(기간×고객사×발송ID×대상ID×유형) → CSV 문자열(BOM 포함).
 * 고객사 화면 CSV와 달리 '고객사' 컬럼이 있어 전 업체 정산 대조에 쓴다. 빈 배열이면 헤더만.
 */
export function buildAdminAgentStatsCsv(rows: AdminAgentStatsCsvRow[]): string {
  const BOM = '﻿';
  const lines = (rows || []).map((r) =>
    [r.period, r.company_name || '', r.agent_send_id || '', r.cust_name || '', storeCell(r.store_id), r.type_label || r.msg_type || '', originCell(r.is_relay), n(r.sent), n(r.success), n(r.fail), n(r.pending)]
      .map(csvEscape)
      .join(','),
  );
  return BOM + ADMIN_AGENT_CSV_HEADERS.join(',') + (lines.length ? '\n' + lines.join('\n') : '');
}
