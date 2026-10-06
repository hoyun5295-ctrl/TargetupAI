/**
 * identity-verify.ts — 담당자 본인인증 컨트롤타워 (★2026-10-02 전송자격인증 2.1 ①-1 · 3.4 ② · ③ · 3.5 ②)
 *
 * 무엇을 하나
 *   계정마다 **최초 1회** 본인확인기관 인증을 거치게 하고, 인증된 휴대폰을 그 계정의 담당자 번호(연락처 ·
 *   로그인 인증번호 수신 번호)로 저장한다(1001 회의 결정 · Harold 승인). 담당자가 바뀌면 설정 화면에서
 *   다시 본인인증을 거쳐 바꾼다. 이용자가 손으로 번호를 고치는 길은 두지 않는다 — 인증기준 3.4 ②가 요구하는
 *   "다중인증 수단이 본인확인된 정보와 연계"가 이것으로 성립한다.
 *   ⚠ 전환기 잔여 — 슈퍼관리자가 번호를 직접 넣는 경로(`routes/admin.ts` `PUT /users/:id/mfa-phone`)는
 *     시범 계정 운영 때문에 아직 살아 있다. 본인인증을 전 계정에 시행할 때 그 경로를 닫아야 위 문장이 완결된다.
 *
 * ⛔ 판정은 이 CT 하나가 소유한다
 *   로그인 세션을 만드는 함수(`issueUserLogin`)는 이 CT가 내준 `IdentityClearance` 없이는 호출되지 않는다.
 *   세션을 만드는 경로가 늘어도(다중인증 통과 경로 등) 판정을 빠뜨리면 tsc가 잡는다.
 *
 * ⛔ 배포만으로는 아무도 요구받지 않는다 — 셋이 모두 성립해야 요구한다
 *   1. 시행일 `IDENTITY_VERIFY_ENFORCE_FROM` (값이 없거나 날짜가 아니면 미시행)
 *   2. 명단 `IDENTITY_VERIFY_PILOT_LOGIN_IDS` (**비어 있으면 미시행**. 전 계정은 `*`를 명시해야 한다)
 *   3. 인증기관 연결(`resolveIdentityProvider`)이 준비됨
 *   시행일만 넣고 명단을 빠뜨린 실수 한 번이 전 고객 로그인을 막지 않게, 빈 값은 전부 "요구하지 않음"으로 접는다.
 *
 * ⛔ 모르는 것은 통과시킨다(전 고객 로그인이 걸린 게이트다)
 *   표가 아직 없음(42P01) · 조회 오류 → 요구하지 않는다. 기능만 쉰다.
 *
 * ⛔ 인증기관 자리
 *   `IdentityProvider` 두 함수(요청 만들기 · 결과 확인)가 그 자리다. ★2026-10-06 한국모바일인증 = `identity-provider-kmc.ts`
 *   (ENV `KMC_CP_ID` · `KMC_URL_CODE` · `KMC_CRYPTO_PATH` 가 다 있고 실행 파일이 있을 때만 연결된다).
 *   운영에서는 실제 인증기관만 쓰인다 — 시험용(`stub`)은 `NODE_ENV`가 development · test로 명시된 환경에서만 켜진다.
 *   인증기관이 준비되지 않은 동안에는 스위치를 켜도 요구하지 않는다(위 3번).
 *
 * ⛔ 과거를 지어내지 않는다 — 본인인증 이력이 없는 계정은 "미인증"이다. 기존 번호를 인증된 것으로 치지 않는다.
 *
 * ⛔ 계정 이름(`users.name`)은 바꾸지 않는다(★2026-10-06 Harold 「원래 계정에 설정한 이름으로 · 전화번호만 담당자 번호로」).
 *   인증한 사람의 이름은 인증 이력(`identity_verifications.verified_name`)에만 남고, 설정 「계정 담당자」 카드가 그 이름을 보여 준다.
 */
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import type { Request } from 'express';
import pool, { query } from '../config/database';
import { isEnforcedFrom } from './rollout-gate';
import { maskPhone, markVerifiedPhone, VerifiedPhone } from './mfa';
import { kmcConfig, kmcProvider } from './identity-provider-kmc';

