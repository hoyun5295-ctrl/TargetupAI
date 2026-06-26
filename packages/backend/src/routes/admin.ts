import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { Request, Response, Router } from 'express';
import { mysqlQuery, query } from '../config/database';
import { authenticate, requireSuperAdmin } from '../middlewares/auth';
import { ALL_SMS_TABLES, invalidateLineGroupCache, getCampaignSmsTables, smsCountAll, smsSelectAll, smsSelectPagedAll, smsAggAll, getTestSmsTables, kakaoCountWhere, kakaoSelectWhere, kakaoBatchAggByGroup } from '../utils/sms-queue';
import { streamCampaignSmsCsv } from '../utils/campaign-sms-export';
// ★ 2026-06-25: 업로더별 고객 삭제 시 해당 회사 데이터 프로필 캐시 무효화(게이트 즉시 반영)
import { clearCompanyDataProfileCache } from '../utils/company-data-profile';
import { DASHBOARD_CARD_POOL, validateCardIds, getRequiredFields, filterPoolByAvailableData, generateDynamicCards } from '../utils/dashboard-card-pool';
import { detectEnabledFields } from '../utils/enabled-fields';
import { SUCCESS_CODES_SQL, PENDING_CODES_SQL, getStatusLabel, getStatusType, getCarrierLabel, isSuccess, isPending, getSendTypeLabel, getCampaignChannelLabel, getQueueRowStatus } from '../utils/sms-result-map';
import { DEFAULT_COSTS } from '../config/defaults';
import { validateSmsTables } from '../utils/sms-table-validator';
// ★ D145 P0: 예약 캠페인 자동 정리 (모든 발송 관련 라우트 정합성)
import { cleanupScheduledCampaigns, cancelCampaign } from '../utils/campaign-lifecycle';
import { getUserUnsubscribes, deleteUserUnsubscribes, exportUserUnsubscribes, CAMPAIGN_OPT080_SELECT_EXPR, CAMPAIGN_OPT080_LEFT_JOIN } from '../utils/unsubscribe-helper';
import { buildDateRangeFilter, aggregateSmsCountsByCampaign, aggregateSmsChannelSplitByCampaign, aggregateSmsSendTimesByCampaign, getCampaignResultCounts, STAT_DATE_EXPR, STAT_STARTED_GUARD } from '../utils/stats-aggregation';
import { normalizePhone } from '../utils/normalize-phone';
import { normalizeCdpAutoExecuteGate } from '../utils/autosend-policy';
import { grantBasicTrial } from '../utils/basic-trial';
// ★ 2026-06-11: 감사 로그 CT — 라인그룹 지정/해제 책임 추적 (에이치피오 예약취소 사고 후속)
import { recordAuditLog, isAuditLogViewer, isAiTrainingViewer, diffFields } from '../utils/audit-log';

const router = Router();

// ===== 사용자 관리 API =====

// 전체 사용자 목록 조회
router.get('/users', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    // ★ D131 후속(2026-04-21): system_sync_xxx Sync Agent 가상 계정 목록 노출 제외
    // ★ 2026-06-13 첫 로딩 속도: 행당 상관 서브쿼리(사용자 173명 × 2회 = 24만 행 customers 346회 탐침)
    //   → 집계 1회 GROUP BY JOIN. 값 동일(상관 COUNT 0 ↔ 그룹 부재 COALESCE 0).
    const result = await query(`
      SELECT
        u.id, u.login_id, u.name, u.email, u.phone, u.department,
        u.user_type, u.status, u.company_id, u.last_login_at, u.created_at,
        u.store_codes, u.line_group_id,
        u.opt_out_080_number, u.opt_out_auto_sync,
        c.company_name,
        lg.group_name as line_group_name,
        COALESCE(uns.cnt, 0) as unsubscribe_count,
        COALESCE(cust.cnt, 0) as uploaded_customer_count
      FROM users u
      LEFT JOIN companies c ON u.company_id = c.id
      LEFT JOIN sms_line_groups lg ON u.line_group_id = lg.id
      LEFT JOIN (SELECT user_id, COUNT(*) AS cnt FROM unsubscribes GROUP BY user_id) uns
        ON uns.user_id = u.id
      LEFT JOIN (SELECT uploaded_by, COUNT(*) AS cnt FROM customers WHERE is_active = true GROUP BY uploaded_by) cust
        ON cust.uploaded_by = u.id
      WHERE COALESCE(u.is_system, false) = false
      ORDER BY u.created_at DESC
    `);
    
    res.json({ users: result.rows });
  } catch (error) {
    console.error('사용자 목록 조회 실패:', error);
    res.status(500).json({ error: '사용자 목록 조회 실패' });
  }
});

// 사용자 추가 (계정 발급)
router.post('/users', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { companyId, loginId, password, name, email, phone, department, userType, storeCodes } = req.body;
  
  if (!companyId || !loginId || !password || !name) {
    return res.status(400).json({ error: '필수 항목을 입력해주세요.' });
  }
  
  try {
    // 중복 체크
    const existing = await query('SELECT id FROM users WHERE login_id = $1', [loginId]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: '이미 사용중인 로그인 ID입니다.' });
    }

    // max_users 상한 체크
    const companyResult = await query(
      'SELECT max_users FROM companies WHERE id = $1',
      [companyId]
    );
    if (companyResult.rows.length > 0 && companyResult.rows[0].max_users) {
      // ★ D131 후속: max_users 상한 체크에서 system 가상 계정 제외
      const userCountResult = await query(
        'SELECT COUNT(*) FROM users WHERE company_id = $1 AND is_active = true AND COALESCE(is_system, false) = false',
        [companyId]
      );
      const currentUsers = parseInt(userCountResult.rows[0].count);
      if (currentUsers >= companyResult.rows[0].max_users) {
        return res.status(403).json({ 
          error: `최대 사용자 수(${companyResult.rows[0].max_users}명)를 초과할 수 없습니다.`,
          code: 'MAX_USERS_REACHED'
        });
      }
    }
    
    // 비밀번호 해시
    const passwordHash = await bcrypt.hash(password, 10);
    
    const result = await query(`
      INSERT INTO users (company_id, login_id, password_hash, name, email, phone, department, user_type, status, must_change_password, store_codes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', true, $9)
      RETURNING id, login_id, name, email, user_type, status, created_at, store_codes
    `, [companyId, loginId, passwordHash, name, email || null, phone || null, department || null, userType || 'user', storeCodes || null]);
    
    res.status(201).json({ user: result.rows[0], message: '사용자가 생성되었습니다.' });
  } catch (error) {
    console.error('사용자 생성 실패:', error);
    res.status(500).json({ error: '사용자 생성 실패' });
  }
});

// 사용자 수정
router.put('/users/:id', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, email, phone, department, userType, status, storeCodes, lineGroupId, optOut080Number, optOutAutoSync } = req.body;

  try {
    // ★ 2026-06-11: 변경 전 값 조회 — (1) 감사 로그 before 기록 (2) 미전송 필드 보존
    const beforeRes = await query(
      `SELECT login_id, name, email, user_type, status, store_codes, line_group_id, opt_out_080_number FROM users WHERE id = $1`,
      [id]
    );
    if (beforeRes.rows.length === 0) {
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }
    const before = beforeRes.rows[0];

    // ★ 2026-06-11: 무조건 덮어쓰기 차단 — 요청 body에 명시된 경우에만 변경, 미전송 시 기존 값 보존.
    //   (이전에는 lineGroupId 미전송 수정 한 번에 라인그룹이 소리 없이 해제되던 결함)
    const has = (k: string) => Object.prototype.hasOwnProperty.call(req.body, k);
    const nextStoreCodes = has('storeCodes') ? (storeCodes || null) : before.store_codes;
    const nextLineGroupId = has('lineGroupId') ? (lineGroupId || null) : before.line_group_id;
    const nextOptOut080 = has('optOut080Number') ? (optOut080Number || null) : before.opt_out_080_number;

    const result = await query(`
      UPDATE users
      SET name = COALESCE($1, name),
          email = COALESCE($2, email),
          phone = COALESCE($3, phone),
          department = COALESCE($4, department),
          user_type = COALESCE($5, user_type),
          status = COALESCE($6, status),
          store_codes = $7,
          line_group_id = $8,
          opt_out_080_number = $9,
          opt_out_auto_sync = COALESCE($10, opt_out_auto_sync),
          updated_at = NOW()
      WHERE id = $11
      RETURNING id, login_id, name, email, user_type, status, store_codes, line_group_id, opt_out_080_number, opt_out_auto_sync
    `, [name, email, phone, department, userType, status, nextStoreCodes, nextLineGroupId, nextOptOut080, optOutAutoSync, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }

    // ★ 2026-06-11 감사 로그 — 변경된 필드만 before/after 기록 (라인그룹 지정/해제 책임 추적)
    const d = diffFields(before, result.rows[0], ['name', 'email', 'user_type', 'status', 'store_codes', 'line_group_id', 'opt_out_080_number']);
    // ★ 사용자 라인그룹 변경 시 캐시 즉시 무효화 — 변경 직후 옛 라인으로 적재(stale)되는 것 차단
    if (d.changed.includes('line_group_id')) {
      invalidateLineGroupCache();
    }
    if (d.changed.length > 0) {
      await recordAuditLog({
        actorUserId: req.user?.userId,
        action: 'user_update',
        targetType: 'user',
        targetId: id,
        details: { target_login_id: before.login_id, ...d },
        req,
      });
    }

    res.json({ user: result.rows[0], message: '수정되었습니다.' });
  } catch (error) {
    console.error('사용자 수정 실패:', error);
    res.status(500).json({ error: '사용자 수정 실패' });
  }
});

// ================================================================
// 슈퍼관리자 — 사용자별 수신거부 관리 (CT-03 컨트롤타워 활용)
// ================================================================

// 사용자별 수신거부 목록 조회
router.get('/users/:id/unsubscribes', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const search = req.query.search as string || '';

    const result = await getUserUnsubscribes(id, { page, limit, search });
    res.json(result);
  } catch (error) {
    console.error('수신거부 목록 조회 실패:', error);
    res.status(500).json({ error: '수신거부 목록 조회 실패' });
  }
});

// 사용자별 수신거부 일괄삭제
router.delete('/users/:id/unsubscribes', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { phones } = req.body || {};

    const deletedCount = await deleteUserUnsubscribes(id, phones);
    res.json({ deletedCount, message: `${deletedCount}건 삭제되었습니다.` });
  } catch (error) {
    console.error('수신거부 삭제 실패:', error);
    res.status(500).json({ error: '수신거부 삭제 실패' });
  }
});

// 사용자별 수신거부 CSV 다운로드
router.get('/users/:id/unsubscribes/export', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const data = await exportUserUnsubscribes(id);

    // CSV 생성
    const header = '전화번호,출처,등록일시\n';
    const sourceLabel: Record<string, string> = { '080_ars': '080 ARS', manual: '직접입력', upload: '파일업로드', sync: 'Sync연동', api: '080자동', db_upload: 'DB업로드' };
    const rows = data.map(r => `${r.phone},${sourceLabel[r.source] || r.source},${new Date(r.created_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=unsubscribes_${id}_${new Date().toISOString().slice(0,10)}.csv`);
    res.send('\uFEFF' + header + rows); // BOM for Excel
  } catch (error) {
    console.error('수신거부 다운로드 실패:', error);
    res.status(500).json({ error: '수신거부 다운로드 실패' });
  }
});

// ================================================================
// 사용자별 업로드 고객 DB 삭제
// uploaded_by = userId 인 고객만 삭제 (연관 데이터 포함)
// ================================================================
router.delete('/users/:id/customers', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const adminUserId = req.user?.userId;

    // 사용자 확인
    const userResult = await query(
      'SELECT u.id, u.name, u.company_id, c.company_name FROM users u JOIN companies c ON c.id = u.company_id WHERE u.id = $1',
      [id]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }
    const user = userResult.rows[0];

    // 삭제 대상 건수 확인
    const countResult = await query(
      'SELECT COUNT(*) FROM customers WHERE uploaded_by = $1 AND is_active = true',
      [id]
    );
    const totalCount = parseInt(countResult.rows[0].count);

    if (totalCount === 0) {
      return res.status(400).json({ error: '이 사용자가 업로드한 고객 데이터가 없습니다.' });
    }

    // 연관 데이터 삭제
    const purchaseResult = await query(
      'DELETE FROM purchases WHERE customer_id IN (SELECT id FROM customers WHERE uploaded_by = $1)',
      [id]
    );
    await query(
      'DELETE FROM consents WHERE customer_id IN (SELECT id FROM customers WHERE uploaded_by = $1)',
      [id]
    );

    // 고객 삭제
    const deleteResult = await query(
      'DELETE FROM customers WHERE uploaded_by = $1',
      [id]
    );

    // ★ 2026-06-25: 고객 수 변동 → 해당 회사 데이터 프로필 캐시 무효화(게이트 즉시 반영)
    if (user.company_id) clearCompanyDataProfileCache(user.company_id);

    // 감사 로그
    await query(
      `INSERT INTO audit_logs (user_id, action, target_type, target_id, details, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        adminUserId,
        'customer_delete_by_user',
        'user',
        id,
        JSON.stringify({
          delete_type: 'by_uploaded_user',
          target_user_name: user.name,
          company_name: user.company_name,
          deleted_customers: deleteResult.rowCount,
          deleted_purchases: purchaseResult.rowCount
        }),
        req.ip,
        req.headers['user-agent'] || ''
      ]
    );

    console.log(`[관리자] 사용자별 고객 삭제: ${user.name} (${user.company_name}) → ${deleteResult.rowCount}명`);

    res.json({
      success: true,
      message: `${deleteResult.rowCount}명의 고객 데이터가 삭제되었습니다.`,
      deletedCount: deleteResult.rowCount,
      deletedPurchases: purchaseResult.rowCount
    });
  } catch (error) {
    console.error('사용자별 고객 삭제 실패:', error);
    res.status(500).json({ error: '삭제 실패' });
  }
});

// 사용자 삭제
router.delete('/users/:id', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  
  try {
    const result = await query('DELETE FROM users WHERE id = $1 RETURNING id, login_id', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }
    
    res.json({ message: '삭제되었습니다.' });
  } catch (error) {
    console.error('사용자 삭제 실패:', error);
    res.status(500).json({ error: '사용자 삭제 실패' });
  }
});

// 비밀번호 초기화
router.post('/users/:id/reset-password', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  
  try {
    // 사용자 정보 조회 (phone 포함)
    const userResult = await query('SELECT id, login_id, name, phone FROM users WHERE id = $1', [id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }
    const user = userResult.rows[0];
    
    // ★ 보안: 암호학적 안전 난수로 임시 비밀번호 생성
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let tempPassword = '';
    for (let i = 0; i < 8; i++) {
      tempPassword += chars.charAt(crypto.randomInt(chars.length));
    }
    
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    
    await query(`
      UPDATE users 
      SET password_hash = $1, must_change_password = true, updated_at = NOW()
      WHERE id = $2
    `, [passwordHash, id]);
    
    // SMS 발송 (휴대폰 번호가 있는 경우)
    // ★ D182 (2026-05-19): 내부 발송(비밀번호 초기화)이므로 운영 라인 점유 X → 담당자 테스트 라인 사용
    //   Harold 명시 — 패스워드 초기화 SMS는 스팸테스트와 동일한 발송라인(targetai10/SMSQ_SEND_10)으로 분리
    let smsSent = false;
    if (user.phone) {
      try {
        const phone = user.phone.replace(/-/g, '');
        const message = `[Target-UP] 임시 비밀번호: ${tempPassword}\n최초 로그인 시 비밀번호 변경이 필요합니다.`;

        const callback = process.env.SYSTEM_SMS_CALLBACK;
        if (!callback) throw new Error('SYSTEM_SMS_CALLBACK 환경변수가 설정되지 않았습니다');
        const testTables = await getTestSmsTables();
        const targetTable = testTables[0]; // SMSQ_SEND_10 (담당자 테스트 라인)
        await mysqlQuery(
          `INSERT INTO ${targetTable} (dest_no, call_back, msg_contents, msg_type, sendreq_time, status_code, rsv1) VALUES (?, ?, ?, 'S', NOW(), 100, '1')`,
          [phone, callback, message]
        );
        smsSent = true;
      } catch (smsError) {
        console.error('SMS 발송 실패:', smsError);
      }
    }
    
    res.json({ 
      tempPassword, 
      message: '비밀번호가 초기화되었습니다.',
      user: { id: user.id, login_id: user.login_id, name: user.name },
      smsSent,
      phone: user.phone ? user.phone.replace(/(\d{3})(\d{4})(\d{4})/, '$1-****-$3') : null
    });
  } catch (error) {
    console.error('비밀번호 초기화 실패:', error);
    res.status(500).json({ error: '비밀번호 초기화 실패' });
  }
});

// ===== 회사 상세 수정 API =====

// 회사 상세 조회
router.get('/companies/:id', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  
  try {
    const result = await query(`
      SELECT c.*, p.plan_name,
        (SELECT COUNT(*) FROM customers WHERE company_id = c.id) as total_customers,
        (SELECT COUNT(*) FROM users WHERE company_id = c.id AND COALESCE(is_system, false) = false) as total_users
      FROM companies c
      LEFT JOIN plans p ON c.plan_id = p.id
      WHERE c.id = $1
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '회사를 찾을 수 없습니다.' });
    }
    
    res.json({ company: result.rows[0] });
  } catch (error) {
    console.error('회사 조회 실패:', error);
    res.status(500).json({ error: '회사 조회 실패' });
  }
});

