/**
 * 야간 광고 발송 제한 계약 (★2026-09-26 한줄로 전수점검 부분 ① F20)
 *
 * 판정이 직접발송 코어 안에만 있어 코어를 거치지 않는 동기 /direct-send 경로(대시보드·AI 운영자·알림톡 창 등)는
 * 21시~08시 광고를 막지 못했다. 판정을 CT로 올리고 두 경로가 같은 함수를 쓰게 했다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { nightAdRestrictionMessage } from '../autosend-policy';

const at = (s: string) => new Date(s + '+09:00');

describe('nightAdRestrictionMessage', () => {
  it('광고 · 즉시 · 21시 이후면 거절 문장', () => {
    const msg = nightAdRestrictionMessage(true, false, null, 8, 21, at('2026-09-25T21:10:00'));
    expect(msg).toContain('광고 발송이 제한됩니다');
  });

  it('광고 · 즉시 · 새벽이면 거절', () => {
    expect(nightAdRestrictionMessage(true, false, null, 8, 21, at('2026-09-25T07:59:00'))).not.toBeNull();
  });

  it('광고 · 주간이면 통과', () => {
    expect(nightAdRestrictionMessage(true, false, null, 8, 21, at('2026-09-25T08:00:00'))).toBeNull();
    expect(nightAdRestrictionMessage(true, false, null, 8, 21, at('2026-09-25T20:59:00'))).toBeNull();
  });

  it('예약이면 예약 시각으로 판정(지금이 밤이어도 예약이 주간이면 통과)', () => {
    const now = at('2026-09-25T23:00:00');
    expect(nightAdRestrictionMessage(true, true, '2026-09-26T10:00:00+09:00', 8, 21, now)).toBeNull();
    expect(nightAdRestrictionMessage(true, true, '2026-09-26T22:00:00+09:00', 8, 21, now)).not.toBeNull();
  });

  it('정보성은 늘 통과', () => {
    expect(nightAdRestrictionMessage(false, false, null, 8, 21, at('2026-09-25T23:00:00'))).toBeNull();
    expect(nightAdRestrictionMessage(undefined, false, null, 8, 21, at('2026-09-25T23:00:00'))).toBeNull();
  });
});

describe('두 경로가 같은 판정을 쓴다', () => {
  const read = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8');

  it('직접발송 코어', () => {
    expect(read('utils/direct-send-core.ts')).toContain('nightAdRestrictionMessage(spec.adEnabled, spec.scheduled, spec.scheduledAt');
  });

  it('동기 /direct-send는 차감보다 먼저 막는다', () => {
    const src = read('routes/campaigns.ts');
    const at0 = src.indexOf("router.post('/direct-send',");
    const route = src.slice(at0, src.indexOf('\nrouter.', at0 + 10));
    const iCheck = route.indexOf('nightAdRestrictionMessage(finalIsAd, scheduled, scheduledAt');
    expect(iCheck).toBeGreaterThan(-1);
    expect(iCheck).toBeLessThan(route.indexOf('prepaidDeduct('));
  });
});
