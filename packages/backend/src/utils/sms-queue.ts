// utils/sms-queue.ts
// ★ 메시징 컨트롤타워 — MySQL 큐 조작의 유일한 진입점
// campaigns.ts, manage-scheduled.ts 등 모든 라우트는 이 모듈을 통해 MySQL 큐에 접근한다.
// 하드코딩 금지. 환경변수/설정파일 기반.

import { mysqlQuery } from '../config/database';
import { loadActiveRules, evaluateContent, logSpamBlockHits, SpamBlockLogEntry } from './spam-block';
import { CACHE_TTL, BATCH_SIZES } from '../config/defaults';
import { isValidSmsTable } from './sms-table-validator';
import { query } from '../config/database';
import { SUCCESS_CODES, PENDING_CODES } from './sms-result-map';
import { classifyResultTables, mergeCampaignCounts, type CampaignAggCounts } from './sms-table-split';
import { splitLinesByMsgType } from './sms-line-split';
import { toQtmsgType } from './qtmsg-type';
// ★ 2026-07-07 비토 게이트웨이 라인 전용 SENDER_KEY 주입 (Agent v1.0.10 kakao_sender_key 필수 대응)
import { withSenderKey } from './alimtalk-emphasize';
// ★ 2026-07-03 KAKAO 문안 학습 코퍼스 적재 (전 채널 학습 통합 Phase 2) — fire-and-forget, 발송 무영향
import { logCampaignTraining, getSourceRef } from './training-logger';

export type { CampaignAggCounts } from './sms-table-split';

// ===== 환경변수 기반 테이블 설정 =====
export const ALL_SMS_TABLES = (process.env.SMS_TABLES || 'SMSQ_SEND').split(',').map(t => t.trim());
for (const t of ALL_SMS_TABLES) {
  if (!isValidSmsTable(t)) {
    console.error(`[QTmsg] ⚠️ 잘못된 SMS 테이블명 감지: "${t}" — SQL Injection 위험. SMS_TABLES 환경변수를 확인하세요.`);
  }
}
// 대량발송 풀 = 테스트(10)·인증(11)·비토 게이트웨이(13·14·15) 제외.
// SMSQ_SEND_13/14/15는 비토 게이트웨이 전용 라인 — 라인그룹 미지정 회사의 일반 발송이
// 비토로 새지 않도록 bulk fallback에서 격리한다(검증 후 실업체 확대 시 정책 재검토).
// ★ 2026-07-17 라인 14·15 추가(자비스 요청, Agent hanjul02/hanjul03): 현재 서버 .env SMS_TABLES는
//   1~11만 담고 있어 이 필터는 무효과지만, 나중에 누가 env에 비토 라인을 넣는 순간
//   미할당 고객사의 일반 발송이 비토 게이트웨이로 새는 것을 여기서 막는다.
const BULK_ONLY_TABLES = ALL_SMS_TABLES.filter(t => !['SMSQ_SEND_10', 'SMSQ_SEND_11', 'SMSQ_SEND_13', 'SMSQ_SEND_14', 'SMSQ_SEND_15'].includes(t));
let rrIndex = 0;
console.log(`[QTmsg] ALL_SMS_TABLES: ${ALL_SMS_TABLES.join(', ')} (${ALL_SMS_TABLES.length}개 Agent)`);
console.log(`[QTmsg] BULK_ONLY_TABLES: ${BULK_ONLY_TABLES.join(', ')} (테스트/인증/비토 제외 ${BULK_ONLY_TABLES.length}개)`);

// ===== 라인그룹 캐시 =====
const lineGroupCache = new Map<string, { tables: string[], hasDedicatedGroup: boolean, expires: number }>();
const LINE_GROUP_CACHE_TTL = CACHE_TTL.lineGroup * 1000;

// ===== 한국시간 변환 헬퍼 =====
export const toKoreaTimeStr = (date: Date) => {
  return date.toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).replace('T', ' ');
};

/**
 * ★ D103: QTmsg 메시지 타입 코드 변환 컨트롤타워
 * 'SMS' → 'S', 'LMS' → 'L', 'MMS' → 'M'
 * campaigns.ts 3곳, auto-campaign-worker 1곳, spam-test-queue 2곳, spam-filter 2곳에서
 * 인라인으로 반복되던 변환 로직을 한 곳으로 통합.
 */
// ★ 2026-06-25: 변환 로직은 순수 모듈 qtmsg-type.ts로 분리(테스트 + 안전 default 'L').
//   기존 `import { toQtmsgType } from './sms-queue'` 호출부 호환 위해 재export.
export { toQtmsgType };

// ===== 라인그룹 테이블 조회 =====

/** 회사/사용자별 발송 테이블 조회 (캐시) — userId가 있으면 사용자 개별 라인그룹 우선 */
export async function getCompanySmsTables(companyId: string, userId?: string): Promise<string[]> {
  // 1) 사용자 개별 라인그룹 확인 (userId가 전달된 경우)
  if (userId) {
    const userCacheKey = `user:${userId}`;
    const userCached = lineGroupCache.get(userCacheKey);
    if (userCached && userCached.expires > Date.now()) return userCached.tables;

    const userResult = await query(`
      SELECT lg.sms_tables
      FROM sms_line_groups lg
      JOIN users u ON u.line_group_id = lg.id
      WHERE u.id = $1 AND lg.is_active = true AND lg.group_type IN ('bulk', 'bito')
    `, [userId]);

    if (userResult.rows.length > 0 && userResult.rows[0].sms_tables?.length > 0) {
      let userTables = userResult.rows[0].sms_tables;
      const validUserTables = userTables.filter((t: string) => {
        if (!isValidSmsTable(t)) {
          console.error(`[QTmsg] ⚠️ user ${userId} 라인그룹에 잘못된 테이블명: "${t}" — 스킵 처리`);
          return false;
        }
        return true;
      });
      if (validUserTables.length > 0) {
        lineGroupCache.set(userCacheKey, { tables: validUserTables, hasDedicatedGroup: true, expires: Date.now() + LINE_GROUP_CACHE_TTL });
        return validUserTables;
      }
    }
    // 사용자 개별 라인그룹 없으면 → 회사 라인그룹 fallback (아래 진행)
  }

  // 2) 회사 라인그룹 (기존 로직)
  const cacheKey = `company:${companyId}`;
  const cached = lineGroupCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.tables;

  const result = await query(`
    SELECT lg.sms_tables
    FROM sms_line_groups lg
    JOIN companies c ON c.line_group_id = lg.id
    WHERE c.id = $1 AND lg.is_active = true AND lg.group_type IN ('bulk', 'bito')
  `, [companyId]);

  const hasDedicatedGroup = result.rows.length > 0 && result.rows[0].sms_tables?.length > 0;
  let tables = hasDedicatedGroup
    ? result.rows[0].sms_tables
    : BULK_ONLY_TABLES;

  if (hasDedicatedGroup) {
    const validTables = tables.filter((t: string) => {
      if (!isValidSmsTable(t)) {
        console.error(`[QTmsg] ⚠️ company ${companyId} 라인그룹에 잘못된 테이블명: "${t}" — 스킵 처리`);
        return false;
      }
      return true;
    });
    tables = validTables.length > 0 ? validTables : BULK_ONLY_TABLES;
  }

  lineGroupCache.set(cacheKey, { tables, hasDedicatedGroup, expires: Date.now() + LINE_GROUP_CACHE_TTL });
  return tables;
}

/** 회사 전용 라인그룹 할당 여부 확인 (발송 차단용) */
export async function hasCompanyLineGroup(companyId: string): Promise<boolean> {
  const cacheKey = `company:${companyId}`;
  const cached = lineGroupCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.hasDedicatedGroup;

  await getCompanySmsTables(companyId);
  const refreshed = lineGroupCache.get(cacheKey);
  return refreshed?.hasDedicatedGroup ?? false;
}

/** 테스트 발송 테이블 조회 (캐시) */
export async function getTestSmsTables(): Promise<string[]> {
  const cached = lineGroupCache.get('test');
  if (cached && cached.expires > Date.now()) return cached.tables;

  const result = await query(`SELECT sms_tables FROM sms_line_groups WHERE group_type = 'test' AND is_active = true LIMIT 1`);
  const tables = (result.rows.length > 0 && result.rows[0].sms_tables?.length > 0)
    ? result.rows[0].sms_tables
    : ['SMSQ_SEND_10'];

  lineGroupCache.set('test', { tables, hasDedicatedGroup: true, expires: Date.now() + LINE_GROUP_CACHE_TTL });
  return tables;
}

/**
 * ★ D103: 테스트/스팸필터 전용 단건 SMS INSERT 컨트롤타워
 * spam-test-queue.ts, spam-filter.ts, campaigns.ts test-send에서
 * 인라인으로 반복되던 테스트 INSERT 로직을 한 곳으로 통합.
 */