// 회사 수정
router.put('/companies/:id', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { 
    companyName, contactName, contactEmail, contactPhone,
    status, planId, rejectNumber, brandName,
    sendHourStart, sendHourEnd, dailyLimit, holidaySend, duplicateDays,
    costPerSms, costPerLms, costPerMms, costPerKakao,
    storeCodeList,
    businessNumber, ceoName, businessType, businessItem, address,
    allowCallbackSelfRegister, maxUsers, sessionTimeoutMinutes,
    approvalRequired, targetStrategy, lineGroupId, kakaoEnabled,
    subscriptionStatus,
    userIsolationEnabled  // ★ D162-3 (2026-05-15) 수신거부 사용자격리 ON/OFF
  } = req.body;
  
  try {
    // ★ CT-17: planId 변경 시 TRIAL plan이면 'trial' 유지, 그 외 유료 플랜이면 'paid'(정식 구독).
    //   (과거 버그 ①: planId 있으면 무조건 'active'로 덮어써서 grant-trial 직후 재저장 시 체험 상태 파괴)
    //   (네이밍 정리 ②: 'active'는 companies.status(운영 활성)와 네이밍 충돌 → 구독 상태는 'paid'로 통일)
    let finalSubscriptionStatus: string | null = subscriptionStatus || null;
    if (planId) {
      const planCodeRes = await query(`SELECT plan_code FROM plans WHERE id = $1`, [planId]);
      const isTrialPlan = planCodeRes.rows[0]?.plan_code === 'TRIAL';
      finalSubscriptionStatus = isTrialPlan ? 'trial' : 'paid';
    }

    // ★ 2026-06-11 감사: 회사 라인그룹 변경 추적 — 변경 전 값 확보
    let prevCompanyLineGroupId: string | null = null;
    if (lineGroupId) {
      const prevLg = await query('SELECT line_group_id FROM companies WHERE id = $1', [id]);
      prevCompanyLineGroupId = prevLg.rows[0]?.line_group_id ?? null;
    }

    const result = await query(`
      UPDATE companies
      SET company_name = COALESCE($1, company_name),
          contact_name = COALESCE($2, contact_name),
          contact_email = COALESCE($3, contact_email),
          contact_phone = COALESCE($4, contact_phone),
          status = COALESCE($5, status),
          plan_id = COALESCE($6, plan_id),
          subscription_status = CASE WHEN $6 IS NOT NULL THEN $31::varchar ELSE COALESCE($31, subscription_status) END,
          reject_number = COALESCE($7, reject_number),
          brand_name = COALESCE($8, brand_name),
          send_start_hour = COALESCE($9, send_start_hour),
          send_end_hour = COALESCE($10, send_end_hour),
          daily_limit_per_customer = COALESCE($11, daily_limit_per_customer),
          holiday_send_allowed = COALESCE($12, holiday_send_allowed),
          duplicate_prevention_days = COALESCE($13, duplicate_prevention_days),
          cost_per_sms = COALESCE($14, cost_per_sms),
          cost_per_lms = COALESCE($15, cost_per_lms),
          cost_per_mms = COALESCE($16, cost_per_mms),
          cost_per_kakao = COALESCE($17, cost_per_kakao),
          store_code_list = COALESCE($18, store_code_list),
          business_number = COALESCE($19, business_number),
          ceo_name = COALESCE($20, ceo_name),
          business_type = COALESCE($21, business_type),
          business_item = COALESCE($22, business_item),
          address = COALESCE($23, address),
          allow_callback_self_register = COALESCE($24, allow_callback_self_register),
          max_users = COALESCE($25, max_users),
          session_timeout_minutes = COALESCE($26, session_timeout_minutes),
          approval_required = COALESCE($27, approval_required),
          target_strategy = COALESCE($28, target_strategy),
          line_group_id = COALESCE($29, line_group_id),
          kakao_enabled = COALESCE($30, kakao_enabled),
          user_isolation_enabled = COALESCE($33, user_isolation_enabled),
          -- subscription_status는 위 plan_id CASE문에서 처리
          updated_at = NOW()
      WHERE id = $32
      RETURNING *
    `, [companyName, contactName, contactEmail, contactPhone, status, planId, rejectNumber, brandName, sendHourStart, sendHourEnd, dailyLimit, holidaySend, duplicateDays, costPerSms, costPerLms, costPerMms, costPerKakao, storeCodeList ? JSON.stringify(storeCodeList) : null, businessNumber, ceoName, businessType, businessItem, address, allowCallbackSelfRegister !== undefined ? allowCallbackSelfRegister : null, maxUsers || null, sessionTimeoutMinutes || null, approvalRequired !== undefined ? approvalRequired : null, targetStrategy || null, lineGroupId || null, kakaoEnabled !== undefined ? kakaoEnabled : null, finalSubscriptionStatus, id, userIsolationEnabled !== undefined ? userIsolationEnabled : null]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '회사를 찾을 수 없습니다.' });
    }

    // ★ 회사 라인그룹 변경 시 캐시 즉시 무효화 — 변경 직후 옛 라인으로 적재(stale)되는 것 차단
    //   (라인그룹 CRUD는 invalidate가 있었으나 회사 라인 '할당' 변경 경로는 누락되어 있었음)
    if (lineGroupId && prevCompanyLineGroupId !== lineGroupId) {
      invalidateLineGroupCache();
      await recordAuditLog({
        actorUserId: req.user?.userId,
        action: 'company_line_group_change',
        targetType: 'company',
        targetId: id,
        details: {
          company_name: result.rows[0].company_name,
          line_group_id: { before: prevCompanyLineGroupId, after: lineGroupId },
        },
        req,
      });
    }

    res.json({ company: result.rows[0], message: '수정되었습니다.' });
  } catch (error) {
    console.error('회사 수정 실패:', error);
    res.status(500).json({ error: '회사 수정 실패' });
  }
});

// ★ D190 #2 (2026-05-22): orchestrateWithAI 회사별 토글 — 슈퍼관리자 전용
// PATCH /api/admin/companies/:id/ai-orchestrator { enabled: boolean }
//   ENT 1사 한정 활성 → PM2 로그 비교 분석 (Compliance 통과율 + 비용 + latency) → 단계적 확장
router.patch('/companies/:id/ai-orchestrator', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { enabled } = req.body;

  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled는 boolean 필수' });
  }

  try {
    const result = await query(
      `UPDATE companies
       SET use_ai_orchestrator = $1, updated_at = NOW()
       WHERE id = $2::uuid
       RETURNING id, company_name, use_ai_orchestrator`,
      [enabled, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: '회사를 찾을 수 없습니다.' });
    }

    console.log(`[Admin] AI Orchestrator 토글: company=${result.rows[0].company_name} → ${enabled}`);
    res.json({
      company: result.rows[0],
      message: enabled
        ? 'AI Orchestrator (Tool Use) 활성됨 — PM2 로그 모니터링 권장'
        : 'AI Orchestrator 비활성됨 — 기존 orchestrate 흐름으로 복원',
    });
  } catch (error) {
    console.error('AI Orchestrator 토글 실패:', error);
    res.status(500).json({ error: 'AI Orchestrator 토글 실패' });
  }
});

// ★ 2026-06-06 자동마케팅 자율발송 게이트 — 슈퍼관리자 회사별 ON/임계값(companies.cdp_auto_execute_* 4컬럼).
//   잔액 자동 차감 + 고객 자동 발송 직결이라 운영자(슈퍼관리자)만 제어. 입력은 normalizeCdpAutoExecuteGate로 clamp·화이트리스트.
router.patch('/companies/:id/cdp-auto-execute', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const gate = normalizeCdpAutoExecuteGate(req.body);

  try {
    const result = await query(
      `UPDATE companies
       SET cdp_auto_execute_enabled = $1,
           cdp_auto_execute_max_recipients = $2,
           cdp_auto_execute_max_cost_krw = $3,
           cdp_auto_execute_max_risk = $4,
           updated_at = NOW()
       WHERE id = $5::uuid
       RETURNING id, company_name, cdp_auto_execute_enabled,
                 cdp_auto_execute_max_recipients, cdp_auto_execute_max_cost_krw, cdp_auto_execute_max_risk`,
      [gate.enabled, gate.maxRecipients, gate.maxCostKrw, gate.maxRisk, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: '회사를 찾을 수 없습니다.' });
    }

    console.log(`[Admin] 자율발송 게이트: company=${result.rows[0].company_name} → enabled=${gate.enabled} / max ${gate.maxRecipients}명·${gate.maxCostKrw}원·risk ${gate.maxRisk}`);
    res.json({
      company: result.rows[0],
      message: gate.enabled
        ? `자율발송 ON — 최대 ${gate.maxRecipients.toLocaleString()}명 / 회당 ${gate.maxCostKrw.toLocaleString()}원 / 위험도 ${gate.maxRisk}`
        : '자율발송 OFF — 이후 제안서는 담당자 수동 승인 대기',
    });
  } catch (error: any) {
    const msg = error?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({
        success: false,
        code: 'DB_MIGRATION_PENDING',
        error: 'DB 마이그레이션 필요 — companies 자율발송 게이트 컬럼(cdp_auto_execute_*) ALTER 실행 요청',
      });
    }
    console.error('자율발송 게이트 저장 실패:', error);
    res.status(500).json({ error: '자율발송 게이트 저장 실패' });
  }
});

// 회사 비활성화 (soft delete)
router.delete('/companies/:id', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  
  try {
    // 활성 캠페인이 있는지 확인
    const activeCampaigns = await query(
      "SELECT COUNT(*) FROM campaigns WHERE company_id = $1 AND status IN ('scheduled', 'sending')",
      [id]
    );
    if (parseInt(activeCampaigns.rows[0].count) > 0) {
      return res.status(400).json({ error: '진행 중이거나 예약된 캠페인이 있어 해지할 수 없습니다.' });
    }
    
    const result = await query(`
      UPDATE companies 
      SET status = 'terminated', updated_at = NOW()
      WHERE id = $1
      RETURNING id, company_name
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '회사를 찾을 수 없습니다.' });
    }
    
    // 해당 회사 사용자도 비활성화
    await query(
      "UPDATE users SET status = 'dormant', updated_at = NOW() WHERE company_id = $1",
      [id]
    );
    
    res.json({ message: `${result.rows[0].company_name}이(가) 해지되었습니다.` });
  } catch (error) {
    console.error('회사 해지 실패:', error);
    res.status(500).json({ error: '회사 해지 실패' });
  }
});

// ===== 대시보드 카드 설정 API (D41) =====

// company_settings UPSERT 헬퍼 (UNIQUE 제약 없이도 안전)
async function upsertCompanySetting(
  companyId: string, settingKey: string, settingValue: string,
  settingType: string = 'string', description: string = ''
): Promise<void> {
  const existing = await query(
    'SELECT id FROM company_settings WHERE company_id = $1 AND setting_key = $2',
    [companyId, settingKey]
  );
  if (existing.rows.length > 0) {
    await query(
      'UPDATE company_settings SET setting_value = $1, updated_at = NOW() WHERE company_id = $2 AND setting_key = $3',
      [settingValue, companyId, settingKey]
    );
  } else {
    await query(
      'INSERT INTO company_settings (company_id, setting_key, setting_value, setting_type, description) VALUES ($1, $2, $3, $4, $5)',
      [companyId, settingKey, settingValue, settingType, description]
    );
  }
}

// GET /api/admin/companies/:id/dashboard-cards — 고객사 카드 설정 조회
router.get('/companies/:id/dashboard-cards', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // 회사 존재 확인
    const companyCheck = await query('SELECT id, company_name FROM companies WHERE id = $1', [id]);
    if (companyCheck.rows.length === 0) {
      return res.status(404).json({ error: '회사를 찾을 수 없습니다.' });
    }

    // 현재 설정 조회
    const settingsResult = await query(
      `SELECT setting_key, setting_value
       FROM company_settings
       WHERE company_id = $1 AND setting_key IN ('dashboard_cards', 'dashboard_card_count')`,
      [id]
    );

    const settings: Record<string, string> = {};
    for (const row of settingsResult.rows as any[]) {
      settings[row.setting_key] = row.setting_value;
    }

    let selectedCards: string[] = [];
    try {
      selectedCards = settings.dashboard_cards ? JSON.parse(settings.dashboard_cards) : [];
    } catch {
      selectedCards = [];
    }

    // ★ 고객사 데이터 유무 동적 체크 (직접 컬럼 + 커스텀 필드 JSONB 양쪽)
    // enabled-fields API와 동일한 방식으로 체크
    const availableColumns = new Set<string>();

    // 1. 직접 컬럼 데이터 유무 — EXISTS 서브쿼리
    const requiredFields = getRequiredFields();
    if (requiredFields.length > 0) {
      const existsClauses = requiredFields.map((field, i) => {
        if (['total_purchase_amount'].includes(field)) {
          return `EXISTS(SELECT 1 FROM customers WHERE company_id = $1 AND ${field} IS NOT NULL AND ${field} > 0) as has_${i}`;
        }
        return `EXISTS(SELECT 1 FROM customers WHERE company_id = $1 AND ${field} IS NOT NULL AND ${field}::text != '') as has_${i}`;
      });
      const checkResult = await query(`SELECT ${existsClauses.join(', ')}`, [id]);
      if (checkResult.rows.length > 0) {
        const row = checkResult.rows[0] as any;
        requiredFields.forEach((field, i) => {
          if (row[`has_${i}`]) availableColumns.add(field);
        });
      }
    }

    // 2. 커스텀 필드 — custom_fields JSONB에 데이터 있는 키의 라벨 조회
    let customFieldLabels: string[] = [];
    try {
      const customResult = await query(`
        SELECT DISTINCT cfd.field_label
        FROM customer_field_definitions cfd
        WHERE cfd.company_id = $1
          AND cfd.field_key LIKE 'custom_%'
          AND EXISTS (
            SELECT 1 FROM customers c
            WHERE c.company_id = $1
              AND c.custom_fields->>cfd.field_key IS NOT NULL
              AND c.custom_fields->>cfd.field_key != ''
            LIMIT 1
          )
      `, [id]);
      customFieldLabels = customResult.rows.map((r: any) => (r.field_label || '').toLowerCase());
    } catch { /* custom_fields 없으면 무시 */ }

    // 3. 직접 컬럼 OR 커스텀 필드 라벨 매칭으로 카드 풀 필터링
    const filteredPool = filterPoolByAvailableData(availableColumns, customFieldLabels);

    // ★ D136 (2026-04-22 PDF #8): 고객사 업로드 커스텀 필드 기반 동적 카드 자동 생성
    //   CT-18 detectEnabledFields로 해당 회사의 실제 활성 필드 탐지 →
    //   커스텀 필드(is_custom=true)마다 data_type 기반 동적 카드 생성 → 풀에 merge.
    //   예: 고객사가 "시리얼" 업로드 → `dyn_custom_1_dist` "시리얼별 분포" 자동 노출.
    let dynamicCards: typeof filteredPool = [];
    try {
      const { fields } = await detectEnabledFields({
        companyId: id,
        scopeWhere: 'company_id = $1 AND is_active = true',
        scopeParams: [id],
      });
      dynamicCards = generateDynamicCards(fields);
    } catch (detectErr) {
      console.warn('[admin/dashboard-cards] 동적 카드 생성 실패 (고정 풀만 노출):', (detectErr as any)?.message);
    }

    const fullPool = [...filteredPool, ...dynamicCards];

    // 기존 selectedCards 중 풀에 없는 카드 제거 (고정+동적 합쳐서 검증)
    const fullPoolIds = new Set(fullPool.map(c => c.cardId));
    const validSelectedCards = selectedCards.filter(cid => fullPoolIds.has(cid));

    res.json({
      companyName: companyCheck.rows[0].company_name,
      pool: fullPool,
      selectedCards: validSelectedCards,
      cardCount: validSelectedCards.length,
    });
  } catch (error) {
    console.error('대시보드 카드 설정 조회 실패:', error);
    res.status(500).json({ error: '대시보드 카드 설정 조회 실패' });
  }
});

// PUT /api/admin/companies/:id/dashboard-cards — 카드 설정 저장
router.put('/companies/:id/dashboard-cards', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { cards, cardCount } = req.body;

    // 입력 검증
    if (!Array.isArray(cards)) {
      return res.status(400).json({ error: 'cards는 배열이어야 합니다.' });
    }
    // cardCount는 더 이상 4/8 제한 없음 — 프론트에서 6개씩 페이징 표시
    // 하위호환: cardCount가 전달되면 cards.length로 자동 설정
    const effectiveCardCount = cards.length;
    // ★ D136 (2026-04-22 PDF #8): 동적 카드 추가로 상한은 고정 풀 17개를 초과할 수 있음 →
    //   단순 상한 17 → 실용 상한 50으로 완화 (고정 17 + 커스텀 15 여유 + 버퍼).
    //   실제 풀에 없는 cardId는 validateCardIds에서 걸러짐 → 과잉 상한 방지.
    // ★ 빈 배열 허용 — 0개 선택 시 고객사 대시보드에 DB현황 미표시
    const MAX_DASHBOARD_CARDS = 50;
    if (cards.length > MAX_DASHBOARD_CARDS) {
      return res.status(400).json({ error: `카드는 최대 ${MAX_DASHBOARD_CARDS}개까지 선택 가능합니다.` });
    }

    // 카드 ID 유효성
    const validation = validateCardIds(cards);
    if (!validation.valid) {
      return res.status(400).json({ error: `유효하지 않은 카드 ID: ${validation.invalid.join(', ')}` });
    }

    // 중복 검사
    if (new Set(cards).size !== cards.length) {
      return res.status(400).json({ error: '중복된 카드가 있습니다.' });
    }

    // 회사 존재 확인
    const companyCheck = await query('SELECT id FROM companies WHERE id = $1', [id]);
    if (companyCheck.rows.length === 0) {
      return res.status(404).json({ error: '회사를 찾을 수 없습니다.' });
    }

    // UPSERT
    await upsertCompanySetting(id, 'dashboard_cards', JSON.stringify(cards), 'json', '대시보드 표시 카드 목록');
    await upsertCompanySetting(id, 'dashboard_card_count', effectiveCardCount.toString(), 'string', '대시보드 카드 수');

    res.json({
      message: '대시보드 카드 설정이 저장되었습니다.',
      cards,
      cardCount: effectiveCardCount,
    });
  } catch (error) {
    console.error('대시보드 카드 설정 저장 실패:', error);
    res.status(500).json({ error: '대시보드 카드 설정 저장 실패' });
  }
});

// ===== 예약 캠페인 관리 API =====

// 예약된 캠페인 목록 조회 (전체 고객사)
router.get('/campaigns/scheduled', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const search = (req.query.search as string) || '';
    const companyId = (req.query.companyId as string) || '';
    const status = (req.query.status as string) || '';       // scheduled / cancelled / '' (all)
    const startDate = (req.query.startDate as string) || '';
    const endDate = (req.query.endDate as string) || '';
    const loginId = (req.query.loginId as string) || '';     // 사용자 계정 검색

    // ★ D227+ (2026-05-28): cleanupScheduledCampaigns 동기 호출 제거 — 6만건 안 30~40초 사고 정정.
    //   = utils/scheduled-cleanup-worker.ts 안 1분 cron 영역 통합 (app.ts:startScheduledCleanupWorker).

    let where = `WHERE c.status IN ('scheduled', 'cancelled')`;
    const params: any[] = [];
    let paramIdx = 1;

    if (status) {
      where += ` AND c.status = $${paramIdx}`;
      params.push(status);
      paramIdx++;
    }
    if (companyId) {
      where += ` AND c.company_id = $${paramIdx}`;
      params.push(companyId);
      paramIdx++;
    }
    // ★ 발송결과/발송통계와 동일하게 송출일 기준(scheduled 우선)으로 통일
    const dateDr = buildDateRangeFilter(STAT_DATE_EXPR, startDate, endDate, paramIdx);
    where += dateDr.sql;
    params.push(...dateDr.params);
    paramIdx = dateDr.nextIndex;
    if (search) {
      where += ` AND (c.campaign_name ILIKE $${paramIdx} OR co.company_name ILIKE $${paramIdx})`;
      params.push(`%${search}%`);
      paramIdx++;
    }
    if (loginId) {
      where += ` AND u.login_id ILIKE $${paramIdx}`;
      params.push(`%${loginId}%`);
      paramIdx++;
    }

    const countResult = await query(
      `SELECT COUNT(*) FROM campaigns c LEFT JOIN companies co ON c.company_id = co.id LEFT JOIN users u ON c.created_by = u.id ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    const result = await query(`
      SELECT 
        c.id, c.campaign_name, c.status, c.scheduled_at, c.target_count,
        c.created_at, c.cancelled_by, c.cancelled_by_type, c.cancel_reason, c.cancelled_at,
        c.message_type, c.send_type, c.send_channel,
        co.company_name, co.company_code,
        u.name as created_by_name, u.login_id as created_by_login
      FROM campaigns c
      LEFT JOIN companies co ON c.company_id = co.id
      LEFT JOIN users u ON c.created_by = u.id
      ${where}
      ORDER BY CASE WHEN c.status = 'scheduled' THEN 0 ELSE 1 END, c.scheduled_at ASC, c.id ASC
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
    `, [...params, limit, offset]);
    
    res.json({ campaigns: result.rows, total, page, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('예약 캠페인 조회 실패:', error);
    res.status(500).json({ error: '예약 캠페인 조회 실패' });
  }
});

// 슈퍼관리자 예약 취소
router.post('/campaigns/:id/cancel', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { reason } = req.body;
  const adminId = (req as any).user?.userId;
  
  if (!reason || reason.trim() === '') {
    return res.status(400).json({ error: '취소 사유를 입력해주세요.' });
  }
  
  try {
    // 캠페인 + 회사 확인 (슈퍼관리자는 cross-company라 company_id를 직접 조회)
    const check = await query('SELECT company_id, status, campaign_name FROM campaigns WHERE id = $1', [id]);

    if (check.rows.length === 0) {
      return res.status(404).json({ error: '캠페인을 찾을 수 없습니다.' });
    }

    if (check.rows[0].status !== 'scheduled') {
      return res.status(400).json({ error: '예약 상태인 캠페인만 취소할 수 있습니다.' });
    }

    // ★ 2026-06-26: 슈퍼관리자 긴급취소도 사용자 취소와 동일 CT(cancelCampaign) 사용.
    //   기존엔 PG status만 'cancelled'로 바꾸고 MySQL 발송 큐를 즉시 안 지워, 발송 직전 취소 시
    //   안전망 워커(1분 주기)가 못 돌면 그대로 실발송될 수 있었다(0611 에이치피오 패턴).
    //   cancelCampaign = 큐 즉시 DELETE + 잔존0 검증 후에만 'cancelled' 확정 + 선불 환불.
    //   skipTimeCheck=true: 발송 직전 긴급취소도 큐를 비워 실발송을 막는다.
    const result = await cancelCampaign(id, check.rows[0].company_id, {
      reason: reason.trim(),
      cancelledBy: adminId,
      cancelledByType: 'super_admin',
      skipTimeCheck: true,
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error || '예약 취소에 실패했습니다.' });
    }

    res.json({
      message: '예약이 취소되었습니다.',
      campaign: { id, campaign_name: check.rows[0].campaign_name },
      cancelledCount: result.cancelledCount,
      refundedAmount: result.refundedAmount,
    });
  } catch (error) {
    console.error('예약 취소 실패:', error);
    res.status(500).json({ error: '예약 취소 실패' });
  }
});
// ===== 발신번호 관리 API =====

