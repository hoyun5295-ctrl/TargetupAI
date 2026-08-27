/**
 * utils/agency-send-mail-worker.ts — 대행발송 이메일 접수 워커 (★2026-08-26 §18 · 1분 폴링)
 *
 * hanjullo 메일함(POP3S)을 1분마다 짧은 세션으로 읽어, 허용 발신자의 요청서 메일을
 * 접수 코어(`createRequestCore`)로 넘긴다. 설계 = docs/2026-08-22-agency-send-design.md §18.
 *
 * ⛔ 불변(어기면 사고):
 *   - 서버 메일은 건드리지 않는다(DELE 0). 처리 상태의 진실 = intake 원장 단독(§18-5).
 *   - 신원 게이트 = allowlist_only(정확 일치). 판정·자격·ENV 확인은 접수 직전 **단일 지점**(§18-2).
 *   - ★0827 §18-13 귀속(청구 계정) 후보가 여럿이면 요청서 "청구 계정" 지정으로만 확정한다.
 *     돈 귀속이라 자동 선택 0 — 지정이 없거나 못 찾으면 반려(회신에 그 주소의 계정 목록 안내).
 *   - 신원 통과 전에는 본문·첨부를 내려받지 않는다(TOP 헤더만 · 무인증 첨부 폭탄 방어).
 *   - 확정 경로 AI 0(analyzeOneStep aiSuggest=false) · 리드타임 집행은 코어(pre.minLeadMinutes).
 *   - 반려 메일은 접수 행을 만들지 않는다(원장에만) · 회신은 발신 주소 ∧ 활성 허용 목록 교집합에만.
 *   - POP3 로그인 실패는 재시도(백오프) 금지: 3연속이면 폴링 정지 + 즉시 경보 + 사람이 재개(계정 잠금 방지).
 *   - accepted·request_ids는 성공 분기에서만 적는다(통과 스탬프 원칙).
 * 테이블 부재(마이그레이션 전)는 조용히 넘어간다(agency-send-worker와 같은 안전망).
 */
import crypto from 'crypto';
import { simpleParser, type ParsedMail } from 'mailparser';
import pool, { query } from '../config/database';
import { Pop3Client, Pop3Error } from './pop3-client';
import { resolveEmailSender, matchBillingTarget, describeBillingTargets, type SenderCandidate } from './agency-send-email';
import { canUseAgencySend, loadPlanContext } from './plan-guard';
import { getRegisteredCallbackSet } from './callback-filter';
import {
  analyzeOneStep, createRequestCore, loadSendWindow, logEvent, parseOneStepOverrides,
} from './agency-send-intake';
import {
  parseAgencyRequestForm, parseAgencyRecipientList, pickPhoneColumnStrict, resolveCallbackPlan,
  looksLikeRequestForm, hasRecipientSheet,
} from './agency-send-form';
import { extractAgencyVars } from './agency-send-vars';
import { EMAIL_MIN_LEAD_MINUTES, EMAIL_DUP_BLOCKING_SQL } from './agency-send-state';
import { agencyMailUser, isAgencyMailerReady, sendAgencyReplyMail } from './agency-mailer';
import { sendSystemAlert } from './system-alert';

const TICK_MS = 60_000;
/** 한 틱 처리 통수 상한(재기동 후에도 동일 · 반려 회신 폭주 완충 · §18-7) */
const MAX_PER_TICK = 10;
/** RETR 전에 거르는 메일 전체 크기 상한(첨부 합계 15MB + 인코딩 여유) */
const MAX_MESSAGE_OCTETS = 25 * 1024 * 1024;
const MAX_ATTACH_TOTAL = 15 * 1024 * 1024;
const MAX_ATTACH_FILES = 5;
/**
 * 일일 상한 = KST 당일 **메일 통수** 기준(§18-7).
 *
 * ★2026-08-26(6) Harold 지시로 **기본 무제한**(0 = 제한 없음). 옛 5/10은 From 위조 접수의 피해 규모를
 *   묶는 완충이었는데, 실제 방벽은 그것이 아니라 **담당자 승인 게이트**다(승인 없이 나가는 경로가 0).
 *   그리고 검사·테스트 문자 비용은 대행을 요청한 고객사 몫이므로(설계서 §0 확정) 접수가 늘어 문자가
 *   느는 것은 정상 동작이지 사고가 아니다.
 * ⛔ 판정 코드는 남긴다 — 폭주가 실제로 오면 서버에서 ENV 값만 넣어 다시 조인다(코드 배포 없이).
 */
const DAILY_SENDER_LIMIT = Number(process.env.AGENCY_MAIL_DAILY_SENDER_LIMIT || 0);
const DAILY_COMPANY_LIMIT = Number(process.env.AGENCY_MAIL_DAILY_COMPANY_LIMIT || 0);
const REPLY_MAX_ATTEMPTS = 3;
const REPLY_RATE_PER_HOUR = 5;
const CLAIM_STALE_MS = 10 * 60 * 1000;
const FAIL_MAX_ATTEMPTS = 4;
/** 백오프 계단(분) — 네트워크·DB 일시 장애만 탄다. 파싱·신원 반려는 0회 즉시 확정 */
const RETRY_STEPS_MIN = [1, 5, 30, 120];
const POLL_STALL_ALERT_MS = 30 * 60 * 1000;
const LOGIN_FAIL_PAUSE_AT = 3;

const log = (msg: string) => console.log(`[agency-mail] ${msg}`);
const isMissingRelation = (err: any) => {
  const msg = String(err?.message || '');
  return (msg.includes('relation') || msg.includes('column')) && msg.includes('does not exist');
};

const sha256 = (v: string | Buffer) => crypto.createHash('sha256').update(v).digest('hex');

/** KST 당일 자정(UTC 시각) — 일일 상한의 기준선 */
function kstMidnight(now: Date): Date {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - 9 * 60 * 60 * 1000);
}

function isEnabled(): boolean {
  return String(process.env.AGENCY_MAIL_ENABLED || '').trim() === 'true' && isAgencyMailerReady();
}

// ────────────── 워커 상태 원장(agency_send_mail_state) — 마지막 성공 폴링·로그인 실패·정지 ──────────────
// ⛔ 메모리에 두면 pm2 재기동마다 리셋돼 정체가 영영 30분을 못 채운다(회의론자 11). 재개 = paused_at NULL로.

