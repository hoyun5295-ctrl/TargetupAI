/**
 * /api/gateway-templates/* — 게이트웨이 알림톡 매핑 관리 (Track C M2, super_admin 전용)
 *
 * 설계 = docs/2026-07-14-template-migration-track-bc-design.md §4-9-B.
 * 라우트는 thin — 로직은 utils/gateway-template-mapping(-worker) CT (no_inline_duplication).
 *
 * 엔드포인트:
 *   GET  /status                  — env 게이트 + sync_status별 집계
 *   GET  /bills                   — bill 목록 + 매핑 상태 집계
 *   POST /bills/:billId/link      — 회사 연결/해제 { companyId | null }
 *   POST /bills/:billId/auto-push — 자동 push 토글 { enabled } (회사 연결 필수)
 *   GET  /mappings                — 매핑 조회 (billId·status 필터)
 *   POST /mappings                — 매핑 수동 등록 (R0001 실측·예외용, source='manual')
 *   POST /seed-import             — 시드 임포트 (dryRun 기본 true·멱등 — §4-9-D-2)
 *   POST /push                    — 푸시 패스 수동 트리거 1회
 *   POST /reconcile               — 대조 수동 트리거 { billId? } → diff 리포트
 *
 * 테이블 부재(DDL 미실행) = 503 DB_MIGRATION_PENDING (db_alter_safety_net).
 */

import { Request, Response, Router } from 'express';
import { authenticate, requireSuperAdmin } from '../middlewares/auth';
import { query } from '../config/database';
import {
  buildMappingPayload,
  prepareSeedImport,
  deriveCompanyCodeFromBillId,
  defaultUsemodForServer,
  inferServerFromBillId,
} from '../utils/gateway-template-mapping';
import { createCompanyCore, createCompanyAdminUser } from '../utils/company-create';

// 일괄 생성 계정 최초 비밀번호 (Harold 지정 2026-07-20) — must_change_password=true라 최초 로그인 시 변경 강제
const BULK_INITIAL_PASSWORD = 'qwer1234';
import {
  runPushPass,
  runReconcilePass,
  runScanPass,
  isGatewaySyncEnabled,
  isGateway54Enabled,
  isMissingRelationError,
} from '../utils/gateway-template-mapping-worker';

const router = Router();

router.use(authenticate as any);
router.use(requireSuperAdmin as any);

/** DDL 미실행 상태 안내 — 500 노출 금지 (db_alter_safety_net) */
function handleDbError(res: Response, err: any): Response {
  if (isMissingRelationError(err)) {
    return res.status(503).json({
      success: false,
      error: 'DB 마이그레이션 필요 — 운영자에게 gateway_bill_mappings·gateway_template_mappings CREATE 실행 요청 의무',
      code: 'DB_MIGRATION_PENDING',
    });
  }
  console.log('[gateway-templates] 오류:', err?.message || err);
  return res.status(500).json({ success: false, error: '서버 오류' });
}