export async function insertTestSmsQueue(
  destNo: string,
  callBack: string,
  content: string,
  msgType: string,
  testId: string,
  subject: string,
  extra?: { companyId?: string; billId?: string; mmsImages?: string[] }
): Promise<void> {
  const testTables = await getTestSmsTables();
  const table = testTables[0];
  const mType = toQtmsgType(msgType);
  // ★ D131: MMS 타입인데 이미지 0장이면 원천 거부 (status_code=9007 파일 오류 방지).
  //   실측 2026-04-21: 담당자 테스트 MMS 19건 중 7건(37%)이 이미지 없이 INSERT → 전부 9007.
  //   호출부가 이미지 체크 안 하고 넘기는 실수를 컨트롤타워에서 원천 차단.
  if (mType === 'M' && (!extra?.mmsImages || extra.mmsImages.filter(Boolean).length === 0)) {
    throw new Error('MMS는 이미지 첨부가 필수입니다 (insertTestSmsQueue)');
  }
  if (extra?.companyId || extra?.billId || extra?.mmsImages) {
    // campaigns.ts test-send 호환 (app_etc2=companyId, bill_id=userId, file_name)
    await mysqlQuery(
      `INSERT INTO ${table} (
        dest_no, call_back, msg_contents, msg_type, title_str, sendreq_time, status_code, rsv1, app_etc1, app_etc2, bill_id, file_name1, file_name2, file_name3
      ) VALUES (?, ?, ?, ?, ?, NOW(), 100, '1', ?, ?, ?, ?, ?, ?)`,
      [destNo, callBack, content, mType, subject || '', testId,
       extra.companyId || '', extra.billId || '',
       extra.mmsImages?.[0] || '', extra.mmsImages?.[1] || '', extra.mmsImages?.[2] || '']
    );
  } else {
    await mysqlQuery(
      `INSERT INTO ${table} (
        dest_no, call_back, msg_contents, msg_type, title_str, sendreq_time, status_code, rsv1, app_etc1
      ) VALUES (?, ?, ?, ?, ?, NOW(), 100, '1', ?)`,
      [destNo, callBack, content, mType, subject || '', testId]
    );
  }
}

/** 인증번호 발송 테이블 조회 (캐시) */
export async function getAuthSmsTable(): Promise<string> {
  const cached = lineGroupCache.get('auth');
  if (cached && cached.expires > Date.now()) return cached.tables[0];

  const result = await query(`SELECT sms_tables FROM sms_line_groups WHERE group_type = 'auth' AND is_active = true LIMIT 1`);
  const tables = (result.rows.length > 0 && result.rows[0].sms_tables?.length > 0)
    ? result.rows[0].sms_tables
    : ['SMSQ_SEND_11'];

  lineGroupCache.set('auth', { tables, hasDedicatedGroup: true, expires: Date.now() + LINE_GROUP_CACHE_TTL });
  return tables[0];
}

/**
 * ★ 2026-07-09 담당자/운영자 안내 문자 발신번호 — 한줄로 플랫폼 대표번호(1800-8125).
 * 옛 버그: 안내 문자 call_back을 수신자 본인 번호로 넣어, 발신=수신이 같아 번호도용차단서비스 가입 담당자는 아예 미수신.
 * 인비토=특수유형 부가통신사업자라 대표번호는 별도 회신번호 등록 없이 발신 가능(Harold 확인 2026-07-09).
 * internal-alert의 SYSTEM_SMS_CALLBACK과 동일 소스.
 */
export function getPlatformNoticeCallback(): string {
  return (process.env.SYSTEM_SMS_CALLBACK || '18008125').replace(/\D/g, '');
}

/**
 * ★ 2026-07-17: 라인그룹에 넣을 테이블이 MySQL에 실재하는지 검증 — 슈퍼관리자 쓰기 경로 전용.
 *   isValidSmsTable은 이름 패턴만 본다. 패턴은 맞는데 실재하지 않는 테이블(오타 SMSQ_SEND_99 등)이
 *   라인그룹에 들어가면, 그 라인을 쓰는 적재·취소·집계·정산의 UNION ALL이 통째로 SQL 에러가 난다
 *   (tsc는 SQL 문자열 안 테이블명을 검증하지 못한다 — D227+ 발송결과 전체 다운과 같은 계열).
 *   패턴 검증(validateSmsTables) 통과분만 조회하므로 식별자 주입 위험 없음.
 * @returns 실재하지 않는 테이블명 목록 (빈 배열 = 전부 실재)
 */
export async function findMissingSmsTables(tables: string[]): Promise<string[]> {
  const targets = tables.map((t) => String(t).trim()).filter((t) => isValidSmsTable(t));
  if (targets.length === 0) return [];
  const placeholders = targets.map(() => '?').join(',');
  const rows = await mysqlQuery(
    `SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${placeholders})`,
    targets,
  ) as any[];
  const found = new Set(rows.map((r: any) => String(r.TABLE_NAME)));
  return targets.filter((t) => !found.has(t));
}

/** 캐시 무효화 (라인그룹 설정 변경 시 호출) */
export function invalidateLineGroupCache(companyId?: string, userId?: string) {
  if (userId) {
    lineGroupCache.delete(`user:${userId}`);
  }
  if (companyId) {
    lineGroupCache.delete(`company:${companyId}`);
  }
  if (!companyId && !userId) {
    lineGroupCache.clear();
  }
}

/** INSERT용: 라운드로빈으로 다음 테이블 반환 */
export function getNextSmsTable(tables: string[]): string {
  const table = tables[rrIndex % tables.length];
  rrIndex++;
  return table;
}

// ===== MySQL 큐 조작 (복수 테이블 대응) =====
// ★ 최적화 원칙 (확장성):
// 모든 조회 헬퍼는 UNION ALL 단일 쿼리로 실행한다. 테이블 수(고객사/라인그룹)
// 와 무관하게 DB 왕복 1회만 발생. 이전 Promise.all 병렬 N쿼리보다 더 빠름.
// SQL escape 안전성: 테이블명은 sms-table-validator로 사전 검증된 식별자만 주입.

/** 파라미터를 테이블 수만큼 반복 (UNION ALL 각 서브쿼리에 동일 WHERE 필요) */
function repeatParams(params: any[], count: number): any[] {
  const out: any[] = [];
  for (let i = 0; i < count; i++) out.push(...params);
  return out;
}

/** whereClause 정규화: "WHERE ..." 접두사가 있으면 제거 (호출부 규약 유연화) */
function normalizeWhere(whereClause: string): string {
  return whereClause.replace(/^\s*WHERE\s+/i, '');
}

/**
 * ★ D111 P4: selectFields의 `X as Y` alias 매핑 추출
 *
 * 배경: smsSelectAll은 UNION ALL을 outer `SELECT * FROM (...) AS _u ${suffix}`로 감싼다.
 *   inner에서 `seqno AS idx`로 alias하면 outer `_u`에는 `idx` 컬럼만 존재하고 `seqno`는 없음.
 *   호출부가 suffix에 `ORDER BY seqno`를 쓰면 "column not found" 에러 → 0건 반환.
 *
 * 해결: 컨트롤타워가 selectFields를 파싱해서 alias 맵을 만들고,
 *   suffix의 컬럼 참조를 자동으로 alias로 재작성 → 호출부가 raw/alias 어느 쪽을 써도 동작.
 *
 * 반환: { rawCol: aliasCol } 맵 (대소문자 정규화)
 */
function extractAliasMap(selectFields: string): Record<string, string> {
  const map: Record<string, string> = {};
  // SELECT 절 내 각 항목 분리. 괄호 안 쉼표는 고려하지 않음(현재 CT-04 호출부 전부 단순 컬럼 기반).
  for (const rawItem of selectFields.split(',')) {
    const item = rawItem.trim();
    if (!item) continue;
    // "table.col AS alias" / "col AS alias" / "col alias" 매칭. 함수 호출(SUM/COUNT 등)은 제외.
    const m = item.match(/^([a-zA-Z_][\w.]*)\s+(?:as\s+)?([a-zA-Z_]\w*)\s*$/i);
    if (!m) continue;
    const raw = m[1];
    const alias = m[2];
    // raw가 함수/키워드가 아니고, alias와 다를 때만 매핑
    if (raw.toLowerCase() !== alias.toLowerCase()) {
      // 테이블 prefix가 있으면 컬럼명만도 같이 매핑 (예: c.seqno → idx, seqno → idx)
      const bareRaw = raw.includes('.') ? raw.split('.').pop()! : raw;
      map[raw.toLowerCase()] = alias;
      map[bareRaw.toLowerCase()] = alias;
    }
  }
  return map;
}

/**
 * suffix(ORDER BY / GROUP BY / HAVING)의 식별자 토큰을 alias로 재작성.
 * - 문자열 리터럴('...'), 숫자, SQL 키워드는 건드리지 않음
 * - 매핑에 없는 컬럼은 그대로 둠
 */
function rewriteSuffixWithAliases(suffix: string, aliasMap: Record<string, string>): string {
  if (!suffix || Object.keys(aliasMap).length === 0) return suffix;
  // 문자열 리터럴 보호
  const literals: string[] = [];
  let masked = suffix.replace(/'(?:[^'\\]|\\.)*'/g, (m) => {
    literals.push(m);
    return `\u0000L${literals.length - 1}\u0000`;
  });
  // SQL 키워드 (대소문자 무관)
  const KEYWORDS = new Set([
    'order', 'by', 'group', 'having', 'limit', 'offset', 'asc', 'desc',
    'and', 'or', 'not', 'null', 'is', 'true', 'false',
  ]);
  // 식별자 토큰(backtick 가능)만 재작성
  masked = masked.replace(/`?([a-zA-Z_][\w.]*)`?/g, (match, tok) => {
    if (!tok) return match;
    const lower = tok.toLowerCase();
    if (KEYWORDS.has(lower)) return match;
    if (/^\d/.test(tok)) return match;
    const alias = aliasMap[lower];
    return alias ? alias : match;
  });
  // 리터럴 복원
  masked = masked.replace(/\u0000L(\d+)\u0000/g, (_, i) => literals[Number(i)]);
  return masked;
}

