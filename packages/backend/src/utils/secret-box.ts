/**
 * ★ CT: 몰 연동 자격 암호화(★ 2026-10-28 자사몰 대비 K8 · M34)
 *
 * AES-256-GCM · 저장 꼴 = `enc:v1:` + base64(iv 12 · tag 16 · 암호문). 키 = ENV CDP_SECRET_BOX_KEY(32바이트 · hex 64자 또는 base64).
 * 범위 = company_integrations 의 access_token · refresh_token · webhook_secret + meta 비밀 키(SECRET_META_KEYS).
 * 읽기 이중 = 접두가 있으면 풀고 없으면 평문 그대로(배포 → 키 넣기 → DML-2 다시 쓰기 순서 · 그 사이 두 꼴이 섞여도 돈다).
 * 키가 없으면 쓰기 = 평문 그대로(부팅 경고) · 읽기 = 암호문을 풀 수 없으면 던진다(SecretUnreadableError · 빈 값으로 읽어 다른 자격으로 넘어가지 않게 · Codex R1 #1).
 * ⛔ 암호문이 생긴 뒤에는 이 파일이 없는 판으로 코드를 되돌리지 않는다(설계서 §5 되돌림 최저판) · 키는 지우지 않는다.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { query } from '../config/database';

const PREFIX = 'enc:v1:';

/** meta 안 비밀 키 — 우커머스 REST 키 · 고도몰 쇼핑몰 키 · 카페24 BYO · 메이크샵 · 네이버 앱 비밀 */
export const SECRET_META_KEYS = ['woo_consumer_key', 'woo_consumer_secret', 'godo_key', 'app_client_secret'] as const;

let cachedKey: Buffer | null | undefined;
function boxKey(): Buffer | null {
  if (cachedKey !== undefined) return cachedKey;
  const raw = String(process.env.CDP_SECRET_BOX_KEY || '').trim();
  const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : raw ? Buffer.from(raw, 'base64') : null;
  cachedKey = buf && buf.length === 32 ? buf : null;
  if (raw && !cachedKey) console.error('[secret-box] CDP_SECRET_BOX_KEY 꼴이 맞지 않아 쓰지 않습니다(32바이트 · hex 64자 또는 base64) · 자격은 평문으로 남습니다');
  return cachedKey;
}

export const isSealed = (v: unknown): boolean => typeof v === 'string' && v.startsWith(PREFIX);
export const secretBoxReady = (): boolean => boxKey() !== null;

/** 평문 → 암호문(키 없음 · 빈 값 · 이미 암호문 = 그대로) */
export function sealSecret<T extends string | null | undefined>(v: T): T {
  if (typeof v !== 'string' || !v || isSealed(v)) return v;
  const k = boxKey();
  if (!k) return v;
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', k, iv);
  const enc = Buffer.concat([c.update(v, 'utf8'), c.final()]);
  return (PREFIX + Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64')) as T;
}

/** 암호문을 풀 수 없다(키 없음 · 다른 키 · 깨짐) — 빈 값으로 읽지 않는다(Codex R1 #1 · 빈 값이면 호출부가 「자격 없음」으로 보고 플랫폼 공용 자격으로 넘어갔다) */
export class SecretUnreadableError extends Error {
  constructor(reason: string) {
    super(`암호화된 몰 연동 자격을 풀지 못했습니다(키 확인 · CDP_SECRET_BOX_KEY): ${reason}`);
    this.name = 'SecretUnreadableError';
  }
}

/** 암호문 → 평문(평문 = 그대로) · 풀 수 없으면 던진다(fail-closed) */
export function openSecret<T extends string | null | undefined>(v: T): T {
  if (!isSealed(v)) return v;
  const k = boxKey();
  if (!k) throw new SecretUnreadableError('키 없음');
  try {
    const b = Buffer.from((v as string).slice(PREFIX.length), 'base64');
    const d = createDecipheriv('aes-256-gcm', k, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8') as T;
  } catch (err: any) {
    throw new SecretUnreadableError(String(err?.message || err));
  }
}

/** meta 의 비밀 키만 암호화(나머지 키 · 값은 그대로 · 새 객체) */
export function sealMetaSecrets<T extends object>(meta: T): T {
  const out: Record<string, unknown> = { ...(meta as Record<string, unknown>) };
  for (const k of SECRET_META_KEYS) if (typeof out[k] === 'string') out[k] = sealSecret(out[k] as string);
  return out as T;
}

/** meta 의 비밀 키만 풀기(새 객체) */
export function openMetaSecrets<T extends object>(meta: T): T {
  const out: Record<string, unknown> = { ...((meta || {}) as Record<string, unknown>) };
  for (const k of SECRET_META_KEYS) if (typeof out[k] === 'string') out[k] = openSecret(out[k] as string);
  return out as T;
}

/**
 * webhook_secret 칸이 암호문(약 131자)을 담을 수 있는가 — DDL-2(varchar(100) → text) 전에는 평문 유지 + 경고(설계서 §3 DDL-2).
 * 10분마다 다시 본다(DDL 뒤 재기동 없이 열린다).
 */
let fitsAt = 0;
let fits = false;
let fitsWarned = false;
export async function webhookSecretColumnFitsSealed(): Promise<boolean> {
  if (!secretBoxReady()) return false;
  if (Date.now() - fitsAt < 10 * 60 * 1000) return fits;
  const r = await query(
    `SELECT character_maximum_length AS len FROM information_schema.columns
      WHERE table_name = 'company_integrations' AND column_name = 'webhook_secret'`,
  );
  const len = r.rows[0]?.len;
  fits = r.rows.length > 0 && (len == null || Number(len) >= 160);
  fitsAt = Date.now();
  if (!fits && !fitsWarned) {
    fitsWarned = true;
    console.warn('[secret-box] company_integrations.webhook_secret 칸이 짧아(DDL-2 전) 웹훅 비밀은 평문으로 둡니다');
  }
  return fits;
}

/** 부팅 경고 — 키가 없으면 자격이 평문으로 남는다 */
export function warnIfSecretBoxKeyMissing(): void {
  if (!secretBoxReady()) console.warn('[secret-box] CDP_SECRET_BOX_KEY 없음 — 몰 연동 자격을 평문으로 저장합니다(읽기는 두 꼴 모두)');
}
