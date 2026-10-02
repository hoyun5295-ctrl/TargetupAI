/**
 * mall-consent.ts — 몰별 수신동의 컨트롤타워 (★2026-09-22)
 * 설계서 = docs/2026-09-22-mall-consent-isolation-design.md (§4-1 판정 · §4-2 쓰기 · §4-4 읽기)
 *
 * 전제(Harold 0922): H1 수신동의의 법적 단위 = 몰 · H2 한 몰의 동의·거부가 다른 몰에 어떤 영향도 주지 않는다.
 * 구조: 고객은 폰당 1행 그대로. 몰이 받은 수신동의의 진실은 그 몰의 소속 행(customer_stores.sms_opt_in)이 단독으로 갖는다.
 *       회사 공통 customers.sms_opt_in 은 "몰 동의 회사"의 분류코드 사용자 발송에서 자격 판정에서 빠진다(퇴역).
 *
 * ⛔ "몰 동의 회사"를 customer_stores 행 유무로 판정하지 않는다 — 업로드·싱크로 브랜드 체계를 쓰는 기존 고객사는
 *    몰 동의 축이 없다(그 회사들의 SQL 은 1바이트도 달라지지 않는다). 판정 = 자사몰 연동 행의 meta.store_code.
 * ⛔ 읽기 강제는 ENV 로 회사 단위로만 켠다(백필로 몰 동의가 채워진 것을 실측한 뒤). 꺼짐 = 옛 문자열 그대로.
 * ⛔ 발송 경로에 sms_opt_in 조건을 새로 쓰지 말고 buildSendConsent 조각을 쓴다.
 */
import { query } from '../config/database';

const ENFORCE_ENV = 'MALL_CONSENT_ENFORCE_COMPANY_IDS';

/**
 * 몰 동의 분류코드 = 자사몰 연동 행(company_integrations)의 meta.store_code. 없으면 [].
 * ⛔ **해제(revoked)된 연동의 코드도 포함한다**(Codex 0922 R1): 해제해도 고객 소속 행과 그 몰의 동의·거부는 남는다.
 *    해제된 코드를 빼면 그 코드의 발송이 옛 판정(고객 행)으로 돌아가 몰에서 거부한 사람이 다시 대상이 된다.
 */
export async function getMallConsentStoreCodes(companyId: string): Promise<string[]> {
  const r = await query(
    `SELECT DISTINCT meta->>'store_code' AS store_code
       FROM company_integrations
      WHERE company_id = $1::uuid
        AND COALESCE(meta->>'store_code', '') <> ''`,
    [companyId],
  );
  return Array.from(new Set((r.rows as { store_code: string }[]).map((x) => String(x.store_code)).filter(Boolean)));
}

/**
 * ★ 2026-10-01 "이 코드 묶음에 몰 동의 코드가 하나라도 있는가"의 SQL 조각 — getMallConsentStoreCodes 와 **같은 진실**(자사몰 연동 행 meta.store_code ·
 *   해제된 연동 포함) · resolveSendConsent 와 **같은 단위**(계정 코드 중 하나라도 몰 동의 코드면 그 계정은 몰 동의로 판정된다).
 *   SQL 안에서 계정마다 판정해야 하는 쓰기(수신거부 자동 등록 · B-1001-4)가 쓴다. 앱으로 목록을 먼저 읽어 넘기면 두 판정이 갈릴 틈이 생긴다.
 * @param companyRef 회사 id 식(예: '$1')
 * @param codesRef   분류코드 배열 식(예: 'u.store_codes' · '$4::text[]')
 */
export function mallConsentCodeAmong(companyRef: string, codesRef: string): string {
  return `EXISTS (SELECT 1 FROM company_integrations mci WHERE mci.company_id = ${companyRef} AND mci.meta->>'store_code' = ANY(${codesRef}))`;
}

function enforceList(): string[] {
  return String(process.env[ENFORCE_ENV] || '').split(',').map((s) => s.trim()).filter(Boolean);
}

