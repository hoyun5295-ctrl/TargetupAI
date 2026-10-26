/**
 * 대행발송 스위치 = 스팸 검사 · 대행발송 문 (★2026-10-26 Harold)
 *
 * 경위(Harold 1026): 「대행 업체들은 요금제를 쓰는 애들이 아닌데 스팸필터 테스트를 하게 하려고 무료체험을 계속 반복해서 줬다」.
 *   운영 실측 1026 = 대행 스위치가 켜진 4곳(idlook · kumkang · paulaschoice · shiseido)이 체험 2회씩 · 스팸 검사 23~178건.
 *   스팸 검사 문 = 요금제 칸(spam_filter_enabled) · 대행발송 문 = 스위치 AND 유료 요금제라, 미가입 대행 업체는 체험 없이는 둘 다 막혔다.
 *
 * 못 박는 것:
 *   1. 대행발송 = 스위치만 보면 된다(요금제 무관) · 정지 · 만료 상태는 지금처럼 막는다.
 *   2. 스팸 검사가 열린 회사 = 요금제 칸 OR 대행 스위치 — 판정 조각은 plan-guard 한 곳(뿌리 대장 R1). 주소 · 체험 횟수 · AI 한줄 · 화면 요금제 정보가 같은 조각을 쓴다.
 *   3. 청구는 그대로 — 체험(무료 3회)만 청구에서 빠지고, 열린 회사의 검사는 지금 체험 요금제 회사처럼 일반 검사로 잡힌다.
 */
import { describe, it, expect } from 'vitest';
import { canUseAgencySend, SPAM_FILTER_OPEN_SQL, PLAN_STATUS_SELECT_EXPR } from '../plan-guard';

const ctx = (over: Record<string, any>) => ({ planCode: 'FREE', subscriptionStatus: null, agencySendEnabled: false, ...over }) as any;

describe('canUseAgencySend — 대행발송 문 = 스위치(★1026)', () => {
  it('★ 미가입(FREE)이라도 스위치가 켜지면 열린다 — 체험을 줄 이유가 없어진다', () => {
    expect(canUseAgencySend(ctx({ planCode: 'FREE', agencySendEnabled: true }))).toBe(true);
  });
  it('스위치가 꺼져 있으면 유료 요금제라도 닫힌다(슈퍼관리자가 연 회사만)', () => {
    expect(canUseAgencySend(ctx({ planCode: 'STARTER', subscriptionStatus: 'paid', agencySendEnabled: false }))).toBe(false);
    expect(canUseAgencySend(ctx({ planCode: 'FREE', agencySendEnabled: false }))).toBe(false);
  });
  it('정지 · 만료 상태는 스위치가 켜져도 닫힌다(지금과 같다)', () => {
    expect(canUseAgencySend(ctx({ agencySendEnabled: true, subscriptionStatus: 'suspended' }))).toBe(false);
    expect(canUseAgencySend(ctx({ agencySendEnabled: true, subscriptionStatus: 'expired' }))).toBe(false);
  });
  it('회사를 못 읽으면 닫힌다', () => {
    expect(canUseAgencySend(null)).toBe(false);
  });
});

describe('스팸 검사 문 = 요금제 칸 OR 대행 스위치 — 판정 조각 한 곳(★1026 · 뿌리 대장 R1)', () => {
  it('조각이 두 축을 OR 로 본다 · 스위치 칸이 없던 DB 에서도 깨지지 않게 to_jsonb 로 읽는다', () => {
    expect(SPAM_FILTER_OPEN_SQL).toMatch(/p\.spam_filter_enabled/);
    expect(SPAM_FILTER_OPEN_SQL).toMatch(/\bOR\b/);
    expect(SPAM_FILTER_OPEN_SQL).toMatch(/to_jsonb\(c\) ->> 'agency_send_enabled'/);
  });
  it('요금제 상태 조회(loadPlanContext)의 spam_filter_enabled 가 그 조각이다', () => {
    expect(PLAN_STATUS_SELECT_EXPR).toContain(`${SPAM_FILTER_OPEN_SQL} AS spam_filter_enabled`);
  });

  // 요금제 칸을 직접 읽는 SQL 0 · 모든 읽기가 이 조각 = root-ledger.test.ts 「R1 넓힘(1026)」(소스에서 기계로 뽑는다)
});