/** 본인인증 진행 시간(분) — 인증 창을 열어 끝낼 때까지 */
export const IDENTITY_TICKET_TTL_MINUTES = 10;
/** 티켓 JWT 식별 클레임 — 로그인 토큰이 아니다. `userId` 클레임을 싣지 않아 API 인증으로 통과하지 못한다 */
const IDENTITY_PURPOSE = 'identity_pending';

export type IdentityPurpose = 'first_login' | 'change';

/** 인증기관이 확인해 준 사람 */
export interface VerifiedIdentity {
  name: string;
  phone: string;
  /** 인증기관이 주는 중복가입 확인값(있으면). 원문을 저장하지 않고 해시로만 남긴다 */
  dupKey?: string | null;
  /** 인증기관 거래 번호(있으면) */
  providerTxId?: string | null;
}

/**
 * 인증기관 연결 — 한국모바일인증 모듈이 오면 이 두 함수를 채운 구현을 하나 더한다.
 *   buildStart : 화면이 인증 창을 여는 데 필요한 값(요청 전문 · 주소 등)을 만든다
 *   verify     : 인증 창이 돌려준 결과가 진짜인지 확인하고 이름·휴대폰을 꺼낸다(위조 결과는 여기서 던진다)
 * ⛔ verify는 그 결과가 **이 `verificationId`의 요청에서 나온 것**인지까지 확인해야 한다.
 *    안 하면 남의 인증 결과를 가져다 붙이는 재사용이 통한다(요청에 실은 값과 결과의 값을 대조한다).
 */
export interface IdentityProvider {
  name: string;
  buildStart(ctx: { verificationId: string; req: Request }): Promise<Record<string, any>>;
  verify(payload: any, ctx: { verificationId: string; req: Request }): Promise<VerifiedIdentity>;
}

/** 시험용 — 화면이 넘긴 이름·번호를 그대로 믿는다. 운영에서는 절대 쓰이지 않는다(`resolveIdentityProvider`) */
const stubProvider: IdentityProvider = {
  name: 'stub',
  async buildStart() {
    return { mode: 'stub' };
  },
  async verify(payload: any) {
    return { name: String(payload?.name || ''), phone: String(payload?.phone || ''), dupKey: null, providerTxId: null };
  },
};

let injectedProvider: IdentityProvider | null = null;

/** 인증기관 구현을 꽂는다 — 한국모바일인증 연동 모듈이 기동 시 한 번 부른다(테스트도 이것을 쓴다) */
export function registerIdentityProvider(provider: IdentityProvider | null): void {
  injectedProvider = provider;
}

/** 시험용 인증을 허용하는 실행 환경 — 허용 목록이다. 값이 비어 있거나 모르는 값이면 허용하지 않는다 */
const STUB_ALLOWED_NODE_ENVS = ['development', 'test'];

/**
 * 지금 쓸 수 있는 인증기관. 없으면 null = 본인인증을 요구하지 않는다.
 * ⛔ 시험용은 `NODE_ENV`가 development · test로 **명시된** 환경에서만 켜진다.
 *    "production이 아니면 허용"으로 쓰지 않는다 — 운영 서버에 그 값이 비어 있으면 그대로 켜진다.
 */
export function resolveIdentityProvider(): IdentityProvider | null {
  if (injectedProvider) return injectedProvider;
  const wanted = String(process.env.IDENTITY_VERIFY_PROVIDER || '').trim().toLowerCase();
  const nodeEnv = String(process.env.NODE_ENV || '').trim().toLowerCase();
  if (wanted === 'stub' && STUB_ALLOWED_NODE_ENVS.includes(nodeEnv)) return stubProvider;
  // ★ 2026-10-06 한국모바일인증 — 설정 · 실행 파일이 다 있을 때만(하나라도 없으면 종전처럼 아무도 요구받지 않는다)
  if (kmcConfig()) return kmcProvider;
  return null;
}

