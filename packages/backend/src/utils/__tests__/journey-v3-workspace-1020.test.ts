/**
 * 여정 V.3 묶음 5 · 6 — 작업 화면 + 큰 휴대폰 · 지도 보기 쉽게(2026-10-20 · 설계서 §9 · §10)
 *
 * 못 박는 것:
 *   - 화면이 옮겨 둔 서버 판정이 서버와 같다(시작 조건 키 · 새 모양 옵션 판정 · 조건 칸 목록) — 두 벌이 어긋나면 여기서 깨진다
 *   - 옛 상세 창에만 있던 기능이 작업 화면으로 옮겨졌다(켜기 전 미리 보기 · 재진입 · 자동 재진입 · A/B · 칸 빼기 · 담당자 알림 · AI 다음 칸)
 *   - 편집기 여러 벌이 큰 휴대폰 한 벌을 쓴다((광고) · 무료수신거부 합성 바이트 · 제목 40 · 받는 모습 = 서버 미리보기)
 *   - 사용자에게 보이는 글에 「새 판」 · 멈춤 원문 0
 *   - 지도 [한눈에] 배치: 상자 겹침 0 · 카드 높이 = 데이터로 계산한 값 · 상품 띠 선은 띠 머리 한 점으로 묶임 · 계단 0
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { CUSTOMER_CONDITION_FIELDS } from '../journey-target-extractor';
import { JOURNEY_ENTRY_KEYS, journeyOptionEditVerdict } from '../journey-step-edit-policy';
import { ENTRY_FORM_KEYS, shapeOptionKeys, formFromJourney, optionsDiff, entryCountBody, hasIncompleteCondition } from '../../../../frontend/src/utils/journey-start-form';
import { layoutMap, summaryCardHeight, L } from '../../../../frontend/src/utils/journey-map-layout';

const FE = (rel: string) => fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'frontend', 'src', rel), 'utf8');
/** 주석 줄을 뺀 코드(사용자 글 검사용). */
const codeOnly = (src: string) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l)).join('\n');

describe('화면이 옮겨 둔 서버 판정 = 서버와 같은 집합', () => {
  it('시작 조건 키(인원을 다시 센다) = 서버 JOURNEY_ENTRY_KEYS', () => {
    expect([...ENTRY_FORM_KEYS].sort()).toEqual([...JOURNEY_ENTRY_KEYS].sort());
  });
  it('새 모양 옵션 판정 = 서버 journeyOptionEditVerdict(켜짐 · 멈춤 · 초안 × 키)', () => {
    const bodies: Array<Record<string, any>> = [
      { goalExitEnabled: true }, { goalExitEnabled: false }, { goalKind: 'click' }, { callbackNumber: '0212345678' },
      { callbackMode: 'store' }, { thresholdRecipients: 100 }, { allowReentry: true }, { customer_conditions: [] },
      { entryEndsOn: '2026-12-31' }, { goalExitEnabled: false, thresholdRecipients: 3 },
    ];
    for (const status of ['active', 'paused', 'draft']) {
      for (const b of bodies) {
        const server = journeyOptionEditVerdict(status, b);
        const needs = !server.ok && server.code === 'JOURNEY_NEEDS_NEW_SHAPE';
        expect(shapeOptionKeys(status, b).length > 0, `${status} ${JSON.stringify(b)}`).toBe(needs);
      }
    }
  });
  it('조건 칸 목록 = 서버 CUSTOMER_CONDITION_FIELDS(옛 8칸 · 수신 동의 · 마지막 구매 N일 빠짐)', () => {
    const ui = FE('components/journey/JourneyBuilderUi.tsx');
    const block = ui.slice(ui.indexOf('export const COND_FIELDS'), ui.indexOf('export const condLabel'));
    const keys = [...block.matchAll(/key: '([a-z_]+)'/g)].map((m) => m[1]);
    expect(keys.sort()).toEqual([...CUSTOMER_CONDITION_FIELDS].sort());
    expect(ui).toContain("fetch('/api/customers/filter-options'");
  });
});

