/**
 * ★ 2026-11-14 C133 F5 답장 상담 — 받기 · 번호 → 회사 · 판정 · 답장 보내기 · 상담함 · 운영자
 *   (설계서 docs/2026-11-13-hanjul-v3-design.md §7 · §18 「배포 D」 — 흐름 표 · 판정 순서 · 보내는 순간 다시 보는 것)
 *
 * 값만 내는 판정 = utils/inbound-sms-rules.ts. 이 파일 = DB 와 발송.
 *   · 회사는 받은 번호가 정한다(번호 표 한 번 읽기 · 추정 0). 받은 글의 회사는 받을 때 고정되고 그 뒤 다시 계산하지 않는다.
 *   · 번호의 이력은 번호 행이 전부 갖는다: 묶였던 회사(first_company_id)에만 다시 묶을 수 있고, 한 번이라도 수동 배정한 번호(shared_at)는 어느 회사에도 묶을 수 없다.
 *   · 보내는 단위 = 답장 행(direction out · ready → sending → sent · failed). 받은 글 하나에 자동 답장 행 하나(판정과 행 만들기가 한 문장).
 *   · 발송 = 직접발송 코어 호출만(받는 사람 1 · 광고 아님). 적재 묶음 id 를 먼저 적고 부른다 = 다시 만난 sending 은 발송 단계로 대조한다(다시 보내지 않는다).
 *   · 자동 답장은 보내는 순간에 단계 · 상담 설정 · 시간 · 발신번호(답장 행 = 설정 = 인증된 번호)를 다시 본다.
 *   · 사람 답장 = 화면이 만든 id 하나 · 답장 행 넣기가 성공했을 때만 받은 글을 바꾼다 · 화면이 버린 id 는 cancelled 행으로 닫는다(늦게 닿은 요청이 만들지 못한다).
 */
import { randomUUID } from 'crypto';
import { pool, query } from '../config/database';
import { UserFacingError } from './http-error';
import { v3LiveState } from './v3-stage';
import { hasCompanyLineGroup } from './sms-queue';
import { checkCallbackSpec } from './callback-spec';
import { isCallbackRegistered } from './callback-filter';
import { normalizePhone } from './normalize';
import { registerUnsubscribe, syncCustomerOptIn, isUserIsolationEnabled, IsolationBlockedError } from './unsubscribe-helper';
import { createDirectSendCampaign } from './direct-send-core';
import { DirectSendError } from './direct-send-spec';
import { DEFINITE_NO_COMMIT } from './planner-executor';
import { notifyOperatorAdmins } from './continuous-operator';
import { sendSystemAlert } from './system-alert';
import { callAIWithFallback } from '../services/ai';
import {
  normalizeInboundNumber, replyablePhone, storedFromPhone, maskCustomerPhone, maskSensitive,
  INBOUND_PROVIDER_ID_MAX, optOutKind, inboundAutoWindowOpen, INBOUND_AUTO_HOURS, kstDay, companyDailyCap, INBOUND_PHONE_DAILY_MAX,
  INBOUND_DEFAULT_HANDOFF, INBOUND_KB_MAX_ITEMS, INBOUND_KB_TITLE_MAX, INBOUND_KB_BODY_MAX, INBOUND_HANDOFF_MAX, INBOUND_HUMAN_REPLY_MAX,
  INBOUND_COMPANY_DAILY_LIMIT, buildInboundReply, measureInboundText, buildPickPrompt, pickUserMessage, parseKbPick,
} from './inbound-sms-rules';

export interface InboundCtx { companyId: string; userId: string }
export type InboundMode = 'auto' | 'draft' | 'off';
export type InboundStatus = 'unassigned' | 'new' | 'waiting' | 'answered' | 'human' | 'done' | 'optout';
/** cancelled = 화면이 보내지 않기로 한 답장 id(닫힌 id · 대화와 발송 대상에서 빠진다) */
export type ReplyStatus = 'ready' | 'sending' | 'sent' | 'failed' | 'cancelled';