export function isIdentityVerifyEnforced(now: Date = new Date()): boolean {
  return isEnforcedFrom(process.env.IDENTITY_VERIFY_ENFORCE_FROM, now);
}

/**
 * 명단 판정 — 빈 명단은 "아무도 아님"이다. 전 계정은 `*`를 명시한다.
 * (다중인증의 빈 명단 = 전면 시행과 반대다. 그 뜻을 이미 쓰고 있는 축은 건드리지 않고 이 축만 이렇게 접는다)
 */
export function isIdentityVerifyTarget(loginId: string | null | undefined): boolean {
  const list = String(process.env.IDENTITY_VERIFY_PILOT_LOGIN_IDS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (list.length === 0) return false;
  if (list.includes('*')) return true;
  const id = String(loginId || '').trim().toLowerCase();
  return !!id && list.includes(id);
}

/** 이 계정에 본인인증 기능이 켜져 있는가(스위치 · 명단 · 인증기관) — DB를 보지 않는다 */
export function isIdentityVerifyActiveFor(
  user: { login_id?: string | null },
  now: Date = new Date()
): boolean {
  if (!isIdentityVerifyEnforced(now)) return false;
  if (!isIdentityVerifyTarget(user?.login_id)) return false;
  return resolveIdentityProvider() !== null;
}

/** 표 미생성 감지 — 기능만 쉬게 하고 로그인은 그대로 통과시키기 위한 판정 */
export function isIdentitySchemaMissing(err: any): boolean {
  if (!err) return false;
  if (String(err.code || '') === '42P01') return true;
  return /relation .* does not exist/i.test(String(err.message || ''));
}

declare const identityClearanceBrand: unique symbol;
/** 본인인증 관문을 지났다는 증표 — 이 CT 밖에서는 만들 수 없다(`issueUserLogin`이 요구한다) */
export type IdentityClearance = { readonly [identityClearanceBrand]: true };
const CLEARED = {} as IdentityClearance;

export type IdentityGate =
  | { status: 'cleared'; clearance: IdentityClearance }
  /** 본인인증이 필요하다 — 세션을 만들지 않는다. 티켓으로 인증을 시작한다 */
  | { status: 'required'; ticket: string };

function ticketSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET missing');
  return secret;
}

/** 본인인증 대기 티켓 — 로그인 토큰이 아니다. userId를 표준 클레임명으로 담지 않는다 */
export function issueIdentityTicket(userId: string): string {
  return jwt.sign({ purpose: IDENTITY_PURPOSE, iuid: userId }, ticketSecret(), {
    expiresIn: IDENTITY_TICKET_TTL_MINUTES * 60,
  });
}

export function verifyIdentityTicket(ticket: any): { userId: string } | null {
  if (!ticket || typeof ticket !== 'string') return null;
  try {
    const decoded = jwt.verify(ticket, ticketSecret()) as any;
    if (decoded?.purpose !== IDENTITY_PURPOSE || !decoded?.iuid) return null;
    return { userId: String(decoded.iuid) };
  } catch {
    return null;
  }
}

/**
 * 로그인 관문 — 이 계정이 본인인증을 마쳤는가.
 * 요구하지 않는 모든 경우(미시행 · 명단 밖 · 인증기관 없음 · 표 없음 · 조회 오류 · 이미 인증)는 통과다.
 */
export async function evaluateIdentityGate(user: { id: string; login_id?: string | null }): Promise<IdentityGate> {
  if (!isIdentityVerifyActiveFor(user)) return { status: 'cleared', clearance: CLEARED };
  try {
    const done = await query(
      `SELECT 1 AS ok FROM identity_verifications WHERE user_id = $1 AND status = 'verified' LIMIT 1`,
      [user.id]
    );
    if (done.rows.length > 0) return { status: 'cleared', clearance: CLEARED };
  } catch (err: any) {
    if (!isIdentitySchemaMissing(err)) {
      console.error('[identity-verify] 인증 이력 조회 실패 — 요구하지 않고 통과시킨다:', err?.code || err?.message);
    }
    return { status: 'cleared', clearance: CLEARED };
  }
  return { status: 'required', ticket: issueIdentityTicket(user.id) };
}

