/**
 * ★ 2026-10-21 한 줄 입력 → 끝판왕 DM · 이메일 · 인앱 계약 (설계서 docs/2026-10-21-oneline-content-design.md)
 *   P1 = 스위치 0 · 자동 형태 세로 · 입구 하나 / P2 = 전면 헤드라인(스튜디오 템플릿 3안 · 포스터는 덮지 않는다)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync, mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { resolve, join } from 'path';

vi.mock('../../services/ai', () => ({ callAIWithFallback: vi.fn() }));

import { callAIWithFallback } from '../../services/ai';
import {
  pickLineHeadlines, diverseLineHeadlines, sanitizeLineHeadlineTitle, fallbackLineHeadlineTitle, LINE_HEADLINE_PICKS,
} from '../line-headline';
import { templatePickCandidates } from '../sales-outreach-produce';
import { SUB_BY_ID } from '../image-studio-template-subs';
import { DM_AUTO_LAYOUT } from '../dm/dm-page-split';
import { sanitizeLineStepsBody } from '../one-line-steps';
import { lineTemplateMaterials } from '../line-template-run';
import { composeLineDm } from '../line-template-compose';
import { getLineTemplate } from '../design-core/line-templates';
import type { StudioTemplate } from '../image-studio-templates';

const ai = callAIWithFallback as unknown as ReturnType<typeof vi.fn>;
const SRC = resolve(__dirname, '../..');
const FE = resolve(__dirname, '../../../../frontend/src');
const NOW = new Date('2026-10-21T03:00:00Z');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === '__tests__' ? [] : walk(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\.ts$/.test(n) ? [p] : [];
  });
}

describe('P1 · 스위치 0 · 자동 형태 세로 · 입구 하나', () => {
  it('한 줄 스위치 3종이 코드 어디에도 없다', () => {
    const hits = [...walk(SRC), ...walk(FE)].filter((f) => /ONE_LINE_FACTS_COMPANY_IDS|ONE_LINE_STEPS_COMPANY_IDS|LINE_TEMPLATES_COMPANY_IDS|oneLineFactsEnabled|oneLineStepsEnabled|lineTemplatesEnabled/.test(readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });
  it('기계가 고르는 DM 형태 = 세로 · 한 줄 창 기본 = page · 형태 칸 이름', () => {
    expect(DM_AUTO_LAYOUT).toBe('scroll');
    const modal = readFileSync(join(FE, 'components/zone/LineStepsModal.tsx'), 'utf8');
    expect(modal).toContain("(answers.template?.layout ?? 'page')");
    const pick = readFileSync(join(FE, 'components/zone/LineTemplatePick.tsx'), 'utf8');
    expect(pick).toContain("{ id: 'page', label: '세로 스크롤'");
    expect(pick.indexOf("id: 'page'")).toBeLessThan(pick.indexOf("id: 'slides'"));
  });
  it('옛 입구(원스텝 · AI 만들기 창) 없음 · 편집기 [AI로 다시 구성] = 한 줄 창', () => {
    const page = readFileSync(join(FE, 'pages/DmBuilderPage.tsx'), 'utf8');
    expect(page).not.toContain('OneStepInterviewModal');
    expect(page).not.toContain('<AiPromptModal');
    expect(page).not.toContain("title: '질문 몇 개로'");
    expect(page).toContain("if (openModalNow !== 'ai-prompt') return;");
    expect(page).toContain("if (typeof after === 'function') after();");
  });
});

describe('P2 · 헤드라인 템플릿 3안', () => {
  beforeEach(() => ai.mockReset());
  const pool = templatePickCandidates('beauty', NOW);

  it('3안 = 세부 분류가 서로 다르다', () => {
    const all = [...pool.product, ...pool.event];
    const byId = new Map<string, StudioTemplate>(all.map((t) => [t.id, t]));
    const out = diverseLineHeadlines(all.map((t) => t.id), byId);
    expect(out).toHaveLength(LINE_HEADLINE_PICKS);
    const subs = out.map((t) => SUB_BY_ID[t.id] || t.category);
    expect(new Set(subs).size).toBe(subs.length);
  });

  it('헤드라인 글 = 한 줄에 없는 숫자 · 혜택 거절 · 16자', () => {
    expect(sanitizeLineHeadlineTitle('가을 피부 준비 완료', '가을 수분크림 행사')).toBe('가을 피부 준비 완료');
    expect(sanitizeLineHeadlineTitle('지금 30% 할인', '가을 수분크림 행사')).toBeNull();
    expect(sanitizeLineHeadlineTitle('무료배송 이벤트', '가을 수분크림 행사')).toBeNull();
    expect(sanitizeLineHeadlineTitle('아주아주아주아주아주아주아주아주긴헤드라인', '가')!.length).toBeLessThanOrEqual(16);
    expect(fallbackLineHeadlineTitle('가을 수분크림 행사합니다. 많이 오세요')).toBe('가을 수분크림 행사합니다');
  });

  it('AI 가 고르면 목록 안 id 만 · 사진 없으면 행사 템플릿만 · 제목 검사', async () => {
    const ev = pool.event.slice(0, 4).map((t) => t.id);
    ai.mockResolvedValue(JSON.stringify({ product: [pool.product[0].id], event: [...ev, 'not-a-template'], reason: 'r', title: '가을 촉촉 루틴' }));
    const r = await pickLineHeadlines({ companyId: 'c', companyName: '한줄 뷰티', industry: 'beauty', line: '가을 수분크림 행사', productNames: [], hasPhoto: false, now: NOW });
    expect(r.source).toBe('ai');
    expect(r.title).toBe('가을 촉촉 루틴');
    expect(r.picks.length).toBeGreaterThan(0);
    expect(r.picks.every((p) => p.kind === 'event')).toBe(true);
    expect(r.picks.every((p) => ev.includes(p.id))).toBe(true);
    for (const p of r.picks) expect(p.sampleUrl).toMatch(/^\/api\/image-studio\/template-sample\/|^https?:|^\//);
    // 묶음 안에서 부른다(차감 0) — source 이름으로 집계
    expect(ai.mock.calls[0][0].source).toBe('line-headline-pick');
  });

  it('AI 답을 못 쓰면 = 해시가 아니라 풀 순서(source rule) · 3안 · 제목 = 한 줄 앞부분', async () => {
    ai.mockResolvedValue('모르겠어요');
    const r = await pickLineHeadlines({ companyId: 'c', companyName: 'x', industry: 'beauty', line: '신상 립 출시', productNames: [], hasPhoto: true, now: NOW });
    expect(r.source).toBe('rule');
    expect(r.picks).toHaveLength(LINE_HEADLINE_PICKS);
    expect(r.title).toBe('신상 립 출시');
  });

  it('포스터 표식 = 글자 박힌 그림은 덮지 않는다(asIs) · 올린 사진이 아니면 무시', () => {
    const b = sanitizeLineStepsBody({ steps: { v: 1 }, hero_image: '/api/cdp/inapp/image/c/a.png', hero_poster: true }, Date.now());
    expect(b && b !== 'invalid' && b.heroPoster).toBe(true);
    expect(sanitizeLineStepsBody({ steps: { v: 1 }, hero_poster: 'yes' }, Date.now())).toBe('invalid');
    const noImg = sanitizeLineStepsBody({ steps: { v: 1 }, hero_poster: true }, Date.now());
    expect(noImg && noImg !== 'invalid' && noImg.heroPoster).toBe(false);

    const t = getLineTemplate('big-sale')!;
    const base = { template: t, channel: 'dm' as const, companyId: 'c', line: '가을 세일', brandName: 'B', logoUrl: null, csPhone: null, pinnedPrimary: null, cards: [], textProducts: [], page: null, benefitAnswer: '전 품목 20%', periodEnd: null, link: 'https://b.example/' };
    const poster = lineTemplateMaterials({ ...base, heroUpload: '/api/cdp/inapp/image/c/p.png', heroAsIs: true });
    expect(poster.materials.hero).toEqual({ url: '/api/cdp/inapp/image/c/p.png', asIs: true });
    const photo = lineTemplateMaterials({ ...base, heroUpload: '/api/cdp/inapp/image/c/p.png' });
    expect(photo.materials.hero).toEqual({ url: '/api/cdp/inapp/image/c/p.png' });
    // 포스터 표지 = 그림 원본(갤러리) + 아래 제목 · 사진 위에 글자를 얹는 hero 가 아니다
    const copy = Object.fromEntries(t.copy.map((f) => [f.key, f.fallback])) as any;
    const dm = composeLineDm(poster.t, 'page', poster.materials, copy, () => Math.random().toString(36).slice(2));
    expect(dm.layoutMode).toBe('scroll');
    const cover = dm.sections.find((s) => (s as any).tpl_slot === 'p0.cover');
    expect(cover?.type).toBe('gallery');
  });
});

describe('P1 R1 · 주소 읽기 하루 상한(전 회사 개방 · 사진 사본 누적 차단)', () => {
  it('회사마다 하루 상한까지만 · 다음 날 다시', async () => {
    const { takeDailyQuota } = await import('../inflight-lock');
    const day1 = Date.parse('2026-10-21T01:00:00Z');
    for (let i = 0; i < 3; i++) expect(takeDailyQuota('t:a', 3, day1)).toBe(true);
    expect(takeDailyQuota('t:a', 3, day1)).toBe(false);
    expect(takeDailyQuota('t:b', 3, day1)).toBe(true);
    expect(takeDailyQuota('t:a', 3, day1 + 86_400_000)).toBe(true);
  });
  it('라우트가 읽기 전에 상한을 본다(잠금을 풀고 429)', () => {
    const src = readFileSync(join(SRC, 'routes/event-campaigns.ts'), 'utf8');
    const at = src.indexOf("takeDailyQuota(`read-url:${companyId}`, READ_URL_DAILY_MAX)");
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(src.indexOf('const r = await readBrandPage(companyId, req.body?.url);'));
  });
});

describe('P3 · ④ 신뢰 = 고객 후기(붙여 넣은 원문 · 사람이 고른 별점 · 비면 구역 없음)', () => {
  const t = getLineTemplate('new-launch')!;
  const copy = Object.fromEntries(t.copy.map((f) => [f.key, f.fallback])) as any;
  const base = { template: t, channel: 'dm' as const, companyId: 'c', line: '앰플 출시', brandName: 'B', logoUrl: null, csPhone: null, pinnedPrimary: null, cards: [], textProducts: [{ name: '앰플' }], heroUpload: null, page: null, benefitAnswer: undefined, periodEnd: null, link: 'https://b.example/' };
  const id = () => Math.random().toString(36).slice(2);
  it('후기 단계 = DM · 이메일 판정에 있고 인앱엔 없다', async () => {
    const { buildLineTemplatePlan } = await import('../line-template-plan');
    const inp = (channel: 'dm' | 'email' | 'inapp') => ({ judged: '앰플 출시', line: '앰플 출시', typed: '앰플 출시', channel, mall: false, inappBlocked: false, upload: true, website: null, mallHome: null, cost: null, lineFp: 'abcdefabcdef' } as any);
    expect(buildLineTemplatePlan(t, inp('dm')).steps.map((s) => s.key)).toContain('proof');
    expect(buildLineTemplatePlan(t, inp('email')).steps.map((s) => s.key)).toContain('proof');
    expect(buildLineTemplatePlan(t, inp('inapp')).steps.map((s) => s.key)).not.toContain('proof');
  });
  it('몸통 검증 = 3건 · 본문 2~300자 · 별점 1~5 정수 · 작성자 비면 「구매 고객」', () => {
    const ok = sanitizeLineStepsBody({ steps: { v: 1 }, proof: [{ body: '촉촉해요', rating: 5 }, { body: '재구매해요', author: '김**', rating: 4 }] }, Date.now());
    expect(ok !== 'invalid' && ok && ok.proof).toEqual([{ body: '촉촉해요', author: '구매 고객', rating: 5 }, { body: '재구매해요', author: '김**', rating: 4 }]);
    expect(sanitizeLineStepsBody({ steps: { v: 1 }, proof: [{ body: '좋아요', rating: 6 }] }, Date.now())).toBe('invalid');
    expect(sanitizeLineStepsBody({ steps: { v: 1 }, proof: [{ body: 'x', rating: 5 }] }, Date.now())).toBe('invalid');
    expect(sanitizeLineStepsBody({ steps: { v: 1 }, proof: new Array(4).fill({ body: '좋아요', rating: 5 }) }, Date.now())).toBe('invalid');
  });
  it('후기가 있으면 마무리 앞 후기 구역 · 없으면 후기 섹션 0 · 관문 통과 · 이메일도 같은 구역', async () => {
    const { lineTemplateGate, composeLineEmail } = await import('../line-template-compose');
    const withP = lineTemplateMaterials({ ...base, proof: [{ body: '촉촉해요', author: '김**', rating: 5 }] });
    const dm = composeLineDm(withP.t, 'page', withP.materials, copy, id);
    const types = dm.sections.map((s) => s.type);
    expect(types).toContain('reviews');
    expect(types.indexOf('reviews')).toBeLessThan(types.lastIndexOf('cta'));
    expect(lineTemplateGate(dm.sections)).toEqual([]);
    expect(composeLineEmail(withP.t, withP.materials, copy, id).sections.some((s) => s.type === 'reviews')).toBe(true);
    const noP = lineTemplateMaterials(base);
    expect(composeLineDm(noP.t, 'page', noP.materials, copy, id).sections.some((s) => s.type === 'reviews')).toBe(false);
    expect(lineTemplateGate([{ id: 'x', type: 'reviews', order: 0, visible: true, props: { reviews: [] } } as any])).toContain('빈 후기 섹션');
  });
});

describe('P2 R1 · 헤드라인 돈 · 값 · 누출 정정(Codex)', () => {
  it('그림 안 글자 = 숫자 · 혜택 낱말 0(교차 조합 「20% 할인」 · 금액 · 무료 · 적립 거절)', () => {
    for (const bad of ['20% 할인', '만원 쿠폰', '무료 배송', '적립 두 배', '특가 찬스', '반값 찬스', '경품 이벤트']) expect(sanitizeLineHeadlineTitle(bad), bad).toBeNull();
    expect(sanitizeLineHeadlineTitle('원데이 촉촉 루틴')).toBe('원데이 촉촉 루틴');
    expect(fallbackLineHeadlineTitle('니트 20% 할인 세일 이번 주말까지')).not.toMatch(/[0-9]|할인|세일/);
  });
  it('★ R2 구조 = 헤드라인은 서버 한 경로(누끼 → 생성 → 저장 → 차감 · 입력 지문 멱등키) · 화면은 이어 붙이지 않는다', () => {
    const step = readFileSync(join(FE, 'components/zone/LineHeadlineStep.tsx'), 'utf8');
    expect(step).toContain("studioPost('/api/image-studio/line-headline'");
    expect(step).not.toContain('/api/image-studio/generate');
    expect(step).not.toContain('/api/image-studio/remove-bg');
    expect(step).not.toContain('saveStudioTemp');
    expect(step).toContain('onMade(r.data.url, storeKey);');
    const route = readFileSync(join(SRC, 'routes/image-studio.ts'), 'utf8');
    const at = (n: string) => { const i = route.indexOf(n); expect(i, n).toBeGreaterThan(-1); return i; };
    const start = at("imageStudioRouter.post('/line-headline'");
    const safe = at('!headlineTextSafe(title)');
    const key = at('const key = lineHeadlineCreditKey(companyId, fp);');
    const recall = at('const made = readLineHeadlineByFp(companyId, fp);');
    const paid = at('alreadyPaid = await isChargedByKey(companyId, key);');
    const running = route.indexOf('if (!markLineHeadlineRunning(companyId, uid, lineFp)) return ledgerDown();', start);
    const make = route.indexOf('moved = await makeLineHeadlineImage({ companyId, template, texts, productImage: rawImg || null });', start);
    const settle = route.indexOf('idempotencyKey: key });', start);
    const last = route.indexOf("if (!markLineHeadlineDone(companyId, uid, lineFp, fp, moved.url, 'settling')) { drop(); return ledgerDown(); }", start);
    const open = route.indexOf("markLineHeadlineDone(companyId, uid, lineFp, fp, moved.url, 'done');", start);
    const clear = route.indexOf('if (running) clearLineHeadlineRunning(companyId, uid, lineFp);', start);
    for (const [a, b] of [[start, safe], [safe, key], [key, recall], [recall, paid], [paid, running], [running, make], [make, last], [last, settle], [settle, open], [open, clear]]) expect(a).toBeLessThan(b);
    // R3 — 제품 템플릿 = 실사진 필수 · 지난번 그림 되찾기(0원)
    expect(route).toContain("if (isProduct && !rawImg) return res.status(400)");
    expect(route).toContain("imageStudioRouter.get('/line-headline/last'");
    // R5 — 원장 쓰기 실패 = 생성 · 차감 멈춤 · 적중 요청은 원장을 건드리지 않음
    expect(route).toContain('if (!markLineHeadlineRunning(companyId, uid, lineFp)) return ledgerDown();');
    expect(route).toContain('if (made) return res.json({ success: true, url: made });');
    expect(step).toContain('/api/image-studio/line-headline/last?lineFp=');
    expect(step).toContain('이 그림 쓰기 · 0크레딧');
    // R4 — 만드는 중이면 끝날 때까지 다시 묻고 새로 만들기를 막는다 · 내 사진 올리기와 서로 잠금
    expect(step).toContain('data.running === true');
    expect(step).toContain('if (!chosen || busy || waiting || blocked) return;');
    const modal = readFileSync(join(FE, 'components/zone/LineStepsModal.tsx'), 'utf8');
    expect(modal).toContain('disabled={headlineBusy} onBusy={setPhotoBusy}');
    expect(modal).toContain('blocked={photoBusy}');
  });
  it('부모 = 만드는 중 잠금(다음 · 건너뛰기 · 만들기 · 단계 이동) · 결과는 시작 때 보존 키로', () => {
    const modal = readFileSync(join(FE, 'components/zone/LineStepsModal.tsx'), 'utf8');
    expect(modal).toContain('disabled={nextDisabled || headlineBusy}');
    expect(modal).toContain("disabled={cost === null || !!short || headlineBusy || judging}");
    expect(modal).toContain('const go = (id: string) => { if (!headlineBusy) setCursor(id); };');
    expect(modal).toContain('if (key === storeKeyRef.current) {');
    expect(modal).toContain("disabled={headlineBusy} onClick={() => setPane('pick')}");
  });
  it('추천 라우트 = 회사당 동시 1건 · 하루 상한을 AI 앞에서', () => {
    const src = readFileSync(join(SRC, 'routes/line-templates.ts'), 'utf8');
    const lock = src.indexOf("if (!tryAcquireInflight(lockKey))");
    const quota = src.indexOf('takeDailyQuota(`line-headline-picks:${companyId}`, HEADLINE_PICKS_DAILY_MAX)');
    const call = src.indexOf('const r = await pickLineHeadlines({');
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(quota);
    expect(quota).toBeLessThan(call);
    expect(src).toContain('releaseInflight(lockKey);');
  });
});

describe('P3 R1 · 후기 원문은 자리표시 검사 밖', () => {
  it('「직접 입력」이 든 실제 후기로도 조립 관문 통과', async () => {
    const { lineTemplateGate } = await import('../line-template-compose');
    expect(lineTemplateGate([{ id: 'r', type: 'reviews', order: 0, visible: true, props: { reviews: [{ rating: 5, author: 'a', body: '이니셜을 직접 입력해서 주문했는데 만족해요' }] } } as any])).toEqual([]);
    expect(lineTemplateGate([{ id: 't', type: 'text_card', order: 0, visible: true, props: { body: '직접 입력해주세요' } } as any])).toContain('자리표시 글자(text_card)');
  });
});

describe('P2 R3 · 공용 그림 핵심(라우트 · 시연 명령이 같은 함수)', () => {
  it('주소 판정 = 우리 서버 사진(디스크) · 바깥 https · 그 밖 거절', async () => {
    const { lineHeadlineImageSource } = await import('../line-headline-make');
    const C = '1be15adb-84b8-4025-9957-5c2d39076c1d';
    expect(lineHeadlineImageSource('', C)).toBeNull();
    expect((lineHeadlineImageSource(`/api/cdp/inapp/image/${C}/a.png`, C) as any).kind).toBe('disk');
    expect((lineHeadlineImageSource('https://shop.example/p.jpg', C) as any).kind).toBe('remote');
    expect(lineHeadlineImageSource('http://shop.example/p.jpg', C)).toBe('invalid');
    expect(lineHeadlineImageSource('/api/cdp/inapp/image/other-company/a.png', C)).toBe('invalid');
  });
  it('작업 원장 = 담당자 · 한 줄마다 만드는 중(5분) · 완료(24시간) · 입력 지문 완료는 기간 없음', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lh-'));
    const prev = process.env.INAPP_IMAGE_PATH;
    process.env.INAPP_IMAGE_PATH = dir;
    vi.resetModules();
    try {
      const L = await import('../line-headline-make');
      const C = 'co1', U = 'u1', F = 'fp1', T = 1_000_000_000;
      expect(L.readLineHeadlineLast(C, U, F, T)).toBeNull();
      L.markLineHeadlineRunning(C, U, F, T);
      expect(L.readLineHeadlineLast(C, U, F, T + 1000)?.state).toBe('running');
      expect(L.readLineHeadlineLast(C, 'u2', F, T + 1000)).toBeNull();
      expect(L.readLineHeadlineLast(C, U, F, T + L.LINE_HEADLINE_RUNNING_MS)).toBeNull();
      // 차감 중 = 주소를 내보내지 않는다(만드는 중으로 보임 · 같은 입력 적중 아님)
      L.markLineHeadlineDone(C, U, F, 'x1', '/api/cdp/inapp/image/co1/a.png', 'settling', T);
      expect(L.readLineHeadlineByFp(C, 'x1')).toBeNull();
      // /last 판정: 차감 전 = 만드는 중(주소 없음) · 5분 뒤 = 없음 · 차감됨 = 완료로 되살려 공개 · 확인 실패 = 만드는 중
      const no = async () => false;
      expect(await L.resolveLineHeadlineLast(C, U, F, no, T + 1000)).toEqual({ running: true, url: null });
      expect(await L.resolveLineHeadlineLast(C, U, F, no, T + L.LINE_HEADLINE_RUNNING_MS)).toEqual({ running: false, url: null });
      expect(await L.resolveLineHeadlineLast(C, U, F, async () => { throw new Error('db'); }, T + 1000)).toEqual({ running: true, url: null });
      const asked: string[] = [];
      expect(await L.resolveLineHeadlineLast(C, U, F, async (k) => { asked.push(k); return true; }, T + L.LINE_HEADLINE_RUNNING_MS)).toEqual({ running: false, url: '/api/cdp/inapp/image/co1/a.png' });
      expect(asked).toEqual([L.lineHeadlineCreditKey(C, 'x1')]);
      expect(L.readLineHeadlineByFp(C, 'x1')).toBe('/api/cdp/inapp/image/co1/a.png');
      L.markLineHeadlineDone(C, U, F, 'x1', '/api/cdp/inapp/image/co1/a.png', 'done', T);
      expect(L.readLineHeadlineLast(C, U, F, T + 1000)?.url).toBe('/api/cdp/inapp/image/co1/a.png');
      expect(L.readLineHeadlineLast(C, U, F, T + L.LINE_HEADLINE_KEEP_MS)).toBeNull();
      expect(L.readLineHeadlineByFp(C, 'x1')).toBe('/api/cdp/inapp/image/co1/a.png');
      expect(L.readLineHeadlineByFp('co2', 'x1')).toBeNull();
      // R8 — 차감 확인을 기다리는 사이 다른 입력 B 가 완료되면 B 를 덮지 않는다
      L.markLineHeadlineDone(C, U, F, 'xa', '/a2.png', 'settling', T);
      const r8 = await L.resolveLineHeadlineLast(C, U, F, async () => { L.markLineHeadlineDone(C, U, F, 'xb', '/b2.png', 'done', T + 5); return true; }, T + 1000);
      expect(r8).toEqual({ running: false, url: '/b2.png' });
      expect(L.readLineHeadlineLast(C, U, F, T + 1000)?.url).toBe('/b2.png');
      expect(L.readLineHeadlineByFp(C, 'xa')).toBe('/a2.png');
      L.markLineHeadlineDone(C, U, F, 'x1', '/api/cdp/inapp/image/co1/a.png', 'done', T);
      L.clearLineHeadlineRunning(C, U, F);
      expect(L.readLineHeadlineLast(C, U, F, T + 1000)?.state).toBe('done');
      L.markLineHeadlineRunning(C, U, F, T);
      L.clearLineHeadlineRunning(C, U, F);
      expect(L.readLineHeadlineLast(C, U, F, T + 1000)).toBeNull();
      // 되돌리기 = 그 그림을 가리키는 기록만 지운다
      expect(L.markLineHeadlineDone(C, U, F, 'x2', '/b.png', 'done', T)).toBe(true);
      L.unmarkLineHeadlineDone(C, U, F, 'x1', '/b.png');
      expect(L.readLineHeadlineByFp(C, 'x1')).toBe('/api/cdp/inapp/image/co1/a.png');
      expect(L.readLineHeadlineLast(C, U, F, T + 1000)).toBeNull();
      L.unmarkLineHeadlineDone(C, U, F, 'x2', '/b.png');
      expect(L.readLineHeadlineByFp(C, 'x2')).toBeNull();
      expect(existsSync(join(dir, '.line-headline', C))).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.INAPP_IMAGE_PATH; else process.env.INAPP_IMAGE_PATH = prev;
      vi.resetModules();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('시연 명령 = 차감 · DB 초안 쓰기 없이 같은 부품', () => {
    const cli = readFileSync(resolve(__dirname, '../../../scripts/oneline-demo-set.ts'), 'utf8');
    for (const f of ['pickLineHeadlines(', 'makeLineHeadlineImage(', 'runLineJudge(', 'readBrandPage(', 'draftLineCook(', 'buildLineCookDm(', 'renderDmViewerHtml(']) expect(cli, f).toContain(f);
    for (const f of ['deductCredit', 'settleCredit', 'createDm(']) expect(cli, f).not.toContain(f);
    // R4 — 실물 캡처 실패 · HTTP 오류 = 불합격 + 종료 코드 1
    expect(cli).toContain('if (!res || !res.ok()) throw');
    expect(cli).toContain("fails.push(`실물 캡처 ${e?.message}`)");
    expect(cli).toContain('process.exit(1); }');
  });
});
