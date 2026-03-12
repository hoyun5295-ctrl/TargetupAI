/**
 * ★ D69: 자동발송 PM2 워커
 *
 * 실행 방식: PM2 cron (매 시간 정각) 또는 app.ts 내부 setInterval
 * 역할: next_run_at이 도래한 active 자동캠페인을 찾아 발송 실행
 *
 * 기존 파이프라인 100% 재활용:
 * - customer-filter.ts → 타겟 필터링
 * - unsubscribe-helper.ts → 수신거부 제외
 * - sms-queue.ts → MySQL 큐 INSERT
 * - messageUtils.ts → 변수 치환
 * - prepaid.ts → 선불 차감
 *
 * 실패 정책: 스킵 + failed 기록 → next_run_at 다음 스케줄로 갱신 (중복 발송 방지)
 */

import { query, mysqlQuery } from '../config/database';
import { buildFilterQueryCompat } from './customer-filter';
import { replaceVariables } from './messageUtils';
import {
  toKoreaTimeStr,
  getCompanySmsTables, hasCompanyLineGroup, getNextSmsTable,
} from './sms-queue';
import { prepaidDeduct, prepaidRefund } from './prepaid';
import { normalizePhone } from './normalize-phone';
import { extractVarCatalog } from '../services/ai';
import { SEND_HOURS } from '../config/defaults';

// ============================================================
// next_run_at 계산 (auto-campaigns.ts와 동일 로직)
// ============================================================

function calcNextRunAt(scheduleType: string, scheduleDay: number | null, scheduleTime: string): Date {
  const now = new Date();
  const kstNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const [hours, minutes] = scheduleTime.split(':').map(Number);

  if (scheduleType === 'daily') {
    const today = new Date(kstNow);
    today.setHours(hours, minutes, 0, 0);
    if (today <= kstNow) {
      today.setDate(today.getDate() + 1);
    }
    return kstToUtc(today);
  }

  if (scheduleType === 'weekly') {
    const currentDay = kstNow.getDay();
    let daysUntil = (scheduleDay! - currentDay + 7) % 7;
    const target = new Date(kstNow);
    target.setDate(target.getDate() + daysUntil);
    target.setHours(hours, minutes, 0, 0);
    if (target <= kstNow) {
      target.setDate(target.getDate() + 7);
    }
    return kstToUtc(target);
  }

  if (scheduleType === 'monthly') {
    const target = new Date(kstNow);
    target.setDate(scheduleDay!);
    target.setHours(hours, minutes, 0, 0);
    if (target <= kstNow) {
      target.setMonth(target.getMonth() + 1);
    }
    return kstToUtc(target);
  }

  throw new Error(`Invalid schedule_type: ${scheduleType}`);
}

function kstToUtc(kstDate: Date): Date {
  return new Date(kstDate.getTime() - 9 * 60 * 60 * 1000);
}

// ============================================================
// 발송 시간대 체크
// ============================================================

function isWithinSendHours(): boolean {
  const now = new Date();
  const kstHour = parseInt(
    now.toLocaleString('en-US', { timeZone: 'Asia/Seoul', hour: '2-digit', hour12: false })
  );
  return kstHour >= SEND_HOURS.start && kstHour < SEND_HOURS.end;
}

// ============================================================
// 단건 자동캠페인 실행
// ============================================================

