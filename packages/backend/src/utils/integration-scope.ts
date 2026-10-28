/**
 * ★ CT: 자사몰 연동 권한·범위 (2026-09-18 · 설계서 docs/2026-09-18-mall-integration-user-scope-design.md §2 · §3-2)
 *
 * 상시 원칙(Harold): 고객사 관리자는 전부를 본다. 사용자는 분류코드에 의해 자기 것만 본다.
 *   → 관리자는 회사 전체의 연동을 다루고, 분류코드가 배정된 사용자는 자기 분류코드의 몰만 연결·조회·해제한다.
 *   발단 = 이에스페이먼트(몰 4 · 관리자 1 · 몰별 사용자 4). 그 전까지 연결은 관리자 한정이었고
 *   "사용자마다 자사몰이 따로 있는 회사"는 설계에서 다룬 적이 없다.
 *
 * ⛔ 분류코드는 요청 본문에서 오지 않는다. 세션 사용자의 users.store_codes 를 DB 에서 다시 읽어 정한다
 *   (토큰에는 분류코드가 없다 · 토큰 어휘만으로 권한을 넓힌 사고 기록 = status/SCHEMA.md users 절).
 *   본문 값은 "자기 코드 중 어느 것인가"를 고르는 선택지일 뿐이고, 자기 코드 밖이면 거부한다.
 * ⛔ 회사 공용(분류코드 없는) 몰은 사용자가 다루지 못한다 — 관리자가 붙인 회사 전체의 자산이다.
 * ⛔ 잠금 사유 문장은 여기 한 곳이 소유한다(화면이 권한을 계산하거나 문구를 지어내지 않는다).
 */
import { query, withTransaction, type TxRun } from '../config/database';
import { UserFacingError } from './http-error';

export type IntegrationBlockReason = 'NO_COMPANY' | 'NOT_ALLOWED' | 'NO_STORE_CODE';

export type IntegrationActor =
  | { kind: 'admin'; companyId: string }
  | { kind: 'user'; companyId: string; storeCodes: string[] }
  | { kind: 'blocked'; reason: IntegrationBlockReason };

export type StoreCodePickFailure = 'NOT_ALLOWED' | 'STORE_CODE_REQUIRED' | 'STORE_CODE_NOT_YOURS' | 'STORE_CODE_UNKNOWN';
export type StoreCodePick = { ok: true; storeCode: string | null } | { ok: false; code: StoreCodePickFailure };

export type IntegrationLockCode =
  | IntegrationBlockReason
  | StoreCodePickFailure
  | 'MALL_OWNED_BY_OTHER_STORE'
  | 'STORE_CODE_CHANGE_NOT_SUPPORTED'
  | 'STORE_CODE_MODE_MIXED';

const cleanCodes = (raw: unknown): string[] =>
  (Array.isArray(raw) ? raw : [])
    .map((c) => (typeof c === 'string' ? c.trim() : ''))
    .filter((c) => c.length > 0);

const cleanCode = (raw: unknown): string => (typeof raw === 'string' ? raw.trim() : '');

/** 세션 사용자 → 연동을 다루는 주체. 관리자는 DB 를 읽지 않는다. 사용자는 분류코드를 DB 에서 다시 읽는다. */
export async function resolveIntegrationActor(
  user: { userId?: string; companyId?: string; userType?: string } | undefined | null,
): Promise<IntegrationActor> {
  const companyId = user?.companyId;
  if (!user || !companyId) return { kind: 'blocked', reason: 'NO_COMPANY' };
  if (user.userType === 'company_admin') return { kind: 'admin', companyId };
  if (user.userType !== 'company_user' || !user.userId) return { kind: 'blocked', reason: 'NOT_ALLOWED' };
  const r = await query('SELECT store_codes FROM users WHERE id = $1 AND company_id = $2', [user.userId, companyId]);
  const storeCodes = cleanCodes(r.rows[0]?.store_codes);
  if (storeCodes.length === 0) return { kind: 'blocked', reason: 'NO_STORE_CODE' };
  return { kind: 'user', companyId, storeCodes };
}

/** 이 주체가 그 몰 행을 보고 다룰 수 있는가. */
export function canTouchIntegration(actor: IntegrationActor, rowStoreCode: string | null | undefined): boolean {
  if (actor.kind === 'admin') return true;
  if (actor.kind !== 'user') return false;
  const code = cleanCode(rowStoreCode);
  return code.length > 0 && actor.storeCodes.includes(code);
}