/** ★ COUNT 합산 — UNION ALL 단일 쿼리 */
export async function smsCountAll(tables: string[], whereClause: string, params: any[]): Promise<number> {
  if (tables.length === 0) return 0;
  const w = normalizeWhere(whereClause);
  const sql = `SELECT SUM(cnt) AS total FROM (${
    tables.map(t => `SELECT COUNT(*) AS cnt FROM ${t} WHERE ${w}`).join(' UNION ALL ')
  }) AS _u`;
  const rows = await mysqlQuery(sql, repeatParams(params, tables.length)) as any[];
  return Number(rows[0]?.total || 0);
}

/** ★ 집계 합산 — UNION ALL 단일 쿼리 + JS 합산 */
export async function smsAggAll(tables: string[], selectFields: string, whereClause: string, params: any[]): Promise<any> {
  if (tables.length === 0) return {};
  const w = normalizeWhere(whereClause);
  const innerList = tables.map(t => `SELECT ${selectFields} FROM ${t} WHERE ${w}`).join(' UNION ALL ');
  const rows = await mysqlQuery(innerList, repeatParams(params, tables.length)) as any[];
  const agg: any = {};
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      agg[k] = (agg[k] || 0) + (Number(r[k]) || 0);
    }
  }
  return agg;
}

/**
 * ★ SELECT 합산 — UNION ALL 단일 쿼리
 * _sms_table 메타는 리터럴 컬럼으로 보존. ORDER BY/LIMIT은 outer에서 적용.
 */
export async function smsSelectAll(
  tables: string[],
  selectFields: string,
  whereClause: string,
  params: any[],
  suffix?: string
): Promise<any[]> {
  if (tables.length === 0) return [];
  const w = normalizeWhere(whereClause);
  const unions = tables
    .map(t => `SELECT '${t}' AS _sms_table, ${selectFields} FROM ${t} WHERE ${w}`)
    .join(' UNION ALL ');
  // ★ D111 P4: outer suffix(ORDER BY/GROUP BY)가 inner alias가 아닌 raw 컬럼명을 참조해도 자동 재작성.
  //   호출부가 'seqno as idx' + 'ORDER BY seqno' 써도 'ORDER BY idx'로 자동 치환 → "column not found" 재발 차단
  const aliasMap = extractAliasMap(selectFields);
  const safeSuffix = suffix ? rewriteSuffixWithAliases(suffix, aliasMap) : '';
  const sql = safeSuffix ? `SELECT * FROM (${unions}) AS _u ${safeSuffix}` : unions;
  return await mysqlQuery(sql, repeatParams(params, tables.length)) as any[];
}

/**
 * ★ 2026-06-13: 페이지네이션 전용 SELECT — 테이블별 top-(offset+limit) 선잘라내기 후 병합.
 *
 * 배경(에이스하드웨어 47,846·에이치피오 87,049 예약 상세 10초+):
 *   smsSelectAll은 `SELECT * FROM (UNION ALL ...) AS _u ORDER BY ... LIMIT` 구조라
 *   일치 행 전체(본문 mediumtext 포함)를 임시 테이블에 모은 뒤에야 정렬·LIMIT이 걸린다.
 *   8만 행 캠페인이면 페이지당 8만 행 실체화 = 인덱스가 있어도 수 초.
 *   각 테이블 안에서 먼저 ORDER BY + LIMIT(offset+limit)으로 자르면(2-pass 정렬 — 정렬 키만 정렬
 *   후 필요 행만 fetch) 바깥 병합은 테이블 수 × (offset+limit) 행만 다룬다. 결과는 동일
 *   (각 테이블 상위 K 합집합 ⊇ 전체 상위 K). 깊은 페이지일수록 내부 LIMIT이 커져 완만히 저하.
 *
 * orderBy는 "ORDER BY" 키워드 없이 전달 (예: `seqno DESC, dest_no ASC`).
 */
export async function smsSelectPagedAll(
  tables: string[],
  selectFields: string,
  whereClause: string,
  params: any[],
  orderBy: string,
  limit: number,
  offset: number,
): Promise<any[]> {
  if (tables.length === 0) return [];
  const w = normalizeWhere(whereClause);
  const lim = Math.max(1, Math.floor(Number(limit) || 0));
  const off = Math.max(0, Math.floor(Number(offset) || 0));
  const innerLimit = lim + off;
  // 호출부가 raw 컬럼명으로 정렬을 줘도 alias로 자동 재작성 (smsSelectAll과 동일 안전망)
  const aliasMap = extractAliasMap(selectFields);
  const safeOrder = rewriteSuffixWithAliases(`ORDER BY ${orderBy}`, aliasMap).replace(/^\s*ORDER BY\s+/i, '');
  const unions = tables
    .map(t => `(SELECT '${t}' AS _sms_table, ${selectFields} FROM ${t} WHERE ${w} ORDER BY ${safeOrder} LIMIT ${innerLimit})`)
    .join(' UNION ALL ');
  const sql = `SELECT * FROM (${unions}) AS _u ORDER BY ${safeOrder} LIMIT ${lim} OFFSET ${off}`;
  return await mysqlQuery(sql, repeatParams(params, tables.length)) as any[];
}

/** ★ MIN 합산 — UNION ALL 단일 쿼리 */
export async function smsMinAll(tables: string[], field: string, whereClause: string, params: any[]): Promise<any> {
  if (tables.length === 0) return null;
  const w = normalizeWhere(whereClause);
  const sql = `SELECT MIN(min_val) AS min_val FROM (${
    tables.map(t => `SELECT MIN(${field}) AS min_val FROM ${t} WHERE ${w}`).join(' UNION ALL ')
  }) AS _u`;
  const rows = await mysqlQuery(sql, repeatParams(params, tables.length)) as any[];
  return rows[0]?.min_val || null;
}

/**
 * ★ 다중 campaign_id 배치 집계 — UNION ALL + GROUP BY 단일 쿼리
 * sync-results처럼 여러 캠페인을 한 번에 집계할 때 사용. N개 쿼리 → 1개.
 *
 * @param tables      대상 테이블 목록
 * @param groupField  그룹 컬럼(e.g., 'app_etc1')
 * @param aggFields   `success_count: SUM(CASE ...)` 형식 — 여러 개 지원
 * @param ids         IN 절에 들어갈 값들
 * @returns Map<groupValue, { [aggField]: number }>
 */
export async function smsBatchAggByGroup(
  tables: string[],
  groupField: string,
  aggFields: string,
  ids: (string | number)[],
  // ★ 2026-07-30: 파라미터 없는 정적 조건만(예 msg_type = 'F') — smsCampaignCountsSafe 축 분리용.
  extraWhere?: string,
): Promise<Map<string, Record<string, number>>> {
  const result = new Map<string, Record<string, number>>();
  if (tables.length === 0 || ids.length === 0) return result;

  const placeholders = ids.map(() => '?').join(',');
  const where = `${groupField} IN (${placeholders})${extraWhere ? ` AND ${extraWhere}` : ''}`;

  // 각 테이블에서 group + 집계 값을 UNION ALL 한 뒤, outer에서 다시 GROUP BY로 합산
  const unions = tables
    .map(t => `SELECT ${groupField} AS _grp, ${aggFields} FROM ${t} WHERE ${where} GROUP BY ${groupField}`)
    .join(' UNION ALL ');

  // outer sum: 각 agg field를 이름으로 재합산 (aggFields 파싱 없이 JS에서 합산)
  const rows = await mysqlQuery(unions, repeatParams(ids, tables.length)) as any[];
  for (const r of rows) {
    const grp = String(r._grp);
    const existing = result.get(grp) || {};
    for (const k of Object.keys(r)) {
      if (k === '_grp') continue;
      existing[k] = (existing[k] || 0) + Number(r[k] || 0);
    }
    result.set(grp, existing);
  }
  return result;
}

/**
 * ★ 2026-06-11 정합성 100% 캠페인 결과 집계 — 카운트 산식의 유일한 진입점.
 * 결과(성공/실패)는 월별 이력에서만, 대기는 라이브 큐의 대기 코드(100/104)에서만 센다.
 * 에이전트가 행을 큐→이력으로 옮기는(복사 후 삭제) 사이에 두 저장소를 합산하면 같은 행이
 * 양쪽에서 잡혀 부풀린 값이 PG에 굳는다(toun28 6/11: 실재 7,171행 vs 기록 7,520 —
 * 합이 target을 넘는 순간 재동기화 후보에서 영구 제외). 이력은 append-only라 이 산식은
 * 과대 집계가 구조적으로 불가능하고, 이동 순간의 일시 과소는 다음 사이클에 자연 수렴한다.
 * 소비처: sync(AI/직접)·cleanup·reconcile·refund-sweeper·aggregateSmsCountsByCampaign.
 */
