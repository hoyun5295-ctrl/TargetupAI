import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { Request, Response, Router } from 'express';
import { mysqlQuery, query, pool } from '../config/database';
import { authenticate, requireSuperAdmin } from '../middlewares/auth';
import { ALL_SMS_TABLES, invalidateLineGroupCache, getCampaignSmsTables, smsCountAll, smsSelectAll, smsSelectPagedAll, smsAggAll, getTestSmsTables, findMissingSmsTables } from '../utils/sms-queue';
import { streamCampaignSmsCsv } from '../utils/campaign-sms-export';
import { insertCuratedSeeds, listCuratedSeeds, listCuratedSeedCounts, deleteCuratedSeed, saveCuratedSeedOne, updateCuratedSeed, SeedGateFail } from '../utils/copy-seed-curator';
import { startMiningJob, getMiningJob } from '../utils/best-copy-miner';
import { INDUSTRY_CODES, INDUSTRY_LABELS, isIndustryCode } from '../utils/industry-codes';
// ★ 2026-07-04 진화: 성과 환류(usage 집계) + 공식 증류/예시(specs/2026-07-04-best-copy-evolution-design.md)
import { getSeedUsageStats, getIndustryFormula, listStyleExamples } from '../utils/best-copy-assets';
import { distillIndustryFormula } from '../utils/industry-formula';
// ★ 2026-06-25: 업로더별 고객 삭제 시 해당 회사 데이터 프로필 캐시 무효화(게이트 즉시 반영)
import { clearCompanyDataProfileCache } from '../utils/company-data-profile';
import { DASHBOARD_CARD_POOL, validateCardIds, getRequiredFields, filterPoolByAvailableData, generateDynamicCards } from '../utils/dashboard-card-pool';
import { detectEnabledFields, clearEnabledFieldsCache } from '../utils/enabled-fields';
import { SUCCESS_CODES_SQL, PENDING_CODES_SQL, getStatusLabel, getStatusType, getCarrierLabel, isSuccess, isPending, getSendTypeLabel, getCampaignChannelLabel, getQueueRowStatus, getDisplayContents } from '../utils/sms-result-map';
import { DEFAULT_COSTS, getCompanyCosts } from '../config/defaults';
import { round2 } from '../utils/unit-price';
import { validateSmsTables } from '../utils/sms-table-validator';
// ★ D145 P0: 예약 캠페인 자동 정리 (모든 발송 관련 라우트 정합성)
import { cleanupScheduledCampaigns, cancelCampaign } from '../utils/campaign-lifecycle';
import { getUserUnsubscribes, deleteUserUnsubscribes, exportUserUnsubscribes, CAMPAIGN_OPT080_SELECT_EXPR, CAMPAIGN_OPT080_LEFT_JOIN } from '../utils/unsubscribe-helper';
import { buildDateRangeFilter, aggregateSmsCountsByCampaign, aggregateSmsChannelSplitByCampaign, aggregateSmsSendTimesByCampaign, getCampaignResultCounts, STAT_DATE_EXPR, STAT_STARTED_GUARD } from '../utils/stats-aggregation';
// ★ 2026-07-23: 슈퍼관리자 발송통계 웹/에이전트 구분 — 에이전트(엔진) 통계 CT 병행 반환
import {
  queryPayAgentStatsAllCompanies, queryPayAgentStoreBreakdown, validateStatsDateRange, isPayStatsConfigured,
  parseAgentCharges, insertAgentCharges, getAgentChargeStatus, listAgentCharges, countAgentCharges, latestAgentChargeAt, findGatewayCharges, matchHealWindow,
  getAgentCustNameMap,
} from '../utils/pay-stats';
// ★ 2026-07-27 §5-4: 고객사 충전 요청 접수 원장 (요청 → 직원 1클릭 실행 → 반영 확인 후 완료)
import { parseRejectReason } from '../utils/agent-charge-orders';
import { handleDbMigrationError } from '../utils/db-migration-error';
import { sendSystemAlert } from '../utils/system-alert';
// ★ 2026-07-24 슈퍼 에이전트 통계 엑셀(CSV) — 기간×고객사×발송ID×유형 (정산 대조)
import { buildAdminAgentStatsXlsx } from '../utils/manage-stats-export';
// ★ 2026-07-25 고객 대상 표는 엑셀(.xlsx)로 나간다 — LESSONS_BACKEND "고객 대상 xlsx = exceljs".
import { buildXlsxBuffer, XLSX_CONTENT_TYPE, xlsxContentDisposition } from '../utils/xlsx-writer';
import { normalizePhone } from '../utils/normalize-phone';
import { normalizeCdpAutoExecuteGate } from '../utils/autosend-policy';
import { grantFreeTrial } from '../utils/basic-trial';
// ★ 2026-07-25 요금제 변경 이력 CT — 청구서 일할계산의 진실의 원천(빠지면 그 구간이 증발)
import { recordPlanChange, alertPlanChangeFailure } from '../utils/plan-change-log';
// ★ 2026-06-11: 감사 로그 CT — 라인그룹 지정/해제 책임 추적 (에이치피오 예약취소 사고 후속)
import { recordAuditLog, isAuditLogViewer, isAiTrainingViewer, isLineGroupAdmin, diffFields } from '../utils/audit-log';
// ★ 2026-07-01: 예측 일괄 분석·차감 수동 트리거 (9시 대기 없이 검증·복구·시연)
import { runPredictiveBatchNow } from '../utils/predictive-worker';
import { sendTypeLabel } from '../utils/send-type-axis';

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
    // ★ 2026-07-03: 활성 필드 캐시 동반 무효화
    if (user.company_id) clearEnabledFieldsCache(user.company_id);

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

// ★ 2026-07-21 문안 생성 참조 업종 목록 — 고객사 수정 셀렉트용 경량 SSOT(프론트 하드코딩 금지).
//   업종 SSOT = industry-codes.ts. best-copy/list는 시드까지 끌어오는 무거운 쿼리라 이 용도로 재사용 부적합.
router.get('/industry-codes', authenticate, requireSuperAdmin, (_req: Request, res: Response) => {
  res.json({ industries: INDUSTRY_CODES.map((code) => ({ code, label: INDUSTRY_LABELS[code] })) });
});

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

// ============================================================
//  단가 설정 — 쓰기 경로 단일화 (★ 2026-07-26 Harold 확정)
// ============================================================
//
// 신설 사유: 단가가 **부가세 포함**으로 입력돼 있었는데 청구 코드는 그 값을 공급가액으로 놓고
//   10%를 또 더했다(금강제화 7월 실측 +1,339,745원 과청구). 컬럼명에 포함 여부가 안 적혀 있어
//   tsc·테스트·금액 항등식 3중 검사가 전부 통과한다 — 코드로는 절대 안 잡히는 부류다.
//
// 그래서 ①입력을 "부가세 별도(공급가)"로 통일하고 ②그 사실을 `unit_price_basis`에 **같은 문장에서**
//   함께 기록한다. 단가와 기준이 따로 써지면 그 사이가 곧 사고다.
//   기존 3개 쓰기 경로(회사 수정·고객사 설정·관리자 회사 수정)의 단가 쓰기는 전부 걷어냈다.
//
// 값이 없으면(빈 문자열) NULL로 되돌린다 — 미설정은 청구를 막는 신호라 "0원 계약"과 구분해야 한다.
router.put('/companies/:id/unit-prices', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { prices, applyToUnsetAgents } = req.body || {};

  const FIELDS: Array<[string, string]> = [
    ['sms', 'cost_per_sms'], ['lms', 'cost_per_lms'], ['mms', 'cost_per_mms'], ['kakao', 'cost_per_kakao'],
    // ★ 2026-07-29 브랜드메시지. 전체 교체 규칙이라 화면이 이 키를 반드시 담아 보내야 한다
    //   (배포는 프론트 먼저 — 옛 백엔드는 모르는 키를 무시하므로 그 순서가 무중단이다).
    ['brand', 'cost_per_brand'],
    ['testSms', 'cost_per_test_sms'], ['testLms', 'cost_per_test_lms'],
  ];

  // ★ 2026-07-26 이 API는 **전체 교체**다(Codex #2). 키가 빠지면 그 유형이 조용히 NULL이 되고,
  //   선불 회사라면 그 유형이 차감 없이 발송된다. 부분 요청은 받지 않는다 —
  //   "비우려는 의도"는 빈 문자열로 명시해야 한다.
  const missing = FIELDS.filter(([key]) => !(prices && Object.prototype.hasOwnProperty.call(prices, key)))
    .map(([key]) => key);
  if (!prices || typeof prices !== 'object' || missing.length > 0) {
    return res.status(422).json({
      success: false,
      error: `단가는 전체를 한 번에 저장합니다. 빠진 항목이 있습니다: ${missing.join(', ') || 'prices'}. 비우려면 빈 값으로 보내 주세요.`,
      code: 'UNIT_PRICE_INCOMPLETE',
      missing_fields: missing,
    });
  }

  // 형식 검증 — 숫자가 아닌 값이 들어오면 조용히 0원으로 저장되는 일이 없게 여기서 막는다.
  const values: Record<string, number | null> = {};
  const invalid: string[] = [];
  for (const [key, col] of FIELDS) {
    const raw = prices?.[key];
    if (raw === undefined || raw === null || String(raw).trim() === '') { values[col] = null; continue; }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) { invalid.push(key); continue; }
    values[col] = round2(n);
  }
  if (invalid.length > 0) {
    return res.status(422).json({
      success: false,
      error: `단가에 숫자가 아니거나 음수인 값이 있습니다: ${invalid.join(', ')}`,
      code: 'UNIT_PRICE_INVALID',
      invalid_fields: invalid,
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const before = await client.query(
      `SELECT company_name, unit_price_basis, cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao,
              cost_per_brand, cost_per_test_sms, cost_per_test_lms
         FROM companies WHERE id = $1::uuid FOR UPDATE`,
      [id]
    );
    if (before.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: '회사를 찾을 수 없습니다.' });
    }

    // 단가 6개와 기준을 **한 문장**으로 쓴다. 기준만 먼저 바뀌면 그 순간 청구 금액이 10% 틀린다.
    const updated = await client.query(
      `UPDATE companies
          SET cost_per_sms = $2, cost_per_lms = $3, cost_per_mms = $4, cost_per_kakao = $5,
              cost_per_test_sms = $6, cost_per_test_lms = $7, cost_per_brand = $8,
              unit_price_basis = 'vat_excluded',
              updated_at = NOW()
        WHERE id = $1::uuid
        RETURNING company_name, unit_price_basis, cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao,
                  cost_per_brand, cost_per_test_sms, cost_per_test_lms`,
      [id, values.cost_per_sms, values.cost_per_lms, values.cost_per_mms, values.cost_per_kakao,
       values.cost_per_test_sms, values.cost_per_test_lms, values.cost_per_brand]
    );

    // 발송ID 단가는 **상속시키지 않는다** — 발송ID마다 계약이 다를 수 있고, 암묵 상속은
    // 계약이 다른 발송ID를 조용히 회사 단가로 청구한다(금액 검사가 못 잡는다).
    // 대신 운영자가 명시적으로 누를 때만 **미설정 행에** 복사한다. 이미 값이 있는 행은 건드리지 않는다.
    let agentCopied = 0;
    if (applyToUnsetAgents === true) {
      const copied = await client.query(
        `UPDATE company_agent_ids
            SET cost_per_sms = COALESCE(cost_per_sms, $2),
                cost_per_lms = COALESCE(cost_per_lms, $3),
                cost_per_mms = COALESCE(cost_per_mms, $4),
                cost_per_kakao = COALESCE(cost_per_kakao, $5),
                cost_per_brand = COALESCE(cost_per_brand, $6)
          WHERE company_id = $1::uuid
            AND (cost_per_sms IS NULL OR cost_per_lms IS NULL OR cost_per_mms IS NULL
                 OR cost_per_kakao IS NULL OR cost_per_brand IS NULL)`,
        [id, values.cost_per_sms, values.cost_per_lms, values.cost_per_mms, values.cost_per_kakao,
         values.cost_per_brand]
      );
      agentCopied = copied.rowCount || 0;
    }

    await client.query('COMMIT');

    await recordAuditLog({
      actorUserId: req.user?.userId,
      action: 'company_unit_price_update',
      targetType: 'company',
      targetId: id,
      details: {
        company_name: updated.rows[0].company_name,
        basis: { before: before.rows[0].unit_price_basis, after: 'vat_excluded' },
        before: before.rows[0],
        after: updated.rows[0],
        agent_rows_filled: agentCopied,
      },
      req,
    });

    return res.json({
      success: true,
      company: updated.rows[0],
      agent_rows_filled: agentCopied,
      message: agentCopied > 0
        ? `단가를 저장했습니다. 단가가 비어 있던 발송ID ${agentCopied}건에 함께 적용했습니다.`
        : '단가를 저장했습니다.',
    });
  } catch (error: any) {
    try { await client.query('ROLLBACK'); } catch { /* 이미 종료된 트랜잭션 */ }
    const msg = error?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({
        success: false,
        error: 'DB 마이그레이션 필요 — 운영자에게 companies.unit_price_basis ALTER 실행 요청',
        code: 'DB_MIGRATION_PENDING',
      });
    }
    console.error('단가 저장 실패:', error);
    return res.status(500).json({ success: false, error: '단가 저장 실패' });
  } finally {
    client.release();
  }
});