/** 휴대폰 형식 — 인증번호가 가야 하는 번호다. 숫자만 남겨 판정한다 */
export function normalizeVerifiedPhone(raw: any): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '');
  return /^01[016789]\d{7,8}$/.test(digits) ? digits : null;
}

/** 이름 — 앞뒤 공백만 걷는다. 비었거나 지나치게 길면 받지 않는다 */
export function normalizeVerifiedName(raw: any): string | null {
  const name = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!name || name.length > 50) return null;
  return name;
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export type IdentityStart =
  | { status: 'started'; verificationId: string; provider: string; start: Record<string, any> }
  /** 최초 등록을 시작하려는데 그 계정은 이미 본인인증을 마쳤다 — 다시 로그인하면 된다 */
  | { status: 'already_verified' }
  | { status: 'unavailable' };

/**
 * 본인인증 시작 — 대기 행을 만들고 인증 창을 여는 데 필요한 값을 돌려준다.
 * 인증기관이 없으면 시작하지 않는다(호출부가 사용자에게 안내한다).
 *
 * ⛔ 계정 단위로 줄을 세운다(★Codex 1R) — 계정 행을 잠근 채로 "옛 대기 행 접기 → 새 대기 행 만들기"를 한다.
 *    따로 하면 동시에 들어온 두 시작이 서로의 대기 행을 못 보고 둘 다 만들어, 뒤늦게 끝난 옛 창이
 *    새로 확정된 담당자를 다시 덮는다. 표의 부분 유일 인덱스(계정당 대기 행 하나)가 같은 것을 DB에서도 막는다.
 * ⛔ 최초 등록(`first_login`)은 **아직 본인인증 이력이 없는 계정에서만** 시작된다.
 */
export async function startIdentityVerification(params: {
  userId: string;
  purpose: IdentityPurpose;
  req: Request;
}): Promise<IdentityStart> {
  const provider = resolveIdentityProvider();
  if (!provider) return { status: 'unavailable' };
  const { userId, purpose, req } = params;

  let verificationId: string;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [userId]);
    if (locked.rows.length === 0) {
      await client.query('ROLLBACK');
      return { status: 'unavailable' };
    }
    if (purpose === 'first_login') {
      const done = await client.query(
        `SELECT 1 AS ok FROM identity_verifications WHERE user_id = $1 AND status = 'verified' LIMIT 1`,
        [userId]
      );
      if (done.rows.length > 0) {
        await client.query('ROLLBACK');
        return { status: 'already_verified' };
      }
    }
    await client.query(
      `UPDATE identity_verifications SET status = 'superseded' WHERE user_id = $1 AND status = 'pending'`,
      [userId]
    );
    const inserted = await client.query(
      `INSERT INTO identity_verifications
         (id, user_id, purpose, status, provider, ip_address, user_agent, created_at, expires_at)
       VALUES (gen_random_uuid(), $1, $2, 'pending', $3, $4, $5, NOW(), NOW() + INTERVAL '1 minute' * $6)
       RETURNING id`,
      [userId, purpose, provider.name, String(req.ip || ''), String(req.headers['user-agent'] || ''), IDENTITY_TICKET_TTL_MINUTES]
    );
    await client.query('COMMIT');
    verificationId = String(inserted.rows[0].id);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* 아래 전파에 포함 */ }
    throw err;
  } finally {
    client.release();
  }

  // 인증기관 호출은 잠금 밖에서 한다 — 외부 호출을 잠금 안에 두면 그 계정의 다른 요청이 그동안 선다
  const start = await provider.buildStart({ verificationId, req });
  return { status: 'started', verificationId, provider: provider.name, start };
}

