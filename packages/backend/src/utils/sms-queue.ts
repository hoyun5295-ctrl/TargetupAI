// utils/sms-queue.ts
// ★ 메시징 컨트롤타워 — MySQL 큐 조작의 유일한 진입점
// campaigns.ts, manage-scheduled.ts 등 모든 라우트는 이 모듈을 통해 MySQL 큐에 접근한다.
// 하드코딩 금지. 환경변수/설정파일 기반.

import { mysqlQuery } from '../config/database';
import { CACHE_TTL, BATCH_SIZES } from '../config/defaults';
import { isValidSmsTable } from './sms-table-validator';
import { query } from '../config/database';

// ===== 환경변수 기반 테이블 설정 =====
export const ALL_SMS_TABLES = (process.env.SMS_TABLES || 'SMSQ_SEND').split(',').map(t => t.trim());
for (const t of ALL_SMS_TABLES) {
  if (!isValidSmsTable(t)) {
    console.error(`[QTmsg] ⚠️ 잘못된 SMS 테이블명 감지: "${t}" — SQL Injection 위험. SMS_TABLES 환경변수를 확인하세요.`);
  }
}
const BULK_ONLY_TABLES = ALL_SMS_TABLES.filter(t => !['SMSQ_SEND_10', 'SMSQ_SEND_11'].includes(t));
let rrIndex = 0;
console.log(`[QTmsg] ALL_SMS_TABLES: ${ALL_SMS_TABLES.join(', ')} (${ALL_SMS_TABLES.length}개 Agent)`);
console.log(`[QTmsg] BULK_ONLY_TABLES: ${BULK_ONLY_TABLES.join(', ')} (테스트/인증 제외 ${BULK_ONLY_TABLES.length}개)`);

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
export function toQtmsgType(msgType: string): string {
  if (msgType === 'SMS') return 'S';
  if (msgType === 'LMS') return 'L';
  return 'M';
}

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
      WHERE u.id = $1 AND lg.is_active = true AND lg.group_type = 'bulk'
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
    WHERE c.id = $1 AND lg.is_active = true AND lg.group_type = 'bulk'
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
  const sql = suffix ? `SELECT * FROM (${unions}) AS _u ${suffix}` : unions;
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
  ids: (string | number)[]
): Promise<Map<string, Record<string, number>>> {
  const result = new Map<string, Record<string, number>>();
  if (tables.length === 0 || ids.length === 0) return result;

  const placeholders = ids.map(() => '?').join(',');
  const where = `${groupField} IN (${placeholders})`;

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
  userId?: string
): Promise<string[]> {
  const liveTables = await getCompanySmsTables(companyId, userId);
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

/** 회사 발송 테이블 + 로그 테이블 (결과 조회용) */
export async function getCompanySmsTablesWithLogs(companyId: string, userId?: string): Promise<string[]> {
  const liveTables = await getCompanySmsTables(companyId, userId);
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

// ===== 카카오 브랜드메시지 헬퍼 =====

/** 카카오 브랜드메시지 큐 INSERT */
export async function insertKakaoQueue(params: {
  bubbleType: string;
  senderKey: string;
  phone: string;
  targeting: string;
  message: string;
  isAd: boolean;
  reservedDate?: string;
  attachmentJson?: string;
  carouselJson?: string;
  header?: string;
  resendType?: string;
  resendFrom?: string;
  resendMessage?: string;
  resendTitle?: string;
  unsubscribePhone?: string;
  unsubscribeAuth?: string;
  requestUid?: string;
}): Promise<void> {
  const {
    bubbleType, senderKey, phone, targeting, message, isAd,
    reservedDate, attachmentJson, carouselJson, header,
    resendType = 'SM', resendFrom, resendMessage, resendTitle,
    unsubscribePhone, unsubscribeAuth, requestUid
  } = params;

  const reservedDateStr = reservedDate || toKoreaTimeStr(new Date());
  const messageReuse = resendMessage ? 'N' : 'Y';

  await mysqlQuery(
    `INSERT INTO IMC_BM_FREE_BIZ_MSG (
      CHAT_BUBBLE_TYPE, STATUS, AD_FLAG, RESERVED_DATE,
      SENDER_KEY, PHONE_NUMBER, TARGETING,
      HEADER, MESSAGE, ATTACHMENT_JSON, CAROUSEL_JSON,
      RESEND_MT_TYPE, RESEND_MT_FROM, RESEND_MT_TITLE,
      RESEND_MT_MESSAGE_REUSE, RESEND_MT_MESSAGE,
      UNSUBSCRIBE_PHONE_NUMBER, UNSUBSCRIBE_AUTH_NUMBER,
      REQUEST_UID
    ) VALUES (?, '1', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      bubbleType,
      isAd ? 'Y' : 'N',
      reservedDateStr,
      senderKey,
      phone,
      targeting,
      header || null,
      message,
      attachmentJson || null,
      carouselJson || null,
      resendType,
      resendFrom || null,
      resendTitle || null,
      messageReuse,
      resendMessage || null,
      unsubscribePhone || null,
      unsubscribeAuth || null,
      requestUid || null
    ]
  );
}

/**
 * CT-04: 기본형 브랜드메시지 발송 큐 INSERT (IMC_BM_BASIC_BIZ_MSG)
 * 템플릿 코드 + 변수 JSON 기반 발송
 */
export async function insertKakaoBasicQueue(params: {
  bubbleType: string;
  senderKey: string;
  phone: string;
  targeting: string;
  templateCode: string;
  isAd: boolean;
  reservedDate?: string;
  header?: string;
  message?: string;
  additionalContent?: string;
  attachmentJson?: string;
  carouselJson?: string;
  messageVariableJson?: string;
  buttonVariableJson?: string;
  couponVariableJson?: string;
  imageVariableJson?: string;
  videoVariableJson?: string;
  commerceVariableJson?: string;
  carouselVariableJson?: string;
  resendType?: string;
  resendFrom?: string;
  resendMessage?: string;
  resendTitle?: string;
  unsubscribePhone?: string;
  unsubscribeAuth?: string;
  requestUid?: string;
}): Promise<void> {
  const {
    bubbleType, senderKey, phone, targeting, templateCode, isAd,
    reservedDate, header, message, additionalContent,
    attachmentJson, carouselJson,
    messageVariableJson, buttonVariableJson, couponVariableJson,
    imageVariableJson, videoVariableJson, commerceVariableJson, carouselVariableJson,
    resendType = 'NO', resendFrom, resendMessage, resendTitle,
    unsubscribePhone, unsubscribeAuth, requestUid
  } = params;

  const reservedDateStr = reservedDate || toKoreaTimeStr(new Date());
  const messageReuse = resendMessage ? 'N' : 'Y';

  await mysqlQuery(
    `INSERT INTO IMC_BM_BASIC_BIZ_MSG (
      CHAT_BUBBLE_TYPE, STATUS, PRIORITY, AD_FLAG, RESERVED_DATE,
      SENDER_KEY, PHONE_NUMBER, TARGETING, TEMPLATE_CODE, PUSH_ALARM,
      HEADER, MESSAGE, ADDITIONAL_CONTENT,
      ATTACHMENT_JSON, CAROUSEL_JSON,
      MESSAGE_VARIABLE_JSON, BUTTON_VARIABLE_JSON, COUPON_VARIABLE_JSON,
      IMAGE_VARIABLE_JSON, VIDEO_VARIABLE_JSON, COMMERCE_VARIABLE_JSON, CAROUSEL_VARIABLE_JSON,
      RESEND_MT_TYPE, RESEND_MT_FROM, RESEND_MT_TITLE,
      RESEND_MT_MESSAGE_REUSE, RESEND_MT_MESSAGE,
      UNSUBSCRIBE_PHONE_NUMBER, UNSUBSCRIBE_AUTH_NUMBER,
      REQUEST_UID
    ) VALUES (?, '1', 'N', ?, ?, ?, ?, ?, ?, 'Y', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      bubbleType,
      isAd ? 'Y' : 'N',
      reservedDateStr,
      senderKey,
      phone,
      targeting,
      templateCode,
      header || null,
      message || null,
      additionalContent || null,
      attachmentJson || null,
      carouselJson || null,
      messageVariableJson || null,
      buttonVariableJson || null,
      couponVariableJson || null,
      imageVariableJson || null,
      videoVariableJson || null,
      commerceVariableJson || null,
      carouselVariableJson || null,
      resendType,
      resendFrom || null,
      resendTitle || null,
      messageReuse,
      resendMessage || null,
      unsubscribePhone || null,
      unsubscribeAuth || null,
      requestUid || null
    ]
  );
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
  }[]
): Promise<number> {
  if (rows.length === 0) return 0;

  const table = tables[0]; // 알림톡은 첫 번째 테이블 사용
  let inserted = 0;

  // 배치 단위 INSERT (5000건씩)
  const BATCH = 5000;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const values: string[] = [];
    const params: any[] = [];

    for (const r of batch) {
      const idx = params.length;
      values.push(`(?, ?, ?, 'K', ?, ?, ?, ?, ?, NOW(), NOW(), '1', ?, ?)`);
      params.push(
        r.phone,                       // dest_no
        r.callback,                    // call_back
        r.message,                     // msg_contents
        r.titleStr || null,            // title_str
        r.templateCode,                // k_template_code
        r.nextType || 'L',             // k_next_type
        r.nextContents || null,        // k_next_contents
        r.buttonJson || null,          // k_button_json
        r.etcJson || null,             // k_etc_json
        r.companyId || null,           // app_etc2 (companyId 추적용)
      );
    }

    await mysqlQuery(
      `INSERT INTO ${table} (
        dest_no, call_back, msg_contents, msg_type, title_str,
        k_template_code, k_next_type, k_next_contents, k_button_json,
        sendreq_time, msg_instm, rsv1, k_etc_json, app_etc2
      ) VALUES ${values.join(',')}`,
      params
    );
    inserted += batch.length;
  }

  return inserted;
}

