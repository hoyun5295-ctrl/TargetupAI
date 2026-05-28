import { describe, it, expect, beforeEach } from 'vitest';
import { getAnonymousId, getSessionId, clearSession } from '../storage';

describe('Auto-Capture storage (anonymous_id + session_id)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('getAnonymousId() 첫 호출 시 신규 UUID 발급 + localStorage 보존', () => {
    const id = getAnonymousId();
    expect(id).toMatch(/^anon_[a-f0-9-]{36}$/);
    expect(localStorage.getItem('hjl_anon_id')).toBe(id);
  });

  it('getAnonymousId() 두 번째 호출 시 같은 ID 반환', () => {
    const id1 = getAnonymousId();
    const id2 = getAnonymousId();
    expect(id1).toBe(id2);
  });

  it('getSessionId() 첫 호출 시 신규 UUID + 30분 TTL 보존', () => {
    const id = getSessionId();
    expect(id).toMatch(/^sess_[a-f0-9-]{36}$/);
    const raw = sessionStorage.getItem('hjl_session_id');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.id).toBe(id);
    expect(parsed.expires).toBeGreaterThan(Date.now());
    expect(parsed.expires).toBeLessThanOrEqual(Date.now() + 30 * 60 * 1000);
  });

  it('getSessionId() 30분 경과 시 신규 ID 발급', () => {
    const id1 = getSessionId();
    const expired = { id: id1, expires: Date.now() - 1000 };
    sessionStorage.setItem('hjl_session_id', JSON.stringify(expired));
    const id2 = getSessionId();
    expect(id2).not.toBe(id1);
  });

  it('clearSession() 호출 시 sessionStorage 안 영역 영구 제거', () => {
    getSessionId();
    clearSession();
    expect(sessionStorage.getItem('hjl_session_id')).toBeNull();
  });
});
