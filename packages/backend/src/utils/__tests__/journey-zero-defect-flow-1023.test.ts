/**
 * 여정 결함 0 (★ 2026-10-23) — 실행 · 한 줄 여정 한 길
 *   4. 완료 = finishExecution 한 함수 · 고친 문안 재검사 전에는 보내지 않는다 · 켜진 여정 시작 조건 저장 = 세대 올림
 *   5. 한 줄 여정 한 길 — 모든 입구가 문장으로 만들기 창(질문표 · 서버 초안 · 작업 화면) · 한 줄의 혜택 · 마감일을 칸에 채움
 *   6. 생성 프롬프트 자기모순 0 — 금지어가 예시에 없다 · 금지 기호 ∩ 허용 기호 = 0 · 분량 · 말투 기준 하나
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { buildInterviewQuestions, decideJourneySpec, kstTodayYmd } from '../journey-interview';

const SRC = resolve(__dirname, '../..');
const FE = resolve(__dirname, '../../../../frontend/src');
const read = (p: string) => readFileSync(resolve(SRC, p), 'utf8');
const fe = (p: string) => readFileSync(resolve(FE, p), 'utf8');
const code = (s: string) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

describe('4. 실행 · 수정 경합', () => {
  const ex = code(read('utils/journey-executor.ts'));
  it('완료 수를 더하고 completed 로 바꾸는 곳 = finishExecution 하나(상태 확인 · 발송비는 한 번)', () => {
    expect((ex.match(/stats_total_completed = j\.stats_total_completed/g) || []).length).toBe(1);
    expect((ex.match(/THEN 'completed'/g) || []).length).toBe(1);
    expect(ex).not.toMatch(/status = 'completed',\s*completed_at = NOW\(\)/);
    expect(ex).not.toContain('markExecutionCompleted');
    expect(ex).not.toContain('completeAtEndStep');
    expect((ex.match(/await finishExecution\(/g) || []).length).toBeGreaterThanOrEqual(5);
  });
  it('고친 문안이 재검사 전이면 시간이 지나도 보내지 않는다(옛 PRETEST-MISS = 검사 없이 발송) · 운영 경보', () => {
    expect(ex).not.toContain('검사 없이 보낸다');
    const gate = ex.slice(ex.indexOf("if (pendingSnapshotAt && ['sms', 'lms', 'mms'].includes(String(step.channel))) {"), ex.indexOf('let activeVariantId'));
    expect(gate).toContain("return 'waited';");
    expect(gate).toContain('sendSystemAlert({');
    expect(gate).toContain('journey-pretest-late:');
  });
  it('켜진 여정 시작 조건 그 자리 저장 = 계보 잠금 뒤 세대(start_gen) 올림(B-1020-3)', () => {
    const r = read('routes/ai.ts');
    const opt = r.slice(r.indexOf("router.patch('/operator/journeys/:id/options'"), r.indexOf("router.get('/operator/journeys-data-capability'"));
    expect(opt.indexOf('await lockLineage(client, journeyId);')).toBeGreaterThan(-1);
    expect(opt.indexOf('await lockLineage(client, journeyId);')).toBeLessThan(opt.indexOf('FOR UPDATE'));
    expect(opt).toContain("if (status === 'active' && touchesEntry) norm.triggerFilters = { ...(norm.triggerFilters || {}), start_gen: startGenOf(curFilters) + 1 };");
    // 같은 칸을 한 UPDATE 에 두 번 쓰지 않는다(병합 한 번)
    expect((opt.match(/sets\.push\(`trigger_filters = /g) || []).length).toBe(1);
  });
});

describe('5. 한 줄 여정 한 길', () => {
  const plan = { key: 'p1', triggerEvent: 'purchase.first', title: '첫 구매 감사', objective: '첫 구매 고객에게 감사' };
  const avail = {};

  it('한 줄의 혜택 · 마감일 = 질문표 칸에 채워 둔다(사람의 글) · 마지막 날 질문', () => {
    const qs = buildInterviewQuestions([plan], avail, { benefit: '첫 구매 10% 쿠폰', entryEndsOn: '2099-10-31' });
    expect(qs.find((q) => q.id === 'p1:benefit')?.recommended).toBe('첫 구매 10% 쿠폰');
    const ends = qs.find((q) => q.id === 'p1:ends');
    expect(ends?.kind).toBe('date');
    expect(ends?.recommended).toBe('2099-10-31');
    const none = buildInterviewQuestions([plan], avail);
    expect(none.find((q) => q.id === 'p1:benefit')?.recommended).toBeUndefined();
    expect(none.find((q) => q.id === 'p1:ends')?.recommended).toBeUndefined();
  });

  it('답 검증: 마지막 날 = 날짜 · 오늘 이후 · 비우면 계속 받음 · 혜택을 지우면 혜택 없음', () => {
    const qs = buildInterviewQuestions([plan], avail, { benefit: '10% 쿠폰', entryEndsOn: '2099-10-31' });
    const ok = decideJourneySpec(plan, qs, {}, '2026-10-23');
    expect(ok.ok && ok.spec.entryEndsOn).toBe('2099-10-31');
    expect(ok.ok && ok.spec.benefitText).toBe('10% 쿠폰');
    const cleared = decideJourneySpec(plan, qs, { 'p1:benefit': '', 'p1:ends': '' }, '2026-10-23');
    expect(cleared.ok && cleared.spec.benefitText).toBeNull();
    expect(cleared.ok && cleared.spec.entryEndsOn).toBeNull();
    expect(decideJourneySpec(plan, qs, { 'p1:ends': '2020-01-01' }, '2026-10-23').ok).toBe(false);
    expect(decideJourneySpec(plan, qs, { 'p1:ends': '2026-13-01' }, '2026-10-23').ok).toBe(false);
    expect(kstTodayYmd(Date.UTC(2026, 9, 23, 16, 0))).toBe('2026-10-24');   // KST 새벽 1시 = 다음 날
  });

  it('서버: 한 줄 · 시작 사건 입구 = 질문표 한 길(듣기 · 반복 점검 · 마지막 날 저장) · 옛 한 줄 패키지 주소 삭제', () => {
    const ia = read('utils/journey-interview-ai.ts');
    expect(ia).toContain('const intent = listenLine(sentence);');
    expect(ia).toContain('export async function prepareInterviewPreset(');
    expect(ia).toContain('entryEndsOn: spec.entryEndsOn,');   // 마지막 날 = 초안 INSERT 한 번에(1R F4 · 따로 쓰는 UPDATE 0)
    const r = read('routes/ai.ts');
    expect(r).toContain("router.post('/operator/journeys-interview/preset'");
    expect(r).not.toContain("'/operator/journeys-ai-generate'");
    expect(read('utils/journey-ai-generator.ts')).toContain('journey-anchor-plan:${input.companyId}:${input.requestId}:${inputTag}');   // 2R: 요청 키 = 회사 · 화면 키 · 목표문
  });

  it('화면: 모든 만들기 입구가 openLineJourney → 문장으로 만들기 창 · 옛 화면 패키지 생성 길 0 · 지도 한 줄도 같은 창', () => {
    const page = fe('pages/JourneysPage.tsx');
    expect(page).not.toContain('handleAIGenerate');
    expect(page).not.toContain("'/api/ai/operator/journeys-ai-generate'");
    expect(page).toContain('<InterviewModal');
    expect((page.match(/openLineJourney\(|openFromCard\(/g) || []).length).toBeGreaterThanOrEqual(8);
    const map = fe('pages/JourneyMapPage.tsx');
    expect(map).not.toContain('/ai-journeys?objective=');
    expect(map).toContain('initialSentence={interviewSentence || undefined}');
    const modal = fe('components/journey/map/InterviewModal.tsx');
    expect(modal).toContain("fetch('/api/ai/operator/journeys-interview/preset'");
    // ★ 2026-10-24 질문 한 줄 = 공용 부품(ZoneQuestion · 자동 마케팅 한 줄 창과 같은 모양) · 날짜 칸은 그 부품이 그린다
    expect(modal).toContain('<ZoneQuestion');
    expect(fe('components/zone/ZoneQuestion.tsx')).toContain('type="date"');
    expect(fe('components/zone/zone-tabs.ts')).toContain("label: '고객 관계 지도'");
  });
});

describe('7. 화면 · 주소에 남은 결함', () => {
  it('진입 고객 · 성과 화면 = 상세 응답 { journey } 로 읽는다(옛 detail.journey = 이름 빔)', () => {
    expect(fe('pages/JourneyDetailPage.tsx')).toContain('journeyData.journey.name');
    expect(fe('pages/JourneyDetailPage.tsx')).not.toContain('journeyData.detail');
    expect(fe('pages/JourneyStatsPage.tsx')).toContain('journeyData.journey?.name');
  });
  it('켜기 점검의 걸린 칸 = 작업 화면 그 칸(내부 이름 토스트 · 듣는 곳 없는 이벤트 0)', () => {
    const m = code(fe('components/journey/JourneyActivationConfirmModal.tsx'));
    expect(m).not.toContain('journey:expand-step');
    expect(m).not.toContain('JourneysPage 편집');
    expect(m).toContain('navigate(`/ai-journeys?journey=${encodeURIComponent(journeyId)}&step=${encodeURIComponent(failedStep.stepId)}`)');
  });
  it('공용 확인 창 = Tab 을 창 안에 가둔다', () => {
    const c = fe('components/ConfirmModal.tsx');
    expect(c).toContain("document.addEventListener('keydown', onTab, true);");
    expect(c).toContain('ref={panelRef}');
  });
  it('죽은 주소 0(새 판 · 저장 전 표본 · 한 줄 패키지) · 요금제 내림 예상 = 여정 + 자동 마케팅', () => {
    const r = read('routes/ai.ts');
    expect(r).not.toContain("'/operator/journeys/:id/new-version'");
    expect(r).not.toContain("'/operator/preview-target-samples'");
    expect(r).not.toContain("'/operator/journeys-ai-generate'");
    const f = read('utils/journey-credit-forecast.ts');
    expect(f).toContain("source = 'continuous-operator-send'");
    expect(f).toContain('total: f.total + autoMarketing30');
  });
});

describe('6. 생성 프롬프트 자기모순 0', () => {
  const gen = read('utils/journey-ai-generator.ts');
  const start = gen.indexOf('let system = `');
  const sys = gen.slice(start, gen.indexOf('`;', start));
  const examples = sys.slice(sys.indexOf('[좋은 메시지 예시'), sys.indexOf('[budget / threshold]'));
  it('예시 = 금지어 0(금지한 말을 예시가 쓰면 AI 가 서로 다른 지시를 받는다)', () => {
    expect(examples.length).toBeGreaterThan(500);
    for (const w of ['준비했어요', '준비했답니다', '준비했습니다', '소중한 고객님', '특별한 혜택', '특별한 소식', '특별한 선물', '특별한 인사', '특별 안내', '특별하게']) {
      expect(examples, w).not.toContain(w);
    }
    expect(sys).not.toMatch(/"단골 고객님" → [^\n]*소중한 고객님/);
  });
  it('금지 기호 ∩ 허용 기호 = 0 · 분량 기준 하나 · 말투 기준 하나', () => {
    const allowLine = sys.split('\n').find((l) => l.includes('SMS 호환 특수문자 화이트리스트')) || '';
    const allow = new Set([...allowLine.slice(allowLine.indexOf('):') + 2)].filter((c) => !/[\s\w가-힣().,+\-]/.test(c)));
    expect(allow.size).toBeGreaterThan(10);
    const banLines = sys.split('\n').filter((l) => /^\s*- (화살표|표시):/.test(l));
    expect(banLines.length).toBe(2);
    for (const l of banLines) {
      const banned = [...l.slice(l.indexOf(':') + 1, l.indexOf('(대신'))].filter((c) => !/[\s\w가-힣\-]/.test(c));
      expect(banned.length).toBeGreaterThan(0);
      for (const c of banned) expect(allow.has(c), c).toBe(false);
    }
    expect(sys).not.toContain('LMS 300~500바이트');
    expect((sys.match(/LMS 500~700바이트/g) || []).length).toBe(1);
    expect(sys).not.toContain('메신저 보내듯');
  });
});
