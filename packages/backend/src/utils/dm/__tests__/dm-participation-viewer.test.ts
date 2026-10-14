/**
 * dm-participation-viewer.test.ts — 참여 8블록 완료 문구 = 장치 하나 (★ 2026-10-14 · 임은지 접수 1014 ② 뿌리 R2)
 *
 * 기원
 *   0722에 이메일수집 "완료 문구"를 폼 속성(data-success-text)으로 배선했는데, 설문·투표·룰렛·추첨·클릭 리워드·즉시쿠폰·선착순은
 *   각자 고정 문구(또는 data-claim-success)로 남아 설문 "완료 보상 문구"를 적어도 단말에는 안 떴다(접수 ②).
 *   장치가 블록마다 달라서 한 블록을 고쳐도 나머지로 안 퍼지는 구조였다.
 *
 * 못 박는 것
 *   1. 완료 문구는 `renderSection` 래퍼 `data-success-text` 하나로 나가고(참여 8종 · 값 있을 때만), 뷰어는 `wrapInfo().done` 하나로 읽는다.
 *   2. 실제로 내보내는 뷰어 스크립트(표식 dm-participation:begin~end)를 가짜 DOM·가짜 fetch로 **8타입 실제 클릭** 실행한 결과가
 *      상태 표와 같다 — 완료 = 회사 문구(없으면 현행 고정 문구 바이트 동일) · 당첨·이미 참여 = 현행 문구 + 둘째 줄 회사 문구 ·
 *      꽝·검증·오류 = 불변.
 *   3. 뷰어에서 완료 문구 읽기를 빼면 이 테스트가 깨진다(죽은 검사 차단 · LESSONS_FRONTEND "안 불리는 검사").
 */
import { describe, it, expect } from 'vitest';
import { renderSection, doneTextOf } from '../dm-section-renderer';
import { renderDmViewerHtml } from '../dm-viewer';
import { PARTICIPATION_TYPES, SECTION_DEFAULTS, type Section } from '../dm-section-registry';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const COMPANY = '매장 카운터에 이 화면을 보여주세요';
const TRACK = '/api/dm/v';

function mk(type: string, props: Record<string, unknown>): Section {
  return { id: 'sec-1', type, order: 0, visible: true, props: { ...(SECTION_DEFAULTS as any)[type], ...props } } as unknown as Section;
}
const BASE: Record<string, Record<string, unknown>> = {
  poll: {},
  survey: { questions: [{ id: 'q1', type: 'text', question: '의견' }] },
  email_capture: { headline: '구독', consent_text: '동의', consent_required: true },
  click_rewards: { reward_description: '좋아요 보상' },
  lucky_draw: { title: '추첨' },
  roulette: {},
  instant_coupon: { coupon_label: '쿠폰', discount_description: '10%' },
  limited_quantity: { title: '선착순', total_quantity: 10 },
};
/** 현행 고정 문구(바이트 동일을 지킨다 — 바꾸면 접수 없이 받는 사람 화면이 바뀐다) */
const DEFAULT_DONE: Record<string, string> = {
  poll: '투표해주셔서 감사합니다!',
  survey: '설문이 제출되었습니다. 감사합니다!',
  email_capture: '참여가 완료되었습니다. 감사합니다!',
  click_rewards: '참여가 완료되었습니다. 감사합니다!',
  lucky_draw: '참여가 완료되었습니다. 감사합니다!',
  roulette: '🎉 커피 당첨!',
  instant_coupon: '쿠폰이 발급되었습니다. 결제 시 적용해주세요.',
  limited_quantity: '참여가 완료되었습니다!',
};
const ALREADY: Record<string, string> = { poll: '이미 투표하셨습니다.' };
const alreadyOf = (type: string) => ALREADY[type] || '이미 참여하셨습니다.';