async function loadMailState(mailbox: string): Promise<{ lastOkAt: Date | null; loginFailCount: number; pausedAt: Date | null } | null> {
  try {
    const r = await query(
      `SELECT last_ok_at, login_fail_count, paused_at FROM agency_send_mail_state WHERE mailbox = $1`, [mailbox],
    );
    const row = r.rows[0];
    return {
      lastOkAt: row?.last_ok_at ? new Date(row.last_ok_at) : null,
      loginFailCount: Number(row?.login_fail_count) || 0,
      pausedAt: row?.paused_at ? new Date(row.paused_at) : null,
    };
  } catch (err: any) {
    if (isMissingRelation(err)) return null; // 마이그레이션 전 — 상태 없이 진행(경보 축만 약해진다)
    throw err;
  }
}

async function saveMailStateOk(mailbox: string): Promise<void> {
  try {
    await query(
      `INSERT INTO agency_send_mail_state (mailbox, last_ok_at, login_fail_count, updated_at)
       VALUES ($1, NOW(), 0, NOW())
       ON CONFLICT (mailbox) DO UPDATE SET last_ok_at = NOW(), login_fail_count = 0, updated_at = NOW()`,
      [mailbox],
    );
  } catch (err: any) {
    if (!isMissingRelation(err)) throw err;
  }
}

async function recordLoginFail(mailbox: string): Promise<number> {
  try {
    const r = await query(
      `INSERT INTO agency_send_mail_state (mailbox, login_fail_count, updated_at)
       VALUES ($1, 1, NOW())
       ON CONFLICT (mailbox) DO UPDATE SET login_fail_count = agency_send_mail_state.login_fail_count + 1, updated_at = NOW()
       RETURNING login_fail_count`,
      [mailbox],
    );
    return Number(r.rows[0]?.login_fail_count) || 1;
  } catch (err: any) {
    if (isMissingRelation(err)) return 1;
    throw err;
  }
}

async function pauseMailbox(mailbox: string, reason: string): Promise<void> {
  try {
    await query(
      `UPDATE agency_send_mail_state SET paused_at = NOW(), paused_reason = $2, updated_at = NOW() WHERE mailbox = $1`,
      [mailbox, reason.slice(0, 200)],
    );
  } catch (err: any) {
    if (!isMissingRelation(err)) throw err;
  }
}

// ────────────── 회신 문안(사용자 노출 · ⛔ 줄표 0 · 내부 자산 목록·접수 id·내부 식별자 금지) ──────────────

function buildAcceptedReply(input: {
  subject: string; content: string; requestedAtIso: string; callback: string;
  managerPhones: string[]; phoneColumn: string; autoPickedPhoneColumn: boolean;
  total: number; valid: number; dup: number; invalid: number;
  /** ★2026-08-26(6) 촉박해서 시각을 자동 조정했으면 원본 시각. 이메일은 확인 화면이 없어 이 회신이 유일한 고지다 */
  originalAtIso?: string | null;
}): string {
  const when = new Date(input.requestedAtIso);
  const p = (n: number) => String(n).padStart(2, '0');
  const fmt = (d: Date) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  const whenText = fmt(when);
  const shiftedNote = input.originalAtIso
    ? `보낼 시각: ${whenText} (요청하신 ${fmt(new Date(input.originalAtIso))}은 준비 시간이 촉박해 뒤로 옮겼습니다)`
    : `보낼 시각: ${whenText}`;
  const lines = [
    '대행발송 접수가 완료되었습니다.',
    '',
    `제목: ${input.subject || '(없음)'}`,
    shiftedNote,
    `회신번호: ${input.callback}`,
    `담당자 번호: ${input.managerPhones.join(', ')}`,
    `수신자 열: ${input.phoneColumn}${input.autoPickedPhoneColumn ? ' (자동 선정)' : ''}`,
    `보낼 인원: ${input.valid.toLocaleString()}명 (명단 ${input.total.toLocaleString()}행, 중복 ${input.dup}건, 형식 오류 ${input.invalid}건 제외)`,
    '',
    '문안:',
    input.content,
    '',
    '담당자 승인 전에는 발송되지 않습니다. 담당자 휴대폰으로 검사와 승인 안내 문자가 갑니다.',
    '실제 치환된 문장은 담당자 휴대폰으로 가는 테스트 문자에서 확인해 주세요.',
    `진행 상황 확인: ${String(process.env.HANJUL_BASE_URL || 'https://hanjul.ai').replace(/\/+$/, '')}/agency-send`,
  ];
  return lines.join('\n');
}

function buildRejectedReply(reasons: string[], listHeaders?: string[]): string {
  const lines = [
    '보내주신 요청서를 접수하지 못했습니다. 아래 사유를 고쳐 다시 보내주세요.',
    '',
    ...reasons.map((r, i) => `${i + 1}. ${r}`),
  ];
  if (listHeaders && listHeaders.length > 0) {
    lines.push('', `명단의 열 이름: ${listHeaders.join(', ')}`);
  }
  lines.push('', '고친 파일을 이 메일에 회신하시면 다시 접수됩니다.');
  return lines.join('\n');
}

// ────────────── intake 원장 ──────────────

interface IntakeRow { id: string; status: string; attempt_count: number }

