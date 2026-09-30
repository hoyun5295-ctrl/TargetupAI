/**
 * 프롬프트 점검 · 강화 (2026-09-30 · 장부 docs/2026-09-30-ai-model-prompt-upgrade.md §3)
 *
 * 못 박는 것:
 *   WP1 발송 길목 — 채우지 않은 링크 · AI 혜택 자리는 캠페인 생성 · 예약 문안 수정 · 브랜드메시지 · 직접 발송 공통 길목에서 막힌다.
 *       고객이 직접 쓴 "[혜택]" 제목 줄은 막지 않는다(정확한 AI 문구만).
 *   WP2 혜택 대조 — 새로 쓰는 문안 = 값 기준(표현이 달라도 같은 값은 통과 · 지어낸 값 · 낱말만 자리표시) ·
 *       다시 쓰는 문안 = 원문에 없던 숫자(90분 · 3일 한정 등)를 잡는다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  findInventedBenefits, replaceInventedBenefits, findNewNumbers, hasAiFillPlaceholder, BENEFIT_PLACEHOLDER, AI_FILL_PLACEHOLDERS, AI_FILL_DIRECT_PATTERN,
  replaceInventedBenefitsInHtml, htmlVisibleText,
} from '../copy-benefit-detector';
import { scanSources, SCAN_TIMEOUT_MS } from './source-scan';
import { findUneditedSendPlaceholder } from '../send-placeholder-gate';
import { LINK_PLACEHOLDER } from '../brand-link-core';
import { plainTextFromAi } from '../ai-json';

const SRC = (...p: string[]) => readFileSync(resolve(process.cwd(), 'src', ...p), 'utf8');

describe('WP1 발송 길목 자리표시 가드', () => {
  it('AI 가 넣는 직접 채울 자리 문구는 잡고, 고객이 쓴 [혜택] 제목 줄은 잡지 않는다', () => {
    expect(hasAiFillPlaceholder(`가을 신상 ${BENEFIT_PLACEHOLDER} 놓치지 마세요`)).toBe(true);
    expect(hasAiFillPlaceholder('[혜택 안내: 직접 작성해주세요]')).toBe(true);
    expect(hasAiFillPlaceholder('[혜택] 30% 할인\n[기간] 10/1~10/5')).toBe(false);
    expect(hasAiFillPlaceholder('【혜택】 사은품 증정')).toBe(false);
    expect(hasAiFillPlaceholder('')).toBe(false);
  });
  it('링크 자리를 먼저 본다(종전 문구 · 코드 그대로) · 제목에 남은 자리도 잡는다', () => {
    expect(findUneditedSendPlaceholder(`바로가기 ${LINK_PLACEHOLDER}`)?.code).toBe('LINK_PLACEHOLDER_UNEDITED');
    expect(findUneditedSendPlaceholder('본문 정상', `가을 ${BENEFIT_PLACEHOLDER}`)?.code).toBe('BENEFIT_PLACEHOLDER_UNEDITED');
    expect(findUneditedSendPlaceholder('[혜택] 30% 할인', null, undefined)).toBeNull();
  });
  it('캠페인 생성 · 예약 문안 수정 · 브랜드메시지 · 옛 동기 직접발송(AI 오퍼레이터) · 직접 발송 공통 · 자동발송 길목이 같은 CT 를 부른다', () => {
    const c = SRC('routes', 'campaigns.ts');
    expect((c.match(/findUneditedSendPlaceholder\(/g) || []).length).toBe(4);
    expect(c).not.toContain('hasUneditedLinkPlaceholder(');
    expect(c).toContain('findUneditedSendPlaceholder(messageContent, subject)');
    expect(c).toContain('findUneditedSendPlaceholder(message, subject)');
    // 옛 동기 /direct-send — 차감 앞(링크 결함 검사 바로 뒤)에서 막는다
    const syncStart = c.indexOf("router.post('/direct-send', async");
    const syncGate = c.indexOf('findUneditedSendPlaceholder(...textsToCheck, alimtalkNextContents, alimtalkNextSubject)');
    const syncDeduct = c.indexOf('const directDeduct = await prepaidDeduct(');
    expect(syncStart).toBeGreaterThan(0);
    expect(syncGate).toBeGreaterThan(syncStart);
    expect(syncGate).toBeLessThan(syncDeduct);
    const d = SRC('utils', 'direct-send-core.ts');
    expect(d).toContain('findUneditedSendPlaceholder(spec.message, spec.subject, spec.alimtalkNextContents, spec.alimtalkNextSubject)');
    expect(d.indexOf('findUneditedSendPlaceholder(')).toBeLessThan(d.indexOf('await prepaidDeduct('));
    expect(d).not.toContain('hasUneditedLinkPlaceholder(');
    // 자동발송 — 캠페인 행 생성 · 차감 앞
    const w = SRC('utils', 'auto-campaign-worker.ts');
    const wExec = w.indexOf('async function executeAutoCampaign(');
    const wGate = w.indexOf('findUneditedSendPlaceholder(messageContent, messageSubject)', wExec);
    expect(wGate).toBeGreaterThan(wExec);
    expect(wGate).toBeLessThan(w.indexOf('INSERT INTO campaigns (', wExec));
    expect(wGate).toBeLessThan(w.indexOf('await prepaidDeduct(', wExec));
    expect(SRC('utils', 'planner-executor.ts')).toContain("'BENEFIT_PLACEHOLDER_UNEDITED'");
  });

  it('"직접 …해주세요" 꼴 자리는 문구가 달라도 잡는다 · "직접" 없는 고객 안내 문구는 잡지 않는다', () => {
    expect(hasAiFillPlaceholder('[포인트 소멸 전 사용 안내 또는 회사가 제공할 혜택과 유효기간을 직접 작성해주세요]')).toBe(true);
    expect(hasAiFillPlaceholder('가을 [혜택 안내: 직접   수정해주세요] 확인')).toBe(true);
    expect(hasAiFillPlaceholder('[후기를 작성해주세요] 추첨으로 선물을 드려요')).toBe(false);
  });

  it('AI 실패 비상 문안 자리도 잡고, 어느 자리인지 안내문에 그대로 보여 준다', () => {
    const r = findUneditedSendPlaceholder('[한줄상회] 가을 신상 [혜택 내용을 입력해주세요] 자세히 보기▶');
    expect(r?.code).toBe('BENEFIT_PLACEHOLDER_UNEDITED');
    expect(r?.error).toContain('[혜택 내용을 입력해주세요]');
    expect(findUneditedSendPlaceholder('안내 [예약 정보를 작성해주세요]')?.error).toContain('[예약 정보를 작성해주세요]');
  });

  it('코드에 있는 직접 채울 자리 문구는 전부 발송 차단 목록에 있다(새 문구가 생기면 여기서 실패한다)', () => {
    const PH = /\[[^\]`'"\\\n]{0,40}(?:입력|작성|수정)(?:해\s?주세요|하세요)\]/g;
    const known = new Set<string>([...AI_FILL_PLACEHOLDERS, LINK_PLACEHOLDER]);
    const missing = new Set<string>();
    for (const { rel, src } of scanSources(resolve(process.cwd(), 'src'))) {
      if (rel.includes('__tests__')) continue;
      // 주석 줄은 문안에 실리지 않는다(설명용 표기가 섞여 있다) — 코드 줄만 본다
      const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      for (const m of code.matchAll(PH)) if (!known.has(m[0]) && !AI_FILL_DIRECT_PATTERN.test(m[0])) missing.add(`${rel}: ${m[0]}`);
    }
    expect([...missing]).toEqual([]);
  }, SCAN_TIMEOUT_MS);
});

describe('WP2 새로 쓰는 문안 = 값 기준 혜택 대조', () => {
  it('근거에 있는 값을 다르게 표현한 것은 통과한다', () => {
    expect(findInventedBenefits('★ 30% OFF 가을 신상', '가을 신상 30% 할인')).toEqual([]);
    expect(findInventedBenefits('지금 30% 할인', '가을 신상 30프로 세일')).toEqual([]);
    expect(findInventedBenefits('5,000원 쿠폰 드려요', '5천원 쿠폰 증정')).toEqual([]);
    expect(findInventedBenefits('1만5천원 할인', '15,000원 할인')).toEqual([]);
    expect(findInventedBenefits('사은품 증정 중', '구매 고객 사은품 증정 행사')).toEqual([]);
  });
  it('지어낸 값 · 구체 혜택 낱말은 잡는다', () => {
    expect(findInventedBenefits('지금 40% 할인', '가을 신상 30% 할인')).toEqual(['40%']);
    expect(findInventedBenefits('무료배송까지 챙기세요', '가을 신상 입고')).toEqual(expect.arrayContaining(['무료배송']));
    expect(findInventedBenefits('1+1 행사', '가을 신상 입고')).toEqual(['1+1']);
    expect(findInventedBenefits('적립 2배', '신상 입고')).toEqual(expect.arrayContaining(['적립']));
  });
  it("일반 낱말('할인' 등)은 값이 없으면 지어낸 사실로 보지 않는다", () => {
    expect(findInventedBenefits('할인 혜택을 놓치지 마세요', '가을 신상 세일')).toEqual([]);
  });
  it('지어낸 자리만 자리표시로 바꾸고 근거 있는 자리는 그대로 둔다', () => {
    const out = replaceInventedBenefits('지금 40% 할인! 30% 할인은 오늘까지', '30% 할인');
    expect(out).toBe(`지금 ${BENEFIT_PLACEHOLDER}! 30% 할인은 오늘까지`);
    expect(replaceInventedBenefits('★ 30% OFF', '30% 할인')).toBe('★ 30% OFF');
  });
});

describe('WP2 배선 — 문안을 새로 쓰거나 다시 쓰는 AI 출구마다 서버 대조가 붙어 있다(지시는 경계가 아니다)', () => {
  const has = (src: string, ...calls: string[]) => calls.every((c) => src.includes(c));
  it('새로 쓰는 문안(기본 · 맞춤 · DM · 이메일 · 인앱)', () => {
    expect(has(SRC('services', 'ai.ts'), 'findInventedBenefits(', 'replaceInventedBenefits(', 'findNewNumbers(')).toBe(true);
    expect(has(SRC('routes', 'dm.ts'), 'findInventedBenefits(', 'replaceInventedBenefits(')).toBe(true);
    expect(has(SRC('utils', 'dm', 'dm-ai.ts'), 'findInventedBenefits(', 'findNewNumbers(')).toBe(true);
    expect(has(SRC('utils', 'email-ai.ts'), 'replaceInventedBenefitsInHtml(', 'replaceInventedBenefitsDeep(', 'findNewNumbers(')).toBe(true);
    expect(has(SRC('utils', 'inapp-ai-generator.ts'), 'replaceInventedBenefits(', 'replaceInventedBenefitsDeep(')).toBe(true);
  });
  it('다시 쓰는 문안(변형 · 꾸미기 · DM 다듬기 · 대행 다듬기 · 인앱 톤 변형 · 여정 다듬기 · SNS 다듬기) = 원문에 없던 숫자도 본다', () => {
    expect(has(SRC('utils', 'variant-generator.ts'), 'findInventedBenefits(', 'findNewNumbers(')).toBe(true);
    expect(has(SRC('utils', 'operator-message-decorator.ts'), 'findInventedBenefits(', 'findNewNumbers(')).toBe(true);
    expect(has(SRC('utils', 'dm', 'dm-quick-action.ts'), 'findInventedBenefits(', 'findNewNumbers(')).toBe(true);
    expect(has(SRC('utils', 'agency-send-refine.ts'), 'stripUnauthorizedBenefits(', 'findNewNumbers(')).toBe(true);
    expect(has(SRC('utils', 'inapp-quick-action.ts'), 'stripUnauthorizedBenefits(', 'findNewNumbers(')).toBe(true);
    const j = SRC('utils', 'journey-ai-generator.ts');
    expect((j.match(/findNewNumbers\(/g) || []).length).toBe(2);   // 다듬기 후보 + 자동 재작성
    expect(has(SRC('utils', 'sns-caption-ai.ts'), 'stripUnauthorizedBenefits(', 'findNewNumbers(')).toBe(true);
  });
});

describe('WP5 날짜를 계산하는 AI 에는 시스템 달력(D76)', () => {
  it('DM 입력 해석 · 행사 원문 구조화(쿠폰 만료일 · 카운트다운 끝 시각)가 달력을 받는다', () => {
    const dm = SRC('utils', 'dm', 'dm-ai.ts');
    const parser = dm.slice(dm.indexOf('export async function parsePrompt'), dm.indexOf('// ────────────── 2. Layout Recommender'));
    expect(parser).toContain('${getKoreanCalendar()}');
    const eb = SRC('utils', 'event-brief.ts');
    expect(eb).toContain('${getKoreanCalendar()}');
  });
});

describe('WP6 화면에 글자 그대로 보이는 AI 자유 답변 = 마크다운 기호 출구 정리', () => {
  it('굵게 · 머리글 · 목록 기호 · 백틱 · 가로줄 · 코드 울타리를 걷고 글 내용은 둔다', () => {
    const md = '## 요약\n**재구매 고객**에게 `문자`가 잘 먹혔어요.\n- 성공 패턴 3건\n* 채널 성과 2건\n---\n```\n참고: 성공 패턴 3건\n```';
    expect(plainTextFromAi(md)).toBe('요약\n재구매 고객에게 문자가 잘 먹혔어요.\n· 성공 패턴 3건\n· 채널 성과 2건\n\n참고: 성공 패턴 3건');
  });
  it('쌍이 아닌 * 한 글자 · 음수 · 날짜 범위는 건드리지 않는다', () => {
    expect(plainTextFromAi('*표시 항목은 필수예요')).toBe('*표시 항목은 필수예요');
    expect(plainTextFromAi('-10% 줄었어요\n10/1~10/5')).toBe('-10% 줄었어요\n10/1~10/5');
  });
  it('학습 메모리 질문 · AI 사용량 질문 답변이 이 출구를 지난다', () => {
    expect(SRC('routes', 'ai-memory.ts')).toContain('answer: plainTextFromAi(answer)');
    expect(SRC('routes', 'ai-usage.ts')).toContain('answer: plainTextFromAi(answer)');
  });
});

describe('Codex 0930 1R — 대조 · 길목 틈', () => {
  const sep30 = new Date('2026-09-30T03:00:00Z');
  it('[high] 알림톡 실패 대체문안 · 대체 제목도 공통 직접발송 길목에서 본다', () => {
    expect(SRC('utils', 'direct-send-core.ts'))
      .toContain('findUneditedSendPlaceholder(spec.message, spec.subject, spec.alimtalkNextContents, spec.alimtalkNextSubject)');
  });
  it('[high] 한글 백분율도 출력 · 근거에 같은 규칙으로 읽는다("프로모션" 같은 낱말은 그대로)', () => {
    expect(findInventedBenefits('오늘 30퍼센트 할인', '신상품 안내')).toEqual(['30%']);
    const out = replaceInventedBenefits('오늘 30퍼센트 할인해요', '신상품 안내');
    expect(out).toContain(BENEFIT_PLACEHOLDER);
    expect(out).not.toContain('30');
    expect(findInventedBenefits('지금 30프로 할인', '가을 신상 30% 할인')).toEqual([]);
    expect(findInventedBenefits('3프로모션 할인 안내', '신상품')).toEqual([]);
  });
  it('[high] HTML 판정은 보이는 글 기준 — 태그로 나뉜 값 · 엔티티도 잡는다 · 조각 안에서 못 바꾸면 맨 앞 자리표시 한 줄(구조 불변)', () => {
    const PH_LINE = `<p>${BENEFIT_PLACEHOLDER}</p>`;
    const split = '<p>가을 <strong>30</strong>% 할인</p>';
    const [h1, f1] = replaceInventedBenefitsInHtml(split, '가을 신상');
    expect(f1).toEqual(['30%']);
    expect(h1).toBe(PH_LINE + split);
    const ent = '<td width="100%">30&#37; 할인</td>';
    const [h2] = replaceInventedBenefitsInHtml(ent, '가을 신상');
    expect(h2).toBe(PH_LINE + ent);
    const [h2b] = replaceInventedBenefitsInHtml('<html><body class="a"><p>30&#37; 할인</p></body></html>', '');
    expect(h2b).toBe(`<html><body class="a">${PH_LINE}<p>30&#37; 할인</p></body></html>`);
    const [inNode] = replaceInventedBenefitsInHtml('<p>가을 <b>30% 할인</b></p>', '가을 신상');
    expect(inNode).toBe(`<p>가을 <b>${BENEFIT_PLACEHOLDER}</b></p>`);
    const keep = '<p>가을 <strong>30%</strong> 할인</p>';
    expect(replaceInventedBenefitsInHtml(keep, '가을 30% 할인')).toEqual([keep, []]);
    const [h3] = replaceInventedBenefitsInHtml('<style>.a{width:50%}</style><p>신상 입고</p>', '신상 입고');
    expect(h3).toBe('<style>.a{width:50%}</style><p>신상 입고</p>');
  });
  it('[medium] 지금 달은 "N월" 표현일 때만 허용한다 — 같은 숫자의 수량 · 기간은 잡는다', () => {
    expect(findNewNumbers('선착순 9명 한정', '신상품 안내', sep30)).toEqual(['9']);
    expect(findNewNumbers('9일 한정 공개', '신상품 안내', sep30)).toEqual(['9']);
    expect(findNewNumbers('9월 신상품 안내', '신상품 안내', sep30)).toEqual([]);
  });
  it('[medium] 다듬기 = 시스템이 다시 붙인 수신거부 문구는 대조 원문에 포함한다', () => {
    const ai = SRC('services', 'ai.ts');
    expect(ai).toContain('const factSource = `${originalMessage}\\n${rejectFooterToRestore}`;');
    expect(ai).toContain('findNewNumbers(text, factSource)');
  });
});

describe('Codex 0930 2R — 위치 맞춤을 없앤 구조 · 한글 단위 문맥', () => {
  it('[high] 이메일 다듬기 근거 = 원래 본문의 보이는 글(속성 값은 근거가 아니다) · 근거에 없는 숫자 · 혜택이 생기면 적용하지 않는다', () => {
    expect(htmlVisibleText('<table width="100%"><tr><td>신상품 안내</td></tr></table>')).not.toContain('100');
    expect(htmlVisibleText('<p>30&#37; 할인</p>')).toBe('\n30% 할인\n');
    const e = SRC('utils', 'email-ai.ts');
    expect(e).toContain('const refineGround = `${input.subject}\\n${htmlVisibleText(input.htmlBody)}\\n${input.instruction}`;');
    expect(e).toContain("throw new Error('원문에 없는 숫자나 혜택이 생겨 적용하지 않았어요. 다시 눌러 주세요.');");
  });
  it('[high] 이모지 엔티티 뒤의 값도 조각 안에서 바뀐다(엔티티는 그대로)', () => {
    const [h] = replaceInventedBenefitsInHtml('<p>&#x1F389;&#x1F381;30% 할인</p>', '');
    expect(h).toBe(`<p>&#x1F389;&#x1F381;${BENEFIT_PLACEHOLDER}</p>`);
  });
  it('[high] "프로"는 뒤가 할인 · 세일 등일 때만 비율 — 상품명 "16 프로"는 근거가 아니다', () => {
    expect(findInventedBenefits('16% 할인', '아이폰 16 프로 신제품 안내')).toEqual(['16%']);
    expect(findInventedBenefits('지금 30% 할인', '가을 신상 30프로 할인')).toEqual([]);
    expect(findInventedBenefits('지금 30% 할인', '가을 신상 30퍼센트 세일')).toEqual([]);
  });
  it('[medium] 따옴표 속 꺾쇠 · 주석은 태그 안으로 본다(속성을 글로 오인하지 않는다)', () => {
    const attr = '<p title="2 > 1" style="width:100%">안내</p>';
    expect(replaceInventedBenefitsInHtml(attr, '안내')).toEqual([attr, []]);
    expect(htmlVisibleText('<p>30<!-- > -->% 할인</p>')).toBe('\n30% 할인\n');
  });
  it('[medium] 한글 백분율 자리는 단위 글자까지 통째로 바뀐다', () => {
    expect(replaceInventedBenefits('30퍼센트 할인', '')).toBe(BENEFIT_PLACEHOLDER);
    expect(replaceInventedBenefits('30 프로 할인해요', '')).toBe(`${BENEFIT_PLACEHOLDER}해요`);
  });
});

describe('Codex 0930 3R — 표기 부류째 닫기(길이 보존 정규화 · 출력 넓게 / 근거 좁게 · 스캐너)', () => {
  it('[high] 조사가 붙은 "N프로"도 출력 쪽에서는 비율로 본다 · 근거에 글자 그대로 있는 상품명은 그대로', () => {
    expect(findInventedBenefits('최대 30프로까지 할인', '신상품 소개')).toEqual(['30%']);
    expect(findInventedBenefits('아이폰 16 프로 입고 안내', '아이폰 16 프로 신제품')).toEqual([]);
    expect(findInventedBenefits('아이폰 16 프로 16% 할인', '아이폰 16 프로 신제품')).toEqual(['16%']);
  });
  it('[high] 글 속 꺾쇠("가격 < 5000원")는 글이다 — 보이는 금액을 태그로 삼키지 않는다', () => {
    expect(htmlVisibleText('<p>가격 < 5000원</p>')).toContain('< 5000원');
    expect(findInventedBenefits(htmlVisibleText('<p>가격 < 5000원</p>'), '가격 안내')).toEqual(['5000원']);
  });
  it('[high] 혜택 판정에 쓰이는 이름 참조(&plus; &percnt;)와 숫자 참조를 푼다', () => {
    expect(htmlVisibleText('<p>1&plus;1 혜택 30&percnt;</p>')).toContain('1+1 혜택 30%');
    expect(findInventedBenefits(htmlVisibleText('<p>1&plus;1 혜택</p>'), '1주년 신상품 안내')).toEqual(['1+1']);
  });
  it('[medium] 숫자는 값으로 비교한다 — 같은 금액의 표기 변경은 새 숫자가 아니다', () => {
    expect(findNewNumbers('가격은 10,000원입니다', '가격은 1만원입니다')).toEqual([]);
    expect(findNewNumbers('1만5천원 할인', '15,000원 할인')).toEqual([]);
    expect(findNewNumbers('가격은 20,000원입니다', '가격은 1만원입니다')).toEqual(['20000']);
  });
  it('전각 숫자 · 기호도 같은 값으로 본다(길이 보존이라 자리째 바뀐다)', () => {
    expect(findInventedBenefits('３０％ 할인', '신상품')).toEqual(['30%']);
    expect(replaceInventedBenefits('３０％ 할인', '')).toBe(BENEFIT_PLACEHOLDER);
  });
  it('닫히지 않은 따옴표 · 주석이 매우 길어도 한 번 훑고 끝난다', () => {
    const t0 = Date.now();
    htmlVisibleText(`<p title="${'a'.repeat(200000)}`);
    htmlVisibleText(`<!--${'<p>'.repeat(50000)}`);
    replaceInventedBenefitsInHtml(`${'<b>30</b>% '.repeat(5000)}`, '');
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe('Codex 0930 4R — 비율 문맥 우선 · 숫자 경계 토큰 · 드러나는 쪽으로 틀리는 엔티티', () => {
  it('[high] 비율 문맥의 "N프로"는 상품명 예외보다 먼저 비율이다 · 예외는 숫자 경계가 맞는 토큰만', () => {
    expect(findInventedBenefits('5프로 적립', '1.5프로 적립')).toEqual(['5%']);
    expect(findInventedBenefits('16프로 할인', '아이폰 16 프로 신제품')).toEqual(['16%']);
    expect(findInventedBenefits('할인율 16프로', '아이폰 16 프로 신제품')).toEqual(['16%']);
    expect(findInventedBenefits('1.5프로 적립해 드려요', '1.5프로 적립')).toEqual([]);
  });
  it('[high] 세미콜론 없는 숫자 참조 · 모르는 이름 참조 · 폭 없는 문자도 값이 드러난다', () => {
    expect(htmlVisibleText('<p>50&#37 할인</p>')).toContain('50% 할인');
    expect(findInventedBenefits(htmlVisibleText('<p>50&#37 할인</p>'), '')).toEqual(['50%']);
    expect(findInventedBenefits(htmlVisibleText('<p>50&ThinSpace;% 할인</p>'), '')).toEqual(['50%']);
    expect(findInventedBenefits('50​% 할인', '')).toEqual(['50%']);
    expect(htmlVisibleText('<p>A&amp B</p>')).toContain('A& B');
  });
  it('[medium] 소문자 변환으로 길이가 바뀌는 글자가 앞에 있어도 닫는 태그를 원문에서 찾는다', () => {
    expect(htmlVisibleText('İİİİİİİİ<style></style>50% 할인')).toContain('50% 할인');
    expect(htmlVisibleText('<STYLE>.a{}</Style><p>30% 할인</p>')).toContain('30% 할인');
  });
});

describe('Codex 0930 5R — "N프로"는 기본이 비율 · 상품명은 같은 앞말이 붙을 때만', () => {
  it('[high] 앞말 없이 쓴 "N프로"는 비율이다("추가 할인" · "더 할인" 등 문맥 표현과 상관없이)', () => {
    expect(findInventedBenefits('16프로 추가 할인', '아이폰 16 프로 신제품')).toEqual(['16%']);
    expect(findInventedBenefits('16프로 더 할인해요', '아이폰 16 프로 신제품')).toEqual(['16%']);
    expect(replaceInventedBenefits('16프로 추가 할인', '아이폰 16 프로 신제품')).toBe(`${BENEFIT_PLACEHOLDER} 추가 할인`);
  });
  it('근거와 같은 상품명 앞말이 붙은 "N프로"는 상품명이다', () => {
    expect(findInventedBenefits('아이폰 16 프로 입고 안내', '아이폰 16 프로 신제품')).toEqual([]);
    expect(findInventedBenefits('아이폰16프로 사전예약 시작', '아이폰 16 프로 신제품')).toEqual([]);
    expect(findInventedBenefits('갤럭시 16 프로 입고', '아이폰 16 프로 신제품')).toEqual(['16%']);
  });
  it('[Codex 6R high] 앞말이 맞아도 토큰 뒤가 수량 조사면 비율 · 명사 조사 · 끊김이면 상품명', () => {
    expect(findInventedBenefits('아이폰 16프로씩 추가 할인해요', '아이폰 16 프로 신제품')).toEqual(['16%']);
    expect(findInventedBenefits('아이폰 16 프로만큼 할인', '아이폰 16 프로 신제품')).toEqual(['16%']);
    expect(findInventedBenefits('아이폰 16 프로가 드디어 입고', '아이폰 16 프로 신제품')).toEqual([]);
    expect(findInventedBenefits('아이폰 16 프로, 지금 만나 보세요', '아이폰 16 프로 신제품')).toEqual([]);
  });
  it('[Codex 7R high] 강조 기호가 뒤의 수량 조사를 가리지 못한다 · 강조한 상품명은 그대로', () => {
    expect(findInventedBenefits('**아이폰 16프로**씩 추가 할인해요', '아이폰 16 프로 신제품')).toEqual(['16%']);
    expect(findInventedBenefits('아이폰 16프로★씩 할인', '아이폰 16 프로 신제품')).toEqual(['16%']);
    expect(findInventedBenefits('**아이폰 16 프로**가 드디어 입고', '아이폰 16 프로 신제품')).toEqual([]);
    expect(findInventedBenefits('아이폰 16 프로', '아이폰 16 프로 신제품')).toEqual([]);
  });
  it('[Codex 8R high] 공백 뒤 강조된 할인 문맥도 비율 문맥이다', () => {
    expect(findInventedBenefits('아이폰 16프로 **할인**해 드려요', '아이폰 16 프로 신제품')).toEqual(['16%']);
    expect(findInventedBenefits('아이폰 16프로 _적립_', '아이폰 16 프로 신제품')).toEqual(['16%', '적립']);
    expect(replaceInventedBenefits('아이폰 16프로 **할인**해 드려요', '아이폰 16 프로 신제품')).toContain(BENEFIT_PLACEHOLDER);
  });
  it('[Codex 9R high] 판정 단위 = 문장 — 같은 문장에 혜택 · 수량 낱말이 있으면 배치 · 강조와 상관없이 비율', () => {
    expect(findInventedBenefits('아이폰 **16프로** 만큼 할인해 드려요', '아이폰 16프로 입고')).toEqual(['16%']);
    expect(findInventedBenefits('아이폰 16 프로, 이번 주 최대 혜택', '아이폰 16 프로 입고')).toEqual(['16%']);
    // 설계상 허용하는 거짓 양성 — 상품명과 할인이 한 문장이면 자리표시 쪽으로 틀린다(사람 확인)
    expect(findInventedBenefits('아이폰 16 프로 할인 행사', '아이폰 16 프로 입고')).toEqual(['16%']);
    // 문장이 갈리면 상품명 문장은 그대로
    expect(findInventedBenefits('아이폰 16 프로 입고.\n매장에서 만나 보세요!', '아이폰 16 프로 신제품')).toEqual([]);
  });
  it('[Codex 10R medium] 같은 문장에 "N프로"가 아주 많아도 한 번 훑고 끝난다 · 문장별 판정은 그대로', () => {
    const t0 = Date.now();
    findInventedBenefits('아이폰 16프로, '.repeat(3000), '아이폰 16 프로 신제품');
    replaceInventedBenefits(`${'아이폰 16프로, '.repeat(3000)}할인`, '아이폰 16 프로 신제품');
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(findInventedBenefits('아이폰 16 프로 입고. 아이폰 16 프로 입고. 16프로 할인!', '아이폰 16 프로 신제품')).toEqual(['16%']);
    expect(findInventedBenefits('아이폰 16 프로 입고. 아이폰 16 프로가 왔어요.', '아이폰 16 프로 신제품')).toEqual([]);
  });
  it('[Codex 11R] 토큰 안 줄바꿈은 fail-closed(비율) · 근거 색인은 한 번 · 서로 다른 토큰이 많아도 선형', () => {
    expect(findInventedBenefits('아이폰 16\n프로씩 내려갑니다.', '아이폰16프로')).toEqual(['16%']);
    const many = Array.from({ length: 3000 }, (_, i) => `모델 ${1000 + i}프로,`).join(' ');
    const groundMany = Array.from({ length: 3000 }, (_, i) => `모델 ${1000 + i}프로`).join(' ');
    const t0 = Date.now();
    expect(findInventedBenefits(many, groundMany)).toEqual([]);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe('WP2 다시 쓰는 문안 = 원문에 없던 숫자', () => {
  const sep30 = new Date('2026-09-30T03:00:00Z');
  it('지어낸 시간 · 기간 조건의 숫자를 잡는다(다듬기 예시 "90분 안에" 부류)', () => {
    expect(findNewNumbers('내일! 90분 안에 30% 할인', '내일 30% 할인', sep30)).toEqual(['90']);
    expect(findNewNumbers('단 3일 한정 30% 할인', '30% 할인', sep30)).toEqual(['3']);
  });
  it('원문 숫자 · 지금 달 · 변수 안 · 쉼표 표기는 허용한다', () => {
    expect(findNewNumbers('9월, 기다리던 30% 할인 ★', '30% 할인', sep30)).toEqual([]);
    expect(findNewNumbers('5,000원 쿠폰 %이름%님께', '5000원 쿠폰', sep30)).toEqual([]);
    expect(findNewNumbers('5/31까지, 서두르세요', '5/31까지 할인', sep30)).toEqual([]);
  });
});
