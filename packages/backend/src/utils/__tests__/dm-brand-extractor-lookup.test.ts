/**
 * [B-0905-1] 고정 IP lookup 콜백 계약 — Node 20 autoSelectFamily(`{ all: true }`)에는 배열을, 옛 호출에는 (address, family)를 돌려준다.
 * 배경: 옛 형태만 돌려주던 콜백이 ERR_INVALID_IP_ADDRESS를 내 fetchHtmlGuarded가 전 사이트 null(운영 실측 2026-09-05).
 * 네트워크 0 · DB 0.
 */
import { describe, it, expect } from 'vitest';
import { pinnedLookup } from '../dm/dm-brand-extractor';

describe('pinnedLookup (B-0905-1)', () => {
  const pinned = { address: '104.18.30.11', family: 4 };

  it('{ all: true }(Node 20 autoSelectFamily)에는 주소 배열을 돌려준다', () => {
    let got: any[] = [];
    pinnedLookup(pinned)('www.example.com', { all: true, family: 0 }, (...args: any[]) => { got = args; });
    expect(got[0]).toBeNull();
    expect(Array.isArray(got[1])).toBe(true);
    expect(got[1]).toEqual([{ address: '104.18.30.11', family: 4 }]);
  });

  it('옛 호출(all 없음)에는 (address, family)를 돌려준다', () => {
    let got: any[] = [];
    pinnedLookup(pinned)('www.example.com', { family: 4 }, (...args: any[]) => { got = args; });
    expect(got).toEqual([null, '104.18.30.11', 4]);
  });

  it('options가 없어도 옛 형태로 답한다(공허 통과 방지)', () => {
    let got: any[] = [];
    pinnedLookup(pinned)('www.example.com', undefined, (...args: any[]) => { got = args; });
    expect(got).toEqual([null, '104.18.30.11', 4]);
  });
});