export type IdentityCompletion =
  | {
      status: 'verified';
      clearance: IdentityClearance;
      name: string;
      maskedPhone: string;
      /**
       * 이 본인인증이 실제로 확인한 번호(★Codex 3R) — 접속 인계용 통과권 발급의 증거로만 쓴다.
       * 응답으로 내보내지 않는다(화면에는 `maskedPhone`만 간다).
       */
      verifiedPhone: VerifiedPhone;
      /** 저장 전 값 — 감사 기록용(번호는 가린 값) */
      before: { name: string | null; maskedPhone: string | null; maskedMfaPhone: string | null };
    }
  /** 인증기관이 결과를 인정하지 않았다 · 이름이나 번호가 형식에 맞지 않는다 · detail = 인증기관 구현의 거절 코드(감사 기록용 · 화면에 내보내지 않는다) */
  | { status: 'rejected'; reason: 'provider' | 'invalid_identity'; detail?: string }
  /** 대기 행이 만료됐거나 이미 쓰였다 — 처음부터 다시 */
  | { status: 'expired' }
  /** 최초 등록인데 그 계정은 그사이 본인인증을 마쳤다 — 담당자를 다시 덮지 않는다 */
  | { status: 'already_verified' }
  | { status: 'unavailable' };

/**
 * 본인인증 완료 — 인증기관 결과를 확인하고, 인증된 이름·번호를 그 계정에 저장한다.
 *
 * ⛔ 한 트랜잭션이고, **계정 행을 먼저 잠근다**(★Codex 1R). 그 계정의 완료·시작이 한 줄로 선다.
 * ⛔ 최초 등록 권한은 한 번 쓰면 끝이다(★Codex 1R high). 미인증 상태에서 받은 티켓은 10분간 살아 있어,
 *    정상 담당자가 인증을 끝낸 뒤에도 같은 티켓으로 다른 사람이 자기 휴대폰을 등록해 담당자를 갈아치울 수 있었다.
 *    잠금 안에서 "이 계정에 인증 이력이 이미 있는가"를 다시 보고, 있으면 최초 등록 완료를 거절한다.
 * ⛔ 대기 행 확정은 **조건이 붙은 한 문장**이다(대기 · 미만료 · 그 계정 · 그 인증기관 · 그 목적). 갱신 0행이면 실패.
 *    목적을 조건에 넣는 이유 — 로그인 티켓 경로가 설정 화면에서 시작한 변경 건을 끝내지 못하게.
 * ⛔ 번호가 바뀌면 옛 번호로 얻은 인증 수단은 전부 무효다(★Codex 1R high). 통과권은 여기서 지우고,
 *    **아직 쓰지 않은 로그인 인증번호**는 검증 쪽이 현재 번호와 대조해 거른다(`verifyMfaChallenge`).
 *    폐기를 여기에만 두면 번호를 바꾸는 다른 자리(슈퍼관리자 등록)와 동시에 발급 중이던 인증번호가 빠진다.
 * 인증된 번호가 그 계정의 **유일한** 로그인 인증번호가 된다(계정당 하나 · 기존 번호를 덮는다).
 * ⛔ 계정 이름은 덮지 않는다(★1006 Harold) — 이름은 인증 이력에만 남는다.
 */
