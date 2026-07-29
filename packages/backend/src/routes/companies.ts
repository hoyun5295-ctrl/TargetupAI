import { Request, Response, Router } from 'express';
import nodemailer from 'nodemailer';
import pool, { query } from '../config/database';
// ★ 2026-07-20: 회사 생성 코어 CT(시스템 user·시퀀스 부속 포함) — POST /와 게이트웨이 bill 일괄 생성 공유
import { createCompanyCore } from '../utils/company-create';
import { authenticate, requireSuperAdmin, requireUuidId } from '../middlewares/auth';
import { getCardDef, isDynamicCardId, parseDynamicCardId, type ParsedDynamicCardId } from '../utils/dashboard-card-pool';
import { getStoreScope } from '../utils/store-scope';
import { getOpt080Number } from '../utils/messageUtils';
import { normalizeOpt080Input } from '../utils/normalize';
import { grantFreeTrial, isTrialApplyOpen } from '../utils/basic-trial';
// ★ 2026-07-25 요금제 변경 이력 CT — 청구서 일할계산의 진실의 원천(빠지면 그 구간이 증발)
import { recordPlanChange, alertPlanChangeFailure } from '../utils/plan-change-log';
import { parseAgentLedgerFields, parseAgentLedgerPatch, getAgentCustNameMap } from '../utils/pay-stats';

const router = Router();

// 모든 라우트에 인증 필요
router.use(authenticate);

// ⚠️ /settings 라우트를 /:id 보다 먼저 정의해야 함!
// 회사 설정 조회
router.get('/settings', authenticate, async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const userId = (req as any).user?.userId;
    const result = await query(`
      SELECT
        company_name, brand_name, business_type, reject_number, manager_phone,
        monthly_budget, cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao, cost_per_brand,
        send_start_hour, send_end_hour, daily_limit_per_customer,
        holiday_send_allowed, duplicate_prevention_days,
        target_strategy, cross_category_allowed, excluded_segments,
        approval_required, use_db_sync
      FROM companies WHERE id = $1
    `, [companyId]);

    // v1.5.0: 싱크 사용 중 여부 (프론트 SyncActiveBlockModal 표시용)
    // companies.use_db_sync=true AND active Agent 하나 이상 있으면 true
    const syncActive = await query(
      `SELECT 1 FROM sync_agents WHERE company_id = $1 AND status = 'active' LIMIT 1`,
      [companyId]
    );
    const syncBlockActive = !!result.rows[0]?.use_db_sync && syncActive.rows.length > 0;

    const row = result.rows[0] || {};
    // ★ D102: getOpt080Number 컨트롤타워 사용 (인라인 조회 제거)
    const userOpt080 = await getOpt080Number(userId || null, companyId);
    if (userOpt080) row.reject_number = userOpt080;
    // ★ D97: manager_contacts는 test_contacts 테이블로 완전 이관
    // settings 응답에서 제거 — 프론트는 /api/test-contacts API로만 담당자 관리
    delete row.manager_contacts;
    // manager_phone: JSON 문자열이면 파싱, 단일 번호면 배열로 변환
    if (row.manager_phone) {
      try {
        row.manager_phones = JSON.parse(row.manager_phone);
      } catch {
        // 기존 단일 번호 → 배열로 변환
        row.manager_phones = row.manager_phone ? [row.manager_phone] : [];
      }
    } else {
      row.manager_phones = [];
    }

    // 카카오 발신 프로필 목록도 함께 제공
    const kakaoProfilesResult = await query(
      `SELECT id, profile_key, profile_name, is_active FROM kakao_sender_profiles WHERE company_id = $1 AND is_active = true ORDER BY created_at ASC`,
      [companyId]
    );
    row.kakao_profiles = kakaoProfilesResult.rows;

    // v1.5.0: 싱크 차단 모달 판정 플래그
    row.sync_block_active = syncBlockActive;

    // ★ 2026-07-05 발송 피로도 보호 설정 — 별도 SELECT + try/catch (컬럼 미마이그레이션 42703이어도 기존 설정 조회 무영향)
    try {
      const fg = await query(`SELECT fatigue_cap_days, fatigue_cap_max FROM companies WHERE id = $1`, [companyId]);
      row.fatigue_cap_days = fg.rows[0]?.fatigue_cap_days ?? null;
      row.fatigue_cap_max = fg.rows[0]?.fatigue_cap_max ?? null;
    } catch {
      row.fatigue_cap_days = null;
      row.fatigue_cap_max = null;
    }

    res.json(row);
  } catch (error) {
    console.error('설정 조회 에러:', error);
    res.status(500).json({ error: '설정 조회 실패' });
  }
});

// 회사 설정 수정
router.put('/settings', authenticate, async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const userId = (req as any).user?.userId;
    const {
      brand_name, business_type, reject_number, manager_phones,
      monthly_budget,
      send_start_hour, send_end_hour, daily_limit_per_customer,
      holiday_send_allowed, duplicate_prevention_days,
      target_strategy, cross_category_allowed, excluded_segments,
      approval_required,
      // ★ 2026-07-05 발송 피로도 보호 — null 명시 = 해제(비활성). COALESCE 미사용 별도 UPDATE.
      fatigue_cap_days, fatigue_cap_max
    } = req.body;
    // ★ D97: manager_contacts는 test_contacts 테이블로 완전 이관
    // PUT /settings에서 manager_contacts 저장 로직 완전 제거
    // 담당자 추가/삭제는 /api/test-contacts API에서만 처리

    // manager_phones 배열 → JSON 문자열로 저장 (하위 호환)
    const managerPhoneJson = manager_phones ? JSON.stringify(manager_phones) : null;

    await query(`
      UPDATE companies SET
        brand_name = COALESCE($1, brand_name),
        business_type = COALESCE($2, business_type),
        reject_number = COALESCE($3, reject_number),
        opt_out_080_number = COALESCE($3, opt_out_080_number),
        manager_phone = COALESCE($4, manager_phone),
        monthly_budget = COALESCE($5, monthly_budget),
        cost_per_sms = COALESCE($6, cost_per_sms),
        cost_per_lms = COALESCE($7, cost_per_lms),
        cost_per_mms = COALESCE($8, cost_per_mms),
        cost_per_kakao = COALESCE($9, cost_per_kakao),
        send_start_hour = COALESCE($10, send_start_hour),
        send_end_hour = COALESCE($11, send_end_hour),
        daily_limit_per_customer = COALESCE($12, daily_limit_per_customer),
        holiday_send_allowed = COALESCE($13, holiday_send_allowed),
        duplicate_prevention_days = COALESCE($14, duplicate_prevention_days),
        target_strategy = COALESCE($15, target_strategy),
        cross_category_allowed = COALESCE($16, cross_category_allowed),
        excluded_segments = COALESCE($17, excluded_segments),
        approval_required = COALESCE($18, approval_required),
        updated_at = NOW()
      WHERE id = $19
    `, [
      brand_name, business_type, reject_number, managerPhoneJson,
      monthly_budget,
      // ★2026-07-26 단가 쓰기 경로 통합 — 고객사 설정 화면은 단가를 저장하지 않는다.
      //   단가는 계약 값이고 기준(unit_price_basis)과 원자적으로 써야 해서 슈퍼관리자 전용
      //   PUT /api/admin/companies/:id/unit-prices 하나로 좁혔다.
      null, null, null, null,
      send_start_hour, send_end_hour, daily_limit_per_customer,
      holiday_send_allowed, duplicate_prevention_days,
      target_strategy, cross_category_allowed, excluded_segments ? JSON.stringify(excluded_segments) : null,
      approval_required, companyId
    ]);

    // ★ 2026-06-23: 회사 설정 080 필드는 GET이 getOpt080Number(user 우선)로 표시한다(이 파일 GET:43).
    //   user에 080 오버라이드가 있으면 companies만 갱신해선 화면 값이 안 바뀜 = 삭제·수정 불가 사고(psy5868 0807196700, auto_sync).
    //   표시 소스와 일치하도록 현재 user의 opt_out_080_number도 함께 갱신/삭제(빈값/공백=삭제).
    //   기존 오버라이드(비어있지 않은 값)가 있는 user만 갱신 — 없던 user엔 신규 생성 X(회사 기본값 fallback 흐름 보존).
    if (userId && reject_number !== undefined) {
      await query(
        `UPDATE users SET opt_out_080_number = $1
           WHERE id = $2 AND COALESCE(opt_out_080_number, '') <> ''`,
        [normalizeOpt080Input(reject_number), userId]
      );
    }

    // ★ 2026-07-05 발송 피로도 보호 저장 — 명시 null = 해제라 COALESCE 미사용 별도 UPDATE.
    //   컬럼 미마이그레이션(42703)이어도 기존 설정 저장은 성공 (try/catch 분리 — db_alter_safety_net 정신).
    if (fatigue_cap_days !== undefined || fatigue_cap_max !== undefined) {
      try {
        const fdNum = Number(fatigue_cap_days);
        const fmNum = Number(fatigue_cap_max);
        const fd = fatigue_cap_days == null || !Number.isFinite(fdNum) || fdNum < 1 ? null : Math.min(Math.floor(fdNum), 30);
        const fm = fatigue_cap_max == null || !Number.isFinite(fmNum) || fmNum < 1 ? null : Math.min(Math.floor(fmNum), 100);
        await query(
          `UPDATE companies SET fatigue_cap_days = $1, fatigue_cap_max = $2, updated_at = NOW() WHERE id = $3`,
          [fd, fm, companyId]
        );
      } catch (fgErr: any) {
        console.warn('[settings] 피로도 보호 설정 저장 실패 (컬럼 미마이그레이션?):', fgErr?.message);
      }
    }

    res.json({ message: '설정이 저장되었습니다' });
  } catch (error) {
    console.error('설정 수정 에러:', error);
    res.status(500).json({ error: '설정 저장 실패' });
  }
});

// GET /api/companies/my-credit - 회사 AI 크레딧 잔여 + 이번달 사용량 (종량제 Phase 5)
router.get('/my-credit', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    if (!companyId) return res.status(401).json({ success: false, error: '인증 필요' });
    const { getCreditState, getMonthlyUsage } = await import('../utils/ai-credit');
    const [state, used] = await Promise.all([getCreditState(companyId), getMonthlyUsage(companyId)]);
    return res.json({ success: true, ...state, monthlyUsed: used });
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({ success: false, error: 'DB 마이그레이션 필요', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('크레딧 조회 에러:', err);
    return res.status(500).json({ success: false, error: '크레딧 조회 실패' });
  }
});

// GET /api/companies/my-credit/transactions - 회사 AI 크레딧 사용/충전 이력 (페이지네이션)
//   슈퍼관리자 credit-transactions의 사용자 버전. CT getCreditTransactions 재사용.
router.get('/my-credit/transactions', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    if (!companyId) return res.status(401).json({ success: false, error: '인증 필요' });
    const page = parseInt(req.query.page as string) || 1;
    const { getCreditTransactions } = await import('../utils/ai-credit');
    const r = await getCreditTransactions(companyId, page, 20);
    return res.json({ success: true, transactions: r.rows, total: r.total, page, totalPages: Math.ceil(r.total / 20) });
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({ success: false, error: 'DB 마이그레이션 필요', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('크레딧 이력 조회 에러:', err);
    return res.status(500).json({ success: false, error: '크레딧 이력 조회 실패' });
  }
});

// POST /api/companies/my-credit/recharge - 선불 즉시 충전 (발송 잔액 차감 + 크레딧 지급)
router.post('/my-credit/recharge', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const userId = (req as any).user?.userId;
    if (!companyId) return res.status(401).json({ success: false, error: '인증 필요' });
    const credits = Number(req.body?.credits);
    if (!Number.isFinite(credits) || credits <= 0) return res.status(400).json({ success: false, error: '충전 크레딧을 입력해주세요.' });
    const idempotencyKey = typeof req.body?.idempotencyKey === 'string' ? req.body.idempotencyKey.slice(0, 100) : undefined;

    const { rechargePrepaid } = await import('../utils/ai-credit-recharge');
    const r = await rechargePrepaid({ companyId, credits: Math.floor(credits), userId, idempotencyKey });
    return res.json({ success: true, ...r });
  } catch (err: any) {
    if (err?.name === 'RechargeError') {
      const status = (err.code === 'INSUFFICIENT_BALANCE' || err.code === 'DUPLICATE_RECHARGE') ? 409 : 400;
      return res.status(status).json({ success: false, error: err.message, code: err.code });
    }
    const msg = err?.message || '';
    if (msg.includes('does not exist')) {
      return res.status(503).json({ success: false, error: 'DB 마이그레이션 필요 — ai_credit_requests 테이블 생성 요청', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('선불 충전 에러:', err);
    return res.status(500).json({ success: false, error: '충전 처리 실패' });
  }
});

// POST /api/companies/my-credit/recharge-request - 후불 충전 요청 (슈퍼관리자 승인 대기)
router.post('/my-credit/recharge-request', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const userId = (req as any).user?.userId;
    if (!companyId) return res.status(401).json({ success: false, error: '인증 필요' });
    const credits = Number(req.body?.credits);
    if (!Number.isFinite(credits) || credits <= 0) return res.status(400).json({ success: false, error: '충전 크레딧을 입력해주세요.' });

    const { createRechargeRequest } = await import('../utils/ai-credit-recharge');
    const r = await createRechargeRequest({ companyId, credits: Math.floor(credits), userId });
    return res.json({ success: true, ...r });
  } catch (err: any) {
    if (err?.name === 'RechargeError') {
      const status = err.code === 'DUPLICATE_PENDING' ? 409 : 400;
      return res.status(status).json({ success: false, error: err.message, code: err.code });
    }
    const msg = err?.message || '';
    if (msg.includes('does not exist')) {
      return res.status(503).json({ success: false, error: 'DB 마이그레이션 필요 — ai_credit_requests 테이블 생성 요청', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('후불 충전 요청 에러:', err);
    return res.status(500).json({ success: false, error: '충전 요청 실패' });
  }
});

// GET /api/companies/my-credit/recharge-requests - 내 충전 요청 이력 (pending 포함)
router.get('/my-credit/recharge-requests', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    if (!companyId) return res.status(401).json({ success: false, error: '인증 필요' });
    const page = parseInt(req.query.page as string) || 1;
    const { getRechargeRequests } = await import('../utils/ai-credit-recharge');
    const r = await getRechargeRequests({ companyId, page });
    return res.json({ success: true, ...r });
  } catch (err: any) {
    if ((err?.message || '').includes('does not exist')) {
      return res.status(503).json({ success: false, error: 'DB 마이그레이션 필요', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('충전 요청 이력 에러:', err);
    return res.status(500).json({ success: false, error: '충전 요청 이력 실패' });
  }
});

// GET /api/companies/my-plan - 현재 회사 플랜 정보
router.get('/my-plan', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    if (!companyId) {
      return res.status(401).json({ error: '인증 필요' });
    }

    const result = await query(`
      SELECT 
        c.company_name,
        c.plan_id,
        p.plan_name,
        p.plan_code,
        p.monthly_price,
        p.max_customers,
        p.ai_analysis_level,
        p.customer_db_enabled,
        p.spam_filter_enabled,
        p.ai_messaging_enabled,
        p.auto_spam_test_enabled,
        p.ai_premium_enabled,
        c.subscription_status,
        c.created_at,
        c.trial_expires_at,
        (c.trial_expires_at IS NOT NULL AND c.trial_expires_at < NOW()) AS is_trial_expired,
        (SELECT COUNT(*) FROM customers WHERE company_id = c.id) as current_customers
      FROM companies c
      LEFT JOIN plans p ON c.plan_id = p.id
      WHERE c.id = $1
    `, [companyId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: '회사 정보를 찾을 수 없습니다.' });
    }

    const row = result.rows[0];
    // ★ 2026-07-06 요금제 변경 안내 신호 — "이미 안내함" 상태를 서버(plan_notified_code)로 관리.
    //   기존 localStorage 비교 방식은 브라우저에 stale 값이 남으면 매 접속 반복 노출되던 구조 → 근본 차단.
    //   신규 컬럼 처리는 격리(try/catch) — 실패해도 플랜 조회 자체(대시보드 핵심)엔 영향 0.
    let planChange: { from: string; to: string } | null = null;
    try {
      const cur = row.plan_code;
      if (cur) {
        const nRes = await query('SELECT plan_notified_code FROM companies WHERE id = $1', [companyId]);
        const notified = nRes.rows[0]?.plan_notified_code ?? null;
        if (!notified) {
          // 최초 조회 = 현재 요금제로 조용히 초기화(안내 X) — 기존 회사 배포 직후 오노출 방지(별도 백필 불필요)
          await query('UPDATE companies SET plan_notified_code = $2 WHERE id = $1', [companyId, cur]);
        } else if (notified !== cur) {
          planChange = { from: notified, to: cur };
        }
      }
    } catch (e: any) {
      console.warn('[my-plan] plan_notified_code 처리 스킵(신규 컬럼 미마이그레이션 등):', e?.message);
    }

    res.json({ ...row, plan_change: planChange });
  } catch (error) {
    console.error('플랜 조회 실패:', error);
    res.status(500).json({ error: '플랜 조회 실패' });
  }
});

