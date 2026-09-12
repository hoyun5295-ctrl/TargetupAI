/**
 * sender-auth.ts — 발신 인증(추가 인증) 컨트롤타워 (★2026-09-12 전송자격인증 3.5)
 *
 * 무엇을 하나
 *   문자 발송 직전에 **발신번호와 계정의 연계**를 담당자 인증번호로 한 번 확인한다.
 *   인증기준 3.5가 요구하는 "발송 시 추가 인증 · 접속환경 변경 시 재인증"이 이 CT의 범위다.
 *
 * ⛔ 이 판정은 전 고객의 발송 경로를 지나간다
 *   시범 명단과 무관하게 게이트 **코드**는 모두가 통과한다. 그래서 성립하지 않는 값은 전부
 *   "요구하지 않음"으로 접는다 — 스위치 미설정 · 시행일 오타 · 명단 밖 · 번호 미등록 전부 통과다.
 *   막는 쪽으로 기우는 기본값을 두면 오타 한 글자가 전 고객 발송 중단이 된다.
 *
 * ⛔ 다중인증(3.4)과 축을 분리한다
 *   ENV가 다르고(`SENDER_AUTH_*`) 판정 함수가 다르다. 한 스위치로 둘을 켜면
 *   로그인만 시범 운영하려던 날 발송까지 함께 막힌다.
 *
 * 적용 범위 = 이용자가 직접 지시한 문자 발송뿐(문서 §4-C).
 *   여정·자동마케팅·플래너처럼 이용자 개입이 없는 자동 발송은 기준상 생략 대상이다.
 */

import bcrypt from 'bcryptjs';
import { query } from '../config/database';
import { isEnforcedFrom, isPilotTarget } from './rollout-gate';
import { ipPrefix, maskPhone, generateMfaCode, sendAuthCodeSms } from './mfa';
import { recordAuditLog } from './audit-log';

/** 시행일 게이트 — `SENDER_AUTH_ENFORCE_FROM`. 미설정이 기본값(미시행)이다. */
export function isSenderAuthEnforced(now: Date = new Date()): boolean {
  return isEnforcedFrom(process.env.SENDER_AUTH_ENFORCE_FROM, now);
}

/**
 * 시범 명단 게이트 — `SENDER_AUTH_PILOT_LOGIN_IDS=hoyun,psy5868,suran`.
 * ⚠ 비어 있으면 명단 제한이 없다(= 전면 시행 형태). 시범 운영 중에는 시행일과 **반드시 함께** 넣는다.
 */
export function isSenderAuthPilotTarget(loginId: string | null | undefined): boolean {
  const raw = String(process.env.SENDER_AUTH_PILOT_LOGIN_IDS || '').trim();
  // ⛔ 빈 명단을 "전면 적용"으로 읽지 않는다 — 시행일만 넣고 명단을 빠뜨린 실수 한 번이
  //   담당자 번호가 등록된 **전 고객**을 발송에서 막는다(Codex 적대검토 high).
  //   다중인증(3.4)은 그 의미를 이미 쓰고 있어 건드리지 않고, 이 축만 반대로 접는다.
  //   전면 시행은 명단을 실제로 채워서 한다.
  if (!raw.split(',').some((v) => v.trim())) return false;
  return isPilotTarget(raw, loginId);
}

/**
 * 이 계정의 발송에 발신 인증을 요구하는가 — 판정은 여기 하나다(발송 경로가 이것만 부른다).
 *   시행일 스위치 AND 시범 명단 AND 담당자 인증번호 등록. 셋 중 하나라도 아니면 묻지 않는다.
 */
export function isSenderAuthRequiredFor(
  user: { mfa_phone?: string | null; login_id?: string | null },
  now: Date = new Date()
): boolean {
  if (!user?.mfa_phone) return false;
  if (!isSenderAuthEnforced(now)) return false;
  return isSenderAuthPilotTarget(user.login_id);
}

