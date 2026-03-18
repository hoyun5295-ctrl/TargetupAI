/**
 * CT-09: 스팸 테스트 큐 컨트롤타워
 *
 * 역할: 스팸필터 테스트 큐 등록 + 순차 실행의 유일한 진입점
 * 원칙: 테스트폰에 동시에 1건만 발송 → 매칭 정확도 100% 보장
 *
 * 사용처:
 *   - routes/spam-filter.ts (수동 테스트)
 *   - routes/ai.ts (AI 자동 테스트 + 재생성)
 *   - app.ts (큐 워커 시작)
 *
 * D78: 프로 요금제 자동 스팸검사 기능
 */

import { createHash } from 'crypto';
import { mysqlQuery, query } from '../config/database';
import { TIMEOUTS } from '../config/defaults';
import { extractVarCatalog } from '../services/ai';
import { replaceVariables, enrichWithCustomFields } from '../utils/messageUtils';
import { SUCCESS_CODES, PENDING_CODES, SPAM_RESULT } from '../utils/sms-result-map';
import { prepaidDeduct } from '../utils/prepaid';

// ============================================================
// 상수
// ============================================================
const QUEUE_POLL_INTERVAL_MS = 3000; // 큐 워커 체크 주기 (3초)
const MANUAL_GRACE_MS = 10000;       // 수동 테스트: QTmsg 성공 후 앱 리포트 대기 (10초)
const AUTO_GRACE_MS = 20000;         // 자동 테스트: QTmsg 성공 후 앱 리포트 대기 (20초, 오탐 방지)
const RESULT_POLL_INTERVAL_MS = 5000; // 결과 폴링 주기 (5초)
const MAX_REGENERATE_RETRIES = 2;    // 스팸 차단 시 최대 재생성 횟수

// ============================================================
// 인터페이스
// ============================================================
export interface SpamTestEnqueueParams {
  companyId: string;
  userId: string;
  callbackNumber: string;
  messageContentSms?: string;
  messageContentLms?: string;
  messageType: 'SMS' | 'LMS' | 'MMS';
  subject?: string;
  firstRecipient?: Record<string, any>;
  source: 'manual' | 'auto_ai';
  variantId?: string;
  batchId?: string;
  skipPrepaid?: boolean;
}

export interface SpamTestEnqueueResult {
  ok: boolean;
  testId?: string;
  error?: string;
  errorCode?: string;
  insufficientBalance?: boolean;
  balance?: number;
  requiredAmount?: number;
}

export interface SpamTestBatchResult {
  batchId: string;
  completed: boolean;
  variants: Array<{
    variantId: string;
    testId: string;
    status: string;
    overallResult: 'pass' | 'blocked' | 'failed' | 'timeout' | 'pending';
    carrierResults: Array<{
      carrier: string;
      messageType: string;
      result: string | null;
    }>;
  }>;
}

export interface AutoSpamTestVariant {
  variantId: string;
  messageText: string;
  subject?: string;
}

export interface AutoSpamTestResult {
  batchId: string;
  variants: Array<{
    variantId: string;
    messageText: string;
    subject?: string;
    spamResult: 'pass' | 'blocked' | 'failed' | 'timeout';
    carrierResults: Array<{
      carrier: string;
      messageType: string;
      result: string;
    }>;
    regenerated: boolean;
    regenerateCount: number;
  }>;
  totalTestCount: number;
  totalRegenerateCount: number;
}

// ============================================================
// 헬퍼: 메시지 해시
// ============================================================
export function normalizeContent(s: string): string {
  return (s || '').replace(/[\s\r\n]+/g, '');
}

export function computeMessageHash(content: string): string {
  const normalized = normalizeContent(content);
  if (!normalized) return '';
  return createHash('sha256').update(normalized, 'utf8').digest('hex').substring(0, 16);
}