/** 카카오 발송 결과 집계 */
export async function kakaoAgg(whereClause: string, params: any[]): Promise<{ total: number; success: number; fail: number; pending: number }> {
  const rows = await mysqlQuery(
    `SELECT
       COUNT(*) as total,
       COUNT(CASE WHEN REPORT_CODE = '0000' THEN 1 END) as success,
       COUNT(CASE WHEN REPORT_CODE IS NOT NULL AND REPORT_CODE != '0000' THEN 1 END) as fail,
       COUNT(CASE WHEN REPORT_CODE IS NULL AND STATUS = '1' THEN 1 END) as pending
     FROM IMC_BM_FREE_BIZ_MSG WHERE ${whereClause}`,
    params
  ) as any[];
  return {
    total: Number(rows[0]?.total || 0),
    success: Number(rows[0]?.success || 0),
    fail: Number(rows[0]?.fail || 0),
    pending: Number(rows[0]?.pending || 0)
  };
}

/** 카카오 예약 대기 건수 */
export async function kakaoCountPending(requestUid: string): Promise<number> {
  const rows = await mysqlQuery(
    `SELECT COUNT(*) as cnt FROM IMC_BM_FREE_BIZ_MSG WHERE REQUEST_UID = ? AND STATUS = '1'`,
    [requestUid]
  ) as any[];
  return Number(rows[0]?.cnt || 0);
}

