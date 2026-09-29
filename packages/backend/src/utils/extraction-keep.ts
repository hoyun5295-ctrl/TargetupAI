/**
 * utils/extraction-keep.ts — 직접 타겟 추출 보관본 CT (★2026-09-29 한줄로 V2 R112 · 설계 docs/2026-09-28-v2-round4-send-redesign.md §2-1)
 *
 * 옛: `POST /api/customers/extract`가 조건에 맞는 고객 **전체**를 브라우저로 보내고(개인정보 칸 포함 · LIMIT 없음),
 *     화면은 그 명단을 발송 요청 본문에 다시 실어 올렸다. 10만 명이면 응답·브라우저 메모리·요청 본문이 전부 커진다.
 * 새: 추출 결과를 발송 준비 표(`campaign_send_staging`)에 그대로 보관하고 화면에는 건수·앞 15명·가장 긴 값만 준다.
 *     발송은 직접발송과 같은 적재·확정 길(`/direct-send/count` → `/direct-send/commit`)로 이 보관본 id를 싣는다.
 *
 * ⛔ 보관본 = 준비분과 같은 규칙:
 *   - 만료 = 가장 오래된 행 + 23시간(`STAGING_COMMIT_MAX_AGE_HOURS` · staging-sweeper가 소유) · 정리 = 24시간 통째로(기존 정리 워커).
 *   - 소유 = 회사(준비분과 같은 기준). 개인정보를 돌려주는 조회(검색·전체 행)는 요청 사용자의 매장 범위를 다시 건다.
 *   - 커밋된(발송을 누른) 보관본은 바꾸지 않는다(빼기·회신번호 채우기 = 409) — stage 입구와 같은 규칙 · 같은 잠금.
 * ⛔ `campaign_send_staging.phone` = varchar(20) NOT NULL · `callback` = varchar(20)(information_schema 0929 Harold 실측).
 *   번호가 비었거나 20자를 넘는 행은 넣지 않고 건수를 따로 돌려준다.
 */
import { randomUUID } from 'crypto';
import { query, pool } from '../config/database';
import { getColumnFields, FIELD_DISPLAY_MAP, reverseDisplayValue } from './standard-field-map';
import { normalizePhone } from './normalize-phone';
import { STAGING_COMMIT_MAX_AGE_HOURS, withStagingLock, restoreParkedStagingRows } from './staging-sweeper';
import { getStoreScope } from './store-scope';

/** 화면에 주는 앞부분 인원 — 지금 수신자 표 한 쪽(15줄)과 같은 밀도(0929 목업 승인) */
export const EXTRACTION_SAMPLE_SIZE = 15;
/** 번호 검색 최소 자릿수 — 두 자리면 명단 거의 전부가 걸린다 */
export const EXTRACTION_SEARCH_MIN_DIGITS = 3;
/** 번호 검색 한 번에 돌려주는 최대 행 */
export const EXTRACTION_SEARCH_LIMIT = 50;
/** 빼기 한 번에 받는 최대 번호 수 */
export const EXTRACTION_REMOVE_MAX = 1000;
/** campaign_send_staging.phone · callback 폭(information_schema 0929) */
export const STAGING_TEXT_MAX = 20;
/** 보관 적재 한 문장 행 수 — /direct-send/stage 청크 상한과 같다 */
const KEEP_CHUNK = 50000;

export type ExtractSelect =
  | { ok: true; selectClause: string; phoneExpr: string }
  | { ok: false; error: string };

/**
 * 추출 SELECT 조립(FIELD_MAP 기반 동적 SELECT — D43-3). `/extract` 라우트 안에 있던 코드를 그대로 옮겼다.
 * ★ 2026-08-14 (Codex 2R critical): phoneField를 요청 문자열 그대로 SELECT에 삽입하던 자리 —
 *   스칼라 서브쿼리를 넣으면 회사 WHERE 밖의 타사 PII까지 뽑히는 교차 테넌트 주입이었다.
 *   서버가 아는 식별자만 허용: FIELD_MAP 실컬럼 또는 custom_1~15(jsonb 접근식). 그 외 = 400.
 */