// ============================================================
// 헬퍼: QTmsg 테스트 테이블명
// ============================================================
function getTestSmsTable(): string {
  const allTables = (process.env.SMS_TABLES || 'SMSQ_SEND').split(',').map(t => t.trim());
  return allTables.find(t => t === 'SMSQ_SEND_10') || allTables[allTables.length - 1];
}

// ============================================================
// 헬퍼: QTmsg INSERT
// ============================================================
async function insertSmsQueue(
  destNo: string,
  callBack: string,
  content: string,
  msgType: string,
  testId: string,
  subject: string
): Promise<void> {
  const testTable = getTestSmsTable();
  const mType = msgType === 'SMS' ? 'S' : 'L';
  await mysqlQuery(
    `INSERT INTO ${testTable} (
      dest_no, call_back, msg_contents, msg_type, title_str, sendreq_time, status_code, rsv1, app_etc1
    ) VALUES (?, ?, ?, ?, ?, NOW(), 100, '1', ?)`,
    [destNo, callBack, content, mType, subject || '', testId]
  );
}

// ============================================================
// [1] 큐에 스팸 테스트 등록
// ============================================================
export async function enqueueSpamTest(params: SpamTestEnqueueParams): Promise<SpamTestEnqueueResult> {
  const {
    companyId, userId, callbackNumber,
    messageContentSms, messageContentLms, messageType, subject,
    firstRecipient: clientFirstRecipient,
    source = 'manual', variantId, batchId, skipPrepaid = false,
  } = params;

  try {
    // 1) 메시지 해시 계산 (변수 치환 후)
    const isLmsType = messageType === 'LMS' || messageType === 'MMS';
    const rawContent = isLmsType ? (messageContentLms || '') : (messageContentSms || '');

    const companySchemaResult = await query('SELECT customer_schema FROM companies WHERE id = $1', [companyId]);
    const fieldMappings = extractVarCatalog(companySchemaResult.rows[0]?.customer_schema).fieldMappings;
    await enrichWithCustomFields(fieldMappings, companyId);

    let firstCustomer: Record<string, any>;
    if (clientFirstRecipient && typeof clientFirstRecipient === 'object' && Object.keys(clientFirstRecipient).length > 0) {
      firstCustomer = clientFirstRecipient;
    } else {
      const mappingCols = Object.values(fieldMappings).filter((m: any) => m.storageType !== 'custom_fields').map((m: any) => m.column);
      const selectCols = [...new Set(['phone', 'custom_fields', ...mappingCols])].join(', ');
      // ★ 미리보기와 동일한 정렬 (name ASC) — recommend-target의 샘플 고객과 일치 보장
      const firstResult = await query(
        `SELECT ${selectCols} FROM customers WHERE company_id = $1 AND is_active = true AND sms_opt_in = true ORDER BY name ASC NULLS LAST LIMIT 1`,
        [companyId]
      );
      firstCustomer = firstResult.rows[0] || {};
    }

    const personalizedForHash = replaceVariables(rawContent, firstCustomer, fieldMappings);
    const messageHash = computeMessageHash(personalizedForHash);

    // 2) 디바이스 조회 + 발송 건수 계산
    const devices = await query(
      `SELECT id, carrier, phone FROM spam_filter_devices WHERE is_active = true ORDER BY carrier`
    );
    if (devices.rows.length === 0) {
      return { ok: false, error: '등록된 테스트폰이 없습니다. 관리자에게 문의하세요.' };
    }

    const messageTypes: string[] = [];
    if (isLmsType) {
      if (messageContentLms) messageTypes.push('LMS');
    } else {
      if (messageContentSms) messageTypes.push('SMS');
    }
    const sendCount = devices.rows.length * messageTypes.length;
    const deductType = messageTypes[0] || 'SMS';

    // 2-1) 고객사 080 수신거부번호 조회 (users 우선 → companies fallback)
    const opt080Result = await query(
      `SELECT u.opt_out_080_number AS user_080, c.opt_out_080_number AS company_080
       FROM users u JOIN companies c ON u.company_id = c.id
       WHERE u.id = $1`,
      [userId]
    );
    const spamCheckNumber = opt080Result.rows[0]?.user_080 || opt080Result.rows[0]?.company_080 || null;

    // 3) 테스트 레코드 생성 (status = 'queued')
    const testResult = await query(
      `INSERT INTO spam_filter_tests
       (company_id, user_id, callback_number, message_content_sms, message_content_lms,
        message_hash, spam_check_number, status, source, variant_id, batch_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued', $8, $9, $10)
       RETURNING id, created_at`,
      [companyId, userId, callbackNumber,
       messageContentSms || null, messageContentLms || null,
       messageHash || null, spamCheckNumber,
       source, variantId || null, batchId || null]
    );
    const testId = testResult.rows[0].id;

    // 4) 선불 차감 (skipPrepaid가 아닐 때만)
    if (!skipPrepaid) {
      const deduct = await prepaidDeduct(companyId, sendCount, deductType, testId);
      if (!deduct.ok) {
        await query(`UPDATE spam_filter_tests SET status = 'completed', completed_at = NOW() WHERE id = $1`, [testId]);
        return {
          ok: false,
          error: deduct.error,
          errorCode: 'INSUFFICIENT_BALANCE',
          insufficientBalance: true,
          balance: deduct.balance,
          requiredAmount: deduct.amount,
        };
      }
    }

    // 5) test_results 행 미리 생성
    for (const device of devices.rows) {
      for (const msgType of messageTypes) {
        await query(
          `INSERT INTO spam_filter_test_results (test_id, carrier, message_type, phone)
           VALUES ($1, $2, $3, $4)`,
          [testId, device.carrier, msgType, device.phone]
        );
      }
    }

    console.log(`[SpamTestQueue] 큐 등록 — testId=${testId}, source=${source}, variant=${variantId || '-'}, batch=${batchId || '-'}`);

    return { ok: true, testId };
  } catch (err) {
    console.error('[SpamTestQueue] 큐 등록 오류:', err);
    return { ok: false, error: '스팸 테스트 큐 등록 중 오류가 발생했습니다.' };
  }
}