/** 이 회사에 몰 동의 읽기가 켜져 있는가. ENV 빈 값 = 아무도 아님 · `*` = 몰 동의 분류코드가 있는 회사 전부. */
export async function isMallConsentEnforced(companyId: string): Promise<boolean> {
  const list = enforceList();
  if (list.length === 0) return false;
  if (!list.includes('*') && !list.includes(companyId)) return false;
  return (await getMallConsentStoreCodes(companyId)).length > 0;
}

/**
 * 이 발송(분류코드 사용자)의 자격을 몰 동의로 판정할 것인가.
 * 조건 = ENV 로 켠 회사 + 사용자 코드 중 **하나라도** 몰 동의 분류코드.
 * ⛔ 몰 동의가 아닌 코드가 섞여 있어도 옛 판정으로 되돌리지 않는다(Codex 0922 R1) — 되돌리면 몰에서 거부한 사람이 고객 행 값으로 통과한다.
 *    섞인 사용자는 몰 동의가 없는 코드의 고객이 제외된다(덜 보내는 방향 · 경고 로그). 코드별 판정은 그런 계정이 실제로 생기면 연다.
 */
export async function resolveSendConsent(companyId: string, userStoreCodes: readonly string[] | undefined | null): Promise<boolean> {
  if (enforceList().length === 0) return false;
  if (!userStoreCodes || userStoreCodes.length === 0) return false;
  if (!(await isMallConsentEnforced(companyId))) return false;
  const mall = new Set(await getMallConsentStoreCodes(companyId));
  const any = userStoreCodes.some((c) => mall.has(c));
  if (any && !userStoreCodes.every((c) => mall.has(c))) {
    console.warn(`[MallConsent] 몰 동의가 아닌 분류코드가 섞였습니다 — 그 코드의 고객은 몰 동의가 없어 제외됩니다 company=${companyId} codes=${userStoreCodes.join(',')}`);
  }
  return any;
}

/** 몰 동의 조건이 붙는 소속 표의 별칭 — 바깥 customers 의 같은 이름 컬럼으로 새지 않게 한정한다 */
const MALL_STORE_ALIAS = 'mcs';

export interface SendConsentFragments {
  /** `WHERE … AND ${customerConsent}` 자리에 넣는다. legacy = `{alias}.sms_opt_in = true` · mall = `TRUE`(고객 행 동의 퇴역) */
  customerConsent: string;
  /** 범위 서브쿼리(호출부가 만든 것). mall 이면 그 안에 `AND sms_opt_in = true` 가 들어간다 → NULL·행 없음 = 모름 = 제외 */
  storeFilter: string;
  mode: 'legacy' | 'mall';
}

/**
 * 발송 자격 조각(순수). 호출부가 이미 만든 범위 서브쿼리 문자열을 받아, 강제일 때만 그 안에 몰 동의 조건을 넣는다.
 * 범위 서브쿼리가 없는 발송(관리자·no_filter)은 몰을 모르므로 강제하지 않는다(설계서 S7 에서 몰 선택으로 연다).
 */
export function buildSendConsent(o: { enforce: boolean; alias: string; storeFilter: string }): SendConsentFragments {
  const legacy: SendConsentFragments = { customerConsent: `${o.alias}.sms_opt_in = true`, storeFilter: o.storeFilter, mode: 'legacy' };
  if (!o.enforce || !o.storeFilter) return legacy;
  // ⛔ 몰 동의 컬럼은 **소속 표 별칭으로 한정**한다(Codex 0922 R1). 한정하지 않으면 컬럼이 없는 환경에서 PostgreSQL 이
  //    바깥 customers.sms_opt_in 으로 해석해 오류 없이 통과시킨다. 별칭을 달면 컬럼 미존재가 오류(42703)로 드러난다.
  const FROM = 'FROM customer_stores WHERE';
  const marker = '::text[]))';
  const at = o.storeFilter.lastIndexOf(marker);
  if (at < 0 || o.storeFilter.split(FROM).length !== 2) {
    // 모르는 모양의 서브쿼리 = 몰 동의를 걸 수 없다 → 옛 판정으로 열지 않고 닫는다(아무도 통과시키지 않는다)
    console.error('[MallConsent] 범위 서브쿼리 모양을 알 수 없어 발송 자격을 닫습니다:', o.storeFilter.slice(0, 120));
    return { customerConsent: 'FALSE', storeFilter: o.storeFilter, mode: 'mall' };
  }
  const aliased = o.storeFilter.replace(FROM, `FROM customer_stores ${MALL_STORE_ALIAS} WHERE`);
  const cut = aliased.lastIndexOf(marker);
  const injected = `${aliased.slice(0, cut)}::text[]) AND ${MALL_STORE_ALIAS}.sms_opt_in = true)${aliased.slice(cut + marker.length)}`;
  return { customerConsent: 'TRUE', storeFilter: injected, mode: 'mall' };
}