describe('시작 카드 순수 계산', () => {
  const j = {
    trigger_event: 'customer.dormant', trigger_filters: { dormant_days: 60, customer_conditions: [{ field: 'grade', op: '==', value: 'VIP' }], include_existing: true },
    threshold_recipients_per_step: 500, allow_reentry: false, reentry_cooldown_days: 0, goal_exit_enabled: true, goal_kind: 'purchase',
    entry_ends_ready: true, entry_ends_on: '2026-12-31',
  };
  it('바뀐 키만 · 마지막 날 비우기 = null', () => {
    const f = formFromJourney(j);
    expect(f.dormant_days).toBe(60);
    expect(f.include_existing).toBe(true);
    expect(f.entryEndsOn).toBe('2026-12-31');
    expect(optionsDiff(f, { ...f })).toEqual({});
    expect(optionsDiff(f, { ...f, thresholdRecipients: 800, entryEndsOn: '' })).toEqual({ thresholdRecipients: 800, entryEndsOn: null });
  });
  it('칸이 없으면(DDL 전) 마지막 날 칸을 만들지 않는다', () => {
    expect('entryEndsOn' in formFromJourney({ ...j, entry_ends_ready: false })).toBe(false);
  });
  it('인원 세기 몸통 = 시작 조건 키만 + dryRun · 덜 채운 조건은 세지 않는다', () => {
    const f = formFromJourney(j);
    const body = entryCountBody(f);
    expect(body.dryRun).toBe(true);
    expect(Object.keys(body).filter((k) => k !== 'dryRun').every((k) => ENTRY_FORM_KEYS.has(k))).toBe(true);
    expect('goalExitEnabled' in body).toBe(false);
    expect(hasIncompleteCondition({ customer_conditions: [{ field: 'grade', op: '==', value: '' }] })).toBe(true);
    expect(hasIncompleteCondition({ customer_conditions: [{ field: 'grade', op: 'in', value: ['A'] }] })).toBe(false);
  });
});

describe('작업 화면 — 옛 창 기능 이사 · 저장 규칙', () => {
  const ws = FE('components/journey/workspace/JourneyWorkspace.tsx');
  const card = FE('components/journey/workspace/JourneyStartCard.tsx');
  it('옛 상세 창에만 있던 기능이 다 있다', () => {
    expect(ws).toContain('/simulate`');                     // 켜기 전 미리 보기(옛 시뮬레이션 카드)
    expect(ws).toContain('<JourneyVariantsEditor');           // A/B
    expect(ws).toContain('<JourneyStepNotifyToggle');         // 담당자 알림
    expect(ws).toContain('/recommend-next-step`');           // AI 다음 칸 추천
    expect(ws).toContain("sendJson(`/api/ai/operator/journeys/${jid}/steps/${id}`, 'DELETE')");   // 칸 빼기(초안 · 멈춤)
    expect(ws).toContain('<JourneyPauseLogsModal');           // 정지 이력
    expect(card).toContain("setField('allowReentry'");       // 재진입
    expect(card).toContain("setField('autoReentryEnabled'"); // 자동 재진입
    expect(card).toContain("setField('entryEndsOn'");        // 새 고객 받는 마지막 날
    expect(card).toContain("setField('backfill_per_day'");   // 하루 몫
    expect(card).toContain("setField('exclude_dormant_return'");
  });
  it('늦은 AI 응답은 요청한 칸이 지금 칸일 때만 · AI 중에는 칸을 옮기지 않는다 · 칸별 초안(고친 칸 이동 허용)', () => {
    expect(ws).toContain('if (selectedRef.current !== id)');
    expect(ws).toContain("if (aiBusy) { toast.warning('AI 다듬기가 끝난 뒤 옮겨 주세요.'); return; }");
    expect(ws).toContain('const [drafts, setDrafts] = useState<Record<string, StudioStep>>({});');
  });
  it('켜진 여정: 그 자리 묶음은 PATCH(문안은 명시 허용) · 칸 모양 · 칸 넣고 빼기 · 목표 끄기는 새 모양 한 흐름 · 확인 한 단계 · 화면 막고 기다림', () => {
    expect(ws).toContain("isActive && ('messageTemplate' in p || 'subject' in p) ? { ...p, allowActiveMessageEdit: true } : p");
    expect(ws).toContain("/reshape`, 'POST'");
    expect(ws).toContain('if (needsShape && !confirmShape) { setConfirmShape(true); return; }');
    expect(ws).toContain('바뀐 모양으로 옮기는 중');
    // 그 자리 저장이 먼저(진행 중 고객도 다음 발송부터 바뀐 문안) · 새 모양은 그 뒤 복제
    expect(ws.indexOf('const ok = await saveStepsInPlace(')).toBeLessThan(ws.indexOf('await runReshape({'));
  });
  it('옵션 409 겹침은 같은 바에서 고르고 다시 보낸다 · 확정 바 문장에 추가 크레딧 0', () => {
    expect(ws).toContain("r.data?.code === 'OVERLAP_UNRESOLVED'");
    expect(ws).toContain('acknowledgedOverlaps: acks');
    expect(ws).toContain('CREDIT_EDIT_FREE');
  });
  it('주소로 연다(?journey=&step=) — 목록 · 지도 둘 다 같은 창', () => {
    for (const rel of ['pages/JourneysPage.tsx', 'pages/JourneyMapPage.tsx']) {
      const p = FE(rel);
      expect(p, rel).toContain("searchParams.get('journey')");
      expect(p, rel).toContain('<JourneyWorkspace');
      expect(p, rel).toContain('{journeyActions.node}');
    }
    expect(fs.existsSync(path.join(__dirname, '..', '..', '..', '..', 'frontend', 'src', 'components', 'journey', 'map', 'MapStepEditModal.tsx'))).toBe(false);
  });
});

