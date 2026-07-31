/**
 * 거래내역서 구분 칸 라벨 계약 테스트 (★ 2026-07-31 — 서수란 접수)
 *
 * 이 표는 고객사가 청구서로 지점을 나눠 재청구하는 근거다. 라벨이 갈리면 청구 대조가 깨지므로
 * PDF·상세 모달·화면이 **같은 함수**를 쓰는 것이 계약이고, 그 함수의 판정을 여기서 고정한다.
 */
import { describe, it, expect } from 'vitest';
import { resolveBillingScopeLabel, BILLING_SCOPE_FALLBACK } from './billing-scope-label';

describe('resolveBillingScopeLabel — 구분 칸 단일 판정', () => {
  it('웹 행은 계정명을 쓴다 (지점 재청구의 근거 — 이게 없어서 접수됐다)', () => {
    expect(resolveBillingScopeLabel({ channel: 'web', user_name: '강남점' })).toBe('강남점');
  });

  it('웹 행에 이름이 없으면 로그인 ID, 둘 다 없으면 채널 기본 라벨', () => {
    expect(resolveBillingScopeLabel({ channel: 'web', user_login_id: 'gangnam' })).toBe('gangnam');
    expect(resolveBillingScopeLabel({ channel: 'web' })).toBe('한줄로');
  });

  it('에이전트는 `발송ID / 발급명`, 발급명 없으면 발송ID만', () => {
    expect(resolveBillingScopeLabel({ channel: 'agent', agent_send_id: 'B0082', cust_name: '금강제화' }))
      .toBe('B0082 / 금강제화');
    expect(resolveBillingScopeLabel({ channel: 'agent', agent_send_id: 'B0082' })).toBe('B0082');
  });

  it('에이전트인데 발송ID가 없으면 빈 칸이 아니라 정직한 표시', () => {
    expect(resolveBillingScopeLabel({ channel: 'agent' })).toBe('(발송ID 미상)');
  });

  it('테스트·스팸은 성격 + 계정 (계정만 찍으면 왜 청구되는지 안 읽힌다)', () => {
    expect(resolveBillingScopeLabel({ channel: 'test', user_name: '강남점' })).toBe('테스트 · 강남점');
    expect(resolveBillingScopeLabel({ channel: 'spam', user_name: '강남점' })).toBe('스팸필터 · 강남점');
    // 계정이 없으면 성격만
    expect(resolveBillingScopeLabel({ channel: 'test' })).toBe('테스트');
  });

  it('요금제·추가 항목은 계정 축이 없다 — 계정명이 실려 와도 채널 라벨을 유지한다', () => {
    expect(resolveBillingScopeLabel({ channel: 'plan', user_name: '강남점' })).toBe('요금제');
    expect(resolveBillingScopeLabel({ channel: 'extra', user_name: '강남점' })).toBe('추가 항목');
  });

  it('★ extra 행이 원문 노출되지 않는다 (화면 폴백 맵에 키가 없어 `extra`가 그대로 찍히던 결함)', () => {
    expect(resolveBillingScopeLabel({ channel: 'extra' })).toBe('추가 항목');
    expect(BILLING_SCOPE_FALLBACK.extra).toBe('추가 항목');
  });

  it('channel 미지정 = web으로 본다 (기존 저장 행 하위호환)', () => {
    expect(resolveBillingScopeLabel({})).toBe('한줄로');
    expect(resolveBillingScopeLabel({ user_name: '강남점' })).toBe('강남점');
  });

  it('공백만 든 이름은 값이 없는 것으로 본다 (빈 칸 렌더 차단)', () => {
    expect(resolveBillingScopeLabel({ channel: 'web', user_name: '   ' })).toBe('한줄로');
    expect(resolveBillingScopeLabel({ channel: 'agent', agent_send_id: 'B1', cust_name: '  ' })).toBe('B1');
  });
});
