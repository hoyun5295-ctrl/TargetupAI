// replaces: none
/**
 * 스팸 확인 판 재작성(C164 · ★ 2026-11-26 · 설계서 docs/2026-11-25-spam-diag-rewrite-design.md) — 순수 함수 계약
 *   기대값 = 설계서 §14 의 손으로 적은 예(코드가 계산하는 방식으로 다시 계산하지 않는다).
 */
import { describe, it, expect } from 'vitest';
import { findLostNumbers } from '../copy-benefit-detector';
import { editableLines, classifyRewrite, applySpamFixes, plateFixes, type PlateState, type SpamFix } from '../spam-block-hint';

describe('findLostNumbers — 사라진 숫자(설계서 §6-2 ⑤)', () => {
  it('혜택 줄을 지우면 그 숫자가 사라진 것으로 나온다', () => {
    expect(findLostNumbers('겨울 행사\n전 품목 35% OFF\n매장에서 만나요', '겨울 행사\n매장에서 만나요')).toEqual(['35']);
  });

  it('이번 달 「N월」도 예외가 아니다(새 숫자 판정과 다르다)', () => {
    expect(findLostNumbers('11월 회원 한정 5천원 할인', '회원 한정 5천원 할인')).toEqual(['11']);
    expect(findLostNumbers('1월 회원 한정', '회원 한정')).toEqual(['1']);
    expect(findLostNumbers('12월 회원 한정', '회원 한정')).toEqual(['12']);
  });

  it('같은 숫자가 두 번 나왔으면 두 번 남아야 한다', () => {
    expect(findLostNumbers('A 상품 20% 할인, B 상품 20% 할인', 'A, B 상품 20% 할인')).toEqual(['20']);
    expect(findLostNumbers('A 상품 20% 할인, B 상품 20% 할인', 'B 상품 20% 할인이고 A 상품도 20% 할인')).toEqual([]);
  });

  it('표기만 바뀐 값은 같은 값이다', () => {
    expect(findLostNumbers('전 품목 35% 할인', '전 품목 35퍼센트 할인')).toEqual([]);
    expect(findLostNumbers('1만원 쿠폰', '10,000원 쿠폰')).toEqual([]);
  });

  it('숫자가 늘어난 것은 여기서 보지 않는다(새 숫자 판정의 몫)', () => {
    expect(findLostNumbers('20% 할인', '20% 할인, 3일 한정')).toEqual([]);
  });

  it('변수 칸 안의 숫자는 세지 않는다', () => {
    expect(findLostNumbers('%등급2% 고객님 10% 할인', '%등급2% 고객님께 10% 할인')).toEqual([]);
    expect(findLostNumbers('%등급2% 고객님 10% 할인', '고객님께 10% 할인')).toEqual([]);
  });
});