// ============================================================
// [2] 큐 워커: 다음 건 실행
// ============================================================
let queueWorkerRunning = false;

export async function processSpamTestQueue(): Promise<void> {
  if (queueWorkerRunning) return; // 중복 실행 방지
  queueWorkerRunning = true;

  try {
    // 현재 active인 테스트가 있는지 확인
    const activeTest = await query(
      `SELECT id FROM spam_filter_tests WHERE status = 'active' LIMIT 1`
    );
    if (activeTest.rows.length > 0) {
      return; // 실행 중인 테스트 있음 → 대기
    }

    // stale 정리: 타임아웃 초과한 active 건 → completed
    const staleTests = await query(
      `SELECT id FROM spam_filter_tests
       WHERE status = 'active' AND created_at < NOW() - INTERVAL '${Math.ceil(TIMEOUTS.spamFilterSafety / 1000)} seconds'`
    );
    if (staleTests.rows.length > 0) {
      const staleIds = staleTests.rows.map((r: any) => r.id);
      await query(
        `UPDATE spam_filter_test_results SET result = $2
         WHERE test_id = ANY($1::uuid[]) AND received = false AND result IS NULL`,
        [staleIds, SPAM_RESULT.TIMEOUT]
      );
      await query(
        `UPDATE spam_filter_tests SET status = 'completed', completed_at = NOW()
         WHERE id = ANY($1::uuid[])`,
        [staleIds]
      );
      console.log(`[SpamTestQueue] stale 테스트 ${staleIds.length}건 자동 정리`);
    }

    // 다음 queued 건 조회 (FIFO)
    const nextTest = await query(
      `SELECT id, company_id, user_id, callback_number,
              message_content_sms, message_content_lms, source
       FROM spam_filter_tests
       WHERE status = 'queued'
       ORDER BY created_at ASC
       LIMIT 1`
    );
    if (nextTest.rows.length === 0) return; // 큐 비어있음

    const test = nextTest.rows[0];

    // active로 전환
    await query(
      `UPDATE spam_filter_tests SET status = 'active' WHERE id = $1`,
      [test.id]
    );

    console.log(`[SpamTestQueue] 테스트 실행 시작 — testId=${test.id}, source=${test.source}`);

    // 테스트 실행
    await executeSpamTest(test.id, test.source === 'auto_ai');
  } catch (err) {
    console.error('[SpamTestQueue] 큐 워커 오류:', err);
  } finally {
    queueWorkerRunning = false;
  }
}

