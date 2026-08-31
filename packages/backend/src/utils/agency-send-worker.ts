/**
 * agency-send-worker.ts — 대행발송 워커 (★ 2026-08-22 신설)
 *
 * 설계 = docs/2026-08-22-agency-send-design.md §4-4. 상태·시각 판정은 `agency-send-state.ts`가 소유한다.
 *
 * 다섯 단계를 5분마다 돈다:
 *   A 1차 검사   received          → 스팸 검사(최대 3회, 걸리면 다듬어 재검사) → 담당자 테스트 발송 → 승인 대기
 *   B 당일 재검사 approved(2h 전)   → 통과: 캠페인 + 큐 적재 / 차단: 안내 후 다듬기 → 재승인 대기
 *   C 만료       승인 대기(2h 경과) → 발송하지 않고 안내
 *   D 대조       queued            ↔ campaigns.status (이중 진실 안전망)
 *   E 복구       lock 30분 초과     → 잡기 전 상태로 되돌린다
 *   F 취소 마무리 cancelling        → 큐 삭제를 끝까지 밀고 cancelled로 확정
 *
 * ⛔ 큐 적재는 B에서 **한 번뿐**이다(불변 3). 승인은 상태만 바꾼다. 그래서 승인 뒤 취소에 지울 큐가 없다.
 * ⛔ 승인 없는 발송 0(불변 1) · 당일 검사 없는 발송 0(불변 2).
 *
 * ★ 2026-08-23 적재를 **직접발송 배관에 얹었다**(설계서 §12-1 정정). 전에는 이 파일이 캠페인 행을 만들고
 *   큐에 직접 넣었는데, 그 자리에서 배관의 계약이 통째로 빠져 있었다:
 *   선불 차감 0 · 후불 청구 축 0 · 수신거부 제외 0 · 부분 적재 롤백 0 · 재시도 멱등 0.
 *   지금은 `campaign_send_staging`에 넣고 `createDirectSendCampaign`을 부른다. 차감·정제·적재·
 *   미적재분 환불·`sentTables` 기록·적재 중 취소 감지는 전부 그쪽 CT가 소유한다.
 */
import { query } from '../config/database';
import { autoSpamTestWithRegenerate } from './spam-test-queue';
import { refineForSpam } from './agency-send-refine';
import {
  buildApprovedExpiredNotify, buildExpiredNotify, buildFinalBlockedNotify, buildPassedNotify,
  buildQueueFailedNotify, buildReapprovalNotify, buildTestFailedNotify, buildTooTightNotify, formatWhen, shortLabel,
} from './agency-send-notify';
import { agencyManagerPhones, buildShortAgencyApproveUrl } from './agency-send-link';
import {
  isApprovalCurrent, isApprovalExpired, isFinalTestDue, isLockStale, isQueueDue, isSameKstDay,
  lockRecoveryStatus, LOCK_STALE_MINUTES, MAX_TEST_ROUNDS, QUEUE_MARGIN_MINUTES,
  DELIVERED_BY_TIME_SQL,
  type AgencySendStatus,
} from './agency-send-state';
import { buildSlotPlan, toSlotValues } from './agency-send-vars';
import { buildRenderedSample as buildSample } from './agency-send-preview';
import { inspectAttemptCampaign, neutralizeCampaign } from './agency-send-campaign';
import { bulkInsertSmsQueue, getAuthSmsTable, insertTestSmsQueue, toKoreaTimeStr } from './sms-queue';
import { countStagingFiltered, createDirectSendCampaign } from './direct-send-core';
import { DirectSendError } from './direct-send-spec';
import { getOpt080Number } from './messageUtils';
import { normalizePhone } from './normalize-phone';
import { sendSystemAlert } from './system-alert';

const LOG = '[agency-send][worker]';
const TICK_MS = 5 * 60 * 1000;

/** 한 번에 처리할 건수. 검사 1건이 몇 분 걸려 넉넉히 잡을 이유가 없다 */
const BATCH = 5;

// ────────────── 공통 ──────────────

async function logEvent(requestId: string, kind: string, payload: Record<string, any> = {}): Promise<void> {
  try {
    await query(`INSERT INTO agency_send_events (request_id, kind, payload) VALUES ($1::uuid, $2, $3::jsonb)`,
      [requestId, kind, JSON.stringify(payload)]);
  } catch (err: any) {
    console.warn(`${LOG} 이력 기록 실패:`, err?.message);
  }
}

/**
 * 워커가 잡은 건을 놓을 때 함께 지우는 값. 소유권을 반납한다는 뜻이다.
 * ⛔ 토큰만 지우고 `lock_at`을 남기면 만료 판정이 옛 시각을 보고 오작동한다. 둘은 같이 움직인다.
 */
const RELEASE = { lock_at: null, lock_token: null } as const;

/**
 * 상태를 바꾼다. **토큰을 주면 그 토큰을 쥐고 있을 때만 바뀐다.**
 *
 * 이 행은 네 주체가 만진다: 워커·담당자·lock 복구·승인 직후 트리거. 조건 없이 쓰면 남이 바꿔 놓은 상태를
 * 덮어 **취소한 건을 다시 예약하거나 같은 발송을 두 벌로 만드는** 경로가 생긴다.
 *
 * ★ 2026-08-23 (Codex 2R critical) 토큰을 `lock_at` 타임스탬프에서 `lock_token uuid`로 바꿨다.
 *   PostgreSQL `timestamptz`는 마이크로초를 담는데 드라이버는 밀리초 `Date`로 파싱한다. 그 값을 조건으로
 *   되보내면 `.123456`과 `.123000`이 되어 **정상 소유자의 UPDATE도 0행**이 되고 그 건이 영구 고착된다.
 *   uuid는 왕복에서 변형되지 않는다. `lock_at`은 만료 판정에만 쓴다.
 *
 * ⛔ 모든 쓰기가 `revision`을 올린다 — 담당자 경로의 낙관적 잠금이 이 값 하나를 본다.
 *
 * @returns 실제로 바뀌었는가. false면 이 핸들러는 소유권을 잃은 것이고, 더 손대면 안 된다.
 */
async function setStatus(
  requestId: string, status: AgencySendStatus, extra: Record<string, any>, token: string,
): Promise<boolean> {
  // ⛔ 토큰은 **필수**다(★2026-08-23 Codex 3R high). 선택으로 두면 "토큰 없이 부르는 자리"가 생기고,
  //   그 자리가 워커가 잡아 둔 행을 덮는다(만료 단계가 정확히 그랬다). 토큰 없는 전이는 각자
  //   관찰한 값으로 CAS 하고, 그 결과를 확인한 뒤에만 다음 일을 한다.
  if (!token) {
    console.error(`${LOG} 토큰 없이 상태를 바꾸려 했다 request=${requestId} → ${status}`);
    return false;
  }
  const sets = ['status = $2', 'revision = revision + 1', 'updated_at = NOW()'];
  const params: any[] = [requestId, status];
  let i = 3;
  for (const [col, val] of Object.entries(extra)) {
    sets.push(`${col} = $${i}`);
    params.push(val);
    i += 1;
  }
  params.push(token);
  const r = await query(
    `UPDATE agency_send_requests SET ${sets.join(', ')} WHERE id = $1::uuid AND lock_token = $${i}::uuid`,
    params,
  );
  const changed = (r.rowCount || 0) > 0;
  if (!changed) {
    console.warn(`${LOG} 소유권을 잃어 상태 변경을 건너뛴다 request=${requestId} → ${status}`);
  }
  return changed;
}

/**
 * 담당자에게 문자를 보낸다. 안내와 테스트 문자 모두 이 함수를 지난다.
 * 인증 라인으로 보내는 이유 = 담당자 1명에게 가는 건이라 대량 라인을 점유하지 않는다(옛 워커와 같은 규칙).
 * ★2026-08-26(3) export — 슈퍼관리자 운영 취소(routes/admin.ts)의 담당자 안내도 같은 함수를 쓴다.
 */
