/**
 * system-alert.ts — 시스템 크리티컬 문자 알림 컨트롤타워 (2026-06-13)
 *
 * 배경 (Harold 지시 2026-06-13):
 *   슈퍼관리자 화면 표시는 보고 있을 때만 의미가 있다. 크리티컬 문제(발송 큐 지연 잔존,
 *   싱크에이전트 중단 등)는 운영자에게 문자로 직접 알린다. 메일 대신 자사 인증 라인 사용.
 *
 * 정책:
 *   - 수신자 = .env `SYSTEM_ALERT_PHONES` (쉼표 구분, 예: 01011112222,01033334444).
 *     미설정 시 발송하지 않고 로그만 남긴다 (기간계 안정성 우선 — throw 금지).
 *   - 발송 경로 = 검수 알림과 동일: getAuthSmsTable() 인증 라인 + bulkInsertSmsQueue LMS.
 *   - 같은 dedupKey는 쿨다운(기본 6시간) 안에 1회만 발송 — 주기 워커의 반복 발송 차단.
 *     (★ 2026-06-25: 쿨다운 상태를 PG system_alert_state에 영속화 — pm2 재시작에도 유지.
 *      DB 오류 시에만 프로세스 메모리 Map으로 폴백. 이전엔 메모리만이라 재시작마다 재알림 = 종일 스팸.)
 *   - 본문은 EUC-KR 안전 문자만 — sanitizeSmsText 통과 (auto-notify-message CT 재사용).
 *   - 운영자 대상 장애 통지라 야간에도 발송한다 (광고 아님).
 *
 * ⚠️ 절대 금지:
 *   - 워커/라우트에서 운영자 알림 문자를 인라인으로 직접 INSERT 금지 — 반드시 이 CT 경유.
 */

import { execFile } from 'child_process';
import fs from 'fs';
import { getAuthSmsTable, bulkInsertSmsQueue } from './sms-queue';
import { sanitizeSmsText } from './auto-notify-message';
import { query } from '../config/database';
import { isAlertOnCooldown } from './system-alert-cooldown';
import { isInternalCompany } from './internal-company';

const DEFAULT_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6시간

/** 공용 운영 경보 입구(scripts/ops-alert.sh 를 서버에 설치한 경로 · 문자 = ALERT_CMD · 메일 = 하이웍스) */
const OPS_ALERT_BIN = process.env.OPS_ALERT_BIN || '/usr/local/bin/ops-alert';

export function opsAlertInstalled(): boolean {
  try { return fs.existsSync(OPS_ALERT_BIN); } catch { return false; }
}

/** 공용 입구로 보낸다 — 두 길 중 하나라도 나가면 true(입구가 exit 0) · 비밀값은 입구가 자기 설정 파일에서 읽는다(인자 = 제목 · 본문만) */
function sendViaOpsAlert(subject: string, body: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(OPS_ALERT_BIN, [subject, body], { timeout: 90_000 }, (err) => {
      if (err) console.error('[system-alert] 공용 입구 실패:', err.message);
      resolve(!err);
    });
  });
}

// dedupKey → 쿨다운 만료 시각
const cooldownMap = new Map<string, number>();

function log(...args: any[]) {
  console.log('[system-alert]', ...args);
}

// ★ 2026-06-25: 쿨다운 상태 PG 영속화 — pm2 재시작에도 12시간 쿨다운(하루 2번) 유지.
//   DB 오류(테이블 미생성 등) 시 dbOk=false로 알려 호출부가 메모리 Map으로 폴백한다.
async function readLastSentAt(dedupKey: string): Promise<{ lastSentAtMs: number | null; dbOk: boolean }> {
  try {
    const r = await query('SELECT last_sent_at FROM system_alert_state WHERE dedup_key = $1', [dedupKey]);
    if (r.rows.length === 0) return { lastSentAtMs: null, dbOk: true };
    return { lastSentAtMs: new Date(r.rows[0].last_sent_at).getTime(), dbOk: true };
  } catch (err: any) {
    console.error('[system-alert] 쿨다운 조회 실패(메모리 폴백):', err?.message || err);
    return { lastSentAtMs: null, dbOk: false };
  }
}

async function markSentNow(dedupKey: string): Promise<void> {
  try {
    await query(
      `INSERT INTO system_alert_state (dedup_key, last_sent_at) VALUES ($1, now())
       ON CONFLICT (dedup_key) DO UPDATE SET last_sent_at = now()`,
      [dedupKey],
    );
  } catch (err: any) {
    console.error('[system-alert] 쿨다운 기록 실패:', err?.message || err);
  }
}