// ============================================================
// [3] 테스트 실행: QTmsg INSERT + 폴링
// ============================================================
async function executeSpamTest(testId: string, isAuto: boolean): Promise<void> {
  try {
    // 테스트 정보 조회
    const testInfo = await query(
      `SELECT t.*, c.customer_schema
       FROM spam_filter_tests t
       JOIN companies c ON c.id = t.company_id
       WHERE t.id = $1`,
      [testId]
    );
    if (testInfo.rows.length === 0) return;
    const test = testInfo.rows[0];

    // 필드 매핑 + 첫 고객 조회
    const fieldMappings = extractVarCatalog(test.customer_schema).fieldMappings;
    await enrichWithCustomFields(fieldMappings, test.company_id);

    const mappingCols = Object.values(fieldMappings).filter((m: any) => m.storageType !== 'custom_fields').map((m: any) => m.column);
    const selectCols = [...new Set(['phone', 'custom_fields', ...mappingCols])].join(', ');
    const firstResult = await query(
      `SELECT ${selectCols} FROM customers WHERE company_id = $1 AND is_active = true AND sms_opt_in = true ORDER BY created_at DESC LIMIT 1`,
      [test.company_id]
    );
    const firstCustomer = firstResult.rows[0] || {};

    // 미발송 결과 행 조회
    const resultRows = await query(
      `SELECT id, carrier, message_type, phone FROM spam_filter_test_results WHERE test_id = $1`,
      [testId]
    );

    // QTmsg INSERT
    for (const row of resultRows.rows) {
      const rawContent = row.message_type === 'SMS' ? test.message_content_sms : test.message_content_lms;
      const content = replaceVariables(rawContent || '', firstCustomer, fieldMappings);
      const titleStr = (row.message_type === 'LMS' || row.message_type === 'MMS') ? (test.subject || '') : '';
      await insertSmsQueue(row.phone, test.callback_number, content, row.message_type, testId, titleStr);
    }

    // grace period 결정
    const graceMs = isAuto ? AUTO_GRACE_MS : MANUAL_GRACE_MS;
    const qtmsgSuccessTime = new Map<string, number>();

    // 폴링 시작
    const pollInterval = setInterval(async () => {
      try {
        // active 확인
        const activeCheck = await query(
          `SELECT id, created_at FROM spam_filter_tests WHERE id = $1 AND status = 'active'`,
          [testId]
        );
        if (activeCheck.rows.length === 0) {
          clearInterval(pollInterval);
          return;
        }

        // 미수신 건 조회
        const unreceived = await query(
          `SELECT id, phone, message_type FROM spam_filter_test_results
           WHERE test_id = $1 AND received = false AND result IS NULL`,
          [testId]
        );

        if (unreceived.rows.length === 0) {
          clearInterval(pollInterval);
          await query(
            `UPDATE spam_filter_tests SET status = 'completed', completed_at = NOW()
             WHERE id = $1 AND status = 'active'`,
            [testId]
          );
          return;
        }

        // QTmsg 결과 조회
        const testTable = getTestSmsTable();
        const now2 = new Date();
        const yyyymm = `${now2.getFullYear()}${String(now2.getMonth() + 1).padStart(2, '0')}`;
        const logTable = `${testTable}_${yyyymm}`;

        let mqRows: any[] = [];
        const mqCurrent = await mysqlQuery(
          `SELECT dest_no, msg_type, status_code FROM ${testTable} WHERE app_etc1 = ?`,
          [testId]
        ) as any[];
        if (mqCurrent && mqCurrent.length > 0) mqRows = mqCurrent;

        try {
          const mqLog = await mysqlQuery(
            `SELECT dest_no, msg_type, status_code FROM ${logTable} WHERE app_etc1 = ?`,
            [testId]
          ) as any[];
          if (mqLog && mqLog.length > 0) mqRows = [...mqRows, ...mqLog];
        } catch (e) { /* 로그 테이블 미존재 시 무시 */ }

        for (const row of unreceived.rows) {
          const mType = row.message_type === 'SMS' ? 'S' : 'L';
          const mqMatch = mqRows.find(
            (m: any) => m.dest_no === row.phone && m.msg_type === mType
          );
          if (!mqMatch) continue;

          const sc = Number(mqMatch.status_code);
          let result: string | null = null;

          if (SUCCESS_CODES.includes(sc)) {
            const rowKey = row.id;
            if (!qtmsgSuccessTime.has(rowKey)) {
              qtmsgSuccessTime.set(rowKey, Date.now());
              result = null;
            } else if (Date.now() - qtmsgSuccessTime.get(rowKey)! >= graceMs) {
              result = SPAM_RESULT.BLOCKED;
              console.log(`[SpamTestQueue] BLOCKED — testId=${testId}, phone=${row.phone}, grace=${graceMs}ms`);
            } else {
              result = null;
            }
          } else if (PENDING_CODES.includes(sc)) {
            result = null;
          } else {
            result = SPAM_RESULT.FAILED;
          }

          if (result) {
            await query(
              `UPDATE spam_filter_test_results SET result = $1 WHERE id = $2`,
              [result, row.id]
            );
          }
        }

        // 전부 처리 확인
        const remaining = await query(
          `SELECT id FROM spam_filter_test_results
           WHERE test_id = $1 AND received = false AND result IS NULL`,
          [testId]
        );
        if (remaining.rows.length === 0) {
          clearInterval(pollInterval);
          await query(
            `UPDATE spam_filter_tests SET status = 'completed', completed_at = NOW()
             WHERE id = $1 AND status = 'active'`,
            [testId]
          );
          return;
        }

        // 타임아웃 체크
        const elapsed = Date.now() - new Date(activeCheck.rows[0].created_at).getTime();
        if (elapsed > TIMEOUTS.spamFilterTest) {
          clearInterval(pollInterval);
          for (const row of remaining.rows) {
            const rowKey = row.id;
            const finalResult = qtmsgSuccessTime.has(rowKey) ? SPAM_RESULT.BLOCKED : SPAM_RESULT.TIMEOUT;
            await query(
              `UPDATE spam_filter_test_results SET result = $1 WHERE id = $2`,
              [finalResult, row.id]
            );
          }
          await query(
            `UPDATE spam_filter_tests SET status = 'completed', completed_at = NOW()
             WHERE id = $1 AND status = 'active'`,
            [testId]
          );
        }
      } catch (err) {
        console.error('[SpamTestQueue] 폴링 오류:', err);
      }
    }, RESULT_POLL_INTERVAL_MS);

    // 안전장치 타임아웃
    setTimeout(() => { clearInterval(pollInterval); }, TIMEOUTS.spamFilterSafety);

  } catch (err) {
    console.error('[SpamTestQueue] 테스트 실행 오류:', err);
    // 실패 시 completed 처리
    await query(
      `UPDATE spam_filter_tests SET status = 'completed', completed_at = NOW() WHERE id = $1`,
      [testId]
    );
  }
}