// POST /api/companies/plan-change/ack - 요금제 변경 안내 확인(1회 노출 종료)
//   확인/닫기 시 서버가 안내한 요금제를 현재 요금제로 갱신 → 다음 조회부터 plan_change=null.
//   계정당 1회, 브라우저·기기 무관(기존 localStorage 반복 노출 근본 차단).
router.post('/plan-change/ack', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    if (!companyId) return res.status(401).json({ error: '인증 필요' });
    await query(
      `UPDATE companies
         SET plan_notified_code = (SELECT p.plan_code FROM plans p WHERE p.id = companies.plan_id)
       WHERE id = $1`,
      [companyId],
    );
    res.json({ success: true });
  } catch (error) {
    console.error('요금제 변경 안내 확인 처리 실패:', error);
    res.status(500).json({ error: '처리 실패' });
  }
});

// POST /api/companies/plan-request - 플랜 변경 신청
router.post('/plan-request', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const userId = (req as any).user?.userId;
    
    if (!companyId) {
      return res.status(401).json({ error: '인증 필요' });
    }

    const { requestedPlanId, message } = req.body;

    if (!requestedPlanId) {
      return res.status(400).json({ error: '요청할 플랜을 선택해주세요.' });
    }

    // 중복 신청 방지: 이미 pending 상태인 신청이 있는지 확인
    const pendingCheck = await query(
      `SELECT id FROM plan_requests WHERE company_id = $1 AND status = 'pending' LIMIT 1`,
      [companyId]
    );
    if (pendingCheck.rows.length > 0) {
      return res.status(409).json({ error: '이미 처리 대기 중인 요금제 신청이 있습니다.', code: 'DUPLICATE_PENDING' });
    }

    // plan_requests 테이블에 저장
    await query(`
      INSERT INTO plan_requests (company_id, user_id, requested_plan_id, message, status)
      VALUES ($1, $2, $3, $4, 'pending')
    `, [companyId, userId, requestedPlanId, message || null]);

    res.json({ message: '플랜 변경 신청이 접수되었습니다.' });
  } catch (error) {
    console.error('플랜 신청 실패:', error);
    res.status(500).json({ error: '플랜 신청 실패' });
  }
});

// POST /api/companies/trial-request - BASIC 1개월 무료체험 신청 (FREE만, [무료체험] 센티넬)
//   팝업(OpenTrialPopup) → 본 신청 → plan_requests 'pending' → 슈퍼관리자 승인 시 grantBasicTrial.
router.post('/trial-request', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const userId = (req as any).user?.userId;
    if (!companyId) return res.status(401).json({ error: '인증 필요' });

    // ★ 2026-06-11 Harold 확정: 무료체험 신청은 2026-06-30(KST)까지만 접수.
    //   화면(팝업/헤더 버튼)도 같은 기준으로 숨기지만, 직접 호출 차단은 서버 가드가 담당.
    if (!isTrialApplyOpen()) {
      return res.status(400).json({
        error: '무료체험 신청 기간이 종료되었습니다. (2026년 6월 30일 마감)',
        code: 'TRIAL_PERIOD_ENDED',
      });
    }

    // 무료체험은 미가입(FREE) 상태에서만 신청 가능
    const comp = await query(
      `SELECT p.plan_code FROM companies c LEFT JOIN plans p ON c.plan_id = p.id WHERE c.id = $1`,
      [companyId],
    );
    const planCode = comp.rows[0]?.plan_code;
    if (planCode && planCode !== 'FREE') {
      return res.status(400).json({ error: '무료체험은 미가입(FREE) 상태에서만 신청할 수 있습니다.' });
    }

    // 중복 신청 방지 (pending 1건)
    const pendingCheck = await query(
      `SELECT id FROM plan_requests WHERE company_id = $1 AND status = 'pending' LIMIT 1`,
      [companyId],
    );
    if (pendingCheck.rows.length > 0) {
      return res.status(409).json({ error: '이미 처리 대기 중인 신청이 있습니다.', code: 'DUPLICATE_PENDING' });
    }

    const basic = await query(`SELECT id FROM plans WHERE plan_code = 'BASIC' AND is_active = true LIMIT 1`);
    if (basic.rows.length === 0) return res.status(500).json({ error: 'BASIC 요금제가 존재하지 않습니다.' });

    await query(
      `INSERT INTO plan_requests (company_id, user_id, requested_plan_id, message, status)
       VALUES ($1, $2, $3, $4, 'pending')`,
      [companyId, userId, basic.rows[0].id, '[무료체험] AI Operator 베이직 1개월 무료체험 신청'],
    );

    res.json({ success: true, message: '무료체험 신청이 접수되었습니다.' });
  } catch (error) {
    console.error('무료체험 신청 실패:', error);
    res.status(500).json({ error: '무료체험 신청 실패' });
  }
});

// GET /api/companies/plan-request/status - 현재 신청 상태 조회 (pending + 미확인 결과)
router.get('/plan-request/status', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    if (!companyId) {
      return res.status(401).json({ error: '인증 필요' });
    }

    // pending 신청 확인
    const pendingResult = await query(
      `SELECT pr.id, pr.status, p.plan_name as requested_plan_name
       FROM plan_requests pr
       LEFT JOIN plans p ON pr.requested_plan_id = p.id
       WHERE pr.company_id = $1 AND pr.status = 'pending'
       ORDER BY pr.created_at DESC LIMIT 1`,
      [companyId]
    );

    // 미확인 처리 결과 (approved/rejected 중 user_confirmed = false)
    const unconfirmedResult = await query(
      `SELECT pr.id, pr.status, pr.admin_note, p.plan_name as requested_plan_name, pr.processed_at
       FROM plan_requests pr
       LEFT JOIN plans p ON pr.requested_plan_id = p.id
       WHERE pr.company_id = $1 AND pr.status IN ('approved', 'rejected') AND pr.user_confirmed = false
       ORDER BY pr.processed_at DESC LIMIT 1`,
      [companyId]
    );

    res.json({
      pending: pendingResult.rows[0] || null,
      unconfirmed: unconfirmedResult.rows[0] || null,
    });
  } catch (error) {
    console.error('플랜 신청 상태 조회 실패:', error);
    res.status(500).json({ error: '플랜 신청 상태 조회 실패' });
  }
});

// PUT /api/companies/plan-request/:id/confirm - 사용자 결과 확인 처리
// ★ D162-4 (2026-05-15) PDF 0515 알림톡 #3 root cause fix: `:id` UUID 검증 미들웨어 적용.
//   같은 파일 뒤에 정의된 명시 path 라우트(/kakao-templates 등)가 `/:id`에 잡혀 매칭 우선이 슈퍼관리자 차단으로 가는 사고 방지.
//   path-to-regexp regex 패턴 호환성 우려를 0으로 만들기 위해 requireUuidId 미들웨어(next('route') fallback) 적용.
router.put('/plan-request/:id/confirm', requireUuidId, async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const { id } = req.params;

    if (!companyId) {
      return res.status(401).json({ error: '인증 필요' });
    }

    await query(
      `UPDATE plan_requests SET user_confirmed = true WHERE id = $1 AND company_id = $2`,
      [id, companyId]
    );

    res.json({ message: '확인 처리되었습니다.' });
  } catch (error) {
    console.error('플랜 결과 확인 실패:', error);
    res.status(500).json({ error: '플랜 결과 확인 실패' });
  }
});

// D87: 자사 사용자 목록 조회 (발신번호 배정용)
router.get('/company-users', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    if (!companyId) {
      return res.status(401).json({ success: false, error: '인증 필요' });
    }

    // ★ D131 후속: 사용자 목록에서 system_sync 가상 계정 제외
    const result = await query(
      `SELECT id, name, email, user_type, store_codes
       FROM users
       WHERE company_id = $1 AND is_active = true AND COALESCE(is_system, false) = false
       ORDER BY user_type ASC, name ASC`,
      [companyId]
    );

    res.json({ success: true, users: result.rows });
  } catch (error) {
    console.error('사용자 목록 조회 실패:', error);
    res.status(500).json({ success: false, error: '조회 실패' });
  }
});

// 회신번호 목록 조회
// D87: assignment_scope 기반 사용자별 배정 필터링 추가
router.get('/callback-numbers', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const userId = (req as any).user?.userId;
    const userType = (req as any).user?.userType;
    if (!companyId) {
      return res.status(401).json({ success: false, error: '인증 필요' });
    }

    // D87: assignment_scope 기반 필터링 (하위호환: 컬럼 미존재 시 기존 동작 유지)
    let hasAssignmentScope = true;
    try {
      await query(`SELECT assignment_scope FROM callback_numbers LIMIT 0`);
    } catch {
      hasAssignmentScope = false;
    }

    let sql: string;
    const params: any[] = [companyId];

    if (hasAssignmentScope) {
      // D87: assignment_scope 필터링
      // - admin/company_admin: 전체 번호 조회 (assignment_scope 무관) — 관리 가시성 보장
      // - company_user: 'all' + 본인 배정된 'assigned' 번호만
      if (userType === 'super_admin' || userType === 'admin' || userType === 'company_admin') {
        sql = `
          SELECT cn.id, cn.phone, cn.label, cn.is_default, cn.store_code, cn.store_name, cn.created_at, cn.assignment_scope
          FROM callback_numbers cn
          WHERE cn.company_id = $1
        `;
      } else {
        sql = `
          SELECT cn.id, cn.phone, cn.label, cn.is_default, cn.store_code, cn.store_name, cn.created_at, cn.assignment_scope
          FROM callback_numbers cn
          WHERE cn.company_id = $1
            AND (
              cn.assignment_scope = 'all'
              OR EXISTS (
                SELECT 1 FROM callback_number_assignments cna
                WHERE cna.callback_number_id = cn.id AND cna.user_id = $2
              )
            )
        `;
        params.push(userId);
      }
    } else {
      // 하위호환: assignment_scope 컬럼 없으면 기존 쿼리
      sql = `SELECT id, phone, label, is_default, store_code, store_name, created_at FROM callback_numbers WHERE company_id = $1`;
    }

    // 일반 사용자(브랜드담당자)는 본인 store_codes에 해당하는 회신번호만
    if (userType !== 'admin') {
      const userResult = await query('SELECT store_codes FROM users WHERE id = $1', [userId]);
      const storeCodes = userResult.rows[0]?.store_codes;
      if (storeCodes && storeCodes.length > 0) {
        const paramIdx = params.length + 1;
        sql += ` AND (${hasAssignmentScope ? 'cn.' : ''}store_code = ANY($${paramIdx}) OR ${hasAssignmentScope ? 'cn.' : ''}store_code IS NULL OR ${hasAssignmentScope ? 'cn.' : ''}is_default = true)`;
        params.push(storeCodes);
      }
    }

    sql += ` ORDER BY ${hasAssignmentScope ? 'cn.' : ''}is_default DESC, ${hasAssignmentScope ? 'cn.' : ''}store_code ASC, ${hasAssignmentScope ? 'cn.' : ''}created_at ASC`;
    const result = await query(sql, params);

    res.json({ success: true, numbers: result.rows });
  } catch (error) {
    console.error('회신번호 조회 실패:', error);
    res.status(500).json({ success: false, error: '조회 실패' });
  }
});

// ===== 대시보드 동적 카드 API (D41) =====

interface CardDataResult {
  cardId: string;
  label: string;
  type: string;
  icon: string;
  value: number | { label: string; count: number }[];
  hasData: boolean;
  // ★ D132 Phase A: 델타 뱃지용 (30일 전 동일 시점 대비)
  delta?: number | null;          // 증감 값 (음수 가능)
  deltaPercent?: number | null;   // % (소수점 1자리)
  deltaBaseline?: string;         // 비교 기준일 ISO
  hasTrend?: boolean;             // 델타 표시 가능 여부 (distribution/특수 카드는 false)
}

/**
 * ★ D136 (2026-04-22 PDF #8): 동적 카드 집계 헬퍼
 *
 * cardId: `dyn_{fieldKey}_{aggType}`
 *   - fieldKey는 파라미터 바인딩($2)으로 주입 (SQL 인젝션 방어)
 *   - customer_field_definitions.field_label을 라벨로 우선 사용, 없으면 fieldKey 원문
 *
 * 지원 aggType:
 *   - dist      : 상위 10 분포 (distribution)
 *   - sum       : 숫자 합계 (sum)
 *   - recent30d : 최근 30일 내 date 값 보유 수 (count, 정규식 캐스팅 방어)
 *   - has       : 값 보유 수 (count)
 *   - rate      : 값 보유 비율 % (rate)
 *
 * 실패 시 null 반환 → 호출부가 skip하여 대시보드 전체 실패로 전파되지 않음.
 */
