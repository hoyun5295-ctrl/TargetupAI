/**
 * ★ CT: JBN 특별가(C144 · 2026-11-18 Harold · 설계서 docs/2026-11-18-c144-jbn-special-price-design.md)
 *
 * JBN(중진공 대출 대표 모임) 회원에게 모든 유료 요금제 월 구독료 30% 를 할인한다.
 *   요금 = plans 의 JBN 판 행(partner_code 'JBN' · base_plan_id = 원 요금제 · 월정액 0.7배 · 원장 C144-DML-1).
 *     직원이 기존 고객사 상세에서 그 행을 고르면 선불 · 후불 청구가 그 월정액을 읽는다(청구 코드 무수정).
 *   신청 = 공개 /jbn 페이지 → jbn_applications(이 파일) → 슈퍼관리자 「JBN 회원」 탭(ceo · suran)에서 회원 확인 · 회사 연결.
 *   요금제를 실제로 바꾸는 일은 이 파일이 하지 않는다(회사 수정 경로 한 길 · 돈 규칙 두 벌 금지 · 설계서 §1).
 *
 * 개인정보 = 회사명 · 성함 · 닉네임 · 번호 · 궁금한 점 · 접속 IP. 90일 뒤 IP 를 지우고 1년 뒤 행을 지운다(동의 문구 그대로).
 *   감사 기록에는 신청 id · 상태만 남긴다(개인정보 없음 · 1년 뒤 파기 약속을 감사 기록이 깨지 않게).
 */
import { query } from '../config/database';
import { recordAuditLog } from './audit-log';

export const JBN_PARTNER = 'JBN';

/** 공개 주소 호출 상한(IP당) — 가격 보기는 화면 여는 속도 · 신청은 소개 페이지 시연 요청과 같은 한도 */
export const JBN_RATE = {
  plans: { windowMs: 10 * 60 * 1000, max: 60 },
  apply: { windowMs: 10 * 60 * 1000, max: 5 },
} as const;

export const JBN_CONSULT_METHODS = { phone: '전화 상담', visit: '방문 상담', video: '화상 상담' } as const;
export type JbnConsultMethod = keyof typeof JBN_CONSULT_METHODS;

export type JbnStatus = 'pending' | 'verified' | 'rejected';
/** 탭의 단계 = 신청 상태 + 「연결된 회사가 지금 JBN 판 요금제인가」 */
export type JbnStage = 'pending' | 'verified' | 'on' | 'rejected';
export const JBN_STAGES: readonly JbnStage[] = ['pending', 'verified', 'on', 'rejected'];

/** 보관 기한(동의 문구와 같은 값) */
export const JBN_IP_KEEP_DAYS = 90;
export const JBN_KEEP_DAYS = 365;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);
const clip = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// ─────────────────────────────────────────────
// 요금(공개 페이지)
// ─────────────────────────────────────────────

export interface JbnPlan {
  /** 원 요금제 코드(화면이 인프라 문구를 찾는 열쇠 · 신청의 관심 요금제 값) */
  code: string;
  name: string;
  basePrice: number;
  price: number;
  credits: number;
}

/** 활성 JBN 판 + 원 요금제(정가) · 가격 오름차순 */
export const JBN_PLANS_SQL = `
  SELECT b.plan_code AS code, b.plan_name AS name, b.monthly_price AS base_price, j.monthly_price AS price,
         COALESCE(j.ai_credits_per_month, 0) AS credits
    FROM plans j
    JOIN plans b ON b.id = j.base_plan_id
   WHERE j.partner_code = $1 AND j.is_active = true
   ORDER BY j.monthly_price ASC, b.plan_code ASC`;

export async function loadJbnPlans(): Promise<JbnPlan[]> {
  const r = await query(JBN_PLANS_SQL, [JBN_PARTNER]);
  return r.rows.map((x: any) => ({
    code: String(x.code),
    name: String(x.name),
    basePrice: Number(x.base_price) || 0,
    price: Number(x.price) || 0,
    credits: Number(x.credits) || 0,
  }));
}

