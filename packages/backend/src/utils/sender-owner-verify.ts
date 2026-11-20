/**
 * sender-owner-verify.ts — 기타명의 무선 발신번호의 명의자 본인인증 CT (★ 2026-11-20 C148 T3 · 박성용 접수)
 *   설계서 = docs/2026-11-20-c148-staff-tickets-three-design.md §3
 *
 * 무엇을 하나
 *   직원 · 외부 관계자 명의 휴대폰을 발신번호로 신청할 때, 그 번호의 명의자가 본인인증(KMC)을 하고
 *   인증한 번호 = 신청 번호여야 접수된다. 인증이 준 중복가입 확인값(DI)의 해시로 같은 회사 안 1인 3회선을 센다.
 *
 * ⛔ 로그인 본인인증과 섞지 않는다(★ 설계 Codex 1R #1)
 *   로그인 본인인증 표(로그인 관문 · 최초 인증 판정 · 담당자 요약 · 슈퍼 현황이 목적을 가리지 않고 읽는다)에는
 *   읽기 · 쓰기 0 — 이 기능의 인증 건은 전용 표(sender_owner_verifications)에만 있다. 계정의 담당자 번호도 건드리지 않는다.
 *   같이 쓰는 것 = 인증기관 구현(`resolveIdentityProvider` · KMC buildStart · verify 는 DB 무접촉 · 요청번호 = 인증 건 번호 대조) ·
 *   복귀 창(`/api/auth/identity/return`) · 화면 팝업 통로.
 *
 * ⛔ 본인인증 한 건 = 신청 한 건(신청 칸 부분 유일 인덱스) · 인증한 계정 · 회사 = 신청 계정 · 회사 · 인증 뒤 30분 안.
 */
import crypto from 'crypto';
import type { Request } from 'express';
import pool from '../config/database';
import { resolveIdentityProvider, normalizeVerifiedName, normalizeVerifiedPhone, IDENTITY_TICKET_TTL_MINUTES, type VerifiedIdentity } from './identity-verify';
import { maskPhone } from './mfa';
import { maskPersonName } from './pii-masking';
import { normalizePhone } from './normalize-phone';

/** 인증을 마친 뒤 신청까지 쓸 수 있는 시간(분) */
export const SENDER_OWNER_VERIFY_FRESH_MINUTES = 30;

type Run = (sql: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }>;

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export type SenderOwnerStart =
  | { status: 'started'; verificationId: string; provider: string; start: Record<string, any> }
  | { status: 'unavailable' };

/**
 * 인증 시작 — 그 계정의 옛 대기 행을 접고 새 대기 행(10분)을 만든 뒤 인증기관 시작 값을 돌려준다.
 * 인증기관 호출은 트랜잭션 밖(외부 호출을 잠금 안에 두지 않는다).
 */
