/**
 * 발신번호 회선 수 제한 — 전송자격인증 2.1 (★2026-08-18)
 *
 * 못 박는 것:
 *   1. **기존 보유분은 자르지 않는다** — 상한을 이미 넘겨 보유 중이어도 새 등록만 거부된다.
 *   2. 유선/무선을 **나눠서** 센다 — 총합으로 세면 한쪽 축의 위반이 통과한다.
 *   3. 개인·외국인은 기준값 고정(무선 3/2 · 유선 5). 회사 설정으로 못 올린다.
 *   4. 법인은 회사별 설정값. **미설정이면 제한 없음** = 현행 유지.
 *      (0818 실측 — 유선 보유 상위가 182·175·159·117개다. 매장별 대표번호이고 종사자 수 기준으로 정상이다.
 *       여기에 임의 상한을 박으면 매장이 늘 때마다 정상 고객사가 막힌다)
 *   5. 등록 길목 3곳 전부가 게이트를 지난다(소스 불변식).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  isMobileNumber, lineKindOf, resolveLineLimits, evaluateLineAddition,
} from './sender-line-limit';

describe('유선·무선 판별', () => {
  it('이동통신 식별번호는 무선', () => {
    for (const p of ['01052958517', '010-5295-8517', '0115295851', '821052958517']) {
      expect(isMobileNumber(p), p).toBe(true);
    }
  });

  it('대표번호·지역번호·인터넷전화는 유선', () => {
    for (const p of ['1800-8125', '0231452186', '070-1234-5678', '15881234']) {
      expect(isMobileNumber(p), p).toBe(false);
      expect(lineKindOf(p)).toBe('landline');
    }
  });
});

describe('유형별 상한', () => {
  it('개인은 무선 3 · 유선 5 (기준값 고정)', () => {
    expect(resolveLineLimits({ subscriberType: 'individual', mobileLimit: 99, landlineLimit: 99 }))
      .toEqual({ mobile: 3, landline: 5, source: 'standard' });
  });

  it('외국인은 무선 2 · 유선 5', () => {
    expect(resolveLineLimits({ subscriberType: 'foreigner', mobileLimit: null, landlineLimit: null }))
      .toEqual({ mobile: 2, landline: 5, source: 'standard' });
  });

  it('★ 개인·외국인 상한은 회사 설정으로 못 올린다 — 기준이 정한 값이다', () => {
    const limits = resolveLineLimits({ subscriberType: 'individual', mobileLimit: 100, landlineLimit: 100 });
    expect(limits.mobile).toBe(3);
    expect(limits.landline).toBe(5);
  });

  it('법인은 회사별 설정값을 쓴다', () => {
    expect(resolveLineLimits({ subscriberType: 'corporate', mobileLimit: 10, landlineLimit: 300 }))
      .toEqual({ mobile: 10, landline: 300, source: 'company_setting' });
  });

  it('★ 법인 미설정은 제한 없음 — 현행 유지', () => {
    expect(resolveLineLimits({ subscriberType: 'corporate', mobileLimit: null, landlineLimit: null }))
      .toEqual({ mobile: null, landline: null, source: 'unset' });
  });

  it('유형 미설정도 제한 없음 — 배포만으로 아무도 막히지 않는다', () => {
    expect(resolveLineLimits({ subscriberType: null, mobileLimit: null, landlineLimit: null }))
      .toEqual({ mobile: null, landline: null, source: 'unset' });
  });

  it('0·음수·문자는 미설정으로 본다', () => {
    const limits = resolveLineLimits({ subscriberType: 'corporate', mobileLimit: 0, landlineLimit: '많이' });
    expect(limits.mobile).toBeNull();
    expect(limits.landline).toBeNull();
  });
});

describe('신규 등록 판정', () => {
  const CORP = resolveLineLimits({ subscriberType: 'corporate', mobileLimit: 4, landlineLimit: 200 });

  it('상한 안이면 통과', () => {
    const v = evaluateLineAddition({ phone: '01012345678', limits: CORP, currentMobile: 3, currentLandline: 0 });
    expect(v).toEqual({ status: 'ok', kind: 'mobile', current: 3, limit: 4 });
  });

  it('상한에 도달하면 새 등록만 거부한다', () => {
    const v = evaluateLineAddition({ phone: '01012345678', limits: CORP, currentMobile: 4, currentLandline: 0 });
    expect(v.status).toBe('exceeded');
    if (v.status !== 'exceeded') throw new Error('exceeded가 아니다');
    expect(v.message).toContain('4회선');
  });

  it('★ 이미 상한을 넘겨 보유 중이어도 기존 번호를 문제 삼지 않는다 — 새 등록만 막힌다', () => {
    // 무선 58개 보유(수스_대행 실측) · 상한 4 → 새 등록은 거부, 판정 대상은 "추가 1건"뿐이다
    const v = evaluateLineAddition({ phone: '01012345678', limits: CORP, currentMobile: 58, currentLandline: 274 });
    expect(v.status).toBe('exceeded');
    if (v.status !== 'exceeded') throw new Error('exceeded가 아니다');
    expect(v.current).toBe(58); // 보유 수는 그대로 보고될 뿐 삭제 대상이 아니다
  });

  it('★ 유선/무선을 나눠 센다 — 총합으로 세면 한쪽 위반이 통과한다', () => {
    // 유선을 199개 갖고 있어도 무선 상한(4)과는 무관하다
    const v = evaluateLineAddition({ phone: '01012345678', limits: CORP, currentMobile: 0, currentLandline: 199 });
    expect(v.status).toBe('ok');
    expect(v.kind).toBe('mobile');
  });

  it('상한이 없으면 unlimited — 통과지만 "제한 없음"이라는 사실이 구분된다', () => {
    const none = resolveLineLimits({ subscriberType: null, mobileLimit: null, landlineLimit: null });
    const v = evaluateLineAddition({ phone: '021234567', limits: none, currentMobile: 0, currentLandline: 500 });
    expect(v).toEqual({ status: 'unlimited', kind: 'landline', current: 500 });
  });
});

describe('등록 길목 전수 — 게이트가 빠진 곳이 없다', () => {
  const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');

  const PATHS: Array<[string, string]> = [
    ['../routes/admin.ts', '슈퍼관리자 직접 추가'],
    ['../routes/manage-callbacks.ts', '고객사 관리자 추가'],
    ['./sender-registration.ts', '신청 승인'],
  ];

  it.each(PATHS)('%s (%s)가 상한 게이트를 지난다', (path) => {
    expect(read(path)).toMatch(/checkSenderLineLimit\(/);
  });

  it('세 길목 모두 INSERT 전에 판정한다', () => {
    for (const [path] of PATHS) {
      const src = read(path);
      const gate = src.indexOf('checkSenderLineLimit(');
      const insert = src.indexOf('INSERT INTO callback_numbers');
      expect(gate, `${path}: 게이트 호출이 없다`).toBeGreaterThan(-1);
      expect(insert, `${path}: INSERT가 없다`).toBeGreaterThan(-1);
      expect(gate, `${path}: 게이트가 INSERT 뒤에 있다`).toBeLessThan(insert);
    }
  });
});