export async function smsCampaignCountsSafe(
  tables: string[],
  ids: (string | number)[],
  groupField: string = 'app_etc1',
  // ★ 2026-07-30 브랜드 합류 후 환불 축 분리용 — 'brand'=msg_type 'F'만 / 'nonBrand'=그 외 / 'all'=전체(기본, 기존 동작 불변).
  //   차감이 두 축(BRAND + message_type)으로 갈리는 'both' 캠페인의 환불 계산에서만 분리 집계를 쓴다.
  msgTypeScope: 'all' | 'brand' | 'nonBrand' = 'all',
): Promise<Map<string, CampaignAggCounts>> {
  const out = new Map<string, CampaignAggCounts>();
  if (tables.length === 0 || ids.length === 0) return out;
  // ★ 2026-07-04: LOG 짝 없는 LIVE(라인13 비토 게이트웨이 등)는 결과까지 집계 (성공 0 사고 근본 수정).
  //   판정 = classifyResultTables (sms-table-split CT 단일 진실). 이중카운트 구조적 불가 근거는 그 함수 주석.
  const { resultTables, pendingLiveTables } = classifyResultTables(tables);
  const SUC = SUCCESS_CODES.join(',');
  const PEN = PENDING_CODES.join(',');
  const scopeWhere = msgTypeScope === 'brand' ? `msg_type = 'F'`
    : msgTypeScope === 'nonBrand' ? `(msg_type IS NULL OR msg_type <> 'F')`
    : '';

  const logAgg = resultTables.length > 0
    ? await smsBatchAggByGroup(resultTables, groupField, `
        COUNT(*) as t,
        SUM(CASE WHEN status_code IN (${SUC}) THEN 1 ELSE 0 END) as s,
        SUM(CASE WHEN status_code NOT IN (${SUC}, ${PEN}) THEN 1 ELSE 0 END) as f,
        SUM(CASE WHEN status_code IN (${PEN}) THEN 1 ELSE 0 END) as p`, ids, scopeWhere)
    : new Map<string, Record<string, number>>();
  const liveAgg = pendingLiveTables.length > 0
    ? await smsBatchAggByGroup(pendingLiveTables, groupField, `
        SUM(CASE WHEN status_code IN (${PEN}) THEN 1 ELSE 0 END) as lp,
        SUM(CASE WHEN status_code NOT IN (${SUC}, ${PEN}) AND mobsend_time IS NULL THEN 1 ELSE 0 END) as lf`, ids, scopeWhere)
    : new Map<string, Record<string, number>>();

  for (const rawId of ids) {
    const id = String(rawId);
    const lg = logAgg.get(id) as { t?: number; s?: number; f?: number; p?: number } | undefined;
    const lv = liveAgg.get(id);
    const merged = mergeCampaignCounts(lg, Number(lv?.lp || 0));
    // ★ 2026-06-17: 라이브 만료 실패(expired-pending-sweeper가 status 4000 마킹, mobsend NULL) fail 집계.
    //   라이브에 결과코드(비성공·비대기) + mobsend NULL = 발송 유실 실패 마킹분 (정상 이동 중은 mobsend 있음). 대기 잔존 차단.
    const lf = Number(lv?.lf || 0);
    merged.fail += lf;
    merged.total += lf;
    out.set(id, merged);
  }
  return out;
}

/**
 * ★ GROUP BY 집계 — UNION ALL + 단일 GROUP BY
 * results.ts의 smsUnionGroupBy를 CT-04로 승격. 오류사유/통신사별 집계 등에 사용.
 */
export async function smsGroupByAll(
  tables: string[],
  rawField: string,
  whereClause: string,
  params: any[]
): Promise<Record<string, number>> {
  if (tables.length === 0) return {};
  const w = normalizeWhere(whereClause);
  const sql = `SELECT _grp, COUNT(*) AS cnt FROM (${
    tables.map(t => `SELECT ${rawField} AS _grp FROM ${t} WHERE ${w}`).join(' UNION ALL ')
  }) AS _u GROUP BY _grp`;
  const rows = await mysqlQuery(sql, repeatParams(params, tables.length)) as any[];
  const result: Record<string, number> = {};
  for (const r of rows) result[String(r._grp ?? '')] = Number(r.cnt || 0);
  return result;
}

/** DELETE/UPDATE: 해당 테이블 모두 실행 */
export async function smsExecAll(tables: string[], sqlTemplate: string, params: any[]): Promise<void> {
  for (const t of tables) {
    await mysqlQuery(sqlTemplate.replace(/SMSQ_SEND/g, t), params);
  }
}

// ===== 로그 테이블 포함 조회 (결과 집계용) =====
// QTmsg Agent가 처리 완료(rsv1=5) 시 LIVE → LOG(SMSQ_SEND_X_YYYYMM) 이동
// 결과 조회 시 LIVE + LOG 모두 조회해야 정확한 성공/실패 집계 가능
let _logTableCache: Set<string> | null = null;
let _logTableCacheTs = 0;

async function getExistingLogTables(): Promise<Set<string>> {
  const now = Date.now();
  if (_logTableCache && (now - _logTableCacheTs) < 5 * 60 * 1000) {
    return _logTableCache;
  }
  const rows = await mysqlQuery(
    `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'SMSQ_SEND_%'`
  ) as any[];
  const logPattern = /^SMSQ_SEND_\d+_\d{6}$/;
  const tables = new Set(rows.map((r: any) => r.TABLE_NAME).filter((n: string) => logPattern.test(n)));
  _logTableCache = tables;
  _logTableCacheTs = now;
  return tables;
}

/**
 * ★ 2026-08-22 신설 — 고객 기준 조회용: 회사 LIVE 테이블 + **최근 N개월** LOG 테이블.
 *
 * `getCompanySmsTablesWithLogs`는 당월·전월 2개월만 붙인다(캠페인 조회는 그 기간이면 충분하다).
 * 고객 360 타임라인은 한 사람의 지난 이력을 보는 화면이라 더 거슬러 올라가야 한다.
 * 기존 함수는 손대지 않는다 — 소비처 10곳이 2개월 전제로 돌고 있다.
 *
 * ⛔ 실존하는 LOG 테이블만 붙인다(`getExistingLogTables`). 없는 테이블을 UNION에 넣으면 쿼리 전체가 죽는다.
 * @param months 1~24. 당월 포함해 과거로 N개월.
 */
export async function getCompanySmsTablesWithLogsRange(companyId: string, months: number): Promise<string[]> {
  const span = Math.min(Math.max(Math.floor(months) || 1, 1), 24);
  const liveTables = await getCompanyAllLiveSmsTables(companyId);
  const existingLogs = await getExistingLogTables();

  const now = new Date();
  const yms: string[] = [];
  for (let i = 0; i < span; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    yms.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  const all = [...liveTables];
  for (const live of liveTables) {
    for (const ym of yms) {
      const logTable = `${live}_${ym}`;
      if (existingLogs.has(logTable)) all.push(logTable);
    }
  }
  return all;
}

/**
 * ★ 슈퍼관리자 전역 조회용 — 전체 LIVE 테이블 + 전체 LOG 테이블
 * 회사/유저 구분 없이 모든 SMSQ_SEND* 테이블(LIVE+LOG)을 반환한다.
 * admin.ts의 sms-detail 등 어드민 범위 조회에서 사용.
 */
export async function getAllSmsTablesWithLogs(): Promise<string[]> {
  const existingLogs = await getExistingLogTables();
  return [...ALL_SMS_TABLES, ...Array.from(existingLogs)];
}

/**
 * ★ 캠페인 단일 조회용 — 해당 회사의 LIVE 테이블 + 발송월 LOG 테이블만 반환
 * admin.ts sms-detail, 결과 상세 조회 등에서 사용. 확장성 O(1~3개).
 *
 * @param companyId - 캠페인 소유 회사 ID
 * @param refDate   - 캠페인 발송 기준 시각 (sent_at || scheduled_at || created_at)
 * @param userId    - (선택) 사용자 라인그룹이 있을 경우
 */
export async function getCampaignSmsTables(
  companyId: string,
  refDate: Date,
  userId?: string,
  sendConfig?: any
): Promise<string[]> {
  // ★ 2026-06-13: 회사/사용자 단일 라인 → 전 라인 합집합으로 교체 (0610 "발송내역 상세 동일 잠재" 후속).
  //   에이치피오 실측 — 발송은 당시 사용자 라인, 조회는 회사 라인만 봐서 슈퍼관리자 캠페인 상세가
  //   0행("발송 내역이 없습니다")이 되던 구멍. 집계 원칙과 동일하게 라인 재배정/해제 내성 확보.
  //   (소비처 grep: admin.ts sms-detail 1곳 — 발송 경로 아님, 조회 전용이라 합집합 안전.)
  // ★ 2026-06-13 속도: 0611부터 적재 워커가 send_config.sentTables에 실제 INSERT 테이블을 기록하므로
  //   기록이 있으면 그 테이블(+해당 월 로그)만 본다 — 예약 상세 [조회] 10초+ 병목의 스캔 폭 축소.
  //   기록 없는 과거 캠페인만 전 라인 합집합으로 동작 (정확성 동일, 폭만 차이).
  const recorded: string[] = Array.isArray(sendConfig?.sentTables)
    ? sendConfig.sentTables.filter((t: any) => typeof t === 'string' && isValidSmsTable(t))
    : [];
  const liveTables = recorded.length > 0
    ? recorded
    : await getCompanyAllLiveSmsTables(companyId, userId);
  const existingLogs = await getExistingLogTables();

  // 발송 기준월 + 전후 1개월(경계/재발송 대비)
  const months: string[] = [];
  for (let offset = -1; offset <= 1; offset++) {
    const d = new Date(refDate.getFullYear(), refDate.getMonth() + offset, 1);
    months.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  const result = [...liveTables];
  for (const live of liveTables) {
    for (const ym of months) {
      const log = `${live}_${ym}`;
      if (existingLogs.has(log)) result.push(log);
    }
  }
  return result;
}

/** 두 라인그룹 테이블 배열을 순서 보존 합집합(중복 제거). 집계 조회가 발송 라인을 놓치지 않게. */
export function mergeLineTables(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])];
}

