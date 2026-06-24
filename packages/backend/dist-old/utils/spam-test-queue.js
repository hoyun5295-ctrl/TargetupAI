"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeContent = normalizeContent;
exports.computeMessageHash = computeMessageHash;
exports.enqueueSpamTest = enqueueSpamTest;
exports.processSpamTestQueue = processSpamTestQueue;
exports.getSpamTestBatchResults = getSpamTestBatchResults;
exports.autoSpamTestWithRegenerate = autoSpamTestWithRegenerate;
exports.startSpamTestQueueWorker = startSpamTestQueueWorker;
exports.stopSpamTestQueueWorker = stopSpamTestQueueWorker;
const crypto_1 = require("crypto");
const database_1 = require("../config/database");
const defaults_1 = require("../config/defaults");
const ai_1 = require("../services/ai");
const messageUtils_1 = require("../utils/messageUtils");
const sms_queue_1 = require("./sms-queue");
const sms_result_map_1 = require("../utils/sms-result-map");
const prepaid_1 = require("../utils/prepaid");
// ============================================================
// 상수
// ============================================================
const QUEUE_POLL_INTERVAL_MS = 3000; // 큐 워커 체크 주기 (3초)
const MANUAL_GRACE_MS = 20000; // 수동 테스트: QTmsg 성공 후 앱 리포트 대기 (20초, KT 12~15초 소요 대응)
const AUTO_GRACE_MS = 25000; // 자동 테스트: QTmsg 성공 후 앱 리포트 대기 (25초, 오탐 방지)
const RESULT_POLL_INTERVAL_MS = 5000; // 결과 폴링 주기 (5초)
const MAX_REGENERATE_RETRIES = 2; // 스팸 차단 시 최대 재생성 횟수
// ============================================================
// 헬퍼: 메시지 해시
// ============================================================
function normalizeContent(s) {
    return (s || '').replace(/[\s\r\n]+/g, '');
}
function computeMessageHash(content) {
    const normalized = normalizeContent(content);
    if (!normalized)
        return '';
    return (0, crypto_1.createHash)('sha256').update(normalized, 'utf8').digest('hex').substring(0, 16);
}
// ★ D103: 인라인 getTestSmsTable/insertSmsQueue 삭제 → sms-queue.ts CT-04 컨트롤타워(getTestSmsTables, insertTestSmsQueue) 사용
// ============================================================
// [1] 큐에 스팸 테스트 등록
// ============================================================
async function enqueueSpamTest(params) {
    const { companyId, userId, callbackNumber, messageContentSms, messageContentLms, messageType, subject, firstRecipient: clientFirstRecipient, source = 'manual', variantId, batchId, skipPrepaid = false, } = params;
    try {
        // 1) 메시지 해시 계산 (변수 치환 후)
        const isLmsType = messageType === 'LMS' || messageType === 'MMS';
        const rawContent = isLmsType ? (messageContentLms || '') : (messageContentSms || '');
        // ★ D102: prepareFieldMappings 컨트롤타워로 통합
        const fieldMappings = await (0, messageUtils_1.prepareFieldMappings)(companyId);
        let firstCustomer;
        if (clientFirstRecipient && typeof clientFirstRecipient === 'object' && Object.keys(clientFirstRecipient).length > 0) {
            firstCustomer = clientFirstRecipient;
        }
        else {
            const mappingCols = Object.values(fieldMappings).filter((m) => m.storageType !== 'custom_fields').map((m) => m.column);
            const selectCols = [...new Set(['phone', 'custom_fields', ...mappingCols])].join(', ');
            // ★ 미리보기와 동일한 정렬 (name ASC) — recommend-target의 샘플 고객과 일치 보장
            const firstResult = await (0, database_1.query)(`SELECT ${selectCols} FROM customers WHERE company_id = $1 AND is_active = true AND sms_opt_in = true ORDER BY name ASC NULLS LAST LIMIT 1`, [companyId]);
            firstCustomer = firstResult.rows[0] || {};
        }
        // ★ D92: %회신번호% 치환 — callbackNumber를 addressBookFields로 전달하여 스팸테스트에서도 맵핑
        const spamAddressBookFields = callbackNumber ? { callback: callbackNumber, extra1: '', extra2: '', extra3: '', name: '' } : undefined;
        const personalizedForHash = (0, messageUtils_1.replaceVariables)(rawContent, firstCustomer, fieldMappings, spamAddressBookFields);
        const messageHash = computeMessageHash(personalizedForHash);
        // 2) 디바이스 조회 + 발송 건수 계산
        const devices = await (0, database_1.query)(`SELECT id, carrier, phone FROM spam_filter_devices WHERE is_active = true ORDER BY carrier`);
        if (devices.rows.length === 0) {
            return { ok: false, error: '등록된 테스트폰이 없습니다. 관리자에게 문의하세요.' };
        }
        const messageTypes = [];
        if (isLmsType) {
            if (messageContentLms)
                messageTypes.push('LMS');
        }
        else {
            if (messageContentSms)
                messageTypes.push('SMS');
        }
        const sendCount = devices.rows.length * messageTypes.length;
        const deductType = messageTypes[0] || 'SMS';
        // 2-1) 고객사 080 수신거부번호 조회 (users 우선 → companies fallback)
        const opt080Result = await (0, database_1.query)(`SELECT u.opt_out_080_number AS user_080, c.opt_out_080_number AS company_080
       FROM users u JOIN companies c ON u.company_id = c.id
       WHERE u.id = $1`, [userId]);
        const spamCheckNumber = opt080Result.rows[0]?.user_080 || opt080Result.rows[0]?.company_080 || null;
        // 3) 테스트 레코드 생성 (status = 'queued')
        const testResult = await (0, database_1.query)(`INSERT INTO spam_filter_tests
       (company_id, user_id, callback_number, message_content_sms, message_content_lms,
        message_hash, spam_check_number, status, source, variant_id, batch_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued', $8, $9, $10)
       RETURNING id, created_at`, [companyId, userId, callbackNumber,
            messageContentSms || null, messageContentLms || null,
            messageHash || null, spamCheckNumber,
            source, variantId || null, batchId || null]);
        const testId = testResult.rows[0].id;
        // 4) 선불 차감 (skipPrepaid가 아닐 때만)
        if (!skipPrepaid) {
            const deduct = await (0, prepaid_1.prepaidDeduct)(companyId, sendCount, deductType, testId, userId);
            if (!deduct.ok) {
                await (0, database_1.query)(`UPDATE spam_filter_tests SET status = 'completed', completed_at = NOW() WHERE id = $1`, [testId]);
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
                await (0, database_1.query)(`INSERT INTO spam_filter_test_results (test_id, carrier, message_type, phone)
           VALUES ($1, $2, $3, $4)`, [testId, device.carrier, msgType, device.phone]);
            }
        }
        console.log(`[SpamTestQueue] 큐 등록 — testId=${testId}, source=${source}, variant=${variantId || '-'}, batch=${batchId || '-'}`);
        return { ok: true, testId };
    }
    catch (err) {
        console.error('[SpamTestQueue] 큐 등록 오류:', err);
        return { ok: false, error: '스팸 테스트 큐 등록 중 오류가 발생했습니다.' };
    }
}
// ============================================================
// [2] 큐 워커: 다음 건 실행
// ============================================================
let queueWorkerRunning = false;
async function processSpamTestQueue() {
    if (queueWorkerRunning)
        return; // 중복 실행 방지
    queueWorkerRunning = true;
    try {
        // 현재 active인 테스트가 있는지 확인
        const activeTest = await (0, database_1.query)(`SELECT id FROM spam_filter_tests WHERE status = 'active' LIMIT 1`);
        if (activeTest.rows.length > 0) {
            return; // 실행 중인 테스트 있음 → 대기
        }
        // stale 정리: 타임아웃 초과한 active 건 → completed
        const staleTests = await (0, database_1.query)(`SELECT id FROM spam_filter_tests
       WHERE status = 'active' AND created_at < NOW() - INTERVAL '${Math.ceil(defaults_1.TIMEOUTS.spamFilterSafety / 1000)} seconds'`);
        if (staleTests.rows.length > 0) {
            const staleIds = staleTests.rows.map((r) => r.id);
            await (0, database_1.query)(`UPDATE spam_filter_test_results SET result = $2
         WHERE test_id = ANY($1::uuid[]) AND received = false AND result IS NULL`, [staleIds, sms_result_map_1.SPAM_RESULT.TIMEOUT]);
            await (0, database_1.query)(`UPDATE spam_filter_tests SET status = 'completed', completed_at = NOW()
         WHERE id = ANY($1::uuid[])`, [staleIds]);
            console.log(`[SpamTestQueue] stale 테스트 ${staleIds.length}건 자동 정리`);
        }
        // 다음 queued 건 조회 (FIFO)
        const nextTest = await (0, database_1.query)(`SELECT id, company_id, user_id, callback_number,
              message_content_sms, message_content_lms, source
       FROM spam_filter_tests
       WHERE status = 'queued'
       ORDER BY created_at ASC
       LIMIT 1`);
        if (nextTest.rows.length === 0)
            return; // 큐 비어있음
        const test = nextTest.rows[0];
        // active로 전환
        await (0, database_1.query)(`UPDATE spam_filter_tests SET status = 'active' WHERE id = $1`, [test.id]);
        console.log(`[SpamTestQueue] 테스트 실행 시작 — testId=${test.id}, source=${test.source}`);
        // 테스트 실행
        await executeSpamTest(test.id, test.source === 'auto_ai');
    }
    catch (err) {
        console.error('[SpamTestQueue] 큐 워커 오류:', err);
    }
    finally {
        queueWorkerRunning = false;
    }
}
// ============================================================
// [3] 테스트 실행: QTmsg INSERT + 폴링
// ============================================================
async function executeSpamTest(testId, isAuto) {
    try {
        // 테스트 정보 조회
        const testInfo = await (0, database_1.query)(`SELECT t.*, c.customer_schema
       FROM spam_filter_tests t
       JOIN companies c ON c.id = t.company_id
       WHERE t.id = $1`, [testId]);
        if (testInfo.rows.length === 0)
            return;
        const test = testInfo.rows[0];
        // 필드 매핑 + 첫 고객 조회
        const fieldMappings = (0, ai_1.extractVarCatalog)(test.customer_schema).fieldMappings;
        await (0, messageUtils_1.enrichWithCustomFields)(fieldMappings, test.company_id);
        const mappingCols = Object.values(fieldMappings).filter((m) => m.storageType !== 'custom_fields').map((m) => m.column);
        const selectCols = [...new Set(['phone', 'custom_fields', ...mappingCols])].join(', ');
        const firstResult = await (0, database_1.query)(`SELECT ${selectCols} FROM customers WHERE company_id = $1 AND is_active = true AND sms_opt_in = true ORDER BY created_at DESC LIMIT 1`, [test.company_id]);
        const firstCustomer = firstResult.rows[0] || {};
        // 미발송 결과 행 조회
        const resultRows = await (0, database_1.query)(`SELECT id, carrier, message_type, phone FROM spam_filter_test_results WHERE test_id = $1`, [testId]);
        // QTmsg INSERT
        for (const row of resultRows.rows) {
            const rawContent = row.message_type === 'SMS' ? test.message_content_sms : test.message_content_lms;
            // ★ D92: %회신번호% 치환 — 실제 스팸테스트 발송 시에도 callbackNumber 전달
            const testAddressBookFields = test.callback_number ? { callback: test.callback_number, extra1: '', extra2: '', extra3: '', name: '' } : undefined;
            const content = (0, messageUtils_1.replaceVariables)(rawContent || '', firstCustomer, fieldMappings, testAddressBookFields);
            const titleStr = (row.message_type === 'LMS' || row.message_type === 'MMS') ? (test.subject || '') : '';
            await (0, sms_queue_1.insertTestSmsQueue)(row.phone, test.callback_number, content, row.message_type, testId, titleStr);
        }
        // grace period 결정
        const graceMs = isAuto ? AUTO_GRACE_MS : MANUAL_GRACE_MS;
        const qtmsgSuccessTime = new Map();
        // 폴링 시작
        const pollInterval = setInterval(async () => {
            try {
                // active 확인
                const activeCheck = await (0, database_1.query)(`SELECT id, created_at FROM spam_filter_tests WHERE id = $1 AND status = 'active'`, [testId]);
                if (activeCheck.rows.length === 0) {
                    clearInterval(pollInterval);
                    return;
                }
                // 미수신 건 조회
                const unreceived = await (0, database_1.query)(`SELECT id, phone, message_type FROM spam_filter_test_results
           WHERE test_id = $1 AND received = false AND result IS NULL`, [testId]);
                if (unreceived.rows.length === 0) {
                    clearInterval(pollInterval);
                    await (0, database_1.query)(`UPDATE spam_filter_tests SET status = 'completed', completed_at = NOW()
             WHERE id = $1 AND status = 'active'`, [testId]);
                    return;
                }
                // QTmsg 결과 조회
                const testTable = (await (0, sms_queue_1.getTestSmsTables)())[0];
                const now2 = new Date();
                const yyyymm = `${now2.getFullYear()}${String(now2.getMonth() + 1).padStart(2, '0')}`;
                const logTable = `${testTable}_${yyyymm}`;
                let mqRows = [];
                const mqCurrent = await (0, database_1.mysqlQuery)(`SELECT dest_no, msg_type, status_code FROM ${testTable} WHERE app_etc1 = ?`, [testId]);
                if (mqCurrent && mqCurrent.length > 0)
                    mqRows = mqCurrent;
                try {
                    const mqLog = await (0, database_1.mysqlQuery)(`SELECT dest_no, msg_type, status_code FROM ${logTable} WHERE app_etc1 = ?`, [testId]);
                    if (mqLog && mqLog.length > 0)
                        mqRows = [...mqRows, ...mqLog];
                }
                catch (e) { /* 로그 테이블 미존재 시 무시 */ }
                for (const row of unreceived.rows) {
                    const mType = (0, sms_queue_1.toQtmsgType)(row.message_type);
                    const mqMatch = mqRows.find((m) => m.dest_no === row.phone && m.msg_type === mType);
                    if (!mqMatch)
                        continue;
                    const sc = Number(mqMatch.status_code);
                    let result = null;
                    if (sms_result_map_1.SUCCESS_CODES.includes(sc)) {
                        const rowKey = row.id;
                        if (!qtmsgSuccessTime.has(rowKey)) {
                            qtmsgSuccessTime.set(rowKey, Date.now());
                            result = null;
                        }
                        else if (Date.now() - qtmsgSuccessTime.get(rowKey) >= graceMs) {
                            result = sms_result_map_1.SPAM_RESULT.BLOCKED;
                            console.log(`[SpamTestQueue] BLOCKED — testId=${testId}, phone=${row.phone}, grace=${graceMs}ms`);
                        }
                        else {
                            result = null;
                        }
                    }
                    else if (sms_result_map_1.PENDING_CODES.includes(sc)) {
                        result = null;
                    }
                    else {
                        result = sms_result_map_1.SPAM_RESULT.FAILED;
                    }
                    if (result) {
                        await (0, database_1.query)(`UPDATE spam_filter_test_results SET result = $1 WHERE id = $2`, [result, row.id]);
                    }
                }
                // 전부 처리 확인
                const remaining = await (0, database_1.query)(`SELECT id FROM spam_filter_test_results
           WHERE test_id = $1 AND received = false AND result IS NULL`, [testId]);
                if (remaining.rows.length === 0) {
                    clearInterval(pollInterval);
                    await (0, database_1.query)(`UPDATE spam_filter_tests SET status = 'completed', completed_at = NOW()
             WHERE id = $1 AND status = 'active'`, [testId]);
                    return;
                }
                // 타임아웃 체크
                const elapsed = Date.now() - new Date(activeCheck.rows[0].created_at).getTime();
                if (elapsed > defaults_1.TIMEOUTS.spamFilterTest) {
                    clearInterval(pollInterval);
                    for (const row of remaining.rows) {
                        const rowKey = row.id;
                        const finalResult = qtmsgSuccessTime.has(rowKey) ? sms_result_map_1.SPAM_RESULT.BLOCKED : sms_result_map_1.SPAM_RESULT.TIMEOUT;
                        await (0, database_1.query)(`UPDATE spam_filter_test_results SET result = $1 WHERE id = $2`, [finalResult, row.id]);
                    }
                    await (0, database_1.query)(`UPDATE spam_filter_tests SET status = 'completed', completed_at = NOW()
             WHERE id = $1 AND status = 'active'`, [testId]);
                }
            }
            catch (err) {
                console.error('[SpamTestQueue] 폴링 오류:', err);
            }
        }, RESULT_POLL_INTERVAL_MS);
        // 안전장치 타임아웃
        setTimeout(() => { clearInterval(pollInterval); }, defaults_1.TIMEOUTS.spamFilterSafety);
    }
    catch (err) {
        console.error('[SpamTestQueue] 테스트 실행 오류:', err);
        // 실패 시 completed 처리
        await (0, database_1.query)(`UPDATE spam_filter_tests SET status = 'completed', completed_at = NOW() WHERE id = $1`, [testId]);
    }
}
// ============================================================
// [4] 배치 결과 조회
// ============================================================
async function getSpamTestBatchResults(batchId) {
    const tests = await (0, database_1.query)(`SELECT id, variant_id, status FROM spam_filter_tests
     WHERE batch_id = $1 ORDER BY variant_id`, [batchId]);
    const variants = [];
    let allCompleted = true;
    for (const test of tests.rows) {
        const results = await (0, database_1.query)(`SELECT carrier, message_type, result FROM spam_filter_test_results
       WHERE test_id = $1 ORDER BY carrier, message_type`, [test.id]);
        const carrierResults = results.rows.map((r) => ({
            carrier: r.carrier,
            messageType: r.message_type,
            result: r.result,
        }));
        // 전체 결과 판정
        let overallResult = 'pending';
        if (test.status === 'completed' || test.status === 'active') {
            const allResults = carrierResults.map(r => r.result).filter(Boolean);
            if (allResults.length === 0) {
                overallResult = 'pending';
            }
            else if (allResults.some(r => r === sms_result_map_1.SPAM_RESULT.BLOCKED)) {
                overallResult = 'blocked';
            }
            else if (allResults.some(r => r === sms_result_map_1.SPAM_RESULT.FAILED)) {
                overallResult = 'failed';
            }
            else if (allResults.some(r => r === sms_result_map_1.SPAM_RESULT.TIMEOUT)) {
                overallResult = 'timeout';
            }
            else if (allResults.every(r => r === sms_result_map_1.SPAM_RESULT.PASS)) {
                overallResult = 'pass';
            }
        }
        if (test.status !== 'completed')
            allCompleted = false;
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
async function waitForTestCompletion(testId, timeoutMs = defaults_1.TIMEOUTS.spamFilterSafety) {
    const startTime = Date.now();
    return new Promise((resolve) => {
        const checkInterval = setInterval(async () => {
            try {
                const test = await (0, database_1.query)(`SELECT status FROM spam_filter_tests WHERE id = $1`, [testId]);
                if (test.rows[0]?.status === 'completed') {
                    clearInterval(checkInterval);
                    // 전체 결과 판정
                    const results = await (0, database_1.query)(`SELECT result FROM spam_filter_test_results WHERE test_id = $1`, [testId]);
                    const allResults = results.rows.map((r) => r.result).filter(Boolean);
                    if (allResults.some(r => r === sms_result_map_1.SPAM_RESULT.BLOCKED)) {
                        resolve('blocked');
                    }
                    else if (allResults.some(r => r === sms_result_map_1.SPAM_RESULT.FAILED)) {
                        resolve('failed');
                    }
                    else if (allResults.some(r => r === sms_result_map_1.SPAM_RESULT.TIMEOUT)) {
                        resolve('timeout');
                    }
                    else {
                        resolve('pass');
                    }
                    return;
                }
                if (Date.now() - startTime > timeoutMs) {
                    clearInterval(checkInterval);
                    resolve('timeout');
                }
            }
            catch (err) {
                console.error('[SpamTestQueue] 완료 대기 오류:', err);
            }
        }, 2000); // 2초마다 확인
    });
}
// ============================================================
// [6] 자동 스팸테스트 + 재생성 통합 (AI route에서 호출)
// ============================================================
async function autoSpamTestWithRegenerate(params) {
    const { companyId, userId, callbackNumber, messageType, subject, variants, isAd, rejectNumber, firstRecipient, regenerateCallback, maxRetries = MAX_REGENERATE_RETRIES, } = params;
    const batchId = crypto.randomUUID();
    const isLmsType = messageType === 'LMS' || messageType === 'MMS';
    const resultVariants = [];
    let totalTestCount = 0;
    let totalRegenerateCount = 0;
    for (const variant of variants) {
        let currentMessage = variant.messageText;
        let currentSubject = variant.subject || subject;
        let regenerateCount = 0;
        let spamResult = 'pending';
        let carrierResults = [];
        // 최대 재시도 횟수까지 반복
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            // ★ D102: (광고)+080 — CT-AD 컨트롤타워 사용
            const msgTypeForAd = isLmsType ? 'LMS' : 'SMS';
            const testMessage = (0, messageUtils_1.buildAdMessage)(currentMessage, msgTypeForAd, isAd, rejectNumber || '');
            // ★ KISA 2026-05: 제목(광고) — buildAdSubject 컨트롤타워 사용
            const testSubject = (0, messageUtils_1.buildAdSubject)(currentSubject || '', msgTypeForAd, isAd);
            // 메시지 내용 구성
            const smsContent = !isLmsType ? testMessage : undefined;
            const lmsContent = isLmsType ? testMessage : undefined;
            // 큐에 등록
            const enqueueResult = await enqueueSpamTest({
                companyId,
                userId,
                callbackNumber,
                messageContentSms: smsContent,
                messageContentLms: lmsContent,
                messageType,
                subject: testSubject,
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
            spamResult = await waitForTestCompletion(enqueueResult.testId);
            // 결과 조회
            const results = await (0, database_1.query)(`SELECT carrier, message_type, result FROM spam_filter_test_results
         WHERE test_id = $1 ORDER BY carrier, message_type`, [enqueueResult.testId]);
            carrierResults = results.rows.map((r) => ({
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
                    if (newMessage.subject)
                        currentSubject = newMessage.subject;
                    regenerateCount++;
                    totalRegenerateCount++;
                }
                else {
                    break; // 재생성 실패 → 현재 결과로 확정
                }
            }
            else {
                break; // 재시도 불가 또는 최대 횟수 초과
            }
        }
        resultVariants.push({
            variantId: variant.variantId,
            messageText: currentMessage,
            subject: currentSubject,
            spamResult: spamResult,
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
let queueWorkerTimer = null;
function startSpamTestQueueWorker() {
    if (queueWorkerTimer)
        return; // 중복 시작 방지
    console.log(`[SpamTestQueue] 큐 워커 시작 (${QUEUE_POLL_INTERVAL_MS}ms 간격)`);
    queueWorkerTimer = setInterval(async () => {
        try {
            await processSpamTestQueue();
        }
        catch (err) {
            console.error('[SpamTestQueue] 큐 워커 예외:', err);
        }
    }, QUEUE_POLL_INTERVAL_MS);
}
function stopSpamTestQueueWorker() {
    if (queueWorkerTimer) {
        clearInterval(queueWorkerTimer);
        queueWorkerTimer = null;
        console.log('[SpamTestQueue] 큐 워커 중지');
    }
}
//# sourceMappingURL=spam-test-queue.js.map