export function buildExtractSelect(phoneField: unknown): ExtractSelect {
  const requestedPhoneField = String(phoneField || 'phone');
  const columnFields = getColumnFields();
  let phoneExpr: string;
  if (requestedPhoneField === 'phone') {
    phoneExpr = 'phone';
  } else if (columnFields.some(f => f.columnName === requestedPhoneField)) {
    phoneExpr = requestedPhoneField;
  } else if (/^custom_([1-9]|1[0-5])$/.test(requestedPhoneField)) {
    phoneExpr = `custom_fields->>'${requestedPhoneField}'`;
  } else {
    return { ok: false, error: '유효하지 않은 전화번호 필드입니다.' };
  }

  // FIELD_MAP에서 직접 컬럼 동적 생성
  const selectParts = columnFields.map(f => {
    // phone은 phoneField 파라미터에 따라 별칭 처리 (허용 목록 통과분만)
    if (f.columnName === 'phone') return `${phoneExpr} as phone`;
    return f.columnName;
  });
  // 시스템/파생/레거시 필드 추가 (FIELD_MAP 외, 기존 흐름 호환)
  selectParts.push('region', 'custom_fields', 'callback');
  return { ok: true, selectClause: selectParts.join(', '), phoneExpr };
}

/**
 * 추출 행 평면화 — `/extract` 라우트 안에 있던 코드를 그대로 옮겼다.
 * ★ B-D75-03: custom_fields JSONB를 flat하게 풀어서 반환 (프론트에서 r[field_key]로 직접 접근 가능)
 * ★ B+0407-1: enum 필드(gender F→여성) 미리 변환 — 모든 frontend 표시 경로 자동 정상화
 * ★ D142 (2026-04-28): custom_fields 평면화 시 모든 값을 String()로 강제 (Harold님 원칙).
 *   custom_1~15는 고객사 업로드 원본을 100% 보존해야 하는데, JSONB에 number/Date 객체 등으로
 *   저장된 케이스가 있으면 프론트에서 typeof로 자동 추론되어 콤마 사고 발생 가능.
 *   백엔드 출구에서 String() 박제 → 프론트 어디서든 number 추론 불가.
 */
export function flattenExtractRow(r: any): any {
  let flat: any;
  if (r.custom_fields && typeof r.custom_fields === 'object') {
    const { custom_fields, ...rest } = r;
    const customFlat = Object.fromEntries(
      Object.entries(custom_fields).map(([k, v]) => [k, v == null ? '' : String(v)])
    );
    flat = { ...rest, ...customFlat };
  } else {
    flat = { ...r };
  }
  for (const fk of Object.keys(FIELD_DISPLAY_MAP)) {
    if (flat[fk] != null) {
      flat[fk] = reverseDisplayValue(fk, flat[fk]);
    }
  }
  return flat;
}

/**
 * ★ 2026-09-29 (Codex 1R high) 보관 추출은 **phone 칸만** 받는다.
 *   보관 표(campaign_send_staging)에는 고객 id 칸이 없어 보관 행과 고객을 **번호로** 잇는다. phone 은 회사 안에서 유일하다
 *   (customers_company_id_phone_key) → 보관 행 하나 = 고객 하나. 다른 번호 칸(custom_N 등)은 유일하지 않아 같은 값의 다른 고객
 *   (추출 조건·매장 범위 밖)의 회신번호·개인정보가 붙을 수 있었다. 화면(추출 창 두 곳)은 원래 phone 만 보낸다.
 */
export const KEEP_PHONE_ONLY_ERROR = '보관 추출은 휴대폰 번호 칸(phone)으로만 할 수 있습니다.';
export function buildKeptSelect(phoneField: unknown): ExtractSelect {
  if (String(phoneField || 'phone') !== 'phone') return { ok: false, error: KEEP_PHONE_ONLY_ERROR };
  return buildExtractSelect('phone');
}

/** 보관 행으로 넣을 번호 — 숫자만 · 1~20자. 그 밖은 null(넣지 않는다) */
export function keepablePhone(raw: unknown): string | null {
  const p = normalizePhone(String(raw ?? ''));
  return p && p.length <= STAGING_TEXT_MAX ? p : null;
}

/**
 * 수신자별 회신번호로 넣을 값 — 옛 화면(`resolveRecipientCallback`)이 보내던 값과 같게 앞뒤 공백만 뗀 원문.
 * 칸 폭(20)을 넘으면 숫자만으로 줄여 보고, 그래도 넘으면 비운다(= 회신번호 없음으로 제외된다).
 */
