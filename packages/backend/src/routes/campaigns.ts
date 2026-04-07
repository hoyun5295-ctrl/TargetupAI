import { randomUUID } from 'crypto';
import { Request, Response, Router } from 'express';
import { mysqlQuery, query } from '../config/database';
import { authenticate } from '../middlewares/auth';
import { extractVarCatalog, validatePersonalizationVars, VarCatalogEntry } from '../services/ai';
import { buildGenderFilter, buildGradeFilter, buildRegionFilter, getRegionVariants } from '../utils/normalize';
import { getSourceRef, logTrainingData, updateTrainingMetrics } from '../utils/training-logger';
import { replaceVariables, enrichWithCustomFields, getOpt080Number, buildAdMessage, prepareFieldMappings, prepareSendMessage } from '../utils/messageUtils';
import { SUCCESS_CODES, PENDING_CODES, isSuccess, isFail, SPAM_RESULT } from '../utils/sms-result-map';
import { DEFAULT_COSTS, redis, CACHE_TTL, BATCH_SIZES, SEND_HOURS } from '../config/defaults';
import { isValidSmsTable } from '../utils/sms-table-validator';
import { normalizePhone } from '../utils/normalize-phone';
import { isValidCustomFieldKey } from '../utils/safe-field-name';
import { getStoreScope } from '../utils/store-scope';
import { CAMPAIGN_OPT080_SELECT_EXPR, CAMPAIGN_OPT080_LEFT_JOIN } from '../utils/unsubscribe-helper';
// ★ 메시징 컨트롤타워 import
import {
  toKoreaTimeStr,
  getCompanySmsTables, hasCompanyLineGroup, getTestSmsTables, getAuthSmsTable,
  invalidateLineGroupCache, getNextSmsTable,
  smsCountAll, smsAggAll, smsSelectAll, smsMinAll, smsExecAll,
  getCompanySmsTablesWithLogs,
  insertKakaoQueue, kakaoAgg, kakaoCountPending, kakaoCancelPending,
  bulkInsertSmsQueue, insertAlimtalkQueue, toQtmsgType, insertTestSmsQueue
} from '../utils/sms-queue';
import { prepaidDeduct, prepaidRefund } from '../utils/prepaid';
import { buildDateRangeFilter } from '../utils/stats-aggregation';
import { cancelCampaign, syncCampaignResults } from '../utils/campaign-lifecycle';
import { buildFilterQueryCompat } from '../utils/customer-filter';
import { filterByIndividualCallback, buildCallbackErrorResponse, buildCallbackConfirmResponse, resolveCustomerCallback } from '../utils/callback-filter';
import { deduplicateByPhone } from '../utils/deduplicate';
import { getUserTestContacts } from '../utils/test-contact-helper';

// ★ toKoreaTimeStr → utils/sms-queue.ts로 이동 (import 사용)

/**
 * ★ C3: 분할발송 시간 계산 (오버플로우 방지)
 * batchIndex분 만큼 baseTime에서 앞으로 밀되,
 * SEND_HOURS.end를 초과하면 다음날 SEND_HOURS.start로 이월
 *
 * @param baseTime - 발송 시작 시간
 * @param batchIndex - 현재 배치 인덱스 (0부터)
 * @param sendStartHour - 발송 시작 시각 (회사별 또는 기본값)
 * @param sendEndHour - 발송 종료 시각 (회사별 또는 기본값)
 * @returns 조정된 발송 시간
 */
function calcSplitSendTime(
  baseTime: Date,
  batchIndex: number,
  sendStartHour: number = SEND_HOURS.start,
  sendEndHour: number = SEND_HOURS.end
): Date {
  const result = new Date(baseTime.getTime());
  result.setMinutes(result.getMinutes() + batchIndex);

  // 한국시간 기준으로 시각 확인 (KST = UTC+9)
  const kstHour = parseInt(
    result.toLocaleString('en-US', { timeZone: 'Asia/Seoul', hour: '2-digit', hour12: false })
  );

  if (kstHour >= sendEndHour) {
    // 종료 시각 초과 → 다음날 시작 시각으로 이월
    // 초과한 분수 계산
    const kstMinutes = parseInt(
      result.toLocaleString('en-US', { timeZone: 'Asia/Seoul', minute: '2-digit' })
    );
    const overflowMinutes = (kstHour - sendEndHour) * 60 + kstMinutes;
    // 다음날 시작 시각 기준으로 재설정
    result.setDate(result.getDate() + 1);
    result.setHours(result.getHours() - kstHour + sendStartHour);
    result.setMinutes(overflowMinutes);
  }

  return result;
}

// ★ GP-04: MySQL TZ는 database.ts의 mysqlQuery 헬퍼에서 매 커넥션마다 자동 설정
// (커넥션 풀 전체 보장 — 단일 SET으로는 1개 커넥션에만 적용되므로 제거)

// ★ 라인그룹/MySQL 큐/카카오/선불 함수 → utils/sms-queue.ts, utils/prepaid.ts로 이동 (import 사용)
// ★ 캠페인 취소/결과동기화 → utils/campaign-lifecycle.ts로 이동 (import 사용)

const router = Router();

router.use(authenticate);

