/**
 * C138 (★ 2026-11-16) — Harold 접수 셋
 *   ① 「신청한 업체도 문제 · 팝업에서 들어가면 진입이 되는데 · 이미지스튜디오 메뉴 클릭해서 들어가면 소개페이지와 함께 잠겨 있어서 진입이 안 돼」
 *      = 무료체험 판정이 화면 입구(PlanGate)에만 있고 허브 카드에는 없었다 → 입구 판정 한 함수(fetchFeatureEntry)를 둘이 쓴다.
 *   ② 「이 팝업 다신 보지 않기는 없어야 · 그거 눌러버리면 홍보가 안 되는데」 = 장면 창의 숨김 단추를 없앤다(무료체험 안내 창의 단추는 그대로).
 *   ③ 「다시보지않기 누른 회사도 체크할 수 있도록 · 전부 한눈에 · 기능별관심 필요없으니까 필터 · 화면 가로로 풀로 · 짤리는 거 없도록」
 *      = 기능 관심 업체 줄에 무료체험 · 「다시 보지 않기」를 합치고 화면에서 거른다.
 * 설계 기록 = docs/2026-11-16-c138-trial-entry-interest-design.md
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

vi.mock('../../config/database', () => ({ query: vi.fn(), pool: { connect: vi.fn() } }));
vi.mock('../plan-guard', () => ({
  loadPlanContext: vi.fn(async (id: string) => ({ planName: id === 'c-paid' ? '스타터' : '무료' })),
  isActivePaidPlan: (ctx: any) => ctx?.planName === '스타터',
}));

import { query } from '../../config/database';
import { loadFeatureInterest, parseFeatureInterestQuery } from '../feature-interest';
import { INTRO_DISMISSED_SQL, INTRO_KEYS, loadIntroDismissals } from '../v3-intro';
import { V3_SCENES_HTML, V3_TRIAL_HTML } from '../../content/gated/v3-popup';
import { fetchFeatureEntry, STUDIO_TRIAL_FEATURE_ID } from '../../../../frontend/src/utils/ai-operator-access';
import { normalizeInterest, groupDismissed, dismissedPopupName } from '../../../../frontend/src/utils/feature-interest-view';
import { LOGIN_POPUPS, loginPopupOfIntroKey } from '../../../../frontend/src/constants/login-popups';

const mockQuery = query as unknown as ReturnType<typeof vi.fn>;
const back = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8').replace(/\r\n/g, '\n');
const FRONT = resolve(__dirname, '../../../../frontend/src');
const front = (rel: string) => readFileSync(join(FRONT, rel), 'utf8').replace(/\r\n/g, '\n');
const noComment = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
function frontFiles(dir = FRONT): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? frontFiles(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

beforeEach(() => { mockQuery.mockReset(); });

/* ───────────────────────── ① 입구 판정 ───────────────────────── */
describe('① 입구 판정 fetchFeatureEntry — 값 범위 전부(요금제 답 × 기능 × 무료체험 답)', () => {
  const realFetch = globalThis.fetch;
  let token = 0;
  let calls: string[] = [];
  /** access = /api/ai/operator/access 의 답 · trial = /api/image-studio/trial 의 답('down' = 끊김 · 'no-table' = 503) */
  function server(access: any, trial: any) {
    calls = [];
    (globalThis as any).localStorage = { getItem: () => `tok-c138-${++token}` };
    globalThis.fetch = vi.fn(async (url: string) => {
      calls.push(String(url));
      if (String(url) === '/api/ai/operator/access') {
        if (access === 'down') throw new Error('net');
        return { ok: true, status: 200, json: async () => access };
      }
      if (String(url) === '/api/image-studio/trial') {
        if (trial === 'down') throw new Error('net');
        if (trial === 'no-table') return { ok: false, status: 503, json: async () => ({ success: false, code: 'DB_MIGRATION_PENDING' }) };
        return { ok: true, status: 200, json: async () => trial };
      }
      throw new Error('예상 밖 주소: ' + url);
    }) as any;
  }
  afterEach(() => { globalThis.fetch = realFetch; delete (globalThis as any).localStorage; });

  const LOCKED = { success: true, allowed: false };
  const trialOf = (eligible: boolean, requested: boolean) => ({ success: true, eligible, requested, granted: requested ? 3 : 0, used: 0, remaining: requested ? 3 : 0 });

  it('요금제로 열린 회사 = 들어간다 · 무료체험은 묻지 않는다', async () => {
    server({ success: true, allowed: true }, 'down');
    expect(await fetchFeatureEntry(STUDIO_TRIAL_FEATURE_ID)).toBe(true);
    expect(calls).toEqual(['/api/ai/operator/access']);
  });

  it('요금제 답을 모름(끊김 · 꼴이 다른 응답) = 모름(null · 잠그지 않는다) · 무료체험은 묻지 않는다', async () => {
    for (const access of ['down', { success: false }, { success: true }]) {
      server(access, trialOf(true, true));
      expect(await fetchFeatureEntry(STUDIO_TRIAL_FEATURE_ID), JSON.stringify(access)).toBeNull();
      expect(calls).toEqual(['/api/ai/operator/access']);
    }
  });

  it('요금제로 잠긴 회사 · 다른 기능 = 잠김 · 무료체험은 묻지 않는다(체험은 이미지 스튜디오 하나에만)', async () => {
    for (const id of ['sns', 'journeys', 'auto-marketing', 'ai-operator', '']) {
      server(LOCKED, trialOf(true, true));
      expect(await fetchFeatureEntry(id), id).toBe(false);
      expect(calls).toEqual(['/api/ai/operator/access']);
    }
  });

  it('요금제로 잠긴 회사 · 이미지 스튜디오 = 무료체험 자격이 있고 신청했을 때만 들어간다', async () => {
    const table: [any, boolean][] = [
      [trialOf(true, true), true],
      [trialOf(true, false), false],      // 신청 전
      [trialOf(false, true), false],      // 자격 없음(서버가 닫음)
      [trialOf(false, false), false],
      ['down', false],                    // 답을 모르면 잠근 채
      ['no-table', false],
      [{ success: false }, false],
      [{ success: true, eligible: true }, false],   // 꼴이 다른 응답(requested 없음)
    ];
    for (const [trial, want] of table) {
      server(LOCKED, trial);
      expect(await fetchFeatureEntry(STUDIO_TRIAL_FEATURE_ID), JSON.stringify(trial)).toBe(want);
      expect(calls).toEqual(['/api/ai/operator/access', '/api/image-studio/trial']);
    }
  });
});

