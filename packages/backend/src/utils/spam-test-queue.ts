/**
 * CT-09: 스팸 테스트 큐 컨트롤타워
 *
 * 역할: 스팸필터 테스트 큐 등록 + 순차 실행의 유일한 진입점
 * 원칙: 테스트폰에 동시에 1건만 발송 → 매칭 정확도 100% 보장
 *
 * 사용처:
 *   - routes/spam-filter.ts (수동 테스트)
 *   - routes/ai.ts (AI 자동 테스트 + 재생성)
 *   - app.ts (큐 워커 시작)
 *
 * D78: 프로 요금제 자동 스팸검사 기능
 */

import { createHash } from 'crypto';
import pool, { mysqlQuery, query } from '../config/database';
import { TIMEOUTS } from '../config/defaults';
import { extractVarCatalog } from '../services/ai';
import { replaceVariables, enrichWithCustomFields, buildAdMessage, buildAdSubject, prepareFieldMappings } from '../utils/messageUtils';
import { getTestSmsTables, toQtmsgType, insertTestSmsQueue } from './sms-queue';
import { unsupportedSmsCharCodes } from './sms-charset';
import { SUCCESS_CODES, PENDING_CODES, SPAM_RESULT, SPAM_RESULT_DECIDE_SQL, spamFailedResultSql } from '../utils/sms-result-map';
import { prepaidDeduct, prepaidRefund, REFUND_KEYS } from '../utils/prepaid';
import { sendSystemAlert } from './system-alert';
import { getSampleCustomerScope } from './store-scope';
// ★ 2026-09-26 한줄로 V2 F49 — 무료 자동 검사 표시값·자동 판정(청구 제외 판정 CT와 한 벌)
import { SPAM_AUTO_FREE_SOURCE, isAutoSpamSource } from './spam-trial';

// ============================================================
// 상수
// ============================================================
const QUEUE_POLL_INTERVAL_MS = 3000; // 큐 워커 체크 주기 (3초)
const MANUAL_GRACE_MS = 20000;       // 수동 테스트: QTmsg 성공 후 앱 리포트 대기 (20초, KT 12~15초 소요 대응)
const AUTO_GRACE_MS = 25000;         // 자동 테스트: QTmsg 성공 후 앱 리포트 대기 (25초, 오탐 방지)
const RESULT_POLL_INTERVAL_MS = 5000; // 결과 폴링 주기 (5초)

/**
 * ★ 2026-10-02 「통신사 전송 성공 + 앱 보고 없음」을 차단으로 확정하는 **가장 이른 때** — 검사를 시작한 뒤 45초.
 *
 * 종전: 통신사 성공을 본 뒤 유예(수동 10초 · 큐 20~25초)만 지나면 확정 → 검사 시작 뒤 30초쯤에 「막혔어요」가 떴다.
 *   시험 폰은 문자를 받고도 보고가 늦을 수 있다(1002 실측: 받은 뒤 32.9초에 닿은 보고 · 통신이 멎은 폰). 사람들은 화면을 한 번 보고
 *   닫으므로 처음 뜨는 판정이 맞아야 한다 → 확정을 늦춰 그 사이에 닿는 보고를 처음부터 「통과」로 보이게 한다.
 * 왜 60초(검사 제한 시간)가 아니고 45초인가: 검사 화면은 시작 뒤 60초에 결과 읽기를 멈추고, 수동 검사는 15초마다 확인한다(15·30·45·60).
 *   60초 확인에서 확정하면 화면이 그것을 못 보고 진짜 차단을 「결과 없음」으로 보여 준다. 화면에 보이는 마지막 확인이 45초다.
 * 이보다 늦게 닿은 보고는 닫힌 검사의 행을 고친다(resolveSpamReportTest · 10분 안).
 */
export const SPAM_BLOCK_DECIDE_AFTER_MS = 45_000;

/**
 * 「통신사 전송 성공 + 앱 보고 없음」을 지금 차단으로 확정해도 되는가 — 수동 검사 라우트와 큐 워커가 쓰는 유일한 판정.
 * 둘 다 채워야 한다: ① 통신사 성공을 처음 본 뒤 유예([graceMs])가 지났다 ② 검사를 시작한 뒤 [SPAM_BLOCK_DECIDE_AFTER_MS] 가 지났다.
 * [successSeenAtMs] = 통신사 성공을 처음 본 때(아직 못 봤으면 undefined) · [startedAtMs] = 검사를 시작한 때.
 */
export function spamBlockedDue(o: { nowMs: number; startedAtMs: number; successSeenAtMs: number | undefined; graceMs: number }): boolean {
  if (o.successSeenAtMs === undefined) return false;
  return o.nowMs - o.successSeenAtMs >= o.graceMs && o.nowMs - o.startedAtMs >= SPAM_BLOCK_DECIDE_AFTER_MS;
}
const MAX_REGENERATE_RETRIES = 2;    // 스팸 차단 시 최대 재생성 횟수

// ============================================================
// 인터페이스
// ============================================================
export interface SpamTestEnqueueParams {
  companyId: string;
  userId: string;
  callbackNumber: string;
  messageContentSms?: string;
  messageContentLms?: string;
  messageType: 'SMS' | 'LMS' | 'MMS';
  subject?: string;
  firstRecipient?: Record<string, any>;
  source: 'manual' | 'auto_ai';   // 적재 표시값은 enqueueSpamTest가 정한다(차감 건너뛴 자동 = SPAM_AUTO_FREE_SOURCE)
  variantId?: string;
  batchId?: string;
  skipPrepaid?: boolean;
}

export interface SpamTestEnqueueResult {
  ok: boolean;
  testId?: string;
  error?: string;
  errorCode?: string;
  insufficientBalance?: boolean;
  balance?: number;
  requiredAmount?: number;
}

export interface SpamTestBatchResult {
  batchId: string;
  completed: boolean;
  variants: Array<{
    variantId: string;
    testId: string;
    status: string;
    overallResult: 'pass' | 'blocked' | 'failed' | 'timeout' | 'pending';
    carrierResults: Array<{
      carrier: string;
      messageType: string;
      result: string | null;
    }>;
  }>;
}

export interface AutoSpamTestVariant {
  variantId: string;
  messageText: string;
  subject?: string;
}

export interface AutoSpamTestResult {
  batchId: string;
  variants: Array<{
    variantId: string;
    messageText: string;
    subject?: string;
    spamResult: 'pass' | 'blocked' | 'failed' | 'timeout';
    carrierResults: Array<{
      carrier: string;
      messageType: string;
      result: string;
    }>;
    regenerated: boolean;
    regenerateCount: number;
  }>;
  /** ★ 2026-10-03 stopOnFirstPass 모드에서 통과한 안(없으면 null · 기본 모드는 넣지 않는다) */
  passedVariantId?: string | null;
  totalTestCount: number;
  totalRegenerateCount: number;
}

// ============================================================
// 헬퍼: 메시지 해시
// ============================================================
export function normalizeContent(s: string): string {
  return (s || '').replace(/[\s\r\n]+/g, '');
}

export function computeMessageHash(content: string): string {
  const normalized = normalizeContent(content);
  if (!normalized) return '';
  return createHash('sha256').update(normalized, 'utf8').digest('hex').substring(0, 16);
}