// 회사 수정
router.put('/companies/:id', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { 
    companyName, contactName, contactEmail, contactPhone,
    status, planId, rejectNumber, brandName,
    sendHourStart, sendHourEnd, dailyLimit, holidaySend, duplicateDays,
    // ★ 2026-07-26 단가 6종을 이 라우트에서 **받지 않는다.** 식별자를 없애 두면
    //   나중에 누가 다시 바인딩하려 해도 컴파일이 막는다(주석만으로는 못 막는다).
    //   단가는 기준(unit_price_basis)과 원자적으로 써야 해서 전용 엔드포인트 하나로 좁혔다:
    //   PUT /api/admin/companies/:id/unit-prices
    storeCodeList,
    businessNumber, ceoName, businessType, businessItem, address,
    allowCallbackSelfRegister, maxUsers, sessionTimeoutMinutes,
    approvalRequired, targetStrategy, lineGroupId, kakaoEnabled,
    subscriptionStatus,
    userIsolationEnabled,  // ★ D162-3 (2026-05-15) 수신거부 사용자격리 ON/OFF
    usageType,  // ★ 2026-07-03 사용구분: web / agent / both
    industryCode,  // ★ 2026-07-21 문안 생성 참조 업종(companies.industry_code) — 사업자등록증 업태/종목과 별개
  } = req.body;

  if (usageType !== undefined && !['web', 'agent', 'both'].includes(usageType)) {
    return res.status(400).json({ error: 'usageType은 web/agent/both 중 하나여야 합니다.' });
  }

  // ★ 2026-07-21 업종 코드 정규화 — undefined=무변(미전송) / ''=미지정으로 클리어(NULL) / 유효코드=저장 / 그 외=거부.
  let industryCodeParam: string | null = null;
  if (industryCode !== undefined) {
    const ic = String(industryCode).trim();
    if (ic === '') {
      industryCodeParam = '';  // 클리어 신호 — SQL CASE에서 NULLIF로 NULL 저장
    } else if (isIndustryCode(ic)) {
      industryCodeParam = ic;
    } else {
      return res.status(400).json({ error: '유효하지 않은 업종 코드입니다.' });
    }
  }

  try {
    // ★ CT-17: planId 변경 시 TRIAL plan이면 'trial' 유지, 그 외 유료 플랜이면 'paid'(정식 구독).
    //   (과거 버그 ①: planId 있으면 무조건 'active'로 덮어써서 grant-trial 직후 재저장 시 체험 상태 파괴)
    //   (네이밍 정리 ②: 'active'는 companies.status(운영 활성)와 네이밍 충돌 → 구독 상태는 'paid'로 통일)
    // ★ 2026-07-28 요금제를 바꿀 때 체험 만료일(trial_expires_at)도 같은 UPDATE에서 정한다.
    //   그 전에는 이 라우트가 만료일을 아예 건드리지 않아, 체험 이력이 있는 회사에 무료체험을
    //   다시 주면 **옛 만료일이 그대로 남아 부여 즉시 만료 상태**가 됐고 다음 04:00에
    //   trial-downgrade-worker가 FREE로 강등했다(= 부여가 안 먹는 것처럼 보인 원인).
    //   체험 이력이 없는 회사는 반대로 만료일이 NULL로 남아 강등 대상에서도 빠지고(워커 조건이
    //   `trial_expires_at IS NOT NULL`), 화면 3곳의 "체험 중 D-n" 표시도 안 뜬다 — 어중간하게 남는다.
    //   상태·만료일 판정은 **요금제가 실제로 바뀐 경우에만** 한다 — 연락처만 고쳐도 planId가
    //   함께 실려 오면 진행 중인 체험이 조용히 'paid'로 덮이던 결함을 같은 자리에서 닫는다.
    let finalSubscriptionStatus: string | null = subscriptionStatus || null;
    let planIsTrial = false;
    let planTrialDays = 0;
    if (planId) {
      const planCodeRes = await query(
        `SELECT plan_code, COALESCE(trial_days, 0) AS trial_days FROM plans WHERE id = $1`,
        [planId],
      );
      planIsTrial = planCodeRes.rows[0]?.plan_code === 'TRIAL';
      planTrialDays = Number(planCodeRes.rows[0]?.trial_days) || 0;
    }

    // ★ 2026-06-11 감사: 회사 라인그룹 변경 추적 — 변경 전 값 확보
    let prevCompanyLineGroupId: string | null = null;
    if (lineGroupId) {
      const prevLg = await query('SELECT line_group_id FROM companies WHERE id = $1', [id]);
      prevCompanyLineGroupId = prevLg.rows[0]?.line_group_id ?? null;
    }

    // ★ 2026-07-25 요금제가 바뀌는 경로라 변경과 이력을 한 트랜잭션으로(Codex 지적 A·C).
    //   이 엔드포인트는 이력 배선이 빠져 있었다 — `SET plan_id` 리터럴 grep이 다중 컬럼 UPDATE의
    //   중간 줄(`plan_id = COALESCE($6, plan_id)`)을 못 잡았다. 전 출현 분류로 재검증해 찾았다.
    const planClient = await pool.connect();
    let result: any;
    try {
      await planClient.query('BEGIN');
      const beforePlan = await planClient.query('SELECT plan_id FROM companies WHERE id = $1::uuid FOR UPDATE', [id]);
      if (beforePlan.rows.length === 0) {
        await planClient.query('ROLLBACK');
        return res.status(404).json({ error: '회사를 찾을 수 없습니다.' });
      }
      // ★ 2026-07-28 잠근 행에서 읽은 직전 플랜으로만 "실제 변경"을 판정한다(이력 기록과 같은 기준).
      //   planChanged=false면 구독 상태·체험 만료일을 건드리지 않는다.
      //   trialDaysParam: null = 체험 아님(만료일 삭제) / N = 오늘부터 N일.
      const planChanged =
        Boolean(planId) && String(beforePlan.rows[0].plan_id || '') !== String(planId);
      let trialDaysParam: number | null = null;
      if (planChanged) {
        finalSubscriptionStatus = planIsTrial ? 'trial' : 'paid';
        trialDaysParam = planIsTrial ? (planTrialDays > 0 ? planTrialDays : 30) : null;
      }
      result = await planClient.query(`
      UPDATE companies
      SET company_name = COALESCE($1, company_name),
          contact_name = COALESCE($2, contact_name),
          contact_email = COALESCE($3, contact_email),
          contact_phone = COALESCE($4, contact_phone),
          status = COALESCE($5, status),
          plan_id = COALESCE($6, plan_id),
          -- ★ 2026-07-28 판정 축을 "planId가 실려 왔는가"($6)에서 "요금제가 실제로 바뀌었는가"($38)로 바꿨다.
          --   전자는 연락처만 고쳐도 planId가 함께 오면 진행 중인 체험을 'paid'로 덮었다.
          subscription_status = CASE WHEN $38::boolean IS TRUE THEN $31::varchar ELSE COALESCE($31, subscription_status) END,
          -- ★ 2026-07-28 체험 만료일도 같은 트랜잭션에서. $39 = 체험 일수(NULL이면 체험 아님 → 만료일 삭제).
          --   요금제가 안 바뀌면 손대지 않는다.
          trial_expires_at = CASE
            WHEN $38::boolean IS NOT TRUE THEN trial_expires_at
            WHEN $39::int IS NULL THEN NULL
            ELSE NOW() + ($39::int || ' days')::interval
          END,
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
          -- ★ 2026-07-25 미전송(null)=무변 / ''=미설정으로 되돌림 / 값=저장.
          --   COALESCE만 쓰면 한 번 넣은 단가를 다시 비워 일반 단가 상속으로 되돌릴 수 없다.
          cost_per_test_sms = CASE WHEN $36::text IS NULL THEN cost_per_test_sms ELSE NULLIF($36::text, '')::numeric END,
          cost_per_test_lms = CASE WHEN $37::text IS NULL THEN cost_per_test_lms ELSE NULLIF($37::text, '')::numeric END,
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
          usage_type = COALESCE($34, usage_type),
          -- ★ 2026-07-21 문안 참조 업종: null=무변 / ''=NULLIF로 미지정 클리어 / 코드=저장
          industry_code = CASE WHEN $35::text IS NULL THEN industry_code ELSE NULLIF($35, '') END,
          -- subscription_status는 위 plan_id CASE문에서 처리
          updated_at = NOW()
      WHERE id = $32
      RETURNING *
    `, [companyName, contactName, contactEmail, contactPhone, status, planId, rejectNumber, brandName, sendHourStart, sendHourEnd, dailyLimit, holidaySend, duplicateDays, null /* ★2026-07-26 단가 쓰기 경로 통합 — 이 라우트는 단가를 더 이상 저장하지 않는다.
             기준(unit_price_basis)과 원자적으로 써야 하는 값이라 쓰기 경로를 하나로 좁혔다:
             PUT /api/admin/companies/:id/unit-prices */, null, null, null, storeCodeList ? JSON.stringify(storeCodeList) : null, businessNumber, ceoName, businessType, businessItem, address, allowCallbackSelfRegister !== undefined ? allowCallbackSelfRegister : null, maxUsers || null, sessionTimeoutMinutes || null, approvalRequired !== undefined ? approvalRequired : null, targetStrategy || null, lineGroupId || null, kakaoEnabled !== undefined ? kakaoEnabled : null, finalSubscriptionStatus, id, userIsolationEnabled !== undefined ? userIsolationEnabled : null, usageType || null, industryCodeParam, null /* 테스트 단가도 위 전용 엔드포인트에서만 저장한다 */, null, planChanged, trialDaysParam]);

      // 요금제가 실제로 바뀐 때만 기록한다(COALESCE라 planId가 null이면 미변경).
      const newPlanId = result.rows[0]?.plan_id;
      if (planId && newPlanId && String(newPlanId) !== String(beforePlan.rows[0].plan_id)) {
        await recordPlanChange({
          client: planClient,
          companyId: id,
          toPlanId: String(newPlanId),
          changeType: 'auto',
          changedBy: (req as any).user?.userId || null,
          reason: '회사 수정(요금제 변경·슈퍼관리자)',
        });
      }
      await planClient.query('COMMIT');
    } catch (err) {
      try { await planClient.query('ROLLBACK'); } catch { /* 아래 알림에 포함 */ }
      await alertPlanChangeFailure(id, err);
      throw err;
    } finally {
      planClient.release();
    }

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
  } catch (error: any) {
    console.error('회사 수정 실패:', error);
    // ★ 2026-07-03 db_alter_safety_net: usage_type 컬럼 미마이그레이션 서버 방어
    const msg = error?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({
        success: false,
        error: 'DB 마이그레이션 필요 — 운영자에게 companies.usage_type ALTER 실행 요청',
        code: 'DB_MIGRATION_PENDING',
      });
    }
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
    
    // ★ 2026-06-08: 무료체험 신청([무료체험] 센티넬)이면 1개월 체험 부여, 그 외는 일반 플랜 변경.
    //   ★ 2026-07-28 배정 플랜 BASIC → TRIAL(월 0원). 기능 권한은 TRIAL 플래그가 BASIC과 동일하게 맞춰져 있다.
    const isTrialReq = typeof request.message === 'string' && request.message.startsWith('[무료체험]');
    if (isTrialReq) {
      await grantFreeTrial(request.company_id);
    } else {
      // ★ CT-17: 요금제 승인 시 TRIAL plan이면 'trial' 유지, 그 외는 'paid'(정식 구독).
      //   (과거: 무조건 'active'로 덮어써서 ① 체험 상태 파괴 ② companies.status='active'와 네이밍 충돌)
      const approvedPlanRes = await query(`SELECT plan_code FROM plans WHERE id = $1`, [request.requested_plan_id]);
      const approvedIsTrial = approvedPlanRes.rows[0]?.plan_code === 'TRIAL';
      const approvedStatus = approvedIsTrial ? 'trial' : 'paid';
      // ★ 2026-07-25 플랜 변경과 이력을 한 트랜잭션으로(Codex 지적 C).
      //   승급/강등 판정은 recordPlanChange 안에서 INSERT에 쓰는 바로 그 직전 값으로 한다(지적 F) —
      //   호출부가 미리 계산하면 그 사이 다른 변경이 끼어들 때 방향이 뒤집힌다.
      const planClient = await pool.connect();
      try {
        await planClient.query('BEGIN');
        const planUpd = await planClient.query(
          `UPDATE companies SET plan_id = $1, subscription_status = $2, updated_at = NOW() WHERE id = $3
           RETURNING id`,
          [request.requested_plan_id, approvedStatus, request.company_id]
        );
        if (planUpd.rows.length > 0) {
          await recordPlanChange({
            client: planClient,
            companyId: request.company_id,
            toPlanId: request.requested_plan_id,
            changeType: 'auto',
            changedBy: (req as any).user?.userId || null,
            reason: '요금제 신청 승인(슈퍼관리자)',
          });
        }
        await planClient.query('COMMIT');
      } catch (err) {
        try { await planClient.query('ROLLBACK'); } catch { /* 아래 알림에 포함 */ }
        await alertPlanChangeFailure(request.company_id, err);
        return res.status(500).json({ error: '요금제 승인에 실패했습니다. 다시 시도해주세요.' });
      } finally {
        planClient.release();
      }
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
    // ★ 2026-07-23 에이전트 CT는 자체 월 확장 → 원본(raw) 날짜 전달(아래 확장분과 이중 적용 방지)
    const rawStartDate = startDate;
    const rawEndDate = endDate;

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
        const costRes = await query('SELECT cost_per_sms, cost_per_lms, unit_price_basis FROM companies WHERE id = $1', [targetCompanyId]);
        const { sms: cSms, lms: cLms } = getCompanyCosts(costRes.rows[0] || {});
        testSummary.cost = Math.round((testSummary.sms * cSms + testSummary.lms * cLms) * 10) / 10;
      } catch (err) {
        console.error('테스트 통계 조회 실패:', err);
      }
    }

    // ★ 2026-07-23: 슈퍼관리자 웹/에이전트 구분 — 에이전트(agent·both) 회사 엔진 통계를 (기간,회사)별 병행 반환.
    //   웹(campaigns) 축은 불변. env 미설정·실패 = agentRows 빈 배열(조용한 폴백). 별도 DB(pay-ingest) 조회라 발송 기간계 무관.
    let agentSummary: any = null;
    let agentRows: any[] = [];
    if (isPayStatsConfigured()) {
      const agentRes = await queryPayAgentStatsAllCompanies({
        view: view as 'daily' | 'monthly',
        startDate: rawStartDate,
        endDate: rawEndDate,
        companyId: companyId || undefined,
      });
      if (agentRes) { agentSummary = agentRes.summary; agentRows = agentRes.rows; }
    }

    res.json({
      summary: summaryResult.rows[0],
      testSummary,
      rows: rowsResult.rows,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      // ★ 2026-07-23 웹/에이전트 구분 (별도 탭)
      agentSummary,
      agentRows,
      agentTotal: agentRows.length,
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
        c.message_type, c.send_channel, c.is_ad, c.callback_number, c.target_count, c.created_at, c.sent_at,
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
        // 카카오·알림톡은 message_type이 전부 LMS다 — 채널 판정은 이 값이 담당한다(화면 CT가 읽는다).
        send_channel: c.send_channel,
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
        c.id, c.campaign_name as name, c.status, c.send_type, c.send_channel, c.created_at,
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
    // ★ 2026-07-30: 브랜드(kakao·kakao_brand)·알림톡도 SMSQ(app_etc1) 합류 — 전 채널이 SMS 경로 하나로 조회된다.
    //   channelFilter 'kakao'도 같은 큐를 보므로 SMS 경로로 수렴(브랜드 행은 msg_type='F' 라벨로 구분).
    const showSms = (!channelFilter || channelFilter === 'sms' || channelFilter === 'kakao');

    let allDetail: any[] = [];
    let totalSms = 0;
    const totalKakao = 0;   // 응답 형태 유지용 — IMC 폐기로 항상 0

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
          // ★ 2026-07-30: 브랜드 행(msg_type='F')은 msg_contents가 JSON — 본문(MESSAGE)만 풀어 표시.
          msgContents: getDisplayContents(r.msg_type, r.msg_contents),
          msgType: r.msg_type === 'S' ? 'SMS' : r.msg_type === 'L' ? 'LMS' : r.msg_type === 'M' ? 'MMS' : getSendTypeLabel(r.msg_type, r.k_oriseq),
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

    // (2026-07-30 재구축) 옛 카카오 IMC 내역 조회 폐기 — 브랜드 행은 위 SMS 경로(app_etc1)에 포함되며
    // sendType 라벨은 getSendTypeLabel('F')='브랜드메시지'로 구분된다.

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
// ※ 이 자리에 있던 `POST /billing/:id/send-email`은 삭제했다(2026-07-26).
//   **닿지 않는 라우트였다.** `app.ts:319`가 `/api/admin/billing`에 billing 라우터를 먼저 마운트하므로
//   `POST /api/admin/billing/:id/send-email`은 항상 `routes/billing.ts`에서 잡힌다.
//   여기 있던 구현은 PDF가 stub(`pdfBuffer: null`)이라 첨부 없는 메일을 보내는 코드였고,
//   같은 URL에 두 구현이 있으면 다음 사람이 닿지 않는 쪽을 고친다 — 실제로 이번에 그런 일이 있었다.
//   실경로 = `routes/billing.ts` `/:id/send-email`(항목표를 `billing_items`에서 만들고 정합 검사 후 발송).

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

// GET /credit-risk-companies — 크레딧 위험 회사 (소진 임박·0·마이너스·상한 근접). 해지방어·업셀 레이더 (크레딧 모델 v2 2026-06-30).
//   잔액(기본+구매) ≤ 월 grant 20%인 회사만. 마이너스 = 운영 과금(여정·자동마케팅 실행) 음수 누적분. 상한 = −1개월 grant.
router.get('/credit-risk-companies', authenticate, requireSuperAdmin, async (_req: Request, res: Response) => {
  try {
    const r = await query(
      `SELECT c.id, c.company_name,
              c.ai_credits_base_remaining AS base,
              COALESCE(c.ai_credits_purchased, 0) AS purchased,
              p.ai_credits_per_month AS plan_credits,
              p.plan_name
         FROM companies c
         JOIN plans p ON c.plan_id = p.id
        WHERE p.ai_credits_per_month IS NOT NULL AND p.ai_credits_per_month > 0
          AND (c.ai_credits_base_remaining + COALESCE(c.ai_credits_purchased, 0)) <= p.ai_credits_per_month * 0.2
        ORDER BY (c.ai_credits_base_remaining + COALESCE(c.ai_credits_purchased, 0)) ASC
        LIMIT 200`
    );
    const companies = r.rows.map((row: any) => {
      const base = Number(row.base) || 0;
      const purchased = Number(row.purchased) || 0;
      const planCredits = Number(row.plan_credits) || 0;
      const total = base + purchased;
      // 위험 등급: 마이너스(운영 과금 음수 누적) > 소진(0) > 소진 임박(80%+ 사용)
      const risk: 'negative' | 'depleted' | 'low' = total < 0 ? 'negative' : total === 0 ? 'depleted' : 'low';
      const nearCap = planCredits > 0 && base <= -(planCredits * 0.8);  // −1개월 grant 상한 80% 근접
      return { id: row.id, companyName: row.company_name, planName: row.plan_name, base, purchased, total, planCredits, risk, nearCap };
    });
    res.json({ companies });
  } catch (err: any) {
    console.error('크레딧 위험 회사 조회 실패:', err);
    res.status(500).json({ error: '크레딧 위험 회사 조회 실패' });
  }
});

// POST /predictive/run-now — 예측 일괄 분석·차감 수동 실행 (9시 대기 없이 검증·복구·시연).
//   대상 = 요금제 가입 회사(FREE 제외·구독 만료/정지 제외) + 고객 보유. predictive-worker와 동일 eligibility.
//   멱등키(회사+날짜) 유지 → 같은 날 재실행해도 중복 차감 0. 이미 진행 중이면 ran:false.
router.post('/predictive/run-now', authenticate, requireSuperAdmin, async (_req: Request, res: Response) => {
  try {
    const result = await runPredictiveBatchNow();
    res.json({ success: true, ...result });
  } catch (err: any) {
    console.error('예측 수동 실행 실패:', err?.message);
    res.status(500).json({ success: false, error: '예측 수동 실행 실패' });
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

// ===== ★ 2026-07-24 §5-3 에이전트 충전 실행 (62 pay-ingest-db RSRM_FillAmtHist — 웹 balance와 별개 지갑) =====

// 충전 대상 목록 — usage_type agent/both 회사의 발송ID 전량 (하드코딩 없음, 등록 즉시 자동 편입)
router.get('/agent-charges/targets', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT c.id AS company_id, c.company_name, cai.agent_send_id, cai.billing_type
         FROM company_agent_ids cai
         JOIN companies c ON c.id = cai.company_id
        WHERE c.usage_type IN ('agent','both')
        ORDER BY c.company_name ASC, cai.agent_send_id ASC`
    );
    // ★ 2026-07-27 발급명(게이트웨이 RSRM_SalesMst.CustNm) 동반 — 회사명만 주면 한 회사의 발송ID 여럿이
    //   전부 같은 이름으로 보인다(런소프트 C0130·D0078·D0079). 이 목록이 충전 폼·이력 검색의 이름 소스다.
    const nameMap = await getAgentCustNameMap();
    res.json({
      targets: result.rows.map((r: any) => ({ ...r, cust_name: nameMap.get(String(r.agent_send_id)) || null })),
    });
  } catch (error: any) {
    console.error('에이전트 충전 대상 조회 실패:', error);
    if (handleDbMigrationError(error, res, 'company_agent_ids')) return;
    res.status(500).json({ error: '충전 대상 조회 실패' });
  }
});

// 충전 등록 (다건 일괄·음수 상계 지원) — ★Codex 7R 정정 반영판
//   멱등: idempotencyKey 필수 + PG agent_charge_requests UNIQUE 예약(재전송/더블클릭/응답 유실 재시도 = 재충전 0)
//   감사: 요청 원장에 requested_by·reason·총액 기록 (게이트웨이 잔액·반영 상태는 여전히 FillAmtHist 단일 진실 — 복제 아님)
//   선불 강제: billing_type='prepaid' + usage_type agent/both 발송ID만 충전 허용
//   성공 응답은 "등록(반영 대기)"일 뿐, 반영 완료 표시는 status의 applied=true만 근거
router.post('/agent-charges', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  const idempotencyKey = String((req.body as any)?.idempotencyKey || '').trim();
  try {
    if (!isPayStatsConfigured()) {
      return res.status(503).json({ error: '게이트웨이 통계 DB(env paystats) 미설정 — 충전 실행 불가' });
    }
    if (idempotencyKey.length < 8 || idempotencyKey.length > 80) {
      return res.status(400).json({ error: 'idempotencyKey(8~80자)가 필요합니다.' });
    }
    const reason = String((req.body as any)?.reason || '').trim();
    if (!reason || reason.length > 200) {
      return res.status(400).json({ error: '충전 사유(1~200자)가 필요합니다.' });
    }
    const parsed = parseAgentCharges(req.body);
    if ('error' in parsed) {
      return res.status(400).json({ error: parsed.error });
    }

    // 발송ID 실존 + 선불(prepaid) + usage_type 검증 — 매핑에 없거나 후불인 ID 차단 (Codex 7R-3)
    const ids = parsed.charges.map((c) => c.agentSendId);
    const known = await query(
      `SELECT cai.agent_send_id, cai.billing_type, c.usage_type
         FROM company_agent_ids cai JOIN companies c ON c.id = cai.company_id
        WHERE cai.agent_send_id = ANY($1)`,
      [ids]
    );
    const infoMap = new Map<string, any>(known.rows.map((r: any) => [String(r.agent_send_id), r]));
    const unknown = ids.filter((v) => !infoMap.has(v));
    if (unknown.length > 0) {
      return res.status(400).json({ error: `매핑에 없는 발송ID: ${unknown.join(', ')} — 고객사 수정 화면에서 먼저 등록하세요.` });
    }
    const notEligible = ids.filter((v) => {
      const r = infoMap.get(v);
      return r.billing_type !== 'prepaid' || !['agent', 'both'].includes(String(r.usage_type));
    });
    if (notEligible.length > 0) {
      return res.status(400).json({ error: `선불 지정되지 않은 발송ID: ${notEligible.join(', ')} — 고객사 수정 화면에서 선불 지정 먼저 하세요.` });
    }

    const totalAmount = parsed.charges.reduce((s, c) => s + c.amount, 0);
    const absBatch = parsed.charges.reduce((s, c) => s + Math.abs(c.amount), 0);
    const requestedBy = String((req as any).user?.userId || '');

    // 멱등 선조회 → 불확실 게이트 → 일 한도 → 예약 INSERT를 단일 트랜잭션(어드바이저리 락)으로(Codex 9R·10R).
    // - 멱등키 선조회가 한도보다 먼저: 이미 접수된 키의 안전 재전송이 일 한도 성장으로 오거부되지 않게(10R).
    // - 불확실 게이트 = 서버 전역: 미해소 uncertain 존재 시 어떤 경로(새 탭/새로고침/직접 API)로도 신규 충전 차단(10R-1a).
    // - 한도 = gross(abs_total 합산 — 배치 내 ± 상쇄로 우회 불가), 기준일 = Asia/Seoul. 근거: PAY 실측(§2-6).
    const client = await pool.connect();
    let requestId: string | null = null;
    let duplicatedKey = false;
    let uncertainPending: any[] | null = null;
    let capExceeded: { used: number } | null = null;
    try {
      await client.query('BEGIN');
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('agent_charge_requests_daily'))`);
      const dupChk = await client.query(`SELECT id FROM agent_charge_requests WHERE idempotency_key = $1`, [idempotencyKey]);
      if (dupChk.rows.length > 0) {
        duplicatedKey = true;
        await client.query('COMMIT');
      } else {
        // 게이트 대상 = 미해소 uncertain + "seqNo 없는 reserved 전부"(우회 창 0 — Codex 12R-1).
        //   정상 reserved는 같은 요청 처리 안에서 수백 ms 내 registered로 전이되므로, 여기 걸리는 것은
        //   ①마킹 실패 잔존 ②거의 동시에 온 다른 충전뿐. 단독 운영에서 동시 충전 과잉차단은 안전 방향.
        const unc = await client.query(
          `SELECT id, reason, abs_total, created_at, charges FROM agent_charge_requests
            WHERE status = 'uncertain'
               OR (status = 'reserved' AND (charges->0->>'seqNo') IS NULL)
            ORDER BY created_at ASC LIMIT 10`
        );
        if (unc.rows.length > 0) {
          uncertainPending = unc.rows;
          await client.query('ROLLBACK');
        } else {
          const daily = await client.query(
            `SELECT COALESCE(SUM(abs_total), 0) AS s
               FROM agent_charge_requests
              WHERE created_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul')
                AND status IN ('reserved', 'registered', 'uncertain')`
          );
          const dailyUsed = Number(daily.rows[0]?.s || 0);
          if (dailyUsed + absBatch > 200_000_000) {
            capExceeded = { used: dailyUsed };
            await client.query('ROLLBACK');
          } else {
            const reserve = await client.query(
              `INSERT INTO agent_charge_requests (idempotency_key, requested_by, reason, charges, total_amount, abs_total, status)
               VALUES ($1, $2, $3, $4::jsonb, $5, $6, 'reserved')
               ON CONFLICT (idempotency_key) DO NOTHING
               RETURNING id`,
              [idempotencyKey, requestedBy, reason, JSON.stringify(parsed.charges), totalAmount, absBatch]
            );
            if (reserve.rows.length === 0) duplicatedKey = true;
            else requestId = String(reserve.rows[0].id);
            await client.query('COMMIT');
          }
        }
      }
      client.release();
    } catch (txErr) {
      // 롤백까지 실패한 클라이언트는 풀 복귀 금지 — release(true) = destroy (Codex 10R)
      try {
        await client.query('ROLLBACK');
        client.release();
      } catch {
        client.release(true as unknown as Error);
      }
      throw txErr;
    }

    if (uncertainPending) {
      return res.status(409).json({
        code: 'UNCERTAIN_PENDING',
        error: '반영 불확실 충전이 미해소 상태입니다 — 이력 확인 후 해소해야 신규 충전이 가능합니다.',
        uncertainRequests: uncertainPending,
      });
    }
    if (capExceeded) {
      return res.status(400).json({ error: `일 누적 충전 한도(절대합 200,000,000)를 초과합니다. (오늘 누적 ${capExceeded.used.toLocaleString()} + 이번 ${absBatch.toLocaleString()})` });
    }
    if (duplicatedKey || !requestId) {
      // 같은 키 재전송 — 기존 요청 그대로 반환(재충전 0)
      const existing = await query(
        `SELECT id, charges, status FROM agent_charge_requests WHERE idempotency_key = $1`,
        [idempotencyKey]
      );
      const ex = existing.rows[0];
      return res.status(200).json({
        duplicated: true,
        requestId: ex?.id || null,
        registered: Array.isArray(ex?.charges) ? ex.charges : [],
        message: '이미 접수된 요청입니다(중복 충전 차단).',
      });
    }

    let registered;
    try {
      registered = await insertAgentCharges(parsed.charges);
    } catch (mysqlErr: any) {
      if (mysqlErr?.chargeCommitUncertain) {
        // 커밋 응답 유실 — 실제 반영됐을 수 있다. 예약을 지우지 않고 uncertain 마킹(같은 키 재시도 = 중복 차단 유지, Codex 8R-1a).
        // 이후 신규 충전은 서버 전역 게이트가 차단하며, 해소는 /agent-charges/:id/resolve 로만 가능.
        // 마킹은 2회 시도 — 그래도 실패하면 reserved 잔존분을 게이트의 stale-reserved 조건이 잡는다(Codex 11R-1)
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            await query(`UPDATE agent_charge_requests SET status = 'uncertain' WHERE id = $1`, [requestId]);
            break;
          } catch (markErr) {
            console.error(`[agent-charges] uncertain 마킹 실패(${attempt}/2 — 예약은 유지·게이트가 stale-reserved로 차단):`, markErr);
          }
        }
        // 최고 위험 경로(고액 실반영 가능 + ACK 유실)일수록 즉시 알림 — 금액 무관 발송(Codex 10R)
        sendSystemAlert({
          dedupKey: `agent-charge-uncertain:${requestId}`,
          message: `에이전트 충전 반영 불확실(커밋 응답 유실) — 절대합 ${absBatch.toLocaleString()}원 ${parsed.charges.length}건 (by ${requestedBy || 'unknown'}) 사유: ${reason}. 이력 확인 후 해소 필요`,
          cooldownMs: 1000,
        }).catch(() => { /* 미설정/실패 시 조용히 생략 */ });
        return res.status(502).json({
          uncertain: true,
          requestId,
          error: '커밋 응답 유실 — 반영 여부 불확실. 같은 요청을 새로 넣지 말고, 아래 이력에서 해당 발송ID의 최신 행을 먼저 확인하세요.',
        });
      }
      // 커밋 전 실패 = MySQL 롤백 확정(충전 0건) — 예약 해제해 같은 키 재시도 허용
      await query(`DELETE FROM agent_charge_requests WHERE id = $1 AND status = 'reserved'`, [requestId]);
      throw mysqlErr;
    }

    // 충전은 이미 확정 — 확정 기록(PG) 실패로 500을 내면 프론트가 새 키로 재시도해 이중 충전된다(Codex 8R-1b). 로그만 남기고 201 유지.
    // ★status='reserved' 가드(Codex 12R-2): 이 요청이 그 사이 uncertain/not_applied로 전이됐다면 registered로 되돌리지 않는다
    //   (해소된 건을 늦은 확정이 뒤집어 이중 충전 회계를 만드는 경로 차단).
    try {
      const book = await query(
        `UPDATE agent_charge_requests SET charges = $2::jsonb, status = 'registered' WHERE id = $1 AND status = 'reserved'`,
        [requestId, JSON.stringify(registered.map((r) => ({ seqNo: r.seqNo, agentSendId: r.agentSendId, amount: r.amount, applied: false })))]
      );
      if ((book.rowCount ?? 0) === 0) {
        console.warn(`[agent-charges] 확정 기록 skip — 요청 ${requestId}이 이미 reserved가 아님(uncertain/not_applied 전이됨). 충전은 성공했으므로 이력에서 확인 필요`);
      }
    } catch (bookErr) {
      console.error('[agent-charges] 확정 기록 실패(충전은 성공·멱등 예약 유지 — 이력에서 확인 가능):', bookErr);
    }

    // ★ 2026-07-27 §5-4 — 이 실행이 고객사 충전 요청에서 온 것이면 그 요청을 '처리 중'으로 잇는다.
    //   'fulfilled'(완료)로 바로 넘기지 않는 이유: 지금은 게이트웨이 등록만 끝났고 반영(RsApplyFlag='Y')은
    //   아직이다. 완료 표시는 status 폴링이 반영을 확인한 뒤에만 한다(6원칙 ②).
    //   충전은 이미 확정됐으므로 이 연결이 실패해도 500을 내지 않는다 — 실패 시 요청은 pending으로 남고
    //   운영자가 다시 실행하려 하면 중복 등록이 아니라 "이미 충전됨"을 이력에서 확인하게 된다.
    if (Array.isArray((req.body as any)?.orderIds) && (req.body as any).orderIds.length > 0) {
      try {
        const orderIds = ((req.body as any).orderIds as any[])
          .map((v) => String(v || '').trim())
          .filter((v) => /^[0-9a-fA-F-]{36}$/.test(v));
        if (orderIds.length > 0) {
          const linked = await query(
            `UPDATE agent_charge_orders
                SET status = 'processing', charge_request_id = $2, resolved_by = $3, resolved_at = NOW()
              WHERE id = ANY($1::uuid[]) AND status = 'pending' AND agent_send_id = ANY($4)`,
            [orderIds, requestId, requestedBy || null, registered.map((r) => r.agentSendId)]
          );
          console.log(`[agent-charges] 충전 요청 ${linked.rowCount ?? 0}건을 처리 중으로 연결 (req ${requestId})`);
        }
      } catch (linkErr) {
        console.error('[agent-charges] 충전 요청 연결 실패(충전은 성공 — 요청은 대기로 남음):', linkErr);
      }
    }

    // 고액 배치(절대합 5천만+) 즉시 알림 — 단독 운영 통제 보강(Codex 9R). 알림 실패는 충전 결과 무영향
    if (absBatch >= 50_000_000) {
      sendSystemAlert({
        dedupKey: `agent-charge-high:${requestId}`,
        message: `에이전트 고액 충전 등록 — 절대합 ${absBatch.toLocaleString()}원 ${registered.length}건 (by ${requestedBy || 'unknown'}) 사유: ${reason}`,
        cooldownMs: 1000,
      }).catch(() => { /* 미설정/실패 시 조용히 생략 */ });
    }

    console.log(`[agent-charges] 등록 ${registered.length}건 (req ${requestId} · SeqNo ${registered.map((r) => r.seqNo).join(',')}) by ${requestedBy || 'unknown'} — ${reason}`);
    return res.status(201).json({
      requestId,
      registered: registered.map((r) => ({ seqNo: r.seqNo, agentSendId: r.agentSendId, amount: r.amount, applied: false })),
    });
  } catch (error: any) {
    console.error('에이전트 충전 등록 실패:', error);
    const msg = String(error?.message || '');
    if (msg === 'PAY_STATS_DB_NOT_CONFIGURED') {
      return res.status(503).json({ error: '게이트웨이 통계 DB(env paystats) 미설정 — 충전 실행 불가' });
    }
    if (msg.toLowerCase().includes('command denied')) {
      return res.status(503).json({
        error: '충전용 쓰기 권한 없음 — 운영자에게 pay-ingest-db 계정 GRANT INSERT(sales.RSRM_FillAmtHist) 실행 요청',
        code: 'DB_GRANT_PENDING',
      });
    }
    if (handleDbMigrationError(error, res, 'agent_charge_requests')) return;
    return res.status(500).json({ error: '충전 등록 실패' });
  }
});