/** .env SYSTEM_ALERT_PHONES 파싱 — 유효한 휴대폰 번호만 반환 */
export function getSystemAlertPhones(): string[] {
  return parseAlertPhones(process.env.SYSTEM_ALERT_PHONES);
}

/** 쉼표로 적은 번호 목록 파싱 — 유효한 휴대폰 번호만(중복 제거) */
export function parseAlertPhones(rawValue: string | null | undefined): string[] {
  const raw = String(rawValue || '').trim();
  if (!raw) return [];
  const phones: string[] = [];
  for (const part of raw.split(',')) {
    const clean = part.replace(/\D/g, '');
    if (/^01\d{8,9}$/.test(clean) && !phones.includes(clean)) phones.push(clean);
  }
  return phones;
}

export interface SystemAlertParams {
  /** 중복 발송 차단 키 (예: 'queue-delay:<campaignId>', 'agent-down:<agentId>') */
  dedupKey: string;
  /**
   * ★ 2026-10-28 B-1028-3 — 이 경보가 어느 회사의 일인가(필수 · 회사와 무관한 경보 = null).
   *   사내 회사(시연 · 사내 시험 · `isInternalCompany`)의 일이면 보내지 않고 로그만 남긴다. 보안 감시 경보는 늘 null(거르지 않는다).
   *   필수 칸이라 새 경보마다 회사 여부를 정해야 컴파일된다(호출부 판정이 빠지지 않게).
   */
  companyId: string | null;
  /** 본문 — 짧은 사실 요약. CT가 머리말/맺음말을 붙인다. `title`을 쓰면 생략한다. */
  message?: string;
  /**
   * ★2026-08-28 구조화 입력 — **새 알림은 이쪽을 쓴다**(Harold 지적).
   *
   * 옛 알림들은 한 줄에 사실·식별자·요청을 다 이어 붙여 사람이 읽기 어려웠다
   * (「대행발송 예약을 되돌리지 못했다 request=… campaign=… 사유=… 큐 잔존 여부 확인 필요」).
   * 문자는 폭이 좁아 **한 줄에 하나씩** 놓아야 눈에 들어온다.
   *
   * `title`   = 무슨 일이 일어났는가. **존댓말 완결문**으로 쓴다(명사형 종결 금지).
   * `details` = 「이름: 값」 한 줄에 하나. 사람이 판단에 쓰는 값만.
   * `action`  = 무엇을 하면 되는가.
   */
  title?: string;
  details?: string[];
  action?: string;
  /** 쿨다운(ms). 기본 6시간. */
  cooldownMs?: number;
  /**
   * ★ 2026-10-07 받는 사람을 따로 정한다(감시 알림 = 대표 번호만 · WATCH_ALERT_PHONES).
   *   주면 SYSTEM_ALERT_PHONES 대신 이 번호로만 보낸다 · 비면 보내지 않는다(다른 운영자에게 새지 않게).
   */
  phones?: string[];
}

/**
 * 내부 식별자를 문자에서 걷어낸다.
 *
 * ⛔ UUID를 받아도 사람이 할 수 있는 일이 없다. 찾는 자리는 슈퍼관리자 화면이고,
 *   문자는 **무슨 일이 있었고 무엇을 보면 되는지**만 전하면 된다.
 *   0828 실물 = 36자 UUID 두 개가 LMS 본문의 절반을 차지하고 있었다.
 */
export function stripInternalIds(text: string): string {
  if (!text) return '';
  return text
    // `request=<uuid>` 처럼 키까지 붙은 형태를 통째로
    .replace(/\b[A-Za-z_]+\s*=\s*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '')
    // 맨 UUID
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '')
    // 걷어낸 자리에 남은 군더더기 공백
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