/**
 * ★ 2026-06-10: 회사 소속 "모든 사용자"의 개별 라인그룹 테이블 합집합 (집계 전용, 캐시).
 *   배경 — 시세이도·에이치피오 예약발송 failed 오판: 발송은 사용자 개별 라인(대량발송(1))으로
 *   나갔는데, 1분 cron(cleanupScheduledCampaigns)이 userId 없이 회사 라인(대량발송(3))만 조회해
 *   0건 → status='failed'. 호출부가 userId를 빠뜨려도 집계 라인이 누락될 수 없도록
 *   회사 단위 전 사용자 라인을 모아 반환한다.
 */
async function getAllCompanyUserLineTables(companyId: string): Promise<string[]> {
  const cacheKey = `companyUsers:${companyId}`;
  const cached = lineGroupCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.tables;

  const result = await query(`
    SELECT DISTINCT lg.sms_tables
    FROM users u
    JOIN sms_line_groups lg ON lg.id = u.line_group_id
    WHERE u.company_id = $1 AND lg.is_active = true AND lg.group_type IN ('bulk', 'bito')
  `, [companyId]);

  const tables: string[] = [];
  for (const row of result.rows) {
    const arr: string[] = row.sms_tables || [];
    for (const t of arr) {
      if (isValidSmsTable(t)) {
        if (!tables.includes(t)) tables.push(t);
      } else {
        console.error(`[QTmsg] ⚠️ company ${companyId} 사용자 라인그룹에 잘못된 테이블명: "${t}" — 스킵`);
      }
    }
  }
  lineGroupCache.set(cacheKey, { tables, hasDedicatedGroup: tables.length > 0, expires: Date.now() + LINE_GROUP_CACHE_TTL });
  return tables;
}

/**
 * ★ 2026-06-11: 시스템 전체 bulk 라인 테이블 합집합 (캐시).
 *   배경 — 에이치피오 사고 캠페인(취소 잔존 2,129건): sentTables 기록이 없고 사용자 라인도 해제된 캠페인을
 *   "현재 배정" 기준 합집합이 못 봐 1분 안전망(cancelled-queue-sweeper)이 영구 무력 + 에이전트가 계속 발송.
 *   라인 해제/재배정과 무관하게 과거 발송분을 항상 보도록 bulk 라인 전체를 합친다.
 *   DB(sms_line_groups)가 진실, 비어 있으면 환경변수 기반 BULK_ONLY_TABLES fallback.
 */
export async function getAllBulkSmsTables(): Promise<string[]> {
  const cached = lineGroupCache.get('all-bulk');
  if (cached && cached.expires > Date.now()) return cached.tables;

  const result = await query(
    `SELECT sms_tables FROM sms_line_groups WHERE group_type = 'bulk' AND is_active = true`
  );
  const merged: string[] = [];
  for (const row of result.rows) {
    const arr: string[] = row.sms_tables || [];
    for (const t of arr) {
      if (isValidSmsTable(t)) {
        if (!merged.includes(t)) merged.push(t);
      } else {
        console.error(`[QTmsg] ⚠️ bulk 라인그룹에 잘못된 테이블명: "${t}" — 스킵`);
      }
    }
  }
  const tables = merged.length > 0 ? merged : BULK_ONLY_TABLES;
  lineGroupCache.set('all-bulk', { tables, hasDedicatedGroup: tables.length > 0, expires: Date.now() + LINE_GROUP_CACHE_TTL });
  return tables;
}

/**
 * ★ 2026-07-07: 비토 게이트웨이 라인 테이블 합집합 (캐시).
 *   비토 Agent(v1.0.10+)는 알림톡에 발신프로필키(kakao_sender_key)를 명시 요구한다
 *   (미동봉 = Agent 필드매핑 실패 → status_code 9999, 게이트웨이 도달 X).
 *   insertAlimtalkQueue가 INSERT 대상 테이블이 이 목록에 있을 때만 SENDER_KEY를 주입한다.
 *   DB(sms_line_groups group_type='bito')가 진실 — 하드코딩 금지. 미설정이면 빈 배열(주입 어디에도 X).
 */
export async function getBitoSmsTables(): Promise<string[]> {
  const cached = lineGroupCache.get('all-bito');
  if (cached && cached.expires > Date.now()) return cached.tables;

  const result = await query(
    `SELECT sms_tables FROM sms_line_groups WHERE group_type = 'bito' AND is_active = true`
  );
  const merged: string[] = [];
  for (const row of result.rows) {
    const arr: string[] = row.sms_tables || [];
    for (const t of arr) {
      if (isValidSmsTable(t)) {
        if (!merged.includes(t)) merged.push(t);
      } else {
        console.error(`[QTmsg] ⚠️ bito 라인그룹에 잘못된 테이블명: "${t}" — 스킵`);
      }
    }
  }
  lineGroupCache.set('all-bito', { tables: merged, hasDedicatedGroup: merged.length > 0, expires: Date.now() + LINE_GROUP_CACHE_TTL });
  return merged;
}

/**
 * ★ 2026-06-11: 발송 큐 변경(취소/수신자삭제/예약시간변경/문안수정) 전용 — live 라인 테이블 합집합.
 *   배경 — 에이치피오 예약취소 미삭제 발송 사고: 적재는 사용자 라인(getCompanySmsTables(companyId, userId)),
 *   취소는 회사 라인(getCompanySmsTables(companyId))만 DELETE → 0건 삭제 → PG만 cancelled 표시 → 예약 시각 실발송.
 *   발송 큐 행을 찾거나 바꾸는 모든 경로는 이 함수로 회사+사용자+회사 전 사용자 라인을 전부 본다.
 *   ★ 2026-06-11 보강: 전 bulk 합집합 포함 — 라인 해제/재배정 후에도 과거 발송 라인이 항상 보인다
 *   (소비처: 큐 작업 6곳 getCampaignQueueTables + 집계 10곳 getCompanySmsTablesWithLogs 자동 보강).
 */
export async function getCompanyAllLiveSmsTables(companyId: string, userId?: string): Promise<string[]> {
  const userLive = await getCompanySmsTables(companyId, userId);
  const companyLive = userId ? await getCompanySmsTables(companyId) : userLive;
  const allUserLive = await getAllCompanyUserLineTables(companyId);
  const allBulk = await getAllBulkSmsTables();
  return mergeLineTables(mergeLineTables(mergeLineTables(userLive, companyLive), allUserLive), allBulk);
}

/**
 * ★ 2026-06-11 씨앗 제거 2단계: 캠페인 큐 작업(취소/수신자삭제/시간변경/문안수정/안전망) 대상 테이블.
 *   적재 워커가 send_config.sentTables에 실제 INSERT한 테이블 목록을 기록하므로 그 기록을 1순위로 합치고,
 *   라인그룹이 이후 재배정되어도 발송 당시 테이블을 직접 본다. 기록 없는 과거 캠페인은 전 라인 합집합으로 동작.
 */
export async function getCampaignQueueTables(companyId: string, userId?: string, sendConfig?: any): Promise<string[]> {
  const live = await getCompanyAllLiveSmsTables(companyId, userId);
  const recorded: string[] = Array.isArray(sendConfig?.sentTables)
    ? sendConfig.sentTables.filter((t: any) => typeof t === 'string' && isValidSmsTable(t))
    : [];
  return mergeLineTables(recorded, live);
}

/** 회사 발송 테이블 + 로그 테이블 (결과 조회용) */
export async function getCompanySmsTablesWithLogs(companyId: string, userId?: string): Promise<string[]> {
  // ★ 집계 전용 — user 라인그룹 + company 라인그룹 + 회사 소속 전 사용자 라인그룹 합집합.
  //   발송이 어느 라인으로 나갔든 포함 + 발송 후 라인그룹이 바뀌어도 과거 발송 집계가 안 깨지는 내성.
  //   2026-06-10: 호출부 userId 의존 제거 — userId 미전달이어도 회사 전 사용자 라인 포함 (failed 오판 근본 차단).
  //   발송 경로(getCompanySmsTables)는 불변.
  const liveTables = await getCompanyAllLiveSmsTables(companyId, userId);
  const existingLogs = await getExistingLogTables();

  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevYm = `${prev.getFullYear()}${String(prev.getMonth() + 1).padStart(2, '0')}`;

  const allTables = [...liveTables];
  for (const live of liveTables) {
    for (const suffix of [ym, prevYm]) {
      const logTable = `${live}_${suffix}`;
      if (existingLogs.has(logTable)) {
        allTables.push(logTable);
      }
    }
  }
  return allTables;
}

// ===== ★ D106: 로그 테이블 자동 생성 (당월+다음달) =====
// 앱 기동 시 호출 — 202604 미생성 사고 재발 방지
// MySQL root 권한 필요 (smsuser는 CREATE 불가 → mysqlRootQuery 사용)

let _ensureLogTablesRan = false;