async function executeAutoCampaign(ac: any): Promise<void> {
  const logPrefix = `[auto-worker][${ac.id}][${ac.campaign_name}]`;

  try {
    console.log(`${logPrefix} 실행 시작`);

    // ★ 이중 실행 방지: status='active' AND next_run_at이 현재인 건만 원자적 잠금
    const lockResult = await query(
      `UPDATE auto_campaigns SET status = 'active', updated_at = NOW()
       WHERE id = $1 AND status = 'active' AND next_run_at <= NOW()
       RETURNING id`,
      [ac.id]
    );
    if (lockResult.rows.length === 0) {
      console.log(`${logPrefix} 이미 처리됨 (스킵)`);
      return;
    }

    // ★ 라인그룹 미설정 체크
    if (!(await hasCompanyLineGroup(ac.company_id))) {
      console.warn(`${logPrefix} 라인그룹 미설정 — 스킵`);
      await markFailed(ac, '발송 라인그룹 미설정');
      return;
    }

    // ★ 발송 시간대 체크 (회사별 send_start_hour/send_end_hour)
    if (!isWithinSendHours()) {
      console.warn(`${logPrefix} 발송 허용 시간 외 — 스킵`);
      await markFailed(ac, '발송 허용 시간 외');
      return;
    }

    const companyTables = await getCompanySmsTables(ac.company_id, ac.user_id);

    // 회사 스키마 조회 (변수 치환용)
    const companySchemaResult = await query(
      'SELECT customer_schema FROM companies WHERE id = $1',
      [ac.company_id]
    );
    const customerSchema = companySchemaResult.rows[0]?.customer_schema || {};
    const { fieldMappings } = extractVarCatalog(customerSchema);

    // 동적 SELECT 컬럼 구성
    const baseColumns = ['id', 'phone'];
    const mappingColumns = Object.values(fieldMappings).map((m: any) => m.column);
    const selectColumns = [...new Set([...baseColumns, ...mappingColumns])].join(', ');

    // ★ customer-filter로 타겟 필터링
    const filterResult = buildFilterQueryCompat(ac.target_filter, ac.company_id);

    // store_code 필터
    let storeFilter = '';
    const storeParams: any[] = [];
    if (ac.store_code) {
      storeFilter = ` AND c.store_code = $${filterResult.nextIndex}`;
      storeParams.push(ac.store_code);
    }

    // ★ 수신거부 필터 (user_id 기준 — B17-01 준수)
    const unsubParamIdx = filterResult.nextIndex + storeParams.length;
    const unsubFilter = ` AND NOT EXISTS (SELECT 1 FROM unsubscribes u WHERE u.user_id = $${unsubParamIdx} AND u.phone = c.phone)`;

    const customersResult = await query(
      `SELECT ${selectColumns} FROM customers c
       WHERE c.company_id = $1 AND c.is_active = true AND c.sms_opt_in = true
       ${filterResult.where}${storeFilter}${unsubFilter}`,
      [ac.company_id, ...filterResult.params, ...storeParams, ac.user_id]
    );

    const customers = customersResult.rows;

    if (customers.length === 0) {
      console.log(`${logPrefix} 타겟 고객 0명 — 스킵`);
      await markFailed(ac, '타겟 고객 없음 (필터 결과 0명)');
      return;
    }

    console.log(`${logPrefix} 타겟 ${customers.length}명`);

    // ★ campaign_runs에 run 기록 (run_number 계산)
    const runNumberResult = await query(
      `SELECT COALESCE(MAX(run_number), 0) + 1 as next_run FROM auto_campaign_runs WHERE auto_campaign_id = $1`,
      [ac.id]
    );
    const runNumber = runNumberResult.rows[0].next_run;

    // ★ campaigns 테이블에 연결 레코드 생성 (결과 추적용)
    const campaignResult = await query(
      `INSERT INTO campaigns (
        company_id, campaign_name, message_type, target_filter,
        message_content, subject, message_subject, message_template,
        is_ad, target_count, created_by, callback_number, status, send_type
      ) VALUES ($1, $2, $3, $4, $5, $6, $6, $5, $7, $8, $9, $10, 'sending', 'auto')
      RETURNING id`,
      [
        ac.company_id,
        `[자동] ${ac.campaign_name} #${runNumber}`,
        ac.message_type,
        JSON.stringify(ac.target_filter),
        ac.message_content,
        ac.message_subject || null,
        ac.is_ad ?? false,
        customers.length,
        ac.user_id,
        ac.callback_number,
      ]
    );
    const campaignId = campaignResult.rows[0].id;

    // auto_campaign_runs 기록
    const runResult = await query(
      `INSERT INTO auto_campaign_runs (
        auto_campaign_id, campaign_id, run_number, target_count, status, scheduled_at, started_at
      ) VALUES ($1, $2, $3, $4, 'sending', $5, NOW())
      RETURNING id`,
      [ac.id, campaignId, runNumber, customers.length, ac.next_run_at]
    );
    const runId = runResult.rows[0].id;

    // ★ 선불 차감 (prepaid.ts 재활용)
    const deduct = await prepaidDeduct(ac.company_id, customers.length, ac.message_type, campaignId);
    if (!deduct.ok) {
      console.warn(`${logPrefix} 잔액 부족 — ${deduct.error}`);
      await query(
        `UPDATE auto_campaign_runs SET status = 'failed', completed_at = NOW(), cancel_reason = $2 WHERE id = $1`,
        [runId, `잔액 부족: ${deduct.error}`]
      );
      await advanceNextRun(ac);
      return;
    }

    // ★ MySQL 큐 INSERT (campaigns.ts /:id/send 패턴 그대로)
    const sendTime = toKoreaTimeStr(new Date());
    const msgTypeCode = ac.message_type === 'SMS' ? 'S' : ac.message_type === 'LMS' ? 'L' : 'M';
    const mmsImages: string[] = [];  // 자동발송은 MMS 이미지 미지원 (MVP)

    let sentCount = 0;

    for (const customer of customers) {
      try {
        const personalizedMessage = replaceVariables(ac.message_content || '', customer, fieldMappings);
        const personalizedSubject = ac.message_subject || '';
        const cleanPhone = normalizePhone(customer.phone);
        const table = getNextSmsTable(companyTables);

        await mysqlQuery(
          `INSERT INTO ${table} (
            dest_no, call_back, msg_contents, msg_type, title_str,
            sendreq_time, status_code, rsv1, app_etc1, app_etc2,
            file_name1, file_name2, file_name3
          ) VALUES (?, ?, ?, ?, ?, ?, 100, '1', ?, ?, ?, ?, ?)`,
          [
            cleanPhone, ac.callback_number, personalizedMessage, msgTypeCode, personalizedSubject,
            sendTime, campaignId, ac.company_id,
            mmsImages[0] || '', mmsImages[1] || '', mmsImages[2] || '',
          ]
        );

        sentCount++;
      } catch (insertErr) {
        console.error(`${logPrefix} MySQL INSERT 실패 (phone: ${customer.phone}):`, insertErr);
      }
    }

    // ★ 부분 실패 시 실패분 환불
    const failCount = customers.length - sentCount;
    if (failCount > 0) {
      console.warn(`${logPrefix} 부분 실패 — 성공: ${sentCount}, 실패: ${failCount}`);
      try {
        await prepaidRefund(ac.company_id, failCount, ac.message_type, campaignId, `자동발송 부분실패 ${failCount}건 환불`);
      } catch (refundErr) {
        console.error(`${logPrefix} 부분 실패 환불 오류:`, refundErr);
      }
    }

    // ★ auto_campaign_runs 완료 처리
    await query(
      `UPDATE auto_campaign_runs SET
        sent_count = $2, success_count = $2, fail_count = $3,
        status = $4, completed_at = NOW()
       WHERE id = $1`,
      [runId, sentCount, failCount, sentCount === 0 ? 'failed' : 'completed']
    );

    // ★ campaigns 상태 업데이트
    await query(
      `UPDATE campaigns SET status = 'sending', sent_count = $2, sent_at = NOW() WHERE id = $1`,
      [campaignId, sentCount]
    );

    // ★ campaign_runs 연결 레코드 생성 (sync-results 호환)
    await query(
      `INSERT INTO campaign_runs (campaign_id, run_number, target_count, sent_count, status, sent_at)
       VALUES ($1, 1, $2, $3, 'sending', NOW())`,
      [campaignId, customers.length, sentCount]
    );

    // ★ auto_campaigns 통계 + next_run_at 갱신
    await advanceNextRun(ac, sentCount);

    console.log(`${logPrefix} 완료 — ${sentCount}/${customers.length}건 발송`);
  } catch (err: any) {
    console.error(`${logPrefix} 실행 중 에러:`, err);
    await markFailed(ac, `실행 에러: ${err.message || '알 수 없는 오류'}`);
  }
}