export function keepableCallback(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (s.length <= STAGING_TEXT_MAX) return s;
  const d = normalizePhone(s);
  return d && d.length <= STAGING_TEXT_MAX ? d : null;
}

/**
 * 칸마다 가장 긴 값(문자 수 기준). 화면의 최장 바이트 계산(`getMaxByteMessage`)이 명단 전체 대신 이 한 행을 읽는다.
 * 값 읽기는 그 함수와 같다(`String(r[field] || '')`).
 */
export function longestValues(rows: any[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      const v = r[k];
      if (v != null && typeof v === 'object') continue;
      const s = String(v || '');
      if (s.length > (out[k]?.length ?? 0)) out[k] = s;
    }
  }
  return out;
}

export interface KeptExtraction {
  extractionId: string | null;
  /** 보관한 행 수 = 발송 대상 후보 수 */
  count: number;
  /** 번호가 비었거나 20자를 넘어 보관하지 않은 행 수 */
  skippedNoPhone: number;
  sample: any[];
  longest: Record<string, string>;
  expiresAt: string | null;
}

/**
 * 평면화된 추출 행을 보관본으로 적재한다(한 트랜잭션 · 5만 행씩 UNNEST).
 * 중간에 실패하면 한 행도 남기지 않는다(반쯤 적재된 명단으로 발송이 접수되지 않게).
 */