// ── 상태 요약
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const counts = await query(
      `SELECT sync_status, COUNT(*)::int AS cnt FROM gateway_template_mappings GROUP BY sync_status`,
    );
    const bills = await query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE company_id IS NOT NULL)::int AS linked,
              COUNT(*) FILTER (WHERE auto_push_enabled)::int AS auto_push
         FROM gateway_bill_mappings`,
    );
    const byStatus: Record<string, number> = {};
    for (const r of counts.rows) byStatus[r.sync_status] = r.cnt;
    return res.json({
      success: true,
      gates: { syncEnabled: isGatewaySyncEnabled(), server54Enabled: isGateway54Enabled() },
      mappings: byStatus,
      bills: bills.rows[0],
    });
  } catch (err) {
    return handleDbError(res, err);
  }
});

// ── bill 목록 + 매핑 집계
router.get('/bills', async (_req: Request, res: Response) => {
  try {
    const r = await query(
      `SELECT b.id, b.bill_id, b.server, b.company_id, c.company_name, b.bill_name,
              b.default_usemod, b.auto_push_enabled, b.is_active, b.created_at, b.updated_at,
              COALESCE(m.total, 0)::int AS mapping_total,
              COALESCE(m.synced, 0)::int AS mapping_synced,
              COALESCE(m.pending, 0)::int AS mapping_pending,
              COALESCE(m.failed, 0)::int AS mapping_failed,
              COALESCE(m.orphan, 0)::int AS mapping_orphan
         FROM gateway_bill_mappings b
         LEFT JOIN companies c ON c.id = b.company_id
         LEFT JOIN (
           SELECT bill_id,
                  COUNT(*) AS total,
                  COUNT(*) FILTER (WHERE sync_status = 'synced') AS synced,
                  COUNT(*) FILTER (WHERE sync_status = 'pending') AS pending,
                  COUNT(*) FILTER (WHERE sync_status = 'failed') AS failed,
                  COUNT(*) FILTER (WHERE sync_status = 'orphan') AS orphan
             FROM gateway_template_mappings
            GROUP BY bill_id
         ) m ON m.bill_id = b.bill_id
        ORDER BY b.bill_id`,
    );
    return res.json({ success: true, bills: r.rows });
  } catch (err) {
    return handleDbError(res, err);
  }
});

// ── 신규 납입자ID(bill) 단건 등록 (0720 서팀장 회신: 발급=엔진 웹관리자 수동·서버별·일괄 불가)
//    운영 흐름: 58 웹관리자에서 납입자ID 생성 → 여기 등록(+회사 연결) → auto-push 켜면 워커가 승인 템플릿 자동 등록.
//    seed-import는 템플릿코드 필수라 템플릿 0건인 신규 납입자ID 등록엔 이 경로를 쓴다.
router.post('/bills', async (req: Request, res: Response) => {
  try {
    const billId = String(req.body?.billId || '').trim();
    if (!billId || billId.length > 30) {
      return res.status(400).json({ success: false, error: 'billId 필요(30자 이하·리터럴 그대로)' });
    }

    // server: 명시 우선, 미지정 시 접두(P/R) 추론 — 병기·B형식은 추론 불가라 명시 필수
    const serverInput = String(req.body?.server || '').trim();
    const server = serverInput || inferServerFromBillId(billId) || '';
    if (server !== '54' && server !== '58') {
      return res.status(400).json({ success: false, error: "server는 '54'|'58' (접두 P/R 외 형식은 명시 필수)" });
    }

    const billName = String(req.body?.billName || '').trim();
    const usemod = String(req.body?.defaultUsemod || '').trim() || defaultUsemodForServer(server);

    // 회사 연결(선택) — 존재 검증 후에만
    let companyId: string | null = null;
    const companyIdRaw = String(req.body?.companyId || '').trim();
    if (companyIdRaw) {
      if (!/^[0-9a-f-]{36}$/i.test(companyIdRaw)) {
        return res.status(400).json({ success: false, error: 'companyId(uuid) 형식 오류' });
      }
      const comp = await query(`SELECT id FROM companies WHERE id = $1::uuid LIMIT 1`, [companyIdRaw]);
      if (comp.rows.length === 0) return res.status(404).json({ success: false, error: '회사 없음' });
      companyId = companyIdRaw;
    }

    const dup = await query(`SELECT bill_id FROM gateway_bill_mappings WHERE bill_id = $1`, [billId]);
    if (dup.rows.length > 0) {
      return res.status(409).json({ success: false, error: '이미 등록된 bill_id — 연결·수정은 link/auto-push 경로로' });
    }

    const r = await query(
      `INSERT INTO gateway_bill_mappings (bill_id, server, bill_name, default_usemod, company_id, auto_push_enabled, is_active)
       VALUES ($1, $2, $3, $4, $5::uuid, false, true)
       RETURNING *`,
      [billId, server, billName, usemod, companyId],
    );
    console.log(`[gateway-templates] bill 신규 등록 — ${billId} (server=${server}${companyId ? '·회사 연결' : ''})`);
    return res.status(201).json({ success: true, bill: r.rows[0] });
  } catch (err) {
    return handleDbError(res, err);
  }
});

// ── bill ↔ 회사 연결/해제
router.post('/bills/:billId/link', async (req: Request, res: Response) => {
  try {
    const billId = String(req.params.billId || '').trim();
    const companyIdRaw = req.body?.companyId;

    if (companyIdRaw === null || companyIdRaw === '') {
      // 해제 — 안전을 위해 auto_push도 함께 내린다
      const r = await query(
        `UPDATE gateway_bill_mappings
            SET company_id = NULL, auto_push_enabled = false, updated_at = now()
          WHERE bill_id = $1
          RETURNING bill_id`,
        [billId],
      );
      if (r.rows.length === 0) return res.status(404).json({ success: false, error: 'bill 없음' });
      return res.json({ success: true, billId, companyId: null, autoPushEnabled: false });
    }

    const companyId = String(companyIdRaw || '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(companyId)) {
      return res.status(400).json({ success: false, error: 'companyId(uuid) 필요 (해제는 null)' });
    }
    const comp = await query(`SELECT id, company_name FROM companies WHERE id = $1::uuid LIMIT 1`, [companyId]);
    if (comp.rows.length === 0) return res.status(404).json({ success: false, error: '회사 없음' });

    const r = await query(
      `UPDATE gateway_bill_mappings
          SET company_id = $2::uuid, updated_at = now()
        WHERE bill_id = $1
        RETURNING bill_id, server, company_id`,
      [billId, companyId],
    );
    if (r.rows.length === 0) return res.status(404).json({ success: false, error: 'bill 없음' });

    console.log(`[gateway-templates] bill 연결 — ${billId} ↔ ${comp.rows[0].company_name}`);
    return res.json({ success: true, bill: r.rows[0], companyName: comp.rows[0].company_name });
  } catch (err) {
    return handleDbError(res, err);
  }
});

// ── 자동 push 토글 (회사별 점진 개시 게이트 — §4-9-A)
router.post('/bills/:billId/auto-push', async (req: Request, res: Response) => {
  try {
    const billId = String(req.params.billId || '').trim();
    const enabled = req.body?.enabled === true;

    if (enabled) {
      const chk = await query(`SELECT company_id FROM gateway_bill_mappings WHERE bill_id = $1`, [billId]);
      if (chk.rows.length === 0) return res.status(404).json({ success: false, error: 'bill 없음' });
      if (!chk.rows[0].company_id) {
        return res.status(400).json({ success: false, error: '회사 미연결 bill — 연결 후에만 auto_push 개시 가능' });
      }
    }

    const r = await query(
      `UPDATE gateway_bill_mappings SET auto_push_enabled = $2, updated_at = now()
        WHERE bill_id = $1 RETURNING bill_id, auto_push_enabled`,
      [billId, enabled],
    );
    if (r.rows.length === 0) return res.status(404).json({ success: false, error: 'bill 없음' });
    console.log(`[gateway-templates] auto_push ${enabled ? 'ON' : 'OFF'} — ${billId}`);
    return res.json({ success: true, bill: r.rows[0] });
  } catch (err) {
    return handleDbError(res, err);
  }
});

// ── 미연결 bill 일괄 회사 생성 + 연결 (Track B-3, Harold 확정 2026-07-20)
//    같은 회사명(bill_name) bill 여러 건 = 회사 1개 + 연결 N건 (한국고용노동교육원 P0074·R0027 축).
//    company_code = bill_id 원형(비영숫자만 '-') — 기존 R0023 관례 실측 정합. 코드 정확 일치 회사 = 생성 대신 연결.
//    plan = FREE(미가입) · usage_type='agent' · 세부정보(사업자·담당자)는 직원이 관리 화면에서 후속 입력.
router.post('/bills/bulk-create-companies', async (req: Request, res: Response) => {
  try {
    const dryRun = req.body?.dryRun !== false; // 기본 true
    const filterIds: string[] | null =
      Array.isArray(req.body?.billIds) && req.body.billIds.length > 0
        ? req.body.billIds.map((v: any) => String(v).trim())
        : null;

    const billsRes = await query(
      `SELECT bill_id, server, bill_name FROM gateway_bill_mappings
        WHERE company_id IS NULL AND is_active = true ${filterIds ? 'AND bill_id = ANY($1)' : ''}
        ORDER BY bill_id`,
      filterIds ? [filterIds] : [],
    );
    if (billsRes.rows.length === 0) {
      return res.json({ success: true, dryRun, unlinkedBills: 0, plan: [], message: '미연결 bill 없음' });
    }

    // 회사명 기준 그룹 — 정확히 같은 문자열만 묶는다(유사명 자동 매칭 금지 — 오매칭 방지)
    const groups = new Map<string, any[]>();
    for (const b of billsRes.rows) {
      const nameKey = String(b.bill_name || '').trim() || String(b.bill_id);
      if (!groups.has(nameKey)) groups.set(nameKey, []);
      groups.get(nameKey)!.push(b);
    }

    const plan: {
      companyName: string;
      companyCode: string;
      billIds: string[];
      action: 'create' | 'link-existing';
      existingCompanyId: string | null;
      sameNameCompanies: any[];
      loginId: string | null;
    }[] = [];
    for (const [nameKey, groupBills] of groups) {
      const code = deriveCompanyCodeFromBillId(groupBills[0].bill_id);
      const exist = await query(
        `SELECT id, company_name FROM companies WHERE company_code = $1 LIMIT 1`,
        [code],
      );
      // 같은 회사명 기존 회사 = 경고 표시(기존 매칭 19곳 수동 연결 대상일 수 있음 — 자동 연결은 코드 일치만)
      const sameName = await query(
        `SELECT id, company_code, company_name FROM companies WHERE company_name = $1 LIMIT 3`,
        [nameKey],
      );
      plan.push({
        companyName: nameKey,
        companyCode: code,
        billIds: groupBills.map((b) => String(b.bill_id)),
        action: exist.rows.length > 0 ? 'link-existing' : 'create',
        existingCompanyId: exist.rows[0]?.id || null,
        sameNameCompanies: sameName.rows,
        // 신규 생성 시 함께 만들 company_admin 로그인 ID (비번은 일괄 초기값·최초 로그인 변경 강제)
        loginId: exist.rows.length > 0 ? null : code.toLowerCase(),
      });
    }

    if (dryRun) {
      return res.json({
        success: true,
        dryRun: true,
        unlinkedBills: billsRes.rows.length,
        toCreate: plan.filter((p) => p.action === 'create').length,
        toLinkExisting: plan.filter((p) => p.action === 'link-existing').length,
        nameWarnings: plan.filter((p) => p.action === 'create' && p.sameNameCompanies.length > 0).length,
        plan,
      });
    }

    const planRow = await query(`SELECT id FROM plans WHERE plan_code = 'FREE' LIMIT 1`);
    const freePlanId = planRow.rows[0]?.id;
    if (!freePlanId) {
      return res.status(500).json({ success: false, error: "plans에 plan_code='FREE' 없음 — 플랜 확인 필요" });
    }

    let created = 0;
    let linked = 0;
    const createdUsers: string[] = [];
    const skippedUsers: string[] = [];
    const errors: { companyCode: string; error: string }[] = [];
    for (const g of plan) {
      try {
        let companyId = g.existingCompanyId;
        let needAdminUser = false;
        if (!companyId) {
          const company = await createCompanyCore({
            companyCode: g.companyCode,
            companyName: g.companyName,
            planId: freePlanId,
            dataInputMethod: 'file',
            usageType: 'agent',
            createdBy: req.user?.userId ?? null,
          });
          companyId = String(company.id);
          created += 1;
          needAdminUser = true;
        } else {
          // 코드 일치 기존 회사 — 에이전트 전용이고 실계정이 0명일 때만 계정 보정
          // (앞선 실행에서 회사만 생기고 계정 생성이 실패한 경우의 재실행 자가 치유.
          //  실사용 회사(R0023 등)는 계정이 이미 있어 이 분기에 절대 안 들어옴)
          const chk = await query(
            `SELECT c.usage_type,
                    (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id AND COALESCE(u.is_system, false) = false)::int AS user_cnt
               FROM companies c WHERE c.id = $1::uuid`,
            [companyId],
          );
          needAdminUser = chk.rows[0]?.usage_type === 'agent' && chk.rows[0]?.user_cnt === 0;
        }

        if (needAdminUser) {
          // 관리자 계정 생성 — 최초 비번 일괄(BULK_INITIAL_PASSWORD)·최초 로그인 변경 강제.
          // login_id는 전역 축이라 선점 확인 후 생성(충돌 시 skip 보고 — 기존 계정 무접촉).
          const loginId = g.loginId || g.companyCode.toLowerCase();
          const dupUser = await query(`SELECT id FROM users WHERE login_id = $1 LIMIT 1`, [loginId]);
          if (dupUser.rows.length === 0) {
            await createCompanyAdminUser(companyId, loginId, BULK_INITIAL_PASSWORD, g.companyName);
            createdUsers.push(loginId);
          } else {
            skippedUsers.push(loginId);
          }
        }
        for (const billId of g.billIds) {
          const upd = await query(
            `UPDATE gateway_bill_mappings SET company_id = $2::uuid, updated_at = now()
              WHERE bill_id = $1 AND company_id IS NULL`,
            [billId, companyId],
          );
          linked += upd.rowCount || 0;
        }
      } catch (e: any) {
        errors.push({
          companyCode: g.companyCode,
          error: e?.code === '23505' ? 'company_code 중복(경합) — 재실행 시 연결됨' : String(e?.message || e).slice(0, 200),
        });
      }
    }

    // 효과 검증(6원칙 ②) — 미연결 잔존 재카운트 후 보고
    const remain = await query(
      `SELECT COUNT(*)::int AS cnt FROM gateway_bill_mappings WHERE company_id IS NULL AND is_active = true`,
    );
    console.log(
      `[gateway-templates] bulk-create-companies — created=${created} users=${createdUsers.length} linked=${linked} errors=${errors.length} 잔존 미연결=${remain.rows[0].cnt}`,
    );
    return res.json({
      success: errors.length === 0,
      dryRun: false,
      created,
      createdUsers,
      skippedUsers,
      linked,
      errors,
      remainingUnlinked: remain.rows[0].cnt,
    });
  } catch (err) {
    return handleDbError(res, err);
  }
});

// ── 매핑 조회
router.get('/mappings', async (req: Request, res: Response) => {
  try {
    const billId = String(req.query.billId || '').trim();
    const status = String(req.query.status || '').trim();
    const limit = Math.min(500, Math.max(1, parseInt(String(req.query.limit ?? '100'), 10) || 100));
    const offset = Math.max(0, parseInt(String(req.query.offset ?? '0'), 10) || 0);

    const conds: string[] = [];
    const params: any[] = [];
    if (billId) { params.push(billId); conds.push(`bill_id = $${params.length}`); }
    if (status) { params.push(status); conds.push(`sync_status = $${params.length}`); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    params.push(limit, offset);
    const r = await query(
      `SELECT *, COUNT(*) OVER()::int AS total_count
         FROM gateway_template_mappings ${where}
        ORDER BY bill_id, tmplcd
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return res.json({
      success: true,
      total: r.rows[0]?.total_count ?? 0,
      mappings: r.rows.map(({ total_count, ...row }: any) => row),
    });
  } catch (err) {
    return handleDbError(res, err);
  }
});