// ─────────────────────────────────────────────
// 신청(공개)
// ─────────────────────────────────────────────

export interface JbnApplicationInput {
  /** 화면이 신청 하나에 한 번 만든 id = 다시 보내도 한 행 */
  id: string;
  companyName: string;
  ownerName: string;
  nickname: string;
  phone: string;
  interestPlanCode: string | null;
  consultMethod: JbnConsultMethod;
  memo: string;
}

/** 신청 정규화 — 틀리면 화면에 그대로 보여 줄 문장을 돌려준다. 관심 요금제는 지금 활성 JBN 판의 원 코드만(그 밖 = 아직 모름) */
export function parseJbnApplication(body: any, allowedPlanCodes: readonly string[]):
  { ok: true; value: JbnApplicationInput } | { ok: false; error: string } {
  if (!isUuid(body?.id)) return { ok: false, error: '페이지를 새로 고친 뒤 다시 신청해 주세요.' };
  const companyName = clip(body?.companyName, 60);
  const ownerName = clip(body?.ownerName, 30);
  const nickname = clip(body?.nickname, 40);
  const phone = clip(body?.phone, 20).replace(/[^0-9]/g, '');
  const consultMethod = (Object.keys(JBN_CONSULT_METHODS) as JbnConsultMethod[]).find((m) => m === body?.consultMethod) ?? 'phone';
  const memo = clip(body?.memo, 500);
  const plan = typeof body?.interestPlanCode === 'string' ? body.interestPlanCode : '';
  const interestPlanCode = allowedPlanCodes.includes(plan) ? plan : null;
  if (!companyName) return { ok: false, error: '회사명을 입력해 주세요.' };
  if (!ownerName) return { ok: false, error: '대표자 성함을 입력해 주세요.' };
  if (!nickname) return { ok: false, error: 'JBN 단톡방 닉네임을 입력해 주세요. 회원 확인에 씁니다.' };
  if (!/^0\d{8,10}$/.test(phone)) return { ok: false, error: '연락받으실 휴대폰 번호를 확인해 주세요.' };
  if (body?.consent !== true) return { ok: false, error: '개인정보 수집과 이용에 동의해 주셔야 신청을 받을 수 있습니다.' };
  return { ok: true, value: { id: body.id.toLowerCase(), companyName, ownerName, nickname, phone, interestPlanCode, consultMethod, memo } };
}