// 발신번호 목록 조회
router.get('/callback-numbers', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const result = await query(`
      SELECT 
        cn.id, cn.phone, cn.label, cn.is_default, cn.created_at,
        c.company_name, c.company_code, c.id as company_id
      FROM callback_numbers cn
      LEFT JOIN companies c ON cn.company_id = c.id
      ORDER BY c.company_name, cn.is_default DESC, cn.created_at DESC
    `);
    
    res.json({ callbackNumbers: result.rows });
  } catch (error) {
    console.error('발신번호 조회 실패:', error);
    res.status(500).json({ error: '발신번호 조회 실패' });
  }
});

// 발신번호 등록
router.post('/callback-numbers', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { companyId, phone, label, isDefault } = req.body;

  if (!companyId || !phone) {
    return res.status(400).json({ error: '회사와 발신번호는 필수입니다.' });
  }

  // ★ D142+ (2026-04-29) 0429 PDF B5 — phone 정규화 + 중복 등록 사전 차단
  //   기존: 사용자 입력 그대로 INSERT → '02-3145-2186' / '0231452186' 같은 형식 차이로 중복 등록 가능
  //   변경: normalizePhone으로 통일 저장 + 사전 SELECT로 중복 체크 + DB UNIQUE 제약(별도 마이그레이션)
  const normalizedPhone = normalizePhone(phone);
  if (normalizedPhone.length < 8 || normalizedPhone.length > 11) {
    return res.status(400).json({ error: '유효하지 않은 발신번호 형식입니다.' });
  }

  try {
    // 사전 중복 체크 (정규화된 phone 기준 — 형식 차이로 인한 우회 차단)
    const dupCheck = await query(
      `SELECT id FROM callback_numbers WHERE company_id = $1 AND regexp_replace(phone, '\\D', '', 'g') = $2`,
      [companyId, normalizedPhone]
    );
    if (dupCheck.rows.length > 0) {
      return res.status(409).json({
        error: '이미 등록된 발신번호입니다. 같은 고객사에 동일한 번호를 중복 등록할 수 없습니다.',
        code: 'DUPLICATE_CALLBACK_NUMBER',
      });
    }

    // 대표번호로 설정 시 기존 대표번호 해제
    if (isDefault) {
      await query('UPDATE callback_numbers SET is_default = false WHERE company_id = $1', [companyId]);
    }

    // ★ D142+ B5: INSERT는 사용자 입력 phone 그대로 저장 (UI 표시 형식 유지 — '02-3145-2186')
    //   중복 차단은 위 사전 체크(정규화 비교) + DB functional UNIQUE index가 책임
    const result = await query(`
      INSERT INTO callback_numbers (company_id, phone, label, is_default)
      VALUES ($1, $2, $3, $4)
      RETURNING id, phone, label, is_default
    `, [companyId, phone, label || null, isDefault || false]);

    res.json({
      message: '발신번호가 등록되었습니다.',
      callbackNumber: result.rows[0]
    });
  } catch (error: any) {
    // PostgreSQL UNIQUE 제약 위반(에러코드 23505) 안내 — DB 레벨 중복 차단
    if (error?.code === '23505') {
      return res.status(409).json({
        error: '이미 등록된 발신번호입니다. 같은 고객사에 동일한 번호를 중복 등록할 수 없습니다.',
        code: 'DUPLICATE_CALLBACK_NUMBER',
      });
    }
    console.error('발신번호 등록 실패:', error);
    res.status(500).json({ error: '발신번호 등록 실패' });
  }
});

// 발신번호 수정
router.put('/callback-numbers/:id', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { phone, label } = req.body;
  
  try {
    const result = await query(`
      UPDATE callback_numbers 
      SET phone = COALESCE($1, phone),
          label = COALESCE($2, label)
      WHERE id = $3
      RETURNING id, phone, label, is_default
    `, [phone, label, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '발신번호를 찾을 수 없습니다.' });
    }
    
    res.json({ message: '수정되었습니다.', callbackNumber: result.rows[0] });
  } catch (error) {
    console.error('발신번호 수정 실패:', error);
    res.status(500).json({ error: '발신번호 수정 실패' });
  }
});

// 발신번호 삭제
router.delete('/callback-numbers/:id', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  
  try {
    const result = await query('DELETE FROM callback_numbers WHERE id = $1 RETURNING phone', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '발신번호를 찾을 수 없습니다.' });
    }
    
    res.json({ message: '삭제되었습니다.' });
  } catch (error) {
    console.error('발신번호 삭제 실패:', error);
    res.status(500).json({ error: '발신번호 삭제 실패' });
  }
});

// 대표번호 설정
router.put('/callback-numbers/:id/default', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  
  try {
    const check = await query('SELECT company_id FROM callback_numbers WHERE id = $1', [id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ error: '발신번호를 찾을 수 없습니다.' });
    }
    
    const companyId = check.rows[0].company_id;
    
    await query('UPDATE callback_numbers SET is_default = false WHERE company_id = $1', [companyId]);
    await query('UPDATE callback_numbers SET is_default = true WHERE id = $1', [id]);
    
    res.json({ message: '대표번호로 설정되었습니다.' });
  } catch (error) {
    console.error('대표번호 설정 실패:', error);
    res.status(500).json({ error: '대표번호 설정 실패' });
  }
});
// ===== 요금제 관리 API =====

// 요금제 목록 조회
router.get('/plans', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const result = await query(`
      SELECT p.*, 
        (SELECT COUNT(*) FROM companies WHERE plan_id = p.id) as company_count
      FROM plans p
      ORDER BY p.monthly_price ASC
    `);
    
    res.json({ plans: result.rows });
  } catch (error) {
    console.error('요금제 조회 실패:', error);
    res.status(500).json({ error: '요금제 조회 실패' });
  }
});