/** 쥔 표식의 임대(분) — 프로세스가 죽어 놓지 못한 표식을 이 시간 뒤에 다른 실행이 다시 쥔다(AI 한 번 · 코어 한 번보다 넉넉히 길게) */
export const INBOUND_LEASE_MINUTES = 5;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const reject = (code: string, message: string, status = 400): UserFacingError => new UserFacingError(status, code, message);
const uuidOf = (raw: unknown): string => {
  const id = String(raw ?? '').trim().toLowerCase();
  if (!UUID_RE.test(id)) throw reject('INBOUND_ID', '요청 값이 올바르지 않아요.');
  return id;
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. 받기 — 저장만 하고 돌아온다(판정 · 답장은 워커)
// ─────────────────────────────────────────────────────────────────────────────

export interface InboundInput { from: unknown; to: unknown; text: unknown; receivedAt?: unknown; providerMsgId: unknown }

/**
 * 들어온 한 건을 저장한다. 같은 providerMsgId 두 번 = 한 번(stored false).
 *   회사 = 받은 번호(정규화한 값)로 번호 표를 한 번 읽는다. 없는 번호 · 안 묶인 번호 · 잘못된 꼴 = 미배정.
 */
export async function receiveInbound(input: InboundInput, now: Date = new Date()): Promise<{ stored: boolean; assigned: boolean }> {
  const providerMsgId = String(input.providerMsgId ?? '').trim();
  if (!providerMsgId || providerMsgId.length > INBOUND_PROVIDER_ID_MAX) throw reject('INBOUND_INPUT', 'providerMsgId 가 필요합니다(100자 이하).');
  const fromPhone = storedFromPhone(input.from);
  if (!fromPhone) throw reject('INBOUND_INPUT', 'from 이 필요합니다.');
  const body = maskSensitive(input.text);
  if (!body.trim()) throw reject('INBOUND_INPUT', 'text 가 필요합니다.');
  const toNorm = normalizeInboundNumber(input.to);
  const toNumber = toNorm || String(input.to ?? '').trim().slice(0, 20);
  if (!toNumber) throw reject('INBOUND_INPUT', 'to 가 필요합니다.');
  const given = input.receivedAt ? new Date(String(input.receivedAt)) : null;
  const receivedAt = given && !Number.isNaN(given.getTime()) && given.getTime() <= now.getTime() + 60_000 ? given : now;

  const bound = toNorm ? await query(`SELECT company_id FROM inbound_numbers WHERE number = $1`, [toNorm]) : { rows: [] as any[] };
  const companyId: string | null = bound.rows[0]?.company_id || null;
  const ins = await query(
    `INSERT INTO inbound_messages (id, provider_msg_id, direction, from_phone, to_number, body, company_id, status, received_at)
     VALUES ($1::uuid, $2, 'in', $3, $4, $5, $6::uuid, $7, $8)
     ON CONFLICT (provider_msg_id) DO NOTHING`,
    [randomUUID(), providerMsgId, fromPhone, toNumber, body, companyId, companyId ? 'new' : 'unassigned', receivedAt]);
  return { stored: (ins.rowCount || 0) === 1, assigned: !!companyId };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. 번호 · 미배정함(운영자) — 번호 행을 지우는 길은 없다
// ─────────────────────────────────────────────────────────────────────────────

export interface InboundNumberView {
  number: string; companyId: string | null; companyName: string | null; firstCompanyId: string | null; firstCompanyName: string | null;
  shared: boolean; note: string | null; createdAt: string;
}

export async function listInboundNumbers(): Promise<InboundNumberView[]> {
  const r = await query(
    `SELECT n.number, n.company_id, c.company_name, n.first_company_id, f.company_name AS first_company_name, n.shared_at, n.note, n.created_at
       FROM inbound_numbers n
       LEFT JOIN companies c ON c.id = n.company_id
       LEFT JOIN companies f ON f.id = n.first_company_id
      ORDER BY n.created_at DESC`);
  return r.rows.map((x: any) => ({
    number: String(x.number), companyId: x.company_id || null, companyName: x.company_name || null,
    firstCompanyId: x.first_company_id || null, firstCompanyName: x.first_company_name || null,
    shared: !!x.shared_at, note: x.note || null, createdAt: new Date(x.created_at).toISOString(),
  }));
}

const numberOf = (raw: unknown): string => {
  const n = normalizeInboundNumber(raw);
  if (!n) throw reject('INBOUND_NUMBER', '번호가 올바르지 않아요. 국내 번호(0 으로 시작 · 9 ~ 12자리)를 적어 주세요.');
  return n;
};

/** 번호 등록(안 묶인 채로) — 같은 번호가 있으면 그대로(created false) */
export async function registerInboundNumber(raw: unknown, note: unknown, adminId: string | null): Promise<{ number: string; created: boolean }> {
  const number = numberOf(raw);
  const r = await query(
    `INSERT INTO inbound_numbers (number, note, created_by) VALUES ($1, $2, $3::uuid) ON CONFLICT (number) DO NOTHING`,
    [number, String(note ?? '').trim().slice(0, 100) || null, adminId]);
  return { number, created: (r.rowCount || 0) === 1 };
}

/**
 * 회사에 묶기 — 처음 묶는 번호이거나 전에 그 회사에 묶였던 번호만 · 수동 배정 전용(shared_at)이 된 번호는 못 묶는다.
 *   처음 묶인 회사 칸을 바꾸는 문장은 이 COALESCE 하나뿐이다(한 번 정해지면 바뀌지 않는다).
 */
export async function bindInboundNumber(raw: unknown, rawCompanyId: unknown): Promise<void> {
  const number = numberOf(raw);
  const companyId = uuidOf(rawCompanyId);
  const co = await query(`SELECT 1 FROM companies WHERE id = $1::uuid`, [companyId]);
  if (co.rows.length === 0) throw reject('INBOUND_COMPANY', '회사를 찾을 수 없어요.', 404);
  const r = await query(
    `UPDATE inbound_numbers
        SET company_id = $2::uuid, first_company_id = COALESCE(first_company_id, $2::uuid), updated_at = NOW()
      WHERE number = $1 AND shared_at IS NULL AND (first_company_id IS NULL OR first_company_id = $2::uuid)`,
    [number, companyId]);
  if ((r.rowCount || 0) === 1) return;
  const cur = await query(`SELECT first_company_id, shared_at FROM inbound_numbers WHERE number = $1`, [number]);
  if (cur.rows.length === 0) throw reject('INBOUND_NUMBER_UNKNOWN', '등록하지 않은 번호예요. 먼저 번호를 등록해 주세요.', 404);
  if (cur.rows[0].shared_at) throw reject('INBOUND_NUMBER_SHARED', '이 번호로 온 글을 여러 회사에 직접 배정해 왔어요. 그런 번호는 한 회사에 묶을 수 없어요(다른 회사 고객의 문의가 섞여요).', 409);
  throw reject('INBOUND_NUMBER_OTHER', '전에 다른 회사에 묶였던 번호예요. 그 회사가 안내한 번호라 다른 회사에는 묶을 수 없어요.', 409);
}

/** 풀기 — 그 뒤 들어온 글은 미배정함으로(이미 받은 글의 회사는 그대로) */
export async function unbindInboundNumber(raw: unknown): Promise<boolean> {
  const number = numberOf(raw);
  const r = await query(`UPDATE inbound_numbers SET company_id = NULL, updated_at = NOW() WHERE number = $1 AND company_id IS NOT NULL`, [number]);
  return (r.rowCount || 0) === 1;
}

export interface UnassignedView {
  id: string; fromMasked: string; toNumber: string; body: string; receivedAt: string;
  /** 그 번호가 전에 묶였던 회사 — 있으면 그 회사로만 배정할 수 있다 */
  onlyCompanyId: string | null; onlyCompanyName: string | null;
}

export async function listUnassigned(limit = 100): Promise<UnassignedView[]> {
  const r = await query(
    `SELECT m.id, m.from_phone, m.to_number, m.body, m.received_at, n.first_company_id, f.company_name AS first_company_name
       FROM inbound_messages m
       LEFT JOIN inbound_numbers n ON n.number = m.to_number
       LEFT JOIN companies f ON f.id = n.first_company_id
      WHERE m.direction = 'in' AND m.status = 'unassigned'
      ORDER BY m.received_at DESC
      LIMIT $1::int`,
    [Math.max(1, Math.min(200, Math.floor(limit) || 100))]);
  return r.rows.map((x: any) => ({
    id: String(x.id), fromMasked: maskCustomerPhone(String(x.from_phone)), toNumber: String(x.to_number), body: String(x.body),
    receivedAt: new Date(x.received_at).toISOString(), onlyCompanyId: x.first_company_id || null, onlyCompanyName: x.first_company_name || null,
  }));
}

/**
 * 미배정 글을 회사에 배정한다 — 번호 행을 잠근 한 트랜잭션.
 *   그 번호가 전에 묶였던 회사가 있으면 그 회사로만. 없으면 그 번호는 이때부터 수동 배정 전용(shared_at)이다 = 뒤에 한 회사에 묶을 수 없다.
 *   배정된 글은 그 회사 상담함에 「사람 필요」로 보인다(늦게 배정된 글에 자동 답장 0).
 */
export async function assignInboundMessage(rawId: unknown, rawCompanyId: unknown, adminId: string | null): Promise<void> {
  const id = uuidOf(rawId);
  const companyId = uuidOf(rawCompanyId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const msg = await client.query(`SELECT to_number FROM inbound_messages WHERE id = $1::uuid AND direction = 'in' AND status = 'unassigned' FOR UPDATE`, [id]);
    if (msg.rows.length === 0) throw reject('INBOUND_NOT_UNASSIGNED', '이미 배정됐거나 없는 글이에요.', 409);
    const co = await client.query(`SELECT 1 FROM companies WHERE id = $1::uuid`, [companyId]);
    if (co.rows.length === 0) throw reject('INBOUND_COMPANY', '회사를 찾을 수 없어요.', 404);
    // 번호 행은 받은 번호가 바른 꼴일 때만 있다(잘못된 꼴의 번호는 묶을 수도 없다 = 남길 이력이 없다)
    const number = normalizeInboundNumber(msg.rows[0].to_number);
    if (number && number === String(msg.rows[0].to_number)) {
      await client.query(`INSERT INTO inbound_numbers (number, created_by) VALUES ($1, $2::uuid) ON CONFLICT (number) DO NOTHING`, [number, adminId]);
      const num = await client.query(`SELECT company_id, first_company_id FROM inbound_numbers WHERE number = $1 FOR UPDATE`, [number]);
      const first: string | null = num.rows[0]?.first_company_id || null;
      if (first && first !== companyId) throw reject('INBOUND_NUMBER_OTHER', '이 번호는 전에 다른 회사에 묶였던 번호예요. 그 회사로만 배정할 수 있어요.', 409);
      if (!first) await client.query(`UPDATE inbound_numbers SET shared_at = COALESCE(shared_at, NOW()), updated_at = NOW() WHERE number = $1`, [number]);
    }
    await client.query(
      `UPDATE inbound_messages SET company_id = $2::uuid, status = 'human', assigned_by = $3::uuid, note = '운영자가 배정한 문의예요.', updated_at = NOW() WHERE id = $1::uuid`,
      [id, companyId, adminId]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/** 그 회사에 지금 묶인 번호(먼저 묶인 순) */
export async function companyInboundNumbers(companyId: string): Promise<string[]> {
  const r = await query(`SELECT number FROM inbound_numbers WHERE company_id = $1::uuid ORDER BY created_at, number`, [companyId]);
  return r.rows.map((x: any) => String(x.number));
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. 설정 · 답변 항목(회사 관리자)
// ─────────────────────────────────────────────────────────────────────────────

export interface InboundSettingsView {
  enabled: boolean; mode: InboundMode; replyCallback: string | null; dailyCap: number | null; notifyPhone: string | null; handoffText: string;
  /** 자동 답장이 지금 나갈 수 있는 상태인가(답장 발신번호가 인증된 번호와 같다) */
  autoReady: boolean;
}
interface SettingsRow {
  company_id: string; enabled: boolean; mode: InboundMode; reply_callback: string | null; auth_callback: string | null;
  daily_cap: number | null; notify_phone: string | null; handoff_text: string | null; updated_by: string | null;
}

async function settingsRow(companyId: string): Promise<SettingsRow | null> {
  const r = await query(`SELECT * FROM inbound_settings WHERE company_id = $1::uuid`, [companyId]);
  return (r.rows[0] as SettingsRow) || null;
}
const handoffOf = (s: SettingsRow | null): string => (s?.handoff_text && s.handoff_text.trim()) || INBOUND_DEFAULT_HANDOFF;
const settingsView = (s: SettingsRow | null): InboundSettingsView => ({
  enabled: !!s?.enabled, mode: (s?.mode as InboundMode) || 'auto', replyCallback: s?.reply_callback || null, dailyCap: s?.daily_cap ?? null,
  notifyPhone: s?.notify_phone || null, handoffText: handoffOf(s),
  autoReady: !!s?.enabled && s?.mode === 'auto' && !!s.reply_callback && s.reply_callback === s.auth_callback,
});

export async function readInboundSettings(companyId: string): Promise<InboundSettingsView> {
  return settingsView(await settingsRow(companyId));
}

/** 그 회사에 묶인 번호 가운데 꼬리 줄이 가장 길어지는 번호로 잰다(저장한 글은 어느 번호로 온 문의에도 나갈 수 있어야 한다) */
async function textIssueForCompany(companyId: string, body: string, replyCallback: string): Promise<string | null> {
  const numbers = await companyInboundNumbers(companyId);
  for (const n of numbers.length > 0 ? numbers : ['']) {
    const built = buildInboundReply(body, replyCallback, n);
    if (!built.ok) return built.issue;
  }
  return null;
}

export interface InboundSettingsInput { enabled: unknown; mode: unknown; replyCallback: unknown; dailyCap: unknown; notifyPhone: unknown; handoffText: unknown }
export type SenderGate = (callback: string) => Promise<{ ok: true } | { ok: false; rejection: unknown }>;

/**
 * 설정 저장 — 설정을 쓰는 문장은 이 함수 하나.
 *   결과가 「상담 켬 ∧ 방식 = 바로 답장」이면 **결과의 답장 발신번호로** 발신 인증을 지난 뒤에만 저장하고, 지난 번호를 같은 문장에서 auth_callback 에 적는다
 *   (처음 켤 때 · 켠 채로 발신번호만 바꿀 때 · 그대로 다시 저장할 때 모두). 그 밖의 결과 = auth_callback 을 비운다.
 */
export async function saveInboundSettings(ctx: InboundCtx, input: InboundSettingsInput, gate: SenderGate): Promise<{ saved: true; settings: InboundSettingsView } | { saved: false; rejection: unknown }> {
  const enabled = input.enabled === true;
  const mode = String(input.mode ?? '');
  if (mode !== 'auto' && mode !== 'draft' && mode !== 'off') throw reject('INBOUND_MODE', '답장 방식을 골라 주세요.');
  const rawCallback = String(input.replyCallback ?? '').trim();
  let replyCallback: string | null = null;
  if (rawCallback) {
    const digits = rawCallback.replace(/\D/g, '');
    if (!checkCallbackSpec(rawCallback).ok || !(await isCallbackRegistered(ctx.companyId, digits))) {
      throw reject('INBOUND_CALLBACK', '답장 발신번호가 등록되지 않았거나 규격에 맞지 않아요. 등록된 발신번호에서 골라 주세요.');
    }
    replyCallback = digits;
  }
  let dailyCap: number | null = null;
  if (input.dailyCap !== null && input.dailyCap !== undefined && String(input.dailyCap).trim() !== '') {
    const n = Number(input.dailyCap);
    if (!Number.isInteger(n) || n < 1 || n > INBOUND_COMPANY_DAILY_LIMIT) throw reject('INBOUND_CAP', `하루 상한은 1 ~ ${INBOUND_COMPANY_DAILY_LIMIT.toLocaleString()} 사이의 수로 적어 주세요.`);
    dailyCap = n;
  }
  let notifyPhone: string | null = null;
  if (String(input.notifyPhone ?? '').trim()) {
    notifyPhone = normalizePhone(input.notifyPhone);
    if (!notifyPhone) throw reject('INBOUND_NOTIFY', '알릴 번호가 올바르지 않아요. 휴대폰 번호를 적어 주세요.');
  }
  const handoffRaw = String(input.handoffText ?? '').trim();
  if ([...handoffRaw].length > INBOUND_HANDOFF_MAX) throw reject('INBOUND_HANDOFF', `넘김 문장은 ${INBOUND_HANDOFF_MAX}자까지 적을 수 있어요.`);
  const handoffText = handoffRaw && handoffRaw !== INBOUND_DEFAULT_HANDOFF ? handoffRaw : null;

  if (enabled) {
    if ((await companyInboundNumbers(ctx.companyId)).length === 0) throw reject('INBOUND_NO_NUMBER', '상담 번호가 아직 없어요. 번호가 연결된 뒤에 켤 수 있어요.');
    if (!replyCallback) throw reject('INBOUND_CALLBACK', '답장 발신번호를 골라 주세요.');
    const issue = await textIssueForCompany(ctx.companyId, handoffText || INBOUND_DEFAULT_HANDOFF, replyCallback);
    if (issue) throw reject('INBOUND_HANDOFF', `넘김 문장: ${issue}`);
  }
  const auto = enabled && mode === 'auto';
  if (auto) {
    const g = await gate(replyCallback as string);
    if (!g.ok) return { saved: false, rejection: g.rejection };
  }
  await query(
    `INSERT INTO inbound_settings (company_id, enabled, mode, reply_callback, auth_callback, daily_cap, notify_phone, handoff_text, updated_by, updated_at)
     VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::uuid, NOW())
     ON CONFLICT (company_id) DO UPDATE
       SET enabled = EXCLUDED.enabled, mode = EXCLUDED.mode, reply_callback = EXCLUDED.reply_callback, auth_callback = EXCLUDED.auth_callback,
           daily_cap = EXCLUDED.daily_cap, notify_phone = EXCLUDED.notify_phone, handoff_text = EXCLUDED.handoff_text,
           updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [ctx.companyId, enabled, mode, replyCallback, auto ? replyCallback : null, dailyCap, notifyPhone, handoffText, ctx.userId]);
  return { saved: true, settings: await readInboundSettings(ctx.companyId) };
}

export interface KbItemView { id: string; title: string; body: string; enabled: boolean; sort: number }

export async function listKbItems(companyId: string): Promise<KbItemView[]> {
  const r = await query(`SELECT id, title, body, enabled, sort FROM inbound_kb_items WHERE company_id = $1::uuid ORDER BY sort, created_at`, [companyId]);
  return r.rows.map((x: any) => ({ id: String(x.id), title: String(x.title), body: String(x.body), enabled: x.enabled === true, sort: Number(x.sort) || 0 }));
}

/** 답변 항목 저장(새로 · 고치기) — 나갈 글 = 저장한 글이라 저장할 때 글자 · 바이트를 잰다(꼬리 줄을 더한 길이로) */
export async function saveKbItem(ctx: InboundCtx, input: { id?: unknown; title: unknown; body: unknown; enabled?: unknown; sort?: unknown }): Promise<KbItemView> {
  const title = String(input.title ?? '').trim();
  const body = String(input.body ?? '').trim();
  if (!title || [...title].length > INBOUND_KB_TITLE_MAX) throw reject('INBOUND_KB', `제목을 ${INBOUND_KB_TITLE_MAX}자 안으로 적어 주세요.`);
  if (!body || [...body].length > INBOUND_KB_BODY_MAX) throw reject('INBOUND_KB', `답변 글을 ${INBOUND_KB_BODY_MAX}자 안으로 적어 주세요.`);
  const s = await settingsRow(ctx.companyId);
  const issue = await textIssueForCompany(ctx.companyId, body, s?.reply_callback || '');
  if (issue) throw reject('INBOUND_KB', issue);
  const enabled = input.enabled !== false;
  const sort = Number.isInteger(Number(input.sort)) ? Number(input.sort) : 0;
  if (input.id) {
    const id = uuidOf(input.id);
    const r = await query(
      `UPDATE inbound_kb_items SET title = $3, body = $4, enabled = $5, sort = $6, updated_at = NOW() WHERE id = $1::uuid AND company_id = $2::uuid RETURNING id`,
      [id, ctx.companyId, title, body, enabled, sort]);
    if (r.rows.length === 0) throw reject('INBOUND_KB', '답변 항목을 찾을 수 없어요.', 404);
    return { id, title, body, enabled, sort };
  }
  const id = randomUUID();
  const r = await query(
    `INSERT INTO inbound_kb_items (id, company_id, title, body, enabled, sort)
     SELECT $1::uuid, $2::uuid, $3, $4, $5, $6
      WHERE (SELECT COUNT(*) FROM inbound_kb_items WHERE company_id = $2::uuid) < $7::int`,
    [id, ctx.companyId, title, body, enabled, sort, INBOUND_KB_MAX_ITEMS]);
  if ((r.rowCount || 0) !== 1) throw reject('INBOUND_KB', `답변 항목은 ${INBOUND_KB_MAX_ITEMS}개까지 만들 수 있어요.`);
  return { id, title, body, enabled, sort };
}

export async function deleteKbItem(ctx: InboundCtx, rawId: unknown): Promise<boolean> {
  const r = await query(`DELETE FROM inbound_kb_items WHERE id = $1::uuid AND company_id = $2::uuid`, [uuidOf(rawId), ctx.companyId]);
  return (r.rowCount || 0) === 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. 판정(워커) — 받은 글 하나 · 설계서 「판정 순서」 그대로
// ─────────────────────────────────────────────────────────────────────────────

interface MsgRow {
  id: string; direction: 'in' | 'out'; from_phone: string; to_number: string; body: string; company_id: string; status: string;
  handled_by: string | null; kb_item_id: string | null; reply_to: string | null; reply_callback: string | null;
  reply_staging_id: string | null; reply_campaign_id: string | null; received_at: Date; created_at: Date;
}

export type DecideOutcome = 'skip' | 'later' | 'optout' | 'human' | 'waiting' | 'answered' | 'handoff' | 'draft' | 'lost';
export interface DecideDeps { pick?: (system: string, user: string, companyId: string) => Promise<string> }

/** 답변 항목 고르기의 AI 호출 — 출력은 번호 하나(고객에게 나가는 글이 아니다 · 나가는 글은 회사가 등록한 글 그대로) */
async function pickKbItemByAi(system: string, user: string, companyId: string): Promise<string> {
  return callAIWithFallback({
    system, userMessage: user, maxTokens: 20, temperature: 0, companyId, source: 'inbound-reply-pick', noCache: true,
    charge: { kind: 'internal', why: '답장 상담의 답변 항목 고르기(이번 판은 크레딧을 받지 않는다)' },
  });
}

/** 사람에게 넘길 때 알릴 번호로 한 통 — 회사마다 30분에 한 번(프로세스 안 기억 · 재시작하면 비워진다 = 한 통 더 갈 뿐이다) */
const NOTIFY_GAP_MS = 30 * 60 * 1000;
const lastNotice = new Map<string, number>();
async function notifyHuman(s: SettingsRow | null, now: Date): Promise<void> {
  if (!s?.enabled || !s.notify_phone) return;
  const last = lastNotice.get(s.company_id) || 0;
  if (now.getTime() - last < NOTIFY_GAP_MS) return;
  lastNotice.set(s.company_id, now.getTime());
  await notifyOperatorAdmins(
    { adminPhoneNumbers: [s.notify_phone], backupAdminPhone: null, companyId: s.company_id, createdBy: s.updated_by },
    '[상담함] 확인이 필요한 문의', '상담 번호로 온 문의 가운데 직접 답해야 하는 글이 있어요. 한줄로 상담함에서 확인해 주세요.',
  ).catch((e: any) => { console.warn('[inbound] 넘김 알림 실패:', e?.message || e); return false; });
}

/** 받은 글의 끝 상태를 적는다 — 내 표식일 때만(0행 = 쥔 것을 잃었다) */
async function settleInbound(row: MsgRow, token: string, status: InboundStatus, f: { note?: string | null; draft?: string | null; handledBy?: string | null; kbItemId?: string | null } = {}): Promise<boolean> {
  const r = await query(
    `UPDATE inbound_messages
        SET status = $3, note = $4, draft = $5, handled_by = $6, kb_item_id = $7::uuid, claim_token = NULL, claimed_at = NULL, updated_at = NOW()
      WHERE id = $1::uuid AND claim_token = $2::uuid`,
    [row.id, token, status, f.note ?? null, f.draft ?? null, f.handledBy ?? null, f.kbItemId ?? null]);
  return (r.rowCount || 0) === 1;
}

/** 판정과 답장 행 만들기 = 한 문장(내 표식일 때만 받은 글을 바꾸고 · 그 행이 바뀌었을 때만 답장 행을 넣는다) */
async function settleWithReply(row: MsgRow, token: string, status: InboundStatus, note: string | null, kbItemId: string | null, text: string, callback: string): Promise<boolean> {
  const replyId = randomUUID();
  const r = await query(
    `WITH upd AS (
       UPDATE inbound_messages
          SET status = $3, note = $4, handled_by = 'ai', kb_item_id = $5::uuid, draft = NULL, claim_token = NULL, claimed_at = NULL, updated_at = NOW()
        WHERE id = $1::uuid AND claim_token = $2::uuid
        RETURNING id, company_id, from_phone, to_number
     )
     INSERT INTO inbound_messages (id, provider_msg_id, direction, from_phone, to_number, body, company_id, status, handled_by, kb_item_id, reply_to, reply_callback, received_at)
     SELECT $6::uuid, 'out:' || $6::text, 'out', upd.from_phone, upd.to_number, $7, upd.company_id, 'ready', 'ai', $5::uuid, upd.id, $8, NOW()
       FROM upd`,
    [row.id, token, status, note, kbItemId, replyId, text, callback]);
  return (r.rowCount || 0) === 1;
}

/**
 * AI 예산 — 한 트랜잭션: 그 회사의 설정 행을 잠그고(그 회사의 예약이 한 줄로 선다) → 다음 문장에서 지금 값을 세어
 *   그 고객 번호의 오늘 것이 3번 미만 · 회사의 오늘 것이 상한 미만일 때만 받은 글 행에 ai_called_at 을 적는다.
 *   부른 수를 세는 예산이다(AI 가 실패해도 돌려주지 않는다). 자동 답장은 만든 날에만 나가므로 이 수가 곧 하루 자동 답장의 상한이다.
 */
async function reserveAiBudget(row: MsgRow, token: string, companyCap: number): Promise<boolean> {
  const day = `(date_trunc('day', NOW() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul')`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lock = await client.query(`SELECT 1 FROM inbound_settings WHERE company_id = $1::uuid FOR UPDATE`, [row.company_id]);
    if (lock.rows.length === 0) { await client.query('ROLLBACK'); return false; }
    const r = await client.query(
      `UPDATE inbound_messages SET ai_called_at = NOW()
        WHERE id = $1::uuid AND claim_token = $2::uuid
          AND (SELECT COUNT(*) FROM inbound_messages p WHERE p.company_id = $3::uuid AND p.from_phone = $4 AND p.ai_called_at >= ${day}) < $5::int
          AND (SELECT COUNT(*) FROM inbound_messages c WHERE c.company_id = $3::uuid AND c.ai_called_at >= ${day}) < $6::int`,
      [row.id, token, row.company_id, row.from_phone, INBOUND_PHONE_DAILY_MAX, companyCap]);
    await client.query('COMMIT');
    return (r.rowCount || 0) === 1;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/** 받은 글 하나를 쥐고 판정한다(끝나면 표식을 놓는다) */
export async function decideInbound(rawId: string, now: Date = new Date(), deps: DecideDeps = {}): Promise<DecideOutcome> {
  const id = uuidOf(rawId);
  const token = randomUUID();
  const c = await query(
    `UPDATE inbound_messages SET claim_token = $2::uuid, claimed_at = NOW(), updated_at = NOW()
      WHERE id = $1::uuid AND direction = 'in' AND status = 'new' AND company_id IS NOT NULL
        AND (claim_token IS NULL OR claimed_at < NOW() - make_interval(mins => $3::int))
      RETURNING *`,
    [id, token, INBOUND_LEASE_MINUTES]);
  const row = c.rows[0] as MsgRow | undefined;
  if (!row) return 'skip';
  try {
    return await decideClaimedInbound(row, token, now, deps);
  } finally {
    await query(`UPDATE inbound_messages SET claim_token = NULL, claimed_at = NULL WHERE id = $1::uuid AND claim_token = $2::uuid`, [id, token])
      .catch((e: any) => console.error(`[inbound] 표식 놓기 실패 msg=${id}:`, e?.message || e));
  }
}

async function decideClaimedInbound(row: MsgRow, token: string, now: Date, deps: DecideDeps): Promise<DecideOutcome> {
  const companyId = row.company_id;
  const s = await settingsRow(companyId);
  const toHuman = async (note: string, f: { draft?: string | null; kbItemId?: string | null } = {}): Promise<DecideOutcome> => {
    if (!(await settleInbound(row, token, 'human', { note, ...f }))) return 'lost';
    await notifyHuman(s, now);
    return f.draft ? 'draft' : 'human';
  };

  // 1 · 2 수신거부 — 상담 설정 · 단계와 무관하게 맨 앞에서
  const refusal = optOutKind(row.body);
  if (refusal === 'command') {
    const isolated = await isUserIsolationEnabled(companyId);
    if (!isolated) {
      try {
        await registerUnsubscribe(companyId, s?.updated_by || companyId, 'company_admin', row.from_phone, 'inbound_sms');
        await syncCustomerOptIn(companyId, [row.from_phone], false);
        return (await settleInbound(row, token, 'optout', { note: '수신거부로 등록했어요.' })) ? 'optout' : 'lost';
      } catch (e: any) {
        if (!(e instanceof IsolationBlockedError)) throw e;
      }
    }
    // 격리가 켜진 회사 — 어느 계정의 명단인지 정할 수 없다 → 회사 담당자에게 알리고 사람 함
    await notifyOperatorAdmins(
      { adminPhoneNumbers: [], backupAdminPhone: null, companyId, createdBy: s?.updated_by || null },
      '[상담 번호] 수신거부 요청', `${row.from_phone} 고객이 상담 번호로 수신거부를 요청했어요. 한줄로 수신거부 메뉴에서 등록해 주세요.`,
    ).catch((e: any) => { console.warn('[inbound] 수신거부 알림 실패:', e?.message || e); return false; });
    return (await settleInbound(row, token, 'human', { note: '수신거부 요청이에요. 수신거부 메뉴에서 등록해 주세요(계정마다 명단이 따로라 자동으로 등록하지 않았어요).' })) ? 'human' : 'lost';
  }
  if (refusal === 'mention') return toHuman('수신거부와 관련된 문의일 수 있어요.');

  // 3 · 4 단계 개방 · 상담 켬
  const live = await v3LiveState('inbox', companyId);
  if (live === 'unknown') return 'later';
  if (live === 'closed' || !s?.enabled) return toHuman('상담이 꺼져 있어 자동으로 답하지 않았어요.');
  // 5 답장할 수 있는 번호
  const phone = replyablePhone(row.from_phone);
  if (!phone || phone === row.to_number) return toHuman('답장할 수 없는 번호예요.');
  // 6 방식 = 끔
  if (s.mode === 'off') return toHuman('직접 답하는 방식이에요.');
  const auto = s.mode === 'auto';
  // 7 야간
  if (auto && !inboundAutoWindowOpen(now)) return (await settleInbound(row, token, 'waiting', { note: '자동 답장 시간(08 ~ 21시)에 다시 판정해요.' })) ? 'waiting' : 'lost';
  // 8 답변 항목 · 발신번호
  const items = (await listKbItems(companyId)).filter((it) => it.enabled);
  if (items.length === 0) return toHuman('등록한 답변 항목이 없어요.');
  if (auto && (!s.reply_callback || s.reply_callback !== s.auth_callback)) return toHuman('답장 발신번호를 다시 골라 주세요.');
  // 9 AI 예산 — 부르기 전에 잡는다(그 회사의 예약이 한 줄로 선다)
  if (!(await reserveAiBudget(row, token, companyDailyCap(s.daily_cap)))) return toHuman('오늘 자동으로 처리할 수 있는 수를 넘었어요.');
  // 10 ~ 12 AI 고르기
  let raw: string;
  try {
    raw = await (deps.pick || pickKbItemByAi)(buildPickPrompt(items), pickUserMessage(row.body), companyId);
  } catch (e: any) {
    console.warn(`[inbound] 항목 고르기 실패 msg=${row.id}:`, e?.message || e);
    return toHuman('자동 판정을 하지 못했어요.');
  }
  const pick = parseKbPick(raw, items.length);
  if (pick.kind === 'invalid') return toHuman('자동 판정을 하지 못했어요.');
  // 9-1 낱말 목록이 놓친 거부 의사 — 답장 없이(넘김 문장도 없이) 사람이 본다
  if (pick.kind === 'refusal') return toHuman('수신거부와 관련된 문의일 수 있어요.');
  if (pick.kind === 'item') {
    const item = items[pick.index];
    if (!auto) return toHuman('고른 답변을 확인하고 보내 주세요.', { draft: item.body, kbItemId: item.id });
    const built = buildInboundReply(item.body, s.reply_callback as string, row.to_number);
    if (!built.ok) return toHuman(`답변 항목 「${item.title}」: ${built.issue}`);
    return (await settleWithReply(row, token, 'answered', null, item.id, built.reply.text, s.reply_callback as string)) ? 'answered' : 'lost';
  }
  // 없음
  if (!auto) return toHuman('등록한 답변에 없는 문의예요.');
  const built = buildInboundReply(handoffOf(s), s.reply_callback as string, row.to_number);
  if (!built.ok) return toHuman(`넘김 문장: ${built.issue}`);
  if (!(await settleWithReply(row, token, 'human', '등록한 답변에 없는 문의예요. 고객에게는 넘김 문장을 보냈어요.', null, built.reply.text, s.reply_callback as string))) return 'lost';
  await notifyHuman(s, now);
  return 'handoff';
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. 보내기 — 답장 행 하나 · 설계서 「보내는 순간 다시 보는 것」 그대로
// ─────────────────────────────────────────────────────────────────────────────

export type SendOutcome = 'skip' | 'later' | 'sent' | 'failed' | 'unknown' | 'lost';

const dropStaging = (stagingId: string) =>
  query(`DELETE FROM campaign_send_staging WHERE staging_id = $1::uuid`, [stagingId]).catch((e: any) => console.error(`[inbound] 적재 묶음 정리 실패 staging=${stagingId}:`, e?.message || e));

/**
 * 답장 행을 failed 로 — 같은 문장에서 그 받은 글을 「사람 필요」로 돌린다(내 표식일 때만).
 *   잠그는 차례 = **받은 글 먼저 → 답장 행**(이 파일의 모든 문장이 같은 차례다: 사람 답장 = 받은 글을 잠그고 답장 행을 넣는다 · 자동 답장 = 받은 글을 바꾸고 답장 행을 넣는다).
 *   답장 행부터 고치면 같은 답장 id 의 겹친 요청(받은 글을 쥐고 그 답장 행이 풀리기를 기다린다)과 서로를 기다리다 멈춘다.
 */
async function failReply(row: MsgRow, token: string, note: string): Promise<SendOutcome> {
  const r = await query(
    `WITH parent AS (
       SELECT id FROM inbound_messages WHERE id = $5::uuid AND direction = 'in' FOR UPDATE
     ), f AS (
       UPDATE inbound_messages r SET status = 'failed', note = $3, claim_token = NULL, claimed_at = NULL, updated_at = NOW()
         FROM parent
        WHERE r.id = $1::uuid AND r.claim_token = $2::uuid AND r.reply_to = parent.id
       RETURNING r.reply_to
     ), back AS (
       UPDATE inbound_messages m SET status = 'human', note = $4, updated_at = NOW()
         FROM f WHERE m.id = f.reply_to AND m.direction = 'in' AND m.status IN ('answered', 'human')
     )
     SELECT COUNT(*)::int AS n FROM f`,
    [row.id, token, note, `답장이 나가지 않았어요: ${note}`.slice(0, 200), row.reply_to]);
  return Number(r.rows[0]?.n) === 1 ? 'failed' : 'lost';
}

async function writeReply(row: MsgRow, token: string, set: string, params: any[]): Promise<boolean> {
  const r = await query(`UPDATE inbound_messages SET ${set}, claimed_at = NOW(), updated_at = NOW() WHERE id = $1::uuid AND claim_token = $2::uuid`, [row.id, token, ...params]);
  return (r.rowCount || 0) === 1;
}

/** 다시 만난 sending — 그 적재 묶음 id 의 캠페인을 발송 단계까지 본다(다시 보내지 않는다) */
async function reconcileReply(row: MsgRow): Promise<{ seen: 'none' } | { seen: 'sent'; campaignId: string } | { seen: 'failed' } | { seen: 'unknown' }> {
  const c = await query(`SELECT id, send_phase FROM campaigns WHERE staging_id = $1::uuid AND company_id = $2::uuid ORDER BY created_at DESC`, [row.reply_staging_id, row.company_id]);
  if (c.rows.length === 0) return { seen: 'none' };
  const live = c.rows.find((r: any) => ['queued', 'processing', 'sent'].includes(String(r.send_phase)));
  if (live) return { seen: 'sent', campaignId: String(live.id) };
  if (c.rows.every((r: any) => String(r.send_phase) === 'failed')) return { seen: 'failed' };
  return { seen: 'unknown' };
}

/** 시각을 읽는 함수 — 시각은 쓰는 자리에서 읽는다(미리 읽어 넘기지 않는다 · 운영 = 지금 · 시험이 시각을 옮긴다) */
export type InboundClock = () => Date;
const realClock: InboundClock = () => new Date();

/**
 * 활성화 문장이 답장 행의 잠금을 얻은 뒤의 한국 시각 = DB 의 **실제 지금**(clock_timestamp — NOW() 는 문장을 시작한 시각이라
 *   잠금을 기다리는 사이 흐른 시간을 못 본다) + 시계 차($4 초 · 운영 0 · 시험이 시각을 옮겼을 때만 값이 있다)
 */
const GUARD_AT = `((clock_timestamp() + make_interval(secs => $4::double precision)) AT TIME ZONE 'Asia/Seoul')`;
/**
 * 코어의 활성화 문장에 거는 조건 = 나가는 마지막 문. 두 겹이다.
 *   안쪽(held) = 답장 행을 잠그고 본다: 내 표식 ∧ 상담 켬 ∧ 답장 행의 발신번호 = 설정의 발신번호 ∧ (사람 답장이거나 · 방식이 바로 답장이고 인증된 번호와 같다).
 *   바깥 = 안쪽이 **잠금을 얻어 행을 낸 뒤에** 본다: 사람 답장이거나 · 그 순간이 만든 날의 자동 답장 시간 안이다(기다린 시간이 판정에 든다 · 이 뒤의 자리는 커밋뿐이다).
 *   안쪽의 OFFSET 0 = 울타리. 없으면 PostgreSQL 이 바깥 조건을 안쪽 WHERE 로 밀어 넣어 잠금을 얻기 전에 시각을 읽는다
 *     (실 PG 시험이 「잠금을 기다리는 사이 21시를 넘긴 문장」으로 직접 확인한다 — 울타리를 빼면 그 시험이 참을 받는다).
 */
export const INBOUND_ACTIVATION_GUARD_SQL = `EXISTS (
  SELECT 1 FROM (
    SELECT m.handled_by, m.created_at
      FROM inbound_messages m JOIN inbound_settings s ON s.company_id = m.company_id
     WHERE m.id = $2::uuid AND m.claim_token = $3::uuid AND s.enabled
       AND s.reply_callback = m.reply_callback
       AND (m.handled_by = 'human' OR (s.mode = 'auto' AND s.auth_callback = m.reply_callback))
    OFFSET 0
       FOR SHARE OF m
  ) held
  WHERE held.handled_by = 'human'
     OR (EXTRACT(HOUR FROM ${GUARD_AT}) >= ${INBOUND_AUTO_HOURS.start} AND EXTRACT(HOUR FROM ${GUARD_AT}) < ${INBOUND_AUTO_HOURS.end}
         AND ${GUARD_AT}::date = (held.created_at AT TIME ZONE 'Asia/Seoul')::date))`;

/** 답장 행 하나를 쥐고 보낸다(끝나면 표식을 놓는다) */
export async function sendReply(rawId: string, clock: InboundClock = realClock): Promise<SendOutcome> {
  const id = uuidOf(rawId);
  const token = randomUUID();
  const c = await query(
    `UPDATE inbound_messages SET claim_token = $2::uuid, claimed_at = NOW(), updated_at = NOW()
      WHERE id = $1::uuid AND direction = 'out' AND status IN ('ready', 'sending')
        AND (claim_token IS NULL OR claimed_at < NOW() - make_interval(mins => $3::int))
      RETURNING *`,
    [id, token, INBOUND_LEASE_MINUTES]);
  const row = c.rows[0] as MsgRow | undefined;
  if (!row) return 'skip';
  try {
    return await sendClaimedReply(row, token, clock);
  } finally {
    await query(`UPDATE inbound_messages SET claim_token = NULL, claimed_at = NULL WHERE id = $1::uuid AND claim_token = $2::uuid`, [id, token])
      .catch((e: any) => console.error(`[inbound] 표식 놓기 실패 reply=${id}:`, e?.message || e));
  }
}

async function sendClaimedReply(row: MsgRow, token: string, clock: InboundClock): Promise<SendOutcome> {
  const companyId = row.company_id;
  const ai = row.handled_by === 'ai';
  // 대조 — sending 인 답장 행은 다시 보내기 전에 캠페인부터 찾는다
  if (row.status === 'sending' && row.reply_staging_id) {
    const seen = await reconcileReply(row);
    if (seen.seen === 'sent') return (await writeReply(row, token, `status = 'sent', reply_campaign_id = $3::uuid, claim_token = NULL`, [seen.campaignId])) ? 'sent' : 'lost';
    if (seen.seen === 'failed') return failReply(row, token, '발송이 접수되지 않았어요.');
    if (seen.seen === 'unknown') {
      console.error(`[inbound][OPS] 답장 접수 결과 불명 reply=${row.id} staging=${row.reply_staging_id} — 캠페인 발송 단계 확인 필요`);
      await sendSystemAlert({ dedupKey: `inbound-reply-unknown:${row.id}`, companyId, message: `답장 상담: 답장 접수 결과를 확인하지 못했습니다(reply=${row.id}). 캠페인 발송 단계를 확인해 주세요.` }).catch(() => 0);
      return failReply(row, token, '발송 접수 결과를 확인하지 못했어요. 발송결과에서 나갔는지 확인해 주세요.');
    }
    await dropStaging(row.reply_staging_id);
    if (!(await writeReply(row, token, `status = 'ready', reply_staging_id = NULL`, []))) return 'lost';
    row.status = 'ready'; row.reply_staging_id = null;
  }

  // 보내는 순간 다시 보는 것
  const live = await v3LiveState('inbox', companyId);
  if (live === 'unknown') return 'later';
  const s = await settingsRow(companyId);
  if (live === 'closed' || !s?.enabled) return failReply(row, token, '상담이 꺼져 있어 보내지 않았어요.');
  if (ai && s.mode !== 'auto') return failReply(row, token, '상담 설정이 바뀌어 보내지 않았어요.');
  // 자동 답장은 만든 날의 자동 답장 시간 안에만 나간다(다음 날로 넘기지 않는다 = AI 를 부른 날이 곧 나간 날).
  //   여기는 차감 전에 일찍 거르는 자리(사유를 적는다) · 마지막 문은 활성화 문장의 조건이 그 순간의 시각으로 다시 본다.
  const now = clock();
  if (ai && (!inboundAutoWindowOpen(now) || kstDay(row.created_at) !== kstDay(now))) return failReply(row, token, '자동 답장 시간이 지나 보내지 않았어요.');
  const callback = row.reply_callback || '';
  if (!callback || callback !== s.reply_callback || (ai && callback !== s.auth_callback)) return failReply(row, token, '답장 발신번호가 바뀌어 보내지 않았어요.');
  if (!(await hasCompanyLineGroup(companyId)) || !checkCallbackSpec(callback).ok || !(await isCallbackRegistered(companyId, callback))) {
    return failReply(row, token, '답장 발신번호를 다시 골라 주세요.');
  }
  const phone = replyablePhone(row.from_phone);
  if (!phone) return failReply(row, token, '답장할 수 없는 번호예요.');
  const measured = measureInboundText(row.body);
  if (!measured.ok) return failReply(row, token, measured.issue);

  // 표식: 이 시도의 적재 묶음 id 를 먼저 적는다(그 뒤에 죽어도 대조가 이 id 로 캠페인을 찾는다)
  const stagingId = randomUUID();
  if (!(await writeReply(row, token, `status = 'sending', reply_staging_id = $3::uuid`, [stagingId]))) return 'lost';
  row.status = 'sending'; row.reply_staging_id = stagingId;
  try {
    await query(`INSERT INTO campaign_send_staging (staging_id, company_id, phone) VALUES ($1::uuid, $2::uuid, $3)`, [stagingId, companyId, phone]);
    const res = await createDirectSendCampaign(
      {
        stagingId,
        campaignName: `상담 답장 · ${maskCustomerPhone(phone)}`,
        msgType: measured.reply.msgType, message: measured.reply.text, subject: measured.reply.subject, callback, sendChannel: 'sms',
        adEnabled: false, total: 1, dedupEnabled: true, unsubFilterEnabled: false,
      },
      { companyId, userId: s.updated_by || companyId, activationGuard: { sql: INBOUND_ACTIVATION_GUARD_SQL, params: [row.id, token, (clock().getTime() - Date.now()) / 1000] } },
    );
    return (await writeReply(row, token, `status = 'sent', reply_campaign_id = $3::uuid, claim_token = NULL`, [res.campaignId])) ? 'sent' : 'lost';
  } catch (e: any) {
    if (e instanceof DirectSendError && DEFINITE_NO_COMMIT.has(String(e.code))) {
      await dropStaging(stagingId);
      return failReply(row, token, e.code === 'INSUFFICIENT_BALANCE' ? '잔액이 부족해요.' : String(e.message || '발송이 접수되지 않았어요.'));
    }
    // 그 밖 = 접수됐는지 모른다 → 대조로 맞춘다(다시 보내지 않는다)
    console.error(`[inbound] 답장 접수 결과 불명 reply=${row.id} staging=${stagingId}:`, e?.message || e);
    const seen = await reconcileReply(row).catch(() => ({ seen: 'unknown' as const }));
    if (seen.seen === 'sent') return (await writeReply(row, token, `status = 'sent', reply_campaign_id = $3::uuid, claim_token = NULL`, [seen.campaignId])) ? 'sent' : 'lost';
    if (seen.seen === 'none') { await dropStaging(stagingId); return failReply(row, token, '발송이 접수되지 않았어요.'); }
    if (seen.seen === 'failed') return failReply(row, token, '발송이 접수되지 않았어요.');
    return 'unknown';   // sending 으로 남는다 → 임대가 지난 뒤 다음 실행이 대조부터
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. 사람 답장 · 닫기(회사 관리자)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 사람이 쓴 답장 — 화면이 만든 id 가 답장 행 id(두 번 눌러도 · 겹쳐 보내도 한 번).
 *   · 판정이 끝난 글에만 답한다(new = 아직 수신거부 요청인지도 보지 않았다 → 잠시 뒤). 수신거부한 고객 · 미배정 글에는 답하지 않는다.
 *   · 그 요청에서 설정의 답장 발신번호로 발신 인증을 지나고(gate) 그 번호를 답장 행에 고정한다. 그 뒤 같은 길(sendReply)로 보낸다.
 *   · 답장 행 넣기가 성공했을 때만 받은 글을 바꾼다(한 문장) — 같은 id 의 요청이 겹쳐도 뒤에 온 요청이 받은 글의 상태를 덮지 않는다.
 *   · 답장은 대화에 대한 답이다: 그 글과 그 앞의 「사람 필요」 글이 함께 answered 가 된다(답장이 안 나가면 그 글이 다시 사람 필요로 돌아온다).
 */
/** 대화 안의 차례 = (받은 시각, 저장 시각) — 조회(readThread)가 그리는 차례 · 답장과 닫기의 「그 글까지」 · 잠그는 차례가 같은 기준 */
const THREAD_ORDER = 'received_at, created_at';
/**
 * 가리킨 글(t = $1 · 회사 $2)까지의 대화 행(p)을 **대화의 차례대로** 잠근다 — 답장과 닫기가 같은 차례로 잠가서 서로 엇갈려 멈추지 않는다
 *   (가리킨 글부터 잠그면 「답장은 뒤 글을 쥐고 앞 글을 기다리고 · 닫기는 앞 글을 쥐고 뒤 글을 기다리는」 교착이 생긴다).
 *   which = 잠글 행의 조건. 겹친 쓰기가 끝난 뒤의 상태로 다시 가른다. target = 그 행이 가리킨 글인가.
 */
const lockThreadSql = (columns: string, which: string) => `
       SELECT ${columns}, (p.id = t.id) AS target
         FROM inbound_messages t JOIN inbound_messages p ON p.company_id = t.company_id AND p.from_phone = t.from_phone AND p.direction = 'in'
        WHERE t.id = $1::uuid AND t.company_id = $2::uuid AND t.direction = 'in'
          AND (p.received_at, p.created_at) <= (t.received_at, t.created_at) AND (${which})
        ORDER BY p.received_at, p.created_at
          FOR UPDATE OF p`;
export interface ReplyView { id: string; status: ReplyStatus; note: string | null }
export type HumanReplyResult = { done: true; outcome: SendOutcome; reply: ReplyView | null } | { done: false; rejection: unknown };

async function replyRowOf(companyId: string, replyId: string): Promise<{ view: ReplyView; replyTo: string } | null> {
  const r = await query(`SELECT id, status, note, reply_to FROM inbound_messages WHERE id = $1::uuid AND company_id = $2::uuid AND direction = 'out'`, [replyId, companyId]);
  const x = r.rows[0];
  return x ? { view: { id: String(x.id), status: x.status as ReplyStatus, note: x.note || null }, replyTo: String(x.reply_to) } : null;
}
/** 보내지 않기로 한 id 는 화면에 없는 것과 같다 */
const shownReply = (v: ReplyView | null | undefined): ReplyView | null => (v && v.status !== 'cancelled' ? v : null);

/** 화면이 그 답장의 끝을 묻는다 — 있으면 그 행(나갔거나 · 접수됐거나 · 안 나간 것으로 끝났다) · 없거나 보내지 않기로 한 id 면 null */
export async function readHumanReply(ctx: InboundCtx, rawReplyId: unknown): Promise<ReplyView | null> {
  return shownReply((await replyRowOf(ctx.companyId, uuidOf(rawReplyId)))?.view);
}

export async function humanReply(
  ctx: InboundCtx, rawMessageId: unknown, rawReplyId: unknown, rawText: unknown, gate: SenderGate, now: Date = new Date(),
): Promise<HumanReplyResult> {
  const messageId = uuidOf(rawMessageId);
  const replyId = uuidOf(rawReplyId);
  /** 이미 있는 id = 새로 만들지 않는다(남은 발송만 이어 한다 · 보내지 않기로 한 id 면 아무것도 보내지 않는다) */
  const resume = async (): Promise<HumanReplyResult | null> => {
    const other = await query(`SELECT company_id, reply_to, status FROM inbound_messages WHERE id = $1::uuid`, [replyId]);
    if (other.rows.length === 0) return null;
    if (String(other.rows[0].company_id) !== ctx.companyId || String(other.rows[0].reply_to) !== messageId) throw reject('INBOUND_ID', '요청 값이 올바르지 않아요.');
    // 보내지 않기로 닫은 id — 분명히 거절한다(화면의 [다시 확인]이 「모름」에 머물지 않게)
    if (other.rows[0].status === 'cancelled') throw reject('INBOUND_DISCARDED', '보내지 않기로 한 답장이에요. [보내지 않기]를 눌러 정리한 뒤 새로 보내 주세요.', 409);
    const outcome = await sendReply(replyId, () => now);
    return { done: true, outcome, reply: await readHumanReply(ctx, replyId) };
  };
  const had = await resume();
  if (had) return had;

  const text = String(rawText ?? '').trim();
  if ([...text].length > INBOUND_HUMAN_REPLY_MAX) throw reject('INBOUND_TEXT', `답장은 ${INBOUND_HUMAN_REPLY_MAX.toLocaleString()}자까지 적을 수 있어요.`);
  const m = await query(`SELECT * FROM inbound_messages WHERE id = $1::uuid AND company_id = $2::uuid AND direction = 'in'`, [messageId, ctx.companyId]);
  const msg = m.rows[0] as MsgRow | undefined;
  if (!msg || msg.status === 'unassigned') throw reject('INBOUND_NOT_FOUND', '문의를 찾을 수 없어요.', 404);
  if (msg.status === 'optout') throw reject('INBOUND_OPTOUT', '수신거부로 등록한 고객이에요. 답장을 보내지 않아요.', 409);
  // 판정 전(new)에는 답하지 않는다 — 수신거부 요청인지부터 워커가 본다(답장이 먼저 나가면 그 등록이 영영 빠진다)
  if (msg.status === 'new') throw reject('INBOUND_NOT_DECIDED', '방금 들어온 문의예요. 수신거부 요청인지 먼저 확인하고 있어요. 1분쯤 뒤에 다시 눌러 주세요.', 409);
  const s = await settingsRow(ctx.companyId);
  if (!s?.enabled) throw reject('INBOUND_OFF', '상담이 꺼져 있어요. 설정에서 켠 뒤에 보낼 수 있어요.', 409);
  if (!s.reply_callback) throw reject('INBOUND_CALLBACK', '답장 발신번호를 설정에서 골라 주세요.', 409);
  if (!replyablePhone(msg.from_phone)) throw reject('INBOUND_PHONE', '답장할 수 없는 번호예요.', 409);
  const built = buildInboundReply(text, s.reply_callback, msg.to_number);
  if (!built.ok) throw reject('INBOUND_TEXT', built.issue);
  const g = await gate(s.reply_callback);
  if (!g.ok) return { done: false, rejection: g.rejection };
  // 한 문장 = 그 글과 그 앞의 사람 필요 글을 차례대로 잠그고(k · 가리킨 글은 그 순간의 상태가 판정이 끝난 것일 때만 · 야간 대기를 되돌리는 워커와 한 줄로 선다)
  //   → 가리킨 글이 잠겼을 때만 답장 행을 넣고 → 넣었을 때만 잠근 글들을 바꾼다.
  //   잠금 없이 읽으면 「읽을 때는 waiting · 쓸 때는 워커가 new 로 되돌려 쥔 글」에 답장 행이 생겨 자동 답장과 둘이 나간다.
  const ins = await query(
    `WITH k AS (${lockThreadSql('p.id, p.company_id, p.from_phone, p.to_number', `(p.id = t.id AND p.status IN ('waiting', 'human', 'answered', 'done')) OR (p.id <> t.id AND p.status = 'human')`)}
     ), ins AS (
       INSERT INTO inbound_messages (id, provider_msg_id, direction, from_phone, to_number, body, company_id, status, handled_by, reply_to, reply_callback, received_at)
       SELECT $3::uuid, 'out:' || $3::text, 'out', k.from_phone, k.to_number, $4, k.company_id, 'ready', 'human', k.id, $5, $6
         FROM k WHERE k.target
       ON CONFLICT (id) DO NOTHING
       RETURNING reply_to
     ), upd AS (
       UPDATE inbound_messages p
          SET status = 'answered', handled_by = 'human', note = NULL, draft = NULL, updated_at = NOW()
         FROM k, ins
        WHERE p.id = k.id
     )
     SELECT COUNT(*)::int AS n FROM ins`,
    [messageId, ctx.companyId, replyId, built.reply.text, s.reply_callback, now]);
  if (Number(ins.rows[0]?.n) !== 1) {
    // 같은 id 의 다른 요청이 먼저 만들었다 → 그 행으로 이어 간다(받은 글은 건드리지 않았다) · 그것도 없으면 그 사이 글의 상태가 바뀐 것
    const again = await resume();
    if (again) return again;
    throw reject('INBOUND_STATE', '지금은 답장할 수 없는 문의예요. 화면을 다시 읽어 주세요.', 409);
  }
  const outcome = await sendReply(replyId, () => now);
  return { done: true, outcome, reply: await readHumanReply(ctx, replyId) };
}

/**
 * 화면이 보낸 답장 요청을 버린다 — 「안 나갔겠지」를 화면이 짐작하지 않고 서버가 정한다.
 *   그 id 의 답장 행이 이미 있으면 그것을 돌려준다(나갔거나 · 접수된 것). 없으면 그 id 로 「보내지 않은 답장」(cancelled) 행을 적어 닫는다
 *   = 응답이 끊겼던 요청이 뒤늦게 닿아도 같은 id 라 만들지 못한다(표의 기본 키가 막는다 · 프로세스 안 기억에 기대지 않는다).
 */
export async function discardHumanReply(ctx: InboundCtx, rawMessageId: unknown, rawReplyId: unknown): Promise<ReplyView | null> {
  const messageId = uuidOf(rawMessageId);
  const replyId = uuidOf(rawReplyId);
  await query(
    `INSERT INTO inbound_messages (id, provider_msg_id, direction, from_phone, to_number, body, company_id, status, handled_by, reply_to, received_at, note)
     SELECT $3::uuid, 'out:' || $3::text, 'out', m.from_phone, m.to_number, '', m.company_id, 'cancelled', 'human', m.id, NOW(), '보내지 않은 답장'
       FROM inbound_messages m
      WHERE m.id = $1::uuid AND m.company_id = $2::uuid AND m.direction = 'in'
     ON CONFLICT (id) DO NOTHING`,
    [messageId, ctx.companyId, replyId]);
  const row = await replyRowOf(ctx.companyId, replyId);
  if (!row) throw reject('INBOUND_NOT_FOUND', '문의를 찾을 수 없어요.', 404);
  if (row.replyTo !== messageId) throw reject('INBOUND_ID', '요청 값이 올바르지 않아요.');
  return shownReply(row.view);
}

/** 답 없이 닫기(전화로 답했을 때 등) — 대화 단위: 그 글과 그 앞의 「사람 필요」 글을 함께 닫는다(가리킨 글이 사람 필요일 때만) */
export async function closeInbound(ctx: InboundCtx, rawId: unknown): Promise<boolean> {
  const r = await query(
    `WITH k AS (${lockThreadSql('p.id', `p.status = 'human'`)}
     )
     UPDATE inbound_messages p SET status = 'done', handled_by = 'human', updated_at = NOW()
       FROM k
      WHERE p.id = k.id AND EXISTS (SELECT 1 FROM k WHERE target)`,
    [uuidOf(rawId), ctx.companyId]);
  return (r.rowCount || 0) >= 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. 상담함 조회(회사 관리자)
// ─────────────────────────────────────────────────────────────────────────────

export interface InboxStatus { enabled: boolean; numbers: string[]; human: number }
export async function inboxStatus(companyId: string): Promise<InboxStatus> {
  const [s, numbers, h] = await Promise.all([
    settingsRow(companyId), companyInboundNumbers(companyId),
    query(`SELECT COUNT(*)::int AS n FROM inbound_messages WHERE company_id = $1::uuid AND direction = 'in' AND status = 'human'`, [companyId]),
  ]);
  return { enabled: !!s?.enabled, numbers, human: Number(h.rows[0]?.n) || 0 };
}

export interface InboxCounts { waiting: number; aiToday: number; human: number; today: number }
export interface ThreadRow { key: string; phoneMasked: string; lastBody: string; lastAt: string; lastDirection: 'in' | 'out'; human: number; status: string }

/** 대화 목록 — 고객 번호마다 가장 최근 한 줄(열쇠 = 그 대화의 가장 최근 받은 글 id · 번호를 주소에 싣지 않는다) */
export async function listThreads(companyId: string, filter: 'human' | 'all', limit = 100): Promise<{ counts: InboxCounts; threads: ThreadRow[] }> {
  const day = `(date_trunc('day', NOW() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul')`;
  const counts = await query(
    `SELECT COUNT(*) FILTER (WHERE direction = 'in' AND status IN ('new', 'waiting'))::int AS waiting,
            COUNT(*) FILTER (WHERE direction = 'in' AND status = 'answered' AND handled_by = 'ai' AND received_at >= ${day})::int AS ai_today,
            COUNT(*) FILTER (WHERE direction = 'in' AND status = 'human')::int AS human,
            COUNT(*) FILTER (WHERE direction = 'in' AND received_at >= ${day})::int AS today
       FROM inbound_messages WHERE company_id = $1::uuid`,
    [companyId]);
  const r = await query(
    `SELECT t.* FROM (
       SELECT DISTINCT ON (m.from_phone) m.from_phone, m.body, m.direction, m.status, m.received_at,
              (SELECT i.id FROM inbound_messages i WHERE i.company_id = m.company_id AND i.from_phone = m.from_phone AND i.direction = 'in' ORDER BY i.received_at DESC, i.created_at DESC LIMIT 1) AS key,
              (SELECT COUNT(*) FROM inbound_messages h WHERE h.company_id = m.company_id AND h.from_phone = m.from_phone AND h.direction = 'in' AND h.status = 'human')::int AS human
         FROM inbound_messages m
        WHERE m.company_id = $1::uuid AND NOT (m.direction = 'out' AND m.status = 'cancelled')
        ORDER BY m.from_phone, m.received_at DESC, m.created_at DESC
     ) t
     WHERE t.key IS NOT NULL AND ($2::boolean = false OR t.human > 0)
     ORDER BY t.received_at DESC
     LIMIT $3::int`,
    [companyId, filter === 'human', Math.max(1, Math.min(200, Math.floor(limit) || 100))]);
  const c = counts.rows[0] || {};
  return {
    counts: { waiting: Number(c.waiting) || 0, aiToday: Number(c.ai_today) || 0, human: Number(c.human) || 0, today: Number(c.today) || 0 },
    threads: r.rows.map((x: any) => ({
      key: String(x.key), phoneMasked: maskCustomerPhone(String(x.from_phone)), lastBody: String(x.body).slice(0, 80),
      lastAt: new Date(x.received_at).toISOString(), lastDirection: x.direction === 'out' ? 'out' : 'in', human: Number(x.human) || 0, status: String(x.status),
    })),
  };
}

export interface ThreadMessage {
  id: string; direction: 'in' | 'out'; body: string; status: string; handledBy: string | null; note: string | null; draft: string | null; at: string;
}
/** more = 그 앞에 더 오래된 글이 있다(가장 최근 것만 싣는다) */
export interface ThreadView { key: string; phone: string; toNumber: string; canReply: boolean; more: boolean; messages: ThreadMessage[] }
export const INBOUND_THREAD_LIMIT = 300;

/** 대화 하나 — 열쇠(그 회사의 받은 글 id)로 고객 번호를 찾아 그 번호의 글 가운데 가장 최근 것(오래된 순으로 돌려준다) */
export async function readThread(companyId: string, rawKey: unknown): Promise<ThreadView | null> {
  const key = uuidOf(rawKey);
  const k = await query(`SELECT from_phone, to_number FROM inbound_messages WHERE id = $1::uuid AND company_id = $2::uuid AND direction = 'in'`, [key, companyId]);
  if (k.rows.length === 0) return null;
  const phone = String(k.rows[0].from_phone);
  const r = await query(
    `SELECT * FROM (
       SELECT id, direction, body, status, handled_by, note, draft, received_at, created_at
         FROM inbound_messages
        WHERE company_id = $1::uuid AND from_phone = $2 AND NOT (direction = 'out' AND status = 'cancelled')
        ORDER BY received_at DESC, created_at DESC
        LIMIT $3::int
     ) t
     ORDER BY ${THREAD_ORDER}`,
    [companyId, phone, INBOUND_THREAD_LIMIT + 1]);
  const more = r.rows.length > INBOUND_THREAD_LIMIT;
  return {
    key, phone, toNumber: String(k.rows[0].to_number), canReply: !!replyablePhone(phone), more,
    messages: (more ? r.rows.slice(1) : r.rows).map((x: any) => ({
      id: String(x.id), direction: x.direction === 'out' ? 'out' : 'in', body: String(x.body), status: String(x.status),
      handledBy: x.handled_by || null, note: x.note || null, draft: x.draft || null, at: new Date(x.received_at).toISOString(),
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. 워커가 부를 행 — 회사 하나의 글이 몰려도 다른 회사가 밀리지 않게(회사마다 5 · 모두 20)
// ─────────────────────────────────────────────────────────────────────────────

export const INBOUND_PER_COMPANY = 5;
export const INBOUND_PER_PASS = 20;

const dueSql = (where: string) => `
  SELECT id FROM (
    SELECT id, received_at, ROW_NUMBER() OVER (PARTITION BY company_id ORDER BY received_at, created_at) AS rn
      FROM inbound_messages
     WHERE ${where} AND company_id IS NOT NULL
       AND (claim_token IS NULL OR claimed_at < NOW() - make_interval(mins => ${INBOUND_LEASE_MINUTES}))
  ) t
  WHERE rn <= ${INBOUND_PER_COMPANY}
  ORDER BY received_at
  LIMIT ${INBOUND_PER_PASS}`;
export const INBOUND_DUE_DECIDE_SQL = dueSql(`direction = 'in' AND status = 'new'`);
export const INBOUND_DUE_SEND_SQL = dueSql(`direction = 'out' AND status IN ('ready', 'sending')`);

/**
 * 워커 한 바퀴 — ① 창이 열렸으면 야간 대기를 되돌린다 ② 받은 글 판정 ③ 답장 행 보내기.
 *   시각은 글마다 다시 읽는다(clock) — 한 바퀴가 길어져도(AI 판정 여러 건) 자동 답장 시간 판정이 바퀴를 시작한 시각으로 굳지 않는다.
 */
export async function runInboundPass(clock: () => Date = () => new Date(), deps: DecideDeps = {}): Promise<{ reopened: number; decided: number; sent: number }> {
  let reopened = 0;
  if (inboundAutoWindowOpen(clock())) {
    const r = await query(`UPDATE inbound_messages SET status = 'new', note = NULL, updated_at = NOW() WHERE direction = 'in' AND status = 'waiting'`);
    reopened = r.rowCount || 0;
  }
  let decided = 0;
  for (const x of (await query(INBOUND_DUE_DECIDE_SQL)).rows) {
    const out = await decideInbound(String(x.id), clock(), deps).catch((e: any) => { console.error(`[inbound] 판정 오류 msg=${x.id}:`, e?.message || e); return 'skip' as const; });
    if (out !== 'skip' && out !== 'later') decided += 1;
  }
  let sent = 0;
  for (const x of (await query(INBOUND_DUE_SEND_SQL)).rows) {
    const out = await sendReply(String(x.id), clock).catch((e: any) => { console.error(`[inbound] 보내기 오류 reply=${x.id}:`, e?.message || e); return 'skip' as const; });
    if (out === 'sent') sent += 1;
  }
  return { reopened, decided, sent };
}
