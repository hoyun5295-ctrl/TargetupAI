/**
 * ★ 2026-10-19 대시보드 아래 한 줄 4칸(요금제 · 발송 현황 · DB 현황 · 오늘의 추천) 잠금
 *   설계서 = docs/2026-10-19-dashboard-four-cards-design.md(Harold 「2안 다듬은 목업대로 · 맘에 든다」).
 *   - 오늘의 추천 판정 = AI 한줄로 추천 띠와 한 곳(lib/hub-recommend) · 누름 분기 · 읽기 실패 갈래
 *   - 화면 계약 = 순서 · 열 · 돈은 요금제 칸 한 곳 · 숫자 한 줄 · 이름 단어 단위 · 잠김 갈래 = AI 한줄로 버튼과 같은 판정
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  buildHubRecs, hubRecAction, hubRecLabel, loadSelfDiagnosis, stashAiLineObjective, stashJourneyObjective,
  type AutoRecommendation, type CompanyHealthDiagnosis, type DiagnosisBrief,
} from '../../../../frontend/src/lib/hub-recommend';
import { exactTitle, fmtKo, topByCount } from '../../../../frontend/src/utils/dashboard-live';

const FRONT = resolve(__dirname, '../../../../frontend/src');
const read = (rel: string) => readFileSync(resolve(FRONT, rel), 'utf8');
/** 주석을 뺀 코드 줄(화면 문구 검사용) */
const codeLines = (src: string) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l));

const rule = (over: Partial<AutoRecommendation> = {}): AutoRecommendation => ({
  id: 'r1', priority: 1, type: 'churn_recovery', title: '이탈 위험 회복', reason: '근거', targetCount: 10,
  expectedImpact: '', oneClickObjective: '이탈 위험 고객 회복 캠페인', ...over,
});
const diag = (recs: AutoRecommendation[] = [rule()]): CompanyHealthDiagnosis => ({ overallScore: 60, topConcerns: [], recommendations: recs });
const brief = (recs: DiagnosisBrief['recommendations']): DiagnosisBrief => ({ brief_date: '2026-10-19', headline: null, recommendations: recs });
const briefRec = (over: Partial<DiagnosisBrief['recommendations'][number]> = {}) => ({
  title: '재구매 리마인드', objective: '재구매 주기가 지난 고객 리마인드', reason: '', targetCount: null, ...over,
});