/**
 * ★ 2026-11-01 주기 패스 경보 = 한 주기 1통(설계서 docs/2026-11-01-credit-control-tower-design.md §16-6 · 1101 월 마감 실패가 회사마다 1통 = 100통 넘게).
 *   주기 작업(워커 · 패스)은 항목마다 sendSystemAlert 를 부르지 않는다 — 실패를 모아 이 함수 하나에 넘긴다(항목별 사실 = 로그).
 *   원인 하나가 N곳을 동시에 막아도 문자는 1통이다 · 사내 회사 실패는 빼고 센다(전부 사내면 로그만).
 * ★ 2026-11-02 Codex 구현 1R-2 — 쿨다운이 한 번뿐인 확정 실패를 삼키지 않게(옛: 키 = 이름 + 날짜 · 6시간 · 그 안에 생긴 다른 실패는 버려졌다):
 *   · 이름(pass)마다 알린 항목(key)을 기억하고, 아직 안 알린 항목이 있을 때만 보낸다(같은 항목이 이어지면 6시간 뒤 다시 = 되새김).
 *   · 한 이름당 1시간에 한 통까지(키 = pass:이름 · 쿨다운은 PG 영속 · 재기동에도 유지).
 *   · 보낼 항목은 보내기 전에 고정하고 그것만 끝낸다 · 같은 이름은 한 번에 한 통(보내는 동안 들어온 항목은 남는다 · Codex 구현 2R-1).
 * ★ 2026-11-02 설계 §17(대장 R14 넓힘 · 다른 기능의 한 번뿐인 사건 경보도 이 길):
 *   · 사건 모드 = total 없음 → 첫 줄 「새 N건」 · 글 숫자 그대로(주기 모드 = 「새 실패 N곳 …」 · 숫자를 N 으로 묶음).
 *   · 못 보낸 항목 = PG 원장 system_alert_pending(재기동에도 남는다 · 옛: 프로세스 메모리라 쿨다운 안에 재기동하면 사라졌다 · 설계 1R-1).
 *   · 사건을 닫는 자리는 persistPassFailures 가 참일 때만 · 기록한 항목만 닫는다(닫기 계약 · 설계 2R · 거짓 = 닫지 않음 = 다음 주기 같은 키).
 *   · 원장에 못 쓰면 메모리 대기(닫기 없는 경보만 = alertPassFailures · queuePassFailures) · 보낼 때마다 원장으로 옮겨 본다.
 *   · 다시 보내기 = 늘 도는 10분 타이머(원장에 줄이 있는 이름 + 메모리 대기 이름) · 부팅 때 켜고 바로 한 번(startPassAlertFlusher).
 *   ponytail: 알린 항목(6시간) · 마지막 주기 수는 프로세스 메모리 — 재기동하면 같은 항목을 한 번 더 알릴 수 있다(중복 · 사라짐 아님).
 */
export interface PassFailure {
  companyId: string | null;
  error: string;
  /** 항목 이름(같은 항목 = 한 번 알림 · 6시간 뒤 다시) — 없으면 회사 · 회사도 없으면 오류 글 */
  key?: string;
}
/** total 없음 = 사건 모드(한 번뿐인 사건) · 있음 = 주기 모드(그 주기 대상 수) */
export interface PassAlertSpec { pass: string; title: string; failures: PassFailure[]; total?: number; action: string; now?: Date }
type AlertSend = (p: SystemAlertParams) => Promise<number>;
interface PassState {
  title: string | null;
  action: string | null;
  /** 대상 수 · null = 사건 모드 · undefined = 이 프로세스에서 부름 없음(재기동 뒤 = 원장 줄 값) */
  total: number | null | undefined;
  /** 마지막 부름의 실패 수(사내 제외) · null = 모름 */
  current: number | null;
  /** 알린 항목 → 알린 시각 */
  told: Map<string, number>;
  /** 원장에 못 쓴 항목(DB 장애 · 표 없음) */
  pending: Map<string, PassFailure>;
  /** 상한을 넘어 싣지 못한 항목 수(다음 통에 「생략 N곳」 · 항목 = 로그) */
  dropped: number;
  /** 보내는 중(같은 이름 한 번에 한 통) */
  sending: boolean;
  send: AlertSend;
}
interface PendingRow { item_key: string; company_id: string | null; error: string; title: string; action: string; total: number | null }
const PASS_GAP_MS = 60 * 60 * 1000;
const PASS_REMIND_MS = 6 * 60 * 60 * 1000;
const PASS_FLUSH_MS = 10 * 60 * 1000;
const PASS_PENDING_CAP = 500;
/** 한 통에 원장에서 읽는 줄 수(넘으면 「남은 항목은 다음 통」) */
const PASS_READ_MAX = 1000;
const passStates = new Map<string, PassState>();
let passFlushTimer: ReturnType<typeof setInterval> | null = null;