describe('① 입구 판정 — 요금제 답을 이미 아는 호출부(허브)는 넘긴다 · 다시 묻지 않는다(★ Codex 구현 1R)', () => {
  const realFetch = globalThis.fetch;
  let calls: string[] = [];
  function trialServer(trial: any) {
    calls = [];
    (globalThis as any).localStorage = { getItem: () => 'tok-c138-known' };
    globalThis.fetch = vi.fn(async (url: string) => {
      calls.push(String(url));
      if (String(url) === '/api/image-studio/trial') {
        if (trial === 'down') throw new Error('net');
        return { ok: true, status: 200, json: async () => trial };
      }
      throw new Error('묻지 말아야 할 주소: ' + url);   // 요금제 답(/api/ai/operator/access)을 다시 물으면 여기서 터진다
    }) as any;
  }
  afterEach(() => { globalThis.fetch = realFetch; delete (globalThis as any).localStorage; });
  const T3 = { success: true, eligible: true, requested: true, granted: 3, used: 0, remaining: 3 };

  it('잠김을 넘기면 무료체험만 묻는다 · 답은 열림 / 잠김 둘뿐(모름이 생기지 않는다)', async () => {
    trialServer(T3);
    expect(await fetchFeatureEntry(STUDIO_TRIAL_FEATURE_ID, false)).toBe(true);
    expect(calls).toEqual(['/api/image-studio/trial']);
    for (const trial of [{ ...T3, requested: false }, { ...T3, eligible: false }, 'down', { success: false }]) {
      trialServer(trial);
      expect(await fetchFeatureEntry(STUDIO_TRIAL_FEATURE_ID, false), JSON.stringify(trial)).toBe(false);
    }
    trialServer(T3);
    expect(await fetchFeatureEntry('sns', false)).toBe(false);   // 다른 기능 = 무료체험도 묻지 않는다
    expect(calls).toEqual([]);
  });

  it('열림 · 모름을 넘기면 그대로 돌려준다(아무것도 묻지 않는다)', async () => {
    trialServer(T3);
    expect(await fetchFeatureEntry(STUDIO_TRIAL_FEATURE_ID, true)).toBe(true);
    expect(await fetchFeatureEntry(STUDIO_TRIAL_FEATURE_ID, null)).toBeNull();
    expect(calls).toEqual([]);
  });
});

