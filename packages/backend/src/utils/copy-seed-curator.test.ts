import { describe, it, expect } from 'vitest';
import { selectSeedCandidates } from './copy-seed-curator';

describe('copy-seed-curator selectSeedCandidates', () => {
  it('베스트 순으로 탈색·중복제거 후 상위 N 반환', () => {
    const rows = [
      { final_message: '[A몰] 지금 신메뉴 나왔어요 매장에서 확인하세요 문의 1600-0000', final_source: 'selected_as_is', spam_blocked: 0 },
      { final_message: '이번 주말 전 품목 할인 지금 바로 신청하세요', final_source: 'edited', spam_blocked: 0 },
    ];
    const out = selectSeedCandidates(rows, 5);
    expect(out.some((t) => t.includes('신메뉴') && !t.includes('A몰') && !t.includes('1600'))).toBe(true);
    expect(out.some((t) => t.includes('할인'))).toBe(true);
  });
  it('스팸 이력·스팸 위험 후보는 시드에서 제외', () => {
    const rows = [
      { final_message: '오늘 신상 입고 지금 매장에서 확인하세요', final_source: 'edited', spam_blocked: 0 },
      { final_message: '무료 대출 당첨 지금 바로 신청 대박 찬스', final_source: 'manual', spam_blocked: 3 },
    ];
    const out = selectSeedCandidates(rows, 5);
    expect(out.some((t) => t.includes('신상'))).toBe(true);
    expect(out.some((t) => t.includes('대출'))).toBe(false);
  });
  it('탈색 후 식별자(이메일) 잔존 없음 + 저가치 제외', () => {
    const rows = [{ final_message: '문의는 abc@x.com 로 연락 주시고 지금 바로 신청하세요', final_source: 'manual', spam_blocked: 0 }];
    const out = selectSeedCandidates(rows, 5);
    expect(out.length).toBe(1);
    expect(out.every((t) => !t.includes('@'))).toBe(true);
  });
});