function stateOf(pass: string): PassState {
  let st = passStates.get(pass);
  if (!st) {
    st = { title: null, action: null, total: undefined, current: null, told: new Map(), pending: new Map(), dropped: 0, sending: false, send: sendSystemAlert };
    passStates.set(pass, st);
  }
  return st;
}

/** 원장 칸 글 = NUL 제거 · 길이 상한(독 항목 하나가 닫기를 영영 막지 않게 · 설계 §17-3) */
const cell = (v: unknown, max: number): string => String(v ?? '').replace(/\u0000/g, '').slice(0, max);

/** 이번 부름의 새 항목 = 사내 회사 · 6시간 안에 알린 항목을 뺀 것(원장 · 메모리 대기 넣기가 같은 판정) */
async function freshItems(st: PassState, o: PassAlertSpec, nowMs: number): Promise<Array<[string, PassFailure]>> {
  st.title = o.title;
  st.action = o.action;
  st.total = o.total ?? null;
  const out: Array<[string, PassFailure]> = [];
  let current = 0;
  for (const f of o.failures) {
    if (f.companyId && await isInternalCompany(f.companyId).catch(() => false)) continue;
    current += 1;
    const k = cell(f.key ?? f.companyId ?? f.error, 300);
    const toldAt = st.told.get(k);
    if (toldAt !== undefined && nowMs - toldAt < PASS_REMIND_MS) continue;   // 6시간 안에 알린 항목
    out.push([k, f]);
  }
  st.current = current;
  if (o.failures.length > 0 && current === 0) log(`사내 회사 실패만 — ${o.pass} 경보 생략(${o.failures.length}곳)`);
  return out;
}

/** 원장 넣기(같은 항목 = 한 줄 · 처음 들어온 글 그대로) — 실패는 던진다 */
async function insertPending(pass: string, st: PassState, items: Array<[string, PassFailure]>): Promise<void> {
  await query(
    `INSERT INTO system_alert_pending (pass, item_key, company_id, error, title, action, total)
       SELECT $1, k, c, e, $5, $6, $7::int FROM unnest($2::text[], $3::text[], $4::text[]) AS u(k, c, e)
     ON CONFLICT (pass, item_key) DO NOTHING`,
    [pass, items.map(([k]) => k), items.map(([, f]) => f.companyId), items.map(([, f]) => cell(f.error, 500)), cell(st.title, 300), cell(st.action, 500), st.total ?? null],
  );
}

/** 원장 넣기 실패 = 로그 · 표가 없으면(배포 앞 DDL 빠짐) 이어지는 상태 경보(닫는 자리는 그동안 닫지 않는다) */
function noteLedgerError(pass: string, n: number, err: any): void {
  log(`경보 원장 넣기 실패 — ${pass} ${n}건: ${err?.message || err}`);
  if (err?.code !== '42P01') return;
  void sendSystemAlert({
    companyId: null,
    dedupKey: 'system-alert-pending-ddl',
    title: '경보 원장 표가 없어 한 번뿐인 사건을 닫지 못하고 있습니다.',
    details: ['표: system_alert_pending'],
    action: '배포 원장의 경보 원장 DDL 을 실행해 주세요(그동안 그 사건은 닫지 않고 남겨 둡니다).',
  }).catch(() => undefined);
}

async function persistItems(pass: string, st: PassState, items: Array<[string, PassFailure]>): Promise<boolean> {
  if (items.length === 0) return true;
  try {
    await insertPending(pass, st, items);
  } catch (err: any) {
    noteLedgerError(pass, items.length, err);
    return false;
  }
  // 사건 모드 = 새 항목마다 로그 한 줄(문자에는 글 셋까지만 실린다 · 나머지는 여기서 찾는다)
  if (st.total === null) for (const [k, f] of items) log(`새 항목 — ${pass} ${k}: ${cell(f.error, 120)}`);
  ensurePassFlusher();
  return true;
}

/**
 * 원장에만 쓴다 — 참 = 이번 부름의 새 항목이 전부 원장에 있다(새 항목 0 이면 참).
 * 사건을 닫는 자리(반려 · 실패로 닫음 · 경로 비움)는 참일 때만, 기록한 항목만 닫고 그 뒤 flushPassAlerts 를 부른다(설계 §17-3 닫기 계약).
 */