// ============================================================
// [4] 배치 결과 조회
// ============================================================
export async function getSpamTestBatchResults(batchId: string): Promise<SpamTestBatchResult> {
  const tests = await query(
    `SELECT id, variant_id, status FROM spam_filter_tests
     WHERE batch_id = $1 ORDER BY variant_id`,
    [batchId]
  );

  const variants: SpamTestBatchResult['variants'] = [];
  let allCompleted = true;

  for (const test of tests.rows) {
    const results = await query(
      `SELECT carrier, message_type, result FROM spam_filter_test_results
       WHERE test_id = $1 ORDER BY carrier, message_type`,
      [test.id]
    );

    const carrierResults = results.rows.map((r: any) => ({
      carrier: r.carrier,
      messageType: r.message_type,
      result: r.result,
    }));

    // 전체 결과 판정
    let overallResult: 'pass' | 'blocked' | 'failed' | 'timeout' | 'pending' = 'pending';
    if (test.status === 'completed' || test.status === 'active') {
      const allResults = carrierResults.map(r => r.result).filter(Boolean);
      if (allResults.length === 0) {
        overallResult = 'pending';
      } else if (allResults.some(r => r === SPAM_RESULT.BLOCKED)) {
        overallResult = 'blocked';
      } else if (allResults.some(r => r === SPAM_RESULT.FAILED)) {
        overallResult = 'failed';
      } else if (allResults.some(r => r === SPAM_RESULT.TIMEOUT)) {
        overallResult = 'timeout';
      } else if (allResults.every(r => r === SPAM_RESULT.PASS)) {
        overallResult = 'pass';
      }
    }

    if (test.status !== 'completed') allCompleted = false;

    variants.push({
      variantId: test.variant_id,
      testId: test.id,
      status: test.status,
      overallResult,
      carrierResults,
    });
  }

  return {
    batchId,
    completed: allCompleted,
    variants,
  };
}