async function claimIntake(mailbox: string, uidl: string, messageId: string | null, messageHash: string, fromEmail: string | null): Promise<IntakeRow | null> {
  // 재처리 경로: failed(재시도 창) · claimed(10분 초과 = 중간 사망)를 관찰값 CAS로 다시 잡는다
  const existing = await query(
    `SELECT id, status, attempt_count, claimed_at, next_attempt_at FROM agency_send_email_intake WHERE mailbox = $1 AND uidl = $2`,
    [mailbox, uidl],
  );
  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    if (row.status === 'failed' && Number(row.attempt_count) < FAIL_MAX_ATTEMPTS
      && (!row.next_attempt_at || new Date(row.next_attempt_at).getTime() <= Date.now())) {
      const re = await query(
        `UPDATE agency_send_email_intake SET status = 'claimed', claimed_at = NOW(), attempt_count = attempt_count + 1, updated_at = NOW()
          WHERE id = $1 AND status = 'failed' RETURNING id, status, attempt_count`,
        [row.id],
      );
      return re.rows[0] || null;
    }
    if (row.status === 'claimed' && row.claimed_at && Date.now() - new Date(row.claimed_at).getTime() > CLAIM_STALE_MS) {
      // ⛔ 타임스탬프 동등 비교 CAS 금지(★적대 3R) — PG 마이크로초 ↔ 드라이버 밀리초 왕복 불일치로
      //   정상 소유자도 0행이 된다(0824 DM 사고 부류 · memory feedback_no_timestamp_as_fencing_token).
      //   동시 실행은 advisory lock이 이미 막으므로, 재선점 조건은 "충분히 오래 잠겨 있었다"로 건다.
      const re = await query(
        `UPDATE agency_send_email_intake SET claimed_at = NOW(), attempt_count = attempt_count + 1, updated_at = NOW()
          WHERE id = $1 AND status = 'claimed' AND claimed_at < NOW() - ($2::int * interval '1 millisecond')
          RETURNING id, status, attempt_count`,
        [row.id, CLAIM_STALE_MS],
      );
      return re.rows[0] || null;
    }
    return null; // 이미 처리됐거나 다른 실행이 잡고 있다(멱등 1층)
  }
  try {
    const ins = await query(
      `INSERT INTO agency_send_email_intake (mailbox, uidl, message_id, message_hash, from_email, status)
       VALUES ($1, $2, $3, $4, $5, 'claimed')
       ON CONFLICT (mailbox, uidl) DO NOTHING
       RETURNING id, status, attempt_count`,
      [mailbox, uidl, messageId, messageHash, fromEmail],
    );
    return ins.rows[0] || null;
  } catch (err: any) {
    if (err?.code === '23505') {
      // (mailbox, message_hash) 충돌 = 같은 메일이 다른 UIDL로 다시 왔다(2층). 파생 해시로 기록만 남긴다(무회신 · §18-6)
      const ins = await query(
        `INSERT INTO agency_send_email_intake (mailbox, uidl, message_id, message_hash, from_email, status, reason, decided_at)
         VALUES ($1, $2, $3, $4, $5, 'rejected', 'duplicate_message', NOW())
         ON CONFLICT (mailbox, uidl) DO NOTHING RETURNING id`,
        [mailbox, uidl, messageId, sha256(`dup:${uidl}:${messageHash}`), fromEmail],
      );
      if (ins.rows.length > 0) log(`같은 메일 재수신 기록(무동작): uidl=${uidl}`);
      return null;
    }
    throw err;
  }
}

async function finalizeIntake(id: string, status: 'rejected' | 'failed' | 'accepted', fields: {
  reason?: string; companyId?: string | null; userId?: string | null; requestIds?: string[];
  replyStatus?: string | null; nextAttemptMin?: number | null;
}): Promise<void> {
  await query(
    `UPDATE agency_send_email_intake
        SET status = $2,
            reason = COALESCE($3, reason),
            company_id = COALESCE($4::uuid, company_id),
            user_id = COALESCE($5::uuid, user_id),
            request_ids = COALESCE($6::uuid[], request_ids),
            reply_status = COALESCE($7, reply_status),
            next_attempt_at = CASE WHEN $8::int IS NULL THEN next_attempt_at ELSE NOW() + ($8::int * interval '1 minute') END,
            decided_at = NOW(), updated_at = NOW()
      WHERE id = $1`,
    [id, status, fields.reason?.slice(0, 200) ?? null, fields.companyId ?? null, fields.userId ?? null,
      fields.requestIds ?? null, fields.replyStatus ?? null, fields.nextAttemptMin ?? null],
  );
}

/** 회신 상한: 같은 주소 1시간 5통(§18-7). 같은 사유의 중복 안내 24시간 1회(§18-6 3층) */
async function replyAllowed(mailbox: string, toEmail: string, onceADayReason?: string): Promise<boolean> {
  const hourly = await query(
    `SELECT COUNT(*)::int AS c FROM agency_send_email_intake
      WHERE mailbox = $1 AND from_email = $2 AND reply_status = 'sent' AND decided_at > NOW() - interval '1 hour'`,
    [mailbox, toEmail],
  );
  if ((hourly.rows[0]?.c || 0) >= REPLY_RATE_PER_HOUR) return false;
  if (onceADayReason) {
    const daily = await query(
      `SELECT COUNT(*)::int AS c FROM agency_send_email_intake
        WHERE mailbox = $1 AND from_email = $2 AND reason = $3 AND reply_status = 'sent' AND decided_at > NOW() - interval '24 hours'`,
      [mailbox, toEmail, onceADayReason],
    );
    if ((daily.rows[0]?.c || 0) > 0) return false;
  }
  return true;
}

async function sendReplyAndRecord(intakeId: string, mailbox: string, toEmail: string, subject: string, text: string, inReplyTo: string | null, onceADayReason?: string, keepPendingOnRateLimit = false): Promise<void> {
  if (!(await replyAllowed(mailbox, toEmail, onceADayReason))) {
    // ★적대 2R: 접수 완료 회신은 유일한 통지라 상한에 걸려도 pending으로 남겨 재시도 패스가 다시 잡게 한다.
    //   반려 안내는 여기서 접는다(skipped) — 재전송하면 새 회신 기회가 생긴다.
    if (!keepPendingOnRateLimit) {
      await query(`UPDATE agency_send_email_intake SET reply_status = 'skipped', updated_at = NOW() WHERE id = $1`, [intakeId]);
    }
    return;
  }
  const r = await sendAgencyReplyMail({ to: toEmail, subject, text, inReplyTo });
  await query(
    `UPDATE agency_send_email_intake SET reply_status = $2, reply_attempts = reply_attempts + 1, updated_at = NOW() WHERE id = $1`,
    [intakeId, r.outcome === 'sent' ? 'sent' : r.outcome === 'rejected' ? 'rejected' : 'unknown'],
  );
  if (r.outcome !== 'sent') log(`회신 미확정(${r.outcome}): to=${toEmail} ${r.detail}`);
}

// ────────────── 메시지 1통 처리(통 단위 격리 · §18-5) ──────────────

interface TickCtx { client: Pop3Client; mailbox: string; octets: Map<number, number>; now: Date }