export async function notifyManager(opts: {
  companyId: string;
  requestId: string;
  phones: string[];
  callback: string;
  text: string;
  title: string;
  msgType?: 'S' | 'L' | 'M';
  mmsImages?: string[];
  /**
   * 담당자별로 문장이 다를 때(★2026-08-25 링크 승인 · 번호마다 자기 승인 주소가 실린다).
   * 없으면 전 번호가 같은 text를 받는다. 있으면 phones보다 우선한다.
   */
  perPhoneTexts?: Array<{ phone: string; text: string }>;
}): Promise<void> {
  const entries = opts.perPhoneTexts && opts.perPhoneTexts.length > 0
    ? opts.perPhoneTexts
    : opts.phones.map((phone) => ({ phone, text: opts.text }));
  if (entries.length === 0) return;
  try {
    const table = await getAuthSmsTable();
    const images = opts.mmsImages || [];
    const inserted = await bulkInsertSmsQueue(
      [table],
      entries.map(({ phone, text }) => ([
        phone, opts.callback, text, opts.msgType || 'L', opts.title,
        toKoreaTimeStr(new Date()), null, opts.companyId,
        images[0] || '', images[1] || '', images[2] || '',
      ])),
      true,
      { companyId: opts.companyId, source: 'agency-send' } as any,
    );
    // ★2026-08-30 Codex 지적 수용 — 큐 CT는 배치 INSERT 오류를 삼키고 적재 건수만 돌려준다.
    //   건수를 안 보면 전원 미적재도 조용히 성공으로 끝난다(승인 통보가 발각 경로인 축에서는 치명).
    //   부족분은 기존 실패 규약 그대로 이력에 남긴다(notify_failed · 본 흐름은 계속).
    if (inserted < entries.length) {
      console.error(`${LOG} 담당자 안내 일부 미적재 request=${opts.requestId}: ${inserted}/${entries.length}`);
      await logEvent(opts.requestId, 'notify_failed', { inserted, expected: entries.length });
    }
  } catch (err: any) {
    // 안내를 못 보내도 본 흐름(상태 전이)은 멈추지 않는다. 화면에는 상태가 남는다
    console.error(`${LOG} 담당자 안내 실패 request=${opts.requestId}:`, err?.message);
    await logEvent(opts.requestId, 'notify_failed', { error: String(err?.message || '') });
  }
}

/**
 * 이 접수의 담당자 번호들. **여러 명일 수 있다**(★Harold 2026-08-23 "담당자번호(여러개일 수 있다)").
 * ★2026-08-25 판정 한 벌 통합(Codex 적대 1R) — 발송처(여기)와 링크 승인 권한(공개 라우트·승인 CT)이
 * 같은 목록을 봐야, 접수에서 뺀 번호가 발송에서도 권한에서도 같이 빠진다. 구현 = agency-send-link CT.
 */
const managerPhonesOf = agencyManagerPhones;

/**
 * 승인 링크를 만들기 직전의 **신선한** 행(★2026-08-25). tick 시작 때 읽은 row는 이 tick 안의
 * 다듬기로 문안 버전이 올라 있을 수 있다 — 낡은 버전으로 서명하면 링크가 도착 즉시 죽는다.
 */
async function freshLinkFields(requestId: string): Promise<any | null> {
  const r = await query(
    `SELECT content_version, requested_at, manager_phones, manager_phone FROM agency_send_requests WHERE id = $1::uuid`,
    [requestId],
  );
  return r.rows[0] || null;
}

/**
 * 담당자별 승인 문장 목록 — 번호마다 자기 번호로 서명한 **단축** 승인 주소를 싣는다(★2026-08-26(4) Harold).
 * 단축은 번호당 DB INSERT 1회(담당자 최대 10명)라 순차로 충분하다. 단축이 실패한 번호는 원본 주소를 받는다.
 */
async function buildApproveTexts(
  phones: string[],
  compose: (approveUrl: string) => string,
  companyId: string,
  requestId: string,
  linkRow: any,
): Promise<Array<{ phone: string; text: string }>> {
  const out: Array<{ phone: string; text: string }> = [];
  for (const phone of phones) {
    const approveUrl = await buildShortAgencyApproveUrl(
      companyId, requestId, phone, Number(linkRow.content_version), new Date(linkRow.requested_at),
    );
    out.push({ phone, text: compose(approveUrl) });
  }
  return out;
}

/**
 * 담당자에게 **문안 실물**을 보낸다(테스트발송).
 *
 * ⛔ 안내 문자와 라인이 다르다. 이건 화면의 "테스트발송"과 같은 것이라 같은 CT로 넣어야
 *   사용량이 **그 계정으로** 잡힌다(집계는 `app_etc1='test'` + `bill_id`로 계정을 가른다).
 *   인증 라인으로 보내면 그 두 값이 없어 어느 계정에도 안 잡힌다(★Harold 2026-08-23 지적).
 * ⛔ `bill_id`는 접수한 사용자 id다 — 고객사 관리자 통합 발행이든 계정별 발행이든 이 값으로 갈린다.
 */
async function sendManagerTest(opts: {
  companyId: string;
  requestId: string;
  createdBy: string | null;
  phones: string[];
  callback: string;
  text: string;
  subject: string;
  messageType: string;
  mmsImages?: string[];
}): Promise<void> {
  for (const phone of opts.phones) {
    try {
      await insertTestSmsQueue(
        phone, opts.callback, opts.text, opts.messageType, 'test', opts.subject,
        { companyId: opts.companyId, billId: opts.createdBy || '', mmsImages: opts.mmsImages },
      );
    } catch (err: any) {
      // 한 번호가 실패해도 나머지에게는 보낸다
      console.error(`${LOG} 담당자 테스트 문자 실패 request=${opts.requestId} phone=${phone}:`, err?.message);
      await logEvent(opts.requestId, 'notify_failed', { error: String(err?.message || ''), kind: 'manager-test' });
    }
  }
}

// ★2026-08-28 buildSample은 utils/agency-send-preview.ts로 이동(원문 복사) — 상세 미리보기가 같은
//   조립을 상위 N행에 쓰기 위해서다. 검사한 문장 = 담당자가 본 문장 = 미리보기 = 나가는 문장(불변 4).

/**
 * 스팸 검사 한 판. 걸리면 다듬어 다시 본다.
 * ⛔ 다듬은 문안은 `refineForSpam`의 검사를 통과한 것만 쓴다 — 날짜·번호·링크가 바뀐 문안은 버린다.
 *
 * ⚠ **[별도 과제 · 이번 축 아님] 통과 판정이 `!== 'blocked'`라 느슨하다.** 상류 계약은
 *   `pass | blocked | failed | timeout`이고 적재 실패는 `failed`, 대기 만료는 `timeout`,
 *   응답이 비면 `undefined`다. 즉 **검사가 못 돈 것도 통과로 읽는다.**
 *   이것은 당일 재검사 폐지와 무관하게 **이전부터 있던 것**이고 워커 B에도 똑같이 있다
 *   (오늘도 T-2h 재검사가 타임아웃이면 통과로 읽고 발송한다). 고치려면 실패를 판정이 아니라
 *   의존 장애로 다루는 재시도·백오프 설계가 함께 필요해 별도 과제로 뺐다(설계서 §14-6).
 */
async function runSpamRound(row: any, startRound: number): Promise<{
  passed: boolean;
  finalContent: string;   // 치환 전 원문 기준(원장에 저장할 값)
  rounds: number;
  detail: any;
}> {
  let content = String(row.current_content || '');
  let rounds = startRound;
  let detail: any = null;

  while (rounds < MAX_TEST_ROUNDS) {
    rounds += 1;
    const sample = await buildSample({ ...row, current_content: content });
    const rejectNumber = row.is_ad ? await getOpt080Number(row.created_by || null, row.company_id) : '';

    // 재생성은 우리가 직접 돌린다(다듬기 규칙이 캠페인 문안과 다르다) → maxRetries 0
    const result = await autoSpamTestWithRegenerate({
      companyId: row.company_id,
      userId: row.created_by || row.company_id,
      callbackNumber: row.callback_number,
      messageType: (row.message_type === 'MMS' ? 'MMS' : row.message_type === 'LMS' ? 'LMS' : 'SMS'),
      subject: sample.subject,
      variants: [{ variantId: 'agency', messageText: sample.text, subject: sample.subject }],
      isAd: !!row.is_ad,
      rejectNumber,
      maxRetries: 0,
    });
    detail = { batchId: result.batchId, round: rounds, variants: result.variants };

    const v = result.variants[0];
    if (v?.spamResult !== 'blocked') {
      return { passed: true, finalContent: content, rounds, detail };
    }

    await logEvent(row.id, 'spam_blocked', { round: rounds, carriers: v.carrierResults });
    if (rounds >= MAX_TEST_ROUNDS) break;

    const refined = await refineForSpam({ companyId: row.company_id, original: content, round: rounds });
    if (!refined.ok || !refined.content) {
      await logEvent(row.id, 'refine_failed', { round: rounds, reason: refined.reason });
      break; // 다듬지 못하면 더 돌려도 같은 문안이다
    }
    // ★2026-08-31 **실제로 바뀌었을 때만** '다듬었다'로 남긴다.
    //   `checkRefined`는 빈 값·길이·앵커 손실·없던 혜택만 거르고 "원문과 똑같은 결과"는 통과시킨다.
    //   짧은 문안은 다듬을 곳이 없어 모델이 원문을 그대로 돌려주는데, 전에는 그 회차도 `refined`로 찍혔다.
    //   그런데 담당자 통보는 문안이 **달라졌을 때만** 나간다(워커 B 통과 분기). 기록은 "다듬었다"인데
    //   문자는 안 나가 "다듬었다면서 왜 안내가 없나"가 된다(0831 Harold 지적).
    // ⛔ 비교는 통보 분기와 **같은 기준**(글자 그대로)이어야 한다. 여기서 공백을 정규화하면 그 순간
    //   기록과 통보가 다시 갈린다.
    const refineChanged = refined.content !== content;
    content = refined.content;
    await logEvent(row.id, refineChanged ? 'refined' : 'refine_nochange', { round: rounds });
  }

  return { passed: false, finalContent: content, rounds, detail };
}

