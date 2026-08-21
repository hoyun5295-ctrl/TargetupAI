/**
 * /api/pay-mappings/* — PAY(엔진) 고객 ↔ 한줄로 회사 매핑 시드 (super_admin 전용, 2026-07-20)
 *
 * 원천 = 서팀장 「PAY_회사단위_실고객.xlsx」(실체 155·내부제외 27) + RSRM_Mem 접속 원장(0720 실측).
 * 정책(Harold 확정):
 *   - 실체 1 = 회사 1 + 메인 아이디 1. 다계정(CustId N)은 전부 그 회사에 연결 → 통계 합산 1화면
 *   - link: 기존/카카오축 회사에 CustId 연결. 웹 회사면 usage_type 'web'→'both' 전환(웹 메뉴 유지)
 *   - create: 회사(agent·FREE) + 메인 계정(걔네가 쓰던 아이디 — 카카오 핸들 > PAY MemId, 비번 일괄+강제변경)
 *   - company_only: 회사+연결만(PAY 로그인을 안 쓰던 곳 — 계정은 요청 시 발급)
 *   - 무실적·내부는 시드에서 제외(파일 단계에서 걸러짐)
 * 멱등: 회사 코드 실존=생성 skip / 계정 실존=skip 보고 / CustId 기연결=skip. dryRun 기본 true.
 */

import { Request, Response, Router } from 'express';
import { authenticate, requireSuperAdmin } from '../middlewares/auth';
import { query } from '../config/database';
import { createCompanyCore, createCompanyAdminUser } from '../utils/company-create';
import { isMissingRelationError } from '../utils/gateway-template-mapping-worker';

const router = Router();
router.use(authenticate as any);
router.use(requireSuperAdmin as any);

// 일괄 생성 계정 최초 비밀번호(Harold 지정 0720) — must_change_password=true라 최초 로그인 시 변경 강제
const PAY_INITIAL_PASSWORD = 'qwer1234';

type SeedAction = 'link' | 'create' | 'company_only';

interface SeedEntity {
  action: SeedAction;
  companyName: string;
  companyCode: string;  // link: 대상 회사 코드 / create·company_only: 생성 코드 (normalize가 필수 보장)
  loginId?: string;     // create 전용
  custIds: string[];
  renameTo?: string;    // link 전용 — 회사명 정정(예: 신성(탑텐몰)→신성통상)
}

function handleDbError(res: Response, err: any): Response {
  if (isMissingRelationError(err)) {
    return res.status(503).json({
      success: false,
      error: 'DB 마이그레이션 필요: 운영자에게 company_agent_ids CREATE 실행 요청 의무',
      code: 'DB_MIGRATION_PENDING',
    });
  }
  console.log('[pay-mappings] 오류:', err?.message || err);
  return res.status(500).json({ success: false, error: '서버 오류' });
}

function normalizeEntity(raw: any, index: number): { ok: true; e: SeedEntity } | { ok: false; error: string } {
  const action = String(raw?.action || '').trim() as SeedAction;
  if (!['link', 'create', 'company_only'].includes(action)) {
    return { ok: false, error: `[${index}] action은 link|create|company_only` };
  }
  const companyName = String(raw?.companyName || '').trim();
  if (!companyName) return { ok: false, error: `[${index}] companyName 필요` };
  const custIds = Array.isArray(raw?.custIds)
    ? raw.custIds.map((c: any) => String(c).trim()).filter(Boolean)
    : [];
  if (custIds.length === 0) return { ok: false, error: `[${index}] ${companyName}: custIds 필요` };
  const companyCode = String(raw?.companyCode || '').trim();
  if (!companyCode) return { ok: false, error: `[${index}] ${companyName}: companyCode 필요` };
  const loginId = String(raw?.loginId || '').trim();
  if (action === 'create' && !loginId) return { ok: false, error: `[${index}] ${companyName}: create는 loginId 필요` };
  if (loginId && /\s/.test(loginId)) return { ok: false, error: `[${index}] ${companyName}: loginId 공백 불가` };
  return {
    ok: true,
    e: { action, companyName, companyCode, loginId: loginId || undefined, custIds, renameTo: String(raw?.renameTo || '').trim() || undefined },
  };
}

