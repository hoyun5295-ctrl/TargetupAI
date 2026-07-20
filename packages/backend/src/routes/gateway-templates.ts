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
import * as imc from '../utils/alimtalk-api';
import { normalizeImcTemplateStatus } from '../utils/alimtalk-jobs';
import {
  buildCompanyTargets,
  indexImcTemplates,
  extractImcTemplateCode,
  isBSeriesCode,
  classifyMissingSeedCodes,
  summarizeMissing,
  importedAlarmNotifiedStatus,
} from '../utils/kakao-bulk-migration';

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

// ── 카카오 템플릿 일괄 이관 (Track B M5 — §4-9-H 런북, Harold 지시 2026-07-20)
//    게이트웨이 매핑이 아는 "회사 ↔ senderKey ↔ B_ 코드"를 IMC 실목록과 맞춰 프로필 연결 + 템플릿 pull.
//    게이트웨이 호출 0 · gateway_template_mappings 쓰기 0 → 마스터 게이트(false)와 무관하게 안전.
//    발송 경로 파일 무접촉.
//
//    ★기존 POST /api/alimtalk/templates/import를 senderKey마다 부르지 않는 이유:
//      그 경로는 senderKey 1개마다 IMC 계정 전체를 처음부터 재스캔한다(최대 100페이지).
//      senderKey 215개면 IMC 호출이 1만 회를 넘는다. 여기서는 전량 1회 스캔 후 senderKey별로 나눈다.
//
//    ★회사 단위로 도는 이유(0720 실측): bill 단위면 마리오아울렛(P0013·R0041)처럼 두 bill 회사에
//      pull이 두 번 걸리고, 반대로 아난티처럼 한 bill 안 senderKey가 2개면 하나만 연결돼 62코드가
//      조용히 누락된다(0715 실사고). 회사 단위 senderKey 합집합이 두 결함을 동시에 막는다.
//
//    ★D231+ 교훈(응답 전 대량 동기 처리 = nginx 504) 방어: 회사·프로필·템플릿 건수를 모두 상한으로 끊고
//      offset으로 이어서 실행한다. 전 단계 멱등이라 재실행이 항상 안전.
router.post('/bulk-migrate-templates', async (req: Request, res: Response) => {
  const clampInt = (raw: any, def: number, min: number, max: number): number => {
    const n = parseInt(String(raw ?? ''), 10);
    if (!Number.isFinite(n)) return def;
    return Math.min(max, Math.max(min, n));
  };

  try {
    const dryRun = req.body?.dryRun !== false; // 기본 true
    const offset = clampInt(req.body?.offset, 0, 0, 10000);
    const maxCompanies = clampInt(req.body?.maxCompanies, dryRun ? 10 : 1, 1, 100);
    const maxProfiles = clampInt(req.body?.maxProfiles, 30, 1, 200);
    const maxTemplates = clampInt(req.body?.maxTemplates, 800, 1, 3000);
    const billIdFilter: string[] | null =
      Array.isArray(req.body?.billIds) && req.body.billIds.length > 0
        ? req.body.billIds.map((v: any) => String(v).trim())
        : null;
    const companyIdFilter: string[] | null =
      Array.isArray(req.body?.companyIds) && req.body.companyIds.length > 0
        ? req.body.companyIds.map((v: any) => String(v).trim())
        : null;

    // 1) 이관 대상 = 회사 연결된 활성 bill의 매핑 전량 (source 무관 — orphan도 게이트웨이에 실존하는 라우팅)
    const rowsRes = await query(
      `SELECT b.company_id, c.company_name, b.bill_id, m.senderkey, m.tmplcd, m.source
         FROM gateway_bill_mappings b
         JOIN companies c ON c.id = b.company_id
         JOIN gateway_template_mappings m ON m.bill_id = b.bill_id
        WHERE b.is_active = true AND b.company_id IS NOT NULL`,
    );

    let allTargets = buildCompanyTargets(rowsRes.rows);
    if (billIdFilter) {
      allTargets = allTargets.filter((t) => t.billIds.some((b) => billIdFilter.includes(b)));
    }
    if (companyIdFilter) {
      allTargets = allTargets.filter((t) => companyIdFilter.includes(t.companyId));
    }
    const totalCompanies = allTargets.length;
    const targets = allTargets.slice(offset, offset + maxCompanies);
    if (targets.length === 0) {
      return res.json({
        success: true, dryRun, totalCompanies, offset, processedCompanies: 0,
        message: '처리 대상 회사 없음 (offset이 전체 수를 넘었거나 필터 결과 0)',
      });
    }

    // 2) IMC 계정 전량 1회 스캔 — 부분 스캔으로 진행하면 누락 pull이 "완료"로 보인다(0715 사고 유형)
    const IMC_PAGE_SIZE = 100;
    const IMC_MAX_PAGES = 100;
    const imcItems: any[] = [];
    let scanExhausted = false;
    let imcPages = 0;
    for (let page = 0; page < IMC_MAX_PAGES; page++) {
      const r = await imc.listAlimtalkTemplates({ page, count: IMC_PAGE_SIZE });
      if (r.code !== '0000') {
        return res.status(502).json({
          success: false,
          error: `IMC 목록 조회 실패 (page=${page}, code=${r.code}) — 전체 스캔 불가로 중단`,
          imcMessage: r.message,
        });
      }
      const data: any = r.data || {};
      const list: any[] = data.templateList || [];
      imcItems.push(...list);
      imcPages = page + 1;
      if (data.hasNext !== true || list.length === 0) {
        scanExhausted = true;
        break;
      }
    }
    if (!scanExhausted) {
      return res.status(502).json({
        success: false,
        error: `IMC 목록이 ${IMC_MAX_PAGES}페이지에서도 끝나지 않음 — 부분 스캔 금지로 중단(페이지 상한 상향 필요)`,
        scanned: imcItems.length,
      });
    }
    const imcIndex = indexImcTemplates(imcItems);

    // 3) 대상 senderKey의 기존 프로필 / 대상 회사의 기존 템플릿코드
    const targetCompanyIds = targets.map((t) => t.companyId);
    const targetSenderKeys = [...new Set(targets.flatMap((t) => t.senderKeys))];
    const profRes = await query(
      `SELECT id, company_id, profile_key FROM kakao_sender_profiles WHERE profile_key = ANY($1::text[])`,
      [targetSenderKeys],
    );
    const profileByKey = new Map<string, { id: string; company_id: string }>();
    for (const p of profRes.rows) profileByKey.set(String(p.profile_key), { id: p.id, company_id: String(p.company_id) });

    const tmplRes = await query(
      `SELECT company_id, template_code, template_key FROM kakao_templates WHERE company_id = ANY($1::uuid[])`,
      [targetCompanyIds],
    );
    const codesByCompany = new Map<string, Set<string>>();
    for (const cid of targetCompanyIds) codesByCompany.set(cid, new Set<string>());
    for (const row of tmplRes.rows) {
      const set = codesByCompany.get(String(row.company_id));
      if (!set) continue;
      if (row.template_code) set.add(String(row.template_code));
      if (row.template_key) set.add(String(row.template_key));
    }

    // 4) 회사별 처리
    let profileBudget = maxProfiles;
    let templateBudget = maxTemplates;
    const report: any[] = [];

    for (const target of targets) {
      const presentCodes = codesByCompany.get(target.companyId) || new Set<string>();
      const connectedSenderKeys = new Set<string>();
      const senderReport: any[] = [];
      const pullSenderKeys: string[] = [];

      for (const key of target.senderKeys) {
        const existing = profileByKey.get(key);
        if (existing && existing.company_id === target.companyId) {
          connectedSenderKeys.add(key);
          pullSenderKeys.push(key);
          senderReport.push({ senderKey: key, state: 'already_linked', profileId: existing.id });
          continue;
        }
        if (existing) {
          // 다른 회사 선점 — 자동 재연결 금지(오귀속 위험). 표시만 하고 사람이 판단.
          senderReport.push({ senderKey: key, state: 'linked_to_other_company', otherCompanyId: existing.company_id });
          continue;
        }
        if (profileBudget <= 0) {
          senderReport.push({ senderKey: key, state: 'budget_exhausted' });
          continue;
        }

        // IMC 실조회 — 우리 계정에서 보이는 키만 연결 대상 (관문 1과 동일 판정)
        profileBudget -= 1;
        let sender: any = null;
        try {
          const r = await imc.getSender(key);
          if (r.code === '0000' && r.data?.senderKey) sender = r.data;
          else senderReport.push({ senderKey: key, state: 'imc_not_visible', imcCode: r.code });
        } catch (probeErr: any) {
          senderReport.push({
            senderKey: key,
            state: 'imc_probe_error',
            error: String(probeErr?.message || probeErr).slice(0, 200),
          });
        }
        if (!sender) continue;

        if (dryRun) {
          connectedSenderKeys.add(key);
          pullSenderKeys.push(key);
          senderReport.push({ senderKey: key, state: 'would_link', yellowId: sender.uuid || null, imcStatus: sender.status || null });
          continue;
        }

        // 같은 회사+채널 중복 가드 (idx_ksp_yellow_id unique 선방어 — 기존 등록 경로와 동일 정책)
        if (sender.uuid) {
          const dupChannel = await query(
            `SELECT id FROM kakao_sender_profiles WHERE company_id = $1::uuid AND yellow_id = $2 LIMIT 1`,
            [target.companyId, sender.uuid],
          );
          if (dupChannel.rows.length > 0) {
            senderReport.push({ senderKey: key, state: 'channel_already_registered', existingProfileId: dupChannel.rows[0].id });
            continue;
          }
        }

        let categoryNameCache: string | null = null;
        if (sender.categoryCode) {
          try {
            const cat = await imc.getSenderCategory(String(sender.categoryCode));
            if (cat.code === '0000' && cat.data) categoryNameCache = cat.data.name;
          } catch {
            /* 카테고리 조회 실패 무시 — 표시용 캐시 */
          }
        }

        const ins = await query(
          `INSERT INTO kakao_sender_profiles
             (company_id, profile_key, profile_name, is_active,
              yellow_id, category_code, category_name_cache,
              top_sender_yn, custom_sender_key, status,
              block_yn, dormant_yn, brand_message_yn, channel_created_at,
              approval_status, approval_requested_at, approved_at, approved_by,
              registered_at, updated_at)
           VALUES ($1,$2,$3,true,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
                   'APPROVED', now(), now(), $14,
                   now(), now())
           RETURNING id`,
          [
            target.companyId,
            sender.senderKey,
            sender.name || sender.uuid || key,
            sender.uuid || null,
            sender.categoryCode ? String(sender.categoryCode) : null,
            categoryNameCache,
            sender.topSenderKeyYn || 'N',
            sender.customSenderKey || null,
            sender.status || 'NORMAL',
            sender.block === true ? 'Y' : 'N',
            sender.dormant === true ? 'Y' : 'N',
            sender.brandMessage === true ? 'Y' : 'N',
            sender.createdAt || null,
            req.user?.userId || null,
          ],
        );
        profileByKey.set(key, { id: ins.rows[0].id, company_id: target.companyId });
        connectedSenderKeys.add(key);
        pullSenderKeys.push(key);
        senderReport.push({ senderKey: key, state: 'linked', profileId: ins.rows[0].id });
      }

      // 템플릿 pull — 연결된 senderKey의 IMC 항목 중 B_ 계열이면서 기존에 없는 것만
      const toCreate: Array<{ item: any; code: string; senderKey: string }> = [];
      const seenInThisRun = new Set<string>();
      for (const key of pullSenderKeys) {
        for (const item of imcIndex.bySender.get(key) || []) {
          const code = extractImcTemplateCode(item);
          if (!code || !isBSeriesCode(code)) continue;
          if (presentCodes.has(code) || seenInThisRun.has(code)) continue;
          const tkey = item?.templateKey ? String(item.templateKey) : '';
          if (tkey && presentCodes.has(tkey)) continue;
          seenInThisRun.add(code);
          toCreate.push({ item, code, senderKey: key });
        }
      }

      let created = 0;
      let deferred = 0;
      const failures: Array<{ templateCode: string; error: string }> = [];
      if (!dryRun) {
        for (const entry of toCreate) {
          if (templateBudget <= 0) {
            deferred += 1;
            continue;
          }
          templateBudget -= 1;
          const profileId = profileByKey.get(entry.senderKey)?.id;
          if (!profileId) {
            failures.push({ templateCode: entry.code, error: '프로필 id 없음' });
            continue;
          }
          const it = entry.item;
          const status = normalizeImcTemplateStatus(it.inspectionStatus || '');
          const approvedAt = status === 'APPROVED' && it.inspectionStatusUpdate ? it.inspectionStatusUpdate : null;
          const representLink = imc.fromImcRepresentLink(it.templateRepresentLink);
          try {
            await query(
              `INSERT INTO kakao_templates
                 (company_id, profile_id, template_code, template_key, template_name,
                  content, buttons, variables, status,
                  category, message_type, emphasize_type, emphasize_title, emphasize_subtitle, emphasize_sub_title,
                  image_name, extra_content, ad_content, security_flag, quick_replies,
                  template_header, item_highlight, item_list, item_summary, represent_link,
                  preview_message, alarm_phone_numbers, service_mode, custom_template_code,
                  reject_reason, approved_at, alarm_notified_status,
                  created_by, created_at, updated_at, last_synced_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::text[],$9,
                       $10,$11,$12,$13,$14,$14,
                       $15,$16,$17,$18,$19::jsonb,
                       $20,$21::jsonb,$22::jsonb,$23::jsonb,$24::jsonb,
                       $25,$26,$27,$28,
                       $29,$30::timestamp,$31,
                       NULL, COALESCE($32::timestamp, now()), now(), now())`,
              [
                target.companyId,
                profileId,
                entry.code,
                it.templateKey ? String(it.templateKey) : null,
                String(it.templateName || it.manageName || '').slice(0, 100),
                it.templateContent || '',
                JSON.stringify(imc.fromImcButtons(it.buttonList)),
                imc.extractAlimtalkVariables(it.templateContent),
                status,
                it.categoryCode ? String(it.categoryCode) : null,
                it.templateMessageType || 'BA',
                it.templateEmphasizeType || 'NONE',
                it.templateTitle ? String(it.templateTitle).slice(0, 50) : null,
                it.templateSubtitle || null,
                it.templateImageName || null,
                it.templateExtra || null,
                it.templateAd ? String(it.templateAd).slice(0, 100) : null,
                it.securityFlag === true,
                JSON.stringify(imc.fromImcButtons(it.quickReplyList)),
                it.templateHeader || null,
                it.templateItemHighlight ? JSON.stringify(it.templateItemHighlight) : null,
                it.templateItem?.list ? JSON.stringify(it.templateItem.list) : null,
                it.templateItem?.summary ? JSON.stringify(it.templateItem.summary) : null,
                representLink ? JSON.stringify(representLink) : null,
                it.templatePreviewMessage || null,
                it.alarmPhoneNumber || null,
                it.serviceMode || 'PRD',
                it.customTemplateCode || null,
                it.rejectReason || null,
                approvedAt,
                // ★과거 확정분이라 검수 알림 대상이 아니다 — 종결 상태를 미리 기록해 5분 폴링·알림 루프 진입 차단
                importedAlarmNotifiedStatus(status),
                it.createdAt || null,
              ],
            );
            presentCodes.add(entry.code);
            created += 1;
          } catch (insErr: any) {
            failures.push({ templateCode: entry.code, error: String(insErr?.message || insErr).slice(0, 200) });
          }
        }
      } else {
        for (const entry of toCreate) presentCodes.add(entry.code);
      }

      // 대조 — 게이트웨이 B_ 코드 집합 − 한줄로 보유 집합. 빈 배열일 때만 통과(6원칙 ②)
      const missing = classifyMissingSeedCodes({
        seedBCodes: target.seedBCodes,
        codeSenderKey: target.codeSenderKey,
        presentCodes,
        connectedSenderKeys,
        imc: imcIndex,
      });

      // 효과 검증 — 실행분은 DB 재카운트 후에만 수치 보고
      let finalCount: number | null = null;
      if (!dryRun) {
        const recount = await query(
          `SELECT COUNT(*)::int AS cnt FROM kakao_templates WHERE company_id = $1::uuid`,
          [target.companyId],
        );
        finalCount = recount.rows[0]?.cnt ?? null;
      }

      // ★상한에 걸려 덜 처리된 것과 진짜 결함을 구분한다 — 둘 다 sender_not_connected로 보이면
      //   재실행하면 끝날 일을 결함으로 오판한다(반대도 마찬가지라 더 위험).
      const budgetStopped =
        deferred > 0 || senderReport.some((s: any) => s.state === 'budget_exhausted');
      const byReason = summarizeMissing(missing);
      // not_in_imc = IMC에 없는 게이트웨이 고아 코드 → 코드로 해결 불가·사람 판단(자동 삭제 금지 원칙).
      // 이걸 빼고도 0이 아니면 그건 우리가 손볼 수 있는 누락이다.
      const actionableMissing = missing.length - byReason.not_in_imc;

      report.push({
        companyId: target.companyId,
        companyName: target.companyName,
        billIds: target.billIds,
        senderKeys: target.senderKeys.length,
        gatewayBCodes: target.seedBCodes.length,
        nonBRowsExcluded: target.nonBRows,
        senders: senderReport,
        [dryRun ? 'wouldCreate' : 'created']: dryRun ? toCreate.length : created,
        deferredByBudget: deferred,
        incompleteByBudget: budgetStopped,
        failed: failures.length,
        failures: failures.slice(0, 5),
        reconcile: {
          passed: missing.length === 0,
          actionableMissing,
          missingCount: missing.length,
          byReason,
          samples: missing.slice(0, 20),
        },
        templatesForCompanyAfterRun: finalCount,
      });

      console.log(
        `[gateway-templates][bulk-migrate]${dryRun ? '[dryRun]' : ''} ${target.companyName} ` +
          `keys=${target.senderKeys.length} gatewayB=${target.seedBCodes.length} ` +
          `${dryRun ? 'would' : ''}create=${dryRun ? toCreate.length : created} ` +
          `missing=${missing.length} ${JSON.stringify(summarizeMissing(missing))}`,
      );
    }

    const noFailures = report.every((r) => r.failed === 0);
    const passedAll = noFailures && report.every((r) => r.reconcile.passed);
    // 사람 판단 대상(게이트웨이 고아 코드)만 남은 상태 = 코드로 할 일은 끝난 것 — 엄격 통과와 구분해 보고
    const actionableResolved = noFailures && report.every((r) => r.reconcile.actionableMissing === 0);
    const budgetIncomplete = report.some((r) => r.incompleteByBudget);

    return res.json({
      success: passedAll,
      dryRun,
      imc: { scannedTemplates: imcIndex.total, pages: imcPages, senderKeyMissingItems: imcIndex.senderKeyMissing },
      totalCompanies,
      offset,
      processedCompanies: targets.length,
      remainingCompanies: Math.max(0, totalCompanies - (offset + targets.length)),
      budgetLeft: { profiles: profileBudget, templates: templateBudget },
      // 상한에 걸려 덜 처리됐다는 뜻 — 같은 offset으로 재실행하면 이어서 처리된다(멱등)
      incompleteByBudget: budgetIncomplete,
      allReconcilePassed: passedAll,
      allActionableResolved: actionableResolved,
      report,
    });
  } catch (err) {
    return handleDbError(res, err);
  }
});

