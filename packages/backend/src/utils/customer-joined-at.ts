/**
 * customer-joined-at.ts — 고객이 실제로 가입한 때(customers.joined_at) 쓰기 · 읽기 한 곳(★ 2026-11-02 설계서 docs/2026-11-02-journey-automarketing-core-fix-design.md 3-6 · 3-0 CT-J6 · D19 · D20).
 *
 * 왜 있나
 *   신규 가입 판정이 「우리가 처음 본 때(created_at)」 · 「구매 · 포인트가 없음」이라, 싱크 · 엑셀로 처음 들어온 옛 고객이 신규 환영 문자를 받고
 *   가입 포인트 · 첫 구매가 같이 들어온 진짜 신규는 빠졌다. → 가입 사실이 있는 길만 이 칸을 쓰고, 신규 판정은 이 칸만 본다.
 *
 * 쓰는 길(근거가 있을 때만 · 그 밖 = NULL)
 *   - 자사몰 회원 가입 사건 = 몰이 준 가입 시각(cdp-identity joinedAt)
 *   - 싱크 incremental 의 처음 보는 번호 · 화면에서 고객 추가 · 엑셀 [신규 고객으로 올리기] = 원천 가입일(표준 필드 가입일)이 없으면 받은 시각(stampFirstSeenJoinedAt)
 *   - 싱크 full · 엑셀 기본 · 자사몰 주문 · 백필 = 원천 가입일이 있을 때만(받은 시각은 쓰지 않는다)
 *   이미 있는 행을 다시 쓰면 = 두 값 중 이른 값(joinedAtUpsertSql · 늦게 들어온 값이 진짜 가입 시각을 덮어 다시 신규로 잡히지 않게 · 지우기 0).
 */
import { query } from '../config/database';

/** 신규 가입 시작 사건의 나이 상한(시간) — 오래전 가입이 늦게 들어와도 환영 문자 0(시스템 멈춤 뒤 받는 사건과 같은 나이 · 설계서 3-6 · §4 ②) */
export const SIGNUP_MAX_AGE_HOURS = 72;

/** 이미 있는 고객 행을 다시 쓸 때의 가입 시각 = 이른 값(한쪽 NULL = 다른 쪽) */
export function joinedAtUpsertSql(existing: string, incoming: string): string {
  return `LEAST(COALESCE(${incoming}, ${existing}), COALESCE(${existing}, ${incoming}))`;
}

type SqlRun = (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }>;

/**
 * 이번 쓰기가 처음 만든 고객 행(그 회사에 없던 번호 · 키 = 회사 + 번호)에 받은 시각을 가입으로 — 그 길이 가입 사실일 때만 부른다.
 *   원천 가입일이 이미 들어온 행은 그대로(NULL 일 때만).
 */
export async function stampFirstSeenJoinedAt(run: SqlRun, companyId: string, insertedPhones: string[]): Promise<void> {
  if (insertedPhones.length === 0) return;
  await run(
    `UPDATE customers SET joined_at = NOW() WHERE company_id = $1::uuid AND phone = ANY($2::text[]) AND joined_at IS NULL`,
    [companyId, insertedPhones],
  );
}

/** 업서트 RETURNING (is_insert · phone) 에서 처음 만든 행의 번호 */
export function insertedPhonesOf(rows: Array<{ is_insert?: boolean; phone?: string | null }>): string[] {
  return rows.filter((r) => r.is_insert === true && r.phone).map((r) => String(r.phone));
}

/**
 * 신규 가입 판정 조각 — 가입 근거가 있고 기준 시각(sinceRef · SQL 식) 뒤에 가입했다.
 *   여정 = 기준선 시각과 지금 − 72시간 중 늦은 쪽 · 자동마케팅 「새로 가입한 고객」 · 여정 추천 「지난 7일 신규」 = 그 기간 시작.
 */
export function newSignupSql(alias: string, sinceRef: string): string {
  return `(${alias}.joined_at IS NOT NULL AND ${alias}.joined_at >= ${sinceRef})`;
}

/**
 * 가입 근거 값이 날짜뿐인가 — 원천 가입일(표준 필드 「가입일」 = 날짜 칸 · normalizeDate)은 세션 시간대의 자정으로 저장된다(운영 = UTC 자정 · KST 세션이면 KST 자정).
 *   시각이 있는 근거(몰 가입 시각 · 받은 시각)가 정확히 그 자정일 확률은 초 단위 1/86400 · 그때도 날짜 단위 비교가 될 뿐(빠짐 0).
 */