// ============================================================
// 앱 수신 보고 — 어느 검사의 것인가 (★2026-10-02)
//
// 실측(1002): 시험 폰이 문자를 받고도 보고를 못 내보내(앱 1.1 은 9초 안에 못 보내면 버렸다) 서버가 "통신사 전송 성공 + 앱 보고 없음"을
//   '차단'으로 판정했다 — SKT 12:46 폰 로그(`리포트 최종 실패`) · nginx 에 그 폰의 요청 없음 · 문자는 수신함에 있었다.
// 앱 1.2 는 서버가 답할 때까지 다시 보낸다(최대 10분). 그래서 판정이 난 뒤에 도착하는 보고가 생긴다.
//
// ⛔ 닫힌 검사는 **문안이 같을 때만** 늦은 보고로 고친다. 문안을 보지 않으면 같은 발신번호의 다른 문자(두 번 오는 수신 알림의
//    두 번째 보고 포함)가 진짜 차단을 통과로 덮는다.
// ⛔ 문자를 받은 뒤에 만들어진 검사는 그 문자의 검사가 아니다. 이 조건이 없으면 늦은 보고(와 그 재전송)가 뒤에 만든 검사를 통과로 만든다.
//    "문자를 받은 때"는 **폰 시계의 시각으로 받지 않는다.** 폰이 「받은 뒤 이 보고를 보내기까지 지난 시간」을 재서 싣고,
//    서버가 **요청이 도착한 시각**에서 그만큼 뺀다(spamReportReceivedAt). 폰 시계가 서버와 달라도 값이 같고,
//    보고가 서버에 닿는 데 걸린 시간만큼만 **늦은 쪽으로** 어긋난다 → 그 문자의 진짜 검사를 후보에서 빼는 일이 없다.
//    (폰 시각을 그대로 견주던 1002 초안은 폰 시계가 1분 느리면 제때 온 보고를 버렸다 — Codex 1R)
//    도착 시각은 라우트의 첫 줄에서 한 번 잡는다. 판정 문장을 돌리는 때의 시각으로 계산하면 그 앞의 대기(단말 갱신 · DB 연결)만큼
//    받은 때가 더 늦게 잡혀 뒤에 만든 검사가 후보에 든다(Codex 2R).
// ⛔ 그 문자의 검사가 어느 것인가를 **먼저** 정하고, 고칠 수 있는 때(닫힌 지 10분 안)인가는 그 뒤에 본다.
//    지난 검사를 후보에서 미리 빼면 같은 보고의 재전송이 더 오래된 다른 검사로 넘어간다(Codex 2R).
// ============================================================

/** 닫힌 검사에 늦은 보고를 받아 주는 시간(분) — 앱 대기열의 보관 시간(10분)과 같다 */
export const SPAM_LATE_REPORT_MINUTES = 10;

/**
 * 통신사가 받는 사람 화면 맨 앞에 붙이는 발신 구분 머리말을 뗀다(`[Web발신]` 등 — 보낸 문안에는 없다).
 * 종전에는 이것을 떼지 않고 해시를 견줘, 실제 보고는 문안 대조가 늘 실패했다(1002 KT·SKT 폰 로그의 보고 본문 실측).
 * 맨 앞의 것만 뗀다 — 본문 중간의 같은 글자는 고객 문안이다.
 */
export function stripCarrierOriginTag(content: string): string {
  return String(content ?? '').replace(/^\s*\[(?:Web|국제|국외)발신\]\s*/, '');
}

/** 폰이 보고한 문안의 해시 — 검사 행의 message_hash(보낸 문안)와 견준다 */
export function spamReportHash(content: string): string {
  return computeMessageHash(stripCarrierOriginTag(content));
}

/** 앱이 싣는 「받은 뒤 지난 시간」의 상한 — 앱은 10분이 지난 보고를 버린다. 이보다 큰 값은 잘못된 값이다 */
const REPORT_AGE_MAX_MS = 60 * 60_000;

/**
 * 앱(1.2+)이 실어 보내는 「문자를 받은 뒤 이 보고를 보내기까지 지난 시간」(ms · 폰이 자기 시계 하나로 잰 차이).
 * 1.1 은 보내지 않는다 → null. 숫자가 아니거나 한 시간을 넘는 값도 null(= 받은 때를 모르는 보고로 다룬다).
 */
export function parseReportAgeMs(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null;
  const s = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
  if (!/^\d{1,9}$/.test(s)) return null;
  const n = Number(s);
  return n <= REPORT_AGE_MAX_MS ? n : null;
}

/**
 * 문안으로 고르는 문장 — 같은 발신번호 · **같은 문안** · 이 단말(번호 + 통신사 + 유형)의 결과 행이 있는 검사 중,
 * **문자를 받기 전에 만들어진** 것(진행 중 · 닫힌 것)에서 하나. 이것이 "그 문자의 검사"다.
 * $1 발신번호(숫자만) · $2 문안 해시 · $3 단말 번호 · $4 통신사 · $5 유형 · $6 받은 때(서버 시계 ms · 1.1 = NULL)
 *
 * - 받은 때($6)는 라우트가 요청 도착 시각에서 앱이 잰 지난 시간을 뺀 값이다(spamReportReceivedAt). 이 문장을 언제 돌리든 같다.
 *   만든 때(created_at)는 DB 시계 · 받은 때는 백엔드 시계다 — 둘은 같은 서버에 있다(같은 시계).
 * - $6 이 없는 보고(1.1)는 받은 때를 모른다 → 종전처럼 진행 중인 검사만 본다(닫힌 검사를 고치지 않는다).
 * - correctable = 고칠 수 있는 때인가(진행 중 · 닫힌 지 10분 안). **후보를 거르는 조건이 아니다** — 고른 검사가 지났으면
 *   그 보고는 무시한다. 후보에서 미리 빼면 같은 보고의 재전송이 더 오래된 다른 검사로 넘어간다.
 * - 고르는 순서: ① 진행 중이고 이 단말의 보고를 아직 기다리는 검사(종전 규칙과 같다 — 같은 문안의 검사가 겹쳐 돌 때 두 문자가
 *   두 검사에 하나씩 간다. 겹침은 등록 화면이 막지만 동시 등록·자동 검사와는 겹칠 수 있다) → ② 그 밖에는 가장 최근에 만든 것.
 * ⛔ **닫힌 검사**는 그 행이 고칠 수 있는 상태인가(수신 표시 없음 · 발송 실패 아님)로 고르지 않는다 — 라우트의 갱신 문장이 본다.
 *    "고칠 수 있는 행이 남은 닫힌 검사"로 고르면, 같은 보고가 두 번 올 때(앱의 재전송) 두 번째가 같은 문안의 **더 오래된 닫힌 검사**로
 *    넘어가 진짜 차단을 통과로 고친다(1002 PostgreSQL 실측에서 확인).
 *    같은 보고는 몇 번을 다시 보내도 받은 때가 같으므로 같은 검사가 골라지고, 두 번째부터는 갱신이 0행으로 끝난다.
 */
export const SPAM_REPORT_TEXT_MATCH_SQL = `
  SELECT t.id, t.status,
         (t.status = 'active' OR t.completed_at >= NOW() - INTERVAL '${SPAM_LATE_REPORT_MINUTES} minutes') AS correctable
    FROM spam_filter_tests t
   WHERE REPLACE(t.callback_number, '-', '') = $1
     AND t.message_hash = $2
     AND (t.status = 'active' OR ($6::double precision IS NOT NULL AND t.status = 'completed'))
     AND ($6::double precision IS NULL OR t.created_at <= to_timestamp($6::double precision / 1000.0))
     AND EXISTS (
       SELECT 1 FROM spam_filter_test_results tr
        WHERE tr.test_id = t.id
          AND tr.phone = $3 AND tr.carrier = $4 AND tr.message_type = $5)
   ORDER BY (t.status = 'active' AND EXISTS (
              SELECT 1 FROM spam_filter_test_results w
               WHERE w.test_id = t.id
                 AND w.phone = $3 AND w.carrier = $4 AND w.message_type = $5
                 AND w.received = false AND w.result IS NULL)) DESC,
            t.created_at DESC
   LIMIT 1`;

/**
 * 문안으로 못 고른 보고의 후보(종전 규칙용) — 같은 발신번호의 진행 중인 검사 중 문자를 받기 전에 만들어진 것.
 * $1 발신번호(숫자만) · $2 받은 때(서버 시계 ms · 1.1 = NULL → 전부)
 */
export const SPAM_REPORT_ACTIVE_SQL = `
  SELECT id FROM spam_filter_tests
   WHERE status = 'active'
     AND REPLACE(callback_number, '-', '') = $1
     AND ($2::double precision IS NULL OR created_at <= to_timestamp($2::double precision / 1000.0))
   ORDER BY created_at DESC`;