describe('① 소스 계약 — 허브 카드와 화면 입구가 같은 함수 · 같은 기능 id', () => {
  const hub = front('pages/AiOperatorPage.tsx');
  const gate = front('components/PlanGate.tsx');

  it('화면 입구(PlanGate) = fetchFeatureEntry 의 답이 「잠김」일 때만 잠근다 · 스스로 요금제 · 무료체험을 묻지 않는다', () => {
    expect(gate).toContain("void fetchFeatureEntry(featureId).then((entry) => { if (alive) setState(entry === false ? 'locked' : 'open'); });");
    for (const own of ['fetchAiOperatorAccess', 'fetchStudioTrial', 'TRIAL_FEATURE_ID']) expect(noComment(gate), own).not.toContain(own);
  });

  it('허브 카드 = 누름과 자물쇠 표시가 같은 판정 · 열림을 모르면(답 전 · 한 번 못 받음) 누를 때 다시 묻는다', () => {
    // 「열림」이라는 답만 상태에 적는다 — 못 받은 답이 「잠김」으로 굳지 않는다(★ Codex 구현 1R)
    expect(hub).toContain('const [trialOpen, setTrialOpen] = useState(false);');
    expect(hub).toContain('if (locked) void fetchFeatureEntry(STUDIO_TRIAL_FEATURE_ID, false).then((ok) => { if (alive && ok === true) setTrialOpen(true); });');
    expect(noComment(hub).match(/setTrialOpen\(/g)).toHaveLength(1);
    expect(hub).toContain('const trialCard = card.id === STUDIO_TRIAL_FEATURE_ID;');
    expect(hub).toContain('const cardLocked = planLocked && !(trialCard && trialOpen);');
    expect(hub).toContain('const open = trialCard && (trialOpen || (await fetchFeatureEntry(STUDIO_TRIAL_FEATURE_ID, false)) === true);');
    // 허브는 요금제 답(잠김)을 이미 받았으므로 입구 판정에 넘긴다 — 같은 답을 다시 묻는 호출 0
    const asks = noComment(hub).match(/fetchFeatureEntry\([^)]*\)/g) || [];
    expect(asks).toHaveLength(3);
    for (const a of asks) expect(a, a).toMatch(/, false\)$/);
  });

  it('★ Codex 구현 2R — 카드 누름은 순번을 쥔다 · 기다린 뒤(원장 · 무료체험 답) 화면을 떠났거나 다른 카드를 눌렀으면 안내도 이동도 하지 않는다', () => {
    expect(hub).toContain('const clickSeq = useRef(0);');
    expect(hub).toContain('useEffect(() => () => { clickSeq.current = -1; }, []);');
    const click = hub.slice(hub.indexOf('onClick={async () => {'), hub.indexOf('navigate(card.path);') + 30);
    expect(click).toContain('const mine = ++clickSeq.current;');
    // 기다리는 자리(await)마다 바로 다음 줄이 순번 확인 = 그 뒤의 안내 열기 · 이동은 유효한 누름만
    const awaits = click.split('\n').map((l, i, all) => (l.includes('await ') ? all[i + 1].trim() : null)).filter(Boolean);
    expect(awaits).toEqual(['if (clickSeq.current !== mine) return;', 'if (clickSeq.current !== mine) return;']);
    expect(click.indexOf('const mine = ++clickSeq.current;')).toBeLessThan(click.indexOf('await '));
    expect(hub).toContain('if (!open) { setPlanFeatureId(featureId); return; }');
    expect(hub).toContain('{cardLocked ? (');
    // 입구에서 돌아온 안내(?intro=)도 같은 함수 — 열린다고 답하면 요금제 안내를 열지 않는다
    expect(hub).toContain('if (locked) void Promise.all([loadPlanFeatureIntros(), fetchFeatureEntry(intro, false)]).then(([d, entry]) => { if (alive && entry !== true && d?.find(intro)) setPlanFeatureId(intro); });');
    // 요금제로 잠긴 회사에게 요금제 안내를 띄우는 카드 누름 자리는 그 하나(무료체험 판정을 거친 뒤)
    expect(hub.match(/if \(planLocked && featureId\)/g)).toHaveLength(1);
    expect(noComment(hub)).not.toContain('fetchStudioTrial');
  });

  it('기능 id 하나 — 체험 상수 = 허브 카드 id = 경로의 입구 id', () => {
    expect(STUDIO_TRIAL_FEATURE_ID).toBe('image-studio');
    expect(front('constants/ai-operator-modules.ts')).toMatch(/path: '\/image-studio', id: 'image-studio' \}/);
    const app = front('App.tsx');
    const route = app.slice(app.indexOf('path="/image-studio"'));
    expect(route.slice(0, route.indexOf('</Route>') > 0 ? route.indexOf('</Route>') : 600)).toContain(`<PlanGate featureId="${STUDIO_TRIAL_FEATURE_ID}"><ImageStudioPage /></PlanGate>`);
  });

  it('★ 기계 추출 — 프론트 전 파일에서 무료체험 상태를 묻는 자리 = 입구 판정 함수 + 스튜디오 화면의 남은 횟수 띠 둘뿐', () => {
    const callers = frontFiles()
      .filter((p) => /\bfetchStudioTrial\(/.test(noComment(readFileSync(p, 'utf8'))))
      .map((p) => p.slice(FRONT.length + 1).replace(/\\/g, '/'))
      .sort();
    expect(callers).toEqual(['pages/ImageStudioPage.tsx', 'utils/ai-operator-access.ts', 'utils/studio-trial.ts']);
    // 체험 기능 id 를 따로 적은 자리 0(상수는 입구 판정 파일 하나)
    const own = frontFiles().filter((p) => /TRIAL_FEATURE_ID\s*=/.test(noComment(readFileSync(p, 'utf8')))).map((p) => p.slice(FRONT.length + 1).replace(/\\/g, '/'));
    expect(own).toEqual(['utils/ai-operator-access.ts']);
  });
});

