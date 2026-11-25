/**
 * 이용약관 개정 + 로그인 안내 창 2쪽 (★2026-11-25 Harold 「약관 수정하고, 공지 팝업을 띄우면 되잖아? 기존에 담당자 본인인증이랑 같이 2페이지로」)
 *
 * 못 박는 것
 *   1. 시행일은 상수 하나(`constants/termsRevision.ts`) · 한국 시각 자정부터 시행 · 11/26 공지부터 7일을 시각으로 다 채운다(Codex 1R).
 *   2. 약관 화면 = 시행 전에는 현행 조항(최대 10개) + 개정 · 신설 예고, 시행일부터는 개정문만(Codex 1R · 공지 기간에도 지금 조항이 보인다).
 *   3. 안내 창 1쪽 = 약관 개정 · 해지 요청권과 동의 간주 조건(제3조 제3항) · 요약이 원문 범위(장관 · 전기통신역무 · 할 수 있다)를 지킨다.
 *   4. 확인 단추는 마지막 쪽에만 있고 닫기만 한다 · 새로 쓴 고객 글에 가운뎃점 · 줄표 0.
 * 글 검사는 서버 렌더 결과(주석이 끼지 않는다)로 한다 · 쪽 넘김 · 포커스 · Escape 는 DOM 시험 도구가 없어 화면 실측(1125 · 1280px · 320px)과 소스 계약으로 본다.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getEventListeners } from 'node:events';
import React from '../../../../frontend/node_modules/react';
import { renderToStaticMarkup } from '../../../../frontend/node_modules/react-dom/server';
import { MemoryRouter } from '../../../../frontend/node_modules/react-router-dom';
import {
  TERMS_REVISION_EFFECTIVE_AT_MS,
  TERMS_REVISION_EFFECTIVE_DATE_TEXT,
  isTermsRevisionEffective,
  termsRevisionTimerDelay,
  watchTermsRevision,
} from '../../../../frontend/src/constants/termsRevision';
import TermsPage from '../../../../frontend/src/pages/TermsPage';
import LoginPolicyNoticeModal, { TERMS_CHANGES } from '../../../../frontend/src/components/LoginPolicyNoticeModal';

const fe = (...p: string[]) => readFileSync(join(__dirname, '..', '..', '..', '..', 'frontend', 'src', ...p), 'utf8');
/** 주석을 뺀 소스(블록 · JSX · 줄 주석) */
const code = (src: string) => src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
/** 서버 렌더 결과의 글자만(태그 제거 · 공백 하나로) */
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const DAY = 24 * 60 * 60 * 1000;
const ART41_5 = '5. 회사는 발신번호가 변작된 문자메시지를 인지하거나 과학기술정보통신부 장관 또는 한국인터넷진흥원의 요청이 있는 경우 해당 회선에 대한 전기통신역무의 제공을 중지할 수 있습니다.';
const ART42_3_OLD = '3. 회사는 이용자가 사용할 수 있는 본인 소유 전화번호를 최대 10개까지 등록할 수 있습니다.';
const ART42_3 = '3. 개인과 외국인 이용자는 관련 고시에서 정한 수까지, 법인 이용자는 회사가 확인한 자료에 따라 정한 범위에서 발신번호를 등록할 수 있습니다.';
const ART42_6 = '6. 회사는 악성 문자메시지 차단을 위하여 이용자가 전송하는 문자메시지에 포함된 URL을 발송 전에 분석할 수 있으며, 한국인터넷진흥원 등이 제공하는 악성 URL 정보와 일치하는 URL이 포함된 문자메시지는 발송을 차단할 수 있습니다.';
const ART42_7 = '7. 회사는 제6항에 따라 차단한 URL과 차단 건수 등 차단 정보를 한국인터넷진흥원에 제공할 수 있습니다.';
const ADDENDUM_3 = `3. 제41조 제5항, 제42조 제3항, 제6항 및 제7항은 서비스 화면 공지 후 7일이 경과한 날인 ${TERMS_REVISION_EFFECTIVE_DATE_TEXT}부터 시행합니다.`;
const REFUSAL = '바뀐 약관에 동의하지 않으시면 고객센터(1800-8125)로 거부 의사를 알리거나 이용계약 해지를 요청하실 수 있습니다. 시행일부터 7일이 지난 뒤에도 거부 의사를 밝히지 않고 서비스를 계속 이용하시면 바뀐 약관에 동의하신 것으로 봅니다.';

