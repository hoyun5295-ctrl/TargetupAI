/**
 * campaign-list-csv.ts — 발송결과 채널통합조회(요약 탭) CSV 빌더 컨트롤타워
 *
 * 고객사 발송결과 모달에서 기간 조회한 캠페인 목록을 엑셀(CSV)로 내보낼 때 사용.
 * 비즈웹 레거시 엑셀 형식 정합: 메시지내용/등록일시/발송일시/채널/전송건수/성공/실패/대기/성공률/발송자.
 * DB import 0 — 순수 함수(ts-node verify로 TDD). billing-types도 순수 파일이라 이 성질이 유지된다.
 */

import { isBrandOnlyChannel, billingTypeLabelOf } from './billing-types';
import { brandTargetingLabel, type KakaoFallbackCount } from './sms-result-map';

/** 캠페인 채널 라벨 (이모지 제거 순수 텍스트). 화면 channelChip과 같은 판정. */
export function channelPlainLabel(sendChannel: string | null | undefined, messageType: string | null | undefined, kakaoTargeting?: string | null): string {
  // ★ 2026-07-31 판정을 CT로. 전에는 채널값 'kakao' 하나만 비교해서 전용 발송이 쓰는 'kakao_brand'가
  //   안 걸리고 message_type('LMS')으로 흘러내렸다 — 브랜드메시지가 엑셀에 LMS로 찍히던 원인이다.
  //   라벨 '카카오'도 폐지된 이름이라 '브랜드메시지'로 바로잡는다(친구톡 폐지 후 실체가 그것이다).
  // ★ 2026-11-05 C107 D-11 — 캠페인 한 건의 이름 = 청구 유형 이름(친구 · 비친구 · sms-result-map brandAudienceLabel 한 곳).
  //   대상값 인자를 넘기지 않으면(undefined) 채널 단위 묶음 = 「브랜드메시지」(next-action-advisor mergeByChannelLabel · 대상 축 없음).
  //   DB 의 빈 대상값(null)은 넘긴 값이다 = 비친구(청구와 같은 판정).
  // ★ 2026-11-08 C117 D9(Harold H1) — 이름 = 고른 대상(sms-result-map brandTargetingLabel 한 곳 · 옛 청구 이름 폐기 · 위 C107 줄은 경위)
  if (isBrandOnlyChannel(sendChannel)) return kakaoTargeting === undefined ? '브랜드메시지' : brandTargetingLabel(kakaoTargeting);
  if (sendChannel === 'alimtalk') return '알림톡';
  if (sendChannel === 'both') return 'SMS+브랜드메시지';
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

/** 메시지내용의 줄바꿈을 공백 1개로 눌러 한 줄로 — 엑셀 셀 내부 개행(행 폭발) 방지. 비즈웹 엑셀 정합. */
const oneLine = (s: unknown): string => String(s ?? '').replace(/[\r\n]+/g, ' ').trim();

/** 캠페인 행 배열 → CSV 문자열(BOM 포함, 엑셀 한글 깨짐 방지). 빈 배열이면 헤더만. */
export function buildCampaignListCsv(rows: CampaignCsvRow[]): string {
  const BOM = '﻿';
  const lines = rows.map(r =>
    [oneLine(r.message), r.createdAt, r.sentAt, r.channel, r.sent, r.success, r.fail, r.pending, r.rate, r.sender]
      .map(csvEscape).join(',')
  );
  return BOM + CSV_HEADERS.join(',') + (lines.length ? '\n' + lines.join('\n') : '');
}

/**
 * ★ 2026-11-05 C107 D-10 — 알림톡 · 브랜드 전용 캠페인의 CSV 줄 = 머리 줄(카카오 시도 수) + 대체 줄(LMS(대체발송) · SMS(대체발송) · 0 이면 없음).
 *   화면 목록(ResultsModal 아랫줄)과 같은 줄 구성 · 대체 줄 이름 = 청구 유형 이름(정산서와 같은 글자).
 *   split 이 없으면(조회 실패 · 분리 대상 아님) 머리 줄 하나 = 종전.
 */
export function kakaoSplitCsvRows(head: CampaignCsvRow, split: KakaoFallbackCount | null | undefined): CampaignCsvRow[] {
  if (!split) return [head];
  const rate = (s: number, t: number) => (t > 0 ? Math.round((s / t) * 1000) / 10 : 0);
  const rows: CampaignCsvRow[] = [{ ...head, sent: split.total, success: split.success, fail: split.fail, pending: split.pending, rate: rate(split.success, split.total) }];
  for (const [type, key] of [['LMS', 'LMS_FB'], ['SMS', 'SMS_FB']] as const) {
    const f = split.fallback[type];
    if (!f || f.total <= 0) continue;
    rows.push({ ...head, message: '', channel: `↳ ${billingTypeLabelOf(key)}`, sent: f.total, success: f.success, fail: f.fail, pending: f.pending, rate: rate(f.success, f.total) });
  }
  return rows;
}