/* ───────────────────────── ② 로그인 뒤 안내 창의 숨김 단추 ───────────────────────── */
describe('② 로그인 뒤 안내 창 둘 — 「다시 보지 않기」 없음 · 창의 단추와 누름 처리가 맞는다', () => {
  const acts = (html: string) => Array.from(new Set(Array.from(html.matchAll(/data-act="([a-z-]+)"/g)).map((m) => m[1]))).sort();

  it('서버가 주는 두 창의 글에 숨김 단추 · 그 글자가 없다(장면 창 · 무료체험 안내 창)', () => {
    expect(acts(V3_SCENES_HTML)).toEqual(['close', 'go', 'later']);
    expect(acts(V3_TRIAL_HTML)).toEqual(['close', 'later', 'studio', 'trial']);
    for (const html of [V3_SCENES_HTML, V3_TRIAL_HTML]) expect(html).not.toContain('다시 보지 않기');
    // 무료체험 창의 닫는 길은 그대로(X · 「다음에 볼게요」)
    expect(V3_TRIAL_HTML).toContain('<div class="lnk"><button data-act="later">다음에 볼게요</button></div>');
  });

  it('★ 기계 추출 — 창의 글에 있는 단추는 전부 화면이 처리한다(처리 없는 단추 0 · 글에 없는 처리 0)', () => {
    const handled = (file: string) => Array.from(new Set(Array.from(noComment(front(file)).matchAll(/act === '([a-z-]+)'/g)).map((m) => m[1]))).sort();
    expect(handled('components/v3/V3ScenesPromo.tsx')).toEqual(acts(V3_SCENES_HTML));
    expect(handled('components/v3/StudioTrialPromo.tsx')).toEqual(acts(V3_TRIAL_HTML));
  });

  it('★ 기계 추출 — 프론트 전 파일에 안내 창을 숨기는 요청이 없다 · 두 창과 틀은 판 열쇠를 주고받지 않는다 · 계정당 최대 3번은 서버가 그대로 센다', () => {
    const scenes = noComment(front('components/v3/V3ScenesPromo.tsx'));
    for (const gone of ['dismiss', 'useToast', 'busyRef']) expect(scenes, gone).not.toContain(gone);
    const hiders = frontFiles()
      .filter((p) => /v3-intro\/dismiss|dismissV3Intro/.test(noComment(readFileSync(p, 'utf8'))))
      .map((p) => p.slice(FRONT.length + 1).replace(/\\/g, '/'));
    expect(hiders).toEqual([]);
    // 숨김 단추가 쓰던 판 열쇠 = 틀이 선점할 때만 쓴다(창 안쪽으로 넘기지 않는다)
    for (const f of ['components/v3/V3ScenesPromo.tsx', 'components/v3/StudioTrialPromo.tsx']) expect(noComment(front(f)), f).not.toMatch(/dismiss|introKey/);
    const frame = noComment(front('components/AiOperatorLoginPromo.tsx'));
    expect(frame).toContain('const inner = { css: shown.text.css, html: shown.text.html, sets: shown.sets, rootRef: dialogRef, onClose: close };');
    expect(frame.match(/introKey/g)).toHaveLength(1);   // claimV3Intro(peek.introKey) 하나
    const intro = back('utils/v3-intro.ts');
    expect(intro).toContain('export const V3_INTRO_MAX_SHOWN = 3;');
    expect(intro).toContain('if (state && (state.dismissed || Number(state.shown) >= V3_INTRO_MAX_SHOWN)) return null;');
  });
});