let warnedMissingColumn = false;
/** 테스트 전용 — 경고 1회 제한을 되돌린다 */
export function _resetMallConsentWarnForTest(): void { warnedMissingColumn = false; }

/**
 * 몰이 준 수신동의를 그 몰의 소속 행에 쓴다(명시 값 쓰기 입구는 여기 하나).
 * 조건이 (회사 + 고객 + 분류코드)라 다른 몰의 행에는 닿지 않는다 = H2 를 쓰기에서 보장.
 * 컬럼 미존재(DDL 전 · 42703)는 적재를 죽이지 않는다 — false 를 돌려주고 1회만 경고한다. 그 밖의 오류는 던진다.
 *
 * ★2026-10-02 소속 행이 없어도 **행을 만들어서** 값을 남긴다(Codex 1002 R1 high).
 *   종전에는 UPDATE 뿐이라, 분류 기록(linkCustomerStore · 실패를 삼킨다)이 실패한 건의 명시 거부가 0행으로 조용히 빠졌다.
 *   그때까지는 그 사람이 「모름」으로 남아 발송에서 빠졌지만, 「회원 정보에 값이 없으면 동의」 규칙(아래)이 생기면 빠진 거부 뒤의
 *   값 없는 회원 정보 재수신이 그 사람을 동의로 채운다. 명시 값은 소속 행의 존재에 기대지 않아야 한다.
 *   다른 회사의 같은 (고객 · 코드) 행은 건드리지 않는다(그런 행은 없어야 하지만 조건으로 닫아 둔다 · 그때는 false).
 */