export async function completeIdentityVerification(params: {
  userId: string;
  verificationId: string;
  purpose: IdentityPurpose;
  payload: any;
  req: Request;
}): Promise<IdentityCompletion> {
  const provider = resolveIdentityProvider();
  if (!provider) return { status: 'unavailable' };
  const { userId, verificationId, purpose, payload, req } = params;

  // 인증기관 확인은 잠금 밖에서 한다(외부 호출)
  let identity: VerifiedIdentity;
  try {
    identity = await provider.verify(payload, { verificationId, req });
  } catch (err: any) {
    console.error('[identity-verify] 인증기관 결과 확인 실패:', err?.code || err?.message);
    // ★1006 Harold 「나중에 할 말이 있게 기록」 — 거절 사유 코드(예: KMC_CERTNUM_MISMATCH_RETURN = 남의 결과 끼워 넣기)를 감사 기록에 남긴다
    const detail = /^[A-Z][A-Z0-9_]{2,59}$/.test(String(err?.message || '')) ? String(err.message) : undefined;
    return detail ? { status: 'rejected', reason: 'provider', detail } : { status: 'rejected', reason: 'provider' };
  }
  const name = normalizeVerifiedName(identity?.name);
  const phone = normalizeVerifiedPhone(identity?.phone);
  if (!name || !phone) return { status: 'rejected', reason: 'invalid_identity' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const beforeRes = await client.query(
      `SELECT name, phone, mfa_phone FROM users WHERE id = $1 FOR UPDATE`,
      [userId]
    );
    if (beforeRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { status: 'expired' };
    }
    const prev = beforeRes.rows[0];

    if (purpose === 'first_login') {
      const done = await client.query(
        `SELECT 1 AS ok FROM identity_verifications WHERE user_id = $1 AND status = 'verified' LIMIT 1`,
        [userId]
      );
      if (done.rows.length > 0) {
        await client.query('ROLLBACK');
        return { status: 'already_verified' };
      }
    }

    const confirmed = await client.query(
      `UPDATE identity_verifications
          SET status = 'verified', verified_name = $3, verified_phone = $4,
              dup_key_hash = $5, provider_tx_id = $6, verified_at = NOW()
        WHERE id = $1 AND user_id = $2 AND status = 'pending' AND provider = $7 AND purpose = $8 AND expires_at > NOW()
        RETURNING id`,
      [
        verificationId, userId, name, phone,
        identity.dupKey ? sha256(String(identity.dupKey)) : null,
        identity.providerTxId ? String(identity.providerTxId).slice(0, 120) : null,
        provider.name, purpose,
      ]
    );
    if (confirmed.rows.length === 0) {
      await client.query('ROLLBACK');
      return { status: 'expired' };
    }
    await client.query(
      `UPDATE users SET phone = $2, mfa_phone = $2, updated_at = NOW() WHERE id = $1`,
      [userId, phone]
    );
    // 옛 번호로 얻은 통과권은 무효다.
    // 아직 쓰지 않은 로그인 인증번호는 여기서 지우지 않는다 — 검증(`mfa.ts` `verifyMfaChallenge`)이 쓰는 순간에
    // "발급된 번호 = 계정의 현재 인증번호"를 대조하므로, 번호가 바뀌는 즉시 옛 번호의 인증번호는 전부 죽는다.
    await client.query(`DELETE FROM mfa_trusted_devices WHERE user_id = $1`, [userId]);
    await client.query('COMMIT');
    return {
      status: 'verified',
      clearance: CLEARED,
      name,
      maskedPhone: maskPhone(phone),
      verifiedPhone: markVerifiedPhone(phone),
      before: {
        name: prev.name ?? null,
        maskedPhone: prev.phone ? maskPhone(prev.phone) : null,
        maskedMfaPhone: prev.mfa_phone ? maskPhone(prev.mfa_phone) : null,
      },
    };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* 아래 전파에 포함 */ }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * 감사 기록에 남기는 인증 건 번호 — 인증 건 번호(UUID) 모양일 때만 소문자로, 아니면 null(★1006 Codex 3R).
 *   화면이 보낸 값을 그대로 남기면 그 칸에 넣은 휴대폰 번호 같은 원문이 감사 기록에 쌓인다.
 */
export function identityAuditId(raw: unknown): string | null {
  const v = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v) ? v : null;
}

/** 표가 아직 없을 때의 응답 — 500으로 내보내지 않는다 */
export const IDENTITY_MIGRATION_RESPONSE = {
  error: 'DB 마이그레이션 필요: identity_verifications 생성 요청',
  code: 'DB_MIGRATION_PENDING',
};