/** 회사의 분류코드 등록부(companies.store_code_list · 문자열 배열). */
export async function listCompanyStoreCodes(companyId: string): Promise<string[]> {
  const r = await query('SELECT store_code_list FROM companies WHERE id = $1', [companyId]);
  return cleanCodes(r.rows[0]?.store_code_list);
}

/**
 * 새 몰을 어떤 분류코드로 붙일 것인가.
 * - 사용자: 코드가 1개면 그 값(요청 값은 확인용) · 여러 개면 자기 코드 중에서 고른 값.
 * - 관리자: 비우면 회사 공용(null) · 고르면 등록부에 있는 값만.
 */
export async function pickStoreCodeForConnect(actor: IntegrationActor, requested: unknown): Promise<StoreCodePick> {
  const want = cleanCode(requested);
  if (actor.kind === 'user') {
    if (actor.storeCodes.length === 1) {
      if (want && want !== actor.storeCodes[0]) return { ok: false, code: 'STORE_CODE_NOT_YOURS' };
      return { ok: true, storeCode: actor.storeCodes[0] };
    }
    if (!want) return { ok: false, code: 'STORE_CODE_REQUIRED' };
    if (!actor.storeCodes.includes(want)) return { ok: false, code: 'STORE_CODE_NOT_YOURS' };
    return { ok: true, storeCode: want };
  }
  if (actor.kind === 'admin') {
    if (!want) return { ok: true, storeCode: null };
    const registry = await listCompanyStoreCodes(actor.companyId);
    if (!registry.includes(want)) return { ok: false, code: 'STORE_CODE_UNKNOWN' };
    return { ok: true, storeCode: want };
  }
  return { ok: false, code: 'NOT_ALLOWED' };
}