export async function persistPassFailures(o: PassAlertSpec): Promise<boolean> {
  const st = stateOf(o.pass);
  return persistItems(o.pass, st, await freshItems(st, o, (o.now ?? new Date()).getTime()));
}

/** 원장에 넣는다 · 못 쓰면 메모리 대기 — 닫기가 없는 경보(요청 경로가 응답 전에 기다리고 보내기만 따로) */
export async function queuePassFailures(o: PassAlertSpec): Promise<void> {
  const st = stateOf(o.pass);
  const items = await freshItems(st, o, (o.now ?? new Date()).getTime());
  if (await persistItems(o.pass, st, items)) return;
  for (const [k, f] of items) {
    if (!st.pending.has(k) && st.pending.size >= PASS_PENDING_CAP) {
      st.dropped += 1;
      log(`남은 항목 상한(${PASS_PENDING_CAP}) — ${o.pass} 항목 생략(다음 통에 수로): ${k}`);
      continue;
    }
    st.pending.set(k, f);
  }
  ensurePassFlusher();
}

/** 모아 보내기 = 넣기(원장 · 못 쓰면 메모리) + 그 이름 보내기 */
export async function alertPassFailures(o: PassAlertSpec, send: AlertSend = sendSystemAlert): Promise<number> {
  stateOf(o.pass).send = send;
  await queuePassFailures(o);
  return flushPassAlert(o.pass, stateOf(o.pass), (o.now ?? new Date()).getTime());
}

/** 그 이름의 남은 항목을 지금 보내 본다(닫는 자리가 기록 · 닫기 뒤에 부른다 · 기다리지 않아도 된다) */
export async function flushPassAlerts(pass: string, now: Date = new Date()): Promise<number> {
  return flushPassAlert(pass, stateOf(pass), now.getTime());
}

/** 그 이름의 남은 항목을 한 통으로(원장 줄 + 메모리 대기 · 보낸 것만 지운다 · 못 보냈거나 보내는 동안 들어온 항목은 남아 10분 뒤 다시) */
async function flushPassAlert(pass: string, st: PassState, nowMs: number): Promise<number> {
  for (const [k, at] of st.told) if (nowMs - at >= PASS_REMIND_MS) st.told.delete(k);
  if (st.sending) return 0;   // 같은 이름 한 통씩 — 보내는 동안 들어온 항목은 남아 다음에(Codex 구현 2R-1)
  st.sending = true;
  try {
    // 메모리 대기 = 원장으로 옮겨 본다(DB 가 돌아왔으면 · 쿨다운 판정 전 · 설계 2R-1)
    if (st.pending.size > 0) {
      const moving = [...st.pending];
      try {
        await insertPending(pass, st, moving);
        for (const [k] of moving) st.pending.delete(k);
      } catch { /* 메모리 그대로 */ }
    }
    let rows: PendingRow[] = [];
    let more = false;
    try {
      const r = await query(
        `SELECT item_key, company_id, error, title, action, total FROM system_alert_pending
          WHERE pass = $1 ORDER BY created_at, item_key LIMIT ${PASS_READ_MAX + 1}`,
        [pass],
      );
      more = r.rows.length > PASS_READ_MAX;
      rows = (r.rows as PendingRow[]).slice(0, PASS_READ_MAX);
    } catch (err: any) {
      log(`경보 원장 읽기 실패 — ${pass}: ${err?.message || err}`);
    }
    const mem = new Map(st.pending);   // 보낼 항목 고정
    const dropped = st.dropped;
    if (rows.length === 0 && mem.size === 0 && dropped === 0) return 0;
    const last = rows[rows.length - 1];
    const total = st.total !== undefined ? st.total : (last ? last.total : null);
    const event = total === null;
    const items: PassFailure[] = [...rows.map((r) => ({ companyId: r.company_id, error: r.error })), ...mem.values()];
    // 줄 = 주기 모드 「오류 N곳: 글」(숫자 = N · 같은 원인은 한 줄) · 사건 모드 = 글 그대로(같은 글이 여럿이면 「(N건)」)
    const kinds = new Map<string, number>();
    for (const f of items) {
      const t = stripInternalIds(String(f.error || '알 수 없음'));
      const k = (event ? t : t.replace(/\d+/g, 'N')).slice(0, 60);
      kinds.set(k, (kinds.get(k) || 0) + 1);
    }
    const top = [...kinds.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3)
      .map(([k, n]) => (event ? (n > 1 ? `${k} (${n}건)` : k) : `오류 ${n}곳: ${k}`));
    const head = event ? `새 ${items.length}건`
      : st.current !== null && st.total !== undefined ? `새 실패 ${items.length}곳 · 마지막 주기 실패 ${st.current}곳 / 대상 ${total}곳`
        : `새 실패 ${items.length}곳 / 대상 ${total}곳`;
    let sent = 0;
    try {
      sent = await st.send({
        companyId: null,
        dedupKey: `pass:${pass}`,
        cooldownMs: PASS_GAP_MS,
        title: st.title ?? last?.title ?? pass,
        details: [head, ...(more ? ['남은 항목은 다음 통에 싣습니다'] : []), ...(dropped > 0 ? [`상한을 넘어 생략 ${dropped}${event ? '건' : '곳'}(서버 로그)`] : []), ...top],
        action: st.action ?? last?.action ?? '서버 로그를 확인해 주세요.',
      });
    } catch (err: any) {
      log(`패스 경보 오류 — ${pass}: ${err?.message || err}`);
    }
    if (sent > 0) {
      if (rows.length > 0) {
        await query(`DELETE FROM system_alert_pending WHERE pass = $1 AND item_key = ANY($2::text[])`, [pass, rows.map((r) => r.item_key)])
          .catch((err: any) => log(`경보 원장 지우기 실패(다음 통에 다시 실림) — ${pass}: ${err?.message || err}`));
      }
      for (const r of rows) st.told.set(r.item_key, nowMs);
      for (const k of mem.keys()) { st.pending.delete(k); st.told.set(k, nowMs); }
      st.dropped -= dropped;
    }
    return sent;
  } finally {
    st.sending = false;
  }
}

