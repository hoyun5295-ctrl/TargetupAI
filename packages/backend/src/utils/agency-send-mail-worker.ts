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
import fs from 'fs';
import { simpleParser, type ParsedMail } from 'mailparser';
import pool, { query } from '../config/database';
import { LIMITS } from '../config/defaults';
import { Pop3Client, Pop3Error } from './pop3-client';
import {
  resolveEmailSender, matchBillingTarget, describeBillingTargets, describeAccountLabel, type SenderCandidate,
  isImageAttachment, mailImageName, validateMailMmsImages,
} from './agency-send-email';
import { saveMmsImageBuffer } from './mms-image-util';
import { canUseAgencySend, loadPlanContext } from './plan-guard';
import { getRegisteredCallbackSet } from './callback-filter';
import {
  analyzeOneStep, createRequestCore, hasAgencyColumn, loadSendWindow, logEvent, parseOneStepOverrides,
} from './agency-send-intake';
import {
  parseAgencyRequestForm, parseAgencyRecipientList, pickPhoneColumnStrict, resolveCallbackPlan,
  looksLikeRequestForm, hasRecipientSheet,
} from './agency-send-form';
import { extractAgencyVars } from './agency-send-vars';
import { EMAIL_MIN_LEAD_MINUTES, EMAIL_DUP_BLOCKING_SQL, emailDupTimeSql } from './agency-send-state';
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
/**
 * 같은 주소 시간당 회신 상한 — **0 = 무제한(기본)**.
 *
 * ★2026-08-28 하드코딩 `5`에서 ENV로(서수란 접수 `cmtcgrrji03oqjnottkdx0xd6`).
 *   0826에 일일 상한 둘을 무제한으로 풀 때 **이 값만 남아** 실질적으로 접수를 막고 있었다.
 *   요청서를 고쳐 다시 보내는 것이 정상 흐름인데 다섯 통이면 창(1시간)이 닫혀,
 *   보내는 쪽은 30분을 기다려도 아무 답을 받지 못했다.
 *   위 일일 상한과 같은 규율이다 — 판정 코드는 남기고 폭주가 오면 ENV로 다시 조인다(배포 없이).
 */
const REPLY_RATE_PER_HOUR = Number(process.env.AGENCY_MAIL_REPLY_RATE_PER_HOUR || 0);
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
  /** ★2026-08-28 MMS 이미지 원본 파일명(첨부 순서 그대로). 순서 고지는 이 회신이 유일한 확인 자리다 */
  imageNames?: string[];
  /** ★2026-09-05 §21-4 이 건이 나가는 발송 계정. 오지정을 월말 청구서 전에 알아채는 유일한 자리다 */
  billingLabel?: string;
  /** ★2026-09-05 §21-4 다건일 때의 순번·파일명. 있으면 머리말이 블록 제목이 되고 꼬리 안내는 빠진다(바깥에서 한 번만 말한다) */
  seq?: { index: number; total: number; fileName: string };
}): string {
  const when = new Date(input.requestedAtIso);
  const p = (n: number) => String(n).padStart(2, '0');
  const fmt = (d: Date) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  const whenText = fmt(when);
  const shiftedNote = input.originalAtIso
    ? `보낼 시각: ${whenText} (요청하신 ${fmt(new Date(input.originalAtIso))}은 준비 시간이 촉박해 뒤로 옮겼습니다)`
    : `보낼 시각: ${whenText}`;
  const lines = [
    input.seq
      ? `[${input.seq.index}/${input.seq.total}] ${input.seq.fileName}`
      : '대행발송 접수가 완료되었습니다.',
    '',
    `제목: ${input.subject || '(없음)'}`,
    shiftedNote,
    `회신번호: ${input.callback}`,
    `담당자 번호: ${input.managerPhones.join(', ')}`,
    `수신자 열: ${input.phoneColumn}${input.autoPickedPhoneColumn ? ' (자동 선정)' : ''}`,
    ...(input.billingLabel ? [`발송 ID: ${input.billingLabel}`] : []),
    ...(input.imageNames && input.imageNames.length > 0
      ? [`첨부 이미지: ${input.imageNames.length}장, 이 순서로 붙습니다: ${input.imageNames.join(', ')}`]
      : []),
    `보낼 인원: ${input.valid.toLocaleString()}명 (명단 ${input.total.toLocaleString()}행, 중복 ${input.dup}건, 형식 오류 ${input.invalid}건 제외)`,
    '',
    '문안:',
    input.content,
    // 다건이면 꼬리 안내를 넣지 않는다 — 블록마다 반복되면 회신이 읽히지 않는다(바깥에서 한 번만 말한다)
    ...(input.seq ? [] : [
      '',
      '담당자 승인 전에는 발송되지 않습니다. 담당자 휴대폰으로 검사와 승인 안내 문자가 갑니다.',
      '실제 치환된 문장은 담당자 휴대폰으로 가는 테스트 문자에서 확인해 주세요.',
      `진행 상황 확인: ${String(process.env.HANJUL_BASE_URL || 'https://hanjul.ai').replace(/\/+$/, '')}/agency-send`,
    ]),
  ];
  return lines.join('\n');
}

/**
 * 다건 접수 완료 회신 (★2026-09-05 §21-4).
 *
 * ⛔ **"각각 승인해야 한다"를 반드시 말한다.** 사람이 인지하는 단위(메일 한 통)와 시스템이 만드는
 *   단위(접수 N건)가 갈리는 자리이고, 확인 화면이 없는 경로에서 그 둘을 잇는 것은 이 회신 한 통뿐이다.
 * ⛔ **건너뛴 파일을 침묵하지 않는다.** 5장을 보냈는데 3건만 접수되면 승인 문자도 3통만 간다.
 *   조용한 축소는 조용한 시각 조정과 같은 부류의 사고다.
 */