/**
 * 문자를 받은 때(서버 시계 ms) = 요청이 서버에 도착한 시각 − 앱이 잰 「받은 뒤 지난 시간」. 지난 시간을 모르면(1.1) null.
 * [arrivedAtMs] 는 라우트가 **첫 줄에서** 잡은 값이어야 한다 — 그 뒤의 대기는 받은 때에 들어가지 않는다.
 */
export function spamReportReceivedAt(arrivedAtMs: number, ageMs: number | null): number | null {
  return ageMs === null ? null : arrivedAtMs - ageMs;
}

export interface SpamReportTarget {
  testId: string;
  /** 이미 닫힌 검사에 반영하는 늦은 보고인가 */
  late: boolean;
  /** 고른 근거: hash = 문안 일치 · single = 진행 중인 검사가 하나 · device = 이 단말에 보고가 없는 가장 최근 검사 */
  via: 'hash' | 'single' | 'device';
}

/**
 * 앱 수신 보고가 어느 검사의 것인지 고른다(라우트 `POST /api/spam-filter/report` 가 쓰는 유일한 판정).
 * 순서: ① 문안이 같은 검사 중 문자를 받기 전에 만들어진 것(SPAM_REPORT_TEXT_MATCH_SQL) — 그것이 그 문자의 검사다.
 *          진행 중이거나 닫힌 지 10분 안이면 그 검사, 그보다 지났으면 무시(null).
 *       → ② 문안이 같은 검사가 없으면 종전 규칙(진행 중인 검사가 하나면 그것 · 여럿이면 이 단말에 아직 보고가 없는 가장 최근 검사).
 * 없으면 null(무시).
 * ①에서 고른 검사가 지났거나, 그 행이 이미 수신 처리됐거나 발송 실패면 거기서 끝난다(다른 검사로 넘어가지 않는다).
 *
 * [가를 수 없는 경우 — 규칙으로 정해 둔다] 발신번호와 문안이 같은 문자는 서로 구별할 표지가 없다.
 *   - 같은 문안으로 연달아 검사했고 앞 검사의 문자가 뒤 검사를 만든 뒤에야 도착했다면 그 보고는 뒤 검사로 간다.
 *   - 받은 때는 보고가 서버에 닿는 데 걸린 시간(앱이 보낸 때 ~ 라우트가 시작된 때 · 앱의 한 번 시도 제한 4초 안)만큼 늦게 잡힌다.
 *     문자를 받은 뒤 그 시간 안에 같은 문안으로 만든 검사는 "받기 전에 만든 검사"로 보인다.
 */
export async function resolveSpamReportTest(o: {
  senderClean: string;
  devicePhone: string;
  carrier: string;
  messageType: 'SMS' | 'LMS';
  messageContent: string;
  /** 문자를 받은 때(서버 시계 ms · spamReportReceivedAt). 1.1 앱 = null */
  receivedAtMs: number | null;
}): Promise<SpamReportTarget | null> {
  const reportHash = spamReportHash(o.messageContent);
  if (reportHash) {
    const sameText = await query(SPAM_REPORT_TEXT_MATCH_SQL, [
      o.senderClean, reportHash, o.devicePhone, o.carrier, o.messageType, o.receivedAtMs,
    ]);
    if (sameText.rows.length > 0) {
      const own = sameText.rows[0];
      // 그 문자의 검사는 이것이다. 고칠 수 있는 때가 지났으면 무시한다 — 다른 검사로 넘어가지 않는다
      if (own.correctable !== true) return null;
      return { testId: String(own.id), late: own.status !== 'active', via: 'hash' };
    }
  }

  const eligible = (await query(SPAM_REPORT_ACTIVE_SQL, [o.senderClean, o.receivedAtMs])).rows as any[];
  if (eligible.length === 0) return null;
  if (eligible.length === 1) return { testId: String(eligible[0].id), late: false, via: 'single' };

  const candidateIds = eligible.map((r) => r.id);
  const deviceMatch = await query(
    `SELECT tr.test_id FROM spam_filter_test_results tr
     JOIN spam_filter_tests t ON t.id = tr.test_id
     WHERE tr.test_id = ANY($1::uuid[])
       AND tr.phone = $2 AND tr.carrier = $3
       AND tr.received = false AND tr.result IS NULL
     ORDER BY t.created_at DESC`,
    [candidateIds, o.devicePhone, o.carrier]
  );
  if (deviceMatch.rows.length === 0) return null;
  return { testId: String(deviceMatch.rows[0].test_id), late: false, via: 'device' };
}

// ★ D103: 인라인 getTestSmsTable/insertSmsQueue 삭제 → sms-queue.ts CT-04 컨트롤타워(getTestSmsTables, insertTestSmsQueue) 사용

