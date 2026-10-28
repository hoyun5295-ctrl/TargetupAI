/**
 * 플러그인 키 · 플러그인 회원 번호 (★ 2026-10-28 자사몰 대비 K8 · D9 · K4 검증 수정 10)
 *   1. 키 = 몰 하나 · 판 — 다른 행 · 다른 판 · 위조 서명 · 비밀값 없음 = 거짓
 *   2. 회원 번호 = 그 행의 고정 식별자 + 숫자 회원 번호 · 주소는 그 행이 인정하는 호스트(식별자 · 증명 주소)만
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { issuePluginKey, pluginKeyIntegrationId, pluginKeyVersionOf, verifyPluginKey } from '../cdp-plugin-key';
import { wooPluginMemberExternalId } from '../woocommerce-client';

const ROW = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const OTHER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const SECRET = 'plugin-key-secret-for-tests-0123456789';

let saved: string | undefined;
beforeEach(() => { saved = process.env.CDP_PLUGIN_KEY_SECRET; process.env.CDP_PLUGIN_KEY_SECRET = SECRET; });
afterEach(() => { if (saved === undefined) delete process.env.CDP_PLUGIN_KEY_SECRET; else process.env.CDP_PLUGIN_KEY_SECRET = saved; });

describe('플러그인 키 = 몰 하나 · 판', () => {
  it('발급한 키는 그 행 · 그 판에서만 맞다', () => {
    const k = issuePluginKey(ROW, 1);
    expect(pluginKeyIntegrationId(k)).toBe(ROW);
    expect(verifyPluginKey(k, ROW, 1)).toBe(true);
    expect(verifyPluginKey(k, ROW, 2)).toBe(false);     // 새로 발급된 뒤의 옛 키
    expect(verifyPluginKey(k, OTHER, 1)).toBe(false);   // 다른 몰 행
  });
  it('서명을 바꾸거나 · 다른 행 id 로 갈아 끼우거나 · 꼴이 틀리면 거짓', () => {
    const k = issuePluginKey(ROW, 1);
    const [p, , v, sig] = k.split('.');
    expect(verifyPluginKey(`${p}.${ROW}.${v}.${sig.slice(0, -2)}AA`, ROW, 1)).toBe(false);
    expect(verifyPluginKey(`${p}.${OTHER}.${v}.${sig}`, OTHER, 1)).toBe(false);
    for (const bad of ['', 'sk_live_x', `pk_v1.${ROW}.1`, `pk_v2.${ROW}.1.${sig}`, 42, null]) {
      expect(verifyPluginKey(bad, ROW, 1)).toBe(false);
    }
    expect(pluginKeyIntegrationId(`pk_v1.not-a-uuid.1.${sig}`)).toBeNull();
  });
  it('비밀값이 없거나 짧으면 발급 503 · 검증 거짓(JWT_SECRET 으로 대신하지 않는다)', () => {
    const k = issuePluginKey(ROW, 1);
    process.env.CDP_PLUGIN_KEY_SECRET = 'short';
    process.env.JWT_SECRET = SECRET;
    expect(() => issuePluginKey(ROW, 1)).toThrow(/플러그인 키를 만들 수 없어요/);
    expect(verifyPluginKey(k, ROW, 1)).toBe(false);
  });
  it('판 = meta.plugin_key_ver(정수 1 이상) · 없거나 꼴 밖 = 1', () => {
    expect(pluginKeyVersionOf({ plugin_key_ver: 3 })).toBe(3);
    for (const m of [null, {}, { plugin_key_ver: 0 }, { plugin_key_ver: '2x' }, { plugin_key_ver: 1.5 }]) expect(pluginKeyVersionOf(m)).toBe(1);
  });
});

describe('플러그인 회원 번호 = 그 행의 고정 식별자 + 숫자 번호 · 인정 호스트만', () => {
  const integ = { mallId: 'lensgogo.co.kr', seenHosts: ['lensgogo.com'] };
  it('식별자 호스트 · 증명 주소(도메인 이전) 모두 고정 식별자로 만든다', () => {
    expect(wooPluginMemberExternalId(integ, 'lensgogo.co.kr', '15')).toBe('lensgogo.co.kr:15');
    expect(wooPluginMemberExternalId(integ, 'www.lensgogo.com', 15)).toBe('lensgogo.co.kr:15');
  });
  it('인정 밖 호스트 · 숫자가 아닌 번호 · 0 · 빈 값 = null', () => {
    expect(wooPluginMemberExternalId(integ, 'evil.example', '15')).toBeNull();
    for (const u of ['abc', '0', '', '15; drop', '-3', null, undefined]) expect(wooPluginMemberExternalId(integ, 'lensgogo.co.kr', u)).toBeNull();
    expect(wooPluginMemberExternalId(integ, undefined, '15')).toBeNull();
  });
});