export async function ensureMonthlyLogTables(): Promise<void> {
  if (_ensureLogTablesRan) return;
  _ensureLogTablesRan = true;

  try {
    const now = new Date();
    // 당월 + 다음달 2개월분 확인/생성
    const months: string[] = [];
    for (let offset = 0; offset <= 1; offset++) {
      const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      months.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`);
    }

    const existingLogs = await getExistingLogTables();

    for (const ym of months) {
      for (const baseTable of ALL_SMS_TABLES) {
        const logTable = `${baseTable}_${ym}`;
        if (existingLogs.has(logTable)) continue;

        try {
          await mysqlQuery(`CREATE TABLE IF NOT EXISTS ${logTable} LIKE ${baseTable}`);
          console.log(`[QTmsg] 로그 테이블 자동 생성: ${logTable}`);
        } catch (createErr: any) {
          // CREATE 권한 없으면 (smsuser) 경고만 출력
          if (createErr.code === 'ER_TABLEACCESS_DENIED_ERROR') {
            console.warn(`[QTmsg] ⚠️ 로그 테이블 생성 권한 없음: ${logTable} — root로 수동 생성 필요`);
          } else {
            console.error(`[QTmsg] 로그 테이블 생성 실패: ${logTable}`, createErr);
          }
        }
      }
    }

    // 캐시 무효화
    _logTableCache = null;
    _logTableCacheTs = 0;
  } catch (err) {
    console.error('[QTmsg] 로그 테이블 자동 생성 에러:', err);
  }
}

// ===== 브랜드메시지 큐 (2026-07-30 재구축 — SMSQ msg_type='F') =====
// 옛 IMC_BM_FREE_BIZ_MSG/IMC_BM_BASIC_BIZ_MSG 적재는 테이블 미실재(1146)로 폐기.
// 알림톡(msg_type='K')과 같은 라인 테이블·같은 컬럼 집합을 쓴다 — 결과·집계·취소·정산이 자동 합류.

/**
 * 브랜드 큐 INSERT 실패 — 그 전까지 커밋된 건수를 함께 전달한다(AlimtalkQueueInsertError와 동일 계약).
 * 배치가 독립 커밋이라 "실패 = 0건 적재"가 아니다. 호출부는 inserted만큼을 발송분으로 센다.
 */
export class BrandQueueInsertError extends Error {
  constructor(message: string, public readonly inserted: number) {
    super(message);
    this.name = 'BrandQueueInsertError';
  }
}

export interface BrandQueueRow {
  phone: string;
  /** 대체발송(SMS/LMS) 발신번호 — call_back */
  callback: string;
  /** CT-12 buildBrandQueuePayload 산출물 msgContents — 자유형=순수 본문 / 기본형=TYPE_DEF+변수 JSON (★2026-08-15 규약 정정) */
  msgContents: string;
  /** CT-12 buildBrandQueuePayload 산출물 etcJson — senderkey+제어·부가 필드 JSON. 브랜드는 항상 필수 */
  etcJson: string;
  /** 기본형만 — k_template_code */
  templateCode?: string;
  /** 'S'/'L'(원문 그대로)은 본문이 JSON이라 불가 — 게이트웨이가 오류 로그 없이 버린다 */
  nextType: 'N' | 'A' | 'B';
  nextContents?: string;
  /** 'B'(LMS 대체) 제목 — title_str */
  titleStr?: string;
  /** 예약 시각(KST 문자열). 없으면 NOW() = 즉시 */
  reservedDate?: string;
  /** app_etc2 — companyId 추적 */
  companyId?: string;
}

/**
 * CT-04: 브랜드메시지 발송 큐 INSERT (SMSQ_SEND에 msg_type='F')
 * QTmsg Agent가 SMSQ_SEND에서 가져가서 발송. 결과는 알림톡과 동일하게 SMSQ_SEND_YYYYMM.
 *
 * @param appEtc1 캠페인/추적 식별자 — 결과·정산·취소 매칭 축(app_etc1). 누락 시 결과 미조회.
 */
export async function insertBrandQueue(
  tables: string[],
  rows: BrandQueueRow[],
  appEtc1?: string,
): Promise<number> {
  if (rows.length === 0) return 0;
  if (tables.length === 0) throw new BrandQueueInsertError('브랜드메시지 발송 테이블이 없습니다', 0);

  const table = tables[0]; // 알림톡과 동일 — 첫 번째 테이블 사용

  // 첫 INSERT 전 전 행 검증 — 형식 결함이 배치 중간에 터져 부분 발송이 되지 않게(fail-closed).
  for (const r of rows) {
    // 조립은 CT-12 buildBrandQueuePayload가 보장한다 — 여기는 빈 값 방어만(이중 조립 금지).
    if (!String(r.etcJson || '').trim()) {
      throw new BrandQueueInsertError('브랜드메시지 발신 설정 정보가 비어 있습니다', 0);
    }
    if (!String(r.msgContents || '').trim()) {
      throw new BrandQueueInsertError('브랜드메시지 본문이 비어 있습니다', 0);
    }
    if (!['N', 'A', 'B'].includes(r.nextType)) {
      throw new BrandQueueInsertError(`브랜드메시지 대체발송 코드가 올바르지 않습니다: ${r.nextType}`, 0);
    }
    if ((r.nextType === 'A' || r.nextType === 'B') && !String(r.nextContents || '').trim()) {
      throw new BrandQueueInsertError('대체발송(A/B)인데 대체 문구(k_next_contents)가 없습니다', 0);
    }
    if (r.nextType === 'B' && !String(r.titleStr || '').trim()) {
      throw new BrandQueueInsertError('LMS 대체발송(B)인데 제목(title_str)이 없습니다', 0);
    }
  }

  let inserted = 0;
  const BATCH = 5000;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const values: string[] = [];
    const params: any[] = [];

    for (const r of batch) {
      // 예약이면 지정 시각, 아니면 NOW() — bulkInsertSmsQueue 즉시발송과 동일 기준.
      const reservedExpr = r.reservedDate ? '?' : 'NOW()';
      values.push(`(?, ?, ?, 'F', ?, ?, ?, ?, NULL, ${reservedExpr}, NOW(), '1', ?, ?, ?)`);
      params.push(
        r.phone,                                      // dest_no
        r.callback || '',                             // call_back (대체발송 발신번호)
        r.msgContents,                                // msg_contents (JSON 문자열)
        r.titleStr || null,                           // title_str (B = LMS 대체 제목)
        r.templateCode || null,                       // k_template_code (기본형만)
        r.nextType,                                   // k_next_type (N/A/B만 — S/L 불가)
        r.nextContents || null,                       // k_next_contents
      );
      if (r.reservedDate) params.push(r.reservedDate); // sendreq_time
      params.push(
        r.etcJson,                                    // k_etc_json — senderkey+제어·부가 필드(CT-12 조립본)
        appEtc1 || null,                              // app_etc1 (캠페인/추적 식별자)
        r.companyId || null,                          // app_etc2 (companyId 추적)
      );
    }

    // 배치는 각각 독립 커밋 — 실패해도 커밋된 건수를 실어서 던진다(B-0727-1 계약 미러).
    try {
      await mysqlQuery(
        `INSERT INTO ${table} (
          dest_no, call_back, msg_contents, msg_type, title_str,
          k_template_code, k_next_type, k_next_contents, k_button_json,
          sendreq_time, msg_instm, rsv1, k_etc_json, app_etc1, app_etc2
        ) VALUES ${values.join(',')}`,
        params
      );
    } catch (batchErr: any) {
      throw new BrandQueueInsertError(
        `브랜드메시지 큐 INSERT 실패 (앞선 ${inserted}건은 커밋됨): ${batchErr?.message || batchErr}`,
        inserted,
      );
    }
    inserted += batch.length;
  }

  return inserted;
}

/**
 * 알림톡 큐 INSERT 실패 — **그 전까지 커밋된 건수**를 함께 전달한다.
 * ★ 2026-07-27 (B-0727-1): 배치가 독립 커밋이라 "실패 = 0건 적재"가 아니다.
 *   호출부는 이 값을 적재 성공분으로 세야 환불이 실제 발송분을 넘지 않는다.
 */
export class AlimtalkQueueInsertError extends Error {
  constructor(message: string, public readonly inserted: number) {
    super(message);
    this.name = 'AlimtalkQueueInsertError';
  }
}

/**
 * CT-04: 알림톡 발송 큐 INSERT (SMSQ_SEND에 msg_type='K')
 * QTmsg Agent가 SMSQ_SEND에서 가져가서 발송
 */
export async function insertAlimtalkQueue(
  tables: string[],
  rows: {
    phone: string;
    callback: string;
    message: string;
    templateCode: string;
    nextType?: string;    // 실패 시 폴백: N/S/L/A/B (기본 L)
    nextContents?: string; // A/B일 때 대체 문구
    buttonJson?: string;  // k_button_json
    etcJson?: string;     // k_etc_json (강조표기 title, senderkey 등)
    titleStr?: string;
    reservedDate?: string;
    companyId?: string;
  }[],
  appEtc1?: string,   // ★ #4-c (2026-06-01): app_etc1 = 캠페인/추적 식별자 — 결과·정산 매칭(results.ts WHERE app_etc1=?). 누락 시 알림톡 발송 결과 미조회.
): Promise<number> {
  if (rows.length === 0) return 0;

  const table = tables[0]; // 알림톡은 첫 번째 테이블 사용
  let inserted = 0;

  // ★ 2026-07-07: 비토 게이트웨이 라인 전용 SENDER_KEY(발신프로필키) 주입.
  //   비토 Agent v1.0.10+는 kakao_sender_key 필수(미동봉 = 필드매핑 실패 9999·발송 전 차단).
  //   표준 QTmsg 라인은 중계서버가 템플릿코드로 자동 도출 + 에이전트 select_sql이 k_etc_json을
  //   SQL 합성(D234+)하므로 절대 주입하지 않는다 — INSERT 대상이 bito 라인일 때만 병합.
  //   templateCode→profile_key 조인은 발송 gate(campaigns.ts:1390)·resolveTemplateContext(alimtalk.ts)와
  //   동일 컬럼·동일 조인. 알림톡 4경로 전부 호출당 단일 템플릿(rows 전행 동일 templateCode+companyId)이라 rows[0] 기준 1회 조회.
  let bitoSenderKey: string | null = null;
  const bitoTables = await getBitoSmsTables();
  if (bitoTables.includes(table)) {
    const first = rows[0];
    if (first?.templateCode && first?.companyId) {
      try {
        const skRes = await query(
          `SELECT p.profile_key
             FROM kakao_templates t
             JOIN kakao_sender_profiles p ON p.id = t.profile_id
            WHERE t.company_id = $1 AND t.template_code = $2
            LIMIT 1`,
          [first.companyId, first.templateCode],
        );
        bitoSenderKey = skRes.rows[0]?.profile_key || null;
      } catch (skErr) {
        console.error('[QTmsg] 비토 라인 SENDER_KEY 조회 실패 (주입 없이 진행):', skErr);
      }
    }
    if (!bitoSenderKey) {
      console.error(
        `[QTmsg] ⚠️ 비토 라인(${table}) 알림톡 SENDER_KEY 도출 실패 — template=${rows[0]?.templateCode || '(없음)'}, company=${rows[0]?.companyId || '(없음)'}. ` +
        `k_etc_json에 SENDER_KEY 미주입 → Agent 필드검증 실패(9999) 예상`,
      );
    }
  }

  // 배치 단위 INSERT (5000건씩)
  const BATCH = 5000;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const values: string[] = [];
    const params: any[] = [];

    for (const r of batch) {
      const idx = params.length;
      // ★ 2026-07-07: 비토 라인만 SENDER_KEY 병합. varchar(1024) 초과 시 원본 유지(INSERT 오류로 배치 전체 실패 차단).
      let rowEtcJson: string | null = r.etcJson || null;
      if (bitoSenderKey) {
        const mergedEtc = withSenderKey(r.etcJson, bitoSenderKey);
        if (mergedEtc.length <= 1024) {
          rowEtcJson = mergedEtc;
        } else {
          console.error(`[QTmsg] ⚠️ k_etc_json 1024자 초과(${mergedEtc.length}) — SENDER_KEY 미주입(원본 유지), template=${r.templateCode}`);
        }
      }
      values.push(`(?, ?, ?, 'K', ?, ?, ?, ?, ?, NOW(), NOW(), '1', ?, ?, ?)`);
      params.push(
        r.phone,                       // dest_no
        r.callback,                    // call_back
        r.message,                     // msg_contents
        r.titleStr || null,            // title_str
        r.templateCode,                // k_template_code
        r.nextType || 'L',             // k_next_type
        r.nextContents || null,        // k_next_contents
        r.buttonJson || null,          // k_button_json
        rowEtcJson,                    // k_etc_json (비토 라인 = SENDER_KEY 병합 / 표준 라인 = 원본)
        appEtc1 || null,               // app_etc1 (캠페인/추적 식별자 — #4-c 결과 매칭 fix)
        r.companyId || null,           // app_etc2 (companyId 추적용)
      );
    }

    // ★ 2026-07-27 (B-0727-1): 배치는 각각 독립 커밋이다(풀에서 연결을 빌려 단일 쿼리 실행, 전체를 감싸는
    //   트랜잭션 없음). 뒤 배치가 실패해도 앞 배치는 이미 큐에 남아 발송된다. 그래서 실패를 그냥 던지면
    //   호출부가 "한 건도 안 들어갔다"로 알고 전량 환불하는데 실제로는 앞 배치가 나간다(환불 후 실발송).
    //   실패해도 **커밋된 건수를 실어서** 던진다 — 호출부가 그만큼은 적재된 것으로 세게.
    try {
      await mysqlQuery(
        `INSERT INTO ${table} (
          dest_no, call_back, msg_contents, msg_type, title_str,
          k_template_code, k_next_type, k_next_contents, k_button_json,
          sendreq_time, msg_instm, rsv1, k_etc_json, app_etc1, app_etc2
        ) VALUES ${values.join(',')}`,
        params
      );
    } catch (batchErr: any) {
      throw new AlimtalkQueueInsertError(
        `알림톡 큐 INSERT 실패 (앞선 ${inserted}건은 커밋됨): ${batchErr?.message || batchErr}`,
        inserted,
      );
    }
    inserted += batch.length;
  }

  // ★ 2026-07-03 KAKAO(알림톡) 문안 학습 코퍼스 적재 (Phase 2).
  //   ⚠️ 기간계 무영향: 큐 INSERT 완료 후 · 미await 비동기 IIFE(fire-and-forget) · try-catch 이중 격리 · return 값/타이밍 불변.
  //   알림톡 4경로(직접발송/자동캠페인/direct-send-processor/여정)의 단일 길목 = 여기서 1회 커버.
  //   알림톡=승인 템플릿(정보성) → isAd=false. 캠페인당 1회(대표 rows[0] 본문, PII는 maskForTraining이 마스킹).
  //   ★ 2026-07-04 source_ref=hmac(appEtc1) 평문(결과 라벨 환류·dup-guard와 키 일치). companyId/appEtc1/본문 없으면 skip.
  //   ★ 2026-07-03 중복 가드(실측 결함 fix): 커밋/예약 경로는 createDirectSendCampaign가 이미 같은 캠페인의
  //     KAKAO 문안을 적재(source_ref=hmac(appEtc1)) — 그 행이 있으면 skip해 같은 발송 2행 적재를 차단.
  void (async () => {
    try {
      const first = rows[0];
      if (!appEtc1 || !first?.companyId || !first?.message) return;
      const dup = await query(
        `SELECT 1 FROM ai_training_logs WHERE source_ref = $1 LIMIT 1`,
        [getSourceRef(appEtc1)],
      );
      if (dup.rows.length > 0) return; // 기존 경로가 이미 이 캠페인 문안을 적재함
      await logCampaignTraining({
        campaignId: appEtc1,
        companyId: first.companyId,
        messageType: 'KAKAO',
        isAd: false,
        targetCount: inserted,
        finalMessage: first.message,
        finalSource: 'manual',
      });
    } catch { /* 학습 적재 실패는 발송에 영향 없음 */ }
  })();

  return inserted;
}

// (2026-07-30) 옛 카카오 전용 조회 헬퍼 7종(kakaoAgg·kakaoCountPending·kakaoCancelPending·
// kakaoCountWhere·kakaoSelectWhere·kakaoBatchAggByGroup·kakaoGroupBy)은 삭제됐다.
// 브랜드 행이 SMSQ(msg_type='F')로 합류해 smsCampaignCountsSafe·smsCountAll·smsExecAll이 그대로 커버한다.

/** 금칙어 탐지에 넘기는 맥락 — 없어도 검사는 돌고, 회사 예외만 적용되지 않는다 */
export interface SpamBlockContext {
  companyId?: string | null;
  userId?: string | null;
  /** 어느 발송 경로인지(로그용) — 'direct' · 'campaign' · 'journey' · 'automarketing' 등 */
  source?: string | null;
}

/** 판정 N건마다 이벤트 루프를 양보한다 — 자르지 않고 늦춘다(임계 경로 밖이라 늦어도 된다) */
const DETECT_YIELD_EVERY = 200;
const yieldToLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * 발송 문안 스냅샷 — **동기**. 중복 문안을 접어 건수만 센다.
 *
 * 왜 스냅샷이 필요한가: 판정을 비동기로 미루면 그 사이 호출부가 `rows`를 손댈 수 있다.
 * 판정이 본 문안과 실제 나간 문안이 달라지면 탐지 이력이 증거 노릇을 못 한다.
 * 여기서는 문자열 조립과 Map 적재만 한다 — 정규식·DB 없음.
 */
function snapshotSendContents(rows: any[][]): Map<string, number> {
  // row[2]=msg_contents, row[4]=title_str — 제목도 검사 대상이다
  const found = new Map<string, number>();
  for (const row of rows) {
    const content = `${String(row[4] ?? '')}
${String(row[2] ?? '')}`;
    found.set(content, (found.get(content) ?? 0) + 1);
  }
  return found;
}

/**
 * 금칙어 **탐지**. ⬛ 발송을 막지 않고, 발송을 기다리게 하지도 않는다.
 *
 * ⬛ 왜 막지 않는가 (★2026-08-19 탐지 전용으로 좁힘)
 *   호출 시점은 크레딧 차감이 **끝난 뒤**다. 행을 버리든 throw하든 정합이 깨진다 —
 *   버리면 호출부 17곳이 줄어든 건수를 제각각 해석하고(여정은 반환값을 안 본다),
 *   throw하면 환불 멱등이 캠페인 단위 누적이라 재차단 시 환불 0으로 실차감이 남는다.
 *   차단은 판정을 차감 **앞** preflight로 옮기는 재설계 뒤에 연다(근거 = spam-block.ts 머리).
 *
 * ⬛ 왜 임계 경로 밖인가 (★0819 Codex 2R — 같은 뿌리 두 번째)
 *   종전에는 로그만 비동기로 빼고 판정은 `Promise.race` 2초 상한 안에 뒀다. 그런데
 *   **문안 순회와 판정이 전부 동기라 한번 시작하면 타이머가 뜨지 못한다** — 상한이 상한이 아니었다.
 *   탐지는 발송에 아무 값을 주지 않으므로 **전부 임계 경로 밖으로** 보냈다.
 *   그러자 상한 상수·race·타임아웃 분기가 함께 사라졌다(덧댄 장치가 사라지면 뿌리를 고친 것이다).
 *   대신 일정 건수마다 이벤트 루프를 양보해 긴 판정이 프로세스를 붙잡지 않게 한다.
 *
 * ⚠ 실패·지연은 전부 삼킨다. 탐지 때문에 발송이 죽거나 늦으면 안 된다(fail-open).
 */
async function detectSpamBlock(contents: Map<string, number>, tables: string[], ctx?: SpamBlockContext): Promise<void> {
  const authTable = await getAuthSmsTable();
  // 시스템 발송(인증번호·조치 고지·내부 알림)은 검사 대상이 아니다 — 걸리면 로그인 자체가 막힌다
  if (tables.length > 0 && tables.every((t) => t === authTable)) return;

  const rules = await loadActiveRules();
  if (rules.length === 0) return;

  const entries: SpamBlockLogEntry[] = [];
  let detected = 0;
  let seen = 0;
  for (const [content, count] of contents) {
    const verdict = evaluateContent(content, rules, ctx?.companyId ?? null);
    if (verdict.hits.length > 0) {
      entries.push({ verdict, affectedRows: count, contentSample: content });
      detected += count;
    }
    if (++seen % DETECT_YIELD_EVERY === 0) await yieldToLoop();
  }
  if (entries.length === 0) return;

  console.warn(
    `[spam-block] 탐지 ${detected}건 — 발송은 그대로 진행 (company=${ctx?.companyId || '-'} source=${ctx?.source || '-'})`
  );
  await logSpamBlockHits({ entries, companyId: ctx?.companyId, userId: ctx?.userId, source: ctx?.source });
}

/** 동시에 도는 탐지 작업 상한 — 넘으면 그 배치는 건너뛴다(조용히 버리지 않고 로그로 남긴다) */
const DETECT_MAX_CONCURRENT = 2;
let detectInFlight = 0;

/**
 * 탐지를 임계 경로 밖으로 던진다.
 *
 * ⛔ 상한을 두는 이유 (★0819 Codex 2R) — `void`로 던지기만 하면 호출마다 새 작업이 뜬다.
 *   대량 발송이 겹치면 작업마다 문안 Map을 든 채 규칙을 스캔하고 PG INSERT를 내므로
 *   heap·PG 대기열·이벤트 루프가 함께 포화된다. 동시 2건으로 묶고, 넘친 배치는 **건너뛴 사실을 남긴다.**
 *
 * ⛔ durable outbox·shutdown drain은 **일부러 만들지 않는다** — 잃는 것을 나란히 적어보면 답이 나온다.
 *   지금 위험 = 재기동 시 진행 중이던 탐지 **로그 한 건** 유실(발송·돈과 무관).
 *   덧대면 생기는 위험 = outbox 적체·drain 실패·워커 정지가 새 실패 축이 된다.
 *   후자가 더 크므로 이 손실은 **명시적으로 수용한다**(LESSONS_BACKEND "덧댄 장치가 새 실패 축이 된다").
 *   차단으로 승격할 때 증거 요건이 올라가면 그때 다시 판단한다.
 */
function dispatchSpamDetection(contents: Map<string, number>, tables: string[], ctx?: SpamBlockContext): void {
  if (contents.size === 0) return;
  if (detectInFlight >= DETECT_MAX_CONCURRENT) {
    console.warn(
      `[spam-block] 동시 탐지 상한(${DETECT_MAX_CONCURRENT}) 도달 — 이 배치는 탐지를 건너뛴다 ` +
      `(company=${ctx?.companyId || '-'} source=${ctx?.source || '-'} 문안 ${contents.size}종)`
    );
    return;
  }
  detectInFlight += 1;
  void detectSpamBlock(contents, tables, ctx)
    .catch((err: any) => console.error('[spam-block] 탐지 실패 — 발송에는 영향 없다:', err?.message || err))
    .finally(() => { detectInFlight -= 1; });
}

// ===== ★ D72: SMS/LMS/MMS bulk INSERT (성능 컨트롤타워) =====

/**
 * SMS 큐에 메시지를 bulk INSERT한다.
 * 모든 발송 경로(AI캠페인, 직접발송, 자동발송)가 이 함수를 사용한다.
 *
 * @param tables       회사 발송 테이블 목록 (라운드로빈 분배)
 * @param rows         발송 데이터 배열. 각 row:
 *                     [dest_no, call_back, msg_contents, msg_type, title_str,
 *                      sendTime, app_etc1, app_etc2, file_name1, file_name2, file_name3]
 * @param useNow       true면 sendTime 무시하고 NOW() 사용 (즉시발송)
 * @returns            성공 건수
 */
export async function bulkInsertSmsQueue(
  tables: string[],
  rows: any[][],
  useNow: boolean = false,
  ctx?: SpamBlockContext,
): Promise<number> {
  if (rows.length === 0) return 0;

  // ★ 2026-08-18 전송자격인증 5.2 — 금칙어 **탐지**(0819 탐지 전용 · 임계 경로 밖).
  //   발송이 실제로 시작되는 길목이 여기다(소비처 17곳이 전부 이 함수를 지난다).
  //   ⛔ 막지도 않고 기다리지도 않는다 — 여기는 차감이 끝난 자리라 막으면 환불 정합이 깨지고,
  //      기다리면 탐지 지연이 그대로 발송 지연이 된다.
  //   여기서는 **스냅샷만** 뜬다(동기·가볍다). 뒤에 오는 적재가 rows를 손대도 판정이 흔들리지 않게 하려면
  //   문안을 지금 떠 둬야 한다. 판정 자체는 적재가 성공한 뒤에 던진다(아래 dispatchSpamDetection).
  //   컨트롤타워 = utils/spam-block.ts
  const spamSnapshot = snapshotSendContents(rows);

  // ★ 2026-06-20: MMS/문자 라인 분리. 같은 라인에서 무거운 MMS가 문자를 막지 않도록
  //   회사 라인 안에서 MMS('M')와 문자('L'/'S')를 서로 겹치지 않는 라인으로 가른다.
  //   회사 라인 "안"에서만 분리하므로 메시지는 여전히 회사 라인 집합 안 → 집계·취소·정산 무영향.
  const hasMms = rows.some((r) => r[3] === 'M');
  const hasText = rows.some((r) => r[3] !== 'M');
  const { mmsLines, textLines } = splitLinesByMsgType(tables, hasMms, hasText);

  // 1단계: 테이블별 배치 분배 (라운드로빈 — msg_type별 풀에서)
  const tableBatches: Record<string, any[][]> = {};
  for (const t of tables) tableBatches[t] = [[]];

  for (const row of rows) {
    const table = getNextSmsTable(row[3] === 'M' ? mmsLines : textLines);
    const currentBatch = tableBatches[table];
    const lastBatch = currentBatch[currentBatch.length - 1];
    if (lastBatch.length >= BATCH_SIZES.smsSend) {
      currentBatch.push([]);
    }
    currentBatch[currentBatch.length - 1].push(row);
  }

  // 2단계: bulk INSERT 실행
  let sentCount = 0;
  for (const [table, batches] of Object.entries(tableBatches)) {
    for (const batch of batches) {
      if (batch.length === 0) continue;
      try {
        if (useNow) {
          // 즉시발송: row[5](sendTime) 제외, NOW() SQL 직접 사용
          const placeholders = batch.map(() => '(?, ?, ?, ?, ?, NOW(), 100, \'1\', ?, ?, ?, ?, ?)').join(', ');
          const flatValues = batch.map(row => [row[0], row[1], row[2], row[3], row[4], row[6], row[7], row[8], row[9], row[10]]).flat();
          await mysqlQuery(
            `INSERT INTO ${table} (dest_no, call_back, msg_contents, msg_type, title_str, sendreq_time, status_code, rsv1, app_etc1, app_etc2, file_name1, file_name2, file_name3) VALUES ${placeholders}`,
            flatValues
          );
        } else {
          // 예약/분할: sendTime(row[5]) 파라미터 그대로 사용
          const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?, 100, \'1\', ?, ?, ?, ?, ?)').join(', ');
          const flatValues = batch.flat();
          await mysqlQuery(
            `INSERT INTO ${table} (dest_no, call_back, msg_contents, msg_type, title_str, sendreq_time, status_code, rsv1, app_etc1, app_etc2, file_name1, file_name2, file_name3) VALUES ${placeholders}`,
            flatValues
          );
        }
        sentCount += batch.length;
      } catch (batchErr: any) {
        // ★2026-08-29 Codex 2R high — 오류 객체를 통째로 찍으면 mysql2가 보존한 `err.sql`(파라미터가
        //   포맷된 INSERT 전문)이 로그에 남는다. 본문에는 승인 링크 토큰처럼 **그 자체가 권한인 값**이
        //   실릴 수 있어, 로그 열람자가 그것을 재사용할 수 있다. 진단에 필요한 것만 남긴다.
        console.error(
          `[sms-queue] bulk INSERT 실패 (${table}, ${batch.length}건): ` +
          `code=${batchErr?.code || 'unknown'} errno=${batchErr?.errno ?? '-'} sqlState=${batchErr?.sqlState || '-'} ` +
          `msg=${String(batchErr?.message || '').replace(/\s+/g, ' ').slice(0, 200)}`
        );
        // 실패 batch는 미집계 → 호출부에서 환불 처리
      }
    }
  }

  // ★0819 Codex 2R — **적재가 성공한 뒤에만** 탐지를 던진다.
  //   앞에서 던지면 큐에 한 건도 못 들어간 배치가 탐지 이력에는 N건으로 남아, 심사 증거와 실제가 어긋난다.
  if (sentCount > 0) dispatchSpamDetection(spamSnapshot, tables, ctx);

  return sentCount;
}
