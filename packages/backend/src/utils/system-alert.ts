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

import { getAuthSmsTable, bulkInsertSmsQueue } from './sms-queue';
import { sanitizeSmsText } from './auto-notify-message';
import { query } from '../config/database';
import { isAlertOnCooldown } from './system-alert-cooldown';

const DEFAULT_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6시간

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
  const raw = String(process.env.SYSTEM_ALERT_PHONES || '').trim();
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
    const phones = getSystemAlertPhones();
    if (phones.length === 0) {
      log(`수신자 미설정(SYSTEM_ALERT_PHONES) — 발송 생략: ${params.dedupKey}`);
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

    await bulkInsertSmsQueue([authTable], rows, true);
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