/** 인증 유지시간(시간) — 기준 3.5 "동일 세션·일정 시간 유지". 다중인증 기기 신뢰와 같은 24시간이다. */
export const SENDER_AUTH_TRUST_HOURS = 24;

/** 재인증을 요구한 이유 — 화면이 사용자에게 그대로 밝힌다(팝업 `SenderAuthModal`과 같은 값 집합) */
export type SenderAuthReason = 'first' | 'expired' | 'environment';

/**
 * 발신번호를 하나로 특정할 수 없을 때 쓰는 계정 축 키.
 *
 * ⛔ 모르면 통제를 끄는 것이 아니라 넓게 잡는다 (Codex 적대검토 high)
 *   번호가 없다고 통과시키면 그 발송은 기본번호·개별 회신번호로 **인증 없이** 나간다.
 *   이 키로 받은 인증은 이 키의 발송에만 쓰인다 — 특정 번호로 넓혀 주지 않는다.
 */
export const SENDER_AUTH_ANY_CALLBACK = '*';

export type SenderAuthSessionVerdict = { alive: true } | { alive: false; reason: SenderAuthReason };

/** 세션 판정에 쓰는 최근 인증 성공 행 — 나이는 DB가 계산해서 넘긴다(앱·DB 시계 어긋남 차단) */
export interface SenderAuthSessionRow {
  ip_address?: string | null;
  user_agent?: string | null;
  age_seconds?: number | string | null;
}

/**
 * 발신번호 비교 키 — 숫자만 남긴다.
 * `02-3467-8612`·`0234678612`가 같은 번호로 취급되어야 인증이 표기 차이로 새지 않는다.
 */
export function senderNumberKey(raw: any): string {
  return String(raw ?? '').replace(/\D/g, '');
}

/** 테이블 미생성 감지 — 호출부가 기능만 쉬게 하고 발송은 그대로 통과시키기 위한 판정 */
export function isSenderAuthSchemaMissing(err: any): boolean {
  if (!err) return false;
  if (String(err.code || '') === '42P01') return true;
  return /relation .* does not exist/i.test(String(err.message || ''));
}

/**
 * 24시간 세션 판정 — 기준 3.5 "일정 시간 유지 + 접속환경 변경 시 재인증".
 *
 * ⛔ 모르면 다시 묻는다
 *   경과 시간을 읽지 못하면 만료로 본다. 통과로 접으면 값이 깨진 동안 인증이 통째로 무력해진다.
 *   (여기서 막히는 것은 시범 명단 계정뿐이다 — 명단 밖은 이 함수까지 오지 않는다)
 */
export function evaluateSenderAuthSession(
  row: SenderAuthSessionRow | null | undefined,
  req: { ip?: string; headers?: any }
): SenderAuthSessionVerdict {
  if (!row) return { alive: false, reason: 'first' };

  const raw = row.age_seconds;
  if (raw === null || raw === undefined || raw === '') return { alive: false, reason: 'expired' };
  const age = Number(raw);
  if (!Number.isFinite(age)) return { alive: false, reason: 'expired' };
  if (age > SENDER_AUTH_TRUST_HOURS * 3600) return { alive: false, reason: 'expired' };

  const sameBand = ipPrefix(row.ip_address) === ipPrefix(req?.ip);
  const sameAgent = String(row.user_agent || '') === String(req?.headers?.['user-agent'] || '');
  if (!sameBand || !sameAgent) return { alive: false, reason: 'environment' };

  return { alive: true };
}

/** 인증번호 유효시간(분) */
export const SENDER_AUTH_CODE_TTL_MINUTES = 5;
/** 코드 최대 시도 횟수 */
export const SENDER_AUTH_MAX_ATTEMPTS = 5;
/** 재발송 쿨다운(초) — 발송 버튼을 연타해도 문자가 쏟아지지 않는다 */
export const SENDER_AUTH_RESEND_COOLDOWN_SECONDS = 60;
/** 화면 안내 문구 — 인라인 금지, 이 상수 하나를 쓴다 */
export const SENDER_AUTH_NOTICE = '발신번호 담당자 확인이 필요합니다. 문자로 보낸 인증번호를 입력해주세요.';