/** 카카오 예약 취소 (대기 건 삭제) */
export async function kakaoCancelPending(requestUid: string): Promise<number> {
  const rows = await mysqlQuery(
    `DELETE FROM IMC_BM_FREE_BIZ_MSG WHERE REQUEST_UID = ? AND STATUS = '1'`,
    [requestUid]
  ) as any[];
  return (rows as any).affectedRows || 0;
}

// ===== ★ 카카오 범용 조회 헬퍼 (단일 테이블 IMC_BM_FREE_BIZ_MSG) =====
// admin.ts, results.ts, billing.ts 등에서 인라인으로 중복 쿼리하던 패턴 통합.

/** 카카오 COUNT — whereClause는 "WHERE" 접두사 선택적 */
export async function kakaoCountWhere(whereClause: string, params: any[]): Promise<number> {
  const w = whereClause.replace(/^\s*WHERE\s+/i, '');
  const rows = await mysqlQuery(
    `SELECT COUNT(*) AS cnt FROM IMC_BM_FREE_BIZ_MSG WHERE ${w}`,
    params
  ) as any[];
  return Number(rows[0]?.cnt || 0);
}

/** 카카오 SELECT — suffix에 ORDER BY/LIMIT/GROUP BY 지정 가능 */
export async function kakaoSelectWhere(
  fields: string,
  whereClause: string,
  params: any[],
  suffix?: string
): Promise<any[]> {
  const w = whereClause.replace(/^\s*WHERE\s+/i, '');
  return await mysqlQuery(
    `SELECT ${fields} FROM IMC_BM_FREE_BIZ_MSG WHERE ${w} ${suffix || ''}`,
    params
  ) as any[];
}

