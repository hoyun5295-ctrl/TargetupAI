/**
 * ★ 2026-10-13 B-1013-1 배선 계약 — 분할 첫 회차 시각(resolveSplitFirstSend)을 두 접수 경로가 **같은 자리**에서 부른다.
 *   · 직접발송 commit = utils/direct-send-core.ts : 분할 값 검사(parseSplitSetting) 뒤 · 캠페인 INSERT 앞
 *   · 동기 /direct-send   = routes/campaigns.ts   : 분할 값 검사 뒤 · 발송 기준 시각(directSendBase) 앞
 * 순수 함수 테스트(send-time-util.test.ts)는 계산만 지킨다 — 호출이 빠지면 큐와 캠페인 행이 다시 갈린다. 그래서 자리까지 고정한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8');

describe('B-1013-1 resolveSplitFirstSend 배선', () => {
  it('direct-send-core: 분할 검사 뒤 · 캠페인 INSERT 앞에서 scheduled · scheduledAt 을 정규화한다', () => {
    const src = read('utils/direct-send-core.ts');
    const parseIdx = src.indexOf('parseSplitSetting(spec.splitEnabled');
    const callIdx = src.indexOf('resolveSplitFirstSend({ scheduled: spec.scheduled');
    const insertIdx = src.indexOf('await query(CAMPAIGN_INSERT_SQL');
    expect(parseIdx).toBeGreaterThan(0);
    expect(callIdx).toBeGreaterThan(parseIdx);
    expect(insertIdx).toBeGreaterThan(callIdx);
    // 정규화 결과를 spec 에 다시 싣는다(INSERT · send_config 가 읽는 값)
    expect(src.slice(callIdx, insertIdx)).toMatch(/scheduled:\s*firstSend\.scheduled,\s*scheduledAt:\s*firstSend\.scheduledAt/);
  });

  it('routes/campaigns /direct-send: 분할 검사 뒤 · directSendBase 앞에서 같은 함수로 정규화한다', () => {
    const src = read('routes/campaigns.ts');
    const parseIdx = src.indexOf('const splitParsed = parseSplitSetting(splitEnabled, splitCount, splitIntervalMinutes)');
    const callIdx = src.indexOf('resolveSplitFirstSend({ scheduled, scheduledAt, split })');
    const baseIdx = src.indexOf('const directSendBase = scheduled && scheduledAt');
    expect(parseIdx).toBeGreaterThan(0);
    expect(callIdx).toBeGreaterThan(parseIdx);
    expect(baseIdx).toBeGreaterThan(callIdx);
    // 요청값은 따로 받고(검증 · 야간 광고 판정용) 정규화 값이 이후 경로를 탄다
    expect(src).toMatch(/scheduled:\s*scheduledInput,/);
    expect(src).toMatch(/let scheduled: any = scheduledInput;/);
  });
});