describe('editableLines — 고칠 수 있는 줄(설계서 §6-1 · 줄 자리로 짝짓는다)', () => {
  // 검사 글 = 원문의 줄 순서 그대로: 변수는 그 줄 안에서 값으로 · 광고 표기는 첫 줄 앞 · 수신거부 줄은 맨 뒤(messageUtils buildAdMessage 의 꼴)
  const TPL = '하늘몰 겨울 행사 안내\n%이름% 고객님께\n전 품목 35% 할인\n>https://tinyurl.example/zz9\n겨울 행사 안내';
  const SENT = '(광고) 하늘몰 겨울 행사 안내\n김하늘 고객님께\n전 품목 35% 할인\n>https://tinyurl.example/zz9\n겨울 행사 안내\n무료수신거부 080-000-0000';
  // 수신거부 줄 판정 = 발송 조립기의 꼬리말 식(messageUtils AD_REJECT_FOOTER_RE)과 같은 꼴을 넘긴다(운영 코드는 그 식을 그대로 넘긴다)
  const optOut = (l: string) => /무료\s*수신\s*거부|무료\s*거부/.test(l);

  it('그 자리의 두 줄이 글자 그대로 같은 줄만 · 광고 표기가 붙은 첫 줄 · 수신자 값 줄 · 수신거부 줄은 고정', () => {
    expect(editableLines(SENT, TPL, optOut)).toEqual([{ sentLine: 2, tplLine: 2 }, { sentLine: 3, tplLine: 3 }, { sentLine: 4, tplLine: 4 }]);
    // 단문 = 수신거부 줄 꼴이 다르다(무료거부080…) · 광고 표기 없는 글 = 보낸 글이 원문 그대로
    expect(editableLines('(광고)겨울 행사\n전 품목 35% 할인\n무료거부0800000000', '겨울 행사\n전 품목 35% 할인', optOut)).toEqual([{ sentLine: 1, tplLine: 1 }]);
    expect(editableLines('겨울 행사\n전 품목 35% 할인', '겨울 행사\n전 품목 35% 할인\n', optOut)).toEqual([{ sentLine: 0, tplLine: 0 }, { sentLine: 1, tplLine: 1 }]);
  });

  it('★ Codex 구현 1R · 2R — 수신자 값이 우연히 원문의 다른 줄과 같은 글자여도 자리가 다르면 짝짓지 않는다(값 줄이 AI 로 가지 않고 · 판과 받기가 같은 줄을 고친다)', () => {
    // 2R 의 예: 원문 「VIP 고객님」 · 「%등급% 고객님」 + 첫 수신자 등급 VIP + 광고 표기 → 보낸 글 둘째 줄 「VIP 고객님」은 값이 든 줄이다
    expect(editableLines('(광고) VIP 고객님\nVIP 고객님\n무료수신거부 080-000-0000', 'VIP 고객님\n%등급% 고객님', optOut)).toEqual([]);
    // 1R 의 예: 원문 「%고객등급%」 · 「VIP」 + 값 VIP → 둘째 줄만 원문 줄(자리로 확정)
    expect(editableLines('VIP\nVIP\n겨울 행사', '%고객등급%\nVIP\n겨울 행사', optOut)).toEqual([{ sentLine: 1, tplLine: 1 }, { sentLine: 2, tplLine: 2 }]);
  });

  it('자리를 믿을 수 없는 글 = 고칠 줄 0 — 값에 줄바꿈이 있어 줄이 밀린 글 · 보낸 글이 원문보다 짧은 글 · 원문과 다른 글', () => {
    expect(editableLines('서울시\n강남구\n행사 안내', '%주소%\n행사 안내', optOut)).toEqual([]);
    expect(editableLines('행사 안내', '행사 안내\n둘째 줄', optOut)).toEqual([]);
    expect(editableLines('(광고) 하늘몰\n김하늘 고객님\n무료 수신거부 080-000-0000', '%이름% 고객님', optOut)).toEqual([]);
  });

  it('변수 칸 · Liquid 식이 든 원문 줄은 값이 안 바뀐 채 나갔어도 고정 · 원문에 직접 쓴 광고 줄 · 수신거부 줄 · 빈 줄도 고정', () => {
    const t = '%이름% 고객님\n{{ name }} 님\n{% if vip %}VIP{% endif %}\n행사 안내';
    expect(editableLines(t, t, optOut)).toEqual([{ sentLine: 3, tplLine: 3 }]);
    const u = '(광고) 하늘몰\n\n행사 안내\n무료 수신거부 080-000-0000';
    expect(editableLines(u, u, optOut)).toEqual([{ sentLine: 2, tplLine: 2 }]);
    // ★ Codex 구현 3R — 조립기가 꼬리말로 인정하는 띄어 쓴 꼴(「무료 수신 거부」)도 고정
    const v = '매장 소식\n무료 수신 거부 080-000-0000';
    expect(editableLines(v, v, optOut)).toEqual([{ sentLine: 0, tplLine: 0 }]);
  });
});

describe('plateFixes — 판 글에서 바꿈 목록(설계서 §6-3)', () => {
  it('고칠 줄 중 달라진 줄만 · 원문 줄 위치 · 주소만 달라진 줄 = url', () => {
    const sent = '(광고) 하늘몰\n겨울 혜택 안내\n>https://tinyurl.example/zz9\n매장에서 만나요\n무료 수신거부 080-000-0000';
    const plate = '(광고) 하늘몰\n겨울 소식 안내\n>https://hlj.kr/Ab12cd\n매장에서 만나요\n무료 수신거부 080-000-0000';
    const editable = [{ sentLine: 1, tplLine: 0 }, { sentLine: 2, tplLine: 1 }, { sentLine: 3, tplLine: 2 }];
    expect(plateFixes(sent, plate, editable, [{ from: 'https://tinyurl.example/zz9', to: 'https://hlj.kr/Ab12cd' }])).toEqual([
      { field: 'body', tplLine: 0, before: '겨울 혜택 안내', after: '겨울 소식 안내', kind: 'text' },
      { field: 'body', tplLine: 1, before: '>https://tinyurl.example/zz9', after: '>https://hlj.kr/Ab12cd', kind: 'url' },
    ]);
  });

  it('표현과 주소가 함께 바뀐 줄 = text(주소 줄은 판의 주소 목록이 따로 말한다)', () => {
    expect(plateFixes('혜택 보기 https://tinyurl.example/zz9', '소식 보기 https://hlj.kr/Ab12cd', [{ sentLine: 0, tplLine: 0 }], [{ from: 'https://tinyurl.example/zz9', to: 'https://hlj.kr/Ab12cd' }]))
      .toEqual([{ field: 'body', tplLine: 0, before: '혜택 보기 https://tinyurl.example/zz9', after: '소식 보기 https://hlj.kr/Ab12cd', kind: 'text' }]);
  });

  it('줄 수가 다르거나 고정 줄이 달라진 판 = null(버림)', () => {
    const editable = [{ sentLine: 1, tplLine: 0 }];
    expect(plateFixes('(광고) 가\n나', '(광고) 가\n나\n다', editable, [])).toBeNull();
    expect(plateFixes('(광고) 가\n나', '(광고) 가나\n다', editable, [])).toBeNull();
  });
});