// 반영 불확실 해소 — 슈퍼관리자가 이력 확인 후 확정 (★서버 전역 게이트의 유일한 해제 경로, Codex 10R-1a)
//   confirmed = 실반영 확인됨 → registered(일 한도 계속 집계) / not_applied = 미반영 확인됨 → not_applied(집계 제외)
router.post('/agent-charges/:requestId/resolve', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { requestId } = req.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) {
      return res.status(400).json({ error: 'requestId(uuid)가 필요합니다.' });
    }
    const outcome = String((req.body as any)?.outcome || '');
    if (!['confirmed', 'not_applied'].includes(outcome)) {
      return res.status(400).json({ error: "outcome은 'confirmed' 또는 'not_applied'만 허용됩니다." });
    }
    // 해소 사유(메모) 필수 — 감사 기록(Codex 11R·12R). 프론트도 항상 전송.
    const note = String((req.body as any)?.note || '').trim().slice(0, 200);
    if (!note) {
      return res.status(400).json({ error: '해소 사유(메모)를 입력하세요.' });
    }

    // 대상 행 로드 — 미확정(uncertain 또는 seqNo 없는 reserved) 중 "요청 후 3분 경과"만(Codex 15R).
    //   ★uncertain에도 reserved와 동일하게 3분 숙성 적용: 데드라인(60s)에 destroy해도 서버측 커밋이 graceful
    //   half-close로 나중에 완료될 수 있으므로, 3분 지나 트랜잭션이 확실히 확정된 뒤에만 게이트웨이 대조·해소한다.
    //   즉 정확성은 destroy의 즉시성이 아니라 "3분 유예 + findGatewayCharges 대조"가 보장한다.
    const rowRes = await query(
      `SELECT id, charges, created_at, status FROM agent_charge_requests
        WHERE id = $1
          AND created_at < now() - interval '3 minutes'
          AND (status = 'uncertain'
               OR (status = 'reserved' AND (charges->0->>'seqNo') IS NULL))`,
      [requestId]
    );
    if (rowRes.rows.length === 0) {
      return res.status(404).json({ error: '해소 대상(3분 경과 미확정) 상태의 요청이 아닙니다. 잠시 후 다시 시도하세요.' });
    }
    const rowCharges: any[] = Array.isArray(rowRes.rows[0].charges) ? rowRes.rows[0].charges : [];

    // ★ not_applied는 게이트웨이 실행 대조 후에만(Codex 11R-2): 요청 시각 ±10분 창에 (발송ID, 금액) 대응 행이
    //   실존하면 거부 — 실반영 충전을 미반영으로 지워 일 한도 회계를 왜곡하는 경로 차단. 대조 불가 = fail-closed 보류.
    if (outcome === 'not_applied') {
      let matches;
      try {
        matches = await findGatewayCharges(
          rowCharges.map((c) => ({ agentSendId: String(c?.agentSendId || '').trim(), amount: Number(c?.amount) })),
          new Date(rowRes.rows[0].created_at),
          10
        );
      } catch (probeErr) {
        console.error('[agent-charges] 게이트웨이 대조 불가(해소 보류):', probeErr);
        return res.status(503).json({ error: '게이트웨이 대조 불가 — 미반영 확정을 보류합니다. 잠시 후 다시 시도하세요.' });
      }
      if (matches.length > 0) {
        return res.status(400).json({
          error: `게이트웨이에 대응 충전 행이 실존합니다(SeqNo ${matches.map((m) => m.seqNo).join(',')}) — 미반영 처리 불가. "실반영 확인됨"으로 해소하세요.`,
        });
      }
    }

    const next = outcome === 'confirmed' ? 'registered' : 'not_applied';
    // 효과 검증: 해소 대상 상태였던 행만 전이 — RETURNING으로 실제 갱신 확정. 해소 주체·시각·메모 영속(Codex 11R)
    const r = await query(
      `UPDATE agent_charge_requests
          SET status = $2, resolved_by = $3, resolved_at = now(), resolve_note = $4
        WHERE id = $1
          AND created_at < now() - interval '3 minutes'
          AND (status = 'uncertain'
               OR (status = 'reserved' AND (charges->0->>'seqNo') IS NULL))
        RETURNING id`,
      [requestId, next, String((req as any).user?.userId || ''), note]
    );
    if (r.rows.length === 0) {
      return res.status(409).json({ error: '이미 다른 세션에서 해소된 요청입니다.' });
    }
    console.log(`[agent-charges] 불확실 해소 ${requestId} → ${next} by ${(req as any).user?.userId || 'unknown'}${note ? ` — ${note}` : ''}`);
    return res.json({ resolved: true, status: next });
  } catch (error: any) {
    console.error('에이전트 충전 불확실 해소 실패:', error);
    if (handleDbMigrationError(error, res, 'agent_charge_requests')) return;
    return res.status(500).json({ error: '해소 처리 실패' });
  }
});