/** 남은 항목을 이름마다 다시 보내 본다(10분 타이머 · 부팅 · 시험이 직접 부른다) — 원장에 줄이 있는 이름 + 메모리 대기 이름 */
export async function flushPendingPassAlerts(now: Date = new Date()): Promise<void> {
  let names: string[] = [];
  try {
    names = (await query(`SELECT DISTINCT pass FROM system_alert_pending`)).rows.map((r: any) => String(r.pass));
  } catch (err: any) {
    log(`경보 원장 이름 목록 실패: ${err?.message || err}`);
  }
  for (const [p, st] of passStates) if ((st.pending.size > 0 || st.dropped > 0) && !names.includes(p)) names.push(p);
  for (const p of names) await flushPassAlert(p, stateOf(p), now.getTime());
}

/** 늘 도는 다시 보내기 타이머(끄지 않는다 · unref) */
function ensurePassFlusher(): void {
  if (passFlushTimer) return;
  passFlushTimer = setInterval(() => {
    flushPendingPassAlerts().catch((err: any) => log(`남은 패스 경보 다시 보내기 오류: ${err?.message || err}`));
  }, PASS_FLUSH_MS);
  passFlushTimer.unref?.();
}

/** 부팅 = 타이머를 켜고 원장에 남은 항목(재기동 전에 못 보낸 사건)을 바로 한 번 보낸다(설계 §17-3) */
export function startPassAlertFlusher(): void {
  ensurePassFlusher();
  void flushPendingPassAlerts().catch((err: any) => log(`부팅 경보 원장 보내기 오류: ${err?.message || err}`));
}

/** 알림 본문 조립 — 구조화 입력이면 줄로 나누고, 옛 `message`는 그대로 쓴다 */
export function buildSystemAlertBody(p: SystemAlertParams): string {
  if (p.title) {
    const lines: string[] = [p.title];
    if (p.details && p.details.length > 0) lines.push('', ...p.details);
    if (p.action) lines.push('', p.action);
    return lines.join('\n');
  }
  return p.message || '';
}

/**
 * 시스템 크리티컬 알림 LMS 발송.
 * @returns 실제 발송한 수신자 수 (0 = 미설정/쿨다운/수신자 없음)
 */