// ============================================================
// [1] 큐에 스팸 테스트 등록
// ============================================================
export async function enqueueSpamTest(params: SpamTestEnqueueParams): Promise<SpamTestEnqueueResult> {
  const {
    companyId, userId, callbackNumber,
    messageContentSms, messageContentLms, messageType, subject,
    firstRecipient: clientFirstRecipient,
    source = 'manual', variantId, batchId, skipPrepaid = false,
  } = params;

  try {
    // 1) 메시지 해시 계산 (변수 치환 후)
    const isLmsType = messageType === 'LMS' || messageType === 'MMS';
    const rawContent = isLmsType ? (messageContentLms || '') : (messageContentSms || '');

    // ★ D102: prepareFieldMappings 컨트롤타워로 통합
    const fieldMappings = await prepareFieldMappings(companyId);

    let firstCustomer: Record<string, any>;
    if (clientFirstRecipient && typeof clientFirstRecipient === 'object' && Object.keys(clientFirstRecipient).length > 0) {
      firstCustomer = clientFirstRecipient;
    } else {
      const mappingCols = Object.values(fieldMappings).filter((m: any) => m.storageType !== 'custom_fields').map((m: any) => m.column);
      const selectCols = [...new Set(['phone', 'custom_fields', ...mappingCols])].join(', ');
      // ★ 미리보기와 동일한 정렬 (name ASC) — recommend-target의 샘플 고객과 일치 보장
      // ★ 2026-09-22 브랜드 격리: 테스트 주체가 분류코드 사용자면 자기 코드 고객에서만(CT-02 경유 · 빈 조각이면 종전 SQL 그대로)
      const sampleScope = await getSampleCustomerScope(companyId, userId, { paramIndex: 2 });
      const firstResult = await query(
        `SELECT ${selectCols} FROM customers WHERE company_id = $1 AND is_active = true AND sms_opt_in = true${sampleScope.where} ORDER BY name ASC NULLS LAST LIMIT 1`,
        [companyId, ...sampleScope.params]
      );
      firstCustomer = firstResult.rows[0] || {};
    }

    // ★ D92: %회신번호% 치환 — callbackNumber를 addressBookFields로 전달하여 스팸테스트에서도 맵핑
    const spamAddressBookFields = callbackNumber ? { callback: callbackNumber, extra1: '', extra2: '', extra3: '', name: '' } : undefined;
    const personalizedForHash = replaceVariables(rawContent, firstCustomer, fieldMappings, spamAddressBookFields);
    const messageHash = computeMessageHash(personalizedForHash);

    // 2) 디바이스 조회 + 발송 건수 계산
    const devices = await query(
      `SELECT id, carrier, phone FROM spam_filter_devices WHERE is_active = true ORDER BY carrier`
    );
    if (devices.rows.length === 0) {
      return { ok: false, error: '지금은 스팸 검사를 할 수 없습니다. 관리자에게 문의하세요.' };
    }

    const messageTypes: string[] = [];
    if (isLmsType) {
      if (messageContentLms) messageTypes.push('LMS');
    } else {
      if (messageContentSms) messageTypes.push('SMS');
    }
    const sendCount = devices.rows.length * messageTypes.length;
    const deductType = messageTypes[0] || 'SMS';

    // ★ 2026-09-29 한줄로 V2 차수 5(B-0928-1 범위 밖 ③) — 실제로 나갈 본문·제목(워커 executeSpamTest 와 같은 치환 · 제목 = 저장값)을
    //   검사 행·차감 전에 글자 판정한다(수동 입구와 같은 CT). 옛: 판정 0 → 게이트웨이 9401 반려로 3사 모두 실패 · 유료 검사면 차감 뒤 환불.
    const outgoingTexts = messageTypes.flatMap((t) => [
      replaceVariables((t === 'SMS' ? messageContentSms : messageContentLms) || '', firstCustomer, fieldMappings, spamAddressBookFields),
      t === 'LMS' || t === 'MMS' ? (subject || '') : '',
    ]);
    const unsupportedChars = unsupportedSmsCharCodes(...outgoingTexts);
    if (unsupportedChars.length > 0) {
      return {
        ok: false,
        error: '문자로 보낼 수 없는 글자(보이지 않는 글자 포함)가 있어 검사하지 않았어요.',
        errorCode: 'SMS_UNSUPPORTED_CHARS',
      };
    }

    // 2-1) 고객사 080 수신거부번호 조회 (users 우선 → companies fallback)
    const opt080Result = await query(
      `SELECT u.opt_out_080_number AS user_080, c.opt_out_080_number AS company_080
       FROM users u JOIN companies c ON u.company_id = c.id
       WHERE u.id = $1`,
      [userId]
    );
    const spamCheckNumber = opt080Result.rows[0]?.user_080 || opt080Result.rows[0]?.company_080 || null;

    // 3) 테스트 레코드 + 결과 행 + 차감 — ★ 2026-09-26 한줄로 V2 m001·m002(SQ).
    //   옛 순서: 검사 행을 'queued'로 **먼저 커밋** → 차감 → 결과 행. 3초 워커가 그 사이 행을 집어 차감 전에 보낼 수 있었고
    //   (잔액 부족이면 무료 발송 · 결과 행이 없으면 앱 보고 유실), 차감 뒤 결과 행이 던지면 환불 없이 queued가 남아 나중에 일부 행으로 나갔다.
    //   새 순서: 한 트랜잭션에 검사 행·결과 행 → 차감(**같은 트랜잭션** · Codex 2R ①) → 커밋. 워커는 커밋 전 행을 못 본다.
    //   셋이 한 커밋이라 어디서 멈춰도 "차감만 남은 검사"·"차감 없는 검사"가 생기지 않는다. 커밋 실패에 환불하지 않는다 —
    //   커밋이 안 됐으면 차감도 함께 사라졌고, 응답만 유실됐으면 검사는 나가므로 환불하면 공짜 발송이 된다.
    //   회사 행을 맨 먼저 잠근다: 검사 행 INSERT의 회사 FK가 KEY SHARE를 잡은 뒤 차감이 FOR UPDATE로 올리면
    //   같은 회사의 동시 등록 둘이 서로의 KEY SHARE를 기다린다(교착). 먼저 잠그면 뒤 등록은 앞 등록의 커밋을 기다린다.
    // ★ 2026-09-26 한줄로 V2 F49 — 차감을 건너뛴 자동 검사는 청구 제외 표시값으로 남긴다(후불 정산·비용 표시가 이 값으로 뺀다).
    const storedSource = source === 'auto_ai' && skipPrepaid ? SPAM_AUTO_FREE_SOURCE : source;
    const client = await pool.connect();
    let testId = '';
    try {
      await client.query('BEGIN');
      if (!skipPrepaid) await client.query('SELECT id FROM companies WHERE id = $1 FOR UPDATE', [companyId]);
      const testResult = await client.query(
        `INSERT INTO spam_filter_tests
         (company_id, user_id, callback_number, message_content_sms, message_content_lms,
          message_hash, spam_check_number, status, source, variant_id, batch_id, subject, first_recipient)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued', $8, $9, $10, $11, $12)
         RETURNING id, created_at`,
        [companyId, userId, callbackNumber,
         messageContentSms || null, messageContentLms || null,
         messageHash || null, spamCheckNumber,
         storedSource, variantId || null, batchId || null, subject || null,
         firstCustomer && Object.keys(firstCustomer).length > 0 ? JSON.stringify(firstCustomer) : null]
      );
      testId = testResult.rows[0].id;

      // 결과 행 — 커밋 전이라 워커가 이 검사를 집을 때는 늘 전부 있다
      for (const device of devices.rows) {
        for (const msgType of messageTypes) {
          await client.query(
            `INSERT INTO spam_filter_test_results (test_id, carrier, message_type, phone)
             VALUES ($1, $2, $3, $4)`,
            [testId, device.carrier, msgType, device.phone]
          );
        }
      }

      // 4) 선불 차감 (skipPrepaid가 아닐 때만) — 실패하면 검사 행째 롤백(남기지 않는다 · 워커가 볼 행이 없다)
      if (!skipPrepaid) {
        const deduct = await prepaidDeduct(companyId, sendCount, deductType, testId, userId, 'spam', null, { client });
        if (!deduct.ok) {
          await client.query('ROLLBACK');
          return {
            ok: false,
            error: deduct.error,
            errorCode: 'INSUFFICIENT_BALANCE',
            insufficientBalance: true,
            balance: deduct.balance,
            requiredAmount: deduct.amount,
          };
        }
      }

      await client.query('COMMIT');
    } catch (txErr: any) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw txErr;
    } finally {
      client.release();
    }

    console.log(`[SpamTestQueue] 큐 등록 — testId=${testId}, source=${source}, variant=${variantId || '-'}, batch=${batchId || '-'}`);

    return { ok: true, testId };
  } catch (err: any) {
    const msg = err?.message || '';
    // ★ db_alter_safety_net: first_recipient 컬럼 미생성(ALTER 누락) 시 500 대신 친화 안내.
    if (msg.includes('column') && msg.includes('does not exist')) {
      console.log('[SpamTestQueue] DB 마이그레이션 필요 — spam_filter_tests.first_recipient ALTER 요청:', msg);
      return { ok: false, error: 'DB 마이그레이션 필요: 운영자에게 spam_filter_tests 컬럼 추가를 요청하세요', errorCode: 'DB_MIGRATION_PENDING' };
    }
    console.log('[SpamTestQueue] 큐 등록 오류(상세):', err?.message || err);
    return { ok: false, error: `스팸 테스트 큐 등록 오류: ${err?.message || '알 수 없는 오류'}` };
  }
}

/**
 * ★ 2026-09-26 한줄로 V2 m042(Harold 결정 「발송 실패만 환불·청구 제외 · 시간 초과는 청구」) — 스팸 검사 발송 실패분 선불 환불.
 * 통신사가 실패로 확정한 결과 행(failed) 수를 유형별로 세어 FAIL 항아리의 **누적 목표**로 환불한다(prepaidRefund 기본 모드 ·
 * 같은 검사에 여러 번 불러도 차이만 나간다). 차감이 없던 검사(체험·자동 무료·후불)는 prepaidRefund가 0원으로 돌아온다.
 * 부르는 자리 = 발송 실패를 기록하는 두 폴링(수동 라우트·큐 워커)에서 실패를 쓴 직후. 검사를 끝내는 자리는 9곳이라 거기 붙이면 빠진다.
 * 환불이 끝나지 않으면 경보만 남기고 던지지 않는다 — 폴링을 막지 않는다(사람이 경보로 본다).
 */
export async function refundSpamSendFailures(testId: string): Promise<void> {
  try {
    const r = await query(
      `SELECT t.company_id, r.message_type, COUNT(*) FILTER (WHERE ${spamFailedResultSql('r')})::int AS failed
         FROM spam_filter_test_results r
         JOIN spam_filter_tests t ON t.id = r.test_id
        WHERE r.test_id = $1
        GROUP BY t.company_id, r.message_type`,
      [testId],
    );
    for (const row of r.rows) {
      const failed = Number(row.failed || 0);
      if (failed <= 0) continue;
      const res = await prepaidRefund(String(row.company_id), failed, String(row.message_type), testId, '스팸 검사 발송 실패 환불', 'spam', { refundKey: REFUND_KEYS.FAIL });
      if (!res.ok) throw new Error(`환불 미완(${row.message_type} ${failed}건)`);
    }
  } catch (e: any) {
    console.error(`[SpamTest] 발송 실패 환불 미완 testId=${testId}:`, e?.message || e);
    void sendSystemAlert({
      dedupKey: `spam-fail-refund-miss:${testId}`,
      message: `스팸 검사 발송 실패 환불 미완 — test=${testId} 수동 확인 필요`,
    }).catch(() => undefined);
  }
}

