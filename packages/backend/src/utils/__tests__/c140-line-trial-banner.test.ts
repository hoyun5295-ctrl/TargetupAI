/**
 * C140 — 대시보드 진단 배너 개편(한 줄 입력칸 + 7일 무료체험) · 설계서 docs/2026-11-17-line-trial-banner-design.md
 *
 * ① 배너 판정(순수 함수 · 설계서 §4-2 (가)의 차례 표를 기대값으로 손으로 적는다)
 * ② 넘김 규칙(프론트 순수 함수 · §4-3 4)
 * ③ 소스 계약(대상을 소스에서 기계로 뽑는다 · §6)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { scanSources } from './source-scan';
import { judgeLineBanner, lineTrialAlive, isGrantDdlPending } from '../line-trial';
import { LINE_TRIAL_MAX, normalizeLine, planRefineHandoff, trialLeftLabel } from '../../../../frontend/src/utils/line-trial';
import { LOGIN_POPUPS, LINE_TRIAL_BANNER_ID } from '../../../../frontend/src/constants/login-popups';

const FRONT_SRC = resolve(__dirname, '../../../../frontend/src');
const BACK_SRC = resolve(__dirname, '../..');
const ADMIN = 'company_admin';

describe('① 배너 판정 — 설계서 §4-2 (가) 차례 표', () => {
  it('1번 줄: 고객사 관리자가 아니면 무엇이든 null', () => {
    for (const userType of ['company_user', 'super_admin', undefined, null, '']) {
      expect(judgeLineBanner({ userType, planCode: 'FREE', planTermManaged: false, hasGrant: false, trialFuture: false })).toBe(null);
      expect(judgeLineBanner({ userType, planCode: 'TRIAL', planTermManaged: false, hasGrant: true, trialFuture: true })).toBe(null);
    }
  });

  it('2번 줄: 체험 요금제 + 지급 행 + 만료일이 뒤 = trial', () => {
    expect(judgeLineBanner({ userType: ADMIN, planCode: 'TRIAL', planTermManaged: false, hasGrant: true, trialFuture: true })).toBe('trial');
  });

  it('3번 줄: 미가입 + 선불 잠김 아님 + 지급 행 없음 = offer', () => {
    expect(judgeLineBanner({ userType: ADMIN, planCode: 'FREE', planTermManaged: false, hasGrant: false, trialFuture: false })).toBe('offer');
    // 미가입 새 회사는 만료일 칸이 무엇이든(옛 체험의 흔적 · 미래 값) 지급 행이 없으면 제안이다 — 1021 Harold 「기존 무료체험과는 별개로」
    expect(judgeLineBanner({ userType: ADMIN, planCode: 'FREE', planTermManaged: false, hasGrant: false, trialFuture: true })).toBe('offer');
  });

  it('4번 줄: 그 밖 전부 null — 값 범위를 손으로 적은 표', () => {
    const rows: Array<[string, boolean, boolean, boolean, 'offer' | 'trial' | null]> = [
      // planCode, planTermManaged, hasGrant, trialFuture, 기대
      ['FREE', false, true, false, null],     // 체험을 이미 쓰고 끝남
      ['FREE', false, true, true, null],      // 지급 행이 있는데 미가입(만료 칸만 미래) = 체험 중이 아니다
      ['FREE', true, false, false, null],     // 선불 이용 기간 잠김
      ['FREE', true, true, false, null],
      ['TRIAL', false, false, true, null],    // 지급 행 없이 다른 체험 중(슈퍼관리자 30일 체험)
      ['TRIAL', false, true, false, null],    // 체험 요금제인데 만료일 없음 또는 지남
      ['TRIAL', false, false, false, null],
      ['BASIC', false, true, true, null],     // ★ 유료 + 지급 행 + 미래 만료(유료에 trial 상태가 같이 있는 조합) = 배너 없음
      ['BASIC', false, false, false, null],
      ['STARTER', false, false, true, null],
      ['STAFF', false, false, false, null],   // 임직원
      ['', false, false, false, null],        // 요금제 미배정 · 회사 행 없음
    ];
    for (const [planCode, planTermManaged, hasGrant, trialFuture, want] of rows) {
      expect(judgeLineBanner({ userType: ADMIN, planCode, planTermManaged, hasGrant, trialFuture }), `${planCode}/${planTermManaged}/${hasGrant}/${trialFuture}`).toBe(want);
    }
  });

  it('판정은 subscription_status 를 받지 않는다(인자 꼴 자체에 없다 · 유료에 trial 이 같이 남는 조합 · 옛 기본값 trial 로 태어난 미가입)', () => {
    // 반례 둘(설계서 §6): 유료 + status trial + 지급 행 + 미래 만료 = null · 미가입 + status trial(옛 기본값) + 지급 행 없음 = offer
    const paid = { userType: ADMIN, planCode: 'PRO', planTermManaged: false, hasGrant: true, trialFuture: true, subscription_status: 'trial' } as any;
    const fresh = { userType: ADMIN, planCode: 'FREE', planTermManaged: false, hasGrant: false, trialFuture: false, subscription_status: 'trial' } as any;
    expect(judgeLineBanner(paid)).toBe(null);
    expect(judgeLineBanner(fresh)).toBe('offer');
  });

  it('체험이 살아 있는가 = 2번 줄에서 역할만 뺀 것(시작 주소가 같이 쓴다)', () => {
    expect(lineTrialAlive({ planCode: 'TRIAL', hasGrant: true, trialFuture: true })).toBe(true);
    expect(lineTrialAlive({ planCode: 'TRIAL', hasGrant: true, trialFuture: false })).toBe(false);
    expect(lineTrialAlive({ planCode: 'TRIAL', hasGrant: false, trialFuture: true })).toBe(false);
    expect(lineTrialAlive({ planCode: 'FREE', hasGrant: true, trialFuture: true })).toBe(false);
    expect(lineTrialAlive({ planCode: 'BASIC', hasGrant: true, trialFuture: true })).toBe(false);
  });

  it('DDL 전 판정 = 지급 원장의 진단 id 칸 NOT NULL 위반만(다른 NOT NULL 위반은 아니다)', () => {
    expect(isGrantDdlPending({ code: '23502', table: 'diagnosis_trial_grants', column: 'diagnosis_id' })).toBe(true);
    expect(isGrantDdlPending({ code: '23502', table: 'diagnosis_trial_grants', column: 'granted_days' })).toBe(false);
    expect(isGrantDdlPending({ code: '23502', table: 'companies', column: 'diagnosis_id' })).toBe(false);
    expect(isGrantDdlPending({ code: '23505', table: 'diagnosis_trial_grants', column: 'diagnosis_id' })).toBe(false);
    expect(isGrantDdlPending(null)).toBe(false);
  });
});

describe('② 넘김 규칙 — 설계서 §4-3 4', () => {
  it('입력 정리: 앞뒤 빈칸만 있으면 빈 값 · 1자도 값 · 상한 80자', () => {
    expect(normalizeLine('   ')).toBe('');
    expect(normalizeLine('\t\n ')).toBe('');
    expect(normalizeLine(' 세 ')).toBe('세');
    expect(normalizeLine('  주말 이틀간 전 메뉴 20% 할인  ')).toBe('주말 이틀간 전 메뉴 20% 할인');
    expect(LINE_TRIAL_MAX).toBe(80);
    expect(normalizeLine('가'.repeat(120))).toBe('가'.repeat(80));
  });

  it('넘김: 본문이 비었으면 본문에도 넣는다 · 쓰던 글이 있으면 본문은 그대로 · 원문 스냅샷은 언제나 적은 한 줄', () => {
    expect(planRefineHandoff('', ' 주말 할인 ')).toEqual({ snapshot: '주말 할인', fillBody: true });
    expect(planRefineHandoff('  \n', '주말 할인')).toEqual({ snapshot: '주말 할인', fillBody: true });
    expect(planRefineHandoff('쓰던 글', '주말 할인')).toEqual({ snapshot: '주말 할인', fillBody: false });
  });

  it('넘김 값이 없거나 빈칸뿐이면 아무 일도 없다', () => {
    expect(planRefineHandoff('', null)).toBe(null);
    expect(planRefineHandoff('', undefined)).toBe(null);
    expect(planRefineHandoff('쓰던 글', '   ')).toBe(null);
  });

  it('남은 날 문구: 서버가 준 날 수 그대로 · 0 = 오늘까지 · 값이 없으면 날 수 없이', () => {
    expect(trialLeftLabel(7)).toBe('무료체험 7일 남음');
    expect(trialLeftLabel(1)).toBe('무료체험 1일 남음');
    expect(trialLeftLabel(0)).toBe('무료체험 오늘까지');
    expect(trialLeftLabel(null)).toBe('무료체험 진행 중');
    expect(trialLeftLabel(undefined)).toBe('무료체험 진행 중');
    expect(trialLeftLabel(-1)).toBe('무료체험 진행 중');
  });
});

describe('③ 소스 계약 — 대상을 소스에서 기계로 뽑는다(설계서 §6)', () => {
  const stripComments = (s: string) => s
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const fe = scanSources(FRONT_SRC).map((f) => ({ ...f, rel: f.rel.replace(/\\/g, '/') }));
  const feOf = (rel: string) => {
    const f = fe.find((x) => x.rel === rel);
    if (!f) throw new Error(`프론트 파일 없음 = ${rel}`);
    return f.src;
  };
  const banner = feOf('components/dashboard/LineTrialBanner.tsx');
  const bannerCode = stripComments(banner);
  const dash = feOf('pages/Dashboard.tsx');
  const hook = feOf('components/direct-send/useSendPrecheck.tsx');
  const modal = feOf('components/AiRefineModal.tsx');
  const route = readFileSync(resolve(BACK_SRC, 'routes/marketing-diagnosis.ts'), 'utf8');
  const ct = readFileSync(resolve(BACK_SRC, 'utils/line-trial.ts'), 'utf8');

  it('배너의 글에 줄표 · 가운뎃점 · 모델명 0 · 금액 숫자 0 · 버튼은 하나(옛 diagnosis-banner-trial-1021 의 「버튼 안 버튼 0 · 금액 하드코딩 0」을 옮김)', () => {
    expect(bannerCode).not.toMatch(/[—–·]/);
    expect(bannerCode).not.toMatch(/Opus|Sonnet|Haiku|GPT|Claude|Anthropic|claude-/i);
    expect(bannerCode).not.toMatch(/350,?000|35만|\d{1,3},\d{3}원/);
    expect((bannerCode.match(/<button/g) || []).length).toBe(1);
    // 고객에게 보이는 문장 = 설계서 §4-6 표 그대로
    const texts = ['7일 무료체험', '이번에 알릴 것,', '한 줄만 적어 보세요', 'AI가 한 줄을 읽고 문자 초안을 써 드려요.', '7일 무료로 써 보기',
      '누르면 AI 기능이 7일 동안 무료로 열려요.', '끝나면 지금 요금제로 돌아와요.', '한 줄을 먼저 적어 주세요.', '여는 중', '문자 초안 받기',
      '무료체험이 끝나면 지금 요금제로 돌아와요.'];
    for (const text of texts) expect(bannerCode, text).toContain(text);
    // 「무료」는 AI 기능 · 체험에만 붙는다(발송 요금까지 무료로 읽히는 말 0)
    expect(bannerCode).not.toMatch(/0원|전부 무료|발송.{0,6}무료/);
  });

  it('옛 진단 띠 · 초대 창은 프론트 어디에도 없다(파일 · 참조 · 초대 기록 호출)', () => {
    expect(fe.filter((f) => /DiagnosisHeroCard|DiagnosisInviteModal/.test(f.rel)).map((f) => f.rel)).toEqual([]);
    const refs = fe
      .filter((f) => /DiagnosisHeroCard|DiagnosisInviteModal|diagnosisApi\.invited\(|marketing-diagnosis\/invited/.test(stripComments(f.src)))
      .map((f) => f.rel);
    expect(refs).toEqual([]);
  });

  it('체험 시작 주소를 부르는 자리 = 배너 한 곳 · 주소 문자열 = API 헬퍼 한 곳', () => {
    const callers = fe.filter((f) => /\.startTrial\(/.test(stripComments(f.src))).map((f) => f.rel);
    expect(callers).toEqual(['components/dashboard/LineTrialBanner.tsx']);
    expect((bannerCode.match(/\.startTrial\(/g) || []).length).toBe(1);
    const urls = fe.filter((f) => stripComments(f.src).includes('/api/marketing-diagnosis/trial/start')).map((f) => f.rel);
    expect(urls).toEqual(['components/marketing-diagnosis/diagnosisApi.ts']);
  });

  it('화면은 배너를 스스로 판정하지 않는다 — 대시보드는 서버의 banner 칸만 읽고 배너 부품에는 요금제 · 지급 이력 낱말이 없다', () => {
    expect(dash).toContain("const lineBanner: 'offer' | 'trial' | null = diagnosisState?.banner === 'offer' || diagnosisState?.banner === 'trial' ? diagnosisState.banner : null;");
    expect(dash).toContain('{lineBanner && (');
    expect(dash).toContain("<BrandVoiceNudgeCard suppress={lineBanner === 'offer'} />");
    expect(bannerCode).not.toMatch(/plan_code|planCode|grantable|eligible|subscription|completedAt/);
    // 배너를 그리는 곳 = 대시보드 한 곳
    expect(fe.filter((f) => /<LineTrialBanner\b/.test(stripComments(f.src))).map((f) => f.rel)).toEqual(['pages/Dashboard.tsx']);
  });

  it('넘김의 목적지는 하나 — 배너 · 대시보드의 넘김 코드에 AI 한줄로 주소 · 넘김 열쇠 0 · 직접발송 창은 평소의 두 줄로 연다', () => {
    const at = dash.indexOf('const startLineTrialHandoff = (');
    const handoff = dash.slice(at, dash.indexOf('\n  };', at) + 5);
    expect(handoff.length).toBeGreaterThan(50);
    for (const code of [bannerCode, handoff]) {
      expect(code).not.toContain('/ai-line');
      expect(code).not.toContain('ai_operator_prefill_objective');
    }
    expect(handoff).toContain('setLineHandoff(line);');
    expect(handoff).toContain('setShowDirectSend(true);');
    expect(handoff).toContain("setDirectSendChannel('sms');");
    // 넘김 값을 본문 · 명단 · 발신번호 · 예약에 직접 쓰지 않는다(본문 채움은 점검 훅의 규칙 한 곳)
    expect(handoff).not.toMatch(/setDirectMessage|setDirectRecipients|setSelectedCallback|setReserve/);
    expect(dash).toContain('refineHandoff={lineHandoff} onRefineHandoffTaken={() => setLineHandoff(null)}');
  });

  // 창 요소(<AiRefineModal … />)를 소스에서 뽑는다 — 속성 값 안의 화살표(=>)에 걸리지 않게 「/>」까지
  const modalElements = (src: string): string[] => {
    const out: string[] = [];
    for (let i = src.indexOf('<AiRefineModal'); i >= 0; i = src.indexOf('<AiRefineModal', i + 1)) out.push(src.slice(i, src.indexOf('/>', i) + 2));
    return out;
  };

  it('점검 훅에 넘김 값을 주는 곳 = DirectSendPanel 하나 · AI 다듬기 창에 autoStart 를 주는 곳 = 점검 훅의 넘김 창 하나', () => {
    const hookCallers = fe.filter((f) => /useSendPrecheck\(\{/.test(f.src)).map((f) => f.rel).sort();
    expect(hookCallers).toEqual(['components/DirectSendPanel.tsx', 'components/TargetSendModal.tsx']);
    const giving = hookCallers.filter((rel) => {
      const src = feOf(rel);
      const from = src.indexOf('useSendPrecheck({');
      return /refineHandoff/.test(src.slice(from, src.indexOf('});', from)));
    });
    expect(giving).toEqual(['components/DirectSendPanel.tsx']);
    const modalUsers = fe.filter((f) => /<AiRefineModal\b/.test(f.src)).map((f) => f.rel).sort();
    expect(modalUsers).toEqual(['components/DmSendAndTrackModal.tsx', 'components/direct-send/useSendPrecheck.tsx', 'pages/AiLinePage.tsx']);
    const auto = modalUsers.flatMap((rel) => modalElements(feOf(rel)).filter((el) => /\bautoStart\b/.test(el)).map(() => rel));
    expect(auto).toEqual(['components/direct-send/useSendPrecheck.tsx']);
  });

  it('넘김의 AI 다듬기 = 원문 스냅샷이 있는 동안만 놓이는 별도 창 — 평소 창과 인스턴스가 달라 결과가 서로 새지 않는다(Codex 구현 1R 1)', () => {
    // 반례: 쓰던 글 A 를 둔 채 배너의 B 로 초안 → 적용하지 않고 닫기 → 맞춤법 창에서 평소 AI 다듬기 → B 의 결과가 A 의 결과처럼 보이면 안 된다.
    const els = modalElements(hook);
    expect(els).toHaveLength(2);
    const [usual, handoff] = els;
    // 평소 창 = 종전 그대로(본문이 원문 · 자동 생성 없음 · 열림 값으로 여닫는다)
    expect(usual).toContain('isOpen={showAiRefineModal}');
    expect(usual).toContain('originalMessage={message}');
    expect(usual).toContain('onClose={() => setShowAiRefineModal(false)}');
    expect(usual).not.toMatch(/autoStart|refineSnapshot/);
    // 넘김 창 = 스냅샷이 원문 · 놓이자마자 한 번 생성 · 닫기 = 스냅샷 비우기(= 그 창이 사라진다)
    expect(handoff).toMatch(/\bisOpen\s*\n/);
    expect(handoff).toContain('originalMessage={refineSnapshot}');
    expect(handoff).toMatch(/\bautoStart\s*\n/);
    expect(handoff).toContain('onClose={() => setRefineSnapshot(null)}');
    expect(handoff).not.toMatch(/showAiRefineModal/);
    // 넘김 창은 스냅샷 조건 안에만 있다(조건 밖에 놓이면 세션이 끝나도 결과를 쥔 채 남는다)
    const guardAt = hook.indexOf('{refineSnapshot !== null && (');
    expect(guardAt).toBeGreaterThan(0);
    expect(hook.indexOf(handoff)).toBeGreaterThan(guardAt);
    expect(hook.slice(guardAt, hook.indexOf(handoff)).trim()).toBe('{refineSnapshot !== null && (');
    expect(hook.indexOf(usual)).toBeLessThan(guardAt);
    // 두 창이 같은 적용 처리를 쓴다(안을 고르면 본문에 들어간다)
    expect(usual).toContain('onApply={applyRefined}');
    expect(handoff).toContain('onApply={applyRefined}');
  });

  it('넘김으로 여는 길은 화면 잠금 값을 읽지 않는다 · 평소 입구의 잠금 검사는 그대로 · 스냅샷을 쓰는 자리 = 받을 때 · 닫을 때 둘뿐', () => {
    const start = hook.indexOf('const plan = planRefineHandoff(');
    const effect = hook.slice(hook.lastIndexOf('useEffect(() => {', start), hook.indexOf('}, [refineHandoff]);', start));
    expect(effect).toContain('if (plan.fillBody) setMessage(plan.snapshot);');
    expect(effect).toContain('setRefineSnapshot(plan.snapshot);');
    expect(effect).toContain('onRefineHandoffTaken?.();');
    expect(effect).not.toMatch(/isAiMessagingLocked|onLockedFeature|setShowAiRefineModal/);
    expect(hook).toContain("if (isAiMessagingLocked) { onLockedFeature('ai-refine'); return; }");
    expect((hook.match(/setRefineSnapshot\(/g) || []).length).toBe(2);
    // 평소 창을 여는 자리 = 잠금 검사 뒤 하나 · 닫는 자리 = 그 창의 onClose 하나
    expect((hook.match(/setShowAiRefineModal\(true\)/g) || []).length).toBe(1);
    expect((hook.match(/setShowAiRefineModal\(false\)/g) || []).length).toBe(1);
  });

  it('AI 다듬기 창 — autoStart 는 열린 채 놓인 그 창에서 한 번만 생성 · 생성 중에는 닫기 · 다시 다듬기 · 말투가 잠겨 한 창 안에서 요청이 겹치지 않는다', () => {
    const fxAt = modal.indexOf('const autoStartedRef = useRef(false);');
    expect(fxAt).toBeGreaterThan(0);
    const fx = modal.slice(fxAt, modal.indexOf('if (!isOpen) return null;'));
    expect(fx).toContain('if (!isOpen || !autoStart || autoStartedRef.current) return;');
    expect(fx).toMatch(/autoStartedRef\.current = true;\s*void handleRefine\(\);/);
    expect(fx).toContain('}, [isOpen, autoStart]);');
    // 훅은 「닫혀 있으면 그리지 않는다」 앞에 있다(훅 차례가 열림에 따라 달라지지 않는다)
    expect(modal.indexOf('useEffect(() => {')).toBeLessThan(modal.indexOf('if (!isOpen) return null;'));
    // 자동 생성을 부르는 자리 = 그 효과 하나(그 밖 = 단추 둘의 onClick)
    expect((modal.match(/void handleRefine\(\)/g) || []).length).toBe(1);
    expect((modal.match(/onClick=\{handleRefine\}/g) || []).length).toBe(2);
    // 전제(요청이 겹치지 않는다) — 이 넷이 풀리면 늦은 답이 뒤 요청을 덮을 수 있다
    expect(modal).toMatch(/onClick=\{onClose\}\s*\n\s*disabled=\{loading\}/);                       // 닫기 단추: 생성 중 잠김
    // 생성을 부르는 단추 둘(다듬기 시작 · 다시 다듬기)은 생성 중 그려지지 않는다 — 그 단추를 감싼 조건을 소스에서 뽑아 본다
    const refineGuards = [...modal.matchAll(/\{([^\n{}]*)&& \(\s*\n\s*<button\s*\n\s*type="button"\s*\n\s*onClick=\{handleRefine\}/g)].map((m) => m[1].trim());
    expect(refineGuards).toHaveLength(2);
    for (const g of refineGuards) expect(g, g).toContain('!loading');
    expect(modal).toMatch(/disabled=\{loading\}\s*\n\s*onClick=\{\(\) => setTone\(t\.value\)\}/);    // 말투: 생성 중 잠김
    // 덧댄 순번 장치는 없다(구조로 닫았다) — 창은 다른 두 사용처에서 종전과 같은 동작이다
    expect(stripComments(modal)).not.toMatch(/reply-gate|gateRef|createReplyGate/);
    expect(fe.some((f) => f.rel === 'utils/reply-gate.ts')).toBe(false);
  });

  it('서버 — 시작 주소는 관리자 관문 뒤에서 CT 를 부르고 · 상태 주소는 CT 의 판정을 싣는다 · 라우트가 스스로 판정하지 않는다', () => {
    const start = route.slice(route.indexOf("router.post('/trial/start'"), route.indexOf('// POST /submit'));
    const gateAt = start.indexOf('if (blockedForNonAdmin(req, res)) return;');
    expect(gateAt).toBeGreaterThan(0);
    expect(gateAt).toBeLessThan(start.indexOf('await runLineTrialStart('));
    // 「회사당 한 번」 = 409 + TRIAL_USED · 화면은 그 상태 코드와 code 둘 다로 가른다(한쪽만 바꾸면 「지금은 열지 못했어요」로 샌다)
    expect(start).toContain("return res.status(409).json({ success: false, code: 'TRIAL_USED'");
    expect(bannerCode).toContain("if (r?.status === 409 && r.data?.code === 'TRIAL_USED') { onUsed(); return; }");
    expect(start).toContain("return res.status(400).json({ success: false, code: 'NOT_APPLICABLE'");
    expect(start).toContain('return res.status(404).json(');
    expect(start).toMatch(/if \(isGrantDdlPending\(err\)\) \{\s*return res\.status\(503\)\.json\(/);
    expect(start).toContain('if (isGrantDdlPending(err)) {');
    expect(start).toContain("code: 'DB_MIGRATION_PENDING'");
    expect(start).not.toMatch(/req\.body/);   // 몸통 없음 = 적은 한 줄은 서버로 오지 않는다
    const state = route.slice(route.indexOf("router.get('/state'"), route.indexOf("router.get('/questions'"));
    expect(state).toContain('const banner = judgeLineBanner({');
    // 배너 판정의 입력(만료 · 남은 날 · 지급 여부)은 회사 행과 한 문장으로 읽는다 = 한 스냅샷(Codex 구현 1R 2).
    //   지급 여부를 따로 읽으면 지급 COMMIT 과 겹칠 때 「요금제는 지급 전 · 원장은 지급 뒤」가 섞여 배너가 사라진다.
    expect(state).toContain("${lineBannerColumnsSql('c')}");
    expect(stripComments(state)).not.toMatch(/diagnosis_trial_grants/);   // 상태 주소에 지급 원장을 따로 읽는 문장 0
    expect(state).toContain('hasGrant: comp.has_grant === true,');
    expect(state).toContain('else if (comp.has_grant === true) grantable =');
    expect(ct).toContain('EXISTS (SELECT 1 FROM diagnosis_trial_grants dtg WHERE dtg.company_id = ${alias}.id) AS has_grant');
    expect(ct).toContain('${trialFutureSql(alias)} AS trial_future');
    expect(ct).toContain('${trialDaysLeftSql(alias)} AS trial_days_left');
    expect(state).toMatch(/success: true,\s*banner,\s*bannerDaysLeft,\s*eligible,\s*grantable,/);
    expect(route).not.toMatch(/plan_code === 'TRIAL'|planCode === 'TRIAL'/);
    // 체험이 살아 있는가를 정하는 식 = CT 한 곳(두 벌 금지) · 상태 칸으로 판정하지 않는다
    expect((ct.match(/p\.planCode === 'TRIAL'/g) || []).length).toBe(1);
    expect(stripComments(ct)).not.toMatch(/subscription_status/);
  });

  it('배너로 체험이 켜진 뒤 요금제 변경 알림(무료체험 활성화)은 넘김의 직접발송 창을 닫은 뒤에 뜬다 — 초안을 받는 창을 덮지 않고 · 없애지도 않는다', () => {
    // 알림 = 서버가 「안내한 요금제 ≠ 지금 요금제」로 내는 값(routes/companies.ts my-plan 의 plan_change) · 체험 시작 뒤 요금제 정보를 다시 읽으면 생긴다.
    // 그 창의 층(z 9997)이 직접발송 창 · AI 다듬기 창보다 위라 그대로 두면 생성 중인 초안을 덮는다.
    expect(dash).toContain('const planChangeHeld = lineSession && showDirectSend;');
    expect(dash).toContain('{planChange && !planChangeHeld && (');
    expect((dash.match(/\{planChange && /g) || []).length).toBe(1);   // 알림 창을 그리는 자리 하나
    // 미루는 표시를 켜는 곳 = 배너의 넘김 하나(평소 직접발송 창 · 미가입 회사의 알림 시점은 그대로)
    expect((dash.match(/setLineSession\(true\)/g) || []).length).toBe(1);
    const handoff = dash.slice(dash.indexOf('const startLineTrialHandoff = ('), dash.indexOf('const [planChange, setPlanChange]'));
    expect(handoff).toContain('setLineSession(true);');
    // 알림의 확인 기록(ack)은 그 창을 닫을 때만 — 넘김이 대신 확인 처리하지 않는다(알림을 없애지 않는다)
    expect(handoff).not.toMatch(/plan-change\/ack|closePlanChange|setPlanChange\(/);
    expect((dash.match(/plan-change\/ack/g) || []).length).toBe(1);
  });

  it('등록부에 배너가 있고 배너는 그 id 로 뜸 · 누름을 남긴다 · 도움말 글은 없어진 카드를 안내하지 않는다', () => {
    expect(LINE_TRIAL_BANNER_ID).toBe('line-trial');
    expect(/^[a-z][a-z-]{1,39}$/.test(LINE_TRIAL_BANNER_ID)).toBe(true);
    expect(LOGIN_POPUPS.find((p) => p.id === LINE_TRIAL_BANNER_ID)).toEqual({ id: 'line-trial', name: '7일 무료체험 배너', goLabel: '7일 무료로 써 보기', introKeys: [] });   // ★ C141 이름(슈퍼관리자 화면에만 쓰인다)
    expect(bannerCode).toContain("reportPlanFeature(LINE_TRIAL_BANNER_ID, 'open');");
    expect(bannerCode).toContain("if (offer) reportPlanFeature(LINE_TRIAL_BANNER_ID, 'go');");
    const catalog = readFileSync(resolve(BACK_SRC, 'content/feature-catalog.ts'), 'utf8');
    const entry = catalog.slice(catalog.indexOf("id: 'marketing-diagnosis'"), catalog.indexOf("id: 'campaign-agency'"));
    expect(entry).not.toContain('카드에서 "진단 시작"');
    expect(entry).not.toContain('대시보드 "진단 시작" 카드');
    expect(entry).toContain("open: 'open=diagnosis'");
    // 그 항목이 가리키는 프론트 파일이 실제로 있다
    const paths = [...entry.matchAll(/frontend\/src\/([\w/.-]+\.tsx)/g)].map((m) => m[1]);
    expect(paths.length).toBeGreaterThanOrEqual(3);
    for (const p of paths) expect(fe.some((f) => f.rel === p), p).toBe(true);
    expect(dash).toContain("else if (openParam === 'diagnosis') setShowDiagnosisWizard(true);");
  });
});