async function aggregateDynamicCard(
  companyId: string,
  cardId: string,
  parsed: ParsedDynamicCardId,
  storeFilter: string,
): Promise<CardDataResult | null> {
  const { fieldKey, aggType } = parsed;

  // 라벨 조회 — customer_field_definitions.field_label 우선, 없으면 fieldKey 원문
  let label = fieldKey;
  try {
    const labelRes = await query(
      `SELECT field_label FROM customer_field_definitions WHERE company_id = $1 AND field_key = $2 LIMIT 1`,
      [companyId, fieldKey],
    );
    if (labelRes.rows[0]?.field_label) label = labelRes.rows[0].field_label;
  } catch { /* 라벨 조회 실패 시 fieldKey 원문 사용 */ }

  const baseWhere = `company_id = $1${storeFilter}`;
  const nullSafe = `AND custom_fields->>$2 IS NOT NULL AND custom_fields->>$2 != ''`;
  const commonFalse = { delta: null, deltaPercent: null, hasTrend: false } as const;

  try {
    switch (aggType) {
      case 'dist': {
        const r = await query(
          `SELECT custom_fields->>$2 AS label, COUNT(*)::int AS count
             FROM customers
            WHERE ${baseWhere} ${nullSafe}
            GROUP BY custom_fields->>$2
            ORDER BY count DESC, label
            LIMIT 10`,
          [companyId, fieldKey],
        );
        const distribution = r.rows.map((row: any) => ({ label: row.label, count: parseInt(row.count) }));
        return {
          cardId, label: `${label}별 분포`, type: 'distribution',
          icon: 'BarChart3', value: distribution, hasData: distribution.length > 0,
          ...commonFalse,
        };
      }
      case 'sum': {
        // 숫자 외 문자 제거 후 numeric 캐스팅 (콤마/공백 허용)
        const r = await query(
          `SELECT
             COALESCE(SUM(NULLIF(REGEXP_REPLACE(custom_fields->>$2, '[^0-9.-]', '', 'g'), '')::numeric), 0) AS total,
             COUNT(*) FILTER (WHERE custom_fields->>$2 IS NOT NULL AND custom_fields->>$2 != '') AS cnt
             FROM customers WHERE ${baseWhere}`,
          [companyId, fieldKey],
        );
        const total = parseFloat(r.rows[0]?.total ?? 0);
        const cnt = parseInt(r.rows[0]?.cnt ?? 0);
        return {
          cardId, label: `${label} 합계`, type: 'sum',
          icon: 'CreditCard', value: total, hasData: cnt > 0,
          ...commonFalse,
        };
      }
      case 'recent30d': {
        // 정규식으로 YYYY-MM-DD 형식만 캐스팅 — 잘못된 값은 자동 제외 (에러 방지)
        const r = await query(
          `SELECT COUNT(*) FILTER (
             WHERE custom_fields->>$2 ~ '^\\d{4}-\\d{2}-\\d{2}'
               AND (custom_fields->>$2)::date >= (NOW() - INTERVAL '30 days')::date
           )::int AS cnt
             FROM customers WHERE ${baseWhere}`,
          [companyId, fieldKey],
        );
        return {
          cardId, label: `${label} 최근 30일`, type: 'count',
          icon: 'Calendar', value: parseInt(r.rows[0]?.cnt ?? 0), hasData: true,
          ...commonFalse,
        };
      }
      case 'has': {
        const r = await query(
          `SELECT COUNT(*) FILTER (WHERE custom_fields->>$2 IS NOT NULL AND custom_fields->>$2 != '')::int AS cnt
             FROM customers WHERE ${baseWhere}`,
          [companyId, fieldKey],
        );
        return {
          cardId, label: `${label} 보유 수`, type: 'count',
          icon: 'Users', value: parseInt(r.rows[0]?.cnt ?? 0), hasData: true,
          ...commonFalse,
        };
      }
      case 'rate': {
        const r = await query(
          `SELECT
             COUNT(*) FILTER (WHERE custom_fields->>$2 IS NOT NULL AND custom_fields->>$2 != '')::int AS has_cnt,
             COUNT(*)::int AS total
             FROM customers WHERE ${baseWhere}`,
          [companyId, fieldKey],
        );
        const hasCnt = parseInt(r.rows[0]?.has_cnt ?? 0);
        const total = parseInt(r.rows[0]?.total ?? 0);
        const rate = total > 0 ? Math.round((hasCnt / total) * 1000) / 10 : 0;
        return {
          cardId, label: `${label} 비율`, type: 'rate',
          icon: 'Percent', value: rate, hasData: total > 0,
          ...commonFalse,
        };
      }
    }
  } catch (err) {
    console.warn(`[aggregateDynamicCard] ${cardId} 집계 실패:`, (err as any)?.message);
    return null;
  }
  return null;
}

/**
 * 대시보드 카드 집계 함수
 * 설정된 카드만 효율적으로 집계 (단일 customers 쿼리 + 필요한 외부 테이블만)
 */
async function aggregateDashboardCards(companyId: string, cardIds: string[], userId?: string, userType?: string): Promise<CardDataResult[]> {
  const results: CardDataResult[] = [];

  // ★ 사용자 격리: 고객 데이터는 store_code 기준, 발송 데이터는 created_by 기준
  let customerStoreFilter = '';
  const isCompanyUser = userType === 'company_user' && userId;
  if (isCompanyUser) {
    const scope = await getStoreScope(companyId, userId);
    if (scope.type === 'blocked') {
      return cardIds.map(id => {
        const def = getCardDef(id);
        return { cardId: id, label: def?.label ?? id, type: def?.type ?? 'count', icon: def?.icon ?? 'HelpCircle', value: 0, hasData: false };
      });
    }
    if (scope.type === 'filtered') {
      customerStoreFilter = ` AND id IN (SELECT customer_id FROM customer_stores WHERE company_id = '${companyId}' AND store_code = ANY(ARRAY[${scope.storeCodes.map(s => `'${s}'`).join(',')}]::text[]))`;
    }
  }

  // ── 1단계: customers 통합 집계 (데이터 존재 여부 포함) ──
  // ★ D132 Phase A: 30일 전 동일 시점 카운트 동시 집계 (델타 뱃지용)
  //   방식: created_at <= NOW() - INTERVAL '30 days' 필터로 30일 전 상태 근사
  //   ※ 업데이트/삭제된 고객은 반영 안 됨 — 추세 표시 목적이라 허용
  const month = (new Date().getMonth() + 1).toString().padStart(2, '0');
  const baseResult = await query(`
    SELECT
      COUNT(*)::int                                                                          as total_customers,
      COUNT(*) FILTER (WHERE created_at <= NOW() - INTERVAL '30 days')::int                  as total_customers_30d,
      COUNT(*) FILTER (WHERE gender = 'M')::int                                              as gender_male,
      COUNT(*) FILTER (WHERE gender = 'M' AND created_at <= NOW() - INTERVAL '30 days')::int as gender_male_30d,
      COUNT(*) FILTER (WHERE gender = 'F')::int                                              as gender_female,
      COUNT(*) FILTER (WHERE gender = 'F' AND created_at <= NOW() - INTERVAL '30 days')::int as gender_female_30d,
      COUNT(*) FILTER (WHERE gender IS NOT NULL)::int                                        as has_gender_data,
      COUNT(*) FILTER (WHERE birth_month_day LIKE $2)::int                                   as birthday_this_month,
      COUNT(*) FILTER (WHERE birth_month_day IS NOT NULL)::int                               as has_birthday_data,
      COUNT(*) FILTER (WHERE email IS NOT NULL)::int                                         as email_has,
      COUNT(*) FILTER (WHERE email IS NOT NULL AND created_at <= NOW() - INTERVAL '30 days')::int as email_has_30d,
      COUNT(*) FILTER (WHERE sms_opt_in = true)::int                                         as opt_in_count,
      COUNT(*) FILTER (WHERE sms_opt_in = true AND created_at <= NOW() - INTERVAL '30 days')::int as opt_in_count_30d,
      COUNT(*) FILTER (WHERE sms_opt_in IS NOT NULL)::int                                    as has_opt_in_data,
      COUNT(*) FILTER (WHERE created_at >= date_trunc('month', NOW()))::int                  as new_this_month,
      COUNT(*) FILTER (WHERE created_at >= date_trunc('month', NOW() - INTERVAL '1 month') AND created_at < date_trunc('month', NOW()))::int as new_last_month,
      COALESCE(SUM(total_purchase_amount), 0)::numeric                                       as total_purchase_sum,
      COALESCE(SUM(total_purchase_amount) FILTER (WHERE created_at <= NOW() - INTERVAL '30 days'), 0)::numeric as total_purchase_sum_30d,
      COUNT(*) FILTER (WHERE total_purchase_amount IS NOT NULL AND total_purchase_amount > 0)::int as has_purchase_data,
      COUNT(*) FILTER (WHERE recent_purchase_date >= (NOW() - INTERVAL '30 days')::date)::int     as recent_30d_purchase,
      COUNT(*) FILTER (WHERE recent_purchase_date >= (NOW() - INTERVAL '60 days')::date AND recent_purchase_date < (NOW() - INTERVAL '30 days')::date)::int as recent_30d_purchase_prev,
      COUNT(*) FILTER (WHERE recent_purchase_date IS NOT NULL)::int                               as has_recent_purchase_data,
      COUNT(*) FILTER (WHERE recent_purchase_date IS NOT NULL AND recent_purchase_date < (NOW() - INTERVAL '90 days')::date)::int as inactive_90d,
      COUNT(*) FILTER (WHERE recent_purchase_date IS NOT NULL AND recent_purchase_date < (NOW() - INTERVAL '120 days')::date)::int as inactive_90d_prev,
      COUNT(*) FILTER (WHERE age IS NOT NULL)::int                                           as has_age_data,
      COUNT(*) FILTER (WHERE grade IS NOT NULL)::int                                         as has_grade_data,
      COUNT(*) FILTER (WHERE region IS NOT NULL)::int                                        as has_region_data,
      COUNT(*) FILTER (WHERE registered_store IS NOT NULL OR recent_purchase_store IS NOT NULL)::int as has_store_data
    FROM customers
    WHERE company_id = $1${customerStoreFilter}
  `, [companyId, `${month}-%`]);

  const base = baseResult.rows[0];
  const totalCustomers = parseInt(base.total_customers);

  // ★ 델타 계산 헬퍼 — 30일 전 값 대비 절대 증감 + %
  //   hasData=false거나 30일 전 값 0이면서 현재값 0이면 델타 생략
  const baseline30dIso = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const calcDelta = (current: number, prev: number, hasData: boolean): { delta: number | null; deltaPercent: number | null; hasTrend: boolean } => {
    if (!hasData) return { delta: null, deltaPercent: null, hasTrend: false };
    // 30일 전 기준 데이터가 아예 없던 신규 회사는 hasTrend=false
    if (prev === 0 && current === 0) return { delta: null, deltaPercent: null, hasTrend: false };
    const delta = current - prev;
    const deltaPercent = prev === 0 ? null : Math.round((delta / prev) * 1000) / 10;
    return { delta, deltaPercent, hasTrend: true };
  };

  // ★ 2026-07-17 대시보드 성능 — 카드별 개별 쿼리 병렬 선실행.
  //   기존: 아래 for 루프 안에서 순차 await → 카드 수만큼 DB 왕복이 직렬 누적(이새 13.7만 고객 체감 지연 축).
  //   쿼리 문자열·파라미터는 기존과 동일하고 실행 시점만 병렬로 이동 — 소비 지점 await에서 기존과 동일하게 throw.
  const prefetch = new Map<string, Promise<any>>();
  const setPrefetch = (id: string, p: Promise<any>) => {
    p.catch(() => { /* 소비 지점 await가 처리 — 병렬 실행 중 unhandledRejection 경고만 차단 */ });
    prefetch.set(id, p);
  };
  for (const cardId of cardIds) {
    if (isDynamicCardId(cardId)) {
      const parsedDyn = parseDynamicCardId(cardId);
      if (parsedDyn) setPrefetch(cardId, aggregateDynamicCard(companyId, cardId, parsedDyn, customerStoreFilter));
      continue;
    }
    switch (cardId) {
      case 'age_distribution':
        if (parseInt(base.has_age_data) > 0) {
          setPrefetch(cardId, query(`
          SELECT
            CASE
              WHEN age < 20 THEN '10대 이하'
              WHEN age < 30 THEN '20대'
              WHEN age < 40 THEN '30대'
              WHEN age < 50 THEN '40대'
              WHEN age < 60 THEN '50대'
              ELSE '60대 이상'
            END as label,
            COUNT(*)::int as count
          FROM customers
          WHERE company_id = $1 AND age IS NOT NULL${customerStoreFilter}
          GROUP BY 1
          ORDER BY MIN(age)
        `, [companyId]));
        }
        break;
      case 'grade_distribution':
        if (parseInt(base.has_grade_data) > 0) {
          setPrefetch(cardId, query(`
          SELECT grade as label, COUNT(*)::int as count
          FROM customers
          WHERE company_id = $1 AND grade IS NOT NULL${customerStoreFilter}
          GROUP BY grade
          ORDER BY count DESC
        `, [companyId]));
        }
        break;
      case 'region_top':
        if (parseInt(base.has_region_data) > 0) {
          setPrefetch(cardId, query(`
          SELECT region as label, COUNT(*)::int as count
          FROM customers
          WHERE company_id = $1 AND region IS NOT NULL${customerStoreFilter}
          GROUP BY region
          ORDER BY count DESC
          LIMIT 5
        `, [companyId]));
        }
        break;
      case 'store_distribution':
        if (parseInt(base.has_store_data) > 0) {
          setPrefetch(cardId, query(`
          SELECT COALESCE(registered_store, recent_purchase_store) as label, COUNT(*)::int as count
          FROM customers
          WHERE company_id = $1 AND (registered_store IS NOT NULL OR recent_purchase_store IS NOT NULL)${customerStoreFilter}
          GROUP BY COALESCE(registered_store, recent_purchase_store)
          ORDER BY count DESC
          LIMIT 10
        `, [companyId]));
        }
        break;
      case 'opt_out_count':
        setPrefetch(cardId, query(
          `SELECT COUNT(DISTINCT phone)::int as count FROM unsubscribes WHERE company_id = $1`,
          [companyId]
        ));
        break;
      case 'active_campaigns': {
        const campCreatedByFilter = isCompanyUser ? ` AND created_by = '${userId}'` : '';
        setPrefetch(cardId, query(
          `SELECT COUNT(*)::int as count FROM campaigns WHERE company_id = $1 AND status IN ('sending', 'scheduled')${campCreatedByFilter}`,
          [companyId]
        ));
        break;
      }
      case 'monthly_spend': {
        const spendCreatedByFilter = isCompanyUser ? ` AND created_by = $2` : '';
        const spendParams: any[] = isCompanyUser ? [companyId, userId] : [companyId];
        setPrefetch(cardId, query(
          `SELECT COALESCE(SUM(amount), 0)::numeric as total
           FROM balance_transactions
           WHERE company_id = $1 AND type = 'deduct' AND created_at >= date_trunc('month', NOW())${spendCreatedByFilter}`,
          spendParams
        ));
        break;
      }
    }
  }

  // ── 2단계: 각 카드별 결과 조립 ──
  for (const cardId of cardIds) {
    // ★ D136 (2026-04-22 PDF #8): 동적 카드(dyn_{fieldKey}_{aggType}) 분기 집계
    //   고객사가 업로드한 커스텀 필드(custom_1~15 또는 임의 JSONB 키) 기반 카드.
    //   fieldKey는 파라미터 바인딩($2)으로 주입 → SQL 인젝션 방어.
    if (isDynamicCardId(cardId)) {
      const dynPromise = prefetch.get(cardId);
      if (!dynPromise) continue;
      const dynResult = await dynPromise;
      if (dynResult) results.push(dynResult);
      continue;
    }

    const def = getCardDef(cardId);
    if (!def) continue;

    let value: number | { label: string; count: number }[] = 0;
    let hasData = true;

    switch (cardId) {
      // ── 단순 집계 (customers 통합 쿼리 결과 사용) ──
      case 'total_customers':
        value = totalCustomers;
        hasData = totalCustomers > 0;
        break;

      case 'gender_male':
        value = parseInt(base.gender_male);
        hasData = parseInt(base.has_gender_data) > 0;
        break;

      case 'gender_female':
        value = parseInt(base.gender_female);
        hasData = parseInt(base.has_gender_data) > 0;
        break;

      case 'birthday_this_month':
        value = parseInt(base.birthday_this_month);
        hasData = parseInt(base.has_birthday_data) > 0;
        break;

      case 'email_rate': {
        const emailHas = parseInt(base.email_has);
        value = totalCustomers > 0 ? Math.round((emailHas / totalCustomers) * 100) : 0;
        hasData = totalCustomers > 0;
        break;
      }

      case 'opt_in_count':
        value = parseInt(base.opt_in_count);
        hasData = parseInt(base.has_opt_in_data) > 0;
        break;

      case 'new_this_month':
        value = parseInt(base.new_this_month);
        hasData = totalCustomers > 0;
        break;

      case 'total_purchase_sum':
        value = parseFloat(base.total_purchase_sum);
        hasData = parseInt(base.has_purchase_data) > 0;
        break;

      case 'recent_30d_purchase':
        value = parseInt(base.recent_30d_purchase);
        hasData = parseInt(base.has_recent_purchase_data) > 0;
        break;

      case 'inactive_90d':
        value = parseInt(base.inactive_90d);
        hasData = parseInt(base.has_recent_purchase_data) > 0;
        break;

      // ── 분포형 카드 (데이터 존재 시에만 별도 쿼리) ──
      case 'age_distribution': {
        if (parseInt(base.has_age_data) === 0) {
          value = [];
          hasData = false;
          break;
        }
        const ageResult = await prefetch.get(cardId)!;
        value = ageResult.rows as { label: string; count: number }[];
        hasData = true;
        break;
      }

      case 'grade_distribution': {
        if (parseInt(base.has_grade_data) === 0) {
          value = [];
          hasData = false;
          break;
        }
        const gradeResult = await prefetch.get(cardId)!;
        value = gradeResult.rows as { label: string; count: number }[];
        hasData = true;
        break;
      }

      case 'region_top': {
        if (parseInt(base.has_region_data) === 0) {
          value = [];
          hasData = false;
          break;
        }
        const regionResult = await prefetch.get(cardId)!;
        value = regionResult.rows as { label: string; count: number }[];
        hasData = true;
        break;
      }

      case 'store_distribution': {
        if (parseInt(base.has_store_data) === 0) {
          value = [];
          hasData = false;
          break;
        }
        // ★ B17-16: store_name → COALESCE(registered_store, recent_purchase_store) 실제 컬럼 참조
        const storeResult = await prefetch.get(cardId)!;
        value = storeResult.rows as { label: string; count: number }[];
        hasData = true;
        break;
      }

      // ── 외부 테이블 카드 ──
      case 'opt_out_count': {
        const optOutResult = await prefetch.get(cardId)!;
        value = parseInt(optOutResult.rows[0]?.count ?? 0);
        hasData = totalCustomers > 0;
        break;
      }

      case 'active_campaigns': {
        const campResult = await prefetch.get(cardId)!;
        value = parseInt(campResult.rows[0]?.count ?? 0);
        hasData = true;
        break;
      }

      case 'monthly_spend': {
        // ★ D98: created_by 직접 필터링 (서브쿼리 대신 — 테스트발송 더미 UUID 문제 해결)
        const spendResult = await prefetch.get(cardId)!;
        value = parseFloat(spendResult.rows[0]?.total ?? 0);
        hasData = true;
        break;
      }
    }

    // ★ D132 Phase A: cardId별 30일 전 값 매핑 (delta 뱃지 계산용)
    //   count 타입 + 외부 테이블 카드만. distribution/rate/sum은 Phase B에서 확장
    let prev30d: number | null = null;
    switch (cardId) {
      case 'total_customers': prev30d = parseInt(base.total_customers_30d); break;
      case 'gender_male':     prev30d = parseInt(base.gender_male_30d); break;
      case 'gender_female':   prev30d = parseInt(base.gender_female_30d); break;
      case 'opt_in_count':    prev30d = parseInt(base.opt_in_count_30d); break;
      case 'new_this_month':  prev30d = parseInt(base.new_last_month); break;
      case 'recent_30d_purchase': prev30d = parseInt(base.recent_30d_purchase_prev); break;
      case 'inactive_90d':    prev30d = parseInt(base.inactive_90d_prev); break;
      // email_rate / total_purchase_sum / distribution / 외부테이블(opt_out_count/active_campaigns/monthly_spend): Phase B에서 확장
    }

    const currentNum = typeof value === 'number' ? value : 0;
    const trendInfo = prev30d !== null
      ? calcDelta(currentNum, prev30d, hasData)
      : { delta: null, deltaPercent: null, hasTrend: false };

    results.push({
      cardId: def.cardId,
      label: def.label,
      type: def.type,
      icon: def.icon,
      value,
      hasData,
      delta: trendInfo.delta,
      deltaPercent: trendInfo.deltaPercent,
      deltaBaseline: trendInfo.hasTrend ? baseline30dIso : undefined,
      hasTrend: trendInfo.hasTrend,
    });
  }

  return results;
}