describe('classifyRewrite — 판 상태 · 다음(설계서 §5-1 · §5-2)', () => {
  type St = PlateState['results'][number]['state'];
  const plate = (kind: PlateState['kind'], states: Record<string, St>, extra: Partial<PlateState> = {}): PlateState =>
    ({ kind, results: Object.entries(states).map(([carrier, state]) => ({ carrier, state })), ...extra });

  it('판이 없으면 첫 판(표현을 바꾼 글)', () => {
    expect(classifyRewrite({ plates: [], owner: 'screen', hasUrl: true })).toEqual({ kind: 'next', candidates: ['w1'] });
  });

  it('대상 통신사 전부 도착일 때만 찾음 · 하나라도 확인 중이면 기다림', () => {
    expect(classifyRewrite({ plates: [plate('w1', { KT: 'arrived', LGU: 'arrived' })], owner: 'screen', hasUrl: false })).toEqual({ kind: 'found', plate: 0 });
    expect(classifyRewrite({ plates: [plate('w1', { KT: 'arrived', LGU: 'checking' })], owner: 'screen', hasUrl: false })).toEqual({ kind: 'wait' });
    expect(classifyRewrite({ plates: [plate('w1', { KT: 'queued' })], owner: 'agency', hasUrl: false })).toEqual({ kind: 'wait' });
  });

  it('일부만 도착 = 다음 판 · 주소가 없으면 새로 쓴 글 · 그것도 막히면 끝', () => {
    expect(classifyRewrite({ plates: [plate('w1', { KT: 'blocked', LGU: 'arrived' })], owner: 'screen', hasUrl: false })).toEqual({ kind: 'next', candidates: ['w2'] });
    expect(classifyRewrite({ plates: [plate('w1', { KT: 'blocked' }), plate('w2', { KT: 'blocked' })], owner: 'screen', hasUrl: false })).toEqual({ kind: 'end', reason: 'exhausted' });
  });

  it('확인하지 못한 결과가 하나라도 있으면 거기서 끝(확인 못 함)', () => {
    expect(classifyRewrite({ plates: [plate('w1', { KT: 'blocked', LGU: 'unknown' })], owner: 'screen', hasUrl: true })).toEqual({ kind: 'end_unknown' });
  });

  it('주소가 있는 글 · 화면 = 표현 판이 막히면 묻는다(주소 판은 사람이 고른다)', () => {
    const b = { KT: 'blocked' as St };
    expect(classifyRewrite({ plates: [plate('w1', b)], owner: 'screen', hasUrl: true })).toEqual({ kind: 'ask_url', options: ['w1u', 'w2'] });
    expect(classifyRewrite({ plates: [plate('w1', b), plate('w1u', b)], owner: 'screen', hasUrl: true })).toEqual({ kind: 'next', candidates: ['w2'] });
    expect(classifyRewrite({ plates: [plate('w1', b), plate('w2', b)], owner: 'screen', hasUrl: true })).toEqual({ kind: 'ask_url', options: ['w2u'] });
    expect(classifyRewrite({ plates: [plate('w1', b), plate('w1u', b), plate('w2', b)], owner: 'screen', hasUrl: true })).toEqual({ kind: 'end', reason: 'exhausted' });
    expect(classifyRewrite({ plates: [plate('w1', b), plate('w2', b), plate('w2u', b)], owner: 'screen', hasUrl: true })).toEqual({ kind: 'end', reason: 'exhausted' });
  });

  it('주소가 있는 글 · 대행 = 묻지 않고 주소 판까지 차례로(못 만들면 다음 후보)', () => {
    const b = { KT: 'blocked' as St };
    expect(classifyRewrite({ plates: [plate('w1', b)], owner: 'agency', hasUrl: true })).toEqual({ kind: 'next', candidates: ['w1u', 'w2'] });
    expect(classifyRewrite({ plates: [plate('w1', b), plate('w1u', b)], owner: 'agency', hasUrl: true })).toEqual({ kind: 'next', candidates: ['w2'] });
    expect(classifyRewrite({ plates: [plate('w1', b), plate('w2', b)], owner: 'agency', hasUrl: true })).toEqual({ kind: 'next', candidates: ['w2u'] });
  });

  it('다음 판을 못 만들었다고 적힌 판 = 끝(같은 시도를 되풀이하지 않는다) · 닫힌 진단 = closed', () => {
    expect(classifyRewrite({ plates: [plate('w1', { KT: 'blocked' }, { ended: { reason: 'no_plate' } })], owner: 'agency', hasUrl: true })).toEqual({ kind: 'end', reason: 'no_plate' });
    expect(classifyRewrite({ plates: [plate('w1', { KT: 'arrived' }, { closed: true })], owner: 'agency', hasUrl: false })).toEqual({ kind: 'closed' });
  });

  it('앞 판이 늦은 보고로 전부 도착이 되면 그 판이 찾은 판(바꾼 곳이 적은 쪽)', () => {
    expect(classifyRewrite({ plates: [plate('w1', { KT: 'arrived' }), plate('w2', { KT: 'checking' })], owner: 'screen', hasUrl: false })).toEqual({ kind: 'found', plate: 0 });
  });
});

