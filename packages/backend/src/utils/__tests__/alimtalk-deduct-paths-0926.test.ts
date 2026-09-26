/**
 * 선불 알림톡 차감 경로 전수 — 결과별 정산 단가를 싣는가 (★2026-09-26 한줄로 V2 F01·F04)
 *
 * 알림톡을 선불로 차감하는 경로는 넷이고, 차감 호출부는 셋이다.
 *   알림톡 창 /direct-send/commit · 마케팅 플래너 → createDirectSendCampaign(direct-send-core)
 *   직접 타겟 /direct-send → campaigns.ts
 *   자동발송 알림톡 → auto-campaign-worker (캠페인 행에 send_channel이 없어 자동발송 설정 channel로 판정)
 * 하나라도 빠지면 그 경로의 알림톡 성공분이 문자 단가로 굳는다(정산 스위퍼는 차감 행만 보고 판정한다).
 * 여정(journey-executor)은 처음부터 KAKAO 단가로 차감하므로 대상이 아니다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const deductCalls = (src: string) => src.match(/await prepaidDeduct\([^;]*\);/g) || [];

describe('선불 알림톡 차감 경로가 결과별 정산 단가를 싣는다', () => {
  it('알림톡 창·마케팅 플래너(direct-send-core)', () => {
    const calls = deductCalls(read('direct-send-core.ts'));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("{ alimtalk: directChannel === 'alimtalk' }");
  });

  it('직접 타겟(campaigns.ts /direct-send)', () => {
    const calls = deductCalls(read('../routes/campaigns.ts')).filter((c) => c.includes('directDeductType'));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("{ alimtalk: directChannel === 'alimtalk' }");
  });

  it('자동발송 알림톡(auto-campaign-worker)', () => {
    const calls = deductCalls(read('auto-campaign-worker.ts'));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("{ alimtalk: ac.channel === 'alimtalk' }");
  });
});
