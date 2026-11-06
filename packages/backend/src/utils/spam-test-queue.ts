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

import { isDemoCompany } from './demo-company';   // ★ 2026-10-09 시연 회사 = 검사 발송 0
import { createHash } from 'crypto';
import pool, { mysqlQuery, query } from '../config/database';
import { TIMEOUTS } from '../config/defaults';
import { extractVarCatalog } from '../services/ai';
import { replaceVariables, enrichWithCustomFields, buildAdMessage, buildAdSubject, prepareFieldMappings } from '../utils/messageUtils';
import { getTestSmsTables, toQtmsgType, insertTestSmsQueue } from './sms-queue';
import { unsupportedSmsCharCodes } from './sms-charset';
import { cleanSmsTextAll, scanSmsText, describeSmsCharFindings } from './message-sanitizer';   // ★ 2026-11-06 C109 글자 판단 CT · 위치 문장
import { SUCCESS_CODES, PENDING_CODES, SPAM_RESULT, SPAM_RESULT_DECIDE_SQL, spamFailedResultSql, deliveredUnreportedResult } from '../utils/sms-result-map';
import { prepaidDeduct, prepaidRefund, REFUND_KEYS } from '../utils/prepaid';
import { sendSystemAlert } from './system-alert';
import { getSampleCustomerScope } from './store-scope';
import { KST_TODAY_START_SQL } from './stats-aggregation';
// ★ 2026-09-26 한줄로 V2 F49 — 무료 자동 검사 표시값·자동 판정(청구 제외 판정 CT와 한 벌)
import { SPAM_AUTO_FREE_SOURCE, isAutoSpamSource, notAutoSpamSourceSql } from './spam-trial';
import { getRegisteredCallbackSet } from './callback-filter';   // ★ 2026-11-05 C103 F1 수동 검사 수락 규칙(배정 발신번호)
import { normalizePhone } from './normalize-phone';

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
  /**
   * ★ 2026-11-01 B1-4(J15) — 같은 검사 이어 보기(spamCheckFor). 참이면 같은 키 · 같은 한국 날짜의 검사가 진행 중 · 확인 중 · 통과 · 차단이면
   *   새로 걸지 않고 그 검사를 돌려준다(차감 0 · reused). 장애로 끝났으면 새 검사. 사람이 누른 수동 검사는 넘기지 않는다(늘 새 검사).
   */
  reuseSameDay?: boolean;
  /** ★ 2026-11-02 엔진 재설계 E3-2 — 재사용 창(일 · 기본 = 그날 · 여정 정기 재검사만 7 · reuseSameDay 와 함께 쓴다) */
  reuseDays?: number;
  /**
   * ★ 2026-11-05 C103 F1(Codex 설계 1R H3) — 사람이 누른 검사 수락 규칙을 등록 트랜잭션 안에서 지난다(사용자 잠금 · 그 사용자 진행 중 사람 검사 1건).
   *   여정 칸 「지금 스팸 검사」가 쓴다(수동 검사 주소와 같은 규칙 · manualSpamInProgressInTx). 진행 중이 있으면 errorCode MANUAL_IN_PROGRESS.
   */
  manualAdmission?: { userId: string };
  /**
   * ★ 2026-11-06 C109(Codex 설계 4R) — 렌더가 끝난 글(여정 · 대행 표본). 참이면 지문 · 글자 판정 · 워커 발송이 받은 글을 그대로 쓴다(치환 0).
   *   옛: 렌더된 글을 큐가 다시 치환해 고객 값 속 템플릿 글(`{{ 'Å' | downcase }}`)이 두 번째 치환에서 풀렸다.
   */
  rendered?: boolean;
}

export interface SpamTestEnqueueResult {
  ok: boolean;
  testId?: string;
  /** ★ 2026-11-01 B1-4 — 오늘 같은 키의 검사를 이어 본다(새 검사 · 차감 0) */
  reused?: boolean;
  error?: string;
  errorCode?: string;
  insufficientBalance?: boolean;
  balance?: number;
  requiredAmount?: number;
  /** ★ 2026-11-06 C109 — 글자 반려(SMS_UNSUPPORTED_CHARS)일 때 그 글자 코드('U+XXXX') */
  unsupportedChars?: string[];
}

