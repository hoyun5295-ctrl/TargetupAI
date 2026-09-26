/**
 * 거래내역서 메일 재시도 — 메일만 실패해 추적행이 남은 장을 그 행으로 다시 보낸다 (★2026-09-26 한줄로 V2 R1-46)
 *
 * 적재 단계가 "이미 나갔거나 살아 있는 추적행이 있으면 건너뜀"이라, 첫 메일이 실패해 추적행만 남은 장은
 * 재시도(retryUnsentConfirmations)의 발송 목록(claimed)에 들어가지 않았다. 2단계는 claimed만 보내므로
 * [메일 재시도]를 눌러도 그 장은 영원히 안 나갔다(주석 "남은 행이 곧 재시도 목록"과 코드가 달랐다).
 *
 * 못 박는 것
 *   1. 발송 표시(emailed_at)가 있으면 그대로 건너뛴다(중복 발송 없음).
 *   2. 발송 표시가 없고 살아 있는 추적행이 manual_wait면(한 번도 전달 확정 안 됨) 그 행을 다시 쓴다 —
 *      토큰 유지 · 수신자·참조는 지금 수신자 설정으로 갱신(틀린 주소를 고친 뒤 재시도하면 새 주소로 간다).
 *   3. 그 밖의 상태(전달 확정 뒤 진행된 행)는 건너뛰고 기록만.
 *   4. 동시 재시도는 2단계의 발송 소유권 UPDATE(emailed_at IS NULL)가 한 건만 통과시킨다(기존 자물쇠).
 */
import { describe, it, expect } from 'vitest';
import { isSmtpNotAccepted } from '../billing-recipients';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '..', 'invoice-confirm.ts'), 'utf8');
const claim = src.slice(src.indexOf('1단계: 적재'), src.indexOf('2단계: 전송'));