// GET /api/companies/dashboard-cards — 고객사별 대시보드 카드 데이터
router.get('/dashboard-cards', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const userId = (req as any).user?.userId;
    const userType = (req as any).user?.userType;
    if (!companyId) {
      return res.status(401).json({ error: '인증 필요' });
    }

    // company_settings에서 카드 설정 조회
    const settingsResult = await query(
      `SELECT setting_key, setting_value
       FROM company_settings
       WHERE company_id = $1 AND setting_key IN ('dashboard_cards', 'dashboard_card_count')`,
      [companyId]
    );

    const settings: Record<string, string> = {};
    for (const row of settingsResult.rows as any[]) {
      settings[row.setting_key] = row.setting_value;
    }

    const cardCount = parseInt(settings.dashboard_card_count || '0');
    let cardIds: string[] = [];

    try {
      cardIds = settings.dashboard_cards ? JSON.parse(settings.dashboard_cards) : [];
    } catch {
      cardIds = [];
    }

    // 카드 미설정 시
    if (cardIds.length === 0) {
      return res.json({
        configured: false,
        cardCount: 0,
        cards: [],
      });
    }

    // DB에 고객 데이터 존재 여부 확인 (전체 블러 처리용)
    // ★ 2026-07-17 성능 — 옛 COUNT(*)는 회사 고객 전수를 셌음(이새 13.7만). 존재 여부만 필요하므로 1건 조회로 교체.
    const customerCheck = await query(
      'SELECT 1 FROM customers WHERE company_id = $1 LIMIT 1',
      [companyId]
    );
    const hasCustomers = customerCheck.rows.length > 0;

    if (!hasCustomers) {
      // DB 미업로드 → 프론트에서 전체 블러 + CTA 표시
      return res.json({
        configured: true,
        cardCount,
        hasCustomerData: false,
        cards: cardIds.map(id => {
          const def = getCardDef(id);
          return {
            cardId: id,
            label: def?.label ?? id,
            type: def?.type ?? 'count',
            icon: def?.icon ?? 'HelpCircle',
            value: 0,
            hasData: false,
          };
        }),
      });
    }

    // 집계 실행 — 사용자 격리 정보 전달
    const cards = await aggregateDashboardCards(companyId, cardIds, userId, userType);

    res.json({
      configured: true,
      cardCount,
      hasCustomerData: true,
      cards,
    });
  } catch (error) {
    console.error('대시보드 카드 조회 실패:', error);
    res.status(500).json({ error: '대시보드 카드 조회 실패' });
  }
});

// ===== D132 Phase B: 대시보드 카드 상세 API =====
// GET /api/companies/dashboard-cards/:cardId/detail
//   카드 타입별 상세 데이터 (trend 6개월 / breakdown 성별·연령·등급 / topList 생일 카드)
//   CT-02 store-scope 재활용 + DASHBOARD_CARD_POOL의 cardId 검증
router.get('/dashboard-cards/:cardId/detail', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const userId = (req as any).user?.userId;
    const userType = (req as any).user?.userType;
    if (!companyId) return res.status(401).json({ error: '인증 필요' });

    const cardId = req.params.cardId;
    const def = getCardDef(cardId);
    if (!def) return res.status(404).json({ error: '존재하지 않는 카드입니다.' });

    const q = (req.query.q as string) || '';
    const page = Math.max(0, parseInt((req.query.page as string) || '0'));
    const limit = Math.min(100, parseInt((req.query.limit as string) || '20'));

    // 브랜드 격리 (CT-02)
    let customerStoreFilter = '';
    const isCompanyUser = userType === 'company_user' && userId;
    if (isCompanyUser) {
      const scope = await getStoreScope(companyId, userId);
      if (scope.type === 'blocked') {
        return res.json({ cardId, label: def.label, type: def.type, blocked: true });
      }
      if (scope.type === 'filtered') {
        customerStoreFilter = ` AND id IN (SELECT customer_id FROM customer_stores WHERE company_id = '${companyId}' AND store_code = ANY(ARRAY[${scope.storeCodes.map(s => `'${s}'`).join(',')}]::text[]))`;
      }
    }

    const month = (new Date().getMonth() + 1).toString().padStart(2, '0');

    // 카드별 WHERE 조건 (customers 테이블)
    const CARD_WHERE_MAP: Record<string, string> = {
      total_customers: '',
      gender_male: ` AND gender = 'M'`,
      gender_female: ` AND gender = 'F'`,
      birthday_this_month: ` AND birth_month_day LIKE '${month}-%'`,
      opt_in_count: ` AND sms_opt_in = true`,
      new_this_month: ` AND created_at >= date_trunc('month', NOW())`,
      recent_30d_purchase: ` AND recent_purchase_date >= (NOW() - INTERVAL '30 days')::date`,
      inactive_90d: ` AND recent_purchase_date IS NOT NULL AND recent_purchase_date < (NOW() - INTERVAL '90 days')::date`,
    };

    const cardWhere = CARD_WHERE_MAP[cardId] ?? '';
    const baseWhere = `WHERE company_id = $1 AND is_active = true${cardWhere}${customerStoreFilter}`;

    // 응답 구조
    const response: any = {
      cardId,
      label: def.label,
      type: def.type,
      icon: def.icon,
    };

    // ── 1. trend: 6개월 누적 월별 추이 (count 카드에만) ──
    const TREND_CARD_IDS = ['total_customers', 'gender_male', 'gender_female', 'opt_in_count', 'new_this_month', 'recent_30d_purchase', 'inactive_90d'];
    if (TREND_CARD_IDS.includes(cardId)) {
      // 각 월 말 기준 "카드 조건에 해당하는 고객 수" 누적
      //   ※ new_this_month는 해당 월의 신규 수 (다른 카드와 다름)
      let trendSql: string;
      if (cardId === 'new_this_month') {
        // 해당 월 범위에 created_at이 포함된 수
        trendSql = `
          SELECT to_char(gs, 'YYYY-MM') as month,
            (SELECT COUNT(*) FROM customers
               WHERE company_id = $1 AND is_active = true${customerStoreFilter}
                 AND created_at >= gs AND created_at < gs + INTERVAL '1 month') as value
          FROM generate_series(
            date_trunc('month', NOW() - INTERVAL '5 months'),
            date_trunc('month', NOW()),
            '1 month'
          ) gs
          ORDER BY gs
        `;
      } else if (cardId === 'recent_30d_purchase') {
        // 각 월 말 기준 "최근 30일 구매" 카운트
        trendSql = `
          SELECT to_char(gs, 'YYYY-MM') as month,
            (SELECT COUNT(*) FROM customers
               WHERE company_id = $1 AND is_active = true${customerStoreFilter}
                 AND recent_purchase_date >= (gs + INTERVAL '1 month' - INTERVAL '30 days')::date
                 AND recent_purchase_date < (gs + INTERVAL '1 month')::date) as value
          FROM generate_series(
            date_trunc('month', NOW() - INTERVAL '5 months'),
            date_trunc('month', NOW()),
            '1 month'
          ) gs
          ORDER BY gs
        `;
      } else if (cardId === 'inactive_90d') {
        trendSql = `
          SELECT to_char(gs, 'YYYY-MM') as month,
            (SELECT COUNT(*) FROM customers
               WHERE company_id = $1 AND is_active = true${customerStoreFilter}
                 AND recent_purchase_date IS NOT NULL
                 AND recent_purchase_date < ((gs + INTERVAL '1 month') - INTERVAL '90 days')::date) as value
          FROM generate_series(
            date_trunc('month', NOW() - INTERVAL '5 months'),
            date_trunc('month', NOW()),
            '1 month'
          ) gs
          ORDER BY gs
        `;
      } else {
        // total/male/female/opt_in: 월 말 기준 누적 (created_at < 월말)
        const condForTrend = cardId === 'gender_male' ? ` AND gender = 'M'` : cardId === 'gender_female' ? ` AND gender = 'F'` : cardId === 'opt_in_count' ? ` AND sms_opt_in = true` : '';
        trendSql = `
          SELECT to_char(gs, 'YYYY-MM') as month,
            (SELECT COUNT(*) FROM customers
               WHERE company_id = $1 AND is_active = true${customerStoreFilter}${condForTrend}
                 AND created_at < gs + INTERVAL '1 month') as value
          FROM generate_series(
            date_trunc('month', NOW() - INTERVAL '5 months'),
            date_trunc('month', NOW()),
            '1 month'
          ) gs
          ORDER BY gs
        `;
      }
      const trendRes = await query(trendSql, [companyId]);
      response.trend = trendRes.rows.map((r: any) => ({ month: r.month, value: parseInt(r.value) || 0 }));
    }

    // ── 2. breakdown: 성별/연령/등급 분포 (count 카드에만) ──
    const BREAKDOWN_CARD_IDS = ['total_customers', 'gender_male', 'gender_female', 'birthday_this_month', 'opt_in_count', 'new_this_month', 'recent_30d_purchase', 'inactive_90d'];
    if (BREAKDOWN_CARD_IDS.includes(cardId)) {
      const [genderRes, ageRes, gradeRes, regionRes] = await Promise.all([
        query(`SELECT COALESCE(gender, '미상') as label, COUNT(*)::int as count FROM customers ${baseWhere} GROUP BY gender ORDER BY count DESC`, [companyId]),
        query(`
          SELECT
            CASE
              WHEN age IS NULL THEN '미상'
              WHEN age < 20 THEN '10대 이하'
              WHEN age < 30 THEN '20대'
              WHEN age < 40 THEN '30대'
              WHEN age < 50 THEN '40대'
              WHEN age < 60 THEN '50대'
              ELSE '60대 이상'
            END as label,
            COUNT(*)::int as count
          FROM customers ${baseWhere}
          GROUP BY 1
          ORDER BY MIN(COALESCE(age, 999))
        `, [companyId]),
        query(`SELECT COALESCE(grade, '미상') as label, COUNT(*)::int as count FROM customers ${baseWhere} GROUP BY grade ORDER BY count DESC LIMIT 8`, [companyId]),
        query(`SELECT COALESCE(region, '미상') as label, COUNT(*)::int as count FROM customers ${baseWhere} GROUP BY region ORDER BY count DESC LIMIT 6`, [companyId]),
      ]);

      // gender enum 역변환
      const mapGenderLabel = (raw: string) => (raw === 'M' ? '남성' : raw === 'F' ? '여성' : raw);

      response.breakdown = {
        byGender: genderRes.rows.map((r: any) => ({ label: mapGenderLabel(r.label), count: parseInt(r.count) })),
        byAge: ageRes.rows.map((r: any) => ({ label: r.label, count: parseInt(r.count) })),
        byGrade: gradeRes.rows.map((r: any) => ({ label: r.label, count: parseInt(r.count) })),
        byRegion: regionRes.rows.map((r: any) => ({ label: r.label, count: parseInt(r.count) })),
      };
    }

    // ── 3. topList: 생일 카드 전용 고객 리스트 (검색 + 페이지네이션) ──
    if (cardId === 'birthday_this_month') {
      let topWhere = baseWhere;
      const topParams: any[] = [companyId];
      let topParamIdx = 2;

      if (q) {
        topWhere += ` AND (name ILIKE $${topParamIdx} OR phone ILIKE $${topParamIdx})`;
        topParams.push(`%${q}%`);
        topParamIdx++;
      }

      const countRes = await query(`SELECT COUNT(*)::int as total FROM customers ${topWhere}`, topParams);
      const total = parseInt(countRes.rows[0]?.total || 0);

      topParams.push(limit, page * limit);
      const listRes = await query(`
        SELECT id, name, phone, gender, grade, birth_month_day,
               TO_CHAR(recent_purchase_date, 'YYYY-MM-DD') as recent_purchase_date,
               total_purchase_amount
          FROM customers ${topWhere}
         ORDER BY birth_month_day ASC NULLS LAST, name ASC
         LIMIT $${topParamIdx} OFFSET $${topParamIdx + 1}
      `, topParams);

      response.topList = {
        items: listRes.rows.map((r: any) => ({
          id: r.id,
          name: r.name,
          phone: r.phone,
          gender: r.gender === 'M' ? '남성' : r.gender === 'F' ? '여성' : r.gender || '',
          grade: r.grade || '',
          birth_month_day: r.birth_month_day || '',
          recent_purchase_date: r.recent_purchase_date || '',
          total_purchase_amount: r.total_purchase_amount != null ? Number(r.total_purchase_amount) : 0,
        })),
        total,
        page,
        limit,
      };
    }

    // ── 4. distribution 카드 전체 확장 리스트 ──
    const DISTRIBUTION_EXPAND: Record<string, string> = {
      age_distribution: `
        SELECT
          CASE
            WHEN age < 20 THEN '10대 이하'
            WHEN age < 30 THEN '20대'
            WHEN age < 40 THEN '30대'
            WHEN age < 50 THEN '40대'
            WHEN age < 60 THEN '50대'
            ELSE '60대 이상'
          END as label, COUNT(*)::int as count
        FROM customers WHERE company_id = $1 AND is_active = true AND age IS NOT NULL${customerStoreFilter}
        GROUP BY 1 ORDER BY MIN(age)
      `,
      grade_distribution: `
        SELECT grade as label, COUNT(*)::int as count
        FROM customers WHERE company_id = $1 AND is_active = true AND grade IS NOT NULL${customerStoreFilter}
        GROUP BY grade ORDER BY count DESC
      `,
      region_top: `
        SELECT region as label, COUNT(*)::int as count
        FROM customers WHERE company_id = $1 AND is_active = true AND region IS NOT NULL${customerStoreFilter}
        GROUP BY region ORDER BY count DESC LIMIT 20
      `,
      store_distribution: `
        SELECT COALESCE(registered_store, recent_purchase_store) as label, COUNT(*)::int as count
        FROM customers WHERE company_id = $1 AND is_active = true
          AND (registered_store IS NOT NULL OR recent_purchase_store IS NOT NULL)${customerStoreFilter}
        GROUP BY COALESCE(registered_store, recent_purchase_store) ORDER BY count DESC LIMIT 30
      `,
    };
    if (DISTRIBUTION_EXPAND[cardId]) {
      const distRes = await query(DISTRIBUTION_EXPAND[cardId], [companyId]);
      response.fullDistribution = distRes.rows.map((r: any) => ({ label: r.label, count: parseInt(r.count) }));
    }

    res.json(response);
  } catch (error) {
    console.error('카드 상세 조회 실패:', error);
    res.status(500).json({ error: '카드 상세 조회 실패' });
  }
});

