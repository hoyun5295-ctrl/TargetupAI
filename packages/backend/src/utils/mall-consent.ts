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

/** 몰 동의 분류코드 = 해제 아닌 자사몰 연동 행(company_integrations)의 meta.store_code. 없으면 []. */
export async function getMallConsentStoreCodes(companyId: string): Promise<string[]> {
  const r = await query(
    `SELECT DISTINCT meta->>'store_code' AS store_code
       FROM company_integrations
      WHERE company_id = $1::uuid
        AND status <> 'revoked'
        AND COALESCE(meta->>'store_code', '') <> ''`,
    [companyId],
  );
  return Array.from(new Set((r.rows as { store_code: string }[]).map((x) => String(x.store_code)).filter(Boolean)));
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
 * 조건 = ENV 로 켠 회사 + 사용자 코드가 1개 이상 + **전부** 몰 동의 분류코드.
 * 몰 동의가 아닌 코드(업로드·싱크 브랜드)가 섞이면 강제하지 않는다(그 코드의 고객에는 몰 동의 값이 없다 → 전원 제외가 된다).
 */
export async function resolveSendConsent(companyId: string, userStoreCodes: readonly string[] | undefined | null): Promise<boolean> {
  if (enforceList().length === 0) return false;
  if (!userStoreCodes || userStoreCodes.length === 0) return false;
  if (!(await isMallConsentEnforced(companyId))) return false;
  const mall = new Set(await getMallConsentStoreCodes(companyId));
  const all = userStoreCodes.every((c) => mall.has(c));
  if (!all) console.warn(`[MallConsent] 몰 동의가 아닌 분류코드가 섞여 옛 자격 판정을 씁니다 company=${companyId} codes=${userStoreCodes.join(',')}`);
  return all;
}

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
  const marker = '::text[]))';
  const at = o.storeFilter.lastIndexOf(marker);
  if (at < 0) return legacy; // 모르는 모양의 서브쿼리에는 손대지 않는다
  const injected = `${o.storeFilter.slice(0, at)}::text[]) AND sms_opt_in = true)${o.storeFilter.slice(at + marker.length)}`;
  return { customerConsent: 'TRUE', storeFilter: injected, mode: 'mall' };
}

let warnedMissingColumn = false;
/** 테스트 전용 — 경고 1회 제한을 되돌린다 */
export function _resetMallConsentWarnForTest(): void { warnedMissingColumn = false; }

/**
 * 몰이 준 수신동의를 그 몰의 소속 행에 쓴다(쓰기 입구는 여기 하나). 소속 행은 linkCustomerStore 가 먼저 만든다.
 * 조건이 (회사 + 고객 + 분류코드)라 다른 몰의 행에는 닿지 않는다 = H2 를 쓰기에서 보장.
 * 컬럼 미존재(DDL 전 · 42703)는 적재를 죽이지 않는다 — false 를 돌려주고 1회만 경고한다. 그 밖의 오류는 던진다.
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
      `UPDATE customer_stores
          SET sms_opt_in = $4, consent_source = $5, consent_at = NOW()
        WHERE company_id = $1::uuid AND customer_id = $2::uuid AND store_code = $3`,
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

/** 부팅 로그 — 꺼져 있어도 상태를 남긴다(꺼짐을 추측하지 않게). */
export function logMallConsentGate(): void {
  const list = enforceList();
  console.log(`[MallConsent] 읽기 강제 ${list.length ? `ON (${list.join(',')})` : 'OFF'} · ENV ${ENFORCE_ENV}`);
}