// ── 기존 이관분 검수 알림 억제 백필 (0715 아난티 847건 — §4-9-H)
//    0715 import 경로가 alarm_notified_status를 안 채워, 과거 확정 템플릿이 5분 폴링·검수 알림 대상으로
//    영구 잔존한다(0720 실측: 폴링 대상 747 전량이 아난티 이관분). 신규 이관분은 INSERT에서 채우고,
//    이미 들어간 분은 여기서 맞춘다.
//
//    대상 한정(정상 등록 건 오염 차단):
//      ① 게이트웨이 bill이 연결된 회사   ② 검수 종결 상태   ③ alarm_notified_status 미기록
//      ④ requested_at IS NULL + created_by IS NULL = import 경로 산물 표식
//         (관리자·고객사 등록 경로는 requested_at을 항상 채운다 — admin.ts·companies.ts INSERT)
router.post('/imported-alarm-suppress', async (req: Request, res: Response) => {
  try {
    const dryRun = req.body?.dryRun !== false; // 기본 true
    const WHERE = `
        t.status IN ('APPROVED','REJECTED','KREJ')
    AND t.alarm_notified_status IS NULL
    AND t.requested_at IS NULL
    AND t.created_by IS NULL
    AND EXISTS (
          SELECT 1 FROM gateway_bill_mappings b
           WHERE b.company_id = t.company_id AND b.is_active = true
        )`;

    if (dryRun) {
      const preview = await query(
        `SELECT c.company_name, t.status, COUNT(*)::int AS cnt
           FROM kakao_templates t
           LEFT JOIN companies c ON c.id = t.company_id
          WHERE ${WHERE}
          GROUP BY c.company_name, t.status
          ORDER BY cnt DESC`,
      );
      const total = preview.rows.reduce((sum: number, r: any) => sum + r.cnt, 0);
      return res.json({ success: true, dryRun: true, wouldUpdate: total, breakdown: preview.rows });
    }

    const upd = await query(
      `UPDATE kakao_templates t
          SET alarm_notified_status = CASE WHEN t.status = 'APPROVED' THEN 'APPROVED' ELSE 'REJECTED' END,
              updated_at = now()
        WHERE ${WHERE}`,
    );

    // 효과 검증(6원칙 ②) — 잔존 재카운트 후에만 성공 표시
    const remain = await query(
      `SELECT COUNT(*)::int AS cnt FROM kakao_templates t WHERE ${WHERE}`,
    );
    console.log(
      `[gateway-templates][imported-alarm-suppress] updated=${upd.rowCount || 0} 잔존=${remain.rows[0].cnt}`,
    );
    return res.json({
      success: remain.rows[0].cnt === 0,
      dryRun: false,
      updated: upd.rowCount || 0,
      remaining: remain.rows[0].cnt,
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