// 요금제 추가
router.post('/plans', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { planCode, planName, maxCustomers, monthlyPrice } = req.body;
  
  if (!planCode || !planName || maxCustomers === undefined || monthlyPrice === undefined) {
    return res.status(400).json({ error: '모든 항목을 입력해주세요.' });
  }
  
  try {
    const result = await query(`
      INSERT INTO plans (plan_code, plan_name, max_customers, monthly_price)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [planCode, planName, maxCustomers, monthlyPrice]);
    
    res.json({ 
      message: '요금제가 등록되었습니다.',
      plan: result.rows[0]
    });
  } catch (error: any) {
    if (error.code === '23505') {
      return res.status(400).json({ error: '이미 존재하는 요금제 코드입니다.' });
    }
    console.error('요금제 등록 실패:', error);
    res.status(500).json({ error: '요금제 등록 실패' });
  }
});

// 요금제 수정
router.put('/plans/:id', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { planName, maxCustomers, monthlyPrice, isActive, aiCreditsPerMonth } = req.body;
  
  try {
    const result = await query(`
      UPDATE plans 
      SET plan_name = COALESCE($1, plan_name),
          max_customers = COALESCE($2, max_customers),
          monthly_price = COALESCE($3, monthly_price),
          is_active = COALESCE($4, is_active),
          ai_credits_per_month = COALESCE($6, ai_credits_per_month)
      WHERE id = $5
      RETURNING *
    `, [planName, maxCustomers, monthlyPrice, isActive, id, aiCreditsPerMonth]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '요금제를 찾을 수 없습니다.' });
    }
    
    res.json({ message: '수정되었습니다.', plan: result.rows[0] });
  } catch (error) {
    console.error('요금제 수정 실패:', error);
    res.status(500).json({ error: '요금제 수정 실패' });
  }
});

// 요금제 삭제
router.delete('/plans/:id', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  
  try {
    // 사용 중인 회사가 있는지 확인
    const checkResult = await query('SELECT COUNT(*) FROM companies WHERE plan_id = $1', [id]);
    if (parseInt(checkResult.rows[0].count) > 0) {
      return res.status(400).json({ error: '이 요금제를 사용 중인 회사가 있어 삭제할 수 없습니다.' });
    }
    
    const result = await query('DELETE FROM plans WHERE id = $1 RETURNING plan_name', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '요금제를 찾을 수 없습니다.' });
    }
    
    res.json({ message: '삭제되었습니다.' });
  } catch (error) {
    console.error('요금제 삭제 실패:', error);
    res.status(500).json({ error: '요금제 삭제 실패' });
  }
});

// ===== 플랜 변경 신청 관리 API =====

// 플랜 신청 목록 조회
router.get('/plan-requests', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const result = await query(`
      SELECT 
        pr.*,
        c.company_name, c.company_code,
        p_current.plan_name as current_plan_name,
        p_requested.plan_name as requested_plan_name,
        p_requested.monthly_price as requested_plan_price,
        u.name as user_name, u.login_id as user_login_id,
        admin.name as processed_by_name
      FROM plan_requests pr
      LEFT JOIN companies c ON pr.company_id = c.id
      LEFT JOIN plans p_current ON c.plan_id = p_current.id
      LEFT JOIN plans p_requested ON pr.requested_plan_id = p_requested.id
      LEFT JOIN users u ON pr.user_id = u.id
      LEFT JOIN users admin ON pr.processed_by = admin.id
      ORDER BY 
        CASE WHEN pr.status = 'pending' THEN 0 ELSE 1 END,
        pr.created_at DESC
    `);
    
    res.json({ requests: result.rows });
  } catch (error) {
    console.error('플랜 신청 조회 실패:', error);
    res.status(500).json({ error: '플랜 신청 조회 실패' });
  }
});

// 플랜 신청 승인
router.put('/plan-requests/:id/approve', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { adminNote } = req.body;
  const adminId = (req as any).user?.userId;
  
  try {
    // 신청 정보 조회
    const requestResult = await query(
      'SELECT company_id, requested_plan_id, status, message FROM plan_requests WHERE id = $1',
      [id]
    );
    
    if (requestResult.rows.length === 0) {
      return res.status(404).json({ error: '신청을 찾을 수 없습니다.' });
    }
    
    const request = requestResult.rows[0];
    
    if (request.status !== 'pending') {
      return res.status(400).json({ error: '이미 처리된 신청입니다.' });
    }
    
    // ★ 2026-06-08: 무료체험 신청([무료체험] 센티넬)이면 BASIC 1개월 체험 부여(grantBasicTrial), 그 외는 일반 플랜 변경.
    const isTrialReq = typeof request.message === 'string' && request.message.startsWith('[무료체험]');
    if (isTrialReq) {
      await grantBasicTrial(request.company_id);
    } else {
      // ★ CT-17: 요금제 승인 시 TRIAL plan이면 'trial' 유지, 그 외는 'paid'(정식 구독).
      //   (과거: 무조건 'active'로 덮어써서 ① 체험 상태 파괴 ② companies.status='active'와 네이밍 충돌)
      const approvedPlanRes = await query(`SELECT plan_code FROM plans WHERE id = $1`, [request.requested_plan_id]);
      const approvedIsTrial = approvedPlanRes.rows[0]?.plan_code === 'TRIAL';
      const approvedStatus = approvedIsTrial ? 'trial' : 'paid';
      await query(
        `UPDATE companies SET plan_id = $1, subscription_status = $2, updated_at = NOW() WHERE id = $3`,
        [request.requested_plan_id, approvedStatus, request.company_id]
      );
    }
    
    // 신청 상태 변경
    const result = await query(`
      UPDATE plan_requests 
      SET status = 'approved',
          admin_note = $1,
          processed_by = $2,
          processed_at = NOW()
      WHERE id = $3
      RETURNING *
    `, [adminNote || null, adminId, id]);
    
    res.json({ 
      message: '승인되었습니다. 회사 플랜이 변경되었습니다.',
      request: result.rows[0]
    });
  } catch (error) {
    console.error('플랜 신청 승인 실패:', error);
    res.status(500).json({ error: '플랜 신청 승인 실패' });
  }
});

// 플랜 신청 거절
router.put('/plan-requests/:id/reject', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { adminNote } = req.body;
  const adminId = (req as any).user?.userId;
  
  if (!adminNote || adminNote.trim() === '') {
    return res.status(400).json({ error: '거절 사유를 입력해주세요.' });
  }
  
  try {
    const checkResult = await query('SELECT status FROM plan_requests WHERE id = $1', [id]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: '신청을 찾을 수 없습니다.' });
    }
    
    if (checkResult.rows[0].status !== 'pending') {
      return res.status(400).json({ error: '이미 처리된 신청입니다.' });
    }
    
    const result = await query(`
      UPDATE plan_requests 
      SET status = 'rejected',
          admin_note = $1,
          processed_by = $2,
          processed_at = NOW()
      WHERE id = $3
      RETURNING *
    `, [adminNote.trim(), adminId, id]);
    
    res.json({ 
      message: '거절되었습니다.',
      request: result.rows[0]
    });
  } catch (error) {
    console.error('플랜 신청 거절 실패:', error);
    res.status(500).json({ error: '플랜 신청 거절 실패' });
  }
});
// ===== 발송 통계 API =====

// 전체 발송 통계 (요약 + 페이징된 일별/월별)
router.get('/stats/send', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const view = (req.query.view as string) || 'daily';
    let startDate = (req.query.startDate as string) || '';
    let endDate = (req.query.endDate as string) || '';

    // 월별 조회 시 날짜를 월 단위로 자동 확장
    if (view === 'monthly') {
      if (startDate) startDate = startDate.substring(0, 7) + '-01';
      if (endDate) {
        const d = new Date(endDate);
        d.setMonth(d.getMonth() + 1, 0);
        endDate = d.toISOString().split('T')[0];
      }
    }

    const companyId = (req.query.companyId as string) || '';
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;

    // ★ D104: 날짜 필터 컨트롤타워 사용
    const dr = buildDateRangeFilter(STAT_DATE_EXPR, startDate, endDate, 1);
    let dateWhere = dr.sql;
    const baseParams: any[] = [...dr.params];
    let paramIdx = dr.nextIndex;

    let companyWhere = '';
    if (companyId) {
      companyWhere = ` AND c.company_id = $${paramIdx}`;
      baseParams.push(companyId);
      paramIdx++;
    }

    // ★ D144: PG sent_count/success_count/fail_count 캐시 의존 제거.
    //   PG에서 캠페인 메타만 SELECT → MySQL 큐 + 카카오에서 직접 카운트 → JS에서 (period, company)별 그룹핑 + summary.
    //   응답 키(summary/rows) 형태는 그대로 유지하여 frontend 변경 0.
    const groupCol = view === 'monthly'
      ? `TO_CHAR(${STAT_DATE_EXPR} AT TIME ZONE 'Asia/Seoul', 'YYYY-MM')`
      : `TO_CHAR(${STAT_DATE_EXPR} AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')`;
    const groupAlias = view === 'monthly' ? 'month' : 'date';

    const metaResult = await query(`
      SELECT
        c.id, c.company_id, c.created_by, c.message_type,
        c.result_final, c.sent_count, c.success_count, c.fail_count,
        ${groupCol} as period,
        co.company_name,
        lg.group_name as line_group_name
      FROM campaigns c
      JOIN companies co ON c.company_id = co.id
      LEFT JOIN sms_line_groups lg ON co.line_group_id = lg.id
      WHERE ${STAT_DATE_EXPR} IS NOT NULL
        AND ${STAT_STARTED_GUARD}
        AND c.status NOT IN ('cancelled', 'draft') ${dateWhere} ${companyWhere}
    `, baseParams);

    const metaCampaigns = metaResult.rows;
    // ★ result_final 캐시 우선 — 완료 캠페인 MySQL skip, 진행 중만 실시간(라인그룹 합집합 포함).
    const resultCountMap = await getCampaignResultCounts(metaCampaigns);

    // (period, company_id)별 그룹핑 + 전체 summary 합산
    type Bucket = { period: string; company_id: any; company_name: any; line_group_name: any; runs: Set<string>; sent: number; success: number; fail: number; pending: number };
    const byKey = new Map<string, Bucket>();
    let totalSent = 0, totalSuccess = 0, totalFail = 0, totalPending = 0;

    for (const c of metaCampaigns) {
      const counts = resultCountMap.get(c.id) || { sent: 0, success: 0, fail: 0, pending: 0 };
      const sent = counts.sent;
      const success = counts.success;
      const fail = counts.fail;
      const pending = counts.pending;
      totalSent += sent; totalSuccess += success; totalFail += fail; totalPending += pending;

      const key = `${c.period}|${c.company_id}`;
      if (!byKey.has(key)) {
        byKey.set(key, {
          period: c.period, company_id: c.company_id,
          company_name: c.company_name, line_group_name: c.line_group_name,
          runs: new Set<string>(), sent: 0, success: 0, fail: 0, pending: 0,
        });
      }
      const b = byKey.get(key)!;
      b.runs.add(c.id);
      b.sent += sent; b.success += success; b.fail += fail; b.pending += pending;
    }

    const allRows = Array.from(byKey.values())
      .map((v) => ({
        [groupAlias]: v.period,
        company_id: v.company_id,
        company_name: v.company_name,
        line_group_name: v.line_group_name,
        runs: v.runs.size,
        sent: v.sent,
        success: v.success,
        fail: v.fail,
        pending: v.pending,
      }))
      .sort((a: any, b: any) => {
        const pa = a[groupAlias], pb = b[groupAlias];
        if (pa < pb) return 1;
        if (pa > pb) return -1;
        return String(a.company_name || '').localeCompare(String(b.company_name || ''));
      });

    const total = allRows.length;
    const pagedRows = allRows.slice(offset, offset + limit);
    const summaryResult = {
      rows: [{ total_sent: String(totalSent), total_success: String(totalSuccess), total_fail: String(totalFail), total_pending: String(totalPending) }],
    };
    const rowsResult = { rows: pagedRows };

    // ===== 테스트 발송 통계 (담당자 + 스팸필터) =====
    let testSummary = { total: 0, success: 0, fail: 0, pending: 0, sms: 0, lms: 0, cost: 0 };
    const targetCompanyId = companyId || null;
    if (targetCompanyId) {
      try {
        // 1) 담당자 테스트 (MySQL) — CT-04 컨트롤타워: 테스트 라인 테이블 동적 조회
        const testTables = await getTestSmsTables();
        let mysqlDateWhere = '';
        const mysqlParams: any[] = [targetCompanyId];
        if (startDate) { mysqlDateWhere += ` AND msg_instm >= ?`; mysqlParams.push(startDate); }
        if (endDate) { mysqlDateWhere += ` AND msg_instm < DATE_ADD(?, INTERVAL 1 DAY)`; mysqlParams.push(endDate); }

        const testAgg = await smsAggAll(
          testTables,
          `COUNT(*) as total,
           SUM(CASE WHEN status_code IN (${SUCCESS_CODES_SQL}) THEN 1 ELSE 0 END) as success,
           SUM(CASE WHEN status_code NOT IN (${SUCCESS_CODES_SQL},${PENDING_CODES_SQL}) THEN 1 ELSE 0 END) as fail,
           SUM(CASE WHEN status_code IN (${PENDING_CODES_SQL}) THEN 1 ELSE 0 END) as pending,
           SUM(CASE WHEN msg_type = 'S' THEN 1 ELSE 0 END) as sms,
           SUM(CASE WHEN msg_type = 'L' THEN 1 ELSE 0 END) as lms`,
          `app_etc1 = 'test' AND app_etc2 = ? ${mysqlDateWhere}`,
          mysqlParams
        );
        testSummary.total += Number(testAgg.total) || 0;
        testSummary.success += Number(testAgg.success) || 0;
        testSummary.fail += Number(testAgg.fail) || 0;
        testSummary.pending += Number(testAgg.pending) || 0;
        testSummary.sms += Number(testAgg.sms) || 0;
        testSummary.lms += Number(testAgg.lms) || 0;

        // 2) 스팸필터 테스트 (PostgreSQL)
        const sfDr = buildDateRangeFilter('t.created_at', startDate, endDate, 2);
        const sfDateWhere = sfDr.sql;
        const sfParams: any[] = [targetCompanyId, ...sfDr.params];
        const sfIdx = sfDr.nextIndex;

        const sfAgg = await query(`
          SELECT COUNT(*) as total,
            SUM(CASE WHEN r.message_type = 'SMS' THEN 1 ELSE 0 END) as sms,
            SUM(CASE WHEN r.message_type = 'LMS' THEN 1 ELSE 0 END) as lms,
            SUM(CASE WHEN r.result IS NOT NULL THEN 1 ELSE 0 END) as completed,
            SUM(CASE WHEN r.result IS NULL AND t.status IN ('active','pending') THEN 1 ELSE 0 END) as pending
          FROM spam_filter_test_results r
          JOIN spam_filter_tests t ON r.test_id = t.id
          WHERE t.company_id = $1 ${sfDateWhere}
        `, sfParams);
        const sf = sfAgg.rows[0];
        testSummary.total += Number(sf.total) || 0;
        testSummary.success += Number(sf.completed) || 0;
        testSummary.pending += Number(sf.pending) || 0;
        testSummary.sms += Number(sf.sms) || 0;
        testSummary.lms += Number(sf.lms) || 0;

        // 비용 계산
        const costRes = await query('SELECT cost_per_sms, cost_per_lms FROM companies WHERE id = $1', [targetCompanyId]);
        const cSms = Number(costRes.rows[0]?.cost_per_sms) || DEFAULT_COSTS.sms;
        const cLms = Number(costRes.rows[0]?.cost_per_lms) || DEFAULT_COSTS.lms;
        testSummary.cost = Math.round((testSummary.sms * cSms + testSummary.lms * cLms) * 10) / 10;
      } catch (err) {
        console.error('테스트 통계 조회 실패:', err);
      }
    }

    res.json({
      summary: summaryResult.rows[0],
      testSummary,
      rows: rowsResult.rows,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('발송 통계 조회 실패:', error);
    res.status(500).json({ error: '발송 통계 조회 실패' });
  }
});

// 발송 통계 상세 (사용자별 분해)
router.get('/stats/send/detail', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const view = (req.query.view as string) || 'daily';
    const dateVal = (req.query.date as string) || '';
    const companyId = (req.query.companyId as string) || '';

    if (!dateVal || !companyId) {
      return res.status(400).json({ error: '날짜와 고객사 ID가 필요합니다.' });
    }

    const groupCol = view === 'monthly'
      ? `TO_CHAR(${STAT_DATE_EXPR} AT TIME ZONE 'Asia/Seoul', 'YYYY-MM')`
      : `TO_CHAR(${STAT_DATE_EXPR} AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')`;

    // ★ D144: PG sent_count/success_count/fail_count 캐시 의존 제거.
    //   PG에서 캠페인+사용자+opt080 메타만 SELECT → MySQL 큐 + 카카오 직접 카운트 → JS 집계.
    //   응답 키(userStats/campaigns) 형태는 그대로 유지하여 frontend 변경 0.
    const metaResult = await query(`
      SELECT
        c.id, c.company_id, c.created_by, c.campaign_name, c.send_type, c.message_content,
        c.message_type, c.is_ad, c.callback_number, c.target_count, c.created_at, c.sent_at,
        c.result_final, c.sent_count, c.success_count, c.fail_count,
        ${CAMPAIGN_OPT080_SELECT_EXPR},
        u.id as user_id, u.name as user_name, u.login_id, u.department, u.store_codes
      FROM campaigns c
      LEFT JOIN users u ON c.created_by = u.id
      ${CAMPAIGN_OPT080_LEFT_JOIN}
      WHERE ${STAT_DATE_EXPR} IS NOT NULL
        AND ${STAT_STARTED_GUARD}
        AND c.status NOT IN ('cancelled', 'draft')
        AND ${groupCol} = $1
        AND c.company_id = $2
      ORDER BY c.sent_at DESC
    `, [dateVal, companyId]);

    const detailMetaRows = metaResult.rows;
    // ★ result_final 캐시 우선(카운트, MySQL skip) + 첫 발송시각(실시간 유지)
    const detailResultMap = await getCampaignResultCounts(detailMetaRows);
    const detailSentTimeMap = await aggregateSmsSendTimesByCampaign(detailMetaRows);

    type DetailUserAgg = { user_id: any; user_name: any; login_id: any; department: any; store_codes: any; runs: Set<string>; sent: number; success: number; fail: number };
    const byUser = new Map<string, DetailUserAgg>();
    const campaignRows: any[] = [];

    for (const c of detailMetaRows) {
      const counts = detailResultMap.get(c.id) || { sent: 0, success: 0, fail: 0 };
      const sent = counts.sent;
      const success = counts.success;
      const fail = counts.fail;

      const uKey = c.user_id || 'null';
      if (!byUser.has(uKey)) {
        byUser.set(uKey, {
          user_id: c.user_id, user_name: c.user_name, login_id: c.login_id,
          department: c.department, store_codes: c.store_codes,
          runs: new Set<string>(), sent: 0, success: 0, fail: 0,
        });
      }
      const u = byUser.get(uKey)!;
      u.runs.add(c.id);
      u.sent += sent; u.success += success; u.fail += fail;

      campaignRows.push({
        campaign_id: c.id,
        campaign_name: c.campaign_name,
        send_type: c.send_type,
        message_content: c.message_content,
        message_type: c.message_type,
        is_ad: c.is_ad,
        callback_number: c.callback_number,
        opt_out_080_number: c.opt_out_080_number ?? null,
        user_name: c.user_name,
        login_id: c.login_id,
        run_id: c.id,
        run_number: 1,
        sent_count: sent,
        success_count: success,
        fail_count: fail,
        target_count: c.target_count,
        created_at: c.created_at,
        sent_at: detailSentTimeMap.get(c.id) ?? c.sent_at,
      });
    }

    const result = {
      rows: Array.from(byUser.values())
        .map((u) => ({
          user_id: u.user_id,
          user_name: u.user_name,
          login_id: u.login_id,
          department: u.department,
          store_codes: u.store_codes,
          runs: u.runs.size,
          sent: u.sent,
          success: u.success,
          fail: u.fail,
        }))
        .sort((a, b) => b.sent - a.sent),
    };
    const campaignsResult = { rows: campaignRows };

    // ===== 테스트 발송 상세 (담당자 + 스팸필터) =====
    let testDetail: any[] = [];
    try {
      // 1) 담당자 테스트 (MySQL) — CT-04 컨트롤타워
      const testTables2 = await getTestSmsTables();
      let mysqlDateWhere2 = '';
      const mysqlParams2: any[] = [companyId];
      if (view === 'monthly') {
        mysqlDateWhere2 = ` AND DATE_FORMAT(msg_instm, '%Y-%m') = ?`;
      } else {
        mysqlDateWhere2 = ` AND DATE_FORMAT(msg_instm, '%Y-%m-%d') = ?`;
      }
      mysqlParams2.push(dateVal);

      const testRows2All = await smsSelectAll(
        testTables2,
        `dest_no as phone, msg_type, status_code, msg_instm as sent_at, bill_id as sender_id`,
        `app_etc1 = 'test' AND app_etc2 = ? ${mysqlDateWhere2}`,
        mysqlParams2,
        `ORDER BY msg_instm DESC LIMIT 50`
      );
      testRows2All.sort((a: any, b: any) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime());
      const testRows2 = testRows2All.slice(0, 50);
      testDetail = (testRows2 as any[]).map(r => ({
        phone: r.phone,
        msgType: r.msg_type === 'S' ? 'SMS' : 'LMS',
        status: isSuccess(r.status_code) ? 'success' : isPending(r.status_code) ? 'pending' : 'fail',
        sentAt: r.sent_at,
        testType: 'manager',
      }));

      // 2) 스팸필터 테스트 (PostgreSQL)
      let sfDateCond = '';
      if (view === 'monthly') {
        sfDateCond = `AND TO_CHAR(t.created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') = $2`;
      } else {
        sfDateCond = `AND TO_CHAR(t.created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') = $2`;
      }
      const sfDetail = await query(`
        SELECT r.phone, r.carrier, r.message_type, r.result,
               t.created_at as sent_at
        FROM spam_filter_test_results r
        JOIN spam_filter_tests t ON r.test_id = t.id
        WHERE t.company_id = $1 ${sfDateCond}
        ORDER BY t.created_at DESC LIMIT 50
      `, [companyId, dateVal]);

      sfDetail.rows.forEach((r: any) => {
        testDetail.push({
          phone: r.phone,
          msgType: r.message_type || 'SMS',
          status: r.result ? 'success' : 'pending',
          result: r.result || 'pending',
          carrier: r.carrier,
          sentAt: r.sent_at,
          testType: 'spam_filter',
        });
      });
    } catch (err) {
      console.error('테스트 상세 조회 실패:', err);
    }

    res.json({
      userStats: result.rows,
      campaigns: campaignsResult.rows,
      testDetail,
    });
  } catch (error) {
    console.error('발송 통계 상세 조회 실패:', error);
    res.status(500).json({ error: '발송 통계 상세 조회 실패' });
  }
});

// ===== 전체 캠페인 관리 API =====

// 전체 캠페인 목록 (모든 회사 통합)
router.get('/campaigns/all', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = (req.query.search as string) || '';
    const status = (req.query.status as string) || '';
    const companyId = (req.query.companyId as string) || '';
    const startDate = (req.query.startDate as string) || '';
    const endDate = (req.query.endDate as string) || '';
    const offset = (page - 1) * limit;

    let where = 'WHERE 1=1';
    const params: any[] = [];
    let paramIdx = 1;

    if (search) {
      where += ` AND (c.campaign_name ILIKE $${paramIdx} OR co.company_name ILIKE $${paramIdx} OR u.login_id ILIKE $${paramIdx})`;
      params.push(`%${search}%`);
      paramIdx++;
    }
    if (status) {
      where += ` AND c.status = $${paramIdx}`;
      params.push(status);
      paramIdx++;
    }
    if (companyId) {
      where += ` AND c.company_id = $${paramIdx}`;
      params.push(companyId);
      paramIdx++;
    }
    // ★ 발송결과/발송통계와 동일하게 송출일 기준(scheduled 우선)으로 통일 — 예약발송 날짜 어긋남 정정
    const dateDr = buildDateRangeFilter(STAT_DATE_EXPR, startDate, endDate, paramIdx);
    where += dateDr.sql;
    params.push(...dateDr.params);
    paramIdx = dateDr.nextIndex;

    const countResult = await query(
      `SELECT COUNT(*) FROM campaigns c LEFT JOIN companies co ON c.company_id = co.id LEFT JOIN users u ON c.created_by = u.id ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    // ★ D144: PG campaign_runs sent_count/success_count/fail_count subquery 제거.
    //   PG는 캠페인+회사+사용자 메타만 SELECT → MySQL 큐 + 카카오 직접 카운트 → JS 매핑.
    //   target_count/sent_at은 last_run 메타라 그대로 subquery 유지 (캐시 아님).
    const result = await query(`
      SELECT
        c.id, c.campaign_name as name, c.status, c.send_type as campaign_type, c.created_at,
        c.company_id, c.created_by, c.message_type, c.send_channel, c.scheduled_at, c.sent_at,
        c.result_final, c.sent_count, c.success_count, c.fail_count,
        co.company_name, co.company_code,
        u.name as created_by_name, u.login_id as created_by_login,
        (SELECT cr.target_count FROM campaign_runs cr WHERE cr.campaign_id = c.id ORDER BY cr.run_number DESC LIMIT 1) as last_target_count,
        (SELECT cr.sent_at FROM campaign_runs cr WHERE cr.campaign_id = c.id ORDER BY cr.run_number DESC LIMIT 1) as last_sent_at
      FROM campaigns c
      LEFT JOIN companies co ON c.company_id = co.id
      LEFT JOIN users u ON c.created_by = u.id
      ${where}
      ORDER BY c.created_at DESC
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
    `, [...params, limit, offset]);

    // ★ 2026-06-17: 카운트 단일 진입점(getCampaignResultCounts) — 전송·성공·실패·대기를 전 표면 공통 산식으로.
    //   완료는 PG 캐시(대기 0), 진행 중만 MySQL 실측. result_final 캠페인 reconcile 누락(디버깅1 대기 666·디버깅2 전송 1613) 종결.
    const adminResultMap = await getCampaignResultCounts(result.rows);
    const adminNonFinal = result.rows.filter((c: any) => !c.result_final);
    const adminCampSentTimeMap = await aggregateSmsSendTimesByCampaign(adminNonFinal);

    // ★ D144 P4/P7 후속 (2026-05-07): status='sending' 자동 정리 — 결과 모두 도착(대기 0 + 성공/실패 > 0)이면 completed.
    const autoCompleteIds: string[] = [];
    const campaigns = result.rows.map((c: any) => {
      const cnt = adminResultMap.get(c.id) || { sent: 0, success: 0, fail: 0, pending: 0 };
      let effectiveStatus = c.status;
      if (c.status === 'sending' && cnt.pending === 0 && (cnt.success > 0 || cnt.fail > 0)) {
        effectiveStatus = 'completed';
        autoCompleteIds.push(c.id);
      }
      return {
        ...c,
        status: effectiveStatus,
        total_sent: cnt.sent,
        total_success: cnt.success,
        total_fail: cnt.fail,
        total_pending: cnt.pending,
        sent_at: c.result_final ? c.sent_at : (adminCampSentTimeMap.get(c.id) ?? c.sent_at),
      };
    });

    // 백그라운드 fire-and-forget으로 PG status UPDATE (응답 지연 없음)
    if (autoCompleteIds.length > 0) {
      query(
        `UPDATE campaigns SET status = 'completed', updated_at = NOW()
         WHERE id = ANY($1::uuid[]) AND status = 'sending'`,
        [autoCompleteIds]
      ).catch((e) => console.warn('[admin][campaigns] sending→completed 자동 정리 실패:', e?.message));
    }

    res.json({
      campaigns,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error: any) {
    // ★ D228+ db_alter_safety_net: result_final 등 신규 컬럼 미마이그레이션 시 500 대신 503 안내.
    const msg = error?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({
        error: 'DB 마이그레이션 필요 — 운영자에게 campaigns ALTER(result_final/result_synced_at) 실행 요청 의무',
        code: 'DB_MIGRATION_PENDING',
      });
    }
    console.error('전체 캠페인 조회 실패:', error);
    res.status(500).json({ error: '전체 캠페인 조회 실패' });
  }
});
// ===== SMS/카카오 발송 상세 조회 (MySQL) =====
router.get('/campaigns/:id/sms-detail', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;
    const statusFilter = (req.query.status as string) || '';   // success / fail / pending / ''
    const searchType = (req.query.searchType as string) || ''; // dest_no / call_back
    const searchValue = (req.query.searchValue as string) || '';
    const channelFilter = (req.query.channel as string) || ''; // sms / kakao / '' (all)

    // 캠페인 기본 정보 (PostgreSQL)
    // ★ D144: PG c.success_count/fail_count 캐시 의존 제거 → 헤더 카운트는 MySQL 직접 집계로 대체
    const campResult = await query(`
      SELECT c.id, c.company_id, c.created_by, c.created_at,
             c.campaign_name, c.message_type, c.send_type, c.status, c.scheduled_at, c.sent_at, c.target_count,
             c.send_channel, c.send_config,
             c.result_final, c.sent_count, c.success_count, c.fail_count,
             co.company_name, co.company_code,
             u.name as created_by_name, u.login_id as created_by_login
      FROM campaigns c
      LEFT JOIN companies co ON c.company_id = co.id
      LEFT JOIN users u ON c.created_by = u.id
      WHERE c.id = $1
    `, [id]);
    if (campResult.rows.length === 0) {
      return res.status(404).json({ error: '캠페인을 찾을 수 없습니다.' });
    }
    const campaign = campResult.rows[0];
    if (campaign.status === 'scheduled') {
      // ★ 2026-06-13 속도: 예약 캠페인은 결과가 아직 없다 — MySQL 헤더 집계·발송시각 보정 스캔 자체가 불필요.
      //   전송건수 = PG 적재 실측(sent_count, 0611부터 워커 기록), 성공/실패 0, 발송시각 = 예약시각.
      //   예약 8만건 [조회] 10초+의 스캔 4회 중 2회를 여기서 제거 (직원 신고 — 에이스하드웨어 47,846건 실측).
      campaign.success_count = 0;
      campaign.fail_count = 0;
      campaign.sent_count = Number(campaign.sent_count || 0) || Number(campaign.target_count || 0);
    } else {
      // ★ D228+ (2026-05-30) 속도: 완료(result_final) 캠페인은 PG 캐시, 진행 중만 MySQL 집계.
      //   sms-detail 헤더가 대형 캠페인 1건이라도 무조건 GROUP BY를 돌던 병목 제거 (상세조회 지연 원인).
      const headerCounts = await getCampaignResultCounts([campaign]);
      const hc = headerCounts.get(campaign.id) || { sent: 0, success: 0, fail: 0 };
      campaign.success_count = hc.success;
      campaign.fail_count = hc.fail;
      campaign.sent_count = hc.sent;
      // 발송시각: 완료는 PG sent_at 그대로, 진행 중만 MySQL MIN(sendreq_time) 보정.
      if (!campaign.result_final) {
        const headerSentTimeMap = await aggregateSmsSendTimesByCampaign([campaign]);
        const hSentTime = headerSentTimeMap.get(campaign.id);
        if (hSentTime) campaign.sent_at = hSentTime;
      }
    }
    const sendChannel = campaign.send_channel || 'sms';
    const showSms = (!channelFilter || channelFilter === 'sms') && (sendChannel === 'sms' || sendChannel === 'both');
    const showKakao = (!channelFilter || channelFilter === 'kakao') && (sendChannel === 'kakao' || sendChannel === 'both');

    let allDetail: any[] = [];
    let totalSms = 0;
    let totalKakao = 0;

    // ===== SMS 내역 조회 =====
    if (showSms) {
      // CT-04: 캠페인 단일 조회 최적화 —
      // 해당 회사 라인그룹 LIVE 테이블(1~2개) + 발송월 LOG 테이블(1개)만 조회
      // 고객사/테이블 수 증가와 무관하게 O(2~3) 유지
      const refDate = new Date(campaign.sent_at || campaign.scheduled_at || campaign.created_at);
      // ★ 2026-06-13 속도: send_config.sentTables(실제 적재 테이블 기록)가 있으면 그 테이블만 조회
      const smsTables = await getCampaignSmsTables(campaign.company_id, refDate, campaign.created_by, campaign.send_config);

      let mysqlWhere = `app_etc1 = ?`;
      const mysqlParams: any[] = [id];

      if (statusFilter === 'success') {
        mysqlWhere += ` AND status_code IN (${SUCCESS_CODES_SQL})`;
      } else if (statusFilter === 'fail') {
        mysqlWhere += ` AND status_code NOT IN (${SUCCESS_CODES_SQL},${PENDING_CODES_SQL})`;
      } else if (statusFilter === 'pending') {
        mysqlWhere += ` AND status_code IN (${PENDING_CODES_SQL})`;
      }

      if (searchValue && searchType === 'dest_no') {
        mysqlWhere += ` AND dest_no LIKE ?`;
        mysqlParams.push(`%${searchValue.replace(/-/g, '')}%`);
      } else if (searchValue && searchType === 'call_back') {
        mysqlWhere += ` AND call_back LIKE ?`;
        mysqlParams.push(`%${searchValue.replace(/-/g, '')}%`);
      }

      // ★ 2026-06-13 속도: 예약 + 필터/검색 없음 = PG 적재 실측으로 총건수 대체 (COUNT 전체 스캔 제거).
      //   필터·검색이 있으면 정확한 COUNT가 필요하므로 기존 경로 유지.
      if (campaign.status === 'scheduled' && !statusFilter && !searchValue) {
        totalSms = Number(campaign.sent_count || 0);
      } else {
        totalSms = await smsCountAll(smsTables, mysqlWhere, mysqlParams);
      }

      // ★ D124: 수신확인(repmsg_recvtm) 전경로 제거 — 등록/발송 2컬럼 통일
      //   sendreq_time: 우리 앱 NOW() → KST (DATE_ADD 불필요)
      //   mobsend_time: QTmsg Agent → UTC → DATE_ADD(+9h) 필요
      // ★ D228+ (2026-05-30) 속도: 페이지네이션을 SQL outer로 내림 (기존 전량 SELECT + JS sort/slice 안티패턴).
      //   2.3만건 캠페인이 msg_contents(LMS 본문)까지 전부 Node로 전송돼 50건 표시에 10초 → SQL이 50건만 반환.
      //   카카오 분기(아래) + campaigns.ts 수신자 조회와 동일 패턴. seqno DESC + dest_no tie-breaker(D150-4 — UNION seqno 중복 시 결정적 페이지네이션).
      //   limit/offset은 상단 parseInt 정수라 SQL 리터럴 안전.
      // ★ 2026-06-13 속도: smsSelectPagedAll — 테이블별 top-(offset+limit) 선잘라내기 후 병합.
      //   기존 smsSelectAll(외부 ORDER/LIMIT)은 일치 행 전체(8만 행 + LMS 본문)를 임시 테이블로
      //   실체화한 뒤 정렬해 페이지당 수 초가 걸렸다 (에이치피오 87,049 예약 상세 10초+ 잔여 병목).
      const rows = await smsSelectPagedAll(
        smsTables,
        `seqno, dest_no, call_back, msg_contents, msg_type, status_code, mob_company,
         sendreq_time, k_oriseq,
         DATE_ADD(mobsend_time, INTERVAL 9 HOUR) AS mobsend_time,
         (sendreq_time > NOW()) AS is_future`,
        mysqlWhere,
        mysqlParams,
        `seqno DESC, dest_no ASC`,
        Number(limit),
        Number(offset)
      );

      (rows as any[]).forEach(r => {
        // ★ 2026-06-13: 발송 요청 시각이 미래인 대기 행 = "발송 예약" (결과 대기와 구분 — Harold 지시)
        const rowStatus = getQueueRowStatus(Number(r.status_code), !!Number(r.is_future));
        allDetail.push({
          seqno: r.seqno,
          destNo: r.dest_no,
          callBack: r.call_back,
          msgContents: r.msg_contents,
          msgType: r.msg_type === 'S' ? 'SMS' : r.msg_type === 'L' ? 'LMS' : r.msg_type === 'M' ? 'MMS' : r.msg_type,
          sendType: getSendTypeLabel(r.msg_type, r.k_oriseq),
          statusCode: r.status_code,
          statusText: rowStatus.label,
          statusType: rowStatus.type,
          carrier: rowStatus.type === 'scheduled' ? '-' : getCarrierLabel(r.mob_company),
          sendreqTime: r.sendreq_time,
          mobsendTime: r.mobsend_time,
          channel: 'sms',
        });
      });
    }

    // ===== 카카오 내역 조회 =====
    if (showKakao) {
      // CT-04: 카카오 조회도 컨트롤타워 사용 (IMC_BM_FREE_BIZ_MSG 단일 테이블)
      let kakaoWhere = `REQUEST_UID = ?`;
      const kakaoParams: any[] = [id];

      if (statusFilter === 'success') {
        kakaoWhere += ` AND REPORT_CODE = '0000'`;
      } else if (statusFilter === 'fail') {
        kakaoWhere += ` AND REPORT_CODE != '0000' AND STATUS IN ('3','4')`;
      } else if (statusFilter === 'pending') {
        kakaoWhere += ` AND STATUS IN ('1','2')`;
      }

      if (searchValue && searchType === 'dest_no') {
        kakaoWhere += ` AND PHONE_NUMBER LIKE ?`;
        kakaoParams.push(`%${searchValue.replace(/-/g, '')}%`);
      }

      totalKakao = await kakaoCountWhere(kakaoWhere, kakaoParams);

      const kakaoRows = await kakaoSelectWhere(
        `ID, PHONE_NUMBER, MESSAGE, CHAT_BUBBLE_TYPE, STATUS, REPORT_CODE, REPORT_DATE,
         REQUEST_DATE, RESPONSE_DATE, RESEND_MT_TYPE, RESEND_REPORT_CODE`,
        kakaoWhere,
        kakaoParams,
        `ORDER BY ID DESC LIMIT ${Number(limit)} OFFSET ${Number(offset)}`
      );

      const kakaoStatusMap: Record<string, string> = {
        '0000': '카카오성공', '': '대기',
      };

      (kakaoRows as any[]).forEach(r => {
        allDetail.push({
          seqno: r.ID,
          destNo: r.PHONE_NUMBER,
          callBack: '-',
          msgContents: r.MESSAGE,
          msgType: `카카오(${r.CHAT_BUBBLE_TYPE || 'TEXT'})`,
          sendType: '카카오',
          statusCode: r.REPORT_CODE === '0000' ? 1800 : (r.STATUS <= '2' ? 100 : 9999),
          statusText: kakaoStatusMap[r.REPORT_CODE] || `카카오:${r.REPORT_CODE || '처리중'}`,
          statusType: r.REPORT_CODE === '0000' ? 'success' : (r.STATUS <= '2' ? 'pending' : 'fail'),
          carrier: '카카오',
          sendreqTime: r.REQUEST_DATE,
          mobsendTime: r.RESPONSE_DATE,
          recvTime: r.REPORT_DATE,
          channel: 'kakao',
          kakaoReportCode: r.REPORT_CODE,
          resendType: r.RESEND_MT_TYPE,
          resendReportCode: r.RESEND_REPORT_CODE,
        });
      });
    }

    const total = totalSms + totalKakao;

    res.json({ campaign, detail: allDetail, total, totalSms, totalKakao, page, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('SMS 상세 조회 실패:', error);
    res.status(500).json({ error: 'SMS 상세 조회 실패' });
  }
});

// ★ 2026-06-15: 슈퍼관리자 캠페인 상세 발송내역 CSV 다운로드 (사용자 export와 동일 CT 공유 — campaign-sms-export.ts).
//   사용자 export는 본인 회사 한정이라, 슈퍼관리자(타 회사 캠페인)용 별도 endpoint. 컬럼·발송일시 기준 100% 동일.
router.get('/campaigns/:id/sms-detail/export', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const camp = await query(
      `SELECT company_id, created_by, send_channel, created_at FROM campaigns WHERE id = $1`,
      [id],
    );
    if (camp.rows.length === 0) return res.status(404).json({ error: '캠페인을 찾을 수 없습니다.' });
    const c = camp.rows[0];
    await streamCampaignSmsCsv(res, {
      campaignId: id,
      companyId: c.company_id,
      userId: c.created_by,           // 라인그룹 해석 — 캠페인 작성자 기준 (회사 전 라인 합집합으로 내성)
      sendChannel: c.send_channel || 'sms',
      campaignCreatedAt: c.created_at,
      exportStatus: (req.query.status as string) || '',   // 화면 필터(전체/성공/실패) 그대로
    });
  } catch (error) {
    console.error('[admin sms-detail export] 실패:', error);
    if (!res.headersSent) res.status(500).json({ error: 'SMS 상세 다운로드 실패' });
  }
});
// ===== 표준 필드 관리 API =====

// 표준 필드 목록 조회
router.get('/standard-fields', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const result = await query(
      'SELECT id, field_key, display_name, category, data_type, description, sort_order FROM standard_fields WHERE is_active = true ORDER BY sort_order'
    );
    res.json({ fields: result.rows });
  } catch (error) {
    console.error('표준 필드 조회 실패:', error);
    res.status(500).json({ error: '표준 필드 조회 실패' });
  }
});

// 회사별 활성 필드 조회
router.get('/companies/:id/fields', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await query('SELECT enabled_fields FROM companies WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '회사를 찾을 수 없습니다.' });
    }
    res.json({ enabledFields: result.rows[0].enabled_fields || [] });
  } catch (error) {
    console.error('회사 필드 조회 실패:', error);
    res.status(500).json({ error: '회사 필드 조회 실패' });
  }
});
// 회사별 필드 데이터 유무 체크
router.get('/companies/:id/field-data-check', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  
  try {
    // field_key → 실제 DB 컬럼 매핑
    const FIELD_COLUMN_MAP: Record<string, string> = {
      name: 'name', phone: 'phone', gender: 'gender',
      birth_date: 'birth_date', age_group: 'age', region: 'region',
      address: 'address', email: 'email', grade: 'grade',
      total_purchase_amount: 'total_purchase_amount',
      purchase_count: 'purchase_count',
      last_purchase_date: 'recent_purchase_date',
      points: 'points', store_code: 'store_code', store_name: 'store_name',
      opt_in_sms: 'sms_opt_in',
    };

    // 활성 필드 목록
    const fieldsResult = await query('SELECT field_key FROM standard_fields WHERE is_active = true');
    const fieldKeys: string[] = fieldsResult.rows.map((r: any) => r.field_key);

    // 한 번의 쿼리로 모든 필드 데이터 유무 체크
    const selectParts = fieldKeys.map(key => {
      const col = FIELD_COLUMN_MAP[key];
      if (col) {
        return `COUNT(CASE WHEN ${col} IS NOT NULL AND ${col}::text != '' THEN 1 END) as "${key}"`;
      } else {
        return `COUNT(CASE WHEN custom_fields->>'${key}' IS NOT NULL AND custom_fields->>'${key}' != '' THEN 1 END) as "${key}"`;
      }
    });

    const sql = `SELECT ${selectParts.join(', ')} FROM customers_unified WHERE company_id = $1`;
    const result = await query(sql, [id]);

    const dataCheck: Record<string, { hasData: boolean; count: number }> = {};
    for (const key of fieldKeys) {
      const count = parseInt(result.rows[0]?.[key]) || 0;
      dataCheck[key] = { hasData: count > 0, count };
    }

    res.json({ dataCheck });
  } catch (error) {
    console.error('필드 데이터 체크 실패:', error);
    res.status(500).json({ error: '필드 데이터 체크 실패' });
  }
});
// 회사별 활성 필드 저장
router.put('/companies/:id/fields', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { enabledFields } = req.body;
  
  try {
    const result = await query(
      'UPDATE companies SET enabled_fields = $1, updated_at = NOW() WHERE id = $2 RETURNING id',
      [JSON.stringify(enabledFields || []), id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '회사를 찾을 수 없습니다.' });
    }
    res.json({ message: '필터항목이 저장되었습니다.', enabledFields });
  } catch (error) {
    console.error('필터항목 저장 실패:', error);
    res.status(500).json({ error: '필터항목 저장 실패' });
  }
});

// ===== 정산서 이메일 발송 =====
router.post('/billing/:id/send-email', authenticate, requireSuperAdmin, async (req: any, res) => {
  try {
    const { id } = req.params;
    const { to, subject, body_html } = req.body;
    const adminId = req.user?.id || req.adminUser?.id;

    if (!to || !subject) {
      return res.status(400).json({ error: '수신자 이메일과 제목은 필수입니다' });
    }

    // 1) billing 조회 + 상태 체크
    const billingResult = await query(
      'SELECT * FROM billings WHERE id = $1', [id]
    );
    if (billingResult.rows.length === 0) {
      return res.status(404).json({ error: '정산 데이터를 찾을 수 없습니다' });
    }
    const billing = billingResult.rows[0];
    if (billing.status === 'draft') {
      return res.status(400).json({ error: '초안 상태에서는 발송할 수 없습니다. 확정 후 발송해주세요.' });
    }

    // 2) PDF 생성 (기존 PDF 생성 로직 재활용)
    //    ※ 기존 billing PDF 생성 함수를 여기서 호출하여 Buffer로 받기
    //    예: const pdfBuffer = await generateBillingPdf(id);
    //    현재는 stub이므로 PDF 생성까지만 확인

    // 3) 이메일 발송 (현재 stub)
    const { sendBillingEmail } = require('../services/emailService');
    const emailResult = await sendBillingEmail({
      to,
      subject,
      bodyHtml: body_html,
      pdfBuffer: null, // TODO: 실제 PDF buffer 연결
      pdfFilename: `정산서_${billing.company_name || 'billing'}_${billing.billing_year}_${billing.billing_month}.pdf`,
    });

    // 4) 발송 이력 기록
    if (emailResult.success) {
      await query(
        'UPDATE billings SET emailed_at = NOW(), emailed_to = $1, emailed_by = $2 WHERE id = $3',
        [to, adminId, id]
      );
    }

    res.json({
      success: emailResult.success,
      message: emailResult.message,
      emailed_at: new Date().toISOString(),
      emailed_to: to,
    });
  } catch (error: any) {
    console.error('정산서 이메일 발송 오류:', error);
    res.status(500).json({ error: error.message || '이메일 발송 실패' });
  }
});

// ===== 선불 잔액 관리 API =====

// billing_type 변경 (후불 ↔ 선불)
router.patch('/companies/:id/billing-type', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { billingType } = req.body;

  if (!billingType || !['prepaid', 'postpaid'].includes(billingType)) {
    return res.status(400).json({ error: '올바른 요금제 유형을 선택해주세요. (prepaid 또는 postpaid)' });
  }

  try {
    // 진행 중인 캠페인 확인
    const activeCampaigns = await query(
      "SELECT COUNT(*) FROM campaigns WHERE company_id = $1 AND status IN ('scheduled', 'sending')",
      [id]
    );
    if (parseInt(activeCampaigns.rows[0].count) > 0) {
      return res.status(400).json({ error: '진행 중이거나 예약된 캠페인이 있어 요금제 유형을 변경할 수 없습니다.' });
    }

    const result = await query(
      'UPDATE companies SET billing_type = $1, updated_at = NOW() WHERE id = $2 RETURNING id, company_name, billing_type, balance',
      [billingType, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: '회사를 찾을 수 없습니다.' });
    }

    const c = result.rows[0];
    console.log(`[요금제변경] ${c.company_name} → ${billingType} (잔액: ${c.balance}원)`);

    res.json({
      message: `요금제 유형이 ${billingType === 'prepaid' ? '선불' : '후불'}로 변경되었습니다.`,
      company: { id: c.id, companyName: c.company_name, billingType: c.billing_type, balance: Number(c.balance) }
    });
  } catch (error) {
    console.error('요금제 유형 변경 실패:', error);
    res.status(500).json({ error: '요금제 유형 변경 실패' });
  }
});

// 수동 잔액 조정 (충전 또는 차감)
router.post('/companies/:id/balance-adjust', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { type, amount, reason } = req.body;
  const adminId = (req as any).user?.userId;

  if (!type || !['charge', 'deduct'].includes(type)) {
    return res.status(400).json({ error: '올바른 유형을 선택해주세요. (charge 또는 deduct)' });
  }
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: '금액은 0보다 커야 합니다.' });
  }
  if (!reason || reason.trim() === '') {
    return res.status(400).json({ error: '사유를 입력해주세요.' });
  }

  try {
    const txType = type === 'charge' ? 'admin_charge' : 'admin_deduct';

    if (type === 'deduct') {
      // 차감: 잔액 부족 체크 (atomic)
      const result = await query(
        'UPDATE companies SET balance = balance - $1, updated_at = NOW() WHERE id = $2 AND balance >= $1 RETURNING balance, company_name',
        [amount, id]
      );
      if (result.rows.length === 0) {
        const co = await query('SELECT balance, company_name FROM companies WHERE id = $1', [id]);
        if (co.rows.length === 0) return res.status(404).json({ error: '회사를 찾을 수 없습니다.' });
        return res.status(400).json({ error: `잔액이 부족합니다. 현재 잔액: ${Number(co.rows[0].balance).toLocaleString()}원` });
      }

      await query(
        `INSERT INTO balance_transactions (company_id, type, amount, balance_before, balance_after, description, admin_id, payment_method)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'admin')`,
        [id, txType, amount, Number(result.rows[0].balance) + amount, result.rows[0].balance, reason.trim(), adminId]
      );

      console.log(`[관리자차감] ${result.rows[0].company_name}: -${amount}원 → 잔액 ${result.rows[0].balance}원 (사유: ${reason})`);
      res.json({
        message: `${amount.toLocaleString()}원이 차감되었습니다.`,
        balance: Number(result.rows[0].balance),
        transactionType: txType
      });
    } else {
      // 충전
      const result = await query(
        'UPDATE companies SET balance = balance + $1, updated_at = NOW() WHERE id = $2 RETURNING balance, company_name',
        [amount, id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: '회사를 찾을 수 없습니다.' });
      }

      await query(
        `INSERT INTO balance_transactions (company_id, type, amount, balance_before, balance_after, description, admin_id, payment_method)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'admin')`,
        [id, txType, amount, Number(result.rows[0].balance) - amount, result.rows[0].balance, reason.trim(), adminId]
      );

      console.log(`[관리자충전] ${result.rows[0].company_name}: +${amount}원 → 잔액 ${result.rows[0].balance}원 (사유: ${reason})`);
      res.json({
        message: `${amount.toLocaleString()}원이 충전되었습니다.`,
        balance: Number(result.rows[0].balance),
        transactionType: txType
      });
    }
  } catch (error) {
    console.error('잔액 조정 실패:', error);
    res.status(500).json({ error: '잔액 조정 실패' });
  }
});

// 회사별 잔액 이력 조회 (슈퍼관리자용)
router.get('/companies/:id/balance-transactions', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const offset = (page - 1) * limit;

  try {
    // 회사 잔액 정보
    const companyResult = await query(
      'SELECT company_name, billing_type, balance FROM companies WHERE id = $1',
      [id]
    );
    if (companyResult.rows.length === 0) {
      return res.status(404).json({ error: '회사를 찾을 수 없습니다.' });
    }

    // 총 건수
    const countResult = await query(
      'SELECT COUNT(*) FROM balance_transactions WHERE company_id = $1',
      [id]
    );
    const total = parseInt(countResult.rows[0].count);

    // 이력 조회
    const result = await query(
      `SELECT bt.id, bt.type, bt.amount, bt.balance_after, bt.description, bt.reference_type, bt.reference_id, bt.admin_id, bt.created_at,
              sa.name as admin_name
       FROM balance_transactions bt
       LEFT JOIN super_admins sa ON bt.admin_id = sa.id
       WHERE bt.company_id = $1
       ORDER BY bt.created_at DESC
       LIMIT $2 OFFSET $3`,
      [id, limit, offset]
    );

    const c = companyResult.rows[0];
    res.json({
      company: { companyName: c.company_name, billingType: c.billing_type, balance: Number(c.balance) },
      transactions: result.rows,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error('잔액 이력 조회 실패:', error);
    res.status(500).json({ error: '잔액 이력 조회 실패' });
  }
});

// ===== AI 크레딧 관리 API (종량제 Phase 4) =====

// 회사별 크레딧 현황 (잔여 + 이번달 사용량 + 최근 이력 5)
router.get('/companies/:id/credit', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const { getCreditState, getMonthlyUsage, getCreditTransactions } = await import('../utils/ai-credit');
    const [state, used, history] = await Promise.all([
      getCreditState(id),
      getMonthlyUsage(id),
      getCreditTransactions(id, 1, 5),
    ]);
    res.json({ ...state, monthlyUsed: used, recent: history.rows });
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({ error: 'DB 마이그레이션 필요 — ai_credit_transactions.reason 컬럼 ALTER 실행 요청', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('크레딧 현황 조회 실패:', err);
    res.status(500).json({ error: '크레딧 현황 조회 실패' });
  }
});

// 수동 크레딧 지급/조정 (grant | admin_deduct)
router.post('/companies/:id/credit-adjust', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { type, amount, reason, idempotencyKey } = req.body;
  const adminId = (req as any).user?.userId;
  if (!type || !['grant', 'admin_deduct'].includes(type)) {
    return res.status(400).json({ error: '올바른 유형을 선택해주세요. (grant 또는 admin_deduct)' });
  }
  const amt = Number(amount);
  if (!amt || amt <= 0) return res.status(400).json({ error: '크레딧은 1 이상이어야 합니다.' });
  if (!reason || String(reason).trim() === '') return res.status(400).json({ error: '사유를 입력해주세요.' });
  try {
    const { adjustCredit } = await import('../utils/ai-credit');
    const r = await adjustCredit({ companyId: id, amount: Math.floor(amt), type, reason: String(reason).trim(), adminId, idempotencyKey: typeof idempotencyKey === 'string' ? idempotencyKey.slice(0, 100) : undefined });
    console.log(`[관리자크레딧] ${id} ${type} ${amt} → 구매분 ${r.purchasedAfter}`);
    res.json({
      message: type === 'grant' ? `${amt.toLocaleString()} 크레딧을 지급했습니다.` : `${amt.toLocaleString()} 크레딧을 차감했습니다.`,
      purchasedAfter: r.purchasedAfter,
    });
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({ error: 'DB 마이그레이션 필요 — ai_credit_transactions.reason 컬럼 ALTER 실행 요청', code: 'DB_MIGRATION_PENDING' });
    }
    if (msg.includes('이미 처리')) return res.status(409).json({ error: msg, code: 'DUPLICATE_ADJUST' });
    if (msg.includes('부족') || msg.includes('찾을 수 없')) return res.status(400).json({ error: msg });
    console.error('크레딧 조정 실패:', err);
    res.status(500).json({ error: '크레딧 조정 실패' });
  }
});

// 회사별 크레딧 이력 (페이지네이션)
router.get('/companies/:id/credit-transactions', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const page = parseInt(req.query.page as string) || 1;
  try {
    const { getCreditTransactions } = await import('../utils/ai-credit');
    const r = await getCreditTransactions(id, page, 20);
    res.json({ transactions: r.rows, total: r.total, page, totalPages: Math.ceil(r.total / 20) });
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({ error: 'DB 마이그레이션 필요', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('크레딧 이력 조회 실패:', err);
    res.status(500).json({ error: '크레딧 이력 조회 실패' });
  }
});

// 후불 추가 사용 한도 설정 (postpaid_overage_limit)
router.put('/companies/:id/postpaid-overage-limit', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const limit = Number(req.body?.overageLimit);
  if (!Number.isFinite(limit) || limit < 0) {
    return res.status(400).json({ error: '한도는 0 이상 정수여야 합니다.' });
  }
  try {
    const result = await query(
      'UPDATE companies SET postpaid_overage_limit = $1, updated_at = NOW() WHERE id = $2 RETURNING company_name, postpaid_overage_limit',
      [Math.floor(limit), id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: '회사를 찾을 수 없습니다.' });
    console.log(`[후불한도] ${result.rows[0].company_name}: ${result.rows[0].postpaid_overage_limit} 크레딧`);
    res.json({ message: '후불 한도가 저장되었습니다.', overageLimit: Number(result.rows[0].postpaid_overage_limit) });
  } catch (err: any) {
    console.error('후불 한도 설정 실패:', err);
    res.status(500).json({ error: '후불 한도 설정 실패' });
  }
});

// ===== AI 크레딧 충전 요청 관리 (후불 — 슈퍼관리자 승인) =====

// 크레딧 충전 요청 목록 (status 필터)
router.get('/credit-requests', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const status = (req.query.status as string) || undefined;
    const { getRechargeRequests } = await import('../utils/ai-credit-recharge');
    const r = await getRechargeRequests({ status, page, pageSize: 20 });
    res.json({ requests: r.rows, total: r.total, page, totalPages: Math.ceil(r.total / 20) });
  } catch (err: any) {
    if ((err?.message || '').includes('does not exist')) {
      return res.status(503).json({ error: 'DB 마이그레이션 필요 — ai_credit_requests 테이블 생성 요청', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('충전 요청 목록 실패:', err);
    res.status(500).json({ error: '충전 요청 목록 실패' });
  }
});

// 크레딧 충전 요청 승인 (구매분 지급 + 월말 청구 대상)
router.put('/credit-requests/:id/approve', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const adminId = (req as any).user?.userId;
  try {
    const { approveRechargeRequest } = await import('../utils/ai-credit-recharge');
    const r = await approveRechargeRequest({ requestId: id, adminId, adminNote: req.body?.adminNote });
    res.json({ message: `${r.credits.toLocaleString()} 크레딧을 지급했습니다. (월말 청구 대상)`, ...r });
  } catch (err: any) {
    if (err?.name === 'RechargeError') return res.status(400).json({ error: err.message, code: err.code });
    console.error('충전 요청 승인 실패:', err);
    res.status(500).json({ error: '충전 요청 승인 실패' });
  }
});

// 크레딧 충전 요청 거절
router.put('/credit-requests/:id/reject', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const adminId = (req as any).user?.userId;
  const adminNote = (req.body?.adminNote || '').trim();
  if (!adminNote) return res.status(400).json({ error: '거절 사유를 입력해주세요.' });
  try {
    const { rejectRechargeRequest } = await import('../utils/ai-credit-recharge');
    await rejectRechargeRequest({ requestId: id, adminId, adminNote });
    res.json({ message: '충전 요청을 거절했습니다.' });
  } catch (err: any) {
    if (err?.name === 'RechargeError') return res.status(400).json({ error: err.message, code: err.code });
    console.error('충전 요청 거절 실패:', err);
    res.status(500).json({ error: '충전 요청 거절 실패' });
  }
});

// GET /credit-transactions-all — 전체 회사 AI 크레딧 사용 이력 (슈퍼관리자 · 회사/타입 필터 + 페이지네이션)
router.get('/credit-transactions-all', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const page = Number(req.query.page) || 1;
    const companyId = req.query.company ? String(req.query.company) : undefined;
    const type = req.query.type ? String(req.query.type) : undefined;
    const { getAllCreditTransactions } = await import('../utils/ai-credit');
    const r = await getAllCreditTransactions({ companyId, type, page, pageSize: 30 });
    res.json({ transactions: r.rows, total: r.total, page, totalPages: Math.max(1, Math.ceil(r.total / 30)) });
  } catch (err: any) {
    console.error('전체 크레딧 사용 이력 조회 실패:', err);
    res.status(500).json({ error: '크레딧 사용 이력 조회 실패' });
  }
});

// ===== 충전 요청 관리 API =====

// 충전 요청 목록 조회 (필터 + 페이지네이션)
router.get('/deposit-requests', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;
    const status = req.query.status as string; // pending, confirmed, rejected
    const paymentMethod = req.query.paymentMethod as string; // deposit, card, virtual_account

    let where = 'WHERE 1=1';
    const params: any[] = [];
    let paramIdx = 1;

    if (status && status !== 'all') {
      where += ` AND dr.status = $${paramIdx++}`;
      params.push(status);
    }
    if (paymentMethod && paymentMethod !== 'all') {
      where += ` AND COALESCE(dr.payment_method, 'deposit') = $${paramIdx++}`;
      params.push(paymentMethod);
    }

    const countResult = await query(
      `SELECT COUNT(*) FROM deposit_requests dr ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    const result = await query(
      `SELECT dr.id, dr.company_id, dr.amount, dr.depositor_name, dr.status,
              COALESCE(dr.payment_method, 'deposit') as payment_method,
              dr.admin_note, dr.confirmed_by, dr.confirmed_at, dr.created_at,
              c.company_name, c.billing_type, c.balance,
              sa.name as confirmed_by_name
       FROM deposit_requests dr
       JOIN companies c ON dr.company_id = c.id
       LEFT JOIN super_admins sa ON dr.confirmed_by = sa.id
       ${where}
       ORDER BY CASE WHEN dr.status = 'pending' THEN 0 ELSE 1 END, dr.created_at DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
      [...params, limit, offset]
    );

    res.json({
      requests: result.rows,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error('충전 요청 목록 조회 실패:', error);
    res.status(500).json({ error: '충전 요청 목록 조회 실패' });
  }
});

// 충전 요청 승인 (잔액 자동 충전)
router.put('/deposit-requests/:id/approve', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const adminId = (req as any).user?.userId;
  const { adminNote } = req.body;

  try {
    // 요청 조회
    const reqResult = await query(
      `SELECT dr.*, c.company_name, c.billing_type, c.balance
       FROM deposit_requests dr
       JOIN companies c ON dr.company_id = c.id
       WHERE dr.id = $1`,
      [id]
    );

    if (reqResult.rows.length === 0) {
      return res.status(404).json({ error: '충전 요청을 찾을 수 없습니다.' });
    }

    const depositReq = reqResult.rows[0];

    if (depositReq.status !== 'pending') {
      return res.status(400).json({ error: '이미 처리된 요청입니다.' });
    }

    if (depositReq.billing_type !== 'prepaid') {
      return res.status(400).json({ error: '선불 고객사가 아닙니다.' });
    }

    // 1. 잔액 충전
    const balanceResult = await query(
      'UPDATE companies SET balance = balance + $1, updated_at = NOW() WHERE id = $2 RETURNING balance',
      [depositReq.amount, depositReq.company_id]
    );

    // 2. balance_transactions 기록
    const newBalance = Number(balanceResult.rows[0].balance);
    await query(
      `INSERT INTO balance_transactions (company_id, type, amount, balance_before, balance_after, description, reference_type, reference_id, admin_id, payment_method)
       VALUES ($1, 'deposit_charge', $2, $3, $4, $5, 'deposit_request', $6, $7, 'bank_transfer')`,
      [
        depositReq.company_id,
        depositReq.amount,
        newBalance - Number(depositReq.amount),
        newBalance,
        `무통장입금 승인 (입금자: ${depositReq.depositor_name})`,
        id,
        adminId
      ]
    );

    // 3. deposit_requests 상태 변경
    await query(
      `UPDATE deposit_requests SET status = 'confirmed', confirmed_by = $1, confirmed_at = NOW(), admin_note = $2 WHERE id = $3`,
      [adminId, adminNote || null, id]
    );

    console.log(`[입금승인] ${depositReq.company_name}: +${Number(depositReq.amount).toLocaleString()}원 → 잔액 ${newBalance.toLocaleString()}원 (입금자: ${depositReq.depositor_name})`);

    res.json({
      message: `${Number(depositReq.amount).toLocaleString()}원이 충전되었습니다.`,
      balance: newBalance,
    });
  } catch (error) {
    console.error('충전 요청 승인 실패:', error);
    res.status(500).json({ error: '충전 요청 승인 실패' });
  }
});

// 충전 요청 거절
router.put('/deposit-requests/:id/reject', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const adminId = (req as any).user?.userId;
  const { adminNote } = req.body;

  try {
    const reqResult = await query(
      'SELECT status, amount, depositor_name FROM deposit_requests WHERE id = $1',
      [id]
    );

    if (reqResult.rows.length === 0) {
      return res.status(404).json({ error: '충전 요청을 찾을 수 없습니다.' });
    }

    if (reqResult.rows[0].status !== 'pending') {
      return res.status(400).json({ error: '이미 처리된 요청입니다.' });
    }

    await query(
      `UPDATE deposit_requests SET status = 'rejected', confirmed_by = $1, confirmed_at = NOW(), admin_note = $2 WHERE id = $3`,
      [adminId, adminNote || '거절', id]
    );

    console.log(`[입금거절] 요청 ${id}: ${Number(reqResult.rows[0].amount).toLocaleString()}원 (입금자: ${reqResult.rows[0].depositor_name})`);

    res.json({ message: '충전 요청이 거절되었습니다.' });
  } catch (error) {
    console.error('충전 요청 거절 실패:', error);
    res.status(500).json({ error: '충전 요청 거절 실패' });
  }
});

// 전체 선불 고객사 잔액 현황
router.get('/balance-overview', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const result = await query(`
      SELECT c.id, c.company_name, c.billing_type, c.balance,
        c.cost_per_sms, c.cost_per_lms,
        (SELECT COUNT(*) FROM balance_transactions WHERE company_id = c.id AND created_at >= NOW() - INTERVAL '30 days') as recent_tx_count,
        (SELECT SUM(amount) FROM balance_transactions WHERE company_id = c.id AND type = 'deduct' AND created_at >= NOW() - INTERVAL '30 days') as monthly_usage
      FROM companies c
      WHERE c.billing_type = 'prepaid' AND c.status = 'active'
      ORDER BY c.balance ASC
    `);

    res.json({ companies: result.rows });
  } catch (error) {
    console.error('잔액 현황 조회 실패:', error);
    res.status(500).json({ error: '잔액 현황 조회 실패' });
  }
});

// ===== 충전 관리 통합 API =====
router.get('/charge-management', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 15;
    const offset = (page - 1) * limit;
    const companyId = req.query.companyId as string;
    const type = req.query.type as string;
    const paymentMethod = req.query.paymentMethod as string;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;

    // 1. Pending deposit requests (항상 조회)
    const pendingResult = await query(
      `SELECT dr.id, dr.company_id, dr.amount, dr.depositor_name, dr.status,
              COALESCE(dr.payment_method, 'deposit') as payment_method,
              dr.created_at, c.company_name, c.balance
       FROM deposit_requests dr
       JOIN companies c ON dr.company_id = c.id
       WHERE dr.status = 'pending'
       ORDER BY dr.created_at DESC`
    );

    // 2. Balance transactions 필터
    let where = 'WHERE 1=1';
    const params: any[] = [];
    let paramIdx = 1;

    if (companyId && companyId !== 'all') {
      where += ` AND bt.company_id = $${paramIdx++}`;
      params.push(companyId);
    }
    if (type && type !== 'all') {
      if (type === 'charge') {
        where += ` AND bt.type IN ('admin_charge', 'charge', 'deposit_charge')`;
      } else if (type === 'deduct') {
        where += ` AND bt.type IN ('admin_deduct', 'deduct')`;
      } else if (type === 'refund') {
        where += ` AND bt.type = 'refund'`;
      }
    }
    if (paymentMethod && paymentMethod !== 'all') {
      where += ` AND COALESCE(bt.payment_method, 'system') = $${paramIdx++}`;
      params.push(paymentMethod);
    }
    if (startDate) {
      where += ` AND bt.created_at >= $${paramIdx++}::date`;
      params.push(startDate);
    }
    if (endDate) {
      where += ` AND bt.created_at < ($${paramIdx++}::date + INTERVAL '1 day')`;
      params.push(endDate);
    }

    const countResult = await query(
      `SELECT COUNT(*) FROM balance_transactions bt ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    const txResult = await query(
      `SELECT bt.id, bt.company_id, bt.type, bt.amount, bt.balance_after, bt.description,
              bt.reference_type, bt.reference_id, bt.admin_id,
              COALESCE(bt.payment_method, 'system') as payment_method,
              bt.created_at,
              c.company_name,
              sa.name as admin_name
       FROM balance_transactions bt
       JOIN companies c ON bt.company_id = c.id
       LEFT JOIN super_admins sa ON bt.admin_id = sa.id
       ${where}
       ORDER BY bt.created_at DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
      [...params, limit, offset]
    );

    res.json({
      pendingRequests: pendingResult.rows,
      transactions: txResult.rows,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error('충전 관리 조회 실패:', error);
    res.status(500).json({ error: '충전 관리 조회 실패' });
  }
});

// ===== 감사 로그 조회 API =====
// ★ 2026-06-11: 감사 로그 열람 권한 확인 — 메뉴 노출 게이팅용 (AUDIT_LOG_VIEWER_IDS, 기본 'ceo')
router.get('/audit-logs/access', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  res.json({ allowed: await isAuditLogViewer(req.user?.userId) });
});

// ★ 2026-06-13: AI 학습 데이터(인비토AI) 열람 — ceo 전용 (AI_TRAINING_VIEWER_IDS, 기본 'ceo')
router.get('/ai-training/access', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  res.json({ allowed: await isAiTrainingViewer(req.user?.userId) });
});

router.get('/ai-training/overview', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    if (!(await isAiTrainingViewer(req.user?.userId))) {
      return res.status(403).json({ error: 'AI 학습 데이터 열람 권한이 없습니다.' });
    }

    const summaryR = await query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(DISTINCT tenant_ref)::int AS companies,
        COUNT(*) FILTER (WHERE sent_count IS NOT NULL)::int AS metrics_filled,
        COUNT(*) FILTER (WHERE send_at > NOW() - INTERVAL '7 days')::int AS last_7d,
        COUNT(*) FILTER (WHERE send_at > NOW() - INTERVAL '30 days')::int AS last_30d,
        COUNT(*) FILTER (WHERE user_prompt IS NOT NULL AND user_prompt <> '')::int AS with_prompt,
        COUNT(*) FILTER (WHERE message_features IS NOT NULL)::int AS with_features
      FROM ai_training_logs
    `);
    const channelR = await query(
      `SELECT COALESCE(NULLIF(message_type, ''), '기타') AS k, COUNT(*)::int AS cnt
       FROM ai_training_logs GROUP BY 1 ORDER BY cnt DESC`,
    );
    const sourceR = await query(
      `SELECT COALESCE(NULLIF(final_source, ''), '기타') AS k, COUNT(*)::int AS cnt
       FROM ai_training_logs GROUP BY 1 ORDER BY cnt DESC`,
    );
    const trendR = await query(
      `SELECT to_char((send_at AT TIME ZONE 'Asia/Seoul')::date, 'MM-DD') AS day, COUNT(*)::int AS cnt
       FROM ai_training_logs
       WHERE send_at > NOW() - INTERVAL '14 days' AND send_at <= NOW()
       GROUP BY (send_at AT TIME ZONE 'Asia/Seoul')::date
       ORDER BY (send_at AT TIME ZONE 'Asia/Seoul')::date`,
    );
    const prefR = await query(
      `SELECT COUNT(*) FILTER (WHERE status IN ('approved','auto_executed'))::int AS accepted,
              COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected
       FROM operator_proposals`,
    );
    // 스팸필터 테스트 — 통신사 판정 집계 (buildSpamFilterExample과 동일: test별 하나라도 blocked → block)
    const spamFilterR = await query(
      `SELECT COUNT(*) FILTER (WHERE has_blocked)::int AS block,
              COUNT(*) FILTER (WHERE NOT has_blocked AND has_pass)::int AS pass
       FROM (
         SELECT t.id,
                bool_or(r.result = 'blocked') AS has_blocked,
                bool_or(r.result = 'pass') AS has_pass
         FROM spam_filter_tests t
         JOIN spam_filter_test_results r ON r.test_id = t.id
         WHERE COALESCE(NULLIF(t.message_content_lms, ''), NULLIF(t.message_content_sms, '')) IS NOT NULL
         GROUP BY t.id
       ) x`,
    );
    // 차단된 문안 샘플 (어떤 문구가 스팸 처리됐는지 — 최근순 12건, 통신사 동봉)
    const spamSamplesR = await query(
      `SELECT msg, carriers FROM (
         SELECT COALESCE(NULLIF(t.message_content_lms,''), NULLIF(t.message_content_sms,'')) AS msg,
                array_agg(DISTINCT r.carrier) FILTER (WHERE r.result = 'blocked') AS carriers,
                MAX(t.created_at) AS last_at
         FROM spam_filter_tests t
         JOIN spam_filter_test_results r ON r.test_id = t.id
         WHERE COALESCE(NULLIF(t.message_content_lms,''), NULLIF(t.message_content_sms,'')) IS NOT NULL
         GROUP BY t.id, msg
         HAVING bool_or(r.result = 'blocked')
       ) x
       ORDER BY last_at DESC
       LIMIT 12`,
    );

    const s = summaryR.rows[0] || {};
    const pref = prefR.rows[0] || {};
    const sf = spamFilterR.rows[0] || {};
    const target = 100000; // SCALING.md Phase 2 데이터 축적 목표
    const total = Number(s.total) || 0;
    return res.json({
      success: true,
      summary: {
        total,
        companies: Number(s.companies) || 0,
        metricsFilled: Number(s.metrics_filled) || 0,
        last7d: Number(s.last_7d) || 0,
        last30d: Number(s.last_30d) || 0,
        target,
        progressPct: Math.round((total / target) * 1000) / 10,
      },
      channels: channelR.rows.map((r: any) => ({ key: r.k, count: Number(r.cnt) || 0 })),
      sources: sourceR.rows.map((r: any) => ({ key: r.k, count: Number(r.cnt) || 0 })),
      trend: trendR.rows.map((r: any) => ({ day: r.day, count: Number(r.cnt) || 0 })),
      preference: { accepted: Number(pref.accepted) || 0, rejected: Number(pref.rejected) || 0 },
      spamFilter: { block: Number(sf.block) || 0, pass: Number(sf.pass) || 0 },
      spamSamples: spamSamplesR.rows.map((r: any) => ({
        message: String(r.msg || '').slice(0, 140),
        carriers: Array.isArray(r.carriers) ? r.carriers.filter(Boolean) : [],
      })),
      datasets: {
        generation: Number(s.with_prompt) || 0,
        preference: (Number(pref.accepted) || 0) + (Number(pref.rejected) || 0),
        // 스팸 분류 = ai_training_logs(features 있는 발송) + 스팸필터 테스트(block/pass 판정 문안)
        spam: (Number(s.with_features) || 0) + (Number(sf.block) || 0) + (Number(sf.pass) || 0),
      },
    });
  } catch (err: any) {
    console.error('[AI Training overview] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '조회 실패' });
  }
});