// ============================================================
// 헬퍼: 실패 처리 + next_run_at 갱신
// ============================================================

async function markFailed(ac: any, reason: string): Promise<void> {
  try {
    // auto_campaign_runs에 실패 기록
    const runNumberResult = await query(
      `SELECT COALESCE(MAX(run_number), 0) + 1 as next_run FROM auto_campaign_runs WHERE auto_campaign_id = $1`,
      [ac.id]
    );
    await query(
      `INSERT INTO auto_campaign_runs (auto_campaign_id, run_number, status, scheduled_at, completed_at, cancel_reason)
       VALUES ($1, $2, 'failed', $3, NOW(), $4)`,
      [ac.id, runNumberResult.rows[0].next_run, ac.next_run_at, reason]
    );
  } catch (err) {
    console.error(`[auto-worker][${ac.id}] 실패 기록 오류:`, err);
  }

  // next_run_at은 항상 다음 스케줄로 진행 (스킵 정책)
  await advanceNextRun(ac);
}

async function advanceNextRun(ac: any, sentCount?: number): Promise<void> {
  try {
    const scheduleTime = typeof ac.schedule_time === 'string'
      ? ac.schedule_time
      : `${String(ac.schedule_time.hours || 0).padStart(2, '0')}:${String(ac.schedule_time.minutes || 0).padStart(2, '0')}`;

    const nextRunAt = calcNextRunAt(ac.schedule_type, ac.schedule_day, scheduleTime);

    const updateFields = sentCount !== undefined
      ? `next_run_at = $2, last_run_at = NOW(), total_runs = total_runs + 1, total_sent = total_sent + $3, updated_at = NOW()`
      : `next_run_at = $2, updated_at = NOW()`;

    const params = sentCount !== undefined
      ? [ac.id, nextRunAt, sentCount]
      : [ac.id, nextRunAt];

    await query(`UPDATE auto_campaigns SET ${updateFields} WHERE id = $1`, params);
  } catch (err) {
    console.error(`[auto-worker][${ac.id}] next_run_at 갱신 오류:`, err);
  }
}