export async function sendSystemAlert(params: SystemAlertParams): Promise<number> {
  try {
    // ★ 2026-10-28 B-1028-3 — 사내 회사의 일 = 운영 경보 문자 0 · 거른 사실은 로그(꺼짐도 기록)
    if (params.companyId && await isInternalCompany(params.companyId)) {
      log(`사내 회사 경보 생략 — ${params.dedupKey}: ${buildSystemAlertBody(params).slice(0, 80)}`);
      return 0;
    }
    const phones = params.phones ? parseAlertPhones(params.phones.join(',')) : getSystemAlertPhones();
    // ★ 2026-10-25 운영 경보 두 길(뿌리 대장 R14 · 원장 Z8) — 받는 사람을 따로 정하지 않은 경보는 공용 입구(문자 + 메일)를 먼저 탄다.
    //   옛: 인증 문자 한 길뿐이라 경보 대상(발송 장애 · MySQL)이 바로 그 길을 끊으면 한 통도 안 닿았다.
    const viaOps = !params.phones && opsAlertInstalled();
    if (phones.length === 0 && !viaOps) {
      log(`수신자 미설정(${params.phones ? '지정 번호' : 'SYSTEM_ALERT_PHONES'}) — 발송 생략: ${params.dedupKey}`);
      return 0;
    }

    const now = Date.now();
    const cooldownMs = params.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    // 쿨다운 판단 — PG 영속 우선, DB 오류 시 메모리 Map 폴백 (pm2 재시작에도 쿨다운 유지)
    const { lastSentAtMs, dbOk } = await readLastSentAt(params.dedupKey);
    if (dbOk) {
      if (isAlertOnCooldown(lastSentAtMs, cooldownMs, now)) return 0;
    } else {
      const expires = cooldownMap.get(params.dedupKey);
      if (expires && expires > now) return 0; // 쿨다운 중 — 조용히 생략
    }

    // ★2026-08-28 구조화 조립 + 내부 식별자 제거를 여기 한 자리에서 한다.
    //   옛 `message` 호출부도 그대로 이 길을 지나므로 UUID가 실리던 알림이 함께 정리된다.
    const body = [
      '[한줄로 시스템 알림]',
      '',
      stripInternalIds(sanitizeSmsText(buildSystemAlertBody(params))),
      '',
      '슈퍼관리자에서 확인해주세요.',
    ].join('\n');

    if (viaOps) {
      const subject = `[한줄로 시스템 알림] ${(params.title || buildSystemAlertBody(params).split('\n')[0] || params.dedupKey).slice(0, 60)}`;
      if (await sendViaOpsAlert(subject, body)) {
        await markSentNow(params.dedupKey);
        cooldownMap.set(params.dedupKey, now + cooldownMs);
        log(`공용 입구 발송 — ${params.dedupKey}: ${buildSystemAlertBody(params).slice(0, 80)}`);
        return 1;
      }
      console.log(`[system-alert] 공용 입구 두 길 모두 실패 · 인증 문자로 다시 보냄: ${params.dedupKey}`);
      if (phones.length === 0) return 0;
    }

    const authTable = await getAuthSmsTable();
    const callback = phones[0]; // 운영자 본인 번호 — 회신 안전
    const rows: any[][] = phones.map((p) => [
      p,                        // dest_no
      callback,                 // call_back
      body,                     // msg_contents
      'L',                      // msg_type (LMS)
      '[한줄로 시스템 알림]',   // title_str
      null,                     // sendreq_time (useNow=true)
      '',                       // app_etc1
      'system-alert',           // app_etc2
      '', '', '',               // file_name1~3
    ]);

    // ★ 2026-09-28 한줄로 V2 m132 — 적재 함수는 MySQL 오류를 던지지 않고 적재 건수를 돌려준다. 0건인데 쿨다운을 찍으면
    //   장애 중 경보(돈 불변식 포함)가 한 통도 안 나간 채 쿨다운 동안 억제됐다 → 적재가 된 때만 보냄으로 기록한다.
    const loaded = await bulkInsertSmsQueue([authTable], rows, true);
    if (loaded === 0) {
      console.error(`[system-alert] 적재 0건, 쿨다운을 찍지 않는다(다음 호출에 다시 시도): ${params.dedupKey}`);
      return 0;
    }
    await markSentNow(params.dedupKey);                 // PG 영속 (재시작에도 유지)
    cooldownMap.set(params.dedupKey, now + cooldownMs); // 메모리 보조 (DB 폴백 시 사용)
    log(`발송 ${rows.length}명 — ${params.dedupKey}: ${buildSystemAlertBody(params).slice(0, 80)}`);
    return rows.length;
  } catch (err: any) {
    // 알림 실패가 호출 워커/라우트를 죽이면 안 된다
    console.error('[system-alert] 발송 오류:', err?.message || err);
    return 0;
  }
}