export interface SenderAuthGateParams {
  req: { ip?: string; headers?: any };
  userId: string;
  companyId: string | null;
  /** 이 발송에 쓰는 발신번호(표기 그대로 넘겨도 된다 — 키는 여기서 만든다) */
  callback: any;
  /**
   * 행마다 회신번호가 다른 발송인가 — 그렇다면 번호를 하나로 특정할 수 없어 계정 축으로 잡는다.
   */
  useIndividualCallback?: boolean;
  /** 수신자 수 — 기록·판단용으로만 받는다(건수는 인증 여부를 바꾸지 않는다) */
  recipientCount?: number;
}

export type SenderAuthGate =
  | { ok: true }
  | {
      ok: false;
      reason: SenderAuthReason;
      challengeId: string;
      maskedPhone: string;
      callback: string;
      expiresInMinutes: number;
    };

/**
 * 최근 인증 성공 한 건 — 판정 축은 `verified_at`이다.
 * ⛔ `consumed_at`으로 보면 안 된다. 그 컬럼은 "썼거나 폐기됨"을 뜻해서,
 *   미사용 코드를 폐기한 행이 인증 성공으로 읽힌다(한 컬럼이 두 질문에 답하는 자리).
 */
async function findVerifiedSession(userId: string, callbackKey: string): Promise<SenderAuthSessionRow | null> {
  const result = await query(
    `SELECT ip_address, user_agent, EXTRACT(EPOCH FROM (NOW() - verified_at)) AS age_seconds
       FROM sender_auth_challenges
      WHERE user_id = $1 AND callback_number = $2 AND verified_at IS NOT NULL
      ORDER BY verified_at DESC
      LIMIT 1`,
    [userId, callbackKey]
  );
  return result.rows[0] || null;
}

/**
 * 인증번호 발급 — 쿨다운 안 재요청은 살아있는 코드를 재사용한다(사용자를 막지 않으면서 문자 폭탄도 막는다).
 * ⛔ 평문은 저장하지 않는다(해시만).
 */
export async function issueSenderAuthChallenge(params: {
  userId: string;
  companyId: string | null;
  callbackKey: string;
  phone: string;
  req: { ip?: string; headers?: any };
}): Promise<{ challengeId: string; maskedPhone: string }> {
  // ⛔ 쿨다운은 **발급 시각만** 본다 (Codex 적대검토 medium)
  //   시도 한도에 걸린 코드를 제외하면, 오답 5회 직후 재시도만으로 60초를 건너뛰고
  //   새 문자 + attempts 0인 코드가 나온다. 그러면 추측 한도도 문자 발급 한도도 무력해진다.
  const recent = await query(
    `SELECT id, EXTRACT(EPOCH FROM (NOW() - created_at)) AS age_seconds
       FROM sender_auth_challenges
      WHERE user_id = $1 AND callback_number = $2
      ORDER BY created_at DESC
      LIMIT 1`,
    [params.userId, params.callbackKey]
  );
  const alive = recent.rows[0];
  if (alive && Number(alive.age_seconds) < SENDER_AUTH_RESEND_COOLDOWN_SECONDS) {
    return { challengeId: alive.id, maskedPhone: maskPhone(params.phone) };
  }

  // 살아있는 코드가 둘 이상이면 안 된다 — 폐기는 consumed_at만 건드린다(verified_at 불변)
  await query(
    `UPDATE sender_auth_challenges SET consumed_at = NOW()
      WHERE user_id = $1 AND callback_number = $2 AND consumed_at IS NULL`,
    [params.userId, params.callbackKey]
  );

  const code = generateMfaCode();
  const codeHash = await bcrypt.hash(code, 8);
  const inserted = await query(
    `INSERT INTO sender_auth_challenges
       (id, user_id, company_id, callback_number, code_hash, phone, attempts, expires_at, ip_address, user_agent, created_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 0, NOW() + INTERVAL '1 minute' * $6, $7, $8, NOW())
     RETURNING id`,
    [
      params.userId,
      params.companyId,
      params.callbackKey,
      codeHash,
      params.phone,
      SENDER_AUTH_CODE_TTL_MINUTES,
      params.req?.ip || '',
      String(params.req?.headers?.['user-agent'] || ''),
    ]
  );

  await sendAuthCodeSms(
    params.phone,
    `[한줄로] 발신번호 인증번호 ${code}\n${SENDER_AUTH_CODE_TTL_MINUTES}분 안에 입력해주세요.`
  );

  await recordAuditLog({
    actorUserId: params.userId,
    action: 'sender_auth_challenge',
    targetType: 'sender_number',
    details: { callback_number: params.callbackKey, phone_masked: maskPhone(params.phone) },
    req: params.req,
  });

  return { challengeId: inserted.rows[0].id, maskedPhone: maskPhone(params.phone) };
}

