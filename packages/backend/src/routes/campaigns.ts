import { Router, Request, Response } from 'express';
import { query, mysqlQuery } from '../config/database';
import { authenticate } from '../middlewares/auth';
import { extractVarCatalog, validatePersonalizationVars, VarCatalogEntry } from '../services/ai';
import { buildGenderFilter, buildGradeFilter, buildRegionFilter, getGenderVariants, getGradeVariants, getRegionVariants } from '../utils/normalize';

// 한국시간 문자열 변환 (MySQL datetime 형식)
const toKoreaTimeStr = (date: Date) => {
  return date.toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).replace('T', ' ');
};

// ===== 라인그룹 기반 Agent 발송 설정 =====
// 환경변수: 서버에 연결된 전체 테이블 목록 (폴백용)
const ALL_SMS_TABLES = (process.env.SMS_TABLES || 'SMSQ_SEND').split(',').map(t => t.trim());
let rrIndex = 0;
console.log(`[QTmsg] ALL_SMS_TABLES: ${ALL_SMS_TABLES.join(', ')} (${ALL_SMS_TABLES.length}개 Agent)`);

// 라인그룹 캐시 (1분 TTL)
const lineGroupCache = new Map<string, { tables: string[], expires: number }>();
const LINE_GROUP_CACHE_TTL = 60 * 1000;

// 회사별 발송 테이블 조회 (캐시)
async function getCompanySmsTables(companyId: string): Promise<string[]> {
  const cacheKey = `company:${companyId}`;
  const cached = lineGroupCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.tables;

  const result = await query(`
    SELECT lg.sms_tables
    FROM sms_line_groups lg
    JOIN companies c ON c.line_group_id = lg.id
    WHERE c.id = $1 AND lg.is_active = true AND lg.group_type = 'bulk'
  `, [companyId]);

  const tables = (result.rows.length > 0 && result.rows[0].sms_tables?.length > 0)
    ? result.rows[0].sms_tables
    : ALL_SMS_TABLES;

  lineGroupCache.set(cacheKey, { tables, expires: Date.now() + LINE_GROUP_CACHE_TTL });
  return tables;
}

// 테스트 발송 테이블 조회 (캐시)
async function getTestSmsTables(): Promise<string[]> {
  const cached = lineGroupCache.get('test');
  if (cached && cached.expires > Date.now()) return cached.tables;

  const result = await query(`SELECT sms_tables FROM sms_line_groups WHERE group_type = 'test' AND is_active = true LIMIT 1`);
  const tables = (result.rows.length > 0 && result.rows[0].sms_tables?.length > 0)
    ? result.rows[0].sms_tables
    : ALL_SMS_TABLES;

  lineGroupCache.set('test', { tables, expires: Date.now() + LINE_GROUP_CACHE_TTL });
  return tables;
}

// 인증번호 발송 테이블 조회 (캐시)
async function getAuthSmsTable(): Promise<string> {
  const cached = lineGroupCache.get('auth');
  if (cached && cached.expires > Date.now()) return cached.tables[0];

  const result = await query(`SELECT sms_tables FROM sms_line_groups WHERE group_type = 'auth' AND is_active = true LIMIT 1`);
  const tables = (result.rows.length > 0 && result.rows[0].sms_tables?.length > 0)
    ? result.rows[0].sms_tables
    : [ALL_SMS_TABLES[0]];

  lineGroupCache.set('auth', { tables, expires: Date.now() + LINE_GROUP_CACHE_TTL });
  return tables[0];
}

// 캐시 무효화 (라인그룹 설정 변경 시 호출)
function invalidateLineGroupCache(companyId?: string) {
  if (companyId) {
    lineGroupCache.delete(`company:${companyId}`);
  } else {
    lineGroupCache.clear();
  }
}

// INSERT용: 라운드로빈으로 다음 테이블 반환
function getNextSmsTable(tables: string[]): string {
  const table = tables[rrIndex % tables.length];
  rrIndex++;
  return table;
}

// COUNT 합산
async function smsCountAll(tables: string[], whereClause: string, params: any[]): Promise<number> {
  let total = 0;
  for (const t of tables) {
    const rows = await mysqlQuery(`SELECT COUNT(*) as cnt FROM ${t} WHERE ${whereClause}`, params) as any[];
    total += Number(rows[0]?.cnt || 0);
  }
  return total;
}

// 집계 합산
async function smsAggAll(tables: string[], selectFields: string, whereClause: string, params: any[]): Promise<any> {
  const agg: any = {};
  for (const t of tables) {
    const rows = await mysqlQuery(`SELECT ${selectFields} FROM ${t} WHERE ${whereClause}`, params) as any[];
    if (rows[0]) {
      for (const k of Object.keys(rows[0])) {
        agg[k] = (agg[k] || 0) + (Number(rows[0][k]) || 0);
      }
    }
  }
  return agg;
}

// SELECT 합산
async function smsSelectAll(tables: string[], selectFields: string, whereClause: string, params: any[], suffix?: string): Promise<any[]> {
  let all: any[] = [];
  for (const t of tables) {
    const rows = await mysqlQuery(`SELECT ${selectFields} FROM ${t} WHERE ${whereClause} ${suffix || ''}`, params) as any[];
    all = all.concat(rows.map((r: any) => ({ ...r, _sms_table: t })));
  }
  return all;
}

// MIN 합산
async function smsMinAll(tables: string[], field: string, whereClause: string, params: any[]): Promise<any> {
  let minVal: any = null;
  for (const t of tables) {
    const rows = await mysqlQuery(`SELECT MIN(${field}) as min_val FROM ${t} WHERE ${whereClause}`, params) as any[];
    const val = rows[0]?.min_val;
    if (val && (!minVal || new Date(val) < new Date(minVal))) {
      minVal = val;
    }
  }
  return minVal;
}

// DELETE/UPDATE: 해당 테이블 모두 실행
async function smsExecAll(tables: string[], sqlTemplate: string, params: any[]): Promise<void> {
  for (const t of tables) {
    await mysqlQuery(sqlTemplate.replace(/SMSQ_SEND/g, t), params);
  }
}

// export for other modules
export { getCompanySmsTables, getTestSmsTables, getAuthSmsTable, invalidateLineGroupCache, ALL_SMS_TABLES, smsCountAll, smsAggAll, smsSelectAll, smsExecAll };
// ===== 라인그룹 헬퍼 끝 =====

