// replaces: none
/**
 * 스팸 확인 판 재작성(C164 · ★ 2026-11-26 · 설계서 docs/2026-11-25-spam-diag-rewrite-design.md §6-2) — 표현 판 계약
 *   AI 에는 고칠 줄만 간다(수신자 값이 든 줄 · 법정 줄은 바깥 요청에 실리지 않는다) · 돌아온 줄은 보낸 글의 그 자리에 넣는다 ·
 *   숫자가 사라진 다듬기는 버린다(대행 다듬기 루프도 같은 검사).
 */
import { describe, it, expect } from 'vitest';
import { checkRefined, refineForSpam } from '../agency-send-refine';
import { swappableUrls } from '../spam-link-swap';

const COMPANY = '00000000-0000-0000-0000-0000000000aa';
const SENT = '(광고) 하늘몰\n겨울 혜택 안내\n김하늘 고객님께\n전 품목 35% 할인\n무료 수신거부 080-000-0000';
const EDITABLE = [1, 3];

describe('swappableUrls — 바꿀 수 있는 주소(설계서 §7)', () => {
  const TEXT = [
    '(광고) 하늘몰 https://fixed.example/a',
    '보러 가기 https://tinyurl.example/zz9.',
    '짧게 tinyurl.example/zz9',
    '이미 줄인 주소 https://hlj.kr/Ab12cd https://app.hanjul.ai/c/Ab12cdEf',
    '한 번 더 (https://tinyurl.example/zz9) http://shop.example/sale?x=1',
    '안쪽 주소 http://192.168.0.1/a https://user:pw@shop.example/b',
  ].join('\n');

  it('고칠 줄 속 http(s) 주소만 · 문장 끝 부호는 뗀다 · 같은 주소는 한 번 · 한줄로 주소 · 스킴 없는 주소 · 내부 주소 · 인증 정보는 대상이 아니다', () => {
    const editable = [1, 2, 3, 4, 5].map((n) => ({ sentLine: n, tplLine: n - 1 }));
    expect(swappableUrls(TEXT, editable)).toEqual(['https://tinyurl.example/zz9', 'http://shop.example/sale?x=1']);
  });

  it('고정 줄의 주소는 대상이 아니다', () => {
    expect(swappableUrls(TEXT, [{ sentLine: 2, tplLine: 0 }])).toEqual([]);
    expect(swappableUrls(TEXT, [])).toEqual([]);
  });
});

describe('checkRefined ⑤ 사라진 숫자', () => {
  it('혜택 숫자 · 이번 달 조건을 지운 다듬기는 버린다', () => {
    expect(checkRefined('겨울 행사\n전 품목 35% OFF', '겨울 행사\n전 품목 세일')).toEqual({ ok: false, reason: 'number-lost:35' });
    expect(checkRefined('11월 회원 한정 행사', '회원 한정 행사')).toEqual({ ok: false, reason: 'number-lost:11' });
  });

  it('표기만 바뀐 숫자는 통과', () => {
    expect(checkRefined('겨울 행사\n전 품목 35% OFF', '겨울 행사\n전 품목 35퍼센트 OFF')).toEqual({ ok: true });
  });
});