async function processMessage(ctx: TickCtx, seq: number, uidl: string): Promise<void> {
  // 1) 헤더만 받는다 — 신원 판정 전 첨부 미다운로드(§18-5)
  const headerBuf = await ctx.client.top(seq);
  const head: ParsedMail = await simpleParser(headerBuf);
  const fromAddr = head.from?.value?.[0]?.address || '';
  const messageId = head.messageId ? String(head.messageId).slice(0, 990) : null;
  const messageHash = sha256(messageId ? `mid:${messageId}` : headerBuf);

  // 자동 발신 메일은 접수 대상이 아니다(자동응답 루프 방지 · §18-5)
  const auto = String(head.headers.get('auto-submitted') || '').toLowerCase();
  const precedence = String(head.headers.get('precedence') || '').toLowerCase();
  const isAuto = (auto && auto !== 'no') || precedence === 'bulk' || precedence === 'list' || head.headers.has('list-id');

  // 2) 신원 판정(allowlist_only · §18-2)
  const sender = await resolveEmailSender(fromAddr);

  // 3) 선점 — 본문 내려받기 전(멱등 1층 arbiter)
  const claimed = await claimIntake(ctx.mailbox, uidl, messageId, messageHash, fromAddr || null);
  if (!claimed) return;

  if (isAuto) {
    await finalizeIntake(claimed.id, 'rejected', { reason: 'auto_submitted', replyStatus: 'skipped' });
    return;
  }
  if (sender.outcome === 'unregistered') {
    await finalizeIntake(claimed.id, 'rejected', { reason: 'unregistered', replyStatus: 'skipped' });
    await sendSystemAlert({
      dedupKey: 'agency-mail-unknown-sender',
      message: `대행발송 메일함에 미등록 발신 메일이 왔습니다(회신 없이 기록). 최근 예: ${fromAddr || '(주소 없음)'}`,
      cooldownMs: 6 * 60 * 60 * 1000,
    });
    return;
  }
  if (sender.outcome === 'owner_inactive') {
    await finalizeIntake(claimed.id, 'rejected', { reason: 'owner_inactive', companyId: sender.companyId, replyStatus: 'pending' });
    await sendReplyAndRecord(claimed.id, ctx.mailbox, fromAddr, '[한줄로] 대행발송 접수 불가',
      buildRejectedReply(['접수 설정에 문제가 있어 접수되지 않았습니다. 한줄로 담당자에게 문의해 주세요.']), messageId, 'owner_inactive');
    await sendSystemAlert({
      // ★0827 회사 미확정(여러 회사에 걸린 주소)이면 주소로 dedup — null 키 하나로 전 주소가 접히면 안 된다
      dedupKey: `agency-mail-owner-inactive:${sender.companyId ?? fromAddr}`,
      message: `대행발송 허용 이메일의 귀속 사용자가 비활성입니다. 접수가 반려되고 있습니다: ${fromAddr}`,
      cooldownMs: 6 * 60 * 60 * 1000,
    });
    return;
  }

  // ★2026-08-27 §18-13 — 사용 가능한 귀속(청구 계정)이 1개면 즉시 확정, 여러 개면 요청서의
  //   "청구 계정" 지정으로 확정을 미룬다. 돈 귀속이라 자동 선택은 없다(지정 못 하면 반려).
  let auth: { companyId: string; userId: string } | null =
    sender.outcome === 'ok' ? { companyId: sender.candidate.companyId, userId: sender.candidate.userId } : null;
  const candidates: SenderCandidate[] = sender.outcome === 'ok' ? [sender.candidate] : sender.candidates;

  // 4) 일일 상한(메일 통수 · KST 당일 · §18-7) — 초과는 지연이 아니라 거절.
  //    ★2026-08-26(6) 값이 0이면 그 축은 아예 세지 않는다(기본 무제한 · 쿼리도 돌지 않는다).
  const midnight = kstMidnight(ctx.now).toISOString();
  if (DAILY_SENDER_LIMIT > 0) {
    const senderCount = await query(
      `SELECT COUNT(*)::int AS c FROM agency_send_email_intake WHERE mailbox = $1 AND from_email = $2 AND claimed_at >= $3::timestamptz AND id <> $4`,
      [ctx.mailbox, fromAddr, midnight, claimed.id],
    );
    if ((senderCount.rows[0]?.c || 0) >= DAILY_SENDER_LIMIT) {
      await finalizeIntake(claimed.id, 'rejected', { reason: 'daily_sender_limit', companyId: auth?.companyId ?? null, userId: auth?.userId ?? null, replyStatus: 'pending' });
      await sendReplyAndRecord(claimed.id, ctx.mailbox, fromAddr, '[한줄로] 대행발송 접수 불가',
        buildRejectedReply([`이 주소로는 하루 ${DAILY_SENDER_LIMIT}통까지 접수할 수 있습니다. 내일 다시 보내시거나 화면에서 접수해 주세요.`]), messageId, 'daily_sender_limit');
      return;
    }
  }

  // 4b+5) 회사 축 게이트(일일 상한 company + 자격) — **귀속 확정 직후** 한 자리에서만 부른다(판정 두 벌 금지).
  //   후보 1개 경로는 여기(첨부 내려받기 전 = 기존 방어 유지), 후보 여러 개 경로는 요청서에서 청구 계정을
  //   확정한 직후(구조상 RETR 뒤일 수밖에 없다 — 후보 전원이 등록 회사라 §18-2 우회 입구는 아니다).
  const enforceCompanyGates = async (acct: { companyId: string; userId: string }): Promise<boolean> => {
    if (DAILY_COMPANY_LIMIT > 0) {
      const companyCount = await query(
        `SELECT COUNT(*)::int AS c FROM agency_send_email_intake WHERE mailbox = $1 AND company_id = $2::uuid AND claimed_at >= $3::timestamptz AND id <> $4`,
        [ctx.mailbox, acct.companyId, midnight, claimed.id],
      );
      if ((companyCount.rows[0]?.c || 0) >= DAILY_COMPANY_LIMIT) {
        await finalizeIntake(claimed.id, 'rejected', { reason: 'daily_company_limit', companyId: acct.companyId, userId: acct.userId, replyStatus: 'pending' });
        await sendReplyAndRecord(claimed.id, ctx.mailbox, fromAddr, '[한줄로] 대행발송 접수 불가',
          buildRejectedReply([`회사 기준 하루 ${DAILY_COMPANY_LIMIT}통까지 접수할 수 있습니다. 내일 다시 보내시거나 화면에서 접수해 주세요.`]), messageId, 'daily_company_limit');
        return false;
      }
    }
    // 자격(회사 스위치 AND 유료) — 네 번째 우회 입구 방지(§18-2)
    const ctxPlan = await loadPlanContext(acct.companyId);
    if (!canUseAgencySend(ctxPlan)) {
      await finalizeIntake(claimed.id, 'rejected', { reason: 'not_allowed', companyId: acct.companyId, userId: acct.userId, replyStatus: 'pending' });
      await sendReplyAndRecord(claimed.id, ctx.mailbox, fromAddr, '[한줄로] 대행발송 접수 불가',
        buildRejectedReply(['대행발송이 열려 있지 않은 계정입니다. 한줄로 담당자에게 문의해 주세요.']), messageId, 'not_allowed');
      return false;
    }
    return true;
  };
  if (auth && !(await enforceCompanyGates(auth))) return;

  // 6) 크기 게이트(RETR 전 · 첨부 폭탄 방어)
  const octets = ctx.octets.get(seq) || 0;
  if (octets > MAX_MESSAGE_OCTETS) {
    await finalizeIntake(claimed.id, 'rejected', { reason: 'too_large', companyId: auth?.companyId ?? null, userId: auth?.userId ?? null, replyStatus: 'pending' });
    await sendReplyAndRecord(claimed.id, ctx.mailbox, fromAddr, '[한줄로] 대행발송 접수 불가',
      buildRejectedReply(['메일이 너무 큽니다. 요청서 양식 파일 하나만 첨부해 다시 보내주세요(15MB 이내).']), messageId);
    return;
  }

  // 7) 본문·첨부 수신 + 규격 검사(§18-3)
  const raw = await ctx.client.retr(seq);
  const mail: ParsedMail = await simpleParser(raw);
  const atts = (mail.attachments || []).filter((a) => a.contentDisposition !== 'inline' && !a.cid);
  // 청구 계정 미확정(auth null) 반려는 회사·사용자 없이 기록한다 — 후보가 여러 회사일 수 있어 추정 기록은 오귀속이다
  const reject = async (reasons: string[], reasonCode: string, headers?: string[]) => {
    await finalizeIntake(claimed.id, 'rejected', { reason: reasonCode, companyId: auth?.companyId ?? null, userId: auth?.userId ?? null, replyStatus: 'pending' });
    await sendReplyAndRecord(claimed.id, ctx.mailbox, fromAddr, '[한줄로] 대행발송 접수 불가', buildRejectedReply(reasons, headers), messageId);
  };

  if (atts.some((a) => String(a.contentType || '').startsWith('image/'))) {
    await reject(['이미지가 첨부되어 있습니다. 이미지 문자는 화면 접수에서 이미지를 붙여 진행해 주세요. 메일 접수는 짧은 문자와 긴 문자만 받습니다.'], 'has_image');
    return;
  }
  if (atts.some((a) => /\.zip$/i.test(String(a.filename || '')))) {
    await reject(['압축(zip) 파일은 받지 않습니다. 요청서와 명단을 각각 엑셀 또는 CSV로 첨부해 주세요.'], 'zip_not_allowed');
    return;
  }
  if (atts.length > MAX_ATTACH_FILES) {
    await reject([`첨부가 ${atts.length}개입니다. 요청서 파일 하나만 첨부해 주세요.`], 'too_many_files');
    return;
  }
  if (atts.reduce((a, b) => a + (b.size || b.content?.length || 0), 0) > MAX_ATTACH_TOTAL) {
    await reject(['첨부 용량이 큽니다. 15MB 이내로 보내주세요.'], 'attachments_too_large');
    return;
  }
  // ★2026-08-26(2) 표준 = 통일 양식 **한 파일**(시트1 내용 + 시트2 고객리스트). 요청서와 명단을
  //   두 파일로 나눠 첨부한 메일도 그대로 받는다(반려당할 이유가 없는 메일을 반려하지 않는다).
  const sheets = atts.filter((a) => /\.(xlsx|xls|csv)$/i.test(String(a.filename || '')));
  let formBuf: Buffer;
  let listBuf: Buffer;
  let listName: string;
  if (sheets.length === 1) {
    const buf = sheets[0].content as Buffer;
    if (!looksLikeRequestForm(buf) || !hasRecipientSheet(buf)) {
      await reject(['첨부한 파일에서 요청서(내용 시트)와 고객리스트 시트를 함께 찾지 못했습니다. 내려받은 양식 그대로 첫 시트에 내용을, 고객리스트 시트에 명단을 채워 첨부해 주세요.'], 'form_not_identified');
      return;
    }
    formBuf = buf;
    listBuf = buf;
    listName = String(sheets[0].filename || '대행발송요청서.xlsx');
  } else if (sheets.length === 2) {
    const forms = sheets.filter((a) => looksLikeRequestForm(a.content as Buffer));
    if (forms.length !== 1) {
      await reject(['어느 파일이 요청서인지 확인하지 못했습니다. 요청서는 내려받은 양식을 그대로 채워 첨부해 주세요.'], 'form_not_identified');
      return;
    }
    const formAtt = forms[0];
    const listAtt = sheets.find((a) => a !== formAtt)!;
    formBuf = formAtt.content as Buffer;
    listBuf = listAtt.content as Buffer;
    listName = String(listAtt.filename || '고객명단.xlsx');
  } else {
    await reject(['요청서 양식 파일(내용 시트 + 고객리스트 시트)을 한 개 첨부해 주세요. 지금은 표 파일이 ' + sheets.length + '개입니다.'], 'attachments_invalid');
    return;
  }

  // 8) 이메일 전용 사전 게이트(§18-3) — 확인 화면이 없는 경로의 추가 반려 규칙
  const form = parseAgencyRequestForm(formBuf);

  // 8b) ★2026-08-27 §18-13 청구 계정 확정 — 후보가 여럿이면 요청서의 "청구 계정" 지정이 필수다.
  //   돈 귀속(created_by = 발송·정산 계정)이라 자동 선택은 없다. 하나여도 지정이 적혀 있으면 대조해서
  //   다르면 반려한다(담당자가 지정한 계정과 다른 계정으로 조용히 청구되는 경로 차단).
  //   ⛔ 확정은 form 기반 반려(이미지 파일명 등)보다 **먼저**다(★0827 Codex 1R) — 청구 계정이 제대로
  //   적힌 반려 건이 회사·사용자 없이 기록되고 회사 축 상한·자격을 건너뛰면 원장과 상한이 부정확해진다.
  const targetList = describeBillingTargets(candidates);
  if (!auth) {
    if (!form.billingTarget) {
      await reject([`이 이메일 주소는 청구 계정 여러 개에 등록되어 있어 어느 계정으로 접수할지 지정이 필요합니다. 요청서 빈 줄에 "청구 계정" 항목을 추가하고 다음 중 하나를 적어 다시 보내주세요: ${targetList}`], 'billing_target_required');
      return;
    }
    const match = matchBillingTarget(candidates, form.billingTarget);
    if (match.outcome === 'not_found') {
      await reject([`요청서에 적힌 청구 계정 "${form.billingTarget}"을(를) 찾지 못했습니다. 다음 중 하나를 그대로 적어 주세요: ${targetList}`], 'billing_target_not_found');
      return;
    }
    if (match.outcome === 'ambiguous') {
      await reject([`요청서에 적힌 청구 계정 "${form.billingTarget}"이(가) 등록된 계정 여러 개와 일치합니다. 한줄로 담당자에게 표시명 정리를 요청해 주세요.`], 'billing_target_ambiguous');
      await sendSystemAlert({
        dedupKey: `agency-mail-billing-target-ambiguous:${fromAddr}`,
        message: `대행발송 허용 이메일의 청구 계정 표시명이 겹칩니다(지정 판정 불가·반려 중): ${fromAddr}`,
        cooldownMs: 60 * 60 * 1000,
      });
      return;
    }
    auth = { companyId: match.candidate.companyId, userId: match.candidate.userId };
    if (!(await enforceCompanyGates(auth))) return;
  } else if (form.billingTarget) {
    const match = matchBillingTarget(candidates, form.billingTarget);
    if (match.outcome !== 'matched' || match.candidate.userId !== auth.userId) {
      await reject([`요청서에 적힌 청구 계정 "${form.billingTarget}"은(는) 이 이메일 주소로 요청할 수 있는 계정이 아닙니다. 이 주소로 요청할 수 있는 계정: ${targetList}`], 'billing_target_mismatch');
      return;
    }
  }
  const acct = auth;

  // ★2026-08-26(2) 요청서의 "이미지 파일명" 칸에 값이 있으면 반려 — 이 경로는 이미지 첨부 자체를
  //   안 받으므로(has_image), 이름만 적힌 이미지는 실리지 못한 채 문자만 나간다(기대와 다른 발송).
  if (form.imageFileName) {
    await reject(['요청서에 이미지 파일명이 적혀 있습니다. 이미지 문자는 화면 접수에서 이미지를 붙여 진행해 주세요. 메일 접수는 짧은 문자와 긴 문자만 받습니다.'], 'has_image');
    return;
  }
  let list: ReturnType<typeof parseAgencyRecipientList> | null = null;
  try { list = parseAgencyRecipientList(listBuf); } catch { list = null; }
  if (list) {
    if (list.headerless && extractAgencyVars(form.content).length > 0) {
      await reject(['명단 첫 줄에 열 이름이 없어서 문안의 %항목%을 연결할 수 없습니다. 첫 줄에 열 이름을 넣거나 문안에서 항목을 빼 주세요.'], 'headerless_with_vars');
      return;
    }
    if (!form.errors.some((e) => e.field === '회신번호') && resolveCallbackPlan(form.callbackRaw, list.headers).mode === 'column') {
      await reject(['회신번호가 명단 열로 지정되어 접수가 여러 건으로 나뉩니다. 이 방식은 나뉘는 건수를 확인해야 해서 화면 접수에서 진행해 주세요.'], 'callback_column_mode', list.headers);
      return;
    }
  }
  let autoPickedPhoneColumn = false;
  const overridesRaw: Record<string, any> = {};
  if (list && !form.phoneColumnName) {
    const strictCol = pickPhoneColumnStrict(list.headers, list.rows);
    if (!strictCol) {
      await reject(['휴대폰 번호 열을 확실하게 고르지 못했습니다. 요청서의 "수신자 열 이름" 칸에 명단의 열 이름을 적어 다시 보내주세요.'], 'phone_column_ambiguous', list.headers);
      return;
    }
    overridesRaw.phoneColumn = strictCol;
    autoPickedPhoneColumn = true;
  }

  // 9) 분석(확정 경로 · AI 0 · 리드타임 240은 코어와 같은 상수) — 반려 사유는 전량 회신에 싣는다
  const overrides = parseOneStepOverrides(overridesRaw);
  const analysis = await analyzeOneStep(acct, formBuf, listBuf, listName, overrides, false, EMAIL_MIN_LEAD_MINUTES);
  if (analysis.errors.length > 0) {
    await reject(analysis.errors.map((e) => `[${e.field}] ${e.error}`), 'form_invalid', analysis.headers);
    return;
  }
  if (analysis.counts.valid === 0) {
    await reject(['보낼 수 있는 번호가 없습니다. 명단 파일에 휴대폰 번호가 든 행이 있는지 확인해 주세요.'], 'no_recipients');
    return;
  }
  if (analysis.callback.mode !== 'fixed' || analysis.groups.length !== 1) {
    await reject(['회신번호를 확인하지 못했습니다. 등록된 발신번호 하나를 적어 주세요.'], 'callback_invalid');
    return;
  }
  const group = analysis.groups[0];

  // 10) 3층 멱등 — 내용 4요소(회사·문안·시각·정렬된 번호 집합)가 미종결·발송 전 건과 같으면 차단(§18-6)
  const phones = group.recipients.map((r) => r.phone).sort();
  const recipientsHash = sha256(phones.join(','));
  const dupCandidates = await query(
    `SELECT id FROM agency_send_requests
      WHERE company_id = $1::uuid AND requested_at = $2::timestamptz AND original_content = $3 AND ${EMAIL_DUP_BLOCKING_SQL}
      LIMIT 5`,
    [acct.companyId, analysis.requestedAtIso, analysis.content],
  );
  for (const cand of dupCandidates.rows) {
    const agg = await query(
      `SELECT array_agg(phone ORDER BY phone) AS phones FROM agency_send_recipients WHERE request_id = $1::uuid`, [cand.id],
    );
    const candHash = sha256(((agg.rows[0]?.phones as string[] | null) || []).join(','));
    if (candHash === recipientsHash) {
      await finalizeIntake(claimed.id, 'rejected', { reason: 'duplicate_request', companyId: acct.companyId, userId: acct.userId, replyStatus: 'pending' });
      await sendReplyAndRecord(claimed.id, ctx.mailbox, fromAddr, '[한줄로] 이미 접수된 요청서입니다',
        buildRejectedReply(['같은 문안과 명단, 같은 시각의 접수가 이미 진행 중입니다. 다시 접수할 필요가 없습니다. 내용을 바꾸려면 화면에서 그 접수를 수정하거나 취소해 주세요.']),
        messageId, 'duplicate_request');
      return;
    }
  }

  // 11) 접수 — 사전 조회는 트랜잭션 밖(§18-2), 코어가 검증·적재·리드타임을 집행한다
  const pre = {
    registeredSet: await getRegisteredCallbackSet(acct.companyId, acct.userId),
    window: await loadSendWindow(acct.companyId, analysis.isAd),
    minLeadMinutes: EMAIL_MIN_LEAD_MINUTES,
  };
  const txClient = await pool.connect();
  let requestRow: any = null;
  try {
    await txClient.query('BEGIN');
    const result = await createRequestCore(acct, {
      messageType: analysis.messageType,
      subject: analysis.subject || undefined,
      content: analysis.content,
      isAd: analysis.isAd,
      callbackNumber: group.callback,
      managerPhones: analysis.managerPhones,
      requestedAt: analysis.requestedAtIso,
      mmsImagePaths: [],
      fileName: analysis.fileName,
      phoneColumn: analysis.phoneColumn || '전화번호',
      varMapping: Object.fromEntries(analysis.varsMatched.filter((v) => v.column).map((v) => [v.name, v.column!])),
      recipients: group.recipients,
      source: 'email',
    }, txClient, pre);
    if (!result.ok) {
      await txClient.query('ROLLBACK');
      await reject([result.error], 'core_rejected', analysis.headers);
      return;
    }
    requestRow = result.request;
    // accepted는 접수와 한 트랜잭션 — 성공 분기에서만(통과 스탬프 원칙 · §18-6)
    await txClient.query(
      `UPDATE agency_send_email_intake
          SET status = 'accepted', company_id = $2::uuid, user_id = $3::uuid, request_ids = $4::uuid[],
              reply_status = 'pending', decided_at = NOW(), updated_at = NOW()
        WHERE id = $1`,
      [claimed.id, acct.companyId, acct.userId, [requestRow.id]],
    );
    await txClient.query('COMMIT');
  } catch (txErr) {
    await txClient.query('ROLLBACK').catch(() => { /* noop */ });
    throw txErr;
  } finally {
    txClient.release();
  }

  // 이력은 커밋 뒤(원스텝과 같은 순서). kind는 기존 'received' 하나 — 출처는 payload가 나른다
  await logEvent(requestRow.id, 'received', {
    recipientCount: requestRow.recipient_count, messageType: requestRow.message_type,
    via: 'email', fromEmail: fromAddr, autoPickedPhoneColumn,
  });
  log(`이메일 접수 company=${acct.companyId} request=${requestRow.id} ${requestRow.message_type} ${requestRow.recipient_count}건 from=${fromAddr}`);

  // 12) 접수 완료 회신 — 이 경로의 확인 화면(실패해도 접수는 유효 · 재시도 패스가 있다 · 회의론자 필수 3)
  await sendReplyAndRecord(claimed.id, ctx.mailbox, fromAddr, '[한줄로] 대행발송 접수 완료',
    buildAcceptedReply({
      // ★0826(6) 접수된 실제 시각은 원장 행이 진실이다(코어가 조정했을 수 있다). 분석값을 그대로 쓰지 않는다
      subject: analysis.subject, content: analysis.content,
      requestedAtIso: new Date(requestRow.requested_at).toISOString(),
      originalAtIso: requestRow.requested_at_original ? new Date(requestRow.requested_at_original).toISOString() : null,
      callback: group.callback, managerPhones: analysis.managerPhones,
      phoneColumn: analysis.phoneColumn || '전화번호', autoPickedPhoneColumn,
      total: analysis.counts.total, valid: analysis.counts.valid, dup: analysis.counts.dup, invalid: analysis.counts.invalid,
    }), messageId, undefined, true);
}