export async function keepExtraction(companyId: string, rows: any[]): Promise<KeptExtraction> {
  const phones: string[] = [];
  const names: (string | null)[] = [];
  const kept: any[] = [];
  let skippedNoPhone = 0;
  for (const r of rows) {
    const p = keepablePhone(r?.phone);
    if (!p) { skippedNoPhone++; continue; }
    phones.push(p);
    names.push(r.name == null ? null : String(r.name));
    kept.push(r);
  }
  if (phones.length === 0) {
    return { extractionId: null, count: 0, skippedNoPhone, sample: [], longest: {}, expiresAt: null };
  }

  const extractionId = randomUUID();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < phones.length; i += KEEP_CHUNK) {
      await client.query(
        `INSERT INTO campaign_send_staging (staging_id, company_id, phone, name)
         SELECT $1::uuid, $2::uuid, u.phone, u.name
           FROM UNNEST($3::text[], $4::text[]) AS u(phone, name)`,
        [extractionId, companyId, phones.slice(i, i + KEEP_CHUNK), names.slice(i, i + KEEP_CHUNK)],
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  return {
    extractionId,
    count: phones.length,
    skippedNoPhone,
    sample: kept.slice(0, EXTRACTION_SAMPLE_SIZE),
    longest: longestValues(kept),
    expiresAt: new Date(Date.now() + STAGING_COMMIT_MAX_AGE_HOURS * 3600_000).toISOString(),
  };
}

export type ExtractionState = 'ok' | 'expired' | 'committed';

/**
 * 보관본 상태 — 행이 없거나(정리됨·전부 뺌·남의 회사) 가장 오래된 행이 23시간을 넘으면 'expired'.
 * 커밋 여부는 준비분 규칙과 같다(캠페인이 이 id를 가리키면 발송을 누른 것).
 */
export async function readExtractionState(extractionId: string, companyId: string): Promise<{ state: ExtractionState; count: number }> {
  const r = await query(
    `SELECT COUNT(*)::int AS n,
            MIN(created_at) < NOW() - ($3::int * INTERVAL '1 hour') AS stale,
            EXISTS (SELECT 1 FROM campaigns WHERE staging_id = $1::uuid) AS committed
       FROM campaign_send_staging
      WHERE staging_id = $1::uuid AND company_id = $2::uuid`,
    [extractionId, companyId, STAGING_COMMIT_MAX_AGE_HOURS],
  );
  const row = r.rows[0] || {};
  const n = Number(row.n) || 0;
  if (n === 0 || row.stale === true) return { state: 'expired', count: n };
  if (row.committed === true) return { state: 'committed', count: n };
  return { state: 'ok', count: n };
}

/**
 * 요청 사용자 매장 범위 — `/extract`와 같은 판정(store-scope CT · 사용자만).
 * @returns null = 제한 없음 · string[] = 이 매장 고객만 · 'blocked' = 볼 수 있는 고객 없음
 */
export async function resolveExtractionScope(
  companyId: string, userId: string | undefined, userType: string | undefined,
): Promise<string[] | null | 'blocked'> {
  if (userType !== 'company_user' || !userId) return null;
  const scope = await getStoreScope(companyId, userId);
  if (scope.type === 'filtered') return scope.storeCodes;
  if (scope.type === 'blocked') return 'blocked';
  return null;
}

/** 매장 범위 조건(고객 표 기준) — `/extract`와 같은 조각. filtered면 $n에 매장 코드 배열을 넣는다 */
export interface ScopeSql { sql: string; params: any[] }

function scopeClause(storeCodes: string[] | null, nextIndex: number): ScopeSql {
  if (!storeCodes) return { sql: '', params: [] };
  return {
    sql: ` AND id IN (SELECT customer_id FROM customer_stores WHERE company_id = $1 AND store_code = ANY($${nextIndex}::text[]))`,
    params: [storeCodes],
  };
}

/**
 * 보관본에서 번호로 찾기 — 숫자만 · 최소 3자리 · 최대 50행. 표시 칸은 추출과 같은 조립·평면화.
 * @param storeCodes 요청 사용자 매장 범위(filtered일 때만 · 아니면 null)
 */
export async function searchExtraction(params: {
  extractionId: string; companyId: string; digits: string; select: { selectClause: string; phoneExpr: string }; storeCodes: string[] | null;
}): Promise<{ matched: number; rows: any[] }> {
  const like = `%${params.digits}%`;
  const matchedR = await query(
    `SELECT COUNT(*)::int AS n FROM campaign_send_staging
      WHERE staging_id = $1::uuid AND company_id = $2::uuid AND phone LIKE $3`,
    [params.extractionId, params.companyId, like],
  );
  const scope = scopeClause(params.storeCodes, 5);
  const rowsR = await query(
    `SELECT ${params.select.selectClause}
       FROM customers
      WHERE company_id = $1 AND is_active = true${scope.sql}
        AND phone IN (
          SELECT s.phone FROM campaign_send_staging s
           WHERE s.staging_id = $2::uuid AND s.company_id = $1 AND s.phone LIKE $3
        )
      ORDER BY created_at DESC
      LIMIT $4`,
    [params.companyId, params.extractionId, like, EXTRACTION_SEARCH_LIMIT, ...scope.params],
  );
  return { matched: Number(matchedR.rows[0]?.n) || 0, rows: rowsR.rows.map(flattenExtractRow) };
}

/** 보관본 전체 행(추출 응답과 같은 칸) — 알림톡·브랜드메시지로 넘길 때만 */
export async function readExtractionRows(params: {
  extractionId: string; companyId: string; select: { selectClause: string; phoneExpr: string }; storeCodes: string[] | null;
}): Promise<any[]> {
  const scope = scopeClause(params.storeCodes, 3);
  const r = await query(
    `SELECT ${params.select.selectClause}
       FROM customers
      WHERE company_id = $1 AND is_active = true${scope.sql}
        AND phone IN (
          SELECT s.phone FROM campaign_send_staging s WHERE s.staging_id = $2::uuid AND s.company_id = $1
        )
      ORDER BY created_at DESC`,
    [params.companyId, params.extractionId, ...scope.params],
  );
  return r.rows.map(flattenExtractRow);
}

export type ExtractionWriteResult =
  | { ok: true; count: number; changed: number; missing?: number }
  | { ok: false; status: 409 | 410; code: 'STAGING_COMMITTED' | 'EXTRACTION_EXPIRED'; error: string };

/** 만료 안내(입구 공용) — 화면은 이 코드를 보고 [같은 조건으로 다시 추출]을 띄운다 */
export const EXTRACTION_EXPIRED_ERROR = '추출한 지 23시간이 지나 발송 명단이 만료됐습니다. 같은 조건으로 다시 추출해 주세요.';
const EXPIRED: ExtractionWriteResult = { ok: false, status: 410, code: 'EXTRACTION_EXPIRED', error: EXTRACTION_EXPIRED_ERROR };
const COMMITTED: ExtractionWriteResult = {
  ok: false, status: 409, code: 'STAGING_COMMITTED',
  error: '이미 발송을 누른 명단은 바꿀 수 없습니다.',
};

/** 보관본에서 번호 빼기 — 준비분 잠금 안에서 커밋·만료를 다시 본 뒤 지운다 */
export async function removeFromExtraction(extractionId: string, companyId: string, rawPhones: unknown[]): Promise<ExtractionWriteResult> {
  const phones = [...new Set(rawPhones.map(keepablePhone).filter((p): p is string => !!p))];
  return withStagingLock(extractionId, async () => {
    // 끊긴 확정이 보관 칸에 옮겨 둔 행을 먼저 되돌린다(staging-sweeper parkStagingRows · Codex 3R)
    await restoreParkedStagingRows(extractionId, companyId);
    const st = await readExtractionState(extractionId, companyId);
    if (st.state === 'expired') return EXPIRED;
    if (st.state === 'committed') return COMMITTED;
    if (phones.length === 0) return { ok: true, count: st.count, changed: 0 };
    const del = await query(
      `DELETE FROM campaign_send_staging WHERE staging_id = $1::uuid AND company_id = $2::uuid AND phone = ANY($3::text[])`,
      [extractionId, companyId, phones],
    );
    const changed = Number(del.rowCount) || 0;
    return { ok: true, count: st.count - changed, changed };
  });
}

/**
 * 수신자별 회신번호 칸을 골랐을 때 보관본 callback을 그 칸 값으로 채운다(한 트랜잭션: 비우기 → 채우기).
 * 칸 이름은 번호 칸과 같은 허용 목록(FIELD_MAP 실컬럼 · custom_1~15)만 받는다.
 * @returns missing = 회신번호가 빈 행 수(옛 화면의 "값이 없는 고객 N명" 판정과 같은 뜻)
 */
export async function fillExtractionCallback(
  extractionId: string, companyId: string, column: string,
): Promise<ExtractionWriteResult | { ok: false; status: 400; code: 'INVALID_CALLBACK_COLUMN'; error: string }> {
  const colSelect = buildExtractSelect(column);
  if (!colSelect.ok) return { ok: false, status: 400, code: 'INVALID_CALLBACK_COLUMN', error: '회신번호로 쓸 수 없는 항목입니다.' };
  const valueExpr = `c.${colSelect.phoneExpr}`;
  // 보관 행 ↔ 고객 = phone(회사 안 유일 · buildKeptSelect) → 한 행에 한 고객만 이어진다
  const matchExpr = 'c.phone';
  return withStagingLock(extractionId, async () => {
    // 끊긴 확정이 보관 칸에 옮겨 둔 행을 먼저 되돌린다 — 되돌린 행에도 새 칸 값을 채운다(Codex 3R)
    await restoreParkedStagingRows(extractionId, companyId);
    const st = await readExtractionState(extractionId, companyId);
    if (st.state === 'expired') return EXPIRED;
    if (st.state === 'committed') return COMMITTED;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE campaign_send_staging SET callback = NULL WHERE staging_id = $1::uuid AND company_id = $2::uuid`,
        [extractionId, companyId],
      );
      // 값 규칙 = keepableCallback(앞뒤 공백 뗀 원문 · 20자 넘으면 숫자만 · 그래도 넘으면 비움)
      const upd = await client.query(
        `UPDATE campaign_send_staging s
            SET callback = CASE
              WHEN length(btrim(v.raw)) = 0 THEN NULL
              WHEN length(btrim(v.raw)) <= ${STAGING_TEXT_MAX} THEN btrim(v.raw)
              WHEN length(regexp_replace(v.raw, '[^0-9]', '', 'g')) BETWEEN 1 AND ${STAGING_TEXT_MAX} THEN regexp_replace(v.raw, '[^0-9]', '', 'g')
              ELSE NULL END
           FROM (
             SELECT ${matchExpr} AS phone, COALESCE((${valueExpr})::text, '') AS raw
               FROM customers c
              WHERE c.company_id = $2::uuid AND c.is_active = true
                AND ${matchExpr} IN (SELECT phone FROM campaign_send_staging WHERE staging_id = $1::uuid AND company_id = $2::uuid)
           ) v
          WHERE s.staging_id = $1::uuid AND s.company_id = $2::uuid AND s.phone = v.phone`,
        [extractionId, companyId],
      );
      const miss = await client.query(
        `SELECT COUNT(*)::int AS n FROM campaign_send_staging
          WHERE staging_id = $1::uuid AND company_id = $2::uuid AND (callback IS NULL OR btrim(callback) = '')`,
        [extractionId, companyId],
      );
      await client.query('COMMIT');
      return { ok: true, count: st.count, changed: Number(upd.rowCount) || 0, missing: Number(miss.rows[0]?.n) || 0 };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  });
}