// ============================================================
// [5] 테스트 완료 대기 (Promise 기반)
// ============================================================
async function waitForTestCompletion(testId: string, timeoutMs: number = TIMEOUTS.spamFilterSafety): Promise<string> {
  const startTime = Date.now();
  return new Promise((resolve) => {
    const checkInterval = setInterval(async () => {
      try {
        const test = await query(
          `SELECT status FROM spam_filter_tests WHERE id = $1`,
          [testId]
        );
        if (test.rows[0]?.status === 'completed') {
          clearInterval(checkInterval);

          // 전체 결과 판정
          const results = await query(
            `SELECT result FROM spam_filter_test_results WHERE test_id = $1`,
            [testId]
          );
          const allResults = results.rows.map((r: any) => r.result).filter(Boolean);
          if (allResults.some(r => r === SPAM_RESULT.BLOCKED)) {
            resolve('blocked');
          } else if (allResults.some(r => r === SPAM_RESULT.FAILED)) {
            resolve('failed');
          } else if (allResults.some(r => r === SPAM_RESULT.TIMEOUT)) {
            resolve('timeout');
          } else {
            resolve('pass');
          }
          return;
        }

        if (Date.now() - startTime > timeoutMs) {
          clearInterval(checkInterval);
          resolve('timeout');
        }
      } catch (err) {
        console.error('[SpamTestQueue] 완료 대기 오류:', err);
      }
    }, 2000); // 2초마다 확인
  });
}