/**
 * 검사 결과를 원장에 반영한다. 문안이 다듬어졌으면 버전을 올려 옛 승인을 무효로 만든다.
 *
 * ⛔ 소유권 토큰을 조건에 넣는다(★2026-08-23 Codex 2R high). 검사는 몇 분 걸리는 외부 호출이라, 그 사이
 *   lock 복구가 되돌리고 담당자가 문안을 고쳤을 수 있다. 조건 없이 쓰면 **담당자가 고친 문안을 옛 문안으로
 *   되덮는다.** 0행이면 이 핸들러는 남의 건을 들고 있는 것이라 아무것도 더 하지 않는다.
 *
 * @returns 갱신된 문안 버전. 소유권을 잃었으면 null.
 */
async function saveTestResult(
  row: any, content: string, rounds: number, detail: any, token: string,
): Promise<number | null> {
  const changed = content !== String(row.current_content || '');
  const r = await query(
    `UPDATE agency_send_requests
        SET current_content = $1,
            content_version = content_version + $2,
            test_round = $3, last_test_result = $4::jsonb, last_test_at = NOW(),
            revision = revision + 1, updated_at = NOW()
      WHERE id = $5::uuid AND lock_token = $6::uuid
      RETURNING content_version`,
    [content, changed ? 1 : 0, rounds, JSON.stringify(detail || {}), row.id, token],
  );
  if (r.rows.length === 0) {
    console.warn(`${LOG} 소유권을 잃어 검사 결과를 버린다 request=${row.id}`);
    return null;
  }
  return Number(r.rows[0].content_version);
}

// ────────────── A. 1차 검사 ──────────────

async function runFirstTest(onlyRequestId?: string): Promise<void> {
  // ★0826(6) `onlyRequestId` = 접수 직후 즉시 진입(triggerAgencySendFirstTest). 리드타임 하한을 40분으로
  //   내린 뒤로는 **워커 주기 5분을 기다리는 것 자체가 승인 시간을 깎는다.** 선점은 그대로 CAS라
  //   정기 tick과 겹쳐도 한쪽만 잡는다(FOR UPDATE SKIP LOCKED + lock_token).
  const params: any[] = [];
  let idFilter = '';
  if (onlyRequestId) {
    params.push(onlyRequestId);
    idFilter = ` AND id = $${params.length}::uuid`;
  }
  const picked = await query(
    `UPDATE agency_send_requests
        SET status = 'testing', lock_at = NOW(), lock_token = gen_random_uuid(),
            revision = revision + 1, updated_at = NOW()
      WHERE id IN (
        SELECT id FROM agency_send_requests
         WHERE status = 'received'${idFilter}
         ORDER BY created_at
         LIMIT ${BATCH}
         FOR UPDATE SKIP LOCKED
      )
      RETURNING *`,
    params,
  );

  for (const row of picked.rows) {
    // 선점할 때 발급한 토큰이 이 핸들러의 소유권이다. 이 값이 바뀌면 남이 이 건을 가져간 것이다.
    const token: string = row.lock_token;
    try {
      const { passed, finalContent, rounds, detail } = await runSpamRound(row, 0);
      // ⛔ 검사 결과부터 소유권을 확인하며 쓴다. 여기서 잃었으면 알림도 보내지 않는다 —
      //   담당자가 이미 문안을 고쳤는데 옛 문안으로 "승인해 주세요"를 보내면 그 문자가 거짓이 된다.
      if (await saveTestResult(row, finalContent, rounds, detail, token) === null) continue;
      const label = shortLabel(row.file_name || row.original_content);
      const whenText = formatWhen(new Date(row.requested_at));

      if (!passed) {
        if (!await setStatus(row.id, 'test_failed', { ...RELEASE }, token)) continue;
        await logEvent(row.id, 'test_failed', { rounds });
        await notifyManager({
          companyId: row.company_id, requestId: row.id, phones: managerPhonesOf(row),
          callback: row.callback_number, title: '[대행발송] 문안 확인 요청',
          text: buildTestFailedNotify({ label }),
        });
        continue;
      }

      // ⛔ 상태를 먼저 확정하고 그다음에 알린다(★2026-08-23 Codex 2R high).
      //   알림을 먼저 보내면, 소유권을 잃어 상태가 안 바뀐 건에도 테스트 문자와 승인 요청이 나간다.
      //
      // ★ 2026-08-23(2) 이 검사가 **발송일에 통과한 검사**면 그것이 곧 당일 검사다(Harold 지시).
      //   같은 문안을 같은 날 두 번 검사하지 않는다: 테스트폰 발송 비용이 한 번 더 나가고,
      //   통신사 결과가 흔들려 담당자가 이미 승인한 문안이 차단으로 뒤집힐 수 있다.
      //   ⛔ 이 자리는 **통과 분기 안**이다. 위 `!passed` 분기에서는 절대 찍히지 않는다 —
      //     찍히면 차단된 문안이 검사 없이 예약된다.
      //   기준은 접수일이 아니라 **통과한 시각**이다. 배치가 밀려 자정을 넘겨 통과했다면
      //   그것은 넘어간 그 날의 검사다(그 날 나가는 건이면 유효하고, 아니면 워커 B가 2시간 전에 다시 본다).
      //   비교와 저장에 **같은 한 시각**을 쓴다 — 따로 찍으면 자정 경계에서 둘이 갈린다.
      const passedAt = new Date();
      const sameDaySend = isSameKstDay(passedAt, new Date(row.requested_at));
      if (!await setStatus(
        row.id, 'awaiting_approval',
        sameDaySend ? { ...RELEASE, final_test_at: passedAt } : { ...RELEASE },
        token,
      )) continue;
      await logEvent(row.id, 'awaiting_approval', { rounds, sameDaySend });

      // 통과한 문안을 담당자에게 **실물 그대로** 보낸다(MMS면 이미지까지).
      //   승인은 이 문자를 본 뒤에 하는 것이라, 여기서 실제와 다른 것을 보내면 승인의 의미가 없다.
      const sample = await buildSample({ ...row, current_content: finalContent });
      const images = Array.isArray(row.mms_image_paths) ? row.mms_image_paths : [];
      await sendManagerTest({
        companyId: row.company_id, requestId: row.id, createdBy: row.created_by,
        phones: managerPhonesOf(row), callback: row.callback_number,
        text: sample.text, subject: sample.subject || '[대행발송] 테스트',
        messageType: row.message_type, mmsImages: images,
      });
      // ★2026-08-26(6) 승인 링크를 보내기 전에 **지금 승인이 통하는지** 먼저 본다.
      //   검사가 오래 걸려 남은 시간이 적재 여유에 못 미치면 링크를 보내지 않는다 —
      //   누를 수는 있는데 서버가 거절하는 상태(0823 §12-2의 그 함정)를 만들지 않기 위해서다.
      // 판정은 만료 워커·승인 라우트가 쓰는 그 함수 하나다(갈리면 그 사이가 함정이 된다 · §12-2·§12-3)
      if (isApprovalExpired('awaiting_approval', new Date(row.requested_at), passedAt, sameDaySend ? passedAt : null)) {
        await logEvent(row.id, 'approval_window_missed', { rounds, requestedAt: row.requested_at });
        await notifyManager({
          companyId: row.company_id, requestId: row.id, phones: managerPhonesOf(row),
          callback: row.callback_number, title: '[대행발송] 시각 확인 요청',
          text: buildTooTightNotify({ label, whenText }),
        });
        continue;
      }

      // ★2026-08-25 링크 승인: 담당자마다 자기 번호에 묶인 승인 주소를 받는다(agency-send-link CT).
      //   주소는 통지 직전의 신선한 문안 버전으로 서명한다(이 tick의 다듬기로 버전이 올라 있을 수 있다)
      // ★2026-08-26(4) 주소는 단축으로 싣고(실패 시 원본 폴백), 요청 건수를 함께 안내한다(Harold)
      // ★2026-08-26(6) 시각이 자동 조정된 건은 문안이 갈린다(원본 시각을 함께 알린다)
      const linkRow = (await freshLinkFields(row.id)) || row;
      const count = Number(row.recipient_count || 0);
      const originalWhenText = row.requested_at_original
        ? formatWhen(new Date(row.requested_at_original))
        : undefined;
      await notifyManager({
        companyId: row.company_id, requestId: row.id, phones: managerPhonesOf(linkRow),
        callback: row.callback_number, title: '[대행발송] 승인 요청',
        text: buildPassedNotify({ label, whenText, count, originalWhenText }),
        perPhoneTexts: await buildApproveTexts(managerPhonesOf(linkRow), (approveUrl) =>
          buildPassedNotify({ label, whenText, count, originalWhenText, approveUrl }),
          row.company_id, row.id, linkRow),
      });
      console.log(`${LOG} 1차 검사 통과 request=${row.id} rounds=${rounds}`);
    } catch (err: any) {
      console.error(`${LOG} 1차 검사 실패 request=${row.id}:`, err);
      await setStatus(row.id, 'received', { ...RELEASE }, token).catch(() => {});
      await logEvent(row.id, 'first_test_error', { error: String(err?.message || '') });
    }
  }
}

