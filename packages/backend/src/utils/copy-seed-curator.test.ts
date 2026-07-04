import { describe, it, expect } from 'vitest';
import { gateSeedText } from './copy-seed-curator';

// ★ 2026-07-04 재설계: 휴리스틱 채굴(selectSeedCandidates) 폐기 → 저장 게이트(gateSeedText) 검증으로 교체.
//   게이트 = 탈색(deBrand) → 길이 → 누출 → 스팸. 직접 입력·AI 채굴 승인 공용 단일 진입.
describe('copy-seed-curator gateSeedText', () => {
  it('브랜드 대괄호·전화번호 탈색 후 통과, 탈색본 반환', () => {
    const r = gateSeedText('[A몰] 지금 신메뉴 나왔어요 매장에서 확인하세요 문의 1600-0000');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.text.includes('A몰')).toBe(false);
      expect(r.text.includes('1600')).toBe(false);
      expect(r.text.includes('신메뉴')).toBe(true);
    }
  });
  it('탈색 후 12자 미만 저가치 문안은 too_short', () => {
    const r = gateSeedText('[브랜드] 010-1234-5678');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('too_short');
  });
  it('스팸 위험 표현 다수 문안은 spam', () => {
    const r = gateSeedText('무료 대출 당첨 지금 바로 신청 대박 찬스 100% 보장 완전 무료!!!');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('spam');
  });
  it('이메일 포함 문안도 탈색 후 식별자 잔존 없음', () => {
    const r = gateSeedText('문의는 abc@x.com 로 연락 주시고 이번 주말 신상 입고 확인하세요');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text.includes('@')).toBe(false);
  });
});
