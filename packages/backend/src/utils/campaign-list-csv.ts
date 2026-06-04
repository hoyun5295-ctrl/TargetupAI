/**
 * campaign-list-csv.ts — 발송결과 채널통합조회(요약 탭) CSV 빌더 컨트롤타워
 *
 * 고객사 발송결과 모달에서 기간 조회한 캠페인 목록을 엑셀(CSV)로 내보낼 때 사용.
 * 비즈웹 레거시 엑셀 형식 정합: 메시지내용/등록일시/발송일시/채널/전송건수/성공/실패/대기/성공률/발송자.
 * DB import 0 — 순수 함수(ts-node verify로 TDD).
 */

/** 캠페인 채널 라벨 (이모지 제거 순수 텍스트). 화면 channelChip과 동일 분기. */
export function channelPlainLabel(sendChannel: string | null | undefined, messageType: string | null | undefined): string {
  if (sendChannel === 'kakao') return '카카오';
  if (sendChannel === 'alimtalk') return '알림톡';
  if (sendChannel === 'both') return 'SMS+카카오';
  const mt = String(messageType || '').toUpperCase();
  if (mt === 'LMS' || mt === 'L') return 'LMS';
  if (mt === 'MMS' || mt === 'M') return 'MMS';
  return 'SMS';
}

export interface CampaignCsvRow {
  message: string;
  createdAt: string;
  sentAt: string;
  channel: string;
  sent: number;
  success: number;
  fail: number;
  pending: number;
  rate: number;
  sender: string;
}

const CSV_HEADERS = ['메시지내용', '등록일시', '발송일시', '채널', '전송건수', '성공', '실패', '대기', '성공률(%)', '발송자'];

/** 쉼표·큰따옴표·줄바꿈 포함 값은 큰따옴표로 감싸고 내부 "는 ""로 이스케이프. */
function csvEscape(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 캠페인 행 배열 → CSV 문자열(BOM 포함, 엑셀 한글 깨짐 방지). 빈 배열이면 헤더만. */
export function buildCampaignListCsv(rows: CampaignCsvRow[]): string {
  const BOM = '﻿';
  const lines = rows.map(r =>
    [r.message, r.createdAt, r.sentAt, r.channel, r.sent, r.success, r.fail, r.pending, r.rate, r.sender]
      .map(csvEscape).join(',')
  );
  return BOM + CSV_HEADERS.join(',') + (lines.length ? '\n' + lines.join('\n') : '');
}
