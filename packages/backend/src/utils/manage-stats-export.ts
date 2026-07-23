/**
 * manage-stats-export.ts — 발송 통계(웹+에이전트) 엑셀(CSV) 빌더 컨트롤타워
 *
 * ★ 2026-07-23 (서수란) 웹+에이전트 사용 업체는 화면 탭이 분리돼 합산 수량 확인이 번거로움 →
 *   한 파일에 웹·에이전트 발송 수량을 '채널' 컬럼으로 묶어 내보낸다(수량·발송ID별 구분 = 정산 오차 확인).
 * BOM 포함 UTF-8 CSV(엑셀 한글 깨짐 방지) — utils/campaign-list-csv.ts 패턴 정합. DB import 0 = 순수 함수.
 */

export interface StatsExportWebRow {
  period: string;
  sent: number | string;
  success: number | string;
  fail: number | string;
}

export interface StatsExportAgentRow {
  period: string;
  agent_send_id: string;
  type_label?: string;
  msg_type?: string;
  sent: number | string;
  success: number | string;
  fail: number | string;
  pending: number | string;
}

const CSV_HEADERS = ['채널', '기간', '발송ID', '유형', '전송', '성공', '실패', '대기'];

/** 쉼표·큰따옴표·줄바꿈 포함 값은 큰따옴표로 감싸고 내부 "는 ""로 이스케이프. */
function csvEscape(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const n = (v: unknown): number => Number(v) || 0;

/**
 * 웹 rows(기간별) + 에이전트 rows(기간×발송ID×유형) → CSV 문자열(BOM 포함).
 * 웹 행은 발송ID/유형/대기 공란(집계 축이 아님). 빈 입력이면 헤더만.
 */
export function buildManageStatsCsv(input: {
  webRows?: StatsExportWebRow[];
  agentRows?: StatsExportAgentRow[];
}): string {
  const BOM = '﻿';
  const lines: string[] = [];
  for (const r of input.webRows || []) {
    lines.push(['웹', r.period, '', '', n(r.sent), n(r.success), n(r.fail), ''].map(csvEscape).join(','));
  }
  for (const r of input.agentRows || []) {
    lines.push(
      ['에이전트', r.period, r.agent_send_id || '', r.type_label || r.msg_type || '', n(r.sent), n(r.success), n(r.fail), n(r.pending)]
        .map(csvEscape)
        .join(','),
    );
  }
  return BOM + CSV_HEADERS.join(',') + (lines.length ? '\n' + lines.join('\n') : '');
}

/** ★ 2026-07-24 슈퍼관리자 에이전트(엔진) 통계 CSV 행 — 고객사 축이 추가된 형태(기간×고객사×발송ID×유형). */
export interface AdminAgentStatsCsvRow {
  period: string;
  company_name?: string;
  agent_send_id?: string;
  type_label?: string;
  msg_type?: string;
  sent: number | string;
  success: number | string;
  fail: number | string;
  pending: number | string;
}

const ADMIN_AGENT_CSV_HEADERS = ['기간', '고객사', '발송ID', '유형', '전송', '성공', '실패', '대기'];

/**
 * 슈퍼관리자 에이전트 통계 rows(기간×고객사×발송ID×유형) → CSV 문자열(BOM 포함).
 * 고객사 화면 CSV와 달리 '고객사' 컬럼이 있어 전 업체 정산 대조에 쓴다. 빈 배열이면 헤더만.
 */
export function buildAdminAgentStatsCsv(rows: AdminAgentStatsCsvRow[]): string {
  const BOM = '﻿';
  const lines = (rows || []).map((r) =>
    [r.period, r.company_name || '', r.agent_send_id || '', r.type_label || r.msg_type || '', n(r.sent), n(r.success), n(r.fail), n(r.pending)]
      .map(csvEscape)
      .join(','),
  );
  return BOM + ADMIN_AGENT_CSV_HEADERS.join(',') + (lines.length ? '\n' + lines.join('\n') : '');
}
