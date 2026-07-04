import { describe, it, expect } from 'vitest';
import { jaccard3, EXAMPLE_SIMILARITY_MAX } from './best-copy-assets';

// ★ 2026-07-04 원문의 벽 — 재창작 예시가 시드 원문과 닮지 않았는지 검사하는 가드.
describe('best-copy-assets jaccard3 (유사도 가드)', () => {
  it('동일 문안 = 1.0 (게시 차단 대상)', () => {
    const t = '이번 주말 전 품목 특별 혜택 지금 바로 매장에서 확인하세요';
    expect(jaccard3(t, t)).toBe(1);
    expect(jaccard3(t, t) >= EXAMPLE_SIMILARITY_MAX).toBe(true);
  });
  it('부분 복사(문장 절반 이상 동일)는 임계 이상 — 차단', () => {
    const seed = '봄 신상품이 입고되었습니다 이번 주까지 방문하시면 특별한 혜택을 드려요 지금 예약하세요';
    const copyish = '봄 신상품이 입고되었습니다 이번 주까지 방문하시면 특별한 혜택을 드려요 서두르세요';
    expect(jaccard3(seed, copyish) >= EXAMPLE_SIMILARITY_MAX).toBe(true);
  });
  it('주제만 같고 새로 쓴 문안은 임계 미만 — 통과', () => {
    const seed = '봄 신상품이 입고되었습니다 이번 주까지 방문하시면 특별한 혜택을 드려요 지금 예약하세요';
    const fresh = 'OO뷰티 고객님 환절기 피부가 신경 쓰이시죠 신제품 라인을 만나보세요 혜택은 [직접 작성해주세요]';
    expect(jaccard3(seed, fresh) < EXAMPLE_SIMILARITY_MAX).toBe(true);
  });
  it('빈 문자열 = 0', () => {
    expect(jaccard3('', '아무 문안')).toBe(0);
  });
});