// ────────────── B. 당일 재검사 + 큐 적재 ──────────────

async function runFinalTest(onlyRequestId?: string): Promise<void> {
  // ⛔ 하한을 SQL에 넣는다(★2026-08-23 Codex high). 만료 대상(남은 시간 <= 여유)까지 후보에 담고
  //   LIMIT을 먼저 적용하면, 그런 행 다섯 개가 방금 재승인된 건을 가려 그 tick을 통째로 건너뛴다.
  const params: any[] = [QUEUE_MARGIN_MINUTES];
  let idFilter = '';
  if (onlyRequestId) {
    params.push(onlyRequestId);
    idFilter = ` AND id = $${params.length}::uuid`;
  }
  const candidates = await query(
    `SELECT * FROM agency_send_requests
      WHERE status = 'approved'
        AND requested_at > NOW() + ($1::int * INTERVAL '1 minute')
        AND requested_at <= NOW() + INTERVAL '2 hours'${idFilter}
      ORDER BY requested_at
      LIMIT ${BATCH}`,
    params,
  );

  const now = new Date();
  for (const row of candidates.rows) {
    const requestedAt = new Date(row.requested_at);
    const finalTestedAt = row.final_test_at ? new Date(row.final_test_at) : null;

    // ① 당일 검사를 이미 통과한 문안이다. 다시 검사하지 않고 예약만 만든다.
    //   두 갈래가 여기로 온다: 재승인 건 · **접수한 그날 나가는 건**(★2026-08-23(2) 워커 A가 통과 때 찍는다).
    //   ⛔ 여기서 또 검사하면 승인받은 문안이 통신사 결과에 따라 다시 뒤집히고, 남은 시간도 사라진다.
    if (isQueueDue('approved', requestedAt, now, finalTestedAt)) {
      const locked = await query(
        `UPDATE agency_send_requests
            SET status = 'final_testing', lock_at = NOW(), lock_token = gen_random_uuid(),
                revision = revision + 1, updated_at = NOW()
          WHERE id = $1::uuid AND status = 'approved' RETURNING *`,
        [row.id],
      );
      if (locked.rows.length === 0) continue;
      const ready = locked.rows[0];
      try {
        await dispatchToPipeline(ready, String(ready.current_content || ''), ready.lock_token);
      } catch (err: any) {
        console.error(`${LOG} 당일 검사 통과 건 예약 실패 request=${ready.id}:`, err);
        await setStatus(ready.id, 'approved', { ...RELEASE }, ready.lock_token).catch(() => {});
        await logEvent(ready.id, 'dispatch_error', { error: String(err?.message || '') });
      }
      continue;
    }

    if (!isFinalTestDue('approved', requestedAt, now, finalTestedAt)) continue;

    const locked = await query(
      `UPDATE agency_send_requests
          SET status = 'final_testing', lock_at = NOW(), lock_token = gen_random_uuid(),
              revision = revision + 1, updated_at = NOW()
        WHERE id = $1::uuid AND status = 'approved' RETURNING *`,
      [row.id],
    );
    if (locked.rows.length === 0) continue; // 다른 tick이 먼저 잡았다
    const target = locked.rows[0];
    const token: string = target.lock_token;
    const label = shortLabel(target.file_name || target.original_content);

    try {
      const { passed, finalContent, rounds, detail } = await runSpamRound(target, 0);
      const version = await saveTestResult(target, finalContent, rounds, detail, token);
      if (version === null) continue; // 소유권을 잃었다. 알림도 보내지 않는다
      // 통과한 문안에는 "오늘 검사를 지났다"는 표시를 남긴다. 재승인 뒤 재검사를 건너뛰는 근거이자,
      // 문안·시각이 바뀌면 라우트가 이 값을 지워 다시 검사하게 만드는 스위치다.
      if (passed) {
        await query(
          `UPDATE agency_send_requests
              SET final_test_at = NOW(), revision = revision + 1, updated_at = NOW()
            WHERE id = $1::uuid AND lock_token = $2::uuid`,
          [target.id, token],
        );
      }

      if (passed && finalContent === String(target.current_content || '')) {
        // 문안이 그대로 통과 = 담당자가 승인한 그 문안이다. 바로 예약으로 간다
        await dispatchToPipeline(target, finalContent, token);
        continue;
      }

      if (passed) {
        // 다듬어서 통과했다 = 담당자가 못 본 문장이다. 재승인을 받는다(불변 7)
        if (!await setStatus(target.id, 'reapproval', {
          ...RELEASE,
          approved_at: null,
          approved_by: null,
          approval_version: null,
          reapproval_count: Number(target.reapproval_count || 0) + 1,
        }, token)) continue;
        await logEvent(target.id, 'reapproval', { rounds, version });

        await notifyManager({
          companyId: target.company_id, requestId: target.id, phones: managerPhonesOf(target),
          callback: target.callback_number, title: '[대행발송] 예약 취소 안내',
          text: buildFinalBlockedNotify({ label }),
        });
        const sample = await buildSample({ ...target, current_content: finalContent });
        const images = Array.isArray(target.mms_image_paths) ? target.mms_image_paths : [];
        await sendManagerTest({
          companyId: target.company_id, requestId: target.id, createdBy: target.created_by,
          phones: managerPhonesOf(target), callback: target.callback_number,
          text: sample.text, subject: sample.subject || '[대행발송] 수정 문안',
          messageType: target.message_type, mmsImages: images,
        });
        // ★2026-08-25 링크 승인: 재승인은 다듬어진 새 문안 버전으로 서명한 새 주소가 나간다(옛 링크는 버전 불일치로 죽는다)
        // ★2026-08-26(4) 단축 주소 + 요청 건수 동반
        const reappRow = (await freshLinkFields(target.id)) || target;
        const reappCount = Number(target.recipient_count || 0);
        await notifyManager({
          companyId: target.company_id, requestId: target.id, phones: managerPhonesOf(reappRow),
          callback: target.callback_number, title: '[대행발송] 재승인 요청',
          text: buildReapprovalNotify({ label, whenText: formatWhen(new Date(target.requested_at)), count: reappCount }),
          perPhoneTexts: await buildApproveTexts(managerPhonesOf(reappRow), (approveUrl) =>
            buildReapprovalNotify({ label, whenText: formatWhen(new Date(reappRow.requested_at)), count: reappCount, approveUrl }),
            target.company_id, target.id, reappRow),
        });
        continue;
      }

      // 세 번 다 걸렸다. 나가지 않는다
      if (!await setStatus(target.id, 'test_failed', { ...RELEASE }, token)) continue;
      await logEvent(target.id, 'final_test_failed', { rounds });
      await notifyManager({
        companyId: target.company_id, requestId: target.id, phones: managerPhonesOf(target),
        callback: target.callback_number, title: '[대행발송] 예약 취소 안내',
        text: buildFinalBlockedNotify({ label }),
      });
      await notifyManager({
        companyId: target.company_id, requestId: target.id, phones: managerPhonesOf(target),
        callback: target.callback_number, title: '[대행발송] 문안 확인 요청',
        text: buildTestFailedNotify({ label }),
      });
    } catch (err: any) {
      console.error(`${LOG} 당일 재검사 실패 request=${target.id}:`, err);
      // 되돌려 둔다. 다음 tick이 다시 잡거나, 시각이 지나면 만료 단계가 맡는다
      await setStatus(target.id, 'approved', { ...RELEASE }, token).catch(() => {});
      await logEvent(target.id, 'final_test_error', { error: String(err?.message || '') });
    }
  }
}

/**
 * 예약을 만든다. **이 축에서 발송을 만드는 유일한 자리다.**
 *
 * 직접 큐에 넣지 않고 직접발송 배관에 넘긴다: `campaign_send_staging` 적재 → `createDirectSendCampaign`.
 * 그 뒤의 수신거부 제외·중복 제거·선불 차감·큐 적재·미적재분 환불·적재 중 취소 감지는 그쪽이 소유한다.
 *
 * ⛔ `send_type`을 지정하지 않는다 — 배관 기본값 `'direct'`로 적재되어 결과 동기화·실패 환불·후불 청구가
 *   **기존 경로 그대로** 돈다. 새 값을 만들면 그 축들을 건드려야 하고, 건드릴 이유가 없다.
 * ⛔ `campaign_id`가 이미 있으면 다시 만들지 않는다. 재시도가 캠페인과 큐를 한 벌 더 만들던 자리다(§12-1).
 */