// GET /api/companies - 고객사 목록
router.get('/', requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { status, search, page = 1, limit = 20 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (status) {
      whereClause += ` AND c.status = $${paramIndex++}`;
      params.push(status);
    }

    if (search) {
      whereClause += ` AND (c.company_name ILIKE $${paramIndex} OR c.company_code ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    const countResult = await query(
      `SELECT COUNT(*) FROM companies c ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    params.push(Number(limit), offset);
    // ★ D114 P9: total_customers — 슈퍼관리자 고객사 목록에 고객 수 표시
    // ★ 2026-06-13 첫 로딩 속도: 행당 상관 서브쿼리(회사 76개 × 24만 행 customers 탐침)
    //   → 집계 1회 GROUP BY JOIN. 값 동일(상관 COUNT 0 ↔ 그룹 부재 COALESCE 0).
    const result = await query(
      `SELECT c.*, p.plan_name, p.plan_code,
              COALESCE(cust.cnt, 0) as total_customers
       FROM companies c
       LEFT JOIN plans p ON c.plan_id = p.id
       LEFT JOIN (SELECT company_id, COUNT(*) AS cnt FROM customers WHERE is_active = true GROUP BY company_id) cust
         ON cust.company_id = c.id
       ${whereClause}
       ORDER BY c.created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      params
    );

    return res.json({
      companies: result.rows,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error('고객사 목록 조회 에러:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// GET /api/companies/:id - 고객사 상세
// ★ D162-4 (2026-05-15) PDF 0515 알림톡 #3 root cause fix:
//   기존 `/:id`가 1-segment 명시 path(`/kakao-profiles`, `/kakao-templates`, `/rcs-templates` 등)를 잡아채
//   requireSuperAdmin이 일반 사용자 403 차단 → Dashboard.tsx loadKakaoTemplates fetch 결과 빈 배열 →
//   알림톡 발송 화면 "승인된 템플릿이 없습니다" 사고 1년+ 영구 발생.
//   requireUuidId 미들웨어로 :id가 UUID 형식이 아니면 next('route') → 명시 path 라우트 정확 매칭 보장.
//   path-to-regexp regex 패턴(`/:id([0-9a-f-]{36})`)은 Express 4/5 path-to-regexp 버전 차이 우려 있어 미들웨어 패턴으로 변경.
router.get('/:id', requireUuidId, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT c.*, p.plan_name, p.plan_code, p.max_customers
       FROM companies c
       LEFT JOIN plans p ON c.plan_id = p.id
       WHERE c.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: '고객사를 찾을 수 없습니다.' });
    }

    return res.json({ company: result.rows[0] });
  } catch (error) {
    console.error('고객사 상세 조회 에러:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// POST /api/companies - 고객사 생성
router.post('/', requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const {
      companyCode,
      companyName,
      businessNumber,
      ceoName,
      contactName,
      contactEmail,
      contactPhone,
      address,
      planId,
      dataInputMethod = 'file',
      usageType = 'web', // ★ 2026-07-03 사용구분: web(웹발송) / agent(QTmsg 에이전트 전용) / both(웹+에이전트)
    } = req.body;

    // usage_type CHECK 제약과 동일 검증 (DB 에러 전에 사용자 친화 차단)
    if (!['web', 'agent', 'both'].includes(usageType)) {
      return res.status(400).json({ error: 'usageType은 web/agent/both 중 하나여야 합니다.' });
    }

    // ★ 2026-07-20: 생성 코어를 utils/company-create.ts CT로 추출 — 게이트웨이 bill 일괄 생성과 공유.
    //   INSERT 컬럼·자동 생성값·부속 처리(시스템 user·customer_code_sequences) 동작 불변.
    const company = await createCompanyCore({
      companyCode,
      companyName,
      businessNumber,
      ceoName,
      contactName,
      contactEmail,
      contactPhone,
      address,
      planId,
      dataInputMethod,
      usageType,
      createdBy: req.user?.userId,
    });

    return res.status(201).json({
      message: '고객사가 생성되었습니다.',
      company,
    });
  } catch (error: any) {
    console.error('고객사 생성 에러:', error);
    if (error.code === '23505') {
      return res.status(400).json({ error: '이미 존재하는 고객사 코드입니다.' });
    }
    // ★ 2026-07-03 db_alter_safety_net: usage_type 컬럼 미마이그레이션 서버 방어
    const msg = error?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({
        success: false,
        error: 'DB 마이그레이션 필요 — 운영자에게 companies.usage_type ALTER 실행 요청',
        code: 'DB_MIGRATION_PENDING',
      });
    }
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// ============================================================
// ★ CT-17: 30일 PRO 무료체험 부여/취소 (슈퍼관리자 전용)
//   - grant-trial : 회사에 30일 동안 PRO 기능 개방
//   - revoke-trial: 즉시 취소 (FREE 강등)
//   - 만료 자동 강등: utils/trial-downgrade-worker.ts (Cron 매일 04:00 KST)
// ============================================================

/**
 * POST /api/companies/:id/grant-trial
 * body: { days?: number = 30 }
 */
// ★ D162-4 (2026-05-15): `/:id` UUID 검증 미들웨어 (일관성)
router.post('/:id/grant-trial', requireUuidId, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const days = Math.max(1, Math.min(Number((req.body as any)?.days) || 30, 365));

    // 회사 존재 확인
    const companyRes = await query(
      `SELECT c.id, p.plan_code
         FROM companies c
         LEFT JOIN plans p ON c.plan_id = p.id
        WHERE c.id = $1`,
      [id],
    );
    if (companyRes.rows.length === 0) {
      return res.status(404).json({ error: '고객사를 찾을 수 없습니다.' });
    }

    // TRIAL plan id 조회 (무료체험 전용 plan — PRO와 동일 기능)
    const trialRes = await query(
      `SELECT id FROM plans WHERE plan_code = 'TRIAL' AND is_active = true LIMIT 1`,
    );
    if (trialRes.rows.length === 0) {
      return res.status(500).json({ error: '무료체험(TRIAL) 요금제가 존재하지 않습니다. 슈퍼관리자에게 문의하세요.' });
    }
    const trialPlanId = trialRes.rows[0].id;

    // ★ RETURNING에 plan_code 포함 — AdminDashboard 가 응답값으로 planCode 표시
    // ★ 2026-07-25 플랜 변경과 이력을 한 트랜잭션으로(Codex 지적 C) — 이력 유실 시 이후 구간이 연쇄로 틀어진다.
    const client = await pool.connect();
    let updated: any;
    try {
      await client.query('BEGIN');
      updated = await client.query(
        `UPDATE companies c
            SET plan_id             = $1,
                subscription_status = 'trial',
                trial_expires_at    = NOW() + ($2::int || ' days')::interval,
                updated_at          = NOW()
          WHERE c.id = $3
        RETURNING c.id, c.plan_id, c.subscription_status, c.trial_expires_at,
                  (SELECT plan_code FROM plans WHERE id = $1) AS plan_code`,
        [trialPlanId, days, id],
      );
      if (updated.rows.length > 0) {
        await recordPlanChange({
          client,
          companyId: id,
          toPlanId: trialPlanId,
          changeType: 'trial_start',
          changedBy: (req as any).user?.userId || null,
          reason: `${days}일 무료체험 부여`,
        });
      }
      await client.query('COMMIT');
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* 아래 알림에 포함 */ }
      await alertPlanChangeFailure(id, err);
      return res.status(500).json({ error: '무료체험 부여에 실패했습니다. 다시 시도해주세요.' });
    } finally {
      client.release();
    }

    return res.json({
      success: true,
      message: `${days}일 PRO 무료체험이 부여되었습니다.`,
      company: updated.rows[0],
    });
  } catch (err) {
    console.error('grant-trial 실패:', err);
    return res.status(500).json({ error: '체험 부여 실패' });
  }
});

/**
 * POST /api/companies/:id/revoke-trial
 *   - 활성 체험 즉시 종료 → plan_id=FREE + subscription_status='trial_expired'
 *   - 정식 구독(subscription_status='paid')은 대상 아님
 *   - 조건: plan_code='TRIAL' 인 경우만 (subscription_status 값에 무관 — 'active'/'trial' 둘 다 허용)
 *     ※ 과거 subscription_status='trial' 조건만으로는 admin.ts가 'active'로 덮어쓴 케이스에서 취소 불가했음.
 */
// ★ D162-4 (2026-05-15): `/:id` UUID 검증 미들웨어 (일관성)
router.post('/:id/revoke-trial', requireUuidId, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const freeRes = await query(
      `SELECT id FROM plans WHERE plan_code = 'FREE' LIMIT 1`,
    );
    if (freeRes.rows.length === 0) {
      return res.status(500).json({ error: 'FREE 요금제가 존재하지 않습니다.' });
    }
    const freePlanId = freeRes.rows[0].id;

    // ★ 2026-07-25 플랜 변경과 이력을 한 트랜잭션으로(Codex 지적 C).
    const client = await pool.connect();
    let updated: any;
    try {
      await client.query('BEGIN');
      updated = await client.query(
        `UPDATE companies c
            SET plan_id             = $1,
                subscription_status = 'trial_expired',
                -- ★ 2026-07-28 만료일도 함께 비운다. 남겨 두면 이 회사에 체험을 다시 줄 때
                --   옛 만료일이 살아나 부여 즉시 만료 상태가 된다.
                trial_expires_at    = NULL,
                updated_at          = NOW()
           FROM plans p
          WHERE c.id = $2
            AND c.plan_id = p.id
            AND p.plan_code = 'TRIAL'
        RETURNING c.id, c.plan_id, c.subscription_status, c.trial_expires_at,
                  (SELECT plan_code FROM plans WHERE id = $1) AS plan_code`,
        [freePlanId, id],
      );
      if (updated.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: '취소할 활성 체험이 없습니다.' });
      }
      await recordPlanChange({
        client,
        companyId: id,
        toPlanId: freePlanId,
        changeType: 'trial_expire',
        changedBy: (req as any).user?.userId || null,
        reason: '무료체험 취소(관리자)',
      });
      await client.query('COMMIT');
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* 아래 알림에 포함 */ }
      await alertPlanChangeFailure(id, err);
      return res.status(500).json({ error: '무료체험 취소에 실패했습니다. 다시 시도해주세요.' });
    } finally {
      client.release();
    }

    return res.json({
      success: true,
      message: '무료체험이 취소되고 미가입(FREE) 상태로 전환되었습니다.',
      company: updated.rows[0],
    });
  } catch (err) {
    console.error('revoke-trial 실패:', err);
    return res.status(500).json({ error: '체험 취소 실패' });
  }
});

// ============================================================
// ★ D219+ Part 2 (2026-05-27): AI 오퍼레이션 30일 무료체험 부여/취소 (슈퍼관리자 전용)
//   - 기존 grant-trial(CT-17 PRO 무료체험)과 완전히 분리.
//     · 본 흐름은 AI 오퍼레이션 메뉴만 무료체험 부여 (plan_code 유지 — BASIC 사용자도 부여 가능).
//     · 게이팅 = plan-guard.isAiOperatorAllowed 안 ai_operator_trial_until > NOW() 분기.
//   - 만료 자동 처리: utils/ai-operator-trial-expire-worker.ts (매일 04:00 KST 로그 + NOW() 비교로 자동 차단).
//   - DB ALTER 미실행 시 → 503 + DB_MIGRATION_PENDING 안내 (db_alter_safety_net 영구 룰 정합).
// ============================================================

/**
 * POST /api/companies/:id/grant-ai-operator-trial
 * body: { days?: number = 30 }
 */
router.post(
  '/:id/grant-ai-operator-trial',
  requireUuidId,
  requireSuperAdmin,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const days = Math.max(1, Math.min(Number((req.body as any)?.days) || 30, 365));

      // 회사 존재 확인
      const companyRes = await query(`SELECT id FROM companies WHERE id = $1`, [id]);
      if (companyRes.rows.length === 0) {
        return res.status(404).json({ error: '고객사를 찾을 수 없습니다.' });
      }

      const updated = await query(
        `UPDATE companies
            SET ai_operator_trial_started_at = NOW(),
                ai_operator_trial_until      = NOW() + ($1::int || ' days')::interval,
                updated_at                   = NOW()
          WHERE id = $2
        RETURNING id, ai_operator_trial_started_at, ai_operator_trial_until`,
        [days, id],
      );

      return res.json({
        success: true,
        message: `${days}일 AI 오퍼레이션 무료체험이 부여되었습니다.`,
        company: updated.rows[0],
      });
    } catch (err: any) {
      const msg = err?.message || '';
      if (msg.includes('column') && msg.includes('does not exist')) {
        console.error('[grant-ai-operator-trial] DB 마이그레이션 미실행:', msg);
        return res.status(503).json({
          success: false,
          code: 'DB_MIGRATION_PENDING',
          error:
            'DB 마이그레이션이 필요합니다. 운영자에게 companies ALTER 2 컬럼 (ai_operator_trial_started_at + ai_operator_trial_until) 실행을 요청하세요.',
        });
      }
      console.error('grant-ai-operator-trial 실패:', err);
      return res.status(500).json({ error: 'AI 오퍼레이션 체험 부여 실패' });
    }
  },
);

/**
 * POST /api/companies/:id/revoke-ai-operator-trial
 *   - 활성 AI 오퍼레이션 무료체험 즉시 종료 → ai_operator_trial_until = NOW()
 *   - plan_id / subscription_status 변경 X (본 흐름은 AI 오퍼레이션 메뉴 한정 분리).
 */
router.post(
  '/:id/revoke-ai-operator-trial',
  requireUuidId,
  requireSuperAdmin,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const updated = await query(
        `UPDATE companies
            SET ai_operator_trial_until = NOW(),
                updated_at              = NOW()
          WHERE id = $1
            AND ai_operator_trial_until IS NOT NULL
            AND ai_operator_trial_until > NOW()
        RETURNING id, ai_operator_trial_started_at, ai_operator_trial_until`,
        [id],
      );

      if (updated.rows.length === 0) {
        return res.status(400).json({ error: '취소할 활성 AI 오퍼레이션 무료체험이 없습니다.' });
      }

      return res.json({
        success: true,
        message: 'AI 오퍼레이션 무료체험이 취소되었습니다.',
        company: updated.rows[0],
      });
    } catch (err: any) {
      const msg = err?.message || '';
      if (msg.includes('column') && msg.includes('does not exist')) {
        console.error('[revoke-ai-operator-trial] DB 마이그레이션 미실행:', msg);
        return res.status(503).json({
          success: false,
          code: 'DB_MIGRATION_PENDING',
          error:
            'DB 마이그레이션이 필요합니다. 운영자에게 companies ALTER 2 컬럼 (ai_operator_trial_started_at + ai_operator_trial_until) 실행을 요청하세요.',
        });
      }
      console.error('revoke-ai-operator-trial 실패:', err);
      return res.status(500).json({ error: 'AI 오퍼레이션 체험 취소 실패' });
    }
  },
);

// ============================================================
// ★ 2026-06-08: BASIC 1개월 무료체험 부여/취소 (슈퍼관리자 전용)
//   - 부여 = grantBasicTrial CT (plan=BASIC + status='trial' + 30일 + base 크레딧=BASIC, purchased 보존).
//   - 만료 자동 강등 = trial-downgrade-worker (subscription_status='trial' 기준).
//   - 기존 grant-trial(PRO)/grant-ai-operator-trial(overlay) 대체.
// ============================================================
router.post('/:id/grant-basic-trial', requireUuidId, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const days = Math.max(1, Math.min(Number((req.body as any)?.days) || 30, 365));
    const exists = await query(`SELECT id FROM companies WHERE id = $1`, [id]);
    if (exists.rows.length === 0) return res.status(404).json({ error: '고객사를 찾을 수 없습니다.' });
    const company = await grantFreeTrial(id, days);
    return res.json({
      success: true,
      // ★ 2026-07-28 연장이면 문구를 바꾼다 — 같은 버튼이 두 가지 일을 하므로 결과를 구분해 알린다.
      message: company?.extended
        ? `무료체험 ${days}일이 추가되었습니다. (남은 기간에 더해집니다)`
        : `${days}일 무료체험이 부여되었습니다.`,
      company,
    });
  } catch (err: any) {
    console.error('grant-basic-trial 실패:', err);
    return res.status(500).json({ error: err?.message || 'BASIC 무료체험 부여 실패' });
  }
});

router.post('/:id/revoke-basic-trial', requireUuidId, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const freeRes = await query(
      `SELECT id, COALESCE(ai_credits_per_month, 0) AS credits FROM plans WHERE plan_code = 'FREE' LIMIT 1`,
    );
    if (freeRes.rows.length === 0) return res.status(500).json({ error: 'FREE 요금제가 존재하지 않습니다.' });
    // ⛔ 크레딧 불변식: base만 FREE(0)로, purchased 컬럼 미포함 = 보존.
    // ★ 2026-07-25 플랜 변경과 이력을 한 트랜잭션으로(Codex 지적 C).
    const client = await pool.connect();
    let updated: any;
    try {
      await client.query('BEGIN');
      updated = await client.query(
        `UPDATE companies
            SET plan_id                   = $1,
                subscription_status       = 'trial_expired',
                -- ★ 2026-07-28 만료일도 함께 비운다(재부여 시 옛 만료일이 살아나는 것을 막는다).
                trial_expires_at          = NULL,
                ai_credits_base_remaining = $2,
                ai_credits_reset_at       = NOW(),
                updated_at                = NOW()
          WHERE id = $3 AND subscription_status = 'trial'
        RETURNING id, plan_id, subscription_status`,
        [freeRes.rows[0].id, Number(freeRes.rows[0].credits) || 0, id],
      );
      if (updated.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: '취소할 활성 무료체험이 없습니다.' });
      }
      await recordPlanChange({
        client,
        companyId: id,
        toPlanId: freeRes.rows[0].id,
        changeType: 'trial_expire',
        changedBy: (req as any).user?.userId || null,
        reason: 'BASIC 무료체험 취소(관리자)',
      });
      await client.query('COMMIT');
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* 아래 알림에 포함 */ }
      await alertPlanChangeFailure(id, err);
      return res.status(500).json({ error: 'BASIC 무료체험 취소에 실패했습니다. 다시 시도해주세요.' });
    } finally {
      client.release();
    }

    return res.json({ success: true, message: '무료체험이 취소되고 미가입(FREE)으로 전환되었습니다.', company: updated.rows[0] });
  } catch (err: any) {
    console.error('revoke-basic-trial 실패:', err);
    return res.status(500).json({ error: 'BASIC 무료체험 취소 실패' });
  }
});

// PUT /api/companies/:id - 고객사 수정 (전체 설정 포함)
// ★ D162-4 (2026-05-15): `/:id` UUID 검증 미들웨어 — 미래에 1-segment 명시 PUT 라우트 추가 시 충돌 방지
router.put('/:id', requireUuidId, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      companyName, businessNumber, ceoName,
      contactName, contactEmail, contactPhone,
      address, planId, status, dataInputMethod,
      rejectNumber,
      // 발송정책
      sendHourStart, sendHourEnd, dailyLimit,
      holidaySend, duplicateDays,
      // ★ 2026-07-26 단가는 이 라우트에서 받지 않는다 — 식별자를 없애 두면 재바인딩을 tsc가 막는다.
      //   전용 경로 = PUT /api/admin/companies/:id/unit-prices (기준과 원자적으로 저장)
      // AI설정
      targetStrategy, crossCategoryAllowed, excludedSegments,
      approvalRequired,
      // 분류코드
      storeCodeList,
      // ★ 2026-07-03 사용구분: web / agent / both
      usageType,
    } = req.body;

    if (usageType !== undefined && !['web', 'agent', 'both'].includes(usageType)) {
      return res.status(400).json({ error: 'usageType은 web/agent/both 중 하나여야 합니다.' });
    }

    // ★ 2026-07-25 요금제가 바뀌는 경로라 변경과 이력을 한 트랜잭션으로(Codex 지적 A·C).
    //   이 엔드포인트는 전에 이력 배선이 빠져 있었다 — `SET plan_id` 리터럴 grep이 다중 컴럼 UPDATE의
    //   중간 줄(`plan_id = COALESCE($8, plan_id)`)을 못 잡았다. 전 출현 분류로 재검증해 찾았다.
    const client = await pool.connect();
    let result: any;
    try {
      await client.query('BEGIN');
      const before = await client.query('SELECT plan_id FROM companies WHERE id = $1::uuid FOR UPDATE', [id]);
      if (before.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: '고객사를 찾을 수 없습니다.' });
      }
      result = await client.query(
      `UPDATE companies SET
        company_name = COALESCE($1, company_name),
        name = COALESCE($1, name),
        business_number = COALESCE($2, business_number),
        ceo_name = COALESCE($3, ceo_name),
        contact_name = COALESCE($4, contact_name),
        contact_email = COALESCE($5, contact_email),
        contact_phone = COALESCE($6, contact_phone),
        address = COALESCE($7, address),
        plan_id = COALESCE($8, plan_id),
        status = COALESCE($9, status),
        data_input_method = COALESCE($10, data_input_method),
        reject_number = COALESCE($11, reject_number),
        send_start_hour = COALESCE($12, send_start_hour),
        send_end_hour = COALESCE($13, send_end_hour),
        daily_limit_per_customer = COALESCE($14, daily_limit_per_customer),
        holiday_send_allowed = COALESCE($15, holiday_send_allowed),
        duplicate_prevention_days = COALESCE($16, duplicate_prevention_days),
        cost_per_sms = COALESCE($17, cost_per_sms),
        cost_per_lms = COALESCE($18, cost_per_lms),
        cost_per_mms = COALESCE($19, cost_per_mms),
        cost_per_kakao = COALESCE($20, cost_per_kakao),
        target_strategy = COALESCE($21, target_strategy),
        cross_category_allowed = COALESCE($22, cross_category_allowed),
        excluded_segments = COALESCE($23, excluded_segments),
        approval_required = COALESCE($24, approval_required),
        store_code_list = COALESCE($25, store_code_list),
        usage_type = COALESCE($26, usage_type),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $27
      RETURNING *`,
      [
        companyName, businessNumber, ceoName, contactName,
        contactEmail, contactPhone, address, planId,
        status, dataInputMethod, rejectNumber,
        sendHourStart, sendHourEnd, dailyLimit,
        holidaySend, duplicateDays,
        // ★2026-07-26 단가는 전용 엔드포인트(PUT /api/admin/companies/:id/unit-prices)에서만 저장한다.
        null, null, null, null,
        targetStrategy, crossCategoryAllowed,
        excludedSegments ? JSON.stringify(excludedSegments) : null,
        approvalRequired,
        storeCodeList ? JSON.stringify(storeCodeList) : null,
        usageType,
        id
      ]
      );

      // 요금제가 실제로 바뀜 때만 기록한다(COALESCE라 planId가 null이면 미변경).
      const newPlanId = result.rows[0]?.plan_id;
      if (planId && newPlanId && String(newPlanId) !== String(before.rows[0].plan_id)) {
        await recordPlanChange({
          client,
          companyId: id,
          toPlanId: String(newPlanId),
          changeType: 'auto',
          changedBy: (req as any).user?.userId || null,
          reason: '고객사 수정(요금제 변경)',
        });
      }
      await client.query('COMMIT');
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* 아래 알림에 포함 */ }
      await alertPlanChangeFailure(id, err);
      throw err;
    } finally {
      client.release();
    }

    return res.json({
      message: '고객사가 수정되었습니다.',
      company: result.rows[0],
    });
  } catch (error: any) {
    console.error('고객사 수정 에러:', error);
    // ★ 2026-07-03 db_alter_safety_net: usage_type 컬럼 미마이그레이션 서버 방어
    const msg = error?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({
        success: false,
        error: 'DB 마이그레이션 필요 — 운영자에게 companies.usage_type ALTER 실행 요청',
        code: 'DB_MIGRATION_PENDING',
      });
    }
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// ============================================================
// ★ 2026-07-03 에이전트(QTmsg) 발송ID 매핑 CRUD (슈퍼관리자 전용)
//   company_agent_ids: 회사 1 : 에이전트 발송ID N (agent_send_id 전역 UNIQUE — 역매핑 보장)
//   usage_type='agent'/'both' 회사의 QTmsg 발송량 조회·정산 합산의 기준 축.
// ============================================================

// GET /api/companies/:id/agent-ids - 회사의 에이전트 발송ID 목록
router.get('/:id/agent-ids', requireUuidId, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    // ★ 2026-07-24 §5-1 원장 격상 — ID별 선/후불·단가 동반 반환 (에이전트 축, 웹 companies.* 와 별개 지갑)
    const result = await query(
      `SELECT id, agent_send_id, memo, created_at,
              billing_type, cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao, cost_per_brand
       FROM company_agent_ids WHERE company_id = $1 ORDER BY created_at ASC`,
      [id]
    );
    // ★ 2026-07-27 발급명(게이트웨이 RSRM_SalesMst.CustNm) 동반 — 매핑 화면이 회사명만 보여주면
    //   런소프트처럼 발송ID 여럿인 회사에서 세 줄이 전부 같은 이름으로 읽힌다. 이름 소스는 게이트웨이 하나다.
    const nameMap = await getAgentCustNameMap();
    return res.json({
      agentIds: result.rows.map((r: any) => ({ ...r, cust_name: nameMap.get(String(r.agent_send_id)) || null })),
    });
  } catch (error: any) {
    console.error('에이전트 발송ID 목록 조회 에러:', error);
    const msg = error?.message || '';
    if ((msg.includes('relation') || msg.includes('column')) && msg.includes('does not exist')) {
      return res.status(503).json({
        success: false,
        error: 'DB 마이그레이션 필요 — 운영자에게 company_agent_ids CREATE/ALTER 실행 요청',
        code: 'DB_MIGRATION_PENDING',
      });
    }
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// POST /api/companies/:id/agent-ids - 에이전트 발송ID 등록
router.post('/:id/agent-ids', requireUuidId, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const agentSendId = String((req.body as any)?.agentSendId || '').trim();
    const memo = String((req.body as any)?.memo || '').trim() || null;

    if (!agentSendId) {
      return res.status(400).json({ error: 'agentSendId는 필수입니다.' });
    }
    if (agentSendId.length > 100) {
      return res.status(400).json({ error: 'agentSendId는 100자 이하여야 합니다.' });
    }
    if (memo && memo.length > 200) {
      return res.status(400).json({ error: '메모는 200자 이하여야 합니다.' }); // DB varchar(200) — 500 유출 차단 (Codex 5R-3)
    }

    // ★ 2026-07-24 §5-1 — 등록 시점 선/후불·단가 지정(선택). 미지정 = postpaid + 단가 NULL(기존 동작 동일)
    const ledger = parseAgentLedgerFields(req.body);
    if ('error' in ledger) {
      return res.status(400).json({ error: ledger.error });
    }

    const result = await query(
      `INSERT INTO company_agent_ids (company_id, agent_send_id, memo, billing_type, cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao, cost_per_brand)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, agent_send_id, memo, created_at, billing_type, cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao, cost_per_brand`,
      [id, agentSendId, memo, ledger.billingType, ledger.costPerSms, ledger.costPerLms, ledger.costPerMms, ledger.costPerKakao,
       ledger.costPerBrand]
    );
    return res.status(201).json({ agentId: result.rows[0] });
  } catch (error: any) {
    console.error('에이전트 발송ID 등록 에러:', error);
    if (error.code === '23505') {
      // agent_send_id 전역 UNIQUE — 어느 회사에 이미 매핑됐는지 안내
      try {
        const dup = await query(
          `SELECT c.company_name FROM company_agent_ids a
           JOIN companies c ON c.id = a.company_id
           WHERE a.agent_send_id = $1`,
          [String((req.body as any)?.agentSendId || '').trim()]
        );
        const owner = dup.rows[0]?.company_name;
        return res.status(400).json({
          error: owner
            ? `이미 "${owner}"에 매핑된 발송ID입니다.`
            : '이미 다른 회사에 매핑된 발송ID입니다.',
        });
      } catch {
        return res.status(400).json({ error: '이미 다른 회사에 매핑된 발송ID입니다.' });
      }
    }
    if (error.code === '23503') {
      return res.status(404).json({ error: '고객사를 찾을 수 없습니다.' });
    }
    const msg = error?.message || '';
    if ((msg.includes('relation') || msg.includes('column')) && msg.includes('does not exist')) {
      return res.status(503).json({
        success: false,
        error: 'DB 마이그레이션 필요 — 운영자에게 company_agent_ids CREATE/ALTER 실행 요청',
        code: 'DB_MIGRATION_PENDING',
      });
    }
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// DELETE /api/companies/:id/agent-ids/:agentIdRowId - 에이전트 발송ID 매핑 해제
router.delete('/:id/agent-ids/:agentIdRowId', requireUuidId, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { id, agentIdRowId } = req.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(agentIdRowId)) {
      return res.status(400).json({ error: '잘못된 ID 형식입니다.' });
    }
    // 효과 검증: 삭제 후 잔존 확인 (RETURNING으로 실제 삭제 행 확정)
    const result = await query(
      `DELETE FROM company_agent_ids WHERE id = $1 AND company_id = $2 RETURNING id`,
      [agentIdRowId, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '매핑을 찾을 수 없습니다.' });
    }
    return res.json({ message: '발송ID 매핑이 해제되었습니다.' });
  } catch (error: any) {
    console.error('에이전트 발송ID 삭제 에러:', error);
    const msg = error?.message || '';
    if ((msg.includes('relation') || msg.includes('column')) && msg.includes('does not exist')) {
      return res.status(503).json({
        success: false,
        error: 'DB 마이그레이션 필요 — 운영자에게 company_agent_ids CREATE/ALTER 실행 요청',
        code: 'DB_MIGRATION_PENDING',
      });
    }
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// PATCH /api/companies/:id/agent-ids/:agentIdRowId - 발송ID 원장 수정 (★ 2026-07-24 §5-1 — 선/후불·단가·메모)
// 선불(prepaid) 지정된 ID부터 대시보드 잔액 표시(§5-2)·충전(§5-3) 대상이 된다.
router.patch('/:id/agent-ids/:agentIdRowId', requireUuidId, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { id, agentIdRowId } = req.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(agentIdRowId)) {
      return res.status(400).json({ error: '잘못된 ID 형식입니다.' });
    }

    // ★ Codex 5R-1 정정: 부분(PATCH) 시맨틱 — 온 필드만 갱신. memo만 보내도 선/후불·단가가 초기화되지 않는다.
    const patch = parseAgentLedgerPatch(req.body);
    if ('error' in patch) {
      return res.status(400).json({ error: patch.error });
    }
    const sets: string[] = [];
    const params: any[] = [];
    const pushSet = (col: string, val: any) => { params.push(val); sets.push(`${col} = $${params.length}`); };
    if (patch.updates.billing_type !== undefined) pushSet('billing_type', patch.updates.billing_type);
    if (patch.updates.cost_per_sms !== undefined) pushSet('cost_per_sms', patch.updates.cost_per_sms);
    if (patch.updates.cost_per_lms !== undefined) pushSet('cost_per_lms', patch.updates.cost_per_lms);
    if (patch.updates.cost_per_mms !== undefined) pushSet('cost_per_mms', patch.updates.cost_per_mms);
    if (patch.updates.cost_per_kakao !== undefined) pushSet('cost_per_kakao', patch.updates.cost_per_kakao);
    if (patch.updates.cost_per_brand !== undefined) pushSet('cost_per_brand', patch.updates.cost_per_brand);
    if ((req.body as any)?.memo !== undefined) {
      const memo = String((req.body as any).memo || '').trim() || null;
      if (memo && memo.length > 200) {
        return res.status(400).json({ error: '메모는 200자 이하여야 합니다.' });
      }
      pushSet('memo', memo);
    }
    if (sets.length === 0) {
      return res.status(400).json({ error: '수정할 필드가 없습니다.' });
    }

    // 효과 검증: RETURNING으로 실제 갱신 행 확정 후에만 성공 응답
    params.push(agentIdRowId, id);
    const result = await query(
      `UPDATE company_agent_ids
          SET ${sets.join(', ')}
        WHERE id = $${params.length - 1} AND company_id = $${params.length}
        RETURNING id, agent_send_id, memo, created_at, billing_type, cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao, cost_per_brand`,
      params
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '매핑을 찾을 수 없습니다.' });
    }
    return res.json({ agentId: result.rows[0] });
  } catch (error: any) {
    console.error('에이전트 발송ID 원장 수정 에러:', error);
    const msg = error?.message || '';
    if ((msg.includes('relation') || msg.includes('column')) && msg.includes('does not exist')) {
      return res.status(503).json({
        success: false,
        error: 'DB 마이그레이션 필요 — 운영자에게 company_agent_ids ALTER 실행 요청',
        code: 'DB_MIGRATION_PENDING',
      });
    }
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// D87: 중복 callback-numbers 라우트 제거 (286번 줄의 D87 버전으로 통합)

// POST /api/companies/refresh-schema - 고객 스키마 갱신
router.post('/refresh-schema', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    if (!companyId) {
      return res.status(401).json({ success: false, error: '인증 필요' });
    }

    await query(`
      UPDATE companies SET customer_schema = (
        SELECT jsonb_build_object(
          'genders', (SELECT array_agg(DISTINCT gender) FROM customers WHERE company_id = $1 AND gender IS NOT NULL),
          'grades', (SELECT array_agg(DISTINCT grade) FROM customers WHERE company_id = $1 AND grade IS NOT NULL),
          'custom_field_keys', (SELECT array_agg(DISTINCT k) FROM customers, jsonb_object_keys(custom_fields) k WHERE company_id = $1),
          'store_codes', (SELECT array_agg(DISTINCT store_code) FROM customers WHERE company_id = $1 AND store_code IS NOT NULL)
        )
      ) WHERE id = $1
    `, [companyId]);

    res.json({ success: true, message: '스키마가 갱신되었습니다.' });
  } catch (error) {
    console.error('스키마 갱신 실패:', error);
    res.status(500).json({ success: false, error: '스키마 갱신 실패' });
  }
});

// POST /api/companies/inquiry - 솔루션 문의 메일 발송
router.post('/inquiry', async (req: Request, res: Response) => {
  try {
    const { companyName, contactName, phone, email, planInterest, subject, message } = req.body;

    if (!contactName || !phone || !email || !subject || !message) {
      return res.status(400).json({ error: '필수 항목을 모두 입력해주세요.' });
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.hiworks.com',
      port: Number(process.env.SMTP_PORT) || 465,
      secure: true,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    const htmlBody = `
      <div style="font-family: 'Apple SD Gothic Neo', sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #3B82F6, #6366F1); padding: 24px; border-radius: 12px 12px 0 0;">
          <h2 style="color: white; margin: 0; font-size: 20px;">📩 한줄로 솔루션 문의</h2>
        </div>
        <div style="background: #ffffff; padding: 24px; border: 1px solid #E5E7EB; border-top: none; border-radius: 0 0 12px 12px;">
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr style="border-bottom: 1px solid #F3F4F6;">
              <td style="padding: 10px 0; color: #6B7280; width: 100px;">회사명</td>
              <td style="padding: 10px 0; font-weight: 600;">${companyName || '-'}</td>
            </tr>
            <tr style="border-bottom: 1px solid #F3F4F6;">
              <td style="padding: 10px 0; color: #6B7280;">담당자</td>
              <td style="padding: 10px 0; font-weight: 600;">${contactName}</td>
            </tr>
            <tr style="border-bottom: 1px solid #F3F4F6;">
              <td style="padding: 10px 0; color: #6B7280;">연락처</td>
              <td style="padding: 10px 0;">${phone}</td>
            </tr>
            <tr style="border-bottom: 1px solid #F3F4F6;">
              <td style="padding: 10px 0; color: #6B7280;">이메일</td>
              <td style="padding: 10px 0;"><a href="mailto:${email}" style="color: #3B82F6;">${email}</a></td>
            </tr>
            ${planInterest ? `<tr style="border-bottom: 1px solid #F3F4F6;">
              <td style="padding: 10px 0; color: #6B7280;">관심 요금제</td>
              <td style="padding: 10px 0;"><span style="background: #EFF6FF; color: #2563EB; padding: 2px 10px; border-radius: 12px; font-size: 13px;">${planInterest}</span></td>
            </tr>` : ''}
          </table>
          <div style="margin-top: 20px; padding: 16px; background: #F9FAFB; border-radius: 8px;">
            <div style="font-size: 13px; color: #6B7280; margin-bottom: 8px;">문의 내용</div>
            <div style="font-size: 14px; color: #111827; white-space: pre-line;">${message}</div>
          </div>
          <div style="margin-top: 20px; font-size: 12px; color: #9CA3AF; text-align: center;">
            이 메일은 한줄로(hanjul.ai) 솔루션 문의 폼에서 자동 발송되었습니다.
          </div>
        </div>
      </div>
    `;

    const toAddresses = (process.env.SMTP_TO || '').split(',').map(e => e.trim()).filter(Boolean);

    await transporter.sendMail({
      from: `"한줄로 문의" <${process.env.SMTP_USER}>`,
      to: toAddresses.join(', '),
      bcc: process.env.SMTP_BCC || '',
      subject: `[한줄로 문의] ${subject}`,
      html: htmlBody,
    });

    res.json({ message: '문의가 전송되었습니다.' });
  } catch (error) {
    console.error('문의 메일 발송 실패:', error);
    res.status(500).json({ error: '문의 전송에 실패했습니다. 잠시 후 다시 시도해주세요.' });
  }
});

// ===== 카카오 발신 프로필 관리 =====
/**
 * @deprecated D130+ IMC 연동은 `/api/alimtalk/*` 라우트로 이관되었습니다.
 *             (utils/alimtalk-api.ts CT-16 + routes/alimtalk.ts)
 *             본 `/api/companies/kakao-profiles`, `/api/companies/kakao-templates`는
 *             레거시 로컬 DB CRUD 호환을 위해 유지되며, 신규 화면은 `/api/alimtalk/*`를 사용해야 합니다.
 *             로직 수정 금지 — 기간계 무접촉 원칙(CLAUDE.md 4-3).
 */

// GET /api/companies/kakao-profiles — 카카오 발신 프로필 목록
router.get('/kakao-profiles', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    if (!companyId) {
      return res.status(401).json({ success: false, error: '인증 필요' });
    }

    const result = await query(
      `SELECT id, profile_key, profile_name, is_active, created_at
       FROM kakao_sender_profiles
       WHERE company_id = $1
       ORDER BY created_at ASC`,
      [companyId]
    );

    res.json({ success: true, profiles: result.rows });
  } catch (error) {
    console.error('카카오 프로필 조회 실패:', error);
    res.status(500).json({ success: false, error: '조회 실패' });
  }
});

// POST /api/companies/kakao-profiles — 카카오 발신 프로필 등록
router.post('/kakao-profiles', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const userType = (req as any).user?.userType;
    if (!companyId) {
      return res.status(401).json({ success: false, error: '인증 필요' });
    }
    // 고객사 관리자 또는 슈퍼관리자만 등록 가능
    if (userType !== 'company_admin' && userType !== 'super_admin') {
      return res.status(403).json({ success: false, error: '관리자 권한이 필요합니다' });
    }

    const { profileKey, profileName } = req.body;
    if (!profileKey || !profileName) {
      return res.status(400).json({ success: false, error: '프로필키와 프로필명은 필수입니다' });
    }

    // 중복 체크
    const existing = await query(
      'SELECT id FROM kakao_sender_profiles WHERE company_id = $1 AND profile_key = $2',
      [companyId, profileKey]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ success: false, error: '이미 등록된 프로필키입니다' });
    }

    const result = await query(
      `INSERT INTO kakao_sender_profiles (company_id, profile_key, profile_name, is_active)
       VALUES ($1, $2, $3, true)
       RETURNING id, profile_key, profile_name, is_active, created_at`,
      [companyId, profileKey, profileName]
    );

    res.status(201).json({ success: true, profile: result.rows[0], message: '카카오 프로필이 등록되었습니다.' });
  } catch (error) {
    console.error('카카오 프로필 등록 실패:', error);
    res.status(500).json({ success: false, error: '등록 실패' });
  }
});