/**
 * ★ 카카오 다중 REQUEST_UID 배치 집계 — GROUP BY 단일 쿼리
 * sync-results 등에서 여러 캠페인 한 번에 집계.
 */
export async function kakaoBatchAggByGroup(
  ids: string[]
): Promise<Map<string, { total: number; success: number; fail: number; pending: number }>> {
  const result = new Map();
  if (ids.length === 0) return result;
  try {
    const placeholders = ids.map(() => '?').join(',');
    const rows = await mysqlQuery(
      `SELECT REQUEST_UID as _grp,
         COUNT(*) as total,
         COUNT(CASE WHEN REPORT_CODE = '0000' THEN 1 END) as success,
         COUNT(CASE WHEN REPORT_CODE IS NOT NULL AND REPORT_CODE != '0000' THEN 1 END) as fail,
         COUNT(CASE WHEN REPORT_CODE IS NULL AND STATUS = '1' THEN 1 END) as pending
       FROM IMC_BM_FREE_BIZ_MSG
       WHERE REQUEST_UID IN (${placeholders})
       GROUP BY REQUEST_UID`,
      ids
    ) as any[];
    for (const r of rows) {
      result.set(String(r._grp), {
        total: Number(r.total || 0),
        success: Number(r.success || 0),
        fail: Number(r.fail || 0),
        pending: Number(r.pending || 0),
      });
    }
  } catch (err: any) {
    // IMC_BM_FREE_BIZ_MSG 테이블 미존재 환경 대응
    if (!err.message?.includes("doesn't exist")) throw err;
  }
  return result;
}

/** 카카오 GROUP BY — 오류사유별/상태별 집계 */
export async function kakaoGroupBy(
  rawField: string,
  whereClause: string,
  params: any[]
): Promise<Record<string, number>> {
  const w = whereClause.replace(/^\s*WHERE\s+/i, '');
  const rows = await mysqlQuery(
    `SELECT ${rawField} AS _grp, COUNT(*) AS cnt
     FROM IMC_BM_FREE_BIZ_MSG WHERE ${w}
     GROUP BY _grp`,
    params
  ) as any[];
  const result: Record<string, number> = {};
  for (const r of rows) result[String(r._grp ?? '')] = Number(r.cnt || 0);
  return result;
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
): Promise<number> {
  if (rows.length === 0) return 0;

  // 1단계: 테이블별 배치 분배 (라운드로빈)
  const tableBatches: Record<string, any[][]> = {};
  for (const t of tables) tableBatches[t] = [[]];

  for (const row of rows) {
    const table = getNextSmsTable(tables);
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
      } catch (batchErr) {
        console.error(`[sms-queue] bulk INSERT 실패 (${table}, ${batch.length}건):`, batchErr);
        // 실패 batch는 미집계 → 호출부에서 환불 처리
      }
    }
  }

  return sentCount;
}