describe('오늘의 추천 판정(lib/hub-recommend · AI 한줄로 띠와 한 곳)', () => {
  it('브리핑 추천이 있으면 브리핑 · 비었으면 규칙 추천 · 둘 다 없으면 0건', () => {
    const a = buildHubRecs(diag(), brief([briefRec()]));
    expect(a.useBrief).toBe(true);
    expect(a.recs.map((r) => r.kind)).toEqual(['brief']);
    const b = buildHubRecs(diag([rule(), rule({ id: 'r2' })]), brief([]));
    expect(b.useBrief).toBe(false);
    expect(b.recs.map((r) => r.kind)).toEqual(['rule', 'rule']);
    expect(buildHubRecs(diag([]), null)).toEqual({ recs: [], useBrief: false });
    // 서버가 규칙 추천을 빠뜨려도 화면이 죽지 않는다
    expect(buildHubRecs({ overallScore: 0, topConcerns: [] } as any, null).recs).toEqual([]);
  });

  it('누름 분기 = 규칙 · 기본 브리핑 = 한 줄 · 정착 제안 = 여정 · 채널 제안 = 그 화면', () => {
    expect(hubRecAction({ kind: 'rule', rec: rule() })).toEqual({ kind: 'line', objective: '이탈 위험 고객 회복 캠페인' });
    expect(hubRecAction({ kind: 'brief', rec: briefRec() })).toEqual({ kind: 'line', objective: '재구매 주기가 지난 고객 리마인드' });
    expect(hubRecAction({ kind: 'brief', rec: briefRec({ opportunityType: 'journey_promotion' }) })).toEqual({ kind: 'journey', objective: '재구매 주기가 지난 고객 리마인드' });
    expect(hubRecAction({ kind: 'brief', rec: briefRec({ recommendedChannel: 'email' }) })).toEqual({ kind: 'route', path: '/email-campaigns' });
    expect(hubRecAction({ kind: 'brief', rec: briefRec({ recommendedChannel: 'dm' }) })).toEqual({ kind: 'route', path: '/dm-builder' });
    // 정착 제안이 채널보다 먼저(옛 handleBriefRec 순서 그대로)
    expect(hubRecAction({ kind: 'brief', rec: briefRec({ opportunityType: 'journey_promotion', recommendedChannel: 'email' }) }).kind).toBe('journey');
    expect(hubRecLabel({ kind: 'rule', rec: rule() })).toBe('입력창에 채우기');
    expect(hubRecLabel({ kind: 'brief', rec: briefRec({ recommendedChannel: 'dm' }) })).toBe('모바일 DM에서 진행');
  });

  describe('넘기기 · 읽기', () => {
    afterEach(() => { vi.unstubAllGlobals(); });
    const store = () => {
      const m = new Map<string, string>();
      return { m, api: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } } };
    };

    it('한 줄 = AI 한줄로 화면이 읽는 키 · 여정 = 여정 화면이 읽는 키(모양 그대로)', () => {
      const ss = store();
      vi.stubGlobal('sessionStorage', ss.api);
      stashAiLineObjective('한 줄');
      stashJourneyObjective('여정 목표');
      expect(ss.m.get('ai_operator_prefill_objective')).toBe('한 줄');
      expect(JSON.parse(ss.m.get('journeyObjectivePrefill')!)).toEqual({ objective: '여정 목표', message: '' });
      // 받는 쪽이 같은 키를 읽는다
      expect(read('pages/AiLinePage.tsx')).toContain("sessionStorage.getItem('ai_operator_prefill_objective')");
      expect(read('pages/JourneysPage.tsx')).toContain("sessionStorage.getItem('journeyObjectivePrefill')");
    });

    it('읽기 = 403 은 잠김 · 그 밖 실패는 잠김 아님(다시 시도) · 성공은 브리핑 · 자동 마케팅 동봉', async () => {
      vi.stubGlobal('localStorage', store().api);
      const res = (status: number, body: unknown) => ({ status, json: async () => body });
      vi.stubGlobal('fetch', vi.fn(async () => res(403, { success: false })));
      expect(await loadSelfDiagnosis()).toEqual({ ok: false, locked: true });
      vi.stubGlobal('fetch', vi.fn(async () => res(500, { success: false })));
      expect(await loadSelfDiagnosis()).toEqual({ ok: false, locked: false });
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net'); }));
      expect(await loadSelfDiagnosis()).toEqual({ ok: false, locked: false });
      vi.stubGlobal('fetch', vi.fn(async () => res(200, { success: true, diagnosis: diag(), brief: null, autoMarketing: { active: 2, pendingProposals: 1 } })));
      const ok = await loadSelfDiagnosis();
      expect(ok.ok).toBe(true);
      if (ok.ok) {
        expect(ok.brief).toBeNull();
        expect(ok.autoMarketing).toEqual({ active: 2, pendingProposals: 1 });
      }
    });
  });
});