// PUT /api/companies/kakao-profiles/:id — 카카오 발신 프로필 수정
router.put('/kakao-profiles/:id', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const userType = (req as any).user?.userType;
    const { id } = req.params;

    if (!companyId) return res.status(401).json({ success: false, error: '인증 필요' });
    if (userType !== 'company_admin' && userType !== 'super_admin') {
      return res.status(403).json({ success: false, error: '관리자 권한이 필요합니다' });
    }

    const { profileName, isActive } = req.body;

    const result = await query(
      `UPDATE kakao_sender_profiles
       SET profile_name = COALESCE($1, profile_name),
           is_active = COALESCE($2, is_active)
       WHERE id = $3 AND company_id = $4
       RETURNING id, profile_key, profile_name, is_active`,
      [profileName, isActive, id, companyId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '프로필을 찾을 수 없습니다' });
    }

    res.json({ success: true, profile: result.rows[0], message: '수정되었습니다.' });
  } catch (error) {
    console.error('카카오 프로필 수정 실패:', error);
    res.status(500).json({ success: false, error: '수정 실패' });
  }
});

// DELETE /api/companies/kakao-profiles/:id — 카카오 발신 프로필 삭제
router.delete('/kakao-profiles/:id', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const userType = (req as any).user?.userType;
    const { id } = req.params;

    if (!companyId) return res.status(401).json({ success: false, error: '인증 필요' });
    if (userType !== 'company_admin' && userType !== 'super_admin') {
      return res.status(403).json({ success: false, error: '관리자 권한이 필요합니다' });
    }

    const result = await query(
      'DELETE FROM kakao_sender_profiles WHERE id = $1 AND company_id = $2 RETURNING id',
      [id, companyId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '프로필을 찾을 수 없습니다' });
    }

    res.json({ success: true, message: '삭제되었습니다.' });
  } catch (error) {
    console.error('카카오 프로필 삭제 실패:', error);
    res.status(500).json({ success: false, error: '삭제 실패' });
  }
});