router.get('/audit-logs', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    // ★ 2026-06-11: 열람 제한 — AUDIT_LOG_VIEWER_IDS(기본 'ceo')에 포함된 계정만 (Harold 명시)
    if (!(await isAuditLogViewer(req.user?.userId))) {
      return res.status(403).json({ error: '감사 로그 열람 권한이 없습니다.' });
    }
    const { page = 1, limit = 25, action, companyId, fromDate, toDate, userId } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    // 액션 필터
    if (action && action !== 'all') {
      whereClause += ` AND al.action LIKE $${paramIndex++}`;
      params.push(`%${action}%`);
    }

    // 고객사 필터 (user의 company_id로)
    if (companyId && companyId !== 'all') {
      whereClause += ` AND (u.company_id = $${paramIndex} OR al.details->>'companyId' = $${paramIndex})`;
      params.push(companyId);
      paramIndex++;
    }

    // 사용자 필터
    if (userId && userId !== 'all') {
      whereClause += ` AND al.user_id = $${paramIndex++}::uuid`;
      params.push(userId);
    }

    // 날짜 필터
    if (fromDate) {
      whereClause += ` AND al.created_at >= $${paramIndex++}::date`;
      params.push(String(fromDate));
    }
    if (toDate) {
      whereClause += ` AND al.created_at < ($${paramIndex++}::date + interval '1 day')`;
      params.push(String(toDate));
    }

    // 총 건수
    const countResult = await query(
      `SELECT COUNT(*) FROM audit_logs al LEFT JOIN users u ON al.user_id = u.id ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    // 데이터 조회
    params.push(Number(limit), offset);
    const result = await query(
      `SELECT 
        al.id, al.user_id, al.action, al.target_type, al.target_id,
        al.details, al.ip_address, al.user_agent, al.created_at,
        COALESCE(u.login_id, sa.login_id, '시스템') as login_id,
        COALESCE(u.name, sa.name, '시스템') as user_name,
        u.company_id,
        c.company_name
       FROM audit_logs al
       LEFT JOIN users u ON al.user_id = u.id
       LEFT JOIN super_admins sa ON al.user_id = sa.id
       LEFT JOIN companies c ON u.company_id = c.id
       ${whereClause}
       ORDER BY al.created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      params
    );

    // 액션 유형 목록 (필터용)
    const actionsResult = await query(
      `SELECT DISTINCT action FROM audit_logs ORDER BY action`
    );

    res.json({
      logs: result.rows,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
      actions: actionsResult.rows.map((r: any) => r.action),
    });
  } catch (error) {
    console.error('감사 로그 조회 실패:', error);
    res.status(500).json({ error: '감사 로그 조회 실패' });
  }
});

