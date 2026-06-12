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
 *     (쿨다운은 프로세스 메모리 기준 — pm2 재시작 시 초기화되어 재알림될 수 있다. 의도된 동작.)
 *   - 본문은 EUC-KR 안전 문자만 — sanitizeSmsText 통과 (auto-notify-message CT 재사용).
 *   - 운영자 대상 장애 통지라 야간에도 발송한다 (광고 아님).
 *
 * ⚠️ 절대 금지:
 *   - 워커/라우트에서 운영자 알림 문자를 인라인으로 직접 INSERT 금지 — 반드시 이 CT 경유.
 */

import { getAuthSmsTable, bulkInsertSmsQueue } from './sms-queue';
import { sanitizeSmsText } from './auto-notify-message';

const DEFAULT_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6시간

// dedupKey → 쿨다운 만료 시각
const cooldownMap = new Map<string, number>();

function log(...args: any[]) {
  console.log('[system-alert]', ...args);
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
  /** 본문 — 짧은 사실 요약. CT가 머리말/맺음말을 붙인다. */
  message: string;
  /** 쿨다운(ms). 기본 6시간. */
  cooldownMs?: number;
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
    const expires = cooldownMap.get(params.dedupKey);
    if (expires && expires > now) {
      return 0; // 쿨다운 중 — 조용히 생략
    }

    const body = [
      '[한줄로 시스템 알림]',
      '',
      sanitizeSmsText(params.message),
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
    cooldownMap.set(params.dedupKey, now + (params.cooldownMs ?? DEFAULT_COOLDOWN_MS));
    log(`발송 ${rows.length}명 — ${params.dedupKey}: ${params.message.slice(0, 80)}`);
    return rows.length;
  } catch (err: any) {
    // 알림 실패가 호출 워커/라우트를 죽이면 안 된다
    console.error('[system-alert] 발송 오류:', err?.message || err);
    return 0;
  }
}
