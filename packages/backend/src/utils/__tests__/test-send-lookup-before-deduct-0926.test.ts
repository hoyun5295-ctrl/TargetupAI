/**
 * 담당자 테스트 발송 — 실패할 수 있는 조회는 차감 전에 (★ 2026-09-26 한줄로 V2 A-06 · CRASH 묶음)
 *
 * `/test-send`가 선불 차감 뒤에 적재 테이블(`getTestSendTable`)·080 번호(`getOpt080Number`)를 조회했다.
 * 둘 중 하나가 던지면 바깥 catch로 빠져 환불 루프를 건너뛰었다(차감만 남는다 · 캠페인 레코드가 없어 스위퍼도 못 본다).
 * 두 조회는 차감과 무관하다 — 차감보다 먼저 하면 던져도 돈이 움직이기 전이다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const src = readFileSync(resolve(__dirname, '../../routes/campaigns.ts'), 'utf8');
const start = src.indexOf("router.post('/test-send'");
const end = src.indexOf('router.', start + 10);
const route = src.slice(start, end > start ? end : undefined);

describe('테스트 발송 조회 순서', () => {
  it('라우트를 찾는다', () => {
    expect(start).toBeGreaterThan(-1);
    expect(route).toContain('prepaidDeduct(');
  });
  it('적재 테이블 조회가 첫 차감보다 앞이다', () => {
    expect(route.indexOf('await getTestSendTable()')).toBeGreaterThan(-1);
    expect(route.indexOf('await getTestSendTable()')).toBeLessThan(route.indexOf('prepaidDeduct('));
  });
  it('080 번호 조회가 첫 차감보다 앞이다', () => {
    expect(route.indexOf('getOpt080Number(')).toBeGreaterThan(-1);
    expect(route.indexOf('getOpt080Number(')).toBeLessThan(route.indexOf('prepaidDeduct('));
  });
});