describe('큰 휴대폰 한 벌', () => {
  const phone = FE('components/journey/PhoneComposer.tsx');
  it('바이트 = (광고) · 무료수신거부 합성 그대로 · 제목 상한 = 공용 40 · 받는 모습 = 서버 미리보기', () => {
    expect(phone).toContain('buildAdMessageFront(body || \'\', msgType, isAd, opt080Number)');
    expect(phone).toContain('calculateSmsBytes(composed)');
    expect(phone).toContain('LMS_SUBJECT_MAX_CHARS');
    expect(phone).toContain("fetch('/api/ai/operator/journeys/preview-message'");
    // 넘은 제목은 자르지 않는다(줄이는 입력만 받는다 · 고객 문안을 몰래 바꾸지 않는다)
    expect(phone).toContain('v.length <= LMS_SUBJECT_MAX_CHARS || v.length < (subject || \'\').length');
  });
  it('편집기 여러 벌이 같은 휴대폰을 쓴다', () => {
    for (const rel of ['components/journey/JourneyStepStudio.tsx', 'components/journey/JourneyMessageEditModal.tsx', 'components/journey/JourneyVariantsEditor.tsx', 'pages/JourneysPage.tsx']) {
      expect(FE(rel), rel).toContain('<PhoneComposer');
    }
    // 화면이 지어낸 정적 샘플 고객으로 받는 모습을 그리지 않는다(문안 수정 창)
    expect(FE('components/journey/JourneyMessageEditModal.tsx')).not.toContain('SAMPLE_CUSTOMERS');
  });
});