// ===== 카카오 브랜드메시지 발송 헬퍼 =====
// IMC_BM_FREE_BIZ_MSG 테이블에 INSERT (자유형 브랜드메시지)
async function insertKakaoQueue(params: {
  bubbleType: string;       // TEXT, IMAGE, WIDE 등
  senderKey: string;        // 발신 프로필 키
  phone: string;            // 수신번호
  targeting: string;        // I/M/N
  message: string;          // 메시지 내용
  isAd: boolean;            // 광고 여부
  reservedDate?: string;    // 예약 시간 (YYYY-MM-DD HH:mm:ss)
  attachmentJson?: string;  // 버튼/이미지/쿠폰 JSON
  carouselJson?: string;    // 캐러셀 JSON
  header?: string;          // 헤더 (강조표기)
  resendType?: string;      // 대체발송 유형 SM/LM/NO
  resendFrom?: string;      // 대체발송 발신번호
  resendMessage?: string;   // 대체발송 메시지 (null이면 카카오 메시지 재사용)
  resendTitle?: string;     // 대체발송 제목 (LMS)
  unsubscribePhone?: string;// 080 수신거부 번호
  unsubscribeAuth?: string; // 080 인증번호
  requestUid?: string;      // 고유 요청 ID (campaign_id 등)
}): Promise<void> {
  const {
    bubbleType, senderKey, phone, targeting, message, isAd,
    reservedDate, attachmentJson, carouselJson, header,
    resendType = 'SM', resendFrom, resendMessage, resendTitle,
    unsubscribePhone, unsubscribeAuth, requestUid
  } = params;

  // 예약시간: 없으면 즉시발송 (현재 시간)
  const reservedDateStr = reservedDate || toKoreaTimeStr(new Date());
  // 대체발송 메시지 재사용 여부: resendMessage가 없으면 카카오 메시지 그대로 사용
  const messageReuse = resendMessage ? 'N' : 'Y';

  await mysqlQuery(
    `INSERT INTO IMC_BM_FREE_BIZ_MSG (
      CHAT_BUBBLE_TYPE, STATUS, AD_FLAG, RESERVED_DATE,
      SENDER_KEY, PHONE_NUMBER, TARGETING,
      HEADER, MESSAGE, ATTACHMENT_JSON, CAROUSEL_JSON,
      RESEND_MT_TYPE, RESEND_MT_FROM, RESEND_MT_TITLE,
      RESEND_MT_MESSAGE_REUSE, RESEND_MT_MESSAGE,
      UNSUBSCRIBE_PHONE_NUMBER, UNSUBSCRIBE_AUTH_NUMBER,
      REQUEST_UID
    ) VALUES (?, '1', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      bubbleType,
      isAd ? 'Y' : 'N',
      reservedDateStr,
      senderKey,
      phone,
      targeting,
      header || null,
      message,
      attachmentJson || null,
      carouselJson || null,
      resendType,
      resendFrom || null,
      resendTitle || null,
      messageReuse,
      resendMessage || null,
      unsubscribePhone || null,
      unsubscribeAuth || null,
      requestUid || null
    ]
  );
}

// 카카오 발송 결과 집계 (IMC_BM_FREE_BIZ_MSG)
async function kakaoAgg(whereClause: string, params: any[]): Promise<{ total: number; success: number; fail: number; pending: number }> {
  const rows = await mysqlQuery(
    `SELECT
       COUNT(*) as total,
       COUNT(CASE WHEN REPORT_CODE = '0000' THEN 1 END) as success,
       COUNT(CASE WHEN REPORT_CODE IS NOT NULL AND REPORT_CODE != '0000' THEN 1 END) as fail,
       COUNT(CASE WHEN REPORT_CODE IS NULL AND STATUS = '1' THEN 1 END) as pending
     FROM IMC_BM_FREE_BIZ_MSG WHERE ${whereClause}`,
    params
  ) as any[];
  return {
    total: Number(rows[0]?.total || 0),
    success: Number(rows[0]?.success || 0),
    fail: Number(rows[0]?.fail || 0),
    pending: Number(rows[0]?.pending || 0)
  };
}

// 카카오 예약 대기 건수
async function kakaoCountPending(requestUid: string): Promise<number> {
  const rows = await mysqlQuery(
    `SELECT COUNT(*) as cnt FROM IMC_BM_FREE_BIZ_MSG WHERE REQUEST_UID = ? AND STATUS = '1'`,
    [requestUid]
  ) as any[];
  return Number(rows[0]?.cnt || 0);
}

// 카카오 예약 취소 (대기 건 삭제)
async function kakaoCancelPending(requestUid: string): Promise<number> {
  const rows = await mysqlQuery(
    `DELETE FROM IMC_BM_FREE_BIZ_MSG WHERE REQUEST_UID = ? AND STATUS = '1'`,
    [requestUid]
  ) as any[];
  return (rows as any).affectedRows || 0;
}

export { insertKakaoQueue, kakaoAgg, kakaoCountPending, kakaoCancelPending };
// ===== 카카오 브랜드메시지 헬퍼 끝 =====

// ===== 선불 잔액 관리 =====
// 선불 잔액 체크 + 차감 (atomic UPDATE ... WHERE balance >= amount)
async function prepaidDeduct(
  companyId: string, count: number, messageType: string, referenceId: string
): Promise<{ ok: boolean; error?: string; amount?: number; balance?: number; insufficientBalance?: boolean }> {
  const co = await query(
    'SELECT billing_type, balance, cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao FROM companies WHERE id = $1',
    [companyId]
  );
  if (co.rows.length === 0) return { ok: false, error: '회사 정보를 찾을 수 없습니다' };

  const c = co.rows[0];
  if (c.billing_type !== 'prepaid') return { ok: true, amount: 0 }; // 후불은 패스

  const unitPrice = messageType === 'SMS' ? Number(c.cost_per_sms || 0)
    : messageType === 'LMS' ? Number(c.cost_per_lms || 0)
    : messageType === 'MMS' ? Number(c.cost_per_mms || 0)
    : messageType === 'KAKAO' ? Number(c.cost_per_kakao || 0) : 0;

  const totalAmount = unitPrice * count;
  if (totalAmount === 0) return { ok: true, amount: 0 };

  // Atomic 차감: balance >= totalAmount 일 때만 성공
  const result = await query(
    'UPDATE companies SET balance = balance - $1, updated_at = NOW() WHERE id = $2 AND balance >= $1 RETURNING balance',
    [totalAmount, companyId]
  );

  if (result.rows.length === 0) {
    return {
      ok: false,
      error: `잔액이 부족합니다. 필요: ${totalAmount.toLocaleString()}원 / 현재: ${Number(c.balance).toLocaleString()}원`,
      amount: totalAmount,
      balance: Number(c.balance),
      insufficientBalance: true
    };
  }

  // 거래 기록
  await query(
    `INSERT INTO balance_transactions (company_id, type, amount, balance_after, description, reference_type, reference_id, payment_method)
     VALUES ($1, 'deduct', $2, $3, $4, 'campaign', $5, 'system')`,
    [companyId, totalAmount, result.rows[0].balance, `${messageType} ${count}건 발송 차감 (건당 ${unitPrice}원)`, referenceId]
  );

  console.log(`[선불차감] company=${companyId} ${messageType}×${count} = ${totalAmount}원 차감 → 잔액 ${result.rows[0].balance}원`);
  return { ok: true, amount: totalAmount, balance: Number(result.rows[0].balance) };
}

// 선불 환불 (실패건 또는 취소)
async function prepaidRefund(
  companyId: string, count: number, messageType: string, campaignId: string, reason: string
): Promise<{ refunded: number }> {
  const co = await query(
    'SELECT billing_type, cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao FROM companies WHERE id = $1',
    [companyId]
  );
  if (co.rows.length === 0 || co.rows[0].billing_type !== 'prepaid') return { refunded: 0 };
  if (count <= 0) return { refunded: 0 };

  const c = co.rows[0];
  const unitPrice = messageType === 'SMS' ? Number(c.cost_per_sms || 0)
    : messageType === 'LMS' ? Number(c.cost_per_lms || 0)
    : messageType === 'MMS' ? Number(c.cost_per_mms || 0)
    : messageType === 'KAKAO' ? Number(c.cost_per_kakao || 0) : 0;

  // 이미 환불된 금액 조회 (중복 환불 방지)
  const existing = await query(
    `SELECT COALESCE(SUM(amount), 0) as total FROM balance_transactions
     WHERE company_id = $1 AND type = 'refund' AND reference_type = 'campaign' AND reference_id = $2`,
    [companyId, campaignId]
  );
  const alreadyRefunded = Number(existing.rows[0].total);

  // 원래 차감 금액 조회
  const deducted = await query(
    `SELECT COALESCE(SUM(amount), 0) as total FROM balance_transactions
     WHERE company_id = $1 AND type = 'deduct' AND reference_type = 'campaign' AND reference_id = $2`,
    [companyId, campaignId]
  );
  const totalDeducted = Number(deducted.rows[0].total);

  const refundAmount = Math.min(unitPrice * count, totalDeducted - alreadyRefunded);
  if (refundAmount <= 0) return { refunded: 0 };

  const result = await query(
    'UPDATE companies SET balance = balance + $1, updated_at = NOW() WHERE id = $2 RETURNING balance',
    [refundAmount, companyId]
  );

  if (result.rows.length > 0) {
    await query(
      `INSERT INTO balance_transactions (company_id, type, amount, balance_after, description, reference_type, reference_id, payment_method)
       VALUES ($1, 'refund', $2, $3, $4, 'campaign', $5, 'system')`,
      [companyId, refundAmount, result.rows[0].balance, `${reason} (${messageType} ${count}건 × ${unitPrice}원)`, campaignId]
    );
    console.log(`[선불환불] company=${companyId} ${refundAmount}원 환불 → 잔액 ${result.rows[0].balance}원`);
  }

  return { refunded: refundAmount };
}
// ===== 선불 잔액 관리 끝 =====

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

    const companyTables = await getCompanySmsTables(companyId);
    const { status, page = 1, limit = 20, year, month } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let whereClause = 'WHERE company_id = $1';
    const params: any[] = [companyId];
    let paramIndex = 2;

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
          const pendingCount = await smsCountAll(companyTables, 'app_etc1 = ? AND status_code = 100', [camp.id]);

          // 예약 시간이 아직 안 됐으면 스킵 (MySQL에 데이터 없는게 정상)
          const campDetail = await query(`SELECT scheduled_at FROM campaigns WHERE id = $1`, [camp.id]);
          const scheduledAt = campDetail.rows[0]?.scheduled_at;
          if (scheduledAt && new Date(scheduledAt) > new Date()) {
            continue; // 예약 시간 전이면 완료 처리하지 않음
          }

          if (pendingCount === 0) {
            // 대기 건이 없으면 발송 완료 처리
            const sentCount = await smsCountAll(companyTables, 'app_etc1 = ?', [camp.id]);
            const successCount = await smsCountAll(companyTables, 'app_etc1 = ? AND status_code IN (6, 1000, 1800)', [camp.id]);
            const failCount = await smsCountAll(companyTables, 'app_etc1 = ? AND status_code NOT IN (6, 100, 1000, 1800)', [camp.id]);

            await query(
              `UPDATE campaigns SET status = 'completed', sent_count = $1, success_count = $2, fail_count = $3, sent_at = NOW(), updated_at = NOW() WHERE id = $4`,
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
    const result = await query(
      `SELECT
        id, campaign_name, status, message_type, send_type,
        target_count, sent_count, success_count, fail_count,
        scheduled_at, sent_at, created_at,
        TO_CHAR(event_start_date, 'YYYY-MM-DD') as event_start_date,
        TO_CHAR(event_end_date, 'YYYY-MM-DD') as event_end_date,
        message_content, message_template, subject, message_subject, is_ad, callback_number
       FROM campaigns
       ${whereClause}
       ORDER BY created_at DESC
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

    // 일반 사용자는 본인 store_codes에 해당하는 고객만
    let storeFilter = '';
    let storeParams: any[] = [];

    if (userType === 'company_user' && userId) {
      const userResult = await query('SELECT store_codes FROM users WHERE id = $1', [userId]);
      const storeCodes = userResult.rows[0]?.store_codes;
      if (storeCodes && storeCodes.length > 0) {
        storeFilter = ' AND c.id IN (SELECT customer_id FROM customer_stores WHERE company_id = c.company_id AND store_code = ANY($STORE_IDX::text[]))';
        storeParams = [storeCodes];
      }
    }

    const { messageContent, messageType } = req.body;
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

    // 회사 설정에서 담당자 정보 가져오기
    const companyResult = await query(
      'SELECT manager_phone, manager_contacts FROM companies WHERE id = $1',
      [companyId]
    );

    if (companyResult.rows.length === 0) {
      return res.status(404).json({ error: '회사 정보를 찾을 수 없습니다.' });
    }

    // 회신번호 가져오기 (callback_numbers 테이블에서)
    const callbackResult = await query(
      'SELECT phone FROM callback_numbers WHERE company_id = $1 AND is_default = true LIMIT 1',
      [companyId]
    );
    const callbackNumber = callbackResult.rows[0]?.phone?.replace(/-/g, '') || '18008125';

    // 새 형식 (manager_contacts) 우선, 없으면 기존 형식 (manager_phone)
    let managerContacts: {phone: string, name?: string}[] = [];

    if (companyResult.rows[0].manager_contacts && companyResult.rows[0].manager_contacts.length > 0) {
      managerContacts = companyResult.rows[0].manager_contacts;
    } else if (companyResult.rows[0].manager_phone) {
      const managerPhoneRaw = companyResult.rows[0].manager_phone;
      try {
        const phones = JSON.parse(managerPhoneRaw);
        managerContacts = phones.map((p: string) => ({ phone: p }));
      } catch {
        managerContacts = [{ phone: managerPhoneRaw }];
      }
    }

    if (managerContacts.length === 0) {
      return res.status(400).json({ error: '등록된 담당자 번호가 없습니다. 설정에서 번호를 추가해주세요.' });
    }

    // ★ 선불 잔액 체크
    const testMsgType = (messageType || 'SMS') as string;
    const testDeduct = await prepaidDeduct(companyId, managerContacts.length, testMsgType, '00000000-0000-0000-0000-000000000000');
    if (!testDeduct.ok) {
      return res.status(402).json({ error: testDeduct.error, insufficientBalance: true, balance: testDeduct.balance, requiredAmount: testDeduct.amount });
    }

    // 담당자별로 테스트 전용 라인으로 INSERT
    const testTables = await getTestSmsTables();
    const msgType = (messageType || 'SMS') === 'SMS' ? 'S' : (messageType || 'SMS') === 'LMS' ? 'L' : 'M';
    const mmsImagePaths: string[] = req.body.mmsImagePaths || [];
    let sentCount = 0;

    for (const contact of managerContacts) {
      try {
        const cleanPhone = contact.phone.replace(/-/g, '');
        const testMsg = messageContent;

        if (testChannel === 'sms' || testChannel === 'both') {
          // SMS 테스트 발송
          const table = getNextSmsTable(testTables);
          await mysqlQuery(
            `INSERT INTO ${table} (
              dest_no, call_back, msg_contents, msg_type, sendreq_time, status_code, rsv1, app_etc1, app_etc2, bill_id, file_name1, file_name2, file_name3
            ) VALUES (?, ?, ?, ?, NOW(), 100, '1', ?, ?, ?, ?, ?, ?)`,
            [cleanPhone, callbackNumber, testMsg, msgType, 'test', companyId, userId || '', mmsImagePaths[0] || '', mmsImagePaths[1] || '', mmsImagePaths[2] || '']
          );
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
            requestUid: 'test',
          });
        }

        sentCount++;
      } catch (err) {
        console.error(`담당자 테스트 발송 실패 (${contact.phone}):`, err);
      }
    }

    return res.json({
      message: `담당자 ${sentCount}명에게 테스트 문자를 발송했습니다.`,
      sentCount,
      contacts: managerContacts.map(c => ({
        name: c.name || '이름없음',
        phone: `${c.phone.replace(/\D/g, '').slice(0, 3)}-****-${c.phone.replace(/\D/g, '').slice(-4)}`
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
    } = req.body;

    if (!campaignName || !messageType || !messageContent) {
      return res.status(400).json({ error: '필수 항목을 입력하세요.' });
    }

    // 타겟 인원 계산 (sms_opt_in 조건 포함)
    let targetCount = 0;
    if (targetFilter) {
      const filterQuery = buildFilterQuery(targetFilter, companyId);
      const countResult = await query(
        `SELECT COUNT(*) FROM customers WHERE company_id = $1 AND is_active = true AND sms_opt_in = true ${filterQuery.where}`,
        [companyId, ...filterQuery.params]
      );
      targetCount = parseInt(countResult.rows[0].count);
    }

    const result = await query(
      `INSERT INTO campaigns (
        company_id, campaign_name, message_type, target_filter,
        message_content, subject, message_subject, scheduled_at, is_ad, target_count, created_by,
        event_start_date, event_end_date, mms_image_paths,
        send_channel, kakao_bubble_type, kakao_sender_key, kakao_targeting,
        kakao_attachment_json, kakao_carousel_json, kakao_resend_type
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
      RETURNING *`,
      [
        companyId, campaignName, messageType, JSON.stringify(targetFilter),
        messageContent, subject || null, subject || null, scheduledAt, isAd ?? false, targetCount, userId,
        eventStartDate || null, eventEndDate || null,
        mmsImagePaths && mmsImagePaths.length > 0 ? JSON.stringify(mmsImagePaths) : null,
        sendChannel || 'sms',
        kakaoBubbleType || null,
        kakaoSenderKey || null,
        kakaoTargeting || 'I',
        kakaoAttachmentJson || null,
        kakaoCarouselJson || null,
        kakaoResendType || 'SM'
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

    if (!companyId) {
      return res.status(403).json({ error: '고객사 권한이 필요합니다.' });
    }

    const companyTables = await getCompanySmsTables(companyId);

    // 일반 사용자는 본인 store_codes에 해당하는 고객만
    let storeFilter = '';
    const storeParams: any[] = [];

    if (userType === 'company_user' && userId) {
      const userResult = await query('SELECT store_codes FROM users WHERE id = $1', [userId]);
      const storeCodes = userResult.rows[0]?.store_codes;
      if (storeCodes && storeCodes.length > 0) {
        storeFilter = ' AND c.id IN (SELECT customer_id FROM customer_stores WHERE company_id = c.company_id AND store_code = ANY($STORE_IDX::text[]))';
        storeParams.push(storeCodes);
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

    // 기본 회신번호 조회 (callback_numbers 테이블에서)
    const callbackResult = await query(
      'SELECT phone FROM callback_numbers WHERE company_id = $1 AND is_default = true LIMIT 1',
      [companyId]
    );
    // campaign에 설정된 회신번호 우선, 없으면 기본 회신번호
    const defaultCallback = callbackResult.rows[0]?.phone || '18008125';

    // 개별회신번호 사용 여부
    const useIndividualCallback = campaign.use_individual_callback || false;

    // ★ 회사 스키마 조회 → 동적 변수 치환을 위한 field_mappings
    const companySchemaResult = await query(
      'SELECT customer_schema FROM companies WHERE id = $1',
      [companyId]
    );
    const customerSchema = companySchemaResult.rows[0]?.customer_schema || {};
    const { fieldMappings, availableVars } = extractVarCatalog(customerSchema);

    // ★ field_mappings에서 필요한 컬럼 자동 추출 (동적 SELECT)
    const baseColumns = ['id', 'phone', 'callback'];
    const mappingColumns = Object.values(fieldMappings).map((m: VarCatalogEntry) => m.column);
    const selectColumns = [...new Set([...baseColumns, ...mappingColumns])].join(', ');

    // draft 또는 completed 상태에서 재발송 가능
    if (campaign.status === 'sending') {
      return res.status(400).json({ error: '이미 발송 중입니다.' });
    }

    // 타겟 고객 조회
    const targetFilter = campaign.target_filter;
    console.log('targetFilter:', JSON.stringify(targetFilter, null, 2));
    const filterQuery = buildFilterQuery(targetFilter, companyId);
    console.log('filterQuery:', filterQuery);

    // store_code 필터 인덱스 계산
    const storeParamIdx = 1 + filterQuery.params.length + 1;
    const storeFilterFinal = storeFilter.replace('$STORE_IDX', `$${storeParamIdx}`);

    // ★ 동적 SELECT: field_mappings 기반으로 필요한 컬럼만 자동 조회
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

    // campaign_runs에 발송 이력 생성
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
        customers.length,
        isScheduled ? 'scheduled' : 'sending',
        campaign.scheduled_at
      ]
    );
    const campaignRun = runResult.rows[0];

// excluded_phones 목록 조회
const excludedPhones = campaign.excluded_phones || [];

// 제외 대상 필터링
let filteredCustomers = customers.filter(
  (c: any) => !excludedPhones.includes(c.phone.replace(/-/g, ''))
);

// ★ 개별회신번호 사용 시 callback 없는 고객 제외
let callbackSkippedCount = 0;
if (useIndividualCallback) {
  const beforeCount = filteredCustomers.length;
  filteredCustomers = filteredCustomers.filter((c: any) => c.callback && c.callback.trim());
  callbackSkippedCount = beforeCount - filteredCustomers.length;
  if (callbackSkippedCount > 0) {
    console.log(`[개별회신번호] callback 없는 고객 ${callbackSkippedCount}명 제외 (${filteredCustomers.length}명 발송)`);
  }
}

if (filteredCustomers.length === 0) {
  return res.status(400).json({ error: '발송 대상이 없습니다. (모두 제외됨)' });
}

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
const sendDeduct = await prepaidDeduct(companyId, filteredCustomers.length, deductType, id);
if (!sendDeduct.ok) {
  return res.status(402).json({
    error: sendDeduct.error,
    insufficientBalance: true,
    balance: sendDeduct.balance,
    requiredAmount: sendDeduct.amount
  });
}

// MySQL에 INSERT (즉시/예약 공통)
const sendTime = isScheduled ? toKoreaTimeStr(new Date(campaign.scheduled_at)) : null;

// MMS 이미지 경로 (campaigns 테이블에서 가져옴)
const campaignMmsImages: string[] = campaign.mms_image_paths || [];
const aiMsgTypeCode = campaign.message_type === 'SMS' ? 'S' : campaign.message_type === 'LMS' ? 'L' : 'M';

// 카카오 설정 (campaigns 테이블에서)
const kakaoBubbleType = campaign.kakao_bubble_type || 'TEXT';
const kakaoSenderKey = campaign.kakao_sender_key || '';
const kakaoTargeting = campaign.kakao_targeting || 'I';
const kakaoAttachmentJson = campaign.kakao_attachment_json || null;
const kakaoCarouselJson = campaign.kakao_carousel_json || null;
const kakaoResendType = campaign.kakao_resend_type || 'SM';

// 080 수신거부 번호 조회 (카카오 광고 발송 시 필요)
let opt080Number = '';
let opt080Auth = '';
if (sendChannel !== 'sms' && campaign.is_ad) {
  const optResult = await query('SELECT opt_out_080_number FROM companies WHERE id = $1', [companyId]);
  opt080Number = optResult.rows[0]?.opt_out_080_number || '';
}

for (const customer of filteredCustomers) {
  // ★ 동적 변수 치환 (field_mappings 기반 - 하드코딩 완전 제거!)
  let personalizedMessage = campaign.message_content || '';

  for (const [varName, mapping] of Object.entries(fieldMappings) as [string, VarCatalogEntry][]) {
    const value = customer[mapping.column];
    let displayValue = '';

    if (value === null || value === undefined) {
      displayValue = '';
    } else if (mapping.type === 'number' && typeof value === 'number') {
      displayValue = value.toLocaleString();
    } else if (mapping.type === 'date' && value) {
      displayValue = new Date(value).toLocaleDateString('ko-KR');
    } else {
      displayValue = String(value);
    }

    personalizedMessage = personalizedMessage.replace(
      new RegExp(`%${varName}%`, 'g'),
      displayValue
    );
  }

  // 검증에서 발견된 잘못된 변수 잔여분 제거 (안전장치)
  personalizedMessage = personalizedMessage.replace(/%[^%\s]{1,20}%/g, '');

  // 개별회신번호: customer.callback 있으면 사용, 없으면 캠페인 설정 또는 기본값
  const customerCallback = useIndividualCallback && customer.callback
    ? customer.callback.replace(/-/g, '')
    : (campaign.callback_number || defaultCallback).replace(/-/g, '');

  const cleanPhone = customer.phone.replace(/-/g, '');

  // ★ 채널별 분기: SMS / 카카오 / 동시발송
  if (sendChannel === 'sms' || sendChannel === 'both') {
    // SMS/LMS/MMS 발송
    const table = getNextSmsTable(companyTables);
    await mysqlQuery(
      `INSERT INTO ${table} (
        dest_no, call_back, msg_contents, msg_type, title_str, sendreq_time, status_code, rsv1, app_etc1, app_etc2, file_name1, file_name2, file_name3
      ) VALUES (?, ?, ?, ?, ?, ${sendTime ? `'${sendTime}'` : 'NOW()'}, 100, '1', ?, ?, ?, ?, ?)`,
      [cleanPhone, customerCallback, personalizedMessage, aiMsgTypeCode, campaign.subject || '', id, companyId, campaignMmsImages[0] || '', campaignMmsImages[1] || '', campaignMmsImages[2] || '']
    );
  }

  if (sendChannel === 'kakao' || sendChannel === 'both') {
    // 카카오 브랜드메시지 발송
    await insertKakaoQueue({
      bubbleType: kakaoBubbleType,
      senderKey: kakaoSenderKey,
      phone: cleanPhone,
      targeting: kakaoTargeting,
      message: personalizedMessage,
      isAd: campaign.is_ad || false,
      reservedDate: sendTime || undefined,
      attachmentJson: kakaoAttachmentJson,
      carouselJson: kakaoCarouselJson,
      resendType: sendChannel === 'both' ? 'NO' : kakaoResendType,  // 동시발송이면 대체발송 끔
      resendFrom: customerCallback,
      resendMessage: sendChannel === 'both' ? undefined : undefined,  // 기본: 카카오 메시지 재사용
      unsubscribePhone: opt080Number,
      requestUid: id,
    });
  }
}

// campaign_runs 상태 업데이트
await query(
  `UPDATE campaign_runs SET
    sent_count = $1,
    status = $2,
    sent_at = CURRENT_TIMESTAMP
   WHERE id = $3`,
  [filteredCustomers.length, isScheduled ? 'scheduled' : 'sending', campaignRun.id]
);

// 캠페인 상태 업데이트
await query(
  `UPDATE campaigns SET
    status = $1,
    sent_count = COALESCE(sent_count, 0) + $2,
    target_count = $3,
    sent_at = CURRENT_TIMESTAMP
   WHERE id = $4`,
  [isScheduled ? 'scheduled' : 'sending', filteredCustomers.length, filteredCustomers.length, id]
);
    return res.json({
      message: `${filteredCustomers.length}건 발송이 시작되었습니다.${callbackSkippedCount > 0 ? ` (회신번호 없는 ${callbackSkippedCount}명 제외)` : ''}`,
      sentCount: filteredCustomers.length,
      callbackSkippedCount,
      runId: campaignRun.id,
      runNumber: runNumber,
    });
  } catch (error) {
    console.error('캠페인 발송 에러:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 필터 쿼리 빌더
function buildFilterQuery(filter: any, companyId: string) {
  let where = '';
  const params: any[] = [];
  let paramIndex = 2;

  if (!filter) return { where, params };

  const getValue = (field: any) => {
    if (!field) return null;
    if (typeof field === 'object' && field.value !== undefined) return field.value;
    return field;
  };

  // gender (normalize.ts 변형값 매칭)
  const gender = getValue(filter.gender);
  if (gender) {
    const genderResult = buildGenderFilter(gender, paramIndex);
    where += genderResult.sql;
    params.push(...genderResult.params);
    paramIndex = genderResult.nextIndex;
  }

  // age (배열: [30, 39])
  const age = getValue(filter.age);
  if (age && Array.isArray(age) && age.length === 2) {
    where += ` AND (2026 - birth_year) >= $${paramIndex++}`;
    params.push(age[0]);
    where += ` AND (2026 - birth_year) <= $${paramIndex++}`;
    params.push(age[1]);
  }

  // minAge/maxAge (기존 호환)
  const minAge = getValue(filter.minAge) || getValue(filter.min_age);
  if (minAge) {
    where += ` AND (2026 - birth_year) >= $${paramIndex++}`;
    params.push(minAge);
  }

  const maxAge = getValue(filter.maxAge) || getValue(filter.max_age);
  if (maxAge) {
    where += ` AND (2026 - birth_year) <= $${paramIndex++}`;
    params.push(maxAge);
  }

  // grade (normalize.ts 변형값 매칭)
  const grade = getValue(filter.grade);
  if (grade) {
    const gradeResult = buildGradeFilter(grade, paramIndex);
    where += gradeResult.sql;
    params.push(...gradeResult.params);
    paramIndex = gradeResult.nextIndex;
  }

  // region (normalize.ts 변형값 매칭)
  const regionFilter = filter.region;
  const region = getValue(regionFilter);
  if (region) {
    const regionOp = regionFilter?.operator || 'eq';
    if (regionOp === 'in' && Array.isArray(region)) {
      const allVariants = (region as string[]).flatMap(r => getRegionVariants(r));
      where += ` AND region = ANY($${paramIndex++}::text[])`;
      params.push(allVariants);
    } else {
      const regionResult = buildRegionFilter(String(region), paramIndex);
      where += regionResult.sql;
      params.push(...regionResult.params);
      paramIndex = regionResult.nextIndex;
    }
  }

  // custom_fields 처리 (AI 필터 확장)
  Object.keys(filter).forEach(key => {
    if (key.startsWith('custom_fields.')) {
      const fieldName = key.replace('custom_fields.', '');
      const condition = filter[key];
      const value = getValue(condition);
      const operator = condition?.operator || 'eq';

      if (value !== null && value !== undefined) {
        if (operator === 'eq') {
          where += ` AND custom_fields->>'${fieldName}' = $${paramIndex++}`;
          params.push(value);
        } else if (operator === 'gte') {
          where += ` AND (custom_fields->>'${fieldName}')::numeric >= $${paramIndex++}`;
          params.push(value);
        } else if (operator === 'lte') {
          where += ` AND (custom_fields->>'${fieldName}')::numeric <= $${paramIndex++}`;
          params.push(value);
        } else if (operator === 'in' && Array.isArray(value)) {
          where += ` AND custom_fields->>'${fieldName}' = ANY($${paramIndex++})`;
          params.push(value);
        }
      }
    }
  });

  // store_code (브랜드)
  const storeCode = getValue(filter.store_code);
  if (storeCode) {
    const storeOp = filter.store_code?.operator || 'eq';
    if (storeOp === 'in' && Array.isArray(storeCode)) {
      where += ` AND c.store_code = ANY($${paramIndex++}::text[])`;
      params.push(storeCode);
    } else {
      where += ` AND c.store_code = $${paramIndex++}`;
      params.push(storeCode);
    }
  }

  // store_name (매장명)
  const storeName = getValue(filter.store_name);
  if (storeName) {
    const storeNameOp = filter.store_name?.operator || 'eq';
    if (storeNameOp === 'in' && Array.isArray(storeName)) {
      where += ` AND c.store_name = ANY($${paramIndex++}::text[])`;
      params.push(storeName);
    } else {
      where += ` AND c.store_name = $${paramIndex++}`;
      params.push(storeName);
    }
  }

  // total_purchase_amount (총구매금액)
  const purchaseAmount = getValue(filter.total_purchase_amount);
  if (purchaseAmount !== null && purchaseAmount !== undefined) {
    const purchaseOp = filter.total_purchase_amount?.operator || 'gte';
    if (purchaseOp === 'gte') {
      where += ` AND c.total_purchase_amount >= $${paramIndex++}`;
      params.push(Number(purchaseAmount));
    } else if (purchaseOp === 'lte') {
      where += ` AND c.total_purchase_amount <= $${paramIndex++}`;
      params.push(Number(purchaseAmount));
    } else if (purchaseOp === 'between' && Array.isArray(purchaseAmount)) {
      where += ` AND c.total_purchase_amount BETWEEN $${paramIndex++} AND $${paramIndex++}`;
      params.push(Number(purchaseAmount[0]), Number(purchaseAmount[1]));
    }
  }

  // recent_purchase_date (최근구매일)
  const recentDate = getValue(filter.recent_purchase_date);
  if (recentDate) {
    const dateOp = filter.recent_purchase_date?.operator || 'days_within';
    if (dateOp === 'days_within') {
      where += ` AND c.recent_purchase_date >= NOW() - INTERVAL '${parseInt(recentDate)} days'`;
    }
  }

  // points (포인트)
  const points = getValue(filter.points);
  if (points !== null && points !== undefined) {
    const pointsOp = filter.points?.operator || 'gte';
    if (pointsOp === 'gte') {
      where += ` AND c.points >= $${paramIndex++}`;
      params.push(Number(points));
    } else if (pointsOp === 'lte') {
      where += ` AND c.points <= $${paramIndex++}`;
      params.push(Number(points));
    } else if (pointsOp === 'between' && Array.isArray(points)) {
      where += ` AND c.points BETWEEN $${paramIndex++} AND $${paramIndex++}`;
      params.push(Number(points[0]), Number(points[1]));
    }
  }

  return { where, params };
}

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

    // 날짜 범위 필터
    let dateFilter = '';
    if (fromDate && toDate) {
      dateFilter = ` AND sendreq_time >= '${fromDate} 00:00:00' AND sendreq_time <= '${toDate} 23:59:59'`;
    }

    // 일반 사용자는 본인이 보낸 테스트만
    let userFilter = '';
    const queryParams: any[] = [companyId];
    if (userType === 'company_user' && userId) {
      userFilter = ' AND bill_id = ?';
      queryParams.push(userId);
    }

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
      success: allResults.filter((r: any) => [6, 1000, 1800].includes(r.status_code)).length,
      fail: allResults.filter((r: any) => ![6, 1000, 1800, 100].includes(r.status_code)).length,
      pending: allResults.filter((r: any) => r.status_code === 100).length,
      cost: 0,
    };

    // 비용 계산 (회사 실제 단가 기준)
    const costResult = await query('SELECT cost_per_sms, cost_per_lms, cost_per_mms FROM companies WHERE id = $1', [companyId]);
    const costSms = Number(costResult.rows[0]?.cost_per_sms) || 9.9;
    const costLms = Number(costResult.rows[0]?.cost_per_lms) || 27;
    const costMms = Number(costResult.rows[0]?.cost_per_mms) || 50;
    allResults.forEach((r: any) => {
      if ([6, 1000, 1800].includes(r.status_code)) {
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
      status: [6, 1000, 1800].includes(r.status_code) ? 'success' : r.status_code === 100 ? 'pending' : 'fail',
      testType: 'manager',
      senderName: senderMap[r.bill_id] || '-',
    }));

    res.json({
      stats,
      list,
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

    const result = await query(
      `SELECT * FROM campaigns WHERE id = $1 AND company_id = $2`,
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
router.post('/sync-results', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ error: '권한이 필요합니다.' });
    }

    // 동기화 대상: sending 또는 scheduled 상태인 campaign_runs (campaign의 company_id 포함)
    const runsResult = await query(
      `SELECT cr.id, cr.campaign_id, c.company_id
       FROM campaign_runs cr
       JOIN campaigns c ON c.id = cr.campaign_id
       WHERE cr.status IN ('sending', 'scheduled')`
    );

    let syncCount = 0;
    for (const run of runsResult.rows) {
      // SMS: 캠페인 소속 회사의 라인그룹 테이블에서 합산 집계
      const runTables = await getCompanySmsTables(run.company_id);
      const smsAgg = await smsAggAll(runTables,
        `COUNT(CASE WHEN status_code IN (6, 1000, 1800) THEN 1 END) as success_count,
         COUNT(CASE WHEN status_code NOT IN (6, 1000, 1800, 100) THEN 1 END) as fail_count,
         COUNT(CASE WHEN status_code = 100 THEN 1 END) as pending_count`,
        'app_etc1 = ?',
        [run.campaign_id]
      );

      // 카카오: IMC_BM_FREE_BIZ_MSG에서 결과 집계
      const kakaoResult = await kakaoAgg('REQUEST_UID = ?', [run.campaign_id]);

      const successCount = (smsAgg.success_count || 0) + kakaoResult.success;
      const failCount = (smsAgg.fail_count || 0) + kakaoResult.fail;
      const pendingCount = (smsAgg.pending_count || 0) + kakaoResult.pending;

      // PostgreSQL 업데이트
      if (successCount > 0 || failCount > 0) {
        // 대기건이 남아있으면 아직 sending, 0이면 completed
        const newStatus = pendingCount > 0 ? 'sending' : (failCount === 0 ? 'completed' : (successCount === 0 ? 'failed' : 'completed'));

        // campaign_runs 업데이트
        await query(
          `UPDATE campaign_runs SET
            success_count = $1,
            fail_count = $2,
            status = $3
           WHERE id = $4`,
          [successCount, failCount, newStatus, run.id]
        );

        // campaigns 테이블도 업데이트
        const runInfo = await query(`SELECT campaign_id FROM campaign_runs WHERE id = $1`, [run.id]);
        if (runInfo.rows.length > 0) {
          await query(
            `UPDATE campaigns SET
              success_count = $1,
              fail_count = $2,
              status = $3
             WHERE id = $4`,
            [successCount, failCount, newStatus, runInfo.rows[0].campaign_id]
          );

          // ★ 선불 실패건 환불
          if (failCount > 0) {
            const campInfo = await query('SELECT company_id, message_type FROM campaigns WHERE id = $1', [runInfo.rows[0].campaign_id]);
            if (campInfo.rows.length > 0) {
              await prepaidRefund(campInfo.rows[0].company_id, failCount, campInfo.rows[0].message_type, runInfo.rows[0].campaign_id, '발송 실패 환불');
            }
          }
        }

        syncCount++;
      }
    }

    // 직접발송 동기화 (send_type='direct'인 campaigns)
    const directCampaigns = await query(
      `SELECT id, company_id FROM campaigns WHERE send_type = 'direct' AND status IN ('sending', 'completed') AND (success_count IS NULL OR success_count = 0)`
    );

    for (const campaign of directCampaigns.rows) {
      const directTables = await getCompanySmsTables(campaign.company_id);
      const smsDirectAgg = await smsAggAll(directTables,
        `COUNT(*) as total_count,
         COUNT(CASE WHEN status_code IN (6, 1000, 1800) THEN 1 END) as success_count,
         COUNT(CASE WHEN status_code NOT IN (6, 1000, 1800, 100) THEN 1 END) as fail_count,
         COUNT(CASE WHEN status_code = 100 THEN 1 END) as pending_count`,
        'app_etc1 = ?',
        [campaign.id]
      );

      // 카카오 결과도 합산
      const kakaoDirectResult = await kakaoAgg('REQUEST_UID = ?', [campaign.id]);

      const successCount = (smsDirectAgg.success_count || 0) + kakaoDirectResult.success;
      const failCount = (smsDirectAgg.fail_count || 0) + kakaoDirectResult.fail;
      const pendingCount = (smsDirectAgg.pending_count || 0) + kakaoDirectResult.pending;

      if (successCount > 0 || failCount > 0) {
        const newStatus = pendingCount > 0 ? 'sending' : 'completed';

        await query(
          `UPDATE campaigns SET
            success_count = $1,
            fail_count = $2,
            status = $3
           WHERE id = $4`,
          [successCount, failCount, newStatus, campaign.id]
        );

        // ★ 선불 실패건 환불
        if (failCount > 0) {
          const campInfo = await query('SELECT company_id, message_type FROM campaigns WHERE id = $1', [campaign.id]);
          if (campInfo.rows.length > 0) {
            await prepaidRefund(campInfo.rows[0].company_id, failCount, campInfo.rows[0].message_type, campaign.id, '발송 실패 환불');
          }
        }

        syncCount++;
      }
    }

    return res.json({ message: `${syncCount}건 동기화 완료` });
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
    if (!companyId) {
      return res.status(401).json({ success: false, error: '인증 필요' });
    }

    const companyTables = await getCompanySmsTables(companyId);

    const {
      msgType,        // SMS, LMS, MMS
      subject,        // 제목 (LMS/MMS)
      message,        // 메시지 내용 (광고문구 포함된 최종 메시지)
      callback,       // 회신번호
      recipients,     // [{phone, name, extra1, extra2, extra3}]
      adEnabled,      // 광고문구 포함 여부
      scheduled,      // 예약 여부
      scheduledAt,    // 예약 시간
      splitEnabled,   // 분할전송 여부
      splitCount,     // 분당 발송 건수
      useIndividualCallback,  // 개별회신번호 사용 여부
      mmsImagePaths,  // MMS 이미지 서버 경로 배열
      // 카카오 브랜드메시지 필드
      sendChannel,          // sms / kakao / both
      kakaoBubbleType,      // TEXT, IMAGE, WIDE 등
      kakaoSenderKey,       // 발신 프로필 키
      kakaoTargeting,       // I/M/N
      kakaoAttachmentJson,  // 버튼/이미지 JSON
      kakaoCarouselJson,    // 캐러셀 JSON
      kakaoResendType,      // SM/LM/NO
    } = req.body;

    if (!recipients || recipients.length === 0) {
      return res.status(400).json({ success: false, error: '수신자가 없습니다' });
    }

    if (!callback && !useIndividualCallback) {
      return res.status(400).json({ success: false, error: '회신번호를 선택해주세요' });
    }

    // 개별회신번호 사용 시 모든 수신자에게 callback 있는지 확인
    if (useIndividualCallback) {
      const missingCallback = recipients.filter((r: any) => !r.callback);
      if (missingCallback.length > 0) {
        return res.status(400).json({ success: false, error: `개별회신번호가 없는 수신자가 ${missingCallback.length}명 있습니다` });
      }
    }

    // 1. 수신거부 필터링
    const phones = recipients.map((r: any) => r.phone.replace(/-/g, ''));
    const unsubResult = await query(
      `SELECT phone FROM unsubscribes WHERE user_id = $1 AND phone = ANY($2)`,
      [userId, phones]
    );
    const unsubPhones = new Set(unsubResult.rows.map((r: any) => r.phone));
    const filteredRecipients = recipients.filter((r: any) => !unsubPhones.has(r.phone.replace(/-/g, '')));

    if (filteredRecipients.length === 0) {
      return res.status(400).json({ success: false, error: '모든 수신자가 수신거부 상태입니다' });
    }

    const excludedCount = recipients.length - filteredRecipients.length;

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
    const directDeduct = await prepaidDeduct(companyId, filteredRecipients.length, directDeductType, campaignId);
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

    // 2. MySQL 큐에 메시지 삽입 — 회사 라인그룹 테이블 라운드로빈 분배
    const isScheduledSend = scheduled && scheduledAt;

    // 080 수신거부 번호 조회 (카카오 광고 발송 시 필요)
    let directOpt080 = '';
    if (directChannel !== 'sms' && adEnabled) {
      const optResult = await query('SELECT opt_out_080_number FROM companies WHERE id = $1', [companyId]);
      directOpt080 = optResult.rows[0]?.opt_out_080_number || '';
    }

    // SMS 발송 (sms 또는 both)
    if (directChannel === 'sms' || directChannel === 'both') {
      // 테이블별 데이터 분배
      const tableBatches: Record<string, any[][]> = {};
      for (const t of companyTables) tableBatches[t] = [[]];

      for (let i = 0; i < filteredRecipients.length; i++) {
        const recipient = filteredRecipients[i];
        // 변수 치환
        let finalMessage = message
          .replace(/%이름%/g, recipient.name || '')
          .replace(/%기타1%/g, recipient.extra1 || '')
          .replace(/%기타2%/g, recipient.extra2 || '')
          .replace(/%기타3%/g, recipient.extra3 || '')
          .replace(/%회신번호%/g, recipient.callback || '');

        // 분할전송 시간 계산
        let sendTime: string;
        if (isScheduledSend) {
          const baseTime = new Date(scheduledAt);
          if (splitEnabled && splitCount > 0) {
            const batchIndex = Math.floor(i / splitCount);
            baseTime.setMinutes(baseTime.getMinutes() + batchIndex);
          }
          sendTime = toKoreaTimeStr(baseTime);
        } else if (splitEnabled && splitCount > 0) {
          const baseTime = new Date();
          const batchIndex = Math.floor(i / splitCount);
          baseTime.setMinutes(baseTime.getMinutes() + batchIndex);
          sendTime = toKoreaTimeStr(baseTime);
        } else {
          sendTime = toKoreaTimeStr(new Date());
        }

        // 개별회신번호면 recipient.callback 사용, 아니면 공통 callback 사용
        const recipientCallback = useIndividualCallback
          ? (recipient.callback || '').replace(/-/g, '')
          : callback.replace(/-/g, '');

        // 라운드로빈으로 테이블 선택
        const table = getNextSmsTable(companyTables);
        const currentBatch = tableBatches[table];
        const lastBatch = currentBatch[currentBatch.length - 1];

        if (lastBatch.length >= 1000) {
          currentBatch.push([]);
        }
        const targetBatch = currentBatch[currentBatch.length - 1];

        targetBatch.push([
          recipient.phone.replace(/-/g, ''),
          recipientCallback,
          finalMessage,
          msgType === 'SMS' ? 'S' : msgType === 'LMS' ? 'L' : 'M',
          subject || '',
          sendTime,
          campaignId,
          (mmsImagePaths || [])[0] || '',
          (mmsImagePaths || [])[1] || '',
          (mmsImagePaths || [])[2] || ''
        ]);
      }

      // Bulk INSERT 실행 (테이블별)
      for (const [table, batches] of Object.entries(tableBatches)) {
        for (const batch of batches) {
          if (batch.length === 0) continue;
          const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?, 100, \'1\', ?, ?, ?, ?)').join(', ');
          const flatValues = batch.flat();

          await mysqlQuery(
            `INSERT INTO ${table} (dest_no, call_back, msg_contents, msg_type, title_str, sendreq_time, status_code, rsv1, app_etc1, file_name1, file_name2, file_name3) VALUES ${placeholders}`,
            flatValues
          );
        }
      }
    }

    // 카카오 발송 (kakao 또는 both)
    if (directChannel === 'kakao' || directChannel === 'both') {
      for (let i = 0; i < filteredRecipients.length; i++) {
        const recipient = filteredRecipients[i];
        let finalMessage = message
          .replace(/%이름%/g, recipient.name || '')
          .replace(/%기타1%/g, recipient.extra1 || '')
          .replace(/%기타2%/g, recipient.extra2 || '')
          .replace(/%기타3%/g, recipient.extra3 || '')
          .replace(/%회신번호%/g, recipient.callback || '');

        // 분할전송 시간 계산
        let kakaoSendTime: string | undefined;
        if (isScheduledSend) {
          const baseTime = new Date(scheduledAt);
          if (splitEnabled && splitCount > 0) {
            const batchIndex = Math.floor(i / splitCount);
            baseTime.setMinutes(baseTime.getMinutes() + batchIndex);
          }
          kakaoSendTime = toKoreaTimeStr(baseTime);
        }

        const recipientCallback = useIndividualCallback
          ? (recipient.callback || '').replace(/-/g, '')
          : callback.replace(/-/g, '');

        await insertKakaoQueue({
          bubbleType: kakaoBubbleType || 'TEXT',
          senderKey: kakaoSenderKey || '',
          phone: recipient.phone.replace(/-/g, ''),
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
      }
    }

    // 3. 즉시발송이면 상태 업데이트
    if (!scheduled) {
      await query(
        `UPDATE campaigns SET status = 'completed', sent_at = NOW() WHERE id = $1`,
        [campaignId]
      );
    }

    res.json({
      success: true,
      campaignId,
      message: `${filteredRecipients.length}건 발송 ${scheduled ? '예약' : '완료'}${excludedCount > 0 ? ` (수신거부 ${excludedCount}건 제외)` : ''}`
    });
  } catch (error) {
    console.error('직접발송 실패:', error);
    res.status(500).json({ success: false, error: '발송 실패' });
  }
});

// 예약 취소
router.post('/:id/cancel', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const campaignId = req.params.id;

    // 1. 캠페인 확인
    const campaign = await query(
      `SELECT * FROM campaigns WHERE id = $1 AND company_id = $2`,
      [campaignId, companyId]
    );

    if (campaign.rows.length === 0) {
      return res.status(404).json({ success: false, error: '캠페인을 찾을 수 없습니다' });
    }

    if (campaign.rows[0].status !== 'scheduled') {
      return res.status(400).json({ success: false, error: '예약 상태가 아닙니다' });
    }

    // 15분 이내 체크
    const scheduledAt = new Date(campaign.rows[0].scheduled_at);
    const now = new Date();
    const diffMinutes = (scheduledAt.getTime() - now.getTime()) / (1000 * 60);
    if (diffMinutes < 15) {
      return res.status(400).json({ success: false, error: '발송 15분 전에는 취소할 수 없습니다', tooLate: true });
    }

    // 2. 대기 중인 메시지 건수 확인 (환불 계산용)
    const cancelTables = await getCompanySmsTables(companyId);
    const cancelCount = await smsCountAll(cancelTables, 'app_etc1 = ? AND status_code = 100', [campaignId]);

    // 카카오 대기 건수도 확인
    const kakaoCancelCount = await kakaoCountPending(campaignId);
    const totalCancelCount = cancelCount + kakaoCancelCount;

    // 3. 회사 라인그룹 테이블에서 대기 중인 메시지 삭제 (status_code = 100)
    await smsExecAll(cancelTables,
      `DELETE FROM SMSQ_SEND WHERE app_etc1 = ? AND status_code = 100`,
      [campaignId]
    );

    // 카카오 대기건 삭제
    if (kakaoCancelCount > 0) {
      await kakaoCancelPending(campaignId);
    }

    // 4. 선불 환불 (예약 취소)
    const camp = campaign.rows[0];
    if (totalCancelCount > 0) {
      // SMS 환불
      if (cancelCount > 0) {
        await prepaidRefund(companyId, cancelCount, camp.message_type, campaignId, '예약 취소 환불');
      }
      // 카카오 환불
      if (kakaoCancelCount > 0) {
        await prepaidRefund(companyId, kakaoCancelCount, 'KAKAO', campaignId, '카카오 예약 취소 환불');
      }
    }

    // 5. PostgreSQL 캠페인 상태 변경
    await query(
      `UPDATE campaigns SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [campaignId]
    );

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
      const searchParams = search ? [campaignId, `%${String(search).replace(/-/g, '')}%`] : [campaignId];

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
      const filterQuery = buildFilterQuery(targetFilter, companyId);
      const excludedPhones = camp.excluded_phones || [];

      // store_codes 필터
      let storeFilter = '';
      let storeParams: any[] = [];
      if (userType === 'company_user' && userId) {
        const userResult = await query('SELECT store_codes FROM users WHERE id = $1', [userId]);
        const storeCodes = userResult.rows[0]?.store_codes;
        if (storeCodes && storeCodes.length > 0) {
          const storeIdx = 1 + filterQuery.params.length + 1;
          storeFilter = ` AND id IN (SELECT customer_id FROM customer_stores WHERE company_id = $1 AND store_code = ANY($${storeIdx}::text[]))`;
          storeParams = [storeCodes];
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

      // 총 개수
      const unsubCountIdx = 1 + filterQuery.params.length + storeParams.length + searchParams.length + excludeParams.length + 1;
      const countResult = await query(
        `SELECT COUNT(*) FROM customers
         WHERE company_id = $1 AND is_active = true AND sms_opt_in = true
         ${filterQuery.where}${storeFilter}${searchFilter}${excludeFilter}
         AND NOT EXISTS (SELECT 1 FROM unsubscribes u WHERE u.user_id = $${unsubCountIdx} AND u.phone = customers.phone)`,
        [companyId, ...filterQuery.params, ...storeParams, ...searchParams, ...excludeParams, userId]
      );
      const total = parseInt(countResult.rows[0].count);

      // 수신자 목록 (상위 10개)
      const unsubRecipIdx = 1 + filterQuery.params.length + storeParams.length + searchParams.length + excludeParams.length + 1;
      const limitIdx = unsubRecipIdx + 1;
      const recipients = await query(
        `SELECT phone, name, phone as idx
         FROM customers
         WHERE company_id = $1 AND is_active = true AND sms_opt_in = true
         ${filterQuery.where}${storeFilter}${searchFilter}${excludeFilter}
         AND NOT EXISTS (SELECT 1 FROM unsubscribes u WHERE u.user_id = $${unsubRecipIdx} AND u.phone = customers.phone)
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
    const searchParams2 = search ? [campaignId, `%${String(search).replace(/-/g, '')}%`] : [campaignId];

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

    // 2. 전화번호로 고객 정보 조회 (PostgreSQL)
    const phones = recipients.map((r: any) => r.dest_no);
    const customersResult = await query(
      `SELECT phone, name, grade, region FROM customers WHERE company_id = $1 AND phone = ANY($2)`,
      [companyId, phones]
    );

    // 전화번호 → 고객정보 맵
    const customerMap = new Map();
    customersResult.rows.forEach((c: any) => {
      customerMap.set(c.phone, c);
    });

    /// 3. 광고 문구 처리 (is_ad 필드 기준, 080번호는 company에서 조회)
    const adEnabled = campaign.rows[0].is_ad === true;
    const msgType = campaign.rows[0].message_type;
    let optOut080 = '';
    if (adEnabled) {
      const compInfo = await query('SELECT opt_out_080_number FROM companies WHERE id = $1', [companyId]);
      optOut080 = compInfo.rows[0]?.opt_out_080_number || '';
    }

    // 4. 테이블별로 그룹핑 후 Bulk UPDATE
    const tableGroups: Record<string, any[]> = {};
    for (const r of recipients) {
      const table = r._sms_table;
      if (!tableGroups[table]) tableGroups[table] = [];
      tableGroups[table].push(r);
    }

    const batchSize = 1000;
    let processedCount = 0;

    // Redis에 진행률 저장
    const redis = require('ioredis');
    const redisClient = new redis(process.env.REDIS_URL || 'redis://localhost:6379');

    await redisClient.set(`message_edit:${campaignId}:progress`, JSON.stringify({
      total: recipients.length,
      processed: 0,
      percent: 0
    }), 'EX', 600);

    for (const [table, tableRecipients] of Object.entries(tableGroups)) {
      for (let i = 0; i < tableRecipients.length; i += batchSize) {
        const batch = tableRecipients.slice(i, i + batchSize);

        // CASE WHEN 으로 배치 업데이트
        const cases: string[] = [];
        const titleCases: string[] = [];
        const seqnos: number[] = [];

        for (const recipient of batch) {
          const customer = customerMap.get(recipient.dest_no) || {};

          // 변수 치환
          let finalMessage = message
            .replace(/%이름%/g, customer.name || '고객')
            .replace(/%등급%/g, customer.grade || '')
            .replace(/%지역%/g, customer.region || '');

          // 광고 문구 추가
          if (adEnabled && optOut080) {
            const adPrefix = msgType === 'SMS' ? '(광고)' : '(광고) ';
            finalMessage = adPrefix + finalMessage;
            if (msgType === 'SMS') {
              finalMessage += `\n무료거부${optOut080.replace(/-/g, '')}`;
            } else {
              finalMessage += `\n무료수신거부 ${optOut080}`;
            }
          }

          // SQL escape
          const escapedMessage = finalMessage.replace(/'/g, "''");
          cases.push(`WHEN seqno = ${recipient.seqno} THEN '${escapedMessage}'`);

          // 제목 처리 (LMS/MMS)
          if (subject && (msgType === 'LMS' || msgType === 'MMS')) {
            let finalSubject = subject
              .replace(/%이름%/g, customer.name || '고객')
              .replace(/%등급%/g, customer.grade || '')
              .replace(/%지역%/g, customer.region || '');
            const escapedSubject = finalSubject.replace(/'/g, "''");
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
        await redisClient.set(`message_edit:${campaignId}:progress`, JSON.stringify({
          total: recipients.length,
          processed: processedCount,
          percent: Math.round((processedCount / recipients.length) * 100)
        }), 'EX', 600);
      }
    }

    // 5. PostgreSQL 캠페인 템플릿 업데이트
    await query(
      `UPDATE campaigns SET message_template = $1, message_subject = $2, message_content = $3, updated_at = NOW() WHERE id = $4`,
      [message, subject || null, message, campaignId]
    );

    await redisClient.quit();

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
    const redis = require('ioredis');
    const redisClient = new redis(process.env.REDIS_URL || 'redis://localhost:6379');

    const data = await redisClient.get(`message_edit:${campaignId}:progress`);
    await redisClient.quit();

    if (data) {
      return res.json(JSON.parse(data));
    }
    return res.json({ total: 0, processed: 0, percent: 100 });
  } catch (error) {
    return res.json({ total: 0, processed: 0, percent: 100 });
  }
});

export default router;
