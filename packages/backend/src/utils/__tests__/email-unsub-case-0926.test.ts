/**
 * 이메일 수신거부 자동 처리 = 대소문자만 다른 같은 주소 행에도 (★2026-09-26 한줄로 V2 R1-40)
 *
 * 옛: bounce·spam_report·unsubscribe 이벤트가 오면 주소가 정확히 같은 고객 행만 email_opt_in=false.
 *     "A@x.com"으로 거부해도 "a@x.com" 행은 고객DB 발송 경로(행별 안전 필터)에서 계속 받았다.
 * 처방: 쓰기 판정을 읽기(직접 명단 경로 excludeOptedOutEmails = lower 비교)와 같게 lower(email) = lower($2).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '..', 'email-channel.ts'), 'utf8');

describe('이메일 자동 수신거부 매칭', () => {
  it('대소문자 무시(lower) 비교로 모든 같은 주소 행을 거부 처리한다', () => {
    const blk = src.slice(src.indexOf('// customers 자동 처리 — email 매칭 + email_opt_in false'), src.indexOf('// email_events.auto_processed = true 갱신'));
    expect(blk).toContain('AND lower(email) = lower($2)');
    expect(blk).not.toMatch(/AND email = \$2\s/);
  });
});