// ────────────── 회신 재시도 별도 패스(수신 순회와 분리 · 회의론자 필수 3) ──────────────

async function retryPendingReplies(mailbox: string): Promise<void> {
  const rows = await query(
    `SELECT i.id, i.from_email, i.message_id, i.request_ids
       FROM agency_send_email_intake i
      WHERE i.mailbox = $1 AND i.status = 'accepted' AND i.reply_status IN ('pending', 'unknown')
        AND i.reply_attempts < $2
      ORDER BY i.decided_at ASC LIMIT 5`,
    [mailbox, REPLY_MAX_ATTEMPTS],
  );
  for (const row of rows.rows) {
    if (!row.from_email || !row.request_ids?.length) continue;
    const req = await query(
      `SELECT subject, current_content, requested_at, callback_number, manager_phones, phone_column, recipient_count
         FROM agency_send_requests WHERE id = $1::uuid`, [row.request_ids[0]],
      // ⛔ 재시도 회신에 requested_at_original을 넣지 않는다 — 컬럼 부재(DDL 전) 시 이 SELECT가 통째로
      //   실패해 재시도 패스가 멈춘다. 조정 고지는 첫 회신이 이미 했고, 여기는 도달 실패의 복구 경로다.
    );
    const r = req.rows[0];
    if (!r) continue;
    await sendReplyAndRecord(row.id, mailbox, row.from_email, '[한줄로] 대행발송 접수 완료',
      buildAcceptedReply({
        subject: r.subject || '', content: r.current_content || '', requestedAtIso: new Date(r.requested_at).toISOString(),
        callback: r.callback_number, managerPhones: r.manager_phones || [], phoneColumn: r.phone_column || '전화번호',
        autoPickedPhoneColumn: false, total: r.recipient_count, valid: r.recipient_count, dup: 0, invalid: 0,
      }), row.message_id || null, undefined, true);
  }
}

