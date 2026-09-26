/**
 * DM 룰렛 재고 경품 = 발송 링크로 확인된 수신자만 (★2026-09-26 한줄로 V2 R1-27 · Harold 결정 「발송 링크 수신자만」)
 *
 * 옛: 공개 링크 참여자는 1인 1회 키가 화면이 보내는 anonymous_id라, 값을 바꿔 가며 돌리면 경품 재고(dm_prizes.remaining)를 비울 수 있었다.
 * 처방: 재고가 걸린 칸은 발송 토큰(서버 권위)으로 확인된 참여자만 당첨 대상. 그 밖의 참여자는 경품이 없는 칸 중에서만 고른다
 *   (경품 칸에 멈추고 꽝으로 나오는 혼란 없음 · 경품 칸뿐이면 "발송받은 분만" 결과). 전화번호 입력은 확인 수단이 아니다(누구 번호든 넣을 수 있다).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { pickRouletteForParticipant } from '../dm/dm-interaction-core';

const segs = [
  { id: 'a', label: '커피', probability: 50 },
  { id: 'b', label: '다음 기회에', probability: 50 },
];
const prizes = { a: { prizeId: 'p1', remaining: 10 } };

describe('pickRouletteForParticipant', () => {
  it('확인된 수신자는 종전과 같다(경품 칸 당첨 가능)', () => {
    const r = pickRouletteForParticipant(segs, prizes, true, () => 0.1);
    expect(r).toMatchObject({ segmentId: 'a', won: true, prizeId: 'p1' });
  });
  it('확인되지 않은 참여자는 경품 없는 칸에서만(재고 차감 없음)', () => {
    const r = pickRouletteForParticipant(segs, prizes, false, () => 0.1);
    expect(r).toMatchObject({ segmentId: 'b', won: false, prizeId: null });
  });
  it('경품 칸뿐이면 recipientsOnly 결과', () => {
    const r = pickRouletteForParticipant([segs[0]], prizes, false, () => 0.1);
    expect(r).toMatchObject({ won: false, prizeId: null, recipientsOnly: true });
  });
});

describe('배선', () => {
  const src = readFileSync(join(__dirname, '..', 'dm', 'dm-interaction.ts'), 'utf8');
  it('토큰으로 확인됐을 때만 재고 대상 · 룰렛 추첨이 그 값을 쓴다', () => {
    expect(src).toContain('tokenVerified = true;');
    expect(src).toContain('pickRouletteForParticipant(segments, prizeBySegment, stockEligible, Math.random)');
    expect(src).toContain('runRouletteDraw(companyId, campaignId, input.sectionId, responseId, props, customerId, input.phone, input.data, tokenVerified)');
  });
});

describe('뷰어', () => {
  const viewer = readFileSync(join(__dirname, '..', 'dm', 'dm-viewer.ts'), 'utf8');
  it('recipients_only 결과는 돌리지 않고 안내한다', () => {
    expect(viewer).toContain('if (spin && spin.recipients_only) { showMsg(box,');
  });
});
