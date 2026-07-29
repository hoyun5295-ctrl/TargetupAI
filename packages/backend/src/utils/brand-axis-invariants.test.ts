/**
 * 브랜드메시지 축 불변식 — 2026-07-29 신설 (Codex 적대검증 4건의 재발 차단)
 *
 * 이번 사고 부류는 전부 하나다: **같은 발송을 보는 두 지점이 서로 다른 기준을 쓴다.**
 *   · 일자 집계는 `BRAND`인데 상세 집계는 `KAKAO` → 축 대조가 발행을 422로 막는다
 *   · 집계 WHERE는 `kakao`/`both`인데 전용 발송은 `kakao_brand` → 그 발송이 통째로 0건
 *   · 유틸은 `brand`로 차감하는데 라우트는 `KAKAO`로 차감 → 계약과 다른 단가가 움직인다
 *
 * 런타임 테스트로는 안 잡힌다(DB·게이트웨이가 있어야 한다). 그래서 소스를 스캔한다 —
 * `unit-price-invariants.test.ts`와 같은 방식이고, 그 파일이 생긴 이유도 같다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { BRAND_CAMPAIGN_CHANNELS, BRAND_CHANNEL_SQL_IN, isBrandOnlyChannel } from './billing-types';

const read = (rel: string) => readFileSync(join(__dirname, rel), 'utf8');

describe('브랜드 채널 판정 — 단일 기준', () => {
  it('전용 발송 채널(kakao_brand)이 집계 대상에 들어 있다', () => {
    // 빠지면 POST /brand-send 발송이 일자·상세 양쪽에서 0건이 된다.
    expect(BRAND_CAMPAIGN_CHANNELS).toContain('kakao_brand');
    expect(BRAND_CAMPAIGN_CHANNELS).toContain('kakao');
    expect(BRAND_CAMPAIGN_CHANNELS).toContain('both');
    for (const c of BRAND_CAMPAIGN_CHANNELS) expect(BRAND_CHANNEL_SQL_IN).toContain(`'${c}'`);
  });

  it('both는 전량 브랜드가 아니다 — 문자분은 message_type으로 차감된다', () => {
    expect(isBrandOnlyChannel('kakao')).toBe(true);
    expect(isBrandOnlyChannel('kakao_brand')).toBe(true);
    expect(isBrandOnlyChannel('both')).toBe(false);
    expect(isBrandOnlyChannel('sms')).toBe(false);
    expect(isBrandOnlyChannel(null)).toBe(false);
  });
});

describe('집계 두 축이 같은 기준을 쓴다 (소스 스캔)', () => {
  const agg = read('./send-usage-aggregation.ts');

  // ★ 2026-07-29 부정·개수 검사에서 **긍정 검사로 바꿨다**(Codex 적대검증 수용).
  //   그 전에는 `bump\(dayData,[^)]*'KAKAO'` 로 잡으려 했는데 `[^)]*`가 `toDayKey(...)`의
  //   닫는 괄호에서 끊겨, 일자축을 KAKAO로 되돌려도 통과했다 — 막으려던 회귀를 정확히 통과시켰다.
  //   개수 검사도 무력했다: 단가 게이트에 쓰이는 'BRAND'가 따로 있어 한 arm이 회귀해도 총합이 유지된다.

  it('일자축 브랜드 bump 2곳이 모두 BRAND다', () => {
    const brandBumps = agg.match(/bump\(dayData, toDayKey\(row\.send_date\), 'BRAND',/g) || [];
    expect(brandBumps.length).toBe(2);   // 캠페인 arm + 직접발송 arm
    // 되돌아간 형태가 하나라도 있으면 즉시 실패한다.
    expect(agg).not.toMatch(/bump\(dayData, toDayKey\(row\.send_date\), 'KAKAO',/);
  });

  it('상세축 IMC 행의 유형키가 BRAND다', () => {
    const detailKeys = agg.match(/typeKey: 'BRAND'/g) || [];
    expect(detailKeys.length).toBe(1);   // addImcRows 공용 헬퍼 한 곳
    expect(agg).not.toContain("typeKey: 'KAKAO'");
  });

  it('브랜드 채널 조건 4곳이 모두 공유 목록을 쓴다', () => {
    // 일자축 2 + 상세축 2. 하나라도 리터럴로 되돌아가면 그 지점만 kakao_brand를 놓친다.
    const shared = agg.match(/IN \(\$\{BRAND_CHANNEL_SQL_IN\}\)/g) || [];
    expect(shared.length).toBe(4);
  });

  it('브랜드 채널을 리터럴로 다시 적은 곳이 없다 — equality와 IN 둘 다', () => {
    expect(agg).not.toMatch(/send_channel\s*=\s*'(kakao|kakao_brand|both)'/);
    // `IN ('kakao','both')` 처럼 목록을 손으로 적은 형태도 막는다(앞 정규식이 놓치던 형태).
    expect(agg).not.toMatch(/send_channel\s+IN\s*\(\s*'/);
  });
});

describe('차감·환불이 브랜드 축을 쓴다 (소스 스캔)', () => {
  it('브랜드 전용 유틸이 kakao로 차감하지 않는다', () => {
    const bm = read('./brand-message.ts');
    expect(bm).not.toMatch(/prepaid(Deduct|Refund)\([^)]*'kakao'/);
  });

  it('캠페인 라우트가 채널 리터럴로 차감 유형을 정하지 않는다', () => {
    const camp = read('../routes/campaigns.ts');
    // `sendChannel === 'kakao' ? 'KAKAO'` 같은 판정이 되살아나면 유틸과 라우트가 갈라진다.
    expect(camp).not.toMatch(/(sendChannel|directChannel)\s*===\s*'kakao'\s*\?/);
  });
});