async function dispatchToPipeline(row: any, content: string, token: string): Promise<void> {
  const label = shortLabel(row.file_name || row.original_content, 40);
  const notifyFailed = async (kind: string, payload: Record<string, any>) => {
    await logEvent(row.id, kind, payload);
    await notifyManager({
      companyId: row.company_id, requestId: row.id, phones: managerPhonesOf(row),
      callback: row.callback_number, title: '[대행발송] 확인 요청',
      text: buildQueueFailedNotify({ label }),
    });
  };

  // **이번 시도의 식별자.** 캠페인이 이 값을 `staging_id`로 들고 있어, 크래시 뒤 재시도가 같은 시도를
  //   두 번 만들지 않는다. 접수 id를 그대로 쓰면 실패한 시도와 새 시도를 가를 수 없어, 한 번 실패한 건이
  //   재예약해도 옛 캠페인에 영원히 막힌다. 문안·시각을 고치면 라우트가 이 값을 지운다.
  // ⛔ lease를 조건에 넣는다 — 이 사이 lock 복구가 되돌렸으면 여기서 멈춘다.
  const keyed = await query(
    `UPDATE agency_send_requests
        SET dispatch_key = COALESCE(dispatch_key, gen_random_uuid()),
            revision = revision + 1, updated_at = NOW()
      WHERE id = $1::uuid AND lock_token = $2::uuid
      RETURNING dispatch_key`,
    [row.id, token],
  );
  if (keyed.rows.length === 0) {
    console.warn(`${LOG} 소유권을 잃어 예약을 중단한다 request=${row.id}`);
    return;
  }
  const stagingId = keyed.rows[0].dispatch_key;

  // ⛔ 멱등 — 앞선 시도가 예약을 만들어 두고 원장에 적기 전에 죽었을 수 있다.
  //   그때 그냥 다시 만들면 같은 발송이 두 벌 나간다. **캠페인을 만들기 전에** 이번 시도 키로 먼저 찾는다.
  //   근거는 시도 키 하나다(원장의 `campaign_id`는 나중에 적히므로 근거가 못 된다).
  const prior = await inspectAttemptCampaign(row.company_id, stagingId);
  if (prior.id) {
    // 차감 도중 멈춰 중화된 캠페인은 더 나가지 않는다. 다시 만들지도 않는다.
    // ⛔ 일부는 이미 나갔을 수 있으므로 `campaign_id`를 붙인 채로 닫는다 — 라우트가 그 접수의 재예약을 막는다.
    if (prior.kind === 'stopped') {
      await setStatus(row.id, 'expired', { ...RELEASE, campaign_id: prior.id, expired_at: new Date() }, token);
      await notifyFailed('dispatch_incomplete', { campaignId: prior.id });
      return;
    }
    // 살아 있다 = 이미 예약된 것이다. 상태를 맞추기만 한다(실패해도 대조가 수렴시킨다).
    await setStatus(row.id, 'queued', { ...RELEASE, campaign_id: prior.id, queued_at: new Date() }, token);
    await logEvent(row.id, 'queued_already', { campaignId: prior.id });
    return;
  }
  // ⛔ 승인은 문안 버전에 묶인다(불변 7). 게이트를 라우트에만 두면 워커가 문안을 다듬은 뒤
  //   상태 전이가 실패한 경로로 **담당자가 못 본 문장**이 여기까지 올 수 있다. 효과가 만들어지는 자리에서 다시 본다.
  if (!isApprovalCurrent(row.approval_version, row.content_version)) {
    // ⛔ 소유권을 반납한다(★2026-08-23 Codex 4R). 토큰을 남기면 `reapproval`은 lock 복구 대상이 아니라
    //   만료도 취소도 그 토큰 때문에 영원히 걸리지 않는다.
    // ⛔ 상태가 실제로 바뀐 뒤에만 알린다 — 아니면 바뀌지도 않은 건에 재승인 요청 문자가 나간다.
    if (!await setStatus(row.id, 'reapproval', {
      ...RELEASE, approved_at: null, approved_by: null, approval_version: null,
    }, token)) return;
    await logEvent(row.id, 'dispatch_unapproved_version', {
      approvalVersion: row.approval_version, contentVersion: row.content_version,
    });
    // ★2026-08-25 이 재승인 분기도 담당자별 링크를 싣는다(Codex 적대 1R medium — 여기만 로그인 안내가 나갔다).
    //   그리고 링크를 주기 전에 **문안 실물부터** 보낸다(Codex 적대 2R high — 정상 재승인 경로와 같은 순서.
    //   실물 없이 승인 링크만 가면, 치환·광고 부착·이미지가 붙은 실제 문장을 못 본 채 승인하게 된다).
    const unappRow = (await freshLinkFields(row.id)) || row;
    try {
      const sample = await buildSample(row);
      await sendManagerTest({
        companyId: row.company_id, requestId: row.id, createdBy: row.created_by,
        phones: managerPhonesOf(unappRow), callback: row.callback_number,
        text: sample.text, subject: sample.subject || '[대행발송] 수정 문안',
        messageType: row.message_type,
        mmsImages: Array.isArray(row.mms_image_paths) ? row.mms_image_paths : [],
      });
    } catch (err: any) {
      console.error(`${LOG} 재승인 실물 문자 실패 request=${row.id}:`, err?.message);
      await logEvent(row.id, 'notify_failed', { error: String(err?.message || ''), kind: 'manager-test' });
    }
    const unappCount = Number(row.recipient_count || 0);
    await notifyManager({
      companyId: row.company_id, requestId: row.id, phones: managerPhonesOf(unappRow),
      callback: row.callback_number, title: '[대행발송] 재승인 요청',
      text: buildReapprovalNotify({ label, whenText: formatWhen(new Date(row.requested_at)), count: unappCount }),
      perPhoneTexts: await buildApproveTexts(managerPhonesOf(unappRow), (approveUrl) =>
        buildReapprovalNotify({ label, whenText: formatWhen(new Date(unappRow.requested_at)), count: unappCount, approveUrl }),
        row.company_id, row.id, unappRow),
    });
    return;
  }
  if (!row.created_by) {
    await setStatus(row.id, 'expired', { ...RELEASE, expired_at: new Date() }, token);
    await notifyFailed('dispatch_no_owner', {});
    return;
  }

  const plan = buildSlotPlan(content);
  if (!plan.ok) {
    await setStatus(row.id, 'test_failed', { ...RELEASE }, token);
    await notifyFailed('dispatch_var_overflow', { vars: plan.order.length });
    return;
  }

  const recipients = await query(
    `SELECT phone, vars FROM agency_send_recipients WHERE request_id = $1::uuid ORDER BY row_no`,
    [row.id],
  );
  const phones: string[] = [];
  const names: string[] = [];
  const extra1s: string[] = [];
  const extra2s: string[] = [];
  const extra3s: string[] = [];
  for (const r of recipients.rows) {
    const phone = normalizePhone(r.phone);
    if (!phone) continue;
    const v = toSlotValues(r.vars, plan.order);
    phones.push(phone); names.push(v.name); extra1s.push(v.extra1); extra2s.push(v.extra2); extra3s.push(v.extra3);
  }
  // 문안 문제가 아니라 보낼 대상이 없는 것이다. "문안 확인 필요"로 적으면 담당자가 엉뚱한 곳을 본다.
  if (phones.length === 0) {
    await setStatus(row.id, 'expired', { ...RELEASE, expired_at: new Date() }, token);
    await notifyFailed('dispatch_no_recipient', {});
    return;
  }

  await query(`DELETE FROM campaign_send_staging WHERE staging_id = $1::uuid`, [stagingId]);
  // 컬럼·UNNEST 형태는 `/direct-send/stage`(routes/campaigns.ts) 원본과 같다. 개별 회신번호는 쓰지 않는다.
  await query(
    `INSERT INTO campaign_send_staging (staging_id, company_id, phone, name, extra1, extra2, extra3)
     SELECT $1::uuid, $2::uuid, u.phone, u.name, u.extra1, u.extra2, u.extra3
     FROM UNNEST($3::text[], $4::text[], $5::text[], $6::text[], $7::text[])
       AS u(phone, name, extra1, extra2, extra3)`,
    [stagingId, row.company_id, phones, names, extra1s, extra2s, extra3s],
  );

  // 정제 후 실제 발송 수(수신거부·중복 제외). 차감·청구가 이 수를 쓴다.
  const { sendCount } = await countStagingFiltered(stagingId, row.company_id, row.created_by, true, true);
  if (sendCount === 0) {
    await query(`DELETE FROM campaign_send_staging WHERE staging_id = $1::uuid`, [stagingId]);
    await setStatus(row.id, 'expired', { ...RELEASE, expired_at: new Date() }, token);
    await notifyFailed('dispatch_zero_after_filter', { staged: phones.length });
    return;
  }

  const images = Array.isArray(row.mms_image_paths) ? row.mms_image_paths : [];
  try {
    const { campaignId } = await createDirectSendCampaign(
      {
        stagingId,
        campaignName: `대행발송 ${label}`,
        msgType: row.message_type,
        total: sendCount,
        message: plan.slotContent,
        subject: row.subject || null,
        callback: row.callback_number,
        sendChannel: 'sms',
        adEnabled: !!row.is_ad,
        scheduled: true,
        scheduledAt: new Date(row.requested_at).toISOString(),
        mmsImagePaths: images.length > 0 ? images : null,
        dedupEnabled: true,
        unsubFilterEnabled: true,
      },
      { companyId: row.company_id, userId: row.created_by },
    );

    // 상태를 적는다. **이 쓰기가 실패해도 발송이 미아가 되지 않는다** — 캠페인이 시도 키를 들고 있고
    //   대조(워커 D)가 그것을 보고 수렴시킨다. 그래서 여기서 고아 판정·중화를 하지 않는다.
    await setStatus(row.id, 'queued', { ...RELEASE, campaign_id: campaignId, queued_at: new Date() }, token);
    await logEvent(row.id, 'queued', { campaignId, count: sendCount, staged: phones.length });
    console.log(`${LOG} 예약 생성 완료 request=${row.id} campaign=${campaignId} ${sendCount}건`);
  } catch (err: any) {
    // 배관이 거절했다(잔액 부족·야간 광고 제한·미완성 링크 등). 캠페인 정리는 그쪽이 소유한다.
    // ⛔ 여기서 staging을 지우지 않는다 — 거절 이유가 "결과 미확정"일 때 캠페인이 실제로는 살아 있을 수 있고,
    //   그 순간 적재 워커가 읽는 행을 지우면 **일부만 나가는 발송**이 된다. 다음 시도가 같은 자리에 다시 쓴다.
    const code = err instanceof DirectSendError ? err.code : 'DISPATCH_ERROR';
    console.error(`${LOG} 예약 생성 거절 request=${row.id} code=${code}:`, err?.message || err);

    // ⛔ **결과를 확인하기 전에는 닫지 않는다**(★2026-08-23 Codex 2R critical).
    //   배관은 "활성화 결과 미확정"으로도 던진다. 그때 캠페인이 실제로 살아 있을 수 있는데 여기서 닫고
    //   담당자가 재예약하면 시도 키가 바뀌어 옛 캠페인을 못 찾는다 = 두 벌 발송.
    //   그래서 이번 시도 키로 캠페인을 먼저 찾아 실제 상태로 확정한다.
    const made = await inspectAttemptCampaign(row.company_id, stagingId);
    if (made.id && made.kind === 'live') {
      await setStatus(row.id, 'queued', { ...RELEASE, campaign_id: made.id, queued_at: new Date() }, token);
      await logEvent(row.id, 'dispatch_recovered', { campaignId: made.id, code });
      return;
    }
    if (made.id) {
      await setStatus(row.id, 'expired', { ...RELEASE, campaign_id: made.id, expired_at: new Date() }, token);
      await notifyFailed('dispatch_rejected', { code, campaignId: made.id, message: String(err?.message || '') });
      return;
    }
    // 캠페인이 없다 = 이번 시도는 아무것도 만들지 못했다. 시도 키를 그대로 두고 되돌려 다음 tick이 다시 한다.
    //   안내는 보내지 않는다 — 반복 실패마다 문자를 쏘면 담당자에게 같은 문장이 쌓인다(만료 때 한 번 간다).
    await setStatus(row.id, 'approved', { ...RELEASE }, token);
    await logEvent(row.id, 'dispatch_retry', { code, message: String(err?.message || '') });
  }
}