/** 신청 저장 — 같은 id 는 한 행(응답을 못 받고 다시 보내도). 실패는 삼키지 않는다(저장 안 된 신청을 접수됐다고 하지 않는다) */
export async function insertJbnApplication(v: JbnApplicationInput, ip: string | null): Promise<'created' | 'exists'> {
  const r = await query(
    `INSERT INTO jbn_applications (id, company_name, owner_name, nickname, phone, interest_plan_code, consult_method, memo, ip_address)
     VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::inet)
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [v.id, v.companyName, v.ownerName, v.nickname, v.phone, v.interestPlanCode, v.consultMethod, v.memo, ipOrNull(ip)],
  );
  return r.rows.length > 0 ? 'created' : 'exists';
}

/** inet 칸에 넣을 수 있는 값만(IPv4 에 붙은 ::ffff: 앞머리는 그대로 받는다 · 모르는 꼴은 NULL) */
function ipOrNull(ip: string | null): string | null {
  const s = String(ip || '').trim();
  return /^[0-9a-f:.]+$/i.test(s) && s.length <= 45 ? s : null;
}

// ─────────────────────────────────────────────
// 슈퍼관리자 탭
// ─────────────────────────────────────────────

/** (순수) 단계 = 연결된 회사가 지금 JBN 판이면 「적용 중」 · 아니면 신청 상태 */
export function jbnStageOf(status: JbnStatus, linkedOnJbn: boolean): JbnStage {
  return linkedOnJbn ? 'on' : status;
}

/** (순수) 상태 이동 허용표 — 연결된 신청은 확인을 풀 수 없다(먼저 연결을 끊는다) */
export function canMoveJbnStatus(from: JbnStatus, to: JbnStatus, linked: boolean): boolean {
  if (from === 'pending') return to === 'verified' || to === 'rejected';
  if (from === 'rejected') return to === 'pending';
  if (from === 'verified') return to === 'pending' && !linked;
  return false;
}

export interface JbnApplicationRow {
  id: string;
  createdAt: string;
  companyName: string;
  ownerName: string;
  nickname: string;
  phone: string;
  interestPlanCode: string | null;
  /** 관심 요금제의 이름(원 요금제 코드로 찾음 · 그 요금제가 없어졌으면 null) */
  interestPlanName: string | null;
  consultMethod: JbnConsultMethod;
  memo: string;
  status: JbnStatus;
  statusReason: string | null;
  statusBy: string | null;
  statusAt: string | null;
  companyId: string | null;
  linkedCompanyName: string | null;
  linkedPlanName: string | null;
  linkedBy: string | null;
  linkedAt: string | null;
  stage: JbnStage;
}

/** 「적용 중」 = 지금 요금제가 JBN 판인 회사(신청이 없어도 나온다) */
export interface JbnCompanyRow {
  companyId: string;
  companyName: string;
  planName: string;
  price: number;
  /** 이 회사에 연결된 신청 전부(새 신청이 앞 · 없으면 빈 배열 · Codex 구현 1R = 여러 건이면 전부 보여야 지우기 · 찾기가 된다) */
  applications: JbnApplicationRow[];
}

export interface JbnOverview {
  counts: Record<JbnStage, number>;
  stage: JbnStage;
  applications: JbnApplicationRow[];
  companies: JbnCompanyRow[];
  plans: Array<{ name: string; basePrice: number; price: number; active: boolean; companies: number }>;
  recent: Array<{ at: string; action: string; to: string | null; by: string; companyName: string | null }>;
  /** 신청이 읽기 상한을 넘었다(그때는 오래된 신청이 빠진다 · 화면이 알린다) */
  truncated: boolean;
}

/** 읽기 상한(회원 약 300명 · 넘으면 truncated 로 알린다) */
export const JBN_READ_LIMIT = 2000;

const iso = (v: any): string | null => (v ? new Date(v).toISOString() : null);

function toRow(x: any): JbnApplicationRow {
  const status = (['pending', 'verified', 'rejected'] as const).find((s) => s === x.status) ?? 'pending';
  return {
    id: String(x.id),
    createdAt: new Date(x.created_at).toISOString(),
    companyName: String(x.company_name || ''),
    ownerName: String(x.owner_name || ''),
    nickname: String(x.nickname || ''),
    phone: String(x.phone || ''),
    interestPlanCode: x.interest_plan_code ?? null,
    interestPlanName: x.interest_plan_name ?? null,
    consultMethod: (Object.keys(JBN_CONSULT_METHODS) as JbnConsultMethod[]).find((m) => m === x.consult_method) ?? 'phone',
    memo: String(x.memo || ''),
    status,
    statusReason: x.status_reason ?? null,
    statusBy: x.status_by_label ?? null,
    statusAt: iso(x.status_at),
    companyId: x.company_id ?? null,
    linkedCompanyName: x.linked_company_name ?? null,
    linkedPlanName: x.linked_plan_name ?? null,
    linkedBy: x.linked_by_label ?? null,
    linkedAt: iso(x.linked_at),
    stage: jbnStageOf(status, x.on_jbn === true),
  };
}

/** 신청 한 줄 + 연결 회사의 지금 요금제(id 하나 또는 전체) */
const APPLICATION_SELECT = `
  SELECT a.*, c.company_name AS linked_company_name, p.plan_name AS linked_plan_name,
         COALESCE(p.partner_code = $1, false) AS on_jbn, ip.plan_name AS interest_plan_name
    FROM jbn_applications a
    LEFT JOIN companies c ON c.id = a.company_id
    LEFT JOIN plans p ON p.id = c.plan_id
    LEFT JOIN plans ip ON ip.plan_code = a.interest_plan_code`;

/** 찾기(회사명 · 성함 · 닉네임 · 번호 · 연결 회사명) — 글자 그대로 포함 · 번호는 숫자만 견준다 */
export function matchesJbnSearch(r: JbnApplicationRow, q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  const digits = t.replace(/[^0-9]/g, '');
  const hay = [r.companyName, r.ownerName, r.nickname, r.linkedCompanyName || ''].join(' ').toLowerCase();
  return hay.includes(t) || (digits.length >= 3 && r.phone.includes(digits));
}

export function parseJbnOverviewQuery(q: any): { stage: JbnStage; q: string } {
  const stage = JBN_STAGES.find((s) => s === q?.stage) ?? 'pending';
  return { stage, q: clip(q?.q, 60) };
}

export async function loadJbnOverview(input: { stage: JbnStage; q: string }): Promise<JbnOverview> {
  const [apps, cos, plans, recent] = await Promise.all([
    query(`${APPLICATION_SELECT} ORDER BY a.created_at DESC LIMIT $2`, [JBN_PARTNER, JBN_READ_LIMIT + 1]),
    query(
      `SELECT c.id AS company_id, c.company_name, p.plan_name, p.monthly_price
         FROM companies c JOIN plans p ON p.id = c.plan_id
        WHERE p.partner_code = $1
        ORDER BY c.company_name ASC`,
      [JBN_PARTNER],
    ),
    query(
      `SELECT j.plan_name, b.monthly_price AS base_price, j.monthly_price AS price, j.is_active,
              (SELECT COUNT(*)::int FROM companies c WHERE c.plan_id = j.id) AS companies
         FROM plans j JOIN plans b ON b.id = j.base_plan_id
        WHERE j.partner_code = $1
        ORDER BY j.monthly_price ASC`,
      [JBN_PARTNER],
    ),
    query(
      `SELECT l.created_at, l.action, l.details ->> 'to' AS to_status, COALESCE(u.login_id, '') AS by_label,
              a.company_name
         FROM audit_logs l
         LEFT JOIN super_admins u ON u.id = l.user_id
         LEFT JOIN jbn_applications a ON a.id::text = l.target_id::text
        WHERE l.action = ANY($1::text[])
        ORDER BY l.created_at DESC LIMIT 8`,
      [Object.values(JBN_AUDIT)],
    ),
  ]);
  const truncated = apps.rows.length > JBN_READ_LIMIT;
  const all = apps.rows.slice(0, JBN_READ_LIMIT).map(toRow);
  const counts: Record<JbnStage, number> = { pending: 0, verified: 0, on: cos.rows.length, rejected: 0 };
  for (const r of all) if (r.stage !== 'on') counts[r.stage] += 1;
  // 회사마다 연결된 신청 전부(신청은 새 것부터 읽었으니 배열도 새 것이 앞)
  const byCompany = new Map<string, JbnApplicationRow[]>();
  for (const r of all) if (r.companyId) byCompany.set(r.companyId, [...(byCompany.get(r.companyId) ?? []), r]);
  const companies: JbnCompanyRow[] = cos.rows.map((c: any) => ({
    companyId: String(c.company_id),
    companyName: String(c.company_name || ''),
    planName: String(c.plan_name || ''),
    price: Number(c.monthly_price) || 0,
    applications: byCompany.get(String(c.company_id)) ?? [],
  }));
  const qq = input.q;
  return {
    counts,
    stage: input.stage,
    applications: input.stage === 'on' ? [] : all.filter((r) => r.stage === input.stage && matchesJbnSearch(r, qq)),
    companies: input.stage === 'on'
      ? companies.filter((c) => !qq || c.companyName.toLowerCase().includes(qq.toLowerCase()) || c.applications.some((a) => matchesJbnSearch(a, qq)))
      : [],
    plans: plans.rows.map((p: any) => ({
      name: String(p.plan_name || ''), basePrice: Number(p.base_price) || 0, price: Number(p.price) || 0,
      active: p.is_active === true, companies: Number(p.companies) || 0,
    })),
    recent: recent.rows.map((l: any) => ({
      at: new Date(l.created_at).toISOString(), action: String(l.action), to: l.to_status ?? null,
      by: String(l.by_label || ''), companyName: l.company_name ?? null,
    })),
    truncated,
  };
}

export const JBN_AUDIT = { status: 'jbn_status', link: 'jbn_link', remove: 'jbn_delete', purge: 'jbn_purge' } as const;

export type JbnWriteResult =
  | { ok: true; row: JbnApplicationRow }
  | { ok: false; status: 400 | 404 | 409; code: string; error: string; row?: JbnApplicationRow };

async function loadOne(id: string): Promise<JbnApplicationRow | null> {
  const r = await query(`${APPLICATION_SELECT} WHERE a.id = $2::uuid`, [JBN_PARTNER, id]);
  return r.rows[0] ? toRow(r.rows[0]) : null;
}

const notFound: JbnWriteResult = { ok: false, status: 404, code: 'NOT_FOUND', error: '신청을 찾을 수 없습니다.' };

/** 회원 확인 · 회원 아님 · 되돌리기 — 요청이 본 상태(from)와 지금 상태가 같을 때만(두 관리자 동시 조작 · 오래 열린 화면 차단) */
export async function changeJbnStatus(
  id: string, body: any, actor: { userId: string | null; label: string }, req?: any,
): Promise<JbnWriteResult> {
  if (!isUuid(id)) return notFound;
  const statuses = ['pending', 'verified', 'rejected'] as const;
  const from = statuses.find((s) => s === body?.from);
  const to = statuses.find((s) => s === body?.to);
  if (!from || !to || !canMoveJbnStatus(from, to, false)) {
    return { ok: false, status: 400, code: 'BAD_MOVE', error: '바꿀 수 없는 상태입니다.' };
  }
  const reason = to === 'rejected' ? clip(body?.reason, 200) || null : null;
  const r = await query(
    `UPDATE jbn_applications
        SET status = $3, status_reason = $4, status_by_label = $5, status_at = now()
      WHERE id = $1::uuid AND status = $2 AND ($3 <> 'pending' OR company_id IS NULL)
      RETURNING id`,
    [id, from, to, reason, actor.label],
  );
  const row = await loadOne(id);
  if (r.rows.length === 0) {
    if (!row) return notFound;
    const error = row.status === 'verified' && row.companyId && to === 'pending'
      ? '회사가 연결된 신청입니다. 연결을 먼저 끊어 주세요.'
      : '다른 화면에서 먼저 바뀌었습니다. 지금 상태로 다시 그렸습니다.';
    return { ok: false, status: 409, code: 'STATE_CHANGED', error, row };
  }
  await recordAuditLog({ actorUserId: actor.userId, action: JBN_AUDIT.status, targetType: 'jbn_application', targetId: id, details: { from, to }, req });
  return { ok: true, row: row! };
}

/** 회사 연결 · 끊기 — 확인된 신청만 · 요청이 본 직전 연결값(expectedCompanyId)과 지금 값이 같을 때만 */
export async function linkJbnCompany(
  id: string, body: any, actor: { userId: string | null; label: string }, req?: any,
): Promise<JbnWriteResult> {
  if (!isUuid(id)) return notFound;
  const companyId = body?.companyId === null ? null : body?.companyId;
  const expected = body?.expectedCompanyId === null ? null : body?.expectedCompanyId;
  if ((companyId !== null && !isUuid(companyId)) || (expected !== null && !isUuid(expected))) {
    return { ok: false, status: 400, code: 'BAD_COMPANY', error: '회사를 다시 골라 주세요.' };
  }
  let r;
  try {
    r = await query(
      `UPDATE jbn_applications
          SET company_id = $2::uuid, linked_by_label = $4,
              linked_at = CASE WHEN $2::uuid IS NULL THEN NULL ELSE now() END
        WHERE id = $1::uuid AND status = 'verified' AND company_id IS NOT DISTINCT FROM $3::uuid
        RETURNING id`,
      [id, companyId, expected, actor.label],
    );
  } catch (err: any) {
    if (err?.code === '23503') return { ok: false, status: 400, code: 'COMPANY_NOT_FOUND', error: '없는 회사입니다. 다시 찾아 주세요.' };
    throw err;
  }
  const row = await loadOne(id);
  if (r.rows.length === 0) {
    if (!row) return notFound;
    const error = row.status !== 'verified'
      ? 'JBN 회원 확인을 먼저 해 주세요.'
      : '다른 화면에서 먼저 연결이 바뀌었습니다. 지금 연결로 다시 그렸습니다.';
    return { ok: false, status: 409, code: 'STATE_CHANGED', error, row };
  }
  await recordAuditLog({ actorUserId: actor.userId, action: JBN_AUDIT.link, targetType: 'jbn_application', targetId: id, details: { to: companyId ? 'linked' : 'unlinked', companyId }, req });
  return { ok: true, row: row! };
}

/** 신청 지우기(본인 요청 등) — 감사 기록에는 id 만 */
export async function deleteJbnApplication(id: string, actor: { userId: string | null }, req?: any): Promise<boolean> {
  if (!isUuid(id)) return false;
  const r = await query(`DELETE FROM jbn_applications WHERE id = $1::uuid RETURNING id`, [id]);
  if (r.rows.length === 0) return false;
  await recordAuditLog({ actorUserId: actor.userId, action: JBN_AUDIT.remove, targetType: 'jbn_application', targetId: id, details: { to: 'deleted' }, req });
  return true;
}

/** ★ 2026-11-19 C145 — 방문 기록의 「누구」(신청 id → 닉네임 · 회사명) · 방문 CT(utils/public-visits.ts)는 신청 표를 모른다 */
export async function loadJbnApplicationNames(ids: string[]): Promise<Map<string, { nickname: string; companyName: string }>> {
  const ok = ids.filter(isUuid);
  if (ok.length === 0) return new Map();
  const r = await query(`SELECT id::text AS id, nickname, company_name FROM jbn_applications WHERE id = ANY($1::uuid[])`, [ok]);
  return new Map(r.rows.map((x: any) => [String(x.id), { nickname: String(x.nickname || ''), companyName: String(x.company_name || '') }]));
}

// ─────────────────────────────────────────────
// 보관 기한
// ─────────────────────────────────────────────

/** 90일 지난 신청의 IP 를 지우고 1년 지난 신청을 지운다(동의 문구 = 「신청일로부터 1년 뒤 파기 · 접속 IP 는 90일」) */
export async function purgeJbnApplicationPii(): Promise<{ ipCleared: number; deleted: number }> {
  const ip = await query(
    `UPDATE jbn_applications SET ip_address = NULL
      WHERE ip_address IS NOT NULL AND created_at < now() - make_interval(days => $1)`,
    [JBN_IP_KEEP_DAYS],
  );
  const del = await query(`DELETE FROM jbn_applications WHERE created_at < now() - make_interval(days => $1)`, [JBN_KEEP_DAYS]);
  const out = { ipCleared: ip.rowCount ?? 0, deleted: del.rowCount ?? 0 };
  if (out.ipCleared > 0 || out.deleted > 0) {
    await recordAuditLog({ action: JBN_AUDIT.purge, targetType: 'jbn_application', details: out });
  }
  return out;
}

const isSchemaMissing = (err: any): boolean => err?.code === '42P01' || err?.code === '42703';

let _retentionTimer: NodeJS.Timeout | null = null;
/** 기동 1분 뒤 + 24시간마다(표가 없으면 = DDL 전 = 조용히 넘김) */
export function startJbnRetentionWorker(): void {
  if (_retentionTimer) return;
  const tick = () => {
    purgeJbnApplicationPii().catch((err) => {
      if (!isSchemaMissing(err)) console.error('[jbn] 보관 기한 정리 실패', err?.message || err);
    });
  };
  setTimeout(tick, 60 * 1000).unref();
  _retentionTimer = setInterval(tick, 24 * 60 * 60 * 1000);
  _retentionTimer.unref();
  console.log('[jbn] 보관 기한 워커 시작(1분 뒤 + 24시간)');
}