// ── 매핑 수동 등록 (R0001 실측·예외용 — §4-9-D 5 "테스트 bill 워커 경유 전 사이클")
router.post('/mappings', async (req: Request, res: Response) => {
  try {
    const billId = String(req.body?.billId || '').trim();
    const bill = await query(`SELECT bill_id, server, bill_name FROM gateway_bill_mappings WHERE bill_id = $1`, [billId]);
    if (bill.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'bill 없음 — 먼저 bill을 시드/등록하세요' });
    }

    const built = buildMappingPayload({
      billid: billId,
      senderkey: String(req.body?.senderkey || ''),
      usemod: String(req.body?.usemod || ''),
      tmplcd: String(req.body?.tmplcd || ''),
      tran_tmplcd: String(req.body?.tranTmplcd || req.body?.tran_tmplcd || ''),
      billnm: String(req.body?.billnm || bill.rows[0].bill_name || ''),
    });
    if (!built.ok) return res.status(400).json({ success: false, error: built.error });
    const p = built.payload;

    const r = await query(
      `INSERT INTO gateway_template_mappings
         (bill_id, server, tmplcd, tran_tmplcd, senderkey, billnm, usemod, source, sync_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'manual', 'pending')
       ON CONFLICT (bill_id, tmplcd)
       DO UPDATE SET tran_tmplcd = EXCLUDED.tran_tmplcd, senderkey = EXCLUDED.senderkey,
                     billnm = EXCLUDED.billnm, usemod = EXCLUDED.usemod,
                     sync_status = 'pending', next_retry_at = NULL, attempts = 0,
                     last_error = NULL, updated_at = now()
       RETURNING *`,
      [p.billid, bill.rows[0].server, p.tmplcd, p.tran_tmplcd, p.senderkey, p.billnm, p.usemod],
    );
    console.log(`[gateway-templates] 매핑 수동 등록 — ${p.billid}/${p.tmplcd} (pending)`);
    return res.status(201).json({ success: true, mapping: r.rows[0] });
  } catch (err) {
    return handleDbError(res, err);
  }
});