/**
 * ★ 2026-09-26 한줄로 V2 m003 — 스팸 검사 문자의 QTmsg 행(라이브 + 이번 달 · 지난달 로그).
 * 옛 코드는 서버 현재 월 로그 하나만 봐 월말에 보낸 검사의 성공이 다음 달로 넘어가면 놓쳐 차단 대신 timeout이 됐다.
 * 큐 워커와 수동 검사 라우트가 같은 조회를 복붙하고 있어 여기 하나로 모은다. 로그 테이블이 없으면 그 달은 건너뛴다.
 */
export async function fetchSpamQtmsgRows(testId: string, now: Date = new Date()): Promise<any[]> {
  const testTable = (await getTestSmsTables())[0];
  const rows: any[] = [];
  const live = await mysqlQuery(
    `SELECT dest_no, msg_type, status_code FROM ${testTable} WHERE app_etc1 = ?`,
    [testId]
  ) as any[];
  if (live && live.length > 0) rows.push(...live);
  const ym = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  const months = [ym(now), ym(new Date(now.getFullYear(), now.getMonth() - 1, 1))];
  for (const m of months) {
    try {
      const log = await mysqlQuery(
        `SELECT dest_no, msg_type, status_code FROM ${testTable}_${m} WHERE app_etc1 = ?`,
        [testId]
      ) as any[];
      if (log && log.length > 0) rows.push(...log);
    } catch (e) { /* 로그 테이블 미존재 시 무시 */ }
  }
  return rows;
}

// ============================================================
// [2] 큐 워커: 다음 건 실행
// ============================================================
let queueWorkerRunning = false;

/**
 * ★ 2026-09-26 한줄로 V2 F45·F46·F47 — 큐 검사의 **실행 시작 시각**(프로세스 메모리 · 큐가 active로 바꿀 때 기록).
 * 등록 시각(created_at)으로 재면 큐에서 오래 기다린 검사가 시작하자마자 시간 초과·거짓 BLOCKED로 닫혔다(F46②·F47).
 * 기록이 없는 active(수동 검사 = 등록 즉시 active라 두 시각이 같다 · 재기동 전 행 = 폴러가 이미 사라졌다)는 등록 시각으로 잰다.
 */
const _activatedAt = new Map<string, number>();

/**
 * ★ 2026-09-26 F45·F46 — 멈춘 active 검사를 닫는다(결과 NULL → timeout · 검사 completed). 큐 워커·수동 검사 라우트 공용 CT.
 * 옛 큐 워커는 "active가 있으면 반환"을 먼저 해 이 정리에 영영 닿지 못했다 → 재기동으로 폴러가 사라진 행 하나가 큐 전체를 멈췄다.
 * active는 보통 0~1건이라 행을 읽어 실행 시작 시각(없으면 등록 시각)으로 판정한다. 실행 시작 기록은 지금 active인 것만 남긴다.
 */
export async function cleanupStaleActiveTests(thresholdMs: number): Promise<number> {
  const active = await query(`SELECT id, created_at FROM spam_filter_tests WHERE status = 'active'`);
  const now = Date.now();
  const activeIds = new Set<string>();
  const staleIds: string[] = [];
  for (const r of active.rows as any[]) {
    const id = String(r.id);
    activeIds.add(id);
    const startedAt = _activatedAt.get(id) ?? new Date(r.created_at).getTime();
    if (now - startedAt > thresholdMs) staleIds.push(id);
  }
  for (const id of Array.from(_activatedAt.keys())) if (!activeIds.has(id)) _activatedAt.delete(id);
  if (staleIds.length === 0) return 0;
  await query(
    `UPDATE spam_filter_test_results SET result = $2
     WHERE test_id = ANY($1::uuid[]) AND received = false AND result IS NULL`,
    [staleIds, SPAM_RESULT.TIMEOUT]
  );
  await query(
    `UPDATE spam_filter_tests SET status = 'completed', completed_at = NOW()
     WHERE id = ANY($1::uuid[]) AND status = 'active'`,
    [staleIds]
  );
  for (const id of staleIds) _activatedAt.delete(id);
  console.log(`[SpamTestQueue] 멈춘 검사 ${staleIds.length}건 자동 정리`);
  return staleIds.length;
}

export async function processSpamTestQueue(): Promise<void> {
  if (queueWorkerRunning) return; // 중복 실행 방지
  queueWorkerRunning = true;

  try {
    // ★ 2026-09-26 F45·F46 — 멈춘 active 정리를 **먼저** 한다(옛: active가 있으면 반환 → 이 정리에 닿지 못함).
    await cleanupStaleActiveTests(TIMEOUTS.spamFilterSafety);

    // 현재 active인 테스트가 있는지 확인
    const activeTest = await query(
      `SELECT id FROM spam_filter_tests WHERE status = 'active' LIMIT 1`
    );
    if (activeTest.rows.length > 0) {
      return; // 실행 중인 테스트 있음 → 대기
    }

    // 다음 queued 건 조회 (FIFO)
    const nextTest = await query(
      `SELECT id, company_id, user_id, callback_number,
              message_content_sms, message_content_lms, source
       FROM spam_filter_tests
       WHERE status = 'queued'
       ORDER BY created_at ASC
       LIMIT 1`
    );
    if (nextTest.rows.length === 0) return; // 큐 비어있음

    const test = nextTest.rows[0];

    // active로 전환
    await query(
      `UPDATE spam_filter_tests SET status = 'active' WHERE id = $1`,
      [test.id]
    );
    _activatedAt.set(test.id, Date.now());   // ★ 2026-09-26 F46·F47 실행 시작 시각

    console.log(`[SpamTestQueue] 테스트 실행 시작 — testId=${test.id}, source=${test.source}`);

    // 테스트 실행
    await executeSpamTest(test.id, isAutoSpamSource(test.source), test.company_id);
  } catch (err) {
    console.error('[SpamTestQueue] 큐 워커 오류:', err);
  } finally {
    queueWorkerRunning = false;
  }
}

