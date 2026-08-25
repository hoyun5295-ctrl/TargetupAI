/**
 * 대행발송 링크 승인 토큰·문구 계약 (★ 2026-08-25 · Harold "링크 승인부터 진행")
 *
 *   ① 토큰은 접수 id + 담당자 번호에 묶인 서명 토큰이다. 변조·다른 용도 토큰은 열리지 않는다
 *   ② 만료 = 발송 시각 + 24시간과 7일 중 긴 쪽. 발송이 먼 접수도 링크가 먼저 죽지 않는다
 *   ③ 승인 주소는 운영 도메인 규약(HANJUL_BASE_URL 폴백)을 따르고 토큰이 주소에 실린다
 *   ④ 안내 문자에 주소가 실리면 "로그인" 문구 대신 링크 승인 문구가 나간다. 줄표 0
 */
import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  agencyManagerPhones, buildAgencyApproveUrl, signAgencyApproveToken, verifyAgencyApproveToken,
} from '../agency-send-link';
import { buildPassedNotify, buildReapprovalNotify } from '../agency-send-notify';

const REQ = '11111111-2222-3333-4444-555555555555';
const PHONE = '01000001111';

describe('대행발송 링크 승인 — 토큰', () => {
  it('서명한 토큰은 접수 id와 담당자 번호를 그대로 돌려준다', () => {
    const token = signAgencyApproveToken({ requestId: REQ, phone: PHONE, contentVersion: 3, requestedAt: new Date(Date.now() + 4 * 3600 * 1000) });
    const p = verifyAgencyApproveToken(token);
    expect(p).not.toBeNull();
    expect(p!.requestId).toBe(REQ);
    expect(p!.phone).toBe(PHONE);
    expect(p!.contentVersion).toBe(3);
  });

  it('변조된 토큰과 다른 용도의 토큰은 열리지 않는다', () => {
    const token = signAgencyApproveToken({ requestId: REQ, phone: PHONE, contentVersion: 3, requestedAt: new Date() });
    expect(verifyAgencyApproveToken(token.slice(0, -2) + 'xx')).toBeNull();
    // 같은 비밀키로 서명해도 scope가 다르면 승인 토큰이 아니다
    const other = jwt.sign({ scope: 'totp_enroll', r: REQ, p: PHONE }, process.env.JWT_SECRET || 'targetup-jwt-secret-fallback');
    expect(verifyAgencyApproveToken(other)).toBeNull();
    expect(verifyAgencyApproveToken('')).toBeNull();
  });

  it('만료는 발송 시각 + 24시간과 7일 중 긴 쪽이다', () => {
    const now = Date.now();
    // 가까운 발송(4시간 뒤) = 7일 바닥
    const near = signAgencyApproveToken({ requestId: REQ, phone: PHONE, contentVersion: 1, requestedAt: new Date(now + 4 * 3600 * 1000) });
    const nearExp = (jwt.decode(near) as any).exp * 1000;
    expect(nearExp).toBeGreaterThanOrEqual(now + 7 * 24 * 3600 * 1000 - 60 * 1000);
    // 먼 발송(30일 뒤) = 발송 + 24시간까지 산다
    const far = signAgencyApproveToken({ requestId: REQ, phone: PHONE, contentVersion: 1, requestedAt: new Date(now + 30 * 24 * 3600 * 1000) });
    const farExp = (jwt.decode(far) as any).exp * 1000;
    expect(farExp).toBeGreaterThanOrEqual(now + 31 * 24 * 3600 * 1000 - 60 * 1000);
  });

  it('승인 주소는 운영 도메인 아래 /agency-approve로 열리고 토큰을 싣는다', () => {
    const url = buildAgencyApproveUrl(REQ, PHONE, 3, new Date(Date.now() + 4 * 3600 * 1000));
    // fragment(#t=)여야 한다 — 서버·프록시 접근 로그와 Referer에 토큰이 안 남는 운반 형태(적대 2R)
    expect(url.startsWith('https://hanjul.ai/agency-approve#t=')).toBe(true);
    const token = decodeURIComponent(url.split('#t=')[1]);
    expect(verifyAgencyApproveToken(token)?.phone).toBe(PHONE);
  });
});

/**
 * ★Codex 적대 1R 정정 고정 — 발송처(워커)와 승인 권한(공개 라우트·승인 CT)이 **같은 목록 판정**을 쓴다.
 * 규약: 새 컬럼(배열) 우선 · 배열이 비어 있을 때만 옛 컬럼 폴백 · 정규화 · 중복 제거.
 * (공개 라우트가 둘을 항상 합쳐 읽으면, 접수에서 뺀 옛 번호가 계속 승인권을 가진다.)
 */
describe('대행발송 링크 승인 — 담당자 목록 판정 한 벌', () => {
  it('배열이 있으면 배열만 본다(뺀 번호는 옛 컬럼에 남아 있어도 권한이 없다)', () => {
    const row = { manager_phones: ['01000002222'], manager_phone: '01000001111' };
    expect(agencyManagerPhones(row)).toEqual(['01000002222']);
  });
  it('배열이 비어 있을 때만 옛 컬럼으로 폴백한다(배포 전 접수 호환)', () => {
    expect(agencyManagerPhones({ manager_phones: [], manager_phone: '01000001111' })).toEqual(['01000001111']);
    expect(agencyManagerPhones({ manager_phone: '01000001111' })).toEqual(['01000001111']);
  });
  it('정규화·중복 제거·짧은 번호 제외를 한다', () => {
    const row = { manager_phones: ['010-0000-1111', '01000001111', '0100', ''] };
    expect(agencyManagerPhones(row)).toEqual(['01000001111']);
  });
});

describe('대행발송 링크 승인 — 안내 문구', () => {
  const url = 'https://hanjul.ai/agency-approve?t=abc';

  it('주소가 있으면 링크 승인 문구로, 없으면 기존 로그인 문구로 나간다', () => {
    const withLink = buildPassedNotify({ label: '가을 행사', whenText: '8월 29일 14:00', approveUrl: url });
    expect(withLink).toContain(url);
    expect(withLink).toContain('승인하지 않으면 발송되지 않습니다');
    expect(withLink).not.toContain('로그인');
    const noLink = buildPassedNotify({ label: '가을 행사', whenText: '8월 29일 14:00' });
    expect(noLink).toContain('로그인');
  });

  it('재승인 문구도 같은 규약이다', () => {
    const withLink = buildReapprovalNotify({ label: '가을 행사', approveUrl: url });
    expect(withLink).toContain(url);
    expect(withLink).not.toContain('로그인');
  });

  it('문구에 줄표가 없다', () => {
    const dash = String.fromCharCode(0x2014);
    for (const t of [
      buildPassedNotify({ label: '가을 행사', approveUrl: url }),
      buildReapprovalNotify({ label: '가을 행사', approveUrl: url }),
    ]) expect(t.includes(dash)).toBe(false);
  });
});