// ────────────── C. 만료 ──────────────

async function runExpire(): Promise<void> {
  // ★ 2026-08-23 `approved` 합류(§12-3). 승인은 받았는데 재검사·예약을 넣을 시간이 지난 건이
  //   전에는 어느 워커의 대상도 아니어서 발송도 만료도 안내도 없이 그대로 남았다.
  //
  // ⚠ [별도 과제 · 이번 축 아님] 후보를 "2시간 안" 전부로 담고 `LIMIT`을 먼저 건다. 당일 검사를 통과해
  //   아직 만료가 아닌 건이 스무 자리를 채우면 만료된 건이 밀린다(설계서 §14-6). 지금 볼륨에서는 도달하지 않는다.
  const rows = await query(
    `SELECT * FROM agency_send_requests
      WHERE status IN ('awaiting_approval','reapproval','approved')
        AND requested_at < NOW() + INTERVAL '2 hours'
      ORDER BY requested_at
      LIMIT 20`,
  );

  const now = new Date();
  for (const row of rows.rows) {
    // ⛔ `final_test_at`을 함께 넘긴다(★2026-08-23(2)). 당일 검사가 끝난 건은 남은 일이 적재뿐이라
    //   승인 마감이 2시간이 아니다. 승인 라우트와 **같은 인자**를 쓰지 않으면 승인은 되는데
    //   다음 tick이 만료시키는 구간이 다시 생긴다(§12-2와 같은 형태).
    if (!isApprovalExpired(
      row.status, new Date(row.requested_at), now, row.final_test_at ? new Date(row.final_test_at) : null,
    )) continue;
    const wasApproved = row.status === 'approved';

    // ⛔ 관찰한 상태·수정 번호로 잡고, **워커가 잡고 있지 않은 행만** 만료시킨다(★2026-08-23 Codex 3R high).
    //   조건 없이 덮으면, 방금 예약을 만들기 시작한 건을 만료로 바꿔 놓고 그 핸들러는 계속 캠페인을 만든다
    //   (담당자는 "발송하지 못했습니다"를 받고 실제로는 발송된다).
    const claimed = await query(
      `UPDATE agency_send_requests
          SET status = 'expired', expired_at = NOW(), revision = revision + 1, updated_at = NOW()
        WHERE id = $1::uuid AND status = $2 AND revision = $3 AND lock_token IS NULL
        RETURNING id`,
      [row.id, row.status, row.revision],
    );
    if (claimed.rows.length === 0) continue;

    await logEvent(row.id, 'expired', { from: row.status });
    const label = shortLabel(row.file_name || row.original_content);
    await notifyManager({
      companyId: row.company_id, requestId: row.id, phones: managerPhonesOf(row),
      callback: row.callback_number, title: '[대행발송] 미발송 안내',
      // 승인한 담당자에게 "승인이 없어서"라고 보내면 사실과 다르다. 사유대로 나눈다.
      text: wasApproved ? buildApprovedExpiredNotify({ label }) : buildExpiredNotify({ label }),
    });
    console.log(`${LOG} 발송하지 않고 만료 request=${row.id} from=${row.status}`);
  }
}

// ────────────── D. 대조(이중 진실 안전망) ──────────────

/**
 * **캠페인 쪽 진실에 원장을 맞춘다.** 이 축의 수렴은 전부 여기 한 곳에서 일어난다.
 *
 * 근거는 `campaigns.staging_id = agency_send_requests.dispatch_key` 하나다. 원장의 `campaign_id`는
 * 화면 표시용 캐시일 뿐이라 비어 있어도 판정이 흔들리지 않는다. 그래서 예약을 만드는 자리는
 * "만들고 상태를 적는다"까지만 하고, 적기에 실패하든 크래시하든 **여기가 매 tick 다시 본다.**
 *
 * ⛔ 종결 상태(`cancelled`·`expired`·`test_failed`)도 대상이다. 늦게 태어난 캠페인은
 *   요청이 이미 끝났든 말든 나가기 때문이다. 중화가 실패해도 다음 tick이 다시 시도한다
 *   (그래서 별도 재시도 장치가 필요 없다).
 */
