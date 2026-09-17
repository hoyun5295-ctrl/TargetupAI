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
import { query } from '../config/database';
import { normalizeWooMallId } from './woocommerce-core';

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
  | 'STORE_CODE_CHANGE_NOT_SUPPORTED';

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

/**
 * 브라우저 수집(SDK)은 회사당 공개키가 하나라 어느 몰인지 Origin 만 안다.
 * Origin 호스트를 몰 식별자와 같은 함수로 정규화해 그 회사 연동 행의 분류코드를 찾는다.
 * 못 찾으면 null = 지금처럼 분류 없이 적재. ⛔ 실패를 던지지 않는다(수집을 막지 않는다).
 */
export async function resolveStoreCodeByOriginHost(companyId: string, originOrHost: string | null | undefined): Promise<string | null> {
  const mallId = normalizeWooMallId(String(originOrHost || ''));
  if (!companyId || !mallId) return null;
  try {
    const r = await query(
      `SELECT meta->>'store_code' AS store_code
         FROM company_integrations
        WHERE company_id = $1::uuid AND mall_id = $2 AND status <> 'revoked'
          AND COALESCE(meta->>'store_code', '') <> ''
        ORDER BY created_at ASC
        LIMIT 1`,
      [companyId, mallId],
    );
    const code = cleanCode(r.rows[0]?.store_code);
    return code || null;
  } catch (err: any) {
    console.warn(`[integration-scope] Origin 분류코드 조회 실패(수집은 계속) company=${companyId} host=${mallId}:`, err?.message || err);
    return null;
  }
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
  }
}
