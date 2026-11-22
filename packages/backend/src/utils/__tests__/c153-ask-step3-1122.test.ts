/**
 * C153 한 줄로 묻기 3단계 재작성 — 소스 계약 · 순수 함수(★ 2026-11-22 · 설계서 docs/2026-11-22-c153-ask-step3-redesign-design.md §5)
 *   K1 내용 = 사람의 한 줄(필수) · 묶음 고정 문장 0
 *   K2 종류 · 오실 곳 입력 검사 · 과금 키 = 사람 입력 전부
 *   K3 쓰는 범위 블록 · 안전망 낱말 · 혜택 근거 분리(목적 글 = 한 줄 전체 · 혜택 근거 = 갈래마다 · 날짜 · 사실 근거 = 사람이 적은 글 전부)
 *   K4 화면 = 2단계 다음에 생성 0 · 「문안 만들기」만 만든다 · 입력 지문
 *   K5 보내기 차례 = 명단 → 적재 → 집계 → 확인 → 확정 · 응답을 못 받으면 새 적재 0 · 발신 인증
 *   K6 직접발송 창 넘기기('ask') 0
 *   K7 칩 = AI 한줄로 부품 하나 · 늦은 보고를 받는 동안 이어 읽기(서버 값) · 같은 글 재검사 0
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  ASK_GROUPS, askComposeLicense, askUngroundedWords, readAskPlace, ASK_SCOPE_RULE, ASK_PLACE_Q, ASK_PLACE_ANSWER, ASK_UNGROUNDED_WATCH,
} from '../ask-segments';
import { LINE_LINK_ASK } from '../ai-line';
import { VOICE_FORM_ASK } from '../voice-form-slots';
import { findInventedBenefits, findInventedDates } from '../copy-benefit-detector';
import { buildLineEventText } from '../one-line-facts';
import {
  askInputFp, askComposeBlock, askDefaultTypes, askSpamNote, askTakeBlock, ASK_COPY_TYPES, ASK_LINE_MIN,
} from '../../../../frontend/src/utils/ai-ask';

const ROOT = join(__dirname, '..', '..', '..', '..', '..');
const BE = join(__dirname, '..', '..');
const FE = join(ROOT, 'packages', 'frontend', 'src');
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
function routeBody(src: string, head: string): string {
  const i = src.indexOf(head);
  if (i < 0) throw new Error(`주소 없음: ${head}`);
  const j = src.indexOf('\nrouter.', i + head.length);
  return src.slice(i, j < 0 ? undefined : j);
}
const order = (src: string, ...marks: string[]) => marks.map((m) => { const i = src.indexOf(m); if (i < 0) throw new Error(`없음: ${m}`); return i; });
const ascending = (xs: number[]) => xs.every((x, i) => i === 0 || xs[i - 1] < x);

const routes = read(join(BE, 'routes', 'ai-line.ts'));
const seg = read(join(BE, 'utils', 'ask-segments.ts'));
const svc = read(join(BE, 'services', 'ai-line.ts'));
const page = read(join(FE, 'pages', 'AiAskPage.tsx'));
const compose = routeBody(routes, "router.post('/ask/compose'");

describe('K1 내용 = 사람의 한 줄(필수) · 묶음 고정 문장 0', () => {
  it('한 줄이 없거나 짧으면 차감 전에 400 LINE_REQUIRED · 대상 세기 · 생성보다 앞', () => {
    expect(compose).toContain("const line = readLine(b.line);");
    expect(compose).toContain("code: 'LINE_REQUIRED'");
    expect(ascending(order(compose, "code: 'LINE_REQUIRED'", 'await countAskPlan(', 'await runLineCompose('))).toBe(true);
  });
  it('묶음마다 정해 둔 문장(purpose · askGroupLine)이 없다 — 근거로 쓸 고정 문장 자체가 없다', () => {
    expect(seg).not.toContain('askGroupLine');
    expect(seg).not.toMatch(/purpose\s*:/);
    for (const g of ASK_GROUPS) expect(Object.keys(g).sort()).toEqual(['cells', 'desc', 'key', 'name']);
  });
  it('목적 글 = 사람의 한 줄 그대로(세 갈래 모두)', () => {
    for (const mode of ['line', 'custom', 'none'] as const) {
      expect(askComposeLicense('겨울 니트가 새로 들어왔어요', mode, mode === 'custom' ? '15% 쿠폰' : null, false).licenseLine).toBe('겨울 니트가 새로 들어왔어요');
    }
    expect(compose).toContain('line: lic.licenseLine,');
  });
});

describe('K2 종류 · 오실 곳 · 과금 키', () => {
  it('종류 = 아는 값 1 ~ 3개(공용 검사 sanitizeLineTypes) · 틀리면 400 TYPES_INVALID · 고른 종류를 그대로 만든다', () => {
    expect(compose).toContain('const types = sanitizeLineTypes(b.types);');
    expect(compose).toContain("code: 'TYPES_INVALID'");
    expect(compose).toMatch(/\n\s+types, vars: \[\], channel, isAd: true, attemptToken: b\.attemptToken,/);   // ★ C157 — 종류 = 사람이 고른 값(없으면 LMS)
    expect(compose).not.toContain("types: ['benefit']");
  });
  it('오실 곳 = none · store · online · 모르는 값 = null(400) · 없음 = 적지 않음', () => {
    expect(readAskPlace(undefined)).toBe('none');
    expect(readAskPlace('none')).toBe('none');
    expect(readAskPlace('store')).toBe('store');
    expect(readAskPlace('online')).toBe('online');
    expect(readAskPlace('mall')).toBeNull();
    expect(readAskPlace(1)).toBeNull();
  });
  it('오실 곳 답 = 그 밖 답(「확인한 사실」) · 질문 글이 목소리 꼴 칸 · 링크 질문 글과 겹치지 않는다 · 링크 = AI 한줄로 링크 답과 같은 질문 글', () => {
    const taken = [...Object.values(VOICE_FORM_ASK).map((v) => v.label), LINE_LINK_ASK.label];
    expect(taken).not.toContain(ASK_PLACE_Q);
    expect(ASK_PLACE_ANSWER).toEqual({ store: '매장 방문', online: '온라인몰' });
    expect(compose).toContain("...(place !== 'none' ? [{ q: ASK_PLACE_Q, a: ASK_PLACE_ANSWER[place] }] : []),");
    expect(compose).toContain('...(link ? [{ q: LINE_LINK_ASK.label, a: link }] : []),');
    expect(compose).toContain("const link = place === 'online' && typeof b.link === 'string' && b.link.trim() ? b.link.trim() : null;");
  });
  it('과금 키 = 사람 입력 전부(한 줄 · 묶음 · 혜택 갈래 · 혜택 글 · 오실 곳 · 링크 · 정렬한 종류 · 다시 고침) · 다시 센 수 · 참고 글 · 근거 줄은 넣지 않는다', () => {
    expect(compose).toContain("keyInput: { line, groups: plan.groups, mode, benefit: benefit || '', place, link: link || '', types: [...types].sort(), retry, ...(plan.channel ? { channel: plan.channel } : {}) },");   // ★ C157 — 종류가 LMS(기본)가 아닐 때만 키에 든다(LMS = 옛 키와 같은 값)
  });
  it('응답 = 종류별 카드 · 카드마다 자리표(hole) · 안전망 낱말(ungrounded)', () => {
    expect(compose).toContain('cards: out.cards.map((c) => ({');
    expect(compose).toContain('hole: findUneditedSendPlaceholder(c.body, c.subject) !== null,');
    expect(compose).toContain('ungrounded: askUngroundedWords(`${c.subject}\\n${c.body}`, ground),');
  });
});

describe('K3 쓰는 범위 · 안전망 · 혜택 근거 분리', () => {
  it('쓰는 범위 블록은 세 갈래 · 다시 고침 모두에 붙는다 · 지어내지 말 것과 「짧게」를 말한다', () => {
    for (const mode of ['line', 'custom', 'none'] as const) {
      for (const retry of [false, true]) {
        expect(askComposeLicense('겨울 니트 입고', mode, mode === 'custom' ? '10% 쿠폰' : null, retry).extraContext.startsWith(ASK_SCOPE_RULE)).toBe(true);
      }
    }
    for (const w of ['신제품', '행사', '체험', '상담', '매장 방문', '온라인몰', '지어내지 않는다', '짧게 쓴다']) expect(ASK_SCOPE_RULE).toContain(w);
    expect(compose).toContain('extraContext: lic.extraContext,');
  });
  it('안전망 = 문안에는 있고 근거(사람이 적은 글)에는 없는 낱말만', () => {
    const body = '겨울 니트가 들어왔어요. 가까운 매장에 들러 체험하고 상담도 받아 보세요.';
    expect(askUngroundedWords(body, '겨울 니트가 새로 들어왔어요')).toEqual(['매장', '체험', '상담']);
    expect(askUngroundedWords(body, '겨울 니트가 새로 들어왔어요\n매장 방문')).toEqual(['체험', '상담']);
    expect(askUngroundedWords('겨울 니트가 들어왔어요.', '겨울 니트가 새로 들어왔어요')).toEqual([]);
    expect(askUngroundedWords('', '아무 글')).toEqual([]);
    for (const w of ['매장', '신제품', '체험', '상담', '이벤트', '행사']) expect(ASK_UNGROUNDED_WATCH).toContain(w);
  });
  it('안전망의 근거 = 한 줄 + 혜택 칸 + 오실 곳 답 + 링크(사람이 적은 글 전부)', () => {
    expect(compose).toContain("const ground = [line, lic.benefit || '', ...answers.map((x) => x.a)].join('\\n');");
  });
  // 혜택 근거 = 생성기가 받는 글(갈래가 따로 주면 그것 · 아니면 목적 글 전체) · 사실 근거 = 사람이 적은 글 전부(runLineCompose 의 licenseText 와 같은 꼴)
  const benefitGroundOf = (line: string, mode: 'line' | 'custom' | 'none', benefit: string | null) => {
    const lic = askComposeLicense(line, mode, benefit, false);
    return lic.benefitGround !== undefined ? lic.benefitGround : buildLineEventText(lic.licenseLine, { benefit: lic.benefit });
  };
  const factGroundOf = (line: string, mode: 'line' | 'custom' | 'none', benefit: string | null) =>
    buildLineEventText(line, { benefit: mode === 'custom' ? benefit : null });
  it('혜택 근거 = line 은 따로 두지 않는다(한 줄 전체) · custom 은 혜택 칸 글만 · none 은 빈 글', () => {
    expect(askComposeLicense('니트 20% 할인', 'line', null, false).benefitGround).toBeUndefined();
    expect(askComposeLicense('니트 20% 할인', 'custom', ' 15% 쿠폰 ', false).benefitGround).toBe('[혜택] 15% 쿠폰');
    expect(askComposeLicense('니트 20% 할인', 'none', '무시', false).benefitGround).toBe('');
  });
  it('한 줄 「니트 20%를 할인해 드려요」(조사 붙은 할인율) — line 만 그 혜택을 허가한다 · custom 은 혜택 칸만 · none 은 허가 0', () => {
    const line = '니트 20%를 할인해 드려요';
    const out20 = '겨울 니트 20% 할인 소식입니다.';
    expect(findInventedBenefits(out20, benefitGroundOf(line, 'line', null))).toEqual([]);
    expect(findInventedBenefits(out20, benefitGroundOf(line, 'custom', '15% 쿠폰')).length).toBeGreaterThan(0);
    expect(findInventedBenefits('겨울 니트 15% 쿠폰을 드려요.', benefitGroundOf(line, 'custom', '15% 쿠폰'))).toEqual([]);
    expect(findInventedBenefits(out20, benefitGroundOf(line, 'none', null)).length).toBeGreaterThan(0);
    expect(findInventedBenefits('겨울 니트 15% 쿠폰을 드려요.', benefitGroundOf(line, 'none', null)).length).toBeGreaterThan(0);
  });
  it('한 줄에 어떤 꼴로 적혀 있든(금액 · 띄어 쓴 조사 · 전각 · 퍼센트 낱말 · 띄어 쓴 낱말) custom · none 에서는 허가되지 않는다', () => {
    const cases: Array<[string, string]> = [
      ['니트를 2만원을 깎아 드려요', '니트 2만원 할인 소식입니다.'],
      ['니트 20 % 를 할인합니다', '니트 20% 할인 소식입니다.'],
      ['니트 ２０％ 할인', '니트 20% 할인 소식입니다.'],
      ['니트 20퍼센트 할인', '니트 20% 할인 소식입니다.'],
      ['무료배송으로 보내 드려요', '지금 무료배송으로 받아 보세요.'],
      ['니트 구매 시 쿠 폰을 드려요', '니트를 사시면 쿠폰을 드려요.'],   // Codex 설계 3R — 지우는 방식이 놓치던 꼴
    ];
    for (const [line, out] of cases) {
      expect({ line, none: findInventedBenefits(out, benefitGroundOf(line, 'none', null)).length > 0 }).toEqual({ line, none: true });
      expect({ line, custom: findInventedBenefits(out, benefitGroundOf(line, 'custom', '적립금 3천원')).length > 0 }).toEqual({ line, custom: true });
    }
  });
  it('한 줄의 날짜는 세 갈래 모두 사실 근거에 남는다 — 혜택 낱말 옆의 날짜(「전시 무료 내일 오픈」)도', () => {
    const base = new Date('2026-11-22T03:00:00+09:00');
    for (const mode of ['line', 'custom', 'none'] as const) {
      const b = mode === 'custom' ? '15% 쿠폰' : null;
      expect({ mode, dates: findInventedDates('11월 30일까지 만나 보세요.', factGroundOf('겨울 니트 20% 할인, 11월 30일까지', mode, b), base) }).toEqual({ mode, dates: [] });
      expect({ mode, dates: findInventedDates('11월 23일 오픈합니다.', factGroundOf('전시 무료 내일 오픈', mode, b), base) }).toEqual({ mode, dates: [] });
    }
  });
  it('서버 = 혜택 근거를 따로 받으면 그것만 혜택 근거 · 사실 근거(factText)는 목적 글 전체 · AI 한줄로(ask 없음)는 옛 모양 그대로', () => {
    expect(compose).toContain('...(lic.benefitGround !== undefined ? { benefitGround: lic.benefitGround } : {}),');
    const fn = svc.slice(svc.indexOf('export async function runLineCompose'), svc.indexOf('// ─────────────── 꾸미기(문안 1개 · 1) ───────────────'));
    expect(fn).toContain('const splitGround = ask?.benefitGround !== undefined;');
    expect(fn).toContain('licenseText: splitGround ? ask!.benefitGround! : licenseText,');
    expect(fn).toContain('...(splitGround ? { factText: licenseText } : {}),');
    expect(fn).toContain('buildMessageObjective(licenseText, [audienceBlock, lineAnswersContext(answers), ask?.extraContext].filter(Boolean).join');
    // 출구 검사 = 효능 · 날짜는 사실 근거(따로 없으면 혜택 근거와 같은 글 = 다른 생산자는 그대로) · 혜택은 혜택 근거
    const guards = read(join(BE, 'utils', 'copy-exit-guards.ts'));
    expect(guards).toContain('const factGround = ctx.factGround ?? ctx.benefitGround;');
    expect((guards.match(/findInventedBenefits\((?:msgField|subj), ctx\.benefitGround\)/g) || []).length).toBe(2);
    expect((guards.match(/findInventedDates\((?:msgField|subj), factGround, ctx\.baseDate\)/g) || []).length).toBe(2);
    expect((guards.match(/dropInventedEfficacy\((?:msgField|subj), factGround\)/g) || []).length).toBe(2);
    const ai = read(join(BE, 'services', 'ai.ts'));
    expect(ai).toContain("...(typeof extraContext?.factText === 'string' ? { factGround: extraContext.factText } : {}),");
    // 낱말로 막기 · 한 줄에서 혜택 자리 지우기(1R · 2R 처방)는 없다
    expect(routes).not.toContain('BENEFIT_CONFLICT');
    expect(seg).not.toContain('withoutBenefitSpans');
  });
});

describe('K4 화면 — 2단계 다음에 생성 0 · 「문안 만들기」만 만든다', () => {
  it('2단계의 다음 = 3단계로 가기만 한다(생성 호출 없음) · 생성 호출은 compose 한 곳 · 그것을 부르는 것은 단추 둘(만들기 · 고쳐서 다시 만들기)', () => {
    expect(page).toContain("if (step === 2) { go(3); return; }");
    expect((page.match(/aiLineApi\.askCompose\(/g) || []).length).toBe(1);
    expect((page.match(/void compose\(/g) || []).length).toBe(2);
    expect(page).toContain('onClick={() => void compose(false)}');
    expect(page).toContain('onClick={() => void compose(true)}');
    expect(page).not.toContain('needCompose');
  });
  it('만들기 잠금 = 한 줄 5자 미만 · 종류 0개 · 받는 분 0명', () => {
    expect(askComposeBlock({ line: '짧다', types: ['emo'], planned: 10 })).toBe('line');
    expect(askComposeBlock({ line: ' '.repeat(10), types: ['emo'], planned: 10 })).toBe('line');
    expect(askComposeBlock({ line: '겨울 니트 입고', types: [], planned: 10 })).toBe('types');
    expect(askComposeBlock({ line: '겨울 니트 입고', types: ['emo'], planned: 0 })).toBe('zero');
    expect(askComposeBlock({ line: '겨울 니트 입고', types: ['emo', 'mz'], planned: 1 })).toBeNull();
    expect(ASK_LINE_MIN).toBe(5);
    expect(page).toContain("const composeBlock = askComposeBlock({ line: what, types, planned: count?.planned ?? 0, needImage: channel === 'MMS' && images.length === 0 });");   // ★ C157 — MMS 는 이미지가 있어야 만든다
    expect(page).toContain('if (making || composeBlock || countBusy) return;');
  });
  it('종류 기본값 = 혜택이 없으면 감성 쪽 · 있으면 혜택 쪽 · 아는 종류 셋', () => {
    expect(askDefaultTypes('none')).toEqual(['emo']);
    expect(askDefaultTypes('custom')).toEqual(['benefit']);
    expect(askDefaultTypes('line')).toEqual(['benefit']);
    expect([...ASK_COPY_TYPES]).toEqual(['emo', 'benefit', 'mz']);
  });
  it('입력 지문 = 한 줄 · 묶음 · 혜택 · 오실 곳 · 링크 · 종류가 바뀌면 달라진다(문안이 낡는다) · 종류 순서는 상관없다', () => {
    const base = { line: '겨울 니트 입고', groups: ['leave'] as const, mode: 'line' as const, benefit: '', place: 'none' as const, link: '', types: ['emo', 'benefit'] as const };
    const fp = askInputFp(base);
    expect(askInputFp({ ...base, types: ['benefit', 'emo'] })).toBe(fp);
    expect(askInputFp({ ...base, link: 'https://a.example' })).toBe(fp);   // 온라인이 아니면 링크는 지문 밖
    for (const changed of [
      { ...base, line: '겨울 니트 입고!' }, { ...base, groups: ['rest'] as const }, { ...base, mode: 'none' as const },
      { ...base, mode: 'custom' as const, benefit: '10% 쿠폰' }, { ...base, place: 'store' as const },
      { ...base, place: 'online' as const, link: 'https://a.example' }, { ...base, types: ['emo'] as const },
    ]) expect(askInputFp(changed)).not.toBe(fp);
  });
  it('다음(보내기 단계) 잠금 = 만드는 중 · 문안 없음 · 입력이 바뀜 · 자리표 남음 · 0명', () => {
    expect(askTakeBlock({ making: true, cardFp: 'a', nowFp: 'a', benefitHole: false, planned: 1 })).toBe('making');
    expect(askTakeBlock({ making: false, cardFp: null, nowFp: 'a', benefitHole: false, planned: 1 })).toBe('no-card');
    expect(askTakeBlock({ making: false, cardFp: 'a', nowFp: 'b', benefitHole: false, planned: 1 })).toBe('stale');
    expect(askTakeBlock({ making: false, cardFp: 'a', nowFp: 'a', benefitHole: true, planned: 1 })).toBe('hole');
    expect(askTakeBlock({ making: false, cardFp: 'a', nowFp: 'a', benefitHole: false, planned: 0 })).toBe('zero');
    expect(askTakeBlock({ making: false, cardFp: 'a', nowFp: 'a', benefitHole: false, planned: 3 })).toBeNull();
  });
  it('문안을 만드는 동안 · 보내는 동안 = 뒤로 · 이전 잠금(낸 결과를 버리는 길 0)', () => {
    // 접수 여부를 모르는 동안(unknown)에도 잠긴다 = 쥐고 있는 확정 본문과 화면의 문안이 달라지지 않는다
    expect(page).toContain("<button type=\"button\" disabled={answering || making || sending || !!unknown || sendLocked} onClick={() => (sent ? restart() : inAnswer ? closeThread() : step === 0 ? navigate('/dashboard') : go((step - 1) as Step))}");   // ★ C155 — 답 화면의 뒤로 = 대화 닫기
    expect(page).toContain('<button type="button" disabled={making || sending || !!unknown || sendLocked} onClick={() => go((step - 1) as Step)}');   // ★ C157 — 칼럼을 넣는 동안 · 이미지를 올리는 동안에도 잠긴다
  });
});

// ★ 2026-11-22 C157 — 명단 · 적재 · 집계를 화면이 잇지 않는다: 서버 적재 한 번(POST /ask/stage)이 명단을 싣고 고정한다(설계서 docs/2026-11-22-c157-ask-send-options-design.md D1)
describe('K5 보내기 — 서버 적재 → 확인 → 확정', () => {
  const send = page.slice(page.indexOf('const prepareSend = async'), page.indexOf('const bodyRef = useRef'));
  const commit = page.slice(page.indexOf('const commitSend = async'), page.indexOf('const recheckSend = async'));
  const recheck = page.slice(page.indexOf('const recheckSend = async'), page.indexOf('const prepareSend = async'));
  const call = page.slice(page.indexOf('const sendCall = async'), page.indexOf('useEffect(() => { if (sent) window.scrollTo(0, 0); }, [sent]);'));
  const settle = page.slice(page.indexOf('const settle = async'), page.indexOf('const commitSend = async'));
  it('차례 = 서버 적재(명단을 지금 다시 세어 고정) → 확인 창 · 확정은 확인 창의 단추만 부른다', () => {
    expect(ascending(order(send, "sendCall('POST', '/api/ai-line/ask/stage', token,", 'setConfirm('))).toBe(true);
    expect(send).not.toContain("'/api/campaigns/direct-send/commit'");
    expect(send).not.toContain('void commitSend(job)');
    expect((send.match(/onConfirm: \(\) => \{ confirmSend\(job\); \}/g) || []).length).toBe(2);
    expect(send).toContain("if (sendCount <= 0) throw new Error(");
  });
  it('확정 본문 = 광고 · 중복 제거 · 수신거부 제거 켬 · 출처 operator(새 값 0) · 종류 · 개별 회신 · 나눠 보내기는 C157 이 채운다', () => {
    for (const s of ["sendChannel: 'sms'", 'adEnabled: true', 'dedupEnabled: true, unsubFilterEnabled: true', "sendType: 'operator'"]) expect(send).toContain(s);
  });
  it('한 번만 = 화면이 쥔 잠금 하나(준비 · 확정 · 다시 확인 모두 그 잠금) · 발신 인증 뒤에는 같은 확정 건으로만', () => {
    for (const fn of [send, commit, recheck]) expect(fn).toContain('if (sendLock.current');
    // 발신 인증 창 = 접수되지 않았음이 확인된 뒤에만(확정 응답만 보고 열지 않는다) · 통과하면 같은 확정 건으로
    // ★ Codex 구현 3R #1 · 4R #1 — 발신 인증 요구 = 끝이 아니라 같은 확정 건이 이어질 자리: 접수되지 않았음이 확인된 뒤에 창을 열고 준비분은 쥔 채(창이 떠 있는 동안 다른 준비분 0)
    expect(ascending(order(commit,
      "const authAsk = r?.data?.code === 'SENDER_AUTH_REQUIRED' && !!r?.data?.senderAuth;",
      'const reason = !rejected || authAsk ? null',
      "if ((await settle(job, reason)) !== 'none') return;",
      'if (authAsk && senderAuth.handleResponse(r!.data, resume(job))) return;'))).toBe(true);
    // ★ Codex 구현 5R — 쥔 준비분의 소유 = 한 곳(hold): 놓을 때 그 준비분에 묶인 인증 창 · 재시도도 같이 버리고, 인증 뒤 이어 가기는 그 확정 건을 지금도 쥐고 있을 때만
    const holdFn = page.slice(page.indexOf('const hold = (job: SendJob | null) => {'), page.indexOf('const resume = (job: SendJob)'));
    expect(ascending(order(holdFn, 'heldRef.current = job;', 'setUnknown(job);', 'if (!job) senderAuth.cancel();'))).toBe(true);
    expect((page.match(/setUnknown\(/g) || []).length).toBe(1);
    expect(page).toContain('const resume = (job: SendJob) => () => { if (heldRef.current === job) void commitSend(job); };');
    expect((page.match(/senderAuth\.handleResponse\(/g) || []).length).toBe(1);
    // 인증을 그만두면 = 같은 판정(접수 상태)으로 없음일 때만 놓는다 · 창의 닫는 단추 둘 다 그 길
    expect(page).toContain('if (job) void recheckSend(job, AUTH_CANCELED);');
    // ★ Codex 구현 4R · 5R · 6R 같은 부류(창이 떠 있는 동안 뒤 화면이 눌려 창의 단추와 엇갈림) — 확인 창 · 인증 창이 떠 있는 동안 뒤 화면 전체를 막는다(inert) · 보내기 단추는 inert 를 모르는 브라우저에서도 잠긴다
    expect(page).toContain('const modalOpen = !!confirm || !!senderAuth.state || mmsOpen;');   // ★ C157 — 이미지 창이 떠 있는 동안에도 뒤 화면을 막는다
    expect(page).toContain("const inertProps: Record<string, string> = modalOpen ? { inert: '' } : {};");
    expect((page.match(/\{\.\.\.inertProps\}/g) || []).length).toBe(1);
    expect(page).toContain('<div {...inertProps} className="relative mx-auto flex min-h-screen');
    expect(page).toContain(': step === 4 ? sending || countBusy || !cbChoice || (!unknown && !!block) || modalOpen');
    // 창 둘은 막는 칸 밖(뒤 화면만 막힌다)
    expect(ascending(order(page, '<div {...inertProps} className="relative mx-auto', '{cardsEl && createPortal(cardsEl, cardsHost.current!)}', '<ConfirmModal state={confirm}', '<SenderAuthModal'))).toBe(true);
    expect(page).toContain('onProceed={cancelAuth}');
    expect(page).toContain('onCancel={cancelAuth}');
    expect(page).not.toContain('={senderAuth.cancel}');
    expect((commit.match(/senderAuth\.handleResponse\(/g) || []).length).toBe(1);
    expect(page).toContain('<SenderAuthModal');
    expect(page).toContain('const senderAuth = useSenderAuth();');
  });
  // ★ Codex 구현 1R #1 · 2R #1 · #3 · 3R #1 — 접수 여부의 판정 = 서버의 접수 상태 하나 · 준비분은 보내기 전에 쥐고 놓는 자리만 정한다
  it('확정 = 보내기 전에 준비분을 쥔다 · 성공 응답만 그 자리에서 끝 · 그 밖의 모든 답은 접수 상태(settle)가 판정 — 거절 4xx 도 접수 상태가 없음일 때만 놓는다', () => {
    expect(ascending(order(commit,
      'hold(job);',
      "const r = await sendCall('POST', '/api/campaigns/direct-send/commit', job.token, job.body);",
      'if (r && r.ok && r.data?.success === true) {',
      "const rejected = !!r && r.status >= 400 && r.status < 500 && ![408, 429].includes(r.status) && r.data?.success === false && r.data?.code !== 'IN_FLIGHT';",
      "if ((await settle(job, reason)) !== 'none') return;"))).toBe(true);
    // 쥐는 자리 = 확정을 보내기 전 한 곳(그 뒤 어디서 끊겨도 남는다) · 놓는 자리 = 성공 응답 · 접수됨 · 없음 + 거절 셋뿐
    const flow = page.slice(page.indexOf('const sendCall = async'), page.indexOf('const bodyRef = useRef'));
    expect((flow.match(/hold\(job\)/g) || []).length).toBe(1);
    expect((commit.match(/hold\(null\)/g) || []).length).toBe(1);
    expect((settle.match(/hold\(null\)/g) || []).length).toBe(2);
    expect((flow.match(/hold\(null\)/g) || []).length).toBe(3);
    // 확정이 스스로 끝내는 자리 = 성공 응답 하나 · 응답 코드로 접수를 단정하는 갈래 0(같은 준비분 409 는 차감 전 처리 중도 포함하고 · 접수 뒤의 재시도는 400 으로도 온다)
    expect((commit.match(/setSent\(/g) || []).length).toBe(1);
    expect(page).not.toContain('STAGING_COMMITTED');
    // 접수 상태 판정의 차례 = 접수됨(놓는다) → 처리 중(쥔 채) → 없음 + 거절(놓는다) → 없음(부른 쪽이 잇는다) → 못 읽음(쥔 채)
    expect(ascending(order(settle,
      '`/api/ai-line/ask/sent/${encodeURIComponent(String(job.body.stagingId))}`',
      "if (state === 'accepted') {", "return 'ended';", "if (state === 'pending') {", "return 'held';",
      "if (state === 'none' && reason !== null) {", "return 'released';", "if (state === 'none') return 'none';", 'setSendError(CHECK_AGAIN);'))).toBe(true);
    expect((settle.match(/return 'held';/g) || []).length).toBe(2);
    expect(settle).not.toContain('hold(job)');
  });
  it('모름 상태에서는 다시 확인만 · 접수 상태를 먼저 묻고 없음일 때만 같은 확정 건으로 다시(새 명단 · 새 적재 0)', () => {
    expect(ascending(order(send, 'if (sendLock.current || sending) return;', 'if (heldRef.current) { void recheckSend(heldRef.current); return; }', "'/api/ai-line/ask/stage'"))).toBe(true);
    expect(ascending(order(recheck, "again = (await settle(job, reason)) === 'none';", 'if (again) void commitSend(job);'))).toBe(true);
    for (const fn of [recheck, settle, commit]) { expect(fn).not.toContain("'/api/campaigns/direct-send/stage'"); expect(fn).not.toContain("'/api/ai-line/ask/stage'"); }
  });
  // ★ Codex 구현 1R #2 · 2R #2 — 화면 · 계정의 문은 서버 호출 한 곳(sendCall)에 있다(부르는 자리마다 두지 않는다)
  it('보내기 흐름의 문 = sendCall 한 곳(떠난 화면 · 바뀐 계정이면 요청을 보내지 않는다) · 인증은 시작할 때 한 번 읽어 끝까지', () => {
    expect(ascending(order(call, "if (!alive.current) throw new Error('');", "if ((localStorage.getItem('token') || '') !== token) throw new Error(ACCOUNT_CHANGED);", 'const res = await fetch(path, {'))).toBe(true);
    expect(call).toContain("headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },");
    // 보냈는데 답을 못 받음 = null(던지지 않는다 = 문에 걸린 것과 섞이지 않는다) · 본문을 못 읽음 = data null
    expect(ascending(order(call, 'const res = await fetch(path, {', 'return { ok: res.ok, status: res.status, data: await res.json().catch(() => null) };', '} catch {', 'return null;'))).toBe(true);
    const flow = page.slice(page.indexOf('const sendCall = async'), page.indexOf('const bodyRef = useRef'));
    expect((flow.match(/\bfetch\(/g) || []).length).toBe(1);
    expect(flow).not.toContain('aiLineApi.');
    // 인증을 읽는 자리 = 흐름의 시작(prepareSend) 하나 + 문의 대조 하나 · 부르는 자리의 따로 검사 0
    expect((flow.match(/localStorage\.getItem\('token'\)/g) || []).length).toBe(2);
    expect(send).toContain("const token = localStorage.getItem('token') || '';");
    expect(send).toContain('const job: SendJob = {\n        token, shown: sendCount,');
    expect(flow).not.toContain('proceed(');
    // 떠난 화면에는 글을 쓰지 않는다(문이 던진 빈 오류)
    for (const fn of [send, commit, recheck]) expect(fn).toContain('if (alive.current) setSendError(');
    // 결과 화면으로 올리는 자리 = 상태 따라 한 곳(떠난 화면에서는 돌지 않는다)
    expect(flow.match(/window\.scrollTo/g) || []).toHaveLength(1);
  });
  it('접수 상태 주소 = 요금제 관문 · 회사 범위 · 접수됨 = 발송 가능 상태로 넘어간 단계만(차감 전 preparing 은 처리 중)', () => {
    const sent = routeBody(routes, "router.get('/ask/sent/:stagingId'");
    expect(ascending(order(sent, 'await lineGate(req, res)', 'await askStagingState(v.companyId, req.params.stagingId)'))).toBe(true);
    expect(seg).toContain("BOOL_OR(send_phase IN ('queued', 'processing', 'sent'))");
    expect(seg).toContain("BOOL_OR(send_phase = 'preparing')");
    // 처리 중이 오래 풀리지 않음 = 서버가 stuck 으로 알린다(none 으로 바꾸지 않는다 = 새로 보내게 두지 않는다) · 화면은 확인 번호를 보여 준다
    expect(seg).toContain("return { state, stuck: state === 'pending' && (Number(r.rows[0]?.pending_sec) || 0) >= ASK_PENDING_STUCK_SEC };");
    expect(page).toContain('String(job.body.stagingId).slice(0, 8)');
    expect(seg).toContain('FROM campaigns WHERE staging_id = $1::uuid AND company_id = $2::uuid`');
    // 접수됨으로 보는 단계 = 확정 몸통이 「전환이 실제로 됐다」로 보는 값과 같다
    const core = read(join(BE, 'utils', 'direct-send-core.ts'));
    expect(core).toContain("if (phaseAfter === 'queued' || phaseAfter === 'processing' || phaseAfter === 'sent') {");
  });
  it('도착 확인 한 줄 = 그 글로 확인하지 않음 · 막힘 · 진행 중 · 결과 없음 · 통과(빈 글)', () => {
    expect(askSpamNote(undefined, 'a')).toContain('도착 확인을 하지 않았어요');
    expect(askSpamNote({ state: 'pass', fp: 'b' }, 'a')).toContain('도착 확인을 하지 않았어요');
    expect(askSpamNote({ state: 'pass', fp: 'a' }, 'a')).toBe('');
    expect(askSpamNote({ state: 'blocked', fp: 'a', carriers: [{ carrier: 'LGU', result: 'blocked' }] }, 'a')).toContain('LGU');
    expect(askSpamNote({ state: 'running', fp: 'a' }, 'a')).toContain('아직 끝나지 않았어요');
    expect(askSpamNote({ state: 'warn', fp: 'a' }, 'a')).toContain('아직 받지 못한 통신사');
    expect(askSpamNote({ state: 'no_balance', fp: 'a' }, 'a')).toContain('하지 못했어요');
  });
});

describe('K6 직접발송 창 넘기기 0', () => {
  it("한 줄로 묻기는 넘기지 않는다 · 넘기기 원장에 'ask' 갈래가 없다 · 대시보드도 그 갈래를 보지 않는다", () => {
    expect(page).not.toContain('stashAudience');
    expect(page).not.toContain('open=direct-send');
    const pi = read(join(FE, 'utils', 'product-insight.ts'));
    expect(pi).not.toContain("kind: 'ask'");
    expect(pi).not.toContain('AskHandoff');
    const dash = read(join(FE, 'pages', 'Dashboard.tsx'));
    expect(dash).not.toContain("asked.kind === 'ask'");
    expect(dash).not.toContain('fetchAskAudience');
    expect(dash).toContain('const asked = takeAudience();');
  });
});

describe('K7 칩 = AI 한줄로 부품 하나 · 늦은 보고', () => {
  const cards = read(join(FE, 'components', 'ai-line', 'LineResultCards.tsx'));
  const spam = read(join(BE, 'services', 'ai-line-spam.ts'));
  const view = read(join(BE, 'utils', 'spam-test-view.ts'));
  it('한 줄로 묻기 = 그 부품을 쓴다 · 자체 칩 코드(시작 · 읽기)가 없다', () => {
    expect(page).toContain('<LineResultCards');
    // ★ Codex 구현 1R #3 · 2R #4 · 3R #2 — 부품은 한 벌 · 수명 = 문안(run)의 수명(단계가 바뀌어도 내려가지 않는다 = 한 문안의 검사 응답을 받는 부품이 언제나 하나 · 새 문안이면 새 부품)
    expect((page.match(/<LineResultCards/g) || []).length).toBe(1);
    expect(page).toContain('      key={run.runId}\n      run={run} pickedType={pickedType}');
    // ★ Codex 구현 4R #2 — 보낸 뒤에는 부품을 내린다(결과 화면에서 새 유료 검사를 걸지 않는다)
    expect(page).toContain('const cardsEl = run && run.cards.length > 0 && !sent ? (');
    // 그리는 자리 = 단계 밖 한 곳(한 번 만든 자리로 보내는 portal) · 단계 안에는 그 자리를 끼우는 칸 하나(다른 단계에서는 화면에 없는 채로 계속 읽는다)
    expect((page.match(/\{cardsEl\}/g) || []).length).toBe(0);
    expect((page.match(/createPortal\(/g) || []).length).toBe(1);
    expect(page).toContain('{cardsEl && createPortal(cardsEl, cardsHost.current!)}');
    expect((page.match(/ref=\{cardsSlot\}/g) || []).length).toBe(1);
    expect(page).toContain("if (!cardsHost.current) cardsHost.current = document.createElement('div');");
    // 끼우는 함수 = 고정(그릴 때마다 다시 끼우면 칸 안의 초점이 날아간다)
    expect(page).toContain('const cardsSlot = useCallback((slot: HTMLDivElement | null) => { if (slot) slot.appendChild(cardsHost.current!); }, []);');
    // ★ Codex 구현 1R #3 — 칩 갱신은 그 카드가 그려진 문안(runId)일 때만(다시 만든 뒤 늦게 온 옛 문안의 검사 응답이 새 문안의 칩을 덮지 않는다)
    expect(page).toContain('onSpamPatch={(t, chip) => setRun((r) => (r && r.runId === run.runId ? { ...r, spam: { ...r.spam, [t]: chip } } : r))}');
    expect(page).not.toContain('onSpamPatch={(t, chip) => setRun((r) => (r ? {');
    expect(page).not.toContain('aiLineApi.spamStart(');
    expect(page).not.toContain('aiLineApi.spamRead(');
    expect(page).not.toContain('chipOf');
  });
  it('보기의 lateOpen = 결과 없음일 때만 서버 판정(readSpamTestOutcome) · 그 밖 false', () => {
    expect(view).toContain("lateOpen: state === 'warn' ? (await readSpamTestOutcome(testId)).lateOpen : false,");
  });
  it('같은 글 다시 걸기 = 결과 없음이어도 늦은 보고를 받는 동안은 그 검사를 이어 본다 · 오늘 검사가 없으면 어제까지 넓혀 그 조건일 때만', () => {
    const fn = spam.slice(spam.indexOf('export async function reusableLineSpamTest'), spam.indexOf('export async function startLineSpamTest'));
    expect(fn).toContain("if (read.state !== 'warn' || read.lateOpen) return { state: read.state, testId: same.testId, reused: true, ...(read.lateOpen ? { lateOpen: true } : {}) };");
    expect(ascending(order(fn, 'const same = await spamCheckFor(key);', 'const prev = await spamCheckFor(key, undefined, 2);', "return read.state === 'warn' && read.lateOpen ? { state: 'warn', testId: prev.testId, reused: true, lateOpen: true } : null;"))).toBe(true);
    // 시작 주소 = 회사 잠금 안에서 그 판정 하나를 부르고, 이어 볼 것이 있으면 줄 대기 · 등록보다 먼저 돌려준다
    const startLocked = spam.slice(spam.indexOf('async function startLocked'), spam.indexOf('const out = await enqueueSpamTest('));
    expect(ascending(order(startLocked, 'await reusableLineSpamTest(', 'if (reuse) return reuse;', "status IN ('queued', 'active')"))).toBe(true);
  });
  it('화면 = 서버 lateOpen 인 동안만 이어 읽는다(화면 시계 0) · 읽을 때마다 그 값을 받는다 · 글이 갈린다', () => {
    expect(cards).toContain("export const lateOpen = (chip: AiLineSpamChip | undefined): boolean => !!chip && chip.state === 'warn' && !!chip.testId && chip.lateOpen === true;");
    expect(cards).toContain("|| lateOpen(run.spam[t])) && run.spam[t]?.testId);");
    expect(cards).toContain('lateOpen: r.lateOpen === true });');
    // ★ C157 구현 Codex 2R — 늦은 보고 여부는 검사 번호 · 지문 · 종류와 같이 움직인다(busy = 앞 검사의 것 · 새 검사 = 서버 값)
    expect(cards).toContain('? { testId: prev?.testId, fp: prev?.fp, channel: prev?.channel, lateOpen: prev?.lateOpen }');
    expect(cards).toContain(': { testId: out.testId, fp, channel: ch, lateOpen: out.lateOpen === true };');
    expect(cards).toContain("run.spam[t]?.lateOpen === true]])));");
    expect(cards).toContain('도착 확인이 늦어요 · ');
    expect(cards).toContain("text: '결과 없음 · 다시 검사'");
    expect(cards).not.toContain('startedAt');
    // ★ Codex 구현 2R #4 — 부품이 응답을 수명(mounted)으로 가르지 않는다(다른 문안 = 부모의 runId 대조 · 같은 문안 = 부품이 하나뿐)
    expect(cards).not.toContain('mounted');
    expect((cards.match(/latest\.current\.run\.runId !== cur\.run\.runId\) return;/g) || []).length).toBe(2);
    expect(cards).not.toContain('Date.now()');
  });
});