describe('applySpamFixes — 받기(설계서 §9-1)', () => {
  const TPL = '겨울 혜택 안내\n%이름% 고객님께\n전 품목 35% 할인\n겨울 혜택 안내';
  const fixes: SpamFix[] = [
    { field: 'body', tplLine: 0, before: '겨울 혜택 안내', after: '겨울 소식 안내', kind: 'text' },
    { field: 'body', tplLine: 2, before: '전 품목 35% 할인', after: '전 품목 35% 세일', kind: 'text' },
  ];

  it('지금 글이 원문과 같으면 줄 위치로 바꾼다(같은 줄이 두 번이어도 그 위치만)', () => {
    expect(applySpamFixes({ body: TPL, subject: '겨울 행사' }, { body: TPL, subject: '겨울 행사' }, fixes))
      .toEqual({ ok: true, body: '겨울 소식 안내\n%이름% 고객님께\n전 품목 35% 세일\n겨울 혜택 안내', subject: '겨울 행사' });
  });

  it('지금 글이 달라졌으면 바꿀 줄이 원문에도 지금 글에도 딱 하나일 때만(줄이 옮겨 가도 같은 줄)', () => {
    expect(applySpamFixes({ body: '새 첫 줄\n전 품목 35% 할인\n%이름% 고객님께', subject: null }, { body: TPL, subject: null }, [fixes[1]]))
      .toEqual({ ok: true, body: '새 첫 줄\n전 품목 35% 세일\n%이름% 고객님께', subject: null });
  });

  it('원문에 두 번 있는 줄 · 지금 글에 옮겨 와 두 번이 된 줄 · 사라진 줄 = 넣지 않는다', () => {
    expect(applySpamFixes({ body: `${TPL}\n덧붙임`, subject: null }, { body: TPL, subject: null }, fixes)).toEqual({ ok: false, reason: 'changed' });
    expect(applySpamFixes({ body: '전 품목 35% 할인\n전 품목 35% 할인', subject: null }, { body: TPL, subject: null }, [fixes[1]])).toEqual({ ok: false, reason: 'changed' });
    expect(applySpamFixes({ body: '아예 다른 글', subject: null }, { body: TPL, subject: null }, [fixes[1]])).toEqual({ ok: false, reason: 'changed' });
  });

  it('제목 바꿈 = 지금 제목이 바꾸기 전 제목과 같을 때만', () => {
    const sub: SpamFix[] = [{ field: 'subject', tplLine: 0, before: '겨울 혜택', after: '겨울 소식', kind: 'text' }];
    expect(applySpamFixes({ body: TPL, subject: '겨울 혜택' }, { body: TPL, subject: '겨울 혜택' }, sub)).toEqual({ ok: true, body: TPL, subject: '겨울 소식' });
    expect(applySpamFixes({ body: TPL, subject: '다른 제목' }, { body: TPL, subject: '겨울 혜택' }, sub)).toEqual({ ok: false, reason: 'changed' });
  });
});