// ============================================================
// [3] 테스트 실행: QTmsg INSERT + 폴링
// ============================================================
async function executeSpamTest(testId: string, isAuto: boolean, companyId: string): Promise<void> {
  // ★ 2026-09-26 한줄로 V2 F30 — 적재에 성공한 건수. 예외면 나간 만큼만 남기고 선불을 되돌린다(catch).
  //   환불 대상 회사는 호출부가 이미 읽은 값으로 시작한다(Codex 1R high: 첫 조회가 실패해도 환불을 건너뛰지 않게).
  let sentCount = 0;
  let refundCompanyId: string | null = companyId;
  // ★ 2026-09-26 F47 — 시간 초과는 실행 시작 시각으로 잰다(큐에서 기다린 시간을 빼고).
  const activatedAt = _activatedAt.get(testId) ?? Date.now();
  try {
    // 테스트 정보 조회
    const testInfo = await query(
      `SELECT t.*, c.customer_schema
       FROM spam_filter_tests t
       JOIN companies c ON c.id = t.company_id
       WHERE t.id = $1`,
      [testId]
    );
    if (testInfo.rows.length === 0) return;
    const test = testInfo.rows[0];

    // 필드 매핑 + 첫 고객 조회
    const fieldMappings = extractVarCatalog(test.customer_schema).fieldMappings;
    await enrichWithCustomFields(fieldMappings, test.company_id);

    // ★ enqueue 시점 첫 고객(해시·미리보기 기준)을 그대로 재사용 — 발송 본문이 해시·미리보기와 일치.
    //   과거 레코드(first_recipient 컬럼 도입 전)는 enqueue와 같은 name ASC NULLS LAST fallback으로 정렬 통일.
    let firstCustomer: Record<string, any>;
    if (test.first_recipient && typeof test.first_recipient === 'object' && Object.keys(test.first_recipient).length > 0) {
      firstCustomer = test.first_recipient;
    } else {
      const mappingCols = Object.values(fieldMappings).filter((m: any) => m.storageType !== 'custom_fields').map((m: any) => m.column);
      const selectCols = [...new Set(['phone', 'custom_fields', ...mappingCols])].join(', ');
      // ★ 2026-09-22 브랜드 격리(과거 레코드 폴백 경로도 같은 범위)
      const sampleScope = await getSampleCustomerScope(test.company_id, test.user_id, { paramIndex: 2 });
      const firstResult = await query(
        `SELECT ${selectCols} FROM customers WHERE company_id = $1 AND is_active = true AND sms_opt_in = true${sampleScope.where} ORDER BY name ASC NULLS LAST LIMIT 1`,
        [test.company_id, ...sampleScope.params]
      );
      firstCustomer = firstResult.rows[0] || {};
    }

    // 미발송 결과 행 조회
    const resultRows = await query(
      `SELECT id, carrier, message_type, phone FROM spam_filter_test_results WHERE test_id = $1`,
      [testId]
    );

    // QTmsg INSERT
    for (const row of resultRows.rows) {
      const rawContent = row.message_type === 'SMS' ? test.message_content_sms : test.message_content_lms;
      // ★ D92: %회신번호% 치환 — 실제 스팸테스트 발송 시에도 callbackNumber 전달
      const testAddressBookFields = test.callback_number ? { callback: test.callback_number, extra1: '', extra2: '', extra3: '', name: '' } : undefined;
      const content = replaceVariables(rawContent || '', firstCustomer, fieldMappings, testAddressBookFields);
      const titleStr = (row.message_type === 'LMS' || row.message_type === 'MMS') ? (test.subject || '') : '';
      await insertTestSmsQueue(row.phone, test.callback_number, content, row.message_type, testId, titleStr);
      sentCount += 1;
    }

    // grace period 결정
    const graceMs = isAuto ? AUTO_GRACE_MS : MANUAL_GRACE_MS;
    const qtmsgSuccessTime = new Map<string, number>();

    // 폴링 시작
    const pollInterval = setInterval(async () => {
      try {
        // active 확인
        const activeCheck = await query(
          `SELECT id, created_at FROM spam_filter_tests WHERE id = $1 AND status = 'active'`,
          [testId]
        );
        if (activeCheck.rows.length === 0) {
          clearInterval(pollInterval);
          return;
        }

        // 미수신 건 조회
        const unreceived = await query(
          `SELECT id, phone, message_type FROM spam_filter_test_results
           WHERE test_id = $1 AND received = false AND result IS NULL`,
          [testId]
        );

        if (unreceived.rows.length === 0) {
          clearInterval(pollInterval);
          await query(
            `UPDATE spam_filter_tests SET status = 'completed', completed_at = NOW()
             WHERE id = $1 AND status = 'active'`,
            [testId]
          );
          return;
        }

        // QTmsg 결과 조회 — ★ 2026-09-26 한줄로 V2 m003 CT(라이브 + 이번 달·지난달 로그)
        const mqRows = await fetchSpamQtmsgRows(testId);

        let wroteFailed = false;
        try {
          for (const row of unreceived.rows) {
            const mType = toQtmsgType(row.message_type);
            const mqMatch = mqRows.find(
              (m: any) => m.dest_no === row.phone && m.msg_type === mType
            );
            if (!mqMatch) continue;

            const sc = Number(mqMatch.status_code);
            let result: string | null = null;

            if (SUCCESS_CODES.includes(sc)) {
              const rowKey = row.id;
              if (!qtmsgSuccessTime.has(rowKey)) {
                qtmsgSuccessTime.set(rowKey, Date.now());
                result = null;
              } else if (spamBlockedDue({ nowMs: Date.now(), startedAtMs: activatedAt, successSeenAtMs: qtmsgSuccessTime.get(rowKey), graceMs })) {
                // ★ 2026-10-02 유예 + 검사 시작 뒤 45초가 지나야 확정한다(늦게 닿는 보고를 기다린다)
                result = SPAM_RESULT.BLOCKED;
                console.log(`[SpamTestQueue] BLOCKED — testId=${testId}, phone=${row.phone}, grace=${graceMs}ms, 시작 뒤 ${Math.round((Date.now() - activatedAt) / 1000)}초`);
              } else {
                result = null;
              }
            } else if (PENDING_CODES.includes(sc)) {
              result = null;
            } else {
              result = SPAM_RESULT.FAILED;
            }

            if (result) {
              // ★ 2026-09-29 차수 5 — 아직 판정 안 된 행만(CT) · 이번에 쓴 때만 환불 신호
              const w = await query(SPAM_RESULT_DECIDE_SQL, [result, row.id]);
              if ((w.rowCount ?? 0) > 0 && result === SPAM_RESULT.FAILED) wroteFailed = true;
            }
          }
        } finally {
          // ★ 2026-09-26 한줄로 V2 m042 — 이번 회차에 발송 실패를 썼으면 그만큼 선불 환불(누적 목표 · 재호출 안전) · 뒤 행 기록이 던져도 부른다(Codex 1R)
          if (wroteFailed) await refundSpamSendFailures(testId);
        }

        // 전부 처리 확인
        const remaining = await query(
          `SELECT id FROM spam_filter_test_results
           WHERE test_id = $1 AND received = false AND result IS NULL`,
          [testId]
        );
        if (remaining.rows.length === 0) {
          clearInterval(pollInterval);
          await query(
            `UPDATE spam_filter_tests SET status = 'completed', completed_at = NOW()
             WHERE id = $1 AND status = 'active'`,
            [testId]
          );
          return;
        }

        // 타임아웃 체크
        const elapsed = Date.now() - activatedAt;
        if (elapsed > TIMEOUTS.spamFilterTest) {
          clearInterval(pollInterval);
          for (const row of remaining.rows) {
            const rowKey = row.id;
            const finalResult = qtmsgSuccessTime.has(rowKey) ? SPAM_RESULT.BLOCKED : SPAM_RESULT.TIMEOUT;
            await query(SPAM_RESULT_DECIDE_SQL, [finalResult, row.id]);
          }
          await query(
            `UPDATE spam_filter_tests SET status = 'completed', completed_at = NOW()
             WHERE id = $1 AND status = 'active'`,
            [testId]
          );
        }
      } catch (err) {
        console.error('[SpamTestQueue] 폴링 오류:', err);
      }
    }, RESULT_POLL_INTERVAL_MS);

    // 안전장치 타임아웃
    setTimeout(() => { clearInterval(pollInterval); }, TIMEOUTS.spamFilterSafety);

  } catch (err) {
    console.error('[SpamTestQueue] 테스트 실행 오류:', err);
    // ★ 2026-09-26 한줄로 V2 F30 — 등록 때 차감한 선불을 **나간 건수만 남기고** 되돌린다(keepCount = 적재 성공 건수).
    //   종전엔 completed만 적어 한 통도 안 나가도 차감이 남았다. 차감이 없던 검사(skipPrepaid·후불)는 prepaidRefund가 0원으로 돌아온다.
    //   유형은 결과 행의 유형 = 등록 때의 차감 유형(단일 유형)이다.
    //   환불을 상태 기록보다 **먼저** 한다(Codex 3차 2R) — 상태 UPDATE가 실패해도 환불·경보를 건너뛰지 않게.
    if (refundCompanyId) {
      try {
        const types = await query(`SELECT DISTINCT message_type FROM spam_filter_test_results WHERE test_id = $1`, [testId]);
        for (const r of types.rows) {
          const refundRes = await prepaidRefund(refundCompanyId, 0, String(r.message_type), testId, '스팸 검사 발송 실패 환불', 'spam', { refundKey: REFUND_KEYS.NOT_LOADED, keepCount: sentCount });
          if (!refundRes.ok) throw new Error(`환불 미완(${r.message_type})`);
        }
      } catch (refundErr: any) {
        console.error(`[SpamTestQueue] 발송 실패 환불 미완 testId=${testId}:`, refundErr?.message || refundErr);
        void sendSystemAlert({ dedupKey: `spam-refund-miss:${testId}`, message: `스팸 검사(큐) 발송 실패 환불 미완 — test=${testId} 수동 확인 필요` }).catch(() => undefined);
      }
    }
    // 실패 시 completed 처리
    await query(
      `UPDATE spam_filter_tests SET status = 'completed', completed_at = NOW() WHERE id = $1`,
      [testId]
    ).catch((e: any) => console.error(`[SpamTestQueue] 실패 종료 기록 실패 testId=${testId}:`, e?.message || e));
  }
}