describe('대시보드 아래 한 줄 4칸 화면 계약', () => {
  const dash = read('pages/Dashboard.tsx');
  const plan = read('components/dashboard/PlanStatusCard.tsx');
  const send = read('components/dashboard/SendStatusCard.tsx');
  const db = read('components/dashboard/DbStatusCard.tsx');
  const rec = read('components/dashboard/TodayRecommendCard.tsx');
  const ailine = read('pages/AiLinePage.tsx');

  it('순서 = 요금제 · 발송 현황 · DB 현황 · 오늘의 추천 · 1280 이상 한 줄 4칸 · AI 숨김 = 3칸', () => {
    const order = ['<PlanStatusCard', '<SendStatusCard', '<DbStatusCard', '<TodayRecommendCard'].map((t) => dash.indexOf(t));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(dash).toContain("${hideAi ? 'lg:grid-cols-3' : 'sm:grid-cols-2 xl:grid-cols-4'}");
    expect(dash).toContain('{!hideAi && (\n            <TodayRecommendCard');
    // 옛 배치(요금제 40 | 발송 60 · DB 전체 폭 열 표) 0
    expect(dash).not.toContain('sm:w-[40%]');
    expect(dash).not.toContain('DB_CARD_LG_COLS');
  });

  it('돈은 요금제 칸 한 곳 · 발송 현황에 금액 · 잔액 0', () => {
    const planCode = codeLines(plan).join('\n');
    for (const t of ['이번 달 사용금액', '충전 잔액', '에이전트 잔액 <span', 'agentBalances.map((b) =>', 'onOpenBalance()', 'onOpenCreditHistory()']) expect(planCode).toContain(t);
    const sendCode = codeLines(send).join('\n');   // 머리 주석의 옮긴 경위는 빼고 본다
    for (const t of ['사용금액', '잔액', 'monthly_cost', 'agentBalances']) expect(sendCode).not.toContain(t);
    expect(dash).toContain('monthlyCost={stats?.monthly_cost || 0}');
    expect(dash).toContain('onOpenBalance={() => setShowBalanceModal(true)}');
    expect(dash).toContain('agentBalances={agentBalances}');
    // 잔액 창이 쓰는 이름과 같다
    expect(read('components/BalanceModals.tsx')).toContain('충전 잔액');
    // 안 버튼은 칸 이동(/pricing)과 분리
    expect(plan.match(/e\.stopPropagation\(\)/g)?.length).toBe(2);
  });

  it('글씨 깨짐 0 = 숫자 한 줄 · 이름 · 제목은 단어 단위 · 말줄임(truncate) 0', () => {
    for (const [name, src] of [['plan', plan], ['send', send], ['db', db], ['rec', rec]] as const) {
      expect(src, name).not.toMatch(/\btruncate\b/);
    }
    // DB 값 · 추천 대상 수 = 한 줄
    expect(db).toContain('<span className="shrink-0 flex flex-col items-end">');
    expect(db).toContain('className="text-[13px] font-bold text-gray-900 tabular-nums whitespace-nowrap"');
    expect(db).toContain('block text-[13px] text-gray-700 leading-snug break-keep');
    expect(rec).toContain('break-keep line-clamp-2');
  });

  it('오늘의 추천 = AI 한줄로 띠와 같은 판정 · 같은 창 · 잠김 갈래 = AI 한줄로 버튼과 같은 판정', () => {
    for (const src of [rec, ailine]) {
      expect(src).toContain('hubRecAction(r)');
      expect(src).toContain('buildHubRecs(');
      expect(src).toContain('<HubRecommendModal');
      expect(src).toContain('loadSelfDiagnosis()');
    }
    // AI 한줄로 띠 안에 옛 판정 · 창이 남지 않는다(한 곳)
    expect(ailine).not.toContain('const handleBriefRec');
    expect(ailine).not.toContain('interface AutoRecommendation');
    expect(ailine).not.toContain('aria-labelledby="hub-rec-title"');
    // 잠김: 구독 잠김 = 잠김 창 · 요금제 = AI 한줄로 소개 창(AI 한줄로 버튼과 같은 갈래)
    expect(dash).toContain("onLocked={(reason) => { if (reason === 'subscription') setShowSubscriptionLock(true); else openPlanFeature('ai-line'); }}");
    expect(dash).toContain("if ((await fetchAiOperatorAccess()) === false) { openPlanFeature('ai-line'); return; }");
    // 요금제 판정 = 칸이 읽는 self-diagnosis 의 403 · AI 한줄로 버튼의 /operator/access 와 같은 함수(서버 원문 대조) → 대시보드가 따로 묻지 않는다(Codex D1 · D2 같은 뿌리)
    const ai = readFileSync(resolve(__dirname, '../../routes/ai.ts'), 'utf8');
    const block = (start: string) => ai.slice(ai.indexOf(start), ai.indexOf('\nrouter.', ai.indexOf(start) + 1));
    expect(block("router.get('/operator/access',")).toContain('const allowed = isAiOperatorAllowed(planCtx, req.user);');
    expect(block("router.get('/operator/self-diagnosis',")).toContain('if (!isAiOperatorAllowed(planCtx, req.user)) {');
    expect(block("router.get('/operator/self-diagnosis',")).toContain("return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });");
    expect(dash).not.toContain('aiLineAllowed');
    // 다시 읽기 열쇠 = 요금제 코드 · 구독 상태 · 진단 완료 사건 횟수(Codex D3 · 진단 상태 다시 읽기 성공 여부와 무관)
    expect(dash).toContain("const recRevalidateKey = `${planInfo?.plan_code ?? ''}|${planInfo?.subscription_status ?? ''}|${recNonce}`;");
    expect(dash).toContain('onCompleted={() => { setRecNonce((n) => n + 1); void refreshDiagnosisState(); }}');
    expect(dash).not.toContain('onCompleted={refreshDiagnosisState}');
    // 진단 창 완료 통지 = 제출 성공 · 이미 제출(409 · 보고서 읽기 성공과 무관 · Codex D4) 두 곳 · 문항 갱신(VERSION_CHANGED)은 먼저 걸러 통지 없음
    const dm = read('components/marketing-diagnosis/DiagnosisModal.tsx');
    expect((dm.match(/onCompleted\(\)/g) || []).length).toBe(2);
    expect(dm).toContain('      if (r.status === 409) {\n        onCompleted();\n        if (await loadReport()) return;\n      }');
    // 문항 갱신(VERSION_CHANGED)은 409 처리보다 먼저 · 오류 화면으로 조기 반환(완료 통지 없음) — 분기가 없어지면 -1 비교로 거짓 통과하지 않게 존재부터(Codex D6)
    const submit = codeLines(dm.slice(dm.indexOf('  const submit = async ('), dm.indexOf('  const consult = async ('))).join('\n');
    const versionAt = submit.indexOf("      if (r.status === 409 && r.data?.code === 'VERSION_CHANGED') {");
    const conflictAt = submit.indexOf('      if (r.status === 409) {');
    expect(versionAt).toBeGreaterThanOrEqual(0);
    expect(conflictAt).toBeGreaterThanOrEqual(0);
    expect(versionAt).toBeLessThan(conflictAt);
    const versionBlock = submit.slice(versionAt, submit.indexOf('\n      }', versionAt));
    expect(versionBlock).toContain("setPhase('error');");
    expect(versionBlock).toContain('return;');
    expect(versionBlock).not.toContain('onCompleted');
    expect(dm).not.toContain('if (r.status === 409 && (await loadReport()))');
    expect(dash).toContain('revalidateKey={recRevalidateKey}');
    expect(dash).toContain('subscriptionLocked={isSubscriptionLocked}');
    // 칸 = 요금제 정보 뒤 · 구독 잠김 아닐 때만 읽고 · 열쇠 · 다시 시도로 다시 읽는다 · 늦은 옛 응답 버림 · 403 = 잠김(요금제)
    expect(rec).toContain('if (!ready || subscriptionLocked) return;');
    expect(rec).toContain('}, [ready, subscriptionLocked, revalidateKey, reload]);');
    expect(rec).toContain('if (!alive) return;');
    expect(rec).toContain("setState(res.locked ? 'locked' : 'error');");
    expect(rec).toContain("lockReason={subscriptionLocked ? 'subscription' : 'plan'}");
    // 추천 창은 칸 안에서 열려도 갇히지 않게 body 로
    expect(read('components/ai-line/HubRecommendModal.tsx')).toContain('createPortal(');
  });

  it('DB 칸 = 옛 칸 상태 · 값 표기 그대로 · 끝 쪽 버튼은 그리지 않음', () => {
    expect(db).toContain("관리자가 대시보드 카드를 설정하면 표시됩니다");
    expect(db).toContain('고객 DB를 업로드하면 현황을 확인할 수 있습니다');
    expect(db).toContain("type === 'sum' && v >= 10000 ? `${Math.round(v / 10000).toLocaleString()}만`");
    expect(db).toContain("card.cardId === 'active_campaigns' ? '건' : '명'");
    expect(db).toContain('{safePage > 0 ? (');
    expect(db).not.toContain('disabled:opacity-30');
    expect(dash).toContain('animate={(intro || dbReveal) && !dbPaged}');
    expect(dash).toContain('onOpenDetail={(card) => setDetailCard(card)}');
    // 옛 대시보드 아이콘 표를 빠짐없이 옮겼다
    expect(db).toContain('Bell, Send, CreditCard, HelpCircle, Percent,\n};');
    // Codex D1 — 분포 1위 = 수가 가장 큰 항목(서버 배열 순서 ≠ 순위)
    expect(db).toContain('const top = isDist ? topByCount(card.value as { label: string; count: number }[]) : undefined;');
    expect(db).not.toMatch(/as \{ label: string; count: number \}\[\]\)\[0\]/);
  });

  it('분포 1위 = 수가 가장 큰 항목 · 같으면 앞 · 원본 순서 그대로 · 빈 배열 = 없음(Codex D1)', () => {
    const ages = [{ label: '20대', count: 5 }, { label: '40대', count: 100 }, { label: '30대', count: 100 }];
    expect(topByCount(ages)?.label).toBe('40대');
    expect(ages.map((a) => a.label)).toEqual(['20대', '40대', '30대']);
    expect(topByCount([])).toBeUndefined();
  });

  it('큰 숫자 = 칸마다 정한 기준부터 한국식 줄임 · 정확한 값 = title · 돈은 줄이지 않음(Harold 1020)', () => {
    expect(fmtKo(100_000_000)(1_842_060_000)).toBe('18.4억');
    expect(fmtKo(100_000_000)(99_999_999)).toBe('99,999,999');
    expect(fmtKo(10_000_000)(12_848_000)).toBe('1284.8만');
    expect(exactTitle(1_842_060_000, 100_000_000, '건')).toBe('1,842,060,000건');
    expect(exactTitle(12_000, 100_000_000, '건')).toBeUndefined();
    const send = read('components/dashboard/SendStatusCard.tsx');
    expect(send).toContain('const STAT_FROM = 100_000_000;');
    expect(send).toContain('const CHANNEL_FROM = 10_000_000;');
    expect(send).toContain("title={exactTitle(value, STAT_FROM, '건')}");
    const plan = read('components/dashboard/PlanStatusCard.tsx');
    expect(plan).toContain('format={fmtCredit}');
    // 돈은 원 단위 그대로
    expect(plan).toContain('<CountUp value={monthlyCost} format={fmtInt} animate={intro} />');
    expect(plan).toContain('{fmtInt(Number(balance.balance) || 0)}');
    // DB = 1억 이상 줄임 · 증감은 값 아래 줄(이름 칸과 폭 다툼 없음)
    const db = read('components/dashboard/DbStatusCard.tsx');
    expect(db).toContain('const VALUE_FROM = 100_000_000;');
    const valueCol = db.slice(db.indexOf('<span className="shrink-0 flex flex-col items-end">'), db.indexOf('</button>', db.indexOf('<span className="shrink-0 flex flex-col items-end">')));
    expect(valueCol).toContain('<DeltaBadge compact ');
    expect(db.indexOf('<DeltaBadge compact ')).toBeGreaterThan(db.indexOf('<span className="shrink-0 flex flex-col items-end">'));
    // 증감 % 100 이상 = 정수 · 쉼표 · 정확한 값 = title
    const badge = read('components/dashboard/DeltaBadge.tsx');
    expect(badge).toContain('Math.abs(deltaPercent) >= 100 ? `${isPositive');
    expect(badge).toContain('{compact ? <span>{compactPercent ?? formattedDelta}</span> : <>');
  });

  it('증감 배지 compact = 선택값 · 기본 표기 그대로 · 변화 없음 표시에 줄표 0', () => {
    const badge = read('components/dashboard/DeltaBadge.tsx');
    expect(badge).toContain("compact = false }: DeltaBadgeProps)");
    expect(badge).toContain('{compact ? <span>{compactPercent ?? formattedDelta}</span> : <>');
    expect(badge).toContain('<span>{formattedDelta}</span>');
    expect(badge).toContain("isNegative ? '↓' : '·'");
    expect(db).toContain('<DeltaBadge compact ');
  });

  it('새 화면 문구 = 모델명 0 · 줄표 0', () => {
    const files = [plan, send, db, rec, read('components/dashboard/dash-card.tsx'), read('components/ai-line/HubRecommendModal.tsx')];
    for (const src of files) {
      for (const line of codeLines(src)) {
        expect(line).not.toMatch(/Opus|Sonnet|Haiku|GPT|Claude|Anthropic|claude-/);
        expect(line).not.toContain('—');
      }
    }
  });
});
