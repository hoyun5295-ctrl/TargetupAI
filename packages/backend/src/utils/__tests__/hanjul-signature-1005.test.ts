/**
 * 한줄로 시그니처 (2026-10-05 · 설계서 docs/2026-10-05-hanjul-signature-design.md)
 *
 * 못 박는 것:
 *   1. C안 교체 — 인자 없음 · 'mz' = 지금 프롬프트와 문자 단위 동일 · 'punchy' = 세 자리만 바뀐다(시험이 반쪽이 되지 않는다).
 *   2. 문자 생성기 혜택 근거 — licenseText 가 오면 그것만 근거 · 감지(허브 메모리 · 계절 · 대상 블록이 근거가 되지 않는다).
 *      자동 마케팅 · 자동발송 · 플래너는 새 인자를 넘기지 않는다(무변경).
 *   3. 허브 3안 선택 기록 — 원값 검증 · 계산은 logTrainingData 안(이상한 값이어도 던지지 않는다) · 발송 라우트는 원값만 넘긴다.
 *   4. 라우트 게이트 — 한 줄 입구(one_line:true) + 스위치일 때만 바뀐다 · 멱등은 시도 토큰이 온 요청만 · 잠금은 finally 에서 푼다.
 *   5. 허브 제안 — 판정이 걸리면 생성 · 차감 전에 묻는다(오케스트레이터보다 앞).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const poolQuery = vi.fn(async (..._a: unknown[]) => ({ rows: [] }));
vi.mock('../../config/database', () => ({
  default: { query: (...a: unknown[]) => poolQuery(...a), connect: vi.fn() },
  query: vi.fn(async () => ({ rows: [] })),
  pool: { query: (...a: unknown[]) => poolQuery(...a), connect: vi.fn() },
}));

import { applyCopyCVariant, brandSystemPromptForTest, COPY_C_NAMES } from '../../services/ai';
import { parseHubVariantsRecord, logTrainingData } from '../training-logger';

const SRC = (...p: string[]) => readFileSync(resolve(process.cwd(), 'src', ...p), 'utf8');

describe('1. C안 교체', () => {
  const base = brandSystemPromptForTest();
  it('인자 없음 · mz = 문자 단위 동일', () => {
    expect(applyCopyCVariant(base)).toBe(base);
    expect(applyCopyCVariant(base, 'mz')).toBe(base);
    expect(COPY_C_NAMES.mz).toBe('MZ감성형');
  });
  it('punchy = 세 자리(제목 전략 · C 전략 · 출력 이름)가 모두 바뀐다', () => {
    const out = applyCopyCVariant(base, 'punchy');
    expect(out).not.toBe(base);
    expect(out).not.toContain('MZ감성형');
    expect((out.match(/짧고 강한형/g) || []).length).toBe(3);
    expect(out).toContain('"variant_name": "짧고 강한형"');
    // A · B 정의는 그대로
    expect(out).toContain('**감성형(A): "마음을 먼저 열기"**');
    expect(out).toContain('**혜택강조형(B): "숫자로 설득하기"**');
  });
  it('바꾼 글에 줄표 0', () => {
    const out = applyCopyCVariant(base, 'punchy');
    const added = out.split('\n').filter((l) => !base.includes(l));
    expect(added.length).toBeGreaterThan(0);
    expect(added.join('\n')).not.toContain('—');
  });
  it('생성기의 이름 지시가 같은 이름표를 쓴다', () => {
    const s = SRC('services', 'ai.ts');
    expect(s).toContain(`"\${COPY_C_NAMES[extraContext?.cVariant === 'punchy' ? 'punchy' : 'mz']}"(C)`);
    expect(s).toContain('applyCopyCVariant(BRAND_SYSTEM_PROMPT, extraContext?.cVariant)');
  });
});

describe('2. 혜택 근거 = 사용자 원문 한정', () => {
  const s = SRC('services', 'ai.ts');
  it('licenseText 가 오면 근거 · 감지 둘 다 그것만 본다(브랜드 슬로건 · 소개도 근거가 아니다)', () => {
    const at = s.indexOf('  const benefitGround = ');
    const block = s.slice(at, s.indexOf("].filter(Boolean).join('\\n');", at));
    expect(block).toContain("typeof extraContext?.licenseText === 'string'\n    ? extraContext.licenseText\n    : [");
    // 브랜드 정보는 licenseText 가 없는 갈래(배열) 안에만 있다
    expect(block.indexOf('brandSlogan')).toBeGreaterThan(block.indexOf(': ['));
    expect(s).toContain('const benefitDetect = detectBenefits(licenseSource);');
  });
  it('오케스트레이터 두 경로가 넘기고, 자동 마케팅 · 자동발송 · 플래너는 넘기지 않는다', () => {
    const o = SRC('services', 'ai-orchestrator.ts');
    expect((o.match(/buildLineEventText\(ctx\.objective, ctx\.lineFacts\)/g) || []).length).toBe(2);
    expect(o).toContain('...(licenseText !== undefined ? { licenseText } : {}),');
    expect(o).toContain('...(licenseTextAI !== undefined ? { licenseText: licenseTextAI } : {}),');
    for (const f of [['utils', 'continuous-operator.ts'], ['utils', 'auto-campaign-worker.ts'], ['utils', 'planner-copy.ts']]) {
      const src = SRC(...f);
      expect(src).not.toMatch(/lineFacts|licenseText|cVariant/);
    }
  });
});

describe('3. 허브 3안 선택 기록', () => {
  beforeEach(() => { poolQuery.mockClear(); });
  it('원값 검증', () => {
    const ok = { messages: ['A안', 'B안', 'C안'], names: ['감성형', '혜택강조형', '짧고 강한형'], selectedIndex: 2, recommendedIndex: 0, edited: false, aiRefined: false, cVariant: 'punchy' };
    expect(parseHubVariantsRecord(ok)).toMatchObject({ selectedIndex: 2, edited: false, cVariant: 'punchy' });
    expect(parseHubVariantsRecord({ ...ok, selectedIndex: 3 })).toBeNull();
    expect(parseHubVariantsRecord({ ...ok, selectedIndex: 1.5 })).toBeNull();
    expect(parseHubVariantsRecord({ ...ok, messages: [] })).toBeNull();
    expect(parseHubVariantsRecord({ ...ok, messages: ['a', 'b', 'c', 'd'] })).toBeNull();
    expect(parseHubVariantsRecord({ ...ok, messages: ['x'.repeat(2001)] , selectedIndex: 0 })).toBeNull();
    expect(parseHubVariantsRecord({ ...ok, edited: 'no' })).toBeNull();
    expect(parseHubVariantsRecord('[]')).toBeNull();
    expect(parseHubVariantsRecord(null)).toBeNull();
    expect(parseHubVariantsRecord({ ...ok, cVariant: 'zzz' })?.cVariant).toBeNull();
  });
  it('이상한 원값이어도 던지지 않고 옛 기록(manual) 그대로', async () => {
    for (const raw of [{ messages: 'x' }, 42, { messages: [1, 2], selectedIndex: 0, edited: true }, undefined]) {
      await expect(logTrainingData({ campaignRunId: 'c1', companyId: 'co', messageType: 'LMS', isAd: true, finalMessage: '본문', finalSource: 'manual', aiVariantsRaw: raw })).resolves.toBeUndefined();
    }
    const finals = poolQuery.mock.calls.map((c) => (c[1] as unknown[])[13]);
    expect(finals.every((f) => f === 'manual')).toBe(true);
  });
  it('맞는 원값이면 후보 · 선택 · 편집 여부 · 시험 칸이 실린다', async () => {
    await logTrainingData({
      campaignRunId: 'c2', companyId: 'co', messageType: 'LMS', isAd: true, finalMessage: 'B안 고침', finalSource: 'manual',
      aiVariantsRaw: { messages: ['A안', 'B안', 'C안'], names: ['감성형', '혜택강조형', 'MZ감성형'], selectedIndex: 1, recommendedIndex: 0, edited: true, aiRefined: true, cVariant: 'mz' },
    });
    const args = poolQuery.mock.calls.at(-1)![1] as unknown[];
    expect(JSON.parse(String(args[10])).length).toBe(3);   // candidates
    expect(args[11]).toBe('c2');                              // selected_candidate_id = c1~c3
    expect(args[13]).toBe('edited');
    expect(JSON.parse(String(args[20])).hubVariants).toMatchObject({ recommendedIndex: 0, aiRefined: true, cVariant: 'mz' });
  });
  it('발송 라우트는 원값만 넘긴다(계산은 적재기 안)', () => {
    const c = SRC('routes', 'campaigns.ts');
    expect(c).toContain('aiVariantsRaw: req.body?.aiVariants,');
    expect(c).not.toMatch(/req\.body\??\.aiVariants\??\.(messages|selectedIndex|edited)/);
  });
});

describe('4. 라우트 게이트', () => {
  it('DM: 한 줄 입구 + 스위치일 때만 원문 전환 · 멱등은 토큰이 온 요청만 · 잠금은 finally', () => {
    const d = SRC('routes', 'dm.ts');
    expect(d).toContain("const oneLineReq = req.body?.one_line === true;");
    expect(d).toContain('const lineOn = oneLineReq && oneLineFactsEnabled(companyId);');
    expect(d).toContain('if (lineOn && prompt && !eventText && !scenario) {');
    expect(d).toContain("const attemptToken = lineOn && isValidAttemptToken(req.body?.attempt_token) ? String(req.body.attempt_token) : null;");
    expect(d).toContain('...(idemKey ? { idempotencyKey: idemKey } : {})');
    expect(d).toContain('if (lineLock) releaseInflight(lineLock);');
    // 스위치 밖인데 답이 오면 조용히 버리지 않는다
    expect(d).toContain("if (lineFacts !== undefined && !lineOn) {");
    // 이미 낸 키는 생성 전에 막는다(생성 → 차감 순서보다 앞)
    expect(d.indexOf('await isChargedByKey(companyId, idemKey)')).toBeLessThan(d.indexOf('const r = await oneShotGenerate({ prompt: effectivePrompt'));
  });
  it('이메일: 원문 자리는 옮기지 않고 멱등만 · 인앱: 원문 없을 때만 한 줄을 원문으로', () => {
    const e = SRC('routes', 'email.ts');
    expect(e).toContain("const lineOn = req.body?.one_line === true && oneLineFactsEnabled(auth.companyId);");
    expect(e).toContain('...(idemKey ? { idempotencyKey: idemKey } : {})');
    expect(e).toContain('if (lineLock) releaseInflight(lineLock);');
    const c = SRC('routes', 'cdp.ts');
    expect(c).toContain("const lineOn = req.body?.one_line === true && oneLineFactsEnabled(auth.companyId);");
    expect(c).toContain('eventText: lineAsEvent ?? (typeof event_text');
  });
  it('검수 응답에 첫 발행 관문 앞 두 칸을 싣는다(같은 함수)', () => {
    const d = SRC('routes', 'dm.ts');
    expect(d).toContain('try { staticBlock = dmPublishStaticBlock(dm); } catch');
    const g = SRC('utils', 'dm', 'dm-publish-gate.ts');
    expect(g).toContain('const staticBlock = dmPublishStaticBlock(dm);\n  if (staticBlock) return staticBlock;');
  });
});

describe('5. 허브 제안 — 묻기는 생성 · 차감 앞', () => {
  it('판정 응답이 오케스트레이터 호출보다 먼저다 · 스위치 켠 회사는 늘 원문 한정', () => {
    const a = SRC('routes', 'ai.ts');
    const start = a.indexOf("router.post('/operator/propose'");
    const ask = a.indexOf("return res.json({ success: true, needsFacts: { benefit: true } });", start);
    const call = a.indexOf('const result = await orchestratorFn({', start);
    expect(ask).toBeGreaterThan(start);
    expect(ask).toBeLessThan(call);
    expect(a).toContain('...(lineOn ? { lineFacts: lineFacts ?? { benefit: null } } : {}),');
    expect(a).toContain("router.post('/one-line/gaps'");
  });
});