/** 잠금·거부 사유 문장 — 고객이 읽는 말이다(내부 낱말·줄표·모델명 0). */
export function integrationLockMessage(code: IntegrationLockCode): string {
  switch (code) {
    case 'NO_STORE_CODE':
      return '분류 코드가 배정되지 않은 계정입니다. 회사 관리자에게 분류 코드 배정을 요청해 주세요.';
    case 'NOT_ALLOWED':
      return '이 계정으로는 자사몰을 연결할 수 없습니다. 회사 관리자 또는 분류 코드가 배정된 계정으로 이용해 주세요.';
    case 'NO_COMPANY':
      return '회사 권한이 필요합니다.';
    case 'STORE_CODE_REQUIRED':
      return '이 몰을 어느 분류 코드로 연결할지 골라 주세요.';
    case 'STORE_CODE_NOT_YOURS':
      return '내 계정에 배정되지 않은 분류 코드입니다.';
    case 'STORE_CODE_UNKNOWN':
      return '회사에 등록되지 않은 분류 코드입니다. 회사 설정에서 분류 코드를 먼저 등록해 주세요.';
    case 'MALL_OWNED_BY_OTHER_STORE':
      return '이 몰은 다른 담당자의 분류 코드로 이미 연결되어 있습니다.';
    case 'STORE_CODE_CHANGE_NOT_SUPPORTED':
      return '연결된 몰의 분류 코드는 바꿀 수 없습니다. 연동을 해제한 뒤 다시 연결해 주세요.';
    case 'STORE_CODE_MODE_MIXED':
      return STORE_CODE_MODE_SENTENCE;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ★ 2026-10-27 자사몰 대비 K9 SC1 — 분류코드 모드 하나(I15 · 설계서 docs/2026-10-27-mall-integration-hardening-design.md)
//   한 회사의 몰 연동 행은 모두 분류코드가 있거나 모두 없다(만드는 순간 판정 · 해제 행 포함 = getMallConsentStoreCodes 와 같은 진실).
//   섞이면 관리자 범위 동의 읽기(consentSql uploadOnly)가 분류코드 없는 몰로만 들어온 고객을 동의 아님으로 뺀다.
// ─────────────────────────────────────────────────────────────────────────────

/** 모드가 섞이는 연결을 거절하는 문장(고객이 읽는 말) */
export const STORE_CODE_MODE_SENTENCE = '이미 연결된 몰과 같은 방식으로 연결해야 해요. 분류 코드를 쓰는 회사는 모든 몰을 분류 코드로, 쓰지 않는 회사는 모든 몰을 분류 코드 없이 연결해 주세요.';

/** 저장 · 해제 권한 게이트의 거부(저장 CT 의 잠금 안에서 던지고 라우트가 사유 문장으로 답한다) */
export class IntegrationRejected extends Error {
  constructor(public httpStatus: number, public lockCode: IntegrationLockCode) { super(lockCode); }
}

/**
 * 회사 단위 연동 모드 잠금(트랜잭션 끝에 풀린다) — 정산 회사 잠금(billing-lock)과 같은 꼴 · 다른 축 이름.
 * 키는 uuid 로 정규화한 표기(같은 회사의 대문자 · 소문자 표기가 서로 다른 잠금을 잡지 않게 · Codex R5).
 */
export async function lockCompanyIntegrationMode(run: TxRun, companyId: string): Promise<void> {
  await run(`SELECT pg_advisory_xact_lock(hashtext($1::uuid::text), hashtext('integration_mode'))`, [companyId]);
}

/**
 * 새 몰(또는 해제됐다 되살리는 몰)의 분류코드가 회사의 다른 몰들과 같은 모드인가. 아니면 던진다(409 · 저장 0).
 *   다른 몰에 분류코드 몰이 있으면 새 몰도 분류코드 필수(관리자도) · 분류코드 없는 몰이 있으면 분류코드 몰을 새로 못 만든다.
 */
export async function assertStoreCodeMode(run: TxRun, companyId: string, provider: string, mallId: string, storeCode: string | null): Promise<void> {
  const r = await run(
    `SELECT COUNT(*) FILTER (WHERE COALESCE(meta->>'store_code', '') <> '')::int AS coded,
            COUNT(*) FILTER (WHERE COALESCE(meta->>'store_code', '') = '')::int AS plain
       FROM company_integrations
      WHERE company_id = $1::uuid AND NOT (provider = $2 AND mall_id = $3)`,
    [companyId, provider, mallId],
  );
  const coded = Number(r.rows[0]?.coded || 0);
  const plain = Number(r.rows[0]?.plain || 0);
  const code = cleanCode(storeCode);
  if (coded > 0 && !code) throw new UserFacingError(409, 'STORE_CODE_REQUIRED', STORE_CODE_MODE_SENTENCE);
  if (plain > 0 && code) throw new UserFacingError(409, 'STORE_CODE_MODE_MIXED', STORE_CODE_MODE_SENTENCE);
}

/**
 * 연동 행 저장의 모드 문 — 같은 트랜잭션에서 잠금 → (그 행이 없거나 해제 행이면) 모드 판정. 저장 문장은 이 뒤에 같은 연결로 쓴다.
 * 이미 있는 행의 재저장(토큰 갱신 · 재승인)은 판정하지 않는다(I15 = 만드는 순간 판정 · 옛 섞인 회사의 기존 몰을 멈추지 않게).
 */
export async function guardIntegrationMode(run: TxRun, companyId: string, provider: string, mallId: string, storeCode: string | null): Promise<void> {
  await lockCompanyIntegrationMode(run, companyId);
  const cur = await run(
    `SELECT status, meta->>'store_code' AS store_code FROM company_integrations WHERE company_id = $1::uuid AND provider = $2 AND mall_id = $3`,
    [companyId, provider, mallId],
  );
  if (cur.rows.length === 0 || cur.rows[0].status === 'revoked') { await assertStoreCodeMode(run, companyId, provider, mallId, storeCode); return; }
  // ★ 1028 K14 N6 — 살아 있는 몰을 다른 분류코드로 다시 연결하지 않는다(몰 1행 = 분류코드 1개 · 해제 뒤 재연결이 길 · 우커머스 decideStoreCode 와 같은 규칙) · 코드를 안 주면 그대로
  if (storeCode != null && cleanCode(storeCode) !== cleanCode(cur.rows[0].store_code)) {
    throw new UserFacingError(409, 'STORE_CODE_CHANGE_NOT_SUPPORTED', integrationLockMessage('STORE_CODE_CHANGE_NOT_SUPPORTED'));
  }
}

/**
 * ★ 1028 K14 N6 — 우커머스 밖 몰 연결 라우트 공용: 이 연결이 붙일 분류코드(관리자 = 고른 등록부 코드 · 비우면 null · 담당자 = 자기 코드).
 * 못 정하면 UserFacingError(라우트 respondUserError 가 그 문장으로 답한다) · 모드 판정은 저장 CT(saveIntegrationRowGuarded)가 한다.
 */
export async function storeCodeForConnect(user: Parameters<typeof resolveIntegrationActor>[0], requested: unknown): Promise<string | null> {
  const actor = await resolveIntegrationActor(user);
  if (actor.kind === 'blocked') throw new UserFacingError(403, actor.reason, integrationLockMessage(actor.reason));
  const pick = await pickStoreCodeForConnect(actor, requested);
  if (!pick.ok) throw new UserFacingError(409, pick.code, integrationLockMessage(pick.code));
  return pick.storeCode;
}

/** 모드 문을 지난 저장 — provider 저장 함수가 연동 행 INSERT 를 이 안에서 쓴다(R7 · 잠금 → 판정 → 저장 = 한 트랜잭션) */
export async function saveIntegrationRowGuarded<T>(
  companyId: string, provider: string, mallId: string, storeCode: string | null,
  save: (run: TxRun) => Promise<T>,
  /** ★ 1028 Codex R2 #1 — 바깥 트랜잭션(승인 확정 = 연동 저장 + 승인 행 지우기 한 커밋) · 없으면 새 트랜잭션 */
  outer?: TxRun,
): Promise<T> {
  const body = async (run: TxRun) => {
    await guardIntegrationMode(run, companyId, provider, mallId, storeCode);
    return save(run);
  };
  return outer ? body(outer) : withTransaction(body);
}

/**
 * 새로 저장하는 몰의 분류코드를 정한다(권한 CT) + 이미 있는 몰이면 소유 · 변경 규칙을 건다(★ 1027 우커머스 라우트 안 함수를 옮김 · R1).
 * 반환 decide = 저장 CT 가 대상 행을 정한 뒤 **같은 잠금 안에서** 부른다(그 사이 대상이 바뀌어도 소유 검사가 빠지지 않게 · Codex 1001 R1).
 */
export async function decideStoreCode(
  actor: IntegrationActor,
  requested: unknown,
): Promise<{ ok: false; code: StoreCodePickFailure } | { ok: true; decide: (existing: { storeCode?: string | null } | null) => { storeCode: string | null | undefined } }> {
  const pick = await pickStoreCodeForConnect(actor, requested);
  if (!pick.ok) return pick;
  return {
    ok: true,
    decide: (existing) => {
      if (existing) {
        if (!canTouchIntegration(actor, existing.storeCode)) throw new IntegrationRejected(409, 'MALL_OWNED_BY_OTHER_STORE');
        // 몰 1행 = 분류코드 1개. 관리자가 다른 코드로 다시 저장하려 하면 거부(해제 뒤 재연결이 길이다).
        if (actor.kind === 'admin' && pick.storeCode !== null && pick.storeCode !== existing.storeCode) throw new IntegrationRejected(409, 'STORE_CODE_CHANGE_NOT_SUPPORTED');
      }
      return { storeCode: existing ? undefined : pick.storeCode };
    },
  };
}

/** 그 연동 행의 분류코드(없으면 null) — 웹훅 처리가 어댑터에 넘긴다(★ 1027 K9 · 해제 행도 읽는다 = 그 몰 소속 행에 쓴다) */
export async function integrationRowScopeOf(companyId: string, provider: string, mallId: string): Promise<{ storeCode: string | null; idPrefix: string | null }> {
  // ★ 1028 K9 — 같은 조회에서 몰 접두(meta.id_prefix 원문 · 키가 없으면 null = 옛 행 = 빈 접두 · 우커머스는 mallScopedIds 가 `{몰}:`)
  const r = await query(
    `SELECT meta->>'store_code' AS store_code, CASE WHEN meta ? 'id_prefix' THEN meta->>'id_prefix' END AS id_prefix
       FROM company_integrations WHERE company_id = $1::uuid AND provider = $2 AND mall_id = $3 LIMIT 1`,
    [companyId, provider, mallId],
  );
  return { storeCode: cleanCode(r.rows[0]?.store_code) || null, idPrefix: typeof r.rows[0]?.id_prefix === 'string' ? r.rows[0].id_prefix : null };
}