/**
 * ★ 2026-07-27 §5-4 — 이 실행에 연결된 고객사 충전 요청을 '완료'로 종결한다.
 * **전건 반영(applied=true)일 때만** 부른다 — 등록만으로 완료 표시하면 시스템이 거짓말한다(6원칙 ②).
 * 실패해도 조회 응답을 막지 않는다(다음 폴링이 다시 시도한다).
 */
async function settleLinkedChargeOrders(requestId: string, rows: Array<{ applied?: boolean }>): Promise<void> {
  if (rows.length === 0 || !rows.every((r) => !!r.applied)) return;
  try {
    const r = await query(
      `UPDATE agent_charge_orders
          SET status = 'fulfilled', resolved_at = NOW()
        WHERE charge_request_id = $1 AND status = 'processing'`,
      [requestId]
    );
    if ((r.rowCount ?? 0) > 0) {
      console.log(`[agent-charges] 충전 요청 ${r.rowCount}건 완료 처리 (req ${requestId})`);
    }
  } catch (err) {
    console.error('[agent-charges] 충전 요청 완료 처리 실패(조회는 계속 — 다음 폴링이 재시도):', err);
  }
}

// 반영 상태 폴링 — requestId 기준(우리가 발행한 요청의 SeqNo만 조회 — 임의 SeqNo 탐색 차단, Codex 7R).
// applied=true(RsApplyFlag='Y')만 성공 신호 (6원칙 ②)
router.get('/agent-charges/status', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const requestId = String(req.query.requestId || '').trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) {
      return res.status(400).json({ error: 'requestId(uuid)가 필요합니다.' });
    }
    const reqRow = await query(`SELECT charges, status, created_at FROM agent_charge_requests WHERE id = $1`, [requestId]);
    if (reqRow.rows.length === 0) {
      return res.status(404).json({ error: '요청을 찾을 수 없습니다.' });
    }
    const charges: any[] = Array.isArray(reqRow.rows[0].charges) ? reqRow.rows[0].charges : [];
    let seqNos = charges.map((c) => Number(c?.seqNo)).filter((n) => Number.isInteger(n) && n > 0);

    // 확정 기록 유실 복구(Codex 9R-1b): 충전은 성공했는데 PG 확정 UPDATE만 실패한 요청(status='reserved'에 seqNo 없음)은
    // 클라이언트가 201 응답으로 보유한 seqNos를 수용해 조회하고, MySQL 실값으로 PG를 자가 복구한다.
    // ★수용 조건(Codex 10R-1b): MySQL 실행의 (발송ID, 금액) 다중집합이 예약 시 저장한 charges와 정확히 일치할 때만 —
    //   다른 충전의 SeqNo를 주입해 요청↔충전 원장 연결을 오염시키는 경로 차단. 복구 UPDATE는 rowCount 확인(레이스 패배 시 이긴 값 재조회).
    if (seqNos.length === 0 && String(reqRow.rows[0].status) === 'reserved') {
      const fallback = String(req.query.seqNos || '')
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0)
        .slice(0, 50);
      if (fallback.length > 0) {
        const mysqlRows = await getAgentChargeStatus(fallback);
        // 시간창 상관 + 다중집합 일치(Codex 11R-1b·12R): 요청 created_at −2분 ~ +10분 안 입력분만 후보.
        // filledAtMs = mysql2 Date 객체 epoch 정규화(String() 파싱 실버그 제거 — Codex 12R-3).
        const centerMs = new Date(reqRow.rows[0].created_at).getTime();
        const inWindow = matchHealWindow(
          charges.map((c) => ({ agentSendId: String(c?.agentSendId || '').trim(), amount: Number(c?.amount) })),
          mysqlRows, centerMs, 2, 10,
        );
        if (inWindow) {
          try {
            const heal = await query(
              `UPDATE agent_charge_requests SET charges = $2::jsonb, status = 'registered' WHERE id = $1 AND status = 'reserved'`,
              [requestId, JSON.stringify(inWindow.map((r) => ({ seqNo: r.seqNo, agentSendId: r.agentSendId, amount: r.amount, applied: r.applied })))]
            );
            if ((heal.rowCount ?? 0) > 0) {
              console.log(`[agent-charges] 확정 기록 자가 복구 (req ${requestId} · SeqNo ${inWindow.map((r) => r.seqNo).join(',')})`);
              await settleLinkedChargeOrders(requestId, inWindow);
              return res.json({ rows: inWindow });
            }
          } catch (healErr) {
            // 복구 쓰기 실패 — 검증 통과한 행 조회 결과는 그대로 응답(다음 폴링이 재시도)
            console.error('[agent-charges] 자가 복구 실패(조회는 계속):', healErr);
            return res.json({ rows: inWindow });
          }
          // 레이스 패배 — 이긴 쪽이 저장한 seqNos 재조회. 재조회 실패 = fail-closed 빈 rows(Codex 11R-1b)
          try {
            const re = await query(`SELECT charges FROM agent_charge_requests WHERE id = $1`, [requestId]);
            const reCharges: any[] = Array.isArray(re.rows[0]?.charges) ? re.rows[0].charges : [];
            seqNos = reCharges.map((c: any) => Number(c?.seqNo)).filter((n: number) => Number.isInteger(n) && n > 0);
          } catch {
            return res.json({ rows: [] });
          }
        }
        // 불일치 = 수용 거부(빈 rows 경로) — 임의 SeqNo 주입 차단
      }
    }

    if (seqNos.length === 0) {
      return res.json({ rows: [] });
    }
    const rows = await getAgentChargeStatus(seqNos);
    await settleLinkedChargeOrders(requestId, rows);
    return res.json({ rows });
  } catch (error: any) {
    console.error('에이전트 충전 상태 조회 실패:', error);
    if (handleDbMigrationError(error, res, 'agent_charge_requests')) return;
    return res.status(500).json({ error: '상태 조회 실패' });
  }
});