/**
 * 발송 앞 게이트 — 발송 경로는 이 함수 하나만 부른다(조건을 라우트에서 다시 조립하지 않는다).
 *
 * ⛔ 순서가 곧 안전이다
 *   ① 스위치가 꺼져 있으면 **DB를 건드리기 전에** 통과시킨다. 전 고객 발송 경로가 이 줄을 지난다.
 *   ② 그 뒤의 모든 실패는 통과로 접는다 — 테이블 미생성·조회 오류·문자 발송 실패 전부.
 *      통제가 고장 나서 발송이 멈추는 것보다, 통제가 쉬고 발송이 사는 쪽이 이 서비스에서는 옳다.
 *      전면 시행 때 뒤집으려면 `SENDER_AUTH_FAIL_CLOSED=1`.
 */
export async function checkSenderAuthGate(params: SenderAuthGateParams): Promise<SenderAuthGate> {
  if (!isSenderAuthEnforced()) return { ok: true };

  try {
    const userResult = await query(`SELECT login_id, mfa_phone FROM users WHERE id = $1`, [params.userId]);
    const user = userResult.rows[0];
    if (!user) return { ok: true };
    if (!isSenderAuthRequiredFor(user)) return { ok: true };

    // 번호를 하나로 특정할 수 없으면(미지정·행마다 다름) 계정 축으로 잡는다 — 끄지 않는다
    const callbackKey = params.useIndividualCallback
      ? SENDER_AUTH_ANY_CALLBACK
      : (senderNumberKey(params.callback) || SENDER_AUTH_ANY_CALLBACK);

    const session = evaluateSenderAuthSession(await findVerifiedSession(params.userId, callbackKey), params.req);
    if (session.alive) return { ok: true };

    const issued = await issueSenderAuthChallenge({
      userId: params.userId,
      companyId: params.companyId || null,
      callbackKey,
      phone: String(user.mfa_phone),
      req: params.req,
    });

    return {
      ok: false,
      reason: session.reason,
      challengeId: issued.challengeId,
      maskedPhone: issued.maskedPhone,
      callback: String(params.callback || '') || '발신번호 확인',
      expiresInMinutes: SENDER_AUTH_CODE_TTL_MINUTES,
    };
  } catch (error) {
    if (String(process.env.SENDER_AUTH_FAIL_CLOSED || '') === '1') throw error;
    // ⛔ 오류 객체를 통째로 찍지 않는다 (Codex 적대검토 medium)
    //   MySQL 드라이버는 매개변수가 끼워진 SQL을 오류에 담는다 — 인증문자 적재가 실패하면
    //   그 SQL에 담당자 번호와 평문 인증번호가 들어 있다.
    console.log('[발신인증] 판정 실패, 발송은 통과시킨다:', String((error as any)?.code || (error as any)?.name || 'unknown'));
    return { ok: true };
  }
}

export type SenderAuthVerdict =
  | { status: 'ok'; callbackNumber: string }
  | { status: 'invalid'; remaining: number }
  | { status: 'expired' }
  | { status: 'locked' };