async function runReconcile(): Promise<void> {
  const rows = await query(
    `SELECT id, company_id, status, revision, campaign_id, dispatch_key,
            manager_phone, manager_phones, callback_number, file_name, original_content
       FROM agency_send_requests
      WHERE dispatch_key IS NOT NULL
        -- ★2026-08-28 sent(발송 종결)를 대조 대상에서 뺀다.
        --   아래 2번이 "live인데 원장이 queued가 아니다"를 예약 완료로 맞추는데 sent도 그 조건에 걸려
        --   매 tick 종결 상태를 queued로 되돌렸다(실측: 세 건의 updated_at이 같은 tick으로 갱신되고
        --   status는 queued 그대로). 적재 완료 캠페인은 inspectAttemptCampaign이 live로 보므로
        --   여기서 빼지 않으면 sent가 영영 남지 못한다.
        --   ⛔ cancelled는 빼지 마라 - 1번(예약 회수)이 그 상태를 대상으로 삼는다.
        --   ⛔ 이 안은 템플릿 리터럴이다. 주석에도 백틱을 쓰지 마라(문자열이 끊긴다).
        AND status NOT IN ('cancelling', 'sent')
        AND updated_at > NOW() - INTERVAL '30 days'
      ORDER BY updated_at DESC
      LIMIT 200`,
  );

  for (const row of rows.rows) {
    try {
      const found = await inspectAttemptCampaign(row.company_id, row.dispatch_key);
      if (!found.id) continue;

      // ① 나가면 안 되는데 살아 있다 = 되돌린다. 실패해도 다음 tick이 다시 한다.
      const mustNotSend = row.status === 'cancelled' || row.status === 'expired' || row.status === 'test_failed';
      if (mustNotSend && found.kind === 'live') {
        const { ok, error } = await neutralizeCampaign(
          row.id, row.company_id, found.id, `대행발송 ${row.status} 건의 예약 회수`,
        );
        await logEvent(row.id, 'reconciled_neutralize', { campaignId: found.id, ok, error });
        if (ok) {
          await query(
            `UPDATE agency_send_requests SET campaign_id = COALESCE(campaign_id, $2::uuid), updated_at = NOW()
              WHERE id = $1::uuid`,
            [row.id, found.id],
          );
        }
        continue;
      }

      // ② 살아 있는데 원장이 아직 따라오지 못했다 = 예약 완료로 맞춘다.
      if (found.kind === 'live' && row.status !== 'queued') {
        const fixed = await query(
          `UPDATE agency_send_requests
              SET status = 'queued', campaign_id = $2::uuid, queued_at = COALESCE(queued_at, NOW()),
                  lock_at = NULL, lock_token = NULL, revision = revision + 1, updated_at = NOW()
            WHERE id = $1::uuid AND revision = $3 AND status NOT IN ('cancelled','cancelling','sent')
            RETURNING id`,
          [row.id, found.id, row.revision],
        );
        if (fixed.rows.length > 0) {
          await logEvent(row.id, 'reconciled_queued', { campaignId: found.id, from: row.status });
        }
        continue;
      }

      // ③ 캐시만 비어 있으면 채운다(화면이 발송결과로 넘어갈 수 있게).
      if (!row.campaign_id) {
        await query(
          `UPDATE agency_send_requests SET campaign_id = $2::uuid, updated_at = NOW()
            WHERE id = $1::uuid AND campaign_id IS NULL`,
          [row.id, found.id],
        );
      }

      // ④ 예약된 건이 취소·중단됐다 = 원장에 반영하고 한 번만 알린다.
      if (row.status === 'queued' && found.kind === 'stopped') {
        const camp = await query(`SELECT status FROM campaigns WHERE id = $1::uuid`, [found.id]);
        if (camp.rows[0]?.status === 'cancelled') {
          const done = await query(
            `UPDATE agency_send_requests
                SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = $2,
                    revision = revision + 1, updated_at = NOW()
              WHERE id = $1::uuid AND status = 'queued' AND revision = $3
              RETURNING id`,
            [row.id, '예약이 취소되었습니다', row.revision],
          );
          if (done.rows.length > 0) await logEvent(row.id, 'reconciled_cancelled', { campaignId: found.id });
          continue;
        }
        // 적재가 예외로 끝났다. 일부는 이미 나갔을 수 있어 상태는 내리지 않고 한 번만 알린다.
        const told = await query(
          `SELECT 1 FROM agency_send_events WHERE request_id = $1::uuid AND kind = 'queue_failed' LIMIT 1`,
          [row.id],
        );
        if (told.rows.length === 0) {
          await logEvent(row.id, 'queue_failed', { campaignId: found.id });
          await notifyManager({
            companyId: row.company_id, requestId: row.id, phones: managerPhonesOf(row),
            callback: row.callback_number, title: '[대행발송] 확인 요청',
            text: buildQueueFailedNotify({ label: shortLabel(row.file_name || row.original_content) }),
          });
        }
      }
    } catch (err: any) {
      console.error(`${LOG} 대조 실패 request=${row.id}:`, err?.message || err);
    }
  }
}

// ────────────── F. 취소 마무리 ──────────────

/**
 * `cancelling`으로 남은 건을 끝까지 민다.
 *
 * 취소는 원장(PG)과 큐(MySQL) 두 곳을 건드리는 다단계 작업이라 한 트랜잭션으로 묶을 수 없다.
 * 라우트가 큐를 지우는 도중 죽으면 `cancelling`이 남는데, 그대로 두면 **큐는 살아 있고 화면만 취소 중**이다.
 *
 * ⛔ **갓 잡힌 건은 건드리지 않는다**(★2026-08-23 Codex 6R critical). 라우트가 지금 그 건을 처리하는 중일 수 있고,
 *   라우트는 시간 게이트(발송 15분 전)를 지키는데 여기는 그것을 넘긴다. 둘이 겹치면
 *   **사용자는 "취소하지 못했습니다"를 받았는데 예약은 취소되는** 어긋남이 생긴다.
 *   그래서 잡은 지 `CANCEL_HANDOVER_MINUTES`가 지난 건만 인수한다.
 * ⛔ 기준 시각(`lock_at`)은 잡을 때 한 번 찍고 **회전용 `updated_at`과 섞지 않는다.** 섞으면 매 tick
 *   기준이 앞으로 밀려 영영 인수되지 않는다.
 */
const CANCEL_HANDOVER_MINUTES = 2;

async function runCancelSweep(): Promise<void> {
  const rows = await query(
    `SELECT id, company_id, revision, campaign_id, dispatch_key, lock_at, updated_at
       FROM agency_send_requests
      WHERE status = 'cancelling'
        AND COALESCE(lock_at, updated_at) < NOW() - ($1::int * INTERVAL '1 minute')
      ORDER BY COALESCE(lock_at, updated_at)
      LIMIT 20`,
    [CANCEL_HANDOVER_MINUTES],
  );

  const now = Date.now();
  for (const row of rows.rows) {
    // ⛔ 한 건이 던져도 다음 건은 처리한다. 격리하지 않으면 실패한 한 건이 매 tick 배치를 멈춰
    //   뒤에 온 취소의 살아 있는 큐가 그대로 나간다.
    try {
      // 기준 시각을 아직 안 찍었으면 지금 한 번 고정한다(이후 회전에 흔들리지 않는다).
      if (!row.lock_at) {
        await query(`UPDATE agency_send_requests SET lock_at = NOW() WHERE id = $1::uuid AND lock_at IS NULL`, [row.id]);
      }

      // 근거는 시도 키 하나다.
      const found = await inspectAttemptCampaign(row.company_id, row.dispatch_key);

      if (found.id) {
        const { ok, error, alreadySent } = await neutralizeCampaign(row.id, row.company_id, found.id, '담당자 취소(마무리)');
        // ⛔ **막을 것이 없었다 = 이미 나갔다.** `cancelled`로 확정하면 고객은 받았는데 화면은 취소가 된다.
        //   예약(`queued`)으로 되돌리고 사실을 이벤트로 남긴다 — 캠페인이 있다는 것이 예약까지 갔던 증거다.
        if (ok && alreadySent) {
          await query(
            `UPDATE agency_send_requests
                SET status = 'queued', cancel_reason = NULL, lock_at = NULL,
                    revision = revision + 1, updated_at = NOW()
              WHERE id = $1::uuid AND status = 'cancelling'`,
            [row.id],
          );
          await logEvent(row.id, 'cancel_already_sent', { campaignId: found.id });
          console.warn(`${LOG} 이미 발송되어 취소하지 못함 request=${row.id}`);
          continue;
        }
        if (!ok) {
          await logEvent(row.id, 'cancel_sweep_retry', { campaignId: found.id, error });
          // 실패해도 `updated_at`을 밀어 **배치를 회전시킨다**. 안 밀면 영구 실패 스무 건이 앞자리를 차지해
          // 그 뒤에 취소를 누른 건의 살아 있는 큐가 한 번도 처리되지 않는다.
          await query(`UPDATE agency_send_requests SET updated_at = NOW() WHERE id = $1::uuid`, [row.id]);
          const tries = await query(
            `SELECT COUNT(*)::int AS c FROM agency_send_events WHERE request_id = $1::uuid AND kind = 'cancel_sweep_retry'`,
            [row.id],
          );
          if ((tries.rows[0]?.c || 0) >= 6) {
            try {
              await sendSystemAlert({
                dedupKey: `agency-cancel-stuck:${row.id}`,
                title: '대행발송 취소가 여러 번 시도해도 끝나지 않았습니다.',
                details: [`오류: ${error || '미상'}`],
                action: '발송 큐가 살아 있을 수 있습니다. 대행발송 접수 화면에서 확인해 주세요.',
              });
            } catch { /* 경보 실패가 배치를 멈추게 두지 않는다 */ }
          }
          continue;
        }
        if (!row.campaign_id) {
          await query(
            `UPDATE agency_send_requests SET campaign_id = $2::uuid, updated_at = NOW()
              WHERE id = $1::uuid AND campaign_id IS NULL`,
            [row.id, found.id],
          );
        }
      } else if (row.dispatch_key) {
        // ⛔ **"지금 캠페인이 없다"는 "앞으로도 없다"가 아니다.** 예약을 만들던 핸들러가 소유권을 잃은 뒤에도
        //   생성을 끝낼 수 있다. 그 창이 닫히기 전에 확정하지 않는다.
        //   ★ 확정한 뒤에 캠페인이 태어나도 **대조(워커 D)가 종결 상태까지 계속 보고 회수한다** — 여기서만 막지 않는다.
        const startedAt = new Date(row.lock_at || row.updated_at).getTime();
        if (now - startedAt < LOCK_STALE_MINUTES * 60000) {
          await query(`UPDATE agency_send_requests SET updated_at = NOW() WHERE id = $1::uuid`, [row.id]);
          continue;
        }
      }

      const done = await query(
        `UPDATE agency_send_requests
            SET status = 'cancelled', cancelled_at = NOW(), lock_at = NULL,
                revision = revision + 1, updated_at = NOW()
          WHERE id = $1::uuid AND status = 'cancelling'
          RETURNING id`,
        [row.id],
      );
      if (done.rows.length === 0) continue;
      await logEvent(row.id, 'cancel_swept', { campaignId: found.id });
      console.warn(`${LOG} 남은 취소를 마무리 request=${row.id}`);
    } catch (err: any) {
      console.error(`${LOG} 취소 마무리 실패 request=${row.id}:`, err?.message || err);
      await query(`UPDATE agency_send_requests SET updated_at = NOW() WHERE id = $1::uuid`, [row.id]).catch(() => {});
    }
  }
}