/** 그 시각의 약관 화면 · 안내 창(첫 쪽) 글자 */
function renderAt(ms: number) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ms);
  const terms = text(renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(TermsPage))));
  const modalHtml = renderToStaticMarkup(React.createElement(LoginPolicyNoticeModal, { onClose: () => {} }));
  return { terms, modal: text(modalHtml), modalHtml };
}
/** 「제N조 (」부터 다음 조 앞까지 */
function article(all: string, no: number): string {
  const s = all.indexOf(`제${no}조 (`);
  const e = all.indexOf(`제${no + 1}조 (`, s + 1);
  expect(s).toBeGreaterThan(0);
  expect(e).toBeGreaterThan(s);
  return all.slice(s, e);
}

afterEach(() => { vi.useRealTimers(); });

describe('시행일 = 상수 하나 · 한국 시각 자정', () => {
  it('시각과 글자가 같은 날이고, 자정 1ms 전은 시행 전 · 자정과 그 뒤는 시행', () => {
    expect(TERMS_REVISION_EFFECTIVE_AT_MS).toBe(Date.parse('2026-12-04T00:00:00+09:00'));
    expect(TERMS_REVISION_EFFECTIVE_DATE_TEXT).toBe('2026년 12월 4일');
    expect(isTermsRevisionEffective(TERMS_REVISION_EFFECTIVE_AT_MS - 1)).toBe(false);
    expect(isTermsRevisionEffective(TERMS_REVISION_EFFECTIVE_AT_MS)).toBe(true);
    expect(isTermsRevisionEffective(TERMS_REVISION_EFFECTIVE_AT_MS + 1)).toBe(true);
  });

  it('11/26 중 언제 공지해도 시행까지 7일이 다 찬다(제3조 제2항 · 부칙 3)', () => {
    expect(TERMS_REVISION_EFFECTIVE_AT_MS - Date.parse('2026-11-26T23:59:59.999+09:00')).toBeGreaterThanOrEqual(7 * DAY);
  });

  it('★Codex 2R · 3R 열어 둔 화면도 시행 시각에 바뀐다 — 화면은 판정을 훅 하나로만 읽고, 훅은 watchTermsRevision 하나를 건다', () => {
    // 기다릴 시간 = 시행 시각까지(지났으면 0 · setTimeout 상한 약 24.8일로 끊는다 = 넘겨도 바로 터지지 않는다)
    expect(termsRevisionTimerDelay(TERMS_REVISION_EFFECTIVE_AT_MS - 5000)).toBe(5000);
    expect(termsRevisionTimerDelay(TERMS_REVISION_EFFECTIVE_AT_MS)).toBe(0);
    expect(termsRevisionTimerDelay(TERMS_REVISION_EFFECTIVE_AT_MS + 5000)).toBe(0);
    expect(termsRevisionTimerDelay(TERMS_REVISION_EFFECTIVE_AT_MS - 40 * DAY)).toBe(2 ** 31 - 1);
    const hook = code(fe('constants', 'termsRevision.ts'));
    expect(hook).toContain('const [effective, setEffective] = useState(() => isTermsRevisionEffective());');
    expect(hook).toContain('useEffect(() => (effective ? undefined : watchTermsRevision(() => setEffective(true))), [effective]);');
    // 듣기 = 같은 함수 · 옵션 없음 · 등록 한 줄 · 해제 한 줄(★Codex 4R ~ 7R · 옵션 불일치 · signal 미지원 브라우저 둘 다 막는다)
    expect(hook.match(/addEventListener\(/g)).toHaveLength(1);
    expect(hook.match(/removeEventListener\(/g)).toHaveLength(1);
    expect(hook).toContain("doc.addEventListener('visibilitychange', onVisible);");
    expect(hook).toContain("doc.removeEventListener('visibilitychange', onVisible);");
    expect(hook).not.toMatch(/signal|AbortController/);
    const terms = code(fe('pages', 'TermsPage.tsx'));
    const modal = code(fe('components', 'LoginPolicyNoticeModal.tsx'));
    for (const src of [terms, modal]) {
      expect(src).not.toContain('isTermsRevisionEffective(');
      expect(src.match(/useTermsRevisionEffective\(\)/g)).toHaveLength(1);
    }
    // 약관 네 조항이 같은 값 하나를 받는다
    expect(terms).toContain('const revised = useTermsRevisionEffective();');
    expect(terms.match(/<RevisedClause\b/g)).toHaveLength(4);
    expect(terms.match(/<RevisedClause effective=\{revised\}/g)).toHaveLength(4);
  });

  it('약관 화면 · 안내 창은 상수를 읽고 날짜를 따로 적지 않는다', () => {
    for (const src of [code(fe('pages', 'TermsPage.tsx')), code(fe('components', 'LoginPolicyNoticeModal.tsx'))]) {
      expect(src).not.toContain(TERMS_REVISION_EFFECTIVE_DATE_TEXT);
      expect(src).not.toMatch(/2026-12-0\d/);
    }
  });
});

describe('★Codex 3R 시행 감시 = 가짜 시계로 실제로 돌린다(화면을 연 채 · 다시 보이는 신호 없이)', () => {
  /** 숨김 상태를 바꿀 수 있는 문서 대역(Node EventTarget) · 듣기 수 = 대역에 실제로 남은 visibilitychange 등록(★Codex 4R · 5R) */
  function fakeDoc(state: 'visible' | 'hidden' = 'visible') {
    const t = new EventTarget() as EventTarget & { visibilityState: 'visible' | 'hidden'; registered: () => number };
    t.visibilityState = state;
    t.registered = () => getEventListeners(t, 'visibilitychange').length;
    return t;
  }
  const watch = (onEffective: () => void, doc: ReturnType<typeof fakeDoc>) => watchTermsRevision(onEffective, doc as unknown as Document);

  it('시행 5초 전에 연 화면: 4.999초 뒤에는 그대로 · 5초 뒤 한 번 · 그 뒤로 걸린 것 0', () => {
    vi.useFakeTimers();
    vi.setSystemTime(TERMS_REVISION_EFFECTIVE_AT_MS - 5000);
    const hit = vi.fn();
    const doc = fakeDoc();
    watch(hit, doc);
    expect(doc.registered()).toBe(1);
    vi.advanceTimersByTime(4999);
    expect(hit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(hit).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(doc.registered()).toBe(0);
    vi.advanceTimersByTime(DAY);
    expect(hit).toHaveBeenCalledTimes(1);
  });

  it('시행 40일 전에 연 화면: 상한(약 24.8일)으로 끊긴 대기가 먼저 터져도 시행으로 바뀌지 않고, 시행 시각에 한 번', () => {
    vi.useFakeTimers();
    vi.setSystemTime(TERMS_REVISION_EFFECTIVE_AT_MS - 40 * DAY);
    const hit = vi.fn();
    watch(hit, fakeDoc());
    vi.advanceTimersByTime(2 ** 31 - 1);
    expect(hit).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(40 * DAY - (2 ** 31 - 1) - 1);
    expect(hit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(hit).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('타이머가 늦은 경우(잠자기): 시각이 지난 뒤 다시 보이면 바로 · 숨김 신호로는 안 바뀐다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(TERMS_REVISION_EFFECTIVE_AT_MS - 10 * DAY);
    const hit = vi.fn();
    const doc = fakeDoc('hidden');
    watch(hit, doc);
    vi.setSystemTime(TERMS_REVISION_EFFECTIVE_AT_MS + 1);   // 시계만 넘어가고 타이머는 아직
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(hit).not.toHaveBeenCalled();
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(hit).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(doc.registered()).toBe(0);
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(hit).toHaveBeenCalledTimes(1);
  });

  it('화면이 닫히면(정리) 타이머 · 듣기 0 · 시행 시각이 와도 안 부른다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(TERMS_REVISION_EFFECTIVE_AT_MS - 5000);
    const hit = vi.fn();
    const doc = fakeDoc();
    const stop = watch(hit, doc);
    expect(doc.registered()).toBe(1);
    stop();
    expect(vi.getTimerCount()).toBe(0);
    expect(doc.registered()).toBe(0);
    vi.advanceTimersByTime(10_000);
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(hit).not.toHaveBeenCalled();
  });
});

describe('약관 화면 = 시행 전 현행 + 예고 · 시행일부터 개정문', () => {
  it('시행 전: 현행 제42조 제3항이 보이고 개정 · 신설 조항은 시행일이 붙은 예고다', () => {
    const { terms } = renderAt(TERMS_REVISION_EFFECTIVE_AT_MS - 1);
    const a41 = article(terms, 41);
    const a42 = article(terms, 42);
    expect(a41).toContain(`[신설 예고, ${TERMS_REVISION_EFFECTIVE_DATE_TEXT} 시행] ${ART41_5}`);
    expect(a42).toContain(ART42_3_OLD);
    expect(a42).toContain(`[개정 예고, ${TERMS_REVISION_EFFECTIVE_DATE_TEXT} 시행] ${ART42_3}`);
    expect(a42.indexOf(ART42_3_OLD)).toBeLessThan(a42.indexOf('[개정 예고'));
    expect(a42).toContain(`[신설 예고, ${TERMS_REVISION_EFFECTIVE_DATE_TEXT} 시행] ${ART42_6}`);
    expect(a42).toContain(`[신설 예고, ${TERMS_REVISION_EFFECTIVE_DATE_TEXT} 시행] ${ART42_7}`);
    expect(terms).toContain(ADDENDUM_3);
  });

  it('시행일부터: 개정문만 · 현행 「최대 10개」와 예고 표시 0', () => {
    const { terms } = renderAt(TERMS_REVISION_EFFECTIVE_AT_MS);
    const a41 = article(terms, 41);
    const a42 = article(terms, 42);
    expect(a41).toContain(ART41_5);
    for (const t of [ART42_3, ART42_6, ART42_7]) expect(a42).toContain(t);
    expect(a42.indexOf(ART42_6)).toBeLessThan(a42.indexOf(ART42_7));
    expect(terms).not.toContain('최대 10개');
    expect(terms).not.toContain('예고,');
    expect(terms).toContain(ADDENDUM_3);
  });
});

describe('로그인 안내 창 1쪽 = 약관 개정', () => {
  it('시행 전 · 후 머리 문구가 바뀌고 날짜는 상수 그대로', () => {
    const before = renderAt(TERMS_REVISION_EFFECTIVE_AT_MS - 1).modal;
    expect(before).toContain('이용약관이 바뀝니다');
    // 날짜는 굵은 글씨(<b>)라 글자만 뽑으면 「일」 뒤에 띄어쓰기 하나가 낀다
    expect(before).toContain(`${TERMS_REVISION_EFFECTIVE_DATE_TEXT} 부터 시행합니다.`);
    const after = renderAt(TERMS_REVISION_EFFECTIVE_AT_MS).modal;
    expect(after).toContain('이용약관이 바뀌었습니다');
    expect(after).toContain(`${TERMS_REVISION_EFFECTIVE_DATE_TEXT} 부터 시행 중입니다.`);
  });

  it('첫 쪽에 약관 세 항목 · 해지 요청권과 동의 간주 조건 · 약관 전문(상대 주소) · 다음 단추 · 확인 단추 없음', () => {
    const { modal, modalHtml } = renderAt(TERMS_REVISION_EFFECTIVE_AT_MS - 1);
    for (const c of TERMS_CHANGES) {
      expect(modal).toContain(c.title);
      expect(modal).toContain(c.detail);
    }
    expect(modal).toContain(REFUSAL);
    expect(modalHtml).toMatch(/<a href="\/terms" target="_blank" rel="noopener noreferrer"[^>]*>\s*약관 전문 보기\s*<\/a>/);
    expect(modalHtml.match(/href="[^"]*"/g)).toEqual(['href="/terms"']);   // 밖으로 나가는 링크 0(아이콘 svg 의 xmlns 는 링크가 아니다)
    expect(modal).toContain('1 / 2');
    expect(modal).toMatch(/다음\s*$/);
    expect(modal).not.toContain('확인했습니다');
    expect(modal).not.toContain('로그인할 때마다 휴대폰 인증번호 입력');   // 2쪽(인증 안내)은 첫 쪽에 안 그려진다
  });

  it('요약은 원문 범위를 지킨다(요청 주체 = 장관 · 중지 대상 = 전기통신역무 · URL 은 「할 수 있다」)', () => {
    const [art41, , url] = TERMS_CHANGES;
    expect(art41.detail).toContain('과학기술정보통신부 장관 또는 한국인터넷진흥원의 요청');
    expect(art41.detail).toContain('해당 회선에 대한 전기통신역무의 제공을 중지할 수 있습니다');
    expect(url.title).toContain('검사할 수 있습니다');
    expect(url.detail).toContain('분석할 수 있고');
    expect(url.detail).toContain('발송을 차단할 수 있습니다');
    expect(url.detail).toContain('차단한 URL과 차단 건수 등 차단 정보');
    expect(TERMS_CHANGES.map((c) => c.detail.match(/제4\d조 제\d항/)?.[0])).toEqual(['제41조 제5항', '제42조 제3항', '제42조 제6항']);
  });

  it('확인 단추는 하나 · 마지막 쪽(인증 안내)에만 · 닫기만 한다 · 쪽 넘김 단추가 있다', () => {
    const src = code(fe('components', 'LoginPolicyNoticeModal.tsx'));
    expect(src.match(/확인했습니다/g)).toHaveLength(1);
    expect(src).toContain('const [page, setPage] = useState<0 | 1>(0);');
    expect(src).toContain('onClick={() => setPage(1)}');
    expect(src).toContain('onClick={() => setPage(0)}');
    const confirm = src.slice(src.indexOf('ref={confirmRef}'), src.indexOf('확인했습니다'));
    expect(confirm).toContain('onClick={onClose}');
    expect(confirm).not.toContain('hideToday');
    expect(src.indexOf('ref={nextRef}')).toBeLessThan(src.indexOf('ref={confirmRef}'));
    // 쪽마다 주 단추로 초점 · Escape = 닫기(쪽과 무관)
    expect(src).toContain('(page === 0 ? nextRef : confirmRef).current?.focus();');
    expect(src).toMatch(/if \(e\.key === 'Escape'\) onClose\(\);/);
  });
});

describe('새로 쓴 고객 글에 가운뎃점 · 줄표 0', () => {
  it('약관 새 문단 · 예고 표시 · 안내 창 첫 쪽', () => {
    const before = renderAt(TERMS_REVISION_EFFECTIVE_AT_MS - 1);
    const preview = before.terms.match(/\[(개정|신설) 예고[^\]]*\]/g) || [];
    expect(preview).toHaveLength(4);
    for (const t of [ART41_5, ART42_3, ART42_6, ART42_7, ADDENDUM_3, REFUSAL, ...preview, before.modal]) {
      expect(t).not.toMatch(/[·—]/);
    }
  });
});