function buildMultiAcceptedReply(blocks: string[], skipped: string[]): string {
  const n = blocks.length;
  return [
    `대행발송 접수가 완료되었습니다. 이 메일에서 ${n}건이 접수되었습니다.`,
    '',
    `${n}건은 각각 따로 승인해야 나갑니다. 담당자 휴대폰으로 검사와 승인 안내 문자가 건마다 갑니다.`,
    ...(skipped.length > 0
      ? ['', `다음 요청서는 이미 접수되어 진행 중이라 이번에는 건너뛰었습니다(다시 보내실 필요 없습니다): ${skipped.join(', ')}`]
      : []),
    '',
    ...blocks.flatMap((b) => [b, '']),
    '실제 치환된 문장은 담당자 휴대폰으로 가는 테스트 문자에서 확인해 주세요.',
    `진행 상황 확인: ${String(process.env.HANJUL_BASE_URL || 'https://hanjul.ai').replace(/\/+$/, '')}/agency-send`,
  ].join('\n');
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
      // ★2026-09-05 §21-4 **시도 상한을 건다.** 통 단위 격리(tick의 catch)는 예외를 잡지, OOM·타임아웃으로
      //   프로세스가 죽는 것은 못 잡는다. 그러면 이 행이 claimed로 남아 10분마다 영구히 재선점되며
      //   틱 슬롯을 계속 먹는다. 다중은 한 통의 작업량을 최대 5배로 키워 그 확률을 직접 올린다.
      //   failed 경로에는 이미 같은 상한이 있다(위 분기) — 같은 규율을 이 자리에도 적용한다.
      if (Number(row.attempt_count) >= FAIL_MAX_ATTEMPTS) {
        await query(
          `UPDATE agency_send_email_intake
              SET status = 'failed', reason = COALESCE(reason, 'claim_exhausted'), decided_at = NOW(), updated_at = NOW()
            WHERE id = $1 AND status = 'claimed'`,
          [row.id],
        );
        await sendSystemAlert({
          dedupKey: `agency-mail-claim-exhausted:${mailbox}`,
          message: `대행발송 메일 한 통이 처리 중 ${FAIL_MAX_ATTEMPTS}회 연속으로 끊겨 종결 처리했습니다(uidl=${uidl}). 첨부가 지나치게 크거나 파싱이 프로세스를 죽였을 수 있습니다.`,
          cooldownMs: 60 * 60 * 1000,
        });
        return null;
      }
      const re = await query(
        `UPDATE agency_send_email_intake SET claimed_at = NOW(), attempt_count = attempt_count + 1, updated_at = NOW()
          WHERE id = $1 AND status = 'claimed' AND claimed_at < NOW() - ($2::int * interval '1 millisecond')
            AND attempt_count < $3
          RETURNING id, status, attempt_count`,
        [row.id, CLAIM_STALE_MS, FAIL_MAX_ATTEMPTS],
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

/**
 * 회신 상한: 같은 주소 1시간 5통(§18-7). 같은 사유의 중복 안내 24시간 1회(§18-6 3층).
 *
 * ★2026-08-28 **상한에 걸렸을 때 침묵하지 않는다**(서수란 접수 `cmtcgrrji03oqjnottkdx0xd6`).
 *   요청서를 고쳐 다시 보내는 것이 정상 흐름인데, 다섯 통을 채우면 그 뒤로는 아무 답이 없어
 *   보내는 쪽은 **왜 안 오는지 알 수 없었다**(30분을 기다려도 창이 1시간이라 그대로였다).
 *   그래서 상한에 **정확히 닿은 첫 회차에만** 「지금은 안내를 보낼 수 없다」를 한 통 보낸다.
 *   그 안내가 `sent`로 기록되어 카운트를 하나 올리므로 **다음부터는 저절로 침묵한다**(DDL 0 · 별도 마커 불요).
 */
type ReplyGate = { allow: boolean; capNotice: boolean };

/**
 * 회신 상한 판정 (순수 · ★2026-09-05 §21-3 (1)).
 *
 * ⛔ **`limitPerHour <= 0`은 무제한이다.** 이 가드가 없으면 기본값 0에서 `sent >= 0`이 항상 참이 되어
 *   **전 회신이 침묵한다** — 이메일 경로에서 회신은 확인 화면을 대신하는 유일한 통지다.
 *   같은 관례를 이 파일의 일일 상한 둘이 이미 쓴다(`if (DAILY_SENDER_LIMIT > 0)`).
 * ⛔ **상한에 정확히 닿은 회차에만 `capNotice`**. 그 안내가 `sent`로 기록되어 카운트를 하나 올리므로
 *   다음 회차는 `>`가 되어 저절로 침묵한다(DDL 0 · 별도 마커 불요).
 * ⛔ 상한 도달과 24시간 억제가 겹치면 **상한 안내가 이긴다** — 왜 답이 없는지를 말해야 한다(불변 22).
 *
 * 판정을 순수 함수로 분리한 이유 = 호출부가 객체를 부정 연산해 게이트가 한 번도 닫히지 않았고
 *   (tsc가 객체 truthiness를 잡지 못한다), 그 상태를 테스트로 고정할 자리가 없었다.
 */
export function decideReplyGate(
  sentInHour: number, limitPerHour: number, sameReasonSentToday: boolean,
): ReplyGate {
  if (limitPerHour > 0 && sentInHour >= limitPerHour) {
    return { allow: false, capNotice: sentInHour === limitPerHour };
  }
  if (sameReasonSentToday) return { allow: false, capNotice: false };
  return { allow: true, capNotice: false };
}

async function replyAllowed(mailbox: string, toEmail: string, onceADayReason?: string): Promise<ReplyGate> {
  // 무제한이면 시간당 카운트 쿼리 자체를 돌리지 않는다(일일 상한 둘과 같은 관례 · 기본 경로의 쿼리 순증 0)
  let sent = 0;
  if (REPLY_RATE_PER_HOUR > 0) {
    const hourly = await query(
      `SELECT COUNT(*)::int AS c FROM agency_send_email_intake
        WHERE mailbox = $1 AND from_email = $2 AND reply_status = 'sent' AND decided_at > NOW() - interval '1 hour'`,
      [mailbox, toEmail],
    );
    sent = hourly.rows[0]?.c || 0;
  }
  let sameReasonSentToday = false;
  if (onceADayReason) {
    const daily = await query(
      `SELECT COUNT(*)::int AS c FROM agency_send_email_intake
        WHERE mailbox = $1 AND from_email = $2 AND reason = $3 AND reply_status = 'sent' AND decided_at > NOW() - interval '24 hours'`,
      [mailbox, toEmail, onceADayReason],
    );
    // 같은 사유 24시간 억제 — 이건 "한도"가 아니라 "같은 말을 두 번 하지 않는다"라
    // 사용자가 이미 그 안내를 받아 본 상태다(침묵이 아니다). 고쳐 다시 보내는 흐름의 파싱 반려에는
    // 애초에 이 인자가 붙지 않는다(붙는 것 = 설정 문제·상한·자격·중복처럼 반복할 말이 없는 사유뿐).
    sameReasonSentToday = (daily.rows[0]?.c || 0) > 0;
  }
  return decideReplyGate(sent, REPLY_RATE_PER_HOUR, sameReasonSentToday);
}

/** 상한에 닿았을 때 한 번 나가는 안내 — 왜 답이 없는지와 언제 다시 되는지를 말한다 */
const REPLY_CAP_NOTICE = [
  '보내주신 메일은 받았습니다.',
  '',
  `다만 안내 메일이 한 시간에 ${REPLY_RATE_PER_HOUR}통까지만 나가도록 되어 있어,`,
  '지금은 접수 결과를 메일로 보내드리지 못합니다.',
  '',
  '한 시간쯤 뒤에 다시 보내주시면 결과를 안내해 드립니다.',
  '급하시면 한줄로 화면에서 바로 접수하실 수 있습니다.',
].join('\n');

async function sendReplyAndRecord(intakeId: string, mailbox: string, toEmail: string, subject: string, text: string, inReplyTo: string | null, onceADayReason?: string, keepPendingOnRateLimit = false): Promise<void> {
  // ⛔ 반환은 객체다. `!(await replyAllowed(...))`로 쓰면 항상 false라 게이트가 열린 채로 남는다(★0905 §21-3 (1) 정정).
  const gate = await replyAllowed(mailbox, toEmail, onceADayReason);
  if (!gate.allow) {
    // ★적대 2R: 접수 완료 회신은 유일한 통지라 상한에 걸려도 pending으로 남겨 재시도 패스가 다시 잡게 한다.
    //   ⛔ 그 경로에는 상한 안내를 보내지 않는다 — 안내를 `sent`로 기록하면 재시도가 그 행을 다시 안 잡아
    //   접수 완료 회신이 영영 나가지 않고, 기록을 생략하면 카운트가 안 올라 안내만 매 틱 반복된다.
    if (keepPendingOnRateLimit) return;
    // ★2026-09-05 §21-3 (1) 상한에 **정확히 닿은 회차**에만 「왜 답이 없는지」를 한 통 보낸다(불변 22).
    //   이 안내가 `sent`로 기록되어 카운트를 올리므로 다음 회차부터는 저절로 침묵한다.
    //   (capNotice는 상한이 켜진 경우에만 true라, 기본값 0에서 REPLY_CAP_NOTICE 문구가 나갈 일은 없다)
    if (gate.capNotice) {
      const notice = await sendAgencyReplyMail({ to: toEmail, subject: '[한줄로] 안내 메일을 잠시 보낼 수 없습니다', text: REPLY_CAP_NOTICE, inReplyTo });
      await query(
        `UPDATE agency_send_email_intake SET reply_status = $2, reply_attempts = reply_attempts + 1, updated_at = NOW() WHERE id = $1`,
        [intakeId, notice.outcome === 'sent' ? 'sent' : notice.outcome === 'rejected' ? 'rejected' : 'unknown'],
      );
      if (notice.outcome !== 'sent') log(`상한 안내 미확정(${notice.outcome}): to=${toEmail} ${notice.detail}`);
      return;
    }
    // 반려 안내는 여기서 접는다(skipped) — 재전송하면 새 회신 기회가 생긴다.
    await query(`UPDATE agency_send_email_intake SET reply_status = 'skipped', updated_at = NOW() WHERE id = $1`, [intakeId]);
    return;
  }
  const r = await sendAgencyReplyMail({ to: toEmail, subject, text, inReplyTo });
  await query(
    `UPDATE agency_send_email_intake SET reply_status = $2, reply_attempts = reply_attempts + 1, updated_at = NOW() WHERE id = $1`,
    [intakeId, r.outcome === 'sent' ? 'sent' : r.outcome === 'rejected' ? 'rejected' : 'unknown'],
  );
  if (r.outcome !== 'sent') log(`회신 미확정(${r.outcome}): to=${toEmail} ${r.detail}`);
}

// ────────────── 첨부 분류 = 접수 단위 만들기 (순수 · ★2026-09-05 §21-4) ──────────────

/** 메일 한 통이 만들 수 있는 접수 건수 상한. ⛔ MAX_ATTACH_FILES를 넘기면 표 N장이 too_many_files로 조용히 반려된다 */
export const MAX_FORMS = 5;

/** 접수 단위 하나 = 요청서 버퍼 + 명단 버퍼 + 이름 둘 */
export interface IntakeUnit {
  formBuf: Buffer;
  listBuf: Buffer;
  /** 명단 파일 이름 — 접수 행의 fileName이 되고 파서 오류 안내에 실린다 */
  listName: string;
  /** 사람이 이 건을 부르는 이름 = 요청서 첨부 파일명(회신 블록·담당자 문자 라벨) */
  fileName: string;
}
export type IntakeUnitsResult =
  | { ok: true; units: IntakeUnit[] }
  | { ok: false; code: string; reasons: string[] };

const unitName = (a: { filename?: string | undefined }, fallback: string) => String(a.filename || fallback);
const asUnit = (a: { filename?: string | undefined; content: Buffer }): IntakeUnit => {
  const n = unitName(a, '대행발송요청서.xlsx');
  return { formBuf: a.content, listBuf: a.content, listName: n, fileName: n };
};

/**
 * 표 파일들을 접수 단위로 가른다.
 *
 * ⛔ **다중은 "전원 자립형"에서만 열린다.** 자립형 = 한 파일에 요청서 시트와 고객리스트 시트가 다 있는 것.
 *   요청서와 명단을 나눠 보낸 조합에서 다중을 허용하면 짝짓기가 **파일명 추론**이 되는데, 그건 §18-3에서
 *   이미 거부한 축이다(어느 쪽이 요청서인지 파일명이 아니라 내용으로 가른다).
 * ⛔ **1개·2개 분기는 오늘 동작 그대로다.** 새로 여는 것은 오늘 100% 반려되던 조합(자립형 2장 이상)뿐이다.
 */
export function buildIntakeUnits(
  sheets: Array<{ filename?: string | undefined; content: Buffer }>,
): IntakeUnitsResult {
  const allStandalone = sheets.length > 0
    && sheets.every((a) => looksLikeRequestForm(a.content) && hasRecipientSheet(a.content));

  if (sheets.length === 1) {
    const buf = sheets[0].content;
    if (!looksLikeRequestForm(buf) || !hasRecipientSheet(buf)) {
      return {
        ok: false,
        code: 'form_not_identified',
        reasons: ['첨부한 파일에서 요청서(내용 시트)와 고객리스트 시트를 함께 찾지 못했습니다. 내려받은 양식 그대로 첫 시트에 내용을, 고객리스트 시트에 명단을 채워 첨부해 주세요.'],
      };
    }
    return { ok: true, units: [asUnit(sheets[0])] };
  }

  if (sheets.length === 2) {
    const forms = sheets.filter((a) => looksLikeRequestForm(a.content));
    if (forms.length === 1) {
      // 오늘 경로 — 요청서 1 + 명단 1. 별도 명단이 이긴다(자립형 요청서여도 마찬가지 · 무변경)
      const formAtt = forms[0];
      const listAtt = sheets.find((a) => a !== formAtt)!;
      return {
        ok: true,
        units: [{
          formBuf: formAtt.content,
          listBuf: listAtt.content,
          listName: unitName(listAtt, '고객명단.xlsx'),
          fileName: unitName(formAtt, '대행발송요청서.xlsx'),
        }],
      };
    }
    // ★신설 — 둘 다 자립형이면 접수 2건(오늘은 form_not_identified로 반려되던 조합)
    if (allStandalone) return { ok: true, units: sheets.map(asUnit) };
    return {
      ok: false,
      code: 'form_not_identified',
      reasons: ['어느 파일이 요청서인지 확인하지 못했습니다. 요청서는 내려받은 양식을 그대로 채워 첨부해 주세요.'],
    };
  }

  // ★신설 — 3장 이상은 전원 자립형일 때만(오늘은 attachments_invalid로 반려되던 조합)
  if (sheets.length >= 3 && allStandalone) {
    if (sheets.length > MAX_FORMS) {
      return {
        ok: false,
        code: 'too_many_forms',
        reasons: [`요청서는 메일 한 통에 ${MAX_FORMS}개까지 보낼 수 있습니다. 지금은 ${sheets.length}개입니다. 나눠서 보내주세요.`],
      };
    }
    return { ok: true, units: sheets.map(asUnit) };
  }

  return {
    ok: false,
    code: 'attachments_invalid',
    reasons: [`요청서 양식 파일(내용 시트 + 고객리스트 시트)을 첨부해 주세요. 지금은 표 파일이 ${sheets.length}개입니다. 여러 건을 한 번에 보내실 때는 파일마다 내용 시트와 고객리스트 시트가 모두 들어 있어야 합니다.`],
  };
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
  //   ★2026-09-05 §21-4: 판정만 하고 반려는 호출부가 한다. 다중에서는 단위마다 이 판정을 지나되
  //   반려는 **전량 단위**로 모아 한 통에 실어야 하기 때문이다(여기서 회신하면 첫 건에서 끝나 버린다).
  type GateVerdict = { ok: true } | { ok: false; code: string; reason: string };
  const gateMemo = new Map<string, GateVerdict>();
  const checkCompanyGates = async (acct: { companyId: string; userId: string }): Promise<GateVerdict> => {
    const hit = gateMemo.get(acct.companyId);
    if (hit) return hit; // 같은 회사 N건이면 쿼리 1회(다중 경로의 순증 0)
    let verdict: GateVerdict = { ok: true };
    if (DAILY_COMPANY_LIMIT > 0) {
      const companyCount = await query(
        `SELECT COUNT(*)::int AS c FROM agency_send_email_intake WHERE mailbox = $1 AND company_id = $2::uuid AND claimed_at >= $3::timestamptz AND id <> $4`,
        [ctx.mailbox, acct.companyId, midnight, claimed.id],
      );
      if ((companyCount.rows[0]?.c || 0) >= DAILY_COMPANY_LIMIT) {
        verdict = { ok: false, code: 'daily_company_limit', reason: `회사 기준 하루 ${DAILY_COMPANY_LIMIT}통까지 접수할 수 있습니다. 내일 다시 보내시거나 화면에서 접수해 주세요.` };
      }
    }
    if (verdict.ok) {
      // 자격(회사 스위치 AND 유료) — 네 번째 우회 입구 방지(§18-2)
      const ctxPlan = await loadPlanContext(acct.companyId);
      if (!canUseAgencySend(ctxPlan)) {
        verdict = { ok: false, code: 'not_allowed', reason: '대행발송이 열려 있지 않은 계정입니다. 한줄로 담당자에게 문의해 주세요.' };
      }
    }
    gateMemo.set(acct.companyId, verdict);
    return verdict;
  };
  if (auth) {
    const g = await checkCompanyGates(auth);
    if (!g.ok) {
      await finalizeIntake(claimed.id, 'rejected', { reason: g.code, companyId: auth.companyId, userId: auth.userId, replyStatus: 'pending' });
      await sendReplyAndRecord(claimed.id, ctx.mailbox, fromAddr, '[한줄로] 대행발송 접수 불가',
        buildRejectedReply([g.reason]), messageId, g.code);
      return;
    }
  }

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
  // ★2026-08-28 MMS 개통(서수란 접수 cmtclkuhe04iujnotbi3xbuu3) — 이미지를 요청서와 별도 첨부로 받는다.
  //   규격(JPG 실체·300KB·3장)이면 그대로 접수하고, 벗어나면 파일별 사유로 반려한다(변환 없음).
  //   저장은 청구 계정 확정 뒤에만 하고, 저장 뒤 반려로 빠지면 그 자리에서 지운다(고아 파일 방지).
  /** 이 메일이 귀속되는 회사·계정 — 단위가 확정하면 채워진다. 반려 기록도 이 값을 쓴다(★0905 §21-4).
   *  ⛔ reject보다 **앞에** 선언한다: 3번째 요청서가 계정을 확정한 뒤 5번째가 실패해 전량 반려될 때
   *  회사를 못 적으면 회사 축 일일 상한과 슈퍼관리자 원장이 그 건을 못 센다. */
  let mailCompanyId: string | null = auth?.companyId ?? null;
  let lastAcct: { companyId: string; userId: string } | null = auth;
  const savedImagePaths: string[] = [];
  const savedImageNames: string[] = [];
  // 청구 계정 미확정(auth null) 반려는 회사·사용자 없이 기록한다 — 후보가 여러 회사일 수 있어 추정 기록은 오귀속이다
  const reject = async (reasons: string[], reasonCode: string, headers?: string[]) => {
    for (const p of savedImagePaths.splice(0)) {
      try { fs.unlinkSync(p); } catch { /* 이미 없으면 그만 · 반려 자체를 막지 않는다 */ }
    }
    await finalizeIntake(claimed.id, 'rejected', { reason: reasonCode, companyId: mailCompanyId, userId: lastAcct?.userId ?? null, replyStatus: 'pending' });
    await sendReplyAndRecord(claimed.id, ctx.mailbox, fromAddr, '[한줄로] 대행발송 접수 불가', buildRejectedReply(reasons, headers), messageId);
  };

  const imageAtts = atts.filter((a) => isImageAttachment(a));
  if (imageAtts.length > 0) {
    const check = validateMailMmsImages(imageAtts);
    if (!check.ok) {
      await reject(check.reasons, 'mms_image_invalid');
      return;
    }
  }
  if (atts.some((a) => /\.zip$/i.test(String(a.filename || '')))) {
    await reject(['압축(zip) 파일은 받지 않습니다. 요청서와 명단을 각각 엑셀 또는 CSV로 첨부해 주세요.'], 'zip_not_allowed');
    return;
  }
  if (atts.length > MAX_ATTACH_FILES) {
    await reject([`첨부가 ${atts.length}개입니다. 요청서 양식 파일 하나와 이미지 최대 ${LIMITS.mmsImageCount}장까지만 첨부해 주세요.`], 'too_many_files');
    return;
  }
  if (atts.reduce((a, b) => a + (b.size || b.content?.length || 0), 0) > MAX_ATTACH_TOTAL) {
    await reject(['첨부 용량이 큽니다. 15MB 이내로 보내주세요.'], 'attachments_too_large');
    return;
  }
  // ★2026-08-26(2) 표준 = 통일 양식 **한 파일**(시트1 내용 + 시트2 고객리스트). 요청서와 명단을
  //   두 파일로 나눠 첨부한 메일도 그대로 받는다(반려당할 이유가 없는 메일을 반려하지 않는다).
  //   ★2026-09-05 §21-4 여기서 접수 **단위**를 만든다. 1개·2개 경로는 오늘 그대로이고,
  //   다중은 "표 파일 전원이 자립형"에서만 열린다(오늘 100% 반려되던 조합).
  const sheets = atts.filter((a) => /\.(xlsx|xls|csv)$/i.test(String(a.filename || '')));
  const built = buildIntakeUnits(sheets.map((a) => ({ filename: a.filename, content: a.content as Buffer })));
  if (!built.ok) {
    await reject(built.reasons, built.code);
    return;
  }
  const units = built.units;
  const multi = units.length > 1;

  // ⛔ 다중 + 이미지 = 반려. 요청서가 여럿이면 "첨부 순서"로 어느 요청서의 이미지인지 정할 수 없다(불변 23).
  //   판정은 이미지 저장보다 **앞**이다 — 저장 뒤로 미루면 고아 파일 정리에 기대게 된다.
  if (multi && imageAtts.length > 0) {
    await reject([
      '이미지가 들어가는 요청서는 메일 한 통에 하나씩 보내주세요.',
      '요청서를 여러 개 함께 보내시면 어느 요청서에 붙일 이미지인지 알 수 없어 접수되지 않습니다. 메일을 나눠 보내시면 그대로 접수됩니다.',
    ], 'multi_form_with_image');
    return;
  }

  // ── 8~10) 단위별 계획 수립 — DB 쓰기 0(이미지 디스크 저장만) ──
  //   ⛔ 첫 실패에서 멈추지 않는다. 전부 판정한 뒤 **파일별 사유를 한 통에** 싣는다(왕복을 1회로 닫으려고).
  //   ⛔ 오류가 하나라도 있으면 전량 반려하고 스킵 계산은 통째로 버린다(스킵이 오류를 가리면
  //      "5장 보냈는데 3장만 나갔다"를 사용자가 모른다).
  interface UnitPlan {
    unit: IntakeUnit;
    acct: { companyId: string; userId: string };
    analysis: Awaited<ReturnType<typeof analyzeOneStep>>;
    group: { callback: string; recipients: Array<{ phone: string; vars: Record<string, any> }> };
    autoPickedPhoneColumn: boolean;
    /** 내용 4요소 해시 — 메일 안 형제 건과의 대조(3.5층) 전용 */
    dupKey: string;
  }
  const plans: UnitPlan[] = [];
  const unitErrors: string[] = [];
  const unitHeaders: string[] = [];
  const dupSkipped: string[] = [];
  let firstCode: string | null = null;
  let ambiguousSeen = false;
  const targetList = describeBillingTargets(candidates);
  // ★2026-09-05 §21-3 (2) 시각 축은 원본·조정값 둘 다로 대조한다. 컬럼 탐지는 단위마다 하지 않는다
  const dupTimeSql = emailDupTimeSql(await hasAgencyColumn(pool, 'requested_at_original'));

  for (let ui = 0; ui < units.length; ui++) {
    const u = units[ui];
    const tag = multi ? `${ui + 1}. ${u.fileName}: ` : '';
    const fail = (msg: string, code: string, headers?: string[]) => {
      unitErrors.push(tag + msg);
      if (!firstCode) firstCode = code;
      if (headers) for (const h of headers) if (!unitHeaders.includes(h)) unitHeaders.push(h);
    };

    // 8) 요청서 파싱 — 이메일 전용 사전 게이트(§18-3 · 확인 화면이 없는 경로의 추가 반려 규칙)
    const form = parseAgencyRequestForm(u.formBuf);

    // 8b) ★0827 §18-13 + ★0905 §21-2 발송 ID 확정.
    //   ⛔ **단위마다 자기 칸으로만 정한다. 메일 단위 상속 금지** — 첫 요청서의 계정을 나머지가 물려받게
    //      만들면 첨부 순서가 돈 귀속을 정한다(불변 19가 막은 "기본 계정"과 같은 부류의 조용한 오귀속).
    //   ⛔ 확정은 form 기반 반려(이미지 파일명 등)보다 **먼저**다(★0827 Codex 1R).
    let unitAcct: { companyId: string; userId: string } | null = auth;
    if (!unitAcct) {
      if (!form.billingTarget) {
        fail(`이 이메일 주소는 발송 계정 여러 개에 등록되어 있어 어느 계정으로 접수할지 지정이 필요합니다. 요청서 "내용" 시트 맨 아래 "발송 ID" 칸에 다음 중 하나를 적어 다시 보내주세요: ${targetList}`, 'billing_target_required');
        continue;
      }
      const match = matchBillingTarget(candidates, form.billingTarget);
      if (match.outcome === 'not_found') {
        fail(`"발송 ID" 칸에 적힌 "${form.billingTarget}"을(를) 찾지 못했습니다. 다음 중 하나를 그대로 적어 주세요: ${targetList}`, 'billing_target_not_found');
        continue;
      }
      if (match.outcome === 'ambiguous') {
        fail(`"발송 ID" 칸에 적힌 "${form.billingTarget}"이(가) 등록된 계정 여러 개와 일치합니다. 한줄로 담당자에게 표시명 정리를 요청해 주세요.`, 'billing_target_ambiguous');
        ambiguousSeen = true;
        continue;
      }
      unitAcct = { companyId: match.candidate.companyId, userId: match.candidate.userId };
    } else if (form.billingTarget) {
      const match = matchBillingTarget(candidates, form.billingTarget);
      if (match.outcome !== 'matched' || match.candidate.userId !== unitAcct.userId) {
        // ★2026-09-05 §21-2 7 — "지정한 적도 없는데 반려됐다"로 읽히기 쉬운 자리다(업체 자체 양식의
        //   다른 뜻 라벨이 지정으로 읽힌 경우). 계정이 하나뿐이면 **비우면 된다**는 출구를 같이 준다.
        fail([
          `"발송 ID" 칸에 적힌 "${form.billingTarget}"은(는) 이 이메일 주소로 요청할 수 있는 계정이 아닙니다. 이 주소로 요청할 수 있는 계정: ${targetList}`,
          ...(candidates.length === 1 ? ['(발송 계정이 하나뿐이라 이 칸을 비워 두시면 그대로 접수됩니다)'] : []),
        ].join(' '), 'billing_target_mismatch');
        continue;
      }
    }
    lastAcct = unitAcct;

    // ⛔ 한 메일의 요청서는 전부 같은 회사여야 한다 — intake 원장의 회사·사용자 칸이 스칼라라
    //   갈리면 회사 일일 상한과 자격이 한쪽만 검사되고, 이미지 저장 경로도 정해지지 않는다.
    if (mailCompanyId === null) mailCompanyId = unitAcct.companyId;
    else if (mailCompanyId !== unitAcct.companyId) {
      fail('한 메일에 서로 다른 회사의 요청서를 함께 보낼 수 없습니다. 회사별로 메일을 나눠 보내주세요.', 'multi_company_not_allowed');
      continue;
    }

    // 회사 축 게이트(일일 상한 + 자격) — 같은 회사면 메모라 쿼리 1회
    const gate = await checkCompanyGates(unitAcct);
    if (!gate.ok) {
      fail(gate.reason, gate.code);
      continue;
    }

    // ★2026-08-28 이미지 — 단건 경로 전용(다중은 위에서 반려했다).
    //   요청서 "이미지 파일명" 칸에 값이 있는데 첨부가 0장이면 반려(이름만 적힌 이미지는 실리지 못한 채
    //   문자만 나간다). 첨부가 있으면 칸은 무시하고 **첨부 순서**를 쓴다(불변 23).
    //   저장은 계정 확정 뒤에만(회사 저장소 경로가 필요하다). 이후 반려는 reject가 파일을 지운다.
    // ⛔ 이미지 파일명 칸 검사는 **단건·다중 공통**이다(★0905 Codex 1R 지적 ②).
    //   다중 분기 안에 두면 자립형 요청서 2장을 이미지 없이 보낸 메일이 이 검사를 건너뛰고,
    //   analyzeOneStep은 이미지 배열만 보므로 SMS/LMS로 결정되어 **이미지가 빠진 채 승인·발송**된다.
    if (form.imageFileName && imageAtts.length === 0) {
      fail(multi
        ? '이미지 파일명이 적혀 있습니다. 이미지가 들어가는 요청서는 메일 한 통에 하나씩 보내주세요.'
        : '요청서에 이미지 파일명이 적혀 있는데 이미지가 첨부되어 있지 않습니다. 이미지 파일(JPG)을 메일에 함께 첨부해 다시 보내주세요.',
        'image_not_attached');
      continue;
    }
    if (!multi) {
      for (let i = 0; i < imageAtts.length; i++) {
        const saved = saveMmsImageBuffer(unitAcct.companyId, imageAtts[i].content as Buffer);
        savedImagePaths.push(saved.serverPath);
        savedImageNames.push(mailImageName(imageAtts[i], i));
      }
    }

    let list: ReturnType<typeof parseAgencyRecipientList> | null = null;
    try { list = parseAgencyRecipientList(u.listBuf); } catch { list = null; }
    if (list) {
      if (list.headerless && extractAgencyVars(form.content).length > 0) {
        fail('명단 첫 줄에 열 이름이 없어서 문안의 %항목%을 연결할 수 없습니다. 첫 줄에 열 이름을 넣거나 문안에서 항목을 빼 주세요.', 'headerless_with_vars');
        continue;
      }
      if (!form.errors.some((e) => e.field === '회신번호') && resolveCallbackPlan(form.callbackRaw, list.headers).mode === 'column') {
        fail('회신번호가 명단 열로 지정되어 접수가 여러 건으로 나뉩니다. 이 방식은 나뉘는 건수를 확인해야 해서 화면 접수에서 진행해 주세요.', 'callback_column_mode', list.headers);
        continue;
      }
    }
    let autoPickedPhoneColumn = false;
    const overridesRaw: Record<string, any> = {};
    if (list && !form.phoneColumnName) {
      const strictCol = pickPhoneColumnStrict(list.headers, list.rows);
      if (!strictCol) {
        fail('휴대폰 번호 열을 확실하게 고르지 못했습니다. 요청서의 "수신자 열 이름" 칸에 명단의 열 이름을 적어 다시 보내주세요.', 'phone_column_ambiguous', list.headers);
        continue;
      }
      overridesRaw.phoneColumn = strictCol;
      autoPickedPhoneColumn = true;
    }

    // 9) 분석(확정 경로 · AI 0 · 리드타임은 코어와 같은 상수) — 반려 사유는 전량 회신에 싣는다
    //   이미지가 있으면 분석·코어가 화면 접수와 같은 결정(타입 = MMS · validateMmsPayload)을 그대로 탄다
    if (!multi && savedImagePaths.length > 0) overridesRaw.mmsImagePaths = [...savedImagePaths];
    const overrides = parseOneStepOverrides(overridesRaw);
    const analysis = await analyzeOneStep(unitAcct, u.formBuf, u.listBuf, u.listName, overrides, false, EMAIL_MIN_LEAD_MINUTES);
    if (analysis.errors.length > 0) {
      fail(analysis.errors.map((e) => `[${e.field}] ${e.error}`).join(' / '), 'form_invalid', analysis.headers);
      continue;
    }
    if (analysis.counts.valid === 0) {
      fail('보낼 수 있는 번호가 없습니다. 명단 파일에 휴대폰 번호가 든 행이 있는지 확인해 주세요.', 'no_recipients');
      continue;
    }
    if (analysis.callback.mode !== 'fixed' || analysis.groups.length !== 1) {
      fail('회신번호를 확인하지 못했습니다. 등록된 발신번호 하나를 적어 주세요.', 'callback_invalid');
      continue;
    }
    const group = analysis.groups[0];

    // 10) 멱등 — 내용 4요소(회사·문안·시각·정렬된 번호 집합)
    const phones = group.recipients.map((r) => r.phone).sort();
    const recipientsHash = sha256(phones.join(','));
    // 구분자 충돌을 피하려고 **고정 형식 값을 앞에** 둔다(uuid · ISO 시각 · 해시). 자유 문자열인 문안이 마지막이다
    const dupKey = sha256([unitAcct.companyId, analysis.requestedAtIso, recipientsHash, analysis.content].join('|'));

    // 10-a) ★2026-09-05 §21-4 3.5층 = **메일 안** 중복. DB 조회로는 절대 못 잡는다(형제 건이 아직 커밋 전이다).
    //   ⛔ 조용히 하나를 버리지 않는다 — 같은 4요소 두 장은 "둘 중 어느 것이 의도인가"가 미확정이다.
    const twin = plans.find((p) => p.dupKey === dupKey);
    if (twin) {
      fail(`${twin.unit.fileName}과(와) 문안·보낼 시각·명단이 모두 같습니다. 같은 요청서를 두 번 첨부하셨는지 확인해 주세요.`, 'duplicate_in_mail');
      continue;
    }

    // 10-b) 3층 = 이미 커밋된 미종결·발송 전 건과 대조(§18-6).
    //   ⛔ 여기 걸린 건은 "오류"가 아니라 **사용자가 원한 상태가 이미 원장에 있는 것**이다.
    //      그래서 반려가 아니라 이 파일만 건너뛴다 — 안 그러면 일부만 고쳐 다시 보낼 때
    //      나머지가 중복이라 전량 반려되어 고친 건이 영영 안 들어온다(왕복 무한).
    const dupCandidates = await query(
      `SELECT id FROM agency_send_requests
        WHERE company_id = $1::uuid AND ${dupTimeSql} AND original_content = $3 AND ${EMAIL_DUP_BLOCKING_SQL}
        LIMIT 5`,
      [unitAcct.companyId, analysis.requestedAtIso, analysis.content],
    );
    let alreadyAccepted = false;
    for (const cand of dupCandidates.rows) {
      const agg = await query(
        `SELECT array_agg(phone ORDER BY phone) AS phones FROM agency_send_recipients WHERE request_id = $1::uuid`, [cand.id],
      );
      const candHash = sha256(((agg.rows[0]?.phones as string[] | null) || []).join(','));
      if (candHash === recipientsHash) { alreadyAccepted = true; break; }
    }
    if (alreadyAccepted) {
      dupSkipped.push(u.fileName);
      continue;
    }

    plans.push({ unit: u, acct: unitAcct, analysis, group, autoPickedPhoneColumn, dupKey });
  }

  // ⛔ 오류가 하나라도 있으면 전량 반려. 스킵 계산은 여기서 통째로 버린다.
  if (unitErrors.length > 0) {
    if (ambiguousSeen) {
      await sendSystemAlert({
        dedupKey: `agency-mail-billing-target-ambiguous:${fromAddr}`,
        message: `대행발송 허용 이메일의 발송 ID 표시명이 겹칩니다(지정 판정 불가·반려 중): ${fromAddr}`,
        cooldownMs: 60 * 60 * 1000,
      });
    }
    const reasons = multi
      ? [
        `요청서 ${units.length}건 중 아래 항목을 확인해 주세요. 고쳐서 다시 보내주시면 전체가 접수됩니다.`,
        ...unitErrors,
        ...(dupSkipped.length > 0
          ? [`(${dupSkipped.join(', ')}은(는) 이미 접수되어 진행 중입니다. 다시 보내셔도 중복 접수되지 않습니다)`]
          : []),
      ]
      : unitErrors;
    await reject(reasons, firstCode || 'form_invalid', unitHeaders.length > 0 ? unitHeaders : undefined);
    return;
  }

  // 전량이 이미 접수된 상태면 오늘 단일 경로와 같은 자리에서 종결한다(새 상태를 만들지 않는다)
  if (plans.length === 0) {
    await finalizeIntake(claimed.id, 'rejected', { reason: 'duplicate_request', companyId: mailCompanyId, userId: lastAcct?.userId ?? null, replyStatus: 'pending' });
    await sendReplyAndRecord(claimed.id, ctx.mailbox, fromAddr, '[한줄로] 이미 접수된 요청서입니다',
      buildRejectedReply([
        multi
          ? `보내주신 요청서 ${units.length}건이 모두 이미 접수되어 진행 중입니다. 다시 접수할 필요가 없습니다.`
          : '같은 문안과 명단, 같은 시각의 접수가 이미 진행 중입니다. 다시 접수할 필요가 없습니다.',
        '내용을 바꾸려면 화면에서 그 접수를 수정하거나 취소해 주세요.',
      ]),
      messageId, 'duplicate_request');
    return;
  }

  // 11) 접수 — 사전 조회는 트랜잭션 밖(§18-2), 코어가 검증·적재·리드타임을 집행한다.
  //   ⛔ 단위마다 계정·광고 여부가 다를 수 있어 사전 조회도 단위별이다.
  const pres: Array<{ registeredSet: Awaited<ReturnType<typeof getRegisteredCallbackSet>>; window: Awaited<ReturnType<typeof loadSendWindow>>; minLeadMinutes: number }> = [];
  for (const p of plans) {
    pres.push({
      registeredSet: await getRegisteredCallbackSet(p.acct.companyId, p.acct.userId),
      window: await loadSendWindow(p.acct.companyId, p.analysis.isAd),
      minLeadMinutes: EMAIL_MIN_LEAD_MINUTES,
    });
  }
  const txClient = await pool.connect();
  const requestRows: any[] = [];
  try {
    await txClient.query('BEGIN');
    for (let i = 0; i < plans.length; i++) {
      const p = plans[i];
      const result = await createRequestCore(p.acct, {
        messageType: p.analysis.messageType,
        subject: p.analysis.subject || undefined,
        content: p.analysis.content,
        isAd: p.analysis.isAd,
        callbackNumber: p.group.callback,
        managerPhones: p.analysis.managerPhones,
        requestedAt: p.analysis.requestedAtIso,
        // ★2026-08-28 형태 = 화면 접수와 같은 절대경로 문자열 배열(발송 배관 계약 무변경)
        //   다중이면 이미지가 없다(위에서 반려) — 그래서 이 배열은 단건에서만 채워진다
        mmsImagePaths: multi ? [] : savedImagePaths,
        fileName: p.analysis.fileName,
        phoneColumn: p.analysis.phoneColumn || '전화번호',
        varMapping: Object.fromEntries(p.analysis.varsMatched.filter((v) => v.column).map((v) => [v.name, v.column!])),
        recipients: p.group.recipients,
        source: 'email',
      }, txClient, pres[i]);
      if (!result.ok) {
        await txClient.query('ROLLBACK');
        const prefix = multi ? `${units.indexOf(p.unit) + 1}. ${p.unit.fileName}: ` : '';
        await reject([prefix + result.error], 'core_rejected', p.analysis.headers);
        return;
      }
      requestRows.push(result.request);
    }
    // accepted는 접수와 한 트랜잭션 — 성공 분기에서만(통과 스탬프 원칙 · §18-6)
    //   ⛔ 부분 커밋이 구조적으로 없다: 3번째에서 죽으면 1·2번도 롤백되어 재개 판정이 필요 없다.
    await txClient.query(
      `UPDATE agency_send_email_intake
          SET status = 'accepted', company_id = $2::uuid, user_id = $3::uuid, request_ids = $4::uuid[],
              reason = $5, reply_status = 'pending', decided_at = NOW(), updated_at = NOW()
        WHERE id = $1`,
      [claimed.id, plans[0].acct.companyId, plans[0].acct.userId, requestRows.map((r) => r.id),
        dupSkipped.length > 0 ? `duplicate_skipped:${dupSkipped.length}` : null],
    );
    await txClient.query('COMMIT');
  } catch (txErr) {
    await txClient.query('ROLLBACK').catch(() => { /* noop */ });
    throw txErr;
  } finally {
    txClient.release();
  }

  // 이력은 커밋 뒤(원스텝과 같은 순서). kind는 기존 'received' 하나 — 출처는 payload가 나른다
  for (let i = 0; i < requestRows.length; i++) {
    await logEvent(requestRows[i].id, 'received', {
      recipientCount: requestRows[i].recipient_count, messageType: requestRows[i].message_type,
      via: 'email', fromEmail: fromAddr, autoPickedPhoneColumn: plans[i].autoPickedPhoneColumn,
      ...(multi ? { mailSeq: i + 1, mailTotal: requestRows.length, formFileName: plans[i].unit.fileName } : {}),
    });
  }
  log(`이메일 접수 company=${plans[0].acct.companyId} ${requestRows.length}건 [${requestRows.map((r) => r.id).join(', ')}] from=${fromAddr}${dupSkipped.length > 0 ? ` (중복 건너뜀 ${dupSkipped.length})` : ''}`);

  // 12) 접수 완료 회신 — 이 경로의 확인 화면(실패해도 접수는 유효 · 재시도 패스가 있다 · 회의론자 필수 3)
  const blocks = plans.map((p, i) => buildAcceptedReply({
    // ★0826(6) 접수된 실제 시각은 원장 행이 진실이다(코어가 조정했을 수 있다). 분석값을 그대로 쓰지 않는다
    subject: p.analysis.subject, content: p.analysis.content,
    requestedAtIso: new Date(requestRows[i].requested_at).toISOString(),
    originalAtIso: requestRows[i].requested_at_original ? new Date(requestRows[i].requested_at_original).toISOString() : null,
    callback: p.group.callback, managerPhones: p.analysis.managerPhones,
    phoneColumn: p.analysis.phoneColumn || '전화번호', autoPickedPhoneColumn: p.autoPickedPhoneColumn,
    total: p.analysis.counts.total, valid: p.analysis.counts.valid, dup: p.analysis.counts.dup, invalid: p.analysis.counts.invalid,
    imageNames: multi ? [] : savedImageNames,
    billingLabel: describeAccountLabel(candidates, p.acct.userId),
    seq: multi ? { index: i + 1, total: plans.length, fileName: p.unit.fileName } : undefined,
  }));
  await sendReplyAndRecord(claimed.id, ctx.mailbox, fromAddr,
    multi ? `[한줄로] 대행발송 ${plans.length}건 접수 완료` : '[한줄로] 대행발송 접수 완료',
    multi ? buildMultiAcceptedReply(blocks, dupSkipped) : blocks[0],
    messageId, undefined, true);
}

// ────────────── 회신 재시도 별도 패스(수신 순회와 분리 · 회의론자 필수 3) ──────────────

async function retryPendingReplies(mailbox: string): Promise<void> {
  const rows = await query(
    `SELECT i.id, i.from_email, i.message_id, i.request_ids
       FROM agency_send_email_intake i
      WHERE i.mailbox = $1 AND i.status = 'accepted' AND i.reply_status IN ('pending', 'unknown')
        AND i.reply_attempts < $2
        -- ★2026-09-05 §21-3 (1) 시간 창 — reply_attempts는 실제 전송했을 때만 오른다.
        --   상한에 걸려 pending으로 남은 행은 시도 수가 영원히 0이라, 창이 없으면 이 5슬롯을
        --   영구 점유해 뒤에 온 정상 회신이 계속 밀린다(게이트가 살아나면서 생기는 굶주림).
        AND i.decided_at > NOW() - interval '24 hours'
      ORDER BY i.decided_at ASC LIMIT 5`,
    [mailbox, REPLY_MAX_ATTEMPTS],
  );
  for (const row of rows.rows) {
    if (!row.from_email || !row.request_ids?.length) continue;
    // ★2026-09-05 §21-4 **전량 조회**. 예전에는 request_ids[0]만 읽어, 다건 접수의 재시도 회신이
    //   5건 중 1건만 말했다(첫 회신이 실패한 담당자가 받는 유일한 확인이 잘못된 내용이 된다).
    //   순서는 접수 순서 그대로 — 순번 표기가 담당자 문자와 같은 번호를 가리켜야 한다.
    const req = await query(
      `SELECT id, subject, current_content, requested_at, callback_number, manager_phones, phone_column, recipient_count, file_name
         FROM agency_send_requests WHERE id = ANY($1::uuid[])
        ORDER BY array_position($1::uuid[], id)`, [row.request_ids],
      // ⛔ 재시도 회신에 requested_at_original을 넣지 않는다 — 컬럼 부재(DDL 전) 시 이 SELECT가 통째로
      //   실패해 재시도 패스가 멈춘다. 조정 고지는 첫 회신이 이미 했고, 여기는 도달 실패의 복구 경로다.
    );
    if (req.rows.length === 0) continue;
    const isMulti = req.rows.length > 1;
    const blocks = req.rows.map((r: any, i: number) => buildAcceptedReply({
      subject: r.subject || '', content: r.current_content || '', requestedAtIso: new Date(r.requested_at).toISOString(),
      callback: r.callback_number, managerPhones: r.manager_phones || [], phoneColumn: r.phone_column || '전화번호',
      autoPickedPhoneColumn: false, total: r.recipient_count, valid: r.recipient_count, dup: 0, invalid: 0,
      seq: isMulti ? { index: i + 1, total: req.rows.length, fileName: String(r.file_name || '요청서') } : undefined,
    }));
    // ★0905 Codex 1R 지적 ③ — 재시도는 **정본이 아니라 복구 경로**다. 접수 시점의 스킵 목록과
    //   확정 발송 계정은 원장에 스냅샷으로 남기지 않으므로(그러려면 컬럼 신설이 필요하다) 여기서 복원하지 않는다.
    //   대신 재발송본임을 밝히고 자세한 내역은 화면으로 유도한다 — 침묵하지 않는 것이 계약이다.
    const retryNotice = [
      '처음 보내드린 접수 완료 안내가 도달하지 못해 다시 보내드립니다.',
      '접수는 정상입니다. 건너뛴 요청서나 발송 계정 같은 자세한 내역은 아래 진행 상황 주소에서 확인해 주세요.',
      '',
    ].join('\n');
    await sendReplyAndRecord(row.id, mailbox, row.from_email,
      isMulti ? `[한줄로] 대행발송 ${req.rows.length}건 접수 완료` : '[한줄로] 대행발송 접수 완료',
      retryNotice + (isMulti ? buildMultiAcceptedReply(blocks, []) : blocks[0]),
      row.message_id || null, undefined, true);
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
