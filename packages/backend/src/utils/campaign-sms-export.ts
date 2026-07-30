/**
 * campaign-sms-export.ts — 캠페인 발송내역 CSV 스트리밍 (CT)
 *
 * ★ 2026-06-15: 사용자 발송결과 export(results.ts)와 슈퍼관리자 캠페인 상세 export(admin.ts)가
 *   동일 CSV 스트리밍을 공유하도록 추출(인라인 중복 금지 — routes에 같은 로직 복제 X).
 *   컬럼/발송일시 기준(sendreq_time = 발송요청·예약 시각, 버그1·3 정합)이 양쪽 100% 일치한다.
 *   호출부는 캠페인을 먼저 해석(권한·소속 확인)한 뒤 company_id/created_by/send_channel/created_at을
 *   넘겨 이 함수에 위임한다. (슈퍼관리자는 캠페인 소속 회사 기준, 사용자는 본인 회사 기준.)
 *
 * [S9-08] 30만건도 UNION ALL + 10,000건 청크 스트리밍 (OOM/타임아웃 차단).
 */
import { Response } from 'express';
import { mysqlQuery } from '../config/database';
import { getCompanySmsTablesWithLogs } from './sms-queue';
import { SUCCESS_CODES, PENDING_CODES, getQueueRowStatus, getSendTypeLabel, getCarrierLabel, getDisplayContents } from './sms-result-map';
import { BRAND_CAMPAIGN_CHANNELS } from './billing-types';

// ★ B10: 엑셀 2컬럼(전송요청/발송) — 수신확인 제거. mobsend_time은 UTC 저장이라 +9h (D98).
const SMS_EXPORT_FIELDS = `dest_no, call_back, msg_type, msg_contents, status_code, mob_company,
  sendreq_time,
  DATE_ADD(mobsend_time, INTERVAL 9 HOUR) AS mobsend_time,
  'sms' AS _channel, NULL AS report_code_raw, IFNULL(k_oriseq, 0) AS k_oriseq,
  (sendreq_time > NOW()) AS is_future`;

/**
 * ★ D98: CSV 날짜 포맷 YYYY-MM-DD HH:mm:ss
 * MySQL DATETIME → JS Date → .toString()의 "Mon Mar 23 ..." 방지.
 */
function formatCsvDateTime(val: any): string {
  if (!val) return '';
  const d = val instanceof Date ? val : new Date(val);
  if (isNaN(d.getTime())) return String(val);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

export interface CampaignSmsCsvParams {
  campaignId: string;
  companyId: string;        // 캠페인 소속 회사 (사용자=본인 회사 / 슈퍼관리자=캠페인 회사)
  userId?: string | null;   // 라인그룹 해석용 (사용자=본인 / 슈퍼관리자=캠페인 created_by)
  sendChannel: string;      // 'sms' | 'kakao' | 'both' | 'alimtalk'
  campaignCreatedAt: any;   // 등록일시 (전 행 동일)
  exportStatus?: string;    // '' | 'success' | 'fail' | 'substitute' (화면 필터 그대로)
}

/**
 * 캠페인 발송내역을 CSV로 스트리밍한다(헤더 + 청크 본문 + res.end()까지 책임).
 * 호출부는 res를 더 쓰지 말 것(이 함수가 종료).
 */
export async function streamCampaignSmsCsv(res: Response, params: CampaignSmsCsvParams): Promise<void> {
  const { campaignId: id, companyId, userId, sendChannel, campaignCreatedAt } = params;
  const exportStatus = params.exportStatus || '';

  // ===== UNION ALL 서브쿼리 빌드 — 화면 필터(전체/성공/실패/대체) 그대로 =====
  const subqueries: string[] = [];
  const baseParams: any[] = [];

  let smsStatusWhere = '';
  if (exportStatus === 'success') smsStatusWhere = ` AND status_code IN (${SUCCESS_CODES.join(',')})`;
  else if (exportStatus === 'fail') smsStatusWhere = ` AND status_code NOT IN (${[...SUCCESS_CODES, ...PENDING_CODES].join(',')})`;
  else if (exportStatus === 'substitute') smsStatusWhere = ` AND k_oriseq > 0 AND msg_type IN ('L', 'S')`;

  // ★ 알림톡(alimtalk)도 SMSQ_SEND msg_type='K' 경로라 SMS 분기에 포함
  // ★ 2026-07-30: 브랜드(kakao·kakao_brand)도 SMSQ(msg_type='F') 합류 — 옛 IMC 서브쿼리 폐기.
  if (sendChannel === 'sms' || sendChannel === 'both' || sendChannel === 'alimtalk'
      || (BRAND_CAMPAIGN_CHANNELS as readonly string[]).includes(sendChannel)) {
    const exportTables = await getCompanySmsTablesWithLogs(companyId, userId || undefined);
    for (const t of exportTables) {
      subqueries.push(`(SELECT ${SMS_EXPORT_FIELDS} FROM ${t} WHERE app_etc1 = ?${smsStatusWhere})`);
      baseParams.push(id);
    }
  }

  // ===== CSV 헤더 스트리밍 시작 (웹 발송상세 UI와 컬럼명·순서 통일) =====
  const BOM = '﻿';
  const headers = '수신번호,회신번호,메시지내용,등록일시,발송일시,전송결과,결과코드,통신사,메시지유형';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename=send_detail_${id}.csv`);
  res.write(BOM + headers + '\n');

  if (subqueries.length === 0) { res.end(); return; }

  // ===== 10,000건씩 청크 스트리밍 =====
  // ★ D150-4: dest_no ASC tie-breaker — 동일 sendreq_time이 청크 경계에서 비결정적 분배되는 것 차단.
  const CHUNK_SIZE = 10000;
  const baseSql = subqueries.join(' UNION ALL ');
  let chunkOffset = 0;

  while (true) {
    const chunkParams = [...baseParams, CHUNK_SIZE, chunkOffset];
    const rows = await mysqlQuery(
      `${baseSql} ORDER BY sendreq_time ASC, dest_no ASC LIMIT ? OFFSET ?`,
      chunkParams,
    ) as any[];
    if (rows.length === 0) break;

    for (const m of rows) {
      // ★ 2026-07-30: 브랜드 행도 SMSQ 합류 — 라벨은 msg_type 축(getSendTypeLabel 'F'=브랜드메시지) 단일.
      // 발송 요청 시각이 미래인 대기 행 = "발송 예약" (화면 상세와 동일 산출)
      const rowStatus = getQueueRowStatus(Number(m.status_code), !!Number(m.is_future));
      const msgTypeDisplay = getSendTypeLabel(m.msg_type, m.k_oriseq);
      const statusDisplay = rowStatus.label;
      const carrierDisplay = rowStatus.type === 'scheduled' ? '-' : getCarrierLabel(m.mob_company);

      res.write([
        m.dest_no,
        m.call_back,
        `"${getDisplayContents(m.msg_type, m.msg_contents).replace(/"/g, '""')}"`,
        formatCsvDateTime(campaignCreatedAt), // 등록일시 = 캠페인 created_at (모든 행 동일)
        formatCsvDateTime(m.sendreq_time),    // 발송일시 = 발송요청/예약 시각(KST·D98) — 목록·상세와 동일 기준(D233+)
        statusDisplay,
        m.status_code,
        carrierDisplay,
        msgTypeDisplay,                       // 메시지유형 (SMS/LMS/MMS/카카오) — 엑셀 전용
      ].join(',') + '\n');
    }

    chunkOffset += rows.length;
    if (rows.length < CHUNK_SIZE) break;
  }

  res.end();
}
