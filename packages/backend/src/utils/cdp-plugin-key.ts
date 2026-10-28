/**
 * ★ CT: 플러그인 키 (★ 2026-10-28 자사몰 대비 K8 · 결정 D9 · 불변 I10 · 결함 M14)
 *
 * 워드프레스 플러그인이 쓰는 키 = **몰 하나(연동 행) · 회원 토큰 발급만**. 옛 1.0.2 는 회사 전권 CDP 비밀키를 워드프레스마다 저장했다
 * (같은 키로 회원 쓰기 · 주문 쓰기 · 일괄 적재 · 아무 회원의 토큰 발급이 다 됐다 · 워드프레스 한 곳이 털리면 회사 전체).
 *
 * 형식 = `pk_v1.<연동 행 id>.<판>.<서명 base64url>` · 서명 = HMAC-SHA256(ENV CDP_PLUGIN_KEY_SECRET, `<행 id>|<판>`).
 *   판 = 연동 행 meta.plugin_key_ver(없으면 1) · 새로 발급 = 판 + 1(옛 키는 그 순간 무효).
 *   비밀값은 JWT_SECRET 과 따로 둔다(ENV-1) · 없거나 32자 미만이면 발급 503 · 검증 거짓.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { UserFacingError } from './http-error';

const PREFIX = 'pk_v1';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function secret(): string | null {
  const s = String(process.env.CDP_PLUGIN_KEY_SECRET || '').trim();
  return s.length >= 32 ? s : null;
}

function mac(s: string, integrationId: string, ver: number): Buffer {
  return createHmac('sha256', s).update(`${integrationId}|${ver}`).digest();
}

const b64url = (buf: Buffer): string => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** 연동 행 meta 의 판(정수 1 이상 · 없거나 꼴 밖 = 1) */
export function pluginKeyVersionOf(meta: unknown): number {
  const v = Number((meta as any)?.plugin_key_ver);
  return Number.isInteger(v) && v >= 1 ? v : 1;
}

export function issuePluginKey(integrationId: string, ver: number): string {
  const s = secret();
  if (!s) throw new UserFacingError(503, 'PLUGIN_KEY_UNAVAILABLE', '플러그인 키를 만들 수 없어요. 잠시 후 다시 시도해 주세요.');
  return `${PREFIX}.${integrationId}.${ver}.${b64url(mac(s, integrationId, ver))}`;
}

/** 키의 행 id(서명 검증 전 · 행을 찾는 데만 쓴다) · 꼴 밖 = null */
export function pluginKeyIntegrationId(key: unknown): string | null {
  if (typeof key !== 'string') return null;
  const p = key.trim().split('.');
  return p.length === 4 && p[0] === PREFIX && UUID_RE.test(p[1]) ? p[1] : null;
}

/** 이 키가 그 행 · 그 판의 키인가(판이 다르면 = 새로 발급된 뒤의 옛 키 = 거짓) */
export function verifyPluginKey(key: unknown, integrationId: string, currentVer: number): boolean {
  const s = secret();
  if (!s || typeof key !== 'string') return false;
  const p = key.trim().split('.');
  if (p.length !== 4 || p[0] !== PREFIX || p[1] !== integrationId || p[2] !== String(currentVer)) return false;
  const expected = Buffer.from(b64url(mac(s, integrationId, currentVer)));
  const given = Buffer.from(p[3]);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