describe('적재 단계의 추적행 재사용', () => {
  it('발송 표시가 있으면 건너뛴다', () => {
    expect(claim).toMatch(/if \(row\.rows\[0\]\.emailed_at\) \{[\s\S]*?continue;/);
  });

  it('발송 표시 없음 + 살아 있는 추적행 = 그 행을 다시 쓴다(manual_wait만 · 수신자 갱신 · 토큰 유지)', () => {
    const i = claim.indexOf('if (row.rows[0].has_confirmation === true) {');
    expect(i).toBeGreaterThan(-1);
    const blk = claim.slice(i, claim.indexOf('const token = randomBytes(24)', i));
    expect(blk).toContain('UPDATE invoice_confirmations');
    expect(blk).toContain("WHERE billing_id = $1::uuid AND superseded_at IS NULL AND taxbill_status = 'manual_wait'");
    expect(blk).toContain('RETURNING token');
    expect(blk).toMatch(/SET recipient_email = \$2, cc_emails = \$3::text\[\], recipient_user_id = \$4::uuid/);
    expect(blk).toMatch(/claimed\.push\(\{ sheet, name: resolved\.primary\?\.name \?\? null, email, cc: resolved\.cc, token: reuse\.rows\[0\]\.token \}\);/);
    expect(blk).toMatch(/if \(reuse\.rows\.length !== 1\) \{[\s\S]*?continue;/);
  });

  it('발송 소유권(발송 표시)을 메일보다 먼저 커밋하고, 확실한 미발송일 때만 우리가 찍은 표시를 푼다 (Codex 6차 1R·2R high)', () => {
    const send = src.slice(src.indexOf('2단계: 전송'), src.indexOf('summary.sent += 1;', src.indexOf('2단계: 전송')));
    const iClaim = send.indexOf('RETURNING emailed_at::text AS claimed_at');
    const iSmtp = send.indexOf('transporter.sendMail(');
    expect(iClaim).toBeGreaterThan(-1);
    expect(iClaim).toBeLessThan(iSmtp);
    // 발송 동안 트랜잭션·잠금을 쥐지 않는다
    expect(send).not.toContain('pool.connect()');
    expect(send).not.toContain("client.query('BEGIN')");
    // 해제 = 확실한 미발송 분기에서만 · 우리가 찍은 값만
    expect(send).toContain('WHERE id = $1::uuid AND emailed_at = $2::timestamptz');
    // 해제는 확실한 미접수 판정 뒤에만(3R에서 판정 CT로 좁힘)
    const iDefinite = send.indexOf('if (!mailTimedOut && isSmtpNotAccepted(err)) {');
    const iRelease = send.indexOf('SET emailed_at = NULL, emailed_to = NULL');
    expect(iDefinite).toBeGreaterThan(-1);
    expect(iRelease).toBeGreaterThan(iDefinite);
    // 전달 확정은 발송 뒤 따로
    expect(send.indexOf('await markConfirmationDelivered(pool, {')).toBeGreaterThan(iSmtp);
  });

  it('발송 소유권 UPDATE(한 건만 통과)는 그대로다', () => {
    expect(src).toMatch(/UPDATE billings SET emailed_at = NOW\(\)[\s\S]{0,120}emailed_at IS NULL RETURNING emailed_at::text AS claimed_at/);
  });
});

describe('SMTP 미접수 판정 CT (Codex 6차 3R high)', () => {
  it('서버의 명시적 거절(4xx·5xx)은 미접수', () => {
    expect(isSmtpNotAccepted({ code: 'EMESSAGE', responseCode: 554, command: 'DATA' })).toBe(true);
    expect(isSmtpNotAccepted({ code: 'EENVELOPE', responseCode: 550, command: 'RCPT TO' })).toBe(true);
    expect(isSmtpNotAccepted({ responseCode: 421 })).toBe(true);
  });
  it('본문 전송 전 명령 단계 실패는 미접수(타임아웃이어도 · CONN 제외)', () => {
    expect(isSmtpNotAccepted({ code: 'ESOCKET', command: 'STARTTLS' })).toBe(true);
    expect(isSmtpNotAccepted({ code: 'EAUTH', command: 'AUTH PLAIN' })).toBe(true);
    expect(isSmtpNotAccepted({ code: 'EDNS' })).toBe(true);
    expect(isSmtpNotAccepted({ code: 'ECONNECTION', command: 'MAIL FROM' })).toBe(true);
  });
  it('우리가 판정한 대표 수신자 거부는 미접수(종전 규칙)', () => {
    expect(isSmtpNotAccepted(Object.assign(new Error('x'), { recipientRejected: true }))).toBe(true);
  });
  it('본문 뒤 타임아웃·소켓 단절·알 수 없음은 불확정(false)', () => {
    expect(isSmtpNotAccepted({ code: 'ETIMEDOUT', command: 'DATA' })).toBe(false);
    // ★ Codex 6차 4R — nodemailer는 본문 뒤 소켓 타임아웃·단절도 command='CONN'으로 보고한다 → 불확정
    expect(isSmtpNotAccepted({ code: 'ETIMEDOUT', command: 'CONN' })).toBe(false);
    expect(isSmtpNotAccepted({ code: 'ESOCKET', command: 'CONN' })).toBe(false);
    expect(isSmtpNotAccepted({ code: 'ECONNECTION', command: 'CONN' })).toBe(false);
    expect(isSmtpNotAccepted({ code: 'ESOCKET' })).toBe(false);
    expect(isSmtpNotAccepted({ code: 'ECONNECTION' })).toBe(false);
    expect(isSmtpNotAccepted(new Error('boom'))).toBe(false);
    expect(isSmtpNotAccepted(undefined)).toBe(false);
  });
});

describe('발송 실패 분기 (Codex 6차 3R high)', () => {
  const send = src.slice(src.indexOf('2단계: 전송'), src.indexOf('summary.sent += 1;', src.indexOf('2단계: 전송')));
  it('표시 해제는 미접수 판정 CT가 참일 때만 · 타이머·그 밖은 불확정(표시 유지)', () => {
    expect(send).toMatch(/if \(!mailTimedOut && isSmtpNotAccepted\(err\)\) \{/);
    const iDef = send.indexOf('if (!mailTimedOut && isSmtpNotAccepted(err)) {');
    const iRel = send.indexOf('SET emailed_at = NULL, emailed_to = NULL');
    expect(iRel).toBeGreaterThan(iDef);
  });
  it('대표 수신자 거부는 표시를 달고 던진다', () => {
    expect(send).toContain('throw Object.assign(new Error(`대표 수신자가 메일 서버에서 거부되었습니다 (${email})`), { recipientRejected: true });');
  });
});