// ── 가짜 DOM(최소) ──
type FakeEl = {
  attrs: Record<string, string>; style: Record<string, string>; disabled: boolean; textContent: string;
  value: string; checked: boolean; children: FakeEl[]; parent: FakeEl | null; listeners: Record<string, Array<() => void>>;
  getAttribute(k: string): string | null; setAttribute(k: string, v: string): void; removeAttribute(k: string): void; hasAttribute(k: string): boolean;
  querySelector(sel: string): FakeEl | null; querySelectorAll(sel: string): FakeEl[]; closest(sel: string): FakeEl | null;
  addEventListener(t: string, f: () => void): void; click(): void; appendChild(c: FakeEl): void;
};
function el(attrs: Record<string, string>, children: FakeEl[] = []): FakeEl {
  const e: FakeEl = {
    attrs: { ...attrs }, style: {}, disabled: false, textContent: '', value: attrs.__value || '', checked: attrs.__checked === '1',
    children, parent: null, listeners: {},
    getAttribute: (k) => (k in e.attrs ? e.attrs[k] : null),
    setAttribute: (k, v) => { e.attrs[k] = v; },
    removeAttribute: (k) => { delete e.attrs[k]; },
    hasAttribute: (k) => k in e.attrs,
    querySelector: (sel) => e.querySelectorAll(sel)[0] || null,
    querySelectorAll: (sel) => {
      const parts = sel.split(',').map((s) => s.trim());
      const out: FakeEl[] = [];
      const walk = (n: FakeEl) => { for (const c of n.children) { if (parts.some((p) => matches(c, p))) out.push(c); walk(c); } };
      walk(e);
      return out;
    },
    closest: (sel) => { let n: FakeEl | null = e; while (n) { if (matches(n, sel)) return n; n = n.parent; } return null; },
    addEventListener: (t, f) => { (e.listeners[t] ||= []).push(f); },
    click: () => { for (const f of e.listeners.click || []) f(); },
    appendChild: (c) => { c.parent = e; e.children.push(c); },
  };
  for (const c of children) c.parent = e;
  return e;
}
/** 선택자 = 태그? + [attr]… + .class (뷰어가 쓰는 모양만) */
function matches(n: FakeEl, sel: string): boolean {
  const tag = (sel.match(/^[a-z]+/) || [''])[0];
  if (tag && n.attrs.__tag !== tag) return false;
  for (const m of sel.matchAll(/\[([a-z-]+)(?:=([a-z]+))?\]/g)) {
    if (!(m[1] in n.attrs)) return false;
    if (m[2] !== undefined && n.attrs[m[1]] !== m[2]) return false;
  }
  if (/:checked/.test(sel) && !n.checked) return false;
  for (const m of sel.matchAll(/\.([a-z-]+)/g)) if (!(n.attrs.class || '').split(/\s+/).includes(m[1])) return false;
  return true;
}