// ────────────── E. lock 복구 ──────────────

/**
 * ★2026-08-28 예약 시각이 지난 접수를 **발송 완료**로 넘긴다.
 *
 * 그전에는 적재(`queued`)가 마지막 상태라, 발송이 끝난 뒤에도 화면이 「예약 완료」로 남고
 * **취소 버튼이 계속 보였다**(서수란 접수 `cmtcgacmr03o8jnothzxrtrf6`). 누르면 되돌릴 것이 없어
 * 「취소 중」에 갇혔다.
 *
 * ⛔ 판정 기준은 상태 CT가 소유한다(`DELIVERED_BY_TIME_SQL`) — 이메일 중복 판정과 **같은 축**이다.
 *   여기서 따로 시각 규칙을 쓰면 한쪽은 끝난 건, 다른 쪽은 살아 있는 건으로 갈린다.
 * ⛔ 이 전이는 "큐가 비었다"가 아니라 "예약 시각이 지났다"를 뜻한다. 화면 표시와 취소 버튼을 위한 것이고,
 *   실제로 나갔는지의 최종 판정은 취소 시 `cancelCampaign`이 큐를 보고 한다(`alreadySent`).
 */
async function runMarkDelivered(): Promise<void> {
  const r = await query(
    `UPDATE agency_send_requests
        SET status = 'sent', updated_at = NOW()
      WHERE ${DELIVERED_BY_TIME_SQL}
      RETURNING id`,
  );
  if (r.rows.length > 0) console.log(`${LOG} 발송 완료로 넘김 ${r.rows.length}건`);
}

async function runLockRecovery(): Promise<void> {
  const rows = await query(
    `SELECT id, company_id, status, lock_at, lock_token, campaign_id, dispatch_key FROM agency_send_requests
      WHERE status IN ('testing','final_testing') LIMIT 50`,
  );
  const now = new Date();
  for (const row of rows.rows) {
    if (!isLockStale(row.status, row.lock_at ? new Date(row.lock_at) : null, now)) continue;

    // ⛔ 예약을 이미 만든 건은 잡기 전 상태로 되돌리지 않는다 — 되돌리면 다음 tick이 한 벌 더 만든다.
    //   원장의 `campaign_id`가 비어 있어도 캠페인은 있을 수 있다(적은 직후 죽는 창). 시도 키로 한 번 더 본다.
    // 근거는 시도 키 하나다. 원장의 `campaign_id`가 비어 있어도 캠페인은 있을 수 있다.
    const found = await inspectAttemptCampaign(row.company_id, row.dispatch_key);
    if (found.id) {
      // 살아 있으면 예약 완료로, 더 나가지 않으면 미발송으로 맞춘다(실패해도 대조가 다시 본다).
      const to = found.kind === 'live' ? 'queued' : 'expired';
      const extra = found.kind === 'live'
        ? { ...RELEASE, campaign_id: found.id, queued_at: new Date() }
        : { ...RELEASE, campaign_id: found.id, expired_at: new Date() };
      if (!await setStatus(row.id, to, extra, row.lock_token)) continue;
      await logEvent(row.id, 'lock_recovered', { from: row.status, to, campaignId: found.id });
      console.warn(`${LOG} 멈춘 건 복구 request=${row.id} ${row.status} → ${to}(예약 있음)`);
      continue;
    }

    const back = lockRecoveryStatus(row.status);
    if (!back) continue;
    // ⛔ 관찰한 소유권 토큰을 조건에 넣는다 — 그 사이 원래 핸들러가 끝냈으면 되돌리지 않는다.
    if (!await setStatus(row.id, back, { ...RELEASE }, row.lock_token)) continue;
    await logEvent(row.id, 'lock_recovered', { from: row.status, to: back });
    console.warn(`${LOG} 멈춘 건 복구 request=${row.id} ${row.status} → ${back}`);
  }
}

// ────────────── 진입 ──────────────

export async function runAgencySendWorker(): Promise<void> {
  try {
    await runCancelSweep();
    await runMarkDelivered();
    await runLockRecovery();
    await runFirstTest();
    await runFinalTest();
    await runExpire();
    await runReconcile();
  } catch (err: any) {
    // 테이블·컬럼이 아직 없으면(마이그레이션 전) 조용히 넘어간다.
    // ⛔ 컬럼도 함께 본다 — 테이블만 보면 신규 컬럼(`dispatch_key`) 배포 직후 tick이 5분마다 에러를 쌓는다.
    const msg = String(err?.message || '');
    if ((msg.includes('relation') || msg.includes('column')) && msg.includes('does not exist')) {
      console.warn(`${LOG} 원장이 아직 준비되지 않았다(마이그레이션 대기):`, msg);
      return;
    }
    console.error(`${LOG} tick 실패:`, err);
  }
}

/**
 * 승인 직후 예약을 만드는 즉시 진입점(★ 2026-08-23 신설).
 *
 * 재승인은 남은 시간이 짧다. 다음 tick(최대 5분)을 기다리면 그 사이에 만료 기준을 지나
 * "승인했는데 나가지 않은 건"이 생긴다. 1차 검사는 여기서 돌리지 않는다(몇 분씩 걸린다).
 * fire and forget — 실패해도 정기 tick이 다시 맡는다.
 */
export function triggerAgencySendDispatch(requestId: string): void {
  // ⛔ 전역 배치가 아니라 **그 건만** 집는다. 배치로 돌리면 앞자리 다섯 건에 가려 방금 승인한 건이 밀린다.
  runFinalTest(requestId).catch((err: any) => {
    console.error(`${LOG} 승인 직후 예약 시도 실패(정기 tick이 다시 맡는다) request=${requestId}:`, err?.message || err);
  });
}

/**
 * 접수 직후 1차 검사를 바로 시작하는 즉시 진입점(★2026-08-26(6) 신설).
 *
 * 리드타임 하한이 40분으로 내려오면서 **워커 주기 5분이 곧 승인 시간 5분**이 됐다. 접수한 그 순간
 * 검사를 시작하면 그 5분이 담당자에게 돌아간다. 승인 직후 예약(`triggerAgencySendDispatch`)과 같은 형태다.
 * fire and forget — 실패해도 정기 tick의 A단계가 다시 맡는다(선점이 CAS라 중복 실행도 한쪽만 잡는다).
 */
export function triggerAgencySendFirstTest(requestId: string): void {
  runFirstTest(requestId).catch((err: any) => {
    console.error(`${LOG} 접수 직후 검사 시도 실패(정기 tick이 다시 맡는다) request=${requestId}:`, err?.message || err);
  });
}

export function startAgencySendWorker(): void {
  setInterval(() => { runAgencySendWorker(); }, TICK_MS);
  console.log(`${LOG} 시작 (${TICK_MS / 60000}분 주기)`);
}