// 최근 충전 이력 (회사명은 PG 매핑으로 라벨링 — 매핑 없는 ID는 고아 표시)
router.get('/agent-charges', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    // ★ 2026-07-26 발송ID·기간 필터 + 페이징 — 이력이 길게 나열돼 읽기 어렵다는 운영 지적.
    const filter = {
      agentSendId: typeof req.query.agentSendId === 'string' ? req.query.agentSendId : undefined,
      startDate: typeof req.query.startDate === 'string' ? req.query.startDate : undefined,
      endDate: typeof req.query.endDate === 'string' ? req.query.endDate : undefined,
    };
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 200);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const [rows, total, latestFilledAt] = await Promise.all([
      listAgentCharges({ ...filter, limit, offset: (page - 1) * limit }),
      countAgentCharges(filter),
      latestAgentChargeAt(),
    ]);
    const ids = Array.from(new Set(rows.map((r) => r.agentSendId).filter(Boolean)));
    const nameMap = new Map<string, string>();
    if (ids.length > 0) {
      const named = await query(
        `SELECT cai.agent_send_id, c.company_name FROM company_agent_ids cai JOIN companies c ON c.id = cai.company_id WHERE cai.agent_send_id = ANY($1)`,
        [ids]
      );
      for (const r of named.rows as any[]) nameMap.set(String(r.agent_send_id), String(r.company_name || ''));
    }
    // ★ 2026-07-27 발급명 동반. 게이트웨이 원장 기준이라 **우리 매핑에 없는 고아 발송ID도 이름이 나온다**
    //   (C0119 = 준네트웍스_미1) — "매핑 없음"만 뜨던 행이 무엇인지 화면에서 바로 읽힌다.
    const custNameMap = await getAgentCustNameMap();
    return res.json({
      rows: rows.map((r: any) => ({
        ...r,
        companyName: nameMap.get(r.agentSendId) || null,
        custName: custNameMap.get(String(r.agentSendId)) || null,
      })),
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      // ★ 2026-07-26 원장 유입이 멈췄는지 화면이 알 수 있게 함께 내린다(필터 무관 전체 최신).
      latestFilledAt,
    });
  } catch (error) {
    console.error('에이전트 충전 이력 조회 실패:', error);
    return res.status(500).json({ error: '이력 조회 실패' });
  }
});