/** 발행 SSR 래퍼의 속성(뷰어가 읽는 값 그대로) */
function wrapAttrs(ssr: string): Record<string, string> {
  const open = (ssr.match(/<div class="dm-section-wrap[^"]*"([^>]*)>/) || ['', ''])[1];
  const out: Record<string, string> = { class: 'dm-section-wrap' };
  for (const m of open.matchAll(/([a-z-]+)="([^"]*)"/g)) out[m[1]] = m[2].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return out;
}
const attrOf = (ssr: string, name: string) => {
  const m = ssr.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&') : null;
};

/** 타입별 가짜 트리 — 뷰어 핸들러가 찾는 선택자만 갖춘다. 반환 = { wrap, box, trigger(클릭할 것), result } */
function build(type: string, ssr: string) {
  const w = wrapAttrs(ssr);
  const result = el({ 'data-dm-result': '' });
  let box: FakeEl; let trigger: FakeEl;
  if (type === 'roulette') {
    trigger = el({ 'data-dm-spin': '' });
    box = el({ 'data-dm-roulette': '', 'data-segments': attrOf(ssr, 'data-segments') || '[]' }, [el({ 'data-dm-wheel': '' }), trigger, result]);
  } else if (type === 'poll') {
    trigger = el({ 'data-dm-poll-option': '', 'data-option-id': '1' });
    box = el({ 'data-dm-poll': '' }, [trigger, el({ 'data-dm-poll-option': '', 'data-option-id': '2' }), result]);
  } else if (type === 'survey') {
    trigger = el({ 'data-dm-submit': '' });
    box = el({ 'data-dm-survey': '' }, [trigger, result]);
  } else if (type === 'email_capture' || type === 'lucky_draw') {
    trigger = el({ 'data-dm-submit': '' });
    box = el({ 'data-dm-form': '' }, [
      el({ 'data-consent': '', __checked: '1' }),
      el({ 'data-field': type === 'email_capture' ? 'email' : 'phone', __value: type === 'email_capture' ? 'x@example.invalid' : '01000000000' }),
      trigger, result,
    ]);
  } else {
    trigger = el({ 'data-dm-claim': '', 'data-claim-success': attrOf(ssr, 'data-claim-success') || '' });
    box = el({ 'dm-claim-box': '' }, [trigger, result]);
  }
  const wrap = el(w, [box]);
  return { wrap, box, trigger, result };
}

const SELECTOR_KEY: Record<string, string> = {
  roulette: '[data-dm-roulette]', poll: '[data-dm-poll]', survey: '[data-dm-survey]',
  email_capture: '[data-dm-form]', lucky_draw: '[data-dm-form]',
  click_rewards: '[data-dm-claim]', instant_coupon: '[data-dm-claim]', limited_quantity: '[data-dm-claim]',
};

/** 뷰어 참여 블록을 떼어 실행하고 그 타입의 참여 요소를 한 번 누른다 → 결과 글자 */
async function clickOnce(type: string, props: Record<string, unknown>, serverRes: Record<string, unknown>, mutate?: (code: string) => string) {
  const section = mk(type, props);
  const ssr = renderSection(section, {} as any);
  const html = renderDmViewerHtml({ short_code: 'ptest', title: 'T', sections: [section] }, TRACK);
  const a = html.indexOf('/* dm-participation:begin */');
  const b = html.indexOf('/* dm-participation:end */');
  expect(a, '뷰어에 참여 블록 표식이 없다').toBeGreaterThan(0);
  expect(b).toBeGreaterThan(a);
  let code = html.slice(a, b);
  if (mutate) code = mutate(code);
  const tree = build(type, ssr);
  const listFor = SELECTOR_KEY[type];
  const fakeDocument = {
    body: el({ __tag: 'body' }),
    createElement: () => el({}),
    querySelectorAll: (sel: string) => (sel === listFor ? (type.match(/click_rewards|instant_coupon|limited_quantity/) ? [tree.trigger] : [tree.box]) : []),
    addEventListener: () => {},
  };
  const calls: unknown[] = [];
  const fakeFetch = (_url: string, init: { body: string }) => { calls.push(JSON.parse(init.body)); return Promise.resolve({ json: () => Promise.resolve(serverRes) }); };
  new Function('document', 'fetch', 'TRACK_URL', 'CODE', 'anonId', 'PHONE', 'RTOKEN', 'setInterval', 'clearInterval', 'setTimeout', 'window', code)(
    fakeDocument, fakeFetch, TRACK, 'ptest', 'anon-1', '', '', () => 1, () => {}, (f: () => void) => f(), { addEventListener: () => {} },
  );
  tree.trigger.click();
  for (let i = 0; i < 6; i++) await Promise.resolve();
  return { text: tree.result.textContent, style: tree.result.style, calls, ssr };
}

describe('참여 8종 — 발행 SSR 래퍼 마커 하나', () => {
  for (const type of PARTICIPATION_TYPES) {
    it(`[${type}] 완료 문구 지정 → 래퍼 data-success-text · 미지정 → 마커 없음(바이트 불변)`, () => {
      const withText = renderSection(mk(type, { ...BASE[type], success_text: COMPANY }), {} as any);
      const without = renderSection(mk(type, BASE[type]), {} as any);
      expect(wrapAttrs(withText)['data-success-text']).toBe(COMPANY);
      expect(without).not.toContain('data-success-text');
      // 마커는 래퍼에만 — 블록 안쪽(옛 0722 자리)에는 없다
      expect(withText.replace(/^<div class="dm-section-wrap[^>]*>/, '')).not.toContain('data-success-text');
    });
  }
  it('설문 옛 칸(completion_reward_text)만 있어도 완료 문구로 쓴다(접수 ② 종결 · 재입력 없음) · 공용 칸이 있으면 그것이 우선', () => {
    expect(doneTextOf('survey', { completion_reward_text: '보상 문구' })).toBe('보상 문구');
    expect(doneTextOf('survey', { completion_reward_text: '보상 문구', success_text: COMPANY })).toBe(COMPANY);
    expect(doneTextOf('poll', { completion_reward_text: '보상 문구' })).toBe('');
    expect(doneTextOf('poll', { success_text: '  ' })).toBe('');
    expect(wrapAttrs(renderSection(mk('survey', { ...BASE.survey, completion_reward_text: '보상 문구' }), {} as any))['data-success-text']).toBe('보상 문구');
  });
  it('참여 타입이 아닌 블록은 success_text가 있어도 마커를 내지 않는다', () => {
    expect(renderSection(mk('text_card', { headline: 'H', body: 'B', success_text: COMPANY }), {} as any)).not.toContain('data-success-text');
  });
});

describe('참여 8종 — 뷰어 실제 클릭 결과 = 상태 표', () => {
  for (const type of PARTICIPATION_TYPES) {
    const won = type === 'roulette' ? { result: { won: true, segment_id: '1', reward: '커피' } } : {};
    it(`[${type}] 완료 · 회사 문구 지정 → ${type === 'roulette' ? '당첨 문구 + 둘째 줄' : '회사 문구로 대체'}`, async () => {
      const r = await clickOnce(type, { ...BASE[type], success_text: COMPANY }, { success: true, ...won });
      expect(r.calls.length, '서버 제출이 한 번 나가야 한다').toBe(1);
      if (type === 'roulette') {
        expect(r.text).toBe(`${DEFAULT_DONE.roulette}\n${COMPANY}`);
        expect(r.style.whiteSpace).toBe('pre-line');
      } else {
        expect(r.text).toBe(COMPANY);
      }
      expect(r.style.color).toBe('#059669');
    });
    it(`[${type}] 완료 · 미지정 → 현행 고정 문구 그대로(바이트 동일 · 줄바꿈 스타일 없음)`, async () => {
      const r = await clickOnce(type, BASE[type], { success: true, ...won });
      expect(r.text).toBe(DEFAULT_DONE[type]);
      expect(r.style.whiteSpace).toBeUndefined();
    });
    if (type === 'roulette') {
      it('[roulette] 꽝 · 이미 참여 = 회사 문구가 있어도 불변(꽝 손님에게 수령 안내는 거짓 약속)', async () => {
        const lose = await clickOnce(type, { ...BASE[type], success_text: COMPANY }, { success: true, result: { won: false, segment_id: '2' } });
        expect(lose.text).toBe('아쉽지만 다음 기회에!');
        const already = await clickOnce(type, { ...BASE[type], success_text: COMPANY }, { success: true, already: true, result: null });
        expect(already.text).toBe('이미 참여하셨습니다.');
      });
    } else {
      it(`[${type}] 이미 참여 → 현행 문구 + 둘째 줄 회사 문구 · 미지정이면 현행 문구만`, async () => {
        const r = await clickOnce(type, { ...BASE[type], success_text: COMPANY }, { success: true, already: true });
        expect(r.text).toBe(`${alreadyOf(type)}\n${COMPANY}`);
        expect(r.style.whiteSpace).toBe('pre-line');
        const plain = await clickOnce(type, BASE[type], { success: true, already: true });
        expect(plain.text).toBe(alreadyOf(type));
      });
      it(`[${type}] 오류 응답 = 회사 문구와 무관(불변)`, async () => {
        const r = await clickOnce(type, { ...BASE[type], success_text: COMPANY }, { success: false, error: '마감된 이벤트예요.' });
        expect(r.text).toBe(type === 'poll' ? '잠시 후 다시 시도해주세요.' : '마감된 이벤트예요.');
        expect(r.style.color).toBe('#dc2626');
      });
    }
  }
  it('즉시쿠폰 = 회사 문구가 사용 안내(usage_instructions) 합성 문구를 대체한다(두 번 노출 X)', async () => {
    const r = await clickOnce('instant_coupon', { ...BASE.instant_coupon, usage_instructions: '카운터 제시', success_text: COMPANY }, { success: true });
    expect(r.text).toBe(COMPANY);
    const plain = await clickOnce('instant_coupon', { ...BASE.instant_coupon, usage_instructions: '카운터 제시' }, { success: true });
    expect(plain.text).toBe('쿠폰이 발급되었습니다. 카운터 제시');
  });
  it('미지정 캠페인의 여러 줄 합성 문구·서버 오류는 옛 모양 그대로(줄바꿈 스타일 없음 · 바이트 불변)', async () => {
    const r = await clickOnce('instant_coupon', { ...BASE.instant_coupon, usage_instructions: '카운터에 제시\n직원 확인 후 적용' }, { success: true });
    expect(r.text).toBe('쿠폰이 발급되었습니다. 카운터에 제시\n직원 확인 후 적용');
    expect(r.style.whiteSpace).toBeUndefined();
    const e = await clickOnce('survey', { ...BASE.survey, success_text: COMPANY }, { success: false, error: '마감된 이벤트예요.\n다음 행사를 기다려 주세요.' });
    expect(e.text).toBe('마감된 이벤트예요.\n다음 행사를 기다려 주세요.');
    expect(e.style.whiteSpace).toBeUndefined();
  });
  it('회사 문구의 줄바꿈이 그대로 살아난다(pre-line)', async () => {
    const r = await clickOnce('survey', { ...BASE.survey, success_text: '첫 줄\n둘째 줄' }, { success: true });
    expect(r.text).toBe('첫 줄\n둘째 줄');
    expect(r.style.whiteSpace).toBe('pre-line');
  });
});

describe('편집기 힌트의 "비우면 이 문구" = 뷰어가 실제로 띄우는 글자', () => {
  it('SectionPropsEditor DONE_DEFAULT(힌트용) 표가 이 테스트의 현행 고정 문구와 같다(한쪽만 바꾸면 힌트가 거짓말한다)', () => {
    const src = readFileSync(resolve(__dirname, '../../../../../frontend/src/components/dm/panels/SectionPropsEditor.tsx'), 'utf8');
    const block = src.match(/const DONE_DEFAULT: Record<string, string> = \{([\s\S]*?)\};/);
    expect(block, '프론트 DONE_DEFAULT 표를 못 찾음').toBeTruthy();
    const fe: Record<string, string> = {};
    for (const m of block![1].matchAll(/(\w+):\s*'([^']*)'/g)) fe[m[1]] = m[2];
    for (const type of PARTICIPATION_TYPES) {
      if (type === 'roulette') { expect(fe.roulette, '룰렛은 당첨 안내가 서버 값이라 표에 없어야 한다').toBeUndefined(); continue; }
      expect(fe[type], `${type} 힌트 기본 문구 ≠ 뷰어 글자`).toBe(DEFAULT_DONE[type]);
    }
  });
});

describe('죽은 검사 차단 — 뷰어에서 완료 문구 읽기를 빼면 깨진다', () => {
  it('wrapInfo가 done을 안 돌려주면 회사 문구 대신 고정 문구가 뜬다(= 이 하네스가 살아 있다)', async () => {
    const r = await clickOnce('survey', { ...BASE.survey, success_text: COMPANY }, { success: true },
      (code) => code.replace("done: w.getAttribute('data-success-text') || ''", "done: ''"));
    expect(r.text).toBe(DEFAULT_DONE.survey);
  });
});