/* ───────────────────────── ③ 기능 관심 업체 ───────────────────────── */
describe('③ 「다시 보지 않기」를 누른 계정 목록', () => {
  it('SQL = 누른 행만 · 회사가 있는 계정만 · 최근에 누른 순(문 행에는 해제 시각이 없다)', () => {
    expect(INTRO_DISMISSED_SQL).toContain('FROM user_intro_acks a');
    expect(INTRO_DISMISSED_SQL).toContain('JOIN users u ON u.id = a.user_id');
    expect(INTRO_DISMISSED_SQL).toContain('WHERE a.dismissed_at IS NOT NULL AND u.company_id IS NOT NULL');
    expect(INTRO_DISMISSED_SQL).toContain('ORDER BY a.dismissed_at DESC, a.user_id');
    expect(INTRO_DISMISSED_SQL).not.toMatch(/LIMIT|created_at/);
  });

  it('행을 화면 꼴로 옮긴다 · 표가 없으면(42P01) null · 다른 오류는 그대로 던진다', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ company_id: 'c-1', intro_key: 'v3-scenes', dismissed_at: new Date('2026-11-16T02:00:00Z'), login_id: 'kim', user_name: null }] });
    expect(await loadIntroDismissals()).toEqual([{ companyId: 'c-1', introKey: 'v3-scenes', at: '2026-11-16T02:00:00.000Z', userName: '', loginId: 'kim' }]);
    expect(mockQuery.mock.calls[0][0]).toBe(INTRO_DISMISSED_SQL);
    mockQuery.mockRejectedValueOnce(Object.assign(new Error('relation "user_intro_acks" does not exist'), { code: '42P01' }));
    expect(await loadIntroDismissals()).toBeNull();
    mockQuery.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: '57014' }));
    await expect(loadIntroDismissals()).rejects.toThrow('boom');
  });

  it('★ 등록부 — 서버의 판 열쇠는 전부 창 이름을 갖는다(새 판을 올리고 등록부를 빠뜨리면 빨간불)', () => {
    for (const key of INTRO_KEYS) expect(loginPopupOfIntroKey(key)?.name, key).toBeTruthy();
    expect(LOGIN_POPUPS.flatMap((p) => p.introKeys).sort()).toEqual([...INTRO_KEYS].sort());
    expect(dismissedPopupName('v3-scenes')).toBe('로그인 안내 창');
    expect(dismissedPopupName('v3-intro')).toBe('로그인 안내 창');
    expect(dismissedPopupName('studio-trial')).toBe('이미지 체험 안내');   // ★ 2026-11-17 C141 이름(7일 무료체험과 가른다)
    expect(dismissedPopupName('some-new-key')).toBe('some-new-key');
  });
});