/** 인증기관이 준비되지 않았을 때의 응답 */
export const IDENTITY_UNAVAILABLE_RESPONSE = {
  error: '본인인증을 지금 진행할 수 없습니다. 담당자에게 문의해주세요.',
  code: 'IDENTITY_PROVIDER_UNAVAILABLE',
};

/** 최초 등록을 하려는데 그 계정은 이미 본인인증을 마쳤다 — 담당자를 덮지 않고 다시 로그인시킨다 */
export const IDENTITY_ALREADY_VERIFIED_RESPONSE = {
  error: '이미 본인인증이 끝난 계정입니다. 다시 로그인해주세요.',
  code: 'IDENTITY_ALREADY_VERIFIED',
};

/**
 * 완료 실패 → 응답. 문구를 라우트마다 다시 쓰면 로그인 경로와 설정 경로의 안내가 갈린다.
 * 인증기관이 왜 거절했는지(원문)는 내보내지 않는다 — 사용자가 할 일은 "다시 시도"뿐이다.
 */
export function identityFailureResponse(
  done: Exclude<IdentityCompletion, { status: 'verified' }>
): { http: number; body: { error: string; code: string } } {
  if (done.status === 'unavailable') return { http: 503, body: IDENTITY_UNAVAILABLE_RESPONSE };
  if (done.status === 'already_verified') return { http: 409, body: IDENTITY_ALREADY_VERIFIED_RESPONSE };
  if (done.status === 'expired') {
    return { http: 401, body: { error: '본인인증 시간이 지났습니다. 다시 시도해주세요.', code: 'IDENTITY_EXPIRED' } };
  }
  return {
    http: 400,
    body: {
      error: done.reason === 'invalid_identity'
        ? '본인인증 결과에서 이름 또는 휴대폰 번호를 확인하지 못했습니다. 다시 시도해주세요.'
        : '본인인증을 확인하지 못했습니다. 다시 시도해주세요.',
      code: 'IDENTITY_REJECTED',
    },
  };
}

/**
 * 설정 화면 카드에 쓰는 현재 담당자 — 번호는 가린 값만 내보낸다.
 * ★ 2026-10-03 카드를 전 고객사 계정에 항상 보여 주게 되면서(Harold), 본인인증 전이어도 **등록된 담당자**를 준다.
 *   등록된 담당자 = 로그인 인증번호를 받는 번호(`mfa_phone`)가 있는 계정의 이름 · 번호.
 *   ⛔ 등록돼 있다고 인증된 것은 아니다 — 인증 여부는 `verifiedAt` 하나로만 말한다(없으면 화면이 「본인인증 전」으로 표시).
 * ★ 2026-10-06 본인인증을 마친 계정의 담당자 이름 = 마지막 인증의 이름(계정 이름은 덮지 않으므로 이력에서 읽는다).
 */
export async function loadIdentitySummary(userId: string): Promise<{
  name: string | null;
  maskedPhone: string | null;
  verifiedAt: string | null;
}> {
  const u = await query(`SELECT name, mfa_phone FROM users WHERE id = $1`, [userId]);
  let verifiedAt: string | null = null;
  let verifiedName: string | null = null;
  try {
    const v = await query(
      `SELECT verified_at, verified_name FROM identity_verifications
        WHERE user_id = $1 AND status = 'verified' ORDER BY verified_at DESC LIMIT 1`,
      [userId]
    );
    verifiedAt = v.rows[0]?.verified_at ? new Date(v.rows[0].verified_at).toISOString() : null;
    verifiedName = v.rows[0]?.verified_name ?? null;
  } catch (err: any) {
    if (!isIdentitySchemaMissing(err)) throw err;
  }
  const row = u.rows[0] || {};
  const registered = !!row.mfa_phone;
  return {
    name: registered ? (verifiedAt && verifiedName ? verifiedName : row.name ?? null) : null,
    maskedPhone: registered ? maskPhone(row.mfa_phone) : null,
    verifiedAt,
  };
}