// ===== 발송 라인그룹 관리 API =====

// GET /api/admin/line-groups - 라인그룹 목록
router.get('/line-groups', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const result = await query(`
      SELECT lg.*,
        (SELECT COUNT(*) FROM companies c WHERE c.line_group_id = lg.id) as company_count
      FROM sms_line_groups lg
      ORDER BY lg.sort_order, lg.created_at
    `);
    res.json({ lineGroups: result.rows });
  } catch (error) {
    console.error('라인그룹 목록 조회 실패:', error);
    res.status(500).json({ error: '조회 실패' });
  }
});

// POST /api/admin/line-groups - 라인그룹 생성
router.post('/line-groups', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { groupName, groupType, smsTables, sortOrder } = req.body;
    if (!groupName || !groupType || !smsTables || smsTables.length === 0) {
      return res.status(400).json({ error: '필수 필드를 입력해주세요.' });
    }
    // ★ P0-Q1: SQL Injection 방지 — 테이블명 화이트리스트 검증
    try {
      validateSmsTables(smsTables);
    } catch (err) {
      return res.status(400).json({ error: `잘못된 테이블명: ${err instanceof Error ? err.message : String(err)}` });
    }
    const result = await query(`
      INSERT INTO sms_line_groups (group_name, group_type, sms_tables, sort_order)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [groupName, groupType, smsTables, sortOrder || 0]);

    invalidateLineGroupCache();
    // ★ 2026-06-11 감사 로그 — 라인그룹 생성 추적
    await recordAuditLog({
      actorUserId: req.user?.userId,
      action: 'line_group_create',
      targetType: 'line_group',
      targetId: result.rows[0].id,
      details: { group_name: groupName, group_type: groupType, sms_tables: smsTables, sort_order: sortOrder || 0 },
      req,
    });
    res.json({ lineGroup: result.rows[0], message: '라인그룹이 생성되었습니다.' });
  } catch (error) {
    console.error('라인그룹 생성 실패:', error);
    res.status(500).json({ error: '생성 실패' });
  }
});

// PUT /api/admin/line-groups/:id - 라인그룹 수정
router.put('/line-groups/:id', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { groupName, groupType, smsTables, sortOrder, isActive } = req.body;
    // ★ P0-Q1: SQL Injection 방지 — 테이블명 화이트리스트 검증
    if (smsTables) {
      try {
        validateSmsTables(smsTables);
      } catch (err) {
        return res.status(400).json({ error: `잘못된 테이블명: ${err instanceof Error ? err.message : String(err)}` });
      }
    }
    // ★ 2026-06-11: 변경 전 값 조회 — 감사 로그 before 기록
    const lgBeforeRes = await query('SELECT group_name, group_type, sms_tables, sort_order, is_active FROM sms_line_groups WHERE id = $1', [id]);

    const result = await query(`
      UPDATE sms_line_groups
      SET group_name = COALESCE($1, group_name),
          group_type = COALESCE($2, group_type),
          sms_tables = COALESCE($3, sms_tables),
          sort_order = COALESCE($4, sort_order),
          is_active = COALESCE($5, is_active),
          updated_at = NOW()
      WHERE id = $6
      RETURNING *
    `, [groupName || null, groupType || null, smsTables || null, sortOrder !== undefined ? sortOrder : null, isActive !== undefined ? isActive : null, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: '라인그룹을 찾을 수 없습니다.' });
    }

    invalidateLineGroupCache();
    // ★ 2026-06-11 감사 로그 — 라인그룹 수정 추적 (변경 필드만)
    if (lgBeforeRes.rows.length > 0) {
      const d = diffFields(lgBeforeRes.rows[0], result.rows[0], ['group_name', 'group_type', 'sms_tables', 'sort_order', 'is_active']);
      if (d.changed.length > 0) {
        await recordAuditLog({
          actorUserId: req.user?.userId,
          action: 'line_group_update',
          targetType: 'line_group',
          targetId: id,
          details: { group_name: result.rows[0].group_name, ...d },
          req,
        });
      }
    }
    res.json({ lineGroup: result.rows[0], message: '수정되었습니다.' });
  } catch (error) {
    console.error('라인그룹 수정 실패:', error);
    res.status(500).json({ error: '수정 실패' });
  }
});

// DELETE /api/admin/line-groups/:id - 라인그룹 삭제
router.delete('/line-groups/:id', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    // 할당된 회사 있는지 확인
    const assigned = await query('SELECT COUNT(*) FROM companies WHERE line_group_id = $1', [id]);
    if (parseInt(assigned.rows[0].count) > 0) {
      return res.status(400).json({ error: '할당된 고객사가 있어 삭제할 수 없습니다. 먼저 고객사 라인그룹을 변경해주세요.' });
    }
    // ★ 2026-06-11: 삭제 전 값 확보 — 감사 로그 기록용
    const lgDelBefore = await query('SELECT group_name, group_type, sms_tables FROM sms_line_groups WHERE id = $1', [id]);
    await query('DELETE FROM sms_line_groups WHERE id = $1', [id]);
    invalidateLineGroupCache();
    // ★ 2026-06-11 감사 로그 — 라인그룹 삭제 추적
    if (lgDelBefore.rows.length > 0) {
      await recordAuditLog({
        actorUserId: req.user?.userId,
        action: 'line_group_delete',
        targetType: 'line_group',
        targetId: id,
        details: lgDelBefore.rows[0],
        req,
      });
    }
    res.json({ message: '삭제되었습니다.' });
  } catch (error) {
    console.error('라인그룹 삭제 실패:', error);
    res.status(500).json({ error: '삭제 실패' });
  }
});

// ===== SyncAgent API Key 관리 =====

// SyncAgent 키 조회
router.get('/companies/:id/sync-keys', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await query(
      'SELECT api_key, api_secret, use_db_sync FROM companies WHERE id = $1',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '회사를 찾을 수 없습니다.' });
    }
    res.json({ syncKeys: result.rows[0] });
  } catch (error) {
    console.error('SyncAgent 키 조회 실패:', error);
    res.status(500).json({ error: 'SyncAgent 키 조회 실패' });
  }
});

// SyncAgent 키 재발급
router.post('/companies/:id/sync-keys/regenerate', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const exists = await query('SELECT id FROM companies WHERE id = $1', [id]);
    if (exists.rows.length === 0) {
      return res.status(404).json({ error: '회사를 찾을 수 없습니다.' });
    }

    const newApiKey = `tk_${crypto.randomBytes(24).toString('hex')}`;
    const newApiSecret = crypto.randomBytes(32).toString('hex');

    const result = await query(
      `UPDATE companies
       SET api_key = $1, api_secret = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING api_key, api_secret, use_db_sync`,
      [newApiKey, newApiSecret, id]
    );

    res.json({ syncKeys: result.rows[0], message: 'API Key가 재발급되었습니다. 기존 키는 즉시 무효화됩니다.' });
  } catch (error) {
    console.error('SyncAgent 키 재발급 실패:', error);
    res.status(500).json({ error: 'SyncAgent 키 재발급 실패' });
  }
});

// SyncAgent use_db_sync 토글
router.put('/companies/:id/sync-keys', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { useDbSync } = req.body;

  if (typeof useDbSync !== 'boolean') {
    return res.status(400).json({ error: 'useDbSync는 boolean 값이어야 합니다.' });
  }

  try {
    const result = await query(
      `UPDATE companies
       SET use_db_sync = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING api_key, api_secret, use_db_sync`,
      [useDbSync, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: '회사를 찾을 수 없습니다.' });
    }

    res.json({ syncKeys: result.rows[0], message: useDbSync ? 'SyncAgent가 활성화되었습니다.' : 'SyncAgent가 비활성화되었습니다.' });
  } catch (error) {
    console.error('SyncAgent 설정 변경 실패:', error);
    res.status(500).json({ error: 'SyncAgent 설정 변경 실패' });
  }
});

// ═══════════════════════════════════════════════════════════
// 슈퍼관리자 — 알림톡/RCS 템플릿 관리
// ═══════════════════════════════════════════════════════════

// GET /api/admin/kakao-profiles — 전체 고객사 발신 프로필 목록
router.get('/kakao-profiles', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const companyId = req.query.company_id as string | undefined;
    let sql = `SELECT ksp.*, c.company_name
       FROM kakao_sender_profiles ksp
       LEFT JOIN companies c ON ksp.company_id = c.id
       WHERE 1=1`;
    const params: any[] = [];
    if (companyId) { params.push(companyId); sql += ` AND ksp.company_id = $${params.length}`; }
    sql += ' ORDER BY ksp.created_at DESC';
    const result = await query(sql, params);
    res.json({ success: true, profiles: result.rows });
  } catch (error) {
    console.error('[Admin] 발신 프로필 목록 조회 실패:', error);
    res.status(500).json({ success: false, error: '조회 실패' });
  }
});

// POST /api/admin/kakao-profiles — 슈퍼관리자가 고객사 발신 프로필 등록
router.post('/kakao-profiles', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { companyId, profileName, profileKey } = req.body;
    if (!companyId || !profileName || !profileKey) {
      return res.status(400).json({ success: false, error: '고객사, 프로필명, 프로필키는 필수입니다' });
    }
    const result = await query(
      `INSERT INTO kakao_sender_profiles (company_id, profile_name, profile_key)
       VALUES ($1, $2, $3) RETURNING *`,
      [companyId, profileName, profileKey]
    );
    res.json({ success: true, profile: result.rows[0] });
  } catch (error) {
    console.error('[Admin] 발신 프로필 등록 실패:', error);
    res.status(500).json({ success: false, error: '등록 실패' });
  }
});

// DELETE /api/admin/kakao-profiles/:id — 슈퍼관리자가 발신 프로필 삭제
router.delete('/kakao-profiles/:id', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await query('DELETE FROM kakao_sender_profiles WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    console.error('[Admin] 발신 프로필 삭제 실패:', error);
    res.status(500).json({ success: false, error: '삭제 실패' });
  }
});

// GET /api/admin/kakao-templates — 전체 고객사 알림톡 템플릿 목록
router.get('/kakao-templates', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string | undefined;
    const companyId = req.query.company_id as string | undefined;

    let sql = `SELECT kt.*, c.company_name, ksp.profile_name
       FROM kakao_templates kt
       LEFT JOIN companies c ON kt.company_id = c.id
       LEFT JOIN kakao_sender_profiles ksp ON kt.profile_id = ksp.id
       WHERE 1=1`;
    const params: any[] = [];

    if (status) {
      params.push(status);
      sql += ` AND kt.status = $${params.length}`;
    }
    if (companyId) {
      params.push(companyId);
      sql += ` AND kt.company_id = $${params.length}`;
    }

    sql += ' ORDER BY kt.created_at DESC';

    const result = await query(sql, params);
    res.json({ success: true, templates: result.rows });
  } catch (error) {
    console.error('[Admin] 알림톡 템플릿 조회 실패:', error);
    res.status(500).json({ success: false, error: '조회 실패' });
  }
});

// PUT /api/admin/kakao-templates/:id/approve — 알림톡 템플릿 승인
router.put('/kakao-templates/:id/approve', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const adminId = (req as any).user?.id;
    const { templateCode } = req.body;

    // ★ D143 (2026-04-30): kakao_templates_status_check CHECK 대문자 풀네임 8개로 교체됨.
    //   기존 소문자('approved'/'pending'/'rejected')는 위반 → 대문자 + 'REQUESTED'(옛 'pending') 매핑.
    //   본 라우트는 frontend 미사용(dead) — 슈퍼관리자가 IMC 통한 새 워크플로우(/api/alimtalk/templates)에서 처리.
    //   안전 차원에서 새 CHECK 호환되게 상수만 갱신 (라우트 폐기는 별건).
    const result = await query(
      `UPDATE kakao_templates SET
        status = 'APPROVED',
        template_code = COALESCE($2, template_code),
        approved_at = NOW(),
        reviewed_at = NOW(),
        reviewed_by = $3,
        updated_at = NOW()
      WHERE id = $1 AND status = 'REQUESTED'
      RETURNING *`,
      [id, templateCode || null, adminId]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, error: '검수요청 상태의 템플릿만 승인 가능합니다' });
    }

    res.json({ success: true, template: result.rows[0] });
  } catch (error) {
    console.error('[Admin] 알림톡 템플릿 승인 실패:', error);
    res.status(500).json({ success: false, error: '승인 실패' });
  }
});

// PUT /api/admin/kakao-templates/:id/reject — 알림톡 템플릿 반려
router.put('/kakao-templates/:id/reject', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const adminId = (req as any).user?.id;
    const { rejectReason } = req.body;

    if (!rejectReason) {
      return res.status(400).json({ success: false, error: '반려 사유는 필수입니다' });
    }

    // ★ D143 (2026-04-30): 'rejected'/'pending' → 'REJECTED'/'REQUESTED' 대문자 풀네임으로 교체 (CHECK 호환).
    const result = await query(
      `UPDATE kakao_templates SET
        status = 'REJECTED',
        reject_reason = $2,
        reviewed_at = NOW(),
        reviewed_by = $3,
        updated_at = NOW()
      WHERE id = $1 AND status = 'REQUESTED'
      RETURNING *`,
      [id, rejectReason, adminId]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, error: '검수요청 상태의 템플릿만 반려 가능합니다' });
    }

    res.json({ success: true, template: result.rows[0] });
  } catch (error) {
    console.error('[Admin] 알림톡 템플릿 반려 실패:', error);
    res.status(500).json({ success: false, error: '반려 실패' });
  }
});

// POST /api/admin/kakao-templates/manual — 기존 템플릿 수동 등록 (승인 상태로 직접 저장)
router.post('/kakao-templates/manual', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const adminId = (req as any).user?.id;
    const {
      companyId, profileId, templateCode, templateName, category,
      messageType, emphasizeType, emphasizeTitle, content, imageUrl,
      extraContent, adContent, securityFlag, buttons, quickReplies,
    } = req.body;

    if (!companyId || !templateName || !content) {
      return res.status(400).json({ success: false, error: '고객사, 템플릿명, 본문은 필수입니다' });
    }

    const result = await query(
      `INSERT INTO kakao_templates (
        company_id, profile_id, template_code, template_name, category,
        message_type, emphasize_type, emphasize_title, content, image_url,
        extra_content, ad_content, security_flag, buttons, quick_replies,
        status, approved_at, reviewed_at, reviewed_by, requested_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'approved',NOW(),NOW(),$16,NOW())
      RETURNING *`,
      [
        companyId, profileId || null, templateCode || null, templateName, category || null,
        messageType || 'BA', emphasizeType || 'NONE', emphasizeTitle || null, content, imageUrl || null,
        extraContent || null, adContent || null, securityFlag || false,
        JSON.stringify(buttons || []), JSON.stringify(quickReplies || []), adminId,
      ]
    );

    res.json({ success: true, template: result.rows[0] });
  } catch (error) {
    console.error('[Admin] 알림톡 템플릿 수동 등록 실패:', error);
    res.status(500).json({ success: false, error: '등록 실패' });
  }
});

// GET /api/admin/rcs-templates — 전체 고객사 RCS 템플릿 목록
router.get('/rcs-templates', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string | undefined;
    const companyId = req.query.company_id as string | undefined;

    let sql = `SELECT rt.*, c.company_name
       FROM rcs_templates rt
       LEFT JOIN companies c ON rt.company_id = c.id
       WHERE 1=1`;
    const params: any[] = [];

    if (status) {
      params.push(status);
      sql += ` AND rt.status = $${params.length}`;
    }
    if (companyId) {
      params.push(companyId);
      sql += ` AND rt.company_id = $${params.length}`;
    }

    sql += ' ORDER BY rt.created_at DESC';

    const result = await query(sql, params);
    res.json({ success: true, templates: result.rows });
  } catch (error) {
    console.error('[Admin] RCS 템플릿 조회 실패:', error);
    res.status(500).json({ success: false, error: '조회 실패' });
  }
});

// PUT /api/admin/rcs-templates/:id/approve — RCS 템플릿 승인
router.put('/rcs-templates/:id/approve', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const adminId = (req as any).user?.id;

    const result = await query(
      `UPDATE rcs_templates SET
        status = 'approved', approved_at = NOW(), reviewed_at = NOW(),
        reviewed_by = $2, updated_at = NOW()
      WHERE id = $1 AND status = 'pending'
      RETURNING *`,
      [id, adminId]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, error: '승인대기 상태의 템플릿만 승인 가능합니다' });
    }

    res.json({ success: true, template: result.rows[0] });
  } catch (error) {
    console.error('[Admin] RCS 템플릿 승인 실패:', error);
    res.status(500).json({ success: false, error: '승인 실패' });
  }
});

// PUT /api/admin/rcs-templates/:id/reject — RCS 템플릿 반려
router.put('/rcs-templates/:id/reject', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const adminId = (req as any).user?.id;
    const { rejectReason } = req.body;

    if (!rejectReason) {
      return res.status(400).json({ success: false, error: '반려 사유는 필수입니다' });
    }

    const result = await query(
      `UPDATE rcs_templates SET
        status = 'rejected', reject_reason = $2, reviewed_at = NOW(),
        reviewed_by = $3, updated_at = NOW()
      WHERE id = $1 AND status = 'pending'
      RETURNING *`,
      [id, rejectReason, adminId]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, error: '승인대기 상태의 템플릿만 반려 가능합니다' });
    }

    res.json({ success: true, template: result.rows[0] });
  } catch (error) {
    console.error('[Admin] RCS 템플릿 반려 실패:', error);
    res.status(500).json({ success: false, error: '반려 실패' });
  }
});

// ============================================================
// ★ D114 P10: 발송통계 엑셀(CSV) 다운로드
// 필요 데이터: 발송날짜 / 발송계정(사용자) / 문자타입별 총건수·성공·실패·대기
// 계정별 사용 내역 필수 (거래내역서 발행용)
// ============================================================
router.get('/stats/export', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, companyId } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: '시작일과 종료일을 입력해주세요.' });
    }

    let whereClause = `WHERE ${STAT_DATE_EXPR} >= ($1 || ' 00:00:00+09')::timestamptz
                          AND ${STAT_DATE_EXPR} < ($2 || ' 00:00:00+09')::timestamptz + INTERVAL '1 day'`;
    const params: any[] = [startDate, endDate];
    let paramIdx = 3;

    if (companyId) {
      whereClause += ` AND c.company_id = $${paramIdx++}`;
      params.push(companyId);
    }

    // ★ D144: PG sent_count/success_count/fail_count 캐시 의존 제거.
    //   PG는 캠페인 메타 + 회사+사용자만 SELECT → MySQL 큐 + 카카오 직접 카운트 → JS에서 6-key 그룹핑.
    const exportMetaResult = await query(
      `SELECT
        c.id, c.company_id, c.created_by, c.target_count, c.message_type, c.send_channel, c.send_type,
        c.result_final, c.sent_count, c.success_count, c.fail_count,
        TO_CHAR(${STAT_DATE_EXPR} AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') as send_date,
        co.company_name,
        co.company_code,
        u.login_id,
        u.name as user_name
      FROM campaigns c
      JOIN companies co ON c.company_id = co.id
      LEFT JOIN users u ON c.created_by = u.id
      ${whereClause}
        AND ${STAT_STARTED_GUARD}
        AND c.status NOT IN ('draft', 'cancelled')`,
      params
    );

    // 일반 캠페인 — result_final 캐시 우선(완료 MySQL skip). 알림톡은 채널 분리라 실시간 유지.
    const exportResultMap = await getCampaignResultCounts(exportMetaResult.rows);
    const exportKakaoMap = await kakaoBatchAggByGroup(exportMetaResult.rows.map((c: any) => c.id));
    // 알림톡 캠페인만 채널 분리 집계(알림톡 K / 대체발송 L·k_oriseq>0) → 엑셀에서 2행으로 분리
    const alimtalkCampaigns = exportMetaResult.rows.filter((c: any) => c.send_channel === 'alimtalk');
    const exportSplitMap = await aggregateSmsChannelSplitByCampaign(alimtalkCampaigns);

    type ExportBucket = {
      send_date: string; company_name: any; company_code: any; login_id: any; user_name: any;
      message_type: any; send_channel: any; send_type: any; channel_label: string;
      campaign_count: number; total_target: number;
      total_sent: number; total_success: number; total_fail: number; total_pending: number;
    };
    const exportByKey = new Map<string, ExportBucket>();

    const addExportBucket = (c: any, channelKey: string, channelLabel: string,
                             target: number, sent: number, success: number, fail: number, pending: number) => {
      const key = `${c.send_date}|${c.company_id}|${c.created_by || ''}|${channelKey}|${c.send_type || ''}`;
      if (!exportByKey.has(key)) {
        exportByKey.set(key, {
          send_date: c.send_date, company_name: c.company_name, company_code: c.company_code,
          login_id: c.login_id, user_name: c.user_name,
          message_type: c.message_type, send_channel: c.send_channel, send_type: c.send_type,
          channel_label: channelLabel,
          campaign_count: 0, total_target: 0,
          total_sent: 0, total_success: 0, total_fail: 0, total_pending: 0,
        });
      }
      const b = exportByKey.get(key)!;
      b.campaign_count++;
      b.total_target += target;
      b.total_sent += sent; b.total_success += success; b.total_fail += fail; b.total_pending += pending;
    };

    for (const c of exportMetaResult.rows) {
      const kakao = exportKakaoMap.get(c.id) || { total: 0, success: 0, fail: 0, pending: 0 };
      if (c.send_channel === 'alimtalk') {
        const split = exportSplitMap.get(c.id);
        const a = split?.alimtalk ?? { total: 0, success: 0, fail: 0, pending: 0 };
        const sLms = split?.substitute_lms ?? { total: 0, success: 0, fail: 0, pending: 0 };
        const sSms = split?.substitute_sms ?? { total: 0, success: 0, fail: 0, pending: 0 };
        // 알림톡 행 — SMS 큐 K + 카카오 IMC 합산(이 운영은 IMC 0이라 kakao=0). 대상건수는 여기에 귀속.
        addExportBucket(c, 'alimtalk', '알림톡', Number(c.target_count || 0),
          a.total + kakao.total, a.success + kakao.success, a.fail + kakao.fail, a.pending + kakao.pending);
        // 알림톡대체발송 — 카카오 실패 후 LMS/SMS 대체분 각각(0이면 행 생략, 대상건수 중복 방지 0). 정산 단가 구분용.
        if (sLms.total > 0) {
          addExportBucket(c, 'substitute_lms', '알림톡대체발송(LMS)', 0, sLms.total, sLms.success, sLms.fail, sLms.pending);
        }
        if (sSms.total > 0) {
          addExportBucket(c, 'substitute_sms', '알림톡대체발송(SMS)', 0, sSms.total, sSms.success, sSms.fail, sSms.pending);
        }
      } else {
        const counts = exportResultMap.get(c.id) || { sent: 0, success: 0, fail: 0, pending: 0 };
        const pending = counts.pending;
        const channelKey = `${c.message_type || ''}|${c.send_channel || ''}`;
        addExportBucket(c, channelKey, getCampaignChannelLabel(c.send_channel, c.message_type),
          Number(c.target_count || 0),
          counts.sent, counts.success, counts.fail, pending);
      }
    }

    const exportRows = Array.from(exportByKey.values()).sort((a, b) => {
      if (a.send_date !== b.send_date) return a.send_date < b.send_date ? 1 : -1;
      const cn = String(a.company_name || '').localeCompare(String(b.company_name || ''));
      if (cn !== 0) return cn;
      const lg = String(a.login_id || '').localeCompare(String(b.login_id || ''));
      if (lg !== 0) return lg;
      return String(a.message_type || '').localeCompare(String(b.message_type || ''));
    });
    const result = { rows: exportRows };

    // CSV 생성 — 쉼표/큰따옴표 포함 값은 이스케이핑
    const BOM = '\uFEFF';
    const csvEscape = (v: any) => {
      const s = String(v ?? '');
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const headers = ['발송일', '회사코드', '회사명', '계정ID', '사용자명', '문자타입', '발송유형', '캠페인수', '대상건수', '전송건수', '성공', '실패', '대기'];
    const rows = result.rows.map((r: any) => [
      r.send_date,
      csvEscape(r.company_code || ''),
      csvEscape(r.company_name),
      csvEscape(r.login_id || '-'),
      csvEscape(r.user_name || '-'),
      r.channel_label,
      r.send_type === 'auto' ? '자동' : r.send_type === 'direct' ? '직접' : 'AI',
      r.campaign_count,
      r.total_target,
      r.total_sent,
      r.total_success,
      r.total_fail,
      Math.max(0, Number(r.total_pending) || 0),
    ].join(','));

    const csv = BOM + headers.join(',') + '\n' + rows.join('\n');

    const filename = `발송통계_${startDate}_${endDate}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.send(csv);
  } catch (error) {
    console.error('[Admin] 발송통계 엑셀 다운로드 실패:', error);
    res.status(500).json({ error: '다운로드에 실패했습니다.' });
  }
});

export default router;