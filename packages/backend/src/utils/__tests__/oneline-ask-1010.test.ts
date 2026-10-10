/**
 * ★ 2026-10-10 한 줄 묻기 · 추천(설계서 docs/2026-10-10-oneline-ask-design.md) 잠금.
 *   ① 판정: 화면이 내보내는 명령 문장은 전부 만들기 · Harold 원문 · 질문 예시는 답하기
 *   ② 답 조립(순수 부분) ③ 오늘의 추천 보여 주기 CT ④ 문 · 입구 · 생성 경로 무변경 · 0단계 정정
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { oneLineIntent, oneLineAskTopic, lineWithoutReads, oneLineAskEnabled } from '../one-line-facts';
import { journeyCardsFrom, contentCardsFrom, LINE_ASK_CARDS_MAX } from '../one-line-ask';
import { briefForViewer } from '../daily-brief-policy';
import { findNewNumbers } from '../copy-benefit-detector';
import { presetObjectiveFor } from '../journey-opportunities';
import { TRIGGER_CONTRACTS } from '../journey-trigger-capability';

const SRC = resolve(__dirname, '..', '..');
const FRONT = resolve(__dirname, '../../../../frontend/src');
const read = (p: string) => readFileSync(resolve(SRC, p), 'utf8');
const readFront = (p: string) => readFileSync(resolve(FRONT, p), 'utf8');
/** 소스 안 `key: '문장'` 모양의 값 전부 */
const quoted = (src: string, key: string) => Array.from(src.matchAll(new RegExp(`${key}: '([^']+)'`, 'g'))).map((m) => m[1]);