// GET /api/campaigns - 캠페인 목록 (캘린더용)
router.get('/', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;

    if (!companyId) {
      return res.status(403).json({ error: '고객사 권한이 필요합니다.' });
    }

    const companyTables = await getCompanySmsTables(companyId, userId);
    const { status, page = 1, limit = 20, year, month } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let whereClause = 'WHERE company_id = $1';
    const params: any[] = [companyId];
    let paramIndex = 2;

    // ★ D100: cancelled/draft 캠페인은 기본 제외 (캘린더/목록에 불필요한 건 표시 방지)
    //   status 파라미터로 명시 요청 시에만 표시
    if (!status) {
      whereClause += ` AND status NOT IN ('cancelled', 'draft')`;
    }

    // 일반 사용자는 본인이 만든 캠페인만
    if (userType === 'company_user' && userId) {
      whereClause += ` AND created_by = $${paramIndex++}`;
      params.push(userId);
    }

    // 고객사 관리자: 특정 사용자 필터
    if (userType === 'company_admin' && req.query.filter_user_id) {
      whereClause += ` AND created_by = $${paramIndex++}`;
      params.push(req.query.filter_user_id);
    }

    if (status) {
      // status=scheduled 조회 시 MySQL과 동기화
      if (status === 'scheduled') {
        // 예약 캠페인 중 MySQL에 대기 건이 없는 것들 찾아서 상태 업데이트
        let scheduleQuery = `SELECT id FROM campaigns WHERE company_id = $1 AND status = 'scheduled'`;
        const scheduleParams: any[] = [companyId];
        if (userType === 'company_user' && userId) {
          scheduleQuery += ` AND created_by = $2`;
          scheduleParams.push(userId);
        }
        if (userType === 'company_admin' && req.query.filter_user_id) {
          scheduleQuery += ` AND created_by = $2`;
          scheduleParams.push(req.query.filter_user_id);
        }
        const scheduledCampaigns = await query(scheduleQuery, scheduleParams);

        for (const camp of scheduledCampaigns.rows) {
          const pendingCount = await smsCountAll(companyTables, `app_etc1 = ? AND status_code IN (${PENDING_CODES.join(',')})`, [camp.id]);

          // 예약 시간이 아직 안 됐으면 스킵 (MySQL에 데이터 없는게 정상)
          const campDetail = await query(`SELECT scheduled_at FROM campaigns WHERE id = $1`, [camp.id]);
          const scheduledAt = campDetail.rows[0]?.scheduled_at;
          if (scheduledAt && new Date(scheduledAt) > new Date()) {
            continue; // 예약 시간 전이면 완료 처리하지 않음
          }

          if (pendingCount === 0) {
            // 대기 건이 없으면 발송 완료 처리 (LIVE+LOG 조회 — Agent가 완료 후 LOG로 이동)
            const tablesWithLogs = await getCompanySmsTablesWithLogs(companyId);
            const sentCount = await smsCountAll(tablesWithLogs, 'app_etc1 = ?', [camp.id]);
            const successCount = await smsCountAll(tablesWithLogs, `app_etc1 = ? AND status_code IN (${SUCCESS_CODES.join(',')})`, [camp.id]);
            const failCount = await smsCountAll(tablesWithLogs, `app_etc1 = ? AND status_code NOT IN (${[...SUCCESS_CODES, ...PENDING_CODES].join(',')})`, [camp.id]);

            await query(
              `UPDATE campaigns SET status = 'completed', sent_count = $1, success_count = $2, fail_count = $3, sent_at = COALESCE(sent_at, scheduled_at, NOW()), updated_at = NOW() WHERE id = $4`,
              [sentCount, successCount, failCount, camp.id]
            );

            // ★ 선불 실패건 환불
            if (failCount > 0) {
              const campInfo = await query('SELECT company_id, message_type FROM campaigns WHERE id = $1', [camp.id]);
              if (campInfo.rows.length > 0) {
                await prepaidRefund(campInfo.rows[0].company_id, failCount, campInfo.rows[0].message_type, camp.id, '발송 실패 환불');
              }
            }
          }
        }
      }

      whereClause += ` AND status = $${paramIndex++}`;
      params.push(status);
    }

    // 월별 필터링 (캘린더용) - 이벤트 기간도 포함
    if (year && month) {
      const monthStart = `${year}-${month}-01`;
      const monthEnd = `${year}-${month}-${new Date(Number(year), Number(month), 0).getDate()}`;

      whereClause += ` AND (
        DATE_TRUNC('month', scheduled_at) = $${paramIndex}::date
        OR DATE_TRUNC('month', created_at) = $${paramIndex}::date
        OR (event_start_date <= $${paramIndex + 1}::date AND event_end_date >= $${paramIndex}::date)
      )`;
      params.push(monthStart, monthEnd);
      paramIndex += 2;
    }

    // count 쿼리용 파라미터 복사
    const countParams = [...params];

    const countResult = await query(
      `SELECT COUNT(*) FROM campaigns ${whereClause}`,
      countParams
    );
    const total = parseInt(countResult.rows[0].count);

    params.push(Number(limit), offset);
    // ★ B2: opt_out_080_number 포함을 위해 alias 'c' + LEFT JOIN
    const aliasedWhereClause = whereClause
      .replace(/\bcompany_id\b/g, 'c.company_id')
      .replace(/\bstatus\b/g, 'c.status')
      .replace(/\bcreated_by\b/g, 'c.created_by')
      .replace(/\bscheduled_at\b/g, 'c.scheduled_at')
      .replace(/\bcreated_at\b/g, 'c.created_at')
      .replace(/\bevent_start_date\b/g, 'c.event_start_date')
      .replace(/\bevent_end_date\b/g, 'c.event_end_date');
    const result = await query(
      `SELECT
        c.id, c.campaign_name, c.status, c.message_type, c.send_type,
        c.target_count, c.sent_count, c.success_count, c.fail_count,
        c.scheduled_at, c.sent_at, c.created_at,
        TO_CHAR(c.event_start_date, 'YYYY-MM-DD') as event_start_date,
        TO_CHAR(c.event_end_date, 'YYYY-MM-DD') as event_end_date,
        c.message_content, c.message_template, c.subject, c.message_subject, c.is_ad, c.callback_number,
        ${CAMPAIGN_OPT080_SELECT_EXPR}
       FROM campaigns c
       ${CAMPAIGN_OPT080_LEFT_JOIN}
       ${aliasedWhereClause}
       ORDER BY c.created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      params
    );

    return res.json({
      campaigns: result.rows,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error('캠페인 목록 조회 에러:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// POST /api/campaigns/test-send - 담당자 사전수신 (테스트 발송)
router.post('/test-send', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;

    if (!companyId) {
      return res.status(403).json({ error: '고객사 권한이 필요합니다.' });
    }

    // ★ B16-01: 브랜드 격리 — store-scope 컨트롤타워
    let storeFilter = '';
    let storeParams: any[] = [];

    if (userType === 'company_user' && userId) {
      const scope = await getStoreScope(companyId, userId);
      if (scope.type === 'filtered') {
        storeFilter = ' AND c.id IN (SELECT customer_id FROM customer_stores WHERE company_id = c.company_id AND store_code = ANY($STORE_IDX::text[]))';
        storeParams = [scope.storeCodes];
      } else if (scope.type === 'blocked') {
        return res.status(403).json({ error: '소속 브랜드가 지정되지 않았습니다. 관리자에게 문의하세요.' });
      }
    }

    const { messageContent, messageType, isAd } = req.body;
    if (!messageContent) {
      return res.status(400).json({ error: '메시지 내용이 필요합니다.' });
    }

    // 테스트 채널 (기본 sms)
    const testChannel = req.body.sendChannel || 'sms';
    const testKakaoSenderKey = req.body.kakaoSenderKey || '';
    const testKakaoBubbleType = req.body.kakaoBubbleType || 'TEXT';

    // ★ 카카오 활성화 체크 (프론트 우회 방지)
    if (testChannel === 'kakao' || testChannel === 'both') {
      const kakaoCheck = await query('SELECT kakao_enabled FROM companies WHERE id = $1', [companyId]);
      if (!kakaoCheck.rows[0]?.kakao_enabled) {
        return res.status(403).json({ error: '카카오 브랜드메시지가 활성화되지 않은 고객사입니다.', code: 'KAKAO_NOT_ENABLED' });
      }
    }

    // 회사 설정에서 스키마 가져오기
    const companyResult = await query(
      'SELECT customer_schema FROM companies WHERE id = $1',
      [companyId]
    );

    if (companyResult.rows.length === 0) {
      return res.status(404).json({ error: '회사 정보를 찾을 수 없습니다.' });
    }

    // ★ 미리보기와 동일한 고객으로 개인화 — 프론트에서 sampleCustomer 전달 시 그대로 사용
    // ★ D102: prepareFieldMappings 컨트롤타워로 통합 (customer_schema 조회 + extractVarCatalog + enrichWithCustomFields)
    const testFieldMappings = await prepareFieldMappings(companyId);

    let testFirstCustomer: Record<string, any>;
    if (req.body.sampleCustomer && typeof req.body.sampleCustomer === 'object' && Object.keys(req.body.sampleCustomer).length > 0) {
      // 프론트에서 미리보기에 사용한 샘플 고객 그대로 사용 (미리보기 = 테스트발송 = 스팸테스트 동일 보장)
      testFirstCustomer = req.body.sampleCustomer;
    } else {
      // 폴백: DB에서 조회 (sampleCustomer 미전달 시)
      const testMappingCols = Object.values(testFieldMappings).filter((m: any) => m.storageType !== 'custom_fields').map((m: any) => m.column);
      const testSelectCols = [...new Set(['phone', 'custom_fields', ...testMappingCols])].join(', ');
      const testFirstCustomerResult = await query(
        `SELECT ${testSelectCols} FROM customers WHERE company_id = $1 AND is_active = true AND sms_opt_in = true ORDER BY name ASC NULLS LAST LIMIT 1`,
        [companyId]
      );
      testFirstCustomer = testFirstCustomerResult.rows[0] || {};
    }

    // 회신번호 가져오기 (callback_numbers 테이블에서)
    const callbackResult = await query(
      'SELECT phone FROM callback_numbers WHERE company_id = $1 AND is_default = true LIMIT 1',
      [companyId]
    );
    const callbackNumber = normalizePhone(callbackResult.rows[0]?.phone || '');
    if (!callbackNumber) {
      return res.status(400).json({ error: '기본 회신번호가 설정되지 않았습니다. 회사 설정에서 기본 회신번호를 등록해주세요.', code: 'NO_DEFAULT_CALLBACK' });
    }

    // ★ D97: CT-11 컨트롤타워로 담당자 조회 (사용자별 격리)
    const managerContacts = await getUserTestContacts(companyId, userId!);

    if (managerContacts.length === 0) {
      return res.status(400).json({ error: '등록된 담당자 번호가 없습니다. 설정에서 번호를 추가해주세요.' });
    }

    // ★ 선불 잔액 체크
    const testMsgType = (messageType || 'SMS') as string;
    const testDeduct = await prepaidDeduct(companyId, managerContacts.length, testMsgType, '00000000-0000-0000-0000-000000000000', userId);
    if (!testDeduct.ok) {
      return res.status(402).json({ error: testDeduct.error, insufficientBalance: true, balance: testDeduct.balance, requiredAmount: testDeduct.amount });
    }

    // 담당자별로 테스트 전용 라인으로 INSERT
    const testTables = await getTestSmsTables();
    const msgType = toQtmsgType(messageType || 'SMS');
    const mmsImagePaths: string[] = req.body.mmsImagePaths || [];
    // ★ D100: bill_id에 userId 저장 (사용자별 테스트 결과 필터 + 사용금액 격리)
    //   기존 testBillId 사용 → 결과 조회 시 bill_id=userId 필터와 불일치 → company_user 결과 미표시
    const testBillId = userId || '';
    let sentCount = 0;
    const failedContacts: { phone: string; error: string }[] = [];

    // ★ D103: 테스트발송도 백엔드에서 (광고)+080 추가 (전 경로 동일 원칙)
    const testOpt080 = isAd ? await getOpt080Number(userId || null, companyId) : '';

    for (const contact of managerContacts) {
      try {
        const cleanPhone = normalizePhone(contact.phone);
        // ★ D103: prepareSendMessage 컨트롤타워 — 변수 치환 + (광고)+080 한 함수로 통합
        const testMsg = prepareSendMessage(messageContent, testFirstCustomer, testFieldMappings, {
          msgType: messageType || 'SMS', isAd: isAd || false, opt080Number: testOpt080,
        });

        if (testChannel === 'sms' || testChannel === 'both') {
          // ★ D103: insertTestSmsQueue 컨트롤타워 사용 (인라인 INSERT 제거)
          const testSubject = req.body.subject || '';
          await insertTestSmsQueue(cleanPhone, callbackNumber, testMsg, messageType || 'SMS', 'test', testSubject, {
            companyId, billId: testBillId, mmsImages: mmsImagePaths,
          });
        }

        if (testChannel === 'kakao' || testChannel === 'both') {
          // 카카오 테스트 발송
          await insertKakaoQueue({
            bubbleType: testKakaoBubbleType,
            senderKey: testKakaoSenderKey,
            phone: cleanPhone,
            targeting: 'I',
            message: testMsg,
            isAd: false,
            resendType: 'NO',  // 테스트는 대체발송 안함
            requestUid: testBillId,
          });
        }

        sentCount++;
      } catch (err) {
        console.error(`담당자 테스트 발송 실패 (${contact.phone}):`, err);
        // ★ C5: 실패 건 기록
        failedContacts.push({
          phone: contact.phone,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }

    // ★ P0-3: 테스트 발송 실패건 환불 (차감은 전원 기준, 실패분 돌려줌)
    const testFailCount = managerContacts.length - sentCount;
    if (testFailCount > 0) {
      await prepaidRefund(companyId, testFailCount, testMsgType, '00000000-0000-0000-0000-000000000000', '테스트 발송 실패 자동 환불');
    }

    // ★ C5: 실패 건 DB 기록 (비동기, 발송 응답에 영향 없음)
    if (failedContacts.length > 0) {
      try {
        await query(
          `INSERT INTO campaign_runs (campaign_id, run_number, target_count, sent_count, status, created_at)
           VALUES ($1, 0, $2, $3, 'failed', NOW())`,
          [testBillId, managerContacts.length, sentCount]
        );
      } catch (logErr) {
        console.error('[테스트발송] 실패 기록 저장 오류 (발송에는 영향 없음):', logErr);
      }
    }

    return res.json({
      message: `담당자 ${sentCount}명에게 테스트 문자를 발송했습니다.`,
      sentCount,
      // ★ C5: 추적 ID — 프론트에서 결과 조회 시 사용
      testBillId,
      contacts: managerContacts.map(c => ({
        name: c.name || '이름없음',
        phone: `${normalizePhone(c.phone).slice(0, 3)}-****-${normalizePhone(c.phone).slice(-4)}`
      })),
    });
  } catch (error) {
    console.error('담당자 사전수신 에러:', error);
    return res.status(500).json({ error: '테스트 발송에 실패했습니다.' });
  }
});

// POST /api/campaigns - 캠페인 생성
router.post('/', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;

    if (!companyId) {
      return res.status(403).json({ error: '고객사 권한이 필요합니다.' });
    }

    const {
      campaignName,
      messageType,
      targetFilter,
      messageContent,
      subject,
      scheduledAt,
      isAd,
      eventStartDate,
      eventEndDate,
      mmsImagePaths,
      // 카카오 브랜드메시지 필드
      sendChannel,          // sms / kakao / both
      kakaoBubbleType,      // TEXT, IMAGE, WIDE 등
      kakaoSenderKey,       // 발신 프로필 키
      kakaoTargeting,       // I/M/N
      kakaoAttachmentJson,  // 버튼/이미지 JSON
      kakaoCarouselJson,    // 캐러셀 JSON
      kakaoResendType,      // SM/LM/NO
      // ★ B8-04: 회신번호 필드
      callback,               // 공통 회신번호
      useIndividualCallback,  // 개별회신번호 사용 여부
      individualCallbackColumn,  // ★ D99: 회신번호로 사용할 컬럼명
    } = req.body;

    if (!campaignName || !messageType || !messageContent) {
      return res.status(400).json({ error: '필수 항목을 입력하세요.' });
    }

    // ★ B17-01 수정: 타겟 인원 계산 (sms_opt_in + 수신거부 제외 — user_id 기준)
    let targetCount = 0;
    if (targetFilter) {
      const filterQuery = buildFilterQueryCompat(targetFilter, companyId);
      const unsubIdx = 1 + filterQuery.params.length + 1;
      const countResult = await query(
        `SELECT COUNT(*) FROM customers c WHERE c.company_id = $1 AND c.is_active = true AND c.sms_opt_in = true ${filterQuery.where}
         AND NOT EXISTS (SELECT 1 FROM unsubscribes u WHERE u.user_id = $${unsubIdx} AND u.phone = c.phone)`,
        [companyId, ...filterQuery.params, userId]
      );
      targetCount = parseInt(countResult.rows[0].count);
    }

    const result = await query(
      `INSERT INTO campaigns (
        company_id, campaign_name, message_type, target_filter,
        message_content, subject, message_subject, message_template, scheduled_at, is_ad, target_count, created_by,
        event_start_date, event_end_date, mms_image_paths,
        send_channel, kakao_bubble_type, kakao_sender_key, kakao_targeting,
        kakao_attachment_json, kakao_carousel_json, kakao_resend_type,
        callback_number, use_individual_callback, individual_callback_column
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
      RETURNING *`,
      [
        companyId, campaignName, messageType, JSON.stringify(targetFilter),
        messageContent, subject || null, subject || null, messageContent, scheduledAt, isAd ?? false, targetCount, userId,
        eventStartDate || null, eventEndDate || null,
        mmsImagePaths && mmsImagePaths.length > 0 ? JSON.stringify(mmsImagePaths) : null,
        sendChannel || 'sms',
        kakaoBubbleType || null,
        kakaoSenderKey || null,
        kakaoTargeting || 'I',
        kakaoAttachmentJson || null,
        kakaoCarouselJson || null,
        kakaoResendType || 'SM',
        callback || null, useIndividualCallback || false,
        individualCallbackColumn || null
      ]
    );

    return res.status(201).json({
      message: '캠페인이 생성되었습니다.',
      campaign: result.rows[0],
    });
  } catch (error) {
    console.error('캠페인 생성 에러:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// POST /api/campaigns/:id/send - 캠페인 발송
router.post('/:id/send', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;
    const { id } = req.params;
    const { confirmCallbackExclusion } = req.body || {};

    if (!companyId) {
      return res.status(403).json({ error: '고객사 권한이 필요합니다.' });
    }

    const companyTables = await getCompanySmsTables(companyId, userId);

    // ★ 1차 방어: 라인그룹 미설정 발송 차단
    if (!(await hasCompanyLineGroup(companyId))) {
      console.warn(`[라인방어] 캠페인 발송 차단 — companyId: ${companyId}, campaignId: ${id}, 라인그룹 미설정`);
      return res.status(400).json({
        error: '발송 라인그룹이 설정되지 않았습니다. 관리자에게 문의해주세요.',
        code: 'LINE_GROUP_NOT_SET'
      });
    }

    // 일반 사용자는 본인 store_codes에 해당하는 고객만
    // ★ B16-01: 브랜드 격리 — store-scope 컨트롤타워
    let storeFilter = '';
    const storeParams: any[] = [];

    if (userType === 'company_user' && userId) {
      const scope = await getStoreScope(companyId, userId);
      if (scope.type === 'filtered') {
        storeFilter = ' AND c.id IN (SELECT customer_id FROM customer_stores WHERE company_id = c.company_id AND store_code = ANY($STORE_IDX::text[]))';
        storeParams.push(scope.storeCodes);
      } else if (scope.type === 'blocked') {
        return res.status(403).json({ error: '소속 브랜드가 지정되지 않았습니다. 관리자에게 문의하세요.' });
      }
    }

    // 캠페인 조회
    const campaignResult = await query(
      'SELECT * FROM campaigns WHERE id = $1 AND company_id = $2',
      [id, companyId]
    );

    if (campaignResult.rows.length === 0) {
      return res.status(404).json({ error: '캠페인을 찾을 수 없습니다.' });
    }

    const campaign = campaignResult.rows[0];

    // ★ D91: LMS/MMS 제목 필수 검증
    if ((campaign.message_type === 'LMS' || campaign.message_type === 'MMS') && !campaign.message_subject?.trim() && !campaign.subject?.trim()) {
      return res.status(400).json({ error: 'LMS/MMS 발송 시 제목을 입력해주세요.' });
    }

    // 기본 회신번호 조회 (callback_numbers 테이블에서)
    const callbackResult = await query(
      'SELECT phone FROM callback_numbers WHERE company_id = $1 AND is_default = true LIMIT 1',
      [companyId]
    );
    // campaign에 설정된 회신번호 우선, 없으면 기본 회신번호
    const defaultCallback = callbackResult.rows[0]?.phone;

    // 개별회신번호 사용 여부
    // ★ D100: use_individual_callback=true인데 individual_callback_column이 없으면 개별회신번호 비활성
    //   AI가 use_individual_callback=true를 반환했지만 사용자가 컬럼을 지정 안 한 경우
    //   → callback 컬럼이 비어있는 고객이 callbackMissing으로 잡히는 문제 방지
    const individualCallbackColumn = campaign.individual_callback_column || undefined;
    const useIndividualCallback = (campaign.use_individual_callback || false) && !!individualCallbackColumn;

    if (!defaultCallback && !campaign.callback_number && !useIndividualCallback) {
      return res.status(400).json({ error: '기본 회신번호가 설정되지 않았습니다. 회사 설정에서 기본 회신번호를 등록해주세요.', code: 'NO_DEFAULT_CALLBACK' });
    }

    // ★ #4: 회신번호 등록 여부 검증 (개별회신번호가 아닌 경우)
    if (!useIndividualCallback) {
      const senderCallback = normalizePhone(campaign.callback_number || defaultCallback);

      // 회신번호 최소 길이 검증 (한국 전화번호 최소 8자리)
      if (senderCallback.length < 8 || senderCallback.length > 11) {
        return res.status(400).json({
          error: '유효하지 않은 회신번호입니다. 올바른 전화번호 형식으로 입력해주세요.',
          code: 'INVALID_CALLBACK_FORMAT'
        });
      }

      const senderCheck = await query(
        `SELECT phone FROM (
          SELECT REPLACE(phone_number, '-', '') as phone FROM sender_numbers WHERE company_id = $1 AND is_active = true
          UNION SELECT REPLACE(phone, '-', '') as phone FROM callback_numbers WHERE company_id = $1
        ) t WHERE phone = $2 LIMIT 1`,
        [companyId, senderCallback]
      );
      if (senderCheck.rows.length === 0) {
        return res.status(400).json({ error: '등록되지 않은 회신번호입니다. 발신번호 관리에서 번호를 등록해주세요.', code: 'INVALID_SENDER_NUMBER' });
      }
    }

    // ★ D102: prepareFieldMappings 컨트롤타워로 통합 (customer_schema 조회 + extractVarCatalog + enrichWithCustomFields)
    const fieldMappings = await prepareFieldMappings(companyId);
    // availableVars는 변수 검증용으로 별도 추출 (extractVarCatalog는 순수 함수)
    const companySchemaResult = await query('SELECT customer_schema FROM companies WHERE id = $1', [companyId]);
    const { availableVars } = extractVarCatalog(companySchemaResult.rows[0]?.customer_schema);

    // ★ field_mappings에서 필요한 컬럼 자동 추출 (동적 SELECT)
    // ★ store_phone 포함: 개별회신번호 사용 시 callback이 없으면 store_phone을 폴백으로 사용
    // ★ custom_fields 포함: 커스텀 필드 변수 치환을 위해 JSONB 컬럼 필수
    const baseColumns = ['id', 'phone', 'callback', 'store_phone', 'custom_fields'];
    // ★ D99: individualCallbackColumn이 직접 컬럼이면 SELECT에 추가
    if (individualCallbackColumn && !individualCallbackColumn.startsWith('custom_') && !baseColumns.includes(individualCallbackColumn)) {
      baseColumns.push(individualCallbackColumn);
    }
    // ★ storageType 기반 동적 필터 — 직접 컬럼만 SELECT, JSONB 내부 키는 custom_fields 컬럼에서 접근 (D72)
    const mappingColumns = Object.values(fieldMappings).filter((m: VarCatalogEntry) => m.storageType !== 'custom_fields').map((m: VarCatalogEntry) => m.column);
    const selectColumns = [...new Set([...baseColumns, ...mappingColumns])].join(', ');

    // draft 또는 completed 상태에서 재발송 가능
    if (campaign.status === 'sending') {
      return res.status(400).json({ error: '이미 발송 중입니다.' });
    }

    // 타겟 고객 조회
    const targetFilter = campaign.target_filter;
    console.log('targetFilter:', JSON.stringify(targetFilter, null, 2));
    const filterQuery = buildFilterQueryCompat(targetFilter, companyId);
    console.log('filterQuery:', filterQuery);

    // store_code 필터 인덱스 계산
    const storeParamIdx = 1 + filterQuery.params.length + 1;
    const storeFilterFinal = storeFilter.replace('$STORE_IDX', `$${storeParamIdx}`);

    // ★ B17-01 수정: 수신거부 기준을 user_id로 통일 (080 자동연동과 일관성 유지 — 사용자별 수신거부 관리)
    const unsubParamIdx = 1 + filterQuery.params.length + storeParams.length + 1;
    const customersResult = await query(
      `SELECT ${selectColumns} FROM customers c
       WHERE c.company_id = $1 AND c.is_active = true AND c.sms_opt_in = true ${filterQuery.where}${storeFilterFinal}
       AND NOT EXISTS (SELECT 1 FROM unsubscribes u WHERE u.user_id = $${unsubParamIdx} AND u.phone = c.phone)`,
      [companyId, ...filterQuery.params, ...storeParams, userId]
    );

    const customers = customersResult.rows;

    if (customers.length === 0) {
      return res.status(400).json({ error: '발송 대상이 없습니다.' });
    }

    // ★ 발송 전 메시지 변수 검증 (잘못된 변수가 고객에게 노출되는 것을 방지)
    const messageValidation = validatePersonalizationVars(campaign.message_content || '', availableVars);
    if (!messageValidation.valid) {
      console.warn(`[발송 변수 검증] 잘못된 변수 발견: ${messageValidation.invalidVars.join(', ')}`);
      // 잘못된 변수는 빈 문자열로 치환하여 발송 (차단하지 않고 안전하게 처리)
    }

// excluded_phones 목록 조회
const excludedPhones = campaign.excluded_phones || [];

// 제외 대상 필터링
let filteredCustomers = customers.filter(
  (c: any) => !excludedPhones.includes(normalizePhone(c.phone))
);

// ★ D93: CT-08 필터링을 campaign_runs INSERT 전에 실행 — 확인 모달 반환 시 불필요한 run 생성 방지
let callbackSkippedCount = 0;
let callbackMissingCount = 0;
let callbackUnregisteredCount = 0;
if (useIndividualCallback) {
  // D91: admin/company_admin은 배정 필터 미적용 (전체 번호 사용 가능)
  const cbUserId = (userType === 'super_admin' || userType === 'company_admin') ? undefined : userId;
  const cbResult = await filterByIndividualCallback(filteredCustomers, companyId, cbUserId, individualCallbackColumn);
  filteredCustomers = cbResult.filtered;
  callbackMissingCount = cbResult.callbackMissingCount;
  callbackUnregisteredCount = cbResult.callbackUnregisteredCount;
  callbackSkippedCount = cbResult.callbackSkippedCount;

  // ★ 미등록 회신번호 확인 모달 — 제외 건이 있고 confirmCallbackExclusion 없으면 항상 확인 모달 반환
  if (cbResult.callbackSkippedCount > 0 && !confirmCallbackExclusion) {
    const confirmBody = buildCallbackConfirmResponse(cbResult, filteredCustomers.length);
    return res.status(200).json(confirmBody);
  }
}

if (filteredCustomers.length === 0) {
  const errBody = buildCallbackErrorResponse(callbackMissingCount, callbackUnregisteredCount);
  return res.status(400).json(errBody);
}

    // ★ D100: 동일 캠페인 중복 발송 방지 — 이미 sending/scheduled run이 있으면 차단
    const existingRun = await query(
      `SELECT id FROM campaign_runs WHERE campaign_id = $1 AND status IN ('sending', 'scheduled') LIMIT 1`,
      [id]
    );
    if (existingRun.rows.length > 0) {
      return res.status(400).json({ error: '이미 발송이 진행 중이거나 예약되어 있습니다.' });
    }

    // campaign_runs에 발송 이력 생성 (CT-08 확인 모달 통과 후에만 INSERT)
    const runNumberResult = await query(
      `SELECT COALESCE(MAX(run_number), 0) + 1 as next_run
       FROM campaign_runs WHERE campaign_id = $1`,
      [id]
    );
    const runNumber = runNumberResult.rows[0].next_run;

    // 예약 발송인지 확인
    console.log('scheduled_at:', campaign.scheduled_at);
    const isScheduled = campaign.scheduled_at && new Date(campaign.scheduled_at) > new Date();
    console.log('isScheduled:', isScheduled);

    const runResult = await query(
      `INSERT INTO campaign_runs (
        campaign_id, run_number, target_filter, target_count,
        status, scheduled_at
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
      [
        id,
        runNumber,
        JSON.stringify(targetFilter),
        filteredCustomers.length,
        isScheduled ? 'scheduled' : 'sending',
        campaign.scheduled_at
      ]
    );
    const campaignRun = runResult.rows[0];

// ★ 선불 잔액 체크 + 차감 (MySQL INSERT 전에 atomic 차감)
// 카카오 채널이면 KAKAO 타입으로 차감
const sendChannel = campaign.send_channel || 'sms';

// ★ 카카오 활성화 체크 (프론트 우회 방지)
if (sendChannel === 'kakao' || sendChannel === 'both') {
  const kakaoCheck = await query('SELECT kakao_enabled FROM companies WHERE id = $1', [companyId]);
  if (!kakaoCheck.rows[0]?.kakao_enabled) {
    return res.status(403).json({ error: '카카오 브랜드메시지가 활성화되지 않은 고객사입니다.', code: 'KAKAO_NOT_ENABLED' });
  }
}

const deductType = sendChannel === 'kakao' ? 'KAKAO' : campaign.message_type;
const sendDeduct = await prepaidDeduct(companyId, filteredCustomers.length, deductType, id, userId);
if (!sendDeduct.ok) {
  return res.status(402).json({
    error: sendDeduct.error,
    insufficientBalance: true,
    balance: sendDeduct.balance,
    requiredAmount: sendDeduct.amount
  });
}

// ★ P0-3: 차감 성공 후 발송 실패 시 자동 환불 보장
try {

// MySQL에 INSERT (즉시/예약 공통)
// ★ C4: sendTime은 항상 문자열로 생성 → SQL 파라미터로 전달 (SQL Injection 방지)
const sendTime = isScheduled
  ? toKoreaTimeStr(new Date(campaign.scheduled_at))
  : toKoreaTimeStr(new Date());  // 즉시발송도 JS 타임스탬프를 파라미터로 전달

// MMS 이미지 경로 (campaigns 테이블에서 가져옴)
const campaignMmsImages: string[] = campaign.mms_image_paths || [];
const aiMsgTypeCode = toQtmsgType(campaign.message_type);

// 카카오 설정 (campaigns 테이블에서)
const kakaoBubbleType = campaign.kakao_bubble_type || 'TEXT';
const kakaoSenderKey = campaign.kakao_sender_key || '';
const kakaoTargeting = campaign.kakao_targeting || 'I';
const kakaoAttachmentJson = campaign.kakao_attachment_json || null;
const kakaoCarouselJson = campaign.kakao_carousel_json || null;
const kakaoResendType = campaign.kakao_resend_type || 'SM';

// ★ D102: 080 수신거부번호 — CT-AD 컨트롤타워 사용
const opt080Number = campaign.is_ad ? await getOpt080Number(userId || null, companyId) : '';
let opt080Auth = '';

// ★ D72 성능개선: 건건이 INSERT → sms-queue.ts 컨트롤타워 bulkInsertSmsQueue 사용
let aiSentCount = 0;

// 1단계: 메시지 치환 + 발송 데이터 준비 (메모리 연산)
const aiSmsRows: any[][] = [];
const aiKakaoQueue: any[] = [];

for (const customer of filteredCustomers) {
  // ★ D103: prepareSendMessage 컨트롤타워 — 변수 치환 + (광고)+080 한 함수로 통합
  const personalizedMessage = prepareSendMessage(campaign.message_content || '', customer, fieldMappings, {
    msgType: campaign.message_type, isAd: campaign.is_ad || false, opt080Number,
  });
  // ★ D28: 제목은 고정값 그대로 사용 (머지 치환 완전 제거)
  const personalizedSubject = campaign.subject || '';

  // ★ D103: resolveCustomerCallback 컨트롤타워 — 개별회신번호 resolve 통합
  const customerCallback = resolveCustomerCallback(customer, useIndividualCallback, campaign.callback_number || defaultCallback);

  const cleanPhone = normalizePhone(customer.phone);

  // ★ SMS/LMS/MMS — row 데이터 준비
  if (sendChannel === 'sms' || sendChannel === 'both') {
    aiSmsRows.push([
      cleanPhone, customerCallback, personalizedMessage, aiMsgTypeCode,
      personalizedSubject, sendTime, id, companyId,
      campaignMmsImages[0] || '', campaignMmsImages[1] || '', campaignMmsImages[2] || ''
    ]);
  }

  // ★ 카카오 — 개별 큐 축적 (insertKakaoQueue는 개별 호출 필요)
  if (sendChannel === 'kakao' || sendChannel === 'both') {
    aiKakaoQueue.push({
      bubbleType: kakaoBubbleType,
      senderKey: kakaoSenderKey,
      phone: cleanPhone,
      targeting: kakaoTargeting,
      message: personalizedMessage,
      isAd: campaign.is_ad || false,
      reservedDate: sendTime || undefined,
      attachmentJson: kakaoAttachmentJson,
      carouselJson: kakaoCarouselJson,
      resendType: sendChannel === 'both' ? 'NO' : kakaoResendType,
      resendFrom: customerCallback,
      resendMessage: sendChannel === 'both' ? undefined : undefined,
      unsubscribePhone: opt080Number,
      requestUid: id,
    });
  }
}

// 2단계: SMS bulk INSERT — sms-queue.ts 컨트롤타워 사용
if (sendChannel === 'sms' || sendChannel === 'both') {
  aiSentCount += await bulkInsertSmsQueue(companyTables, aiSmsRows, !isScheduled);
}

// 3단계: 카카오 발송 (개별 호출 — 카카오 API 특성상 bulk 미지원)
for (const kakaoItem of aiKakaoQueue) {
  try {
    await insertKakaoQueue(kakaoItem);
    if (sendChannel === 'kakao') aiSentCount++;
  } catch (kakaoErr) {
    console.error(`[AI발송] 카카오 INSERT 실패 (phone: ${kakaoItem.phone}):`, kakaoErr);
  }
}

// ★ C1: 부분 실패 시 실패분만 선별적 환불
const aiFailCount = filteredCustomers.length - aiSentCount;
if (aiFailCount > 0) {
  console.warn(`[AI발송] 부분 실패 — 성공: ${aiSentCount}, 실패: ${aiFailCount} → 실패분 환불 처리`);
  try {
    await prepaidRefund(companyId, aiFailCount, deductType, id, `AI발송 부분실패 ${aiFailCount}건 환불`);
  } catch (partialRefundErr) {
    console.error('[AI발송] 부분 실패 환불 오류:', partialRefundErr);
  }
}

// campaign_runs 상태 업데이트
// ★ #6: 예약 캠페인은 sent_at 설정하지 않음
// ★ C1: aiSentCount 기반으로 실제 성공 건수 반영
await query(
  `UPDATE campaign_runs SET
    sent_count = $1,
    status = $2
    ${isScheduled ? '' : ', sent_at = CURRENT_TIMESTAMP'}
   WHERE id = $3`,
  [aiSentCount, aiSentCount === 0 ? 'failed' : (isScheduled ? 'scheduled' : 'sending'), campaignRun.id]
);

// 캠페인 상태 업데이트
// ★ #6: 예약 캠페인은 sent_at 설정하지 않음 (sync-results에서 실제 발송 완료 시 설정)
// ★ C1: aiSentCount 기반
await query(
  `UPDATE campaigns SET
    status = $1,
    sent_count = COALESCE(sent_count, 0) + $2,
    target_count = $3
    ${isScheduled ? '' : ', sent_at = CURRENT_TIMESTAMP'}
   WHERE id = $4`,
   [aiSentCount === 0 ? 'failed' : (isScheduled ? 'scheduled' : 'sending'), aiSentCount, filteredCustomers.length, id]
  );

      // ★ AI 학습 데이터 적재 (비동기, 실패해도 발송에 영향 없음)
      const trainingCompanyInfo = await query('SELECT name, brand_tone FROM companies WHERE id = $1', [companyId]);
      logTrainingData({
        campaignRunId: campaignRun.id,
        companyId,
        companyName: trainingCompanyInfo.rows[0]?.name,
        brandTone: trainingCompanyInfo.rows[0]?.brand_tone,
        userPrompt: campaign.user_prompt,
        targetFilter: campaign.target_filter,
        targetCount: filteredCustomers.length,
        messageType: campaign.message_type,
        isAd: campaign.is_ad || false,
        finalMessage: campaign.message_content || '',
        finalSource: (campaign.message_template && campaign.message_template === campaign.message_content) ? 'selected_as_is' : 'edited',
        sendAt: campaign.scheduled_at ? new Date(campaign.scheduled_at) : new Date(),
      });

      return res.json({
      message: `${aiSentCount}건 발송이 시작되었습니다.${aiFailCount > 0 ? ` (${aiFailCount}건 실패, 자동 환불)` : ''}${callbackMissingCount > 0 ? ` (회신번호 없음 ${callbackMissingCount}명 제외)` : ''}${callbackUnregisteredCount > 0 ? ` (미등록 회신번호 ${callbackUnregisteredCount}명 제외)` : ''}`,
      sentCount: aiSentCount,
      failCount: aiFailCount,
      callbackSkippedCount,
      callbackMissingCount,
      callbackUnregisteredCount,
      runId: campaignRun.id,
      runNumber: runNumber,
    });

    } catch (sendError) {
      // ★ C1: 전체 실패 (루프 진입 전 오류 등) — 전액 환불
      console.error('[AI발송] 큐 처리 전체 실패 — 차감 환불 처리:', sendError);
      try {
        await prepaidRefund(companyId, filteredCustomers.length, deductType, id, '발송 전체 실패 자동 환불');
        await query(`UPDATE campaigns SET status = 'failed', updated_at = NOW() WHERE id = $1`, [id]);
      } catch (refundErr) {
        console.error('[AI발송] 환불 처리 중 추가 오류:', refundErr);
      }
      return res.status(500).json({ error: '발송 처리 중 오류가 발생했습니다. 차감된 금액은 자동 환불됩니다.' });
    }

  } catch (error) {
    console.error('캠페인 발송 에러:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// ★ D79: 인라인 래퍼 제거 → CT-01 buildFilterQueryCompat 직접 사용

// 담당자 테스트 발송 통계
router.get('/test-stats', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;

    if (!companyId) {
      return res.status(403).json({ error: '고객사 권한이 필요합니다.' });
    }

    const { fromDate, toDate } = req.query;

    // 날짜 범위 필터 — 포맷 검증 + 파라미터화 (SQL Injection 방지)
    const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;
    let dateFilter = '';
    const dateParams: any[] = [];
    if (fromDate && toDate && DATE_FORMAT.test(String(fromDate)) && DATE_FORMAT.test(String(toDate))) {
      dateFilter = ' AND sendreq_time >= ? AND sendreq_time <= ?';
      dateParams.push(`${fromDate} 00:00:00`, `${toDate} 23:59:59`);
    }

    // 일반 사용자는 본인이 보낸 테스트만
    let userFilter = '';
    const queryParams: any[] = [companyId];
    if (userType === 'company_user' && userId) {
      userFilter = ' AND bill_id = ?';
      queryParams.push(userId);
    }
    // 날짜 파라미터를 쿼리 파라미터에 합산 (위치 순서 유지)
    queryParams.push(...dateParams);

    // 테스트 전용 메인 테이블
    const testTables = await getTestSmsTables();

    // 로그 테이블도 포함 (Agent 처리 완료 시 SMSQ_SEND_10 → SMSQ_SEND_10_YYYYMM 이동)
    const logTables: string[] = [];
    if (fromDate && toDate) {
      const start = new Date(fromDate as string);
      const end = new Date(toDate as string);
      const cur = new Date(start.getFullYear(), start.getMonth(), 1);
      while (cur <= end) {
        const ym = `${cur.getFullYear()}${String(cur.getMonth() + 1).padStart(2, '0')}`;
        for (const t of testTables) {
          logTables.push(`${t}_${ym}`);
        }
        cur.setMonth(cur.getMonth() + 1);
      }
    } else {
      const now = new Date();
      const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
      for (const t of testTables) {
        logTables.push(`${t}_${ym}`);
      }
    }

    // 존재하는 로그 테이블만 추가
    const allTables = [...testTables];
    for (const lt of logTables) {
      try {
        await mysqlQuery(`SELECT 1 FROM ${lt} LIMIT 0`);
        allTables.push(lt);
      } catch { /* 테이블 없으면 스킵 */ }
    }

    const allResults = await smsSelectAll(allTables,
      'seqno, dest_no, msg_contents, msg_type, sendreq_time, status_code, mobsend_time, bill_id',
      `app_etc1 = 'test' AND app_etc2 = ?${userFilter}${dateFilter}`,
      queryParams,
      'ORDER BY sendreq_time DESC'
    );

    // 시간순 정렬 (여러 테이블 합산이므로 재정렬)
    allResults.sort((a: any, b: any) => new Date(b.sendreq_time).getTime() - new Date(a.sendreq_time).getTime());

    // 발송자 정보 조회 (관리자용)
    const senderIds = [...new Set(allResults.map((r: any) => r.bill_id).filter(Boolean))];
    let senderMap: Record<string, string> = {};
    if (senderIds.length > 0) {
      const senderResult = await query(
        `SELECT id, name FROM users WHERE id = ANY($1::uuid[])`,
        [senderIds]
      );
      senderResult.rows.forEach((u: any) => {
        senderMap[u.id] = u.name;
      });
    }

    // 통계 계산 (전체 결과 기준)
    const stats = {
      total: allResults.length,
      success: allResults.filter((r: any) => isSuccess(r.status_code)).length,
      fail: allResults.filter((r: any) => isFail(r.status_code)).length,
      pending: allResults.filter((r: any) => PENDING_CODES.includes(r.status_code)).length,
      cost: 0,
    };

    // 비용 계산 (회사 실제 단가 기준)
    const costResult = await query('SELECT cost_per_sms, cost_per_lms, cost_per_mms FROM companies WHERE id = $1', [companyId]);
    const costSms = Number(costResult.rows[0]?.cost_per_sms) || DEFAULT_COSTS.sms;
    const costLms = Number(costResult.rows[0]?.cost_per_lms) || DEFAULT_COSTS.lms;
    const costMms = Number(costResult.rows[0]?.cost_per_mms) || DEFAULT_COSTS.mms;
    allResults.forEach((r: any) => {
      if (isSuccess(r.status_code)) {
        stats.cost += r.msg_type === 'S' ? costSms : r.msg_type === 'M' ? costMms : costLms;
      }
    });

    // 리스트 포맷팅
    const list = allResults.map((r: any) => ({
      id: r.seqno,
      phone: r.dest_no,
      content: r.msg_contents,
      type: r.msg_type === 'S' ? 'SMS' : r.msg_type === 'M' ? 'MMS' : 'LMS',
      sentAt: r.sendreq_time,
      status: isSuccess(r.status_code) ? 'success' : PENDING_CODES.includes(r.status_code) ? 'pending' : 'fail',

      testType: 'manager',
      senderName: senderMap[r.bill_id] || '-',
    }));

    // ========== 스팸필터 테스트 통합 ==========
    // ★ D104: 날짜 필터 컨트롤타워 사용
    const spamDr = buildDateRangeFilter('t.created_at', fromDate as string | undefined, toDate as string | undefined, 2);
    const spamDateWhere = spamDr.sql;
    const spamParams: any[] = [companyId, ...spamDr.params];
    let spamIdx = spamDr.nextIndex;
    let spamUserWhere = '';
    if (userType === 'company_user' && userId) {
      spamUserWhere = ` AND t.user_id = $${spamIdx}`;
      spamParams.push(userId);
      spamIdx++;
    }

    const spamAgg = await query(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN r.message_type = 'SMS' THEN 1 ELSE 0 END) as sms,
        SUM(CASE WHEN r.message_type = 'LMS' THEN 1 ELSE 0 END) as lms,
        SUM(CASE WHEN r.result IS NOT NULL THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN r.result IS NULL AND t.status IN ('active','pending') THEN 1 ELSE 0 END) as pending
      FROM spam_filter_test_results r
      JOIN spam_filter_tests t ON r.test_id = t.id
      WHERE t.company_id = $1 ${spamDateWhere} ${spamUserWhere}
    `, spamParams);

    const sf = spamAgg.rows[0];
    const sfTotal = Number(sf.total) || 0;
    const sfCompleted = Number(sf.completed) || 0;
    const sfPending = Number(sf.pending) || 0;
    const sfSms = Number(sf.sms) || 0;
    const sfLms = Number(sf.lms) || 0;
    const sfCost = sfCompleted > 0 ? (sfSms > sfLms ? sfSms * costSms + sfLms * costLms : sfLms * costLms + sfSms * costSms) : 0;
    // 정확한 비용: completed 건에 대해 SMS/LMS 구분하여 계산
    let sfCostCalc = 0;

    // 스팸필터 리스트 (최근 100건)
    const spamListResult = await query(`
      SELECT
        r.id, r.phone, r.carrier, r.message_type, r.result, r.received,
        t.created_at as sent_at, t.user_id, t.callback_number,
        t.message_content_sms, t.message_content_lms,
        u.name as sender_name
      FROM spam_filter_test_results r
      JOIN spam_filter_tests t ON r.test_id = t.id
      LEFT JOIN users u ON t.user_id = u.id
      WHERE t.company_id = $1 ${spamDateWhere} ${spamUserWhere}
      ORDER BY t.created_at DESC
      LIMIT 100
    `, spamParams);

    const spamFilterList = spamListResult.rows.map((r: any) => {
      const msgType = r.message_type || 'SMS';
      const isCompleted = r.result !== null;
      if (isCompleted) {
        sfCostCalc += msgType === 'SMS' ? costSms : costLms;
      }
      return {
        id: r.id,
        phone: r.phone,
        content: msgType === 'LMS' ? (r.message_content_lms || '') : (r.message_content_sms || ''),
        type: msgType,
        sentAt: r.sent_at,
        status: isCompleted ? 'success' : 'pending',
        result: r.result || SPAM_RESULT.PASS,
        carrier: r.carrier,
        testType: 'spam_filter',
        senderName: r.sender_name || '-',
      };
    });

    const spamFilterStats = {
      total: sfTotal,
      success: sfCompleted,
      fail: 0,
      pending: sfPending,
      sms: sfSms,
      lms: sfLms,
      cost: Math.round(sfCostCalc * 10) / 10,
    };

    // 합산 통계
    const combinedStats = {
      total: stats.total + spamFilterStats.total,
      success: stats.success + spamFilterStats.success,
      fail: stats.fail + spamFilterStats.fail,
      pending: stats.pending + spamFilterStats.pending,
      cost: Math.round((stats.cost + spamFilterStats.cost) * 10) / 10,
    };

    res.json({
      stats: combinedStats,
      managerStats: stats,
      spamFilterStats,
      list,
      spamFilterList,
    });
  } catch (error) {
    console.error('테스트 통계 조회 실패:', error);
    res.status(500).json({ error: '테스트 통계 조회 실패' });
  }
});

// GET /api/campaigns/:id - 캠페인 상세 조회
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const companyId = req.user?.companyId;

    // ★ B2: opt_out_080_number 포함을 위해 LEFT JOIN
    const result = await query(
      `SELECT c.*, ${CAMPAIGN_OPT080_SELECT_EXPR}
       FROM campaigns c
       ${CAMPAIGN_OPT080_LEFT_JOIN}
       WHERE c.id = $1 AND c.company_id = $2`,
      [id, companyId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: '캠페인을 찾을 수 없습니다.' });
    }

    // 발송 이력도 함께 조회
    const runs = await query(
      `SELECT * FROM campaign_runs WHERE campaign_id = $1 ORDER BY created_at DESC`,
      [id]
    );

    return res.json({
      ...result.rows[0],
      runs: runs.rows
    });
  } catch (error) {
    console.error('캠페인 상세 조회 에러:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});
// POST /api/campaigns/sync-results - MySQL 결과를 PostgreSQL로 동기화
// ★ utils/campaign-lifecycle.ts 컨트롤타워 사용
router.post('/sync-results', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ error: '권한이 필요합니다.' });
    }

    const result = await syncCampaignResults(companyId);
    return res.json({ message: `${result.syncCount}건 동기화 완료` });
  } catch (error) {
    console.error('결과 동기화 에러:', error);
    return res.status(500).json({ error: '동기화 실패' });
  }
});
// 직접발송 API
router.post('/direct-send', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const userId = (req as any).user?.userId;
    const userType = (req as any).user?.userType;
    if (!companyId) {
      return res.status(401).json({ success: false, error: '인증 필요' });
    }

    const companyTables = await getCompanySmsTables(companyId, userId);

    // ★ 1차 방어: 라인그룹 미설정 발송 차단
    if (!(await hasCompanyLineGroup(companyId))) {
      console.warn(`[라인방어] 직접발송 차단 — companyId: ${companyId}, 라인그룹 미설정`);
      return res.status(400).json({
        success: false,
        error: '발송 라인그룹이 설정되지 않았습니다. 관리자에게 문의해주세요.',
        code: 'LINE_GROUP_NOT_SET'
      });
    }

    const {
      msgType,        // SMS, LMS, MMS
      subject,        // 제목 (LMS/MMS)
      message,        // 메시지 내용 (광고문구 포함된 최종 메시지)
      callback,       // 회신번호
      recipients,     // [{phone, name, extra1, extra2, extra3}]
      customMessages, // ★ S9-01: [{phone, message}] — 프론트에서 치환 완료된 개인화 메시지
      adEnabled,      // 광고문구 포함 여부
      scheduled,      // 예약 여부
      scheduledAt,    // 예약 시간
      splitEnabled,   // 분할전송 여부
      splitCount,     // 분당 발송 건수
      useIndividualCallback,  // 개별회신번호 사용 여부
      individualCallbackColumn,  // ★ D99: 회신번호로 사용할 컬럼명 (store_phone, callback, custom_N 등)
      confirmCallbackExclusion, // ★ 미등록 회신번호 제외 확인 플래그
      mmsImagePaths,  // MMS 이미지 서버 경로 배열
      // 카카오 브랜드메시지 필드
      sendChannel,          // sms / kakao / both / alimtalk
      kakaoBubbleType,      // TEXT, IMAGE, WIDE 등
      kakaoSenderKey,       // 발신 프로필 키
      kakaoTargeting,       // I/M/N
      kakaoAttachmentJson,  // 버튼/이미지 JSON
      kakaoCarouselJson,    // 캐러셀 JSON
      kakaoResendType,      // SM/LM/NO
      targetFilter,         // 금액필터 등 타겟 조건
      // 알림톡 필드
      alimtalkTemplateCode, // 알림톡 템플릿 코드
      alimtalkButtonJson,   // 알림톡 버튼 JSON (k_button_json 형식)
      alimtalkNextType,     // 실패 시 폴백 (N/S/L)
      // ★ D102: 중복제거/수신거부제거 사용자 선택 (기본 true)
      dedupEnabled = true,
      unsubFilterEnabled = true,
    } = req.body;

    // ★ D102: customMessageMap 제거 — 프론트 치환 폐기, 백엔드 replaceVariables 컨트롤타워 통일

    if (!recipients || recipients.length === 0) {
      return res.status(400).json({ success: false, error: '수신자가 없습니다' });
    }

    // ★ D102: 중복제거 — 사용자 선택에 따라 적용 (기본 true)
    let finalRecipients = recipients;
    let duplicateCount = 0;
    if (dedupEnabled !== false) {
      const dedupResult = deduplicateByPhone(recipients);
      finalRecipients = dedupResult.unique;
      duplicateCount = dedupResult.duplicateCount;
      if (duplicateCount > 0) {
        console.log(`[직접발송] 중복제거: ${recipients.length}건 → ${finalRecipients.length}건 (${duplicateCount}건 제거)`);
      }
    }

    // ★ D91: LMS/MMS 제목 필수 검증
    if ((msgType === 'LMS' || msgType === 'MMS') && !subject?.trim()) {
      return res.status(400).json({ success: false, error: 'LMS/MMS 발송 시 제목을 입력해주세요.' });
    }

    if (!callback && !useIndividualCallback) {
      return res.status(400).json({ success: false, error: '회신번호를 선택해주세요' });
    }

    // ★ #4: 회신번호 등록 여부 검증 (개별회신번호가 아닌 경우)
    if (!useIndividualCallback && callback) {
      const normalizedCallback = normalizePhone(callback);

      // 회신번호 최소 길이 검증 (한국 전화번호 최소 8자리)
      if (normalizedCallback.length < 8 || normalizedCallback.length > 11) {
        return res.status(400).json({
          success: false,
          error: '유효하지 않은 회신번호입니다. 올바른 전화번호 형식으로 입력해주세요.',
          code: 'INVALID_CALLBACK_FORMAT'
        });
      }

      const senderCheck = await query(
        `SELECT phone FROM (
          SELECT REPLACE(phone_number, '-', '') as phone FROM sender_numbers WHERE company_id = $1 AND is_active = true
          UNION SELECT REPLACE(phone, '-', '') as phone FROM callback_numbers WHERE company_id = $1
        ) t WHERE phone = $2 LIMIT 1`,
        [companyId, normalizedCallback]
      );
      if (senderCheck.rows.length === 0) {
        return res.status(400).json({ success: false, error: '등록되지 않은 회신번호입니다. 발신번호 관리에서 번호를 등록해주세요.', code: 'INVALID_SENDER_NUMBER' });
      }
    }

    // ★ CT-08: 개별회신번호 필터링 — callback-filter.ts 컨트롤타워 사용
    let validRecipients: any[] = [...finalRecipients];
    let callbackSkippedCount = 0;
    let callbackMissingCount = 0;
    let callbackUnregisteredCount = 0;
    if (useIndividualCallback) {
      // D91: admin/company_admin은 배정 필터 미적용 (전체 번호 사용 가능)
      const cbUserId = (userType === 'super_admin' || userType === 'company_admin') ? undefined : userId;
      // ★ D99: direct-send에서는 프론트가 이미 선택된 컬럼값을 callback에 매핑해서 전달하므로
      // callbackColumn을 CT-08에 전달하지 않음 (recipients에 원본 컬럼 필드가 없으므로 전달하면 덮어씌워짐)
      console.log(`[direct-send] 개별회신번호 필터 시작 — recipients: ${validRecipients.length}, confirmCallbackExclusion: ${confirmCallbackExclusion}`);
      const cbResult = await filterByIndividualCallback(validRecipients, companyId, cbUserId);
      validRecipients = cbResult.filtered;
      callbackMissingCount = cbResult.callbackMissingCount;
      callbackUnregisteredCount = cbResult.callbackUnregisteredCount;
      callbackSkippedCount = cbResult.callbackSkippedCount;
      console.log(`[direct-send] 필터 결과 — skipped: ${callbackSkippedCount}, missing: ${callbackMissingCount}, unregistered: ${callbackUnregisteredCount}, remaining: ${validRecipients.length}`);

      // ★ 미등록 회신번호 확인 모달 — 제외 건이 있고 confirmCallbackExclusion 없으면 항상 확인 모달 반환
      if (cbResult.callbackSkippedCount > 0 && !confirmCallbackExclusion) {
        const confirmBody = buildCallbackConfirmResponse(cbResult, validRecipients.length);
        console.log(`[direct-send] ★ 확인 모달 반환 — callbackConfirmRequired: true, remaining: ${validRecipients.length}`);
        return res.status(200).json({ success: false, ...confirmBody });
      }

      if (validRecipients.length === 0) {
        const errBody = buildCallbackErrorResponse(callbackMissingCount, callbackUnregisteredCount);
        return res.status(400).json({ success: false, ...errBody });
      }
    }

    // 0. 금액필터 적용 (targetFilter가 있을 경우)
    let targetFilteredRecipients = validRecipients;
    if (targetFilter && Object.keys(targetFilter).length > 0) {
      const amountFields = Object.keys(targetFilter).filter(k =>
        k.includes('amount') || k.includes('purchase') || k.includes('금액')
      );
      if (amountFields.length > 0) {
        const recipientPhones = finalRecipients.map((r: any) => normalizePhone(r.phone));
        let filterWhere = 'c.company_id = $1 AND c.phone = ANY($2::text[]) AND c.is_active = true';
        const filterParams: any[] = [companyId, recipientPhones];
        let pIdx = 3;

        for (const [key, condition] of Object.entries(targetFilter)) {
          if (typeof condition === 'object' && condition !== null) {
            const cond = condition as any;
            if (cond.operator === 'between' && Array.isArray(cond.value)) {
              filterWhere += ` AND c.${key} BETWEEN $${pIdx++} AND $${pIdx++}`;
              filterParams.push(cond.value[0], cond.value[1]);
            } else if (cond.operator === 'gte') {
              filterWhere += ` AND c.${key} >= $${pIdx++}`;
              filterParams.push(cond.value);
            } else if (cond.operator === 'lte') {
              filterWhere += ` AND c.${key} <= $${pIdx++}`;
              filterParams.push(cond.value);
            }
          }
        }

        const validResult = await query(
          `SELECT c.phone FROM customers c WHERE ${filterWhere}`,
          filterParams
        );
        const validPhones = new Set(validResult.rows.map((r: any) => normalizePhone(r.phone)));
        const beforeCount = targetFilteredRecipients.length;
        targetFilteredRecipients = targetFilteredRecipients.filter((r: any) => validPhones.has(normalizePhone(r.phone)));
        if (targetFilteredRecipients.length < beforeCount) {
          console.log(`[직접발송] 금액필터: ${beforeCount}명 → ${targetFilteredRecipients.length}명`);
        }
      }
    }

    // ★ D102: 수신거부 필터링 — 사용자 선택에 따라 적용 (기본 true)
    let filteredRecipients = targetFilteredRecipients;
    let excludedCount = 0;
    if (unsubFilterEnabled !== false) {
      const phones = targetFilteredRecipients.map((r: any) => normalizePhone(r.phone));
      const unsubResult = await query(
        `SELECT DISTINCT phone FROM unsubscribes WHERE user_id = $1 AND phone = ANY($2)`,
        [userId, phones]
      );
      const unsubPhones = new Set(unsubResult.rows.map((r: any) => r.phone));
      filteredRecipients = targetFilteredRecipients.filter((r: any) => !unsubPhones.has(normalizePhone(r.phone)));
      excludedCount = targetFilteredRecipients.length - filteredRecipients.length;
    }

    if (filteredRecipients.length === 0) {
      return res.status(400).json({ success: false, error: '모든 수신자가 수신거부 상태이거나 필터 조건에 해당하지 않습니다' });
    }

    // 2. 캠페인 레코드 생성 (원본 템플릿도 저장)
    const directChannel = sendChannel || 'sms';

    // ★ 카카오 활성화 체크 (프론트 우회 방지)
    if (directChannel === 'kakao' || directChannel === 'both') {
      const kakaoCheck = await query('SELECT kakao_enabled FROM companies WHERE id = $1', [companyId]);
      if (!kakaoCheck.rows[0]?.kakao_enabled) {
        return res.status(403).json({ success: false, error: '카카오 브랜드메시지가 활성화되지 않은 고객사입니다.', code: 'KAKAO_NOT_ENABLED' });
      }
    }

    const campaignResult = await query(
      `INSERT INTO campaigns (company_id, campaign_name, message_type, message_content, subject, callback_number, target_count, send_type, status, scheduled_at, message_template, message_subject, created_by, mms_image_paths,
        send_channel, kakao_bubble_type, kakao_sender_key, kakao_targeting, kakao_attachment_json, kakao_carousel_json, kakao_resend_type, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'direct', $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, NOW())
       RETURNING id`,
      [
        companyId,
        `직접발송 ${new Date().toLocaleString('ko-KR')}`,
        msgType,
        message,
        subject || null,
        callback,
        filteredRecipients.length,
        scheduled ? 'scheduled' : 'sending',
        scheduled && scheduledAt ? new Date(scheduledAt) : null,
        message,  // message_template: 원본 템플릿
        subject || null,  // message_subject: 원본 제목
        userId,  // created_by: 발송자
        mmsImagePaths && mmsImagePaths.length > 0 ? JSON.stringify(mmsImagePaths) : null,
        directChannel,
        kakaoBubbleType || null,
        kakaoSenderKey || null,
        kakaoTargeting || 'I',
        kakaoAttachmentJson || null,
        kakaoCarouselJson || null,
        kakaoResendType || 'SM'
      ]
    );
    const campaignId = campaignResult.rows[0].id;

    // ★ 선불 잔액 체크 + 차감
    const directDeductType = directChannel === 'kakao' ? 'KAKAO' : msgType;
    const directDeduct = await prepaidDeduct(companyId, filteredRecipients.length, directDeductType, campaignId, userId);
    if (!directDeduct.ok) {
      // 캠페인 레코드 롤백
      await query('DELETE FROM campaigns WHERE id = $1', [campaignId]);
      return res.status(402).json({
        success: false,
        error: directDeduct.error,
        insufficientBalance: true,
        balance: directDeduct.balance,
        requiredAmount: directDeduct.amount
      });
    }

    // ★ P0-3: 차감 성공 후 발송 실패 시 자동 환불 보장
    try {

    // 2. MySQL 큐에 메시지 삽입 — 회사 라인그룹 테이블 라운드로빈 분배
    const isScheduledSend = scheduled && scheduledAt;
    // ★ C1: 채널별 발송 성공 건수 추적 (블록 밖에서 선언 — 선별적 환불 계산용)
    let directSmsSentCount = 0;

    // ★ D102: 080 수신거부번호 — CT-AD 컨트롤타워 사용
    const directOpt080 = adEnabled ? await getOpt080Number(userId, companyId) : '';

    // ★ D102: prepareFieldMappings 컨트롤타워로 통합 (customer_schema 조회 + extractVarCatalog + enrichWithCustomFields)
    const directFieldMappings = await prepareFieldMappings(companyId);
    // ★ storageType 기반 동적 필터 — 직접 컬럼만 SELECT, JSONB 내부 키는 custom_fields 컬럼에서 접근 (D72)
    const directMappingCols = Object.values(directFieldMappings).filter((m: any) => m.storageType !== 'custom_fields').map((m: any) => m.column);
    const directSelectCols = [...new Set(['phone', 'custom_fields', ...directMappingCols])].join(', ');
    const directPhoneList = filteredRecipients.map((r: any) => normalizePhone(r.phone));
    const directCustomersResult = await query(
      `SELECT ${directSelectCols} FROM customers WHERE company_id = $1 AND phone = ANY($2)`,
      [companyId, directPhoneList]
    );
    const directCustomerMap = new Map<string, Record<string, any>>();
    directCustomersResult.rows.forEach((c: any) => {
      directCustomerMap.set(normalizePhone(c.phone), c);
    });

    // SMS 발송 (sms 또는 both) — ★ D72: sms-queue.ts 컨트롤타워 bulkInsertSmsQueue 사용
    if (directChannel === 'sms' || directChannel === 'both') {
      const directSmsRows: any[][] = [];
      const useNow = !isScheduledSend && !(splitEnabled && splitCount > 0);

      for (let i = 0; i < filteredRecipients.length; i++) {
        const recipient = filteredRecipients[i];
        // ★ D103: prepareSendMessage 컨트롤타워 — 변수 치환 + (광고)+080 한 함수로 통합
        const cleanPhone = normalizePhone(recipient.phone);
        const dbCustomer = directCustomerMap.get(cleanPhone) || null;
        const finalMessage = prepareSendMessage(message, dbCustomer, directFieldMappings, {
          msgType, isAd: adEnabled, opt080Number: directOpt080,
          addressBookFields: {
            name: recipient.name,
            extra1: recipient.extra1,
            extra2: recipient.extra2,
            extra3: recipient.extra3,
            callback: recipient.callback,
          },
        });

        const finalSubject = subject || '';

        // ★ C3: 분할전송 시간 계산
        let sendTime: string;
        if (isScheduledSend) {
          if (splitEnabled && splitCount > 0) {
            const batchIndex = Math.floor(i / splitCount);
            sendTime = toKoreaTimeStr(calcSplitSendTime(new Date(scheduledAt), batchIndex));
          } else {
            sendTime = toKoreaTimeStr(new Date(scheduledAt));
          }
        } else if (splitEnabled && splitCount > 0) {
          const batchIndex = Math.floor(i / splitCount);
          sendTime = toKoreaTimeStr(calcSplitSendTime(new Date(), batchIndex));
        } else {
          sendTime = '';  // useNow=true이면 bulkInsertSmsQueue에서 NOW() 사용
        }

        // ★ D103: resolveCustomerCallback 컨트롤타워
        const recipientCallback = resolveCustomerCallback(recipient, useIndividualCallback, callback);

        directSmsRows.push([
          cleanPhone, recipientCallback, finalMessage,
          toQtmsgType(msgType),
          finalSubject, sendTime, campaignId, companyId,
          (mmsImagePaths || [])[0] || '', (mmsImagePaths || [])[1] || '', (mmsImagePaths || [])[2] || ''
        ]);
      }

      directSmsSentCount = await bulkInsertSmsQueue(companyTables, directSmsRows, useNow);
    }

    // 카카오 발송 (kakao 또는 both)
    // ★ C1: per-recipient try/catch로 카카오 부분 실패 추적
    let directKakaoSentCount = 0;
    if (directChannel === 'kakao' || directChannel === 'both') {
      for (let i = 0; i < filteredRecipients.length; i++) {
        try {
          const recipient = filteredRecipients[i];
          // ★ D102: 항상 백엔드 replaceVariables 컨트롤타워 사용 (customMessages 분기 제거)
          const cleanKakaoPhone = normalizePhone(recipient.phone);
          const dbKakaoCustomer = directCustomerMap.get(cleanKakaoPhone) || null;
          const finalMessage = replaceVariables(message, dbKakaoCustomer, directFieldMappings, {
            name: recipient.name,
            extra1: recipient.extra1,
            extra2: recipient.extra2,
            extra3: recipient.extra3,
            callback: recipient.callback,
          });

          // ★ C3: 분할전송 시간 계산 (오버플로우 방지 — calcSplitSendTime 적용)
          let kakaoSendTime: string | undefined;
          if (isScheduledSend) {
            if (splitEnabled && splitCount > 0) {
              const batchIndex = Math.floor(i / splitCount);
              kakaoSendTime = toKoreaTimeStr(calcSplitSendTime(new Date(scheduledAt), batchIndex));
            } else {
              kakaoSendTime = toKoreaTimeStr(new Date(scheduledAt));
            }
          }

          // ★ D103: resolveCustomerCallback 컨트롤타워
          const recipientCallback = resolveCustomerCallback(recipient, useIndividualCallback, callback);

          await insertKakaoQueue({
            bubbleType: kakaoBubbleType || 'TEXT',
            senderKey: kakaoSenderKey || '',
            phone: normalizePhone(recipient.phone),
            targeting: kakaoTargeting || 'I',
            message: finalMessage,
            isAd: adEnabled || false,
            reservedDate: kakaoSendTime,
            attachmentJson: kakaoAttachmentJson || undefined,
            carouselJson: kakaoCarouselJson || undefined,
            resendType: directChannel === 'both' ? 'NO' : (kakaoResendType || 'SM'),
            resendFrom: recipientCallback,
            unsubscribePhone: directOpt080,
            requestUid: campaignId,
          });
          directKakaoSentCount++;
        } catch (kakaoErr) {
          console.error(`[직접발송] 카카오 INSERT 실패 (index: ${i}):`, kakaoErr);
        }
      }
    }

    // ★ C1: 총 발송 성공 건수 계산 + 부분 실패 시 선별적 환불
    // SMS 채널 실패분 환불
    if (directChannel === 'sms' || directChannel === 'both') {
      const smsFailCount = filteredRecipients.length - directSmsSentCount;
      if (smsFailCount > 0) {
        console.warn(`[직접발송] SMS 부분 실패 — 성공: ${directSmsSentCount}, 실패: ${smsFailCount} → 실패분 환불`);
        try {
          const smsDeductType = directChannel === 'kakao' ? 'KAKAO' : msgType;
          await prepaidRefund(companyId, smsFailCount, smsDeductType, campaignId, `직접발송 SMS 부분실패 ${smsFailCount}건 환불`);
        } catch (refundErr) {
          console.error('[직접발송] SMS 부분 실패 환불 오류:', refundErr);
        }
      }
    }
    // 카카오 채널 실패분 환불
    if (directChannel === 'kakao' || directChannel === 'both') {
      const kakaoFailCount = filteredRecipients.length - directKakaoSentCount;
      if (kakaoFailCount > 0) {
        console.warn(`[직접발송] 카카오 부분 실패 — 성공: ${directKakaoSentCount}, 실패: ${kakaoFailCount} → 실패분 환불`);
        try {
          await prepaidRefund(companyId, kakaoFailCount, 'KAKAO', campaignId, `직접발송 카카오 부분실패 ${kakaoFailCount}건 환불`);
        } catch (refundErr) {
          console.error('[직접발송] 카카오 부분 실패 환불 오류:', refundErr);
        }
      }
    }

    // ★ 알림톡 발송 (CT-04 insertAlimtalkQueue 사용)
    let directAlimtalkSentCount = 0;
    if (directChannel === 'alimtalk') {
      if (!alimtalkTemplateCode) {
        return res.status(400).json({ success: false, error: '알림톡 템플릿 코드가 필요합니다' });
      }

      const alimtalkRows = filteredRecipients.map((recipient: any, i: number) => {
        // ★ D102: 항상 백엔드 replaceVariables 컨트롤타워 사용
        const dbAlimCustomer = directCustomerMap.get(normalizePhone(recipient.phone)) || null;
        const finalMessage = replaceVariables(message, dbAlimCustomer, directFieldMappings, {
          name: recipient.name, extra1: recipient.extra1, extra2: recipient.extra2,
          extra3: recipient.extra3, callback: recipient.callback,
        });
        return {
          phone: normalizePhone(recipient.phone),
          callback: normalizePhone(callback),
          message: finalMessage,
          templateCode: alimtalkTemplateCode,
          nextType: alimtalkNextType || 'L',
          buttonJson: alimtalkButtonJson || null,
          companyId,
        };
      });

      try {
        directAlimtalkSentCount = await insertAlimtalkQueue(companyTables, alimtalkRows);
        console.log(`[직접발송] 알림톡 INSERT 완료: ${directAlimtalkSentCount}건`);
      } catch (alimtalkErr) {
        console.error('[직접발송] 알림톡 INSERT 실패:', alimtalkErr);
      }
    }

    // 실제 성공 건수 (채널별 최대값)
    const directTotalSent = Math.max(directSmsSentCount || 0, directKakaoSentCount || 0, directAlimtalkSentCount || 0);
    const directFailTotal = filteredRecipients.length - directTotalSent;

    // 3. 즉시발송이면 상태 업데이트 (★ #5: sending으로 설정 → sync-results에서 Agent 완료 후 completed 전환)
    // ★ C1: directTotalSent 기반으로 실제 성공 건수 반영
    if (!scheduled) {
      // 즉시발송: MySQL INSERT 완료 후 상태 설정
      // QTmsg Agent가 처리할 시간을 고려하여 sending으로 설정하되,
      // sent_count와 fail_count를 함께 기록
      const immediateStatus = directTotalSent === 0 ? 'failed' : 'sending';
      await query(
        `UPDATE campaigns SET status = $1, sent_count = $2, fail_count = $3, sent_at = NOW(), updated_at = NOW() WHERE id = $4`,
        [immediateStatus, directTotalSent, directFailTotal, campaignId]
      );
      // ★ D101: 직접발송도 campaign_runs INSERT (슈퍼관리자 캠페인 상세조회에서 데이터 필요)
      try {
        await query(
          `INSERT INTO campaign_runs (campaign_id, run_number, target_count, sent_count, status, sent_at, created_at)
           VALUES ($1, 1, $2, $3, $4, NOW(), NOW())`,
          [campaignId, filteredRecipients.length, directTotalSent, immediateStatus]
        );
      } catch (runErr) {
        console.warn('[direct-send] campaign_runs INSERT 실패 (발송에 영향 없음):', runErr);
      }
    }

    // ★ AI 학습 데이터 적재 — 직접발송 (비동기, 실패해도 발송에 영향 없음)
    const directCompanyInfo = await query('SELECT name, brand_tone FROM companies WHERE id = $1', [companyId]);
    logTrainingData({
      campaignRunId: campaignId,
      companyId,
      companyName: directCompanyInfo.rows[0]?.name,
      brandTone: directCompanyInfo.rows[0]?.brand_tone,
      targetCount: filteredRecipients.length,
      messageType: msgType,
      isAd: adEnabled || false,
      finalMessage: message || '',
      finalSource: 'manual',
      sendAt: scheduled && scheduledAt ? new Date(scheduledAt) : new Date(),
    });

    res.json({
      success: true,
      campaignId,
      sentCount: directTotalSent,
      failCount: directFailTotal,
      unsubscribeCount: excludedCount,
      duplicateCount,
      callbackSkippedCount,
      callbackMissingCount,
      callbackUnregisteredCount,
      message: `${directTotalSent}건 발송 ${scheduled ? '예약' : '완료'}${duplicateCount > 0 ? ` (중복 ${duplicateCount}건 제거)` : ''}${directFailTotal > 0 ? ` (${directFailTotal}건 실패, 자동 환불)` : ''}${excludedCount > 0 ? ` (수신거부 ${excludedCount}건 제외)` : ''}${callbackMissingCount > 0 ? ` (회신번호 없음 ${callbackMissingCount}명 제외)` : ''}${callbackUnregisteredCount > 0 ? ` (미등록 회신번호 ${callbackUnregisteredCount}명 제외)` : ''}`
    });

    } catch (sendError) {
      // ★ C1: 전체 실패 (루프 진입 전 오류 등) — 전액 환불
      console.error('[직접발송] 큐 처리 전체 실패 — 차감 환불 처리:', sendError);
      try {
        await prepaidRefund(companyId, filteredRecipients.length, directDeductType, campaignId, '발송 전체 실패 자동 환불');
        await query(`UPDATE campaigns SET status = 'failed', updated_at = NOW() WHERE id = $1`, [campaignId]);
      } catch (refundErr) {
        console.error('[직접발송] 환불 처리 중 추가 오류:', refundErr);
      }
      return res.status(500).json({ success: false, error: '발송 처리 중 오류가 발생했습니다. 차감된 금액은 자동 환불됩니다.' });
    }

  } catch (error) {
    console.error('직접발송 실패:', error);
    res.status(500).json({ success: false, error: '발송 실패' });
  }
});

// 예약 취소 — ★ utils/campaign-lifecycle.ts 컨트롤타워 사용
router.post('/:id/cancel', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const userId = (req as any).user?.userId;
    const campaignId = req.params.id;

    const result = await cancelCampaign(campaignId, companyId, {
      cancelledBy: userId,
      cancelledByType: (req as any).user?.userType,
    });

    if (!result.success) {
      const status = result.tooLate ? 400 : (result.error === '캠페인을 찾을 수 없습니다' ? 404 : 400);
      return res.status(status).json({ success: false, error: result.error, tooLate: result.tooLate });
    }

    res.json({ success: true, message: '예약이 취소되었습니다' });
  } catch (error) {
    console.error('예약 취소 실패:', error);
    res.status(500).json({ success: false, error: '취소 실패' });
  }
});

// 예약 캠페인 수신자 조회
router.get('/:id/recipients', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const userId = (req as any).user?.userId;
    const userType = (req as any).user?.userType;
    const campaignId = req.params.id;
    const { search } = req.query;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;

    // 캠페인 확인
    const campaign = await query(
      `SELECT * FROM campaigns WHERE id = $1 AND company_id = $2`,
      [campaignId, companyId]
    );

    if (campaign.rows.length === 0) {
      return res.status(404).json({ success: false, error: '캠페인을 찾을 수 없습니다' });
    }

    const camp = campaign.rows[0];

    // 예약 상태면 먼저 MySQL 회사 라인그룹 테이블에서 조회 시도
    const recipientTables = await getCompanySmsTables(companyId);
    if (camp.status === 'scheduled') {
      // 검색 조건
      const searchCondition = search ? ` AND dest_no LIKE ?` : '';
      const searchParams = search ? [campaignId, `%${normalizePhone(String(search))}%`] : [campaignId];

      const mysqlRecipients = await smsSelectAll(recipientTables,
        'seqno as idx, dest_no as phone, call_back as callback, msg_contents as message',
        `app_etc1 = ? AND status_code = 100${searchCondition}`,
        searchParams,
        `ORDER BY seqno LIMIT ${limit} OFFSET ${offset}`
      );

      // MySQL에 데이터 있으면 그걸 반환
      if (mysqlRecipients && (mysqlRecipients.length > 0 || offset > 0 || search)) {
        const totalCount = await smsCountAll(recipientTables, `app_etc1 = ? AND status_code = 100${searchCondition}`, searchParams);

        return res.json({
          success: true,
          campaign: camp,
          recipients: mysqlRecipients,
          total: totalCount,
          hasMore: offset + limit < totalCount
        });
      }
    }

    // draft 상태이거나 MySQL에 데이터 없으면 PostgreSQL customers에서 조회
    if (camp.status === 'scheduled' || camp.status === 'draft') {
      const targetFilter = camp.target_filter || {};
      const filterQuery = buildFilterQueryCompat(targetFilter, companyId);
      const excludedPhones = camp.excluded_phones || [];

      // store_codes 필터
      // ★ B16-01: store_codes 없는 company_user → 빈 결과
      // ★ B16-01: 브랜드 격리 — store-scope 컨트롤타워
      let storeFilter = '';
      let storeParams: any[] = [];
      if (userType === 'company_user' && userId) {
        const scope = await getStoreScope(companyId, userId);
        if (scope.type === 'filtered') {
          const storeIdx = 1 + filterQuery.params.length + 1;
          storeFilter = ` AND id IN (SELECT customer_id FROM customer_stores WHERE company_id = $1 AND store_code = ANY($${storeIdx}::text[]))`;
          storeParams = [scope.storeCodes];
        } else if (scope.type === 'blocked') {
          return res.status(403).json({ error: '소속 브랜드가 지정되지 않았습니다. 관리자에게 문의하세요.' });
        }
      }

      // 검색 필터
      let searchFilter = '';
      let searchParams: any[] = [];
      if (search) {
        const searchIdx = 1 + filterQuery.params.length + storeParams.length + 1;
        searchFilter = ` AND (phone LIKE $${searchIdx} OR name LIKE $${searchIdx})`;
        searchParams = [`%${search}%`];
      }

      // excluded_phones 필터
      let excludeFilter = '';
      let excludeParams: any[] = [];
      if (excludedPhones.length > 0) {
        const excludeIdx = 1 + filterQuery.params.length + storeParams.length + searchParams.length + 1;
        excludeFilter = ` AND phone NOT IN (SELECT UNNEST($${excludeIdx}::text[]))`;
        excludeParams = [excludedPhones];
      }

      // ★ B17-01 수정: 수신거부 기준 user_id로 통일 (080 자동연동과 일관성 유지)
      const unsubIdx = 1 + filterQuery.params.length + storeParams.length + searchParams.length + excludeParams.length + 1;
      const countResult = await query(
        `SELECT COUNT(*) FROM customers c
         WHERE c.company_id = $1 AND c.is_active = true AND c.sms_opt_in = true
         ${filterQuery.where}${storeFilter}${searchFilter}${excludeFilter}
         AND NOT EXISTS (SELECT 1 FROM unsubscribes u WHERE u.user_id = $${unsubIdx} AND u.phone = c.phone)`,
        [companyId, ...filterQuery.params, ...storeParams, ...searchParams, ...excludeParams, userId]
      );
      const total = parseInt(countResult.rows[0].count);

      // 수신자 목록 (상위 10개)
      const limitIdx = unsubIdx + 1;
      const recipients = await query(
        `SELECT phone, name, phone as idx
         FROM customers c
         WHERE c.company_id = $1 AND c.is_active = true AND c.sms_opt_in = true
         ${filterQuery.where}${storeFilter}${searchFilter}${excludeFilter}
         AND NOT EXISTS (SELECT 1 FROM unsubscribes u WHERE u.user_id = $${unsubIdx} AND u.phone = c.phone)
         ORDER BY name, phone
         LIMIT $${limitIdx}`,
        [companyId, ...filterQuery.params, ...storeParams, ...searchParams, ...excludeParams, userId, 10]
      );

      return res.json({
        success: true,
        campaign: camp,
        recipients: recipients.rows,
        total
      });
    }

    // 발송 완료/진행중이면 MySQL 회사 라인그룹 테이블에서 조회
    const searchCondition2 = search ? ` AND dest_no LIKE ?` : '';
    const searchParams2 = search ? [campaignId, `%${normalizePhone(String(search))}%`] : [campaignId];

    const recipients = await smsSelectAll(recipientTables,
      'seqno as idx, dest_no as phone, call_back as callback, msg_contents as message, sendreq_time, status_code',
      `app_etc1 = ? AND status_code = 100${searchCondition2}`,
      searchParams2,
      `ORDER BY seqno LIMIT ${limit} OFFSET ${offset}`
    );

    const totalCount = await smsCountAll(recipientTables, `app_etc1 = ? AND status_code = 100${searchCondition2}`, searchParams2);

    res.json({
      success: true,
      campaign: camp,
      recipients: recipients,
      total: totalCount,
      hasMore: offset + limit < totalCount
    });
  } catch (error) {
    console.error('수신자 조회 실패:', error);
    res.status(500).json({ success: false, error: '조회 실패' });
  }
});

// 예약 캠페인 개별 수신자 삭제
router.delete('/:id/recipients/:idx', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const campaignId = req.params.id;
    const phone = req.params.idx; // idx가 아니라 phone으로 사용

    // 캠페인 확인
    const campaign = await query(
      `SELECT * FROM campaigns WHERE id = $1 AND company_id = $2 AND status = 'scheduled'`,
      [campaignId, companyId]
    );

    if (campaign.rows.length === 0) {
      return res.status(404).json({ success: false, error: '예약 캠페인을 찾을 수 없습니다' });
    }

    // 15분 이내 체크
    const scheduledAt = new Date(campaign.rows[0].scheduled_at);
    const now = new Date();
    const diffMinutes = (scheduledAt.getTime() - now.getTime()) / (1000 * 60);
    if (diffMinutes < 15) {
      return res.status(400).json({ success: false, error: '발송 15분 전에는 수정할 수 없습니다', tooLate: true });
    }

    // MySQL 회사 라인그룹 테이블에서 데이터 있는지 확인
    const delTables = await getCompanySmsTables(companyId);
    const mysqlCount = await smsCountAll(delTables, 'app_etc1 = ? AND status_code = 100', [campaignId]);

    if (mysqlCount > 0) {
      // 회사 테이블에서 삭제
      await smsExecAll(delTables,
        `DELETE FROM SMSQ_SEND WHERE app_etc1 = ? AND dest_no = ? AND status_code = 100`,
        [campaignId, phone]
      );

      const remainingCount = await smsCountAll(delTables, 'app_etc1 = ? AND status_code = 100', [campaignId]);

      await query(
        `UPDATE campaigns SET target_count = $1, updated_at = NOW() WHERE id = $2`,
        [remainingCount, campaignId]
      );

      return res.json({ success: true, message: '삭제되었습니다', remainingCount });
    }

    // MySQL에 없으면 excluded_phones에 추가
    await query(
      `UPDATE campaigns SET excluded_phones = array_append(excluded_phones, $1), target_count = target_count - 1, updated_at = NOW() WHERE id = $2`,
      [phone, campaignId]
    );

    const updated = await query(`SELECT target_count FROM campaigns WHERE id = $1`, [campaignId]);

    res.json({ success: true, message: '삭제되었습니다', remainingCount: updated.rows[0]?.target_count || 0 });
  } catch (error) {
    console.error('수신자 삭제 실패:', error);
    res.status(500).json({ success: false, error: '삭제 실패' });
  }
});

// 예약 시간 수정
router.put('/:id/reschedule', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const campaignId = req.params.id;
    const { scheduledAt } = req.body;

    // 캠페인 확인
    const campaign = await query(
      `SELECT * FROM campaigns WHERE id = $1 AND company_id = $2 AND status = 'scheduled'`,
      [campaignId, companyId]
    );

    if (campaign.rows.length === 0) {
      return res.status(404).json({ success: false, error: '예약 캠페인을 찾을 수 없습니다' });
    }

    // 새 예약 시간 검증: 현재 + 15분 이후만 허용
    const newScheduledAt = new Date(scheduledAt);
    const nowCheck = new Date();
    if ((newScheduledAt.getTime() - nowCheck.getTime()) / (1000 * 60) < 15) {
      return res.status(400).json({ success: false, error: '현재 시간 + 15분 이후로만 변경 가능합니다' });
    }

    // 15분 이내 체크
    const currentScheduledAt = new Date(campaign.rows[0].scheduled_at);
    const now = new Date();
    const diffMinutes = (currentScheduledAt.getTime() - now.getTime()) / (1000 * 60);
    if (diffMinutes < 15) {
      return res.status(400).json({ success: false, error: '발송 15분 전에는 시간을 변경할 수 없습니다', tooLate: true });
    }

    // 1. 회사 라인그룹 테이블에서 MIN(sendreq_time) 찾기
    const reschTables = await getCompanySmsTables(companyId);
    const currentMinTime = await smsMinAll(reschTables, 'sendreq_time', 'app_etc1 = ? AND status_code = 100', [campaignId]);

    // MySQL에 데이터 있으면 시간 조정 (분할전송 간격 유지)
    if (currentMinTime) {
      const newTime = new Date(scheduledAt);
      const diffSeconds = Math.round((newTime.getTime() - new Date(currentMinTime).getTime()) / 1000);

      await smsExecAll(reschTables,
        `UPDATE SMSQ_SEND SET sendreq_time = DATE_ADD(sendreq_time, INTERVAL ? SECOND) WHERE app_etc1 = ? AND status_code = 100`,
        [diffSeconds, campaignId]
      );
    }

    // PostgreSQL 캠페인 업데이트 (항상 실행)
    await query(
      `UPDATE campaigns SET scheduled_at = $1, updated_at = NOW() WHERE id = $2`,
      [new Date(scheduledAt), campaignId]
    );

    res.json({ success: true, message: '예약 시간이 변경되었습니다' });
  } catch (error) {
    console.error('예약 시간 수정 실패:', error);
    res.status(500).json({ success: false, error: '수정 실패' });
  }
});
// 예약 캠페인 문안 수정
router.put('/:id/message', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const campaignId = req.params.id;
    const { message, subject } = req.body;

    // 캠페인 확인
    const campaign = await query(
      `SELECT * FROM campaigns WHERE id = $1 AND company_id = $2 AND status = 'scheduled'`,
      [campaignId, companyId]
    );

    if (campaign.rows.length === 0) {
      return res.status(404).json({ success: false, error: '예약 캠페인을 찾을 수 없습니다' });
    }

    // LMS/MMS는 제목 필수
    const campMsgType = campaign.rows[0].message_type;
    if ((campMsgType === 'LMS' || campMsgType === 'MMS') && (!subject || !subject.trim())) {
      return res.status(400).json({ success: false, error: 'LMS/MMS는 제목이 필수입니다' });
    }

    // 15분 이내 체크
    const currentScheduledAt = new Date(campaign.rows[0].scheduled_at);
    const now = new Date();
    const diffMinutes = (currentScheduledAt.getTime() - now.getTime()) / (1000 * 60);
    if (diffMinutes < 15) {
      return res.status(400).json({ success: false, error: '발송 15분 전에는 수정할 수 없습니다', tooLate: true });
    }

    // 1. MySQL 회사 라인그룹 테이블에서 수신자 목록 조회 (전화번호, seqno, 테이블명 포함)
    const msgTables = await getCompanySmsTables(companyId);
    const recipients = await smsSelectAll(msgTables,
      'seqno, dest_no',
      'app_etc1 = ? AND status_code = 100',
      [campaignId]
    );

    // MySQL에 데이터 없으면 PostgreSQL만 업데이트 (예약 상태)
    if (recipients.length === 0) {
      await query(
        `UPDATE campaigns SET message_template = $1, message_subject = $2, message_content = $3, updated_at = NOW() WHERE id = $4`,
        [message, subject || null, message, campaignId]
      );
      return res.json({ success: true, message: '문안이 수정되었습니다 (발송 시 적용)' });
    }

    // ★ D102: prepareFieldMappings 컨트롤타워로 통합 (customer_schema 조회 + extractVarCatalog + enrichWithCustomFields)
    const editFieldMappings = await prepareFieldMappings(companyId);

    // ★ D32: 동적 컬럼 SELECT — fieldMappings에서 필요한 컬럼 자동 추출
    const editBaseColumns = ['phone', 'custom_fields'];
    // ★ storageType 기반 동적 필터 — 직접 컬럼만 SELECT, JSONB 내부 키는 custom_fields 컬럼에서 접근 (D72)
    const editMappingColumns = Object.values(editFieldMappings).filter((m: VarCatalogEntry) => m.storageType !== 'custom_fields').map((m: VarCatalogEntry) => m.column);
    const editSelectColumns = [...new Set([...editBaseColumns, ...editMappingColumns])].join(', ');

    const phones = recipients.map((r: any) => r.dest_no);
    const customersResult = await query(
      `SELECT ${editSelectColumns} FROM customers WHERE company_id = $1 AND phone = ANY($2)`,
      [companyId, phones]
    );

    // 전화번호 → 고객정보 맵
    const customerMap = new Map();
    customersResult.rows.forEach((c: any) => {
      customerMap.set(c.phone, c);
    });

    /// 3. ★ B17-11: 광고 문구 처리 — users 우선 → companies fallback
    const adEnabled = campaign.rows[0].is_ad === true;
    const msgType = campaign.rows[0].message_type;
    // ★ D102: 080 수신거부번호 — CT-AD 컨트롤타워 사용
    const campUserId = campaign.rows[0].user_id;
    const optOut080 = adEnabled ? await getOpt080Number(campUserId, companyId) : '';

    // 4. 테이블별로 그룹핑 후 Bulk UPDATE
    const tableGroups: Record<string, any[]> = {};
    for (const r of recipients) {
      const table = r._sms_table;
      if (!tableGroups[table]) tableGroups[table] = [];
      tableGroups[table].push(r);
    }

    const batchSize = BATCH_SIZES.messageUpdate;
    let processedCount = 0;

    // Redis에 진행률 저장 (공유 인스턴스 사용)
    await redis.set(`message_edit:${campaignId}:progress`, JSON.stringify({
      total: recipients.length,
      processed: 0,
      percent: 0
    }), 'EX', CACHE_TTL.messageEditProgress);

    for (const [table, tableRecipients] of Object.entries(tableGroups)) {
      for (let i = 0; i < tableRecipients.length; i += batchSize) {
        const batch = tableRecipients.slice(i, i + batchSize);

        // CASE WHEN 으로 배치 업데이트
        const cases: string[] = [];
        const titleCases: string[] = [];
        const seqnos: number[] = [];

        for (const recipient of batch) {
          const customer = customerMap.get(recipient.dest_no) || {};

          // ★ D103: prepareSendMessage 컨트롤타워 — 변수 치환 + (광고)+080 한 함수로 통합
          const finalMessage = prepareSendMessage(message, customer, editFieldMappings, {
            msgType, isAd: adEnabled, opt080Number: optOut080,
          });

          // SQL escape
          const escapedMessage = finalMessage.replace(/'/g, "''");
          cases.push(`WHEN seqno = ${recipient.seqno} THEN '${escapedMessage}'`);

          // ★ D28: 제목은 고정값 그대로 사용 (머지 치환 완전 제거)
          if (subject && (msgType === 'LMS' || msgType === 'MMS')) {
            const escapedSubject = subject.replace(/'/g, "''");
            titleCases.push(`WHEN seqno = ${recipient.seqno} THEN '${escapedSubject}'`);
          }

          seqnos.push(recipient.seqno);
        }

        // Bulk UPDATE 실행 (테이블별)
        let updateQuery = `
          UPDATE ${table}
          SET msg_contents = CASE ${cases.join(' ')} END
        `;

        if (titleCases.length > 0) {
          updateQuery += `, title_str = CASE ${titleCases.join(' ')} END`;
        }

        updateQuery += ` WHERE seqno IN (${seqnos.join(',')}) AND status_code = 100`;

        await mysqlQuery(updateQuery, []);

        processedCount += batch.length;

        // 진행률 업데이트
        await redis.set(`message_edit:${campaignId}:progress`, JSON.stringify({
          total: recipients.length,
          processed: processedCount,
          percent: Math.round((processedCount / recipients.length) * 100)
        }), 'EX', CACHE_TTL.messageEditProgress);
      }
    }

    // 5. PostgreSQL 캠페인 템플릿 업데이트
    await query(
      `UPDATE campaigns SET message_template = $1, message_subject = $2, message_content = $3, updated_at = NOW() WHERE id = $4`,
      [message, subject || null, message, campaignId]
    );

    res.json({
      success: true,
      message: '문안이 수정되었습니다',
      updatedCount: processedCount
    });
  } catch (error) {
    console.error('문안 수정 실패:', error);
    res.status(500).json({ success: false, error: '문안 수정 실패' });
  }
});

// 문안 수정 진행률 조회
router.get('/:id/message/progress', async (req: Request, res: Response) => {
  try {
    const campaignId = req.params.id;
    const data = await redis.get(`message_edit:${campaignId}:progress`);

    if (data) {
      return res.json(JSON.parse(data));
    }
    return res.json({ total: 0, processed: 0, percent: 100 });
  } catch (error) {
    return res.json({ total: 0, processed: 0, percent: 100 });
  }
});

// ★ draft 캠페인 예약 취소 (상태를 cancelled로 변경, 기록 보존)
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;
    const campaignId = req.params.id;

    if (!companyId) {
      return res.status(403).json({ success: false, error: '고객사 권한이 필요합니다.' });
    }

    // 캠페인 조회 — 소유권 확인
    const campResult = await query(
      `SELECT id, status, campaign_name, created_by, scheduled_at FROM campaigns WHERE id = $1 AND company_id = $2`,
      [campaignId, companyId]
    );

    if (campResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: '캠페인을 찾을 수 없습니다.' });
    }

    const campaign = campResult.rows[0];

    // company_user는 본인이 만든 캠페인만 취소 가능
    if (userType === 'company_user' && campaign.created_by !== userId) {
      return res.status(403).json({ success: false, error: '본인이 생성한 캠페인만 취소할 수 있습니다.' });
    }

    // draft 상태만 이 엔드포인트로 취소 허용 (scheduled는 POST /:id/cancel 사용)
    if (campaign.status !== 'draft') {
      return res.status(400).json({
        success: false,
        error: `'${campaign.status}' 상태의 캠페인은 이 방법으로 취소할 수 없습니다.`
      });
    }

    // 예약 시간 체크 — 이미 지난 캠페인은 취소 불가
    if (campaign.scheduled_at && new Date(campaign.scheduled_at) <= new Date()) {
      return res.status(400).json({
        success: false,
        error: '예약 시간이 이미 지난 캠페인은 취소할 수 없습니다.'
      });
    }

    // 15분 이내 제한 — 예약 시간 15분 전부터 취소 불가
    if (campaign.scheduled_at) {
      const timeUntilSend = new Date(campaign.scheduled_at).getTime() - Date.now();
      if (timeUntilSend < 15 * 60 * 1000) {
        return res.status(400).json({
          success: false,
          error: '발송 15분 전부터는 취소할 수 없습니다.',
          tooLate: true
        });
      }
    }

    // 상태를 cancelled로 변경 (기록 보존)
    await query(
      `UPDATE campaigns SET status = 'cancelled', updated_at = NOW() WHERE id = $1 AND company_id = $2`,
      [campaignId, companyId]
    );

    console.log(`[캠페인취소-draft] campaign_id=${campaignId}, name="${campaign.campaign_name}", by user=${userId}`);

    return res.json({ success: true, message: '예약이 취소되었습니다.' });

  } catch (error) {
    console.error('[캠페인취소-draft] 오류:', error);
    return res.status(500).json({ success: false, error: '캠페인 취소 중 오류가 발생했습니다.' });
  }
});

// ============================================================
// POST /brand-send — 브랜드메시지 발송 (CT-12 컨트롤타워)
// ============================================================
router.post('/brand-send', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    if (!companyId || !userId) {
      return res.status(401).json({ error: '인증 필요' });
    }

    const {
      mode,           // 'free' (자유형) | 'template' (기본형)
      bubbleType,     // TEXT, IMAGE, WIDE, ...
      senderKey,
      targeting,
      isAd,
      phones,         // string[]
      message,
      header,
      additionalContent,
      buttons,
      image,
      coupon,
      commerce,
      video,
      itemList,
      carouselHead,
      carouselItems,
      carouselTail,
      resendType,
      resendFrom,
      resendMessage,
      resendTitle,
      unsubscribePhone,
      unsubscribeAuth,
      reservedDate,
      // 기본형(템플릿) 전용
      templateCode,
      messageVariableJson,
      buttonVariableJson,
      couponVariableJson,
      imageVariableJson,
      videoVariableJson,
      commerceVariableJson,
      carouselVariableJson,
    } = req.body;

    if (!phones || !Array.isArray(phones) || phones.length === 0) {
      return res.status(400).json({ error: '수신자 목록이 필요합니다' });
    }

    // 캠페인 레코드 생성
    const campaignResult = await query(
      `INSERT INTO campaigns (company_id, user_id, name, message_content, message_type, send_channel, status, created_at)
       VALUES ($1, $2, $3, $4, 'LMS', 'kakao_brand', 'sending', NOW())
       RETURNING id`,
      [companyId, userId, `브랜드메시지 ${bubbleType || 'TEXT'}`, message || `[${bubbleType}] 브랜드메시지`]
    );
    const campaignId = campaignResult.rows[0].id;

    const baseParams = {
      bubbleType: bubbleType || 'TEXT',
      senderKey,
      phones,
      targeting: targeting || 'I',
      isAd: isAd ?? true,
      companyId,
      userId,
      message,
      header,
      additionalContent,
      buttons,
      image,
      coupon,
      commerce,
      video,
      itemList,
      carouselHead,
      carouselItems,
      carouselTail,
      resendType,
      resendFrom,
      resendMessage,
      resendTitle,
      unsubscribePhone,
      unsubscribeAuth,
      reservedDate,
      campaignId,
    };

    let result;
    if (mode === 'template') {
      const { sendBrandMessageTemplate } = await import('../utils/brand-message');
      result = await sendBrandMessageTemplate({
        ...baseParams,
        templateCode,
        messageVariableJson,
        buttonVariableJson,
        couponVariableJson,
        imageVariableJson,
        videoVariableJson,
        commerceVariableJson,
        carouselVariableJson,
      });
    } else {
      const { sendBrandMessage } = await import('../utils/brand-message');
      result = await sendBrandMessage(baseParams);
    }

    if (!result.success) {
      // 실패 시 캠페인 상태 변경
      await query(`UPDATE campaigns SET status = 'failed' WHERE id = $1`, [campaignId]);
      return res.status(400).json({ error: result.error });
    }

    // 성공 시 캠페인 업데이트
    await query(
      `UPDATE campaigns SET status = 'completed', target_count = $1 WHERE id = $2`,
      [result.sentCount, campaignId]
    );

    // campaign_runs INSERT
    await query(
      `INSERT INTO campaign_runs (campaign_id, company_id, total_sent, total_success, sent_at)
       VALUES ($1, $2, $3, $3, NOW())`,
      [campaignId, companyId, result.sentCount]
    );

    return res.json({
      success: true,
      campaignId,
      sentCount: result.sentCount,
      failCount: result.failCount,
    });
  } catch (error) {
    console.error('[brand-send] 에러:', error);
    return res.status(500).json({ error: '브랜드메시지 발송 중 오류가 발생했습니다.' });
  }
});

export default router;