// ============================================================
// [4] 배치 결과 조회
// ============================================================
export async function getSpamTestBatchResults(batchId: string): Promise<SpamTestBatchResult> {
  const tests = await query(
    `SELECT id, variant_id, status FROM spam_filter_tests
     WHERE batch_id = $1 ORDER BY variant_id`,
    [batchId]
  );

  const variants: SpamTestBatchResult['variants'] = [];
  let allCompleted = true;

  // ★ 2026-09-28 한줄로 V2 m005 — 변형들의 결과를 한 번에 읽는다(옛: 변형마다 조회 · 여정 사전검사가 끝날 때까지 반복 호출된다).
  const resultsByTest = new Map<string, Array<{ carrier: any; messageType: any; result: any }>>();
  if (tests.rows.length > 0) {
    const results = await query(
      `SELECT test_id, carrier, message_type, result FROM spam_filter_test_results
       WHERE test_id = ANY($1::uuid[]) ORDER BY carrier, message_type`,
      [tests.rows.map((t: any) => t.id)]
    );
    for (const r of results.rows as any[]) {
      const key = String(r.test_id);
      if (!resultsByTest.has(key)) resultsByTest.set(key, []);
      resultsByTest.get(key)!.push({ carrier: r.carrier, messageType: r.message_type, result: r.result });
    }
  }

  for (const test of tests.rows) {
    const carrierResults = resultsByTest.get(String(test.id)) || [];

    // 전체 결과 판정
    let overallResult: 'pass' | 'blocked' | 'failed' | 'timeout' | 'pending' = 'pending';
    if (test.status === 'completed' || test.status === 'active') {
      const allResults = carrierResults.map(r => r.result).filter(Boolean);
      // ★ 2026-09-26 한줄로 V2 F48 — 판정 대기(NULL) 통신사를 버리지 않는다. 차단 판정은 유예(수십 초) 뒤라 통과 리포트(수 초)보다
      //   늘 늦어, 대기를 버리면 한 곳만 통과해도 전체 pass였다(한 통신사만 막는 문안 = 스팸 검사가 잡아야 할 경우).
      //   대기가 남으면: 진행 중 = pending · 완료 = timeout(통과 아님). 차단이 이미 있으면 그대로 blocked.
      const hasUnjudged = carrierResults.some(r => !r.result);
      if (allResults.some(r => r === SPAM_RESULT.BLOCKED)) {
        overallResult = 'blocked';
      } else if (hasUnjudged) {
        overallResult = test.status === 'active' ? 'pending' : 'timeout';
      } else if (allResults.length === 0) {
        overallResult = 'pending';
      } else if (allResults.some(r => r === SPAM_RESULT.FAILED)) {
        overallResult = 'failed';
      } else if (allResults.some(r => r === SPAM_RESULT.TIMEOUT)) {
        overallResult = 'timeout';
      } else if (allResults.every(r => r === SPAM_RESULT.PASS)) {
        overallResult = 'pass';
      }
    }

    if (test.status !== 'completed') allCompleted = false;

    variants.push({
      variantId: test.variant_id,
      testId: test.id,
      status: test.status,
      overallResult,
      carrierResults,
    });
  }

  return {
    batchId,
    completed: allCompleted,
    variants,
  };
}

// ============================================================
// [5] 테스트 완료 대기 (Promise 기반)
// ============================================================
async function waitForTestCompletion(testId: string, timeoutMs: number = TIMEOUTS.spamFilterSafety): Promise<string> {
  const startTime = Date.now();
  return new Promise((resolve) => {
    const checkInterval = setInterval(async () => {
      try {
        const test = await query(
          `SELECT status FROM spam_filter_tests WHERE id = $1`,
          [testId]
        );
        if (test.rows[0]?.status === 'completed') {
          clearInterval(checkInterval);

          // 전체 결과 판정
          const results = await query(
            `SELECT result FROM spam_filter_test_results WHERE test_id = $1`,
            [testId]
          );
          const allResults = results.rows.map((r: any) => r.result).filter(Boolean);
          if (allResults.some(r => r === SPAM_RESULT.BLOCKED)) {
            resolve('blocked');
          } else if (allResults.some(r => r === SPAM_RESULT.FAILED)) {
            resolve('failed');
          } else if (allResults.some(r => r === SPAM_RESULT.TIMEOUT)) {
            resolve('timeout');
          } else {
            resolve('pass');
          }
          return;
        }

        if (Date.now() - startTime > timeoutMs) {
          clearInterval(checkInterval);
          resolve('timeout');
        }
      } catch (err) {
        console.error('[SpamTestQueue] 완료 대기 오류:', err);
      }
    }, 2000); // 2초마다 확인
  });
}

// ============================================================
// [6] 자동 스팸테스트 + 재생성 통합 (AI route에서 호출)
// ============================================================

type AutoSpamVerdict = 'pass' | 'blocked' | 'failed' | 'timeout';

/**
 * ★ 2026-10-03 안을 차례로 검사하고 첫 통과에서 멈춘다(순수 · 검사·재생성은 주입) — 임은지 접수
 * 「1안이 스팸에 걸리면 2안·3안을 자동으로 검사해 통과한 문안으로 승인 문자」.
 *   1) 원안을 순서대로 검사 → 통과한 안에서 멈춘다(그 뒤 안은 검사하지 않는다).
 *   2) 모두 통과하지 못했고 1안이 「차단」이었으면 1안을 재생성해 다시 검사한다(정책 횟수 · 통과하면 멈춤).
 *      결과 없음·검사 실패는 재생성하지 않는다(종전 규칙과 같다 · 재생성은 차단에만).
 *   3) 시간 예산(budgetMs)을 넘기면 새 검사를 시작하지 않는다 — 결과는 미통과 = 안 보내는 쪽.
 */
