/**
 * spam-diag-gate.ts — 스팸 검사 확인 판의 발송 관문 CT (★2026-11-24 · 설계서 docs/2026-11-23-spam-block-cause-hint-design.md §6-2-1)
 *
 * 확인 판 = 막힌 검사에서 의심 부분을 뺀 글을 막힌 통신사 단말에만 보내 보는 검사(출처 spam_diag · 고객 무료).
 * 고객 발신번호로 나가는 발송이라, 확인 판 문자를 실제로 적재하는 두 함수(검사 문자 = spam-test-queue executeSpamTest 의
 * sendDiagTestRow · 확인 문자 = spam-probe sendProbe 의 sendDiagProbe) 안에서 이 판정을 지난다.
 *   순서(두 함수 안) = BEGIN → 부모 진단 잠금(DIAG_LOCK_SQL · diagLockKey) → 그 행 FOR UPDATE → 저장점 → 권한(같은 연결) · 판정
 *     → 통과면 「보내기로 정함」을 행에 적고 커밋(잠금 풀림) → **MySQL 적재는 잠금 밖**(★Codex 구현 2R 구조 — 잠금을 쥔 채 바깥 시스템을 기다리지 않는다).
 *   진단 닫기(closeDiagnosis · 배포 2)도 같은 잠금을 잡으므로 「닫힌 뒤 새로 판정을 통과하는 적재」는 생기지 않는다(이미 통과로 적힌 한 통은 나갈 수 있다).
 * 판정 셋 = not_mine(이미 내 것 아님 · 아무것도 안 씀) · pass(적재) · reject(열린 값만 닫기).
 *
 * ⛔ 이 파일은 spam-test-queue · spam-probe 를 import 하지 않는다(둘이 이 파일을 import 한다 · 순환 0).
 */
import { getRegisteredCallbackSet } from './callback-filter';
import { normalizePhone } from './normalize-phone';
import { SPAM_DIAG_SOURCE } from './spam-trial';

/** 운영 스위치 — 프로세스 ENV(켜고 끄기 = 백엔드 재시작) · 정확히 'on' 일 때만 켜짐 · 기본 꺼짐 */
export const SPAM_DIAG_SWITCH_ENV = 'SPAM_DIAG_SENDS';
/** 검사 문자 = 판을 만든 지 이 분 안에만 적재(대기열에서 늦게 집힌 판은 보내지 않는다) */
export const DIAG_TEST_SEND_MINUTES = 15;
/** 확인 문자 = 판을 만든 지 이 분 안에만 적재 */
export const DIAG_PROBE_SEND_MINUTES = 30;
/** 부모 진단 잠금 — 트랜잭션 잠금(커밋 · 되돌림에 풀린다) */
export const DIAG_LOCK_SQL = 'SELECT pg_advisory_xact_lock(hashtext($1))';
/** ★ 2026-11-24 확인 판 등록 고정 키(설계서 §6-3 · 등록 전부가 이 키로 줄 서서 하루 상한을 센다 · 같은 DIAG_LOCK_SQL) */
export const DIAG_CAP_LOCK_KEY = 'spam_diag_cap';

export type DiagGate = 'not_mine' | 'pass' | 'reject';

export function diagSendsOn(env: Record<string, string | undefined> = process.env): boolean {
  return env[SPAM_DIAG_SWITCH_ENV] === 'on';
}

/** 확인 판 검사인가(출처 하나로) */
export function isDiagTest(source: unknown): boolean {
  return source === SPAM_DIAG_SOURCE;
}

/** 부모 진단 잠금 키 — 닫기와 두 적재 함수가 같은 부모면 같은 키 */
export function diagLockKey(parentTestId: string): string {
  return `spam_diag:${parentTestId}`;
}

/**
 * 검사 문자 관문(순수) — 잠금 아래에서 다시 읽은 값으로.
 *   not_mine = 판이 이미 active 가 아니거나 그 결과 행이 이미 정해졌다(정리 · 닫기 · 다른 실행이 먼저).
 */
export function judgeDiagTestSend(i: {
  switchOn: boolean; status: string; result: string | null; createdAtMs: number; nowMs: number; callbackAllowed: boolean; hasParent: boolean;
}): DiagGate {
  if (i.status !== 'active' || i.result !== null) return 'not_mine';
  if (!i.switchOn || !i.hasParent || !i.callbackAllowed) return 'reject';
  if (!Number.isFinite(i.createdAtMs) || i.nowMs - i.createdAtMs > DIAG_TEST_SEND_MINUTES * 60_000) return 'reject';
  return 'pass';
}

/**
 * 확인 문자 관문(순수) — 잠금 아래에서 다시 읽은 값으로.
 *   not_mine = 그 확인 문자 행이 이미 claimed 가 아니다(다른 호출이 먼저 보내 sent · 닫혀 expired) → 먼저 보낸 것의 기다림을 깨지 않는다.
 *   결과가 이미 unconfirmed 가 아니면 거부(호출부가 확인 문자 행만 닫고 정해진 결과는 둔다).
 */
export function judgeDiagProbeSend(i: {
  switchOn: boolean; probeStatus: string; result: string | null; diagCreatedAtMs: number; nowMs: number; callbackAllowed: boolean; hasParent: boolean;
}): DiagGate {
  if (i.probeStatus !== 'claimed') return 'not_mine';
  if (!i.switchOn || !i.hasParent || !i.callbackAllowed || i.result !== 'unconfirmed') return 'reject';
  if (!Number.isFinite(i.diagCreatedAtMs) || i.nowMs - i.diagCreatedAtMs > DIAG_PROBE_SEND_MINUTES * 60_000) return 'reject';
  return 'pass';
}

/**
 * 지금 발신번호 권한(엄격) — 판 행의 회사 · 등록 계정(user_id) · 발신번호. 배정 칸 확인 실패를 회사 전체 목록으로 내리지 않는다(strict).
 *   run 없음(전역 연결) = 조회가 던지면 false(= 거부 · 보내지 않는다).
 *   run 있음(잠금을 쥔 트랜잭션 연결 · ★Codex 구현 2R) = 던진다 — 그 트랜잭션은 실패 상태라 부르는 쪽이 저장점으로 되돌린 뒤 거부로 닫는다.
 */
export async function diagCallbackAllowed(
  companyId: string, userId: string, callback: string,
  run?: (sql: string, params?: any[]) => Promise<{ rows: any[] }>,
): Promise<boolean> {
  const check = async () => (await getRegisteredCallbackSet(companyId, userId, { strict: true, run })).has(normalizePhone(String(callback || '')));
  if (run) return check();
  try {
    return await check();
  } catch (err: any) {
    console.warn('[spam-diag] 발신번호 권한 조회 실패 — 확인 판을 보내지 않는다:', err?.message || err);
    return false;
  }
}