// ============================================================
// [6] 자동 스팸테스트 + 재생성 통합 (AI route에서 호출)
// ============================================================
export async function autoSpamTestWithRegenerate(params: {
  companyId: string;
  userId: string;
  callbackNumber: string;
  messageType: 'SMS' | 'LMS' | 'MMS';
  subject?: string;
  variants: AutoSpamTestVariant[];
  isAd: boolean;
  rejectNumber?: string;
  firstRecipient?: Record<string, any>;
  regenerateCallback?: (blockedVariantId: string) => Promise<{ messageText: string; subject?: string } | null>;
  maxRetries?: number;
}): Promise<AutoSpamTestResult> {
  const {
    companyId, userId, callbackNumber, messageType, subject,
    variants, isAd, rejectNumber, firstRecipient,
    regenerateCallback, maxRetries = MAX_REGENERATE_RETRIES,
  } = params;

  const batchId = crypto.randomUUID();
  const isLmsType = messageType === 'LMS' || messageType === 'MMS';

  const resultVariants: AutoSpamTestResult['variants'] = [];
  let totalTestCount = 0;
  let totalRegenerateCount = 0;

  for (const variant of variants) {
    let currentMessage = variant.messageText;
    let currentSubject = variant.subject || subject;
    let regenerateCount = 0;
    let spamResult: string = 'pending';
    let carrierResults: Array<{ carrier: string; messageType: string; result: string }> = [];

    // 최대 재시도 횟수까지 반복
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // 메시지 내용 구성
      const smsContent = !isLmsType ? currentMessage : undefined;
      const lmsContent = isLmsType ? currentMessage : undefined;

      // 큐에 등록
      const enqueueResult = await enqueueSpamTest({
        companyId,
        userId,
        callbackNumber,
        messageContentSms: smsContent,
        messageContentLms: lmsContent,
        messageType,
        subject: currentSubject,
        firstRecipient,
        source: 'auto_ai',
        variantId: variant.variantId,
        batchId,
        skipPrepaid: true, // 프로 이상: 무료
      });

      if (!enqueueResult.ok) {
        console.error(`[SpamTestQueue] variant ${variant.variantId} 큐 등록 실패:`, enqueueResult.error);
        spamResult = 'failed';
        break;
      }

      totalTestCount++;

      // 테스트 완료 대기
      spamResult = await waitForTestCompletion(enqueueResult.testId!);

      // 결과 조회
      const results = await query(
        `SELECT carrier, message_type, result FROM spam_filter_test_results
         WHERE test_id = $1 ORDER BY carrier, message_type`,
        [enqueueResult.testId]
      );
      carrierResults = results.rows.map((r: any) => ({
        carrier: r.carrier,
        messageType: r.message_type,
        result: r.result || 'timeout',
      }));

      // 통과했으면 종료
      if (spamResult === 'pass') {
        break;
      }

      // 차단됐고 재생성 가능하면 재시도
      if (spamResult === 'blocked' && attempt < maxRetries && regenerateCallback) {
        console.log(`[SpamTestQueue] variant ${variant.variantId} 스팸 차단 → 재생성 시도 (${attempt + 1}/${maxRetries})`);
        const newMessage = await regenerateCallback(variant.variantId);
        if (newMessage) {
          currentMessage = newMessage.messageText;
          if (newMessage.subject) currentSubject = newMessage.subject;
          regenerateCount++;
          totalRegenerateCount++;
        } else {
          break; // 재생성 실패 → 현재 결과로 확정
        }
      } else {
        break; // 재시도 불가 또는 최대 횟수 초과
      }
    }

    resultVariants.push({
      variantId: variant.variantId,
      messageText: currentMessage,
      subject: currentSubject,
      spamResult: spamResult as any,
      carrierResults,
      regenerated: regenerateCount > 0,
      regenerateCount,
    });
  }

  return {
    batchId,
    variants: resultVariants,
    totalTestCount,
    totalRegenerateCount,
  };
}

// ============================================================
// [7] 큐 워커 시작 (app.ts에서 호출)
// ============================================================
let queueWorkerTimer: ReturnType<typeof setInterval> | null = null;

export function startSpamTestQueueWorker(): void {
  if (queueWorkerTimer) return; // 중복 시작 방지

  console.log(`[SpamTestQueue] 큐 워커 시작 (${QUEUE_POLL_INTERVAL_MS}ms 간격)`);

  queueWorkerTimer = setInterval(async () => {
    try {
      await processSpamTestQueue();
    } catch (err) {
      console.error('[SpamTestQueue] 큐 워커 예외:', err);
    }
  }, QUEUE_POLL_INTERVAL_MS);
}

export function stopSpamTestQueueWorker(): void {
  if (queueWorkerTimer) {
    clearInterval(queueWorkerTimer);
    queueWorkerTimer = null;
    console.log('[SpamTestQueue] 큐 워커 중지');
  }
}