/**
 * 인증번호 검증 — 통과하면 `verified_at`을 찍는다(24시간 세션의 유일한 근거).
 *
 * ⛔ 만료·소비 판정은 DB의 NOW()로 한다 — 앱 시계와 DB 시계가 어긋나도 판정이 흔들리지 않는다.
 * ⛔ 통과한 코드는 즉시 소비한다 — 같은 코드로 두 번 통과하지 못한다.
 */
export async function verifySenderAuthChallenge(params: {
  challengeId: string;
  userId: string;
  code: string;
  req: { ip?: string; headers?: any };
}): Promise<SenderAuthVerdict> {
  const result = await query(
    `SELECT code_hash, attempts, phone, callback_number, company_id,
            (expires_at < NOW()) AS expired, (consumed_at IS NOT NULL) AS consumed
       FROM sender_auth_challenges
      WHERE id = $1 AND user_id = $2`,
    [params.challengeId, params.userId]
  );
  const row = result.rows[0];
  if (!row) return { status: 'invalid', remaining: 0 };
  if (row.consumed || row.expired) return { status: 'expired' };
  if (Number(row.attempts) >= SENDER_AUTH_MAX_ATTEMPTS) return { status: 'locked' };

  const match = await bcrypt.compare(String(params.code || ''), String(row.code_hash || ''));
  if (!match) {
    const bumped = await query(
      `UPDATE sender_auth_challenges SET attempts = attempts + 1
        WHERE id = $1 AND consumed_at IS NULL
        RETURNING attempts`,
      [params.challengeId]
    );
    const attempts = Number(bumped.rows[0]?.attempts ?? SENDER_AUTH_MAX_ATTEMPTS);
    if (attempts >= SENDER_AUTH_MAX_ATTEMPTS) {
      await query(`UPDATE sender_auth_challenges SET consumed_at = NOW() WHERE id = $1`, [params.challengeId]);
      return { status: 'locked' };
    }
    return { status: 'invalid', remaining: SENDER_AUTH_MAX_ATTEMPTS - attempts };
  }

  // ⛔ 성공 기록은 한 문장 안에서 조건과 함께 남긴다 (Codex 적대검토 high)
  //   조회와 기록이 갈라져 있으면, 그 사이에 다른 요청이 코드를 잠그거나 폐기해도
  //   정답 요청이 무조건 verified_at을 찍어 **없던 인증이 생긴다.**
  const updated = await query(
    `UPDATE sender_auth_challenges
        SET verified_at = NOW(), consumed_at = NOW()
      WHERE id = $1 AND consumed_at IS NULL AND expires_at > NOW() AND attempts < $2
      RETURNING id`,
    [params.challengeId, SENDER_AUTH_MAX_ATTEMPTS]
  );
  if ((updated.rows?.length || 0) === 0) return { status: 'expired' };

  await recordAuditLog({
    actorUserId: params.userId,
    action: 'sender_auth_success',
    targetType: 'sender_number',
    details: { callback_number: String(row.callback_number || ''), phone_masked: maskPhone(row.phone) },
    req: params.req,
  });

  return { status: 'ok', callbackNumber: String(row.callback_number || '') };
}

/**
 * 인증 요구 응답 — 발송 경로 3곳이 같은 몸통을 돌려주도록 CT가 만든다.
 * 라우트마다 손으로 적으면 한 곳이 코드나 문구를 빠뜨려 화면이 팝업을 못 띄운다.
 */
export function senderAuthRejection(gate: Extract<SenderAuthGate, { ok: false }>) {
  return {
    success: false,
    error: SENDER_AUTH_NOTICE,
    code: 'SENDER_AUTH_REQUIRED',
    senderAuth: {
      challengeId: gate.challengeId,
      maskedPhone: gate.maskedPhone,
      callback: gate.callback,
      expiresInMinutes: gate.expiresInMinutes,
      reason: gate.reason,
    },
  };
}
