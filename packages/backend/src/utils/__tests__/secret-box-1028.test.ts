/**
 * 몰 연동 자격 암호화 CT(★ 2026-10-28 자사몰 대비 K8 · M34) — 행동 시험
 * 왕복 · 평문 그대로 읽기(읽기 이중) · 다른 키 = 빈 값 · meta 는 비밀 키만 · 키 없음 = 평문 쓰기 · 웹훅 칸 길이 판정
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const q = vi.fn(async (..._a: any[]) => ({ rows: [] as any[] }));
vi.mock('../../config/database', () => ({ query: (...a: any[]) => (q as any)(...a) }));

const KEY = 'ab'.repeat(32);
const load = async (key: string | undefined) => {
  vi.resetModules();
  if (key === undefined) delete process.env.CDP_SECRET_BOX_KEY;
  else process.env.CDP_SECRET_BOX_KEY = key;
  return import('../secret-box');
};

beforeEach(() => { q.mockReset(); q.mockImplementation(async () => ({ rows: [] })); });

describe('secret-box', () => {
  it('왕복 · 같은 평문도 매번 다른 암호문(iv) · 평문 · 빈 값 · 이미 암호문 = 그대로', async () => {
    const b = await load(KEY);
    const s1 = b.sealSecret('cs_live_secret');
    const s2 = b.sealSecret('cs_live_secret');
    expect(s1.startsWith('enc:v1:')).toBe(true);
    expect(s1).not.toBe(s2);
    expect(b.openSecret(s1)).toBe('cs_live_secret');
    expect(b.openSecret('plain-old')).toBe('plain-old');
    expect(b.sealSecret('')).toBe('');
    expect(b.sealSecret(null)).toBe(null);
    expect(b.sealSecret(s1)).toBe(s1);
  });
  it('다른 키 · 깨진 암호문 · 키 없음 = 던진다(빈 값으로 읽어 플랫폼 공용 자격으로 넘어가지 않게 · Codex R1 #1)', async () => {
    const sealed = (await load(KEY)).sealSecret('x');
    const other = await load('cd'.repeat(32));
    expect(() => other.openSecret(sealed)).toThrow(other.SecretUnreadableError);
    expect(() => other.openSecret('enc:v1:AAAA')).toThrow(other.SecretUnreadableError);
    const none = await load(undefined);
    expect(() => none.openSecret(sealed)).toThrow(/키 없음/);
    expect(none.openSecret('plain')).toBe('plain');
  });
  it('키 없음 · 꼴 틀림 = 평문 그대로 쓴다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await load(undefined)).sealSecret('t')).toBe('t');
    expect((await load('short')).sealSecret('t')).toBe('t');
  });
  it('meta = 비밀 키만 암호화 · 나머지 그대로', async () => {
    const b = await load(KEY);
    const m = b.sealMetaSecrets({ woo_consumer_key: 'ck', woo_consumer_secret: 'cs', godo_key: 'gk', app_client_secret: 'as', woo_site_url: 'https://x/', id_prefix: 'x:' });
    for (const k of b.SECRET_META_KEYS) expect(b.isSealed((m as any)[k]), k).toBe(true);
    expect(m.woo_site_url).toBe('https://x/');
    expect(m.id_prefix).toBe('x:');
    expect(b.openMetaSecrets(m)).toEqual({ woo_consumer_key: 'ck', woo_consumer_secret: 'cs', godo_key: 'gk', app_client_secret: 'as', woo_site_url: 'https://x/', id_prefix: 'x:' });
  });
  it('webhook_secret 칸: varchar(100) = 안 담김(평문 유지) · text = 담김 · 키 없음 = 안 봄', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let b = await load(KEY);
    q.mockResolvedValueOnce({ rows: [{ len: 100 }] });
    expect(await b.webhookSecretColumnFitsSealed()).toBe(false);
    b = await load(KEY);
    q.mockResolvedValueOnce({ rows: [{ len: null }] });
    expect(await b.webhookSecretColumnFitsSealed()).toBe(true);
    expect(b.sealSecret('a'.repeat(64)).length).toBeLessThan(160);
    b = await load(undefined);
    expect(await b.webhookSecretColumnFitsSealed()).toBe(false);
    expect(q).toHaveBeenCalledTimes(2);
  });
});