// ────────────── tick ──────────────

let running = false;

export async function runAgencyMailTick(): Promise<void> {
  if (!isEnabled()) return;
  if (running) return; // 프로세스 안 겹침 가드(§18-5)
  running = true;
  const mailbox = agencyMailUser();
  // ⛔ advisory lock은 전용 client로 획득부터 해제까지(§18-8 12 · pool.query면 재진입이 뚫린다)
  const lockClient = await pool.connect();
  let held = false;
  try {
    const lock = await lockClient.query(`SELECT pg_try_advisory_lock(hashtext('agency-send-mail-worker')) AS ok`);
    if (!lock.rows[0]?.ok) return;
    held = true;

    const state = await loadMailState(mailbox);
    if (state?.pausedAt) return; // 사람이 재개할 때까지 멈춘다(paused_at NULL)

    let pop: Pop3Client;
    try {
      pop = await Pop3Client.connect({
        host: (process.env.AGENCY_POP3_HOST || 'pop3s.hiworks.com').trim(),
        port: Number(process.env.AGENCY_POP3_PORT) || 995,
        user: mailbox,
        pass: (process.env.AGENCY_MAIL_PASS || '').trim(),
      });
    } catch (err: any) {
      if (err instanceof Pop3Error && err.kind === 'auth') {
        // ⛔ 로그인 실패는 백오프가 아니라 정지 축이다(1분 재시도 반복 = 계정 잠금)
        const fails = await recordLoginFail(mailbox);
        log(`POP3 로그인 실패 ${fails}회: ${err.message}`);
        if (fails >= LOGIN_FAIL_PAUSE_AT) {
          await pauseMailbox(mailbox, `login_fail_x${fails}`);
          await sendSystemAlert({
            dedupKey: 'agency-mail-login-fail',
            message: `대행발송 메일함 로그인이 ${fails}회 연속 실패해 폴링을 멈췄습니다. 비밀번호 확인 후 mail_state.paused_at을 비워 재개하세요.`,
            cooldownMs: 60 * 60 * 1000,
          });
        }
        return;
      }
      // 네트워크 계열 — 정체가 30분을 넘으면 경보("메일 0통"과 다른 축 · §18-2)
      log(`POP3 접속 실패(네트워크): ${err?.message || err}`);
      if (state?.lastOkAt && Date.now() - state.lastOkAt.getTime() > POLL_STALL_ALERT_MS) {
        await sendSystemAlert({
          dedupKey: 'agency-mail-poll-fail',
          message: `대행발송 메일 폴링이 ${Math.round((Date.now() - state.lastOkAt.getTime()) / 60000)}분째 실패하고 있습니다.`,
          cooldownMs: 60 * 60 * 1000,
        });
      }
      return;
    }

    try {
      const uidls = await pop.uidl();
      const octets = new Map((await pop.list()).map((e) => [e.seq, e.octets]));
      await saveMailStateOk(mailbox); // 마지막 **성공** 폴링(DB 영속 · 회의론자 11)

      // ★적대 2R: 회신 재시도는 새 메일 유무와 무관하게 돈다(빈 편지함 틱에서 밀린 완료 회신이 멈추면 안 된다)
      await retryPendingReplies(mailbox);

      if (uidls.length === 0) return;
      // 원장 대조 — 처리할 것만 남긴다(POP3에는 커서가 없다 · UIDL 전량 대조가 유일한 축 · §18-8 6)
      const known = await query(
        `SELECT uidl, status, attempt_count, claimed_at, next_attempt_at FROM agency_send_email_intake
          WHERE mailbox = $1 AND uidl = ANY($2::text[])`,
        [mailbox, uidls.map((u) => u.uidl)],
      );
      const knownMap = new Map<string, any>(known.rows.map((r: any) => [r.uidl, r]));
      const todo = uidls.filter((u) => {
        const row = knownMap.get(u.uidl);
        if (!row) return true;
        if (row.status === 'failed' && Number(row.attempt_count) < FAIL_MAX_ATTEMPTS
          && (!row.next_attempt_at || new Date(row.next_attempt_at).getTime() <= Date.now())) return true;
        if (row.status === 'claimed' && row.claimed_at && Date.now() - new Date(row.claimed_at).getTime() > CLAIM_STALE_MS) return true;
        return false;
      }).slice(0, MAX_PER_TICK);

      const now = new Date();
      for (const u of todo) {
        try {
          await processMessage({ client: pop, mailbox, octets, now }, u.seq, u.uidl);
        } catch (err: any) {
          if (isMissingRelation(err)) return; // 마이그레이션 전 — 다음 배포 순서에 맡긴다
          // 통 단위 격리: 우리 쪽 일시 장애만 백오프 재시도(파싱·신원 반려는 위에서 이미 확정됐다)
          log(`통 처리 실패(재시도 예약): uidl=${u.uidl} ${err?.message || err}`);
          try {
            const row = await query(
              `SELECT id, attempt_count FROM agency_send_email_intake WHERE mailbox = $1 AND uidl = $2`, [mailbox, u.uidl],
            );
            if (row.rows[0]) {
              const attempts = Number(row.rows[0].attempt_count) || 0;
              const stepMin = RETRY_STEPS_MIN[Math.min(attempts, RETRY_STEPS_MIN.length - 1)];
              await finalizeIntake(row.rows[0].id, 'failed', { reason: String(err?.message || 'error').slice(0, 180), nextAttemptMin: stepMin });
            } else {
              // ★적대 검토: 선점(TOP·신원) **전**에 죽는 독약 메일은 행이 없어 매 틱 무백오프 재시도로
              //   처리 슬롯을 영구 점유한다 — 실패 행을 만들어 같은 백오프 계단에 태운다(4회 뒤 failed 종결).
              await query(
                `INSERT INTO agency_send_email_intake (mailbox, uidl, message_hash, status, reason, attempt_count, next_attempt_at, decided_at)
                 VALUES ($1, $2, $3, 'failed', $4, 1, NOW() + interval '1 minute', NOW())
                 ON CONFLICT (mailbox, uidl) DO NOTHING`,
                [mailbox, u.uidl, sha256(`poison:${mailbox}:${u.uidl}`), String(err?.message || 'error').slice(0, 180)],
              );
            }
          } catch (markErr: any) {
            if (!isMissingRelation(markErr)) log(`실패 기록 불가: ${markErr?.message}`);
          }
        }
      }
    } finally {
      await pop.quit();
    }
  } catch (err: any) {
    if (isMissingRelation(err)) return; // 테이블 생성 전 — 조용히(선례 = agency-send-worker)
    log(`tick 실패: ${err?.message || err}`);
  } finally {
    if (held) {
      try {
        await lockClient.query(`SELECT pg_advisory_unlock(hashtext('agency-send-mail-worker'))`);
      } catch (unErr: any) {
        log(`advisory unlock 실패(연결 반납으로 정리): ${unErr?.message}`);
      }
    }
    lockClient.release();
    running = false;
  }
}

export function startAgencySendMailWorker(): void {
  if (!isEnabled()) {
    log(`이메일 접수 비활성(AGENCY_MAIL_ENABLED=${process.env.AGENCY_MAIL_ENABLED || '미설정'} · 계정 ${isAgencyMailerReady() ? '설정됨' : '미설정'}) — 폴링을 시작하지 않습니다.`);
    return;
  }
  log(`이메일 접수 워커 시작: ${agencyMailUser()} · ${TICK_MS / 1000}초 주기 · 틱당 ${MAX_PER_TICK}통`);
  setInterval(() => { void runAgencyMailTick(); }, TICK_MS);
}