describe('③ 업체 줄 — 본 회사 + 무료체험 신청 + 「다시 보지 않기」를 한 줄로', () => {
  const seenRows = [
    { action: 'plan_feature_open', created_at: '2026-11-15T01:00:00Z', feature_id: 'login-promo', company_id: 'c-free', user_name: '김담당', login_id: 'beauty01', company_name: '표본뷰티' },
    { action: 'plan_feature_open', created_at: '2026-11-14T01:00:00Z', feature_id: 'sns', company_id: 'c-paid', user_name: '박점장', login_id: 'cafe', company_name: '표본카페' },
  ];
  const NAMES: Record<string, string> = { 'c-free': '표본뷰티', 'c-paid': '표본카페', 'c-trial': '체험만', 'c-dis': '숨김만' };
  const TRIALS = [
    { company_id: 'c-trial', requested_at: '2026-11-16T03:00:00Z', granted: 3, used: 0, company_name: '체험만', requested_by: '최대리' },
    { company_id: 'c-free', requested_at: '2026-11-10T00:00:00Z', granted: 3, used: 2, company_name: '표본뷰티', requested_by: '김담당' },
  ];
  const DISMISSED = [
    { company_id: 'c-dis', intro_key: 'v3-scenes', dismissed_at: '2026-11-16T05:00:00Z', login_id: 'd1', user_name: '숨김일' },
    { company_id: 'c-dis', intro_key: 'studio-trial', dismissed_at: '2026-11-16T04:00:00Z', login_id: 'd2', user_name: '' },
    { company_id: 'c-free', intro_key: 'studio-trial', dismissed_at: '2026-11-12T00:00:00Z', login_id: 'beauty01', user_name: '김담당' },
  ];
  /** trials · dismissed = 행 목록 | 'no-table'(42P01) | 'boom'(다른 오류) */
  function fakeDb(raw: typeof seenRows, trials: any = TRIALS, dismissed: any = DISMISSED) {
    const fail = (kind: string) => { throw Object.assign(new Error(kind), { code: kind === 'no-table' ? '42P01' : '57014' }); };
    mockQuery.mockImplementation(async (sql: string) => {
      const q = String(sql);
      if (q.includes('FROM image_studio_trials')) return typeof trials === 'string' ? fail(trials) : { rows: trials };
      if (q.includes('FROM user_intro_acks')) return typeof dismissed === 'string' ? fail(dismissed) : { rows: dismissed };
      if (q.includes('FROM diagnosis_trial_grants')) return { rows: [] };   // ★ C141 7일 무료체험 목록(이 파일은 받은 곳 없음 · 합치기 시험 = c141-feature-interest-redesign)
      if (q.includes('GROUP BY 1, 2, 3')) return { rows: raw.map((r) => ({ company_id: r.company_id, feature_id: r.feature_id, action: r.action, n: 1, last_at: r.created_at })) };
      if (q.includes('SELECT DISTINCT')) return { rows: raw.map((r) => ({ company_id: r.company_id, login_id: r.login_id, user_name: r.user_name })) };
      if (q.includes('ROW_NUMBER()') && q.includes('AND al.action IN ($2, $3)')) return { rows: raw.filter((r) => r.action !== 'plan_feature_open') };   // ★ C141 최근 누름
      if (q.includes('ROW_NUMBER()')) return { rows: raw };
      if (q.includes('FROM companies')) return { rows: Object.entries(NAMES).map(([id, company_name]) => ({ id, company_name })) };
      throw new Error('예상 밖 SQL: ' + q.slice(0, 60));
    });
  }
  const load = (q: any = { period: 'all' }) => loadFeatureInterest(parseFeatureInterestQuery(q));

  it('본 기록이 없는 회사도 무료체험 신청 · 「다시 보지 않기」가 있으면 줄이 된다 · 본 회사에는 seen', async () => {
    fakeDb(seenRows);
    const d = await load();
    const by = new Map(d.companies.map((c) => [c.companyId, c]));
    expect([...by.keys()].sort()).toEqual(['c-dis', 'c-free', 'c-paid', 'c-trial']);
    expect(by.get('c-free')).toMatchObject({ seen: true, companyName: '표본뷰티', trial: { requestedBy: '김담당', requestedAt: '2026-11-10T00:00:00.000Z', used: 2, granted: 3 } });
    expect(by.get('c-free')!.dismissed).toEqual([{ introKey: 'studio-trial', at: '2026-11-12T00:00:00.000Z', userName: '김담당', loginId: 'beauty01' }]);
    expect(by.get('c-paid')).toMatchObject({ seen: true, trial: null, dismissed: [] });
    expect(by.get('c-trial')).toMatchObject({ seen: false, companyName: '체험만', planName: '무료', subscribed: false, features: [], pricingClicks: 0, goClicks: 0, users: [], events: [], dismissed: [] });
    expect(by.get('c-trial')!.trial).toEqual({ requestedBy: '최대리', requestedAt: '2026-11-16T03:00:00.000Z', used: 0, granted: 3 });
    expect(by.get('c-dis')).toMatchObject({ seen: false, companyName: '숨김만', trial: null });
    expect(by.get('c-dis')!.dismissed.map((x) => `${x.introKey}/${x.loginId}`)).toEqual(['v3-scenes/d1', 'studio-trial/d2']);
    expect(d.trialsKnown).toBe(true);
    expect(d.dismissalsKnown).toBe(true);
  });

  it('서버는 업체 줄만 낸다 — 요약 수 · 기능별 수 · 기능 조건은 없다(화면이 이 줄에서 센다 = 숫자가 한 벌)', async () => {
    fakeDb(seenRows);
    const d = await load({ period: 'all', featureId: 'sns' });
    expect(Object.keys(d).sort()).toEqual(['companies', 'dismissalsKnown', 'lineTrialsKnown', 'trialsKnown']);   // ★ C141 7일 체험 목록을 읽었는가
    expect(d.companies).toHaveLength(4);   // 기능 조건을 보내도 무시한다
    expect(mockQuery.mock.calls.every((c) => !String(c[0]).includes("featureId' = $"))).toBe(true);
    const fi = back('utils/feature-interest.ts');
    for (const gone of ['summary', 'featureAcc', 'pricingFeatures', 'goFeatures', 'q.featureId']) expect(noComment(fi), gone).not.toContain(gone);
    // 본 기록만 있는 회사의 줄에 화면이 셀 값이 다 있다
    expect(d.companies.find((c) => c.companyId === 'c-paid')).toMatchObject({ seen: true, subscribed: true, pricingClicks: 0, features: [{ featureId: 'sns', opens: 1, clicks: 0 }] });
  });

  it('줄 순서 = 가장 최근에 일어난 일(본 시각 · 신청 시각 · 누른 시각) 순', async () => {
    fakeDb(seenRows);
    expect((await load()).companies.map((c) => c.companyId)).toEqual(['c-dis', 'c-trial', 'c-free', 'c-paid']);
  });

  it('요금제 조건은 합친 줄에도 걸린다', async () => {
    fakeDb(seenRows);
    expect((await load({ period: 'all', plan: 'subscribed' })).companies.map((c) => c.companyId)).toEqual(['c-paid']);
    fakeDb(seenRows);
    expect((await load({ period: 'all', plan: 'unsubscribed' })).companies.map((c) => c.companyId).sort()).toEqual(['c-dis', 'c-free', 'c-trial']);
  });

  it('두 목록을 못 읽어도(표 없음 · 다른 오류) 탭의 나머지는 그대로 · 못 읽은 칸은 「모름」으로 알린다', async () => {
    for (const kind of ['no-table', 'boom']) {
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      fakeDb(seenRows, kind, kind);
      const d = await load();
      err.mockRestore();
      expect(d.companies.map((c) => c.companyId).sort(), kind).toEqual(['c-free', 'c-paid']);
      expect(d.companies.every((c) => c.seen && c.trial === null && c.dismissed.length === 0)).toBe(true);
      expect({ t: d.trialsKnown, x: d.dismissalsKnown }, kind).toEqual({ t: false, x: false });
    }
    // 한쪽만 못 읽어도 다른 쪽은 나온다
    fakeDb(seenRows, 'no-table', DISMISSED);
    const d = await load();
    expect({ t: d.trialsKnown, x: d.dismissalsKnown }).toEqual({ t: false, x: true });
    expect(d.companies.map((c) => c.companyId).sort()).toEqual(['c-dis', 'c-free', 'c-paid']);
  });

  it('본 기록도 두 목록도 없으면 빈 화면(회사 이름 조회도 하지 않는다)', async () => {
    fakeDb([], [], []);
    const d = await load();
    expect(d.companies).toEqual([]);
    expect(mockQuery.mock.calls.some((c) => String(c[0]).includes('FROM companies'))).toBe(false);
  });
});