// ═══════════════════════════════════════════════════════════
// 알림톡 템플릿 CRUD
// ═══════════════════════════════════════════════════════════

// GET /api/companies/kakao-templates — 알림톡 템플릿 목록
router.get('/kakao-templates', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    if (!companyId) return res.status(401).json({ success: false, error: '인증 필요' });

    const status = req.query.status as string | undefined;
    const category = req.query.category as string | undefined;

    let sql = `SELECT kt.*, ksp.profile_name
       FROM kakao_templates kt
       LEFT JOIN kakao_sender_profiles ksp ON kt.profile_id = ksp.id
       WHERE kt.company_id = $1`;
    const params: any[] = [companyId];

    if (status) {
      // ★ D143 (2026-04-30): D135 새 IMC 시스템에서 status는 대문자 풀네임 8개로 통일됨
      //   (CHECK constraint: DRAFT/REQUESTED/REVIEWING/APPROVED/REJECTED/BLOCKED/DORMANT/DELETED).
      //   레거시 호출자(Dashboard.tsx ?status=approved 등)와 호환을 위해 backend에서 정규화.
      const normalized = (() => {
        const u = status.toUpperCase().trim();
        if (u === 'PENDING') return 'REQUESTED'; // 옛 'pending' = 새 'REQUESTED' (검수요청)
        if (u === 'REQ') return 'REQUESTED';
        if (u === 'REV') return 'REVIEWING';
        if (u === 'APR') return 'APPROVED';
        if (u === 'REJ') return 'REJECTED';
        return u;
      })();
      params.push(normalized);
      sql += ` AND kt.status = $${params.length}`;
    }
    if (category) {
      params.push(category);
      sql += ` AND kt.category = $${params.length}`;
    }

    sql += ' ORDER BY kt.created_at DESC';

    const result = await query(sql, params);
    res.json({ success: true, templates: result.rows });
  } catch (error) {
    console.error('알림톡 템플릿 조회 실패:', error);
    res.status(500).json({ success: false, error: '조회 실패' });
  }
});