// ============================================================
// 메인 실행 함수 (외부에서 호출)
// ============================================================

export async function runAutoCampaignWorker(): Promise<void> {
  const logPrefix = '[auto-worker]';

  try {
    // status='active' AND next_run_at <= NOW() 인 건 조회
    const result = await query(
      `SELECT * FROM auto_campaigns
       WHERE status = 'active' AND next_run_at <= NOW()
       ORDER BY next_run_at ASC`
    );

    if (result.rows.length === 0) {
      return; // 도래한 건 없음 — 조용히 종료
    }

    console.log(`${logPrefix} ${result.rows.length}건 도래 — 실행 시작`);

    // 순차 실행 (병렬 X — 기간계 안정성)
    for (const ac of result.rows) {
      await executeAutoCampaign(ac);
    }

    console.log(`${logPrefix} 전체 실행 완료`);
  } catch (err: any) {
    console.error(`${logPrefix} 워커 에러:`, err);
  }
}

// ============================================================
// setInterval 기반 실행 (app.ts에서 호출)
// ============================================================

const WORKER_INTERVAL_MS = 60 * 60 * 1000; // 1시간

export function startAutoCampaignScheduler(): void {
  console.log('[auto-worker] 자동발송 스케줄러 시작 (매 1시간 체크)');

  // 기동 시 즉시 1회 실행
  runAutoCampaignWorker().catch(err => {
    console.error('[auto-worker] 초기 실행 에러:', err);
  });

  // 이후 매 1시간마다
  setInterval(() => {
    runAutoCampaignWorker().catch(err => {
      console.error('[auto-worker] 정기 실행 에러:', err);
    });
  }, WORKER_INTERVAL_MS);
}