describe('refineForSpam editable — 고칠 줄만 보내고 제자리에 넣는다', () => {
  it('바깥 요청에는 고칠 줄만(수신자 값 줄 · 광고 줄 · 수신거부 줄 0) · 결과 = 그 줄만 바뀐 보낸 글', async () => {
    const seen: string[] = [];
    const r = await refineForSpam({
      companyId: COMPANY, original: SENT, round: 1, editable: EDITABLE,
      callModel: async (system, user) => { seen.push(system, user); return { text: '[1] 겨울 소식 안내\n[2] 전 품목 35% 세일', inputTokens: 10, outputTokens: 10 }; },
    });
    expect(r).toEqual({ ok: true, content: '(광고) 하늘몰\n겨울 소식 안내\n김하늘 고객님께\n전 품목 35% 세일\n무료 수신거부 080-000-0000' });
    expect(seen[1]).toContain('[1] 겨울 혜택 안내');
    expect(seen[1]).toContain('[2] 전 품목 35% 할인');
    for (const s of seen) {
      expect(s).not.toContain('김하늘');
      expect(s).not.toContain('하늘몰');
      expect(s).not.toContain('080-000-0000');
    }
  });

  it('피할 표현은 고칠 줄 요청에 함께 간다', async () => {
    let user = '';
    await refineForSpam({
      companyId: COMPANY, original: SENT, round: 1, editable: EDITABLE, avoid: ['혜택'],
      callModel: async (_s, u) => { user = u; return { text: '[1] 겨울 소식 안내\n[2] 전 품목 35% 세일', inputTokens: 1, outputTokens: 1 }; },
    });
    expect(user).toContain('혜택');
  });

  it('번호 · 줄 수가 어긋난 답은 버린다', async () => {
    const run = (text: string) => refineForSpam({ companyId: COMPANY, original: SENT, round: 1, editable: EDITABLE, callModel: async () => ({ text, inputTokens: 1, outputTokens: 1 }) });
    expect(await run('[1] 겨울 소식 안내')).toEqual({ ok: false, reason: 'line-mismatch' });
    expect(await run('[1] 겨울 소식 안내\n[2] 전 품목 35% 세일\n[3] 덧붙인 줄')).toEqual({ ok: false, reason: 'line-mismatch' });
    expect(await run('[1] 겨울 소식 안내\n[1] 전 품목 35% 세일')).toEqual({ ok: false, reason: 'line-mismatch' });
    expect(await run('겨울 소식 안내\n전 품목 35% 세일')).toEqual({ ok: false, reason: 'line-mismatch' });
  });

  it('숫자를 지운 답은 버린다(보낸 글 전체 기준)', async () => {
    const r = await refineForSpam({
      companyId: COMPANY, original: SENT, round: 1, editable: EDITABLE,
      callModel: async () => ({ text: '[1] 겨울 소식 안내\n[2] 전 품목 세일', inputTokens: 1, outputTokens: 1 }),
    });
    expect(r).toEqual({ ok: false, reason: 'number-lost:35' });
  });

  it('원문에 없던 주소 · 전화번호를 덧붙인 답은 버린다(지어낸 주소가 판 · 짧은 주소로 가지 않는다)', async () => {
    const run = (text: string) => refineForSpam({ companyId: COMPANY, original: SENT, round: 2, editable: EDITABLE, callModel: async () => ({ text, inputTokens: 1, outputTokens: 1 }) });
    expect(await run('[1] 겨울 소식 안내 https://new.example/a\n[2] 전 품목 35% 세일')).toEqual({ ok: false, reason: 'url-moved' });
    expect((await run('[1] 겨울 소식 안내\n[2] 전 품목 35% 세일 문의 02-1234-5678')).ok).toBe(false);
  });

  it('★ Codex 구현 1R · 2R — 주소는 AI 에 보여 주지 않는다: 자리표시로 가려 보내고 받은 자리에 원래 글자를 되돌린다(스킴 없는 www · 대소문자 · 메일 주소까지 글자 그대로)', async () => {
    const sent = '(광고) 하늘몰\n보러 가기 https://shop.example/Sale/AbC?k=Xy\n또는 www.Shop.co.kr/Sale 문의 help@shop.example\n무료 수신거부 080-000-0000';
    let asked = '';
    const r = await refineForSpam({
      companyId: COMPANY, original: sent, round: 1, editable: [1, 2],
      callModel: async (_s, u) => { asked = u; return { text: '[1] 구경하러 가기 <<URL1>>\n[2] 아니면 <<URL2>> 문의는 <<URL3>>', inputTokens: 1, outputTokens: 1 }; },
    });
    expect(asked).toContain('[1] 보러 가기 <<URL1>>');
    expect(asked).toContain('[2] 또는 <<URL2>> 문의 <<URL3>>');
    expect(asked).not.toMatch(/shop\.example|Shop\.co\.kr|help@/);
    expect(r).toEqual({ ok: true, content: '(광고) 하늘몰\n구경하러 가기 https://shop.example/Sale/AbC?k=Xy\n아니면 www.Shop.co.kr/Sale 문의는 help@shop.example\n무료 수신거부 080-000-0000' });
  });

  it('자리표시를 지우거나 · 다른 줄로 옮기거나 · 순서를 바꾸거나 · 주소를 직접 쓴 답은 버린다', async () => {
    const sent = '(광고) 하늘몰\n상품 가 https://a.example/1 상품 나 https://b.example/2\n상품 다 https://c.example/3\n무료 수신거부 080-000-0000';
    const run = (text: string) => refineForSpam({ companyId: COMPANY, original: sent, round: 2, editable: [1, 2], callModel: async () => ({ text, inputTokens: 1, outputTokens: 1 }) });
    expect((await run('[1] 가 상품 <<URL1>> 나 상품 <<URL2>>\n[2] 다 상품 <<URL3>>')).ok).toBe(true);
    expect(await run('[1] 가 상품 <<URL1>> 나 상품\n[2] 다 상품 <<URL3>>')).toEqual({ ok: false, reason: 'url-moved' });                       // 지움
    expect(await run('[1] 가 상품 <<URL1>> 나 상품 <<URL3>>\n[2] 다 상품 <<URL2>>')).toEqual({ ok: false, reason: 'url-moved' });        // 줄 사이 맞바꿈
    expect(await run('[1] 나 상품 <<URL2>> 가 상품 <<URL1>>\n[2] 다 상품 <<URL3>>')).toEqual({ ok: false, reason: 'url-moved' });        // 줄 안 순서 바꿈
    expect(await run('[1] 가 상품 https://a.example/1 나 상품 <<URL2>>\n[2] 다 상품 <<URL3>>')).toEqual({ ok: false, reason: 'url-moved' });   // 직접 쓴 주소
  });

  it('★ Codex 구현 3R — 자리표시가 다 있어도 되돌린 뒤 주소 꼴 덩어리가 원래 줄과 다르면 버린다(조사가 붙어 경로가 바뀜 · 새 주소를 덧붙임 · 덜 된 자리표시)', async () => {
    const sent = '(광고) 하늘몰\n행사 보기 brand.shop/sale\n무료 수신거부 080-000-0000';
    const run = (text: string) => refineForSpam({ companyId: COMPANY, original: sent, round: 1, editable: [1], callModel: async () => ({ text, inputTokens: 1, outputTokens: 1 }) });
    expect(await run('[1] 행사 구경 <<URL1>>')).toEqual({ ok: true, content: '(광고) 하늘몰\n행사 구경 brand.shop/sale\n무료 수신거부 080-000-0000' });
    expect(await run('[1] <<URL1>>에서 행사 보기')).toEqual({ ok: false, reason: 'url-moved' });                     // brand.shop/sale에서 = 다른 경로
    expect(await run('[1] 행사 구경 <<URL1>> 또는 event.shop/sale')).toEqual({ ok: false, reason: 'url-moved' });     // 자리표시는 그대로 · 새 주소
    expect(await run('[1] 행사 구경 <<URL1>> <<URL>>')).toEqual({ ok: false, reason: 'url-moved' });                  // 덜 된 자리표시가 판 글에 남는다
  });

  it('★ Codex 구현 4R ~ 6R — 꺾쇠 쌍(<< 또는 >>)이 든 줄은 보내지 않고 그대로 둔다(보낸 줄보다 앞 · 사이에 있어도 답은 보낸 줄 자리에만) · 되돌린 줄에 꺾쇠 쌍이 남으면 철자와 상관없이 버린다', async () => {
    // 고칠 줄 = 1 ~ 4 · 그중 1(<< 만) · 3(>> 만)은 보내지 않는다 → 요청의 [1] = 2번 줄 · [2] = 4번 줄
    const sent = ['(광고) 하늘몰', '<<특가 겨울 행사', '상세 <https://brand.shop/sale>', '바로 가기 >> brand.shop/go', '전 품목 35% 할인', '무료 수신거부 080-000-0000'].join('\n');
    let asked = '';
    const run = (text: string) => refineForSpam({ companyId: COMPANY, original: sent, round: 1, editable: [1, 2, 3, 4], callModel: async (s, u) => { asked = s + u; return { text, inputTokens: 1, outputTokens: 1 }; } });
    expect(await run('[1] 자세히 <<URL1>>\n[2] 전 품목 35% 세일')).toEqual({
      ok: true,
      content: ['(광고) 하늘몰', '<<특가 겨울 행사', '자세히 <https://brand.shop/sale>', '바로 가기 >> brand.shop/go', '전 품목 35% 세일', '무료 수신거부 080-000-0000'].join('\n'),
    });
    expect(asked).toContain('[1] 상세 <<URL1>>');
    expect(asked).toContain('[2] 전 품목 35% 할인');
    expect(asked).not.toMatch(/특가|바로 가기|\[3\]/);
    for (const left of ['<<url>>', '<<URL>>', '<< Url 2 >>', '<<url', 'url>>', '<<URL2>>']) {
      expect(await run(`[1] 자세히 <<URL1>> 또는 ${left}\n[2] 전 품목 35% 세일`), left).toEqual({ ok: false, reason: 'url-moved' });
    }
  });

  it('고칠 줄이 꺾쇠 쌍이 든 줄뿐이면 부르지 않는다', async () => {
    let called = 0;
    const r = await refineForSpam({ companyId: COMPANY, original: '<<특가>> 겨울 행사\n행사 안내 >>', round: 1, editable: [0, 1], callModel: async () => { called += 1; return { text: '', inputTokens: 0, outputTokens: 0 }; } });
    expect(called).toBe(0);
    expect(r).toEqual({ ok: false, reason: 'no-editable' });
  });

  it('★ Codex 구현 3R — 피할 표현에 든 주소 꼴(도메인 · 메일 주소)은 요청에 싣지 않는다(본문에서 가린 주소가 이 목록으로 새지 않는다)', async () => {
    const sent = '(광고) 하늘몰\n겨울 혜택 안내 brand.co.kr 문의 help@shop.example\n무료 수신거부 080-000-0000';
    let asked = '';
    const r = await refineForSpam({
      companyId: COMPANY, original: sent, round: 1, editable: [1], avoid: ['혜택', 'brand.co.kr', 'help@shop.example'],
      callModel: async (s, u) => { asked = s + u; return { text: '[1] 겨울 소식 안내 <<URL1>> 문의 <<URL2>>', inputTokens: 1, outputTokens: 1 }; },
    });
    expect(r.ok).toBe(true);
    expect(asked).toContain('혜택');
    expect(asked).not.toMatch(/brand\.co\.kr|help@|shop\.example/);
  });

  it('고칠 줄이 없으면 부르지 않는다', async () => {
    let called = 0;
    const r = await refineForSpam({ companyId: COMPANY, original: SENT, round: 1, editable: [], callModel: async () => { called += 1; return { text: '', inputTokens: 0, outputTokens: 0 }; } });
    expect(called).toBe(0);
    expect(r.ok).toBe(false);
  });
});