describe('① 판정 — 화면이 내보내는 명령 문장은 전부 만들기', () => {
  const modules = readFront('constants/ai-operator-modules.ts');
  const placeholders = quoted(modules, 'placeholder').filter((p) => !p.startsWith('행사 주소를'));   // 만들기(재료 읽기)는 판정하지 않는다
  const opp = read('utils/journey-opportunities.ts');
  const ask = read('utils/one-line-ask.ts');

  it('7메뉴 예시 문장(만들기 제외 6) = make', () => {
    expect(placeholders.length).toBe(6);
    for (const p of placeholders) {
      expect(oneLineIntent(p), p).toBe('make');
      expect(oneLineIntent(p, { contentChannel: true }), p).toBe('make');
    }
  });

  it('여정 기회 · 이어달리기 · 진단 계획 · 시작 사건 골격 = make', () => {
    const lines = [...quoted(opp, 'suggestedObjective'), ...quoted(opp, 'objective')];
    for (const c of TRIGGER_CONTRACTS) { const o = presetObjectiveFor(c.event); if (o) lines.push(o); }
    expect(lines.length).toBeGreaterThan(15);
    for (const l of lines) expect(oneLineIntent(l), l).toBe('make');
  });

  it('답 카드가 채우는 뼈대 · 인앱 목표 = make(카드를 누르면 다시 질문이 되지 않는다)', () => {
    const lines = [...Array.from(ask.matchAll(/^\s+\w+: '([^']+)',$/gm)).map((m) => m[1]), ...quoted(ask, 'objective')];
    expect(lines.length).toBeGreaterThanOrEqual(8);
    for (const l of lines) expect(oneLineIntent(l, { contentChannel: true }), l).toBe('make');
  });

  it('Harold 원문 · 질문 예시 = ask', () => {
    for (const q of [
      '우리 현재 상황에서 가장 추가하면 효율이 좋을 여정이 뭐야?',
      '여정 추천해 줘',
      '지금 뭐부터 만들면 좋아?',
      '추천해서 만들어 줘',
      '이번 달 어떤 자동 마케팅을 돌려야 할까',
    ]) expect(oneLineIntent(q), q).toBe('ask');
    expect(oneLineIntent('이번 주에 뭐 보내면 좋을까', { contentChannel: true })).toBe('ask');
    expect(oneLineIntent('어떻게 하면 휴면 고객 부를 수 있을까')).toBe('ask');
    expect(oneLineAskTopic('어떻게 하면 휴면 고객 부를 수 있을까')).toBe('how');
    expect(oneLineAskTopic('가장 효율 좋을 여정이 뭐야?')).toBe('what');
  });

  it('명령인데 물음꼴 · 문안 훅 · 혜택 값 · 주소 = make', () => {
    expect(oneLineIntent('추천 상품 넣어서 DM 만들어 줄래?')).toBe('make');   // 「추천」이 이름말
    expect(oneLineIntent('VIP 고객에게 신상 안내 보내줄래?')).toBe('make');
    expect(oneLineIntent('어떤 니트가 좋을까? 가을 신상 3종 첫 구매 10%')).toBe('make');   // 혜택 값
    expect(oneLineIntent('이번 겨울 어떤 코트가 어울릴까?', { contentChannel: true })).toBe('make');   // 문안 훅
    expect(oneLineIntent('https://shop.example.com/event 이거 뭐야?')).toBe('make');
    expect(oneLineIntent('')).toBe('make');
  });

  it('사진에서 읽은 조각은 판정에서 뺀다 — 포스터 문구의 물음이 질문이 되지 않는다', () => {
    const read1 = '올 가을 어떤 스타일이 좋을까?';
    const line = `가을 신상 안내 · ${read1}`;
    expect(oneLineIntent(line)).toBe('ask');   // 빼지 않으면 질문으로 오판
    expect(lineWithoutReads(line, [read1])).toBe('가을 신상 안내');
    expect(oneLineIntent(lineWithoutReads(line, [read1]))).toBe('make');
  });

  it('스위치 = 비면 꺼짐 · * = 전 회사 · 명단', () => {
    expect(oneLineAskEnabled('c1', '')).toBe(false);
    expect(oneLineAskEnabled('c1', '*')).toBe(true);
    expect(oneLineAskEnabled('c1', 'c0,c1')).toBe(true);
    expect(oneLineAskEnabled('c2', 'c0,c1')).toBe(false);
  });
});

describe('② 답 조립(순수)', () => {
  const opp = (type: any, trig: string | undefined, count: number) => ({
    type, templateCode: 'custom' as const, title: `t-${type}`, description: `d-${type}`, count, valueAtStake: count * 10,
    priority: 'medium' as const, suggestedObjective: `o-${type}`, ...(trig ? { preferTriggerEvent: trig } : {}),
  });

  it('여정 카드 = 시작 사건 있는 것만 · 초안 · 멈춤 접기 · 최대 3장 · 순서 유지', () => {
    const cards = journeyCardsFrom([
      opp('dormant', 'customer.dormant', 50),
      opp('wishlist', undefined, 40),            // 시작 사건 없음 = 1클릭 여정 아님
      opp('cart_recovery', 'cdp.cart_abandon', 30),   // 초안 있음
      opp('birthday', 'customer.birthday_approaching', 20),
      opp('onboarding', 'customer.created', 10),
      opp('repurchase_due', 'customer.cycle_lapsed', 5),
    ], new Set(['cdp.cart_abandon']));
    expect(cards.map((c) => c.title)).toEqual(['t-dormant', 't-birthday', 't-onboarding']);
    expect(cards.length).toBeLessThanOrEqual(LINE_ASK_CARDS_MAX);
    expect(cards[0].action).toEqual({ kind: 'journey', objective: 'o-dormant', preferTriggerEvent: 'customer.dormant' });
  });

  it('내용 카드 = 한 줄 뼈대 채우기 · 이어달리기 제외 · 인원은 받는 사람이 아니라고 적는다', () => {
    const cards = contentCardsFrom([opp('succession', 'purchase.first', 9), opp('cart_recovery', 'cdp.cart_abandon', 3)]);
    expect(cards.map((c) => c.key)).toEqual(['content:cart_recovery']);
    expect(cards[0].action.kind).toBe('fill');
    expect(cards[0].countNote).toContain('대상은 보낼 때 골라요');
  });
});

describe('③ 오늘의 추천 보여 주기 CT', () => {
  const row = {
    brief_date: '2026-10-10', headline: '휴면 1,240명이 가장 큽니다',
    recommendations: [
      { title: '휴면 복귀', objective: '휴면 복귀 유도', reason: '휴면 1,240명 · 규모 ₩3,100,000', opportunityType: 'dormant', targetCount: 1240, valueAtStake: 3100000, recommendedChannel: null },
      { title: '생일', objective: '생일 인사', reason: '생일 고객 77명이 이번 주예요', opportunityType: 'birthday', targetCount: 31, valueAtStake: 0, recommendedChannel: null },
    ],
    signals: { opportunities: [{ type: 'dormant', count: 1240, valueAtStake: 3100000 }, { type: 'birthday', count: 31, valueAtStake: 0 }] },
  };

  it('담당자 = 머리 문장 · 이유 · 인원 · 규모 숨김', () => {
    const v = briefForViewer(row, { isAdmin: false }, findNewNumbers)!;
    expect(v.headline).toBeNull();
    expect(v.recommendations.every((r) => r.reason === '' && r.targetCount === null && r.valueAtStake === null)).toBe(true);
    expect(v.recommendations.map((r) => r.title)).toEqual(['휴면 복귀', '생일']);
  });

  it('관리자 = 저장 신호에 없는 숫자를 쓴 이유만 비운다', () => {
    const v = briefForViewer(row, { isAdmin: true }, findNewNumbers)!;
    expect(v.headline).toBe('휴면 1,240명이 가장 큽니다');
    expect(v.recommendations[0].reason).toContain('1,240');
    expect(v.recommendations[1].reason).toBe('');   // 77 은 근거에 없다
  });

  it('행이 없으면 null', () => {
    expect(briefForViewer(null, { isAdmin: true }, findNewNumbers)).toBeNull();
  });

  it('담당자 = 제목 · 목표의 숫자는 코드 뼈대로 · 뼈대 없으면 뺀다 · 칸을 골라 담는다(R1)', () => {
    const v = briefForViewer({
      brief_date: '2026-10-10', headline: null,
      recommendations: [
        { title: '휴면 1,240명 복귀', objective: '휴면 복귀 유도', reason: 'x', opportunityType: 'dormant', targetCount: 1240, valueAtStake: 1, recommendedChannel: null, secret: 9 },
        { title: '정착 제안', objective: '발송 120건 · 클릭 15 목표 그대로', reason: 'x', opportunityType: 'journey_promotion', targetCount: null, valueAtStake: null, recommendedChannel: null },
        { title: '생일', objective: '생일 인사', reason: 'x', opportunityType: 'birthday', targetCount: 31, valueAtStake: 0, recommendedChannel: 'sms' },
      ],
      signals: { opportunities: [{ type: 'dormant', title: '장기 무구매 휴면', suggestedObjective: '장기 휴면 고객 복귀 유도: 재방문 안내', count: 1240 }] },
    }, { isAdmin: false }, findNewNumbers)!;
    expect(v.recommendations.map((r) => [r.title, r.objective])).toEqual([
      ['장기 무구매 휴면', '장기 휴면 고객 복귀 유도: 재방문 안내'],
      ['생일', '생일 인사'],
    ]);
    for (const r of v.recommendations) {
      expect(Object.keys(r).sort()).toEqual(['objective', 'opportunityType', 'reason', 'recommendedChannel', 'targetCount', 'title', 'valueAtStake']);
    }
    expect(v.recommendations[1].recommendedChannel).toBe('sms');
  });
});

describe('④ 문 · 입구 · 생성 경로 무변경 · 0단계', () => {
  const ai = read('routes/ai.ts');
  const body = (src: string, start: string) => src.slice(src.indexOf(start), src.indexOf('\n});', src.indexOf(start)));

  it('판정 전달 = 기존 gaps 응답의 칸(별도 스위치 · 스위치 밖 = make)', () => {
    const g = body(ai, "router.post('/one-line/gaps'");
    expect(g).toContain('ask_enabled: askEnabled,');
    expect(g).toContain("const intent = askEnabled ? oneLineIntent(typed, { contentChannel: menu === 'dm' || menu === 'email' || menu === 'sns' }) : 'make';");
    expect(g).toContain('const typed = lineWithoutReads(');
  });

  it('답 경로 = 메뉴마다 그 메뉴의 문', () => {
    expect(body(ai, "router.post('/operator/journeys-ask'")).toContain('isAiOperatorAllowed(planCtx, req.user)');
    expect(body(ai, "router.post('/operator/continuous-ask'")).toContain('isAiOperatorAllowed(planCtx, req.user)');
    expect(body(read('routes/cdp.ts'), "router.post('/inapp/ask'")).toContain('await ensureInAppAccess(req, res)');
    expect(read('routes/dm.ts')).toContain("dmRouter.post('/one-line/ask'");
    expect(body(read('routes/email.ts'), "router.post('/one-line/ask'")).toContain('await ensureEmailAccess(req, res)');
    const sns = read('routes/sns.ts');
    expect(sns.indexOf("router.post('/one-line/ask'")).toBeGreaterThan(sns.indexOf("code: 'SNS_NOT_OPENED'"));
    for (const p of [ai, read('routes/cdp.ts'), read('routes/dm.ts'), read('routes/email.ts'), sns]) expect(p).toContain('LINE_ASK_DISABLED');
  });

  it('판정 함수는 gaps 한 곳에서만 · 생성 경로(dm · email · 여정 생성)는 판정을 모른다', () => {
    expect(read('routes/dm.ts')).not.toContain('oneLineIntent');
    expect(read('routes/email.ts')).not.toContain('oneLineIntent');
    expect(read('utils/journey-ai-generator.ts')).not.toContain('oneLineIntent');
    expect(ai.match(/oneLineIntent\(/g)?.length).toBe(1);
  });

  it('화면 입구에서만 판정 — 여정 생성 함수 · DM 생성 요청은 그대로', () => {
    const jp = readFront('pages/JourneysPage.tsx');
    const fn = jp.slice(jp.indexOf('const handleAIGenerate = async'), jp.indexOf('\n  };', jp.indexOf('const handleAIGenerate = async')));
    expect(fn).not.toContain('lineAsk');
    expect(jp.match(/await lineAsk\.route\(/g)?.length).toBe(2);   // 목록 한 줄 · 지도 ?objective= 자동 경로
    expect(readFront('pages/ContinuousOperatorPage.tsx').match(/await lineAsk\.route\(/g)?.length).toBe(1);
    expect(readFront('pages/InAppMessagesPage.tsx').match(/await lineAsk\.route\(/g)?.length).toBe(2);
    expect(readFront('pages/DmBuilderPage.tsx')).toContain("if (!skipAsk && (await lineAsk.route(t, { gaps: g }))) return;");
    expect(readFront('pages/EmailCampaignsPage.tsx')).toContain("if (!skipAsk && (await lineQ.route(t, { gaps: g }))) return;");
    expect(readFront('pages/SnsPage.tsx').match(/await lineAsk\.route\(/g)?.length).toBe(1);
  });

  it('답 읽기가 실패해도 자동으로 만들지 않는다 · 판정 중 두 번째 제출은 삼킨다', () => {
    const hook = readFront('hooks/useLineAsk.ts');
    expect(hook).toContain('if (busy.current) return true;');
    expect(hook).toContain("error: '답을 읽지 못했어요. 잠시 뒤 다시 물어봐 주세요.'");
    expect(hook).toContain('return true;\n    } finally');
  });

  it('판정을 기다리는 동안 다른 생성 입구 잠금 · 옛 답은 판정 시작에 닫음 · 인앱 사진 조각 · 초안 확인 실패 = 카드 없음(R1)', () => {
    const hook = readFront('hooks/useLineAsk.ts');
    expect(hook.indexOf('setAsk(null);')).toBeGreaterThan(0);
    expect(hook.indexOf('setAsk(null);')).toBeLessThan(hook.indexOf('await fetchOneLineGaps('));
    expect(hook).toContain('readsInLine(t, reads.current)');
    const inapp = readFront('pages/InAppMessagesPage.tsx');
    expect(inapp.match(/lineAsk\.noteRead\(t\)/g)?.length).toBe(2);
    expect(inapp).toContain('disabled={aiGenerating || lineAsk.judging}');
    expect(readFront('pages/JourneysPage.tsx').match(/disabled=\{generating \|\| lineAsk\.judging\}/g)?.length).toBe(2);
    const auto = readFront('pages/ContinuousOperatorPage.tsx');
    expect(auto).toContain('submitting={creating || lineAsk.judging}');
    const cost = auto.slice(auto.indexOf('cardCost={(c) => {'), auto.indexOf('makeCost=', auto.indexOf('cardCost={(c) => {')));
    expect(cost).not.toContain('ownCopy');   // 카드 = handleBriefStart = 늘 AI 문안
    expect(read('utils/one-line-ask.ts')).toContain('const cards = opps.ok && skip.ok && !sc.blocked ? journeyCardsFrom(opps.value, skip.value) : [];');
  });

  it('0단계 ① 규모 = 1회 구매액 축(휴면 · 장바구니 · 재구매) · 설명의 누적은 따로', () => {
    const opp = read('utils/journey-opportunities.ts');
    expect(opp).toContain('COALESCE(SUM(COALESCE(avg_order_value, recent_purchase_amount, $4::numeric))');
    expect(opp.match(/SUM\(COALESCE\(avg_order_value, recent_purchase_amount, \$4::numeric\)\)/g)?.length).toBe(3);
    expect(opp).toContain('AS dorm_total');
    expect(opp).toContain('누적 ${won(num(a.dorm_total))} 구매한 고객층');
    expect(opp).toContain('[companyId, p75Days, medianDays, medianAov]');
  });

  it('0단계 ② 담당자 범위 = 인원 · 규모 집계에만 · 라우트가 보는 사람을 넘긴다', () => {
    const opp = read('utils/journey-opportunities.ts');
    expect(opp).toContain("const scopeSql = await getOwnerCustomerScopeSql(companyId, ownerUserId, 'c');");
    expect(opp).toContain('COALESCE(is_invalid, false) = false${scopeSql}`');
    expect(opp).toContain('buildSuccessionOpportunities(companyId, activeTriggers, scopeSql)');
    expect(ai).toContain('const opportunities = await buildJourneyOpportunities(companyId, req.user?.userId);');
    expect(read('utils/company-daily-brief.ts')).toContain('buildJourneyOpportunities(companyId)');   // 워커 = 회사 전체
  });

  it('0단계 ③ 오늘의 추천을 내보내는 두 곳이 같은 CT · ④ 리듬 없음은 캐시하지 않는다', () => {
    expect(ai.match(/briefForViewer\(/g)?.length).toBe(2);
    expect(read('utils/journey-opportunities.ts')).toContain('if (entry.rhythm) diagCache.set(companyId, entry);');
  });
});