export async function sequenceSpamVariants(p: {
  variants: AutoSpamTestVariant[];
  maxRetries: number;
  runTest: (v: AutoSpamTestVariant, message: string, subject?: string) => Promise<{
    spamResult: AutoSpamVerdict; carrierResults: Array<{ carrier: string; messageType: string; result: string }>;
  }>;
  regenerate?: (variantId: string) => Promise<{ messageText: string; subject?: string } | null>;
  budgetMs?: number;
  now?: () => number;
}): Promise<{ variants: AutoSpamTestResult['variants']; passedVariantId: string | null; regenerateCount: number }> {
  const now = p.now || Date.now;
  const start = now();
  const overBudget = () => typeof p.budgetMs === 'number' && now() - start >= p.budgetMs;
  const out: AutoSpamTestResult['variants'] = [];
  for (const v of p.variants) {
    if (out.length > 0 && overBudget()) break;
    const r = await p.runTest(v, v.messageText, v.subject);
    out.push({
      variantId: v.variantId, messageText: v.messageText, subject: v.subject,
      spamResult: r.spamResult, carrierResults: r.carrierResults, regenerated: false, regenerateCount: 0,
    });
    if (r.spamResult === 'pass') return { variants: out, passedVariantId: v.variantId, regenerateCount: 0 };
  }
  const first = out[0];
  const firstSrc = p.variants[0];
  let regenerateCount = 0;
  if (first && firstSrc && first.spamResult === 'blocked' && p.regenerate) {
    for (let attempt = 0; attempt < p.maxRetries; attempt++) {
      if (overBudget()) break;
      const nm = await p.regenerate(first.variantId);
      if (!nm || !nm.messageText) break;
      // ★ Codex 1R medium — 재생성이 예산을 넘겨 돌아오면 새 검사를 시작하지 않고 문안도 바꾸지 않는다(미통과 = 안 보내는 쪽)
      if (overBudget()) break;
      first.messageText = nm.messageText;
      if (nm.subject) first.subject = nm.subject;
      first.regenerated = true;
      first.regenerateCount++;
      regenerateCount++;
      const r = await p.runTest(firstSrc, first.messageText, first.subject);
      first.spamResult = r.spamResult;
      first.carrierResults = r.carrierResults;
      if (r.spamResult === 'pass') return { variants: out, passedVariantId: first.variantId, regenerateCount };
      if (r.spamResult !== 'blocked') break;
    }
  }
  return { variants: out, passedVariantId: null, regenerateCount };
}
export async function autoSpamTestWithRegenerate(params: {
  companyId: string;
  userId: string;
  callbackNumber: string;
  messageType: 'SMS' | 'LMS' | 'MMS';
  subject?: string;
  variants: AutoSpamTestVariant[];
  isAd: boolean;
  rejectNumber?: string;
  firstRecipient?: Record<string, any>;
  regenerateCallback?: (blockedVariantId: string) => Promise<{ messageText: string; subject?: string } | null>;
  maxRetries?: number;
  /**
   * ★ 2026-10-03 안을 차례로 검사하다 첫 통과에서 멈춘다 · 모두 막히면 그때 1안을 재생성(sequenceSpamVariants).
   * 기본(false·생략) = 종전대로 안마다 검사·재생성 — 다른 호출처(자동발송·대행·플래너·리마인드)는 그대로다.
   */
  stopOnFirstPass?: boolean;
  /** stopOnFirstPass 모드의 시간 예산(넘기면 새 검사를 시작하지 않는다 · 결과는 미통과 = 안 보내는 쪽) */
  budgetMs?: number;
}): Promise<AutoSpamTestResult> {
  const {
    companyId, userId, callbackNumber, messageType, subject,
    variants, isAd, rejectNumber, firstRecipient,
    regenerateCallback, maxRetries = MAX_REGENERATE_RETRIES,
  } = params;

  const batchId = crypto.randomUUID();
  const isLmsType = messageType === 'LMS' || messageType === 'MMS';

  const resultVariants: AutoSpamTestResult['variants'] = [];
  let totalTestCount = 0;
  let totalRegenerateCount = 0;

  // 한 문안을 한 번 검사한다(광고 표기 · 큐 등록 · 완료 대기 · 통신사별 결과). 큐 등록 실패 = enqueued false.
  const runOneTest = async (variantId: string, message: string, subj?: string): Promise<{
    enqueued: boolean; spamResult: string; carrierResults: Array<{ carrier: string; messageType: string; result: string }>;
  }> => {
    // ★ D102: (광고)+080 — CT-AD 컨트롤타워 사용
    const msgTypeForAd = isLmsType ? 'LMS' : 'SMS';
    const testMessage = buildAdMessage(message, msgTypeForAd, isAd, rejectNumber || '');
    // ★ KISA 2026-05: 제목(광고) — buildAdSubject 컨트롤타워 사용
    const testSubject = buildAdSubject(subj || '', msgTypeForAd, isAd);

    // 메시지 내용 구성
    const smsContent = !isLmsType ? testMessage : undefined;
    const lmsContent = isLmsType ? testMessage : undefined;

    // 큐에 등록
    const enqueueResult = await enqueueSpamTest({
      companyId,
      userId,
      callbackNumber,
      messageContentSms: smsContent,
      messageContentLms: lmsContent,
      messageType,
      subject: testSubject,
      firstRecipient,
      source: 'auto_ai',
      variantId,
      batchId,
      skipPrepaid: true, // 자동 검사 = 요금제 무관 무료(자동마케팅 진입 = 유료 요금제 전부 · 사용량은 크레딧)
    });

    if (!enqueueResult.ok) {
      console.error(`[SpamTestQueue] variant ${variantId} 큐 등록 실패:`, enqueueResult.error);
      return { enqueued: false, spamResult: 'failed', carrierResults: [] };
    }

    totalTestCount++;

    // 테스트 완료 대기
    const verdict = await waitForTestCompletion(enqueueResult.testId!);

    // 결과 조회
    const results = await query(
      `SELECT carrier, message_type, result FROM spam_filter_test_results
       WHERE test_id = $1 ORDER BY carrier, message_type`,
      [enqueueResult.testId]
    );
    return {
      enqueued: true,
      spamResult: verdict,
      carrierResults: results.rows.map((r: any) => ({
        carrier: r.carrier,
        messageType: r.message_type,
        result: r.result || 'timeout',
      })),
    };
  };

  if (params.stopOnFirstPass) {
    const seq = await sequenceSpamVariants({
      variants: variants.map((v) => ({ ...v, subject: v.subject || subject })),
      maxRetries,
      budgetMs: params.budgetMs,
      runTest: async (v, message, subj) => {
        const r = await runOneTest(v.variantId, message, subj);
        return { spamResult: r.spamResult as AutoSpamVerdict, carrierResults: r.carrierResults };
      },
      regenerate: regenerateCallback,
    });
    return {
      batchId,
      variants: seq.variants,
      totalTestCount,
      totalRegenerateCount: seq.regenerateCount,
      passedVariantId: seq.passedVariantId,
    };
  }

  for (const variant of variants) {
    let currentMessage = variant.messageText;
    let currentSubject = variant.subject || subject;
    let regenerateCount = 0;
    let spamResult: string = 'pending';
    let carrierResults: Array<{ carrier: string; messageType: string; result: string }> = [];

    // 최대 재시도 횟수까지 반복
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const one = await runOneTest(variant.variantId, currentMessage, currentSubject);
      if (!one.enqueued) {
        spamResult = 'failed';
        break;
      }
      spamResult = one.spamResult;
      carrierResults = one.carrierResults;

      // 통과했으면 종료
      if (spamResult === 'pass') {
        break;
      }

      // 차단됐고 재생성 가능하면 재시도
      if (spamResult === 'blocked' && attempt < maxRetries && regenerateCallback) {
        console.log(`[SpamTestQueue] variant ${variant.variantId} 스팸 차단 → 재생성 시도 (${attempt + 1}/${maxRetries})`);
        const newMessage = await regenerateCallback(variant.variantId);
        if (newMessage) {
          currentMessage = newMessage.messageText;
          if (newMessage.subject) currentSubject = newMessage.subject;
          regenerateCount++;
          totalRegenerateCount++;
        } else {
          break; // 재생성 실패 → 현재 결과로 확정
        }
      } else {
        break; // 재시도 불가 또는 최대 횟수 초과
      }
    }

    resultVariants.push({
      variantId: variant.variantId,
      messageText: currentMessage,
      subject: currentSubject,
      spamResult: spamResult as any,
      carrierResults,
      regenerated: regenerateCount > 0,
      regenerateCount,
    });
  }

  return {
    batchId,
    variants: resultVariants,
    totalTestCount,
    totalRegenerateCount,
  };
}

// ============================================================
// [7] 큐 워커 시작 (app.ts에서 호출)
// ============================================================
let queueWorkerTimer: ReturnType<typeof setInterval> | null = null;

export function startSpamTestQueueWorker(): void {
  if (queueWorkerTimer) return; // 중복 시작 방지

  console.log(`[SpamTestQueue] 큐 워커 시작 (${QUEUE_POLL_INTERVAL_MS}ms 간격)`);

  queueWorkerTimer = setInterval(async () => {
    try {
      await processSpamTestQueue();
    } catch (err) {
      console.error('[SpamTestQueue] 큐 워커 예외:', err);
    }
  }, QUEUE_POLL_INTERVAL_MS);
}

export function stopSpamTestQueueWorker(): void {
  if (queueWorkerTimer) {
    clearInterval(queueWorkerTimer);
    queueWorkerTimer = null;
    console.log('[SpamTestQueue] 큐 워커 중지');
  }
}