export async function startSenderOwnerVerification(params: { userId: string; companyId: string; req: Request }): Promise<SenderOwnerStart> {
  const provider = resolveIdentityProvider();
  if (!provider) return { status: 'unavailable' };
  const client = await pool.connect();
  let verificationId: string;
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE sender_owner_verifications SET status = 'superseded' WHERE user_id = $1::uuid AND status = 'pending'`, [params.userId]);
    const ins = await client.query(
      `INSERT INTO sender_owner_verifications (id, company_id, user_id, status, provider, created_at, expires_at)
       VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 'pending', $3, NOW(), NOW() + INTERVAL '1 minute' * $4)
       RETURNING id`,
      [params.companyId, params.userId, provider.name, IDENTITY_TICKET_TTL_MINUTES],
    );
    await client.query('COMMIT');
    verificationId = String(ins.rows[0].id);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* 원 오류 우선 */ }
    throw err;
  } finally {
    client.release();
  }
  const start = await provider.buildStart({ verificationId, req: params.req });
  return { status: 'started', verificationId, provider: provider.name, start };
}

export type SenderOwnerCompletion =
  | { status: 'verified'; verificationId: string; maskedName: string; maskedPhone: string; phone: string }
  | { status: 'rejected'; reason: 'provider' | 'invalid_identity' | 'no_dup_key'; detail?: string }
  | { status: 'expired' }
  | { status: 'unavailable' };

/**
 * 인증 완료 — 인증기관 결과 확인(이 인증 건의 요청에서 나온 것인지까지 = 인증기관 구현의 계약) → 대기 행 확정(한 문장 ·
 *   그 계정 · 그 회사 · 대기 · 미만료 · 그 인증기관) · 계정 행 · 로그인 본인인증 표 무접촉.
 * DI 가 없으면 사람을 셀 수 없어 받지 않는다.
 */
export async function completeSenderOwnerVerification(params: {
  userId: string; companyId: string; verificationId: string; payload: any; req: Request;
}): Promise<SenderOwnerCompletion> {
  const provider = resolveIdentityProvider();
  if (!provider) return { status: 'unavailable' };
  let identity: VerifiedIdentity;
  try {
    identity = await provider.verify(params.payload, { verificationId: params.verificationId, req: params.req });
  } catch (err: any) {
    console.error('[sender-owner-verify] 인증기관 결과 확인 실패:', err?.code || err?.message);
    const detail = /^[A-Z][A-Z0-9_]{2,59}$/.test(String(err?.message || '')) ? String(err.message) : undefined;
    return detail ? { status: 'rejected', reason: 'provider', detail } : { status: 'rejected', reason: 'provider' };
  }
  const name = normalizeVerifiedName(identity?.name);
  const phone = normalizeVerifiedPhone(identity?.phone);
  if (!name || !phone) return { status: 'rejected', reason: 'invalid_identity' };
  const dupKey = String(identity?.dupKey ?? '').trim();
  if (!dupKey) return { status: 'rejected', reason: 'no_dup_key' };
  const r = await pool.query(
    `UPDATE sender_owner_verifications
        SET status = 'verified', verified_name = $4, verified_phone = $5, dup_key_hash = $6, provider_tx_id = $7, verified_at = NOW()
      WHERE id = $1::uuid AND user_id = $2::uuid AND company_id = $3::uuid AND status = 'pending' AND provider = $8 AND expires_at > NOW()
      RETURNING id`,
    [params.verificationId, params.userId, params.companyId, name, phone, sha256(dupKey),
      identity.providerTxId ? String(identity.providerTxId).slice(0, 120) : null, provider.name],
  );
  if (r.rows.length === 0) return { status: 'expired' };
  return { status: 'verified', verificationId: String(r.rows[0].id), maskedName: maskPersonName(name), maskedPhone: maskPhone(phone), phone };
}

/** 인증 건 번호 꼴(UUID) — 아니면 조회하지 않는다 */
export function isOwnerVerificationId(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

/**
 * 신청 트랜잭션 안에서 인증 건을 잠그고 쓸 수 있는지 본다(접수 = createRegistration).
 *   이 계정 · 이 회사 · verified · 30분 안 · DI 있음 · 인증 번호 = 신청 번호. 재사용은 신청 칸 유일 인덱스가 막는다.
 */
/** 신청이 쓸 수 없는 인증 건 — 화면은 코드(OWNER_VERIFY_ 로 시작)로 「다시 인증」을 가른다(문장 글자 판정 0 · 뿌리 R11) */
export type OwnerVerifyRefusal = { ok: false; code: 'OWNER_VERIFY_REQUIRED' | 'OWNER_VERIFY_NOT_FOUND' | 'OWNER_VERIFY_STALE' | 'OWNER_VERIFY_NO_DUP' | 'OWNER_VERIFY_PHONE_MISMATCH'; error: string };

export async function lockOwnerVerificationForApply(run: Run, p: { verificationId: unknown; userId: string; companyId: string; phone: string }):
  Promise<{ ok: true; dupHash: string } | OwnerVerifyRefusal> {
  if (!isOwnerVerificationId(p.verificationId)) return { ok: false, code: 'OWNER_VERIFY_REQUIRED', error: '번호 명의자의 휴대폰 본인인증을 먼저 해 주세요.' };
  const r = await run(
    `SELECT status, user_id, company_id, verified_phone, dup_key_hash, (verified_at >= NOW() - INTERVAL '1 minute' * $2) AS fresh
       FROM sender_owner_verifications WHERE id = $1::uuid FOR UPDATE`,
    [p.verificationId, SENDER_OWNER_VERIFY_FRESH_MINUTES],
  );
  const v = r.rows[0];
  if (!v || String(v.user_id) !== String(p.userId) || String(v.company_id) !== String(p.companyId) || v.status !== 'verified') {
    return { ok: false, code: 'OWNER_VERIFY_NOT_FOUND', error: '본인인증 결과를 찾지 못했어요. 휴대폰 본인인증을 다시 해 주세요.' };
  }
  if (v.fresh !== true) return { ok: false, code: 'OWNER_VERIFY_STALE', error: `본인인증 뒤 ${SENDER_OWNER_VERIFY_FRESH_MINUTES}분이 지났어요. 휴대폰 본인인증을 다시 해 주세요.` };
  if (!v.dup_key_hash) return { ok: false, code: 'OWNER_VERIFY_NO_DUP', error: '본인인증 결과에 명의자 확인값이 없어요. 휴대폰 본인인증을 다시 해 주세요.' };
  if (normalizePhone(String(v.verified_phone || '')) !== normalizePhone(String(p.phone || ''))) {
    return { ok: false, code: 'OWNER_VERIFY_PHONE_MISMATCH', error: '본인인증한 휴대폰 번호와 신청한 발신번호가 달라요. 신청할 번호의 명의자가 그 번호로 인증해 주세요.' };
  }
  return { ok: true, dupHash: String(v.dup_key_hash) };
}

/** 같은 회사 · 같은 명의자의 접수 · 승인을 한 줄로 세우는 트랜잭션 잠금(셈과 INSERT/승인이 같은 트랜잭션) */
export async function lockOwnerLine(run: Run, companyId: string, dupHash: string): Promise<void> {
  await run(`SELECT pg_advisory_xact_lock(hashtext('sender-owner:' || $1::text || ':' || $2::text))`, [companyId, dupHash]);
}

/** 슈퍼관리자 신청 상세 — 명의자 본인인증 줄(없으면 null · 표 · 칸 전이면 null) */
export async function loadOwnerVerificationView(verificationId: unknown, phone: string): Promise<{
  maskedName: string; maskedPhone: string; phoneMatches: boolean; verifiedAt: string | null;
} | null> {
  if (!isOwnerVerificationId(verificationId)) return null;
  const r = await pool.query(
    `SELECT verified_name, verified_phone, verified_at FROM sender_owner_verifications WHERE id = $1::uuid AND status = 'verified'`,
    [verificationId],
  );
  const v = r.rows[0];
  if (!v) return null;
  return {
    maskedName: maskPersonName(v.verified_name),
    maskedPhone: maskPhone(String(v.verified_phone || '')),
    phoneMatches: normalizePhone(String(v.verified_phone || '')) === normalizePhone(String(phone || '')),
    verifiedAt: v.verified_at ? new Date(v.verified_at).toISOString() : null,
  };
}