export interface SpamTestBatchResult {
  batchId: string;
  completed: boolean;
  variants: Array<{
    variantId: string;
    testId: string;
    status: string;
    overallResult: 'pass' | 'blocked' | 'failed' | 'timeout' | 'pending' | 'unconfirmed';
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

/** ★ 2026-11-06 C109(Codex 설계 1R #6 · 2R #5) — 반려면 사유가 필수인 갈래(선택 칸이면 중간 변환이 사유를 버린다) */
interface AutoSpamVariantBase {
  variantId: string;
  messageText: string;
  subject?: string;
  carrierResults: Array<{
    carrier: string;
    messageType: string;
    result: string;
  }>;
  regenerated: boolean;
  regenerateCount: number;
}
export type AutoSpamVariantResult =
  | (AutoSpamVariantBase & { spamResult: Exclude<AutoSpamVerdict, 'rejected'>; rejection?: undefined })
  | (AutoSpamVariantBase & { spamResult: 'rejected'; rejection: string });

export interface AutoSpamTestResult {
  batchId: string;
  variants: AutoSpamVariantResult[];
  /** ★ 2026-10-03 stopOnFirstPass 모드에서 통과한 안(없으면 null · 기본 모드는 넣지 않는다) */
  passedVariantId?: string | null;
  totalTestCount: number;
  totalRegenerateCount: number;
  /** ★ 2026-11-02 엔진 재설계 E3-6 — 안마다 마지막으로 건 검사 id(기다림이 끝난 뒤 결과를 다시 읽는다 · 이어 보기면 그 검사) */
  testIds?: Record<string, string>;
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
      if (own.correctable !== true) {
        // ★ 2026-11-01 B1-4(R36) — 판정이 굳은 뒤 닿은 수신 = 「확정 뒤 수신」 기록(판정은 그대로 · 하루 측정이 세어 경보 · 칸 없으면 건너뜀)
        await noteAfterDecidedReport(String(own.id), o.devicePhone, o.carrier, o.messageType).catch(() => undefined);
        return null;
      }
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
// ★ 2026-11-01 여정 재발 방지 B1-4 — 결과 행 판정 기록 · 같은 검사 이어 보기
//   설계서 docs/2026-11-01-journey-recurrence-prevention-design.md §2 B1-4 · §4 DDL-B
// ============================================================

/** DDL-B 칸(first_result · decided_at · late_report_at) 유무 — 참은 기억 · 거짓은 5분 뒤 다시(칸이 없으면 기록만 건너뛴다 · 판정은 그대로) */
let _stampReady = false;
let _stampAbsentUntil = 0;
export async function spamStampReady(): Promise<boolean> {
  if (_stampReady) return true;
  if (Date.now() < _stampAbsentUntil) return false;
  const r = await query(
    `SELECT COUNT(*)::int AS n FROM information_schema.columns
      WHERE table_name = 'spam_filter_test_results' AND column_name IN ('first_result', 'decided_at', 'late_report_at')`,
  );
  const ok = Number(r.rows[0]?.n || 0) === 3;
  if (ok) _stampReady = true;
  else _stampAbsentUntil = Date.now() + 5 * 60_000;
  return ok;
}
/** 시험 전용 */
export function resetSpamStampCache(value?: boolean): void {
  _stampReady = value === true;
  _stampAbsentUntil = value === false ? Date.now() + 5 * 60_000 : 0;
}

/**
 * 아직 판정 안 된 행에 처음 판정을 쓴다(큐 · 수동 라우트 공용 · 옛 SPAM_RESULT_DECIDE_SQL 자리 전부). 쓴 행 수를 돌려준다.
 *   칸이 있으면 처음 판정(first_result)과 최종 확정 시각(decided_at · 확인 중은 최종이 아니다)을 함께 남긴다 — 늦은 보고 · 확인 문자가
 *   뒤에 덮어써도 「처음에 확인 중이었다」가 남는다(오탐률 측정 R36).
 */
export async function decideSpamResult(result: string, rowId: string): Promise<number> {
  const stamped = await spamStampReady().catch(() => false);
  const r = await query(
    stamped
      ? `UPDATE spam_filter_test_results
            SET result = $1::varchar, first_result = $1::varchar,
                decided_at = CASE WHEN $1::varchar = '${SPAM_RESULT.UNCONFIRMED}' THEN NULL ELSE NOW() END
          WHERE id = $2 AND received = false AND result IS NULL`
      : SPAM_RESULT_DECIDE_SQL,
    [result, rowId],
  );
  return r.rowCount ?? 0;
}

/**
 * 확인 중(unconfirmed) 행을 최종으로 닫는다 — 확인 문자 수신 = blocked · 확인 문자 없음 · 단말 확인 불가 = error.
 *   조건부 UPDATE(WHERE result = 'unconfirmed') — 늦은 보고(통과로 고침)와 엇갈려도 한쪽만 쓴다. 쓴 행 수를 돌려준다.
 */
export async function noteAfterDecidedReport(testId: string, phone: string, carrier: string, messageType: string): Promise<void> {
  if (!(await spamStampReady())) return;
  await query(
    `UPDATE spam_filter_test_results SET late_report_at = COALESCE(late_report_at, NOW())
      WHERE test_id = $1 AND phone = $2 AND carrier = $3 AND message_type = $4 AND received = false`,
    [testId, phone, carrier, messageType],
  );
}

export async function decideUnconfirmed(resultId: string, final: 'blocked' | 'error'): Promise<number> {
  const stamped = await spamStampReady().catch(() => false);
  const r = await query(
    `UPDATE spam_filter_test_results SET result = $2${stamped ? ', decided_at = NOW()' : ''}
      WHERE id = $1 AND result = '${SPAM_RESULT.UNCONFIRMED}'`,
    [resultId, final],
  );
  return r.rowCount ?? 0;
}

/**
 * 검사 한 건의 지금 결과(순수) — 이어 보기 · 여정 보내기 전 검사가 읽는 한 곳.
 *   blocked = 막힘 확정 행이 있다 · pending = 아직 끝나지 않았다 · unconfirmed = 끝났지만 확인 중 행이 있다(확인 문자가 닫는다) ·
 *   pass = 결과 행 전부 통과 · error = 그 밖(결과 0행 · 시간 초과 · 발송 실패 · 단말 확인 불가).
 */
export function spamTestOutcomeOf(status: string, results: ReadonlyArray<{ result?: string | null }>): SpamVerdict {
  if (results.some((r) => r.result === SPAM_RESULT.BLOCKED)) return 'blocked';
  if (status !== 'completed') return 'pending';
  if (results.length === 0) return 'error';
  if (results.some((r) => r.result === SPAM_RESULT.UNCONFIRMED)) return 'unconfirmed';
  return results.every((r) => r.result === SPAM_RESULT.PASS) ? 'pass' : 'error';
}

/** SQL 실행자(기본 = 풀 · 트랜잭션 안에서는 그 연결을 넘긴다 — 잠금을 쥔 채 풀 연결을 하나 더 기다리지 않게 · Codex 구현 2R #1) */
type SqlRun = (sql: string, params?: any[]) => Promise<{ rows: any[] }>;

// ============================================================
// ★ 2026-11-05 C103 F1 — 사람이 누른 검사(수동) 수락 규칙 한 곳(Codex 설계 1R H3)
//   입구 = 수동 검사 주소(routes/spam-filter.ts) · 여정 칸 「지금 스팸 검사」(enqueueSpamTest manualAdmission). 옛: 수동 주소 안 인라인.
// ============================================================
export const SPAM_TEST_USER_LOCK_SQL = `SELECT pg_advisory_xact_lock(hashtext('spam-test-user:' || $1::text))`;
/** 그 사용자의 진행 중 사람 검사(자동 출처 제외 · 줄에 선 queued 포함) — 잠금 없는 빠른 확인도 이 문장 */
export const MANUAL_SPAM_IN_PROGRESS_SQL = `SELECT id FROM spam_filter_tests WHERE user_id = $1 AND status IN ('pending', 'active', 'queued') AND ${notAutoSpamSourceSql()} LIMIT 1`;
/** 트랜잭션 안: 사용자 잠금 → 진행 중 사람 검사 id(없으면 null). 잠금은 트랜잭션이 끝날 때 풀린다. */
export async function manualSpamInProgressInTx(run: SqlRun, userId: string): Promise<string | null> {
  await run(SPAM_TEST_USER_LOCK_SQL, [userId]);
  const r = await run(MANUAL_SPAM_IN_PROGRESS_SQL, [userId]);
  return r.rows[0]?.id ? String(r.rows[0].id) : null;
}
/** 검사 직전 발신번호 = 그 사용자가 쓸 수 있는 등록 번호(배정 범위 포함 · 발송 길과 같은 집합) */
export async function isManualSpamCallbackAllowed(companyId: string, userId: string, callback: string): Promise<boolean> {
  return (await getRegisteredCallbackSet(companyId, userId)).has(normalizePhone(String(callback || '')));
}

/** 검사 한 건을 읽어 지금 결과 + 통신사별 행(spamTestOutcomeOf) */
export async function readSpamTestOutcome(testId: string, run: SqlRun = query): Promise<{ outcome: SpamVerdict; carrierResults: Array<{ carrier: string; messageType: string; result: string | null }> }> {
  const t = await run(`SELECT status FROM spam_filter_tests WHERE id = $1`, [testId]);
  const rows = await run(`SELECT carrier, message_type, result FROM spam_filter_test_results WHERE test_id = $1 ORDER BY carrier, message_type`, [testId]);
  const carrierResults = rows.rows.map((r: any) => ({ carrier: String(r.carrier), messageType: String(r.message_type), result: r.result ?? null }));
  return { outcome: t.rows[0] ? spamTestOutcomeOf(String(t.rows[0].status), carrierResults) : 'error', carrierResults };
}

/** 같은 검사 키의 트랜잭션 잠금 이름(등록 함수 한 곳만 잡는다) */
export function spamCheckLockKey(k: SpamCheckKey): string {
  return `spam-check:${k.companyId}:${String(k.callback || '').replace(/\D/g, '')}:${k.hash}:${k.msgType}:${k.subject ?? ''}`;
}

/** 같은 검사의 키 — 회사 · 회신번호(숫자만) · 치환 뒤 발송 꼴 글 해시 · 유형(SMS · LMS) · 제목 */
export interface SpamCheckKey {
  companyId: string;
  callback: string;
  hash: string;
  msgType: 'SMS' | 'LMS';
  subject: string | null;
}

/**
 * ★ 2026-11-01 B1-4(J15 · Codex 설계 1R #1) — 같은 키 · 같은 한국 날짜의 가장 최근 검사와 그 지금 결과. 없으면 null.
 *   부르는 쪽: 진행 중 · 확인 중 = 새로 걸지 않고 기다림 · 통과 · 차단 = 재사용 · 장애 = 새 검사(장애 재시도 상한은 부르는 쪽 기존 규칙).
 *   ⛔ 날짜를 넘기면 새 검사(통신사 필터는 날마다 바뀐다) · 제목을 모르는 옛 장문 검사는 재사용에서 빠진다(IS NOT DISTINCT FROM).
 */
export async function spamCheckFor(k: SpamCheckKey, run: SqlRun = query, windowDays?: number): Promise<{ testId: string; status: string; createdAt: Date; outcome: SpamVerdict } | null> {
  if (!k.hash) return null;
  // ★ 2026-11-02 엔진 재설계 E3-2 — 재사용 창 = 기본 그날(지금 그대로 · 점검 판 엿보기 · AI 한줄로 · 자동마케팅) · 여정 정기 재검사만 N일(SC-25)
  const since = windowDays && windowDays > 1 ? `(${KST_TODAY_START_SQL} - INTERVAL '${Math.floor(windowDays) - 1} days')` : KST_TODAY_START_SQL;
  const found = await run(
    `SELECT t.id, t.status, t.created_at FROM spam_filter_tests t
      WHERE t.company_id = $1 AND REPLACE(t.callback_number, '-', '') = $2 AND t.message_hash = $3
        AND t.created_at >= ${since}
        AND t.subject IS NOT DISTINCT FROM $5
        AND EXISTS (SELECT 1 FROM spam_filter_test_results r WHERE r.test_id = t.id AND r.message_type = $4)
      ORDER BY t.created_at DESC LIMIT 1`,
    [k.companyId, String(k.callback || '').replace(/\D/g, ''), k.hash, k.msgType, k.subject || null],
  );
  const t = found.rows[0];
  if (!t) return null;
  const { outcome } = await readSpamTestOutcome(String(t.id), run);
  return { testId: String(t.id), status: String(t.status), createdAt: t.created_at, outcome };
}

// ============================================================
// [1] 큐에 스팸 테스트 등록
// ============================================================
/**
 * 첫 수신자를 주지 않은 검사의 기본 고객(치환 · 해시 기준) — 등록 함수에서 원형 이동(★ 2026-10-18 · AI 한줄로 재사용 해시가 같은 고객을 보게).
 * ★ 미리보기와 동일한 정렬 (name ASC) — recommend-target의 샘플 고객과 일치 보장
 * ★ 2026-09-22 브랜드 격리: 테스트 주체가 분류코드 사용자면 자기 코드 고객에서만(CT-02 경유 · 빈 조각이면 종전 SQL 그대로)
 */
export async function loadDefaultSpamFirstRecipient(companyId: string, userId: string, fieldMappings: Record<string, any>): Promise<Record<string, any>> {
  const mappingCols = Object.values(fieldMappings).filter((m: any) => m.storageType !== 'custom_fields').map((m: any) => m.column);
  const selectCols = [...new Set(['phone', 'custom_fields', ...mappingCols])].join(', ');
  const sampleScope = await getSampleCustomerScope(companyId, userId, { paramIndex: 2 });
  const firstResult = await query(
    `SELECT ${selectCols} FROM customers WHERE company_id = $1 AND is_active = true AND sms_opt_in = true${sampleScope.where} ORDER BY name ASC NULLS LAST LIMIT 1`,
    [companyId, ...sampleScope.params]
  );
  return firstResult.rows[0] || {};
}

/** ★ 2026-11-06 C109 P5 — 표본 값 사본의 문자열 값을 cleanSmsTextAll(객체 · 배열 값은 그대로 · 원본 객체는 바꾸지 않는다) */
export function cleanSpamSampleValues<T extends Record<string, any>>(sample: T): T {
  // ★ Codex 구현 1R #3 — 안쪽까지(custom_fields JSONB 처럼 치환이 안쪽 값을 읽는 칸) · 배열 · 일반 객체만 내려간다(날짜 등 다른 객체는 그대로) · 원본 불변(사본)
  const deep = (v: unknown): unknown => {
    if (typeof v === 'string') return cleanSmsTextAll(v);
    if (Array.isArray(v)) return v.map(deep);
    if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
      const o: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[k] = deep(x);
      return o;
    }
    return v;
  };
  return deep(sample || {}) as T;
}

/** ★ 2026-11-06 C109(Codex 설계 4R) — 렌더가 끝난 검사의 표식(spam_filter_tests.first_recipient 한 키 · 쓰기 · 읽기 = 이 파일만) */
export const RENDERED_SAMPLE_MARK = '__c109_rendered';
export function isRenderedSample(firstRecipient: unknown): boolean {
  return !!firstRecipient && typeof firstRecipient === 'object' && (firstRecipient as any)[RENDERED_SAMPLE_MARK] === true;
}

/** ★ 2026-11-06 C109 — 큐 등록 실패의 판정(순수 · 글자 반려 = rejected · 그 밖 = failed = 검사 장애) */
export function enqueueFailureVerdict(errorCode: string | undefined): 'rejected' | 'failed' {
  return errorCode === 'SMS_UNSUPPORTED_CHARS' ? 'rejected' : 'failed';
}

/** ★ 2026-11-06 C109 — 글자 반려 문장 머리 · 기본 문장(사유가 비면) · 위치 읽기(쓰기 = enqueueSpamTest · 읽기 = 이 함수 · 한 파일) */
export const SPAM_REJECTED_PREFIX = '문자로 보낼 수 없는 글자가 있어 검사하지 않았어요';
export const SPAM_REJECTED_DEFAULT_TEXT = `${SPAM_REJECTED_PREFIX}.`;
export function spamRejectionPlaces(rejection: string | null | undefined): string {
  const r = String(rejection || '');
  return r.startsWith(`${SPAM_REJECTED_PREFIX}: `) ? r.slice(SPAM_REJECTED_PREFIX.length + 2).trim() : '';
}

/** 검사 등록과 같은 치환 · 해시 · 같은 검사 키(★ 2026-11-01 배포 2 C5 — 등록 함수에서 원문 그대로 옮김 · 점검 응답의 엿보기도 이것을 쓴다) */
async function spamHashInputsOf(params: Pick<SpamTestEnqueueParams, 'companyId' | 'userId' | 'callbackNumber' | 'messageContentSms' | 'messageContentLms' | 'messageType' | 'subject' | 'firstRecipient' | 'rendered'>) {
  const { companyId, userId, callbackNumber, messageContentSms, messageContentLms, messageType, subject, firstRecipient: clientFirstRecipient, rendered } = params;
  // 1) 메시지 해시 계산 (변수 치환 후)
  const isLmsType = messageType === 'LMS' || messageType === 'MMS';
  const rawContent = isLmsType ? (messageContentLms || '') : (messageContentSms || '');

  // ★ D102: prepareFieldMappings 컨트롤타워로 통합
  const fieldMappings = await prepareFieldMappings(companyId);

  let firstCustomer: Record<string, any>;
  if (clientFirstRecipient && typeof clientFirstRecipient === 'object' && Object.keys(clientFirstRecipient).length > 0) {
    firstCustomer = clientFirstRecipient;
  } else {
    firstCustomer = await loadDefaultSpamFirstRecipient(companyId, userId, fieldMappings);
  }
  // ★ 2026-11-06 C109 P5 — 검사 입력에 치환해 넣는 값(표본 고객 · 주소록 칸)의 보낼 수 없는 글자는 검사 전에 정리한 사본(문안 글자는 그대로 = 문안 문제는 반려로 보인다)
  firstCustomer = cleanSpamSampleValues(firstCustomer);

  // ★ D92: %회신번호% 치환 — callbackNumber를 addressBookFields로 전달하여 스팸테스트에서도 맵핑
  const spamAddressBookFields = callbackNumber ? cleanSpamSampleValues({ callback: callbackNumber, extra1: '', extra2: '', extra3: '', name: '' }) as { callback: string; extra1: string; extra2: string; extra3: string; name: string } : undefined;
  // ★ 2026-11-06 C109(Codex 설계 4R) — 렌더가 끝난 글은 다시 치환하지 않는다(지문 = 받은 글 그대로)
  const personalizedForHash = rendered ? rawContent : replaceVariables(rawContent, firstCustomer, fieldMappings, spamAddressBookFields);
  const messageHash = computeMessageHash(personalizedForHash);
  const key: SpamCheckKey | null = messageHash
    ? { companyId, callback: callbackNumber, hash: messageHash, msgType: isLmsType ? 'LMS' : 'SMS', subject: (isLmsType ? subject : '') || null }
    : null;
  return { isLmsType, fieldMappings, firstCustomer, spamAddressBookFields, messageHash, key };
}

/**
 * 같은 글의 오늘 검사를 **엿본다**(등록 · 차감 0 · ★ 2026-11-01 배포 2 C5 점검 응답).
 *   null = 오늘 같은 키 검사 없음(검사 전) · 그 밖 = 그 검사의 지금 결과(장애도 그대로 — 부르는 쪽이 「다시 검사」로 읽는다).
 */
export async function peekSpamCheck(params: Pick<SpamTestEnqueueParams, 'companyId' | 'userId' | 'callbackNumber' | 'messageContentSms' | 'messageContentLms' | 'messageType' | 'subject' | 'firstRecipient' | 'rendered'>): Promise<{ testId: string; outcome: SpamVerdict; status: string; createdAt: Date } | null> {
  const { key } = await spamHashInputsOf(params);
  const same = key ? await spamCheckFor(key) : null;
  // ★ 2026-11-05 C103 F1 — 상태 · 만든 시각 = 공용 보기(spamCheckView) 입력(여정 칸 검사 창)
  return same ? { testId: same.testId, outcome: same.outcome, status: same.status, createdAt: same.createdAt } : null;
}

export async function enqueueSpamTest(params: SpamTestEnqueueParams): Promise<SpamTestEnqueueResult> {
  const {
    companyId, userId, callbackNumber,
    messageContentSms, messageContentLms, messageType, subject,
    source = 'manual', variantId, batchId, skipPrepaid = false, reuseSameDay = false, reuseDays, manualAdmission, rendered = false,
  } = params;

  try {
    const hashed = await spamHashInputsOf(params);
    const { isLmsType, fieldMappings, firstCustomer, spamAddressBookFields, messageHash } = hashed;

    // ★ 2026-11-01 B1-4(J15) — 같은 키 · 같은 날 검사가 진행 중 · 확인 중 · 통과 · 차단이면 그 검사를 이어 본다(새 검사 · 차감 0)
    //   여기는 빠른 길(잠금 없음) · 동시에 같은 키 둘이 「없음」을 보면 아래 트랜잭션이 키 잠금 아래에서 다시 찾는다(Codex 구현 1R #1 · 이중 차감 0)
    const checkKey: SpamCheckKey | null = reuseSameDay ? hashed.key : null;
    const reusable = async (run?: SqlRun) => {
      const same = checkKey ? await spamCheckFor(checkKey, run, reuseDays) : null;
      return same && same.outcome !== 'error' ? same : null;
    };
    const early = await reusable();
    if (early) {
      console.log(`[SpamTestQueue] 같은 검사 이어 보기 — testId=${early.testId}, outcome=${early.outcome}, source=${source}`);
      return { ok: true, testId: early.testId, reused: true };
    }
    // ★ 2026-11-05 C103 F1 — 사람이 누른 새 검사 = 그 사용자가 쓸 수 있는 등록 발신번호만(수동 검사 주소와 같은 CT · 이어 보기는 결과 보기라 거치지 않는다)
    if (manualAdmission && !(await isManualSpamCallbackAllowed(companyId, manualAdmission.userId, callbackNumber))) {
      return { ok: false, errorCode: 'UNREGISTERED_CALLBACK', error: '등록된 발신번호로만 스팸 검사를 할 수 있어요. 발신번호 관리에서 확인해 주세요.' };
    }

    // 2) 디바이스 조회 + 발송 건수 계산
    const devices = await query(
      `SELECT id, carrier, phone FROM spam_filter_devices WHERE is_active = true ORDER BY carrier`
    );
    if (devices.rows.length === 0) {
      return { ok: false, error: '지금은 스팸 검사를 할 수 없습니다. 관리자에게 문의하세요.', errorCode: 'NO_TEST_DEVICE' };
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
      // ★ 2026-11-06 C109 — 렌더가 끝난 글 = 그대로(워커 발송과 같은 글)
      rendered ? ((t === 'SMS' ? messageContentSms : messageContentLms) || '') : replaceVariables((t === 'SMS' ? messageContentSms : messageContentLms) || '', firstCustomer, fieldMappings, spamAddressBookFields),
      t === 'LMS' || t === 'MMS' ? (subject || '') : '',
    ]);
    const unsupportedChars = unsupportedSmsCharCodes(...outgoingTexts);
    if (unsupportedChars.length > 0) {
      // ★ 2026-11-06 C109 D2 — 글자 목록 · 위치를 문장에 싣는다(P4 · 옛: 목록을 세고도 버렸다)
      const where: string[] = [];
      outgoingTexts.forEach((txt, i) => {
        if (!txt) return;
        const sc = scanSmsText(txt);
        where.push(...describeSmsCharFindings(sc.findings, { multiline: sc.multiline, where: i % 2 === 1 ? '제목' : undefined, max: 5 }));
      });
      return {
        ok: false,
        error: `${SPAM_REJECTED_PREFIX}: ${[...new Set(where)].join(', ')}`,
        errorCode: 'SMS_UNSUPPORTED_CHARS',
        unsupportedChars,
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
      // ★ 2026-11-05 C103 F1 — 사람이 누른 검사 = 사용자 잠금 → 진행 중 1건 확인(키 잠금 · 회사 잠금보다 먼저 · 이 길만 사용자 잠금을 잡는다)
      if (manualAdmission) {
        const busy = await manualSpamInProgressInTx((sql, p) => client.query(sql, p), manualAdmission.userId);
        if (busy) {
          await client.query('ROLLBACK');
          return { ok: false, testId: busy, errorCode: 'MANUAL_IN_PROGRESS', error: '이미 진행 중인 스팸 검사가 있어요. 끝난 뒤 다시 눌러 주세요.' };
        }
      }
      if (checkKey) {
        // 같은 키 = 트랜잭션 잠금 하나(회사 잠금보다 먼저 · 같은 키를 잡는 길은 이 순서 하나) → 앞 요청이 커밋한 검사를 다시 찾는다
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [spamCheckLockKey(checkKey)]);
        // 다시 찾기 = 이 연결로(잠금을 쥔 채 풀에서 연결을 더 기다리지 않는다 · READ COMMITTED = 앞 요청이 커밋한 검사가 보인다)
        const late = await reusable((sql, params) => client.query(sql, params));
        if (late) {
          await client.query('ROLLBACK');
          console.log(`[SpamTestQueue] 같은 검사 이어 보기(잠금 뒤) — testId=${late.testId}, outcome=${late.outcome}, source=${source}`);
          return { ok: true, testId: late.testId, reused: true };
        }
      }
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
         // ★ 2026-11-06 C109 — 렌더가 끝난 글 = 표식(워커가 다시 치환하지 않는다) · 그 밖 = 표본 고객(정리된 사본)
         rendered ? JSON.stringify({ [RENDERED_SAMPLE_MARK]: true }) : (firstCustomer && Object.keys(firstCustomer).length > 0 ? JSON.stringify(firstCustomer) : null)]
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
  let alertCompanyId: string | null = null;   // 경보의 회사(검사 한 건 = 회사 하나 · 조회 전 실패 = 모름 = null)
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
      alertCompanyId = String(row.company_id);
      const res = await prepaidRefund(String(row.company_id), failed, String(row.message_type), testId, '스팸 검사 발송 실패 환불', 'spam', { refundKey: REFUND_KEYS.FAIL });
      if (!res.ok) throw new Error(`환불 미완(${row.message_type} ${failed}건)`);
    }
  } catch (e: any) {
    console.error(`[SpamTest] 발송 실패 환불 미완 testId=${testId}:`, e?.message || e);
    void sendSystemAlert({
      companyId: alertCompanyId,
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
 * ★ 2026-10-18 AI 한줄로 자동 검사 칩(설계서 docs/2026-10-18-ai-line-design.md §7) — 큐 검사의 실행 시작 시각(없으면 null = 등록 시각으로 읽는다).
 *   운영은 단일 프로세스(PM2 instances 1)라 API 와 워커가 같은 기록을 본다 → 시작 시각 칸(DDL) 없이 칩 · 정리 · 판정이 같은 시각을 쓴다.
 */
export function spamTestStartedAtMs(testId: string): number | null {
  return _activatedAt.get(testId) ?? null;
}

/**
 * ★ 2026-11-05 C103 F1(Codex 구현 1R) — 검사가 돈 시간 = 실행 시작(줄에서 나온 때) 기준 · 기록 없으면 등록 시각(즉시 실행 검사 · 재기동 뒤).
 *   만료 판정은 모두 이 값으로(멈춘 검사 정리 · 진행 중 검사 복원 · 검사 상세). 옛: 두 주소가 등록 시각으로 따로 재서 줄에서 기다린 검사를 실행 직후 끝냈다.
 */
export function spamTestRunElapsedMs(testId: string, createdAt: string | Date, now: number = Date.now()): number {
  return now - (_activatedAt.get(String(testId)) ?? new Date(createdAt).getTime());
}

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
    if (spamTestRunElapsedMs(id, r.created_at, now) > thresholdMs) staleIds.push(id);
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

/**
 * ★ 2026-11-02 엔진 재설계 E2-4 — 다음 검사 고르기(순수 함수 · 한 번에 한 검사 그대로).
 *   ① 줄 = 사람이 기다리는 검사(manual · trial = 0) · 그 밖 자동(1) · 사람 줄을 3건 연달아 꺼냈으면 다음 한 건은 자동 줄(자동 줄 굶김 0)
 *   ② 줄 안 = 회전 커서(마지막으로 꺼낸 회사 다음 회사 · 회사 id 순 · 끝이면 처음)의 가장 오래된 검사 · 커서 = 줄마다 하나.
 *   heads = (줄 · 회사)마다 가장 오래된 queued 한 건.
 */
export interface SpamQueueHead { id: string; companyId: string; lane: 0 | 1 }
export interface SpamQueueCursor { lastCompany: [string | null, string | null]; humanStreak: number }
export const SPAM_HUMAN_STREAK_MAX = 3;
export function pickNextSpamTest(heads: readonly SpamQueueHead[], cursor: SpamQueueCursor): { pick: SpamQueueHead | null; cursor: SpamQueueCursor } {
  const human = heads.filter((h) => h.lane === 0);
  const auto = heads.filter((h) => h.lane === 1);
  const lane: 0 | 1 | null = human.length > 0 && (cursor.humanStreak < SPAM_HUMAN_STREAK_MAX || auto.length === 0) ? 0 : auto.length > 0 ? 1 : null;
  if (lane === null) return { pick: null, cursor };
  const list = (lane === 0 ? human : auto).slice().sort((a, b) => (a.companyId < b.companyId ? -1 : a.companyId > b.companyId ? 1 : 0));
  const last = cursor.lastCompany[lane];
  const pick = (last ? list.find((h) => h.companyId > last) : undefined) ?? list[0];
  const lastCompany: [string | null, string | null] = [...cursor.lastCompany];
  lastCompany[lane] = pick.companyId;
  return { pick, cursor: { lastCompany, humanStreak: lane === 0 ? cursor.humanStreak + 1 : 0 } };
}
/** (줄 · 회사)마다 가장 오래된 queued 한 건 */
export async function spamQueueHeads(): Promise<SpamQueueHead[]> {
  const r = await query(
    `SELECT DISTINCT ON (lane, company_id) id, company_id, lane
       FROM (SELECT id, company_id, created_at,
                    CASE WHEN source IN ('manual', 'trial') THEN 0 ELSE 1 END AS lane
               FROM spam_filter_tests WHERE status = 'queued') q
      ORDER BY lane, company_id, created_at ASC, id ASC`
  );
  return r.rows.map((x: any) => ({ id: String(x.id), companyId: String(x.company_id), lane: Number(x.lane) === 0 ? 0 : 1 }));
}
/** 큐 워커 커서(워커 한 곳 · 재시작 = 처음부터 · 굶김 아님) */
let _spamQueueCursor: SpamQueueCursor = { lastCompany: [null, null], humanStreak: 0 };
/** 시험 전용. */
export function resetSpamQueueCursor(): void { _spamQueueCursor = { lastCompany: [null, null], humanStreak: 0 }; }

/** ★ 2026-11-02 엔진 재설계 E9 ③ — 가장 오래 기다린 검사가 이 분을 넘으면 운영 경보(1분에 한 번만 본다) */
export const SPAM_QUEUE_LAG_ALERT_MINUTES = 30;
let _lastLagCheckAt = 0;
async function checkSpamQueueLag(): Promise<void> {
  if (Date.now() - _lastLagCheckAt < 60_000) return;
  _lastLagCheckAt = Date.now();
  const r = await query(
    `SELECT COUNT(*)::int AS n, EXTRACT(EPOCH FROM (NOW() - MIN(created_at)))::int AS lag_s FROM spam_filter_tests
      WHERE status = 'queued' AND created_at <= NOW() - INTERVAL '${SPAM_QUEUE_LAG_ALERT_MINUTES} minutes'`,
  );
  const n = Number(r.rows[0]?.n || 0);
  if (n > 0) {
    void sendSystemAlert({
      companyId: null, dedupKey: 'spam-queue-lag', cooldownMs: 60 * 60 * 1000,
      message: `스팸 검사 줄이 밀리고 있습니다. ${SPAM_QUEUE_LAG_ALERT_MINUTES}분 넘게 기다린 검사 ${n}건 · 가장 오래된 것 ${Math.round(Number(r.rows[0]?.lag_s || 0) / 60)}분(시험 폰 상태 확인).`,
    }).catch(() => undefined);
  }
}

export async function processSpamTestQueue(): Promise<void> {
  if (queueWorkerRunning) return; // 중복 실행 방지
  queueWorkerRunning = true;

  try {
    await checkSpamQueueLag().catch((e: any) => console.warn('[SpamTestQueue] 밀림 확인 실패:', e?.message || e));
    // ★ 2026-09-26 F45·F46 — 멈춘 active 정리를 **먼저** 한다(옛: active가 있으면 반환 → 이 정리에 닿지 못함).
    await cleanupStaleActiveTests(TIMEOUTS.spamFilterSafety);

    // 현재 active인 테스트가 있는지 확인
    const activeTest = await query(
      `SELECT id FROM spam_filter_tests WHERE status = 'active' LIMIT 1`
    );
    if (activeTest.rows.length > 0) {
      return; // 실행 중인 테스트 있음 → 대기
    }

    // ★ 2026-11-02 엔진 재설계 E2-4 — 다음 검사 = 줄 + 회사 돌아가며(옛: created_at FIFO 한 줄 · 한 회사 1,000건 뒤에 다른 회사 1건이 줄 섰다)
    const picked = pickNextSpamTest(await spamQueueHeads(), _spamQueueCursor);
    if (!picked.pick) return; // 큐 비어있음
    const nextTest = await query(
      `SELECT id, company_id, user_id, callback_number,
              message_content_sms, message_content_lms, source
       FROM spam_filter_tests
       WHERE id = $1::uuid AND status = 'queued'`,
      [picked.pick.id],
    );
    if (nextTest.rows.length === 0) return; // 그사이 취소 · 정리 = 다음 회차
    _spamQueueCursor = picked.cursor;

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
      // ★ 2026-11-06 C109 — 렌더가 끝난 검사 = 받은 글 그대로(재치환 0 · 지문 · 입구 판정과 같은 글)
      const content = isRenderedSample(test.first_recipient) ? (rawContent || '') : replaceVariables(rawContent || '', firstCustomer, fieldMappings, testAddressBookFields);
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
                // ★ 2026-11-01 B1-4 — 차단이 아니라 「확인 중」(전달 성공 + 보고 없음 · 확인 문자가 차단 · 장애를 가른다)
                result = deliveredUnreportedResult();
                console.log(`[SpamTestQueue] UNCONFIRMED — testId=${testId}, phone=${row.phone}, grace=${graceMs}ms, 시작 뒤 ${Math.round((Date.now() - activatedAt) / 1000)}초`);
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
              const w = await decideSpamResult(result, row.id);
              if (w > 0 && result === SPAM_RESULT.FAILED) wroteFailed = true;
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
            // ★ 2026-11-01 B1-4 — 전달 성공 + 보고 없음 = 확인 중(공용 판정) · 통신사 결과조차 없음 = 시간 초과
            const finalResult = qtmsgSuccessTime.has(rowKey) ? deliveredUnreportedResult() : SPAM_RESULT.TIMEOUT;
            await decideSpamResult(finalResult, row.id);
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
        void sendSystemAlert({ companyId: refundCompanyId, dedupKey: `spam-refund-miss:${testId}`, message: `스팸 검사(큐) 발송 실패 환불 미완 — test=${testId} 수동 확인 필요` }).catch(() => undefined);
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
    let overallResult: 'pass' | 'blocked' | 'failed' | 'timeout' | 'pending' | 'unconfirmed' = 'pending';
    if (test.status === 'completed' || test.status === 'active') {
      const allResults = carrierResults.map(r => r.result).filter(Boolean);
      // ★ 2026-09-26 한줄로 V2 F48 — 판정 대기(NULL) 통신사를 버리지 않는다. 차단 판정은 유예(수십 초) 뒤라 통과 리포트(수 초)보다
      //   늘 늦어, 대기를 버리면 한 곳만 통과해도 전체 pass였다(한 통신사만 막는 문안 = 스팸 검사가 잡아야 할 경우).
      //   대기가 남으면: 진행 중 = pending · 완료 = timeout(통과 아님). 차단이 이미 있으면 그대로 blocked.
      const hasUnjudged = carrierResults.some(r => !r.result);
      if (allResults.some(r => r === SPAM_RESULT.BLOCKED)) {
        overallResult = 'blocked';
      } else if (allResults.some(r => r === SPAM_RESULT.UNCONFIRMED)) {
        // ★ 2026-11-01 B1-4 — 확인 중 행이 있으면 묶음도 확인 중(차단 · 통과 아님 · 확인 문자가 닫는다)
        overallResult = 'unconfirmed';
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
      } else {
        overallResult = 'failed';   // ★ 2026-11-01 B1-4 — 그 밖의 값(검사폰 확인 불가 error) = 검사 장애(통과 · 대기 아님)
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
          } else if (allResults.some(r => r === SPAM_RESULT.UNCONFIRMED)) {
            resolve('unconfirmed');   // ★ 2026-11-01 B1-4
          } else if (allResults.some(r => r === SPAM_RESULT.FAILED)) {
            resolve('failed');
          } else if (allResults.some(r => r === SPAM_RESULT.TIMEOUT)) {
            resolve('timeout');
          } else if (allResults.length > 0 && allResults.every(r => r === SPAM_RESULT.PASS)) {
            resolve('pass');
          } else {
            resolve('failed');   // ★ 2026-11-01 B1-4 — 통과는 전부 pass 일 때만(결과 0행 · 새 값 = 장애)
          }
          return;
        }

        if (Date.now() - startTime > timeoutMs) {
          clearInterval(checkInterval);
          // ★ 2026-11-01 B1-4 — 기다림 만료 = 검사가 아직 진행 중(장애 아님) · 다음 회차에 같은 키로 이어 본다(spamCheckFor)
          resolve('pending');
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

type AutoSpamVerdict = 'pass' | 'blocked' | 'failed' | 'timeout' | 'unconfirmed' | 'pending' | 'rejected';   // ★ 2026-11-06 C109 rejected = 검사 입구 글자 반려(장애 아님)

/**
 * 검사 판정(★ 2026-11-01 여정 재발 방지 B1-4 · 옛 3분할에 둘을 더함) — 통과 · 확인 중 · 기다림 · 차단 · 검사 장애.
 *   unconfirmed = 통신사 전달 성공 + 앱 보고 없음(확인 문자가 차단 · 장애를 가른다) · pending = 같은 글의 오늘 검사가 아직 진행 중(같은 검사 이어 보기).
 *   ⛔ 두 값 모두 자동 행동 0(재작성 · 정지 · 차감 · 발송 없음) · 장애 횟수에 세지 않는다 · 다음 회차에 같은 글로 다시 묻는다.
 *   부르는 쪽은 switch + never 로 다섯 값을 모두 받는다(새 값이 생기면 tsc 가 빠진 자리를 잡는다).
 */
export type SpamVerdict = 'pass' | 'unconfirmed' | 'pending' | 'blocked' | 'rejected' | 'error';   // ★ 2026-11-06 C109 rejected(뿌리 R7 넓힘)

/** 기다림 판정(확인 중 · 검사 중) — 자동 행동 0 갈래. 부르는 쪽은 이 갈래를 따로 받고, 통과 갈래 앞에 `satisfies` 로 남김없이 받았는지 tsc 에 맡긴다. */
export function isSpamHold(v: SpamVerdict): v is 'pending' | 'unconfirmed' {
  return v === 'pending' || v === 'unconfirmed';
}

/** 판정 값의 사람 말(서버 문장 · 기록) — Record 라 새 값이 생기면 tsc 가 빈 칸을 잡는다 */
export const SPAM_VERDICT_WORD: Record<SpamVerdict, string> = {
  pass: '통과', unconfirmed: '확인 중', pending: '검사 중', blocked: '차단', rejected: '보낼 수 없는 글자', error: '검사 못 함',
};

/** ★ 2026-11-06 C109 — 반려 문장 읽기 CT(호출부가 같은 말을 쓴다 · P4 · 반려가 아니면 null) */
export function spamRejectionOf(v: { spamResult?: string | null; rejection?: string | null } | null | undefined): string | null {
  if (!v || v.spamResult !== 'rejected') return null;
  return (typeof v.rejection === 'string' && v.rejection.trim()) ? v.rejection : SPAM_REJECTED_DEFAULT_TEXT;
}

/**
 * ★ 2026-11-06 C109(Codex 설계 2R #5 · 1R #6 같은 부류 둘째) — 판정 결과를 JSON 에 저장 · 복원하는 한 값.
 *   왜: 사유를 판정 옆 옵션 칸으로 덧붙이면 저장 자리마다 손으로 옮겨야 하고 한 자리만 빠져도 사라진다 → 판정 + 사유를 한 값으로.
 */
export type SpamCheckRecord =
  | { result: Exclude<AutoSpamVerdict, 'rejected'>; rejection?: undefined }
  | { result: 'rejected'; rejection: string };
/** 쓰기 CT — 결과 안(variant) · 판정 문자열에서 */
export function toSpamCheckRecord(v: { spamResult?: string | null; rejection?: string | null } | string | null | undefined): SpamCheckRecord {
  const raw = typeof v === 'string' ? v : String(v?.spamResult || 'failed');
  if (raw === 'rejected') return { result: 'rejected', rejection: spamRejectionOf(typeof v === 'string' ? { spamResult: 'rejected' } : (v as any)) as string };
  const known: ReadonlyArray<string> = ['pass', 'blocked', 'failed', 'timeout', 'unconfirmed', 'pending'];
  return { result: (known.includes(raw) ? raw : 'failed') as Exclude<AutoSpamVerdict, 'rejected'> };
}
/** 읽기 CT — 옛 문자열 값 · 옛 객체 · 새 값 모두(반려인데 사유 없음 = 기본 문장) */
export function readSpamCheckRecord(json: unknown): SpamCheckRecord | null {
  if (json == null || json === '') return null;
  if (typeof json === 'string') return toSpamCheckRecord(json);
  if (typeof json === 'object') {
    const o = json as any;
    const raw = typeof o.result === 'string' ? o.result : typeof o.spamResult === 'string' ? o.spamResult : null;
    if (!raw) return null;
    return toSpamCheckRecord({ spamResult: raw, rejection: o.rejection ?? null });
  }
  return null;
}

/**
 * ★ 2026-10-24 검사 판정 한 곳(뿌리 대장 R7 · 1018 플래너 B6 판정을 공용으로 · docs/ROOT-LEDGER.md) — 순수.
 *   pass    = 판정 통과 + 통신사 결과 1개 이상 + 그 결과에 시간 초과 · 실패 · 빈 값 0(시연 회사 = 검사 0건 통과 = 그대로 통과)
 *   blocked = 통신사가 막았다(진짜 스팸)
 *   error   = 그 밖(큐 등록 실패 · 시간 초과 · 결과 0행 · 결과 NULL) — 검사 장비 문제다. **통과도 차단도 아니다.**
 * 옛: 대행발송 · 옛 자동발송이 「차단이 아니면 통과」로 읽어, 검사가 못 돈 문안이 나갔다(B-0823-1 가).
 */
export function spamVerdictOf(
  v: { spamResult?: string | null; carrierResults?: Array<{ result?: string | null }> | null } | null | undefined,
  totalTestCount: number,
): SpamVerdict {
  if (!v) return 'error';
  // ★ 2026-11-06 C109 — 검사 입구 글자 반려 = 장애가 아니다(다시 검사 0 · 사람이 그 글자를 고친다 · 뿌리 R7 넓힘)
  if (v.spamResult === 'rejected') return 'rejected';
  if (v.spamResult === 'blocked') return 'blocked';
  if (v.spamResult === 'unconfirmed') return 'unconfirmed';   // ★ 2026-11-01 B1-4
  if (v.spamResult === 'pending') return 'pending';
  if (v.spamResult !== 'pass') return 'error';
  if (Number(totalTestCount) === 0) return 'pass';   // 시연 회사 — 검사 발송 0(아래 절단점)
  const results = Array.isArray(v.carrierResults) ? v.carrierResults : [];
  if (results.length === 0) return 'error';
  if (results.some((r) => r?.result === 'unconfirmed')) return 'unconfirmed';
  // ★ 2026-11-01 B1-4 — 통과 = 통신사 결과 전부 pass 일 때만(옛: 시간 초과 · 실패 · 빈 값만 장애로 골라 새 값 error 가 통과로 샜다)
  return results.every((r) => r?.result === 'pass') ? 'pass' : 'error';
}

/** 검사 장애 때 다시 검사하는 횟수 상한 · 사이 쉼(★ 2026-10-25 원장 #18 · #19) */
export const SPAM_ERROR_RETRY_MAX = 3;
const SPAM_ERROR_RETRY_WAIT_MS = 60_000;

/**
 * ★ 2026-10-25 원장 #18 · #19 — 검사 한 안을 판정 셋(spamVerdictOf)으로 끝내는 공용 꼴. 검사 장애(예외 · 결과 0 · 시간 초과)는
 *   통과도 차단도 아니다 → 쉬었다 다시 검사한다(상한 SPAM_ERROR_RETRY_MAX). 끝까지 장애면 'error'(부르는 쪽이 「검사를 못 함」으로 남긴다).
 *   옛: 자동마케팅 재검사 · 리마인드 검사가 원값(passedVariantId · spamResult === 'pass')을 읽어 검사 장애 한 번이 「스팸에 걸림」으로 굳었다.
 *   raw = 화면 기록용 원값(통과는 판정이 통과일 때만 'pass' · 장애는 'pass' 로 접지 않는다).
 */
export async function spamVerdictWithRetry(
  run: () => Promise<{ variants?: Array<any>; totalTestCount?: number; passedVariantId?: string | null } | null | undefined>,
  opts: { attempts?: number; waitMs?: number; label?: string } = {},
): Promise<{ verdict: SpamVerdict; raw: string; variant: any | null; attempts: number }> {
  const max = Math.max(1, opts.attempts ?? SPAM_ERROR_RETRY_MAX);
  let last: any = null;
  for (let i = 1; i <= max; i++) {
    let verdict: SpamVerdict = 'error';
    try {
      const r = await run();
      last = r?.variants?.[0] ?? null;
      verdict = spamVerdictOf(last, Number(r?.totalTestCount ?? 1));
    } catch (e: any) {
      console.warn(`[spam-verdict] ${opts.label || ''} 검사 장애 ${i}/${max}:`, e?.message || e);
      last = null;
    }
    if (verdict !== 'error') return { verdict, raw: verdict, variant: last, attempts: i };
    if (i < max) await new Promise((ok) => setTimeout(ok, opts.waitMs ?? SPAM_ERROR_RETRY_WAIT_MS));
  }
  const rawLast = String(last?.spamResult || '');
  return { verdict: 'error', raw: rawLast && rawLast !== 'pass' ? rawLast : 'failed', variant: last, attempts: max };
}

/**
 * ★ 2026-11-01 B1-4(Codex 구현 1R #3) — 대안 여럿(어느 하나만 통과하면 되는 안)의 판정 하나 · 차례 검사(sequenceSpamVariants)와 같은 뜻.
 *   통과 > 확인 중 > 검사 중 > 차단 > 장애 — 통과 안이 없어도 확인 중 · 검사 중인 안이 있으면 그 안이 아직 통과할 수 있다(정지 · 재작성 0).
 *   판 여럿을 모두 보내는 쪽(켜기 검증 · 보내기 전 검사)은 mergeSpamVerdicts(전부 통과일 때만 통과)를 쓴다.
 */
export function mergeAlternativeVerdicts(vs: readonly SpamVerdict[]): SpamVerdict {
  for (const v of ['pass', 'unconfirmed', 'pending', 'blocked', 'rejected'] as const) if (vs.includes(v)) return v;   // ★ C109 보낼 수 없는 글자 = 차단 다음 · 장애 앞
  return 'error';
}

/**
 * ★ 2026-10-03 안을 차례로 검사하고 첫 통과에서 멈춘다(순수 · 검사·재생성은 주입) — 임은지 접수
 * 「1안이 스팸에 걸리면 2안·3안을 자동으로 검사해 통과한 문안으로 승인 문자」.
 *   1) 원안을 순서대로 검사 → 통과한 안에서 멈춘다(그 뒤 안은 검사하지 않는다).
 *   2) 모두 통과하지 못했고 1안이 「차단」이었으면 1안을 재생성해 다시 검사한다(정책 횟수 · 통과하면 멈춤).
 *      결과 없음·검사 실패는 재생성하지 않는다(종전 규칙과 같다 · 재생성은 차단에만).
 *   3) 시간 예산(budgetMs)을 넘기면 새 검사를 시작하지 않는다 — 결과는 미통과 = 안 보내는 쪽.
 */
/** ★ 2026-11-06 C109 — 안 결과 하나 만들기(반려면 사유 필수 · 갈래 타입 한 곳) */
export function autoVariantResult(base: Omit<AutoSpamVariantResult, 'spamResult' | 'rejection'>, spamResult: AutoSpamVerdict, rejection?: string | null): AutoSpamVariantResult {
  if (spamResult === 'rejected') return { ...base, spamResult, rejection: spamRejectionOf({ spamResult, rejection }) as string };
  return { ...base, spamResult };
}

export async function sequenceSpamVariants(p: {
  variants: AutoSpamTestVariant[];
  maxRetries: number;
  runTest: (v: AutoSpamTestVariant, message: string, subject?: string) => Promise<{
    spamResult: AutoSpamVerdict; carrierResults: Array<{ carrier: string; messageType: string; result: string }>;
    /** ★ 2026-11-06 C109 — 반려(rejected) 문장(갈래 타입에 실어 돌려준다) */
    rejection?: string;
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
    out.push(autoVariantResult({
      variantId: v.variantId, messageText: v.messageText, subject: v.subject,
      carrierResults: r.carrierResults, regenerated: false, regenerateCount: 0,
    }, r.spamResult, r.rejection));
    if (r.spamResult === 'pass') return { variants: out, passedVariantId: v.variantId, regenerateCount: 0 };
    // ★ 2026-11-01 B1-4 — 기다림 · 확인 중 = 자동 행동 0(다음 안 검사 · 재생성 없음 · 다음 회차에 같은 글로 다시 묻는다)
    if (r.spamResult === 'pending' || r.spamResult === 'unconfirmed') return { variants: out, passedVariantId: null, regenerateCount: 0 };
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
      // ★ 2026-11-06 C109 — 판정 · 사유를 한 번에 바꾼다(갈래 타입)
      out[0] = autoVariantResult({ ...first, carrierResults: r.carrierResults }, r.spamResult, r.rejection);
      Object.assign(first, out[0]);
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
  /** ★ 2026-11-06 C109 — 렌더가 끝난 글(대행 표본) · 큐가 다시 치환하지 않는다 */
  rendered?: boolean;
}): Promise<AutoSpamTestResult> {
  const {
    companyId, userId, callbackNumber, messageType, subject,
    variants, isAd, rejectNumber, firstRecipient,
    regenerateCallback, maxRetries = MAX_REGENERATE_RETRIES,
  } = params;

  const batchId = crypto.randomUUID();
  const isLmsType = messageType === 'LMS' || messageType === 'MMS';

  // ★ 2026-10-09 시연 회사 = 실제 검사 발송 0 — 검사하지 않고 통과로 본다(자동마케팅 · 리마인드 · 화면 재검사 공통 · 발송은 경로 층에서 끝난다)
  if (await isDemoCompany(companyId)) {
    return {
      batchId,
      variants: variants.map((v) => autoVariantResult({ variantId: v.variantId, messageText: v.messageText, subject: v.subject, carrierResults: [], regenerated: false, regenerateCount: 0 }, 'pass')),
      ...(params.stopOnFirstPass ? { passedVariantId: variants[0]?.variantId ?? null } : {}),
      totalTestCount: 0,
      totalRegenerateCount: 0,
    };
  }

  const resultVariants: AutoSpamTestResult['variants'] = [];
  let totalTestCount = 0;
  let totalRegenerateCount = 0;
  const testIds: Record<string, string> = {};

  // 한 문안을 한 번 검사한다(광고 표기 · 큐 등록 · 완료 대기 · 통신사별 결과). 큐 등록 실패 = enqueued false.
  const runOneTest = async (variantId: string, message: string, subj?: string): Promise<{
    enqueued: boolean; spamResult: string; carrierResults: Array<{ carrier: string; messageType: string; result: string }>;
    /** ★ 2026-11-06 C109 — 글자 반려 문장(위치 포함) */
    rejection?: string;
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
      reuseSameDay: true, // ★ 2026-11-01 B1-4 — 같은 날 같은 글 = 이어 보기(대행 · 자동발송 · 상시 운영 · 플래너 공통)
      rendered: params.rendered === true,
    });

    if (!enqueueResult.ok) {
      // ★ 2026-11-06 C109 D3 — 글자 반려 = rejected(사유 그대로) · 그 밖 = failed(검사 장애) · 옛: 전부 failed = 「장비 문제」로 읽혔다
      const failVerdict = enqueueFailureVerdict(enqueueResult.errorCode);
      console.error(`[SpamTestQueue] variant ${variantId} 큐 등록 ${failVerdict === 'rejected' ? '반려(보낼 수 없는 글자)' : '실패'}:`, enqueueResult.error);
      return { enqueued: false, spamResult: failVerdict, carrierResults: [], ...(failVerdict === 'rejected' ? { rejection: enqueueResult.error } : {}) };
    }

    totalTestCount++;
    testIds[variantId] = enqueueResult.testId!;

    // 테스트 완료 대기
    const verdict = await waitForTestCompletion(enqueueResult.testId!);

    // 결과 조회
    const results = await query(
      `SELECT carrier, message_type, result FROM spam_filter_test_results
       WHERE test_id = $1 ORDER BY carrier, message_type`,
      [enqueueResult.testId]
    );
    const carrierResults = results.rows.map((r: any) => ({
      carrier: r.carrier,
      messageType: r.message_type,
      result: r.result || 'timeout',
    }));
    // ★ 2026-10-24 R7 — 통신사 결과가 비거나 시간 초과 · 실패가 섞인 「완료」는 통과가 아니다(검사 장애 = failed · 판정 자리 한 곳).
    //   옛: 그대로 pass 로 넘겨, 결과를 「차단이 아니면 통과」로 읽는 호출처(대행발송 · 옛 자동발송)와 통과 안 번호(자동마케팅)가 검사 못 한 문안을 통과로 봤다.
    const settled = spamVerdictOf({ spamResult: verdict, carrierResults }, 1);
    return {
      enqueued: true,
      spamResult: verdict === 'pass' && settled === 'error' ? 'failed' : verdict,
      carrierResults,
    };
  };

  if (params.stopOnFirstPass) {
    const seq = await sequenceSpamVariants({
      variants: variants.map((v) => ({ ...v, subject: v.subject || subject })),
      maxRetries,
      budgetMs: params.budgetMs,
      runTest: async (v, message, subj) => {
        const r = await runOneTest(v.variantId, message, subj);
        return { spamResult: r.spamResult as AutoSpamVerdict, carrierResults: r.carrierResults, rejection: r.rejection };
      },
      regenerate: regenerateCallback,
    });
    return {
      batchId,
      variants: seq.variants,
      totalTestCount,
      totalRegenerateCount: seq.regenerateCount,
      passedVariantId: seq.passedVariantId,
      testIds,
    };
  }

  for (const variant of variants) {
    let currentMessage = variant.messageText;
    let currentSubject = variant.subject || subject;
    let regenerateCount = 0;
    let spamResult: string = 'pending';
    let rejection: string | undefined;   // ★ 2026-11-06 C109 — 글자 반려 문장
    let carrierResults: Array<{ carrier: string; messageType: string; result: string }> = [];

    // 최대 재시도 횟수까지 반복
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const one = await runOneTest(variant.variantId, currentMessage, currentSubject);
      if (!one.enqueued) {
        // ★ 2026-11-06 C109 — 반려(rejected) · 장애(failed)를 가른다(옛: 전부 failed)
        spamResult = one.spamResult;
        rejection = one.rejection;
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

    resultVariants.push(autoVariantResult({
      variantId: variant.variantId,
      messageText: currentMessage,
      subject: currentSubject,
      carrierResults,
      regenerated: regenerateCount > 0,
      regenerateCount,
    }, spamResult as AutoSpamVerdict, rejection));
  }

  return {
    batchId,
    variants: resultVariants,
    totalTestCount,
    totalRegenerateCount,
    testIds,
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