// POST /api/companies/kakao-templates — 알림톡 템플릿 등록 요청
router.post('/kakao-templates', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    if (!companyId) return res.status(401).json({ success: false, error: '인증 필요' });

    const {
      profileId, templateName, category, messageType, emphasizeType,
      content, emphasizeTitle, emphasizeSubTitle, imageUrl, extraContent, adContent,
      securityFlag, buttons, quickReplies, templateCode,
    } = req.body;

    if (!templateName || !content) {
      return res.status(400).json({ success: false, error: '템플릿명과 본문은 필수입니다' });
    }

    // 같은 회사 내 이름 중복 체크
    const dup = await query(
      'SELECT id FROM kakao_templates WHERE company_id = $1 AND template_name = $2',
      [companyId, templateName]
    );
    if (dup.rows.length > 0) {
      return res.status(400).json({ success: false, error: '동일한 템플릿 이름이 이미 존재합니다' });
    }

    // ★ D143 (2026-04-30): 'pending' → 'REQUESTED' (CHECK constraint 대문자 교체로 호환).
    // ★ D146 (2026-05-07): emphasize_sub_title + emphasize_subtitle 두 컬럼 동시 INSERT (V1/V2 호환).
    //   기존 V1 라우트는 emphasize_sub_title만 박아 V2 SELECT(emphasize_subtitle)에서 누락되던 문제 차단.
    const result = await query(
      `INSERT INTO kakao_templates (
        company_id, profile_id, template_code, template_name, category,
        message_type, emphasize_type, emphasize_title, emphasize_sub_title, emphasize_subtitle, content, image_url,
        extra_content, ad_content, security_flag, buttons, quick_replies,
        status, requested_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11,$12,$13,$14,$15,$16,'REQUESTED',NOW())
      RETURNING *`,
      [
        companyId, profileId || null, templateCode || null, templateName, category || null,
        messageType || 'BA', emphasizeType || 'NONE', emphasizeTitle || null, emphasizeSubTitle || null,
        content, imageUrl || null,
        extraContent || null, adContent || null, securityFlag || false, JSON.stringify(buttons || []),
        JSON.stringify(quickReplies || []),
      ]
    );

    res.json({ success: true, template: result.rows[0] });
  } catch (error) {
    console.error('알림톡 템플릿 등록 실패:', error);
    res.status(500).json({ success: false, error: '등록 실패' });
  }
});

// PUT /api/companies/kakao-templates/:id — 알림톡 템플릿 수정 (pending/rejected만)
router.put('/kakao-templates/:id', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const { id } = req.params;
    if (!companyId) return res.status(401).json({ success: false, error: '인증 필요' });

    // 수정 가능 상태 확인
    const existing = await query(
      'SELECT status FROM kakao_templates WHERE id = $1 AND company_id = $2',
      [id, companyId]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, error: '템플릿을 찾을 수 없습니다' });
    }
    // ★ D143 (2026-04-30): CHECK 대문자 교체 — 'pending'/'rejected' → 'REQUESTED'/'REJECTED'/'DRAFT'.
    if (!['REQUESTED', 'REJECTED', 'DRAFT'].includes(existing.rows[0].status)) {
      return res.status(400).json({ success: false, error: '검수요청/반려/초안 상태에서만 수정 가능합니다' });
    }

    const {
      profileId, templateName, category, messageType, emphasizeType,
      content, emphasizeTitle, emphasizeSubTitle, imageUrl, extraContent, adContent,
      securityFlag, buttons, quickReplies, templateCode,
    } = req.body;

    // ★ D146 (2026-05-07): emphasize_sub_title + emphasize_subtitle 두 컬럼 동시 UPDATE (V1/V2 호환).
    const result = await query(
      `UPDATE kakao_templates SET
        profile_id = COALESCE($3, profile_id),
        template_code = COALESCE($4, template_code),
        template_name = COALESCE($5, template_name),
        category = COALESCE($6, category),
        message_type = COALESCE($7, message_type),
        emphasize_type = COALESCE($8, emphasize_type),
        emphasize_title = $9,
        emphasize_sub_title = $10,
        emphasize_subtitle = $10,
        content = COALESCE($11, content),
        image_url = $12,
        extra_content = $13,
        ad_content = $14,
        security_flag = COALESCE($15, security_flag),
        buttons = COALESCE($16, buttons),
        quick_replies = COALESCE($17, quick_replies),
        status = 'REQUESTED',
        updated_at = NOW()
      WHERE id = $1 AND company_id = $2
      RETURNING *`,
      [
        id, companyId, profileId, templateCode, templateName, category,
        messageType, emphasizeType, emphasizeTitle ?? null, emphasizeSubTitle ?? null, content,
        imageUrl ?? null, extraContent ?? null, adContent ?? null,
        securityFlag, buttons ? JSON.stringify(buttons) : null,
        quickReplies ? JSON.stringify(quickReplies) : null,
      ]
    );

    res.json({ success: true, template: result.rows[0] });
  } catch (error) {
    console.error('알림톡 템플릿 수정 실패:', error);
    res.status(500).json({ success: false, error: '수정 실패' });
  }
});

// DELETE /api/companies/kakao-templates/:id — 알림톡 템플릿 삭제 (pending만)
router.delete('/kakao-templates/:id', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const { id } = req.params;
    if (!companyId) return res.status(401).json({ success: false, error: '인증 필요' });

    // ★ D143 (2026-04-30): CHECK 대문자 교체 — 'pending' → 'DRAFT'/'REQUESTED'/'REJECTED'.
    //   새 IMC 시스템에서는 'DRAFT'(초안)만 자유 삭제 허용 (alimtalk.ts:935와 동일 정책).
    const result = await query(
      `DELETE FROM kakao_templates WHERE id = $1 AND company_id = $2 AND status IN ('DRAFT','REQUESTED','REJECTED') RETURNING id`,
      [id, companyId]
    );
    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, error: '초안/검수요청/반려 상태의 템플릿만 삭제 가능합니다' });
    }

    res.json({ success: true, message: '삭제되었습니다.' });
  } catch (error) {
    console.error('알림톡 템플릿 삭제 실패:', error);
    res.status(500).json({ success: false, error: '삭제 실패' });
  }
});

// ═══════════════════════════════════════════════════════════
// RCS 템플릿 CRUD
// ═══════════════════════════════════════════════════════════

// GET /api/companies/rcs-templates — RCS 템플릿 목록
router.get('/rcs-templates', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    if (!companyId) return res.status(401).json({ success: false, error: '인증 필요' });

    const status = req.query.status as string | undefined;
    let sql = 'SELECT * FROM rcs_templates WHERE company_id = $1';
    const params: any[] = [companyId];

    if (status) {
      params.push(status);
      sql += ` AND status = $${params.length}`;
    }
    sql += ' ORDER BY created_at DESC';

    const result = await query(sql, params);
    res.json({ success: true, templates: result.rows });
  } catch (error) {
    console.error('RCS 템플릿 조회 실패:', error);
    res.status(500).json({ success: false, error: '조회 실패' });
  }
});

// POST /api/companies/rcs-templates — RCS 템플릿 등록 요청
router.post('/rcs-templates', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    if (!companyId) return res.status(401).json({ success: false, error: '인증 필요' });

    const { templateName, messageType, content, buttons, mediaUrl } = req.body;
    if (!templateName || !content || !messageType) {
      return res.status(400).json({ success: false, error: '템플릿명, 메시지유형, 본문은 필수입니다' });
    }

    const result = await query(
      `INSERT INTO rcs_templates (company_id, template_name, message_type, content, buttons, media_url, status, requested_at)
       VALUES ($1,$2,$3,$4,$5,$6,'pending',NOW()) RETURNING *`,
      [companyId, templateName, messageType, content, JSON.stringify(buttons || []), mediaUrl || null]
    );

    res.json({ success: true, template: result.rows[0] });
  } catch (error) {
    console.error('RCS 템플릿 등록 실패:', error);
    res.status(500).json({ success: false, error: '등록 실패' });
  }
});

// PUT /api/companies/rcs-templates/:id — RCS 템플릿 수정 (pending/rejected만)
router.put('/rcs-templates/:id', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const { id } = req.params;
    if (!companyId) return res.status(401).json({ success: false, error: '인증 필요' });

    const existing = await query(
      'SELECT status FROM rcs_templates WHERE id = $1 AND company_id = $2',
      [id, companyId]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, error: '템플릿을 찾을 수 없습니다' });
    }
    if (!['pending', 'rejected'].includes(existing.rows[0].status)) {
      return res.status(400).json({ success: false, error: '승인대기 또는 반려 상태에서만 수정 가능합니다' });
    }

    const { templateName, messageType, content, buttons, mediaUrl } = req.body;

    const result = await query(
      `UPDATE rcs_templates SET
        template_name = COALESCE($3, template_name),
        message_type = COALESCE($4, message_type),
        content = COALESCE($5, content),
        buttons = COALESCE($6, buttons),
        media_url = $7,
        status = 'pending',
        updated_at = NOW()
      WHERE id = $1 AND company_id = $2
      RETURNING *`,
      [id, companyId, templateName, messageType, content, buttons ? JSON.stringify(buttons) : null, mediaUrl ?? null]
    );

    res.json({ success: true, template: result.rows[0] });
  } catch (error) {
    console.error('RCS 템플릿 수정 실패:', error);
    res.status(500).json({ success: false, error: '수정 실패' });
  }
});

// DELETE /api/companies/rcs-templates/:id — RCS 템플릿 삭제 (pending만)
router.delete('/rcs-templates/:id', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const { id } = req.params;
    if (!companyId) return res.status(401).json({ success: false, error: '인증 필요' });

    const result = await query(
      `DELETE FROM rcs_templates WHERE id = $1 AND company_id = $2 AND status = 'pending' RETURNING id`,
      [id, companyId]
    );
    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, error: '승인대기 상태의 템플릿만 삭제 가능합니다' });
    }

    res.json({ success: true, message: '삭제되었습니다.' });
  } catch (error) {
    console.error('RCS 템플릿 삭제 실패:', error);
    res.status(500).json({ success: false, error: '삭제 실패' });
  }
});

export default router;
