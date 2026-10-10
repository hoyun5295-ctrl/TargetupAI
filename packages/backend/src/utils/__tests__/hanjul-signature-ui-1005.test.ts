/**
 * 한줄로 시그니처 — 화면 짝 계약 (2026-10-05 · 설계서 docs/2026-10-05-hanjul-signature-design.md §4 · §5)
 *
 * 못 박는 것:
 *   1. 화면 채울 자리 종류표는 생성기 · 출구 가드가 **실제로 심는 글자**와 맞는다(실제 import 대조 · 문자열 grep 아님).
 *   2. 채우기는 종류별로 좁다 — 혜택 채우기가 기간 · 안내 본문 · 링크 자리를 덮지 않는다(회의론자 최종 검증 1번).
 *   3. 이메일 완성도 줄은 발송 관문과 같은 정규식으로 센다(글자 단위 대조).
 *   4. 입구 배선 — 한 줄 입구만 one_line 을 보낸다 · 허브는 묻는 응답을 제안보다 먼저 처리한다 · DM 은 실패해도 한 줄을 지우지 않는다.
 *   5. 열리지 않던 창 3개는 지워졌다 · 새 화면 문구에 모델명 · 줄표 0.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { BENEFIT_PLACEHOLDER as COPY_BENEFIT_PH, AI_FILL_PLACEHOLDERS, hasAiFillPlaceholder } from '../copy-benefit-detector';
import { BENEFIT_PLACEHOLDER as INAPP_BENEFIT_PH } from '../inapp-message';
import { PLACEHOLDER_PATTERN } from '../email-ai';
import {
  SLOT_TEXTS, countSlots, fillSlots, fillSlotsDeep, stringsDeep,
  EMAIL_GATE_PLACEHOLDER_SOURCE, countEmailGatePlaceholders, appendToOneLine,
} from '../../../../frontend/src/utils/one-line';
import { oneLineGaps } from '../one-line-facts';

const BACK = (...p: string[]) => readFileSync(resolve(process.cwd(), 'src', ...p), 'utf8');
const FRONT_ROOT = resolve(process.cwd(), '..', 'frontend', 'src');
const FRONT = (...p: string[]) => readFileSync(resolve(FRONT_ROOT, ...p), 'utf8');

describe('1. 채울 자리 종류표 = 실제로 심는 글자', () => {
  it('혜택: 문자 출구 가드 · 인앱 출구 가드 · 자동 마케팅/비상 문안 · 이메일 생성기', () => {
    const b: readonly string[] = SLOT_TEXTS.benefit;
    expect(b).toContain(COPY_BENEFIT_PH);
    expect(b).toContain(INAPP_BENEFIT_PH);
    expect(AI_FILL_PLACEHOLDERS).toContain('[혜택 내용을 입력해주세요]');
    expect(b).toContain('[혜택 내용을 입력해주세요]');
    expect(BACK('utils', 'email-ai.ts')).toContain('"[혜택을 직접 입력해주세요]"');
    expect(b).toContain('[혜택을 직접 입력해주세요]');
  });
  it('기간: 이메일 생성기', () => {
    expect(BACK('utils', 'email-ai.ts')).toContain('"[기간을 직접 입력해주세요]"');
    expect(SLOT_TEXTS.period).toEqual(['[기간을 직접 입력해주세요]']);
  });
  it('모든 자리는 이메일 발송 관문 · 문자 발송 길목이 막는 글자다(채우면 막히는 수가 준다)', () => {
    for (const s of [...SLOT_TEXTS.benefit, ...SLOT_TEXTS.period]) {
      expect(PLACEHOLDER_PATTERN.test(s)).toBe(true);
      expect(hasAiFillPlaceholder(s)).toBe(true);
    }
  });
});

describe('2. 채우기는 종류별로 좁다', () => {
  const OTHER = ['[기간을 직접 입력해주세요]', '[안내 본문을 직접 작성해주세요]', '[직접 작성해주세요]', '[URL 입력]', '[링크를 입력해주세요]', '[혜택은 앱에서 직접 확인하세요]'];
  it('혜택 채우기는 다른 자리를 건드리지 않는다', () => {
    for (const o of OTHER) expect(fillSlots(`가을 ${o} 안내`, 'benefit', '20% 할인')).toBe(`가을 ${o} 안내`);
    expect(fillSlots(`가을 ${COPY_BENEFIT_PH} 놓치지 마세요`, 'benefit', '20% 할인')).toBe('가을 20% 할인 놓치지 마세요');
  });
  it('기간 채우기는 혜택 자리를 건드리지 않는다 · 빈 값이면 그대로', () => {
    const t = '[혜택을 직접 입력해주세요] · [기간을 직접 입력해주세요]';
    expect(fillSlots(t, 'period', '10/11까지')).toBe('[혜택을 직접 입력해주세요] · 10/11까지');
    expect(fillSlots(t, 'period', '   ')).toBe(t);
  });
  it('트리 채우기 = 글자 자리만 · 모양은 그대로', () => {
    const node = { a: [{ text: '[혜택 안내: 직접 작성해주세요]', url: 'https://x.kr' }], n: 3, b: null, c: '[기간을 직접 입력해주세요]' };
    const out = fillSlotsDeep(node, 'benefit', '1+1');
    expect(out).toEqual({ a: [{ text: '1+1', url: 'https://x.kr' }], n: 3, b: null, c: '[기간을 직접 입력해주세요]' });
    expect(countSlots(stringsDeep(node), 'benefit')).toBe(1);
    expect(countSlots(stringsDeep(out), 'benefit')).toBe(0);
  });
});

describe('3. 이메일 완성도 줄 = 발송 관문 정규식', () => {
  it('글자 단위로 같다', () => {
    expect(EMAIL_GATE_PLACEHOLDER_SOURCE).toBe(PLACEHOLDER_PATTERN.source);
  });
  it('여러 자리를 전부 센다', () => {
    expect(countEmailGatePlaceholders(['[혜택을 직접 입력해주세요] 그리고 [기간을 직접 입력해주세요]', '[혜택 안내: 직접 수정해주세요]', '정상 문구'])).toBe(3);
  });
});

describe('4. 입구 배선', () => {
  it('DM: 한 줄 입구만 one_line · 판정은 서버 · 실패해도 한 줄 유지', () => {
    const d = FRONT('pages', 'DmBuilderPage.tsx');
    // ★ 2026-10-10 한 줄 요청은 화면 CT 한 곳(requestLineDm)이 보낸다 · 한 줄 입구(opts.oneLine)에서만 부른다
    expect(d).toContain('if (opts.oneLine) {');
    expect(d).toContain("const r = await requestLineDm({ line: opts.prompt || '', facts: opts.facts, products: opts.products, reads: opts.reads, readLicensed: opts.readLicensed });");
    expect(FRONT('utils', 'one-line.ts')).toContain("prompt: req.line, one_line: true, attempt_token: newAttemptToken(), land: 'result',");
    expect(d).toContain("const res = await api.post('/dm/ai/one-shot-generate', { prompt: opts.prompt || '', scenario: opts.scenario });");
    expect(d).toContain('const g = await fetchOneLineGaps(t, reads);');   // ★ 2026-10-10 H3 사진 글 조각을 함께(판정은 여전히 서버)
    const fin = d.slice(d.indexOf('    } finally {\n      clearInterval(stepTimer);'), d.indexOf('  }, [generating, createNew, applyAiGenerated'));
    expect(fin).not.toContain("setNaturalLanguage('')");
    expect(d).toContain('extraContent={pendingGen && (pendingGen.askBenefit || (pendingGen.terms?.length ?? 0) > 0 || (pendingGen.reads?.length ?? 0) > 0) ? (');
  });
  it('이메일 · 인앱: 한 줄 입구가 one_line 을 보낸다(빠른 시작은 보내지 않는다)', () => {
    const e = FRONT('pages', 'EmailCampaignsPage.tsx');
    expect(e).toContain('one_line: true, attempt_token: newAttemptToken()');
    const i = FRONT('pages', 'InAppMessagesPage.tsx');
    expect(i).toContain("...(oneLine ? { one_line: true } : {})");
    expect(i).toContain("handleAIGenerate(ob, undefined, 'web', true)");
    expect(i).toContain("handleAIGenerate('', sc, 'web');");
  });
  it('허브: 묻는 응답을 제안 반영보다 먼저 처리한다 · 3안 선택 기록을 싣는다', () => {
    const a = FRONT('pages', 'AiOperatorPage.tsx');
    const ask = a.indexOf('if (data.needsFacts?.benefit) {');
    const set = a.indexOf('setProposal(data as ProposalResponse);');
    expect(ask).toBeGreaterThan(0);
    expect(ask).toBeLessThan(set);
    expect(a).toContain('aiVariants: {');
    expect(a).toContain('onClick={() => { void handleSubmit(); }}');
  });
  it('여정: 스위치 켠 회사의 명령 카드 한 줄은 안 보이는 모달 혜택을 싣지 않는다', () => {
    expect(FRONT('pages', 'JourneysPage.tsx')).toContain('lineFactsOn ? undefined : benefitText');
  });
});

describe('4-1. 판독 글 붙이기(설계서 §8)', () => {
  it('줄바꿈을 「 · 」로 — 한 줄 칸이 줄바꿈을 지워 「1+13일간」이 되던 것을 막는다', () => {
    expect(appendToOneLine('', '쿠션 1+1\n3일간 특가')).toBe('쿠션 1+1 · 3일간 특가');
    expect(appendToOneLine('주말 행사', '전 상품\n\n 20% 세일 ')).toBe('주말 행사 · 전 상품 · 20% 세일');
    expect(appendToOneLine('주말 행사', '  \n ')).toBe('주말 행사');
    expect(oneLineGaps(appendToOneLine('', '쿠션 1+1\n3일간 특가')).benefit).toBe(false);
  });
});

describe('5. 정리 · 문구', () => {
  it('열리지 않던 창 3개는 파일 · 참조 0', () => {
    for (const f of ['AiSendTypeModal.tsx', 'AiCustomSendFlow.tsx', 'RecommendTemplateModal.tsx']) {
      expect(existsSync(resolve(FRONT_ROOT, 'components', f))).toBe(false);
    }
    const dash = FRONT('pages', 'Dashboard.tsx');
    expect(dash).not.toMatch(/AiSendTypeModal|AiCustomSendFlow|RecommendTemplateModal|customSendData|showTemplates/);
  });
  it('새 화면 부품 문구에 모델명 · 줄표 0', () => {
    for (const f of [['components', 'zone', 'LineFacts.tsx'], ['components', 'zone', 'ZoneCompletion.tsx'], ['utils', 'one-line.ts']]) {
      const src = FRONT(...f);
      const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      expect(code).not.toMatch(/Opus|Sonnet|Haiku|GPT|Claude|Anthropic/);
      expect(code).not.toContain('—');
    }
  });
});