export async function upsertStoreConsent(
  companyId: string,
  customerId: string,
  storeCode: string | null | undefined,
  optIn: boolean,
  source: string,
): Promise<boolean> {
  const code = typeof storeCode === 'string' ? storeCode.trim() : '';
  if (!companyId || !customerId || !code) return false;
  try {
    const r = await query(
      `INSERT INTO customer_stores (company_id, customer_id, store_code, sms_opt_in, consent_source, consent_at)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, NOW())
       ON CONFLICT (customer_id, store_code) DO UPDATE
          SET sms_opt_in = EXCLUDED.sms_opt_in, consent_source = EXCLUDED.consent_source, consent_at = EXCLUDED.consent_at
        WHERE customer_stores.company_id = EXCLUDED.company_id`,
      [companyId, customerId, code, optIn, source],
    );
    return (r.rowCount || 0) > 0;
  } catch (err: any) {
    if (err?.code === '42703') {
      if (!warnedMissingColumn) {
        warnedMissingColumn = true;
        console.warn('[MallConsent] customer_stores 동의 컬럼이 아직 없습니다(DDL 전) — 몰 동의 기록을 건너뜁니다. 설계서 §8 DDL 실행 뒤 가져오기를 다시 돌리면 채워집니다.');
      }
      return false;
    }
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ★2026-10-02 「회원 정보에 동의 값이 없으면 동의」 규칙 — 몰(분류코드) 단위로 켠다
//
// 경위: 이에스페이먼트 대표 확인(박성용 전달 · 1002) = 「no 만 수신거부 · 아무것도 없거나 YES 는 문자 보낼 수 있다」.
//   운영 실측(1002): 4몰 수집 값은 `YES`·`NO` 둘뿐이고 「모름」은 값이 빈 것이 아니라 **그 키 자체가 없는 건**이다.
//   소속 행 「모름」 44,982 중 41,444 가 그 몰의 회원 연결이 있는 고객이다(렌즈고고 39,112) · 비회원뿐 3,538.
//
// 규칙: 연동 행 `company_integrations.meta.consent_missing_agree_key = '<동의 키 이름>'` 인 몰은, **그 회원의 회원 정보를 그 키로 읽었는데
//   동의 값이 없다고 확인된 때** 그 몰 소속 행의 동의가 모름(NULL)이면 동의로 채운다. 기본(키 없음) = 종전대로 모름(다른 고객사는 1바이트도 달라지지 않는다).
//   ⛔ 규칙은 **동의 키 이름에 묶인다**. 연결 폼의 동의 키는 고객사가 고칠 수 있고, 잘못 적힌 키로 읽으면 모든 회원이 「값 없음」으로 보인다.
//      켤 때 적은 키와 지금 읽은 키가 다르면 규칙은 멈춘다(모름으로 남는다 = 덜 보내는 방향).
//
// ⛔ 채우는 조건은 **저장하는 SQL 한 문장이 전부 본다**(호출 종류·캐시로 미루어 짐작하지 않는다 — Codex 1002 R1·R2·R3 가 같은 뿌리로 세 번 짚었다):
//    ⓪ 그 순간 그 몰에 그 키의 규칙이 켜져 있을 때만. 규칙을 앱 메모리에 담아 두지 않는다 — 끈 뒤에도 담아 둔 값으로 동의를 다시 만든다(R3).
//    ① 그 소속 행이 모름일 때만 = 명시 값(YES·NO)을 덮지 않는다. 명시 값이 나중에 오면 `upsertStoreConsent` 가 출처째 덮는다.
//    ② 그 고객에게 **그 몰의 다른 회원 연결이 없을 때만**. 전화번호로 합쳐져 회원 계정이 둘 이상인 고객은, 한 계정의 「값 없음」이
//       다른 계정의 아직 못 읽은 NO 를 덮을 수 있다 → 그런 고객은 명시 값만 믿는다.
// ⛔ 주문에서는 부르지 않는다. 주문에는 동의 키가 실리지 않고, 비회원 주문도 전화번호로 회원 고객에 합쳐진다. 프로필에 휴대폰이 없어
//    회원 정보를 못 읽은 채 주문으로 생긴 고객의 NO 를 동의로 바꾸게 된다. 비회원(회원 정보가 없는 구매자)은 이 규칙의 대상이 아니다.
// ⛔ 읽는 쪽에 「모름도 동의」 분기를 두지 않는다 — 읽는 자리는 전부 `sms_opt_in = true` 하나만 본다(규칙은 쓰는 자리 한 곳).
// ⛔ 고객이 스스로 켜는 값이 아니다. 고객사의 서면 확인을 받은 뒤 우리가 연동 행에 적는다(화면 칸 없음 · 설계서 §12).
// ─────────────────────────────────────────────────────────────────────────────

/** 규칙을 켜는 연동 행 meta 키 — 값 = 그 규칙을 적용할 동의 키 이름(그 키로 읽었을 때 값이 없으면 동의) */
export const MISSING_CONSENT_RULE_KEY = 'consent_missing_agree_key';
/** 규칙으로 채운 값의 출처(`consent_source` varchar(60)) — 명시 값과 구분된다(되돌리기 축) */
export const missingConsentSource = (source: string): string => `${String(source || 'unknown')}:missing=agree`.slice(0, 60);

/**
 * 「이 회원의 회원 정보에 동의 값이 없음」을 확인한 호출이 싣는 것.
 * `memberIdPrefix` + `memberIdRestPattern` = 그 몰의 **회원** 연결 식별자 모양(예: 우커머스 `{몰}:` + 숫자뿐).
 * 그 모양의 다른 연결(이 호출의 `externalId` 가 아닌 것)이 그 고객에게 있으면 채우지 않는다.
 */
export interface MissingConsentProfile {
  source: string;
  externalId: string;
  /** 이 회원 정보를 읽은 동의 키 이름 — 규칙을 켤 때 적은 키와 같아야 한다 */
  consentKey: string;
  memberIdPrefix: string;
  memberIdRestPattern: string;
}

/**
 * 회원 정보에 동의 값이 없는 회원 — 규칙이 켜진 몰이면 그 몰 소속 행의 동의를 동의로 채운다(위 ⓪①② 를 SQL 이 본다).
 * 규칙 판정 = 같은 회사의 연동 행 중 분류코드가 같고 `meta.consent_missing_agree_key` 가 이 회원 정보를 읽은 키와 같은 행이 있는가
 *   (해제된 연동 행도 포함 — `getMallConsentStoreCodes` 와 같은 진실 · 규칙은 그 몰의 동의 단위에 붙는다).
 * 돌려주는 값 = 실제로 채웠는가. 규칙이 꺼진 몰 · 규칙의 키와 다른 키로 읽은 회원 정보 · 이미 값이 있는 행 · 다른 회원 연결이 있는 고객 · 모양이 빈 입력은 false(쓰기 0).
 * 컬럼 미존재(DDL 전 · 42703)는 `upsertStoreConsent` 와 같이 삼킨다. 그 밖의 오류는 던진다(호출부가 정한다).
 */
export async function applyMissingConsentRule(
  companyId: string,
  customerId: string,
  storeCode: string | null | undefined,
  profile: MissingConsentProfile,
): Promise<boolean> {
  const code = typeof storeCode === 'string' ? storeCode.trim() : '';
  if (!companyId || !customerId || !code) return false;
  const source = String(profile?.source || '').trim();
  const externalId = String(profile?.externalId || '').trim();
  const consentKey = String(profile?.consentKey || '').trim();
  const prefix = String(profile?.memberIdPrefix || '');
  const rest = String(profile?.memberIdRestPattern || '');
  // 어느 키로 읽었는지 · 회원 연결의 모양을 모르면 판정할 수 없다 → 채우지 않는다(덜 보내는 방향)
  if (!source || !externalId || !consentKey || !prefix || !rest) return false;
  try {
    const r = await query(
      `UPDATE customer_stores
          SET sms_opt_in = true, consent_source = $4, consent_at = NOW()
        WHERE company_id = $1::uuid AND customer_id = $2::uuid AND store_code = $3
          AND sms_opt_in IS NULL
          AND EXISTS (
            SELECT 1 FROM company_integrations ci
             WHERE ci.company_id = $1::uuid AND ci.meta->>'store_code' = $3
               AND ci.meta->>'${MISSING_CONSENT_RULE_KEY}' = $9)
          AND NOT EXISTS (
            SELECT 1 FROM cdp_identity_links l
             WHERE l.company_id = $1::uuid AND l.customer_id = $2::uuid AND l.source = $5
               AND l.external_id <> $6
               AND left(l.external_id, char_length($7)) = $7
               AND substr(l.external_id, char_length($7) + 1) ~ $8)`,
      [companyId, customerId, code, missingConsentSource(source), source, externalId, prefix, rest, consentKey],
    );
    return (r.rowCount || 0) > 0;
  } catch (err: any) {
    if (err?.code === '42703') return false;
    throw err;
  }
}

/**
 * db_alter_safety_net(Codex 0922 R2): 몰 동의 컬럼(DDL 로 추가)이 없는 환경에서 읽기 강제가 켜지면 별칭 한정 덕에 42703 이 난다.
 * 소비 endpoint 는 그것을 500 이 아니라 503 DB_MIGRATION_PENDING 으로 답한다. ⛔ 옛 판정(고객 행 동의)으로 되돌려 재시도하지 않는다 — 차단을 유지한다.
 */
export function isMallConsentMigrationPending(err: any): boolean {
  const msg = String(err?.message || '');
  return msg.includes('column') && msg.includes('does not exist') && msg.includes('sms_opt_in');
}
export const MALL_CONSENT_MIGRATION_PENDING = {
  success: false,
  code: 'DB_MIGRATION_PENDING',
  error: 'DB 마이그레이션 필요: customer_stores ALTER 실행 요청',
} as const;

/** 부팅 로그 — 꺼져 있어도 상태를 남긴다(꺼짐을 추측하지 않게). */
export function logMallConsentGate(): void {
  const list = enforceList();
  console.log(`[MallConsent] 읽기 강제 ${list.length ? `ON (${list.join(',')})` : 'OFF'} · ENV ${ENFORCE_ENV}`);
}
