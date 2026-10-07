/**
 * ★ 2026-10-07 (Harold) 지정 계정 감시 알림 — 사무실 밖 로그인 · 두 곳 동시 접속 → 대표 번호로만 문자.
 *   「오직 내 번호로만 · 서팀장까지 나가면 안 된다」 · 감시 기록 화면 = ceo 만 · 로그인을 절대 막지 않는다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const h = vi.hoisted(() => ({ sent: [] as any[], audits: [] as any[], loginCount: 1 }));
vi.mock('../system-alert', () => ({ sendSystemAlert: vi.fn(async (p: any) => { h.sent.push(p); return 1; }) }));
vi.mock('../audit-log', () => ({ recordAuditLog: vi.fn(async (a: any) => { h.audits.push(a); }) }));
vi.mock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [{ n: h.loginCount, prev_at: null }] })) }));

import { handleWatchEvent, parseKisaWhois, isOffHours, watchAlertPhones, isWatchedLoginId } from '../watch-alert';
import { PERMISSION_MATRIX } from '../admin-role';

beforeEach(() => {
  h.sent = []; h.audits = []; h.loginCount = 1;
  delete process.env.WATCH_ALERT_PHONES; delete process.env.WATCH_LOGIN_IDS; delete process.env.WATCH_OFFICE_IPS;
});

describe('받는 번호 = 대표 번호만', () => {
  it('기본 = 대표 번호 하나 · 서팀장 번호 없음', () => {
    expect(watchAlertPhones()).toEqual(['01052958517']);
    expect(watchAlertPhones()).not.toContain('01030635257');
  });
  it('알림은 언제나 번호를 명시해서 보낸다(운영자 공용 번호로 넘어가지 않는다)', async () => {
    await handleWatchEvent({ kind: 'login', userId: 'u1', loginId: 'psy5868', ip: '::2' });
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].phones).toEqual(['01052958517']);
  });
  it('번호를 비워 두면 아무에게도 안 간다(공용으로 새지 않는다)', async () => {
    process.env.WATCH_ALERT_PHONES = '';
    await handleWatchEvent({ kind: 'login', userId: 'u1', loginId: 'psy5868', ip: '::2' });
    expect(h.sent[0].phones).toEqual([]);
  });
});

describe('판정', () => {
  it('대상 아닌 계정 = 아무것도 안 함 · 사무실 로그인 = 문자 없음', async () => {
    await handleWatchEvent({ kind: 'login', userId: 'u2', loginId: 'someone', ip: '::2' });
    await handleWatchEvent({ kind: 'login', userId: 'u1', loginId: 'PSY5868', ip: '::ffff:180.226.236.94' });
    expect(h.sent).toHaveLength(0);
    expect(isWatchedLoginId('PSY5868')).toBe(true);
  });
  it('사무실 밖 로그인 = 처음 보는 IP 표시 · 두 번째부터는 횟수', async () => {
    await handleWatchEvent({ kind: 'login', userId: 'u1', loginId: 'psy5868', ip: '::2' });
    expect(h.sent[0].details.join('\n')).toContain('처음 보는 IP');
    h.loginCount = 7;
    await handleWatchEvent({ kind: 'login', userId: 'u1', loginId: 'psy5868', ip: '::3' });
    expect(h.sent[1].details.join('\n')).toContain('이 IP 7번째');
  });
  it('동시 접속 = 사무실 안이어도 보낸다 · 양쪽 IP · 기록에 상대 IP', async () => {
    await handleWatchEvent({ kind: 'takeover', userId: 'u1', loginId: 'psy5868', ip: '::ffff:180.226.236.94', otherIp: '::9' });
    expect(h.sent).toHaveLength(1);
    const body = h.sent[0].details.join('\n');
    expect(body).toContain('새 접속: 180.226.236.94');
    expect(body).toContain('기존 접속: ::9');
    expect(h.audits[0]).toMatchObject({ action: 'watch_alert', details: { kind: 'takeover', otherIp: '::9' } });
  });
  it('업무 시간 밖 = 평일 09~19시 밖 · 주말', () => {
    expect(isOffHours(new Date('2026-10-08T01:00:00Z'))).toBe(false); // 목 10:00 KST
    expect(isOffHours(new Date('2026-10-08T13:00:00Z'))).toBe(true);  // 목 22:00 KST
    expect(isOffHours(new Date('2026-10-10T03:00:00Z'))).toBe(true);  // 토 12:00 KST
  });
});

describe('IP 주인 = 가장 좁은 할당의 기관명', () => {
  it('통신사가 회사에 내준 회선이면 그 회사', () => {
    const t = ['IPv4주소           : 61.72.0.0 - 61.75.255.255 (/14)', '기관명             : 주식회사 케이티', '주소               : 경기도 성남시',
      'IPv4주소           : 61.74.181.32 - 61.74.181.63 (/27)', '기관명             : (주)한화63시티', '네트워크 구분      : CUSTOMER', '주소               : 서울특별시 서초구 강남대로 311'].join('\n');
    expect(parseKisaWhois(t)).toEqual({ org: '(주)한화63시티', kind: 'CUSTOMER', address: '서울특별시 서초구 강남대로 311' });
    expect(parseKisaWhois('nothing')).toBeNull();
  });
});

describe('배선 · 화면', () => {
  const back = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');
  it('로그인 · 인계 · 충돌 세 자리에서 기다리지 않고 부른다', () => {
    const li = back('utils/login-issue.ts');
    expect(li.match(/void handleWatchEvent\(/g)?.length).toBe(3);
    expect(li).toContain('takenOverIp: rotate.liveIp ?? null');
  });
  it('감시 기록 = ceo 만(대표 등급만 · 지원팀장 닫힘)', () => {
    expect(back('utils/audit-log.ts')).toContain("isSuperAdminAllowed(superAdminId, 'WATCH_VIEWER_IDS', 'ceo', 'watch-log', 'watchLog')");
    expect(PERMISSION_MATRIX.find((r) => r.key === 'watchLog')?.levels).toEqual({ super: 'R', lead: 'NONE', support: 'NONE' });
  });
});