router.post('/seed-import', async (req: Request, res: Response) => {
  try {
    const dryRun = req.body?.dryRun !== false; // 기본 true
    const rawEntities: any[] = Array.isArray(req.body?.entities) ? req.body.entities : [];
    if (rawEntities.length === 0) {
      return res.status(400).json({ success: false, error: 'entities 배열 필요' });
    }

    const invalid: string[] = [];
    const entities: SeedEntity[] = [];
    for (let i = 0; i < rawEntities.length; i++) {
      const n = normalizeEntity(rawEntities[i], i);
      if (n.ok) entities.push(n.e);
      else invalid.push(n.error);
    }

    // payload 내 중복 검출 (custId·loginId·companyCode 전역 유일 축)
    const allCust = entities.flatMap((e) => e.custIds);
    const dupCust = [...new Set(allCust.filter((c, i) => allCust.indexOf(c) !== i))];
    const allLogin = entities.map((e) => e.loginId).filter(Boolean) as string[];
    const dupLogin = [...new Set(allLogin.filter((c, i) => allLogin.indexOf(c) !== i))];
    if (dupCust.length || dupLogin.length) {
      return res.status(400).json({
        success: false,
        error: 'payload 내 중복. 시드 데이터 확인 필요',
        dupCustIds: dupCust,
        dupLoginIds: dupLogin,
      });
    }

    // 사전 상태 조회 (dryRun 보고 + 실행 시 skip 판단 공용)
    const codes = entities.map((e) => e.companyCode);
    const compRes = await query(
      `SELECT id, company_code, company_name, usage_type FROM companies WHERE company_code = ANY($1)`,
      [codes],
    );
    const compByCode = new Map<string, any>(compRes.rows.map((c: any) => [String(c.company_code), c]));

    const loginRes = allLogin.length
      ? await query(`SELECT login_id FROM users WHERE login_id = ANY($1)`, [allLogin])
      : { rows: [] as any[] };
    const takenLogins = new Set(loginRes.rows.map((r: any) => String(r.login_id)));

    const custRes = await query(
      `SELECT agent_send_id FROM company_agent_ids WHERE agent_send_id = ANY($1)`,
      [allCust],
    );
    const linkedCust = new Set(custRes.rows.map((r: any) => String(r.agent_send_id)));

    const plan = entities.map((e) => {
      const existing = compByCode.get(e.companyCode);
      const problems: string[] = [];
      if (e.action === 'link' && !existing) problems.push('대상 회사 코드 없음');
      if (e.action !== 'link' && existing) problems.push(`코드 선점(${existing.company_name}): 생성 대신 연결됨`);
      if (e.action === 'create' && e.loginId && takenLogins.has(e.loginId)) problems.push(`loginId 선점(${e.loginId})`);
      const newCust = e.custIds.filter((c) => !linkedCust.has(c));
      return {
        ...e,
        exists: !!existing,
        existingUsage: existing?.usage_type || null,
        willTransitionToBoth: e.action === 'link' && existing?.usage_type === 'web',
        custToLink: newCust.length,
        custAlreadyLinked: e.custIds.length - newCust.length,
        problems,
      };
    });

    if (dryRun) {
      return res.json({
        success: true,
        dryRun: true,
        totalEntities: rawEntities.length,
        valid: entities.length,
        invalid,
        toLink: plan.filter((p) => p.action === 'link').length,
        toCreate: plan.filter((p) => p.action === 'create').length,
        companyOnly: plan.filter((p) => p.action === 'company_only').length,
        toBothTransition: plan.filter((p) => p.willTransitionToBoth).length,
        custIdsTotal: allCust.length,
        custIdsAlreadyLinked: allCust.filter((c) => linkedCust.has(c)).length,
        problems: plan.filter((p) => p.problems.length).map((p) => ({ companyName: p.companyName, problems: p.problems })),
        plan: plan.map(({ custIds, ...rest }) => rest),
      });
    }

    if (invalid.length > 0) {
      return res.status(400).json({ success: false, error: `유효하지 않은 엔트리 ${invalid.length}건`, invalid });
    }
    const hardProblems = plan.filter((p) => p.problems.some((x) => x.includes('대상 회사 코드 없음')));
    if (hardProblems.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'link 대상 회사 부재. 정정 후 실행',
        problems: hardProblems.map((p) => ({ companyName: p.companyName, problems: p.problems })),
      });
    }

    // 신규 회사 플랜 = FREE(미가입) — 카카오축 bulk-create-companies와 동일 정책
    const planRow = await query(`SELECT id FROM plans WHERE plan_code = 'FREE' LIMIT 1`);
    const freePlanId = planRow.rows[0]?.id;
    if (!freePlanId) {
      return res.status(500).json({ success: false, error: "plans에 plan_code='FREE' 없음. 플랜 확인 필요" });
    }

    let companiesCreated = 0;
    let usersCreated = 0;
    let custLinked = 0;
    let bothTransitioned = 0;
    let renamed = 0;
    const skippedLogins: string[] = [];
    const errors: { companyName: string; error: string }[] = [];

    for (const p of plan) {
      try {
        let company = compByCode.get(p.companyCode);

        if (!company) {
          const created = await createCompanyCore({
            companyCode: p.companyCode,
            companyName: p.companyName,
            planId: freePlanId,
            dataInputMethod: 'file',
            usageType: 'agent',
            createdBy: req.user?.userId ?? null,
          });
          company = created;
          compByCode.set(p.companyCode, created);
          companiesCreated += 1;
        } else {
          // link — 웹 회사는 겸용 전환(웹 메뉴 유지·엔진 통계 합산 대상化)
          if (p.willTransitionToBoth) {
            await query(`UPDATE companies SET usage_type = 'both', updated_at = now() WHERE id = $1::uuid`, [company.id]);
            bothTransitioned += 1;
          }
          if (p.renameTo && p.renameTo !== company.company_name) {
            await query(
              `UPDATE companies SET company_name = $2, name = $2, updated_at = now() WHERE id = $1::uuid`,
              [company.id, p.renameTo],
            );
            renamed += 1;
          }
        }

        const loginId = p.action === 'create' ? String(p.loginId || '') : '';
        if (loginId) {
          if (takenLogins.has(loginId)) {
            skippedLogins.push(loginId);
          } else {
            await createCompanyAdminUser(String(company.id), loginId, PAY_INITIAL_PASSWORD, p.companyName);
            takenLogins.add(loginId);
            usersCreated += 1;
          }
        }

        for (const custId of p.custIds) {
          if (linkedCust.has(custId)) continue;
          await query(
            `INSERT INTO company_agent_ids (company_id, agent_send_id, memo) VALUES ($1::uuid, $2, $3)`,
            [company.id, custId, 'PAY CustId (0720 시드)'],
          );
          linkedCust.add(custId);
          custLinked += 1;
        }
      } catch (e: any) {
        errors.push({ companyName: p.companyName, error: String(e?.message || e).slice(0, 200) });
      }
    }

    // 효과 검증(6원칙 ②) — 시드 대상 CustId 실제 연결 수 재카운트 후에만 성공 표시
    const recount = await query(
      `SELECT COUNT(*)::int AS cnt FROM company_agent_ids WHERE agent_send_id = ANY($1)`,
      [allCust],
    );
    console.log(
      `[pay-mappings] seed — companies+${companiesCreated} users+${usersCreated} cust+${custLinked} both+${bothTransitioned} rename+${renamed} errors=${errors.length} → 연결 재카운트 ${recount.rows[0].cnt}/${allCust.length}`,
    );
    return res.json({
      success: errors.length === 0,
      dryRun: false,
      companiesCreated,
      usersCreated,
      skippedLogins,
      custLinked,
      bothTransitioned,
      renamed,
      errors,
      recount: { linkedOfSeed: recount.rows[0].cnt, seedCustIds: allCust.length },
    });
  } catch (err) {
    return handleDbError(res, err);
  }
});

export default router;