// ── 시드 임포트 (§4-9-D-2: 서팀장 엑셀 4,681행 → JSON. dryRun 기본 true·멱등)
router.post('/seed-import', async (req: Request, res: Response) => {
  try {
    const dryRun = req.body?.dryRun !== false; // 기본 true
    const rows: any[] = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (rows.length === 0) {
      return res.status(400).json({ success: false, error: 'rows 배열 필요 ({server,bill_id,billnm,senderkey,usemod,tran_tmplcd,tmplcd})' });
    }

    // 검증·중복 정리(최신행 우선)·bill 집계 = CT 순수 함수 (계약 테스트로 고정 — §4-9-D-2)
    const prepared = prepareSeedImport(rows);

    if (prepared.serverConflicts.length > 0) {
      return res.status(400).json({
        success: false,
        error: '같은 bill_id가 두 서버에 걸침 — 시드 데이터 확인 필요 (실등록 데이터엔 0건이 정상 §4-0-2)',
        conflicts: prepared.serverConflicts,
      });
    }

    if (dryRun) {
      const existing = await query(`SELECT COUNT(*)::int AS cnt FROM gateway_template_mappings`);
      const existingBills = await query(`SELECT COUNT(*)::int AS cnt FROM gateway_bill_mappings`);
      return res.json({
        success: true,
        dryRun: true,
        totalRows: rows.length,
        validRows: rows.length - prepared.invalid.length,
        invalidRows: prepared.invalid.length,
        invalidSamples: prepared.invalid.slice(0, 50),
        dupWithinPayload: prepared.dupWithinPayload,
        distinctBills: prepared.bills.length,
        currentTable: { mappings: existing.rows[0].cnt, bills: existingBills.rows[0].cnt },
      });
    }

    if (prepared.invalid.length > 0) {
      return res.status(400).json({
        success: false,
        error: `유효하지 않은 행 ${prepared.invalid.length}건 — 정정 후 실행 (dryRun으로 목록 확인)`,
        invalidSamples: prepared.invalid.slice(0, 50),
      });
    }
    const deduped = prepared.deduped;

    // bill 시드 — ON CONFLICT DO NOTHING (재실행 시 기존 company 연결·토글 무접촉 멱등)
    let insertedBills = 0;
    for (const bill of prepared.bills) {
      const r = await query(
        `INSERT INTO gateway_bill_mappings (bill_id, server, bill_name, default_usemod, auto_push_enabled, is_active)
         VALUES ($1, $2, $3, $4, false, true)
         ON CONFLICT (bill_id) DO NOTHING`,
        [bill.billId, bill.server, bill.billName, bill.defaultUsemod],
      );
      insertedBills += r.rowCount || 0;
    }

    // 매핑 시드 — source='seed', sync_status='synced'(게이트웨이 실존 상태값 §4-9-D-2), 청크 500
    let insertedMappings = 0;
    const CHUNK = 500;
    for (let i = 0; i < deduped.length; i += CHUNK) {
      const chunk = deduped.slice(i, i + CHUNK);
      const values: string[] = [];
      const params: any[] = [];
      for (const n of chunk) {
        const base = params.length;
        params.push(n.payload.billid, n.server, n.payload.tmplcd, n.payload.tran_tmplcd,
          n.payload.senderkey, n.payload.billnm, n.payload.usemod);
        values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, 'seed', 'synced')`);
      }
      const r = await query(
        `INSERT INTO gateway_template_mappings
           (bill_id, server, tmplcd, tran_tmplcd, senderkey, billnm, usemod, source, sync_status)
         VALUES ${values.join(', ')}
         ON CONFLICT (bill_id, tmplcd) DO NOTHING`,
        params,
      );
      insertedMappings += r.rowCount || 0;
    }

    // 효과 검증(6원칙 ②) — 재카운트 후에만 성공 표시
    const recount = await query(`SELECT COUNT(*)::int AS cnt FROM gateway_template_mappings WHERE source = 'seed'`);
    const recountBills = await query(`SELECT COUNT(*)::int AS cnt FROM gateway_bill_mappings`);
    console.log(
      `[gateway-templates] seed-import — rows=${rows.length} inserted=${insertedMappings} skippedDup=${deduped.length - insertedMappings} bills+${insertedBills} → seed 총 ${recount.rows[0].cnt}행`,
    );
    return res.json({
      success: true,
      dryRun: false,
      totalRows: rows.length,
      dedupedRows: deduped.length,
      dupWithinPayload: prepared.dupWithinPayload,
      insertedMappings,
      skippedExisting: deduped.length - insertedMappings,
      insertedBills,
      recount: { seedMappings: recount.rows[0].cnt, bills: recountBills.rows[0].cnt },
    });
  } catch (err) {
    return handleDbError(res, err);
  }
});

// ── 푸시 패스 수동 트리거 (적재 스캔 1회 포함 — R0001 실측 §4-9-D 5)
router.post('/push', async (_req: Request, res: Response) => {
  try {
    const scan = await runScanPass();
    const push = await runPushPass();
    if (scan.skipped || push.skipped) {
      return handleDbError(res, new Error('relation "gateway_template_mappings" does not exist'));
    }
    return res.json({ success: true, scan, push });
  } catch (err) {
    return handleDbError(res, err);
  }
});

// ── 대조 수동 트리거 — 시드 baseline 대조 = 이관 검증 그 자체 (§4-9-D 4)
router.post('/reconcile', async (req: Request, res: Response) => {
  try {
    const billId = String(req.body?.billId || '').trim() || undefined;
    if (billId) {
      const chk = await query(`SELECT 1 FROM gateway_bill_mappings WHERE bill_id = $1`, [billId]);
      if (chk.rows.length === 0) return res.status(404).json({ success: false, error: 'bill 없음' });
    }
    const report = await runReconcilePass(billId);
    if (report.skipped) {
      return handleDbError(res, new Error('relation "gateway_bill_mappings" does not exist'));
    }
    return res.json({ success: true, report });
  } catch (err) {
    return handleDbError(res, err);
  }
});

export default router;