describe('③ 서버 답 → 화면 꼴(받는 자리 한 곳) — 없는 칸은 「모름」 · 빈 값(★ Codex 구현 1R)', () => {
  it('새 서버 답 = 그대로 · 읽었는가 표시는 true 일 때만 true', () => {
    const row = { companyId: 'c1', companyName: '표본', seen: false, trial: { used: 1, granted: 3 }, lineTrial: null, dismissed: [{ introKey: 'v3-scenes', at: 'x', userName: '', loginId: 'u' }], features: [{ featureId: 'sns', opens: 2, clicks: 1 }], users: [], events: [], recentClicks: [], pricingClicks: 1, goClicks: 0 };
    expect(normalizeInterest({ success: true, trialsKnown: true, dismissalsKnown: false, lineTrialsKnown: true, companies: [row] })).toEqual({ trialsKnown: true, dismissalsKnown: false, lineTrialsKnown: true, companies: [row] });
  });

  it('배포 중 옛 서버 답(체험 · 숨김 칸 없음 · 기능 줄에 누른 수 없음 · 본 회사만) = 그려진다 · 세 목록은 모름 · 줄은 본 회사', () => {
    const old = { success: true, summary: { companies: 1 }, features: [], trials: null, companies: [{ companyId: 'c1', companyName: '옛', features: [{ featureId: 'sns', opens: 1 }], users: [], events: [], pricingClicks: 0, goClicks: 0 }] };
    const d = normalizeInterest(old);
    expect({ t: d.trialsKnown, x: d.dismissalsKnown, l: d.lineTrialsKnown }).toEqual({ t: false, x: false, l: false });
    expect(d.companies).toEqual([{ ...old.companies[0], features: [{ featureId: 'sns', opens: 1, clicks: 0 }], recentClicks: [], seen: true, trial: null, lineTrial: null, dismissed: [] }]);
    // (화면의 단계 · 안내 판정이 이 줄에서 터지지 않는 것 = c141-feature-interest-redesign 「받는 자리」)
  });

  it('꼴이 틀린 답(줄 목록 없음 · 줄이 객체가 아님 · 배열 칸이 배열이 아님)도 빈 값으로', () => {
    for (const bad of [null, undefined, {}, { companies: 'x' }, { companies: null, trialsKnown: 'yes', dismissalsKnown: 1, lineTrialsKnown: 'y' }]) {
      expect(normalizeInterest(bad), JSON.stringify(bad)).toEqual({ trialsKnown: false, dismissalsKnown: false, lineTrialsKnown: false, companies: [] });
    }
    const d = normalizeInterest({ companies: [null, 'x', { companyId: 'c', features: null, users: 'u', events: 3, dismissed: {}, trial: undefined, pricingClicks: 'x' }] });
    expect(d.companies).toEqual([{ companyId: 'c', features: [], users: [], events: [], recentClicks: [], dismissed: [], trial: null, lineTrial: null, seen: true, pricingClicks: 0, goClicks: 0 }]);
  });
});