export function joinedAtDateOnlySql(alias: string): string {
  return `((${alias}.joined_at AT TIME ZONE 'UTC')::time = '00:00:00' OR (${alias}.joined_at AT TIME ZONE 'Asia/Seoul')::time = '00:00:00')`;
}

/**
 * ★ 2026-11-02 설계서 3-5 ② · 3-6 — 신규 가입 여정의 기준 시각(고객 행마다 · baselineExpr = 그 여정 entry_baseline_at 식).
 *   시각이 있는 가입 = 기준선 시각 그대로(사람이 멈춘 동안 가입해 다시 켠 뒤 늦게 적재돼도 0) ·
 *   날짜뿐인 가입 = 기준선 그날 KST 시작(켠 날 켠 뒤 가입한 고객이 그날 자정 값이라 빠지지 않게 · 그날 켜기 전 적재된 번호는 원장이 막는다) · 둘 다 72시간 안.
 */
export function journeySignupSinceSql(alias: string, baselineExpr: string): string {
  const dayStart = `((((${baselineExpr}) AT TIME ZONE 'Asia/Seoul')::date)::timestamp AT TIME ZONE 'Asia/Seoul')`;
  return `GREATEST(CASE WHEN ${joinedAtDateOnlySql(alias)} THEN ${dayStart} ELSE (${baselineExpr}) END, NOW() - INTERVAL '${SIGNUP_MAX_AGE_HOURS} hours')`;
}

/** 그 회사에 가입 근거가 있는 고객이 한 명이라도 있는가(신규 가입 여정 켜기 · 자동마케팅 새로 가입 축 · 칸이 없으면 = DDL 전 = 없음) */
export async function hasJoinedAtEvidence(companyId: string): Promise<boolean> {
  try {
    const r = await query(`SELECT EXISTS (SELECT 1 FROM customers WHERE company_id = $1::uuid AND joined_at IS NOT NULL) AS ok`, [companyId]);
    return r.rows[0]?.ok === true;
  } catch (e: any) {
    if (e?.code === '42703') return false;
    throw e;
  }
}

/** 가입 근거가 없을 때의 사람 말(켜기 · 화면 잠금 사유 · 한 곳) */
export const NO_JOINED_AT_REASON = '가입한 때를 알 수 있는 정보가 아직 없어요. 자사몰 회원 연동이나 싱크 가입일이 들어오면 열립니다.';

/** 원천이 준 가입 시각(문자열 · 숫자) → 시각 그대로(날짜만 남기지 않는다 · 켠 날 가입을 기준 시각과 바로 비교) · 못 읽으면 NULL */
export function joinedAtFromSource(v: unknown): string | null {
  if (v == null || String(v).trim() === '') return null;
  const d = new Date(String(v).trim());
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * ★ 2026-11-02 설계서 3-6 — 엑셀 올리기 한 번 묻기: 켜진 신규 가입 여정이 있는 회사에서 그 회사에 없는 번호가 든 파일이면
 *   「새 번호 N명이 '여정 이름' 환영 문자를 받습니다」 + [기존 고객으로 올리기](기본) / [신규 고객으로 올리기]. 아니면 null(묻지 않는다).
 */
export async function uploadSignupQuestion(companyId: string, phones: string[]): Promise<{ newPhones: number; journeys: string[] } | null> {
  if (phones.length === 0) return null;
  const j = await query(
    `SELECT name FROM journeys WHERE company_id = $1::uuid AND status = 'active' AND trigger_event = 'customer.created' ORDER BY name LIMIT 5`,
    [companyId],
  );
  if (j.rows.length === 0) return null;
  const n = await query(
    `SELECT COUNT(*)::int AS n FROM (SELECT DISTINCT p FROM unnest($2::text[]) AS p) u
      WHERE NOT EXISTS (SELECT 1 FROM customers c WHERE c.company_id = $1::uuid AND c.phone = u.p)`,
    [companyId, phones],
  );
  const newPhones = Number(n.rows[0]?.n || 0);
  return newPhones > 0 ? { newPhones, journeys: j.rows.map((r: any) => String(r.name || '여정')) } : null;
}