// ===== ★ 2026-07-27 §5-4 — 고객사 충전 요청 처리 (슈퍼관리자) =====

// 요청 목록 — 기본 pending. 실행은 이 목록에서 [실행]을 눌러 §5-3 폼이 채워지는 방식이다.
router.get('/agent-charge-orders', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const status = String(req.query.status || 'pending').trim();
    const allowed = ['pending', 'processing', 'fulfilled', 'rejected', 'all'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: '조회할 수 없는 상태입니다.' });
    }
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 200);
    const page = Math.max(Number(req.query.page) || 1, 1);

    const where = status === 'all' ? '' : 'WHERE o.status = $1';
    const params: any[] = status === 'all' ? [] : [status];

    const cnt = await query(`SELECT COUNT(*)::int AS n FROM agent_charge_orders o ${where}`, params);
    const total = Number(cnt.rows[0]?.n || 0);

    const rows = await query(
      `SELECT o.id, o.company_id, o.agent_send_id, o.amount, o.depositor_name, o.expected_at,
              o.memo, o.status, o.reject_reason, o.created_at, o.resolved_at, c.company_name
         FROM agent_charge_orders o
         JOIN companies c ON c.id = o.company_id
         ${where}
        ORDER BY o.created_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, (page - 1) * limit]
    );

    // ★ 2026-07-27 접수함도 같은 이름 규칙(발송ID / 발급명) — 직원이 폼에 담기 전에 어느 계정인지 읽어야 한다.
    const custNameMap = await getAgentCustNameMap();
    return res.json({
      rows: rows.rows.map((x: any) => ({
        id: String(x.id),
        companyId: String(x.company_id),
        companyName: x.company_name,
        agentSendId: String(x.agent_send_id),
        custName: custNameMap.get(String(x.agent_send_id)) || null,
        amount: Number(x.amount),
        depositorName: x.depositor_name,
        expectedAt: x.expected_at ? String(x.expected_at).slice(0, 10) : null,
        memo: x.memo,
        status: String(x.status),
        rejectReason: x.reject_reason,
        createdAt: x.created_at,
        resolvedAt: x.resolved_at,
      })),
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error: any) {
    console.error('충전 요청 목록 조회 실패:', error);
    if (handleDbMigrationError(error, res, 'agent_charge_orders')) return;
    return res.status(500).json({ error: '충전 요청 목록 조회 실패' });
  }
});

// 요청 반려 — 사유 필수(고객사 화면에 그대로 표시된다). pending만 반려 가능.
router.post('/agent-charge-orders/:id/reject', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return res.status(400).json({ error: '요청 id(uuid)가 올바르지 않습니다.' });
    }
    const parsed = parseRejectReason(req.body);
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });

    // status='pending' 가드 = 이미 실행된(processing) 건을 반려로 덮어 회계가 어긋나는 경로 차단
    const upd = await query(
      `UPDATE agent_charge_orders
          SET status = 'rejected', reject_reason = $2, resolved_by = $3, resolved_at = NOW()
        WHERE id = $1 AND status = 'pending'`,
      [id, parsed.reason, String((req as any).user?.userId || '') || null]
    );
    if ((upd.rowCount ?? 0) === 0) {
      return res.status(409).json({ error: '접수 대기 상태의 요청만 반려할 수 있습니다. (이미 처리됐거나 반려된 건)' });
    }
    console.log(`[agent-charge-orders] 반려 ${id} — ${parsed.reason}`);
    return res.json({ message: '반려 처리되었습니다.' });
  } catch (error: any) {
    console.error('충전 요청 반려 실패:', error);
    if (handleDbMigrationError(error, res, 'agent_charge_orders')) return;
    return res.status(500).json({ error: '반려 처리 실패' });
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

// ===== 베스트 문안(업종 큐레이션 시드) — 슈퍼관리자 공용(직원 큐레이션) =====
// ★ 2026-07-04 재설계(Harold 명시): 학습 페이지 채굴 모달 폐기 → 별도 메뉴.
//   직원 직접 입력 + AI 전수 채굴(best-copy-miner) 병행. ceo 게이트 없음(학습 overview만 ceo 전용 유지).
//   저장분(sentinel tenant)만 Track B(브랜드보이스 미등록) 생성 참고 원문으로 서빙.

const SEED_GATE_MESSAGES: Record<SeedGateFail, string> = {
  too_short: '저장할 수 없습니다 — 연락처·주소 등 자동 제거 후 12자 이상이어야 합니다.',
  leak: '전화번호·URL·이메일 등 개인정보/식별 정보가 남아 있습니다. 제거 후 저장해주세요.',
  spam: '스팸 위험 표현이 많아 시드로 저장할 수 없습니다. 표현을 다듬어주세요.',
  duplicate: '동일한 문안이 이미 저장되어 있습니다.',
  not_found: '대상 문안을 찾을 수 없습니다.',
};

const SEED_CHANNELS = ['SMS', 'LMS', 'MMS', 'KAKAO'];

function parseSeedBody(body: any): { text: string; industryCode: string; messageType: string; isAd: boolean } | null {
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  const industryCode = String(body?.industryCode || '').trim();
  const messageType = String(body?.messageType || '').trim().toUpperCase();
  if (!text || !isIndustryCode(industryCode) || !SEED_CHANNELS.includes(messageType)) return null;
  return { text, industryCode, messageType, isAd: body?.isAd === true };
}

router.get('/best-copy/list', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const industryCode = String(req.query.industryCode || '').trim() || undefined;
    const [seeds, counts, stats] = await Promise.all([
      listCuratedSeeds(industryCode),
      listCuratedSeedCounts(),
      getSeedUsageStats(), // 테이블 미생성 시 빈 맵(42P01 degrade)
    ]);
    // 업종 목록 SSOT = industry-codes.ts (프론트 하드코딩 금지)
    const industries = INDUSTRY_CODES.map((code) => ({ code, label: INDUSTRY_LABELS[code], count: counts[code] || 0 }));
    // ★ 2026-07-04 성과 환류: 카드 뱃지용 — 참고 횟수(정확) + 참고 후 7일 발송 성공률(근사)
    const seedsWithStats = seeds.map((s) => ({ ...s, usage: stats[s.id] || null }));
    // 업종 지정 시 공식 + 재창작 예시 동봉(관리자 패널)
    let formula = null; let styleExamples: any[] = [];
    if (industryCode) {
      formula = await getIndustryFormula(industryCode);
      styleExamples = await listStyleExamples(industryCode);
    }
    res.json({ success: true, seeds: seedsWithStats, industries, formula, styleExamples });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || '조회 실패' });
  }
});

// ★ 2026-07-04 공식 증류 — 업종 시드 → 승리 공식 + 스타일 예시 재창작(유사도 가드). 직원 1클릭.
router.post('/best-copy/formula/refresh', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const industryCode = String(req.body?.industryCode || '').trim();
    if (!isIndustryCode(industryCode)) return res.status(400).json({ error: '업종을 선택해주세요.' });
    const r = await distillIndustryFormula(industryCode);
    if (!r.ok) {
      const msg = r.reason === 'insufficient_seeds'
        ? '시드가 3건 이상 필요합니다. 먼저 베스트 문안을 채워주세요.'
        : r.reason === 'table_missing'
          ? 'DB 마이그레이션 필요 — 운영자에게 best_copy_assets 테이블 생성 요청이 필요합니다.'
          : 'AI 응답 해석에 실패했습니다. 다시 시도해주세요.';
      return res.status(r.reason === 'table_missing' ? 503 : 400).json({ error: msg, code: r.reason === 'table_missing' ? 'DB_MIGRATION_PENDING' : r.reason });
    }
    res.json({ success: true, formula: r.formula, exampleCount: r.exampleCount, discardedBySimilarity: r.discardedBySimilarity });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || '공식 갱신 실패' });
  }
});

router.post('/best-copy/save', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const item = parseSeedBody(req.body);
    if (!item) return res.status(400).json({ error: '문안·업종·채널을 확인해주세요.' });
    const r = await saveCuratedSeedOne(item);
    if (!r.ok) return res.status(400).json({ error: SEED_GATE_MESSAGES[r.reason] });
    res.json({ success: true, text: r.text });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || '저장 실패' });
  }
});

router.put('/best-copy/:id', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const item = parseSeedBody(req.body);
    if (!item) return res.status(400).json({ error: '문안·업종·채널을 확인해주세요.' });
    const r = await updateCuratedSeed(String(req.params.id), item);
    if (!r.ok) return res.status(400).json({ error: SEED_GATE_MESSAGES[r.reason] });
    res.json({ success: true, text: r.text });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || '수정 실패' });
  }
});

router.delete('/best-copy/:id', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const ok = await deleteCuratedSeed(String(req.params.id));
    res.json({ success: ok });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || '삭제 실패' });
  }
});

// AI 전수 채굴 — 업종 학습 코퍼스 전건 AI 판정(백그라운드 잡 + 진행률 폴링)
router.post('/best-copy/mine', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const industryCode = String(req.body?.industryCode || '').trim();
    if (!isIndustryCode(industryCode)) return res.status(400).json({ error: '업종을 선택해주세요.' });
    const r = startMiningJob(industryCode);
    res.json({ success: true, already: r.already === true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || '채굴 시작 실패' });
  }
});

router.get('/best-copy/mine/status', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const industryCode = String(req.query.industryCode || '').trim();
    if (!isIndustryCode(industryCode)) return res.status(400).json({ error: '업종을 선택해주세요.' });
    const job = getMiningJob(industryCode);
    if (!job) return res.json({ success: true, status: 'none' });
    res.json({
      success: true,
      status: job.status,
      totalMessages: job.totalMessages,
      totalBatches: job.totalBatches,
      processedBatches: job.processedBatches,
      failedBatches: job.failedBatches,
      candidates: job.status === 'done' ? job.candidates : [],
      error: job.error || null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || '상태 조회 실패' });
  }
});

router.post('/best-copy/mine/approve', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const industryCode = String(req.body?.industryCode || '').trim();
    if (!isIndustryCode(industryCode)) return res.status(400).json({ error: '업종을 선택해주세요.' });
    const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
    const items = rawItems
      .filter((it: any) => it && typeof it.text === 'string' && it.text.trim() && SEED_CHANNELS.includes(String(it.messageType || '').toUpperCase()))
      .map((it: any) => ({
        text: String(it.text),
        industryCode,
        messageType: String(it.messageType).toUpperCase(),
        isAd: it.isAd !== false, // 채굴 승인분 기본 = 마케팅(광고성)
      }));
    if (items.length === 0) return res.status(400).json({ error: '승인할 항목이 없습니다.' });
    const inserted = await insertCuratedSeeds(items);
    // ★ 2026-07-04: 승인 저장 직후 공식·예시 자동 갱신(fire-and-forget — 응답 지연 0)
    if (inserted > 0) void distillIndustryFormula(industryCode).catch(() => {});
    res.json({ success: true, inserted });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || '저장 실패' });
  }
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
// ★ 2026-07-17: 조회는 슈퍼관리자 공용 유지 — 고객사/사용자 편집 모달의 발송 라인 드롭다운이 이 API를 쓴다.
//   쓰기 권한(canManage)만 실어 보내 프론트가 관리 탭 노출을 판정한다(허용 목록 단일 소스 = 백엔드 ENV).
router.get('/line-groups', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const result = await query(`
      SELECT lg.*,
        (SELECT COUNT(*) FROM companies c WHERE c.line_group_id = lg.id) as company_count
      FROM sms_line_groups lg
      ORDER BY lg.sort_order, lg.created_at
    `);
    res.json({ lineGroups: result.rows, canManage: await isLineGroupAdmin(req.user?.userId) });
  } catch (error) {
    console.error('라인그룹 목록 조회 실패:', error);
    res.status(500).json({ error: '조회 실패' });
  }
});

// POST /api/admin/line-groups - 라인그룹 생성
router.post('/line-groups', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    // ★ 2026-07-17: 라인 설정 쓰기 = LINE_GROUP_ADMIN_USERS(기본 ceo,admin)만 (Harold 명시)
    if (!(await isLineGroupAdmin(req.user?.userId))) {
      return res.status(403).json({ error: '발송 라인 설정 권한이 없습니다.' });
    }
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
    // ★ 2026-07-17: 실존 검증 — 패턴만 맞는 오타 테이블이 라인에 들어가면 그 라인의 적재·집계·정산이 전부 SQL 에러
    const missingTables = await findMissingSmsTables(smsTables);
    if (missingTables.length > 0) {
      return res.status(400).json({ error: `MySQL smsdb에 없는 테이블입니다: ${missingTables.join(', ')}` });
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
    // ★ 2026-07-17: 라인 설정 쓰기 = LINE_GROUP_ADMIN_USERS(기본 ceo,admin)만 (Harold 명시)
    if (!(await isLineGroupAdmin(req.user?.userId))) {
      return res.status(403).json({ error: '발송 라인 설정 권한이 없습니다.' });
    }
    const { id } = req.params;
    const { groupName, groupType, smsTables, sortOrder, isActive } = req.body;
    // ★ P0-Q1: SQL Injection 방지 — 테이블명 화이트리스트 검증
    if (smsTables) {
      try {
        validateSmsTables(smsTables);
      } catch (err) {
        return res.status(400).json({ error: `잘못된 테이블명: ${err instanceof Error ? err.message : String(err)}` });
      }
      // ★ 2026-07-17: 실존 검증 — 패턴만 맞는 오타 테이블이 라인에 들어가면 그 라인의 적재·집계·정산이 전부 SQL 에러
      const missingTables = await findMissingSmsTables(smsTables);
      if (missingTables.length > 0) {
        return res.status(400).json({ error: `MySQL smsdb에 없는 테이블입니다: ${missingTables.join(', ')}` });
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
    // ★ 2026-07-17: 라인 설정 쓰기 = LINE_GROUP_ADMIN_USERS(기본 ceo,admin)만 (Harold 명시)
    if (!(await isLineGroupAdmin(req.user?.userId))) {
      return res.status(403).json({ error: '발송 라인 설정 권한이 없습니다.' });
    }
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
// ★ 2026-07-24 (서수란) 슈퍼 에이전트(엔진) 발송통계 엑셀(CSV) — 기간×고객사×발송ID×대상ID×유형 (2026-07-25 #2 대상ID 분해).
//   기존 웹 /stats/export(캠페인 축)는 무접촉. 날짜는 검증기가 정규화한 값을 전달(queryPayAgentStoreBreakdown이 월 확장 자체 수행).
router.get('/stats/export/agent', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, companyId } = req.query;
    const view = (req.query.view as string) === 'monthly' ? 'monthly' : 'daily';
    // 형식·순서·상한까지 검증 — 잘못된 값이 조용히 무제한 조회로 새는 것 차단(대상ID 그레인은 카디널리티가 높다)
    const dateCheck = validateStatsDateRange(startDate as string, endDate as string);
    if (!dateCheck.ok) {
      return res.status(400).json({ error: dateCheck.error });
    }
    if (!isPayStatsConfigured()) {
      return res.status(503).json({ error: '에이전트 통계 DB가 설정되지 않아 다운로드할 수 없습니다.', code: 'PAY_STATS_NOT_CONFIGURED' });
    }
    // 정규화된 날짜를 조회·파일명 전 경로에 사용(공백 낀 원본이 월 확장에서 깨지는 것 차단)
    const from = dateCheck.startDate;
    const to = dateCheck.endDate;
    // ★ 2026-07-25 (#2) 슈퍼 CSV = 대상ID(StoreId)별 분해(기간×고객사×발송ID×대상ID×유형). 화면 GET은 queryPayAgentStatsAllCompanies(집계) 유지.
    const storeRows = await queryPayAgentStoreBreakdown({
      scope: 'admin',
      view,
      startDate: from,
      endDate: to,
      companyId: companyId ? String(companyId) : undefined,
    });
    // null(조회 실패) ≠ [](정상 0건) — 실패를 빈 CSV로 내면 정산 과소집계로 오인
    if (storeRows === null) {
      return res.status(503).json({ error: '에이전트 통계 조회에 실패했습니다. 잠시 후 다시 시도해주세요.', code: 'PAY_STATS_QUERY_FAILED' });
    }
    // ★ 2026-07-25 CSV → 엑셀(.xlsx). 고객사 발송통계와 같은 행 빌더·같은 서식을 쓴다.
    const buf = await buildAdminAgentStatsXlsx(storeRows, {
      title: `에이전트 발송통계 ${from} ~ ${to}`,
      caption: '기간 × 고객사 × 발송ID × 대상ID × 유형 · 청구 기준 집계(성공 건수가 과금 대상)',
    });
    const filename = `에이전트발송통계_${from}_${to}.xlsx`;
    res.setHeader('Content-Type', XLSX_CONTENT_TYPE);
    res.setHeader('Content-Disposition', xlsxContentDisposition(filename));
    return res.send(buf);
  } catch (error) {
    console.error('에이전트 발송통계 엑셀 export 실패:', error);
    return res.status(500).json({ error: '다운로드에 실패했습니다.' });
  }
});

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
    // ★ 2026-07-30: 브랜드 행(msg_type='F')이 SMSQ 합류 — getCampaignResultCounts가 전 채널을 담는다.
    const exportResultMap = await getCampaignResultCounts(exportMetaResult.rows);
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
      if (c.send_channel === 'alimtalk') {
        const split = exportSplitMap.get(c.id);
        const a = split?.alimtalk ?? { total: 0, success: 0, fail: 0, pending: 0 };
        const sLms = split?.substitute_lms ?? { total: 0, success: 0, fail: 0, pending: 0 };
        const sSms = split?.substitute_sms ?? { total: 0, success: 0, fail: 0, pending: 0 };
        // 알림톡 행 — SMS 큐 K 실측(옛 카카오 IMC 합산은 2026-07-30 폐기 — 항상 0이었다). 대상건수는 여기에 귀속.
        addExportBucket(c, 'alimtalk', '알림톡', Number(c.target_count || 0),
          a.total, a.success, a.fail, a.pending);
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

    // ★ 2026-07-25 CSV → 엑셀(.xlsx). Harold 지시 + LESSONS_BACKEND "고객 대상 xlsx = exceljs".
    //   수량 열이 실제 숫자로 들어가 합계·필터가 바로 먹는다(CSV는 문자로 읽혀 안 됐다).
    const xlsxRows: Array<Array<string | number>> = result.rows.map((r: any) => [
      r.send_date,
      r.company_code || '',
      r.company_name || '',
      r.login_id || '-',
      r.user_name || '-',
      r.channel_label,
      sendTypeLabel(r.send_type),
      Number(r.campaign_count) || 0,
      Number(r.total_target) || 0,
      Number(r.total_sent) || 0,
      Number(r.total_success) || 0,
      Number(r.total_fail) || 0,
      Math.max(0, Number(r.total_pending) || 0),
    ]);

    const buf = await buildXlsxBuffer({
      sheetName: '발송통계',
      title: `발송통계(슈퍼관리자) ${startDate} ~ ${endDate}`,
      // ★ 축을 파일에 명시한다. 이건 계정·캠페인 단위 운영 뷰라 '문자타입'이 캠페인에 선언된 유형이고,
      //   큐 적재 시 SMS→LMS 자동 승격이 반영되지 않는다. 고객사 발송통계(청구 축)와 유형 분해가 다를 수 있어
      //   어느 파일로 대조해야 하는지를 파일 자체가 말하게 한다.
      caption: '캠페인·계정 단위 운영 집계 · 문자타입은 캠페인 선언 유형(큐 자동승격 미반영) · 청구 대조는 고객사 발송통계 또는 청구서를 사용하세요',
      columns: [
        { header: '발송일', width: 14 },
        { header: '회사코드', width: 14 },
        { header: '회사명', width: 24 },
        { header: '계정ID', width: 16 },
        { header: '사용자명', width: 14 },
        { header: '문자타입', width: 18 },
        { header: '발송유형', width: 12 },
        { header: '캠페인수', width: 12, numeric: true },
        { header: '대상건수', width: 12, numeric: true },
        { header: '전송건수', width: 12, numeric: true },
        { header: '성공', width: 12, numeric: true },
        { header: '실패', width: 12, numeric: true },
        { header: '대기', width: 12, numeric: true },
      ],
      rows: xlsxRows,
    });

    const filename = `발송통계_${startDate}_${endDate}.xlsx`;
    res.setHeader('Content-Type', XLSX_CONTENT_TYPE);
    res.setHeader('Content-Disposition', xlsxContentDisposition(filename));
    res.send(buf);
  } catch (error) {
    console.error('[Admin] 발송통계 엑셀 다운로드 실패:', error);
    res.status(500).json({ error: '다운로드에 실패했습니다.' });
  }
});

export default router;