/** ★ 2026-11-17 C141 — 옛 화면의 걸러 보기(보기 셋 × 기능 단추)는 통합안의 단계 · 안내로 바뀌었다(시험 = c141-feature-interest-redesign). 「다시 보지 않기」 묶음은 그대로 쓴다. */
describe('③ 「다시 보지 않기」 묶음(순수)', () => {
  const D = (introKey: string, loginId: string, at: string, userName = '') => ({ introKey, loginId, at, userName });

  it('「다시 보지 않기」 묶음 = 창 이름별 한 줄 · 누른 사람 수(같은 사람의 옛 판 · 새 판은 한 사람) · 가장 최근 시각', () => {
    expect(groupDismissed([])).toEqual([]);
    expect(groupDismissed([
      D('v3-scenes', 'u1', '2026-11-16T01:00:00.000Z'),
      D('v3-intro', 'u1', '2026-11-13T01:00:00.000Z'),
      D('v3-scenes', 'u2', '2026-11-16T03:00:00.000Z'),
      D('studio-trial', 'u1', '2026-11-15T01:00:00.000Z'),
      D('brand-new', 'u9', '2026-11-11T01:00:00.000Z', '이름만'),
    ])).toEqual([
      { name: '로그인 안내 창', users: 2, at: '2026-11-16T03:00:00.000Z' },
      { name: '이미지 체험 안내', users: 1, at: '2026-11-15T01:00:00.000Z' },
      { name: 'brand-new', users: 1, at: '2026-11-11T01:00:00.000Z' },
    ]);
  });
});

/** ★ 2026-11-17 C141 — 탭의 소스 계약(받는 자리 · 못 읽은 목록 · 거르기)은 통합안으로 옮겼다(c141-feature-interest-redesign 「소스 계약」). */
describe('③ 소스 계약 — 기능 관심 업체 탭', () => {
  it('새 화면 파일 — 모델명 · native dialog · 줄표 0', () => {
    for (const f of ['utils/feature-interest-view.ts', 'components/admin/FeatureInterestTab.tsx', 'pages/AiOperatorPage.tsx']) {
      const src = noComment(front(f));
      expect(src, f).not.toMatch(/Opus|Sonnet|Haiku|GPT|Claude|Anthropic|claude-/);
      expect(src, f).not.toMatch(/\b(alert|confirm|prompt)\(/);
    }
    expect(noComment(front('utils/feature-interest-view.ts'))).not.toContain('—');
  });
});