describe('사용자에게 보이는 글', () => {
  const files = [
    'components/journey/workspace/JourneyWorkspace.tsx', 'components/journey/workspace/JourneyStartCard.tsx', 'components/journey/workspace/useJourneyActions.tsx',
    'components/journey/PhoneComposer.tsx', 'components/journey/map/MapJourneyCard.tsx', 'components/journey/map/LifecycleMapCanvas.tsx',
    'pages/JourneyMapPage.tsx', 'pages/JourneysPage.tsx', 'utils/journey-credit-copy.ts', 'components/journey/JourneyMessageEditModal.tsx',
  ];
  it('「새 판」 0 · 모델명 0 · 네이티브 확인 창 0', () => {
    for (const rel of files) {
      const c = codeOnly(FE(rel));
      expect(c, rel).not.toContain('새 판');
      expect(c, rel).not.toMatch(/Claude|GPT|Opus|Sonnet|Haiku|Anthropic/);
      expect(c, rel).not.toMatch(/\b(window\.)?(alert|confirm|prompt)\(/);
    }
  });
  it('목록 카드는 멈춘 이유 원문을 그리지 않는다(서버 사람 말만)', () => {
    const p = FE('pages/JourneysPage.tsx');
    expect(p).not.toContain('{j.pause_reason}');
    expect(p).toContain('{j.pause_view.text}');
  });
  it('크레딧 문장 = 숫자는 인자(서버 값) · 줄표 0', () => {
    const c = FE('utils/journey-credit-copy.ts');
    expect(codeOnly(c)).not.toContain('—');
    expect(codeOnly(c)).not.toMatch(/\b(200|10)크레딧/);
  });
});

describe('지도 [한눈에] 배치(프론트 순수 함수)', () => {
  const step = (o: number) => ({
    stepId: `x${o}`, order: o, kind: 'message', channel: 'lms', isAd: true, timingLabel: `D+${o}`, intervalLabel: '1일 뒤', preview: '',
    waitingHere: 0, reached: 0, exitsAfter: 0, pendingHere: null, outOfWindow: false,
  });
  const journey = (id: string, lane: string, triggerEvent: string, extra: Record<string, any> = {}) => ({
    id, name: id, status: 'active', lane, band: 'flow', triggerEvent, triggerLabel: triggerEvent, startKind: 'event', goalExitEnabled: true,
    goalKind: 'purchase', goalLabel: '구매', notices: [], allowReentry: true, autoReentry: false, thresholdRecipients: 500,
    targetSummary: '', broadAudience: false, counts: { activeNow: 0, inProgress: 0, entered: 0, goalMet: 0, completed: 0 }, windowDays: 30,
    pendingGoalExit: null, exitsBeforeFirst: 0, endNote: '', entryReplace: false, steps: [step(1), step(2)],
    graph: { edges: [], exitSlots: [0, 1], issues: [] }, edit: { copy: true, timing: true, structure: true, ops: true, reason: '' },
    capability: null, updatedAt: null, lineageId: null, canNewVersion: false, olderVersions: [], activationCost: 0,
    pause: null, health: { tone: 'good', text: '', fix: null }, operationCredits30d: 0, ...extra,
  });
  const line = (from: string, to: string | null, toTrigger: string) => ({
    id: `${from}->${to || toTrigger}`, fromJourneyId: from, toJourneyId: to, fromTrigger: '', toTrigger, toLabel: '', state: 'connected', tier: 'solid',
    reason: '', goalMet: 0, handedOver: null, handedOver7d: null, receiverEntered: null, windowDays: 30, fix: null,
  });
  const data: any = {
    generatedAt: '', judgedAt: null, lanes: [], lockedTriggers: [], costs: { generate: 3, activate: 200, operation: 10 },
    overlaps: [{ a: 'F', b: 'R', concurrentActive: 0, text: '같은 구매에 문자 2통 · R', fix: null }],
    journeys: [
      journey('A', 'signup', 'customer.created', { health: { tone: 'fix', text: '손볼 곳', fix: null } }), journey('F', 'first_purchase', 'purchase.first'),
      journey('R', 'repurchase', 'cdp.purchase', { status: 'paused', pause: { kind: 'manual', text: '멈춰 둔 여정이에요.', fix: null } }),
      journey('P1', 'product', 'purchase.product'), journey('P2', 'product', 'purchase.product'),
    ],
    lines: [line('A', 'F', 'purchase.first'), line('F', 'R', 'cdp.purchase'), line('F', 'P1', 'purchase.product'), line('F', 'P2', 'purchase.product'), line('R', 'P1', 'purchase.product')],
    ghosts: [], summary: { activeJourneys: 4, inProgressCustomers: 0, fixCount: 1, operationCredits30d: 0 },
  };
  const opts = { statusFilter: 'all' as const, search: '', expanded: new Set<string>(), collapsed: new Set<string>(), showQuiet: new Set<string>(), preview: true, glance: true };
  it('상자 겹침 0 · 카드 높이 = 데이터로 계산한 값(손볼 곳 · 멈춘 이유 · 겹침 줄이 있으면 더 높다) · 계단 0', () => {
    const lay = layoutMap(data, opts);
    const boxes = [...lay.cards, ...lay.ghosts, ...lay.quiet];
    for (let i = 0; i < boxes.length; i++) for (let k = i + 1; k < boxes.length; k++) {
      const a = boxes[i]; const b = boxes[k];
      expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h).toBe(false);
    }
    const h = (id: string) => lay.cards.find((c) => c.journeyId === id)!.h;
    expect(h('A')).toBe(summaryCardHeight(data.journeys[0], 0));
    expect(h('F')).toBe(summaryCardHeight(data.journeys[1], 1));
    expect(h('A')).toBeGreaterThan(summaryCardHeight(journey('X', 'signup', 'customer.created') as any, 0));
    expect(L.stair).toBe(0);
    const tops = FLOW_TOPS(lay);
    expect(new Set(tops).size).toBe(1);
  });
  it('상품 띠로 가는 선은 띠 머리 한 점(묶임 · 이름표 없음) · 같은 보내는 여정이면 한 줄로 겹친다 · 다른 선은 빠짐없이', () => {
    const lay = layoutMap(data, opts);
    expect(lay.lines.map((l) => l.line.id).sort()).toEqual(data.lines.map((l: any) => l.id).sort());
    const toProduct = lay.lines.filter((l) => l.line.toTrigger === 'purchase.product');
    expect(toProduct.every((l) => l.bundled === true)).toBe(true);
    const fromF = toProduct.filter((l) => l.line.fromJourneyId === 'F').map((l) => l.d);
    expect(new Set(fromF).size).toBe(1);
    expect(lay.lines.filter((l) => l.line.toTrigger !== 'purchase.product').every((l) => !l.bundled)).toBe(true);
  });
  it('1440 화면에서 가로 스크롤 0(판 폭 1340 이하)', () => {
    expect(layoutMap(data, opts).width).toBeLessThanOrEqual(1340);
  });
});

function FLOW_TOPS(lay: ReturnType<typeof layoutMap>): number[] {
  // 각 열의 첫 카드 꼭대기(상품 띠 제외) — 계단 0 이면 모두 같다.
  const byX = new Map<number, number>();
  for (const c of lay.cards) {
    if (lay.band && c.y > lay.band.y) continue;
    byX.set(c.x, Math.min(byX.get(c.x) ?? Infinity, c.y));
  }
  return [...byX.values()];
}
